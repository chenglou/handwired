// The TOML highlighter as a plain loop over its tables: one code point per step. It is lab/recovery-parser/table-parser.ts
// for TOML, with the same exports wherever TOML allows, so that the code of the JSON experiment runs on these tables
// with other imports. It is "the parser as it is" of the TOML experiment: it does not recover, and after the first
// error of a text its grammar stays in the state `error`. The tables are an argument: runTableParser(text, tables) runs
// any tables of the same layout, e.g. the default ones with other values in the cells that only invalid input reaches.
//
// Per code point: the code point's class, then the tokenizer's cell (tokenizer state, class), which gives the next
// tokenizer state and an event, then the event's token, then the grammar's cell (grammar state, token, context), which
// gives the next grammar state and a stack action, then the display kind of (event, grammar state after).
//
// What differs from the JSON file, and why:
// - The stack action is a table of its own, `grammarAction`, with one entry per grammar cell. The JSON tables change
//   the depth by the event alone. In TOML a `[` opens an array in a value position and a header at the start of a
//   line, and only the grammar knows which. lab/recovery-parser/learn/recovery-tables.ts already has this table for
//   JSON, with `by token` in every cell.
// - The open containers are a real stack, as in lab/recovery-parser/learn/recovery-parser.ts, with that file's rules
//   at the edges, see runTableParserOnCodePoints. The tables `depthChange`, `objectWeight` and `levelWeight` of the
//   JSON file are gone with the running sums that read them.
// - The two kinds of container are the array and the inline table, in the place of JSON's array and object.
//
// check-table-parser.ts compares the default tables with reference.ts on many texts.
import {capacity, containerArray, containerInlineTable, containerNames, containerNone, maximumDepth} from './kinds.ts'
import {
  actionNames, actionOfTokenTable, classCount, classNames, classTable, contextCount, contextNames, depthClassTable, displayTable,
  eventCount, eventNames, grammarActionTable, grammarErrorTable, grammarNextTable, grammarStateCount, grammarStateNames,
  grammarTokenTable, lexerErrorKindTable, lexerEventTable, lexerNextTable, lexerStateNames, symbolCount, tokenNames,
} from './tables.ts'

// The stack actions, with the numbers of lab/recovery-parser/learn/recovery-tables.ts. The default tables hold no
// `by token`: every cell names its action. A cell with `by token` does what tables.actionOfToken says for the token,
// e.g. it pushes an array at a `[`.
export const actionByToken = 0
export const actionNone = 1
export const actionPushArray = 2
export const actionPushInlineTable = 3
export const actionPop = 4

// Every table the loop reads. A later arm swaps some of them, e.g. grammarNext with trained cells, and may add states,
// since the sizes are fields too. The number of tokenizer states is lexerNext.length / classCount, and the number of
// tokens is symbolCount / contextCount.
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
  // [token]: what `by token` does.
  actionOfToken: readonly number[]
  // [depth], clamped
  depthClass: readonly number[]
  // [grammar state × symbolCount + token × contextCount + context]
  grammarNext: readonly number[]
  grammarAction: readonly number[]
  grammarError: readonly number[]
  // [event × grammarStateCount + grammar state after the character]
  display: readonly number[]
}

export const defaultTables: ParserTables = {
  classCount, eventCount, symbolCount, contextCount, grammarStateCount,
  errorState: grammarStateNames.indexOf('error'),
  classOfCodePoint: classTable,
  lexerNext: lexerNextTable,
  lexerEvent: lexerEventTable,
  grammarToken: grammarTokenTable,
  lexerErrorKind: lexerErrorKindTable,
  actionOfToken: actionOfTokenTable,
  depthClass: depthClassTable,
  grammarNext: grammarNextTable,
  grammarAction: grammarActionTable,
  grammarError: grammarErrorTable,
  display: displayTable,
}

// The cells the parser has: 512 code points and one more position, which is the end of the text, or the 513th code
// point of a longer text.
export const positionCount = capacity + 1

// The name that the code of the JSON experiment imports for the container with the number 1.
export const containerObject = containerInlineTable

// What the parser computes at every position. Each array has 513 entries. Entries from the text's length on belong to
// cells after the text.
export type ParserTrace = {
  // Code points read, at most 512.
  length: number
  characterClass: Int16Array
  lexerStateBefore: Int16Array
  event: Int16Array
  token: Int16Array
  // depthClass × 2 + [the innermost open container before the character is an inline table], the grammar table's
  // column within a token.
  context: Int16Array
  grammarBefore: Int16Array
  grammarAfter: Int16Array
  // The number of open arrays and inline tables after the character. It can be below 0 and above 16 after an error,
  // e.g. −1 after the ] of `a = 1]`.
  depthAfter: Int16Array
  // containerNone, containerInlineTable or containerArray: the innermost open container after the character.
  containerAfter: Int8Array
  displayKind: Int16Array
  // The first position at which the grammar enters the state `error`, or -1 when the text is valid.
  firstErrorPosition: number
  firstErrorKind: number
  valid: boolean
}

export function runTableParser(text: string, tables: ParserTables = defaultTables): ParserTrace {
  const codePoints: number[] = []
  let textLength = 0
  for (const character of text) {
    if (textLength < capacity) codePoints.push(character.codePointAt(0)!)
    textLength++
  }
  return runTableParserOnCodePoints(codePoints, textLength > capacity, tables)
}

// The kind of the container at each level, 1 to 16. A level's entry is written whenever the depth rises to the level,
// so a run never reads an entry of an earlier run.
const kindAtLevel = new Uint8Array(maximumDepth + 1)

// `codePoints` holds at most 512 code points, and `truncated` says that the text had more.
//
// The edges of the stack are those of lab/recovery-parser/learn/recovery-parser.ts:
// - A pop at depth 0 or below lowers the depth as at any depth, and a push at depth 16 or above raises it. The stack
//   holds kinds for the levels 1 to 16 only.
// - The context of a depth below 0 is the one of depth 0, and the context of a depth above 16 is the one of depth 16,
//   with the kind of the container at level 16. The container after a code point follows the same rule.
// - The last position, the end of a text of 512 code points or its 513th code point, reads the context of an array or
//   of no container, even inside an inline table. The JSON parser does so because the highlighter's program does. It
//   is kept so that the two loops are the same. Before a first error it changes nothing: a text that is inside an
//   inline table at its end is not valid either way.
//
// `room` is the number of code points that the run has room for, 512 everywhere but in check-toml-test.ts, which runs
// files of the official test suite that are longer. The trace's arrays have room + 1 entries.
export function runTableParserOnCodePoints(codePoints: readonly number[], truncated: boolean, tables: ParserTables = defaultTables, room: number = capacity): ParserTrace {
  const length = codePoints.length
  if (length > room) throw new Error(`runTableParserOnCodePoints takes at most ${room} code points, and got ${length}`)
  const positions = room + 1
  const trace: ParserTrace = {
    length,
    characterClass: new Int16Array(positions), lexerStateBefore: new Int16Array(positions), event: new Int16Array(positions),
    token: new Int16Array(positions), context: new Int16Array(positions), grammarBefore: new Int16Array(positions),
    grammarAfter: new Int16Array(positions), depthAfter: new Int16Array(positions), containerAfter: new Int8Array(positions),
    displayKind: new Int16Array(positions), firstErrorPosition: -1, firstErrorKind: 0, valid: true,
  }
  const lastClassEntry = tables.classOfCodePoint.length - 1
  let lexerState = 0
  let grammarState = 0
  let depth = 0
  for (let position = 0; position < positions; position++) {
    // The last position reads `end` (class 0) or `truncatedEnd` (class 1), and so does no code point.
    const characterClass = position === room
      ? Number(truncated)
      : tables.classOfCodePoint[Math.min((position < length ? codePoints[position]! : -1) + 1, lastClassEntry)]!
    const lexerCell = lexerState * tables.classCount + characterClass
    const event = tables.lexerEvent[lexerCell]!
    const token = tables.grammarToken[event]!
    const level = depth > maximumDepth ? maximumDepth : depth
    const inInlineTable = level >= 1 && position !== room && kindAtLevel[level] === containerInlineTable ? 1 : 0
    const context = tables.depthClass[level < 0 ? 0 : level]! * 2 + inInlineTable
    const cell = grammarState * tables.symbolCount + token * tables.contextCount + context
    const grammarAfter = tables.grammarNext[cell]!
    if (trace.firstErrorPosition === -1 && grammarAfter === tables.errorState) {
      trace.firstErrorPosition = position
      trace.firstErrorKind = tables.lexerErrorKind[event]! + tables.grammarError[cell]!
      trace.valid = false
    }
    let action = tables.grammarAction[cell]!
    if (action === actionByToken) action = tables.actionOfToken[token]!
    if (action === actionPushArray || action === actionPushInlineTable) {
      depth++
      if (depth >= 1 && depth <= maximumDepth) kindAtLevel[depth] = action === actionPushInlineTable ? containerInlineTable : containerArray
    } else if (action === actionPop) {
      depth--
    }
    trace.characterClass[position] = characterClass
    trace.lexerStateBefore[position] = lexerState
    trace.event[position] = event
    trace.token[position] = token
    trace.context[position] = context
    trace.grammarBefore[position] = grammarState
    trace.grammarAfter[position] = grammarAfter
    trace.displayKind[position] = tables.display[event * tables.grammarStateCount + grammarAfter]!
    trace.depthAfter[position] = depth
    trace.containerAfter[position] = depth <= 0 ? containerNone : kindAtLevel[depth > maximumDepth ? maximumDepth : depth]!
    lexerState = tables.lexerNext[lexerCell]!
    grammarState = grammarAfter
  }
  return trace
}

// The name of a grammar cell, e.g. "(afterValue, comma, depth 1, array)".
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

export {
  actionNames, capacity, classNames, containerArray, containerInlineTable, containerNames, containerNone, contextNames, eventNames,
  grammarStateNames, lexerStateNames, maximumDepth, tokenNames,
}
