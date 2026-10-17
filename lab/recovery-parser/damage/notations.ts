// Tokens as another language or notation writes them: keys without quotes, single quotes, True and None, NaN, numbers
// in forms JSON lacks, values written as calls, placeholders and omission marks.
import {type Edit, insertAt, removeRange, replaceOneForOne} from '../edits.ts'
import type {Random} from '../random.ts'
import {type Container, type Entry, type Scan, type StringPart, type Value, hasOwnLine, indentationAt, isWordKey, lastOnLine} from '../scan.ts'
import type {Damage, KindDefinition, KindOptions} from './types.ts'

const textOf = (scanned: Scan, value: {start: number, end: number}) => scanned.codePoints.slice(value.start, value.end).join('')
// A string in other quotes reads as one word when its content holds nothing that ends a word: the quotes are in the
// class of most letters. With such a character in it, only a class for the quote keeps the string together.
const endsAWord = (part: StringPart) => /[\s,:{}[\]"\\]/.test(part.content)
// The key that a number stands under: its own, or the key of the member that holds its array, e.g. coordinates.
function nameOf(value: Value): string {
  for (let entry = value.entry; entry !== null; entry = entry.container.value.entry) if (entry.key !== null) return entry.key.content
  return ''
}
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
  const classFor = (parts: readonly StringPart[]) => parts.some(endsAWord) ? {needsClass: 'the apostrophe as a quote'} : {}
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
    const withBoth = changed.filter(hasBoth)
    const inBackticks = form === 'every but word keys' ? withBoth : []
    for (const part of changed) requote(part, inBackticks.includes(part) ? '`' : '\'')
    // The form text says how many of the requoted strings hold no apostrophe and how many hold both kinds of quote,
    // e.g. "every string without an apostrophe, but not the keys that are words, 5 of them, and 1 with both kinds of
    // quote, in backticks". The keys that are words are left as they are: another kind of the same combination takes
    // their quotes away in most samples, and in the others they stand in double quotes.
    const butNot = form === 'every' ? '' : ', but not the keys that are words'
    const without = changed.length - withBoth.length
    const how = form === 'every' ? 'in single quotes with \\\' for each apostrophe' : 'in backticks'
    const text = withBoth.length === 0 ? `every string${changed.length < considered.length ? ' without an apostrophe' : ''}${butNot}, ${changed.length} of them`
      : without === 0 ? `only the ${withBoth.length === 1 ? 'string' : `${withBoth.length} strings`} with both kinds of quote, ${how}`
      : `every string without an apostrophe${butNot}, ${without} of them, and ${withBoth.length} with both kinds of quote, ${how}`
    // A string in backticks holds a double quote, which ends a word, so the tables need the backtick as a quote for
    // it. That is another class than the apostrophe as a quote, which the strings in single quotes need when one of
    // them holds a character that ends a word.
    const apostrophe = classFor(changed.filter(part => !inBackticks.includes(part)))
    const backtick = 'the backtick as a quote'
    const classes: Pick<Damage, 'needsClass' | 'alsoNeedsClass'> = inBackticks.length === 0 ? apostrophe
      : apostrophe.needsClass === undefined ? {needsClass: backtick} : {...apostrophe, alsoNeedsClass: backtick}
    return {edits, unscoredKinds, form: text, reachable: 'yes', ...classes}
  }
  if (form === 'one member' && members.length > 0) {
    const entry = random.pick(members)
    requote(entry.key!)
    requote(stringOfValue(scanned, entry.value))
    return {edits, form: 'the key and the value of one member', reachable: 'yes', ...classFor([entry.key!, stringOfValue(scanned, entry.value)])}
  }
  if (values.length === 0) return undefined
  if (form === 'every value') {
    for (const part of values) requote(part)
    return {edits, form: `every string value, ${values.length} of them, while the keys keep their quotes`, reachable: 'yes', ...classFor(values)}
  }
  const value = random.pick(values)
  requote(value)
  return {edits, form: 'one string value', reachable: 'yes', ...classFor([value])}
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
  const classFor = (parts: readonly StringPart[]) => parts.some(endsAWord) ? {needsClass: 'the typographic quotes'} : {}
  const every = options.scope === 'every' || random.chance(0.75)
  if (every) return {edits: scanned.strings.flatMap(part => [curl(part.start), curl(part.end - 1)]), form: `every quote of the text, ${scanned.strings.length} strings`, reachable: 'yes', ...classFor(scanned.strings)}
  const members = scanned.entries.filter(entry => entry.key !== null && entry.value.type === 'string')
  if (members.length > 0 && random.chance(0.5)) {
    const entry = random.pick(members)
    const value = stringOfValue(scanned, entry.value)
    return {edits: [curl(entry.key!.start), curl(entry.key!.end - 1), curl(value.start), curl(value.end - 1)], form: 'the key and the value of one member', reachable: 'yes', ...classFor([entry.key!, value])}
  }
  const part = random.pick(scanned.strings)
  return {edits: [curl(part.start), curl(part.end - 1)], form: `one ${part.role}`, reachable: 'yes', ...classFor([part])}
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
      // One program wrote them all, so every literal of the text changes. The word is added in the literal's place and
      // has no label, as nil and undefined: the highlighter has no display kind for a word that is not JSON's, and
      // "literal" on a word would contradict "string" on a value without quotes.
      const words = form === 'Python' ? pythonWords : upperCaseWords
      return {edits: literals.map(literal => ({at: literal.start, remove: literal.word.length, insert: words[literal.word]!})), form: `${form === 'Python' ? 'True, False and None' : 'TRUE, FALSE and NULL'} for every literal, ${literals.length} of them`, reachable: 'yes'}
    }
    case 'undefined': {
      if (nulls.length === 0) return undefined
      const literal = random.pick(nulls)
      return {edits: [{at: literal.start, remove: 4, insert: 'undefined'}], form: 'undefined for one null', reachable: 'yes'}
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
    form: `${word} for ${others.length === 0 ? 'one number' : `the same key in ${others.length + 1} records`}`, reachable: 'yes',
  }
}

const readsAsJson = (content: string) => /^(true|false|null|-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?)$/.test(content)

// A string value without its quotes. Leading code points that read as the start of a JSON number or literal, e.g. the
// 1.4 of 1.4.2, are shown as a number by every parser before it can know better, so their display kind is not scored:
// samples.ts finds them with the parser as it is, see unscoredOf there.
function unquotedValue(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const {codePoints} = scanned
  const usable = (part: StringPart) => part.role === 'value' && part.entry !== null && part.content !== '' && !part.hasEscape && !/[",{}[\]\n\t]/.test(part.content)
    && !part.content.startsWith(' ') && !part.content.endsWith(' ') && !readsAsJson(part.content) && /[A-Za-z0-9]/.test(part.content)
  const words = scanned.strings.filter(part => usable(part) && !part.content.includes(' ') && (part.entry!.key !== null || !part.content.includes(':')))
  // Several words only as the last value on a line, where the line feed or the comma before it ends the value.
  const phrases = scanned.strings.filter(part => usable(part) && part.content.includes(' ') && !part.content.includes(':') && part.entry!.key !== null && hasOwnLine(codePoints, part.entry!))
  const unquote = (part: StringPart) => [removeRange(part.start, part.start + 1), removeRange(part.end - 1, part.end)]
  const flags = (parts: readonly StringPart[]): Pick<Damage, 'reachable' | 'needsClass'> => ({
    // Several words without a comma after them run to the line feed.
    reachable: parts.some(part => part.content.includes(' ') && part.entry!.commaAfter === -1) ? 'line rule' : 'yes',
    // A tokenizer that does not see the grammar reads a colon after a word as the colon after a key without quotes.
    ...(parts.some(part => part.content.includes(':')) ? {needsClass: 'a colon inside a value without quotes, which is not the colon after a key'} : {}),
  })
  if (options.scope === 'every') {
    const changed = [...words, ...phrases]
    if (changed.length === 0) return undefined
    return {edits: changed.flatMap(unquote), form: `every string value that can stand without quotes, ${changed.length} of them`, ...flags(changed)}
  }
  const severalWords = phrases.length > 0 && (words.length === 0 || random.chance(0.3))
  if (!severalWords && words.length === 0) return undefined
  const part = random.pick(severalWords ? phrases : words)
  return {edits: unquote(part), form: severalWords ? 'several words' : 'one word', ...flags([part])}
}

// A number in a form that JSON lacks, on a number where people write that form: a leading zero on a month or a file
// mode, a plus sign on an offset, hexadecimal digits on a color, separators in a large count, a unit on a size.
function numberFormat(random: Random, scanned: Scan): Damage | undefined {
  const numbers = scanned.numbers.map(number => ({...number, text: textOf(scanned, number), name: nameOf(number), isMemberValue: number.entry !== null && number.entry.key !== null}))
  if (numbers.length === 0) return undefined
  const named = (pattern: RegExp) => numbers.filter(number => pattern.test(number.name))
  const isWhole = (text: string) => /^[1-9][0-9]*$/.test(text)
  const padded = named(/^(month|day|hour|minute|mode|mask|code|zip|week)$/i).filter(number => isWhole(number.text) && number.text.length <= 4)
  const signed = named(/offset|delta|change|zoom|balance|discount|elevation|coordinates|^(lat|lon|x|y|v)$/i).filter(number => !number.text.startsWith('-') && !/[eE]/.test(number.text) && number.text !== '0')
  const zeroPoint = numbers.filter(number => /^-?0\.[0-9]/.test(number.text))
  const pointZero = numbers.filter(number => /\.0$/.test(number.text))
  const measures = named(/price|total|score|rate|ratio|opacity|elevation|balance|height|width|duration|area|^(v|w|h)$/i).filter(number => isWhole(number.text))
  const hexadecimal = named(/color|mask|flags/i).filter(number => isWhole(number.text) && number.text.length <= 9)
  // Counts that people write with separators, e.g. 30,000 or 1_400_000, and not an id, a port or a time stamp.
  const large = numbers.filter(number => isWhole(number.text) && number.text.length >= 5 && number.text.length <= 9 && !/id$|port|zip|code|line|status|created|manager|^(t|ts)$/i.test(number.name))
  const withFraction = numbers.filter(number => /^-?[0-9]+\.[0-9]+$/.test(number.text) && number.isMemberValue)
  const plain = (number: {text: string}) => /^[0-9]+(\.[0-9]+)?$/.test(number.text)
  // A number with the unit that its key suggests, or with the letter that marks a number's type in another language.
  const suffixed: [typeof numbers[number], string][] = [
    ...named(/fontSize|width|height$/i).filter(plain).map(number => [number, 'px'] as [typeof number, string]),
    ...named(/timeout|duration|period|delay|interval/i).filter(plain).map(number => [number, random.pick(['ms', 's'])] as [typeof number, string]),
    ...named(/opacity|rate|ratio|score|discount|percent/i).filter(plain).map(number => [number, '%'] as [typeof number, string]),
    ...named(/views|population|count|total|stock|qty|limit|^max/i).filter(number => isWhole(number.text)).map(number => [number, random.pick(['L', 'n'])] as [typeof number, string]),
    ...withFraction.filter(plain).slice(0, 2).map(number => [number, 'f'] as [typeof number, string]),
  ]
  const forms = [
    ['leading zero', padded.length > 0 ? 30 : 0], ['plus sign', signed.length > 0 ? 12 : 0], ['no digit before the point', zeroPoint.length > 0 ? 15 : 0],
    ['no digit after the point', measures.length + pointZero.length > 0 ? 8 : 0], ['hexadecimal', hexadecimal.length > 0 ? 8 : 0], ['digit groups', large.length > 0 ? 7 : 0],
    ['thousands commas', large.some(number => number.isMemberValue) ? 10 : 0], ['decimal comma', withFraction.length > 0 ? 5 : 0], ['suffix', suffixed.length > 0 ? 5 : 0],
  ] as const
  if (forms.every(([, weight]) => weight === 0)) return undefined
  const form = random.weighted(forms)
  // Where the groups of three digits start, counted from the right, e.g. [1, 4] for 1400000, and the number written with them.
  const groupStarts = (text: string) => Array.from({length: text.length}, (_, offset) => offset).filter(offset => offset > 0 && (text.length - offset) % 3 === 0)
  const grouped = (text: string, separator: string) => Array.from(text, (digit, offset) => groupStarts(text).includes(offset) ? separator + digit : digit).join('')
  switch (form) {
    case 'leading zero': {
      // The zeros that a fixed width gives, e.g. 03 for a month, or the zero of an octal file mode, e.g. 0755.
      const number = random.pick(padded)
      const zeros = '0'.repeat(number.text.length === 1 && random.chance(0.3) ? 2 : 1)
      return {
        edits: [insertAt(number.start, zeros)], form: `${zeros}${number.text} for ${number.text} under "${number.name}"`, reachable: 'yes',
        // The other repair is the string "03", so the digits' display kind is not scored.
        unscoredKinds: Array.from({length: number.text.length}, (_, offset) => number.start + offset),
      }
    }
    case 'plus sign': {
      const number = random.pick(signed)
      return {edits: [insertAt(number.start, '+')], form: `+${number.text} under "${number.name}"`, reachable: 'yes'}
    }
    case 'no digit before the point': {
      const number = random.pick(zeroPoint)
      const zero = number.start + Number(number.text.startsWith('-'))
      return {edits: [removeRange(zero, zero + 1)], form: `${number.text.replace('0.', '.')} for ${number.text}`, reachable: 'yes'}
    }
    case 'no digit after the point': {
      if (pointZero.length > 0 && (measures.length === 0 || random.chance(0.4))) {
        const number = random.pick(pointZero)
        return {edits: [removeRange(number.end - 1, number.end)], form: `${number.text.slice(0, -1)} for ${number.text}`, reachable: 'yes'}
      }
      const number = random.pick(measures)
      return {edits: [insertAt(number.end, '.')], form: `${number.text}. for ${number.text} under "${number.name}"`, reachable: 'yes'}
    }
    case 'hexadecimal': {
      const number = random.pick(hexadecimal)
      const digits = Number(number.text).toString(16)
      const written = `0x${random.chance(0.5) ? digits.toUpperCase() : digits}`
      return {edits: [{at: number.start, remove: number.text.length, insert: written}], form: `${written} for ${number.text} under "${number.name}"`, reachable: 'yes'}
    }
    case 'digit groups': {
      const number = random.pick(large)
      return {edits: groupStarts(number.text).map(offset => insertAt(number.start + offset, '_')), form: `${grouped(number.text, '_')} for ${number.text}`, reachable: 'yes'}
    }
    case 'thousands commas': {
      // Only as a member's value: inside an array [1,234] would be valid with another meaning.
      const number = random.pick(large.filter(candidate => candidate.isMemberValue))
      return {edits: groupStarts(number.text).map(offset => insertAt(number.start + offset, ',')), form: `${grouped(number.text, ',')} for ${number.text}`, reachable: 'yes'}
    }
    case 'decimal comma': {
      const number = random.pick(withFraction)
      const point = number.start + number.text.indexOf('.')
      // The comma stands for the point, and must be labeled before the digit after it is read.
      return {edits: [replaceOneForOne(point, ',')], unscoredKinds: [point], form: `${number.text.replace('.', ',')} for ${number.text}`, reachable: 'yes'}
    }
    case 'suffix': {
      const [number, suffix] = random.pick(suffixed)
      return {edits: [insertAt(number.end, suffix)], form: `${number.text}${suffix} under "${number.name}"`, reachable: 'yes'}
    }
  }
}

// A value written as a call, as the MongoDB shell and Python print values that JSON has no type for.
function callWrapper(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const wrap = (value: {start: number, end: number}, name: string): Edit[] => [insertAt(value.start, `${name}(`), insertAt(value.end, ')')]
  // Around a string, the name and the brackets read as words next to the string. Around a number, they and the number
  // read as one word, since the round brackets are in the class of most letters: only a class for them ends the name
  // before the number.
  const classFor = (values: readonly {type: string}[]) => values.some(value => value.type === 'number') ? {needsClass: 'the round brackets around a number'} : {}
  const members = scanned.entries.filter(entry => entry.key !== null)
  const objectIds = members.filter(entry => entry.value.type === 'string' && /^"[0-9a-f]{24}"$/.test(textOf(scanned, entry.value)))
  const dates = members.filter(entry => entry.value.type === 'string' && /^"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z"$/.test(textOf(scanned, entry.value)))
  const wholeNumbers = members.filter(entry => entry.value.type === 'number' && /^-?[0-9]+$/.test(textOf(scanned, entry.value)))
  const decimalStrings = members.filter(entry => entry.value.type === 'string' && /^"[0-9]+\.[0-9]+"$/.test(textOf(scanned, entry.value)))
  const fractions = scanned.numbers.filter(number => /^-?[0-9]+\.[0-9]+$/.test(textOf(scanned, number)))
  if (objectIds.length > 0 && options.scope !== 'Python print') {
    // A document copied from the MongoDB shell: the id always, and some of the dates and numbers. The old shell writes
    // NumberLong(15) and NumberDecimal("10.90"), and the new one Int32(15) and Decimal128('10.90').
    const newShell = options.scope === 'new shell'
    const edits = objectIds.flatMap(entry => wrap(entry.value, 'ObjectId'))
    const wrapped = objectIds.map(entry => entry.value)
    const dateName = newShell || random.chance(0.85) ? 'ISODate' : 'new Date'
    for (const entry of dates) if (random.chance(0.8)) { edits.push(...wrap(entry.value, dateName)); wrapped.push(entry.value) }
    const wholeName = newShell ? 'Int32' : random.pick(['NumberLong', 'NumberInt'])
    for (const entry of wholeNumbers) if (random.chance(0.35)) { edits.push(...wrap(entry.value, wholeName)); wrapped.push(entry.value) }
    for (const entry of decimalStrings) if (random.chance(0.7)) { edits.push(...wrap(entry.value, newShell ? 'Decimal128' : 'NumberDecimal')); wrapped.push(entry.value) }
    return {edits, form: `${wrapped.length} values as the ${newShell ? 'new ' : ''}MongoDB shell prints them`, reachable: 'yes', ...classFor(wrapped)}
  }
  // Numbers as NumPy prints them, each as a call. Only a Python print has them.
  if (options.scope !== 'Python print') return undefined
  const numbers = [...fractions.map(number => [number, 'np.float64'] as const), ...scanned.numbers.filter(number => /^-?[0-9]+$/.test(textOf(scanned, number))).map(number => [number, 'np.int64'] as const)]
  if (numbers.length === 0) return undefined
  const kind = random.pick(numbers)[1]
  const changed = numbers.filter(([, name]) => name === kind)
  const picked = changed.length <= 4 || random.chance(0.5) ? changed : random.shuffled(changed).slice(0, random.integer(1, 4))
  return {edits: picked.flatMap(([number, name]) => wrap(number, name)), form: `${picked.length} numbers as NumPy prints them, ${kind}(…)`, reachable: 'yes', ...classFor(picked.map(([number]) => number))}
}

// A Python tuple: round brackets around a short array of scalars, e.g. a coordinate.
function tuple(random: Random, scanned: Scan): Damage | undefined {
  const short = scanned.containers.filter(container => container.type === 'array' && container.entries.length >= 1 && container.entries.length <= 4 && !container.severalLines
    && container.entries.every(entry => entry.value.type === 'number'))
  if (short.length === 0) return undefined
  // The items of one list are all tuples or all lists, e.g. a list of coordinates. So the arrays that change are all
  // short arrays of the text, or one of them with its siblings, when every sibling is such an array.
  const siblingsOf = (container: Container) => container.parent?.type === 'array' ? container.parent.entries.map(entry => entry.value.container) : [container]
  const groups = short.map(siblingsOf).filter((group): group is Container[] => group.every(sibling => sibling !== null && short.includes(sibling)))
  if (groups.length === 0) return undefined
  const changed = random.chance(0.6) ? [...new Set(groups.flat())] : random.pick(groups)
  const edits: Edit[] = []
  for (const container of changed) {
    edits.push(replaceOneForOne(container.open, '('), replaceOneForOne(container.close, ')'))
    // Python writes a tuple of one item with a comma after it, which comes after the closing bracket of a call around
    // the item, e.g. (np.int64(80),).
    if (container.entries.length === 1) edits.push({...insertAt(container.entries[0]!.end, ','), rank: 1})
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
  return {edits: [{at: entry.value.start, remove: entry.value.end - entry.value.start, insert: placeholder}], form: `${placeholder} for a ${entry.value.type}`, reachable: 'yes'}
}

// Dots or a note where entries were left out, as documentation and printing functions write them.
function ellipsis(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const {codePoints} = scanned
  if (options.scope === 'Node depth') {
    // Node prints a container below the third level as [Object] or [Array], unless it is empty.
    const deep = scanned.containers.filter(container => container.depth === 4 && container.entries.length > 0)
    if (deep.length === 0) return undefined
    return {
      edits: deep.map(container => ({at: container.open, remove: container.close + 1 - container.open, insert: container.type === 'object' ? '[Object]' : '[Array]'})),
      form: `[Object] or [Array] for ${deep.length} container${deep.length > 1 ? 's' : ''} below the third level, as Node prints them`, reachable: 'yes',
    }
  }
  const filled = scanned.containers.filter(container => container.entries.length >= 1)
  if (filled.length === 0) return undefined
  const long = filled.filter(container => container.entries.length >= 3)
  const form = options.scope ?? random.weighted([['last entries', long.length > 0 ? 40 : 0], ['middle entries', long.length > 0 ? 15 : 0], ['all entries', 20], ['after the last entry', 25]] as const)
  const container: Container = random.pick(form === 'last entries' || form === 'middle entries' ? (long.length > 0 ? long : filled) : filled)
  const entries = container.entries
  // A marker that is a comment must end its line, so it only stands where the closer is on the next line.
  const endsLine = (lastEntry: Entry) => container.severalLines && lastOnLine(codePoints, lastEntry.end)
  // A count of items only for an array, as the functions that print one write it.
  const isArray = container.type === 'array'
  const marker = (count: number, mayComment: boolean) => random.weighted([
    ['...', 50], ['…', 10], ['// ...', mayComment ? 10 : 0],
    [random.pick(isArray ? [`// ... ${count} more item${count === 1 ? '' : 's'}`, '// more items here', '// etc.'] : ['// rest unchanged', '// etc.', '// more settings here']), mayComment ? 15 : 0],
    [`... ${count} more item${count === 1 ? '' : 's'}`, isArray ? 5 : 0], ['/* ... */', 5], ['# ...', mayComment ? 5 : 0],
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
      return {
        edits: [{at: entries[first]!.start, remove: entries[last]!.end - entries[first]!.start, insert: text}], form: `${text} for ${last - first + 1} entries in the middle of an ${container.type}`, reachable: 'yes',
      }
    }
    case 'all entries': {
      const text = random.weighted([['...', 6], ['…', 3], [' ... ', 1]])
      return {edits: [{at: entries[0]!.start, remove: entries.at(-1)!.end - entries[0]!.start, insert: text}], form: `${text.trim()} for every entry of an ${container.type}`, reachable: 'yes'}
    }
    case 'after the last entry': {
      const lastEntry = entries.at(-1)!
      const dots = random.chance(0.85) ? '...' : '…'
      const text = container.severalLines ? `,\n${indentationAt(codePoints, lastEntry.start)}${dots}` : `, ${dots}`
      // The comma comes before a comment that another kind adds at the same place.
      return {edits: [{...insertAt(lastEntry.end, text), rank: -1}], form: `${dots} after the last entry of an ${container.type}`, reachable: 'yes'}
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
    name: 'unquotedKey', family: 'other notation', origin: 'either', weight: 1.5,
    example: '{⏎  "host": "localhost",⏎  port: 8080⏎}',
    reachable: 'yes: where a key may come, a word up to the colon is the key. A key that starts with t, f or n, e.g. name, needs a display fix as long as the tokenizer has read no cell before it that valid JSON never reads: it then reads that letter from the state between as the start of true, false or null, by a cell that valid JSON reads, and the display table shows it as a literal. After such a cell, e.g. after the key port, tables can be in a state of their own, in which a word after a comma is a key',
    apply: unquotedKey,
  },
  {
    name: 'singleQuotedString', family: 'other notation', origin: 'either', weight: 1,
    example: '{"roles": [\'admin\', \'billing\'], "active": true}',
    reachable: 'yes for a parser that reads the apostrophe as a quote. The highlighter\'s classes lump the apostrophe with letters, so its tables read \'admin\' as one word, which is enough unless the string holds a space, a comma, a colon, a bracket, a quote or a backslash. A string that holds both kinds of quote stands in single quotes with \\\' in a Python print and in backticks in a Node print, and the tables then need the backtick as a quote',
    apply: singleQuotedString,
  },
  {
    name: 'curlyQuotes', family: 'other notation', origin: 'either', weight: 1.2,
    example: '{“name”: “Ada”, “age”: 36}',
    reachable: 'yes for a parser that reads “ and ” as quotes. As with single quotes, the tables read “Ada” as one word, and need a class when the string holds a character that ends a word',
    apply: curlyQuotes,
  },
  {
    name: 'nonBreakingSpace', family: 'other notation', origin: 'either', weight: 0.5,
    example: '{"name":\u00a0"Ada", "age": 36}',
    reachable: 'yes for a parser that reads U+00A0 as white space, which the highlighter\'s classes cannot',
    styles: [['indented', 60], ['spaced', 40]],
    apply: nonBreakingSpace,
  },
  {
    name: 'foreignLiteral', family: 'other notation', origin: 'either', weight: 2.8,
    example: '{"active": True, "manager": None}',
    reachable: 'yes: a word where a value may come, up to a comma, a closer or white space, is one value. The word has no label: it is not a JSON literal, and the highlighter has no display kind for it',
    margin: 16,
    apply: foreignLiteral,
  },
  {
    name: 'nonFiniteNumber', family: 'other notation', origin: 'output', weight: 1.5,
    example: '{"mean": NaN, "count": 0}',
    reachable: 'yes, as foreignLiteral',
    margin: 30,
    apply: nonFiniteNumber,
  },
  {
    name: 'unquotedValue', family: 'other notation', origin: 'file', weight: 0.9,
    example: '{⏎  "env": production,⏎  "port": 8080⏎}',
    reachable: 'yes: the value runs to the next comma or closer. line rule for several words that run to a line feed. Leading characters that read as a number or a literal, e.g. the 1.4 of 1.4.2 and the t of test, are shown as one by every parser, so their display kind is not scored. A colon inside the value, e.g. in a time, needs a tokenizer that knows that it is not reading a key',
    apply: unquotedValue,
  },
  {
    name: 'numberFormat', family: 'other notation', origin: 'file', weight: 1.5,
    example: '{"month": 03, "opacity": .5}',
    reachable: 'yes: digits, letters, +, . and _ up to the next comma, closer or white space are one value. In 1,400,000 the digits after a comma come where a key must come, so they continue the number. After a leading zero the digits\' display kind is not scored, since "03" as a string is as sensible',
    margin: 8,
    apply: numberFormat,
  },
  {
    name: 'callWrapper', family: 'other notation', origin: 'output', weight: 1,
    example: '{"_id": ObjectId("507f191e810c19729de860ea"), "qty": NumberLong(15)}',
    reachable: 'yes for a parser that skips a name and ( before a value and ) after it. Around a string the tables read them as words. Around a number they need a class for the round brackets, which are in the class of most letters. Alone it is a document of the MongoDB shell, and in a Python print it is a number as NumPy prints it',
    templates: ['databaseRecord'],
    margin: 110,
    apply: callWrapper,
  },
  {
    name: 'tuple', family: 'other notation', origin: 'output', weight: 0,
    example: '{\'point\': (12.5, 41.9)}',
    reachable: 'yes for a parser that reads ( and ) as brackets, which the highlighter\'s classes cannot. Only in a Python print',
    apply: tuple,
  },
  {
    name: 'templatePlaceholder', family: 'other notation', origin: 'either', weight: 0.2,
    example: '{"userId": {{user_id}}, "active": true}',
    reachable: 'yes: {{user_id}} opens two braces and closes two, and the other forms end at a comma, a closer or white space',
    margin: 30,
    apply: templatePlaceholder,
  },
  {
    name: 'ellipsis', family: 'other notation', origin: 'either', weight: 1.3,
    example: '{"items": [{"id": 1}, ...], "total": 40}',
    reachable: 'yes: the marker holds no quote and is skipped up to the next comma, closer or line feed. The [Object] and [Array] of Node open a bracket and close it',
    margin: 30,
    apply: ellipsis,
  },
  {
    name: 'stringConcatenation', family: 'other notation', origin: 'file', weight: 0.15,
    example: '{"msg": "request " + "completed"}',
    reachable: 'yes with a plus, and inside an array. no for two strings next to each other inside an object, where the second reads as the next key',
    margin: 30,
    apply: stringConcatenation,
  },
]
