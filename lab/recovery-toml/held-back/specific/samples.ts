// The held-back set of mistakes that people make in TOML: sampleAt(seed, index) makes one sample, without making the
// ones before it. Nobody who builds the parser, the train data or the training reads this folder, see ../README.md.
//
// A sample has the shape of a sample of ../../samples.ts: a broken text, the valid document its author meant, and
// which code points of one are which code points of the other. labelsOf(sample) gives every code point of the broken
// text the label of its counterpart in the document. What differs from the dataset:
// - The damage is one or two mistakes of mistakes.ts, each of which knows what it does to TOML. So a sample says
//   whether a parser of the tables' form can label it (`reachable`, `needsClass`, `debatable`), as a sample of the
//   JSON dataset does, and a code point can stand for another one, e.g. a colon for the equals sign.
// - Every document is in the test split of ../../splits.ts, and half of them come from the two templates that are
//   held out of training.
import {type Layout, type Style, type Template, drawLayout, drawTemplate, makeDocumentOf, templates} from '../../documents.ts'
import {type Edit, applyEdits, canonicalEdits} from '../../edits.ts'
import {capacity, displayKind, maximumDepth} from '../../kinds.ts'
import type {Label, ValidLabel} from '../../labels.ts'
import type {LabeledText} from '../../learn/data.ts'
import {limitsOf, mostRightOf} from '../../limits.ts'
import {type Random, createRandom, hashText} from '../../random.ts'
import {labelReference} from '../../reference.ts'
import {splitOf} from '../../splits.ts'
import {type ParserTrace, runTableParser} from '../../table-parser.ts'
import {type PlannedMistakes, type Reachable, applyKinds, drawKinds, kindNamed} from './mistakes.ts'
import {type Scan, scan} from './scan.ts'

export const defaultSeed = 20261107
// The set that a final scoring takes: the samples 0 to 2,999 of the default seed.
export const standardCount = 3000

// The two templates that training and validation never see, as in ../../samples.ts.
export const heldOutTemplates: readonly Template[] = ['deployConfig', 'taskRunner']
// The templates that are modeled on files that people write. `deepNesting` and `oddities` are left out: they hold what
// TOML allows and no such file has, e.g. the key `1979-05-27`, and a person's mistake in such a text is no real one.
export const usedTemplates: readonly Template[] = templates.filter(template => template !== 'deepNesting' && template !== 'oddities')
// The share of the samples whose document comes from a held-out template.
export const heldOutShare = 0.5

// Why a try gave no sample.
export const discardReasons = [
  'the result is unchanged',
  'the result is longer than 512 code points',
  // The parser as it is reads the result without an error, e.g. a version without quotes that is a number: 2021.
  'the result is still valid',
  'the result is deeper than 16 levels',
  // No code point at or after the first error has a label with a scored value, e.g. a mistake on the last line.
  'the result leaves no code point to score',
] as const
export type DiscardReason = typeof discardReasons[number]

export type Sample = {
  // The seed and the index, e.g. "20261107:1234".
  id: string
  // Always 'damage': the field is kept so that code written for the datasets reads these samples.
  source: 'damage'
  // 'one mistake' or 'two mistakes'.
  recipe: string
  // The kinds of the mistakes, e.g. ['colonForEquals', 'missingClosingQuote'].
  kinds: string[]
  // Per mistake, which form it took and where, e.g. "missingClosingQuote: a comment follows on the line, a string between quotes".
  forms: string[]
  // The number of mistakes, 1 or 2.
  editCount: number
  template: Template
  style: Style
  // The valid document that the author meant, as a list of one, as the datasets have it.
  documents: string[]
  original: string
  broken: string
  // What ends the lines of the original: a line feed, or a carriage return and a line feed.
  lineEnd: '\n' | '\r\n'
  // What turns the original into the broken text, in text order, with positions in code points of the original, in
  // the canonical form of ../../edits.ts: of two equal code points, the later one is the removed or the added one.
  edits: Edit[]
  // For each code point of the broken text: the index of its counterpart in the original, or -1 when the mistake added it.
  alignment: number[]
  // For each code point of the broken text: whether it stands in the place of its counterpart and differs from it,
  // e.g. a colon for the equals sign. It has the counterpart's label.
  replaced: boolean[]
  // Indexes into the original of kept code points whose display kind is not scored, and of those whose depth and
  // container are not scored. See `unscoredOf` for the rules.
  unscoredKinds: number[]
  unscoredNesting: number[]
  // The index in the broken text of the first code point that is added or stands for another, or of the first kept one
  // after a removed part.
  firstDamage: number
  // Where the parser as it is reports its first error in the broken text, and the error's kind as in ../../kinds.ts.
  // Scores count the code points from this position on.
  firstErrorPosition: number
  firstErrorKind: number
  // Whether a parser of the tables' form can give every scored label, see mistakes/types.ts: a judgment per form.
  reachable: Reachable
  // What the tokenizer must tell apart and cannot with the tables' 47 character classes, e.g. 'the typographic quotes'.
  needsClass: string[]
  // True when the scored depths cannot all come out of the loop of ../../table-parser.ts, whatever its tables hold,
  // because the depth moves by one level per code point at most. See ../../limits.ts for how little that proves.
  needsNestingFix: boolean
  // Whether another sensible repair would give other scored labels to kept code points.
  debatable: boolean
  // Constants, kept so that code written for the JSON dataset reads these samples.
  needsRules: never[]
  needsDisplayFix: false
  // Always 'test': every document is in the test split of ../../splits.ts.
  split: 'test'
  // ['template: deployConfig'] or ['template: taskRunner'] for a document of a held-out template, and [] otherwise.
  heldOut: string[]
  // The tries on documents of the test split that gave no sample before the one that did, by their reasons.
  discarded: DiscardReason[]
}

// How many code points from `position` on the parser as it is shows as a number or a literal when a value starts
// there, e.g. 3 for the `0.4` of `0.4.1`, 4 for the `true` of `true-color`, and 0 for `tiny`. The rest of the line is
// read after `k = `, by the tables as they are.
export function readsAsNumberOrLiteral(broken: readonly string[], position: number): number {
  let lineEnd = position
  while (lineEnd < broken.length && broken[lineEnd] !== '\n' && broken[lineEnd] !== '\r') lineEnd++
  const start = 'k = '
  const trace = runTableParser(`${start}${broken.slice(position, lineEnd).join('')}`)
  let count = 0
  while (position + count < lineEnd) {
    const index = start.length + count
    if (trace.firstErrorPosition !== -1 && index >= trace.firstErrorPosition) break
    if (trace.displayKind[index] !== displayKind.number && trace.displayKind[index] !== displayKind.literal) break
    count++
  }
  return count
}

const punctuation = displayKind.punctuation

// A code point that can be a part of a word such as `2026/02/05`: any but white space, the punctuation that ends a
// value in TOML, a quote and a round bracket. The rule and the next one are those of ../written/written.ts.
const canBePartOfWord = (character: string | undefined) => character !== undefined && !/^[\s=,[\]{}#()"'“”‘’]$/u.test(character)

// The indexes into the original of what is left of a number or a literal with a slip in it: the number or literal
// lacks a code point in the broken text, and an added code point that can be a part of a word stands right against
// what is left of it or inside it, e.g. the digits of `2026/02/05` for `2026-02-05`. A number that only lost code
// points is none, e.g. `0755` for `0o755`, and neither is one with text added to it, e.g. `30s` and `08080`.
function slippedWords(broken: readonly string[], labels: readonly ValidLabel[], alignment: readonly number[], replaced: readonly boolean[]): number[] {
  const isWordKind = (index: number) => labels[index]?.kind === displayKind.number || labels[index]?.kind === displayKind.literal
  const positionOf = new Array<number>(labels.length).fill(-1)
  alignment.forEach((counterpart, position) => { if (counterpart !== -1) positionOf[counterpart] = position })
  const slipped: number[] = []
  for (let from = 0; from < labels.length; from++) {
    if (!isWordKind(from)) continue
    let to = from
    while (isWordKind(to)) to++
    const positions = positionOf.slice(from, to).filter(position => position !== -1)
    const lostCodePoint = positions.length < to - from || positions.some(position => replaced[position] === true)
    if (positions.length > 0 && lostCodePoint) {
      let hasSlip = false
      for (let position = positions[0]! - 1; position <= positions.at(-1)! + 1; position++) if (position >= 0 && alignment[position] === -1 && canBePartOfWord(broken[position])) hasSlip = true
      if (hasSlip) for (const position of positions) slipped.push(alignment[position]!)
    }
    from = to - 1
  }
  return slipped
}

// The label values that are not scored, as indexes into the original. Five rules, the first four those of the JSON
// dataset, the fifth that of the written set of ../written/:
// - What a mistake declares, e.g. the comment that an open string takes with it.
// - Before the first error of the parser as it is, a value that the parser as it is does not give. Up to its first
//   error a text is the start of a valid text, and the experiment reads valid TOML as now. E.g. in `server]`, where
//   the header lost its opening bracket, `server` is read as a key, and the label says header name.
// - Where the labels' depth or container changes at a code point that is not a bracket, a bracket was removed before
//   it, and nothing in the text shows the change. From there to the next kept bracket the depth and the container are
//   not scored, e.g. for the lines after `ports = [80, 443`, where the `]` is missing. A bracket is one of `[ ] { }`
//   that is shown as punctuation, so the bracket of a header counts.
// - A string value that lost its opening quote and stands after white space or punctuation starts where a number or
//   a literal can start. Its first code points that read as one have a display kind that is not scored, e.g. the 0.4
//   of `version = 0.4.1`: at the 0 no parser can tell a version from a number.
// - What is left of a number or of a literal with a slip in it has a display kind that is not scored, see slippedWords:
//   the highlighter has nothing to show such a word as. The written set gives such code points no label at all. Here
//   the depth and the container stay scored, since the slip does not touch them.
function unscoredOf(original: readonly string[], broken: readonly string[], labels: readonly ValidLabel[], alignment: readonly number[], replaced: readonly boolean[], firstDamage: number, trace: ParserTrace, declared: readonly number[]) {
  const kept = new Set(alignment)
  const kinds = new Set([...declared.filter(index => kept.has(index)), ...slippedWords(broken, labels, alignment, replaced)])
  const nesting = new Set<number>()
  for (let position = Math.max(0, firstDamage); position < Math.min(trace.firstErrorPosition, alignment.length); position++) {
    const index = alignment[position]!
    if (index === -1) continue
    const label = labels[index]!
    if (label.kind !== trace.displayKind[position]) kinds.add(index)
    if (label.depth !== trace.depthAfter[position] || label.container !== trace.containerAfter[position]) nesting.add(index)
  }
  for (let position = 0; position < alignment.length; position++) {
    const index = alignment[position]!
    if (index <= 0 || labels[index]!.kind !== displayKind.string) continue
    // The code point before it in the original is the value's opening quote, which is not in the broken text.
    const before = original[index - 1]
    if ((before !== '"' && before !== '\'') || labels[index - 1]!.kind !== displayKind.string || kept.has(index - 1)) continue
    // What stands before it in the broken text is white space or punctuation: a kept code point by its label, and an
    // added one by what it is, e.g. the space after the hyphen of a YAML list item.
    if (position > 0) {
      const counterpart = alignment[position - 1]!
      if (counterpart === -1 ? !' \t\r\n{}[]=,:'.includes(broken[position - 1]!) : kinds.has(counterpart) || (labels[counterpart]!.kind !== displayKind.whitespace && labels[counterpart]!.kind !== punctuation)) continue
    }
    const run = readsAsNumberOrLiteral(broken, position)
    for (let offset = 0; offset < run && alignment[position + offset] === index + offset && labels[index + offset]!.kind === displayKind.string; offset++) kinds.add(index + offset)
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
    if (afterRemovedBracket) nesting.add(index)
    previousDepth = label.depth
    previousContainer = label.container
  }
  const sorted = (set: Set<number>) => [...set].sort((left, right) => left - right)
  return {unscoredKinds: sorted(kinds), unscoredNesting: sorted(nesting)}
}

// The labels of a sample's document, kept from the making of the sample so that labelsOf does not parse it again.
const documentLabels = new WeakMap<object, ValidLabel[]>()

const applyUnscored = (alignment: readonly number[], labels: readonly ValidLabel[], unscoredKinds: readonly number[], unscoredNesting: readonly number[]): (Label | undefined)[] => {
  const kinds = new Set(unscoredKinds)
  const nesting = new Set(unscoredNesting)
  return alignment.map(index => {
    if (index === -1) return undefined
    const label = labels[index]!
    const scored = !nesting.has(index)
    return {kind: kinds.has(index) ? undefined : label.kind, depth: scored ? label.depth : undefined, container: scored ? label.container : undefined}
  })
}

const countScored = (labels: readonly (Label | undefined)[], firstErrorPosition: number) => {
  let count = 0
  for (let position = Math.max(0, firstErrorPosition); position < labels.length; position++) {
    const label = labels[position]
    if (label !== undefined && (label.kind !== undefined || label.depth !== undefined)) count++
  }
  return count
}

const bunAccepts = (text: string) => {
  try {
    Bun.TOML.parse(text)
  } catch {
    return false
  }
  return true
}

type Draft = Omit<Sample, 'id' | 'template' | 'style' | 'heldOut' | 'discarded'>

// The sample that the mistakes make of a document, or the reason why they make none.
function draftOf(scanned: Scan, planned: PlannedMistakes): Draft | DiscardReason {
  const {codePoints: original, labels, text} = scanned
  const edits = canonicalEdits(original, planned.edits)
  const applied = applyEdits(original, edits)
  if (applied.broken === text) return 'the result is unchanged'
  if (applied.alignment.length > capacity) return 'the result is longer than 512 code points'
  const trace = runTableParser(applied.broken)
  if (trace.valid) return 'the result is still valid'
  if (labelReference(applied.broken).valid) throw new Error(`the tables reject a text that the reference accepts: ${JSON.stringify(applied.broken)}`)
  for (let position = 0; position < trace.length; position++) if (trace.depthAfter[position]! > maximumDepth) return 'the result is deeper than 16 levels'
  const broken = Array.from(applied.broken)
  const unscored = unscoredOf(original, broken, labels, applied.alignment, applied.replaced, applied.firstDamage, trace, planned.unscoredKinds)
  const scored = applyUnscored(applied.alignment, labels, unscored.unscoredKinds, unscored.unscoredNesting)
  if (countScored(scored, trace.firstErrorPosition) === 0) return 'the result leaves no code point to score'
  const draft: Draft = {
    source: 'damage', recipe: planned.kinds.length === 1 ? 'one mistake' : 'two mistakes', kinds: planned.kinds, forms: planned.forms, editCount: planned.kinds.length,
    documents: [text], original: text, broken: applied.broken, lineEnd: scanned.lineEnd, edits, alignment: applied.alignment, replaced: applied.replaced, ...unscored,
    firstDamage: applied.firstDamage, firstErrorPosition: trace.firstErrorPosition, firstErrorKind: trace.firstErrorKind,
    reachable: planned.reachable, needsClass: planned.needsClass, needsNestingFix: limitsOf(broken, scored, trace.firstErrorPosition).needsNestingFix, debatable: planned.debatable,
    needsRules: [], needsDisplayFix: false, split: 'test',
  }
  documentLabels.set(draft, labels)
  return draft
}

// A document of the test split, checked by the tables and by Bun's parser as the dataset checks its documents, or
// undefined when the drawn document is in another split or is too long for the mistakes' margin.
function testDocument(random: Random, template: Template, layout: Layout, maximumLength: number): Scan | undefined {
  const document = makeDocumentOf(random, template, layout, {maximumLength})
  if (document === undefined || splitOf(document.text) !== 'test') return undefined
  if (!runTableParser(document.text).valid) throw new Error(`the tables reject a document of the template ${template}: ${JSON.stringify(document.text)}`)
  if (!bunAccepts(document.text)) throw new Error(`Bun's parser rejects a document of the template ${template}: ${JSON.stringify(document.text)}`)
  return scan(document.text)
}

// How many documents of the test split a sample may try, and after how many of them without a sample another plan of
// kinds is drawn. A sample that asks for one kind keeps that kind.
const maximumDocuments = 6000
const documentsPerPlan = 150

// The sample with the given index of a seed.
//
// The kinds are drawn first: one, or two that can share a text. Then documents are drawn, each from a held-out template
// with probability one half, until one is in the test split and has a place for the mistakes, and the result is a
// broken text with something to score. After 150 documents of the test split without a sample, other kinds are drawn:
// some kinds find a place in few documents, e.g. a string of several lines.
//
// `kind` asks for a sample with that one kind of mistake. Such a sample draws from a seed of its kind, so that the
// samples of two kinds with the same index do not share their documents.
export function sampleAt(seed: number, index: number, options: {kind?: string} = {}): Sample {
  if (options.kind !== undefined) kindNamed(options.kind)
  const random = createRandom(options.kind === undefined ? seed : (seed ^ hashText(options.kind)) >>> 0, index)
  let kindNames = options.kind === undefined ? drawKinds(random) : [options.kind]
  let documentsOfPlan = 0
  const discarded: DiscardReason[] = []
  for (let documentCount = 0; documentCount < maximumDocuments;) {
    if (options.kind === undefined && documentsOfPlan >= documentsPerPlan) {
      kindNames = drawKinds(random)
      documentsOfPlan = 0
    }
    const template = drawTemplate(random, random.chance(heldOutShare) ? heldOutTemplates : usedTemplates.filter(name => !heldOutTemplates.includes(name)))
    const layout = drawLayout(random)
    const margin = kindNames.reduce((total, name) => total + (kindNamed(name).margin ?? 0), 0)
    const scanned = testDocument(random, template, layout, capacity - margin)
    if (scanned === undefined) continue
    documentCount++
    documentsOfPlan++
    const planned = applyKinds(random, scanned, kindNames)
    if (planned === undefined) continue
    const draft = draftOf(scanned, planned)
    if (typeof draft === 'string') {
      discarded.push(draft)
      continue
    }
    const sample: Sample = {id: `${seed}:${index}`, ...draft, template, style: layout.style, heldOut: heldOutTemplates.includes(template) ? [`template: ${template}`] : [], discarded}
    documentLabels.set(sample, scanned.labels)
    return sample
  }
  throw new Error(`sample ${seed}:${index} could not be made from ${maximumDocuments} documents of the test split (kinds: ${kindNames.join(', ')})`)
}

// The label of every code point of the broken text, or undefined for a code point that the mistake added. A value of a
// label that is not scored is undefined, see Label in ../../labels.ts.
export function labelsOf(sample: Sample): (Label | undefined)[] {
  let labels = documentLabels.get(sample)
  if (labels === undefined) {
    const reference = labelReference(sample.original)
    if (!reference.valid) throw new Error(`the document of the sample ${sample.id} is not valid`)
    documentLabels.set(sample, labels = reference.labels)
  }
  return applyUnscored(sample.alignment, labels, sample.unscoredKinds, sample.unscoredNesting)
}

// How many code points a score counts: those from the first error of the parser as it is on that have a label with a
// scored value. Every sample has at least one.
export function scoredCodePoints(sample: Sample, labels: readonly (Label | undefined)[] = labelsOf(sample)) {
  return countScored(labels, sample.firstErrorPosition)
}

// Where the loop's one limit shows in a sample, see ../../limits.ts.
export function limitsFor(sample: Sample, labels: readonly (Label | undefined)[] = labelsOf(sample)) {
  return limitsOf(Array.from(sample.broken), labels, sample.firstErrorPosition)
}
export function mostRightFor(sample: Sample, labels: readonly (Label | undefined)[] = labelsOf(sample)) {
  return mostRightOf(Array.from(sample.broken), labels, sample.firstErrorPosition)
}

// One group per sample, by what it takes to label it, with the names of the JSON dataset's groups. The first group
// that fits, in this order.
export const groups = [
  // The flag is 'no': a judgment about every parser of the tables' form.
  'out of reach',
  // The scored depths cannot all come out of the loop, see needsNestingFix: a proof.
  'needs a nesting fix',
  // The tokenizer must tell characters apart that its classes lump together, see needsClass: a judgment per form.
  'needs a character class',
  // The flag is 'line rule': a judgment.
  'needs a line rule',
  // None of the above.
  'within reach of the tables',
] as const
export type Group = typeof groups[number]
export function groupOf(sample: Sample): Group {
  if (sample.reachable === 'no') return 'out of reach'
  if (sample.needsNestingFix) return 'needs a nesting fix'
  if (sample.needsClass.length > 0) return 'needs a character class'
  if (sample.reachable === 'line rule') return 'needs a line rule'
  return 'within reach of the tables'
}

// The samples `from` to `to - 1` of a seed in the shape that samplesOf of ../../learn/data.ts takes, so that the code
// which scores tables on the dataset scores them on this set: samplesOf(labeledTexts()). Every text is in the test
// split, so that code asks for the environment variable RECOVERY_FINAL.
export function labeledTexts(seed: number = defaultSeed, from = 0, to: number = standardCount): LabeledText[] {
  const texts: LabeledText[] = []
  for (let index = from; index < to; index++) {
    const sample = sampleAt(seed, index)
    texts.push({
      index, split: 'test', source: 'damage', kinds: sample.kinds, group: groupOf(sample), broken: sample.broken, labels: labelsOf(sample), firstDamage: sample.firstDamage,
      original: sample.original, alignment: sample.alignment, replaced: sample.replaced, firstErrorPosition: sample.firstErrorPosition,
    })
  }
  return texts
}

export type {Label, ValidLabel}
