// Scores several saved tables next to today's and prints one row per tables, as a markdown table: the README's table
// of scores comes from this command.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/compare.ts [--split validation] [--scratch <folder>] <name>=<tables.json> ...
// e.g. bun lab/recovery-parser/learn/compare.ts hand-written=$RECOVERY_SCRATCH/handwritten/tables.json
// --split takes one split or several with commas. The test split is read only when --split names it.
//
// The columns: the cells that differ from today's tables, and how many of those a code point of the scored samples
// reads. The percentages of the labeled code points at or after the first damage with all three labels right, the
// display kind right, the depth right and the container right, and of the samples that are right as a whole. Then
// what those do not show, see score.ts: the percentage of the code points that the damage added that are shown as an
// error, the percentage of the samples that show an error at or after the first damage, and the number of code points
// that are shown as past the end. The first line says how high any tables can get.
import {cacheFolderOf, loadStandardSamples, optionOf, splitNames} from './data.ts'
import type {Split} from '../samples.ts'
import {asIsTables, differencesOf, loadTables} from './recovery-tables.ts'
import {cellsReadBy, scoreTables, sharesOf} from './score.ts'

const splits = (optionOf('--split') ?? 'validation').split(',') as Split[]
for (const split of splits) if (!splitNames.includes(split)) throw new Error(`--split takes ${splitNames.join(', ')}, or several of them with commas, and got ${split}`)
const samples = loadStandardSamples(cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH']))
const named = process.argv.slice(2).filter(argument => !argument.startsWith('--') && argument.includes('=')).map(argument => ({name: argument.slice(0, argument.indexOf('=')), file: argument.slice(argument.indexOf('=') + 1)}))
const asIs = asIsTables()
const percent = (share: number, digits = 1) => Number.isNaN(share) ? '-' : (100 * share).toFixed(digits)

const lines: string[] = []
for (const {name, tables} of [{name: 'the parser as it is', tables: asIs}, ...named.map(({name, file}) => ({name, tables: loadTables(file).tables}))]) {
  const row = scoreTables(tables, samples, {splits, breakdowns: false}).rows[0]!
  const shares = sharesOf(row)
  const differences = differencesOf(asIs, tables)
  const read = cellsReadBy(tables, samples, splits)
  const differencesRead = differences.filter(difference => (difference.table === 'tokenizer' ? read.lexer : read.grammar)[difference.cell] === 1).length
  if (lines.length === 0) {
    console.log(`Split${splits.length === 1 ? '' : 's'} ${splits.join(', ')}: ${row.samples} broken samples, ${row.nothingToRecover} of them with nothing to recover, ${row.codePoints} labeled code points at or after the first damage.`)
    console.log(`${row.wrongBeforeError} of those code points come before the first error and are wrong today, in ${row.samplesWrongBeforeError} samples. No choice of the open cells changes them, so no tables pass ${percent(shares.ceiling, 2)}% of all three and ${percent(shares.wholeCeiling)}% of whole samples.`)
    console.log('')
    lines.push('| tables | cells that differ from today\'s | of those, read by a scored sample | all three | display kind | depth | container | whole samples | added code points shown as an error | samples that show an error | code points shown as past the end |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  }
  lines.push(`| ${name} | ${differences.length} | ${differencesRead} | ${percent(shares.allThree, 2)} | ${percent(shares.kind, 2)} | ${percent(shares.depth, 2)} | ${percent(shares.container, 2)} | ${percent(shares.whole, 2)} | ${percent(shares.addedAsError)} | ${percent(shares.showsError)} | ${row.shownAsPastEnd} |`)
}
console.log(lines.join('\n'))
