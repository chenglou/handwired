// Checks what tables.ts says about the cells, without the tools:
// 1. The sizes are the ones that the README states.
// 2. The LALR(1) lookahead sets are derived a second way: the canonical LR(1) automaton of the rules, with its
//    states merged by their LR(0) items, has the same sets.
// 3. No valid start of up to 10 tokens reads an open cell. The check goes through every distinct stack that such a
//    start leaves.
// 4. Every frozen cell is read by a valid program, so "frozen" is exactly "read by some valid text". The programs
//    are completed valid starts and random sentences of the grammar's rules. check-tools.ts gives the same programs
//    to the C program.
// 5. The parser accepts every random sentence of the rules: the precedence declarations cut none out of the language.
// 6. No valid program of 512 code points reaches the stack limit.
// 7. A code point from U+0080 up, read as the one byte 0x80, is cut as flex cuts its UTF-8 bytes.
//
// Run from the repo root: bun lab/recovery-lr/check-cells.ts
import {step, validStarts} from './explore.ts'
import {maximumStackHeight, parseText} from './parser.ts'
import {cellTexts, scannerAccess} from './reference.ts'
import {type Sizes, actionAccept, actionShift, cellText, isTrivia, itemDot, itemOf, itemRule, symbolOf, tables} from './tables.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  console.log(`PROBLEM: ${text}`)
}
const {stateCount, terminalCount, symbolCount, ruleCount, ruleLhs, ruleRhs, textTerminals, frozen, sizes} = tables

// 1. The sizes.
{
  const stated: Sizes = {
    states: 99, terminals: 42, textTerminals: 38, nonterminals: 12, productions: 50, actionCells: 3762, frozenCells: 1391, frozenShifts: 642, frozenAccepts: 1, frozenReductions: 748,
    openCells: 2371, openErrors: 1398, openDefaultReductions: 973, gotos: 102, statesWithDefaultRule: 52, statesThatReduceWithoutToken: 26,
    conflictsSettledAsShift: 149, conflictsSettledAsReduce: 132, conflictsSettledAsError: 0, scannerStates: 72, scannerClasses: 39, scannerRules: 40, scannerCells: 2698, scannerMoves: 793,
  }
  for (const name of Object.keys(stated) as (keyof Sizes)[]) if (sizes[name] !== stated[name]) problem(`the size ${name} is ${sizes[name]}, and the README states ${stated[name]}`)
  console.log(`1. ${sizes.states} states × ${sizes.textTerminals} terminals that a text can hold = ${sizes.actionCells} cells: ${sizes.frozenCells} frozen (${sizes.frozenShifts} shifts, ${sizes.frozenAccepts} accept, ${sizes.frozenReductions} reductions) and ${sizes.openCells} open (${sizes.openErrors} where bison reports the error, ${sizes.openDefaultReductions} where it still reduces by default). ${sizes.gotos} gotos.`)
}

// 2. The canonical LR(1) automaton. A state is a map from an LR(0) item to the set of its lookahead terminals, as
//    bits of a bigint.
{
  const rulesOf: number[][] = Array.from({length: symbolCount}, () => [])
  for (let rule = 0; rule < ruleCount; rule++) rulesOf[ruleLhs[rule]!]!.push(rule)
  const nullable = new Uint8Array(symbolCount)
  const first: bigint[] = Array.from({length: symbolCount}, (_, symbol) => symbol < terminalCount ? 1n << BigInt(symbol) : 0n)
  for (let changed = true; changed;) {
    changed = false
    for (let rule = 0; rule < ruleCount; rule++) {
      const left = ruleLhs[rule]!
      let set = first[left]!
      let allNullable = true
      for (const symbol of ruleRhs[rule]!) {
        set |= first[symbol]!
        if (nullable[symbol] === 0) {
          allNullable = false
          break
        }
      }
      if (set !== first[left] || (allNullable && nullable[left] === 0)) changed = true
      first[left] = set
      if (allNullable) nullable[left] = 1
    }
  }
  type ItemSet = Map<number, bigint>
  const closure = (kernel: ItemSet): ItemSet => {
    const items: ItemSet = new Map(kernel)
    const pending = [...kernel.keys()]
    while (pending.length > 0) {
      const item = pending.pop()!
      const rhs = ruleRhs[itemRule(item)]!, dot = itemDot(item)
      if (dot >= rhs.length || rhs[dot]! < terminalCount) continue
      // The terminals that can come after the nonterminal: the first terminals of the rest of the rule, and the
      // item's own lookahead set when the rest can be empty.
      let after = 0n
      let restNullable = true
      for (let place = dot + 1; place < rhs.length; place++) {
        after |= first[rhs[place]!]!
        if (nullable[rhs[place]!] === 0) {
          restNullable = false
          break
        }
      }
      if (restNullable) after |= items.get(item)!
      for (const rule of rulesOf[rhs[dot]!]!) {
        const added = itemOf(rule, 0)
        const before = items.get(added)
        if (before !== undefined && (before | after) === before) continue
        items.set(added, (before ?? 0n) | after)
        pending.push(added)
      }
    }
    return items
  }
  const keyOf = (kernel: ItemSet): string => [...kernel].sort((left, right) => left[0] - right[0]).map(([item, lookahead]) => `${item}:${lookahead}`).join(' ')
  const startKernel: ItemSet = new Map([[itemOf(0, 0), 0n]])
  const seen = new Set<string>([keyOf(startKernel)])
  const pending: ItemSet[] = [startKernel]
  const stateOfCore = new Map(tables.stateKernel.map((kernel, state) => [[...kernel].sort((left, right) => left - right).join(), state]))
  // merged[state × ruleCount + rule] is the union of the lookahead sets over the LR(1) states with the state's items.
  const merged: bigint[] = new Array<bigint>(stateCount * ruleCount).fill(0n)
  let canonicalStates = 0
  while (pending.length > 0) {
    const kernel = pending.pop()!
    canonicalStates++
    const items = closure(kernel)
    const state = stateOfCore.get([...kernel.keys()].sort((left, right) => left - right).join())
    if (state === undefined) {
      problem('a state of the canonical LR(1) automaton has items that no state of the tables has')
      break
    }
    const kernelAfter = new Map<number, ItemSet>()
    for (const [item, lookahead] of items) {
      const rule = itemRule(item), dot = itemDot(item)
      if (dot === ruleRhs[rule]!.length) {
        merged[state * ruleCount + rule]! |= lookahead
        continue
      }
      const symbol = ruleRhs[rule]![dot]!
      if (!kernelAfter.has(symbol)) kernelAfter.set(symbol, new Map())
      kernelAfter.get(symbol)!.set(itemOf(rule, dot + 1), lookahead)
    }
    for (const next of kernelAfter.values()) {
      const key = keyOf(next)
      if (seen.has(key)) continue
      seen.add(key)
      pending.push(next)
    }
  }
  let sets = 0, differing = 0
  for (let state = 0; state < stateCount; state++) {
    for (const rule of tables.completeRules[state]!) {
      // Rule 0 has the end of input inside it, and no lookahead set.
      if (rule === 0) continue
      sets++
      let ours = 0n
      for (let terminal = 0; terminal < terminalCount; terminal++) if (tables.lookahead[(state * ruleCount + rule) * terminalCount + terminal] === 1) ours |= 1n << BigInt(terminal)
      if (ours !== merged[state * ruleCount + rule] && differing++ < 3) problem(`state ${state}, rule ${rule}: the lookahead set of tables.ts is not the one of the merged LR(1) states`)
    }
  }
  console.log(`2. The canonical LR(1) automaton has ${canonicalStates} states. Merged by their items they are the ${stateCount} states of the tables, and ${sets - differing} of the ${sets} lookahead sets of tables.ts are the merged ones.`)
}

// 3. Valid starts of up to 10 tokens: the stacks of the starts of up to 9 tokens, with every token after each.
{
  const maximumTokens = 10
  const {starts, startCounts} = validStarts(maximumTokens - 1)
  let openReads = 0
  const readByValid = new Uint8Array(stateCount * terminalCount)
  for (const start of starts) {
    for (const terminal of textTerminals) {
      const {cells, stackAfter, accepted} = step(start.stack, terminal)
      if (stackAfter === undefined && !accepted) continue
      for (const cell of cells) {
        readByValid[cell] = 1
        if (frozen[cell] === 0 && openReads++ < 3) problem(`a valid start reads the open cell ${cellText(cell)}`)
      }
    }
  }
  const startCount = startCounts.reduce((sum, count) => sum + count, 0)
  let read = 0
  for (const flag of readByValid) read += flag
  console.log(`3. ${startCount.toLocaleString('en-US')} valid starts of up to ${maximumTokens} tokens: their last token is read on one of ${starts.length.toLocaleString('en-US')} distinct stacks. They read ${read} of the ${sizes.frozenCells} frozen cells and ${openReads} times an open cell.`)
}

// 4 and 5. A valid program for every frozen cell, and the random sentences.
{
  const sentenceCount = 20_000
  const cells = cellTexts(8, sentenceCount)
  let frozenRead = 0, readByAnyText = 0, notValid = 0
  for (let state = 0; state < stateCount; state++) {
    for (const terminal of textTerminals) {
      const cell = state * terminalCount + terminal
      if (cells.textOfCell[cell] !== -1) readByAnyText++
      if (frozen[cell] === 0) {
        if (cells.validText[cell] === 1) problem(`a valid program reads the open cell ${cellText(cell)}`)
        continue
      }
      if (cells.validText[cell] !== 1) {
        problem(`no valid program of the search reads the frozen cell ${cellText(cell)}`)
        continue
      }
      // The text is a whole program that the parser accepts, and the parser reads the cell on the way.
      let reads = 0
      const {parse} = parseText(String.fromCodePoint(...cells.group.texts[cells.textOfCell[cell]!]!), {cell: (readState, readTerminal) => { if (readState === state && readTerminal === terminal) reads++ }})
      if (!parse.valid || reads === 0) notValid++
      else frozenRead++
    }
  }
  if (notValid > 0) problem(`${notValid} texts for frozen cells are not valid programs that read the cell`)
  console.log(`4. ${frozenRead} of the ${sizes.frozenCells} frozen cells are read by a valid program. With the parser as it is, some text reads ${readByAnyText} of the ${sizes.actionCells} cells: ${sizes.actionCells - readByAnyText} open cells are out of its reach, e.g. the ${textTerminals.length} of the final state, which it never enters.`)
  console.log(`5. The parser accepts ${sentenceCount.toLocaleString('en-US')} random sentences of the grammar's rules.`)
}

// 6. The highest stacks of valid programs of 512 code points: one state per code point after `let x=`.
{
  const deepest = [`let x=${'-'.repeat(505)}1`, `let x=${'('.repeat(253)}${')'.repeat(253)}`, `let x=${'['.repeat(253)}${']'.repeat(253)}`, `let x=${'fun x->'.repeat(72)}1`]
  let highest = 0
  for (const text of deepest) {
    const {parse, codePoints} = parseText(text)
    if (!parse.valid || codePoints.length > 512) problem(`the deep program ${text.slice(0, 20)}... is not a valid program of at most 512 code points`)
    highest = Math.max(highest, parse.highestStack)
  }
  if (highest >= maximumStackHeight || highest > 514) problem(`a valid program has a stack of ${highest} states`)
  console.log(`6. The highest stack of the deepest valid programs of 512 code points has ${highest} states, and the limit is ${maximumStackHeight}.`)
}

// 7. The scanner and the code points that no rule names.
{
  const {scannerNext, scannerClassCount, scannerClassOfByte, scannerStart, scannerKindOfState} = tables
  const other = scannerClassOfByte[0x80]!
  if (scannerClassOfByte[0] !== other) problem('the byte 0 is not in the class of the bytes from 0x80 up')
  // A byte from 0x80 up either stays inside the token that it is in, however many such bytes follow, or it is a
  // token of its own. So the two to four bytes of a code point and the one byte 0x80 give the same tokens, except
  // that the bytes outside a string and a comment are one BADCHAR each.
  const afterStart = scannerNext[scannerStart * scannerClassCount + other]!
  if (scannerKindOfState[afterStart] !== symbolOf('BADCHAR') || scannerNext[afterStart * scannerClassCount + other]! > 0) problem('a byte from 0x80 up at the start of a token is not a BADCHAR of its own')
  let inside = 0
  for (const state of scannerAccess().keys()) {
    const next = scannerNext[state * scannerClassCount + other]!
    if (next <= 0 || state === scannerStart) continue
    inside++
    if (scannerNext[next * scannerClassCount + other] !== next) problem(`the scanner's state ${state}: a second byte from 0x80 up does not stay in the state of the first`)
  }
  // Every terminal that a text can hold is the kind of some state, and no state has another terminal.
  const kinds = new Set(scannerKindOfState)
  for (const terminal of textTerminals) if (terminal !== tables.endSymbol && !kinds.has(terminal)) problem(`the scanner never returns ${tables.symbolNames[terminal]}`)
  for (const kind of kinds) if (kind !== 0 && !isTrivia(kind) && tables.isTextTerminal[kind] !== 1) problem(`the scanner returns the terminal ${kind}, which is said to be in no text`)
  console.log(`7. In ${inside} states of the scanner a code point from U+0080 up stays inside the token, e.g. in a string, and it stays there for every further byte. Everywhere else it is a BADCHAR of its own.`)
}

// The shifts and the accept are frozen by definition. Count them once more from the automaton's transitions.
{
  let transitions = 0
  for (let state = 0; state < stateCount; state++) for (const terminal of textTerminals) if (tables.transition[state * symbolCount + terminal] !== -1) transitions++
  let shifts = 0
  for (let cell = 0; cell < frozen.length; cell++) if (tables.actionKind[cell] === actionShift || tables.actionKind[cell] === actionAccept) shifts++
  if (transitions !== shifts || shifts !== sizes.frozenShifts + sizes.frozenAccepts) problem(`the automaton has ${transitions} transitions on terminals and the table ${shifts} shifts`)
}

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
