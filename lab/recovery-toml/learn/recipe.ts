// The frozen recipe: the candidate "generic" of lab/recovery-parser/learn/arms/combined/combined.ts as one function,
// for the TOML tables. Nothing in it was tuned for TOML, and nothing in it knows TOML: every setting is the one that
// the JSON side chose on JSON samples. Its steps:
//
// 1. The base: today's tables with the character classes that a rule picks from the train samples, open entries of
//    the display table, and the bit "first on its line".
// 2. The training: every open cell and every open display entry, three passes over the train samples, from a share
//    of 0.9 on the base's choice, with two kept settings. The grammar cells that valid documents deeper than 16
//    levels read hold the base's choice, and no trained tokenizer cell can take an event of a text's end.
// 3. Only in the second row: four passes of the greedy search of search/search.ts over the same cells.
// 4. The count: every open display entry gets the kind that the most train code points want there.
// 5. The third kept setting: today's kinds in the display entries of the grammar state `error`.
//
// runRecipe returns two rows: the training, then the count and the last step, which is the primary row, and the same
// with the search before the count. Each part below names the JSON function that it is a copy of.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo and with the dataset in place:
//   bun lab/recovery-toml/learn/recipe.ts [--seed 1] [--without-search]
// It trains on the train split of the standard set, saves the tables of both rows to <scratch>/recipe/, and prints
// their scores on the validation split next to the parser as it is.
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {displayKind} from '../kinds.ts'
import {tooDeepText, tooDeepTextWithMembersAfter} from './check-texts.ts'
import {type Samples, codePointKept, codePointKindScored, codePointNestingScored, loadStandardSamples, trainPart, validationPart} from './data.ts'
import {optionOf, refuseUnknownOptions} from './options.ts'
import {createRandom} from './random.ts'
import {codePointsOf, createTrace, runRecoveryParserInto} from './recovery-parser.ts'
import {
  type AddedClass, type RecoveryTables, addClasses, addFirstOnLineBit, asIsTables, cellCounts, classNames, copyTables, differencesOf, displayEntryOf, displayKindCount, eventNames, openDisplayEntries, saveTables, today,
} from './recovery-tables.ts'
import {type ScoreRow, runOnSample, scoreTables, sharesOf} from './score.ts'
import {prepareSamples} from './search/sample-runs.ts'
import {type Cell, searchCells} from './search/search.ts'
import {train} from './soft/train.ts'
import {packForTwin, placesForTwin} from './soft/twin-data.ts'
import {type TwinModel, createModel} from './soft/twin.ts'

// The settings of the recipe, each with the place on the JSON side that sets it. None may change.
export const recipeSettings = {
  // The rule of the classes: leastSamplesOfTheRule and leastDistanceOfTheRule of arms/extra-facts/facts.ts.
  leastSamplesOfTheRule: 100,
  leastDistanceOfTheRule: 0.5,
  // The training: `passes: 3` and `start: 'base'` of bestOfExtraFacts in arms/combined/combined.ts, and the options
  // that trainRecipe of that file gives to train. The batch of 32 samples, the 4 worker threads and the depths -8 to
  // 24 are the trainer's defaults, and the share of 0.9 is createModel's.
  passes: 3,
  startShare: 0.9,
  learningRate: 0.05,
  batchSize: 32,
  temperature: 1,
  sharpnessCost: 0,
  // The kept cells: 2,000 texts of each of the two forms, from the random streams 27 and 28, as
  // cellsOfTooDeepValidJson of arms/combined/combined.ts. The seed is the JSON dataset's, which that function takes
  // from its standard set.
  tooDeepTexts: 2000,
  tooDeepSeed: 20261015,
  tooDeepStreams: [27, 28],
  // The search: `passesOfTheSearch` and the first of `searchOrders` of arms/combined/combined.ts. The order of a
  // pass is drawn from the seed run seed × 10 + search order.
  searchPasses: 4,
  searchOrder: 1,
} as const

// One code point of the train samples, as the rule below sees it.
export type CodePointOfTheRule = {
  codePoint: number
  // The class that the code point has today, by its number.
  classToday: number
  // How often the code point comes at or after a first error, and in how many train samples.
  occurrences: number
  samples: number
  // The total variation distance between the code point's outcomes and the outcomes of the other code points of its
  // class: the share of the code point's occurrences that would have to be something else for the code point to be
  // as the rest of its class, from 0 to 1.
  distance: number
  // The outcome that the code point has most often, e.g. "stringStart", and its share.
  mostFrequentOutcome: string
  shareOfMostFrequentOutcome: number
  picked: boolean
  // Why a code point that the rule picks gets no class, or '' when it gets one.
  notAdded: string
}

// What a code point after a first error is, for the rule: the event that today's parser has at its counterpart in
// the original, e.g. `stringStart`, or "added" when the damage added it.
const outcomeNames: readonly string[] = [...eventNames, 'added']

// The rule that chooses classes from the train samples alone: codePointsOfTheRule of arms/extra-facts/facts.ts. For
// every code point at or after a first error it counts what the code point is: the event at its counterpart in the
// original, or "added". A code point gets a class of its own when at least 100 train samples have it there and its
// outcomes are far from the outcomes of the other code points of its class: a distance of 0.5 or more, i.e. half of
// its occurrences would have to be something else. Returns every code point that at least 100 train samples have,
// from the largest distance down.
//
// One case that the JSON function does not have to deal with: a picked code point whose class would be left without
// a code point, which addClasses refuses. The TOML tables have many small classes, e.g. `digit8Or9` with two code
// points, and when the rule picks every code point of a class, the last one stays where it is: `notAdded` says so.
export function codePointsOfTheRule(trainSamples: Samples): CodePointOfTheRule[] {
  const lastClassEntry = today.classOfCodePoint.length - 1
  const classOf = (codePoint: number) => today.classOfCodePoint[Math.min(codePoint + 1, lastClassEntry)]!
  const countsOfCodePoint = new Map<number, {outcomes: Float64Array, samples: number, lastSample: number}>()
  const countsOfClass = Array.from({length: today.classCount}, () => new Float64Array(outcomeNames.length))
  for (let place = 0; place < trainSamples.sampleCount; place++) {
    const firstError = trainSamples.firstErrorPosition[place]!
    if (trainSamples.firstDamage[place] === -1 || firstError === -1) continue
    const start = trainSamples.start[place]!
    const length = trainSamples.start[place + 1]! - start
    for (let position = firstError; position < length; position++) {
      const codePoint = trainSamples.codePoints[start + position]!
      const kept = (trainSamples.flags[start + position]! & codePointKept) !== 0
      if (kept && trainSamples.intendedEvent[start + position] === -1) throw new Error('the rule of the classes needs the intended events, i.e. samples with their originals')
      const outcome = kept ? trainSamples.intendedEvent[start + position]! : eventNames.length
      let counts = countsOfCodePoint.get(codePoint)
      if (counts === undefined) {
        counts = {outcomes: new Float64Array(outcomeNames.length), samples: 0, lastSample: -1}
        countsOfCodePoint.set(codePoint, counts)
      }
      counts.outcomes[outcome]!++
      countsOfClass[classOf(codePoint)]![outcome]!++
      if (counts.lastSample !== place) {
        counts.lastSample = place
        counts.samples++
      }
    }
  }
  const total = (counts: Float64Array) => counts.reduce((sum, count) => sum + count, 0)
  const result: CodePointOfTheRule[] = []
  for (const [codePoint, counts] of countsOfCodePoint) {
    if (counts.samples < recipeSettings.leastSamplesOfTheRule) continue
    const occurrences = total(counts.outcomes)
    const rest = countsOfClass[classOf(codePoint)]!.map((count, outcome) => count - counts.outcomes[outcome]!)
    const occurrencesOfTheRest = total(rest)
    // A code point that is alone in its class has nothing to be told apart from.
    if (occurrencesOfTheRest === 0) continue
    const shares = Array.from(counts.outcomes, count => count / occurrences)
    const sharesOfTheRest = Array.from(rest, count => count / occurrencesOfTheRest)
    const distance = shares.reduce((sum, share, outcome) => sum + Math.abs(share - sharesOfTheRest[outcome]!), 0) / 2
    const mostFrequent = shares.indexOf(Math.max(...shares))
    result.push({
      codePoint, classToday: classOf(codePoint), occurrences, samples: counts.samples, distance, mostFrequentOutcome: outcomeNames[mostFrequent]!, shareOfMostFrequentOutcome: shares[mostFrequent]!,
      picked: distance >= recipeSettings.leastDistanceOfTheRule, notAdded: '',
    })
  }
  result.sort((left, right) => right.distance - left.distance || left.codePoint - right.codePoint)
  // How many code points each class of today's still has. The last entry of the class table stands for every code
  // point past the table, so its class never runs out.
  const left = new Float64Array(today.classCount)
  for (let entry = 1; entry < today.classOfCodePoint.length; entry++) left[today.classOfCodePoint[entry]!]!++
  left[today.classOfCodePoint[lastClassEntry]!] = Infinity
  for (const entry of result) {
    if (!entry.picked) continue
    if (left[entry.classToday]! <= 1) entry.notAdded = `the class ${classNames[entry.classToday]} would be left without a code point`
    else left[entry.classToday]!--
  }
  return result
}

// The classes that the rule chooses: one class per picked code point, named by the code point, e.g. "U+003B".
export const classesChosenFromTrainSamples = (trainSamples: Samples): AddedClass[] =>
  codePointsOfTheRule(trainSamples).filter(entry => entry.picked && entry.notAdded === '').map(({codePoint}) => ({name: `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`, codePoints: [codePoint]}))

// The base of the recipe: today's tables with the classes, open display entries and the bit, as baseOf of
// arms/combined/combined.ts makes them for the recipe `generic`.
export const baseOfRecipe = (classes: readonly AddedClass[]): RecoveryTables => {
  const withClasses = classes.length > 0 ? addClasses(asIsTables(), classes) : asIsTables()
  return addFirstOnLineBit(openDisplayEntries(withClasses))
}

// The first kept setting: the open grammar cells that a valid TOML text with a value of more than 16 levels reads
// from its first error on with the tables `base`, as a mask with 1 per cell. It is cellsOfTooDeepValidJson of
// arms/combined/combined.ts, made by the same rule. Such a text has its first error at its 17th opening bracket and
// reads open cells from there on, and no sample asks for anything there, so a training is free to break its depth.
//
// The mask holds:
// - the cells that 2,000 texts of each of the two forms of check-texts.ts read with `base`, the first form with
//   nothing but closing brackets after the innermost container and the second with members after the nested
//   containers,
// - the whole row of the state `error`, which a too deep text of another form reads,
// - for tables with the bit "first on its line", the copy of each such cell with the other value of the bit.
// Tables that hold the base's choice in these cells give every too deep valid text today's grammar states, depths
// and containers: its first error leads into the state `error`, the row of that state leads nowhere else, and its
// tokenizer cells are the ones of valid TOML, which are frozen. What such a text is shown as is not kept by these
// cells: from its 17th bracket on it reads the display entries of the state `error`, which are open, see
// withTodaysKindsInErrorState.
export function cellsOfTooDeepValidTexts(base: RecoveryTables): Uint8Array {
  const cells = new Uint8Array(base.grammarNext.length)
  const trace = createTrace()
  const makers = [tooDeepText, tooDeepTextWithMembersAfter]
  makers.forEach((make, form) => {
    const random = createRandom(recipeSettings.tooDeepSeed, recipeSettings.tooDeepStreams[form]!)
    for (let text = 0; text < recipeSettings.tooDeepTexts; text++) {
      const {codePoints} = codePointsOf(make(random))
      runRecoveryParserInto(trace, codePoints, 0, codePoints.length, false, base, codePoints.length)
      if (trace.firstErrorPosition === -1) throw new Error('a text with a value of more than 16 levels has no first error')
      for (let position = trace.firstErrorPosition; position < codePoints.length; position++) cells[trace.grammarCell[position]!] = 1
    }
  })
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

// The mask of the grammar cells that the recipe may change, by its training and by its search: every open one
// without the kept ones.
export function trainableGrammarCellsOf(base: RecoveryTables): Uint8Array {
  const kept = cellsOfTooDeepValidTexts(base)
  return base.grammarOpen.map((open, cell) => open === 1 && kept[cell] === 0 ? 1 : 0)
}

const endEvents = (['end', 'endInsideToken', 'truncatedEnd'] as const).map(name => eventNames.indexOf(name))
const endClasses = (['end', 'truncatedEnd'] as const).map(name => classNames.indexOf(name))

// The second kept setting: ruleOutEndEvents of arms/generic/generic.ts. It takes the three events of a text's end
// out of the mixes of the trainable tokenizer cells that a code point of a text reads: their weights become
// -Infinity, so their share is exactly 0, no gradient moves them, and snapping never picks them. A code point with
// such an event is shown as "past the end", the display kind of the cells after a text. The cells of the two classes
// of a text's end keep their events.
export function ruleOutEndEvents(model: TwinModel) {
  const {classCount, eventCount, lexerEvent} = model.base
  for (let cell = 0; cell < model.trainableLexer.length; cell++) {
    if (model.trainableLexer[cell] === 0 || endClasses.includes(cell % classCount) || endEvents.includes(lexerEvent[cell]!)) continue
    for (const event of endEvents) model.weights.lexerEvent[cell * eventCount + event] = -Infinity
  }
}

// The count: displayEntriesByCount of arms/extra-facts/facts.ts. A copy of `tables` with open display entries, each
// set to the display kind that the most code points of the train samples want there: the scored code points that
// read the entry with `tables`, whose label has that kind, and whose depth and container are right or not scored. An
// entry that no such code point reads keeps its kind.
export function displayEntriesByCount(tables: RecoveryTables, trainSamples: Samples): RecoveryTables {
  const result = openDisplayEntries(tables)
  const wanted = new Int32Array(result.display.length * displayKindCount)
  const trace = createTrace()
  for (let place = 0; place < trainSamples.sampleCount; place++) {
    const firstError = trainSamples.firstErrorPosition[place]!
    if (trainSamples.firstDamage[place] === -1 || firstError === -1) continue
    const start = trainSamples.start[place]!
    const length = trainSamples.start[place + 1]! - start
    runOnSample(trace, trainSamples, place, result)
    for (let position = firstError; position < length; position++) {
      const flags = trainSamples.flags[start + position]!
      if ((flags & codePointKindScored) === 0) continue
      const nestingRight = (flags & codePointNestingScored) === 0
        || (trace.depthAfter[position] === trainSamples.labelDepth[start + position] && trace.containerAfter[position] === trainSamples.labelContainer[start + position])
      if (nestingRight) wanted[displayEntryOf(result, trace.event[position]!, trace.grammarAfter[position]!) * displayKindCount + trainSamples.labelKind[start + position]!]!++
    }
  }
  for (let entry = 0; entry < result.display.length; entry++) {
    if (result.displayOpen[entry] !== 1) continue
    let best = result.display[entry]!
    for (let kind = 0; kind < displayKindCount; kind++) if (kind !== displayKind.pastEnd && wanted[entry * displayKindCount + kind]! > wanted[entry * displayKindCount + best]!) best = kind
    result.display[entry] = best
  }
  return result
}

// The third kept setting: withTodaysKindsInErrorState of arms/combined/combined.ts. A copy of `tables` with today's
// kinds in the display entries of the grammar state `error`. A valid text with a value of more than 16 levels is in
// that state from its 17th bracket on when the kept cells hold today's choices, so these entries are what the rest of
// it is shown by. They are open, and a training or a count sets them from the few broken train code points that end
// in that state. With today's kinds there, a too deep valid text is shown as today at every code point.
export function withTodaysKindsInErrorState(tables: RecoveryTables): RecoveryTables {
  const result = copyTables(tables)
  for (let event = 0; event < tables.eventCount; event++) result.display[displayEntryOf(tables, event, today.errorState)] = today.display[event * today.grammarStateCount + today.errorState]!
  return result
}

// Valid TOML texts with a value of more than 16 levels that the kept cells were not found with: they come from
// another random stream. Each as its code points.
export function tooDeepTextsOfTheCheck(count: number): number[][] {
  const random = createRandom(recipeSettings.tooDeepSeed, 131)
  return Array.from({length: count}, (_, text) => codePointsOf(text % 2 === 0 ? tooDeepText(random) : tooDeepTextWithMembersAfter(random)).codePoints)
}

// At how many code points from the first error on `tables` show too deep valid texts otherwise than today's tables:
// another grammar state, another depth or container, another display kind. And how many of those code points read an
// open tokenizer cell, which has to be none for the kept settings to be enough. Tables of the recipe have 0 in all
// four, see check-recipe.ts.
export function differencesOnTooDeepTexts(tables: RecoveryTables, texts: readonly (readonly number[])[]) {
  const todaysTables = asIsTables()
  const trace = createTrace()
  const expected = createTrace()
  const differences = {codePoints: 0, state: 0, nesting: 0, kind: 0, openTokenizerCells: 0}
  for (const codePoints of texts) {
    runRecoveryParserInto(expected, codePoints, 0, codePoints.length, false, todaysTables, codePoints.length)
    runRecoveryParserInto(trace, codePoints, 0, codePoints.length, false, tables, codePoints.length)
    for (let position = expected.firstErrorPosition; position < codePoints.length; position++) {
      differences.codePoints++
      if (trace.grammarAfter[position] !== expected.grammarAfter[position]) differences.state++
      if (trace.depthAfter[position] !== expected.depthAfter[position] || trace.containerAfter[position] !== expected.containerAfter[position]) differences.nesting++
      if (trace.displayKind[position] !== expected.displayKind[position]) differences.kind++
      if (tables.lexerOpen[trace.lexerCell[position]!] === 1) differences.openTokenizerCells++
    }
  }
  return differences
}

// The cells that the search goes over: every open tokenizer cell, and the grammar cells that the recipe may change,
// as searchedCellsOf of arms/combined/combined.ts.
export function searchedCellsOf(base: RecoveryTables): Cell[] {
  const grammarCells = trainableGrammarCellsOf(base)
  const cells: Cell[] = []
  for (let cell = 0; cell < base.lexerOpen.length; cell++) if (base.lexerOpen[cell] === 1) cells.push({grammar: false, cell})
  for (let cell = 0; cell < grammarCells.length; cell++) if (grammarCells[cell] === 1) cells.push({grammar: true, cell})
  return cells
}

export type RecipeResult = {
  // The classes of the rule, and the tables of step 1.
  classes: AddedClass[]
  base: RecoveryTables
  // How many grammar cells the first kept setting keeps.
  keptGrammarCells: number
  // The tables after the training alone, as the trainer's last snapped tables.
  trained: RecoveryTables
  // The primary row: the training, then the count, then today's kinds in the state `error`.
  primary: RecoveryTables
  // The second row: the training, then the search, then the count and the last step. Undefined without the search.
  withSearch: RecoveryTables | undefined
  // What the search did, and the seconds of the training and of the search.
  search: {passes: number, lastPassChangedNothing: boolean, changes: number, runs: number} | undefined
  trainingSeconds: number
  searchSeconds: number
  // How many samples the training went over per second, with 4 worker threads.
  samplesPerSecond: number
}

// Runs the recipe on the train samples of `samples` for one seed. Samples of another split are not read. Without
// `search`, the second row is left out. A seed gives the same tables every time.
export async function runRecipe(samples: Samples, seed: number, options: {search?: boolean, log?: (line: string) => void} = {}): Promise<RecipeResult> {
  const log = options.log ?? (() => {})
  const trainSamples = trainPart(samples)
  // 1. The base.
  const classes = classesChosenFromTrainSamples(trainSamples)
  const base = baseOfRecipe(classes)
  log(`The rule picks ${classes.length} classes${classes.length === 0 ? '' : `: ${classes.map(added => added.name).join(', ')}`}.`)
  // 2. The training, with the first two kept settings.
  const trainableGrammar = trainableGrammarCellsOf(base)
  const keptGrammarCells = cellCounts(base).grammarOpen - trainableGrammar.reduce((total, bit) => total + bit, 0)
  const model = createModel(base, {start: 'base', startShare: recipeSettings.startShare, trainable: {lexer: 'open', grammar: trainableGrammar, display: 'open'}})
  ruleOutEndEvents(model)
  const data = packForTwin(samples, placesForTwin(samples, 'train'), base)
  log(`The base has ${base.classCount} classes and ${base.contextCount} contexts. ${keptGrammarCells} grammar cells are kept. Training on ${data.sampleCount} train samples.`)
  let started = performance.now()
  const trainResult = await train(model, data, {
    seed, epochs: recipeSettings.passes, batchSize: recipeSettings.batchSize, learningRate: recipeSettings.learningRate, temperatureStart: recipeSettings.temperature, temperatureEnd: recipeSettings.temperature,
    sharpnessCost: recipeSettings.sharpnessCost, logEverySamples: 1e9, log: () => {},
  })
  const trainingSeconds = (performance.now() - started) / 1000
  const trained = trainResult.last
  log(`The training took ${trainingSeconds.toFixed(0)} s and changed ${differencesOf(base, trained).length} cells.`)
  // 4 and 5. The count and today's kinds in the state `error`.
  const primary = withTodaysKindsInErrorState(displayEntriesByCount(trained, trainSamples))
  // 3. The search, for the second row.
  let withSearch: RecoveryTables | undefined
  let search: RecipeResult['search']
  let searchSeconds = 0
  if (options.search !== false) {
    started = performance.now()
    const result = await searchCells(trained, searchedCellsOf(base), prepareSamples(trainSamples, base), seed * 10 + recipeSettings.searchOrder, recipeSettings.searchPasses)
    searchSeconds = (performance.now() - started) / 1000
    search = {passes: result.passes, lastPassChangedNothing: result.lastPassChangedNothing, changes: result.changes, runs: result.runs}
    log(`The search took ${searchSeconds.toFixed(0)} s: ${result.passes} passes, ${result.changes} changes of a cell, ${(result.runs / 1e6).toFixed(1)} million runs of a sample.`)
    withSearch = withTodaysKindsInErrorState(displayEntriesByCount(result.tables, trainSamples))
  }
  return {classes, base, keptGrammarCells, trained, primary, withSearch, search, trainingSeconds, searchSeconds, samplesPerSecond: trainResult.samplesPerSecond}
}

// One line of a score's row "all", e.g. for a table of the rows of the recipe.
export const describeRow = (name: string, row: ScoreRow) => {
  const shares = sharesOf(row)
  const percent = (share: number) => (100 * share).toFixed(2)
  return `${name}: all three ${percent(shares.allThree)}, whole ${percent(shares.whole)}, display kind ${percent(shares.kind)}, depth ${percent(shares.depth)}, container ${percent(shares.container)} (${row.codePoints} scored code points in ${row.samples - row.nothingToRecover} of ${row.samples} broken samples), ${row.shownAsPastEnd} code points shown as past the end, ${row.addedShownAsError} of ${row.addedCodePoints} added code points shown as an error`
}

if (import.meta.main) {
  refuseUnknownOptions('recipe.ts', ['--seed', '--without-search'])
  const scratch = process.env['RECOVERY_SCRATCH']
  if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to a folder outside the repo: the tables of the recipe go there')
  const seed = Number(optionOf('--seed') ?? 1)
  const samples = loadStandardSamples()
  const result = await runRecipe(samples, seed, {search: !process.argv.includes('--without-search'), log: line => console.log(line)})
  const folder = join(scratch, 'recipe')
  mkdirSync(folder, {recursive: true})
  const validation = validationPart(samples)
  const rowOf = (tables: RecoveryTables) => scoreTables(tables, validation, {breakdowns: false}).rows[0]!
  const tooDeepTexts = tooDeepTextsOfTheCheck(2000)
  const describeTooDeep = (tables: RecoveryTables) => {
    const differences = differencesOnTooDeepTexts(tables, tooDeepTexts)
    return `On ${tooDeepTexts.length} too deep valid texts, ${differences.codePoints} code points from the first error on: ${differences.nesting} other depths or containers than today, ${differences.kind} other display kinds.`
  }
  console.log(describeRow('The parser as it is, on the validation split', rowOf(asIsTables())))
  console.log(describeRow('The training alone', rowOf(result.trained)))
  saveTables(join(folder, `seed-${seed}.primary.tables.json`), result.primary, `the frozen recipe, seed ${seed}: the training, the count, today's kinds in the state error`)
  console.log(describeRow('The primary row: the training, the count, today\'s kinds in the state error', rowOf(result.primary)))
  console.log(describeTooDeep(result.primary))
  if (result.withSearch !== undefined) {
    saveTables(join(folder, `seed-${seed}.with-search.tables.json`), result.withSearch, `the frozen recipe, seed ${seed}: the training, the search, the count, today's kinds in the state error`)
    console.log(describeRow('The second row: the same with the search before the count', rowOf(result.withSearch)))
    console.log(describeTooDeep(result.withSearch))
  }
  console.log(`The tables are in ${folder}.`)
}
