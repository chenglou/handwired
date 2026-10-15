// What the highlighter's loop can give for a broken text when only the cells that valid JSON never reads may change:
// the two fields needsNestingFix and needsDisplayFix of a sample, and the bound that stats.ts prints for an arm that
// changes cells of the tokenizer's table as well as cells of the grammar's.
//
// The parser meant here is the loop of table-parser.ts, run with other tables, under two conditions. Both are the
// experiment's own, and nothing else is assumed about the tables:
//
// 1. A cell that some valid JSON text reads is as it is, in the tokenizer's table and in the grammar's table. That is
//    what makes valid JSON read as now. `cellsThatValidJsonReads` finds these cells: 148 of the tokenizer's 858, 88 of
//    the grammar's 704. Every other cell may hold anything, and the tables may have more states.
// 2. The 33 character classes, the events with their tokens and their depth changes, and the display table are as
//    they are. So an event is shown as the same kind in every grammar state, also in an added one, except that the
//    code points of a string are shown as a key or as a string. And the depth and the container are running totals
//    over the events, so they change only at an event that opens or closes a container, by one level.
//
// What follows from the two for a broken text:
//
// - Up to the first cell of the tokenizer's table that valid JSON never reads, the tokenizer reads the text as now:
//   every event is decided, with its display kind and its depth change. The grammar's first error does not end that.
//   E.g. in `{"a": 1 "b": 2}` every code point is read by a cell that valid JSON reads, so tables can only choose
//   between key and string for `"b"`. And in `{name: 1}` the `n` after the brace is read by the cell that starts
//   `null`, which is shown as a literal.
// - From that cell on nothing is decided. The cell may lead to a state that the tables added, and every cell of an
//   added state is free, so every later code point can get any event, e.g. after the `p` of `{port: 1, name: 2}` the
//   tables can be in a state that reads `name` as a word. Two limits are left. A code point is shown as one event's
//   kind. And the depth moves by one level per code point at most, at a code point that gets the event of a bracket,
//   which is shown as punctuation.
//
// So `limitsOf` follows the tokenizer as it is up to that cell, and after it follows only the depth: at a code point
// whose scored display kind is punctuation, or that has no scored display kind, the depth may move by one level, and
// elsewhere a move costs the display kind. That proves that a sample's scored labels cannot all be right. It does not
// prove that they can:
// - It does not ask that one table gives the same answer in two places that read the same cell, or that a rule stands
//   behind the answers. E.g. it lets a comma get the event of a closing bracket where that fits one text.
// - It lets the grammar show any string as a key or as a string.
// - After the first cell that valid JSON never reads it takes every container's kind for right, since tables can then
//   give a bracket the event of the other kind.
import {displayKind} from '../../src/json-search/highlighter/kinds.ts'
import type {Label} from './labels.ts'
import {type ParserTables, classNames, containerArray, containerNone, containerObject, defaultTables, eventNames, grammarCellName, lexerCellName, lexerStateNames} from './table-parser.ts'

const tables = defaultTables
const eventNamed = (name: typeof eventNames[number]) => eventNames.indexOf(name)
const between = lexerStateNames.indexOf('between')
const whitespaceEvent = eventNamed('whitespace')
const stringEvents = new Set([eventNamed('stringStart'), eventNamed('stringContent'), eventNamed('stringEnd')])
const bracketEvents = new Set([eventNamed('openObject'), eventNamed('openArray'), eventNamed('closeObject'), eventNamed('closeArray')])
const punctuationEvents = new Set([...bracketEvents, eventNamed('colon'), eventNamed('comma')])
// What the display table shows for an event. For the three events of a string it is a key or a string.
const displayOfEvent = eventNames.map((_, event) => tables.display[event * tables.grammarStateCount]!)
for (let event = 0; event < eventNames.length; event++) {
  for (let state = 0; state < tables.grammarStateCount; state++) {
    const shown = tables.display[event * tables.grammarStateCount + state]!
    const fits = stringEvents.has(event) ? shown === displayKind.key || shown === displayKind.string : shown === displayOfEvent[event]
    if (!fits) throw new Error(`limits.ts expects the display kind of ${eventNames[event]} to be the same in every grammar state`)
  }
  const isPunctuation = punctuationEvents.has(event)
  if ((displayOfEvent[event] === displayKind.punctuation) !== isPunctuation) throw new Error(`limits.ts expects exactly the brackets, the colon and the comma to be shown as punctuation, and ${eventNames[event]} is not so`)
  if ((tables.depthChange[event] !== 0) !== bracketEvents.has(event) || Math.abs(tables.depthChange[event]!) > 1) throw new Error(`limits.ts expects exactly the brackets to change the depth, by one level, and ${eventNames[event]} is not so`)
  if ((displayOfEvent[event] === displayKind.whitespace) !== (event === whitespaceEvent)) throw new Error('limits.ts expects one event to be shown as white space')
}
const showsAs = (event: number, kind: number) => stringEvents.has(event) ? kind === displayKind.key || kind === displayKind.string : displayOfEvent[event] === kind
// The display kinds that some event shows without moving the depth: every kind of a label, e.g. punctuation by the
// event of a comma. A label of another kind could never be right.
const shownWithoutAMove = new Set<number>([displayKind.key])
for (let event = 0; event < eventNames.length; event++) if (!bracketEvents.has(event)) shownWithoutAMove.add(displayOfEvent[event]!)

// The cells that some valid JSON text reads, found by a walk over everything the parser as it is can be in before an
// error: the tokenizer's state, the grammar's state, the depth, and whether the innermost container is an object. A
// closing bracket at depth 2 or more can lead back into an object or into an array, since a container may sit in
// either. A text that is read without an error up to some code point is the start of a valid text, so these are also
// the cells that a text can read before its first error.
export function cellsThatValidJsonReads() {
  const tokenizer = new Uint8Array(tables.lexerEvent.length)
  const grammar = new Uint8Array(tables.grammarNext.length)
  const seen = new Set<number>()
  const queue: [lexerState: number, grammarState: number, depth: number, inObject: number][] = [[between, 0, 0, 0]]
  while (queue.length > 0) {
    const [lexerState, grammarState, depth, inObject] = queue.pop()!
    const key = ((lexerState * tables.grammarStateCount + grammarState) * 32 + depth) * 2 + inObject
    if (seen.has(key)) continue
    seen.add(key)
    for (let characterClass = 0; characterClass < tables.classCount; characterClass++) {
      const lexerCell = lexerState * tables.classCount + characterClass
      const event = tables.lexerEvent[lexerCell]!
      const grammarCell = grammarState * tables.symbolCount + tables.grammarToken[event]! * tables.contextCount + tables.depthClass[depth]! * 2 + inObject
      const grammarAfter = tables.grammarNext[grammarCell]!
      if (grammarAfter === tables.errorState) continue
      tokenizer[lexerCell] = 1
      grammar[grammarCell] = 1
      // The classes of a text's end are read after the last code point, and nothing follows them.
      if (classNames[characterClass] === 'end' || classNames[characterClass] === 'truncatedEnd') continue
      const lexerAfter = tables.lexerNext[lexerCell]!
      const change = tables.depthChange[event]!
      if (change > 0) queue.push([lexerAfter, grammarAfter, depth + 1, Number(event === eventNamed('openObject'))])
      else if (change < 0 && depth - 1 === 0) queue.push([lexerAfter, grammarAfter, 0, 0])
      else if (change < 0) queue.push([lexerAfter, grammarAfter, depth - 1, 0], [lexerAfter, grammarAfter, depth - 1, 1])
      else queue.push([lexerAfter, grammarAfter, depth, inObject])
    }
  }
  return {tokenizer, grammar}
}
const readByValidJson = cellsThatValidJsonReads()

// What breaks condition 1 or condition 2 in some tables, as sentences, or an empty list. With an empty list the two
// fields and the bound of this file hold for the tables. The tables may have more tokenizer states and more grammar
// states than the default ones. E.g. an arm that opens cells of the display table, or that adds a character class,
// gets a sentence here: the bound says nothing about its tables.
export function conditionProblems(candidate: ParserTables): string[] {
  const problems: string[] = []
  if (candidate.classCount !== tables.classCount || candidate.symbolCount !== tables.symbolCount || candidate.eventCount !== tables.eventCount || candidate.contextCount !== tables.contextCount) {
    return ['the tables have another number of classes, tokens, contexts or events']
  }
  for (let cell = 0; cell < tables.lexerEvent.length; cell++) {
    if (readByValidJson.tokenizer[cell] === 1 && (candidate.lexerEvent[cell] !== tables.lexerEvent[cell] || candidate.lexerNext[cell] !== tables.lexerNext[cell])) problems.push(`the tokenizer's cell ${lexerCellName(cell)} is read by valid JSON and is changed`)
  }
  for (let cell = 0; cell < tables.grammarNext.length; cell++) {
    if (readByValidJson.grammar[cell] === 1 && candidate.grammarNext[cell] !== tables.grammarNext[cell]) problems.push(`the grammar's cell ${grammarCellName(cell)} is read by valid JSON and is changed`)
  }
  const same = (left: readonly number[], right: readonly number[]) => left.length === right.length && left.every((value, index) => value === right[index])
  const fixed: [name: string, key: 'classOfCodePoint' | 'grammarToken' | 'depthChange' | 'objectWeight' | 'levelWeight' | 'depthClass'][] = [
    ['the character classes', 'classOfCodePoint'], ['the tokens of the events', 'grammarToken'], ['the depth changes of the events', 'depthChange'],
    ['the weights that the kinds of the containers are added up with', 'objectWeight'], ['the weights that a container\'s kind is read with', 'levelWeight'], ['the classes of the depth', 'depthClass'],
  ]
  for (const [name, key] of fixed) if (!same(candidate[key], tables[key])) problems.push(`${name} are changed`)
  // The display table: as it is for the grammar states that the tables have now, and for an added state the same kind
  // per event, with a key or a string for the events of a string.
  for (let event = 0; event < tables.eventCount; event++) {
    for (let state = 0; state < candidate.grammarStateCount; state++) {
      const shown = candidate.display[event * candidate.grammarStateCount + state]
      const fits = state < tables.grammarStateCount ? shown === tables.display[event * tables.grammarStateCount + state]
        : stringEvents.has(event) ? shown === displayKind.key || shown === displayKind.string : shown === displayOfEvent[event]
      if (!fits) problems.push(`the display table shows the event ${eventNames[event]} in another way in the grammar state ${state}`)
    }
  }
  return problems
}

// What limitsOf reads of a text: per code point its class and the scored values of its label.
type Reading = {
  length: number
  characterClass: Int16Array
  // -1 where the value is not scored or the code point has no label.
  kind: Int16Array
  depth: Int16Array
  container: Int16Array
  // Whether a score counts the code point: it is at or after the first error and has a scored value.
  counted: Uint8Array
}

function readingOf(broken: readonly string[], labels: readonly (Label | undefined)[], firstErrorPosition: number): Reading {
  const length = broken.length
  const reading: Reading = {
    length, characterClass: new Int16Array(length), kind: new Int16Array(length).fill(-1), depth: new Int16Array(length).fill(-1),
    container: new Int16Array(length).fill(-1), counted: new Uint8Array(length),
  }
  const lastClassEntry = tables.classOfCodePoint.length - 1
  for (let position = 0; position < length; position++) {
    reading.characterClass[position] = tables.classOfCodePoint[Math.min(broken[position]!.codePointAt(0)! + 1, lastClassEntry)]!
    const label = labels[position]
    if (label === undefined) continue
    if (label.kind !== undefined) reading.kind[position] = label.kind
    if (label.depth !== undefined && label.container !== undefined) {
      reading.depth[position] = label.depth
      reading.container[position] = label.container
    }
    if (position >= firstErrorPosition && (label.kind !== undefined || label.depth !== undefined)) reading.counted[position] = 1
  }
  return reading
}

const lastLevel = tables.levelWeight.length - 1
const containerOf = (depth: number, objectCode: number) => depth <= 0 ? containerNone : objectCode >= tables.levelWeight[Math.min(Math.max(depth - 1, 0), lastLevel)]! ? containerObject : containerArray

// The most code points of a text that one run of the loop can have right under the conditions at the top of this
// file, where a code point is right when its scored display kind, its scored depth and its scored container are (with
// `kinds` false the display kinds are left out, with `nesting` false the depth and the container). With `everyOne` the
// search stops at the first code point at which no run has every counted code point so far right: `stoppedAt` is that
// position, and `right` is then less than `counted`.
function bestRun(reading: Reading, kinds: boolean, nesting: boolean, everyOne: boolean): {right: number, counted: number, stoppedAt: number} {
  const {length} = reading
  const isCounted = (position: number) => reading.counted[position] === 1 && ((kinds && reading.kind[position] !== -1) || (nesting && reading.depth[position] !== -1))
  let counted = 0
  for (let position = 0; position < length; position++) counted += Number(isCounted(position))

  // The part that the tokenizer reads as now: one run, with the arithmetic of the loop in table-parser.ts.
  let state = between
  let depth = 0
  let objectCode = 0
  let right = 0
  let position = 0
  for (; position < length; position++) {
    const cell = state * tables.classCount + reading.characterClass[position]!
    if (readByValidJson.tokenizer[cell] !== 1) break
    const event = tables.lexerEvent[cell]!
    const weightEntry = depth * tables.eventCount + event
    if (depth >= 0 && weightEntry < tables.objectWeight.length) objectCode += tables.objectWeight[weightEntry]!
    depth += tables.depthChange[event]!
    state = tables.lexerNext[cell]!
    if (!isCounted(position)) continue
    const labelKind = reading.kind[position]!
    const labelDepth = reading.depth[position]!
    const isRight = (!kinds || labelKind === -1 || showsAs(event, labelKind)) && (!nesting || labelDepth === -1 || (depth === labelDepth && containerOf(depth, objectCode) === reading.container[position]))
    if (isRight) right++
    else if (everyOne) return {right, counted, stoppedAt: position}
  }

  // The part after the first cell that valid JSON never reads. A run is its depth after each code point, and per
  // depth the most right code points of a run that has this depth are kept. A depth outside the labels' depths and the
  // depth at the start of this part is never better than the nearest depth inside, so the depths stay in that range.
  let lowest = Math.min(depth, 0)
  let highest = depth
  for (let at = position; at < length; at++) highest = Math.max(highest, reading.depth[at]!)
  const span = highest - lowest + 1
  let mostAtDepth = new Int32Array(span).fill(-1)
  mostAtDepth[depth - lowest] = right
  for (; position < length; position++) {
    const next = new Int32Array(span).fill(-1)
    const counts = isCounted(position)
    const labelKind = kinds ? reading.kind[position]! : -1
    const labelDepth = nesting ? reading.depth[position]! : -1
    // A code point that keeps the depth can be shown as any kind that a label has. One that moves the depth gets the
    // event of a bracket, which is shown as punctuation.
    const kindRightWithoutAMove = labelKind === -1 || shownWithoutAMove.has(labelKind)
    const kindRightWithAMove = labelKind === -1 || labelKind === displayKind.punctuation
    let any = false
    for (let index = 0; index < span; index++) {
      const soFar = mostAtDepth[index]!
      if (soFar === -1) continue
      for (let change = -1; change <= 1; change++) {
        const after = index + change
        if (after < 0 || after >= span) continue
        let total = soFar
        if (counts) {
          const isRight = (change === 0 ? kindRightWithoutAMove : kindRightWithAMove) && (labelDepth === -1 || after + lowest === labelDepth)
          if (isRight) total++
          else if (everyOne) continue
        }
        if (total > next[after]!) next[after] = total
        any = true
      }
    }
    if (!any) return {right: Math.max(...mostAtDepth), counted, stoppedAt: position}
    mostAtDepth = next
  }
  return {right: Math.max(...mostAtDepth), counted, stoppedAt: -1}
}

export type Limits = {
  // No run of the loop has every scored depth and container right, alone or together with the scored display kinds.
  needsNestingFix: boolean
  // No run of the loop has every scored display kind right.
  needsDisplayFix: boolean
  // The position in the broken text of the first code point that shows it: no run has the scored depth and container
  // there right together with those before it, and the same for the display kind. -1 when the field is false.
  nestingStopsAt: number
  displayStopsAt: number
}

// The two fields of a sample that say what the loop cannot give, see the top of this file. `labels` are the labels of
// the broken text's code points with what is not scored left out, as labelsOf returns them.
export function limitsOf(broken: readonly string[], labels: readonly (Label | undefined)[], firstErrorPosition: number): Limits {
  const reading = readingOf(broken, labels, firstErrorPosition)
  const displayStopsAt = bestRun(reading, true, false, true).stoppedAt
  let nestingStopsAt = bestRun(reading, false, true, true).stoppedAt
  if (nestingStopsAt === -1 && displayStopsAt === -1) nestingStopsAt = bestRun(reading, true, true, true).stoppedAt
  return {needsDisplayFix: displayStopsAt !== -1, needsNestingFix: nestingStopsAt !== -1, displayStopsAt, nestingStopsAt}
}

// The most code points of a sample, of those that a score counts, that one run of the loop can have right in every
// scored value: `right` of `counted`.
export function mostRightOf(broken: readonly string[], labels: readonly (Label | undefined)[], firstErrorPosition: number) {
  const {right, counted} = bestRun(readingOf(broken, labels, firstErrorPosition), true, true, false)
  return {right, counted}
}

// How many code points of a text from `position` on the tokenizer reads, coming from the state between, as one number
// or one literal or the start of one, by cells that valid JSON reads: e.g. 3 for `0.2.0`, 1 for `test`, 4 for `nullable`
// and 0 for `production`.
export function readsAsNumberOrLiteral(codePoints: readonly string[], position: number): number {
  const lastClassEntry = tables.classOfCodePoint.length - 1
  let state = between
  let index = position
  while (index < codePoints.length) {
    const cell = state * tables.classCount + tables.classOfCodePoint[Math.min(codePoints[index]!.codePointAt(0)! + 1, lastClassEntry)]!
    if (readByValidJson.tokenizer[cell] !== 1) break
    const shown = displayOfEvent[tables.lexerEvent[cell]!]
    if (shown !== displayKind.number && shown !== displayKind.literal) break
    state = tables.lexerNext[cell]!
    index++
    // A literal's last letter leads back to the state between, and what follows is another token.
    if (state === between) break
  }
  return index - position
}
