// Checks that the comparison with the tools would see a wrong table: it changes entries and expects a text whose
// tokens or steps are then not the C program's.
// 1. 90 copies of grammar/tables.json with one entry changed: 12 moves of the scanner and 6 entries of each of 13
//    other arrays, e.g. yytable. Each must be refused by tables.ts, or must give other lines than the C program for some
//    text. A change is also fine when it provably changes nothing that a text reads, e.g. an entry of yytable that
//    no lookup reads.
// 2. Every entry of the scanner's plain tables that a text reads, changed to every other value: every move to
//    every other reachable state and to "the token ends", every kind of a state, every class of a code point.
//    Each must cut some text differently, or the changed scanner must provably cut every text as before.
// 3. For every cell of the parser's table that a text reads, three other actions, and for every goto two other
//    states. Each must give other steps for the cell's text.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/check-changed.ts
// Without the tools it cannot run, see check-tools.ts for --skip-without-tools.
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {buildTools, scratchFolder, toolsProblem} from './grammar/build.ts'
import {parse, scan, scannerLine} from './parser.ts'
import {createRandom} from './random.ts'
import {type Lines, type TextGroup, cellTexts, differingTexts, handTexts, linesOf, programTexts, randomTexts, runDriver, scannerTexts, sentenceTexts, shortTexts} from './reference.ts'
import {type Tables, type ToolDump, actionAccept, actionError, actionReduce, actionShift, buildTables, cellText, readDump, tables} from './tables.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  console.log(`PROBLEM: ${text}`)
}

const missing = toolsProblem()
if (missing !== undefined) {
  console.log(`The tools are not here (${missing}), so nothing was compared with them.`)
  if (process.argv.includes('--skip-without-tools')) console.log('Every check passed.')
  else process.exitCode = 1
  process.exit()
}
// The tools are run in a folder of this check's own, so that two checks can run at a time.
const folder = join(scratchFolder(), 'check-changed')
mkdirSync(folder, {recursive: true})
const tools = buildTools(folder)

// The texts, and what the C program says of them.
const cells = cellTexts(8, 20_000)
const scanner = scannerTexts()
const [programs, damagedPrograms] = programTexts(1500, 2) as [TextGroup, TextGroup]
const [sentences, damagedSentences] = sentenceTexts(1000) as [TextGroup, TextGroup]
const parserGroups = [cells.group, handTexts(), sentences, damagedSentences, programs, damagedPrograms, randomTexts(1000)]
const scannerGroups = [scanner.group, shortTexts(3)]
const expected = new Map<TextGroup, Lines[]>()
for (const group of [...parserGroups, ...scannerGroups]) {
  expected.set(group, runDriver(tools.driverPath, group, folder))
  if (differingTexts(group, expected.get(group)!, tables, 1).length > 0) problem(`${group.name}: a text differs with the unchanged tables, run check-tools.ts`)
}
const textCount = [...parserGroups, ...scannerGroups].reduce((sum, group) => sum + group.texts.length, 0)

// What the texts read of the parser's tables, with the unchanged tables.
const {terminalCount, nonterminalCount, stateCount, ruleCount} = tables
const readCells = new Uint8Array(stateCount * terminalCount)
const usedGotos = new Uint8Array(stateCount * nonterminalCount)
// The place in the cells' group of a text that takes the goto, -1 for none.
const textOfGoto = new Int32Array(stateCount * nonterminalCount).fill(-1)
const reducedRules = new Uint8Array(ruleCount)
const enteredStates = new Uint8Array(stateCount)
enteredStates[tables.startState] = 1
for (const group of [...parserGroups, ...scannerGroups]) {
  for (const [index, text] of group.texts.entries()) {
    parse(scan(text), text.length, {
      cell: (state, terminal) => { readCells[state * terminalCount + terminal] = 1 },
      shift: (_token, state) => { enteredStates[state] = 1 },
      reduce: (rule, state, stack) => {
        const pair = stack.at(-2)! * nonterminalCount + tables.ruleLhs[rule]! - terminalCount
        usedGotos[pair] = 1
        if (group === cells.group && textOfGoto[pair] === -1) textOfGoto[pair] = index
        reducedRules[rule] = 1
        enteredStates[state] = 1
      },
    })
  }
}
const countOf = (flags: Uint8Array): number => flags.reduce((sum, flag) => sum + flag, 0)
console.log(`${textCount} texts read ${countOf(readCells)} of the ${tables.sizes.actionCells} cells of the parser's table, take ${countOf(usedGotos)} of the ${tables.sizes.gotos} gotos, reduce by ${countOf(reducedRules)} of the ${tables.sizes.productions} productions and enter ${countOf(enteredStates)} of the ${stateCount} states.`)

// Whether two scanners cut every text into the same tokens: a walk over the pairs of states that the two are in
// after the same text, for every code point from U+0000 to U+0080.
function scannersCutAlike(first: Tables, second: Tables): boolean {
  if (first.scannerStateCount !== second.scannerStateCount) return false
  const seen = new Set<number>()
  const pending: [number, number][] = [[first.scannerStart, second.scannerStart]]
  while (pending.length > 0) {
    const [firstState, secondState] = pending.pop()!
    const key = firstState * first.scannerStateCount + secondState
    if (seen.has(key)) continue
    seen.add(key)
    // A text that ends here: the last token's kind. The start state has no token.
    const firstKind = firstState === first.scannerStart ? -1 : first.scannerKindOfState[firstState]!, secondKind = secondState === second.scannerStart ? -1 : second.scannerKindOfState[secondState]!
    if (firstKind !== secondKind || firstKind === 0) return false
    for (let codePoint = 0; codePoint <= 0x80; codePoint++) {
      const firstClass = first.scannerClassOfByte[codePoint]!, secondClass = second.scannerClassOfByte[codePoint]!
      const firstNext = first.scannerNext[firstState * first.scannerClassCount + firstClass]!, secondNext = second.scannerNext[secondState * second.scannerClassCount + secondClass]!
      if ((firstNext > 0) !== (secondNext > 0)) return false
      if (firstNext > 0) pending.push([firstNext, secondNext])
      else pending.push([first.scannerNext[first.scannerStart * first.scannerClassCount + firstClass]!, second.scannerNext[second.scannerStart * second.scannerClassCount + secondClass]!])
    }
  }
  return true
}

// Whether the entries of the parser's tables that the texts read are the same in two tables.
function parserReadsTheSame(first: Tables, second: Tables): boolean {
  for (let cell = 0; cell < readCells.length; cell++) {
    if (readCells[cell] === 1 && (first.actionKind[cell] !== second.actionKind[cell] || first.actionArgument[cell] !== second.actionArgument[cell] || first.frozen[cell] !== second.frozen[cell])) return false
  }
  for (let pair = 0; pair < usedGotos.length; pair++) if (usedGotos[pair] === 1 && first.gotoState[pair] !== second.gotoState[pair]) return false
  for (let rule = 0; rule < ruleCount; rule++) if (reducedRules[rule] === 1 && (first.ruleLhs[rule] !== second.ruleLhs[rule] || first.ruleLength[rule] !== second.ruleLength[rule])) return false
  for (let state = 0; state < stateCount; state++) if (enteredStates[state] === 1 && first.reducesWithoutToken[state] !== second.reducesWithoutToken[state]) return false
  return first.terminalCount === second.terminalCount && first.nonterminalCount === second.nonterminalCount && first.startState === second.startState && first.finalState === second.finalState
}
const sameArray = (first: ArrayLike<number>, second: ArrayLike<number>): boolean => first.length === second.length && Array.prototype.every.call(first, (value: number, index: number) => value === second[index])
const sameScannerTables = (first: Tables, second: Tables): boolean =>
  sameArray(first.scannerNext, second.scannerNext) && sameArray(first.scannerClassOfByte, second.scannerClassOfByte) && sameArray(first.scannerKindOfState, second.scannerKindOfState)

// 1. One entry of grammar/tables.json changed.
{
  const dump = readDump()
  type NumberArrayName = 'yy_nxt' | 'yy_accept' | 'yy_ec' | 'yy_NUL_trans' | 'yypact' | 'yydefact' | 'yytable' | 'yycheck' | 'yypgoto' | 'yydefgoto' | 'yyr1' | 'yyr2' | 'yyrhs' | 'yystos'
  // The entries of each array that a change is drawn from: the ones that the tables are built from.
  const reachable = scanner.reachableStates
  const range = (from: number, to: number): number[] => Array.from({length: to - from}, (_, index) => from + index)
  const places: Record<NumberArrayName, number[]> = {
    yy_nxt: reachable.flatMap(state => range(1, dump.scannerClasses).map(characterClass => state * dump.scannerClasses + characterClass)),
    yy_accept: reachable.filter(state => state !== tables.scannerStart),
    yy_ec: range(1, 0x80),
    yy_NUL_trans: reachable,
    yypact: range(0, stateCount).filter(state => state !== tables.finalState),
    yydefact: range(0, stateCount).filter(state => state !== tables.finalState),
    // The entries of the compressed table that some lookup reads.
    yytable: range(0, dump.YYLAST + 1).filter(place => dump.yycheck[place] !== -1),
    yycheck: range(0, dump.YYLAST + 1).filter(place => dump.yycheck[place] !== -1),
    yypgoto: range(1, nonterminalCount),
    yydefgoto: range(1, nonterminalCount),
    yyr1: range(2, ruleCount + 1),
    yyr2: range(2, ruleCount + 1),
    yyrhs: range(3, dump.yyrhs.length),
    yystos: range(1, stateCount),
  }
  const outcomes = new Map<string, number>()
  let changes = 0
  for (const [arrayIndex, name] of (Object.keys(places) as NumberArrayName[]).entries()) {
    for (let draw = 0; draw < (name === 'yy_nxt' ? 12 : 6); draw++) {
      const random = createRandom(20261016, arrayIndex * 100 + draw)
      const place = random.pick(places[name])
      const before = dump[name][place]!
      // Another value of the same array, so that the changed entry is of the array's kind, e.g. a state for a state.
      // For a move of the scanner: another reachable state, or 0 for "the token ends" where the scanner moves.
      // flex writes "the token ends" as one of several negative numbers, and which one changes nothing.
      const to = name === 'yy_nxt' ? random.pick([0, ...reachable].filter(value => value !== before && (value > 0 || before > 0))) : random.pick(dump[name].filter(value => value !== before))
      const changed: ToolDump = {...dump, [name]: dump[name].map((value, index) => index === place ? to : value)}
      changes++
      const outcome = ((): string => {
        let built: Tables
        try {
          built = buildTables(changed)
        } catch (error) {
          return `tables.ts refuses the tables (${(error instanceof Error ? error.message : String(error)).slice(0, 90)})`
        }
        // A change of bison's arrays cannot change the tokens, so the texts for the scanner alone are left out.
        const groups = sameScannerTables(tables, built) ? parserGroups : [...scannerGroups, ...parserGroups]
        for (const group of groups) if (differingTexts(group, expected.get(group)!, built, 1).length > 0) return `a text of "${group.name}" differs`
        if (scannersCutAlike(tables, built) && parserReadsTheSame(tables, built)) return 'changes nothing that a text reads'
        problem(`${name}[${place}] changed from ${before} to ${to}: no text differs, and the change is in what the texts read`)
        return 'NOT SEEN'
      })()
      console.log(`  ${name}[${place}]: ${before} -> ${to}: ${outcome}`)
      const kind = outcome.startsWith('tables.ts refuses') ? 'refused by tables.ts' : outcome.startsWith('a text of') ? 'seen by a text' : outcome
      outcomes.set(kind, (outcomes.get(kind) ?? 0) + 1)
    }
  }
  console.log(`1. ${changes} copies of the tables with one entry changed: ${[...outcomes].map(([kind, count]) => `${count} ${kind}`).join(', ')}.`)
  const seen = (outcomes.get('refused by tables.ts') ?? 0) + (outcomes.get('seen by a text') ?? 0)
  if (seen < 10) problem(`only ${seen} changes were seen`)
}

// 2. Every entry of the scanner's tables that a text reads.
{
  const scannerNext = Int16Array.from(tables.scannerNext), scannerKindOfState = Int32Array.from(tables.scannerKindOfState), scannerClassOfByte = Uint8Array.from(tables.scannerClassOfByte)
  const changed: Tables = {...tables, scannerNext, scannerKindOfState, scannerClassOfByte}
  const scannerExpected = expected.get(scanner.group)!
  const {scannerClassCount} = tables
  // Whether the changed scanner cuts one of the given texts of the scanner's group differently than the C program.
  const seenBy = (textPlaces: Iterable<number>): boolean => {
    for (const place of textPlaces) {
      let line: string
      try {
        line = scannerLine(scan(scanner.group.texts[place]!, changed))
      } catch {
        return true
      }
      if (line !== scannerExpected[place]!.scanner) return true
    }
    return false
  }
  const endings = Array.from({length: scanner.endingCount}, (_, ending) => ending)
  const firstCodePointOfClass = new Int32Array(scannerClassCount).fill(-1)
  for (let codePoint = 0x80; codePoint >= 0; codePoint--) firstCodePointOfClass[tables.scannerClassOfByte[codePoint]!] = codePoint
  let moves = 0, movesAlike = 0, kinds = 0, classes = 0, classesAlike = 0
  for (const [stateIndex, state] of scanner.reachableStates.entries()) {
    for (let characterClass = 1; characterClass < scannerClassCount; characterClass++) {
      const codePoint = firstCodePointOfClass[characterClass]!
      if (codePoint === -1) throw new Error(`no code point has the class ${characterClass}`)
      const cell = state * scannerClassCount + characterClass
      const before = tables.scannerNext[cell]!
      // To "the token ends", and to every reachable state.
      for (const to of [0, ...scanner.reachableStates]) {
        if (to === before || (to === 0 && before <= 0)) continue
        scannerNext[cell] = to
        moves++
        if (!seenBy(endings.map(ending => scanner.textAt(stateIndex, codePoint, ending)))) {
          if (scannersCutAlike(tables, changed)) movesAlike++
          else problem(`the scanner's move (state ${state}, class ${characterClass}) changed from ${before} to ${to}: no text differs, and some text is cut differently`)
        }
        scannerNext[cell] = before
      }
    }
    if (state === tables.scannerStart) continue
    // The kind of the token that ends in the state: every other kind that a state has.
    for (const to of new Set(tables.scannerKindOfState)) {
      if (to === tables.scannerKindOfState[state]) continue
      scannerKindOfState[state] = to
      kinds++
      if (!seenBy([stateIndex * (1 + 0x81 * scanner.endingCount)])) problem(`the kind of the scanner's state ${state} changed to ${to}: no text differs`)
      scannerKindOfState[state] = tables.scannerKindOfState[state]!
    }
  }
  for (let codePoint = 0; codePoint <= 0x80; codePoint++) {
    for (let to = 1; to < scannerClassCount; to++) {
      if (to === tables.scannerClassOfByte[codePoint]) continue
      scannerClassOfByte[codePoint] = to
      classes++
      const textPlaces = function* () {
        for (let stateIndex = 0; stateIndex < scanner.reachableStates.length; stateIndex++) for (const ending of endings) yield scanner.textAt(stateIndex, codePoint, ending)
      }
      if (!seenBy(textPlaces())) {
        if (scannersCutAlike(tables, changed)) classesAlike++
        else problem(`the class of the code point ${codePoint} changed to ${to}: no text differs, and some text is cut differently`)
      }
      scannerClassOfByte[codePoint] = tables.scannerClassOfByte[codePoint]!
    }
  }
  console.log(`2. The scanner: ${moves} changed moves, of which ${movesAlike} cut every text as before and a text sees the other ${moves - movesAlike}; ${kinds} changed kinds, all seen; ${classes} changed classes of a code point, of which ${classesAlike} cut every text as before and a text sees the other ${classes - classesAlike}.`)
}

// 3. The parser's cells and gotos.
{
  const actionKind = Uint8Array.from(tables.actionKind), actionArgument = Int16Array.from(tables.actionArgument), gotoState = Int16Array.from(tables.gotoState)
  const changed: Tables = {...tables, actionKind, actionArgument, gotoState}
  const cellExpected = expected.get(cells.group)!
  const differs = (textPlace: number): boolean => {
    const ours = linesOf(cells.group.texts[textPlace]!, changed)
    return ours.parser !== cellExpected[textPlace]!.parser
  }
  let cellChanges = 0, cellsChanged = 0, gotoChanges = 0
  for (let state = 0; state < stateCount; state++) {
    for (const terminal of tables.textTerminals) {
      const cell = state * terminalCount + terminal
      const textPlace = cells.textOfCell[cell]!
      if (textPlace === -1) continue
      cellsChanged++
      const random = createRandom(20261017, cell)
      const kindBefore = tables.actionKind[cell]!, argumentBefore = tables.actionArgument[cell]!
      const others: [kind: number, argument: number][] = [[actionError, 0], [actionAccept, 0], [actionShift, random.integer(0, stateCount - 1)], [actionReduce, random.integer(1, ruleCount - 1)], [actionReduce, random.integer(1, ruleCount - 1)]]
      for (const [kind, argument] of random.shuffled(others.filter(([kind, argument]) => kind !== kindBefore || ((kind === actionShift || kind === actionReduce) && argument !== argumentBefore))).slice(0, 3)) {
        actionKind[cell] = kind
        actionArgument[cell] = argument
        cellChanges++
        if (!differs(textPlace)) problem(`the cell ${cellText(cell)} changed to the action ${kind} with ${argument}: the steps of its text do not differ`)
      }
      actionKind[cell] = kindBefore
      actionArgument[cell] = argumentBefore
    }
  }
  let gotosWithoutText = 0
  for (let pair = 0; pair < gotoState.length; pair++) {
    const before = tables.gotoState[pair]!
    if (before === -1) continue
    if (textOfGoto[pair] === -1) {
      gotosWithoutText++
      continue
    }
    const random = createRandom(20261018, pair)
    for (let draw = 0; draw < 2; draw++) {
      const to = random.pick(Array.from({length: stateCount}, (_, state) => state).filter(state => state !== before))
      gotoState[pair] = to
      gotoChanges++
      if (!differs(textOfGoto[pair]!)) problem(`the goto ${pair} changed from ${before} to ${to}: the steps of its text do not differ`)
    }
    gotoState[pair] = before
  }
  if (gotosWithoutText > 0) problem(`${gotosWithoutText} gotos are taken by no text of the cells' group`)
  console.log(`3. The parser: ${cellChanges} changed actions in the ${cellsChanged} cells that a text reads, and ${gotoChanges} changed gotos, all seen in the steps of the cell's text.`)
}

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
