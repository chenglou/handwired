// The tables that the recovery experiment runs and changes: the JSON highlighter's tokenizer table and grammar table,
// a stack action per grammar cell, and which cells may change.
//
// A cell is one entry of the tokenizer's table, (tokenizer state, class), or of the grammar's table, (grammar state,
// token, context). A frozen cell is one that some text makes the parser read before that text's first error, e.g.
// (between, quote), which every string of a valid text reads. Every other cell is open: the parser reads it only at or
// after a first error, e.g. (between, other), which the x of [x] reads. Only open cells may change. Then every text
// gets the same trace as today up to its first error, and valid JSON is parsed exactly as today.
//
// The code keeps the names of table-parser.ts, where the tokenizer is the "lexer".
import {readFileSync, writeFileSync} from 'node:fs'
import type {Random} from '../random.ts'
import {classNames, containerArray, containerNone, containerObject, contextNames, defaultTables, eventNames, grammarStateNames, lexerStateNames, maximumDepth, tokenNames} from '../table-parser.ts'

// What a grammar cell does to the stack of open containers. `by token` is what the parser does today: an opening
// bracket pushes its kind, a closing bracket pops, and any other token does nothing.
export const actionNames = ['by token', 'none', 'push array', 'push object', 'pop'] as const
export const actionByToken = 0
export const actionNone = 1
export const actionPushArray = 2
export const actionPushObject = 3
export const actionPop = 4
export const actionCount = actionNames.length

// A class that addClasses gave to some code points, e.g. {name: 'apostrophe', codePoints: [0x27]}.
export type AddedClass = {name: string, codePoints: readonly number[]}

export type RecoveryTables = {
  // Sizes. Today there are 33 classes, 26 tokenizer states, 25 events, 11 tokens, 8 contexts and 8 grammar states.
  // Tables may have more tokenizer states and more grammar states, see addStates, and more classes, see addClasses.
  // The other sizes are fixed.
  classCount: number
  lexerStateCount: number
  eventCount: number
  tokenCount: number
  contextCount: number
  grammarStateCount: number
  // The grammar state `error`.
  errorState: number
  // The classes that addClasses added, in the order of their numbers: the first one is class 33. Never changed in
  // place, so copies of tables share the list.
  addedClasses: readonly AddedClass[]
  // classToday[class]: the class of today's 33 that the code points of a class have in the highlighter, e.g. `other`
  // for an added class of the apostrophe. A class of today's is its own.
  classToday: Uint8Array
  // classOfCodePoint[code point + 1], where entry 0 is the class `end` and a code point past the table reads the last
  // entry, which is `other`. It is today's table with the code points of the added classes changed, and longer when
  // an added class has a code point from U+007F up.
  classOfCodePoint: Uint8Array
  // Fixed tables. tokenOfEvent[event]. display[event × grammarStateCount + grammar state after].
  tokenOfEvent: Uint8Array
  display: Uint8Array
  // The tokenizer's cells, [tokenizer state × classCount + class]: the next tokenizer state, the event, and 1 where
  // the cell is open.
  lexerNext: Uint8Array
  lexerEvent: Uint8Array
  lexerOpen: Uint8Array
  // The grammar's cells, [(grammar state × tokenCount + token) × contextCount + context]: the next grammar state, the
  // stack action, and 1 where the cell is open.
  grammarNext: Uint8Array
  grammarAction: Uint8Array
  grammarOpen: Uint8Array
}

const classCount = defaultTables.classCount
const lexerStateCount = defaultTables.lexerNext.length / classCount
const eventCount = defaultTables.eventCount
const contextCount = defaultTables.contextCount
const tokenCount = defaultTables.symbolCount / contextCount
const grammarStateCount = defaultTables.grammarStateCount
const errorState = defaultTables.errorState

// Today's tables, which the parser also reads to find the first error, see recovery-parser.ts. Never change them.
export const today = {
  classCount, lexerStateCount, eventCount, tokenCount, contextCount, grammarStateCount, errorState,
  classOfCodePoint: Uint8Array.from(defaultTables.classOfCodePoint),
  tokenOfEvent: Uint8Array.from(defaultTables.grammarToken),
  display: Uint8Array.from(defaultTables.display),
  lexerNext: Uint8Array.from(defaultTables.lexerNext),
  lexerEvent: Uint8Array.from(defaultTables.lexerEvent),
  grammarNext: Uint8Array.from(defaultTables.grammarNext),
  // The kind of a first error is lexerErrorKind[event] + grammarError[grammar cell].
  lexerErrorKind: Uint8Array.from(defaultTables.lexerErrorKind),
  grammarError: Uint8Array.from(defaultTables.grammarError),
  // depthClass[depth] for the depths 0 to 16: 0, 1, 2 for the depths 2 to 15, and 3.
  depthClass: Uint8Array.from(defaultTables.depthClass),
}

// What `by token` does for each token.
export const actionOfToken = Uint8Array.from(tokenNames, name =>
  name === 'openObject' ? actionPushObject : name === 'openArray' ? actionPushArray : name === 'closeObject' || name === 'closeArray' ? actionPop : actionNone)

function checkToday() {
  if (lexerStateCount !== lexerStateNames.length || tokenCount !== tokenNames.length || today.depthClass.length !== maximumDepth + 1) throw new Error('recovery-tables.ts no longer fits the sizes of table-parser.ts')
  // `by token` has to change the depth as today's parser does, which adds depthChange[event].
  for (let event = 0; event < eventCount; event++) {
    const action = actionOfToken[today.tokenOfEvent[event]!]!
    const change = action === actionPushObject || action === actionPushArray ? 1 : action === actionPop ? -1 : 0
    if (change !== defaultTables.depthChange[event]) throw new Error(`the event ${eventNames[event]} changes the depth by ${defaultTables.depthChange[event]} today, and its token by ${change}`)
  }
}
checkToday()

const classOther = classNames.indexOf('other')
const todaysClasses = Uint8Array.from({length: classCount}, (_, characterClass) => characterClass)

// The class table of tables with added classes, the class of today's for every class, and for every added class the
// class that its code points came from. The classes are added in the order of the list, so a later class may take
// code points of an earlier one. Throws when the list cannot be, e.g. when the code points of one added class have
// several classes before it is added: the cells of the new class start as copies of the cells of one class.
function classesWith(addedClasses: readonly AddedClass[]) {
  if (classCount + addedClasses.length > 255) throw new Error(`tables hold at most 255 classes, and these would have ${classCount + addedClasses.length}`)
  const names = new Set<string>(classNames)
  let highest = -1
  for (const {name, codePoints} of addedClasses) {
    if (name === '' || names.has(name)) throw new Error(`the added class ${JSON.stringify(name)} has no name, or the name of another class`)
    names.add(name)
    if (codePoints.length === 0) throw new Error(`the added class ${name} has no code point`)
    for (const codePoint of codePoints) {
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) throw new Error(`the added class ${name} holds ${codePoint}, which is no code point`)
      highest = Math.max(highest, codePoint)
    }
  }
  // The last entry stands for every code point past the table, so it has to stay `other`.
  const classOfCodePoint = new Uint8Array(Math.max(today.classOfCodePoint.length, highest + 3)).fill(classOther)
  classOfCodePoint.set(today.classOfCodePoint)
  const classToday = new Uint8Array(classCount + addedClasses.length)
  classToday.set(todaysClasses)
  const cameFrom: number[] = []
  addedClasses.forEach(({name, codePoints}, index) => {
    const from = classOfCodePoint[codePoints[0]! + 1]!
    for (const codePoint of codePoints) {
      if (classOfCodePoint[codePoint + 1] !== from) throw new Error(`the code points of the added class ${name} do not all have one class before, or the list names one twice: U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`)
    }
    for (const codePoint of codePoints) classOfCodePoint[codePoint + 1] = classCount + index
    // A class without a code point would have cells that no text reads, frozen or not.
    if (!classOfCodePoint.includes(from)) throw new Error(`the added class ${name} would leave the class ${classNames[from] ?? addedClasses[from - classCount]!.name} without a code point`)
    classToday[classCount + index] = classToday[from]!
    cameFrom.push(from)
  })
  return {classOfCodePoint, classToday, cameFrom}
}

// The frozen cells, by a search over what a text can make today's parser do before its first error. A configuration
// is the tokenizer state, the grammar state, the depth, and the kind of the innermost open container. The search
// does not know the kinds of the containers further out. So after a closing bracket at depth 2 or more, where the
// container that becomes the innermost can be of either kind, the search takes both kinds as reached. A configuration
// that no text reaches can only freeze more cells, never fewer.
//
// The search goes on from such a guess only once every other step is used up, and counts the configurations that it
// reached by a guess alone: none, with today's tables. So every configuration has a text that leads to it without a
// guess, and check-tables.ts runs such a text for every frozen cell: no cell is frozen without need.
//
// With added classes the search runs over the classes of `classToday`, one entry per class: a step with an added
// class is today's step with the class that its code points have today, and it freezes the cell of the added class.
// E.g. an apostrophe inside a string is read by valid JSON, so the cell (string, apostrophe) is frozen, and an
// apostrophe between tokens is an error today, so the cell (between, apostrophe) is open.
const kindCount = 3
const classEnd = classNames.indexOf('end')
function searchFrozenCells(classToday: Uint8Array) {
  const classes = classToday.length
  const configurationOf = (lexerState: number, grammarState: number, depth: number, kind: number) =>
    ((lexerState * grammarStateCount + grammarState) * (maximumDepth + 1) + depth) * kindCount + kind
  // For every configuration the search reached: the configuration it came from and the class that led to it. -2
  // where the search did not reach, -1 at the start.
  const cameFrom = new Int32Array(lexerStateCount * grammarStateCount * (maximumDepth + 1) * kindCount).fill(-2)
  const cameByClass = new Uint8Array(cameFrom.length)
  const lexerFrozen = new Uint8Array(lexerStateCount * classes)
  const grammarFrozen = new Uint8Array(grammarStateCount * tokenCount * contextCount)
  // For every frozen cell: a configuration from which a class reads the cell without an error, and that class.
  const lexerReadFrom = new Int32Array(lexerFrozen.length).fill(-1)
  const grammarReadFrom = new Int32Array(grammarFrozen.length).fill(-1)
  const grammarReadByClass = new Uint8Array(grammarFrozen.length)
  const queue = [configurationOf(0, 0, 0, containerNone)]
  cameFrom[queue[0]!] = -1
  // The steps that end in a guessed kind: the configuration before, the class, and the configuration after.
  const guesses: [from: number, characterClass: number, to: number][] = []
  let reachedByGuessAlone = 0
  const reach = (from: number, characterClass: number, to: number) => {
    if (cameFrom[to] !== -2) return false
    cameFrom[to] = from
    cameByClass[to] = characterClass
    queue.push(to)
    return true
  }
  for (let head = 0; head < queue.length; head++) {
    const configuration = queue[head]!
    const kind = configuration % kindCount
    const depth = Math.floor(configuration / kindCount) % (maximumDepth + 1)
    const grammarState = Math.floor(configuration / (kindCount * (maximumDepth + 1))) % grammarStateCount
    const lexerState = Math.floor(configuration / (kindCount * (maximumDepth + 1) * grammarStateCount))
    for (let characterClass = 0; characterClass < classes; characterClass++) {
      const lexerCellToday = lexerState * classCount + classToday[characterClass]!
      const event = today.lexerEvent[lexerCellToday]!
      const token = today.tokenOfEvent[event]!
      const context = today.depthClass[depth]! * 2 + Number(kind === containerObject)
      const grammarCell = (grammarState * tokenCount + token) * contextCount + context
      const grammarAfter = today.grammarNext[grammarCell]!
      // A step into the error state is a first error. It freezes nothing.
      if (grammarAfter === errorState) continue
      const lexerCell = lexerState * classes + characterClass
      if (lexerFrozen[lexerCell] === 0) {
        lexerFrozen[lexerCell] = 1
        lexerReadFrom[lexerCell] = configuration
      }
      if (grammarFrozen[grammarCell] === 0) {
        grammarFrozen[grammarCell] = 1
        grammarReadFrom[grammarCell] = configuration
        grammarReadByClass[grammarCell] = characterClass
      }
      // The class `end` stands for the cells after the text. The configuration it leads to, between tokens in the
      // grammar state `end` at depth 0, is also where the last closing bracket of a text leads, so the search does not
      // go on from it, and no text of a frozen cell has to go on after its end.
      if (characterClass === classEnd) continue
      const action = actionOfToken[token]!
      const depthAfter = depth + (action === actionPushObject || action === actionPushArray ? 1 : action === actionPop ? -1 : 0)
      if (depthAfter < 0 || depthAfter > maximumDepth) throw new Error('a step without an error left the depths 0 to 16')
      const lexerAfter = today.lexerNext[lexerCellToday]!
      if (action === actionPop && depthAfter > 0) {
        guesses.push([configuration, characterClass, configurationOf(lexerAfter, grammarAfter, depthAfter, containerObject)], [configuration, characterClass, configurationOf(lexerAfter, grammarAfter, depthAfter, containerArray)])
      } else {
        const kindAfter = action === actionPushObject ? containerObject : action === actionPushArray ? containerArray : action === actionPop ? containerNone : kind
        reach(configuration, characterClass, configurationOf(lexerAfter, grammarAfter, depthAfter, kindAfter))
      }
    }
    // Every step without a guess is used up: go on from the guessed configurations that are still not reached.
    if (head === queue.length - 1) {
      for (const [from, characterClass, to] of guesses.splice(0)) if (reach(from, characterClass, to)) reachedByGuessAlone++
    }
  }
  // The classes of a text that leads to a configuration, in order.
  const classesTo = (configuration: number) => {
    const classes: number[] = []
    for (let at = configuration; cameFrom[at] !== -1; at = cameFrom[at]!) classes.push(cameByClass[at]!)
    return classes.reverse()
  }
  return {
    lexerFrozen, grammarFrozen, reachedByGuessAlone,
    lexerWitness: (cell: number) => lexerFrozen[cell] === 0 ? undefined : [...classesTo(lexerReadFrom[cell]!), cell % classes],
    grammarWitness: (cell: number) => grammarFrozen[cell] === 0 ? undefined : [...classesTo(grammarReadFrom[cell]!), grammarReadByClass[cell]!],
  }
}

// The search's result for the classes of some tables, made once per list of classes. `lexerFrozen` and
// `grammarFrozen` hold 1 per frozen cell of today's states. `lexerWitness(cell)` and `grammarWitness(cell)` give, for
// a frozen cell, the classes of a text whose last class makes the parser read the cell, with no error up to and
// including that step, and `undefined` for an open cell. When the last class is `end`, the text ends before it.
// `reachedByGuessAlone` is how many configurations the search reached only by guessing the kind of a container.
const frozenSearches = new Map<string, ReturnType<typeof searchFrozenCells>>()
export function frozenSearchOf(tables: {classToday: Uint8Array}) {
  const key = tables.classToday.join(',')
  let search = frozenSearches.get(key)
  if (search === undefined) {
    search = searchFrozenCells(tables.classToday)
    frozenSearches.set(key, search)
  }
  return search
}

// The masks of open cells for tables with the given numbers of states and the classes of `classToday`: today's cells
// as the search found them, and every cell of an added state, since only an open cell can lead into an added state.
// Without `classToday`, the masks of tables with today's classes.
export function openMasks(lexerStates: number, grammarStates: number, classToday: Uint8Array = todaysClasses) {
  const search = frozenSearchOf({classToday})
  const lexerOpen = new Uint8Array(lexerStates * classToday.length).fill(1)
  for (let cell = 0; cell < search.lexerFrozen.length; cell++) lexerOpen[cell] = 1 - search.lexerFrozen[cell]!
  const grammarOpen = new Uint8Array(grammarStates * tokenCount * contextCount).fill(1)
  for (let cell = 0; cell < search.grammarFrozen.length; cell++) grammarOpen[cell] = 1 - search.grammarFrozen[cell]!
  return {lexerOpen, grammarOpen}
}

// The tables of today: every cell as the highlighter has it, and every stack action `by token`. Each call returns a
// new copy, so a caller may change its open cells in place.
export function asIsTables(): RecoveryTables {
  return {
    classCount, lexerStateCount, eventCount, tokenCount, contextCount, grammarStateCount, errorState,
    addedClasses: [], classToday: todaysClasses.slice(),
    classOfCodePoint: today.classOfCodePoint.slice(), tokenOfEvent: today.tokenOfEvent.slice(), display: today.display.slice(),
    lexerNext: today.lexerNext.slice(), lexerEvent: today.lexerEvent.slice(),
    grammarNext: today.grammarNext.slice(), grammarAction: new Uint8Array(today.grammarNext.length).fill(actionByToken),
    ...openMasks(lexerStateCount, grammarStateCount),
  }
}

export function copyTables(tables: RecoveryTables): RecoveryTables {
  return {
    ...tables,
    classToday: tables.classToday.slice(), classOfCodePoint: tables.classOfCodePoint.slice(), tokenOfEvent: tables.tokenOfEvent.slice(), display: tables.display.slice(),
    lexerNext: tables.lexerNext.slice(), lexerEvent: tables.lexerEvent.slice(), lexerOpen: tables.lexerOpen.slice(),
    grammarNext: tables.grammarNext.slice(), grammarAction: tables.grammarAction.slice(), grammarOpen: tables.grammarOpen.slice(),
  }
}

// A copy of `tables` with more classes. Each entry of `classes` takes its code points out of the class they have in
// `tables` and gives them a class of their own, which comes after the classes that are there. E.g. the apostrophe,
// which has the class `other`, the class of most letters:
//   addClasses(tables, [{name: 'apostrophe', codePoints: [0x27]}])
// For every tokenizer state, the cell of a new class starts as a copy of the cell of the class that its code points
// came from. So the copy reads every text as `tables` do, until a cell of a new class is changed. Which cells of a
// new class are open comes from the search for frozen cells, run with the new classes, see searchFrozenCells.
//
// The code points of one new class have to come from one class, and that class has to keep a code point.
export function addClasses(tables: RecoveryTables, classes: readonly AddedClass[]): RecoveryTables {
  const addedClasses = [...tables.addedClasses, ...classes.map(({name, codePoints}) => ({name, codePoints: [...codePoints]}))]
  const {classOfCodePoint, classToday, cameFrom} = classesWith(addedClasses)
  const classesAfter = classToday.length
  const lexerNext = new Uint8Array(tables.lexerStateCount * classesAfter)
  const lexerEvent = new Uint8Array(lexerNext.length)
  for (let state = 0; state < tables.lexerStateCount; state++) {
    for (let characterClass = 0; characterClass < classesAfter; characterClass++) {
      // An added class's cell is filled after the cell it copies, which has a lower class number.
      const to = state * classesAfter + characterClass
      if (characterClass < tables.classCount) {
        lexerNext[to] = tables.lexerNext[state * tables.classCount + characterClass]!
        lexerEvent[to] = tables.lexerEvent[state * tables.classCount + characterClass]!
      } else {
        const from = state * classesAfter + cameFrom[characterClass - classCount]!
        lexerNext[to] = lexerNext[from]!
        lexerEvent[to] = lexerEvent[from]!
      }
    }
  }
  return {
    ...copyTables(tables), classCount: classesAfter, addedClasses, classToday, classOfCodePoint, lexerNext, lexerEvent,
    lexerOpen: openMasks(tables.lexerStateCount, tables.grammarStateCount, classToday).lexerOpen,
  }
}

// A copy of `tables` with more states: `addedLexerStates` tokenizer states, and one grammar state per entry of
// `addedGrammarStatesShownAs`. An added state comes after the states that are there, and each of its cells is open.
// An added tokenizer state starts as a copy of the state errorLine, and an added grammar state as a copy of the state
// error. The display table needs a column per grammar state: an entry names the grammar state whose column the added
// state copies, e.g. the state colon, after which a string is shown as a key.
export function addStates(tables: RecoveryTables, addedLexerStates: number, addedGrammarStatesShownAs: readonly number[]): RecoveryTables {
  const lexerStates = tables.lexerStateCount + addedLexerStates
  const grammarStates = tables.grammarStateCount + addedGrammarStatesShownAs.length
  const symbolCount = tables.tokenCount * tables.contextCount
  const errorLine = lexerStateNames.indexOf('errorLine')
  const lexerNext = new Uint8Array(lexerStates * tables.classCount)
  const lexerEvent = new Uint8Array(lexerNext.length)
  for (let cell = 0; cell < lexerNext.length; cell++) {
    const from = cell < tables.lexerNext.length ? cell : errorLine * tables.classCount + cell % tables.classCount
    lexerNext[cell] = tables.lexerNext[from]!
    lexerEvent[cell] = tables.lexerEvent[from]!
  }
  const grammarNext = new Uint8Array(grammarStates * symbolCount)
  const grammarAction = new Uint8Array(grammarNext.length)
  for (let cell = 0; cell < grammarNext.length; cell++) {
    const from = cell < tables.grammarNext.length ? cell : tables.errorState * symbolCount + cell % symbolCount
    grammarNext[cell] = tables.grammarNext[from]!
    grammarAction[cell] = tables.grammarAction[from]!
  }
  const display = new Uint8Array(tables.eventCount * grammarStates)
  for (let event = 0; event < tables.eventCount; event++) {
    for (let state = 0; state < grammarStates; state++) {
      const from = state < tables.grammarStateCount ? state : addedGrammarStatesShownAs[state - tables.grammarStateCount]!
      display[event * grammarStates + state] = tables.display[event * tables.grammarStateCount + from]!
    }
  }
  return {
    ...tables, lexerStateCount: lexerStates, grammarStateCount: grammarStates,
    classToday: tables.classToday.slice(), classOfCodePoint: tables.classOfCodePoint.slice(), tokenOfEvent: tables.tokenOfEvent.slice(), display,
    lexerNext, lexerEvent, grammarNext, grammarAction, ...openMasks(lexerStates, grammarStates, tables.classToday),
  }
}

// Gives every open cell a random choice. check-parser.ts uses it to show that no choice of the open cells changes
// what a text gets before its first error.
export function randomizeOpenCells(tables: RecoveryTables, random: Random) {
  for (let cell = 0; cell < tables.lexerNext.length; cell++) {
    if (tables.lexerOpen[cell] === 0) continue
    tables.lexerNext[cell] = random.integer(0, tables.lexerStateCount - 1)
    tables.lexerEvent[cell] = random.integer(0, tables.eventCount - 1)
  }
  for (let cell = 0; cell < tables.grammarNext.length; cell++) {
    if (tables.grammarOpen[cell] === 0) continue
    tables.grammarNext[cell] = random.integer(0, tables.grammarStateCount - 1)
    tables.grammarAction[cell] = random.integer(0, actionCount - 1)
  }
}

const sameArray = (left: ArrayLike<number>, right: ArrayLike<number>) => {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false
  return true
}

// What breaks the experiment's ground rules in `tables`, as sentences. An empty list means that the fixed tables are
// today's, the class table is today's with the added classes, the masks are the ones of openMasks, every frozen cell
// holds what it holds today, and every open cell holds a state, an event and an action that exist.
export function problemsOf(tables: RecoveryTables): string[] {
  const problems: string[] = []
  const fixedSizes = [['classCount', tables.classCount, classCount + tables.addedClasses.length], ['eventCount', tables.eventCount, eventCount], ['tokenCount', tables.tokenCount, tokenCount], ['contextCount', tables.contextCount, contextCount], ['errorState', tables.errorState, errorState]] as const
  for (const [name, actual, expected] of fixedSizes) if (actual !== expected) problems.push(`${name} is ${actual}, and has to be ${expected}`)
  if (tables.lexerStateCount < lexerStateCount || tables.lexerStateCount > 255) problems.push(`lexerStateCount is ${tables.lexerStateCount}, and has to be from ${lexerStateCount} to 255`)
  if (tables.grammarStateCount < grammarStateCount || tables.grammarStateCount > 255) problems.push(`grammarStateCount is ${tables.grammarStateCount}, and has to be from ${grammarStateCount} to 255`)
  if (problems.length > 0) return problems
  let classes: ReturnType<typeof classesWith>
  try {
    classes = classesWith(tables.addedClasses)
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
  if (!sameArray(tables.classOfCodePoint, classes.classOfCodePoint)) problems.push('classOfCodePoint is not today\'s table with the added classes')
  if (!sameArray(tables.classToday, classes.classToday)) problems.push('classToday is not what the added classes give')
  if (problems.length > 0) return problems
  const lexerCells = tables.lexerStateCount * tables.classCount
  const grammarCells = tables.grammarStateCount * tokenCount * contextCount
  const lengths = [['lexerNext', tables.lexerNext.length, lexerCells], ['lexerEvent', tables.lexerEvent.length, lexerCells], ['lexerOpen', tables.lexerOpen.length, lexerCells], ['grammarNext', tables.grammarNext.length, grammarCells], ['grammarAction', tables.grammarAction.length, grammarCells], ['grammarOpen', tables.grammarOpen.length, grammarCells], ['display', tables.display.length, eventCount * tables.grammarStateCount]] as const
  for (const [name, actual, expected] of lengths) if (actual !== expected) problems.push(`${name} has ${actual} entries, and has to have ${expected}`)
  if (problems.length > 0) return problems
  if (!sameArray(tables.tokenOfEvent, today.tokenOfEvent)) problems.push('tokenOfEvent is not today\'s')
  const displayKindCount = 1 + Math.max(...today.display)
  for (let event = 0; event < eventCount; event++) {
    for (let state = 0; state < tables.grammarStateCount; state++) {
      const kind = tables.display[event * tables.grammarStateCount + state]!
      if (state < grammarStateCount ? kind !== today.display[event * grammarStateCount + state] : kind >= displayKindCount) problems.push(`display of (${eventNames[event]}, ${grammarStateName(state)}) is ${kind}`)
    }
  }
  const masks = openMasks(tables.lexerStateCount, tables.grammarStateCount, tables.classToday)
  if (!sameArray(tables.lexerOpen, masks.lexerOpen)) problems.push('lexerOpen is not the mask of openMasks')
  if (!sameArray(tables.grammarOpen, masks.grammarOpen)) problems.push('grammarOpen is not the mask of openMasks')
  for (let cell = 0; cell < lexerCells; cell++) {
    if (masks.lexerOpen[cell] === 0) {
      // A frozen cell of an added class holds what today's cell of the class of its code points holds.
      const cellToday = Math.floor(cell / tables.classCount) * classCount + tables.classToday[cell % tables.classCount]!
      if (tables.lexerNext[cell] !== today.lexerNext[cellToday] || tables.lexerEvent[cell] !== today.lexerEvent[cellToday]) problems.push(`the frozen tokenizer cell ${lexerCellName(tables, cell)} holds ${lexerChoiceName(tables, cell)}`)
    } else if (tables.lexerNext[cell]! >= tables.lexerStateCount || tables.lexerEvent[cell]! >= eventCount) {
      problems.push(`the tokenizer cell ${lexerCellName(tables, cell)} holds the state ${tables.lexerNext[cell]} and the event ${tables.lexerEvent[cell]}`)
    }
  }
  for (let cell = 0; cell < grammarCells; cell++) {
    if (masks.grammarOpen[cell] === 0) {
      if (tables.grammarNext[cell] !== today.grammarNext[cell] || tables.grammarAction[cell] !== actionByToken) problems.push(`the frozen grammar cell ${grammarCellName(tables, cell)} holds ${grammarChoiceName(tables, cell)}`)
    } else if (tables.grammarNext[cell]! >= tables.grammarStateCount || tables.grammarAction[cell]! >= actionCount) {
      problems.push(`the grammar cell ${grammarCellName(tables, cell)} holds the state ${tables.grammarNext[cell]} and the action ${tables.grammarAction[cell]}`)
    }
  }
  return problems
}

// Throws when `tables` break the ground rules, with the first problems.
export function checkTables(tables: RecoveryTables) {
  const problems = problemsOf(tables)
  if (problems.length > 0) throw new Error(`these tables break the ground rules (${problems.length} problems): ${problems.slice(0, 6).join('; ')}`)
}

// The index of a cell from the indexes of its row and columns, e.g. lexerCellOf(tables, lexerStateNames.indexOf('between'),
// classNames.indexOf('slash')), and grammarCellOf with a grammar state, a token and a context.
export const lexerCellOf = (tables: RecoveryTables, lexerState: number, characterClass: number) => lexerState * tables.classCount + characterClass
export const grammarCellOf = (tables: RecoveryTables, grammarState: number, token: number, context: number) => (grammarState * tables.tokenCount + token) * tables.contextCount + context

// Names. A state that was added has no name of its own, e.g. "state 26". An added class has the name it was given.
export const lexerStateName = (state: number) => lexerStateNames[state] ?? `state ${state}`
export const grammarStateName = (state: number) => grammarStateNames[state] ?? `state ${state}`
export const className = (tables: RecoveryTables, characterClass: number) => classNames[characterClass] ?? tables.addedClasses[characterClass - classCount]?.name ?? `class ${characterClass}`
// The name of a tokenizer cell, e.g. "(between, quote)", or "(between, apostrophe)" for a cell of an added class.
export function lexerCellName(tables: RecoveryTables, cell: number) {
  return `(${lexerStateName(Math.floor(cell / tables.classCount))}, ${className(tables, cell % tables.classCount)})`
}
// The name of a grammar cell, e.g. "(commaOrClose, string, depth 1, object)".
export function grammarCellName(tables: RecoveryTables, cell: number) {
  const state = Math.floor(cell / (tables.tokenCount * tables.contextCount))
  const token = Math.floor(cell / tables.contextCount) % tables.tokenCount
  return `(${grammarStateName(state)}, ${tokenNames[token]}, ${contextNames[cell % tables.contextCount]})`
}
// What a cell holds, e.g. "string, stringStart" for a tokenizer cell and "commaOrClose, by token" for a grammar cell.
export const lexerChoiceName = (tables: RecoveryTables, cell: number) => `${lexerStateName(tables.lexerNext[cell]!)}, ${eventNames[tables.lexerEvent[cell]!] ?? `event ${tables.lexerEvent[cell]}`}`
export const grammarChoiceName = (tables: RecoveryTables, cell: number) => `${grammarStateName(tables.grammarNext[cell]!)}, ${actionNames[tables.grammarAction[cell]!] ?? `action ${tables.grammarAction[cell]}`}`

export type CellDifference = {
  table: 'tokenizer' | 'grammar'
  cell: number
  // The cell's name, e.g. "(value, comma, depth 1, array)".
  name: string
  // Whether the cell is open. A difference in a frozen cell breaks the ground rules.
  open: boolean
  // What the cell holds in the first tables and in the second, e.g. "error, by token" and "value, none". "no such
  // state" where the tables have fewer states.
  before: string
  after: string
}

// `tables` with the classes of `like`, which may have added classes that `tables` do not have, e.g. today's tables
// next to tables with a class for the apostrophe. The cells of a missing class are copies, see addClasses.
function withClassesOf(tables: RecoveryTables, like: RecoveryTables): RecoveryTables {
  const sameClass = (left: AddedClass | undefined, right: AddedClass) => left !== undefined && left.name === right.name && sameArray(left.codePoints, right.codePoints)
  const shared = tables.addedClasses.length
  if (shared > like.addedClasses.length || !tables.addedClasses.every((added, index) => sameClass(like.addedClasses[index], added))) {
    throw new Error('two tables can only be compared when the added classes of the first are the first added classes of the second')
  }
  return shared === like.addedClasses.length ? tables : addClasses(tables, like.addedClasses.slice(shared))
}

// The cells in which two tables differ, tokenizer cells first. When the second tables have added classes that the
// first do not have, the first are compared as addClasses makes them: a cell of an added class with the cell of the
// class that its code points came from. So differencesOf(asIsTables(), tables) lists the cells of `tables` that do
// something else than today's parser.
export function differencesOf(beforeAsGiven: RecoveryTables, after: RecoveryTables): CellDifference[] {
  const before = withClassesOf(beforeAsGiven, after)
  const differences: CellDifference[] = []
  const wider = (left: RecoveryTables, right: RecoveryTables, cells: (tables: RecoveryTables) => Uint8Array) => cells(left).length >= cells(right).length ? left : right
  const lexerTables = wider(before, after, tables => tables.lexerNext)
  for (let cell = 0; cell < lexerTables.lexerNext.length; cell++) {
    const choices = [before, after].map(tables => cell < tables.lexerNext.length ? lexerChoiceName(tables, cell) : 'no such state')
    if (choices[0] !== choices[1]) differences.push({table: 'tokenizer', cell, name: lexerCellName(lexerTables, cell), open: lexerTables.lexerOpen[cell] === 1, before: choices[0]!, after: choices[1]!})
  }
  const grammarTables = wider(before, after, tables => tables.grammarNext)
  for (let cell = 0; cell < grammarTables.grammarNext.length; cell++) {
    const choices = [before, after].map(tables => cell < tables.grammarNext.length ? grammarChoiceName(tables, cell) : 'no such state')
    if (choices[0] !== choices[1]) differences.push({table: 'grammar', cell, name: grammarCellName(grammarTables, cell), open: grammarTables.grammarOpen[cell] === 1, before: choices[0]!, after: choices[1]!})
  }
  return differences
}

// The differences as aligned lines, e.g. "grammar    (value, comma, depth 1, array)   error, by token  ->  value, none".
export function describeDifferences(differences: readonly CellDifference[]): string {
  const nameWidth = Math.max(0, ...differences.map(difference => difference.name.length))
  const beforeWidth = Math.max(0, ...differences.map(difference => difference.before.length))
  return differences.map(difference =>
    `${difference.table.padEnd(9)}  ${difference.name.padEnd(nameWidth)}  ${difference.before.padEnd(beforeWidth)}  ->  ${difference.after}${difference.open ? '' : '  (a frozen cell)'}`).join('\n')
}

// How many cells of each table are frozen and open.
export function cellCounts(tables: RecoveryTables) {
  const ones = (mask: Uint8Array) => mask.reduce((total, bit) => total + bit, 0)
  const lexerOpen = ones(tables.lexerOpen)
  const grammarOpen = ones(tables.grammarOpen)
  return {lexerCells: tables.lexerOpen.length, lexerOpen, lexerFrozen: tables.lexerOpen.length - lexerOpen, grammarCells: tables.grammarOpen.length, grammarOpen, grammarFrozen: tables.grammarOpen.length - grammarOpen}
}

const arrayFields = ['classOfCodePoint', 'tokenOfEvent', 'display', 'lexerNext', 'lexerEvent', 'lexerOpen', 'grammarNext', 'grammarAction', 'grammarOpen'] as const
const sizeFields = ['classCount', 'lexerStateCount', 'eventCount', 'tokenCount', 'contextCount', 'grammarStateCount', 'errorState'] as const

// Tables as JSON text, one line per field, with a note that says where the tables come from, e.g. "hand-written
// recovery, 14 cells". tablesFromJson reads the text back and throws when the tables break the ground rules.
export function tablesToJson(tables: RecoveryTables, note = ''): string {
  checkTables(tables)
  const lines = [`"format": "recovery tables 1"`, `"note": ${JSON.stringify(note)}`, ...sizeFields.map(field => `"${field}": ${tables[field]}`), ...arrayFields.map(field => `"${field}": [${Array.from(tables[field]).join(',')}]`)]
  // What was added is only written when something was, so tables without it give the file that they always gave.
  if (tables.addedClasses.length > 0) lines.push(`"addedClasses": ${JSON.stringify(tables.addedClasses)}`)
  return `{\n${lines.map(line => `  ${line}`).join(',\n')}\n}\n`
}

export function tablesFromJson(text: string): {tables: RecoveryTables, note: string} {
  const parsed = JSON.parse(text) as Record<string, unknown>
  if (parsed['format'] !== 'recovery tables 1') throw new Error(`not a file of recovery tables: its format is ${JSON.stringify(parsed['format'])}`)
  const size = (field: string) => {
    const value = parsed[field]
    if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`the field ${field} is missing, or is no whole number`)
    return value
  }
  // The arrays are bytes. A number that is no whole number from 0 to 255 is refused, since a byte array would keep
  // only its low 8 bits without a word, e.g. the state 259 as the state 3.
  const array = (field: string) => {
    const value: unknown = parsed[field]
    if (!Array.isArray(value)) throw new Error(`the field ${field} is missing`)
    const numbers = value as unknown[]
    const bad = numbers.findIndex(entry => typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0 || entry > 255)
    if (bad !== -1) throw new Error(`the field ${field} holds ${JSON.stringify(numbers[bad])} at entry ${bad}, and every entry has to be a whole number from 0 to 255`)
    return Uint8Array.from(numbers as number[])
  }
  // The added classes, when the file has them. classesWith throws when the list cannot be, and checkTables compares
  // the file's class table with the one that the list gives.
  const addedClasses: AddedClass[] = []
  const listed: unknown = parsed['addedClasses'] ?? []
  if (!Array.isArray(listed)) throw new Error('the field addedClasses is no list')
  for (const entry of listed as unknown[]) {
    const {name, codePoints} = (entry ?? {}) as {name?: unknown, codePoints?: unknown}
    if (typeof name !== 'string' || !Array.isArray(codePoints) || !(codePoints as unknown[]).every(codePoint => typeof codePoint === 'number')) throw new Error(`the field addedClasses holds ${JSON.stringify(entry)}, and every entry has to be a name and code points`)
    addedClasses.push({name, codePoints: codePoints as number[]})
  }
  const tables: RecoveryTables = {
    classCount: size('classCount'), lexerStateCount: size('lexerStateCount'), eventCount: size('eventCount'), tokenCount: size('tokenCount'),
    contextCount: size('contextCount'), grammarStateCount: size('grammarStateCount'), errorState: size('errorState'),
    addedClasses, classToday: classesWith(addedClasses).classToday, classOfCodePoint: array('classOfCodePoint'), tokenOfEvent: array('tokenOfEvent'), display: array('display'),
    lexerNext: array('lexerNext'), lexerEvent: array('lexerEvent'), lexerOpen: array('lexerOpen'),
    grammarNext: array('grammarNext'), grammarAction: array('grammarAction'), grammarOpen: array('grammarOpen'),
  }
  checkTables(tables)
  return {tables, note: typeof parsed['note'] === 'string' ? parsed['note'] : ''}
}

export const saveTables = (path: string, tables: RecoveryTables, note = '') => writeFileSync(path, tablesToJson(tables, note))
export const loadTables = (path: string) => tablesFromJson(readFileSync(path, 'utf8'))

export {classNames, contextNames, eventNames, grammarStateNames, lexerStateNames, tokenNames}
