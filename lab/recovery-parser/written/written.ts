// The written evaluation set: broken texts that agents wrote from what broken JSON looks like outside the dataset's
// generator, each with the document that its author meant, and each repaired again by agents who saw only the broken
// text. This file reads the cases and the repairs and gives, per case, what a score needs.
//
// An opinion is a valid text for a broken text: the writer's intended text, or a repair. align.ts says which code
// point of the broken text is which code point of the valid text, and a code point of the broken text takes its
// counterpart's label, as in a sample of the dataset. The opinions are then held against each other per code point
// of the broken text:
// - agreed: every opinion gives it a label, and the same display kind, depth and container. Only these are scored.
// - added: every opinion says that it has no counterpart. It has no label, as in the dataset.
// - disputed: anything else, e.g. one repair keeps a comma and the other removes it. It is kept apart.
//
// A written case is as near to a Sample of samples.ts as its making allows: the fields that both have are named as in
// Sample and mean the same, see WrittenCase, and labelsOfWritten is what labelsOf is for a sample. What a written case
// lacks:
// - source, recipe, kinds, forms, template, style, typing: nobody drew the case from a generator.
// - edits: a case has two texts and no edits. The alignment comes from align.ts.
// - reachable, needsRules, needsClass and with them groupOf: they are judgments per form of a kind of damage.
// - split and heldOut: the whole set is for testing, and no arm of the experiment trains on it.
// - unscoredKinds and unscoredNesting as indexes into the original: with several opinions there is no one original,
//   so unscoredKindPositions and unscoredNestingPositions hold positions in the broken text.
// - What a kind of damage declares as not scored, the first of the four rules of the dataset's README. A written case
//   has no kind. Two of the things that kinds declare show in the two texts and are applied here, see unscoredOf: a
//   quote that lost its backslash, and what reads as an escape after a backslash that lost its second half. The rest
//   is scored unless the opinions differ on it, e.g. the comma after a string whose last backslash now escapes the
//   closing quote, which every reader takes for the string's content. The other three rules are applied.
//
// Run from the repo root: bun lab/recovery-parser/written/written.ts [folder] [--disputed]
// It prints one line per case, and with --disputed every case that has a disputed code point, opinion by opinion.
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {displayKind, errorKinds, maximumDepth} from '../../../src/json-search/highlighter/kinds.ts'
import {type Label, type ValidLabel, labelsOfValidText} from '../labels.ts'
import {limitsOf, readsAsNumberOrLiteral} from '../limits.ts'
import {hashText} from '../random.ts'
import type {Sample} from '../samples.ts'
import {type ParserTrace, capacity, runTableParser} from '../table-parser.ts'
import {align} from './align.ts'
import {type CaseEntry, type RepairEntry, readCaseFile, readRepairFile} from './format.ts'

// The folder of this file, with the cases in cases/ and the repairs in repairs/.
export const writtenFolder = import.meta.dir

export type Opinion = {
  // 'writer' for the intended text, or the name of the repair file without its ending, e.g. 'part-1.a'.
  name: string
  // The valid text of this opinion.
  text: string
  // The other reading, when a repairer marked the repair as unsure.
  unsure: string | undefined
  // As in a sample: for each code point of the broken text the index of its counterpart in `text`, or -1, and whether
  // it stands in the place of a counterpart that differs.
  alignment: number[]
  replaced: boolean[]
  // The label of every code point of the broken text by this opinion: its counterpart's, or undefined when added.
  labels: (ValidLabel | undefined)[]
}

export type Agreement = 'agreed' | 'added' | 'disputed'

// The fields of Sample that a written case has with the same meaning, where `original` is the writer's intended text
// and `alignment`, `replaced` and `firstDamage` are the writer's opinion. `debatable` is the writer's mark, where a
// sample's is the judgment of its form.
export type WrittenCase = Pick<Sample, 'id' | 'documents' | 'original' | 'broken' | 'lineEnd' | 'alignment' | 'replaced' | 'firstDamage' | 'firstErrorPosition' | 'firstErrorKind' | 'needsNestingFix' | 'needsDisplayFix' | 'debatable'> & {
  // The name of the writer's file in cases/, e.g. 'python-print.txt'.
  file: string
  // The id under which the repairers saw the broken text, see blindIdOf.
  blindId: string
  // Where such a broken text comes from, in the writer's words.
  from: string
  note: string | undefined
  // The writer's opinion first, then the repairs in the order of their files' names.
  opinions: Opinion[]
  // Per code point of the broken text.
  agreement: Agreement[]
  // Positions in the broken text of agreed code points whose display kind is not scored, and of those whose depth and
  // container are not scored, by the rules of the dataset that need no kind of damage, see unscoredOf.
  unscoredKindPositions: number[]
  unscoredNestingPositions: number[]
  // Whether a code point from the first error of the parser as it is on is disputed. A case without one is a case
  // with full agreement.
  disputedFromFirstError: boolean
}

// The id of a broken text for the repairers: a hash of the text, which tells neither the writer nor the source. A
// repair names the text by this id, so a repair of a text that was changed afterwards fits no case.
export const blindIdOf = (broken: string) => hashText(broken).toString(16).padStart(8, '0')

const parses = (text: string) => {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}
const codePointLength = (text: string) => Array.from(text).length

// What keeps a text from being an intended text or a repair: it is one valid JSON document within the highlighter's
// capacity of 512 code points and 16 levels.
export function validTextProblems(text: string): string[] {
  if (!parses(text)) return ['it is not valid JSON: JSON.parse rejects it']
  if (codePointLength(text) > capacity) return [`it has ${codePointLength(text)} code points, and the highlighter reads ${capacity}`]
  try {
    labelsOfValidText(text)
  } catch {
    return [`it is nested deeper than ${maximumDepth} levels, which the highlighter rejects`]
  }
  return []
}

// What keeps a text from being a broken text: JSON.parse and the parser as it is both reject it, and it is within
// the capacity, also as the parser as it is counts its brackets. E.g. an open string can hide closing brackets, and a
// brace in the string's content then opens a 17th level.
export function brokenTextProblems(text: string): string[] {
  if (parses(text)) return ['it is valid JSON: JSON.parse accepts it']
  if (codePointLength(text) > capacity) return [`it has ${codePointLength(text)} code points, and the highlighter reads ${capacity}`]
  const trace = runTableParser(text)
  if (trace.valid) return ['the highlighter accepts it']
  for (let position = 0; position < trace.length; position++) {
    if (trace.depthAfter[position]! > maximumDepth) return [`the parser as it is counts more than ${maximumDepth} open brackets at code point ${position}`]
  }
  return []
}

// One opinion about a broken text. Throws when the text is not valid, see validTextProblems.
export function opinionOf(name: string, text: string, unsure: string | undefined, broken: string): Opinion {
  const labels = labelsOfValidText(text)
  const {alignment, replaced} = align(broken, text)
  return {name, text, unsure, alignment, replaced, labels: alignment.map(counterpart => counterpart === -1 ? undefined : labels[counterpart]!)}
}

// The index in the broken text of the first damaged code point by an alignment, as a sample's firstDamage: the first
// that is added or replaced, the first kept one after a removed part, or the broken text's length when only the
// valid text's end is missing.
function firstDamageOf(alignment: readonly number[], replaced: readonly boolean[], validLength: number) {
  for (let position = 0; position < alignment.length; position++) {
    if (alignment[position] !== position || replaced[position] === true) return position
  }
  return alignment.length < validLength ? alignment.length : -1
}

// The values of an opinion's labels that are not scored, as positions in the broken text. These are the rules of
// unscoredOf in samples.ts without the one that needs a kind of damage:
// - Before the first error of the parser as it is, a value that the parser as it is does not give.
// - A string value that lost its opening quote and stands after white space or punctuation: the display kind of the
//   code points at its start that read as a number or a literal, e.g. the 0.2 of `version: 0.2.0`.
// - Where the depth or the container changes at a code point that is not a bracket, a bracket was removed before it:
//   the depth and the container from there to the next kept bracket.
// And two of the things that kinds of damage declare in the dataset, which the two texts show without a kind:
// - The rest of an escape whose backslash the broken text lacks, e.g. the inner quotes of `"call "Ana" back"`: its
//   label says escape, and no reading of the broken text shows that.
// - What reads as an escape after a backslash that lost its second half, e.g. the t of `C:\temp` for `C:\\temp`,
//   the `u00e` of `C:\u00e` and a closing quote: the label says string, and every reader shows an escape.
function unscoredOf(opinion: Opinion, broken: readonly string[], trace: ParserTrace) {
  const valid = Array.from(opinion.text)
  const validLabels = labelsOfValidText(opinion.text)
  const {alignment, labels} = opinion
  const kinds = new Set<number>()
  const nesting = new Set<number>()
  const firstDamage = firstDamageOf(alignment, opinion.replaced, valid.length)
  for (let position = Math.max(0, firstDamage); position < Math.min(trace.firstErrorPosition, alignment.length); position++) {
    const label = labels[position]
    if (label === undefined) continue
    if (label.kind !== trace.displayKind[position]) kinds.add(position)
    if (label.depth !== trace.depthAfter[position] || label.container !== trace.containerAfter[position]) nesting.add(position)
  }
  const kept = new Set(alignment)
  for (let position = 0; position < alignment.length; position++) {
    const index = alignment[position]!
    if (index <= 0 || validLabels[index]!.kind !== displayKind.string) continue
    // The code point before it in the valid text is the value's opening quote, which is not in the broken text.
    if (valid[index - 1] !== '"' || validLabels[index - 1]!.kind !== displayKind.string || kept.has(index - 1)) continue
    if (position > 0) {
      const before = labels[position - 1]
      if (before === undefined ? !' \t\r\n{}[]:,'.includes(broken[position - 1]!) : kinds.has(position - 1) || (before.kind !== displayKind.whitespace && before.kind !== displayKind.punctuation)) continue
    }
    const run = readsAsNumberOrLiteral(broken, position)
    for (let offset = 0; offset < run && alignment[position + offset] === index + offset && validLabels[index + offset]!.kind === displayKind.string; offset++) kinds.add(position + offset)
  }
  const positionOf = new Array<number>(valid.length).fill(-1)
  alignment.forEach((counterpart, position) => { if (counterpart !== -1) positionOf[counterpart] = position })
  for (let index = 0; index < valid.length; index++) {
    if (valid[index] !== '\\' || validLabels[index]!.kind !== displayKind.escape) continue
    const length = valid[index + 1] === 'u' ? 6 : 2
    if (positionOf[index] === -1) {
      for (let rest = index + 1; rest < index + length; rest++) if (positionOf[rest] !== -1) kinds.add(positionOf[rest]!)
    } else if (valid[index + 1] === '\\' && positionOf[index + 1] === -1) {
      const after = positionOf[index]! + 1
      if ('bfnrt/"'.includes(broken[after] ?? ' ')) kinds.add(after)
      else if (broken[after] === 'u') for (let digit = after; digit <= after + 4 && (digit === after || /^[0-9a-fA-F]$/.test(broken[digit] ?? '')); digit++) kinds.add(digit)
    }
    index += length - 1
  }
  let depthBefore = 0
  let containerBefore = 0
  let afterRemovedBracket = false
  for (let position = 0; position < alignment.length; position++) {
    const label = labels[position]
    if (label === undefined) continue
    const isBracket = label.kind === displayKind.punctuation && '{}[]'.includes(valid[alignment[position]!]!)
    if (isBracket) afterRemovedBracket = false
    else if (label.depth !== depthBefore || label.container !== containerBefore) afterRemovedBracket = true
    if (afterRemovedBracket) nesting.add(position)
    depthBefore = label.depth
    containerBefore = label.container
  }
  return {kinds, nesting}
}

// What a case file holds of a case, and the repairs of its broken text, each with the name of its opinion.
export type CaseTexts = Pick<CaseEntry, 'id' | 'from' | 'note' | 'debatable' | 'intended' | 'broken'>
export type RepairText = {name: string, repaired: string, unsure: string | undefined}

// A case with its opinions and their agreement. It works with the writer's opinion alone, before any repair exists:
// every code point is then agreed or added. Throws when a text is not what validTextProblems and brokenTextProblems
// ask for.
export function caseOf(texts: CaseTexts, file: string, repairs: readonly RepairText[] = []): WrittenCase {
  const problems = [...validTextProblems(texts.intended).map(problem => `the intended text: ${problem}`), ...brokenTextProblems(texts.broken).map(problem => `the broken text: ${problem}`)]
  if (problems.length > 0) throw new Error(problems.join('; '))
  const broken = Array.from(texts.broken)
  const trace = runTableParser(texts.broken)
  const opinions = [opinionOf('writer', texts.intended, undefined, texts.broken), ...repairs.map(repair => opinionOf(repair.name, repair.repaired, repair.unsure, texts.broken))]
  const writer = opinions[0]!
  const agreement = broken.map((_, position): Agreement => {
    const first = writer.labels[position]
    if (opinions.every(opinion => opinion.labels[position] === undefined)) return 'added'
    return first !== undefined && opinions.every(opinion => {
      const label = opinion.labels[position]
      return label !== undefined && label.kind === first.kind && label.depth === first.depth && label.container === first.container
    }) ? 'agreed' : 'disputed'
  })
  // A value is not scored when the rules say so for any of the opinions.
  const unscored = opinions.map(opinion => unscoredOf(opinion, broken, trace))
  const positionsOf = (pick: (sets: typeof unscored[number]) => Set<number>) =>
    broken.flatMap((_, position) => agreement[position] === 'agreed' && unscored.some(sets => pick(sets).has(position)) ? [position] : [])
  const draft = {
    id: texts.id, file, blindId: blindIdOf(texts.broken), from: texts.from, note: texts.note, debatable: texts.debatable,
    documents: [texts.intended], original: texts.intended, broken: texts.broken, lineEnd: texts.intended.includes('\r\n') ? '\r\n' as const : '\n' as const,
    alignment: writer.alignment, replaced: writer.replaced, firstDamage: firstDamageOf(writer.alignment, writer.replaced, codePointLength(texts.intended)),
    firstErrorPosition: trace.firstErrorPosition, firstErrorKind: trace.firstErrorKind,
    opinions, agreement, unscoredKindPositions: positionsOf(sets => sets.kinds), unscoredNestingPositions: positionsOf(sets => sets.nesting),
    disputedFromFirstError: agreement.some((state, position) => state === 'disputed' && position >= trace.firstErrorPosition),
  }
  const limits = limitsOf(broken, labelsOfWritten(draft), trace.firstErrorPosition)
  return {...draft, needsNestingFix: limits.needsNestingFix, needsDisplayFix: limits.needsDisplayFix}
}

// What labelsOf is for a sample: one entry per code point of the broken text. The entry is the label that every
// opinion gives, with `undefined` for a value that is not scored, see Label. It is undefined for a code point that
// every opinion calls added, and also for a disputed one, which no score counts: `agreement` tells the two apart.
export function labelsOfWritten(writtenCase: Pick<WrittenCase, 'opinions' | 'agreement' | 'unscoredKindPositions' | 'unscoredNestingPositions'>): (Label | undefined)[] {
  const unscoredKinds = new Set(writtenCase.unscoredKindPositions)
  const unscoredNesting = new Set(writtenCase.unscoredNestingPositions)
  return writtenCase.agreement.map((state, position) => {
    const label = writtenCase.opinions[0]!.labels[position]
    if (state !== 'agreed' || label === undefined) return undefined
    const nestingScored = !unscoredNesting.has(position)
    return {kind: unscoredKinds.has(position) ? undefined : label.kind, depth: nestingScored ? label.depth : undefined, container: nestingScored ? label.container : undefined}
  })
}

// What scoredCodePoints is for a sample: how many code points a score counts, i.e. those from the first error of the
// parser as it is on that have a label with a scored value.
export function scoredCodePointsOfWritten(writtenCase: WrittenCase, labels: readonly (Label | undefined)[] = labelsOfWritten(writtenCase)) {
  let count = 0
  for (let position = writtenCase.firstErrorPosition; position < labels.length; position++) {
    const label = labels[position]
    if (label !== undefined && (label.kind !== undefined || label.depth !== undefined)) count++
  }
  return count
}

const textFilesOf = (folder: string) => existsSync(folder) ? readdirSync(folder).filter(name => name.endsWith('.txt')).sort() : []

// Every case of cases/ with the repairs of repairs/, and what is wrong with the files. A case or a repair with a
// problem is left out, so the problems must be empty before the cases are used for a result.
export function readWritten(folder: string = writtenFolder): {cases: WrittenCase[], problems: string[]} {
  const problems: string[] = []
  const repairsOf = new Map<string, RepairText[]>()
  const repairFiles = textFilesOf(join(folder, 'repairs'))
  const repairEntries: {file: string, entry: RepairEntry}[] = []
  for (const file of repairFiles) {
    const read = readRepairFile(readFileSync(join(folder, 'repairs', file), 'utf8'))
    problems.push(...read.problems.map(problem => `repairs/${file}: ${problem}`))
    for (const entry of read.items) repairEntries.push({file, entry})
  }
  const caseTexts: {file: string, texts: CaseEntry}[] = []
  const fileOfId = new Map<string, string>()
  const idOfBroken = new Map<string, string>()
  const idOfBlindId = new Map<string, string>()
  for (const file of textFilesOf(join(folder, 'cases'))) {
    const read = readCaseFile(readFileSync(join(folder, 'cases', file), 'utf8'))
    problems.push(...read.problems.map(problem => `cases/${file}: ${problem}`))
    for (const texts of read.items) {
      const where = `cases/${file}: case ${texts.id}`
      const found = [...validTextProblems(texts.intended).map(problem => `the intended text: ${problem}`), ...brokenTextProblems(texts.broken).map(problem => `the broken text: ${problem}`)]
      if (fileOfId.has(texts.id)) found.push(`the id is also in cases/${fileOfId.get(texts.id)}`)
      if (idOfBroken.has(texts.broken)) found.push(`the broken text is also the broken text of the case ${idOfBroken.get(texts.broken)}`)
      else if (idOfBlindId.has(blindIdOf(texts.broken))) found.push(`the broken text has the same hash as the one of the case ${idOfBlindId.get(blindIdOf(texts.broken))}, so the two would share an id for the repairers. Change one code point of one of them`)
      problems.push(...found.map(problem => `${where}: ${problem}`))
      if (found.length > 0) continue
      fileOfId.set(texts.id, file)
      idOfBroken.set(texts.broken, texts.id)
      idOfBlindId.set(blindIdOf(texts.broken), texts.id)
      caseTexts.push({file, texts})
    }
  }
  for (const {file, entry} of repairEntries) {
    const where = `repairs/${file}: repair ${entry.id}`
    const found = validTextProblems(entry.repaired)
    if (!idOfBlindId.has(entry.id)) found.push('no case has a broken text with this id')
    problems.push(...found.map(problem => `${where}: ${problem}`))
    if (found.length > 0) continue
    let repairs = repairsOf.get(entry.id)
    if (repairs === undefined) repairsOf.set(entry.id, repairs = [])
    repairs.push({name: file.replace(/\.txt$/, ''), repaired: entry.repaired, unsure: entry.unsure})
  }
  const cases = caseTexts.map(({file, texts}) => caseOf(texts, file, repairsOf.get(blindIdOf(texts.broken)) ?? []))
  return {cases, problems}
}

if (import.meta.main) {
  const {describeOpinions} = await import('./show.ts')
  const folder = process.argv.slice(2).find(argument => !argument.startsWith('--')) ?? writtenFolder
  const showDisputed = process.argv.includes('--disputed')
  const {cases, problems} = readWritten(folder)
  for (const problem of problems) console.log(`problem: ${problem}`)
  const count = (states: readonly Agreement[], from: number, wanted: Agreement) => states.reduce((total, state, position) => total + Number(position >= from && state === wanted), 0)
  console.log('Per case: the writer\'s file and id, the repairs, where the parser as it is has its first error, and from that code point on the')
  console.log('scored code points, the code points that every opinion calls added, and the disputed ones.')
  for (const writtenCase of cases) {
    const marks = [...(writtenCase.debatable ? ['debatable'] : []), ...writtenCase.opinions.filter(opinion => opinion.unsure !== undefined).map(opinion => `${opinion.name} is unsure`)]
    console.log(`  ${writtenCase.file} ${writtenCase.id}: ${writtenCase.opinions.length - 1} repairs, first error at ${writtenCase.firstErrorPosition} of ${writtenCase.agreement.length} (${errorKinds[writtenCase.firstErrorKind]}), `
      + `${scoredCodePointsOfWritten(writtenCase)} scored, ${count(writtenCase.agreement, writtenCase.firstErrorPosition, 'added')} added, ${count(writtenCase.agreement, writtenCase.firstErrorPosition, 'disputed')} disputed${marks.length > 0 ? `, ${marks.join(', ')}` : ''}`)
  }
  const disputed = cases.filter(writtenCase => writtenCase.disputedFromFirstError)
  if (showDisputed) for (const writtenCase of disputed) console.log(`\n${describeOpinions(writtenCase)}`)
  const repaired = (wanted: number) => cases.filter(writtenCase => writtenCase.opinions.length - 1 === wanted).length
  console.log(`${cases.length} cases: ${repaired(2)} with two repairs, ${repaired(1)} with one, ${repaired(0)} with none, ${cases.length - repaired(0) - repaired(1) - repaired(2)} with more. ${cases.length - disputed.length} with full agreement from the first error on, ${disputed.length} with a disputed code point there. ${problems.length} problems.`)
  if (problems.length > 0) process.exitCode = 1
}
