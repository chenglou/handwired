// The one script that scores tables on the test split. It is for final numbers, after every choice between tables
// is made on the validation split. It refuses to run unless the environment variable RECOVERY_FINAL is `yes`:
//   RECOVERY_FINAL=yes bun lab/recovery-parser/learn/arms/final.ts <name>=<tables.json> ...
//
// The test split holds four kinds of damage and one template that training never sees, and about a half of its
// samples have one of them. So one number for "the test split" means little, and the script prints four rows per
// tables: nothing held out, a held-out kind on a template that training has, kinds that training has on the
// held-out template, and both. The row of the whole test split is there to add them up, not to report alone.
// The baselines of harness.ts are scored next to the named tables, so that every row is read against them.
//
// The samples of the test split go to a cache file of their own, which only a run with RECOVERY_FINAL reads.
import {cacheFolderOf, loadSamples, requireFinal, standardRange} from '../data.ts'
import {type RecoveryTables, loadTables} from '../recovery-tables.ts'
import {heldOutRowNames, rowOf, scoreTables, sharesOf} from '../score.ts'
import {baselineTables} from './harness.ts'

if (import.meta.main) {
  requireFinal('arms/final.ts')
  const named: {name: string, tables: RecoveryTables}[] = process.argv.slice(2).filter(argument => !argument.startsWith('--') && argument.includes('=')).map(argument => (
    {name: argument.slice(0, argument.indexOf('=')), tables: loadTables(argument.slice(argument.indexOf('=') + 1)).tables}))
  const samples = loadSamples(standardRange.seed, standardRange.from, standardRange.to, cacheFolderOf(), true)
  const percent = (share: number) => Number.isNaN(share) ? '-' : (100 * share).toFixed(2)
  const lines = [
    '| tables | samples of the test split | broken samples | scored code points | all three | display kind | depth | container | whole samples | bound of the plain table parser, all three |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const {name, tables} of [...baselineTables(), ...named]) {
    const score = scoreTables(tables, samples, {splits: ['test']})
    for (const rowName of [...heldOutRowNames, 'all']) {
      const row = rowOf(score, rowName)
      if (row === undefined) continue
      const shares = sharesOf(row)
      lines.push(`| ${name} | ${rowName === 'all' ? 'the whole test split, to add up the four rows above' : rowName} | ${row.samples} | ${row.codePoints} | ${percent(shares.allThree)} | ${percent(shares.kind)} | ${percent(shares.depth)} | ${percent(shares.container)} | ${percent(shares.whole)} | ${percent(shares.plainBound)} |`)
    }
  }
  console.log(`Dataset ${samples.datasetKey}, the test split of the standard set (seed ${standardRange.seed}, indexes ${standardRange.from} to ${standardRange.to - 1}), the exact parser. Percentages of the scored code points, and of the samples with something to recover for "whole samples".`)
  console.log('')
  console.log(lines.join('\n'))
}
