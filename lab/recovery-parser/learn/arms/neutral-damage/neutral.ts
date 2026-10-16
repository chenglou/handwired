// The neutral set: train samples whose damage knows nothing of JSON, in the arrays of ../../data.ts, which is the
// form that the trainer, the search and the count take. README.md says what the damage is and what it is for.
//
// A neutral sample is the original of a broken train sample of the standard set with one to three edits of
// neutral-edits.ts. neutralSampleAt(seed, index) makes sample `index` without the ones before it. Its labels follow
// the dataset: a kept code point has the label of its counterpart in the original, an added one has none, and what
// is not scored is decided by the dataset's rules, see unscoredOf.
//
// Run from the repo root to make the set and its cache file, and to print what it holds:
//   bun lab/recovery-parser/learn/arms/neutral-damage/neutral.ts [--seed 20261016] [--count <samples>]
// The cache file goes to <RECOVERY_SCRATCH>/neutral-damage/cache.
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {families, kinds} from '../../../damage.ts'
import type {Style} from '../../../documents.ts'
import {type Edit, applyEdits, canonicalEdits, insertAt, mergeEdits, removeRange} from '../../../edits.ts'
import {type ValidLabel, displayKind, labelsOfValidText} from '../../../labels.ts'
import {limitsOf, readsAsNumberOrLiteral} from '../../../limits.ts'
import {createRandom} from '../../../random.ts'
import {type Sample, groupOf, heldOutTemplate, labelsOf, mostRightFor, scoredCodePoints, splitOf} from '../../../samples.ts'
import {type ParserTrace, capacity, maximumDepth, runTableParser} from '../../../table-parser.ts'
import {
  type Samples, allowedSampleAt, codePointCanFollow, codePointKept, codePointKindScored, codePointNestingScored, codePointReplaced, groupNames, loadStandardSamples, optionOf, reachableNames,
  refuseUnknownOptions, sourceNames, splitNames, standardRange,
} from '../../data.ts'
import {cacheKey, datasetKey} from '../../dataset-key.ts'
import {intendedOf} from '../../intended.ts'
import {type AppliedNeutralEdit, type DamagedText, drawNeutralDamage, neutralEditNames} from './neutral-edits.ts'

// The seed of the neutral set. It is another seed than the standard set's, so that no stream of random numbers is
// the stream of a sample of the dataset.
export const neutralSeed = 20261016

// A valid document that the neutral damage is applied to.
export type OriginalDocument = {
  // The index in the dataset of the standard sample that the document is the original of.
  standardIndex: number
  text: string
  template: string
  style: Style
}

// The indexes in the dataset of the broken samples of the train split of the standard set, in the set's order.
// Their originals are the originals of the neutral set, one neutral sample per broken train sample, so the two sets
// have the same documents and the same number of broken samples: 40,457.
let knownIndexes: Int32Array | undefined
export function indexesOfTheOriginals(): Int32Array {
  if (knownIndexes === undefined) {
    const standard = loadStandardSamples()
    const train = splitNames.indexOf('train')
    knownIndexes = standard.index.filter((_, place) => standard.split[place] === train && standard.firstDamage[place] !== -1)
  }
  return knownIndexes
}

// The original of the broken train sample at `place` of indexesOfTheOriginals. Of a text of several documents, e.g.
// one document per line, it is the first document: several documents in one text are one of the dataset's kinds of
// damage, which the neutral set must not hold. Throws for a document that is not of the train split or that comes
// from the held-out template, which no train sample has.
export function originalAt(place: number): OriginalDocument {
  const standardIndex = indexesOfTheOriginals()[place]!
  const standardSample = allowedSampleAt(standardRange.seed, standardIndex)
  if (standardSample === undefined || standardSample.split !== 'train' || standardSample.heldOut.length > 0) throw new Error(`the sample ${standardIndex} of the standard set is no train sample`)
  const text = standardSample.documents[0]!
  if (splitOf(text) !== 'train' || standardSample.template === heldOutTemplate) throw new Error(`the first document of the sample ${standardIndex} of the standard set is not of the train split, or comes from the held-out template`)
  return {standardIndex, text, template: standardSample.template, style: standardSample.style}
}

// The edits that turn `original` into the damaged text, in the dataset's form (../../../edits.ts). Between two kept
// code points, what the neutral edits put there is one insertion and what they took away is one removal, the
// insertion first, as the dataset has it for e.g. a marker in the place of a span that was cut out. The dataset's
// canonicalEdits then moves every insertion and every removal to the right as far as the text stays the same, so of
// two equal code points the later one is the added or the removed one, e.g. after a `}` was inserted before a `}`.
//
// A copy of the text's start is an insertion after that start, as every copy is: the copy follows what it is a copy
// of. E.g. in `{"a":1}{"a":1}`, the only line duplicated, the first document is the kept one, and the sample is
// thrown away, since nothing is left to score. The dataset's rule "text before the whole original stays there" is
// for text that the damage put there, e.g. a log prefix, and here only a run that edit 7 copies to the very start
// is such a text.
function editsOf(original: readonly string[], text: DamagedText): Edit[] {
  const edits: Edit[] = []
  let nextOriginal = 0
  let added: string[] = []
  const closeGap = (keptIndex: number) => {
    if (keptIndex < nextOriginal) throw new Error('the kept code points of a damaged text are not in the order of the original')
    if (added.length > 0) edits.push(insertAt(nextOriginal, added.join('')))
    if (keptIndex > nextOriginal) edits.push(removeRange(nextOriginal, keptIndex))
    added = []
  }
  text.codePoints.forEach((codePoint, position) => {
    const origin = text.origin[position]!
    if (origin === -1) {
      added.push(codePoint)
      return
    }
    closeGap(origin)
    nextOriginal = origin + 1
  })
  closeGap(original.length)
  const merged = mergeEdits([edits], original.length)
  if (merged === undefined) throw new Error('the edits of a damaged text overlap')
  return canonicalEdits(original, merged)
}

// The label values that are not scored, as indexes into the original: the dataset's unscoredOf (../../../samples.ts),
// which that file does not export, copied here without a change of its rules. `declared` are the display kinds
// that a kind of the dataset's damage says no reading can give. The neutral damage declares none, and check.ts
// passes the list of a sample of the standard set. The three other rules:
// - Before the first error of the parser as it is, a value that the parser as it is does not give.
// - Where the labels' depth or container changes at a code point that is not a bracket, a bracket was removed before
//   it: from there to the next kept bracket the depth and the container are not scored.
// - A string value that lost its opening quote and stands after white space or punctuation: its first code points
//   that read as a number or a literal have a display kind that is not scored.
// check.ts compares the copy with the dataset's function on samples of the standard set, and holds every neutral
// sample against the dataset's second derivation (sampleProblems of ../../../check-samples.ts).
export function unscoredOf(original: readonly string[], broken: readonly string[], labels: readonly ValidLabel[], alignment: readonly number[], firstDamage: number, trace: ParserTrace, declared: readonly number[] = []) {
  const punctuation = displayKind.punctuation
  const kept = new Set(alignment)
  const kindsNotScored = new Set(declared.filter(index => kept.has(index)))
  const nestingNotScored = new Set<number>()
  for (let position = Math.max(0, firstDamage); position < Math.min(trace.firstErrorPosition, alignment.length); position++) {
    const index = alignment[position]!
    if (index === -1) continue
    const label = labels[index]!
    if (label.kind !== trace.displayKind[position]) kindsNotScored.add(index)
    if (label.depth !== trace.depthAfter[position] || label.container !== trace.containerAfter[position]) nestingNotScored.add(index)
  }
  for (let position = 0; position < alignment.length; position++) {
    const index = alignment[position]!
    if (index <= 0 || labels[index]!.kind !== displayKind.string) continue
    // The code point before it in the original is the value's opening quote, which is not in the broken text.
    if (original[index - 1] !== '"' || labels[index - 1]!.kind !== displayKind.string || kept.has(index - 1)) continue
    if (position > 0) {
      const before = alignment[position - 1]!
      if (before === -1 ? !' \t\r\n{}[]:,'.includes(broken[position - 1]!) : kindsNotScored.has(before) || (labels[before]!.kind !== displayKind.whitespace && labels[before]!.kind !== punctuation)) continue
    }
    const run = readsAsNumberOrLiteral(broken, position)
    for (let offset = 0; offset < run && alignment[position + offset] === index + offset && labels[index + offset]!.kind === displayKind.string; offset++) kindsNotScored.add(index + offset)
  }
  let previousDepth = 0
  let previousContainer = 0
  let afterRemovedBracket = false
  for (const index of alignment) {
    if (index === -1) continue
    const label = labels[index]!
    const isBracket = label.kind === punctuation && '{}[]'.includes(original[index]!)
    if (isBracket) afterRemovedBracket = false
    else if (label.depth !== previousDepth || label.container !== previousContainer) afterRemovedBracket = true
    if (afterRemovedBracket) nestingNotScored.add(index)
    previousDepth = label.depth
    previousContainer = label.container
  }
  const sorted = (set: Set<number>) => [...set].sort((left, right) => left - right)
  return {unscoredKinds: sorted(kindsNotScored), unscoredNesting: sorted(nestingNotScored)}
}

// Why a draw is thrown away and the sample is drawn again, in the order in which a draw is tried.
export const rejections = [
  'the text has no place for an edit',
  'the text is unchanged',
  'the text is longer than 512 code points',
  'the text is still valid JSON',
  'the text is nested deeper than 16 levels, as the parser as it is counts',
  'no code point is left to score',
] as const

const parses = (text: string) => {
  try {
    JSON.parse(text)
  } catch {
    return false
  }
  return true
}

// The sample that a damaged text is, or the place in `rejections` of the reason why it is none. The limits are the
// dataset's (draftOf of ../../../samples.ts): 512 code points, 16 levels, and a text that both JSON.parse and the
// parser as it is reject.
//
// What the dataset knows of a sample by a judgment about its kind of damage is not known here: `reachable` is 'yes',
// `needsRules` and `needsClass` are empty and `debatable` is false for every neutral sample, and they say nothing.
// The two proofs about the plain table parser, `needsNestingFix` and `needsDisplayFix`, are made as for any sample.
function sampleOfDamagedText(id: string, original: OriginalDocument, originalCodePoints: readonly string[], labels: readonly ValidLabel[], text: DamagedText, applied: readonly AppliedNeutralEdit[]): Sample | number {
  const broken = text.codePoints.join('')
  if (broken === original.text) return rejections.indexOf('the text is unchanged')
  if (text.codePoints.length > capacity) return rejections.indexOf('the text is longer than 512 code points')
  if (parses(broken)) return rejections.indexOf('the text is still valid JSON')
  const trace = runTableParser(broken)
  if (trace.valid) return rejections.indexOf('the text is still valid JSON')
  for (let position = 0; position < trace.length; position++) if (trace.depthAfter[position]! > maximumDepth) return rejections.indexOf('the text is nested deeper than 16 levels, as the parser as it is counts')
  const edits = editsOf(originalCodePoints, text)
  const aligned = applyEdits(originalCodePoints, edits)
  if (aligned.broken !== broken) throw new Error(`${id}: the edits in the dataset's form do not give the damaged text`)
  const sample: Sample = {
    id, source: 'damage', recipe: 'neutral damage', kinds: [], forms: applied.map(edit => edit.description), template: original.template, style: original.style,
    documents: [original.text], original: original.text, broken, lineEnd: original.text.includes('\r\n') ? '\r\n' : '\n', edits, alignment: aligned.alignment, replaced: aligned.replaced,
    ...unscoredOf(originalCodePoints, text.codePoints, labels, aligned.alignment, aligned.firstDamage, trace),
    firstDamage: aligned.firstDamage, firstErrorPosition: trace.firstErrorPosition, firstErrorKind: trace.firstErrorKind,
    reachable: 'yes', needsRules: [], needsClass: [], needsNestingFix: false, needsDisplayFix: false, debatable: false, split: 'train', heldOut: [],
  }
  const scoredLabels = labelsOf(sample)
  if (scoredCodePoints(sample, scoredLabels) === 0) return rejections.indexOf('no code point is left to score')
  const limits = limitsOf(text.codePoints, scoredLabels, trace.firstErrorPosition)
  sample.needsNestingFix = limits.needsNestingFix
  sample.needsDisplayFix = limits.needsDisplayFix
  return sample
}

// How many draws an original gets before the sample takes the next original of the list. Some originals give no
// sample at all, e.g. the lone number `7`: no edit of it leaves a kept code point after a first error.
export const drawsPerOriginal = 300

export type NeutralSample = {
  sample: Sample
  // The edits that made the sample, in the order in which they were applied, as places in neutralEditNames with a
  // sentence each.
  applied: AppliedNeutralEdit[]
  original: OriginalDocument
  // The draws that were thrown away before the one that the sample is: the reason, as a place in `rejections`, and
  // the edits of the draw, as places in neutralEditNames.
  thrownAway: {reason: number, edits: number[]}[]
  // How many originals gave no sample before this one. The first drawsPerOriginal draws of `thrownAway` are of the
  // first of them, and so on.
  originalsGivenUp: number
}

// The neutral sample `index` of a seed: a function of the seed and the index alone, so two runs make the same
// sample. Its original is the one of the broken train sample at the place `index` of indexesOfTheOriginals, and an
// index past the end of that list starts at the list's first original again, with other draws.
export function neutralSampleAt(seed: number, index: number): NeutralSample {
  const random = createRandom(seed, index)
  const originalCount = indexesOfTheOriginals().length
  const thrownAway: NeutralSample['thrownAway'] = []
  for (let step = 0; step < originalCount; step++) {
    const original = originalAt((index + step) % originalCount)
    const originalCodePoints = Array.from(original.text)
    const labels = labelsOfValidText(original.text)
    for (let draw = 0; draw < drawsPerOriginal; draw++) {
      const drawn = drawNeutralDamage(random, originalCodePoints)
      if ('noPlaceFor' in drawn) {
        thrownAway.push({reason: rejections.indexOf('the text has no place for an edit'), edits: drawn.noPlaceFor})
        continue
      }
      const made = sampleOfDamagedText(`neutral ${seed}:${index}`, original, originalCodePoints, labels, drawn.text, drawn.applied)
      if (typeof made === 'number') {
        thrownAway.push({reason: made, edits: drawn.applied.map(edit => edit.edit)})
        continue
      }
      return {sample: made, applied: drawn.applied, original, thrownAway, originalsGivenUp: step}
    }
  }
  throw new Error(`the neutral sample ${seed}:${index} could not be made from any original`)
}

type TypedArray = Int32Array | Int8Array | Uint8Array | Uint16Array
const arrayTypes = {Int32Array, Int8Array, Uint8Array, Uint16Array}

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

const kindNames = kinds.map(kind => kind.name)
const familyNames: string[] = [...families]
const kindFamily = kinds.map(kind => familyNames.indexOf(kind.family))

// Collects samples into the arrays of ../../data.ts: `add` takes a sample and the index that the arrays keep for
// it, and `done` gives the arrays. Every field holds what makeSamples of data.ts puts there for the same sample,
// which check.ts shows on samples of the standard set. makeSamples itself only takes samples of the dataset.
export function collectSamples(seed: number) {
  const int32 = () => growing(length => new Int32Array(length))
  const int8 = () => growing(length => new Int8Array(length))
  const uint8 = () => growing(length => new Uint8Array(length))
  const perSample = {
    index: int32(), firstDamage: int32(), firstErrorPosition: int32(), firstErrorKind: uint8(), split: uint8(), source: uint8(), reachable: uint8(), group: uint8(), needsClass: uint8(),
    needsNestingFix: uint8(), needsDisplayFix: uint8(), debatable: uint8(), carriageReturns: uint8(), heldOut: uint8(), families: growing(length => new Uint16Array(length)), scored: int32(), mostRight: int32(),
    start: int32(), kindStart: int32(),
  }
  const perCodePoint = {
    codePoints: int32(), flags: uint8(), labelKind: int8(), labelDepth: int8(), labelContainer: int8(),
    intendedLexerAfter: int8(), intendedEvent: int8(), intendedGrammarAfter: int8(), intendedDepthAfter: int8(), intendedContainerAfter: int8(),
  }
  const kindList = uint8()
  let sampleCount = 0
  let codePointCount = 0
  let kindCount = 0
  perSample.start.push(0)
  perSample.kindStart.push(0)
  const add = (sample: Sample, index: number) => {
    if (sample.split === 'test' || sample.heldOut.length > 0) throw new Error(`sample ${sample.id} is of the test split or held out`)
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
    perSample.heldOut.push(0)
    let familyBits = 0
    for (const kind of sample.kinds) {
      const kindIndex = kindNames.indexOf(kind)
      if (kindIndex === -1) throw new Error(`sample ${sample.id} has the kind ${kind}, which damage.ts does not list`)
      kindList.push(kindIndex)
      kindCount++
      familyBits |= 1 << kindFamily[kindIndex]!
    }
    perSample.families.push(familyBits)
    perSample.kindStart.push(kindCount)
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
      perCodePoint.codePoints.push(brokenCodePoints[position]!)
      perCodePoint.flags.push((label === undefined ? 0 : codePointKept) | (label?.kind === undefined ? 0 : codePointKindScored) | (label?.depth === undefined ? 0 : codePointNestingScored)
        | (sample.replaced[position] === true ? codePointReplaced : 0) | (intended.canFollow[position] === 1 ? codePointCanFollow : 0))
      perCodePoint.labelKind.push(label?.kind ?? -1)
      perCodePoint.labelDepth.push(label?.depth ?? -1)
      perCodePoint.labelContainer.push(label?.container ?? -1)
      if (label?.depth !== undefined && (label.depth !== intended.depthAfter[position] || label.container !== intended.containerAfter[position])) {
        throw new Error(`sample ${sample.id}, code point ${position}: the label's depth and container are not the ones of the parser's trace on the original`)
      }
      perCodePoint.intendedLexerAfter.push(intended.lexerStateAfter[position]!)
      perCodePoint.intendedEvent.push(intended.event[position]!)
      perCodePoint.intendedGrammarAfter.push(intended.grammarAfter[position]!)
      perCodePoint.intendedDepthAfter.push(intended.depthAfter[position]!)
      perCodePoint.intendedContainerAfter.push(intended.containerAfter[position]!)
    }
    codePointCount += brokenCodePoints.length
    perSample.start.push(codePointCount)
    sampleCount++
  }
  const done = (): Samples => ({
    seed, datasetKey: datasetKey(), withTest: false, sampleCount, codePointCount, kindNames, kindFamily, familyNames,
    index: perSample.index.done(), firstDamage: perSample.firstDamage.done(), firstErrorPosition: perSample.firstErrorPosition.done(), firstErrorKind: perSample.firstErrorKind.done(),
    split: perSample.split.done(), source: perSample.source.done(), reachable: perSample.reachable.done(), group: perSample.group.done(), needsClass: perSample.needsClass.done(),
    needsNestingFix: perSample.needsNestingFix.done(), needsDisplayFix: perSample.needsDisplayFix.done(), debatable: perSample.debatable.done(), carriageReturns: perSample.carriageReturns.done(),
    heldOut: perSample.heldOut.done(), families: perSample.families.done(), scored: perSample.scored.done(), mostRight: perSample.mostRight.done(),
    start: perSample.start.done(), kindStart: perSample.kindStart.done(), kindList: kindList.done(),
    codePoints: perCodePoint.codePoints.done(), flags: perCodePoint.flags.done(), labelKind: perCodePoint.labelKind.done(), labelDepth: perCodePoint.labelDepth.done(), labelContainer: perCodePoint.labelContainer.done(),
    intendedLexerAfter: perCodePoint.intendedLexerAfter.done(), intendedEvent: perCodePoint.intendedEvent.done(), intendedGrammarAfter: perCodePoint.intendedGrammarAfter.done(),
    intendedDepthAfter: perCodePoint.intendedDepthAfter.done(), intendedContainerAfter: perCodePoint.intendedContainerAfter.done(),
  })
  return {add, done}
}

export type NeutralSet = {
  // The samples, all of the train split, in the arrays of ../../data.ts. `samples.index` holds the neutral indexes,
  // 0 to the count less one, and `samples.seed` the neutral seed: neutralSampleAt(seed, index) makes a sample again.
  // The functions of learn/ that make a sample of the arrays again from the dataset do not fit, e.g.
  // loadIntendedObjects of ../../soft/twin-data.ts: for a neutral sample, intendedObjectsOf(neutralSampleAt(seed,
  // index).sample) gives the same.
  samples: Samples
  // Per sample, the index in the dataset of the standard sample whose original was damaged.
  originalOf: Int32Array
  // The edits of the sample at place p, in the order in which they were applied, as places in neutralEditNames:
  // editList[editStart[p]] to editList[editStart[p + 1] - 1].
  editStart: Int32Array
  editList: Uint8Array
  // How many draws were thrown away, per reason of `rejections`, without the draws of the originals that gave no
  // sample at all, e.g. the lone number `7`. `originalsGivenUp` counts those originals: drawsPerOriginal draws each.
  thrownAway: number[]
  originalsGivenUp: number
}

// Makes the neutral samples 0 to count - 1 of a seed. One sample takes about a quarter of a millisecond.
export function makeNeutralSet(seed: number, count: number): NeutralSet {
  const collected = collectSamples(seed)
  const originalOf = new Int32Array(count)
  const editStart = new Int32Array(count + 1)
  const editList: number[] = []
  const thrownAway = rejections.map(() => 0)
  let originalsGivenUp = 0
  for (let index = 0; index < count; index++) {
    const made = neutralSampleAt(seed, index)
    collected.add(made.sample, index)
    originalOf[index] = made.original.standardIndex
    for (const {edit} of made.applied) editList.push(edit)
    editStart[index + 1] = editList.length
    for (const {reason} of made.thrownAway.slice(made.originalsGivenUp * drawsPerOriginal)) thrownAway[reason]!++
    originalsGivenUp += made.originalsGivenUp
  }
  return {samples: collected.done(), originalOf, editStart, editList: Uint8Array.from(editList), thrownAway, originalsGivenUp}
}

// The cache folder of the neutral set in a scratch folder, or null without one.
export function neutralCacheFolderOf(scratchFolder: string | undefined = process.env['RECOVERY_SCRATCH']): string | null {
  return scratchFolder === undefined || scratchFolder === '' ? null : join(scratchFolder, 'neutral-damage', 'cache')
}

// The key of a cache file: the cache's key of ../../dataset-key.ts, which says what the dataset is and what the
// arrays hold, and a hash of this file and of neutral-edits.ts, which decide what the neutral samples are.
const keyOfTheNeutralSet = () => `${cacheKey()}-${Bun.hash(['neutral.ts', 'neutral-edits.ts'].map(name => Bun.hash(readFileSync(join(import.meta.dir, name))).toString(16)).join('.')).toString(16)}`

type CacheHeader = {
  format: string, key: string, seed: number, count: number, thrownAway: number[], originalsGivenUp: number,
  samples: Pick<Samples, 'seed' | 'datasetKey' | 'withTest' | 'sampleCount' | 'codePointCount' | 'kindNames' | 'kindFamily' | 'familyNames'>,
  sections: {field: string, type: string, length: number, offset: number}[],
}
const cacheFormat = 'neutral samples 1'
const align = (offset: number) => Math.ceil(offset / 8) * 8

function writeCache(path: string, set: NeutralSet, seed: number, count: number) {
  const {samples} = set
  const header: CacheHeader = {
    format: cacheFormat, key: keyOfTheNeutralSet(), seed, count, thrownAway: set.thrownAway, originalsGivenUp: set.originalsGivenUp,
    samples: {seed: samples.seed, datasetKey: samples.datasetKey, withTest: samples.withTest, sampleCount: samples.sampleCount, codePointCount: samples.codePointCount, kindNames: samples.kindNames, kindFamily: samples.kindFamily, familyNames: samples.familyNames},
    sections: [],
  }
  const arrays: [string, TypedArray][] = [['originalOf', set.originalOf], ['editStart', set.editStart], ['editList', set.editList]]
  for (const [field, value] of Object.entries(samples)) if (ArrayBuffer.isView(value)) arrays.push([field, value])
  let offset = 0
  for (const [field, values] of arrays) {
    header.sections.push({field, type: values.constructor.name, length: values.length, offset})
    offset = align(offset + values.byteLength)
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify(header))
  const bodyStart = align(8 + headerBytes.length)
  const bytes = new Uint8Array(bodyStart + offset)
  new DataView(bytes.buffer).setUint32(0, headerBytes.length, true)
  bytes.set(headerBytes, 8)
  arrays.forEach(([, values], section) => bytes.set(new Uint8Array(values.buffer, values.byteOffset, values.byteLength), bodyStart + header.sections[section]!.offset))
  // Written under another name first, so that a process that reads the cache at the same time never sees half a file.
  const partial = `${path}.${process.pid}.partial`
  writeFileSync(partial, bytes)
  renameSync(partial, path)
}

// The set of a cache file, or undefined when the file was made from other sources or for another seed or count.
function readCache(path: string, seed: number, count: number): NeutralSet | undefined {
  const file = readFileSync(path)
  // The arrays are views of the file's bytes, which have to start at a multiple of 8 for that.
  const buffer = file.byteOffset % 8 === 0 ? file.buffer : file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  const base = file.byteOffset % 8 === 0 ? file.byteOffset : 0
  const headerLength = new DataView(buffer, base, 8).getUint32(0, true)
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, base + 8, headerLength))) as CacheHeader
  if (header.format !== cacheFormat || header.key !== keyOfTheNeutralSet() || header.seed !== seed || header.count !== count) return undefined
  const bodyStart = base + align(8 + headerLength)
  const arrays: Record<string, TypedArray> = {}
  for (const section of header.sections) arrays[section.field] = new arrayTypes[section.type as keyof typeof arrayTypes](buffer, bodyStart + section.offset, section.length)
  const {originalOf, editStart, editList, ...arraysOfSamples} = arrays
  return {samples: {...header.samples, ...arraysOfSamples} as unknown as Samples, originalOf: originalOf as Int32Array, editStart: editStart as Int32Array, editList: editList as Uint8Array, thrownAway: header.thrownAway, originalsGivenUp: header.originalsGivenUp}
}

// The neutral set of a seed: as many samples as the train split of the standard set has broken ones, unless `count`
// says otherwise. With a cache folder it is read from the folder's file, or made and written there. With `null` as
// the cache folder it is made each time. Without the argument, the cache folder is the one of RECOVERY_SCRATCH.
export function loadNeutralSet(seed: number = neutralSeed, count: number = indexesOfTheOriginals().length, cacheFolder: string | null = neutralCacheFolderOf()): NeutralSet {
  if (cacheFolder === null) return makeNeutralSet(seed, count)
  mkdirSync(cacheFolder, {recursive: true})
  const path = join(cacheFolder, `neutral-samples-${keyOfTheNeutralSet()}-${seed}-${count}.bin`)
  if (existsSync(path)) {
    const cached = readCache(path, seed, count)
    if (cached !== undefined) return cached
  }
  const set = makeNeutralSet(seed, count)
  writeCache(path, set, seed, count)
  return set
}

if (import.meta.main) {
  refuseUnknownOptions('arms/neutral-damage/neutral.ts', ['--seed', '--count'])
  const seed = Number(optionOf('--seed') ?? neutralSeed)
  const count = Number(optionOf('--count') ?? indexesOfTheOriginals().length)
  const started = performance.now()
  const set = loadNeutralSet(seed, count)
  const {samples} = set
  const thrownAway = set.thrownAway.reduce((total, draws) => total + draws, 0)
  console.log(`The neutral set of seed ${seed}, dataset ${samples.datasetKey}: ${samples.sampleCount} samples and ${samples.codePointCount} code points in ${((performance.now() - started) / 1000).toFixed(1)} s${neutralCacheFolderOf() === null ? ', without a cache' : `, cache in ${neutralCacheFolderOf()}`}.`)
  console.log(`${samples.scored.reduce((total, scored) => total + scored, 0)} scored code points. ${set.editList.length} edits: ${neutralEditNames.map((name, edit) => `${name} ${set.editList.reduce((total, entry) => total + Number(entry === edit), 0)}`).join(', ')}.`)
  console.log(`${thrownAway} draws were thrown away: ${rejections.map((reason, place) => `${reason} ${set.thrownAway[place]}`).join(', ')}. Not among them: ${drawsPerOriginal} draws of each of ${set.originalsGivenUp} originals that gave no sample.`)
}
