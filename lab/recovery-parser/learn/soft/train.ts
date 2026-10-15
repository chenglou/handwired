// The trainer of the twin: Adam over the weights of the trainable cells, in batches, with a fixed seed and up to 4
// worker threads. After every so many samples it prints the loss and, on the validation split, the score of the
// snapped tables in the exact parser. Only that score counts: the loss is the twin's, and the twin is not the parser
// once its cells hold mixes.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/soft/train.ts [--name smoke] [--train-samples 400] [--epochs 10] [--batch 32]
//       [--learning-rate 0.05] [--seed 1] [--workers 4] [--start base|uniform] [--start-share 0.9] [--open-share 1]
//       [--intended 0] [--on-track 0] [--temperature 1] [--temperature-end 1] [--sharpness-cost 0] [--log-every 2000]
// It writes log.txt, best.json and last.json to <scratch>/soft/runs/<name>. best.json holds the snapped tables with
// the best score on the validation split, and last.json the ones after the last sample. score.ts reads both:
//   bun lab/recovery-parser/learn/score.ts --tables <scratch>/soft/runs/<name>/best.json --cells
//
// --open-share 0.1 trains a random tenth of the open cells. --intended is one weight for the three extra targets.
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {Worker} from 'node:worker_threads'
import {createRandom} from '../../random.ts'
import {type Samples, loadStandardSamples, optionOf, splitNames, validationPart} from '../data.ts'
import {type RecoveryTables, asIsTables, differencesOf, saveTables} from '../recovery-tables.ts'
import {scoreTables, sharesOf} from '../score.ts'
import type {WorkerAnswer, WorkerSetup, WorkerTask} from './train-worker.ts'
import {loadIntendedObjects, packForTwin, placesForTwin, softCacheFolderOf} from './twin-data.ts'
import {
  type LossOptions, type LossTally, type TwinData, type TwinModel, addSharpnessCost, addTally, cellArraysLength, createCellArrays, createModel, createTally, createTwinRunner,
  defaultDepthHigh, defaultDepthLow, groupNames, groupWidths, mixesInto, runBatch, sharpnessOf, snappedTables, weightGradientsInto,
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
  log?: (line: string) => void
}

export type TrainPoint = {
  samples: number
  // The loss per labeled code point over the samples since the point before. NaN at the first point, before any sample.
  loss: number
  // Shares from 0 to 1 of the snapped tables in the exact parser on the validation split, see score.ts.
  allThree: number
  kind: number
  depth: number
  container: number
  whole: number
  // Cells in which the snapped tables differ from the base tables.
  changedCells: number
}

export type TrainResult = {
  // The snapped tables with the best share of all three labels on the validation split, and the ones after the last sample.
  best: RecoveryTables
  bestPoint: TrainPoint | undefined
  last: RecoveryTables
  points: TrainPoint[]
  // Samples per second of training alone, without the scoring.
  samplesPerSecond: number
}

// Trains the model's weights in place on the samples at `places` of `data`.
export async function train(model: TwinModel, data: TwinData, places: Int32Array, options: TrainOptions = {}): Promise<TrainResult> {
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
  const log = options.log ?? (line => console.log(line))
  const batches = createBatchRunner(model, data, workerCount, options.depthLow, options.depthHigh)
  const weightGradients = createCellArrays(model.shape)

  // The entries of the weights that belong to trainable cells. Adam only steps those.
  const widths = groupWidths(model.shape)
  const trainableEntries: number[] = []
  let offset = 0
  for (const group of groupNames) {
    const trainable = group === 'lexerNext' || group === 'lexerEvent' ? model.trainableLexer : model.trainableGrammar
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
  let bestPoint: TrainPoint | undefined
  let samplesSeen = 0
  let step = 0
  let trainingMilliseconds = 0
  let sinceLog = createTally()
  let samplesAtLastLog = 0
  let temperature = temperatureStart
  let meanEntropy = 0

  const logPoint = () => {
    const tables = snappedTables(model)
    const loss = sinceLog.codePoints === 0 ? NaN : sinceLog.loss / sinceLog.codePoints
    const point: TrainPoint = {samples: samplesSeen, loss, allThree: NaN, kind: NaN, depth: NaN, container: NaN, whole: NaN, changedCells: differencesOf(model.base, tables).length}
    if (options.validation !== undefined) {
      const shares = sharesOf(scoreTables(tables, options.validation, {breakdowns: false}).rows[0]!)
      Object.assign(point, shares)
      if (bestPoint === undefined || point.allThree > bestPoint.allThree) {
        best = tables
        bestPoint = point
      }
    }
    points.push(point)
    const percent = (share: number) => (100 * share).toFixed(1).padStart(5)
    const perCodePoint = (total: number) => sinceLog.codePoints === 0 ? '-' : (total / sinceLog.codePoints).toFixed(3)
    const sharpness = sharpnessOf(model, batches.mixes)
    log(`${String(samplesSeen).padStart(7)} samples  loss ${Number.isNaN(loss) ? '-' : loss.toFixed(4)} (kind ${perCodePoint(sinceLog.kindLoss)} depth ${perCodePoint(sinceLog.depthLoss)} container ${perCodePoint(sinceLog.containerLoss)} intended ${perCodePoint(sinceLog.intendedLoss)})`
      + `  temperature ${temperature.toFixed(2)}  entropy ${meanEntropy.toFixed(3)}  largest share ${sharpness.meanLargestShare.toFixed(3)}`
      + `  snapped on validation: all three ${percent(point.allThree)} kind ${percent(point.kind)} depth ${percent(point.depth)} container ${percent(point.container)} whole ${percent(point.whole)}`
      + `  ${point.changedCells} cells changed  ${trainingMilliseconds === 0 ? '-' : (samplesSeen / (trainingMilliseconds / 1000)).toFixed(0)} samples/s`)
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
      weightGradientsInto(model, temperature, batches.mixes, batches.mixGradients, 1 / Math.max(1, tally.codePoints), weightGradients)
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
  await batches.close()
  return {best, bestPoint, last: snappedTables(model), points, samplesPerSecond: samplesSeen / (trainingMilliseconds / 1000)}
}

// A random share of the open cells of `tables`, as masks of trainable cells, e.g. a tenth with share 0.1.
export function randomTrainableCells(tables: RecoveryTables, share: number, seed: number) {
  const random = createRandom(seed, 0)
  const pick = (open: Uint8Array) => open.map(bit => bit === 1 && random.next() < share ? 1 : 0)
  return {lexer: pick(tables.lexerOpen), grammar: pick(tables.grammarOpen)}
}

if (import.meta.main) {
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
  const everyTrainPlace = placesForTwin(samples, splitNames.indexOf('train'))
  const trainPlaces = everyTrainPlace.subarray(0, Math.min(everyTrainPlace.length, trainSamples))
  const data = packForTwin(samples, trainPlaces, onTrack > 0 ? loadIntendedObjects(samples, softCacheFolderOf(scratch)) : undefined)
  const base = asIsTables()
  const model = createModel(base, {start, startShare: number('--start-share', 0.9), ...(openShare < 1 ? {trainable: randomTrainableCells(base, openShare, seed)} : {})})
  const trainableCells = model.trainableLexer.reduce((total, bit) => total + bit, 0) + model.trainableGrammar.reduce((total, bit) => total + bit, 0)
  log(`bun ${process.argv.slice(1).join(' ')}`)
  log(`${trainPlaces.length} of the ${everyTrainPlace.length} train samples that give the twin a step, ${data.start[data.sampleCount]} code points. ${trainableCells} trainable cells. Tables and log in ${folder}`)
  const result = await train(model, data, Int32Array.from({length: data.sampleCount}, (_, place) => place), {
    seed, epochs: number('--epochs', 1), batchSize: number('--batch', 32), learningRate: number('--learning-rate', 0.05), workers: number('--workers', 4),
    loss: {intendedLexerWeight: intended, intendedEventWeight: intended, intendedGrammarWeight: intended, onTrackProbability: onTrack},
    temperatureStart, temperatureEnd: number('--temperature-end', temperatureStart), sharpnessCost: number('--sharpness-cost', 0),
    logEverySamples: number('--log-every', 2000), validation: validationPart(samples), log,
  })
  const describe = (point: TrainPoint | undefined) => point === undefined ? 'no score' : `all three ${(100 * point.allThree).toFixed(1)}% after ${point.samples} samples, ${point.changedCells} cells changed`
  saveTables(join(folder, 'best.json'), result.best, `soft twin, run ${name}, best on validation: ${describe(result.bestPoint)}`)
  saveTables(join(folder, 'last.json'), result.last, `soft twin, run ${name}, after the last sample: ${describe(result.points.at(-1))}`)
  log(`The base tables on validation: all three ${(100 * result.points[0]!.allThree).toFixed(1)}%. Best snapped tables: ${describe(result.bestPoint)}. Last: ${describe(result.points.at(-1))}.`)
  log(`${result.samplesPerSecond.toFixed(0)} samples per second of training.`)
}
