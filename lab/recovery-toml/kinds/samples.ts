// Samples whose damage is a kind of mistake written for TOML: kindsSampleAt(seed, index) makes one, without the ones
// before it.
//
// The sample has the document of the dataset's sample with the same seed and index, i.e. of sampleAt(seed, index) in
// ../samples.ts, and its own damage: one or two kinds of this folder in the place of the dataset's edits. So a
// sample of this folder is in the split of the dataset's sample with its index, the two sets have the same documents,
// and an index of the test split has no sample here: kindsSampleAt throws for it.
//
// A sample has the type of the dataset's samples, with the same rules for the labels and for what is scored:
// - A kept code point has the label of its counterpart in the document, an added one has none, and a code point that
//   stands in the place of another, e.g. the colon of `port: 80`, has the label of the one it stands for. `replaced`
//   marks those.
// - The edits are in the canonical form of ../edits.ts.
// - Not scored are the two things that unscoredOf of ../samples.ts leaves out: before the first error of the parser
//   as it is, a value that this parser does not give, and the depth and the container after a removed bracket up to
//   the next kept bracket. No kind declares more, so some scored labels are out of every parser's reach, e.g. the
//   comma inside a string that lost its closing quote. The README says which kinds have such labels.
import {type Edit, applyEdits, canonicalEdits, mergeEdits} from '../edits.ts'
import {capacity, displayKind, maximumDepth} from '../kinds.ts'
import {type Label, type ValidLabel, labelsOfValidText} from '../labels.ts'
import {limitsOf} from '../limits.ts'
import {type Random, createRandom, hashText} from '../random.ts'
import {type DiscardReason, type Sample, sampleAt} from '../samples.ts'
import {type ParserTrace, runTableParser} from '../table-parser.ts'
import {kindNamed, kinds} from './list.ts'
import {type Scan, scan} from './scan.ts'
import type {Damage, KindDefinition} from './types.ts'

// The share of the draws that are made with two kinds. A kind that never shares a sample comes alone, and a draw of
// two kinds is thrown away more often than a draw of one, so fewer samples have two kinds: 31% of the mixed set's.
export const shareOfTwoKinds = 0.45
// How many draws of kinds one document gets.
const maximumDraws = 400

// The random choices of a sample of this folder are apart from those of the dataset's sample with the same index.
const randomOf = (seed: number, index: number) => createRandom(hashText(`kinds of mistakes, seed ${seed}`), index)

// The label values that are not scored, as indexes into the original: unscoredOf of ../samples.ts, which is not
// exported. check.ts holds this copy against the dataset's samples.
export function unscoredOf(original: readonly string[], labels: readonly ValidLabel[], alignment: readonly number[], firstDamage: number, trace: ParserTrace) {
  const unscoredKinds = new Set<number>()
  const unscoredNesting = new Set<number>()
  for (let position = Math.max(0, firstDamage); position < Math.min(trace.firstErrorPosition, alignment.length); position++) {
    const index = alignment[position]!
    if (index === -1) continue
    const label = labels[index]!
    if (label.kind !== trace.displayKind[position]) unscoredKinds.add(index)
    if (label.depth !== trace.depthAfter[position] || label.container !== trace.containerAfter[position]) unscoredNesting.add(index)
  }
  let previousDepth = 0
  let previousContainer = 0
  let afterRemovedBracket = false
  for (const index of alignment) {
    if (index === -1) continue
    const label = labels[index]!
    const isBracket = label.kind === displayKind.punctuation && '{}[]'.includes(original[index]!)
    if (isBracket) afterRemovedBracket = false
    else if (label.depth !== previousDepth || label.container !== previousContainer) afterRemovedBracket = true
    if (afterRemovedBracket) unscoredNesting.add(index)
    previousDepth = label.depth
    previousContainer = label.container
  }
  const sorted = (set: Set<number>) => [...set].sort((left, right) => left - right)
  return {unscoredKinds: sorted(unscoredKinds), unscoredNesting: sorted(unscoredNesting)}
}

const scoredLabels = (alignment: readonly number[], labels: readonly ValidLabel[], unscoredKinds: readonly number[], unscoredNesting: readonly number[]): (Label | undefined)[] => {
  const kindsLeftOut = new Set(unscoredKinds)
  const nestingLeftOut = new Set(unscoredNesting)
  return alignment.map(index => {
    if (index === -1) return undefined
    const label = labels[index]!
    const nesting = !nestingLeftOut.has(index)
    return {kind: kindsLeftOut.has(index) ? undefined : label.kind, depth: nesting ? label.depth : undefined, container: nesting ? label.container : undefined}
  })
}

// Whether the edits of two kinds sit apart: something other than white space stands between them, and they are on
// different lines or at least 8 code points from each other, as lab/recovery-parser/damage.ts asks of two kinds that
// have nothing to do with each other. Two mistakes that touch are one mistake of another kind.
function sitApart(codePoints: readonly string[], left: readonly Edit[], right: readonly Edit[]) {
  for (const first of left) {
    for (const second of right) {
      const [early, late] = first.at <= second.at ? [first, second] : [second, first]
      const between = codePoints.slice(early.at + early.remove, late.at)
      if (between.every(character => ' \t\r\n'.includes(character)) || (between.length < 8 && !between.includes('\n'))) return false
    }
  }
  return true
}

// Whether two kinds may share a sample. A kind that is marked `alone` never does. Two kinds of the family "around
// the document" do only as a sentence and a code fence, which is how an answer of a language model starts.
function mayShareASample(first: KindDefinition, second: KindDefinition) {
  if (first === second || first.alone === true || second.alone === true) return false
  if (first.family !== 'around the document' || second.family !== 'around the document') return true
  return [first.name, second.name].sort().join(' ') === 'codeFence proseAround'
}

// The kinds of one draw, by their weights: one kind, or two with the probability shareOfTwoKinds.
function drawKinds(random: Random): KindDefinition[] {
  const first = random.weighted(kinds.map(kind => [kind, kind.weight] as const))
  if (!random.chance(shareOfTwoKinds)) return [first]
  const others = kinds.filter(kind => mayShareASample(first, kind))
  return others.length === 0 ? [first] : [first, random.weighted(others.map(kind => [kind, kind.weight] as const))]
}

type Original = {text: string, codePoints: string[], labels: ValidLabel[], scanned: Scan}
type Draft = Pick<Sample, 'recipe' | 'kinds' | 'forms' | 'editCount' | 'broken' | 'edits' | 'alignment' | 'replaced' | 'unscoredKinds' | 'unscoredNesting' | 'firstDamage' | 'firstErrorPosition' | 'firstErrorKind' | 'needsNestingFix'>

// One draw on a document: a sample's own fields, or the reason why the draw gives none. The reasons are the
// dataset's, and 'an edit has no place' also says that the document has no place for a drawn kind, or that two kinds
// touch each other.
function damagedDraft(random: Random, original: Original, drawn: readonly KindDefinition[]): Draft | DiscardReason {
  const damages: Damage[] = []
  for (const kind of drawn) {
    const damage = kind.apply(random, original.scanned)
    if (damage === undefined || damage.edits.length === 0) return 'an edit has no place'
    damages.push(damage)
  }
  if (damages.length === 2 && damages.every(damage => damage.wholeText !== true) && !sitApart(original.codePoints, damages[0]!.edits, damages[1]!.edits)) return 'an edit has no place'
  const merged = mergeEdits(damages.map(damage => damage.edits), original.codePoints.length)
  if (merged === undefined) return 'an edit has no place'
  const edits = canonicalEdits(original.codePoints, merged)
  const applied = applyEdits(original.codePoints, edits)
  if (applied.broken === original.text) return 'the result is unchanged'
  if (applied.alignment.length > capacity) return 'the result is longer than 512 code points'
  const trace = runTableParser(applied.broken)
  if (trace.valid) return 'the result is still valid'
  for (let position = 0; position < trace.length; position++) if (trace.depthAfter[position]! > maximumDepth) return 'the result is deeper than 16 levels'
  const unscored = unscoredOf(original.codePoints, original.labels, applied.alignment, applied.firstDamage, trace)
  const labels = scoredLabels(applied.alignment, original.labels, unscored.unscoredKinds, unscored.unscoredNesting)
  let scored = 0
  for (let position = Math.max(0, trace.firstErrorPosition); position < labels.length; position++) {
    const label = labels[position]
    if (label !== undefined && (label.kind !== undefined || label.depth !== undefined)) scored++
  }
  if (scored === 0) return 'the result leaves no code point to score'
  return {
    recipe: drawn.length === 1 ? 'one kind' : 'two kinds', kinds: [...new Set(drawn.map(kind => kind.name))], forms: drawn.map((kind, index) => `${kind.name}: ${damages[index]!.form}`), editCount: drawn.length,
    broken: applied.broken, edits, alignment: applied.alignment, replaced: applied.replaced, ...unscored, firstDamage: applied.firstDamage, firstErrorPosition: trace.firstErrorPosition, firstErrorKind: trace.firstErrorKind,
    needsNestingFix: limitsOf(Array.from(applied.broken), labels, trace.firstErrorPosition).needsNestingFix,
  }
}

// What a sample of this folder takes from the dataset's sample with the same seed and index: the document and what
// is known about it. Throws for an index of the test split.
function documentOf(seed: number, index: number, known?: Sample) {
  if (known !== undefined && known.id !== `${seed}:${index}`) throw new Error(`the sample ${known.id} is not the dataset's sample ${seed}:${index}`)
  const neutral = known ?? sampleAt(seed, index)
  if (neutral.split === 'test' || neutral.heldOut.length > 0) throw new Error(`the sample ${seed}:${index} of the dataset is in the test split, and this folder makes no sample from it`)
  const original: Original = {text: neutral.original, codePoints: Array.from(neutral.original), labels: labelsOfValidText(neutral.original), scanned: scan(neutral.original)}
  return {neutral, original}
}

function sampleOf(seed: number, index: number, neutral: Sample, draft: Draft, discarded: DiscardReason[]): Sample {
  return {
    id: `${seed}:${index}:kinds`, source: 'damage', template: neutral.template, style: neutral.style, documents: [neutral.original], original: neutral.original, lineEnd: neutral.lineEnd,
    ...draft, reachable: 'yes', needsRules: [], needsClass: [], needsDisplayFix: false, debatable: false, split: neutral.split, heldOut: [], discarded,
  }
}

// The sample of this folder with the given index of a seed: the document of the dataset's sample with that seed and
// index, with one or two kinds of mistakes. The kinds are drawn by their weights, again and again on the same
// document, until a draw gives a sample: a draw is thrown away when the document has no place for a kind, when two
// kinds touch, and for the dataset's reasons, e.g. a result that is still valid or longer than 512 code points.
// `discarded` lists the reasons. So how often a kind comes also depends on how many documents have a place for it.
//
// The fields `reachable`, `needsRules`, `needsClass`, `needsDisplayFix` and `debatable` are the dataset's constants
// and say nothing, as in the dataset. `recipe` is 'one kind' or 'two kinds', and `editCount` the number of kinds.
//
// `datasetSample` is the dataset's sample with that seed and index, for a caller that has made it already: the
// document is then not made a second time.
export function kindsSampleAt(seed: number, index: number, datasetSample?: Sample): Sample {
  const {neutral, original} = documentOf(seed, index, datasetSample)
  const random = randomOf(seed, index)
  const discarded: DiscardReason[] = []
  for (let draw = 0; draw < maximumDraws; draw++) {
    const made = damagedDraft(random, original, drawKinds(random))
    if (typeof made === 'string') discarded.push(made)
    else return sampleOf(seed, index, neutral, made, discarded)
  }
  throw new Error(`no kind of mistake gave a sample on the document of ${seed}:${index} in ${maximumDraws} draws`)
}

// A sample with one given kind alone on the document of the dataset's sample with that seed and index, or undefined
// when 40 draws of the kind give none, e.g. a date in another form on a document without a date. For dumps and counts
// per kind. Its random choices are not those of kindsSampleAt.
export function sampleOfKind(seed: number, index: number, name: string): Sample | undefined {
  const {neutral, original} = documentOf(seed, index)
  const kind = kindNamed(name)
  const random = createRandom(hashText(`one kind, ${name}, seed ${seed}`), index)
  const discarded: DiscardReason[] = []
  for (let draw = 0; draw < 40; draw++) {
    const made = damagedDraft(random, original, [kind])
    if (typeof made === 'string') discarded.push(made)
    else return sampleOf(seed, index, neutral, made, discarded)
  }
  return undefined
}

// What each of `draws` draws of one kind alone gives on the document of an index: 'a sample', or the reason why the
// draw gives none. stats.ts counts with it how many documents have a place for a kind.
export function outcomesOfKind(seed: number, index: number, name: string, draws: number): (DiscardReason | 'a sample')[] {
  const {original} = documentOf(seed, index)
  const kind = kindNamed(name)
  const random = createRandom(hashText(`outcomes of one kind, ${name}, seed ${seed}`), index)
  return Array.from({length: draws}, () => {
    const made = damagedDraft(random, original, [kind])
    return typeof made === 'string' ? made : 'a sample'
  })
}

// The group of a sample of this folder in reports: the number of its kinds.
export const groupsOfKinds = ['one kind', 'two kinds'] as const
export const groupOfKinds = (sample: Sample) => groupsOfKinds[Math.max(0, sample.editCount - 1)]!
