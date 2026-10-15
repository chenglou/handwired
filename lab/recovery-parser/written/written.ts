// The written evaluation set: broken texts that agents wrote from what broken JSON looks like outside the dataset's
// generator, each with the document that its author meant, and each repaired again by agents who saw only the broken
// text. This file reads the cases and the repairs and gives, per case, what a score needs.
//
// An opinion is a valid text for a broken text: the writer's intended text, or a repair. align.ts says which code
// point of the broken text is which code point of the valid text, and a code point of the broken text takes its
// counterpart's label, as in a sample of the dataset. The opinions are then held against each other per code point
// of the broken text:
// - agreed: every opinion gives it a label, and the same display kind, depth and container. Only these are scored.
//   A value that an opinion's own reading leaves unscored, see unscoredOf, is no dispute with another opinion: e.g.
//   one opinion misses a `]` right after a `}` and another on a line of its own, so they give the white space
//   between another depth, which the rule on a missing bracket does not score in the first of them.
// - added: every opinion says that it has no counterpart. It has no label, as in the dataset.
// - disputed: anything else, e.g. one repair keeps a comma and the other removes it. It is kept apart.
// - without a label by the list: no-label.txt names it, and the opinions are not asked. It has no label, as in the
//   dataset. The list holds text that the generator gives no label and that the opinions keep in different ways:
//   a placeholder that stands where a value is meant, e.g. `{{user_id}}`, which one opinion takes for a string that
//   lost its quotes and another for text in the place of a number, and a line feed that stands for a space inside a
//   string that a program wrapped. A line of the list is the id of the case, the position of the text's first code
//   point in the broken text, the reason, a colon and a space, and the text as a case file writes it.
//
// A repair that plainly breaks a rule of REPAIR.md can be left out for its one case: a line of left-out.txt names the
// repair file without its ending, the id of the broken text, and the reason. The README lists these repairs.
//
// A written case is as near to a Sample of samples.ts as its making allows: the fields that both have are named as in
// Sample and mean the same, see WrittenCase, and labelsOfWritten is what labelsOf is for a sample. What a written case
// lacks:
// - source, recipe, kinds, forms, template, style, typing: nobody drew the case from a generator. kinds.txt holds a
//   judgment per case instead: the generator's kinds that describe its damage, and whether it has damage that no kind
//   makes, see CaseDamage.
// - edits: a case has two texts and no edits. The alignment comes from align.ts.
// - reachable, needsRules, needsClass and with them groupOf: they are judgments per form of a kind of damage.
// - split and heldOut: the whole set is for testing, and no arm of the experiment trains on it.
// - unscoredKinds and unscoredNesting as indexes into the original: with several opinions there is no one original,
//   so unscoredKindPositions and unscoredNestingPositions hold positions in the broken text.
// - What a kind of damage declares as not scored, the first of the four rules of the dataset's README. A written case
//   has no kind. Three of the things that kinds declare show in the two texts and are applied here, see unscoredOf: a
//   quote that lost its backslash, what reads as an escape after a backslash that lost its second half, and the
//   digits of a number with a leading zero. The rest is scored unless the opinions differ on it, e.g. the comma after
//   a string whose last backslash now escapes the closing quote, which every reader takes for the string's content.
//   The other three rules are applied.
//
// Run from the repo root: bun lab/recovery-parser/written/written.ts [folder] [--disputed] [--kinds]
// It prints one line per case, with --disputed every case that has a disputed code point, opinion by opinion, and
// with --kinds what kinds.txt says: per writer's file the cases whose damage is all of the generator's kinds and the
// cases with damage that no kind makes, and per kind the cases that it describes.
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {displayKind, errorKinds, maximumDepth} from '../../../src/json-search/highlighter/kinds.ts'
import {kinds as generatorKinds} from '../damage.ts'
import {type Label, type ValidLabel, labelsOfValidText} from '../labels.ts'
import {limitsOf, readsAsNumberOrLiteral} from '../limits.ts'
import {hashText} from '../random.ts'
import type {Sample} from '../samples.ts'
import {type ParserTrace, capacity, runTableParser} from '../table-parser.ts'
import {align} from './align.ts'
import {type CaseEntry, type RepairEntry, readCaseFile, readRepairFile, textOfLines} from './format.ts'

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

export type Agreement = 'agreed' | 'added' | 'disputed' | 'noLabel'

// A repair that is left out of its case: the name of its opinion, and why.
export type LeftOut = {name: string, reason: string}

// Text of a broken text that has no label by the list of no-label.txt: the position of its first code point in the
// broken text, the text, and why it is on the list.
export type NoLabel = {position: number, text: string, reason: string}

// What kinds.txt says about a case's damage: the generator's kinds that describe it, by the names of the table of
// kinds in the dataset's README, and in a few words the damage that no kind makes, when the case has such damage.
export type CaseDamage = {kinds: string[], other: string | undefined}

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
  // The repairs of this case that left-out.txt names, which are no opinions of the case.
  leftOut: LeftOut[]
  // The texts of this case that no-label.txt names.
  noLabel: NoLabel[]
  // What kinds.txt says about the case, or undefined where no such file is read, e.g. for a writer's file alone.
  damage: CaseDamage | undefined
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
//   the `u00e` of `C:\u00e`, and a closing quote with the comma after it: the labels say string and punctuation, and
//   every reader shows an escape and goes on with the string.
// And one thing that the kind numberFormat declares:
// - The display kind of the digits of a number with a leading zero, e.g. the `0644` of `"mode": 0644`: the number
//   644 and the string "0644" are as sensible, so the dataset does not score the digits' display kind. Here the
//   digits are those of a value that is digits alone after a zero, which the opinion reads as a number with zeros
//   added before it or as a string that lost both of its quotes.
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
      // After a quote that reads as escaped, the string goes on, and a comma is its content.
      if (broken[after] === '"' && broken[after + 1] === ',') kinds.add(after + 1)
      else if (broken[after] === 'u') for (let digit = after; digit <= after + 4 && (digit === after || /^[0-9a-fA-F]$/.test(broken[digit] ?? '')); digit++) kinds.add(digit)
    }
    index += length - 1
  }
  const isDigit = (character: string | undefined) => character !== undefined && character >= '0' && character <= '9'
  for (let start = 0; start < broken.length; start++) {
    if (broken[start] !== '0' || !isDigit(broken[start + 1]) || (start > 0 && !' \t\r\n{[:,'.includes(broken[start - 1]!))) continue
    let end = start
    while (isDigit(broken[end])) end++
    // The value is the digits alone: white space, a comma or a closing bracket follows, or the text ends.
    if (end < broken.length && !' \t\r\n,}]'.includes(broken[end]!)) continue
    const digits = Array.from({length: end - start}, (_, offset) => start + offset)
    // A number after zeros that the opinion calls added, e.g. 644 after the 0 of 0644.
    let firstOfNumber = start
    while (firstOfNumber < end && broken[firstOfNumber] === '0' && labels[firstOfNumber] === undefined) firstOfNumber++
    const number = digits.filter(position => position >= firstOfNumber)
    const asNumber = firstOfNumber > start && number.length > 0
      && number.every(position => labels[position]?.kind === displayKind.number && alignment[position] === alignment[firstOfNumber]! + position - firstOfNumber)
    // A string of these digits alone, whose two quotes the broken text lacks, e.g. "0644".
    const first = alignment[start]!
    const asString = digits.every(position => alignment[position] === first + position - start && labels[position]?.kind === displayKind.string)
      && valid[first - 1] === '"' && !kept.has(first - 1) && valid[first + digits.length] === '"' && !kept.has(first + digits.length)
    if (asNumber) for (const position of number) kinds.add(position)
    if (asString) for (const position of digits) kinds.add(position)
    start = end
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

// What keeps an entry of no-label.txt from naming text of a broken text: the text stands at the position.
export function noLabelProblems(entry: NoLabel, brokenText: string): string[] {
  const broken = Array.from(brokenText)
  const text = Array.from(entry.text)
  if (text.length === 0) return ['the text is empty']
  const found = broken.slice(entry.position, entry.position + text.length).join('')
  return found === entry.text ? [] : [`the broken text does not have ${JSON.stringify(entry.text)} at code point ${entry.position}${entry.position < broken.length ? `, where ${JSON.stringify(found)} stands` : ''}`]
}

// A case with its opinions and their agreement. It works with the writer's opinion alone, before any repair exists:
// every code point is then agreed or added. `noLabel` are the case's entries of no-label.txt, and `damage` is what
// kinds.txt says about the case. Throws when a text is not what validTextProblems, brokenTextProblems and
// noLabelProblems ask for.
export function caseOf(texts: CaseTexts, file: string, repairs: readonly RepairText[] = [], leftOut: readonly LeftOut[] = [], noLabel: readonly NoLabel[] = [], damage?: CaseDamage): WrittenCase {
  const problems = [
    ...validTextProblems(texts.intended).map(problem => `the intended text: ${problem}`), ...brokenTextProblems(texts.broken).map(problem => `the broken text: ${problem}`),
    ...noLabel.flatMap(entry => noLabelProblems(entry, texts.broken)),
  ]
  if (problems.length > 0) throw new Error(problems.join('; '))
  const broken = Array.from(texts.broken)
  const withoutLabel = new Set(noLabel.flatMap(entry => Array.from(entry.text, (_, offset) => entry.position + offset)))
  const trace = runTableParser(texts.broken)
  const opinions = [opinionOf('writer', texts.intended, undefined, texts.broken), ...repairs.map(repair => opinionOf(repair.name, repair.repaired, repair.unsure, texts.broken))]
  const writer = opinions[0]!
  // A value is not scored when the rules say so for any of the opinions, and such an opinion says nothing about the
  // value: the opinions agree on a code point when those that score its display kind give the same one, and those
  // that score its depth and container give the same two.
  const unscored = opinions.map(opinion => unscoredOf(opinion, broken, trace))
  const agreement = broken.map((_, position): Agreement => {
    // The list comes before the opinions: what it names has no label, whatever they make of it.
    if (withoutLabel.has(position)) return 'noLabel'
    if (opinions.every(opinion => opinion.labels[position] === undefined)) return 'added'
    if (opinions.some(opinion => opinion.labels[position] === undefined)) return 'disputed'
    const labelsThatScore = (pick: (sets: typeof unscored[number]) => Set<number>) => opinions.flatMap((opinion, index) => pick(unscored[index]!).has(position) ? [] : [opinion.labels[position]!])
    const kinds = labelsThatScore(sets => sets.kinds)
    const nestings = labelsThatScore(sets => sets.nesting)
    return kinds.every(label => label.kind === kinds[0]!.kind) && nestings.every(label => label.depth === nestings[0]!.depth && label.container === nestings[0]!.container) ? 'agreed' : 'disputed'
  })
  const positionsOf = (pick: (sets: typeof unscored[number]) => Set<number>) =>
    broken.flatMap((_, position) => agreement[position] === 'agreed' && unscored.some(sets => pick(sets).has(position)) ? [position] : [])
  const draft = {
    id: texts.id, file, blindId: blindIdOf(texts.broken), from: texts.from, note: texts.note, debatable: texts.debatable,
    documents: [texts.intended], original: texts.intended, broken: texts.broken, lineEnd: texts.intended.includes('\r\n') ? '\r\n' as const : '\n' as const,
    alignment: writer.alignment, replaced: writer.replaced, firstDamage: firstDamageOf(writer.alignment, writer.replaced, codePointLength(texts.intended)),
    firstErrorPosition: trace.firstErrorPosition, firstErrorKind: trace.firstErrorKind,
    opinions, leftOut: [...leftOut], noLabel: [...noLabel], damage, agreement, unscoredKindPositions: positionsOf(sets => sets.kinds), unscoredNestingPositions: positionsOf(sets => sets.nesting),
    disputedFromFirstError: agreement.some((state, position) => state === 'disputed' && position >= trace.firstErrorPosition),
  }
  const limits = limitsOf(broken, labelsOfWritten(draft), trace.firstErrorPosition)
  return {...draft, needsNestingFix: limits.needsNestingFix, needsDisplayFix: limits.needsDisplayFix}
}

// What labelsOf is for a sample: one entry per code point of the broken text. The entry is the label that the
// opinions give, with `undefined` for a value that is not scored by the reading of any of them, see Label. It is
// undefined for a code point that every opinion calls added, for one that no-label.txt names, and also for a
// disputed one, which no score counts: `agreement` tells the three apart.
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

// The lines of no-label.txt or kinds.txt that say something, each with its number in the file, counted from 1. An
// empty line says nothing, and neither does a line that starts with #, which explains the file to its reader.
function listLines(file: string): {text: string, number: number}[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').map((text, index) => ({text, number: index + 1})).filter(line => line.text.trim() !== '' && !line.text.startsWith('#'))
}

// Every case of cases/ with the repairs of repairs/, what left-out.txt, no-label.txt and kinds.txt say about them,
// and what is wrong with the files. A case or a repair with a problem is left out, so the problems must be empty
// before the cases are used for a result.
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
  // The repairs that left-out.txt names are taken out of their cases. A line that names no repair of the folder is
  // a problem, so that the list cannot outlive the repairs.
  const leftOutOf = new Map<string, LeftOut[]>()
  const leftOutFile = join(folder, 'left-out.txt')
  const leftOutLines = existsSync(leftOutFile) ? readFileSync(leftOutFile, 'utf8').split('\n').filter(line => line.trim() !== '') : []
  for (const line of leftOutLines) {
    const [, name, id, reason] = /^(\S+) ([0-9a-f]{8}) (\S.*)$/.exec(line) ?? []
    const repairs = id === undefined ? undefined : repairsOf.get(id)
    const index = repairs?.findIndex(repair => repair.name === name) ?? -1
    if (name === undefined || id === undefined || reason === undefined) problems.push(`left-out.txt: a line is the name of a repair file without its ending, the id of a broken text and the reason, with one space between them, and this line is not: ${line}`)
    else if (repairs === undefined || index === -1) problems.push(`left-out.txt: repairs/${name}.txt has no repair of ${id} that could be left out`)
    else {
      repairs.splice(index, 1)
      leftOutOf.set(id, [...(leftOutOf.get(id) ?? []), {name, reason}])
    }
  }
  // The texts that no-label.txt names, per case. A line that names no text of a case of the folder is a problem, and
  // so is a line that changes nothing, so that the list holds what it needs and no more.
  const brokenOfId = new Map(caseTexts.map(({texts}) => [texts.id, texts.broken]))
  const noLabelOf = new Map<string, NoLabel[]>()
  for (const line of listLines(join(folder, 'no-label.txt'))) {
    const where = `no-label.txt, line ${line.number}`
    const [, id, position, reason, written] = /^(\S+) (\d+) (\S.*?): (.+)$/.exec(line.text) ?? []
    if (id === undefined || position === undefined || reason === undefined || written === undefined) {
      problems.push(`${where}: a line is the id of a case, the position of the text's first code point in the broken text, the reason, a colon and a space, and the text, and this line is not: ${line.text}`)
      continue
    }
    const decoded = textOfLines([written], line.number)
    const entry: NoLabel = {position: Number(position), text: decoded.text, reason}
    const broken = brokenOfId.get(id)
    const others = noLabelOf.get(id) ?? []
    const overlaps = others.some(other => entry.position < other.position + codePointLength(other.text) && other.position < entry.position + codePointLength(entry.text))
    const found = [
      ...decoded.problems.map(problem => `the text: ${problem}`),
      ...(broken === undefined ? [`no case has the id ${id}`] : decoded.problems.length > 0 ? [] : noLabelProblems(entry, broken)),
      ...(overlaps ? ['the text overlaps the text of another line of the case'] : []),
    ]
    problems.push(...found.map(problem => `${where}: ${problem}`))
    if (found.length === 0) noLabelOf.set(id, [...others, entry])
  }
  // What kinds.txt says about each case. Where the folder has the file, every case has one line in it.
  const kindNames = new Set(generatorKinds.map(kind => kind.name))
  const damageOf = new Map<string, CaseDamage>()
  const namedInKinds = new Set<string>()
  for (const line of listLines(join(folder, 'kinds.txt'))) {
    const where = `kinds.txt, line ${line.number}`
    const [, id, names, other] = /^(\S+)((?: [A-Za-z]+)*)(?: new: (\S.*))?$/.exec(line.text) ?? []
    if (id === undefined || names === undefined) {
      problems.push(`${where}: a line is the id of a case, the names of the generator's kinds that describe its damage, each after a space, and where the case has damage that no kind makes, " new: " and that damage in a few words, and this line is not: ${line.text}`)
      continue
    }
    const kinds = names.split(' ').filter(name => name !== '')
    const found = [
      ...kinds.filter(name => !kindNames.has(name)).map(name => `${name} is no kind of the table of kinds in the dataset's README`),
      ...(new Set(kinds).size < kinds.length ? ['a kind stands twice'] : []),
      ...(kinds.length === 0 && other === undefined ? ['the line names no kind and no damage that no kind makes'] : []),
      ...(brokenOfId.has(id) ? [] : [`no case has the id ${id}`]),
      ...(namedInKinds.has(id) ? ['the case has a line before this one'] : []),
    ]
    problems.push(...found.map(problem => `${where}: ${problem}`))
    namedInKinds.add(id)
    if (found.length === 0) damageOf.set(id, {kinds, other})
  }
  if (existsSync(join(folder, 'kinds.txt'))) {
    for (const {texts} of caseTexts) if (!namedInKinds.has(texts.id)) problems.push(`kinds.txt: the case ${texts.id} has no line`)
  }
  const cases = caseTexts.map(({file, texts}) => caseOf(texts, file, repairsOf.get(blindIdOf(texts.broken)) ?? [], leftOutOf.get(blindIdOf(texts.broken)) ?? [], noLabelOf.get(texts.id) ?? [], damageOf.get(texts.id)))
  for (const writtenCase of cases) {
    for (const entry of writtenCase.noLabel) {
      const added = Array.from(entry.text).every((_, offset) => writtenCase.opinions.every(opinion => opinion.labels[entry.position + offset] === undefined))
      if (added) problems.push(`no-label.txt: every opinion of the case ${writtenCase.id} calls ${JSON.stringify(entry.text)} at code point ${entry.position} added, so the text has no label without the list`)
    }
  }
  return {cases, problems}
}

if (import.meta.main) {
  const {describeOpinions} = await import('./show.ts')
  const folder = process.argv.slice(2).find(argument => !argument.startsWith('--')) ?? writtenFolder
  const showDisputed = process.argv.includes('--disputed')
  const showKinds = process.argv.includes('--kinds')
  const {cases, problems} = readWritten(folder)
  for (const problem of problems) console.log(`problem: ${problem}`)
  const count = (states: readonly Agreement[], from: number, wanted: Agreement) => states.reduce((total, state, position) => total + Number(position >= from && state === wanted), 0)
  console.log('Per case: the writer\'s file and id, the repairs, where the parser as it is has its first error, and from that code point on the')
  console.log('scored code points, the code points that every opinion calls added, the disputed ones, and those that no-label.txt names.')
  for (const writtenCase of cases) {
    const marks = [...(writtenCase.debatable ? ['debatable'] : []), ...writtenCase.opinions.filter(opinion => opinion.unsure !== undefined).map(opinion => `${opinion.name} is unsure`), ...writtenCase.leftOut.map(repair => `${repair.name} is left out`)]
    console.log(`  ${writtenCase.file} ${writtenCase.id}: ${writtenCase.opinions.length - 1} repairs, first error at ${writtenCase.firstErrorPosition} of ${writtenCase.agreement.length} (${errorKinds[writtenCase.firstErrorKind]}), `
      + `${scoredCodePointsOfWritten(writtenCase)} scored, ${count(writtenCase.agreement, writtenCase.firstErrorPosition, 'added')} added, ${count(writtenCase.agreement, writtenCase.firstErrorPosition, 'disputed')} disputed`
      + `${writtenCase.noLabel.length > 0 ? `, ${count(writtenCase.agreement, writtenCase.firstErrorPosition, 'noLabel')} without a label by the list` : ''}${marks.length > 0 ? `, ${marks.join(', ')}` : ''}`)
  }
  const disputed = cases.filter(writtenCase => writtenCase.disputedFromFirstError)
  if (showDisputed) for (const writtenCase of disputed) console.log(`\n${describeOpinions(writtenCase)}`)
  const repaired = (wanted: number) => cases.filter(writtenCase => writtenCase.opinions.length - 1 === wanted).length
  for (const writtenCase of cases) for (const repair of writtenCase.leftOut) console.log(`Left out: the repair of ${writtenCase.id} in ${repair.name}, which ${repair.reason}`)
  const listed = cases.filter(writtenCase => writtenCase.noLabel.length > 0)
  if (listed.length > 0) {
    const total = (from: (writtenCase: WrittenCase) => number) => listed.reduce((sum, writtenCase) => sum + count(writtenCase.agreement, from(writtenCase), 'noLabel'), 0)
    console.log(`Without a label by no-label.txt: ${total(() => 0)} code points in ${listed.length} cases, ${total(writtenCase => writtenCase.firstErrorPosition)} of them from the first error on.`)
  }
  if (showKinds) {
    const tagged = cases.filter(writtenCase => writtenCase.damage !== undefined)
    const ofTheKinds = (some: readonly WrittenCase[]) => some.filter(writtenCase => writtenCase.damage!.other === undefined).length
    console.log(`\nBy kinds.txt, ${ofTheKinds(tagged)} of ${tagged.length} cases have damage of the generator's kinds alone, and ${tagged.length - ofTheKinds(tagged)} have damage that no kind makes. Per writer's file:`)
    for (const file of [...new Set(tagged.map(writtenCase => writtenCase.file))].sort()) {
      const ofFile = tagged.filter(writtenCase => writtenCase.file === file)
      console.log(`  ${String(ofTheKinds(ofFile)).padStart(4)} ${String(ofFile.length - ofTheKinds(ofFile)).padStart(4)}  ${file}`)
    }
    const casesOfKind = new Map<string, number>()
    for (const writtenCase of tagged) for (const kind of writtenCase.damage!.kinds) casesOfKind.set(kind, (casesOfKind.get(kind) ?? 0) + 1)
    console.log('The cases that each kind describes, and the kinds that describe none:')
    for (const [kind, total] of [...casesOfKind].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) console.log(`  ${String(total).padStart(4)}  ${kind}`)
    console.log(`  none: ${generatorKinds.map(kind => kind.name).filter(name => !casesOfKind.has(name)).join(', ')}`)
  }
  console.log(`${cases.length} cases: ${repaired(2)} with two repairs, ${repaired(1)} with one, ${repaired(0)} with none, ${cases.length - repaired(0) - repaired(1) - repaired(2)} with more. ${cases.length - disputed.length} with full agreement from the first error on, ${disputed.length} with a disputed code point there. ${problems.length} problems.`)
  if (problems.length > 0) process.exitCode = 1
}
