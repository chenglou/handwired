// Checks the gradient of the twin of levels against finite differences, with the method of ../soft/check-gradient.ts.
//
// 1. Where the loss is smooth, the two have to agree to many digits. The twin's loss is smooth when a token's live
//    part is never cut off, so the settings of this part give it a `leastLive` of 0, and a `leastShare` of 1e-30,
//    which keeps the levels that only hold such shares from costing time and moves the loss by nothing that a
//    finite difference sees. Every cell that may change and every open display entry is trainable, on random
//    logits, in every layout, in the design's form and in the variant `pusherBelow`, on samples of at most 20
//    tokens from the first error on: without the cut every token takes 16 small steps. The check fails when a
//    kind of choice has no logit with a gradient.
// 2. The same with a `leastShare` of exactly 0, on a few short samples: no level is ever cut off.
// 3. A text with 496 open brackets and logits that favour insertions, so that a part of the mix has a full stack,
//    whose pushes are skips.
// 4. With the settings that train, the loss has jumps where a token's live part crosses `leastLive`, and the
//    gradient is the smooth one between two jumps. This part compares single logits at two steps and fails
//    unless nearly all of them agree at the small step.
//
// The gradient is compared with central differences of the fourth order, (-f(2h) + 8 f(h) - 8 f(-h) + f(-2h)) / 12h:
// along random directions, in which every logit of a group moves by +h or -h at once, and for single logits, the
// ones with the largest gradients and random ones among those with a gradient that is not 0. A direction's
// difference is divided by the length of the group's gradient, and a single logit's by the larger of 1 and its
// gradient.
//
// Run from the repo root: bun lab/recovery-lr/learn/soft-levels/check-gradient.ts [--twin <module that exports createTwin>]
// --twin is for a changed copy of levels-twin.ts, to see that the check can fail.
import {resolve} from 'node:path'
import {defaultSeed, loadSamples} from '../../dataset.ts'
import {createRandom} from '../../random.ts'
import {alignmentOfTexts, makeSample} from '../../sample.ts'
import {type PackedSamples, packSamples} from '../data.ts'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {type RecoveryTables, addFirstOnLineFlag, addTerminals, baseTables, choiceKindNames, choicesOf, kindOfChoice, withoutEndEarly} from '../recovery-tables.ts'
import {type Model, createModel} from '../soft/model.ts'
import {type Twin, type TwinModule, createTally} from '../soft/twin.ts'

refuseUnknownOptions('soft-levels/check-gradient.ts', ['--twin'])
const twinOption = optionOf('--twin')
const {createTwin} = await import(twinOption === undefined ? new URL('./levels-twin.ts', import.meta.url).href : resolve(twinOption)) as TwinModule
const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 30) console.log(`PROBLEM: ${text}`)
}
const directionStep = 1e-4
const singleStep = 1e-3
const tolerance = 1e-6
const samples = loadSamples('train', defaultSeed, 700)
const tokensFromFirstError = (sample: {tokens: {count: number}, firstErrorToken: number}): number => sample.tokens.count - sample.firstErrorToken
const shortSamples = samples.filter(sample => tokensFromFirstError(sample) <= 20)
const picked = [{name: 'ampersand', codePoint: 0x26}, {name: 'colon', codePoint: 0x3a}, {name: 'backslash', codePoint: 0x5c}]
const normal = (random: {next: () => number}) => Math.sqrt(-2 * Math.log(1 - random.next())) * Math.cos(2 * Math.PI * random.next())
const centralDifference = (lossAt: (offset: number) => number, step: number): number => (-lossAt(2 * step) + 8 * lossAt(step) - 8 * lossAt(-step) + lossAt(-2 * step)) / (12 * step)

// The differences between the gradient and finite differences, per group of logits: along random directions, and
// for single logits at each of `singleSteps`.
type Differences = {directions: number[], singles: number[][]}
const groups = ['cells', 'display'] as const
const newDifferences = (singleSteps: readonly number[]): Record<typeof groups[number], Differences> => ({cells: {directions: [], singles: singleSteps.map(() => [])}, display: {directions: [], singles: singleSteps.map(() => [])}})

// Compares the gradient of the summed loss of the samples at `places` with finite differences, and returns the gradient.
function compare(twin: Twin, model: Model, packed: PackedSamples, places: readonly number[], random: ReturnType<typeof createRandom>, singleSteps: readonly number[], differences: Record<typeof groups[number], Differences>, directionsPerGroup: number, singlesPerGroup: number): Float64Array {
  const {layout, logits} = model
  const gradient = new Float64Array(layout.logitCount)
  twin.run(logits, packed, places, createTally(), gradient)
  const loss = (): number => {
    const tally = createTally()
    twin.run(logits, packed, places, tally)
    return tally.loss
  }
  const firstDisplayLogit = layout.mixStart[layout.cellMixCount]!
  for (const group of groups) {
    const from = group === 'cells' ? 0 : firstDisplayLogit, to = group === 'cells' ? firstDisplayLogit : layout.logitCount
    let sumOfSquares = 0
    const notZero: number[] = []
    for (let logit = from; logit < to; logit++) {
      sumOfSquares += gradient[logit]! * gradient[logit]!
      if (gradient[logit] !== 0) notZero.push(logit)
    }
    if (notZero.length === 0) continue
    const gradientLength = Math.sqrt(sumOfSquares)
    const kept = logits.slice(from, to)
    for (let direction = 0; direction < directionsPerGroup; direction++) {
      const signs = Int8Array.from({length: to - from}, () => random.chance(0.5) ? 1 : -1)
      let expected = 0
      for (let logit = from; logit < to; logit++) expected += signs[logit - from]! * gradient[logit]!
      const numeric = centralDifference(offset => {
        for (let logit = from; logit < to; logit++) logits[logit] = kept[logit - from]! + offset * signs[logit - from]!
        return loss()
      }, directionStep)
      logits.set(kept, from)
      differences[group].directions.push(Math.abs(numeric - expected) / gradientLength)
    }
    const byGradient = [...notZero].sort((left, right) => Math.abs(gradient[right]!) - Math.abs(gradient[left]!))
    const singles = new Set(byGradient.slice(0, singlesPerGroup))
    for (let draw = 0; draw < singlesPerGroup; draw++) singles.add(random.pick(notZero))
    for (const logit of singles) {
      const before = logits[logit]!
      singleSteps.forEach((step, index) => {
        const numeric = centralDifference(offset => {
          logits[logit] = before + offset
          return loss()
        }, step)
        differences[group].singles[index]!.push(Math.abs(numeric - gradient[logit]!) / Math.max(1, Math.abs(gradient[logit]!)))
      })
      logits[logit] = before
    }
  }
  return gradient
}
const largest = (values: readonly number[]): number => values.reduce((most, value) => Math.max(most, value), 0)
function layoutOf(setting: number): RecoveryTables {
  let base: RecoveryTables = baseTables()
  if (setting % 4 === 3) base = withoutEndEarly(base)
  if (setting % 3 === 1) base = addTerminals(base, picked)
  if (setting % 2 === 1) base = addFirstOnLineFlag(base)
  return base
}
// A model with every cell that may change and every open display entry trainable, on random logits.
function randomModel(base: RecoveryTables, random: ReturnType<typeof createRandom>): Model {
  const model = createModel(base, {start: 'uniform'})
  for (let logit = 0; logit < model.logits.length; logit++) model.logits[logit] = 1.5 * normal(random)
  return model
}
function report(name: string, differences: Record<typeof groups[number], Differences>) {
  for (const group of groups) {
    const {directions, singles} = differences[group]
    console.log(`   ${group}: ${directions.length} directions, largest difference ${largest(directions).toExponential(1)} of the gradient's length; ${singles[0]!.length} single logits, largest difference ${largest(singles[0]!).toExponential(1)} of the larger of 1 and the gradient`)
    if (directions.length === 0 || singles[0]!.length === 0) problem(`${name}: no logit of the ${group} is compared`)
    if (largest(directions) > tolerance || largest(singles[0]!) > tolerance) problem(`${name}, ${group}: the gradient differs from finite differences by more than ${tolerance}`)
  }
}

const started = performance.now()
let partStarted = started
const secondsOfPart = (): string => {
  const seconds = ((performance.now() - partStarted) / 1000).toFixed(0)
  partStarted = performance.now()
  return `${seconds} s`
}

// 1. Where the loss is smooth.
{
  const differences = newDifferences([singleStep])
  const logitsWithGradient = new Map<string, number>()
  let smallSteps = 0, tokens = 0, levels = 0
  for (let setting = 0; setting < 8; setting++) {
    const base = layoutOf(setting)
    const random = createRandom(191, setting)
    const model = randomModel(base, random)
    const twin = createTwin(model.layout, {leastLive: 0, leastShare: 1e-30, pusherBelow: setting >= 4 ? 1 : 0})
    const packed = packSamples(shortSamples.slice(setting * 6, setting * 6 + 6), base)
    const places = Array.from({length: packed.sampleCount}, (_, place) => place)
    const tally = createTally()
    twin.run(model.logits, packed, places, tally)
    smallSteps += tally.counters['smallSteps'] ?? 0
    tokens += tally.counters['tokens'] ?? 0
    levels += tally.counters['levels'] ?? 0
    const gradient = compare(twin, model, packed, places, random, [singleStep], differences, 3, 6)
    for (let mix = 0; mix < model.layout.cellMixCount; mix++) {
      const list = choicesOf(base, model.layout.mixOwner[mix]!)
      for (let place = 0; place < list.length; place++) {
        if (gradient[model.layout.mixStart[mix]! + place] === 0) continue
        const name = choiceKindNames[kindOfChoice(list[place]!)]!
        logitsWithGradient.set(name, (logitsWithGradient.get(name) ?? 0) + 1)
      }
    }
  }
  for (const kind of ['stop', 'skip', 'pop', 'reduce', 'insert', 'read as', 'end early']) if ((logitsWithGradient.get(kind) ?? 0) === 0) problem(`no logit of a choice "${kind}" has a gradient in the smooth settings`)
  console.log(`1. Where the loss is smooth (leastLive 0, leastShare 1e-30): 8 settings in 4 layouts, 4 in the design's form and 4 in the variant pusherBelow, every cell and every open display entry trainable on random logits, 6 samples of at most 20 tokens each: ${tokens} tokens, ${(smallSteps / tokens).toFixed(1)} small steps per token on ${(levels / smallSteps).toFixed(1)} levels.`)
  console.log(`   Logits of cells with a gradient, by the kind of their choice: ${[...logitsWithGradient].map(([name, count]) => `${name} ${count}`).join(', ')}.`)
  report('the smooth settings', differences)
  console.log(`   ${secondsOfPart()}`)
}

// 2. No level cut off at all.
{
  const differences = newDifferences([singleStep])
  let used = 0
  for (let setting = 0; setting < 2; setting++) {
    const base = layoutOf(setting)
    const random = createRandom(192, setting)
    const model = randomModel(base, random)
    const twin = createTwin(model.layout, {leastLive: 0, leastShare: 0, pusherBelow: setting})
    // Short samples: without a cut, every token adds 16 levels.
    const short = samples.filter(sample => tokensFromFirstError(sample) <= 6).slice(setting * 4, setting * 4 + 4)
    used += short.length
    const packed = packSamples(short, base)
    compare(twin, model, packed, Array.from({length: packed.sampleCount}, (_, place) => place), random, [singleStep], differences, 3, 6)
  }
  console.log(`2. With a leastShare of exactly 0, ${used} samples of at most 6 tokens from the first error on, in the design's form and in the variant:`)
  report('no level cut off', differences)
  console.log(`   ${secondsOfPart()}`)
}

// 3. A full stack.
{
  const differences = newDifferences([singleStep])
  const original = `let x=${'('.repeat(250)}1${')'.repeat(250)}`, broken = `let x=${'('.repeat(496)}in 1)`
  const deep = makeSample({id: 'deep', original, broken, alignment: alignmentOfTexts(original, broken)})
  if (typeof deep === 'string') throw new Error(`the deep text is no sample: ${deep}`)
  const base = baseTables()
  const random = createRandom(193, 0)
  const model = randomModel(base, random)
  // More weight on insertions, so that a good part of the mix reaches 520 states.
  for (let mix = 0; mix < model.layout.cellMixCount; mix++) {
    const list = choicesOf(base, model.layout.mixOwner[mix]!)
    list.forEach((choice, place) => {
      if (choiceKindNames[kindOfChoice(choice)] === 'insert') model.logits[model.layout.mixStart[mix]! + place]! += 5
    })
  }
  const packed = packSamples([deep], base)
  let fullSteps = 0, fullShares = 0
  for (const pusherBelow of [0, 1]) {
    const twin = createTwin(model.layout, {leastLive: 0, leastShare: 1e-30, pusherBelow})
    const tally = createTally()
    twin.run(model.logits, packed, [0], tally)
    fullSteps += tally.counters['stepsWithFullStack'] ?? 0
    fullShares += tally.counters['shareWithFullStack'] ?? 0
    compare(twin, model, packed, [0], random, [singleStep], differences, 2, 4)
  }
  if (fullSteps === 0 || fullShares / fullSteps < 0.005) problem(`the deep text has ${fullSteps} small steps with a full stack, which is ${fullShares / fullSteps} of the live part on average: too little to check the rule`)
  console.log(`3. A text with 496 open brackets, in the design's form and in the variant: ${fullSteps} small steps have a share whose stack is full, ${(fullShares / fullSteps).toFixed(3)} of the live part on average.`)
  report('a full stack', differences)
  console.log(`   ${secondsOfPart()}`)
}

// 4. With the settings that train.
{
  const steps = [1e-3, 1e-5]
  const differences = newDifferences(steps)
  for (let setting = 0; setting < 2; setting++) {
    const base = setting === 0 ? baseTables() : addFirstOnLineFlag(addTerminals(baseTables(), picked))
    const random = createRandom(194, setting)
    const model = createModel(base, {start: 'base'})
    for (let logit = 0; logit < model.logits.length; logit++) model.logits[logit]! += 0.5 * normal(random)
    const twin = createTwin(model.layout, {pusherBelow: setting})
    compare(twin, model, packSamples(samples.slice(0, 12), base), Array.from({length: 12}, (_, place) => place), random, steps, differences, 4, 12)
  }
  const directions = [...differences.cells.directions, ...differences.display.directions]
  console.log(`4. With the settings that train (leastLive 0.001, leastShare 1e-9, every cell and entry trainable, 0.9 on the base's choice with random logits added, 12 samples, 2 layouts, the second in the variant pusherBelow):`)
  steps.forEach((step, index) => {
    const singles = [...differences.cells.singles[index]!, ...differences.display.singles[index]!].sort((left, right) => left - right)
    const within = singles.filter(difference => difference <= 1e-4).length
    console.log(`   step ${step}: ${within} of ${singles.length} single logits are within 1e-4 of finite differences, the median difference is ${singles[singles.length >> 1]!.toExponential(1)} and the largest ${singles.at(-1)!.toExponential(1)}`)
    if (index === steps.length - 1 && within < 0.95 * singles.length) problem(`with the settings that train, only ${within} of ${singles.length} single logits are close to finite differences at the step ${step}`)
  })
  console.log(`   Along ${directions.length} directions, in which every logit moves by ${directionStep}, the largest difference is ${largest(directions).toExponential(1)} of the gradient's length.`)
}

console.log(`${((performance.now() - started) / 1000).toFixed(0)} s.`)
console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
