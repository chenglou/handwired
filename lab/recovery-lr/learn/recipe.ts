// The frozen recipe of the transfer experiment, as one function: recipeRows(seed, rows) gives the tables of the
// rows of the final table that a seed can give.
//
// The recipe is the candidate "generic" of the JSON side (lab/recovery-parser/learn/arms/combined/combined.ts), with
// every setting as it is there and no setting tuned for this language. Step by step, as the design maps it:
//
//   the JSON side                                    here
//   1. today's tables                                the parser as it is: baseTables()
//   2. classes for the code points that a rule       terminals of their own for the code points that the same rule,
//      picks from the train samples: at least 100    with the same two thresholds, picks among the tokens that scan as
//      samples, a distance of 0.5 or more            BADCHAR (picked-terminals.ts). The scanner stays frozen
//   3. open display entries                          nothing to do: every display entry that no shift reads is open
//   4. the bit "first on its line"                   the flag: a second copy of every cell (addFirstOnLineFlag)
//   5. every open cell and entry trained in three    the same numbers, on the twin of soft/: a rate of 0.05, batches of
//      passes from a share of 0.9 on the base's      32, 0.9 on stop or on bison's default reduction, and on `error` in
//      choice, then snapped                          a display entry
//   6. kept: the cells of too deep valid JSON,       kept: the column of the end of input, which no label asks about.
//      and no event of a text's end                  The scanner is frozen, so the second has no counterpart
//   7. 4 passes of the greedy search over the same   the same, with searchCells of search/search.ts: the order of a pass
//      cells, in a random order of seed × 10 + 1     is drawn from the seed × 10 + 1 and the pass
//   8. every open display entry set by a count       the same, displayEntriesByCount of search/count.ts
//      over the train samples
//   9. today's kinds in the display entries of the   no counterpart: no valid program reads an open cell or an open
//      state `error`, for too deep valid JSON        display entry, however deep it is
//
// The rows:
//   9   training, then the count: the steps 1 to 6 and 8. The primary row.
//   10  the same with the search before the count: every step.
//   11  the search and the count without training: the steps 1 to 4, 7 and 8. Its seed only draws the search's order.
//   12  row 9 with tables that have no choice "end an item early".
//
// What has no JSON setting to carry over: the JSON twin held a share per depth from -8 to 24 and 16 levels of stack.
// The reference twin here holds exact stacks, so it has no such range. Its own two settings, 48 stacks and a least
// weight of 1e-9, are the ones of the prototype that the design's review built, and were not tuned.
//
// As a command, for a smoke run or one seed, from the repo root with RECOVERY_LR_SCRATCH set:
//   bun lab/recovery-lr/learn/recipe.ts [--seed 1] [--rows 9,11] [--train 40000] [--validation 5000] [--name <folder>]
//       [--twin <module that exports createTwin>] [--cells 30]
// It saves the tables of every row, a log and a report per row to <scratch>/learn/recipe/<name>, and prints the
// scores on the validation samples. It reads no held-back set.
import {appendFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {type PackedSamples, eachSample, loadPacked} from './data.ts'
import {learnFolder, numberOf, optionOf, refuseUnknownOptions, standardTrainCount, standardValidationCount} from './options.ts'
import {terminalsChosenFromTrainSamples} from './picked-terminals.ts'
import {type AddedTerminal, type RecoveryTables, addFirstOnLineFlag, addTerminals, baseTables, changeableCellsOf, differencesOf, saveTables, withoutEndEarly} from './recovery-tables.ts'
import {reportOf} from './report.ts'
import {scoreHeader, scoreRow, scoreTables} from './score.ts'
import {displayEntriesByCount} from './search/count.ts'
import {searchCells} from './search/search.ts'
import {createModel} from './soft/model.ts'
import {type TrainResult, train} from './soft/train.ts'
import {type TwinChoice, referenceTwin} from './soft/twin.ts'

// The settings of the JSON side's candidate "generic". None is tuned here.
export const recipeSettings = {
  // The training: the share on the base's choice at the start, the passes over the train samples, the rate and the
  // batch of Adam.
  startShare: 0.9,
  passes: 3,
  learningRate: 0.05,
  batchSize: 32,
  // The search after the training: at most so many passes, in the first of the JSON side's three orders.
  searchPasses: 4,
  searchOrder: 1,
} as const

export type RecipeRow = 9 | 10 | 11 | 12
export const recipeRows = [9, 10, 11, 12] as const
export const recipeRowNames: Record<RecipeRow, string> = {
  9: 'training, then the count',
  10: 'training, then the search, then the count',
  11: 'the search and the count, without training',
  12: 'training, then the count, without "end an item early"',
}

export type RecipeOptions = {
  // How many train samples the recipe reads: the first so many of the train split. The default is 40,000.
  trainSamples?: number
  // The twin of the training. The default is the reference, the weighted set of exact stacks.
  twin?: TwinChoice
  // Worker threads of the training, 0 to 4. The default is 4. The search always uses 4.
  workers?: number
  // For the log only, and it changes no tables: the lines of the steps, and validation samples, packed for the
  // tables of prepareRecipe, that score the snapped tables after every pass of the training.
  log?: (line: string) => void
  validation?: PackedSamples
}

// The steps 1 to 4: the tables that a row starts from, and the train samples packed for them. The rule of step 2
// reads the same train samples that the row trains on.
export type Prepared = {base: RecoveryTables, pickedTerminals: AddedTerminal[], train: PackedSamples}
const knownTerminals = new Map<number, AddedTerminal[]>()
const knownTrainSamples = new Map<number, PackedSamples>()
export function prepareRecipe(trainSamples: number = standardTrainCount, endEarly = true): Prepared {
  let pickedTerminals = knownTerminals.get(trainSamples)
  if (pickedTerminals === undefined) {
    pickedTerminals = terminalsChosenFromTrainSamples(eachSample('train', trainSamples))
    knownTerminals.set(trainSamples, pickedTerminals)
  }
  let base = baseTables()
  if (!endEarly) base = withoutEndEarly(base)
  base = addFirstOnLineFlag(addTerminals(base, pickedTerminals))
  // The packed samples only depend on the added terminals, so both kinds of tables read the same ones.
  let packed = knownTrainSamples.get(trainSamples)
  if (packed === undefined) {
    packed = loadPacked('train', trainSamples, base)
    knownTrainSamples.set(trainSamples, packed)
  }
  return {base, pickedTerminals, train: packed}
}

// The steps 5 and 6: the snapped tables after the training, and what the trainer says of the run. Every cell that
// may change and every open display entry is trainable. The cells of the end of input are not.
export async function trainedTables(prepared: Prepared, seed: number, options: RecipeOptions = {}): Promise<{tables: RecoveryTables, training: TrainResult}> {
  const model = createModel(prepared.base, {start: 'base', startShare: recipeSettings.startShare})
  const training = await train(model, prepared.train, {
    seed, epochs: recipeSettings.passes, learningRate: recipeSettings.learningRate, batchSize: recipeSettings.batchSize, workers: options.workers ?? 4, twin: options.twin ?? referenceTwin,
    logEverySamples: prepared.train.sampleCount, log: options.log ?? (() => {}), ...(options.validation === undefined ? {} : {validation: options.validation}),
  })
  return {tables: training.last, training}
}

// Step 7: the search from the tables `start`, over the cells that the training may change.
export async function searchedTables(prepared: Prepared, start: RecoveryTables, seed: number, options: RecipeOptions = {}): Promise<RecoveryTables> {
  const started = performance.now()
  const result = await searchCells(start, changeableCellsOf(prepared.base), prepared.train, {orderSeed: seed * 10 + recipeSettings.searchOrder, maximumPasses: recipeSettings.searchPasses})
  options.log?.(`The search ended ${result.lastPassChangedNothing ? `when pass ${result.passes} changed nothing` : `after its ${result.passes} passes`}, after ${result.changes} changes of a cell and ${(result.runs / 1e6).toFixed(1)} million runs of a sample, in ${((performance.now() - started) / 1000).toFixed(0)} s.`)
  return result.tables
}

// Step 8: the count.
export const countedTables = (prepared: Prepared, tables: RecoveryTables): RecoveryTables => displayEntriesByCount(tables, prepared.train).tables

export type RowResult = {
  row: RecipeRow
  name: string
  // The tables that the row started from, and the row's tables.
  base: RecoveryTables
  tables: RecoveryTables
  // For a row with a training: the snapped tables before the search and the count, and the trainer's numbers.
  trained?: RecoveryTables
  training?: TrainResult
}

// The tables of the asked rows for a seed. The rows 9 and 10 share one training.
export async function rowsOfRecipe(seed: number, rows: readonly RecipeRow[], options: RecipeOptions = {}): Promise<RowResult[]> {
  for (const row of rows) if (!recipeRows.includes(row)) throw new Error(`the recipe has the rows ${recipeRows.join(', ')}, and got ${String(row)}`)
  const results: RowResult[] = []
  const withEndEarly = prepareRecipe(options.trainSamples, true)
  const describe = (prepared: Prepared) => options.log?.(`The recipe on ${prepared.train.sampleCount} train samples with ${prepared.train.scoredCodePoints} scored code points, seed ${seed}. The rule picks ${prepared.pickedTerminals.length === 0 ? 'no code point' : prepared.pickedTerminals.map(terminal => `\`${String.fromCodePoint(terminal.codePoint)}\``).join(' ')} for a terminal of its own. ${changeableCellsOf(prepared.base).length} cells may change${prepared.base.endEarly ? '' : ', without "end an item early"'}.`)
  if (rows.includes(9) || rows.includes(10)) {
    describe(withEndEarly)
    const {tables: trained, training} = await trainedTables(withEndEarly, seed, options)
    if (rows.includes(9)) results.push({row: 9, name: recipeRowNames[9], base: withEndEarly.base, tables: countedTables(withEndEarly, trained), trained, training})
    if (rows.includes(10)) results.push({row: 10, name: recipeRowNames[10], base: withEndEarly.base, tables: countedTables(withEndEarly, await searchedTables(withEndEarly, trained, seed, options)), trained, training})
  }
  if (rows.includes(11)) {
    if (results.length === 0) describe(withEndEarly)
    results.push({row: 11, name: recipeRowNames[11], base: withEndEarly.base, tables: countedTables(withEndEarly, await searchedTables(withEndEarly, withEndEarly.base, seed, options))})
  }
  if (rows.includes(12)) {
    const withoutIt = prepareRecipe(options.trainSamples, false)
    describe(withoutIt)
    const {tables: trained, training} = await trainedTables(withoutIt, seed, options)
    results.push({row: 12, name: recipeRowNames[12], base: withoutIt.base, tables: countedTables(withoutIt, trained), trained, training})
  }
  return results.sort((left, right) => left.row - right.row)
}

if (import.meta.main) {
  refuseUnknownOptions('recipe.ts', ['--seed', '--rows', '--train', '--validation', '--name', '--twin', '--cells'])
  const seed = numberOf('--seed', 1)
  const rows = (optionOf('--rows') ?? '9').split(',').map(Number) as RecipeRow[]
  const trainSamples = numberOf('--train', standardTrainCount)
  const twinOption = optionOf('--twin')
  const folder = learnFolder('recipe', optionOf('--name') ?? `seed-${seed}`)
  const logFile = join(folder, 'log.txt')
  writeFileSync(logFile, '')
  const log = (line: string) => {
    console.log(line)
    appendFileSync(logFile, `${line}\n`)
  }
  log(`bun ${process.argv.slice(1).join(' ')}`)
  const started = performance.now()
  const prepared = prepareRecipe(trainSamples)
  const validation = loadPacked('validation', numberOf('--validation', standardValidationCount), prepared.base)
  log(`${prepared.train.sampleCount} train samples and ${validation.sampleCount} validation samples, made and packed in ${((performance.now() - started) / 1000).toFixed(0)} s.`)
  const results = await rowsOfRecipe(seed, rows, {trainSamples, log, validation, ...(twinOption === undefined ? {} : {twin: {module: resolve(twinOption)}})})
  log('')
  log(`The validation samples, ${validation.sampleCount} of them. A run on ${prepared.train.sampleCount} train samples with one seed${trainSamples < standardTrainCount ? ': a smoke run, and no result' : ''}.`)
  log(scoreHeader)
  log(scoreRow('the parser as it is', scoreTables(prepared.base, validation).score))
  for (const result of results) {
    if (result.trained !== undefined) log(scoreRow(`row ${result.row} before its ${result.row === 10 ? 'search and its ' : ''}count: the snapped tables of the training`, scoreTables(result.trained, validation).score))
    log(scoreRow(`row ${result.row}: ${result.name}`, scoreTables(result.tables, validation).score))
  }
  for (const result of results) {
    const differences = differencesOf(result.base, result.tables)
    const file = join(folder, `row-${result.row}-seed-${seed}.json`)
    saveTables(file, result.tables, `recipe row ${result.row} (${result.name}), seed ${seed}, ${prepared.train.sampleCount} train samples`)
    const report = reportOf(result.tables, validation, 'validation', numberOf('--cells', 30))
    writeFileSync(file.replace(/\.json$/, '.report.txt'), `${report.join('\n')}\n`)
    log('')
    log(`Row ${result.row}, ${result.name}: ${differences.filter(difference => difference.table === 'cells').length} cells and ${differences.filter(difference => difference.table === 'display').length} display entries hold something else than the parser as it is. Saved to ${file}, with a report next to it.`)
    if (result.training !== undefined) log(`The training took ${result.training.secondsPerPass.map(seconds => `${seconds.toFixed(1)} s`).join(', ')} per pass, ${result.training.samplesPerSecond.toFixed(0)} samples per second.`)
  }
}
