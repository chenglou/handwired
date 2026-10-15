// The dataset in typed arrays, for loops over many samples: loadSamples(seed, from, to) makes the samples once and
// holds their code points, labels and intended states in flat arrays, and what is known per sample in arrays with one
// entry per sample. With a cache folder, a later process reads the arrays from a file in well under a second.
//
// Run from the repo root to make the cache of the standard set and print what it holds:
//   bun lab/recovery-parser/learn/data.ts [--scratch <folder>] [--from 0] [--to 60000] [--seed 20261015]
// Without --scratch, the folder is the environment variable RECOVERY_SCRATCH. The cache file goes to <folder>/cache.
import {mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {families, kinds} from '../damage.ts'
import {type Sample, type Split, defaultSeed, labelsOf, sampleAt, sources, splits} from '../samples.ts'
import {intendedOf} from './intended.ts'

// The standard set of the experiment: the samples 0 to 59,999 of the default seed. `to` is the first index left out.
export const standardRange = {seed: defaultSeed, from: 0, to: 60_000} as const

export const splitNames: readonly Split[] = splits
export const sourceNames: readonly string[] = sources
export const reachableNames = ['yes', 'line rule', 'no'] as const
// The bits of Samples.flags, per code point.
export const codePointLabeled = 1
export const codePointKindScored = 2
export const codePointReplaced = 4
// The bits of Samples.heldOut, per sample.
export const heldOutByKind = 1
export const heldOutByTemplate = 2

export type Samples = {
  seed: number
  sampleCount: number
  codePointCount: number
  // The kinds of damage and their families, as numbers: Samples.kindList holds indexes into kindNames, kindFamily[kind]
  // is an index into familyNames, and bit f of Samples.families stands for familyNames[f].
  kindNames: string[]
  kindFamily: number[]
  familyNames: string[]

  // One entry per sample.
  // The sample's index in the dataset: sampleAt(seed, index[sample]) makes it again.
  index: Int32Array
  // The code points of sample s are the entries start[s] to start[s + 1] - 1 of the arrays per code point. One more
  // entry than samples.
  start: Int32Array
  // The index in the broken text of the first damaged code point, the text's length when only the original's end is
  // missing, and -1 in a valid sample. Scores count the labeled code points from this index on.
  firstDamage: Int32Array
  // Where today's parser reports its first error, and the error's kind, as the sample has them. -1 and 0 in a valid sample.
  firstErrorPosition: Int32Array
  firstErrorKind: Uint8Array
  // Indexes into splitNames (train, validation, test), sourceNames (valid, damage, typing) and reachableNames.
  split: Uint8Array
  source: Uint8Array
  reachable: Uint8Array
  // 1 when the recovery must tell apart characters that the highlighter's classes lump with letters.
  needsClass: Uint8Array
  // 1 when another sensible repair would give other labels.
  debatable: Uint8Array
  // heldOutByKind when the sample has a kind that training never sees, heldOutByTemplate for the template, or both.
  heldOut: Uint8Array
  // One bit per family that the sample's kinds have.
  families: Uint16Array
  // The kinds of sample s are kindList[kindStart[s]] to kindList[kindStart[s + 1] - 1].
  kindStart: Int32Array
  kindList: Uint8Array

  // One entry per code point of the broken texts.
  codePoints: Int32Array
  // codePointLabeled when the code point has a label, i.e. the damage kept it: its depth and container are scored.
  // codePointKindScored when its display kind is scored too. codePointReplaced when it stands for another code point,
  // e.g. ' for ".
  flags: Uint8Array
  // The label: the display kind, the depth after the code point and the innermost container after it, as they are
  // for the counterpart in the original. -1 without a label, and labelKind is -1 too where the kind is not scored.
  labelKind: Int8Array
  labelDepth: Int8Array
  labelContainer: Int8Array
  // The intended states, see intended.ts: the tokenizer state after, the event and the grammar state after. -1 without
  // a counterpart. The intended depth and container after are labelDepth and labelContainer.
  intendedLexerAfter: Int8Array
  intendedEvent: Int8Array
  intendedGrammarAfter: Int8Array
}

type TypedArray = Int32Array | Int8Array | Uint8Array | Uint16Array
const perSampleFields = ['index', 'firstDamage', 'firstErrorPosition', 'firstErrorKind', 'split', 'source', 'reachable', 'needsClass', 'debatable', 'heldOut', 'families'] as const
const perCodePointFields = ['codePoints', 'flags', 'labelKind', 'labelDepth', 'labelContainer', 'intendedLexerAfter', 'intendedEvent', 'intendedGrammarAfter'] as const
const arrayFields = [...perSampleFields, ...perCodePointFields, 'start', 'kindStart', 'kindList'] as const
const arrayTypes = {Int32Array, Int8Array, Uint8Array, Uint16Array}

const kindNames = kinds.map(kind => kind.name)
const familyNames: string[] = [...families]
const kindFamily = kinds.map(kind => familyNames.indexOf(kind.family))

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

// Makes the samples from `from` to `to - 1`. One sample takes about half a millisecond.
export function makeSamples(seed: number, from: number, to: number): Samples {
  const sampleCount = to - from
  const int32 = () => growing(length => new Int32Array(length))
  const int8 = () => growing(length => new Int8Array(length))
  const uint8 = () => growing(length => new Uint8Array(length))
  const perSample = {
    index: new Int32Array(sampleCount), start: new Int32Array(sampleCount + 1), firstDamage: new Int32Array(sampleCount), firstErrorPosition: new Int32Array(sampleCount),
    firstErrorKind: new Uint8Array(sampleCount), split: new Uint8Array(sampleCount), source: new Uint8Array(sampleCount), reachable: new Uint8Array(sampleCount),
    needsClass: new Uint8Array(sampleCount), debatable: new Uint8Array(sampleCount), heldOut: new Uint8Array(sampleCount), families: new Uint16Array(sampleCount),
    kindStart: new Int32Array(sampleCount + 1),
  }
  const kindList = uint8()
  const codePoints = int32()
  const flags = uint8()
  const labelKind = int8()
  const labelDepth = int8()
  const labelContainer = int8()
  const intendedLexerAfter = int8()
  const intendedEvent = int8()
  const intendedGrammarAfter = int8()
  let codePointCount = 0
  let kindCount = 0
  for (let at = 0; at < sampleCount; at++) {
    const sample: Sample = sampleAt(seed, from + at)
    const valid = sample.source === 'valid'
    perSample.index[at] = from + at
    perSample.firstDamage[at] = sample.firstDamage
    perSample.firstErrorPosition[at] = valid ? -1 : sample.firstErrorPosition
    perSample.firstErrorKind[at] = valid ? 0 : sample.firstErrorKind
    perSample.split[at] = splitNames.indexOf(sample.split)
    perSample.source[at] = sourceNames.indexOf(sample.source)
    perSample.reachable[at] = reachableNames.indexOf(sample.reachable)
    perSample.needsClass[at] = Number(sample.needsClass.length > 0)
    perSample.debatable[at] = Number(sample.debatable)
    perSample.heldOut[at] = (sample.heldOut.some(reason => reason.startsWith('kind: ')) ? heldOutByKind : 0) | (sample.heldOut.some(reason => reason.startsWith('template: ')) ? heldOutByTemplate : 0)
    for (const kind of sample.kinds) {
      const kindIndex = kindNames.indexOf(kind)
      if (kindIndex === -1) throw new Error(`sample ${sample.id} has the kind ${kind}, which damage.ts does not list`)
      kindList.push(kindIndex)
      kindCount++
      perSample.families[at] = perSample.families[at]! | (1 << kindFamily[kindIndex]!)
    }
    perSample.kindStart[at + 1] = kindCount

    const labels = labelsOf(sample)
    const intended = intendedOf(sample)
    const brokenCodePoints = Array.from(sample.broken, character => character.codePointAt(0)!)
    if (brokenCodePoints.length !== sample.alignment.length) throw new Error(`sample ${sample.id}: the broken text has ${brokenCodePoints.length} code points, and its alignment ${sample.alignment.length}`)
    for (let position = 0; position < brokenCodePoints.length; position++) {
      const label = labels[position]
      codePoints.push(brokenCodePoints[position]!)
      flags.push((label === undefined ? 0 : codePointLabeled) | (label?.kind === undefined ? 0 : codePointKindScored) | (sample.replaced[position] === true ? codePointReplaced : 0))
      labelKind.push(label?.kind ?? -1)
      labelDepth.push(label?.depth ?? -1)
      labelContainer.push(label?.container ?? -1)
      // The intended depth and container are kept once, as the labels. Both come from the original, the labels from a
      // scan with a stack and the intended ones from the parser's trace, so they have to be the same numbers.
      if (label !== undefined && (label.depth !== intended.depthAfter[position] || label.container !== intended.containerAfter[position])) {
        throw new Error(`sample ${sample.id}, code point ${position}: the label says depth ${label.depth} and container ${label.container}, and the parser's trace on the original ${intended.depthAfter[position]} and ${intended.containerAfter[position]}`)
      }
      intendedLexerAfter.push(intended.lexerStateAfter[position]!)
      intendedEvent.push(intended.event[position]!)
      intendedGrammarAfter.push(intended.grammarAfter[position]!)
    }
    codePointCount += brokenCodePoints.length
    perSample.start[at + 1] = codePointCount
  }
  return {
    seed, sampleCount, codePointCount, kindNames, kindFamily, familyNames, ...perSample, kindList: kindList.done(),
    codePoints: codePoints.done(), flags: flags.done(), labelKind: labelKind.done(), labelDepth: labelDepth.done(), labelContainer: labelContainer.done(),
    intendedLexerAfter: intendedLexerAfter.done(), intendedEvent: intendedEvent.done(), intendedGrammarAfter: intendedGrammarAfter.done(),
  }
}

// The samples at the given places of `samples`, in the given order, as a set of their own. E.g. the validation part.
export function selectSamples(samples: Samples, places: ArrayLike<number>): Samples {
  const sampleCount = places.length
  let codePointCount = 0
  let kindCount = 0
  for (let at = 0; at < sampleCount; at++) {
    const place = places[at]!
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
  const wanted = splitNames.indexOf(split)
  return Int32Array.from({length: samples.sampleCount}, (_, place) => place).filter(place => samples.split[place] === wanted)
}
// The parts of a set. The test part is for final numbers only: nothing that chooses between tables may read it.
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

// A hash of every source file that decides what the samples are: the dataset's modules, the highlighter's tables, the
// reference highlighter, and this file with intended.ts. A cache file made from other sources is made again.
function sourcesHash() {
  const folder = resolve(import.meta.dir, '..')
  const root = resolve(folder, '../..')
  const files = [
    ...readdirSync(folder).filter(name => name.endsWith('.ts')).map(name => join(folder, name)),
    ...readdirSync(join(folder, 'damage')).filter(name => name.endsWith('.ts')).map(name => join(folder, 'damage', name)),
    join(root, 'src/json-search/highlighter/kinds.ts'), join(root, 'src/json-search/highlighter/tables.ts'), join(root, 'tests/json-search/highlighter/reference.ts'),
    join(import.meta.dir, 'data.ts'), join(import.meta.dir, 'intended.ts'),
  ].sort()
  return Bun.hash(files.map(file => Bun.hash(readFileSync(file)).toString(16)).join('.')).toString(16)
}

type CacheHeader = {
  format: string, sourcesHash: string, seed: number, from: number, to: number, sampleCount: number, codePointCount: number,
  kindNames: string[], kindFamily: number[], familyNames: string[], sections: {field: string, type: string, length: number, offset: number}[],
}
const cacheFormat = 'recovery samples 1'
const align = (offset: number) => Math.ceil(offset / 8) * 8

function writeCache(path: string, samples: Samples, from: number, to: number) {
  const header: CacheHeader = {
    format: cacheFormat, sourcesHash: sourcesHash(), seed: samples.seed, from, to, sampleCount: samples.sampleCount, codePointCount: samples.codePointCount,
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

// The samples of a cache file, or undefined when the file was made from other sources or in another format.
function readCache(path: string): {samples: Samples, from: number, to: number} | undefined {
  const file = readFileSync(path)
  // The arrays are views of the file's bytes, which have to start at a multiple of 8 for that.
  const buffer = file.byteOffset % 8 === 0 ? file.buffer : file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  const base = file.byteOffset % 8 === 0 ? file.byteOffset : 0
  const headerLength = new DataView(buffer, base, 8).getUint32(0, true)
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, base + 8, headerLength))) as CacheHeader
  if (header.format !== cacheFormat || header.sourcesHash !== sourcesHash()) return undefined
  const bodyStart = base + align(8 + headerLength)
  const arrays: Record<string, TypedArray> = {}
  for (const section of header.sections) {
    const type = arrayTypes[section.type as keyof typeof arrayTypes]
    arrays[section.field] = new type(buffer, bodyStart + section.offset, section.length)
  }
  if (arrayFields.some(field => arrays[field] === undefined)) return undefined
  const samples = {
    seed: header.seed, sampleCount: header.sampleCount, codePointCount: header.codePointCount,
    kindNames: header.kindNames, kindFamily: header.kindFamily, familyNames: header.familyNames, ...arrays,
  } as unknown as Samples
  return {samples, from: header.from, to: header.to}
}

const cacheFileName = (seed: number, from: number, to: number) => `samples-${seed}-${from}-${to}.bin`

// The cache folder of a scratch folder, or undefined without one. The scratch folder comes from the argument, or from
// the environment variable RECOVERY_SCRATCH.
export function cacheFolderOf(scratchFolder: string | undefined = process.env['RECOVERY_SCRATCH']) {
  return scratchFolder === undefined || scratchFolder === '' ? undefined : join(scratchFolder, 'cache')
}

// The samples `from` to `to - 1` of a seed. With a cache folder: read from the folder's file of that range, or from
// its file of a range around it, e.g. the samples 0 to 19,999 from the file of the standard set, and otherwise made
// and written to the folder. Without a cache folder the samples are made each time.
export function loadSamples(seed: number, from: number, to: number, cacheFolder: string | undefined = cacheFolderOf()): Samples {
  if (cacheFolder === undefined) return makeSamples(seed, from, to)
  mkdirSync(cacheFolder, {recursive: true})
  const covering = readdirSync(cacheFolder).flatMap(name => {
    const match = /^samples-(\d+)-(\d+)-(\d+)\.bin$/.exec(name)
    if (match === null || Number(match[1]) !== seed || Number(match[2]) > from || Number(match[3]) < to) return []
    return [{name, from: Number(match[2]), to: Number(match[3])}]
  }).sort((left, right) => (left.to - left.from) - (right.to - right.from))
  for (const candidate of covering) {
    const cached = readCache(join(cacheFolder, candidate.name))
    if (cached === undefined || cached.from !== candidate.from || cached.to !== candidate.to) continue
    if (candidate.from === from && candidate.to === to) return cached.samples
    return selectSamples(cached.samples, Int32Array.from({length: to - from}, (_, at) => from - candidate.from + at))
  }
  const samples = makeSamples(seed, from, to)
  writeCache(join(cacheFolder, cacheFileName(seed, from, to)), samples, from, to)
  return samples
}

export const loadStandardSamples = (cacheFolder: string | undefined = cacheFolderOf()) => loadSamples(standardRange.seed, standardRange.from, standardRange.to, cacheFolder)

// The value of a command's option, e.g. optionOf('--split') for `--split validation`.
export function optionOf(name: string, argv: readonly string[] = process.argv): string | undefined {
  const at = argv.indexOf(name)
  return at === -1 ? undefined : argv[at + 1]
}

if (import.meta.main) {
  const seed = Number(optionOf('--seed') ?? standardRange.seed)
  const from = Number(optionOf('--from') ?? standardRange.from)
  const to = Number(optionOf('--to') ?? standardRange.to)
  const cacheFolder = cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH'])
  const started = performance.now()
  const samples = loadSamples(seed, from, to, cacheFolder)
  const seconds = ((performance.now() - started) / 1000).toFixed(2)
  const tally = (values: Uint8Array, names: readonly string[]) => names.map((name, value) => `${name} ${values.reduce((total, entry) => total + Number(entry === value), 0)}`).join(', ')
  console.log(`seed ${seed}, samples ${from} to ${to - 1}: ${samples.sampleCount} samples and ${samples.codePointCount} code points in ${seconds} s${cacheFolder === undefined ? ', without a cache' : `, cache in ${cacheFolder}`}`)
  console.log(`splits: ${tally(samples.split, splitNames)}`)
  console.log(`sources: ${tally(samples.source, sourceNames)}`)
  console.log(`reachable, with the valid samples under yes: ${tally(samples.reachable, reachableNames)}`)
  console.log(`held out by a kind: ${samples.heldOut.reduce((total, bits) => total + Number((bits & heldOutByKind) !== 0), 0)}, by the template: ${samples.heldOut.reduce((total, bits) => total + Number((bits & heldOutByTemplate) !== 0), 0)}`)
}
