// Checks the tables and the plain scanner and parser against the tools:
// 1. grammar/tables.json is what bison 2.3 and flex 2.6.4 make of miniml.y and miniml.l today.
// 2. Where bison's report prints a lookahead set, the cells in which tables.ts says "a frozen reduction by this
//    rule" are that set.
// 3. On every text below, parser.ts gives the same tokens and the same steps as the generated C code: every token
//    with its place, and from bison's debug output every token read, every state entered, every reduction, the call
//    of yyerror and the result. parser.ts itself throws when the first open cell is not at the token of yyerror.
//    - valid programs, damaged programs, sentences of the grammar, damaged sentences, random texts, texts by hand
//    - a text for every cell of the parser's table that a text can read, a valid program where the cell is frozen
//    - texts that go through every cell of the scanner, with every code point from U+0000 to U+0080
//    - every text of up to 3 code points
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/check-tools.ts
// Without bison 2.3, flex 2.6.4 and cc the check cannot run. It says so and fails, unless --skip-without-tools is
// given, as check-all.ts does.
import {mkdirSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {buildTools, scratchFolder, tablesPath, toolsProblem} from './grammar/build.ts'
import {type Lines, type TextGroup, cellTexts, differingTexts, handTexts, linesOf, programTexts, randomTexts, runDriver, scannerTexts, sentenceTexts, shortTexts} from './reference.ts'
import {actionReduce, tables} from './tables.ts'

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
const folder = join(scratchFolder(), 'check-tools')
mkdirSync(folder, {recursive: true})
const tools = buildTools(folder)

// 1. The committed tables.
if (readFileSync(tablesPath, 'utf8') === tools.tablesText) console.log('grammar/tables.json is what bison 2.3 and flex 2.6.4 make of miniml.y and miniml.l.')
else problem('grammar/tables.json is not what the tools make of miniml.y and miniml.l: run grammar/build.ts and look at the difference')

// 2. The lookahead sets that bison's report prints. A line of a complete item ends with the set, e.g.
//    "   29     | expr PLUS expr .  [$end, LET, IN]". The report prints the sets as they are after the precedence has
//    settled the conflicts, which are the terminals of the frozen reductions.
{
  const report = readFileSync(tools.reportPath, 'utf8')
  const settledAsShift = (report.match(/resolved as shift/g) ?? []).length, settledAsReduce = (report.match(/resolved as reduce/g) ?? []).length, settledAsError = (report.match(/resolved as an error/g) ?? []).length
  const {sizes} = tables
  if (settledAsShift !== sizes.conflictsSettledAsShift || settledAsReduce !== sizes.conflictsSettledAsReduce || settledAsError !== sizes.conflictsSettledAsError) {
    problem(`bison's report settles ${settledAsShift} conflicts as a shift, ${settledAsReduce} as a reduction and ${settledAsError} as an error, and tables.ts counts ${sizes.conflictsSettledAsShift}, ${sizes.conflictsSettledAsReduce} and ${sizes.conflictsSettledAsError}`)
  }
  let state = -1
  let compared = 0, differing = 0
  const statesWithSets = new Set<number>()
  for (const line of report.split('\n')) {
    const header = /^state (\d+)$/.exec(line)
    if (header !== null) {
      state = Number(header[1])
      continue
    }
    const item = /^\s+(\d+) .*\s\.\s+\[(.*)\]$/.exec(line)
    if (item === null || state === -1) continue
    const rule = Number(item[1])
    const printed = item[2]!.split(', ').sort().join(' ')
    const ours = tables.textTerminals
      .filter(terminal => tables.frozen[state * tables.terminalCount + terminal] === 1 && tables.actionKind[state * tables.terminalCount + terminal] === actionReduce && tables.actionArgument[state * tables.terminalCount + terminal] === rule)
      .map(terminal => tables.symbolNames[terminal]!).sort().join(' ')
    compared++
    statesWithSets.add(state)
    if (printed !== ours && differing++ < 3) problem(`state ${state}, rule ${rule}: bison's report has the lookahead set [${printed}] and tables.ts freezes the reductions on [${ours}]`)
  }
  if (compared === 0) problem('bison\'s report has no lookahead set to compare')
  console.log(`bison's report prints the lookahead set of ${compared} complete rules in ${statesWithSets.size} states (of ${tables.sizes.statesWithDefaultRule} states that reduce), and ${compared - differing} are the terminals of the frozen reductions. It settles ${settledAsShift} conflicts as a shift and ${settledAsReduce} as a reduction, as tables.ts counts.`)
}

// 3. The texts.
let texts = 0, events = 0, tokens = 0
function compare(group: TextGroup, expectValid = false): Lines[] {
  const expected = runDriver(tools.driverPath, group, folder)
  const differing = differingTexts(group, expected)
  let valid = 0
  for (const lines of expected) {
    events += lines.parser.split(' ').length - 2
    tokens += lines.scanner === 'L' ? 0 : lines.scanner.split(' ').length - 1
    if (lines.parser.endsWith('=0')) valid++
  }
  texts += group.texts.length
  console.log(`${group.name}: ${group.texts.length} texts, ${valid} valid and ${group.texts.length - valid} with an error by the C program, ${differing.length} differ`)
  for (const index of differing.slice(0, 2)) {
    const ours = linesOf(group.texts[index]!)
    problem(`${group.name}, text ${index} ${JSON.stringify(String.fromCodePoint(...group.texts[index]!).slice(0, 80))}:\n  ours   ${ours.scanner.slice(0, 200)}\n  theirs ${expected[index]!.scanner.slice(0, 200)}\n  ours   ${ours.parser.slice(0, 200)}\n  theirs ${expected[index]!.parser.slice(0, 200)}`)
  }
  if (differing.length > 2) problem(`${group.name}: ${differing.length} texts differ`)
  if (expectValid && valid !== group.texts.length) problem(`${group.name}: the C program rejects ${group.texts.length - valid} texts that are said to be valid`)
  return expected
}

const [programs, damagedPrograms] = programTexts(6000, 2) as [TextGroup, TextGroup]
const [sentences, damagedSentences] = sentenceTexts(3000) as [TextGroup, TextGroup]
compare(programs, true)
compare(damagedPrograms)
compare(sentences, true)
compare(damagedSentences)
compare(randomTexts(3000))
compare(handTexts())
const firstTexts = texts
console.log(`That is ${firstTexts} valid, damaged and random texts: ${tokens} tokens and ${events} events of yyparse.`)

const cells = cellTexts(8, 20_000)
const cellLines = compare(cells.group)
let frozenWithValidText = 0
for (let state = 0; state < tables.stateCount; state++) {
  for (const terminal of tables.textTerminals) {
    const cell = state * tables.terminalCount + terminal
    if (tables.frozen[cell] !== 1) continue
    // The C program has to accept the text of a frozen cell.
    if (cells.validText[cell] === 1 && cellLines[cells.textOfCell[cell]!]!.parser.endsWith('=0')) frozenWithValidText++
  }
}
if (frozenWithValidText !== tables.sizes.frozenCells) problem(`${tables.sizes.frozenCells - frozenWithValidText} frozen cells have no text that the C program accepts`)
else console.log(`Every one of the ${tables.sizes.frozenCells} frozen cells is read by a text that the C program accepts.`)

const scanner = scannerTexts()
compare(scanner.group)
console.log(`The scanner has ${scanner.reachableStates.length} states that a text reaches, of ${tables.scannerStateCount}. ${scanner.distinguishingTexts} texts tell them apart, all but ${scanner.equalPairs} pairs, which no text tells apart.`)
compare(shortTexts(3))

console.log(`${texts} texts in all.`)
console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
