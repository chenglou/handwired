// What the scripts of the arm "generic" share: a recipe, i.e. one way to turn today's tables into recovering ones
// without a rule that a person wrote, its name, the function that builds its tables for a seed, and the steps of
// the arm, each a list of recipes that are read next to each other. README.md says what the arm asks and found.
//
// Every recipe starts from today's tables and may change every open cell, but for the cells that a recipe keeps out
// on purpose. Nothing here reads the hand-written tables.
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {createRandom} from '../../../random.ts'
import {tooDeepText, tooDeepTextWithMembersAfter} from '../../check-texts.ts'
import {loadSamples, standardRange} from '../../data.ts'
import {codePointsOf, createTrace, runRecoveryParserInto} from '../../recovery-parser.ts'
import {type RecoveryTables, asIsTables, classNames, eventNames, loadTablesOfThisDataset, openDisplayEntries, today} from '../../recovery-tables.ts'
import {type RunSamples, prepareSamples} from '../../search/sample-runs.ts'
import {train} from '../../soft/train.ts'
import {packForTwin, placesForTwin} from '../../soft/twin-data.ts'
import {type TwinData, type TwinModel, createModel} from '../../soft/twin.ts'
import {type Built, type SettingResult, armFolderOf, fileNameOf, samplesOfTheStandardSet, savedResultOf, trainPartOfTheStandardSet} from '../harness.ts'
import type {Cell} from '../holes/holes.ts'
import {searchCells} from '../holes/restricted-search.ts'

export type Recipe = {
  // Passes of the trainer over the train samples. With 0 nothing is trained: the tables before the recipe's search
  // are today's, and no other setting of the trainer counts.
  passes: number
  // Where a trainable mix starts: 'base' gives today's choice the trainer's default share, 0.9, and 'uniform' gives
  // every choice the same share.
  start: 'base' | 'uniform'
  learningRate: number
  // Samples per step of Adam.
  batchSize: number
  // The temperature of the mixes at the last sample. It starts at 1.
  temperatureEnd: number
  // The weight of the cost on a mix being far from one choice.
  sharpnessCost: number
  // One weight for the three extra targets of ../../intended.ts.
  intendedWeight: number
  // 'open' makes the open entries of the display table trainable too, see ../../structure/README.md.
  displayTable: 'fixed' | 'open'
  // How much a scored code point weighs in the loss: 1 / (the scored code points of its sample) ^ this power. With 0
  // every code point weighs the same, so a sample weighs as much as it has scored code points. With 1 every sample
  // weighs the same.
  sampleWeightPower: number
  // The first so many scored code points of a sample, from its first error on, weigh `firstCodePointsWeight` times
  // as much as its other ones. 0 code points switches it off.
  firstCodePoints: number
  firstCodePointsWeight: number
  // 'kept' keeps the cells that valid JSON of more than 16 levels reads out of the training and out of the search,
  // see cellsOfTooDeepValidJson.
  tooDeepCells: 'trained' | 'kept'
  // 'ruled out' keeps a trained tokenizer cell from taking an event of a text's end, see ruleOutEndEvents.
  endEvents: 'allowed' | 'ruled out'
  // How many times the standard set's range of indexes the train samples come from: 1 is the standard set, 4 is the
  // train samples of the indexes 0 to 239,999.
  sampleSets: number
  // With a number, the greedy search of ../../search/ goes over the recipe's cells after the training, in a random
  // order that the seed and this number draw. Undefined is the training alone.
  searchOrder: number | undefined
}

// The trainer's plain pass, ../plain-pass/: one pass, every default.
export const plainPass: Recipe = {
  passes: 1, start: 'base', learningRate: 0.05, batchSize: 32, temperatureEnd: 1, sharpnessCost: 0, intendedWeight: 0, displayTable: 'fixed',
  sampleWeightPower: 0, firstCodePoints: 0, firstCodePointsWeight: 1, tooDeepCells: 'trained', endEvents: 'allowed', sampleSets: 1, searchOrder: undefined,
}
export const recipeWith = (changes: Partial<Recipe>, from: Recipe = plainPass): Recipe => ({...from, ...changes})

// A recipe's name, which is the name of its row and of its folder of saved runs: the passes and the start, then
// whatever is not as in the plain pass, e.g. "3 passes, uniform start, learning rate 0.1". A recipe without a
// training is named by what its search is told, e.g. "no training, too deep cells kept, then searched, order 1".
export function describeRecipe(recipe: Recipe): string {
  const parts: string[] = []
  if (recipe.passes === 0) {
    parts.push('no training')
    if (recipe.tooDeepCells === 'kept') parts.push('too deep cells kept')
  } else {
    parts.push(`${recipe.passes} pass${recipe.passes === 1 ? '' : 'es'}`, recipe.start === 'uniform' ? 'uniform start' : 'start at today\'s choice')
    if (recipe.learningRate !== plainPass.learningRate) parts.push(`learning rate ${recipe.learningRate}`)
    if (recipe.batchSize !== plainPass.batchSize) parts.push(`batches of ${recipe.batchSize}`)
    if (recipe.temperatureEnd !== plainPass.temperatureEnd) parts.push(`temperature falls to ${recipe.temperatureEnd}`)
    if (recipe.sharpnessCost !== plainPass.sharpnessCost) parts.push(`sharpness cost ${recipe.sharpnessCost}`)
    if (recipe.intendedWeight !== plainPass.intendedWeight) parts.push(`extra targets ${recipe.intendedWeight}`)
    if (recipe.displayTable === 'open') parts.push('display table open')
    if (recipe.sampleWeightPower === 1) parts.push('every sample weighs the same')
    else if (recipe.sampleWeightPower !== 0) parts.push(`sample weight power ${recipe.sampleWeightPower}`)
    if (recipe.firstCodePoints > 0) parts.push(`the first ${recipe.firstCodePoints} code points weigh ${recipe.firstCodePointsWeight} times`)
    if (recipe.tooDeepCells === 'kept') parts.push('too deep cells kept')
    if (recipe.endEvents === 'ruled out') parts.push('no event of a text\'s end')
    if (recipe.sampleSets !== 1) parts.push(`${recipe.sampleSets} times the samples`)
  }
  if (recipe.searchOrder !== undefined) parts.push(`then searched, order ${recipe.searchOrder}`)
  return parts.join(', ')
}

// The tables that a recipe starts from: today's, with the open entries of the display table when the recipe trains them.
const baseOf = (recipe: Recipe): RecoveryTables => recipe.displayTable === 'open' ? openDisplayEntries(asIsTables()) : asIsTables()

// The grammar cells that valid JSON of more than 16 levels reads from its first error on with today's tables, as a
// mask with 1 per cell. Such a text has its first error at its 17th opening bracket and reads open cells from there
// on, and the dataset has no such text, so training is free to break its depth, see ../../check-deep.ts.
//
// The mask holds two kinds of cells:
// - the cells that 2,000 texts of each of the two forms of check-deep.ts read. They are made as the texts of the
//   check are, from other random streams than its 17 and 18, so the check's texts are not the ones that the mask was
//   made from. That gives the 6 cells of an opening bracket at depth 16 where a value may start, which lead into the
//   state `error`, and 40 cells of the row of that state,
// - the other 48 cells of the row of the state `error`, which a too deep text of another form reads, e.g. one with a
//   container after its deepest part.
// Tables that hold today's choice in these 94 cells give every valid JSON text that is too deep today's trace: its
// first error leads into the state `error`, the row of that state leads nowhere else, and its tokenizer cells are
// the ones of valid JSON, which are frozen.
let knownCellsOfTooDeepValidJson: Uint8Array | undefined
export function cellsOfTooDeepValidJson(): Uint8Array {
  if (knownCellsOfTooDeepValidJson !== undefined) return knownCellsOfTooDeepValidJson
  const todays = asIsTables()
  const cells = new Uint8Array(todays.grammarNext.length)
  const trace = createTrace()
  for (const {make, stream} of [{make: tooDeepText, stream: 27}, {make: tooDeepTextWithMembersAfter, stream: 28}]) {
    const random = createRandom(standardRange.seed, stream)
    for (let text = 0; text < 2000; text++) {
      const {codePoints} = codePointsOf(make(random))
      runRecoveryParserInto(trace, codePoints, 0, codePoints.length, false, todays, codePoints.length)
      for (let position = trace.firstErrorPosition; position < codePoints.length; position++) cells[trace.grammarCell[position]!] = 1
    }
  }
  const cellsPerState = todays.tokenCount * todays.contextCount
  cells.fill(1, today.errorState * cellsPerState, (today.errorState + 1) * cellsPerState)
  knownCellsOfTooDeepValidJson = cells
  return cells
}

// The mask of the grammar cells that a recipe may change, by its training and by its search: every open one,
// without the cells of too deep valid JSON when the recipe keeps those.
function trainableGrammarCellsOf(recipe: Recipe, base: RecoveryTables): Uint8Array {
  if (recipe.tooDeepCells === 'trained') return base.grammarOpen.slice()
  const kept = cellsOfTooDeepValidJson()
  return base.grammarOpen.map((open, cell) => open === 1 && kept[cell] === 0 ? 1 : 0)
}

const endEvents = (['end', 'endInsideToken', 'truncatedEnd'] as const).map(name => eventNames.indexOf(name))
const endClasses = (['end', 'truncatedEnd'] as const).map(name => classNames.indexOf(name))

// Takes the three events of a text's end out of the mixes of the trainable tokenizer cells that a code point of a
// text reads: their weights become -Infinity, so their share is exactly 0, no gradient moves them, and snapping
// never picks them. A code point with such an event is shown as "past the end", the display kind of the cells after
// a text. The cells of the two classes of a text's end keep their events.
export function ruleOutEndEvents(model: TwinModel) {
  const {classCount, eventCount, lexerEvent} = model.base
  for (let cell = 0; cell < model.trainableLexer.length; cell++) {
    if (model.trainableLexer[cell] === 0 || endClasses.includes(cell % classCount) || endEvents.includes(lexerEvent[cell]!)) continue
    for (const event of endEvents) model.weights.lexerEvent[cell * eventCount + event] = -Infinity
  }
}

// The train samples of a recipe, packed for the twin once per process. Every base of the arm gives a code point the
// class that it has today, so the samples are packed for today's tables. With more than one set, the samples are
// the train samples of a longer range of indexes of the same seed, which loadSamples makes without the test split.
const knownTrainData = new Map<number, TwinData>()
function trainDataOf(sampleSets: number): TwinData {
  let data = knownTrainData.get(sampleSets)
  if (data === undefined) {
    const samples = sampleSets === 1 ? samplesOfTheStandardSet() : loadSamples(standardRange.seed, standardRange.from, standardRange.from + sampleSets * (standardRange.to - standardRange.from))
    data = packForTwin(samples, placesForTwin(samples, 'train'), undefined, asIsTables())
    knownTrainData.set(sampleSets, data)
  }
  return data
}

// The trained tables of a recipe and a seed, without the recipe's search. They are kept for the process, so that
// the recipes that search the same trained tables in several orders train them once.
const knownTrainedTables = new Map<string, Promise<RecoveryTables>>()
function trainedTablesOf(recipe: Recipe, seed: number): Promise<RecoveryTables> {
  const key = `${describeRecipe({...recipe, searchOrder: undefined})}, seed ${seed}`
  let tables = knownTrainedTables.get(key)
  if (tables === undefined) {
    tables = trainRecipe(recipe, seed)
    knownTrainedTables.set(key, tables)
  }
  return tables
}

async function trainRecipe(recipe: Recipe, seed: number): Promise<RecoveryTables> {
  const base = baseOf(recipe)
  if (recipe.passes === 0) return base
  // The model is made here, once per seed: `train` changes the model that it is given.
  const model = createModel(base, {start: recipe.start, trainable: {lexer: 'open', grammar: trainableGrammarCellsOf(recipe, base), display: 'open'}})
  if (recipe.endEvents === 'ruled out') ruleOutEndEvents(model)
  const result = await train(model, trainDataOf(recipe.sampleSets), {
    seed, epochs: recipe.passes, learningRate: recipe.learningRate, batchSize: recipe.batchSize, temperatureStart: 1, temperatureEnd: recipe.temperatureEnd, sharpnessCost: recipe.sharpnessCost,
    loss: {
      intendedLexerWeight: recipe.intendedWeight, intendedEventWeight: recipe.intendedWeight, intendedGrammarWeight: recipe.intendedWeight,
      sampleWeightPower: recipe.sampleWeightPower, firstCodePoints: recipe.firstCodePoints, firstCodePointsWeight: recipe.firstCodePointsWeight,
    },
    logEverySamples: 1e9, log: () => {},
  })
  return result.last
}

// The train split of the standard set as the search holds it, made once per process.
let knownSearchSamples: RunSamples | undefined
const searchSamples = () => knownSearchSamples ??= prepareSamples(trainPartOfTheStandardSet())

// The trained tables that run.ts saved for a recipe without its search and a seed under an arm name, or undefined
// when that run is not saved.
function savedTrainedTablesOf(armName: string, recipe: Recipe, seed: number): RecoveryTables | undefined {
  const file = join(armFolderOf(armName), fileNameOf(describeRecipe({...recipe, searchOrder: undefined})), `seed-${seed}.tables.json`)
  return existsSync(file) ? loadTablesOfThisDataset(file).tables : undefined
}

// The tables of a recipe for a seed: the trained ones, and for a recipe with a search, what the greedy search makes
// of them. The search goes over the cells that the recipe may change and no others, in a random order that is drawn
// anew for every pass, from a seed that the run's seed and the recipe's order number make, e.g. 113 for seed 11 and
// order 3. It always runs on the train split of the standard set. It starts from the trained tables that an earlier
// command saved for the same recipe without the search under `armName`, when there are such, so that a later command
// with more orders does not train again: a seed's training gives the same tables every time. For a recipe without
// a training it starts from today's tables, and its seed only draws the order.
export async function buildRecipe(recipe: Recipe, seed: number, armName: string): Promise<Built> {
  const base = baseOf(recipe)
  if (recipe.searchOrder === undefined) return {tables: await trainedTablesOf(recipe, seed), base}
  const trained = savedTrainedTablesOf(armName, recipe, seed) ?? await trainedTablesOf(recipe, seed)
  const grammarCells = trainableGrammarCellsOf(recipe, base)
  const cells: Cell[] = []
  for (let cell = 0; cell < base.lexerOpen.length; cell++) if (base.lexerOpen[cell] === 1) cells.push({grammar: false, cell})
  for (let cell = 0; cell < grammarCells.length; cell++) if (grammarCells[cell] === 1) cells.push({grammar: true, cell})
  const started = performance.now()
  const result = await searchCells(trained, cells, searchSamples(), seed * 10 + recipe.searchOrder)
  if (!result.lastPassChangedNothing) throw new Error(`the search of ${JSON.stringify(describeRecipe(recipe))} did not end in ${result.passes} passes`)
  console.log(`The search ended when pass ${result.passes} changed nothing, after ${result.changes} changes of a cell and ${(result.runs / 1e6).toFixed(1)} million runs of a sample, in ${((performance.now() - started) / 1000).toFixed(0)} s.`)
  return {tables: result.tables, base}
}

// A step of the arm: recipes that are read next to each other. The tuning steps run with the seeds 11, 12 and 13
// and save under the arm name "generic-tuning", and the first recipe of a tuning step is the control of its others.
// With `everyPair` the report compares every two recipes of the step, for a step whose recipes differ from its
// control in more than one thing. The two reported steps run once with the seeds 1 to 5 and save under "generic".
export type Step = {armName: string, seeds: readonly number[], recipes: readonly Recipe[], everyPair?: true}
const tuning = (recipes: readonly Recipe[]): Step => ({armName: 'generic-tuning', seeds: [11, 12, 13], recipes})
const reported = (recipes: readonly Recipe[]): Step => ({armName: 'generic', seeds: [1, 2, 3, 4, 5], recipes})

const onePassUniform = recipeWith({start: 'uniform'})
// What the step passes-and-start chose, and the control of the steps after it.
const threePasses = recipeWith({passes: 3, start: 'uniform'})
const fourTimesTheSamples = recipeWith({start: 'uniform', sampleSets: 4})
// The arm's best recipe, as the tuning steps chose it: one pass from a uniform start over four times the samples,
// with the cells of too deep valid JSON kept and without the events of a text's end. README.md says why.
export const bestRecipe = recipeWith({tooDeepCells: 'kept', endEvents: 'ruled out'}, fourTimesTheSamples)
export const searchOrders = [1, 2, 3]
export const bestThenSearched = searchOrders.map(searchOrder => recipeWith({searchOrder}, bestRecipe))
// The comparison without gradients: the search of the best recipe from today's tables, over the same cells, on the
// same train samples and in the same orders, since a seed and an order number draw the same order here as there.
export const searchedWithoutTraining = searchOrders.map(searchOrder => recipeWith({passes: 0, searchOrder}, bestRecipe))
// The best recipe with the standard set in four passes in place of four times the samples in one pass, which are as
// many steps of the trainer: the control of the larger set of samples.
export const bestOnTheStandardSet = recipeWith({passes: 4, sampleSets: 1}, bestRecipe)

export const tuningSteps: Record<string, Step> = {
  // The trainer's setting: the passes and the start, then the other settings of the trainer on one pass. The four
  // recipes of the first step are two starts with two numbers of passes each, so every pair of them is compared.
  'passes-and-start': {...tuning([plainPass, onePassUniform, recipeWith({passes: 3}), threePasses]), everyPair: true},
  'trainer': tuning([
    onePassUniform,
    ...[0.02, 0.1, 0.2].map(learningRate => recipeWith({learningRate}, onePassUniform)),
    ...[0.5, 0.2].map(temperatureEnd => recipeWith({temperatureEnd}, onePassUniform)),
    recipeWith({sharpnessCost: 0.01}, onePassUniform), recipeWith({intendedWeight: 0.3}, onePassUniform),
    ...[8, 128].map(batchSize => recipeWith({batchSize}, onePassUniform)),
  ]),
  // More steps of Adam: the two settings that were ahead on one pass, on three passes.
  'more-steps': tuning([threePasses, recipeWith({batchSize: 8}, threePasses), recipeWith({learningRate: 0.1}, threePasses)]),
  // The open entries of the display table, as a setting of its own.
  'display-table': tuning([threePasses, recipeWith({displayTable: 'open'}, threePasses)]),
  // What the main number does not show: whole samples, valid JSON that is too deep, and code points shown as past the end.
  'whole-samples': tuning([onePassUniform, recipeWith({sampleWeightPower: 1}, onePassUniform), recipeWith({sampleWeightPower: 0.5}, onePassUniform), recipeWith({firstCodePoints: 8, firstCodePointsWeight: 4}, onePassUniform)]),
  'whole-samples-three-passes': tuning([threePasses, recipeWith({sampleWeightPower: 1}, threePasses), recipeWith({sampleWeightPower: 0.5}, threePasses)]),
  'too-deep': tuning([threePasses, recipeWith({tooDeepCells: 'kept'}, threePasses)]),
  'end-events': tuning([threePasses, recipeWith({endEvents: 'ruled out'}, threePasses)]),
  // More samples instead of more passes: four times the samples in one pass against the standard set in four passes.
  'more-samples': tuning([recipeWith({passes: 4, start: 'uniform'}), fourTimesTheSamples, onePassUniform]),
  // What was chosen, put together: more samples, with the two settings that keep what the main number does not show.
  'combined': tuning([fourTimesTheSamples, bestRecipe]),
  // Gradient, then search: the greedy search from the trained tables of the best recipe, in three orders per seed.
  'then-search': tuning([bestRecipe, ...bestThenSearched]),
}

export const reportedSteps: Record<string, Step> = {
  // The reported runs: the best recipe alone and with the search, once, with the seeds 1 to 5.
  'reported': reported([bestRecipe, ...bestThenSearched]),
  // The controls of the reported runs, with the same seeds: the search without the training, and the training
  // without the larger set of samples.
  'reported-controls': reported([...searchedWithoutTraining, bestOnTheStandardSet]),
}

export const steps: Record<string, Step> = {...tuningSteps, ...reportedSteps}

// The saved result of a recipe in a step's arm, or undefined when it was not run with the step's seeds yet.
export function savedRecipeOf(step: Step, recipe: Recipe): SettingResult | undefined {
  let result: SettingResult
  try {
    result = savedResultOf(step.armName, describeRecipe(recipe))
  } catch {
    return undefined
  }
  return result.seeds.length === step.seeds.length && result.seeds.every((seed, index) => seed === step.seeds[index]) ? result : undefined
}
