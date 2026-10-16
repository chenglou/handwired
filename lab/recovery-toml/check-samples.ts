// A second derivation of what a sample holds, and the checks of the dataset as a whole.
//
// The dataset takes its labels from the reference labeler. This file takes them from the other parser, the tables run
// on the original, and derives the rest in its own way: its own application of the edits, its own first damage, its
// own reading of the two rules about what is not scored, and its own sequence of tokens for the splits. It takes from
// the dataset only the sample and labelsOf, to have something to compare with.
//
// Run from the repo root: bun lab/recovery-toml/check-samples.ts [samples, default 40000] [seed] [first index]
// It checks, and ends with "every check passed":
// 1. Every sample: the second derivation agrees, so the label of every kept code point is the one that its
//    counterpart has in the original. Every sample has a first error and at least one code point to score.
// 2. The splits: no sequence of tokens is in two splits, no train or validation sample comes from a held-out
//    template, no original of a train or validation sample is the original of a test sample, and a sample that is
//    asked for by split is of that split.
// 3. The damage reads no TOML: damage.ts imports nothing that knows TOML, and the same draws on a payload whose code
//    points are swapped for others, all but the line feed, give the same edits.
// 4. The same seed and index give the same sample twice, and another seed gives other samples.
// invariants.test.ts runs the same checks on fewer samples, and on samples that it spoils on purpose.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {type Tracked, damage, kinds} from './damage.ts'
import {labelReference} from './reference.ts'
import {type Sample, type Split, defaultSeed, heldOutTemplates, labelsOf, sampleAt, splits} from './samples.ts'
import {runTableParser} from './table-parser.ts'
import {createRandom} from './random.ts'

const kindOf = {whitespace: 0, punctuation: 1, string: 2, escape: 3, number: 4, literal: 5, key: 8, headerName: 9, comment: 10} as const
type OwnLabel = {kind: number, depth: number, container: number}

// The labels of a valid text as the tables give them, or undefined when the tables reject the text.
function ownLabels(text: string): OwnLabel[] | undefined {
  const trace = runTableParser(text)
  if (!trace.valid) return undefined
  return Array.from({length: trace.length}, (_, position) => ({kind: trace.displayKind[position]!, depth: trace.depthAfter[position]!, container: trace.containerAfter[position]!}))
}

// A document's tokens, one letter each, from the tables' labels: a punctuation mark as it is, k for a part of a key,
// h for a part of a header's name, s for a string, n for a number, a date, a time or a literal. White space and
// comments are left out. Two documents with the same letters must be in the same split.
export function ownTokenSequence(text: string): string {
  const labels = ownLabels(text)
  if (labels === undefined) throw new Error(`the tables reject ${JSON.stringify(text)}`)
  const codePoints = Array.from(text)
  const letterOf = new Map<number, string>([[kindOf.key, 'k'], [kindOf.headerName, 'h'], [kindOf.string, 's'], [kindOf.number, 'n'], [kindOf.literal, 'n']])
  let tokens = ''
  let previous = ''
  labels.forEach((label, index) => {
    // An escape belongs to the string or the key that it stands in.
    if (label.kind === kindOf.escape) return
    const letter = label.kind === kindOf.punctuation ? codePoints[index]! : letterOf.get(label.kind) ?? ''
    if (label.kind === kindOf.punctuation || letter !== previous) tokens += letter
    previous = label.kind === kindOf.punctuation ? '' : letter
  })
  return tokens
}

const bunAccepts = (text: string) => {
  try {
    Bun.TOML.parse(text)
  } catch {
    return false
  }
  return true
}

// What is wrong with a sample, as sentences, or an empty list.
export function sampleProblems(sample: Sample): string[] {
  const problems: string[] = []
  const original = Array.from(sample.original)
  const broken = Array.from(sample.broken)

  // The document: one, valid for the three parsers, and within the limits.
  if (sample.documents.length !== 1 || sample.documents[0] !== sample.original) problems.push('the documents are not the original alone')
  const labels = ownLabels(sample.original)
  if (labels === undefined) return [...problems, 'the tables reject the original']
  if (!labelReference(sample.original).valid) problems.push('the reference labeler rejects the original')
  if (!bunAccepts(sample.original)) problems.push('Bun\'s parser rejects the original')
  if (original.length > 512 || broken.length > 512) problems.push('a text is longer than 512 code points')
  if (labels.some(label => label.depth > 16)) problems.push('the original nests deeper than 16 levels')
  if ((sample.lineEnd === '\r\n') !== sample.original.includes('\r\n')) problems.push('lineEnd is not what the original has')

  // The edits: in text order, apart from each other, and they give the broken text.
  const ownBroken: string[] = []
  const alignment: number[] = []
  let position = 0
  for (const [index, edit] of sample.edits.entries()) {
    const inserted = Array.from(edit.insert)
    if (edit.at < position || edit.at + edit.remove > original.length) return [...problems, `edit ${index} overlaps the edit before it or leaves the original`]
    if (edit.oneForOne === true) problems.push(`edit ${index} replaces one for one, which the damage of this dataset never does`)
    if (edit.remove === 0 && edit.insert === '') problems.push(`edit ${index} does nothing`)
    for (; position < edit.at; position++) {
      ownBroken.push(original[position]!)
      alignment.push(position)
    }
    for (const character of inserted) {
      ownBroken.push(character)
      alignment.push(-1)
    }
    position = edit.at + edit.remove
    // The canonical form: an edit that only removes or only inserts cannot move one code point to the right and
    // leave the broken text the same, unless it would run into the next edit.
    const limit = sample.edits[index + 1]?.at ?? original.length
    if (edit.insert === '' && edit.remove > 0 && edit.at + edit.remove < limit && original[edit.at + edit.remove] === original[edit.at]) problems.push(`the removal at ${edit.at} could start one code point later`)
    // Text before the whole original is the exception: it stays there, unless it is one code point, once or repeated.
    const oneCodePoint = inserted.every(character => character === inserted[0])
    if (edit.remove === 0 && edit.insert !== '' && edit.at < limit && original[edit.at] === inserted[0] && (edit.at > 0 || oneCodePoint)) problems.push(`the insertion at ${edit.at} could sit one code point later`)
  }
  for (; position < original.length; position++) {
    ownBroken.push(original[position]!)
    alignment.push(position)
  }
  if (ownBroken.join('') !== sample.broken) problems.push('the edits do not give the broken text')
  if (alignment.length !== sample.alignment.length || alignment.some((index, at) => index !== sample.alignment[at])) problems.push('the alignment is not what the edits give')
  if (sample.replaced.length !== broken.length || sample.replaced.some(flag => flag)) problems.push('a code point is flagged as replaced')
  let previous = -1
  alignment.forEach((index, at) => {
    if (index === -1) return
    if (index <= previous) problems.push(`the alignment does not rise at ${at}`)
    previous = index
    if (broken[at] !== original[index]) problems.push(`the kept code point at ${at} differs from its counterpart`)
  })

  const datasetLabels = labelsOf(sample)
  if (datasetLabels.length !== broken.length) return [...problems, 'labelsOf does not return one entry per code point']
  if (sample.source === 'valid') {
    if (sample.broken !== sample.original || sample.edits.length > 0 || sample.firstDamage !== -1 || sample.firstErrorPosition !== -1 || sample.editCount !== 0) problems.push('a valid sample is damaged')
    datasetLabels.forEach((label, at) => {
      const own = labels[at]!
      if (label === undefined || label.kind !== own.kind || label.depth !== own.depth || label.container !== own.container) problems.push(`the label at ${at} of a valid sample is not the text's own`)
    })
    return problems
  }

  // The edits that were drawn: one to three, each of a kind of damage.ts, and `kinds` lists their kinds once each.
  if (sample.source !== 'damage') problems.push(`the source is ${sample.source}`)
  if (sample.editCount < 1 || sample.editCount > 3 || sample.forms.length !== sample.editCount) problems.push('the number of edits is not the number of forms, or not 1 to 3')
  const kindsOfForms = [...new Set(sample.forms.map(form => form.split(':')[0]!))]
  if (kindsOfForms.join() !== sample.kinds.join() || sample.kinds.some(name => !kinds.some(kind => kind.name === name))) problems.push('the kinds are not the kinds of the forms')
  if (sample.broken === sample.original) problems.push('the broken text is the original')

  // The first damage: the first added code point, the first kept one after a removed part, or the length when only
  // the end is missing.
  let firstDamage = -1
  let expected = 0
  for (let at = 0; at < broken.length && firstDamage === -1; at++) {
    if (alignment[at] !== expected) firstDamage = at
    expected++
  }
  if (firstDamage === -1) firstDamage = broken.length
  if (firstDamage !== sample.firstDamage) problems.push(`the first damage is at ${firstDamage}, and the sample says ${sample.firstDamage}`)

  // The first error: the tables reject the broken text, and so does the reference labeler. It is not before the
  // first damage.
  const trace = runTableParser(sample.broken)
  if (trace.valid) return [...problems, 'the tables accept the broken text']
  if (labelReference(sample.broken).valid) problems.push('the reference labeler accepts the broken text')
  if (trace.firstErrorPosition !== sample.firstErrorPosition || trace.firstErrorKind !== sample.firstErrorKind) problems.push('the first error is not the one of the parser as it is')
  if (trace.firstErrorPosition < firstDamage) problems.push('the first error is before the first damage')
  for (let at = 0; at < trace.length; at++) if (trace.depthAfter[at]! > 16) problems.push(`the parser as it is counts more than 16 open brackets at ${at}`)

  // What is not scored, rule by rule, as indexes into the original.
  const unscoredKinds = new Set<number>()
  const unscoredNesting = new Set<number>()
  // Before the first error, a value that the parser as it is does not give.
  for (let at = 0; at < Math.min(trace.firstErrorPosition, broken.length); at++) {
    const index = alignment[at]!
    if (index === -1) continue
    const own = labels[index]!
    if (own.kind !== trace.displayKind[at]) unscoredKinds.add(index)
    if (own.depth !== trace.depthAfter[at] || own.container !== trace.containerAfter[at]) unscoredNesting.add(index)
  }
  // From a kept code point that is no bracket and has another depth or container than the kept code point before
  // it, up to the next kept bracket.
  let last: OwnLabel = {kind: kindOf.whitespace, depth: 0, container: 0}
  let hidden = false
  for (const index of alignment) {
    if (index === -1) continue
    const own = labels[index]!
    if (own.kind === kindOf.punctuation && (original[index] === '[' || original[index] === ']' || original[index] === '{' || original[index] === '}')) hidden = false
    else if (own.depth !== last.depth || own.container !== last.container) hidden = true
    if (hidden) unscoredNesting.add(index)
    last = own
  }
  const sameSet = (set: Set<number>, list: readonly number[]) => set.size === list.length && list.every(index => set.has(index))
  if (!sameSet(unscoredKinds, sample.unscoredKinds)) problems.push('the display kinds that are not scored are not what the rules give')
  if (!sameSet(unscoredNesting, sample.unscoredNesting)) problems.push('the depths that are not scored are not what the rules give')

  // The labels: a kept code point has the label of its counterpart, with the values that are not scored left out,
  // and an added code point has none.
  let scored = 0
  datasetLabels.forEach((label, at) => {
    const index = alignment[at]!
    if (index === -1) {
      if (label !== undefined) problems.push(`the added code point at ${at} has a label`)
      return
    }
    const own = labels[index]!
    if (label === undefined) return void problems.push(`the kept code point at ${at} has no label`)
    if (label.kind !== (unscoredKinds.has(index) ? undefined : own.kind)) problems.push(`the display kind at ${at} is not the counterpart's`)
    if (label.depth !== (unscoredNesting.has(index) ? undefined : own.depth) || label.container !== (unscoredNesting.has(index) ? undefined : own.container)) problems.push(`the depth or the container at ${at} is not the counterpart's`)
    if (at >= trace.firstErrorPosition && (label.kind !== undefined || label.depth !== undefined)) scored++
    // Before the first error, every scored value is what the parser as it is gives.
    if (at < trace.firstErrorPosition) {
      if (label.kind !== undefined && label.kind !== trace.displayKind[at]) problems.push(`before the first error, the scored display kind at ${at} is not what the parser as it is gives`)
      if (label.depth !== undefined && (label.depth !== trace.depthAfter[at] || label.container !== trace.containerAfter[at])) problems.push(`before the first error, the scored depth at ${at} is not what the parser as it is gives`)
    }
  })
  if (scored === 0) problems.push('no code point is left to score')

  // The held-out templates are only in the test split.
  const isHeldOut = heldOutTemplates.includes(sample.template)
  if (isHeldOut !== (sample.heldOut.length > 0) || (isHeldOut && sample.heldOut[0] !== `template: ${sample.template}`)) problems.push('heldOut does not say whether the template is held out')
  if (isHeldOut && sample.split !== 'test') problems.push(`a sample of a held-out template is in the ${sample.split} split`)
  return problems
}

// The damage reads no TOML, part 1: the imports of damage.ts.
export function damageImportProblems(): string[] {
  const source = readFileSync(join(import.meta.dir, 'damage.ts'), 'utf8')
  const imported = [...source.matchAll(/^import .* from '(.+)'$/gm)].map(match => match[1]!)
  return imported.filter(path => path !== './edits.ts' && path !== './random.ts').map(path => `damage.ts imports ${path}`)
}

// The damage reads no TOML, part 2. Every code point of the payload but the line feed is swapped for a code point of
// a private use area, so that no bracket, quote, digit or letter is left. With the same draws, the damage of the
// swapped payload has to be the damage of the payload, swapped: the same kinds, the same code points kept, and the
// same code points added at the same places. So the damage reads only which code points are equal and where the
// line feeds are.
export function relabelingProblems(seed: number, index: number, text: string): string[] {
  const swapped = (character: string) => character === '\n' ? character : String.fromCodePoint(0xf0000 + character.codePointAt(0)! % 0x10000)
  const payload = Array.from(text)
  const plain = damage(createRandom(seed, index), payload)
  const relabeled = damage(createRandom(seed, index), payload.map(swapped))
  if (plain === undefined || relabeled === undefined) return plain === relabeled ? [] : ['an edit has a place in one of the two payloads only']
  const same = (left: Tracked, right: Tracked) => swapped(left.character) === right.character && left.origin === right.origin
  if (plain.steps.map(step => step.kind).join() !== relabeled.steps.map(step => step.kind).join()) return ['the kinds of the edits differ']
  if (plain.payload.length !== relabeled.payload.length || plain.payload.some((tracked, at) => !same(tracked, relabeled.payload[at]!))) return [`the damage of the swapped payload is another one (${plain.steps.map(step => step.kind).join(', ')})`]
  return []
}

if (import.meta.main) {
  const sampleCount = Number(process.argv[2] ?? 40_000)
  const seed = Number(process.argv[3] ?? defaultSeed)
  const firstIndex = Number(process.argv[4] ?? 0)
  const failures: string[] = []
  const fail = (what: string) => {
    failures.push(what)
    if (failures.length <= 20) console.log(`FAILED: ${what}`)
  }

  // 1. Every sample.
  const started = performance.now()
  const splitsOfSequence = new Map<string, Set<Split>>()
  const originalsBySplit = new Map<Split, Set<string>>(splits.map(split => [split, new Set<string>()]))
  const bySplit = new Map<Split, number>(splits.map(split => [split, 0]))
  let keptCodePoints = 0
  let heldOut = 0
  for (let index = firstIndex; index < firstIndex + sampleCount; index++) {
    const sample = sampleAt(seed, index)
    for (const problem of sampleProblems(sample)) fail(`sample ${sample.id}: ${problem}`)
    keptCodePoints += sample.alignment.reduce((total, origin) => total + Number(origin !== -1), 0)
    bySplit.set(sample.split, bySplit.get(sample.split)! + 1)
    originalsBySplit.get(sample.split)!.add(sample.original)
    if (sample.heldOut.length > 0) heldOut++
    const sequence = ownTokenSequence(sample.original)
    const found = splitsOfSequence.get(sequence)
    if (found === undefined) splitsOfSequence.set(sequence, new Set([sample.split]))
    else found.add(sample.split)
  }
  console.log(`1. ${sampleCount} samples of seed ${seed} from index ${firstIndex}: the second derivation agrees on every one, so each of the ${keptCodePoints} kept code points has the label of its counterpart in the original, and every sample has a first error and something to score (${((performance.now() - started) / 1000).toFixed(1)} s)`)

  // 2. The splits.
  const inTwoSplits = [...splitsOfSequence].filter(([, found]) => found.size > 1)
  for (const [sequence] of inTwoSplits.slice(0, 5)) fail(`the sequence of tokens ${sequence} is in two splits`)
  const testOriginals = originalsBySplit.get('test')!
  for (const split of ['train', 'validation'] as const) {
    for (const original of originalsBySplit.get(split)!) if (testOriginals.has(original)) fail(`an original of a ${split} sample is the original of a test sample: ${JSON.stringify(original)}`)
  }
  const requested = 300
  for (const split of splits) {
    for (let index = 0; index < requested; index++) {
      const sample = sampleAt(seed, firstIndex + index, {split})
      if (sample.split !== split) fail(`sample ${sample.id}, asked for the ${split} split, is in ${sample.split}`)
      if (split !== 'test' && sample.heldOut.length > 0) fail(`sample ${sample.id}, asked for the ${split} split, is held out`)
    }
  }
  console.log(`2. splits: ${splits.map(split => `${split} ${bySplit.get(split)}`).join(', ')}; ${heldOut} samples of the held-out templates ${heldOutTemplates.join(' and ')}, all in test. ${splitsOfSequence.size} sequences of tokens, each in one split. No original of a train or validation sample is the original of a test sample. ${requested} samples asked for per split are each of that split.`)

  // 3. The damage reads no TOML.
  for (const problem of damageImportProblems()) fail(problem)
  const relabeled = Math.min(sampleCount, 20_000)
  for (let index = 0; index < relabeled; index++) {
    const original = sampleAt(seed, firstIndex + index % 500, {source: 'valid'}).original
    for (const problem of relabelingProblems(seed + 1, index, original)) fail(`draw ${index} on ${JSON.stringify(original.slice(0, 40))}: ${problem}`)
  }
  console.log(`3. damage.ts imports only edits.ts and random.ts, and ${relabeled} draws of edits give the same edits on a payload whose code points are swapped for others, all but the line feed`)

  // 4. Determinism.
  const repeated = Math.min(sampleCount, 2000)
  let sameAsOtherSeed = 0
  for (let index = firstIndex; index < firstIndex + repeated; index++) {
    const first = sampleAt(seed, index)
    if (JSON.stringify(first) !== JSON.stringify(sampleAt(seed, index))) fail(`sample ${seed}:${index} is another one the second time`)
    if (first.broken === sampleAt(seed + 1, index).broken) sameAsOtherSeed++
  }
  if (sameAsOtherSeed > repeated / 100) fail(`${sameAsOtherSeed} of ${repeated} samples are the same under another seed`)
  console.log(`4. ${repeated} samples are the same when they are made twice, and ${sameAsOtherSeed} of them have the broken text of the same index under seed ${seed + 1}`)

  console.log(failures.length === 0 ? 'every check passed' : `${failures.length} failures`)
  if (failures.length > 0) process.exitCode = 1
}
