// The frozen recipe of the candidate "generic" of ../combined/, with a train set of the caller's choice in the place
// of the train split of the standard set, and the rows that run.ts trains with it. README.md says what the rows are
// for and what came out.
//
// combined.ts builds a recipe's tables with functions that read the standard train set: the rule that picks
// character classes, the training, the search and the count of the display entries. Here each of those four steps
// takes the train set as an argument and reads damaged samples from nowhere else. What the recipe keeps without
// reading a damaged sample is combined.ts's own code: the cells of valid JSON deeper than 16 levels and no event of
// a text's end (modelOf, searchedCellsOf), and today's kinds in the display entries of the grammar state `error`
// (withTodaysKindsInErrorState). Nothing of the recipe is changed or tuned here.
//
// check-recipe.ts shows that these steps are the recipe's: with the standard train set they give, cell by cell, the
// tables that ../combined/run.ts saved for its seed 1.
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {type Samples, selectSamples} from '../../data.ts'
import {type AddedClass, type RecoveryTables, addClasses, addFirstOnLineBit, asIsTables, loadTablesOfThisDataset, openDisplayEntries} from '../../recovery-tables.ts'
import {type RunSamples, prepareSamples} from '../../search/sample-runs.ts'
import {train} from '../../soft/train.ts'
import {packForTwin, placesForTwin} from '../../soft/twin-data.ts'
import type {TwinData} from '../../soft/twin.ts'
import {type Recipe, candidates, modelOf, recipeWith, reportedSeeds, savedTablesFileOf, searchedCellsOf, shortNameOf, withTodaysKindsInErrorState} from '../combined/combined.ts'
import {classesChosenFromTrainSamples, displayEntriesByCount} from '../extra-facts/facts.ts'
import {type Built, armFolderOf, fileNameOf, trainPartOfTheStandardSet} from '../harness.ts'
import {searchCells} from '../holes/restricted-search.ts'
import {neutralEditNames} from './neutral-edits.ts'
import {loadNeutralSet} from './neutral.ts'

// The samples that a recipe is trained on, all of the train split.
export type TrainSet = {
  // The name that starts the name of every row that is trained on the set, e.g. "neutral damage".
  name: string
  // The set's samples, loaded once per process.
  samples: () => Samples
}
const once = <Value>(make: () => Value) => {
  let value: Value | undefined
  return () => value ??= make()
}

// The neutral set: 40,457 samples whose damage knows nothing of JSON, see set.md.
export const neutralDamage: TrainSet = {name: 'neutral damage', samples: once(() => loadNeutralSet().samples)}

// The neutral set without the samples that hold a deleted or a duplicated line. A review of the set found that those
// samples hold most of the labels that a reader from the left cannot give, e.g. every depth after a deleted line
// `"scripts": {` is one off. Which samples are left out is a choice by edit, so it reads no JSON.
const lineEdits = ['delete one line', 'duplicate one line'].map(name => neutralEditNames.indexOf(name))
export const neutralDamageWithoutLineEdits: TrainSet = {
  name: 'neutral damage without line edits',
  samples: once(() => {
    const {samples, editStart, editList} = loadNeutralSet()
    if (lineEdits.includes(-1)) throw new Error('neutral-edits.ts has no edit "delete one line" or "duplicate one line"')
    const places = Int32Array.from({length: samples.sampleCount}, (_, place) => place).filter(place => !editList.subarray(editStart[place], editStart[place + 1]).some(edit => lineEdits.includes(edit)))
    return selectSamples(samples, places)
  }),
}

// The train split of the standard set, whose damage is the dataset's 55 kinds and its typing replays: what
// ../combined/ trains on. It is here for the rows that the neutral rows are read against.
export const standardTrainSet: TrainSet = {name: 'the standard train set', samples: trainPartOfTheStandardSet}

// The classes that the rule of ../extra-facts/ picks from a train set, made once per set. From the neutral set it
// picks none, and from the standard train set 11, e.g. the apostrophe.
const knownClasses = new Map<TrainSet, AddedClass[]>()
export function classesFrom(trainSet: TrainSet): readonly AddedClass[] {
  let classes = knownClasses.get(trainSet)
  if (classes === undefined) {
    classes = classesChosenFromTrainSamples(trainSet.samples())
    knownClasses.set(trainSet, classes)
  }
  return classes
}

// The tables that a recipe's training on a train set starts from, a new copy on every call: today's tables with the
// recipe's additions, as baseOf of combined.ts makes them, with the classes that the rule picks from `trainSet` where
// combined.ts takes the ones that it picks from the standard train set.
export function baseOn(trainSet: TrainSet, recipe: Recipe): RecoveryTables {
  if (recipe.start !== 'today' || recipe.classes === 'hand' || recipe.spareTokenizerStates + recipe.spareGrammarStates > 0) throw new Error('baseOn takes a recipe of the generic line: today\'s tables, no class chosen by hand and no spare state')
  let base = asIsTables()
  const classes = recipe.classes === 'none' ? [] : classesFrom(trainSet)
  if (classes.length > 0) base = addClasses(base, classes)
  if (recipe.displayEntries) base = openDisplayEntries(base)
  if (recipe.firstOnLineBit) base = addFirstOnLineBit(base)
  return base
}

// The samples of a train set, packed for the twin and prepared for the search, once per set, layout and process. The
// layout is what both are made by: the classes of the code points and whether the tables have the bit.
const layoutKeyOf = (trainSet: TrainSet, base: RecoveryTables) => `${trainSet.name} | ${base.addedClasses.map(({name, codePoints}) => `${name} ${codePoints.join(' ')}`).join(', ')} | ${base.contextCount}`
const knownTrainData = new Map<string, TwinData>()
function trainDataOf(trainSet: TrainSet, base: RecoveryTables): TwinData {
  const key = layoutKeyOf(trainSet, base)
  let data = knownTrainData.get(key)
  if (data === undefined) {
    const samples = trainSet.samples()
    data = packForTwin(samples, placesForTwin(samples, 'train'), undefined, base)
    knownTrainData.set(key, data)
  }
  return data
}
const knownSearchSamples = new Map<string, RunSamples>()
function searchSamplesOf(trainSet: TrainSet, base: RecoveryTables): RunSamples {
  const key = layoutKeyOf(trainSet, base)
  let samples = knownSearchSamples.get(key)
  if (samples === undefined) {
    samples = prepareSamples(trainSet.samples(), base)
    knownSearchSamples.set(key, samples)
  }
  return samples
}

// A recipe's training on a train set, as trainRecipe of combined.ts: the trainer's settings are the ones written
// there, the trainer gets no validation sample, and the tables are the last ones of its run.
async function trainOn(trainSet: TrainSet, recipe: Recipe, seed: number): Promise<RecoveryTables> {
  const base = baseOn(trainSet, recipe)
  const result = await train(modelOf(recipe, base, seed), trainDataOf(trainSet, base), {
    seed, epochs: recipe.passes, learningRate: 0.05, temperatureStart: 1, temperatureEnd: 1, sharpnessCost: 0, logEverySamples: 1e9, log: () => {},
  })
  return result.last
}

// A recipe's search from the tables `start` on a train set, as searchFrom of combined.ts: over the cells that the
// recipe may change, in a random order that the run's seed and the recipe's order number draw, e.g. 11 for seed 1
// and order 1.
async function searchOn(trainSet: TrainSet, recipe: Recipe, start: RecoveryTables, searchOrder: number, seed: number): Promise<RecoveryTables> {
  const base = baseOn(trainSet, recipe)
  const started = performance.now()
  const result = await searchCells(start, searchedCellsOf(recipe, base), searchSamplesOf(trainSet, base), seed * 10 + searchOrder, recipe.searchPasses ?? 200)
  if (recipe.searchPasses === undefined && !result.lastPassChangedNothing) throw new Error(`the search of ${JSON.stringify(shortNameOf(recipe))} did not end in ${result.passes} passes`)
  console.log(`The search ended ${result.lastPassChangedNothing ? `when pass ${result.passes} changed nothing` : `after its ${result.passes} passes`}, after ${result.changes} changes of a cell and ${(result.runs / 1e6).toFixed(1)} million runs of a sample, in ${((performance.now() - started) / 1000).toFixed(0)} s.`)
  return result.tables
}

// The tables of a recipe for a seed on a train set, by the recipe's last step, as tablesOf of combined.ts: today's
// kinds in the state `error`, then the count of the display entries, then the search, then the training. A step
// starts from the tables of the recipe without it: the ones that `savedTablesOf` gives, when a run saved them, since
// a seed gives the same tables every time, and otherwise they are made here. Without `savedTablesOf` everything is
// made from nothing.
export async function tablesOn(trainSet: TrainSet, recipe: Recipe, seed: number, savedTablesOf: (earlier: Recipe) => RecoveryTables | undefined = () => undefined): Promise<RecoveryTables> {
  if (recipe.inTurns || recipe.errorTargetShare > 0 || recipe.searchCounts !== 'code points' || recipe.passes === 0) throw new Error('tablesOn takes a recipe with a training, without the search and the count in turns, without the error target and without the search for whole samples')
  const savedOrMade = async (earlier: Recipe) => savedTablesOf(earlier) ?? await tablesOn(trainSet, earlier, seed, savedTablesOf)
  if (recipe.todaysKindsInErrorState) return withTodaysKindsInErrorState(await savedOrMade(recipeWith({todaysKindsInErrorState: false}, recipe)))
  if (recipe.displayByCount) return displayEntriesByCount(await savedOrMade(recipeWith({displayByCount: false}, recipe)), trainSet.samples())
  if (recipe.searchOrder === undefined) return trainOn(trainSet, recipe, seed)
  return searchOn(trainSet, recipe, await savedOrMade(recipeWith({searchOrder: undefined, searchPasses: undefined}, recipe)), recipe.searchOrder, seed)
}

// A row of the arm: a recipe trained on a train set. Its name is the name of its folder of saved runs, e.g. "neutral
// damage: generic, then the display entries by a count, then today's kinds in the state error".
export type Row = {trainSet: TrainSet, recipe: Recipe}
export const settingNameOf = ({trainSet, recipe}: Row) => `${trainSet.name}: ${shortNameOf(recipe)}`

// Every row is saved under this arm name, with the seeds of the candidates of ../combined/, 1 to 5.
export const armName = 'neutral-damage'
export const seeds = reportedSeeds
export const savedTablesFileOfRow = (row: Row, seed: number) => join(armFolderOf(armName), fileNameOf(settingNameOf(row)), `seed-${seed}.tables.json`)

// The file in which ../combined/run.ts saved the tables of a row and a seed, or undefined when it did not: that arm
// ran its candidate "generic", step by step, on the standard train set with the classes of the rule and these seeds.
export function fileSavedByCombined(row: Row, seed: number): string | undefined {
  if (row.trainSet !== standardTrainSet || row.recipe.classes !== 'train samples') return undefined
  const file = savedTablesFileOf('combined', row.recipe, seed)
  return existsSync(file) ? file : undefined
}

// The tables that a run saved for a row and a seed, here or in ../combined/, or undefined.
function savedTablesOfRow(row: Row, seed: number): RecoveryTables | undefined {
  const file = existsSync(savedTablesFileOfRow(row, seed)) ? savedTablesFileOfRow(row, seed) : fileSavedByCombined(row, seed)
  return file === undefined ? undefined : loadTablesOfThisDataset(file).tables
}

// What run.ts gives the harness for a row and a seed: the row's tables, from the saved tables of its earlier steps
// where there are such, and the tables that its training started from.
export const buildRow = async (row: Row, seed: number): Promise<Built> =>
  ({tables: await tablesOn(row.trainSet, row.recipe, seed, earlier => savedTablesOfRow({trainSet: row.trainSet, recipe: earlier}, seed)), base: baseOn(row.trainSet, row.recipe)})

// The recipe of the candidate "generic": the training, the search in its first order with at most 4 passes, the
// count, and today's kinds in the state `error`. And the same without the search, which is the recipe of the
// primary row.
export const withTheSearch = candidates[0]!.recipe
const withoutTheSearch = recipeWith({searchOrder: undefined, searchPasses: undefined}, withTheSearch)
const withoutTheClasses = (recipe: Recipe) => recipeWith({classes: 'none'}, recipe)

// A recipe step by step, the training alone first: each is the recipe that the next one starts from.
export function stepsOf(recipe: Recipe): Recipe[] {
  const training = recipeWith({searchOrder: undefined, searchPasses: undefined, displayByCount: false, todaysKindsInErrorState: false}, recipe)
  const searched = recipeWith({displayByCount: false, todaysKindsInErrorState: false}, recipe)
  const counted = recipeWith({todaysKindsInErrorState: false}, recipe)
  return [training, ...(recipe.searchOrder === undefined ? [] : [searched]), counted, recipe]
}

// The rows of the arm, all fixed before any of them had a score:
// - (a), the primary row: the neutral set, the recipe without the search.
// - (b): the neutral set, the recipe with the search.
// - the neutral set without line edits, the recipe without the search: what a review of the set asked for.
// - the standard train set, the recipe without the search: what (a) is compared with. Its training is the one that
//   ../combined/run.ts saved.
// - the same without the classes that the rule picks: the rule picks no class from the neutral set and 11 from the
//   standard train set, so this row says how much of a difference between the two rows above is the classes.
export const primaryRow: Row = {trainSet: neutralDamage, recipe: withoutTheSearch}
export const searchedRow: Row = {trainSet: neutralDamage, recipe: withTheSearch}
export const withoutLineEditsRow: Row = {trainSet: neutralDamageWithoutLineEdits, recipe: withoutTheSearch}
export const standardRow: Row = {trainSet: standardTrainSet, recipe: withoutTheSearch}
export const standardWithoutClassesRow: Row = {trainSet: standardTrainSet, recipe: withoutTheClasses(withoutTheSearch)}
export const rowsByName: Record<string, Row> = {
  'neutral': primaryRow, 'neutral-searched': searchedRow, 'without-line-edits': withoutLineEditsRow, 'standard': standardRow, 'standard-without-classes': standardWithoutClassesRow,
}
