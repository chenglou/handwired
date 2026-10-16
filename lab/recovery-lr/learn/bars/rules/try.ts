// Compares hand-made variants of a rule by their scores: the cells of some states and some terminals get one
// choice after another, in the tables of the rules as they are, and each variant is scored on the train and the
// validation samples with a count of its own. No script picks a choice: the command prints one row per variant.
//
//   bun lab/recovery-lr/learn/bars/rules/try.ts --states 35,32,37 --terminals THEN --choices "skip|pop|insert OR"
//     [--copies both|first|later] [--then "60,THEN=insert IF" --then "22,THEN=insert IDENT"]
// --states and --terminals take numbers and names, or the names of the groups of rules.ts, e.g. expressionExpected
// and closingBrackets. A choice is written as recovery-tables.ts names it, e.g. "skip", "pop", "stop",
// "insert THEN", "read as EQ", "end atom after 2", or "end atom" for the item of that nonterminal, "reduce" for
// bison's default reduction, and "as it is" for what the rules hold now. A state whose list has no such choice
// keeps what it holds. --then sets more cells in every variant but "as it is", for a variant that needs
// several cells at once.
import {loadPacked} from '../../data.ts'
import {numberOf, optionOf, refuseUnknownOptions, standardTrainCount, standardValidationCount} from '../../options.ts'
import {type RecoveryTables, bison, bisonTerminalCount, cellOf, choiceName, choicesOf, copyTables, kindEndEarly, kindOfChoice, kindReduce} from '../../recovery-tables.ts'
import {scoreTables, sharesOf} from '../../score.ts'
import {displayEntriesByCount} from '../../search/count.ts'
import {layoutOfTheRecipe, stateGroups, tablesOfRules, terminalGroups} from './rules.ts'

refuseUnknownOptions('try.ts', ['--states', '--terminals', '--choices', '--copies', '--then', '--train', '--validation'])
const layout = layoutOfTheRecipe()
const statesOf = (text: string): number[] => text.split(',').flatMap(part => stateGroups[part.trim()] ?? [Number(part)])
const terminalsOf = (text: string): number[] => text.split(',').flatMap(part => terminalGroups[part.trim()] ?? [part.trim()]).map(name => {
  const ofBison = bison.symbolNames.indexOf(name)
  if (ofBison !== -1 && ofBison < bisonTerminalCount) return ofBison
  const added = layout.addedTerminals.findIndex(terminal => terminal.name === name)
  if (added === -1) throw new Error(`no terminal ${name}`)
  return bisonTerminalCount + added
})
// The choice of a cell's list that a name stands for, or undefined when the list has none.
function choiceOfName(tables: RecoveryTables, cell: number, name: string): number | undefined {
  const list = choicesOf(tables, cell)
  if (name === 'reduce') return list.find(choice => kindOfChoice(choice) === kindReduce)
  const exact = list.find(choice => choiceName(choice) === name)
  if (exact !== undefined) return exact
  if (name.startsWith('end ')) {
    const ends = list.filter(choice => kindOfChoice(choice) === kindEndEarly && choiceName(choice).startsWith(`${name} after`))
    // Of several items of one nonterminal, the one with the most symbols before its dot.
    return ends.sort((left, right) => choiceName(right).localeCompare(choiceName(left)))[0]
  }
  return undefined
}
const copiesOf = (copies: string): number[] => copies === 'first' ? [1] : copies === 'later' ? [0] : [0, 1]

const states = statesOf(optionOf('--states') ?? ''), terminals = terminalsOf(optionOf('--terminals') ?? '')
const copies = copiesOf(optionOf('--copies') ?? 'both')
const variants = (optionOf('--choices') ?? '').split('|').map(name => name.trim())
const more = process.argv.flatMap((argument, index) => argument === '--then' ? [process.argv[index + 1]!] : []).map(text => {
  const [cellText, choice] = text.split('=')
  const [stateText, terminalText] = cellText!.split(',')
  return {states: statesOf(stateText!), terminals: terminalsOf(terminalText!), choice: choice!.trim()}
})
const train = loadPacked('train', numberOf('--train', standardTrainCount), layout), validation = loadPacked('validation', numberOf('--validation', standardValidationCount), layout)
const ofRules = tablesOfRules().tables
console.log(`${states.length} states × ${terminals.length} terminals × ${copies.length} copies. Per variant: all three / whole / stack on train, then on validation, and the cells that got the choice.`)
for (const variant of ['as it is', ...variants.filter(name => name !== 'as it is')]) {
  const tables = copyTables(ofRules)
  let cellsSet = 0
  const put = (state: number, terminal: number, copy: number, name: string) => {
    const cell = cellOf(tables, state, terminal, copy)
    if (tables.open[cell] !== 1) return
    const choice = choiceOfName(tables, cell, name)
    if (choice === undefined) return
    tables.choice[cell] = choice
    cellsSet++
  }
  if (variant !== 'as it is') {
    for (const state of states) for (const terminal of terminals) for (const copy of copies) put(state, terminal, copy, variant)
    for (const {states: moreStates, terminals: moreTerminals, choice} of more) for (const state of moreStates) for (const terminal of moreTerminals) for (const copy of [0, 1]) put(state, terminal, copy, choice)
  }
  const counted = displayEntriesByCount(tables, train).tables
  const row = (shares: ReturnType<typeof sharesOf>): string => `${shares.allThree.toFixed(2)} / ${shares.whole.toFixed(2)} / ${shares.stack.toFixed(2)}`
  console.log(`${variant.padEnd(22)} train ${row(sharesOf(scoreTables(counted, train).score))}   validation ${row(sharesOf(scoreTables(counted, validation).score))}   ${cellsSet} cells`)
}
