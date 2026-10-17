// The check of the final scoring's tooling. It scores only the parser as it is and the one rule on the held-back
// sets, reads no sample of the dataset's test split, and prints counts and no text of a set.
//
// Run from the repo root, with RECOVERY_SCRATCH set to the scratch folder of the TOML track, see list.ts:
//   bun lab/recovery-toml/held-back/final/check.ts
// It ends with "Every check passed." or with the number of failures. What it checks:
// - The counts of count.ts for the parser as it is and for the rule are the numbers that ../README.md gives for the
//   two held-back sets, and every count is the one of the set's own scorer. A count that is changed by one is noticed.
// - With what the labels say in the place of a parser, every scored code point is right, and with the display kind
//   `error` everywhere, no display kind is right and every added code point is shown as an error.
// - The check against the parser as it is finds no difference for the parser as it is, and a difference at every
//   code point of the valid documents for a parser that shows `error` everywhere.
// - list.json is what the three lists of the training side give now, and it holds its paths relative to the scratch
//   folder. A list with another sha256, with a file left out, or of another dataset is refused, and so are tables
//   with a changed frozen cell.
// - The verdict's rule gives each of its four verdicts for numbers that are made up for it, and a row that is level
//   with another row is not above it.
// - The report of a final run can be written: with made-up counts in the rows 3 to 8, it has a verdict and no gap.
// - run.ts refuses a final run without RECOVERY_FINAL, a dry run with it, and a folder that is not below held-back/.
import {readFileSync} from 'node:fs'
import {displayKind} from '../../kinds.ts'
import {asIsTables, classNames, lexerStateNames, tablesFromJson, tablesToJson} from '../../learn/recovery-tables.ts'
import {type Parser, type Shown, parserAsItIs, restartAtNextLine} from '../parsers.ts'
import {type Counts, countsOf, countsOfText, differencesFromToday, labelKindCountsOf, parserOfCheckedTables, percentagesOf, scoredPerTextOf, todaysTracesOf} from './count.ts'
import {type FinalList, listFile, listFileText, problemsOfList, readList} from './list.ts'
import {type FileCounts, type RowCounts, type RunFacts, type VerdictSet, describeReport, heldBackLine, mainRows, verdictOf, verdicts} from './report.ts'
import {baseOf, countsFileText, finalRunsIn} from './run.ts'
import {type Comparison, compareWithGeneratorScorer, compareWithWrittenScorer} from './second-count.ts'
import {type ScoredSet, generatorSet, writtenSet} from './sets.ts'

console.log(heldBackLine)
let failures = 0
const check = (passed: boolean, what: string) => {
  console.log(`${passed ? 'ok  ' : 'FAIL'}  ${what}`)
  if (!passed) failures++
}
const throws = (run: () => unknown) => {
  try {
    run()
  } catch {
    return true
  }
  return false
}

const generator = generatorSet()
const written = writtenSet()
const sets: [name: 'generator' | 'written', set: ScoredSet][] = [['generator', generator], ['written', written]]
const parsers = [parserAsItIs, restartAtNextLine]
const counts = parsers.map(parser => ({generator: countsOf(parser, generator), written: countsOf(parser, written)}))
const rowOf = (of: readonly Counts[], name: string) => of.find(row => row.name === name)!

// The numbers of ../README.md, section "The final scoring", with the counts of the sets' READMEs behind them.
const known = [
  {generator: {texts: 3000, scored: 488_580, allThree: '69.3', whole: '9.5'}, written: {texts: 144, nothingToRecover: 2, scored: 20_303, right: 12_530, whole: 7, allThree: '61.7', wholeShare: '4.9'}},
  {generator: {texts: 3000, scored: 488_580, allThree: '89.8', whole: '37.9'}, written: {texts: 144, nothingToRecover: 2, scored: 20_303, right: 17_105, whole: 42, allThree: '84.2', wholeShare: '29.6'}},
]
parsers.forEach((parser, at) => {
  const ofGenerator = rowOf(counts[at]!.generator, mainRows.generator)
  const ofWritten = rowOf(counts[at]!.written, mainRows.written)
  const expected = known[at]!
  check(ofGenerator.texts === expected.generator.texts && ofGenerator.scored === expected.generator.scored && percentagesOf(ofGenerator).allThree.toFixed(1) === expected.generator.allThree && percentagesOf(ofGenerator).whole.toFixed(1) === expected.generator.whole,
    `${parser.name}, the generator's set: ${ofGenerator.texts} samples, ${ofGenerator.scored} scored code points, ${percentagesOf(ofGenerator).allThree.toFixed(1)} / ${percentagesOf(ofGenerator).whole.toFixed(1)}, as the README says`)
  check(ofWritten.texts === expected.written.texts && ofWritten.nothingToRecover === expected.written.nothingToRecover && ofWritten.scored === expected.written.scored && ofWritten.right === expected.written.right && ofWritten.whole === expected.written.whole
    && percentagesOf(ofWritten).allThree.toFixed(1) === expected.written.allThree && percentagesOf(ofWritten).whole.toFixed(1) === expected.written.wholeShare,
  `${parser.name}, the written cases with full agreement: ${ofWritten.texts} cases, ${ofWritten.right} of ${ofWritten.scored} code points and ${ofWritten.whole} whole cases, ${percentagesOf(ofWritten).allThree.toFixed(1)} / ${percentagesOf(ofWritten).whole.toFixed(1)}, as the README says`)
})

// The second counts, and a planted difference.
const secondCounts: Comparison = {compared: 0, different: []}
parsers.forEach((parser, at) => {
  compareWithGeneratorScorer(parser.name, parser, counts[at]!.generator, generator, secondCounts)
  compareWithWrittenScorer(parser.name, parser, counts[at]!.written, written, secondCounts)
})
check(secondCounts.compared > 500 && secondCounts.different.length === 0, `${secondCounts.compared} counts of the two parsers are the counts of specific/score.ts and written/score.ts`)
const plantedInGenerator: Comparison = {compared: 0, different: []}
compareWithGeneratorScorer('planted', parserAsItIs, counts[0]!.generator.map((row, at) => at === 0 ? {...row, right: row.right + 1} : row), generator, plantedInGenerator)
const plantedInWritten: Comparison = {compared: 0, different: []}
compareWithWrittenScorer('planted', parserAsItIs, counts[0]!.written.map((row, at) => at === 0 ? {...row, whole: row.whole + 1} : row), written, plantedInWritten)
check(plantedInGenerator.different.length === 1 && plantedInWritten.different.length === 1, 'a count that is changed by one is noticed by the second count, on the generator\'s set and on the written set')

// The counter at its two ends: what the labels say, and `error` everywhere.
for (const [name, set] of sets) {
  let asLabels = {texts: 0, scored: 0, right: 0, whole: 0, nothingToRecover: 0, added: 0, addedShownAsError: 0}
  let asErrors = {scored: 0, kindScored: 0, kindRight: 0, added: 0, addedShownAsError: 0}
  for (const text of set.texts) {
    const length = text.labels.length
    const labeled: Shown = {displayKind: new Int16Array(length), depthAfter: new Int16Array(length), containerAfter: new Int8Array(length)}
    const errors: Shown = {displayKind: new Int16Array(length).fill(displayKind.error), depthAfter: new Int16Array(length).fill(99), containerAfter: new Int8Array(length)}
    text.labels.forEach((label, position) => {
      labeled.displayKind[position] = label?.kind ?? displayKind.error
      labeled.depthAfter[position] = label?.depth ?? 99
      labeled.containerAfter[position] = label?.container ?? 0
    })
    const ofLabels = countsOfText(text, labeled)
    const ofErrors = countsOfText(text, errors)
    asLabels = {texts: asLabels.texts + 1, scored: asLabels.scored + ofLabels.scored, right: asLabels.right + ofLabels.right, whole: asLabels.whole + ofLabels.whole, nothingToRecover: asLabels.nothingToRecover + ofLabels.nothingToRecover, added: asLabels.added + ofLabels.added, addedShownAsError: asLabels.addedShownAsError + ofLabels.addedShownAsError}
    asErrors = {scored: asErrors.scored + ofErrors.scored, kindScored: asErrors.kindScored + ofErrors.kindScored, kindRight: asErrors.kindRight + ofErrors.kindRight, added: asErrors.added + ofErrors.added, addedShownAsError: asErrors.addedShownAsError + ofErrors.addedShownAsError}
  }
  check(asLabels.scored > 0 && asLabels.right === asLabels.scored && asLabels.whole === asLabels.texts - asLabels.nothingToRecover && asLabels.added > 0 && asLabels.addedShownAsError === asLabels.added,
    `the ${name} set with what its labels say: all ${asLabels.scored} scored code points are right, all ${asLabels.whole} texts with something to recover are whole, and the ${asLabels.added} added code points count as shown as an error`)
  check(asErrors.kindScored > 0 && asErrors.kindRight === 0 && asErrors.addedShownAsError === asErrors.added, `the ${name} set with \`error\` everywhere: none of the ${asErrors.kindScored} scored display kinds is right`)
}

// The counts per display kind of the label and the counts per text add up to the row's counts.
for (const [name, set] of sets) {
  const rightPerText: number[] = []
  const all = countsOf(parserAsItIs, set, rightPerText)
  const total = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0)
  const allCases = name === 'generator' ? 'all' : 'all cases, the agreed code points'
  check(rightPerText.length === set.texts.length && total(rightPerText) === rowOf(all, allCases).right && total(scoredPerTextOf(set)) === rowOf(all, allCases).scored, `the counts per text of the ${name} set add up to the ${rowOf(all, allCases).right} right of ${rowOf(all, allCases).scored} scored code points of all its texts`)
  const ofKinds = labelKindCountsOf(parserAsItIs, set, mainRows[name])
  const row = rowOf(counts[0]![name], mainRows[name])
  check(ofKinds.reduce((total, of) => total + of.scored, 0) === row.scored && ofKinds.reduce((total, of) => total + of.right, 0) === row.right, `the counts per display kind of the label of the ${name} set add up to the ${row.scored} scored and ${row.right} right code points of its main row`)
}

// The check against the parser as it is.
const errorEverywhere: Parser = {name: 'error everywhere', show: broken => ({displayKind: new Int16Array(Array.from(broken).length).fill(displayKind.error), depthAfter: new Int16Array(513), containerAfter: new Int8Array(513)})}
for (const [name, set] of sets) {
  const todays = todaysTracesOf(parserAsItIs, set)
  const same = differencesFromToday(parserOfCheckedTables('as it is', asIsTables()), todays)
  const other = differencesFromToday(errorEverywhere, todays)
  check(same.validDifferences === 0 && same.beforeErrorDifferences === 0 && other.validDifferences === todays.validCodePoints,
    `the ${name} set: today's tables show its ${todays.documents} valid documents and its broken texts before their first error as the parser as it is, and \`error\` everywhere differs at all ${todays.validCodePoints} code points of the documents`)
}

// The list.
const list = readList()
const fileCount = list.rows.reduce((total, row) => total + row.tables.length, 0)
check(problemsOfList(list).length === 0 && fileCount === 24, `${listFile} names ${fileCount} files, is what the three lists give now, and every file has the bytes that its sha256 names`)
check(listFileText(list) === readFileSync(listFile, 'utf8') && !readFileSync(listFile, 'utf8').includes('"path": "/'), 'list.json holds every path relative to the scratch folder: the list that was read, written again, is the text of the file')
const changedList = (change: (copy: FinalList) => void) => {
  const copy = JSON.parse(JSON.stringify(list)) as FinalList
  change(copy)
  return problemsOfList(copy)
}
check(changedList(copy => { copy.rows[1]!.tables[0]!.sha256 = copy.rows[1]!.tables[1]!.sha256 }).length > 0, 'a list with the sha256 of another file is refused')
check(changedList(copy => { copy.rows[1]!.tables.pop() }).length > 0, 'a list with a file left out is refused')
check(changedList(copy => { copy.datasetKey = '0000000000000000' }).length > 0, 'a list of another dataset is refused')
const firstFile = list.rows[1]!.tables[0]!.path
const loaded = tablesFromJson(readFileSync(firstFile, 'utf8'))
const frozenCell = loaded.tables.lexerOpen.indexOf(0)
const withChangedFrozenCell = JSON.parse(tablesToJson(loaded.tables)) as {lexerNext: number[]}
withChangedFrozenCell.lexerNext[frozenCell] = (withChangedFrozenCell.lexerNext[frozenCell]! + 1) % lexerStateNames.length
check(frozenCell !== -1 && throws(() => tablesFromJson(JSON.stringify(withChangedFrozenCell))) && !throws(() => tablesFromJson(tablesToJson(loaded.tables))), 'tables with one frozen tokenizer cell changed are refused when they are loaded, and the same tables without the change are not')
const base = baseOf(loaded.tables)
check(base.classCount === classNames.length + loaded.tables.addedClasses.length && base.contextCount === loaded.tables.contextCount, 'the base of a file has the file\'s classes and contexts, and no cell that differs from today\'s')

// The verdict.
const verdictSet = (row2: number, row3: number, row4: number[], row7: number[]): VerdictSet => ({name: 'made up', row2, row3, row4, row7})
const verdictChecks: [expected: typeof verdicts[number], sets: VerdictSet[], what: string][] = [
  [verdicts[0], [verdictSet(90, 92, [93, 94], [80]), verdictSet(84, 85, [86, 90], [80])], 'row 4 above the rows 2 and 3 on both sets'],
  [verdicts[1], [verdictSet(90, 92, [93, 91.9], [93, 94]), verdictSet(84, 85, [86, 90], [85.1])], 'one seed of row 4 below row 3 on one set, row 7 above both on both'],
  [verdicts[2], [verdictSet(90, 92, [91, 95], [80]), verdictSet(84, 85, [80], [80])], 'row 4 above row 2 and not row 3, on one set'],
  [verdicts[2], [verdictSet(90, 92, [80], [93]), verdictSet(84, 85, [80], [84])], 'row 7 above the rows 2 and 3 on one set only'],
  [verdicts[3], [verdictSet(90, 92, [89, 95], [90]), verdictSet(84, 85, [84, 99], [83])], 'no lowest seed above row 2, and a row level with row 2 is not above it'],
]
for (const [expected, made, what] of verdictChecks) check(verdictOf(made) === expected, `the verdict is "${expected}" for ${what}`)

// The report of a final run, with made-up counts: the rows 3 to 8 get the rule's counts with some code points moved.
const standIn = (seed: number | null, movedRight: number): FileCounts => {
  const moved = (of: Counts[]) => of.map(row => ({...row, right: Math.max(0, Math.min(row.scored, row.right + movedRight))}))
  return {
    seed, file: seed === null ? null : `made up/seed-${seed}.tables.json`, sha256: seed === null ? null : 'made up', generator: moved(counts[1]!.generator), written: moved(counts[1]!.written), dataset: moved(counts[1]!.generator),
    labelKinds: {generator: labelKindCountsOf(restartAtNextLine, generator, mainRows.generator), written: labelKindCountsOf(restartAtNextLine, written, mainRows.written), dataset: []},
    rightPerText: {generator: [1, 2], written: [3], dataset: []},
  }
}
const asItIsCounts: FileCounts = {...standIn(null, 0), generator: counts[0]!.generator, written: counts[0]!.written, dataset: counts[0]!.generator}
const madeUpRows = (row4: number[], row7: number[]): RowCounts[] => [
  {label: '1', name: 'the parser as it is', description: 'made up', files: [asItIsCounts]},
  {label: '2', name: 'one rule', description: 'made up', files: [standIn(null, 0)]},
  {label: '3', name: 'hand-written', description: 'made up', files: [standIn(0, 30)]},
  {label: '4', name: 'row 4', description: 'made up', files: row4.map((moved, at) => standIn(at + 1, moved))},
  ...['5', '6'].map(label => ({label, name: `row ${label}`, description: 'made up', files: [standIn(1, 5), standIn(2, 50)]})),
  {label: '7', name: 'row 7', description: 'made up', files: row7.map((moved, at) => standIn(at + 1, moved))},
  {label: '8', name: 'row 8', description: 'made up', files: [standIn(1, 5), standIn(2, 50)]},
]
const madeUpFacts: RunFacts = {
  dryRun: false, time: 'made up', commit: 'made up', uncommittedChanges: false, command: 'made up', listFile: 'made up', listSha256: 'made up', datasetKey: 'made up', countsFile: 'made up',
  titles: {generator: 'made up', written: 'made up', dataset: 'made up'}, texts: {generator: {ids: ['made up'], scored: [1]}, written: {ids: [], scored: []}, dataset: {ids: [], scored: []}}, files: [], secondCounts: {compared: 0, different: []}, unchangedTables: {compared: 0, different: []}, asToday: [],
  datasetSplit: {split: 'test', indexesMade: 0, texts: 0, ofHeldOutTemplates: 0}, problems: [],
}
const reportChecks: [expected: typeof verdicts[number], row4: number[], row7: number[]][] = [[verdicts[0], [40, 60], [0]], [verdicts[1], [40, -5], [31, 45]], [verdicts[2], [10, 45], [-5]], [verdicts[3], [-1, 45], [0, 3]]]
for (const [expected, row4, row7] of reportChecks) {
  const rows = madeUpRows(row4, row7)
  const report = describeReport(rows, [], madeUpFacts)
  const text = report.join('\n')
  check(report[0] === heldBackLine && text.includes(`**${expected[0]!.toUpperCase()}${expected.slice(1)}.**`) && !/left for the final run|NaN|undefined|dry run/.test(text),
    `the report of a final run with made-up counts starts with the held-back line, says "${expected}", and has no gap`)
  const saved = JSON.parse(countsFileText({format: 'recovery-toml final counts 1', ...madeUpFacts, rows, bases: []})) as {heldBack?: unknown, rows?: RowCounts[]}
  check(saved.heldBack === heldBackLine && countsFileText({format: 'recovery-toml final counts 1', ...madeUpFacts, rows, bases: []}).startsWith('{"heldBack": "HELD BACK') && JSON.stringify(saved.rows) === JSON.stringify(rows), 'the file of counts starts with the held-back line and gives the counts back when it is read')
}
const dryReport = describeReport(madeUpRows([1], [1]).map(row => ['1', '2'].includes(row.label) ? row : {...row, files: row.files.map(file => ({...file, generator: null, written: null, labelKinds: {...file.labelKinds, generator: null, written: null}, rightPerText: {...file.rightPerText, generator: null, written: null}}))}), [], {...madeUpFacts, dryRun: true})
check(dryReport[0] === heldBackLine && dryReport.slice(1).every(line => line.startsWith('dry run: ')) && dryReport.some(line => line.includes('A dry run has no verdict')), 'every line of a dry run\'s report but the first starts with "dry run: ", and it has no verdict')

// The log, and what run.ts refuses before it reads the list.
check(finalRunsIn(`${heldBackLine}\n`) === 0 && finalRunsIn(`${heldBackLine}\n{"time":"made up"}\n`) === 1, 'a log with its first line alone holds no final run, and one with a line of a run holds one')
const runFile = `${import.meta.dir}/run.ts`
const heldBackFolder = '/no-such-folder/held-back/check-of-the-final-scoring'
const refusals: [what: string, parameters: string[], environment: Record<string, string>, message: RegExp][] = [
  ['a final run without RECOVERY_FINAL', ['--out', heldBackFolder], {}, /reads the test split/],
  ['a dry run with RECOVERY_FINAL', ['--dry-run', '--out', heldBackFolder], {RECOVERY_FINAL: 'yes'}, /runs without the environment variable RECOVERY_FINAL/],
  ['a dry run into a folder that is not below held-back/', ['--dry-run', '--out', '/no-such-folder/check-of-the-final-scoring'], {}, /is not below a folder named held-back/],
]
for (const [what, parameters, environment, message] of refusals) {
  const {RECOVERY_FINAL: _, ...rest} = process.env
  const result = Bun.spawnSync(['bun', runFile, ...parameters], {env: {...rest, ...environment}, stdout: 'pipe', stderr: 'pipe'})
  check(result.exitCode !== 0 && message.test(result.stderr.toString()), `run.ts refuses ${what}`)
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks failed.`)
if (failures > 0) process.exitCode = 1
