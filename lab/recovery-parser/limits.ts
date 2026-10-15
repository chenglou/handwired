// What the highlighter's loop can give for a broken text when only the cells that valid JSON never reads may change:
// the two fields needsNestingFix and needsDisplayFix of a sample, and the bound that stats.ts prints for an arm that
// changes cells of the tokenizer's table as well as cells of the grammar's.
//
// The parser meant here is the loop of table-parser.ts, run with other tables, under these conditions:
//
// 1. A cell that some valid JSON text reads is as it is, in the tokenizer's table and in the grammar's table. That is
//    what makes valid JSON read as now. `cellsThatValidJsonReads` finds these cells: 148 of the tokenizer's 858, 88 of
//    the grammar's 704. Every other cell may hold anything, and the tables may have more states.
// 2. The 33 character classes, the events with their tokens and their depth changes, and the display table are as
//    they are. So an event is shown as the same kind in every grammar state, also in an added one, except that the
//    code points of a string are shown as a key or as a string. And the depth and the container are running totals
//    over the events, so they change only at an event that opens or closes a container, by one level.
// 3. Two things that are true of the tables as they are stay true of the changed cells:
//    a. An event that opens or closes a container, the colon event and the comma event are only given to their own
//       character, e.g. openObject only to `{`. So the depth moves only at a bracket, in the bracket's direction, or
//       not at all when the tables skip the bracket. A character that stands in the place of another, e.g. `(` for
//       `[`, counts as that one: reading it so takes a class, which a sample's needsClass records.
//    b. After a code point that is shown as white space or as punctuation, the tokenizer is in the state `between`,
//       as after every such code point of valid JSON. So what follows a space, a bracket, a colon or a comma is read
//       as valid JSON reads it there: a quote opens a string, a bracket moves the depth, `t`, `f` and `n` start a
//       literal, and a digit or a minus starts a number.
//
// Conditions 1 and 2 are the experiment's own. Condition 3 is an assumption, and without it nothing can be ruled out
// after the first cell that valid JSON never reads: ten rows of the tokenizer's table are read by valid JSON in one
// cell only, e.g. the row of the state `tr` in the cell for `u`, and the row of `errorLine` in none, so tables could
// use these rows as the states of a second tokenizer that never comes back to `between`, and give a closing event to
// any character. Such tables can label one text and no rule stands behind them, e.g. they cannot know whether the
// `n` after a comma starts the key `name` or the value `null`. `assumptionProblems` checks condition 1 and condition 3
// on any tables, and invariants.test.ts checks them on the two hand rules.
//
// Under these conditions `limitsOf` proves that a sample's scored labels cannot all be right. It does not prove that
// they can: it lets the tokenizer take any state and any event where condition 3 does not decide, it does not ask that
// one table gives the same answer in two places that read the same cell, and it lets the grammar show any string as a
// key or as a string.
import {displayKind} from '../../src/json-search/highlighter/kinds.ts'
import type {Label} from './labels.ts'
import {type ParserTables, classNames, containerArray, containerNone, containerObject, defaultTables, eventNames, grammarCellName, lexerCellName, lexerStateNames} from './table-parser.ts'

const tables = defaultTables
const eventNamed = (name: typeof eventNames[number]) => eventNames.indexOf(name)
const between = lexerStateNames.indexOf('between')
const whitespaceEvent = eventNamed('whitespace')
const stringEvents = new Set([eventNamed('stringStart'), eventNamed('stringContent'), eventNamed('stringEnd')])
// The event of each character of punctuation, which condition 3a ties to that character.
const eventOfCharacter = new Map<string, number>([
  ['{', eventNamed('openObject')], ['[', eventNamed('openArray')], ['}', eventNamed('closeObject')], [']', eventNamed('closeArray')], [':', eventNamed('colon')], [',', eventNamed('comma')],
])
const punctuationEvents = new Set(eventOfCharacter.values())
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
  if (tables.depthChange[event] !== 0 && !isPunctuation) throw new Error(`limits.ts expects only brackets to change the depth, and ${eventNames[event]} does`)
  if ((displayOfEvent[event] === displayKind.whitespace) !== (event === whitespaceEvent)) throw new Error('limits.ts expects one event to be shown as white space')
}
const showsAs = (event: number, kind: number) => stringEvents.has(event) ? kind === displayKind.key || kind === displayKind.string : displayOfEvent[event] === kind

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

// What breaks condition 1 or condition 3 in some tables, as sentences, or an empty list. The tables may have more
// tokenizer states and grammar states than the default ones.
export function assumptionProblems(candidate: ParserTables): string[] {
  const problems: string[] = []
  if (candidate.classCount !== tables.classCount || candidate.symbolCount !== tables.symbolCount || candidate.eventCount !== tables.eventCount) return ['the tables have other classes, tokens or events']
  for (let cell = 0; cell < tables.lexerEvent.length; cell++) {
    if (readByValidJson.tokenizer[cell] === 1 && (candidate.lexerEvent[cell] !== tables.lexerEvent[cell] || candidate.lexerNext[cell] !== tables.lexerNext[cell])) problems.push(`the tokenizer's cell ${lexerCellName(cell)} is read by valid JSON and is changed`)
  }
  for (let cell = 0; cell < tables.grammarNext.length; cell++) {
    if (readByValidJson.grammar[cell] === 1 && candidate.grammarNext[cell] !== tables.grammarNext[cell]) problems.push(`the grammar's cell ${grammarCellName(cell)} is read by valid JSON and is changed`)
  }
  for (let cell = 0; cell < candidate.lexerEvent.length; cell++) {
    const event = candidate.lexerEvent[cell]!
    const characterClass = classNames[cell % candidate.classCount]!
    const name = lexerCellName(cell, candidate)
    if (punctuationEvents.has(event)) {
      const own: Record<string, string> = {openObject: 'openBrace', openArray: 'openBracket', closeObject: 'closeBrace', closeArray: 'closeBracket', colon: 'colon', comma: 'comma'}
      if (own[eventNames[event]!] !== characterClass) problems.push(`the tokenizer's cell ${name} gives the event ${eventNames[event]} to another character than its own`)
    }
    if ((punctuationEvents.has(event) || event === whitespaceEvent) && candidate.lexerNext[cell] !== between) problems.push(`the tokenizer's cell ${name} shows white space or punctuation and does not lead to the state between`)
  }
  return problems
}

// What limitsOf reads of a text: per code point its class, the event of punctuation that condition 3a lets it have,
// or -1, and the scored values of its label.
type Reading = {
  length: number
  characterClass: Int16Array
  ownEvent: Int16Array
  // -1 where the value is not scored or the code point has no label.
  kind: Int16Array
  depth: Int16Array
  container: Int16Array
  // Whether a score counts the code point: it is at or after the first error and has a scored value.
  counted: Uint8Array
}

function readingOf(broken: readonly string[], labels: readonly (Label | undefined)[], standsFor: (position: number) => string | undefined, firstErrorPosition: number): Reading {
  const length = broken.length
  const reading: Reading = {
    length, characterClass: new Int16Array(length), ownEvent: new Int16Array(length).fill(-1), kind: new Int16Array(length).fill(-1), depth: new Int16Array(length).fill(-1),
    container: new Int16Array(length).fill(-1), counted: new Uint8Array(length),
  }
  const lastClassEntry = tables.classOfCodePoint.length - 1
  for (let position = 0; position < length; position++) {
    const character = broken[position]!
    reading.characterClass[position] = tables.classOfCodePoint[Math.min(character.codePointAt(0)! + 1, lastClassEntry)]!
    reading.ownEvent[position] = eventOfCharacter.get(character) ?? eventOfCharacter.get(standsFor(position) ?? '') ?? -1
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

// The tokenizer's state as far as the conditions decide it: one of the table's states, or `anyState` after a cell
// that valid JSON never reads, where the tables may have put the tokenizer into any state.
const anyState = lexerStateNames.length
const stateCount = lexerStateNames.length + 1
const depthOffset = 600
const depthSpan = 1201
const codeOffset = 2 ** 26
const lastLevel = tables.levelWeight.length - 1
const containerOf = (depth: number, objectCode: number) => depth <= 0 ? containerNone : objectCode >= tables.levelWeight[Math.min(Math.max(depth - 1, 0), lastLevel)]! ? containerObject : containerArray

// The most code points of a text that one run of the loop can have right under the conditions at the top of this
// file, where a code point is right when its scored display kind, its scored depth and its scored container are (with
// `kinds` false the display kinds are left out, with `nesting` false the depth and the container). With `everyOne` the
// result only says whether a run has every counted code point right: `right` is then `counted` or less.
//
// A run is followed as a set of situations: the tokenizer's state as far as it is decided, the depth, and the
// containers' kinds as the loop's running total. Where a cell that valid JSON reads decides the event, there is one
// way on. Elsewhere there are up to three: the code point's own event of punctuation, the white space event, or an
// event that is shown as anything else, after which the tokenizer can be in any state.
function bestRun(reading: Reading, kinds: boolean, nesting: boolean, everyOne: boolean): {right: number, counted: number, exact: boolean, stoppedAt: number} {
  const {length} = reading
  // The counted code points after each position, which is the most that a run can still add.
  const remaining = new Int32Array(length + 1)
  const isCounted = (position: number) => reading.counted[position] === 1 && ((kinds && reading.kind[position] !== -1) || (nesting && reading.depth[position] !== -1))
  for (let position = length - 1; position >= 0; position--) remaining[position] = remaining[position + 1]! + Number(isCounted(position))
  const counted = remaining[0]!
  const keyOf = (state: number, depth: number, objectCode: number) => ((objectCode + codeOffset) * depthSpan + depth + depthOffset) * stateCount + state

  // One pass over the text. `width` is the most situations that are kept after a code point, and `atLeast` is a number
  // of right code points that some run is known to reach: a situation that cannot reach it any more is dropped.
  // `stoppedAt` is the position of the first code point at which no run that is still followed can go on, or -1.
  const pass = (width: number, atLeast: number): {right: number, exact: boolean, stoppedAt: number} => {
    let situations = new Map<number, number>([[keyOf(between, 0, 0), 0]])
    for (let position = 0; position < length; position++) {
      const next = new Map<number, number>()
      const characterClass = reading.characterClass[position]!
      const labelKind = reading.kind[position]!
      const labelDepth = reading.depth[position]!
      const counts = isCounted(position)
      const add = (state: number, depth: number, objectCode: number, kindRight: boolean, rightSoFar: number) => {
        let right = rightSoFar
        if (counts) {
          const isRight = (!kinds || labelKind === -1 || kindRight) && (!nesting || labelDepth === -1 || (depth === labelDepth && containerOf(depth, objectCode) === reading.container[position]))
          if (isRight) right++
          else if (everyOne) return
        }
        if (right + remaining[position + 1]! < atLeast) return
        const key = keyOf(state, depth, objectCode)
        const known = next.get(key)
        if (known === undefined || known < right) next.set(key, right)
      }
      // The situation after an event that opens or closes, with the arithmetic of the loop in table-parser.ts.
      const addEvent = (event: number, state: number, depth: number, objectCode: number, rightSoFar: number) => {
        const weightEntry = depth * tables.eventCount + event
        const code = depth >= 0 && weightEntry < tables.objectWeight.length ? objectCode + tables.objectWeight[weightEntry]! : objectCode
        add(state, depth + tables.depthChange[event]!, code, labelKind === -1 || showsAs(event, labelKind), rightSoFar)
      }
      for (const [key, right] of situations) {
        const state = key % stateCount
        const rest = (key - state) / stateCount
        const depth = rest % depthSpan - depthOffset
        const objectCode = (rest - depth - depthOffset) / depthSpan - codeOffset
        const cell = state * tables.classCount + characterClass
        if (state !== anyState && readByValidJson.tokenizer[cell] === 1) {
          addEvent(tables.lexerEvent[cell]!, tables.lexerNext[cell]!, depth, objectCode, right)
          continue
        }
        // The code point's own event of punctuation, after which the tokenizer is in the state between.
        const ownEvent = reading.ownEvent[position]!
        if (ownEvent !== -1) addEvent(ownEvent, between, depth, objectCode, right)
        // The white space event leads to the state between too. When the label is no white space, an event that is shown
        // as something else is as wrong and leaves the tokenizer free, so the white space event is not followed then.
        if (labelKind === displayKind.whitespace) add(between, depth, objectCode, true, right)
        // Any other event, e.g. one of a string, a number, a literal or an error: it is shown as the label's kind when
        // that kind is neither white space nor punctuation.
        add(anyState, depth, objectCode, labelKind !== displayKind.whitespace && labelKind !== displayKind.punctuation, right)
      }
      if (next.size === 0) return {right: -1, exact: true, stoppedAt: position}
      if (next.size > width) {
        if (width === 1) {
          let best: [number, number] = [0, -1]
          for (const [key, right] of next) if (right > best[1]) best = [key, right]
          next.clear()
          next.set(best[0], best[1])
        } else {
          // Too many situations to follow. The answer is then the most that any of them could still reach.
          let most = 0
          for (const right of next.values()) most = Math.max(most, right + remaining[position + 1]!)
          return {right: most, exact: false, stoppedAt: -1}
        }
      }
      situations = next
    }
    let most = -1
    for (const right of situations.values()) most = Math.max(most, right)
    return {right: most, exact: true, stoppedAt: -1}
  }
  if (everyOne) {
    const {right, exact, stoppedAt} = pass(2000, counted)
    return {right: Math.max(right, 0), counted, exact, stoppedAt}
  }
  // One run first, the one that is best after every code point, and then every run that can still do as well.
  const one = pass(1, 0)
  const {right, exact} = pass(4000, Math.max(one.right, 0))
  return {right, counted, exact, stoppedAt: -1}
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

// A code point of the broken text that stands in the place of another one counts as that one in condition 3a.
const standsForOf = (original: readonly string[], alignment: readonly number[], replaced: readonly boolean[]) =>
  (position: number) => replaced[position] === true ? original[alignment[position]!] : undefined

// The two fields of a sample that say what the loop cannot give, see the top of this file. `labels` are the labels of
// the broken text's code points with what is not scored left out, as labelsOf returns them.
export function limitsOf(broken: readonly string[], labels: readonly (Label | undefined)[], original: readonly string[], alignment: readonly number[], replaced: readonly boolean[], firstErrorPosition: number): Limits {
  const reading = readingOf(broken, labels, standsForOf(original, alignment, replaced), firstErrorPosition)
  // The position at which the runs that have everything right so far come to an end, or -1 when one reaches the end
  // of the text, or when the text has more situations than are followed, which counts as "nothing is proven".
  const stopOf = (kinds: boolean, nesting: boolean) => {
    const {exact, stoppedAt} = bestRun(reading, kinds, nesting, true)
    return exact ? stoppedAt : -1
  }
  const displayStopsAt = stopOf(true, false)
  let nestingStopsAt = stopOf(false, true)
  if (nestingStopsAt === -1 && displayStopsAt === -1) nestingStopsAt = stopOf(true, true)
  return {needsDisplayFix: displayStopsAt !== -1, needsNestingFix: nestingStopsAt !== -1, displayStopsAt, nestingStopsAt}
}

// The most code points of a sample, of those that a score counts, that one run of the loop can have right in every
// scored value. `exact` is false when the text had more situations than the search follows, and `right` is then an
// upper bound of the most.
export function mostRightOf(broken: readonly string[], labels: readonly (Label | undefined)[], original: readonly string[], alignment: readonly number[], replaced: readonly boolean[], firstErrorPosition: number) {
  return bestRun(readingOf(broken, labels, standsForOf(original, alignment, replaced), firstErrorPosition), true, true, false)
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
