// Checks the twin's hand-written backward pass against finite differences, on random mixes.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/soft/check-gradient.ts [samples, default 24] [single weights per group and setting, default 60]
//
// Every open cell is trainable and its weights are random, so every mix is a random mix. For each setting of the
// options below, the backward pass gives the gradient of the objective by every weight. The check compares it with
// central differences of the fourth order, (-f(2h) + 8 f(h) - 8 f(-h) + f(-2h)) / 12h, in two ways per group of weights:
//
// - Along random directions: every trainable weight of the group moves by +h or -h at once, and the difference is
//   compared with the sum of the gradients times their signs. One direction covers every weight of the group. The
//   relative difference is the difference of the two divided by the length of the group's gradient, i.e. the root of
//   the sum of its squares, which is the size that a sum with random signs has.
// - For single weights: the ones with the largest gradients, random ones among those with a gradient that is not 0,
//   and random ones among all, which mostly have a gradient of 0 because no sample reads their cell.
//
// The objective holds terms -ln(share + 1e-6). Where a share is close to 0, a rounding error of 1e-16 in the share is
// an error of 1e-10 in the term, so a difference of the objective is only good to about 1e-12 / h. Along a direction
// the gradients add up to much more than that. A single small gradient does not, so for single weights the check
// reports the relative difference of the gradients of at least 1e-4, and the absolute difference of all.
import {createRandom} from '../../random.ts'
import {defaultSeed} from '../../samples.ts'
import {loadStandardSamples, splitNames} from '../data.ts'
import {asIsTables} from '../recovery-tables.ts'
import {loadIntendedObjects, packForTwin, placesForTwin, softCacheFolderOf} from './twin-data.ts'
import {type ObjectiveOptions, type TwinRunner, createCellArrays, createModel, createTwinRunner, groupNames, objective} from './twin.ts'

const sampleCount = Number(process.argv[2] ?? 24)
const weightsPerGroup = Number(process.argv[3] ?? 60)
const directionsPerGroup = 6
const directionStep = 1e-4
const singleStep = 1e-2
const relativeTolerance = 1e-5
const absoluteTolerance = 1e-9
const largeGradient = 1e-4
let failures = 0
const fail = (message: string) => {
  failures++
  if (failures <= 20) console.log(`FAILED: ${message}`)
}

const samples = loadStandardSamples()
// Train samples with at most 120 code points, so that many weights matter to the objective, and two long ones.
const trainPlaces = placesForTwin(samples, splitNames.indexOf('train'))
const lengthOf = (place: number) => samples.start[place + 1]! - samples.start[place]!
const short = Array.from(trainPlaces).filter(place => lengthOf(place) <= 120).slice(0, sampleCount - 2)
const long = Array.from(trainPlaces).filter(place => lengthOf(place) >= 400).slice(0, 2)
const data = packForTwin(samples, [...short, ...long], loadIntendedObjects(samples, softCacheFolderOf()))
const everyPlace = Int32Array.from({length: data.sampleCount}, (_, place) => place)

const model = createModel(asIsTables(), {start: 'uniform'})
const shape = model.shape
const mixes = createCellArrays(shape)
const mixGradients = createCellArrays(shape)
const weightGradients = createCellArrays(shape)

type Setting = {name: string, options: ObjectiveOptions, depthLow: number, depthHigh: number, weightScale: number}
const settings: Setting[] = [
  {name: 'the three label losses alone', options: {}, depthLow: -8, depthHigh: 24, weightScale: 1.5},
  {name: 'every option on: intended targets, on track with probability 0.3, temperature 0.7, sharpness cost 0.05', depthLow: -8, depthHigh: 24, weightScale: 1.5,
    options: {intendedLexerWeight: 0.3, intendedEventWeight: 0.2, intendedGrammarWeight: 0.4, onTrackProbability: 0.3, onTrackSeed: 7, temperature: 0.7, sharpnessCost: 0.05}},
  {name: 'a narrow depth range, -1 to 17, so that shares reach its ends, temperature 2, other weights of the three losses', depthLow: -1, depthHigh: 17, weightScale: 1.5,
    options: {kindWeight: 0.5, depthWeight: 2, containerWeight: 1.5, temperature: 2}},
  {name: 'sharp mixes (weights 4 times as large), on track with probability 0.5, sharpness cost 0.2, an intended target', depthLow: -8, depthHigh: 24, weightScale: 6,
    options: {onTrackProbability: 0.5, onTrackSeed: 11, sharpnessCost: 0.2, intendedGrammarWeight: 0.5}},
  {name: 'the intended states at every kept code point, not only where a parser can follow them: intended targets, on track with probability 0.4', depthLow: -8, depthHigh: 24, weightScale: 1.5,
    options: {intendedLexerWeight: 0.3, intendedEventWeight: 0.2, intendedGrammarWeight: 0.4, onTrackProbability: 0.4, onTrackSeed: 13, intendedEverywhere: true}},
]

// A normal random number from two uniform ones.
const normal = (random: {next: () => number}) => Math.sqrt(-2 * Math.log(1 - random.next())) * Math.cos(2 * Math.PI * random.next())

type Worst = {direction: number, directions: number, relative: number, large: number, absolute: number, singles: number}
const worst: Record<string, Worst> = {}
for (const name of groupNames) worst[name] = {direction: 0, directions: 0, relative: 0, large: 0, absolute: 0, singles: 0}

const started = performance.now()
for (let settingIndex = 0; settingIndex < settings.length; settingIndex++) {
  const setting = settings[settingIndex]!
  const random = createRandom(defaultSeed + 77, settingIndex)
  for (let entry = 0; entry < model.weights.all.length; entry++) model.weights.all[entry] = setting.weightScale * normal(random)
  const runner: TwinRunner = createTwinRunner(shape, setting.depthLow, setting.depthHigh)
  const result = objective(model, runner, data, everyPlace, setting.options, mixes, mixGradients, weightGradients)
  const value = () => objective(model, runner, data, everyPlace, setting.options, mixes).value
  console.log(`Setting ${settingIndex + 1}: ${setting.name}.`)
  console.log(`  ${data.sampleCount} samples, ${result.tally.positions} steps, ${result.tally.codePoints} labeled code points, ${result.tally.replaced} states replaced, objective ${result.value.toFixed(6)}`)
  for (const group of groupNames) {
    const gradient = weightGradients[group].slice()
    const weights = model.weights[group]
    const trainable = group === 'lexerNext' || group === 'lexerEvent' ? model.trainableLexer : model.trainableGrammar
    const width = gradient.length / trainable.length
    const notZero: number[] = []
    const all: number[] = []
    let largestGradient = 0
    let sumOfSquares = 0
    for (let entry = 0; entry < gradient.length; entry++) {
      if (trainable[Math.floor(entry / width)] === 0) continue
      all.push(entry)
      if (gradient[entry] !== 0) notZero.push(entry)
      largestGradient = Math.max(largestGradient, Math.abs(gradient[entry]!))
      sumOfSquares += gradient[entry]! * gradient[entry]!
    }
    const gradientLength = Math.sqrt(sumOfSquares)
    const tally = worst[group]!

    // Along random directions.
    const kept = weights.slice()
    let groupDirection = 0
    for (let direction = 0; direction < directionsPerGroup; direction++) {
      const signs = Int8Array.from(all, () => random.chance(0.5) ? 1 : -1)
      let expected = 0
      for (let at = 0; at < all.length; at++) expected += signs[at]! * gradient[all[at]!]!
      const valueAt = (offset: number) => {
        for (let at = 0; at < all.length; at++) weights[all[at]!] = kept[all[at]!]! + offset * signs[at]!
        return value()
      }
      const numeric = (-valueAt(2 * directionStep) + 8 * valueAt(directionStep) - 8 * valueAt(-directionStep) + valueAt(-2 * directionStep)) / (12 * directionStep)
      weights.set(kept)
      const relative = Math.abs(numeric - expected) / gradientLength
      groupDirection = Math.max(groupDirection, relative)
      if (!(relative <= relativeTolerance)) fail(`${group}, a direction: the backward pass gives ${expected}, and the central difference ${numeric}`)
    }
    tally.direction = Math.max(tally.direction, groupDirection)
    tally.directions += directionsPerGroup

    // Single weights.
    const third = Math.ceil(weightsPerGroup / 3)
    const largest = [...notZero].sort((left, right) => Math.abs(gradient[right]!) - Math.abs(gradient[left]!)).slice(0, third)
    const chosen = new Set<number>([...largest, ...random.shuffled(notZero).slice(0, third), ...random.shuffled(all).slice(0, third)])
    let groupRelative = 0
    let groupAbsolute = 0
    let large = 0
    for (const entry of chosen) {
      const keptWeight = weights[entry]!
      const valueAt = (offset: number) => {
        weights[entry] = keptWeight + offset
        return value()
      }
      const numeric = (-valueAt(2 * singleStep) + 8 * valueAt(singleStep) - 8 * valueAt(-singleStep) + valueAt(-2 * singleStep)) / (12 * singleStep)
      weights[entry] = keptWeight
      const absolute = Math.abs(numeric - gradient[entry]!)
      groupAbsolute = Math.max(groupAbsolute, absolute)
      const isLarge = Math.abs(gradient[entry]!) >= largeGradient
      if (isLarge) {
        large++
        groupRelative = Math.max(groupRelative, absolute / Math.max(Math.abs(numeric), Math.abs(gradient[entry]!)))
      }
      if (!(absolute <= absoluteTolerance + relativeTolerance * Math.abs(gradient[entry]!))) fail(`${group} weight ${entry}: the backward pass gives ${gradient[entry]}, and the central difference ${numeric}`)
    }
    tally.relative = Math.max(tally.relative, groupRelative)
    tally.absolute = Math.max(tally.absolute, groupAbsolute)
    tally.large += large
    tally.singles += chosen.size
    console.log(`  ${group.padEnd(13)} ${String(notZero.length).padStart(5)} of ${String(all.length).padStart(5)} weights have a gradient, the largest ${largestGradient.toExponential(2)}. `
      + `${directionsPerGroup} directions: relative difference at most ${groupDirection.toExponential(2)}. ${chosen.size} single weights: absolute at most ${groupAbsolute.toExponential(2)}, relative at most ${groupRelative.toExponential(2)} over the ${large} of at least ${largeGradient}`)
  }
}

console.log('The largest differences per group of weights, over every setting:')
for (const group of groupNames) {
  const tally = worst[group]!
  console.log(`  ${group.padEnd(13)} ${tally.directions} directions: relative ${tally.direction.toExponential(2)}. ${tally.singles} single weights: absolute ${tally.absolute.toExponential(2)}, relative ${tally.relative.toExponential(2)} over the ${tally.large} with a gradient of at least ${largeGradient}`)
}
console.log(`${((performance.now() - started) / 1000).toFixed(1)} s.`)
if (failures > 0) {
  console.log(`${failures} comparisons FAILED: a direction with a relative difference above ${relativeTolerance}, or a single weight with a difference above ${absoluteTolerance} + ${relativeTolerance} of the gradient.`)
  process.exit(1)
}
console.log(`Every direction has a relative difference of at most ${relativeTolerance}, and every single weight a difference of at most ${absoluteTolerance} + ${relativeTolerance} of the gradient.`)
