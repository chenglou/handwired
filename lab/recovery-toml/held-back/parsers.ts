// The parsers that a held-back set is scored with, so that both sets show the same rows:
//
// - The parser as it is: today's tables.
// - One rule without any training: after an error, the parser as it is starts anew at the next line, see
//   ../learn/restart-at-next-line.ts. Most of TOML is one entry or one header per line, so this rule alone gets most
//   of what a recovery can get. Trained tables are read by what they add to this row, per kind of mistake and in
//   whole samples.
// - Tables of a file that ../learn/ saved, e.g. the recipe's. They are tables of the recovery experiment, which can
//   have added classes and the bit "first on its line", so only the exact parser of ../learn/recovery-parser.ts runs
//   them.
//
// The first two read no trained table, so their rows are the same before and after a training, and a command prints
// them at any time. A score of tables in which a cell differs from today's is a final number: a command only prints
// it with the environment variable RECOVERY_FINAL set to yes, as the machinery does for the test split.
import {requireFinal} from '../learn/data.ts'
import {type RecoveryTrace, codePointsOf, runRecoveryParser} from '../learn/recovery-parser.ts'
import {type RecoveryTables, asIsTables, checkTables, differencesOf, loadTablesOfThisDataset} from '../learn/recovery-tables.ts'
import {runRestartAtNextLine} from '../learn/restart-at-next-line.ts'

// What a parser shows for a broken text: per code point the display kind, the depth after it and the container after it.
export type Shown = Pick<RecoveryTrace, 'displayKind' | 'depthAfter' | 'containerAfter'>
export type Parser = {name: string, show: (broken: string) => Shown}

// The parser that runs some tables of the recovery experiment. Throws when the tables break the ground rules, e.g.
// when a frozen cell is changed.
export function parserOfTables(name: string, tables: RecoveryTables): Parser {
  checkTables(tables)
  return {name, show: broken => runRecoveryParser(codePointsOf(broken).codePoints, false, tables)}
}

export const parserAsItIs: Parser = parserOfTables('the parser as it is', asIsTables())
export const restartAtNextLine: Parser = {name: 'anew at the next line after an error', show: broken => runRestartAtNextLine(codePointsOf(broken).codePoints)}

// The parsers of a command: the parser as it is, the rule, and the tables of each file that `--tables <file.json>`
// names. A file whose tables differ from today's in a cell needs RECOVERY_FINAL, and a file that was saved with
// another dataset is refused.
export function parsersOfCommand(commandArguments: readonly string[]): Parser[] {
  const parsers = [parserAsItIs, restartAtNextLine]
  commandArguments.forEach((argument, index) => {
    if (argument !== '--tables') return
    const file = commandArguments[index + 1]
    if (file === undefined) throw new Error('--tables needs a file of tables that learn/ saved, e.g. --tables <scratch>/recipe/seed-1.primary.tables.json')
    const {tables} = loadTablesOfThisDataset(file)
    if (differencesOf(asIsTables(), tables).length > 0) requireFinal(`A score of the tables of ${file} on a held-back set`)
    parsers.push(parserOfTables(`the tables of ${file.split('/').at(-1)}`, tables))
  })
  return parsers
}
