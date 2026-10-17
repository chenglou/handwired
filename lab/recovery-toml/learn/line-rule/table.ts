// Prints the table of README.md: every row on the validation split of the standard set, in all three, in whole
// samples, and in the share of the header names after an error that are right. The rows of this folder come from the
// tables that run.ts saved, the rows beside them from today's tables, from the one rule, from the hand-written rules
// of ../handwritten/rules.ts and from the saved runs of ../runs/, which are in the folder `neutral` beside the
// folder `line-rule` of this folder's runs.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-toml/learn/line-rule/table.ts
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {loadSamples, standardRange, validationPart} from '../data.ts'
import {handwrittenTables} from '../handwritten/rules.ts'
import {asIsTables, loadTables} from '../recovery-tables.ts'
import {type Parser, describeSpread, parserOfTables, restartAtNextLine, savedRunsOf, scoreRowsOf} from '../runs/runs.ts'
import {sharesOf} from '../score.ts'
import {folderOf, headerNamesAfterAnError} from './run.ts'

const range = standardRange()
const validation = validationPart(loadSamples(range.seed, range.from, range.to))

type Measured = {allThree: number, whole: number, headerNames: number}
function measure(parser: Parser): Measured {
  const shares = sharesOf(scoreRowsOf(parser, validation)[0]!)
  const headers = headerNamesAfterAnError(parser, validation)
  return {allThree: 100 * shares.allThree, whole: 100 * shares.whole, headerNames: 100 * headers.allRight / headers.codePoints}
}

const lines: string[] = ['| | seeds | all three | whole samples | header names after an error |', '| --- | --- | --- | --- | --- |']
function addRow(name: string, seeds: string, measured: readonly Measured[]) {
  if (measured.length === 0) {
    lines.push(`| ${name} | none saved | - | - | - |`)
    return
  }
  lines.push(`| ${name} | ${seeds} | ${describeSpread(measured.map(one => one.allThree))} | ${describeSpread(measured.map(one => one.whole))} | ${describeSpread(measured.map(one => one.headerNames))} |`)
}
// A row of saved runs: the tables of every record of `row` in `folder`.
function addSavedRuns(name: string, folder: string, row: number) {
  const runs = savedRunsOf(folder).filter(run => run.record.row === row)
  addRow(name, runs.map(run => run.record.seed).join(', '), runs.map(run => measure(parserOfTables(loadTables(run.tablesFile).tables))))
}
function addSavedTables(name: string, file: string) {
  addRow(name, 'no training', existsSync(file) ? [measure(parserOfTables(loadTables(file).tables))] : [])
}

const lineRule = join(folderOf('fixed'), '..')
const neutral = join(lineRule, '..', 'neutral')
addRow('the parser as it is', 'no training', [measure(parserOfTables(asIsTables()))])
addRow('the one rule: anew at the next line after an error', 'no training', [measure(restartAtNextLine)])
addSavedRuns('row 4: the recipe\'s training, then the count', neutral, 4)
addRow('the 39 hand-written rules', 'no training', [measure(parserOfTables(handwrittenTables().tables))])
addSavedRuns('row 5: the recipe\'s training, the search, then the count', neutral, 5)
addSavedRuns('row 6: the search and the count without the training', neutral, 6)
addSavedTables('(a) the base with the cells of the line rule, no training', join(lineRule, 'base', 'base.tables.json'))
addSavedTables('(a) with the count', join(lineRule, 'base', 'base-with-count.tables.json'))
for (const waitingCells of ['fixed', 'trainable'] as const) {
  addSavedRuns(`(b) the line rule, the training, then the count; waiting cells ${waitingCells}`, folderOf(waitingCells), 4)
  addSavedRuns(`(c) the same with the search before the count; waiting cells ${waitingCells}`, folderOf(waitingCells), 5)
}
console.log(lines.join('\n'))
