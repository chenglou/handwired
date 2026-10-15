// The JSON highlighter as a plain loop over its tables: one code point per step, with the arithmetic of
// src/json-search/highlighter/highlighter.ts and none of its circuit. It is "the parser as it is", which every later
// arm of the experiment starts from, so the tables are an argument: runTableParser(text, tables) runs any tables of the
// same layout, e.g. the default ones with other values in the cells that only invalid input reaches.
//
// check-table-parser.ts compares the default tables with tests/json-search/highlighter/reference.ts on many texts.
import {capacity, maximumDepth} from '../../src/json-search/highlighter/kinds.ts'
import {
  classCount, classTable, contextCount, depthChangeTable, depthClassTable, displayTable, eventCount, grammarErrorTable,
  grammarNextTable, grammarStateCount, grammarStates, grammarTokenTable, levelWeightTable, lexerErrorKindTable,
  lexerEventTable, lexerNextTable, lexerStateCount, objectWeightTable, symbolCount,
} from '../../src/json-search/highlighter/tables.ts'

// The names of the tables' rows and columns, in the order of tables.ts, which exports the tables and their sizes but
// not these names. The checks below this list stop the module when the order no longer fits the tables.
export const classNames = [
  'end', 'truncatedEnd', 'space', 'tabOrCarriageReturn', 'lineFeed', 'control', 'quote', 'backslash', 'slash',
  'openBrace', 'closeBrace', 'openBracket', 'closeBracket', 'colon', 'comma', 'minus', 'plus', 'dot', 'zero', 'digit',
  'a', 'b', 'e', 'capitalE', 'f', 'l', 'n', 'r', 's', 't', 'u', 'otherHexLetter', 'other',
] as const
export const lexerStateNames = [
  'between', 'string', 'escape', 'hex4', 'hex3', 'hex2', 'hex1', 'minus', 'zero', 'integer', 'dot', 'fraction',
  'exponent', 'exponentSign', 'exponentDigits', 't', 'tr', 'tru', 'f', 'fa', 'fal', 'fals', 'n', 'nu', 'nul', 'errorLine',
] as const
export const eventNames = [
  'whitespace', 'stringStart', 'stringContent', 'stringEnd', 'escape', 'numberStart', 'numberContent', 'literalStart',
  'literalContent', 'openObject', 'openArray', 'closeObject', 'closeArray', 'colon', 'comma', 'unexpectedCharacter',
  'controlCharacterInString', 'badEscape', 'badUnicodeEscape', 'badNumber', 'badLiteral', 'errorContinuation', 'end',
  'endInsideToken', 'truncatedEnd',
] as const
export const tokenNames = ['none', 'string', 'scalar', 'openObject', 'openArray', 'closeObject', 'closeArray', 'colon', 'comma', 'lexerError', 'end'] as const
export const grammarStateNames: readonly string[] = grammarStates
// A context is depthClass × 2 + [the innermost container is an object], with depth classes 0, 1, 2 to 15, and 16.
export const contextNames = ['depth 0', 'depth 0, object', 'depth 1, array', 'depth 1, object', 'depth 2 to 15, array', 'depth 2 to 15, object', 'depth 16, array', 'depth 16, object'] as const

function checkNames() {
  const classOf = (character: string) => classNames[classTable[character.codePointAt(0)! + 1]!]
  const eventAt = (state: typeof lexerStateNames[number], characterClass: typeof classNames[number]) =>
    eventNames[lexerEventTable[lexerStateNames.indexOf(state) * classCount + classNames.indexOf(characterClass)]!]
  const nextAt = (state: typeof lexerStateNames[number], characterClass: typeof classNames[number]) =>
    lexerStateNames[lexerNextTable[lexerStateNames.indexOf(state) * classCount + classNames.indexOf(characterClass)]!]
  const tokenOf = (event: typeof eventNames[number]) => tokenNames[grammarTokenTable[eventNames.indexOf(event)]!]
  const facts: [string, unknown, unknown][] = [
    ['class count', classNames.length, classCount],
    ['tokenizer state count', lexerStateNames.length, lexerStateCount],
    ['event count', eventNames.length, eventCount],
    ['token count', tokenNames.length * contextCount, symbolCount],
    ['context count', contextNames.length, contextCount],
    ['class of "', classOf('"'), 'quote'], ['class of \\', classOf('\\'), 'backslash'], ['class of /', classOf('/'), 'slash'],
    ['class of }', classOf('}'), 'closeBrace'], ['class of ]', classOf(']'), 'closeBracket'], ['class of :', classOf(':'), 'colon'],
    ['class of ,', classOf(','), 'comma'], ['class of +', classOf('+'), 'plus'], ['class of 0', classOf('0'), 'zero'],
    ['class of 7', classOf('7'), 'digit'], ['class of E', classOf('E'), 'capitalE'], ['class of u', classOf('u'), 'u'],
    ['class of D', classOf('D'), 'otherHexLetter'], ['class of x', classOf('x'), 'other'], ['class of line feed', classOf('\n'), 'lineFeed'],
    ['event of " between tokens', eventAt('between', 'quote'), 'stringStart'], ['event of a line feed in a string', eventAt('string', 'lineFeed'), 'controlCharacterInString'],
    ['event of x in an escape', eventAt('escape', 'other'), 'badEscape'], ['event of , after tru', eventAt('tru', 'comma'), 'badLiteral'],
    ['event of , after a dot', eventAt('dot', 'comma'), 'badNumber'], ['event of the end in a string', eventAt('string', 'end'), 'endInsideToken'],
    ['event of x on an error line', eventAt('errorLine', 'other'), 'errorContinuation'], ['event of the end between tokens', eventAt('between', 'end'), 'end'],
    ['state after \\u', nextAt('escape', 'u'), 'hex4'], ['state after nul', nextAt('nu', 'l'), 'nul'], ['state after an exponent sign', nextAt('exponent', 'minus'), 'exponentSign'],
    ['state after x between tokens', nextAt('between', 'other'), 'errorLine'], ['state after fals', nextAt('fal', 's'), 'fals'],
    ['token of stringStart', tokenOf('stringStart'), 'string'], ['token of literalStart', tokenOf('literalStart'), 'scalar'],
    ['token of closeArray', tokenOf('closeArray'), 'closeArray'], ['token of badEscape', tokenOf('badEscape'), 'lexerError'],
    ['token of end', tokenOf('end'), 'end'], ['token of comma', tokenOf('comma'), 'comma'],
  ]
  for (const [name, actual, expected] of facts) {
    if (actual !== expected) throw new Error(`table-parser.ts names no longer fit tables.ts: ${name} is ${String(actual)}, expected ${String(expected)}`)
  }
}
checkNames()

// Every table the loop reads. A later arm swaps some of them, e.g. grammarNext with trained cells, and may add states,
// since the sizes are fields too.
export type ParserTables = {
  classCount: number
  eventCount: number
  // Tokens × contexts, the number of columns of the grammar's tables.
  symbolCount: number
  contextCount: number
  grammarStateCount: number
  // The grammar state that the first error is counted from.
  errorState: number
  // classOfCodePoint[codePoint + 1], where entry 0 is the cell after the text, and a code point past the table reads the last entry.
  classOfCodePoint: readonly number[]
  // [tokenizer state × classCount + class]
  lexerNext: readonly number[]
  lexerEvent: readonly number[]
  // [event]
  grammarToken: readonly number[]
  lexerErrorKind: readonly number[]
  depthChange: readonly number[]
  // [depth before × eventCount + event], 0 outside the table
  objectWeight: readonly number[]
  // [depth − 1], clamped
  levelWeight: readonly number[]
  // [depth], clamped
  depthClass: readonly number[]
  // [grammar state × symbolCount + token × contextCount + context]
  grammarNext: readonly number[]
  grammarError: readonly number[]
  // [event × grammarStateCount + grammar state after the character]
  display: readonly number[]
}

export const defaultTables: ParserTables = {
  classCount, eventCount, symbolCount, contextCount, grammarStateCount,
  errorState: grammarStates.indexOf('error'),
  classOfCodePoint: classTable,
  lexerNext: lexerNextTable,
  lexerEvent: lexerEventTable,
  grammarToken: grammarTokenTable,
  lexerErrorKind: lexerErrorKindTable,
  depthChange: depthChangeTable,
  objectWeight: objectWeightTable,
  levelWeight: levelWeightTable,
  depthClass: depthClassTable,
  grammarNext: grammarNextTable,
  grammarError: grammarErrorTable,
  display: displayTable,
}

// The cells the parser has: 512 code points and one more position, which is the end of the text, or the 513th code
// point of a longer text.
export const positionCount = capacity + 1

export const containerNone = 0
export const containerObject = 1
export const containerArray = 2
export const containerNames = ['none', 'object', 'array'] as const

// What the parser computes at every position. Each array has 513 entries. Entries from the text's length on belong to
// cells after the text.
export type ParserTrace = {
  // Code points read, at most 512.
  length: number
  characterClass: Int16Array
  lexerStateBefore: Int16Array
  event: Int16Array
  token: Int16Array
  // depthClass × 2 + [the innermost container before the character is an object], the grammar table's column within a token.
  context: Int16Array
  grammarBefore: Int16Array
  grammarAfter: Int16Array
  // The nesting depth after the character: the running total of +1 per opening bracket and −1 per closing bracket, which
  // has no floor, e.g. −1 after the ] of 1].
  depthAfter: Int16Array
  // containerNone, containerObject or containerArray after the character, from the same arithmetic as the grammar's
  // context. It is exact before the first error. After an error it is whatever the running totals give.
  containerAfter: Int8Array
  displayKind: Int16Array
  // -1 when the text is valid.
  firstErrorPosition: number
  firstErrorKind: number
  valid: boolean
}

const clamp = (value: number, minimum: number, maximum: number) => value < minimum ? minimum : value > maximum ? maximum : value

export function runTableParser(text: string, tables: ParserTables = defaultTables): ParserTrace {
  const codePoints: number[] = []
  let textLength = 0
  for (const character of text) {
    if (textLength < capacity) codePoints.push(character.codePointAt(0)!)
    textLength++
  }
  return runTableParserOnCodePoints(codePoints, textLength > capacity, tables)
}

// `codePoints` holds at most 512 code points, and `truncated` says that the text had more.
export function runTableParserOnCodePoints(codePoints: readonly number[], truncated: boolean, tables: ParserTables = defaultTables): ParserTrace {
  const length = codePoints.length
  const trace: ParserTrace = {
    length,
    characterClass: new Int16Array(positionCount), lexerStateBefore: new Int16Array(positionCount), event: new Int16Array(positionCount),
    token: new Int16Array(positionCount), context: new Int16Array(positionCount), grammarBefore: new Int16Array(positionCount),
    grammarAfter: new Int16Array(positionCount), depthAfter: new Int16Array(positionCount), containerAfter: new Int8Array(positionCount),
    displayKind: new Int16Array(positionCount), firstErrorPosition: -1, firstErrorKind: 0, valid: true,
  }
  const lastClassEntry = tables.classOfCodePoint.length - 1
  const lastLevel = tables.levelWeight.length - 1
  const lastDepthClass = tables.depthClass.length - 1
  let lexerState = 0
  let grammarState = 0
  let depth = 0
  // The container kinds as one integer: bit d − 1 is 1 when the container at depth d is an object.
  let objectCode = 0
  for (let position = 0; position < positionCount; position++) {
    // Position 512 reads `end` (class 0) or `truncatedEnd` (class 1), and so does no code point.
    const characterClass = position === capacity
      ? Number(truncated)
      : tables.classOfCodePoint[Math.min((position < length ? codePoints[position]! : -1) + 1, lastClassEntry)]!
    const event = tables.lexerEvent[lexerState * tables.classCount + characterClass]!
    const token = tables.grammarToken[event]!
    // The container at the current depth is an object when the code reaches that depth's bit. Position 0 and position
    // 512 read 0, as in the program.
    const inObject = position === 0 || position === capacity ? 0 : Number(objectCode >= tables.levelWeight[clamp(depth - 1, 0, lastLevel)]!)
    const context = tables.depthClass[clamp(depth, 0, lastDepthClass)]! * 2 + inObject
    const cell = grammarState * tables.symbolCount + token * tables.contextCount + context
    const grammarAfter = tables.grammarNext[cell]!
    if (trace.firstErrorPosition === -1 && grammarAfter === tables.errorState) {
      trace.firstErrorPosition = position
      trace.firstErrorKind = tables.lexerErrorKind[event]! + tables.grammarError[cell]!
      trace.valid = false
    }
    trace.characterClass[position] = characterClass
    trace.lexerStateBefore[position] = lexerState
    trace.event[position] = event
    trace.token[position] = token
    trace.context[position] = context
    trace.grammarBefore[position] = grammarState
    trace.grammarAfter[position] = grammarAfter
    trace.displayKind[position] = tables.display[event * tables.grammarStateCount + grammarAfter]!
    // The running totals. A depth outside the object weight table adds 0.
    const weightEntry = depth * tables.eventCount + event
    if (depth >= 0 && weightEntry < tables.objectWeight.length) objectCode += tables.objectWeight[weightEntry]!
    depth += tables.depthChange[event]!
    trace.depthAfter[position] = depth
    trace.containerAfter[position] = depth <= 0 ? containerNone
      : objectCode >= tables.levelWeight[clamp(depth - 1, 0, lastLevel)]! ? containerObject : containerArray
    lexerState = tables.lexerNext[lexerState * tables.classCount + characterClass]!
    grammarState = grammarAfter
  }
  return trace
}

// The grammar table's cells that lead into the error state from another state: the cells that only invalid input
// reaches at a first error. With the error state's own row they are the cells whose next state is `error`.
export function grammarCellName(cell: number, tables: ParserTables = defaultTables) {
  const state = Math.floor(cell / tables.symbolCount)
  const token = Math.floor((cell % tables.symbolCount) / tables.contextCount)
  const context = cell % tables.contextCount
  return `(${grammarStateNames[state] ?? `state ${state}`}, ${tokenNames[token] ?? `token ${token}`}, ${contextNames[context] ?? `context ${context}`})`
}

export function lexerCellName(cell: number, tables: ParserTables = defaultTables) {
  const state = Math.floor(cell / tables.classCount)
  const characterClass = cell % tables.classCount
  return `(${lexerStateNames[state] ?? `state ${state}`}, ${classNames[characterClass] ?? `class ${characterClass}`})`
}

// The events that make the grammar read the token `lexerError`, e.g. badEscape, and the end of the text inside a token.
export const isLexerErrorEvent = (event: number, tables: ParserTables = defaultTables) => tables.grammarToken[event] === tokenNames.indexOf('lexerError')

export {capacity, maximumDepth}
