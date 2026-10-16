// Checks the hand-written recovery, and lists what a person would read next:
//
// - The tables keep the ground rules (checkTables): every frozen cell and every display entry that is not open holds
//   what it holds today.
// - The tables fill only what the recipe's training may fill: every kept grammar cell of the recipe holds today's
//   choice, and so does every display entry of the grammar state `error`.
// - Valid documents get today's trace. The check runs the original of every train and validation sample of the
//   standard set, of which the mixed set is made too, and 4,000 valid texts of ../check-texts.ts, among them texts of
//   16 levels and of 512 code points: the tokenizer state, the event, the grammar state, the stack action, the display
//   kind, the depth and the container are today's at all 513 positions, and the text is still valid.
// - Every broken text of both sets gets today's trace before its first error, and today's first error.
// - Valid texts with a value of more than 16 levels, which today's parser reports as too deep: they are shown as today
//   at every code point (differencesOnTooDeepTexts of ../recipe.ts).
// - How often the parser reads an open cell that no rule named, per cell. Such a cell still holds today's choice.
// - How many code points are read in the grammar state `error`, where the parser stays.
// - Per rule, how many samples of the two sets read one of its cells from the first error on.
//
// Run from the repo root: bun lab/recovery-toml/learn/handwritten/check.ts [--tables <file.json>] [--scratch <folder>]
// --tables checks saved tables in the place of the rules' tables: then the lists per rule are left out.
import {validText, validTextOfDepth, validTextOfLength} from '../check-texts.ts'
import {type Samples, allowedSampleAt} from '../data.ts'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {createRandom} from '../random.ts'
import {cellsOfTooDeepValidTexts, differencesOnTooDeepTexts, tooDeepTextsOfTheCheck} from '../recipe.ts'
import {type RecoveryTrace, capacity, codePointsOf, createTrace, maximumDepth, positionCount, runRecoveryParserInto} from '../recovery-parser.ts'
import {type RecoveryTables, asIsTables, checkTables, displayEntryName, displayEntryOf, grammarCellName, grammarChoiceName, grammarStateNames, lexerCellName, lexerChoiceName, loadTablesForReport, today} from '../recovery-tables.ts'
import {runOnSample} from '../score.ts'
import {type Handwritten, baseWith} from './engine.ts'
import {handwrittenTables, rules} from './rules.ts'
import {loadSet, scratchFolderOf, setNames} from './sets.ts'

const traceFields = ['characterClass', 'lexerStateBefore', 'lexerStateAfter', 'event', 'token', 'grammarBefore', 'grammarAfter', 'action', 'displayKind', 'depthAfter', 'containerAfter'] as const

// How many positions of a text differ between two traces, up to `positions`. The class is compared by the class that
// the code point has today, since the tables may have added classes.
function differences(tables: RecoveryTables, trace: RecoveryTrace, expected: RecoveryTrace, positions: number) {
  let count = 0
  for (let position = 0; position < positions; position++) {
    for (const field of traceFields) {
      const got = field === 'characterClass' ? tables.classToday[trace.characterClass[position]!]! : trace[field][position]!
      if (got !== expected[field][position]) {
        count++
        break
      }
    }
  }
  return count
}

if (import.meta.main) {
  refuseUnknownOptions('handwritten/check.ts', ['--tables', '--scratch'])
  const tablesFile = optionOf('--tables')
  const handwritten: Handwritten | undefined = tablesFile === undefined ? handwrittenTables() : undefined
  const tables = handwritten?.tables ?? loadTablesForReport(tablesFile!).tables
  const asIs = asIsTables()
  const failures: string[] = []
  const report = (ok: boolean, line: string) => {
    console.log(`${ok ? 'ok    ' : 'FAILED'}  ${line}`)
    if (!ok) failures.push(line)
  }

  checkTables(tables)
  report(true, 'The tables keep the ground rules: every frozen cell and every display entry that is not open holds today\'s.')

  // What the recipe keeps: its kept grammar cells, and today's kinds in the display entries of the state `error`.
  const base = baseWith(tables.addedClasses)
  const sameLayout = base.grammarNext.length === tables.grammarNext.length && base.display.length === tables.display.length
  const kept = cellsOfTooDeepValidTexts(base)
  let keptChanged = 0
  let keptCount = 0
  if (sameLayout) {
    for (let cell = 0; cell < kept.length; cell++) {
      if (kept[cell] === 0) continue
      keptCount++
      if (tables.grammarNext[cell] !== base.grammarNext[cell] || tables.grammarAction[cell] !== base.grammarAction[cell]) keptChanged++
    }
  }
  let errorEntriesChanged = 0
  for (let event = 0; event < tables.eventCount; event++) {
    if (tables.display[displayEntryOf(tables, event, today.errorState)] !== today.display[event * today.grammarStateCount + today.errorState]) errorEntriesChanged++
  }
  report(sameLayout && keptChanged === 0, `The recipe's ${keptCount} kept grammar cells: ${keptChanged} hold another choice than today's.`)
  report(errorEntriesChanged === 0, `The display entries of the grammar state error: ${errorEntriesChanged} hold another kind than today's.`)

  const trace = createTrace()
  const expected = createTrace()
  // Valid texts of ../check-texts.ts, which the dataset's generators did not make.
  const random = createRandom(20261016, 77)
  const validTexts: string[] = []
  for (let count = 0; count < 3000; count++) validTexts.push(validText(random))
  // A text with members after its nested containers needs two levels at least.
  for (let count = 0; count < 500; count++) {
    const depth = random.integer(1, maximumDepth)
    validTexts.push(validTextOfDepth(random, depth, depth >= 2 && random.chance(0.5)))
  }
  for (let count = 0; count < 500; count++) validTexts.push(validTextOfLength(random, random.integer(capacity - 3, capacity)))
  let validDifferences = 0
  let validNoLongerValid = 0
  let validCodePoints = 0
  for (const text of validTexts) {
    const {codePoints, truncated} = codePointsOf(text)
    runRecoveryParserInto(trace, codePoints, 0, codePoints.length, truncated, tables)
    runRecoveryParserInto(expected, codePoints, 0, codePoints.length, truncated, asIs)
    if (!expected.valid) throw new Error(`a text of the check is not valid: ${JSON.stringify(text)}`)
    if (!trace.valid) validNoLongerValid++
    validDifferences += differences(tables, trace, expected, positionCount)
    validCodePoints += codePoints.length
  }
  report(validDifferences === 0 && validNoLongerValid === 0, `${validTexts.length} valid texts with ${validCodePoints} code points, among them texts of up to 16 levels and of up to 512 code points: ${validDifferences} positions differ from today's trace, ${validNoLongerValid} texts are no longer valid.`)

  // The documents of the dataset: the original of every sample of the standard set that is not in the test split. The
  // mixed set is made of the same documents.
  const neutral = loadSet('neutral', scratchFolderOf(optionOf('--scratch')))
  let documentDifferences = 0
  let documentsNoLongerValid = 0
  for (let place = 0; place < neutral.sampleCount; place++) {
    const sample = allowedSampleAt(neutral.seed, neutral.index[place]!)
    if (sample === undefined) throw new Error('a sample of the standard set is in the test split')
    const {codePoints, truncated} = codePointsOf(sample.original)
    runRecoveryParserInto(trace, codePoints, 0, codePoints.length, truncated, tables)
    runRecoveryParserInto(expected, codePoints, 0, codePoints.length, truncated, asIs)
    if (!expected.valid) throw new Error(`the original of the sample ${neutral.index[place]} is not valid`)
    if (!trace.valid) documentsNoLongerValid++
    documentDifferences += differences(tables, trace, expected, positionCount)
  }
  report(documentDifferences === 0 && documentsNoLongerValid === 0, `${neutral.sampleCount} documents of the dataset, the originals of the train and validation samples: ${documentDifferences} positions differ from today's trace, ${documentsNoLongerValid} documents are no longer valid.`)

  const lexerReads = new Int32Array(tables.lexerNext.length)
  const grammarReads = new Int32Array(tables.grammarNext.length)
  const samplesOfRule = rules.map(() => 0)
  const seenRule = new Int32Array(rules.length).fill(-1)
  let sampleNumber = 0
  for (const setName of setNames) {
    const samples: Samples = loadSet(setName, scratchFolderOf(optionOf('--scratch')))
    let differencesBeforeError = 0
    let otherFirstError = 0
    let codePointsInError = 0
    let samplesInError = 0
    let codePointsFromError = 0
    for (let place = 0; place < samples.sampleCount; place++) {
      sampleNumber++
      const start = samples.start[place]!
      const length = samples.start[place + 1]! - start
      runOnSample(trace, samples, place, tables, true)
      runOnSample(expected, samples, place, asIs, true)
      if (trace.firstErrorPosition !== expected.firstErrorPosition || trace.firstErrorKind !== expected.firstErrorKind || trace.firstErrorPosition !== samples.firstErrorPosition[place]) otherFirstError++
      const firstError = trace.firstErrorPosition === -1 ? length : Math.min(trace.firstErrorPosition, length)
      differencesBeforeError += differences(tables, trace, expected, firstError)
      let inError = false
      for (let position = firstError; position < length; position++) {
        codePointsFromError++
        const lexerCell = trace.lexerCell[position]!
        const grammarCell = trace.grammarCell[position]!
        if (handwritten !== undefined) {
          for (const rule of [handwritten.ruleOfLexerCell[lexerCell]!, handwritten.ruleOfGrammarCell[grammarCell]!, handwritten.ruleOfDisplayEntry[displayEntryOf(tables, trace.event[position]!, trace.grammarAfter[position]!)]!]) {
            if (rule !== -1 && seenRule[rule] !== sampleNumber) {
              seenRule[rule] = sampleNumber
              samplesOfRule[rule]!++
            }
          }
          if (tables.lexerOpen[lexerCell] === 1 && handwritten.ruleOfLexerCell[lexerCell] === -1) lexerReads[lexerCell]!++
          // A cell of the token `none` that keeps the grammar state is what every rule wants of white space and of a
          // token's later characters, so it is not counted.
          const keepsState = trace.token[position] === 0 && tables.grammarNext[grammarCell] === trace.grammarBefore[position]
          if (tables.grammarOpen[grammarCell] === 1 && handwritten.ruleOfGrammarCell[grammarCell] === -1 && !keepsState) grammarReads[grammarCell]!++
        }
        if (trace.grammarAfter[position] === tables.errorState) {
          codePointsInError++
          inError = true
        }
      }
      if (inError) samplesInError++
    }
    report(differencesBeforeError === 0 && otherFirstError === 0, `The ${setName} set, train and validation, ${samples.sampleCount} broken texts: ${differencesBeforeError} positions before a first error differ from today's trace, ${otherFirstError} texts have another first error.`)
    console.log(`        ${codePointsFromError} code points at or after a first error. ${codePointsInError} of them leave the grammar in the state error, in ${samplesInError} samples.`)
  }

  const tooDeepTexts = tooDeepTextsOfTheCheck(2000)
  const tooDeep = differencesOnTooDeepTexts(tables, tooDeepTexts)
  report(tooDeep.state === 0 && tooDeep.nesting === 0 && tooDeep.kind === 0 && tooDeep.openTokenizerCells === 0, `${tooDeepTexts.length} valid texts with a value of more than 16 levels, ${tooDeep.codePoints} code points from the first error on: ${tooDeep.state} other grammar states than today, ${tooDeep.nesting} other depths or containers, ${tooDeep.kind} other display kinds, ${tooDeep.openTokenizerCells} read an open tokenizer cell.`)

  if (handwritten !== undefined) {
    const unset = [
      ...Array.from(lexerReads, (reads, cell) => ({reads, name: `tokenizer ${lexerCellName(tables, cell)} -> ${lexerChoiceName(tables, cell)}`})),
      ...Array.from(grammarReads, (reads, cell) => ({reads, name: `grammar   ${grammarCellName(tables, cell)} -> ${grammarChoiceName(tables, cell)}`})),
    ].filter(entry => entry.reads > 0).sort((left, right) => right.reads - left.reads)
    console.log(`\nOpen cells that no rule named and that a code point of the two sets reads: ${unset.length}.`)
    for (const entry of unset.slice(0, 40)) console.log(`${String(entry.reads).padStart(8)}  ${entry.name}`)
    console.log('\nSamples of the two sets, train and validation, that read a cell or an entry of each rule, from the first error on:')
    rules.forEach((rule, index) => console.log(`${String(samplesOfRule[index]).padStart(8)}  ${index + 1}. ${rule.name}`))
    const unnamedEntries: string[] = []
    for (let entry = 0; entry < tables.display.length; entry++) {
      if (tables.displayOpen[entry] === 1 && handwritten.ruleOfDisplayEntry[entry] === -1 && entry % tables.grammarStateCount !== today.errorState) unnamedEntries.push(displayEntryName(tables, entry))
    }
    console.log(`\n${unnamedEntries.length} open display entries outside the state ${grammarStateNames[today.errorState]} are named by no rule and show what they show today.`)
  }
  console.log(failures.length > 0 ? `\nThe check FAILED in ${failures.length} parts.` : '\nEvery check passed.')
  if (failures.length > 0) process.exitCode = 1
}
