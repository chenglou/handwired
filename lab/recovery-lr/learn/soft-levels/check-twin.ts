// Checks of the twin of levels that ../soft/check-twin.ts does not make. That check shows that the twin is the exact
// parser when no cell holds a mix: run it with --twin lab/recovery-lr/learn/soft-levels/levels-twin.ts, and with
// pusher-below-twin.ts for the variant. Here:
// 1. With mixes in display entries only, the twin is still exact: a display entry's mix is read once per token and
//    no state depends on it. So the twin has to show what the reference twin shows, which holds every stack then,
//    with the same loss and the same gradient by the logits of the display entries.
// 2. With mixes in cells: what the twin shows for a token adds up to 1 for the display kind, for the depth and for
//    the container, and no share is negative. So no step loses a share or makes one. Two of the settings are
//    tables that skip a rejected token or pop, with all but 1e-15 of every mix on the tables' choice, as after a
//    long training: the parse then goes on through hundreds of reductions, and a share that rounding makes
//    negative by 1e-16 would grow with every reduction, if a step let it through, and end as a loss that is no
//    number. A training of the design's form on 40,000 samples ended so before the twin kept such a share at 0.
// 3. A run with a gradient and a run without one take two routes through the twin's memory, and have to give the
//    same loss to the last digit.
//
// Run from the repo root: bun lab/recovery-lr/learn/soft-levels/check-twin.ts [--twin <module that exports createTwin>]
// --twin is for a changed copy of levels-twin.ts, to see that the check can fail.
import {resolve} from 'node:path'
import {defaultSeed, loadSamples} from '../../dataset.ts'
import {containerCount, displayKindCount} from '../../labels.ts'
import {createRandom} from '../../random.ts'
import {skipTables} from '../bars.ts'
import {packSamples} from '../data.ts'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {type RecoveryTables, addFirstOnLineFlag, addTerminals, baseTables, changeableCellsOf, choicePop, choiceSkip, choicesOf, randomizeOpenCells, withoutEndEarly} from '../recovery-tables.ts'
import {createModel} from '../soft/model.ts'
import {createTwin as createStacksTwin} from '../soft/stacks-twin.ts'
import {type TwinModule, createReading, createTally, readingDepthCount} from '../soft/twin.ts'

refuseUnknownOptions('soft-levels/check-twin.ts', ['--twin'])
const twinOption = optionOf('--twin')
const {createTwin} = await import(twinOption === undefined ? new URL('./levels-twin.ts', import.meta.url).href : resolve(twinOption)) as TwinModule
const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 30) console.log(`PROBLEM: ${text}`)
}
const samples = loadSamples('train', defaultSeed, 400)
const picked = [{name: 'ampersand', codePoint: 0x26}, {name: 'colon', codePoint: 0x3a}, {name: 'backslash', codePoint: 0x5c}]
const normal = (random: {next: () => number}) => Math.sqrt(-2 * Math.log(1 - random.next())) * Math.cos(2 * Math.PI * random.next())
function layoutOf(setting: number): RecoveryTables {
  let tables = baseTables()
  if (setting % 4 === 3) tables = withoutEndEarly(tables)
  if (setting % 3 === 1) tables = addTerminals(tables, picked)
  if (setting % 2 === 1) tables = addFirstOnLineFlag(tables)
  return tables
}
const forms = [{name: 'the design\'s form', options: {}}, {name: 'the variant pusherBelow', options: {pusherBelow: 1}}]

// 1. Mixes in display entries only.
{
  let tokens = 0, largestShareDifference = 0, largestGradientDifference = 0, largestLossDifference = 0, logitsCompared = 0
  const reading = createReading(), referenceReading = createReading()
  for (let setting = 0; setting < 8; setting++) {
    const base = layoutOf(setting)
    const random = createRandom(171, setting)
    randomizeOpenCells(base, random)
    const model = createModel(base, {trainable: {cells: 'none', display: 'open'}, start: 'uniform'})
    for (let logit = 0; logit < model.logits.length; logit++) model.logits[logit] = 1.5 * normal(random)
    const twin = createTwin(model.layout, forms[setting % 2]!.options)
    const reference = createStacksTwin(model.layout, {width: 2000, leastWeight: 0})
    const packed = packSamples(samples, base)
    const places = Array.from({length: packed.sampleCount}, (_, place) => place)
    const gradient = new Float64Array(model.layout.logitCount), referenceGradient = new Float64Array(model.layout.logitCount)
    const tally = createTally(), referenceTally = createTally()
    twin.run(model.logits, packed, places, tally, gradient)
    reference.run(model.logits, packed, places, referenceTally, referenceGradient)
    if ((referenceTally.counters['stacksDropped'] ?? 0) !== 0) problem(`setting ${setting}: the reference twin dropped a stack, so it is no reference here`)
    largestLossDifference = Math.max(largestLossDifference, Math.abs(tally.loss - referenceTally.loss) / referenceTally.loss)
    let gradientLength = 0
    for (let logit = 0; logit < gradient.length; logit++) gradientLength = Math.max(gradientLength, Math.abs(referenceGradient[logit]!))
    for (let logit = 0; logit < gradient.length; logit++) {
      if (referenceGradient[logit] !== 0) logitsCompared++
      largestGradientDifference = Math.max(largestGradientDifference, Math.abs(gradient[logit]! - referenceGradient[logit]!) / gradientLength)
    }
    for (let place = 0; place < packed.sampleCount; place += 4) {
      twin.run(model.logits, packed, [place], createTally(), null, reading)
      reference.run(model.logits, packed, [place], createTally(), null, referenceReading)
      if (reading.tokenCount !== referenceReading.tokenCount) problem(`setting ${setting}, sample ${place}: the twin shows ${reading.tokenCount} tokens and the reference twin ${referenceReading.tokenCount}`)
      tokens += reading.tokenCount
      for (const [shown, expected, count] of [[reading.kind, referenceReading.kind, displayKindCount], [reading.depth, referenceReading.depth, readingDepthCount], [reading.container, referenceReading.container, containerCount]] as const) {
        for (let entry = 0; entry < reading.tokenCount * count; entry++) largestShareDifference = Math.max(largestShareDifference, Math.abs(shown[entry]! - expected[entry]!))
      }
    }
  }
  if (!(largestShareDifference <= 1e-12) || !(largestLossDifference <= 1e-12) || !(largestGradientDifference <= 1e-12) || logitsCompared === 0) {
    problem(`with mixes in display entries only, the twin differs from the reference twin: shares by ${largestShareDifference}, the loss by ${largestLossDifference} of itself, the gradient by ${largestGradientDifference} of its largest entry, ${logitsCompared} logits with a gradient`)
  }
  console.log(`1. Mixes in display entries only, 8 random settings of the cells in 4 layouts, 4 in each form, 400 samples: the twin shows what the reference twin shows at ${tokens} tokens of every fourth sample (largest difference of a share ${largestShareDifference.toExponential(1)}), with its loss (${largestLossDifference.toExponential(1)} of the loss) and its gradient (${logitsCompared} logits with a gradient, largest difference ${largestGradientDifference.toExponential(1)} of the largest entry).`)
}

// 2. With mixes in cells, what is shown adds up to 1.
{
  const reading = createReading()
  for (const {name, options} of forms) {
    for (const [cut, extra, depthTolerance] of [['without a cut (leastLive 0, leastShare 0), on 40 samples of at most 8 tokens', {leastLive: 0, leastShare: 0}, 1e-9], ['with the settings that train, on 200 or 400 samples', {}, 1e-5]] as const) {
      let tokens = 0, largestOff = 0, largestDepthOff = 0, mostNegative = 0
      for (let setting = 0; setting < 6; setting++) {
        // Three starts: random logits, the recipe's 0.9 on the base's choice, and almost all of every mix on the
        // choice of tables that go on after every rejected token: they skip it, or pop in every third such cell.
        const base = setting < 4 ? layoutOf(setting) : skipTables(layoutOf(setting))
        if (setting >= 4) for (const cell of changeableCellsOf(base)) if (cell % 3 === 0 && base.choice[cell] === choiceSkip && choicesOf(base, cell).includes(choicePop)) base.choice[cell] = choicePop
        const random = createRandom(172, setting)
        const model = createModel(base, setting < 2 ? {start: 'uniform'} : setting < 4 ? {start: 'base'} : {start: 'base', startShare: 1 - 1e-15})
        if (setting < 2) for (let logit = 0; logit < model.logits.length; logit++) model.logits[logit] = 1.5 * normal(random)
        const twin = createTwin(model.layout, {...options, ...extra})
        const chosen = 'leastShare' in extra ? samples.filter(sample => sample.tokens.count - sample.firstErrorToken <= 8).slice(0, 40) : setting < 4 ? samples.slice(0, 200) : samples
        const packed = packSamples(chosen, base)
        for (let place = 0; place < packed.sampleCount; place++) {
          twin.run(model.logits, packed, [place], createTally(), null, reading)
          tokens += reading.tokenCount
          for (let row = 0; row < reading.tokenCount; row++) {
            for (const [shown, count, isDepth] of [[reading.kind, displayKindCount, false], [reading.depth, readingDepthCount, true], [reading.container, containerCount, false]] as const) {
              let total = 0
              for (let entry = row * count; entry < (row + 1) * count; entry++) {
                total += shown[entry]!
                mostNegative = Math.min(mostNegative, shown[entry]!)
              }
              if (isDepth) largestDepthOff = Math.max(largestDepthOff, Math.abs(total - 1))
              else largestOff = Math.max(largestOff, Math.abs(total - 1))
            }
          }
        }
      }
      if (!(largestOff <= 1e-9) || !(largestDepthOff <= depthTolerance) || !(mostNegative >= -1e-12)) problem(`${name}, ${cut}: the shares of a token are off 1 by ${largestOff} (kind, container) and ${largestDepthOff} (depth), and the most negative share is ${mostNegative}`)
      console.log(`2. Mixes in cells, ${name}, ${cut}: at ${tokens} tokens the shares of the display kinds and of the containers add up to 1 within ${largestOff.toExponential(1)}, those of the depths within ${largestDepthOff.toExponential(1)}, and the most negative share is ${mostNegative.toExponential(1)}.`)
    }
  }
}

// 3. The loss with and without a gradient.
{
  let runs = 0
  for (const {name, options} of forms) {
    const base = layoutOf(1)
    const model = createModel(base)
    const twin = createTwin(model.layout, options)
    const packed = packSamples(samples.slice(0, 100), base)
    const places = Array.from({length: packed.sampleCount}, (_, place) => place)
    const without = createTally(), withGradient = createTally()
    twin.run(model.logits, packed, places, without)
    twin.run(model.logits, packed, places, withGradient, new Float64Array(model.layout.logitCount))
    if (without.loss !== withGradient.loss || without.labelsWithoutShare !== withGradient.labelsWithoutShare) problem(`${name}: the loss of 100 samples is ${without.loss} without a gradient and ${withGradient.loss} with one`)
    runs++
  }
  console.log(`3. At the recipe's start, in ${runs} forms: a run with a gradient has the loss of a run without one, to the last digit.`)
}

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
