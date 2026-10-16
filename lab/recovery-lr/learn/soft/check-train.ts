// Checks the trainer and the recipe on small sets:
// 1. The gradient of a batch from 4 worker threads is the gradient from one thread, up to rounding.
// 2. Two runs with the same seed end with the same logits bit for bit and so with the same tables, and another
//    seed ends with other logits.
// 3. A short run lowers the loss and raises the score of its snapped tables, which keep the ground rules and are
//    the same after saving and loading.
// 4. With a tenth of the cells trainable and no display entry, no other cell and no entry changes.
// 5. What a call can get wrong is an error, and the process still ends: a model without a trainable cell, samples
//    packed for other added terminals, a place outside the samples, too many workers, a twin's module that is not
//    there.
// 6. The recipe of ../recipe.ts on 500 train samples: its four rows keep the ground rules and the cells of the end
//    of input, row 12 has no choice "end an item early", the count changes display entries only, row 11 is the
//    search and the count made here step by step, and a second run with the same seed gives the same tables.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set: bun lab/recovery-lr/learn/soft/check-train.ts
import {join} from 'node:path'
import {createRandom} from '../../random.ts'
import {loadPacked} from '../data.ts'
import {learnFolder} from '../options.ts'
import {
  type RecoveryTables, addFirstOnLineFlag, addTerminals, baseTables, changeableCellsOf, checkTables, differencesOf, endOfInput, kindEndEarly, kindOfChoice, loadTables, saveTables, tablesToJson, terminalOfCell,
} from '../recovery-tables.ts'
import {prepareRecipe, rowsOfRecipe} from '../recipe.ts'
import {scoreTables, sharesOf} from '../score.ts'
import {displayEntriesByCount} from '../search/count.ts'
import {searchCells} from '../search/search.ts'
import {createModel, snappedTables} from './model.ts'
import {createBatchRunner, train} from './train.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 30) console.log(`PROBLEM: ${text}`)
}
const silent = () => {}
const base = addFirstOnLineFlag(baseTables())
const samples = loadPacked('train', 400, base)
const validation = loadPacked('validation', 300, base)
const normal = (random: {next: () => number}) => Math.sqrt(-2 * Math.log(1 - random.next())) * Math.cos(2 * Math.PI * random.next())

// 1. Four worker threads and one thread.
{
  const model = createModel(base)
  const random = createRandom(71, 0)
  for (let logit = 0; logit < model.logits.length; logit++) model.logits[logit]! += 0.5 * normal(random)
  const places = Int32Array.from({length: 96}, (_, place) => place)
  const gradients: Float64Array[] = []
  const losses: number[] = []
  for (const workers of [0, 4]) {
    const batches = await createBatchRunner(model.layout, samples, workers)
    batches.logits.set(model.logits)
    const tally = await batches.run(places, true)
    gradients.push(batches.gradient.slice())
    losses.push(tally.loss)
    if (tally.samples !== places.length) problem(`a batch of ${places.length} samples on ${workers} workers ran ${tally.samples} samples`)
    await batches.close()
  }
  let largestGradient = 0, largestDifference = 0
  for (let logit = 0; logit < model.logits.length; logit++) {
    largestGradient = Math.max(largestGradient, Math.abs(gradients[0]![logit]!))
    largestDifference = Math.max(largestDifference, Math.abs(gradients[0]![logit]! - gradients[1]![logit]!))
  }
  if (!(largestGradient > 0) || largestDifference > 1e-9 * largestGradient || Math.abs(losses[0]! - losses[1]!) > 1e-9 * losses[0]!) problem(`4 worker threads give another gradient or loss than one thread: the largest difference is ${largestDifference} on a largest gradient of ${largestGradient}`)
  console.log(`1. The gradient of a batch of 96 samples from 4 worker threads is the gradient from one thread, up to ${largestDifference.toExponential(1)} on a largest gradient of ${largestGradient.toExponential(1)}.`)
}

// 2 and 3. The same seed twice, another seed, and what a short run does.
{
  const runOf = async (seed: number) => {
    const model = createModel(base)
    const result = await train(model, samples, {seed, epochs: 4, logEverySamples: 200, validation, log: silent})
    return {model, result}
  }
  const first = await runOf(5), second = await runOf(5), other = await runOf(6)
  const sameLogits = (left: Float64Array, right: Float64Array): boolean => left.every((logit, index) => logit === right[index])
  if (!sameLogits(first.model.logits, second.model.logits) || tablesToJson(first.result.last) !== tablesToJson(second.result.last)) problem('two runs with the same seed end with other logits or other tables')
  if (sameLogits(first.model.logits, other.model.logits)) problem('a run with another seed ends with the same logits')
  console.log(`2. Two runs with the seed 5 end with the same ${first.model.logits.length} logits bit for bit and the same tables, and a run with the seed 6 with other logits.`)

  const {points, last} = first.result
  const firstLoss = points[1]!.loss, lastLoss = points.at(-1)!.loss
  if (!(lastLoss < firstLoss)) problem(`the loss does not fall: ${firstLoss} over the first samples and ${lastLoss} over the last`)
  if (tablesToJson(last) !== tablesToJson(snappedTables(first.model))) problem('the tables of a run are not the snapped tables of its model')
  checkTables(last)
  const file = join(learnFolder('check-train'), 'last.json')
  saveTables(file, last, 'check-train.ts')
  if (tablesToJson(loadTables(file).tables) !== tablesToJson(last)) problem('the tables of a run are not the same after saving and loading')
  const before = sharesOf(scoreTables(base, validation).score).allThree, after = sharesOf(scoreTables(last, validation).score).allThree
  if (points.at(-1)!.allThree !== after || points[0]!.allThree !== before) problem('a log point has another score of the snapped tables than scoreTables gives')
  if (!(after > before)) problem(`four passes over 400 samples do not raise the score of the snapped tables: ${before} before and ${after} after`)
  console.log(`3. Four passes over 400 train samples: the loss per code point falls from ${firstLoss.toFixed(2)} to ${lastLoss.toFixed(2)}, and all three of the snapped tables on 300 validation samples rises from ${before.toFixed(1)} to ${after.toFixed(1)}. The tables keep the ground rules and are the same after saving and loading.`)
}

// 4. A tenth of the cells.
{
  const random = createRandom(72, 0)
  const trainableCells = new Uint8Array(base.choice.length)
  for (const cell of changeableCellsOf(base)) if (random.chance(0.1)) trainableCells[cell] = 1
  const model = createModel(base, {trainable: {cells: trainableCells, display: 'none'}, start: 'uniform'})
  const {last} = await train(model, samples, {epochs: 2, log: silent})
  const differences = differencesOf(base, last)
  const outside = differences.filter(difference => difference.table === 'display' || trainableCells[difference.index] === 0)
  if (outside.length > 0) problem(`with a tenth of the cells trainable, ${outside.length} other cells or entries changed, e.g. ${outside[0]!.name}`)
  if (differences.length === 0) problem('with a tenth of the cells trainable, no cell changed')
  console.log(`4. With ${trainableCells.reduce((count, bit) => count + bit, 0)} of the ${changeableCellsOf(base).length} cells trainable and no display entry, from a uniform start: ${differences.length} of those cells changed, and nothing else.`)
}

// 5. Errors.
{
  const rejects = async (name: string, call: () => Promise<unknown>) => {
    try {
      await call()
      problem(`${name}: train did not throw`)
    } catch {
      // The error is what the check asks for.
    }
  }
  await rejects('a model without a trainable cell', () => train(createModel(base, {trainable: {cells: 'none', display: 'none'}}), samples, {log: silent}))
  await rejects('samples packed for other added terminals', () => train(createModel(addTerminals(base, [{name: 'ampersand', codePoint: 0x26}])), samples, {log: silent}))
  await rejects('a place outside the samples', () => train(createModel(base), samples, {places: Int32Array.of(0, samples.sampleCount), log: silent}))
  await rejects('5 workers', () => train(createModel(base), samples, {workers: 5, log: silent}))
  await rejects('a twin whose module is not there', () => train(createModel(base), samples, {twin: {module: join(import.meta.dir, 'no-such-twin.ts')}, log: silent}))
  console.log('5. train throws for a model without a trainable cell, for samples packed for other added terminals, for a place outside the samples, for 5 workers, and for a twin whose module is not there.')
}

// 6. The recipe.
{
  const trainSamples = 500
  const sameTables = (left: RecoveryTables, right: RecoveryTables): boolean => tablesToJson(left) === tablesToJson(right)
  const rows = await rowsOfRecipe(3, [9, 10, 11, 12], {trainSamples})
  const [nine, ten, eleven, twelve] = rows
  if (rows.length !== 4 || nine?.row !== 9 || ten?.row !== 10 || eleven?.row !== 11 || twelve?.row !== 12) throw new Error('the recipe does not give its four rows in order')
  for (const {row, base: baseOfRow, tables, trained} of rows) {
    checkTables(tables)
    if (!tables.firstOnLineFlag || tables.endEarly !== (row !== 12)) problem(`row ${row} has tables without the flag, or with the wrong list of choices`)
    const differences = differencesOf(baseOfRow, tables)
    if (differences.some(difference => difference.table === 'cells' && terminalOfCell(tables, difference.index) === endOfInput)) problem(`row ${row} changed a cell of the end of input`)
    if (!differences.some(difference => difference.table === 'cells') || !differences.some(difference => difference.table === 'display')) problem(`row ${row} changed no cell or no display entry`)
    if (trained !== undefined && row !== 10 && differencesOf(trained, tables).some(difference => difference.table === 'cells')) problem(`the count of row ${row} changed a cell`)
  }
  if (twelve.tables.choice.some(choice => kindOfChoice(choice) === kindEndEarly)) problem('row 12 holds a choice "end an item early"')
  if (!eleven.tables.choice.some(choice => kindOfChoice(choice) === kindEndEarly)) problem('row 11 holds no choice "end an item early", so the check of row 12 says nothing')
  if (nine.trained === undefined || ten.trained === undefined || !sameTables(nine.trained, ten.trained)) problem('the rows 9 and 10 do not share one training')
  // Row 11, step by step: the search from the base in the order of the seed × 10 + 1, at most 4 passes, then the count.
  const prepared = prepareRecipe(trainSamples)
  const searched = await searchCells(prepared.base, changeableCellsOf(prepared.base), prepared.train, {orderSeed: 31, maximumPasses: 4})
  if (!sameTables(eleven.tables, displayEntriesByCount(searched.tables, prepared.train).tables)) problem('row 11 is not the search of 4 passes in the order 31 and the count')
  // Row 10 is a search from the trained tables, so on the train samples it has no fewer code points right than row 9.
  const onTrain = (tables: RecoveryTables): number => scoreTables(tables, prepared.train).score.allThreeRight
  if (onTrain(ten.tables) < onTrain(nine.tables)) problem('row 10 has fewer train code points right than row 9')
  const again = await rowsOfRecipe(3, [9, 12], {trainSamples})
  if (!sameTables(again[0]!.tables, nine.tables) || !sameTables(again[1]!.tables, twelve.tables)) problem('a second run of the recipe with the same seed gives other tables')
  const otherSeed = await rowsOfRecipe(4, [9], {trainSamples})
  if (sameTables(otherSeed[0]!.tables, nine.tables)) problem('the recipe gives the same tables with another seed')
  console.log(`6. The recipe on ${trainSamples} train samples, seed 3: its four rows keep the ground rules and the cells of the end of input, row 12 has no choice "end an item early", the count changes no cell, row 11 is the search and the count made step by step, row 10 has ${onTrain(ten.tables) - onTrain(nine.tables)} more train code points right than row 9, a second run gives the same tables, and the seed 4 gives other tables.`)
}

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
