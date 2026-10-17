// The final scoring of the experiment: the tables that a list file names, next to the baselines of
// ../arms/harness.ts, on the validation split, on the test split and on the written evaluation set of
// ../../written/. It is meant to run once, after every choice between tables is made on the validation split.
//
// Run from the repo root, with RECOVERY_SCRATCH set to the experiment's scratch folder:
//   RECOVERY_FINAL=yes bun lab/recovery-parser/learn/final/run.ts <list.json>
//   bun lab/recovery-parser/learn/final/run.ts --dry-run <list.json>
//
// The list file is a JSON list of entries, see ListEntry, e.g.
//   [{"name": "plain pass", "description": "one pass of the trainer from today's tables, the seeds 1 to 5",
//     "tables": ["plain-pass/seed-1.tables.json", "plain-pass/seed-2.tables.json"],
//     "confirmationTables": ["plain-pass/seed-11.tables.json"]}]
// Each file holds the saved tables of one seed, as runArm of ../arms/harness.ts saves them. An entry is one row of
// the report: every number is the mean over the entry's files, with the lowest and the highest. The confirmation
// files of an entry are a row of their own.
//
// The run writes the report as <list name>.report.md and every count as <list name>.counts.json into
// <RECOVERY_SCRATCH>/final/, and prints the report. What an earlier final run left under the two names is moved into
// a folder `earlier-<time>` there first.
//
// What the run refuses, before it loads a sample:
// - A run without RECOVERY_FINAL=yes, unless it is a dry run.
// - A file of tables that was not saved with the dataset as it is now, see otherDatasetOf in ../recovery-tables.ts.
// And like ../arms/final.ts it appends a line to <RECOVERY_SCRATCH>/arms/final-runs.log before it loads a sample:
// the time, the dataset's key, the commit of the worktree and whether it has uncommitted changes, the command, and
// the name, the path and a hash of each file of tables.
//
// A dry run runs without RECOVERY_FINAL, and refuses to run with it. It reads no test sample: it takes the
// validation split in the place of the test split, with held-out bits that are made up from a sample's place, as
// ../arms/check.ts does for describeFinal. On the written set it scores only the five tables that may be scored
// there before the final run, see scoredOnTheSetAlready in written-score.ts. It writes no line to the log, it names
// its two files <list name>.dry-run.report.md and <list name>.dry-run.counts.json, and every line that it prints or
// writes into its report starts with "dry run: ".
import {appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {basename, dirname, isAbsolute, join, resolve} from 'node:path'
import {handRuleTables} from '../../hand-rules.ts'
import type {Split} from '../../samples.ts'
import {defaultTables} from '../../table-parser.ts'
import {scoreTables as scoreTablesOfTheSet} from '../../written/score.ts'
import {baselineTables, percentSpread, samplesOfTheStandardSet, spreadOf, validationOfTheStandardSet} from '../arms/harness.ts'
import {type Samples, cacheFolderOf, datasetKey, heldOutByKind, heldOutByTemplate, loadSamples, refuseUnknownOptions, requireFinal, selectSamples, splitNames, standardRange, testPart} from '../data.ts'
import {type RecoveryTables, loadTablesOfThisDataset} from '../recovery-tables.ts'
import {type ScoreRow, heldOutRowNames, scoreTables, sharesOf} from '../score.ts'
import {type Score, type WrittenScore, readersOfTheSet, scoreWritten, scoredOnTheSetAlready, sharesOfWritten} from './written-score.ts'

// An entry of the list file: the tables of one row of the report, e.g. the five seeds of one setting of an arm.
// `tables` and `confirmationTables` name files of saved tables, one per seed. A path that is not absolute is read
// from the folder of the list file. `confirmationTables` are tables of the same setting that were made after the
// setting was chosen, e.g. with the seeds 11 to 15: they are a row of their own.
export type ListEntry = {name: string, description: string, tables: string[], confirmationTables?: string[]}

const entryFields = ['name', 'description', 'tables', 'confirmationTables']

// The entries of a list file's text. Throws for anything that is not a list of entries, e.g. an entry with a field
// that an entry does not have: a misspelled `confirmationTables` would otherwise be left out without a word.
export function entriesOfList(text: string): ListEntry[] {
  const parsed: unknown = JSON.parse(text)
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('the list file holds a JSON list with one entry at least, each {"name", "description", "tables": [files], "confirmationTables": [files, optional]}')
  const isListOfFiles = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(file => typeof file === 'string' && file !== '')
  return (parsed as unknown[]).map((value, at) => {
    const where = `entry ${at + 1} of the list file`
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${where} is no object`)
    const entry = value as Record<string, unknown>
    const otherField = Object.keys(entry).find(field => !entryFields.includes(field))
    if (otherField !== undefined) throw new Error(`${where} has the field ${JSON.stringify(otherField)}, and the fields of an entry are ${entryFields.join(', ')}`)
    const {name, description, tables, confirmationTables} = entry
    if (typeof name !== 'string' || name.trim() === '' || /[|\n]/.test(name)) throw new Error(`${where} needs a name: text without a line break and without the character |, which would break the report's tables`)
    if (typeof description !== 'string' || /[|\n]/.test(description)) throw new Error(`${where} needs a description: text without a line break and without the character |`)
    if (!isListOfFiles(tables)) throw new Error(`${where} needs "tables": a list with one file of saved tables at least`)
    if (confirmationTables === undefined) return {name, description, tables}
    if (!isListOfFiles(confirmationTables)) throw new Error(`${where} has "confirmationTables" that are no list of files of saved tables. Leave the field out for an entry without such files.`)
    return {name, description, tables, confirmationTables}
  })
}

// Tables to score: the file that they were saved to and a hash of its bytes, or neither for a baseline.
export type ScoredTables = {file: string | null, hash: string | null, tables: RecoveryTables}

// A row of the report: tables that are scored one by one and reported together.
export type ReportRow = {name: string, description: string, tables: ScoredTables[]}

export const baselineRows = (): ReportRow[] => baselineTables().map(({name, tables}) => ({name, description: 'a baseline of arms/harness.ts', tables: [{file: null, hash: null, tables}]}))

// The rows of a list's entries, with the tables loaded: one row per entry, and one more for its confirmation files.
// `folder` is the folder of the list file. Throws for a file of tables that was not saved with the dataset as it is
// now, for a file that a row names twice, for a file that an entry names in `tables` and in `confirmationTables`,
// and for two rows with one name.
export function rowsOfList(entries: readonly ListEntry[], folder: string): ReportRow[] {
  const pathOf = (file: string) => isAbsolute(file) ? file : resolve(folder, file)
  const rowOf = (name: string, description: string, files: readonly string[]): ReportRow => {
    const paths = files.map(pathOf)
    const twice = paths.find((path, at) => paths.indexOf(path) !== at)
    if (twice !== undefined) throw new Error(`the row ${JSON.stringify(name)} names ${twice} twice: two files of one seed are one run`)
    return {name, description, tables: paths.map(path => ({file: path, hash: Bun.hash(readFileSync(path)).toString(16), tables: loadTablesOfThisDataset(path).tables}))}
  }
  const rows = entries.flatMap(({name, description, tables, confirmationTables}) => {
    if (confirmationTables === undefined) return [rowOf(name, description, tables)]
    // The confirmation row is a second sample of the setting only when its files are other runs than the entry's.
    const paths = new Set(tables.map(pathOf))
    const inBoth = confirmationTables.map(pathOf).find(path => paths.has(path))
    if (inBoth !== undefined) throw new Error(`the entry ${JSON.stringify(name)} names ${inBoth} in "tables" and in "confirmationTables": the confirmation files are other runs than the entry's own files`)
    return [rowOf(name, description, tables), rowOf(`${name}, confirmation files`, `the same with tables that were made after the choice: ${description}`, confirmationTables)]
  })
  const names = [...baselineTables().map(baseline => baseline.name), ...rows.map(row => row.name)]
  const twice = names.find((name, at) => names.indexOf(name) !== at)
  if (twice !== undefined) throw new Error(`two rows of the report would have the name ${JSON.stringify(twice)}: give every entry of the list a name of its own, and none the name of a baseline`)
  return rows
}

// The commit that the worktree of this file is at, as git says it, and whether the worktree holds changes that are
// not committed: a changed or a new file that git does not ignore. The dataset's key covers the files that decide
// what the samples are, and no key covers the code that scores, e.g. ../score.ts, so the log names the commit.
// Throws when git cannot say, e.g. in a copy of the files without the repo.
export function commitOfTheWorktree(): {commit: string, uncommittedChanges: boolean} {
  const git = (parameters: readonly string[]) => {
    const result = Bun.spawnSync(['git', ...parameters], {cwd: import.meta.dir, stdout: 'pipe', stderr: 'pipe'})
    if (result.exitCode !== 0) throw new Error(`git ${parameters.join(' ')} failed in ${import.meta.dir}, so the log of the final runs cannot name the commit of the code: ${result.stderr.toString().trim()}`)
    return result.stdout.toString().trim()
  }
  return {commit: git(['rev-parse', 'HEAD']), uncommittedChanges: git(['status', '--porcelain']) !== ''}
}

// The line that a run appends to the log of the runs that read the test split: the fields of logLineOf in
// ../arms/final.ts, the commit of the worktree with whether it has uncommitted changes, and the command, since this
// folder's commands read the written set too.
export function appendToTheLogOfFinalRuns(scratchFolder: string, time: Date, command: string, tables: readonly {name: string, file: string | null, hash: string | null}[]) {
  const logFolder = join(scratchFolder, 'arms')
  mkdirSync(logFolder, {recursive: true})
  appendFileSync(join(logFolder, 'final-runs.log'), `${JSON.stringify({time: time.toISOString(), datasetKey: datasetKey(), ...commitOfTheWorktree(), command, tables})}\n`)
}

// The name of the last part of the test split: every sample of it.
export const wholeSplit = 'the whole split'

// A set of samples as five sets: one per way a sample can be held out, under the names and in the order of
// heldOutRowNames in ../score.ts, and the whole set.
export function partsByHeldOut(samples: Samples): {name: string, samples: Samples}[] {
  // The row of a sample among heldOutRowNames, as scoreTables picks it: 1 for a held-out kind, plus 2 for the
  // held-out template.
  const rowOf = (heldOut: number) => ((heldOut & heldOutByKind) !== 0 ? 1 : 0) + ((heldOut & heldOutByTemplate) !== 0 ? 2 : 0)
  const places = Int32Array.from({length: samples.sampleCount}, (_, place) => place)
  return [
    ...heldOutRowNames.map((name, row) => ({name, samples: selectSamples(samples, places.filter(place => rowOf(samples.heldOut[place]!) === row))})),
    {name: wholeSplit, samples},
  ]
}

// What a run scores every tables on.
export type ScoredSets = {
  validation: Samples
  // The parts of the test split, see partsByHeldOut, and the split that their samples say they are in: the test
  // split, or the validation split in a dry run.
  testParts: {name: string, samples: Samples}[]
  splitOfTheParts: Split
  // Whether tables are scored on the written set: all of them in the final run, and five in a dry run.
  scoresOnTheWrittenSet: (tables: RecoveryTables) => boolean
}

// Why a set that was loaded with the test split is not the standard set and its test split, or undefined when it
// is. `loaded` and `standard` are the arrays `index` and `split` of the two sets, with one entry per sample. Three
// things have to hold: every index of `range` stands once in the loaded set, e.g. 0 to 59,999, the loaded set has a
// sample of the test split, and without its samples of the test split the loaded set has the indexes of the
// standard set, place by place. Two sets of the right sizes that hold other samples do not pass.
export function problemOfTheLoadedTestSplit(loaded: Pick<Samples, 'index' | 'split'>, standard: Pick<Samples, 'index'>, range: {from: number, to: number} = standardRange): string | undefined {
  const seen = new Uint8Array(range.to - range.from)
  for (const index of loaded.index) {
    if (!(index >= range.from && index < range.to)) return `the set with the test split holds the index ${index}, which is not one of ${range.from} to ${range.to - 1}`
    if (seen[index - range.from] === 1) return `the set with the test split holds the index ${index} twice`
    seen[index - range.from] = 1
  }
  if (loaded.index.length !== seen.length) return `the set with the test split holds ${loaded.index.length} of the ${seen.length} indexes ${range.from} to ${range.to - 1}, and not e.g. ${range.from + seen.indexOf(0)}`
  const testSplit = splitNames.indexOf('test')
  const withoutTest = loaded.index.filter((_, place) => loaded.split[place] !== testSplit)
  if (withoutTest.length === loaded.index.length) return 'the set with the test split holds no sample of the test split'
  if (withoutTest.length !== standard.index.length) return `the set with the test split holds ${withoutTest.length} samples of the other splits, and the standard set holds ${standard.index.length}`
  const place = withoutTest.findIndex((index, at) => index !== standard.index[at])
  return place === -1 ? undefined : `without its test split, the set with the test split has the index ${withoutTest[place]} at the place ${place}, where the standard set has ${standard.index[place]}`
}

// The test split of the standard set. Needs RECOVERY_FINAL. No check runs the loading of the test split, since a
// check reads no test sample, so the function throws unless the loaded set is the standard set and its test split,
// index by index, see problemOfTheLoadedTestSplit.
export function testSplitOfTheStandardSet(): Samples {
  requireFinal('The test split of the standard set')
  const withTest = loadSamples(standardRange.seed, standardRange.from, standardRange.to, cacheFolderOf(), true)
  const problem = problemOfTheLoadedTestSplit(withTest, samplesOfTheStandardSet())
  if (problem !== undefined) throw new Error(`${problem}: the standard set with and without the test split were not made from the same samples`)
  return testPart(withTest)
}

// The sets of the final run: the validation split and the test split of the standard set. Needs RECOVERY_FINAL.
export function setsOfTheFinalRun(): ScoredSets {
  return {validation: validationOfTheStandardSet(), testParts: partsByHeldOut(testSplitOfTheStandardSet()), splitOfTheParts: 'test', scoresOnTheWrittenSet: () => true}
}

// The held-out bits that a dry run makes up from a sample's place: of every 10 samples, 4 have nothing held out, 1
// a kind, 3 the template and 2 both, so that the four parts have other sizes.
const madeUpHeldOutBits = [0, 0, 0, 0, heldOutByKind, heldOutByTemplate, heldOutByTemplate, heldOutByTemplate, heldOutByKind | heldOutByTemplate, heldOutByKind | heldOutByTemplate]

// The sets of a dry run: the validation split, and in the place of the test split the validation split again, with
// made-up held-out bits. No sample of the test split is loaded.
export function setsOfTheDryRun(): ScoredSets {
  const validation = validationOfTheStandardSet()
  const relabeled: Samples = {...validation, withTest: true, heldOut: validation.heldOut.map((_, place) => madeUpHeldOutBits[place % madeUpHeldOutBits.length]!)}
  return {validation, testParts: partsByHeldOut(relabeled), splitOfTheParts: 'validation', scoresOnTheWrittenSet: scoredOnTheSetAlready}
}

const isRowOfAGroup = (row: ScoreRow) => row.name === 'all' || row.name.startsWith('group: ')

// Every count of one tables.
export type TablesCounts = {
  file: string | null
  hash: string | null
  // Every row of scoreTables on the validation split, see ScoreRow in ../score.ts.
  validation: ScoreRow[]
  // Per part of the test split: the row "all" and the rows of the groups, and for the whole split every row, e.g.
  // the row of each kind of damage.
  test: {part: string, rows: ScoreRow[]}[]
  // The parts of scoreWritten, or null for tables that a dry run does not score on the written set.
  written: {all: WrittenScore, generatorKinds: WrittenScore, otherDamage: WrittenScore, unmarked: WrittenScore, perFile: Record<string, WrittenScore>} | null
}

// Scores one tables on the sets. Throws when the four parts of the test split do not add up to the whole split.
export function countsOf({file, hash, tables}: ScoredTables, sets: ScoredSets): TablesCounts {
  const test = sets.testParts.map(({name, samples}) => {
    // A part without a broken sample has no row: scoreTables throws for it.
    const rows = samples.firstDamage.some(firstDamage => firstDamage !== -1) ? scoreTables(tables, samples, {splits: [sets.splitOfTheParts]}).rows : []
    return {part: name, rows: name === wholeSplit ? rows : rows.filter(isRowOfAGroup)}
  })
  const whole = test.at(-1)!.rows
  for (const row of whole.filter(isRowOfAGroup)) {
    for (const count of ['samples', 'nothingToRecover', 'codePoints', 'allRight', 'wholeSamples'] as const) {
      const ofTheParts = test.slice(0, -1).reduce((total, part) => total + (part.rows.find(candidate => candidate.name === row.name)?.[count] ?? 0), 0)
      if (ofTheParts !== row[count]) throw new Error(`the four parts of the ${sets.splitOfTheParts} split have ${ofTheParts} as the count \`${count}\` of the row ${JSON.stringify(row.name)}, and the whole split has ${row[count]}`)
    }
  }
  const written = sets.scoresOnTheWrittenSet(tables) ? scoreWritten(tables) : null
  return {file, hash, validation: scoreTables(tables, sets.validation).rows, test, written: written === null ? null : {...written, perFile: Object.fromEntries(written.perFile)}}
}

// The counts of a row of the report: one per tables of the row.
export type RowCounts = {name: string, description: string, tables: TablesCounts[]}

const withinReach = 'group: within reach of the tables'
const capitalized = (text: string) => `${text[0]!.toUpperCase()}${text.slice(1)}`

// The report as lines of markdown: the rows, then one table per set. Where a row has several tables, a number is
// the mean, with the lowest and the highest in brackets.
export function describeReport(rows: readonly RowCounts[], run: {dryRun: boolean, time: Date, listFile: string, countsFile: string}): string[] {
  const first = rows[0]!.tables[0]!
  const overTables = (row: RowCounts, share: (counts: TablesCounts) => number, digits = 2) => percentSpread(spreadOf(row.tables.map(share)), digits)
  // A share of a row of a score, or NaN when the samples have no such row, e.g. a part without a sample of a group.
  const shareOfRow = (scoreRows: readonly ScoreRow[], name: string, share: 'allThree' | 'whole') => {
    const row = scoreRows.find(candidate => candidate.name === name)
    return row === undefined ? Number.NaN : sharesOf(row)[share]
  }
  const sizeOf = (scoreRows: readonly ScoreRow[]) => {
    const all = scoreRows.find(row => row.name === 'all')
    return all === undefined ? 'no broken sample' : `${all.samples} broken samples, ${all.nothingToRecover} of them with nothing to recover, ${all.codePoints} scored code points`
  }
  const tableOfSamples = (rowsOf: (counts: TablesCounts) => readonly ScoreRow[]) => [
    '| tables | all three | all three, within reach of the tables | whole samples |',
    '| --- | --- | --- | --- |',
    ...rows.map(row => `| ${row.name} | ${overTables(row, counts => shareOfRow(rowsOf(counts), 'all', 'allThree'))} | ${overTables(row, counts => shareOfRow(rowsOf(counts), withinReach, 'allThree'))} | ${overTables(row, counts => shareOfRow(rowsOf(counts), 'all', 'whole'))} |`),
  ]
  const lines = [
    run.dryRun ? '# A dry run of the final scoring' : '# The final scores of the recovery experiment',
    '',
    `Dataset ${datasetKey()}, the exact parser. Scored at ${run.time.toISOString()} from the list ${run.listFile}. Every count is in ${run.countsFile}.`,
    '',
    ...(run.dryRun ? [
      'This is a dry run, and none of its numbers is a final number. It read no sample of the test split: the tables under "The test split" are of validation samples whose held-out bits are made up from their place, so they say nothing about held-out damage. On the written set it scored only today\'s tables and the dataset\'s hand rules.',
      '',
    ] : []),
    'A row is a baseline of arms/harness.ts or the tables that an entry of the list names. Where a row has several files of tables, a number is the mean over the files, with the lowest and the highest in brackets. All numbers are percentages.',
    '',
    '| tables | files | what they are |',
    '| --- | --- | --- |',
    ...rows.map(row => {
      const hashes = new Set(row.tables.map(counts => counts.hash))
      const files = row.tables[0]!.file === null ? 'none' : hashes.size === row.tables.length ? String(row.tables.length) : `${row.tables.length}, which hold ${hashes.size} different tables`
      return `| ${row.name} | ${files} | ${row.description} |`
    }),
    '',
    '## The validation split',
    '',
    `The validation split of the standard set (seed ${standardRange.seed}, indexes ${standardRange.from} to ${standardRange.to - 1}): ${sizeOf(first.validation)}. "All three" is the share of the scored code points with the display kind, the depth and the container right. "Within reach of the tables" is the group of samples that tables of today's layout can label. "Whole samples" is the share of the samples with something to recover in which every scored code point is right.`,
    '',
    ...tableOfSamples(counts => counts.validation),
    '',
    '## The test split',
    '',
    run.dryRun
      ? 'In this dry run: the validation split again, in four parts by made-up held-out bits, and whole.'
      : 'The test split of the standard set holds four kinds of damage and one template that training never sees. One table per way a sample can be held out, and one for the whole split, which is there to add up the four and not to report alone.',
    ...first.test.flatMap(({part, rows: scoreRows}, at) => [
      '',
      `### ${capitalized(part)}`,
      '',
      `${capitalized(sizeOf(scoreRows))}.`,
      '',
      ...tableOfSamples(counts => counts.test[at]!.rows),
    ]),
    '',
    '## The written set',
    '',
  ]
  const scoredOnTheSet = rows.flatMap(row => row.tables).find(counts => counts.written !== null)?.written ?? null
  if (scoredOnTheSet === null) {
    lines.push('No tables of this run were scored on the written set.')
  } else {
    const sizeOfCases = (score: Score) => `${score.cases} cases, ${score.nothingToRecover} of them with nothing to recover, ${score.scored} scored code points`
    const parts = [['every case', 'all'], ['damage of the generator\'s kinds alone', 'generatorKinds'], ['damage that no kind makes', 'otherDamage']] as const
    lines.push(
      `The ${scoredOnTheSet.all.agreedCodePoints.cases} broken texts of lab/recovery-parser/written/, scored in the exact parser. The numbers are of the cases with full agreement from the first error on: ${sizeOfCases(scoredOnTheSet.all.fullAgreement)}. Of them, the cases whose damage is all of the generator's kinds: ${sizeOfCases(scoredOnTheSet.generatorKinds.fullAgreement)}. The cases with damage that no kind makes: ${sizeOfCases(scoredOnTheSet.otherDamage.fullAgreement)}. "Code points" is the share of the scored code points with every scored value right, and "whole cases" the share of the cases with something to recover in which every scored code point is right.`,
      '',
      `| tables | ${parts.flatMap(([name]) => [`code points, ${name}`, `whole cases, ${name}`]).join(' | ')} |`,
      `| --- | ${parts.flatMap(() => ['---', '---']).join(' | ')} |`,
      ...rows.map(row => {
        if (row.tables.some(counts => counts.written === null)) return `| ${row.name} | ${parts.flatMap(() => ['left for the final run', 'left for the final run']).join(' | ')} |`
        return `| ${row.name} | ${parts.flatMap(([, part]) => [
          overTables(row, counts => sharesOfWritten(counts.written![part].fullAgreement).codePoints),
          overTables(row, counts => sharesOfWritten(counts.written![part].fullAgreement).wholeCases, 1),
        ]).join(' | ')} |`
      }),
    )
  }
  lines.push(
    '',
    '## What the numbers are not',
    '',
    '- For the dataset\'s hand rules and for the hand-written rules no split counts as unseen, the test split included: the hand rules were chosen by statistics over every split, and the hand-written rules were written with samples of every split of the old snapshot in view. The same holds for tables that started from them.',
    `- The written set's README has slightly lower numbers for today's tables and for the dataset's hand rules. The README's numbers are of the dataset's plain table parser, which keeps the open containers in a running sum: ${readersOfTheSet.map(reader => {
      const shares = sharesOfWritten(scoreTablesOfTheSet(reader === 'now' ? defaultTables : handRuleTables(reader)).all.fullAgreement)
      return `${reader} ${(100 * shares.codePoints).toFixed(2)} and ${(100 * shares.wholeCases).toFixed(1)}`
    }).join(', ')}. The numbers here are of the exact parser, which keeps a real stack and so has a few more code points right after a closing bracket that does not match, see final/README.md.`,
    '- A case of the written set with a disputed code point is in none of the numbers above. The counts of all cases over their agreed code points, per writer\'s file and without the cases that someone marked as open to another reading are in the file of counts.',
  )
  return lines
}

// JSON text with one line per object whose values are all numbers, strings or null, e.g. a row of a score.
function jsonText(value: unknown, indent = ''): string {
  if (typeof value !== 'object' || value === null) return JSON.stringify(value)
  const inner = `${indent} `
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `[\n${(value as unknown[]).map(entry => `${inner}${jsonText(entry, inner)}`).join(',\n')}\n${indent}]`
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.every(([, entry]) => typeof entry !== 'object' || entry === null)) return JSON.stringify(value)
  return `{\n${entries.map(([key, entry]) => `${inner}${JSON.stringify(key)}: ${jsonText(entry, inner)}`).join(',\n')}\n${indent}}`
}

export const dryRunMark = 'dry run: '

if (import.meta.main) {
  const dryRun = process.argv.includes('--dry-run')
  if (!dryRun) requireFinal('final/run.ts')
  refuseUnknownOptions('final/run.ts', ['--dry-run'])
  if (dryRun && process.env['RECOVERY_FINAL'] !== undefined) throw new Error('final/run.ts --dry-run runs without the environment variable RECOVERY_FINAL: a dry run reads no test sample and scores no chosen tables on the written set. Leave out one of the two.')
  const scratch = process.env['RECOVERY_SCRATCH']
  if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to the experiment\'s scratch folder: the samples\' cache is read from there, the report goes to <RECOVERY_SCRATCH>/final/, and a final run appends a line to <RECOVERY_SCRATCH>/arms/final-runs.log')
  const listFiles = process.argv.slice(2).filter(argument => !argument.startsWith('--'))
  if (listFiles.length !== 1) throw new Error(`final/run.ts takes one list file, and got ${listFiles.length}: bun lab/recovery-parser/learn/final/run.ts [--dry-run] <list.json>`)
  const listFile = resolve(listFiles[0]!)
  const rowsOfTheList = rowsOfList(entriesOfList(readFileSync(listFile, 'utf8')), dirname(listFile))
  const time = new Date()
  // The line is written before a sample is loaded, so a run that fails later is in the log too.
  if (!dryRun) appendToTheLogOfFinalRuns(scratch, time, `final/run.ts ${listFile}`, rowsOfTheList.flatMap(row => row.tables.map(({file, hash}) => ({name: row.name, file, hash}))))
  const sets = dryRun ? setsOfTheDryRun() : setsOfTheFinalRun()
  const rows: RowCounts[] = [...baselineRows(), ...rowsOfTheList].map(({name, description, tables}) => ({name, description, tables: tables.map(scored => countsOf(scored, sets))}))

  const folder = join(scratch, 'final')
  mkdirSync(folder, {recursive: true})
  const listName = basename(listFile).replace(/\.json$/, '')
  const reportFile = join(folder, `${listName}${dryRun ? '.dry-run' : ''}.report.md`)
  const countsFile = join(folder, `${listName}${dryRun ? '.dry-run' : ''}.counts.json`)
  // A final run's files are kept: what an earlier final run wrote under the same names is moved away first.
  const earlier = [reportFile, countsFile].filter(file => !dryRun && existsSync(file))
  if (earlier.length > 0) {
    let earlierFolder = join(folder, `earlier-${time.toISOString().replaceAll(/[^0-9T]/g, '').slice(0, 15)}`)
    while (existsSync(earlierFolder)) earlierFolder += '-again'
    mkdirSync(earlierFolder)
    for (const file of earlier) renameSync(file, join(earlierFolder, basename(file)))
  }
  const report = describeReport(rows, {dryRun, time, listFile, countsFile}).map(line => `${dryRun ? dryRunMark : ''}${line}`)
  writeFileSync(reportFile, `${report.join('\n')}\n`)
  writeFileSync(countsFile, `${jsonText({
    format: 'recovery final counts 1', dryRun, time: time.toISOString(), datasetKey: datasetKey(), list: listFile,
    validation: `the validation split of the standard set: seed ${standardRange.seed}, indexes ${standardRange.from} to ${standardRange.to - 1}`,
    test: dryRun ? 'a dry run: the validation split in the place of the test split, in parts by held-out bits that are made up from a sample\'s place' : 'the test split of the standard set, in parts by what is held out',
    written: dryRun ? 'a dry run: the written set, only for today\'s tables and the dataset\'s hand rules' : 'the written set of lab/recovery-parser/written/',
    rows,
  })}\n`)
  console.log(report.join('\n'))
  console.log(`${dryRun ? dryRunMark : ''}`)
  console.log(`${dryRun ? dryRunMark : ''}The report is in ${reportFile}, and every count in ${countsFile}.`)
}
