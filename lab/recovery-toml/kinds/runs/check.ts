// The check of the tables that the runs on the mixed set saved: valid TOML is parsed exactly as today, and a broken
// text exactly as today up to its first error. It is ../../learn/runs/check.ts with the texts of the mixed set.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-toml/kinds/runs/check.ts [--folder <folder>]
// It checks every saved table of the folder's records, by default of <RECOVERY_SCRATCH>/mixed/, and ends with "Every
// check passed." or with a count of failures.
//
// Per file of tables:
// 1. The file loads. loadTables runs checkTables of ../../learn/recovery-tables.ts: the fixed tables are today's, the
//    masks are the ones of the search for frozen cells, and every frozen cell and every display entry that is not
//    open holds what it holds today.
// 2. The file is the one that its run saved: its sha256 is the one of its record and of tables.json, when the folder
//    has that list, and its dataset key and its record's key of the kinds are today's.
// 3. Valid documents get today's trace. This reads no mask: the plain parser of ../../table-parser.ts runs each text
//    with today's tables, the exact parser runs it with the saved tables, and the two have to agree at all 513
//    positions in the tokenizer state, the event, the token, the grammar state before and after, the display kind,
//    the depth and the container. The texts: the document of every sample of the mixed set that the runs trained on,
//    the valid texts of ../../learn/check-texts.ts, among them ones with 16 levels and with 512 code points, the valid
//    edge cases of ../../check-texts.ts, and for every code point that the tables give a class of its own, texts
//    with that code point in a comment and in each of the four forms of a string, e.g. `key = "a;b"` for the
//    semicolon. The mixed train split has code points that no document has, e.g. the no-break space, so without the
//    last texts a class of such a code point would be read by no valid text. Every added class has to have a code
//    point in a valid text of the check. Before the files, the comparison is tried on two sets of tables that have to
//    fail it, with one frozen cell and with one display entry changed.
// 4. Broken texts get today's trace before their first error, and today's first error: the broken text of every
//    sample of both halves of the mixed set, of the dataset's sample of every index whose mixed sample is of the
//    kinds, and the edited, random, too long and too deep texts of ../../learn/check-texts.ts.
// 5. Valid texts with a value of more than 16 levels are shown as today.
// 6. The record's main numbers are counted a second time: on the mixed validation split and on each of its halves,
//    the scored code points, the ones with every scored value right, and the whole samples. The second count runs
//    each sample's broken text by itself and reads its labels from labelsOf of the dataset, where the record's
//    numbers come from the arrays of ../../learn/data.ts and from ../../learn/score.ts.
//
// No sample of the test split is made past its field `split`: the mixed set leaves those indexes out.
import {existsSync, readFileSync} from 'node:fs'
import {basename, join} from 'node:path'
import {validEdgeCases} from '../../check-texts.ts'
import {checkTexts} from '../../learn/check-texts.ts'
import {allowedSampleAt, datasetKey} from '../../learn/data.ts'
import {optionOf, refuseUnknownOptions} from '../../learn/options.ts'
import {createRandom} from '../../learn/random.ts'
import {differencesOnTooDeepTexts, tooDeepTextsOfTheCheck} from '../../learn/recipe.ts'
import {type RecoveryTrace, codePointsOf, createTrace, runRecoveryParserInto} from '../../learn/recovery-parser.ts'
import {type RecoveryTables, cellCounts, copyTables, displayEntryOf, loadTables, problemsOf, today} from '../../learn/recovery-tables.ts'
import {sha256OfFile} from '../../learn/runs/runs.ts'
import {labelsOf} from '../../samples.ts'
import {type ParserTrace, positionCount, runTableParser} from '../../table-parser.ts'
import {kindsKey, mixedTrainSamples, mixedValidationSamples} from '../mixed.ts'
import {type MixedRunRecord, kindsHalfRowName, listFileName, neutralHalfRowName, rowNamed, runsFolderOf, savedRunsOf} from './mixed-runs.ts'

refuseUnknownOptions('kinds/runs/check.ts', ['--folder'])
const folder = runsFolderOf(optionOf('--folder'))
const runs = savedRunsOf(folder)
if (runs.length === 0) throw new Error(`${folder} holds no record of a run on the mixed set`)

let failures = 0
const fail = (line: string) => {
  failures++
  console.log(`FAILED: ${line}`)
}

// 1 and 2.
type Listed = {tables: {file: string, sha256: string}[]}
const list = existsSync(join(folder, listFileName)) ? JSON.parse(readFileSync(join(folder, listFileName), 'utf8')) as Listed : undefined
type Checked = {file: string, tables: RecoveryTables, record: MixedRunRecord, validPositions: number, brokenTexts: number, differences: number, firstDifference: string}
const checked: Checked[] = []
for (const {record, tablesFile: file} of runs) {
  try {
    const loaded = loadTables(file)
    if (loaded.datasetKey !== datasetKey()) fail(`${file} was saved with the dataset ${loaded.datasetKey}, and the dataset is ${datasetKey()} now`)
    checked.push({file, tables: loaded.tables, record, validPositions: 0, brokenTexts: 0, differences: 0, firstDifference: ''})
  } catch (error) {
    fail(`${file} does not load: ${error instanceof Error ? error.message : String(error)}`)
    continue
  }
  if (record.kindsKey !== kindsKey()) fail(`${file} was trained with the kinds ${record.kindsKey}, and the kinds are ${kindsKey()} now`)
  const sha256 = sha256OfFile(file)
  if (record.sha256 !== sha256) fail(`${file} has the sha256 ${sha256}, and its record says ${record.sha256}`)
  const listed = list?.tables.find(entry => entry.file === basename(file))
  if (listed !== undefined && listed.sha256 !== sha256) fail(`${file} has the sha256 ${sha256}, and ${listFileName} says ${listed.sha256}`)
  if (list !== undefined && listed === undefined) fail(`${file} is not in ${listFileName}`)
}
for (const entry of list?.tables ?? []) if (!runs.some(run => basename(run.tablesFile) === entry.file)) fail(`${listFileName} lists ${entry.file}, which has no record in ${folder}`)
if (list === undefined) console.log(`${folder} has no ${listFileName}: report.ts --write-list writes it.`)

// The texts of 3 and 4.
const {trainedOn} = runs[0]!.record
for (const {record, recordFile} of runs) if (JSON.stringify(record.trainedOn) !== JSON.stringify(trainedOn)) fail(`${recordFile} trained on other samples than ${runs[0]!.recordFile}`)
const range = {seed: trainedOn.datasetSeed, from: trainedOn.from, to: trainedOn.to}
const validTexts = new Set<string>(validEdgeCases)
const brokenTexts = new Set<string>()
let mixedSamples = 0
let brokenTextsOfTheKinds = 0
const validationOfTheMixedSet = mixedValidationSamples(range)
for (const mixed of [...mixedTrainSamples(range), ...validationOfTheMixedSet]) {
  mixedSamples++
  validTexts.add(mixed.sample.original)
  brokenTexts.add(mixed.sample.broken)
  if (mixed.half !== 'kinds') continue
  brokenTextsOfTheKinds++
  // The dataset's sample of the same index, which the mixed set does not hold.
  const neutral = allowedSampleAt(range.seed, mixed.index)
  if (neutral !== undefined) brokenTexts.add(neutral.broken)
}
const documentsOfTheMixedSet = validTexts.size - validEdgeCases.length
for (const {text, made} of checkTexts(createRandom(20261016, 9), 2000)) (made.startsWith('valid') ? validTexts : brokenTexts).add(text)

// For every code point with a class of its own in some tables: texts with it in a comment, in a string of each of the
// four forms, and as the start of a comment's text. A text that today's parser rejects is left out, e.g. a control
// character inside a string, and the check of the classes below says when a code point is left without a valid text.
const addedCodePoints = new Set(checked.flatMap(entry => entry.tables.addedClasses.flatMap(added => [...added.codePoints])))
let textsOfAddedCodePoints = 0
for (const codePoint of addedCodePoints) {
  const character = String.fromCodePoint(codePoint)
  const candidates = [
    `# a comment ${character} with it\nkey = 1\n`, `#${character}\n`, `key = "a${character}b"\n`, `key = 'a${character}b'\n`, `key = """\na${character}b\n"""\n`, `key = '''a${character}b'''\n`,
    `[table]\nname = "${character}" # ${character}\nlist = ["${character}", '${character}']\n`,
  ]
  for (const candidate of candidates) {
    if (!runTableParser(candidate).valid) continue
    validTexts.add(candidate)
    textsOfAddedCodePoints++
  }
}

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
console.log(`${validCount} valid texts, of which ${documentsOfTheMixedSet} are the documents of the ${mixedSamples} samples of the mixed set of the indexes ${range.from} to ${range.to - 1} and ${textsOfAddedCodePoints} hold one of the ${addedCodePoints.size} code points with a class of their own. ${checked[0]?.brokenTexts ?? 0} texts with an error, among them the broken texts of the mixed set, ${brokenTextsOfTheKinds} of them of the kinds.`)

// 5.
const tooDeepTexts = tooDeepTextsOfTheCheck(2000)
for (const entry of checked) {
  const name = basename(entry.file)
  if (entry.differences > 0) fail(`${name}: ${entry.differences} texts differ from today's parser where they may not. The first: ${entry.firstDifference}`)
  const classesWithoutAValidText = entry.tables.addedClasses.filter(added => !added.codePoints.some(codePoint => codePointsInValidTexts.has(codePoint))).map(added => added.name)
  if (classesWithoutAValidText.length > 0) fail(`${name}: no valid text of the check has a code point of the added classes ${classesWithoutAValidText.join(', ')}`)
  const tooDeep = differencesOnTooDeepTexts(entry.tables, tooDeepTexts)
  if (tooDeep.state + tooDeep.nesting + tooDeep.kind + tooDeep.openTokenizerCells > 0) fail(`${name}: too deep valid texts are not shown as today: ${tooDeep.state} other grammar states, ${tooDeep.nesting} other depths or containers, ${tooDeep.kind} other display kinds, ${tooDeep.openTokenizerCells} open tokenizer cells read`)
  const counts = cellCounts(entry.tables)
  console.log(`${name}: ${counts.lexerFrozen} frozen tokenizer cells, ${counts.grammarFrozen} frozen grammar cells and ${counts.displayEntries - counts.displayOpen} display entries that are not open hold today's. ${entry.validPositions} positions of valid texts and ${entry.brokenTexts} texts up to their first error: ${entry.differences} differ from today. ${entry.tables.addedClasses.length} added classes, each with a code point in a valid text: ${classesWithoutAValidText.length === 0 ? 'yes' : 'no'}. Too deep valid texts, ${tooDeep.codePoints} code points from the first error on: ${tooDeep.nesting} other depths or containers, ${tooDeep.kind} other display kinds.`)
}

// 6. The main numbers of every record, counted a second time. The records come from the arrays of
// ../../learn/data.ts and the rows of ../../learn/score.ts. Here each validation sample of the mixed set is run as
// its own text, and its labels come from labelsOf of the dataset.
const partNames = {all: 'all', neutral: neutralHalfRowName, kinds: kindsHalfRowName}
for (const entry of checked) {
  const counted = {all: {samples: 0, codePoints: 0, allRight: 0, wholeSamples: 0}, neutral: {samples: 0, codePoints: 0, allRight: 0, wholeSamples: 0}, kinds: {samples: 0, codePoints: 0, allRight: 0, wholeSamples: 0}}
  for (const {half, sample} of validationOfTheMixedSet) {
    const labels = labelsOf(sample)
    const {codePoints, truncated} = codePointsOf(sample.broken)
    runRecoveryParserInto(trace, codePoints, 0, codePoints.length, truncated, entry.tables)
    let scored = 0
    let right = 0
    for (let position = sample.firstErrorPosition; position < labels.length; position++) {
      const label = labels[position]
      if (label === undefined || (label.kind === undefined && label.depth === undefined)) continue
      scored++
      const kindRight = label.kind === undefined || trace.displayKind[position] === label.kind
      const nestingRight = label.depth === undefined || (trace.depthAfter[position] === label.depth && trace.containerAfter[position] === label.container)
      if (kindRight && nestingRight) right++
    }
    for (const part of [counted.all, counted[half]]) {
      part.samples++
      part.codePoints += scored
      part.allRight += right
      if (scored > 0 && right === scored) part.wholeSamples++
    }
  }
  const lines: string[] = []
  for (const part of ['all', 'neutral', 'kinds'] as const) {
    const row = rowNamed(entry.record.validation, partNames[part])
    const again = counted[part]
    if (row === undefined || row.samples !== again.samples || row.codePoints !== again.codePoints || row.allRight !== again.allRight || row.wholeSamples !== again.wholeSamples) {
      fail(`${basename(entry.file)}: the record's row "${partNames[part]}" on the mixed validation split is ${JSON.stringify(row === undefined ? null : {samples: row.samples, codePoints: row.codePoints, allRight: row.allRight, wholeSamples: row.wholeSamples})}, and the second count is ${JSON.stringify(again)}`)
    }
    lines.push(`${part === 'all' ? 'mixed' : part === 'neutral' ? 'half of the dataset' : 'half of the kinds'} ${again.allRight} of ${again.codePoints} scored code points and ${again.wholeSamples} of ${again.samples} whole samples`)
  }
  console.log(`${basename(entry.file)}: the second count of the record's score on the mixed validation split: ${lines.join(', ')}.`)
}
console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
