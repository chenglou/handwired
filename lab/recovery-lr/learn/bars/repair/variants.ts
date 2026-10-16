// What other values of the bar's numbers give, on train samples: the numbers of repair.ts are fixed from the
// literature, and this table only shows how much hangs on each. Nothing was chosen by it.
//
//   bun lab/recovery-lr/learn/bars/repair/variants.ts [--train <samples>]
import {defaultSeed, loadSamples} from '../../../dataset.ts'
import {numberOf, refuseUnknownOptions} from '../../options.ts'
import {scoreHeader, scoreOutputs, scoreRow} from '../../score.ts'
import {type RepairRecord, type RepairSettings, cheapestRepair, kindOfDroppedToken, standardSettings} from './repair.ts'

refuseUnknownOptions('variants.ts', ['--train'])
const train = loadSamples('train', defaultSeed, numberOf('--train', 5000))
const variants: [string, Partial<RepairSettings>][] = [
  ['the bar', {}],
  ['edits only at the rejected token and after it, as in CPCT+ (tokensBack 0)', {tokensBack: 0}],
  ['tokensBack 3', {tokensBack: 3}],
  ['tokensBack 30', {tokensBack: 30}],
  ['one edit at most, as Burke and Fisher\'s first phase (maximumCost 1)', {maximumCost: 1}],
  ['maximumCost 2', {maximumCost: 2}],
  ['shiftsNeeded 2', {shiftsNeeded: 2}],
  ['shiftsNeeded 5', {shiftsNeeded: 5}],
  ['maximumTries 200,000', {maximumTries: 200_000}],
  ['maximumTries 20,000', {maximumTries: 20_000}],
]
console.log(`The cheapest repair with other numbers, on ${train.length} train samples. The kinds of dropped tokens are the bar's in every row.`)
console.log(scoreHeader.replace('| parser |', '| numbers |').replace('| --- |', '| --- | --- | --- |').replace('| inserted per sample |', '| inserted per sample | seconds | rejected tokens: with a repair, with the second phase |'))
for (const [name, changed] of variants) {
  const settings = {...standardSettings, ...changed}
  const records: RepairRecord[] = []
  const started = performance.now()
  const score = scoreOutputs(train, sample => cheapestRepair(sample, kindOfDroppedToken, settings, records))
  const repaired = records.filter(record => record.edits !== undefined).length
  console.log(`${scoreRow(name, score)} ${((performance.now() - started) / 1000).toFixed(0)} | ${repaired}, ${records.length - repaired} |`)
}
