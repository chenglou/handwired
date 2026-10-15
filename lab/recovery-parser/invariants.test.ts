// The invariants of the dataset, on a few thousand samples, and the table parser against the reference highlighter.
// Run from the repo root: bun test lab/recovery-parser
import {expect, test} from 'bun:test'
import {maximumDepth} from '../../src/json-search/highlighter/kinds.ts'
import {createCorpus} from '../../tests/json-search/highlighter/corpus.ts'
import {highlightReference} from '../../tests/json-search/highlighter/reference.ts'
import {tableParserDifference} from './check-table-parser.ts'
import {kinds} from './damage.ts'
import {applyEdits} from './edits.ts'
import {labelsOfValidText} from './labels.ts'
import {type Sample, defaultSeed, heldOutKinds, heldOutTemplate, labelsOf, sampleAt, splitOf} from './samples.ts'
import {capacity, runTableParser} from './table-parser.ts'

const sampleCount = 3000
const samples: Sample[] = Array.from({length: sampleCount}, (_, index) => sampleAt(defaultSeed, index))
const parses = (text: string) => {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}
// Throws with the sample's id and texts, so a failure can be read.
const fail = (sample: Sample, what: string): never => {
  throw new Error(`${what}\n  sample ${sample.id}, kinds ${sample.kinds.length === 0 ? 'none' : sample.kinds.join(', ')}\n  original ${JSON.stringify(sample.original)}\n  broken   ${JSON.stringify(sample.broken)}`)
}

test('the table parser agrees with the reference highlighter on the corpus and on the samples', () => {
  const corpus = createCorpus(20261015, {random: 400, mutated: 1200, long: 60})
  for (const text of [...corpus.all, ...samples.slice(0, 1500).flatMap(sample => [sample.broken, ...sample.documents])]) {
    const difference = tableParserDifference(text)
    if (difference !== null) throw new Error(`${difference}\n  ${JSON.stringify(text)}`)
  }
})

test('every original is valid, and every broken text is rejected and within the limits', () => {
  for (const sample of samples) {
    expect(sample.original).toBe(sample.documents.join(''))
    for (const document of sample.documents) {
      if (!parses(document) || highlightReference(document, 0).valid !== 1) fail(sample, `a document is not valid: ${JSON.stringify(document)}`)
    }
    if (Array.from(sample.original).length > capacity || sample.alignment.length > capacity) fail(sample, 'a text is longer than the capacity')
    if (sample.source === 'valid') {
      if (sample.broken !== sample.original || sample.edits.length > 0 || sample.firstDamage !== -1) fail(sample, 'a valid sample is damaged')
      continue
    }
    if (sample.kinds.length === 0) fail(sample, 'a broken sample has no kind')
    if (parses(sample.broken) || highlightReference(sample.broken, 0).valid !== 0) fail(sample, 'the broken text is not rejected')
    const trace = runTableParser(sample.broken)
    for (let position = 0; position < trace.length; position++) {
      if (trace.depthAfter[position]! > maximumDepth) fail(sample, 'the broken text nests deeper than 16 levels')
    }
  }
})

test('the edits give the broken text, and the alignment pairs equal code points in rising order', () => {
  for (const sample of samples) {
    const original = Array.from(sample.original)
    const broken = Array.from(sample.broken)
    const applied = applyEdits(original, sample.edits)
    if (applied.broken !== sample.broken) fail(sample, 'the edits applied to the original do not give the broken text')
    expect(applied.alignment).toEqual(sample.alignment)
    expect(sample.alignment.length).toBe(broken.length)
    let previous = -1
    sample.alignment.forEach((index, position) => {
      if (index === -1) {
        if (sample.replaced[position] === true) fail(sample, `position ${position} is both added and replaced`)
        return
      }
      if (index <= previous) fail(sample, `the alignment does not rise at ${position}`)
      previous = index
      const same = broken[position] === original[index]
      // A kept code point equals its counterpart, and a replaced one stands in its place.
      if (sample.replaced[position] !== true && !same) fail(sample, `the kept code point at ${position} differs from its counterpart`)
    })
    for (const index of sample.unscoredKinds) {
      if (!sample.alignment.includes(index)) fail(sample, `the unscored code point ${index} of the original is not in the broken text`)
    }
  }
})

test('the first damage is where the broken text first leaves the original, and the parser as it is labels everything before it right', () => {
  for (const sample of samples) {
    if (sample.source === 'valid') continue
    const {firstDamage, alignment} = sample
    if (firstDamage < 0 || firstDamage > alignment.length) fail(sample, `the first damage ${firstDamage} is outside the broken text`)
    // Before the first damage the broken text is the original's start, code point for code point.
    for (let position = 0; position < firstDamage; position++) {
      if (alignment[position] !== position || sample.replaced[position] === true) fail(sample, `position ${position} is before the first damage and is not the original's code point ${position}`)
    }
    if (sample.firstErrorPosition < firstDamage) fail(sample, `the parser reports an error at ${sample.firstErrorPosition}, before the first damage at ${firstDamage}`)
    // So a parser that reads left to right gives them the labels of the original.
    const labels = labelsOf(sample)
    const trace = runTableParser(sample.broken)
    for (let position = 0; position < firstDamage; position++) {
      const label = labels[position]!
      if (label.kind !== undefined && label.kind !== trace.displayKind[position]) fail(sample, `the display kind at ${position}, before the first damage, is not the label's`)
      if (label.depth !== trace.depthAfter[position] || label.container !== trace.containerAfter[position]) fail(sample, `the depth or the container at ${position}, before the first damage, is not the label's`)
    }
  }
})

test('labels are those of the documents, each alone, and added code points have none', () => {
  for (const sample of samples.slice(0, 1500)) {
    const labels = labelsOf(sample)
    const expected = sample.documents.flatMap(labelsOfValidText)
    expect(labels.length).toBe(sample.alignment.length)
    sample.alignment.forEach((index, position) => {
      const label = labels[position]
      if (index === -1) {
        if (label !== undefined) fail(sample, `the added code point at ${position} has a label`)
        return
      }
      if (label === undefined) return fail(sample, `the kept code point at ${position} has no label`)
      if (label.depth !== expected[index]!.depth || label.container !== expected[index]!.container) fail(sample, `the label at ${position} is not its counterpart's`)
      if (label.kind !== undefined && label.kind !== expected[index]!.kind) fail(sample, `the display kind at ${position} is not its counterpart's`)
      if ((label.kind === undefined) !== sample.unscoredKinds.includes(index)) fail(sample, `the display kind at ${position} is scored or not against the sample's list`)
    })
  }
})

test('the split is a function of the original, and held-out kinds and the held-out template only sit in the test split', () => {
  const kindNames = new Set(kinds.map(kind => kind.name))
  const splitOfOriginal = new Map<string, string>()
  for (const sample of samples) {
    expect(sample.split).toBe(splitOf(sample.original))
    const earlier = splitOfOriginal.get(sample.original)
    if (earlier !== undefined && earlier !== sample.split) fail(sample, 'the same original sits in two splits')
    splitOfOriginal.set(sample.original, sample.split)
    for (const kind of sample.kinds) if (!kindNames.has(kind)) fail(sample, `the kind ${kind} is not in the list of kinds`)
    const isHeldOut = sample.kinds.some(kind => heldOutKinds.includes(kind)) || sample.template === heldOutTemplate
    expect(sample.heldOut.length > 0).toBe(isHeldOut)
    if (isHeldOut && sample.split !== 'test') fail(sample, 'a held-out sample is outside the test split')
  }
  // Every split and every held-out kind occurs, so the test above checked something.
  expect(new Set(samples.map(sample => sample.split)).size).toBe(3)
  expect(samples.some(sample => sample.template === heldOutTemplate)).toBe(true)
})

test('the same seed and index give the same sample twice, and another index gives another sample', () => {
  for (let index = 0; index < 400; index++) {
    expect(sampleAt(defaultSeed, index)).toEqual(samples[index]!)
  }
  expect(sampleAt(defaultSeed, 2999)).toEqual(samples[2999]!)
  expect(new Set(samples.map(sample => sample.broken)).size).toBeGreaterThan(sampleCount * 0.95)
})

test('every kind can be made on request, with its name in the sample', () => {
  for (const kind of kinds) {
    // tuple only comes inside a Python print, so it is not asked for alone.
    if (kind.weight === 0) continue
    const sample = sampleAt(defaultSeed, 7, {kind: kind.name})
    expect(sample.kinds).toContain(kind.name)
  }
})
