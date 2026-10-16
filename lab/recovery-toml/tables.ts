// The tables of a TOML highlighter in the form of the JSON highlighter's tables in src/json-search/highlighter/tables.ts:
// a character class per code point, the tokenizer's transition and event tables, small tables per event, the grammar's
// transition, stack action and error tables, and the display table. Each table comes from a transition function
// written from TOML 1.0's grammar (toml.io/en/v1.0.0 and its ABNF) and the rules in kinds.ts, e.g.
// lexerStep(state, characterClass). reference.ts implements the same rules as a hand-written scanner, without these
// tables, and check-table-parser.ts compares the two.
//
// What TOML asks of this form that JSON does not: a word without quotes is a key or a value by where it stands, e.g.
// `1979-05-27 = 1` and `a = 1979-05-27` are both valid, and so are `true = 1` and `1.5 = 2`, where `1.5` is the key `5`
// of the table `1`. The tokenizer reads a character from its own state and the character's class alone. It can't know
// where a word stands: a comma is followed by a key in an inline table and by a value in an array, and a line start is
// followed by a key at the top level and by a value inside an array of several lines. So the tokenizer follows a word
// as a key and as a value at once, and its events say which of the two readings a character ends, e.g. the x of `12x`
// ends the reading as a value. The grammar, which knows where the word stands, rejects the reading that is not the
// one in place. See "Words" below.
import {displayKind, errorKind, maximumDepth} from './kinds.ts'

// Character classes. Letters that matter to one or more tokens get their own class, e.g. `e` is a hex digit, an
// exponent and a letter of true and false. The digits are split by the bases that hold them: 0 and 1 are binary
// digits, 2 to 7 octal ones. A control character is a code point below U+0020 other than tab, line feed and carriage
// return, or U+007F. Every code point from U+0080 up is `other`, like the ASCII characters that only strings and
// comments hold, e.g. `!`. `end` marks a cell after the text, and `truncatedEnd` the position after the 512th code
// point when the text is longer.
const characterClasses = [
  'end', 'truncatedEnd', 'space', 'tab', 'lineFeed', 'carriageReturn', 'control', 'quote', 'apostrophe', 'backslash',
  'hash', 'equals', 'dot', 'comma', 'openBracket', 'closeBracket', 'openBrace', 'closeBrace', 'colon', 'plus', 'minus',
  'underscore', 'zero', 'one', 'digit2To7', 'digit8Or9', 'a', 'b', 'e', 'f', 'i', 'l', 'n', 'o', 'r', 's', 't', 'u', 'x',
  'z', 'otherHexLetter', 'capitalE', 'capitalT', 'capitalU', 'capitalZ', 'otherLetter', 'other',
] as const
type CharacterClass = typeof characterClasses[number]
export const classNames = characterClasses
export const classCount = characterClasses.length
const classIndex = (name: CharacterClass) => characterClasses.indexOf(name)

// The class of a code point up to U+0080. The parser reads classTable[codePoint + 1], where entry 0 is `end` for the
// empty cell value -1, and a code point past the table clamps to its last entry, U+0080, which is `other`.
function classOfCodePoint(codePoint: number): CharacterClass {
  if (codePoint === -1) return 'end'
  if (codePoint === 0x20) return 'space'
  if (codePoint === 0x09) return 'tab'
  if (codePoint === 0x0a) return 'lineFeed'
  if (codePoint === 0x0d) return 'carriageReturn'
  if (codePoint < 0x20 || codePoint === 0x7f) return 'control'
  if (codePoint >= 0x80) return 'other'
  const character = String.fromCodePoint(codePoint)
  if (character === '0') return 'zero'
  if (character === '1') return 'one'
  if (character >= '2' && character <= '7') return 'digit2To7'
  if (character === '8' || character === '9') return 'digit8Or9'
  const named: {[character: string]: CharacterClass} = {
    '"': 'quote', '\'': 'apostrophe', '\\': 'backslash', '#': 'hash', '=': 'equals', '.': 'dot', ',': 'comma',
    '[': 'openBracket', ']': 'closeBracket', '{': 'openBrace', '}': 'closeBrace', ':': 'colon', '+': 'plus', '-': 'minus',
    '_': 'underscore', 'E': 'capitalE', 'T': 'capitalT', 'U': 'capitalU', 'Z': 'capitalZ',
  }
  const name = named[character]
  if (name !== undefined) return name
  if ('abefilnorstuxz'.includes(character)) return character as CharacterClass
  if ('cdABCDF'.includes(character)) return 'otherHexLetter'
  if (/^[A-Za-z]$/.test(character)) return 'otherLetter'
  return 'other'
}

export const classTable: readonly number[] = Array.from({length: 130}, (_, entry) => classIndex(classOfCodePoint(entry - 1)))

// Tokenizer states, by what was read.
//
// Between tokens: `afterOpenBracket` and `afterCloseBracket` are `between` right after a `[` or a `]`, where a second
// bracket is the second one of `[[` or `]]`. `carriageReturn` expects a line feed. `comment` is inside a comment.
//
// Strings: `basicOpen` is after the first quote, `basicEmpty` after two quotes, which are an empty string unless a
// third quote follows and starts a string of several lines. `basicHex4` expects 4 more hex digits of an escape. In a
// string of several lines, `multiBasicQuote1` and `multiBasicQuote2` are after one and two quotes that may be content
// or the start of the closing quotes, and `multiBasicEnd3` and `multiBasicEnd4` after three and four quotes, where
// the string may be over or go on with one more quote: up to two quotes may stand before the closing three.
// `multiBasicEscapeSpaces` is after a backslash and white space, which only the end of the line may follow. The
// states of strings in apostrophes have the same names with `literal`.
//
// Words, see "Words" below. `errorLine` follows a tokenizer error up to the next line feed, where tokenizing starts
// again, as in the JSON tables.
const lexerStates = [
  'between', 'afterOpenBracket', 'afterCloseBracket', 'carriageReturn', 'comment',
  'basicOpen', 'basicEmpty', 'basic', 'basicEscape',
  'basicHex8', 'basicHex7', 'basicHex6', 'basicHex5', 'basicHex4', 'basicHex3', 'basicHex2', 'basicHex1',
  'multiBasic', 'multiBasicQuote1', 'multiBasicQuote2', 'multiBasicEnd3', 'multiBasicEnd4', 'multiBasicCarriageReturn',
  'multiBasicEscape', 'multiBasicEscapeSpaces',
  'multiBasicHex8', 'multiBasicHex7', 'multiBasicHex6', 'multiBasicHex5', 'multiBasicHex4', 'multiBasicHex3', 'multiBasicHex2', 'multiBasicHex1',
  'literalOpen', 'literalEmpty', 'literal',
  'multiLiteral', 'multiLiteralQuote1', 'multiLiteralQuote2', 'multiLiteralEnd3', 'multiLiteralEnd4', 'multiLiteralCarriageReturn',
  'bareKey', 'zero', 'leadingZero2', 'leadingZero3', 'leadingZero4', 'digits1', 'digits2', 'digits3', 'digits4', 'integer',
  'integerUnderscore', 'sign', 'signedZero', 'hexExpected', 'hex', 'octalExpected', 'octal', 'binaryExpected', 'binary',
  'afterNumberDot', 'fraction', 'fractionUnderscore', 'exponentLetter', 'exponentExpected', 'exponent',
  't', 'tr', 'tru', 'f', 'fa', 'fal', 'fals', 'i', 'in', 'n', 'na', 'valueEnd',
  'yearDash', 'month1', 'month2', 'monthDash', 'day1', 'day2', 'dateSpace', 'dateT', 'hour1', 'hour2', 'hourColon',
  'minute1', 'minute2', 'minuteColon', 'second1', 'second2', 'secondDot', 'secondFraction',
  'offsetSign', 'offsetHour1', 'offsetHour2', 'offsetColon', 'offsetMinute1',
  'localHourColon', 'localMinute1', 'localMinute2', 'localMinuteColon', 'localSecond1', 'localSecond2', 'localSecondDot', 'localSecondFraction',
  'errorLine',
] as const
type LexerState = typeof lexerStates[number]
export const lexerStateNames = lexerStates
export const lexerStateCount = lexerStates.length

// What one character does, from the tokenizer state before it and its class.
//
// - `newline` is the end of a line outside a string: a line feed, or the carriage return of a carriage return and a
//   line feed. The line feed after a carriage return is `whitespace`. So the grammar reads the end of the line at its
//   first code point, and a line end where none may stand is an error there, e.g. inside an inline table.
// - `commentStart` is the # of a comment, and `commentContent` the rest of the comment.
// - `adjacentOpenBracket` is a `[` right after a `[`, and `adjacentCloseBracket` a `]` right after a `]`: the second
//   bracket of `[[servers]]`, and of the array `[[1]]`.
// - `multiLineStart` is the third quote of `"""` or `'''`.
// - The events from `numberStart` to `closeBracketAfterKey` are those of words, see "Words" below.
// - `badValue` is a number, a date, a time or a literal that breaks off, where nothing that may follow a key follows.
const lexerEvents = [
  'whitespace', 'newline', 'commentStart', 'commentContent', 'equals', 'dot', 'comma', 'openBracket', 'adjacentOpenBracket', 'closeBracket',
  'adjacentCloseBracket', 'openBrace', 'closeBrace', 'stringStart', 'stringContent', 'stringEnd', 'multiLineStart', 'escape',
  'numberStart', 'numberContent', 'literalStart', 'literalContent', 'keyStart', 'keyContent', 'signStart', 'becomesKey',
  'becomesValue', 'numberDot', 'fractionStart', 'whitespaceAfterKey', 'closeBracketAfterKey',
  'unexpectedCharacter', 'controlCharacterInString', 'controlCharacterInComment', 'bareCarriageReturn', 'badEscape',
  'badUnicodeEscape', 'badValue', 'errorContinuation', 'end', 'endInsideToken', 'truncatedEnd',
] as const
type LexerEvent = typeof lexerEvents[number]
export const eventNames = lexerEvents
export const eventCount = lexerEvents.length

type Step = readonly [next: LexerState, event: LexerEvent]

const isDigit = (characterClass: CharacterClass) =>
  characterClass === 'zero' || characterClass === 'one' || characterClass === 'digit2To7' || characterClass === 'digit8Or9'
const isOctalDigit = (characterClass: CharacterClass) => characterClass === 'zero' || characterClass === 'one' || characterClass === 'digit2To7'
const isBinaryDigit = (characterClass: CharacterClass) => characterClass === 'zero' || characterClass === 'one'
const hexLetters: readonly CharacterClass[] = ['a', 'b', 'e', 'f', 'otherHexLetter', 'capitalE']
const isHexDigit = (characterClass: CharacterClass) => isDigit(characterClass) || hexLetters.includes(characterClass)
const lettersThatAreNoHexDigit: readonly CharacterClass[] = ['i', 'l', 'n', 'o', 'r', 's', 't', 'u', 'x', 'z', 'capitalT', 'capitalU', 'capitalZ', 'otherLetter']
// A character of a key without quotes: a letter, a digit, an underscore or a dash.
const isKeyCharacter = (characterClass: CharacterClass) =>
  isHexDigit(characterClass) || lettersThatAreNoHexDigit.includes(characterClass) || characterClass === 'underscore' || characterClass === 'minus'
const isExponentLetter = (characterClass: CharacterClass) => characterClass === 'e' || characterClass === 'capitalE'
const isSpaceOrTab = (characterClass: CharacterClass) => characterClass === 'space' || characterClass === 'tab'
// The characters after a backslash that make an escape of two characters: \" \\ \b \f \n \r \t.
const simpleEscapes: readonly CharacterClass[] = ['quote', 'backslash', 'b', 'f', 'n', 'r', 't']

// A tokenizer error at a character. A line feed starts tokenizing again right away, and any other character starts an
// error line.
const lexerError = (characterClass: CharacterClass, event: LexerEvent): Step =>
  [characterClass === 'lineFeed' ? 'between' : 'errorLine', event]

// A character that starts a token, or white space between tokens.
function startToken(characterClass: CharacterClass): Step {
  switch (characterClass) {
    case 'space': case 'tab': return ['between', 'whitespace']
    case 'lineFeed': return ['between', 'newline']
    case 'carriageReturn': return ['carriageReturn', 'newline']
    case 'hash': return ['comment', 'commentStart']
    case 'quote': return ['basicOpen', 'stringStart']
    case 'apostrophe': return ['literalOpen', 'stringStart']
    case 'equals': return ['between', 'equals']
    case 'dot': return ['between', 'dot']
    case 'comma': return ['between', 'comma']
    case 'openBracket': return ['afterOpenBracket', 'openBracket']
    case 'closeBracket': return ['afterCloseBracket', 'closeBracket']
    case 'openBrace': return ['between', 'openBrace']
    case 'closeBrace': return ['between', 'closeBrace']
    case 'plus': return ['sign', 'signStart']
    case 'minus': return ['sign', 'numberStart']
    case 'zero': return ['zero', 'numberStart']
    case 'one': case 'digit2To7': case 'digit8Or9': return ['digits1', 'numberStart']
    case 't': return ['t', 'literalStart']
    case 'f': return ['f', 'literalStart']
    case 'i': return ['i', 'numberStart']
    case 'n': return ['n', 'numberStart']
    case 'underscore': case 'a': case 'b': case 'e': case 'l': case 'o': case 'r': case 's': case 'u': case 'x': case 'z':
    case 'otherHexLetter': case 'capitalE': case 'capitalT': case 'capitalU': case 'capitalZ': case 'otherLetter':
      return ['bareKey', 'keyStart']
    case 'end': return ['between', 'end']
    case 'truncatedEnd': return ['between', 'truncatedEnd']
    case 'control': case 'backslash': case 'colon': case 'other':
      return lexerError(characterClass, 'unexpectedCharacter')
  }
}

// Inside a token that isn't complete yet, e.g. inside a string or after `0x`: the end of the text is unexpectedEnd,
// the 513th code point is tooLong, and every other character that doesn't continue the token is an error of the given
// kind.
function continueOr(characterClass: CharacterClass, continued: Step | null, error: LexerEvent): Step {
  if (continued !== null) return continued
  if (characterClass === 'end') return ['between', 'endInsideToken']
  if (characterClass === 'truncatedEnd') return ['between', 'truncatedEnd']
  return lexerError(characterClass, error)
}

// A character inside a string in quotes of one line.
function basicCharacter(characterClass: CharacterClass): Step {
  if (characterClass === 'quote') return ['between', 'stringEnd']
  if (characterClass === 'backslash') return ['basicEscape', 'escape']
  const endsLine = characterClass === 'lineFeed' || characterClass === 'carriageReturn' || characterClass === 'end' || characterClass === 'truncatedEnd'
  return continueOr(characterClass, characterClass === 'control' || endsLine ? null : ['basic', 'stringContent'], 'controlCharacterInString')
}

// A character inside a string in quotes of several lines. A quote may be content or the first of the closing three.
function multiBasicCharacter(characterClass: CharacterClass): Step {
  if (characterClass === 'quote') return ['multiBasicQuote1', 'stringContent']
  if (characterClass === 'backslash') return ['multiBasicEscape', 'escape']
  if (characterClass === 'carriageReturn') return ['multiBasicCarriageReturn', 'stringContent']
  const endsText = characterClass === 'end' || characterClass === 'truncatedEnd'
  return continueOr(characterClass, characterClass === 'control' || endsText ? null : ['multiBasic', 'stringContent'], 'controlCharacterInString')
}

// A character inside a string in apostrophes of one line, which has no escapes.
function literalCharacter(characterClass: CharacterClass): Step {
  if (characterClass === 'apostrophe') return ['between', 'stringEnd']
  const endsLine = characterClass === 'lineFeed' || characterClass === 'carriageReturn' || characterClass === 'end' || characterClass === 'truncatedEnd'
  return continueOr(characterClass, characterClass === 'control' || endsLine ? null : ['literal', 'stringContent'], 'controlCharacterInString')
}

function multiLiteralCharacter(characterClass: CharacterClass): Step {
  if (characterClass === 'apostrophe') return ['multiLiteralQuote1', 'stringContent']
  if (characterClass === 'carriageReturn') return ['multiLiteralCarriageReturn', 'stringContent']
  const endsText = characterClass === 'end' || characterClass === 'truncatedEnd'
  return continueOr(characterClass, characterClass === 'control' || endsText ? null : ['multiLiteral', 'stringContent'], 'controlCharacterInString')
}

// The character after a backslash in a string in quotes, where `content` is the state inside the string and `hex4`
// and `hex8` are the states that expect the hex digits of \u and \U.
function escapedCharacter(characterClass: CharacterClass, content: LexerState, hex4: LexerState, hex8: LexerState): Step {
  const continued: Step | null = simpleEscapes.includes(characterClass) ? [content, 'escape']
    : characterClass === 'u' ? [hex4, 'escape']
    : characterClass === 'capitalU' ? [hex8, 'escape']
    : null
  return continueOr(characterClass, continued, 'badEscape')
}

const hexDigitOfEscape = (characterClass: CharacterClass, next: LexerState): Step =>
  continueOr(characterClass, isHexDigit(characterClass) ? [next, 'escape'] : null, 'badUnicodeEscape')

// Words. A word is a run of characters without quotes: a key such as `port`, or a number, a date, a time, `true`,
// `false`, `inf` or `nan`. The tokenizer follows both readings, and its events tell the grammar what the word can be:
//
// - `numberStart` and `literalStart` start a word that can be a key or a value, e.g. the 8 of `8080`, the - of `-1`
//   and the t of `true`. `numberContent` and `literalContent` go on with one. They are shown as a key in a key
//   position and as a number or a literal in a value position.
// - `keyStart` starts a word that can only be a key, e.g. the p of `port`, and `keyContent` goes on with one.
// - `signStart` is a + that starts a number. No key holds a +.
// - `becomesKey` is a character after which the word is a key and no value, e.g. the x of `12x`, the u of `tuna` and
//   the second 0 of `-00`.
// - `becomesValue` is a character after which the word is a value and no key: the first : of a time, the + of `1e+5`,
//   and the first digit of the time in `1979-05-27 07:32:00`, where two keys can't stand side by side.
// - `numberDot` is a dot right after the digits of a decimal number. It is the dot of a fraction when the word is a
//   value, and it separates two parts of a dotted key when the word is a key. `fractionStart` is a digit right after
//   that dot: the first digit of the fraction, or the first character of the next part of the key.
// - `whitespaceAfterKey` is a space or a tab after a word that is a key and no complete value, e.g. after `tru`,
//   `1979-05` or `0x`. `closeBracketAfterKey` is a `]` after such a word. It closes the header `[tru]`, and it is an
//   error in the array `[tru]`.
//
// A word that is complete as a value, e.g. `12` or `true`, ends at any character that no key holds, and that
// character is read as between tokens.

// The character after a word that can be a key, when the character doesn't go on with the word as a value.
// `complete` says that the word so far is a whole value, e.g. `12`, and not e.g. `12_`.
function endWord(characterClass: CharacterClass, complete: boolean): Step {
  if (isKeyCharacter(characterClass)) return ['bareKey', 'becomesKey']
  // An equals sign and a dot may follow a key, and neither may follow a value, so the grammar rejects them after one.
  if (complete || characterClass === 'equals' || characterClass === 'dot') return startToken(characterClass)
  if (isSpaceOrTab(characterClass)) return ['between', 'whitespaceAfterKey']
  if (characterClass === 'closeBracket') return ['afterCloseBracket', 'closeBracketAfterKey']
  // Nothing else may follow a key, e.g. a comma or the end of the line, so the word is neither a key nor a value.
  return continueOr(characterClass, null, 'badValue')
}

// The character after a word that holds a character that no key holds, e.g. after `07:32`, when the character
// doesn't go on with the word. `complete` says that the word so far is a whole value.
function endValue(characterClass: CharacterClass, complete: boolean): Step {
  if (complete && !isKeyCharacter(characterClass)) return startToken(characterClass)
  return continueOr(characterClass, null, 'badValue')
}

// After the digits of a decimal integer: an underscore, the dot of a fraction, or the letter of an exponent.
function afterInteger(characterClass: CharacterClass): Step | null {
  if (characterClass === 'underscore') return ['integerUnderscore', 'numberContent']
  if (characterClass === 'dot') return ['afterNumberDot', 'numberDot']
  if (isExponentLetter(characterClass)) return ['exponentLetter', 'numberContent']
  return null
}

const wordContent = (state: LexerState): Step => [state, 'numberContent']
// A digit goes on to `next`. Any other character ends a word that can be a key, or a word that can only be a value.
const digitOrEndWord = (characterClass: CharacterClass, next: LexerState, complete: boolean): Step =>
  isDigit(characterClass) ? wordContent(next) : endWord(characterClass, complete)
const digitOrEndValue = (characterClass: CharacterClass, next: LexerState): Step =>
  isDigit(characterClass) ? wordContent(next) : endValue(characterClass, false)
// A letter of true or false: `expected` goes on to `next`.
const literalLetter = (characterClass: CharacterClass, expected: CharacterClass, next: LexerState): Step =>
  characterClass === expected ? [next, 'literalContent'] : endWord(characterClass, false)
// A letter of inf or nan, which are shown as numbers, see kinds.ts.
const numberLetter = (characterClass: CharacterClass, expected: CharacterClass, next: LexerState): Step =>
  characterClass === expected ? wordContent(next) : endWord(characterClass, false)
// After the seconds of a time that follows a date: Z or an offset such as +07:00 may follow.
function afterSecondsOfDateTime(characterClass: CharacterClass): Step | null {
  if (characterClass === 'capitalZ' || characterClass === 'z') return wordContent('valueEnd')
  if (characterClass === 'plus' || characterClass === 'minus') return wordContent('offsetSign')
  return null
}

function lexerStep(state: LexerState, characterClass: CharacterClass): Step {
  const digit = isDigit(characterClass)
  switch (state) {
    case 'between': return startToken(characterClass)
    case 'afterOpenBracket': return characterClass === 'openBracket' ? ['afterOpenBracket', 'adjacentOpenBracket'] : startToken(characterClass)
    case 'afterCloseBracket': return characterClass === 'closeBracket' ? ['afterCloseBracket', 'adjacentCloseBracket'] : startToken(characterClass)
    case 'carriageReturn': return continueOr(characterClass, characterClass === 'lineFeed' ? ['between', 'whitespace'] : null, 'bareCarriageReturn')
    case 'comment':
      // A comment runs to the end of its line, and the end of the text may end it.
      if (characterClass === 'lineFeed' || characterClass === 'carriageReturn' || characterClass === 'end' || characterClass === 'truncatedEnd') return startToken(characterClass)
      return characterClass === 'control' ? lexerError(characterClass, 'controlCharacterInComment') : ['comment', 'commentContent']

    case 'basicOpen': return characterClass === 'quote' ? ['basicEmpty', 'stringEnd'] : basicCharacter(characterClass)
    case 'basicEmpty': return characterClass === 'quote' ? ['multiBasic', 'multiLineStart'] : startToken(characterClass)
    case 'basic': return basicCharacter(characterClass)
    case 'basicEscape': return escapedCharacter(characterClass, 'basic', 'basicHex4', 'basicHex8')
    case 'basicHex8': return hexDigitOfEscape(characterClass, 'basicHex7')
    case 'basicHex7': return hexDigitOfEscape(characterClass, 'basicHex6')
    case 'basicHex6': return hexDigitOfEscape(characterClass, 'basicHex5')
    case 'basicHex5': return hexDigitOfEscape(characterClass, 'basicHex4')
    case 'basicHex4': return hexDigitOfEscape(characterClass, 'basicHex3')
    case 'basicHex3': return hexDigitOfEscape(characterClass, 'basicHex2')
    case 'basicHex2': return hexDigitOfEscape(characterClass, 'basicHex1')
    case 'basicHex1': return hexDigitOfEscape(characterClass, 'basic')

    case 'multiBasic': return multiBasicCharacter(characterClass)
    case 'multiBasicQuote1': return characterClass === 'quote' ? ['multiBasicQuote2', 'stringContent'] : multiBasicCharacter(characterClass)
    case 'multiBasicQuote2': return characterClass === 'quote' ? ['multiBasicEnd3', 'stringEnd'] : multiBasicCharacter(characterClass)
    // Three quotes close the string, and up to two more quotes may follow them: then the first quotes were content.
    case 'multiBasicEnd3': return characterClass === 'quote' ? ['multiBasicEnd4', 'stringEnd'] : startToken(characterClass)
    case 'multiBasicEnd4': return characterClass === 'quote' ? ['between', 'stringEnd'] : startToken(characterClass)
    case 'multiBasicCarriageReturn': return continueOr(characterClass, characterClass === 'lineFeed' ? ['multiBasic', 'stringContent'] : null, 'bareCarriageReturn')
    case 'multiBasicEscape':
      // A backslash at the end of a line, with or without white space before the line's end, joins two lines.
      if (isSpaceOrTab(characterClass)) return ['multiBasicEscapeSpaces', 'escape']
      if (characterClass === 'lineFeed') return ['multiBasic', 'stringContent']
      if (characterClass === 'carriageReturn') return ['multiBasicCarriageReturn', 'stringContent']
      return escapedCharacter(characterClass, 'multiBasic', 'multiBasicHex4', 'multiBasicHex8')
    case 'multiBasicEscapeSpaces':
      if (isSpaceOrTab(characterClass)) return ['multiBasicEscapeSpaces', 'escape']
      if (characterClass === 'lineFeed') return ['multiBasic', 'stringContent']
      if (characterClass === 'carriageReturn') return ['multiBasicCarriageReturn', 'stringContent']
      return continueOr(characterClass, null, 'badEscape')
    case 'multiBasicHex8': return hexDigitOfEscape(characterClass, 'multiBasicHex7')
    case 'multiBasicHex7': return hexDigitOfEscape(characterClass, 'multiBasicHex6')
    case 'multiBasicHex6': return hexDigitOfEscape(characterClass, 'multiBasicHex5')
    case 'multiBasicHex5': return hexDigitOfEscape(characterClass, 'multiBasicHex4')
    case 'multiBasicHex4': return hexDigitOfEscape(characterClass, 'multiBasicHex3')
    case 'multiBasicHex3': return hexDigitOfEscape(characterClass, 'multiBasicHex2')
    case 'multiBasicHex2': return hexDigitOfEscape(characterClass, 'multiBasicHex1')
    case 'multiBasicHex1': return hexDigitOfEscape(characterClass, 'multiBasic')

    case 'literalOpen': return characterClass === 'apostrophe' ? ['literalEmpty', 'stringEnd'] : literalCharacter(characterClass)
    case 'literalEmpty': return characterClass === 'apostrophe' ? ['multiLiteral', 'multiLineStart'] : startToken(characterClass)
    case 'literal': return literalCharacter(characterClass)
    case 'multiLiteral': return multiLiteralCharacter(characterClass)
    case 'multiLiteralQuote1': return characterClass === 'apostrophe' ? ['multiLiteralQuote2', 'stringContent'] : multiLiteralCharacter(characterClass)
    case 'multiLiteralQuote2': return characterClass === 'apostrophe' ? ['multiLiteralEnd3', 'stringEnd'] : multiLiteralCharacter(characterClass)
    case 'multiLiteralEnd3': return characterClass === 'apostrophe' ? ['multiLiteralEnd4', 'stringEnd'] : startToken(characterClass)
    case 'multiLiteralEnd4': return characterClass === 'apostrophe' ? ['between', 'stringEnd'] : startToken(characterClass)
    case 'multiLiteralCarriageReturn': return continueOr(characterClass, characterClass === 'lineFeed' ? ['multiLiteral', 'stringContent'] : null, 'bareCarriageReturn')

    case 'bareKey': return isKeyCharacter(characterClass) ? ['bareKey', 'keyContent'] : startToken(characterClass)

    // Decimal numbers. The first four digits are counted, because two digits and a colon start a time, e.g. `07:32:00`,
    // and four digits and a dash start a date. A number may not start with a zero that a digit follows, and a time and
    // a date may: `leadingZero2` to `leadingZero4` are no values unless a colon or a dash follows.
    case 'zero':
      if (digit) return wordContent('leadingZero2')
      if (characterClass === 'x') return wordContent('hexExpected')
      if (characterClass === 'o') return wordContent('octalExpected')
      if (characterClass === 'b') return wordContent('binaryExpected')
      // No underscore may follow a lone zero, so an underscore ends the word as a value.
      return (characterClass === 'underscore' ? null : afterInteger(characterClass)) ?? endWord(characterClass, true)
    case 'leadingZero2':
      if (digit) return wordContent('leadingZero3')
      return characterClass === 'colon' ? ['localHourColon', 'becomesValue'] : endWord(characterClass, false)
    case 'leadingZero3': return digitOrEndWord(characterClass, 'leadingZero4', false)
    case 'leadingZero4': return characterClass === 'minus' ? wordContent('yearDash') : endWord(characterClass, false)
    case 'digits1': return digit ? wordContent('digits2') : afterInteger(characterClass) ?? endWord(characterClass, true)
    case 'digits2':
      if (digit) return wordContent('digits3')
      if (characterClass === 'colon') return ['localHourColon', 'becomesValue']
      return afterInteger(characterClass) ?? endWord(characterClass, true)
    case 'digits3': return digit ? wordContent('digits4') : afterInteger(characterClass) ?? endWord(characterClass, true)
    case 'digits4':
      if (digit) return wordContent('integer')
      if (characterClass === 'minus') return wordContent('yearDash')
      return afterInteger(characterClass) ?? endWord(characterClass, true)
    // Five digits or more, or digits after an underscore or after a sign: no date and no time can follow.
    case 'integer': return digit ? wordContent('integer') : afterInteger(characterClass) ?? endWord(characterClass, true)
    case 'integerUnderscore': return digitOrEndWord(characterClass, 'integer', false)
    // After + or -. A lone - is a key, e.g. `- = 1`.
    case 'sign':
      if (characterClass === 'zero') return wordContent('signedZero')
      if (digit) return wordContent('integer')
      if (characterClass === 'i') return wordContent('i')
      if (characterClass === 'n') return wordContent('n')
      return endWord(characterClass, false)
    case 'signedZero': return (characterClass === 'underscore' ? null : afterInteger(characterClass)) ?? endWord(characterClass, true)

    // 0x, 0o and 0b. `hexExpected` is after the prefix and after an underscore, where a digit has to follow.
    case 'hexExpected': return isHexDigit(characterClass) ? wordContent('hex') : endWord(characterClass, false)
    case 'hex':
      if (isHexDigit(characterClass)) return wordContent('hex')
      return characterClass === 'underscore' ? wordContent('hexExpected') : endWord(characterClass, true)
    case 'octalExpected': return isOctalDigit(characterClass) ? wordContent('octal') : endWord(characterClass, false)
    case 'octal':
      if (isOctalDigit(characterClass)) return wordContent('octal')
      return characterClass === 'underscore' ? wordContent('octalExpected') : endWord(characterClass, true)
    case 'binaryExpected': return isBinaryDigit(characterClass) ? wordContent('binary') : endWord(characterClass, false)
    case 'binary':
      if (isBinaryDigit(characterClass)) return wordContent('binary')
      return characterClass === 'underscore' ? wordContent('binaryExpected') : endWord(characterClass, true)

    // After the dot of `1.`: a digit starts the fraction of a value, or the next part of a dotted key. Any other start
    // of a key part goes on with the dotted key and ends the word as a value: a key character, e.g. `1.x`, a quote, e.g.
    // `1."x"`, and white space, e.g. `1. x`.
    case 'afterNumberDot':
      if (digit) return ['fraction', 'fractionStart']
      if (isKeyCharacter(characterClass)) return ['bareKey', 'keyStart']
      if (characterClass === 'quote' || characterClass === 'apostrophe') return startToken(characterClass)
      return isSpaceOrTab(characterClass) ? ['between', 'whitespaceAfterKey'] : continueOr(characterClass, null, 'badValue')
    case 'fraction':
      if (digit) return wordContent('fraction')
      if (characterClass === 'underscore') return wordContent('fractionUnderscore')
      return isExponentLetter(characterClass) ? wordContent('exponentLetter') : endWord(characterClass, true)
    case 'fractionUnderscore': return digitOrEndWord(characterClass, 'fraction', false)
    case 'exponentLetter':
      if (characterClass === 'plus') return ['exponentExpected', 'becomesValue']
      if (characterClass === 'minus') return wordContent('exponentExpected')
      return digitOrEndWord(characterClass, 'exponent', false)
    // After the sign of an exponent and after an underscore in one, where a digit has to follow.
    case 'exponentExpected': return digitOrEndWord(characterClass, 'exponent', false)
    case 'exponent':
      if (digit) return wordContent('exponent')
      return characterClass === 'underscore' ? wordContent('exponentExpected') : endWord(characterClass, true)

    case 't': return literalLetter(characterClass, 'r', 'tr')
    case 'tr': return literalLetter(characterClass, 'u', 'tru')
    case 'tru': return literalLetter(characterClass, 'e', 'valueEnd')
    case 'f': return literalLetter(characterClass, 'a', 'fa')
    case 'fa': return literalLetter(characterClass, 'l', 'fal')
    case 'fal': return literalLetter(characterClass, 's', 'fals')
    case 'fals': return literalLetter(characterClass, 'e', 'valueEnd')
    case 'i': return numberLetter(characterClass, 'n', 'in')
    case 'in': return numberLetter(characterClass, 'f', 'valueEnd')
    case 'n': return numberLetter(characterClass, 'a', 'na')
    case 'na': return numberLetter(characterClass, 'n', 'valueEnd')
    // After a whole value that nothing can go on with: true, false, inf, nan, and a date and time with its offset.
    case 'valueEnd': return endWord(characterClass, true)

    // Dates, e.g. 1979-05-27, and a time after one, e.g. 1979-05-27T07:32:00.999-07:00. `month1` is after one digit of
    // the month. Up to the first colon the word can still be a key.
    case 'yearDash': return digitOrEndWord(characterClass, 'month1', false)
    case 'month1': return digitOrEndWord(characterClass, 'month2', false)
    case 'month2': return characterClass === 'minus' ? wordContent('monthDash') : endWord(characterClass, false)
    case 'monthDash': return digitOrEndWord(characterClass, 'day1', false)
    case 'day1': return digitOrEndWord(characterClass, 'day2', false)
    case 'day2':
      if (characterClass === 'capitalT' || characterClass === 't') return wordContent('dateT')
      return characterClass === 'space' ? ['dateSpace', 'whitespace'] : endWord(characterClass, true)
    // After a date and one space: a digit starts the time. Anything else is read as between tokens.
    case 'dateSpace': return digit ? ['hour1', 'becomesValue'] : startToken(characterClass)
    case 'dateT': return digitOrEndWord(characterClass, 'hour1', false)
    case 'hour1': return digitOrEndWord(characterClass, 'hour2', false)
    case 'hour2': return characterClass === 'colon' ? ['hourColon', 'becomesValue'] : endWord(characterClass, false)
    case 'hourColon': return digitOrEndValue(characterClass, 'minute1')
    case 'minute1': return digitOrEndValue(characterClass, 'minute2')
    case 'minute2': return characterClass === 'colon' ? wordContent('minuteColon') : endValue(characterClass, false)
    case 'minuteColon': return digitOrEndValue(characterClass, 'second1')
    case 'second1': return digitOrEndValue(characterClass, 'second2')
    case 'second2':
      if (characterClass === 'dot') return wordContent('secondDot')
      return afterSecondsOfDateTime(characterClass) ?? endValue(characterClass, true)
    case 'secondDot': return digitOrEndValue(characterClass, 'secondFraction')
    case 'secondFraction': return digit ? wordContent('secondFraction') : afterSecondsOfDateTime(characterClass) ?? endValue(characterClass, true)
    case 'offsetSign': return digitOrEndValue(characterClass, 'offsetHour1')
    case 'offsetHour1': return digitOrEndValue(characterClass, 'offsetHour2')
    case 'offsetHour2': return characterClass === 'colon' ? wordContent('offsetColon') : endValue(characterClass, false)
    case 'offsetColon': return digitOrEndValue(characterClass, 'offsetMinute1')
    case 'offsetMinute1': return digitOrEndValue(characterClass, 'valueEnd')

    // A time without a date, e.g. 07:32:00.5, which has no offset.
    case 'localHourColon': return digitOrEndValue(characterClass, 'localMinute1')
    case 'localMinute1': return digitOrEndValue(characterClass, 'localMinute2')
    case 'localMinute2': return characterClass === 'colon' ? wordContent('localMinuteColon') : endValue(characterClass, false)
    case 'localMinuteColon': return digitOrEndValue(characterClass, 'localSecond1')
    case 'localSecond1': return digitOrEndValue(characterClass, 'localSecond2')
    case 'localSecond2': return characterClass === 'dot' ? wordContent('localSecondDot') : endValue(characterClass, true)
    case 'localSecondDot': return digitOrEndValue(characterClass, 'localSecondFraction')
    case 'localSecondFraction': return digit ? wordContent('localSecondFraction') : endValue(characterClass, true)

    case 'errorLine':
      if (characterClass === 'lineFeed' || characterClass === 'end' || characterClass === 'truncatedEnd') return startToken(characterClass)
      return ['errorLine', 'errorContinuation']
  }
}

// lexerNext[state × classCount + class] and lexerEvent[state × classCount + class].
export const lexerNextTable: readonly number[] = lexerStates.flatMap(state =>
  characterClasses.map(characterClass => lexerStates.indexOf(lexerStep(state, characterClass)[0])))
export const lexerEventTable: readonly number[] = lexerStates.flatMap(state =>
  characterClasses.map(characterClass => lexerEvents.indexOf(lexerStep(state, characterClass)[1])))

// The grammar reads one token per event. `none` is white space and the inside of a token or of a comment. `comment` is
// the # of a comment: a comment runs to the end of its line, so the grammar rejects it where the line may not end, e.g.
// after `a =`. The tokens of words say what the word can be, see "Words" above:
// - `keyOrValue`, `keyOnly` and `valueOnly` start a word.
// - `notValue` comes inside or right after a word and says that the word is no value. The grammar goes on in a key
//   position and rejects the token in a value position. `notKey` is the reverse.
// - `numberDot` is a dot in a key position, and part of the value in a value position. `fraction` starts a key part in
//   a key position, and is part of the value in a value position.
// - `closeBracketAfterKey` closes a header, and the grammar rejects it in a value position.
const grammarTokens = [
  'none', 'newline', 'comment', 'equals', 'dot', 'comma', 'openBracket', 'adjacentOpenBracket', 'closeBracket', 'adjacentCloseBracket',
  'closeBracketAfterKey', 'openBrace', 'closeBrace', 'string', 'keyOrValue', 'keyOnly', 'valueOnly', 'notValue', 'notKey',
  'numberDot', 'fraction', 'lexerError', 'end',
] as const
type GrammarToken = typeof grammarTokens[number]
export const tokenNames = grammarTokens
export const tokenCount = grammarTokens.length

function grammarTokenOf(event: LexerEvent): GrammarToken {
  switch (event) {
    case 'whitespace': case 'commentContent': case 'stringContent': case 'stringEnd': case 'escape': case 'numberContent':
    case 'literalContent': case 'keyContent': return 'none'
    case 'commentStart': return 'comment'
    case 'newline': case 'equals': case 'dot': case 'comma': case 'openBracket': case 'adjacentOpenBracket': case 'closeBracket':
    case 'adjacentCloseBracket': case 'closeBracketAfterKey': case 'openBrace': case 'closeBrace': case 'numberDot': return event
    case 'stringStart': return 'string'
    case 'numberStart': case 'literalStart': return 'keyOrValue'
    case 'keyStart': return 'keyOnly'
    case 'signStart': return 'valueOnly'
    case 'becomesKey': case 'whitespaceAfterKey': return 'notValue'
    case 'becomesValue': case 'multiLineStart': return 'notKey'
    case 'fractionStart': return 'fraction'
    case 'unexpectedCharacter': case 'controlCharacterInString': case 'controlCharacterInComment': case 'bareCarriageReturn':
    case 'badEscape': case 'badUnicodeEscape': case 'badValue': case 'errorContinuation': case 'endInsideToken':
    case 'truncatedEnd': return 'lexerError'
    case 'end': return 'end'
  }
}

// The error kind a tokenizer event reports, which the parser adds to the grammar's error kind. errorContinuation only
// follows an earlier tokenizer error, so it reports nothing.
function lexerErrorKindOf(event: LexerEvent): number {
  switch (event) {
    case 'unexpectedCharacter': case 'controlCharacterInString': case 'controlCharacterInComment': case 'bareCarriageReturn':
    case 'badEscape': case 'badUnicodeEscape': case 'badValue':
      return errorKind[event]
    case 'endInsideToken': return errorKind.unexpectedEnd
    case 'truncatedEnd': return errorKind.tooLong
    case 'whitespace': case 'newline': case 'commentStart': case 'commentContent': case 'equals': case 'dot': case 'comma':
    case 'openBracket': case 'adjacentOpenBracket': case 'closeBracket': case 'adjacentCloseBracket': case 'openBrace': case 'closeBrace':
    case 'stringStart': case 'stringContent': case 'stringEnd': case 'multiLineStart': case 'escape': case 'numberStart':
    case 'numberContent': case 'literalStart': case 'literalContent': case 'keyStart': case 'keyContent': case 'signStart':
    case 'becomesKey': case 'becomesValue': case 'numberDot': case 'fractionStart': case 'whitespaceAfterKey':
    case 'closeBracketAfterKey': case 'errorContinuation': case 'end':
      return errorKind.none
  }
}

export const grammarTokenTable: readonly number[] = lexerEvents.map(event => grammarTokens.indexOf(grammarTokenOf(event)))
export const lexerErrorKindTable: readonly number[] = lexerEvents.map(lexerErrorKindOf)

// depthClass[depth]: 0 at the top level, 1 inside one array or inline table, 2 deeper, and 3 at the maximum depth,
// where an opening bracket is tooDeep. Depths past the table clamp to its ends.
export const depthClassTable: readonly number[] = Array.from({length: maximumDepth + 1}, (_, depth) =>
  depth === 0 ? 0 : depth === 1 ? 1 : depth === maximumDepth ? 3 : 2)
const depthClassCount = 4
// The grammar's context for a character: depthClass × 2 + [the innermost open container is an inline table].
export const contextCount = depthClassCount * 2
export const contextNames = [
  'depth 0', 'depth 0, inline table', 'depth 1, array', 'depth 1, inline table', 'depth 2 to 15, array',
  'depth 2 to 15, inline table', 'depth 16, array', 'depth 16, inline table',
] as const

// What a grammar cell does to the stack of open containers. The numbers are those of the JSON experiment in
// lab/recovery-parser/learn/recovery-tables.ts, where `by token` is what every cell of the JSON tables holds. The TOML
// tables name the action in every cell, because a `[` opens an array in a value position and nothing in a header.
const stackActions = ['by token', 'none', 'push array', 'push inline table', 'pop'] as const
type StackAction = Exclude<typeof stackActions[number], 'by token'>
export const actionNames = stackActions

// What a token does to the stack where the grammar has no rule for it: in a cell that leads into the state `error`,
// and in that state. As in the JSON tables, the parser goes on counting brackets after an error.
function actionOfToken(token: GrammarToken): StackAction {
  switch (token) {
    case 'openBracket': case 'adjacentOpenBracket': return 'push array'
    case 'openBrace': return 'push inline table'
    case 'closeBracket': case 'adjacentCloseBracket': case 'closeBracketAfterKey': case 'closeBrace': return 'pop'
    case 'none': case 'newline': case 'comment': case 'equals': case 'dot': case 'comma': case 'string': case 'keyOrValue':
    case 'keyOnly': case 'valueOnly': case 'notValue': case 'notKey': case 'numberDot': case 'fraction': case 'lexerError': case 'end':
      return 'none'
  }
}
export const actionOfTokenTable: readonly number[] = grammarTokens.map(token => stackActions.indexOf(actionOfToken(token)))

// Grammar states: what may come next. The initial state is `lineStart`. `error` absorbs everything after the first
// error.
// - `lineStart`: the start of the text or of a line at the top level. A key, a header, an empty line or the end.
// - `afterKey`: after a key or a part of a dotted key. A dot or an equals sign.
// - `key`: after the dot of a dotted key, and after a comma in an inline table. A key.
// - `value`: after an equals sign. A value.
// - `valueOrClose`: after the `[` of an array and after a comma in one. A value or the `]`.
// - `afterValue`: after a value. At the top level the end of the line, in an array a comma or the `]`, in an inline
//   table a comma or the `}`.
// - `keyOrClose`: after the `{` of an inline table. A key or the `}`.
// - `headerOpen`: after the `[` of a header. A key, or right away a second `[`.
// - `afterHeaderKey`, `afterHeaderDot`: inside `[a.b]`, as `afterKey` and `key`.
// - `arrayHeaderOpen`, `afterArrayHeaderKey`, `afterArrayHeaderDot`: the same inside `[[a.b]]`.
// - `arrayHeaderClose`: after the first `]` of `]]`. Right away the second one.
// - `afterHeader`: after a header. The end of the line.
const grammarStates = [
  'lineStart', 'afterKey', 'key', 'value', 'valueOrClose', 'afterValue', 'keyOrClose', 'headerOpen', 'afterHeaderKey',
  'afterHeaderDot', 'arrayHeaderOpen', 'afterArrayHeaderKey', 'afterArrayHeaderDot', 'arrayHeaderClose', 'afterHeader', 'error',
] as const
type GrammarState = typeof grammarStates[number]
export const grammarStateNames = grammarStates
export const grammarStateCount = grammarStates.length
export const symbolCount = grammarTokens.length * contextCount

type GrammarStep = readonly [next: GrammarState, action: StackAction, error: number]

// The grammar between tokens, from the state before a character, the character's token, the depth class before it, and
// whether the innermost open container is an inline table.
function grammarStep(state: GrammarState, token: GrammarToken, depthClass: number, inInlineTable: boolean): GrammarStep {
  const fail = (error: number): GrammarStep => ['error', actionOfToken(token), error]
  const to = (next: GrammarState, action: StackAction = 'none'): GrammarStep => [next, action, errorKind.none]
  if (state === 'error') return fail(errorKind.none)
  // White space and the inside of a token change nothing. The one exception: nothing may stand between the two
  // brackets of `]]`, e.g. the space of `[[a] ]` is an error, since no text that starts with `[[a] ` is valid.
  if (token === 'none') return state === 'arrayHeaderClose' ? fail(errorKind.badHeader) : to(state)
  if (token === 'lexerError') return fail(errorKind.none)
  const atTopLevel = depthClass === 0
  if (token === 'end') {
    // The text may end at the start of a line, and at the top level after a value or a header.
    const mayEnd = state === 'lineStart' || state === 'afterHeader' || (state === 'afterValue' && atTopLevel)
    return mayEnd ? to(state) : fail(errorKind.unexpectedEnd)
  }
  if (token === 'comment') {
    // A comment runs to the end of its line, so it may start where the line may end: at the start of a line, after a
    // header, after a value at the top level, and between the values of an array. Anywhere else no text that goes on
    // with the comment is valid, e.g. after `a =` or inside an inline table, so the # is the error.
    const lineMayEnd = state === 'lineStart' || state === 'afterHeader' || state === 'valueOrClose' || (state === 'afterValue' && (atTopLevel || !inInlineTable))
    if (lineMayEnd) return to(state)
  }
  const startsKey = token === 'string' || token === 'keyOrValue' || token === 'keyOnly'
  const startsScalar = token === 'string' || token === 'keyOrValue' || token === 'valueOnly'
  const opensArray = token === 'openBracket' || token === 'adjacentOpenBracket'
  const closesArray = token === 'closeBracket' || token === 'adjacentCloseBracket'
  const isDot = token === 'dot' || token === 'numberDot'
  // A value where one is expected: a string, a number, a date, a literal, or the opening bracket of an array or of an
  // inline table.
  const startValue = (): GrammarStep | null => {
    if (startsScalar) return to('afterValue')
    if (!opensArray && token !== 'openBrace') return null
    if (depthClass === 3) return fail(errorKind.tooDeep)
    return opensArray ? to('valueOrClose', 'push array') : to('keyOrClose', 'push inline table')
  }
  // A closing bracket where the innermost container may close. The container is then a complete value of the level
  // below.
  const close = (): GrammarStep | null => {
    if (!closesArray && token !== 'closeBrace') return null
    if (atTopLevel) return null
    return closesArray === inInlineTable ? fail(errorKind.mismatchedBracket) : to('afterValue', 'pop')
  }
  switch (state) {
    case 'lineStart':
      if (token === 'newline') return to('lineStart')
      if (startsKey) return to('afterKey')
      // A `[` at the start of a line opens a header and no array, so the stack stays as it is.
      if (token === 'openBracket') return to('headerOpen')
      return fail(errorKind.expectedKey)
    case 'afterKey':
      if (isDot) return to('key')
      if (token === 'equals') return to('value')
      // White space after a word that is no value, e.g. after the `tru` of `tru = 1`.
      if (token === 'notValue') return to('afterKey')
      return fail(errorKind.expectedEquals)
    case 'key':
      // After `1.`, a digit is the token `fraction`, e.g. the 5 of the key `1.5`, and white space is `notValue`.
      if (startsKey || token === 'fraction') return to('afterKey')
      if (token === 'notValue') return to('key')
      return fail(errorKind.expectedKey)
    case 'value': return startValue() ?? fail(errorKind.expectedValue)
    case 'valueOrClose':
      // An array may hold line ends, and a comma may stand before its `]`.
      if (token === 'newline') return to('valueOrClose')
      return startValue() ?? close() ?? fail(errorKind.expectedValue)
    case 'afterValue': {
      // Inside a value: the colon of a time, the dot of a fraction, the third quote of `"""`.
      if (token === 'notKey' || token === 'numberDot' || token === 'fraction') return to('afterValue')
      // The word turned out to be no value, e.g. at the x of `a = 12x`.
      if (token === 'notValue' || token === 'closeBracketAfterKey') return fail(errorKind.badValue)
      if (atTopLevel) return token === 'newline' ? to('lineStart') : fail(errorKind.expectedLineEnd)
      if (token === 'comma') return to(inInlineTable ? 'key' : 'valueOrClose')
      // A line end may stand inside an array and not inside an inline table.
      if (token === 'newline' && !inInlineTable) return to('afterValue')
      return close() ?? fail(errorKind.expectedCommaOrClose)
    }
    case 'keyOrClose':
      if (startsKey) return to('afterKey')
      return close() ?? fail(errorKind.expectedKey)
    case 'headerOpen':
      if (startsKey) return to('afterHeaderKey')
      // `[[` with nothing between the two brackets opens the header of an array of tables.
      if (token === 'adjacentOpenBracket') return to('arrayHeaderOpen')
      return fail(errorKind.badHeader)
    case 'afterHeaderKey':
      if (isDot) return to('afterHeaderDot')
      if (token === 'closeBracket' || token === 'closeBracketAfterKey') return to('afterHeader')
      if (token === 'notValue') return to('afterHeaderKey')
      return fail(errorKind.badHeader)
    case 'afterHeaderDot':
      if (startsKey || token === 'fraction') return to('afterHeaderKey')
      if (token === 'notValue') return to('afterHeaderDot')
      return fail(errorKind.badHeader)
    case 'arrayHeaderOpen':
      if (startsKey) return to('afterArrayHeaderKey')
      return fail(errorKind.badHeader)
    case 'afterArrayHeaderKey':
      if (isDot) return to('afterArrayHeaderDot')
      if (token === 'closeBracket' || token === 'closeBracketAfterKey') return to('arrayHeaderClose')
      if (token === 'notValue') return to('afterArrayHeaderKey')
      return fail(errorKind.badHeader)
    case 'afterArrayHeaderDot':
      if (startsKey || token === 'fraction') return to('afterArrayHeaderKey')
      if (token === 'notValue') return to('afterArrayHeaderDot')
      return fail(errorKind.badHeader)
    case 'arrayHeaderClose':
      // `]]` with nothing between the two brackets.
      if (token === 'adjacentCloseBracket') return to('afterHeader')
      return fail(errorKind.badHeader)
    case 'afterHeader':
      if (token === 'newline') return to('lineStart')
      return fail(errorKind.expectedLineEnd)
  }
}

// grammarNext[state × symbolCount + token × contextCount + context], and the same for grammarAction and grammarError.
function grammarTable(field: 0 | 1 | 2): number[] {
  return grammarStates.flatMap(state => grammarTokens.flatMap(token => Array.from({length: contextCount}, (_, context) => {
    const step = grammarStep(state, token, Math.floor(context / 2), context % 2 === 1)
    return field === 0 ? grammarStates.indexOf(step[0]) : field === 1 ? stackActions.indexOf(step[1]) : step[2]
  })))
}
export const grammarNextTable: readonly number[] = grammarTable(0)
export const grammarActionTable: readonly number[] = grammarTable(1)
export const grammarErrorTable: readonly number[] = grammarTable(2)

// display[event × grammarStateCount + grammar state after the character]. A character of a string or of a word is
// shown as a key when the grammar expects an equals sign or a dot after it, and as a header name when the grammar is
// inside a header. The dot after the digits of a number is punctuation when the grammar then expects a key.
function displayKindOf(event: LexerEvent, grammarAfter: GrammarState): number {
  const inHeader = grammarAfter === 'afterHeaderKey' || grammarAfter === 'afterArrayHeaderKey'
  const keyKind = inHeader ? displayKind.headerName : displayKind.key
  const inKey = grammarAfter === 'afterKey' || inHeader
  switch (event) {
    case 'whitespace': case 'newline': case 'whitespaceAfterKey': return displayKind.whitespace
    case 'commentStart': case 'commentContent': return displayKind.comment
    case 'equals': case 'dot': case 'comma': case 'openBracket': case 'adjacentOpenBracket': case 'closeBracket':
    case 'adjacentCloseBracket': case 'closeBracketAfterKey': case 'openBrace': case 'closeBrace': return displayKind.punctuation
    case 'stringStart': case 'stringContent': case 'stringEnd': return inKey ? keyKind : displayKind.string
    case 'multiLineStart': return displayKind.string
    case 'escape': return displayKind.escape
    case 'numberStart': case 'numberContent': case 'fractionStart': return inKey ? keyKind : displayKind.number
    case 'literalStart': case 'literalContent': return inKey ? keyKind : displayKind.literal
    case 'keyStart': case 'keyContent': case 'becomesKey': return keyKind
    case 'signStart': case 'becomesValue': return displayKind.number
    case 'numberDot': {
      const expectsKey = grammarAfter === 'key' || grammarAfter === 'afterHeaderDot' || grammarAfter === 'afterArrayHeaderDot'
      return expectsKey ? displayKind.punctuation : displayKind.number
    }
    case 'unexpectedCharacter': case 'controlCharacterInString': case 'controlCharacterInComment': case 'bareCarriageReturn':
    case 'badEscape': case 'badUnicodeEscape': case 'badValue': case 'errorContinuation': return displayKind.error
    case 'end': case 'endInsideToken': case 'truncatedEnd': return displayKind.pastEnd
  }
}
export const displayTable: readonly number[] = lexerEvents.flatMap(event => grammarStates.map(state => displayKindOf(event, state)))
