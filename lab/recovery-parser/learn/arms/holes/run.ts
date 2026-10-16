// The reported runs of the arm "holes" for one share of blanked decisions: a person has written a recovering parser,
// the hand-written tables of ../../handwritten/rules.ts, and a share of its decisions is taken back. Does training
// put the right choices into the blanks? README.md has the question, the setup and the results.
//
// A seed draws the blanked decisions, orders the samples of the training and orders the cells of the search. Per
// share and seed:
// - "not filled": the hand-written tables with today's choice in the blanked cells, which is what blanking costs,
// - "trained": only the blanked cells are trainable, with the one setting of the trainer that tune.ts chose,
// - "searched": the search of ../../search/ over the blanked cells alone, as the comparison without gradients. A
//   search ends in other tables for another order of its cells, so the seed draws a random order for every pass.
// The share 10 also has a trained and a searched setting whose blanks are the ones of seed 1 for every seed, so that
// the seed only orders the training and the search. The share 100 blanks every decision, so its base is today's
// tables for every seed, and its seeds only order too. It has two more settings: the search with the most read
// cells first, which is the order that search.ts has by default and has no seed, and a training in which every open
// cell is trainable, which is the same run without the knowledge of which cells the person changed.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/holes/run.ts --share 10 [--seeds 1,2,3,4,5]
// --share is 10, 25, 50 or 100. The tables and the records go to <RECOVERY_SCRATCH>/arms/holes-<share>/, so the four
// shares can run at the same time. report.ts then makes the tables of the README from the saved runs.
import {optionOf, refuseUnknownOptions} from '../../data.ts'
import {asIsTables} from '../../recovery-tables.ts'
import {prepareSamples} from '../../search/sample-runs.ts'
import {type ArmSetting, type Built, runArm, trainDataFor, trainPartOfTheStandardSet} from '../harness.ts'
import {type Blanks, armNameOf, blanksOf, handTables, seedOfTheFixedBlanks, settingNamesOf, sharesOfTheArm, trainCells, trainerSetting} from './holes.ts'
import {searchCells} from './restricted-search.ts'

refuseUnknownOptions('arms/holes/run.ts', ['--share', '--seeds'])
const sharePercent = Number(optionOf('--share'))
if (!(sharesOfTheArm as readonly number[]).includes(sharePercent)) throw new Error(`arms/holes/run.ts needs --share with one of ${sharesOfTheArm.join(', ')}, and got ${optionOf('--share')}`)
const seeds = (optionOf('--seeds') ?? '1,2,3,4,5').split(',').map(Number)

const hand = handTables()
// Every base of the arm has today's classes and contexts, so the train samples are packed once, for the trainer and
// for the search.
const data = trainDataFor(hand)
const searchSamples = prepareSamples(trainPartOfTheStandardSet())
const names = settingNamesOf(sharePercent)

const trained = async (blanks: Blanks, seed: number): Promise<Built> => ({tables: await trainCells(blanks.base, blanks.trainable, data, seed, trainerSetting), base: blanks.base})
// The search of the blanked cells, in a random order that `orderSeed` draws, or with the most read cells first
// when no seed is given.
const searched = async (blanks: Blanks, orderSeed?: number): Promise<Built> => {
  const result = await searchCells(blanks.base, blanks.cells, searchSamples, orderSeed)
  if (!result.lastPassChangedNothing) throw new Error(`the search of ${blanks.cells.length} blanked cells did not end in ${result.passes} passes`)
  console.log(`The search of ${blanks.cells.length} blanked cells ended when pass ${result.passes} changed nothing, after ${result.changes} changes of a cell and ${(result.runs / 1e6).toFixed(1)} million runs of a sample.`)
  return {tables: result.tables, base: blanks.base}
}

const settings: ArmSetting[] = sharePercent === 100
  ? [
    {name: names.trained, build: seed => trained(blanksOf(100, seed), seed)},
    {name: names.searched, build: seed => searched(blanksOf(100, seed), seed)},
    {name: names.searchedMostReadFirst, withoutSeed: true, build: () => searched(blanksOf(100, seeds[0]!))},
    {name: names.everyOpenCellTrained, build: async seed => ({tables: await trainCells(asIsTables(), undefined, data, seed, trainerSetting), base: asIsTables()})},
  ]
  : [
    {name: names.notFilled, build: seed => ({tables: blanksOf(sharePercent, seed).base, base: hand})},
    {name: names.trained, build: seed => trained(blanksOf(sharePercent, seed), seed)},
    {name: names.searched, build: seed => searched(blanksOf(sharePercent, seed), seed)},
    ...(sharePercent === 10 ? [
      {name: names.trainedOnFixedBlanks, build: (seed: number) => trained(blanksOf(sharePercent, seedOfTheFixedBlanks), seed)},
      {name: names.searchedOnFixedBlanks, build: (seed: number) => searched(blanksOf(sharePercent, seedOfTheFixedBlanks), seed)},
    ] : []),
  ]

await runArm({name: armNameOf(sharePercent), seeds, settings})
