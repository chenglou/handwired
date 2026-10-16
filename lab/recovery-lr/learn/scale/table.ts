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
const records = readdirSync(folder).filter(name => name.endsWith('.record.json')).map(name => JSON.parse(readFileSync(join(folder, name), 'utf8')) as ScaleRecord)
for (const record of records) if (record.format !== 'recovery-lr scale record 1') throw new Error('a file of the folder is no record of scale/run.ts')

const settingOf = (record: ScaleRecord): string => [record.steps === 'training, then the count' ? 0 : 1, record.learningRate, record.startShare, String(record.trainSamples).padStart(9, '0'), String(record.passes).padStart(4, '0')].join(' ')
const groups = new Map<string, ScaleRecord[]>()
for (const record of records) groups.set(settingOf(record), [...(groups.get(settingOf(record)) ?? []), record])

console.log('| steps | train samples | passes | steps of Adam | rate | share at the start | seeds | all three | whole | stack | largest share of a cell | tokens skipped at the limit of 16 steps | all three on its train samples | whole on its train samples | cells changed | training, s | search, s |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const key of [...groups.keys()].sort()) {
  const group = groups.get(key)!.sort((left, right) => left.seed - right.seed)
  const first = group[0]!
  const of = (value: (record: ScaleRecord) => number, digits = 2): string => describeSpread(group.map(value), digits)
  console.log(`| ${first.steps} | ${first.trainSamples} | ${first.passes} | ${first.gradientSteps} | ${first.learningRate} | ${first.startShare} | ${group.map(record => record.seed).join(', ')} | ${of(record => sharesOf(record.validation).allThree)} | ${of(record => sharesOf(record.validation).whole)} | ${of(record => sharesOf(record.validation).stack)} | ${of(record => record.meanLargestShare, 3)} | ${of(record => record.validationTotals.tokensSkippedByStepLimit, 0)} | ${of(record => sharesOf(record.train).allThree)} | ${of(record => sharesOf(record.train).whole)} | ${of(record => record.cellsChanged, 0)} | ${of(record => record.seconds.training, 0)} | ${of(record => record.seconds.search, 0)} |`)
}
