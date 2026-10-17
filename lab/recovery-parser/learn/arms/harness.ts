// What every arm of the experiment shares, so that every arm is scored and reported the same way:
//
// - recordOf(tables, base): the standard record of snapped tables, always from the exact parser on the validation
//   split of the standard set.
// - runArm({name, settings, seeds}): runs each setting's build function for every seed, saves each seed's tables and
//   record under <RECOVERY_SCRATCH>/arms/<name>/, and prints one markdown row per setting with the mean, the lowest
//   and the highest over the seeds.
// - describeComparison(first, second, rowName): two settings next to each other on one row of the score, always with
//   the spread of each.
// - baselines(): the rows that every arm is read against, through the same record.
// - numberToBeat(): the search from the hand-written tables, which an arm without added structure has to pass.
// - savedResultOf(armName, settingName): the saved records of a setting that runArm ran before, so that an arm can
//   be compared with another arm without running that arm again.
// - trainDataFor(base) and trainPartOfTheStandardSet(): the train split, which is all that a build function trains on.
//
// README.md of this folder says how to write an arm with them. Nothing here reads the test split: the samples that
// loadStandardSamples gives hold no test sample. The scripts for the test split are final.ts, and run.ts and
// show.ts of ../final/.
import {existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {type HandRule, handRuleTables, handRules} from '../../hand-rules.ts'
import {createRandom} from '../../random.ts'
import {type ParserTrace, positionCount, runTableParser} from '../../table-parser.ts'
import {wrongDepthsOnDeepTexts} from '../check-deep.ts'
import {checkTexts, textWithAddedClasses} from '../check-texts.ts'
import {type Samples, datasetKey, groupNames, loadStandardSamples, standardRange, textOf, trainPart, validationPart} from '../data.ts'
import {handwrittenTables} from '../handwritten/rules.ts'
import {plainParserProblems, recoveryTablesOf} from '../plain-tables.ts'
import {type RecoveryTrace, codePointsOf, createTrace, runRecoveryParserInto} from '../recovery-parser.ts'
import {type RecoveryTables, addStates, asIsTables, cellCounts, checkTables, differencesOf, loadTables, loadTablesOfThisDataset, otherDatasetOf, saveTables, tablesToJson, today} from '../recovery-tables.ts'
import {type CellCounts, type ScoreRow, cellsReadAt, countCells, isRead, scoreTables, sharesOf} from '../score.ts'
import {packForTwin, placesForTwin} from '../soft/twin-data.ts'
import type {TwinData} from '../soft/twin.ts'

// The standard record of some tables.
export type ArmRecord = {
  format: 'recovery arm record 2'
  // The dataset that the record was scored on, see datasetKey in ../data.ts. Two records compare only with the same key.
  datasetKey: string
  // The run that made the tables, when runArm made the record: the arm's name, the setting's name, and the seed, or
  // null for a setting without a seed. Null for a record that recordOf was called for by itself, e.g. a baseline's.
  run: {arm: string, setting: string, seed: number | null} | null
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
let standardTrain: Samples | undefined
export function samplesOfTheStandardSet(): Samples {
  standardSamples ??= loadStandardSamples()
  return standardSamples
}
export function validationOfTheStandardSet(): Samples {
  standardValidation ??= validationPart(samplesOfTheStandardSet())
  return standardValidation
}
// The train split of the standard set, as a set of its own: what a build function gives to a search
// (prepareSamples of ../search/sample-runs.ts) or to the votes (countVotes of ../search/votes.ts), which take every
// broken sample of the set that they are given.
export function trainPartOfTheStandardSet(): Samples {
  standardTrain ??= trainPart(samplesOfTheStandardSet())
  return standardTrain
}
// The train samples of the standard set that give the twin a step, packed for `base`, the tables that the build
// trains: what a build function gives to train of ../soft/train.ts. `intendedObjects` are the intended stacks of
// loadIntendedObjects(samplesOfTheStandardSet(), softCacheFolderOf()), which only a run that is kept on track needs.
export function trainDataFor(base: RecoveryTables, intendedObjects?: Uint16Array): TwinData {
  const samples = samplesOfTheStandardSet()
  return packForTwin(samples, placesForTwin(samples, 'train'), intendedObjects, base)
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

// What two tables have besides cells, as text: the numbers of states, the classes, the contexts and the open
// entries of the display table. A run changes cells and none of these.
const layoutOf = (tables: RecoveryTables) => JSON.stringify([tables.lexerStateCount, tables.grammarStateCount, tables.classCount, tables.addedClasses, tables.contextCount, Array.from(tables.displayOpen).join('')])

// The standard record of `tables`, which a run made from `base`, e.g. today's tables, or today's tables with added
// structure. The score is always the exact parser's on the validation split of the standard set. `run` says which
// run of an arm made the tables, see ArmRecord.run. Throws when the tables break the ground rules that checkTables
// knows, e.g. a changed frozen cell, and for a base that cannot be the tables that the run started from:
// - `base` is the same object as `tables`. A build that changed its base in place would count 0 changed cells.
// - `base` has other states, classes, contexts or open entries than `tables`, e.g. today's tables as the base of
//   tables with two added tokenizer states, which would count the 66 cells of the added states as changed.
export function recordOf(tables: RecoveryTables, base: RecoveryTables, run: ArmRecord['run'] = null): ArmRecord {
  checkTables(tables)
  checkTables(base)
  if (tables === base) throw new Error('recordOf got the same object as the tables and as their base: return a copy of the tables that the build started from as `base`, e.g. copyTables(base) before the build changes them')
  if (layoutOf(tables) !== layoutOf(base)) throw new Error('recordOf got a base with other states, classes, contexts or open entries of the display table than the tables: the base of a run is the tables that it started from, with the run\'s added structure, e.g. addStates(asIsTables(), 2, []) for a run that trains tables with two added tokenizer states')
  const validation = validationOfTheStandardSet()
  const score = scoreTables(tables, validation)
  const all = score.rows[0]!
  const shares = sharesOf(all)
  const changed = differencesOf(base, tables)
  const read = cellsReadAt(tables, validation, Int32Array.from({length: validation.sampleCount}, (_, place) => place))
  return {
    format: 'recovery arm record 2', datasetKey: validation.datasetKey, run,
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
// `seeds` empty: it is the same on every run. `everySeedGaveTheSameTables` is true when the setting has two seeds or
// more and all of them gave the same tables: its build does not use the seed, so its range is no spread.
export type SettingResult = {name: string, seeds: number[], records: ArmRecord[], everySeedGaveTheSameTables?: boolean}

const overRecords = (result: SettingResult, value: (record: ArmRecord) => number) => spreadOf(result.records.map(value))
const shareOfRow = (rowName: string, share: keyof ReturnType<typeof sharesOf>) => (record: ArmRecord) => sharesOf(rowNamed(record, rowName))[share]

// The markdown tables of some settings, one row per setting: the scores with the mean and the range over the seeds,
// then the same per group, then what the main number does not show.
export function describeSettings(results: readonly SettingResult[]): string {
  const validation = validationOfTheStandardSet()
  const first = results[0]!.records[0]!
  const all = rowNamed(first, 'all')
  const bound = sharesOf(all)
  const seedsOf = (result: SettingResult) => result.seeds.length === 0 ? 'none' : result.everySeedGaveTheSameTables === true ? `${result.seeds.length}, which all gave the same tables` : String(result.seeds.length)
  // The dataset lists its groups from "out of reach" to "within reach of the tables". A report starts with the group
  // within reach, which is the one to read first.
  const groupsInReportOrder = [...groupNames].reverse()
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
    `| setting | ${groupsInReportOrder.map(group => `${group}, ${rowNamed(first, `group: ${group}`).samples}`).join(' | ')} |`,
    `| --- | ${groupsInReportOrder.map(() => '---').join(' | ')} |`,
    ...results.map(result => `| ${result.name} | ${groupsInReportOrder.map(group => percentSpread(overRecords(result, shareOfRow(`group: ${group}`, 'allThree')), 1)).join(' | ')} |`),
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
  for (const result of results) if (result.everySeedGaveTheSameTables === true) lines.push('', sameTablesNote(result))
  return lines.join('\n')
}

// What to say about a setting whose seeds all gave the same tables.
const sameTablesNote = (result: SettingResult) => `The ${result.seeds.length} seeds of ${JSON.stringify(result.name)} gave the same tables, so its build does not use its seed and its range is no spread over seeds. Let the seed reach what is random in the build, or declare the setting with \`withoutSeed: true\`.`

// Two settings next to each other on the main number, with the spread of each, as one sentence. A difference
// between two means says nothing without the ranges, so a setting that depends on a seed needs 3 seeds at least:
// with fewer the function throws. A setting without a seed, e.g. a baseline or a search in a fixed order, is one
// number. A setting whose seeds all gave the same tables is one number too, and the sentence says so.
export function describeComparison(first: SettingResult, second: SettingResult, rowName = 'all'): string {
  for (const result of [first, second]) {
    if (result.seeds.length > 0 && result.seeds.length < 3) throw new Error(`the setting ${JSON.stringify(result.name)} has ${result.seeds.length} seed${result.seeds.length === 1 ? '' : 's'}: a comparison needs the spread over 3 seeds at least`)
    if (result.records.length !== Math.max(1, result.seeds.length)) throw new Error(`the setting ${JSON.stringify(result.name)} has ${result.seeds.length} seeds and ${result.records.length} records`)
  }
  const spreads = [first, second].map(result => overRecords(result, shareOfRow(rowName, 'allThree')))
  const [firstSpread, secondSpread] = spreads as [Spread, Spread]
  const difference = 100 * (firstSpread.mean - secondSpread.mean)
  const overlap = firstSpread.lowest <= secondSpread.highest && secondSpread.lowest <= firstSpread.highest
  const describe = (result: SettingResult, spread: Spread) => result.seeds.length === 0 ? `${JSON.stringify(result.name)} has ${percentSpread(spread)} and no seed`
    : result.everySeedGaveTheSameTables === true ? `${JSON.stringify(result.name)} has ${percentSpread({...spread, count: 1})} with each of its ${result.seeds.length} seeds, which all gave the same tables, so this is one run and no spread`
      : `${JSON.stringify(result.name)} has ${percentSpread(spread)} over ${result.seeds.length} seeds`
  return `All three, ${rowName === 'all' ? 'all validation samples' : rowName}: ${describe(first, firstSpread)}, ${describe(second, secondSpread)}. The means differ by ${difference >= 0 ? '+' : ''}${difference.toFixed(2)} points, and the two ranges ${overlap ? 'overlap, so these seeds do not tell the two settings apart' : 'do not overlap'}.`
}

// What a build function returns: snapped tables, and `base`, the tables that the build started from, e.g.
// asIsTables(), or today's tables with the arm's added structure. `base` is not the same object as `tables`.
export type Built = {tables: RecoveryTables, base: RecoveryTables}

// A setting of an arm: a name for its row, and a function that makes snapped tables for a seed. A setting in which
// nothing is random, e.g. a search in a fixed order, says so with `withoutSeed: true`: it is built once, and it is
// reported and compared as one number, like a baseline.
export type ArmSetting = {name: string, withoutSeed?: false, build: (seed: number) => Promise<Built> | Built} | {name: string, withoutSeed: true, build: () => Promise<Built> | Built}

export type ArmOptions = {
  // The arm's name, which is also its folder under <RECOVERY_SCRATCH>/arms/.
  name: string
  settings: readonly ArmSetting[]
  // The seeds of every setting that has a seed. The default is 1 to 5. Fewer than 5 is for a try-out only: the
  // function says so in what it prints. An empty list and a seed that is named twice throw.
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

// Runs every setting's build function for every seed, one after the other, or once for a setting without a seed.
// Per setting and seed it saves the tables to <RECOVERY_SCRATCH>/arms/<name>/<setting>/seed-<seed>.tables.json and
// the record next to it as seed-<seed>.record.json, or no-seed.tables.json and no-seed.record.json. It prints the
// tables of describeSettings and saves them as summary.md in the arm's folder.
//
// What an earlier run left in a setting's folder is moved into a folder `earlier-<time>` there first, so that the
// files next to a summary are the files of the run that the summary is of, e.g. after a rerun with fewer seeds.
//
// When two seeds or more of a setting all give the same tables, the build does not use its seed. The run goes on,
// and the summary and describeComparison say that the setting's range is no spread.
export async function runArm(options: ArmOptions): Promise<SettingResult[]> {
  const seeds = options.seeds ?? [1, 2, 3, 4, 5]
  if (seeds.length === 0) throw new Error('runArm got an empty list of seeds: name one seed at least, or leave `seeds` out for the seeds 1 to 5')
  if (new Set(seeds).size !== seeds.length) throw new Error(`runArm got the seeds ${seeds.join(', ')}, which name a seed twice: two runs with one seed are one run`)
  if (!seeds.every(seed => Number.isInteger(seed))) throw new Error(`runArm got the seeds ${seeds.join(', ')}, and a seed is a whole number`)
  const log = options.log ?? (line => console.log(line))
  const folder = armFolderOf(options.name)
  const names = options.settings.map(setting => fileNameOf(setting.name))
  if (new Set(names).size !== names.length) throw new Error('two settings of the arm have the same file name')
  const results: SettingResult[] = []
  for (const setting of options.settings) {
    const settingFolder = join(folder, fileNameOf(setting.name))
    mkdirSync(settingFolder, {recursive: true})
    const earlierFiles = readdirSync(settingFolder).filter(name => name.endsWith('.tables.json') || name.endsWith('.record.json'))
    if (earlierFiles.length > 0) {
      let earlierFolder = join(settingFolder, `earlier-${new Date().toISOString().replaceAll(/[^0-9T]/g, '').slice(0, 15)}`)
      while (existsSync(earlierFolder)) earlierFolder += '-again'
      mkdirSync(earlierFolder)
      for (const name of earlierFiles) renameSync(join(settingFolder, name), join(earlierFolder, name))
    }
    const records: ArmRecord[] = []
    const tablesOfSeeds: string[] = []
    const runs: {seed: number | null, build: () => Promise<Built> | Built}[] = setting.withoutSeed === true ? [{seed: null, build: setting.build}] : seeds.map(seed => ({seed, build: () => setting.build(seed)}))
    for (const {seed, build} of runs) {
      const started = performance.now()
      const {tables, base} = await build()
      const record = recordOf(tables, base, {arm: options.name, setting: setting.name, seed})
      const fileName = seed === null ? 'no-seed' : `seed-${seed}`
      saveTables(join(settingFolder, `${fileName}.tables.json`), tables, `arm ${options.name}, setting ${setting.name}, ${seed === null ? 'no seed' : `seed ${seed}`}`)
      writeFileSync(join(settingFolder, `${fileName}.record.json`), `${JSON.stringify(record, null, 1)}\n`)
      records.push(record)
      tablesOfSeeds.push(tablesToJson(tables))
      log(`${options.name}, ${setting.name}, ${seed === null ? 'no seed' : `seed ${seed}`}: all three ${(100 * sharesOf(rowNamed(record, 'all')).allThree).toFixed(2)}% on the validation split, ${record.cellsChangedAgainstBase.total} cells changed against the base, ${((performance.now() - started) / 1000).toFixed(0)} s`)
    }
    const result: SettingResult = {name: setting.name, seeds: setting.withoutSeed === true ? [] : [...seeds], records}
    if (everySeedGaveTheSame(result.seeds, tablesOfSeeds)) {
      result.everySeedGaveTheSameTables = true
      log(sameTablesNote(result))
    }
    results.push(result)
  }
  const seeded = options.settings.some(setting => setting.withoutSeed !== true)
  const summary = `${describeSettings(results)}\n${seeded && seeds.length < 5 ? `\nOnly ${seeds.length} seed${seeds.length === 1 ? '' : 's'}: a try-out, not a number to report.\n` : ''}`
  writeFileSync(join(folder, 'summary.md'), summary)
  log('')
  log(summary)
  return results
}

// Whether a setting has two seeds or more and each of them gave the same tables, as the text of tablesToJson.
const everySeedGaveTheSame = (seeds: readonly number[], tablesOfSeeds: readonly string[]) => seeds.length >= 2 && tablesOfSeeds.every(text => text === tablesOfSeeds[0])

// The saved records of one setting of an arm, as the result that runArm returned for the setting: what
// describeSettings and describeComparison take. So an arm can be compared with another arm without running that arm
// again, e.g. with the plain pass:
//   describeComparison(results[0]!, savedResultOf('plain-pass', 'one pass of the trainer from today\'s tables, defaults'))
// The records are read from <RECOVERY_SCRATCH>/arms/<arm>/<setting>/, where runArm saved them. Throws:
// - when the folder holds no record: run the arm first,
// - for a record of another dataset, i.e. one whose key is not the dataset's key as it is now: its score is of other
//   samples, so run the arm again,
// - for a record that is not the one that runArm saved under its file name, e.g. after a file was copied from the
//   folder of another setting.
export function savedResultOf(armName: string, settingName: string): SettingResult {
  const folder = join(armFolderOf(armName), fileNameOf(settingName))
  const saved = (existsSync(folder) ? readdirSync(folder) : []).flatMap(fileName => {
    const match = /^(?:no-seed|seed-(-?\d+))\.record\.json$/.exec(fileName)
    return match === null ? [] : [{fileName, seed: match[1] === undefined ? null : Number(match[1])}]
  }).sort((left, right) => (left.seed ?? 0) - (right.seed ?? 0))
  if (saved.length === 0) throw new Error(`${folder} holds no record of the setting ${JSON.stringify(settingName)} of the arm ${JSON.stringify(armName)}: run the arm first, so that runArm saves its records there`)
  if (saved.length > 1 && saved.some(({seed}) => seed === null)) throw new Error(`${folder} holds a record without a seed next to records with a seed: a setting has a seed or has none`)
  const records = saved.map(({fileName, seed}) => {
    const file = join(folder, fileName)
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {format?: unknown}
    if (parsed.format !== 'recovery arm record 2') throw new Error(`${file} is no record of an arm: its format is ${JSON.stringify(parsed.format)}`)
    const record = parsed as ArmRecord
    if (record.datasetKey !== datasetKey()) throw new Error(`${file} was saved with the dataset ${record.datasetKey}, and the dataset is ${datasetKey()} now: its score is of other samples. Run the arm ${JSON.stringify(armName)} again.`)
    if (record.run?.arm !== armName || record.run.setting !== settingName || record.run.seed !== seed) throw new Error(`${file} holds the record of the run ${JSON.stringify(record.run)}, and not of the arm ${JSON.stringify(armName)}, the setting ${JSON.stringify(settingName)} and ${seed === null ? 'no seed' : `the seed ${seed}`}`)
    return record
  })
  const seeds = saved.flatMap(({seed}) => seed === null ? [] : [seed])
  const result: SettingResult = {name: settingName, seeds, records}
  // The tables of every seed are saved next to its record. They say whether the build used its seed.
  if (everySeedGaveTheSame(seeds, seeds.map(seed => tablesToJson(loadTablesOfThisDataset(join(folder, `seed-${seed}.tables.json`)).tables)))) result.everySeedGaveTheSameTables = true
  return result
}

// Today's tables with the states of `tables`, as the base of tables that a person wrote: an added state holds what
// addStates gives it, and the display table's column of an added grammar state is the one that `tables` hold.
export function todaysTablesWithTheStatesOf(tables: RecoveryTables): RecoveryTables {
  const base = addStates(asIsTables(), tables.lexerStateCount - today.lexerStateCount, Array.from({length: tables.grammarStateCount - today.grammarStateCount}, () => today.errorState))
  for (let event = 0; event < tables.eventCount; event++) for (let state = today.grammarStateCount; state < tables.grammarStateCount; state++) base.display[event * tables.grammarStateCount + state] = tables.display[event * tables.grammarStateCount + state]!
  return base
}

// The tables that every arm is read against, each with the tables it started from, which are today's:
// - the parser as it is,
// - the dataset's hand rules (../../hand-rules.ts), four today: stay, resync, words and lines. Each as tables of the
//   experiment, with the stack action `by token` in every grammar cell. The list follows the dataset's `handRules`.
//   The base of a hand rule with a state of its own, as `lines` has one, is today's tables with that state added,
// - the 35 hand-written rules of ../handwritten/rules.ts as they are.
//
// For the dataset's hand rules and for the hand-written rules no split counts as unseen: the hand rules were chosen
// by the dataset's statistics, which are over the samples of every split, the test split included, and the
// hand-written rules were written with samples of every split of the old snapshot in view.
export function baselineTables(): {name: string, tables: RecoveryTables, base: RecoveryTables}[] {
  return [
    {name: 'the parser as it is', tables: asIsTables(), base: asIsTables()},
    ...handRules.map((rule: HandRule) => {
      const tables = recoveryTablesOf(handRuleTables(rule))
      return {name: `the dataset's hand rule ${rule}, as tables of the experiment`, tables, base: todaysTablesWithTheStatesOf(tables)}
    }),
    {name: 'hand-written, the 35 rules of handwritten/rules.ts', tables: handwrittenTables().tables, base: asIsTables()},
  ]
}

// The records of the baselines, one setting each, without seeds.
export function baselines(): SettingResult[] {
  return baselineTables().map(({name, tables, base}) => ({name, seeds: [], records: [recordOf(tables, base)]}))
}

// The file of the tables of the number to beat in a scratch folder.
export const numberToBeatFileOf = (scratchFolder: string) => join(scratchFolder, 'search', 'search-from-handwritten.json')

// The number to beat, as a setting without a seed: the tables of the plain search that starts from the hand-written
// tables, see ../search/README.md. An arm without added structure that ends below it has found nothing that a plain
// search does not find. Its base is the hand-written tables, which the search started from, and for which no split
// counts as unseen, so the same holds for this row.
//
// The tables are read from <scratch>/search/search-from-handwritten.json, which these two commands make, in about 3
// minutes:
//   bun lab/recovery-parser/learn/handwritten/rules.ts
//   bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/handwritten/tables.json --out $RECOVERY_SCRATCH/search/search-from-handwritten.json
// Throws when the file is missing, and when it was saved with another dataset key than the dataset's as it is now:
// a search before a later commit of the dataset may have run on samples that are validation samples now.
//
// The record is made on every call, so an arm calls it once, and before it trains anything: a missing file then
// stops the arm at its start.
export function numberToBeat(scratchFolder: string | undefined = process.env['RECOVERY_SCRATCH']): SettingResult {
  if (scratchFolder === undefined || scratchFolder === '') throw new Error('set RECOVERY_SCRATCH to a folder outside the repo: the tables of the number to beat are read from there')
  const file = numberToBeatFileOf(scratchFolder)
  const howToMake = 'Make it with `bun lab/recovery-parser/learn/handwritten/rules.ts` and then `bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/handwritten/tables.json --out $RECOVERY_SCRATCH/search/search-from-handwritten.json`.'
  if (!existsSync(file)) throw new Error(`the number to beat has no tables yet: ${file} is missing. ${howToMake}`)
  const loaded = loadTables(file)
  const otherDataset = otherDatasetOf(file, loaded)
  if (otherDataset !== undefined) throw new Error(`the number to beat is of another dataset: ${otherDataset}. ${howToMake}`)
  return {name: 'search from the hand-written tables', seeds: [], records: [recordOf(loaded.tables, handwrittenTables().tables)]}
}
