// HELD BACK: do not read this folder if you build the parser, the train data, the training or its machinery. See
// ../README.md.
//
// What a parser shows for a text, per code point: the display kind, the depth after it and the container after it.
// Each row of the recount is shown twice, by two pieces of code that share as little as they can:
//
// - Row 1, the parser as it is: the plain parser of ../../table-parser.ts, and the exact parser of ../../learn/ with
//   today's tables.
// - Row 2, the one rule: the rule as written here over the plain parser, and ../../learn/restart-at-next-line.ts.
// - The rows 3 to 8, saved tables: the exact parser of ../../learn/recovery-parser.ts with the tables as
//   ../../learn/recovery-tables.ts loads them, and a loop written here over the arrays of the file as JSON.parse
//   gives them.
import {readFileSync} from 'node:fs'
import {capacity, containerArray, containerInlineTable, containerNone, maximumDepth} from '../../kinds.ts'
import {createTrace, runRecoveryParserInto} from '../../learn/recovery-parser.ts'
import {type RecoveryTables, asIsTables, loadTables} from '../../learn/recovery-tables.ts'
import {runRestartAtNextLine} from '../../learn/restart-at-next-line.ts'
import {actionByToken, actionPop, actionPushArray, actionPushInlineTable, defaultTables, runTableParserOnCodePoints, tokenNames} from '../../table-parser.ts'

export type Shown = {displayKind: ArrayLike<number>, depthAfter: ArrayLike<number>, containerAfter: ArrayLike<number>}
export type Show = (codePoints: readonly number[]) => Shown

const lineFeed = 0x0a

function refuseLongText(codePoints: readonly number[]) {
  if (codePoints.length > capacity) throw new Error(`a text of the recount has ${codePoints.length} code points, and the parser reads ${capacity}`)
}

// Row 1 by the plain parser.
export const showAsItIs: Show = codePoints => {
  refuseLongText(codePoints)
  return runTableParserOnCodePoints(codePoints, false)
}

// Row 2 as its sentence says it: after an error, the parser as it is starts anew at the next line. The line of the
// error, up to and with its line feed, is shown as the run that found the error shows it. An error at the end of the
// text, e.g. a string that is not closed, has no next line.
export const showWithTheRule: Show = codePoints => {
  refuseLongText(codePoints)
  const shown = {displayKind: new Int16Array(codePoints.length), depthAfter: new Int16Array(codePoints.length), containerAfter: new Int16Array(codePoints.length)}
  let startOfRun = 0
  while (startOfRun < codePoints.length) {
    const rest = codePoints.slice(startOfRun)
    const trace = runTableParserOnCodePoints(rest, false)
    let shownOfRun = rest.length
    if (trace.firstErrorPosition !== -1 && trace.firstErrorPosition < rest.length) {
      const lineFeedAt = rest.indexOf(lineFeed, trace.firstErrorPosition)
      if (lineFeedAt !== -1) shownOfRun = lineFeedAt + 1
    }
    for (let position = 0; position < shownOfRun; position++) {
      shown.displayKind[startOfRun + position] = trace.displayKind[position]!
      shown.depthAfter[startOfRun + position] = trace.depthAfter[position]!
      shown.containerAfter[startOfRun + position] = trace.containerAfter[position]!
    }
    startOfRun += shownOfRun
  }
  return shown
}

// The exact parser of ../../learn/ for some tables. What it returns is overwritten by its next call.
export function showWithExactParser(tables: RecoveryTables): Show {
  const trace = createTrace()
  return codePoints => {
    refuseLongText(codePoints)
    runRecoveryParserInto(trace, codePoints, 0, codePoints.length, false, tables, codePoints.length)
    return trace
  }
}
export const showAsItIsWithExactParser: Show = showWithExactParser(asIsTables())
export const showWithTheRuleOfLearn: Show = codePoints => runRestartAtNextLine(codePoints)

// The arrays of a file of saved tables as they stand in the file.
export type TablesOfFile = {
  datasetKey: string
  classCount: number
  tokenCount: number
  contextCount: number
  grammarStateCount: number
  addedClasses: number
  classOfCodePoint: number[]
  tokenOfEvent: number[]
  display: number[]
  lexerNext: number[]
  lexerEvent: number[]
  grammarNext: number[]
  grammarAction: number[]
}

export function readTablesOfFile(path: string): TablesOfFile {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  const numberOf = (field: string) => {
    const value = parsed[field]
    if (typeof value !== 'number') throw new Error(`${path}: the field ${field} is no number`)
    return value
  }
  const arrayOf = (field: string) => {
    const value = parsed[field]
    if (!Array.isArray(value) || !value.every(entry => typeof entry === 'number')) throw new Error(`${path}: the field ${field} is no list of numbers`)
    return value
  }
  const addedClasses = parsed['addedClasses']
  return {
    datasetKey: String(parsed['datasetKey']), classCount: numberOf('classCount'), tokenCount: numberOf('tokenCount'), contextCount: numberOf('contextCount'), grammarStateCount: numberOf('grammarStateCount'),
    addedClasses: Array.isArray(addedClasses) ? addedClasses.length : 0,
    classOfCodePoint: arrayOf('classOfCodePoint'), tokenOfEvent: arrayOf('tokenOfEvent'), display: arrayOf('display'), lexerNext: arrayOf('lexerNext'), lexerEvent: arrayOf('lexerEvent'),
    grammarNext: arrayOf('grammarNext'), grammarAction: arrayOf('grammarAction'),
  }
}

const tokenNone = tokenNames.indexOf('none')
const contextsWithoutTheBit = defaultTables.contextCount

// The loop of this folder over the arrays of a file: one step per code point, as ../../README.md and
// ../../learn/README.md say it. The tokenizer's cell gives an event, the event a token, the grammar's cell (state,
// token, context) the next state and a stack action, and the display table the kind of (event, state after). A
// context is the depth class times 2, plus 1 inside an inline table, plus 8 with the bit "first on its line" set: a
// line feed sets the bit, and the first code point after it whose token is not `none` clears it.
export function showWithLoopOfThisFolder(file: TablesOfFile): Show {
  const hasTheBit = file.contextCount === 2 * contextsWithoutTheBit
  if (!hasTheBit && file.contextCount !== contextsWithoutTheBit) throw new Error(`tables with ${file.contextCount} contexts`)
  const lastClassEntry = file.classOfCodePoint.length - 1
  return codePoints => {
    refuseLongText(codePoints)
    const shown = {displayKind: new Int16Array(codePoints.length), depthAfter: new Int16Array(codePoints.length), containerAfter: new Int16Array(codePoints.length)}
    const containerOfLevel = new Uint8Array(maximumDepth + 1)
    let tokenizerState = 0
    let grammarState = 0
    let depth = 0
    let firstOnItsLine = false
    for (let position = 0; position < codePoints.length; position++) {
      const codePoint = codePoints[position]!
      const characterClass = file.classOfCodePoint[Math.min(codePoint + 1, lastClassEntry)]!
      const tokenizerCell = tokenizerState * file.classCount + characterClass
      const event = file.lexerEvent[tokenizerCell]!
      const token = file.tokenOfEvent[event]!
      const level = Math.max(0, Math.min(depth, maximumDepth))
      const insideInlineTable = level >= 1 && containerOfLevel[level] === containerInlineTable
      const context = defaultTables.depthClass[level]! * 2 + (insideInlineTable ? 1 : 0) + (hasTheBit && firstOnItsLine ? contextsWithoutTheBit : 0)
      const grammarCell = (grammarState * file.tokenCount + token) * file.contextCount + context
      const grammarStateAfter = file.grammarNext[grammarCell]!
      let action = file.grammarAction[grammarCell]!
      if (action === actionByToken) action = defaultTables.actionOfToken[token]!
      if (action === actionPushArray || action === actionPushInlineTable) {
        depth++
        if (depth >= 1 && depth <= maximumDepth) containerOfLevel[depth] = action === actionPushArray ? containerArray : containerInlineTable
      } else if (action === actionPop) {
        depth--
      }
      if (codePoint === lineFeed) firstOnItsLine = true
      else if (token !== tokenNone) firstOnItsLine = false
      shown.displayKind[position] = file.display[event * file.grammarStateCount + grammarStateAfter]!
      shown.depthAfter[position] = depth
      shown.containerAfter[position] = depth <= 0 ? containerNone : containerOfLevel[Math.min(depth, maximumDepth)]!
      tokenizerState = file.lexerNext[tokenizerCell]!
      grammarState = grammarStateAfter
    }
    return shown
  }
}

export {loadTables}
