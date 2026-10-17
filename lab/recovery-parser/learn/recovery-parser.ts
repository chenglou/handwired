// The parser of the recovery experiment: one code point per step over RecoveryTables, as table-parser.ts runs the
// highlighter's own tables. With asIsTables() it gives the trace of today's parser. It differs from table-parser.ts
// in four ways:
//
// - A grammar cell holds a stack action next to its next state: by token, none, push an array, push an object, pop.
// - With tables of 16 contexts, see addFirstOnLineBit, the grammar also reads the bit "the token is the first on its
//   line": a line feed sets it, and the first code point after it whose token is not `none` clears it. Every code
//   point after the line feed, up to and including that one, reads its grammar cell with the bit.
// - The open containers are a real stack, one kind per open level. Today's parser keeps the kinds in a running sum,
//   which is only right before the first error: a closing bracket of the wrong kind leaves the sum with the kind of
//   a container that is no longer open, e.g. after the ] of {"a": [1}] . Before the first error the two are the same.
// - The first error, its kind and `valid` come from today's tables, whatever the open cells hold: the first error is
//   the first position at which today's tables lead into the grammar state `error`.
//
// The edges, chosen so that asIsTables() gives today's depths everywhere, and today's contexts up to and at the first
// error. After a first error the contexts can differ from today's, because the stack and today's running sum then
// disagree about the innermost container, e.g. today's parser can read the context "depth 0, object", which this
// parser never reads:
// - A pop at depth 0 or below lowers the depth as at any depth, so the depth can be negative, e.g. -1 after the ] of
//   1] . There is no kind to forget.
// - A push at depth 16 or above raises the depth as at any depth. The stack holds kinds for the levels 1 to 16 only,
//   so the kind of a container above level 16 is not kept, and neither is one pushed at a negative depth.
// - The context of a depth below 0 is the one of depth 0, without a container. The context of a depth above 16 is the
//   one of depth 16, with the kind of the container at level 16. The container after a code point follows the same
//   rule: none at depth 0 or below, the kind at level 16 above depth 16.
// - Position 512, the end of a text of 512 code points or its 513th code point, reads the context of an array or of no
//   container, even inside an object, as in the highlighter's program.
import {capacity, containerArray, containerNone, containerObject, maximumDepth, positionCount} from '../table-parser.ts'
import {type RecoveryTables, actionByToken, actionOfToken, actionPop, actionPushArray, actionPushObject, checkTables, classNames, today, tokenNames} from './recovery-tables.ts'

const classLineFeed = classNames.indexOf('lineFeed')
const tokenNone = tokenNames.indexOf('none')

// What the parser computes at every position. Each array has 513 entries: 512 code points and the position after
// them. Entries from the text's length on belong to cells after the text.
export type RecoveryTrace = {
  // Code points read, at most 512.
  length: number
  characterClass: Int16Array
  lexerStateBefore: Int16Array
  lexerStateAfter: Int16Array
  event: Int16Array
  token: Int16Array
  // depth class × 2 + [the innermost open container before the code point is an object], and + 8 when the tables have
  // the bit "first on its line" and the bit is set before the code point.
  context: Int16Array
  grammarBefore: Int16Array
  grammarAfter: Int16Array
  // The cells that the step read: tokenizer state × classCount + class, and (grammar state × tokenCount + token) ×
  // contextCount + context. They are 32-bit numbers: tables can have up to 255 states and 255 classes, and e.g. 187
  // grammar states with the bit "first on its line" have 32,912 cells, more than 16 bits hold.
  lexerCell: Int32Array
  grammarCell: Int32Array
  // What the step did to the stack: actionNone, actionPushArray, actionPushObject or actionPop. A cell's `by token` is
  // shown as what the token did.
  action: Int8Array
  displayKind: Int16Array
  // The number of open containers after the code point. It can be below 0 and above 16, see the top of this file.
  depthAfter: Int16Array
  // containerNone, containerObject or containerArray: the innermost open container after the code point.
  containerAfter: Int8Array
  // The first position at which today's tables lead into the grammar state `error`, or -1, and the error's kind as in
  // kinds.ts. They are the same for every choice of the open cells.
  firstErrorPosition: number
  firstErrorKind: number
  valid: boolean
}

export function createTrace(): RecoveryTrace {
  const cells = () => new Int16Array(positionCount)
  return {
    length: 0, characterClass: cells(), lexerStateBefore: cells(), lexerStateAfter: cells(), event: cells(), token: cells(), context: cells(),
    grammarBefore: cells(), grammarAfter: cells(), lexerCell: new Int32Array(positionCount), grammarCell: new Int32Array(positionCount), action: new Int8Array(positionCount),
    displayKind: cells(), depthAfter: cells(), containerAfter: new Int8Array(positionCount), firstErrorPosition: -1, firstErrorKind: 0, valid: true,
  }
}

// The kind of the container at each level, 1 to 16. A level's entry is written whenever the depth rises to the level,
// so a run never reads an entry of an earlier run.
const kindAtLevel = new Uint8Array(maximumDepth + 1)

// Runs the parser on the code points codePoints[start] to codePoints[start + length - 1], at most 512, and writes the
// first `positions` positions into `trace`. `truncated` says that the text had more than 512 code points.
//
// This is the function for loops over many texts: it allocates nothing, and it does not check the tables, so call
// checkTables once before. With fewer than 513 positions, e.g. the text's length when only the code points are
// scored, the entries from `positions` on keep what an earlier run wrote, and the first error and `valid` only say
// what happened in the positions that ran.
export function runRecoveryParserInto(trace: RecoveryTrace, codePoints: ArrayLike<number>, start: number, length: number, truncated: boolean, tables: RecoveryTables, positions: number = positionCount) {
  const {classCount, tokenCount, contextCount, grammarStateCount, errorState, classToday, classOfCodePoint, tokenOfEvent, display, lexerNext, lexerEvent, grammarNext, grammarAction} = tables
  const lastClassEntry = classOfCodePoint.length - 1
  // What the bit "first on its line" adds to a context: 8, or 0 for tables without the bit.
  const firstOnLineContexts = contextCount - today.contextCount
  let lexerState = 0
  let grammarState = 0
  let depth = 0
  let firstOnLine = 0
  let firstErrorPosition = -1
  let firstErrorKind = 0
  for (let position = 0; position < positions; position++) {
    // Position 512 reads `end` (class 0) or `truncatedEnd` (class 1), and a position after the text reads `end`.
    const characterClass = position === capacity ? Number(truncated)
      : position < length ? classOfCodePoint[Math.min(codePoints[start + position]! + 1, lastClassEntry)]! : 0
    const lexerCell = lexerState * classCount + characterClass
    const event = lexerEvent[lexerCell]!
    const token = tokenOfEvent[event]!
    const level = depth > maximumDepth ? maximumDepth : depth
    const inObject = level >= 1 && position !== capacity && kindAtLevel[level] === containerObject ? 1 : 0
    const contextToday = today.depthClass[level < 0 ? 0 : level]! * 2 + inObject
    const context = contextToday + firstOnLine * firstOnLineContexts
    const grammarCell = (grammarState * tokenCount + token) * contextCount + context
    if (firstErrorPosition === -1) {
      // Today's step from the same state. Up to here every cell that was read is frozen, so the state is today's.
      // Today's tables have no added class and no bit: they read the class that the code point has today, and the
      // context without the bit.
      const eventToday = today.lexerEvent[lexerState * today.classCount + classToday[characterClass]!]!
      const grammarCellToday = (grammarState * tokenCount + today.tokenOfEvent[eventToday]!) * today.contextCount + contextToday
      if (today.grammarNext[grammarCellToday] === errorState) {
        firstErrorPosition = position
        firstErrorKind = today.lexerErrorKind[eventToday]! + today.grammarError[grammarCellToday]!
      }
    }
    const grammarAfter = grammarNext[grammarCell]!
    let action = grammarAction[grammarCell]!
    if (action === actionByToken) action = actionOfToken[token]!
    if (action === actionPushObject || action === actionPushArray) {
      depth++
      if (depth >= 1 && depth <= maximumDepth) kindAtLevel[depth] = action === actionPushObject ? containerObject : containerArray
    } else if (action === actionPop) {
      depth--
    }
    if (characterClass === classLineFeed) firstOnLine = 1
    else if (token !== tokenNone) firstOnLine = 0
    trace.characterClass[position] = characterClass
    trace.lexerStateBefore[position] = lexerState
    trace.event[position] = event
    trace.token[position] = token
    trace.context[position] = context
    trace.grammarBefore[position] = grammarState
    trace.grammarAfter[position] = grammarAfter
    trace.lexerCell[position] = lexerCell
    trace.grammarCell[position] = grammarCell
    trace.action[position] = action
    trace.displayKind[position] = display[event * grammarStateCount + grammarAfter]!
    trace.depthAfter[position] = depth
    trace.containerAfter[position] = depth <= 0 ? containerNone : kindAtLevel[depth > maximumDepth ? maximumDepth : depth]!
    lexerState = lexerNext[lexerCell]!
    trace.lexerStateAfter[position] = lexerState
    grammarState = grammarAfter
  }
  trace.length = length
  trace.firstErrorPosition = firstErrorPosition
  trace.firstErrorKind = firstErrorKind
  trace.valid = firstErrorPosition === -1
}

// The trace of a text given as its first code points, at most 512, with `truncated` true when the text had more.
// Throws when the tables break the ground rules.
export function runRecoveryParser(codePoints: ArrayLike<number>, truncated: boolean, tables: RecoveryTables): RecoveryTrace {
  if (codePoints.length > capacity) throw new Error(`runRecoveryParser takes at most ${capacity} code points, and got ${codePoints.length}`)
  checkTables(tables)
  const trace = createTrace()
  runRecoveryParserInto(trace, codePoints, 0, codePoints.length, truncated, tables)
  return trace
}

// The first 512 code points of a text, and whether it has more.
export function codePointsOf(text: string): {codePoints: number[], truncated: boolean} {
  const codePoints: number[] = []
  let count = 0
  for (const character of text) {
    if (count < capacity) codePoints.push(character.codePointAt(0)!)
    count++
  }
  return {codePoints, truncated: count > capacity}
}

export function runRecoveryParserOnText(text: string, tables: RecoveryTables): RecoveryTrace {
  const {codePoints, truncated} = codePointsOf(text)
  return runRecoveryParser(codePoints, truncated, tables)
}

export {capacity, containerArray, containerNone, containerObject, maximumDepth, positionCount}
