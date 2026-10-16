// The broken samples of one split as the search holds them, and a parser loop that only computes a sample's score.
// It is lab/recovery-parser/learn/search/sample-runs.ts with other imports.
//
// The search runs a sample again for every choice it tries, many million times, so the loop here skips what no choice
// of the open cells can change: the part of a sample before the first position that reads an open cell. That position
// is the sample's first error, see recovery-tables.ts, and a score counts no code point before it. prepareSamples
// finds it with today's tables and the parser of recovery-parser.ts, and keeps the parser's state there.
//
// The loop has to count exactly what score.ts counts. check.ts compares the two on today's tables and on random
// settings of every open cell, also for tables with added classes and with the bit "first on its line", and
// searchCells compares them at its end.
import {type Samples, codePointKindScored, codePointNestingScored, codePointScored} from '../data.ts'
import {containerArray, containerInlineTable, containerNone, createTrace, maximumDepth, runRecoveryParserInto} from '../recovery-parser.ts'
import {type RecoveryTables, actionByToken, actionOfToken, actionPop, actionPushArray, actionPushInlineTable, asIsTables, classNames, today, tokenNames} from '../recovery-tables.ts'

const classLineFeed = classNames.indexOf('lineFeed')
const tokenNone = tokenNames.indexOf('none')

export type RunSamples = {
  // Broken samples only, in the order of the set they came from.
  sampleCount: number
  // The sample's place in the set it came from.
  place: Int32Array
  // The code points of sample s are the entries start[s] to start[s + 1] - 1 of the arrays per code point.
  start: Int32Array
  // A key of the class table that gave the code points their classes, see classTableKeyOf: tables with another class
  // table, e.g. with another added class, cannot run these samples.
  classTableKey: string
  // Per code point: the class, the flags of data.ts, and the label.
  classes: Uint8Array
  flags: Uint8Array
  labelKind: Int8Array
  labelDepth: Int8Array
  labelContainer: Int8Array
  // Per sample: the first position that reads an open cell, or the sample's length when no code point does, e.g. in
  // a damaged text that today's parser accepts. No choice of the open cells changes what the parser does before this
  // position.
  changeableFrom: Int32Array
  // The parser's state before that position: the tokenizer state, the grammar state, the depth, one bit per open
  // level that says whether the level is an inline table, bit 0 for level 1, and the bit "first on its line", which only
  // tables with that bit read.
  lexerStateThere: Uint8Array
  grammarStateThere: Uint8Array
  depthThere: Int8Array
  inlineTableLevelsThere: Uint16Array
  firstOnLineThere: Uint8Array
  // The score of the scored code points before that position, as scoreOfSample packs a score. It is 0: a score
  // counts the code points from the first error on, and the first error is the first read of an open cell.
  fixedScore: Int32Array
  // Scored code points over all samples: the ones from the first error on whose label has a scored value.
  scoredCodePoints: number
}

// A sample's score in one number: the scored code points with every scored label right × scorePack, plus the labels
// that are right one by one (the display kind, the depth and the container, each where it is scored). A sample has
// at most 512 code points, so the second count is at most 1536.
export const scorePack = 4096

const arrayFields = ['place', 'start', 'classes', 'flags', 'labelKind', 'labelDepth', 'labelContainer', 'changeableFrom', 'lexerStateThere', 'grammarStateThere', 'depthThere', 'inlineTableLevelsThere', 'firstOnLineThere', 'fixedScore'] as const

// A key of the classes that some tables give the code points: tables with the same key read the same cells' columns.
export const classTableKeyOf = (tables: RecoveryTables) => Bun.hash(tables.classOfCodePoint).toString(16)

// Throws when `tables` give a code point another class than the tables that `samples` were prepared for.
export function refuseOtherClasses(samples: RunSamples, tables: RecoveryTables) {
  if (samples.classTableKey !== classTableKeyOf(tables)) throw new Error('the samples of the search were prepared for another class table than the one of the tables: pass the tables, or tables with the same added classes, to prepareSamples')
}

// The broken samples of `samples`, with what scoreOfSample needs. The arrays sit in shared memory, so that worker
// threads read them without a copy each. `layout` are tables with the character classes of the tables that the
// search will run, e.g. the tables that it starts from: every code point gets the class that they give it. Without
// it, the classes are today's.
export function prepareSamples(samples: Samples, layout: RecoveryTables = asIsTables()): RunSamples {
  const places: number[] = []
  let codePointCount = 0
  for (let place = 0; place < samples.sampleCount; place++) {
    if (samples.firstDamage[place] === -1) continue
    places.push(place)
    codePointCount += samples.start[place + 1]! - samples.start[place]!
  }
  const sampleCount = places.length
  const shared = <Typed>(create: new (buffer: SharedArrayBuffer) => Typed, bytes: number) => new create(new SharedArrayBuffer(bytes))
  const prepared: RunSamples = {
    sampleCount, scoredCodePoints: 0, classTableKey: classTableKeyOf(layout),
    place: shared(Int32Array, 4 * sampleCount), start: shared(Int32Array, 4 * (sampleCount + 1)),
    classes: shared(Uint8Array, codePointCount), flags: shared(Uint8Array, codePointCount),
    labelKind: shared(Int8Array, codePointCount), labelDepth: shared(Int8Array, codePointCount), labelContainer: shared(Int8Array, codePointCount),
    changeableFrom: shared(Int32Array, 4 * sampleCount), lexerStateThere: shared(Uint8Array, sampleCount), grammarStateThere: shared(Uint8Array, sampleCount),
    depthThere: shared(Int8Array, sampleCount), inlineTableLevelsThere: shared(Uint16Array, 2 * sampleCount), firstOnLineThere: shared(Uint8Array, sampleCount),
    fixedScore: shared(Int32Array, 4 * sampleCount),
  }
  // Today's tables find the first position that reads an open cell and the state before it: up to there every
  // tables of every layout do what today's do.
  const tables = asIsTables()
  const trace = createTrace()
  const lastClassEntry = layout.classOfCodePoint.length - 1
  const kindAtLevel = new Uint8Array(maximumDepth + 1)
  let at = 0
  for (let sample = 0; sample < sampleCount; sample++) {
    const place = places[sample]!
    const first = samples.start[place]!
    const length = samples.start[place + 1]! - first
    prepared.place[sample] = place
    prepared.start[sample] = at
    for (let position = 0; position < length; position++) {
      prepared.classes[at + position] = layout.classOfCodePoint[Math.min(samples.codePoints[first + position]! + 1, lastClassEntry)]!
      prepared.flags[at + position] = samples.flags[first + position]!
      prepared.labelKind[at + position] = samples.labelKind[first + position]!
      prepared.labelDepth[at + position] = samples.labelDepth[first + position]!
      prepared.labelContainer[at + position] = samples.labelContainer[first + position]!
    }
    runRecoveryParserInto(trace, samples.codePoints, first, length, false, tables, length)
    let changeableFrom = 0
    let depth = 0
    // The bit "first on its line", as runRecoveryParserInto keeps it: a line feed sets it, and the first code point
    // after it whose token is not `none` clears it.
    let firstOnLine = 0
    while (changeableFrom < length && tables.lexerOpen[trace.lexerCell[changeableFrom]!] === 0 && tables.grammarOpen[trace.grammarCell[changeableFrom]!] === 0) {
      const action = trace.action[changeableFrom]!
      if (action === actionPushInlineTable || action === actionPushArray) kindAtLevel[++depth] = action === actionPushInlineTable ? containerInlineTable : containerArray
      else if (action === actionPop) depth--
      if (trace.characterClass[changeableFrom] === classLineFeed) firstOnLine = 1
      else if (trace.token[changeableFrom] !== tokenNone) firstOnLine = 0
      changeableFrom++
    }
    if (depth < 0 || depth > maximumDepth) throw new Error(`sample at place ${place}: the depth before its first open cell is ${depth}`)
    let inlineTableLevels = 0
    for (let level = 1; level <= depth; level++) if (kindAtLevel[level] === containerInlineTable) inlineTableLevels |= 1 << (level - 1)
    prepared.changeableFrom[sample] = changeableFrom
    prepared.lexerStateThere[sample] = changeableFrom < length ? trace.lexerStateBefore[changeableFrom]! : 0
    prepared.grammarStateThere[sample] = changeableFrom < length ? trace.grammarBefore[changeableFrom]! : 0
    prepared.depthThere[sample] = depth
    prepared.inlineTableLevelsThere[sample] = inlineTableLevels
    prepared.firstOnLineThere[sample] = firstOnLine
    // The first read of an open cell is the first error, or there is none among the code points: the first error is
    // after them, or the text has none.
    const firstError = samples.firstErrorPosition[place] === -1 ? length : samples.firstErrorPosition[place]!
    if (changeableFrom !== Math.min(firstError, length)) throw new Error(`sample at place ${place}: it first reads an open cell at ${changeableFrom}, and its first error is at ${firstError}`)
    for (let position = firstError; position < length; position++) if ((samples.flags[first + position]! & codePointScored) !== 0) prepared.scoredCodePoints++
    prepared.fixedScore[sample] = 0
    at += length
  }
  prepared.start[sampleCount] = at
  return prepared
}

// What a worker thread needs of the samples: the arrays, which are shared, the two counts and the key of the classes.
export function messageOf(samples: RunSamples) {
  return {sampleCount: samples.sampleCount, scoredCodePoints: samples.scoredCodePoints, classTableKey: samples.classTableKey, arrays: arrayFields.map(field => samples[field])}
}
export function samplesOfMessage(message: ReturnType<typeof messageOf>): RunSamples {
  const samples: Record<string, unknown> = {sampleCount: message.sampleCount, scoredCodePoints: message.scoredCodePoints, classTableKey: message.classTableKey}
  arrayFields.forEach((field, index) => { samples[field] = message.arrays[index] })
  return samples as unknown as RunSamples
}

// A bit per cell: the tokenizer's cells first, then the grammar's. The bit of a tokenizer cell is the cell's index,
// and the bit of a grammar cell is the number of tokenizer cells plus the cell's index.
export const cellBitCount = (tables: RecoveryTables) => tables.lexerNext.length + tables.grammarNext.length

const kindAtLevel = new Uint8Array(maximumDepth + 1)
const setKinds = (depth: number, inlineTableLevels: number) => {
  for (let level = 1; level <= depth && level <= maximumDepth; level++) kindAtLevel[level] = (inlineTableLevels >> (level - 1)) & 1 ? containerInlineTable : containerArray
}

// Runs the parser on the code points `at` to `end - 1` from the given state, and returns the packed score of those
// code points. With `cellsRead`, it also sets the bit of every cell that the run reads, from the byte `cellsOffset`
// on. The steps are those of runRecoveryParserInto. `firstOnLine` is the bit "first on its line" before the first
// code point, which only tables with 16 contexts read.
function scoreOfRun(samples: RunSamples, tables: RecoveryTables, at: number, end: number, lexerState: number, grammarState: number, depth: number, inlineTableLevels: number, firstOnLine: number, cellsRead: Uint8Array | null, cellsOffset: number): number {
  const {classCount, tokenCount, contextCount, grammarStateCount, tokenOfEvent, display, lexerNext, lexerEvent, grammarNext, grammarAction} = tables
  const {classes, flags, labelKind, labelDepth, labelContainer} = samples
  const depthClass = today.depthClass
  // What the bit adds to a context: 8, or 0 for tables without the bit.
  const firstOnLineContexts = contextCount - today.contextCount
  const lexerCellCount = lexerNext.length
  setKinds(depth, inlineTableLevels)
  let score = 0
  for (; at < end; at++) {
    const characterClass = classes[at]!
    const lexerCell = lexerState * classCount + characterClass
    const event = lexerEvent[lexerCell]!
    const token = tokenOfEvent[event]!
    const level = depth > maximumDepth ? maximumDepth : depth
    const context = depthClass[level < 0 ? 0 : level]! * 2 + (level >= 1 && kindAtLevel[level] === containerInlineTable ? 1 : 0) + firstOnLine * firstOnLineContexts
    const grammarCell = (grammarState * tokenCount + token) * contextCount + context
    const grammarAfter = grammarNext[grammarCell]!
    let action = grammarAction[grammarCell]!
    if (action === actionByToken) action = actionOfToken[token]!
    if (action === actionPushInlineTable || action === actionPushArray) {
      depth++
      if (depth >= 1 && depth <= maximumDepth) kindAtLevel[depth] = action === actionPushInlineTable ? containerInlineTable : containerArray
    } else if (action === actionPop) {
      depth--
    }
    if (characterClass === classLineFeed) firstOnLine = 1
    else if (token !== tokenNone) firstOnLine = 0
    if (cellsRead !== null) {
      cellsRead[cellsOffset + (lexerCell >> 3)]! |= 1 << (lexerCell & 7)
      const bit = lexerCellCount + grammarCell
      cellsRead[cellsOffset + (bit >> 3)]! |= 1 << (bit & 7)
    }
    // Every code point of a run is at or after the first error, so it counts when a value of its label is scored.
    const flag = flags[at]!
    if ((flag & codePointScored) !== 0) {
      let right = 0
      let allRight = true
      if ((flag & codePointNestingScored) !== 0) {
        if (depth === labelDepth[at]) right++
        else allRight = false
        if ((depth <= 0 ? containerNone : kindAtLevel[depth > maximumDepth ? maximumDepth : depth]!) === labelContainer[at]) right++
        else allRight = false
      }
      if ((flag & codePointKindScored) !== 0) {
        if (display[event * grammarStateCount + grammarAfter] === labelKind[at]) right++
        else allRight = false
      }
      score += allRight ? scorePack + right : right
    }
    lexerState = lexerNext[lexerCell]!
    grammarState = grammarAfter
  }
  return score
}

// The packed score of one sample's code points from its first changeable position on. The sample's whole score is
// this plus fixedScore.
export function scoreOfSample(samples: RunSamples, sample: number, tables: RecoveryTables, cellsRead: Uint8Array | null = null, cellsOffset = 0): number {
  return scoreOfRun(samples, tables, samples.start[sample]! + samples.changeableFrom[sample]!, samples.start[sample + 1]!, samples.lexerStateThere[sample]!,
    samples.grammarStateThere[sample]!, samples.depthThere[sample]!, samples.inlineTableLevelsThere[sample]!, samples.firstOnLineThere[sample]!, cellsRead, cellsOffset)
}

// Where a run stands before the first position that reads one cell: the index of that code point in the arrays per
// code point, and the parser's state before it. No other choice of that cell changes the run up to there, so the
// search tries a cell's choices from this state on instead of from the sample's first changeable position.
type FirstRead = {at: number, lexerState: number, grammarState: number, depth: number, inlineTableLevels: number, firstOnLine: number}

// Fills `firstRead` for the tokenizer cell `lexerCell` or the grammar cell `grammarCell` (the other one is -1), and
// returns false when the sample's run does not read the cell.
function findFirstRead(firstRead: FirstRead, samples: RunSamples, sample: number, tables: RecoveryTables, lexerCell: number, grammarCell: number): boolean {
  const {classCount, tokenCount, contextCount, tokenOfEvent, lexerNext, lexerEvent, grammarNext, grammarAction} = tables
  const classes = samples.classes
  const depthClass = today.depthClass
  const firstOnLineContexts = contextCount - today.contextCount
  const end = samples.start[sample + 1]!
  let lexerState = samples.lexerStateThere[sample]!
  let grammarState = samples.grammarStateThere[sample]!
  let depth = samples.depthThere[sample]!
  let firstOnLine = samples.firstOnLineThere[sample]!
  setKinds(depth, samples.inlineTableLevelsThere[sample]!)
  for (let at = samples.start[sample]! + samples.changeableFrom[sample]!; at < end; at++) {
    const characterClass = classes[at]!
    const lexerCellHere = lexerState * classCount + characterClass
    const token = tokenOfEvent[lexerEvent[lexerCellHere]!]!
    const level = depth > maximumDepth ? maximumDepth : depth
    const context = depthClass[level < 0 ? 0 : level]! * 2 + (level >= 1 && kindAtLevel[level] === containerInlineTable ? 1 : 0) + firstOnLine * firstOnLineContexts
    const grammarCellHere = (grammarState * tokenCount + token) * contextCount + context
    if (lexerCellHere === lexerCell || grammarCellHere === grammarCell) {
      let inlineTableLevels = 0
      for (let open = 1; open <= depth && open <= maximumDepth; open++) if (kindAtLevel[open] === containerInlineTable) inlineTableLevels |= 1 << (open - 1)
      firstRead.at = at
      firstRead.lexerState = lexerState
      firstRead.grammarState = grammarState
      firstRead.depth = depth
      firstRead.inlineTableLevels = inlineTableLevels
      firstRead.firstOnLine = firstOnLine
      return true
    }
    let action = grammarAction[grammarCellHere]!
    if (action === actionByToken) action = actionOfToken[token]!
    if (action === actionPushInlineTable || action === actionPushArray) {
      depth++
      if (depth >= 1 && depth <= maximumDepth) kindAtLevel[depth] = action === actionPushInlineTable ? containerInlineTable : containerArray
    } else if (action === actionPop) {
      depth--
    }
    if (characterClass === classLineFeed) firstOnLine = 1
    else if (token !== tokenNone) firstOnLine = 0
    lexerState = lexerNext[lexerCellHere]!
    grammarState = grammarNext[grammarCellHere]!
  }
  return false
}

// The packed score of a sample's code points from a first read on.
function scoreFromFirstRead(firstRead: FirstRead, samples: RunSamples, sample: number, tables: RecoveryTables): number {
  return scoreOfRun(samples, tables, firstRead.at, samples.start[sample + 1]!, firstRead.lexerState, firstRead.grammarState, firstRead.depth, firstRead.inlineTableLevels, firstRead.firstOnLine, null, 0)
}

// What other choices of one cell change: for each choice in `candidates` (two numbers each: the next state and the
// event of a tokenizer cell, or the next state and the stack action of a grammar cell), the change of the two counts
// of a packed score over the samples in `among`, against the choice that the cell holds. Only a sample whose run
// reads the cell can change, and only from its first read on. `readers` is how many of the samples read the cell.
export function changesOfChoices(samples: RunSamples, among: ArrayLike<number>, tables: RecoveryTables, grammar: boolean, cell: number, candidates: Uint8Array) {
  const firstPart = grammar ? tables.grammarNext : tables.lexerNext
  const secondPart = grammar ? tables.grammarAction : tables.lexerEvent
  const candidateCount = candidates.length / 2
  const allRight = new Int32Array(candidateCount)
  const labelsRight = new Int32Array(candidateCount)
  // Where each reader's run first reads the cell, and its score from there on with the cell as it is.
  const readers: number[] = []
  const firstReads: FirstRead[] = []
  const scoresBefore: number[] = []
  for (let index = 0; index < among.length; index++) {
    const firstRead: FirstRead = {at: 0, lexerState: 0, grammarState: 0, depth: 0, inlineTableLevels: 0, firstOnLine: 0}
    const sample = among[index]!
    if (!findFirstRead(firstRead, samples, sample, tables, grammar ? -1 : cell, grammar ? cell : -1)) continue
    readers.push(sample)
    firstReads.push(firstRead)
    scoresBefore.push(scoreFromFirstRead(firstRead, samples, sample, tables))
  }
  const firstBefore = firstPart[cell]!
  const secondBefore = secondPart[cell]!
  for (let candidate = 0; candidate < candidateCount; candidate++) {
    firstPart[cell] = candidates[candidate * 2]!
    secondPart[cell] = candidates[candidate * 2 + 1]!
    let allRightChange = 0
    let labelsRightChange = 0
    for (let reader = 0; reader < readers.length; reader++) {
      const after = scoreFromFirstRead(firstReads[reader]!, samples, readers[reader]!, tables)
      const before = scoresBefore[reader]!
      allRightChange += Math.floor(after / scorePack) - Math.floor(before / scorePack)
      labelsRightChange += after % scorePack - before % scorePack
    }
    allRight[candidate] = allRightChange
    labelsRight[candidate] = labelsRightChange
  }
  firstPart[cell] = firstBefore
  secondPart[cell] = secondBefore
  return {allRight, labelsRight, readers: readers.length}
}

// The packed score of every sample together, as two counts: the scored code points with every scored label right,
// and the labels that are right one by one.
export function totalScore(samples: RunSamples, tables: RecoveryTables) {
  let allRight = 0
  let labelsRight = 0
  for (let sample = 0; sample < samples.sampleCount; sample++) {
    const score = samples.fixedScore[sample]! + (samples.changeableFrom[sample]! < samples.start[sample + 1]! - samples.start[sample]! ? scoreOfSample(samples, sample, tables) : 0)
    allRight += Math.floor(score / scorePack)
    labelsRight += score % scorePack
  }
  return {allRight, labelsRight}
}
