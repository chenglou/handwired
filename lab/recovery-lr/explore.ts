// For the checks: every stack that a valid start of a program can leave, up to a number of tokens, a valid program
// for any such start, and a text for a list of terminals.
//
// A valid start is a list of tokens that the parser takes without an error, e.g. `let x = (`. The parser's next
// steps depend on its stack only, and many starts leave the same stack, e.g. `let x = f` and `let x = f y z`.
// So the checks go through the distinct stacks: 8,744 for the starts of up to 7 tokens.
import type {Random} from './random.ts'
import {type Tables, actionAccept, actionError, actionShift, symbolOf, tables as defaultTables} from './tables.ts'

export type Start = {
  // The states on the stack after the start's last token is shifted.
  stack: readonly number[]
  // The start before its last token, and that token's terminal. undefined and -1 for the empty start.
  before: Start | undefined
  terminal: number
  // The number of tokens of this start, which is a shortest start that leaves the stack.
  tokenCount: number
}

// What the parser does with one terminal on a stack: the cells that it reads, and the stack after the shift, or
// undefined when the terminal is accepted or is an error.
export function step(stack: readonly number[], terminal: number, tables: Tables = defaultTables): {cells: number[], stackAfter: number[] | undefined, accepted: boolean} {
  const {actionKind, actionArgument, ruleLength, ruleLhs, gotoState, terminalCount, nonterminalCount} = tables
  const copy = stack.slice()
  const cells: number[] = []
  for (;;) {
    const cell = copy.at(-1)! * terminalCount + terminal
    cells.push(cell)
    const kind = actionKind[cell]!
    if (kind === actionError) return {cells, stackAfter: undefined, accepted: false}
    if (kind === actionAccept) return {cells, stackAfter: undefined, accepted: true}
    if (kind === actionShift) {
      copy.push(actionArgument[cell]!)
      return {cells, stackAfter: copy, accepted: false}
    }
    const rule = actionArgument[cell]!
    copy.length -= ruleLength[rule]!
    const target = gotoState[copy.at(-1)! * nonterminalCount + ruleLhs[rule]! - terminalCount]!
    if (target === -1) throw new Error('a reduction finds no goto')
    copy.push(target)
  }
}

// The distinct stacks of the valid starts of up to `maximumTokens` tokens, each with a shortest start that leaves
// it, in the order of their number of tokens. startCounts[n] is the number of valid starts of exactly n tokens,
// counted as lists of terminals, for n up to maximumTokens + 1: the starts with one more token are counted, and
// their stacks are not kept.
export function validStarts(maximumTokens: number, tables: Tables = defaultTables): {starts: Start[], startCounts: number[]} {
  const keyOf = (stack: readonly number[]): string => String.fromCharCode(...stack)
  const tokenTerminals = tables.textTerminals.filter(terminal => terminal !== tables.endSymbol)
  const empty: Start = {stack: [tables.startState], before: undefined, terminal: -1, tokenCount: 0}
  const starts: Start[] = [empty]
  const seen = new Set<string>([keyOf(empty.stack)])
  const startCounts = [1]
  // The stacks that starts of exactly n tokens leave, with the number of such starts.
  let level = new Map<string, {start: Start, count: number}>([[keyOf(empty.stack), {start: empty, count: 1}]])
  for (let tokenCount = 1; tokenCount <= maximumTokens; tokenCount++) {
    const next = new Map<string, {start: Start, count: number}>()
    let total = 0
    for (const {start, count} of level.values()) {
      for (const terminal of tokenTerminals) {
        const {stackAfter} = step(start.stack, terminal, tables)
        if (stackAfter === undefined) continue
        total += count
        const key = keyOf(stackAfter)
        const known = next.get(key)
        if (known !== undefined) {
          known.count += count
          continue
        }
        const after: Start = {stack: stackAfter, before: start, terminal, tokenCount}
        next.set(key, {start: after, count})
        if (seen.has(key)) continue
        seen.add(key)
        starts.push(after)
      }
    }
    startCounts.push(total)
    level = next
  }
  let oneMore = 0
  for (const {start, count} of level.values()) for (const terminal of tokenTerminals) if (step(start.stack, terminal, tables).stackAfter !== undefined) oneMore += count
  startCounts.push(oneMore)
  return {starts, startCounts}
}

// The terminals of a start, in order.
export function terminalsOf(start: Start): number[] {
  const terminals: number[] = []
  for (let at = start; at.before !== undefined; at = at.before) terminals.push(at.terminal)
  return terminals.reverse()
}

// Terminals that end a valid start as a program when they are put after it, e.g. `1 )` after `let x = (`: a shortest
// such list over the terminals that close a construct or stand for the smallest expression. undefined when no list
// of up to `maximumTokens` terminals does it.
export function completionOf(stack: readonly number[], tables: Tables = defaultTables, maximumTokens = 40): number[] | undefined {
  const closing = ['RPAREN', 'RBRACK', 'IN', 'THEN', 'ARROW', 'EQ', 'INT', 'IDENT'].map(name => symbolOf(name, tables))
  type Node = {stack: readonly number[], before: Node | undefined, terminal: number, tokenCount: number}
  const terminalsTo = (node: Node): number[] => {
    const terminals: number[] = []
    for (let at = node; at.before !== undefined; at = at.before) terminals.push(at.terminal)
    return terminals.reverse()
  }
  // The lowest stack first: a closing terminal lowers the stack, and what has to come before it is tried when
  // nothing lower is left.
  const keyOf = (states: readonly number[]): string => String.fromCharCode(...states)
  const byHeight: Node[][] = []
  const push = (node: Node) => { (byHeight[node.stack.length] ??= []).push(node) }
  const seen = new Set<string>([keyOf(stack)])
  push({stack, before: undefined, terminal: -1, tokenCount: 0})
  for (;;) {
    // byHeight has no list for a height that no node had.
    let lowest = 0
    while (lowest < byHeight.length && (byHeight[lowest] ?? []).length === 0) lowest++
    const node = byHeight[lowest]?.shift()
    if (node === undefined) return undefined
    if (step(node.stack, tables.endSymbol, tables).accepted) return terminalsTo(node)
    if (node.tokenCount === maximumTokens) continue
    for (const terminal of closing) {
      const {stackAfter} = step(node.stack, terminal, tables)
      if (stackAfter === undefined) continue
      const key = keyOf(stackAfter)
      if (seen.has(key)) continue
      seen.add(key)
      push({stack: stackAfter, before: node, terminal, tokenCount: node.tokenCount + 1})
    }
  }
}

// A text for every terminal that a text can hold, e.g. `let` for LET and `x` for IDENT.
const textOfTerminalName: Record<string, string> = {
  LET: 'let', REC: 'rec', IN: 'in', IF: 'if', THEN: 'then', ELSE: 'else', FUN: 'fun', TRUE: 'true', FALSE: 'false', IDENT: 'x', INT: '1', STRING: '"s"',
  ARROW: '->', EQ: '=', NE: '<>', LT: '<', LE: '<=', GT: '>', GE: '>=', PLUS: '+', MINUS: '-', STAR: '*', SLASH: '/', CONS: '::', AND: '&&', OR: '||', CARET: '^',
  LPAREN: '(', RPAREN: ')', LBRACK: '[', RBRACK: ']', COMMA: ',', SEMI: ';', UNDERSCORE: '_', BADCHAR: '#', BADSTRING: '"s', BADCOMMENT: '(*',
}

// A text that the scanner cuts into the given terminals: their texts with a space between them. The end of input
// has no text and may only come last. An open string ends at its line's end, so a line feed follows it, and an open
// comment takes the rest of the text, so it may only come last.
export function textOfTerminals(terminals: readonly number[], tables: Tables = defaultTables): string {
  let text = ''
  for (const [place, terminal] of terminals.entries()) {
    const name = tables.symbolNames[terminal]!
    const isLast = place === terminals.length - 1
    if (terminal === tables.endSymbol) {
      if (!isLast) throw new Error('the end of input is not the last terminal')
      continue
    }
    const tokenText = textOfTerminalName[name]
    if (tokenText === undefined) throw new Error(`no text can hold the terminal ${name}`)
    if (name === 'BADCOMMENT' && !isLast && !(place === terminals.length - 2 && terminals.at(-1) === tables.endSymbol)) throw new Error('an open comment is not the last token')
    text += tokenText
    if (!isLast) text += name === 'BADSTRING' ? '\n' : ' '
  }
  return text
}

// A random sentence of the grammar, as terminals: one to three definitions, each a derivation that picks a rule at
// random for every nonterminal, and the rule with the shortest text once `depth` rules are nested or the sentence
// has `tokenBudget` terminals. It reads the rules only, not the parser's tables and not the precedence, so it also
// writes what a person would bracket, e.g. `1 + let y = 2 in y` and an `if` without `else` inside another `if`.
export function randomSentence(random: Random, depth: number, tokenBudget: number, tables: Tables = defaultTables): number[] {
  const {ruleLhs, ruleRhs, ruleCount, terminalCount, symbolCount} = tables
  // The fewest terminals that a symbol derives, and the rule that does it.
  const fewest = new Array<number>(symbolCount).fill(Infinity)
  const shortestRule = new Array<number>(symbolCount).fill(-1)
  for (let terminal = 0; terminal < terminalCount; terminal++) fewest[terminal] = 1
  for (let changed = true; changed;) {
    changed = false
    for (let rule = 1; rule < ruleCount; rule++) {
      const length = ruleRhs[rule]!.reduce((sum, symbol) => sum + fewest[symbol]!, 0)
      if (length >= fewest[ruleLhs[rule]!]!) continue
      fewest[ruleLhs[rule]!] = length
      shortestRule[ruleLhs[rule]!] = rule
      changed = true
    }
  }
  const rulesOf: number[][] = Array.from({length: symbolCount}, () => [])
  for (let rule = 1; rule < ruleCount; rule++) rulesOf[ruleLhs[rule]!]!.push(rule)
  const terminals: number[] = []
  const derive = (symbol: number, depthLeft: number): void => {
    if (symbol < terminalCount) {
      terminals.push(symbol)
      return
    }
    const rule = depthLeft <= 0 || terminals.length >= tokenBudget ? shortestRule[symbol]! : random.pick(rulesOf[symbol]!)
    for (const next of ruleRhs[rule]!) derive(next, depthLeft - 1)
  }
  const definitionCount = random.integer(1, 3)
  for (let definition = 0; definition < definitionCount; definition++) derive(symbolOf('definition', tables), depth)
  return terminals
}
