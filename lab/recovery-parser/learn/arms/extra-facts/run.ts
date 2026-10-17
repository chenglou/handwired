// The runs of the arm "extra facts" for one setting of the trainer: today's tables with an addition, every open cell
// and every open entry trainable, against the same run without an addition. README.md has the question, the setup
// and the results, and facts.ts has the additions.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/extra-facts/run.ts --trainer plain [--settings none,classes-hand] [--seeds 1,2,3,4,5]
// --trainer names a setting of the trainer in facts.ts, e.g. plain or three-uniform. --settings names settings of
// the arm by their keys, in the order to run them, and without it every setting runs. The setting "display-counted"
// reads the tables that the setting "none" saved for the same trainer and seeds, so "none" runs before it.
// The tables and the records go to <RECOVERY_SCRATCH>/arms/extra-facts-<trainer>/, and for other seeds than 1 to 5
// to a folder of their own, e.g. extra-facts-three-base-seeds-11-12-13-14-15, so that a run with other seeds leaves
// the files of the reported seeds where they are. report.ts then makes the tables of the README from the saved runs.
import {optionOf, refuseUnknownOptions} from '../../data.ts'
import type {RecoveryTables} from '../../recovery-tables.ts'
import type {TwinData} from '../../soft/twin.ts'
import {type ArmSetting, runArm, trainDataFor, trainPartOfTheStandardSet} from '../harness.ts'
import {
  additionsOf, armNameOf, baseOf, classesChosenFromTrainSamples, describeTrainerSetting, displayEntriesByCount, reportedSeeds, savedTablesOf, settingOfKey, settingsOfTheArm, trainTables, trainerSettings,
  withErrorTarget,
} from './facts.ts'

refuseUnknownOptions('arms/extra-facts/run.ts', ['--trainer', '--settings', '--seeds'])
const trainerName = optionOf('--trainer') ?? ''
const trainerSetting = trainerSettings[trainerName]
if (trainerSetting === undefined) throw new Error(`arms/extra-facts/run.ts needs --trainer with one of ${Object.keys(trainerSettings).join(', ')}, and got ${JSON.stringify(trainerName)}`)
const seeds = optionOf('--seeds')?.split(',').map(Number) ?? reportedSeeds
const armName = armNameOf(trainerName, seeds)
const settings = (optionOf('--settings')?.split(',') ?? settingsOfTheArm.map(setting => setting.key)).map(settingOfKey)

const trainSamples = trainPartOfTheStandardSet()
const classesFromTrainSamples = classesChosenFromTrainSamples(trainSamples)
console.log(`The trainer: ${describeTrainerSetting(trainerSetting)}.`)
console.log(`The classes chosen from the train samples: ${classesFromTrainSamples.map(({name}) => name).join(', ')}.`)

// The train samples packed for a base, once per layout of classes and contexts: every seed and every setting with
// that layout trains on the same packed samples.
const packed = new Map<string, TwinData>()
function trainDataOf(base: RecoveryTables): TwinData {
  const layout = `${base.addedClasses.map(({name}) => name).join(' ')} | ${base.contextCount}`
  let data = packed.get(layout)
  if (data === undefined) {
    data = trainDataFor(base)
    packed.set(layout, data)
  }
  return data
}

const armSettings: ArmSetting[] = settings.map(setting => ({
  name: setting.name,
  build: async seed => {
    const base = baseOf(additionsOf(setting, classesFromTrainSamples))
    if (setting.displayByCount === true) return {tables: displayEntriesByCount(savedTablesOf(armName, settingOfKey('none').name, seed), trainSamples), base}
    const data = trainDataOf(base)
    return {tables: await trainTables(base, setting.errorTargetShare === undefined ? data : withErrorTarget(data, setting.errorTargetShare, seed), seed, trainerSetting), base}
  },
}))

await runArm({name: armName, seeds, settings: armSettings})
