// Between the dataset's tables and the experiment's. The dataset writes tables as ParserTables, the layout of
// ../table-parser.ts, e.g. its four hand rules in ../hand-rules.ts. The experiment runs RecoveryTables, which have a
// stack action per grammar cell and masks of open cells.
//
// The two parsers are not the same parser, also with the same cells:
// - The plain table parser of ../table-parser.ts changes the depth by the tokenizer's event and keeps the kinds of
//   the open containers in a running sum. The sum is only right while every closing bracket matches.
// - The experiment's parser changes the depth by the stack action of the grammar cell that it reads and keeps a real
//   stack. With the action `by token` in every cell it gives the plain parser's depth at every code point. After a
//   closing bracket that does not match, it can have another innermost container than the running sum says. The
//   grammar then reads another context, so the display kind can differ from there on too, e.g. a string is shown as
//   a key in one parser and as a string in the other. arms/check.ts counts how often.
// The dataset's two proofs and its bound (needsNestingFix, needsDisplayFix, mostRightFor) are about the plain parser.
import {conditionProblems} from '../limits.ts'
import {type ParserTables, defaultTables} from '../table-parser.ts'
import {type RecoveryTables, actionByToken, actionOfToken, addStates, asIsTables, checkTables, today} from './recovery-tables.ts'

// Tables of the dataset's layout as tables of the experiment, with the stack action `by token` in every grammar cell,
// e.g. recoveryTablesOf(handRuleTables('words')). The tables have to have today's classes, contexts, tokens and depth
// changes, and today's display table for today's grammar states. They may have more tokenizer states and more
// grammar states than today's, e.g. the hand rule `lines`, which has a state of its own after a string that a line
// feed ended: the added states come after today's, as addStates puts them, and an added grammar state's column of
// the display table is the one that the tables hold. Throws when the tables change a frozen cell.
export function recoveryTablesOf(plain: ParserTables): RecoveryTables {
  const addedLexerStates = plain.lexerNext.length / plain.classCount - today.lexerStateCount
  const addedGrammarStates = plain.grammarStateCount - today.grammarStateCount
  if (plain.classCount !== today.classCount || plain.contextCount !== today.contextCount || plain.symbolCount !== today.tokenCount * today.contextCount
    || !Number.isInteger(addedLexerStates) || addedLexerStates < 0 || addedGrammarStates < 0 || plain.lexerEvent.length !== plain.lexerNext.length
    || plain.grammarNext.length !== plain.grammarStateCount * plain.symbolCount || plain.display.length !== plain.eventCount * plain.grammarStateCount) {
    throw new Error('recoveryTablesOf takes tables with today\'s classes, contexts and tokens, and with today\'s states or more')
  }
  if (plain.grammarToken.some((token, event) => token !== today.tokenOfEvent[event]) || plain.depthChange.some((change, event) => change !== defaultTables.depthChange[event])) {
    throw new Error('recoveryTablesOf takes tables with today\'s tokens and depth changes')
  }
  // The column of an added grammar state is set below, so which column addStates copies does not matter.
  const tables = addStates(asIsTables(), addedLexerStates, Array.from({length: addedGrammarStates}, () => today.errorState))
  tables.lexerNext.set(plain.lexerNext)
  tables.lexerEvent.set(plain.lexerEvent)
  tables.grammarNext.set(plain.grammarNext)
  tables.grammarAction.fill(actionByToken)
  tables.display.set(plain.display)
  checkTables(tables)
  return tables
}

// Tables of the experiment in the dataset's layout, or undefined when that layout cannot hold them: tables with
// added classes or with the bit "first on its line". The stack actions are left out, since the plain table parser
// has none: its depth follows the tokenizer's events.
export function plainTablesOf(tables: RecoveryTables): ParserTables | undefined {
  if (tables.addedClasses.length > 0 || tables.contextCount !== today.contextCount) return undefined
  return {
    ...defaultTables, grammarStateCount: tables.grammarStateCount, lexerNext: Array.from(tables.lexerNext), lexerEvent: Array.from(tables.lexerEvent),
    grammarNext: Array.from(tables.grammarNext), display: Array.from(tables.display),
  }
}

// What keeps the dataset's two proofs and its bound from holding for `tables`, as sentences. The first sentences are
// the dataset's own, from conditionProblems in ../limits.ts: a changed cell that valid JSON reads, an added class, a
// changed display table. Then what conditionProblems cannot see, since the dataset's layout has no place for it:
// - A grammar cell with a stack action that does something else than its token does, e.g. a pop at a comma. The
//   depth then does not follow the tokenizer's events, which the proofs assume.
// - The bit "first on its line".
// An empty list means that the tables are tables of the plain table parser, under the two conditions of the proofs.
// The experiment's parser still keeps its containers in a real stack, so after a closing bracket that does not match
// it can read another context than the plain parser, see the top of this file.
export function plainParserProblems(tables: RecoveryTables): string[] {
  const problems: string[] = []
  const plain = plainTablesOf(tables)
  if (plain === undefined) {
    if (tables.addedClasses.length > 0) problems.push(`the tables have ${tables.addedClasses.length} added character class${tables.addedClasses.length === 1 ? '' : 'es'}`)
    if (tables.contextCount !== today.contextCount) problems.push('the grammar reads the bit "first on its line"')
  } else {
    problems.push(...conditionProblems(plain))
  }
  // A stack action that does what the cell's token does by itself is no other action, e.g. `none` at a comma.
  let otherActions = 0
  for (let cell = 0; cell < tables.grammarAction.length; cell++) {
    const action = tables.grammarAction[cell]!
    const token = Math.floor(cell / tables.contextCount) % tables.tokenCount
    if (action !== actionByToken && action !== actionOfToken[token]) otherActions++
  }
  if (otherActions > 0) problems.push(`${otherActions} grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events`)
  return problems
}
