// The bars that need no author: what a parser without any knowledge of the language and without samples of
// broken text does.
// 1. The parser as it is: bison's steps up to the call of yyerror, and everything from there on shown as an error.
// 2. Skip every rejected token: where bison reports the error, the token is dropped and the parser goes on. As
//    tables: `skip` in every open cell that holds `stop`.
// 3. Panic mode: at a token that the grammar's table has no action for, pop to the topmost state from which the
//    token can be shifted, and skip the token when the stack has no such state. It is no table of this
//    experiment, since it looks at the whole stack, so it is a parser of its own here and is scored by its output.
//    Next to it stand a variant that keeps the reductions made at the rejected token, see panicMode, and the
//    nearest table: `pop` in every open cell that holds `stop`, which pops down to the start state and skips there.
// A dropped token is shown as an error. Each bar is also given with a count over train samples in place of that:
// for the tables the count of search/count.ts, and for panic mode the kind that the most code points of the tokens
// that it drops want, per terminal. A count needs no author either, and the hand-written bars use the same.
//
//   bun lab/recovery-lr/learn/bars.ts [--train <samples for the counts>] [--validation <samples>]
import {loadSamples, defaultSeed} from '../dataset.ts'
import {containerOf, depthOf, displayKind, displayKindCount, displayOfState, stackHashOf} from '../labels.ts'
import type {Sample} from '../sample.ts'
import {actionAccept, actionShift, commentKind, isTrivia} from '../tables.ts'
import {packSamples} from './data.ts'
import {numberOf, refuseUnknownOptions, standardValidationCount} from './options.ts'
import {type RecoveryTables, baseTables, bison, bisonTerminalCount, choicePop, choiceSkip, choiceStop, choicesOf, copyTables, endOfInput} from './recovery-tables.ts'
import {type ParserOutput, type Score, scoreHeader, scoreOutputs, scoreRow, scoreTables, wrongBeforeFirstError} from './score.ts'
import {displayEntriesByCount} from './search/count.ts'

// A copy of `tables` with `choice` in every open cell that holds `stop` and has the choice in its list. So bison's
// default reductions stay, and so does the column of the end of input for `skip`.
function withInPlaceOfStop(tables: RecoveryTables, choice: number): RecoveryTables {
  const result = copyTables(tables)
  for (let cell = 0; cell < result.choice.length; cell++) {
    if (result.open[cell] === 1 && result.choice[cell] === choiceStop && cell % result.terminalCount !== endOfInput && choicesOf(result, cell).includes(choice)) result.choice[cell] = choice
  }
  return result
}
// Bar 2 as tables: skip every rejected token.
export const skipTables = (layout: RecoveryTables = baseTables()): RecoveryTables => withInPlaceOfStop(layout, choiceSkip)
// The nearest table to bar 3: pop where bison reports the error. The start state has no pop and keeps `stop`, so
// that a token which nothing below takes ends in the state `stopped`, whose row skips.
export const popTables = (layout: RecoveryTables = baseTables()): RecoveryTables => withInPlaceOfStop(layout, choicePop)

type Stacks = {states: number[], firstToken: number[], lastToken: number[]}
type Reduction = {nonterminal: number, firstToken: number, lastToken: number}
const shifted = 1, accepted = 2, rejected = 0

// Feeds one terminal to the grammar's LALR(1) table, i.e. to the frozen cells: reduces while the table says so, and
// shifts. Changes the stacks and adds to the reductions, also when the terminal is rejected.
function feed(stacks: Stacks, terminal: number, token: number, reductions: Reduction[]): number {
  const {states, firstToken, lastToken} = stacks
  for (;;) {
    const cell = states.at(-1)! * bisonTerminalCount + terminal
    if (bison.frozen[cell] === 0) return rejected
    if (bison.actionKind[cell] === actionAccept) return accepted
    if (bison.actionKind[cell] === actionShift) {
      states.push(bison.actionArgument[cell]!)
      firstToken.push(token)
      lastToken.push(token)
      return shifted
    }
    const rule = bison.actionArgument[cell]!
    let first = -1, last = -1
    for (let dropped = 0; dropped < bison.ruleLength[rule]!; dropped++) {
      states.pop()
      const lastBelow = lastToken.pop()!, firstBelow = firstToken.pop()!
      if (firstBelow === -1) continue
      first = firstBelow
      if (last === -1) last = lastBelow
    }
    states.push(bison.gotoState[states.at(-1)! * bison.nonterminalCount + bison.ruleLhs[rule]! - bisonTerminalCount]!)
    firstToken.push(first)
    lastToken.push(last)
    reductions.push({nonterminal: bison.ruleLhs[rule]!, firstToken: first, lastToken: last})
  }
}

// Bar 3: panic mode on a sample's broken text. `kindOfDropped[terminal]` is the display kind of a dropped token.
// The parser knows nothing but the grammar's table: a token is fed to it, and where the table rejects the token,
// the stack is cut down to the highest part from which the token can be shifted. Where no part can, the token is
// dropped. At the end of input the stack is cut down to the highest part that accepts the end. The table is the
// grammar's LALR(1) table, so a token is rejected where it reads an open cell.
//
// An LALR parser reduces before it sees that a token has no action, e.g. it closes `f 1` as an expression at a
// stray `)`. Without `keepReductions` the stack that is cut down is the one from before the token was read, so
// those reductions are undone: of the two it is the bar with more right in all three. With `keepReductions` the
// reductions stay, as bison leaves them, and the stack is cut down from there.
export function panicMode(sample: Sample, kindOfDropped: ArrayLike<number>, keepReductions = false): ParserOutput {
  const {tokens} = sample
  const kind = new Int8Array(tokens.count), depth = new Int16Array(tokens.count), container = new Int8Array(tokens.count), stack = new Int32Array(tokens.count), taken = new Uint8Array(tokens.count)
  const reductions: Reduction[] = []
  let stacks: Stacks = {states: [bison.startState], firstToken: [-1], lastToken: [-1]}
  // Feeds the terminal to the stack, then to a copy of the stack without its top state, then without its top two,
  // and so on down. The first try that shifts or accepts becomes the stack, with its reductions.
  const take = (terminal: number, token: number): number => {
    let highest = stacks.states.length
    if (keepReductions) {
      const result = feed(stacks, terminal, token, reductions)
      if (result !== rejected) return result
      highest = stacks.states.length - 1
    }
    for (let height = highest; height >= 1; height--) {
      const attempt: Stacks = {states: stacks.states.slice(0, height), firstToken: stacks.firstToken.slice(0, height), lastToken: stacks.lastToken.slice(0, height)}
      const reductionsOfAttempt: Reduction[] = []
      const result = feed(attempt, terminal, token, reductionsOfAttempt)
      if (result === rejected) continue
      stacks = attempt
      reductions.push(...reductionsOfAttempt)
      return result
    }
    return rejected
  }
  for (let token = 0; token < tokens.count; token++) {
    const terminal = tokens.kind[token]!
    if (isTrivia(terminal)) kind[token] = terminal === commentKind ? displayKind.comment : displayKind.whitespace
    else if (take(terminal, token) === shifted) {
      kind[token] = displayOfState[stacks.states.at(-1)!]!
      taken[token] = 1
    } else kind[token] = kindOfDropped[terminal]!
    depth[token] = depthOf(stacks.states)
    container[token] = containerOf(stacks.states)
    stack[token] = stackHashOf(stacks.states)
  }
  take(endOfInput, tokens.count)
  return {kind, depth, container, stack, taken, reductions, insertedTokens: 0}
}

// For a parser that drops tokens: per terminal, the display kind that the most code points of the tokens that the
// parser drops want, over the scored code points of `samples` whose depth and container the parser has right.
// `parse` runs the parser with the given kinds of dropped tokens. A terminal that is never dropped so keeps `error`.
export function kindsOfDroppedTokensByCount(samples: readonly Sample[], parse: (sample: Sample, kindOfDropped: ArrayLike<number>) => ParserOutput): Int8Array {
  const kindOfDropped = new Int8Array(bisonTerminalCount).fill(displayKind.error)
  const wanted = new Int32Array(bisonTerminalCount * displayKindCount)
  for (const sample of samples) {
    const output = parse(sample, kindOfDropped)
    for (let token = sample.firstErrorToken; token < sample.tokens.count; token++) {
      const terminal = sample.tokens.kind[token]!
      if (isTrivia(terminal) || output.taken[token] === 1) continue
      for (let place = sample.tokens.start[token]!; place < sample.tokens.start[token]! + sample.tokens.length[token]!; place++) {
        if (sample.alignment[place] !== -1 && output.depth[token] === sample.labelDepth[place] && output.container[token] === sample.labelContainer[place]) wanted[terminal * displayKindCount + sample.labelKind[place]!]!++
      }
    }
  }
  for (let terminal = 0; terminal < bisonTerminalCount; terminal++) {
    let best = displayKind.error
    for (let kind = 0; kind < displayKindCount; kind++) if (wanted[terminal * displayKindCount + kind]! > wanted[terminal * displayKindCount + best]!) best = kind
    kindOfDropped[terminal] = best
  }
  return kindOfDropped
}

// The rows of the bars on `validation`, with the counts made on `train`.
export function barRows(train: readonly Sample[], validation: readonly Sample[]): {name: string, score: Score}[] {
  const packedTrain = packSamples(train), packedValidation = packSamples(validation)
  const rows: {name: string, score: Score}[] = []
  const tableRow = (name: string, tables: RecoveryTables) => {
    rows.push({name: `${name}, dropped tokens shown as errors`, score: scoreTables(tables, packedValidation).score})
    rows.push({name: `${name}, with the count`, score: scoreTables(displayEntriesByCount(tables, packedTrain).tables, packedValidation).score})
  }
  rows.push({name: 'the parser as it is', score: scoreTables(baseTables(), packedValidation).score})
  tableRow('skip every rejected token', skipTables())
  const errors = new Int8Array(bisonTerminalCount).fill(displayKind.error)
  rows.push({name: 'panic mode, dropped tokens shown as errors', score: scoreOutputs(validation, sample => panicMode(sample, errors))})
  const counted = kindsOfDroppedTokensByCount(train, panicMode)
  rows.push({name: 'panic mode, with the count', score: scoreOutputs(validation, sample => panicMode(sample, counted))})
  const keeping = (sample: Sample, kindOfDropped: ArrayLike<number>) => panicMode(sample, kindOfDropped, true)
  const countedKeeping = kindsOfDroppedTokensByCount(train, keeping)
  rows.push({name: 'panic mode that keeps the reductions made at a rejected token, with the count', score: scoreOutputs(validation, sample => keeping(sample, countedKeeping))})
  tableRow('the nearest table to panic mode: pop where bison reports', popTables())
  return rows
}

if (import.meta.main) {
  refuseUnknownOptions('bars.ts', ['--train', '--validation'])
  const train = loadSamples('train', defaultSeed, numberOf('--train', 5000))
  const validation = loadSamples('validation', defaultSeed, numberOf('--validation', standardValidationCount))
  console.log(`The bars without an author on ${validation.length} validation samples, with the counts made on ${train.length} train samples:`)
  console.log(scoreHeader)
  for (const {name, score} of barRows(train, validation)) console.log(scoreRow(name, score))
  const before = wrongBeforeFirstError(validation)
  console.log(`Before the first error, ${before.wrong} of the ${before.kept} kept code points of the validation samples, ${(100 * before.wrong / before.kept).toFixed(1)}%, are shown with another label than the original has. No parser of this table changes them, and no score counts them.`)
}
