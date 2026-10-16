// Scores tables on the test split. It is for final numbers, after every choice between tables is made on the
// validation split. It refuses to run unless the environment variable RECOVERY_FINAL is `yes`:
//   RECOVERY_FINAL=yes bun lab/recovery-parser/learn/arms/final.ts <name>=<tables.json> ...
// It is not the one script that reads the test split: the final scoring of the experiment is ../final/run.ts, which
// also scores the written set, and ../final/show.ts shows single samples.
//
// The test split holds four kinds of damage and one template that training never sees, and about a half of its
// samples have one of them. So one number for "the test split" means little, and the script prints four rows per
// tables: nothing held out, a held-out kind on a template that training has, kinds that training has on the
// held-out template, and both. The row of the whole test split is there to add them up, not to report alone.
// The baselines of harness.ts are scored next to the named tables, so that every row is read against them.
//
// What the script refuses, before it loads a sample:
// - A file of tables that was not saved with the dataset as it is now, see otherDatasetOf in ../recovery-tables.ts.
//   A later commit of the dataset can move a sample from the train split to the test split, so tables that were
//   trained before it may have been trained on samples that are test samples now.
// - A run without RECOVERY_SCRATCH. Every run appends a line to <RECOVERY_SCRATCH>/arms/final-runs.log before it
//   loads a sample: the time, the dataset's key, and the name, the path and a hash of each file of tables. So the
//   folder holds which tables were scored on the test split, and when.
//
// The samples of the test split go to a cache file of their own, which only a run with RECOVERY_FINAL reads.
import {appendFileSync, mkdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import type {Split} from '../../samples.ts'
import {type Samples, cacheFolderOf, datasetKey, loadSamples, refuseUnknownOptions, requireFinal, standardRange} from '../data.ts'
import {type RecoveryTables, loadTablesOfThisDataset} from '../recovery-tables.ts'
import {heldOutRowNames, rowOf, scoreTables, sharesOf} from '../score.ts'
import {baselineTables} from './harness.ts'

export type NamedTables = {name: string, file: string, tables: RecoveryTables, hash: string}

// The tables that the command's arguments name, each as <name>=<tables.json>. Throws for an argument of another
// form, and for a file that was not saved with the dataset as it is now.
export function namedTablesOf(parameters: readonly string[]): NamedTables[] {
  return parameters.map(parameter => {
    const at = parameter.indexOf('=')
    if (at <= 0 || at === parameter.length - 1) throw new Error(`arms/final.ts takes <name>=<tables.json>, and got ${JSON.stringify(parameter)}`)
    const file = parameter.slice(at + 1)
    return {name: parameter.slice(0, at), file, tables: loadTablesOfThisDataset(file).tables, hash: Bun.hash(readFileSync(file)).toString(16)}
  })
}

// The line that a run appends to the log of the runs on the test split.
export const logLineOf = (time: Date, keyOfTheDataset: string, named: readonly NamedTables[]) =>
  JSON.stringify({time: time.toISOString(), datasetKey: keyOfTheDataset, tables: named.map(({name, file, hash}) => ({name, file, hash}))})

// The report as lines: per tables, a row for each of the four ways a sample can be held out, and a row for the
// whole split. The baselines come first.
//
// `split` is the test split. check.ts passes the validation split, with validation samples whose held-out bits it
// made up, so that this code is run by a check without a test sample.
export function describeFinal(samples: Samples, named: readonly {name: string, tables: RecoveryTables}[], split: Split = 'test'): string[] {
  const percent = (share: number) => Number.isNaN(share) ? '-' : (100 * share).toFixed(2)
  const lines = [
    `| tables | samples of the ${split} split | broken samples | scored code points | all three | display kind | depth | container | whole samples | bound of the plain table parser, all three |`,
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ]
  for (const {name, tables} of [...baselineTables(), ...named]) {
    const score = scoreTables(tables, samples, {splits: [split]})
    for (const rowName of [...heldOutRowNames, 'all']) {
      const row = rowOf(score, rowName)
      if (row === undefined) continue
      const shares = sharesOf(row)
      lines.push(`| ${name} | ${rowName === 'all' ? `the whole ${split} split, to add up the four rows above` : rowName} | ${row.samples} | ${row.codePoints} | ${percent(shares.allThree)} | ${percent(shares.kind)} | ${percent(shares.depth)} | ${percent(shares.container)} | ${percent(shares.whole)} | ${percent(shares.plainBound)} |`)
    }
  }
  return lines
}

if (import.meta.main) {
  requireFinal('arms/final.ts')
  refuseUnknownOptions('arms/final.ts', [])
  const scratch = process.env['RECOVERY_SCRATCH']
  if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to a folder outside the repo: every run of arms/final.ts appends a line to <RECOVERY_SCRATCH>/arms/final-runs.log')
  const named = namedTablesOf(process.argv.slice(2))
  // The line is written before a sample is loaded, so a run that fails later is in the log too.
  const logFolder = join(scratch, 'arms')
  mkdirSync(logFolder, {recursive: true})
  appendFileSync(join(logFolder, 'final-runs.log'), `${logLineOf(new Date(), datasetKey(), named)}\n`)
  const samples = loadSamples(standardRange.seed, standardRange.from, standardRange.to, cacheFolderOf(), true)
  console.log(`Dataset ${samples.datasetKey}, the test split of the standard set (seed ${standardRange.seed}, indexes ${standardRange.from} to ${standardRange.to - 1}), the exact parser. Percentages of the scored code points, and of the samples with something to recover for "whole samples".`)
  console.log('For the dataset\'s hand rules and for the hand-written rules the test split is not unseen: the hand rules were chosen by statistics over every split, and the hand-written rules were written with samples of every split of the old snapshot in view.')
  console.log('')
  console.log(describeFinal(samples, named).join('\n'))
}
