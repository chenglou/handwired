// What has to hold for the hand-written rules and their saved tables:
// 1. The two added terminals are the ones that the rule of ../../picked-terminals.ts picks from the train samples.
// 2. The saved tables are the rules as they are now, with the count on the 40,000 train samples.
// 3. A valid program gets its labels exactly: the run reads no open cell, and every token is shown with the
//    display kind, the depth and the container of ../../../labels.ts.
// 4. On the train and validation samples: nothing before the first error differs from the parser as it is, the
//    first error is the sample's, no run enters the state `stopped` before the end of input, and no run reads an
//    open cell that no rule names.
// 5. The cells of the end of input hold what the parser as it is holds.
// 6. The two routes of bar.ts give the same counts on the validation samples.
// It also prints how many samples read a cell of each rule, and the tokens that were skipped after 16 steps.
//
//   bun lab/recovery-lr/learn/bars/rules/check.ts [--programs 3000] [--train 8000]
import {existsSync} from 'node:fs'
import {defaultSeed, programAt} from '../../../dataset.ts'
import {type Sample} from '../../../sample.ts'
import {eachSample, loadPacked, packSamples} from '../../data.ts'
import {numberOf, refuseUnknownOptions, standardTrainCount, standardValidationCount} from '../../options.ts'
import {terminalsChosenFromTrainSamples} from '../../picked-terminals.ts'
import {runRecoveryParser, runRecoveryParserOnTokens, shownSkippedByStackLimit, shownSkippedByStepLimit} from '../../recovery-parser.ts'
import {cellName, choiceStop, endOfInput, loadTables, stateOfCell, stopped, terminalOfCell} from '../../recovery-tables.ts'
import {scoreOutputs, scoreTables} from '../../score.ts'
import {rulesBar, tablesOfTheBar} from './bar.ts'
import {savedTablesPath, tablesWithCount} from './report.ts'
import {layoutOfTheRecipe, pickedTerminals, rules, tablesOfRules} from './rules.ts'

refuseUnknownOptions('check.ts', ['--programs', '--train'])
const programCount = numberOf('--programs', 3000), trainChecked = numberOf('--train', 8000)
const problems: string[] = []
const problem = (text: string) => {
  if (problems.length < 40) console.log(`PROBLEM: ${text}`)
  problems.push(text)
}

// 1. The added terminals.
const picked = terminalsChosenFromTrainSamples(eachSample('train', standardTrainCount))
if (JSON.stringify(picked) !== JSON.stringify(pickedTerminals)) problem(`the rule picks ${JSON.stringify(picked)} from the train samples, and rules.ts has ${JSON.stringify(pickedTerminals)}`)
console.log(`The rule of picked-terminals.ts picks ${picked.map(terminal => `\`${String.fromCodePoint(terminal.codePoint)}\``).join(' and ')} from the ${standardTrainCount} train samples, as rules.ts has them.`)

const layout = layoutOfTheRecipe()
const packedTrain = loadPacked('train', standardTrainCount, layout)
const validationSamples: Sample[] = [...eachSample('validation', standardValidationCount)]
const trainSamples: Sample[] = [...eachSample('train', trainChecked)]
// Valid programs of both splits, by their indexes.
const programs = Array.from({length: programCount}, (_, index) => programAt(defaultSeed, index))

{
  const {cellsOfRule} = tablesOfRules()
  const namedBy = new Map<number, number>()
  cellsOfRule.forEach((entry, index) => { for (const cell of [...entry.set, ...entry.asItIs]) namedBy.set(cell, index) })

  // 2. The saved tables.
  const path = savedTablesPath
  if (!existsSync(path)) problem(`${path} is missing: run report.ts --save`)
  else {
    const saved = loadTables(path).tables
    const counted = tablesWithCount(packedTrain)
    const sameChoices = saved.choice.length === counted.choice.length && saved.choice.every((choice, cell) => choice === counted.choice[cell])
    const sameDisplay = saved.display.length === counted.display.length && saved.display.every((kind, entry) => kind === counted.display[entry])
    if (!sameChoices || !sameDisplay) problem(`${path} does not hold the rules as they are now with the count on the train samples: run report.ts --save`)
    else console.log(`- ${path} holds the rules as they are now, with the count on the ${standardTrainCount} train samples.`)
  }
  const tables = tablesOfTheBar()

  // 5. The cells of the end of input.
  let endCells = 0
  for (let cell = 0; cell < tables.choice.length; cell++) {
    if (tables.open[cell] !== 1 || terminalOfCell(tables, cell) !== endOfInput) continue
    endCells++
    if (tables.choice[cell] !== layout.choice[cell]) problem(`the cell ${cellName(tables, cell)} of the end of input holds another choice than the parser as it is`)
  }
  console.log(`- The ${endCells} open cells of the end of input, in both copies, hold what the parser as it is holds.`)

  // 3. Valid programs.
  let validTokens = 0
  for (const {text, labels} of programs) {
    const run = runRecoveryParser(text, tables)
    if (!run.valid || run.cellsRead.length > 0) problem(`a valid program is not valid for the bar, or reads an open cell: ${JSON.stringify(text.slice(0, 60))}`)
    for (let token = 0; token < labels.tokens.count; token++) {
      validTokens++
      for (let place = labels.tokens.start[token]!; place < labels.tokens.start[token]! + labels.tokens.length[token]!; place++) {
        if (run.kind[token] !== labels.kind[place] || run.depth[token] !== labels.depth[place] || run.container[token] !== labels.container[place]) {
          problem(`a valid program has another label at code point ${place}: ${JSON.stringify(text.slice(0, 60))}`)
          break
        }
      }
    }
  }
  console.log(`- ${programs.length} valid programs with ${validTokens} tokens: each is valid for the bar, reads no open cell, and has the display kind, the depth and the container of the labels at every code point.`)

  // 4. Broken samples.
  const samplesOfRule = new Array<number>(rules.length).fill(0)
  let tokensAfterStepLimit = 0, tokensAtStackLimit = 0, runsThatStop = 0, readsOfUnnamedCells = 0, tokensFromFirstError = 0
  const base = layout
  for (const sample of [...trainSamples, ...validationSamples]) {
    const run = runRecoveryParserOnTokens(sample.codePoints, sample.tokens, tables)
    const asItIs = runRecoveryParserOnTokens(sample.codePoints, sample.tokens, base)
    if (run.firstErrorToken !== sample.firstErrorToken || run.valid) problem(`sample ${sample.id}: the first error is at token ${run.firstErrorToken}, and the sample says ${sample.firstErrorToken}`)
    for (let token = 0; token < sample.firstErrorToken; token++) {
      if (run.kind[token] !== asItIs.kind[token] || run.depth[token] !== asItIs.depth[token] || run.container[token] !== asItIs.container[token] || run.stack[token] !== asItIs.stack[token]) {
        problem(`sample ${sample.id}: token ${token}, before the first error, is shown otherwise than by the parser as it is`)
        break
      }
    }
    const rulesRead = new Set<number>()
    let cellsThatStop = 0
    for (const [read, cell] of run.cellsRead.entries()) {
      const rule = namedBy.get(cell)
      const atEnd = run.cellsReadAtToken[read] === sample.tokens.count
      if (rule !== undefined) rulesRead.add(rule)
      else if (!atEnd && stateOfCell(tables, cell) !== stopped) readsOfUnnamedCells++
      if (!atEnd && (tables.choice[cell] === choiceStop || stateOfCell(tables, cell) === stopped)) cellsThatStop++
    }
    if (cellsThatStop > 0) runsThatStop++
    for (const rule of rulesRead) samplesOfRule[rule]!++
    for (let token = sample.firstErrorToken; token < sample.tokens.count; token++) {
      if (run.terminal[token] === -1) continue
      tokensFromFirstError++
      if (run.shown[token] === shownSkippedByStepLimit) tokensAfterStepLimit++
      if (run.shown[token] === shownSkippedByStackLimit) tokensAtStackLimit++
    }
  }
  if (runsThatStop > 0) problem(`${runsThatStop} runs enter the state stopped before the end of input`)
  if (readsOfUnnamedCells > 0) problem(`${readsOfUnnamedCells} reads of open cells that no rule names`)
  if (tokensAtStackLimit > 0) problem(`${tokensAtStackLimit} tokens are skipped at the limit of the stack`)
  console.log(`- ${trainSamples.length} train and ${validationSamples.length} validation samples: nothing before the first error differs from the parser as it is, the first error is the sample's, no run enters the state stopped before the end of input, and every open cell that a run reads before the end of input is named by a rule.`)
  console.log(`- Of the ${tokensFromFirstError} tokens from the first error on, ${tokensAfterStepLimit} are skipped after 16 steps (${(100 * tokensAfterStepLimit / tokensFromFirstError).toFixed(3)}%), and none at the limit of the stack.`)
  console.log(`- The samples that read a cell of each rule, of ${trainSamples.length + validationSamples.length}:`)
  rules.forEach((rule, index) => console.log(`    ${String(samplesOfRule[index]).padStart(6)}  ${rule.name}${rule.leftOut === true ? '  (left out of the bar)' : ''}`))

  // 6. The two routes.
  const byOutputs = scoreOutputs(validationSamples, rulesBar())
  const byTables = scoreTables(tables, packSamples(validationSamples, tables)).score
  const differing = (Object.keys(byOutputs) as (keyof typeof byOutputs)[]).filter(key => byOutputs[key] !== byTables[key])
  if (differing.length > 0) problem(`the two routes differ on the validation samples in ${differing.join(', ')}`)
  else console.log(`- rulesBar with scoreOutputs and scoreTables on packed samples give the same ${Object.keys(byOutputs).length} counts on the ${validationSamples.length} validation samples.`)
}
console.log(problems.length === 0 ? '\nEvery check passed.' : `\n${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
