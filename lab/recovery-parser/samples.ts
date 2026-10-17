// The dataset: sampleAt(seed, index) makes one sample, without making the ones before it.
//
// A sample is a broken text, the valid text its author meant, and which code points of one are which code points of
// the other. labelsOf(sample) gives, for every code point of the broken text, what is true of its counterpart in the
// original: its display kind, the nesting depth after it, and the innermost open container after it. A code point
// that the damage added has no counterpart and no label.
import {displayKind, maximumDepth} from '../../src/json-search/highlighter/kinds.ts'
import {type Plan, type PlannedDamage, type Reachable, type Rule, drawPlan, planOneKind} from './damage.ts'
import {type Style, type Template, codePointLength, drawLayout, drawTemplate, drawValidLayout, makeDocumentOf} from './documents.ts'
import {type Edit, applyEdits, canonicalEdits, mergeEdits} from './edits.ts'
import {type Label, type ValidLabel, labelsOfValidText} from './labels.ts'
import {type Random, createRandom, hashText} from './random.ts'
import {scan} from './scan.ts'
import {limitsOf, mostRightOf, readsAsNumberOrLiteral} from './limits.ts'
import {type Split, splitOf, splitOfDocuments} from './splits.ts'
import {type ParserTrace, capacity, runTableParser} from './table-parser.ts'
import {type TypingReplay, type TypingStep, makeTypingReplay} from './typing.ts'

export const defaultSeed = 20261015

export const sources = ['valid', 'damage', 'typing'] as const
export type Source = typeof sources[number]

// Held out for testing only: training never sees a sample that has one of these kinds or whose document comes from
// this template.
// - conflictMarkers (family comment): lines to skip up to the line feed, as a # or // comment on a line of its own.
// - nonFiniteNumber (family other notation): a word where a value may come, as undefined and nil.
// - logPrefix (family wrapper): text before the document on its first line, in formats that no line of logLines has.
// - concatenated (family several documents): a new document after a complete one, as one document per line.
// Tables read cells and not kinds, and these kinds reach cells that kinds in training reach too. So the held-out kinds
// say something about an arm that sees characters, e.g. a network that never saw <<<<<<< or NaN, and little about tables.
export const heldOutKinds: readonly string[] = ['conflictMarkers', 'nonFiniteNumber', 'logPrefix', 'concatenated']
// A business record with an array of objects, a nested object, nulls and strings with escapes. Every one of its
// features is in other templates, and its sequence of tokens is in none. Every run of 8 tokens of it is in some
// training document, and one run of 24 in seven, so it is new only to an arm that looks at more than a few tokens.
export const heldOutTemplate: Template = 'order'

export type Sample = {
  // The seed and the index, e.g. "20261015:1234".
  id: string
  source: Source
  // How the kinds were chosen: 'valid', 'typing', 'one kind', 'several kinds', or the name of a combination with one
  // cause, e.g. 'javascriptLiteral'.
  recipe: string
  // The kinds of damage in the text, e.g. ['missingComma', 'openStringAtLineEnd'].
  kinds: string[]
  // Per applied kind, which form it took and where, e.g. "missingComma: at a line end between two members".
  forms: string[]
  // The document's template, or what the documents are when a kind made its own, e.g. "records: event".
  template: string
  style: Style
  // The valid documents that the author meant: one, except for several documents in one text, where each holds the
  // white space that follows it. In a sample of a typing replay it is the document that the typing leads to, or, when
  // an entry is being deleted, the document before the deletion.
  documents: string[]
  // The documents joined. It is a valid JSON text when there is one document.
  original: string
  broken: string
  // What ends the lines of the original, and of the broken text where the damage did not touch a line end: a line
  // feed, or a carriage return and a line feed. The second is what a few valid samples, one form of newlineDelimited
  // and one damaged document in 20 with several lines have.
  lineEnd: '\n' | '\r\n'
  // What turns the original into the broken text, in text order, with positions in code points of the original. They
  // are in the canonical form of edits.ts: of two equal code points, the later one is the removed or the added one.
  edits: Edit[]
  // For each code point of the broken text: the index of its counterpart in the original, or -1 when the damage added it.
  alignment: number[]
  // For each code point of the broken text: whether it stands in the place of its counterpart and differs from it,
  // e.g. ' for ". It has the counterpart's label.
  replaced: boolean[]
  // Indexes into the original of kept code points whose display kind is not scored, and of those whose depth and
  // container are not scored. See `unscoredOf` for the rules.
  unscoredKinds: number[]
  unscoredNesting: number[]
  // The index in the broken text of the first damaged code point: the first that is added or replaced, the first
  // kept one after a removed part, or the first one of a second document. It is the broken text's length when only
  // the original's end is missing, and -1 in a valid sample.
  firstDamage: number
  // Where the parser as it is reports its first error in the broken text, and the error's kind as in kinds.ts. -1 and 0
  // in a valid sample. The position is never before firstDamage and can be after it, e.g. after a removed closing
  // bracket. Scores count the code points from this position on: before it, every parser that reads valid JSON as the
  // highlighter does gives what the parser as it is gives, and every scored label there is what it gives.
  firstErrorPosition: number
  firstErrorKind: number
  reachable: Reachable
  // The rules that a parser needs for this sample and that another rule contradicts, see `contradictions` in
  // damage/types.ts, e.g. ['a string after a key is the next key'].
  needsRules: Rule[]
  // What the tokenizer must tell apart and cannot with the highlighter's 33 character classes, e.g. the apostrophe as a quote.
  needsClass: string[]
  // True when the scored depths and containers cannot all come out of the highlighter's loop, whatever the cells hold
  // that valid JSON never reads, e.g. the } of {"tags": ["ops", "beta"}, which must close two containers, and a } too
  // many that the tokenizer reads by a cell of valid JSON, so that the loop cannot skip it. See limits.ts for the two
  // conditions and for what the field does not prove.
  needsNestingFix: boolean
  // True when the scored display kinds cannot all come out of the loop as long as the display table is as it is: a
  // cell that valid JSON reads shows a code point as another kind than its label, e.g. the n of the key in
  // {name: "Ada"}, which the tokenizer reads as the start of null. See limits.ts.
  needsDisplayFix: boolean
  // Whether another sensible repair would give other scored labels to kept code points.
  debatable: boolean
  // The split of the sample's documents, see splits.ts. Every document of a text of several documents is in it.
  split: Split
  // What makes the sample one that training never sees, e.g. ['kind: logPrefix', 'template: order'].
  heldOut: string[]
  // For a sample of a typing replay: the editor, what was typed, and the key press.
  typing?: {editor: TypingReplay['editor'], action: TypingReplay['action'], comma: TypingReplay['comma'], target: string, step: number, steps: number}
}

const parses = (text: string) => {
  try {
    JSON.parse(text)
  } catch {
    return false
  }
  return true
}

const punctuation = displayKind.punctuation

// The label values that are not scored, as indexes into the original. Four rules:
// - What a kind of damage declares, e.g. the quote of "call "Ana" back" that lost its backslash.
// - Before the first error of the parser as it is, a value that the parser as it is does not give. Up to its first
//   error a text is the start of a valid text, and every arm of the experiment reads valid JSON as now. E.g. in
//   {"a": <line feed> "b": 1}, where the value of "a" is not typed yet, "b" is read as that value, and the label says key.
// - Where the labels' depth or container changes at a code point that is not a bracket, a bracket was removed before
//   it and nothing in the text shows the change. From there to the next kept bracket the depth and the container are
//   not scored, e.g. for the line feed after {"tags": ["ops", "beta"<line feed>}, where the ] is missing.
// - A string value that lost its opening quote and stands after white space or punctuation starts where a number or
//   a literal can start. Its first code points that read as one have a display kind that is not scored, e.g. the 0.2
//   of `version: 0.2.0` and the t of `NODE_ENV: test`: at the t no parser can tell test from true. Before the first
//   error the second rule says the same, and this rule says it for the rest of the text. The white space or the
//   punctuation can be the damage's own, e.g. the indentation of the line after an added comment. After another added
//   code point the rule does not apply, e.g. after the ; of &quot;, which stands for the opening quote. A key is
//   another matter: no literal can stand where a key is expected, so the n of the key `name` is scored, see
//   needsDisplayFix.
function unscoredOf(original: readonly string[], broken: readonly string[], labels: readonly ValidLabel[], alignment: readonly number[], firstDamage: number, trace: ParserTrace, declared: readonly number[]) {
  const kept = new Set(alignment)
  const kinds = new Set(declared.filter(index => kept.has(index)))
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
    if (original[index - 1] !== '"' || labels[index - 1]!.kind !== displayKind.string || kept.has(index - 1)) continue
    // What stands before it in the broken text is white space or punctuation: a kept code point by its label, and one
    // that the damage added by what it is, e.g. the indentation after an added line with a # comment.
    if (position > 0) {
      const before = alignment[position - 1]!
      if (before === -1 ? !' \t\r\n{}[]:,'.includes(broken[position - 1]!) : kinds.has(before) || (labels[before]!.kind !== displayKind.whitespace && labels[before]!.kind !== punctuation)) continue
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

type Draft = Omit<Sample, 'id' | 'split' | 'heldOut'>
// The labels of a sample's documents, kept from the making of the sample so that labelsOf does not parse them again.
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

// Builds a sample from documents and edits, or returns undefined when the result breaks a constraint: every document
// valid and all of them in one split, the broken text rejected by JSON.parse and by the highlighter's tables, both
// texts within 512 code points and 16 levels.
type DraftParts = {
  source: Source, recipe: string, kinds: string[], forms: string[], template: string, style: Style, documents: string[], edits: Edit[],
  unscoredKinds: number[], reachable: Reachable, needsRules: Rule[], needsClass: string[], debatable: boolean,
}
function draftOf(parts: DraftParts): Draft | undefined {
  const original = parts.documents.join('')
  if (codePointLength(original) > capacity) return undefined
  if (parts.documents.length > 1 && splitOfDocuments(parts.documents) === undefined) return undefined
  const labels: ValidLabel[] = []
  for (const document of parts.documents) {
    if (!parses(document)) return undefined
    try {
      for (const label of labelsOfValidText(document)) labels.push(label)
    } catch {
      return undefined
    }
  }
  const originalCodePoints = Array.from(original)
  const merged = mergeEdits([parts.edits], originalCodePoints.length)
  if (merged === undefined) return undefined
  const edits = canonicalEdits(originalCodePoints, merged)
  const applied = applyEdits(originalCodePoints, edits)
  if (applied.alignment.length > capacity) return undefined
  // The first code point of the second document is damage too: the grammar has no place for it.
  let firstDamage = applied.firstDamage
  if (parts.documents.length > 1) {
    const boundary = Array.from(parts.documents[0]!).length
    const second = applied.alignment.findIndex(index => index >= boundary)
    if (second !== -1 && (firstDamage === -1 || second < firstDamage)) firstDamage = second
  }
  const {unscoredKinds: _declared, ...rest} = parts
  const lineEnd: Sample['lineEnd'] = original.includes('\r\n') ? '\r\n' : '\n'
  const common = {...rest, original, broken: applied.broken, lineEnd, edits, alignment: applied.alignment, replaced: applied.replaced, firstDamage}
  let draft: Draft
  if (parts.source === 'valid') {
    draft = {...common, unscoredKinds: [], unscoredNesting: [], firstErrorPosition: -1, firstErrorKind: 0, needsNestingFix: false, needsDisplayFix: false}
  } else {
    if (parses(applied.broken)) return undefined
    const trace = runTableParser(applied.broken)
    if (trace.valid) return undefined
    for (let position = 0; position < trace.length; position++) if (trace.depthAfter[position]! > maximumDepth) return undefined
    const brokenCodePoints = Array.from(applied.broken)
    const unscored = unscoredOf(originalCodePoints, brokenCodePoints, labels, applied.alignment, firstDamage, trace, parts.unscoredKinds)
    const scored = applyUnscored(applied.alignment, labels, unscored.unscoredKinds, unscored.unscoredNesting)
    const limits = limitsOf(brokenCodePoints, scored, trace.firstErrorPosition)
    draft = {
      ...common, ...unscored, firstErrorPosition: trace.firstErrorPosition, firstErrorKind: trace.firstErrorKind,
      needsNestingFix: limits.needsNestingFix, needsDisplayFix: limits.needsDisplayFix,
    }
    // With no scored value from the first error on, nothing is left to recover, whatever the kind of damage: every
    // parser has the sample right, and it needs no rule and no class. E.g. {"a": {"b": 1, "c": 2} without the inner },
    // which reads as a text that is cut off.
    if (!scored.some((label, position) => position >= trace.firstErrorPosition && label !== undefined && (label.kind !== undefined || label.depth !== undefined))) {
      draft = {...draft, reachable: 'yes', needsRules: [], needsClass: []}
    }
  }
  documentLabels.set(draft, labels)
  return draft
}

const heldOutOf = (kinds: readonly string[], template: string) =>
  [...kinds.filter(kind => heldOutKinds.includes(kind)).map(kind => `kind: ${kind}`), ...(template === heldOutTemplate ? [`template: ${template}`] : [])]

function finish(seed: number, index: number, draft: Draft): Sample {
  const sample: Sample = {id: `${seed}:${index}`, ...draft, split: splitOfDocuments(draft.documents)!, heldOut: heldOutOf(draft.kinds, draft.template)}
  const labels = documentLabels.get(draft)
  if (labels !== undefined) documentLabels.set(sample, labels)
  return sample
}

// What a try gives: a draft, nothing when the document has no place for the damage or the result breaks a constraint,
// or the note that the document of this template is not in the split that is needed, which typing and valid samples
// know before the rest of the work.
type OtherSplit = {otherSplit: Template}
type Attempt = Draft | undefined | OtherSplit

// One damaged document in 20 with several lines is a file whose lines end with a carriage return and a line feed, as
// files from Windows do. Which ones is a hash of the document, so that all broken texts of one document agree.
const carriageReturnShare = 20
const carriageReturnClass = 'the carriage return apart from the tab, inside a string'

// The same damage to the same document in a file whose lines end with \r\n: every line feed of the document and of
// the added text has a carriage return before it, and the edits are moved to the places they have in that text. The
// labels then come from the document with \r\n as from any original. Returns undefined when the damage does not
// carry over as it is:
// - quotedDocument and backslashEscapedDocument write a line feed as the two characters \n, where such a file would
//   have \r\n, and an edit that already adds a carriage return has its own line ends.
// - Texts of several documents have line ends of their own, see newlineDelimited.
function withCarriageReturns(parts: DraftParts): DraftParts | undefined {
  if (parts.documents.length !== 1 || parts.kinds.includes('quotedDocument') || parts.kinds.includes('backslashEscapedDocument')) return undefined
  const text = parts.documents[0]!
  if (!text.includes('\n') || text.includes('\r') || hashText(`line ends ${text}`) % carriageReturnShare !== 0) return undefined
  if (parts.edits.some(edit => edit.insert.includes('\r') || edit.oneForOne === true && edit.insert.includes('\n'))) return undefined
  const codePoints = Array.from(text)
  // The line feeds before each code point: a code point's place moves to the right by that many.
  const lineFeedsBefore = new Int32Array(codePoints.length + 1)
  codePoints.forEach((character, index) => { lineFeedsBefore[index + 1] = lineFeedsBefore[index]! + Number(character === '\n') })
  const edits = parts.edits.map((edit): Edit => {
    if (edit.oneForOne === true && lineFeedsBefore[edit.at + edit.remove] !== lineFeedsBefore[edit.at]) throw new Error('an edit replaces a line feed one for one')
    return {...edit, at: edit.at + lineFeedsBefore[edit.at]!, remove: edit.remove + lineFeedsBefore[edit.at + edit.remove]! - lineFeedsBefore[edit.at]!, insert: edit.insert.replaceAll('\n', '\r\n')}
  })
  // A line feed that is not scored becomes a carriage return and a line feed that are not scored.
  const unscoredKinds = parts.unscoredKinds.flatMap(index => codePoints[index] === '\n' ? [index + lineFeedsBefore[index]!, index + lineFeedsBefore[index]! + 1] : [index + lineFeedsBefore[index]!])
  // A string that is open at its line end now meets the carriage return first. Tables must end the string there and
  // must go on with the string at a tab, e.g. in "fragile<tab>handle with care", and the two are one character class.
  const endsAtLineFeed = parts.needsRules.includes('a string that is open at a line feed ends there')
  return {...parts, documents: [text.replaceAll('\n', '\r\n')], edits, unscoredKinds, needsClass: endsAtLineFeed ? [...parts.needsClass, carriageReturnClass] : parts.needsClass}
}

function damageDraft(random: Random, plan: Plan, forcedTemplate: Template | undefined): Draft | undefined {
  const template = forcedTemplate ?? drawTemplate(random, plan.request.templates)
  const layout = drawLayout(random, plan.request.styles, plan.request.layout)
  const document = makeDocumentOf(random, template, layout, plan.request)
  if (document === undefined) return undefined
  const planned: PlannedDamage | undefined = plan.apply(random, scan(document.text))
  if (planned === undefined) return undefined
  const parts: DraftParts = {
    source: 'damage', recipe: plan.recipe, kinds: planned.kinds, forms: planned.forms, template: planned.template ?? template, style: planned.style ?? document.layout.style,
    documents: planned.documents ?? [document.text], edits: planned.edits, unscoredKinds: planned.unscoredKinds, reachable: planned.reachable,
    needsRules: planned.needsRules, needsClass: planned.needsClass, debatable: planned.debatable,
  }
  const draft = draftOf(parts)
  if (draft === undefined) return undefined
  // The file with \r\n is made after the sample with line feeds and takes its place only when it holds every
  // constraint too, e.g. the 512 code points. So the choice costs no try and changes no other sample.
  const converted = withCarriageReturns(parts)
  return (converted === undefined ? undefined : draftOf(converted)) ?? draft
}

// A whole typing replay with the document it was made of, for dumps that show replays in order.
export function typingReplayOf(random: Random, template?: Template, neededSplit?: Split) {
  const chosen = template ?? drawTemplate(random)
  // People edit indented files most, and one-line texts such as request bodies sometimes.
  const layout = drawLayout(random, [random.weighted([['indented', 64], ['tabbed', 12], ['spaced', 16], ['compact', 8]])])
  const document = makeDocumentOf(random, chosen, layout, {maximumLength: capacity})
  if (document === undefined) return undefined
  if (neededSplit !== undefined && splitOf(document.text) !== neededSplit) return {otherSplit: chosen}
  const replay = makeTypingReplay(random, scan(document.text))
  return replay === undefined ? undefined : {replay, template: chosen, style: document.layout.style}
}
const isOtherSplit = (made: object | undefined): made is OtherSplit => made !== undefined && 'otherSplit' in made

// One text of a fresh replay: every key press that leaves a broken text is as likely as any other.
function typingDraft(random: Random, forcedTemplate: Template | undefined, neededSplit: (template: Template) => Split | undefined): Attempt {
  const template = forcedTemplate ?? drawTemplate(random)
  const made = typingReplayOf(random, template, neededSplit(template))
  if (made === undefined || isOtherSplit(made)) return made
  const {replay, style} = made
  const broken: [step: TypingStep, index: number][] = []
  replay.steps.forEach((step, index) => { if (!step.valid) broken.push([step, index]) })
  while (broken.length > 0) {
    const [[step, index]] = broken.splice(random.integer(0, broken.length - 1), 1) as [[TypingStep, number]]
    if (step.kinds.length === 0) throw new Error(`a typing step is broken and has no kind: ${JSON.stringify(step.text)}`)
    const draft = draftOf({
      source: 'typing', recipe: 'typing', kinds: step.kinds, template, style, documents: [replay.finished], edits: step.edits,
      forms: [`typing: ${replay.editor} editor, ${replay.action}, ${replay.target}${replay.comma === 'none' ? '' : `, its comma ${replay.comma}`}, ${index === 0 ? step.key : `key press ${index} of ${replay.steps.length - 1}: ${step.key}`}`],
      unscoredKinds: step.unscoredKinds, reachable: step.reachable, needsRules: step.needsRules, needsClass: [], debatable: step.debatable,
    })
    if (draft === undefined) {
      // The one constraint that a broken step may break is the depth: an open string can hide closers, and a brace in
      // its content then opens a 17th level, e.g. in "name": "fal}}}}, "{count} items"]. Such a step is not a sample.
      if (!parses(step.text) && !runTableParser(step.text).valid && codePointLength(step.text) <= capacity) continue
      throw new Error(`a typing step broke a constraint: ${JSON.stringify(step.text)}`)
    }
    draft.typing = {editor: replay.editor, action: replay.action, comma: replay.comma, target: replay.target, step: index, steps: replay.steps.length - 1}
    return draft
  }
  return undefined
}

function validDraft(random: Random, forcedTemplate: Template | undefined, neededSplit: (template: Template) => Split | undefined): Attempt {
  const template = forcedTemplate ?? drawTemplate(random)
  const document = makeDocumentOf(random, template, drawValidLayout(random), {})
  if (document === undefined) return undefined
  const needed = neededSplit(template)
  if (needed !== undefined && splitOf(document.text) !== needed) return {otherSplit: template}
  return draftOf({
    source: 'valid', recipe: 'valid', kinds: [], forms: [], template, style: document.layout.style, documents: [document.text], edits: [],
    unscoredKinds: [], reachable: 'yes', needsRules: [], needsClass: [], debatable: false,
  })
}

// How many tries a sample gets. A try fails when the document has no place for the damage, when the result breaks a
// constraint, e.g. it is still valid JSON, or when the original is not in the split that the sample needs.
const maximumTries = 4000
// After this many failed tries in a row, a damage sample draws another plan.
const triesPerPlan = 120
// After this many tries that did not find a document in the split that a decision needs, the decision is dropped and
// the sample starts again. That happens to a plan that finds a place in very few documents, e.g. three kinds that each
// need another feature, and it makes such a plan a little rarer among the held-out samples than among the others.
const triesPerDecision = 600

// The mix of sources: 5 valid documents, 20 texts of typing replays and 75 damaged texts out of 100.
const sourceWeights: readonly (readonly [Source, number])[] = [['valid', 5], ['typing', 20], ['damage', 75]]

// Options: `source` and `kind` ask for a sample of that source, or with that one kind of damage. `split` asks for a
// sample of that split, e.g. to collect a fixed number of test samples per kind: sampleAt(seed, index, {kind, split:
// 'test'}). A held-out kind or template only has samples in the test split.
export function sampleAt(seed: number, index: number, options: {source?: Source, kind?: string, split?: Split} = {}): Sample {
  const random = createRandom(seed, index)
  const source = options.source ?? (options.kind === undefined ? random.weighted(sourceWeights) : 'damage')
  // The split that a sample with these kinds and this template must be in: the test split when it is held out.
  const neededSplitOf = (kinds: readonly string[], template: string): Split | undefined =>
    kinds.some(kind => heldOutKinds.includes(kind)) || template === heldOutTemplate ? 'test' : options.split
  let plan: Plan | undefined
  let failedInARow = 0
  // The first try that fails only because its original is in another split decides what the sample is: the later tries
  // keep its plan, its held-out kinds and whether its template is the held-out one, and make other documents until one
  // falls into the split. So a held-out kind or template is as frequent among the samples as among the first tries,
  // and a held-out kind sits on the held-out template as often as any other kind does.
  let decided: {heldOut: string, template: Template | undefined} | undefined
  let triesSinceDecision = 0
  for (let attempt = 0; attempt < maximumTries; attempt++) {
    if (decided !== undefined && ++triesSinceDecision > triesPerDecision) {
      decided = undefined
      triesSinceDecision = 0
      failedInARow = triesPerPlan
    }
    let made: Attempt
    if (source === 'valid') {
      made = validDraft(random, decided?.template, template => neededSplitOf([], template))
    } else if (source === 'typing') {
      made = typingDraft(random, decided?.template, template => neededSplitOf([], template))
    } else {
      if (plan === undefined || (failedInARow >= triesPerPlan && decided === undefined)) {
        plan = options.kind === undefined ? drawPlan(random, plan) : planOneKind(random, options.kind)
        failedInARow = 0
      }
      made = damageDraft(random, plan, decided?.template)
    }
    if (made === undefined) {
      failedInARow++
      continue
    }
    if (isOtherSplit(made)) {
      // Only a typing or a valid sample says so before it is made, and what can hold it out is its template alone.
      decided ??= {heldOut: heldOutOf([], made.otherSplit).join(), template: made.otherSplit === heldOutTemplate ? heldOutTemplate : undefined}
      continue
    }
    const heldOut = heldOutOf(made.kinds, made.template).join()
    if (decided !== undefined && heldOut !== decided.heldOut) continue
    const needed = neededSplitOf(made.kinds, made.template)
    if (needed === undefined || splitOfDocuments(made.documents) === needed) {
      // A held-out sample cannot be made for another split than the test split.
      if (options.split !== undefined && needed !== options.split) continue
      return finish(seed, index, made)
    }
    decided ??= {heldOut, template: made.template === heldOutTemplate ? heldOutTemplate : undefined}
  }
  throw new Error(`sample ${seed}:${index} could not be made in ${maximumTries} tries (source ${source}${plan === undefined ? '' : `, plan ${plan.recipe}`}${decided === undefined ? '' : `, held out by [${decided.heldOut}]`})`)
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
// scored value. 0 means that nothing is left to recover, e.g. in a text that is cut off: such a sample only tests that
// the part before the damage is still labeled as now.
export function scoredCodePoints(sample: Sample, labels: readonly (Label | undefined)[] = labelsOf(sample)) {
  if (sample.firstErrorPosition === -1) return 0
  let count = 0
  for (let position = sample.firstErrorPosition; position < labels.length; position++) {
    const label = labels[position]
    if (label !== undefined && (label.kind !== undefined || label.depth !== undefined)) count++
  }
  return count
}

// Where the limits of the highlighter's loop show in a sample, see Limits in limits.ts: the two fields again, and the
// position of the first code point at which the scored labels can no longer all be right.
export function limitsFor(sample: Sample, labels: readonly (Label | undefined)[] = labelsOf(sample)) {
  return limitsOf(Array.from(sample.broken), labels, sample.firstErrorPosition)
}

// The most code points of a sample, of those that a score counts, that one run of the highlighter's loop can have
// right when the cells that valid JSON never reads may hold anything, see limits.ts: `right` of `counted`. An upper
// bound for every setting of those cells, with or without more states, and no estimate of what tables reach.
export function mostRightFor(sample: Sample, labels: readonly (Label | undefined)[] = labelsOf(sample)) {
  return mostRightOf(Array.from(sample.broken), labels, sample.firstErrorPosition)
}

// One group per broken sample, by what it takes to label it, so that every report splits the samples the same way.
// The first group that fits, in this order. The README says next to its table of groups what each group assumes about
// the parser.
export const groups = [
  // The flag is 'no': a judgment about every parser that reads from left to right.
  'out of reach',
  // The scored depths and containers cannot all come out of the highlighter's loop, see needsNestingFix: a proof
  // under the two conditions of limits.ts.
  'needs a nesting fix',
  // The tokenizer must tell characters apart that its classes lump together, see needsClass: a judgment per form.
  'needs a character class',
  // The flag is 'line rule': a judgment.
  'needs a line rule',
  // The scored display kinds cannot all come out of the loop, see needsDisplayFix: a proof, as for the nesting.
  'needs a display fix',
  // None of the above. Nothing is known that keeps tables of the highlighter's layout from labeling the sample, when
  // the cells that valid JSON never reads may hold anything and the tables may have more states.
  'within reach of the tables',
] as const
export type Group = typeof groups[number]
export function groupOf(sample: Sample): Group {
  if (sample.reachable === 'no') return 'out of reach'
  if (sample.needsNestingFix) return 'needs a nesting fix'
  if (sample.needsClass.length > 0) return 'needs a character class'
  if (sample.reachable === 'line rule') return 'needs a line rule'
  if (sample.needsDisplayFix) return 'needs a display fix'
  return 'within reach of the tables'
}

export type {Label, ValidLabel}
export {type Split, splitKeyOf, splitOf, splitOfDocuments, splits} from './splits.ts'
