// The report of the saved runs on the mixed set, on validation only: row 1 (the parser as it is) and row 2 (anew at
// the next line after an error), which are scored here, next to the saved rows 7 and 8. On the mixed validation
// split and on its two halves apart, per group, per family and per kind, per display kind of the label, how the
// damage itself is shown, which classes the rule picked, and what the search changes.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-toml/kinds/runs/report.ts [--folder <folder>] [--neutral <folder>] [--write-list]
// Without --folder, the runs of <RECOVERY_SCRATCH>/mixed/. --write-list also writes tables.json to the folder: every
// saved table with its row, its seed and the sha256 of its file, which is what a final scoring takes.
//
// --neutral names the folder of the runs of ../../learn/runs/, by default <RECOVERY_SCRATCH>/neutral/. When it holds
// the list tables.json, the tables of its rows 4 and 5 are scored on the same samples and stand beside: they are the
// same recipe trained on the dataset's damage alone. And the tables of all four trained rows are scored on the
// validation split of the dataset's standard set, which is the samples that the README of ../../learn/runs/ reports.
//
// Every saved table is scored here again, and the report stops when a table of row 7 or 8 does not give the score of
// its record. A number with brackets is the mean of a row's seeds with the lowest and the highest.
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {type Samples, codePointKindScored, codePointScored, datasetKey, loadSamples, selectSamples, trainPart, validationPart} from '../../learn/data.ts'
import {optionOf, refuseUnknownOptions} from '../../learn/options.ts'
import {classesChosenFromTrainSamples, codePointsOfTheRule, recipeSettings} from '../../learn/recipe.ts'
import {createTrace} from '../../learn/recovery-parser.ts'
import {type RecoveryTables, asIsTables, classNames, differencesOf, displayKindNames, loadTablesOfThisDataset} from '../../learn/recovery-tables.ts'
import {type Parser, describeSpread, parserOfTables, restartAtNextLine, sha256OfFile} from '../../learn/runs/runs.ts'
import {type ScoreRow, cellsReadBy, countCells, isRead, scoreWith, sharesOf, wrongLabelsAt} from '../../learn/score.ts'
import {kindsKey, mixedSet} from '../mixed.ts'
import {
  aloneKindRowNameOf, editFamilyRowNames, familyOfMistakeNamed, kindRowNameOf, kindsHalfRowName, listFileName, mistakeFamilyRowNames, mixedRows, namesOfMistakes, neutralHalfRowName, oneEditFamilyRowNames, recordFileNameOf,
  rowNamed, rowNames, runsFolderOf, savedRunsOf, scoreRowsOfMixed,
} from './mixed-runs.ts'

refuseUnknownOptions('kinds/runs/report.ts', ['--folder', '--neutral', '--write-list'])
const folder = runsFolderOf(optionOf('--folder'))
const runs = savedRunsOf(folder)
if (runs.length === 0) throw new Error(`${folder} holds no record of a run on the mixed set`)
const {trainedOn} = runs[0]!.record
for (const {record, recordFile} of runs) {
  if (record.datasetKey !== datasetKey()) throw new Error(`${recordFile} is of the dataset ${record.datasetKey}, and the dataset is ${datasetKey()} now`)
  if (record.kindsKey !== kindsKey()) throw new Error(`${recordFile} is of the kinds ${record.kindsKey}, and the kinds are ${kindsKey()} now`)
  if (JSON.stringify(record.trainedOn) !== JSON.stringify(trainedOn)) throw new Error(`${recordFile} trained on other samples than ${runs[0]!.recordFile}`)
}
const range = {seed: trainedOn.datasetSeed, from: trainedOn.from, to: trainedOn.to}
const mixed = mixedSet(range)
const validation = validationPart(mixed)
const mixedTrain = trainPart(mixed)

const print = (text = '') => console.log(text)
const tableOf = (header: readonly string[], body: readonly (readonly string[])[]) => {
  print(`| ${header.join(' | ')} |`)
  print(`| ${header.map(() => '---').join(' | ')} |`)
  for (const cells of body) print(`| ${cells.join(' | ')} |`)
  print()
}
const percent = (share: number) => 100 * share
type Shares = ReturnType<typeof sharesOf>

// The saved tables of the rows 4 and 5 of the runs on the dataset's damage alone, when their folder has its list.
type ListedTable = {row: number, seed: number, file: string, path: string, sha256: string}
const neutralFolder = optionOf('--neutral') ?? (process.env['RECOVERY_SCRATCH'] === undefined ? undefined : join(process.env['RECOVERY_SCRATCH'], 'neutral'))
const neutralListFile = neutralFolder === undefined ? undefined : join(neutralFolder, listFileName)
const neutralTables: ListedTable[] = neutralListFile !== undefined && existsSync(neutralListFile)
  ? (JSON.parse(readFileSync(neutralListFile, 'utf8')) as {tables: ListedTable[]}).tables.filter(entry => entry.row === 4 || entry.row === 5)
  : []
const loadListed = (entry: ListedTable, directory: string): RecoveryTables => {
  const file = join(directory, entry.file)
  if (sha256OfFile(file) !== entry.sha256) throw new Error(`${file} does not have the sha256 of its list`)
  return loadTablesOfThisDataset(file).tables
}

// The lines of every table: a row of the experiment, with the tables of each of its seeds and their score rows on
// the mixed validation split.
type Line = {name: string, row: number, seeds: number[], parsers: Parser[], rowsOfSeed: ScoreRow[][]}
const lineOf = (name: string, row: number, seeds: number[], parsers: Parser[]): Line => ({name, row, seeds, parsers, rowsOfSeed: parsers.map(parser => scoreRowsOfMixed(parser, validation))})
const tablesOfRun = new Map(runs.map(run => [run.tablesFile, loadTablesOfThisDataset(run.tablesFile).tables]))
const runsOfRow = (row: number) => runs.filter(({record}) => record.row === row)
const mainLines: Line[] = [
  lineOf('row 1, the parser as it is', 1, [], [parserOfTables(asIsTables())]),
  lineOf('row 2, anew at the next line after an error', 2, [], [restartAtNextLine]),
  ...mixedRows.flatMap(row => runsOfRow(row).length === 0 ? [] : [lineOf(`row ${row}, ${rowNames[row]}`, row, runsOfRow(row).map(({record}) => record.seed), runsOfRow(row).map(({tablesFile}) => parserOfTables(tablesOfRun.get(tablesFile)!)))]),
]
// A table of row 7 or 8 has to give the score of its record.
for (const line of mainLines) {
  runsOfRow(line.row).forEach(({record, tablesFile}, seedAt) => {
    for (const name of ['all', neutralHalfRowName, kindsHalfRowName]) {
      if (JSON.stringify(rowNamed(line.rowsOfSeed[seedAt]!, name)) !== JSON.stringify(rowNamed(record.validation, name))) throw new Error(`${tablesFile} does not give the row "${name}" of its record on the mixed validation split`)
    }
  })
}
const neutralNames: Record<number, string> = {4: 'row 4, the same recipe trained on the dataset\'s damage alone, without the search', 5: 'row 5, the same with the search'}
const besideLines: Line[] = neutralFolder === undefined ? [] : [4, 5].flatMap(row => {
  const ofRow = neutralTables.filter(entry => entry.row === row)
  return ofRow.length === 0 ? [] : [lineOf(neutralNames[row]!, row, ofRow.map(entry => entry.seed), ofRow.map(entry => parserOfTables(loadListed(entry, neutralFolder))))]
})
const lines = [...mainLines, ...besideLines]
const shortNameOf = (line: Line) => `row ${line.row}`

// The spread over a line's seeds of one share of the score row `rowName`.
const spreadOf = (line: Line, rowName: string, shareOf: (shares: Shares) => number, digits = 2) =>
  describeSpread(line.rowsOfSeed.flatMap(rows => {
    const row = rowNamed(rows, rowName)
    return row === undefined ? [] : [percent(shareOf(sharesOf(row)))]
  }), digits)
const countSpread = (line: Line, rowName: string, countOf: (row: ScoreRow) => number) => describeSpread(line.rowsOfSeed.flatMap(rows => {
  const row = rowNamed(rows, rowName)
  return row === undefined ? [] : [countOf(row)]
}), 0)
const firstRows = lines[0]!.rowsOfSeed[0]!
const countsOf = (rowName: string) => {
  const row = rowNamed(firstRows, rowName)
  return row === undefined ? 'no sample' : `${row.samples} samples, ${row.codePoints} scored code points`
}

const all = rowNamed(firstRows, 'all')!
print(`# The runs of the frozen recipe on the mixed set, on the validation split`)
print()
print(`Dataset ${datasetKey()}, kinds ${kindsKey()}. The mixed set of the dataset's indexes ${range.from} to ${range.to - 1}: ${trainedOn.trainSamples} train samples, ${trainedOn.trainSamplesOfHalf.neutral} of the dataset and ${trainedOn.trainSamplesOfHalf.kinds} of the kinds, and ${all.samples} validation samples with ${all.codePoints} scored code points. The half of the dataset has damage that knows nothing of TOML: ${countsOf(neutralHalfRowName)}. The half of the kinds has one or two kinds of mistakes written for TOML: ${countsOf(kindsHalfRowName)}.`)
print()
print(`Row 7: the frozen recipe of learn/recipe.ts on the mixed train split, i.e. the training, the count and the last step, seeds ${runsOfRow(7).map(({record}) => record.seed).join(', ')}. Row 8: the same with the search before the count, seeds ${runsOfRow(8).map(({record}) => record.seed).join(', ')}. Rows 1 and 2 take no training. A number with brackets is the mean of a row's seeds with the lowest and the highest. Every number is of the validation split.${besideLines.length === 0 ? '' : ` Rows 4 and 5 stand beside: the tables that ${neutralFolder} lists, which the same recipe trained on the dataset's damage alone, scored here on the same samples.`}`)
print()

const parts = [
  {title: 'The mixed validation split', rowName: 'all'},
  {title: 'Its half of the dataset, whose damage knows nothing of TOML', rowName: neutralHalfRowName},
  {title: 'Its half of the kinds of mistakes written for TOML', rowName: kindsHalfRowName},
]
print('## All three and whole samples')
print()
for (const {title, rowName} of parts) {
  const row = rowNamed(firstRows, rowName)!
  print(`${title}: ${row.samples} samples, ${row.codePoints} scored code points, ${row.addedCodePoints} added code points.`)
  print()
  tableOf(['', 'all three', 'whole', 'display kind', 'depth', 'container', 'added code points shown as an error'], lines.map(line => [
    line.name, spreadOf(line, rowName, shares => shares.allThree), spreadOf(line, rowName, shares => shares.whole), spreadOf(line, rowName, shares => shares.kind), spreadOf(line, rowName, shares => shares.depth),
    spreadOf(line, rowName, shares => shares.container), countSpread(line, rowName, scoreRow => scoreRow.addedShownAsError),
  ]))
}

print('## Every saved run')
print()
tableOf(['row', 'seed', 'all three, mixed', 'whole, mixed', 'all three, half of the dataset', 'whole', 'all three, half of the kinds', 'whole', 'all three on the mixed train split', 'whole', 'all three after the training alone', 'cells changed against the base', 'training, s', 'search, s', 'commit', 'sha256 of the tables'], runs.map(({record}) => {
  const share = (rows: readonly ScoreRow[], name: string, shareOf: (shares: Shares) => number) => percent(shareOf(sharesOf(rowNamed(rows, name)!))).toFixed(2)
  return [
    String(record.row), String(record.seed), share(record.validation, 'all', shares => shares.allThree), share(record.validation, 'all', shares => shares.whole),
    share(record.validation, neutralHalfRowName, shares => shares.allThree), share(record.validation, neutralHalfRowName, shares => shares.whole),
    share(record.validation, kindsHalfRowName, shares => shares.allThree), share(record.validation, kindsHalfRowName, shares => shares.whole),
    share(record.train, 'all', shares => shares.allThree), share(record.train, 'all', shares => shares.whole), share(record.nextTo.validation, 'all', shares => shares.allThree),
    String(record.cellsChangedAgainstBase.total), record.seconds.training.toFixed(0), record.seconds.search.toFixed(0), record.commit.slice(0, 7), record.sha256.slice(0, 16),
  ]
}))

// A table with one line per score row, e.g. per kind, and one column per row of the experiment, for one share.
function breakdown(title: string, note: string, rowNamesOfTable: readonly string[], label: (rowName: string) => string[], labelHeader: readonly string[]) {
  const present = rowNamesOfTable.filter(name => rowNamed(firstRows, name) !== undefined)
  print(`## ${title}`)
  print()
  print(note)
  print()
  for (const [shareName, shareOf] of [['All three', (shares: Shares) => shares.allThree], ['Whole samples', (shares: Shares) => shares.whole]] as const) {
    print(`${shareName}:`)
    print()
    tableOf([...labelHeader, 'samples', 'scored code points', ...lines.map(shortNameOf)], present.map(name => {
      const row = rowNamed(firstRows, name)!
      return [...label(name), String(row.samples), String(row.codePoints), ...lines.map(line => spreadOf(line, name, shareOf, 1))]
    }))
  }
}
const afterColonOf = (name: string) => name.slice(name.indexOf(': ') + 2)
const afterColon = (name: string) => [afterColonOf(name)]
breakdown('The half of the kinds, per number of kinds', 'A sample of this half has one kind of mistake or two.', ['group: one kind', 'group: two kinds'], afterColon, ['kinds in the sample'])
breakdown('The half of the kinds, per family of kinds', 'Every sample with a kind of the family. A sample with kinds of two families is in both lines.', mistakeFamilyRowNames, afterColon, ['family'])
breakdown(
  'The half of the kinds, per kind: the samples with that kind alone',
  'The samples with one kind of mistake, by that kind. Some lines are small, e.g. a kind with 20 samples moves by 5 points of whole samples with one sample.',
  namesOfMistakes.map(aloneKindRowNameOf), name => [`\`${afterColon(name)[0]}\``, familyOfMistakeNamed(afterColon(name)[0]!) ?? ''], ['kind', 'family'],
)
breakdown(
  'The half of the kinds, per kind: every sample with the kind',
  'Every sample with the kind, alone or with a second kind, so a line also shows what the other kinds of its samples do.',
  namesOfMistakes.map(kindRowNameOf), name => [`\`${afterColon(name)[0]}\``, familyOfMistakeNamed(afterColon(name)[0]!) ?? ''], ['kind', 'family'],
)
// Where the trained rows stand against the one rule, per kind alone, as scored code points: a share says nothing of
// how much a kind weighs, e.g. 10 points of a kind with 300 scored code points are 30 code points.
{
  const lineOfRow = (row: number) => lines.find(line => line.row === row)
  const rule = lineOfRow(2)!
  const meanRight = (line: Line, rowName: string) => line.rowsOfSeed.reduce((total, rows) => total + rowNamed(rows, rowName)!.allRight, 0) / line.rowsOfSeed.length
  const trained = [7, 8].flatMap(row => lineOfRow(row) ?? [])
  const body = namesOfMistakes.map(aloneKindRowNameOf).filter(name => rowNamed(firstRows, name) !== undefined).map(name => {
    const row = rowNamed(firstRows, name)!
    const ofTheRule = meanRight(rule, name)
    return {name, row, ofTheRule, differences: trained.map(line => meanRight(line, name) - ofTheRule)}
  }).sort((left, right) => (left.differences[0] ?? 0) - (right.differences[0] ?? 0))
  print('## The half of the kinds, per kind alone: the trained rows against the one rule, in scored code points')
  print()
  print('The samples with one kind of mistake, by that kind. A difference is the mean over the seeds of the scored code points that the trained row has right, minus the ones that row 2 has right: first as code points, then as points of the kind\'s all three. The lines are in the order of row 7\'s difference in code points, from the largest loss to the largest gain.')
  print()
  tableOf(['kind', 'samples', 'scored code points', 'row 2, all three', ...trained.flatMap(line => [`${shortNameOf(line)} minus row 2, code points`, 'in points'])], body.map(({name, row, ofTheRule, differences}) => [
    `\`${afterColonOf(name)}\``, String(row.samples), String(row.codePoints), percent(ofTheRule / row.codePoints).toFixed(1), ...differences.flatMap(difference => [difference.toFixed(0), percent(difference / row.codePoints).toFixed(1)]),
  ]))
}

breakdown('The half of the dataset, per number of edits', 'A sample of this half has one, two or three edits, each applied to what the edit before it left.', ['group: one edit', 'group: two edits', 'group: three edits'], afterColon, ['edits in the sample'])
breakdown('The half of the dataset, per family of edit, samples with one edit', 'The samples with one edit, by the family of that edit.', oneEditFamilyRowNames, afterColon, ['family of the one edit'])
breakdown('The half of the dataset, per family of edit, every sample', 'Every sample with an edit of the family. A sample with edits of two families is in both lines.', editFamilyRowNames, afterColon, ['family of edit'])

// Per display kind of the label: of the scored code points whose label has that kind, the share with every scored
// value right. The records hold no such row, so the tables are run here.
const placesOfSource = (samples: Samples, source: string) => Int32Array.from({length: samples.sampleCount}, (_, place) => place).filter(place => samples.source[place] === samples.sourceNames.indexOf(source))
const halves = [
  {name: 'the half of the dataset', samples: selectSamples(validation, placesOfSource(validation, 'damage'))},
  {name: 'the half of the kinds', samples: selectSamples(validation, placesOfSource(validation, 'kinds'))},
]
{
  const names = [...displayKindNames, 'no scored kind']
  const countsOfParser = (parser: Parser, samples: Samples) => {
    const run = parser(samples)
    const trace = createTrace()
    const scored = new Float64Array(names.length)
    const right = new Float64Array(names.length)
    for (let place = 0; place < samples.sampleCount; place++) {
      const start = samples.start[place]!
      const length = samples.start[place + 1]! - start
      run(place, trace)
      for (let position = samples.firstErrorPosition[place]!; position < length; position++) {
        if ((samples.flags[start + position]! & codePointScored) === 0) continue
        const kind = (samples.flags[start + position]! & codePointKindScored) === 0 ? names.length - 1 : samples.labelKind[start + position]!
        scored[kind]!++
        if (wrongLabelsAt(samples, start + position, trace, position) === 0) right[kind]!++
      }
    }
    return {scored, right}
  }
  print('## Per display kind of the label')
  print()
  print('Of the scored code points whose label has the display kind, the share with every scored value right, i.e. the kind, the depth and the container. "No scored kind" are the code points of which only the depth and the container are scored.')
  print()
  for (const half of halves) {
    const countsOfLine = lines.map(line => line.parsers.map(parser => countsOfParser(parser, half.samples)))
    const present = names.map((_, kind) => kind).filter(kind => countsOfLine[0]![0]!.scored[kind]! > 0)
    print(`In ${half.name}:`)
    print()
    tableOf(['display kind of the label', 'scored code points', ...lines.map(shortNameOf)], present.map(kind => [
      names[kind]!, String(countsOfLine[0]![0]!.scored[kind]), ...lines.map((_, lineAt) => describeSpread(countsOfLine[lineAt]!.map(counts => percent(counts.right[kind]! / counts.scored[kind]!)), 1)),
    ]))
  }
}

print('## How the damage itself is shown')
print()
print('No label is the display kind error, so the shares above do not say how a code point that the damage added is shown. A count with brackets is the mean of the seeds with the lowest and the highest.')
print()
tableOf(['', ...parts.flatMap(({rowName}) => {
  const row = rowNamed(firstRows, rowName)!
  const part = rowName === 'all' ? 'mixed' : rowName === neutralHalfRowName ? 'half of the dataset' : 'half of the kinds'
  return [`${part}: of ${row.addedCodePoints} added code points, shown as an error`, `${part}: of ${row.samples} samples, show an error at or after the first damage`]
}), 'mixed: code points shown as past the end'], lines.map(line => [
  line.name, ...parts.flatMap(({rowName}) => [countSpread(line, rowName, row => row.addedShownAsError), countSpread(line, rowName, row => row.samplesShowingError)]), countSpread(line, 'all', row => row.shownAsPastEnd),
]))

// The classes of the rule, counted here again on the mixed train split.
{
  // The code points that do not show, and the two that would break the table.
  const namedCodePoints: Record<number, string> = {0x09: 'tab', 0x0a: 'line feed', 0x0d: 'carriage return', 0x1b: 'escape character', 0x20: 'space', 0x60: 'backtick', 0x7c: 'vertical bar', 0xa0: 'no-break space', 0xfeff: 'byte order mark'}
  const shown = (codePoint: number) => namedCodePoints[codePoint] ?? `\`${String.fromCodePoint(codePoint)}\``
  const nameOf = (codePoint: number) => `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
  const ofTheRule = codePointsOfTheRule(mixedTrain)
  const picked = ofTheRule.filter(entry => entry.picked && entry.notAdded === '')
  const classesOfTheRecords = runs[0]!.record.classes
  for (const {record, recordFile} of runs) if (JSON.stringify(record.classes) !== JSON.stringify(classesOfTheRecords)) throw new Error(`${recordFile} has other classes than ${runs[0]!.recordFile}`)
  if (JSON.stringify(picked.map(entry => nameOf(entry.codePoint))) !== JSON.stringify(classesOfTheRecords)) throw new Error('the rule of the classes picks other code points on the mixed train split now than the records hold')
  const standard = loadSamples(range.seed, range.from, range.to)
  const pickedOnTheDatasetAlone = new Set(classesChosenFromTrainSamples(trainPart(standard)).map(added => added.name))
  print('## The classes that the rule picked')
  print()
  print(`The rule reads the mixed train split: a code point gets a class of its own when at least ${recipeSettings.leastSamplesOfTheRule} train samples have it at or after their first error and its outcomes there are at a distance of at least ${recipeSettings.leastDistanceOfTheRule} from those of the rest of its class. An outcome is the event at the code point's counterpart in the document, or "added". The rule does not depend on the seed, so every run has the same ${picked.length} classes. On the dataset's train split alone the rule picks ${pickedOnTheDatasetAlone.size}. ${ofTheRule.length} code points are in at least ${recipeSettings.leastSamplesOfTheRule} mixed train samples. The table has the picked ones and the ${Math.min(8, ofTheRule.length - picked.length)} next.`)
  print()
  const notPicked = ofTheRule.filter(entry => !(entry.picked && entry.notAdded === '')).slice(0, 8)
  tableOf(['code point', '', 'class today', 'train samples', 'occurrences', 'distance', 'most frequent outcome', 'picked', 'picked on the dataset alone'], [...picked, ...notPicked].map(entry => [
    nameOf(entry.codePoint), shown(entry.codePoint), classNames[entry.classToday] ?? '', String(entry.samples), String(entry.occurrences), entry.distance.toFixed(2), `${entry.mostFrequentOutcome}, ${percent(entry.shareOfMostFrequentOutcome).toFixed(0)}%`,
    entry.picked && entry.notAdded === '' ? 'yes' : entry.picked ? `no: ${entry.notAdded}` : 'no', pickedOnTheDatasetAlone.has(nameOf(entry.codePoint)) ? 'yes' : 'no',
  ]))

  // The same tables on the validation split of the dataset's standard set, where the runs of learn/runs/ report.
  const standardValidation = validationPart(standard)
  const onStandard = (parser: Parser) => scoreWith(standardValidation, {splits: ['validation'], breakdowns: false}, parser(standardValidation)).rows[0]!
  const first = onStandard(parserOfTables(asIsTables()))
  print('## The same tables on the validation split of the dataset\'s standard set')
  print()
  print(`The dataset's own validation split: ${first.samples} samples with ${first.codePoints} scored code points, all with damage that knows nothing of TOML. Half of them are the half of the dataset above, and the mixed set holds a sample of the kinds in the place of the other half. These are the samples of the table in learn/runs/README.md.`)
  print()
  tableOf(['', 'all three', 'whole', 'added code points shown as an error'], lines.map(line => {
    const rowsOfLine = line.parsers.map(onStandard)
    return [line.name, describeSpread(rowsOfLine.map(row => percent(sharesOf(row).allThree))), describeSpread(rowsOfLine.map(row => percent(sharesOf(row).whole))), describeSpread(rowsOfLine.map(row => row.addedShownAsError), 0)]
  }))
}

// What the search changes: row 8 against row 7 of the same seed, whose tables differ by the search alone.
const pairs = runsOfRow(7).flatMap(row7 => {
  const row8 = runsOfRow(8).find(({record}) => record.seed === row7.record.seed)
  return row8 === undefined ? [] : [{seed: row7.record.seed, row7, row8}]
})
if (pairs.length > 0) {
  print('## What the search changes')
  print()
  print('Row 8 against row 7 of the same seed: the two start from the same training, and row 8 has the search before the count. "Cells that differ" counts the cells and display entries in which the two saved tables differ, and how many of those a code point of a validation sample reads with the tables of row 8.')
  print()
  tableOf(['seed', 'all three, row 7 to row 8', 'whole', 'all three on train', 'whole on train', 'passes', 'changes of a cell', 'the last pass changed nothing', 'runs of a sample, millions', 'seconds', 'cells that differ', 'of which validation reads'], pairs.map(({seed, row7, row8}) => {
    const fromTo = (before: ScoreRow, after: ScoreRow, shareOf: (shares: Shares) => number) => `${percent(shareOf(sharesOf(before))).toFixed(2)} to ${percent(shareOf(sharesOf(after))).toFixed(2)}`
    const differences = differencesOf(tablesOfRun.get(row7.tablesFile)!, tablesOfRun.get(row8.tablesFile)!)
    const counts = countCells(differences)
    const read = cellsReadBy(tablesOfRun.get(row8.tablesFile)!, validation, ['validation'])
    const search = row8.record.search!
    return [
      String(seed), fromTo(row7.record.validation[0]!, row8.record.validation[0]!, shares => shares.allThree), fromTo(row7.record.validation[0]!, row8.record.validation[0]!, shares => shares.whole),
      fromTo(row7.record.train[0]!, row8.record.train[0]!, shares => shares.allThree), fromTo(row7.record.train[0]!, row8.record.train[0]!, shares => shares.whole),
      String(search.passes), String(search.changes), search.lastPassChangedNothing ? 'yes' : 'no', (search.runs / 1e6).toFixed(1), row8.record.seconds.search.toFixed(0),
      `${counts.total} (tokenizer ${counts.tokenizer}, grammar ${counts.grammar}, display ${counts.display})`, String(differences.filter(difference => isRead(read, difference)).length),
    ]
  }))
}

if (process.argv.includes('--write-list')) {
  const tables = runs.map(({record, tablesFile}) => {
    const sha256 = sha256OfFile(tablesFile)
    if (sha256 !== record.sha256) throw new Error(`${tablesFile} has the sha256 ${sha256}, and its record says ${record.sha256}`)
    return {row: record.row, seed: record.seed, file: record.tablesFile, path: tablesFile, sha256, record: join(folder, recordFileNameOf(record.row, record.seed))}
  })
  const list = {
    format: 'recovery-toml saved tables 1',
    what: 'Every saved table of the runs of the frozen recipe on the mixed set, i.e. on train samples of which half have the dataset\'s damage, which knows nothing of TOML, and half have kinds of mistakes written for TOML. Row 7: the training, the count and the last step. Row 8: the same with the search before the count.',
    datasetKey: datasetKey(), kindsKey: kindsKey(), trainedOn, tables,
  }
  writeFileSync(join(folder, listFileName), `${JSON.stringify(list, null, 1)}\n`)
  print(`Wrote ${join(folder, listFileName)} with ${tables.length} tables.`)
}
