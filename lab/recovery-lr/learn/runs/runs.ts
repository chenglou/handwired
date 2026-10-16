// What run.ts and table.ts share: the folder of the saved runs, the names of a run's files and the form of a record.
import {createHash} from 'node:crypto'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {scratchFolder} from '../../grammar/build.ts'
import type {RecipeRow} from '../recipe.ts'
import type {Score} from '../score.ts'

// The folder of the runs: --folder, or <RECOVERY_LR_SCRATCH>/runs/neutral. "neutral" says that the damage of the
// dataset knows nothing of the language.
export const runsFolderOf = (option: string | undefined): string => option ?? join(scratchFolder(), 'runs', 'neutral')

export const tablesFileNameOf = (row: RecipeRow, seed: number): string => `row-${row}.seed-${seed}.tables.json`
export const recordFileNameOf = (row: RecipeRow, seed: number): string => `row-${row}.seed-${seed}.record.json`

export type RunRecord = {
  format: 'recovery-lr run record 1'
  row: RecipeRow
  rowName: string
  seed: number
  // The first so many samples of the train split and of the validation split of the dataset's default seed.
  trainSamples: number
  validationSamples: number
  datasetKey: string
  // The commit of the worktree when the run started, and the files under lab/recovery-lr that differed from it.
  commit: string
  uncommittedFiles: string[]
  startedAt: string
  finishedAt: string
  // Seconds: of the three passes of the training, of the search, and of the whole command, which makes and packs
  // the samples and may hold a second row.
  seconds: {trainingPerPass: number[], search: number, command: number}
  settings: Record<string, number>
  pickedTerminals: string[]
  cellsThatMayChange: number
  // How many cells and display entries hold something else than the tables that the row started from.
  cellsChanged: number
  displayEntriesChanged: number
  tablesFile: string
  sha256: string
  // The scores on the validation split: of the row's tables, of the tables that the row started from, and for a row
  // with a training, of the snapped tables before the search and the count.
  validation: Score
  validationOfTheStart: Score
  validationAfterTheTrainingAlone: Score | null
  // The score of the row's tables on the train samples that the row was made from.
  train: Score
  // The lines that the recipe logged.
  log: string[]
}

export const sha256OfFile = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex')

// The commit of the worktree and the files under lab/recovery-lr that differ from it.
export function stateOfTheWorktree(): {commit: string, uncommittedFiles: string[]} {
  const git = (...parts: string[]): string => {
    const child = Bun.spawnSync(['git', '-C', import.meta.dir, ...parts], {stdout: 'pipe', stderr: 'pipe'})
    if (child.exitCode !== 0) throw new Error(`git ${parts.join(' ')} failed: ${child.stderr.toString()}`)
    return child.stdout.toString()
  }
  const root = git('rev-parse', '--show-toplevel').trim()
  return {commit: git('rev-parse', 'HEAD').trim(), uncommittedFiles: git('-C', root, 'status', '--porcelain', '--', 'lab/recovery-lr').split('\n').filter(line => line !== '')}
}

// Every record of a folder, by row and then by seed.
export function savedRunsOf(folder: string): {record: RunRecord, recordFile: string, tablesFile: string}[] {
  if (!existsSync(folder)) return []
  return readdirSync(folder).filter(name => name.endsWith('.record.json')).map(name => {
    const recordFile = join(folder, name)
    const parsed = JSON.parse(readFileSync(recordFile, 'utf8')) as {format?: string}
    if (parsed.format !== 'recovery-lr run record 1') throw new Error(`${recordFile} is no record of a run`)
    const record = parsed as RunRecord
    return {record, recordFile, tablesFile: join(folder, record.tablesFile)}
  }).sort((left, right) => left.record.row - right.record.row || left.record.seed - right.record.seed)
}

// The mean of the values with the lowest and the highest, e.g. "61.20 (60.90 to 61.55)", or the one value.
export function describeSpread(values: readonly number[], digits = 2): string {
  if (values.length === 0 || values.some(value => Number.isNaN(value))) return 'none'
  if (values.length === 1) return values[0]!.toFixed(digits)
  const mean = values.reduce((total, value) => total + value, 0) / values.length
  return `${mean.toFixed(digits)} (${Math.min(...values).toFixed(digits)} to ${Math.max(...values).toFixed(digits)})`
}
