// The exact parser of the recovery experiment: bison's parser with one choice per open cell, see
// recovery-tables.ts. It runs a whole text and returns what every token is shown as, with everything that a check
// or a report wants to know about the run. With baseTables() it is the parser as it is: bison's steps up to the
// call of yyerror, and everything from the first error on shown as an error.
//
// The rules of a run:
// - The first error of a text is the first token that reads an open cell. Up to there only frozen cells are read,
//   which hold bison's actions, so no choice of the open cells changes anything before the first error, its place,
//   or whether the text is valid.
// - A step is one read of a cell for the current token. From the first read of an open cell on, a token gets at
//   most 16 steps: the 17th is a skip of the token, whatever the cell holds. Before the first error nothing is
//   limited: a valid program can reduce a few hundred times at one token.
// - A step that would put more than 520 states on the stack is a skip of the token too.
// - Skipping the end of input ends the run, and so does the accept.
// - A token is shown when it is taken or skipped: by the display entry of its terminal and the state that is then
//   on top, with the depth and the container of the stack. White space and comments take no step and are shown
//   with the stack as it is.
//
// This file is the reference and is written to be read. The loop that scores many samples many times is in
// score.ts, and check-score.ts compares the two.
import {displayKind, emptyStackHash, pushStackHash} from '../labels.ts'
import {type Tokens, codePointsOf, firstOnLineOf, scan} from '../parser.ts'
import {commentKind, isTrivia} from '../tables.ts'
import {
  type RecoveryTables, argumentOfChoice, bison, checkTables, droppedOfEndEarly, endOfInput, kindAccept, kindEndEarly, kindInsert, kindOfChoice, kindPop, kindReadAs, kindReduce, kindShift, kindSkip,
  kindStop, maximumStackHeight, maximumStepsPerToken, nonterminalOfEndEarly, stateContainer, stateOpensDepth, stateSymbol, stopped, terminalOfToken,
} from './recovery-tables.ts'

// How a token came to be shown.
export const shownAsTrivia = 0, shownShifted = 1, shownReadAs = 2, shownSkipped = 3, shownSkippedByStepLimit = 4, shownSkippedByStackLimit = 5
export const shownNames = ['white space or a comment', 'shifted', 'read as another terminal', 'skipped', 'skipped after 16 steps', 'skipped at the limit of the stack'] as const

export type Reduction = {
  nonterminal: number
  // The first and the last token that the reduced states cover, as places in the text's tokens, -1 for none.
  firstToken: number
  lastToken: number
  // The rule, or -1 for an item that was ended early.
  rule: number
  // The token that the parser was reading, the number of tokens for the end of input.
  atToken: number
}

export type RecoveryRun = {
  valid: boolean
  // The first token that reads an open cell: its place in the tokens, the number of tokens for the end of input,
  // -1 in a valid text. And the code point at which it starts, the text's length for the end of input.
  firstErrorToken: number
  firstErrorPosition: number
  // The stack when that first open cell is read, undefined in a valid text.
  stackAtFirstError: number[] | undefined
  // Per token of the text, white space and comments included:
  // the terminal that the tables call the token, -1 for white space and comments,
  terminal: Int16Array
  // how it came to be shown, one of the `shown` constants above,
  shown: Uint8Array
  // the display kind, the depth and the container that it is shown with, and the hash of the symbols on the stack
  // at that moment, see ../labels.ts,
  kind: Int8Array
  depth: Int16Array
  container: Int8Array
  stack: Int32Array
  // the display entry that gave the kind, -1 for white space and comments,
  displayEntry: Int32Array
  // and how many steps the token took from the first error on, 0 before it.
  steps: Int16Array
  // Every reduction and every item that was ended early, in order.
  reductions: Reduction[]
  // The open cells that were read, in order, with the copy of the flag in the cell's number, and the token of each.
  cellsRead: number[]
  cellsReadAtToken: number[]
  // How many terminals the run inserted.
  insertedTokens: number
  highestStack: number
  // The steps at the end of input from the first error on.
  stepsAtEnd: number
  stackAtEnd: number[]
}

// What a check can watch: every cell whose choice the parser is about to apply, with the copy of the flag in the
// cell's number and the stack as it is before, and the stack after every step that changes it. `token` is the
// number of tokens for the end of input. The stack is the parser's own: copy what has to last.
export type RunObserver = {
  read?: (token: number, cell: number, stack: readonly number[]) => void
  step?: (stack: readonly number[], token: number) => void
}

// The depth, the container and the hash of the symbols of a stack that may hold `stopped`, which stands for no symbol.
export function depthOfStack(stack: readonly number[]): number {
  let depth = 0
  for (const state of stack) depth += stateOpensDepth[state]!
  return depth
}
export function containerOfStack(stack: readonly number[]): number {
  for (let level = stack.length - 1; level >= 0; level--) if (stateContainer[stack[level]!] !== 0) return stateContainer[stack[level]!]!
  return 0
}
export function hashOfStack(stack: readonly number[]): number {
  let hash = emptyStackHash
  for (const state of stack) if (stateSymbol[state] !== -1) hash = pushStackHash(hash, stateSymbol[state]!)
  return hash
}

// Runs the parser on a text that is given as its code points and its tokens. Does not check the tables: call
// checkTables once before a loop.
export function runRecoveryParserOnTokens(codePoints: ArrayLike<number>, tokens: Tokens, tables: RecoveryTables, observer: RunObserver = {}): RecoveryRun {
  const {terminalCount, cellsPerCopy} = tables
  const firstOnLine = firstOnLineOf(tokens)
  const run: RecoveryRun = {
    valid: false, firstErrorToken: -1, firstErrorPosition: -1, stackAtFirstError: undefined,
    terminal: new Int16Array(tokens.count).fill(-1), shown: new Uint8Array(tokens.count), kind: new Int8Array(tokens.count), depth: new Int16Array(tokens.count), container: new Int8Array(tokens.count),
    stack: new Int32Array(tokens.count), displayEntry: new Int32Array(tokens.count).fill(-1), steps: new Int16Array(tokens.count),
    reductions: [], cellsRead: [], cellsReadAtToken: [], insertedTokens: 0, highestStack: 1, stepsAtEnd: 0, stackAtEnd: [],
  }
  const stack = [bison.startState]
  // The first and the last token under every state of the stack, -1 for a state that covers none.
  const firstTokenOf = [-1], lastTokenOf = [-1]
  const push = (state: number, firstToken: number, lastToken: number) => {
    stack.push(state)
    firstTokenOf.push(firstToken)
    lastTokenOf.push(lastToken)
    if (stack.length > run.highestStack) run.highestStack = stack.length
  }
  // Drops `count` states and enters the state after the nonterminal: a reduction, or an item that is ended early.
  const reduce = (count: number, nonterminal: number, rule: number, atToken: number) => {
    let firstToken = -1, lastToken = -1
    for (let dropped = 0; dropped < count; dropped++) {
      stack.pop()
      const lastBelow = lastTokenOf.pop()!, firstBelow = firstTokenOf.pop()!
      if (firstBelow === -1) continue
      firstToken = firstBelow
      if (lastToken === -1) lastToken = lastBelow
    }
    const target = bison.gotoState[stack.at(-1)! * bison.nonterminalCount + nonterminal - bison.terminalCount]!
    if (target === -1) throw new Error('a reduction finds no goto: the stack is no path of the automaton')
    push(target, firstToken, lastToken)
    run.reductions.push({nonterminal, firstToken, lastToken, rule, atToken})
  }
  const show = (token: number, shown: number, kind: number, entry: number) => {
    run.shown[token] = shown
    run.kind[token] = kind
    run.depth[token] = depthOfStack(stack)
    run.container[token] = containerOfStack(stack)
    run.stack[token] = hashOfStack(stack)
    run.displayEntry[token] = entry
  }
  let errorSeen = false
  // Every token, and the end of input as the token after the last one.
  for (let token = 0; token <= tokens.count; token++) {
    const atEnd = token === tokens.count
    if (!atEnd && isTrivia(tokens.kind[token]!)) {
      show(token, shownAsTrivia, tokens.kind[token] === commentKind ? displayKind.comment : displayKind.whitespace, -1)
      continue
    }
    const terminal = atEnd ? endOfInput : terminalOfToken(tables, tokens.kind[token]!, codePoints[tokens.start[token]!]!)
    if (!atEnd) run.terminal[token] = terminal
    const flag = tables.firstOnLineFlag ? firstOnLine[token]! : 0
    let steps = 0
    // Skips the token: it is shown by the entry of its terminal and the state on top. At the end of input there
    // is nothing to show.
    const skip = (shown: number) => {
      if (atEnd) return
      const entry = stack.at(-1)! * terminalCount + terminal
      show(token, shown, tables.display[entry]!, entry)
    }
    // The steps of this token, until it is taken or skipped.
    for (;;) {
      const state = stack.at(-1)!
      const cell = flag * cellsPerCopy + state * terminalCount + terminal
      if (tables.open[cell] === 1 && !errorSeen) {
        errorSeen = true
        run.firstErrorToken = token
        run.firstErrorPosition = atEnd ? codePoints.length : tokens.start[token]!
        run.stackAtFirstError = stack.slice()
      }
      if (errorSeen) {
        // The 17th step of a token is a skip, whatever the cell holds: the cell is not read.
        if (steps === maximumStepsPerToken) {
          skip(shownSkippedByStepLimit)
          break
        }
        steps++
      }
      observer.read?.(token, cell, stack)
      if (tables.open[cell] === 1) {
        run.cellsRead.push(cell)
        run.cellsReadAtToken.push(token)
      }
      const choice = tables.choice[cell]!
      const kind = kindOfChoice(choice), argument = argumentOfChoice(choice)
      // A choice that pushes a state without dropping one needs room on the stack.
      const pushes = kind === kindShift || kind === kindStop || kind === kindInsert || kind === kindReadAs || (kind === kindReduce && bison.ruleLength[argument] === 0)
      if (pushes && stack.length >= maximumStackHeight) {
        if (!errorSeen) throw new Error(`the stack is higher than ${maximumStackHeight} states before the first error`)
        skip(shownSkippedByStackLimit)
        break
      }
      if (kind === kindAccept) {
        run.valid = !errorSeen
        break
      }
      if (kind === kindShift || kind === kindReadAs) {
        const target = kind === kindShift ? argument : bison.transition[state * bison.symbolCount + argument]!
        push(target, token, token)
        const entry = target * terminalCount + terminal
        show(token, kind === kindShift ? shownShifted : shownReadAs, tables.display[entry]!, entry)
        observer.step?.(stack, token)
        break
      }
      if (kind === kindSkip) {
        skip(shownSkipped)
        break
      }
      if (kind === kindReduce) reduce(bison.ruleLength[argument]!, bison.ruleLhs[argument]!, argument, token)
      else if (kind === kindEndEarly) reduce(droppedOfEndEarly(choice), nonterminalOfEndEarly(choice), -1, token)
      else if (kind === kindStop) push(stopped, -1, -1)
      else if (kind === kindPop) {
        stack.pop()
        firstTokenOf.pop()
        lastTokenOf.pop()
      } else if (kind === kindInsert) {
        push(bison.transition[state * bison.symbolCount + argument]!, -1, -1)
        run.insertedTokens++
      } else throw new Error(`a cell holds ${choice}, which is no choice`)
      observer.step?.(stack, token)
    }
    if (atEnd) run.stepsAtEnd = steps
    else run.steps[token] = steps
  }
  run.stackAtEnd = stack
  return run
}

// The run of a text. Throws when the tables break the ground rules.
export function runRecoveryParser(text: string, tables: RecoveryTables, observer: RunObserver = {}): RecoveryRun {
  checkTables(tables)
  const codePoints = codePointsOf(text)
  return runRecoveryParserOnTokens(codePoints, scan(codePoints), tables, observer)
}
