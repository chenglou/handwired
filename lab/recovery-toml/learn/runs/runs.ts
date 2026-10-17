// What the commands of this folder share: the rows of the experiment that a run makes, where a run's tables and its
// record are saved, the record itself, and the score of a parser with the rows per family of edit.
//
// The rows, with the numbers that the experiment gives them:
//   4  the frozen recipe: the training, then the count and the last step. The primary row.
//   5  the same with the search before the count.
//   6  the search and the count from the base of the recipe, without the training.
// Rows 4 and 5 come from one call of runRecipe of ../recipe.ts, so one training gives both. Row 6 is the control of
// lab/recovery-parser/learn/arms/combined/combined.ts that is called "search-alone" there, i.e. its recipe
// `counted(searched(untrained)(1))`: the recipe's base, its search over the same cells with the same four passes
// and the same order per seed, and its count. That control has no last step, so row 6 has none.
import {createHash} from 'node:crypto'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join, relative, resolve} from 'node:path'
import {families, kinds as kindsOfDamage} from '../../damage.ts'
import {type Samples, kindsOf, selectSamples} from '../data.ts'
import type {recipeSettings} from '../recipe.ts'
import type {RecoveryTrace} from '../recovery-parser.ts'
import {type RecoveryTables, checkTables} from '../recovery-tables.ts'
import {runRestartAtNextLineInto} from '../restart-at-next-line.ts'
import {type CellCounts, type ScoreRow, runOnSample, scoreWith} from '../score.ts'

export const runRows = [4, 5, 6] as const
export type RunRow = typeof runRows[number]
export const rowNames: Record<RunRow, string> = {
  4: 'the training, the count, today\'s kinds in the state error',
  5: 'the training, the search, the count, today\'s kinds in the state error',
  6: 'the search and the count, without the training',
}

// The folder of the saved runs: --folder, or <RECOVERY_SCRATCH>/neutral, since the runs of this folder train on the
// dataset as it is, whose damage knows nothing of TOML.
export function runsFolderOf(option: string | undefined): string {
  if (option !== undefined) return option
  const scratch = process.env['RECOVERY_SCRATCH']
  if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to a folder outside the repo, or name the folder of the runs with --folder')
  return join(scratch, 'neutral')
}

export const tablesFileNameOf = (row: RunRow, seed: number) => `row-${row}.seed-${seed}.tables.json`
export const recordFileNameOf = (row: RunRow, seed: number) => `row-${row}.seed-${seed}.record.json`
export const listFileName = 'tables.json'

// What a run leaves next to its tables.
export type RunRecord = {
  format: 'recovery-toml run record 1'
  row: RunRow
  rowName: string
  seed: number
  // The samples that the run trained or searched on: the train split of the dataset's samples `from` to `to - 1` of
  // the dataset's seed.
  trainedOn: {datasetSeed: number, from: number, to: number, trainSamples: number, validationSamples: number}
  // The key of the dataset's source files when the run started, see ../dataset-key.ts.
  datasetKey: string
  // The commit of the worktree when the run started, the files of the experiment's code that differed from the commit
  // then, as lines of `git status`, and a hash of the files of learn/ that the run executed, see filesOfARun.
  commit: string
  uncommittedFiles: string[]
  sourcesHash: string
  startedAt: string
  finishedAt: string
  // The seconds of the training, of the search, and of the whole command up to this record.
  seconds: {training: number, search: number, command: number}
  // recipeSettings of ../recipe.ts as the run read them, the seed that draws the order of the search's passes, and
  // the worker threads of the trainer and of the search.
  settings: typeof recipeSettings & {orderSeedOfTheSearch: number, workerThreads: number}
  // The steps that made the tables, in their order.
  steps: string[]
  // The classes that the rule picked from the train samples, and how many grammar cells the first kept setting keeps.
  classes: string[]
  keptGrammarCells: number
  // What the search did. Null for row 4.
  search: {passes: number, lastPassChangedNothing: boolean, changes: number, runs: number} | null
  // The file of the tables in the record's folder, and the sha256 of its bytes.
  tablesFile: string
  sha256: string
  // The score on the validation split with the exact parser: every row of scoreRowsOf below.
  validation: ScoreRow[]
  // The row "all" of the same tables on the train split.
  train: ScoreRow
  // The row "all" on the validation split of tables that are one step away from the saved ones. For rows 4 and 5:
  // the tables after the training alone. For row 6: the saved tables with the recipe's last step added.
  nextTo: {name: string, validation: ScoreRow}
  // What the tables show otherwise than today on 2,000 valid texts with a value of more than 16 levels, from the
  // first error on, see differencesOnTooDeepTexts of ../recipe.ts.
  tooDeepValidTexts: {texts: number, codePoints: number, state: number, nesting: number, kind: number, openTokenizerCells: number}
  // The cells in which the tables differ from the base of the recipe and from today's parser, see cellCountsOf of
  // ../score.ts.
  cellsChangedAgainstBase: CellCounts
  cellsThatDifferFromToday: CellCounts
}

export type SavedRun = {record: RunRecord, tablesFile: string, recordFile: string}

// The saved runs of a folder, by row and then by seed.
export function savedRunsOf(folder: string): SavedRun[] {
  if (!existsSync(folder)) return []
  const runs: SavedRun[] = []
  for (const name of readdirSync(folder)) {
    if (!/^row-\d+\.seed-\d+\.record\.json$/.test(name)) continue
    const parsed = JSON.parse(readFileSync(join(folder, name), 'utf8')) as {format?: unknown}
    if (parsed.format !== 'recovery-toml run record 1') throw new Error(`${join(folder, name)} is no record of a run: its format is ${JSON.stringify(parsed.format)}`)
    const record = parsed as RunRecord
    runs.push({record, tablesFile: join(folder, record.tablesFile), recordFile: join(folder, name)})
  }
  return runs.sort((left, right) => left.record.row - right.record.row || left.record.seed - right.record.seed)
}

export const sha256OfFile = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

const learnFolder = resolve(import.meta.dir, '..')
export const repoRoot = resolve(learnFolder, '../../..')

// The files of learn/ that a run of run.ts executes: run.ts and every file of learn/ that it reaches through an
// import or through the file name of a worker thread, e.g. ../recipe.ts and ../soft/train-worker.ts. The dataset's
// files are not among them: the dataset's key is their hash.
export function filesOfARun(): string[] {
  const reached = new Set<string>()
  const waiting = [join(import.meta.dir, 'run.ts')]
  while (waiting.length > 0) {
    const file = waiting.pop()!
    if (reached.has(file) || !file.startsWith(`${learnFolder}/`)) continue
    reached.add(file)
    for (const match of readFileSync(file, 'utf8').matchAll(/(?:from |import\(|new URL\()'(\.{1,2}\/[^']+\.ts)'/g)) waiting.push(resolve(file, '..', match[1]!))
  }
  return [...reached].sort()
}

// A hash of those files as they are: two runs with the same hash and the same dataset key ran the same code on the
// same samples.
export function sourcesHash(): string {
  const hash = createHash('sha256')
  for (const file of filesOfARun()) hash.update(`${relative(learnFolder, file)} ${createHash('sha256').update(readFileSync(file)).digest('hex')}\n`)
  return hash.digest('hex')
}

// The commit of the worktree, and the lines of `git status` for the dataset's files and for learn/. The folder
// held-back/ is left out of the question: nothing here reads it, not even its file names.
export function stateOfTheWorktree(): {commit: string, uncommittedFiles: string[]} {
  const git = (...argumentsOfGit: string[]) => {
    const result = Bun.spawnSync(['git', ...argumentsOfGit], {cwd: repoRoot})
    if (result.exitCode !== 0) throw new Error(`git ${argumentsOfGit.join(' ')} failed: ${result.stderr.toString()}`)
    return result.stdout.toString()
  }
  const status = git('status', '--porcelain', '--', ':(glob)lab/recovery-toml/*.ts', 'lab/recovery-toml/learn')
  return {commit: git('rev-parse', 'HEAD').trim(), uncommittedFiles: status.split('\n').filter(line => line !== '')}
}

// A parser for a score: for a set of samples, the function that writes what the parser shows for the sample at
// `place` into a trace's displayKind, depthAfter and containerAfter.
export type Parser = (samples: Samples) => (place: number, trace: RecoveryTrace) => void

export function parserOfTables(tables: RecoveryTables): Parser {
  checkTables(tables)
  return samples => (place, trace) => runOnSample(trace, samples, place, tables)
}

// Row 2 of the experiment: after an error, the parser as it is starts anew at the next line.
export const restartAtNextLine: Parser = samples => (place, trace) => runRestartAtNextLineInto(trace, samples.codePoints, samples.start[place]!, samples.start[place + 1]! - samples.start[place]!)

const familyOfKind = new Map(kindsOfDamage.map(kind => [kind.name, kind.family]))
export const familyRowNames = families.map(family => `family: ${family}`)
export const oneEditFamilyRowNames = families.map(family => `one edit, family: ${family}`)

// The rows of a parser's score on samples of one split, e.g. the validation part of the standard set: the rows of
// scoreWith ("all", "group: one edit", "kind: deleteRun" and so on), then two rows per family of edit:
// - "family: run": every sample with an edit of the family. A sample with edits of two families is in both rows.
// - "one edit, family: run": the samples with one edit, whose family is the family of that edit.
// A family without a sample has no row, e.g. "one edit, family: tail": a cut alone leaves nothing to score.
export function scoreRowsOf(parser: Parser, samples: Samples, split: 'train' | 'validation' = 'validation'): ScoreRow[] {
  const rows = [...scoreWith(samples, {splits: [split]}, parser(samples)).rows]
  const oneEdit = samples.groupNames.indexOf('one edit')
  const familiesOfSample = Array.from({length: samples.sampleCount}, (_, place) => new Set(kindsOf(samples, place).map(kind => familyOfKind.get(kind))))
  for (const onlyOneEdit of [false, true]) {
    for (const family of families) {
      const places = Int32Array.from({length: samples.sampleCount}, (_, place) => place).filter(place => samples.firstDamage[place] !== -1 && familiesOfSample[place]!.has(family) && (!onlyOneEdit || samples.group[place] === oneEdit))
      if (places.length === 0) continue
      const part = selectSamples(samples, places)
      rows.push({...scoreWith(part, {splits: [split], breakdowns: false}, parser(part)).rows[0]!, name: `${onlyOneEdit ? 'one edit, ' : ''}family: ${family}`})
    }
  }
  return rows
}

export const rowNamed = (rows: readonly ScoreRow[], name: string): ScoreRow | undefined => rows.find(row => row.name === name)

// The mean, the lowest and the highest of the values of some seeds, as text: "91.45 (90.10 to 92.03)", or the value
// alone for one.
export function describeSpread(values: readonly number[], digits = 2): string {
  if (values.length === 0) return '-'
  const mean = values.reduce((total, value) => total + value, 0) / values.length
  if (values.length === 1) return mean.toFixed(digits)
  return `${mean.toFixed(digits)} (${Math.min(...values).toFixed(digits)} to ${Math.max(...values).toFixed(digits)})`
}
