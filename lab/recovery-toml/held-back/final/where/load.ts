// What every parser of the final scoring shows at every code point of the two held-back sets, for the scripts of
// this folder, which ask where the trained tables are above and below the one rule and the hand-written rules.
//
// The final scoring (../run.ts) ran once and saved, per file of tables and per text, how many code points are right.
// It did not save which ones. This file runs the same 24 files of ../list.json, the parser as it is and the one rule
// on the same texts again and keeps the outcome of every code point. It trains nothing and changes no table. Before
// it returns, it holds its count of right code points of every text and every parser against the saved counts of
// the final run, so a number of this folder is a breakdown of a number of the final report and no second scoring
// with another result.
//
// Tables with a changed cell are scored on a held-back set, so loadAll asks for RECOVERY_FINAL=yes, as every such
// command does. It also asks for RECOVERY_SCRATCH, the scratch folder of the TOML track: the files of ../list.json
// and the saved counts of the final run, held-back/final/final.counts.json, are read from that folder.
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {displayKind} from '../../../kinds.ts'
import {requireFinal} from '../../../learn/data.ts'
import {type RecoveryTrace, codePointsOf, createTrace, runRecoveryParserInto} from '../../../learn/recovery-parser.ts'
import {type RecoveryTables, asIsTables, checkTables, loadTablesOfThisDataset} from '../../../learn/recovery-tables.ts'
import {runRestartAtNextLine} from '../../../learn/restart-at-next-line.ts'
import {readList, scratchFolder} from '../list.ts'
import {type ScoredText, generatorSet, writtenSet} from '../sets.ts'

export const heldBackLine = 'HELD BACK: whoever builds the parser, the train data, the training or its machinery does not read this file.'
// The saved counts of the final run, in the scratch folder of the track.
const savedCountsFile = () => join(scratchFolder(), 'held-back', 'final', 'final.counts.json')

// The outcome of a code point for one parser.
export const notCounted = 0
export const wrong = 1
export const right = 2

// What a parser shows at a code point, packed into one number, so that two parsers' outputs can be compared: the
// display kind, the depth after the code point (which can be below 0) and the container after it.
const packShown = (kind: number, depth: number, container: number) => kind | ((depth + 64) << 4) | (container << 12)
export const kindOfShown = (shown: number) => shown & 15
export const depthOfShown = (shown: number) => ((shown >> 4) & 255) - 64
export const containerOfShown = (shown: number) => shown >> 12

export type SetKey = 'generator' | 'written'

// One parser of the final scoring: the parser as it is (row 1), the one rule (row 2), or the tables of one file.
export type ScoredParser = {
  // The row of the experiment, '1' to '8'.
  row: string
  seed: number | null
  // E.g. "row 4, seed 2".
  name: string
  // Null for the rule, which is no setting of the tables.
  tables: RecoveryTables | null
  // Per set and per text, in the order of the set's texts: per code point the outcome and what the parser shows.
  outcomes: Record<SetKey, Uint8Array[]>
  shown: Record<SetKey, Uint16Array[]>
}

export type Loaded = {
  sets: Record<SetKey, {texts: readonly ScoredText[]}>
  generatorSamples: ReturnType<typeof generatorSet>['samples']
  writtenCases: ReturnType<typeof writtenSet>['cases']
  parsers: ScoredParser[]
  // Per set and per text: how many code points a score counts, and the positions of the code points per line.
  scored: Record<SetKey, number[]>
}

const sha256Of = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

// Whether a score counts the code point at a position of a text.
export function isCounted(text: ScoredText, position: number): boolean {
  if (text.firstErrorPosition === -1 || position < text.firstErrorPosition) return false
  const label = text.labels[position]
  return label !== undefined && (label.kind !== undefined || label.depth !== undefined)
}

function outcomesOf(text: ScoredText, kinds: ArrayLike<number>, depths: ArrayLike<number>, containers: ArrayLike<number>) {
  const length = text.labels.length
  const outcomes = new Uint8Array(length)
  const shown = new Uint16Array(length)
  for (let position = 0; position < length; position++) {
    shown[position] = packShown(kinds[position]!, depths[position]!, containers[position]!)
    if (!isCounted(text, position)) continue
    const label = text.labels[position]!
    const isRight = (label.kind === undefined || label.kind === kinds[position]) && (label.depth === undefined || label.depth === depths[position]) && (label.container === undefined || label.container === containers[position])
    outcomes[position] = isRight ? right : wrong
  }
  return {outcomes, shown}
}

// The full trace of some tables on a text, e.g. to see which grammar state read a code point. The trace is
// overwritten by the next call.
const sharedTrace = createTrace()
export function traceOf(tables: RecoveryTables, broken: string): RecoveryTrace {
  const {codePoints} = codePointsOf(broken)
  runRecoveryParserInto(sharedTrace, codePoints, 0, codePoints.length, false, tables, codePoints.length)
  return sharedTrace
}

type SavedCounts = {
  rows: {label: string, files: {seed: number | null, sha256: string | null, rightPerText: Record<SetKey, number[]>}[]}[]
  texts: Record<SetKey, {ids: string[], scored: number[]}>
}

// Every parser of the final scoring on both held-back sets. Throws when a file of tables does not have the bytes
// that ../list.json names, or when a count of this file differs from the saved count of the final run.
export function loadAll(): Loaded {
  requireFinal('held-back/final/where/, which scores tables with changed cells on the held-back sets,')
  const generator = generatorSet()
  const written = writtenSet()
  const sets = {generator: {texts: generator.texts}, written: {texts: written.texts}}
  const setKeys: SetKey[] = ['generator', 'written']
  const list = readList()
  const parsers: ScoredParser[] = []
  const add = (row: string, seed: number | null, tables: RecoveryTables | null) => {
    const parser: ScoredParser = {row, seed, name: `row ${row}${seed === null ? '' : `, seed ${seed}`}`, tables, outcomes: {generator: [], written: []}, shown: {generator: [], written: []}}
    for (const key of setKeys) {
      for (const text of sets[key].texts) {
        const trace = tables === null ? runRestartAtNextLine(codePointsOf(text.broken).codePoints) : traceOf(tables, text.broken)
        const {outcomes, shown} = outcomesOf(text, trace.displayKind, trace.depthAfter, trace.containerAfter)
        parser.outcomes[key].push(outcomes)
        parser.shown[key].push(shown)
      }
    }
    parsers.push(parser)
  }
  add('1', null, asIsTables())
  add('2', null, null)
  for (const row of list.rows) {
    for (const file of row.tables) {
      if (sha256Of(file.path) !== file.sha256) throw new Error(`${file.path} does not have the bytes that list.json names`)
      const {tables} = loadTablesOfThisDataset(file.path)
      checkTables(tables)
      add(String(row.row), file.seed, tables)
    }
  }
  const scored = {generator: [] as number[], written: [] as number[]}
  for (const key of setKeys) scored[key] = sets[key].texts.map(text => text.labels.reduce((count, _label, position) => count + (isCounted(text, position) ? 1 : 0), 0))

  // The saved counts of the final run: the same texts in the same order, the same number of counted code points, and
  // per parser the same number of right ones.
  const saved = JSON.parse(readFileSync(savedCountsFile(), 'utf8')) as SavedCounts
  let compared = 0
  for (const key of setKeys) {
    const ids = sets[key].texts.map(text => text.id)
    if (JSON.stringify(ids) !== JSON.stringify(saved.texts[key].ids)) throw new Error(`the texts of the set ${key} are not those of the final run`)
    if (JSON.stringify(scored[key]) !== JSON.stringify(saved.texts[key].scored)) throw new Error(`the counted code points of the set ${key} are not those of the final run`)
    for (const parser of parsers) {
      const savedFile = saved.rows.find(row => row.label === parser.row)?.files.find(file => file.seed === parser.seed)
      if (savedFile === undefined) throw new Error(`the final run has no counts of ${parser.name}`)
      parser.outcomes[key].forEach((outcomes, at) => {
        const rightHere = outcomes.reduce((count, outcome) => count + (outcome === right ? 1 : 0), 0)
        if (rightHere !== savedFile.rightPerText[key][at]) throw new Error(`${parser.name} has ${rightHere} right code points in the text ${ids[at]} here and ${savedFile.rightPerText[key][at]} in the final run`)
        compared++
      })
    }
  }
  console.error(`${parsers.length} parsers on ${sets.generator.texts.length} and ${sets.written.texts.length} texts: all ${compared} counts of right code points per text are those of the final run.`)
  return {sets, generatorSamples: generator.samples, writtenCases: written.cases, parsers, scored}
}

// The rows with several seeds, and the parsers of a row.
export const parsersOfRow = (loaded: Loaded, row: string) => loaded.parsers.filter(parser => parser.row === row)

export const meanOf = (values: readonly number[]) => values.reduce((total, value) => total + value, 0) / values.length
export const percent = (part: number, whole: number, digits = 2) => whole === 0 ? '-' : (100 * part / whole).toFixed(digits)

// How many code points of a text a parser has right, and how many wrong.
export function rightOf(parser: ScoredParser, set: SetKey, textAt: number, keep: (position: number) => boolean = () => true): number {
  const outcomes = parser.outcomes[set][textAt]!
  let count = 0
  for (let position = 0; position < outcomes.length; position++) if (outcomes[position] === right && keep(position)) count++
  return count
}

// The mean over a row's seeds of the right code points of a text, among the positions that `keep` takes.
export const meanRightOf = (loaded: Loaded, row: string, set: SetKey, textAt: number, keep?: (position: number) => boolean) => meanOf(parsersOfRow(loaded, row).map(parser => rightOf(parser, set, textAt, keep)))

// Whether a parser has every counted code point of a text right. A text without a counted code point is not whole.
export function isWhole(loaded: Loaded, parser: ScoredParser, set: SetKey, textAt: number): boolean {
  return loaded.scored[set][textAt]! > 0 && rightOf(parser, set, textAt) === loaded.scored[set][textAt]
}

export const headerNameKind = displayKind.headerName
