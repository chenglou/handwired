// Checks of the bar "yacc error productions", and of the forms of the bar that the final table can show next to
// it, see YaccForm of yacc-parser.ts: the grammar without the rule for a missing local `let`, and the stack read
// without `error` as a symbol above its expression.
//
// 1. tables.json is what bison 2.3 makes of miniml-errors.y today, tables-without-in-rule.json is what it makes of
//    the grammar without the rule `expr error IN expr`, and bison reports nothing.
// 2. The port is bison's parser: runYacc takes the steps of the generated C code, read from its debug output, on
//    the broken texts of 10,000 train and 5,000 validation samples, on the author's own broken programs, on valid
//    programs, and on 4,000 texts of random tokens, which go through recoveries that the samples rarely meet.
// 3. Valid programs are read as the base parser reads them. This automaton and the base grammar's are walked side
//    by side along the same symbols: in every pair of states that a valid program can be in, the parser does what
//    the base parser does for every terminal that the base parser has an action for. So the conflicts are all
//    settled the way the base grammar goes, and the same holds for every text up to its first error.
// 4. On 5,000 valid programs the bar gives the labels exactly: the display kind, the depth, the container and the
//    stack's hash of every code point, and the same reductions over the same tokens, with no call of yyerror.
// 5. On the 15,000 samples the bar shows every token before the first error as the parser as it is shows it.
// 6. The depth, the container and the hash that runYacc keeps next to its stack are the functions of
//    ../../../labels.ts of the symbols that the stack counts as, at every token of 3,000 samples.
// 7. display-kinds.json is what the count gives on the 40,000 train samples, and every entry of errorStandsFor,
//    rulesWithErrorAboveItsExpression and symbolCountsAs names a rule of the grammar.
// 8. What the bar returns has the shape that the scorer reads.
// Checks 2 and 3 run once per grammar, and checks 4, 5, 6 and 8 once per form.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/learn/bars/yacc/check.ts
// It takes about a minute and a half. Without bison 2.3, flex 2.6.4 and cc, checks 1 and 2 are passed over with a
// notice.
import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {defaultSeed, loadSamples, programAt, trainSampleCount} from '../../../dataset.ts'
import {scratchFolder, toolsProblem} from '../../../grammar/build.ts'
import {containerOfSymbols, depthOfSymbols, displayKind, kindOfTerminal, stackHashOfSymbols} from '../../../labels.ts'
import {type Tokens, codePointsOf, scan} from '../../../parser.ts'
import {createRandom} from '../../../random.ts'
import type {Sample} from '../../../sample.ts'
import {actionAccept, actionReduce, actionShift, commentKind, isTrivia, ruleText, stateText, symbolOf, tables as base} from '../../../tables.ts'
import {eachSample} from '../../data.ts'
import {runRecoveryParserOnTokens} from '../../recovery-parser.ts'
import {baseTables} from '../../recovery-tables.ts'
import {displayByCount, displayPath, displayToText, yaccBarOf} from './bar.ts'
import {type Tools, buildCommittedTools, buildToolsWithoutInRule, tablesPath, tablesWithoutInRulePath} from './build.ts'
import {ownSamples, writtenSamples} from './own-programs.ts'
import {type YaccForm, type YaccTables, errorStandsFor, formOfTheBar, nameOfForm, rulesWithErrorAboveItsExpression, runYacc, shownNotRead, shownShifted, symbolCountsAs, yaccLine, yaccTables, yaccTablesOf} from './yacc-parser.ts'

const problems: string[] = []
const problem = (text: string) => {
  if (problems.length < 30) console.log(`PROBLEM: ${text}`)
  problems.push(text)
}

const train = loadSamples('train', defaultSeed, 10_000), validation = loadSamples('validation', defaultSeed, 5_000)
const samples = [...train, ...validation]
const own = [...ownSamples(100), ...writtenSamples()]
const validPrograms = Array.from({length: 5000}, (_, index) => programAt(defaultSeed, index))

// 1 and 2: the tools, for one grammar.
const toolsMissing = toolsProblem()
if (toolsMissing !== undefined) console.log(`NOTICE: ${toolsMissing}, so the two files of tables are not built again and the port is not compared with the generated C code.`)
function checkTools(grammar: string, tables: YaccTables, tools: Tools, committedPath: string, folderName: string) {
  if (readFileSync(committedPath, 'utf8') !== tools.tablesText) problem(`${committedPath} is not what bison makes of ${grammar}: run build.ts`)
  else console.log(`${committedPath.split('/').at(-1)} is what bison 2.3 makes of ${grammar}, and bison reports nothing.`)

  // Texts of random tokens: 5 to 60 tokens, each a word, a sign or a bracket of the language, or text that is no
  // token, with one space between them.
  const words = ['let', 'rec', 'in', 'if', 'then', 'else', 'fun', 'true', 'false', 'x', 'f', '_', '1', '"s"', '->', '=', '<>', '<', '+', '-', '*', '::', '&&', '||', '^', '(', ')', '[', ']', ',', ';', '#', '"open', '\n']
  const randomTexts = Array.from({length: 4000}, (_, index) => {
    const random = createRandom(977, index)
    // Half of the texts start as a program does, so that the recovery is met inside a definition too.
    const start = random.chance(0.5) ? 'let f x = ' : ''
    return start + Array.from({length: random.integer(5, 60)}, () => random.pick(words)).join(' ')
  })
  const texts: {codePoints: ArrayLike<number>, tokens: Tokens, text: string}[] = [
    ...[...samples, ...own].map(sample => ({codePoints: sample.codePoints, tokens: sample.tokens, text: sample.broken})),
    ...validPrograms.slice(0, 2000).map(({text, labels}) => ({codePoints: labels.codePoints, tokens: labels.tokens, text})),
    ...randomTexts.map(text => {
      const codePoints = codePointsOf(text)
      return {codePoints, tokens: scan(codePoints), text}
    }),
  ]
  const records: Uint8Array[] = []
  for (const {codePoints} of texts) {
    // The scanner reads a code point from U+0080 up as the byte 0x80, see ../../../parser.ts.
    const bytes = Uint8Array.from(codePoints, codePoint => codePoint < 0x80 ? codePoint : 0x80)
    const header = new Uint8Array(4)
    new DataView(header.buffer).setUint32(0, bytes.length, true)
    records.push(header, bytes)
  }
  const folder = join(scratchFolder(), folderName)
  const inputPath = join(folder, 'check-input.bin'), outputPath = join(folder, 'check-output.txt')
  writeFileSync(inputPath, Buffer.concat(records))
  const child = Bun.spawnSync([tools.driverPath, 'run', inputPath, outputPath], {stdout: 'pipe', stderr: 'pipe'})
  if (child.exitCode !== 0) throw new Error(`the driver failed: ${child.stderr.toString()}`)
  const lines = readFileSync(outputPath, 'utf8').split('\n')
  let different = 0, steps = 0, recoveries = 0, discarded = 0, givenUp = 0
  texts.forEach(({codePoints, tokens, text}, index) => {
    const line = yaccLine(tokens, codePoints.length, tables)
    // yyparse only gives up at the end of input: `definitions: definitions error` keeps a state on the stack that
    // shifts `error`. So it reads every token of every text.
    if (runYacc(tokens, tables).shown.includes(shownNotRead)) problem(`yyparse gives up before the end of ${JSON.stringify(text).slice(0, 200)}`)
    steps += line.split(' ').length - 2
    recoveries += line.split(' S:error').length - 1
    discarded += line.split(' D:').length - 1
    if (line.endsWith('=1')) givenUp++
    if (line !== lines[index] && different++ < 3) problem(`the port and the generated C code take other steps on ${JSON.stringify(text).slice(0, 200)}\n  C code: ${lines[index]}\n  port:   ${line}`)
  })
  if (different > 3) problem(`${different} texts with other steps than the generated C code`)
  console.log(`The port takes the steps of the generated C code on ${texts.length} texts: ${samples.length} samples of the dataset, ${own.length} broken programs of the author, 2000 valid programs and ${randomTexts.length} texts of random tokens. ${steps} steps, with ${recoveries} shifts of error and ${discarded} discarded tokens. yyparse gives up in ${givenUp} texts, each at the end of input.`)
}

// 3: the two automata side by side, for one grammar.
function checkAutomaton(tables: YaccTables) {
  const {automaton} = tables
  const inBase = (symbol: number): number => symbolOf(automaton.symbolNames[symbol] === 'local_binding' ? 'binding' : automaton.symbolNames[symbol]!)
  const seenPairs = new Set<number>([automaton.startState * base.stateCount + base.startState])
  const pendingPairs: [state: number, baseState: number][] = [[automaton.startState, base.startState]]
  let cellsCompared = 0
  const baseStatesSeen = new Set<number>()
  while (pendingPairs.length > 0) {
    const [state, baseState] = pendingPairs.pop()!
    baseStatesSeen.add(baseState)
    for (const terminal of base.textTerminals) {
      const baseCell = baseState * base.terminalCount + terminal, cell = state * automaton.terminalCount + terminal
      if (base.frozen[baseCell] === 0) continue
      const kind = automaton.actionKind[cell]!, argument = automaton.actionArgument[cell]!
      if (base.actionKind[baseCell] === actionReduce) {
        // A terminal that this grammar's own lookahead set of the rule leaves out cannot follow here in a valid
        // program: the binding of a definition at the top is a state of its own in this automaton, and no `in`
        // follows it.
        const sameRule = automaton.completeRules[state]!.find(rule => tables.ruleInBase[rule] === base.actionArgument[baseCell])
        if (sameRule !== undefined && automaton.lookahead[(state * automaton.ruleCount + sameRule) * automaton.terminalCount + terminal] === 0) continue
      }
      cellsCompared++
      const same = base.actionKind[baseCell] === actionShift ? kind === actionShift
        : base.actionKind[baseCell] === actionAccept ? kind === actionAccept
        : kind === actionReduce && tables.ruleInBase[argument] === base.actionArgument[baseCell]
      if (!same) problem(`${stateText(state, automaton).slice(0, 160)} at ${base.symbolNames[terminal]}: the base parser ${base.actionKind[baseCell] === actionShift ? 'shifts' : `reduces by ${ruleText(base.actionArgument[baseCell]!)}`}, and this parser ${kind === actionShift ? 'shifts' : kind === actionReduce ? `reduces by ${ruleText(argument, -1, automaton)}` : 'has no action'}`)
    }
    for (let symbol = 0; symbol < automaton.symbolCount; symbol++) {
      const target = automaton.transition[state * automaton.symbolCount + symbol]!
      if (symbol === tables.errorSymbol || target === -1) continue
      const baseTarget = base.transition[baseState * base.symbolCount + inBase(symbol)]!
      if (baseTarget === -1 || seenPairs.has(target * base.stateCount + baseTarget)) continue
      seenPairs.add(target * base.stateCount + baseTarget)
      pendingPairs.push([target, baseTarget])
    }
  }
  if (baseStatesSeen.size !== base.stateCount) problem(`the walk reaches ${baseStatesSeen.size} of the base grammar's ${base.stateCount} states`)
  console.log(`The automaton's ${automaton.stateCount} states and the base grammar's ${base.stateCount}, side by side: ${seenPairs.size} pairs of states that a valid program can be in, and in ${cellsCompared} cells of them the parser does what the base parser does.`)
}

const tablesAsItIs = baseTables()
// 4, 5, 6 and 8, for one form of the bar.
function checkForm(form: YaccForm) {
  const tables = yaccTablesOf(form), parse = yaccBarOf(form)
  // 4: valid programs.
  let wrongPrograms = 0, validCodePoints = 0
  for (const {text, labels} of validPrograms) {
    const run = runYacc(labels.tokens, tables)
    let wrong = run.result !== 0 || run.errorsReported !== 0 || run.errorsShifted !== 0 || run.reductions.length !== labels.reductionCount
    for (let token = 0; token < labels.tokens.count && !wrong; token++) {
      const terminal = labels.tokens.kind[token]!, place = labels.tokens.start[token]!
      validCodePoints += labels.tokens.length[token]!
      if (!isTrivia(terminal) && (run.shown[token] !== shownShifted || tables.reachedByValid[run.state[token]!] !== 1)) wrong = true
      const kind = isTrivia(terminal) ? (terminal === commentKind ? displayKind.comment : displayKind.whitespace) : kindOfTerminal(terminal, run.symbolBelow[token]!)
      if (kind !== labels.kind[place] || run.depth[token] !== labels.depth[place] || run.container[token] !== labels.container[place] || run.stack[token] !== labels.stack[place]) wrong = true
    }
    run.reductions.forEach((reduction, at) => {
      if (tables.ruleInBase[reduction.rule] !== labels.reductionRule[at] || reduction.firstToken !== labels.reductionFirstToken[at] || reduction.lastToken !== labels.reductionLastToken[at]) wrong = true
    })
    if (wrong && wrongPrograms++ < 3) problem(`the valid program ${JSON.stringify(text).slice(0, 120)} does not get its labels and reductions`)
  }
  console.log(`${validPrograms.length} valid programs with ${validCodePoints} code points: ${validPrograms.length - wrongPrograms} get exactly their labels, their stack's hashes and their reductions, with no call of yyerror.`)

  // 5: before the first error, the parser as it is.
  let tokensBefore = 0, wrongBefore = 0
  const outputs = new Map<Sample, ReturnType<typeof parse>>()
  for (const sample of samples) {
    const output = parse(sample)
    outputs.set(sample, output)
    const asItIs = runRecoveryParserOnTokens(sample.codePoints, sample.tokens, tablesAsItIs)
    for (let token = 0; token < sample.firstErrorToken; token++) {
      tokensBefore++
      if (output.kind[token] !== asItIs.kind[token] || output.depth[token] !== asItIs.depth[token] || output.container[token] !== asItIs.container[token] || output.stack[token] !== asItIs.stack[token]) {
        if (wrongBefore++ < 3) problem(`sample ${sample.id}: token ${token} stands before the first error and is not shown as the parser as it is shows it`)
      }
    }
  }
  console.log(`${samples.length} samples: of the ${tokensBefore} tokens before a first error, ${tokensBefore - wrongBefore} are shown as the parser as it is shows them.`)

  // 6: the values that the run keeps next to its stack, derived a second way.
  let tokensRederived = 0, wrongRederived = 0
  for (const sample of samples.slice(0, 3000)) {
    const symbolsAt = new Map<number, number[]>()
    const run = runYacc(sample.tokens, tables, {shown: (token, states) => { symbolsAt.set(token, states.flatMap(state => tables.symbolsOfState[state]!)) }})
    for (const [token, symbols] of symbolsAt) {
      tokensRederived++
      if (run.depth[token] !== depthOfSymbols(symbols) || run.container[token] !== containerOfSymbols(symbols) || run.stack[token] !== stackHashOfSymbols(symbols)) wrongRederived++
    }
  }
  if (wrongRederived > 0) problem(`${wrongRederived} tokens whose depth, container or hash is not that of the stack's symbols`)
  console.log(`3000 samples: at ${tokensRederived} shifted and discarded tokens the depth, the container and the hash are those of the symbols that the stack counts as.`)

  // 8: the shape of the output.
  let wrongShape = 0
  for (const sample of samples) {
    const output = outputs.get(sample)!
    const {count} = sample.tokens
    let wrong = output.kind.length !== count || output.depth.length !== count || output.container.length !== count || output.stack.length !== count || output.taken.length !== count || output.insertedTokens < 0
    for (let token = 0; token < count && !wrong; token++) {
      if (output.kind[token]! < 0 || output.kind[token]! > displayKind.error || output.depth[token]! < 0 || output.container[token]! < 0) wrong = true
      if (isTrivia(sample.tokens.kind[token]!) && output.taken[token] === 1) wrong = true
    }
    for (const {firstToken, lastToken, nonterminal} of output.reductions) {
      if (firstToken > lastToken || firstToken < -1 || lastToken >= count || (firstToken === -1) !== (lastToken === -1) || nonterminal < base.terminalCount || nonterminal >= base.symbolCount) wrong = true
    }
    if (wrong && wrongShape++ < 3) problem(`sample ${sample.id}: the output of the bar has not the shape that the scorer reads`)
  }
  console.log(`${samples.length} samples: the output of the bar has the shape that the scorer reads.`)
}

const withoutInRule: YaccForm = {...formOfTheBar, inRule: false}
for (const [grammar, form, build, committedPath, folderName] of [
  ['miniml-errors.y', formOfTheBar, buildCommittedTools, tablesPath, 'yacc-tools'],
  ['miniml-errors.y without the rule `expr error IN expr`', withoutInRule, buildToolsWithoutInRule, tablesWithoutInRulePath, 'yacc-tools-without-in-rule'],
] as const) {
  console.log(`\nThe grammar ${grammar}:`)
  if (toolsMissing === undefined) checkTools(grammar, yaccTablesOf(form), build(), committedPath, folderName)
  checkAutomaton(yaccTablesOf(form))
}
for (const form of [formOfTheBar, withoutInRule, {...formOfTheBar, errorAboveItsExpression: false}, {inRule: false, errorAboveItsExpression: false}]) {
  console.log(`\nThe form "${nameOfForm(form)}":`)
  checkForm(form)
}

// 7: the count, and the tables of yacc-parser.ts.
console.log('')
const recounted = displayToText(displayByCount(eachSample('train', trainSampleCount)), trainSampleCount)
if (recounted !== readFileSync(displayPath, 'utf8')) problem('display-kinds.json is not what the count gives on the train samples: run bar.ts --write')
else console.log(`display-kinds.json is what the count gives on the ${trainSampleCount} train samples.`)
const {automaton} = yaccTables
const rulesOfGrammar = new Set(Array.from({length: automaton.ruleCount}, (_, rule) => ruleText(rule, -1, automaton)))
for (const rule of [...Object.keys(errorStandsFor), ...rulesWithErrorAboveItsExpression, ...Object.keys(symbolCountsAs)]) if (!rulesOfGrammar.has(rule)) problem(`yacc-parser.ts names the rule "${rule}", which the grammar does not have`)

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
