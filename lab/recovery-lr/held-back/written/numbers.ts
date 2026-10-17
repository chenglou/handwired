// The numbers of the written set that README.md gives under "The set as it is": the cases per writer's file, the
// code points, what the two repairs differ in, the marks, the sizes, and what the damage is by kinds.txt.
//
// Run from the repo root: bun lab/recovery-lr/held-back/written/numbers.ts [--set <folder>]
// It prints the tables and sentences of README.md, and counts only, so that its output quotes no case.
// check-written.ts holds README.md against these lines.
import {packSamples} from '../../learn/data.ts'
import {symbolOf} from '../../tables.ts'
import {couldComeFromEdits, damagePartOf, damagedPlacesOf, neutralEditsOf} from './neutral-edits.ts'
import {changedTokensOf, wrongBeforeFirstError} from './show.ts'
import {type Agreement, type WrittenCase, readWritten, samplesOfWritten, setFolderOf} from './written.ts'

const letTerminal = symbolOf('LET')
const grouped = (count: number) => count.toLocaleString('en-US')
const holdsCodePointAbove = (text: string, limit: number) => Array.from(text).some(character => character.codePointAt(0)! > limit)
const sum = <Item>(items: readonly Item[], value: (item: Item) => number) => items.reduce((total, item) => total + value(item), 0)

// How many code points of a case have the given agreement, from the first error on or before it.
const countOf = (writtenCase: WrittenCase, wanted: Agreement, fromFirstError: boolean) =>
  writtenCase.agreement.reduce((total, state, position) => total + Number(state === wanted && (position >= writtenCase.sample.firstErrorPosition) === fromFirstError), 0)

// The scored code points of a case that stand in a later definition which the damage did not touch: a definition at
// the top of the writer's repaired program whose code points all stand in the broken program, side by side, from the
// first error on. A parser that finds the start of such a definition again reads it as the plain parser reads it.
export function scoredInUntouchedDefinitions(writtenCase: WrittenCase): number {
  const {labels, sample: {alignment}} = writtenCase.opinions[0]!
  const positionOf = new Int32Array(labels.codePoints.length).fill(-1)
  alignment.forEach((counterpart, position) => {
    if (counterpart !== -1) positionOf[counterpart] = position
  })
  // A `let` at depth 1 starts a definition at the top: a local one is inside a definition and stands deeper.
  const starts: number[] = []
  for (let token = 0; token < labels.tokens.count; token++) if (labels.tokens.kind[token] === letTerminal && labels.depth[labels.tokens.start[token]!] === 1) starts.push(labels.tokens.start[token]!)
  let count = 0
  starts.forEach((start, index) => {
    const end = starts[index + 1] ?? labels.codePoints.length
    if (positionOf[start]! < writtenCase.sample.firstErrorPosition) return
    for (let at = start + 1; at < end; at++) if (positionOf[at] !== positionOf[at - 1]! + 1) return
    for (let at = start; at < end; at++) if (writtenCase.sample.alignment[positionOf[at]!] !== -1) count++
  })
  return count
}

// Whether the broken program of a case holds a line whose code points are all added by the writer's repair, white
// space aside, e.g. a sentence between two definitions.
function holdsAddedLine(writtenCase: WrittenCase): boolean {
  const {alignment} = writtenCase.opinions[0]!.sample
  let position = 0
  for (const line of writtenCase.broken.split('\n')) {
    const characters = Array.from(line)
    const inked = characters.flatMap((character, offset) => character.trim() === '' ? [] : [position + offset])
    if (inked.length > 0 && inked.every(at => alignment[at] === -1)) return true
    position += characters.length + 1
  }
  return false
}

// The lines of README.md that hold numbers of the set, in the order of the page.
export function readmeLines(cases: readonly WrittenCase[]): string[] {
  const files = [...new Set(cases.map(writtenCase => writtenCase.file))].sort()
  const lines: string[] = []
  const fullAgreement = (some: readonly WrittenCase[]) => some.filter(writtenCase => !writtenCase.disputedFromFirstError)

  lines.push('| Writer\'s file | Cases | With full agreement | With a disputed code point | Scored code points | Of them in cases with full agreement |', '| --- | --- | --- | --- | --- | --- |')
  for (const [name, some] of [...files.map(file => [`\`${file}\``, cases.filter(writtenCase => writtenCase.file === file)] as const), ['All', cases] as const]) {
    const full = fullAgreement(some)
    lines.push(`| ${name} | ${some.length} | ${full.length} | ${some.length - full.length} | ${grouped(sum(some, writtenCase => writtenCase.sample.scored))} | ${grouped(sum(full, writtenCase => writtenCase.sample.scored))} |`)
  }

  const codePoints = sum(cases, writtenCase => writtenCase.agreement.length)
  const fromFirstError = sum(cases, writtenCase => writtenCase.agreement.length - writtenCase.sample.firstErrorPosition)
  lines.push(`The broken programs have ${grouped(codePoints)} code points, and ${grouped(fromFirstError)} of them stand from that first error on. Of these, ${grouped(sum(cases, writtenCase => writtenCase.sample.scored))} are scored, ${grouped(sum(cases, writtenCase => countOf(writtenCase, 'added', true)))} are added by both repairs, and ${sum(cases, writtenCase => countOf(writtenCase, 'disputed', true))} are disputed.`)

  const sameProgram = cases.filter(writtenCase => writtenCase.opinions.length === 2 && writtenCase.opinions[0]!.text === writtenCase.opinions[1]!.text)
  const sameLabels = cases.filter(writtenCase => !writtenCase.agreement.includes('disputed'))
  const onlyBefore = cases.filter(writtenCase => writtenCase.agreement.includes('disputed') && !writtenCase.disputedFromFirstError)
  lines.push(`In ${sameProgram.length} cases the two repairs give the same repaired program, and in ${sameLabels.length} they give every code point the same label. In ${onlyBefore.length} cases the labels differ only before the first error, where no score counts, and ${cases.length - sameLabels.length - onlyBefore.length} cases have a disputed code point from the first error on.`)

  const lengths = cases.map(writtenCase => writtenCase.agreement.length).sort((left, right) => left - right)
  const scored = cases.map(writtenCase => writtenCase.sample.scored).sort((left, right) => left - right)
  const tenth = Math.floor(cases.length / 10)
  lines.push(`The broken programs have ${lengths[0]} to ${lengths.at(-1)} code points, with a median of ${lengths[Math.floor(lengths.length / 2)]}, and all but ${cases.filter(writtenCase => !writtenCase.broken.trimEnd().includes('\n')).length} are on several lines. ${cases.filter(writtenCase => holdsCodePointAbove(writtenCase.broken, 0x7f)).length} hold a character outside ASCII, and ${cases.filter(writtenCase => holdsCodePointAbove(writtenCase.broken, 0xffff)).length} hold a character outside the Basic Multilingual Plane. A case has ${Math.round(sum(cases, writtenCase => writtenCase.sample.scored) / cases.length)} scored code points on average, a tenth of the cases has ${scored[tenth]} or fewer, and a tenth ${scored[cases.length - 1 - tenth]} or more. In ${cases.filter(writtenCase => writtenCase.sample.firstErrorPosition === 0).length} cases the first error is the program's first token.`)

  // The damaged places by the writers' repairs, see damagedPlacesOf of neutral-edits.ts.
  const places = cases.map(writtenCase => damagedPlacesOf(writtenCase.broken, writtenCase.opinions[0]!))
  const withAdded = places.map(found => found.some(place => place.added !== '')), withMissing = places.map(found => found.some(place => place.missing !== ''))
  lines.push(`The writers' repairs change the programs at ${sum(places, found => found.length)} places, and ${places.filter(found => found.length === 1).length} cases have one damaged place. In ${places.filter((_, index) => !withAdded[index]).length} cases the broken program only lacks text, in ${places.filter((_, index) => !withMissing[index]).length} it only has added text, and in ${places.filter((_, index) => withAdded[index] && withMissing[index]).length} both. ${cases.filter(holdsAddedLine).length} cases hold a line of which every code point but white space is added.`)

  const untouched = sum(cases, scoredInUntouchedDefinitions)
  const allScored = sum(cases, writtenCase => writtenCase.sample.scored)
  lines.push(`${grouped(untouched)} of the ${grouped(allScored)} scored code points, ${(100 * untouched / allScored).toFixed(1)}%, stand in a later definition that the damage did not touch`)
  lines.push(`In ${cases.filter(writtenCase => scoredInUntouchedDefinitions(writtenCase) === writtenCase.sample.scored).length} cases every scored code point stands in such a definition`)

  const keptBefore = sum(cases, writtenCase => writtenCase.opinions[0]!.sample.alignment.reduce((total, counterpart, position) => total + Number(counterpart !== -1 && position < writtenCase.sample.firstErrorPosition), 0))
  lines.push(`${grouped(sum(cases, writtenCase => wrongBeforeFirstError(writtenCase.opinions[0]!.sample).length))} of the ${grouped(keptBefore)} code points that the writers' repairs keep before the first error`)

  const full = samplesOfWritten(cases)
  const packed = packSamples(full)
  const allPacked = packSamples(samplesOfWritten(cases, 'agreed code points'))
  lines.push(`${grouped(packed.scoredCodePoints - packed.boundCodePoints)} of the ${grouped(packed.scoredCodePoints)} scored code points of the cases with full agreement`)
  lines.push(`${full.filter((_, index) => packed.bound[index] !== packed.scored[index]).length} of the ${full.length} cases with full agreement`)
  lines.push(`${sum(cases, writtenCase => changedTokensOf(writtenCase.sample))} tokens in ${cases.filter(writtenCase => changedTokensOf(writtenCase.sample) > 0).length} cases`)
  lines.push(`all ${cases.length} cases over their agreed code points, it is ${grouped(allPacked.scoredCodePoints - allPacked.boundCodePoints)} of ${grouped(allPacked.scoredCodePoints)}`)

  const otherStack = sum(cases, writtenCase => writtenCase.agreement.reduce((total, state, position) => total + Number(state === 'agreed' && position >= writtenCase.sample.firstErrorPosition && writtenCase.stackAgreed[position] === 0), 0))
  lines.push(`${otherStack} scored code points in ${cases.filter(writtenCase => writtenCase.agreement.some((state, position) => state === 'agreed' && position >= writtenCase.sample.firstErrorPosition && writtenCase.stackAgreed[position] === 0)).length} cases`)

  const marked = (name: 'writer' | 'second') => cases.filter(writtenCase => writtenCase.opinions.some(opinion => opinion.name === name && opinion.unsure !== undefined)).length
  const markedCases = cases.filter(writtenCase => writtenCase.opinions.some(opinion => opinion.unsure !== undefined))
  lines.push(`The writers marked ${marked('writer')} repairs as unsure and the second repairers ${marked('second')}, in ${markedCases.length} cases. ${markedCases.filter(writtenCase => writtenCase.disputedFromFirstError).length} of the ${cases.length - fullAgreement(cases).length} disputed cases are among them, and ${fullAgreement(markedCases).length} of the ${fullAgreement(cases).length} cases with full agreement.`)

  lines.push('| Writer\'s file | One to three edits make the damage | More than three edits make it | A damaged place that no edits make |', '| --- | --- | --- | --- |')
  const parts = new Map(cases.map(writtenCase => [writtenCase.id, damagePartOf(neutralEditsOf(writtenCase))] as const))
  for (const [name, some] of [...files.map(file => [`\`${file}\``, cases.filter(writtenCase => writtenCase.file === file)] as const), ['All', cases] as const]) {
    const count = (part: string) => some.filter(writtenCase => parts.get(writtenCase.id) === part).length
    lines.push(`| ${name} | ${count('neutral edits')} | ${count('more edits')} | ${count('other damage')} |`)
  }
  const neutral = cases.filter(writtenCase => parts.get(writtenCase.id) === 'neutral edits')
  const editCount = (writtenCase: WrittenCase) => neutralEditsOf(writtenCase).edits.length
  lines.push(`${neutral.filter(writtenCase => editCount(writtenCase) === 1).length} cases take one edit, ${neutral.filter(writtenCase => editCount(writtenCase) === 2).length} take two and ${neutral.filter(writtenCase => editCount(writtenCase) === 3).length} take three.`)
  const perEdit = new Map<string, number>()
  for (const writtenCase of neutral) for (const edit of new Set(neutralEditsOf(writtenCase).edits)) perEdit.set(edit, (perEdit.get(edit) ?? 0) + 1)
  lines.push(`By the cases that an edit is in: ${[...perEdit].sort((left, right) => right[1] - left[1]).map(([edit, count]) => `"${edit}" ${count}`).join(', ')}.`)
  const others = cases.filter(writtenCase => parts.get(writtenCase.id) === 'other damage')
  lines.push(`In ${others.filter(writtenCase => couldComeFromEdits(neutralEditsOf(writtenCase, 0, true))).length} of them, one to three edits would make the damage if an edit could write a code point that the program does not hold`)
  lines.push(`${cases.filter(writtenCase => writtenCase.opinions.length === 2 && damagePartOf(neutralEditsOf(writtenCase, 1)) !== parts.get(writtenCase.id)).length} case`)
  return lines
}

if (import.meta.main) {
  const {cases, problems} = readWritten(setFolderOf(process.argv.slice(2)))
  if (problems.length > 0) console.log(`${problems.length} problems in the files: the cases that they name are left out below. check.ts prints them.\n`)
  for (const line of readmeLines(cases)) console.log(line)
  if (problems.length > 0) process.exitCode = 1
}
