// Names shared by the TOML tables in tables.ts and the plain JavaScript reference in reference.ts: the capacity, the
// maximum nesting depth, what each character is shown as, and the kinds of the first error. This file holds only names
// and numbers, as src/json-search/highlighter/kinds.ts does for JSON. The reference doesn't read tables.ts.

// The parser reads up to this many code points of a text. Past it, the parser reads only the first 512 and reports
// tooLong.
export const capacity = 512
// Arrays and inline tables nest up to this depth. An opening bracket that would make the depth 17 is the error tooDeep.
export const maximumDepth = 16

// The innermost open container after a character. The numbers are those of the JSON experiment, where 1 is the object:
// the inline table stands in its place.
export const containerNone = 0
export const containerInlineTable = 1
export const containerArray = 2
export const containerNames = ['none', 'inline table', 'array'] as const

// What a character is shown as. The first nine are JSON's, with the same numbers. `key` is a character of a key before
// an equals sign, e.g. the `port` of `port = 8080` and the `"a b"` of `"a b" = 1`. `headerName` is a character of a key
// between the brackets of a table header, e.g. the `server` of `[server]` and of `[[server]]`. `pastEnd` is a cell after
// the text.
//
// Three choices come from reading one code point at a time, without looking ahead:
// - A date or a time is shown as a number. At its first digits nothing says yet that a date follows, e.g. the `1979` of
//   `1979-05-27` could be the integer 1979.
// - `inf` and `nan` are shown as numbers and not as literals, like the sign before them: at the `-` of `-inf` nothing
//   says yet whether digits follow. `true` and `false` are the literals.
// - The space between a date and a time, e.g. in `1979-05-27 07:32:00`, is shown as white space: at the space nothing
//   says yet that a time follows.
const displayKinds = ['whitespace', 'punctuation', 'string', 'escape', 'number', 'literal', 'error', 'pastEnd', 'key', 'headerName', 'comment'] as const
type DisplayKind = typeof displayKinds[number]
export const displayKind = Object.fromEntries(displayKinds.map((name, index) => [name, index])) as {[Name in DisplayKind]: number}
// One letter per display kind, for dumps: whitespace, punctuation, string, escape, number, literal, Error, pastEnd,
// key, header name, comment.
export const kindLetters = 'wpsenlE.khc'

// The kinds of the first error. Tokenizer errors come first, then grammar errors between tokens, then the named
// fallbacks.
export const errorKinds = [
  'none',
  // A character that can't start or continue a token, e.g. the ! of `a = !` or the : of `a : 1`.
  'unexpectedCharacter',
  // A control character inside a string, e.g. a line feed between the quotes of a string of one line. A tab is allowed.
  'controlCharacterInString',
  // A control character other than a tab inside a comment, e.g. U+0000.
  'controlCharacterInComment',
  // A carriage return that no line feed follows.
  'bareCarriageReturn',
  // A backslash followed by a character other than b t n f r " \ u U, e.g. "\q". In a string of several lines, also a
  // backslash followed by spaces and then by something other than the line's end.
  'badEscape',
  // A \u followed by fewer than 4 hex digits, or a \U followed by fewer than 8, e.g. "\u12x4".
  'badUnicodeEscape',
  // A number, a date, a time or a literal that isn't complete, or that goes on with a character it can't hold, e.g.
  // `a = 1.`, `a = 0x`, `a = 1979-05`, `a = tru` and `a = 07:3x`.
  'badValue',
  // A key was expected, e.g. the = of `= 1` or the , of `{a = 1,, b = 2}`.
  'expectedKey',
  // An equals sign or a dot was expected after a key, e.g. the line feed after `name`.
  'expectedEquals',
  // A value was expected, e.g. the line feed after `a =`, the , of `[,]` or the `abc` of `a = abc`.
  'expectedValue',
  // A comma or a closing bracket was expected after a value in an array or an inline table, e.g. the 2 of `[1 2]`.
  'expectedCommaOrClose',
  // The end of the line was expected, e.g. the b of `a = 1 b = 2` or of `[a] b = 1`.
  'expectedLineEnd',
  // A table header that breaks its form, e.g. `[]`, `[a`, `[ [a] ]` or `[[a] ]`.
  'badHeader',
  // A closing bracket of the other kind, e.g. the } of `a = [1}`.
  'mismatchedBracket',
  // The named fallback for depth: an opening bracket at depth 16.
  'tooDeep',
  // The text ends inside a token or before a line is complete, e.g. `a = [1,` or `a = "abc`.
  'unexpectedEnd',
  // The named fallback for capacity: the text holds more than 512 code points, and no error came before the 512th.
  'tooLong',
] as const
type ErrorKind = typeof errorKinds[number]
export const errorKind = Object.fromEntries(errorKinds.map((name, index) => [name, index])) as {[Name in ErrorKind]: number}
