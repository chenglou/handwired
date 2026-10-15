// Typing replays: the texts that an editor holds while a person adds, deletes or changes an entry of a valid document,
// one text per key press.
//
// One rule gives every text. The finished document is the original. The part that the person types is a range of it,
// and after each key press the text is the finished document without the part of that range that isn't typed yet. An
// editor that closes quotes and brackets by itself keeps, of that part, the closers of what is open at the cursor, e.g.
// the closing quote of a key that is half typed. So every text only lacks code points of the original, and every code
// point in it has a label, apart from the one wrong character of the replays below.
//
// Deleting with Backspace passes through the same texts in the opposite order, so a replay of a deletion is a replay
// of typing with its steps reversed.
//
// One replay in three has a wrong key press: the key next to the right one, e.g. ; for :, and then Backspace. The text
// with the wrong character is the text before it plus that one character at the cursor, which is added and has no
// label. Its kinds are those of the text before it and typingSlip, see `wrongKeyStep` for the two exceptions.
import type {Reachable, Rule} from './damage/types.ts'
import {settleReachable} from './damage/types.ts'
import {type Edit, applyEdits, insertAt, mergeEdits, removeRange} from './edits.ts'
import type {Random} from './random.ts'
import {type Container, type Entry, type Scan, isWhitespace} from './scan.ts'

export type TypingStep = {
  // What was pressed, e.g. `"`, Enter, or Backspace in a deletion.
  key: string
  text: string
  // The removals that turn the finished document into `text`.
  edits: Edit[]
  valid: boolean
  // The kinds of damage in the text, in text order, with the names of damage.ts, e.g. missingComma, openStringAtLineEnd.
  kinds: string[]
  reachable: Reachable
  // The rules of damage/types.ts's `contradictions` that a parser needs for this text.
  needsRules: Rule[]
  // Indexes into the finished document of kept code points whose display kind is not scored, e.g. a comma inside an open string.
  unscoredKinds: number[]
  // Whether another sensible repair would give other labels, e.g. for a container whose closer is not typed yet.
  debatable: boolean
}
export type TypingReplay = {
  finished: string
  action: 'add an entry' | 'delete an entry' | 'change a value' | 'type the document'
  // A plain editor inserts only what is typed, e.g. a textarea. An auto-closing editor adds the closing quote or
  // bracket when the opening one is typed, e.g. VS Code.
  editor: 'plain' | 'auto-closing'
  // When the comma that joins a new last entry to the entry before it is typed: before the entry, after it, or never.
  // 'never' is also a new entry on a line before another entry whose own comma is never typed. 'none' in every other
  // replay: the range needs no comma, or its comma is typed in its place.
  comma: 'first' | 'last' | 'never' | 'none'
  // What is typed, in words, e.g. "the last member of an object at depth 2".
  target: string
  steps: TypingStep[]
}

const isValidNumber = (text: string) => /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(text)
// A text of a replay is the finished document without some of its code points, and at most one added character, so it
// is within the highlighter's capacity and depth, and the highlighter accepts it exactly when JSON.parse does.
const parses = (text: string) => {
  try {
    JSON.parse(text)
  } catch {
    return false
  }
  return true
}

// The key next to a key, for a slip of the finger: a neighbor on the same row of the keyboard, ; for a colon typed
// without Shift, and . or m for a comma.
const keyRows = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm']
function wrongKeysFor(key: string): string[] {
  if (key === ':') return [';']
  if (key === ',') return ['.', 'm']
  const row = key.length === 1 ? keyRows.find(letters => letters.includes(key)) : undefined
  if (row === undefined) return []
  const place = row.indexOf(key)
  return [row[place - 1], row[place + 1]].filter(letter => letter !== undefined)
}

// How many code points of an escape are typed when the cursor is inside one, e.g. 1 right after a backslash and 4
// after \u00, or 0 when the cursor is not inside an escape. `stringStart` is the string's opening quote.
function partialEscape(codePoints: readonly string[], stringStart: number, cursor: number) {
  for (let index = stringStart + 1; index < cursor; index++) {
    if (codePoints[index] !== '\\') continue
    const end = index + (codePoints[index + 1] === 'u' ? 6 : 2)
    if (cursor < end) return cursor - index
    index = end - 1
  }
  return 0
}

type Target = {
  action: TypingReplay['action']
  // The range of the finished document that is typed, in typing order.
  from: number
  to: number
  // Where the cursor is after the last key press: `to`, or the place before the range's last code point, a comma, when
  // that comma is never typed.
  typedUpTo: number
  // The position of the comma that joins a new last entry to the entry before it, when it is typed apart from the
  // range, or -1. It comes before the range.
  comma: number
  commaMode: TypingReplay['comma']
  // The entry that is added, deleted or changed, or null when the whole document is typed.
  entry: Entry | null
  description: string
}

function chooseTarget(random: Random, scanned: Scan): Target | undefined {
  const {codePoints} = scanned
  const action = random.weighted([['add an entry', 58], ['delete an entry', 17], ['change a value', 17], ['type the document', 8]] as const)
  if (action === 'type the document' || scanned.entries.length === 0) {
    // White space before the document, e.g. an empty first line, is there from the start.
    return {action: 'type the document', from: scanned.root.start, to: codePoints.length, typedUpTo: codePoints.length, comma: -1, commaMode: 'none', entry: null, description: 'the whole document'}
  }
  if (action === 'change a value') {
    // Mostly the value of a member, and mostly a scalar or a string.
    const members = scanned.entries.filter(entry => entry.key !== null)
    const pool = members.length > 0 && random.chance(0.85) ? members : scanned.entries
    const short = pool.filter(entry => entry.value.container === null)
    const entry = random.pick(short.length > 0 && random.chance(0.9) ? short : pool)
    return {action, from: entry.value.start, to: entry.value.end, typedUpTo: entry.value.end, comma: -1, commaMode: 'none', entry, description: `the ${entry.value.type} value of ${entry.key === null ? 'an item' : 'a member'} at depth ${entry.container.depth}`}
  }
  // People append: the new entry is the last of its container in most replays.
  const last = scanned.entries.filter(entry => entry.commaAfter === -1 && entry.index > 0)
  const middle = scanned.entries.filter(entry => entry.commaAfter !== -1)
  const only = scanned.entries.filter(entry => entry.commaAfter === -1 && entry.index === 0)
  const place = random.weighted([['last', last.length > 0 ? 65 : 0], ['middle', middle.length > 0 ? 30 : 0], ['only', only.length > 0 ? 5 : 0]] as const)
  const pool = place === 'last' ? last : place === 'middle' ? middle : only
  if (pool.length === 0) return undefined
  const short = pool.filter(entry => entry.value.container === null)
  const entry = random.pick(short.length > 0 && random.chance(0.8) ? short : pool)
  const container = entry.container
  const what = `${entry.key === null ? 'item' : 'member'} of an ${container.type} at depth ${container.depth}`
  if (place === 'last') {
    const comma = container.entries[entry.index - 1]!.commaAfter
    // Backspace over a last entry ends at the comma before it, which is the order "comma first" read backwards.
    const commaMode = action === 'delete an entry' ? 'first' : random.weighted([['first', 60], ['last', 25], ['never', 15]] as const)
    return {action, from: commaMode === 'first' ? comma : comma + 1, to: entry.end, typedUpTo: entry.end, comma: commaMode === 'first' ? -1 : comma, commaMode, entry, description: `the last ${what}`}
  }
  if (place === 'only') {
    // The brackets were there before. When the closer is on a line of its own, that line was there too.
    const closerOnOwnLine = codePoints.slice(entry.end, container.close).includes('\n')
    const to = closerOnOwnLine ? entry.end : container.close
    return {action, from: container.open + 1, to, typedUpTo: to, comma: -1, commaMode: 'none', entry, description: `the only ${what}`}
  }
  // An entry before another one. In a container on several lines the person presses Enter at the end of the line
  // above and types the entry and its comma. Inside a line the person types the entry, its comma and the space.
  let before = entry.start
  while (before > 0 && isWhitespace(codePoints[before - 1])) before--
  const ownLine = codePoints.slice(before, entry.start).includes('\n')
  const next = container.entries[entry.index + 1]!
  // In some replays of a new line, the comma after the new entry is never typed. The comma is then still the end of
  // the range, and the typing stops before it, so that every text of such a replay is a text of the replay that goes
  // on to the comma, with the same edits.
  const never = action === 'add an entry' && ownLine && random.chance(0.15)
  const to = ownLine ? entry.commaAfter + 1 : next.start
  return {action, from: ownLine ? before : entry.start, to, typedUpTo: never ? entry.end : to, comma: -1, commaMode: never ? 'never' : 'none', entry, description: `${entry.index === 0 ? 'the first' : 'a middle'} ${what}`}
}

// The cursor positions after each key press while the range is typed: one code point per key press, and a line feed
// with the indentation after it as one, since Enter brings the indentation.
function cursorStops(codePoints: readonly string[], from: number, to: number) {
  const stops: {cursor: number, key: string}[] = []
  let cursor = from
  while (cursor < to) {
    const character = codePoints[cursor]!
    let next = cursor + 1
    if (character === '\n') while (next < to && (codePoints[next] === ' ' || codePoints[next] === '\t')) next++
    stops.push({cursor: next, key: character === '\n' ? 'Enter' : character === ' ' ? 'Space' : character === '\t' ? 'Tab' : character})
    cursor = next
  }
  return stops
}

export function makeTypingReplay(random: Random, scanned: Scan): TypingReplay | undefined {
  const {codePoints} = scanned
  const target = chooseTarget(random, scanned)
  if (target === undefined) return undefined
  // Backspace from the end of an entry deletes the closers first, also those that an editor had added, so a deletion
  // passes through the texts of a plain editor in every editor.
  const editor: TypingReplay['editor'] = target.action === 'delete an entry' || random.chance(0.5) ? 'plain' : 'auto-closing'
  const {from, to} = target
  const inRange = (position: number) => position >= from && position < to
  const strings = scanned.strings.filter(part => inRange(part.start))
  const containers = scanned.containers.filter(container => inRange(container.open))

  // The text after the cursor reached `cursor`, with the joining comma typed or not.
  const stepAt = (cursor: number, commaTyped: boolean, key: string): TypingStep => {
    // What an auto-closing editor has put after the cursor: the closers of the strings and containers that are open.
    const kept = new Set<number>()
    if (editor === 'auto-closing') {
      for (const part of strings) if (part.start < cursor && cursor <= part.end - 1) kept.add(part.end - 1)
      for (const container of containers) {
        if (!(container.open < cursor && cursor <= container.close && container.close < to)) continue
        kept.add(container.close)
        // After Enter inside the new brackets, the editor has put the closer on a line of its own.
        if (codePoints.slice(container.open + 1, cursor).includes('\n')) {
          for (let index = container.close - 1; index >= cursor && isWhitespace(codePoints[index]); index--) kept.add(index)
        }
      }
    }
    // The removals in text order: the joining comma, which comes before the range, and then what is not typed yet.
    const edits: Edit[] = []
    if (!commaTyped && target.comma !== -1) edits.push(removeRange(target.comma, target.comma + 1))
    let start = -1
    for (let index = cursor; index <= to; index++) {
      const removed = index < to && !kept.has(index)
      if (removed && start === -1) start = index
      if (!removed && start !== -1) {
        edits.push(removeRange(start, index))
        start = -1
      }
    }
    const text = applyEdits(codePoints, edits).broken
    const valid = parses(text)
    const step: TypingStep = {key, text, edits, valid, kinds: [], reachable: 'yes', needsRules: [], unscoredKinds: [], debatable: false}
    if (valid) return step

    // The text after the cursor: what the editor kept, and the document after the typed range.
    const tail = [...[...kept].sort((left, right) => left - right).map(index => codePoints[index]!), ...codePoints.slice(to)]
    const nextToken = (skip: number) => {
      let index = skip
      let lineFeed = false
      while (index < tail.length && isWhitespace(tail[index])) {
        if (tail[index] === '\n') lineFeed = true
        index++
      }
      return {character: tail[index], lineFeed}
    }
    const reachable: Reachable[] = []
    const add = (kind: string, flag: Reachable, rule?: Rule) => {
      step.kinds.push(kind)
      reachable.push(flag)
      if (rule !== undefined && !step.needsRules.includes(rule)) step.needsRules.push(rule)
    }
    if (target.action === 'type the document' && editor === 'plain') {
      // The text is the start of the document and stops at the cursor.
      add('cutOff', 'yes')
      return step
    }
    const commaPending = !commaTyped && target.comma !== -1
    // The entry before this one has no comma yet, and a part of this entry is there.
    if (commaPending && target.entry !== null && target.comma < target.entry.start && cursor > target.entry.start) add('missingComma', 'yes')
    // After a key or after a colon, what follows decides. A closer or a comma is read as it is. The next key after a
    // colon is read as the value, as in valid JSON, so its display kind is not scored (see unscoredOf in samples.ts),
    // and the colon after it shows what happened. The next key after a key needs the rule "a string after a key is
    // the next key".
    const addAfterKeyOrColon = (kind: 'keyWithoutColon' | 'colonWithoutValue', skip: number) => {
      const {character} = nextToken(skip)
      if (character === '}' || character === ',') add(kind, 'yes')
      else if (character === '"') add(kind, 'yes', kind === 'keyWithoutColon' ? 'a string after a key is the next key' : undefined)
      else add(kind, 'no')
    }
    // A string that is open at the end of its line: it ends at the line feed. When it is a key and the next key
    // follows on the next line, that key is a string after a key.
    const addOpenStringAtLineEnd = (part: {role: 'key' | 'value'}, lineEndIndex: number) => {
      add('openStringAtLineEnd', 'line rule', 'a string that is open at a line feed ends there')
      if (part.role === 'key' && nextToken(lineEndIndex).character === '"') step.needsRules.push('a string after a key is the next key')
    }
    const openString = strings.find(part => part.start < cursor && cursor <= part.end - 1)
    const typedKey = strings.find(part => part.role === 'key' && part.end === cursor)
    // A member whose colon is there and whose value is not started: one that is being typed, or the one whose value was deleted.
    const afterColon = scanned.entries.find(entry => entry.colon !== -1 && entry.colon < cursor && cursor <= entry.value.start && entry.value.start >= from && entry.value.start <= to)
    const literal = scanned.literals.find(value => value.start < cursor && cursor < value.end && inRange(value.start))
    const number = scanned.numbers.find(value => value.start < cursor && cursor < value.end && inRange(value.start))
    if (openString !== undefined && editor === 'plain') {
      // The string is open. It ends its line when nothing but one comma is left on the line after the cursor.
      let index = 0
      if (tail[0] === ',') index = 1
      while (tail[index] === ' ' || tail[index] === '\t' || tail[index] === '\r') index++
      const atLineEnd = index >= tail.length || tail[index] === '\n'
      if (atLineEnd) addOpenStringAtLineEnd(openString, index)
      else add('openStringMidLine', 'no')
      // A comma right after the cursor is inside the open string.
      if (atLineEnd && tail[0] === ',') step.unscoredKinds.push(to)
    } else if (openString !== undefined) {
      // The editor closed the string's quote, which is the first code point after the cursor.
      const escapeTyped = partialEscape(codePoints, openString.start, cursor)
      if (escapeTyped === 1) {
        // A backslash alone escapes the quote that the editor added, so the string is open after all.
        let index = 1
        const commaInside = tail[1] === ',' && kept.size === 1
        if (commaInside) index = 2
        while (tail[index] === ' ' || tail[index] === '\t' || tail[index] === '\r') index++
        const atLineEnd = index >= tail.length || tail[index] === '\n'
        if (atLineEnd) addOpenStringAtLineEnd(openString, index)
        else add('openStringMidLine', 'no')
        // The quote reads as part of an escape, and a comma after it as the string's content.
        if (atLineEnd) step.unscoredKinds.push(openString.end - 1, ...(commaInside ? [to] : []))
      } else {
        // The start of a \u escape that has not all of its digits yet, before the closing quote.
        if (escapeTyped > 1) add('unescapedBackslash', 'yes')
        // In a key, the colon and the value are not typed.
        if (openString.role === 'key') addAfterKeyOrColon('keyWithoutColon', 1)
      }
    } else if (typedKey !== undefined) {
      addAfterKeyOrColon('keyWithoutColon', 0)
    } else if (afterColon !== undefined) {
      addAfterKeyOrColon('colonWithoutValue', 0)
    } else if (literal !== undefined) {
      add('partialLiteral', 'yes')
    } else if (number !== undefined && !isValidNumber(codePoints.slice(number.start, cursor).join(''))) {
      add('partialNumber', 'yes')
    }
    const open = containers.filter(container => container.open < cursor && cursor <= container.close && container.close < to)
    if (open.length > 0 && editor === 'plain') {
      // The new container has no closer yet. Only the closer of the container around it, when it is of the other kind,
      // shows where the new one ends.
      const innermost: Container = open.at(-1)!
      const {character} = nextToken(0)
      const closesBoth = open.length === 1 && innermost.parent !== null && innermost.parent.type !== innermost.type && character === (innermost.parent.type === 'object' ? '}' : ']')
      if (closesBoth) add('missingCloser', 'yes', 'a closer of the other kind closes two containers')
      else add('missingCloser', 'no')
      // Without that closer, the text also reads as a container that goes on, with its closer missing further down.
      step.debatable = !closesBoth
    }
    // The last thing typed, apart from white space.
    let lastTyped = cursor - 1
    while (lastTyped >= from && isWhitespace(codePoints[lastTyped])) lastTyped--
    const lastTypedIsComma = lastTyped >= from && codePoints[lastTyped] === ',' && scanned.entries.some(entry => entry.commaAfter === lastTyped)
    if (lastTypedIsComma && !step.kinds.includes('missingCloser')) {
      // A comma with nothing typed after it: the closer of its container follows it.
      const closer = nextToken(0).character
      if (closer === '}' || closer === ']') add('trailingComma', 'yes')
      else if (closer === ',') add('extraComma', 'yes')
    }
    const entryKinds = step.kinds.filter(kind => kind !== 'missingComma').length
    // In an auto-closing editor a new container is closed from the start, so what is half typed inside it is one
    // damage, and the comma that is missing after its closer is another.
    const newContainer = target.entry?.value.container ?? null
    const closedByEditor = newContainer !== null && kept.has(newContainer.close)
    if ((entryKinds === 0 || closedByEditor) && target.entry !== null && cursor > target.entry.start && target.entry.commaAfter !== -1 && target.entry.commaAfter >= cursor && target.action !== 'change a value') {
      // The new entry is complete, in an auto-closing editor as soon as its value is closed, and the comma that joins
      // it to the next entry is not typed.
      add('missingComma', 'yes')
    }
    if (target.action === 'change a value' && cursor === from && target.entry !== null && target.entry.colon === -1) {
      // An item was deleted and its commas stayed.
      const {character} = nextToken(0)
      const previous = target.entry.index === 0 ? '[' : ','
      if (character === ',') add('extraComma', 'yes')
      else if (character === ']' && previous === ',') add('trailingComma', 'yes')
    }
    step.reachable = settleReachable(reachable, step.needsRules)
    return step
  }
  // The text after a wrong key press at `cursor`: the text of the step before it and the wrong character. Its kinds
  // are those of the step before it and typingSlip, with two exceptions, where the wrong character changes what the
  // text before it was.
  const wrongKeyStep = (before: TypingStep, cursor: number, wrong: string, right: string): TypingStep => {
    const edits = mergeEdits([before.edits, [insertAt(cursor, wrong)]], codePoints.length)!
    const text = applyEdits(codePoints, edits).broken
    const valid = parses(text)
    const step: TypingStep = {...before, key: `${wrong} in place of ${right}`, text, edits, valid, kinds: valid ? [] : [...before.kinds, 'typingSlip'], needsRules: [...before.needsRules], unscoredKinds: [...before.unscoredKinds]}
    if (valid) return step
    // A wrong digit after the start of a number makes the number whole, e.g. the 6 of -24.6 typed for a 5. The number
    // is then no half-typed one, and what is left is what a whole value leaves: the comma after the entry is not typed.
    const number = scanned.numbers.find(value => value.start < cursor && cursor < value.end && inRange(value.start))
    if (before.kinds.includes('partialNumber') && number !== undefined && isValidNumber(`${codePoints.slice(number.start, cursor).join('')}${wrong}`)) {
      const commaNotTyped = target.entry !== null && target.entry.commaAfter !== -1 && target.entry.commaAfter >= cursor && target.action !== 'change a value'
      step.kinds = [...before.kinds.filter(kind => kind !== 'partialNumber'), ...(commaNotTyped && !before.kinds.includes('missingComma') ? ['missingComma'] : []), 'typingSlip']
    }
    // A ; in the place of the colon, with the next key after it, e.g. `"id";` and `"name": "Ada"` on the next line.
    // The step before it is a key without its colon, which needs the rule that a string after a key is the next key.
    // With the ; the text has a second reading: in the damage kind typingSlip a ; stands for the colon, and after a
    // colon every parser reads the next string as the value, as in a text with a colon and no value. Both readings
    // agree on every label but the display kind of the next key, so that kind is not scored and no rule is needed.
    const nextKeyRule: Rule = 'a string after a key is the next key'
    if (right === ':' && before.kinds.includes('keyWithoutColon') && before.needsRules.includes(nextKeyRule)) {
      let start = to
      while (start < codePoints.length && isWhitespace(codePoints[start])) start++
      const nextKey = scanned.strings.find(part => part.start === start && part.role === 'key')
      if (nextKey !== undefined) {
        step.needsRules = before.needsRules.filter(rule => rule !== nextKeyRule)
        step.unscoredKinds = [...before.unscoredKinds, ...Array.from({length: nextKey.end - nextKey.start}, (_, offset) => nextKey.start + offset)]
      }
    }
    return step
  }

  const stops = cursorStops(codePoints, from, target.typedUpTo)
  const steps: TypingStep[] = []
  // The text before the first key press: the document without the typed range. A document typed from the top starts
  // from an empty text, which is not a step.
  if (target.action !== 'type the document') steps.push(stepAt(from, false, target.action === 'change a value' ? 'the old value is selected and deleted' : 'before the first key press'))
  // The key press that goes wrong, in one replay in three: one of the keys that have a neighbor to slip to. A deletion
  // has no wrong key, since every key press of it is Backspace.
  const slippable = stops.map((_, index) => index).filter(index => (index > 0 || steps.length > 0) && wrongKeysFor(stops[index]!.key).length > 0)
  const slipAt = target.action !== 'delete an entry' && slippable.length > 0 && random.chance(0.33) ? random.pick(slippable) : -1
  stops.forEach((stop, index) => {
    if (index === slipAt) {
      const before = steps.at(-1)!
      const cursor = index === 0 ? from : stops[index - 1]!.cursor
      steps.push(wrongKeyStep(before, cursor, random.pick(wrongKeysFor(stop.key)), stop.key), {...before, key: 'Backspace'})
    }
    steps.push(stepAt(stop.cursor, false, stop.key))
  })
  if (target.commaMode === 'last') steps.push(stepAt(to, true, ','))
  // A key press that moves the cursor over a closer that the editor had typed changes no text.
  const distinct = steps.filter((step, index) => index === 0 || step.text !== steps[index - 1]!.text)
  if (target.action === 'delete an entry') {
    distinct.reverse()
    distinct.forEach((step, index) => { step.key = index === 0 ? 'before the first key press' : 'Backspace' })
  }
  return {finished: scanned.text, action: target.action, editor, comma: target.commaMode, target: target.description, steps: distinct}
}
