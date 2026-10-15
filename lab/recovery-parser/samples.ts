// The dataset: sampleAt(seed, index) makes one sample, without making the ones before it.
//
// A sample is a broken text, the valid text its author meant, and which code points of one are which code points of
// the other. labelsOf(sample) gives, for every code point of the broken text, what is true of its counterpart in the
// original: its display kind, the nesting depth after it, and the innermost open container after it. A code point
// that the damage added has no counterpart and no label.
import {maximumDepth} from '../../src/json-search/highlighter/kinds.ts'
import {highlightReference} from '../../tests/json-search/highlighter/reference.ts'
import {type Plan, type PlannedDamage, type Reachable, drawPlan, planOneKind} from './damage.ts'
import {type Style, type Template, codePointLength, drawLayout, drawTemplate, makeDocumentOf} from './documents.ts'
import {type Edit, applyEdits, mergeEdits} from './edits.ts'
import {type Label, labelsOfValidText} from './labels.ts'
import {type Random, createRandom, hashText} from './random.ts'
import {scan} from './scan.ts'
import {capacity, runTableParser} from './table-parser.ts'
import {type TypingReplay, makeTypingReplay} from './typing.ts'

export const defaultSeed = 20261015

export const sources = ['valid', 'damage', 'typing'] as const
export type Source = typeof sources[number]
export const splits = ['train', 'validation', 'test'] as const
export type Split = typeof splits[number]

// Held out for testing only: training never sees a sample that has one of these kinds or whose document comes from
// this template. Each kind shares its way of recovery with kinds that stay in training, so it tests whether a rule was
// learned or a kind was memorized:
// - conflictMarkers (family comment): lines to skip up to the line feed, as a # or // comment on a line of its own.
// - nonFiniteNumber (family other notation): a word where a value may come, as True and undefined.
// - logPrefix (family wrapper): text before the document on its first line, as a statement or a log's lines.
// - concatenated (family several documents): a new document after a complete one, as one document per line, which
//   reaches the same cells of the grammar table.
export const heldOutKinds: readonly string[] = ['conflictMarkers', 'nonFiniteNumber', 'logPrefix', 'concatenated']
// A business record with an array of objects, a nested object, nulls and strings with escapes. Every one of its
// features is in other templates, and its sequence of tokens is in none.
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
  // white space that follows it.
  documents: string[]
  // The documents joined. It is a valid JSON text when there is one document.
  original: string
  broken: string
  // What turns the original into the broken text, in text order, with positions in code points of the original.
  edits: Edit[]
  // For each code point of the broken text: the index of its counterpart in the original, or -1 when the damage added it.
  alignment: number[]
  // For each code point of the broken text: whether it stands in the place of its counterpart and differs from it,
  // e.g. ' for ". It has the counterpart's label.
  replaced: boolean[]
  // Indexes into the original of kept code points whose display kind is not scored. Their depth and container are.
  unscoredKinds: number[]
  // The index in the broken text of the first damaged code point: the first that is added or replaced, the first
  // kept one after a removed part, or the first one of a second document. It is the broken text's length when only
  // the original's end is missing, and -1 in a valid sample. Scores count the code points from this index on.
  firstDamage: number
  // Where the parser as it is reports its first error in the broken text, and the error's kind as in kinds.ts. The
  // position can be later than firstDamage, e.g. after a removed closing bracket.
  firstErrorPosition: number
  firstErrorKind: number
  reachable: Reachable
  // Characters that the recovery must tell apart and that the highlighter's character classes lump with letters.
  needsClass: string[]
  // Whether another sensible repair would give other labels to kept code points.
  debatable: boolean
  split: Split
  // What makes the sample one that training never sees, e.g. ['kind: logPrefix', 'template: order'].
  heldOut: string[]
  // For a sample of a typing replay: the editor, what was typed, and the key press.
  typing?: {editor: TypingReplay['editor'], action: TypingReplay['action'], comma: TypingReplay['comma'], target: string, step: number, steps: number}
}

// 80% train, 10% validation, 10% test, by a hash of the original, so the same original never sits in two splits.
export function splitOf(original: string): Split {
  const bucket = hashText(original) % 100
  return bucket < 80 ? 'train' : bucket < 90 ? 'validation' : 'test'
}

const isValid = (text: string) => {
  try {
    JSON.parse(text)
  } catch {
    return false
  }
  return highlightReference(text, 0).valid === 1
}
const isRejected = (text: string) => {
  let parses = true
  try {
    JSON.parse(text)
  } catch {
    parses = false
  }
  return !parses && highlightReference(text, 0).valid === 0
}

type Draft = Omit<Sample, 'id' | 'split' | 'heldOut' | 'firstErrorPosition' | 'firstErrorKind'>

// Builds a sample from documents and edits, or returns undefined when the result breaks a constraint: every document
// valid, the broken text rejected by JSON.parse and by the reference highlighter, both texts within 512 code points
// and 16 levels.
function draftOf(parts: {
  source: Source, recipe: string, kinds: string[], forms: string[], template: string, style: Style, documents: string[], edits: Edit[],
  unscoredKinds: number[], reachable: Reachable, needsClass: string[], debatable: boolean,
}): Draft | undefined {
  const original = parts.documents.join('')
  if (codePointLength(original) > capacity || !parts.documents.every(isValid)) return undefined
  const originalCodePoints = Array.from(original)
  const edits = mergeEdits([parts.edits], originalCodePoints.length)
  if (edits === undefined) return undefined
  const applied = applyEdits(originalCodePoints, edits)
  if (applied.alignment.length > capacity) return undefined
  // The first code point of the second document is damage too: the grammar has no place for it.
  let firstDamage = applied.firstDamage
  if (parts.documents.length > 1) {
    const boundary = Array.from(parts.documents[0]!).length
    const second = applied.alignment.findIndex(index => index >= boundary)
    if (second !== -1 && (firstDamage === -1 || second < firstDamage)) firstDamage = second
  }
  if (parts.source !== 'valid') {
    if (!isRejected(applied.broken)) return undefined
    const trace = runTableParser(applied.broken)
    for (let position = 0; position < trace.length; position++) if (trace.depthAfter[position]! > maximumDepth) return undefined
  }
  return {...parts, original, broken: applied.broken, edits, alignment: applied.alignment, replaced: applied.replaced, firstDamage}
}

function finish(seed: number, index: number, draft: Draft, template: string): Sample {
  const reference = highlightReference(draft.broken, 0)
  const heldOut = [...draft.kinds.filter(kind => heldOutKinds.includes(kind)).map(kind => `kind: ${kind}`), ...(template === heldOutTemplate ? [`template: ${template}`] : [])]
  return {id: `${seed}:${index}`, ...draft, firstErrorPosition: reference.firstErrorPosition, firstErrorKind: reference.firstErrorKind, split: splitOf(draft.original), heldOut}
}

// Whether a draft may be a sample: one with a held-out kind or the held-out template must have an original that the
// hash puts into the test split. Then the split stays a function of the original alone.
const mayKeep = (draft: Draft) => {
  const isHeldOut = draft.kinds.some(kind => heldOutKinds.includes(kind)) || draft.template === heldOutTemplate
  return !isHeldOut || splitOf(draft.original) === 'test'
}

function damageDraft(random: Random, plan: Plan, forcedTemplate: Template | undefined): Draft | undefined {
  const template = forcedTemplate ?? drawTemplate(random, plan.request.templates)
  const layout = drawLayout(random, plan.request.styles, plan.request.layout)
  const document = makeDocumentOf(random, template, layout, plan.request)
  if (document === undefined) return undefined
  const planned: PlannedDamage | undefined = plan.apply(random, scan(document.text))
  if (planned === undefined) return undefined
  return draftOf({
    source: 'damage', recipe: plan.recipe, kinds: planned.kinds, forms: planned.forms, template: planned.template ?? template, style: planned.style ?? document.layout.style,
    documents: planned.documents ?? [document.text], edits: planned.edits, unscoredKinds: planned.unscoredKinds, reachable: planned.reachable,
    needsClass: planned.needsClass, debatable: planned.debatable,
  })
}

// A whole typing replay with the document it was made of, for dumps that show replays in order.
export function typingReplayOf(random: Random, template?: Template) {
  const chosen = template ?? drawTemplate(random)
  // People edit indented files most, and one-line texts such as request bodies sometimes.
  const layout = drawLayout(random, [random.weighted([['indented', 64], ['tabbed', 12], ['spaced', 16], ['compact', 8]])])
  const document = makeDocumentOf(random, chosen, layout, {maximumLength: capacity})
  if (document === undefined) return undefined
  const replay = makeTypingReplay(random, scan(document.text))
  return replay === undefined ? undefined : {replay, template: chosen, style: document.layout.style}
}

function typingDrafts(random: Random, forcedTemplate: Template | undefined): {drafts: Draft[], replay: TypingReplay} | undefined {
  const made = typingReplayOf(random, forcedTemplate)
  if (made === undefined) return undefined
  const {replay, template, style} = made
  const drafts: Draft[] = []
  replay.steps.forEach((step, index) => {
    if (step.valid) return
    const draft = draftOf({
      source: 'typing', recipe: 'typing', kinds: step.kinds, template, style, documents: [replay.finished], edits: step.edits,
      forms: [`typing: ${replay.editor} editor, ${replay.action}, ${replay.target}${replay.comma === 'none' ? '' : `, its comma ${replay.comma}`}, ${index === 0 ? step.key : `after key press ${index} of ${replay.steps.length - 1}`}`],
      unscoredKinds: step.unscoredKinds, reachable: step.reachable, needsClass: [], debatable: false,
    })
    if (draft === undefined) {
      // The one constraint that a broken step may break is the depth: an open string can hide closers, and a brace in
      // its content then opens a 17th level, e.g. in "name": "fal}}}}, "{count} items"]. Such a step is not a sample.
      if (isRejected(step.text) && codePointLength(step.text) <= capacity) return
      throw new Error(`a typing step broke a constraint: ${JSON.stringify(step.text)}`)
    }
    if (step.kinds.length === 0) throw new Error(`a typing step is broken and has no kind: ${JSON.stringify(step.text)}`)
    draft.typing = {editor: replay.editor, action: replay.action, comma: replay.comma, target: replay.target, step: index, steps: replay.steps.length - 1}
    drafts.push(draft)
  })
  return {drafts, replay}
}

function validDraft(random: Random, forcedTemplate: Template | undefined): Draft | undefined {
  const template = forcedTemplate ?? drawTemplate(random)
  const document = makeDocumentOf(random, template, drawLayout(random), {})
  if (document === undefined) return undefined
  return draftOf({
    source: 'valid', recipe: 'valid', kinds: [], forms: [], template, style: document.layout.style, documents: [document.text], edits: [],
    unscoredKinds: [], reachable: 'yes', needsClass: [], debatable: false,
  })
}

// How many tries a sample gets. A try fails when the document has no place for the damage, when the result breaks a
// constraint, e.g. it is still valid JSON, or when a held-out sample's original is not in the test split.
const maximumTries = 2000
// After this many failed tries in a row, a damage sample draws another plan.
const triesPerPlan = 120

// The mix of sources: 5 valid documents, 20 texts of typing replays and 75 damaged texts out of 100.
const sourceWeights: readonly (readonly [Source, number])[] = [['valid', 5], ['typing', 20], ['damage', 75]]

export function sampleAt(seed: number, index: number, options: {source?: Source, kind?: string} = {}): Sample {
  const random = createRandom(seed, index)
  const source = options.source ?? (options.kind === undefined ? random.weighted(sourceWeights) : 'damage')
  let plan: Plan | undefined
  let failedInARow = 0
  // Once a try drew the held-out template, the later tries keep it, so that the template is as frequent among the
  // samples as it is among the tries.
  let forcedTemplate: Template | undefined
  for (let attempt = 0; attempt < maximumTries; attempt++) {
    let draft: Draft | undefined
    if (source === 'valid') {
      draft = validDraft(random, forcedTemplate)
    } else if (source === 'typing') {
      // One text of a fresh replay: every key press that leaves a broken text is as likely as any other.
      const typed = typingDrafts(random, forcedTemplate)
      if (typed !== undefined && typed.drafts.length > 0) draft = random.pick(typed.drafts)
    } else {
      if (plan === undefined || failedInARow >= triesPerPlan) {
        plan = options.kind === undefined ? drawPlan(random) : planOneKind(random, options.kind)
        failedInARow = 0
      }
      draft = damageDraft(random, plan, forcedTemplate)
    }
    if (draft === undefined) {
      failedInARow++
      continue
    }
    if (!mayKeep(draft)) {
      if (draft.template === heldOutTemplate) forcedTemplate = heldOutTemplate
      continue
    }
    return finish(seed, index, draft, draft.template)
  }
  throw new Error(`sample ${seed}:${index} could not be made in ${maximumTries} tries`)
}

// The label of every code point of the broken text, or undefined for a code point that the damage added.
export function labelsOf(sample: Sample): (Label | undefined)[] {
  const labels = sample.documents.flatMap(labelsOfValidText)
  const unscored = new Set(sample.unscoredKinds)
  return sample.alignment.map(index => {
    if (index === -1) return undefined
    const label = labels[index]!
    return unscored.has(index) ? {...label, kind: undefined} : label
  })
}

// How many code points at or after the first damage have a label. 0 means that nothing is left to recover, e.g. in a
// text that is cut off: such samples only test that the part before the damage is still labeled as now.
export function labeledAfterDamage(sample: Sample) {
  if (sample.firstDamage === -1) return 0
  let count = 0
  for (let index = sample.firstDamage; index < sample.alignment.length; index++) if (sample.alignment[index] !== -1) count++
  return count
}

export type {Label}
