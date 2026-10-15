// Half-typed texts: the original without what a person hasn't typed yet, or has just deleted. Every edit here only
// removes code points, so every code point of the broken text has a label.
import {type Edit, removeRange} from '../edits.ts'
import type {Random} from '../random.ts'
import {type Entry, type Scan, type StringPart, hasOwnLine, lastOnLine, nextToken} from '../scan.ts'
import type {Damage, KindDefinition, Reachable} from './types.ts'

// A place to cut a string's content: after `typed` of its code points, moved out of an escape such as \n or é,
// which a person types in one go. One cut in ten that lands inside an escape stays there.
function cutInside(random: Random, codePoints: readonly string[], part: StringPart, minimumTyped = 0) {
  const contentLength = part.end - part.start - 2
  if (contentLength < minimumTyped) return undefined
  const cut = part.start + 1 + random.integer(minimumTyped, contentLength)
  if (random.chance(0.1)) return cut
  for (let index = part.start + 1; index < cut; index++) {
    if (codePoints[index] !== '\\') continue
    const escapeEnd = index + (codePoints[index + 1] === 'u' ? 6 : 2)
    if (cut < escapeEnd) return index
    index = escapeEnd - 1
  }
  return cut
}

// What comes after an entry is removed up to `from`: 'closer' when the entry was the last, otherwise the next entry.
const entryEndWithComma = (entry: Entry) => entry.commaAfter === -1 ? entry.end : entry.commaAfter + 1
const hasLineFeedBetween = (codePoints: readonly string[], from: number, to: number) => codePoints.slice(from, to).includes('\n')

function openStringAtLineEnd(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const lineEntries = scanned.entries.filter(entry => hasOwnLine(codePoints, entry))
  const keys = lineEntries.filter(entry => entry.key !== null)
  const values = lineEntries.filter(entry => entry.value.type === 'string')
  const stringOf = (entry: Entry) => scanned.strings.find(part => part.start === entry.value.start)!
  const typedOver = random.chance(0.25)
  if (typedOver && values.length > 0) {
    // The value was selected with its quotes and is being typed again, so the comma after it is still there.
    const entry = random.pick(values)
    const part = stringOf(entry)
    const cut = cutInside(random, codePoints, part)
    if (cut === undefined) return undefined
    return {
      edits: [removeRange(cut, part.end)],
      form: `a value typed over${entry.commaAfter === -1 ? '' : ', its comma stays'}`,
      reachable: 'line rule',
      // The comma is inside the open string, which no reading can tell from the string's content.
      unscoredKinds: entry.commaAfter === -1 ? [] : [entry.commaAfter],
    }
  }
  const inKey = keys.length > 0 && (values.length === 0 || random.chance(0.6))
  if (!inKey && values.length === 0) return undefined
  // Most new members have a short value, which is not typed yet either way.
  const shortKeys = keys.filter(entry => entry.value.container === null)
  const entry = inKey ? random.pick(shortKeys.length > 0 && random.chance(0.8) ? shortKeys : keys) : random.pick(values)
  const part = inKey ? entry.key! : stringOf(entry)
  const cut = cutInside(random, codePoints, part)
  if (cut === undefined) return undefined
  return {
    edits: [removeRange(cut, entryEndWithComma(entry))],
    form: `a new entry, cut in its ${inKey ? 'key' : 'value'}, ${entry.commaAfter === -1 ? 'a closer follows' : 'an entry follows'}`,
    reachable: 'line rule',
  }
}

function openStringMidLine(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const stringOf = (entry: Entry) => scanned.strings.find(part => part.start === entry.value.start)!
  // Entries with another entry after them on the same line.
  const beforeAnother = scanned.entries.filter(entry => entry.commaAfter !== -1 && !lastOnLine(codePoints, entry.commaAfter + 1) && (entry.key !== null || entry.value.type === 'string'))
  // Last entries of a container whose closer is on the same line.
  const beforeCloser = scanned.entries.filter(entry => entry.commaAfter === -1 && !hasLineFeedBetween(codePoints, entry.end, entry.container.close) && entry.value.type === 'string')
  // Keys whose colon and value stay.
  const keys = scanned.entries.filter(entry => entry.key !== null && entry.key.end - entry.key.start > 2)
  const place = random.weighted([['another entry', beforeAnother.length > 0 ? 50 : 0], ['closer', beforeCloser.length > 0 ? 40 : 0], ['key', keys.length > 0 ? 10 : 0]] as const)
  if (place === 'another entry') {
    if (beforeAnother.length === 0) return undefined
    const entry = random.pick(beforeAnother)
    const inValue = entry.value.type === 'string' && (entry.key === null || random.chance(0.5))
    const part = inValue ? stringOf(entry) : entry.key!
    const cut = cutInside(random, codePoints, part)
    if (cut === undefined) return undefined
    if (inValue && random.chance(0.3)) return {edits: [removeRange(cut, part.end)], form: 'a value typed over, more entries follow on the line', reachable: 'no'}
    // The comma and the space that will join the new entry to the next one are typed last.
    const next = entry.container.entries[entry.index + 1]!
    const end = random.chance(0.6) ? next.start : entry.commaAfter + 1
    return {edits: [removeRange(cut, end)], form: `a new entry, cut in its ${inValue ? 'value' : 'key'}, more entries follow on the line`, reachable: 'no'}
  }
  if (place === 'closer') {
    if (beforeCloser.length === 0) return undefined
    const part = stringOf(random.pick(beforeCloser))
    const cut = cutInside(random, codePoints, part)
    if (cut === undefined) return undefined
    return {edits: [removeRange(cut, part.end)], form: 'the last value of a one-line container, only closers follow on the line', reachable: 'no'}
  }
  if (keys.length === 0) return undefined
  const key = random.pick(keys).key!
  const cut = cutInside(random, codePoints, key, 1)
  if (cut === undefined) return undefined
  return {edits: [removeRange(cut, key.end)], form: 'a key without its closing quote, its colon and value stay', reachable: 'no'}
}

function keyWithoutColon(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const members = scanned.entries.filter(entry => entry.key !== null)
  if (members.length === 0) return undefined
  const last = members.filter(entry => entry.commaAfter === -1)
  const notLast = members.filter(entry => entry.commaAfter !== -1)
  const place = random.weighted([['closer', last.length > 0 ? 55 : 0], ['key', notLast.length > 0 ? 35 : 0], ['comma', notLast.length > 0 ? 10 : 0]] as const)
  const entry = random.pick(place === 'closer' ? last : notLast)
  const key = entry.key!
  const edits: Edit[] = []
  // In half of the texts the key is not typed to its end either. An auto-closing editor keeps its closing quote.
  const contentLength = key.end - key.start - 2
  let keyForm = 'a whole key'
  if (!key.hasEscape && contentLength > 0 && random.chance(0.5)) {
    const removed = random.integer(1, contentLength)
    edits.push(removeRange(key.end - 1 - removed, key.end - 1))
    keyForm = removed === contentLength ? 'an empty key' : 'a part of a key'
  }
  let reachable: Reachable = 'yes'
  if (place === 'key') {
    edits.push(removeRange(key.end, entry.commaAfter + 1))
    // A string after a key is also what a forgotten colon looks like, and only a line feed between the two tells them apart.
    reachable = hasLineFeedBetween(codePoints, entry.commaAfter + 1, entry.container.entries[entry.index + 1]!.start) ? 'line rule' : 'no'
  } else {
    edits.push(removeRange(key.end, entry.end))
  }
  const follows = place === 'closer' ? 'the closer follows' : place === 'comma' ? 'its comma stays' : `the next key follows ${reachable === 'line rule' ? 'on the next line' : 'on the same line'}`
  return {edits, form: `${keyForm}, ${follows}`, reachable}
}

function colonWithoutValue(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const members = scanned.entries.filter(entry => entry.key !== null)
  if (members.length === 0) return undefined
  const last = members.filter(entry => entry.commaAfter === -1)
  const notLast = members.filter(entry => entry.commaAfter !== -1)
  const place = random.weighted([['comma', notLast.length > 0 ? 40 : 0], ['closer', last.length > 0 ? 35 : 0], ['key', notLast.length > 0 ? 25 : 0]] as const)
  const pool = place === 'closer' ? last : notLast
  // Mostly a scalar or a string: a container is a value too, but people rarely delete one whole.
  const short = pool.filter(entry => entry.value.container === null)
  const entry = random.pick(short.length > 0 && random.chance(0.85) ? short : pool)
  // The space after the colon stays in half of the texts.
  const from = random.chance(0.5) ? entry.value.start : entry.colon + 1
  let reachable: Reachable = 'yes'
  let follows = place === 'comma' ? 'its comma stays' : 'the closer follows'
  let to = entry.value.end
  if (place === 'key') {
    to = entry.commaAfter + 1
    // A string after a colon is what valid JSON looks like, so only "a line feed came after the colon" shows that the
    // value is missing.
    const onNextLine = hasLineFeedBetween(codePoints, to, entry.container.entries[entry.index + 1]!.start)
    reachable = onNextLine ? 'line rule' : 'no'
    follows = `the next key follows ${onNextLine ? 'on the next line' : 'on the same line'}`
  }
  return {edits: [removeRange(from, to)], form: `${from === entry.value.start ? 'the space after the colon stays' : 'nothing after the colon'}, ${follows}`, reachable}
}

function partialLiteral(random: Random, scanned: Scan): Damage | undefined {
  if (scanned.literals.length === 0) return undefined
  const {codePoints} = scanned
  const literal = random.pick(scanned.literals)
  const typed = random.integer(1, literal.end - literal.start - 1)
  const entry = literal.entry
  // The comma after the entry is typed after the entry, so in some texts it is missing too.
  const withoutComma = entry !== null && entry.commaAfter !== -1 && nextToken(codePoints, entry.commaAfter + 1) > entry.commaAfter + 1 && random.chance(0.25)
  return {
    edits: [removeRange(literal.start + typed, withoutComma ? entry.commaAfter + 1 : literal.end)],
    form: `${codePoints.slice(literal.start, literal.start + typed).join('')} of ${codePoints.slice(literal.start, literal.end).join('')}${withoutComma ? ', its comma is missing too' : ''}`,
    reachable: 'yes',
  }
}

function partialNumber(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  // The cuts that leave no number: after the minus sign, after the decimal point, after e or E, after the exponent's sign.
  const cuts: [position: number, numberEnd: number, place: string, weight: number][] = []
  for (const number of scanned.numbers) {
    for (let index = number.start; index < number.end - 1; index++) {
      const character = codePoints[index]!
      if (character === '-' && index === number.start) cuts.push([index + 1, number.end, 'after the minus sign', 30])
      else if (character === '.') cuts.push([index + 1, number.end, 'after the decimal point', 60])
      else if (character === 'e' || character === 'E') cuts.push([index + 1, number.end, 'after the exponent letter', 6])
      else if (character === '+' || character === '-') cuts.push([index + 1, number.end, 'after the exponent sign', 4])
    }
  }
  if (cuts.length === 0) return undefined
  const places = [...new Set(cuts.map(cut => cut[2]))]
  const place = random.weighted(places.map(name => [name, cuts.find(cut => cut[2] === name)![3]] as const))
  const [position, numberEnd] = random.pick(cuts.filter(cut => cut[2] === place))
  return {edits: [removeRange(position, numberEnd)], form: place, reachable: 'yes'}
}

export const halfTypedKinds: KindDefinition[] = [
  {
    name: 'openStringAtLineEnd', family: 'half typed', weight: 5,
    example: '{⏎  "name": "tiny-glob",⏎  "pri⏎}',
    reachable: 'line rule: a JSON string holds no raw line feed, so "a string ends at the line feed" is sound. A comma that ends up inside the open string is not scored',
    styles: [['indented', 80], ['tabbed', 20]],
    apply: openStringAtLineEnd,
  },
  {
    name: 'openStringMidLine', family: 'half typed', weight: 1.6,
    example: '{"email": "ada@example.com, "role": "admin"}',
    reachable: 'no: the open string ends at the next quote, which opens the next string in the original, and every later quote is read in the opposite role',
    apply: openStringMidLine,
  },
  {
    name: 'keyWithoutColon', family: 'half typed', weight: 3.2,
    example: '{⏎  "strict": true,⏎  "tar"⏎}',
    reachable: 'yes when a closer or a comma follows. line rule when the next key follows on the next line. no when it follows on the same line, where the text reads as a forgotten colon',
    apply: keyWithoutColon,
  },
  {
    name: 'colonWithoutValue', family: 'half typed', weight: 3.5,
    example: '{⏎  "version": ,⏎  "license": "MIT"⏎}',
    reachable: 'yes when a comma or a closer follows. line rule when the next key follows on the next line. no when it follows on the same line, where it reads as the value',
    apply: colonWithoutValue,
  },
  {
    name: 'partialLiteral', family: 'half typed', weight: 1.2,
    example: '{"paid": tru, "currency": "EUR"}',
    reachable: 'yes: the typed letters are literal characters in the original too, and what follows is read as what it is',
    apply: partialLiteral,
  },
  {
    name: 'partialNumber', family: 'half typed', weight: 0.8,
    example: '{"lat": 59., "lon": 10.75}',
    reachable: 'yes, as partialLiteral',
    templates: ['userRecord', 'logEvent', 'settings', 'order', 'mapFeature', 'sensorReadings', 'serviceConfig', 'apiResponse', 'databaseRecord', 'numberGrid', 'tree', 'scalar'],
    apply: partialNumber,
  },
]
