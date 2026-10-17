// The dataset in typed arrays, for loops over many samples: loadSamples(seed, from, to) makes the samples once and
// holds their code points, labels and intended states in flat arrays, and what is known per sample in arrays with one
// entry per sample. With a cache folder, a later process reads the arrays from a file in well under a second.
//
// The test split is not in the arrays. A sample of the test split is left out when the samples are made, so nothing
// that reads the arrays can score it, print it or train on it. Only a call that asks for the test split by name gets
// it, and only when the environment variable RECOVERY_FINAL is `yes`, see requireFinal.
//
// Run from the repo root to make the cache of the standard set and print what it holds:
//   bun lab/recovery-parser/learn/data.ts [--scratch <folder>] [--from 0] [--to 60000] [--seed 20261015]
// Without --scratch, the folder is the environment variable RECOVERY_SCRATCH. The cache file goes to <folder>/cache.
import {mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {families, kinds} from '../damage.ts'
import {type Group, type Sample, type Split, defaultSeed, groupOf, groups, labelsOf, mostRightFor, sampleAt, scoredCodePoints, sources, splits} from '../samples.ts'
import {cacheKey, datasetKey} from './dataset-key.ts'
import {intendedOf} from './intended.ts'

// The standard set of the experiment: the samples 0 to 59,999 of the default seed that are not in the test split.
// `to` is the first index left out.
export const standardRange = {seed: defaultSeed, from: 0, to: 60_000} as const

export const splitNames: readonly Split[] = splits
export const sourceNames: readonly string[] = sources
export const reachableNames = ['yes', 'line rule', 'no'] as const
// The dataset's six groups, see groupOf in ../samples.ts: one per broken sample, by what it takes to label it.
export const groupNames: readonly Group[] = groups
// The bits of Samples.flags, per code point.
// The damage kept the code point: it has a counterpart in the original, and intended states.
export const codePointKept = 1
// The display kind of the code point's label is scored.
export const codePointKindScored = 2
export const codePointReplaced = 4
// The intended state after the code point is one that a parser of the broken text can be in, see canFollowOf in
// intended.ts. Only there may the intended states be targets of training, or states to put a run on.
export const codePointCanFollow = 8
// The depth and the container of the code point's label are scored. The dataset scores both or neither.
export const codePointNestingScored = 16
// A score counts a code point when it is at or after the first error and one of its label's values is scored.
export const codePointScored = codePointKindScored | codePointNestingScored
// The bits of Samples.heldOut, per sample.
export const heldOutByKind = 1
export const heldOutByTemplate = 2

// The test split is for final numbers only, and so are the four kinds of damage and the template that are held out,
// which only samples of the test split have. Nothing in learn/ makes, loads or scores a test sample unless the
// environment variable RECOVERY_FINAL is `yes`. Three scripts are meant to run so: arms/final.ts, and final/run.ts
// and final/show.ts of the final scoring.
export const finalIsAllowed = () => process.env['RECOVERY_FINAL'] === 'yes'
export function requireFinal(what: string) {
  if (!finalIsAllowed()) throw new Error(`${what} reads the test split, which is for final numbers only. Nothing in learn/ reads it unless the environment variable RECOVERY_FINAL is set to yes, see arms/README.md.`)
}

// The dataset's sample `index` of `seed`, or undefined when the sample is in the test split and RECOVERY_FINAL is not
// `yes`. Every script of learn/ makes its samples through this function or through loadSamples, and none calls
// sampleAt of the dataset itself: check-guard.ts checks that.
export function allowedSampleAt(seed: number, index: number): Sample | undefined {
  const sample = sampleAt(seed, index)
  if (sample.heldOut.length > 0 && sample.split !== 'test') throw new Error(`sample ${sample.id} is held out and in the ${sample.split} split`)
  return sample.split === 'test' && !finalIsAllowed() ? undefined : sample
}

export type Samples = {
  seed: number
  // A hash of the source files that decide what the samples are, see datasetKey. Two sets with the same key and the
  // same indexes hold the same samples.
  datasetKey: string
  // True when the set holds the samples of the test split too. Only loadSamples with `withTest` makes such a set.
  withTest: boolean
  sampleCount: number
  codePointCount: number
  // The kinds of damage and their families, as numbers: Samples.kindList holds indexes into kindNames, kindFamily[kind]
  // is an index into familyNames, and bit f of Samples.families stands for familyNames[f].
  kindNames: string[]
  kindFamily: number[]
  familyNames: string[]

  // One entry per sample. A sample's place is its entry in these arrays, which is not its index in the dataset, since
  // the samples of the test split are left out.
  // The sample's index in the dataset: sampleAt(seed, index[place]) makes it again.
  index: Int32Array
  // The code points of the sample at place p are the entries start[p] to start[p + 1] - 1 of the arrays per code
  // point. One more entry than samples.
  start: Int32Array
  // The index in the broken text of the first damaged code point, the text's length when only the original's end is
  // missing, and -1 in a valid sample.
  firstDamage: Int32Array
  // Where today's parser reports its first error, and the error's kind, as the sample has them. -1 and 0 in a valid
  // sample. It is never before firstDamage. Scores count the code points from this position on.
  firstErrorPosition: Int32Array
  firstErrorKind: Uint8Array
  // Indexes into splitNames (train, validation, test), sourceNames (valid, damage, typing), reachableNames and
  // groupNames. The group of a valid sample means nothing.
  split: Uint8Array
  source: Uint8Array
  reachable: Uint8Array
  group: Uint8Array
  // 1 when the recovery must tell apart characters that the highlighter's classes lump with letters.
  needsClass: Uint8Array
  // The dataset's two proofs about the plain table parser, see ../limits.ts: 1 when no run of that parser has every
  // scored depth and container right, and 1 when none has every scored display kind right.
  needsNestingFix: Uint8Array
  needsDisplayFix: Uint8Array
  // 1 when another sensible repair would give other labels.
  debatable: Uint8Array
  // 1 when the lines of the original end with a carriage return and a line feed.
  carriageReturns: Uint8Array
  // heldOutByKind when the sample has a kind that training never sees, heldOutByTemplate for the template, or both.
  // Always 0 in a set without the test split.
  heldOut: Uint8Array
  // One bit per family that the sample's kinds have.
  families: Uint16Array
  // How many code points a score counts in the sample, see scoredCodePoints in ../samples.ts: the ones from the
  // first error on whose label has a scored value. 0 means that nothing is left to recover.
  scored: Int32Array
  // The most of those code points that one run of the plain table parser can have right, see mostRightFor in
  // ../samples.ts. It is a bound for the loop of ../table-parser.ts, whose depth follows the tokenizer's events. The
  // parser of this experiment has a stack action per grammar cell and a real stack, so the bound does not hold for it.
  mostRight: Int32Array
  // The kinds of the sample at place p are kindList[kindStart[p]] to kindList[kindStart[p + 1] - 1].
  kindStart: Int32Array
  kindList: Uint8Array

  // One entry per code point of the broken texts.
  codePoints: Int32Array
  // codePointKept when the damage kept the code point. codePointKindScored when the display kind of its label is
  // scored, codePointNestingScored when the depth and the container are. codePointReplaced when it stands for another
  // code point, e.g. ' for ". codePointCanFollow when a parser of the broken text can be in the intended state after it.
  flags: Uint8Array
  // The label: the display kind, the depth after the code point and the innermost container after it, as they are
  // for the counterpart in the original. -1 where the value is not scored, and in all three where the damage added
  // the code point.
  labelKind: Int8Array
  labelDepth: Int8Array
  labelContainer: Int8Array
  // The intended states, see intended.ts: the tokenizer state after, the event, the grammar state after, the depth
  // after and the container after, as today's parser has them at the counterpart in the original. -1 without a
  // counterpart. The depth and the container are there at every kept code point, also where the label's are not
  // scored. Use the intended states only where flags has codePointCanFollow: elsewhere they can be states that a
  // parser of the broken text is never in, e.g. after a removed comma.
  intendedLexerAfter: Int8Array
  intendedEvent: Int8Array
  intendedGrammarAfter: Int8Array
  intendedDepthAfter: Int8Array
  intendedContainerAfter: Int8Array
}

type TypedArray = Int32Array | Int8Array | Uint8Array | Uint16Array
const perSampleFields = [
  'index', 'firstDamage', 'firstErrorPosition', 'firstErrorKind', 'split', 'source', 'reachable', 'group', 'needsClass', 'needsNestingFix', 'needsDisplayFix', 'debatable', 'carriageReturns', 'heldOut',
  'families', 'scored', 'mostRight',
] as const
const perCodePointFields = ['codePoints', 'flags', 'labelKind', 'labelDepth', 'labelContainer', 'intendedLexerAfter', 'intendedEvent', 'intendedGrammarAfter', 'intendedDepthAfter', 'intendedContainerAfter'] as const
const arrayFields = [...perSampleFields, ...perCodePointFields, 'start', 'kindStart', 'kindList'] as const
const arrayTypes = {Int32Array, Int8Array, Uint8Array, Uint16Array}

const kindNames = kinds.map(kind => kind.name)
const familyNames: string[] = [...families]
const kindFamily = kinds.map(kind => familyNames.indexOf(kind.family))

// The dataset's key and the cache's key are in dataset-key.ts: hashes of the source files that decide what the
// samples are, and what these arrays hold. A record of a run and every saved file of tables hold the dataset's key.
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

// Makes the samples with the indexes `from` to `to - 1`, without the ones of the test split, or with them when
// `withTest` is true, which needs RECOVERY_FINAL. One sample takes about half a millisecond.
export function makeSamples(seed: number, from: number, to: number, withTest = false): Samples {
  if (withTest) requireFinal('makeSamples with the test split')
  const int32 = () => growing(length => new Int32Array(length))
  const int8 = () => growing(length => new Int8Array(length))
  const uint8 = () => growing(length => new Uint8Array(length))
  const uint16 = () => growing(length => new Uint16Array(length))
  const perSample = {
    index: int32(), firstDamage: int32(), firstErrorPosition: int32(), firstErrorKind: uint8(), split: uint8(), source: uint8(), reachable: uint8(), group: uint8(), needsClass: uint8(),
    needsNestingFix: uint8(), needsDisplayFix: uint8(), debatable: uint8(), carriageReturns: uint8(), heldOut: uint8(), families: uint16(), scored: int32(), mostRight: int32(),
  }
  const start = int32()
  const kindStart = int32()
  const kindList = uint8()
  const codePoints = int32()
  const flags = uint8()
  const labelKind = int8()
  const labelDepth = int8()
  const labelContainer = int8()
  const intendedLexerAfter = int8()
  const intendedEvent = int8()
  const intendedGrammarAfter = int8()
  const intendedDepthAfter = int8()
  const intendedContainerAfter = int8()
  let sampleCount = 0
  let codePointCount = 0
  let kindCount = 0
  start.push(0)
  kindStart.push(0)
  for (let index = from; index < to; index++) {
    const sample: Sample = sampleAt(seed, index)
    if (sample.heldOut.length > 0 && sample.split !== 'test') throw new Error(`sample ${sample.id} is held out and in the ${sample.split} split`)
    if (sample.split === 'test' && !withTest) continue
    const valid = sample.source === 'valid'
    const labels = labelsOf(sample)
    perSample.index.push(index)
    perSample.firstDamage.push(sample.firstDamage)
    perSample.firstErrorPosition.push(valid ? -1 : sample.firstErrorPosition)
    perSample.firstErrorKind.push(valid ? 0 : sample.firstErrorKind)
    perSample.split.push(splitNames.indexOf(sample.split))
    perSample.source.push(sourceNames.indexOf(sample.source))
    perSample.reachable.push(reachableNames.indexOf(sample.reachable))
    perSample.group.push(groupNames.indexOf(groupOf(sample)))
    perSample.needsClass.push(Number(sample.needsClass.length > 0))
    perSample.needsNestingFix.push(Number(sample.needsNestingFix))
    perSample.needsDisplayFix.push(Number(sample.needsDisplayFix))
    perSample.debatable.push(Number(sample.debatable))
    perSample.carriageReturns.push(Number(sample.lineEnd === '\r\n'))
    perSample.heldOut.push((sample.heldOut.some(reason => reason.startsWith('kind: ')) ? heldOutByKind : 0) | (sample.heldOut.some(reason => reason.startsWith('template: ')) ? heldOutByTemplate : 0))
    let familyBits = 0
    for (const kind of sample.kinds) {
      const kindIndex = kindNames.indexOf(kind)
      if (kindIndex === -1) throw new Error(`sample ${sample.id} has the kind ${kind}, which damage.ts does not list`)
      kindList.push(kindIndex)
      kindCount++
      familyBits |= 1 << kindFamily[kindIndex]!
    }
    perSample.families.push(familyBits)
    kindStart.push(kindCount)
    const scored = valid ? 0 : scoredCodePoints(sample, labels)
    const bound = valid ? {right: 0, counted: 0} : mostRightFor(sample, labels)
    if (bound.counted !== scored) throw new Error(`sample ${sample.id}: scoredCodePoints counts ${scored} code points, and mostRightFor ${bound.counted}`)
    perSample.scored.push(scored)
    perSample.mostRight.push(bound.right)

    const intended = intendedOf(sample)
    const brokenCodePoints = Array.from(sample.broken, character => character.codePointAt(0)!)
    if (brokenCodePoints.length !== sample.alignment.length) throw new Error(`sample ${sample.id}: the broken text has ${brokenCodePoints.length} code points, and its alignment ${sample.alignment.length}`)
    for (let position = 0; position < brokenCodePoints.length; position++) {
      const label = labels[position]
      if (label !== undefined && (label.depth === undefined) !== (label.container === undefined)) throw new Error(`sample ${sample.id}, code point ${position}: the depth and the container are not scored together`)
      codePoints.push(brokenCodePoints[position]!)
      flags.push((label === undefined ? 0 : codePointKept) | (label?.kind === undefined ? 0 : codePointKindScored) | (label?.depth === undefined ? 0 : codePointNestingScored)
        | (sample.replaced[position] === true ? codePointReplaced : 0) | (intended.canFollow[position] === 1 ? codePointCanFollow : 0))
      labelKind.push(label?.kind ?? -1)
      labelDepth.push(label?.depth ?? -1)
      labelContainer.push(label?.container ?? -1)
      // The labels come from a scan of the original with a stack, and the intended depth and container from the
      // parser's trace on the original, so where a label's are scored they have to be the same numbers.
      if (label?.depth !== undefined && (label.depth !== intended.depthAfter[position] || label.container !== intended.containerAfter[position])) {
        throw new Error(`sample ${sample.id}, code point ${position}: the label says depth ${label.depth} and container ${label.container}, and the parser's trace on the original ${intended.depthAfter[position]} and ${intended.containerAfter[position]}`)
      }
      intendedLexerAfter.push(intended.lexerStateAfter[position]!)
      intendedEvent.push(intended.event[position]!)
      intendedGrammarAfter.push(intended.grammarAfter[position]!)
      intendedDepthAfter.push(intended.depthAfter[position]!)
      intendedContainerAfter.push(intended.containerAfter[position]!)
    }
    codePointCount += brokenCodePoints.length
    start.push(codePointCount)
    sampleCount++
  }
  return {
    seed, datasetKey: datasetKey(), withTest, sampleCount, codePointCount, kindNames, kindFamily, familyNames,
    index: perSample.index.done(), firstDamage: perSample.firstDamage.done(), firstErrorPosition: perSample.firstErrorPosition.done(), firstErrorKind: perSample.firstErrorKind.done(),
    split: perSample.split.done(), source: perSample.source.done(), reachable: perSample.reachable.done(), group: perSample.group.done(), needsClass: perSample.needsClass.done(),
    needsNestingFix: perSample.needsNestingFix.done(), needsDisplayFix: perSample.needsDisplayFix.done(), debatable: perSample.debatable.done(), carriageReturns: perSample.carriageReturns.done(),
    heldOut: perSample.heldOut.done(), families: perSample.families.done(), scored: perSample.scored.done(), mostRight: perSample.mostRight.done(),
    start: start.done(), kindStart: kindStart.done(), kindList: kindList.done(),
    codePoints: codePoints.done(), flags: flags.done(), labelKind: labelKind.done(), labelDepth: labelDepth.done(), labelContainer: labelContainer.done(),
    intendedLexerAfter: intendedLexerAfter.done(), intendedEvent: intendedEvent.done(), intendedGrammarAfter: intendedGrammarAfter.done(),
    intendedDepthAfter: intendedDepthAfter.done(), intendedContainerAfter: intendedContainerAfter.done(),
  }
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
// The parts of a set. The test part is for final numbers only: it needs RECOVERY_FINAL and a set that was loaded
// with the test split.
export const trainPart = (samples: Samples) => selectSamples(samples, placesOfSplit(samples, 'train'))
export const validationPart = (samples: Samples) => selectSamples(samples, placesOfSplit(samples, 'validation'))
export const testPart = (samples: Samples) => selectSamples(samples, placesOfSplit(samples, 'test'))

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
  kindNames: string[], kindFamily: number[], familyNames: string[], sections: {field: string, type: string, length: number, offset: number}[],
}
const cacheFormat = 'recovery samples 2'
const align = (offset: number) => Math.ceil(offset / 8) * 8

function writeCache(path: string, samples: Samples, from: number, to: number) {
  const header: CacheHeader = {
    format: cacheFormat, cacheKey: cacheKey(), datasetKey: samples.datasetKey, withTest: samples.withTest, seed: samples.seed, from, to, sampleCount: samples.sampleCount, codePointCount: samples.codePointCount,
    kindNames: samples.kindNames, kindFamily: samples.kindFamily, familyNames: samples.familyNames, sections: [],
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
    kindNames: header.kindNames, kindFamily: header.kindFamily, familyNames: header.familyNames, ...arrays,
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

// The samples with the indexes `from` to `to - 1` of a seed that are not in the test split. With a cache folder: read
// from the folder's file of that range, or from its file of a range around it, e.g. the samples 0 to 19,999 from the
// file of the standard set, and otherwise made and written to the folder. With `null` as the cache folder the samples
// are made each time. Without the argument, the cache folder is the one of the environment variable RECOVERY_SCRATCH,
// so only `null` switches the cache off.
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

export const loadStandardSamples = (cacheFolder: string | null = cacheFolderOf()) => loadSamples(standardRange.seed, standardRange.from, standardRange.to, cacheFolder)

// Throws when a command got an option that it does not have, e.g. `mistakes.ts --split test`: a command that
// ignores an option runs as if the option were not there, and its output is then read as if it were. `known` are the
// command's options, e.g. ['--tables', '--count'].
export function refuseUnknownOptions(command: string, known: readonly string[], argv: readonly string[] = process.argv.slice(2)) {
  for (const argument of argv) {
    if (argument.startsWith('--') && !known.includes(argument)) throw new Error(`${command} has no option ${argument}. ${known.length === 0 ? 'It takes no option.' : `Its options: ${known.join(', ')}.`}`)
  }
}

// The value of a command's option, e.g. optionOf('--split') for `--split validation`.
export function optionOf(name: string, argv: readonly string[] = process.argv): string | undefined {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}

// The splits that a command's --split names, e.g. ['train', 'validation'] for `--split train,validation`. Without
// the option, the validation split. The test split is refused, with or without RECOVERY_FINAL: the commands load no
// test sample. Only arms/final.ts and final/run.ts score the test split, and final/show.ts shows samples of it.
export function splitsOfOption(command: string, argv: readonly string[] = process.argv): Split[] {
  const named = (optionOf('--split', argv) ?? 'validation').split(',') as Split[]
  for (const split of named) {
    if (split === 'test') throw new Error(`${command} --split test: this command does not read the test split, which is for final numbers only. Only arms/final.ts and the scripts of final/ read it, see arms/README.md and final/README.md.`)
    if (!splitNames.includes(split)) throw new Error(`--split takes train or validation, or both with a comma, and got ${split}`)
  }
  return named
}

if (import.meta.main) {
  refuseUnknownOptions('data.ts', ['--scratch', '--from', '--to', '--seed'])
  const seed = Number(optionOf('--seed') ?? standardRange.seed)
  const from = Number(optionOf('--from') ?? standardRange.from)
  const to = Number(optionOf('--to') ?? standardRange.to)
  const cacheFolder = cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH'])
  const started = performance.now()
  const samples = loadSamples(seed, from, to, cacheFolder)
  const seconds = ((performance.now() - started) / 1000).toFixed(2)
  const tally = (values: Uint8Array, names: readonly string[], counted: (place: number) => boolean = () => true) =>
    names.map((name, value) => `${name} ${values.reduce((total, entry, place) => total + Number(entry === value && counted(place)), 0)}`).filter(text => !text.endsWith(' 0')).join(', ')
  const broken = (place: number) => samples.firstDamage[place] !== -1
  const brokenCount = samples.firstDamage.reduce((total, firstDamage) => total + Number(firstDamage !== -1), 0)
  const scored = samples.scored.reduce((total, count) => total + count, 0)
  const mostRight = samples.mostRight.reduce((total, count) => total + count, 0)
  console.log(`Dataset ${samples.datasetKey}, seed ${seed}, the samples with the indexes ${from} to ${to - 1} that are not in the test split: ${samples.sampleCount} samples and ${samples.codePointCount} code points in ${seconds} s${cacheFolder === null ? ', without a cache' : `, cache in ${cacheFolder}`}`)
  console.log(`splits: ${tally(samples.split, splitNames)}`)
  console.log(`sources: ${tally(samples.source, sourceNames)}`)
  console.log(`groups of the ${brokenCount} broken samples: ${tally(samples.group, groupNames, broken)}`)
  console.log(`${samples.scored.reduce((total, count, place) => total + Number(broken(place) && count === 0), 0)} broken samples have nothing to recover. The others have ${scored} scored code points, and the plain table parser can have at most ${mostRight} of them right (${(100 * mostRight / scored).toFixed(2)}%).`)
  console.log(`${samples.carriageReturns.reduce((total, bit) => total + bit, 0)} samples have line ends with a carriage return.`)
  // A sample has the split of its original document, by the document's tokens (../splits.ts), so two documents of
  // two splits can end as the same short broken text, e.g. `0.` or `{...}`.
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
