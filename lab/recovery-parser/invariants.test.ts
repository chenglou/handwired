// The invariants of the dataset, on a few thousand samples, and the table parser against the reference highlighter.
// Run from the repo root: bun test lab/recovery-parser
import {expect, test} from 'bun:test'
import {maximumDepth} from '../../src/json-search/highlighter/kinds.ts'
import {createCorpus} from '../../tests/json-search/highlighter/corpus.ts'
import {highlightReference} from '../../tests/json-search/highlighter/reference.ts'
import {sampleProblems} from './check-samples.ts'
import {tableParserDifference} from './check-table-parser.ts'
import {contradictions, kinds} from './damage.ts'
import {applyEdits, canonicalEdits} from './edits.ts'
import {handRuleTables, handRules} from './hand-rules.ts'
import {labelsOfValidText, tokenSequenceOf} from './labels.ts'
import {createRandom} from './random.ts'
import {type Sample, defaultSeed, groupOf, heldOutKinds, heldOutTemplate, labelsOf, sampleAt, splitOf, typingReplayOf} from './samples.ts'
import {capacity, defaultTables, isLexerErrorEvent, runTableParser} from './table-parser.ts'

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
    const reference = highlightReference(sample.broken, 0)
    if (parses(sample.broken) || reference.valid !== 0) fail(sample, 'the broken text is not rejected')
    if (reference.firstErrorPosition !== sample.firstErrorPosition || reference.firstErrorKind !== sample.firstErrorKind) fail(sample, 'the first error is not the reference highlighter\'s')
    const trace = runTableParser(sample.broken)
    for (let position = 0; position < trace.length; position++) {
      if (trace.depthAfter[position]! > maximumDepth) fail(sample, 'the broken text nests deeper than 16 levels')
    }
  }
})

test('the edits give the broken text, are in the canonical form, and the alignment pairs equal code points in rising order', () => {
  for (const sample of samples) {
    const original = Array.from(sample.original)
    const broken = Array.from(sample.broken)
    const applied = applyEdits(original, sample.edits)
    if (applied.broken !== sample.broken) fail(sample, 'the edits applied to the original do not give the broken text')
    expect(applied.alignment).toEqual(sample.alignment)
    expect(canonicalEdits(original, sample.edits)).toEqual(sample.edits)
    expect(sample.alignment.length).toBe(broken.length)
    let previous = -1
    sample.alignment.forEach((index, position) => {
      if (index === -1) {
        if (sample.replaced[position] === true) fail(sample, `position ${position} is both added and replaced`)
        return
      }
      if (index <= previous) fail(sample, `the alignment does not rise at ${position}`)
      previous = index
      // A kept code point equals its counterpart, and a replaced one stands in its place and differs from it.
      if ((sample.replaced[position] === true) === (broken[position] === original[index])) fail(sample, `the code point at ${position} is kept and differs from its counterpart, or is replaced and equals it`)
    })
    for (const index of [...sample.unscoredKinds, ...sample.unscoredNesting]) {
      if (!sample.alignment.includes(index)) fail(sample, `the unscored code point ${index} of the original is not in the broken text`)
    }
  }
})

test('before its first error, the parser as it is gives every scored label, and the first error is not before the first damage', () => {
  for (const sample of samples) {
    if (sample.source === 'valid') continue
    const {firstDamage, alignment} = sample
    if (firstDamage < 0 || firstDamage > alignment.length) fail(sample, `the first damage ${firstDamage} is outside the broken text`)
    // Before the first damage the broken text is the original's start, code point for code point.
    for (let position = 0; position < firstDamage; position++) {
      if (alignment[position] !== position || sample.replaced[position] === true) fail(sample, `position ${position} is before the first damage and is not the original's code point ${position}`)
    }
    if (sample.firstErrorPosition < firstDamage) fail(sample, `the parser reports an error at ${sample.firstErrorPosition}, before the first damage at ${firstDamage}`)
    // Up to the first error, every arm of the experiment gives what the parser as it is gives. Every scored value
    // there is that, so no label asks for what no arm can give. Before the first damage, every value is scored.
    const labels = labelsOf(sample)
    const trace = runTableParser(sample.broken)
    for (let position = 0; position < Math.min(sample.firstErrorPosition, labels.length); position++) {
      const label = labels[position]
      if (label === undefined) continue
      if (position < firstDamage && (label.kind === undefined || label.depth === undefined)) fail(sample, `the label at ${position}, before the first damage, has a value that is not scored`)
      if (label.kind !== undefined && label.kind !== trace.displayKind[position]) fail(sample, `the display kind at ${position}, before the first error, is scored and is not what the parser as it is gives`)
      if (label.depth !== undefined && (label.depth !== trace.depthAfter[position] || label.container !== trace.containerAfter[position])) fail(sample, `the depth or the container at ${position}, before the first error, is scored and is not what the parser as it is gives`)
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
      if (label.depth !== undefined && (label.depth !== expected[index]!.depth || label.container !== expected[index]!.container)) fail(sample, `the label at ${position} is not its counterpart's`)
      if (label.kind !== undefined && label.kind !== expected[index]!.kind) fail(sample, `the display kind at ${position} is not its counterpart's`)
      if ((label.kind === undefined) !== sample.unscoredKinds.includes(index)) fail(sample, `the display kind at ${position} is scored or not against the sample's list`)
      if ((label.depth === undefined) !== sample.unscoredNesting.includes(index) || (label.depth === undefined) !== (label.container === undefined)) fail(sample, `the depth and the container at ${position} are scored or not against the sample's list`)
    })
  }
})

test('a second derivation that shares no code with the dataset agrees on every sample, and reports samples that are spoiled', () => {
  for (const sample of samples) {
    const problems = sampleProblems(sample)
    if (problems.length > 0) fail(sample, problems.join('; '))
  }
  // Each way of spoiling a sample must be reported, on the first samples that it applies to. So the agreement above
  // is not that of a check that finds nothing.
  const spoilers: [name: string, applies: (sample: Sample) => boolean, spoil: (sample: Sample) => void][] = [
    ['a kept label loses its place in the alignment', sample => sample.alignment.length > 2, sample => { sample.alignment[1] = sample.alignment[1]! + 1 }],
    ['one character of the broken text changes', sample => sample.alignment[0] === 0, sample => { sample.broken = `${sample.broken[0] === 'x' ? 'y' : 'x'}${sample.broken.slice(1)}` }],
    ['the first damage moves one to the left', sample => sample.firstDamage > 0, sample => { sample.firstDamage-- }],
    ['the first damage moves one to the right', sample => sample.firstDamage < sample.alignment.length, sample => { sample.firstDamage++ }],
    ['an edit is dropped', sample => sample.edits.length > 0, sample => { sample.edits.pop() }],
    ['an added code point gets a counterpart', sample => sample.alignment.includes(-1), sample => { sample.alignment[sample.alignment.indexOf(-1)] = 0 }],
    // A kind of damage may leave any display kind after the first damage unscored, so only one before it is a mistake for certain.
    ['a display kind before the first damage is listed as not scored', sample => sample.firstDamage > 0 && !sample.unscoredKinds.includes(0), sample => { sample.unscoredKinds.push(0) }],
    ['a depth that is scored is listed as not scored', sample => sample.unscoredNesting.length === 0, sample => { sample.unscoredNesting.push(sample.alignment.find(index => index !== -1)!) }],
    ['a depth that is not scored is scored', sample => sample.unscoredNesting.length > 0, sample => { sample.unscoredNesting.pop() }],
    ['a replaced flag is set on a kept code point', sample => sample.alignment[0] === 0 && !sample.replaced[0], sample => { sample.replaced[0] = true }],
    ['a document is not valid', () => true, sample => { sample.documents[0] = `${sample.documents[0]!}]`; sample.original = sample.documents.join('') }],
    ['the first error moves', () => true, sample => { sample.firstErrorPosition++ }],
    ['the broken text is the original', () => true, sample => { sample.broken = sample.original; sample.edits = []; sample.alignment = Array.from(sample.original, (_, index) => index); sample.replaced = sample.alignment.map(() => false) }],
  ]
  const broken = samples.filter(sample => sample.source !== 'valid')
  for (const [name, applies, spoil] of spoilers) {
    const chosen = broken.filter(applies).slice(0, 25)
    expect(chosen.length).toBeGreaterThan(0)
    for (const sample of chosen) {
      const spoiled: Sample = structuredClone(sample)
      spoil(spoiled)
      if (sampleProblems(spoiled).length === 0) fail(sample, `the second derivation does not notice when ${name}`)
    }
  }
})

test('the fields about what the tables can reach say what their definitions say', () => {
  let flagged = 0
  for (const sample of samples) {
    if (sample.source === 'valid') continue
    const labels = labelsOf(sample)
    const trace = runTableParser(sample.broken)
    let tokenizerError = 0
    while (tokenizerError < trace.length && !isLexerErrorEvent(trace.event[tokenizerError]!)) tokenizerError++
    // Up to the first tokenizer error, the depth and the container of every table arm are those of the parser as it
    // is. A sample without the flag has no scored label there that differs.
    let nestingDiffers = false
    for (let position = 0; position < Math.min(tokenizerError, labels.length); position++) {
      const label = labels[position]
      if (label !== undefined && label.depth !== undefined && (label.depth !== trace.depthAfter[position] || label.container !== trace.containerAfter[position])) nestingDiffers = true
    }
    if (nestingDiffers && !sample.needsNestingFix) fail(sample, 'a scored depth or container differs from the tokenizer\'s running totals, and the sample does not say that it needs a nesting fix')
    if (sample.needsNestingFix || sample.needsDisplayFix) flagged++
    if (groupOf(sample) === 'within reach of the tables' && (sample.reachable !== 'yes' || sample.needsNestingFix || sample.needsDisplayFix || sample.needsClass.length > 0)) fail(sample, 'the group does not fit the flags')
    // A sample whose kinds need both rules of a pair that exclude each other has the flag 'no'.
    if (contradictions.some(([left, right]) => sample.needsRules.includes(left) && sample.needsRules.includes(right)) && sample.reachable !== 'no') fail(sample, 'the sample needs two rules that exclude each other and is not flagged no')
  }
  expect(flagged).toBeGreaterThan(0)
})

test('the two hand-written settings of the tables read valid documents exactly as the tables as they are', () => {
  for (const rule of handRules) {
    const tables = handRuleTables(rule)
    for (const sample of samples.slice(0, 1200)) {
      for (const document of sample.documents) {
        const expected = runTableParser(document)
        const actual = runTableParser(document, tables)
        if (!actual.valid || actual.displayKind.join() !== expected.displayKind.join() || actual.depthAfter.join() !== expected.depthAfter.join() || actual.grammarAfter.join() !== expected.grammarAfter.join()) {
          fail(sample, `the hand rule ${rule} reads a valid document in another way`)
        }
      }
    }
    // And they change something: a broken text is read in another way.
    expect(samples.some(sample => sample.source !== 'valid' && runTableParser(sample.broken, tables).displayKind.join() !== runTableParser(sample.broken, defaultTables).displayKind.join())).toBe(true)
  }
})

test('the split is a function of the original\'s tokens, and held-out kinds and the held-out template only sit in the test split', () => {
  const kindNames = new Set(kinds.map(kind => kind.name))
  const splitOfSequence = new Map<string, string>()
  for (const sample of samples) {
    expect(sample.split).toBe(splitOf(sample.original))
    // No sequence of tokens is in two splits, so a test document's tokens are in no train document.
    const sequence = tokenSequenceOf(sample.original)
    const earlier = splitOfSequence.get(sequence)
    if (earlier !== undefined && earlier !== sample.split) fail(sample, 'the same sequence of tokens sits in two splits')
    splitOfSequence.set(sequence, sample.split)
    for (const kind of sample.kinds) if (!kindNames.has(kind)) fail(sample, `the kind ${kind} is not in the list of kinds`)
    const isHeldOut = sample.kinds.some(kind => heldOutKinds.includes(kind)) || sample.template === heldOutTemplate
    expect(sample.heldOut.length > 0).toBe(isHeldOut)
    if (isHeldOut && sample.split !== 'test') fail(sample, 'a held-out sample is outside the test split')
  }
  // Every split and every held-out kind occurs, so the test above checked something.
  expect(new Set(samples.map(sample => sample.split)).size).toBe(3)
  expect(samples.some(sample => sample.template === heldOutTemplate)).toBe(true)
  for (const kind of heldOutKinds) expect(samples.some(sample => sample.kinds.includes(kind))).toBe(true)
  // A held-out kind sits on the held-out template about as often as on any template that it can be made from, and
  // not in most of its samples.
  const withHeldOutKind = samples.filter(sample => sample.kinds.some(kind => heldOutKinds.includes(kind)))
  expect(withHeldOutKind.filter(sample => sample.template === heldOutTemplate).length).toBeLessThan(withHeldOutKind.length * 0.3)
})

test('every text of a typing replay is what its edits give from the finished document', () => {
  let brokenSteps = 0
  let wrongKeys = 0
  // Replays in which the comma after a new first or middle entry is never typed, and replays in which the comma
  // before a new last entry is typed last or never: the two ways in which a comma is typed apart from its entry.
  let commaNeverAfter = 0
  let commaApartBefore = 0
  for (const [seed, count] of [[defaultSeed, 1200], [271828, 600]] as const) {
    for (let index = 0; index < count; index++) {
      const made = typingReplayOf(createRandom(seed, index))
      if (made === undefined || 'otherSplit' in made) continue
      const {replay} = made
      const finished = Array.from(replay.finished)
      const what = `replay ${seed}:${index} (${replay.editor} editor, ${replay.action}: ${replay.target}, its comma ${replay.comma})`
      if (replay.comma === 'never' && !replay.target.startsWith('the last')) commaNeverAfter++
      if (replay.comma !== 'none' && replay.target.startsWith('the last')) commaApartBefore++
      for (const step of replay.steps) {
        // applyEdits throws when the edits overlap or are not in text order.
        let applied
        try {
          applied = applyEdits(finished, step.edits)
        } catch (error) {
          throw new Error(`${what}: the edits of the step ${JSON.stringify(step.key)} cannot be applied: ${(error as Error).message}`)
        }
        if (applied.broken !== step.text) throw new Error(`${what}: the text of the step ${JSON.stringify(step.key)} is not what its edits give\n  text  ${JSON.stringify(step.text)}\n  edits ${JSON.stringify(applied.broken)}`)
        if (step.valid !== parses(step.text)) throw new Error(`${what}: the step ${JSON.stringify(step.key)} says ${step.valid ? 'valid' : 'broken'} against JSON.parse`)
        if (step.valid) continue
        brokenSteps++
        if (step.kinds.length === 0) throw new Error(`${what}: the broken step ${JSON.stringify(step.key)} has no kind`)
        if (step.kinds.includes('typingSlip')) wrongKeys++
        // A wrong key press adds one code point, and every other step only removes.
        const added = applied.alignment.filter(counterpart => counterpart === -1).length
        if (added !== Number(step.kinds.includes('typingSlip'))) throw new Error(`${what}: the step ${JSON.stringify(step.key)} adds ${added} code points`)
        for (const unscored of step.unscoredKinds) {
          if (!applied.alignment.includes(unscored)) throw new Error(`${what}: the step ${JSON.stringify(step.key)} lists the code point ${unscored} as not scored, and its text does not hold it`)
        }
      }
      // A replay whose comma is never typed ends with the entry and without that comma.
      if (replay.comma === 'never' && !replay.steps.at(-1)!.kinds.includes('missingComma')) throw new Error(`${what}: the last step is not an entry without its comma`)
    }
  }
  expect(brokenSteps).toBeGreaterThan(10_000)
  expect(wrongKeys).toBeGreaterThan(100)
  expect(commaNeverAfter).toBeGreaterThan(10)
  expect(commaApartBefore).toBeGreaterThan(50)
})

test('the same seed and index give the same sample twice, another index gives another sample, and two seeds are unrelated', () => {
  for (let index = 0; index < 400; index++) {
    expect(sampleAt(defaultSeed, index)).toEqual(samples[index]!)
  }
  expect(sampleAt(defaultSeed, 2999)).toEqual(samples[2999]!)
  expect(new Set(samples.map(sample => sample.broken)).size).toBeGreaterThan(sampleCount * 0.95)
  const otherSeed = new Set(Array.from({length: 600}, (_, index) => sampleAt(defaultSeed + 1, index).original))
  expect(samples.slice(0, 600).filter(sample => sample.original.length > 40 && otherSeed.has(sample.original)).length).toBe(0)
})

test('every kind can be made on request, with its name in the sample, and a split can be asked for', () => {
  for (const kind of kinds) {
    // tuple only comes inside a Python print, so it is not asked for alone.
    if (kind.weight === 0) continue
    const sample = sampleAt(defaultSeed, 7, {kind: kind.name})
    expect(sample.kinds).toContain(kind.name)
    const inTest = sampleAt(defaultSeed, 7, {kind: kind.name, split: 'test'})
    expect(inTest.kinds).toContain(kind.name)
    expect(inTest.split).toBe('test')
  }
  expect(sampleAt(defaultSeed, 11, {kind: 'missingComma', split: 'validation'}).split).toBe('validation')
  expect(sampleAt(defaultSeed, 11, {source: 'typing', split: 'train'}).split).toBe('train')
})
