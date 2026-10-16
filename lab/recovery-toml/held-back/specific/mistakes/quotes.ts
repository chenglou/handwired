// A quote that is missing or of another sort, and what a string of one line may not hold: a line end, and a backslash
// that starts no escape.
import {type Edit, removeRange, replaceOneForOne} from '../../../edits.ts'
import {displayKind} from '../../../kinds.ts'
import type {Random} from '../../../random.ts'
import {type KeyPart, type Scan, type StringPart, firstOnLine, holderOf, lineAt, restOfLine} from '../scan.ts'
import {type KindDefinition, type KindOptions, type Mistake, type Reachable, drawForm} from './types.ts'

const range = (from: number, to: number) => Array.from({length: Math.max(0, to - from)}, (_, offset) => from + offset)
const hasSpace = (text: string) => /[ \t]/.test(text)

// Whether a string's content can stand without quotes: on one line, with no quote, no #, no bracket and no backslash
// in it, and no space at its ends. A bracket would move the depth of a parser that counts brackets.
const canLoseQuotes = (part: StringPart) => !part.multiLine && part.content !== '' && !/["'#\\[\]{}\t]/.test(part.content) && !part.content.startsWith(' ') && !part.content.endsWith(' ')
// Inside an array or an inline table, the content must also hold nothing that ends a value there.
const canLoseQuotesInContainer = (part: StringPart) => canLoseQuotes(part) && !/[,= ]/.test(part.content)

// A string value without its quotes, as YAML and INI files write one. The code points at its start that read as a
// number or as true or false are shown so by every parser before it can know better, e.g. the 0.4 of 0.4.1, so their
// display kind is not scored: samples.ts finds them, see unscoredOf there.
function unquotedString(random: Random, scanned: Scan, options: KindOptions = {}): Mistake | undefined {
  const endsItsLine = (part: StringPart) => {
    const rest = restOfLine(scanned, part.end)
    return rest.onlySpace || rest.comment !== undefined
  }
  const onLines = scanned.strings.filter(part => holderOf(scanned, part) === null && canLoseQuotes(part) && endsItsLine(part))
  const inContainers = scanned.strings.filter(part => holderOf(scanned, part) !== null && canLoseQuotesInContainer(part))
  const words = [...onLines.filter(part => !hasSpace(part.content)), ...(random.chance(0.3) ? inContainers : [])]
  const phrases = onLines.filter(part => hasSpace(part.content))
  const sections = scanned.sections
    .map(section => section.entries.flatMap(entry => entry.value.type === 'string' && onLines.includes(entry.value.string) ? [entry.value.string] : []))
    .filter(strings => strings.length >= 2)
  const form = options.scope ?? drawForm(random, [['one word', words.length > 0 ? 45 : 0], ['several words', phrases.length > 0 ? 25 : 0], ['every string value of one section', sections.length > 0 ? 30 : 0]] as const)
  if (form === undefined) return undefined
  const changed = form === 'one word' ? [random.pick(words)] : form === 'several words' ? [random.pick(phrases)] : form === 'every string value of one section' ? random.pick(sections) : onLines
  if (changed.length === 0) return undefined
  const inContainer = changed.length === 1 && inContainers.includes(changed[0]!)
  // A word at the start of a line inside an array is the key of the next entry after missingArrayBracket.
  const startsALineInAnArray = inContainer && holderOf(scanned, changed[0]!)?.type === 'array' && firstOnLine(scanned, changed[0]!.start)
  return {
    edits: changed.flatMap(part => [removeRange(part.start, part.start + 1), removeRange(part.end - 1, part.end)]),
    form: `${form}${changed.length > 1 ? `, ${changed.length} of them` : startsALineInAnArray ? ', at the start of a line inside an array' : inContainer ? ', in an array or an inline table' : ''}`,
    reachable: startsALineInAnArray ? 'no' : 'yes',
  }
}

function missingClosingQuote(random: Random, scanned: Scan): Mistake | undefined {
  // `where` is one of four places, of which one is drawn by its weight before a string is drawn there, so that a
  // document with many strings in arrays does not make that place the usual one.
  type Place = {part: StringPart, where: string, form: string, reachable: Reachable, unscoredKinds: number[], weight: number}
  const places: Place[] = []
  for (const part of scanned.strings) {
    // An empty string is left out: without its closing quote it is a quote at the end of a line, which is how a text
    // of several lines between single quotes starts, see lineFeedInString.
    if (part.multiLine || part.content === '') continue
    const holder = holderOf(scanned, part)
    const line = lineAt(scanned, part.end)
    if (holder === null) {
      const rest = restOfLine(scanned, part.end)
      // What the open string takes with it up to the end of the line is shown as a string by every parser.
      if (rest.onlySpace) places.push({part, where: 'line end', form: 'the value is the last thing on its line', reachable: 'line rule', unscoredKinds: range(part.end, line.end), weight: 50})
      else if (rest.comment !== undefined) places.push({part, where: 'comment', form: 'a comment follows on the line', reachable: 'line rule', unscoredKinds: range(part.end, line.end), weight: 15})
      continue
    }
    const item = holder.items.find(candidate => candidate.value.start === part.start)
    const afterComma = item === undefined || item.commaAfter === -1 ? part.end : item.commaAfter + 1
    const rest = restOfLine(scanned, afterComma)
    if (holder.type === 'array' && holder.severalLines && item !== undefined && (rest.onlySpace || rest.comment !== undefined)) {
      places.push({part, where: 'array on lines', form: `a value of an array on several lines${item.commaAfter === -1 ? '' : ', with its comma'}`, reachable: 'line rule', unscoredKinds: range(part.end, line.end), weight: 20})
    } else {
      // The string takes the closing brackets of its line with it, and a later quote on the line is read in the opposite role.
      places.push({part, where: 'mid line', form: `inside ${holder.type === 'array' ? 'an array' : 'an inline table'}, more follows on the line`, reachable: 'no', unscoredKinds: [], weight: 15})
    }
  }
  if (places.length === 0) return undefined
  const where = random.weighted([...new Map(places.map(place => [place.where, place.weight])).entries()])
  const place = random.pick(places.filter(candidate => candidate.where === where))
  return {edits: [removeRange(place.part.end - 1, place.part.end)], form: `${place.form}, a string between ${place.part.quote === '"' ? 'quotes' : 'apostrophes'}`, reachable: place.reachable, unscoredKinds: place.unscoredKinds}
}

function missingOpeningQuote(random: Random, scanned: Scan): Mistake | undefined {
  const candidates = scanned.strings.filter(part => holderOf(scanned, part) === null && canLoseQuotes(part) && restOfLine(scanned, part.end).onlySpace)
  if (candidates.length === 0) return undefined
  const part = random.pick(candidates)
  // After a letter or a digit, the quote is read by a cell that no valid text reads, and can end the value. After
  // anything else it is read as the start of a string, which then runs to the end of the line.
  const quoteEndsAWord = /[A-Za-z0-9_-]$/.test(part.content)
  const line = lineAt(scanned, part.end)
  return {
    edits: [removeRange(part.start, part.start + 1)], form: `${hasSpace(part.content) ? 'several words' : 'one word'}${quoteEndsAWord ? '' : ', the closing quote stands after a character that is no letter and no digit'}`,
    reachable: quoteEndsAWord ? 'yes' : 'line rule', unscoredKinds: quoteEndsAWord ? [] : range(part.end, line.end),
  }
}

const typographic: Record<string, readonly [opening: string, closing: string]> = {'"': ['“', '”'], '\'': ['‘', '’']}

// The quotes that a word processor or a web page makes of straight quotes.
function typographicQuotes(random: Random, scanned: Scan, options: KindOptions = {}): Mistake | undefined {
  const {codePoints} = scanned
  const usable = (content: string) => !/[“”‘’]/.test(content)
  const values = scanned.strings.filter(part => !part.multiLine && usable(part.content))
  const quotedKeys: KeyPart[] = [...scanned.entries.flatMap(entry => entry.key.parts), ...scanned.headers.flatMap(header => header.name.parts)].filter(part => part.quoted && usable(part.text))
  if (values.length === 0) return undefined
  const hasOtherStrings = scanned.strings.length > values.length
  const every = options.scope === 'every' || (!hasOtherStrings && values.length > 1 && random.chance(0.55))
  const changed: {start: number, end: number}[] = every ? [...values, ...quotedKeys] : [random.pick(values)]
  const edits: Edit[] = changed.flatMap(part => {
    const [opening, closing] = typographic[codePoints[part.start]!]!
    return [replaceOneForOne(part.start, opening), replaceOneForOne(part.end - 1, closing)]
  })
  // The typographic quotes are in the class `other`, with every code point from U+0080 up. Without a class of their
  // own, the tables can only take the rest of the line for the string.
  const alone = changed.every(part => {
    const isLineValue = values.some(value => value.start === part.start && holderOf(scanned, value) === null)
    return isLineValue && restOfLine(scanned, part.end).onlySpace && codePoints.slice(part.start + 1, part.end - 1).every(character => character.codePointAt(0)! < 0x80)
  })
  return {edits, form: every ? `every string of the text, ${changed.length} of them` : 'one string value', reachable: 'yes', ...(alone ? {} : {needsClass: 'the typographic quotes'})}
}

function twoQuotesCloseMultiLine(random: Random, scanned: Scan): Mistake | undefined {
  const candidates = scanned.strings.filter(part => part.multiLine)
  if (candidates.length === 0) return undefined
  const part = random.pick(candidates)
  return {edits: [removeRange(part.end - 1, part.end)], form: `a string between three ${part.quote === '"' ? 'quotes' : 'apostrophes'}`, reachable: 'no'}
}

function lineFeedInString(random: Random, scanned: Scan): Mistake | undefined {
  const candidates = scanned.strings.filter(part => part.multiLine && part.content.includes('\n'))
  if (candidates.length === 0) return undefined
  const part = random.pick(candidates)
  // A quote right before a line end can start such a text, and a quote alone on a line can end it: both are read by
  // cells that no valid text reads. A quote inside the text would end the text early.
  const startsWithLineEnd = part.content.startsWith('\n') || part.content.startsWith('\r\n')
  const endsWithLineEnd = part.content.endsWith('\n')
  const holdsQuoteOrEscape = part.content.includes(part.quote) || part.hasEscape
  return {
    edits: [removeRange(part.start, part.start + 2), removeRange(part.end - 2, part.end)],
    form: `a text of ${part.content.split('\n').length} lines between single ${part.quote === '"' ? 'quotes' : 'apostrophes'}${startsWithLineEnd && endsWithLineEnd ? '' : ', a quote stands on a line of the text'}${holdsQuoteOrEscape ? ', the text holds a quote or an escape' : ''}`,
    reachable: startsWithLineEnd && endsWithLineEnd && !holdsQuoteOrEscape ? 'yes' : 'no',
  }
}

const isHexDigit = (character: string | undefined) => character !== undefined && /^[0-9A-Fa-f]$/.test(character)

// The code points after a backslash that every parser shows as an escape with it, as indexes: the backslash itself and
// what a valid escape holds after it, e.g. the t of \t and the hex digits of \u00e9.
function readsAsEscape(codePoints: readonly string[], backslash: number, multiLine: boolean): number[] {
  const next = codePoints[backslash + 1]
  if (next !== undefined && 'btnfr"\\'.includes(next)) return [backslash, backslash + 1]
  if (next === 'u' || next === 'U') {
    const indexes = [backslash, backslash + 1]
    for (let digit = backslash + 2; digit < backslash + 2 + (next === 'u' ? 4 : 8) && isHexDigit(codePoints[digit]); digit++) indexes.push(digit)
    return indexes
  }
  if (multiLine && (next === ' ' || next === '\t')) {
    const indexes = [backslash]
    for (let space = backslash + 1; codePoints[space] === ' ' || codePoints[space] === '\t'; space++) indexes.push(space)
    return indexes
  }
  return [backslash]
}

// A backslash that is content in a string between quotes, e.g. a Windows path or a regular expression: either the
// document has the text between apostrophes, where a backslash is a character like any other, or it has every
// backslash doubled.
function unescapedBackslash(random: Random, scanned: Scan): Mistake | undefined {
  const {codePoints, labels} = scanned
  const betweenApostrophes = scanned.strings.filter(part => part.quote === '\'' && part.content.includes('\\') && !part.content.includes('"'))
  const doubledIn = (part: StringPart) => {
    const backslashes: number[] = []
    for (let index = part.contentStart; index < part.contentEnd - 1; index++) {
      if (codePoints[index] !== '\\' || labels[index]!.kind !== displayKind.escape) continue
      if (codePoints[index + 1] === '\\') backslashes.push(index)
      index++
    }
    return backslashes
  }
  // A doubled backslash right before the closing quote is left out: with one backslash, the quote is escaped.
  const withDoubled = scanned.strings.filter(part => part.quote === '"' && doubledIn(part).length > 0 && !doubledIn(part).includes(part.contentEnd - 2))
  const form = drawForm(random, [['apostrophes', betweenApostrophes.length > 0 ? 1 : 0], ['doubled', withDoubled.length > 0 ? 1 : 0]] as const)
  if (form === undefined) return undefined
  if (form === 'apostrophes') {
    const part = random.pick(betweenApostrophes)
    const quoteLength = part.multiLine ? 3 : 1
    const unscoredKinds: number[] = []
    for (let index = part.contentStart; index < part.contentEnd; index++) {
      if (codePoints[index] !== '\\') continue
      const escape = readsAsEscape(codePoints, index, part.multiLine)
      unscoredKinds.push(...escape)
      index = escape.at(-1)!
    }
    return {
      edits: [...range(part.start, part.start + quoteLength), ...range(part.end - quoteLength, part.end)].map(index => replaceOneForOne(index, '"')),
      form: `a text with ${part.content.split('\\').length - 1} backslashes between ${part.multiLine ? 'three quotes' : 'quotes'}, where the document has apostrophes`, reachable: 'yes', unscoredKinds,
    }
  }
  const part = random.pick(withDoubled)
  const backslashes = doubledIn(part)
  // Of each pair one backslash is left, and it is shown as the start of an escape with what follows it.
  const unscoredKinds = backslashes.flatMap(index => [index, ...readsAsEscape(codePoints, index + 1, part.multiLine)])
  return {edits: backslashes.map(index => removeRange(index, index + 1)), form: `every doubled backslash of one string written once, ${backslashes.length} of them`, reachable: 'yes', unscoredKinds}
}

export const quoteKinds: KindDefinition[] = [
  {
    name: 'unquotedString', family: 'quote', weight: 3,
    description: 'A string value without its quotes, as YAML and INI files write one: one word, a version, a path, several words, or every string value of a table.',
    meant: 'name = "tiny-glob"\nversion = "0.4.1"\n', example: 'name = tiny-glob\nversion = "0.4.1"\n',
    alignment: 'The two quotes are removed. The content keeps its label, string. Where its start reads as a number or as true or false, e.g. the 0.4 of 0.4.1, the display kind is not scored.',
    reachable: 'Yes: a word that is no value, where a value is expected, is an error for the parser as it is, and can start a value that is shown as a string up to the end of the line, a comment, or a comma or bracket of its array. No for a word at the start of a line inside an array: after missingArrayBracket, a word there is the key of the next entry.',
    apply: unquotedString,
  },
  {
    name: 'missingClosingQuote', family: 'quote', weight: 3,
    description: 'A string value without its closing quote: at the end of its line, before a comment, or inside an array or an inline table.',
    meant: 'name = "tiny" # the crate\nedition = "2021"\n', example: 'name = "tiny # the crate\nedition = "2021"\n',
    alignment: 'The closing quote is removed. What the open string takes with it up to the end of the line, here the comment, keeps its label, and its display kind is not scored.',
    reachable: 'With the line rule: a string that is open at the end of its line ends there. The tokenizer as it is already goes back to between tokens at such a line end, by a cell that no valid text reads. No when more of an array or of an inline table follows on the line: the string takes the closing brackets with it, and a later quote is read in the opposite role.',
    apply: missingClosingQuote,
  },
  {
    name: 'missingOpeningQuote', family: 'quote', weight: 1,
    description: 'A string value without its opening quote.',
    meant: 'name = "tiny"\nedition = "2021"\n', example: 'name = tiny"\nedition = "2021"\n',
    alignment: 'The opening quote is removed. The content and the closing quote keep their label, string, with the start of the content as in unquotedString.',
    reachable: 'Yes when the closing quote stands after a letter or a digit: there it is read by a cell that no valid text reads, and can end the value. After another character, e.g. a period, the quote is read as the start of a string by a cell that valid TOML reads, and the line rule ends that string.',
    apply: missingOpeningQuote,
  },
  {
    name: 'typographicQuotes', family: 'quote', weight: 2,
    description: 'The quotes that a word processor or a web page makes of straight quotes, around one string or around every string of the text.',
    meant: 'title = "Harbor Relay" # shown in the tab\n', example: 'title = “Harbor Relay” # shown in the tab\n',
    alignment: 'Each typographic quote stands for the straight one and has its label, string.',
    reachable: 'Yes with a character class for these quotes. The tables have them in the class `other`, with every code point from U+0080 up, where the tokenizer as it is gives up on the rest of the line. Without the class, a parser can show a string that is the last thing on its line, and not a comment, a comma or a bracket after it.',
    apply: typographicQuotes,
  },
  {
    name: 'twoQuotesCloseMultiLine', family: 'quote', weight: 1,
    description: 'A string of several lines that is closed with two quotes where it takes three.',
    meant: 'run = """\ncargo fmt\ncargo test\n"""\nalias = "t"\n', example: 'run = """\ncargo fmt\ncargo test\n""\nalias = "t"\n',
    alignment: 'One of the three closing quotes is removed. Everything else is kept.',
    reachable: 'No: two quotes are content of such a string, so every parser that reads valid TOML as now is still inside the string, and stays there up to the next three quotes or the end of the text. The parser as it is reports its first error after the next three quotes at the earliest, so a sample has something to score only when the document has a second such string, or a second mistake.',
    apply: twoQuotesCloseMultiLine,
  },
  {
    name: 'lineFeedInString', family: 'quote', weight: 1,
    description: 'A text of several lines between single quotes, where TOML takes three.',
    meant: 'run = """\ncargo fmt\ncargo test\n"""\nalias = "t"\n', example: 'run = "\ncargo fmt\ncargo test\n"\nalias = "t"\n',
    alignment: 'Two of the three quotes are removed at each end. The lines of the text keep their label, string.',
    reachable: 'Yes with a grammar state of its own, when the text starts on the line after the opening quote, the closing quote has a line to itself, and the text holds no quote and no escape: a line end right after a quote is read by a cell that no valid text reads, and can open a state that shows every line as a string. No otherwise. The line rule alone ends the string at its first line end, and the lines of the text then read as entries.',
    apply: lineFeedInString,
  },
  {
    name: 'unescapedBackslash', family: 'quote', weight: 1,
    description: 'A backslash that is content in a string between quotes, e.g. a Windows path or a regular expression.',
    meant: 'log_dir = \'C:\\logs\\relay\'\n', example: 'log_dir = "C:\\logs\\relay"\n',
    alignment: 'Each quote stands for an apostrophe and has its label, string. In the other form, one backslash of two is removed. A backslash, and what reads as an escape after it, e.g. the r of \\r, keeps its label, and its display kind is not scored.',
    reachable: 'Yes: after a backslash, a character that starts no escape is read by a cell that no valid text reads, and that cell can go on with the string.',
    apply: unescapedBackslash,
  },
]
