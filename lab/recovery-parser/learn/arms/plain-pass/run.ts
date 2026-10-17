// The plain one pass of the trainer, with 5 seeds: one pass over the train split from today's tables, every open
// cell trainable, every default of ../../soft/train.ts. Nothing is tuned. It is here for two things: to say how far
// two seeds of one setting are apart, before any arm is read, and as the shortest example of an arm.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after the two commands that make
// the tables of the number to beat, see numberToBeat in ../harness.ts:
//   bun lab/recovery-parser/learn/arms/plain-pass/run.ts [--seeds 1,2,3,4,5]
// About 30 s per seed with 4 worker threads. The tables and the records go to <RECOVERY_SCRATCH>/arms/plain-pass/.
import {optionOf, refuseUnknownOptions} from '../../data.ts'
import {asIsTables} from '../../recovery-tables.ts'
import {train} from '../../soft/train.ts'
import {createModel} from '../../soft/twin.ts'
import {baselines, describeComparison, describeSettings, numberToBeat, runArm, trainDataFor} from '../harness.ts'

refuseUnknownOptions('arms/plain-pass/run.ts', ['--seeds'])
const seeds = (optionOf('--seeds') ?? '1,2,3,4,5').split(',').map(Number)
// The number to beat is read before anything trains, so that a missing file of its tables stops the arm here.
const toBeat = numberToBeat()
const base = asIsTables()
// The train samples that give the twin a step, packed once: every seed trains on the same samples in another order.
const data = trainDataFor(base)

const results = await runArm({
  name: 'plain-pass', seeds,
  settings: [{
    name: 'one pass of the trainer from today\'s tables, defaults',
    build: async seed => {
      // `train` changes the model that it is given, so every seed gets a model of its own.
      const model = createModel(base)
      // Without `validation` the trainer scores nothing while it trains: the harness scores the last tables.
      const result = await train(model, data, {seed, epochs: 1, logEverySamples: 1e9, log: () => {}})
      return {tables: result.last, base}
    },
  }],
})

const rows = baselines()
console.log('')
console.log('Next to the baselines and the number to beat:')
console.log('')
console.log(describeSettings([...rows, toBeat, ...results]))
if (seeds.length >= 3) {
  // Against the hand-written tables and against the number to beat, on all samples and in the group that is within
  // reach of the tables.
  for (const other of [rows.at(-1)!, toBeat]) {
    console.log('')
    for (const rowName of ['all', 'group: within reach of the tables']) console.log(describeComparison(results[0]!, other, rowName))
  }
}
