// Tokens as another language or notation writes them: keys without quotes, single quotes, True and None, NaN, numbers
// in forms JSON lacks, values written as calls, placeholders and omission marks.
import {type Edit, insertAt, removeRange, replaceOneForOne} from '../edits.ts'
import type {Random} from '../random.ts'
import {type Container, type Entry, type Scan, type StringPart, type Value, hasOwnLine, indentationAt, isWordKey, lastOnLine} from '../scan.ts'
import type {Damage, KindDefinition, KindOptions} from './types.ts'

const textOf = (scanned: Scan, value: {start: number, end: number}) => scanned.codePoints.slice(value.start, value.end).join('')
const stringOfValue = (scanned: Scan, value: Value) => scanned.strings.find(part => part.start === value.start)!
// The positions, in the text, of the backslashes that escape a double quote inside a string.
function escapedQuotes(scanned: Scan, part: StringPart) {
  const positions: number[] = []
  for (let index = part.start + 1; index < part.end - 1; index++) {
    if (scanned.codePoints[index] !== '\\') continue
    if (scanned.codePoints[index + 1] === '"') positions.push(index)
    index += scanned.codePoints[index + 1] === 'u' ? 5 : 1
  }
  return positions
}

function unquotedKey(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const keys = scanned.strings.filter(part => part.role === 'key' && !part.hasEscape && isWordKey(part.content))
  if (keys.length === 0) return undefined
  const unquote = (parts: readonly StringPart[]) => parts.flatMap(part => [removeRange(part.start, part.start + 1), removeRange(part.end - 1, part.end)])
  const objects = scanned.containers.filter(container => container.type === 'object' && container.entries.filter(entry => keys.includes(entry.key!)).length >= 2)
  const form = options.scope ?? random.weighted([['one', 40], ['one object', objects.length > 0 ? 35 : 0], ['every', keys.length > 1 ? 25 : 0]] as const)
  if (form === 'every') return {edits: unquote(keys), form: `every key that is a word, ${keys.length} of them`, reachable: 'yes'}
  if (form === 'one object' && objects.length > 0) {
    const container = random.pick(objects)
    return {edits: unquote(container.entries.map(entry => entry.key!).filter(key => keys.includes(key))), form: 'every key of one object that is a word', reachable: 'yes'}
  }
  // The member that a person just typed, which is mostly the last of its object.
  const lastKeys = keys.filter(key => key.entry!.commaAfter === -1)
  const key = random.pick(lastKeys.length > 0 && random.chance(0.6) ? lastKeys : keys)
  return {edits: unquote([key]), form: `one key${lastKeys.includes(key) ? ', of the last member of its object' : ''}`, reachable: 'yes'}
}

function singleQuotedString(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  if (scanned.strings.length === 0) return undefined
  const plain = (part: StringPart) => !part.content.includes('\'') && escapedQuotes(scanned, part).length === 0
  const edits: Edit[] = []
  const unscoredKinds: number[] = []
  const requote = (part: StringPart, quote = '\'') => {
    edits.push(replaceOneForOne(part.start, quote), replaceOneForOne(part.end - 1, quote))
    // Inside other quotes a double quote needs no backslash. The quote that stays is part of an escape in the original.
    for (const backslash of escapedQuotes(scanned, part)) {
      edits.push(removeRange(backslash, backslash + 1))
      unscoredKinds.push(backslash + 1)
    }
    // And an apostrophe inside single quotes needs one, as Python prints it.
    if (quote === '\'') {
      for (let index = part.start + 1; index < part.end - 1; index++) if (scanned.codePoints[index] === '\'') edits.push(insertAt(index, '\\'))
    }
  }
  const needsClass = 'the apostrophe as a quote'
  const members = scanned.entries.filter(entry => entry.key !== null && entry.value.type === 'string' && plain(entry.key) && plain(stringOfValue(scanned, entry.value)))
  const values = scanned.strings.filter(part => part.role === 'value' && plain(part))
  const form = options.scope ?? random.weighted([['every', 45], ['one member', members.length > 0 ? 25 : 0], ['one value', values.length > 0 ? 10 : 0], ['every value', values.length > 1 ? 20 : 0]] as const)
  if (form === 'every' || form === 'every but word keys') {
    // As Python and Node print: a string that holds an apostrophe keeps its double quotes. One that holds both kinds
    // of quote gets single quotes and \' in Python, and backticks in Node.
    const considered = scanned.strings.filter(part => form === 'every' || part.role === 'value' || part.hasEscape || !isWordKey(part.content))
    const hasBoth = (part: StringPart) => part.content.includes('\'') && escapedQuotes(scanned, part).length > 0
    const changed = considered.filter(part => !part.content.includes('\'') || hasBoth(part))
    if (changed.length === 0) return undefined
    for (const part of changed) requote(part, hasBoth(part) && form === 'every but word keys' ? '`' : '\'')
    return {edits, unscoredKinds, form: `every string${form === 'every' ? '' : ' that keeps its quotes'}${changed.length < considered.length ? ' without an apostrophe' : ''}, ${changed.length} of them`, reachable: 'yes', needsClass}
  }
  if (form === 'one member' && members.length > 0) {
    const entry = random.pick(members)
    requote(entry.key!)
    requote(stringOfValue(scanned, entry.value))
    return {edits, form: 'the key and the value of one member', reachable: 'yes', needsClass}
  }
  if (values.length === 0) return undefined
  if (form === 'every value') {
    for (const part of values) requote(part)
    return {edits, form: `every string value, ${values.length} of them, while the keys keep their quotes`, reachable: 'yes', needsClass}
  }
  requote(random.pick(values))
  return {edits, form: 'one string value', reachable: 'yes', needsClass}
}

// The quotes that a word processor or a web page makes of straight quotes: an opening one at the start of the text and
// after a space, a tab, a line feed or an opening bracket, and a closing one after anything else.
function curlyQuotes(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  if (scanned.strings.length === 0) return undefined
  const {codePoints} = scanned
  const curl = (position: number) => {
    const before = codePoints[position - 1]
    return replaceOneForOne(position, before === undefined || ' \t\n([{'.includes(before) ? '“' : '”')
  }
  const needsClass = 'the typographic quotes'
  const every = options.scope === 'every' || random.chance(0.75)
  if (every) return {edits: scanned.strings.flatMap(part => [curl(part.start), curl(part.end - 1)]), form: `every quote of the text, ${scanned.strings.length} strings`, reachable: 'yes', needsClass}
  const members = scanned.entries.filter(entry => entry.key !== null && entry.value.type === 'string')
  if (members.length > 0 && random.chance(0.5)) {
    const entry = random.pick(members)
    const value = stringOfValue(scanned, entry.value)
    return {edits: [curl(entry.key!.start), curl(entry.key!.end - 1), curl(value.start), curl(value.end - 1)], form: 'the key and the value of one member', reachable: 'yes', needsClass}
  }
  const part = random.pick(scanned.strings)
  return {edits: [curl(part.start), curl(part.end - 1)], form: `one ${part.role}`, reachable: 'yes', needsClass}
}

// U+00A0 in place of a space between tokens, as text copied from a web page or an email has it.
function nonBreakingSpace(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const {codePoints} = scanned
  const inString = new Set<number>()
  for (const part of scanned.strings) for (let index = part.start; index < part.end; index++) inString.add(index)
  const spaces: number[] = []
  const indentation: number[] = []
  let lineStarted = false
  for (let index = 0; index < codePoints.length; index++) {
    const character = codePoints[index]!
    if (character === '\n') lineStarted = false
    else if (character !== ' ') lineStarted = true
    if (character !== ' ' || inString.has(index)) continue
    if (lineStarted) spaces.push(index)
    else indentation.push(index)
  }
  const needsClass = 'U+00A0 as white space'
  const form = options.scope ?? random.weighted([['one', spaces.length > 0 ? 40 : 0], ['indentation', indentation.length > 0 ? 35 : 0], ['every second of the indentation', indentation.length > 1 ? 25 : 0]] as const)
  if (form === 'indentation' && indentation.length > 0) return {edits: indentation.map(index => replaceOneForOne(index, '\u00a0')), form: 'every space of the indentation', reachable: 'yes', needsClass}
  if (form === 'every second of the indentation' && indentation.length > 1) {
    // What a web page's &nbsp; followed by a plain space gives.
    return {edits: indentation.filter(index => (index - lineStartOf(codePoints, index)) % 2 === 0).map(index => replaceOneForOne(index, '\u00a0')), form: 'every second space of the indentation', reachable: 'yes', needsClass}
  }
  if (spaces.length === 0) return undefined
  return {edits: [replaceOneForOne(random.pick(spaces), '\u00a0')], form: 'one space after a colon or a comma', reachable: 'yes', needsClass}
}
function lineStartOf(codePoints: readonly string[], position: number) {
  let start = position
  while (start > 0 && codePoints[start - 1] !== '\n') start--
  return start
}

const pythonWords: Record<string, string> = {true: 'True', false: 'False', null: 'None'}
const upperCaseWords: Record<string, string> = {true: 'TRUE', false: 'FALSE', null: 'NULL'}

function foreignLiteral(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const literals = scanned.literals.map(literal => ({...literal, word: textOf(scanned, literal)}))
  const nulls = literals.filter(literal => literal.word === 'null')
  const booleans = literals.filter(literal => literal.word !== 'null')
  // A member's value that is an object with something in it, for the text that JavaScript makes of an object.
  const objects = scanned.entries.filter(entry => entry.key !== null && entry.value.type === 'object' && entry.value.container!.entries.length > 0 && !textOf(scanned, entry.value).includes('\n'))
  // A text without a literal has only the last form, which is rare, so most such texts are left to another try.
  if (literals.length === 0 && options.scope === undefined && random.chance(0.8)) return undefined
  const form = options.scope ?? random.weighted([
    ['Python', literals.length > 0 ? 50 : 0], ['undefined', nulls.length > 0 ? 22 : 0], ['upper case', literals.length > 0 ? 9 : 0], ['nil', nulls.length > 0 ? 6 : 0],
    ['yes and no', booleans.length > 0 ? 6 : 0], ['object Object', objects.length > 0 ? 5 : 0],
  ] as const)
  switch (form) {
    case 'Python':
    case 'upper case': {
      if (literals.length === 0) return undefined
      // One program wrote them all, so every literal of the text changes. Each letter stands for a letter of the JSON word.
      const words = form === 'Python' ? pythonWords : upperCaseWords
      return {edits: literals.map(literal => replaceOneForOne(literal.start, words[literal.word]!)), form: `${form === 'Python' ? 'True, False and None' : 'TRUE, FALSE and NULL'} for every literal, ${literals.length} of them`, reachable: 'yes'}
    }
    case 'undefined': {
      if (nulls.length === 0) return undefined
      const literal = random.pick(nulls)
      return {edits: [{at: literal.start, remove: 4, insert: 'undefined'}], form: 'undefined for one null', reachable: 'yes', debatable: true}
    }
    case 'nil': {
      if (nulls.length === 0) return undefined
      const changed = random.chance(0.5) ? nulls : [random.pick(nulls)]
      return {edits: changed.map(literal => ({at: literal.start, remove: 4, insert: 'nil'})), form: `nil for ${changed.length === nulls.length ? 'every null' : 'one null'}`, reachable: 'yes'}
    }
    case 'yes and no': {
      if (booleans.length === 0) return undefined
      const words = random.chance(0.7) ? {true: 'yes', false: 'no'} : {true: 'on', false: 'off'}
      const changed = random.chance(0.6) ? booleans : [random.pick(booleans)]
      return {edits: changed.map(literal => ({at: literal.start, remove: literal.word.length, insert: words[literal.word as 'true' | 'false']})), form: `${words.true} and ${words.false} for ${changed.length === booleans.length ? 'every boolean' : 'one boolean'}`, reachable: 'yes'}
    }
    case 'object Object': {
      if (objects.length === 0) return undefined
      const entry = random.pick(objects)
      return {edits: [{at: entry.value.start, remove: entry.value.end - entry.value.start, insert: '[object Object]'}], form: '[object Object] for an object', reachable: 'yes'}
    }
    default:
      return undefined
  }
}

// NaN, Infinity and their spellings, where a measured number is.
function nonFiniteNumber(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const measured = scanned.numbers.filter(number => /[.eE]/.test(textOf(scanned, number)))
  const named = scanned.numbers.filter(number => number.entry?.key !== null && number.entry?.key !== undefined
    && /^(v|value|score|mean|ratio|rate|elevation|balance|price|total|durationMs|opacity|offset|w|h|area|discount|sampleRate)$/.test(number.entry.key.content))
  const candidates = measured.length > 0 ? measured : named
  if (candidates.length === 0) return undefined
  const number = random.pick(candidates)
  const pythonPrint = options.scope === 'Python print'
  const word = pythonPrint ? random.weighted([['nan', 6], ['inf', 2], ['-inf', 2]] as const)
    : random.weighted([['NaN', 55], ['Infinity', 15], ['-Infinity', 10], ['nan', 8], ['inf', 4], ['-inf', 4], ['+Inf', 2], ['-Inf', 2]] as const)
  // The same key in the other records of an array, as a column of measurements has it.
  const entry = number.entry
  const siblings: Value[] = []
  if (entry !== null && entry.key !== null && entry.container.value.entry !== null && entry.container.value.entry.container.type === 'array') {
    for (const record of entry.container.value.entry.container.entries) {
      const same = record.value.container?.entries.find(member => member.key?.content === entry.key!.content && member.value.type === 'number')
      if (same !== undefined && same.value !== number) siblings.push(same.value)
    }
  }
  const others = siblings.length > 0 && random.chance(0.4) ? random.shuffled(siblings).slice(0, random.integer(1, 3)) : []
  return {
    edits: [number, ...others].map(value => ({at: value.start, remove: value.end - value.start, insert: word})),
    form: `${word} for ${others.length === 0 ? 'one number' : `the same key in ${others.length + 1} records`}`, reachable: 'yes', debatable: true,
  }
}

// How many leading code points of a value without quotes read as the start of a JSON number or of true, false or null.
// A parser must label them before it can know that the value is a word, so their display kind is not scored.
function misleadingPrefix(content: string) {
  const number = /^-?(0|[1-9][0-9]*)?(\.[0-9]*)?([eE][+-]?[0-9]*)?/.exec(content)![0]
  if (number.length > 0 && number !== '-') return number.length
  for (const word of ['true', 'false', 'null']) {
    let shared = 0
    while (shared < word.length && content[shared] === word[shared]) shared++
    if (shared > 0) return shared
  }
  return 0
}
const readsAsJson = (content: string) => /^(true|false|null|-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?)$/.test(content)

function unquotedValue(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const {codePoints} = scanned
  const usable = (part: StringPart) => part.role === 'value' && part.entry !== null && part.content !== '' && !part.hasEscape && !/[",{}[\]\n\t]/.test(part.content)
    && !part.content.startsWith(' ') && !part.content.endsWith(' ') && !readsAsJson(part.content) && /[A-Za-z0-9]/.test(part.content)
  const words = scanned.strings.filter(part => usable(part) && !part.content.includes(' ') && (part.entry!.key !== null || !part.content.includes(':')))
  // Several words only as the last value on a line, where the line feed or the comma before it ends the value.
  const phrases = scanned.strings.filter(part => usable(part) && part.content.includes(' ') && !part.content.includes(':') && part.entry!.key !== null && hasOwnLine(codePoints, part.entry!))
  const unquote = (part: StringPart) => [removeRange(part.start, part.start + 1), removeRange(part.end - 1, part.end)]
  const unscored = (part: StringPart) => Array.from({length: misleadingPrefix(part.content)}, (_, offset) => part.start + 1 + offset)
  if (options.scope === 'every') {
    const changed = [...words, ...phrases]
    if (changed.length === 0) return undefined
    return {edits: changed.flatMap(unquote), unscoredKinds: changed.flatMap(unscored), form: `every string value that can stand without quotes, ${changed.length} of them`, reachable: 'yes'}
  }
  const severalWords = phrases.length > 0 && (words.length === 0 || random.chance(0.3))
  if (!severalWords && words.length === 0) return undefined
  const part = random.pick(severalWords ? phrases : words)
  const prefix = misleadingPrefix(part.content)
  return {
    edits: unquote(part), unscoredKinds: unscored(part),
    form: `${severalWords ? 'several words' : 'one word'}${prefix > 0 ? `, of which the first ${prefix} read as a number or a literal` : ''}`, reachable: 'yes',
  }
}

function numberFormat(random: Random, scanned: Scan): Damage | undefined {
  const numbers = scanned.numbers.map(number => ({...number, text: textOf(scanned, number), isMemberValue: number.entry !== null && number.entry.key !== null}))
  if (numbers.length === 0) return undefined
  const wholeNumbers = numbers.filter(number => /^[1-9][0-9]*$/.test(number.text))
  const notNegative = numbers.filter(number => !number.text.startsWith('-') && !/[eE]/.test(number.text))
  const zeroPoint = numbers.filter(number => /^-?0\.[0-9]/.test(number.text))
  const pointZero = numbers.filter(number => /\.0$/.test(number.text))
  // Numbers that people write with separators, e.g. 30,000 or 1_400_000, and not a timestamp of ten digits.
  const large = wholeNumbers.filter(number => number.text.length >= 4 && number.text.length <= 8)
  const withFraction = numbers.filter(number => /^-?[0-9]+\.[0-9]+$/.test(number.text))
  const form = random.weighted([
    ['leading zero', wholeNumbers.length > 0 ? 30 : 0], ['plus sign', notNegative.length > 0 ? 12 : 0], ['no digit before the point', zeroPoint.length > 0 ? 15 : 0],
    ['no digit after the point', wholeNumbers.length + pointZero.length > 0 ? 8 : 0], ['hexadecimal', wholeNumbers.length > 0 ? 8 : 0], ['digit groups', large.length > 0 ? 7 : 0],
    ['thousands commas', large.some(number => number.isMemberValue) ? 10 : 0], ['decimal comma', withFraction.some(number => number.isMemberValue) ? 5 : 0], ['suffix', 5],
  ] as const)
  // Where the groups of three digits start, counted from the right, e.g. [1, 4] for 1400000, and the number written with them.
  const groupStarts = (text: string) => Array.from({length: text.length}, (_, offset) => offset).filter(offset => offset > 0 && (text.length - offset) % 3 === 0)
  const grouped = (text: string, separator: string) => [...text].map((digit, offset) => groupStarts(text).includes(offset) ? separator + digit : digit).join('')
  switch (form) {
    case 'leading zero': {
      if (wholeNumbers.length === 0) return undefined
      // Short numbers get the zeros that a fixed width gives, e.g. 03 for a month or 007 for an id.
      const short = wholeNumbers.filter(number => number.text.length <= 3)
      const number = random.pick(short.length > 0 && random.chance(0.8) ? short : wholeNumbers)
      const zeros = '0'.repeat(number.text.length === 1 ? random.integer(1, 2) : 1)
      return {
        edits: [insertAt(number.start, zeros)], form: `${zeros}${number.text} for ${number.text}`, reachable: 'yes', debatable: true,
        // The other repair is the string "007", so the digits' display kind is not scored.
        unscoredKinds: Array.from({length: number.text.length}, (_, offset) => number.start + offset),
      }
    }
    case 'plus sign': {
      if (notNegative.length === 0) return undefined
      const number = random.pick(notNegative)
      return {edits: [insertAt(number.start, '+')], form: `+${number.text}`, reachable: 'yes'}
    }
    case 'no digit before the point': {
      if (zeroPoint.length === 0) return undefined
      const number = random.pick(zeroPoint)
      const zero = number.start + Number(number.text.startsWith('-'))
      return {edits: [removeRange(zero, zero + 1)], form: `${number.text.replace('0.', '.')} for ${number.text}`, reachable: 'yes'}
    }
    case 'no digit after the point': {
      if (pointZero.length > 0 && (wholeNumbers.length === 0 || random.chance(0.4))) {
        const number = random.pick(pointZero)
        return {edits: [removeRange(number.end - 1, number.end)], form: `${number.text.slice(0, -1)} for ${number.text}`, reachable: 'yes'}
      }
      if (wholeNumbers.length === 0) return undefined
      const number = random.pick(wholeNumbers)
      return {edits: [insertAt(number.end, '.')], form: `${number.text}. for ${number.text}`, reachable: 'yes'}
    }
    case 'hexadecimal': {
      const small = wholeNumbers.filter(number => number.text.length <= 9)
      if (small.length === 0) return undefined
      const number = random.pick(small)
      const digits = Number(number.text).toString(16)
      const written = `0x${random.chance(0.5) ? digits.toUpperCase() : digits}`
      return {edits: [{at: number.start, remove: number.text.length, insert: written}], form: `${written} for ${number.text}`, reachable: 'yes'}
    }
    case 'digit groups': {
      if (large.length === 0) return undefined
      const number = random.pick(large)
      return {edits: groupStarts(number.text).map(offset => insertAt(number.start + offset, '_')), form: `${grouped(number.text, '_')} for ${number.text}`, reachable: 'yes'}
    }
    case 'thousands commas': {
      // Only as a member's value: inside an array [1,234] would be valid with another meaning.
      const values = large.filter(number => number.isMemberValue)
      if (values.length === 0) return undefined
      const number = random.pick(values)
      return {edits: groupStarts(number.text).map(offset => insertAt(number.start + offset, ',')), form: `${grouped(number.text, ',')} for ${number.text}`, reachable: 'yes'}
    }
    case 'decimal comma': {
      const values = withFraction.filter(number => number.isMemberValue)
      if (values.length === 0) return undefined
      const number = random.pick(values)
      const point = number.start + number.text.indexOf('.')
      // The comma stands for the point, and must be labeled before the digit after it is read.
      return {edits: [replaceOneForOne(point, ',')], unscoredKinds: [point], form: `${number.text.replace('.', ',')} for ${number.text}`, reachable: 'yes'}
    }
    case 'suffix': {
      const plain = numbers.filter(candidate => /^-?[0-9]+(\.[0-9]+)?$/.test(candidate.text))
      if (plain.length === 0) return undefined
      const number = random.pick(plain)
      const isWhole = /^-?[0-9]+$/.test(number.text)
      const suffix = isWhole ? random.pick(['L', 'n', 'px', 'ms', '%']) : random.pick(['f', '%', 'px'])
      return {edits: [insertAt(number.end, suffix)], form: `${number.text}${suffix}`, reachable: 'yes'}
    }
  }
}

// A value written as a call, as the MongoDB shell and Python print values that JSON has no type for.
function callWrapper(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const wrap = (value: {start: number, end: number}, name: string): Edit[] => [insertAt(value.start, `${name}(`), insertAt(value.end, ')')]
  const members = scanned.entries.filter(entry => entry.key !== null)
  const objectIds = members.filter(entry => entry.value.type === 'string' && /^"[0-9a-f]{24}"$/.test(textOf(scanned, entry.value)))
  const dates = members.filter(entry => entry.value.type === 'string' && /^"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z"$/.test(textOf(scanned, entry.value)))
  const wholeNumbers = members.filter(entry => entry.value.type === 'number' && /^-?[0-9]+$/.test(textOf(scanned, entry.value)))
  const decimalStrings = members.filter(entry => entry.value.type === 'string' && /^"[0-9]+\.[0-9]+"$/.test(textOf(scanned, entry.value)))
  const fractions = scanned.numbers.filter(number => /^-?[0-9]+\.[0-9]+$/.test(textOf(scanned, number)))
  const needsClass = 'the round brackets'
  if (objectIds.length > 0 && options.scope !== 'Python print') {
    // A document copied from the MongoDB shell: the id always, and some of the dates and numbers.
    const edits = objectIds.flatMap(entry => wrap(entry.value, 'ObjectId'))
    let count = objectIds.length
    const dateName = random.chance(0.85) ? 'ISODate' : 'new Date'
    for (const entry of dates) if (random.chance(0.8)) { edits.push(...wrap(entry.value, dateName)); count++ }
    const longName = random.pick(['NumberLong', 'NumberInt'])
    for (const entry of wholeNumbers) if (random.chance(0.35)) { edits.push(...wrap(entry.value, longName)); count++ }
    for (const entry of decimalStrings) if (random.chance(0.7)) { edits.push(...wrap(entry.value, random.pick(['NumberDecimal', 'Decimal128']))); count++ }
    return {edits, form: `${count} values as the MongoDB shell prints them`, reachable: 'yes', needsClass, debatable: true}
  }
  // Numbers as NumPy prints them, each as a call. Only a Python print has them.
  if (options.scope !== 'Python print') return undefined
  const numbers = [...fractions.map(number => [number, 'np.float64'] as const), ...scanned.numbers.filter(number => /^-?[0-9]+$/.test(textOf(scanned, number))).map(number => [number, 'np.int64'] as const)]
  if (numbers.length === 0) return undefined
  const kind = random.pick(numbers)[1]
  const changed = numbers.filter(([, name]) => name === kind)
  const picked = changed.length <= 4 || random.chance(0.5) ? changed : random.shuffled(changed).slice(0, random.integer(1, 4))
  return {edits: picked.flatMap(([number, name]) => wrap(number, name)), form: `${picked.length} numbers as NumPy prints them, ${kind}(…)`, reachable: 'yes', needsClass, debatable: true}
}

// A Python tuple: round brackets around a short array of scalars, e.g. a coordinate.
function tuple(random: Random, scanned: Scan): Damage | undefined {
  const short = scanned.containers.filter(container => container.type === 'array' && container.entries.length >= 1 && container.entries.length <= 4 && !container.severalLines
    && container.entries.every(entry => entry.value.type === 'number'))
  if (short.length === 0) return undefined
  const changed = random.chance(0.6) ? short : [random.pick(short)]
  const edits: Edit[] = []
  for (const container of changed) {
    edits.push(replaceOneForOne(container.open, '('), replaceOneForOne(container.close, ')'))
    // Python writes a tuple of one item with a comma after it.
    if (container.entries.length === 1) edits.push(insertAt(container.entries[0]!.end, ','))
  }
  return {edits, form: `${changed.length} short array${changed.length > 1 ? 's' : ''} of numbers`, reachable: 'yes', needsClass: 'the round brackets as brackets'}
}

// A value that is still a placeholder of a template.
function templatePlaceholder(random: Random, scanned: Scan): Damage | undefined {
  const members = scanned.entries.filter(entry => entry.key !== null && entry.value.container === null && isWordKey(entry.key.content))
  if (members.length === 0) return undefined
  const entry = random.pick(members)
  const key = entry.key!.content
  const snake = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
  const placeholder = random.weighted([
    [`{{${snake}}}`, 30], [`{{ ${snake} }}`, 15], [`\${${snake.toUpperCase()}}`, 20], [`<${snake}>`, 15], [entry.value.type === 'number' ? '%d' : '%s', 10], [`$${key}`, 10],
  ])
  return {edits: [{at: entry.value.start, remove: entry.value.end - entry.value.start, insert: placeholder}], form: `${placeholder} for a ${entry.value.type}`, reachable: 'yes', debatable: true}
}

// Dots or a note where entries were left out, as documentation and printing functions write them.
function ellipsis(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const {codePoints} = scanned
  const filled = scanned.containers.filter(container => container.entries.length >= 1)
  if (filled.length === 0) return undefined
  const long = filled.filter(container => container.entries.length >= 3)
  const form = options.scope ?? random.weighted([['last entries', long.length > 0 ? 40 : 0], ['middle entries', long.length > 0 ? 15 : 0], ['all entries', 20], ['after the last entry', 25]] as const)
  const container: Container = random.pick(form === 'last entries' || form === 'middle entries' ? (long.length > 0 ? long : filled) : filled)
  const entries = container.entries
  // A marker that is a comment must end its line, so it only stands where the closer is on the next line.
  const endsLine = (lastEntry: Entry) => container.severalLines && lastOnLine(codePoints, lastEntry.end)
  const marker = (count: number, mayComment: boolean) => random.weighted([
    ['...', 50], ['…', 10], ['// ...', mayComment ? 10 : 0], [random.pick([`// ... ${count} more items`, '// more items here', '// rest unchanged', '// etc.']), mayComment ? 15 : 0],
    [`... ${count} more items`, 5], ['/* ... */', 5], ['# ...', mayComment ? 5 : 0],
  ])
  switch (form) {
    case 'last entries': {
      if (entries.length < 2) return undefined
      const first = random.integer(1, entries.length - 1)
      const text = marker(entries.length - first, endsLine(entries.at(-1)!))
      return {edits: [{at: entries[first]!.start, remove: entries.at(-1)!.end - entries[first]!.start, insert: text}], form: `${text} for the last ${entries.length - first} entries of an ${container.type}`, reachable: 'yes'}
    }
    case 'middle entries': {
      if (entries.length < 3) return undefined
      const first = random.integer(1, entries.length - 2)
      const last = random.integer(first, entries.length - 2)
      const text = marker(last - first + 1, false)
      return {edits: [{at: entries[first]!.start, remove: entries[last]!.end - entries[first]!.start, insert: text}], form: `${text} for ${last - first + 1} entries in the middle of an ${container.type}`, reachable: 'yes'}
    }
    case 'all entries': {
      const text = random.weighted([['...', 6], ['…', 3], [' ... ', 1]])
      return {edits: [{at: entries[0]!.start, remove: entries.at(-1)!.end - entries[0]!.start, insert: text}], form: `${text.trim()} for every entry of an ${container.type}`, reachable: 'yes'}
    }
    case 'after the last entry': {
      const lastEntry = entries.at(-1)!
      const dots = random.chance(0.85) ? '...' : '…'
      const text = container.severalLines ? `,\n${indentationAt(codePoints, lastEntry.start)}${dots}` : `, ${dots}`
      return {edits: [insertAt(lastEntry.end, text)], form: `${dots} after the last entry of an ${container.type}`, reachable: 'yes'}
    }
    default:
      return undefined
  }
}

// A long string written as two strings, joined by + as in JavaScript or by nothing as in Python and C.
function stringConcatenation(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const long = scanned.strings.filter(part => part.role === 'value' && part.entry !== null && part.end - part.start >= 32)
  if (long.length === 0) return undefined
  const part = random.pick(long)
  // A split after a space near the middle, and not next to a backslash.
  const spaces: number[] = []
  for (let index = part.start + 8; index < part.end - 8; index++) {
    if (codePoints[index] === ' ' && codePoints[index - 1] !== '\\' && codePoints[index - 1] !== ' ') spaces.push(index + 1)
  }
  if (spaces.length === 0) return undefined
  const at = random.pick(spaces)
  const withPlus = random.chance(0.8)
  const onNextLine = withPlus && hasOwnLine(codePoints, part.entry!) && random.chance(0.5)
  const joint = !withPlus ? '" "' : onNextLine ? `" +\n${indentationAt(codePoints, part.start)}  "` : '" + "'
  return {
    edits: [insertAt(at, joint)],
    form: `${withPlus ? `joined by +${onNextLine ? ' over two lines' : ''}` : 'two strings next to each other'}, in an ${part.entry!.container.type}`,
    // Without the plus, the second string reads as the next key inside an object, as after a missing comma.
    reachable: withPlus || part.entry!.container.type === 'array' ? 'yes' : 'no',
  }
}

export const notationKinds: KindDefinition[] = [
  {
    name: 'unquotedKey', family: 'other notation', weight: 1.5,
    example: '{⏎  "host": "localhost",⏎  port: 8080⏎}',
    reachable: 'yes: where a key may come, a word up to the colon is the key',
    apply: unquotedKey,
  },
  {
    name: 'singleQuotedString', family: 'other notation', weight: 1,
    example: '{"roles": [\'admin\', \'billing\'], "active": true}',
    reachable: 'yes for a parser that reads the apostrophe as a quote, which the highlighter\'s classes cannot: the apostrophe is in the class of most letters',
    apply: singleQuotedString,
  },
  {
    name: 'curlyQuotes', family: 'other notation', weight: 1.2,
    example: '{“name”: “Ada”, “age”: 36}',
    reachable: 'yes for a parser that reads “ and ” as quotes, which the highlighter\'s classes cannot',
    apply: curlyQuotes,
  },
  {
    name: 'nonBreakingSpace', family: 'other notation', weight: 0.5,
    example: '{"name":\u00a0"Ada", "age": 36}',
    reachable: 'yes for a parser that reads U+00A0 as white space, which the highlighter\'s classes cannot',
    styles: [['indented', 60], ['spaced', 40]],
    apply: nonBreakingSpace,
  },
  {
    name: 'foreignLiteral', family: 'other notation', weight: 2.8,
    example: '{"active": True, "manager": None}',
    reachable: 'yes: a word where a value may come, up to a comma, a closer or white space, is one value',
    margin: 16,
    apply: foreignLiteral,
  },
  {
    name: 'nonFiniteNumber', family: 'other notation', weight: 1.5,
    example: '{"mean": NaN, "count": 0}',
    reachable: 'yes, as foreignLiteral. The word itself has no label, since it stands for a number, for null or for a string',
    margin: 30,
    apply: nonFiniteNumber,
  },
  {
    name: 'unquotedValue', family: 'other notation', weight: 0.9,
    example: '{⏎  "env": production,⏎  "port": 8080⏎}',
    reachable: 'yes: the value runs to the next comma, closer or line feed. Leading characters that read as a number or a literal, e.g. the 1.4 of 1.4.2, are not scored',
    apply: unquotedValue,
  },
  {
    name: 'numberFormat', family: 'other notation', weight: 1.5,
    example: '{"month": 03, "opacity": .5}',
    reachable: 'yes: digits, letters, +, . and _ up to the next comma, closer or white space are one value. In 1,400,000 the digits after a comma come where a key must come, so they continue the number',
    margin: 8,
    apply: numberFormat,
  },
  {
    name: 'callWrapper', family: 'other notation', weight: 1,
    example: '{"_id": ObjectId("507f191e810c19729de860ea"), "qty": NumberLong(15)}',
    reachable: 'yes for a parser that skips a name and ( before a value and ) after it. The round brackets are in the class of most letters. Alone it is a document of the MongoDB shell, and in a Python print it is a number as NumPy prints it',
    templates: ['databaseRecord'],
    margin: 110,
    apply: callWrapper,
  },
  {
    name: 'tuple', family: 'other notation', weight: 0,
    example: '{\'point\': (12.5, 41.9)}',
    reachable: 'yes for a parser that reads ( and ) as brackets, which the highlighter\'s classes cannot. Only in a Python print',
    apply: tuple,
  },
  {
    name: 'templatePlaceholder', family: 'other notation', weight: 0.2,
    example: '{"userId": {{user_id}}, "active": true}',
    reachable: 'yes: {{user_id}} opens two braces and closes two, and the other forms end at a comma, a closer or white space',
    margin: 30,
    apply: templatePlaceholder,
  },
  {
    name: 'ellipsis', family: 'other notation', weight: 1.3,
    example: '{"items": [{"id": 1}, ...], "total": 40}',
    reachable: 'yes: the marker holds no bracket and no quote, and is skipped up to the next comma, closer or line feed',
    margin: 30,
    apply: ellipsis,
  },
  {
    name: 'stringConcatenation', family: 'other notation', weight: 0.15,
    example: '{"msg": "request " + "completed"}',
    reachable: 'yes with a plus, and inside an array. no for two strings next to each other inside an object, where the second reads as the next key',
    margin: 30,
    apply: stringConcatenation,
  },
]
