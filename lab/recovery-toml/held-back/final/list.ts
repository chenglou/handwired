// The fixed list of the final scoring: every file of saved tables that is scored, with the row of the experiment
// that it belongs to, its seed and the sha256 of its bytes. list.json in this folder is that list. It is made once,
// before the final run, from the three lists that the training side left:
//
// - <runs>/neutral/tables.json: rows 4, 5 and 6, the recipe on the dataset as it is.
// - <runs>/mixed/tables.json: rows 7 and 8, the recipe on the mixed set.
// - <handwritten>/tables.json with tables.json.sha256 beside it: row 3, the hand-written rules.
//
// Run from the repo root, to make the list:
//   bun lab/recovery-toml/held-back/final/list.ts <neutral/tables.json> <mixed/tables.json> <handwritten/tables.json>
// It prints the list. run.ts reads list.json, holds every file against its sha256, and holds the list against the
// three lists as they are then, so a file that was made again after the list was fixed is refused.
//
// list.json holds every path relative to the scratch folder of the TOML track, which is the environment variable
// RECOVERY_SCRATCH: the folder outside the repo that holds runs/, handwritten/ and held-back/, e.g.
// runs/neutral/row-4.seed-1.tables.json. So the file names no folder of the machine that made it. Whatever reads the
// list gets full paths from readList.
import {createHash} from 'node:crypto'
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {isAbsolute, join, relative, resolve, sep} from 'node:path'
import {datasetKey} from '../../learn/dataset-key.ts'

export const listFile = join(import.meta.dir, 'list.json')

// The scratch folder of the TOML track, as a full path. Throws without the environment variable RECOVERY_SCRATCH.
export function scratchFolder(): string {
  const scratch = process.env['RECOVERY_SCRATCH']
  if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to the scratch folder of the TOML track, i.e. the folder outside the repo that holds runs/, handwritten/ and held-back/: list.json names its files relative to that folder, and the saved counts of the final run are below it')
  return resolve(scratch)
}

// The rows of the experiment that have files of tables, as the lead fixed them before any training on TOML. Rows 1
// and 2 have no file: the parser as it is, and the one rule "after an error, start anew at the next line".
export const listedRows = [
  {row: 3, name: 'hand-written rules', description: 'the 39 recovery rules of learn/handwritten/rules.ts in the table form, written by hand with the train and validation samples of both train sets in view. The rules alone, with no search after them'},
  {row: 4, name: 'recipe on neutral damage, no search', description: 'learn/recipe.ts on the dataset as it is, whose damage knows nothing of TOML: the training, the count and the last step. Seeds 1 to 5. The primary row'},
  {row: 5, name: 'recipe on neutral damage, with the search', description: 'the same with the search before the count, seeds 1 to 5. This is the candidate "generic" with all five steps, as the JSON side scored it'},
  {row: 6, name: 'search and count, no training, neutral damage', description: 'the recipe\'s base, its search and its count on the dataset as it is, without the training. Seeds 11 to 13'},
  {row: 7, name: 'recipe on the mixed set, no search', description: 'learn/recipe.ts on train samples of which half have the dataset\'s damage and half have kinds of mistakes written for TOML: the training, the count and the last step. Seeds 1 to 5'},
  {row: 8, name: 'recipe on the mixed set, with the search', description: 'the same with the search before the count, seeds 1 to 5'},
] as const

export type ListedFile = {seed: number | null, path: string, sha256: string}
export type ListedRow = {row: number, name: string, description: string, tables: ListedFile[]}
export type FinalList = {
  format: 'recovery-toml final list 1'
  // The key of the dataset's source files when the list was made, see ../../learn/dataset-key.ts.
  datasetKey: string
  // The three lists that the files were taken from. Like the path of every file below, a full path here, and a
  // path relative to the scratch folder in list.json.
  sourceLists: {neutral: string, mixed: string, handwritten: string}
  rows: ListedRow[]
}

export const sha256OfFile = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

type SavedTablesList = {format?: unknown, datasetKey?: unknown, tables?: unknown}
type SavedTablesEntry = {row?: unknown, seed?: unknown, path?: unknown, sha256?: unknown}

// The files of a list of saved runs, i.e. <runs>/neutral/tables.json or <runs>/mixed/tables.json.
function filesOfSavedRuns(path: string): {row: number, file: ListedFile}[] {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as SavedTablesList
  if (parsed.format !== 'recovery-toml saved tables 1' || !Array.isArray(parsed.tables)) throw new Error(`${path} is no list of saved tables: its format is ${JSON.stringify(parsed.format)}`)
  if (parsed.datasetKey !== datasetKey()) throw new Error(`${path} was made with the dataset ${JSON.stringify(parsed.datasetKey)}, and the dataset is ${datasetKey()} now`)
  return (parsed.tables as SavedTablesEntry[]).map(entry => {
    const {row, seed, path: file, sha256} = entry
    if (typeof row !== 'number' || typeof seed !== 'number' || typeof file !== 'string' || !isAbsolute(file) || typeof sha256 !== 'string') throw new Error(`${path} holds an entry without a row, a seed, a full path or a sha256: ${JSON.stringify(entry)}`)
    return {row, file: {seed, path: file, sha256}}
  })
}

// The file of the hand-written tables: the sha256 comes from the file `<path>.sha256` beside it, whose first word it is.
function fileOfHandwritten(path: string): {row: number, file: ListedFile}[] {
  const sha256 = readFileSync(`${path}.sha256`, 'utf8').trim().split(/\s+/)[0]
  if (sha256 === undefined || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`${path}.sha256 does not start with a sha256`)
  return [{row: 3, file: {seed: null, path, sha256}}]
}

// The list that the three lists give as they are now. Throws when a list names a row that the experiment does not
// have, names a file twice, or leaves a row without a file.
export function listOf(sourceLists: FinalList['sourceLists']): FinalList {
  const files = [...fileOfHandwritten(sourceLists.handwritten), ...filesOfSavedRuns(sourceLists.neutral), ...filesOfSavedRuns(sourceLists.mixed)]
  const paths = files.map(({file}) => file.path)
  const twice = paths.find((path, at) => paths.indexOf(path) !== at)
  if (twice !== undefined) throw new Error(`the three lists name ${twice} twice`)
  const unknown = files.find(({row}) => !listedRows.some(listed => listed.row === row))
  if (unknown !== undefined) throw new Error(`${unknown.file.path} is of row ${unknown.row}, and the rows with files are ${listedRows.map(listed => listed.row).join(', ')}`)
  const rows = listedRows.map(({row, name, description}) => ({row, name, description, tables: files.filter(entry => entry.row === row).map(({file}) => file).sort((left, right) => (left.seed ?? 0) - (right.seed ?? 0))}))
  const empty = rows.find(row => row.tables.length === 0)
  if (empty !== undefined) throw new Error(`the three lists have no file of row ${empty.row}`)
  return {format: 'recovery-toml final list 1', datasetKey: datasetKey(), sourceLists, rows}
}

const listText = (list: FinalList) => `${JSON.stringify(list, null, 1)}\n`

// A list with every path changed by `change`, and everything else as it is, also the order of the fields.
const withPaths = (list: FinalList, change: (path: string) => string): FinalList => ({
  ...list,
  sourceLists: {neutral: change(list.sourceLists.neutral), mixed: change(list.sourceLists.mixed), handwritten: change(list.sourceLists.handwritten)},
  rows: list.rows.map(row => ({...row, tables: row.tables.map(file => ({...file, path: change(file.path)}))})),
})

// The text of a list as list.json holds it: every path relative to the scratch folder. Throws for a path that is
// not below that folder.
export function listFileText(list: FinalList): string {
  const scratch = scratchFolder()
  return listText(withPaths(list, path => {
    const fromScratch = relative(scratch, path)
    if (fromScratch === '' || fromScratch.startsWith('..') || isAbsolute(fromScratch)) throw new Error(`${path} is not below the scratch folder ${scratch}, which RECOVERY_SCRATCH names: list.json holds paths relative to that folder`)
    return fromScratch.split(sep).join('/')
  }))
}

// The list of a file, e.g. of list.json, with full paths. A path of the file that is not a full path is read from
// the scratch folder. Throws for a file that is no such list.
export function readList(path: string = listFile): FinalList {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<FinalList>
  if (parsed.format !== 'recovery-toml final list 1' || !Array.isArray(parsed.rows) || parsed.sourceLists === undefined || typeof parsed.datasetKey !== 'string') throw new Error(`${path} is no list of the final scoring: its format is ${JSON.stringify(parsed.format)}`)
  return withPaths(parsed as FinalList, listed => isAbsolute(listed) ? listed : join(scratchFolder(), listed))
}

// What keeps a list from being scored, as sentences. An empty list means: the list is exactly what the three lists
// give now, it was made with the dataset as it is, and every file is there with the bytes that its sha256 names.
export function problemsOfList(list: FinalList): string[] {
  const problems: string[] = []
  if (list.datasetKey !== datasetKey()) problems.push(`the list was made with the dataset ${list.datasetKey}, and the dataset is ${datasetKey()} now`)
  let fromSources: FinalList | undefined
  try {
    fromSources = listOf(list.sourceLists)
  } catch (error) {
    problems.push(`the three lists cannot be read again: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (fromSources !== undefined && listText(fromSources) !== listText(list)) problems.push('the list is not what the three lists give now: a file was added, removed or made again after the list was fixed, or a row\'s name was changed')
  for (const row of list.rows) {
    for (const file of row.tables) {
      if (!existsSync(file.path)) problems.push(`row ${row.row}: ${file.path} is not there`)
      else if (sha256OfFile(file.path) !== file.sha256) problems.push(`row ${row.row}: ${file.path} has the sha256 ${sha256OfFile(file.path)}, and the list says ${file.sha256}`)
    }
  }
  return problems
}

if (import.meta.main) {
  const [neutral, mixed, handwritten] = process.argv.slice(2)
  if (neutral === undefined || mixed === undefined || handwritten === undefined || process.argv.length !== 5) throw new Error('list.ts takes three paths: <neutral/tables.json> <mixed/tables.json> <handwritten/tables.json>')
  const list = listOf({neutral: resolve(neutral), mixed: resolve(mixed), handwritten: resolve(handwritten)})
  const problems = problemsOfList(list)
  if (problems.length > 0) throw new Error(`the list cannot be fixed: ${problems.join('; ')}`)
  if (existsSync(listFile) && readFileSync(listFile, 'utf8') !== listFileText(list)) throw new Error(`${listFile} is there and holds another list. The list is fixed once: move the file away by hand to make it again.`)
  writeFileSync(listFile, listFileText(list))
  for (const row of list.rows) console.log(`row ${row.row}, ${row.name}: ${row.tables.map(file => `${file.seed === null ? 'no seed' : `seed ${file.seed}`} ${file.sha256.slice(0, 12)}`).join(', ')}`)
  console.log(`${list.rows.reduce((total, row) => total + row.tables.length, 0)} files of tables in ${listFile}, each with the bytes that its sha256 names.`)
}
