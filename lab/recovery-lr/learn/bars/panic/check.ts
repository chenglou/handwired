// Checks of the bar "panic mode with a hand-written list of synchronizing tokens".
//
// 1. On 5,000 valid programs the bar gives the labels exactly: the display kind, the depth, the container and the
//    stack's hash of every code point, and the same reductions over the same tokens, and it drops no token.
// 2. On 10,000 train and 5,000 validation samples the bar shows every token before the first error as the parser
//    as it is shows it, and takes every one of them that is no white space and no comment.
// 3. The stack is a path of the base grammar's automaton after every token, and a token is taken exactly where
//    the stack's top state is the state that the token's terminal leads into.
// 4. With every detail switched off, the bar is the panic mode without knowledge of the language of ../../bars.ts:
//    the same depth, container, hash, taken tokens and reductions on 3,000 samples. So the two bars differ by the
//    list and its details alone.
// 5. dropped-kinds.json is what the count gives on the 40,000 train samples.
// 6. What panicModeByHand returns has the shape that the scorer reads.
//
// Run from the repo root: bun lab/recovery-lr/learn/bars/panic/check.ts
import {readFileSync} from 'node:fs'
import {defaultSeed, loadSamples, programAt, trainSampleCount} from '../../../dataset.ts'
import {displayKind} from '../../../labels.ts'
import type {Sample} from '../../../sample.ts'
import {isTrivia, tables} from '../../../tables.ts'
import {panicMode} from '../../bars.ts'
import {eachSample} from '../../data.ts'
import {runRecoveryParserOnTokens} from '../../recovery-parser.ts'
import {baseTables} from '../../recovery-tables.ts'
import {chosenDetails, droppedKindsByCount, droppedKindsPath, droppedKindsToText, noDroppedKinds, outputOfPanicRun, panicModeByHand, runPanic} from './panic.ts'

const problems: string[] = []
const problem = (text: string) => {
  if (problems.length < 30) console.log(`PROBLEM: ${text}`)
  problems.push(text)
}

const samples = [...loadSamples('train', defaultSeed, 10_000), ...loadSamples('validation', defaultSeed, 5_000)]

// 1: valid programs.
const validProgramCount = 5000
let wrongPrograms = 0, validCodePoints = 0
for (let index = 0; index < validProgramCount; index++) {
  const {text, labels} = programAt(defaultSeed, index)
  const run = runPanic(labels.tokens)
  // A sample's fields that outputOfPanicRun reads.
  const output = outputOfPanicRun({tokens: labels.tokens} as Sample, run, noDroppedKinds())
  let wrong = run.cuts !== 0 || run.reductions.length !== labels.reductionCount
  for (let token = 0; token < labels.tokens.count && !wrong; token++) {
    const place = labels.tokens.start[token]!
    validCodePoints += labels.tokens.length[token]!
    if (!isTrivia(labels.tokens.kind[token]!) && run.taken[token] !== 1) wrong = true
    if (output.kind[token] !== labels.kind[place] || run.depth[token] !== labels.depth[place] || run.container[token] !== labels.container[place] || run.stack[token] !== labels.stack[place]) wrong = true
  }
  run.reductions.forEach((reduction, at) => {
    if (reduction.nonterminal !== tables.ruleLhs[labels.reductionRule[at]!] || reduction.firstToken !== labels.reductionFirstToken[at] || reduction.lastToken !== labels.reductionLastToken[at]) wrong = true
  })
  if (wrong && wrongPrograms++ < 3) problem(`the valid program ${JSON.stringify(text).slice(0, 120)} does not get its labels and reductions`)
}
console.log(`${validProgramCount} valid programs with ${validCodePoints} code points: ${validProgramCount - wrongPrograms} get exactly their labels, their stack's hashes and their reductions, and no token is dropped.`)

// 2 and 3: before the first error, and the stack after every token.
const tablesAsItIs = baseTables()
let tokensBefore = 0, wrongBefore = 0, stacksSeen = 0, wrongStacks = 0, tokensDropped = 0, cuts = 0, statesDropped = 0
const outputs = new Map<Sample, ReturnType<typeof panicModeByHand>>()
for (const sample of samples) {
  const {tokens} = sample
  const output = panicModeByHand(sample)
  outputs.set(sample, output)
  const asItIs = runRecoveryParserOnTokens(sample.codePoints, tokens, tablesAsItIs)
  for (let token = 0; token < sample.firstErrorToken; token++) {
    tokensBefore++
    const same = output.kind[token] === asItIs.kind[token] && output.depth[token] === asItIs.depth[token] && output.container[token] === asItIs.container[token] && output.stack[token] === asItIs.stack[token]
    if ((!same || (!isTrivia(tokens.kind[token]!) && output.taken[token] !== 1)) && wrongBefore++ < 3) problem(`sample ${sample.id}: token ${token} stands before the first error and is not shown as the parser as it is shows it`)
  }
  const run = runPanic(tokens, chosenDetails, (_token, states) => {
    stacksSeen++
    let isPath = states[0] === tables.startState
    for (let level = 1; level < states.length && isPath; level++) {
      if (tables.transition[states[level - 1]! * tables.symbolCount + tables.accessingSymbol[states[level]!]!] !== states[level]) isPath = false
    }
    if (!isPath) wrongStacks++
  })
  for (let token = 0; token < tokens.count; token++) {
    if (isTrivia(tokens.kind[token]!)) continue
    if (run.taken[token] === 0) tokensDropped++
    // A taken token is on top of the stack when it is shown.
    if (run.taken[token] === 1 && tables.accessingSymbol[run.state[token]!] !== tokens.kind[token]) wrongStacks++
  }
  cuts += run.cuts
  statesDropped += run.statesDropped
}
if (wrongStacks > 0) problem(`${wrongStacks} stacks that are no path of the automaton, or taken tokens that are not on top of the stack`)
console.log(`${samples.length} samples: of the ${tokensBefore} tokens before a first error, ${tokensBefore - wrongBefore} are shown as the parser as it is shows them, and none of them is dropped. The stack is a path of the automaton after each of ${stacksSeen} tokens. The bar drops ${tokensDropped} tokens and cuts the stack down ${cuts} times, by ${statesDropped} states.`)

// 4: without the list, the panic mode of ../../bars.ts.
const withoutList = {inBracketsOnly: false, letRestartsAtTheTop: false, onlyListedTokens: false, expressionTakenAsThere: false}
const errors = new Int8Array(tables.terminalCount).fill(displayKind.error)
let differentFromBars = 0
for (const sample of samples.slice(0, 3000)) {
  const run = runPanic(sample.tokens, withoutList), other = panicMode(sample, errors)
  const otherReductions = [...other.reductions]
  let same = run.reductions.length === otherReductions.length
  for (let token = 0; token < sample.tokens.count && same; token++) {
    if (run.depth[token] !== other.depth[token] || run.container[token] !== other.container[token] || run.stack[token] !== other.stack[token] || run.taken[token] !== other.taken[token]) same = false
  }
  run.reductions.forEach((reduction, at) => {
    const otherReduction = otherReductions[at]
    if (otherReduction === undefined || reduction.nonterminal !== otherReduction.nonterminal || reduction.firstToken !== otherReduction.firstToken || reduction.lastToken !== otherReduction.lastToken) same = false
  })
  if (!same && differentFromBars++ < 3) problem(`sample ${sample.id}: without the list, the bar is not the panic mode of bars.ts`)
}
console.log(`3000 samples: with every detail switched off, the bar gives what the panic mode of bars.ts gives in ${3000 - differentFromBars}.`)

// 5: the count.
const recounted = droppedKindsToText(droppedKindsByCount(eachSample('train', trainSampleCount)), trainSampleCount)
if (recounted !== readFileSync(droppedKindsPath, 'utf8')) problem('dropped-kinds.json is not what the count gives on the train samples: run panic.ts --write')
else console.log(`dropped-kinds.json is what the count gives on the ${trainSampleCount} train samples.`)

// 6: the shape of the output.
let wrongShape = 0
for (const sample of samples) {
  const output = outputs.get(sample)!
  const {count} = sample.tokens
  let wrong = output.kind.length !== count || output.depth.length !== count || output.container.length !== count || output.stack.length !== count || output.taken.length !== count || output.insertedTokens !== 0
  for (let token = 0; token < count && !wrong; token++) {
    if (output.kind[token]! < 0 || output.kind[token]! > displayKind.error || output.depth[token]! < 0 || output.container[token]! < 0) wrong = true
    if (isTrivia(sample.tokens.kind[token]!) && output.taken[token] === 1) wrong = true
  }
  for (const {firstToken, lastToken, nonterminal} of output.reductions) {
    if (firstToken > lastToken || firstToken < -1 || lastToken >= count || (firstToken === -1) !== (lastToken === -1) || nonterminal < tables.terminalCount || nonterminal >= tables.symbolCount) wrong = true
  }
  if (wrong && wrongShape++ < 3) problem(`sample ${sample.id}: the output of panicModeByHand has not the shape that the scorer reads`)
}
console.log(`${samples.length} samples: the output of panicModeByHand has the shape that the scorer reads.`)

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
