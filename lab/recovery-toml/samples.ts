// The dataset: sampleAt(seed, index) makes one sample, without making the ones before it.
//
// A sample is a broken text, the valid TOML document its author meant, and which code points of one are which code
// points of the other. labelsOf(sample) gives, for every code point of the broken text, what is true of its
// counterpart in the original: its display kind, the nesting depth after it, and the innermost open container after
// it. A code point that the damage added has no counterpart and no label.
//
// The file is lab/recovery-parser/samples.ts for TOML, with the same names wherever they mean the same. What differs:
// the damage is the ten edits of damage.ts, which know nothing of TOML, so a sample has no judgment about whether a
// parser can label it. The fields that hold such judgments in the JSON dataset are constants here.
import {type DamageStep, damage, editsOf, kinds as damageKinds} from './damage.ts'
import {type Style, type Template, codePointLength, drawLayout, drawTemplate, makeDocumentOf, templates} from './documents.ts'
import {type Edit, applyEdits, canonicalEdits} from './edits.ts'
import {capacity, displayKind, maximumDepth} from './kinds.ts'
import {type Label, type ValidLabel, labelsOfValidText} from './labels.ts'
import {limitsOf, mostRightOf} from './limits.ts'
import {type Random, createRandom} from './random.ts'
import {type Split, splitOf} from './splits.ts'
import {type ParserTrace, runTableParser} from './table-parser.ts'

export const defaultSeed = 20261016

// Where a sample comes from. The JSON dataset has three sources, and code written for it reads the list. Every
// sample of this dataset is a damaged document, and sampleAt makes a valid one only when it is asked to.
export const sources = ['valid', 'damage', 'typing'] as const
export type Source = typeof sources[number]

// Held out for testing only: training and validation never see a sample whose document comes from one of these
// templates. Both are configs of several tables, with arrays of tables, inline tables and comments, as other templates
// have them: what is new is the documents, i.e. their names and their sequences of tokens.
export const heldOutTemplates: readonly Template[] = ['deployConfig', 'taskRunner']

// Why a draw of edits gave no sample.
export const discardReasons = [
  // The payload has no place for a drawn edit, e.g. a second cut of a payload that the first cut left empty.
  'an edit has no place',
  // The edits undo each other, e.g. a code point is inserted and the next edit deletes it.
  'the result is unchanged',
  'the result is longer than 512 code points',
  // The parser as it is reads the result without an error, e.g. after an edit inside a comment or a string.
  'the result is still valid',
  // The parser as it is counts more than 16 open brackets somewhere in the result.
  'the result is deeper than 16 levels',
  // No code point at or after the first error has a label with a scored value, e.g. a payload that is cut off.
  'the result leaves no code point to score',
] as const
export type DiscardReason = typeof discardReasons[number]

export type Sample = {
  // The seed and the index, e.g. "20261016:1234".
  id: string
  source: Source
  // How many edits were drawn: 'one edit', 'two edits' or 'three edits'. 'valid' for a valid sample.
  recipe: string
  // The kinds of the edits, each once, in the order of their first use, e.g. ['deleteLine', 'insertCodePoint'].
  kinds: string[]
  // The edits as they were made, one entry per edit and in their order, e.g. 'deleteCodePoint: "=" at 14'. A position
  // is one in the payload that the edit got, which is the original only for the first edit.
  forms: string[]
  // The number of edits, 1 to 3. 0 in a valid sample.
  editCount: number
  template: Template
  style: Style
  // The valid document that the author meant, as a list of one, as the JSON dataset has it.
  documents: string[]
  // The same document.
  original: string
  broken: string
  // What ends the lines of the original: a line feed, or a carriage return and a line feed in one document in 25.
  lineEnd: '\n' | '\r\n'
  // What turns the original into the broken text, in text order, with positions in code points of the original. They
  // are in the canonical form of edits.ts: of two equal code points, the later one is the removed or the added one.
  // They describe the result of all the drawn edits together, e.g. one removal for a line that was copied and then
  // deleted with its copy.
  edits: Edit[]
  // For each code point of the broken text: the index of its counterpart in the original, or -1 when the damage added it.
  alignment: number[]
  // For each code point of the broken text: whether it stands in the place of its counterpart and differs from it.
  // Always false here: the damage cannot say that one code point plays the part of another.
  replaced: boolean[]
  // Indexes into the original of kept code points whose display kind is not scored, and of those whose depth and
  // container are not scored. See `unscoredOf` for the rules.
  unscoredKinds: number[]
  unscoredNesting: number[]
  // The index in the broken text of the first damaged code point: the first that is added, or the first kept one
  // after a removed part. It is the broken text's length when only the original's end is missing, and -1 in a valid
  // sample.
  firstDamage: number
  // Where the parser as it is reports its first error in the broken text, and the error's kind as in kinds.ts. -1 and 0
  // in a valid sample. The position is never before firstDamage and can be after it, e.g. after a removed closing
  // bracket. Scores count the code points from this position on: before it, every parser that reads valid TOML as the
  // tables do gives what the parser as it is gives, and every scored label there is what it gives.
  firstErrorPosition: number
  firstErrorKind: number
  // True when the scored depths cannot all come out of the loop of table-parser.ts, whatever its tables hold, because
  // the depth moves by one level per code point at most. See limits.ts for how little that proves.
  needsNestingFix: boolean
  // The JSON dataset judges, per form of a kind of damage, whether a parser can label the rest, which rules and which
  // character classes that takes, and whether another repair is as sensible. Edits that know nothing of TOML come with
  // no such judgment, so these five fields say nothing here. They are kept, as constants, so that code written for
  // the JSON dataset reads these samples.
  reachable: 'yes'
  needsRules: never[]
  needsClass: never[]
  needsDisplayFix: false
  debatable: false
  // The split of the sample's document, see splits.ts.
  split: Split
  // What makes the sample one that training never sees, e.g. ['template: deployConfig'].
  heldOut: string[]
  // The draws of edits that gave no sample before the one that did, by their reasons and in their order.
  discarded: DiscardReason[]
}

const punctuation = displayKind.punctuation

// The label values that are not scored, as indexes into the original. Two rules, both from the JSON dataset:
// - Before the first error of the parser as it is, a value that the parser as it is does not give. Up to its first
//   error a text is the start of a valid text, and the experiment reads valid TOML as now. E.g. in `name = tiny"`,
//   where the value lost its opening quote, the `t` is read as the start of `true`, and the label says string.
// - Where the labels' depth or container changes at a code point that is not a bracket, a bracket was removed before
//   it, and nothing in the text shows the change. From there to the next kept bracket the depth and the container are
//   not scored, e.g. for the line feed after `ports = [80, 443` and for the lines after it, where the `]` is missing.
//   A bracket is one of `[ ] { }` that is shown as punctuation, so the bracket of a header counts: from the `[` of
//   the next header on, the depth 0 is scored again.
//
// The JSON dataset has two more rules, and neither is here. A kind of damage can declare that no reading gives a
// display kind, e.g. for the rest of a line after a string that lost its closing quote: edits that know nothing of
// TOML declare nothing, so such code points are scored with labels that no parser can give. And the first code points
// of a string that lost its opening quote are not scored after the first error either, when they read as a number:
// that rule needs to know where a string starts.
function unscoredOf(original: readonly string[], labels: readonly ValidLabel[], alignment: readonly number[], firstDamage: number, trace: ParserTrace) {
  const kinds = new Set<number>()
  const nesting = new Set<number>()
  for (let position = Math.max(0, firstDamage); position < Math.min(trace.firstErrorPosition, alignment.length); position++) {
    const index = alignment[position]!
    if (index === -1) continue
    const label = labels[index]!
    if (label.kind !== trace.displayKind[position]) kinds.add(index)
    if (label.depth !== trace.depthAfter[position] || label.container !== trace.containerAfter[position]) nesting.add(index)
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

// A valid document with what a sample needs of it.
type Original = {template: Template, style: Style, text: string, codePoints: string[], labels: ValidLabel[], split: Split}

const bunAccepts = (text: string) => {
  try {
    Bun.TOML.parse(text)
  } catch {
    return false
  }
  return true
}

// A document of the template, checked by the three parsers: the reference labeler, the tables and Bun's parser. A
// template that makes a document that one of them rejects has a mistake, so that is an error and no reason to draw again.
function originalOf(random: Random, template: Template): Original {
  const layout = drawLayout(random)
  const document = makeDocumentOf(random, template, layout)
  if (document === undefined) throw new Error(`the template ${template} made no document of at most ${capacity} code points`)
  const {text} = document
  const labels = labelsOfValidText(text)
  if (!runTableParser(text).valid) throw new Error(`the tables reject a document of the template ${template}: ${JSON.stringify(text)}`)
  if (!bunAccepts(text)) throw new Error(`Bun's parser rejects a document of the template ${template}: ${JSON.stringify(text)}`)
  return {template, style: layout.style, text, codePoints: Array.from(text), labels, split: splitOf(text)}
}

type Draft = Omit<Sample, 'id' | 'heldOut' | 'discarded'>
const constants = {reachable: 'yes', needsRules: [], needsClass: [], needsDisplayFix: false, debatable: false} as const
const judgments = (): Pick<Sample, 'reachable' | 'needsRules' | 'needsClass' | 'needsDisplayFix' | 'debatable'> => ({...constants, needsRules: [], needsClass: []})

function validDraft(original: Original): Draft {
  const draft: Draft = {
    source: 'valid', recipe: 'valid', kinds: [], forms: [], editCount: 0, template: original.template, style: original.style, documents: [original.text], original: original.text,
    broken: original.text, lineEnd: original.text.includes('\r\n') ? '\r\n' : '\n', edits: [], alignment: original.codePoints.map((_, index) => index), replaced: original.codePoints.map(() => false),
    unscoredKinds: [], unscoredNesting: [], firstDamage: -1, firstErrorPosition: -1, firstErrorKind: 0, needsNestingFix: false, ...judgments(), split: original.split,
  }
  documentLabels.set(draft, original.labels)
  return draft
}

// One draw of edits on a document: a sample, or the reason why the draw gives none.
function damagedDraft(random: Random, original: Original, firstKind: string | undefined): Draft | DiscardReason {
  const damaged = damage(random, original.codePoints, firstKind)
  if (damaged === undefined) return 'an edit has no place'
  const broken = damaged.payload.map(tracked => tracked.character).join('')
  if (broken === original.text) return 'the result is unchanged'
  if (damaged.payload.length > capacity) return 'the result is longer than 512 code points'
  const trace = runTableParser(broken)
  if (trace.valid) return 'the result is still valid'
  for (let position = 0; position < trace.length; position++) if (trace.depthAfter[position]! > maximumDepth) return 'the result is deeper than 16 levels'
  const edits = canonicalEdits(original.codePoints, editsOf(original.codePoints, damaged.payload))
  const applied = applyEdits(original.codePoints, edits)
  if (applied.broken !== broken) throw new Error(`the edits of a damaged payload do not give its text: ${JSON.stringify(broken)}`)
  const unscored = unscoredOf(original.codePoints, original.labels, applied.alignment, applied.firstDamage, trace)
  const scored = applyUnscored(applied.alignment, original.labels, unscored.unscoredKinds, unscored.unscoredNesting)
  if (countScored(scored, trace.firstErrorPosition) === 0) return 'the result leaves no code point to score'
  const steps: DamageStep[] = damaged.steps
  const draft: Draft = {
    source: 'damage', recipe: ['one edit', 'two edits', 'three edits'][steps.length - 1]!, kinds: [...new Set(steps.map(step => step.kind))], forms: steps.map(step => `${step.kind}: ${step.form}`),
    editCount: steps.length, template: original.template, style: original.style, documents: [original.text], original: original.text, broken, lineEnd: original.text.includes('\r\n') ? '\r\n' : '\n',
    edits, alignment: applied.alignment, replaced: applied.replaced, ...unscored, firstDamage: applied.firstDamage, firstErrorPosition: trace.firstErrorPosition, firstErrorKind: trace.firstErrorKind,
    needsNestingFix: limitsOf(Array.from(broken), scored, trace.firstErrorPosition).needsNestingFix, ...judgments(), split: original.split,
  }
  documentLabels.set(draft, original.labels)
  return draft
}

// How many documents a sample may try. A document is drawn again when it is not in the split that the sample needs,
// e.g. a document of a held-out template whose tokens are not in the test split.
const maximumDocuments = 2000
// How many draws of edits one document gets before another document is drawn.
const drawsPerDocument = 400

// The sample with the given index of a seed.
//
// The template is drawn first and stays. Then a document of it is drawn, again and again until it is in the split
// that the sample needs: the test split for a held-out template, and the split that the caller asks for. Then the
// edits are drawn on that document, the number of edits each time anew, until a draw gives a sample: a draw whose
// result is still valid, is unchanged, is longer than 512 code points or leaves nothing to score is thrown away, and
// `discarded` lists the reasons. So the documents are drawn as the templates' weights say, whether or not a document
// is easy to break.
//
// Options: `split` asks for a sample of that split. A held-out template only has samples in the test split, so with
// another split the template is drawn among the others. `kind` asks for a sample whose first edit is of that kind, and
// `source: 'valid'` for a valid sample, i.e. a document without damage.
export function sampleAt(seed: number, index: number, options: {source?: Source, kind?: string, split?: Split} = {}): Sample {
  if (options.source === 'typing') throw new Error('this dataset has no typing replays')
  if (options.kind !== undefined && !damageKinds.some(kind => kind.name === options.kind)) throw new Error(`unknown kind of damage: ${options.kind}`)
  const random = createRandom(seed, index)
  const allowed = options.split === undefined || options.split === 'test' ? templates : templates.filter(template => !heldOutTemplates.includes(template))
  const template = drawTemplate(random, allowed)
  const heldOut = heldOutTemplates.includes(template) ? [`template: ${template}`] : []
  const neededSplit = heldOut.length > 0 ? 'test' : options.split
  for (let documentIndex = 0; documentIndex < maximumDocuments; documentIndex++) {
    const original = originalOf(random, template)
    if (neededSplit !== undefined && original.split !== neededSplit) continue
    if (options.source === 'valid') {
      const draft = validDraft(original)
      const sample: Sample = {id: `${seed}:${index}`, ...draft, heldOut, discarded: []}
      documentLabels.set(sample, original.labels)
      return sample
    }
    const discarded: DiscardReason[] = []
    for (let draw = 0; draw < drawsPerDocument; draw++) {
      const made = damagedDraft(random, original, options.kind)
      if (typeof made === 'string') {
        discarded.push(made)
        continue
      }
      const sample: Sample = {id: `${seed}:${index}`, ...made, heldOut, discarded}
      documentLabels.set(sample, original.labels)
      return sample
    }
  }
  throw new Error(`sample ${seed}:${index} could not be made from ${maximumDocuments} documents of the template ${template}${neededSplit === undefined ? '' : ` in the ${neededSplit} split`}`)
}

// The label of every code point of the broken text, or undefined for a code point that the damage added. A value of a
// label that is not scored is undefined, see Label.
export function labelsOf(sample: Sample): (Label | undefined)[] {
  let labels = documentLabels.get(sample)
  if (labels === undefined) documentLabels.set(sample, labels = sample.documents.flatMap(labelsOfValidText))
  return applyUnscored(sample.alignment, labels, sample.unscoredKinds, sample.unscoredNesting)
}

// How many code points at or after the first damage have a label.
export function labeledAfterDamage(sample: Sample) {
  if (sample.firstDamage === -1) return 0
  let count = 0
  for (let index = sample.firstDamage; index < sample.alignment.length; index++) if (sample.alignment[index] !== -1) count++
  return count
}

// How many code points a score counts: those from the first error of the parser as it is on that have a label with a
// scored value. Every broken sample has at least one.
export function scoredCodePoints(sample: Sample, labels: readonly (Label | undefined)[] = labelsOf(sample)) {
  return sample.firstErrorPosition === -1 ? 0 : countScored(labels, sample.firstErrorPosition)
}

// Where the loop's one limit shows in a sample, see limits.ts: the field needsNestingFix again, and the position of
// the first code point whose scored depth cannot be right together with those before it.
export function limitsFor(sample: Sample, labels: readonly (Label | undefined)[] = labelsOf(sample)) {
  return limitsOf(Array.from(sample.broken), labels, sample.firstErrorPosition)
}

// The most code points of a sample, of those that a score counts, that one run of the loop of table-parser.ts can
// have right: `right` of `counted`. Only a depth that the loop cannot reach costs a code point, so the bound is nearly
// always all of them, see limits.ts.
export function mostRightFor(sample: Sample, labels: readonly (Label | undefined)[] = labelsOf(sample)) {
  return mostRightOf(Array.from(sample.broken), labels, sample.firstErrorPosition)
}

// One group per broken sample, so that every report splits the samples the same way. The JSON dataset groups its
// samples by what it takes to label them, which rests on judgments that this dataset does not have. Here the group is
// the number of edits.
export const groups = ['one edit', 'two edits', 'three edits'] as const
export type Group = typeof groups[number]
export function groupOf(sample: Sample): Group {
  return groups[Math.max(0, sample.editCount - 1)]!
}

export {codePointLength}
export type {Label, ValidLabel}
export {type Split, splitKeyOf, splitOf, splitOfDocuments, splits} from './splits.ts'
