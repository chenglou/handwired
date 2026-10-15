// Checks the trainer's parts around the twin: worker threads, seeds, trainable cells and snapping.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/soft/check-train.ts
//
// 1. The gradients of a batch from 4 worker threads are the gradients from one thread.
// 2. Two runs with the same seed end with the same weights, bit for bit, and another seed with other weights.
// 3. A model that starts at the base tables, or uniform, snaps to the base tables. Snapped tables of a trained model
//    keep the ground rules, and are the same tables after saving and loading.
// 4. With a tenth of the open cells trainable, the model's trainable cells are the ones it was given, every other
//    cell's mix is the base tables' choice as exact 0 and 1, only the weights of the tenth move, and the snapped
//    tables differ from the base tables in those cells only.
// 5. With onlyReadCells, the tables that train returns hold the base tables' choice in every cell that the exact
//    parser reads at no code point of a trained text, and give the trained texts the trace of the snapped tables.
// 6. The same parts for tables with added structure, see ../structure/README.md: added classes, added states, open
//    entries of the display table and the bit "first on its line". The gradients of 4 threads are one thread's, the
//    snapped tables of a trained model keep the ground rules and are the same after saving and loading, and with
//    onlyReadCells the returned tables give the trained texts the trace of the snapped ones. An open entry's mix
//    gives `pastEnd` the share 0 and never snaps to it, also when the weight of `pastEnd` is the entry's largest.
//    And part 4 again, with a tenth of the open entries trainable too.
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {createRandom} from '../../random.ts'
import {classesOfTheChecks} from '../check-texts.ts'
import {loadStandardSamples, splitNames} from '../data.ts'
import {createTrace} from '../recovery-parser.ts'
import {
  type RecoveryTables, addClasses, addFirstOnLineBit, addStates, asIsTables, cellCounts, checkTables, differencesOf, displayKindNames, grammarStateNames, loadTables, openDisplayEntries, problemsOf, saveTables, tablesToJson,
} from '../recovery-tables.ts'
import {cellsReadAt, isRead, runOnSample} from '../score.ts'
import {createBatchRunner, randomTrainableCells, train} from './train.ts'
import {loadIntendedObjects, packForTwin, placesForTwin, softCacheFolderOf} from './twin-data.ts'
import {type GroupName, type LossOptions, type TwinData, createCellArrays, createModel, exactMixesInto, groupNames, groupWidths, mixesInto, snappedTables} from './twin.ts'

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

// 4. A tenth of the open cells, and with open entries of the display table a tenth of those too. The model's
// trainable cells are the ones it was given. Every other cell holds the base tables' choice as exact 0 and 1 in the
// mixes, also an open one. After training, no weight of another cell has moved, and the snapped tables differ from
// the base tables in trainable cells only. Part 6 calls this a second time, for tables with added structure.
async function checkTenthTrainable(tables: RecoveryTables, twinData: TwinData) {
  const trainable = randomTrainableCells(tables, 0.1, 9)
  const model = createModel(tables, {trainable, start: 'uniform'})
  const maskOf = (group: GroupName) => group === 'display' ? trainable.display : group === 'lexerNext' || group === 'lexerEvent' ? trainable.lexer : trainable.grammar
  const sameMask = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((bit, cell) => bit === right[cell])
  check(sameMask(model.trainableLexer, trainable.lexer) && sameMask(model.trainableGrammar, trainable.grammar) && sameMask(model.trainableDisplay, trainable.display), 'the trainable cells of a model are not the masks that createModel was given')
  const widths = groupWidths(model.shape)
  const mixes = createCellArrays(model.shape)
  const exact = createCellArrays(model.shape)
  mixesInto(model, 1, mixes)
  exactMixesInto(tables, exact)
  let notTheBaseChoice = 0
  for (const group of groupNames) {
    const mask = maskOf(group)
    for (let entry = 0; entry < mixes[group].length; entry++) if (mask[Math.floor(entry / widths[group])] === 0 && mixes[group][entry] !== exact[group][entry]) notTheBaseChoice++
  }
  check(notTheBaseChoice === 0, `${notTheBaseChoice} shares of cells that are not trainable are not the base tables' choice as exact 0 and 1`)
  await train(model, twinData, everyPlace, {...trainOptions, seed: 3})
  let movedOutside = 0
  let movedInside = 0
  let movedDisplay = 0
  for (const group of groupNames) {
    const mask = maskOf(group)
    const weights = model.weights[group]
    for (let entry = 0; entry < weights.length; entry++) {
      if (weights[entry] === 0) continue
      if (mask[Math.floor(entry / widths[group])] === 0) movedOutside++
      else {
        movedInside++
        if (group === 'display') movedDisplay++
      }
    }
  }
  const snapped = snappedTables(model)
  checkTables(snapped)
  const differences = differencesOf(tables, snapped)
  const outside = differences.filter(difference => (difference.table === 'tokenizer' ? trainable.lexer : difference.table === 'grammar' ? trainable.grammar : trainable.display)[difference.cell] === 0).length
  const ones = (mask: Uint8Array) => mask.reduce((total, bit) => total + bit, 0)
  check(movedOutside === 0 && movedInside > 0, `${movedOutside} weights of cells that are not trainable moved, and ${movedInside} of trainable cells`)
  check(outside === 0, `${outside} cells that are not trainable changed`)
  return {trainableCells: ones(trainable.lexer) + ones(trainable.grammar), trainableEntries: ones(trainable.display), movedInside, movedOutside, movedDisplay, differences: differences.length, changedEntries: differences.filter(difference => difference.table === 'display').length, outside}
}
{
  const tenth = await checkTenthTrainable(base, data)
  console.log(`4. With ${tenth.trainableCells} of the 1326 open cells trainable: ${tenth.movedInside} weights of trainable cells moved and ${tenth.movedOutside} of other cells. The snapped tables differ from the base tables in ${tenth.differences} cells, ${tenth.outside} of them not trainable.`)
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
  const withStructure = addFirstOnLineBit(openDisplayEntries(addStates(addClasses(base, classesOfTheChecks), 2, [grammarStateNames.indexOf('colon')])))
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
  const withBit = changed.filter(difference => difference.table === 'grammar' && difference.cell % snapped.contextCount >= base.contextCount).length
  check(count('display') > 0 && ofAddedClasses > 0 && withBit > 0, `training changed ${count('display')} entries of the display table, ${ofAddedClasses} cells of added classes and ${withBit} cells with the bit`)
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
  console.log(`6. With ${classesOfTheChecks.length} added classes, 2 added tokenizer states, an added grammar state, open entries of the display table and the bit "first on its line": 4 threads differ from one thread by at most ${largestDifference.toExponential(2)} on a largest gradient of ${largest.toExponential(2)}. `
    + `The trained model's snapped tables differ from the base tables in ${count('tokenizer')} tokenizer cells, ${ofAddedClasses} of them of added classes, ${count('grammar')} grammar cells, ${withBit} of them with the bit, and ${count('display')} entries of the display table, keep the ground rules, and are ${roundTrip}. `
    + `With onlyReadCells the returned tables differ from the base tables in ${differencesOf(withStructure, result.last).length} cells and give the trained texts the same cells and the same trace.`)

  // An open entry's mix leaves out `pastEnd`, the display kind of the cells after a text's end, whatever its weight
  // is, and so does snapping. Here every entry's weight of `pastEnd` is larger than its other weights.
  {
    const kindCount = model.shape.displayKindCount
    const pastEnd = displayKindNames.indexOf('pastEnd')
    const random = createRandom(20261015, 6)
    const largestPastEnd = createModel(withStructure, {start: 'uniform'})
    for (let entry = 0; entry < withStructure.display.length; entry++) {
      for (let kind = 0; kind < kindCount; kind++) largestPastEnd.weights.display[entry * kindCount + kind] = kind === pastEnd ? 5 : 4 * random.next()
    }
    const snappedEntries = snappedTables(largestPastEnd)
    const openEntries = cellCounts(withStructure).displayOpen
    let sharesOfPastEnd = 0
    let totalsNotOne = 0
    let snappedToPastEnd = 0
    for (const temperature of [1, 0.5]) {
      const mixes = createCellArrays(largestPastEnd.shape)
      mixesInto(largestPastEnd, temperature, mixes)
      for (let entry = 0; entry < withStructure.display.length; entry++) {
        if (withStructure.displayOpen[entry] === 0) continue
        if (mixes.display[entry * kindCount + pastEnd] !== 0) sharesOfPastEnd++
        let total = 0
        for (let kind = 0; kind < kindCount; kind++) total += mixes.display[entry * kindCount + kind]!
        if (Math.abs(total - 1) > 1e-12) totalsNotOne++
      }
    }
    for (let entry = 0; entry < withStructure.display.length; entry++) if (withStructure.displayOpen[entry] === 1 && snappedEntries.display[entry] === pastEnd) snappedToPastEnd++
    const problems = problemsOf(snappedEntries)
    check(sharesOfPastEnd === 0 && totalsNotOne === 0, `${sharesOfPastEnd} mixes of open entries give pastEnd a share, and ${totalsNotOne} do not add up to 1`)
    check(snappedToPastEnd === 0 && problems.length === 0, `${snappedToPastEnd} open entries snap to pastEnd, and the snapped tables break the ground rules: ${problems.slice(0, 3).join('; ')}`)
    console.log(`   With the weight of pastEnd the largest of each of the ${openEntries} open entries: ${sharesOfPastEnd} mixes give pastEnd a share at the temperatures 1 and 0.5, ${snappedToPastEnd} entries snap to pastEnd, and the snapped tables keep the ground rules.`)
  }

  // Part 4 with the same structure: a tenth of the open cells and of the open entries.
  const tenth = await checkTenthTrainable(withStructure, dataWithStructure)
  const counts = cellCounts(withStructure)
  check(tenth.trainableEntries > 0 && tenth.trainableEntries < counts.displayOpen && tenth.movedDisplay > 0, `${tenth.trainableEntries} of the ${counts.displayOpen} open entries are trainable, and ${tenth.movedDisplay} of their weights moved`)
  console.log(`   With ${tenth.trainableCells} of the ${counts.lexerOpen + counts.grammarOpen} open cells and ${tenth.trainableEntries} of the ${counts.displayOpen} open entries trainable: the model's trainable cells are the masks it was given, every other cell's mix is the base's choice as exact 0 and 1, `
    + `${tenth.movedInside} weights of trainable cells moved, ${tenth.movedDisplay} of them of entries, and ${tenth.movedOutside} of other cells. The snapped tables differ from the base tables in ${tenth.differences} cells, ${tenth.changedEntries} of them entries and ${tenth.outside} not trainable.`)
}

if (failures > 0) {
  console.log(`${failures} checks FAILED.`)
  process.exit(1)
}
console.log('Every check passed.')
