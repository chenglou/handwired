// Checks that a twin with exact tables is the exact parser, token by token:
// 1. Tables in which no cell is trainable: the parser as it is, the two bars that are tables, tables that insert
//    a `(` wherever a cell can, and random settings of every open cell and every open display entry, in every
//    layout. The twin runs each sample from its first error on, and at every token its shares have to be exactly
//    0 and 1, with the 1 at the display kind, the depth and the container that recovery-parser.ts gives for the
//    whole text. Its loss has to be the loss of those outputs, counted code point by code point from the sample's
//    labels. Three texts with almost 500 open brackets are among the samples, so that runs meet the limit of the
//    stack as well as the limit of 16 steps.
// 2. The snapped twin: a model with every cell and entry trainable and random logits is snapped to tables, and
//    the twin is handed logits that make every mix the snapped choice (0 for it, -Infinity for the others). It has
//    to be the exact parser of the snapped tables at every token. So a logit's place in a mix means the same
//    choice to the twin and to the snapping.
// 3. For the twin of exact stacks: its selection of the heaviest stacks against a sort.
// 4. For a twin that counts the weight that it keeps: at the start of a run, with 0.9 on the base's choice in every
//    mix, its stacks hold at least 90% of the weight at a token. The part also prints the loss next to the loss
//    with 4,000 stacks.
//
// Run from the repo root: bun lab/recovery-lr/learn/soft/check-twin.ts [--twin <module that exports createTwin>] [--train <samples>] [--without-deep-texts]
// --without-deep-texts leaves the three texts with almost 500 open brackets out, for a twin that holds fewer levels
// of the stack than a text can have. The limit of the stack is then not met.
import {resolve} from 'node:path'
import {defaultSeed, loadSamples} from '../../dataset.ts'
import {containerCount, displayKindCount} from '../../labels.ts'
import {createRandom} from '../../random.ts'
import {type Sample, alignmentOfTexts, makeSample} from '../../sample.ts'
import {symbolOf} from '../../tables.ts'
import {popTables, skipTables} from '../bars.ts'
import {type PackedSamples, packSamples} from '../data.ts'
import {flagOf, numberOf, optionOf, refuseUnknownOptions} from '../options.ts'
import {runRecoveryParserOnTokens} from '../recovery-parser.ts'
import {type RecoveryTables, addFirstOnLineFlag, addTerminals, baseTables, changeableCellsOf, checkTables, choicesOf, differencesOf, insertOf, randomizeOpenCells, withoutEndEarly} from '../recovery-tables.ts'
import {scoreTables} from '../score.ts'
import {createModel, logitsOfTables, snappedTables} from './model.ts'
import {kthLargest} from './stacks-twin.ts'
import {type Twin, createReading, createTally, loadTwin, lossFloor, readingDepthCount, referenceTwin} from './twin.ts'

refuseUnknownOptions('soft/check-twin.ts', ['--twin', '--train'], ['--without-deep-texts'])
const twinOption = optionOf('--twin')
const twinChoice = twinOption === undefined ? referenceTwin : {module: resolve(twinOption)}
const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 30) console.log(`PROBLEM: ${text}`)
}
const trainSamples = loadSamples('train', defaultSeed, numberOf('--train', 1200))
// Texts whose stack is almost 500 states high at the first error: a nest of 250 brackets with 230 more brackets
// added, and then tokens that cannot follow a bracket.
const deepSamples = ['in in in 1', 'then = 1 in', '] ] else 1'].map((inside, index) => {
  const original = `let x = ${'('.repeat(250)}1${')'.repeat(250)}`, broken = `let x = ${'('.repeat(480)}${inside}${')'.repeat(9)}`
  const sample = makeSample({id: `deep:${index}`, original, broken, alignment: alignmentOfTexts(original, broken)})
  if (typeof sample === 'string') throw new Error(`a deep text is no sample: ${sample}`)
  return sample
})
const samples = flagOf('--without-deep-texts') ? trainSamples : [...trainSamples, ...deepSamples]
const picked = [{name: 'ampersand', codePoint: 0x26}, {name: 'colon', codePoint: 0x3a}, {name: 'backslash', codePoint: 0x5c}]
const normal = (random: {next: () => number}) => Math.sqrt(-2 * Math.log(1 - random.next())) * Math.cos(2 * Math.PI * random.next())

// The layouts of the random settings: every third with added terminals, every second with the flag, every fourth
// without "end an item early".
function layoutOf(setting: number): RecoveryTables {
  let tables = baseTables()
  if (setting % 4 === 3) tables = withoutEndEarly(tables)
  if (setting % 3 === 1) tables = addTerminals(tables, picked)
  if (setting % 2 === 1) tables = addFirstOnLineFlag(tables)
  return tables
}

const reading = createReading()
let tokensCompared = 0, runsCompared = 0
// Runs the twin on every sample with `logits` and compares what it shows with the exact parser of `tables`.
function compareWithExactParser(name: string, twin: Twin, logits: Float64Array, tables: RecoveryTables, packed: PackedSamples, texts: readonly Sample[]) {
  let differing = 0
  for (let place = 0; place < texts.length; place++) {
    const sample = texts[place]!
    const tally = createTally()
    twin.run(logits, packed, [place], tally, null, reading)
    const run = runRecoveryParserOnTokens(sample.codePoints, sample.tokens, tables)
    const {tokens} = sample
    let same = reading.tokenCount === tokens.count - sample.firstErrorToken
    let kindLoss = 0, depthLoss = 0, containerLoss = 0
    for (let token = sample.firstErrorToken; token < tokens.count && same; token++) {
      const row = token - sample.firstErrorToken
      const shown = [
        {shares: reading.kind, from: row * displayKindCount, count: displayKindCount, exact: run.kind[token]!},
        {shares: reading.depth, from: row * readingDepthCount, count: readingDepthCount, exact: run.depth[token]!},
        {shares: reading.container, from: row * containerCount, count: containerCount, exact: run.container[token]!},
      ]
      for (const {shares, from, count, exact} of shown) {
        let total = 0
        for (let entry = from; entry < from + count; entry++) total += shares[entry]!
        if (shares[from + exact] !== 1 || total !== 1) same = false
      }
      for (let position = tokens.start[token]!; position < tokens.start[token]! + tokens.length[token]!; position++) {
        if (sample.alignment[position] === -1) continue
        kindLoss -= Math.log((run.kind[token] === sample.labelKind[position] ? 1 : 0) + lossFloor)
        depthLoss -= Math.log((run.depth[token] === sample.labelDepth[position] ? 1 : 0) + lossFloor)
        containerLoss -= Math.log((run.container[token] === sample.labelContainer[position] ? 1 : 0) + lossFloor)
      }
      tokensCompared++
    }
    const close = (left: number, right: number): boolean => Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(right))
    if (same && !(close(tally.kindLoss, kindLoss) && close(tally.depthLoss, depthLoss) && close(tally.containerLoss, containerLoss) && close(tally.loss, kindLoss + depthLoss + containerLoss) && tally.codePoints === sample.scored)) same = false
    if (!same) differing++
    runsCompared++
  }
  if (differing > 0) problem(`${name}: the twin differs from the exact parser in ${differing} of ${texts.length} samples`)
}

// 1. Tables in which no cell is trainable.
{
  // Tables that insert a `(` wherever a cell can: after a `(` the parser can shift a `(` again, so a token that
  // cannot follow a bracket adds 16 states to the stack and is then skipped.
  const inserting = baseTables()
  for (const cell of changeableCellsOf(inserting)) if (choicesOf(inserting, cell).includes(insertOf(symbolOf('LPAREN')))) inserting.choice[cell] = insertOf(symbolOf('LPAREN'))
  const settings: [string, RecoveryTables][] = [['the parser as it is', baseTables()], ['skip every rejected token', skipTables()], ['pop where bison reports', popTables()], ['insert a `(` wherever a cell can', inserting]]
  for (let setting = 0; setting < 12; setting++) {
    const tables = layoutOf(setting)
    randomizeOpenCells(tables, createRandom(81, setting))
    settings.push([`random setting ${setting}`, tables])
  }
  let skippedByStepLimit = 0, skippedByStackLimit = 0
  for (const [name, tables] of settings) {
    const model = createModel(tables, {trainable: {cells: 'none', display: 'none'}})
    if (model.layout.logitCount !== 0) problem(`${name}: a model without a trainable cell has ${model.layout.logitCount} logits`)
    const packed = packSamples(samples, tables)
    compareWithExactParser(name, await loadTwin(twinChoice, model.layout), model.logits, tables, packed, samples)
    const {totals} = scoreTables(tables, packed)
    skippedByStepLimit += totals.tokensSkippedByStepLimit
    skippedByStackLimit += totals.tokensSkippedByStackLimit
  }
  if (skippedByStepLimit === 0 || (skippedByStackLimit === 0 && !flagOf('--without-deep-texts'))) problem('no run of these tables meets the limit of 16 steps, or the limit of the stack')
  console.log(`1. With no trainable cell, ${settings.length} tables (the parser as it is, two bars, tables that insert an opening bracket wherever they can, 12 random settings in 4 layouts): the twin "${(await loadTwin(twinChoice, createModel(baseTables()).layout)).name}" shows what the exact parser shows at every token, with shares of exactly 0 and 1, and has the loss of those outputs. ${runsCompared} runs, ${tokensCompared} tokens, of which ${skippedByStepLimit} are skipped after 16 steps and ${skippedByStackLimit} at the limit of the stack.`)
}

// 2. The snapped twin.
{
  const runsBefore = runsCompared, tokensBefore = tokensCompared
  let changedCells = 0, changedEntries = 0, logitCount = 0
  for (let setting = 0; setting < 8; setting++) {
    const base = layoutOf(setting)
    const model = createModel(base, {start: setting % 2 === 0 ? 'base' : 'uniform'})
    const random = createRandom(82, setting)
    for (let logit = 0; logit < model.logits.length; logit++) model.logits[logit]! += 2 * normal(random)
    const snapped = snappedTables(model)
    checkTables(snapped)
    const differences = differencesOf(base, snapped)
    changedCells += differences.filter(difference => difference.table === 'cells').length
    changedEntries += differences.filter(difference => difference.table === 'display').length
    logitCount += model.logits.length
    compareWithExactParser(`snapped setting ${setting}`, await loadTwin(twinChoice, model.layout), logitsOfTables(model.layout, snapped), snapped, packSamples(samples, base), samples)
  }
  // A model at its start snaps to its base, from either start.
  for (const start of ['base', 'uniform'] as const) {
    const base = layoutOf(1)
    if (differencesOf(base, snappedTables(createModel(base, {start}))).length !== 0) problem(`a model that starts at "${start}" does not snap to its base tables`)
  }
  console.log(`2. Snapped: 8 models with random logits (${logitCount} logits, ${changedCells} cells and ${changedEntries} display entries snap to another choice than the base). Handed the snapped choices as logits of 0 and -Infinity, the twin is the exact parser of the snapped tables: ${runsCompared - runsBefore} runs, ${tokensCompared - tokensBefore} tokens. A model at its start snaps to its base.`)
}

// 3. The selection of the twin of exact stacks.
{
  const random = createRandom(83, 0)
  let trials = 0
  for (let trial = 0; trial < 4000; trial++) {
    const count = random.integer(1, 300)
    // Few distinct values, so that many are equal.
    const values = Float64Array.from({length: count}, () => random.chance(0.5) ? random.integer(0, 9) : random.next())
    const k = random.integer(1, count)
    const sorted = Array.from(values).sort((left, right) => right - left)
    if (kthLargest(values.slice(), count, k) !== sorted[k - 1]) problem(`the ${k}-th largest of ${count} values is not the sort's`)
    trials++
  }
  console.log(`3. The ${trials} selections of a k-th largest value are the ones of a sort.`)
}

// 4. The weight that the kept stacks hold.
{
  const base = addFirstOnLineFlag(baseTables())
  const model = createModel(base)
  const packed = packSamples(trainSamples.slice(0, 300), base)
  const places = Array.from({length: packed.sampleCount}, (_, place) => place)
  const asTrained = createTally(), wide = createTally()
  ;(await loadTwin(twinChoice, model.layout)).run(model.logits, packed, places, asTrained)
  ;(await loadTwin({...twinChoice, options: {width: 4000}}, model.layout)).run(model.logits, packed, places, wide)
  const {weightKept, tokens = 0, stacksKept = 0} = asTrained.counters
  if (weightKept === undefined) console.log('4. The twin does not count the weight that it keeps: nothing to check.')
  else {
    const lossAsTrained = asTrained.loss / asTrained.codePoints, lossWide = wide.loss / wide.codePoints
    const wideWeightKept = wide.counters['weightKept'] ?? 0
    if (!(weightKept / tokens >= 0.9) || !(wideWeightKept >= weightKept)) problem(`at the start of a run the twin keeps ${(100 * weightKept / tokens).toFixed(1)}% of the weight at a token, and ${(100 * wideWeightKept / tokens).toFixed(1)}% with 4,000 stacks`)
    console.log(`4. At the start of a run, on 300 samples: the twin keeps ${(stacksKept / tokens).toFixed(1)} stacks per token, which hold ${(100 * weightKept / tokens).toFixed(1)}% of the weight, and its loss is ${lossAsTrained.toFixed(4)} per code point with ${(100 * asTrained.labelsWithoutShare / (3 * asTrained.codePoints)).toFixed(1)}% of the labels without a share. With 4,000 stacks: ${(100 * wideWeightKept / tokens).toFixed(1)}% of the weight, a loss of ${lossWide.toFixed(4)}, ${(100 * wide.labelsWithoutShare / (3 * wide.codePoints)).toFixed(1)}% of the labels without a share.`)
  }
}

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
