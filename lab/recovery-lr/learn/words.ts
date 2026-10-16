// Cells and choices in words that a person can read, for reports, e.g.
//   after `if expression`, in an expression, at `else`: insert `then`
//   after `let binding`, in an expression, at `let`: end the expression early, as `let binding` without `in expression`
// A state is named by what is on top of the stack when the parser is in it: the symbols before the dot of the
// longest item of its kernel. Every item of a kernel fits the top of the stack, so the longest one says the most.
import {type RecoveryTables, argumentOfChoice, bison, bisonTerminalCount, choiceName, displayKindNames, droppedOfEndEarly, endOfInput, flagOfCell, kindEndEarly, kindInsert, kindOfChoice, kindPop, kindReadAs,
  kindReduce, kindSkip, kindStop, nonterminalOfEndEarly, stateOfCell, stateSymbol, stopped, terminalOfCell} from './recovery-tables.ts'
import {itemDot, itemRule} from '../tables.ts'

// How a terminal is written in a program, or what it is.
const spellings: Record<string, string> = {
  LET: 'let', REC: 'rec', IN: 'in', IF: 'if', THEN: 'then', ELSE: 'else', FUN: 'fun', TRUE: 'true', FALSE: 'false', ARROW: '->', EQ: '=', NE: '<>', LT: '<', LE: '<=', GT: '>', GE: '>=', PLUS: '+',
  MINUS: '-', STAR: '*', SLASH: '/', CONS: '::', AND: '&&', OR: '||', CARET: '^', LPAREN: '(', RPAREN: ')', LBRACK: '[', RBRACK: ']', COMMA: ',', SEMI: ';', UNDERSCORE: '_',
}
const kindsOfToken: Record<string, string> = {
  '$end': 'the end of the text', IDENT: 'a name', INT: 'an integer', STRING: 'a string', BADCHAR: 'a character that starts no token', BADSTRING: 'an open string', BADCOMMENT: 'an open comment',
}
// A symbol inside the text of a rule, e.g. `name parameters = expression`.
const wordsInRule: Record<string, string> = {
  IDENT: 'name', INT: 'integer', STRING: 'string', expr: 'expression', tuple_rest: 'tuple elements', elements: 'list elements', BADCHAR: 'bad character', BADSTRING: 'open string', BADCOMMENT: 'open comment',
}
const symbolInRule = (symbol: number): string => {
  const name = bison.symbolNames[symbol]!
  return wordsInRule[name] ?? spellings[name] ?? name
}
const withArticle = (noun: string): string => noun.endsWith('s') ? noun : `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`
const symbolsInRule = (symbols: readonly number[]): string => symbols.map(symbolInRule).join(' ')

// A terminal as a reader meets it, e.g. "`else`", "a name", "the end of the text", "the character `&`".
export function terminalInWords(tables: Pick<RecoveryTables, 'addedTerminals'>, terminal: number): string {
  if (terminal >= bisonTerminalCount) return `the character \`${String.fromCodePoint(tables.addedTerminals[terminal - bisonTerminalCount]!.codePoint)}\``
  const name = bison.symbolNames[terminal]!
  return kindsOfToken[name] ?? `\`${spellings[name] ?? name}\``
}

// A state by the top of the stack: the symbols on top, e.g. "if expression then", and what they are part of,
// e.g. "in an expression", or "a complete atom" for a state in which a rule is complete.
function topOfStackIn(state: number): {top: string, role: string} {
  const kernel = bison.stateKernel[state]!
  let longest = kernel[0]!
  for (const item of kernel) if (itemDot(item) > itemDot(longest)) longest = item
  const top = symbolsInRule(bison.ruleRhs[itemRule(longest)]!.slice(0, itemDot(longest)))
  const leftSidesOf = (items: readonly number[]): string => [...new Set(items.map(item => withArticle(symbolInRule(bison.ruleLhs[itemRule(item)]!))))].join(' or ')
  const complete = kernel.filter(item => itemDot(item) === bison.ruleRhs[itemRule(item)]!.length)
  if (complete.length > 0) return {top, role: [...new Set(complete.map(item => symbolInRule(bison.ruleLhs[itemRule(item)]!)))].map(noun => noun.endsWith('s') ? `complete ${noun}` : `a complete ${noun}`).join(' or ')}
  return {top, role: `in ${leftSidesOf(kernel.filter(item => itemDot(item) === itemDot(longest)))}`}
}

// A state in words, e.g. "after `if expression then`, in an expression" and "after `name`, a complete atom".
export function stateInWords(state: number): string {
  if (state === stopped) return 'in the state stopped'
  if (state === bison.startState) return 'at the start of the text'
  const {top, role} = topOfStackIn(state)
  return `after \`${top}\`, ${role}`
}

// What a cell holds, e.g. "insert `then`" and "end the atom early, as `( expression` without `)`".
export function choiceInWords(tables: RecoveryTables, cell: number, choice: number = tables.choice[cell]!): string {
  const state = stateOfCell(tables, cell)
  const argument = argumentOfChoice(choice)
  switch (kindOfChoice(choice)) {
    case kindStop: return 'stop'
    case kindSkip: return terminalOfCell(tables, cell) === endOfInput ? 'end the parse' : 'skip the token'
    case kindPop: return state === stopped ? 'leave the state stopped and read the token again' : `drop the \`${symbolInRule(stateSymbol[state]!)}\` on top of the stack`
    case kindReduce: {
      const rightSide = bison.ruleRhs[argument]!
      const leftSide = symbolInRule(bison.ruleLhs[argument]!)
      const byDefault = state !== stopped && bison.defaultRule[state] === argument ? ', which bison does by default' : ''
      return rightSide.length === 0 ? `put empty ${leftSide} on the stack${byDefault}` : `reduce \`${symbolsInRule(rightSide)}\` to ${withArticle(leftSide)}${byDefault}`
    }
    case kindInsert: return `insert ${terminalInWords(tables, argument)}`
    case kindReadAs: return `read the token as ${terminalInWords(tables, argument)}`
    case kindEndEarly: {
      const dropped = droppedOfEndEarly(choice), nonterminal = nonterminalOfEndEarly(choice)
      const items = bison.stateKernel[state]!.filter(item => itemDot(item) === dropped && bison.ruleLhs[itemRule(item)] === nonterminal)
      const rightSide = bison.ruleRhs[itemRule(items[0]!)]!
      const missing = [...new Set(items.map(item => `\`${symbolsInRule(bison.ruleRhs[itemRule(item)]!.slice(dropped))}\``))].join(' or ')
      return `end the ${symbolInRule(nonterminal)} early, as \`${symbolsInRule(rightSide.slice(0, dropped))}\` without ${missing}`
    }
    default: return choiceName(choice)
  }
}

// A cell with what it holds, as one sentence without its full stop.
export function cellInWords(tables: RecoveryTables, cell: number, choice: number = tables.choice[cell]!): string {
  return `${stateInWords(stateOfCell(tables, cell))}, at ${terminalInWords(tables, terminalOfCell(tables, cell))}${flagOfCell(tables, cell) === 1 ? ' that is the first on its line' : ''}: ${choiceInWords(tables, cell, choice)}`
}

// A display entry with what it holds. The state is the one on top after the token is taken or skipped, e.g.
// "an open string, with `string` on top of the stack then (a complete atom): shown as string".
export function displayEntryInWords(tables: RecoveryTables, entry: number): string {
  const state = Math.floor(entry / tables.terminalCount)
  let where = state === stopped ? 'in the state stopped' : 'at the start of the text'
  if (state !== stopped && state !== bison.startState) {
    const {top, role} = topOfStackIn(state)
    where = `with \`${top}\` on top of the stack then (${role})`
  }
  return `${terminalInWords(tables, entry % tables.terminalCount)}, ${where}: shown as ${displayKindNames[tables.display[entry]!]}`
}
