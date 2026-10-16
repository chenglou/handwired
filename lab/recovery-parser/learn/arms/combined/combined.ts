// What the scripts of the arm "combined" share: a recipe, i.e. one way to make recovering tables out of everything
// that the arms of round 1 found, its name, the function that builds its tables for a seed, and the steps of the arm,
// each a list of recipes that are read next to each other. README.md says what the arm asks and what it found.
//
// A recipe has a start (today's tables, or the 35 hand-written rules), additions to the layout (character classes,
// open display entries, the bit "first on its line", spare states), a training from the base's choices, two settings
// that keep what no sample asks for, and steps after the training: a search, a count of the display entries, and
// a third kept setting, today's kinds in the display entries of the grammar state `error`.
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {createRandom} from '../../../random.ts'
import {tooDeepText, tooDeepTextWithMembersAfter} from '../../check-texts.ts'
import {standardRange} from '../../data.ts'
import {handwrittenTables} from '../../handwritten/rules.ts'
import {codePointsOf, createTrace, runRecoveryParserInto} from '../../recovery-parser.ts'
import {type AddedClass, type RecoveryTables, actionCount, addClasses, addFirstOnLineBit, addStates, asIsTables, copyTables, displayEntryOf, loadTablesOfThisDataset, openDisplayEntries, tablesToJson, today} from '../../recovery-tables.ts'
import {type RunSamples, prepareSamples} from '../../search/sample-runs.ts'
import {train} from '../../soft/train.ts'
import {type TwinData, type TwinModel, createModel} from '../../soft/twin.ts'
import {classesChosenByHand, classesChosenFromTrainSamples, displayEntriesByCount, withErrorTarget} from '../extra-facts/facts.ts'
import {ruleOutEndEvents} from '../generic/generic.ts'
import {type Built, type SettingResult, armFolderOf, fileNameOf, savedResultOf, trainDataFor, trainPartOfTheStandardSet} from '../harness.ts'
import type {Cell} from '../holes/holes.ts'
import {searchCells} from '../holes/restricted-search.ts'
import {shownAsOf} from '../spare-states/spare-states.ts'
import {searchForWholeSamples} from './whole-search.ts'

export type Recipe = {
  // The tables before the additions: today's, or the 35 rules that a person wrote (../../handwritten/rules.ts).
  start: 'today' | 'hand-written'
  // Character classes: none, the ones that a rule picks from the train samples alone, or the 15 chosen by hand, see
  // ../extra-facts/facts.ts.
  classes: 'none' | 'train samples' | 'hand'
  // Open entries of the display table, and the bit "the token is the first on its line", see ../../structure/.
  displayEntries: boolean
  firstOnLineBit: boolean
  // States that today's tables do not have, as ../spare-states/ adds them.
  spareTokenizerStates: number
  spareGrammarStates: number
  // Passes of the trainer over the train samples of the standard set. Every trainable mix starts with a share of 0.9
  // on the choice of the base, and everything else is the trainer's default. With 0 nothing is trained.
  passes: number
  // 'kept' keeps the grammar cells that valid JSON of more than 16 levels reads out of the training and out of the
  // search, see cellsOfTooDeepValidJson.
  tooDeepCells: 'trained' | 'kept'
  // 'ruled out' keeps a trained tokenizer cell from taking an event of a text's end, see ruleOutEndEvents of
  // ../generic/generic.ts.
  endEvents: 'allowed' | 'ruled out'
  // Above 0, a code point that the damage added gets the display kind `error` as its label with this probability,
  // see withErrorTarget of ../extra-facts/facts.ts.
  errorTargetShare: number
  // With a number, a greedy search goes over the recipe's cells after the training, in a random order that the seed
  // and this number draw. `searchCounts` says what a choice of a cell is taken for: more scored code points right,
  // as the search of ../../search/ does, or more whole train samples first and more code points second.
  searchOrder: number | undefined
  searchCounts: 'code points' | 'whole samples'
  // The most passes of the search over its cells. Undefined is a search that ends by a pass that changes nothing,
  // which took 9 to 19 passes from trained tables.
  searchPasses: number | undefined
  // True sets every open display entry by a count over the train samples after the search, see
  // displayEntriesByCount of ../extra-facts/facts.ts.
  displayByCount: boolean
  // True goes on after the count with the recipe's search and the count in turns, until a count changes no display
  // entry, see roundsInTurns. The search reads the display table and changes no entry of it, so one search and one
  // count leave cells that were chosen with other entries than the tables end with.
  inTurns: boolean
  // True gives the display entries of the grammar state `error` today's kinds again as the last step, see
  // withTodaysKindsInErrorState.
  todaysKindsInErrorState: boolean
}

// The best row of ../extra-facts/: the 15 classes chosen by hand, open display entries and the bit, three passes
// from the base's choices. Every recipe of the arm is named by what it has otherwise.
export const bestOfExtraFacts: Recipe = {
  start: 'today', classes: 'hand', displayEntries: true, firstOnLineBit: true, spareTokenizerStates: 0, spareGrammarStates: 0, passes: 3, tooDeepCells: 'trained', endEvents: 'allowed',
  errorTargetShare: 0, searchOrder: undefined, searchCounts: 'code points', searchPasses: undefined, displayByCount: false, inTurns: false, todaysKindsInErrorState: false,
}
export const recipeWith = (changes: Partial<Recipe>, from: Recipe): Recipe => ({...from, ...changes})

// The limit of passes of a recipe's search, as the end of the search's name, e.g. ", at most 4 passes".
const passesOfSearch = (recipe: Recipe) => recipe.searchPasses === undefined ? '' : `, at most ${recipe.searchPasses} pass${recipe.searchPasses === 1 ? '' : 'es'}`

// A recipe's name, which is the name of its row and of its folder of saved runs, e.g. "today's tables, classes from
// the train samples, open display entries, the bit, 3 passes, too deep cells kept, no event of a text's end".
export function describeRecipe(recipe: Recipe): string {
  const states = (count: number, table: string) => `${count} spare ${table} state${count === 1 ? '' : 's'}`
  const parts: string[] = [recipe.start === 'today' ? 'today\'s tables' : 'the hand-written tables']
  if (recipe.classes !== 'none') parts.push(recipe.classes === 'hand' ? 'classes chosen by hand' : 'classes from the train samples')
  if (recipe.displayEntries) parts.push('open display entries')
  if (recipe.firstOnLineBit) parts.push('the bit')
  if (recipe.spareTokenizerStates > 0) parts.push(states(recipe.spareTokenizerStates, 'tokenizer'))
  if (recipe.spareGrammarStates > 0) parts.push(states(recipe.spareGrammarStates, 'grammar'))
  parts.push(recipe.passes === 0 ? 'no training' : `${recipe.passes} pass${recipe.passes === 1 ? '' : 'es'}`)
  if (recipe.tooDeepCells === 'kept') parts.push('too deep cells kept')
  if (recipe.endEvents === 'ruled out' && recipe.passes > 0) parts.push('no event of a text\'s end')
  if (recipe.errorTargetShare > 0) parts.push(`added code points as an error at the weight ${recipe.errorTargetShare}`)
  if (recipe.searchOrder !== undefined) parts.push(`then searched${recipe.searchCounts === 'whole samples' ? ' for whole samples' : ''}, order ${recipe.searchOrder}${passesOfSearch(recipe)}`)
  if (recipe.displayByCount) parts.push('then the display entries by a count')
  if (recipe.inTurns) parts.push('then the search and the count in turns')
  if (recipe.todaysKindsInErrorState) parts.push('then today\'s kinds in the state error')
  return parts.join(', ')
}

// A recipe's short name for a table of the report: the line of the arm that it belongs to, and what it has
// otherwise than that line's recipe, e.g. "generic, without the bit".
export function shortNameOf(recipe: Recipe): string {
  const states = (count: number, table: string) => `${count} spare ${table} state${count === 1 ? '' : 's'}`
  const parts: string[] = [recipe.start === 'hand-written' ? 'from the hand-written tables' : recipe.classes === 'hand' ? 'with the classes chosen by hand' : 'generic']
  if (recipe.classes === 'none') parts.push('without the classes')
  if (recipe.start === 'hand-written' && recipe.classes === 'train samples') parts.push('classes from the train samples')
  if (!recipe.displayEntries) parts.push('without the open display entries')
  if (!recipe.firstOnLineBit) parts.push('without the bit')
  if (recipe.spareTokenizerStates > 0) parts.push(states(recipe.spareTokenizerStates, 'tokenizer'))
  if (recipe.spareGrammarStates > 0) parts.push(states(recipe.spareGrammarStates, 'grammar'))
  if (recipe.passes !== 3) parts.push(recipe.passes === 0 ? 'no training' : `${recipe.passes} pass${recipe.passes === 1 ? '' : 'es'}`)
  if (recipe.tooDeepCells === 'trained' && recipe.endEvents === 'allowed') parts.push('without the two kept settings')
  else if (recipe.tooDeepCells === 'trained') parts.push('too deep cells trained')
  else if (recipe.endEvents === 'allowed' && recipe.passes > 0) parts.push('events of a text\'s end allowed')
  if (recipe.errorTargetShare > 0) parts.push(`added code points as an error at the weight ${recipe.errorTargetShare}`)
  if (recipe.searchOrder !== undefined) parts.push(`then searched${recipe.searchCounts === 'whole samples' ? ' for whole samples' : ''}, order ${recipe.searchOrder}${passesOfSearch(recipe)}`)
  if (recipe.displayByCount) parts.push('then the display entries by a count')
  if (recipe.inTurns) parts.push('then the search and the count in turns')
  if (recipe.todaysKindsInErrorState) parts.push('then today\'s kinds in the state error')
  return parts.join(', ')
}

// The classes that the rule of ../extra-facts/ picks from the train samples, made once per process.
let knownClassesFromTrainSamples: AddedClass[] | undefined
const classesOf = (recipe: Recipe): readonly AddedClass[] =>
  recipe.classes === 'none' ? [] : recipe.classes === 'hand' ? classesChosenByHand : knownClassesFromTrainSamples ??= classesChosenFromTrainSamples(trainPartOfTheStandardSet())

// The tables that a recipe's training starts from, a new copy on every call: its start with its additions. An added
// class and the bit copy the cells that are there, so the hand-written rules for the class `other` are also the
// rules of e.g. the apostrophe's class until a run changes them.
export function baseOf(recipe: Recipe): RecoveryTables {
  let base = recipe.start === 'today' ? asIsTables() : handwrittenTables().tables
  const classes = classesOf(recipe)
  if (classes.length > 0) base = addClasses(base, classes)
  if (recipe.displayEntries) base = openDisplayEntries(base)
  if (recipe.firstOnLineBit) base = addFirstOnLineBit(base)
  if (recipe.spareTokenizerStates + recipe.spareGrammarStates > 0) base = addStates(base, recipe.spareTokenizerStates, shownAsOf(recipe.spareGrammarStates))
  return base
}

// The open grammar cells that valid JSON of more than 16 levels reads from its first error on with the tables
// `base`, as a mask with 1 per cell. Such a text has its first error at its 17th opening bracket and reads open cells
// from there on, and the dataset has no such text, so a training is free to break its depth, see ../../check-deep.ts.
//
// It is cellsOfTooDeepValidJson of ../generic/generic.ts for any layout and any base. The mask holds:
// - the cells that 2,000 texts of each of the two forms of check-deep.ts read with `base`, from other random streams
//   than the check's,
// - the whole row of the state `error`, which a too deep text of another form reads,
// - for tables with the bit "first on its line", the copy of each such cell with the other value of the bit: the
//   texts above have no line feed, and a text that is spread over lines reads the copies with the bit.
// Tables that hold the base's choice in these cells give each of those 4,000 texts the grammar states, the depths
// and the containers of `base`. When `base` holds today's choices there, as every base of today's tables does, those
// are today's for every too deep valid text: its first error leads into the state `error`, the row of that state
// leads nowhere else, and its tokenizer cells are the ones of valid JSON, which are frozen, also for an added class.
// What such a text is shown as is not kept by these cells: from its 17th bracket on it reads the display entries of
// the state `error`, which are open, see withTodaysKindsInErrorState.
//
// For the hand-written tables as the base the mask keeps what the base does on chains of nested containers, in
// the four such forms that check.ts tries, and not on every too deep valid text: the rules go on after the 17th
// bracket in other states than `error`, so a text of another shape, e.g. with a small container beside the nested
// one, reads cells outside the mask. And the base itself loses the depth of some such texts, e.g. of
// `{"a": {"a": []}, "b": 1}` inside 14 objects. The rule for `[` at depth 16 goes on to the state `valueOrClose`,
// the `]` then reads a cell that no rule set and that leads into `error`, and the rule for a comma in the state
// `error` inside an object pops a level, here one that is still open. check.ts counts both.
export function cellsOfTooDeepValidJson(base: RecoveryTables): Uint8Array {
  const cells = new Uint8Array(base.grammarNext.length)
  const trace = createTrace()
  for (const {make, stream} of [{make: tooDeepText, stream: 27}, {make: tooDeepTextWithMembersAfter, stream: 28}]) {
    const random = createRandom(standardRange.seed, stream)
    for (let text = 0; text < 2000; text++) {
      const {codePoints} = codePointsOf(make(random))
      runRecoveryParserInto(trace, codePoints, 0, codePoints.length, false, base, codePoints.length)
      for (let position = trace.firstErrorPosition; position < codePoints.length; position++) cells[trace.grammarCell[position]!] = 1
    }
  }
  const cellsPerState = base.tokenCount * base.contextCount
  cells.fill(1, today.errorState * cellsPerState, (today.errorState + 1) * cellsPerState)
  if (base.contextCount > today.contextCount) {
    for (let cell = 0; cell < cells.length; cell++) {
      const context = cell % base.contextCount
      if (cells[cell] === 1) cells[cell - context + (context + today.contextCount) % base.contextCount] = 1
    }
  }
  // A frozen cell holds today's choice whatever a run does.
  for (let cell = 0; cell < cells.length; cell++) if (base.grammarOpen[cell] === 0) cells[cell] = 0
  return cells
}

// A copy of `tables` with today's kinds in the display entries of the grammar state `error`: the third kept
// setting. A valid JSON text of more than 16 levels is in that state from its 17th bracket on when the kept cells
// hold today's choices, so these entries are what the rest of it is shown by, e.g. (closeArray, error) for every `]`.
// They are open, and a training or a count sets them from the few broken train code points that end in that state:
// two of ten seeds of the generic recipe then show every such `]` as a string. With today's kinds there, a too deep
// valid text is shown as today at every code point, for every base of today's tables. The line from the
// hand-written tables does not have the setting: there it costs up to 1.09 points of all three in one seed, and the
// base's own rules already change what a too deep valid text is shown as, see README.md.
export function withTodaysKindsInErrorState(tables: RecoveryTables): RecoveryTables {
  const result = copyTables(tables)
  for (let event = 0; event < tables.eventCount; event++) result.display[displayEntryOf(tables, event, today.errorState)] = today.display[event * today.grammarStateCount + today.errorState]!
  return result
}

// The mask of the grammar cells that a recipe may change, by its training and by its search: every open one,
// without the cells of too deep valid JSON when the recipe keeps those.
export function trainableGrammarCellsOf(recipe: Recipe, base: RecoveryTables): Uint8Array {
  if (recipe.tooDeepCells === 'trained') return base.grammarOpen.slice()
  const kept = cellsOfTooDeepValidJson(base)
  return base.grammarOpen.map((open, cell) => open === 1 && kept[cell] === 0 ? 1 : 0)
}

// The random stream of a spare state's start. The trainer orders the samples of its pass p with the stream p of the
// same seed, and the error target draws from the stream 2,000,000, so the start has a stream of its own.
const streamOfTheSpareStates = 3_000_000

// Gives the spare states of a model the random start of ../spare-states/: every weight of a spare state's own
// cells, and every weight with which another trainable cell leads into a spare state, gets a draw of the standard
// normal distribution added, from the run's seed. Without it two spare states stay the same state.
function startSpareStates(model: TwinModel, seed: number) {
  const {base} = model
  const random = createRandom(seed, streamOfTheSpareStates)
  const normal = () => Math.sqrt(-2 * Math.log(1 - random.next())) * Math.cos(2 * Math.PI * random.next())
  const startOf = (trainable: Uint8Array, cellsPerState: number, firstSpare: number, next: {weights: Float64Array, width: number}, other: {weights: Float64Array, width: number}) => {
    for (let cell = 0; cell < trainable.length; cell++) {
      if (trainable[cell] === 0) continue
      if (Math.floor(cell / cellsPerState) >= firstSpare) {
        for (const group of [next, other]) for (let choice = 0; choice < group.width; choice++) group.weights[cell * group.width + choice]! += normal()
      } else {
        for (let state = firstSpare; state < next.width; state++) next.weights[cell * next.width + state]! += normal()
      }
    }
  }
  startOf(model.trainableLexer, base.classCount, today.lexerStateCount, {weights: model.weights.lexerNext, width: base.lexerStateCount}, {weights: model.weights.lexerEvent, width: base.eventCount})
  startOf(model.trainableGrammar, base.tokenCount * base.contextCount, today.grammarStateCount, {weights: model.weights.grammarNext, width: base.grammarStateCount}, {weights: model.weights.grammarAction, width: actionCount})
}

// The model of a recipe for a seed, made once per run: `train` changes the model that it is given.
export function modelOf(recipe: Recipe, base: RecoveryTables, seed: number): TwinModel {
  const model = createModel(base, {start: 'base', trainable: {lexer: 'open', grammar: trainableGrammarCellsOf(recipe, base), display: 'open'}})
  if (recipe.endEvents === 'ruled out') ruleOutEndEvents(model)
  if (recipe.spareTokenizerStates + recipe.spareGrammarStates > 0) startSpareStates(model, seed)
  return model
}

// What the train samples are packed by and the search's samples are prepared by: the classes of the code points and
// whether the tables have the bit. Spare states change neither.
const layoutKeyOf = (base: RecoveryTables) => `${base.addedClasses.map(({name, codePoints}) => `${name} ${codePoints.join(' ')}`).join(', ')} | ${base.contextCount}`

// The train samples of the standard set, packed for the twin and prepared for the search, once per layout and process.
const knownTrainData = new Map<string, TwinData>()
function trainDataOf(base: RecoveryTables): TwinData {
  const key = layoutKeyOf(base)
  let data = knownTrainData.get(key)
  if (data === undefined) {
    data = trainDataFor(base)
    knownTrainData.set(key, data)
  }
  return data
}
const knownSearchSamples = new Map<string, RunSamples>()
function searchSamplesOf(base: RecoveryTables): RunSamples {
  const key = layoutKeyOf(base)
  let samples = knownSearchSamples.get(key)
  if (samples === undefined) {
    samples = prepareSamples(trainPartOfTheStandardSet(), base)
    knownSearchSamples.set(key, samples)
  }
  return samples
}

async function trainRecipe(recipe: Recipe, seed: number): Promise<RecoveryTables> {
  const base = baseOf(recipe)
  if (recipe.passes === 0) return base
  const data = trainDataOf(base)
  const result = await train(modelOf(recipe, base, seed), recipe.errorTargetShare > 0 ? withErrorTarget(data, recipe.errorTargetShare, seed) : data, {
    seed, epochs: recipe.passes, learningRate: 0.05, temperatureStart: 1, temperatureEnd: 1, sharpnessCost: 0, logEverySamples: 1e9, log: () => {},
  })
  return result.last
}

// The file of the tables that run.ts saved for a recipe and a seed under an arm name.
export const savedTablesFileOf = (armName: string, recipe: Recipe, seed: number) => join(armFolderOf(armName), fileNameOf(describeRecipe(recipe)), `seed-${seed}.tables.json`)

// The cells that a recipe's search goes over: every open tokenizer cell, and the grammar cells that the recipe may change.
export function searchedCellsOf(recipe: Recipe, base: RecoveryTables): Cell[] {
  const grammarCells = trainableGrammarCellsOf(recipe, base)
  const cells: Cell[] = []
  for (let cell = 0; cell < base.lexerOpen.length; cell++) if (base.lexerOpen[cell] === 1) cells.push({grammar: false, cell})
  for (let cell = 0; cell < grammarCells.length; cell++) if (grammarCells[cell] === 1) cells.push({grammar: true, cell})
  return cells
}

// A recipe's search from the tables `start`, on the train split of the standard set, in a random order that is
// drawn anew for every pass from a seed that the run's seed and the recipe's order number make, e.g. 113 for seed 11
// and order 3. A search with a limit of passes stops after them, at the same step on every run.
async function searchFrom(start: RecoveryTables, recipe: Recipe, searchOrder: number, seed: number): Promise<RecoveryTables> {
  const base = baseOf(recipe)
  const started = performance.now()
  const search = recipe.searchCounts === 'whole samples' ? searchForWholeSamples : searchCells
  const result = await search(start, searchedCellsOf(recipe, base), searchSamplesOf(base), seed * 10 + searchOrder, recipe.searchPasses ?? 200)
  if (recipe.searchPasses === undefined && !result.lastPassChangedNothing) throw new Error(`the search of ${JSON.stringify(describeRecipe(recipe))} did not end in ${result.passes} passes`)
  console.log(`The search ended ${result.lastPassChangedNothing ? `when pass ${result.passes} changed nothing` : `after its ${result.passes} passes`}, after ${result.changes} changes of a cell and ${(result.runs / 1e6).toFixed(1)} million runs of a sample, in ${((performance.now() - started) / 1000).toFixed(0)} s.`)
  return result.tables
}

// The most rounds of a search and a count that a recipe with `inTurns` adds. A round whose count changes no display
// entry ends the turns: the search before it ended with those entries, so the next one would change no cell.
const roundsInTurns = 8

// The tables of a recipe for a seed, by its last step: today's kinds in the state `error`, then the search and the
// count in turns, then the count of the display entries, then the search, then the training, whose tables are the
// last ones of the trainer's run. A step starts from the tables of the recipe without it: the ones that an earlier
// command saved under `armName`, when there are such, since a seed gives the same tables every time, and otherwise
// they are made here. For a recipe without a training the seed only draws the order of the search.
async function tablesOf(recipe: Recipe, seed: number, armName: string): Promise<RecoveryTables> {
  const savedOrMade = (earlier: Recipe) => {
    const file = savedTablesFileOf(armName, earlier, seed)
    return existsSync(file) ? loadTablesOfThisDataset(file).tables : tablesOf(earlier, seed, armName)
  }
  if (recipe.todaysKindsInErrorState) return withTodaysKindsInErrorState(await savedOrMade(recipeWith({todaysKindsInErrorState: false}, recipe)))
  if (recipe.inTurns) {
    if (recipe.searchOrder === undefined || !recipe.displayByCount) throw new Error('a recipe with the search and the count in turns needs a search and a count')
    let tables = await savedOrMade(recipeWith({inTurns: false}, recipe))
    for (let round = 1; round <= roundsInTurns; round++) {
      const searchedTables = await searchFrom(tables, recipe, recipe.searchOrder, seed)
      tables = displayEntriesByCount(searchedTables, trainPartOfTheStandardSet())
      const entriesChanged = tablesToJson(tables) !== tablesToJson(searchedTables)
      console.log(`Round ${round} of the turns: the count after the search ${entriesChanged ? 'changed' : 'did not change'} the display entries.`)
      if (!entriesChanged) break
    }
    return tables
  }
  if (recipe.displayByCount) {
    if (!recipe.displayEntries) throw new Error('a recipe that sets the display entries by a count needs open display entries')
    return displayEntriesByCount(await savedOrMade(recipeWith({displayByCount: false}, recipe)), trainPartOfTheStandardSet())
  }
  if (recipe.searchOrder === undefined) return trainRecipe(recipe, seed)
  return searchFrom(await savedOrMade(recipeWith({searchOrder: undefined, searchCounts: 'code points', searchPasses: undefined}, recipe)), recipe, recipe.searchOrder, seed)
}
export const buildRecipe = async (recipe: Recipe, seed: number, armName: string): Promise<Built> => ({tables: await tablesOf(recipe, seed, armName), base: baseOf(recipe)})

// The two lines of the arm. `generic` holds nothing that a person knows about broken JSON: today's tables, the
// classes of the rule that reads the train samples, the two additions that are structure, and the two kept settings.
// `withHandClasses` has the 15 classes chosen by hand in place of the rule's, and `fromHandWritten` also starts from
// the 35 hand-written rules.
export const generic = recipeWith({classes: 'train samples', tooDeepCells: 'kept', endEvents: 'ruled out'}, bestOfExtraFacts)
export const withHandClasses = recipeWith({classes: 'hand'}, generic)
export const fromHandWritten = recipeWith({start: 'hand-written'}, withHandClasses)
const withoutTheKeptSettings = (recipe: Recipe) => recipeWith({tooDeepCells: 'trained', endEvents: 'allowed'}, recipe)
export const searchOrders = [1, 2, 3]
// The search of the arm after a recipe's training, in one of its orders: at most so many passes over the cells,
// which the step search-passes chose.
export const passesOfTheSearch = 4
export const searched = (recipe: Recipe) => (searchOrder: number) => recipeWith({searchOrder, searchPasses: passesOfTheSearch}, recipe)
const counted = (recipe: Recipe) => recipeWith({displayByCount: true}, recipe)
const shownAsToday = (recipe: Recipe) => recipeWith({todaysKindsInErrorState: true}, recipe)
// The same search until a pass changes nothing, in its first order, and that search with the count after it and
// then both in turns.
const searchedToTheEnd = (recipe: Recipe) => recipeWith({searchOrder: searchOrders[0]!}, recipe)
const searchedAndCountedInTurns = (recipe: Recipe) => recipeWith({inTurns: true}, counted(searchedToTheEnd(recipe)))
const untrained = recipeWith({passes: 0}, generic)

// A step of the arm: recipes that are read next to each other, the first one the control of the others unless
// report.ts says otherwise. The tuning steps run with the seeds 11, 12 and 13 and save under "combined-tuning". The
// candidates run once with the seeds 1 to 5, under "combined", and once with the seeds 21 to 25, which nothing has
// used, under "combined-confirmation".
export type Step = {armName: string, seeds: readonly number[], recipes: readonly Recipe[]}
export const tuningSeeds = [11, 12, 13]
export const reportedSeeds = [1, 2, 3, 4, 5]
export const confirmationSeeds = [21, 22, 23, 24, 25]
const tuning = (recipes: readonly Recipe[]): Step => ({armName: 'combined-tuning', seeds: tuningSeeds, recipes})

export const tuningSteps: Record<string, Step> = {
  // 1. The recipe without the losses: each line with the two kept settings, against the same training without them.
  // The control of the line with the classes chosen by hand is the best row of ../extra-facts/, which that arm saved
  // with these seeds: bestOfExtraFacts is its recipe, and check.ts shows that it gives the saved tables.
  'kept': tuning([generic, withoutTheKeptSettings(generic), withHandClasses]),
  // 2. What each part adds when the others are there: the generic recipe without one of its three additions.
  'parts': tuning([generic, recipeWith({classes: 'none'}, generic), recipeWith({displayEntries: false}, generic), recipeWith({firstOnLineBit: false}, generic)]),
  // 3. The trainer: one pass and five passes against three, and the display entries by a count as a last step.
  'trainer': tuning([generic, recipeWith({passes: 1}, generic), recipeWith({passes: 5}, generic), counted(generic)]),
  // 4. Spare states on top: 4 spare tokenizer states, and 2 spare grammar states.
  'spare-states': tuning([generic, recipeWith({spareTokenizerStates: 4}, generic), recipeWith({spareGrammarStates: 2}, generic)]),
  // 5. A search after the training. First how many passes it needs: the search of the first order until a pass
  // changes nothing, against the same search stopped after 2 and after 4 passes. Then the search with the limit of
  // passes that this chose, in three orders per seed, with the count of the display entries after the first order.
  'search-passes': tuning([generic, searchedToTheEnd(generic), ...[2, 4].map(searchPasses => recipeWith({searchOrder: searchOrders[0]!, searchPasses}, generic))]),
  'then-search': tuning([generic, ...searchOrders.map(searched(generic)), counted(searched(generic)(searchOrders[0]!))]),
  // The search without the training, with the limit of passes and until a pass changes nothing: its seed only draws
  // the order, which is the order of the search after the training of the same seed, so the three runs of each are
  // three orders. The search sets no display entry, so the tables of the first two recipes hold today's display
  // table, where trained tables hold trained entries. The next three set the entries without gradients: the count
  // after each of the two searches, and the search and the count in turns. The last two are the rows with the
  // training that the controls until a pass changes nothing are read against, with the same steps after it.
  'search-alone': tuning([
    searched(untrained)(searchOrders[0]!), searchedToTheEnd(untrained),
    counted(searched(untrained)(searchOrders[0]!)), counted(searchedToTheEnd(untrained)), searchedAndCountedInTurns(untrained),
    counted(searchedToTheEnd(generic)), searchedAndCountedInTurns(generic),
  ]),
  // 6. The remedy for whole samples: the same search with whole train samples counted first.
  'whole-samples': tuning([generic, ...searchOrders.map(searchOrder => recipeWith({searchCounts: 'whole samples'}, searched(generic)(searchOrder)))]),
  // 7. The hand-written tables as the base, against the same recipe from today's tables.
  'hand-written': tuning([withHandClasses, fromHandWritten, recipeWith({passes: 1}, fromHandWritten), recipeWith({passes: 0}, fromHandWritten)]),
  // 8. The third kept setting as the last step of the generic recipe with its search and its count, against the
  // same recipe without it.
  'shown-as-today': tuning([counted(searched(generic)(searchOrders[0]!)), shownAsToday(counted(searched(generic)(searchOrders[0]!)))]),
}

// The candidates for the final scoring, chosen on the tuning seeds: the best recipe of each line. Each is the
// line's training, then the search in its first order, then the display entries set by a count. The two from
// today's tables then get today's kinds in the display entries of the state `error`, which a review of the arm asked
// for after their first scores: without it they show valid JSON deeper than 16 levels otherwise than today.
export type Candidate = {name: string, description: string, recipe: Recipe}
const afterTheTraining = `then ${passesOfTheSearch} passes of a greedy search over the same cells on the train samples, then every open display entry set by a count over the train samples`
export const candidates: readonly Candidate[] = [
  {
    name: 'generic', recipe: shownAsToday(counted(searched(generic)(searchOrders[0]!))),
    description: `Today's tables with the classes that a rule picks from the train samples, open display entries and the bit "first on its line", every open cell trained in three passes from today's choices, with the cells of too deep valid JSON kept and no event of a text's end, ${afterTheTraining}, then today's kinds in the display entries of the grammar state error, so that valid JSON deeper than 16 levels is shown as today.`,
  },
  {name: 'with the classes chosen by hand', recipe: shownAsToday(counted(searched(withHandClasses)(searchOrders[0]!))), description: 'The generic recipe with the 15 classes chosen by hand in place of the rule\'s.'},
  {
    name: 'from the hand-written tables', recipe: counted(searched(fromHandWritten)(searchOrders[0]!)),
    description: 'The recipe with the classes chosen by hand, started from the 35 hand-written rules in place of today\'s tables, and without its last step: the display entries of the grammar state error stay as the count set them.',
  },
]
// A candidate's recipe up to its count, up to its search, and its training alone: the controls of the steps after
// each. And every line with the third kept setting after its count, which is the candidate for two of the lines and
// says what the setting would cost the third.
export const countOfCandidate = (candidate: Candidate) => recipeWith({todaysKindsInErrorState: false}, candidate.recipe)
export const searchOfCandidate = (candidate: Candidate) => recipeWith({displayByCount: false}, countOfCandidate(candidate))
export const trainingOfCandidate = (candidate: Candidate) => recipeWith({searchOrder: undefined, searchPasses: undefined}, searchOfCandidate(candidate))
export const shownAsTodayOfCandidate = (candidate: Candidate) => shownAsToday(countOfCandidate(candidate))
const candidateRecipes = [trainingOfCandidate, searchOfCandidate, countOfCandidate, shownAsTodayOfCandidate].flatMap(step => candidates.map(step))

export const reportedSteps: Record<string, Step> = {
  'candidates': {armName: 'combined', seeds: reportedSeeds, recipes: candidateRecipes},
  'confirmation': {armName: 'combined-confirmation', seeds: confirmationSeeds, recipes: candidateRecipes},
  // 9. The target that shows the added code points as an error, at the weight 0.1, on the first candidate: its
  // training with the target, and that training with the candidate's search after it. Neither has the count as its
  // last step: the count gives every display entry the kind of a label, which is never an error.
  'error-target': {armName: 'combined', seeds: reportedSeeds, recipes: [trainingOfCandidate(candidates[0]!), searchOfCandidate(candidates[0]!)].map(recipe => recipeWith({errorTargetShare: 0.1}, recipe))},
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
