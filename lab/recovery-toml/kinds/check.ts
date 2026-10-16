// The checks of this folder: a second derivation of what a sample holds, the scan, and the mixed set.
//
// Run from the repo root: bun lab/recovery-toml/kinds/check.ts [indexes, default 30000] [seed]
// It checks, and ends with "every check passed":
// 1. The scan: the labels that follow from the parts of scan.ts are the reference labeler's, at every code point of
//    every document.
// 2. The rules for what is not scored: this folder's copy of unscoredOf gives the dataset's values for the dataset's
//    samples.
// 3. Every sample of this folder with an index below the given number that is not in the test split, at least
//    20,000 samples: this file applies the edits itself and takes the labels from the tables' run on the original,
//    and the sample's alignment, labels, first damage and unscored values are what follows. The parser as it is
//    rejects the broken text, at least one code point is scored, no document is of the test split or of a held-out
//    template, and ../learn/data.ts takes the samples.
// 4. The same seed gives the same sample twice, and another seed gives another one.
// 5. The mixed set: as many samples as the dataset's standard set has per split, half of them of each half, every
//    index once, and each sample in the split of its document.
// It then prints the number of samples per kind.
import {type Edit} from '../edits.ts'
import {containerNone, displayKind} from '../kinds.ts'
import {labelsOfValidText} from '../labels.ts'
import {samplesOf} from '../learn/data.ts'
import {labelReference} from '../reference.ts'
import {type Sample, defaultSeed, heldOutTemplates, labelsOf, sampleAt, scoredCodePoints, splitOf} from '../samples.ts'
import {runTableParser} from '../table-parser.ts'
import {kinds} from './list.ts'
import {type MixedSample, labeledTextOf, mixedSamples, standardRange} from './mixed.ts'
import {kindsSampleAt, unscoredOf} from './samples.ts'
import {type Key, type Scan, type StringPart, scan} from './scan.ts'

type OwnLabel = {kind: number, depth: number, container: number}

// The labels of a valid text as the tables give them.
function labelsOfTables(text: string): OwnLabel[] {
  const trace = runTableParser(text)
  if (!trace.valid) throw new Error(`the tables reject ${JSON.stringify(text)}`)
  return Array.from({length: trace.length}, (_, position) => ({kind: trace.displayKind[position]!, depth: trace.depthAfter[position]!, container: trace.containerAfter[position]!}))
}

// The labels of a document that follow from the parts of its scan: every code point is white space unless a part
// says otherwise, and the depth and the container follow the brackets of the scan's containers.
function labelsOfScan(scanned: Scan): OwnLabel[] {
  const {codePoints} = scanned
  const shown: number[] = codePoints.map(() => displayKind.whitespace)
  const fill = (start: number, end: number, kind: number) => { for (let position = start; position < end; position++) shown[position] = kind }
  const fillString = (string: StringPart, kind: number) => {
    fill(string.start, string.end, kind)
    for (const escape of string.escapes) fill(escape.start, escape.end, displayKind.escape)
  }
  const fillKey = (key: Key, kind: number) => {
    for (const part of key.parts) {
      if (part.string === null) fill(part.start, part.end, kind)
      else fillString(part.string, kind)
    }
    for (const dot of key.dots) shown[dot] = displayKind.punctuation
  }
  for (const comment of scanned.comments) fill(comment.start, comment.end, displayKind.comment)
  for (const header of scanned.headers) {
    fill(header.start, header.end, displayKind.punctuation)
    fill(header.start + (header.double ? 2 : 1), header.close, displayKind.whitespace)
    fillKey(header.key, displayKind.headerName)
  }
  for (const entry of [...scanned.entries, ...scanned.inlineEntries]) {
    fillKey(entry.key, displayKind.key)
    shown[entry.equals] = displayKind.punctuation
  }
  for (const value of scanned.values) {
    if (value.string !== null) fillString(value.string, displayKind.string)
    else if (value.container === null) {
      fill(value.start, value.end, value.type === 'boolean' ? displayKind.literal : displayKind.number)
      // The space between a date and a time.
      for (let position = value.start; position < value.end; position++) if (codePoints[position] === ' ') shown[position] = displayKind.whitespace
    }
  }
  const opens = new Map<number, number>()
  const closes = new Set<number>()
  for (const container of scanned.containers) {
    shown[container.open] = displayKind.punctuation
    shown[container.close] = displayKind.punctuation
    for (const comma of [...container.items.map(item => item.commaAfter), ...container.entries.map(entry => entry.commaAfter)]) if (comma !== -1) shown[comma] = displayKind.punctuation
    opens.set(container.open, container.type === 'array' ? 2 : 1)
    closes.add(container.close)
  }
  const stack: number[] = []
  return shown.map((kind, position) => {
    if (opens.has(position)) stack.push(opens.get(position)!)
    if (closes.has(position)) stack.pop()
    return {kind, depth: stack.length, container: stack.at(-1) ?? containerNone}
  })
}

export function scanProblems(text: string): string[] {
  const problems: string[] = []
  const scanned = scan(text)
  const own = labelsOfScan(scanned)
  const reference = labelsOfValidText(text)
  if (own.length !== reference.length) return ['the scan has another number of code points']
  for (let position = 0; position < own.length; position++) {
    if (own[position]!.kind !== reference[position]!.kind || own[position]!.depth !== reference[position]!.depth || own[position]!.container !== reference[position]!.container) {
      problems.push(`at ${position} the scan says ${JSON.stringify(own[position])} and the reference labeler ${JSON.stringify(reference[position])}`)
      break
    }
  }
  // The lines: one after the other, each up to its line end, and together the whole text.
  let next = 0
  for (const line of scanned.lines) {
    if (line.start !== next || line.end < line.start || line.next < line.end || line.next - line.end > 2) problems.push(`the line at ${line.start} does not follow the line before it`)
    if (scanned.codePoints.slice(line.start, line.end).includes('\n')) problems.push(`the line at ${line.start} holds a line feed`)
    if (line.next > line.end && scanned.codePoints[line.next - 1] !== '\n') problems.push(`the line at ${line.start} does not end with a line feed`)
    next = line.next
  }
  if (next !== scanned.codePoints.length) problems.push('the lines do not cover the text')
  return problems
}

const kindNames = new Set(kinds.map(kind => kind.name))

// What is wrong with a sample of this folder, as sentences, or an empty list.
export function sampleProblems(sample: Sample, neutral: Sample): string[] {
  const problems: string[] = []
  const original = Array.from(sample.original)
  const broken = Array.from(sample.broken)

  // The document: the one of the dataset's sample with the same index, of a split that is not the test split.
  if (sample.original !== neutral.original || sample.documents.length !== 1 || sample.documents[0] !== sample.original) problems.push('the document is not the one of the dataset\'s sample with the same index')
  if (sample.split === 'test' || neutral.split === 'test' || sample.split !== neutral.split || splitOf(sample.original) !== sample.split) problems.push(`the split is ${sample.split}, the dataset's sample has ${neutral.split}, and the document is of ${splitOf(sample.original)}`)
  if (heldOutTemplates.includes(sample.template) || sample.heldOut.length > 0 || sample.template !== neutral.template) problems.push('the template is held out, or not the dataset\'s')
  if (original.length > 512 || broken.length > 512) problems.push('a text is longer than 512 code points')
  if ((sample.lineEnd === '\r\n') !== sample.original.includes('\r\n')) problems.push('lineEnd is not what the original has')
  const labels = labelsOfTables(sample.original)
  if (!labelReference(sample.original).valid) problems.push('the reference labeler rejects the original')

  // The kinds: one or two of this folder, and `kinds` lists them.
  if (sample.source !== 'damage' || sample.recipe !== (sample.editCount === 1 ? 'one kind' : 'two kinds')) problems.push('the source or the recipe is not what the number of kinds says')
  if (sample.editCount < 1 || sample.editCount > 2 || sample.forms.length !== sample.editCount) problems.push('the number of kinds is not the number of forms, or not 1 or 2')
  const kindsOfForms = [...new Set(sample.forms.map(form => form.split(':')[0]!))]
  if (kindsOfForms.join() !== sample.kinds.join() || sample.kinds.some(name => !kindNames.has(name))) problems.push('the kinds are not the kinds of the forms')

  // The edits: in text order, apart from each other, in the canonical form, and they give the broken text.
  const ownBroken: string[] = []
  const alignment: number[] = []
  const replaced: boolean[] = []
  let position = 0
  for (const [index, edit] of (sample.edits as readonly Edit[]).entries()) {
    const inserted = Array.from(edit.insert)
    if (edit.at < position || edit.at + edit.remove > original.length) return [...problems, `edit ${index} overlaps the edit before it or leaves the original`]
    if (edit.remove === 0 && edit.insert === '') problems.push(`edit ${index} does nothing`)
    if (edit.oneForOne === true && inserted.length !== edit.remove) problems.push(`edit ${index} replaces one for one and inserts another number of code points than it removes`)
    for (; position < edit.at; position++) {
      ownBroken.push(original[position]!)
      alignment.push(position)
      replaced.push(false)
    }
    inserted.forEach((character, offset) => {
      ownBroken.push(character)
      alignment.push(edit.oneForOne === true ? edit.at + offset : -1)
      replaced.push(edit.oneForOne === true && character !== original[edit.at + offset])
      if (edit.oneForOne === true && character === original[edit.at + offset]) problems.push(`edit ${index} replaces a code point with itself`)
    })
    position = edit.at + edit.remove
    const limit = sample.edits[index + 1]?.at ?? original.length
    if (edit.oneForOne !== true && edit.insert === '' && edit.remove > 0 && edit.at + edit.remove < limit && original[edit.at + edit.remove] === original[edit.at]) problems.push(`the removal at ${edit.at} could start one code point later`)
    const oneCodePoint = inserted.every(character => character === inserted[0])
    if (edit.remove === 0 && edit.insert !== '' && edit.at < limit && original[edit.at] === inserted[0] && (edit.at > 0 || oneCodePoint)) problems.push(`the insertion at ${edit.at} could sit one code point later`)
  }
  for (; position < original.length; position++) {
    ownBroken.push(original[position]!)
    alignment.push(position)
    replaced.push(false)
  }
  if (ownBroken.join('') !== sample.broken) problems.push('the edits do not give the broken text')
  if (sample.broken === sample.original) problems.push('the broken text is the original')
  if (alignment.length !== sample.alignment.length || alignment.some((index, at) => index !== sample.alignment[at])) problems.push('the alignment is not what the edits give')
  if (replaced.length !== sample.replaced.length || replaced.some((flag, at) => flag !== sample.replaced[at])) problems.push('the flags of replaced code points are not what the edits give')
  let previous = -1
  alignment.forEach((index, at) => {
    if (index === -1) return
    if (index <= previous) problems.push(`the alignment does not rise at ${at}`)
    previous = index
    if ((broken[at] !== original[index]) !== replaced[at]) problems.push(`the code point at ${at} differs from its counterpart and is not flagged as replaced, or the other way round`)
  })

  // The first damage: the first code point that is added or replaced, the first kept one after a removed part, or
  // the length when only the end is missing.
  let firstDamage = -1
  for (let at = 0; at < broken.length && firstDamage === -1; at++) if (alignment[at] !== at || replaced[at]) firstDamage = at
  if (firstDamage === -1) firstDamage = broken.length
  if (firstDamage !== sample.firstDamage) problems.push(`the first damage is at ${firstDamage}, and the sample says ${sample.firstDamage}`)

  // The first error: the tables reject the broken text, and so does the reference labeler.
  const trace = runTableParser(sample.broken)
  if (trace.valid) return [...problems, 'the tables accept the broken text']
  if (labelReference(sample.broken).valid) problems.push('the reference labeler accepts the broken text')
  if (trace.firstErrorPosition !== sample.firstErrorPosition || trace.firstErrorKind !== sample.firstErrorKind) problems.push('the first error is not the one of the parser as it is')
  if (trace.firstErrorPosition < firstDamage) problems.push('the first error is before the first damage')
  for (let at = 0; at < trace.length; at++) if (trace.depthAfter[at]! > 16) problems.push(`the parser as it is counts more than 16 open brackets at ${at}`)

  // What is not scored, rule by rule, as indexes into the original.
  const unscoredKinds = new Set<number>()
  const unscoredNesting = new Set<number>()
  for (let at = 0; at < Math.min(trace.firstErrorPosition, broken.length); at++) {
    const index = alignment[at]!
    if (index === -1) continue
    const own = labels[index]!
    if (own.kind !== trace.displayKind[at]) unscoredKinds.add(index)
    if (own.depth !== trace.depthAfter[at] || own.container !== trace.containerAfter[at]) unscoredNesting.add(index)
  }
  let last: OwnLabel = {kind: displayKind.whitespace, depth: 0, container: 0}
  let hidden = false
  for (const index of alignment) {
    if (index === -1) continue
    const own = labels[index]!
    if (own.kind === displayKind.punctuation && (original[index] === '[' || original[index] === ']' || original[index] === '{' || original[index] === '}')) hidden = false
    else if (own.depth !== last.depth || own.container !== last.container) hidden = true
    if (hidden) unscoredNesting.add(index)
    last = own
  }
  const sameSet = (set: Set<number>, list: readonly number[]) => set.size === list.length && list.every(index => set.has(index))
  if (!sameSet(unscoredKinds, sample.unscoredKinds)) problems.push('the display kinds that are not scored are not what the rules give')
  if (!sameSet(unscoredNesting, sample.unscoredNesting)) problems.push('the depths that are not scored are not what the rules give')

  // The labels: a kept or replaced code point has the label of its counterpart, with the values that are not scored
  // left out, and an added code point has none.
  const datasetLabels = labelsOf(sample)
  if (datasetLabels.length !== broken.length) return [...problems, 'labelsOf does not return one entry per code point']
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
    if (at < trace.firstErrorPosition) {
      if (label.kind !== undefined && label.kind !== trace.displayKind[at]) problems.push(`before the first error, the scored display kind at ${at} is not what the parser as it is gives`)
      if (label.depth !== undefined && (label.depth !== trace.depthAfter[at] || label.container !== trace.containerAfter[at])) problems.push(`before the first error, the scored depth at ${at} is not what the parser as it is gives`)
    }
  })
  if (scored === 0) problems.push('no code point is left to score')
  if (scored !== scoredCodePoints(sample)) problems.push('scoredCodePoints counts another number')
  return problems
}

if (import.meta.main) {
  const indexCount = Number(process.argv[2] ?? 30_000)
  const seed = Number(process.argv[3] ?? defaultSeed)
  const failures: string[] = []
  const fail = (what: string) => {
    failures.push(what)
    if (failures.length <= 20) console.log(`FAILED: ${what}`)
  }

  // 1 to 4, in one pass over the indexes.
  let started = performance.now()
  const perKind = new Map<string, number>(kinds.map(kind => [kind.name, 0]))
  const made: MixedSample[] = []
  let documents = 0
  let datasetSamples = 0
  let keptCodePoints = 0
  let replacedCodePoints = 0
  let twoKinds = 0
  let madeTwice = 0
  let differsWithOtherSeed = 0
  let refusedTestIndexes = 0
  let testIndexes = 0
  for (let index = 0; index < indexCount; index++) {
    const neutral = sampleAt(seed, index)
    if (neutral.split === 'test') {
      testIndexes++
      // An index of the test split has no sample here.
      try {
        kindsSampleAt(seed, index)
        fail(`${seed}:${index} is in the test split, and kindsSampleAt made a sample of it`)
      } catch {
        refusedTestIndexes++
      }
      continue
    }
    documents++
    for (const problem of scanProblems(neutral.original)) fail(`document ${neutral.id}: ${problem}`)
    const trace = runTableParser(neutral.broken)
    const own = unscoredOf(Array.from(neutral.original), labelsOfValidText(neutral.original), neutral.alignment, neutral.firstDamage, trace)
    datasetSamples++
    if (own.unscoredKinds.join() !== neutral.unscoredKinds.join() || own.unscoredNesting.join() !== neutral.unscoredNesting.join()) fail(`sample ${neutral.id}: this folder's copy of unscoredOf gives other values than the dataset`)
    const sample = kindsSampleAt(seed, index)
    for (const problem of sampleProblems(sample, neutral)) fail(`sample ${sample.id} (${sample.forms.join('; ')}): ${problem}`)
    made.push({half: 'kinds', index, sample})
    for (const kind of sample.kinds) perKind.set(kind, perKind.get(kind)! + 1)
    if (sample.editCount === 2) twoKinds++
    keptCodePoints += sample.alignment.filter(counterpart => counterpart !== -1).length
    replacedCodePoints += sample.replaced.filter(flag => flag).length
    if (index % 10 === 0) {
      madeTwice++
      if (JSON.stringify(kindsSampleAt(seed, index)) !== JSON.stringify(sample)) fail(`sample ${sample.id} is another sample when it is made a second time`)
      if (sampleAt(seed + 1, index).split !== 'test' && kindsSampleAt(seed + 1, index).broken !== sample.broken) differsWithOtherSeed++
    }
  }
  if (made.length < 20_000) fail(`${made.length} samples were checked, and the check needs at least 20,000: give it more indexes`)
  if (differsWithOtherSeed === 0) fail('another seed gives the same samples')
  // ../learn/data.ts takes the samples: samplesOf throws for labels that do not fit their text, and counts the
  // scored code points itself.
  const arrays = samplesOf(made.map(labeledTextOf), seed)
  const scoredInArrays = arrays.scored.reduce((total, count) => total + count, 0)
  const scoredInSamples = made.reduce((total, {sample}) => total + scoredCodePoints(sample), 0)
  if (arrays.sampleCount !== made.length || scoredInArrays !== scoredInSamples) fail(`the arrays of learn/data.ts hold ${arrays.sampleCount} samples with ${scoredInArrays} scored code points, and the samples have ${made.length} and ${scoredInSamples}`)
  console.log(`1. The scan gives the reference labeler's labels at every code point of ${documents} documents.`)
  console.log(`2. This folder's copy of unscoredOf gives the dataset's values for ${datasetSamples} samples of the dataset.`)
  console.log(`3. ${made.length} samples of this folder, of the indexes 0 to ${indexCount - 1} of seed ${seed} that are not in the test split: the second derivation agrees for each, with ${keptCodePoints} kept code points, ${replacedCodePoints} of them in the place of another code point. Every broken text is rejected by the parser as it is and has a code point to score, ${scoredInSamples} in all. No sample is of the test split or of a held-out template, and kindsSampleAt refused all ${refusedTestIndexes} of the ${testIndexes} indexes of the test split. ${twoKinds} samples (${(100 * twoKinds / made.length).toFixed(1)}%) have two kinds.`)
  console.log(`4. ${madeTwice} samples were made twice and are the same both times, and ${differsWithOtherSeed} of them have another broken text with the seed ${seed + 1}.`)
  console.log(`   (${((performance.now() - started) / 1000).toFixed(1)} s)`)

  // 5. The mixed set, on the standard set.
  started = performance.now()
  const neutralCounts = {train: 0, validation: 0}
  for (let index = standardRange.from; index < standardRange.to; index++) {
    const {split} = sampleAt(standardRange.seed, index)
    if (split !== 'test') neutralCounts[split]++
  }
  for (const split of ['train', 'validation'] as const) {
    const mixed = mixedSamples(split)
    const halves = {neutral: mixed.filter(({half}) => half === 'neutral').length, kinds: mixed.filter(({half}) => half === 'kinds').length}
    if (mixed.length !== neutralCounts[split]) fail(`the mixed ${split} split has ${mixed.length} samples, and the dataset's has ${neutralCounts[split]}`)
    if (halves.neutral - halves.kinds < 0 || halves.neutral - halves.kinds > 1) fail(`the mixed ${split} split has ${halves.neutral} samples of the dataset and ${halves.kinds} of this folder`)
    if (new Set(mixed.map(({index}) => index)).size !== mixed.length) fail(`an index is twice in the mixed ${split} split`)
    for (const {half, index, sample} of mixed) {
      if (sample.split !== split || splitOf(sample.original) !== split || heldOutTemplates.includes(sample.template)) fail(`the mixed ${split} split holds a sample of the document ${index}, which is of another split or of a held-out template`)
      if (sample.id !== (half === 'neutral' ? `${standardRange.seed}:${index}` : `${standardRange.seed}:${index}:kinds`)) fail(`the sample ${sample.id} is marked as ${half}`)
      if ((half === 'kinds') !== sample.kinds.every(name => kindNames.has(name))) fail(`the sample ${sample.id} is marked as ${half}, and its kinds are ${sample.kinds.join(', ')}`)
    }
    console.log(`5. The mixed ${split} split: ${mixed.length} samples, as the dataset's standard set has, ${halves.neutral} of the dataset and ${halves.kinds} of this folder, every index once, each of a document of the ${split} split.`)
  }
  console.log(`   (${((performance.now() - started) / 1000).toFixed(1)} s)`)

  console.log(`\nSamples per kind, of the ${made.length} samples of check 3. A sample with two kinds counts for both.`)
  for (const [name, count] of [...perKind].sort((left, right) => right[1] - left[1])) console.log(`${String(count).padStart(7)}  ${(100 * count / made.length).toFixed(2).padStart(5)}%  ${name}`)
  if ([...perKind.values()].some(count => count === 0)) fail('a kind has no sample')

  console.log(failures.length === 0 ? '\nevery check passed' : `\n${failures.length} checks failed`)
  if (failures.length > 0) process.exit(1)
}
