// The tables that bison 2.3 and flex 2.6.4 made for miniml (grammar/tables.json, written by grammar/build.ts from
// the arrays of the generated C files), as plain tables:
// - what yyparse does for every (state, terminal), default reductions included, and the gotos,
// - the LR(0) items of every state, rebuilt from the rules along the tool's transitions,
// - the LALR(1) lookahead sets, computed here from the rules: bison 2.3's report prints none for a state with a
//   single reduction,
// - which cells are frozen and which are open,
// - flex's scanner table.
//
// A cell is (state, terminal), at state × terminalCount + terminal. A cell is frozen when the grammar's LALR(1)
// table has an action there: a shift, the accept, or a reduction by a rule whose lookahead set holds the terminal.
// A valid text reads frozen cells only. Every other cell of a terminal that a text can hold is open. In an open
// cell bison either reports the error, or still reduces by the state's default rule and reports the error some
// steps later, e.g. in `let x 1` it reduces an empty parameter list at the `1` before it reports.
//
// buildTables takes the arrays as an argument, so that a check can build the tables of a changed copy.
// check-cells.ts and check-tools.ts check what this file computes.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'

// The arrays of the generated files, under the names that the generated files give them.
export type ToolDump = {
  // The state after `program $end`: a shift into it is the accept. The last index of yytable. The counts of
  // terminals, nonterminals, rules (with rule 0, $accept: program $end) and states.
  YYFINAL: number, YYLAST: number, YYNTOKENS: number, YYNNTS: number, YYNRULES: number, YYNSTATES: number,
  YYPACT_NINF: number, YYTABLE_NINF: number,
  yypact: number[], yydefact: number[], yypgoto: number[], yydefgoto: number[], yytable: number[], yycheck: number[],
  // Per rule, from index 1 for rule 0: the left side and the length of the right side.
  yyr1: number[], yyr2: number[],
  // Per state, the symbol that leads into it.
  yystos: number[],
  // The right sides, each ended by -1, and where each rule's right side starts.
  yyprhs: number[], yyrhs: number[],
  yytname: string[],
  scannerStates: number, scannerClasses: number, scannerRules: number,
  // The class of every byte. The rule that a token ends with, per scanner state. The state after a byte 0, per
  // state. The state after a byte of a class, [state × scannerClasses + class], 0 or less for none.
  yy_ec: number[], yy_accept: number[], yy_NUL_trans: number[], yy_nxt: number[],
  // What every rule of miniml.l returns, from rule 1, e.g. 'LET'. Three names are no terminals: WHITESPACE,
  // NEWLINE and COMMENT, which the parser never sees.
  scannerRuleNames: string[],
}

export const tablesPath = join(import.meta.dir, 'grammar/tables.json')
export const readDump = (path = tablesPath): ToolDump => JSON.parse(readFileSync(path, 'utf8')) as ToolDump

// What a parser does in a cell.
export const actionError = 0, actionShift = 1, actionReduce = 2, actionAccept = 3
// The kinds of the scanner's tokens that are no terminals. Every other kind is a terminal's number.
export const whitespaceKind = 1001, newlineKind = 1002, commentKind = 1003
export const isTrivia = (kind: number): boolean => kind >= whitespaceKind

// The numbers that the README states, counted from the tables.
export type Sizes = {
  states: number
  // bison's terminals, with `$end`, `error`, `$undefined` and the two names that only carry a precedence, LOWEST
  // and UMINUS. A text can hold all but those four: the 34 tokens, the three kinds of text that is no token
  // (BADCHAR, BADSTRING, BADCOMMENT) and the end of input.
  terminals: number, textTerminals: number
  nonterminals: number
  // Without rule 0, $accept: program $end.
  productions: number
  // states × textTerminals.
  actionCells: number
  frozenCells: number, frozenShifts: number, frozenAccepts: number, frozenReductions: number
  // Open cells, of which bison reports the error in openErrors and still reduces by default in openDefaultReductions.
  openCells: number, openErrors: number, openDefaultReductions: number
  // The pairs (state, nonterminal) that have a goto.
  gotos: number
  statesWithDefaultRule: number
  // The states in which bison reduces before it has read the next token.
  statesThatReduceWithoutToken: number
  // The grammar's shift/reduce conflicts, all settled by the precedence declarations: as a shift, as a reduction, and
  // as an error (%nonassoc), which makes a cell open that the grammar has an action for.
  conflictsSettledAsShift: number, conflictsSettledAsReduce: number, conflictsSettledAsError: number
  // The scanner. Its cells are (state, class) for the states from scannerStart and the classes from 1: class 0 is
  // flex's own end of buffer. A cell holds a move to a state, or ends the token.
  scannerStates: number, scannerClasses: number, scannerRules: number, scannerCells: number, scannerMoves: number
}

export type Tables = {
  dump: ToolDump
  stateCount: number
  terminalCount: number
  nonterminalCount: number
  // terminalCount + nonterminalCount. Terminals have the numbers below terminalCount.
  symbolCount: number
  // With rule 0, $accept: program $end, as in bison's report and its debug output.
  ruleCount: number
  symbolNames: readonly string[]
  // The end of input, `$end`.
  endSymbol: number
  // The terminals that a text can hold, in order, the end of input first.
  textTerminals: readonly number[]
  isTextTerminal: Uint8Array

  // [rule]
  ruleLhs: Int16Array
  ruleLength: Int16Array
  ruleRhs: readonly (readonly number[])[]

  // [state × terminalCount + terminal]: what yyparse does, by yyparse's own lookups. actionArgument is the state
  // that a shift enters or the rule of a reduction.
  actionKind: Uint8Array
  actionArgument: Int16Array
  // [state × terminalCount + terminal]: 1 for a frozen cell. A cell of a text terminal with 0 is open.
  frozen: Uint8Array
  // [state]: the rule that the state reduces by where its row has no other entry, -1 for none.
  defaultRule: Int16Array
  // [state]: 1 when bison reduces by the default rule without reading the next token.
  reducesWithoutToken: Uint8Array
  // [state × nonterminalCount + nonterminal − terminalCount]: the state after a reduction to the nonterminal with
  // `state` on top, -1 where the automaton has no such transition. bison's compressed table gives some state for
  // every pair. A parser whose stack is a path of the automaton only reads the pairs that are not -1.
  gotoState: Int16Array
  // [state × symbolCount + symbol]: the automaton's transitions, -1 for none: the shifts of the table (the accept is
  // the transition of `$end` into finalState) and the gotos.
  transition: Int16Array
  // The state before any token.
  startState: number
  // The state after `program $end`. The parser accepts instead of entering it.
  finalState: number
  // [state]: the symbol that leads into the state, -1 for the start state.
  accessingSymbol: Int16Array

  // The LR(0) items. An item is rule × 8 + dot, see itemRule and itemDot: no right side is longer than 6.
  // The kernel has the items that the transition into the state made, e.g. `binding: IDENT . parameters EQ expr`.
  stateKernel: readonly (readonly number[])[]
  // The kernel and its closure, e.g. also `parameters: .`.
  stateItems: readonly (readonly number[])[]
  // The rules that the state can reduce by: its items with the dot at the end.
  completeRules: readonly (readonly number[])[]
  // [(state × ruleCount + rule) × terminalCount + terminal]: 1 when the terminal is in the LALR(1) lookahead set of
  // the complete rule in the state. The sets are the grammar's, before the precedence declarations settle a conflict.
  lookahead: Uint8Array

  sizes: Sizes

  // The scanner: flex's full table over its own classes of bytes.
  scannerStateCount: number
  scannerClassCount: number
  // The state before a token.
  scannerStart: number
  // [byte]: the class. A code point from U+0080 up is read as the byte 0x80.
  scannerClassOfByte: Uint8Array
  // [state × scannerClassCount + class]: the next state, 0 or less where the token ends before the byte.
  scannerNext: Int16Array
  // [state]: the kind of a token that ends in the state: a terminal's number, whitespaceKind, newlineKind or
  // commentKind. 0 for the states in which no token ends.
  scannerKindOfState: Int32Array
}

export const itemOf = (rule: number, dot: number): number => rule * 8 + dot
export const itemRule = (item: number): number => item >> 3
export const itemDot = (item: number): number => item & 7

export function buildTables(dump: ToolDump): Tables {
  const terminalCount = dump.YYNTOKENS
  const nonterminalCount = dump.YYNNTS
  const symbolCount = terminalCount + nonterminalCount
  const stateCount = dump.YYNSTATES
  const ruleCount = dump.YYNRULES
  const symbolNames = dump.yytname
  const endSymbol = 0
  const finalState = dump.YYFINAL
  const symbolOfName = (name: string): number => {
    const symbol = symbolNames.indexOf(name)
    if (symbol === -1) throw new Error(`the tables have no symbol ${name}`)
    return symbol
  }
  if (symbolNames.length !== symbolCount || symbolNames[endSymbol] !== '$end') throw new Error('yytname does not fit the counts of symbols')
  const neverInText = ['error', '$undefined', 'LOWEST', 'UMINUS'].map(symbolOfName)
  const textTerminals: number[] = []
  const isTextTerminal = new Uint8Array(terminalCount)
  for (let terminal = 0; terminal < terminalCount; terminal++) {
    if (neverInText.includes(terminal)) continue
    textTerminals.push(terminal)
    isTextTerminal[terminal] = 1
  }

  const ruleLhs = new Int16Array(ruleCount)
  const ruleLength = new Int16Array(ruleCount)
  const ruleRhs: number[][] = []
  for (let rule = 0; rule < ruleCount; rule++) {
    ruleLhs[rule] = dump.yyr1[rule + 1]!
    ruleLength[rule] = dump.yyr2[rule + 1]!
    const rhs: number[] = []
    for (let at = dump.yyprhs[rule + 1]!; dump.yyrhs[at]! !== -1; at++) rhs.push(dump.yyrhs[at]!)
    if (rhs.length !== ruleLength[rule] || rhs.length > 7) throw new Error(`rule ${rule}: yyrhs and yyr2 disagree, or the right side is too long for an item`)
    if (ruleLhs[rule]! < terminalCount || ruleLhs[rule]! >= symbolCount || rhs.some(symbol => symbol < 0 || symbol >= symbolCount)) throw new Error(`rule ${rule} has a symbol that the tables do not have`)
    ruleRhs.push(rhs)
  }

  // What yyparse does for (state, terminal), by the lookups of yyparse.
  const actionKind = new Uint8Array(stateCount * terminalCount)
  const actionArgument = new Int16Array(stateCount * terminalCount)
  const defaultRule = new Int16Array(stateCount).fill(-1)
  const reducesWithoutToken = new Uint8Array(stateCount)
  for (let state = 0; state < stateCount; state++) {
    const base = dump.yypact[state]!
    if (dump.yydefact[state]! !== 0) defaultRule[state] = dump.yydefact[state]! - 1
    if (defaultRule[state]! >= ruleCount) throw new Error(`state ${state}: the default rule is no rule`)
    if (base === dump.YYPACT_NINF) reducesWithoutToken[state] = 1
    for (let terminal = 0; terminal < terminalCount; terminal++) {
      const cell = state * terminalCount + terminal
      let entry = 0
      let found = false
      if (base !== dump.YYPACT_NINF) {
        const at = base + terminal
        if (at >= 0 && at <= dump.YYLAST && dump.yycheck[at] === terminal) {
          entry = dump.yytable[at]!
          found = true
        }
      }
      if (!found) {
        if (defaultRule[state] === -1) actionKind[cell] = actionError
        else {
          actionKind[cell] = actionReduce
          actionArgument[cell] = defaultRule[state]!
        }
      } else if (entry <= 0) {
        if (entry === 0 || entry === dump.YYTABLE_NINF) actionKind[cell] = actionError
        else {
          if (-entry - 1 >= ruleCount) throw new Error(`state ${state}, ${symbolNames[terminal]}: a reduction by a rule that the tables do not have`)
          actionKind[cell] = actionReduce
          actionArgument[cell] = -entry - 1
        }
      } else if (entry === finalState) actionKind[cell] = actionAccept
      else {
        if (entry >= stateCount) throw new Error(`state ${state}, ${symbolNames[terminal]}: a shift into a state that the tables do not have`)
        actionKind[cell] = actionShift
        actionArgument[cell] = entry
      }
    }
  }
  // The state after a reduction to `nonterminal` with `state` on top, by yyparse's lookups.
  const toolGoto = (state: number, nonterminal: number): number => {
    const at = dump.yypgoto[nonterminal - terminalCount]! + state
    const target = at >= 0 && at <= dump.YYLAST && dump.yycheck[at] === state ? dump.yytable[at]! : dump.yydefgoto[nonterminal - terminalCount]!
    if (target < 0 || target >= stateCount) throw new Error(`state ${state}, ${symbolNames[nonterminal]}: a goto into a state that the tables do not have`)
    return target
  }

  // The LR(0) item sets, rebuilt from the rules along the tool's transitions. The grammar's automaton has a shift
  // wherever an item has a terminal after its dot. Where the precedence settled a conflict as a reduction, bison
  // took the shift out of its table: grammarTransition still has it, since the lookahead sets are those of the
  // grammar before the precedence is applied.
  const rulesOf: number[][] = Array.from({length: symbolCount}, () => [])
  for (let rule = 0; rule < ruleCount; rule++) rulesOf[ruleLhs[rule]!]!.push(rule)
  const closureOf = (kernel: readonly number[]): number[] => {
    const items = [...kernel]
    const seen = new Set(items)
    for (let at = 0; at < items.length; at++) {
      const rule = itemRule(items[at]!), dot = itemDot(items[at]!)
      if (dot >= ruleRhs[rule]!.length) continue
      for (const next of rulesOf[ruleRhs[rule]![dot]!]!) {
        const item = itemOf(next, 0)
        if (seen.has(item)) continue
        seen.add(item)
        items.push(item)
      }
    }
    return items
  }
  const stateKernel: number[][] = Array.from({length: stateCount}, () => [])
  const stateItems: number[][] = Array.from({length: stateCount}, () => [])
  const transition = new Int16Array(stateCount * symbolCount).fill(-1)
  const grammarTransition = new Int16Array(stateCount * symbolCount).fill(-1)
  const reached = new Uint8Array(stateCount)
  const removedShifts: {state: number, terminal: number, kernel: string}[] = []
  stateKernel[0] = [itemOf(0, 0)]
  reached[0] = 1
  const pending = [0]
  while (pending.length > 0) {
    const state = pending.pop()!
    const items = closureOf(stateKernel[state]!)
    stateItems[state] = items
    const kernelAfter = new Map<number, number[]>()
    for (const item of items) {
      const rule = itemRule(item), dot = itemDot(item)
      if (dot >= ruleRhs[rule]!.length) continue
      const symbol = ruleRhs[rule]![dot]!
      if (!kernelAfter.has(symbol)) kernelAfter.set(symbol, [])
      kernelAfter.get(symbol)!.push(itemOf(rule, dot + 1))
    }
    for (const [symbol, kernel] of kernelAfter) {
      kernel.sort((left, right) => left - right)
      let target: number
      if (symbol < terminalCount) {
        const cell = state * terminalCount + symbol
        if (actionKind[cell] === actionAccept) target = finalState
        else if (actionKind[cell] === actionShift) target = actionArgument[cell]!
        else {
          removedShifts.push({state, terminal: symbol, kernel: kernel.join()})
          continue
        }
      } else target = toolGoto(state, symbol)
      transition[state * symbolCount + symbol] = target
      grammarTransition[state * symbolCount + symbol] = target
      if (reached[target] === 1) {
        if (stateKernel[target]!.join() !== kernel.join()) throw new Error(`state ${target} is reached with two kernels`)
      } else {
        reached[target] = 1
        stateKernel[target] = kernel
        pending.push(target)
      }
    }
  }
  const stateOfKernel = new Map<string, number>()
  for (let state = 0; state < stateCount; state++) {
    if (reached[state] !== 1) throw new Error(`state ${state} is not reached from the start state`)
    if (stateOfKernel.has(stateKernel[state]!.join())) throw new Error(`state ${state} has the kernel of another state`)
    stateOfKernel.set(stateKernel[state]!.join(), state)
  }
  for (const {state, terminal, kernel} of removedShifts) {
    const target = stateOfKernel.get(kernel)
    if (target === undefined) throw new Error(`state ${state}, ${symbolNames[terminal]}: no state has the kernel of a shift that the table lacks`)
    grammarTransition[state * symbolCount + terminal] = target
  }
  const accessingSymbol = new Int16Array(stateCount).fill(-1)
  for (let state = 0; state < stateCount; state++) {
    // Every shift of the table is a transition of the automaton.
    for (let terminal = 0; terminal < terminalCount; terminal++) {
      const cell = state * terminalCount + terminal
      if (actionKind[cell] === actionShift && transition[state * symbolCount + terminal] !== actionArgument[cell]) throw new Error(`state ${state}, ${symbolNames[terminal]}: a shift that no item of the state has`)
      if (actionKind[cell] === actionAccept && transition[state * symbolCount + terminal] !== finalState) throw new Error(`state ${state}, ${symbolNames[terminal]}: an accept that no item of the state has`)
    }
    if (state === 0) continue
    // yystos is the symbol that leads into the state.
    accessingSymbol[state] = dump.yystos[state]!
    for (const item of stateKernel[state]!) if (ruleRhs[itemRule(item)]![itemDot(item) - 1] !== dump.yystos[state]) throw new Error(`state ${state}: yystos disagrees with the kernel`)
  }
  const gotoState = new Int16Array(stateCount * nonterminalCount).fill(-1)
  for (let state = 0; state < stateCount; state++) {
    for (let nonterminal = terminalCount; nonterminal < symbolCount; nonterminal++) gotoState[state * nonterminalCount + nonterminal - terminalCount] = transition[state * symbolCount + nonterminal]!
  }
  const completeRules = stateItems.map(items => items.filter(item => itemDot(item) === ruleRhs[itemRule(item)]!.length).map(itemRule))

  // The LALR(1) lookahead sets, by the relations of DeRemer and Pennello over the grammar's automaton.
  // follow(state, nonterminal) is the set of terminals that can come after the nonterminal when it is reduced to
  // with `state` on top.
  const nullable = new Uint8Array(symbolCount)
  for (let changed = true; changed;) {
    changed = false
    for (let rule = 0; rule < ruleCount; rule++) {
      if (nullable[ruleLhs[rule]!] === 1 || !ruleRhs[rule]!.every(symbol => nullable[symbol] === 1)) continue
      nullable[ruleLhs[rule]!] = 1
      changed = true
    }
  }
  const followKey = (state: number, nonterminal: number): number => state * symbolCount + nonterminal
  const follow = new Map<number, Set<number>>()
  // (into, from): `into` takes every terminal of `from`.
  const reads: [number, number][] = []
  const includes: [number, number][] = []
  // (state, rule, key): the lookahead set of the complete rule in the state takes follow(key).
  const lookback: [number, number, number][] = []
  for (let state = 0; state < stateCount; state++) {
    for (let nonterminal = terminalCount; nonterminal < symbolCount; nonterminal++) {
      const target = grammarTransition[followKey(state, nonterminal)]!
      if (target === -1) continue
      // The terminals that the state after the nonterminal shifts.
      const directly = new Set<number>()
      for (let terminal = 0; terminal < terminalCount; terminal++) if (grammarTransition[target * symbolCount + terminal] !== -1) directly.add(terminal)
      follow.set(followKey(state, nonterminal), directly)
      // A nullable nonterminal after this one: what can follow it can follow this one.
      for (let next = terminalCount; next < symbolCount; next++) {
        if (nullable[next] === 1 && grammarTransition[followKey(target, next)] !== -1) reads.push([followKey(state, nonterminal), followKey(target, next)])
      }
      for (const rule of rulesOf[nonterminal]!) {
        const rhs = ruleRhs[rule]!
        const path = [state]
        for (const symbol of rhs) {
          const next = grammarTransition[path.at(-1)! * symbolCount + symbol]!
          if (next === -1) throw new Error(`state ${state}: rule ${rule} of its closure has no path`)
          path.push(next)
        }
        lookback.push([path.at(-1)!, rule, followKey(state, nonterminal)])
        // A nonterminal at the end of the rule, or before a nullable end: what follows the rule's left side follows it.
        for (let place = rhs.length - 1; place >= 0; place--) {
          const symbol = rhs[place]!
          if (symbol >= terminalCount) includes.push([followKey(path[place]!, symbol), followKey(state, nonterminal)])
          if (nullable[symbol] === 0) break
        }
      }
    }
  }
  for (const edges of [reads, includes]) {
    for (let changed = true; changed;) {
      changed = false
      for (const [into, from] of edges) {
        const target = follow.get(into)!
        for (const terminal of follow.get(from)!) {
          if (target.has(terminal)) continue
          target.add(terminal)
          changed = true
        }
      }
    }
  }
  const lookahead = new Uint8Array(stateCount * ruleCount * terminalCount)
  for (const [state, rule, key] of lookback) for (const terminal of follow.get(key)!) lookahead[(state * ruleCount + rule) * terminalCount + terminal] = 1

  // Frozen and open cells.
  const frozen = new Uint8Array(stateCount * terminalCount)
  const sizes: Sizes = {
    states: stateCount, terminals: terminalCount, textTerminals: textTerminals.length, nonterminals: nonterminalCount, productions: ruleCount - 1,
    actionCells: stateCount * textTerminals.length, frozenCells: 0, frozenShifts: 0, frozenAccepts: 0, frozenReductions: 0, openCells: 0, openErrors: 0, openDefaultReductions: 0,
    gotos: 0, statesWithDefaultRule: 0, statesThatReduceWithoutToken: 0, conflictsSettledAsShift: 0, conflictsSettledAsReduce: removedShifts.length, conflictsSettledAsError: 0,
    scannerStates: dump.scannerStates, scannerClasses: dump.scannerClasses, scannerRules: dump.scannerRules, scannerCells: 0, scannerMoves: 0,
  }
  for (let state = 0; state < stateCount; state++) {
    if (defaultRule[state] !== -1) sizes.statesWithDefaultRule++
    if (reducesWithoutToken[state] === 1) sizes.statesThatReduceWithoutToken++
    for (let nonterminal = 0; nonterminal < nonterminalCount; nonterminal++) if (gotoState[state * nonterminalCount + nonterminal] !== -1) sizes.gotos++
    for (const terminal of textTerminals) {
      const cell = state * terminalCount + terminal
      const kind = actionKind[cell]!
      // The complete rules whose lookahead set holds the terminal.
      const wanting = completeRules[state]!.filter(rule => lookahead[(state * ruleCount + rule) * terminalCount + terminal] === 1)
      if (wanting.length > 1) throw new Error(`state ${state}, ${symbolNames[terminal]}: two rules want the terminal, and the grammar is said to have no reduce/reduce conflict`)
      const grammarShifts = grammarTransition[state * symbolCount + terminal] !== -1
      if (kind === actionShift || kind === actionAccept) {
        frozen[cell] = 1
        if (kind === actionShift) sizes.frozenShifts++
        else sizes.frozenAccepts++
        if (wanting.length > 0) sizes.conflictsSettledAsShift++
      } else if (kind === actionReduce && wanting.includes(actionArgument[cell]!)) {
        frozen[cell] = 1
        sizes.frozenReductions++
      } else if (kind === actionReduce) {
        // The grammar has no action here, and bison still reduces: only its default rule can do that.
        if (actionArgument[cell] !== defaultRule[state]) throw new Error(`state ${state}, ${symbolNames[terminal]}: a reduction by rule ${actionArgument[cell]}, which is not the default rule and does not have the terminal in its lookahead set`)
        sizes.openDefaultReductions++
        if (wanting.length > 0 || grammarShifts) sizes.conflictsSettledAsError++
      } else {
        sizes.openErrors++
        if (wanting.length > 0 || grammarShifts) sizes.conflictsSettledAsError++
      }
    }
  }
  sizes.frozenCells = sizes.frozenShifts + sizes.frozenAccepts + sizes.frozenReductions
  sizes.openCells = sizes.openErrors + sizes.openDefaultReductions

  // The scanner.
  const scannerStateCount = dump.scannerStates
  const scannerClassCount = dump.scannerClasses
  const scannerStart = 1
  if (dump.yy_nxt.length !== scannerStateCount * scannerClassCount || dump.yy_ec.length !== 256 || dump.yy_accept.length !== scannerStateCount || dump.yy_NUL_trans.length !== scannerStateCount) throw new Error('the arrays of the scanner do not fit its counts')
  const scannerNext = Int16Array.from(dump.yy_nxt)
  for (const next of scannerNext) if (next >= scannerStateCount) throw new Error('the scanner moves into a state that it does not have')
  const scannerClassOfByte = Uint8Array.from(dump.yy_ec)
  for (let byte = 1; byte < 256; byte++) if (scannerClassOfByte[byte]! < 1 || scannerClassOfByte[byte]! >= scannerClassCount) throw new Error(`the byte ${byte} has a class that the scanner does not have`)
  for (let byte = 0x80; byte < 256; byte++) if (scannerClassOfByte[byte] !== scannerClassOfByte[0x80]) throw new Error('the bytes from 0x80 up are not all in one class, and the scanner reads every code point from U+0080 up as the byte 0x80')
  // flex gives the byte 0 no class of its own in yy_ec and reads it with a function of its own. The function is a
  // column of the table: the column of the class whose moves are the function's.
  const classOfZero = Array.from({length: scannerClassCount}, (_, characterClass) => characterClass).find(characterClass =>
    characterClass >= 1 && dump.yy_NUL_trans.every((next, state) => state < scannerStart || Math.max(0, scannerNext[state * scannerClassCount + characterClass]!) === next))
  if (classOfZero === undefined) throw new Error('no class of the scanner moves as the byte 0 does')
  scannerClassOfByte[0] = classOfZero
  const scannerKindOfName = (name: string): number => name === 'WHITESPACE' ? whitespaceKind : name === 'NEWLINE' ? newlineKind : name === 'COMMENT' ? commentKind : symbolOfName(name)
  if (dump.scannerRuleNames.length !== dump.scannerRules) throw new Error(`the scanner has ${dump.scannerRules} rules and scannerRuleNames has ${dump.scannerRuleNames.length}`)
  const scannerKindOfState = new Int32Array(scannerStateCount)
  for (let state = scannerStart; state < scannerStateCount; state++) {
    // Rule numbers start at 1. A number past the file's rules is one of flex's own, e.g. the end of its buffer.
    const rule = dump.yy_accept[state]!
    if (rule >= 1 && rule <= dump.scannerRules) scannerKindOfState[state] = scannerKindOfName(dump.scannerRuleNames[rule - 1]!)
    for (let characterClass = 1; characterClass < scannerClassCount; characterClass++) {
      sizes.scannerCells++
      if (scannerNext[state * scannerClassCount + characterClass]! > 0) sizes.scannerMoves++
    }
  }

  return {
    dump, stateCount, terminalCount, nonterminalCount, symbolCount, ruleCount, symbolNames, endSymbol, textTerminals, isTextTerminal, ruleLhs, ruleLength, ruleRhs,
    actionKind, actionArgument, frozen, defaultRule, reducesWithoutToken, gotoState, transition, startState: 0, finalState, accessingSymbol,
    stateKernel, stateItems, completeRules, lookahead, sizes, scannerStateCount, scannerClassCount, scannerStart, scannerClassOfByte, scannerNext, scannerKindOfState,
  }
}

// The tables of the committed grammar/tables.json.
export const tables: Tables = buildTables(readDump())

// A symbol's number by its name in miniml.y, e.g. symbolOf('LET') or symbolOf('expr').
export function symbolOf(name: string, from: Tables = tables): number {
  const symbol = from.symbolNames.indexOf(name)
  if (symbol === -1) throw new Error(`no symbol ${name}`)
  return symbol
}

// A rule as text, e.g. "atom: LPAREN expr RPAREN", or with a dot as an item, e.g. "atom: LPAREN . expr RPAREN".
export function ruleText(rule: number, dot = -1, from: Tables = tables): string {
  const rhs = from.ruleRhs[rule]!
  const symbols = rhs.map((symbol, place) => `${place === dot ? '. ' : ''}${from.symbolNames[symbol]}`)
  if (dot === rhs.length) symbols.push('.')
  return `${from.symbolNames[from.ruleLhs[rule]!]}: ${symbols.join(' ')}`
}
export const itemText = (item: number, from: Tables = tables): string => ruleText(itemRule(item), itemDot(item), from)

// A state as its kernel items, e.g. "state 12 [binding: IDENT . parameters EQ expr]".
export const stateText = (state: number, from: Tables = tables): string => `state ${state} [${from.stateKernel[state]!.map(item => itemText(item, from)).join(' | ')}]`

// A cell's name, e.g. "(state 12, EQ)".
export const cellText = (cell: number, from: Tables = tables): string => `(state ${Math.floor(cell / from.terminalCount)}, ${from.symbolNames[cell % from.terminalCount]})`

if (import.meta.main) console.log(tables.sizes)
