// Samples in typed arrays, for loops over many of them: the code points, labels and intended states of the broken
// texts in flat arrays, and what is known per sample in arrays with one entry per sample. It is
// lab/recovery-parser/learn/data.ts for TOML, with two ways to make the arrays:
//
// - samplesOf(texts) takes labeled texts from anywhere, e.g. a small set that a check writes inline, or broken texts
//   that somebody labeled by hand. It finds every text's first error with today's parser.
// - loadSamples(seed, from, to) makes the samples of the dataset, ../samples.ts, and keeps them in a cache file. It
//   leaves out the samples of the dataset's test split unless the environment variable RECOVERY_FINAL is `yes`, see
//   requireFinal.
//
// What this file reads of the dataset is the type Dataset below, and nothing else: the dataset is built next to this
// folder and may hold more per sample. The JSON arrays also hold the dataset's groups ("within reach of the tables",
// "needs a nesting fix" and so on), its bound for the plain table parser and the mark of the intended states that a
// parser can follow. None of them is here: they come from proofs and judgments about broken JSON, and the recipe
// reads none of them.
//
// Run from the repo root to make the cache of the standard set and print what it holds:
//   bun lab/recovery-toml/learn/data.ts [--scratch <folder>] [--from 0] [--to 60000] [--seed <the dataset's>]
// Without --scratch, the folder is the environment variable RECOVERY_SCRATCH. The cache file goes to <folder>/cache.
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {capacity, containerInlineTable, runTableParser} from '../table-parser.ts'
import {cacheKey, datasetKey} from './dataset-key.ts'
import {optionOf, refuseUnknownOptions} from './options.ts'
import {createTrace, runRecoveryParserInto} from './recovery-parser.ts'
import {asIsTables} from './recovery-tables.ts'

export const splitNames = ['train', 'validation', 'test'] as const
export type Split = typeof splitNames[number]

// The label of a code point of a broken text: the display kind, the depth after and the container after of its
// counterpart in the valid text that the author meant, as ../reference.ts gives them. A value that is not scored is
// `undefined`. The depth and the container are scored together or not at all.
export type Label = {kind: number | undefined, depth: number | undefined, container: number | undefined}

// A labeled text, which is all that samplesOf needs.
export type LabeledText = {
  // The text's number in its set, e.g. the sample's index in the dataset. A cache and a random draw go by it.
  index: number
  split: Split
  // 'valid' for a text without damage, and otherwise what made the broken text, e.g. 'damage'.
  source: string
  // The kinds of damage in the text, e.g. ['deleteCodePoint'].
  kinds: readonly string[]
  // The one group that reports put the text into, e.g. 'two edits' for the number of its edits. Without it the text
  // is in no group's row.
  group?: string
  // The broken text, of at most 512 code points.
  broken: string
  // One entry per code point of the broken text: its label, or undefined for a code point that the damage added.
  labels: readonly (Label | undefined)[]
  // The index in the broken text of the first damaged code point, the text's length when only the original's end is
  // missing, and -1 in a valid text.
  firstDamage: number
  // The valid text that the author meant and, per code point of the broken text, the index of its counterpart in
  // that text, or -1 for an added code point. With both, the arrays hold the intended states: what today's parser
  // does at the counterpart. The rule that picks character classes reads the intended events.
  original?: string
  alignment?: readonly number[]
  // Per code point of the broken text: true when it stands in the place of its counterpart and differs from it.
  replaced?: readonly boolean[]
  // Where the text's maker says that the parser as it is reports its first error, and -1 for none. samplesOf finds
  // the position itself, and throws when the two differ.
  firstErrorPosition?: number
}

// What this file reads of the dataset's ../samples.ts. A sample of the dataset may hold more fields.
export type DatasetSample = Omit<LabeledText, 'index' | 'labels' | 'original' | 'alignment' | 'firstErrorPosition'> & {
  original: string
  alignment: readonly number[]
  // -1 in a valid sample.
  firstErrorPosition: number
}
export type Dataset = {
  defaultSeed: number
  sampleAt: (seed: number, index: number) => DatasetSample
  labelsOf: (sample: DatasetSample) => (Label | undefined)[]
  // The group of a broken sample: the number of its edits, e.g. 'two edits'.
  groupOf: (sample: DatasetSample) => string
}

// The dataset, loaded when a function first asks for it. It is no import at the top of this file because the dataset
// is built at the same time as this folder: the checks that need no dataset run without ../samples.ts. Once the
// dataset is there, an import at the top does the same.
let knownDataset: Dataset | undefined
export const datasetFile = join(import.meta.dir, '..', 'samples.ts')
export const datasetExists = () => existsSync(datasetFile)
export function dataset(): Dataset {
  if (knownDataset !== undefined) return knownDataset
  if (!datasetExists()) throw new Error(`the dataset is not there: ${datasetFile} has to export defaultSeed, sampleAt(seed, index), labelsOf(sample) and groupOf(sample), see the type Dataset in learn/data.ts`)
  const loaded = import.meta.require(datasetFile) as Partial<Dataset>
  if (typeof loaded.defaultSeed !== 'number' || typeof loaded.sampleAt !== 'function' || typeof loaded.labelsOf !== 'function' || typeof loaded.groupOf !== 'function') {
    throw new Error(`${datasetFile} does not export defaultSeed, sampleAt(seed, index), labelsOf(sample) and groupOf(sample), see the type Dataset in learn/data.ts`)
  }
  knownDataset = {defaultSeed: loaded.defaultSeed, sampleAt: loaded.sampleAt, labelsOf: loaded.labelsOf, groupOf: loaded.groupOf}
  return knownDataset
}

// The standard set of the experiment: the samples 0 to 59,999 of the dataset's default seed that are not in the test
// split, as on the JSON side. `to` is the first index left out.
export const standardRange = () => ({seed: dataset().defaultSeed, from: 0, to: 60_000})

// The bits of Samples.flags, per code point, with the numbers of the JSON side.
// The damage kept the code point: it has a counterpart in the original, and a label.
export const codePointKept = 1
// The display kind of the code point's label is scored.
export const codePointKindScored = 2
export const codePointReplaced = 4
// The mark "a parser of the broken text can be in the intended state after this code point" of the JSON side. Nothing
// here sets it, so the twin's options that go by the mark do nothing, see soft/twin.ts.
export const codePointCanFollow = 8
// The depth and the container of the code point's label are scored. The dataset scores both or neither.
export const codePointNestingScored = 16
// A score counts a code point when it is at or after the first error and one of its label's values is scored.
export const codePointScored = codePointKindScored | codePointNestingScored

// The dataset's test split is for final numbers only. Nothing in learn/ makes, loads or scores a sample of it unless
// the environment variable RECOVERY_FINAL is `yes`.
export const finalIsAllowed = () => process.env['RECOVERY_FINAL'] === 'yes'
export function requireFinal(what: string) {
  if (!finalIsAllowed()) throw new Error(`${what} reads the test split, which is for final numbers only. Nothing in learn/ reads it unless the environment variable RECOVERY_FINAL is set to yes.`)
}

// The dataset's sample `index` of `seed`, or undefined when the sample is in the test split and RECOVERY_FINAL is not
// `yes`. Every script of learn/ makes its samples through this function or through loadSamples.
export function allowedSampleAt(seed: number, index: number): DatasetSample | undefined {
  const sample = dataset().sampleAt(seed, index)
  return sample.split === 'test' && !finalIsAllowed() ? undefined : sample
}

export type Samples = {
  seed: number
  // A hash of the source files that decide what the dataset's samples are, see datasetKey. Two sets of the dataset
  // with the same key and the same indexes hold the same samples.
  datasetKey: string
  // True when the set may hold samples of the test split. Only loadSamples with `withTest` and samplesOf with texts
  // of that split make such a set.
  withTest: boolean
  sampleCount: number
  codePointCount: number
  // The sources, the groups and the kinds of damage of the set, as numbers: Samples.source holds indexes into
  // sourceNames, where 'valid' is 0, Samples.group into groupNames, where 0 is "no group", and Samples.kindList into
  // kindNames.
  sourceNames: string[]
  groupNames: string[]
  kindNames: string[]

  // One entry per sample. A sample's place is its entry in these arrays, which is not its index in the dataset, since
  // the samples of the test split are left out.
  index: Int32Array
  // The code points of the sample at place p are the entries start[p] to start[p + 1] - 1 of the arrays per code
  // point. One more entry than samples.
  start: Int32Array
  // The index in the broken text of the first damaged code point, the text's length when only the original's end is
  // missing, and -1 in a valid sample.
  firstDamage: Int32Array
  // Where today's parser reports its first error, and the error's kind. -1 and 0 in a valid sample, and also in a
  // damaged text that today's parser accepts. Scores count the code points from this position on.
  firstErrorPosition: Int32Array
  firstErrorKind: Uint8Array
  // Indexes into splitNames (train, validation, test), sourceNames and groupNames.
  split: Uint8Array
  source: Uint8Array
  group: Uint8Array
  // How many code points a score counts in the sample: the ones from the first error on whose label has a scored
  // value. 0 means that nothing is left to recover.
  scored: Int32Array
  // The kinds of the sample at place p are kindList[kindStart[p]] to kindList[kindStart[p + 1] - 1].
  kindStart: Int32Array
  kindList: Uint8Array

  // One entry per code point of the broken texts.
  codePoints: Int32Array
  // codePointKept when the damage kept the code point. codePointKindScored when the display kind of its label is
  // scored, codePointNestingScored when the depth and the container are. codePointReplaced when it stands for another
  // code point.
  flags: Uint8Array
  // The label: the display kind, the depth after the code point and the innermost container after it, as they are
  // for the counterpart in the original. -1 where the value is not scored, and in all three where the damage added
  // the code point.
  labelKind: Int8Array
  labelDepth: Int8Array
  labelContainer: Int8Array
  // The intended states: the tokenizer state after, the event, the grammar state after, the depth after and the
  // container after, as today's parser has them at the counterpart in the original. -1 without a counterpart, and
  // everywhere in a text that came without its original.
  intendedLexerAfter: Int8Array
  intendedEvent: Int8Array
  intendedGrammarAfter: Int8Array
  intendedDepthAfter: Int8Array
  intendedContainerAfter: Int8Array
  // The stack of open containers after the counterpart in the original, as bits: bit l - 1 is 1 when level l is an
  // inline table. 0 without a counterpart. Keeping a run of the twin on track needs it, see soft/twin.ts.
  intendedStack: Uint16Array
}

type TypedArray = Int32Array | Int8Array | Uint8Array | Uint16Array
const perSampleFields = ['index', 'firstDamage', 'firstErrorPosition', 'firstErrorKind', 'split', 'source', 'group', 'scored'] as const
const perCodePointFields = ['codePoints', 'flags', 'labelKind', 'labelDepth', 'labelContainer', 'intendedLexerAfter', 'intendedEvent', 'intendedGrammarAfter', 'intendedDepthAfter', 'intendedContainerAfter', 'intendedStack'] as const
const arrayFields = [...perSampleFields, ...perCodePointFields, 'start', 'kindStart', 'kindList'] as const
const arrayTypes = {Int32Array, Int8Array, Uint8Array, Uint16Array}

// The dataset's key and the cache's key are in dataset-key.ts: hashes of the source files that decide what the
// samples are, and what these arrays hold. Every saved file of tables holds the dataset's key.
export {datasetKey}

// An array that grows as values are added.
function growing<Typed extends TypedArray>(create: (length: number) => Typed) {
  let values = create(1 << 14)
  let length = 0
  return {
    push(value: number) {
      if (length === values.length) {
        const bigger = create(values.length * 2)
        bigger.set(values)
        values = bigger
      }
      values[length++] = value
    },
    done: () => values.slice(0, length) as Typed,
  }
}

// The arrays of some labeled texts, in their order. Throws for a text of more than 512 code points, for labels that
// do not fit the text, and for a damaged text that says nothing about its damage. `seed` is the seed of the set
// when the texts are samples of the dataset.
export function samplesOf(texts: Iterable<LabeledText>, seed = 0): Samples {
  const int32 = () => growing(length => new Int32Array(length))
  const int8 = () => growing(length => new Int8Array(length))
  const uint8 = () => growing(length => new Uint8Array(length))
  const uint16 = () => growing(length => new Uint16Array(length))
  const perSample = {index: int32(), firstDamage: int32(), firstErrorPosition: int32(), firstErrorKind: uint8(), split: uint8(), source: uint8(), group: uint8(), scored: int32()}
  const start = int32()
  const kindStart = int32()
  const kindList = uint8()
  const perCodePoint = {
    codePoints: int32(), flags: uint8(), labelKind: int8(), labelDepth: int8(), labelContainer: int8(),
    intendedLexerAfter: int8(), intendedEvent: int8(), intendedGrammarAfter: int8(), intendedDepthAfter: int8(), intendedContainerAfter: int8(), intendedStack: uint16(),
  }
  const sourceNames = ['valid']
  const groupNames = ['']
  const kindNames: string[] = []
  const numberOf = (names: string[], name: string) => {
    let number = names.indexOf(name)
    if (number === -1) number = names.push(name) - 1
    if (number > 255) throw new Error(`the samples have more than 256 names of one sort, e.g. ${name}`)
    return number
  }
  const tables = asIsTables()
  const trace = createTrace()
  let sampleCount = 0
  let codePointCount = 0
  let kindCount = 0
  let withTest = false
  start.push(0)
  kindStart.push(0)
  for (const text of texts) {
    const name = `the text ${text.index}`
    const brokenCodePoints = Array.from(text.broken, character => character.codePointAt(0)!)
    if (brokenCodePoints.length > capacity) throw new Error(`${name} has ${brokenCodePoints.length} code points, and the parser reads ${capacity}`)
    if (text.labels.length !== brokenCodePoints.length) throw new Error(`${name} has ${brokenCodePoints.length} code points and ${text.labels.length} labels`)
    const valid = text.source === 'valid'
    if (valid !== (text.firstDamage === -1)) throw new Error(`${name} has the source ${text.source} and its first damage at ${text.firstDamage}: a valid text has -1 there, and no other one`)
    if (text.split === 'test') withTest = true
    runRecoveryParserInto(trace, brokenCodePoints, 0, brokenCodePoints.length, false, tables)
    if (valid && !trace.valid) throw new Error(`${name} is a valid sample, and today's parser has an error at ${trace.firstErrorPosition}`)
    if (!valid && trace.firstErrorPosition !== -1 && trace.firstErrorPosition < text.firstDamage) throw new Error(`${name}: today's parser has its first error at ${trace.firstErrorPosition}, before the first damage at ${text.firstDamage}`)
    const firstError = trace.firstErrorPosition
    if (text.firstErrorPosition !== undefined && text.firstErrorPosition !== firstError) throw new Error(`${name}: its maker says that the first error is at ${text.firstErrorPosition}, and today's parser has it at ${firstError}`)
    // The intended states, from today's parser on the original, and the stack after each of its code points: an
    // opening bracket sets its level's bit by the container after it, and a closing bracket clears its level's bit.
    let intended: ReturnType<typeof runTableParser> | undefined
    let originalLength = 0
    const stackAfter: number[] = []
    if (text.original !== undefined && text.alignment !== undefined) {
      intended = runTableParser(text.original)
      originalLength = intended.length
      if (!intended.valid) throw new Error(`${name}: today's parser rejects its original at ${intended.firstErrorPosition}`)
      if (text.alignment.length !== brokenCodePoints.length) throw new Error(`${name} has ${brokenCodePoints.length} code points, and its alignment ${text.alignment.length}`)
      let depth = 0
      let stack = 0
      for (let position = 0; position < originalLength; position++) {
        const depthAfter = intended.depthAfter[position]!
        if (depthAfter > depth) stack = intended.containerAfter[position] === containerInlineTable ? stack | (1 << (depthAfter - 1)) : stack & ~(1 << (depthAfter - 1))
        else if (depthAfter < depth) stack &= ~(1 << (depth - 1))
        depth = depthAfter
        stackAfter.push(stack)
      }
    }
    perSample.index.push(text.index)
    perSample.firstDamage.push(text.firstDamage)
    perSample.firstErrorPosition.push(firstError)
    perSample.firstErrorKind.push(trace.firstErrorKind)
    perSample.split.push(splitNames.indexOf(text.split))
    perSample.source.push(numberOf(sourceNames, text.source))
    perSample.group.push(numberOf(groupNames, text.group ?? ''))
    for (const kind of text.kinds) {
      kindList.push(numberOf(kindNames, kind))
      kindCount++
    }
    kindStart.push(kindCount)
    let scored = 0
    for (let position = 0; position < brokenCodePoints.length; position++) {
      const label = text.labels[position]
      if (label !== undefined && (label.depth === undefined) !== (label.container === undefined)) throw new Error(`${name}, code point ${position}: the depth and the container are not scored together`)
      const counterpart = intended === undefined ? -1 : text.alignment![position]!
      if (intended !== undefined && (counterpart === -1) !== (label === undefined)) throw new Error(`${name}, code point ${position}: ${label === undefined ? 'it has a counterpart in the original and no label' : 'it has a label and no counterpart in the original'}`)
      if (counterpart < -1 || counterpart >= originalLength) throw new Error(`${name}, code point ${position}: its counterpart ${counterpart} is no code point of the original`)
      perCodePoint.codePoints.push(brokenCodePoints[position]!)
      perCodePoint.flags.push((label === undefined ? 0 : codePointKept) | (label?.kind === undefined ? 0 : codePointKindScored) | (label?.depth === undefined ? 0 : codePointNestingScored) | (text.replaced?.[position] === true ? codePointReplaced : 0))
      perCodePoint.labelKind.push(label?.kind ?? -1)
      perCodePoint.labelDepth.push(label?.depth ?? -1)
      perCodePoint.labelContainer.push(label?.container ?? -1)
      if (firstError !== -1 && position >= firstError && label !== undefined && (label.kind !== undefined || label.depth !== undefined)) scored++
      if (intended === undefined || counterpart === -1) {
        for (const field of ['intendedLexerAfter', 'intendedEvent', 'intendedGrammarAfter', 'intendedDepthAfter', 'intendedContainerAfter'] as const) perCodePoint[field].push(-1)
        perCodePoint.intendedStack.push(0)
        continue
      }
      // The labels come from the reference labeler and the intended depth and container from the tables' trace on
      // the original, so where a label's are scored they have to be the same numbers.
      if (label?.depth !== undefined && (label.depth !== intended.depthAfter[counterpart] || label.container !== intended.containerAfter[counterpart])) {
        throw new Error(`${name}, code point ${position}: the label says depth ${label.depth} and container ${label.container}, and the parser's trace on the original ${intended.depthAfter[counterpart]} and ${intended.containerAfter[counterpart]}`)
      }
      // The tokenizer state after a code point is the state before the next one.
      perCodePoint.intendedLexerAfter.push(intended.lexerStateBefore[counterpart + 1]!)
      perCodePoint.intendedEvent.push(intended.event[counterpart]!)
      perCodePoint.intendedGrammarAfter.push(intended.grammarAfter[counterpart]!)
      perCodePoint.intendedDepthAfter.push(intended.depthAfter[counterpart]!)
      perCodePoint.intendedContainerAfter.push(intended.containerAfter[counterpart]!)
      perCodePoint.intendedStack.push(stackAfter[counterpart]!)
    }
    perSample.scored.push(scored)
    codePointCount += brokenCodePoints.length
    start.push(codePointCount)
    sampleCount++
  }
  return {
    seed, datasetKey: datasetKey(), withTest, sampleCount, codePointCount, sourceNames, groupNames, kindNames,
    index: perSample.index.done(), firstDamage: perSample.firstDamage.done(), firstErrorPosition: perSample.firstErrorPosition.done(), firstErrorKind: perSample.firstErrorKind.done(),
    split: perSample.split.done(), source: perSample.source.done(), group: perSample.group.done(), scored: perSample.scored.done(),
    start: start.done(), kindStart: kindStart.done(), kindList: kindList.done(),
    codePoints: perCodePoint.codePoints.done(), flags: perCodePoint.flags.done(), labelKind: perCodePoint.labelKind.done(), labelDepth: perCodePoint.labelDepth.done(), labelContainer: perCodePoint.labelContainer.done(),
    intendedLexerAfter: perCodePoint.intendedLexerAfter.done(), intendedEvent: perCodePoint.intendedEvent.done(), intendedGrammarAfter: perCodePoint.intendedGrammarAfter.done(),
    intendedDepthAfter: perCodePoint.intendedDepthAfter.done(), intendedContainerAfter: perCodePoint.intendedContainerAfter.done(), intendedStack: perCodePoint.intendedStack.done(),
  }
}

// Makes the dataset's samples with the indexes `from` to `to - 1`, without the ones of the test split, or with them
// when `withTest` is true, which needs RECOVERY_FINAL.
export function makeSamples(seed: number, from: number, to: number, withTest = false): Samples {
  if (withTest) requireFinal('makeSamples with the test split')
  const {sampleAt, labelsOf, groupOf} = dataset()
  function* texts(): Generator<LabeledText> {
    for (let index = from; index < to; index++) {
      const sample = sampleAt(seed, index)
      if (sample.split === 'test' && !withTest) continue
      const {source, kinds, broken, firstDamage, original, alignment, replaced, firstErrorPosition, split} = sample
      yield {index, split, source, kinds, broken, labels: labelsOf(sample), firstDamage, original, alignment, firstErrorPosition, ...(replaced === undefined ? {} : {replaced}), ...(source === 'valid' ? {} : {group: groupOf(sample)})}
    }
  }
  return {...samplesOf(texts(), seed), withTest}
}

// The samples at the given places of `samples`, in the given order, as a set of their own. E.g. the validation part.
export function selectSamples(samples: Samples, places: ArrayLike<number>): Samples {
  const sampleCount = places.length
  let codePointCount = 0
  let kindCount = 0
  for (let at = 0; at < sampleCount; at++) {
    const place = places[at]!
    if (!(place >= 0 && place < samples.sampleCount)) throw new Error(`selectSamples got the place ${place}, and the set has the places 0 to ${samples.sampleCount - 1}`)
    codePointCount += samples.start[place + 1]! - samples.start[place]!
    kindCount += samples.kindStart[place + 1]! - samples.kindStart[place]!
  }
  const selected = {...samples, sampleCount, codePointCount, start: new Int32Array(sampleCount + 1), kindStart: new Int32Array(sampleCount + 1), kindList: new Uint8Array(kindCount)}
  for (const field of perSampleFields) {
    const from = samples[field]
    const to = new (from.constructor as new (length: number) => TypedArray)(sampleCount)
    for (let at = 0; at < sampleCount; at++) to[at] = from[places[at]!]!
    ;(selected as Record<string, unknown>)[field] = to
  }
  const perCodePoint = perCodePointFields.map(field => {
    const from = samples[field]
    const to = new (from.constructor as new (length: number) => TypedArray)(codePointCount)
    ;(selected as Record<string, unknown>)[field] = to
    return {from, to}
  })
  let codePointAt = 0
  let kindAt = 0
  for (let at = 0; at < sampleCount; at++) {
    const place = places[at]!
    const first = samples.start[place]!
    const end = samples.start[place + 1]!
    for (const {from, to} of perCodePoint) to.set(from.subarray(first, end), codePointAt)
    codePointAt += end - first
    selected.start[at + 1] = codePointAt
    const firstKind = samples.kindStart[place]!
    const endKind = samples.kindStart[place + 1]!
    selected.kindList.set(samples.kindList.subarray(firstKind, endKind), kindAt)
    kindAt += endKind - firstKind
    selected.kindStart[at + 1] = kindAt
  }
  return selected
}

// The places of the samples of one split, e.g. for a loop over the training samples of the whole set.
export function placesOfSplit(samples: Samples, split: Split): Int32Array {
  if (split === 'test') requireFinal('placesOfSplit of the test split')
  const wanted = splitNames.indexOf(split)
  return Int32Array.from({length: samples.sampleCount}, (_, place) => place).filter(place => samples.split[place] === wanted)
}
export const trainPart = (samples: Samples) => selectSamples(samples, placesOfSplit(samples, 'train'))
export const validationPart = (samples: Samples) => selectSamples(samples, placesOfSplit(samples, 'validation'))

// The broken text of one sample, and the names of its kinds.
export function textOf(samples: Samples, place: number) {
  const first = samples.start[place]!
  const end = samples.start[place + 1]!
  return String.fromCodePoint(...samples.codePoints.subarray(first, end))
}
export function kindsOf(samples: Samples, place: number) {
  const first = samples.kindStart[place]!
  const end = samples.kindStart[place + 1]!
  return Array.from(samples.kindList.subarray(first, end), kind => samples.kindNames[kind]!)
}

type CacheHeader = {
  format: string, cacheKey: string, datasetKey: string, withTest: boolean, seed: number, from: number, to: number, sampleCount: number, codePointCount: number,
  sourceNames: string[], groupNames: string[], kindNames: string[], sections: {field: string, type: string, length: number, offset: number}[],
}
const cacheFormat = 'recovery samples for TOML 1'
const align = (offset: number) => Math.ceil(offset / 8) * 8

function writeCache(path: string, samples: Samples, from: number, to: number) {
  const header: CacheHeader = {
    format: cacheFormat, cacheKey: cacheKey(), datasetKey: samples.datasetKey, withTest: samples.withTest, seed: samples.seed, from, to, sampleCount: samples.sampleCount, codePointCount: samples.codePointCount,
    sourceNames: samples.sourceNames, groupNames: samples.groupNames, kindNames: samples.kindNames, sections: [],
  }
  // The sections' offsets count from the end of the header, so that they don't depend on the header's length.
  let offset = 0
  for (const field of arrayFields) {
    header.sections.push({field, type: samples[field].constructor.name, length: samples[field].length, offset})
    offset = align(offset + samples[field].byteLength)
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const bodyStart = align(8 + headerBytes.length)
  const bytes = new Uint8Array(bodyStart + offset)
  new DataView(bytes.buffer).setUint32(0, headerBytes.length, true)
  bytes.set(headerBytes, 8)
  for (const section of header.sections) {
    const values = samples[section.field as typeof arrayFields[number]]
    bytes.set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength), bodyStart + section.offset)
  }
  // Written under another name first, so that a process that reads the cache at the same time never sees half a file.
  const partial = `${path}.${process.pid}.partial`
  writeFileSync(partial, bytes)
  renameSync(partial, path)
}

// The samples of a cache file, or undefined when the file was made from other sources, in another format, or with the
// test split where it is not asked for.
function readCache(path: string, withTest: boolean): {samples: Samples, from: number, to: number} | undefined {
  const file = readFileSync(path)
  // The arrays are views of the file's bytes, which have to start at a multiple of 8 for that.
  const buffer = file.byteOffset % 8 === 0 ? file.buffer : file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  const base = file.byteOffset % 8 === 0 ? file.byteOffset : 0
  const headerLength = new DataView(buffer, base, 8).getUint32(0, true)
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, base + 8, headerLength))) as CacheHeader
  if (header.format !== cacheFormat || header.cacheKey !== cacheKey() || header.datasetKey !== datasetKey() || header.withTest !== withTest) return undefined
  const bodyStart = base + align(8 + headerLength)
  const arrays: Record<string, TypedArray> = {}
  for (const section of header.sections) {
    const type = arrayTypes[section.type as keyof typeof arrayTypes]
    arrays[section.field] = new type(buffer, bodyStart + section.offset, section.length)
  }
  if (arrayFields.some(field => arrays[field] === undefined)) return undefined
  const samples = {
    seed: header.seed, datasetKey: header.datasetKey, withTest: header.withTest, sampleCount: header.sampleCount, codePointCount: header.codePointCount,
    sourceNames: header.sourceNames, groupNames: header.groupNames, kindNames: header.kindNames, ...arrays,
  } as unknown as Samples
  return {samples, from: header.from, to: header.to}
}

// The name of a cache file: the key of the sources, the seed, the range of indexes, and whether the test split is in it.
const cacheFileName = (seed: number, from: number, to: number, withTest: boolean) => `samples-${cacheKey()}-${seed}-${from}-${to}${withTest ? '-with-test' : ''}.bin`

// The cache folder of a scratch folder, or null without one. The scratch folder comes from the argument, or from the
// environment variable RECOVERY_SCRATCH.
export function cacheFolderOf(scratchFolder: string | undefined = process.env['RECOVERY_SCRATCH']): string | null {
  return scratchFolder === undefined || scratchFolder === '' ? null : join(scratchFolder, 'cache')
}

// The dataset's samples with the indexes `from` to `to - 1` of a seed that are not in the test split. With a cache
// folder: read from the folder's file of that range, or from its file of a range around it, e.g. the samples 0 to
// 19,999 from the file of the standard set, and otherwise made and written to the folder. With `null` as the cache
// folder the samples are made each time. Without the argument, the cache folder is the one of the environment
// variable RECOVERY_SCRATCH, so only `null` switches the cache off.
//
// `withTest` gives the samples of the test split too. It throws unless RECOVERY_FINAL is `yes`.
export function loadSamples(seed: number, from: number, to: number, cacheFolder: string | null = cacheFolderOf(), withTest = false): Samples {
  if (withTest) requireFinal('loadSamples with the test split')
  if (cacheFolder === null) return makeSamples(seed, from, to, withTest)
  mkdirSync(cacheFolder, {recursive: true})
  const namePattern = new RegExp(`^samples-${cacheKey()}-(\\d+)-(\\d+)-(\\d+)${withTest ? '-with-test' : ''}\\.bin$`)
  const covering = readdirSync(cacheFolder).flatMap(name => {
    const match = namePattern.exec(name)
    if (match === null || Number(match[1]) !== seed || Number(match[2]) > from || Number(match[3]) < to) return []
    return [{name, from: Number(match[2]), to: Number(match[3])}]
  }).sort((left, right) => (left.to - left.from) - (right.to - right.from))
  for (const candidate of covering) {
    const cached = readCache(join(cacheFolder, candidate.name), withTest)
    if (cached === undefined || cached.from !== candidate.from || cached.to !== candidate.to) continue
    if (candidate.from === from && candidate.to === to) return cached.samples
    const {index} = cached.samples
    return selectSamples(cached.samples, Int32Array.from({length: cached.samples.sampleCount}, (_, place) => place).filter(place => index[place]! >= from && index[place]! < to))
  }
  const samples = makeSamples(seed, from, to, withTest)
  writeCache(join(cacheFolder, cacheFileName(seed, from, to, withTest)), samples, from, to)
  return samples
}

export function loadStandardSamples(cacheFolder: string | null = cacheFolderOf()) {
  const {seed, from, to} = standardRange()
  return loadSamples(seed, from, to, cacheFolder)
}

// The splits that a command's --split names, e.g. ['train', 'validation'] for `--split train,validation`. Without
// the option, the validation split. The test split is refused, with or without RECOVERY_FINAL: the commands load no
// sample of the dataset's test split.
export function splitsOfOption(command: string, argv: readonly string[] = process.argv): Split[] {
  const named = (optionOf('--split', argv) ?? 'validation').split(',') as Split[]
  for (const split of named) {
    if (split === 'test') throw new Error(`${command} --split test: this command does not read the test split, which is for final numbers only.`)
    if (!splitNames.includes(split)) throw new Error(`--split takes train or validation, or both with a comma, and got ${split}`)
  }
  return named
}

if (import.meta.main) {
  refuseUnknownOptions('data.ts', ['--scratch', '--from', '--to', '--seed'])
  const range = standardRange()
  const seed = Number(optionOf('--seed') ?? range.seed)
  const from = Number(optionOf('--from') ?? range.from)
  const to = Number(optionOf('--to') ?? range.to)
  const cacheFolder = cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH'])
  const started = performance.now()
  const samples = loadSamples(seed, from, to, cacheFolder)
  const seconds = ((performance.now() - started) / 1000).toFixed(2)
  const tally = (values: Uint8Array, names: readonly string[], counted: (place: number) => boolean = () => true) =>
    names.map((name, value) => `${name} ${values.reduce((total, entry, place) => total + Number(entry === value && counted(place)), 0)}`).filter(text => !text.endsWith(' 0')).join(', ')
  const broken = (place: number) => samples.firstDamage[place] !== -1
  const brokenCount = samples.firstDamage.reduce((total, firstDamage) => total + Number(firstDamage !== -1), 0)
  const scored = samples.scored.reduce((total, count) => total + count, 0)
  console.log(`Dataset ${samples.datasetKey}, seed ${seed}, the samples with the indexes ${from} to ${to - 1} that are not in the test split: ${samples.sampleCount} samples and ${samples.codePointCount} code points in ${seconds} s${cacheFolder === null ? ', without a cache' : `, cache in ${cacheFolder}`}`)
  console.log(`splits: ${tally(samples.split, splitNames)}`)
  console.log(`sources: ${tally(samples.source, samples.sourceNames)}`)
  console.log(`groups of the ${brokenCount} broken samples: ${tally(samples.group, samples.groupNames, broken)}`)
  console.log(`Of the ${brokenCount} broken samples, ${samples.firstErrorPosition.reduce((total, position, place) => total + Number(broken(place) && position === -1), 0)} are valid for today's parser, and ${samples.scored.reduce((total, count, place) => total + Number(broken(place) && count === 0), 0)} have nothing to recover. The others have ${scored} scored code points.`)
  // A sample has the split of its original document, so two documents of two splits can end as the same broken text.
  const train = splitNames.indexOf('train')
  const validation = splitNames.indexOf('validation')
  const trainTexts = new Set<string>()
  for (let place = 0; place < samples.sampleCount; place++) if (samples.split[place] === train && broken(place)) trainTexts.add(textOf(samples, place))
  const shared = {samples: 0, texts: new Set<string>(), withSomethingToScore: 0, scored: 0}
  for (let place = 0; place < samples.sampleCount; place++) {
    if (samples.split[place] !== validation || !broken(place) || !trainTexts.has(textOf(samples, place))) continue
    shared.samples++
    shared.texts.add(textOf(samples, place))
    if (samples.scored[place]! > 0) shared.withSomethingToScore++
    shared.scored += samples.scored[place]!
  }
  console.log(`${shared.samples} broken validation samples have the broken text of a broken train sample (${shared.texts.size} texts). ${shared.withSomethingToScore} of them have something to score, ${shared.scored} scored code points.`)
}
