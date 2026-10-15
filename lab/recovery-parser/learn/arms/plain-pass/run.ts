// The plain one pass of the trainer, with 5 seeds: one pass over the train split from today's tables, every open
// cell trainable, every default of ../../soft/train.ts. Nothing is tuned. It is here for two things: to say how far
// two seeds of one setting are apart, before any arm is read, and as the shortest example of an arm.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/plain-pass/run.ts [--seeds 1,2,3,4,5]
// About 30 s per seed with 4 worker threads. The tables and the records go to <RECOVERY_SCRATCH>/arms/plain-pass/.
import {optionOf} from '../../data.ts'
import {asIsTables} from '../../recovery-tables.ts'
import {train} from '../../soft/train.ts'
import {packForTwin, placesForTwin} from '../../soft/twin-data.ts'
import {createModel} from '../../soft/twin.ts'
import {baselines, describeComparison, describeSettings, runArm, samplesOfTheStandardSet} from '../harness.ts'

const seeds = (optionOf('--seeds') ?? '1,2,3,4,5').split(',').map(Number)
const samples = samplesOfTheStandardSet()
const base = asIsTables()
// The train samples that give the twin a step, packed once: every seed trains on the same samples in another order.
const data = packForTwin(samples, placesForTwin(samples, 'train'), undefined, base)

const results = await runArm({
  name: 'plain-pass', seeds,
  settings: [{
    name: 'one pass of the trainer from today\'s tables, defaults',
    build: async seed => {
      const model = createModel(base)
      // Without `validation` the trainer scores nothing while it trains: the harness scores the last tables.
      const result = await train(model, data, {seed, epochs: 1, logEverySamples: 1e9, log: () => {}})
      return {tables: result.last, base}
    },
  }],
})

const rows = baselines()
console.log('')
console.log('Next to the baselines:')
console.log('')
console.log(describeSettings([...rows, ...results]))
if (seeds.length >= 3) {
  console.log('')
  console.log(describeComparison(results[0]!, rows.at(-1)!))
}
