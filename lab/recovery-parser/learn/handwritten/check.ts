// Checks the hand-written recovery on the train and validation splits, and lists what a person would read next:
//
// - The tables keep the ground rules (checkTables), and the parser's trace before a first error is today's.
// - How often the parser reads an open cell that no rule set, per cell. Such a cell still holds today's choice, e.g.
//   the grammar state `error`, so a cell that is read often is a rule that is missing.
// - How many code points are read in the grammar state `error`, to which the rules give a meaning.
// - Per rule, how many samples read one of its cells from the first error on. A rule that no sample reads is there
//   for completeness only.
// - On valid JSON texts of 17 to 19 levels, which today's parser reports as too deep and whose depth it still has
//   right at every code point: the hand-written tables must not have more wrong depths, on texts with nothing after
//   their nested containers and on texts with members after them. The dataset has no such text, so no score sees
//   them, see ../check-deep.ts.
//
// Run from the repo root: bun lab/recovery-parser/learn/handwritten/check.ts [--scratch <folder>] [--to 60000]
import {deepTexts, deepTextsWithMembersAfter, depthsOnDeepTexts} from '../check-deep.ts'
import {cacheFolderOf, loadSamples, optionOf, refuseUnknownOptions, standardRange} from '../data.ts'
import {createTrace} from '../recovery-parser.ts'
import {asIsTables, grammarCellName, grammarChoiceName, lexerCellName, lexerChoiceName} from '../recovery-tables.ts'
import {runOnSample} from '../score.ts'
import {handwrittenTables, rules} from './rules.ts'

if (import.meta.main) {
  refuseUnknownOptions('handwritten/check.ts', ['--scratch', '--to'])
  const handwritten = handwrittenTables()
  const {tables} = handwritten
  const asIs = asIsTables()
  const samples = loadSamples(standardRange.seed, standardRange.from, Number(optionOf('--to') ?? standardRange.to), cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH']))
  const trace = createTrace()
  const traceAsIs = createTrace()
  const lexerReads = new Int32Array(tables.lexerNext.length)
  const grammarReads = new Int32Array(tables.grammarNext.length)
  const samplesOfRule = rules.map(() => 0)
  const seenRule = new Int32Array(rules.length).fill(-1)
  let texts = 0
  let codePointsInError = 0
  let samplesInError = 0
  let differencesBeforeError = 0
  let codePointsFromError = 0
  // The loaded samples are the ones of the train and validation splits: the test split is never loaded.
  for (let place = 0; place < samples.sampleCount; place++) {
    texts++
    const length = samples.start[place + 1]! - samples.start[place]!
    runOnSample(trace, samples, place, tables, true)
    runOnSample(traceAsIs, samples, place, asIs, true)
    if (trace.firstErrorPosition !== traceAsIs.firstErrorPosition || trace.firstErrorKind !== traceAsIs.firstErrorKind) differencesBeforeError++
    const firstError = trace.firstErrorPosition === -1 ? length : Math.min(trace.firstErrorPosition, length)
    for (let position = 0; position < firstError; position++) {
      if (trace.displayKind[position] !== traceAsIs.displayKind[position] || trace.depthAfter[position] !== traceAsIs.depthAfter[position] || trace.containerAfter[position] !== traceAsIs.containerAfter[position]
        || trace.grammarAfter[position] !== traceAsIs.grammarAfter[position] || trace.lexerStateAfter[position] !== traceAsIs.lexerStateAfter[position]) differencesBeforeError++
    }
    let inError = false
    for (let position = firstError; position < length; position++) {
      codePointsFromError++
      const lexerCell = trace.lexerCell[position]!
      const grammarCell = trace.grammarCell[position]!
      for (const rule of [handwritten.ruleOfLexerCell[lexerCell]!, handwritten.ruleOfGrammarCell[grammarCell]!]) {
        if (rule !== -1 && seenRule[rule] !== place) {
          seenRule[rule] = place
          samplesOfRule[rule]!++
        }
      }
      if (tables.lexerOpen[lexerCell] === 1 && handwritten.ruleOfLexerCell[lexerCell] === -1) lexerReads[lexerCell]!++
      // A cell of the token `none` that keeps the grammar state is what every rule wants of white space and of a
      // token's later characters, so it is not counted.
      const keepsState = trace.token[position] === 0 && tables.grammarNext[grammarCell] === trace.grammarBefore[position]
      if (tables.grammarOpen[grammarCell] === 1 && handwritten.ruleOfGrammarCell[grammarCell] === -1 && !keepsState) grammarReads[grammarCell]!++
      if (trace.grammarBefore[position] === tables.errorState) {
        codePointsInError++
        inError = true
      }
    }
    if (inError) samplesInError++
  }
  console.log(`${texts} texts of the train and validation splits, ${codePointsFromError} code points at or after a first error.`)
  console.log(`Before the first error, and in the first error's position and kind: ${differencesBeforeError} differences from today's parser (must be 0).`)
  console.log(`Code points read in the grammar state error: ${codePointsInError}, in ${samplesInError} samples.`)
  const unset = [
    ...Array.from(lexerReads, (reads, cell) => ({reads, name: `tokenizer ${lexerCellName(tables, cell)} -> ${lexerChoiceName(tables, cell)}`})),
    ...Array.from(grammarReads, (reads, cell) => ({reads, name: `grammar   ${grammarCellName(tables, cell)} -> ${grammarChoiceName(tables, cell)}`})),
  ].filter(entry => entry.reads > 0).sort((left, right) => right.reads - left.reads)
  console.log(`Open cells that no rule set and that a code point reads: ${unset.length}.`)
  for (const entry of unset.slice(0, 60)) console.log(`${String(entry.reads).padStart(8)}  ${entry.name}`)
  console.log('')
  console.log('Samples that read a cell of each rule, from the first error on:')
  rules.forEach((rule, index) => console.log(`${String(samplesOfRule[index]).padStart(8)}  ${rule.name}`))
  console.log('')
  const tooDeep = deepTexts(300)
  const deepAsIs = depthsOnDeepTexts(asIs, tooDeep)
  const deep = depthsOnDeepTexts(tables, tooDeep)
  console.log(`${deep.texts} valid JSON texts of 17 to 19 levels with nothing after their nested containers, ${deep.fromFirstError} code points at or after the first error: the depth is wrong at ${deep.depthWrong} of them (the parser as it is: ${deepAsIs.depthWrong}, and it must not be more), the container at ${deep.containerWrong} (the parser as it is: ${deepAsIs.containerWrong}).`)
  const tooDeepWithMembersAfter = deepTextsWithMembersAfter(300)
  const deepAfterAsIs = depthsOnDeepTexts(asIs, tooDeepWithMembersAfter)
  const deepAfter = depthsOnDeepTexts(tables, tooDeepWithMembersAfter)
  console.log(`${deepAfter.texts} such texts with members after their nested containers, ${deepAfter.fromFirstError} code points at or after the first error: the depth is wrong at ${deepAfter.depthWrong} of them (the parser as it is: ${deepAfterAsIs.depthWrong}, and it must not be more), the container at ${deepAfter.containerWrong} (the parser as it is: ${deepAfterAsIs.containerWrong}).`)
  const failed = differencesBeforeError > 0 || deep.depthWrong > deepAsIs.depthWrong || deepAfter.depthWrong > deepAfterAsIs.depthWrong
  console.log(failed ? 'The check FAILED.' : 'Every check passed.')
  if (failed) process.exitCode = 1
}
