// What every arm of the experiment shares, so that every arm is scored and reported the same way:
//
// - recordOf(tables, base): the standard record of snapped tables, always from the exact parser on the validation
//   split of the standard set.
// - runArm({name, settings, seeds}): runs each setting's build function for every seed, saves each seed's tables and
//   record under <RECOVERY_SCRATCH>/arms/<name>/, and prints one markdown row per setting with the mean, the lowest
//   and the highest over the seeds.
// - describeComparison(first, second): two settings next to each other, always with the spread of each.
// - baselines(): the rows that every arm is read against, through the same record.
//
// README.md of this folder says how to write an arm with them. Nothing here reads the test split: the samples that
// loadStandardSamples gives hold no test sample. final.ts is the one script for the test split.
import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {type HandRule, handRuleTables, handRules} from '../../hand-rules.ts'
import {createRandom} from '../../random.ts'
import {type ParserTrace, positionCount, runTableParser} from '../../table-parser.ts'
import {wrongDepthsOnDeepTexts} from '../check-deep.ts'
import {checkTexts, textWithAddedClasses} from '../check-texts.ts'
import {type Samples, groupNames, loadStandardSamples, standardRange, textOf, validationPart} from '../data.ts'
import {handwrittenTables} from '../handwritten/rules.ts'
import {plainParserProblems, recoveryTablesOf} from '../plain-tables.ts'
import {type RecoveryTrace, codePointsOf, createTrace, runRecoveryParserInto} from '../recovery-parser.ts'
import {type RecoveryTables, asIsTables, cellCounts, checkTables, differencesOf, saveTables, today} from '../recovery-tables.ts'
import {type CellCounts, type ScoreRow, cellsReadAt, countCells, isRead, scoreTables, sharesOf} from '../score.ts'

// The standard record of some tables.
export type ArmRecord = {
  format: 'recovery arm record 1'
  // The dataset that the record was scored on, see datasetKey in ../data.ts. Two records compare only with the same key.
  datasetKey: string
  // What was scored: always the exact parser on the validation split of the standard set.
  scoredOn: string
  // Every row of the score, as counts, see ScoreRow in ../score.ts: "all", the six groups as "group: <name>", the
  // kinds of damage as "kind: <name>", and the rows of the sources, the families and the debatable samples. sharesOf
  // turns a row into shares, and rowNamed finds one.
  rows: ScoreRow[]
  // What the main number does not show.
  // The share of the code points that the damage added that are shown as an error, from 0 to 1, and the share of the
  // samples that show an error at or after the first damage.
  addedShownAsError: number
  samplesShowingError: number
  // Code points of the texts that are shown as past the end, the display kind of the cells after a text.
  shownAsPastEnd: number
  // The share of wrong depths on valid JSON of 17 to 19 levels, from the first error on, see ../check-deep.ts: on
  // texts with nothing after their nested containers, and on texts with members after them. Today's parser has 0 in
  // both.
  wrongDepthsOnDeepValidJson: {nothingAfter: number, membersAfter: number}
  // Two counts of cells, per table, see cellCountsOf in ../score.ts: what the run changed against the tables it
  // started from, and what differs from today's parser. And how many of the changed cells a code point of a
  // validation sample reads.
  cellsChangedAgainstBase: CellCounts
  cellsThatDifferFromToday: CellCounts
  changedCellsReadByValidation: number
  // What the tables have besides today's layout.
  structure: {lexerStates: number, grammarStates: number, addedClasses: string[], firstOnLineBit: boolean, openDisplayEntries: number}
  // Whether the ground rules hold on a fixed set of texts: every text has today's trace up to its first error, and
  // today's verdict (valid, the first error's position and kind). `problems` holds the first differences.
  groundRules: {hold: boolean, texts: number, problems: string[]}
  // What keeps the dataset's two proofs and its bound from holding for the tables, see plainParserProblems in
  // ../plain-tables.ts: the sentences of the dataset's conditionProblems, and a sentence for stack actions and for
  // the bit. An empty list means that the tables are tables of the plain table parser.
  plainParserProblems: string[]
}

export const rowNamed = (record: ArmRecord, name: string): ScoreRow => {
  const row = record.rows.find(candidate => candidate.name === name)
  if (row === undefined) throw new Error(`the record has no row ${JSON.stringify(name)}`)
  return row
}

// The samples that every record is scored on, loaded once per process.
let standardSamples: Samples | undefined
let standardValidation: Samples | undefined
export function samplesOfTheStandardSet(): Samples {
  standardSamples ??= loadStandardSamples()
  return standardSamples
}
export function validationOfTheStandardSet(): Samples {
  standardValidation ??= validationPart(samplesOfTheStandardSet())
  return standardValidation
}

// The fixed texts of the ground rule check: texts made in ../check-texts.ts (valid ones, among them texts with 16
// levels and with 512 code points, edited ones, random punctuation, texts that are too long or too deep, and texts
// with the code points of the classes that the checks add), and the broken texts of the first 1,500 validation
// samples. Each with today's trace.
let groundRuleTexts: {text: string, codePoints: number[], truncated: boolean, expected: ParserTrace}[] | undefined
function textsOfTheGroundRuleCheck() {
  if (groundRuleTexts !== undefined) return groundRuleTexts
  const texts: string[] = checkTexts(createRandom(20261015, 9), 1000).map(entry => entry.text)
  const random = createRandom(20261015, 10)
  for (let index = 0; index < 300; index++) texts.push(textWithAddedClasses(random))
  const validation = validationOfTheStandardSet()
  for (let place = 0; place < Math.min(1500, validation.sampleCount); place++) texts.push(textOf(validation, place))
  groundRuleTexts = texts.map(text => ({text, ...codePointsOf(text), expected: runTableParser(text)}))
  return groundRuleTexts
}

// The fields of a trace that have to be today's before the first error, in today's terms: the class of a code point
// as the class it has today, and the context without the bit "first on its line".
const comparedFields = ['lexerStateBefore', 'event', 'token', 'grammarBefore', 'grammarAfter', 'displayKind', 'depthAfter', 'containerAfter'] as const
function groundRuleDifference(trace: RecoveryTrace, expected: ParserTrace, tables: RecoveryTables): string | undefined {
  if (trace.valid !== expected.valid) return `valid is ${trace.valid}, and today's is ${expected.valid}`
  if (trace.firstErrorPosition !== expected.firstErrorPosition) return `the first error is at ${trace.firstErrorPosition}, and today's at ${expected.firstErrorPosition}`
  if (trace.firstErrorKind !== expected.firstErrorKind) return `the first error's kind is ${trace.firstErrorKind}, and today's ${expected.firstErrorKind}`
  const positions = expected.valid ? positionCount : expected.firstErrorPosition
  for (let position = 0; position < positions; position++) {
    for (const field of comparedFields) if (trace[field][position] !== expected[field][position]) return `${field} at position ${position} is ${trace[field][position]}, and today's is ${expected[field][position]}`
    if (tables.classToday[trace.characterClass[position]!] !== expected.characterClass[position]) return `the class at position ${position} is not today's`
    if (trace.context[position]! % today.contextCount !== expected.context[position]) return `the context at position ${position} is not today's`
  }
  return undefined
}

// Whether the ground rules hold for `tables` on the fixed texts: today's trace before every first error, and
// today's verdict. checkTables already refuses tables with a changed frozen cell, so a difference here means that
// the masks of open cells are wrong, or the parser.
export function groundRulesOn(tables: RecoveryTables): ArmRecord['groundRules'] {
  const texts = textsOfTheGroundRuleCheck()
  const trace = createTrace()
  const problems: string[] = []
  for (const {text, codePoints, truncated, expected} of texts) {
    runRecoveryParserInto(trace, codePoints, 0, codePoints.length, truncated, tables)
    const difference = groundRuleDifference(trace, expected, tables)
    if (difference !== undefined && problems.length < 5) problems.push(`${difference} in ${JSON.stringify(text.slice(0, 60))}`)
    if (difference !== undefined && problems.length === 5) break
  }
  return {hold: problems.length === 0, texts: texts.length, problems}
}

// The standard record of `tables`, which a run made from `base`, e.g. today's tables, or today's tables with added
// structure. The score is always the exact parser's on the validation split of the standard set. Throws when the
// tables break the ground rules that checkTables knows, e.g. a changed frozen cell.
export function recordOf(tables: RecoveryTables, base: RecoveryTables): ArmRecord {
  checkTables(tables)
  checkTables(base)
  const validation = validationOfTheStandardSet()
  const score = scoreTables(tables, validation)
  const all = score.rows[0]!
  const shares = sharesOf(all)
  const changed = differencesOf(base, tables)
  const read = cellsReadAt(tables, validation, Int32Array.from({length: validation.sampleCount}, (_, place) => place))
  return {
    format: 'recovery arm record 1', datasetKey: validation.datasetKey,
    scoredOn: `the exact parser on the validation split of the standard set: seed ${standardRange.seed}, indexes ${standardRange.from} to ${standardRange.to - 1}`,
    rows: score.rows,
    addedShownAsError: shares.addedAsError, samplesShowingError: shares.showsError, shownAsPastEnd: all.shownAsPastEnd,
    wrongDepthsOnDeepValidJson: wrongDepthsOnDeepTexts(tables),
    cellsChangedAgainstBase: countCells(changed), cellsThatDifferFromToday: countCells(differencesOf(asIsTables(), tables)),
    changedCellsReadByValidation: changed.filter(difference => isRead(read, difference)).length,
    structure: {
      lexerStates: tables.lexerStateCount, grammarStates: tables.grammarStateCount, addedClasses: tables.addedClasses.map(added => added.name),
      firstOnLineBit: tables.contextCount > today.contextCount, openDisplayEntries: cellCounts(tables).displayOpen,
    },
    groundRules: groundRulesOn(tables),
    plainParserProblems: plainParserProblems(tables),
  }
}

// The lowest, the mean and the highest of some numbers, e.g. of a score over the seeds.
export type Spread = {mean: number, lowest: number, highest: number, count: number}
export function spreadOf(values: readonly number[]): Spread {
  if (values.length === 0) throw new Error('spreadOf needs one number at least')
  return {mean: values.reduce((total, value) => total + value, 0) / values.length, lowest: Math.min(...values), highest: Math.max(...values), count: values.length}
}
// A spread of shares as percentages, e.g. "94.71 (94.52 to 94.93)", or one number when there is one value.
export function percentSpread(spread: Spread, digits = 2): string {
  const percent = (share: number) => (100 * share).toFixed(digits)
  if (Number.isNaN(spread.mean)) return '-'
  return spread.count === 1 ? percent(spread.mean) : `${percent(spread.mean)} (${percent(spread.lowest)} to ${percent(spread.highest)})`
}
const countSpread = (spread: Spread) => spread.count === 1 || spread.lowest === spread.highest ? String(Math.round(spread.mean)) : `${Math.round(spread.mean)} (${spread.lowest} to ${spread.highest})`

// The records of one setting, one per seed. A setting without seeds, e.g. a baseline, has one record and
// `seeds` empty: it is the same on every run.
export type SettingResult = {name: string, seeds: number[], records: ArmRecord[]}

const overRecords = (result: SettingResult, value: (record: ArmRecord) => number) => spreadOf(result.records.map(value))
const shareOfRow = (rowName: string, share: keyof ReturnType<typeof sharesOf>) => (record: ArmRecord) => sharesOf(rowNamed(record, rowName))[share]

// The markdown tables of some settings, one row per setting: the scores with the mean and the range over the seeds,
// then the same per group, then what the main number does not show.
export function describeSettings(results: readonly SettingResult[]): string {
  const validation = validationOfTheStandardSet()
  const first = results[0]!.records[0]!
  const all = rowNamed(first, 'all')
  const bound = sharesOf(all)
  const seedsOf = (result: SettingResult) => result.seeds.length === 0 ? 'none' : String(result.seeds.length)
  const lines = [
    `Dataset ${validation.datasetKey}. Validation split of the standard set, the exact parser: ${all.samples} broken samples, ${all.nothingToRecover} of them with nothing to recover, ${all.codePoints} scored code points.`,
    'Percentages. Where a setting has several seeds: the mean, and in brackets the lowest and the highest of the seeds.',
    `The dataset's bound for the plain table parser is ${(100 * bound.plainBound).toFixed(2)} of all three and ${(100 * bound.plainBoundWhole).toFixed(2)} of whole samples. The parser here has a stack action per grammar cell and a real stack, so its reach is larger.`,
    '',
    '| setting | seeds | all three | display kind | depth | container | whole samples | cells changed against the base | cells that differ from today\'s parser |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(result => `| ${result.name} | ${seedsOf(result)} | ${percentSpread(overRecords(result, shareOfRow('all', 'allThree')))} | ${percentSpread(overRecords(result, shareOfRow('all', 'kind')))} | ${percentSpread(overRecords(result, shareOfRow('all', 'depth')))} | ${percentSpread(overRecords(result, shareOfRow('all', 'container')))} | ${percentSpread(overRecords(result, shareOfRow('all', 'whole')))} | ${countSpread(overRecords(result, record => record.cellsChangedAgainstBase.total))} | ${countSpread(overRecords(result, record => record.cellsThatDifferFromToday.total))} |`),
    '',
    'All three per group of the dataset, with the group\'s validation samples:',
    '',
    `| setting | ${groupNames.map(group => `${group}, ${rowNamed(first, `group: ${group}`).samples}`).join(' | ')} |`,
    `| --- | ${groupNames.map(() => '---').join(' | ')} |`,
    ...results.map(result => `| ${result.name} | ${groupNames.map(group => percentSpread(overRecords(result, shareOfRow(`group: ${group}`, 'allThree')), 1)).join(' | ')} |`),
    '',
    'What the main number does not show:',
    '',
    '| setting | added code points shown as an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels, nothing after the nested containers | the same, members after the nested containers | ground rules on the fixed texts | tables of the plain table parser |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(result => {
      const holding = result.records.filter(record => record.groundRules.hold).length
      const plain = result.records.filter(record => record.plainParserProblems.length === 0).length
      const of = (count: number, yes: string, no: string) => count === result.records.length ? yes : count === 0 ? no : `${yes} for ${count} of ${result.records.length} seeds`
      return `| ${result.name} | ${percentSpread(overRecords(result, record => record.addedShownAsError), 1)} | ${countSpread(overRecords(result, record => record.shownAsPastEnd))} | ${percentSpread(overRecords(result, record => record.wrongDepthsOnDeepValidJson.nothingAfter), 1)} | ${percentSpread(overRecords(result, record => record.wrongDepthsOnDeepValidJson.membersAfter), 1)} | ${of(holding, 'hold', 'BROKEN')} | ${of(plain, 'yes', `no: ${result.records[0]!.plainParserProblems[0] ?? ''}`)} |`
    }),
  ]
  return lines.join('\n')
}

// Two settings next to each other on the main number, with the spread of each, as one sentence. A difference
// between two means says nothing without the ranges, so a setting that depends on a seed needs 3 seeds at least:
// with fewer the function throws.
export function describeComparison(first: SettingResult, second: SettingResult, rowName = 'all'): string {
  for (const result of [first, second]) {
    if (result.seeds.length > 0 && result.seeds.length < 3) throw new Error(`the setting ${JSON.stringify(result.name)} has ${result.seeds.length} seed${result.seeds.length === 1 ? '' : 's'}: a comparison needs the spread over 3 seeds at least`)
  }
  const spreads = [first, second].map(result => overRecords(result, shareOfRow(rowName, 'allThree')))
  const [firstSpread, secondSpread] = spreads as [Spread, Spread]
  const difference = 100 * (firstSpread.mean - secondSpread.mean)
  const overlap = firstSpread.lowest <= secondSpread.highest && secondSpread.lowest <= firstSpread.highest
  const describe = (result: SettingResult, spread: Spread) => result.seeds.length === 0 ? `${JSON.stringify(result.name)} has ${percentSpread(spread)} and no seed` : `${JSON.stringify(result.name)} has ${percentSpread(spread)} over ${result.seeds.length} seeds`
  return `All three, ${rowName === 'all' ? 'all validation samples' : rowName}: ${describe(first, firstSpread)}, ${describe(second, secondSpread)}. The means differ by ${difference >= 0 ? '+' : ''}${difference.toFixed(2)} points, and the two ranges ${overlap ? 'overlap, so these seeds do not tell the two settings apart' : 'do not overlap'}.`
}

// A setting of an arm: a name for its row, and a function that makes snapped tables for a seed. `base` are the tables
// that the build started from, e.g. asIsTables(), or today's tables with the arm's added structure.
export type ArmSetting = {name: string, build: (seed: number) => Promise<{tables: RecoveryTables, base: RecoveryTables}> | {tables: RecoveryTables, base: RecoveryTables}}

export type ArmOptions = {
  // The arm's name, which is also its folder under <RECOVERY_SCRATCH>/arms/.
  name: string
  settings: readonly ArmSetting[]
  // The seeds of every setting. The default is 1 to 5. Fewer than 5 is for a try-out only: the function says so in
  // what it prints.
  seeds?: readonly number[]
  log?: (line: string) => void
}

// A setting's name as a folder name, e.g. "one-cell-to-value" for "one cell to value".
export function fileNameOf(name: string) {
  const cleaned = name.replaceAll(/[^A-Za-z0-9.-]+/g, '-').replaceAll(/^-|-$/g, '')
  return cleaned === '' ? 'setting' : cleaned
}

// The folder of an arm's saved tables and records, <RECOVERY_SCRATCH>/arms/<name>.
export function armFolderOf(name: string): string {
  const scratch = process.env['RECOVERY_SCRATCH']
  if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to a folder outside the repo: the tables and the records of an arm go there')
  return join(scratch, 'arms', fileNameOf(name))
}

// Runs every setting's build function for every seed, one after the other. Per setting and seed it saves the tables
// to <RECOVERY_SCRATCH>/arms/<name>/<setting>/seed-<seed>.tables.json and the record next to it as
// seed-<seed>.record.json. It prints the tables of describeSettings and saves them as summary.md in the arm's folder.
export async function runArm(options: ArmOptions): Promise<SettingResult[]> {
  const seeds = options.seeds ?? [1, 2, 3, 4, 5]
  const log = options.log ?? (line => console.log(line))
  const folder = armFolderOf(options.name)
  const names = options.settings.map(setting => fileNameOf(setting.name))
  if (new Set(names).size !== names.length) throw new Error('two settings of the arm have the same file name')
  const results: SettingResult[] = []
  for (const setting of options.settings) {
    const settingFolder = join(folder, fileNameOf(setting.name))
    mkdirSync(settingFolder, {recursive: true})
    const records: ArmRecord[] = []
    for (const seed of seeds) {
      const started = performance.now()
      const {tables, base} = await setting.build(seed)
      const record = recordOf(tables, base)
      saveTables(join(settingFolder, `seed-${seed}.tables.json`), tables, `arm ${options.name}, setting ${setting.name}, seed ${seed}`)
      writeFileSync(join(settingFolder, `seed-${seed}.record.json`), `${JSON.stringify(record, null, 1)}\n`)
      records.push(record)
      log(`${options.name}, ${setting.name}, seed ${seed}: all three ${(100 * sharesOf(rowNamed(record, 'all')).allThree).toFixed(2)}% on the validation split, ${record.cellsChangedAgainstBase.total} cells changed against the base, ${((performance.now() - started) / 1000).toFixed(0)} s`)
    }
    results.push({name: setting.name, seeds: [...seeds], records})
  }
  const summary = `${describeSettings(results)}\n${seeds.length < 5 ? `\nOnly ${seeds.length} seed${seeds.length === 1 ? '' : 's'}: a try-out, not a number to report.\n` : ''}`
  writeFileSync(join(folder, 'summary.md'), summary)
  log('')
  log(summary)
  return results
}

// The tables that every arm is read against, each with the tables it started from, which are today's:
// - the parser as it is,
// - the dataset's hand rules (../../hand-rules.ts), three today, as tables of the experiment, with the stack action
//   `by token` in every grammar cell. The list follows the dataset's `handRules`, so a hand rule that a later commit
//   of the dataset adds gets a row by itself,
// - the 35 hand-written rules of ../handwritten/rules.ts as they are.
export function baselineTables(): {name: string, tables: RecoveryTables, base: RecoveryTables}[] {
  const base = asIsTables()
  return [
    {name: 'the parser as it is', tables: asIsTables(), base},
    ...handRules.map((rule: HandRule) => ({name: `the dataset's hand rule ${rule}, as tables of the experiment`, tables: recoveryTablesOf(handRuleTables(rule)), base})),
    {name: 'hand-written, the 35 rules of handwritten/rules.ts', tables: handwrittenTables().tables, base},
  ]
}

// The records of the baselines, one setting each, without seeds.
export function baselines(): SettingResult[] {
  return baselineTables().map(({name, tables, base}) => ({name, seeds: [], records: [recordOf(tables, base)]}))
}
