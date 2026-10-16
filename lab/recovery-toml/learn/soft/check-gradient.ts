// Checks the twin's hand-written backward pass against finite differences, on random mixes. It is
// lab/recovery-parser/learn/soft/check-gradient.ts for TOML, on samples of ../check-set.ts.
//
// Run from the repo root:
//   bun lab/recovery-toml/learn/soft/check-gradient.ts [samples, default 8] [single weights per group and setting, default 24]
//
// The defaults are a third of the JSON check's: with random mixes a step of the TOML twin reads every cell of a
// class's column, 111 tokenizer cells and up to 5,888 grammar cells, and an evaluation also makes the mixes of about
// a million weights.
//
// Every open cell is trainable and its weights are random, so every mix is a random mix. For each setting of the
// options below, the backward pass gives the gradient of the objective by every weight. The last setting weighs the
// samples and the first code points after a first error otherwise than by default, see LossOptions.sampleWeightPower,
// and a part after the settings checks what those weights mean. The three settings before it run tables
// with added structure: with added classes, two added tokenizer states, an added
// grammar state, open entries of the display table, whose mixes are a fifth group of weights, and the bit "first on
// its line", on samples of which half hold a code point of an added class. The settings with intended states use
// them at every kept code point, since the TOML samples have no mark of the ones that a parser can be in. The check
// compares the gradient with
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
import {checkSamples} from '../check-set.ts'
import {classesOfTheChecks} from '../check-texts.ts'
import {refuseUnknownOptions} from '../options.ts'
import {createRandom} from '../random.ts'
import {type RecoveryTables, addClasses, addFirstOnLineBit, addStates, asIsTables, grammarStateNames, openDisplayEntries} from '../recovery-tables.ts'
import {packForTwin, placesForTwin} from './twin-data.ts'
import {type ObjectiveOptions, type TwinRunner, createCellArrays, createModel, createTwinRunner, groupNames, objective, trainableOf} from './twin.ts'

refuseUnknownOptions('soft/check-gradient.ts', [])
const sampleCount = Number(process.argv[2] ?? 8)
const weightsPerGroup = Number(process.argv[3] ?? 24)
const directionsPerGroup = 3
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

const seedOfTheCheckSet = 20261016
const samples = checkSamples(3000, seedOfTheCheckSet)
// Train samples with at most 60 code points from their first error on, so that many weights matter to the objective
// and an evaluation is short, and one long one.
const trainPlaces = placesForTwin(samples, 'train')
const stepsOf = (place: number) => samples.start[place + 1]! - samples.start[place]! - samples.firstErrorPosition[place]!
const short = Array.from(trainPlaces).filter(place => stepsOf(place) >= 10 && stepsOf(place) <= 60)
const long = Array.from(trainPlaces).filter(place => stepsOf(place) >= 300).slice(0, 1)

// A model of some base tables with every open cell trainable, and the samples packed for those tables.
function setupOf(base: RecoveryTables, places: number[]) {
  const data = packForTwin(samples, places, base)
  const model = createModel(base, {start: 'uniform'})
  return {model, data, everyPlace: Int32Array.from({length: data.sampleCount}, (_, place) => place), mixes: createCellArrays(model.shape), mixGradients: createCellArrays(model.shape), weightGradients: createCellArrays(model.shape)}
}
const todays = setupOf(asIsTables(), [...short.slice(0, sampleCount - 1), ...long])
// With added structure, half of the short samples hold a code point of an added class from their first error on, so
// that the cells of the added classes are read.
const addedCodePoints = new Set(classesOfTheChecks.flatMap(({codePoints}) => codePoints))
const holdsAddedClass = (place: number) => samples.codePoints.subarray(samples.start[place]! + samples.firstErrorPosition[place]!, samples.start[place + 1]).some(codePoint => addedCodePoints.has(codePoint))
const withAddedClass = short.filter(holdsAddedClass).slice(0, Math.floor((sampleCount - 1) / 2))
const added = `${classesOfTheChecks.length} added classes, 2 added tokenizer states, an added grammar state, open entries of the display table and the bit "first on its line"`
const withStructure = setupOf(addFirstOnLineBit(openDisplayEntries(addStates(addClasses(asIsTables(), classesOfTheChecks), 2, [grammarStateNames.indexOf('afterKey')]))), [...withAddedClass, ...short.filter(place => !holdsAddedClass(place)).slice(0, sampleCount - 1 - withAddedClass.length), ...long])

type Setting = {name: string, setup: ReturnType<typeof setupOf>, added: boolean, options: ObjectiveOptions, depthLow: number, depthHigh: number, weightScale: number}
const everyOption: ObjectiveOptions = {intendedLexerWeight: 0.3, intendedEventWeight: 0.2, intendedGrammarWeight: 0.4, onTrackProbability: 0.3, onTrackSeed: 7, intendedEverywhere: true, temperature: 0.7, sharpnessCost: 0.05}
const settings: Setting[] = [
  {name: 'the three label losses alone', setup: todays, added: false, options: {}, depthLow: -8, depthHigh: 24, weightScale: 1.5},
  {name: 'every option on: intended targets, on track with probability 0.3, temperature 0.7, sharpness cost 0.05', setup: todays, added: false, depthLow: -8, depthHigh: 24, weightScale: 1.5, options: everyOption},
  {name: 'a narrow depth range, -1 to 17, so that shares reach its ends, temperature 2, other weights of the three losses', setup: todays, added: false, depthLow: -1, depthHigh: 17, weightScale: 1.5,
    options: {kindWeight: 0.5, depthWeight: 2, containerWeight: 1.5, temperature: 2}},
  {name: 'sharp mixes (weights 4 times as large), on track with probability 0.5, sharpness cost 0.2, an intended target', setup: todays, added: false, depthLow: -8, depthHigh: 24, weightScale: 6,
    options: {onTrackProbability: 0.5, onTrackSeed: 11, intendedEverywhere: true, sharpnessCost: 0.2, intendedGrammarWeight: 0.5}},
  {name: `${added}: the three label losses alone`, setup: withStructure, added: true, options: {}, depthLow: -8, depthHigh: 24, weightScale: 1.5},
  {name: `${added}: every option on`, setup: withStructure, added: true, depthLow: -8, depthHigh: 24, weightScale: 1.5, options: everyOption},
  {name: `${added}: sharp mixes, on track with probability 0.5, a narrow depth range`, setup: withStructure, added: true, depthLow: -1, depthHigh: 17, weightScale: 6, options: {onTrackProbability: 0.5, onTrackSeed: 11, intendedEverywhere: true, sharpnessCost: 0.2}},
  // The last setting is with today's tables again, so that the settings before it keep their random weights.
  {name: 'a weight per sample and more weight after the first error: every loss of a sample divided by the root of its scored code points, the first 5 scored code points weigh 3 times, intended targets', setup: todays, added: false,
    depthLow: -8, depthHigh: 24, weightScale: 1.5, options: {sampleWeightPower: 0.5, firstCodePoints: 5, firstCodePointsWeight: 3, intendedLexerWeight: 0.3, intendedGrammarWeight: 0.4, intendedEverywhere: true}},
]

// A normal random number from two uniform ones.
const normal = (random: {next: () => number}) => Math.sqrt(-2 * Math.log(1 - random.next())) * Math.cos(2 * Math.PI * random.next())

// The largest differences per group of weights, over the settings with today's tables and over the ones with added
// structure.
type Worst = {direction: number, directions: number, relative: number, large: number, absolute: number, singles: number}
const newWorst = () => Object.fromEntries(groupNames.map(name => [name, {direction: 0, directions: 0, relative: 0, large: 0, absolute: 0, singles: 0}])) as Record<string, Worst>
const worstOfTodays = newWorst()
const worstOfAdded = newWorst()

const started = performance.now()
for (let settingIndex = 0; settingIndex < settings.length; settingIndex++) {
  const setting = settings[settingIndex]!
  const {model, data, everyPlace, mixes, mixGradients, weightGradients} = setting.setup
  const shape = model.shape
  const worst = setting.added ? worstOfAdded : worstOfTodays
  const random = createRandom(seedOfTheCheckSet + 77, settingIndex)
  // The weights of the display table's entries come from random numbers of their own, so that the other weights of
  // a setting are the same with and without open entries.
  const displayRandom = createRandom(seedOfTheCheckSet + 78, settingIndex)
  for (const group of groupNames) {
    const weights = model.weights[group]
    for (let entry = 0; entry < weights.length; entry++) weights[entry] = setting.weightScale * normal(group === 'display' ? displayRandom : random)
  }
  const runner: TwinRunner = createTwinRunner(shape, setting.depthLow, setting.depthHigh)
  const result = objective(model, runner, data, everyPlace, setting.options, mixes, mixGradients, weightGradients)
  const value = () => objective(model, runner, data, everyPlace, setting.options, mixes).value
  console.log(`Setting ${settingIndex + 1}: ${setting.name}.`)
  console.log(`  ${data.sampleCount} samples, ${result.tally.positions} steps, ${result.tally.codePoints} scored code points, ${result.tally.replaced} states replaced, objective ${result.value.toFixed(6)}`)
  for (const group of groupNames) {
    const gradient = weightGradients[group].slice()
    const weights = model.weights[group]
    const trainable = trainableOf(model, group)
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
    // Today's tables have no open entry of the display table, so that group has no weight to check.
    if (all.length === 0) continue
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

// What the weights of the loss mean, see LossOptions in twin.ts, on the samples of today's tables with the weights
// that the last setting left:
// - by default a scored code point weighs 1, so the weight of the samples is the number of their scored code points,
// - with sampleWeightPower 1 every sample weighs the same: the objective is the mean over the samples of each
//   sample's own loss per code point, and the weight is the number of samples,
// - with firstCodePoints 5 and firstCodePointsWeight 3 the weight is the scored code points plus 2 for each of the
//   first 5 of every sample.
{
  const {model, data, everyPlace, mixes} = todays
  const runner = createTwinRunner(model.shape)
  const alone = Array.from(everyPlace, place => objective(model, runner, data, [place], {}, mixes))
  const meanOfTheSamples = alone.reduce((total, result) => total + result.value, 0) / alone.length
  const together = objective(model, runner, data, everyPlace, {}, mixes)
  if (together.tally.weight !== together.tally.codePoints) fail(`by default the weight of the samples is ${together.tally.weight}, and they have ${together.tally.codePoints} scored code points`)
  const sameWeight = objective(model, runner, data, everyPlace, {sampleWeightPower: 1}, mixes)
  if (!(Math.abs(sameWeight.value - meanOfTheSamples) <= 1e-9 * meanOfTheSamples)) fail(`with every sample weighing the same the objective is ${sameWeight.value}, and the mean of the samples' own losses per code point is ${meanOfTheSamples}`)
  if (!(Math.abs(sameWeight.tally.weight - alone.length) <= 1e-9)) fail(`with every sample weighing the same the weight is ${sameWeight.tally.weight}, and there are ${alone.length} samples`)
  const firstWeighMore = objective(model, runner, data, everyPlace, {firstCodePoints: 5, firstCodePointsWeight: 3}, mixes)
  const expectedWeight = alone.reduce((total, result) => total + result.tally.codePoints + 2 * Math.min(5, result.tally.codePoints), 0)
  if (firstWeighMore.tally.weight !== expectedWeight) fail(`with the first 5 scored code points weighing 3 times the weight is ${firstWeighMore.tally.weight}, and it should be ${expectedWeight}`)
  console.log(`The weights of the loss on ${alone.length} samples with ${together.tally.codePoints} scored code points: with every sample weighing the same the objective is ${sameWeight.value.toFixed(6)}, the mean of the samples' own losses per code point, where the loss per code point of all of them is ${together.value.toFixed(6)}. With the first 5 scored code points weighing 3 times the weight is ${firstWeighMore.tally.weight}.`)
}

for (const [name, worst] of [['today\'s tables', worstOfTodays], ['added structure', worstOfAdded]] as const) {
  console.log(`The largest differences per group of weights, over every setting with ${name}:`)
  for (const group of groupNames) {
    const tally = worst[group]!
    if (tally.directions === 0) continue
    console.log(`  ${group.padEnd(13)} ${tally.directions} directions: relative ${tally.direction.toExponential(2)}. ${tally.singles} single weights: absolute ${tally.absolute.toExponential(2)}, relative ${tally.relative.toExponential(2)} over the ${tally.large} with a gradient of at least ${largeGradient}`)
  }
}
console.log(`${((performance.now() - started) / 1000).toFixed(1)} s.`)
// The last line says whether the check passed, as in every check of learn/.
if (failures > 0) {
  console.log(`A failure is a direction with a relative difference above ${relativeTolerance}, or a single weight with a difference above ${absoluteTolerance} + ${relativeTolerance} of the gradient.`)
  console.log(`${failures} checks FAILED.`)
  process.exitCode = 1
} else {
  console.log(`Every direction has a relative difference of at most ${relativeTolerance}, and every single weight a difference of at most ${absoluteTolerance} + ${relativeTolerance} of the gradient.`)
  console.log('Every check passed.')
}
