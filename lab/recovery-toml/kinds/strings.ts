// A quote too few or too many, a backslash that is no escape of TOML, and a line end inside a string of one line.
import {type Edit, insertAt, removeRange, replaceOneForOne} from '../edits.ts'
import type {Random} from '../random.ts'
import {chooseForm} from './assignment.ts'
import {type Scan, type StringPart, type Value, commentAfter, contentOf, indentationAt, lastOnLine} from './scan.ts'
import type {Damage, KindDefinition} from './types.ts'

const oneLineValues = (scanned: Scan) => scanned.values.filter(value => value.string !== null && value.string.quoteLength === 1)
const contentStart = (string: StringPart) => string.start + string.quoteLength
const contentEnd = (string: StringPart) => string.end - string.quoteLength
// The positions of a string's content that are in no escape and hold a code point that `wanted` accepts.
function plainPositions(scanned: Scan, string: StringPart, wanted: (character: string) => boolean): number[] {
  const positions: number[] = []
  for (let position = contentStart(string); position < contentEnd(string); position++) {
    if (wanted(scanned.codePoints[position]!) && !string.escapes.some(escape => position >= escape.start && position < escape.end)) positions.push(position)
  }
  return positions
}

function missingClosingQuote(random: Random, scanned: Scan): Damage | undefined {
  const strings = oneLineValues(scanned)
  const atLineEnd = strings.filter(value => value.within === null && lastOnLine(scanned, value.end))
  const beforeComment = strings.filter(value => value.within === null && !lastOnLine(scanned, value.end) && commentAfter(scanned, value.end) !== undefined)
  const inContainers = strings.filter(value => value.within !== null)
  const longEnough = atLineEnd.filter(value => value.end - value.start >= 5)
  const form = chooseForm(random, [
    ['a string at the end of its line', atLineEnd.length > 0 ? 60 : 0], ['a string that stops before its end', longEnough.length > 0 ? 10 : 0],
    ['a string before a comment', beforeComment.length > 0 ? 8 : 0], ['a string inside an array or an inline table', inContainers.length > 0 ? 22 : 0],
  ] as const)
  if (form === undefined) return undefined
  const withoutClosing = (value: Value) => [removeRange(value.end - 1, value.end)]
  switch (form) {
    case 'a string at the end of its line': return {edits: withoutClosing(random.pick(atLineEnd)), form}
    case 'a string that stops before its end': {
      // Half typed: the string ends inside its content, at a place that is in no escape.
      const value = random.pick(longEnough)
      const places = plainPositions(scanned, value.string!, () => true).filter(position => position > contentStart(value.string!))
      if (places.length === 0) return undefined
      return {edits: [removeRange(random.pick(places), value.end)], form}
    }
    case 'a string before a comment': return {edits: withoutClosing(random.pick(beforeComment)), form}
    case 'a string inside an array or an inline table': return {edits: withoutClosing(random.pick(inContainers)), form}
  }
}

function missingOpeningQuote(random: Random, scanned: Scan): Damage | undefined {
  const strings = oneLineValues(scanned).filter(value => value.end - value.start > 2)
  const ofEntries = strings.filter(value => value.within === null)
  const inContainers = strings.filter(value => value.within !== null)
  const form = chooseForm(random, [['the value of an entry', ofEntries.length > 0 ? 80 : 0], ['a string inside an array or an inline table', inContainers.length > 0 ? 20 : 0]] as const)
  if (form === undefined) return undefined
  const value = random.pick(form === 'the value of an entry' ? ofEntries : inContainers)
  return {edits: [removeRange(value.start, value.start + 1)], form}
}

function doubledQuote(random: Random, scanned: Scan): Damage | undefined {
  // An empty string with one quote more would start a string between three quotes.
  const strings = oneLineValues(scanned).filter(value => value.end - value.start > 2)
  if (strings.length === 0) return undefined
  const value = random.pick(strings)
  const after = random.chance(0.7)
  return {edits: [insertAt(after ? value.end : value.start, value.string!.quote)], form: after ? 'a second quote after the closing quote' : 'a second quote before the opening quote'}
}

function unescapedQuote(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const quoteEscapes = (string: StringPart) => string.escapes.filter(escape => codePoints[escape.start + 1] === '"')
  const withEscapedQuotes = scanned.strings.filter(string => string.role === 'value' && string.quote === '"' && quoteEscapes(string).length > 0)
  const oneLine = scanned.strings.filter(string => string.role === 'value' && string.quoteLength === 1)
  const literalWithQuote = oneLine.filter(string => string.quote === '\'' && contentOf(scanned, string).includes('"'))
  const basicWithApostrophe = oneLine.filter(string => string.quote === '"' && string.escapes.length === 0 && contentOf(scanned, string).includes('\''))
  const form = chooseForm(random, [
    ['quotes inside a string without their backslashes', withEscapedQuotes.length > 0 ? 60 : 0], ['a string that holds quotes, between quotes', literalWithQuote.length > 0 ? 20 : 0],
    ['a string that holds an apostrophe, between apostrophes', basicWithApostrophe.length > 0 ? 20 : 0],
  ] as const)
  if (form === undefined) return undefined
  switch (form) {
    case 'quotes inside a string without their backslashes': return {edits: quoteEscapes(random.pick(withEscapedQuotes)).map(escape => removeRange(escape.start, escape.start + 1)), form}
    case 'a string that holds quotes, between quotes': {
      const string = random.pick(literalWithQuote)
      return {edits: [replaceOneForOne(string.start, '"'), replaceOneForOne(string.end - 1, '"')], form}
    }
    case 'a string that holds an apostrophe, between apostrophes': {
      const string = random.pick(basicWithApostrophe)
      return {edits: [replaceOneForOne(string.start, '\''), replaceOneForOne(string.end - 1, '\'')], form}
    }
  }
}

function unescapedBackslash(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const backslashEscapes = (string: StringPart) => string.escapes.filter(escape => codePoints[escape.start + 1] === '\\')
  const withPairs = scanned.strings.filter(string => string.role === 'value' && string.quote === '"' && backslashEscapes(string).length > 0)
  // A string between apostrophes that holds a backslash, e.g. a Windows path or a regular expression, and no quote.
  const literal = scanned.strings.filter(string => string.role === 'value' && string.quote === '\'' && contentOf(scanned, string).includes('\\') && !contentOf(scanned, string).includes('"'))
  const form = chooseForm(random, [['one backslash where the string has two', withPairs.length > 0 ? 50 : 0], ['quotes around a string that stood between apostrophes', literal.length > 0 ? 50 : 0]] as const)
  if (form === undefined) return undefined
  if (form === 'one backslash where the string has two') return {edits: backslashEscapes(random.pick(withPairs)).map(escape => removeRange(escape.start + 1, escape.start + 2)), form}
  const string = random.pick(literal)
  const edits: Edit[] = []
  for (let offset = 0; offset < string.quoteLength; offset++) edits.push(replaceOneForOne(string.start + offset, '"'), replaceOneForOne(string.end - 1 - offset, '"'))
  return {edits, form}
}

const escapedSigns = '.-$ {[(*#:@%&+?|^~'

function unknownEscape(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const basic = scanned.strings.filter(string => string.role === 'value' && string.quote === '"' && string.quoteLength === 1)
  const places = (wanted: (character: string) => boolean) => basic.map(string => plainPositions(scanned, string, wanted)).filter(positions => positions.length > 0)
  const slashes = places(character => character === '/')
  const apostrophes = places(character => character === '\'')
  const signs = places(character => escapedSigns.includes(character))
  const latin1 = places(character => character.codePointAt(0)! >= 0xa0 && character.codePointAt(0)! <= 0xff)
  const unicodeEscapes = basic.flatMap(string => string.escapes.filter(escape => codePoints[escape.start + 1] === 'u'))
  const form = chooseForm(random, [
    ['a backslash before every slash of a string', slashes.length > 0 ? 35 : 0], ['a backslash before an apostrophe', apostrophes.length > 0 ? 10 : 0], ['a backslash before a sign', signs.length > 0 ? 35 : 0],
    ['\\x and two hex digits for a character', latin1.length > 0 ? 12 : 0], ['braces around the digits of a \\u escape', unicodeEscapes.length > 0 ? 8 : 0],
  ] as const)
  if (form === undefined) return undefined
  const backslashBefore = (positions: readonly number[]) => positions.map(position => insertAt(position, '\\'))
  switch (form) {
    case 'a backslash before every slash of a string': return {edits: backslashBefore(random.pick(slashes)), form}
    case 'a backslash before an apostrophe': return {edits: backslashBefore(random.pick(apostrophes)), form}
    case 'a backslash before a sign': {
      // One sign of the string, at one place or at every place where the string has it, e.g. \. in a pattern.
      const positions = random.pick(signs)
      const sign = codePoints[random.pick(positions)]!
      const same = positions.filter(position => codePoints[position] === sign)
      const every = same.length > 1 && random.chance(0.4)
      return {edits: backslashBefore(every ? same : [random.pick(same)]), form: `a backslash before ${every ? 'every' : 'one'} ${JSON.stringify(sign)} of a string`}
    }
    case '\\x and two hex digits for a character': return {edits: random.pick(latin1).map(position => ({at: position, remove: 1, insert: `\\x${codePoints[position]!.codePointAt(0)!.toString(16)}`})), form}
    case 'braces around the digits of a \\u escape': {
      const escape = random.pick(unicodeEscapes)
      return {edits: [insertAt(escape.start + 2, '{'), insertAt(escape.end, '}')], form}
    }
  }
}

function rawLineFeedInString(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints, lineEnd} = scanned
  const withSpace = oneLineValues(scanned).filter(value => value.within === null).map(value => ({value, spaces: plainPositions(scanned, value.string!, character => character === ' ').filter(position => position > contentStart(value.string!) && position < contentEnd(value.string!) - 1)}))
    .filter(({spaces}) => spaces.length > 0)
  const severalLines = scanned.strings.filter(string => string.quoteLength === 3 && codePoints.slice(string.start, string.end).includes('\n'))
  const form = chooseForm(random, [['a string that goes on in the next line', withSpace.length > 0 ? 75 : 0], ['a string of several lines between single quotes', severalLines.length > 0 ? 25 : 0]] as const)
  if (form === undefined) return undefined
  if (form === 'a string that goes on in the next line') {
    // An editor or a mail program wrapped the line at a space: the space goes and a line end comes.
    const {value, spaces} = random.pick(withSpace)
    const indent = random.chance(0.4) ? `${indentationAt(scanned, value.start)}  ` : ''
    return {edits: [{at: random.pick(spaces), remove: 1, insert: `${lineEnd}${indent}`}], form: indent === '' ? form : `${form}, indented`}
  }
  // One quote where three are needed: at the start alone, or at both ends.
  const string = random.pick(severalLines)
  const bothEnds = random.chance(0.7)
  const edits = [removeRange(string.start + 1, string.start + 3)]
  if (bothEnds) edits.push(removeRange(string.end - 2, string.end))
  return {edits, form: bothEnds ? 'a string of several lines with one quote at each end' : 'a string of several lines with one quote at its start'}
}

function stringInTwoParts(random: Random, scanned: Scan): Damage | undefined {
  const {lineEnd} = scanned
  // A string of an entry that holds a space: the second part starts after that space.
  const withSpace = oneLineValues(scanned).filter(value => value.within === null).map(value => ({value, spaces: plainPositions(scanned, value.string!, character => character === ' ').filter(position => position > contentStart(value.string!) && position < contentEnd(value.string!) - 1)}))
    .filter(({spaces}) => spaces.length > 0)
  if (withSpace.length === 0) return undefined
  const {value, spaces} = random.pick(withSpace)
  const {quote} = value.string!
  const indent = `${indentationAt(scanned, value.start)}${random.chance(0.5) ? '  ' : '    '}`
  const [between, form] = random.weighted([
    [[' + ', 'two strings with a + between them'], 40], [[` +${lineEnd}${indent}`, 'two strings with a + between them, the second one in the next line'], 30], [[`${lineEnd}${indent}`, 'two strings, the second one in the next line'], 20],
    [[' ', 'two strings with a space between them'], 10],
  ] as const)
  return {edits: [insertAt(random.pick(spaces) + 1, `${quote}${between}${quote}`)], form}
}

export const stringKinds: KindDefinition[] = [
  {
    name: 'missingClosingQuote', family: 'strings', weight: 4,
    description: 'A string without its closing quote, half typed or cut by a paste',
    example: 'name = "tiny-router⏎version = "6.9.17"',
    variants: 'a string at the end of its line; a string that stops inside its content; a string before a comment; a string inside an array or an inline table',
    showable: 'yes at the end of a line: a string of one line holds no line end, so it ends there. no before a comment or inside a line: the string runs on to the next quote, which opens the next string in the document, and to the line\'s end, with the labels of the comment, the comma and the brackets inside it',
    apply: missingClosingQuote,
  },
  {
    name: 'missingOpeningQuote', family: 'strings', weight: 1,
    description: 'A string without its opening quote',
    example: 'name = tiny-router"',
    variants: 'the value of an entry; a string inside an array or an inline table',
    showable: 'partly: the content is read as a string without quotes, see unquotedString. The closing quote opens a string for every parser, which ends at the line\'s end when nothing follows on the line. no when a comment or more values follow',
    apply: missingOpeningQuote,
  },
  {
    name: 'doubledQuote', family: 'strings', weight: 1,
    description: 'A quote typed twice, as an editor that pairs quotes leaves it',
    example: 'name = "tiny-router""',
    variants: 'after the closing quote; before the opening quote',
    showable: 'after the closing quote: yes when nothing follows on the line, where the quote opens a string that the line\'s end closes. Before the opening quote: the two quotes read as an empty string, and the content after them is shown as a string only by a rule that reads a word right after a value as more of that value, which is the opposite of what entriesOnOneLine needs',
    apply: doubledQuote,
  },
  {
    name: 'unescapedQuote', family: 'strings', weight: 3,
    description: 'A quote inside a string without its backslash, or a string between the kind of quote that it holds',
    example: 'quote = "She said "hello" and left."',
    variants: 'every \\" of one string without its backslash; a string between apostrophes that holds quotes, written between quotes; a string between quotes that holds an apostrophe, written between apostrophes',
    showable: 'no: the inner quote ends the string, and nothing at that point says that it should not',
    apply: unescapedQuote,
  },
  {
    name: 'unescapedBackslash', family: 'strings', weight: 10,
    description: 'A backslash that is content, e.g. of a Windows path or a regular expression, in a string between quotes',
    example: 'path = "C:\\Users\\ada"⏎pattern = "^\\d+\\.\\d+$"',
    variants: 'one backslash where the document has two; quotes around a string that stood between apostrophes',
    showable: 'yes: after a backslash and a character that TOML does not escape, the string goes on. Where the character after the backslash is one that TOML escapes, e.g. the t of C:\\temp, every parser shows an escape',
    apply: unescapedBackslash,
  },
  {
    name: 'unknownEscape', family: 'strings', weight: 1.5,
    description: 'An escape of another language in a string between quotes: \\/ as JSON allows, \\\' \\. \\$ and the like, \\xe9, \\u{2190}',
    example: 'url = "https:\\/\\/example.org\\/docs"',
    variants: 'a backslash before every slash of a string; before an apostrophe; before one sign or every such sign of a string; \\x and two hex digits for a character; braces around the digits of a \\u escape',
    showable: 'yes: after a backslash and a character that TOML does not escape, the string goes on',
    apply: unknownEscape,
  },
  {
    name: 'rawLineFeedInString', family: 'strings', weight: 0.8,
    description: 'A string of one line that goes on in the next line: wrapped by an editor, or meant as a string of several lines, which TOML writes between three quotes',
    example: 'description = "Something quiet over⏎something to."',
    variants: 'a line end in the place of a space of the string, with the next line indented or not; a string between three quotes with one quote at each end, or at its start alone',
    showable: 'yes with the rule that a line end inside a string is content, which is the opposite of the rule that missingClosingQuote needs. With one quote at the start and three at the end, the string ends at the first of the three and the other two read as an empty string',
    apply: rawLineFeedInString,
  },
  {
    name: 'stringInTwoParts', family: 'strings', weight: 0.8,
    description: 'A long string written as two strings, joined with a + or just put next to each other, as JavaScript, Python and C write it',
    example: 'description = "Something quiet over " +⏎  "something to."',
    variants: 'a + between the two strings, on one line or with the second string in the next line; no sign between them, with the second string in the next line or after a space',
    showable: 'yes: after a complete value at depth 0, a + is skipped and a string is more of the value, also in the next line after a +. Without a +, the second string in the next line stands where a key in quotes stands and is shown as a key',
    apply: stringInTwoParts,
  },
]
