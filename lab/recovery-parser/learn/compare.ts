// Scores several saved tables next to today's and prints one row per tables, as a markdown table: the README's table
// of scores comes from this command.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/compare.ts [--split validation] [--to 60000] [--scratch <folder>] <name>=<tables.json>[,<base.json>] ...
// e.g. bun lab/recovery-parser/learn/compare.ts hand-written=$RECOVERY_SCRATCH/handwritten/tables.json
// --split takes train, validation or both with a comma. After the tables' file, a comma and a second file name the
// tables that the run started from, e.g. search=<search.json>,<votes.json> for a search from the votes.
//
// The columns:
// - "cells changed against the base": the cells in which the tables differ from the tables that their run started
//   from, i.e. what the run changed. Without a base file it is the count against today's tables when the tables have
//   today's layout, and "no base given" when they have added structure, since the count against today's parser is
//   then another number, see cellCountsOf in score.ts.
// - "cells that differ from today's parser", and how many of those a code point of the scored samples reads.
// - The percentages of the scored code points with every scored label right, the display kind right, the depth
//   right and the container right, and of the samples that are right as a whole.
// - What those do not show, see score.ts: the percentage of the code points that the damage added that are shown as
//   an error, the percentage of the samples that show an error at or after the first damage, and the number of code
//   points that are shown as past the end.
// The first lines say what the dataset's bound for the plain table parser is on these samples. A file of tables that
// was saved with another version of the dataset is scored all the same, after a line that starts with "Note:".
import {cacheFolderOf, loadSamples, optionOf, refuseUnknownOptions, splitsOfOption, standardRange} from './data.ts'
import {type RecoveryTables, asIsTables, differencesOf, loadTablesForReport, today} from './recovery-tables.ts'
import {cellsReadBy, isRead, scoreTables, sharesOf} from './score.ts'

refuseUnknownOptions('compare.ts', ['--split', '--to', '--scratch'])
const splits = splitsOfOption('compare.ts')
const samples = loadSamples(standardRange.seed, standardRange.from, Number(optionOf('--to') ?? standardRange.to), cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH']))
const named = process.argv.slice(2).filter(argument => !argument.startsWith('--') && argument.includes('=')).map(argument => {
  const [tablesFile, baseFile] = argument.slice(argument.indexOf('=') + 1).split(',')
  return {name: argument.slice(0, argument.indexOf('=')), tables: loadTablesForReport(tablesFile!).tables, base: baseFile === undefined ? undefined : loadTablesForReport(baseFile).tables}
})
const asIs = asIsTables()
const percent = (share: number, digits = 1) => Number.isNaN(share) ? '-' : (100 * share).toFixed(digits)
// Tables with today's layout: no added state, no added class, no bit, no open entry of the display table.
const hasTodaysLayout = (tables: RecoveryTables) => tables.lexerStateCount === today.lexerStateCount && tables.grammarStateCount === today.grammarStateCount && tables.addedClasses.length === 0 && tables.contextCount === today.contextCount && !tables.displayOpen.includes(1)

const lines: string[] = []
const rows: {name: string, tables: RecoveryTables, base: RecoveryTables | undefined}[] = [{name: 'the parser as it is', tables: asIs, base: asIs}, ...named]
for (const {name, tables, base} of rows) {
  const row = scoreTables(tables, samples, {splits, breakdowns: false}).rows[0]!
  const shares = sharesOf(row)
  const differences = differencesOf(asIs, tables)
  const changedAgainstBase = base !== undefined ? String(differencesOf(base, tables).length) : hasTodaysLayout(tables) ? `${differences.length}, against today's tables` : 'no base given'
  const read = cellsReadBy(tables, samples, splits)
  const differencesRead = differences.filter(difference => isRead(read, difference)).length
  if (lines.length === 0) {
    console.log(`Dataset ${samples.datasetKey}, split${splits.length === 1 ? '' : 's'} ${splits.join(', ')}: ${row.samples} broken samples, ${row.nothingToRecover} of them with nothing to recover, ${row.codePoints} scored code points.`)
    console.log(`The dataset's bound for the plain table parser, whose depth follows the tokenizer's events: ${percent(shares.plainBound, 2)}% of all three and ${percent(shares.plainBoundWhole, 2)}% of whole samples. The parser here has a stack action per grammar cell and a real stack, so its reach is larger.`)
    console.log('')
    lines.push('| tables | cells changed against the base | cells that differ from today\'s parser | of those, read by a scored sample | all three | display kind | depth | container | whole samples | added code points shown as an error | samples that show an error | code points shown as past the end |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  }
  lines.push(`| ${name} | ${changedAgainstBase} | ${differences.length} | ${differencesRead} | ${percent(shares.allThree, 2)} | ${percent(shares.kind, 2)} | ${percent(shares.depth, 2)} | ${percent(shares.container, 2)} | ${percent(shares.whole, 2)} | ${percent(shares.addedAsError)} | ${percent(shares.showsError)} | ${row.shownAsPastEnd} |`)
}
console.log(lines.join('\n'))
