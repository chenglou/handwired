// The plain scanner and parser of miniml, as loops over the tables of tables.ts: `scan` does what flex's generated
// scanner does and `parse` does what bison's yyparse does, lookup by lookup. They are "the parser as it is", which
// every later part of the experiment starts from. check-tools.ts compares both with the generated C code.
//
// The tables are an argument, so that a check can run a changed copy. Everything else uses the default.
import {type Tables, actionAccept, actionError, actionReduce, actionShift, isTrivia, newlineKind, tables as defaultTables} from './tables.ts'

// A text has at most 512 code points, as on the JSON side.
export const maximumCodePoints = 512
// The stack holds at most this many states. A text of at most 512 code points never has more than 514 on it
// before its first error: the start state, the possibly empty `definitions`, and one state per code point at most.
// Every other symbol on the stack stands for at least one code point, e.g. `-` or `(`. The one other empty symbol,
// an empty `parameters`, comes after `let x` or `fun x`, which are three symbols with it and five code points.
// So no valid program reaches the limit. A parser that recovers can push states without reading a code point,
// e.g. when it inserts a token, and has to stop at the limit.
export const maximumStackHeight = 520

export const codePointsOf = (text: string): Int32Array => Int32Array.from(text, character => character.codePointAt(0)!)
export const textOf = (codePoints: ArrayLike<number>): string => String.fromCodePoint(...Array.from(codePoints))

// The byte that the scanner reads for a code point: every code point from U+0080 up is read as the byte 0x80,
// which flex puts into the class of the bytes that no rule names. So a text's tokens are counted in code points.
// flex itself would read the UTF-8 bytes of such a code point, with the same tokens, except that a code point
// outside a string and a comment would be two to four BADCHAR tokens and here is one.
export const byteOf = (codePoint: number): number => codePoint < 0x80 ? codePoint : 0x80

export type Tokens = {
  count: number
  // Per token: a terminal's number, or whitespaceKind, newlineKind or commentKind, which the parser never sees.
  kind: Int32Array
  // Per token: its first code point and its number of code points. The tokens cover the text without gaps.
  start: Int32Array
  length: Int32Array
}

// Cuts a text into tokens: one table lookup per code point, and a second one where a token ends, since the code
// point that the state has no move for starts the next token. flex reports that this scanner never backs up:
// every start of a token is a token, e.g. an open string is a BADSTRING.
export function scan(codePoints: ArrayLike<number>, tables: Tables = defaultTables): Tokens {
  const {scannerNext, scannerClassOfByte, scannerClassCount, scannerStart, scannerKindOfState} = tables
  const kind: number[] = [], start: number[] = [], length: number[] = []
  let state = scannerStart
  let tokenStart = 0
  for (let position = 0; position <= codePoints.length; position++) {
    const characterClass = position < codePoints.length ? scannerClassOfByte[byteOf(codePoints[position]!)]! : -1
    if (characterClass !== -1) {
      const next = scannerNext[state * scannerClassCount + characterClass]!
      if (next > 0) {
        state = next
        continue
      }
    }
    if (state !== scannerStart) {
      if (scannerKindOfState[state] === 0) throw new Error('a token ends in a state in which no rule ends: the scanner would have to back up')
      kind.push(scannerKindOfState[state]!)
      start.push(tokenStart)
      length.push(position - tokenStart)
    }
    if (characterClass === -1) break
    tokenStart = position
    state = scannerNext[scannerStart * scannerClassCount + characterClass]!
    if (state <= 0) throw new Error('the start state has no move for a code point')
  }
  return {count: kind.length, kind: Int32Array.from(kind), start: Int32Array.from(start), length: Int32Array.from(length)}
}

// Per token, and one more entry for the end of input: 1 when a line feed stands between the token and the token
// before it that is no white space and no comment. It is the flag "first on its line" of the JSON recipe: a line
// feed sets it and the next token clears it. So the first token of a text only has it when a line feed comes
// before it, and a line feed inside a comment does not set it.
export function firstOnLineOf(tokens: Tokens): Uint8Array {
  const firstOnLine = new Uint8Array(tokens.count + 1)
  let lineFeedSeen = false
  for (let token = 0; token < tokens.count; token++) {
    const kind = tokens.kind[token]!
    if (kind === newlineKind) lineFeedSeen = true
    if (isTrivia(kind)) continue
    firstOnLine[token] = lineFeedSeen ? 1 : 0
    lineFeedSeen = false
  }
  firstOnLine[tokens.count] = lineFeedSeen ? 1 : 0
  return firstOnLine
}

// What a caller can watch of a parse. `token` is a place in the tokens, and tokens.count for the end of input.
export type ParseObserver = {
  // The parser asked the scanner for the next terminal, as yyparse calls yylex.
  read?: (terminal: number, token: number) => void
  // The parser looked up a cell. In a state that reduces without a token, the terminal is the next one all the same.
  cell?: (state: number, terminal: number) => void
  // A shift pushed `state`. The stack is the parser's own: copy what has to last.
  shift?: (token: number, state: number, stack: readonly number[]) => void
  // A reduction popped the rule's right side and pushed `state`.
  reduce?: (rule: number, state: number, stack: readonly number[]) => void
  // yyparse called yyerror.
  error?: () => void
}

export type Parse = {
  valid: boolean
  // The first error: the place in the tokens of the first terminal that reads an open cell, tokens.count when that
  // terminal is the end of input, and -1 in a valid text. It is the terminal at which bison calls yyerror.
  firstErrorToken: number
  // The code point at which that token starts, the text's length for the end of input, and -1 in a valid text.
  firstErrorPosition: number
  // The stack of states when the parser reads its first open cell, before any reduction that bison still makes by
  // default for that terminal. A parser that recovers starts from here. In a valid text, the stack at the accept.
  stack: number[]
  // How many reductions bison makes between reading the first open cell and calling yyerror.
  reductionsBeforeReport: number
  highestStack: number
}

// Parses the tokens of a text of `textLength` code points as yyparse does, to the accept or to the call of yyerror.
export function parse(tokens: Tokens, textLength: number, observer: ParseObserver = {}, tables: Tables = defaultTables): Parse {
  if (textLength > maximumCodePoints) throw new Error(`a text has at most ${maximumCodePoints} code points, and this one has ${textLength}`)
  const {actionKind, actionArgument, frozen, reducesWithoutToken, ruleLength, ruleLhs, gotoState, terminalCount, nonterminalCount, endSymbol} = tables
  const stack = [tables.startState]
  let highestStack = 1
  // The next token that is no white space and no comment, and its terminal. `inHand` says whether yyparse has read it.
  let nextToken = 0
  while (nextToken < tokens.count && isTrivia(tokens.kind[nextToken]!)) nextToken++
  let terminal = nextToken < tokens.count ? tokens.kind[nextToken]! : endSymbol
  let inHand = false
  let firstErrorToken = -1
  let stackAtFirstOpenCell: number[] | undefined
  let reductionsBeforeReport = 0
  let reductionsSinceShift = 0
  const result = (valid: boolean): Parse => ({
    valid, firstErrorToken, firstErrorPosition: firstErrorToken === -1 ? -1 : firstErrorToken < tokens.count ? tokens.start[firstErrorToken]! : textLength,
    stack: stackAtFirstOpenCell ?? stack, reductionsBeforeReport, highestStack,
  })
  for (;;) {
    const state = stack.at(-1)!
    const cell = state * terminalCount + terminal
    if (frozen[cell] === 0 && stackAtFirstOpenCell === undefined) {
      firstErrorToken = nextToken
      stackAtFirstOpenCell = stack.slice()
    }
    // In a state whose row holds nothing but the default rule, yyparse reduces before it calls yylex.
    if (reducesWithoutToken[state] === 0 && !inHand) {
      observer.read?.(terminal, nextToken)
      inHand = true
    }
    observer.cell?.(state, terminal)
    const kind = actionKind[cell]!
    if (kind === actionError) {
      if (stackAtFirstOpenCell === undefined || firstErrorToken !== nextToken) throw new Error('the parser reports an error at a terminal that read no open cell')
      observer.error?.()
      return result(false)
    }
    if (kind === actionAccept) {
      if (stackAtFirstOpenCell !== undefined) throw new Error('the parser accepts a text that read an open cell')
      return result(true)
    }
    if (kind === actionShift) {
      if (stackAtFirstOpenCell !== undefined) throw new Error('the parser shifts a terminal that read an open cell')
      const target = actionArgument[cell]!
      stack.push(target)
      if (stack.length > highestStack) highestStack = stack.length
      if (stack.length > maximumStackHeight) throw new Error(`the stack is higher than ${maximumStackHeight} states`)
      observer.shift?.(nextToken, target, stack)
      nextToken++
      while (nextToken < tokens.count && isTrivia(tokens.kind[nextToken]!)) nextToken++
      terminal = nextToken < tokens.count ? tokens.kind[nextToken]! : endSymbol
      inHand = false
      reductionsSinceShift = 0
      continue
    }
    if (kind !== actionReduce) throw new Error('a cell holds no action')
    // A reduction: pop the rule's right side, and push the state that the automaton has after the rule's left side.
    const rule = actionArgument[cell]!
    if (ruleLength[rule]! >= stack.length) throw new Error('a reduction pops more states than the stack has')
    // The tables of the grammar reduce a few hundred times at most between two shifts, e.g. at the end of 505 `-`.
    if (++reductionsSinceShift > 100_000) throw new Error('the parser reduces without end')
    stack.length -= ruleLength[rule]!
    const target = gotoState[stack.at(-1)! * nonterminalCount + ruleLhs[rule]! - terminalCount]!
    if (target === -1) throw new Error('a reduction finds no goto: the stack is no path of the automaton')
    stack.push(target)
    if (stack.length > highestStack) highestStack = stack.length
    if (stack.length > maximumStackHeight) throw new Error(`the stack is higher than ${maximumStackHeight} states`)
    if (stackAtFirstOpenCell !== undefined) reductionsBeforeReport++
    observer.reduce?.(rule, target, stack)
  }
}

export type ParsedText = {codePoints: Int32Array, tokens: Tokens, parse: Parse}
// Scans and parses a text.
export function parseText(text: string, observer: ParseObserver = {}, tables: Tables = defaultTables): ParsedText {
  const codePoints = codePointsOf(text)
  const tokens = scan(codePoints, tables)
  return {codePoints, tokens, parse: parse(tokens, codePoints.length, observer, tables)}
}
export const isValid = (text: string): boolean => parseText(text).parse.valid

// The scanner's tokens in the form of the C driver's L line, e.g. "L 3@0+3 1001@3+1 12@4+1".
export function scannerLine(tokens: Tokens): string {
  let line = 'L'
  for (let token = 0; token < tokens.count; token++) line += ` ${tokens.kind[token]}@${tokens.start[token]}+${tokens.length[token]}`
  return line
}

// The parser's steps in the form of the C driver's P line, e.g. "P E0 R2 E2 T3@0 E4 ... X =1".
export function parserLine(tokens: Tokens, textLength: number, tables: Tables = defaultTables): string {
  let line = `P E${tables.startState}`
  const {valid} = parse(tokens, textLength, {
    read: (terminal, token) => { line += ` T${terminal}@${token < tokens.count ? tokens.start[token]! : textLength}` },
    shift: (_token, state) => { line += ` E${state}` },
    reduce: (rule, state) => { line += ` R${rule} E${state}` },
    error: () => { line += ' X' },
  }, tables)
  return `${line} =${valid ? 0 : 1}`
}
