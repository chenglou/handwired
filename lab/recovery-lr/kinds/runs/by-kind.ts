// Prints one markdown table with a line per kind of mistake: the validation samples of the mixed set that have that
// kind alone, scored by two bars and by row 10 of the recipe (the training, then the search, then the count) as it
// was trained on the dataset's train split and on the mixed train split. The number is the share of the scored code
// points that have all three right, as a percentage.
//
// Run from the repo root: bun lab/recovery-lr/kinds/runs/by-kind.ts --mixed <folder of the mixed runs> --neutral <folder of the runs on the dataset>
// It reads the validation split only, and no held-back set.
import {readdirSync} from 'node:fs'
import {join} from 'node:path'
import {rulesBar} from '../../learn/bars/rules/bar.ts'
import {yaccErrorProductions} from '../../learn/bars/yacc/bar.ts'
import {packSamples} from '../../learn/data.ts'
import {optionOf, refuseUnknownOptions, standardValidationCount} from '../../learn/options.ts'
import {type RecoveryTables, loadTables} from '../../learn/recovery-tables.ts'
import {describeSpread, tablesFileNameOf} from '../../learn/runs/runs.ts'
import {scoreOutputs, scoreTables, sharesOf} from '../../learn/score.ts'
import type {Sample} from '../../sample.ts'
import {kinds} from '../kinds.ts'
import {eachMixedSample} from '../mixed.ts'

refuseUnknownOptions('kinds/runs/by-kind.ts', ['--mixed', '--neutral'])
const mixedFolder = optionOf('--mixed'), neutralFolder = optionOf('--neutral')
if (mixedFolder === undefined || neutralFolder === undefined) throw new Error('kinds/runs/by-kind.ts needs --mixed and --neutral, the folders of the saved runs')
const row = 10
const tablesOf = (folder: string): RecoveryTables[] => readdirSync(folder).flatMap(name => {
  const match = /^row-(\d+)\.seed-(\d+)\.tables\.json$/.exec(name)
  return match !== null && Number(match[1]) === row ? [Number(match[2])] : []
}).sort((left, right) => left - right).map(seed => loadTables(join(folder, tablesFileNameOf(row, seed))).tables)
const onDataset = tablesOf(neutralFolder), onMixed = tablesOf(mixedFolder)

const samplesOfKind = new Map<string, Sample[]>(kinds.map(kind => [kind.name, []]))
const twoKinds: Sample[] = []
for (const mixed of eachMixedSample('validation', standardValidationCount)) {
  if (mixed.half !== 'kinds') continue
  if (mixed.sample.edits.length === 1) samplesOfKind.get(mixed.sample.edits[0]!)!.push(mixed.sample)
  else twoKinds.push(mixed.sample)
}
const rules = rulesBar()
const allThree = (samples: readonly Sample[], tables: readonly RecoveryTables[]): string => describeSpread(tables.map(tablesOfSeed => sharesOf(scoreTables(tablesOfSeed, packSamples(samples, tablesOfSeed)).score).allThree), 1)
console.log(`The samples of the mixed validation split that have one kind alone, and in the last line the ones with two kinds. Row ${row} of the recipe, ${onDataset.length} seeds trained on the dataset's train split and ${onMixed.length} on the mixed train split: the mean with the lowest and the highest. Every number but the first two columns is the percentage of the scored code points with all three right.`)
console.log('')
console.log(`| kind | samples | scored code points | bar: yacc error productions | bar: hand-written rules | row ${row} trained on the dataset's train split | row ${row} trained on the mixed train split |`)
console.log('| --- | --- | --- | --- | --- | --- | --- |')
for (const [name, samples] of [...samplesOfKind, ['two kinds', twoKinds] as const]) {
  if (samples.length === 0) continue
  const yacc = scoreOutputs(samples, yaccErrorProductions)
  console.log(`| ${name} | ${samples.length} | ${yacc.scoredCodePoints} | ${sharesOf(yacc).allThree.toFixed(1)} | ${sharesOf(scoreOutputs(samples, rules)).allThree.toFixed(1)} | ${allThree(samples, onDataset)} | ${allThree(samples, onMixed)} |`)
}
