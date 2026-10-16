// The labels of a valid miniml text: for every code point its display kind, its depth and its container, read off
// the parser's stack right after the code point's token is shifted. A broken text's code point gets the label of
// its counterpart in the valid text that its author meant, see sample.ts. The file also gives what the two
// columns need that are read off the grammar and never trained on: the symbols on the stack at every token, as a
// hash, and the nonterminal and the tokens of every reduction.
//
// All three values are functions of the symbols on the stack, so that a parser with other states can be scored,
// e.g. bison's own parser for a grammar with error productions: its stack holds the same symbols.
// - The display kind is a function of the token's terminal and the symbol below it, see kindOfTerminal.
// - The depth is the number of `(`, `[`, `let`, `if` and `fun` on the stack, e.g. 2 for the `1` of `let x = (1)`.
// - The container is the topmost symbol among `( [ let = in if then else fun ->`, where `=` only counts as the
//   sign of a binding, e.g. `then` for the `b` of `if a then b` and `(` for both brackets of `(1)`.
// White space and comments have their own kinds, and the depth and the container of the stack as the token before
// them left it. So the line break after `let x = (1)` still has the depth 2 and the container `(`: the brackets
// are only reduced when the next token is read.
import {type ParseObserver, type Tokens, codePointsOf, parse, scan} from './parser.ts'
import {commentKind, isTrivia, itemRule, symbolOf, tables} from './tables.ts'

// The display kinds, and which tokens each holds.
export const displayKindNames = [
  // Spaces, tabs, carriage returns and line feeds between tokens.
  'whitespace',
  // A closed comment, (* ... *).
  'comment',
  // let rec in if then else fun
  'keyword',
  // An identifier in an expression, e.g. both of `f x`.
  'name',
  // The identifier or `_` that a binding defines, e.g. the f of `let rec f x = x`.
  'definedName',
  // An identifier or `_` in the parameters of a binding or of `fun`, e.g. the x of `let f x = x` before the `=`.
  'parameter',
  // An integer, true, false.
  'constant',
  // A closed string.
  'string',
  // + - * / :: ^ && || <> < <= > >=, and the = between two expressions.
  'operator',
  // ( ) [ ] , ; -> and the = of a binding.
  'punctuation',
  // No label has this kind: a valid text has no such token. It is what a parser shows a token as that it cannot
  // place, e.g. a token that it skips, and text that is no token of the language (BADCHAR, BADSTRING, BADCOMMENT).
  'error',
] as const
export type DisplayKindName = typeof displayKindNames[number]
export const displayKindCount = displayKindNames.length
export const displayKind = Object.fromEntries(displayKindNames.map((name, kind) => [name, kind])) as Record<DisplayKindName, number>
// One letter per display kind, for dumps: whitespace, comment, keyword, name, definedName, parameter (a for
// argument), constant (l for literal), string, operator, punctuation, Error.
export const kindLetters = 'wckndalsopE'

export const containerNames = ['none', '(', '[', 'let', '=', 'in', 'if', 'then', 'else', 'fun', '->'] as const
export const containerCount = containerNames.length
// One character per container, for dumps: n for `in`, i for `if`, > for `->`.
export const containerLetters = '.([l=nitef>'

const {terminalCount, stateCount, accessingSymbol, symbolNames} = tables
const terminalsOf = (names: readonly string[]): number[] => names.map(name => symbolOf(name))
const keywords = terminalsOf(['LET', 'REC', 'IN', 'IF', 'THEN', 'ELSE', 'FUN'])
const constants = terminalsOf(['TRUE', 'FALSE', 'INT'])
const operators = terminalsOf(['NE', 'LT', 'LE', 'GT', 'GE', 'PLUS', 'MINUS', 'STAR', 'SLASH', 'CONS', 'AND', 'OR', 'CARET'])
const punctuation = terminalsOf(['ARROW', 'LPAREN', 'RPAREN', 'LBRACK', 'RBRACK', 'COMMA', 'SEMI'])
const badText = terminalsOf(['BADCHAR', 'BADSTRING', 'BADCOMMENT'])
const stringTerminal = symbolOf('STRING'), equalsTerminal = symbolOf('EQ'), identifierTerminal = symbolOf('IDENT'), underscoreTerminal = symbolOf('UNDERSCORE')
const letTerminal = symbolOf('LET'), recTerminal = symbolOf('REC'), funTerminal = symbolOf('FUN')
const exprSymbol = symbolOf('expr'), parametersSymbol = symbolOf('parameters')
const depthOpeners = terminalsOf(['LPAREN', 'LBRACK', 'LET', 'IF', 'FUN'])
// The terminal of containerNames[container], from container 1.
const containerTerminals = terminalsOf(['LPAREN', 'LBRACK', 'LET', 'EQ', 'IN', 'IF', 'THEN', 'ELSE', 'FUN', 'ARROW'])

// The symbol under the bottom of the stack, for kindOfTerminal and containerOfSymbols.
export const noSymbol = -1

// The display kind of a token that is shifted as `terminal` onto a stack whose top symbol is `symbolBelow`
// (noSymbol for an empty stack). Only three terminals need the symbol below:
// - `=` is an operator after an expression and the sign of a binding otherwise, e.g. after the parameters.
// - An identifier, and `_`, is a defined name after `let` or `rec`, a parameter after `fun` or after the
//   parameters before it, and a name otherwise.
export function kindOfTerminal(terminal: number, symbolBelow: number): number {
  if (keywords.includes(terminal)) return displayKind.keyword
  if (constants.includes(terminal)) return displayKind.constant
  if (terminal === stringTerminal) return displayKind.string
  if (operators.includes(terminal)) return displayKind.operator
  if (punctuation.includes(terminal)) return displayKind.punctuation
  if (terminal === equalsTerminal) return symbolBelow === exprSymbol ? displayKind.operator : displayKind.punctuation
  if (terminal === identifierTerminal || terminal === underscoreTerminal) {
    if (symbolBelow === letTerminal || symbolBelow === recTerminal) return displayKind.definedName
    return symbolBelow === funTerminal || symbolBelow === parametersSymbol ? displayKind.parameter : displayKind.name
  }
  if (badText.includes(terminal)) return displayKind.error
  throw new Error(`no token is shifted as ${symbolNames[terminal]}`)
}

// The number of symbols on the stack that open a depth.
export function depthOfSymbols(symbols: readonly number[]): number {
  let depth = 0
  for (const symbol of symbols) if (depthOpeners.includes(symbol)) depth++
  return depth
}

// The container of a stack of symbols, as an index into containerNames.
export function containerOfSymbols(symbols: readonly number[]): number {
  for (let level = symbols.length - 1; level >= 0; level--) {
    const container = containerTerminals.indexOf(symbols[level]!) + 1
    if (container === 0) continue
    // An `=` after an expression is the comparison, which starts no container.
    if (symbols[level] === equalsTerminal && symbols[level - 1] === exprSymbol) continue
    return container
  }
  return 0
}

// The hash of a stack of symbols, built from the bottom: emptyStackHash for no symbol, and pushStackHash for one
// more on top. Two stacks with the same hash hold the same symbols, up to the chance of 1 in 4 billion that two
// given stacks collide. A parser can keep the hash of every level next to its states, so that a push and a pop
// cost one step.
export const emptyStackHash = 0x2c1b3c6d
export function pushStackHash(hashBelow: number, symbol: number): number {
  let hash = hashBelow ^ (symbol + 1)
  hash = Math.imul((hash >>> 16) ^ hash, 0x21f0aaad)
  hash = Math.imul((hash >>> 15) ^ hash, 0xd35a2d97)
  return (hash >>> 15) ^ hash
}
export function stackHashOfSymbols(symbols: readonly number[]): number {
  let hash = emptyStackHash
  for (const symbol of symbols) hash = pushStackHash(hash, symbol)
  return hash
}

// The same three values and the hash for a stack of states of the tables, which is what parser.ts has. A state
// stands for the symbol that leads into it, and the start state for none.
// displayOfState[state] is the display kind of the token whose shift enters the state: the 52 frozen entries of
// the display table. -1 for a state that a nonterminal leads into, for the start state and for the final state.
export const displayOfState = new Int8Array(stateCount).fill(-1)
// opensDepth[state] is 1 when the state's symbol opens a depth.
export const opensDepth = new Uint8Array(stateCount)
// containerOfState[state] is the container that the state's symbol starts, 0 for none.
export const containerOfState = new Uint8Array(stateCount)
for (let state = 0; state < stateCount; state++) {
  const symbol = accessingSymbol[state]!
  if (state === tables.startState || state === tables.finalState || symbol >= terminalCount) continue
  // The kind comes from the items of the state, e.g. `binding: IDENT . parameters EQ expr` for a defined name.
  // check-labels.ts compares it with kindOfTerminal for every state below.
  const leftSides = new Set(tables.stateKernel[state]!.map(item => symbolNames[tables.ruleLhs[itemRule(item)]!]!))
  const only = (name: string): boolean => leftSides.size === 1 && leftSides.has(name)
  if (symbol === equalsTerminal) {
    if (!only('binding') && !only('expr')) throw new Error(`state ${state}: an = of two kinds`)
    displayOfState[state] = only('binding') ? displayKind.punctuation : displayKind.operator
    if (only('binding')) containerOfState[state] = containerTerminals.indexOf(symbol) + 1
  } else if (symbol === identifierTerminal || symbol === underscoreTerminal) {
    if (!only('binding') && !only('parameter') && !only('atom')) throw new Error(`state ${state}: an identifier of two kinds`)
    displayOfState[state] = only('binding') ? displayKind.definedName : only('parameter') ? displayKind.parameter : displayKind.name
  } else {
    displayOfState[state] = kindOfTerminal(symbol, noSymbol)
    containerOfState[state] = containerTerminals.indexOf(symbol) + 1
  }
  if (depthOpeners.includes(symbol)) opensDepth[state] = 1
}

export function depthOf(stack: readonly number[], height = stack.length): number {
  let depth = 0
  for (let level = 0; level < height; level++) depth += opensDepth[stack[level]!]!
  return depth
}
export function containerOf(stack: readonly number[], height = stack.length): number {
  for (let level = height - 1; level >= 0; level--) if (containerOfState[stack[level]!] !== 0) return containerOfState[stack[level]!]!
  return 0
}
// The symbols of a stack of states, from the bottom, without the start state, which has none.
export const symbolsOf = (stack: readonly number[]): number[] => stack.slice(1).map(state => accessingSymbol[state]!)
export function stackHashOf(stack: readonly number[], height = stack.length): number {
  let hash = emptyStackHash
  for (let level = 1; level < height; level++) hash = pushStackHash(hash, accessingSymbol[stack[level]!]!)
  return hash
}

export type ValidLabels = {
  codePoints: Int32Array
  tokens: Tokens
  // Per code point: an index into displayKindNames, the depth, an index into containerNames, and the hash of the
  // symbols on the stack, all four right after the code point's token is shifted. White space and comments have
  // their own kind and the other three as the token before them left the stack.
  kind: Int8Array
  depth: Int16Array
  container: Int8Array
  stack: Int32Array
  // Per reduction, in the parser's order: the rule, and the first and the last token that the rule's right side
  // covers, as places in `tokens`. Both are -1 for a reduction that covers no token, e.g. of an empty parameter
  // list. The reduced nonterminal is tables.ruleLhs[rule].
  reductionCount: number
  reductionRule: Int16Array
  reductionFirstToken: Int32Array
  reductionLastToken: Int32Array
  // Per reduction: the last token that was shifted before it, -1 for none. With it the reductions give the whole
  // tree, also where an empty rule is reduced.
  reductionAfterToken: Int32Array
}

// The labels of a valid text. Throws when the parser rejects the text.
export const labelsOfValidText = (text: string): ValidLabels => {
  const codePoints = codePointsOf(text)
  return labelsOfTokens(codePoints, scan(codePoints))
}

// The labels of code points that are cut into the given tokens, which the parser must accept. The tokens need not
// be the scanner's own for the code points: a check labels a broken text without the tokens that a repair skips.
// A code point that is in none of the tokens has no label.
export function labelsOfTokens(codePoints: Int32Array, tokens: Tokens): ValidLabels {
  const kind = new Int8Array(codePoints.length), depth = new Int16Array(codePoints.length), container = new Int8Array(codePoints.length), stackHash = new Int32Array(codePoints.length)
  const reductionRule: number[] = [], reductionFirstToken: number[] = [], reductionLastToken: number[] = [], reductionAfterToken: number[] = []
  let lastShifted = -1
  // The first and the last token under every state of the stack, -1 for a state that covers none.
  const firstTokenOf: number[] = [-1], lastTokenOf: number[] = [-1]
  // Labels the token, and the white space and comments after it, with the stack as it is.
  let labelled = 0
  const label = (token: number, tokenKind: number, stack: readonly number[]) => {
    const currentDepth = depthOf(stack), currentContainer = containerOf(stack), currentHash = stackHashOf(stack)
    for (let at = token; at < tokens.count && (at === token || isTrivia(tokens.kind[at]!)); at++) {
      const from = tokens.start[at]!, to = from + tokens.length[at]!
      kind.fill(at === token && tokenKind !== -1 ? tokenKind : tokens.kind[at] === commentKind ? displayKind.comment : displayKind.whitespace, from, to)
      depth.fill(currentDepth, from, to)
      container.fill(currentContainer, from, to)
      stackHash.fill(currentHash, from, to)
      labelled = at + 1
    }
  }
  // The white space and the comments before the first token.
  if (tokens.count > 0 && isTrivia(tokens.kind[0]!)) label(0, -1, [tables.startState])
  const observer: ParseObserver = {
    shift: (token, state, stack) => {
      if (token !== labelled) throw new Error('a token is shifted out of order')
      label(token, displayOfState[state]!, stack)
      firstTokenOf.push(token)
      lastTokenOf.push(token)
      lastShifted = token
    },
    reduce: (rule) => {
      let first = -1, last = -1
      for (let count = tables.ruleLength[rule]!; count > 0; count--) {
        const lastBelow = lastTokenOf.pop()!, firstBelow = firstTokenOf.pop()!
        if (firstBelow === -1) continue
        first = firstBelow
        if (last === -1) last = lastBelow
      }
      firstTokenOf.push(first)
      lastTokenOf.push(last)
      reductionRule.push(rule)
      reductionFirstToken.push(first)
      reductionLastToken.push(last)
      reductionAfterToken.push(lastShifted)
    },
  }
  if (!parse(tokens, codePoints.length, observer).valid) throw new Error(`labels are only defined for a valid text, and the parser rejects ${JSON.stringify(String.fromCodePoint(...codePoints))}`)
  if (labelled !== tokens.count) throw new Error('a token of a valid text has no label')
  return {
    codePoints, tokens, kind, depth, container, stack: stackHash,
    reductionCount: reductionRule.length, reductionRule: Int16Array.from(reductionRule), reductionFirstToken: Int32Array.from(reductionFirstToken), reductionLastToken: Int32Array.from(reductionLastToken),
    reductionAfterToken: Int32Array.from(reductionAfterToken),
  }
}

// For dumps and checks: per token of a valid text, the symbols on the stack right after the token is shifted, e.g.
// ['definitions', 'LET', 'IDENT'] for the x of `let x = 1`. undefined for white space and comments.
export function stackSymbolsOfValidText(text: string): (string[] | undefined)[] {
  const codePoints = codePointsOf(text)
  const tokens = scan(codePoints)
  const symbols: (string[] | undefined)[] = new Array<string[] | undefined>(tokens.count).fill(undefined)
  const {valid} = parse(tokens, codePoints.length, {shift: (token, _state, stack) => { symbols[token] = symbolsOf(stack).map(symbol => symbolNames[symbol]!) }})
  if (!valid) throw new Error(`the parser rejects ${JSON.stringify(text)}`)
  return symbols
}

// A text's labels as three lines under the text, for dumps: the kinds as kindLetters, the depths (the last digit)
// and the containers as containerLetters.
export function dumpLabels(labels: ValidLabels): string {
  const text = Array.from(labels.codePoints, codePoint => codePoint === 10 ? '⏎' : codePoint < 32 ? '·' : String.fromCodePoint(codePoint)).join('')
  const kinds = Array.from(labels.kind, kind => kindLetters[kind]).join('')
  const depths = Array.from(labels.depth, depth => String(depth % 10)).join('')
  const containers = Array.from(labels.container, container => containerLetters[container]).join('')
  return `${text}\n${kinds}\n${depths}\n${containers}`
}

// The parse tree of a valid text, for dumps and checks. A leaf is a token, and an inner node a reduction.
export type TreeNode = {
  symbol: number
  // The rule of a reduction, -1 for a token.
  rule: number
  // The place of a token in the text's tokens, -1 for a reduction.
  token: number
  children: TreeNode[]
}
export function treeOf(labels: ValidLabels): TreeNode {
  const {tokens} = labels
  const nodes: TreeNode[] = []
  let nextToken = 0
  for (let reduction = 0; reduction < labels.reductionCount; reduction++) {
    // The tokens that were shifted before the reduction.
    for (; nextToken <= labels.reductionAfterToken[reduction]!; nextToken++) {
      if (!isTrivia(tokens.kind[nextToken]!)) nodes.push({symbol: tokens.kind[nextToken]!, rule: -1, token: nextToken, children: []})
    }
    const rule = labels.reductionRule[reduction]!
    const children = nodes.splice(nodes.length - tables.ruleLength[rule]!)
    nodes.push({symbol: tables.ruleLhs[rule]!, rule, token: -1, children})
  }
  if (nodes.length !== 1) throw new Error('the reductions of a valid text do not give one tree')
  return nodes[0]!
}
