// A value as another notation writes it: a string without quotes, True and null, a number with a unit or a leading
// zero, a date with slashes, a placeholder of a template, quotes that are not TOML's, and other brackets around a list.
import {type Edit, insertAt, removeRange, replaceOneForOne} from '../edits.ts'
import type {Random} from '../random.ts'
import {runTableParser} from '../table-parser.ts'
import {chooseForm} from './assignment.ts'
import {type Scan, type StringPart, type Value, contentOf, lastOnLine, textOf} from './scan.ts'
import type {Damage, KindDefinition} from './types.ts'

// Whether a text is a whole value for the tables, e.g. 8080, true, 2024-01-01 or "a".
export const isValue = (text: string) => runTableParser(`a = ${text}\n`).valid

const replaceValue = (value: Value, text: string): Edit => ({at: value.start, remove: value.end - value.start, insert: text})

// The strings that can lose their quotes: on one line, without an escape, not empty, without white space at either
// end, and no value of TOML without the quotes: `"2"` without quotes is the valid number 2, which nobody would call
// a mistake of the syntax.
function plainStrings(scanned: Scan): Value[] {
  return scanned.values.filter(value => {
    if (value.string === null || value.string.quoteLength !== 1 || value.string.escapes.length > 0) return false
    const content = contentOf(scanned, value.string)
    return content !== '' && content.trim() === content && !isValue(content)
  })
}
const withoutQuotes = (value: Value): Edit[] => [removeRange(value.start, value.start + 1), removeRange(value.end - 1, value.end)]

function unquotedString(random: Random, scanned: Scan): Damage | undefined {
  const strings = plainStrings(scanned)
  if (strings.length === 0) return undefined
  const ofEntries = strings.filter(value => value.within === null)
  const tables = scanned.tables.map(table => table.entries.map(entry => entry.value).filter(value => ofEntries.includes(value))).filter(values => values.length >= 2)
  const items = strings.filter(value => value.within?.type === 'array')
  const arrays = scanned.containers.filter(container => container.type === 'array' && container.items.length >= 2 && container.items.every(item => strings.includes(item.value)))
  const inInlineTables = strings.filter(value => value.within?.type === 'inlineTable')
  const form = chooseForm(random, [
    ['the value of one entry', ofEntries.length > 0 ? 50 : 0], ['every string value below one header', tables.length > 0 ? 17 : 0], ['every value of one array', arrays.length > 0 ? 12 : 0],
    ['one value of an array', items.length > 0 ? 5 : 0], ['a value inside an inline table', inInlineTables.length > 0 ? 6 : 0], ['every string of the document', strings.length > 1 ? 10 : 0],
  ] as const)
  if (form === undefined) return undefined
  switch (form) {
    case 'the value of one entry': return {edits: withoutQuotes(random.pick(ofEntries)), form}
    case 'every string value below one header': return {edits: random.pick(tables).flatMap(withoutQuotes), form}
    case 'every value of one array': return {edits: random.pick(arrays).items.flatMap(item => withoutQuotes(item.value)), form}
    case 'one value of an array': return {edits: withoutQuotes(random.pick(items)), form}
    case 'a value inside an inline table': return {edits: withoutQuotes(random.pick(inInlineTables)), form}
    case 'every string of the document': return {edits: strings.flatMap(withoutQuotes), form, wholeText: true}
  }
}

// The words of other notations for true and false, as pairs, and for no value.
const booleanWords: readonly (readonly [words: readonly [string, string], weight: number])[] = [[['True', 'False'], 40], [['yes', 'no'], 25], [['on', 'off'], 15], [['TRUE', 'FALSE'], 10], [['Yes', 'No'], 5], [['On', 'Off'], 5]]
const nullWords = [['null', 45], ['None', 20], ['nil', 12], ['undefined', 10], ['NULL', 8], ['~', 5]] as const
const notNumberWords = [['NaN', 40], ['Infinity', 30], ['-Infinity', 15], ['Inf', 10], ['NAN', 5]] as const
const isScalar = (value: Value) => value.type === 'number' || value.type === 'boolean' || value.type === 'date' || (value.string !== null && value.string.quoteLength === 1)

function foreignLiteral(random: Random, scanned: Scan): Damage | undefined {
  const booleans = scanned.values.filter(value => value.type === 'boolean')
  const scalars = scanned.values.filter(isScalar)
  const floats = scanned.values.filter(value => value.type === 'number' && /^[+-]?[\d_]+\.[\d_]+/.test(textOf(scanned, value)))
  const form = chooseForm(random, [
    ['one true or false as another notation writes it', booleans.length > 0 ? 45 : 0], ['every true and false of the document', booleans.length > 1 ? 20 : 0],
    ['a word for no value in the place of a value', scalars.length > 0 ? 30 : 0], ['a word for a number that is none', floats.length > 0 ? 5 : 0],
  ] as const)
  if (form === undefined) return undefined
  const words = random.weighted(booleanWords)
  const otherBoolean = (value: Value) => replaceValue(value, words[textOf(scanned, value) === 'true' ? 0 : 1])
  switch (form) {
    case 'one true or false as another notation writes it': return {edits: [otherBoolean(random.pick(booleans))], form: `${words.join(' and ')} for one true or false`}
    case 'every true and false of the document': return {edits: booleans.map(otherBoolean), form: `${words.join(' and ')} for every true and false`, wholeText: true}
    case 'a word for no value in the place of a value': {
      const word = random.weighted(nullWords)
      return {edits: [replaceValue(random.pick(scalars), word)], form: `${word} in the place of a value`}
    }
    case 'a word for a number that is none': {
      const word = random.weighted(notNumberWords)
      return {edits: [replaceValue(random.pick(floats), word)], form: `${word} in the place of a number`}
    }
  }
}

function halfTypedValue(random: Random, scanned: Scan): Damage | undefined {
  const candidates = scanned.values.filter(value => value.within === null && (value.type === 'number' || value.type === 'boolean' || value.type === 'date') && lastOnLine(scanned, value.end))
  if (candidates.length === 0) return undefined
  const value = random.pick(candidates)
  const text = textOf(scanned, value)
  // The lengths at which the value's start is no value yet, e.g. `tru`, `0.`, `1e` and `2024-01-`.
  const lengths = Array.from({length: Array.from(text).length - 1}, (_, index) => index + 1).filter(length => !isValue(Array.from(text).slice(0, length).join('')))
  if (lengths.length === 0) return undefined
  const kept = random.pick(lengths)
  return {edits: [removeRange(value.start + kept, value.end)], form: `a ${value.type} that stops after ${kept} of its ${value.end - value.start} code points`}
}

const units = [['s', 22], ['ms', 14], ['m', 6], ['h', 6], ['d', 4], ['MB', 10], ['GB', 6], ['KB', 4], ['k', 6], ['%', 8], ['px', 5], ['x', 3], ['mb', 3], ['kb', 3]] as const
const integerSuffixes = ['L', 'u32', 'i64', 'n', 'u8', 'usize', 'UL']
const floatSuffixes = ['f', 'f32', 'f64', 'd', 'F']

function numberFormat(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const numbers = scanned.values.filter(value => value.type === 'number').map(value => ({value, text: textOf(scanned, value)}))
  const firstDigit = (value: Value) => '+-'.includes(codePoints[value.start]!) ? value.start + 1 : value.start
  const integers = numbers.filter(({text}) => /^[+-]?[1-9][\d_]*$/.test(text))
  const floats = numbers.filter(({text}) => /^[+-]?[\d_]+\.[\d_]+$/.test(text))
  const decimal = [...integers, ...floats]
  const zeroDot = floats.filter(({text}) => /^[+-]?0\./.test(text))
  // A comma inside an array or an inline table is a separator there, so these two forms take values of entries on
  // lines of their own.
  const large = integers.filter(({value, text}) => value.within === null && /^[+-]?(\d{4,}|\d{1,3}(_\d{3})+)$/.test(text))
  const floatsOfEntries = floats.filter(({value}) => value.within === null)
  const prefixed = numbers.filter(({text}) => /^0[xob]/.test(text))
  const octal = prefixed.filter(({text}) => text.startsWith('0o'))
  const form = chooseForm(random, [
    ['a unit after the number', decimal.length > 0 ? 30 : 0], ['a zero before the number', integers.length > 0 ? 14 : 0], ['a dot after the number', integers.length > 0 ? 8 : 0],
    ['an underscore too many', decimal.length > 0 ? 6 : 0],
    ['no zero before the dot', zeroDot.length > 0 ? 10 : 0], ['thousands kept apart by another sign', large.length > 0 ? 14 : 0], ['a comma for the decimal point', floatsOfEntries.length > 0 ? 6 : 0],
    ['a suffix of a type', decimal.length > 0 ? 10 : 0], ['an upper-case letter after the first zero', prefixed.length > 0 ? 5 : 0], ['no letter after the zero of an octal number', octal.length > 0 ? 3 : 0],
  ] as const)
  if (form === undefined) return undefined
  switch (form) {
    case 'a unit after the number': {
      const unit = random.weighted(units)
      const spaced = random.chance(0.15)
      return {edits: [insertAt(random.pick(decimal).value.end, `${spaced ? ' ' : ''}${unit}`)], form: `the unit ${unit} after a number${spaced ? ', with a space' : ''}`}
    }
    case 'a zero before the number': return {edits: [insertAt(firstDigit(random.pick(integers).value), '0')], form}
    case 'a dot after the number': return {edits: [insertAt(random.pick(integers).value.end, '.')], form}
    case 'an underscore too many': {
      // After the last digit, or a second one where the number has one, e.g. 1_000_ and 1__000.
      const {value} = random.pick(decimal)
      const underscore = codePoints.indexOf('_', value.start)
      const doubled = underscore !== -1 && underscore < value.end && random.chance(0.4)
      return {edits: [insertAt(doubled ? underscore : value.end, '_')], form: doubled ? 'two underscores in a row in a number' : 'an underscore after a number'}
    }
    case 'no zero before the dot': {
      const zero = firstDigit(random.pick(zeroDot).value)
      return {edits: [removeRange(zero, zero + 1)], form}
    }
    case 'thousands kept apart by another sign': {
      const {value, text} = random.pick(large)
      const sign = random.weighted([[',', 70], [' ', 20], ['\'', 10]] as const)
      const edits: Edit[] = []
      if (text.includes('_')) {
        // The sign stands in the place of each underscore.
        for (let position = value.start; position < value.end; position++) if (codePoints[position] === '_') edits.push(replaceOneForOne(position, sign))
      } else {
        for (let position = value.end - 3; position > firstDigit(value); position -= 3) edits.push(insertAt(position, sign))
      }
      return {edits, form: `${JSON.stringify(sign)} between the thousands of a number`}
    }
    case 'a comma for the decimal point': {
      const {value} = random.pick(floatsOfEntries)
      return {edits: [replaceOneForOne(codePoints.indexOf('.', value.start), ',')], form}
    }
    case 'a suffix of a type': {
      const {value, text} = random.pick(decimal)
      const suffix = random.pick(text.includes('.') ? floatSuffixes : integerSuffixes)
      return {edits: [insertAt(value.end, suffix)], form: `the suffix ${suffix} after a number`}
    }
    case 'an upper-case letter after the first zero': {
      const {value} = random.pick(prefixed)
      return {edits: [replaceOneForOne(value.start + 1, codePoints[value.start + 1]!.toUpperCase())], form}
    }
    case 'no letter after the zero of an octal number': {
      const {value} = random.pick(octal)
      return {edits: [removeRange(value.start + 1, value.start + 2)], form}
    }
  }
}

function dateFormat(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const dates = scanned.values.filter(value => value.type === 'date').map(value => ({value, text: textOf(scanned, value)}))
  if (dates.length === 0) return undefined
  const {value, text} = random.pick(dates)
  const hasDate = /^\d{4}-\d{2}-\d{2}/.test(text)
  // Where the time starts in the value, or -1.
  const timeAt = hasDate ? (text.length > 10 ? 11 : -1) : 0
  const offset = /[+-]\d{2}:\d{2}$/.exec(text)
  const endsWithZ = /[Zz]$/.test(text)
  const zeroAt = [5, 8].filter(at => hasDate && text[at] === '0')
  const form = chooseForm(random, [
    ['slashes in the date', hasDate ? 28 : 0], ['dots in the date', hasDate ? 10 : 0], ['a month or a day without its zero', zeroAt.length > 0 ? 14 : 0],
    ['a time without seconds', timeAt !== -1 ? 22 : 0], ['an offset without its colon', offset !== null ? 10 : 0], ['the name of a time zone', timeAt !== -1 && offset === null ? 16 : 0],
  ] as const)
  if (form === undefined) return undefined
  switch (form) {
    case 'slashes in the date': return {edits: [replaceOneForOne(value.start + 4, '/'), replaceOneForOne(value.start + 7, '/')], form}
    case 'dots in the date': return {edits: [replaceOneForOne(value.start + 4, '.'), replaceOneForOne(value.start + 7, '.')], form}
    case 'a month or a day without its zero': {
      const at = value.start + random.pick(zeroAt)
      return {edits: [removeRange(at, at + 1)], form}
    }
    case 'a time without seconds': {
      // The seconds and their fraction go: from the second colon of the time to the offset or the value's end.
      const from = value.start + timeAt + 5
      let to = from + 3
      if (codePoints[to] === '.') {
        to++
        while (/^\d$/.test(codePoints[to] ?? '')) to++
      }
      return {edits: [removeRange(from, to)], form}
    }
    case 'an offset without its colon': return {edits: [removeRange(value.end - 3, value.end - 2)], form}
    case 'the name of a time zone': {
      const zone = random.pick([' UTC', ' GMT', ' CET', ' PST', 'UTC'])
      return {edits: [endsWithZ ? {at: value.end - 1, remove: 1, insert: zone} : insertAt(value.end, zone)], form: `${JSON.stringify(zone)} after a time`}
    }
  }
}

// The placeholder that a template or a sample config has in the place of a value, for the key `name`, e.g.
// `{{ port }}` for the key `port`, and the placeholder's form as the key `name` has it, e.g. `{{ name }}`.
function placeholderFor(random: Random, name: string): {text: string, form: string} {
  const upperCase = (key: string) => key.toUpperCase().replaceAll(/[^A-Z0-9]/g, '_')
  const write = random.weighted<(key: string) => string>([
    [key => `{{ ${key} }}`, 22], [key => `{{${key}}}`, 8], [key => `\${${upperCase(key)}}`, 18], [key => `$${upperCase(key)}`, 8], [key => `<${key}>`, 12], [key => `<your-${key}>`, 8],
    [key => `%${upperCase(key)}%`, 4], [key => `@${upperCase(key)}@`, 4], [() => 'TODO', 6], [() => '???', 4], [() => 'CHANGEME', 3], [() => 'xxx', 3],
  ])
  return {text: write(name), form: write('name')}
}

function placeholderValue(random: Random, scanned: Scan): Damage | undefined {
  const nameOf = (value: Value) => {
    const part = value.entry!.key.parts.at(-1)!
    return part.string === null ? textOf(scanned, part) : 'value'
  }
  const candidates = scanned.values.filter(value => value.entry !== null && isScalar(value))
  if (candidates.length === 0) return undefined
  const tables = scanned.tables.map(table => table.entries.map(entry => entry.value).filter(value => candidates.includes(value))).filter(values => values.length >= 2)
  if (tables.length > 0 && random.chance(0.2)) {
    const chosen = random.shuffled(random.pick(tables)).slice(0, random.integer(2, 3))
    return {edits: chosen.map(value => replaceValue(value, placeholderFor(random, nameOf(value)).text)), form: `placeholders in the place of ${chosen.length} values below one header`}
  }
  const value = random.pick(candidates)
  const placeholder = placeholderFor(random, nameOf(value))
  return {edits: [replaceValue(value, placeholder.text)], form: `${placeholder.form} in the place of a value`}
}

const doubleQuotePairs: readonly (readonly [quotes: readonly [string, string], weight: number])[] = [[['“', '”'], 70], [['„', '“'], 10], [['«', '»'], 10], [['”', '”'], 10]]
// The two quotes of a string as other quotes, each in the place of the quote that it stands for.
const otherQuotes = (string: StringPart, open: string, close: string): Edit[] => [replaceOneForOne(string.start, open), replaceOneForOne(string.end - 1, close)]

function foreignQuotes(random: Random, scanned: Scan): Damage | undefined {
  const oneLine = scanned.strings.filter(string => string.role === 'value' && string.quoteLength === 1)
  const basic = oneLine.filter(string => string.quote === '"')
  const literal = oneLine.filter(string => string.quote === '\'')
  const form = chooseForm(random, [
    ['typographic quotes around one string', basic.length > 0 ? 25 : 0], ['typographic quotes around every string between quotes', basic.length > 1 ? 33 : 0],
    ['backticks around one string', oneLine.length > 0 ? 13 : 0], ['typographic quotes around a string between apostrophes', literal.length > 0 ? 10 : 0],
    ['typographic quotes around every string between apostrophes', literal.length > 1 ? 7 : 0], ['a letter before the opening quote', oneLine.length > 0 ? 12 : 0],
  ] as const)
  if (form === undefined) return undefined
  const [open, close] = random.weighted(doubleQuotePairs)
  switch (form) {
    case 'typographic quotes around one string': return {edits: otherQuotes(random.pick(basic), open, close), form: `${open}${close} around one string`}
    case 'typographic quotes around every string between quotes': return {edits: basic.flatMap(string => otherQuotes(string, open, close)), form: `${open}${close} around every string between quotes`, wholeText: true}
    case 'backticks around one string': return {edits: otherQuotes(random.pick(oneLine), '`', '`'), form}
    case 'typographic quotes around a string between apostrophes': return {edits: otherQuotes(random.pick(literal), '‘', '’'), form: '‘’ around one string'}
    case 'typographic quotes around every string between apostrophes': return {edits: literal.flatMap(string => otherQuotes(string, '‘', '’')), form: '‘’ around every string between apostrophes', wholeText: true}
    case 'a letter before the opening quote': {
      // r"..." and f"..." of Python, b"..." of Rust, @"..." of C#.
      const letter = random.weighted([['r', 40], ['f', 25], ['b', 10], ['u', 10], ['@', 10], ['L', 5]] as const)
      return {edits: [insertAt(random.pick(oneLine).start, letter)], form: `${letter} before the opening quote of a string`}
    }
  }
}

function otherBrackets(random: Random, scanned: Scan): Damage | undefined {
  const arrays = scanned.containers.filter(container => container.type === 'array' && container.parent === null && container.items.length > 0)
  if (arrays.length === 0) return undefined
  const container = random.pick(arrays)
  const [open, close] = random.weighted<readonly [string, string]>([[['(', ')'], 75], [['{', '}'], 25]])
  return {edits: [replaceOneForOne(container.open, open), replaceOneForOne(container.close, close)], form: `${open}${close} around the values of an array`}
}

export const valueKinds: KindDefinition[] = [
  {
    name: 'unquotedString', family: 'values', weight: 6,
    description: 'A string without its quotes, as INI files, YAML and .env files write a value',
    example: 'name = tiny-router⏎version = 6.9.17',
    variants: 'the value of one entry; every string value below one header; one value or every value of an array; a value inside an inline table; every string of the document',
    showable: 'partly: a word where a value should stand runs to the end of its line at depth 0, and to a comma or a closing bracket inside a container, and is shown as a string. Its first characters are shown as a number or a literal where they read as one, e.g. the 6.9 of 6.9.17 and the t of tiny, by cells that valid TOML reads. A # in it starts a comment for every parser',
    apply: unquotedString,
  },
  {
    name: 'foreignLiteral', family: 'values', weight: 4,
    description: 'True, yes, on, null, None, nil, NaN and the like in the place of a value. TOML has true and false in lower case and no word for no value',
    example: 'debug = True⏎timeout = null',
    variants: 'one true or false; every true and false of the document, in one notation; null, None, nil, undefined, NULL or ~ in the place of any value; NaN or Infinity in the place of a number',
    showable: 'yes: the word has no label, and what follows it is read as it is',
    apply: foreignLiteral,
  },
  {
    name: 'halfTypedValue', family: 'values', weight: 1.5,
    description: 'A number, a date or a literal that is not typed to its end',
    example: 'enabled = tru⏎since = 2024-01-',
    variants: 'one value at the end of its line, cut where its start is no value',
    showable: 'yes: the typed characters are shown as the value\'s kind, and the next line starts anew',
    apply: halfTypedValue,
  },
  {
    name: 'numberFormat', family: 'values', weight: 2.5,
    description: 'A number as another language or a person writes it: with a unit, a leading zero, a comma in it, a suffix of a type',
    example: 'timeout = 30s⏎mode = 0644⏎limit = 1,000',
    variants: 'a unit after the number, e.g. s, ms, MB, %; a zero before it; a dot after it; an underscore after it, or two in a row; no zero before the dot; a comma, a space or an apostrophe between the thousands; a comma for the decimal point; a suffix of a type, e.g. u32 or f; 0X for 0x; 0640 for 0o640',
    showable: 'yes: digits, letters and the signs of a number up to the next white space are one number. With a space or a comma inside the number, what stands after it is shown as a number only by a rule that reads digits after a complete value as more of that value',
    apply: numberFormat,
  },
  {
    name: 'dateFormat', family: 'values', weight: 3,
    description: 'A date or a time in a form that TOML 1.0 does not read',
    example: 'date = 2024/01/31⏎at = 07:32',
    variants: 'slashes or dots in the date; a month or a day without its zero; a time without seconds; an offset without its colon; the name of a time zone after the time',
    showable: 'yes: digits and the signs of a date up to the next white space are one number. The name of a time zone after a space has no label',
    apply: dateFormat,
  },
  {
    name: 'placeholderValue', family: 'values', weight: 1.5,
    description: 'The placeholder of a template or of a sample config in the place of a value',
    example: 'token = <your-token>⏎name = {{ project_name }}⏎home = ${HOME}',
    variants: 'one value; 2 or 3 values below one header; the forms {{ name }}, ${NAME}, $NAME, <name>, %NAME%, @NAME@, TODO, ???, CHANGEME, xxx',
    showable: 'yes: the placeholder has no label, and its braces open and close in pairs',
    apply: placeholderValue,
  },
  {
    name: 'foreignQuotes', family: 'values', weight: 2,
    description: 'Typographic quotes or backticks around a string, as a word processor, a chat program or JavaScript writes them, or a letter before the opening quote, as Python and Rust mark a raw string',
    example: 'title = “Tide Docs”⏎run = `cargo test`⏎pattern = r"\\d+"',
    variants: 'one string; every string of the document; the pairs “ ”, „ “, « », ” ”, ‘ ’ and backticks; r, f, b, u, @ or L before the opening quote',
    showable: 'yes for a parser with a character class for the quote: the string runs to the closing one. A letter before a quote has no label and the string after it is read as it is',
    apply: foreignQuotes,
  },
  {
    name: 'otherBrackets', family: 'values', weight: 0.8,
    description: 'Parentheses or braces around the values of an array, as Python writes a tuple and C or Go an array',
    example: 'ports = (80, 443)⏎tags = {"web", "prod"}',
    variants: 'one array, with ( ) or with { }',
    showable: 'yes with ( ) for a parser with character classes for them. no with { }: the brace opens an inline table by a cell that valid TOML reads, so the container is shown as an inline table',
    apply: otherBrackets,
  },
]
