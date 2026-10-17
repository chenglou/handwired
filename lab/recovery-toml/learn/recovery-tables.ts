// The tables that the recovery experiment runs and changes, for TOML: the tokenizer table, the grammar table and the
// display table of ../tables.ts, a stack action per grammar cell, and which cells may change. It is
// lab/recovery-parser/learn/recovery-tables.ts for the TOML tables, with the same exports.
//
// A cell is one entry of the tokenizer's table, (tokenizer state, class), or of the grammar's table, (grammar state,
// token, context). A frozen cell is one that some text makes the parser read before that text's first error, e.g.
// (between, quote), which every string of a valid text reads. Every other cell is open: the parser reads it only at or
// after a first error, e.g. (between, colon), which the colon of `a : 1` reads. Only open cells may change. Then
// every text gets the same trace as today up to its first error, and valid TOML is parsed exactly as today.
//
// Tables can have more than today's: more states (addStates), more classes (addClasses), entries of the display
// table that are open like cells (openDisplayEntries), and a bit that tells the grammar whether a token is the first
// on its line (addFirstOnLineBit).
//
// What differs from the JSON file:
// - Today's TOML tables name a stack action in every grammar cell, e.g. `none` for the `[` of a header, where the JSON
//   tables hold `by token` everywhere. So today's actions are part of today's tables: a frozen cell has to hold
//   today's action, and an open cell starts with it. `by token` is still a choice of an open cell.
// - The search for the frozen cells keeps two kinds of the stack, see searchFrozenCells.
//
// The code keeps the names of ../table-parser.ts, where the tokenizer is the "lexer".
import {readFileSync, writeFileSync} from 'node:fs'
import {displayKind} from '../kinds.ts'
import {
  actionByToken, actionNames, actionNone, actionPop, actionPushArray, actionPushInlineTable, classNames, containerArray, containerInlineTable, containerNone, contextNames, defaultTables,
  eventNames, grammarStateNames, lexerStateNames, maximumDepth, tokenNames,
} from '../table-parser.ts'
import {datasetKey} from './dataset-key.ts'
import type {Random} from './random.ts'

// What a grammar cell does to the stack of open containers: by token, none, push an array, push an inline table, pop.
// `by token` does what ../tables.ts says for the cell's token: an opening bracket or brace pushes its kind, a closing
// one pops, and any other token does nothing.
export const actionCount = actionNames.length

// A class that addClasses gave to some code points, e.g. {name: 'semicolon', codePoints: [0x3b]}.
export type AddedClass = {name: string, codePoints: readonly number[]}

export type RecoveryTables = {
  // Sizes. Today there are 47 classes, 111 tokenizer states, 42 events, 23 tokens, 8 contexts and 16 grammar states.
  // Tables may have more tokenizer states and more grammar states, see addStates, more classes, see addClasses, and
  // 16 contexts, see addFirstOnLineBit. The other sizes are fixed.
  classCount: number
  lexerStateCount: number
  eventCount: number
  tokenCount: number
  contextCount: number
  grammarStateCount: number
  // The grammar state `error`.
  errorState: number
  // The classes that addClasses added, in the order of their numbers: the first one is class 47. Never changed in
  // place, so copies of tables share the list.
  addedClasses: readonly AddedClass[]
  // classToday[class]: the class of today's 47 that the code points of a class have in ../tables.ts, e.g. `other`
  // for an added class of the semicolon. A class of today's is its own.
  classToday: Uint8Array
  // classOfCodePoint[code point + 1], where entry 0 is the class `end` and a code point past the table reads the last
  // entry, which is `other`. It is today's table with the code points of the added classes changed, and longer when
  // an added class has a code point from U+0080 up.
  classOfCodePoint: Uint8Array
  // A fixed table: tokenOfEvent[event].
  tokenOfEvent: Uint8Array
  // The display table, [event × grammarStateCount + grammar state after]: the display kind, and 1 where the entry is
  // open. No entry is open unless openDisplayEntries made the tables. Then an open entry holds any display kind but
  // `pastEnd`, the kind of the cells after a text's end.
  display: Uint8Array
  displayOpen: Uint8Array
  // The tokenizer's cells, [tokenizer state × classCount + class]: the next tokenizer state, the event, and 1 where
  // the cell is open.
  lexerNext: Uint8Array
  lexerEvent: Uint8Array
  lexerOpen: Uint8Array
  // The grammar's cells, [(grammar state × tokenCount + token) × contextCount + context]: the next grammar state, the
  // stack action, and 1 where the cell is open. A context is depth class × 2 + [the innermost open container is an
  // inline table], and with 16 contexts, 8 more when the token is the first on its line.
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
  grammarAction: Uint8Array.from(defaultTables.grammarAction),
  // The kind of a first error is lexerErrorKind[event] + grammarError[grammar cell].
  lexerErrorKind: Uint8Array.from(defaultTables.lexerErrorKind),
  grammarError: Uint8Array.from(defaultTables.grammarError),
  // depthClass[depth] for the depths 0 to 16: 0, 1, 2 for the depths 2 to 15, and 3.
  depthClass: Uint8Array.from(defaultTables.depthClass),
}

// What `by token` does for each token.
export const actionOfToken = Uint8Array.from(defaultTables.actionOfToken)

// The display kinds, e.g. `key`, in the order of their numbers.
export const displayKindNames = Object.keys(displayKind)
export const displayKindCount = displayKindNames.length
// 1 for the three events of a text's end, whose row of the display table holds `pastEnd` in every column.
const isEndEvent = Uint8Array.from({length: eventCount}, (_, event) => Number(today.display[event * grammarStateCount] === displayKind.pastEnd))

function checkToday() {
  if (lexerStateCount !== lexerStateNames.length || tokenCount !== tokenNames.length || today.depthClass.length !== maximumDepth + 1) throw new Error('recovery-tables.ts no longer fits the sizes of table-parser.ts')
  if (displayKindNames.some((name, kind) => displayKind[name as keyof typeof displayKind] !== kind) || today.display.some(kind => kind >= displayKindCount)) throw new Error('recovery-tables.ts no longer fits the display kinds of kinds.ts')
  // A row of the display table holds `pastEnd` in every column or in none.
  for (let entry = 0; entry < today.display.length; entry++) {
    if ((today.display[entry] === displayKind.pastEnd) !== (isEndEvent[Math.floor(entry / grammarStateCount)] === 1)) throw new Error('an event is shown as past the end after some grammar states only')
  }
  // `by token` only does one of the four other actions, and so does every cell of today's tables.
  if (actionOfToken.some(action => action === actionByToken || action >= actionCount) || today.grammarAction.some(action => action >= actionCount)) throw new Error('a stack action of table-parser.ts is none of the five of recovery-tables.ts')
  // The twin and the search read the two classes of a text's end by their numbers, 0 and 1, as table-parser.ts does.
  if (classNames.indexOf('end') !== 0 || classNames.indexOf('truncatedEnd') !== 1) throw new Error('the classes end and truncatedEnd are no longer the classes 0 and 1')
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
    if (codePoints.length === 0 || new Set(codePoints).size !== codePoints.length) throw new Error(`the added class ${name} has no code point, or one twice`)
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
      if (classOfCodePoint[codePoint + 1] !== from) throw new Error(`the code points of the added class ${name} do not all have one class before it is added: U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`)
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
// is the tokenizer state, the grammar state, the depth, the kind of the innermost open container and the kind of the
// container around it.
//
// The search runs in two forms, as in ../check-cells.ts, and the masks are right when both find the same cells:
// - The exact form keeps the real stack, for the stacks whose containers are all arrays but the innermost two. With
//   such stacks a step never has to guess a kind, so every cell that it finds is read by a real text, which
//   check-tables.ts runs for every frozen cell. It can only miss cells.
// - The guessing form keeps the depth and the innermost kind alone, as the JSON search does. After a closing bracket
//   at depth 2 or more, where the container that becomes the innermost can be of either kind, it takes both kinds as
//   reached. A configuration that no text reaches can only freeze more cells, never fewer.
// frozenSearchOf runs both and throws when they find other cells. The JSON search is the guessing form alone, and
// reaches no configuration by a guess alone. With the TOML tables the guessing form reaches 30 so, e.g. the tokenizer
// state `afterCloseBracket` inside a container, which only a closing bracket leads to. So its texts can be wrong, and
// the texts come from the exact form.
//
// With added classes the search runs over the classes of `classToday`, one entry per class: a step with an added
// class is today's step with the class that its code points have today, and it freezes the cell of the added class.
// E.g. a semicolon inside a string is read by valid TOML, so the cell (basic, semicolon) is frozen, and a semicolon
// between tokens is an error today, so the cell (between, semicolon) is open.
//
// A step without an error also reads an entry of the display table, (event, grammar state after), so the search
// finds the frozen entries of that table too. E.g. (literalStart, afterValue) is what the t of `a = true` reads, and
// no step without an error reads (commentStart, afterKey), since no comment may follow a key.
//
// With `firstOnLine`, the grammar's cells have 16 contexts, and a configuration also holds the bit "the next token is
// the first on its line", which a line feed sets and the first token after it clears. E.g. the cell (lineStart,
// keyOnly, depth 0) with the bit is read by every key that starts a line after the first, so it is frozen. The cell
// (afterKey, equals, depth 0) with the bit is open: a key and its equals sign stand on one line.
//
// The positions after a text read the class `end`, up to position 512. A text that is valid up to its end can go
// through several states there, e.g. the tokenizer state after the last code point and then `between`. The search
// follows these steps for every configuration in which a text may end, and goes on from none of them.
const kindCount = 3
const classEnd = classNames.indexOf('end')
const classLineFeed = classNames.indexOf('lineFeed')
const tokenNone = tokenNames.indexOf('none')
function searchFrozenCells(classToday: Uint8Array, firstOnLine: boolean, exact: boolean) {
  const classes = classToday.length
  const contexts = firstOnLine ? 2 * contextCount : contextCount
  const bitCount = firstOnLine ? 2 : 1
  const configurationOf = (lexerState: number, grammarState: number, depth: number, kind: number, kindAround: number, bit: number) =>
    ((((lexerState * grammarStateCount + grammarState) * (maximumDepth + 1) + depth) * kindCount + kind) * kindCount + kindAround) * bitCount + bit
  // For every configuration the search reached: the configuration it came from and the class that led to it. -2
  // where the search did not reach, -1 at the start.
  const cameFrom = new Int32Array(lexerStateCount * grammarStateCount * (maximumDepth + 1) * kindCount * kindCount * bitCount).fill(-2)
  const cameByClass = new Uint8Array(cameFrom.length)
  const lexerFrozen = new Uint8Array(lexerStateCount * classes)
  const grammarFrozen = new Uint8Array(grammarStateCount * tokenCount * contexts)
  const displayFrozen = new Uint8Array(eventCount * grammarStateCount)
  // For every frozen cell: a configuration from which a class reads the cell without an error, that class, and how
  // many positions after the text's end come before the one that reads the cell.
  const lexerReadFrom = new Int32Array(lexerFrozen.length).fill(-1)
  const lexerReadAfterEnd = new Uint8Array(lexerFrozen.length)
  const grammarReadFrom = new Int32Array(grammarFrozen.length).fill(-1)
  const grammarReadByClass = new Uint8Array(grammarFrozen.length)
  const grammarReadAfterEnd = new Uint8Array(grammarFrozen.length)
  const displayReadFrom = new Int32Array(displayFrozen.length).fill(-1)
  const displayReadByClass = new Uint8Array(displayFrozen.length)
  const displayReadAfterEnd = new Uint8Array(displayFrozen.length)
  const queue = [configurationOf(0, 0, 0, containerNone, containerNone, 0)]
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
  // Marks what one step without an error reads. `positionsAfterEnd` is 0 for a step of a code point and for the first
  // position after a text.
  const freeze = (lexerCell: number, grammarCell: number, displayEntry: number, configuration: number, characterClass: number, positionsAfterEnd: number) => {
    if (lexerFrozen[lexerCell] === 0) {
      lexerFrozen[lexerCell] = 1
      lexerReadFrom[lexerCell] = configuration
      lexerReadAfterEnd[lexerCell] = positionsAfterEnd
    }
    if (grammarFrozen[grammarCell] === 0) {
      grammarFrozen[grammarCell] = 1
      grammarReadFrom[grammarCell] = configuration
      grammarReadByClass[grammarCell] = characterClass
      grammarReadAfterEnd[grammarCell] = positionsAfterEnd
    }
    if (displayFrozen[displayEntry] === 0) {
      displayFrozen[displayEntry] = 1
      displayReadFrom[displayEntry] = configuration
      displayReadByClass[displayEntry] = characterClass
      displayReadAfterEnd[displayEntry] = positionsAfterEnd
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const configuration = queue[head]!
    const bit = configuration % bitCount
    const withoutBit = Math.floor(configuration / bitCount)
    const kindAround = withoutBit % kindCount
    const kind = Math.floor(withoutBit / kindCount) % kindCount
    const depth = Math.floor(withoutBit / (kindCount * kindCount)) % (maximumDepth + 1)
    const grammarState = Math.floor(withoutBit / (kindCount * kindCount * (maximumDepth + 1))) % grammarStateCount
    const lexerState = Math.floor(withoutBit / (kindCount * kindCount * (maximumDepth + 1) * grammarStateCount))
    const contextToday = today.depthClass[depth]! * 2 + Number(kind === containerInlineTable)
    for (let characterClass = 0; characterClass < classes; characterClass++) {
      const lexerCellToday = lexerState * classCount + classToday[characterClass]!
      const event = today.lexerEvent[lexerCellToday]!
      const token = today.tokenOfEvent[event]!
      const grammarCellToday = (grammarState * tokenCount + token) * contextCount + contextToday
      const grammarAfter = today.grammarNext[grammarCellToday]!
      // A step into the error state is a first error. It freezes nothing.
      if (grammarAfter === errorState) continue
      freeze(lexerState * classes + characterClass, (grammarState * tokenCount + token) * contexts + contextToday + bit * contextCount, event * grammarStateCount + grammarAfter, configuration, characterClass, 0)
      const lexerAfter = today.lexerNext[lexerCellToday]!
      let action = today.grammarAction[grammarCellToday]!
      if (action === actionByToken) action = actionOfToken[token]!
      // A line feed sets the bit, and any other code point with a token clears it.
      const bitAfter = !firstOnLine ? 0 : characterClass === classLineFeed ? 1 : token === tokenNone ? bit : 0
      if (characterClass === classEnd) {
        // The class `end` stands for the positions after the text. The text is over, so the search goes on from
        // here with the class `end` alone, up to an error or a state that it had before.
        if (action !== actionNone) throw new Error('the end of a text changes the stack')
        const seen = new Set<number>()
        let lexerStateAfterEnd = lexerAfter
        let grammarStateAfterEnd = grammarAfter
        let bitAfterEnd = bitAfter
        for (let positionsAfterEnd = 1; positionsAfterEnd < 255; positionsAfterEnd++) {
          const state = (lexerStateAfterEnd * grammarStateCount + grammarStateAfterEnd) * 2 + bitAfterEnd
          if (seen.has(state)) break
          seen.add(state)
          const lexerCellAfterEnd = lexerStateAfterEnd * classCount + classEnd
          const eventAfterEnd = today.lexerEvent[lexerCellAfterEnd]!
          const tokenAfterEnd = today.tokenOfEvent[eventAfterEnd]!
          const grammarCellAfterEnd = (grammarStateAfterEnd * tokenCount + tokenAfterEnd) * contextCount + contextToday
          const grammarNextAfterEnd = today.grammarNext[grammarCellAfterEnd]!
          if (grammarNextAfterEnd === errorState) break
          if (today.grammarAction[grammarCellAfterEnd] !== actionNone && !(today.grammarAction[grammarCellAfterEnd] === actionByToken && actionOfToken[tokenAfterEnd] === actionNone)) throw new Error('the end of a text changes the stack')
          freeze(lexerStateAfterEnd * classes + classEnd, (grammarStateAfterEnd * tokenCount + tokenAfterEnd) * contexts + contextToday + bitAfterEnd * contextCount, eventAfterEnd * grammarStateCount + grammarNextAfterEnd, configuration, classEnd, positionsAfterEnd)
          lexerStateAfterEnd = today.lexerNext[lexerCellAfterEnd]!
          grammarStateAfterEnd = grammarNextAfterEnd
          if (tokenAfterEnd !== tokenNone) bitAfterEnd = 0
        }
        continue
      }
      if (action === actionPushArray || action === actionPushInlineTable) {
        if (depth === maximumDepth) throw new Error('a step without an error opened a container at depth 16')
        // The exact form stays with the stacks whose containers are arrays up to the one around the innermost.
        if (exact && depth >= 2 && kindAround !== containerArray) continue
        const pushed = action === actionPushArray ? containerArray : containerInlineTable
        reach(configuration, characterClass, configurationOf(lexerAfter, grammarAfter, depth + 1, pushed, exact ? kind : containerNone, bitAfter))
      } else if (action === actionPop) {
        if (depth === 0) throw new Error('a step without an error closed a container at depth 0')
        const depthAfter = depth - 1
        if (exact) {
          reach(configuration, characterClass, configurationOf(lexerAfter, grammarAfter, depthAfter, depthAfter === 0 ? containerNone : kindAround, depthAfter >= 2 ? containerArray : containerNone, bitAfter))
        } else if (depthAfter === 0) {
          reach(configuration, characterClass, configurationOf(lexerAfter, grammarAfter, 0, containerNone, containerNone, bitAfter))
        } else {
          for (const guessed of [containerInlineTable, containerArray]) guesses.push([configuration, characterClass, configurationOf(lexerAfter, grammarAfter, depthAfter, guessed, containerNone, bitAfter)])
        }
      } else {
        reach(configuration, characterClass, configurationOf(lexerAfter, grammarAfter, depth, kind, kindAround, bitAfter))
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
  const ends = (count: number) => Array.from({length: count}, () => classEnd)
  return {
    lexerFrozen, grammarFrozen, displayFrozen, reachedByGuessAlone,
    lexerWitness: (cell: number) => lexerFrozen[cell] === 0 ? undefined : [...classesTo(lexerReadFrom[cell]!), ...ends(lexerReadAfterEnd[cell]!), cell % classes],
    grammarWitness: (cell: number) => grammarFrozen[cell] === 0 ? undefined : [...classesTo(grammarReadFrom[cell]!), ...ends(grammarReadAfterEnd[cell]!), grammarReadByClass[cell]!],
    displayWitness: (entry: number) => displayFrozen[entry] === 0 ? undefined : [...classesTo(displayReadFrom[entry]!), ...ends(displayReadAfterEnd[entry]!), displayReadByClass[entry]!],
  }
}

const sameArray = (left: ArrayLike<number>, right: ArrayLike<number>) => {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false
  return true
}

// The search's result for the classes and the contexts of some tables, made once per list of classes, with the bit
// and without. `lexerFrozen`, `grammarFrozen` and `displayFrozen` hold 1 per frozen cell or entry of today's states.
// `lexerWitness(cell)`, `grammarWitness(cell)` and `displayWitness(entry)` give, for a frozen one, the classes of a
// text whose last class makes the parser read it, with no error up to and including that step, and `undefined` for
// one that the search did not find. Classes `end` at the end of the list are positions after the text: the text ends
// before the first of them. `reachedByGuessAlone` is how many configurations the guessing form reached only by
// guessing the kind of a container.
//
// Both forms of the search run, and the result is the exact form's. When the two find other cells the function
// throws: the masks would then not be known to be right, e.g. for a list of added classes that nothing tried before.
const frozenSearches = new Map<string, ReturnType<typeof searchFrozenCells>>()
export function frozenSearchOf(tables: {classToday: Uint8Array, contextCount: number}) {
  const key = `${tables.classToday.join(',')} ${tables.contextCount}`
  let search = frozenSearches.get(key)
  if (search === undefined) {
    const exactSearch = searchFrozenCells(tables.classToday, tables.contextCount > contextCount, true)
    const guessingSearch = searchFrozenCells(tables.classToday, tables.contextCount > contextCount, false)
    if (!sameArray(exactSearch.lexerFrozen, guessingSearch.lexerFrozen) || !sameArray(exactSearch.grammarFrozen, guessingSearch.grammarFrozen) || !sameArray(exactSearch.displayFrozen, guessingSearch.displayFrozen)) {
      throw new Error('the two forms of the search for frozen cells find other cells, so the masks of open cells are not known to be right for these classes and contexts')
    }
    search = {...exactSearch, reachedByGuessAlone: guessingSearch.reachedByGuessAlone}
    frozenSearches.set(key, search)
  }
  return search
}

// What tables can have besides today's classes, today's 8 contexts and today's fixed display table, as far as the
// masks of open cells depend on it: the class of today's for every class, the number of contexts, and whether the
// display table has open entries.
type AddedStructure = {classToday: Uint8Array, contextCount: number, openDisplay: boolean}
const structureOf = (tables: RecoveryTables): AddedStructure => ({classToday: tables.classToday, contextCount: tables.contextCount, openDisplay: tables.displayOpen.includes(1)})

// The masks of open cells for tables with the given numbers of states: today's cells as the search found them, and
// every cell of an added state, since only an open cell can lead into an added state. Without `added`, the masks of
// tables with today's classes, today's contexts and no open entry of the display table.
//
// With `added.openDisplay`, an entry of the display table is open when the search did not find it, and so is every
// entry of an added grammar state. The rows of the three events of a text's end stay as they are, in every column:
// they are what the cells after a text read, and `pastEnd` is no choice of an open entry.
export function openMasks(lexerStates: number, grammarStates: number, added: AddedStructure = {classToday: todaysClasses, contextCount, openDisplay: false}) {
  const search = frozenSearchOf(added)
  const lexerOpen = new Uint8Array(lexerStates * added.classToday.length).fill(1)
  for (let cell = 0; cell < search.lexerFrozen.length; cell++) lexerOpen[cell] = 1 - search.lexerFrozen[cell]!
  const grammarOpen = new Uint8Array(grammarStates * tokenCount * added.contextCount).fill(1)
  for (let cell = 0; cell < search.grammarFrozen.length; cell++) grammarOpen[cell] = 1 - search.grammarFrozen[cell]!
  const displayOpen = new Uint8Array(eventCount * grammarStates)
  if (added.openDisplay) {
    for (let event = 0; event < eventCount; event++) {
      if (isEndEvent[event] === 1) continue
      for (let state = 0; state < grammarStates; state++) displayOpen[event * grammarStates + state] = state < grammarStateCount ? 1 - search.displayFrozen[event * grammarStateCount + state]! : 1
    }
  }
  return {lexerOpen, grammarOpen, displayOpen}
}

// The tables of today: every cell as ../tables.ts has it, with its stack action. Each call returns a new copy, so a
// caller may change its open cells in place.
export function asIsTables(): RecoveryTables {
  return {
    classCount, lexerStateCount, eventCount, tokenCount, contextCount, grammarStateCount, errorState,
    addedClasses: [], classToday: todaysClasses.slice(),
    classOfCodePoint: today.classOfCodePoint.slice(), tokenOfEvent: today.tokenOfEvent.slice(), display: today.display.slice(),
    lexerNext: today.lexerNext.slice(), lexerEvent: today.lexerEvent.slice(),
    grammarNext: today.grammarNext.slice(), grammarAction: today.grammarAction.slice(),
    ...openMasks(lexerStateCount, grammarStateCount),
  }
}

export function copyTables(tables: RecoveryTables): RecoveryTables {
  return {
    ...tables,
    classToday: tables.classToday.slice(), classOfCodePoint: tables.classOfCodePoint.slice(), tokenOfEvent: tables.tokenOfEvent.slice(),
    display: tables.display.slice(), displayOpen: tables.displayOpen.slice(),
    lexerNext: tables.lexerNext.slice(), lexerEvent: tables.lexerEvent.slice(), lexerOpen: tables.lexerOpen.slice(),
    grammarNext: tables.grammarNext.slice(), grammarAction: tables.grammarAction.slice(), grammarOpen: tables.grammarOpen.slice(),
  }
}

// A copy of `tables` with more classes. Each entry of `classes` takes its code points out of the class they have in
// `tables` and gives them a class of their own, which comes after the classes that are there. E.g. the semicolon,
// which has the class `other`, the class of every code point that only strings and comments hold:
//   addClasses(tables, [{name: 'semicolon', codePoints: [0x3b]}])
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
    lexerOpen: openMasks(tables.lexerStateCount, tables.grammarStateCount, {...structureOf(tables), classToday}).lexerOpen,
  }
}

// A copy of `tables` in which the grammar also reads the bit "the token is the first on its line". A line feed sets
// the bit, and the first code point after it whose token is not `none` clears it. Every code point after the line
// feed, up to and including that one, reads its grammar cell with the bit, also white space, whose token is `none`.
// E.g. in
//   ports = [⏎  8001, 8002]
// the two spaces and the 8 of 8001 read their grammar cells with the bit, and the 8 of 8002 without.
// The contexts double from 8 to 16: context + 8 is the context with the bit. A cell with the bit starts as a copy of
// the cell without, so the copy reads every text as `tables` do, until a cell with the bit is changed. Which cells
// with the bit are open comes from the search for frozen cells, run over the bit too, see searchFrozenCells.
export function addFirstOnLineBit(tables: RecoveryTables): RecoveryTables {
  if (tables.contextCount !== contextCount) throw new Error('these tables have the bit "first on its line" already')
  const contexts = 2 * contextCount
  const grammarNext = new Uint8Array(tables.grammarStateCount * tables.tokenCount * contexts)
  const grammarAction = new Uint8Array(grammarNext.length)
  for (let cell = 0; cell < grammarNext.length; cell++) {
    const from = Math.floor(cell / contexts) * contextCount + cell % contextCount
    grammarNext[cell] = tables.grammarNext[from]!
    grammarAction[cell] = tables.grammarAction[from]!
  }
  return {
    ...copyTables(tables), contextCount: contexts, grammarNext, grammarAction,
    grammarOpen: openMasks(tables.lexerStateCount, tables.grammarStateCount, {...structureOf(tables), contextCount: contexts}).grammarOpen,
  }
}

// A copy of `tables` in which entries of the display table are open: every entry that no text makes the parser read
// before its first error, by the same search that finds the frozen cells, and every entry of an added grammar state.
// E.g. (commentStart, afterKey), a `#` when the grammar expects an equals sign after it. Nothing is
// shown otherwise until an open entry is changed. An open entry holds any display kind but `pastEnd`, and the rows
// of the three events of a text's end are not open, see openMasks.
export function openDisplayEntries(tables: RecoveryTables): RecoveryTables {
  return {...copyTables(tables), displayOpen: openMasks(tables.lexerStateCount, tables.grammarStateCount, {...structureOf(tables), openDisplay: true}).displayOpen}
}

// A copy of `tables` with more states: `addedLexerStates` tokenizer states, and one grammar state per entry of
// `addedGrammarStatesShownAs`. An added state comes after the states that are there, and each of its cells is open.
// An added tokenizer state starts as a copy of the state errorLine, and an added grammar state as a copy of the state
// error. The display table needs a column per grammar state: an entry names the grammar state whose column the added
// state copies, e.g. the state afterKey, after which a string is shown as a key. When the display table of `tables` has
// open entries, the entries of an added state are open too.
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
    lexerNext, lexerEvent, grammarNext, grammarAction, ...openMasks(lexerStates, grammarStates, structureOf(tables)),
  }
}

// Gives every open cell and every open entry of the display table a random choice. check-parser.ts uses it to show
// that no choice of them changes what a text gets before its first error.
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
  for (let entry = 0; entry < tables.display.length; entry++) {
    if (tables.displayOpen[entry] === 0) continue
    // Any kind but `pastEnd`.
    const kind = random.integer(0, displayKindCount - 2)
    tables.display[entry] = kind < displayKind.pastEnd ? kind : kind + 1
  }
}

// What breaks the experiment's ground rules in `tables`, as sentences. An empty list means that the fixed tables are
// today's, the class table is today's with the added classes, the masks are the ones of openMasks, every frozen cell
// and every entry of the display table that is not open holds what it holds today, and every open one holds a state,
// an event, an action or a display kind that exists.
export function problemsOf(tables: RecoveryTables): string[] {
  const problems: string[] = []
  const fixedSizes = [['classCount', tables.classCount, classCount + tables.addedClasses.length], ['eventCount', tables.eventCount, eventCount], ['tokenCount', tables.tokenCount, tokenCount], ['errorState', tables.errorState, errorState]] as const
  for (const [name, actual, expected] of fixedSizes) if (actual !== expected) problems.push(`${name} is ${actual}, and has to be ${expected}`)
  if (tables.contextCount !== contextCount && tables.contextCount !== 2 * contextCount) problems.push(`contextCount is ${tables.contextCount}, and has to be ${contextCount}, or ${2 * contextCount} with the bit "first on its line"`)
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
  const grammarCells = tables.grammarStateCount * tokenCount * tables.contextCount
  const displayEntries = eventCount * tables.grammarStateCount
  const lengths = [['lexerNext', tables.lexerNext.length, lexerCells], ['lexerEvent', tables.lexerEvent.length, lexerCells], ['lexerOpen', tables.lexerOpen.length, lexerCells], ['grammarNext', tables.grammarNext.length, grammarCells], ['grammarAction', tables.grammarAction.length, grammarCells], ['grammarOpen', tables.grammarOpen.length, grammarCells], ['display', tables.display.length, displayEntries], ['displayOpen', tables.displayOpen.length, displayEntries]] as const
  for (const [name, actual, expected] of lengths) if (actual !== expected) problems.push(`${name} has ${actual} entries, and has to have ${expected}`)
  if (problems.length > 0) return problems
  if (!sameArray(tables.tokenOfEvent, today.tokenOfEvent)) problems.push('tokenOfEvent is not today\'s')
  const added = structureOf(tables)
  const masks = openMasks(tables.lexerStateCount, tables.grammarStateCount, added)
  if (!sameArray(tables.lexerOpen, masks.lexerOpen)) problems.push('lexerOpen is not the mask of openMasks')
  if (!sameArray(tables.grammarOpen, masks.grammarOpen)) problems.push('grammarOpen is not the mask of openMasks')
  if (!sameArray(tables.displayOpen, masks.displayOpen)) problems.push('displayOpen is not the mask of openMasks: it has to be without an open entry, or the mask that openDisplayEntries gives')
  for (let event = 0; event < eventCount; event++) {
    for (let state = 0; state < tables.grammarStateCount; state++) {
      const entry = event * tables.grammarStateCount + state
      const kind = tables.display[entry]!
      // An open entry holds any kind but `pastEnd`. Another entry of a state of today's holds today's kind. An added
      // state's column holds any kind when the table has no open entry, as addStates fills it, and with open entries
      // only its three entries of a text's end are not open, and hold `pastEnd`.
      const wrong = masks.displayOpen[entry] === 1 ? kind >= displayKindCount || kind === displayKind.pastEnd
        : state < grammarStateCount ? kind !== today.display[event * grammarStateCount + state]
          : added.openDisplay ? kind !== displayKind.pastEnd : kind >= displayKindCount
      if (wrong) problems.push(`display of (${eventNames[event]}, ${grammarStateName(state)}) is ${kind}`)
    }
  }
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
      // A frozen cell with the bit "first on its line" holds what today's cell of the same context without the bit
      // holds: its next state and its stack action.
      const cellToday = Math.floor(cell / tables.contextCount) * contextCount + cell % contextCount
      if (tables.grammarNext[cell] !== today.grammarNext[cellToday] || tables.grammarAction[cell] !== today.grammarAction[cellToday]) problems.push(`the frozen grammar cell ${grammarCellName(tables, cell)} holds ${grammarChoiceName(tables, cell)}`)
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
// classNames.indexOf('colon')), and grammarCellOf with a grammar state, a token and a context.
export const lexerCellOf = (tables: RecoveryTables, lexerState: number, characterClass: number) => lexerState * tables.classCount + characterClass
export const grammarCellOf = (tables: RecoveryTables, grammarState: number, token: number, context: number) => (grammarState * tables.tokenCount + token) * tables.contextCount + context
// The index of an entry of the display table, e.g. displayEntryOf(tables, eventNames.indexOf('commentStart'),
// grammarStateNames.indexOf('afterKey')).
export const displayEntryOf = (tables: RecoveryTables, event: number, grammarStateAfter: number) => event * tables.grammarStateCount + grammarStateAfter

// Names. A state that was added has no name of its own, e.g. "state 111". An added class has the name it was given.
export const lexerStateName = (state: number) => lexerStateNames[state] ?? `state ${state}`
export const grammarStateName = (state: number) => grammarStateNames[state] ?? `state ${state}`
export const className = (tables: RecoveryTables, characterClass: number) => classNames[characterClass] ?? tables.addedClasses[characterClass - classCount]?.name ?? `class ${characterClass}`
// The name of a tokenizer cell, e.g. "(between, quote)", or "(between, semicolon)" for a cell of an added class.
export function lexerCellName(tables: RecoveryTables, cell: number) {
  return `(${lexerStateName(Math.floor(cell / tables.classCount))}, ${className(tables, cell % tables.classCount)})`
}
// The name of a context, e.g. "depth 1, inline table", or "depth 1, inline table, first on its line" for a context with the bit.
const contextName = (context: number) => `${contextNames[context % contextCount]}${context >= contextCount ? ', first on its line' : ''}`
// The name of a grammar cell, e.g. "(afterValue, string, depth 1, inline table)".
export function grammarCellName(tables: RecoveryTables, cell: number) {
  const state = Math.floor(cell / (tables.tokenCount * tables.contextCount))
  const token = Math.floor(cell / tables.contextCount) % tables.tokenCount
  return `(${grammarStateName(state)}, ${tokenNames[token]}, ${contextName(cell % tables.contextCount)})`
}
// What a cell holds, e.g. "basicOpen, stringStart" for a tokenizer cell and "afterValue, none" for a grammar cell.
export const lexerChoiceName = (tables: RecoveryTables, cell: number) => `${lexerStateName(tables.lexerNext[cell]!)}, ${eventNames[tables.lexerEvent[cell]!] ?? `event ${tables.lexerEvent[cell]}`}`
export const grammarChoiceName = (tables: RecoveryTables, cell: number) => `${grammarStateName(tables.grammarNext[cell]!)}, ${actionNames[tables.grammarAction[cell]!] ?? `action ${tables.grammarAction[cell]}`}`
// The name of an entry of the display table, the event and the grammar state after, e.g. "(commentStart, afterKey)", and
// the display kind that it holds, e.g. "comment".
export const displayEntryName = (tables: RecoveryTables, entry: number) => `(${eventNames[Math.floor(entry / tables.grammarStateCount)]}, ${grammarStateName(entry % tables.grammarStateCount)})`
export const displayChoiceName = (tables: RecoveryTables, entry: number) => displayKindNames[tables.display[entry]!] ?? `kind ${tables.display[entry]}`

export type CellDifference = {
  // `display` is an entry of the display table.
  table: 'tokenizer' | 'grammar' | 'display'
  // The index of the cell or of the entry in the tables with more states.
  cell: number
  // The cell's name, e.g. "(value, comma, depth 1, array)", or the entry's, e.g. "(commentStart, afterKey)".
  name: string
  // Whether the cell is open. A difference in a frozen cell breaks the ground rules. For an entry of the display
  // table: whether the entry is open, or is an entry of an added grammar state in tables without open entries,
  // where it may hold any kind.
  open: boolean
  // What the cell holds in the first tables and in the second, e.g. "error, none" and "valueOrClose, none", or "error"
  // and "key" for an entry of the display table. "no such state" where the tables have fewer states.
  before: string
  after: string
}

// `tables` with the classes and the contexts of `like`, which may have added classes and the bit "first on its line"
// where `tables` do not, e.g. today's tables next to tables with a class for the semicolon. The cells of a missing
// class and of the contexts with the bit are copies, see addClasses and addFirstOnLineBit.
function inLayoutOf(tables: RecoveryTables, like: RecoveryTables): RecoveryTables {
  const sameClass = (left: AddedClass | undefined, right: AddedClass) => left !== undefined && left.name === right.name && sameArray(left.codePoints, right.codePoints)
  const shared = tables.addedClasses.length
  if (shared > like.addedClasses.length || !tables.addedClasses.every((added, index) => sameClass(like.addedClasses[index], added)) || tables.contextCount > like.contextCount) {
    throw new Error('two tables can only be compared when the second have what was added to the first: its added classes as their first added classes, and the bit "first on its line" when the first have it')
  }
  const withClasses = shared === like.addedClasses.length ? tables : addClasses(tables, like.addedClasses.slice(shared))
  return withClasses.contextCount === like.contextCount ? withClasses : addFirstOnLineBit(withClasses)
}

// The cells in which two tables differ, tokenizer cells first, then grammar cells, then entries of the display table,
// which the list names like cells. When the second tables have added classes or the bit
// "first on its line" and the first do not, the first are compared as addClasses and addFirstOnLineBit make them: a
// cell of an added class with the cell of the class that its code points came from, and a cell with the bit with the
// cell without. So differencesOf(asIsTables(), tables) lists the cells of `tables` that do something else than
// today's parser. Every cell of an added state is listed, as "no such state" in the tables without the state.
export function differencesOf(beforeAsGiven: RecoveryTables, after: RecoveryTables): CellDifference[] {
  const before = inLayoutOf(beforeAsGiven, after)
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
  // An entry's index depends on the number of grammar states, so the entries are compared by event and state. An
  // entry counts as open when it is open in the tables that have its state, in the second ones when both have it:
  // today's tables have no open entry.
  //
  // The entries of a grammar state that only one of the two tables has are listed where they are open, as that
  // state's cells are, and nowhere else: an entry that is not open is no cell that a run can change. Without open
  // entries the state's column is the one that addStates was told to copy, and with open entries the three entries
  // of a text's end hold `pastEnd`. So tables with an added grammar state and no open entry differ from today's in
  // cells only, as before the display table could have open entries.
  //
  // When both tables have the state and no entry is open, an entry of an added state can still differ, e.g. between
  // tables whose added state copies the column of `afterKey` and tables whose added state copies the column of `value`.
  // The entry is then listed as one that may differ, since checkTables lets such a column hold any kinds.
  const hasOpenEntries = (tables: RecoveryTables) => tables.displayOpen.includes(1)
  for (let event = 0; event < grammarTables.eventCount; event++) {
    for (let state = 0; state < grammarTables.grammarStateCount; state++) {
      const choices = [before, after].map(tables => state < tables.grammarStateCount ? displayChoiceName(tables, displayEntryOf(tables, event, state)) : 'no such state')
      if (choices[0] === choices[1]) continue
      const entry = displayEntryOf(grammarTables, event, state)
      const holder = state < after.grammarStateCount ? after : before
      const isOpen = holder.displayOpen[displayEntryOf(holder, event, state)] === 1
      const inBoth = state < before.grammarStateCount && state < after.grammarStateCount
      if (!inBoth && !isOpen) continue
      differences.push({table: 'display', cell: entry, name: displayEntryName(grammarTables, entry), open: isOpen || (state >= grammarStateCount && !hasOpenEntries(holder)), before: choices[0]!, after: choices[1]!})
    }
  }
  return differences
}

// The differences as aligned lines, e.g. "grammar    (value, comma, depth 1, array)   error, none  ->  valueOrClose, none".
export function describeDifferences(differences: readonly CellDifference[]): string {
  const nameWidth = Math.max(0, ...differences.map(difference => difference.name.length))
  const beforeWidth = Math.max(0, ...differences.map(difference => difference.before.length))
  return differences.map(difference =>
    `${difference.table.padEnd(9)}  ${difference.name.padEnd(nameWidth)}  ${difference.before.padEnd(beforeWidth)}  ->  ${difference.after}${difference.open ? '' : '  (a frozen cell)'}`).join('\n')
}

// How many cells of each table are frozen and open, and how many entries the display table has and how many of them
// are open.
export function cellCounts(tables: RecoveryTables) {
  const ones = (mask: Uint8Array) => mask.reduce((total, bit) => total + bit, 0)
  const lexerOpen = ones(tables.lexerOpen)
  const grammarOpen = ones(tables.grammarOpen)
  return {
    lexerCells: tables.lexerOpen.length, lexerOpen, lexerFrozen: tables.lexerOpen.length - lexerOpen, grammarCells: tables.grammarOpen.length, grammarOpen, grammarFrozen: tables.grammarOpen.length - grammarOpen,
    displayEntries: tables.displayOpen.length, displayOpen: ones(tables.displayOpen),
  }
}

const arrayFields = ['classOfCodePoint', 'tokenOfEvent', 'display', 'lexerNext', 'lexerEvent', 'lexerOpen', 'grammarNext', 'grammarAction', 'grammarOpen'] as const
const sizeFields = ['classCount', 'lexerStateCount', 'eventCount', 'tokenCount', 'contextCount', 'grammarStateCount', 'errorState'] as const

// Tables as JSON text, one line per field, with a note that says where the tables come from, e.g. "hand-written
// recovery, 14 cells", and with the key of the dataset as it is when the text is made, see dataset-key.ts.
// tablesFromJson reads the text back and throws when the tables break the ground rules.
export function tablesToJson(tables: RecoveryTables, note = '', keyOfTheDataset: string = datasetKey()): string {
  checkTables(tables)
  const lines = [`"format": "recovery tables for TOML 1"`, `"note": ${JSON.stringify(note)}`, `"datasetKey": ${JSON.stringify(keyOfTheDataset)}`, ...sizeFields.map(field => `"${field}": ${tables[field]}`), ...arrayFields.map(field => `"${field}": [${Array.from(tables[field]).join(',')}]`)]
  // What was added is only written when something was, so tables without it give the file that they always gave.
  if (tables.addedClasses.length > 0) lines.push(`"addedClasses": ${JSON.stringify(tables.addedClasses)}`)
  if (tables.displayOpen.includes(1)) lines.push(`"displayOpen": [${Array.from(tables.displayOpen).join(',')}]`)
  return `{\n${lines.map(line => `  ${line}`).join(',\n')}\n}\n`
}

// The tables of a file, its note, and the key of the dataset that the file was saved with, or undefined for a file
// from before the key was written.
export type LoadedTables = {tables: RecoveryTables, note: string, datasetKey: string | undefined}

export function tablesFromJson(text: string): LoadedTables {
  const parsed = JSON.parse(text) as Record<string, unknown>
  if (parsed['format'] !== 'recovery tables for TOML 1') throw new Error(`not a file of recovery tables: its format is ${JSON.stringify(parsed['format'])}`)
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
  const display = array('display')
  const tables: RecoveryTables = {
    classCount: size('classCount'), lexerStateCount: size('lexerStateCount'), eventCount: size('eventCount'), tokenCount: size('tokenCount'),
    contextCount: size('contextCount'), grammarStateCount: size('grammarStateCount'), errorState: size('errorState'),
    addedClasses, classToday: classesWith(addedClasses).classToday, classOfCodePoint: array('classOfCodePoint'), tokenOfEvent: array('tokenOfEvent'),
    // A file of tables without an open entry of the display table has no mask for it.
    display, displayOpen: parsed['displayOpen'] === undefined ? new Uint8Array(display.length) : array('displayOpen'),
    lexerNext: array('lexerNext'), lexerEvent: array('lexerEvent'), lexerOpen: array('lexerOpen'),
    grammarNext: array('grammarNext'), grammarAction: array('grammarAction'), grammarOpen: array('grammarOpen'),
  }
  checkTables(tables)
  return {tables, note: typeof parsed['note'] === 'string' ? parsed['note'] : '', datasetKey: typeof parsed['datasetKey'] === 'string' ? parsed['datasetKey'] : undefined}
}

// A file of tables holds the key of the dataset's source files as they were when the file was saved, see
// dataset-key.ts. Tables are saved by the run that made them, so the key says which dataset they were made with.
export const saveTables = (path: string, tables: RecoveryTables, note = '') => writeFileSync(path, tablesToJson(tables, note))
export const loadTables = (path: string): LoadedTables => tablesFromJson(readFileSync(path, 'utf8'))

// What is wrong with the dataset key of a loaded file, as a sentence, or undefined when the file was saved with the
// dataset as it is now. A later commit of the dataset can move a sample from the train split to the validation or
// the test split, so tables that were made before it may have been trained on samples that are scored now.
export function otherDatasetOf(path: string, loaded: LoadedTables): string | undefined {
  if (loaded.datasetKey === datasetKey()) return undefined
  const saved = loaded.datasetKey === undefined ? 'holds no dataset key, so it was saved before the key was written' : `was saved with the dataset ${loaded.datasetKey}`
  return `${path} ${saved}, and the dataset is ${datasetKey()} now: its tables may have been made with samples that are in another split now`
}

// The tables of a file for a command that only reports on them, e.g. compare.ts: a file of another dataset is
// loaded, and the command's output says so in a line that starts with "Note:".
export function loadTablesForReport(path: string, log: (line: string) => void = line => console.log(line)): LoadedTables {
  const loaded = loadTables(path)
  const problem = otherDatasetOf(path, loaded)
  if (problem !== undefined) log(`Note: ${problem}.`)
  return loaded
}

// The tables of a file for a run that starts from them, e.g. search.ts --from, and for the test split's final
// numbers: a file of another dataset is refused. Make the tables again with the dataset as it is.
export function loadTablesOfThisDataset(path: string): LoadedTables {
  const loaded = loadTables(path)
  const problem = otherDatasetOf(path, loaded)
  if (problem !== undefined) throw new Error(`${problem}. Make the tables again with this dataset.`)
  return loaded
}

export {actionByToken, actionNames, actionNone, actionPop, actionPushArray, actionPushInlineTable, classNames, contextNames, eventNames, grammarStateNames, lexerStateNames, tokenNames}
