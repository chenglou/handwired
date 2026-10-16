// The check of saved tables: valid TOML is parsed exactly as today, and a broken text exactly as today up to its
// first error.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-toml/learn/runs/check.ts [--folder <folder>] [--tables <file.json>]
// Without --tables, every saved table of the folder's records, by default of <RECOVERY_SCRATCH>/neutral/. It ends with
// "Every check passed." or with a count of failures.
//
// Per file of tables:
// 1. The file loads. loadTables runs checkTables of ../recovery-tables.ts: the fixed tables are today's, the masks are
//    the ones of the search for frozen cells, and every frozen cell and every display entry that is not open holds
//    what it holds today.
// 2. The file is the one that its run saved: its sha256 is the one of its record and of tables.json, when the folder
//    has them, and its dataset key is today's.
// 3. Valid documents get today's trace. This reads no mask: the plain parser of ../../table-parser.ts runs each text
//    with today's tables, the exact parser runs it with the saved tables, and the two have to agree at all 513
//    positions in the tokenizer state, the event, the token, the grammar state before and after, the display kind,
//    the depth and the container. The texts: the documents of every sample of the set that the runs trained on,
//    outside the test split, the valid texts of ../check-texts.ts, among them ones with 16 levels and with 512 code
//    points, and the valid edge cases of ../../check-texts.ts. Every class that the tables add has to have a code
//    point in one of these documents, or the check says so. Before the files, the comparison is tried on two sets
//    of tables that have to fail it, with one frozen cell and with one display entry changed.
// 4. Broken texts get today's trace before their first error, and today's first error: the broken texts of the same
//    samples, and the edited, random, too long and too deep texts of ../check-texts.ts.
// 5. Valid texts with a value of more than 16 levels are shown as today, when the tables have the recipe's last
//    step. For tables without it, e.g. row 6, the differences are printed and are no failure.
import {existsSync, readFileSync} from 'node:fs'
import {basename, dirname, join} from 'node:path'
import {validEdgeCases} from '../../check-texts.ts'
import {type ParserTrace, positionCount, runTableParser} from '../../table-parser.ts'
import {checkTexts} from '../check-texts.ts'
import {allowedSampleAt, datasetKey, standardRange} from '../data.ts'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {createRandom} from '../random.ts'
import {differencesOnTooDeepTexts, tooDeepTextsOfTheCheck} from '../recipe.ts'
import {type RecoveryTrace, codePointsOf, createTrace, runRecoveryParserInto} from '../recovery-parser.ts'
import {type RecoveryTables, cellCounts, copyTables, displayEntryOf, loadTables, problemsOf, today} from '../recovery-tables.ts'
import {type RunRecord, listFileName, runsFolderOf, savedRunsOf, sha256OfFile} from './runs.ts'

refuseUnknownOptions('runs/check.ts', ['--folder', '--tables'])
const namedFile = optionOf('--tables')
const folder = namedFile === undefined ? runsFolderOf(optionOf('--folder')) : dirname(namedFile)
const runs = savedRunsOf(folder)
const files = namedFile === undefined ? runs.map(run => run.tablesFile) : [namedFile]
if (files.length === 0) throw new Error(`${folder} holds no record of a run`)

let failures = 0
const fail = (line: string) => {
  failures++
  console.log(`FAILED: ${line}`)
}

// 1 and 2.
type Listed = {tables: {file: string, sha256: string}[]}
const list = existsSync(join(folder, listFileName)) ? JSON.parse(readFileSync(join(folder, listFileName), 'utf8')) as Listed : undefined
type Checked = {file: string, tables: RecoveryTables, record: RunRecord | undefined, validPositions: number, brokenTexts: number, differences: number, firstDifference: string}
const checked: Checked[] = []
for (const file of files) {
  const record = runs.find(run => run.tablesFile === file)?.record
  try {
    const loaded = loadTables(file)
    if (loaded.datasetKey !== datasetKey()) fail(`${file} was saved with the dataset ${loaded.datasetKey}, and the dataset is ${datasetKey()} now`)
    checked.push({file, tables: loaded.tables, record, validPositions: 0, brokenTexts: 0, differences: 0, firstDifference: ''})
  } catch (error) {
    fail(`${file} does not load: ${error instanceof Error ? error.message : String(error)}`)
    continue
  }
  const sha256 = sha256OfFile(file)
  if (record !== undefined && record.sha256 !== sha256) fail(`${file} has the sha256 ${sha256}, and its record says ${record.sha256}`)
  const listed = list?.tables.find(entry => entry.file === basename(file))
  if (listed !== undefined && listed.sha256 !== sha256) fail(`${file} has the sha256 ${sha256}, and ${listFileName} says ${listed.sha256}`)
  if (list !== undefined && listed === undefined) fail(`${file} is not in ${listFileName}`)
}
for (const entry of list?.tables ?? []) if (namedFile === undefined && !files.some(file => basename(file) === entry.file)) fail(`${listFileName} lists ${entry.file}, which has no record in ${folder}`)

// The texts of 3 and 4. A sample of the test split is never made: allowedSampleAt gives undefined for it.
const range = runs[0]?.record.trainedOn ?? {datasetSeed: standardRange().seed, from: standardRange().from, to: standardRange().to}
const validTexts = new Set<string>(validEdgeCases)
const brokenTexts = new Set<string>()
for (let index = range.from; index < range.to; index++) {
  const sample = allowedSampleAt(range.datasetSeed, index)
  if (sample === undefined) continue
  validTexts.add(sample.original)
  if (sample.source !== 'valid') brokenTexts.add(sample.broken)
}
const documentsOfTheDataset = validTexts.size - validEdgeCases.length
for (const {text, made} of checkTexts(createRandom(20261016, 9), 2000)) (made.startsWith('valid') ? validTexts : brokenTexts).add(text)

// The fields of a trace that have to be today's, in today's terms: the class of a code point as the class that it
// has today, and the context without the bit "first on its line".
const comparedFields = ['lexerStateBefore', 'event', 'token', 'grammarBefore', 'grammarAfter', 'displayKind', 'depthAfter', 'containerAfter'] as const
function differenceOf(trace: RecoveryTrace, expected: ParserTrace, tables: RecoveryTables): string {
  if (trace.valid !== expected.valid) return `valid is ${trace.valid}, and today's is ${expected.valid}`
  if (trace.firstErrorPosition !== expected.firstErrorPosition) return `the first error is at ${trace.firstErrorPosition}, and today's at ${expected.firstErrorPosition}`
  if (trace.firstErrorKind !== expected.firstErrorKind) return `the first error's kind is ${trace.firstErrorKind}, and today's ${expected.firstErrorKind}`
  const positions = expected.valid ? positionCount : expected.firstErrorPosition
  for (let position = 0; position < positions; position++) {
    for (const field of comparedFields) if (trace[field][position] !== expected[field][position]) return `${field} at position ${position} is ${trace[field][position]}, and today's is ${expected[field][position]}`
    if (tables.classToday[trace.characterClass[position]!] !== expected.characterClass[position]) return `the class at position ${position} is not today's`
    if (trace.context[position]! % today.contextCount !== expected.context[position]) return `the context at position ${position} is not today's`
  }
  return ''
}

const trace = createTrace()

// The comparison is tried first on tables that have to fail it: a copy of the first tables in which the frozen
// tokenizer cell that the first code point of a valid text reads holds another next state, and a copy with another
// kind in the display entry that this code point reads.
if (checked.length > 0) {
  const text = [...validTexts].find(candidate => candidate.length > 1)!
  const expected = runTableParser(text)
  const {codePoints, truncated} = codePointsOf(text)
  const {tables} = checked[0]!
  runRecoveryParserInto(trace, codePoints, 0, codePoints.length, truncated, tables)
  const withAnotherState = copyTables(tables)
  withAnotherState.lexerNext[trace.lexerCell[0]!] = (tables.lexerNext[trace.lexerCell[0]!]! + 1) % tables.lexerStateCount
  const withAnotherKind = copyTables(tables)
  const entry = displayEntryOf(tables, trace.event[0]!, trace.grammarAfter[0]!)
  withAnotherKind.display[entry] = (tables.display[entry]! + 1) % 3
  for (const [changed, name] of [[withAnotherState, 'a frozen tokenizer cell'], [withAnotherKind, 'a display entry that is not open']] as const) {
    runRecoveryParserInto(trace, codePoints, 0, codePoints.length, truncated, changed)
    if (differenceOf(trace, expected, changed) === '') fail(`the comparison with today's trace does not see a change of ${name}`)
    if (problemsOf(changed).length === 0) fail(`checkTables does not see a change of ${name}`)
  }
}

const codePointsInValidTexts = new Set<number>()
let validCount = 0
for (const [texts, haveToBeValid] of [[validTexts, true], [brokenTexts, false]] as const) {
  for (const text of texts) {
    const expected = runTableParser(text)
    if (haveToBeValid && !expected.valid) {
      fail(`a text that has to be valid is not, for today's parser: ${JSON.stringify(text.slice(0, 80))}`)
      continue
    }
    // A text of the other list can be valid for today's parser, e.g. an edit inside a comment. It is then compared
    // at every position, as a valid text is.
    const {codePoints, truncated} = codePointsOf(text)
    if (expected.valid) {
      validCount++
      for (const codePoint of codePoints) codePointsInValidTexts.add(codePoint)
    }
    for (const entry of checked) {
      runRecoveryParserInto(trace, codePoints, 0, codePoints.length, truncated, entry.tables)
      const difference = differenceOf(trace, expected, entry.tables)
      if (expected.valid) entry.validPositions += positionCount
      else entry.brokenTexts++
      if (difference === '') continue
      entry.differences++
      if (entry.firstDifference === '') entry.firstDifference = `${difference}, in ${JSON.stringify(text.slice(0, 80))}`
    }
  }
}
console.log(`${validCount} valid texts, of which ${documentsOfTheDataset} are documents of the samples ${range.from} to ${range.to - 1} outside the test split, and ${checked[0]?.brokenTexts ?? 0} texts with an error.`)

// 5.
const tooDeepTexts = tooDeepTextsOfTheCheck(2000)
const lastStepOfTheRecipe = 'today\'s kinds in the display entries of the grammar state error'
for (const entry of checked) {
  const name = basename(entry.file)
  if (entry.differences > 0) fail(`${name}: ${entry.differences} texts differ from today's parser where they may not. The first: ${entry.firstDifference}`)
  const classesWithoutAValidText = entry.tables.addedClasses.filter(added => !added.codePoints.some(codePoint => codePointsInValidTexts.has(codePoint))).map(added => added.name)
  if (classesWithoutAValidText.length > 0) fail(`${name}: no valid text of the check has a code point of the added classes ${classesWithoutAValidText.join(', ')}`)
  const tooDeep = differencesOnTooDeepTexts(entry.tables, tooDeepTexts)
  const shownOtherwise = tooDeep.state + tooDeep.nesting + tooDeep.kind + tooDeep.openTokenizerCells
  const hasTheLastStep = entry.record?.steps.includes(lastStepOfTheRecipe) ?? false
  if (hasTheLastStep && shownOtherwise > 0) fail(`${name}: too deep valid texts are not shown as today: ${tooDeep.state} other grammar states, ${tooDeep.nesting} other depths or containers, ${tooDeep.kind} other display kinds, ${tooDeep.openTokenizerCells} open tokenizer cells read`)
  const counts = cellCounts(entry.tables)
  console.log(`${name}: ${counts.lexerFrozen} frozen tokenizer cells, ${counts.grammarFrozen} frozen grammar cells and ${counts.displayEntries - counts.displayOpen} display entries that are not open hold today's. ${entry.validPositions} positions of valid texts and ${entry.brokenTexts} texts up to their first error: ${entry.differences} differ from today. ${entry.tables.addedClasses.length} added classes, each with a code point in a valid text: ${classesWithoutAValidText.length === 0 ? 'yes' : 'no'}. Too deep valid texts, ${tooDeep.codePoints} code points from the first error on: ${tooDeep.nesting} other depths or containers, ${tooDeep.kind} other display kinds${hasTheLastStep ? '' : ' (the tables have no last step, so this is no failure)'}.`)
}
console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
