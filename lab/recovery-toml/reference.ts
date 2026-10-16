// The labels of a valid TOML text in plain JavaScript: a hand-written scanner that follows TOML 1.0's grammar
// (toml.io/en/v1.0.0 and its ABNF) line by line, with a real stack, and that looks ahead where it likes. It reads
// kinds.ts for the names and the limits, and nothing of tables.ts or table-parser.ts, so that check-table-parser.ts can
// compare the two.
//
// It labels valid texts only: labelReference says that a text is not valid, and where the scanner stopped, and gives
// no labels for it.
//
// Valid means here what it means for the tables: the syntax of TOML 1.0, in at most 512 code points, with arrays and
// inline tables nested at most 16 deep. Not checked, as in the tables: a key or a table that is defined twice, the
// ranges inside a date or a time, e.g. the month 13, the size of an integer, and the code point that an escape names,
// e.g. \uD800.
//
// The rules that go past TOML's grammar are those of kinds.ts: a date, a time, `inf` and `nan` are shown as numbers,
// and the space between a date and a time as white space. In a string of several lines, a backslash at the end of a
// line and the white space between it and the line's end are shown as an escape, and the line's end as string.
import {capacity, containerArray, containerInlineTable, containerNone, displayKind, maximumDepth} from './kinds.ts'

export type ReferenceLabel = {
  // An index into kinds.ts's display kinds.
  kind: number
  // The number of open arrays and inline tables after the code point, e.g. 1 after the [ of `a = [1]` and 0 after its ].
  depth: number
  // The innermost open container after the code point: containerNone, containerInlineTable or containerArray.
  container: number
}

export type ReferenceResult =
  | {valid: true, labels: ReferenceLabel[]}
  // `position` is where the scanner stopped, which can be after the first code point that makes the text invalid.
  | {valid: false, position: number, reason: string}

export type ReferenceOptions = {
  // Texts of any length and any depth, for the files of the official test suite that are longer than 512 code points.
  withoutLimits?: boolean
  // What TOML 1.1 adds to TOML 1.0, one switch each. check-table-parser.ts uses them to explain why Bun's parser, which
  // reads TOML 1.1, accepts a text that the tables reject.
  // Line ends and comments between the braces of an inline table.
  linesInInlineTable?: boolean
  // A comma before the closing brace of an inline table.
  commaBeforeCloseBrace?: boolean
  // A time without seconds, e.g. 07:32.
  timeWithoutSeconds?: boolean
  // The escapes \e and \xHH.
  moreEscapes?: boolean
}

class InvalidText extends Error {
  position: number
  constructor(position: number, reason: string) {
    super(reason)
    this.position = position
  }
}

const isBareKeyCharacter = (character: string | undefined) => character !== undefined && /^[A-Za-z0-9_-]$/.test(character)
// The characters of a number, a date, a time or a literal.
const isWordCharacter = (character: string | undefined) => character !== undefined && /^[A-Za-z0-9_+\-.:]$/.test(character)
const isDigit = (character: string | undefined) => character !== undefined && character >= '0' && character <= '9'
const isHexDigit = (character: string | undefined) => character !== undefined && /^[0-9A-Fa-f]$/.test(character)
// A code point that neither a string nor a comment may hold as it is: below U+0020 other than a tab, and U+007F.
const isControl = (character: string) => (character < ' ' && character !== '\t') || character === '\u007f'

const decimal = '(0|[1-9](_?[0-9])*)'
const digitsWithUnderscores = '[0-9](_?[0-9])*'
const numberPattern = new RegExp(`^[+-]?${decimal}(\\.${digitsWithUnderscores})?([eE][+-]?${digitsWithUnderscores})?$`)
const prefixedPattern = /^0(x[0-9A-Fa-f](_?[0-9A-Fa-f])*|o[0-7](_?[0-7])*|b[01](_?[01])*)$/
const infinityOrNanPattern = /^[+-]?(inf|nan)$/
const datePattern = /^\d{4}-\d{2}-\d{2}$/
const offset = '([Zz]|[+-]\\d{2}:\\d{2})'
const timeOf = (withoutSeconds: boolean) => withoutSeconds ? '\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?' : '\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?'

export function labelReference(text: string, options: ReferenceOptions = {}): ReferenceResult {
  const characters = Array.from(text)
  const length = characters.length
  const withoutSeconds = options.timeWithoutSeconds === true
  const timePattern = new RegExp(`^${timeOf(withoutSeconds)}$`)
  const timeWithOffsetPattern = new RegExp(`^${timeOf(withoutSeconds)}${offset}?$`)
  const dateTimePattern = new RegExp(`^\\d{4}-\\d{2}-\\d{2}[Tt]${timeOf(withoutSeconds)}${offset}?$`)

  const labels: ReferenceLabel[] = []
  const stack: number[] = []
  let index = 0

  const fail = (reason: string, position = index): never => { throw new InvalidText(position, reason) }
  // Labels the code point at `index` and moves on.
  const mark = (kind: number) => {
    labels.push({kind, depth: stack.length, container: stack.at(-1) ?? containerNone})
    index++
  }
  const markRun = (count: number, kind: number) => { for (let marked = 0; marked < count; marked++) mark(kind) }
  const open = (container: number) => {
    if (options.withoutLimits !== true && stack.length === maximumDepth) fail('nested deeper than 16')
    stack.push(container)
    mark(displayKind.punctuation)
  }
  const close = () => {
    stack.pop()
    mark(displayKind.punctuation)
  }

  const skipSpaces = () => { while (characters[index] === ' ' || characters[index] === '\t') mark(displayKind.whitespace) }
  // A line feed, or a carriage return and a line feed. Returns false when there is no line end at `index`.
  const lineEnd = (kind: number) => {
    if (characters[index] === '\n') { mark(kind); return true }
    if (characters[index] !== '\r') return false
    if (characters[index + 1] !== '\n') fail('a carriage return without a line feed')
    markRun(2, kind)
    return true
  }
  // A comment up to the end of its line, without the line's end.
  const comment = () => {
    while (index < length && characters[index] !== '\n' && characters[index] !== '\r') {
      if (isControl(characters[index]!)) fail('a control character in a comment')
      mark(displayKind.comment)
    }
  }
  // White space, comments and line ends, which may stand between the values of an array.
  const skipSpacesCommentsAndLines = () => {
    for (;;) {
      skipSpaces()
      if (characters[index] === '#') comment()
      if (!lineEnd(displayKind.whitespace)) return
    }
  }

  // The hex digits of an escape, e.g. the 4 after \u.
  const hexDigits = (count: number) => {
    for (let digit = 0; digit < count; digit++) {
      if (!isHexDigit(characters[index])) fail('an escape with too few hex digits')
      mark(displayKind.escape)
    }
  }
  // An escape in a string in quotes, from its backslash on. In a string of several lines a backslash may also end a
  // line, with white space between it and the line's end.
  const escape = (multiLine: boolean) => {
    mark(displayKind.escape)
    const escaped = characters[index]
    if (escaped !== undefined && 'btnfr"\\'.includes(escaped)) return mark(displayKind.escape)
    if (escaped === 'u' || escaped === 'U') {
      mark(displayKind.escape)
      return hexDigits(escaped === 'u' ? 4 : 8)
    }
    if (options.moreEscapes === true && escaped === 'e') return mark(displayKind.escape)
    if (options.moreEscapes === true && escaped === 'x') {
      mark(displayKind.escape)
      return hexDigits(2)
    }
    if (!multiLine) fail('an unknown escape')
    while (characters[index] === ' ' || characters[index] === '\t') mark(displayKind.escape)
    if (!lineEnd(displayKind.string)) fail('an unknown escape')
  }

  // A string in quotes or in apostrophes, from its first quote on. `kind` is what its quotes and its characters are
  // shown as: a string, a key or a header name. Only a value may be a string of several lines.
  const string = (kind: number, mayBeMultiLine: boolean) => {
    const quote = characters[index]!
    const hasEscapes = quote === '"'
    if (mayBeMultiLine && characters[index + 1] === quote && characters[index + 2] === quote) {
      markRun(3, kind)
      for (;;) {
        const character = characters[index]
        if (character === undefined) fail('the text ends inside a string')
        else if (character === quote) {
          // Three quotes close the string. Up to two quotes may stand right before them, so of a run of quotes the
          // first five belong to the string, and a sixth one is after it.
          let run = 1
          while (characters[index + run] === quote) run++
          markRun(Math.min(run, 5), kind)
          if (run >= 3) return
        } else if (character === '\\' && hasEscapes) escape(true)
        else if (lineEnd(kind)) continue
        else if (isControl(character)) fail('a control character in a string')
        else mark(kind)
      }
    }
    mark(kind)
    for (;;) {
      const character = characters[index]
      if (character === undefined) fail('the text ends inside a string')
      else if (character === quote) return mark(kind)
      else if (character === '\\' && hasEscapes) escape(false)
      else if (isControl(character)) fail('a control character or a line end in a string')
      else mark(kind)
    }
  }

  // A key: parts in quotes or without, with dots between them, and white space around the dots.
  const key = (kind: number) => {
    for (;;) {
      const character = characters[index]
      if (character === '"' || character === '\'') string(kind, false)
      else if (isBareKeyCharacter(character)) { while (isBareKeyCharacter(characters[index])) mark(kind) }
      else fail('expected a key')
      skipSpaces()
      if (characters[index] !== '.') return
      mark(displayKind.punctuation)
      skipSpaces()
    }
  }

  // A number, a date, a time or a literal: the run of characters that these hold, checked as a whole.
  const word = () => {
    let end = index
    while (isWordCharacter(characters[end])) end++
    const run = characters.slice(index, end).join('')
    if (run === '') fail('expected a value')
    if (run === 'true' || run === 'false') return markRun(end - index, displayKind.literal)
    // A date, one space and a digit: a time has to follow.
    if (datePattern.test(run) && characters[end] === ' ' && isDigit(characters[end + 1])) {
      let timeEnd = end + 1
      while (isWordCharacter(characters[timeEnd])) timeEnd++
      if (!timeWithOffsetPattern.test(characters.slice(end + 1, timeEnd).join(''))) fail('a date, a space and something that is no time', end + 1)
      markRun(end - index, displayKind.number)
      mark(displayKind.whitespace)
      return markRun(timeEnd - end - 1, displayKind.number)
    }
    const isValue = numberPattern.test(run) || prefixedPattern.test(run) || infinityOrNanPattern.test(run) || datePattern.test(run)
      || timePattern.test(run) || dateTimePattern.test(run)
    if (!isValue) fail(`${run} is no value`)
    markRun(end - index, displayKind.number)
  }

  const value = () => {
    const character = characters[index]
    if (character === '"' || character === '\'') return string(displayKind.string, true)
    if (character === '[') return array()
    if (character === '{') return inlineTable()
    word()
  }

  // The values of an array may stand on several lines, with comments, and a comma may follow the last one.
  const array = () => {
    open(containerArray)
    for (;;) {
      skipSpacesCommentsAndLines()
      if (characters[index] === ']') return close()
      value()
      skipSpacesCommentsAndLines()
      if (characters[index] === ',') mark(displayKind.punctuation)
      else if (characters[index] !== ']') fail('expected a comma or the ] of an array')
    }
  }

  const keyAndValue = () => {
    key(displayKind.key)
    if (characters[index] !== '=') fail('expected an equals sign')
    mark(displayKind.punctuation)
    skipSpaces()
    value()
  }

  // An inline table stands on one line, and no comma may follow its last value.
  const inlineTable = () => {
    const skip = options.linesInInlineTable === true ? skipSpacesCommentsAndLines : skipSpaces
    open(containerInlineTable)
    skip()
    if (characters[index] === '}') return close()
    for (;;) {
      keyAndValue()
      skip()
      if (characters[index] === '}') return close()
      if (characters[index] !== ',') fail('expected a comma or the } of an inline table')
      mark(displayKind.punctuation)
      skip()
      if (options.commaBeforeCloseBrace === true && characters[index] === '}') return close()
    }
  }

  // [name] or [[name]]. The two brackets of [[ and of ]] stand side by side.
  const header = () => {
    const brackets = characters[index + 1] === '[' ? 2 : 1
    markRun(brackets, displayKind.punctuation)
    skipSpaces()
    key(displayKind.headerName)
    for (let bracket = 0; bracket < brackets; bracket++) {
      if (characters[index] !== ']') fail('expected the ] of a header')
      mark(displayKind.punctuation)
    }
  }

  try {
    if (options.withoutLimits !== true && length > capacity) fail('more than 512 code points', capacity)
    while (index < length) {
      skipSpaces()
      const character = characters[index]
      if (character === '[') header()
      else if (character !== undefined && character !== '#' && character !== '\n' && character !== '\r') keyAndValue()
      skipSpaces()
      if (characters[index] === '#') comment()
      if (index < length && !lineEnd(displayKind.whitespace)) fail('expected the end of the line')
    }
  } catch (error) {
    if (error instanceof InvalidText) return {valid: false, position: error.position, reason: error.message}
    throw error
  }
  return {valid: true, labels}
}
