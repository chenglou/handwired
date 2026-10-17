// HELD BACK: do not read this folder if you build the parser, the train data, the training or its machinery. See
// ../README.md.
//
// A second count of the one final scoring of the TOML track, see ../final/RESULTS.md. It scores the 24 saved files of
// tables and the rows 1 and 2 again, with the counting of counting.ts and the texts of texts.ts, which import nothing
// of ../final/, and holds what comes out against what the final scoring saved and wrote:
//
// - the files: each has the sha256 of ../final/list.json, of the log of the final run and of the training side's lists;
// - every count of the final scoring's file of counts, per row of each set, per display kind of the label and per
//   text, and the validation counts of the dry run;
// - every line of every table of ../final/final-report.md, the tables of ../final/RESULTS.md and of the report as it
//   was sent, and the numbers that the final scoring made afterwards from its saved counts (after.txt);
// - no text of a held-back set is a text of a train or validation sample, of the dataset or of the kinds written
//   for TOML.
//
// It also prints the numbers behind the sentences of the report, per seed. It trains nothing, changes no file of the
// final scoring, and writes no line to the log of final runs.
//
// Run from the repo root, with RECOVERY_SCRATCH set to the scratch folder of the TOML track, i.e. the folder outside
// the repo that holds runs/, handwritten/ and held-back/:
//   RECOVERY_FINAL=yes bun lab/recovery-toml/held-back/final-recount/recount.ts --out <folder> [--final <folder>]
// <folder> is below recovery-scratch/transfer/toml/held-back/, e.g. .../held-back/final-recount, and --final names the
// folder of the final run's outputs, by default the folder `final` beside it. It writes recount.txt into <folder>.
//
// ../final/list.json and ../final/final-report.md name no folder of the machine of the run since they were
// published: the list holds paths relative to the scratch folder, and the report writes that folder as
// <RECOVERY_SCRATCH>. Both are held against the log and the report of the run with the full paths put back, so
// these two checks pass only where the scratch folder is where it was at the run.
import {createHash} from 'node:crypto'
import {mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs'
import {isAbsolute, join, resolve} from 'node:path'
import {kinds as kindsOfTheMixedSet} from '../../kinds/list.ts'
import {mixedSamples} from '../../kinds/mixed.ts'
import {kindsSampleAt} from '../../kinds/samples.ts'
import {requireFinal} from '../../learn/data.ts'
import {datasetKey} from '../../learn/dataset-key.ts'
import {optionOf} from '../../learn/options.ts'
import {defaultSeed as datasetSeed, splitKeyOf, splitOf} from '../../samples.ts'
import {kinds as kindsOfTheGenerator} from '../specific/mistakes.ts'
import {type Counts, type CountsOfSet, allThreeOf, countFields, countSet, differingCodePoints, labelKindNames, wholeOf} from './counting.ts'
import {type Show, loadTables, readTablesOfFile, showAsItIs, showAsItIsWithExactParser, showWithExactParser, showWithLoopOfThisFolder, showWithTheRule, showWithTheRuleOfLearn} from './parsers.ts'
import {type BrokenText, type SetName, datasetSamples, generatorTexts, mainRowOf, textsOfDatasetSamples, writtenTexts} from './texts.ts'

const heldBackLine = 'HELD BACK: whoever builds the parser, the train data, the training or its machinery does not read this file.'

requireFinal('held-back/final-recount/recount.ts, which scores saved tables on the held-back sets and')
const outOption = optionOf('--out')
if (outOption === undefined) throw new Error('name the folder of the notes with --out <folder>, below recovery-scratch/transfer/toml/held-back/')
const outFolder = resolve(outOption)
if (!outFolder.split('/').includes('held-back')) throw new Error(`${outFolder} is not below a folder named held-back`)
const finalFolder = resolve(optionOf('--final') ?? join(outFolder, '..', 'final'))
const folderOfTheFinalScoring = resolve(import.meta.dir, '..', 'final')
mkdirSync(outFolder, {recursive: true})

const notes: string[] = [heldBackLine, '']
const note = (line = '') => {
  notes.push(line)
  console.log(line)
}

// How many values were held against each other under a heading, and a sentence per value that differs.
type Tally = {compared: number, differing: string[]}
const tallies = new Map<string, Tally>()
function tallyOf(heading: string): Tally {
  let tally = tallies.get(heading)
  if (tally === undefined) tallies.set(heading, tally = {compared: 0, differing: []})
  return tally
}
function hold(heading: string, what: string, here: unknown, there: unknown) {
  const tally = tallyOf(heading)
  tally.compared++
  if (here !== there) tally.differing.push(`${what}: ${String(here)} here and ${String(there)} there`)
}

const sha256Of = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const sha256OfText = (text: string) => createHash('sha256').update(text).digest('hex')
const withThousands = (value: number) => value.toLocaleString('en-US')
const meanOf = (values: readonly number[]) => values.reduce((total, value) => total + value, 0) / values.length
const lowestOf = (values: readonly number[]) => Math.min(...values)
const highestOf = (values: readonly number[]) => Math.max(...values)
// E.g. "86.63 (84.81 to 87.57)" for the files of a row, and the value alone for one file.
const spreadOf = (values: readonly number[], digits: number) => values.length === 1 ? values[0]!.toFixed(digits) : `${meanOf(values).toFixed(digits)} (${lowestOf(values).toFixed(digits)} to ${highestOf(values).toFixed(digits)})`
const countSpreadOf = (values: readonly number[]) => values.length === 1 ? withThousands(values[0]!) : `${withThousands(Math.round(meanOf(values)))} (${withThousands(lowestOf(values))} to ${withThousands(highestOf(values))})`
const signed = (value: number, digits = 2) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`
// E.g. "generator and written", or "no set" for an empty list.
const setsOrNone = (sets: readonly string[]) => sets.length > 0 ? sets.join(' and ') : 'no set'

// ---------------------------------------------------------------------------------------------------------------
// The files of tables.

type ListedTables = {seed: number | null, path: string, sha256: string}
type List = {datasetKey: string, sourceLists: Record<string, string>, rows: {row: number, name: string, tables: ListedTables[]}[]}
const listPath = join(folderOfTheFinalScoring, 'list.json')
const scratchOfTheEnvironment = process.env['RECOVERY_SCRATCH']
if (scratchOfTheEnvironment === undefined || scratchOfTheEnvironment === '') throw new Error('set RECOVERY_SCRATCH to the scratch folder of the TOML track, i.e. the folder outside the repo that holds runs/, handwritten/ and held-back/: ../final/list.json names its files relative to that folder')
const scratchFolder = resolve(scratchOfTheEnvironment)
// The list with full paths, as list.json held them at the final run. The order of the fields is the file's, so on
// the machine of the run the text of this list is the text that the file had then.
const fromScratch = (path: string) => isAbsolute(path) ? path : join(scratchFolder, path)
const listOfTheFile = JSON.parse(readFileSync(listPath, 'utf8')) as List
const list: List = {
  ...listOfTheFile,
  sourceLists: Object.fromEntries(Object.entries(listOfTheFile.sourceLists).map(([name, path]) => [name, fromScratch(path)])),
  rows: listOfTheFile.rows.map(row => ({...row, tables: row.tables.map(tables => ({...tables, path: fromScratch(tables.path)}))})),
}
const listTextWithFullPaths = `${JSON.stringify(list, null, 1)}\n`
const listedFiles = list.rows.flatMap(row => row.tables.map(tables => ({row: row.row, ...tables})))

type LoggedRun = {time: string, commit: string, datasetKey: string, list: string, listSha256: string, tables: {row: number, seed: number | null, path: string, sha256: string}[]}
const logLines = readFileSync(join(finalFolder, 'final-runs.log'), 'utf8').split('\n').filter(line => line.startsWith('{'))
const loggedRun = JSON.parse(logLines[0]!) as LoggedRun

type SourceList = {tables: {row: number, seed: number, path: string, sha256: string, record: string}[]}
const sourceTables = [list.sourceLists['neutral']!, list.sourceLists['mixed']!].flatMap(path => (JSON.parse(readFileSync(path, 'utf8')) as SourceList).tables)
const handwrittenSha256 = readFileSync(`${list.sourceLists['handwritten']!}.sha256`, 'utf8').split(/\s+/)[0]!

note('# The files of tables')
note()
note(`The log of final runs holds ${logLines.length} run${logLines.length === 1 ? '' : 's'}: ${loggedRun.time}, commit ${loggedRun.commit}, dataset ${loggedRun.datasetKey}.`)
hold('files', 'final runs in the log', logLines.length, 1)
hold('files', 'the sha256 of list.json with the full paths that it held at the run, against the log', sha256OfText(listTextWithFullPaths), loggedRun.listSha256)
hold('files', 'the dataset key of the list against the dataset as it is', list.datasetKey, datasetKey())
hold('files', 'the dataset key of the log against the dataset as it is', loggedRun.datasetKey, datasetKey())
hold('files', 'files in the list', listedFiles.length, 24)
hold('files', 'files in the log', loggedRun.tables.length, 24)
hold('files', 'files in the training side\'s lists, with the hand-written tables', sourceTables.length + 1, 24)
let latestChangeOfAFile = 0
for (const listed of listedFiles) {
  const who = `row ${listed.row}${listed.seed === null ? '' : ` seed ${listed.seed}`}`
  const sha256Now = sha256Of(listed.path)
  hold('files', `${who}, the bytes now against the list`, sha256Now, listed.sha256)
  const logged = loggedRun.tables.find(candidate => candidate.path === listed.path)
  hold('files', `${who}, the log of the final run against the list`, logged?.sha256, listed.sha256)
  hold('files', `${who}, the row and the seed in the log`, `${logged?.row} ${logged?.seed}`, `${listed.row} ${listed.seed}`)
  if (listed.row === 3) {
    hold('files', `${who}, the file tables.json.sha256 of the training side against the list`, handwrittenSha256, listed.sha256)
  } else {
    const source = sourceTables.find(candidate => candidate.path === listed.path)
    hold('files', `${who}, the training side's list against the list`, source?.sha256, listed.sha256)
    hold('files', `${who}, the row and the seed in the training side's list`, `${source?.row} ${source?.seed}`, `${listed.row} ${listed.seed}`)
    if (source !== undefined) {
      const record = JSON.parse(readFileSync(source.record, 'utf8')) as {row: number, seed: number, sha256: string, datasetKey: string}
      hold('files', `${who}, the record of its run against the list`, record.sha256, listed.sha256)
      hold('files', `${who}, the row and the seed of its record`, `${record.row} ${record.seed}`, `${listed.row} ${listed.seed}`)
      hold('files', `${who}, the dataset key of its record`, record.datasetKey, datasetKey())
    }
  }
  hold('files', `${who}, the dataset key in the file`, readTablesOfFile(listed.path).datasetKey, datasetKey())
  latestChangeOfAFile = Math.max(latestChangeOfAFile, statSync(listed.path).mtimeMs)
}
const timeOfTheRun = Date.parse(loggedRun.time)
note(`The last change of any of the 24 files was at ${new Date(latestChangeOfAFile).toISOString()}, ${latestChangeOfAFile < timeOfTheRun ? 'before' : 'NOT before'} the final run.`)
hold('files', 'the last change of a file is before the final run', latestChangeOfAFile < timeOfTheRun, true)

// ---------------------------------------------------------------------------------------------------------------
// The sets.

const generator = generatorTexts()
const written = writtenTexts()
const dataset = datasetSamples()
const texts: Record<SetName, BrokenText[]> = {generator, written, dataset: textsOfDatasetSamples(dataset.test), validation: textsOfDatasetSamples(dataset.validation)}
const setNames = ['generator', 'written', 'dataset', 'validation'] as const
note()
note('# The sets')
note()
note(`The generator's set has ${generator.length} samples, the written set ${written.length} cases, and the dataset's standard set ${dataset.train.length} train, ${dataset.validation.length} validation and ${dataset.test.length} test samples.`)

// ---------------------------------------------------------------------------------------------------------------
// The scoring.

type FileOfRow = {seed: number | null, path: string | null, counts: Record<SetName, CountsOfSet>}
type RowOfTheExperiment = {label: string, name: string, files: FileOfRow[]}

// Two ways to show a text, held against each other at every code point. The first one's result is counted.
type TwoWays = {texts: number, codePoints: number, differing: number}
const twoWays: Record<string, TwoWays> = {}
function shownTwice(heading: string, first: Show, second: Show): Show {
  const tally = twoWays[heading] ??= {texts: 0, codePoints: 0, differing: 0}
  return codePoints => {
    const shown = first(codePoints)
    tally.texts++
    tally.codePoints += codePoints.length
    tally.differing += differingCodePoints(codePoints, shown, second(codePoints))
    return shown
  }
}
const countsOnEverySet = (show: Show): Record<SetName, CountsOfSet> => ({
  generator: countSet(texts.generator, mainRowOf.generator, show), written: countSet(texts.written, mainRowOf.written, show),
  dataset: countSet(texts.dataset, mainRowOf.dataset, show), validation: countSet(texts.validation, mainRowOf.validation, show),
})

// What every table has to show as the parser as it is does: the valid documents of a set, each once, and every
// broken text before its first error.
type AsToday = {documents: number, documentCodePoints: number, brokenTexts: number, codePointsBeforeTheError: number, differing: number, tables: number}
const asToday: Record<SetName, AsToday> = {
  generator: {documents: 0, documentCodePoints: 0, brokenTexts: 0, codePointsBeforeTheError: 0, differing: 0, tables: 0}, written: {documents: 0, documentCodePoints: 0, brokenTexts: 0, codePointsBeforeTheError: 0, differing: 0, tables: 0},
  dataset: {documents: 0, documentCodePoints: 0, brokenTexts: 0, codePointsBeforeTheError: 0, differing: 0, tables: 0}, validation: {documents: 0, documentCodePoints: 0, brokenTexts: 0, codePointsBeforeTheError: 0, differing: 0, tables: 0},
}
const documentsOfSet = Object.fromEntries(setNames.map(set => [set, [...new Set(texts[set].flatMap(text => text.documents))].map(document => Array.from(document, character => character.codePointAt(0)!))])) as Record<SetName, number[][]>
function holdAgainstToday(show: Show) {
  for (const set of setNames) {
    const facts = asToday[set]
    facts.tables++
    facts.documents = documentsOfSet[set].length
    facts.documentCodePoints = 0
    facts.brokenTexts = texts[set].length
    facts.codePointsBeforeTheError = 0
    for (const document of documentsOfSet[set]) {
      facts.documentCodePoints += document.length
      facts.differing += differingCodePoints(document, showAsItIs(document), show(document))
    }
    for (const text of texts[set]) {
      const before = text.codePoints.slice(0, text.firstErrorPosition === -1 ? text.codePoints.length : text.firstErrorPosition)
      facts.codePointsBeforeTheError += before.length
      facts.differing += differingCodePoints(before, showAsItIs(text.codePoints), show(text.codePoints))
    }
  }
}

const rows: RowOfTheExperiment[] = [
  {label: '1', name: 'the parser as it is', files: [{seed: null, path: null, counts: countsOnEverySet(shownTwice('row 1: the plain parser against the exact parser with today\'s tables', showAsItIs, showAsItIsWithExactParser))}]},
  {label: '2', name: 'one rule without training', files: [{seed: null, path: null, counts: countsOnEverySet(shownTwice('row 2: the rule as written in this folder against learn/restart-at-next-line.ts', showWithTheRule, showWithTheRuleOfLearn))}]},
]
const structureOfFile = new Map<string, string>()
for (const listedRow of list.rows) {
  const files: FileOfRow[] = []
  for (const listed of listedRow.tables) {
    const {tables} = loadTables(listed.path)
    const ofFile = readTablesOfFile(listed.path)
    structureOfFile.set(listed.path, `${ofFile.addedClasses} added classes, ${ofFile.contextCount} contexts`)
    const exact = showWithExactParser(tables)
    files.push({seed: listed.seed, path: listed.path, counts: countsOnEverySet(shownTwice('rows 3 to 8: the exact parser against the loop of this folder over the file\'s arrays', exact, showWithLoopOfThisFolder(ofFile)))})
    holdAgainstToday(exact)
    console.log(`scored row ${listedRow.row}${listed.seed === null ? '' : ` seed ${listed.seed}`}`)
  }
  rows.push({label: String(listedRow.row), name: listedRow.name, files})
}
const rowOfLabel = (label: string) => rows.find(row => row.label === label)!
const rowCounts = (file: FileOfRow, set: SetName, rowName: string): Counts => {
  const counts = file.counts[set].rows.get(rowName)
  if (counts === undefined) throw new Error(`no text of the set ${set} is in the row ${rowName}`)
  return counts
}
const allThreeOfRow = (row: RowOfTheExperiment, set: SetName, rowName: string = mainRowOf[set]) => row.files.map(file => allThreeOf(rowCounts(file, set, rowName)))
const wholeOfRow = (row: RowOfTheExperiment, set: SetName, rowName: string = mainRowOf[set]) => row.files.map(file => wholeOf(rowCounts(file, set, rowName)))
const addedAsErrorOfRow = (row: RowOfTheExperiment, set: SetName, rowName: string = mainRowOf[set]) => row.files.map(file => rowCounts(file, set, rowName).addedShownAsError)
const seedOfLowest = (row: RowOfTheExperiment, set: SetName) => {
  const values = allThreeOfRow(row, set)
  return row.files[values.indexOf(lowestOf(values))]!.seed
}

note()
note('# Two ways to show every text')
note()
for (const [heading, tally] of Object.entries(twoWays)) note(`${heading}: ${withThousands(tally.texts)} runs of a text, ${withThousands(tally.codePoints)} code points, ${withThousands(tally.differing)} of them shown otherwise.`)
note()
note('The 24 files of tables against the parser as it is, where the ground rules ask for the same:')
for (const set of setNames) {
  const facts = asToday[set]
  note(`  ${set}: ${facts.tables} tables, ${withThousands(facts.documents)} valid documents (${withThousands(facts.documentCodePoints)} code points) and ${withThousands(facts.brokenTexts)} broken texts before their first error (${withThousands(facts.codePointsBeforeTheError)} code points): ${withThousands(facts.differing)} code points shown otherwise.`)
}

// ---------------------------------------------------------------------------------------------------------------
// Against the saved counts of the final run and of the dry run.

type SavedSetName = 'generator' | 'written' | 'dataset'
type SavedCounts = Counts & {name: string}
type SavedLabelKind = {kind: string, scored: number, right: number, kindRight: number}
type SavedFile = {
  seed: number | null, file: string | null, sha256: string | null
  generator: SavedCounts[] | null, written: SavedCounts[] | null, dataset: SavedCounts[]
  labelKinds: Record<SavedSetName, SavedLabelKind[] | null>, rightPerText: Record<SavedSetName, number[] | null>
}
type SavedRow = {label: string, name: string, files: SavedFile[]}
type SavedRun = {
  time: string, commit: string, datasetKey: string, listSha256: string, problems: string[]
  texts: Record<SavedSetName, {ids: string[], scored: number[]}>
  secondCounts: {compared: number, different: string[]}, unchangedTables: {compared: number, different: string[]}
  asToday: {set: string, parsers: number, documents: number, validCodePoints: number, validDifferences: number, brokenTexts: number, beforeErrorCodePoints: number, beforeErrorDifferences: number}[]
  datasetSplit: {split: string, indexesMade: number, texts: number, ofHeldOutTemplates: number}
  rows: SavedRow[], bases: SavedRow[]
}
const savedFinal = JSON.parse(readFileSync(join(finalFolder, 'final.counts.json'), 'utf8')) as SavedRun
const savedDryRun = JSON.parse(readFileSync(join(finalFolder, 'dry-run.counts.json'), 'utf8')) as SavedRun

// Holds what this folder counted on a set against a saved file's counts on a set. `onlyRows` leaves out rows that
// the dry run made up.
function holdSavedSet(heading: string, who: string, mine: CountsOfSet, saved: {rows: SavedCounts[], labelKinds: SavedLabelKind[], rightPerText: number[]}, onlyRows: (name: string) => boolean) {
  const savedRows = saved.rows.filter(row => onlyRows(row.name))
  const myNames = [...mine.rows.keys()].filter(onlyRows).sort()
  hold(heading, `${who}, the names of the rows`, myNames.join(' | '), savedRows.map(row => row.name).sort().join(' | '))
  for (const savedRow of savedRows) {
    const myRow = mine.rows.get(savedRow.name)
    for (const field of countFields) hold(heading, `${who}, ${savedRow.name}, ${field}`, myRow?.[field], savedRow[field])
  }
  const myLabelKinds = labelKindNames.flatMap((kind, index) => mine.perLabelKind[index]!.scored > 0 ? [{kind, ...mine.perLabelKind[index]!}] : [])
  hold(heading, `${who}, the display kinds of the labels`, myLabelKinds.map(of => of.kind).join(' | '), saved.labelKinds.map(of => of.kind).join(' | '))
  for (const savedKind of saved.labelKinds) {
    const myKind = myLabelKinds.find(of => of.kind === savedKind.kind)
    for (const field of ['scored', 'right', 'kindRight'] as const) hold(heading, `${who}, label ${savedKind.kind}, ${field}`, myKind?.[field], savedKind[field])
  }
  hold(heading, `${who}, the number of texts`, mine.rightPerText.length, saved.rightPerText.length)
  mine.rightPerText.forEach((right, place) => hold(`${heading}, per text`, `${who}, text ${place}`, right, saved.rightPerText[place]))
}

const savedSets = ['generator', 'written', 'dataset'] as const
for (const set of savedSets) {
  const heading = `the final run's file of counts, ${set}`
  hold(heading, 'the ids of the texts', texts[set].map(text => text.id).join(' '), savedFinal.texts[set].ids.join(' '))
  const scoredPerText = rowOfLabel('1').files[0]!.counts[set].scoredPerText
  scoredPerText.forEach((scored, place) => hold(`${heading}, per text`, `scored code points of text ${place}`, scored, savedFinal.texts[set].scored[place]))
}
hold('the final run\'s file of counts, facts', 'the rows', rows.map(row => `${row.label}:${row.files.length}`).join(' '), savedFinal.rows.map(row => `${row.label}:${row.files.length}`).join(' '))
hold('the final run\'s file of counts, facts', 'the dataset key', savedFinal.datasetKey, datasetKey())
hold('the final run\'s file of counts, facts', 'the time of the run against the log', savedFinal.time, loggedRun.time)
hold('the final run\'s file of counts, facts', 'the commit of the run against the log', savedFinal.commit, loggedRun.commit)
hold('the final run\'s file of counts, facts', 'problems of the run', savedFinal.problems.length, 0)
for (const row of rows) {
  const savedRow = savedFinal.rows.find(candidate => candidate.label === row.label)
  row.files.forEach((file, place) => {
    const savedFile = savedRow?.files[place]
    const who = `row ${row.label}${file.seed === null ? '' : ` seed ${file.seed}`}`
    if (savedFile === undefined) {
      tallyOf('the final run\'s file of counts, facts').differing.push(`${who} is not in the file of counts`)
      return
    }
    hold('the final run\'s file of counts, facts', `${who}, the seed`, file.seed, savedFile.seed)
    hold('the final run\'s file of counts, facts', `${who}, the path`, file.path, savedFile.file)
    hold('the final run\'s file of counts, facts', `${who}, the sha256`, file.path === null ? null : listedFiles.find(listed => listed.path === file.path)!.sha256, savedFile.sha256)
    for (const set of savedSets) {
      holdSavedSet(`the final run's file of counts, ${set}`, who, file.counts[set], {rows: savedFile[set] ?? [], labelKinds: savedFile.labelKinds[set] ?? [], rightPerText: savedFile.rightPerText[set] ?? []}, () => true)
    }
  })
}
// The dry run scored every file on the validation split, under the name of the dataset's set. Its rows of the
// held-out templates and of the other templates are made up from a sample's place, so they are left out here.
const realRowOfTheDryRun = (name: string) => name === 'all' || name.startsWith('group: ') || name.startsWith('kind: ')
hold('the dry run\'s file of counts, validation', 'the ids of the texts', texts.validation.map(text => text.id).join(' '), savedDryRun.texts.dataset.ids.join(' '))
for (const row of rows) {
  const savedRow = savedDryRun.rows.find(candidate => candidate.label === row.label)
  row.files.forEach((file, place) => {
    const savedFile = savedRow?.files[place]
    const who = `row ${row.label}${file.seed === null ? '' : ` seed ${file.seed}`}`
    if (savedFile === undefined) {
      tallyOf('the dry run\'s file of counts, validation').differing.push(`${who} is not in the file of counts`)
      return
    }
    holdSavedSet('the dry run\'s file of counts, validation', who, file.counts.validation, {rows: savedFile.dataset, labelKinds: savedFile.labelKinds.dataset ?? [], rightPerText: savedFile.rightPerText.dataset ?? []}, realRowOfTheDryRun)
  })
}
// What the final run says it checked, read from its file of counts and held against what this folder found.
const asTodayOfSaved = (set: string) => savedFinal.asToday.find(entry => entry.set === set)
for (const [set, savedName] of [['generator', 'the generator\'s set'], ['written', 'the written set'], ['dataset', 'the dataset\'s test split']] as const) {
  const saved = asTodayOfSaved(savedName)
  hold('the final run\'s file of counts, facts', `${set}, valid documents`, asToday[set].documents, saved?.documents)
  hold('the final run\'s file of counts, facts', `${set}, code points of valid documents`, asToday[set].documentCodePoints, saved?.validCodePoints)
  hold('the final run\'s file of counts, facts', `${set}, broken texts`, asToday[set].brokenTexts, saved?.brokenTexts)
  hold('the final run\'s file of counts, facts', `${set}, code points before a first error`, asToday[set].codePointsBeforeTheError, saved?.beforeErrorCodePoints)
  hold('the final run\'s file of counts, facts', `${set}, code points shown otherwise than today`, asToday[set].differing, (saved?.validDifferences ?? Number.NaN) + (saved?.beforeErrorDifferences ?? Number.NaN))
}
hold('the final run\'s file of counts, facts', 'samples of the test split', texts.dataset.length, savedFinal.datasetSplit.texts)
hold('the final run\'s file of counts, facts', 'test samples of a held-out template', rowCounts(rowOfLabel('1').files[0]!, 'dataset', 'documents of the two held-out templates').texts, savedFinal.datasetSplit.ofHeldOutTemplates)
note()
note('# What the final run says of its own checks, as its file of counts holds it (not run again here)')
note()
note(`Second counts: ${withThousands(savedFinal.secondCounts.compared)} compared, ${savedFinal.secondCounts.different.length} differ. Tables with no cell changed: ${withThousands(savedFinal.unchangedTables.compared)} counts compared, ${savedFinal.unchangedTables.different.length} differ, ${savedFinal.bases.length} such tables. Tables held against today: ${savedFinal.asToday.map(entry => `${entry.parsers} on ${entry.set}`).join(', ')}. Problems of the run: ${savedFinal.problems.length}.`)

// ---------------------------------------------------------------------------------------------------------------
// The lines of the final report's tables, made again from the counts of this folder.

const madeLines = new Map<string, number>()
// A line of a table as the final report writes it, with the number of its cells that hold a number of the scoring.
const makeLine = (cells: readonly string[], numberCells: number) => madeLines.set(`| ${cells.join(' | ')} |`, numberCells)
const heldBackSets = ['generator', 'written'] as const
const nameOfVerdictSet = {generator: 'The generator\'s set', written: 'The written cases with full agreement'}
const [rowTwo, rowThree, rowFour, rowSeven] = [rowOfLabel('2'), rowOfLabel('3'), rowOfLabel('4'), rowOfLabel('7')]
for (const set of heldBackSets) {
  makeLine([nameOfVerdictSet[set], allThreeOfRow(rowTwo, set)[0]!.toFixed(2), allThreeOfRow(rowThree, set)[0]!.toFixed(2), `${lowestOf(allThreeOfRow(rowFour, set)).toFixed(2)} (seed ${seedOfLowest(rowFour, set)})`, `${lowestOf(allThreeOfRow(rowSeven, set)).toFixed(2)} (seed ${seedOfLowest(rowSeven, set)})`], 4)
}
for (const label of ['4', '5', '6', '7', '8']) {
  for (const set of heldBackSets) {
    const values = allThreeOfRow(rowOfLabel(label), set)
    const lowest = lowestOf(values)
    const against = (other: number) => `${lowest > other ? 'above' : 'not above'}, ${signed(lowest - other)}`
    makeLine([label, set === 'generator' ? 'generator' : 'written, full agreement', `${lowest.toFixed(2)} (seed ${seedOfLowest(rowOfLabel(label), set)})`, meanOf(values).toFixed(2), against(allThreeOfRow(rowTwo, set)[0]!), against(allThreeOfRow(rowThree, set)[0]!)], 4)
  }
}
for (const row of rows) {
  makeLine([
    `${row.label}, ${row.name}`, spreadOf(allThreeOfRow(row, 'generator'), 2), spreadOf(wholeOfRow(row, 'generator'), 1), countSpreadOf(addedAsErrorOfRow(row, 'generator')),
    spreadOf(allThreeOfRow(row, 'written'), 2), spreadOf(wholeOfRow(row, 'written'), 1), countSpreadOf(addedAsErrorOfRow(row, 'written')),
  ], 6)
  if (row.files[0]!.path === null) continue
  for (const file of row.files) {
    const shares = (set: SetName) => `${allThreeOf(rowCounts(file, set, mainRowOf[set])).toFixed(2)} / ${wholeOf(rowCounts(file, set, mainRowOf[set])).toFixed(1)}`
    makeLine([row.label, file.seed === null ? '' : String(file.seed), shares('generator'), shares('written'), shares('dataset')], 3)
  }
}
const rowNamesOf = (set: SetName) => [...rowOfLabel('1').files[0]!.counts[set].rows.keys()]
const sizeCells = (set: SetName, rowName: string) => {
  const counts = rowCounts(rowOfLabel('1').files[0]!, set, rowName)
  return [withThousands(counts.texts), withThousands(counts.scored)]
}
function makeBreakdown(set: SetName, rowNames: readonly string[], share: 'all three' | 'whole', withSpread: boolean) {
  for (const rowName of rowNames) {
    const cells = rows.map(row => {
      const values = share === 'all three' ? allThreeOfRow(row, set, rowName) : wholeOfRow(row, set, rowName)
      const digits = share === 'all three' ? 2 : 1
      if (values.some(value => Number.isNaN(value))) return '-'
      return withSpread ? spreadOf(values, digits) : meanOf(values).toFixed(digits)
    })
    makeLine([rowName.startsWith('kind: ') && set === 'generator' ? `\`${rowName.slice(6)}\`` : rowName, ...sizeCells(set, rowName), ...cells], 2 + cells.length)
  }
}
// The kinds of the generator in the order of their definitions, which is the order of the final report.
const generatorKindRows = kindsOfTheGenerator.map(kind => `kind: ${kind.name}`).filter(name => rowNamesOf('generator').includes(name))
for (const share of ['all three', 'whole'] as const) {
  makeBreakdown('generator', rowNamesOf('generator').filter(name => !name.startsWith('kind: ')), share, true)
  makeBreakdown('generator', generatorKindRows, share, false)
  makeBreakdown('written', rowNamesOf('written'), share, true)
}
makeBreakdown('dataset', rowNamesOf('dataset').filter(name => !name.startsWith('template: ') || name === 'template: deployConfig' || name === 'template: taskRunner'), 'all three', true)
makeBreakdown('dataset', ['all', 'documents of the two held-out templates', 'documents of the 16 templates that the train data has'], 'whole', true)
// In how many kinds of the generator the mean of a row is above and below the mean of another row.
const kindsAboveAndBelow = (row: RowOfTheExperiment, other: RowOfTheExperiment, share: 'all three' | 'whole') => {
  const valueOf = (of: RowOfTheExperiment, rowName: string) => meanOf(share === 'all three' ? allThreeOfRow(of, 'generator', rowName) : wholeOfRow(of, 'generator', rowName))
  return {above: generatorKindRows.filter(name => valueOf(row, name) > valueOf(other, name)), below: generatorKindRows.filter(name => valueOf(row, name) < valueOf(other, name))}
}
const aboveAndBelowCell = (row: RowOfTheExperiment, other: RowOfTheExperiment, share: 'all three' | 'whole') => `${kindsAboveAndBelow(row, other, share).above.length} above, ${kindsAboveAndBelow(row, other, share).below.length} below`
for (const row of rows.slice(2)) {
  makeLine([row.label, aboveAndBelowCell(row, rowTwo, 'all three'), aboveAndBelowCell(row, rowTwo, 'whole'), row.label === '3' ? '' : aboveAndBelowCell(row, rowThree, 'all three'), row.label === '3' ? '' : aboveAndBelowCell(row, rowThree, 'whole')], row.label === '3' ? 2 : 4)
}
const labelKindShares = (row: RowOfTheExperiment, set: SetName, kind: number) => row.files.map(file => 100 * file.counts[set].perLabelKind[kind]!.right / file.counts[set].perLabelKind[kind]!.scored)
for (const set of savedSets) {
  labelKindNames.forEach((kindName, kind) => {
    const scored = rowOfLabel('1').files[0]!.counts[set].perLabelKind[kind]!.scored
    if (scored > 0) makeLine([kindName, withThousands(scored), ...rows.map(row => meanOf(labelKindShares(row, set, kind)).toFixed(1))], 1 + rows.length)
  })
}
for (const row of rows) makeLine([row.label, countSpreadOf(addedAsErrorOfRow(row, 'generator', 'all')), countSpreadOf(addedAsErrorOfRow(row, 'written', 'all cases, the agreed code points')), countSpreadOf(addedAsErrorOfRow(row, 'dataset', 'all'))], 3)

// The sentences of the final report that hold sizes.
const sizeOf = (set: SetName, rowName: string) => rowCounts(rowOfLabel('1').files[0]!, set, rowName)
const [generatorSize, writtenSize, writtenSizeOfAllCases, datasetSize] = [sizeOf('generator', 'all'), sizeOf('written', 'cases with full agreement'), sizeOf('written', 'all cases, the agreed code points'), sizeOf('dataset', 'all')]
const madeSentences = [
  `The generator's set: ${withThousands(generatorSize.texts)} samples, ${withThousands(generatorSize.scored)} scored code points, ${withThousands(generatorSize.added)} added code points. The written set's cases with full agreement: ${withThousands(writtenSize.texts)} cases, ${withThousands(writtenSize.texts - writtenSize.nothingToRecover)} of them with something to recover, ${withThousands(writtenSize.scored)} scored code points, ${withThousands(writtenSize.added)} added code points.`,
  `: ${withThousands(datasetSize.texts)} samples, ${withThousands(datasetSize.scored)} scored code points, ${withThousands(datasetSize.added)} added code points. The damage is the ten neutral edits`,
  `| Row | Generator, of ${withThousands(generatorSize.added)} | Written, all ${writtenSizeOfAllCases.texts} cases, of ${withThousands(writtenSizeOfAllCases.added)} | The dataset's test split, of ${withThousands(datasetSize.added)} |`,
  `each show ${withThousands(asToday.generator.documents)} valid documents (${withThousands(asToday.generator.documentCodePoints)} code points) and the ${withThousands(asToday.generator.brokenTexts)} broken texts before their first error (${withThousands(asToday.generator.codePointsBeforeTheError)} code points)`,
  `each show ${withThousands(asToday.written.documents)} valid documents (${withThousands(asToday.written.documentCodePoints)} code points) and the ${withThousands(asToday.written.brokenTexts)} broken texts before their first error (${withThousands(asToday.written.codePointsBeforeTheError)} code points)`,
  `each show ${withThousands(asToday.dataset.documents)} valid documents (${withThousands(asToday.dataset.documentCodePoints)} code points) and the ${withThousands(asToday.dataset.brokenTexts)} broken texts before their first error (${withThousands(asToday.dataset.codePointsBeforeTheError)} code points)`,
]

function holdReport(path: string) {
  const heading = `the lines of ${path.split('/').slice(-2).join('/')}`
  const reportText = readFileSync(path, 'utf8')
  const tally = tallyOf(heading)
  // The table lines of the report that hold numbers of the scoring: not the headers, not the list of the rows, and
  // not the list of the files, whose sha256 is held against the list above.
  let section = ''
  const linesOfTheReport = new Set<string>()
  for (const line of reportText.split('\n')) {
    if (line.startsWith('## ')) section = line
    if (!line.startsWith('| ') || line.startsWith('| --- ') || section === '## The rows' || section === '## What was checked in this run') continue
    if (/^\| (Row|All three|Whole|All three, in percent|Whole, in percent|All three per display kind of the label, in percent) \|/.test(line)) continue
    linesOfTheReport.add(line)
  }
  for (const [line, numberCells] of madeLines) {
    tally.compared += numberCells
    if (!linesOfTheReport.has(line)) tally.differing.push(`a line made here is not in the report: ${line}`)
  }
  for (const line of linesOfTheReport) if (!madeLines.has(line)) tally.differing.push(`a line of the report was not made here: ${line}`)
  for (const sentence of madeSentences) {
    tally.compared += (sentence.match(/\d[\d,]*/g) ?? []).length
    if (!reportText.includes(sentence)) tally.differing.push(`a sentence made here is not in the report: ${sentence}`)
  }
  // The list of the files in the report: the first 16 characters of each sha256.
  for (const listed of listedFiles) {
    tally.compared++
    const lineOfFile = `| ${listed.row} | ${listed.seed ?? ''} | ${listed.path.split('/').slice(-2).join('/')} | ${listed.sha256.slice(0, 16)} | `
    if (!reportText.includes(lineOfFile)) tally.differing.push(`the report has no line that starts with: ${lineOfFile}`)
  }
  return {tableLines: linesOfTheReport.size}
}
const linesOfRepoReport = holdReport(join(folderOfTheFinalScoring, 'final-report.md'))
holdReport(join(finalFolder, 'final.report.md'))
// The repo's copy of the report writes the scratch folder as <RECOVERY_SCRATCH> and list.json by its path from the
// repo root. The report of the run names both by their full paths.
// The history was rewritten when it was published, to take out the folders of the machine, so the commit of the run
// has another hash there. The repo's copy of the report names the commit by its published hash, the log by its hash
// before.
const publishedCommitOf: Record<string, string> = {'469f614efaa7c4e48ba08c06022e52c17e594db4': '6a3e1595c2b661703d07f3dd76802bd4d2c9dcc1'}
const reportOfTheRunAsCopied = readFileSync(join(finalFolder, 'final.report.md'), 'utf8').replaceAll(loggedRun.list, 'lab/recovery-toml/held-back/final/list.json').replaceAll(scratchFolder, '<RECOVERY_SCRATCH>').replaceAll(loggedRun.commit, publishedCommitOf[loggedRun.commit] ?? loggedRun.commit)
hold('files', 'final-report.md of the repo is the report of the run, with the scratch folder and the path of list.json written without the folders of the machine', sha256Of(join(folderOfTheFinalScoring, 'final-report.md')), sha256OfText(reportOfTheRunAsCopied))

// ---------------------------------------------------------------------------------------------------------------
// The tables of RESULTS.md and of the report as it was sent, cell by cell.

// A cell as both documents may write it: "0 (0 to 0)" is "0" there, and the report as sent writes "–" for " to ".
const plainCell = (cell: string) => cell.trim().replaceAll('–', ' to ').replace(/^(\d[\d,]*) \(\1 to \1\)$/, '$1')
const cellsOfLine = (line: string) => line.split('|').slice(1, -1).map(plainCell)
const sharesCell = (row: RowOfTheExperiment, set: SetName) => `${spreadOf(allThreeOfRow(row, set), 2)} / ${spreadOf(wholeOfRow(row, set), 1)}`
const addedCell = (row: RowOfTheExperiment, set: SetName) => plainCell(countSpreadOf(addedAsErrorOfRow(row, set)))
const verdictCells = (set: 'generator' | 'written') => [allThreeOfRow(rowTwo, set)[0]!.toFixed(2), allThreeOfRow(rowThree, set)[0]!.toFixed(2), `${lowestOf(allThreeOfRow(rowFour, set)).toFixed(2)} (seed ${seedOfLowest(rowFour, set)})`, `${lowestOf(allThreeOfRow(rowSeven, set)).toFixed(2)} (seed ${seedOfLowest(rowSeven, set)})`]
function holdCells(heading: string, what: string, madeHere: readonly string[], written: readonly string[]) {
  hold(heading, `${what}, the number of cells`, madeHere.length, written.length)
  madeHere.forEach((cell, place) => hold(heading, `${what}, cell ${place + 1}`, cell, written[place]))
}

const resultsText = readFileSync(join(folderOfTheFinalScoring, 'RESULTS.md'), 'utf8')
const resultsLines = resultsText.split('\n')
{
  const heading = 'the tables of final/RESULTS.md'
  const lineThatStarts = (start: string) => resultsLines.find(line => line.startsWith(start)) ?? ''
  holdCells(heading, 'the verdict, generator', [`The generator's set, ${withThousands(generatorSize.scored)} scored code points`, ...verdictCells('generator')], cellsOfLine(lineThatStarts('| The generator\'s set,')))
  holdCells(heading, 'the verdict, written', [`The written cases with full agreement, ${withThousands(writtenSize.scored)} scored code points`, ...verdictCells('written')], cellsOfLine(lineThatStarts('| The written cases with full agreement,')))
  for (const row of rows) {
    const cells = cellsOfLine(lineThatStarts(`| ${row.label}, `))
    holdCells(heading, `all eight rows, row ${row.label}`, [sharesCell(row, 'generator'), addedCell(row, 'generator'), sharesCell(row, 'written'), addedCell(row, 'written'), sharesCell(row, 'dataset')], cells.slice(1))
  }
  const sizesSentence = `The generator's set has ${withThousands(generatorSize.texts)} samples and ${withThousands(generatorSize.added)} added code points. The written set has ${withThousands(writtenSize.texts)} cases with full agreement, ${withThousands(writtenSize.texts - writtenSize.nothingToRecover)} of them with something to recover, and ${withThousands(writtenSize.added)} added code points. The dataset's test split has ${withThousands(datasetSize.texts)} samples`
  hold(heading, 'the sentence of the sizes', resultsText.includes(sizesSentence), true)
}
{
  // The two tables and the list of the report as it was sent to the lead, copied here by hand.
  const heading = 'the tables of the report as it was sent'
  const sent = {
    verdictOfGenerator: '| Generator, 3,000 samples, 488,580 scored code points | 89.81 | 98.67 | 84.81 (seed 5) | 89.59 (seed 5) |',
    verdictOfWritten: '| Written, 144 cases with full agreement, 20,303 scored code points | 84.25 | 93.97 | 81.50 (seed 5) | 83.02 (seed 4) |',
    rows: [
      '| 1, parser as it is | 69.29 / 9.5 | 8,135 | 61.72 / 4.9 | 951 |',
      '| 2, the one rule | 89.81 / 37.9 | 8,135 | 84.25 / 29.6 | 951 |',
      '| 3, hand-written | 98.67 / 81.7 | 0 | 93.97 / 60.6 | 0 |',
      '| 4, neutral, no search | 86.63 (84.81–87.57) / 28.6 (25.0–31.9) | 291 (110–627) | 81.84 (81.50–82.20) / 21.0 (19.0–23.2) | 35 (8–83) |',
      '| 5, neutral, search | 92.90 (92.07–93.69) / 50.7 (49.3–52.1) | 1 (0–4) | 89.08 (87.82–90.52) / 43.0 (40.1–46.5) | 0 |',
      '| 6, search, no training | 93.80 (93.13–94.38) / 46.3 (42.5–50.9) | 0 | 89.83 (88.96–90.35) / 43.0 (40.8–44.4) | 3 |',
      '| 7, mixed, no search | 90.37 (89.59–91.49) / 37.1 (31.6–40.6) | 455 (291–843) | 83.85 (83.02–84.76) / 21.1 (18.3–24.6) | 53 (20–107) |',
      '| 8, mixed, search | 98.34 (98.18–98.77) / 82.7 (80.2–85.3) | 0 | 92.74 (90.95–93.58) / 55.4 (52.1–56.3) | 1 (0–4) |',
    ],
    addedCodePoints: {generator: '23,804', written: '1,844'},
    testSplit: ['62.31', '91.72', '94.76', '89.28', '96.31', '95.52', '88.74', '95.94'],
    samplesOfTheTestSplit: '12,536',
  }
  holdCells(heading, 'the deciding numbers, generator', [`Generator, ${withThousands(generatorSize.texts)} samples, ${withThousands(generatorSize.scored)} scored code points`, ...verdictCells('generator')], cellsOfLine(sent.verdictOfGenerator))
  holdCells(heading, 'the deciding numbers, written', [`Written, ${withThousands(writtenSize.texts)} cases with full agreement, ${withThousands(writtenSize.scored)} scored code points`, ...verdictCells('written')], cellsOfLine(sent.verdictOfWritten))
  rows.forEach((row, place) => holdCells(heading, `all eight rows, row ${row.label}`, [sharesCell(row, 'generator').replaceAll('–', ' to '), addedCell(row, 'generator'), sharesCell(row, 'written'), addedCell(row, 'written')], cellsOfLine(sent.rows[place]!).slice(1)))
  hold(heading, 'added code points of the generator', withThousands(generatorSize.added), sent.addedCodePoints.generator)
  hold(heading, 'added code points of the written cases with full agreement', withThousands(writtenSize.added), sent.addedCodePoints.written)
  rows.forEach((row, place) => hold(heading, `the test split, row ${row.label}`, meanOf(allThreeOfRow(row, 'dataset')).toFixed(2), sent.testSplit[place]))
  hold(heading, 'samples of the test split', withThousands(datasetSize.texts), sent.samplesOfTheTestSplit)
}

// ---------------------------------------------------------------------------------------------------------------
// The numbers that the final scoring made afterwards from its saved counts (after.txt), line by line.

const afterLines: string[] = []
const savedNameOfSet = (set: SetName) => set.padEnd(9)
for (const set of heldBackSets) {
  for (const label of ['2', '3', '4', '7']) {
    for (const file of rowOfLabel(label).files) {
      const counts = rowCounts(file, set, mainRowOf[set])
      afterLines.push(`  ${savedNameOfSet(set)} row ${label}${file.seed === null ? '       ' : ` seed ${file.seed}`}: ${counts.right} of ${counts.scored} = ${allThreeOf(counts).toFixed(2)}, whole ${counts.whole} of ${counts.texts - counts.nothingToRecover}`)
    }
  }
}
const rightOf = (row: RowOfTheExperiment, set: SetName) => row.files.map(file => rowCounts(file, set, mainRowOf[set]).right)
for (const set of heldBackSets) {
  for (const label of ['4', '5', '6', '7', '8']) {
    const rights = rightOf(rowOfLabel(label), set)
    afterLines.push(`  ${savedNameOfSet(set)} row ${label}: ${rights.filter(right => right > rightOf(rowTwo, set)[0]!).length} of ${rights.length} seeds above row 2, ${rights.filter(right => right > rightOf(rowThree, set)[0]!).length} above row 3`)
  }
}
const headerName = labelKindNames.indexOf('headerName')
// "All three" of a file over the main row of a set without the code points whose label is the name of a header, and
// over those code points alone.
function headerNameShares(file: FileOfRow, set: SetName) {
  const ofKinds = file.counts[set].perLabelKind
  const scored = ofKinds.reduce((total, of) => total + of.scored, 0)
  const right = ofKinds.reduce((total, of) => total + of.right, 0)
  const ofHeaders = ofKinds[headerName]!
  return {without: 100 * (right - ofHeaders.right) / (scored - ofHeaders.scored), alone: 100 * ofHeaders.right / ofHeaders.scored, scoredHeaderNames: ofHeaders.scored}
}
for (const set of savedSets) {
  for (const row of rows) {
    afterLines.push(`  ${savedNameOfSet(set)} row ${row.label}: without header names ${spreadOf(row.files.map(file => headerNameShares(file, set).without), 2)}; header names alone ${spreadOf(row.files.map(file => headerNameShares(file, set).alone), 2)}`)
  }
}
const meanShares = (row: RowOfTheExperiment, set: SetName) => `${meanOf(allThreeOfRow(row, set)).toFixed(2)} / ${meanOf(wholeOfRow(row, set)).toFixed(1)}`
for (const row of rows) afterLines.push(`  row ${row.label}: validation ${meanShares(row, 'validation')}; test split ${meanShares(row, 'dataset')}; generator ${meanShares(row, 'generator')}; written ${meanShares(row, 'written')}`)
// The places of the texts of a set that a file has whole, over every text of the set.
const wholeTextsOf = (file: FileOfRow, set: SetName) => new Set(file.counts[set].rightPerText.flatMap((right, place) => file.counts[set].scoredPerText[place]! > 0 && right === file.counts[set].scoredPerText[place] ? [place] : []))
for (const set of heldBackSets) {
  for (const [first, second] of [['8', '3'], ['5', '2'], ['4', '2'], ['7', '2'], ['3', '2'], ['8', '5'], ['6', '5']] as const) {
    const wholeOfSecond = rowOfLabel(second).files.map(file => wholeTextsOf(file, set))
    const pairs = rowOfLabel(first).files.map((file, place) => {
      const wholeOfFirst = wholeTextsOf(file, set)
      const other = wholeOfSecond[Math.min(place, wholeOfSecond.length - 1)]!
      return `${[...wholeOfFirst].filter(text => !other.has(text)).length}/${[...other].filter(text => !wholeOfFirst.has(text)).length}`
    })
    afterLines.push(`  ${savedNameOfSet(set)} row ${first} whole and row ${second} not / row ${second} whole and row ${first} not, per seed (same seed of both where both have seeds): ${pairs.join(', ')}`)
  }
}
const wholeForThreeAndEight = (set: SetName) => {
  const wholeOfThree = wholeTextsOf(rowThree.files[0]!, set)
  const wholeOfEights = rowOfLabel('8').files.map(file => wholeTextsOf(file, set))
  const result = {onlyThree: 0, onlyEveryEight: 0, both: 0, neither: 0}
  rowThree.files[0]!.counts[set].scoredPerText.forEach((scored, place) => {
    if (scored === 0) return
    const everyEight = wholeOfEights.every(whole => whole.has(place))
    const noEight = wholeOfEights.every(whole => !whole.has(place))
    if (wholeOfThree.has(place) && noEight) result.onlyThree++
    if (!wholeOfThree.has(place) && everyEight) result.onlyEveryEight++
    if (wholeOfThree.has(place) && everyEight) result.both++
    if (!wholeOfThree.has(place) && noEight) result.neither++
  })
  return result
}
for (const set of heldBackSets) {
  const {onlyThree, onlyEveryEight, both, neither} = wholeForThreeAndEight(set)
  afterLines.push(`  ${set}: whole for row 3 and for no seed of row 8: ${onlyThree}; whole for every seed of row 8 and not for row 3: ${onlyEveryEight}; whole for row 3 and every seed of row 8: ${both}; whole for neither: ${neither}`)
}
for (const label of ['5', '6', '8']) {
  const wholeShare = (row: RowOfTheExperiment, rowName: string) => meanOf(row.files.map(file => 100 * rowCounts(file, 'generator', rowName).whole / rowCounts(file, 'generator', rowName).texts))
  const below = generatorKindRows.filter(name => wholeShare(rowOfLabel(label), name) < wholeShare(rowTwo, name)).map(name => `${name.slice(6)} ${wholeShare(rowOfLabel(label), name).toFixed(1)} against ${wholeShare(rowTwo, name).toFixed(1)}`)
  afterLines.push(`  row ${label}: ${below.length} kinds: ${below.join('; ')}`)
}
{
  const tally = tallyOf('the lines of final/after.txt')
  const linesOfAfter = readFileSync(join(finalFolder, 'after.txt'), 'utf8').split('\n').filter(line => line.startsWith('  '))
  for (const line of afterLines) {
    tally.compared += (line.replace(/row \d|seed \d+|above row \d/g, '').match(/\d[\d.]*/g) ?? []).length
    if (!linesOfAfter.includes(line)) tally.differing.push(`a line made here is not in after.txt: ${line}`)
  }
  for (const line of linesOfAfter) if (!afterLines.includes(line)) tally.differing.push(`a line of after.txt was not made here: ${line}`)
}

// ---------------------------------------------------------------------------------------------------------------
// The numbers behind the sentences of the report, per seed.

note()
note('# The rows that the verdict reads and the rows beside them, per file')
note()
note('Right of scored code points, the difference to row 2 and to row 3 in code points, and whole texts of the texts with something to recover.')
for (const set of heldBackSets) {
  const scored = rowCounts(rowTwo.files[0]!, set, mainRowOf[set]).scored
  const withSomething = rowCounts(rowTwo.files[0]!, set, mainRowOf[set]).texts - rowCounts(rowTwo.files[0]!, set, mainRowOf[set]).nothingToRecover
  note(`  ${set}, ${mainRowOf[set]}: ${withThousands(rowCounts(rowTwo.files[0]!, set, mainRowOf[set]).texts)} texts, ${withThousands(withSomething)} with something to recover, ${withThousands(scored)} scored code points`)
  for (const row of rows) {
    for (const file of row.files) {
      const counts = rowCounts(file, set, mainRowOf[set])
      const againstTwo = counts.right - rightOf(rowTwo, set)[0]!
      const againstThree = counts.right - rightOf(rowThree, set)[0]!
      const wholeAgainst = (other: RowOfTheExperiment) => counts.whole - rowCounts(other.files[0]!, set, mainRowOf[set]).whole
      note(`    row ${row.label}${file.seed === null ? '' : ` seed ${file.seed}`}: ${counts.right} = ${allThreeOf(counts).toFixed(2)}%, ${againstTwo >= 0 ? '+' : ''}${againstTwo} against row 2, ${againstThree >= 0 ? '+' : ''}${againstThree} against row 3; whole ${counts.whole} = ${wholeOf(counts).toFixed(1)}%, ${wholeAgainst(rowTwo) >= 0 ? '+' : ''}${wholeAgainst(rowTwo)} against row 2, ${wholeAgainst(rowThree) >= 0 ? '+' : ''}${wholeAgainst(rowThree)} against row 3; added shown as an error ${counts.addedShownAsError} of ${counts.added}`)
    }
  }
}
note()
note('How many files of a row are above another row, in all three and in whole texts, and the mean and the lowest file against it in points:')
for (const set of heldBackSets) {
  for (const row of rows.slice(3)) {
    for (const other of [rowTwo, rowThree]) {
      const [allThree, whole] = [allThreeOfRow(row, set), wholeOfRow(row, set)]
      const [otherAllThree, otherWhole] = [allThreeOfRow(other, set)[0]!, wholeOfRow(other, set)[0]!]
      note(`  ${set}, row ${row.label} against row ${other.label}: all three ${allThree.filter(value => value > otherAllThree).length} of ${allThree.length} above, mean ${signed(meanOf(allThree) - otherAllThree)}, lowest ${signed(lowestOf(allThree) - otherAllThree)}, highest ${signed(highestOf(allThree) - otherAllThree)}; whole ${whole.filter(value => value > otherWhole).length} of ${whole.length} above, mean ${signed(meanOf(whole) - otherWhole, 1)}`)
    }
  }
}
note()
note('The verdict by the rule, from these counts:')
{
  const above = (row: RowOfTheExperiment, other: RowOfTheExperiment, set: SetName) => lowestOf(allThreeOfRow(row, set)) > allThreeOfRow(other, set)[0]!
  const aboveBothOnBoth = (row: RowOfTheExperiment) => heldBackSets.every(set => above(row, rowTwo, set) && above(row, rowThree, set))
  const verdict = aboveBothOnBoth(rowFour) ? 'carried over with neutral damage alone' : aboveBothOnBoth(rowSeven) ? 'carried over with kinds written for the language'
    : heldBackSets.some(set => above(rowFour, rowTwo, set) || above(rowSeven, rowTwo, set)) ? 'partly' : 'failed'
  note(`  with the lowest seed of the rows 4 and 7: ${verdict}`)
  const meanAbove = (row: RowOfTheExperiment, other: RowOfTheExperiment, set: SetName) => meanOf(allThreeOfRow(row, set)) > allThreeOfRow(other, set)[0]!
  note(`  with the mean in the place of the lowest seed: row 4 above row 2 on ${setsOrNone(heldBackSets.filter(set => meanAbove(rowFour, rowTwo, set)))}; row 7 above row 2 on ${setsOrNone(heldBackSets.filter(set => meanAbove(rowSeven, rowTwo, set)))}, above row 3 on ${setsOrNone(heldBackSets.filter(set => meanAbove(rowSeven, rowThree, set)))}`)
  for (const label of ['5', '6', '8']) note(`  row ${label} with its lowest seed: above row 2 on ${setsOrNone(heldBackSets.filter(set => above(rowOfLabel(label), rowTwo, set)))}, above row 3 on ${setsOrNone(heldBackSets.filter(set => above(rowOfLabel(label), rowThree, set)))}`)
}
note()
note('Differences of means, in points (all three / whole):')
{
  const difference = (first: string, second: string, set: SetName) => `${signed(meanOf(allThreeOfRow(rowOfLabel(first), set)) - meanOf(allThreeOfRow(rowOfLabel(second), set)))} / ${signed(meanOf(wholeOfRow(rowOfLabel(first), set)) - meanOf(wholeOfRow(rowOfLabel(second), set)), 1)}`
  for (const [first, second] of [['5', '2'], ['5', '3'], ['8', '3'], ['8', '5'], ['5', '6'], ['7', '2'], ['4', '2']] as const) {
    note(`  row ${first} minus row ${second}: generator ${difference(first, second, 'generator')}; written ${difference(first, second, 'written')}; test split ${difference(first, second, 'dataset')}; validation ${difference(first, second, 'validation')}`)
  }
  for (const row of rows) {
    const from = (set: SetName) => meanOf(allThreeOfRow(row, set))
    note(`  row ${row.label}: from validation to the test split ${signed(from('dataset') - from('validation'))}, from validation to the generator ${signed(from('generator') - from('validation'))}, from the test split to the generator ${signed(from('generator') - from('dataset'))}, from the test split to the written cases ${signed(from('written') - from('dataset'))}`)
  }
}
note()
note('The validation split, all three / whole per row, and per file:')
for (const row of rows) note(`  row ${row.label}: ${spreadOf(allThreeOfRow(row, 'validation'), 2)} / ${spreadOf(wholeOfRow(row, 'validation'), 1)}${row.files.length > 1 ? `; per file ${row.files.map(file => `seed ${file.seed} ${allThreeOf(rowCounts(file, 'validation', 'all')).toFixed(2)}`).join(', ')}` : ''}`)
note()
note('Header names: all three on the code points whose label is the name of a header, and on all other scored code points:')
for (const set of setNames) {
  note(`  ${set}: ${withThousands(headerNameShares(rowTwo.files[0]!, set).scoredHeaderNames)} scored code points are names of headers`)
  for (const row of rows) note(`    row ${row.label}: header names ${spreadOf(row.files.map(file => headerNameShares(file, set).alone), 1)}; all others ${spreadOf(row.files.map(file => headerNameShares(file, set).without), 2)}`)
}
note()
note('The kinds of the generator, by the mean of a row\'s files:')
for (const row of rows.slice(2)) {
  for (const other of [rowTwo, rowThree]) {
    if (row === other) continue
    for (const share of ['all three', 'whole'] as const) {
      const {above, below} = kindsAboveAndBelow(row, other, share)
      note(`  row ${row.label} against row ${other.label}, ${share}: ${above.length} above, ${below.length} below${below.length > 0 && below.length <= 9 ? ` (${below.map(name => name.slice(6)).join(', ')})` : ''}${above.length > 0 && above.length <= 3 ? `; above in ${above.map(name => name.slice(6)).join(', ')}` : ''}`)
    }
  }
}
note()
note('The kinds of the generator, by every file of a row: in how many kinds every file is above row 2, in all three:')
for (const row of rows.slice(3)) {
  const everyFileAbove = generatorKindRows.filter(name => allThreeOfRow(row, 'generator', name).every(value => value > allThreeOfRow(rowTwo, 'generator', name)[0]!))
  const noFileAbove = generatorKindRows.filter(name => allThreeOfRow(row, 'generator', name).every(value => value <= allThreeOfRow(rowTwo, 'generator', name)[0]!))
  note(`  row ${row.label}: every file above in ${everyFileAbove.length} of ${generatorKindRows.length} kinds, no file above in ${noFileAbove.length}`)
}
note()
note('Documents of the two held-out templates against the other documents, on the generator, all three, mean:')
for (const row of rows) {
  const heldOut = meanOf(allThreeOfRow(row, 'generator', 'documents of the two held-out templates'))
  const others = meanOf(allThreeOfRow(row, 'generator', 'documents of the 14 templates that the train data has'))
  const heldOutOfTest = meanOf(allThreeOfRow(row, 'dataset', 'documents of the two held-out templates'))
  const othersOfTest = meanOf(allThreeOfRow(row, 'dataset', 'documents of the 16 templates that the train data has'))
  note(`  row ${row.label}: generator ${heldOut.toFixed(2)} against ${others.toFixed(2)}, ${signed(heldOut - others)}; test split ${heldOutOfTest.toFixed(2)} against ${othersOfTest.toFixed(2)}, ${signed(heldOutOfTest - othersOfTest)}`)
}
note()
note('The ranges of the rows 5 and 6:')
for (const set of heldBackSets) {
  const [five, six] = [allThreeOfRow(rowOfLabel('5'), set), allThreeOfRow(rowOfLabel('6'), set)]
  note(`  ${set}: row 5 ${lowestOf(five).toFixed(2)} to ${highestOf(five).toFixed(2)}, row 6 ${lowestOf(six).toFixed(2)} to ${highestOf(six).toFixed(2)}, ${lowestOf(six) <= highestOf(five) && lowestOf(five) <= highestOf(six) ? 'they overlap' : 'they do not overlap'}`)
}
note()
note(`One case of the written cases with full agreement is ${(100 / (writtenSize.texts - writtenSize.nothingToRecover)).toFixed(2)} points of whole.`)
{
  const namesOfTheMixedSet = new Set(kindsOfTheMixedSet.map(kind => kind.name))
  const shared = kindsOfTheGenerator.filter(kind => namesOfTheMixedSet.has(kind.name)).map(kind => kind.name)
  note(`Of the generator's ${kindsOfTheGenerator.length} kinds, ${shared.length} have the name of one of the mixed set's ${kindsOfTheMixedSet.length} kinds: ${shared.join(', ')}.`)
}

note()
note('The rows 4, 7, 5 and 8 against the rule, per part of a set, in all three: how many files are above the rule, and the mean and the lowest file against it in points:')
for (const [set, partNames] of [['generator', rowNamesOf('generator').filter(name => !name.startsWith('kind: '))], ['written', rowNamesOf('written').filter(name => !name.startsWith('agreed code points') && !name.startsWith('all cases'))], ['dataset', ['all', 'documents of the two held-out templates', 'documents of the 16 templates that the train data has']]] as const) {
  for (const partName of partNames) {
    const ofTheRule = allThreeOfRow(rowTwo, set, partName)[0]!
    const cells = ['4', '7', '5', '8'].map(label => {
      const values = allThreeOfRow(rowOfLabel(label), set, partName)
      return `row ${label} ${values.filter(value => value > ofTheRule).length} of ${values.length}, ${signed(meanOf(values) - ofTheRule)}, ${signed(lowestOf(values) - ofTheRule)}`
    })
    note(`  ${set}, ${partName} (${withThousands(sizeOf(set, partName).texts)} texts, the rule ${ofTheRule.toFixed(2)}): ${cells.join('; ')}`)
  }
}

// The names of headers again, on the two parts of the generator's set by the template of the document.
note()
note('The generator\'s set by the template of the document: the share of the scored code points that are names of headers, all three on them, and all three on all other scored code points:')
for (const partName of ['documents of the two held-out templates', 'template: deployConfig', 'template: taskRunner', 'documents of the 14 templates that the train data has']) {
  const ofPart = (row: RowOfTheExperiment) => row.files.map(file => {
    const ofKinds = countSet(texts.generator, partName, file.path === null ? showWithTheRule : showWithExactParser(loadTables(file.path).tables)).perLabelKind
    const scored = ofKinds.reduce((total, of) => total + of.scored, 0)
    const right = ofKinds.reduce((total, of) => total + of.right, 0)
    const ofHeaders = ofKinds[headerName]!
    return {shareOfHeaderNames: 100 * ofHeaders.scored / scored, headerNames: 100 * ofHeaders.right / ofHeaders.scored, others: 100 * (right - ofHeaders.right) / (scored - ofHeaders.scored)}
  })
  const cells = [rowTwo, rowThree, rowFour, rowSeven].map(row => `row ${row.label} ${spreadOf(ofPart(row).map(of => of.headerNames), 1)} and ${spreadOf(ofPart(row).map(of => of.others), 2)}`)
  note(`  ${partName}: ${ofPart(rowTwo)[0]!.shareOfHeaderNames.toFixed(1)}% are names of headers; ${cells.join('; ')}`)
}

// The validation numbers that the training side saved with every file: the record of a run of the rows 4 to 6 has
// the dataset's validation split, and the record of a run of the rows 7 and 8 has the mixed set's.
type RecordRow = {name: string, samples: number, nothingToRecover: number, codePoints: number, allRight: number, kindScored: number, kindRight: number, nestingScored: number, depthRight: number, containerRight: number, wholeSamples: number, addedCodePoints: number, addedShownAsError: number}
const fieldOfRecord: Record<typeof countFields[number], keyof RecordRow> = {
  texts: 'samples', nothingToRecover: 'nothingToRecover', scored: 'codePoints', right: 'allRight', whole: 'wholeSamples', kindScored: 'kindScored', kindRight: 'kindRight',
  nestingScored: 'nestingScored', depthRight: 'depthRight', containerRight: 'containerRight', added: 'addedCodePoints', addedShownAsError: 'addedShownAsError',
}
const recordOf = (path: string) => JSON.parse(readFileSync(sourceTables.find(source => source.path === path)!.record, 'utf8')) as {validation: RecordRow[]}
function holdRecord(who: string, path: string, mine: CountsOfSet, rowIsHeld: (name: string) => boolean) {
  const heading = 'the validation counts in the records of the training runs'
  const recordRows = recordOf(path).validation.filter(row => rowIsHeld(row.name))
  hold(heading, `${who}, the rows`, [...mine.rows.keys()].filter(rowIsHeld).sort().join(' | '), recordRows.map(row => row.name).sort().join(' | '))
  for (const recordRow of recordRows) for (const field of countFields) hold(heading, `${who}, ${recordRow.name}, ${field}`, mine.rows.get(recordRow.name)?.[field], recordRow[fieldOfRecord[field]])
}
for (const label of ['4', '5', '6']) {
  for (const file of rowOfLabel(label).files) holdRecord(`row ${label} seed ${file.seed}`, file.path!, file.counts.validation, name => name === 'all' || name.startsWith('group: ') || name.startsWith('kind: '))
}
{
  // The mixed set's validation split: every second sample has a kind written for TOML in the place of the edits.
  const mixedValidation = mixedSamples('validation')
  const mixedTexts = textsOfDatasetSamples(mixedValidation.map(mixed => mixed.sample))
  mixedTexts.forEach((text, place) => text.rowNames.push(mixedValidation[place]!.half === 'kinds' ? 'source: kinds' : 'source: damage'))
  const rowOfTheMixedSet = (name: string) => name === 'all' || name.startsWith('source: ') || name.startsWith('kind: ')
  const kindsHalfOf = (show: Show) => allThreeOf(countSet(mixedTexts, 'all', show).rows.get('source: kinds')!)
  const ofTheRule = kindsHalfOf(showWithTheRule)
  const ofRowSeven: number[] = []
  for (const label of ['7', '8']) {
    for (const file of rowOfLabel(label).files) {
      const counts = countSet(mixedTexts, 'all', showWithExactParser(loadTables(file.path!).tables))
      holdRecord(`row ${label} seed ${file.seed}`, file.path!, counts, rowOfTheMixedSet)
      if (label === '7') ofRowSeven.push(allThreeOf(counts.rows.get('source: kinds')!))
    }
  }
  note()
  note(`The half of the mixed set's validation split with the kinds written for TOML, ${withThousands(mixedValidation.filter(mixed => mixed.half === 'kinds').length)} samples: the rule ${ofTheRule.toFixed(2)}, row 7 ${spreadOf(ofRowSeven, 2)}, the mean ${signed(meanOf(ofRowSeven) - ofTheRule)} against the rule, ${ofRowSeven.filter(value => value > ofTheRule).length} of ${ofRowSeven.length} seeds above.`)
}

// ---------------------------------------------------------------------------------------------------------------
// No text of a held-back set is a text of a train or validation sample.

note()
note('# Texts of the held-back sets among the train and validation texts')
note()
{
  const seenInTraining = new Set<string>()
  const tokenSequencesInTraining = new Set<string>()
  let kindsSamples = 0
  let kindsSamplesNotMade = 0
  for (const sample of [...dataset.train, ...dataset.validation]) {
    seenInTraining.add(sample.broken)
    seenInTraining.add(sample.original)
    tokenSequencesInTraining.add(splitKeyOf(sample.original))
    // The sample of the kinds written for TOML with the same index, whether or not the mixed set takes it: the mixed
    // set takes every second one of a split.
    try {
      const ofKinds = kindsSampleAt(datasetSeed, Number(sample.id.split(':')[1]), sample)
      seenInTraining.add(ofKinds.broken)
      seenInTraining.add(ofKinds.original)
      kindsSamples++
    } catch {
      kindsSamplesNotMade++
    }
  }
  const mixed = [...mixedSamples('train'), ...mixedSamples('validation')]
  const mixedNotSeen = mixed.filter(({sample}) => !seenInTraining.has(sample.broken) || !seenInTraining.has(sample.original)).length
  note(`Train and validation texts: the broken text and the document of ${withThousands(dataset.train.length + dataset.validation.length)} samples of the dataset, and of ${withThousands(kindsSamples)} samples of the kinds written for TOML on the same documents (${kindsSamplesNotMade} could not be made). ${withThousands(seenInTraining.size)} texts in all, with ${withThousands(tokenSequencesInTraining.size)} sequences of tokens. Of the ${withThousands(mixed.length)} samples of the mixed set, ${mixedNotSeen} have a text that is not among them.`)
  hold('no held-back text is a train or validation text', 'samples of the mixed set with a text that this check does not hold', mixedNotSeen, 0)
  for (const set of savedSets) {
    const broken = texts[set].map(text => text.broken)
    const documents = [...new Set(texts[set].flatMap(text => text.documents))]
    const brokenSeen = broken.filter(text => seenInTraining.has(text)).length
    const documentsSeen = documents.filter(text => seenInTraining.has(text)).length
    const sequencesSeen = documents.filter(document => tokenSequencesInTraining.has(splitKeyOf(document))).length
    const splits = documents.map(document => splitOf(document))
    note(`  ${set}: ${brokenSeen} of ${withThousands(broken.length)} broken texts and ${documentsSeen} of ${withThousands(documents.length)} valid documents are a train or validation text. ${sequencesSeen} of the documents have the sequence of tokens of a train or validation document. By the hash of their tokens, ${splits.filter(split => split === 'test').length} documents are in the test split, ${splits.filter(split => split === 'validation').length} in validation and ${splits.filter(split => split === 'train').length} in train.`)
    hold('no held-back text is a train or validation text', `${set}, broken texts among the train and validation texts`, brokenSeen, 0)
    hold('no held-back text is a train or validation text', `${set}, valid documents among the train and validation texts`, documentsSeen, 0)
  }
  // The written cases of which a repaired document has the sequence of tokens of a train or validation document,
  // and the rows that the verdict reads without those cases.
  const sharesTokens = texts.written.map(text => text.documents.some(document => tokenSequencesInTraining.has(splitKeyOf(document))))
  const inMainRow = texts.written.map(text => text.rowNames.includes(mainRowOf.written))
  const kept = texts.written.map((_, place) => inMainRow[place]! && !sharesTokens[place]!)
  const allThreeOfKept = (file: FileOfRow) => {
    const {scoredPerText, rightPerText} = file.counts.written
    const sum = (values: readonly number[]) => values.reduce((total, value, place) => total + (kept[place]! ? value : 0), 0)
    return 100 * sum(rightPerText) / sum(scoredPerText)
  }
  note(`  written: ${sharesTokens.filter(Boolean).length} of the ${texts.written.length} cases have a repaired document with the sequence of tokens of a train or validation document, ${sharesTokens.filter((shares, place) => shares && inMainRow[place]!).length} of them with full agreement. Without them, on the ${kept.filter(Boolean).length} other cases with full agreement: ${rows.map(row => `row ${row.label} ${spreadOf(row.files.map(allThreeOfKept), 2)}`).join('; ')}.`)
}

// ---------------------------------------------------------------------------------------------------------------
// The rows 1 and 2 against the numbers that ../README.md gave before any training.

note()
note('# The rows 1 and 2 against ../README.md')
note()
{
  const known = {generator: {'1': '69.3 / 9.5', '2': '89.8 / 37.9'}, written: {'1': '61.7 / 4.9', '2': '84.2 / 29.6'}}
  const readme = readFileSync(resolve(import.meta.dir, '..', 'README.md'), 'utf8')
  for (const set of heldBackSets) {
    for (const label of ['1', '2'] as const) {
      const counts = rowCounts(rowOfLabel(label).files[0]!, set, mainRowOf[set])
      const here = `${allThreeOf(counts).toFixed(1)} / ${wholeOf(counts).toFixed(1)}`
      hold('the rows 1 and 2 are the known ones', `${set}, row ${label}`, here, known[set][label])
      const [allThree, whole] = here.split(' / ')
      hold('the rows 1 and 2 are the known ones', `${set}, row ${label}: ../README.md names ${allThree}% and ${whole}%`, readme.includes(`${allThree}%`) && readme.includes(`${whole}%`), true)
      note(`  ${set}, row ${label}: ${counts.right} of ${counts.scored} and ${counts.whole} of ${counts.texts - counts.nothingToRecover} whole, ${here}; ../README.md says ${known[set][label]}`)
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------

note()
note('# What was held against what, and how much of it differs')
note()
let compared = 0
let differing = 0
for (const [heading, tally] of tallies) {
  compared += tally.compared
  differing += tally.differing.length
  note(`  ${heading}: ${withThousands(tally.compared)} compared, ${withThousands(tally.differing.length)} differ`)
  for (const sentence of tally.differing.slice(0, 40)) note(`    ${sentence}`)
}
note()
note(`In all: ${withThousands(compared)} values compared, ${withThousands(differing)} differ. The final report has ${linesOfRepoReport.tableLines} table lines with numbers of the scoring, and ${madeLines.size} lines were made here.`)
for (const [path, structure] of structureOfFile) console.log(`${path.split('/').slice(-2).join('/')}: ${structure}`)
writeFileSync(join(outFolder, 'recount.txt'), `${notes.join('\n')}\n`)
console.log(`\nThe notes are in ${join(outFolder, 'recount.txt')}.`)
if (differing > 0) process.exitCode = 1
