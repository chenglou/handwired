// What the loop of table-parser.ts can give for a broken text when only the cells that valid TOML never reads may
// change: which cells those are, a check of other tables against that condition, and one bound, on the depth.
//
// lab/recovery-parser/limits.ts proves two things per sample for the plain JSON parser: its depth follows the
// tokenizer's events, and its display table shows an event as one kind in every grammar state, so a cell that valid
// JSON reads can fix a wrong depth or a wrong display kind for good. The TOML parser as it is has a stack action per
// grammar cell and a display entry per event and grammar state, and much less follows from the same condition:
//
// - Up to its first error, a text is read as now, by cells that valid TOML reads.
// - The step of the first error reads a grammar cell that no valid text reads, since no valid text enters the state
//   `error`. So that cell may hold any state and any stack action, also a state that the tables added. Every cell of an
//   added state is free, and so is every display entry of one. So from the first error on, each code point can be shown
//   as any kind, and can push, pop or leave the stack.
// - What is left is the loop's own limit: the depth moves by one level per code point at most.
//
// So `limitsOf` and `mostRightOf` follow the depth alone, from the depth that the parser as it is has before its first
// error. They prove that a sample's scored depths cannot all be right, e.g. when the damage removed two opening
// brackets before a kept one. They do not prove that a sample can be labeled: they do not ask that one table gives the
// same answer wherever it reads the same cell, and they take every display kind and every container's kind for right.
// The bound is loose, and stats.ts prints how rarely it is below all of a sample's scored code points.
import {cellsThatValidTextsRead} from './check-cells.ts'
import type {Label} from './labels.ts'
import {type ParserTables, defaultTables, eventNames, grammarCellName, grammarStateNames, lexerCellName, runTableParser} from './table-parser.ts'

const tables = defaultTables

// The cells that some valid TOML text reads, 1 per cell: `tokenizer` by tokenizer state × classCount + class, `grammar`
// by grammar state × symbolCount + token × contextCount + context, and `display` by event × grammarStateCount +
// grammar state after. They are also the cells that a text can read before its first error. The search is the exact
// one of check-cells.ts.
export function cellsThatValidTomlReads() {
  const {lexerRead, grammarRead, displayRead} = cellsThatValidTextsRead()
  return {tokenizer: lexerRead, grammar: grammarRead, display: displayRead}
}
const readByValidToml = cellsThatValidTomlReads()

// What keeps some tables from reading valid TOML as the default tables do, as sentences, or an empty list: a changed
// cell or display entry that a valid text reads, or a changed table that every step reads, e.g. the character
// classes. The tables may have more tokenizer states and more grammar states than the default ones. An arm that
// splits a character class or adds a token gets a sentence here, and has to show in its own way that it reads valid
// TOML as before.
export function conditionProblems(candidate: ParserTables): string[] {
  const problems: string[] = []
  if (candidate.classCount !== tables.classCount || candidate.symbolCount !== tables.symbolCount || candidate.eventCount !== tables.eventCount || candidate.contextCount !== tables.contextCount) {
    return ['the tables have another number of classes, tokens, contexts or events']
  }
  for (let cell = 0; cell < tables.lexerEvent.length; cell++) {
    if (readByValidToml.tokenizer[cell] === 1 && (candidate.lexerEvent[cell] !== tables.lexerEvent[cell] || candidate.lexerNext[cell] !== tables.lexerNext[cell])) problems.push(`the tokenizer's cell ${lexerCellName(cell)} is read by valid TOML and is changed`)
  }
  for (let cell = 0; cell < tables.grammarNext.length; cell++) {
    if (readByValidToml.grammar[cell] !== 1) continue
    if (candidate.grammarNext[cell] !== tables.grammarNext[cell] || candidate.grammarAction[cell] !== tables.grammarAction[cell]) problems.push(`the grammar's cell ${grammarCellName(cell)} is read by valid TOML and is changed`)
  }
  for (let entry = 0; entry < tables.display.length; entry++) {
    if (readByValidToml.display[entry] !== 1) continue
    const event = Math.floor(entry / tables.grammarStateCount)
    const state = entry % tables.grammarStateCount
    if (candidate.display[event * candidate.grammarStateCount + state] !== tables.display[entry]) problems.push(`the display entry (${eventNames[event]}, ${grammarStateNames[state]}) is read by valid TOML and is changed`)
  }
  const same = (left: readonly number[], right: readonly number[]) => left.length === right.length && left.every((value, index) => value === right[index])
  const fixed: [name: string, key: 'classOfCodePoint' | 'grammarToken' | 'depthClass' | 'actionOfToken'][] = [
    ['the character classes', 'classOfCodePoint'], ['the tokens of the events', 'grammarToken'], ['the classes of the depth', 'depthClass'], ['the stack actions of the tokens', 'actionOfToken'],
  ]
  for (const [name, key] of fixed) if (!same(candidate[key], tables[key])) problems.push(`${name} are changed`)
  if (candidate.errorState !== tables.errorState) problems.push('the error state is another one')
  return problems
}

// The most code points of a text, of those that a score counts and whose depth is scored, that one run of the loop
// can have at the right depth. A run is its depth after each code point. Up to the first error it is the run of the
// parser as it is, and from there on the depth moves by one level per code point at most. With `everyOne` the search
// stops at the first code point at which no run has every scored depth so far right: `stoppedAt` is that position.
function bestRun(broken: readonly string[], labels: readonly (Label | undefined)[], firstErrorPosition: number, everyOne: boolean): {wrong: number, stoppedAt: number} {
  const length = broken.length
  const start = Math.max(0, Math.min(firstErrorPosition, length))
  const depthBefore = start === 0 ? 0 : runTableParser(broken.join('')).depthAfter[start - 1]!
  const scoredDepth = (position: number) => labels[position]?.depth ?? -1
  // A depth outside the labels' depths and the depth at the first error is never better than the nearest depth inside.
  let lowest = Math.min(depthBefore, 0)
  let highest = depthBefore
  for (let position = start; position < length; position++) highest = Math.max(highest, scoredDepth(position))
  const span = highest - lowest + 1
  // Per depth: the fewest scored depths that a run ending at this depth has wrong, or -1 when no run ends there.
  let fewestWrong = new Int32Array(span).fill(-1)
  fewestWrong[depthBefore - lowest] = 0
  for (let position = start; position < length; position++) {
    const next = new Int32Array(span).fill(-1)
    const wanted = scoredDepth(position)
    let any = false
    for (let index = 0; index < span; index++) {
      const soFar = fewestWrong[index]!
      if (soFar === -1) continue
      for (let change = -1; change <= 1; change++) {
        const after = index + change
        if (after < 0 || after >= span) continue
        const isWrong = wanted !== -1 && after + lowest !== wanted
        if (isWrong && everyOne) continue
        const total = soFar + Number(isWrong)
        if (next[after] === -1 || total < next[after]!) next[after] = total
        any = true
      }
    }
    if (!any) return {wrong: 1, stoppedAt: position}
    fewestWrong = next
  }
  let wrong = -1
  for (const total of fewestWrong) if (total !== -1 && (wrong === -1 || total < wrong)) wrong = total
  return {wrong, stoppedAt: -1}
}

export type Limits = {
  // No run of the loop has every scored depth right.
  needsNestingFix: boolean
  // The position in the broken text of the first code point whose scored depth cannot be right together with those
  // before it. -1 when the field is false.
  nestingStopsAt: number
  // Nothing is proven about the display kinds: a display entry of an added grammar state may hold any kind. The two
  // fields are constants, kept so that code written for the JSON dataset's limits reads these.
  needsDisplayFix: false
  displayStopsAt: -1
}

// What the loop cannot give for a broken text, see the top of this file. `labels` are the labels of the broken text's
// code points with what is not scored left out, as labelsOf returns them.
export function limitsOf(broken: readonly string[], labels: readonly (Label | undefined)[], firstErrorPosition: number): Limits {
  const {stoppedAt} = bestRun(broken, labels, firstErrorPosition, true)
  return {needsNestingFix: stoppedAt !== -1, nestingStopsAt: stoppedAt, needsDisplayFix: false, displayStopsAt: -1}
}

// The most code points of a sample, of those that a score counts, that one run of the loop can have right: `right` of
// `counted`. Only a wrong depth costs a code point, so the bound is loose, see the top of this file.
export function mostRightOf(broken: readonly string[], labels: readonly (Label | undefined)[], firstErrorPosition: number) {
  let counted = 0
  for (let position = Math.max(0, firstErrorPosition); position < labels.length; position++) {
    const label = labels[position]
    if (label !== undefined && (label.kind !== undefined || label.depth !== undefined)) counted++
  }
  return {right: counted - bestRun(broken, labels, firstErrorPosition, false).wrong, counted}
}
