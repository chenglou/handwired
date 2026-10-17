// The tables that the recovery experiment runs and changes on bison's parser for miniml: one choice per cell of
// the action table, and a display table.
//
// A cell is (state, terminal). A frozen cell holds what the grammar's LALR(1) table holds, a shift, the accept or a
// reduction, and never changes: a valid text reads frozen cells only. Every other cell of a terminal that a text
// can hold is open, see ../tables.ts. An open cell holds one choice out of a list that depends on its state:
//   stop          enter the added state `stopped`, which every state can lead into. The base where bison reports
//                 the error. The row of `stopped` holds skip, which is its base, or pop.
//   skip          drop the token.
//   pop           drop the state on top of the stack. The start state has no such choice: nothing is below it.
//   reduce r      for a rule r that is complete in the state. The base where bison still reduces by default.
//   insert X      enter the state after X, for a terminal X that the state shifts, and read the token again, e.g.
//                 `then` when `if` follows `if a`.
//   read as X     enter the state after X and take the token, e.g. an open string as a string.
//   end early     for an item `A: α . β` of the state's kernel, drop the states of α and enter the state after A,
//                 e.g. `(1 + 2` before `let` becomes an atom. A switch of the tables leaves these choices out.
// Every choice leaves the stack a path of the automaton, so a parser only reads a goto where bison defined one.
// At the end of input there is no token to skip or to read as another one, so those choices are not in the list.
//
// The display table gives the display kind of a token for (terminal read, state on top after the token is taken or
// skipped). An entry is frozen when a shift reads it, e.g. (IDENT, the state after the name of a binding), which
// shows a defined name. Every other entry is open: a skipped token and a token read as another one read them.
//
// Tables can have more than the base: the flag "first on its line", which gives every cell a second copy
// (addFirstOnLineFlag), and terminals of their own for picked code points (addTerminals).
import {readFileSync, writeFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {containerOfState, displayKind, displayKindCount, displayKindNames, displayOfState, opensDepth} from '../labels.ts'
import {maximumStackHeight, scan} from '../parser.ts'
import type {Random} from '../random.ts'
import {actionAccept, actionReduce, actionShift, itemDot, itemRule, ruleText, symbolOf, tables as bison, tablesPath} from '../tables.ts'

// The terminals of bison's numbering, 42 of them: a text can hold 38, see ../tables.ts. Added terminals come after.
export const bisonTerminalCount = bison.terminalCount
export const endOfInput = bison.endSymbol
export const badCharacter = symbolOf('BADCHAR')
// The added state. It is only ever on top of the stack: its row holds skip or pop.
export const stopped = bison.stateCount
export const stateCount = bison.stateCount + 1
// From the first error on, a token gets at most this many steps, i.e. cells that are read for it. A token that
// has used them is skipped.
export const maximumStepsPerToken = 16
export {maximumStackHeight}

// Per state, the added state included: 1 when the state's symbol opens a depth, the container that its symbol
// starts (0 for none), and the symbol that leads into it (-1 for the start state and for `stopped`, which stands
// for no symbol: the depth, the container and the symbols of a stack are those of the states below it).
export const stateOpensDepth = new Uint8Array(stateCount)
export const stateContainer = new Uint8Array(stateCount)
export const stateSymbol = new Int16Array(stateCount).fill(-1)
stateOpensDepth.set(opensDepth)
stateContainer.set(containerOfState)
stateSymbol.set(bison.accessingSymbol)

// A choice is one number: kind × 256 + argument. The argument is the rule of a reduction, the terminal of an
// insertion and of "read as", the state that a shift enters, and for "end early" the number of dropped states × 16
// + the nonterminal's place among the nonterminals. `shift` and `accept` are no choices of an open cell: they are
// what frozen cells hold.
export const choiceKindNames = ['stop', 'skip', 'pop', 'reduce', 'insert', 'read as', 'end early', 'shift', 'accept'] as const
export const kindStop = 0, kindSkip = 1, kindPop = 2, kindReduce = 3, kindInsert = 4, kindReadAs = 5, kindEndEarly = 6, kindShift = 7, kindAccept = 8
export const choiceOf = (kind: number, argument = 0): number => kind * 256 + argument
export const kindOfChoice = (choice: number): number => choice >> 8
export const argumentOfChoice = (choice: number): number => choice & 255
export const choiceStop = choiceOf(kindStop), choiceSkip = choiceOf(kindSkip), choicePop = choiceOf(kindPop)
export const reduceBy = (rule: number): number => choiceOf(kindReduce, rule)
export const insertOf = (terminal: number): number => choiceOf(kindInsert, terminal)
export const readAs = (terminal: number): number => choiceOf(kindReadAs, terminal)
export const endEarlyOf = (dropped: number, nonterminal: number): number => choiceOf(kindEndEarly, dropped * 16 + nonterminal - bisonTerminalCount)
export const droppedOfEndEarly = (choice: number): number => argumentOfChoice(choice) >> 4
export const nonterminalOfEndEarly = (choice: number): number => bisonTerminalCount + (argumentOfChoice(choice) & 15)
if (bison.nonterminalCount > 16 || bison.ruleCount > 256 || bison.stateCount > 255 || Math.max(...bison.ruleLength) > 15) throw new Error('recovery-tables.ts packs a choice for fewer rules, states or nonterminals than these tables have')

// A terminal of its own for one code point, e.g. {name: 'ampersand', codePoint: 0x26}. The scanner is frozen, so
// the code point has to be one that the scanner reads as a BADCHAR token when it starts no token.
export type AddedTerminal = {name: string, codePoint: number}

export type RecoveryTables = {
  // 42, bison's terminals, plus the added ones. An added terminal's number is 42 + its place in the list.
  terminalCount: number
  addedTerminals: readonly AddedTerminal[]
  // With the flag, every cell has a second copy, which a token reads when it is the first on its line: a line feed
  // stands between it and the token before it.
  firstOnLineFlag: boolean
  // Whether the lists of the open cells hold the choices "end an item early".
  endEarly: boolean
  // stateCount × terminalCount: the cells of one copy.
  cellsPerCopy: number
  // [flag × cellsPerCopy + state × terminalCount + terminal]: the choice, and 1 where the cell is open. A frozen
  // cell holds bison's action as a choice: shift, accept or reduce. A cell of a terminal that no text holds, e.g.
  // bison's own `error`, is neither: it holds stop and is never read.
  choice: Int16Array
  open: Uint8Array
  // [state × terminalCount + terminal]: the display kind of a token of the terminal when `state` is on top after
  // the token is taken or skipped, and 1 where the entry is open. The flag does not double this table.
  display: Int8Array
  displayOpen: Uint8Array
}

export const cellOf = (tables: RecoveryTables, state: number, terminal: number, firstOnLine = 0): number => firstOnLine * tables.cellsPerCopy + state * tables.terminalCount + terminal
export const stateOfCell = (tables: RecoveryTables, cell: number): number => Math.floor((cell % tables.cellsPerCopy) / tables.terminalCount)
export const terminalOfCell = (tables: RecoveryTables, cell: number): number => cell % tables.terminalCount
export const flagOfCell = (tables: RecoveryTables, cell: number): number => cell >= tables.cellsPerCopy ? 1 : 0
export const displayEntryOf = (tables: RecoveryTables, terminal: number, stateOnTop: number): number => stateOnTop * tables.terminalCount + terminal

// The terminal of bison's that an added terminal is for the grammar: BADCHAR. A terminal of bison's is its own.
export const bisonTerminalOf = (terminal: number): number => terminal < bisonTerminalCount ? terminal : badCharacter
// Whether a text can hold the terminal: bison's 38, and every added one.
export const isTextTerminal = (terminal: number): boolean => terminal >= bisonTerminalCount || bison.isTextTerminal[terminal] === 1

// The choices of the open cells of a state, without and with "end an item early": for a token, and at the end of
// input, where there is no token to skip or to read as another one.
function listsOfState(state: number, withEndEarly: boolean): {forToken: number[], atEnd: number[]} {
  if (state === stopped) return {forToken: [choiceSkip, choicePop], atEnd: [choiceSkip, choicePop]}
  const list = [choiceStop, choiceSkip]
  if (state !== bison.startState) list.push(choicePop)
  // Rule 0, `$accept: program $end`, is only complete in the final state, which the parser never enters.
  for (const rule of bison.completeRules[state]!) if (rule !== 0) list.push(reduceBy(rule))
  const shifted: number[] = []
  for (let terminal = 0; terminal < bisonTerminalCount; terminal++) if (terminal !== endOfInput && bison.transition[state * bison.symbolCount + terminal] !== -1) shifted.push(terminal)
  for (const terminal of shifted) list.push(insertOf(terminal))
  for (const terminal of shifted) list.push(readAs(terminal))
  if (withEndEarly) {
    for (const item of bison.stateKernel[state]!) {
      const rule = itemRule(item), dot = itemDot(item)
      // An item with nothing before its dot would insert a nonterminal, and a complete one is a reduction.
      if (rule === 0 || dot === 0 || dot === bison.ruleRhs[rule]!.length) continue
      // So is an item that ends where a complete rule of the state ends, e.g. `if a then b . else c` next to
      // `if a then b .`: ending it early is that rule's reduction, which is in the list already.
      if (bison.completeRules[state]!.some(complete => bison.ruleLength[complete] === dot && bison.ruleLhs[complete] === bison.ruleLhs[rule])) continue
      const choice = endEarlyOf(dot, bison.ruleLhs[rule]!)
      if (!list.includes(choice)) list.push(choice)
    }
  }
  return {forToken: list, atEnd: list.filter(choice => choice !== choiceSkip && kindOfChoice(choice) !== kindReadAs)}
}
const lists = [false, true].map(withEndEarly => Array.from({length: stateCount}, (_, state) => listsOfState(state, withEndEarly)))

// The choices that an open cell may hold, in a fixed order: stop, skip, pop, the reductions, the insertions, the
// terminals to read the token as, the items to end early. The cell's base is one of them. The same list for both
// copies of a cell, and for the cell of an added terminal the list of BADCHAR's cell.
export function choicesOf(tables: Pick<RecoveryTables, 'terminalCount' | 'cellsPerCopy' | 'endEarly'>, cell: number): readonly number[] {
  const state = Math.floor((cell % tables.cellsPerCopy) / tables.terminalCount)
  const ofState = lists[Number(tables.endEarly)]![state]!
  return cell % tables.terminalCount === endOfInput ? ofState.atEnd : ofState.forToken
}

// What a choice does to the stack and to the token, for a parser and for a twin of it. First `dropped` states
// come off the top. Then at most one state is pushed: the state after `gotoNonterminal` from the state that is on
// top by then, or `pushedState`. -1 where it does not apply.
export type Effect = {dropped: number, gotoNonterminal: number, pushedState: number, takesToken: boolean}
export function effectOf(choice: number, state: number): Effect {
  const argument = argumentOfChoice(choice)
  switch (kindOfChoice(choice)) {
    case kindStop: return {dropped: 0, gotoNonterminal: -1, pushedState: stopped, takesToken: false}
    case kindSkip: return {dropped: 0, gotoNonterminal: -1, pushedState: -1, takesToken: true}
    case kindPop: return {dropped: 1, gotoNonterminal: -1, pushedState: -1, takesToken: false}
    case kindReduce: return {dropped: bison.ruleLength[argument]!, gotoNonterminal: bison.ruleLhs[argument]!, pushedState: -1, takesToken: false}
    case kindInsert: return {dropped: 0, gotoNonterminal: -1, pushedState: bison.transition[state * bison.symbolCount + argument]!, takesToken: false}
    case kindReadAs: return {dropped: 0, gotoNonterminal: -1, pushedState: bison.transition[state * bison.symbolCount + argument]!, takesToken: true}
    case kindEndEarly: return {dropped: droppedOfEndEarly(choice), gotoNonterminal: nonterminalOfEndEarly(choice), pushedState: -1, takesToken: false}
    case kindShift: return {dropped: 0, gotoNonterminal: -1, pushedState: argument, takesToken: true}
    default: throw new Error(`the choice ${choice} has no effect on the stack`)
  }
}

// What became of the token after a step.
export const tokenStays = 0, tokenTaken = 1, tokenSkipped = 2, parseAccepted = 3
// One step of the parser on a stack of states, in place: applies the choice that the cell of the state on top
// holds, frozen or open, and says what became of the token. tokenStays: the parser reads the token again in the
// new state. tokenTaken: a state for the token is on top. tokenSkipped: the stack is as it was, either by the
// choice skip or because the choice would put more than 520 states on the stack. The caller counts the steps of a
// token, and skips the token itself in place of a 17th step.
export function applyChoice(stack: number[], choice: number): number {
  const kind = kindOfChoice(choice), argument = argumentOfChoice(choice)
  if (kind === kindReduce || kind === kindEndEarly) {
    const dropped = kind === kindReduce ? bison.ruleLength[argument]! : argument >> 4
    if (dropped === 0 && stack.length >= maximumStackHeight) return tokenSkipped
    stack.length -= dropped
    stack.push(bison.gotoState[stack[stack.length - 1]! * bison.nonterminalCount + (kind === kindReduce ? bison.ruleLhs[argument]! : bisonTerminalCount + (argument & 15)) - bisonTerminalCount]!)
    return tokenStays
  }
  if (kind === kindPop) {
    stack.length--
    return tokenStays
  }
  if (kind === kindSkip) return tokenSkipped
  if (kind === kindAccept) return parseAccepted
  if (stack.length >= maximumStackHeight) return tokenSkipped
  if (kind === kindShift) stack.push(argument)
  else if (kind === kindStop) stack.push(stopped)
  else if (kind === kindInsert || kind === kindReadAs) stack.push(bison.transition[stack[stack.length - 1]! * bison.symbolCount + argument]!)
  else throw new Error(`${choice} is no choice`)
  return kind === kindShift || kind === kindReadAs ? tokenTaken : tokenStays
}

// bison's action in a cell of a state of its own, as a choice.
function bisonChoice(state: number, terminal: number): number {
  const cell = state * bisonTerminalCount + bisonTerminalOf(terminal)
  const kind = bison.actionKind[cell]!
  if (kind === actionShift) return choiceOf(kindShift, bison.actionArgument[cell])
  if (kind === actionAccept) return choiceOf(kindAccept)
  // The final state's default rule is rule 0, which is no choice. The parser accepts instead of entering the state.
  if (kind === actionReduce && bison.actionArgument[cell] !== 0) return reduceBy(bison.actionArgument[cell]!)
  return choiceStop
}

// The masks of a layout: which cells are open, and which display entries are.
function masksOf(terminalCount: number, firstOnLineFlag: boolean): {open: Uint8Array, displayOpen: Uint8Array} {
  const cellsPerCopy = stateCount * terminalCount
  const open = new Uint8Array((firstOnLineFlag ? 2 : 1) * cellsPerCopy)
  const displayOpen = new Uint8Array(cellsPerCopy)
  for (let state = 0; state < stateCount; state++) {
    for (let terminal = 0; terminal < terminalCount; terminal++) {
      if (!isTextTerminal(terminal)) continue
      const cell = state * terminalCount + terminal
      // A cell with the flag is frozen exactly when the cell without it is: any token of a valid program can be
      // the first on its line.
      const frozen = state !== stopped && bison.frozen[state * bisonTerminalCount + bisonTerminalOf(terminal)] === 1
      open[cell] = frozen ? 0 : 1
      if (firstOnLineFlag) open[cellsPerCopy + cell] = open[cell]!
      // A shift of the terminal into the state reads the entry.
      displayOpen[cell] = state !== stopped && displayOfState[state] !== -1 && bison.accessingSymbol[state] === terminal ? 0 : 1
    }
  }
  return {open, displayOpen}
}

// The parser as it is, as tables: bison's default reduction where it still reduces in an open cell, `stop` in every
// other open cell, `skip` in the row of `stopped`, and the kind `error` in every open display entry. So everything
// from the first error on is shown as an error. Each call returns a new copy.
export function baseTables(): RecoveryTables {
  const terminalCount = bisonTerminalCount
  const cellsPerCopy = stateCount * terminalCount
  const choice = new Int16Array(cellsPerCopy).fill(choiceStop)
  const display = new Int8Array(cellsPerCopy).fill(displayKind.error)
  for (let terminal = 0; terminal < terminalCount; terminal++) {
    if (!isTextTerminal(terminal)) continue
    for (let state = 0; state < bison.stateCount; state++) {
      choice[state * terminalCount + terminal] = bisonChoice(state, terminal)
      if (displayOfState[state] !== -1 && bison.accessingSymbol[state] === terminal) display[state * terminalCount + terminal] = displayOfState[state]!
    }
    choice[stopped * terminalCount + terminal] = choiceSkip
  }
  return {terminalCount, addedTerminals: [], firstOnLineFlag: false, endEarly: true, cellsPerCopy, choice, display, ...masksOf(terminalCount, false)}
}

export function copyTables(tables: RecoveryTables): RecoveryTables {
  return {...tables, choice: tables.choice.slice(), open: tables.open.slice(), display: tables.display.slice(), displayOpen: tables.displayOpen.slice()}
}

// A copy of `tables` whose open cells have no choice "end an item early". Throws when a cell holds one.
export function withoutEndEarly(tables: RecoveryTables): RecoveryTables {
  for (let cell = 0; cell < tables.choice.length; cell++) if (kindOfChoice(tables.choice[cell]!) === kindEndEarly) throw new Error(`the cell ${cellName(tables, cell)} ends an item early: tables lose that choice before a run fills them, not after`)
  return {...copyTables(tables), endEarly: false}
}

// A copy of `tables` with the flag "first on its line". A token has the flag when a line feed stands between it
// and the token before it that is no white space and no comment, see firstOnLineOf of ../parser.ts, e.g. the `let`
// of a definition that starts its line. A token with the flag reads the second copy of its cell, at
// cell + cellsPerCopy. The second copy starts as a copy of the first, so the copy reads every text as `tables`
// do until a cell with the flag is changed. The flag opens no cell that is frozen: it adds a second copy of every
// open cell.
export function addFirstOnLineFlag(tables: RecoveryTables): RecoveryTables {
  if (tables.firstOnLineFlag) throw new Error('these tables have the flag "first on its line" already')
  const choice = new Int16Array(2 * tables.cellsPerCopy)
  choice.set(tables.choice)
  choice.set(tables.choice, tables.cellsPerCopy)
  return {...copyTables(tables), firstOnLineFlag: true, choice, open: masksOf(tables.terminalCount, true).open}
}

// Throws when the list of added terminals cannot be: a name or a code point twice, or a code point that the
// scanner does not read as BADCHAR when it stands alone, e.g. a letter.
function checkAddedTerminals(addedTerminals: readonly AddedTerminal[]) {
  const names = new Set<string>(bison.symbolNames), codePoints = new Set<number>()
  for (const {name, codePoint} of addedTerminals) {
    if (name === '' || names.has(name)) throw new Error(`the added terminal ${JSON.stringify(name)} has no name, or the name of another symbol`)
    names.add(name)
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff || codePoints.has(codePoint)) throw new Error(`the added terminal ${name} is for ${codePoint}, which is no code point or has a terminal already`)
    codePoints.add(codePoint)
    const tokens = scan([codePoint])
    if (tokens.count !== 1 || tokens.kind[0] !== badCharacter) throw new Error(`the added terminal ${name} is for U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}, which the scanner does not read as BADCHAR`)
  }
  if (bisonTerminalCount + addedTerminals.length > 255) throw new Error('tables hold at most 255 terminals')
}

// A copy of `tables` with more terminals: a BADCHAR token of one of the code points is read as the code point's
// own terminal, e.g. an `&` that is left of a broken `&&`:
//   addTerminals(tables, [{name: 'ampersand', codePoint: 0x26}])
// The scanner stays as it is: only what the parser calls the token changes. In every state and in both copies, the
// cell of a new terminal starts as a copy of BADCHAR's cell, and so do its display entries. So the copy reads
// every text as `tables` do until a cell of a new terminal is changed. No rule has BADCHAR, so every cell of a
// new terminal is open, with the list of choices of BADCHAR's cell.
export function addTerminals(tables: RecoveryTables, picked: readonly AddedTerminal[]): RecoveryTables {
  const addedTerminals = [...tables.addedTerminals, ...picked.map(({name, codePoint}) => ({name, codePoint}))]
  checkAddedTerminals(addedTerminals)
  const terminalCount = bisonTerminalCount + addedTerminals.length
  const cellsPerCopy = stateCount * terminalCount
  const copies = tables.firstOnLineFlag ? 2 : 1
  const choice = new Int16Array(copies * cellsPerCopy)
  const display = new Int8Array(cellsPerCopy)
  for (let state = 0; state < stateCount; state++) {
    for (let terminal = 0; terminal < terminalCount; terminal++) {
      const from = state * tables.terminalCount + (terminal < tables.terminalCount ? terminal : badCharacter)
      const to = state * terminalCount + terminal
      for (let copy = 0; copy < copies; copy++) choice[copy * cellsPerCopy + to] = tables.choice[copy * tables.cellsPerCopy + from]!
      display[to] = tables.display[from]!
    }
  }
  return {terminalCount, addedTerminals, firstOnLineFlag: tables.firstOnLineFlag, endEarly: tables.endEarly, cellsPerCopy, choice, display, ...masksOf(terminalCount, tables.firstOnLineFlag)}
}

// The terminal that the tables give a token of the scanner: the token's kind, or the added terminal of its code
// point for a BADCHAR token. `codePoint` is the token's first code point. Not for white space and comments.
export function terminalOfToken(tables: RecoveryTables, kind: number, codePoint: number): number {
  if (kind !== badCharacter || tables.addedTerminals.length === 0) return kind
  const added = tables.addedTerminals.findIndex(terminal => terminal.codePoint === codePoint)
  return added === -1 ? kind : bisonTerminalCount + added
}
// A key of what the tables call the tokens: samples that were packed for one key cannot run tables with another.
export const terminalsKeyOf = (tables: RecoveryTables): string => tables.addedTerminals.map(terminal => terminal.codePoint).join(',')

// The open cells that training and the search leave as they are: the column of the end of input. No label asks
// about it, since the end has no code point. 1 per kept cell.
export function keptCellsOf(tables: RecoveryTables): Uint8Array {
  const kept = new Uint8Array(tables.choice.length)
  for (let cell = 0; cell < kept.length; cell++) if (tables.open[cell] === 1 && cell % tables.terminalCount === endOfInput) kept[cell] = 1
  return kept
}
// The open cells that training and the search may change, as a list, in the order of the table.
export function changeableCellsOf(tables: RecoveryTables): number[] {
  const cells: number[] = []
  for (let cell = 0; cell < tables.choice.length; cell++) if (tables.open[cell] === 1 && cell % tables.terminalCount !== endOfInput) cells.push(cell)
  return cells
}

// Gives every open cell a random choice of its list and every open display entry a random kind. check-parser.ts
// uses it to show that no choice of them changes what a text gets before its first error.
export function randomizeOpenCells(tables: RecoveryTables, random: Random) {
  for (let cell = 0; cell < tables.choice.length; cell++) if (tables.open[cell] === 1) tables.choice[cell] = random.pick(choicesOf(tables, cell))
  for (let entry = 0; entry < tables.display.length; entry++) if (tables.displayOpen[entry] === 1) tables.display[entry] = random.integer(0, displayKindCount - 1)
}

const sameArray = (left: ArrayLike<number>, right: ArrayLike<number>): boolean => {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false
  return true
}

// What breaks the ground rules in `tables`, as sentences. An empty list means: the sizes fit, the masks are the
// ones of the layout, every frozen cell holds bison's action, every open cell holds a choice of its list, every
// frozen display entry holds the kind of its shift, and every open one holds a display kind.
export function problemsOf(tables: RecoveryTables): string[] {
  const problems: string[] = []
  try {
    checkAddedTerminals(tables.addedTerminals)
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
  const terminalCount = bisonTerminalCount + tables.addedTerminals.length
  const cellsPerCopy = stateCount * terminalCount
  const copies = tables.firstOnLineFlag ? 2 : 1
  if (tables.terminalCount !== terminalCount) problems.push(`terminalCount is ${tables.terminalCount}, and has to be ${terminalCount}`)
  if (tables.cellsPerCopy !== cellsPerCopy) problems.push(`cellsPerCopy is ${tables.cellsPerCopy}, and has to be ${cellsPerCopy}`)
  const lengths = [['choice', tables.choice.length, copies * cellsPerCopy], ['open', tables.open.length, copies * cellsPerCopy], ['display', tables.display.length, cellsPerCopy], ['displayOpen', tables.displayOpen.length, cellsPerCopy]] as const
  for (const [name, actual, expected] of lengths) if (actual !== expected) problems.push(`${name} has ${actual} entries, and has to have ${expected}`)
  if (problems.length > 0) return problems
  const masks = masksOf(terminalCount, tables.firstOnLineFlag)
  if (!sameArray(tables.open, masks.open)) problems.push('open is not the mask of the open cells')
  if (!sameArray(tables.displayOpen, masks.displayOpen)) problems.push('displayOpen is not the mask of the open display entries')
  for (let cell = 0; cell < tables.choice.length; cell++) {
    const state = stateOfCell(tables, cell), terminal = terminalOfCell(tables, cell)
    const choice = tables.choice[cell]!
    if (masks.open[cell] === 1) {
      if (!choicesOf(tables, cell).includes(choice)) problems.push(`the open cell ${cellName(tables, cell)} holds ${choiceName(choice)}, which is not in its list`)
    } else if (choice !== (isTextTerminal(terminal) ? bisonChoice(state, terminal) : choiceStop)) {
      problems.push(`the frozen cell ${cellName(tables, cell)} holds ${choiceName(choice)}`)
    }
  }
  for (let entry = 0; entry < tables.display.length; entry++) {
    const state = Math.floor(entry / terminalCount), terminal = entry % terminalCount
    const kind = tables.display[entry]!
    const wrong = masks.displayOpen[entry] === 1 ? kind < 0 || kind >= displayKindCount : kind !== (isTextTerminal(terminal) ? displayOfState[state]! : displayKind.error)
    if (wrong) problems.push(`the display entry ${displayEntryName(tables, entry)} holds ${kind}`)
  }
  return problems
}

// Throws when `tables` break the ground rules, with the first problems.
export function checkTables(tables: RecoveryTables) {
  const problems = problemsOf(tables)
  if (problems.length > 0) throw new Error(`these tables break the ground rules (${problems.length} problems): ${problems.slice(0, 6).join('; ')}`)
}

// Names for logs and errors, in the tables' own terms. words.ts says the same in words for a reader.
export const terminalName = (tables: Pick<RecoveryTables, 'addedTerminals'>, terminal: number): string => terminal < bisonTerminalCount ? bison.symbolNames[terminal]! : tables.addedTerminals[terminal - bisonTerminalCount]?.name ?? `terminal ${terminal}`
// A state as its kernel items, e.g. "state 7 [binding: IDENT . parameters EQ expr]".
export const stateName = (state: number): string => state === stopped ? 'stopped' : `state ${state} [${bison.stateKernel[state]!.map(item => ruleText(itemRule(item), itemDot(item))).join(' | ')}]`
// A cell, e.g. "(state 7 [binding: IDENT . parameters EQ expr], INT)", with ", first on its line" for a second copy.
export const cellName = (tables: RecoveryTables, cell: number): string => `(${stateName(stateOfCell(tables, cell))}, ${terminalName(tables, terminalOfCell(tables, cell))}${cell >= tables.cellsPerCopy ? ', first on its line' : ''})`
// A choice, e.g. "insert THEN", "reduce atom: IDENT" and "end atom after 2", which drops two states.
export function choiceName(choice: number): string {
  const argument = argumentOfChoice(choice)
  switch (kindOfChoice(choice)) {
    case kindStop: return 'stop'
    case kindSkip: return 'skip'
    case kindPop: return 'pop'
    case kindReduce: return `reduce ${ruleText(argument)}`
    case kindInsert: return `insert ${bison.symbolNames[argument]}`
    case kindReadAs: return `read as ${bison.symbolNames[argument]}`
    case kindEndEarly: return `end ${bison.symbolNames[nonterminalOfEndEarly(choice)]} after ${droppedOfEndEarly(choice)}`
    case kindShift: return `shift into state ${argument}`
    case kindAccept: return 'accept'
    default: return `choice ${choice}`
  }
}
// A display entry, e.g. "(BADSTRING, state 44 [atom: STRING .])".
export const displayEntryName = (tables: RecoveryTables, entry: number): string => `(${terminalName(tables, entry % tables.terminalCount)}, ${stateName(Math.floor(entry / tables.terminalCount))})`

// `tables` in the layout of `like`, which may have the flag and added terminals where `tables` do not.
function inLayoutOf(tables: RecoveryTables, like: RecoveryTables): RecoveryTables {
  const shared = tables.addedTerminals.length
  if (shared > like.addedTerminals.length || !tables.addedTerminals.every((added, index) => like.addedTerminals[index]!.codePoint === added.codePoint) || (tables.firstOnLineFlag && !like.firstOnLineFlag)) {
    throw new Error('two tables can only be compared when the second have what was added to the first: its added terminals as their first added terminals, and the flag when the first have it')
  }
  const withTerminals = shared === like.addedTerminals.length ? tables : addTerminals(tables, like.addedTerminals.slice(shared))
  return withTerminals.firstOnLineFlag === like.firstOnLineFlag ? withTerminals : addFirstOnLineFlag(withTerminals)
}

export type Difference = {table: 'cells' | 'display', index: number, name: string, before: string, after: string}
// The open cells and the open display entries in which two tables differ. When the second tables have the flag or
// added terminals and the first do not, the first are compared as addFirstOnLineFlag and addTerminals make them.
// So differencesOf(baseTables(), tables) lists what `tables` do otherwise than the parser as it is.
export function differencesOf(beforeAsGiven: RecoveryTables, after: RecoveryTables): Difference[] {
  const before = inLayoutOf(beforeAsGiven, after)
  const differences: Difference[] = []
  for (let cell = 0; cell < after.choice.length; cell++) {
    if (before.choice[cell] !== after.choice[cell]) differences.push({table: 'cells', index: cell, name: cellName(after, cell), before: choiceName(before.choice[cell]!), after: choiceName(after.choice[cell]!)})
  }
  for (let entry = 0; entry < after.display.length; entry++) {
    if (before.display[entry] !== after.display[entry]) differences.push({table: 'display', index: entry, name: displayEntryName(after, entry), before: displayKindNames[before.display[entry]!]!, after: displayKindNames[after.display[entry]!]!})
  }
  return differences
}

// How many cells and display entries the tables have of each sort.
export function cellCounts(tables: RecoveryTables) {
  const counts = {cells: 0, frozenCells: 0, openCells: 0, openCellsOfStopped: 0, keptCells: 0, changeableCells: 0, choices: 0, fewestChoices: Infinity, mostChoices: 0, displayEntries: 0, frozenDisplayEntries: 0, openDisplayEntries: 0}
  for (let cell = 0; cell < tables.choice.length; cell++) {
    if (!isTextTerminal(terminalOfCell(tables, cell))) continue
    counts.cells++
    if (tables.open[cell] === 0) {
      counts.frozenCells++
      continue
    }
    counts.openCells++
    if (stateOfCell(tables, cell) === stopped) counts.openCellsOfStopped++
    if (terminalOfCell(tables, cell) === endOfInput) {
      counts.keptCells++
      continue
    }
    const listLength = choicesOf(tables, cell).length
    counts.changeableCells++
    counts.choices += listLength
    counts.fewestChoices = Math.min(counts.fewestChoices, listLength)
    counts.mostChoices = Math.max(counts.mostChoices, listLength)
  }
  for (let entry = 0; entry < tables.display.length; entry++) {
    if (!isTextTerminal(entry % tables.terminalCount)) continue
    counts.displayEntries++
    if (tables.displayOpen[entry] === 1) counts.openDisplayEntries++
    else counts.frozenDisplayEntries++
  }
  return counts
}

// A key of the grammar's tables, and a key of the files that decide what the train and validation samples are:
// ../dataset.ts and every file that it imports, directly or through another file, with the grammar's tables.
// A file of saved tables holds both. Tables of another grammar cannot be loaded: their cells mean something else.
// Tables of another dataset can, and a command that reports on them says so: a change of the generator moves
// samples between the splits, so such tables may have been made with samples that are validation samples now.
const hashOfFiles = (paths: readonly string[]): string => Bun.hash(paths.map(path => readFileSync(path, 'utf8')).join('\u0000')).toString(16)
export const grammarKey = (): string => hashOfFiles([tablesPath])
// The files of the dataset, in the order in which the imports are met from ../dataset.ts on.
export function datasetFiles(): string[] {
  const files = [resolve(import.meta.dir, '../dataset.ts')]
  for (let at = 0; at < files.length; at++) {
    for (const [, imported] of readFileSync(files[at]!, 'utf8').matchAll(/from '(\.[^']+)'/g)) {
      const path = resolve(dirname(files[at]!), imported!)
      if (!files.includes(path)) files.push(path)
    }
  }
  return [...files, tablesPath]
}
export const datasetKey = (): string => hashOfFiles(datasetFiles())

// Tables as JSON text, one line per field, with a note that says where the tables come from, e.g. "search, 4
// passes". tablesFromJson reads the text back and throws when the tables break the ground rules.
export function tablesToJson(tables: RecoveryTables, note = ''): string {
  checkTables(tables)
  const lines = [
    '"format": "recovery-lr tables 1"', `"note": ${JSON.stringify(note)}`, `"grammarKey": ${JSON.stringify(grammarKey())}`, `"datasetKey": ${JSON.stringify(datasetKey())}`,
    `"endEarly": ${tables.endEarly}`, `"firstOnLineFlag": ${tables.firstOnLineFlag}`, `"addedTerminals": ${JSON.stringify(tables.addedTerminals)}`,
    `"choice": [${Array.from(tables.choice).join(',')}]`, `"display": [${Array.from(tables.display).join(',')}]`,
  ]
  return `{\n${lines.map(line => `  ${line}`).join(',\n')}\n}\n`
}

export type LoadedTables = {tables: RecoveryTables, note: string, datasetKey: string}

export function tablesFromJson(text: string): LoadedTables {
  const parsed = JSON.parse(text) as Record<string, unknown>
  if (parsed['format'] !== 'recovery-lr tables 1') throw new Error(`not a file of recovery tables of this track: its format is ${JSON.stringify(parsed['format'])}`)
  if (parsed['grammarKey'] !== grammarKey()) throw new Error('the tables were saved for another grammar/tables.json: their cells are those of another automaton')
  const numbers = (field: string, lowest: number, highest: number): number[] => {
    const value: unknown = parsed[field]
    if (!Array.isArray(value)) throw new Error(`the field ${field} is missing`)
    const list = value as unknown[]
    const bad = list.findIndex(entry => typeof entry !== 'number' || !Number.isInteger(entry) || entry < lowest || entry > highest)
    if (bad !== -1) throw new Error(`the field ${field} holds ${JSON.stringify(list[bad])} at entry ${bad}, and every entry has to be a whole number from ${lowest} to ${highest}`)
    return list as number[]
  }
  const addedTerminals: AddedTerminal[] = []
  const listed: unknown = parsed['addedTerminals']
  if (!Array.isArray(listed)) throw new Error('the field addedTerminals is no list')
  for (const entry of listed as unknown[]) {
    const {name, codePoint} = (entry ?? {}) as {name?: unknown, codePoint?: unknown}
    if (typeof name !== 'string' || typeof codePoint !== 'number') throw new Error(`the field addedTerminals holds ${JSON.stringify(entry)}, and every entry has to be a name and a code point`)
    addedTerminals.push({name, codePoint})
  }
  if (typeof parsed['endEarly'] !== 'boolean' || typeof parsed['firstOnLineFlag'] !== 'boolean') throw new Error('the fields endEarly and firstOnLineFlag have to be true or false')
  checkAddedTerminals(addedTerminals)
  const terminalCount = bisonTerminalCount + addedTerminals.length
  const tables: RecoveryTables = {
    terminalCount, addedTerminals, firstOnLineFlag: parsed['firstOnLineFlag'], endEarly: parsed['endEarly'], cellsPerCopy: stateCount * terminalCount,
    choice: Int16Array.from(numbers('choice', 0, 0x7fff)), display: Int8Array.from(numbers('display', 0, displayKindCount - 1)), ...masksOf(terminalCount, parsed['firstOnLineFlag']),
  }
  checkTables(tables)
  return {tables, note: typeof parsed['note'] === 'string' ? parsed['note'] : '', datasetKey: typeof parsed['datasetKey'] === 'string' ? parsed['datasetKey'] : ''}
}

export const saveTables = (path: string, tables: RecoveryTables, note = '') => writeFileSync(path, tablesToJson(tables, note))
export const loadTables = (path: string): LoadedTables => tablesFromJson(readFileSync(path, 'utf8'))

// The tables of a file for a command that reports on them: a file that was saved with another version of the
// dataset is loaded, and the command's output says so in a line that starts with "Note:".
export function loadTablesForReport(path: string, log: (line: string) => void = line => console.log(line)): LoadedTables {
  const loaded = loadTables(path)
  if (loaded.datasetKey !== datasetKey()) log(`Note: ${path} was saved with the dataset ${loaded.datasetKey}, and the dataset is ${datasetKey()} now: its tables may have been made with samples that are in another split now.`)
  return loaded
}

// The tables of a file for a run that starts from them, e.g. search.ts --from: a file of another version of the
// dataset is refused. Make the tables again with the dataset as it is.
export function loadTablesOfThisDataset(path: string): LoadedTables {
  const loaded = loadTables(path)
  if (loaded.datasetKey !== datasetKey()) throw new Error(`${path} was saved with the dataset ${loaded.datasetKey}, and the dataset is ${datasetKey()} now: its tables may have been made with samples that are in another split now. Make the tables again with this dataset.`)
  return loaded
}

export {bison, displayKind, displayKindCount, displayKindNames}
