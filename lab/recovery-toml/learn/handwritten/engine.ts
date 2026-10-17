// What a hand-written rule is, and how a list of rules becomes tables. It is the lower half of
// lab/recovery-parser/learn/handwritten/rules.ts, for the TOML tables with their added structure: a rule may also
// set an open entry of the display table, and a grammar cell has 16 contexts, 8 of them for a token that is the
// first on its line.
//
// A rule sets only cells and entries that the recipe's training may set: an open tokenizer cell, an open grammar cell
// that is not one of the recipe's kept cells (see cellsOfTooDeepValidTexts in ../recipe.ts), and an open display entry
// that is not of the grammar state `error`. So tables of rules and trained tables fill the same cells.
import {cellsOfTooDeepValidTexts} from '../recipe.ts'
import {
  type AddedClass, type RecoveryTables, actionNames, addClasses, addFirstOnLineBit, asIsTables, checkTables, classNames, displayEntryName, displayEntryOf, displayKindNames, eventNames, grammarCellName,
  grammarCellOf, grammarChoiceName, grammarStateNames, lexerCellName, lexerCellOf, lexerChoiceName, lexerStateNames, openDisplayEntries, tokenNames,
} from '../recovery-tables.ts'

export type TodaysClassName = typeof classNames[number]
export type LexerStateName = typeof lexerStateNames[number]
export type EventName = typeof eventNames[number]
export type TokenName = typeof tokenNames[number]
export type GrammarStateName = typeof grammarStateNames[number]
export type ActionName = typeof actionNames[number]
export type DisplayKindName = 'whitespace' | 'punctuation' | 'string' | 'escape' | 'number' | 'literal' | 'error' | 'key' | 'headerName' | 'comment'

// The grammar's contexts. Without the bit: 0 is depth 0, and then the depth class (1, 2 to 15, 16) with the kind of the
// innermost container. The context 1, depth 0 inside an inline table, is never read. A context + 8 is the same for a
// token that is the first on its line.
export const topContext = 0
export const arrayContexts = [2, 4, 6] as const
export const inlineTableContexts = [3, 5, 7] as const
export const containerContexts = [2, 3, 4, 5, 6, 7] as const
export const firstOnLine = (context: number) => context + 8
// The contexts with the bit and without it.
export const eitherPlace = (contexts: readonly number[]) => [...contexts, ...contexts.map(firstOnLine)]
export const isArrayContext = (context: number) => context % 8 >= 2 && context % 2 === 0
export const isInlineTableContext = (context: number) => context % 8 >= 2 && context % 2 === 1
// The contexts of depth 16, which the parser also reads at every depth above 16.
export const isDeepestContext = (context: number) => context % 8 >= 6

// What a rule may do. A setter throws when the cell is frozen or kept, when an earlier rule set it, and when it
// holds the choice already. `…AsToday` says that the rule relies on what an open cell holds today, and `…IsFree`
// says whether a rule may still set a cell: it is open, not kept, and no earlier rule named it.
export type CellSetter<ClassName extends string> = {
  lexer: (state: LexerStateName, characterClass: ClassName, next: LexerStateName, event: EventName) => void
  lexerAsToday: (state: LexerStateName, characterClass: ClassName, next: LexerStateName, event: EventName) => void
  lexerIsFree: (state: LexerStateName, characterClass: ClassName) => boolean
  // What a tokenizer cell holds, with the rules that came before.
  lexerChoice: (state: LexerStateName, characterClass: ClassName) => {next: LexerStateName, event: EventName}
  grammar: (state: GrammarStateName, token: TokenName, context: number, next: GrammarStateName, action: ActionName) => void
  grammarAsToday: (state: GrammarStateName, token: TokenName, context: number, next: GrammarStateName, action: ActionName) => void
  grammarIsFree: (state: GrammarStateName, token: TokenName, context: number) => boolean
  grammarChoice: (state: GrammarStateName, token: TokenName, context: number) => {next: GrammarStateName, action: ActionName}
  display: (event: EventName, grammarStateAfter: GrammarStateName, kind: DisplayKindName) => void
  displayAsToday: (event: EventName, grammarStateAfter: GrammarStateName, kind: DisplayKindName) => void
  displayIsFree: (event: EventName, grammarStateAfter: GrammarStateName) => boolean
  displayChoice: (event: EventName, grammarStateAfter: GrammarStateName) => string
}

export type Rule<ClassName extends string> = {
  name: string
  // Why a person would write the rule.
  reason: string
  // A broken text that the rule is for, with ⏎ for a line feed.
  example: string
  // A rule that fills only what the other rules leave, e.g. "anything else changes nothing": its cells are set after
  // the cells of every rule without the mark, the rules with 1 before those with 2 and so on.
  fallback?: 1 | 2 | 3
  cells: (set: CellSetter<ClassName>) => void
}

export type Handwritten = {
  tables: RecoveryTables
  // For every cell and entry, the index into the rules of the rule that named it, or -1.
  ruleOfLexerCell: Int16Array
  ruleOfGrammarCell: Int16Array
  ruleOfDisplayEntry: Int16Array
  // How many tokenizer cells, grammar cells and display entries each rule set, and how many open cells it relies on
  // as they are today.
  lexerCellsOfRule: number[]
  grammarCellsOfRule: number[]
  displayEntriesOfRule: number[]
  keptAsTodayOfRule: number[]
}

// Today's tables with the given classes, open display entries and the bit "first on its line": what the recipe's
// base is, with classes chosen by hand in the place of the classes of the recipe's rule.
export function baseWith(classes: readonly AddedClass[]): RecoveryTables {
  const withClasses = classes.length > 0 ? addClasses(asIsTables(), classes) : asIsTables()
  return addFirstOnLineBit(openDisplayEntries(withClasses))
}

// The tables of some rules on a base. Throws when a rule names a cell that it may not set, see CellSetter.
export function tablesOfRules<ClassName extends string>(base: RecoveryTables, rules: readonly Rule<ClassName>[]): Handwritten {
  const tables = base
  const kept = cellsOfTooDeepValidTexts(base)
  const ruleOfLexerCell = new Int16Array(tables.lexerNext.length).fill(-1)
  const ruleOfGrammarCell = new Int16Array(tables.grammarNext.length).fill(-1)
  const ruleOfDisplayEntry = new Int16Array(tables.display.length).fill(-1)
  const lexerCellsOfRule = rules.map(() => 0)
  const grammarCellsOfRule = rules.map(() => 0)
  const displayEntriesOfRule = rules.map(() => 0)
  const keptAsTodayOfRule = rules.map(() => 0)
  const classNamesOfTables: string[] = [...classNames, ...tables.addedClasses.map(added => added.name)]
  const indexIn = (names: readonly string[], name: string, what: string) => {
    const index = names.indexOf(name)
    if (index === -1) throw new Error(`no ${what} is named ${name}`)
    return index
  }
  const lexerCell = (state: LexerStateName, characterClass: string) => lexerCellOf(tables, indexIn(lexerStateNames, state, 'tokenizer state'), indexIn(classNamesOfTables, characterClass, 'class'))
  const grammarCell = (state: GrammarStateName, token: TokenName, context: number) => {
    if (!Number.isInteger(context) || context < 0 || context >= tables.contextCount) throw new Error(`no context has the number ${context}`)
    return grammarCellOf(tables, indexIn(grammarStateNames, state, 'grammar state'), indexIn(tokenNames, token, 'token'), context)
  }
  const displayEntry = (event: EventName, state: GrammarStateName) => displayEntryOf(tables, indexIn(eventNames, event, 'event'), indexIn(grammarStateNames, state, 'grammar state'))
  const errorState = grammarStateNames.indexOf('error')
  // The rules in the order of the list, and the ones that fill what is left after them.
  const order = rules.map((_, index) => index).sort((left, right) => (rules[left]!.fallback ?? 0) - (rules[right]!.fallback ?? 0) || left - right)
  for (const ruleIndex of order) {
    const rule = rules[ruleIndex]!
    const fail = (cell: string, problem: string) => new Error(`rule "${rule.name}": ${cell} ${problem}`)
    const setBy = (owner: number) => `is already named by the rule "${rules[owner]!.name}"`
    const freeLexer = (cell: number) => {
      const name = `the tokenizer cell ${lexerCellName(tables, cell)}`
      if (tables.lexerOpen[cell] === 0) throw fail(name, 'is frozen')
      if (ruleOfLexerCell[cell] !== -1) throw fail(name, setBy(ruleOfLexerCell[cell]!))
      return name
    }
    const freeGrammar = (cell: number) => {
      const name = `the grammar cell ${grammarCellName(tables, cell)}`
      if (tables.grammarOpen[cell] === 0) throw fail(name, 'is frozen')
      if (kept[cell] === 1) throw fail(name, 'is one of the recipe\'s kept cells')
      if (ruleOfGrammarCell[cell] !== -1) throw fail(name, setBy(ruleOfGrammarCell[cell]!))
      return name
    }
    const freeDisplay = (entry: number) => {
      const name = `the display entry ${displayEntryName(tables, entry)}`
      if (tables.displayOpen[entry] === 0) throw fail(name, 'is not open')
      if (entry % tables.grammarStateCount === errorState) throw fail(name, 'is of the grammar state error, whose entries keep today\'s kinds')
      if (ruleOfDisplayEntry[entry] !== -1) throw fail(name, setBy(ruleOfDisplayEntry[entry]!))
      return name
    }
    rule.cells({
      lexerIsFree: (state, characterClass) => {
        const cell = lexerCell(state, characterClass)
        return tables.lexerOpen[cell] === 1 && ruleOfLexerCell[cell] === -1
      },
      lexerChoice: (state, characterClass) => {
        const cell = lexerCell(state, characterClass)
        return {next: lexerStateNames[tables.lexerNext[cell]!]!, event: eventNames[tables.lexerEvent[cell]!]!}
      },
      lexer: (state, characterClass, next, event) => {
        const cell = lexerCell(state, characterClass)
        const name = freeLexer(cell)
        const nextIndex = indexIn(lexerStateNames, next, 'tokenizer state')
        const eventIndex = indexIn(eventNames, event, 'event')
        if (tables.lexerNext[cell] === nextIndex && tables.lexerEvent[cell] === eventIndex) throw fail(name, `holds ${lexerChoiceName(tables, cell)} today`)
        tables.lexerNext[cell] = nextIndex
        tables.lexerEvent[cell] = eventIndex
        ruleOfLexerCell[cell] = ruleIndex
        lexerCellsOfRule[ruleIndex]!++
      },
      lexerAsToday: (state, characterClass, next, event) => {
        const cell = lexerCell(state, characterClass)
        const name = freeLexer(cell)
        if (tables.lexerNext[cell] !== lexerStateNames.indexOf(next) || tables.lexerEvent[cell] !== eventNames.indexOf(event)) throw fail(name, `holds ${lexerChoiceName(tables, cell)} today`)
        ruleOfLexerCell[cell] = ruleIndex
        keptAsTodayOfRule[ruleIndex]!++
      },
      grammarIsFree: (state, token, context) => {
        const cell = grammarCell(state, token, context)
        return tables.grammarOpen[cell] === 1 && kept[cell] === 0 && ruleOfGrammarCell[cell] === -1
      },
      grammarChoice: (state, token, context) => {
        const cell = grammarCell(state, token, context)
        return {next: grammarStateNames[tables.grammarNext[cell]!]!, action: actionNames[tables.grammarAction[cell]!]!}
      },
      grammar: (state, token, context, next, action) => {
        const cell = grammarCell(state, token, context)
        const name = freeGrammar(cell)
        const nextIndex = indexIn(grammarStateNames, next, 'grammar state')
        const actionIndex = indexIn(actionNames, action, 'stack action')
        if (tables.grammarNext[cell] === nextIndex && tables.grammarAction[cell] === actionIndex) throw fail(name, `holds ${grammarChoiceName(tables, cell)} today`)
        tables.grammarNext[cell] = nextIndex
        tables.grammarAction[cell] = actionIndex
        ruleOfGrammarCell[cell] = ruleIndex
        grammarCellsOfRule[ruleIndex]!++
      },
      grammarAsToday: (state, token, context, next, action) => {
        const cell = grammarCell(state, token, context)
        const name = freeGrammar(cell)
        if (tables.grammarNext[cell] !== grammarStateNames.indexOf(next) || tables.grammarAction[cell] !== actionNames.indexOf(action)) throw fail(name, `holds ${grammarChoiceName(tables, cell)} today`)
        ruleOfGrammarCell[cell] = ruleIndex
        keptAsTodayOfRule[ruleIndex]!++
      },
      displayIsFree: (event, state) => {
        const entry = displayEntry(event, state)
        return tables.displayOpen[entry] === 1 && entry % tables.grammarStateCount !== errorState && ruleOfDisplayEntry[entry] === -1
      },
      displayChoice: (event, state) => displayKindNames[tables.display[displayEntry(event, state)]!]!,
      display: (event, state, kind) => {
        const entry = displayEntry(event, state)
        const name = freeDisplay(entry)
        const kindIndex = indexIn(displayKindNames, kind, 'display kind')
        if (tables.display[entry] === kindIndex) throw fail(name, `holds ${kind} today`)
        tables.display[entry] = kindIndex
        ruleOfDisplayEntry[entry] = ruleIndex
        displayEntriesOfRule[ruleIndex]!++
      },
      displayAsToday: (event, state, kind) => {
        const entry = displayEntry(event, state)
        const name = freeDisplay(entry)
        if (tables.display[entry] !== displayKindNames.indexOf(kind)) throw fail(name, `holds ${displayKindNames[tables.display[entry]!]} today`)
        ruleOfDisplayEntry[entry] = ruleIndex
        keptAsTodayOfRule[ruleIndex]!++
      },
    })
  }
  checkTables(tables)
  return {tables, ruleOfLexerCell, ruleOfGrammarCell, ruleOfDisplayEntry, lexerCellsOfRule, grammarCellsOfRule, displayEntriesOfRule, keptAsTodayOfRule}
}

// The rules as text: per rule its name, how many cells it sets, its reason and its example.
export function describeRules<ClassName extends string>(handwritten: Handwritten, rules: readonly Rule<ClassName>[]): string {
  const lines: string[] = []
  const sum = (counts: readonly number[]) => counts.reduce((total, count) => total + count, 0)
  rules.forEach((rule, index) => {
    const parts = [
      handwritten.lexerCellsOfRule[index]! > 0 ? `${handwritten.lexerCellsOfRule[index]} tokenizer cells` : '',
      handwritten.grammarCellsOfRule[index]! > 0 ? `${handwritten.grammarCellsOfRule[index]} grammar cells` : '',
      handwritten.displayEntriesOfRule[index]! > 0 ? `${handwritten.displayEntriesOfRule[index]} display entries` : '',
      handwritten.keptAsTodayOfRule[index]! > 0 ? `${handwritten.keptAsTodayOfRule[index]} open cells kept as today` : '',
    ].filter(part => part !== '')
    lines.push(`${String(index + 1).padStart(2)}. ${rule.name}: ${parts.join(', ')}`)
    lines.push(`    ${rule.reason}`)
    lines.push(`    e.g. ${rule.example}`)
  })
  lines.push(`${rules.length} rules set ${sum(handwritten.lexerCellsOfRule)} tokenizer cells, ${sum(handwritten.grammarCellsOfRule)} grammar cells and ${sum(handwritten.displayEntriesOfRule)} display entries.`)
  return lines.join('\n')
}
