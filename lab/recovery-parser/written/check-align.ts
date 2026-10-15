// How often align.ts gives what the dataset gives. A generated sample knows its edits, and align.ts sees only the
// sample's two texts, so the dataset's alignment and replaced flags are the answer to compare with.
//
// Run from the repo root: bun lab/recovery-parser/written/check-align.ts [samples, default 6000] [seed] [first index]
// It prints the agreement over all broken samples and per kind of damage, for the alignment and for the labels that
// follow from it, and the first samples of a kind that differ when a kind is named as the fourth argument. Then it
// takes every sample of one document for a written case with the writer's opinion alone, and prints how often the
// values that a score counts are the dataset's, and what the readers score by the two.
import {visible} from '../dump.ts'
import {handRuleTables, handRules} from '../hand-rules.ts'
import {type Label, kindLetters, labelsOfValidText} from '../labels.ts'
import {type Sample, defaultSeed, labelsOf, sampleAt} from '../samples.ts'
import {type ParserTables, defaultTables, runTableParser} from '../table-parser.ts'
import {align} from './align.ts'
import {caseOf, labelsOfWritten} from './written.ts'

export type DatasetAgreement = {
  samples: number
  // Samples in which every code point has the dataset's counterpart and replaced flag, and those in which every code
  // point has the dataset's label, i.e. the same display kind, depth and container, or no label in both.
  sameAlignment: number
  sameLabels: number
  // The same as sameLabels, looking only at the code points from the first error of the parser as it is on, which
  // are the ones that a score counts.
  sameLabelsFromFirstError: number
  codePoints: number
  sameAlignmentCodePoints: number
  sameLabelCodePoints: number
  // Code points that have a label only by align.ts, only by the dataset, and another label by each.
  labelOnlyHere: number
  labelOnlyInDataset: number
  otherLabel: number
}
const noAgreement = (): DatasetAgreement => ({samples: 0, sameAlignment: 0, sameLabels: 0, sameLabelsFromFirstError: 0, codePoints: 0, sameAlignmentCodePoints: 0, sameLabelCodePoints: 0, labelOnlyHere: 0, labelOnlyInDataset: 0, otherLabel: 0})

// One broken sample's numbers. A text of several documents has the labels that each document has alone.
export function agreementOf(sample: Sample): DatasetAgreement {
  const ours = align(sample.broken, sample.original)
  const labels = sample.documents.flatMap(labelsOfValidText)
  const agreement = noAgreement()
  agreement.samples = 1
  agreement.codePoints = sample.alignment.length
  let sameFromFirstError = true
  for (let position = 0; position < sample.alignment.length; position++) {
    const theirs = sample.alignment[position]!
    const mine = ours.alignment[position]!
    if (theirs === mine && sample.replaced[position] === ours.replaced[position]) agreement.sameAlignmentCodePoints++
    const theirLabel = theirs === -1 ? undefined : labels[theirs]!
    const myLabel = mine === -1 ? undefined : labels[mine]!
    if (theirLabel === undefined && myLabel === undefined) agreement.sameLabelCodePoints++
    else if (theirLabel === undefined) agreement.labelOnlyHere++
    else if (myLabel === undefined) agreement.labelOnlyInDataset++
    else if (theirLabel.kind === myLabel.kind && theirLabel.depth === myLabel.depth && theirLabel.container === myLabel.container) agreement.sameLabelCodePoints++
    else agreement.otherLabel++
    const same = (theirLabel === undefined && myLabel === undefined) || (theirLabel !== undefined && myLabel !== undefined && theirLabel.kind === myLabel.kind && theirLabel.depth === myLabel.depth && theirLabel.container === myLabel.container)
    if (!same && position >= sample.firstErrorPosition) sameFromFirstError = false
  }
  agreement.sameAlignment = Number(agreement.sameAlignmentCodePoints === agreement.codePoints)
  agreement.sameLabels = Number(agreement.sameLabelCodePoints === agreement.codePoints)
  agreement.sameLabelsFromFirstError = Number(sameFromFirstError)
  return agreement
}

export function agreementWithDataset(seed: number, sampleCount: number, first = 0) {
  const total = noAgreement()
  const perKind = new Map<string, DatasetAgreement>()
  const differing: Sample[] = []
  const add = (into: DatasetAgreement, one: DatasetAgreement) => { for (const key of Object.keys(into) as (keyof DatasetAgreement)[]) into[key] += one[key] }
  for (let index = first; index < first + sampleCount; index++) {
    const sample = sampleAt(seed, index)
    if (sample.source === 'valid') continue
    const one = agreementOf(sample)
    add(total, one)
    if (one.sameAlignment === 0) differing.push(sample)
    for (const kind of sample.kinds) {
      let row = perKind.get(kind)
      if (row === undefined) perKind.set(kind, row = noAgreement())
      add(row, one)
    }
  }
  return {total, perKind, differing}
}

// The readers that a score is given for: the parser as it is, and the hand-written settings of hand-rules.ts.
const readers: readonly (readonly [name: string, tables: ParserTables])[] = [['now', defaultTables], ...handRules.map(rule => [rule, handRuleTables(rule)] as const)]
type ReaderScore = {scored: number, right: number, withSomething: number, wholeRight: number}

// Every broken sample of one document as a written case with the writer's opinion alone: written.ts gives its labels
// from the two texts, and the dataset gives them from the sample's edits and from what its kinds of damage declare.
export function writtenCasesAgainstDataset(seed: number, sampleCount: number, first = 0) {
  const scoreOf = (labels: readonly (Label | undefined)[], sample: Sample, tables: ParserTables, into: ReaderScore) => {
    const trace = runTableParser(sample.broken, tables)
    let scored = 0
    let right = 0
    for (let position = sample.firstErrorPosition; position < labels.length; position++) {
      const label = labels[position]
      if (label === undefined || (label.kind === undefined && label.depth === undefined)) continue
      scored++
      if ((label.kind === undefined || label.kind === trace.displayKind[position]) && (label.depth === undefined || label.depth === trace.depthAfter[position])
        && (label.container === undefined || label.container === trace.containerAfter[position])) right++
    }
    into.scored += scored
    into.right += right
    if (scored > 0) into.withSomething++
    if (scored > 0 && right === scored) into.wholeRight++
  }
  const noScore = (): ReaderScore => ({scored: 0, right: 0, withSomething: 0, wholeRight: 0})
  const byDataset = readers.map(noScore)
  const asWritten = readers.map(noScore)
  let samples = 0
  let sameScoredLabels = 0
  for (let index = first; index < first + sampleCount; index++) {
    const sample = sampleAt(seed, index)
    if (sample.source === 'valid' || sample.documents.length > 1) continue
    samples++
    const theirs = labelsOf(sample)
    const ours = labelsOfWritten(caseOf({id: sample.id, from: '', note: undefined, debatable: false, intended: sample.original, broken: sample.broken}, 'dataset'))
    let same = true
    for (let position = sample.firstErrorPosition; position < theirs.length; position++) {
      const their = theirs[position] ?? {kind: undefined, depth: undefined, container: undefined}
      const our = ours[position] ?? {kind: undefined, depth: undefined, container: undefined}
      if (their.kind !== our.kind || their.depth !== our.depth || their.container !== our.container) same = false
    }
    if (same) sameScoredLabels++
    readers.forEach(([, tables], reader) => {
      scoreOf(theirs, sample, tables, byDataset[reader]!)
      scoreOf(ours, sample, tables, asWritten[reader]!)
    })
  }
  return {samples, sameScoredLabels, readers: readers.map(([name], reader) => ({name, byDataset: byDataset[reader]!, asWritten: asWritten[reader]!}))}
}

// The two alignments of a sample side by side, cut down to the columns around the code points that differ.
function describeDifference(sample: Sample): string {
  const ours = align(sample.broken, sample.original)
  const labels = sample.documents.flatMap(labelsOfValidText)
  const differs = sample.alignment.map((counterpart, position) => counterpart !== ours.alignment[position] || sample.replaced[position] !== ours.replaced[position])
  const from = Math.max(0, differs.indexOf(true) - 40)
  const to = Math.min(sample.alignment.length, differs.lastIndexOf(true) + 40)
  const cut = (row: readonly string[]) => row.slice(from, to).join('')
  const marks = (alignment: readonly number[], replaced: readonly boolean[]) => alignment.map((counterpart, position) => counterpart === -1 ? '+' : replaced[position] === true ? '~' : '.')
  const kinds = (alignment: readonly number[]) => alignment.map(counterpart => counterpart === -1 ? ' ' : kindLetters[labels[counterpart]!.kind]!)
  const depths = (alignment: readonly number[]) => alignment.map(counterpart => counterpart === -1 ? ' ' : '0123456789abcdefg'[labels[counterpart]!.depth]!)
  return [
    `--- ${sample.id}  ${sample.kinds.join(', ')}  ${sample.forms.join(' | ')}`,
    `brok        ${cut(Array.from(visible(sample.broken)))}`,
    `differs     ${cut(differs.map(flag => flag ? '^' : ' '))}`,
    `dataset     ${cut(marks(sample.alignment, sample.replaced))}`,
    `align.ts    ${cut(marks(ours.alignment, ours.replaced))}`,
    `dataset     ${cut(kinds(sample.alignment))}`,
    `align.ts    ${cut(kinds(ours.alignment))}`,
    `dataset     ${cut(depths(sample.alignment))}`,
    `align.ts    ${cut(depths(ours.alignment))}`,
  ].join('\n')
}

if (import.meta.main) {
  const sampleCount = Number(process.argv[2] ?? 6000)
  const seed = Number(process.argv[3] ?? defaultSeed)
  const first = Number(process.argv[4] ?? 0)
  const shownKind = process.argv[5]
  const {total, perKind, differing} = agreementWithDataset(seed, sampleCount, first)
  const percent = (part: number, whole: number) => `${(100 * part / Math.max(1, whole)).toFixed(2)}%`
  console.log(`${total.samples} broken samples of seed ${seed}, from index ${first}.`)
  console.log(`Samples with the dataset's alignment and replaced flags on every code point: ${percent(total.sameAlignment, total.samples)}.`)
  console.log(`Samples with the dataset's label on every code point: ${percent(total.sameLabels, total.samples)}, and on every code point from the first error on: ${percent(total.sameLabelsFromFirstError, total.samples)}.`)
  console.log(`Code points with the dataset's alignment: ${percent(total.sameAlignmentCodePoints, total.codePoints)}. With the dataset's label: ${percent(total.sameLabelCodePoints, total.codePoints)}.`)
  console.log(`Of ${total.codePoints} code points, ${total.labelOnlyHere} have a label only here, ${total.labelOnlyInDataset} only in the dataset, and ${total.otherLabel} have another label.`)
  console.log('\nPer kind, for the kinds with a sample that differs: samples, those with the same alignment, with the same labels, with the same')
  console.log('labels from the first error on, then code points with a label only here, only in the dataset, and with another label.')
  for (const [kind, row] of [...perKind].sort((left, right) => (right[1].samples - right[1].sameLabels) - (left[1].samples - left[1].sameLabels))) {
    if (row.sameAlignment === row.samples) continue
    console.log(`  ${[row.samples, row.sameAlignment, row.sameLabels, row.sameLabelsFromFirstError].map(value => String(value).padStart(6)).join('')}   ${[row.labelOnlyHere, row.labelOnlyInDataset, row.otherLabel].map(value => String(value).padStart(6)).join('')}  ${kind}`)
  }
  if (shownKind !== undefined) {
    const shown = differing.filter(sample => sample.kinds.includes(shownKind)).slice(0, 12)
    console.log(`\nThe first ${shown.length} samples with ${shownKind} that differ. + added, ~ in the place of another, . kept.\n`)
    console.log(shown.map(describeDifference).join('\n\n'))
  }
  const written = writtenCasesAgainstDataset(seed, sampleCount, first)
  console.log(`\nThe ${written.samples} broken samples of one document as written cases with the writer's opinion alone.`)
  console.log(`Samples in which every value that a score counts, from the first error on, is the dataset's: ${percent(written.sameScoredLabels, written.samples)}.`)
  console.log('What the readers have right by the dataset\'s labels and by the labels of a written case: code points, and samples as a whole.')
  for (const {name, byDataset, asWritten} of written.readers) {
    console.log(`  ${name.padEnd(7)} dataset ${percent(byDataset.right, byDataset.scored).padStart(7)} ${percent(byDataset.wholeRight, byDataset.withSomething).padStart(7)}   written case ${percent(asWritten.right, asWritten.scored).padStart(7)} ${percent(asWritten.wholeRight, asWritten.withSomething).padStart(7)}`)
  }
}
