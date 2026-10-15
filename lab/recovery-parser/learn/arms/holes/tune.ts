// The tuning runs of the arm "holes": settings of the trainer on blanks that the reported runs do not draw. Each
// run blanks a share of the hand-written decisions with its seed, trains the blanks, and is scored by the harness.
// The seeds are 11, 12 and 13 unless others are named. run.ts uses the seeds 1 to 5 and the one setting that was
// chosen here, `trainerSetting` of holes.ts.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/holes/tune.ts --name passes-and-start --passes 1,3,10 --start base,uniform
//       [--seeds 11,12,13] [--share 10] [--learning-rate 0.05] [--temperature-end 1] [--sharpness-cost 0]
// --passes, --start, --learning-rate, --temperature-end and --sharpness-cost each take a list, and the command runs
// every combination. The tables and the records go to <RECOVERY_SCRATCH>/arms/holes-tuning-<name>/, so two commands
// with two names can run at the same time.
import {optionOf, refuseUnknownOptions} from '../../data.ts'
import {type RecoveryTables, asIsTables} from '../../recovery-tables.ts'
import {sharesOf} from '../../score.ts'
import {type ArmRecord, type ArmSetting, percentSpread, recordOf, rowNamed, runArm, spreadOf, trainDataFor} from '../harness.ts'
import {type TrainerSetting, blanksOf, describeTrainerSetting, handTables, readersOf, sameChoice, trainCells, trainReadersOf} from './holes.ts'

refuseUnknownOptions('arms/holes/tune.ts', ['--name', '--seeds', '--share', '--passes', '--start', '--learning-rate', '--temperature-end', '--sharpness-cost'])
const name = optionOf('--name')
if (name === undefined) throw new Error('arms/holes/tune.ts needs --name <name>, e.g. --name passes-and-start: the name of the folder of its runs')
const listOf = (option: string, fallback: string) => (optionOf(option) ?? fallback).split(',')
const seeds = listOf('--seeds', '11,12,13').map(Number)
const sharePercent = Number(optionOf('--share') ?? 10)
const starts = listOf('--start', 'base')
for (const start of starts) if (start !== 'base' && start !== 'uniform') throw new Error(`--start takes base or uniform, or both with a comma, and got ${start}`)
const trainerSettings: TrainerSetting[] = []
for (const passes of listOf('--passes', '1').map(Number)) {
  for (const start of starts as ('base' | 'uniform')[]) {
    for (const learningRate of listOf('--learning-rate', '0.05').map(Number)) {
      for (const temperatureEnd of listOf('--temperature-end', '1').map(Number)) {
        for (const sharpnessCost of listOf('--sharpness-cost', '0').map(Number)) trainerSettings.push({passes, start, learningRate, temperatureEnd, sharpnessCost})
      }
    }
  }
}

const hand = handTables()
// Every base of the arm has today's classes and contexts, so the train samples are packed once.
const data = trainDataFor(hand)
const trainReaders = trainReadersOf(hand)
// The tables of every trained run, by the setting's name and the seed, for the agreement with the hand-written choices.
const trainedTables = new Map<string, RecoveryTables>()
const blankedName = 'the blanks as they are, not filled'
const settings: ArmSetting[] = [
  {name: blankedName, build: seed => ({tables: blanksOf(sharePercent, seed).base, base: hand})},
  ...trainerSettings.map((setting): ArmSetting => ({
    name: describeTrainerSetting(setting),
    build: async seed => {
      const blanks = blanksOf(sharePercent, seed)
      const tables = await trainCells(blanks.base, blanks.trainable, data, seed, setting)
      trainedTables.set(`${describeTrainerSetting(setting)} ${seed}`, tables)
      return {tables, base: blanks.base}
    },
  })),
]
const results = await runArm({name: `holes-tuning-${name}`, seeds, settings})

const handRecord = recordOf(hand, asIsTables())
const withinReach = 'group: within reach of the tables'
const allThree = (record: ArmRecord, rowName: string) => sharesOf(rowNamed(record, rowName)).allThree
const blanked = results[0]!
console.log('')
console.log(`${sharePercent}% of the hand-written decisions blanked, seeds ${seeds.join(', ')}. The hand-written tables have ${(100 * allThree(handRecord, 'all')).toFixed(2)} of all three, ${(100 * allThree(handRecord, withinReach)).toFixed(2)} within reach of the tables.`)
console.log('"Comes back" is the share of what the blanks cost that training gets back. "Hand\'s choice" is the share of the blanked cells that hold the hand-written choice after training, of all of them and of the ones that a train sample reads with the hand-written tables.')
console.log('')
console.log('| setting of the trainer | all three | within reach of the tables | whole samples | comes back, all three | comes back, within reach | hand\'s choice, all blanks | hand\'s choice, blanks that a train sample reads |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const result of results) {
  const over = (value: (record: ArmRecord, at: number) => number) => percentSpread(spreadOf(result.records.map(value)))
  const comesBack = (rowName: string) => over((record, at) => (allThree(record, rowName) - allThree(blanked.records[at]!, rowName)) / (allThree(handRecord, rowName) - allThree(blanked.records[at]!, rowName)))
  const agreement = (onlyRead: boolean) => over((_, at) => {
    const cells = blanksOf(sharePercent, seeds[at]!).cells.filter(cell => !onlyRead || readersOf(trainReaders, cell) > 0)
    const tables = result === blanked ? blanksOf(sharePercent, seeds[at]!).base : trainedTables.get(`${result.name} ${seeds[at]}`)!
    return cells.filter(cell => sameChoice(tables, hand, cell)).length / cells.length
  })
  console.log(`| ${result.name} | ${over(record => allThree(record, 'all'))} | ${over(record => allThree(record, withinReach))} | ${over(record => sharesOf(rowNamed(record, 'all')).whole)} | ${result === blanked ? '-' : comesBack('all')} | ${result === blanked ? '-' : comesBack(withinReach)} | ${agreement(false)} | ${agreement(true)} |`)
}
