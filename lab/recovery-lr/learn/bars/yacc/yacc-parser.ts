// bison's parser for miniml-errors.y, the grammar with error productions, as a loop over the arrays of the
// generated C file (tables.json, written by build.ts): `runYacc` does what yyparse of bison 2.3 does, lookup by
// lookup, with its error recovery:
// - At a token without an action, yyparse calls yyerror, unless it is still recovering from an earlier error.
// - It pops states until the state on top can shift the token `error`, and shifts it.
// - It goes on with the same token. A token that still has no action is discarded, and the stack is again popped
//   down to a state that shifts `error`.
// - After three shifted tokens it is no longer recovering, and the next error is reported again.
// check.ts compares the steps with the debug output of the generated C code.
//
// The file also says what the experiment's scorer needs of a run. The depth, the container and the stack's hash of
// ../../../labels.ts are functions of the symbols on the stack, and the stack of this parser holds the base
// grammar's symbols, `error`, and `local_binding`, which is the base grammar's `binding`. An added rule is a rule
// of the base grammar in a broken form, and a symbol on the stack counts as the symbols of the base rule that
// stand in its place:
// - `error` counts as what is missing, e.g. as `=` in `binding: IDENT parameters error expr`, and as nothing
//   where it is text that the parser passes over, see errorStandsFor.
// - A token that an added rule reads as another one counts as that one, e.g. the `,` of `elements: elements COMMA
//   expr` as a `;`, see symbolCountsAs.
// So the body of `let f x 1` is taken on the symbols `let IDENT parameters = `, as the body of the original is.
// The symbols of a rule for an unfinished construct are the base grammar's and count as themselves: the `else` of
// `if a else c` is taken on `if expr else`, which is not what the original's stack holds.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {containerOfSymbols, depthOfSymbols, emptyStackHash, noSymbol, pushStackHash} from '../../../labels.ts'
import type {Tokens} from '../../../parser.ts'
import {type Tables, type ToolDump, buildTables, isTrivia, itemDot, itemRule, readDump, ruleText, symbolOf, tables as baseTables} from '../../../tables.ts'

// The arrays of the generated parser, under the names that the generated file gives them, see ToolDump of
// ../../../tables.ts. YYTERROR is the number of the token `error`.
export type YaccDump = Pick<ToolDump, 'YYFINAL' | 'YYLAST' | 'YYNTOKENS' | 'YYNNTS' | 'YYNRULES' | 'YYNSTATES' | 'YYPACT_NINF' | 'YYTABLE_NINF' | 'yypact' | 'yydefact' | 'yypgoto' | 'yydefgoto' | 'yytable' | 'yycheck' | 'yyr1' | 'yyr2' | 'yystos' | 'yyprhs' | 'yyrhs' | 'yytname'> & {YYTERROR: number}

export const tablesPath = join(import.meta.dir, 'tables.json')
// The arrays for the grammar without the rule `expr: expr error IN expr`, see yaccTablesOf.
export const tablesWithoutInRulePath = join(import.meta.dir, 'tables-without-in-rule.json')
export const readYaccDump = (path = tablesPath): YaccDump => JSON.parse(readFileSync(path, 'utf8')) as YaccDump

export type YaccTables = {
  dump: YaccDump
  // The automaton as ../../../tables.ts builds it from the arrays: the items of every state and the transitions.
  automaton: Tables
  stateCount: number
  terminalCount: number
  ruleCount: number
  symbolNames: readonly string[]
  errorSymbol: number
  // [rule]: the left side as a symbol of the base grammar, and the number of symbols of the right side.
  ruleLhsInBase: Int16Array
  ruleLength: Int16Array
  // [rule]: 1 for a rule that holds `error`, and the number of terminals that its `error` stands for.
  isErrorRule: Uint8Array
  terminalsInPlaceOfError: Uint8Array
  // [rule]: the same rule of the base grammar, -1 for an added rule.
  ruleInBase: Int16Array
  // [state]: the symbols of the base grammar that the state's symbol counts as: the symbol itself, or what
  // errorStandsFor and symbolCountsAs say of the state's rules.
  symbolsOfState: readonly (readonly number[])[]
  // [state]: 1 when a valid program can enter the state: some list of symbols leads from the start state to it
  // both in this automaton and in the base grammar's.
  reachedByValid: Uint8Array
}

// The nonterminals that miniml-errors.y adds, and the nonterminal of the base grammar that each one is.
// `local_binding` is the binding of a `let` inside an expression: with a nonterminal of its own, the end of a
// definition at the top and the end of a local one are two states of the automaton, with two sets of tokens that
// may follow.
const sameAsInBase: Readonly<Record<string, string>> = {local_binding: 'binding'}

// What `error` stands for on the stack, per rule that holds it: the symbols of the base grammar whose place it
// has, for the depth, the container and the stack's hash. Where `error` is text that the parser passes over, it
// stands for nothing.
export const errorStandsFor: Readonly<Record<string, readonly string[]>> = {
  // Junk between two definitions.
  'definitions: definitions error': [],
  // A definition whose `let name parameters` is unreadable, e.g. `lte x = 1`.
  'definition: error EQ expr': ['LET', 'IDENT', 'parameters'],
  // A definition whose name is unreadable, e.g. `let 5 = 1`.
  'binding: error EQ expr': ['IDENT', 'parameters'],
  'local_binding: error EQ expr': ['IDENT', 'parameters'],
  // The `=` is missing, or junk stands before it.
  'binding: IDENT parameters error expr': ['EQ'],
  'local_binding: IDENT parameters error expr': ['EQ'],
  // Junk after an expression, and junk where an expression has to come.
  'expr: expr error': [],
  'atom: error': [],
  // An `if` whose `if` is missing: the expression before `error` is the condition. And one whose `if condition
  // then` is missing: the expression before `error` is what follows `then`. The stack then holds the `if` above
  // its condition, which is right for the depth and the container, and not for the stack's hash.
  'expr: expr error THEN expr': ['IF'],
  'expr: expr error THEN expr ELSE expr': ['IF'],
  'expr: expr error ELSE expr': ['IF'],
  // A local definition whose `let` is missing, e.g. `y = 1 in y`: the expression before `error` is what is left of
  // `let y = 1`. One state holds this rule and the three above, and the `error` of a state counts as one thing, so
  // the missing `let` is written as the `if` of those rules: both open one level, and after the `in` the
  // container is the `in` either way. The stack's hash is not the original's, as in the three rules above.
  'expr: expr error IN expr': ['IF'],
  // A `fun` whose parameters are unreadable, and one whose `->` is missing.
  'expr: FUN error ARROW expr': ['parameter', 'parameters'],
  'expr: FUN parameter parameters error expr': ['ARROW'],
}

// The rules in which `error` counts as a symbol that stands above its expression on the stack, where the symbol
// that is missing would stand below it. Whether a bar may read its stack so is a decision of whoever reads the
// final table, so the bar can also be run without this reading, see yaccTablesOf.
export const rulesWithErrorAboveItsExpression: readonly string[] = ['expr: expr error THEN expr', 'expr: expr error THEN expr ELSE expr', 'expr: expr error ELSE expr', 'expr: expr error IN expr']

// What a token counts as on the stack where an added rule reads it as another token: per rule, the place of the
// token in the right side, and the symbol of the base grammar that stands there in the rule of the base grammar.
export const symbolCountsAs: Readonly<Record<string, Readonly<Record<number, readonly string[]>>>> = {
  // A string that is not closed is a string.
  'atom: BADSTRING': {0: ['STRING']},
  // A `,` between the elements of a list is a `;`.
  'elements: elements COMMA expr': {1: ['SEMI']},
}

// `standsFor` says what `error` counts as, per rule that holds it: errorStandsFor, or another reading of the stack.
export function buildYaccTables(dump: YaccDump, standsFor: Readonly<Record<string, readonly string[]>> = errorStandsFor): YaccTables {
  // The scanner is the base grammar's, so its arrays complete the dump for buildTables.
  const automaton = buildTables({...readDump(), ...dump})
  const {stateCount, terminalCount, ruleCount, symbolNames, symbolCount} = automaton
  const errorSymbol = dump.YYTERROR
  if (symbolNames[errorSymbol] !== 'error') throw new Error('YYTERROR is not the token error')
  // Every terminal has the number that it has in the base grammar, so that the scanner's tokens are this parser's.
  if (terminalCount !== baseTables.terminalCount || symbolNames.slice(0, terminalCount).some((name, terminal) => name !== baseTables.symbolNames[terminal])) throw new Error('the grammar with error productions numbers its terminals differently from the base grammar')
  const nameInBase = (symbol: number): string => sameAsInBase[symbolNames[symbol]!] ?? symbolNames[symbol]!
  const symbolInBase = (symbol: number): number => symbolOf(nameInBase(symbol))

  const ruleLhsInBase = new Int16Array(ruleCount), isErrorRule = new Uint8Array(ruleCount), terminalsInPlaceOfError = new Uint8Array(ruleCount), ruleInBase = new Int16Array(ruleCount).fill(-1)
  const baseRuleOfText = new Map<string, number>()
  for (let rule = 0; rule < baseTables.ruleCount; rule++) baseRuleOfText.set(ruleText(rule), rule)
  // [rule]: for an error rule, the base symbols that `error` stands for.
  const inPlaceOfError: (readonly number[])[] = []
  for (let rule = 0; rule < ruleCount; rule++) {
    ruleLhsInBase[rule] = symbolInBase(automaton.ruleLhs[rule]!)
    const rhs = automaton.ruleRhs[rule]!
    if (!rhs.includes(errorSymbol)) {
      ruleInBase[rule] = baseRuleOfText.get(`${nameInBase(automaton.ruleLhs[rule]!)}: ${rhs.map(nameInBase).join(' ')}`) ?? -1
      inPlaceOfError.push([])
      continue
    }
    isErrorRule[rule] = 1
    const symbolsOfError = standsFor[ruleText(rule, -1, automaton)]
    if (symbolsOfError === undefined) throw new Error(`errorStandsFor does not say what error stands for in the rule ${ruleText(rule, -1, automaton)}`)
    inPlaceOfError.push(symbolsOfError.map(name => symbolOf(name)))
    terminalsInPlaceOfError[rule] = inPlaceOfError[rule]!.filter(symbol => symbol < baseTables.terminalCount).length
  }
  if (new Set(Array.from(ruleInBase).filter(rule => rule !== -1)).size !== baseTables.ruleCount) throw new Error('the grammar with error productions does not hold every rule of the base grammar')

  const symbolsOfState: (readonly number[])[] = []
  for (let state = 0; state < stateCount; state++) {
    const symbol = automaton.accessingSymbol[state]!
    if (symbol === -1) symbolsOfState.push([])
    else if (symbol !== errorSymbol) {
      // The symbol itself, unless the rules of the state say that it counts as more, see symbolCountsAs.
      const readings = automaton.stateKernel[state]!.map(item => symbolCountsAs[ruleText(itemRule(item), -1, automaton)]?.[itemDot(item) - 1])
      const reading = readings.find(found => found !== undefined)
      if (reading === undefined) symbolsOfState.push([symbolInBase(symbol)])
      else {
        if (readings.some(other => other === undefined || other.join() !== reading.join())) throw new Error(`state ${state}: its rules disagree on what ${symbolNames[symbol]} counts as`)
        symbolsOfState.push(reading.map(name => symbolOf(name)))
      }
    }
    else {
      // Every item of the kernel has the dot right after `error`. Where the rules of a state disagree, the reading
      // with the most symbols counts: the other rules of such a state reduce at once, e.g. `definitions:
      // definitions error` next to `definition: error EQ expr`, so their reading is never on the stack for long.
      const readings = automaton.stateKernel[state]!.map(item => {
        const rule = itemRule(item)
        if (automaton.ruleRhs[rule]![itemDot(item) - 1] !== errorSymbol) throw new Error(`state ${state}: an item without error before its dot`)
        return inPlaceOfError[rule]!
      })
      const longest = readings.reduce((best, reading) => reading.length > best.length ? reading : best)
      if (readings.some(reading => reading.length === longest.length && reading.join() !== longest.join())) {
        throw new Error(`state ${state}: its rules disagree on what error stands for: ${automaton.stateKernel[state]!.map(item => ruleText(itemRule(item), itemDot(item), automaton)).join(' | ')}`)
      }
      symbolsOfState.push(longest)
    }
  }

  // The states that a valid program can enter: this automaton and the base grammar's, walked side by side from
  // their start states along the same symbols.
  const reachedByValid = new Uint8Array(stateCount)
  const seen = new Set<number>([automaton.startState * baseTables.stateCount + baseTables.startState])
  const pending: [state: number, baseState: number][] = [[automaton.startState, baseTables.startState]]
  reachedByValid[automaton.startState] = 1
  while (pending.length > 0) {
    const [state, baseState] = pending.pop()!
    for (let symbol = 0; symbol < symbolCount; symbol++) {
      const target = automaton.transition[state * symbolCount + symbol]!
      if (symbol === errorSymbol || target === -1) continue
      const baseTarget = baseTables.transition[baseState * baseTables.symbolCount + symbolInBase(symbol)]!
      if (baseTarget === -1 || seen.has(target * baseTables.stateCount + baseTarget)) continue
      seen.add(target * baseTables.stateCount + baseTarget)
      reachedByValid[target] = 1
      pending.push([target, baseTarget])
    }
  }
  for (let state = 0; state < stateCount; state++) {
    if (reachedByValid[state] === 1 && state !== automaton.startState && (symbolsOfState[state]!.length !== 1 || symbolsOfState[state]![0] !== symbolInBase(automaton.accessingSymbol[state]!))) throw new Error(`state ${state} can be entered by a valid program, and its symbol counts as other symbols`)
  }
  return {dump, automaton, stateCount, terminalCount, ruleCount, symbolNames, errorSymbol, ruleLhsInBase, ruleLength: automaton.ruleLength, isErrorRule, terminalsInPlaceOfError, ruleInBase, symbolsOfState, reachedByValid}
}

// The tables of the committed tables.json.
export const yaccTables: YaccTables = buildYaccTables(readYaccDump())

// The forms of the bar that the final table can show next to it. Each takes one thing out:
// - `inRule: false`: the grammar without `expr: expr error IN expr`, which is the bar as it was before the review
//   of the foundation. The rule adds 1.4 points of all three on the validation samples, and it reads an `in` after
//   a definition at the top as the `in` of a local definition, which costs 44 points on that one mistake of the
//   author's own list, see README.md.
// - `errorAboveItsExpression: false`: `error` stands for nothing in rulesWithErrorAboveItsExpression.
export type YaccForm = {inRule: boolean, errorAboveItsExpression: boolean}
export const formOfTheBar: YaccForm = {inRule: true, errorAboveItsExpression: true}
export const nameOfForm = (form: YaccForm): string => `yacc error productions${form.inRule ? '' : ', without the rule for a missing local let'}${form.errorAboveItsExpression ? '' : ', without error as a symbol above its expression'}`
const tablesOfForms = new Map<string, YaccTables>()
export function yaccTablesOf(form: YaccForm): YaccTables {
  if (form.inRule && form.errorAboveItsExpression) return yaccTables
  const key = `${form.inRule} ${form.errorAboveItsExpression}`
  let tables = tablesOfForms.get(key)
  if (tables === undefined) {
    const standsFor = form.errorAboveItsExpression ? errorStandsFor : {...errorStandsFor, ...Object.fromEntries(rulesWithErrorAboveItsExpression.map(rule => [rule, []]))}
    tables = buildYaccTables(readYaccDump(form.inRule ? tablesPath : tablesWithoutInRulePath), standsFor)
    tablesOfForms.set(key, tables)
  }
  return tables
}

// How a token came to be shown.
export const shownAsTrivia = 0, shownShifted = 1, shownDiscarded = 2, shownNotRead = 3

export type YaccReduction = {
  // The left side as a symbol of the base grammar, and the first and the last token that the right side covers, as
  // places in the text's tokens, -1 for none. An `error` covers the tokens of the states that were popped for it
  // and the tokens that were discarded before it was shifted.
  nonterminal: number
  firstToken: number
  lastToken: number
  rule: number
}

export type YaccRun = {
  // What yyparse returns: 0 when it accepts, with or without errors on the way, and 1 when it gives up, which it
  // does at the end of input while it is recovering, or when no state on the stack shifts `error`.
  result: number
  // How often yyparse called yyerror, and the token at which it did so first: a place in the tokens, the number of
  // tokens for the end of input, -1 for none.
  errorsReported: number
  firstErrorToken: number
  // Per token of the text, white space and comments included:
  // how it came to be shown, one of the `shown` constants above. A token is "not read" when yyparse gave up
  // before it, which only a grammar without an error rule in the start state's reach can do,
  shown: Uint8Array
  // the state on top of the stack when the token was shown: after the shift, or when the token was discarded,
  state: Int16Array
  // the base grammar's symbol below the token on the stack when it was shifted, noSymbol for none,
  symbolBelow: Int16Array
  // and the depth, the container and the hash of the stack's symbols at that moment, see ../../../labels.ts. White
  // space and comments have the three values of the token before them.
  depth: Int16Array
  container: Int8Array
  stack: Int32Array
  reductions: YaccReduction[]
  // How often the token `error` was shifted.
  errorsShifted: number
  // The terminals that the `error` of the reduced rules stands for, e.g. 1 for a reduction by `binding: IDENT
  // parameters error expr`, whose `error` stands for a missing `=`.
  terminalsStoodFor: number
}

// What a caller can watch of a run, in the order of the C driver's trace. `token` is a place in the tokens, and
// tokens.count for the end of input.
export type YaccObserver = {
  enter?: (state: number) => void
  read?: (terminal: number, token: number) => void
  shift?: (symbol: number) => void
  reduce?: (rule: number) => void
  error?: () => void
  pop?: (symbol: number) => void
  discard?: (terminal: number) => void
  // A token was shown: shifted or discarded. The stack is the parser's own: copy what has to last.
  shown?: (token: number, states: readonly number[]) => void
}

const openerOfSymbol = Uint8Array.from({length: baseTables.symbolCount}, (_, symbol) => depthOfSymbols([symbol]))
const containerOfSymbol = Uint8Array.from({length: baseTables.symbolCount}, (_, symbol) => containerOfSymbols([symbol]))
const equalsTerminal = symbolOf('EQ'), exprSymbol = symbolOf('expr')

// Runs yyparse on the tokens of a text.
export function runYacc(tokens: Tokens, tables: YaccTables = yaccTables, observer: YaccObserver = {}): YaccRun {
  const {dump, errorSymbol, symbolsOfState} = tables
  const {yypact, yydefact, yypgoto, yydefgoto, yytable, yycheck, yyr1, yyr2, yystos, YYLAST, YYPACT_NINF, YYTABLE_NINF, YYFINAL, YYNTOKENS} = dump
  const run: YaccRun = {
    result: -1, errorsReported: 0, firstErrorToken: -1,
    shown: new Uint8Array(tokens.count).fill(shownNotRead), state: new Int16Array(tokens.count), symbolBelow: new Int16Array(tokens.count).fill(noSymbol),
    depth: new Int16Array(tokens.count), container: new Int8Array(tokens.count), stack: new Int32Array(tokens.count), reductions: [], errorsShifted: 0, terminalsStoodFor: 0,
  }
  // The stack of states. Next to each state: the first and the last token that it covers, -1 for none, and of the
  // stack up to it the depth, the container, the hash of the symbols and the topmost symbol.
  const states = [0], firstTokenOf = [-1], lastTokenOf = [-1]
  const depthAt = [0], containerAt = [0], hashAt = [emptyStackHash], topSymbolAt = [noSymbol]
  const push = (state: number, firstToken: number, lastToken: number) => {
    let depth = depthAt.at(-1)!, container = containerAt.at(-1)!, hash = hashAt.at(-1)!, below = topSymbolAt.at(-1)!
    for (const symbol of symbolsOfState[state]!) {
      depth += openerOfSymbol[symbol]!
      // An `=` after an expression is the comparison, which starts no container.
      if (containerOfSymbol[symbol] !== 0 && !(symbol === equalsTerminal && below === exprSymbol)) container = containerOfSymbol[symbol]!
      hash = pushStackHash(hash, symbol)
      below = symbol
    }
    states.push(state)
    firstTokenOf.push(firstToken)
    lastTokenOf.push(lastToken)
    depthAt.push(depth)
    containerAt.push(container)
    hashAt.push(hash)
    topSymbolAt.push(below)
    observer.enter?.(state)
  }
  const pop = () => {
    states.pop()
    firstTokenOf.pop()
    lastTokenOf.pop()
    depthAt.pop()
    containerAt.pop()
    hashAt.pop()
    topSymbolAt.pop()
  }
  // Shows a token, and the white space and comments after it, with the stack as it is.
  const show = (token: number, shown: number) => {
    for (let at = token; at < tokens.count && (at === token || isTrivia(tokens.kind[at]!)); at++) {
      run.shown[at] = at === token ? shown : shownAsTrivia
      run.state[at] = states.at(-1)!
      run.depth[at] = depthAt.at(-1)!
      run.container[at] = containerAt.at(-1)!
      run.stack[at] = hashAt.at(-1)!
    }
    if (shown !== shownAsTrivia) observer.shown?.(token, states)
  }
  // The white space and the comments before the first token.
  if (tokens.count > 0 && isTrivia(tokens.kind[0]!)) show(0, shownAsTrivia)
  observer.enter?.(0)

  // The next token that is no white space and no comment. `lookahead` is yychar as a terminal: `empty` when
  // yyparse has not read the token.
  const empty = -2, endOfInput = 0
  let nextToken = 0
  while (nextToken < tokens.count && isTrivia(tokens.kind[nextToken]!)) nextToken++
  let lookahead = empty
  // yyerrstatus: 3 right after an error, and one less with every shifted token.
  let errorStatus = 0
  // The tokens that were discarded since `error` was last shifted: the next `error` covers them.
  let firstDiscarded = -1, lastDiscarded = -1
  const finish = (result: number): YaccRun => {
    run.result = result
    // The tokens that yyparse never read are shown with the empty stack that it leaves.
    for (let token = 0; token < tokens.count; token++) {
      if (run.shown[token] !== shownNotRead || isTrivia(tokens.kind[token]!)) continue
      for (let at = token; at < tokens.count && (at === token || isTrivia(tokens.kind[at]!)); at++) {
        run.shown[at] = at === token ? shownNotRead : shownAsTrivia
        run.stack[at] = emptyStackHash
      }
    }
    return run
  }

  for (;;) {
    const state = states.at(-1)!
    // yybackup: what to do in this state, with the next token where the state needs it.
    let action = 0
    let decided = false
    const base = yypact[state]!
    if (base !== YYPACT_NINF) {
      if (lookahead === empty) {
        lookahead = nextToken < tokens.count ? tokens.kind[nextToken]! : endOfInput
        observer.read?.(lookahead, nextToken)
      }
      const at = base + lookahead
      if (at >= 0 && at <= YYLAST && yycheck[at] === lookahead) {
        action = yytable[at]!
        decided = true
      }
    }
    // yydefault: the state's default rule, 0 for none.
    let rule = -1
    let isError = false
    if (!decided) {
      if (yydefact[state] === 0) isError = true
      else rule = yydefact[state]! - 1
    } else if (action <= 0) {
      if (action === 0 || action === YYTABLE_NINF) isError = true
      else rule = -action - 1
    } else if (action === YYFINAL) return finish(0)
    else {
      // A shift.
      if (errorStatus > 0) errorStatus--
      observer.shift?.(lookahead)
      const symbolBelow = topSymbolAt.at(-1)!
      push(action, nextToken, nextToken)
      if (lookahead !== endOfInput) {
        run.symbolBelow[nextToken] = symbolBelow
        show(nextToken, shownShifted)
        nextToken++
        while (nextToken < tokens.count && isTrivia(tokens.kind[nextToken]!)) nextToken++
        lookahead = empty
      }
      continue
    }

    if (!isError) {
      // yyreduce: pop the rule's right side and push the state after its left side.
      observer.reduce?.(rule)
      let firstToken = -1, lastToken = -1
      for (let count = yyr2[rule + 1]!; count > 0; count--) {
        const firstBelow = firstTokenOf.at(-1)!, lastBelow = lastTokenOf.at(-1)!
        pop()
        if (firstBelow === -1) continue
        firstToken = firstBelow
        if (lastToken === -1) lastToken = lastBelow
      }
      const leftSide = yyr1[rule + 1]!
      const top = states.at(-1)!
      const at = yypgoto[leftSide - YYNTOKENS]! + top
      const target = at >= 0 && at <= YYLAST && yycheck[at] === top ? yytable[at]! : yydefgoto[leftSide - YYNTOKENS]!
      run.reductions.push({nonterminal: tables.ruleLhsInBase[rule]!, firstToken, lastToken, rule})
      run.terminalsStoodFor += tables.terminalsInPlaceOfError[rule]!
      push(target, firstToken, lastToken)
      continue
    }

    // yyerrlab: report the error unless yyparse is still recovering from the last one.
    if (errorStatus === 0) {
      run.errorsReported++
      if (run.firstErrorToken === -1) run.firstErrorToken = nextToken
      observer.error?.()
    }
    if (errorStatus === 3) {
      // The token was tried again after `error` was shifted and still has no action: discard it. At the end of
      // input yyparse gives up.
      if (lookahead === endOfInput) return finish(1)
      observer.discard?.(lookahead)
      show(nextToken, shownDiscarded)
      if (firstDiscarded === -1) firstDiscarded = nextToken
      lastDiscarded = nextToken
      nextToken++
      while (nextToken < tokens.count && isTrivia(tokens.kind[nextToken]!)) nextToken++
      lookahead = empty
    }
    // yyerrlab1: pop states until one shifts `error`, and shift it.
    errorStatus = 3
    let firstToken = firstDiscarded, lastToken = lastDiscarded
    let target: number
    for (;;) {
      const top = states.at(-1)!
      const baseOfTop = yypact[top]!
      if (baseOfTop !== YYPACT_NINF) {
        const at = baseOfTop + errorSymbol
        if (at >= 0 && at <= YYLAST && yycheck[at] === errorSymbol && yytable[at]! > 0) {
          target = yytable[at]!
          break
        }
      }
      if (states.length === 1) return finish(1)
      observer.pop?.(yystos[top]!)
      if (firstTokenOf.at(-1) !== -1) {
        firstToken = firstTokenOf.at(-1)!
        if (lastToken === -1) lastToken = lastTokenOf.at(-1)!
      }
      pop()
    }
    if (target === YYFINAL) return finish(0)
    firstDiscarded = lastDiscarded = -1
    run.errorsShifted++
    observer.shift?.(errorSymbol)
    push(target, firstToken, lastToken)
  }
}

// A run's steps in the form of the C driver's P line, e.g. "P E0 R2 E2 T3@0 S:LET E4 ... X O:expr S:error E9 =0".
export function yaccLine(tokens: Tokens, textLength: number, tables: YaccTables = yaccTables): string {
  const {symbolNames} = tables
  let line = 'P'
  const run = runYacc(tokens, tables, {
    enter: state => { line += ` E${state}` },
    read: (terminal, token) => { line += ` T${terminal}@${token < tokens.count ? tokens.start[token]! : textLength}` },
    shift: symbol => { line += ` S:${symbolNames[symbol]}` },
    reduce: rule => { line += ` R${rule}` },
    error: () => { line += ' X' },
    pop: symbol => { line += ` O:${symbolNames[symbol]}` },
    discard: terminal => { line += ` D:${symbolNames[terminal]}` },
  })
  return `${line} =${run.result}`
}
