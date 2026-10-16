// Counts the cells of the tables that a valid text reads, and checks each of them against the reference labeler.
//
// A cell is one entry of the tokenizer's table, (tokenizer state, class), or of the grammar's table, (grammar state,
// token, context). An entry of the display table is (event, grammar state after). A step that leads into the grammar
// state `error` is a first error, and a text is the start of a valid text up to its first error (check-table-parser.ts
// checks that), so the cells that a text reads before its first error are the cells that valid texts read. Every
// other cell is read only at or after a first error: those are the cells that the experiment may change.
//
// Two searches over what the parser can do before a first error, as in searchFrozenCells of
// lab/recovery-parser/learn/recovery-tables.ts:
//
// - The exact search keeps the real stack, for the stacks whose containers are all arrays but the innermost two. With
//   such stacks a step never has to guess a kind, so every cell it finds is read by a real text. It can only miss
//   cells.
// - The guessing search keeps the depth and the innermost kind alone, as the JSON search does, and takes both kinds
//   as reached for the container that becomes the innermost after a closing bracket. It can only find too many cells.
//
// The two find the same cells, so the count is exact. In the JSON tables no configuration is reached by a guess
// alone. Here some are: the tokenizer state `afterCloseBracket` inside a container is only reached by a closing
// bracket, so a search that ports the JSON one finds the right cells and cannot name a text for each of them without
// more of the stack.
//
// Then, for every cell and every display entry that the exact search found, the check builds a valid text that reads
// it, the search's text with the shortest ending that the tables accept, and compares the tables with the reference on
// it: both accept it, with the same labels at every code point.
//
// Run from the repo root: bun lab/recovery-toml/check-cells.ts
import {codePointOfClass, completionOf, tableParserDifference} from './check-table-parser.ts'
import {capacity, maximumDepth} from './kinds.ts'
import {
  actionPop, actionPushArray, actionPushInlineTable, classNames, containerArray, containerInlineTable, containerNone, defaultTables,
  eventNames, grammarCellName, grammarStateNames, lexerCellName, runTableParser,
} from './table-parser.ts'

const tables = defaultTables
const {classCount, eventCount, contextCount, grammarStateCount, errorState} = tables
const lexerStateCount = tables.lexerNext.length / classCount
const tokenCount = tables.symbolCount / contextCount
const classEnd = classNames.indexOf('end')
const kindCount = 3

type Found = {
  lexerRead: Uint8Array
  grammarRead: Uint8Array
  displayRead: Uint8Array
  // For a cell that is read: the classes of a text whose last class reads it. Only the exact search gives them.
  lexerWitness: (cell: number) => number[]
  grammarWitness: (cell: number) => number[]
  displayWitness: (entry: number) => number[]
  // The guessing search: configurations that only a guessed kind leads to.
  reachedByGuessAlone: number
}

// A configuration is the tokenizer state, the grammar state, the depth, the kind of the innermost container and the
// kind of the one around it. The guessing search leaves the last one at containerNone.
function search(exact: boolean): Found {
  const configurationOf = (lexerState: number, grammarState: number, depth: number, kind: number, kindAround: number) =>
    (((lexerState * grammarStateCount + grammarState) * (maximumDepth + 1) + depth) * kindCount + kind) * kindCount + kindAround
  // For every configuration that the search reached: the configuration it came from and the class that led to it. -2
  // where the search did not reach, -1 at the start.
  const cameFrom = new Int32Array(lexerStateCount * grammarStateCount * (maximumDepth + 1) * kindCount * kindCount).fill(-2)
  const cameByClass = new Uint8Array(cameFrom.length)
  const lexerRead = new Uint8Array(lexerStateCount * classCount)
  const grammarRead = new Uint8Array(grammarStateCount * tokenCount * contextCount)
  const displayRead = new Uint8Array(eventCount * grammarStateCount)
  const lexerReadFrom = new Int32Array(lexerRead.length).fill(-1)
  const grammarReadFrom = new Int32Array(grammarRead.length).fill(-1)
  const grammarReadByClass = new Uint8Array(grammarRead.length)
  const displayReadFrom = new Int32Array(displayRead.length).fill(-1)
  const displayReadByClass = new Uint8Array(displayRead.length)
  const queue = [configurationOf(0, 0, 0, containerNone, containerNone)]
  cameFrom[queue[0]!] = -1
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
    const kindAround = configuration % kindCount
    const kind = Math.floor(configuration / kindCount) % kindCount
    const depth = Math.floor(configuration / (kindCount * kindCount)) % (maximumDepth + 1)
    const grammarState = Math.floor(configuration / (kindCount * kindCount * (maximumDepth + 1))) % grammarStateCount
    const lexerState = Math.floor(configuration / (kindCount * kindCount * (maximumDepth + 1) * grammarStateCount))
    for (let characterClass = 0; characterClass < classCount; characterClass++) {
      const lexerCell = lexerState * classCount + characterClass
      const event = tables.lexerEvent[lexerCell]!
      const token = tables.grammarToken[event]!
      const context = tables.depthClass[depth]! * 2 + Number(kind === containerInlineTable)
      const grammarCell = (grammarState * tokenCount + token) * contextCount + context
      const grammarAfter = tables.grammarNext[grammarCell]!
      // A step into the error state is a first error. It reads nothing that a valid text reads.
      if (grammarAfter === errorState) continue
      if (lexerRead[lexerCell] === 0) {
        lexerRead[lexerCell] = 1
        lexerReadFrom[lexerCell] = configuration
      }
      if (grammarRead[grammarCell] === 0) {
        grammarRead[grammarCell] = 1
        grammarReadFrom[grammarCell] = configuration
        grammarReadByClass[grammarCell] = characterClass
      }
      const displayEntry = event * grammarStateCount + grammarAfter
      if (displayRead[displayEntry] === 0) {
        displayRead[displayEntry] = 1
        displayReadFrom[displayEntry] = configuration
        displayReadByClass[displayEntry] = characterClass
      }
      // The class `end` stands for the cells after the text, so the search does not go on from it.
      if (characterClass === classEnd) continue
      const lexerAfter = tables.lexerNext[lexerCell]!
      const action = tables.grammarAction[grammarCell]!
      if (action === actionPushArray || action === actionPushInlineTable) {
        if (depth === maximumDepth) throw new Error('a step without an error opened a container at depth 16')
        // The exact search stays with the stacks whose containers are arrays up to the one around the innermost.
        if (exact && depth >= 2 && kindAround !== containerArray) continue
        const pushed = action === actionPushArray ? containerArray : containerInlineTable
        reach(configuration, characterClass, configurationOf(lexerAfter, grammarAfter, depth + 1, pushed, exact ? kind : containerNone))
      } else if (action === actionPop) {
        if (depth === 0) throw new Error('a step without an error closed a container at depth 0')
        const depthAfter = depth - 1
        if (exact) {
          reach(configuration, characterClass, configurationOf(lexerAfter, grammarAfter, depthAfter, depthAfter === 0 ? containerNone : kindAround, depthAfter >= 2 ? containerArray : containerNone))
        } else if (depthAfter === 0) {
          reach(configuration, characterClass, configurationOf(lexerAfter, grammarAfter, 0, containerNone, containerNone))
        } else {
          for (const guessed of [containerInlineTable, containerArray]) guesses.push([configuration, characterClass, configurationOf(lexerAfter, grammarAfter, depthAfter, guessed, containerNone)])
        }
      } else {
        reach(configuration, characterClass, configurationOf(lexerAfter, grammarAfter, depth, kind, kindAround))
      }
    }
    // Every step without a guess is used up: go on from the guessed configurations that are still not reached.
    if (head === queue.length - 1) {
      for (const [from, characterClass, to] of guesses.splice(0)) if (reach(from, characterClass, to)) reachedByGuessAlone++
    }
  }
  const classesTo = (configuration: number) => {
    const classes: number[] = []
    for (let at = configuration; cameFrom[at] !== -1; at = cameFrom[at]!) classes.push(cameByClass[at]!)
    return classes.reverse()
  }
  return {
    lexerRead, grammarRead, displayRead, reachedByGuessAlone,
    lexerWitness: cell => [...classesTo(lexerReadFrom[cell]!), cell % classCount],
    grammarWitness: cell => [...classesTo(grammarReadFrom[cell]!), grammarReadByClass[cell]!],
    displayWitness: entry => [...classesTo(displayReadFrom[entry]!), displayReadByClass[entry]!],
  }
}

const countOf = (mask: Uint8Array) => mask.reduce((sum, bit) => sum + bit, 0)
const sameMask = (left: Uint8Array, right: Uint8Array) => left.every((bit, index) => bit === right[index])

// The cells that a valid text reads, for other code of the experiment: 1 per cell that is read.
export function cellsThatValidTextsRead() {
  const {lexerRead, grammarRead, displayRead} = search(true)
  return {lexerRead, grammarRead, displayRead}
}

// What is wrong with the valid text for one cell, or null. `classes` are the classes of a text whose last class reads
// the cell, and `isRead` says whether the step at a position of the trace reads it.
function witnessProblem(classes: readonly number[], isRead: (trace: ReturnType<typeof runTableParser>, position: number) => boolean): string | null {
  const readAt = classes.length - 1
  // When the last class is `end`, the text ends before it and has to be valid as it is.
  const endsText = classes[readAt] === classEnd
  const start = classes.slice(0, endsText ? readAt : classes.length).map(characterClass => codePointOfClass[characterClass]!)
  const completion = endsText ? [] : completionOf(start, start.length)
  if (completion === null) return `no ending makes ${JSON.stringify(String.fromCodePoint(...start))} valid`
  const text = String.fromCodePoint(...start, ...completion)
  if (start.length + completion.length > capacity) return 'the text is longer than 512 code points'
  const trace = runTableParser(text)
  if (!trace.valid) return `the tables reject ${JSON.stringify(text)}`
  if (!isRead(trace, readAt)) return `${JSON.stringify(text)} does not read the cell at ${readAt}`
  const difference = tableParserDifference(text, trace)
  return difference === null ? null : `${difference} in ${JSON.stringify(text)}`
}

if (import.meta.main) {
  const exact = search(true)
  const guessing = search(false)
  const failures: string[] = []
  const fail = (what: string) => {
    failures.push(what)
    if (failures.length <= 20) console.log(`FAILED: ${what}`)
  }
  const line = (name: string, total: number, read: number) =>
    console.log(`${name}: ${total.toLocaleString('en-US')}, of which a valid text reads ${read.toLocaleString('en-US')} and none reads ${(total - read).toLocaleString('en-US')}`)
  console.log(`${classCount} classes, ${lexerStateCount} tokenizer states, ${eventCount} events, ${tokenCount} tokens, ${contextCount} contexts, ${grammarStateCount} grammar states`)
  line('tokenizer cells', exact.lexerRead.length, countOf(exact.lexerRead))
  line('grammar cells', exact.grammarRead.length, countOf(exact.grammarRead))
  line('display entries', exact.displayRead.length, countOf(exact.displayRead))
  // The rows of the display table for the three events of a text's end hold `pastEnd` and stay as they are.
  const endEvents = eventNames.filter(name => name === 'end' || name === 'endInsideToken' || name === 'truncatedEnd').length
  console.log(`  ${endEvents * grammarStateCount} of the display entries belong to the ${endEvents} events of a text's end, of which a valid text reads ${countOf(exact.displayRead.subarray(eventNames.indexOf('end') * grammarStateCount))}`)
  const same = sameMask(exact.lexerRead, guessing.lexerRead) && sameMask(exact.grammarRead, guessing.grammarRead) && sameMask(exact.displayRead, guessing.displayRead)
  if (!same) fail('the exact search and the guessing search find other cells')
  console.log(`the search with real stacks and the search that guesses the kind after a closing bracket find ${same ? 'the same cells' : 'OTHER cells'}; the guessing search reaches ${guessing.reachedByGuessAlone} configurations by a guess alone`)

  let witnesses = 0
  for (let cell = 0; cell < exact.lexerRead.length; cell++) {
    if (exact.lexerRead[cell] === 0) continue
    witnesses++
    const problem = witnessProblem(exact.lexerWitness(cell), (trace, position) => trace.lexerStateBefore[position]! * classCount + trace.characterClass[position]! === cell)
    if (problem !== null) fail(`tokenizer cell ${lexerCellName(cell)}: ${problem}`)
  }
  for (let cell = 0; cell < exact.grammarRead.length; cell++) {
    if (exact.grammarRead[cell] === 0) continue
    witnesses++
    const problem = witnessProblem(exact.grammarWitness(cell), (trace, position) => (trace.grammarBefore[position]! * tokenCount + trace.token[position]!) * contextCount + trace.context[position]! === cell)
    if (problem !== null) fail(`grammar cell ${grammarCellName(cell)}: ${problem}`)
  }
  for (let entry = 0; entry < exact.displayRead.length; entry++) {
    if (exact.displayRead[entry] === 0) continue
    witnesses++
    const problem = witnessProblem(exact.displayWitness(entry), (trace, position) => trace.event[position]! * grammarStateCount + trace.grammarAfter[position]! === entry)
    if (problem !== null) fail(`display entry (${eventNames[Math.floor(entry / grammarStateCount)]}, ${grammarStateNames[entry % grammarStateCount]}): ${problem}`)
  }
  console.log(`${witnesses.toLocaleString('en-US')} valid texts, one per cell and entry that is read: ${failures.length === 0 ? 'each reads its cell, and the tables and the reference agree at every code point of each' : `${failures.length} failures`}`)
  console.log(failures.length === 0 ? 'every check passed' : `${failures.length} failures`)
  if (failures.length > 0) process.exitCode = 1
}
