// Checks the trainer's parts around the twin: worker threads, seeds, trainable cells and snapping.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/soft/check-train.ts
//
// 1. The gradients of a batch from 4 worker threads are the gradients from one thread.
// 2. Two runs with the same seed end with the same weights, bit for bit, and another seed with other weights.
// 3. A model that starts at the base tables, or uniform, snaps to the base tables. Snapped tables of a trained model
//    keep the ground rules, and are the same tables after saving and loading.
// 4. With a tenth of the open cells trainable, only their weights move, and the snapped tables differ from the base
//    tables in those cells only.
// 5. With onlyReadCells, the tables that train returns hold the base tables' choice in every cell that the exact
//    parser reads at no code point of a trained text, and give the trained texts the trace of the snapped tables.
// 6. The same parts for tables with added structure, see ../structure/README.md: added classes, added states and
//    open entries of the display table. The gradients of 4 threads are one thread's, the snapped tables of a trained
//    model keep the ground rules and are the same after saving and loading, and with onlyReadCells the returned
//    tables give the trained texts the trace of the snapped ones.
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {classesOfTheChecks} from '../check-texts.ts'
import {loadStandardSamples, splitNames} from '../data.ts'
import {createTrace} from '../recovery-parser.ts'
import {addClasses, addStates, asIsTables, checkTables, differencesOf, grammarStateNames, loadTables, openDisplayEntries, saveTables, tablesToJson} from '../recovery-tables.ts'
import {cellsReadAt, isRead, runOnSample} from '../score.ts'
import {createBatchRunner, randomTrainableCells, train} from './train.ts'
import {loadIntendedObjects, packForTwin, placesForTwin, softCacheFolderOf} from './twin-data.ts'
import {type LossOptions, createModel, mixesInto, snappedTables} from './twin.ts'

let failures = 0
const check = (holds: boolean, message: string) => {
  if (holds) return
  failures++
  console.log(`FAILED: ${message}`)
}

const samples = loadStandardSamples()
const trainPlaces = placesForTwin(samples, splitNames.indexOf('train')).subarray(0, 96)
const intendedObjects = loadIntendedObjects(samples, softCacheFolderOf())
const data = packForTwin(samples, trainPlaces, intendedObjects)
const everyPlace = Int32Array.from({length: data.sampleCount}, (_, place) => place)
const base = asIsTables()
const quiet = () => {}

// 1. Worker threads.
{
  const model = createModel(base, {startShare: 0.6})
  const options: LossOptions = {intendedGrammarWeight: 0.2, onTrackProbability: 0.2, onTrackSeed: 5}
  const oneThread = createBatchRunner(model, data, 0)
  const fourThreads = createBatchRunner(model, data, 4)
  mixesInto(model, 1, oneThread.mixes)
  mixesInto(model, 1, fourThreads.mixes)
  const tallyOne = await oneThread.run(everyPlace, options, true)
  const tallyFour = await fourThreads.run(everyPlace, options, true)
  let largest = 0
  let largestDifference = 0
  let notZero = 0
  for (let entry = 0; entry < oneThread.mixGradients.all.length; entry++) {
    const gradient = oneThread.mixGradients.all[entry]!
    if (gradient !== 0) notZero++
    largest = Math.max(largest, Math.abs(gradient))
    largestDifference = Math.max(largestDifference, Math.abs(gradient - fourThreads.mixGradients.all[entry]!))
  }
  await fourThreads.close()
  check(notZero > 1000, `only ${notZero} gradients are not 0`)
  check(largestDifference <= 1e-9 * largest, `the gradients of 4 threads differ from one thread's by ${largestDifference}`)
  check(tallyOne.codePoints === tallyFour.codePoints && tallyOne.replaced === tallyFour.replaced && Math.abs(tallyOne.loss - tallyFour.loss) <= 1e-9 * tallyOne.loss, `the tallies differ: ${JSON.stringify(tallyOne)} and ${JSON.stringify(tallyFour)}`)
  console.log(`1. A batch of ${data.sampleCount} samples, ${tallyOne.codePoints} labeled code points, ${tallyOne.replaced} states replaced: ${notZero} gradients are not 0, the largest is ${largest.toExponential(2)}, and 4 threads differ from one thread by at most ${largestDifference.toExponential(2)}.`)
}

// 2. Seeds.
const trainOptions = {epochs: 2, batchSize: 16, learningRate: 0.3, workers: 4, logEverySamples: 1e9, log: quiet, loss: {onTrackProbability: 0.2, intendedEventWeight: 0.1}, sharpnessCost: 0.01, temperatureStart: 1, temperatureEnd: 0.8}
const trained = createModel(base)
{
  const again = createModel(base)
  const other = createModel(base)
  await train(trained, data, everyPlace, {...trainOptions, seed: 3})
  await train(again, data, everyPlace, {...trainOptions, seed: 3})
  await train(other, data, everyPlace, {...trainOptions, seed: 4})
  let same = 0
  let sameAsOther = 0
  let moved = 0
  const start = createModel(base)
  for (let entry = 0; entry < trained.weights.all.length; entry++) {
    if (Object.is(trained.weights.all[entry], again.weights.all[entry])) same++
    if (Object.is(trained.weights.all[entry], other.weights.all[entry])) sameAsOther++
    if (trained.weights.all[entry] !== start.weights.all[entry]) moved++
  }
  check(same === trained.weights.all.length, `two runs with the same seed differ in ${trained.weights.all.length - same} weights`)
  check(moved > 1000 && sameAsOther < trained.weights.all.length - 1000, `training moved ${moved} weights, and another seed gives the same weight in ${sameAsOther} of ${trained.weights.all.length}`)
  console.log(`2. Two runs of 2 passes over ${data.sampleCount} samples with the same seed: ${same} of ${trained.weights.all.length} weights are the same bits, ${moved} moved from the start. With another seed ${trained.weights.all.length - sameAsOther} weights differ.`)
}

// 3. Snapping.
{
  for (const start of ['base', 'uniform'] as const) check(differencesOf(base, snappedTables(createModel(base, {start}))).length === 0, `a model that starts ${start} does not snap to the base tables`)
  const snapped = snappedTables(trained)
  checkTables(snapped)
  check(differencesOf(base, snapped).length > 0, 'training changed no cell of the snapped tables')
  const folder = softCacheFolderOf()
  let roundTrip = 'not saved, since RECOVERY_SCRATCH is not set'
  if (folder !== undefined) {
    mkdirSync(folder, {recursive: true})
    const path = join(folder, 'check-train-tables.json')
    saveTables(path, snapped, 'check-train.ts')
    const loaded = loadTables(path).tables
    check(differencesOf(snapped, loaded).length === 0, 'saved and loaded tables differ')
    roundTrip = 'the same tables after saving and loading'
  }
  console.log(`3. A model at its start snaps to the base tables. The trained model's snapped tables differ from the base tables in ${differencesOf(base, snapped).length} cells, keep the ground rules, and are ${roundTrip}.`)
}

// 4. A tenth of the open cells.
{
  const trainable = randomTrainableCells(base, 0.1, 9)
  const model = createModel(base, {trainable, start: 'uniform'})
  await train(model, data, everyPlace, {...trainOptions, seed: 3})
  const widths = {lexerNext: model.shape.lexerStateCount, lexerEvent: model.shape.eventCount, grammarNext: model.shape.grammarStateCount, grammarAction: 5}
  let movedOutside = 0
  let movedInside = 0
  for (const group of ['lexerNext', 'lexerEvent', 'grammarNext', 'grammarAction'] as const) {
    const mask = group === 'lexerNext' || group === 'lexerEvent' ? trainable.lexer : trainable.grammar
    const weights = model.weights[group]
    for (let entry = 0; entry < weights.length; entry++) {
      if (weights[entry] === 0) continue
      if (mask[Math.floor(entry / widths[group])] === 1) movedInside++
      else movedOutside++
    }
  }
  const differences = differencesOf(base, snappedTables(model))
  const outside = differences.filter(difference => (difference.table === 'tokenizer' ? trainable.lexer : difference.table === 'grammar' ? trainable.grammar : trainable.display)[difference.cell] === 0).length
  const trainableCells = trainable.lexer.reduce((total, bit) => total + bit, 0) + trainable.grammar.reduce((total, bit) => total + bit, 0)
  check(movedOutside === 0 && movedInside > 0, `${movedOutside} weights of cells that are not trainable moved, and ${movedInside} of trainable cells`)
  check(outside === 0, `${outside} cells that are not trainable changed`)
  console.log(`4. With ${trainableCells} of the 1326 open cells trainable: ${movedInside} weights of trainable cells moved and ${movedOutside} of other cells. The snapped tables differ from the base tables in ${differences.length} cells, ${outside} of them not trainable.`)
}

// 5. The cells that no trained text reads.
{
  const model = createModel(base, {start: 'uniform'})
  const result = await train(model, data, everyPlace, {...trainOptions, seed: 3, trainedOn: {samples, places: trainPlaces}, onlyReadCells: true})
  const snapped = snappedTables(model)
  const read = cellsReadAt(result.last, samples, trainPlaces)
  const changed = differencesOf(base, snapped)
  const kept = differencesOf(base, result.last)
  const unread = kept.filter(difference => !isRead(read, difference)).length
  check(kept.length > 0 && kept.length < changed.length, `the snapped tables differ from the base in ${changed.length} cells, and the returned ones in ${kept.length}`)
  check(unread === 0, `${unread} cells of the returned tables differ from the base and are read by no trained text`)
  const traceOfSnapped = createTrace()
  const traceOfReturned = createTrace()
  let codePoints = 0
  let different = 0
  for (const place of trainPlaces) {
    runOnSample(traceOfSnapped, samples, place, snapped)
    runOnSample(traceOfReturned, samples, place, result.last)
    const length = samples.start[place + 1]! - samples.start[place]!
    for (let position = 0; position < length; position++) {
      codePoints++
      if (traceOfSnapped.lexerCell[position] !== traceOfReturned.lexerCell[position] || traceOfSnapped.grammarCell[position] !== traceOfReturned.grammarCell[position] || traceOfSnapped.displayKind[position] !== traceOfReturned.displayKind[position]
        || traceOfSnapped.depthAfter[position] !== traceOfReturned.depthAfter[position] || traceOfSnapped.containerAfter[position] !== traceOfReturned.containerAfter[position]) different++
    }
  }
  check(different === 0, `${different} code points of the trained texts have another trace with the returned tables than with the snapped ones`)
  console.log(`5. Every open cell trainable from a uniform start: the snapped tables differ from the base tables in ${changed.length} cells, and the exact parser reads ${kept.length} of them at a code point of the ${trainPlaces.length} trained texts. The returned tables hold the base's choice in the others, and give the ${codePoints} code points of the trained texts the same cells and the same trace as the snapped ones.`)
}

// 6. Tables with added structure.
{
  const withStructure = openDisplayEntries(addStates(addClasses(base, classesOfTheChecks), 2, [grammarStateNames.indexOf('colon')]))
  const dataWithStructure = packForTwin(samples, trainPlaces, intendedObjects, withStructure)
  const model = createModel(withStructure, {start: 'uniform'})
  const options: LossOptions = {intendedGrammarWeight: 0.2, onTrackProbability: 0.2, onTrackSeed: 5}
  const oneThread = createBatchRunner(model, dataWithStructure, 0)
  const fourThreads = createBatchRunner(model, dataWithStructure, 4)
  mixesInto(model, 1, oneThread.mixes)
  mixesInto(model, 1, fourThreads.mixes)
  await oneThread.run(everyPlace, options, true)
  await fourThreads.run(everyPlace, options, true)
  let largest = 0
  let largestDifference = 0
  for (let entry = 0; entry < oneThread.mixGradients.all.length; entry++) {
    largest = Math.max(largest, Math.abs(oneThread.mixGradients.all[entry]!))
    largestDifference = Math.max(largestDifference, Math.abs(oneThread.mixGradients.all[entry]! - fourThreads.mixGradients.all[entry]!))
  }
  await fourThreads.close()
  check(largestDifference <= 1e-9 * largest, `with added structure, the gradients of 4 threads differ from one thread's by ${largestDifference}`)
  check(oneThread.mixGradients.display.some(gradient => gradient !== 0), 'no mix of the display table has a gradient')

  const result = await train(model, dataWithStructure, everyPlace, {...trainOptions, seed: 3, trainedOn: {samples, places: trainPlaces}, onlyReadCells: true})
  const snapped = snappedTables(model)
  checkTables(snapped)
  checkTables(result.last)
  const changed = differencesOf(withStructure, snapped)
  const count = (table: string) => changed.filter(difference => difference.table === table).length
  const ofAddedClasses = changed.filter(difference => difference.table === 'tokenizer' && difference.cell % snapped.classCount >= base.classCount).length
  check(count('display') > 0 && ofAddedClasses > 0, `training changed ${count('display')} entries of the display table and ${ofAddedClasses} cells of added classes`)
  const reloaded = tablesToJson(snapped, 'check-train.ts')
  let roundTrip = 'the same tables after writing them as JSON and reading them'
  const folder = softCacheFolderOf()
  if (folder !== undefined) {
    const path = join(folder, 'check-train-tables-with-structure.json')
    saveTables(path, snapped, 'check-train.ts')
    check(tablesToJson(loadTables(path).tables, 'check-train.ts') === reloaded, 'saved and loaded tables with added structure differ')
    roundTrip = 'the same tables after saving and loading'
  }
  const traceOfSnapped = createTrace()
  const traceOfReturned = createTrace()
  let different = 0
  for (const place of trainPlaces) {
    runOnSample(traceOfSnapped, samples, place, snapped)
    runOnSample(traceOfReturned, samples, place, result.last)
    const length = samples.start[place + 1]! - samples.start[place]!
    for (let position = 0; position < length; position++) {
      if (traceOfSnapped.lexerCell[position] !== traceOfReturned.lexerCell[position] || traceOfSnapped.grammarCell[position] !== traceOfReturned.grammarCell[position] || traceOfSnapped.displayKind[position] !== traceOfReturned.displayKind[position]
        || traceOfSnapped.depthAfter[position] !== traceOfReturned.depthAfter[position] || traceOfSnapped.containerAfter[position] !== traceOfReturned.containerAfter[position]) different++
    }
  }
  check(different === 0, `with added structure, ${different} code points of the trained texts have another trace with the returned tables than with the snapped ones`)
  console.log(`6. With ${classesOfTheChecks.length} added classes, 2 added tokenizer states, an added grammar state and open entries of the display table: 4 threads differ from one thread by at most ${largestDifference.toExponential(2)} on a largest gradient of ${largest.toExponential(2)}. `
    + `The trained model's snapped tables differ from the base tables in ${count('tokenizer')} tokenizer cells, ${ofAddedClasses} of them of added classes, ${count('grammar')} grammar cells and ${count('display')} entries of the display table, keep the ground rules, and are ${roundTrip}. `
    + `With onlyReadCells the returned tables differ from the base tables in ${differencesOf(withStructure, result.last).length} cells and give the trained texts the same cells and the same trace.`)
}

if (failures > 0) {
  console.log(`${failures} checks FAILED.`)
  process.exit(1)
}
console.log('Every check passed.')
