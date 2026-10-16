// What the commands of this folder share: the rows of the experiment that a run on the mixed set makes, where a run's
// tables and its record are saved, the record itself, and the score of a parser on a part of the mixed set with the
// rows per half, per family and per kind.
//
// The mixed set of ../mixed.ts is half the dataset's samples, whose damage knows nothing of TOML, and half samples of
// the folder above, whose damage is a kind of mistake written for TOML. The rows, with the numbers that the
// experiment gives them:
//   7  the frozen recipe on the mixed train split: the training, then the count and the last step.
//   8  the same with the search before the count.
// Both come from one call of runRecipe of ../../learn/recipe.ts on mixedSet(), so one training gives both, and every
// step of the recipe that reads train samples reads the mixed ones. They are the rows 4 and 5 of ../../learn/runs/
// with another train split and nothing else changed.
import {createHash} from 'node:crypto'
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join, relative, resolve} from 'node:path'
import {families as familiesOfEdits, kinds as kindsOfEdits} from '../../damage.ts'
import {type Samples, kindsOf, selectSamples} from '../../learn/data.ts'
import type {recipeSettings} from '../../learn/recipe.ts'
import type {Parser} from '../../learn/runs/runs.ts'
import {type CellCounts, type ScoreRow, scoreWith} from '../../learn/score.ts'
import {kinds as kindsOfMistakes} from '../list.ts'
import {groupsOfKinds} from '../samples.ts'
import {families as familiesOfMistakes} from '../types.ts'

export const mixedRows = [7, 8] as const
export type MixedRow = typeof mixedRows[number]
export const rowNames: Record<MixedRow, string> = {
  7: 'on the mixed set: the training, the count, today\'s kinds in the state error',
  8: 'on the mixed set: the training, the search, the count, today\'s kinds in the state error',
}

// The folder of the saved runs: --folder, or <RECOVERY_SCRATCH>/mixed.
export function runsFolderOf(option: string | undefined): string {
  if (option !== undefined) return option
  const scratch = process.env['RECOVERY_SCRATCH']
  if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to a folder outside the repo, or name the folder of the runs with --folder')
  return join(scratch, 'mixed')
}

export const tablesFileNameOf = (row: number, seed: number) => `row-${row}.seed-${seed}.tables.json`
export const recordFileNameOf = (row: number, seed: number) => `row-${row}.seed-${seed}.record.json`
export const listFileName = 'tables.json'

// What a run leaves next to its tables. The fields are the ones of RunRecord of ../../learn/runs/runs.ts, with the
// same format name, so that a reader of those records reads these. What a record of this folder has more: `set`,
// the samples per half, and the key of the kinds.
export type MixedRunRecord = {
  format: 'recovery-toml run record 1'
  row: MixedRow
  rowName: string
  seed: number
  // The samples that the run trained and searched on: the train split of the mixed set of the dataset's indexes
  // `from` to `to - 1` of the dataset's seed, with the number of samples of each half.
  trainedOn: {
    set: 'mixed', datasetSeed: number, from: number, to: number, trainSamples: number, validationSamples: number,
    trainSamplesOfHalf: {neutral: number, kinds: number}, validationSamplesOfHalf: {neutral: number, kinds: number},
  }
  // The key of the dataset's source files, see ../../learn/dataset-key.ts, and the key of the source files of the
  // kinds, see kindsKey of ../mixed.ts. Two runs with the same two keys read the same mixed set.
  datasetKey: string
  kindsKey: string
  // The commit of the worktree when the run started, the files of the experiment's code that differed from the commit
  // then, as lines of `git status`, and a hash of the files of learn/ and of this folder that the run executed.
  commit: string
  uncommittedFiles: string[]
  sourcesHash: string
  startedAt: string
  finishedAt: string
  // The seconds of making the mixed set, of the training, of the search, and of the whole command up to this record.
  seconds: {mixedSet: number, training: number, search: number, command: number}
  // recipeSettings of ../../learn/recipe.ts as the run read them, the seed that draws the order of the search's
  // passes, and the worker threads of the trainer and of the search.
  settings: typeof recipeSettings & {orderSeedOfTheSearch: number, workerThreads: number}
  // The steps that made the tables, in their order.
  steps: string[]
  // The classes that the rule picked from the mixed train samples, and how many grammar cells the first kept setting
  // keeps.
  classes: string[]
  keptGrammarCells: number
  // What the search did. Null for row 7.
  search: {passes: number, lastPassChangedNothing: boolean, changes: number, runs: number} | null
  // The file of the tables in the record's folder, and the sha256 of its bytes.
  tablesFile: string
  sha256: string
  // The score on the mixed validation split with the exact parser: every row of scoreRowsOfMixed below. The first
  // row is "all", and "source: damage" and "source: kinds" are the two halves.
  validation: ScoreRow[]
  // The rows "all", "source: damage" and "source: kinds" of the same tables on the mixed train split.
  train: ScoreRow[]
  // The same three rows on the mixed validation split for the tables after the training alone, i.e. before the
  // search, the count and the last step.
  nextTo: {name: string, validation: ScoreRow[]}
  // What the tables show otherwise than today on 2,000 valid texts with a value of more than 16 levels, from the
  // first error on, see differencesOnTooDeepTexts of ../../learn/recipe.ts.
  tooDeepValidTexts: {texts: number, codePoints: number, state: number, nesting: number, kind: number, openTokenizerCells: number}
  // The cells in which the tables differ from the base of the recipe and from today's parser, see cellCountsOf of
  // ../../learn/score.ts.
  cellsChangedAgainstBase: CellCounts
  cellsThatDifferFromToday: CellCounts
}

export type SavedMixedRun = {record: MixedRunRecord, tablesFile: string, recordFile: string}

// The saved runs of a folder, by row and then by seed.
export function savedRunsOf(folder: string): SavedMixedRun[] {
  if (!existsSync(folder)) return []
  const runs: SavedMixedRun[] = []
  for (const name of readdirSync(folder)) {
    if (!/^row-\d+\.seed-\d+\.record\.json$/.test(name)) continue
    const parsed = JSON.parse(readFileSync(join(folder, name), 'utf8')) as {format?: unknown, trainedOn?: {set?: unknown}}
    if (parsed.format !== 'recovery-toml run record 1' || parsed.trainedOn?.set !== 'mixed') throw new Error(`${join(folder, name)} is no record of a run on the mixed set: its format is ${JSON.stringify(parsed.format)} and its set ${JSON.stringify(parsed.trainedOn?.set)}`)
    const record = parsed as MixedRunRecord
    runs.push({record, tablesFile: join(folder, record.tablesFile), recordFile: join(folder, name)})
  }
  return runs.sort((left, right) => left.record.row - right.record.row || left.record.seed - right.record.seed)
}

const runsFolder = import.meta.dir
const learnFolder = resolve(runsFolder, '../../learn')
export const repoRoot = resolve(runsFolder, '../../../..')

// The files of learn/ and of this folder that a run of run.ts executes: run.ts and every such file that it reaches
// through an import or through the file name of a worker thread, e.g. ../../learn/recipe.ts and
// ../../learn/soft/train-worker.ts. The dataset's files and the files of the kinds are not among them: the dataset's
// key and the key of the kinds are their hashes.
export function filesOfARun(): string[] {
  const reached = new Set<string>()
  const waiting = [join(runsFolder, 'run.ts')]
  while (waiting.length > 0) {
    const file = waiting.pop()!
    if (reached.has(file) || !(file.startsWith(`${learnFolder}/`) || file.startsWith(`${runsFolder}/`))) continue
    reached.add(file)
    for (const match of readFileSync(file, 'utf8').matchAll(/(?:from |import\(|new URL\()'(\.{1,2}\/[^']+\.ts)'/g)) waiting.push(resolve(file, '..', match[1]!))
  }
  return [...reached].sort()
}

// A hash of those files as they are: two runs with the same hash, the same dataset key and the same key of the kinds
// ran the same code on the same samples.
export function sourcesHash(): string {
  const hash = createHash('sha256')
  for (const file of filesOfARun()) hash.update(`${relative(repoRoot, file)} ${createHash('sha256').update(readFileSync(file)).digest('hex')}\n`)
  return hash.digest('hex')
}

// The commit of the worktree, and the lines of `git status` for the dataset's files, for learn/ and for the folder of
// the kinds. The folder held-back/ is left out of the question: nothing here reads it, not even its file names.
export function stateOfTheWorktree(): {commit: string, uncommittedFiles: string[]} {
  const git = (...argumentsOfGit: string[]) => {
    const result = Bun.spawnSync(['git', ...argumentsOfGit], {cwd: repoRoot})
    if (result.exitCode !== 0) throw new Error(`git ${argumentsOfGit.join(' ')} failed: ${result.stderr.toString()}`)
    return result.stdout.toString()
  }
  const status = git('status', '--porcelain', '--', ':(glob)lab/recovery-toml/*.ts', 'lab/recovery-toml/learn', 'lab/recovery-toml/kinds')
  return {commit: git('rev-parse', 'HEAD').trim(), uncommittedFiles: status.split('\n').filter(line => line !== '')}
}

// The names of the rows of the two halves in a score of the mixed set, see labeledTextOf of ../mixed.ts.
export const neutralHalfRowName = 'source: damage'
export const kindsHalfRowName = 'source: kinds'
export const halfRowNames = ['all', neutralHalfRowName, kindsHalfRowName] as const

const familyOfEdit = new Map(kindsOfEdits.map(kind => [kind.name, kind.family as string]))
const familyOfMistake = new Map(kindsOfMistakes.map(kind => [kind.name, kind.family as string]))
export const namesOfMistakes = kindsOfMistakes.map(kind => kind.name)
export const familyOfMistakeNamed = (name: string) => familyOfMistake.get(name)
export const editFamilyRowNames = familiesOfEdits.map(family => `family of edit: ${family}`)
export const oneEditFamilyRowNames = familiesOfEdits.map(family => `one edit, family of edit: ${family}`)
export const mistakeFamilyRowNames = familiesOfMistakes.map(family => `family of kinds: ${family}`)
export const kindRowNameOf = (kind: string) => `kind: ${kind}`
export const aloneKindRowNameOf = (kind: string) => `alone, kind: ${kind}`

// The rows of a parser's score on samples of one split of the mixed set, e.g. its validation part:
// - the rows of scoreWith: "all", the halves "source: damage" (the dataset's samples) and "source: kinds" (the
//   samples of the folder above), a row per group, e.g. "group: two edits" and "group: one kind", and a row per kind
//   of edit and per kind of mistake with every sample that has the kind, e.g. "kind: colonForEquals",
// - "family of edit: run": every sample of the dataset's half with an edit of the family, and "one edit, family of
//   edit: run": its samples with one edit, which is of the family,
// - "family of kinds: strings": every sample of the other half with a kind of the family,
// - "alone, kind: colonForEquals": the samples with that kind of mistake and no other.
// A sample with two kinds or with edits of two families is in the row of each. A row without a sample is left out.
export function scoreRowsOfMixed(parser: Parser, samples: Samples, split: 'train' | 'validation' = 'validation'): ScoreRow[] {
  const rows = [...scoreWith(samples, {splits: [split]}, parser(samples)).rows]
  const kindsOfSample = Array.from({length: samples.sampleCount}, (_, place) => kindsOf(samples, place))
  const oneEdit = samples.groupNames.indexOf('one edit')
  const oneKind = samples.groupNames.indexOf(groupsOfKinds[0])
  const broken = Int32Array.from({length: samples.sampleCount}, (_, place) => place).filter(place => samples.firstDamage[place] !== -1)
  const addRow = (name: string, wanted: (place: number) => boolean) => {
    const places = broken.filter(wanted)
    if (places.length === 0) return
    const part = selectSamples(samples, places)
    rows.push({...scoreWith(part, {splits: [split], breakdowns: false}, parser(part)).rows[0]!, name})
  }
  for (const onlyOneEdit of [false, true]) {
    for (const family of familiesOfEdits) {
      addRow(`${onlyOneEdit ? 'one edit, ' : ''}family of edit: ${family}`, place => kindsOfSample[place]!.some(kind => familyOfEdit.get(kind) === family) && (!onlyOneEdit || samples.group[place] === oneEdit))
    }
  }
  for (const family of familiesOfMistakes) addRow(`family of kinds: ${family}`, place => kindsOfSample[place]!.some(kind => familyOfMistake.get(kind) === family))
  for (const kind of namesOfMistakes) addRow(aloneKindRowNameOf(kind), place => samples.group[place] === oneKind && kindsOfSample[place]!.length === 1 && kindsOfSample[place]![0] === kind)
  return rows
}

// The rows "all" and of the two halves alone, e.g. for the train split, where no breakdown is read.
export function halfRowsOf(parser: Parser, samples: Samples, split: 'train' | 'validation'): ScoreRow[] {
  const {rows} = scoreWith(samples, {splits: [split]}, parser(samples))
  return halfRowNames.flatMap(name => rows.filter(row => row.name === name))
}

export const rowNamed = (rows: readonly ScoreRow[], name: string): ScoreRow | undefined => rows.find(row => row.name === name)
