// The bar "panic mode with a hand-written list of synchronizing tokens", over the base grammar's LALR(1) table.
//
//   panicModeByHand(sample)   what the bar says of a sample's broken text, as a ParserOutput of ../../score.ts
//
// The parser feeds every token to the grammar's table: it reduces while the table says so, and shifts. Where the
// table rejects a token, i.e. the token reads an open cell, the stack is put back as it was before the token, so
// the reductions that an LALR parser makes before it sees that a token has no action are undone. Then:
// - Where the state on top waits for an expression, the parser tries the token once more as if an expression stood
//   there: the textbook's panic mode stacks the state after a nonterminal and goes on. When the token is taken so,
//   the expression counts as there, e.g. the `then` of `if then 1 else 2` is taken after `if expr`.
// - A token that is not on the list is dropped, and the parser goes on with the next token on the same stack.
// - A synchronizing token cuts the stack down to the highest part from which the table takes the token, and is
//   taken there. Where no part takes it, the token is dropped.
// The list and its details, chosen by hand for miniml:
// - `)` `]` `,` `;` go back to the nearest bracket that takes them, whatever stands open above it, e.g. the `)` of
//   `(if a then b + )` closes the bracket and gives up the `if`.
// - `in`, `then` and `else` go back to the nearest `let`, `if` or `if .. then ..` that waits for them, also
//   through an open bracket, e.g. the `in` of `let a = (f x in a` gives up the bracket.
// - `let` goes back to the bottom of the stack and starts a definition at the top. The highest part of the stack
//   that takes a `let` is nearly always the right side of an operator or the start of a bracket, where the `let`
//   would be a local definition, and after an error that is the wrong guess.
// - The end of input cuts the stack down to the highest part that accepts it.
// - Every other token is no synchronizing token: names, constants, strings, operators, `=`, `->`, `(`, `[`, `if`,
//   `fun`, `rec`, `_` and text that is no token. Each of them is taken wherever the table takes it and dropped
//   everywhere else, e.g. the second `+` of `a + + b`, so the stack is never cut down for a token that only starts
//   or continues an expression.
// The parser never puts a token in: a missing `then` or a missing `=` stays missing. The expression that it takes
// as there covers no token and is no token, so the bar counts no inserted token.
//
// What a token is shown as: a taken token as the labels show it. A dropped token reads an entry of a display table
// over (the state on top, the terminal), set by the count that the trained tables use, see dropped-kinds.json and
// droppedKindsByCount. The depth, the container and the stack's hash are those of the stack as it is.
//
//   bun lab/recovery-lr/learn/bars/panic/panic.ts [--train <samples for the count>] [--validation <samples>] [--write]
// prints the bar's scores on the validation samples with the count made on the train samples. With --write it
// writes the count to dropped-kinds.json.
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {defaultSeed, loadSamples} from '../../../dataset.ts'
import {containerOf, depthOf, displayKind, displayKindCount, displayKindNames, displayOfState, stackHashOf} from '../../../labels.ts'
import type {Tokens} from '../../../parser.ts'
import type {Sample} from '../../../sample.ts'
import {actionAccept, actionShift, commentKind, isTrivia, symbolOf, tables} from '../../../tables.ts'
import {eachSample} from '../../data.ts'
import {numberOf, refuseUnknownOptions, standardTrainCount, standardValidationCount} from '../../options.ts'
import {type ParserOutput, scoreHeader, scoreOutputs, scoreRow} from '../../score.ts'

const {terminalCount, nonterminalCount, stateCount, endSymbol} = tables
const terminalsOf = (names: readonly string[]): number[] => names.map(name => symbolOf(name))
const letTerminal = symbolOf('LET'), expressionSymbol = symbolOf('expr')
// The tokens that close or separate inside a bracket, and the keywords that go on with a `let` or an `if`.
const closers = terminalsOf(['RPAREN', 'RBRACK', 'COMMA', 'SEMI'])
const middleKeywords = terminalsOf(['IN', 'THEN', 'ELSE'])
const brackets = terminalsOf(['LPAREN', 'LBRACK'])

// The details that were tried out, see README.md. The bar is panicModeByHand, with the default of each.
export type PanicDetails = {
  // `in`, `then` and `else` do not cut the stack down through an open bracket: the `in` of `let a = (f x in a` is
  // dropped. The bar has this off: with it, both the train samples and the author's own broken programs have
  // about half a point less right.
  inBracketsOnly: boolean
  // A rejected `let` starts a definition at the top. Without it the `let` is a synchronizing token like the
  // others: it is taken by the highest part of the stack that takes it.
  letRestartsAtTheTop: boolean
  // Only tokens of the list cut the stack down. Without it every rejected token does, which is the panic mode
  // without knowledge of the language of ../../bars.ts.
  onlyListedTokens: boolean
  // Where the state on top waits for an expression and the table rejects the token, the token is tried once more
  // with the state after an expression on top, and when it is taken so, the expression counts as there. A review
  // of the foundation found this detail: it adds a tenth of a point of all three and a point of whole samples, on
  // the train samples and on the author's own broken programs alike.
  expressionTakenAsThere: boolean
}
export const chosenDetails: PanicDetails = {inBracketsOnly: false, letRestartsAtTheTop: true, onlyListedTokens: true, expressionTakenAsThere: true}

type Stacks = {states: number[], firstToken: number[], lastToken: number[]}
type Reduction = {nonterminal: number, firstToken: number, lastToken: number}
const rejected = 0, shifted = 1, accepted = 2

// Feeds one terminal to the grammar's LALR(1) table, i.e. to the frozen cells: reduces while the table says so,
// and shifts. Changes the stacks and adds to the reductions, also when the terminal is rejected.
function feed(stacks: Stacks, terminal: number, token: number, reductions: Reduction[]): number {
  const {states, firstToken, lastToken} = stacks
  for (;;) {
    const cell = states.at(-1)! * terminalCount + terminal
    if (tables.frozen[cell] === 0) return rejected
    if (tables.actionKind[cell] === actionAccept) return accepted
    if (tables.actionKind[cell] === actionShift) {
      states.push(tables.actionArgument[cell]!)
      firstToken.push(token)
      lastToken.push(token)
      return shifted
    }
    const rule = tables.actionArgument[cell]!
    let first = -1, last = -1
    for (let dropped = 0; dropped < tables.ruleLength[rule]!; dropped++) {
      states.pop()
      const lastBelow = lastToken.pop()!, firstBelow = firstToken.pop()!
      if (firstBelow === -1) continue
      first = firstBelow
      if (last === -1) last = lastBelow
    }
    states.push(tables.gotoState[states.at(-1)! * nonterminalCount + tables.ruleLhs[rule]! - terminalCount]!)
    firstToken.push(first)
    lastToken.push(last)
    reductions.push({nonterminal: tables.ruleLhs[rule]!, firstToken: first, lastToken: last})
  }
}

export type PanicRun = {
  // Per token of the text, white space and comments included: 1 when the token was taken, the state on top of the
  // stack when it was taken or dropped, and the depth, the container and the hash of the stack's symbols then.
  taken: Uint8Array
  state: Int16Array
  depth: Int16Array
  container: Int8Array
  stack: Int32Array
  reductions: Reduction[]
  // How often the stack was cut down, and how many states that dropped.
  cuts: number
  statesDropped: number
}

// Runs the parser on the tokens of a text.
// `watch` is called with the stack after every token that is no white space and no comment, tokens.count for the
// end of input.
export function runPanic(tokens: Tokens, details: PanicDetails = chosenDetails, watch?: (token: number, states: readonly number[]) => void): PanicRun {
  const run: PanicRun = {
    taken: new Uint8Array(tokens.count), state: new Int16Array(tokens.count), depth: new Int16Array(tokens.count), container: new Int8Array(tokens.count), stack: new Int32Array(tokens.count),
    reductions: [], cuts: 0, statesDropped: 0,
  }
  let stacks: Stacks = {states: [tables.startState], firstToken: [-1], lastToken: [-1]}
  const partOf = (height: number): Stacks => ({states: stacks.states.slice(0, height), firstToken: stacks.firstToken.slice(0, height), lastToken: stacks.lastToken.slice(0, height)})
  // Feeds the terminal to the part of the stack of the given height. When the part takes it, the part becomes the
  // stack, with the reductions that the table made on the way.
  const tryPart = (height: number, terminal: number, token: number): number => {
    const part = partOf(height)
    const reductionsOfPart: Reduction[] = []
    const result = feed(part, terminal, token, reductionsOfPart)
    if (result === rejected) return rejected
    if (height < stacks.states.length) {
      run.cuts++
      run.statesDropped += stacks.states.length - height
    }
    stacks = part
    run.reductions.push(...reductionsOfPart)
    return result
  }
  // The lowest height that a rejected terminal may cut the stack down to, or 0 for a terminal that is dropped.
  const lowestHeightFor = (terminal: number): number => {
    if (!details.onlyListedTokens) return 1
    if (terminal === endSymbol || closers.includes(terminal)) return 1
    if (middleKeywords.includes(terminal)) {
      if (!details.inBracketsOnly) return 1
      // Down to the state above the topmost open bracket.
      for (let level = stacks.states.length - 1; level >= 1; level--) if (brackets.includes(tables.accessingSymbol[stacks.states[level]!]!)) return level + 1
      return 1
    }
    return 0
  }
  const take = (terminal: number, token: number): number => {
    const whole = tryPart(stacks.states.length, terminal, token)
    if (whole !== rejected) return whole
    if (details.expressionTakenAsThere) {
      const afterExpression = tables.gotoState[stacks.states.at(-1)! * nonterminalCount + expressionSymbol - terminalCount]!
      if (afterExpression !== -1) {
        const kept = stacks
        stacks = {states: [...kept.states, afterExpression], firstToken: [...kept.firstToken, -1], lastToken: [...kept.lastToken, -1]}
        const result = tryPart(stacks.states.length, terminal, token)
        if (result !== rejected) return result
        stacks = kept
      }
    }
    if (terminal === letTerminal && details.letRestartsAtTheTop) {
      // The state after the definitions so far, or the start state before the first definition.
      for (const height of [2, 1]) {
        if (height >= stacks.states.length) continue
        const result = tryPart(height, terminal, token)
        if (result !== rejected) return result
      }
      return rejected
    }
    const lowest = terminal === letTerminal ? 1 : lowestHeightFor(terminal)
    if (lowest === 0) return rejected
    for (let height = stacks.states.length - 1; height >= lowest; height--) {
      const result = tryPart(height, terminal, token)
      if (result !== rejected) return result
    }
    return rejected
  }
  for (let token = 0; token < tokens.count; token++) {
    const terminal = tokens.kind[token]!
    if (!isTrivia(terminal)) {
      if (take(terminal, token) === shifted) run.taken[token] = 1
      watch?.(token, stacks.states)
    }
    run.state[token] = stacks.states.at(-1)!
    run.depth[token] = depthOf(stacks.states)
    run.container[token] = containerOf(stacks.states)
    run.stack[token] = stackHashOf(stacks.states)
  }
  take(endSymbol, tokens.count)
  watch?.(tokens.count, stacks.states)
  return run
}

// The display table of the dropped tokens: [state on top × terminalCount + terminal] is a display kind, or -1 for
// an entry that the count did not set, which shows a dropped token as an error.
export type DroppedKinds = Int8Array
export const noDroppedKinds = (): DroppedKinds => new Int8Array(stateCount * terminalCount).fill(-1)

// A run on a sample's broken text, in the form that the scorer takes.
export function outputOfPanicRun(sample: Sample, run: PanicRun, droppedKinds: DroppedKinds): ParserOutput {
  const {tokens} = sample
  const kind = new Int8Array(tokens.count)
  for (let token = 0; token < tokens.count; token++) {
    const terminal = tokens.kind[token]!
    if (isTrivia(terminal)) kind[token] = terminal === commentKind ? displayKind.comment : displayKind.whitespace
    else if (run.taken[token] === 1) kind[token] = displayOfState[run.state[token]!]!
    else {
      const counted = droppedKinds[run.state[token]! * terminalCount + terminal]!
      kind[token] = counted !== -1 ? counted : displayKind.error
    }
  }
  return {kind, depth: run.depth, container: run.container, stack: run.stack, taken: run.taken, reductions: run.reductions, insertedTokens: 0}
}

// The count: per entry of the dropped tokens' display table, the kind that the most scored code points of
// `samples` want there, among the code points whose depth and container the bar has right. Of several kinds with
// the same count, the first. An entry that no such code point reads stays -1.
export function droppedKindsByCount(samples: Iterable<Sample>, details: PanicDetails = chosenDetails): DroppedKinds {
  const droppedKinds = noDroppedKinds()
  const wanted = new Int32Array(droppedKinds.length * displayKindCount)
  for (const sample of samples) {
    const {tokens} = sample
    const run = runPanic(tokens, details)
    for (let token = sample.firstErrorToken; token < tokens.count; token++) {
      const terminal = tokens.kind[token]!
      if (isTrivia(terminal) || run.taken[token] === 1) continue
      const entry = run.state[token]! * terminalCount + terminal
      for (let place = tokens.start[token]!; place < tokens.start[token]! + tokens.length[token]!; place++) {
        if (sample.alignment[place] !== -1 && run.depth[token] === sample.labelDepth[place] && run.container[token] === sample.labelContainer[place]) wanted[entry * displayKindCount + sample.labelKind[place]!]!++
      }
    }
  }
  for (let entry = 0; entry < droppedKinds.length; entry++) {
    let best = -1, most = 0
    for (let kind = 0; kind < displayKindCount; kind++) {
      if (wanted[entry * displayKindCount + kind]! > most) {
        most = wanted[entry * displayKindCount + kind]!
        best = kind
      }
    }
    droppedKinds[entry] = best
  }
  return droppedKinds
}

// dropped-kinds.json: one line per entry that the count set, e.g. [35, "RPAREN", "punctuation"] for a `)` that is
// dropped with state 35 on top.
export const droppedKindsPath = join(import.meta.dir, 'dropped-kinds.json')
type DroppedKindsFile = {note: string, trainSamples: number, entries: [state: number, terminal: string, kind: string][]}
export function droppedKindsToText(droppedKinds: DroppedKinds, trainSamples: number): string {
  const lines: string[] = []
  for (let entry = 0; entry < droppedKinds.length; entry++) {
    if (droppedKinds[entry] !== -1) lines.push(JSON.stringify([Math.floor(entry / terminalCount), tables.symbolNames[entry % terminalCount], displayKindNames[droppedKinds[entry]!]]))
  }
  const note = 'The display kinds of the tokens that the bar "panic mode with a hand-written list" drops, set by the count of panic.ts over train samples. Written by panic.ts --write.'
  return `{\n"note": ${JSON.stringify(note)},\n"trainSamples": ${trainSamples},\n"entries": [\n${lines.join(',\n')}\n]\n}\n`
}
export function droppedKindsOfText(text: string): DroppedKinds {
  const file = JSON.parse(text) as DroppedKindsFile
  const droppedKinds = noDroppedKinds()
  for (const [state, terminal, kind] of file.entries) {
    const terminalNumber = tables.symbolNames.indexOf(terminal), kindNumber = (displayKindNames as readonly string[]).indexOf(kind)
    if (terminalNumber === -1 || terminalNumber >= terminalCount || kindNumber === -1 || state < 0 || state >= stateCount) throw new Error(`dropped-kinds.json holds an entry that the tables do not have: ${JSON.stringify([state, terminal, kind])}`)
    droppedKinds[state * terminalCount + terminalNumber] = kindNumber
  }
  return droppedKinds
}

let committedKinds: DroppedKinds | undefined
// The display table of the committed dropped-kinds.json.
export function committedDroppedKinds(): DroppedKinds {
  if (committedKinds === undefined) {
    if (!existsSync(droppedKindsPath)) throw new Error(`no ${droppedKindsPath}: run panic.ts --write`)
    committedKinds = droppedKindsOfText(readFileSync(droppedKindsPath, 'utf8'))
  }
  return committedKinds
}

// The bar: panic mode with the hand-written list of synchronizing tokens on a sample's broken text.
export const panicModeByHand = (sample: Sample): ParserOutput => outputOfPanicRun(sample, runPanic(sample.tokens), committedDroppedKinds())

if (import.meta.main) {
  refuseUnknownOptions('panic.ts', ['--train', '--validation'], ['--write'])
  const trainCount = numberOf('--train', standardTrainCount)
  const droppedKinds = droppedKindsByCount(eachSample('train', trainCount))
  if (process.argv.includes('--write')) {
    writeFileSync(droppedKindsPath, droppedKindsToText(droppedKinds, trainCount))
    console.log(`wrote ${droppedKindsPath}`)
  }
  const validation = loadSamples('validation', defaultSeed, numberOf('--validation', standardValidationCount))
  const errors = noDroppedKinds()
  console.log(`The bar "panic mode with a hand-written list of synchronizing tokens" on ${validation.length} validation samples, with the count made on ${trainCount} train samples:`)
  console.log(scoreHeader)
  console.log(scoreRow('panic mode with a hand-written list, dropped tokens shown as errors', scoreOutputs(validation, sample => outputOfPanicRun(sample, runPanic(sample.tokens), errors))))
  console.log(scoreRow('panic mode with a hand-written list, with the count', scoreOutputs(validation, sample => outputOfPanicRun(sample, runPanic(sample.tokens), droppedKinds))))
}
