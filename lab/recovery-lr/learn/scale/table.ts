// The table of the README: every record that run.ts saved to a folder, one row per setting, with the mean of the
// seeds and the lowest and the highest in brackets.
//
// Run from the repo root:
//   bun lab/recovery-lr/learn/scale/table.ts --folder <the folder of the records>
import {readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {describeSpread} from '../runs/runs.ts'
import {sharesOf} from '../score.ts'
import type {ScaleRecord} from './run.ts'

refuseUnknownOptions('scale/table.ts', ['--folder'])
const folder = optionOf('--folder')
if (folder === undefined) throw new Error('scale/table.ts needs --folder')
const parsed = readdirSync(folder).filter(name => name.endsWith('.record.json')).map(name => JSON.parse(readFileSync(join(folder, name), 'utf8')) as {format?: unknown})
if (parsed.some(record => record.format !== 'recovery-lr scale record 1')) throw new Error('a file of the folder is no record of scale/run.ts')
const records = parsed as ScaleRecord[]

// The rows in the order: the recipe's rate before another rate, the rows with a search last, fewer train samples
// and fewer passes first.
const settingOf = (record: ScaleRecord): string => [record.learningRate === 0.05 && record.startShare === 0.9 ? 0 : 1, record.learningRate, record.startShare, record.steps === 'training, then the count' ? 0 : record.passes === 0 ? 2 : 1, String(record.trainSamples).padStart(9, '0'), String(record.passes).padStart(4, '0')].join(' ')
const groups = new Map<string, ScaleRecord[]>()
for (const record of records) groups.set(settingOf(record), [...(groups.get(settingOf(record)) ?? []), record])

console.log('| steps | train samples | passes | steps of Adam | rate | share at the start | seeds | all three | whole | stack | largest share of a cell | tokens skipped at the limit of 16 steps | all three on its train samples | whole on its train samples | cells changed | training, s | search, s |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
// The rows to compare with, copied from ../runs/README.md: the same 5,000 validation samples, counts and rows made
// from the first 40,000 train samples. An empty field was not measured there. The tokens skipped at the limit were
// looked at for the seeds 1, 2 and 5 of row 9, seed 1 of row 10 and seed 11 of row 11.
console.log('| bar: yacc error productions, with the count | 40000 | | | | | | 83.08 | 37.10 | 72.49 | | | | | | | |')
console.log('| bar: a table filled by hand-written rules, with the count | 40000 | | | | | | 88.03 | 48.66 | 81.94 | | 61 | | | | | |')
console.log('| row 9 of the frozen recipe: training, then the count | 40000 | 3 | 3750 | 0.05 | 0.9 | 1, 2, 3, 4, 5 | 82.87 (81.69 to 84.25) | 35.88 (33.12 to 37.78) | 74.94 (74.54 to 75.55) | 0.78 to 0.79 | 3673 to 4307 | 83.96 (82.66 to 85.37) | 37.38 (34.15 to 39.72) | 2097 (2044 to 2126) | 20 (19 to 20) | |')
console.log('| row 10 of the frozen recipe: training, then the search, then the count | 40000 | 3 | 3750 | 0.05 | 0.9 | 1, 2, 3, 4, 5 | 88.10 (87.71 to 88.50) | 48.37 (47.62 to 49.84) | 78.49 (77.36 to 79.27) | 0.78 to 0.79 | 889 | 89.50 (89.20 to 89.80) | 50.17 (49.38 to 51.09) | 2568 (2535 to 2618) | 20 (19 to 20) | 9 (8 to 9) |')
console.log('| row 11 of the frozen recipe: the search and the count, without training | 40000 | 0 | 0 | | | 11, 12, 13 | 87.40 (87.33 to 87.54) | 44.51 (43.38 to 45.84) | 80.78 (80.15 to 81.39) | | 954 | 88.62 (88.49 to 88.72) | 46.11 (44.58 to 47.62) | 2052 (1990 to 2125) | 0 | 9 (9 to 9) |')
for (const key of [...groups.keys()].sort()) {
  const group = groups.get(key)!.sort((left, right) => left.seed - right.seed)
  const first = group[0]!
  const of = (value: (record: ScaleRecord) => number, digits = 2): string => describeSpread(group.map(value), digits)
  console.log(`| ${first.steps} | ${first.trainSamples} | ${first.passes} | ${first.gradientSteps} | ${first.learningRate} | ${first.startShare} | ${group.map(record => record.seed).join(', ')} | ${of(record => sharesOf(record.validation).allThree)} | ${of(record => sharesOf(record.validation).whole)} | ${of(record => sharesOf(record.validation).stack)} | ${first.passes === 0 ? '' : of(record => record.meanLargestShare, 3)} | ${of(record => record.validationTotals.tokensSkippedByStepLimit, 0)} | ${of(record => sharesOf(record.train).allThree)} | ${of(record => sharesOf(record.train).whole)} | ${of(record => record.cellsChanged, 0)} | ${of(record => record.seconds.training, 0)} | ${of(record => record.seconds.search, 0)} |`)
}
