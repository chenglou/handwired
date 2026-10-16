// A key or a value in a form that TOML does not have: a key with a space, a header with a dot too many, an entry
// without its value, true and false in another spelling, a number with a unit or in another notation, a date in
// another notation, and a placeholder of a template where a value belongs.
import {type Edit, insertAt, removeRange} from '../../../edits.ts'
import type {Random} from '../../../random.ts'
import {type Entry, type KeyPart, type Scan, type Value, firstOnLine, holderOf, isDateOrTime, isPlainNumber, lineEntries, onOneLine} from '../scan.ts'
import {type KindDefinition, type Mistake, drawForm} from './types.ts'

// One code point of the document with other text in its place. The text is added: it stands for nothing.
const replaceWith = (at: number, remove: number, text: string): Edit => ({at, remove, insert: text})

const isScalar = (value: Value) => value.type === 'number' || value.type === 'literal' || (value.type === 'string' && !value.string.multiLine)

// A key of two words with a space between them, where the document has an underscore or a hyphen.
function keyWithSpace(random: Random, scanned: Scan): Mistake | undefined {
  const {codePoints} = scanned
  // The places in a part of a key where a hyphen or an underscore stands between a letter or digit and a letter.
  const placesIn = (part: KeyPart) => {
    const places: number[] = []
    if (part.quoted) return places
    for (let index = part.start + 1; index < part.end - 1; index++) {
      if ((codePoints[index] === '_' || codePoints[index] === '-') && /[A-Za-z0-9]/.test(codePoints[index - 1]!) && /[A-Za-z]/.test(codePoints[index + 1]!)) places.push(index)
    }
    return places
  }
  const inKeys = lineEntries(scanned).flatMap(entry => entry.key.parts.flatMap(placesIn))
  const inHeaders = scanned.headers.flatMap(header => header.name.parts.flatMap(placesIn))
  const where = drawForm(random, [['a key', inKeys.length > 0 ? 80 : 0], ['the name of a header', inHeaders.length > 0 ? 20 : 0]] as const)
  if (where === undefined) return undefined
  const places = where === 'a key' ? inKeys : inHeaders
  const place = random.pick(places)
  // In a key, a second word that starts with i or n reads as the start of inf or nan, i.e. as a number after a key,
  // which is a value after missingEquals. In a header no value can stand.
  const readsAsNumber = where === 'a key' && /[in]/.test(codePoints[place + 1]!)
  return {
    edits: [replaceWith(place, 1, ' ')], form: `in ${where}, where the document has ${codePoints[place] === '_' ? 'an underscore' : 'a hyphen'}${readsAsNumber ? ', the second word starts like inf or nan' : ''}`,
    reachable: readsAsNumber ? 'no' : 'yes',
  }
}

function valueLeftOut(random: Random, scanned: Scan): Mistake | undefined {
  const {codePoints} = scanned
  const onLines = lineEntries(scanned).filter(entry => isScalar(entry.value) && onOneLine(scanned, entry))
  const inTables = scanned.entries.filter(entry => entry.container !== null && isScalar(entry.value))
  const form = drawForm(random, [['nothing after the equals sign', onLines.length > 0 ? 60 : 0], ['only the key', onLines.length > 0 ? 25 : 0], ['in an inline table', inTables.length > 0 ? 15 : 0]] as const)
  if (form === undefined) return undefined
  if (form === 'in an inline table') {
    const entry = random.pick(inTables)
    return {edits: [removeRange(entry.value.start, entry.value.end)], form: `${form}, ${entry.commaAfter === -1 ? 'before the closing brace' : 'before a comma'}`, reachable: 'yes'}
  }
  const entry = random.pick(onLines)
  if (form === 'only the key') return {edits: [removeRange(entry.key.end, entry.value.end)], form, reachable: 'yes'}
  // Half of the texts keep the white space after the equals sign.
  const from = random.chance(0.5) ? entry.value.start : entry.equals + 1
  return {edits: [removeRange(from, entry.value.end)], form: `${form}${from < entry.value.start || codePoints[entry.value.start - 1] === '=' ? '' : ', the white space stays'}`, reachable: 'yes'}
}

function headerWithTrailingDot(random: Random, scanned: Scan): Mistake | undefined {
  if (scanned.headers.length === 0) return undefined
  const dotted = scanned.headers.filter(header => header.name.dots.length > 0)
  const form = random.weighted([['a dot before the closing bracket', 60], ['a dot after the opening bracket', 15], ['two dots between two parts', dotted.length > 0 ? 25 : 0]] as const)
  if (form === 'two dots between two parts') return {edits: [insertAt(random.pick(random.pick(dotted).name.dots) + 1, '.')], form, reachable: 'yes'}
  const header = random.pick(scanned.headers)
  return {edits: [insertAt(form === 'a dot before the closing bracket' ? header.name.end : header.name.start, '.')], form: `${form}${header.array ? ', in the header of an array of tables' : ''}`, reachable: 'yes'}
}

const spellings = {
  'True and False': {true: 'True', false: 'False'}, 'TRUE and FALSE': {true: 'TRUE', false: 'FALSE'}, 'yes and no': {true: 'yes', false: 'no'}, 'on and off': {true: 'on', false: 'off'},
} as const

// true and false as another language writes them, and a word for "no value", which TOML does not have. The word is
// added in the place of the value and has no label: the highlighter has no display kind for a word that is not TOML's.
function foreignLiteral(random: Random, scanned: Scan): Mistake | undefined {
  const {literals} = scanned
  const scalars = lineEntries(scanned).filter(entry => isScalar(entry.value) && onOneLine(scanned, entry))
  const form = drawForm(random, [
    ['True and False', literals.length > 0 ? 35 : 0], ['TRUE and FALSE', literals.length > 0 ? 8 : 0], ['yes and no', literals.length > 0 ? 22 : 0], ['on and off', literals.length > 0 ? 10 : 0],
    ['a word for no value', scalars.length > 0 ? 25 : 0],
  ] as const)
  if (form === undefined) return undefined
  if (form === 'a word for no value') {
    // An entry with an empty string is the likeliest place, and any other value stands in when there is none.
    const empty = scalars.filter(entry => entry.value.type === 'string' && entry.value.string.content === '')
    const entry = random.pick(empty.length > 0 ? empty : scalars)
    const word = random.weighted([['null', 50], ['None', 20], ['nil', 10], ['NULL', 10], ['undefined', 10]])
    return {edits: [replaceWith(entry.value.start, entry.value.end - entry.value.start, word)], form: `${word} in the place of a value`, reachable: 'yes'}
  }
  // A writer with the habit of another language writes every literal so, and a slip changes one.
  const changed = random.chance(0.6) ? literals : [random.pick(literals)]
  const words = spellings[form]
  // A word at the start of a line inside an array is the key of the next entry after missingArrayBracket.
  const startsALineInAnArray = changed.some(literal => holderOf(scanned, literal)?.type === 'array' && firstOnLine(scanned, literal.start))
  return {
    edits: changed.map(literal => replaceWith(literal.start, literal.end - literal.start, words[literal.text as 'true' | 'false'])),
    form: `${form} for ${changed.length === literals.length ? `every true and false, ${changed.length} of them` : 'one of them'}${startsALineInAnArray ? ', one starts a line inside an array' : ''}`,
    reachable: startsALineInAnArray ? 'no' : 'yes',
  }
}

// A number with its unit written after it, e.g. a duration or a size, which TOML only takes as a string.
function numberWithUnit(random: Random, scanned: Scan): Mistake | undefined {
  const numbers = scanned.numbers.filter(isPlainNumber)
  if (numbers.length === 0) return undefined
  const onLines = numbers.filter(number => holderOf(scanned, number) === null)
  const number = random.pick(onLines.length > 0 && random.chance(0.85) ? onLines : numbers)
  const unit = random.weighted([['s', 20], ['ms', 15], ['m', 8], ['h', 6], ['d', 3], ['MB', 10], ['GB', 6], ['KB', 4], ['mb', 3], ['k', 5], ['M', 3], ['G', 2], ['%', 8], ['px', 4]])
  const spaced = random.chance(0.12)
  // After a space, the unit is a word of its own, and a word after a value in an array is the key of the next entry
  // after missingArrayBracket.
  const wordInArray = spaced && holderOf(scanned, number)?.type === 'array'
  return {edits: [insertAt(number.end, `${spaced ? ' ' : ''}${unit}`)], form: `${unit} after ${number.text}${spaced ? ', with a space' : ''}${wordInArray ? ', in an array' : ''}`, reachable: wordInArray ? 'no' : 'yes'}
}

// A number as another language or a person writes it: a leading zero, an octal number without its o, a decimal point
// without a digit on one side, a comma between the thousands.
function numberInAnotherForm(random: Random, scanned: Scan): Mistake | undefined {
  const {numbers} = scanned
  const onLine = (number: Value) => holderOf(scanned, number) === null
  const integers = numbers.filter(number => /^[1-9]\d*$/.test(number.text))
  const octals = numbers.filter(number => /^0o[0-7]+$/.test(number.text))
  const fractions = numbers.filter(number => /^0\.\d+$/.test(number.text))
  // Inside an array, a comma between the thousands makes two values, which is valid.
  const thousands = numbers.filter(number => onLine(number) && /^[1-9]\d{0,2}(_?\d{3})+$/.test(number.text))
  const form = drawForm(random, [
    ['a leading zero', integers.length > 0 ? 30 : 0], ['an octal number without its o', octals.length > 0 ? 15 : 0], ['no digit before the decimal point', fractions.length > 0 ? 20 : 0],
    ['no digit after the decimal point', integers.length > 0 ? 15 : 0], ['a comma between the thousands', thousands.length > 0 ? 20 : 0],
  ] as const)
  switch (form) {
    case 'a leading zero': {
      const number = random.pick(integers)
      const zeros = random.pick(['0', '0', '00'])
      return {edits: [insertAt(number.start, zeros)], form: `${zeros}${number.text} for ${number.text}`, reachable: 'yes'}
    }
    case 'an octal number without its o': {
      const number = random.pick(octals)
      return {edits: [removeRange(number.start + 1, number.start + 2)], form: `0${number.text.slice(2)} for ${number.text}`, reachable: 'yes'}
    }
    case 'no digit before the decimal point': {
      const number = random.pick(fractions)
      return {edits: [removeRange(number.start, number.start + 1)], form: `${number.text.slice(1)} for ${number.text}`, reachable: 'yes'}
    }
    case 'no digit after the decimal point': {
      const number = random.pick(integers)
      return {edits: [insertAt(number.end, '.')], form: `${number.text}. for ${number.text}`, reachable: 'yes'}
    }
    case 'a comma between the thousands': {
      const number = random.pick(thousands)
      const edits: Edit[] = []
      // Every third digit from the right gets a comma before it, in the place of an underscore when one stands there.
      let digitsFromRight = 0
      for (let index = number.end - 1; index > number.start; index--) {
        if (scanned.codePoints[index] === '_') continue
        digitsFromRight++
        if (digitsFromRight % 3 !== 0) continue
        edits.push(scanned.codePoints[index - 1] === '_' ? replaceWith(index - 1, 1, ',') : insertAt(index, ','))
      }
      return {edits: edits.reverse(), form: `commas in ${number.text}`, reachable: 'yes'}
    }
    default:
      return undefined
  }
}

function dateInAnotherForm(random: Random, scanned: Scan): Mistake | undefined {
  const {codePoints} = scanned
  const moments = scanned.numbers.filter(number => isDateOrTime(number.text))
  const dates = moments.filter(number => /^\d{4}-\d{2}-\d{2}/.test(number.text))
  const padded = dates.filter(number => codePoints[number.start + 5] === '0' || codePoints[number.start + 8] === '0')
  const withSeconds = moments.filter(number => /\d{2}:\d{2}:\d{2}/.test(number.text))
  const form = drawForm(random, [['slashes in the date', dates.length > 0 ? 35 : 0], ['a month or a day with one digit', padded.length > 0 ? 35 : 0], ['a time without seconds', withSeconds.length > 0 ? 30 : 0]] as const)
  switch (form) {
    case 'slashes in the date': {
      const date = random.pick(dates)
      return {edits: [replaceWith(date.start + 4, 1, '/'), replaceWith(date.start + 7, 1, '/')], form, reachable: 'yes'}
    }
    case 'a month or a day with one digit': {
      const date = random.pick(padded)
      return {edits: [date.start + 5, date.start + 8].filter(index => codePoints[index] === '0').map(index => removeRange(index, index + 1)), form, reachable: 'yes'}
    }
    case 'a time without seconds': {
      const moment = random.pick(withSeconds)
      const found = /(\d{2}:\d{2})(:\d{2}(\.\d+)?)/.exec(moment.text)!
      const from = moment.start + found.index + found[1]!.length
      return {edits: [removeRange(from, from + found[2]!.length)], form, reachable: 'yes'}
    }
    default:
      return undefined
  }
}

// A placeholder of a template or of a shell where a value belongs, as a config file has it before a tool fills it in.
function templatePlaceholder(random: Random, scanned: Scan): Mistake | undefined {
  const candidates: Entry[] = lineEntries(scanned).filter(entry => isScalar(entry.value) && onOneLine(scanned, entry))
  if (candidates.length === 0) return undefined
  const entry = random.pick(candidates)
  const lastPart = entry.key.parts.at(-1)!
  const name = lastPart.quoted ? 'value' : lastPart.text
  const upperCase = name.toUpperCase().replaceAll('-', '_')
  const placeholder = random.weighted([
    [`\${${upperCase}}`, 30], [`{{ ${name.replaceAll('-', '_')} }}`, 25], [`{{ .Values.${name.replaceAll('-', '_')} }}`, 8], [`<${upperCase}>`, 12], [`%${upperCase}%`, 8], [`$${upperCase}`, 12],
    [`<your-${name.toLowerCase().replaceAll('_', '-')}-here>`, 5],
  ])
  return {edits: [replaceWith(entry.value.start, entry.value.end - entry.value.start, placeholder)], form: `${placeholder} in the place of a value`, reachable: 'yes'}
}

export const valueKinds: KindDefinition[] = [
  {
    name: 'keyWithSpace', family: 'key or value', weight: 2,
    description: 'A key or a header\'s name of two words with a space between them, where TOML wants a hyphen, an underscore or quotes.',
    meant: 'log_level = "info"\n', example: 'log level = "info"\n',
    alignment: 'The space is added and has no label, and the underscore is removed. Both words keep their label, key.',
    reachable: 'Yes: a word after a key, where an equals sign is expected, is an error for the parser as it is, and can go on with the key. No when the second word of a key starts with i or n: it reads as the start of `inf` or `nan`, by the cell that reads a digit after a key, and a digit there starts a value after missingEquals.',
    apply: keyWithSpace,
  },
  {
    name: 'valueLeftOut', family: 'key or value', weight: 3,
    description: 'An entry without its value: nothing after the equals sign, or only the key.',
    meant: 'timeout = 30 # in seconds\nretries = 3\n', example: 'timeout = # in seconds\nretries = 3\n',
    alignment: 'The value is removed. Everything else is kept.',
    reachable: 'Yes: the end of the line, a comment, a comma or a closing brace where a value or an equals sign is expected is an error for the parser as it is, and can end the entry.',
    apply: valueLeftOut,
  },
  {
    name: 'headerWithTrailingDot', family: 'key or value', weight: 1,
    description: 'A header with a dot too many: before the closing bracket, after the opening one, or two between two parts.',
    meant: '[server.tls]\nenabled = true\n', example: '[server.tls.]\nenabled = true\n',
    alignment: 'The dot is added and has no label.',
    reachable: 'Yes: a closing bracket or a second dot where a part of the name is expected is an error for the parser as it is, and can be read as if the dot before it were not there. The parser as it is counts the closing bracket as the end of an array, and is at depth -1 from there on.',
    margin: 1,
    apply: headerWithTrailingDot,
  },
  {
    name: 'foreignLiteral', family: 'key or value', weight: 3,
    description: 'true and false as another language writes them (True, TRUE, yes, on), and a word for "no value" (null, None, nil), which TOML does not have.',
    meant: 'debug = true\nverbose = false\n', example: 'debug = True\nverbose = False\n',
    alignment: 'The word is added in the place of the value and has no label: the highlighter has no display kind for a word that is not TOML\'s.',
    reachable: 'Yes: the word has no label, and it ends at the end of the line, at a comment, or at a comma or bracket. No for a word at the start of a line inside an array, as for unquotedString.',
    margin: 40,
    apply: foreignLiteral,
  },
  {
    name: 'numberWithUnit', family: 'key or value', weight: 2,
    description: 'A number with its unit after it, e.g. a duration, a size or a percentage.',
    meant: 'timeout = 30\n', example: 'timeout = 30s\n',
    alignment: 'The unit is added and has no label. The digits keep their label, number.',
    reachable: 'Yes: the digits are read as a number, and the letter after them, which makes the word a key for the tokenizer, is an error where a value stands. No for a unit after a space inside an array: a word after a value there is the key of the next entry after missingArrayBracket.',
    margin: 3,
    apply: numberWithUnit,
  },
  {
    name: 'numberInAnotherForm', family: 'key or value', weight: 2,
    description: 'A number in a notation that TOML does not have: a leading zero, an octal number without its o, a decimal point without a digit on one side, a comma between the thousands.',
    meant: 'mode = 0o755\nratio = 0.5\n', example: 'mode = 0755\nratio = 0.5\n',
    alignment: 'A digit, the o, a decimal point or a comma is added or removed. The digits that are kept keep their label, number.',
    reachable: 'Yes: every code point that is kept is a digit or a decimal point, and where the number breaks TOML\'s form the parser as it is reports an error, in a cell that can go on with the number.',
    margin: 4,
    apply: numberInAnotherForm,
  },
  {
    name: 'dateInAnotherForm', family: 'key or value', weight: 1,
    description: 'A date or a time in another notation: slashes, a month or a day with one digit, a time without seconds.',
    meant: 'updated = 2026-02-05\n', example: 'updated = 2026/02/05\n',
    alignment: 'A slash is added where a hyphen is removed, or digits are removed. With slashes the date is a word with a slip, and the display kind of its digits is not scored. Otherwise the digits that are kept keep their label, number.',
    reachable: 'Yes, as for numberInAnotherForm. The slash is in the class `other`.',
    apply: dateInAnotherForm,
  },
  {
    name: 'templatePlaceholder', family: 'key or value', weight: 1,
    description: 'A placeholder of a template or of a shell where a value belongs, e.g. `${PORT}` or `{{ port }}`.',
    meant: 'port = 8080\nhost = "localhost"\n', example: 'port = ${PORT}\nhost = "localhost"\n',
    alignment: 'The placeholder is added in the place of the value and has no label.',
    reachable: 'Yes: the placeholder has no label. Its braces come in pairs, so a parser that counts them is at depth 0 after it. The dollar sign, the percent sign and the angle brackets are in the class `other`, where the tokenizer as it is gives up on the rest of the line.',
    margin: 40,
    apply: templatePlaceholder,
  },
]
