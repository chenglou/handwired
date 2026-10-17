// Checks a twin's gradient against finite differences.
//
// 1. Where the loss is smooth, the two have to agree to many digits. The twin of exact stacks has a smooth loss
//    when no stack is dropped, so the settings of this part give it a width that holds every stack and a least
//    weight of 0. With every cell trainable no width holds every stack: a stack splits into 17 at every step. So a
//    random twentieth of the cells is trainable, on tables with a random choice in every open cell, in every
//    layout, with every open display entry trainable, and only samples whose runs split and drop no stack are
//    used. The check fails when a kind of choice has no logit with a gradient, so that every kind is covered.
// 2. With the settings that train, 48 stacks and every cell trainable, the loss has jumps where two stacks swap
//    their places at the cut, and the gradient is the smooth one of the stacks that are kept. A finite difference
//    that crosses a jump is far off, and a smaller step crosses fewer jumps. This part compares single logits at
//    two steps and fails unless nearly all of them agree at the small step.
//
// The gradient is compared with central differences of the fourth order, (-f(2h) + 8 f(h) - 8 f(-h) + f(-2h)) / 12h,
// as on the JSON side: along random directions, in which every logit of a group moves by +h or -h at once, and for
// single logits, the ones with the largest gradients and random ones among those with a gradient that is not 0.
// A direction's difference is divided by the length of the group's gradient, and a single logit's by the larger
// of 1 and its gradient: the loss of a batch is good to about 1e-10, which a step of 1e-3 turns into 1e-7, so a
// small gradient cannot be compared to many of its own digits.
//
// Run from the repo root: bun lab/recovery-lr/learn/soft/check-gradient.ts [--twin <module that exports createTwin>]
import {resolve} from 'node:path'
import {defaultSeed, loadSamples} from '../../dataset.ts'
import {createRandom} from '../../random.ts'
import {type PackedSamples, packSamples} from '../data.ts'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {type RecoveryTables, addFirstOnLineFlag, addTerminals, baseTables, changeableCellsOf, choiceKindNames, choicesOf, kindOfChoice, randomizeOpenCells, withoutEndEarly} from '../recovery-tables.ts'
import {type Model, createModel} from './model.ts'
import {type Twin, type TwinChoice, createTally, loadTwin, referenceTwin} from './twin.ts'

refuseUnknownOptions('soft/check-gradient.ts', ['--twin'])
const twinOption = optionOf('--twin')
const twinModule = twinOption === undefined ? referenceTwin.module : resolve(twinOption)
const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 30) console.log(`PROBLEM: ${text}`)
}
const directionsPerGroup = 6
const directionStep = 1e-4
const singleStep = 1e-3
const singlesPerGroup = 20
const tolerance = 1e-6
const samples = loadSamples('train', defaultSeed, 700)
const picked = [{name: 'ampersand', codePoint: 0x26}, {name: 'colon', codePoint: 0x3a}, {name: 'backslash', codePoint: 0x5c}]
const normal = (random: {next: () => number}) => Math.sqrt(-2 * Math.log(1 - random.next())) * Math.cos(2 * Math.PI * random.next())
const centralDifference = (lossAt: (offset: number) => number, step: number): number => (-lossAt(2 * step) + 8 * lossAt(step) - 8 * lossAt(-step) + lossAt(-2 * step)) / (12 * step)

// The differences between the gradient and finite differences, per group of logits: along random directions, and
// for single logits at each of `singleSteps`.
type Differences = {directions: number[], singles: number[][]}
const groups = ['cells', 'display'] as const
const newDifferences = (singleSteps: readonly number[]): Record<typeof groups[number], Differences> => ({cells: {directions: [], singles: singleSteps.map(() => [])}, display: {directions: [], singles: singleSteps.map(() => [])}})

// Compares the gradient of the summed loss of the samples at `places` with finite differences, and returns the gradient.
function compare(twin: Twin, model: Model, packed: PackedSamples, places: readonly number[], random: ReturnType<typeof createRandom>, singleSteps: readonly number[], differences: Record<typeof groups[number], Differences>): Float64Array {
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

const started = performance.now()

// 1. Where the loss is smooth.
{
  const smoothTwin: TwinChoice = {module: twinModule, options: {width: 2000, leastWeight: 0}}
  const differences = newDifferences([singleStep])
  const logitsWithGradient = new Map<string, number>()
  let samplesUsed = 0, stacksPerToken = 0, settingsRun = 0
  for (let setting = 0; setting < 8; setting++) {
    let base: RecoveryTables = baseTables()
    if (setting % 4 === 3) base = withoutEndEarly(base)
    if (setting % 3 === 1) base = addTerminals(base, picked)
    if (setting % 2 === 1) base = addFirstOnLineFlag(base)
    const random = createRandom(91, setting)
    randomizeOpenCells(base, random)
    const trainableCells = new Uint8Array(base.choice.length)
    for (const cell of changeableCellsOf(base)) if (random.chance(0.05)) trainableCells[cell] = 1
    const model = createModel(base, {trainable: {cells: trainableCells, display: 'open'}, start: 'uniform'})
    for (let logit = 0; logit < model.logits.length; logit++) model.logits[logit] = 1.5 * normal(random)
    const twin = await loadTwin(smoothTwin, model.layout)
    const packed = packSamples(samples, base)
    // The samples whose runs split and drop no stack. With a least weight of 0, which stacks a run makes does not
    // depend on the logits, so a run with moved logits drops none either. A twin that counts no stacks runs the
    // first 16 samples.
    const places: number[] = []
    let tokens = 0, stacks = 0
    for (let place = 0; place < packed.sampleCount && places.length < 16; place++) {
      const tally = createTally()
      twin.run(model.logits, packed, [place], tally)
      const {tokens: tokensOfRun = 0, stacksKept, stacksDropped = 0} = tally.counters
      if (stacksDropped > 0 || stacksKept === tokensOfRun) continue
      places.push(place)
      tokens += tokensOfRun
      stacks += stacksKept ?? 0
    }
    if (places.length < 16) {
      problem(`setting ${setting}: only ${places.length} samples split without a dropped stack`)
      continue
    }
    const gradient = compare(twin, model, packed, places, random, [singleStep], differences)
    for (let mix = 0; mix < model.layout.cellMixCount; mix++) {
      const list = choicesOf(base, model.layout.mixOwner[mix]!)
      for (let place = 0; place < list.length; place++) {
        if (gradient[model.layout.mixStart[mix]! + place] === 0) continue
        const name = choiceKindNames[kindOfChoice(list[place]!)]!
        logitsWithGradient.set(name, (logitsWithGradient.get(name) ?? 0) + 1)
      }
    }
    samplesUsed += places.length
    stacksPerToken += tokens === 0 ? 0 : stacks / tokens
    settingsRun++
  }
  for (const kind of ['stop', 'skip', 'pop', 'reduce', 'insert', 'read as', 'end early']) if ((logitsWithGradient.get(kind) ?? 0) === 0) problem(`no logit of a choice "${kind}" has a gradient in the smooth settings`)
  console.log(`1. Where the loss is smooth: ${settingsRun} settings in 4 layouts, a random twentieth of the cells and every open display entry trainable, ${samplesUsed} samples whose runs split and drop no stack, ${(stacksPerToken / Math.max(1, settingsRun)).toFixed(1)} stacks per token.`)
  console.log(`   Logits of cells with a gradient, by the kind of their choice: ${[...logitsWithGradient].map(([name, count]) => `${name} ${count}`).join(', ')}.`)
  for (const group of groups) {
    const {directions, singles} = differences[group]
    console.log(`   ${group}: ${directions.length} directions, largest difference ${largest(directions).toExponential(1)} of the gradient's length; ${singles[0]!.length} single logits, largest difference ${largest(singles[0]!).toExponential(1)} of the larger of 1 and the gradient`)
    if (directions.length === 0 || singles[0]!.length === 0) problem(`the smooth settings compare no logit of the ${group}`)
    if (largest(directions) > tolerance || largest(singles[0]!) > tolerance) problem(`${group}: the gradient differs from finite differences by more than ${tolerance}`)
  }
}

// 2. With the settings that train.
{
  const steps = [1e-3, 1e-5]
  const differences = newDifferences(steps)
  for (let setting = 0; setting < 2; setting++) {
    const base = setting === 0 ? baseTables() : addFirstOnLineFlag(addTerminals(baseTables(), picked))
    const random = createRandom(92, setting)
    const model = createModel(base, {start: 'base'})
    for (let logit = 0; logit < model.logits.length; logit++) model.logits[logit]! += 0.5 * normal(random)
    const twin = await loadTwin({module: twinModule}, model.layout)
    compare(twin, model, packSamples(samples.slice(0, 24), base), Array.from({length: 24}, (_, place) => place), random, steps, differences)
  }
  const directions = [...differences.cells.directions, ...differences.display.directions]
  console.log(`2. With the settings that train (every cell and entry trainable, 0.9 on the base's choice with random logits added, 24 samples, 2 layouts):`)
  steps.forEach((step, index) => {
    const singles = [...differences.cells.singles[index]!, ...differences.display.singles[index]!].sort((left, right) => left - right)
    const within = singles.filter(difference => difference <= 1e-4).length
    console.log(`   step ${step}: ${within} of ${singles.length} single logits are within 1e-4 of finite differences, the median difference is ${singles[singles.length >> 1]!.toExponential(1)} and the largest ${singles.at(-1)!.toExponential(1)}`)
    if (index === steps.length - 1 && within < 0.95 * singles.length) problem(`with the settings that train, only ${within} of ${singles.length} single logits are close to finite differences at the step ${step}`)
  })
  console.log(`   Along ${directions.length} directions, in which every logit moves by ${directionStep}, the largest difference is ${largest(directions).toExponential(1)} of the gradient's length: a direction crosses many jumps.`)
}

console.log(`${((performance.now() - started) / 1000).toFixed(0)} s.`)
console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
