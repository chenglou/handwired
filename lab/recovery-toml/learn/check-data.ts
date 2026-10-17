// Checks the arrays of data.ts and the score of score.ts, on the small set of check-set.ts and, when the dataset
// ../samples.ts is there, on its samples with the indexes 0 to 3,999 that are not in the test split.
//
// Run from the repo root: bun lab/recovery-toml/learn/check-data.ts [samples of the dataset, default 4000]
//
// 1. The arrays hold what the texts say: the code points, the labels with -1 where a value is not scored, the first
//    error of today's parser, which the check finds with ../table-parser.ts, and the number of scored code points.
// 2. Before its first error, every text has today's trace, so a scored label there has to be what today's parser
//    gives: the check counts the scored values before a first error that today's parser does not give. And no code
//    point before a first error reads an open cell or an open display entry, in tables with added classes, open
//    display entries and the bit.
// 3. Every row of a score, made a second time: with today's parser, ../table-parser.ts, and with the labels of the
//    texts themselves, for the parser as it is. And for tables with a random choice in every open cell, the row
//    "all" made a second time with the exact parser's trace.
// 4. For the dataset: no sample of the test split is in the arrays, a call that names the test split throws, the
//    samples that come back from a cache file are the samples that were made, and a sample of the dataset has the
//    first error that today's parser finds.
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {type ParserTrace, runTableParser} from '../table-parser.ts'
import {checkSampleAt, checkSamples} from './check-set.ts'
import {classesOfTheChecks} from './check-texts.ts'
import {type LabeledText, type Samples, allowedSampleAt, codePointKept, codePointKindScored, codePointNestingScored, dataset, datasetExists, kindsOf, loadSamples, makeSamples, placesOfSplit, splitNames, standardRange, textOf} from './data.ts'
import {refuseUnknownOptions} from './options.ts'
import {createRandom} from './random.ts'
import {createTrace} from './recovery-parser.ts'
import {type RecoveryTables, addClasses, addFirstOnLineBit, asIsTables, displayEntryOf, openDisplayEntries, randomizeOpenCells} from './recovery-tables.ts'
import {type ScoreRow, runOnSample, scoreTables} from './score.ts'

refuseUnknownOptions('check-data.ts', [])
const datasetSamples = Number(process.argv[2] ?? 4000)
let failures = 0
const fail = (message: string) => {
  failures++
  if (failures <= 20) console.log(`FAILED: ${message}`)
}

const withStructure = addFirstOnLineBit(openDisplayEntries(addClasses(asIsTables(), classesOfTheChecks)))

// What a row counts, made here from the texts and a trace per text.
type Counts = Pick<ScoreRow, 'samples' | 'nothingToRecover' | 'codePoints' | 'allRight' | 'kindScored' | 'kindRight' | 'nestingScored' | 'depthRight' | 'containerRight' | 'wholeSamples' | 'addedCodePoints'>
const countFields = ['samples', 'nothingToRecover', 'codePoints', 'allRight', 'kindScored', 'kindRight', 'nestingScored', 'depthRight', 'containerRight', 'wholeSamples', 'addedCodePoints'] as const
const newCounts = (): Counts => ({samples: 0, nothingToRecover: 0, codePoints: 0, allRight: 0, kindScored: 0, kindRight: 0, nestingScored: 0, depthRight: 0, containerRight: 0, wholeSamples: 0, addedCodePoints: 0})

function checkSet(name: string, samples: Samples, textAt: (place: number) => LabeledText) {
  const failuresBefore = failures
  const rows = new Map<string, Counts>()
  const rowOf = (rowName: string) => {
    let row = rows.get(rowName)
    if (row === undefined) rows.set(rowName, row = newCounts())
    return row
  }
  const trace = createTrace()
  const tally = {texts: 0, codePoints: 0, scoredBeforeFirstError: 0, notGivenBeforeFirstError: 0, openReadsBeforeFirstError: 0, positionsBeforeFirstError: 0}
  for (let place = 0; place < samples.sampleCount; place++) {
    const text = textAt(place)
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    const broken = Array.from(text.broken)
    const today: ParserTrace = runTableParser(text.broken)
    tally.texts++
    tally.codePoints += length
    // 1. The arrays.
    if (length !== broken.length || textOf(samples, place) !== text.broken) fail(`${name}, text ${text.index}: the arrays hold another text`)
    if (samples.firstErrorPosition[place] !== today.firstErrorPosition || samples.firstErrorKind[place] !== today.firstErrorKind) fail(`${name}, text ${text.index}: the arrays say that the first error is at ${samples.firstErrorPosition[place]}, and today's parser has it at ${today.firstErrorPosition}`)
    if (samples.firstDamage[place] !== text.firstDamage || splitNames[samples.split[place]!] !== text.split || samples.sourceNames[samples.source[place]!] !== text.source || kindsOf(samples, place).join() !== text.kinds.join() || samples.groupNames[samples.group[place]!] !== (text.group ?? '')) {
      fail(`${name}, text ${text.index}: the arrays hold another first damage, split, source, group or other kinds`)
    }
    const firstError = today.firstErrorPosition === -1 ? length : today.firstErrorPosition
    const counts = newCounts()
    counts.samples = 1
    for (let position = 0; position < length; position++) {
      const label = text.labels[position]
      const flags = samples.flags[start + position]!
      const expectedFlags = (label === undefined ? 0 : codePointKept) | (label?.kind === undefined ? 0 : codePointKindScored) | (label?.depth === undefined ? 0 : codePointNestingScored)
      if ((flags & (codePointKept | codePointKindScored | codePointNestingScored)) !== expectedFlags || samples.labelKind[start + position] !== (label?.kind ?? -1) || samples.labelDepth[start + position] !== (label?.depth ?? -1) || samples.labelContainer[start + position] !== (label?.container ?? -1)) {
        fail(`${name}, text ${text.index}, code point ${position}: the arrays hold another label`)
      }
      if (position >= text.firstDamage && text.firstDamage !== -1 && label === undefined) counts.addedCodePoints++
      if (label === undefined) continue
      const kindRight = today.displayKind[position] === label.kind
      const nestingRight = today.depthAfter[position] === label.depth && today.containerAfter[position] === label.container
      if (position < firstError) {
        // 2. A scored value before the first error is what today's parser gives.
        if (label.kind !== undefined) {
          tally.scoredBeforeFirstError++
          if (!kindRight) tally.notGivenBeforeFirstError++
        }
        if (label.depth !== undefined) {
          tally.scoredBeforeFirstError++
          if (!nestingRight) tally.notGivenBeforeFirstError++
        }
        continue
      }
      if (label.kind === undefined && label.depth === undefined) continue
      counts.codePoints++
      let allRight = true
      if (label.kind !== undefined) {
        counts.kindScored++
        if (kindRight) counts.kindRight++
        else allRight = false
      }
      if (label.depth !== undefined) {
        counts.nestingScored++
        if (today.depthAfter[position] === label.depth) counts.depthRight++
        if (today.containerAfter[position] === label.container) counts.containerRight++
        if (!nestingRight) allRight = false
      }
      if (allRight) counts.allRight++
    }
    if (samples.scored[place] !== counts.codePoints) fail(`${name}, text ${text.index}: the arrays say ${samples.scored[place]} scored code points, and the check counts ${counts.codePoints}`)
    // 2. No open cell before the first error, with added structure.
    runOnSample(trace, samples, place, withStructure)
    for (let position = 0; position < firstError; position++) {
      tally.positionsBeforeFirstError++
      if (withStructure.lexerOpen[trace.lexerCell[position]!] === 1 || withStructure.grammarOpen[trace.grammarCell[position]!] === 1 || withStructure.displayOpen[displayEntryOf(withStructure, trace.event[position]!, trace.grammarAfter[position]!)] === 1) tally.openReadsBeforeFirstError++
    }
    // 3. The rows of the text. A valid text is in no row.
    if (text.firstDamage === -1) continue
    if (counts.codePoints === 0) counts.nothingToRecover = 1
    else if (counts.allRight === counts.codePoints) counts.wholeSamples = 1
    for (const rowName of ['all', `split: ${text.split}`, `source: ${text.source}`, ...(text.group === undefined ? [] : [`group: ${text.group}`]), ...text.kinds.map(kind => `kind: ${kind}`)]) {
      const row = rowOf(rowName)
      for (const field of countFields) row[field] += counts[field]
    }
  }
  if (tally.notGivenBeforeFirstError > 0) fail(`${name}: ${tally.notGivenBeforeFirstError} scored values before a first error are not what today's parser gives`)
  if (tally.openReadsBeforeFirstError > 0) fail(`${name}: ${tally.openReadsBeforeFirstError} code points before a first error read an open cell or an open display entry`)
  const splits = splitNames.filter(split => rows.has(`split: ${split}`))
  const score = scoreTables(asIsTables(), samples, {splits})
  let comparedCounts = 0
  for (const row of score.rows) {
    const expected = rows.get(row.name)
    for (const field of countFields) {
      comparedCounts++
      if (expected === undefined || row[field] !== expected[field]) fail(`${name}, the row "${row.name}": scoreTables counts ${row[field]} for ${field}, and the check ${expected?.[field]}`)
    }
  }
  if (score.rows.length !== rows.size) fail(`${name}: scoreTables has ${score.rows.length} rows, and the check ${rows.size}`)
  // Random tables: the row "all", from the exact parser's trace.
  let randomSettings = 0
  for (let setting = 0; setting < 3; setting++) {
    const tables: RecoveryTables = addFirstOnLineBit(openDisplayEntries(asIsTables()))
    randomizeOpenCells(tables, createRandom(20261016, 900 + setting))
    const expected = newCounts()
    for (let place = 0; place < samples.sampleCount; place++) {
      const firstError = samples.firstErrorPosition[place]!
      if (samples.firstDamage[place] === -1 || firstError === -1) continue
      const start = samples.start[place]!
      const length = samples.start[place + 1]! - start
      runOnSample(trace, samples, place, tables)
      let scored = 0
      let right = 0
      for (let position = firstError; position < length; position++) {
        const flags = samples.flags[start + position]!
        if ((flags & (codePointKindScored | codePointNestingScored)) === 0) continue
        scored++
        const kindRight = (flags & codePointKindScored) === 0 || trace.displayKind[position] === samples.labelKind[start + position]
        const nestingRight = (flags & codePointNestingScored) === 0 || (trace.depthAfter[position] === samples.labelDepth[start + position] && trace.containerAfter[position] === samples.labelContainer[start + position])
        if (kindRight && nestingRight) right++
      }
      expected.codePoints += scored
      expected.allRight += right
      if (scored > 0 && right === scored) expected.wholeSamples++
    }
    const row = scoreTables(tables, samples, {splits, breakdowns: false}).rows[0]!
    randomSettings++
    if (row.codePoints !== expected.codePoints || row.allRight !== expected.allRight || row.wholeSamples !== expected.wholeSamples) fail(`${name}, random setting ${setting}: scoreTables counts ${row.allRight} of ${row.codePoints} code points and ${row.wholeSamples} whole samples, and the check ${expected.allRight} of ${expected.codePoints} and ${expected.wholeSamples}`)
  }
  const all = rows.get('all')!
  console.log(`${name}: ${tally.texts} texts, ${tally.codePoints} code points. ${failures === failuresBefore ? 'The arrays hold the texts, their labels, their first errors and their scored code points.' : 'See the failures above.'} `
    + `Before a first error, ${tally.scoredBeforeFirstError} scored values are all what today's parser gives, and none of ${tally.positionsBeforeFirstError} code points reads an open cell or an open display entry of tables with added classes, open display entries and the bit. `
    + `The ${comparedCounts} counts of the ${score.rows.length} rows of the score of the parser as it is are the ones that the check makes with ../table-parser.ts: ${all.allRight} of ${all.codePoints} scored code points with all three right in ${all.samples} broken samples, ${all.nothingToRecover} of them with nothing to recover, ${all.wholeSamples} whole. The row "all" of ${randomSettings} random settings of every open cell is the one that the check makes from the exact parser's trace.`)
}

{
  const seedOfTheCheckSet = 20261016
  const samples = checkSamples(3000, seedOfTheCheckSet)
  checkSet('The check set', samples, place => checkSampleAt(seedOfTheCheckSet, samples.index[place]!))
}

if (!datasetExists()) {
  console.log('The dataset ../samples.ts is not there, so its samples are not checked.')
} else {
  const {seed} = standardRange()
  const {labelsOf, groupOf} = dataset()
  const samples = loadSamples(seed, 0, datasetSamples, null)
  const textOfDataset = (index: number): LabeledText => {
    const sample = allowedSampleAt(seed, index)
    if (sample === undefined) throw new Error(`the sample ${index} of the arrays is in the test split`)
    return {...sample, index, labels: labelsOf(sample), ...(sample.source === 'valid' ? {} : {group: groupOf(sample)})}
  }
  checkSet(`The dataset, the samples 0 to ${datasetSamples - 1} of seed ${seed} that are not in the test split`, samples, place => textOfDataset(samples.index[place]!))
  // 4. The test split, and the cache.
  let inTestSplit = 0
  let leftOut = 0
  for (let index = 0; index < datasetSamples; index++) if (allowedSampleAt(seed, index) === undefined) leftOut++
  for (let place = 0; place < samples.sampleCount; place++) if (splitNames[samples.split[place]!] === 'test') inTestSplit++
  if (inTestSplit > 0 || samples.sampleCount + leftOut !== datasetSamples || samples.withTest) fail(`the arrays hold ${inTestSplit} samples of the test split, and ${samples.sampleCount} samples where ${datasetSamples - leftOut} are not in the test split`)
  const throws = (run: () => unknown) => {
    try {
      run()
    } catch {
      return true
    }
    return false
  }
  const refused = [() => makeSamples(seed, 0, 10, true), () => loadSamples(seed, 0, 10, null, true), () => placesOfSplit(samples, 'test'), () => scoreTables(asIsTables(), samples, {splits: ['test']})].filter(throws).length
  if (refused !== 4) fail(`${4 - refused} of 4 calls that name the test split do not throw`)
  const scratch = process.env['RECOVERY_SCRATCH']
  let cache = 'The cache is not checked, since RECOVERY_SCRATCH is not set.'
  if (scratch !== undefined && scratch !== '') {
    const folder = join(scratch, 'check-data-cache')
    mkdirSync(folder, {recursive: true})
    const few = Math.min(600, datasetSamples)
    const made = makeSamples(seed, 0, few)
    const written = loadSamples(seed, 0, few, folder)
    const read = loadSamples(seed, 0, few, folder)
    const part = loadSamples(seed, 100, few - 100, folder)
    // Two sets hold the same samples when their arrays per code point are the same and every sample has the same
    // numbers and the same names: a set numbers its kinds and groups in the order in which its samples have them.
    const sameArrays = (left: ArrayLike<number>, right: ArrayLike<number>) => left.length === right.length && Array.prototype.every.call(left, (value: number, index: number) => value === right[index])
    const namesOf = (set: Samples, place: number) => `${splitNames[set.split[place]!]} ${set.sourceNames[set.source[place]!]} ${set.groupNames[set.group[place]!]} ${kindsOf(set, place).join()}`
    const sameSamples = (left: Samples, right: Samples) => left.sampleCount === right.sampleCount && left.codePointCount === right.codePointCount
      && (['index', 'start', 'firstDamage', 'firstErrorPosition', 'firstErrorKind', 'scored', 'codePoints', 'flags', 'labelKind', 'labelDepth', 'labelContainer', 'intendedLexerAfter', 'intendedEvent', 'intendedGrammarAfter', 'intendedDepthAfter', 'intendedContainerAfter', 'intendedStack'] as const).every(field => sameArrays(left[field], right[field]))
      && Array.from({length: left.sampleCount}, (_, place) => place).every(place => namesOf(left, place) === namesOf(right, place))
    const partMade = makeSamples(seed, 100, few - 100)
    if (!sameSamples(made, written) || !sameSamples(made, read) || !sameSamples(partMade, part)) fail('the samples that come back from a cache file are not the samples that were made')
    cache = `The samples 0 to ${few - 1} are the same after writing them to a cache file and reading them, and the samples 100 to ${few - 101} come out of that file as they are made.`
  }
  console.log(`The arrays hold no sample of the test split: ${leftOut} of the ${datasetSamples} indexes are left out. The 4 calls that name the test split throw. ${cache}`)
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
