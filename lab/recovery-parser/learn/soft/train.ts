// The trainer of the twin: Adam over the weights of the trainable cells, in batches, with a fixed seed and up to 4
// worker threads. After every so many samples it prints the loss and, on the validation split, the score of the
// snapped tables in the exact parser. Only that score counts: the loss is the twin's, and the twin is not the parser
// once its cells hold mixes.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/soft/train.ts [--name smoke] [--train-samples 400] [--epochs 10] [--batch 32]
//       [--learning-rate 0.05] [--seed 1] [--workers 4] [--base <tables.json>] [--start base|uniform] [--start-share 0.9]
//       [--open-share 1] [--intended 0] [--on-track 0] [--every-intended] [--temperature 1] [--temperature-end 1]
//       [--sharpness-cost 0] [--depth-low -8] [--depth-high 24] [--only-read-cells] [--log-every 2000]
// It writes log.txt, best.json and last.json to <scratch>/soft/runs/<name>. last.json holds the snapped tables after
// the last sample. best.json holds the snapped tables of the log point with the best score on one half of the
// validation split, and the log gives their score on the other half. score.ts reads both files:
//   bun lab/recovery-parser/learn/score.ts --tables <scratch>/soft/runs/<name>/best.json --cells
//
// --base starts from saved tables in place of today's, e.g. the hand-written ones, or tables with added structure,
// see ../structure/README.md. --open-share 0.1 trains a random
// tenth of the open cells. --intended is one weight for the three extra targets. --every-intended uses the intended
// states at every kept code point, as the first version did, see LossOptions.intendedEverywhere. --depth-low and
// --depth-high set the depths that the twin holds a share for, e.g. --depth-high 48 for a uniform start, whose first
// steps push more than they pop.
//
// What a log line holds, besides the loss since the line before:
// - "free run": the loss of the three labels on a fixed set of the trained samples, run without the extra targets
//   and without keeping the run on track. Only this loss compares between runs with other options, since a run that
//   is kept on track has a low loss whatever it would do by itself. Next to it, the same loss without the code
//   points at which cells that are not trainable rule a label out: those cost 13.8 per label whatever is trained.
//   The line gives their count, since a few of them round to 0.0% and still show in the loss.
// - "reads as the snapped tables": at how many scored code points of the fixed set the twin's largest shares are
//   the display kind, the depth and the container that the exact parser gives with the snapped tables. A mix that
//   starts with 0.9 on a choice is not that choice: 20 steps after a first error the twin's reading has drifted.
// - The score of the snapped tables on the validation split, on the whole split and on its two halves.
// - How many cells of the snapped tables differ from the base tables, and how many of those the exact parser reads
//   at a code point of a trained text. The others moved only because the twin's mixes read them. The line also has
//   the score of the snapped tables with the base tables' choice back in those other cells. With --only-read-cells
//   these are the tables that are scored, picked and saved. Without it the snapped tables are, as they come: the
//   cells that no trained text reads are not noise, e.g. after training on 400 samples they hold 1.6 to 5.8 points
//   of the validation score, see README.md.
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {Worker} from 'node:worker_threads'
import {createRandom} from '../../random.ts'
import {type Samples, codePointScored, loadStandardSamples, optionOf, refuseUnknownOptions, selectSamples, splitNames, validationPart} from '../data.ts'
import {positionCount} from '../recovery-parser.ts'
import {type RecoveryTables, asIsTables, differencesOf, loadTablesOfThisDataset, saveTables} from '../recovery-tables.ts'
import {cellsReadAt, scoreTables, sharesOf, withUnreadCellsOf} from '../score.ts'
import type {WorkerAnswer, WorkerSetup, WorkerTask} from './train-worker.ts'
import {loadIntendedObjects, packForTwin, placesForTwin, softCacheFolderOf} from './twin-data.ts'
import {
  type LossOptions, type LossTally, type TwinData, type TwinModel, addSharpnessCost, addTally, cellArraysLength, createCellArrays, createModel, createTally, createTwinRunner,
  defaultDepthHigh, defaultDepthLow, exactMixesInto, groupNames, groupWidths, mixesInto, runBatch, sharpnessOf, snappedTables, trainableOf, weightGradientsInto,
} from './twin.ts'

// Runs batches of samples on worker threads, or in this thread with 0 workers. The mixes are read from `mixes`, which
// the caller fills before a batch, and the gradients by the mixes are added up in `mixGradients`.
export function createBatchRunner(model: TwinModel, data: TwinData, workerCount: number, depthLow: number = defaultDepthLow, depthHigh: number = defaultDepthHigh) {
  const shape = model.shape
  const bytes = 8 * cellArraysLength(shape)
  const mixes = createCellArrays(shape, new SharedArrayBuffer(bytes))
  const mixGradients = createCellArrays(shape)
  const localRunner = workerCount === 0 ? createTwinRunner(shape, depthLow, depthHigh) : undefined
  localRunner?.setMixes(mixes)
  const workers = Array.from({length: workerCount}, () => {
    const gradientsBuffer = new SharedArrayBuffer(bytes)
    const setup: WorkerSetup = {shape, data, depthLow, depthHigh, mixesBuffer: mixes.all.buffer as SharedArrayBuffer, gradientsBuffer}
    return {thread: new Worker(new URL('./train-worker.ts', import.meta.url), {workerData: setup}), gradients: createCellArrays(shape, gradientsBuffer)}
  })

  // The loss of the samples at `places`, and with `withGradients` their gradients by the mixes in `mixGradients`. The
  // samples are split over the workers in order, and the parts are added up in the workers' order, so the result
  // does not depend on which worker finishes first.
  async function run(places: Int32Array, options: LossOptions, withGradients: boolean): Promise<LossTally> {
    if (withGradients) mixGradients.all.fill(0)
    if (localRunner !== undefined) return runBatch(localRunner, data, places, 0, places.length, options, withGradients ? mixGradients : undefined)
    const answers = await Promise.all(workers.map((worker, index) => new Promise<WorkerAnswer>((resolve, reject) => {
      const from = Math.floor(places.length * index / workers.length)
      const to = Math.floor(places.length * (index + 1) / workers.length)
      worker.thread.once('message', resolve)
      worker.thread.once('error', reject)
      const task: WorkerTask = {places: places.slice(from, to), options, withGradients}
      worker.thread.postMessage(task)
    })))
    const tally = createTally()
    for (let index = 0; index < workers.length; index++) {
      addTally(tally, answers[index]!)
      workers[index]!.thread.removeAllListeners('error')
      if (!withGradients) continue
      const part = workers[index]!.gradients.all
      for (let entry = 0; entry < part.length; entry++) mixGradients.all[entry]! += part[entry]!
    }
    return tally
  }
  const close = async () => {
    await Promise.all(workers.map(worker => worker.thread.terminate()))
  }
  return {mixes, mixGradients, run, close}
}

export type TrainOptions = {
  // The samples to train on, as places in `data`, i.e. numbers from 0 to data.sampleCount - 1, e.g. the first 400.
  // Without it, every sample of `data`, which is what a run wants that packed its training samples with packForTwin.
  // They are not places in the Samples that `data` was packed from: train throws when a place is outside `data`.
  places?: Int32Array
  // True lets the run train on samples that are not of the train split, e.g. a check that packs validation samples
  // to see what the trainer does. Without it train throws for such a sample: `data` holds the split of each sample,
  // and a build function that packed placesForTwin(samples, 'validation') by mistake would otherwise train on the
  // split that its tables are then scored on.
  alsoOtherSplits?: boolean
  // The seed of the order of the samples and of the draws that keep a run on track. The default is 1.
  seed?: number
  // How many times training goes over the samples. The default is 1.
  epochs?: number
  // Samples per step of Adam. The default is 32.
  batchSize?: number
  // The default is 0.05.
  learningRate?: number
  // Worker threads, at most 4, or 0 to run in this thread. The default is 4.
  workers?: number
  depthLow?: number
  depthHigh?: number
  // The weights of the losses, the extra targets and the probability of keeping a run on track, see LossOptions.
  loss?: Omit<LossOptions, 'onTrackSeed'>
  // The temperature of the softmaxes at the first sample and at the last one. In between it changes by the same
  // factor per sample. The defaults are 1 and the start's value.
  temperatureStart?: number
  temperatureEnd?: number
  // The weight of the cost on a mix being far from one choice. The default is 0.
  sharpnessCost?: number
  // A log line and a score on the validation split after every so many samples, and after the last one. The default
  // is 2000.
  logEverySamples?: number
  // The samples whose validation split scores the snapped tables. Without them, no score is made.
  validation?: Samples
  // The samples that `data` was packed from, and the places in them of the samples of `data`. With them, a log point
  // also counts the changed cells that the exact parser reads at a code point of these texts, and scores the snapped
  // tables with the base tables' choice back in every other cell, see withUnreadCellsOf in score.ts: training moved
  // such a cell only because the twin's mixes read it.
  trainedOn?: {samples: Samples, places: ArrayLike<number>}
  // True returns those tables, with the base tables' choice in the cells that no trained text reads, and scores and
  // picks by them. It needs trainedOn. The default is false: the snapped tables as they come.
  onlyReadCells?: boolean
  log?: (line: string) => void
}

export type TrainPoint = {
  samples: number
  // The loss per scored code point over the samples since the point before, i.e. the loss divided by the weight of
  // the scored code points, see LossTally.weight. NaN at the first point, before any sample.
  loss: number
  // Shares from 0 to 1 of the returned tables in the exact parser on the validation split, see score.ts. The
  // returned tables are the snapped ones, or with TrainOptions.onlyReadCells the ones in readCellsOnly below.
  allThree: number
  kind: number
  depth: number
  container: number
  whole: number
  // The share of all three on the two halves of the validation split: the samples at even places, which pick the
  // best tables, and the samples at odd places, which say how good the picked tables are.
  pickingHalf: number
  otherHalf: number
  // Cells in which the snapped tables differ from the base tables, and how many of those the exact parser reads at
  // a code point of a trained text. Without TrainOptions.trainedOn the two are the same.
  changedCells: number
  changedAndRead: number
  // The share of all three on the validation split of the snapped tables with the base tables' choice back in the
  // cells that no trained text reads. NaN without TrainOptions.trainedOn.
  readCellsOnly: number
  // On a fixed set of the trained samples, without the extra targets and without keeping the run on track: the loss
  // of the three labels per code point, the same without the code points at which a label has a share of exactly 0,
  // the share of those code points, and the share of the code points at which the twin's largest shares are what
  // the exact parser gives with the snapped tables. Then the numbers behind the share `ruledOut`: how many scored
  // code points the fixed set has, and at how many of them a label has a share of exactly 0. A few of many round to
  // 0.0%, e.g. 5 of 15,063, and still show in the loss, at 13.8 per label.
  freeLoss: number
  freeLossWithoutRuledOut: number
  ruledOut: number
  readsAsSnapped: number
  fixedCodePoints: number
  ruledOutCodePoints: number
}

export type TrainResult = {
  // The snapped tables of the log point with the best share of all three labels on the picking half of the
  // validation split, and the ones after the last sample. With TrainOptions.onlyReadCells both hold the base tables'
  // choice in the cells that no trained text reads. Without TrainOptions.validation nothing is scored, so no log
  // point is the best one: `best` is then `last`, and `bestPoint` is undefined.
  best: RecoveryTables
  bestPoint: TrainPoint | undefined
  last: RecoveryTables
  points: TrainPoint[]
  // Samples per second of training alone, without the scoring.
  samplesPerSecond: number
}

// How many samples the free run of a log point uses: the first so many of the trained ones.
const fixedSampleCount = 100

// The scored code points of the samples at `places` of `data`: the ones that the loss counts.
function scoredCodePointsOf(data: TwinData, places: Int32Array) {
  let scored = 0
  for (const place of places) {
    const start = data.start[place]!
    const length = data.start[place + 1]! - start
    const firstError = data.firstError[place]!
    if (firstError < 0) continue
    for (let position = firstError; position < length; position++) if ((data.flags[start + position]! & codePointScored) !== 0) scored++
  }
  return scored
}

// Trains the model's weights in place on every sample of `data`, or on the samples at `options.places` of `data`.
//
// The samples to train on are no argument of their own: a call that passed the places of its samples in the set that
// `data` was packed from, e.g. the result of placesForTwin, trained on other samples or on nothing without a word.
// Now `data` is the run's samples, and each of these throws: a place outside `data`, a set without a scored code
// point, anything but options as the third argument, a sample that is not of the train split (unless
// `options.alsoOtherSplits` is true), and a model without a trainable cell.
export async function train(model: TwinModel, data: TwinData, options: TrainOptions = {}): Promise<TrainResult> {
  if (ArrayBuffer.isView(options) || Array.isArray(options) || arguments.length > 3) throw new Error('train takes (model, data, options). The samples to train on are every sample of `data`, or `options.places`, which are places in `data`')
  const places = options.places ?? Int32Array.from({length: data.sampleCount}, (_, place) => place)
  const trainSplit = splitNames.indexOf('train')
  for (const place of places) {
    if (!Number.isInteger(place) || place < 0 || place >= data.sampleCount) throw new Error(`train got the place ${place}, and \`data\` has the places 0 to ${data.sampleCount - 1}: \`options.places\` are places in the packed data, not in the samples it was packed from`)
    if (data.split[place] !== trainSplit && options.alsoOtherSplits !== true) {
      throw new Error(`train got the sample ${data.index[place]} of the dataset, which is in the ${splitNames[data.split[place]!]} split: a run trains on the train split only, e.g. on packForTwin(samples, placesForTwin(samples, 'train'), ...). \`alsoOtherSplits: true\` switches this error off`)
    }
  }
  if (scoredCodePointsOf(data, places) === 0) throw new Error(`train got ${places.length} samples without a scored code point, so there is nothing to train on`)
  if (![model.trainableLexer, model.trainableGrammar, model.trainableDisplay].some(mask => mask.includes(1))) throw new Error('train got a model without a trainable cell, e.g. one made with lexer, grammar and display all \'none\': there is nothing to train')
  const seed = options.seed ?? 1
  const epochs = options.epochs ?? 1
  const batchSize = options.batchSize ?? 32
  const learningRate = options.learningRate ?? 0.05
  const workerCount = options.workers ?? 4
  if (workerCount < 0 || workerCount > 4) throw new Error(`train takes 0 to 4 workers, and got ${workerCount}`)
  const temperatureStart = options.temperatureStart ?? 1
  const temperatureEnd = options.temperatureEnd ?? temperatureStart
  const sharpnessCost = options.sharpnessCost ?? 0
  const logEverySamples = options.logEverySamples ?? 2000
  const onlyReadCells = options.onlyReadCells === true
  if (onlyReadCells && options.trainedOn === undefined) throw new Error('onlyReadCells needs trainedOn, the texts that say which cells are read')
  const log = options.log ?? (line => console.log(line))
  const batches = createBatchRunner(model, data, workerCount, options.depthLow, options.depthHigh)
  // The worker threads are closed whether the run ends or throws: a thread that is left alive keeps the process from
  // ending, e.g. a script that catches the error of a log point would hang.
  const run = async (): Promise<TrainResult> => {
    const weightGradients = createCellArrays(model.shape)

    // The entries of the weights that belong to trainable cells. Adam only steps those.
    const widths = groupWidths(model.shape)
    const trainableEntries: number[] = []
    let offset = 0
    for (const group of groupNames) {
      const trainable = trainableOf(model, group)
      for (let cell = 0; cell < trainable.length; cell++) {
        if (trainable[cell] === 1) for (let choice = 0; choice < widths[group]; choice++) trainableEntries.push(offset + cell * widths[group] + choice)
      }
      offset += trainable.length * widths[group]
    }
    const firstMoment = new Float64Array(model.weights.all.length)
    const secondMoment = new Float64Array(model.weights.all.length)
    const firstDecay = 0.9
    const secondDecay = 0.999

    const totalSamples = epochs * places.length
    const points: TrainPoint[] = []
    let best = snappedTables(model)
    let last = best
    let bestPoint: TrainPoint | undefined
    let samplesSeen = 0
    let step = 0
    let trainingMilliseconds = 0
    let sinceLog = createTally()
    let samplesAtLastLog = 0
    let temperature = temperatureStart
    let meanEntropy = 0

    // The two halves of the validation split.
    const validationHalves = options.validation === undefined ? undefined : [0, 1].map(half =>
      selectSamples(options.validation!, Int32Array.from({length: options.validation!.sampleCount}, (_, place) => place).filter(place => place % 2 === half)))

    // The fixed set of a log point: a free run of the twin and a run of the exact tables, both in this thread.
    const fixedPlaces = places.subarray(0, Math.min(places.length, fixedSampleCount))
    const reader = createTwinRunner(model.shape, options.depthLow, options.depthHigh)
    const exactMixes = createCellArrays(model.shape)
    const labelWeights: LossOptions = {kindWeight: options.loss?.kindWeight ?? 1, depthWeight: options.loss?.depthWeight ?? 1, containerWeight: options.loss?.containerWeight ?? 1}
    const largestOf = (shares: Float64Array, base: number, count: number) => {
      let largest = 0
      for (let entry = 1; entry < count; entry++) if (shares[base + entry]! > shares[base + largest]!) largest = entry
      return largest
    }
    const readings = new Int16Array(3 * positionCount)
    const readFixedSet = (tables: RecoveryTables) => {
      exactMixesInto(tables, exactMixes)
      const tally = createTally()
      const unused = createTally()
      const kindCount = model.shape.displayKindCount
      let compared = 0
      let same = 0
      for (const place of fixedPlaces) {
        const start = data.start[place]!
        const length = data.start[place + 1]! - start
        const from = data.firstError[place]!
        reader.setMixes(batches.mixes)
        reader.runSample(data, place, labelWeights, tally)
        for (let position = from; position < length; position++) {
          readings[3 * position] = largestOf(reader.kinds, position * kindCount, kindCount)
          readings[3 * position + 1] = largestOf(reader.depthAfter, position * reader.depthCount, reader.depthCount)
          readings[3 * position + 2] = largestOf(reader.containers, position * 3, 3)
        }
        reader.setMixes(exactMixes)
        reader.runSample(data, place, labelWeights, unused)
        for (let position = from; position < length; position++) {
          if ((data.flags[start + position]! & codePointScored) === 0) continue
          compared++
          if (readings[3 * position] === largestOf(reader.kinds, position * kindCount, kindCount) && readings[3 * position + 1] === largestOf(reader.depthAfter, position * reader.depthCount, reader.depthCount)
            && readings[3 * position + 2] === largestOf(reader.containers, position * 3, 3)) same++
        }
      }
      const labelLoss = tally.kindLoss + tally.depthLoss + tally.containerLoss
      return {
        freeLoss: tally.codePoints === 0 ? NaN : labelLoss / tally.codePoints,
        freeLossWithoutRuledOut: tally.codePoints === tally.ruledOut ? NaN : (labelLoss - tally.ruledOutLoss) / (tally.codePoints - tally.ruledOut),
        ruledOut: tally.codePoints === 0 ? NaN : tally.ruledOut / tally.codePoints,
        readsAsSnapped: compared === 0 ? NaN : same / compared,
        fixedCodePoints: tally.codePoints, ruledOutCodePoints: tally.ruledOut,
      }
    }

    const logPoint = () => {
      const snapped = snappedTables(model)
      const changedCells = differencesOf(model.base, snapped).length
      // The snapped tables with the base tables' choice back in the cells that no trained text reads. That changes no
      // trace of a trained text.
      const readCellsOnly = options.trainedOn === undefined ? undefined : withUnreadCellsOf(model.base, snapped, cellsReadAt(snapped, options.trainedOn.samples, options.trainedOn.places)).tables
      const changedAndRead = readCellsOnly === undefined ? changedCells : differencesOf(model.base, readCellsOnly).length
      const tables = onlyReadCells && readCellsOnly !== undefined ? readCellsOnly : snapped
      const loss = sinceLog.weight === 0 ? NaN : sinceLog.loss / sinceLog.weight
      const point: TrainPoint = {samples: samplesSeen, loss, allThree: NaN, kind: NaN, depth: NaN, container: NaN, whole: NaN, pickingHalf: NaN, otherHalf: NaN, changedCells, changedAndRead, readCellsOnly: NaN, ...readFixedSet(tables)}
      if (options.validation !== undefined && validationHalves !== undefined) {
        if (readCellsOnly !== undefined) point.readCellsOnly = sharesOf(scoreTables(readCellsOnly, options.validation, {breakdowns: false}).rows[0]!).allThree
        const shares = sharesOf(scoreTables(tables, options.validation, {breakdowns: false}).rows[0]!)
        point.allThree = shares.allThree
        point.kind = shares.kind
        point.depth = shares.depth
        point.container = shares.container
        point.whole = shares.whole
        point.pickingHalf = sharesOf(scoreTables(tables, validationHalves[0]!, {breakdowns: false}).rows[0]!).allThree
        point.otherHalf = sharesOf(scoreTables(tables, validationHalves[1]!, {breakdowns: false}).rows[0]!).allThree
        if (bestPoint === undefined || point.pickingHalf > bestPoint.pickingHalf) {
          best = tables
          bestPoint = point
        }
      }
      last = tables
      points.push(point)
      const percent = (share: number) => (100 * share).toFixed(1).padStart(5)
      const perCodePoint = (total: number) => sinceLog.weight === 0 ? '-' : (total / sinceLog.weight).toFixed(3)
      const sharpness = sharpnessOf(model, batches.mixes)
      log(`${String(samplesSeen).padStart(7)} samples  loss ${Number.isNaN(loss) ? '-' : loss.toFixed(4)} (kind ${perCodePoint(sinceLog.kindLoss)} depth ${perCodePoint(sinceLog.depthLoss)} container ${perCodePoint(sinceLog.containerLoss)} intended ${perCodePoint(sinceLog.intendedLoss)})`
        + `  free run: loss ${point.freeLoss.toFixed(4)}, ${point.freeLossWithoutRuledOut.toFixed(4)} without the ${point.ruledOutCodePoints} of ${point.fixedCodePoints} code points with a label ruled out (${(100 * point.ruledOut).toFixed(1)}%), reads as the snapped tables at ${percent(point.readsAsSnapped).trim()}%`
        + `  temperature ${temperature.toFixed(2)}  entropy ${meanEntropy.toFixed(3)}  largest share ${sharpness.meanLargestShare.toFixed(3)}`
        + `  snapped on validation: all three ${percent(point.allThree)} (halves ${percent(point.pickingHalf).trim()} and ${percent(point.otherHalf).trim()}) kind ${percent(point.kind)} depth ${percent(point.depth)} container ${percent(point.container)} whole ${percent(point.whole)}`
        + `  ${point.changedCells} cells changed against the base, ${point.changedAndRead} of them read by a trained text, with the others as in the base: all three ${percent(point.readCellsOnly).trim()}  ${trainingMilliseconds === 0 ? '-' : (samplesSeen / (trainingMilliseconds / 1000)).toFixed(0)} samples/s`)
      sinceLog = createTally()
      samplesAtLastLog = samplesSeen
    }

    mixesInto(model, temperature, batches.mixes)
    logPoint()
    for (let epoch = 0; epoch < epochs; epoch++) {
      const order = Int32Array.from(createRandom(seed, epoch).shuffled(Array.from(places)))
      for (let from = 0; from < order.length; from += batchSize) {
        const started = performance.now()
        const batch = order.subarray(from, Math.min(order.length, from + batchSize))
        temperature = temperatureStart * (temperatureEnd / temperatureStart) ** (samplesSeen / totalSamples)
        mixesInto(model, temperature, batches.mixes)
        step++
        // The draws that keep a run on track change with every step.
        const tally = await batches.run(batch, {...options.loss, onTrackSeed: seed * 1_000_003 + step}, true)
        weightGradientsInto(model, temperature, batches.mixes, batches.mixGradients, tally.weight === 0 ? 1 : 1 / tally.weight, weightGradients)
        meanEntropy = addSharpnessCost(model, temperature, batches.mixes, sharpnessCost, weightGradients)
        const firstCorrection = 1 - firstDecay ** step
        const secondCorrection = 1 - secondDecay ** step
        for (const entry of trainableEntries) {
          const gradient = weightGradients.all[entry]!
          firstMoment[entry] = firstDecay * firstMoment[entry]! + (1 - firstDecay) * gradient
          secondMoment[entry] = secondDecay * secondMoment[entry]! + (1 - secondDecay) * gradient * gradient
          model.weights.all[entry]! -= learningRate * (firstMoment[entry] / firstCorrection) / (Math.sqrt(secondMoment[entry] / secondCorrection) + 1e-8)
        }
        addTally(sinceLog, tally)
        samplesSeen += batch.length
        trainingMilliseconds += performance.now() - started
        if (samplesSeen - samplesAtLastLog >= logEverySamples || samplesSeen === totalSamples) {
          mixesInto(model, temperature, batches.mixes)
          logPoint()
        }
      }
    }
    // Without a validation split no log point was scored, and `best` still holds the tables from before training.
    if (bestPoint === undefined) best = last
    return {best, bestPoint, last, points, samplesPerSecond: samplesSeen / (trainingMilliseconds / 1000)}
  }
  try {
    return await run()
  } finally {
    await batches.close()
  }
}

// A random share of the open cells of `tables` and of the open entries of their display table, as masks of trainable
// cells, e.g. a tenth with share 0.1.
export function randomTrainableCells(tables: RecoveryTables, share: number, seed: number) {
  const random = createRandom(seed, 0)
  const pick = (open: Uint8Array) => open.map(bit => bit === 1 && random.next() < share ? 1 : 0)
  return {lexer: pick(tables.lexerOpen), grammar: pick(tables.grammarOpen), display: pick(tables.displayOpen)}
}

if (import.meta.main) {
  refuseUnknownOptions('soft/train.ts', [
    '--name', '--train-samples', '--epochs', '--batch', '--learning-rate', '--seed', '--workers', '--base', '--start', '--start-share', '--open-share', '--intended', '--on-track', '--every-intended',
    '--temperature', '--temperature-end', '--sharpness-cost', '--depth-low', '--depth-high', '--only-read-cells', '--log-every',
  ])
  const number = (name: string, fallback: number) => Number(optionOf(name) ?? fallback)
  const scratch = process.env['RECOVERY_SCRATCH']
  if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to a folder outside the repo: the run\'s log and tables go there')
  const name = optionOf('--name') ?? 'run'
  const folder = join(scratch, 'soft', 'runs', name)
  mkdirSync(folder, {recursive: true})
  const logFile = join(folder, 'log.txt')
  writeFileSync(logFile, '')
  const log = (line: string) => {
    console.log(line)
    appendFileSync(logFile, `${line}\n`)
  }
  const seed = number('--seed', 1)
  const trainSamples = number('--train-samples', Infinity)
  const start = (optionOf('--start') ?? 'base') as 'base' | 'uniform'
  const openShare = number('--open-share', 1)
  const intended = number('--intended', 0)
  const onTrack = number('--on-track', 0)
  const temperatureStart = number('--temperature', 1)

  const samples = loadStandardSamples()
  const everyTrainPlace = placesForTwin(samples, 'train')
  const trainPlaces = everyTrainPlace.subarray(0, Math.min(everyTrainPlace.length, trainSamples))
  const baseFile = optionOf('--base')
  // A base of another version of the dataset is refused: the run's tables are saved with this dataset's key.
  const base = baseFile === undefined ? asIsTables() : loadTablesOfThisDataset(baseFile).tables
  const data = packForTwin(samples, trainPlaces, onTrack > 0 ? loadIntendedObjects(samples, softCacheFolderOf(scratch)) : undefined, base)
  const model = createModel(base, {start, startShare: number('--start-share', 0.9), ...(openShare < 1 ? {trainable: randomTrainableCells(base, openShare, seed)} : {})})
  const trainableCells = [model.trainableLexer, model.trainableGrammar, model.trainableDisplay].reduce((total, mask) => total + mask.reduce((count, bit) => count + bit, 0), 0)
  log(`bun ${process.argv.slice(1).join(' ')}`)
  log(`${trainPlaces.length} of the ${everyTrainPlace.length} train samples that give the twin a step, ${data.start[data.sampleCount]} code points. ${trainableCells} trainable cells. Base tables: ${baseFile ?? 'today\'s'}. Tables and log in ${folder}`)
  const result = await train(model, data, {
    seed, epochs: number('--epochs', 1), batchSize: number('--batch', 32), learningRate: number('--learning-rate', 0.05), workers: number('--workers', 4),
    loss: {intendedLexerWeight: intended, intendedEventWeight: intended, intendedGrammarWeight: intended, onTrackProbability: onTrack, intendedEverywhere: process.argv.includes('--every-intended')},
    temperatureStart, temperatureEnd: number('--temperature-end', temperatureStart), sharpnessCost: number('--sharpness-cost', 0),
    depthLow: number('--depth-low', defaultDepthLow), depthHigh: number('--depth-high', defaultDepthHigh),
    logEverySamples: number('--log-every', 2000), validation: validationPart(samples), trainedOn: {samples, places: trainPlaces}, onlyReadCells: process.argv.includes('--only-read-cells'), log,
  })
  const percent = (share: number) => `${(100 * share).toFixed(1)}%`
  const describe = (point: TrainPoint | undefined) => point === undefined ? 'no score' : `all three ${percent(point.allThree)} on the validation split after ${point.samples} samples, ${point.changedCells} cells changed against the base, ${point.changedAndRead} of them read by a trained text (with the others as in the base: ${percent(point.readCellsOnly)})`
  saveTables(join(folder, 'best.json'), result.best, `soft twin, run ${name}, picked on one half of the validation split: ${describe(result.bestPoint)}${result.bestPoint === undefined ? '' : `, ${percent(result.bestPoint.otherHalf)} on the other half`}`)
  saveTables(join(folder, 'last.json'), result.last, `soft twin, run ${name}, after the last sample: ${describe(result.points.at(-1))}`)
  const lastPoints = result.points.slice(-5).map(point => point.allThree)
  log(`The base tables on validation: all three ${percent(result.points[0]!.allThree)}.`)
  if (result.bestPoint !== undefined) log(`Best snapped tables, picked by the half of the validation split at even places (${percent(result.bestPoint.pickingHalf)} there): all three ${percent(result.bestPoint.otherHalf)} on the other half, ${percent(result.bestPoint.allThree)} on the whole split, after ${result.bestPoint.samples} samples, ${result.bestPoint.changedCells} cells changed against the base.`)
  log(`Last snapped tables: ${describe(result.points.at(-1))}. The last ${lastPoints.length} log points have all three from ${percent(Math.min(...lastPoints))} to ${percent(Math.max(...lastPoints))} on the whole split.`)
  log(`The last snapped tables differ from the run's base in ${differencesOf(base, result.last).length} cells, and from today's parser in ${differencesOf(asIsTables(), result.last).length}. The second count also holds what added structure copied, see cellCountsOf in ../score.ts.`)
  log(`${result.samplesPerSecond.toFixed(0)} samples per second of training.`)
}
