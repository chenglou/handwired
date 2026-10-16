// The trainer of a twin: Adam over the logits of the trainable cells and entries, in batches, with a fixed seed and
// up to 4 worker threads. It is the trainer of the JSON side (lab/recovery-parser/learn/soft/train.ts) with its
// settings: batches of 32 samples, a rate of 0.05, Adam's decays 0.9 and 0.999, the gradient of a batch divided by
// the batch's scored code points, and tables by snapping. Only the score of the snapped tables in the exact parser
// counts: the loss is the twin's, and a twin is not the parser once its cells hold mixes.
//
// Left out, because the recipe never uses them: the temperature, the cost on a mix being far from one choice, the
// extra targets, keeping a run on track, and the pick of a best log point on half of the validation samples.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/learn/soft/train.ts [--name smoke] [--train <samples>] [--validation <samples>] [--epochs 1]
//       [--batch 32] [--learning-rate 0.05] [--seed 1] [--workers 4] [--start base|uniform] [--start-share 0.9]
//       [--flag] [--without-end-early] [--twin <module that exports createTwin>] [--width 48] [--log-every 2000]
// It trains every cell that may change and every open display entry of the parser as it is, with the flag "first
// on its line" for --flag, and writes log.txt and last.json to <scratch>/learn/soft/runs/<name>. The recipe of the
// experiment, with its other steps, is ../recipe.ts.
//
// A log line holds, besides the loss per scored code point since the line before:
// - The labels without a share: the share of the labels, three per scored code point, whose share in the twin is
//   exactly 0. Each costs 13.8, whatever is trained.
// - "reads as the snapped tables": at how many scored code points of the first 100 trained samples the twin's
//   largest shares are the display kind, the depth and the container that the snapped tables give. A mix that
//   starts with 0.9 on a choice is not that choice.
// - The mean of the largest share of a mix.
// - What the twin counted about its own work since the line before, e.g. the stacks that it kept per token.
// - The score of the snapped tables on the validation samples in the exact parser, when the run has such samples.
// - How many cells and display entries of the snapped tables differ from the base tables.
import {appendFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {Worker} from 'node:worker_threads'
import {containerCount, displayKindCount} from '../../labels.ts'
import {createRandom} from '../../random.ts'
import {type PackedSamples, loadPacked, messageOf, refuseOtherTerminals} from '../data.ts'
import {flagOf, learnFolder, numberOf, optionOf, refuseUnknownOptions, standardTrainCount, standardValidationCount} from '../options.ts'
import {type RecoveryTables, addFirstOnLineFlag, baseTables, differencesOf, saveTables, withoutEndEarly} from '../recovery-tables.ts'
import {scoreRow, scoreTables, sharesOf} from '../score.ts'
import {type Layout, type Model, createModel, logitsOfTables, meanLargestShare, sharesInto, snappedTables} from './model.ts'
import type {WorkerAnswer, WorkerSetup, WorkerTask} from './train-worker.ts'
import {type LossTally, type TwinChoice, addTally, createReading, createTally, loadTwin, readingDepthCount, referenceTwin} from './twin.ts'

// Runs batches of samples on worker threads, or in this thread with 0 workers. The caller writes the logits into
// `logits` before a batch, and the gradient of the batch's summed loss by the logits is in `gradient` after it.
export async function createBatchRunner(layout: Layout, samples: PackedSamples, workerCount: number, twinChoice: TwinChoice = referenceTwin) {
  const bytes = 8 * Math.max(1, layout.logitCount)
  const logits = new Float64Array(new SharedArrayBuffer(bytes), 0, layout.logitCount)
  const gradient = new Float64Array(layout.logitCount)
  // The twin of this thread: it runs the batches when there is no worker, and it is the twin of a log point.
  const localTwin = await loadTwin(twinChoice, layout)
  const workers = Array.from({length: workerCount}, () => {
    const gradientBuffer = new SharedArrayBuffer(bytes)
    const setup: WorkerSetup = {layout, twin: twinChoice, samples: messageOf(samples), logitsBuffer: logits.buffer, gradientBuffer}
    return {thread: new Worker(new URL('./train-worker.ts', import.meta.url), {workerData: setup}), gradient: new Float64Array(gradientBuffer, 0, layout.logitCount)}
  })
  const answerOf = (thread: Worker): Promise<WorkerAnswer> => new Promise<WorkerAnswer>((resolveAnswer, reject) => {
    thread.once('message', resolveAnswer)
    thread.once('error', reject)
  }).finally(() => thread.removeAllListeners('error'))
  const close = async () => {
    await Promise.all(workers.map(worker => worker.thread.terminate()))
  }
  try {
    await Promise.all(workers.map(worker => answerOf(worker.thread)))
  } catch (error) {
    await close()
    throw error
  }

  // The losses of the samples at `places`, and with `withGradient` their gradient by the logits in `gradient`. The
  // samples are split over the workers in order, and the parts are added up in the workers' order, so the result
  // does not depend on which worker finishes first.
  async function run(places: Int32Array, withGradient: boolean): Promise<LossTally> {
    const tally = createTally()
    if (withGradient) gradient.fill(0)
    if (workers.length === 0) {
      localTwin.run(logits, samples, places, tally, withGradient ? gradient : null)
      return tally
    }
    const answers = await Promise.all(workers.map((worker, index) => {
      const answer = answerOf(worker.thread)
      const task: WorkerTask = {places: places.slice(Math.floor(places.length * index / workers.length), Math.floor(places.length * (index + 1) / workers.length)), withGradient}
      worker.thread.postMessage(task)
      return answer
    }))
    for (let index = 0; index < workers.length; index++) {
      const answer = answers[index]!
      if (answer === 'ready') throw new Error('a worker thread said that it is ready in place of an answer')
      addTally(tally, answer)
      if (!withGradient) continue
      const part = workers[index]!.gradient
      for (let logit = 0; logit < part.length; logit++) gradient[logit]! += part[logit]!
    }
    return tally
  }
  return {logits, gradient, localTwin, run, close}
}

export type TrainOptions = {
  // The samples to train on, as places in the packed samples, e.g. the first 400. Without it, every sample.
  places?: Int32Array
  // The seed of the order of the samples. The default is 1.
  seed?: number
  // How many times training goes over the samples. The default is 1.
  epochs?: number
  // Samples per step of Adam. The default is 32.
  batchSize?: number
  // The default is 0.05.
  learningRate?: number
  // Worker threads, at most 4, or 0 to run in this thread. The default is 4.
  workers?: number
  // The twin. The default is the reference, the weighted set of exact stacks of stacks-twin.ts.
  twin?: TwinChoice
  // A log line after every so many samples, and before the first and after the last one. The default is 2000.
  logEverySamples?: number
  // Validation samples that score the snapped tables at a log point, for the log only: the trainer chooses nothing
  // by them. They have to be packed for the model's base tables.
  validation?: PackedSamples
  log?: (line: string) => void
}

export type TrainPoint = {
  samples: number
  // The loss per scored code point over the samples since the point before, and its three parts. NaN at the first
  // point, before any sample.
  loss: number
  kindLoss: number
  depthLoss: number
  containerLoss: number
  // The share of the labels since the point before whose share in the twin is exactly 0.
  labelsWithoutShare: number
  // What the twin counted since the point before.
  counters: Record<string, number>
  // The share of the scored code points of the first 100 trained samples at which the twin's largest shares are
  // what the snapped tables give, and the mean of the largest share of a mix.
  readsAsSnapped: number
  meanLargestShare: number
  // Percentages of the snapped tables on the validation samples, see sharesOf of ../score.ts. NaN without them.
  allThree: number
  whole: number
  stack: number
  // The cells and the display entries in which the snapped tables differ from the base tables.
  changedCells: number
  changedEntries: number
}

export type TrainResult = {
  // The snapped tables after the last sample.
  last: RecoveryTables
  points: TrainPoint[]
  // Of training alone, without the log points: the samples per second, and the seconds of every pass.
  samplesPerSecond: number
  secondsPerPass: number[]
}

// How many samples the comparison of a log point uses: the first so many of the trained ones.
const fixedSampleCount = 100

// Trains the model's logits in place on every sample of `samples`, or on the samples at `options.places`.
// Throws for a model without a trainable cell or entry, for samples that were packed for other added terminals
// than the model's base has, for a place outside the samples, and for samples without a scored code point.
export async function train(model: Model, samples: PackedSamples, options: TrainOptions = {}): Promise<TrainResult> {
  const {layout} = model
  if (layout.logitCount === 0) throw new Error('train got a model without a trainable cell or entry: there is nothing to train')
  refuseOtherTerminals(samples, layout.base)
  if (options.validation !== undefined) refuseOtherTerminals(options.validation, layout.base)
  const places = options.places ?? Int32Array.from({length: samples.sampleCount}, (_, place) => place)
  let scoredCodePoints = 0
  for (const place of places) {
    if (!Number.isInteger(place) || place < 0 || place >= samples.sampleCount) throw new Error(`train got the place ${place}, and the samples have the places 0 to ${samples.sampleCount - 1}`)
    scoredCodePoints += samples.scored[place]!
  }
  if (scoredCodePoints === 0) throw new Error(`train got ${places.length} samples without a scored code point, so there is nothing to train on`)
  const seed = options.seed ?? 1
  const epochs = options.epochs ?? 1
  const batchSize = options.batchSize ?? 32
  const learningRate = options.learningRate ?? 0.05
  const workerCount = options.workers ?? 4
  if (!Number.isInteger(workerCount) || workerCount < 0 || workerCount > 4) throw new Error(`train takes 0 to 4 workers, and got ${workerCount}`)
  const logEverySamples = options.logEverySamples ?? 2000
  const log = options.log ?? (line => console.log(line))
  const batches = await createBatchRunner(layout, samples, workerCount, options.twin)
  // The worker threads are closed whether the run ends or throws: a thread that is left alive keeps the process
  // from ending.
  const run = async (): Promise<TrainResult> => {
    const firstMoment = new Float64Array(layout.logitCount)
    const secondMoment = new Float64Array(layout.logitCount)
    const firstDecay = 0.9
    const secondDecay = 0.999
    const totalSamples = epochs * places.length
    const points: TrainPoint[] = []
    const secondsPerPass: number[] = []
    let last = snappedTables(model)
    let samplesSeen = 0
    let step = 0
    let trainingMilliseconds = 0
    let sinceLog = createTally()
    let samplesAtLastLog = 0

    // The comparison of a log point, in this thread: the twin with the logits as they are, and the twin with the
    // snapped choices, which is the exact parser of the snapped tables.
    const fixedPlaces = places.subarray(0, Math.min(places.length, fixedSampleCount))
    const softReading = createReading(), snappedReading = createReading()
    const shares = new Float64Array(layout.logitCount)
    const largestOf = (values: Float64Array, from: number, count: number): number => {
      let largest = 0
      for (let entry = 1; entry < count; entry++) if (values[from + entry]! > values[from + largest]!) largest = entry
      return largest
    }
    const readsAsSnapped = (snapped: RecoveryTables): number => {
      const snappedLogits = logitsOfTables(layout, snapped)
      const unused = createTally()
      let compared = 0, same = 0
      for (const place of fixedPlaces) {
        batches.localTwin.run(model.logits, samples, [place], unused, null, softReading)
        batches.localTwin.run(snappedLogits, samples, [place], unused, null, snappedReading)
        const firstToken = samples.tokenStart[place]!
        for (let row = 0; row < softReading.tokenCount; row++) {
          let codePoints = 0
          for (let group = samples.groupStart[firstToken + row]!; group < samples.groupStart[firstToken + row + 1]!; group++) codePoints += samples.groupCount[group]!
          compared += codePoints
          if (largestOf(softReading.kind, row * displayKindCount, displayKindCount) === largestOf(snappedReading.kind, row * displayKindCount, displayKindCount)
            && largestOf(softReading.depth, row * readingDepthCount, readingDepthCount) === largestOf(snappedReading.depth, row * readingDepthCount, readingDepthCount)
            && largestOf(softReading.container, row * containerCount, containerCount) === largestOf(snappedReading.container, row * containerCount, containerCount)) same += codePoints
        }
      }
      return compared === 0 ? NaN : same / compared
    }

    const logPoint = () => {
      const snapped = snappedTables(model)
      last = snapped
      const differences = differencesOf(layout.base, snapped)
      const perCodePoint = (total: number): number => sinceLog.codePoints === 0 ? NaN : total / sinceLog.codePoints
      sharesInto(layout, model.logits, shares)
      const point: TrainPoint = {
        samples: samplesSeen, loss: perCodePoint(sinceLog.loss), kindLoss: perCodePoint(sinceLog.kindLoss), depthLoss: perCodePoint(sinceLog.depthLoss), containerLoss: perCodePoint(sinceLog.containerLoss),
        labelsWithoutShare: perCodePoint(sinceLog.labelsWithoutShare) / 3, counters: sinceLog.counters, readsAsSnapped: readsAsSnapped(snapped), meanLargestShare: meanLargestShare(layout, shares),
        allThree: NaN, whole: NaN, stack: NaN,
        changedCells: differences.filter(difference => difference.table === 'cells').length, changedEntries: differences.filter(difference => difference.table === 'display').length,
      }
      if (options.validation !== undefined) {
        const validationShares = sharesOf(scoreTables(snapped, options.validation).score)
        point.allThree = validationShares.allThree
        point.whole = validationShares.whole
        point.stack = validationShares.stack
      }
      points.push(point)
      const number = (value: number, digits: number): string => Number.isNaN(value) ? '-' : value.toFixed(digits)
      const tokens = point.counters['tokens']
      const counted = Object.entries(point.counters).map(([name, count]) => `${name} ${Math.round(count)}${tokens === undefined || tokens === 0 || name === 'tokens' ? '' : ` (${(count / tokens).toFixed(3)} per token)`}`).join(', ')
      log(`${String(samplesSeen).padStart(7)} samples  loss ${number(point.loss, 4)} (kind ${number(point.kindLoss, 3)} depth ${number(point.depthLoss, 3)} container ${number(point.containerLoss, 3)})`
        + `  labels without a share ${number(100 * point.labelsWithoutShare, 1)}%  reads as the snapped tables at ${number(100 * point.readsAsSnapped, 1)}%  largest share ${point.meanLargestShare.toFixed(3)}`
        + `  the twin: ${counted === '' ? '-' : counted}`
        + `  snapped on validation: all three ${number(point.allThree, 2)} whole ${number(point.whole, 2)} stack ${number(point.stack, 2)}`
        + `  ${point.changedCells} cells and ${point.changedEntries} display entries changed against the base  ${trainingMilliseconds === 0 ? '-' : (samplesSeen / (trainingMilliseconds / 1000)).toFixed(0)} samples/s`)
      sinceLog = createTally()
      samplesAtLastLog = samplesSeen
    }

    logPoint()
    for (let epoch = 0; epoch < epochs; epoch++) {
      const order = Int32Array.from(createRandom(seed, epoch).shuffled(Array.from(places)))
      const millisecondsBeforePass = trainingMilliseconds
      for (let from = 0; from < order.length; from += batchSize) {
        const started = performance.now()
        const batch = order.subarray(from, Math.min(order.length, from + batchSize))
        batches.logits.set(model.logits)
        step++
        const tally = await batches.run(batch, true)
        const scale = tally.codePoints === 0 ? 1 : 1 / tally.codePoints
        const firstCorrection = 1 - firstDecay ** step
        const secondCorrection = 1 - secondDecay ** step
        for (let logit = 0; logit < layout.logitCount; logit++) {
          const gradient = scale * batches.gradient[logit]!
          firstMoment[logit] = firstDecay * firstMoment[logit]! + (1 - firstDecay) * gradient
          secondMoment[logit] = secondDecay * secondMoment[logit]! + (1 - secondDecay) * gradient * gradient
          model.logits[logit]! -= learningRate * (firstMoment[logit]! / firstCorrection) / (Math.sqrt(secondMoment[logit]! / secondCorrection) + 1e-8)
        }
        addTally(sinceLog, tally)
        samplesSeen += batch.length
        trainingMilliseconds += performance.now() - started
        if (samplesSeen - samplesAtLastLog >= logEverySamples || samplesSeen === totalSamples) logPoint()
      }
      secondsPerPass.push((trainingMilliseconds - millisecondsBeforePass) / 1000)
    }
    return {last, points, samplesPerSecond: samplesSeen / (trainingMilliseconds / 1000), secondsPerPass}
  }
  try {
    return await run()
  } finally {
    await batches.close()
  }
}

if (import.meta.main) {
  refuseUnknownOptions('soft/train.ts', ['--name', '--train', '--validation', '--epochs', '--batch', '--learning-rate', '--seed', '--workers', '--start', '--start-share', '--twin', '--width', '--log-every'], ['--flag', '--without-end-early'])
  const name = optionOf('--name') ?? 'run'
  const folder = learnFolder('soft', 'runs', name)
  const logFile = join(folder, 'log.txt')
  writeFileSync(logFile, '')
  const log = (line: string) => {
    console.log(line)
    appendFileSync(logFile, `${line}\n`)
  }
  const start = optionOf('--start') ?? 'base'
  if (start !== 'base' && start !== 'uniform') throw new Error(`--start is base or uniform, and got ${start}`)
  let base = baseTables()
  if (flagOf('--without-end-early')) base = withoutEndEarly(base)
  if (flagOf('--flag')) base = addFirstOnLineFlag(base)
  const twinOption = optionOf('--twin')
  const width = optionOf('--width')
  const twin: TwinChoice = {module: twinOption === undefined ? referenceTwin.module : resolve(twinOption), ...(width === undefined ? {} : {options: {width: Number(width)}})}
  const trainSamples = loadPacked('train', numberOf('--train', standardTrainCount), base)
  const validation = loadPacked('validation', numberOf('--validation', standardValidationCount), base)
  const model = createModel(base, {start, startShare: Number(optionOf('--start-share') ?? 0.9)})
  log(`bun ${process.argv.slice(1).join(' ')}`)
  log(`${trainSamples.sampleCount} train samples with ${trainSamples.scoredCodePoints} scored code points, ${validation.sampleCount} validation samples. ${model.layout.mixOwner.length} trainable cells and entries with ${model.layout.logitCount} logits. The twin: ${(await loadTwin(twin, model.layout)).name}. Tables and log in ${folder}`)
  const result = await train(model, trainSamples, {
    seed: numberOf('--seed', 1), epochs: numberOf('--epochs', 1), batchSize: numberOf('--batch', 32), learningRate: Number(optionOf('--learning-rate') ?? 0.05), workers: numberOf('--workers', 4), twin,
    logEverySamples: numberOf('--log-every', 2000), validation, log,
  })
  saveTables(join(folder, 'last.json'), result.last, `soft twin, run ${name}, after the last sample`)
  log(`${result.samplesPerSecond.toFixed(0)} samples per second of training, ${result.secondsPerPass.map(seconds => `${seconds.toFixed(1)} s`).join(', ')} per pass.`)
  log(scoreRow('the parser as it is, on validation', scoreTables(base, validation).score))
  log(scoreRow('the last snapped tables, on validation', scoreTables(result.last, validation).score))
}
