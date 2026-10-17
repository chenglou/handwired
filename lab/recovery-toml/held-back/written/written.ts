// The written set of broken TOML: broken payloads that agents wrote from what broken TOML looks like in real use, each
// with a repair that says what its author meant, and each repaired a second time by an agent who saw only the broken
// payload. This file reads the broken payloads and the repairs and gives, per case, what a score needs. README.md and
// REPAIR.md describe the set for those who write it.
//
// A repair is an aligned text, see format.ts: the repaired document, and for every code point of the broken payload
// its counterpart in that document, or that it is extra. A code point of the broken payload takes the label of its
// counterpart, i.e. the display kind, the depth and the container that reference.ts gives the counterpart in the
// repaired document. An extra code point has no label.
//
// Before the labels are taken, the alignment is put into one fixed form, see slideChanges: of two equal code points of
// which one is extra or missing, the later one is. So two repairers who mean the same repair mostly give the same
// labels, e.g. whichever of the two `=` of `a == 1` they mark as extra.
//
// The opinions about a case are the writer's repair and, when there is one, the second repair. They are held against
// each other per code point of the broken payload:
// - agreed: every opinion gives it a label, with the same display kind, depth and container. Only these are scored.
//   A value that an opinion's own reading leaves unscored, see unscoredOf, is no dispute with the other opinion.
// - extra: no opinion gives it a label.
// - disputed: anything else, e.g. one repair keeps a comma and the other marks it as extra. It is kept apart.
//
// kinds.txt holds a judgment per case of the set: which of the ten edits of the train data's damage make the case's
// damage, and whether the case has damage that no edit makes. neutral-edits.ts derives the lines, and README.md says
// how the line between the two is drawn, under "What the damage is".
//
// Run from the repo root: bun lab/recovery-toml/held-back/written/written.ts [--set <folder>] [--kinds]
// It prints one line per case and the counts of the set, and with --kinds what kinds.txt says: per writer's file the
// cases whose damage the edits make and the cases with damage that no edit makes, and per edit the cases that have it.
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {kinds as editKinds} from '../../damage.ts'
import {displayKind, errorKinds, maximumDepth} from '../../kinds.ts'
import {type ReferenceLabel, labelReference} from '../../reference.ts'
import {type ParserTrace, runTableParser} from '../../table-parser.ts'
import {type Aligned, type BrokenEntry, type RepairEntry, readBrokenFile, readRepairFile, sideOfPair} from './format.ts'

// The folder of this file, with the broken payloads in broken/, the writers' repairs in repairs/ and the second
// repairs in second-repairs/. examples/ in it is a small set of the same layout.
export const writtenFolder = import.meta.dir

// A broken payload has 40 to 480 code points, and a repaired document at most 480.
export const shortestBroken = 40
export const longestText = 480

// The label of a code point of a broken payload: the label of its counterpart in the repaired document. A value that
// is not scored is `undefined`, because no parser that reads one code point at a time can give it at that place, see
// unscoredOf. `depth` and `container` are scored together or not at all.
export type Label = {
  kind: number | undefined
  depth: number | undefined
  container: number | undefined
}

export type Opinion = {
  // 'writer' for the repair of the case's writer, 'second' for the second repair.
  name: 'writer' | 'second'
  // The repaired document of this opinion.
  text: string
  note: string | undefined
  // The other reading, when the repairer marked the repair as unsure.
  unsure: string | undefined
  // For each code point of the broken payload the index of its counterpart in `text`, or -1 for an extra one, and
  // whether it stands in the place of a counterpart that is another code point. Both are in the fixed form of
  // slideChanges.
  alignment: number[]
  replaced: boolean[]
  // The label of every code point of the broken payload by this opinion: its counterpart's, or undefined for an extra
  // code point and for what is left of a literal or a number with a slip in it, see labelsOfAlignment.
  labels: (ReferenceLabel | undefined)[]
}

export type Agreement = 'agreed' | 'extra' | 'disputed'

// What kinds.txt says about a case's damage: the edits of ../../damage.ts that make its damaged places, one name per
// place in text order, and in a few words the damage that no edit makes, when the case has such damage.
export type CaseDamage = {edits: string[], other: string | undefined}

export type WrittenCase = {
  id: string
  // The name of the writer's file in broken/, e.g. 'hand-edits.txt'.
  file: string
  // Where such a broken payload comes from, in the writer's words. Empty when the case is read with the second repair
  // alone, which has no such line.
  from: string
  broken: string
  // The repaired document of the first opinion, named as the valid document of a sample is named in the JSON
  // experiment, and that opinion's alignment and first damaged code point.
  original: string
  alignment: number[]
  replaced: boolean[]
  firstDamage: number
  // Where the parser as it is reports its first error in the broken payload, and the kind of that error.
  firstErrorPosition: number
  firstErrorKind: number
  // The writer's opinion first, then the second repair when there is one.
  opinions: Opinion[]
  // What kinds.txt says about the case, or undefined where the folder has no such file, e.g. the examples.
  damage: CaseDamage | undefined
  // Per code point of the broken payload.
  agreement: Agreement[]
  // Positions in the broken payload of agreed code points whose display kind is not scored, and of those whose depth
  // and container are not scored, see unscoredOf.
  unscoredKindPositions: number[]
  unscoredNestingPositions: number[]
  // Whether a code point from the first error of the parser as it is on is disputed. A case without one is a case
  // with full agreement.
  disputedFromFirstError: boolean
}

const codePointLength = (text: string) => Array.from(text).length

// What Bun's TOML parser says against a text, or undefined when it accepts the text.
function bunRejection(text: string): string | undefined {
  try {
    Bun.TOML.parse(text)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message.split('\n')[0]! : 'it throws'
  }
}

// What keeps a text from being a repaired document: it is valid TOML for the tables, for the reference and for Bun's
// parser, and it has at most 480 code points. The tables and the reference read TOML 1.0's syntax, and Bun's parser
// also rejects what they do not check, e.g. a key that is defined twice.
export function validTextProblems(text: string): string[] {
  const problems: string[] = []
  const length = codePointLength(text)
  if (length > longestText) problems.push(`it has ${length} code points, and a repaired document has at most ${longestText}`)
  const trace = runTableParser(text)
  const reference = labelReference(text)
  if (!trace.valid) problems.push(`it is not valid TOML for the table parser: ${errorKinds[trace.firstErrorKind]!} at code point ${trace.firstErrorPosition}`)
  if (!reference.valid) problems.push(`it is not valid TOML for the reference: ${reference.reason} at code point ${reference.position}`)
  const rejection = bunRejection(text)
  if (rejection !== undefined) problems.push(`it is not valid TOML for Bun's parser: ${rejection}`)
  if (trace.valid && reference.valid) {
    const differs = reference.labels.findIndex((label, position) => label.kind !== trace.displayKind[position] || label.depth !== trace.depthAfter[position] || label.container !== trace.containerAfter[position])
    if (differs !== -1) problems.push(`the table parser and the reference label code point ${differs} differently. That is an error of the parser's files and not of the text: tell the lead`)
  }
  return problems
}

// What keeps a text from being a broken payload: the table parser as it is rejects it, it has 40 to 480 code points,
// and the parser as it is counts at most 16 open brackets in it. E.g. an open string can hide closing brackets, and a
// bracket in the string's content then opens a 17th level.
export function brokenTextProblems(text: string): string[] {
  const problems: string[] = []
  const length = codePointLength(text)
  if (length < shortestBroken || length > longestText) problems.push(`it has ${length} code points, and a broken payload has ${shortestBroken} to ${longestText}`)
  const trace = runTableParser(text)
  const reference = labelReference(text)
  if (trace.valid && reference.valid) problems.push('it is valid TOML: the table parser accepts it, so it has no first error to recover from')
  else if (trace.valid !== reference.valid) problems.push('the table parser and the reference disagree on whether it is valid. That is an error of the parser\'s files and not of the text: tell the lead')
  for (let position = 0; position < trace.length; position++) {
    if (trace.depthAfter[position]! > maximumDepth) {
      problems.push(`the parser as it is counts more than ${maximumDepth} open brackets at code point ${position}`)
      break
    }
  }
  return problems
}

// Whether Bun's parser accepts a broken payload. It reads TOML 1.1, so it accepts four things that the tables reject:
// a line end or a comment inside an inline table, a comma before its `}`, a time without seconds, and the escapes \e
// and \xHH. It also takes a byte order mark at the start.
export const bunAccepts = (text: string) => bunRejection(text) === undefined

const quoteMarks = '"\'`´“”„‟‘’‚‛«»‹›＂＇′″'
const openingBrackets = '([{<（［｛〈《「【'
const closingBrackets = ')]}>）］｝〉》」】'
const isWhiteSpace = (character: string | undefined) => character !== undefined && /^[\t\n\r \p{Zs}\p{Zl}\p{Zp}]$/u.test(character)

// Whether a code point of a broken payload can stand in the place of a code point of the document. Only a few parts
// can: a quote mark for a quote, a bracket for a bracket of the same direction, a colon for the equals sign, a
// semicolon for a comma, and white space of any sort for a space, a tab or a line feed. Any other code point in
// another one's place is extra, and the one of the document is missing.
export function canStandFor(broken: string, repaired: string): boolean {
  if (repaired === '"' || repaired === '\'') return quoteMarks.includes(broken)
  if (repaired === '[' || repaired === '{') return openingBrackets.includes(broken)
  if (repaired === ']' || repaired === '}') return closingBrackets.includes(broken)
  if (repaired === '=') return ':＝：'.includes(broken)
  if (repaired === ',') return ';，；、'.includes(broken)
  if (repaired === ' ' || repaired === '\t' || repaired === '\n') return isWhiteSpace(broken)
  return false
}

// What an alignment makes of the damage: the runs of the broken payload that have no counterpart, and the runs of the
// repaired document that the broken payload lacks, each with the position in the broken payload where it stands or is
// missing. A missing run at the place of an extra run comes right after it, with the position of the extra run's end.
export type Change = {kind: 'extra' | 'missing', position: number, codePoints: string[]}
export function changeRunsOf(brokenText: string, repairedText: string, alignment: readonly number[]): Change[] {
  const broken = Array.from(brokenText)
  const repaired = Array.from(repairedText)
  const changes: Change[] = []
  // The next code point of the repaired document that has no counterpart yet.
  let expected = 0
  let extraFrom = -1
  const endExtra = (position: number) => {
    if (extraFrom !== -1) changes.push({kind: 'extra', position: extraFrom, codePoints: broken.slice(extraFrom, position)})
    extraFrom = -1
  }
  alignment.forEach((counterpart, position) => {
    if (counterpart === -1) {
      if (extraFrom === -1) extraFrom = position
      return
    }
    endExtra(position)
    if (counterpart > expected) changes.push({kind: 'missing', position, codePoints: repaired.slice(expected, counterpart)})
    expected = counterpart + 1
  })
  endExtra(broken.length)
  if (expected < repaired.length) changes.push({kind: 'missing', position: broken.length, codePoints: repaired.slice(expected)})
  return changes
}

// What in an alignment is against the rules of REPAIR.md, as far as the two texts show it.
export function alignmentProblems(aligned: Aligned): string[] {
  const problems: string[] = []
  const broken = Array.from(aligned.broken)
  const repaired = Array.from(aligned.repaired)
  aligned.alignment.forEach((counterpart, position) => {
    if (aligned.replaced[position] !== true || canStandFor(broken[position]!, repaired[counterpart]!)) return
    problems.push(`⟦${sideOfPair(broken[position]!)} for ${sideOfPair(repaired[counterpart]!)}⟧ at code point ${position}: such a code point does not stand for the other by the rules. Mark the one as extra and the other as missing`)
  })
  const changes = changeRunsOf(aligned.broken, aligned.repaired, aligned.alignment)
  changes.forEach((change, index) => {
    const after = changes[index + 1]
    if (change.kind !== 'extra' || after?.kind !== 'missing' || after.position !== change.position + change.codePoints.length) return
    const extra = change.codePoints.join('')
    const missing = after.codePoints.join('')
    if (extra === missing) problems.push(`${JSON.stringify(extra)} is extra and missing at code point ${change.position}. Text that both texts have at one place stands outside the marks`)
    else if (change.codePoints.length === 1 && after.codePoints.length === 1 && canStandFor(extra, missing)) problems.push(`${JSON.stringify(extra)} is extra and ${JSON.stringify(missing)} is missing at code point ${change.position}. By the rules the one stands for the other: write ⟦${sideOfPair(extra)} for ${sideOfPair(missing)}⟧`)
  })
  return problems
}

// Moves the code points of one text that have a counterpart to the left, onto equal code points that have none, until
// no move is left. `counterpart[index]` is the index of the code point's counterpart in the other text, or -1, and
// `canMove(index)` says whether a code point with a counterpart may move, which one that stands in the place of
// another may not. Two moves:
// - Over a whole run: the code points without a counterpart right before the code point form a run, and the run's
//   first code point is the same as the code point. The code point takes the place of the run's first one, e.g. the
//   indentation after a comment line that is extra moves to the indentation before the comment.
// - By one: the code point right before it has no counterpart and is the same, e.g. the second = of `a == 1`.
// Neither move lets a code point jump into the middle of a run, where an equal code point is there by chance, e.g. the
// k of `key` onto the k of an extra comment `# skip`.
function moveLeft(text: readonly string[], counterpart: number[], canMove: (index: number) => boolean, moved: (from: number, to: number) => void) {
  let changed = true
  while (changed) {
    changed = false
    for (let index = text.length - 1; index >= 1; index--) {
      if (counterpart[index] === -1 || counterpart[index - 1] !== -1 || !canMove(index)) continue
      let runStart = index - 1
      while (runStart > 0 && counterpart[runStart - 1] === -1) runStart--
      const to = text[runStart] === text[index] ? runStart : text[index - 1] === text[index] ? index - 1 : -1
      if (to === -1) continue
      counterpart[to] = counterpart[index]!
      counterpart[index] = -1
      moved(index, to)
      changed = true
    }
  }
}

// The alignment in one fixed form: of two equal code points of which one is extra, the later one is, and of two equal
// code points of the document of which one is missing, the later one is. See moveLeft for the two moves. The broken
// payload and the repaired document stay as they are, and so does the label that each kept code point of the document
// gives. What changes is which of two equal code points has the label, e.g. for a comment line that is extra: its
// indentation keeps the label, and the indentation of the line after it is extra.
//
// Two repairers who mean the same repair mostly get the same form, and not always: the first move depends on where
// the run before a code point starts, which another move can change. compare.ts shows what is left.
export function slideChanges(aligned: Aligned): Pick<Aligned, 'alignment' | 'replaced'> {
  const broken = Array.from(aligned.broken)
  const repaired = Array.from(aligned.repaired)
  const alignment = [...aligned.alignment]
  const replaced = [...aligned.replaced]
  // The kept code points of the broken payload move onto extra ones.
  moveLeft(broken, alignment, position => replaced[position] !== true, () => {})
  // The code points of the repaired document that the broken payload has move onto missing ones.
  const positionOf = new Array<number>(repaired.length).fill(-1)
  alignment.forEach((counterpart, position) => { if (counterpart !== -1) positionOf[counterpart] = position })
  moveLeft(repaired, positionOf, index => replaced[positionOf[index]!] !== true, (_from, to) => { alignment[positionOf[to]!] = to })
  return {alignment, replaced}
}

// A code point that can be a part of a word such as `True` or `1O0`: any but white space, the punctuation that ends a
// value in TOML, a quote mark and a round bracket.
const canBePartOfWord = (character: string | undefined) => character !== undefined && !isWhiteSpace(character) && !'=,[]{}#()'.includes(character) && !quoteMarks.includes(character)

// The label of every code point of a broken payload by an alignment: the label of its counterpart, and undefined for
// an extra code point.
//
// A literal or a number with a slip in it has no label either, as in the JSON experiment: the highlighter has nothing
// to show a word as that is no literal and no number. It is such a word when the literal or number of the repaired
// document lacks a code point in the broken payload and an extra code point that can be a part of a word stands right
// against what is left of it or inside it, e.g. `True` for `true`, `ture` for `true` and `1O0` for `100`. So the
// labels are the same whether a repairer marks `True` as extra as a whole or only its `T`. A literal or number that
// only lost code points keeps its labels, e.g. `tru`, and so does one with text added to it, e.g. `1,000` and `30s`.
function labelsOfAlignment(broken: readonly string[], repairedLabels: readonly ReferenceLabel[], alignment: readonly number[], replaced: readonly boolean[]): (ReferenceLabel | undefined)[] {
  const labels: (ReferenceLabel | undefined)[] = alignment.map(counterpart => counterpart === -1 ? undefined : repairedLabels[counterpart]!)
  const isWordKind = (index: number) => repairedLabels[index]?.kind === displayKind.number || repairedLabels[index]?.kind === displayKind.literal
  const positionOf = new Array<number>(repairedLabels.length).fill(-1)
  alignment.forEach((counterpart, position) => { if (counterpart !== -1) positionOf[counterpart] = position })
  for (let from = 0; from < repairedLabels.length; from++) {
    if (!isWordKind(from)) continue
    let to = from
    while (isWordKind(to)) to++
    const positions = positionOf.slice(from, to).filter(position => position !== -1)
    const lostCodePoint = positions.length < to - from || positions.some(position => replaced[position] === true)
    if (positions.length > 0 && lostCodePoint) {
      let slipped = false
      for (let position = positions[0]! - 1; position <= positions.at(-1)! + 1; position++) {
        if (position >= 0 && alignment[position] === -1 && canBePartOfWord(broken[position])) slipped = true
      }
      if (slipped) for (const position of positions) labels[position] = undefined
    }
    from = to - 1
  }
  return labels
}

// One opinion about a broken payload, from a repair. Throws when the repaired document is not valid, see
// validTextProblems.
export function opinionOf(name: Opinion['name'], repair: Pick<RepairEntry, 'aligned' | 'note' | 'unsure'>): Opinion {
  const reference = labelReference(repair.aligned.repaired)
  if (!reference.valid) throw new Error(`the repaired document is not valid: ${reference.reason} at code point ${reference.position}`)
  const {alignment, replaced} = slideChanges(repair.aligned)
  return {name, text: repair.aligned.repaired, note: repair.note, unsure: repair.unsure, alignment, replaced, labels: labelsOfAlignment(Array.from(repair.aligned.broken), reference.labels, alignment, replaced)}
}

// The index in the broken payload of the first damaged code point by an alignment: the first that is extra or stands
// in the place of another, the first kept one after a missing part, or the broken payload's length when only the
// document's end is missing.
function firstDamageOf(alignment: readonly number[], replaced: readonly boolean[], repairedLength: number) {
  for (let position = 0; position < alignment.length; position++) {
    if (alignment[position] !== position || replaced[position] === true) return position
  }
  return alignment.length < repairedLength ? alignment.length : -1
}

// How many code points from `position` on the parser as it is shows as a number or a literal when a value starts
// there, e.g. 3 for the `1.2` of `1.2.3`, 4 for the `true` of `true-color`, 3 for the `inf` of `info`, and 0 for
// `db.internal`. The rest of the line is read after `k = `, by the tables as they are.
export function readsAsNumberOrLiteral(broken: readonly string[], position: number): number {
  let lineEnd = position
  while (lineEnd < broken.length && broken[lineEnd] !== '\n' && broken[lineEnd] !== '\r') lineEnd++
  const start = 'k = '
  const trace = runTableParser(`${start}${broken.slice(position, lineEnd).join('')}`)
  let count = 0
  while (position + count < lineEnd) {
    const index = start.length + count
    if (trace.firstErrorPosition !== -1 && index >= trace.firstErrorPosition) break
    if (trace.displayKind[index] !== displayKind.number && trace.displayKind[index] !== displayKind.literal) break
    count++
  }
  return count
}

// The values of an opinion's labels that are not scored, as positions in the broken payload. These are the rules of
// the JSON experiment that the two texts show without a kind of damage:
// - A string value that lost its opening quote and stands after white space or punctuation: the display kind of the
//   code points at its start that read as a number or a literal, e.g. the `1.2` of `version = 1.2.3` for
//   `version = "1.2.3"`. A parser that reads one code point at a time shows them as a number before the second dot
//   says that the value is none.
// - Where the depth or the container changes at a code point that is not a bracket, a bracket is missing before it:
//   the depth and the container from there to the next kept bracket, since nothing in the broken payload shows that
//   a container started or ended. A bracket is a `[`, `]`, `{` or `}` that is punctuation, also the one of a header.
// - The rest of an escape whose backslash the broken payload lacks, e.g. the inner quotes of `"say "hi" now"`: its
//   label says escape, and no reading of the broken payload shows that.
// - What reads as an escape after a backslash that lost its second half, e.g. the t of `"C:\temp"` for `"C:\\temp"`,
//   the U of `"C:\Users"`, and a closing quote with the comma after it: the labels say string and punctuation, and
//   every reader shows an escape and goes on with the string.
// A score counts code points from the first error of the parser as it is on, so no rule is needed for the code points
// before it.
function unscoredOf(opinion: Opinion, broken: readonly string[]) {
  const repaired = Array.from(opinion.text)
  const reference = labelReference(opinion.text)
  const repairedLabels = reference.valid ? reference.labels : []
  const {alignment, labels} = opinion
  const kinds = new Set<number>()
  const nesting = new Set<number>()
  const kept = new Set(alignment)
  for (let position = 0; position < alignment.length; position++) {
    const index = alignment[position]!
    if (index <= 0 || labels[position] === undefined || repairedLabels[index]!.kind !== displayKind.string) continue
    // The code point before it in the repaired document is the value's opening quote, which the broken payload lacks.
    const before = repaired[index - 1]
    if ((before !== '"' && before !== '\'') || repairedLabels[index - 1]!.kind !== displayKind.string || kept.has(index - 1)) continue
    if (position > 0) {
      const labelBefore = labels[position - 1]
      if (labelBefore === undefined ? !' \t\r\n{}[]=,'.includes(broken[position - 1]!) : kinds.has(position - 1) || (labelBefore.kind !== displayKind.whitespace && labelBefore.kind !== displayKind.punctuation)) continue
    }
    const run = readsAsNumberOrLiteral(broken, position)
    for (let offset = 0; offset < run && alignment[position + offset] === index + offset && repairedLabels[index + offset]!.kind === displayKind.string; offset++) kinds.add(position + offset)
  }
  const positionOf = new Array<number>(repaired.length).fill(-1)
  alignment.forEach((counterpart, position) => { if (counterpart !== -1) positionOf[counterpart] = position })
  const isHexDigit = (character: string | undefined) => character !== undefined && /^[0-9a-fA-F]$/.test(character)
  for (let index = 0; index < repaired.length; index++) {
    if (repaired[index] !== '\\' || repairedLabels[index]!.kind !== displayKind.escape) continue
    // The code points of the escape: \uXXXX, \UXXXXXXXX, a backslash with one character, or in a string of several
    // lines a backslash with the white space up to the line's end.
    const second = repaired[index + 1]
    let length = second === 'u' ? 6 : second === 'U' ? 10 : 2
    if (second === ' ' || second === '\t' || second === '\n' || second === '\r') {
      length = 1
      while (repaired[index + length] === ' ' || repaired[index + length] === '\t') length++
    }
    if (positionOf[index] === -1) {
      for (let rest = index + 1; rest < index + length; rest++) if (positionOf[rest] !== -1) kinds.add(positionOf[rest]!)
    } else if (second === '\\' && positionOf[index + 1] === -1) {
      const after = positionOf[index]! + 1
      const next = broken[after]
      if (next !== undefined && 'btnfr"'.includes(next)) kinds.add(after)
      // After a quote that reads as escaped, the string goes on, and a comma is its content.
      if (next === '"' && broken[after + 1] === ',') kinds.add(after + 1)
      else if (next === 'u' || next === 'U') {
        const digits = next === 'u' ? 4 : 8
        for (let digit = after; digit <= after + digits && (digit === after || isHexDigit(broken[digit])); digit++) kinds.add(digit)
      }
    }
    index += length - 1
  }
  let depthBefore = 0
  let containerBefore = 0
  let afterMissingBracket = false
  for (let position = 0; position < alignment.length; position++) {
    const label = labels[position]
    if (label === undefined) continue
    const isBracket = label.kind === displayKind.punctuation && '{}[]'.includes(repaired[alignment[position]!]!)
    if (isBracket) afterMissingBracket = false
    else if (label.depth !== depthBefore || label.container !== containerBefore) afterMissingBracket = true
    if (afterMissingBracket) nesting.add(position)
    depthBefore = label.depth
    containerBefore = label.container
  }
  return {kinds, nesting}
}

// A repair with the name of its opinion.
export type NamedRepair = {name: Opinion['name'], repair: Pick<RepairEntry, 'aligned' | 'from' | 'note' | 'unsure'>}

// What keeps a repair from being a repair of a broken payload: its aligned text gives that broken payload, its
// repaired document is valid, and its alignment follows the rules that the two texts show.
export function repairProblems(repair: Pick<RepairEntry, 'aligned'>, broken: string): string[] {
  const problems: string[] = []
  if (repair.aligned.broken !== broken) {
    const given = Array.from(repair.aligned.broken)
    const wanted = Array.from(broken)
    let differs = 0
    while (differs < given.length && differs < wanted.length && given[differs] === wanted[differs]) differs++
    const line = wanted.slice(0, differs).filter(character => character === '\n').length + 1
    const shown = (codePoints: readonly string[]) => differs >= codePoints.length ? 'its end' : JSON.stringify(codePoints.slice(differs, differs + 20).join(''))
    problems.push(`the aligned text does not give the broken payload. Without the marks ⟦missing⟧…⟦/⟧ and with the first side of every ⟦… for …⟧ it must be the broken payload, code point for code point. The two first differ at code point ${differs}, on line ${line} of the broken payload: the broken payload has ${shown(wanted)} there and the aligned text gives ${shown(given)}`)
  }
  problems.push(...validTextProblems(repair.aligned.repaired).map(problem => `the repaired document: ${problem}`))
  problems.push(...alignmentProblems(repair.aligned))
  return problems
}

// A case with its opinions and their agreement. With one opinion every code point is agreed or extra. `damage` is what
// kinds.txt says about the case. Throws when a text is not what brokenTextProblems and repairProblems ask for.
export function caseOf(texts: Pick<BrokenEntry, 'id' | 'broken'>, file: string, repairs: readonly NamedRepair[], damage?: CaseDamage): WrittenCase {
  const problems = [...brokenTextProblems(texts.broken).map(problem => `the broken payload: ${problem}`), ...repairs.flatMap(({name, repair}) => repairProblems(repair, texts.broken).map(problem => `${name}: ${problem}`))]
  if (repairs.length === 0) problems.push('a case needs a repair')
  if (problems.length > 0) throw new Error(`${texts.id}: ${problems.join('; ')}`)
  const broken = Array.from(texts.broken)
  const trace: ParserTrace = runTableParser(texts.broken)
  const opinions = repairs.map(({name, repair}) => opinionOf(name, repair))
  const first = opinions[0]!
  // A value is not scored when the rules say so for any of the opinions, and such an opinion says nothing about the
  // value: the opinions agree on a code point when those that score its display kind give the same one, and those
  // that score its depth and container give the same two.
  const unscored = opinions.map(opinion => unscoredOf(opinion, broken))
  const agreement = broken.map((_, position): Agreement => {
    if (opinions.every(opinion => opinion.labels[position] === undefined)) return 'extra'
    if (opinions.some(opinion => opinion.labels[position] === undefined)) return 'disputed'
    const labelsThatScore = (pick: (sets: typeof unscored[number]) => Set<number>) => opinions.flatMap((opinion, index) => pick(unscored[index]!).has(position) ? [] : [opinion.labels[position]!])
    const kinds = labelsThatScore(sets => sets.kinds)
    const nestings = labelsThatScore(sets => sets.nesting)
    return kinds.every(label => label.kind === kinds[0]!.kind) && nestings.every(label => label.depth === nestings[0]!.depth && label.container === nestings[0]!.container) ? 'agreed' : 'disputed'
  })
  const positionsOf = (pick: (sets: typeof unscored[number]) => Set<number>) =>
    broken.flatMap((_, position) => agreement[position] === 'agreed' && unscored.some(sets => pick(sets).has(position)) ? [position] : [])
  return {
    id: texts.id, file, from: repairs[0]!.repair.from ?? '', broken: texts.broken,
    original: first.text, alignment: first.alignment, replaced: first.replaced, firstDamage: firstDamageOf(first.alignment, first.replaced, codePointLength(first.text)),
    firstErrorPosition: trace.firstErrorPosition, firstErrorKind: trace.firstErrorKind,
    opinions, damage, agreement, unscoredKindPositions: positionsOf(sets => sets.kinds), unscoredNestingPositions: positionsOf(sets => sets.nesting),
    disputedFromFirstError: agreement.some((state, position) => state === 'disputed' && position >= trace.firstErrorPosition),
  }
}

// One entry per code point of the broken payload: the label that the opinions give, with `undefined` for a value that
// is not scored by the reading of any of them, see Label. The entry is undefined for a code point that no opinion
// gives a label, and also for a disputed one, which no score counts: `agreement` tells the two apart.
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

// How many code points a score counts: those from the first error of the parser as it is on that have a label with a
// scored value.
export function scoredCodePointsOfWritten(writtenCase: WrittenCase, labels: readonly (Label | undefined)[] = labelsOfWritten(writtenCase)) {
  let count = 0
  for (let position = writtenCase.firstErrorPosition; position < labels.length; position++) {
    const label = labels[position]
    if (label !== undefined && (label.kind !== undefined || label.depth !== undefined)) count++
  }
  return count
}

const textFilesOf = (folder: string) => existsSync(folder) ? readdirSync(folder).filter(name => name.endsWith('.txt')).sort() : []

// What kinds.txt of a folder says, per id of a case, and what is wrong with its lines. A line is the id of a case, the
// names of the edits that make its damaged places, each after a space, and for a case with damage that no edit makes
// " new: " and that damage in a few words. An empty line says nothing, and neither does a line that starts with #,
// which explains the file to its reader.
function readKinds(folder: string): {damageOf: Map<string, CaseDamage>, problems: string[]} {
  const damageOf = new Map<string, CaseDamage>()
  const problems: string[] = []
  const file = join(folder, 'kinds.txt')
  if (!existsSync(file)) return {damageOf, problems}
  const editNames = new Set(editKinds.map(kind => kind.name))
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    if (line.trim() === '' || line.startsWith('#')) return
    const where = `kinds.txt, line ${index + 1}`
    const [, id, names, other] = /^(\S+)((?: [A-Za-z]+)*)(?: new: (\S.*))?$/.exec(line) ?? []
    if (id === undefined || names === undefined) {
      problems.push(`${where}: a line is the id of a case, the names of the edits that make its damage, each after a space, and where the case has damage that no edit makes, " new: " and that damage in a few words, and this line is not: ${line}`)
      return
    }
    const edits = names.split(' ').filter(name => name !== '')
    const found = [
      ...edits.filter(name => !editNames.has(name)).map(name => `${name} is no edit of lab/recovery-toml/damage.ts`),
      ...(edits.length === 0 && other === undefined ? ['the line names no edit and no damage that no edit makes'] : []),
      ...(damageOf.has(id) ? ['the case has a line before this one'] : []),
    ]
    problems.push(...found.map(problem => `${where}: ${problem}`))
    if (found.length === 0) damageOf.set(id, {edits, other})
  })
  return {damageOf, problems}
}

export type ReadOptions = {
  // The name of one writer's file without its ending, e.g. 'hand-edits': only broken/hand-edits.txt and its repairs
  // are read.
  only?: string
  // Which repairs are the opinions of a case: both, which is the default, the writer's repair alone, or the second
  // repair alone, for a second repairer, who has no folder repairs/.
  opinions?: 'both' | 'writer' | 'second'
}

// Every case of broken/ with its repair of repairs/ and, when there is one, its second repair of second-repairs/,
// and what is wrong with the files. A repair of a case stands in the file with the name of the case's file, e.g. the
// repairs of broken/hand-edits.txt in repairs/hand-edits.txt. A case with a problem, in its broken payload or in one of
// its repairs, is left out, and `leftOut` has its id. So the problems must be empty before the cases are used for a
// result. Where the folder has a kinds.txt and all of its files are read, every case has one line in it.
export function readWritten(folder: string = writtenFolder, options: ReadOptions = {}): {cases: WrittenCase[], problems: string[], leftOut: string[]} {
  const problems: string[] = []
  const cases: WrittenCase[] = []
  const leftOut: string[] = []
  const wanted = (name: string) => options.only === undefined || name === `${options.only}.txt`
  const brokenFiles = textFilesOf(join(folder, 'broken')).filter(wanted)
  if (options.only !== undefined && brokenFiles.length === 0) problems.push(`broken/${options.only}.txt: there is no such file in ${folder}`)
  const fileOfId = new Map<string, string>()
  const idOfBroken = new Map<string, string>()
  const opinions = options.opinions ?? 'both'
  const firstFolder = opinions === 'second' ? 'second-repairs' : 'repairs'
  const kinds = readKinds(folder)
  problems.push(...kinds.problems)
  const readRepairs = (subfolder: 'repairs' | 'second-repairs', file: string) => {
    const path = join(folder, subfolder, file)
    const repairs = new Map<string, RepairEntry>()
    if (!existsSync(path)) return undefined
    const read = readRepairFile(readFileSync(path, 'utf8'), subfolder === 'repairs' ? 'writer' : 'second')
    problems.push(...read.problems.map(problem => `${subfolder}/${file}: ${problem}`))
    for (const repair of read.items) repairs.set(repair.id, repair)
    return repairs
  }
  for (const file of brokenFiles) {
    const read = readBrokenFile(readFileSync(join(folder, 'broken', file), 'utf8'))
    problems.push(...read.problems.map(problem => `broken/${file}: ${problem}`))
    const writerRepairs = opinions === 'second' ? undefined : readRepairs('repairs', file)
    const secondRepairs = opinions === 'writer' ? undefined : readRepairs('second-repairs', file)
    const firstRepairs = opinions === 'second' ? secondRepairs : writerRepairs
    if (firstRepairs === undefined) problems.push(`${firstFolder}/${file}: the file is missing, which holds the repairs of broken/${file}`)
    const ids = new Set(read.items.map(texts => texts.id))
    for (const [subfolder, repairs] of [['repairs', writerRepairs], ['second-repairs', secondRepairs]] as const) {
      for (const id of repairs?.keys() ?? []) if (!ids.has(id)) problems.push(`${subfolder}/${file}: repair ${id}: broken/${file} has no broken payload with this id`)
    }
    for (const texts of read.items) {
      const where = `broken/${file}: case ${texts.id}`
      const found = brokenTextProblems(texts.broken).map(problem => `the broken payload: ${problem}`)
      if (!texts.id.startsWith(`${file.replace(/\.txt$/, '')}-`)) found.push(`the id starts with the file's name and a hyphen, e.g. ${file.replace(/\.txt$/, '')}-01, so that no two files have the same id`)
      if (fileOfId.has(texts.id)) found.push(`the id is also in broken/${fileOfId.get(texts.id)!}`)
      if (idOfBroken.has(texts.broken)) found.push(`the broken payload is also the broken payload of the case ${idOfBroken.get(texts.broken)!}`)
      const named: NamedRepair[] = []
      const firstRepair = firstRepairs?.get(texts.id)
      if (firstRepairs !== undefined && firstRepair === undefined) found.push(`${firstFolder}/${file} has no repair with this id`)
      const secondRepair = opinions === 'both' ? secondRepairs?.get(texts.id) : undefined
      for (const [name, repair] of [[opinions === 'second' ? 'second' : 'writer', firstRepair], ['second', secondRepair]] as const) {
        if (repair === undefined) continue
        const repairFound = repairProblems(repair, texts.broken)
        found.push(...repairFound.map(problem => `the repair of ${name === 'writer' ? 'repairs' : 'second-repairs'}/${file}: ${problem}`))
        if (repairFound.length === 0) named.push({name, repair})
      }
      problems.push(...found.map(problem => `${where}: ${problem}`))
      if (found.length > 0 || named.length === 0) {
        leftOut.push(texts.id)
        continue
      }
      fileOfId.set(texts.id, file)
      idOfBroken.set(texts.broken, texts.id)
      cases.push(caseOf(texts, file, named, kinds.damageOf.get(texts.id)))
    }
  }
  if (options.only === undefined && existsSync(join(folder, 'kinds.txt'))) {
    for (const id of fileOfId.keys()) if (!kinds.damageOf.has(id)) problems.push(`kinds.txt: the case ${id} has no line`)
    for (const id of kinds.damageOf.keys()) if (!fileOfId.has(id) && !leftOut.includes(id)) problems.push(`kinds.txt: no case has the id ${id}`)
  }
  return {cases, problems, leftOut}
}

// The folder that `--set <folder>` names among the arguments of a command, or the folder of the set.
export function setFolderOf(commandArguments: readonly string[]): string {
  const index = commandArguments.indexOf('--set')
  if (index === -1) return writtenFolder
  const folder = commandArguments[index + 1]
  if (folder === undefined) throw new Error('--set needs a folder, e.g. --set lab/recovery-toml/held-back/written/examples')
  return folder
}

// The arguments of a command that are no option: without the words that start with -- and without the folder of --set.
export const namesOf = (commandArguments: readonly string[]) => commandArguments.filter((argument, index) => !argument.startsWith('--') && commandArguments[index - 1] !== '--set')

if (import.meta.main) {
  const folder = setFolderOf(process.argv.slice(2))
  const {cases, problems} = readWritten(folder)
  for (const problem of problems) console.log(`problem: ${problem}`)
  const count = (states: readonly Agreement[], from: number, wanted: Agreement) => states.reduce((total, state, position) => total + Number(position >= from && state === wanted), 0)
  console.log('Per case: the writer\'s file and id, the repairs, where the parser as it is has its first error, and from that code point on the')
  console.log('scored code points, the code points without a label by every opinion, and the disputed ones.')
  for (const writtenCase of cases) {
    const marks = writtenCase.opinions.filter(opinion => opinion.unsure !== undefined).map(opinion => `${opinion.name} is unsure`)
    console.log(`  ${writtenCase.file} ${writtenCase.id}: ${writtenCase.opinions.length} repair${writtenCase.opinions.length === 1 ? '' : 's'}, first error at ${writtenCase.firstErrorPosition} of ${writtenCase.agreement.length} (${errorKinds[writtenCase.firstErrorKind]!}), `
      + `${scoredCodePointsOfWritten(writtenCase)} scored, ${count(writtenCase.agreement, writtenCase.firstErrorPosition, 'extra')} without a label, ${count(writtenCase.agreement, writtenCase.firstErrorPosition, 'disputed')} disputed${marks.length > 0 ? `, ${marks.join(', ')}` : ''}`)
  }
  const disputed = cases.filter(writtenCase => writtenCase.disputedFromFirstError)
  const twice = cases.filter(writtenCase => writtenCase.opinions.length === 2).length
  if (process.argv.includes('--kinds')) {
    const listed = cases.filter(writtenCase => writtenCase.damage !== undefined)
    const fromEdits = (some: readonly WrittenCase[]) => some.filter(writtenCase => writtenCase.damage!.other === undefined)
    console.log(`\nBy kinds.txt, one to three edits of the train data's damage make the damage of ${fromEdits(listed).length} of ${listed.length} cases, and ${listed.length - fromEdits(listed).length} have other damage. Per writer's file:`)
    for (const file of [...new Set(listed.map(writtenCase => writtenCase.file))].sort()) {
      const ofFile = listed.filter(writtenCase => writtenCase.file === file)
      console.log(`  ${String(fromEdits(ofFile).length).padStart(4)} ${String(ofFile.length - fromEdits(ofFile).length).padStart(4)}  ${file}`)
    }
    const casesOfEdit = new Map<string, number>()
    for (const writtenCase of fromEdits(listed)) for (const edit of new Set(writtenCase.damage!.edits)) casesOfEdit.set(edit, (casesOfEdit.get(edit) ?? 0) + 1)
    console.log('Of the cases whose damage one to three edits make, the cases that have each edit, and the edits that none has:')
    for (const [edit, total] of [...casesOfEdit].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) console.log(`  ${String(total).padStart(4)}  ${edit}`)
    console.log(`  none: ${editKinds.map(kind => kind.name).filter(name => !casesOfEdit.has(name)).join(', ')}`)
  }
  console.log(`${cases.length} cases: ${twice} with two repairs, ${cases.length - twice} with one. ${cases.length - disputed.length} with full agreement from the first error on, ${disputed.length} with a disputed code point there. ${problems.length} problems.`)
  if (problems.length > 0) process.exitCode = 1
}
