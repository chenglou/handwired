// The counts of the final scoring: what a parser has right in every row of a set, how many of the code points that
// the damage added it shows as an error, and whether it shows a text as today's parser does where the experiment's
// ground rules ask for that.
//
// The counting is the one of ../../learn/score.ts, of ../specific/score.ts and of ../written/score.ts: over the code
// points from the first error of the parser as it is on whose label has a scored value, a code point is right when
// every scored value is right, and a text is right as a whole when all of its counted code points are. run.ts holds
// each count of this file against the count of the set's own scorer.
import {displayKind} from '../../kinds.ts'
import {codePointsOf, createTrace, runRecoveryParserInto} from '../../learn/recovery-parser.ts'
import {type RecoveryTables, checkTables} from '../../learn/recovery-tables.ts'
import type {Parser, Shown} from '../parsers.ts'
import type {ScoredSet, ScoredText} from './sets.ts'

export type Counts = {
  // The row's name, e.g. "all" or "kind: colonForEquals".
  name: string
  // Texts in the row, and how many of them have no counted code point: nothing is left to recover in them.
  texts: number
  nothingToRecover: number
  // Counted code points, and those with every scored value right ("all three").
  scored: number
  right: number
  // Texts with something to recover in which every counted code point is right ("whole").
  whole: number
  // Per value: how many are scored, and how many of those are right.
  kindScored: number
  kindRight: number
  nestingScored: number
  depthRight: number
  containerRight: number
  // Code points that the damage added, anywhere in the text, and how many of them are shown as the display kind
  // `error`. An added code point has no label, so no other count sees how it is shown.
  added: number
  addedShownAsError: number
}

const noCounts = (name: string): Counts => ({name, texts: 0, nothingToRecover: 0, scored: 0, right: 0, whole: 0, kindScored: 0, kindRight: 0, nestingScored: 0, depthRight: 0, containerRight: 0, added: 0, addedShownAsError: 0})

// The counts of what `show` shows for one text, without a name.
export function countsOfText(text: ScoredText, shown: Shown): Omit<Counts, 'name' | 'texts'> {
  const counts = {nothingToRecover: 0, scored: 0, right: 0, whole: 0, kindScored: 0, kindRight: 0, nestingScored: 0, depthRight: 0, containerRight: 0, added: 0, addedShownAsError: 0}
  const from = text.firstErrorPosition === -1 ? text.labels.length : text.firstErrorPosition
  for (let position = 0; position < text.labels.length; position++) {
    if (text.added[position] === true) {
      counts.added++
      if (shown.displayKind[position] === displayKind.error) counts.addedShownAsError++
    }
    const label = text.labels[position]
    if (position < from || label === undefined || (label.kind === undefined && label.depth === undefined)) continue
    counts.scored++
    const kindRight = label.kind === undefined || label.kind === shown.displayKind[position]
    const depthRight = label.depth === undefined || label.depth === shown.depthAfter[position]
    const containerRight = label.container === undefined || label.container === shown.containerAfter[position]
    if (label.kind !== undefined) {
      counts.kindScored++
      if (kindRight) counts.kindRight++
    }
    if (label.depth !== undefined) {
      counts.nestingScored++
      if (depthRight) counts.depthRight++
      if (containerRight) counts.containerRight++
    }
    if (kindRight && depthRight && containerRight) counts.right++
  }
  if (counts.scored === 0) counts.nothingToRecover = 1
  else if (counts.right === counts.scored) counts.whole = 1
  return counts
}

// The counts of a parser in every row of a set, in the order of the set's rows. A row without a text is left out.
// With `rightPerText`, the number of right code points of every text is added to that list, in the order of the
// set's texts, so that two parsers can later be compared text by text without scoring again.
export function countsOf(parser: Parser, set: ScoredSet, rightPerText?: number[]): Counts[] {
  const rows = new Map<string, Counts>(set.rowNames.map(name => [name, noCounts(name)]))
  for (const text of set.texts) {
    const ofText = countsOfText(text, parser.show(text.broken))
    rightPerText?.push(ofText.right)
    for (const name of text.rows) {
      const row = rows.get(name)
      if (row === undefined) throw new Error(`the text ${text.id} is in the row ${JSON.stringify(name)}, which is not among the rows of its set`)
      row.texts++
      for (const field of ['nothingToRecover', 'scored', 'right', 'whole', 'kindScored', 'kindRight', 'nestingScored', 'depthRight', 'containerRight', 'added', 'addedShownAsError'] as const) row[field] += ofText[field]
    }
  }
  return [...rows.values()].filter(row => row.texts > 0)
}

// What a parser has right per display kind of the label, e.g. of the code points whose label is the name of a
// header: how many are scored, how many of them have every scored value right, and how many have the display kind
// right. The last entry counts the scored code points whose label has no scored display kind.
export type LabelKindCounts = {kind: string, scored: number, right: number, kindRight: number}
export const withoutScoredKind = 'the display kind is not scored'

// Those counts over the texts of one row of a set, e.g. "all". A kind without a scored code point is left out.
export function labelKindCountsOf(parser: Parser, set: ScoredSet, rowName: string): LabelKindCounts[] {
  const counts: LabelKindCounts[] = [...Object.keys(displayKind), withoutScoredKind].map(kind => ({kind, scored: 0, right: 0, kindRight: 0}))
  for (const text of set.texts) {
    if (!text.rows.includes(rowName) || text.firstErrorPosition === -1) continue
    const shown = parser.show(text.broken)
    for (let position = text.firstErrorPosition; position < text.labels.length; position++) {
      const label = text.labels[position]
      if (label === undefined || (label.kind === undefined && label.depth === undefined)) continue
      const of = counts[label.kind ?? counts.length - 1]!
      const kindRight = label.kind === undefined || label.kind === shown.displayKind[position]
      const nestingRight = (label.depth === undefined || label.depth === shown.depthAfter[position]) && (label.container === undefined || label.container === shown.containerAfter[position])
      of.scored++
      if (kindRight) of.kindRight++
      if (kindRight && nestingRight) of.right++
    }
  }
  return counts.filter(of => of.scored > 0)
}

// How many code points of every text of a set a score counts, in the order of the set's texts. It is the same for
// every parser.
export const scoredPerTextOf = (set: ScoredSet): number[] => set.texts.map(text => {
  let scored = 0
  for (let position = Math.max(0, text.firstErrorPosition === -1 ? text.labels.length : text.firstErrorPosition); position < text.labels.length; position++) {
    const label = text.labels[position]
    if (label !== undefined && (label.kind !== undefined || label.depth !== undefined)) scored++
  }
  return scored
})

// A row's shares in percent, and NaN where there is nothing to divide by: "all three" and "whole".
export function percentagesOf(row: Counts | undefined) {
  if (row === undefined) return {allThree: Number.NaN, whole: Number.NaN}
  return {allThree: 100 * row.right / row.scored, whole: 100 * row.whole / (row.texts - row.nothingToRecover)}
}

// A parser for tables of the recovery experiment that checks the ground rules once, when it is made, and not at
// every text as parserOfTables of ../parsers.ts does. It runs the same loop, over the positions of the text's code
// points. What `show` returns is overwritten by the parser's next call, so a caller reads it before it calls again.
export function parserOfCheckedTables(name: string, tables: RecoveryTables): Parser {
  checkTables(tables)
  const trace = createTrace()
  return {
    name,
    show: broken => {
      const {codePoints} = codePointsOf(broken)
      runRecoveryParserInto(trace, codePoints, 0, codePoints.length, false, tables, codePoints.length)
      return trace
    },
  }
}

// What the parser as it is shows where the experiment's ground rules ask every tables to show the same: at every code
// point of the valid documents of a set, and at the code points of its broken texts before their first error.
export type TodaysTraces = {
  documents: number
  validCodePoints: number
  brokenTexts: number
  beforeErrorCodePoints: number
  // Per text: the first `to` code points are held against what the parser as it is shows for them.
  entries: {text: string, to: number, isDocument: boolean, displayKind: Int16Array, depthAfter: Int16Array, containerAfter: Int8Array}[]
}

export function todaysTracesOf(asItIs: Parser, set: ScoredSet): TodaysTraces {
  const result: TodaysTraces = {documents: 0, validCodePoints: 0, brokenTexts: 0, beforeErrorCodePoints: 0, entries: []}
  const add = (text: string, to: number, isDocument: boolean) => {
    const shown = asItIs.show(text)
    result.entries.push({text, to, isDocument, displayKind: Int16Array.from(shown.displayKind.subarray(0, to)), depthAfter: Int16Array.from(shown.depthAfter.subarray(0, to)), containerAfter: Int8Array.from(shown.containerAfter.subarray(0, to))})
  }
  const seen = new Set<string>()
  for (const text of set.texts) {
    for (const document of text.documents) {
      if (seen.has(document)) continue
      seen.add(document)
      const length = Array.from(document).length
      result.documents++
      result.validCodePoints += length
      add(document, length, true)
    }
    const before = text.firstErrorPosition === -1 ? text.labels.length : text.firstErrorPosition
    result.brokenTexts++
    result.beforeErrorCodePoints += before
    add(text.broken, before, false)
  }
  return result
}

// At how many of those code points a parser shows another display kind, depth or container than the parser as it
// is: in the valid documents, and in the broken texts before their first error. Both are 0 for tables that keep the
// ground rules.
export function differencesFromToday(parser: Parser, todays: TodaysTraces): {validDifferences: number, beforeErrorDifferences: number} {
  const result = {validDifferences: 0, beforeErrorDifferences: 0}
  for (const entry of todays.entries) {
    const shown = parser.show(entry.text)
    let differences = 0
    for (let position = 0; position < entry.to; position++) {
      if (shown.displayKind[position] !== entry.displayKind[position] || shown.depthAfter[position] !== entry.depthAfter[position] || shown.containerAfter[position] !== entry.containerAfter[position]) differences++
    }
    if (entry.isDocument) result.validDifferences += differences
    else result.beforeErrorDifferences += differences
  }
  return result
}
