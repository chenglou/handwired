// The report of the saved runs of a folder, on the validation split: rows 1 and 2, which are scored here, next to the
// saved rows 4, 5 and 6. For all samples, per number of edits, per family of edit, per kind of edit and per display
// kind of the label. Then how the damage itself is shown, what the search changes, and whole samples of row 4
// against row 2, with samples of each side.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-toml/learn/runs/report.ts [--folder <folder>] [--samples 3] [--longest 160]
// Without --folder, the runs of <RECOVERY_SCRATCH>/neutral/. --samples is how many samples each side shows, and
// --longest the most code points that a shown sample may have.
//
// A number with brackets is the mean of a row's seeds with the lowest and the highest.
import {describeSample} from '../../dump.ts'
import {containerNames, kindLetters} from '../../kinds.ts'
import type {Sample} from '../../samples.ts'
import {type Samples, allowedSampleAt, codePointKindScored, codePointScored, datasetKey, loadSamples, validationPart} from '../data.ts'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {type RecoveryTrace, createTrace} from '../recovery-parser.ts'
import {type RecoveryTables, asIsTables, differencesOf, displayKindNames, loadTablesOfThisDataset} from '../recovery-tables.ts'
import {type ScoreRow, cellsReadBy, countCells, isRead, sharesOf, wrongContainer, wrongDepth, wrongKind, wrongLabelsAt} from '../score.ts'
import {type Parser, type RunRow, describeSpread, familyRowNames, oneEditFamilyRowNames, parserOfTables, restartAtNextLine, rowNamed, runRows, runsFolderOf, savedRunsOf, scoreRowsOf} from './runs.ts'

refuseUnknownOptions('runs/report.ts', ['--folder', '--samples', '--longest'])
const folder = runsFolderOf(optionOf('--folder'))
const samplesPerSide = Number(optionOf('--samples') ?? 3)
const longestShown = Number(optionOf('--longest') ?? 160)
const runs = savedRunsOf(folder)
if (runs.length === 0) throw new Error(`${folder} holds no record of a run`)
const {trainedOn} = runs[0]!.record
for (const {record, recordFile} of runs) {
  if (record.datasetKey !== datasetKey()) throw new Error(`${recordFile} is of the dataset ${record.datasetKey}, and the dataset is ${datasetKey()} now`)
  if (JSON.stringify(record.trainedOn) !== JSON.stringify(trainedOn)) throw new Error(`${recordFile} trained on other samples than ${runs[0]!.recordFile}`)
}
const validation = validationPart(loadSamples(trainedOn.datasetSeed, trainedOn.from, trainedOn.to))
const runsOfRow = (row: RunRow) => runs.filter(({record}) => record.row === row)

// The lines of every table: a row of the experiment, with the score rows of each of its seeds.
type Line = {name: string, seeds: number[], rowsOfSeed: ScoreRow[][]}
const lines: Line[] = [
  {name: 'row 1, the parser as it is', seeds: [], rowsOfSeed: [scoreRowsOf(parserOfTables(asIsTables()), validation)]},
  {name: 'row 2, anew at the next line', seeds: [], rowsOfSeed: [scoreRowsOf(restartAtNextLine, validation)]},
  ...runRows.flatMap((row: RunRow) => runsOfRow(row).length === 0 ? [] : [{name: `row ${row}`, seeds: runsOfRow(row).map(({record}) => record.seed), rowsOfSeed: runsOfRow(row).map(({record}) => record.validation)}]),
]
const percent = (share: number) => 100 * share
type Shares = ReturnType<typeof sharesOf>
// The spread over a line's seeds of one share of the score row `rowName`.
const spreadOf = (line: Line, rowName: string, shareOf: (shares: Shares) => number, digits = 2) =>
  describeSpread(line.rowsOfSeed.flatMap(rows => {
    const row = rowNamed(rows, rowName)
    return row === undefined ? [] : [percent(shareOf(sharesOf(row)))]
  }), digits)
const print = (text = '') => console.log(text)
const tableOf = (header: readonly string[], body: readonly (readonly string[])[]) => {
  print(`| ${header.join(' | ')} |`)
  print(`| ${header.map(() => '---').join(' | ')} |`)
  for (const cells of body) print(`| ${cells.join(' | ')} |`)
  print()
}

const all = lines[0]!.rowsOfSeed[0]![0]!
print(`# The saved runs of ${folder} on the validation split`)
print()
print(`Dataset ${datasetKey()}, the validation split of the samples ${trainedOn.from} to ${trainedOn.to - 1}: ${all.samples} broken samples with ${all.codePoints} scored code points. The runs trained on ${trainedOn.trainSamples} train samples. A number with brackets is the mean of a row's seeds with the lowest and the highest. Row 4: the training, the count, the last step, seeds ${runsOfRow(4).map(({record}) => record.seed).join(', ')}. Row 5: the same with the search before the count, the same seeds. Row 6: the search and the count without the training, seeds ${runsOfRow(6).map(({record}) => record.seed).join(', ')}.`)
print()

print('## All samples')
print()
tableOf(['', 'all three', 'whole', 'display kind', 'depth', 'container'], lines.map(line => [
  line.name, spreadOf(line, 'all', shares => shares.allThree), spreadOf(line, 'all', shares => shares.whole), spreadOf(line, 'all', shares => shares.kind), spreadOf(line, 'all', shares => shares.depth), spreadOf(line, 'all', shares => shares.container),
]))

// A table with one column per score row, e.g. per number of edits, for one share.
function breakdown(title: string, note: string, rowNames: readonly string[]) {
  const present = rowNames.filter(name => rowNamed(lines[0]!.rowsOfSeed[0]!, name) !== undefined)
  const header = ['', ...present.map(name => {
    const row = rowNamed(lines[0]!.rowsOfSeed[0]!, name)!
    return `${name.replace(/^(group|kind): /, '')}: ${row.samples} samples, ${row.codePoints} code points`
  })]
  print(`## ${title}`)
  print()
  print(note)
  print()
  print('All three:')
  print()
  tableOf(header, lines.map(line => [line.name, ...present.map(name => spreadOf(line, name, shares => shares.allThree))]))
  print('Whole samples:')
  print()
  tableOf(header, lines.map(line => [line.name, ...present.map(name => spreadOf(line, name, shares => shares.whole))]))
}
breakdown('Per number of edits', 'A sample has one, two or three edits, each applied to what the edit before it left.', ['group: one edit', 'group: two edits', 'group: three edits'])
breakdown('Per family of edit, samples with one edit', 'The samples with one edit, by the family of that edit. No sample has a cut of the tail alone, which leaves nothing to score.', oneEditFamilyRowNames)
breakdown('Per family of edit, every sample', 'Every sample with an edit of the family. A sample with edits of two families is in both columns, so a column also shows what the other edits of its samples do.', familyRowNames)
breakdown('Per kind of edit, every sample', 'Every sample with an edit of the kind, as the rows of score.ts have them.', validation.kindNames.map(name => `kind: ${name}`))

// Per display kind of the label: of the scored code points whose label has that kind, the share with every scored
// value right. The records hold no such row, so the saved tables are run here.
{
  const names = [...displayKindNames, 'no scored kind']
  const countsOf = (parser: Parser) => {
    const run = parser(validation)
    const trace = createTrace()
    const scored = new Float64Array(names.length)
    const right = new Float64Array(names.length)
    for (let place = 0; place < validation.sampleCount; place++) {
      const start = validation.start[place]!
      const length = validation.start[place + 1]! - start
      run(place, trace)
      for (let position = validation.firstErrorPosition[place]!; position < length; position++) {
        if ((validation.flags[start + position]! & codePointScored) === 0) continue
        const kind = (validation.flags[start + position]! & codePointKindScored) === 0 ? names.length - 1 : validation.labelKind[start + position]!
        scored[kind]!++
        if (wrongLabelsAt(validation, start + position, trace, position) === 0) right[kind]!++
      }
    }
    return {scored, right}
  }
  const countsOfLine = [
    [countsOf(parserOfTables(asIsTables()))], [countsOf(restartAtNextLine)],
    ...runRows.filter(row => runsOfRow(row).length > 0).map(row => runsOfRow(row).map(({tablesFile}) => countsOf(parserOfTables(loadTablesOfThisDataset(tablesFile).tables)))),
  ]
  const present = names.map((_, kind) => kind).filter(kind => countsOfLine[0]![0]!.scored[kind]! > 0)
  print('## Per display kind of the label')
  print()
  print('Of the scored code points whose label has the display kind, the share with every scored value right, i.e. the kind, the depth and the container. "No scored kind" are the code points of which only the depth and the container are scored.')
  print()
  tableOf(['', ...present.map(kind => `${names[kind]}: ${countsOfLine[0]![0]!.scored[kind]} code points`)], lines.map((line, lineAt) => [
    line.name, ...present.map(kind => describeSpread(countsOfLine[lineAt]!.map(counts => percent(counts.right[kind]! / counts.scored[kind]!)))),
  ]))
}

print('## How the damage itself is shown')
print()
print(`No label is the display kind error, so the shares above do not say how a code point that the damage added is shown. Of the ${all.addedCodePoints} added code points of the ${all.samples} samples:`)
print()
const countSpread = (line: Line, countOf: (row: ScoreRow) => number) => describeSpread(line.rowsOfSeed.map(rows => countOf(rows[0]!)), 0)
tableOf(['', 'added code points shown as an error', 'samples that show an error at or after the first damage', 'code points shown as past the end'], lines.map(line => [
  line.name, countSpread(line, row => row.addedShownAsError), countSpread(line, row => row.samplesShowingError), countSpread(line, row => row.shownAsPastEnd),
]))

// What the search changes: row 5 against row 4 of the same seed, whose tables differ by the search alone.
const loaded = new Map<string, RecoveryTables>()
const tablesOf = (file: string) => {
  let tables = loaded.get(file)
  if (tables === undefined) {
    tables = loadTablesOfThisDataset(file).tables
    loaded.set(file, tables)
  }
  return tables
}
const pairs = runsOfRow(4).flatMap(row4 => {
  const row5 = runsOfRow(5).find(({record}) => record.seed === row4.record.seed)
  return row5 === undefined ? [] : [{seed: row4.record.seed, row4, row5}]
})
if (pairs.length > 0) {
  print('## What the search changes')
  print()
  print('Row 5 against row 4 of the same seed: the two start from the same training, and row 5 has the search before the count. "Cells that differ" counts the cells and display entries in which the two saved tables differ, and how many of those a code point of a validation sample reads with the tables of row 5.')
  print()
  const sharesOfRun = (rows: readonly ScoreRow[]) => sharesOf(rows[0]!)
  tableOf(['seed', 'all three, row 4 to row 5', 'whole', 'display kind', 'depth', 'container', 'all three on train', 'whole on train', 'passes', 'changes of a cell', 'the last pass changed nothing', 'runs of a sample, millions', 'seconds', 'cells that differ', 'of which validation reads'], pairs.map(({seed, row4, row5}) => {
    const before = sharesOfRun(row4.record.validation)
    const after = sharesOfRun(row5.record.validation)
    const fromTo = (shareOf: (shares: Shares) => number) => `${percent(shareOf(before)).toFixed(2)} to ${percent(shareOf(after)).toFixed(2)}`
    const differences = differencesOf(tablesOf(row4.tablesFile), tablesOf(row5.tablesFile))
    const counts = countCells(differences)
    const read = cellsReadBy(tablesOf(row5.tablesFile), validation, ['validation'])
    const search = row5.record.search!
    return [
      String(seed), fromTo(shares => shares.allThree), fromTo(shares => shares.whole), fromTo(shares => shares.kind), fromTo(shares => shares.depth), fromTo(shares => shares.container),
      `${percent(sharesOf(row4.record.train).allThree).toFixed(2)} to ${percent(sharesOf(row5.record.train).allThree).toFixed(2)}`, `${percent(sharesOf(row4.record.train).whole).toFixed(2)} to ${percent(sharesOf(row5.record.train).whole).toFixed(2)}`,
      String(search.passes), String(search.changes), search.lastPassChangedNothing ? 'yes' : 'no', (search.runs / 1e6).toFixed(1), row5.record.seconds.search.toFixed(0),
      `${counts.total} (tokenizer ${counts.tokenizer}, grammar ${counts.grammar}, display ${counts.display})`, String(differences.filter(difference => isRead(read, difference)).length),
    ]
  }))
  // What the search adds per column of the breakdowns: row 5 minus row 4, per seed.
  const added = (rowName: string, shareOf: (shares: Shares) => number) => describeSpread(pairs.flatMap(({row4, row5}) => {
    const before = rowNamed(row4.record.validation, rowName)
    const after = rowNamed(row5.record.validation, rowName)
    return before === undefined || after === undefined ? [] : [percent(shareOf(sharesOf(after))) - percent(shareOf(sharesOf(before)))]
  }))
  const columns = ['all', 'group: one edit', 'group: two edits', 'group: three edits', ...oneEditFamilyRowNames, ...familyRowNames].filter(name => rowNamed(pairs[0]!.row4.record.validation, name) !== undefined)
  print('Row 5 minus row 4 in points, per seed:')
  print()
  tableOf(['', ...columns.map(name => name.replace(/^group: /, ''))], [['all three', ...columns.map(name => added(name, shares => shares.allThree))], ['whole', ...columns.map(name => added(name, shares => shares.whole))]])
  print('The steps around the search, on all samples. The training alone is scored before the count and the last step:')
  print()
  const trainingAlone: Line = {name: 'the training alone', seeds: pairs.map(({seed}) => seed), rowsOfSeed: pairs.map(({row4}) => [row4.record.nextTo.validation])}
  const cellsOf = (row: RunRow) => describeSpread(runsOfRow(row).map(({record}) => record.cellsChangedAgainstBase.total), 0)
  tableOf(['', 'all three', 'whole', 'all three on train', 'whole on train', 'cells and entries changed against the base'], [
    [trainingAlone.name, spreadOf(trainingAlone, 'all', shares => shares.allThree), spreadOf(trainingAlone, 'all', shares => shares.whole), '', '', ''],
    ...runRows.filter(row => runsOfRow(row).length > 0).map(row => {
      const line = lines.find(candidate => candidate.name === `row ${row}`)!
      const train = (shareOf: (shares: Shares) => number) => describeSpread(runsOfRow(row).map(({record}) => percent(shareOf(sharesOf(record.train)))))
      return [line.name, spreadOf(line, 'all', shares => shares.allThree), spreadOf(line, 'all', shares => shares.whole), train(shares => shares.allThree), train(shares => shares.whole), cellsOf(row)]
    }),
  ])
}

// Whole samples of row 4 against row 2. Per sample: 1 when every scored code point is right, 0 when one is wrong.
function wholeSamplesOf(parser: Parser, samples: Samples): Uint8Array {
  const run = parser(samples)
  const trace = createTrace()
  const whole = new Uint8Array(samples.sampleCount)
  for (let place = 0; place < samples.sampleCount; place++) {
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    run(place, trace)
    let wrong = 0
    for (let position = samples.firstErrorPosition[place]!; position < length && wrong === 0; position++) wrong = wrongLabelsAt(samples, start + position, trace, position)
    whole[place] = wrong === 0 ? 1 : 0
  }
  return whole
}

const depthLetter = (depth: number) => depth < 0 ? '-' : depth > 16 ? '+' : '0123456789abcdefg'[depth]!
const containerLetter = (container: number) => containerNames[container] === 'none' ? '-' : containerNames[container]![0]!
// What a parser shows where it has a scored label wrong, as three lines under the lines of describeSample: the display
// kind, the depth and the container that it shows at a code point where that value is wrong, and a blank elsewhere.
function describeWrong(name: string, parser: Parser, samples: Samples, place: number): string {
  const trace: RecoveryTrace = createTrace()
  parser(samples)(place, trace)
  const start = samples.start[place]!
  const length = samples.start[place + 1]! - start
  const shown = {kind: '', depth: '', container: ''}
  let wrongCodePoints = 0
  for (let position = 0; position < length; position++) {
    const wrong = position < samples.firstErrorPosition[place]! ? 0 : wrongLabelsAt(samples, start + position, trace, position)
    if (wrong !== 0) wrongCodePoints++
    shown.kind += (wrong & wrongKind) !== 0 ? kindLetters[trace.displayKind[position]!] : ' '
    shown.depth += (wrong & wrongDepth) !== 0 ? depthLetter(trace.depthAfter[position]!) : ' '
    shown.container += (wrong & wrongContainer) !== 0 ? containerLetter(trace.containerAfter[position]!) : ' '
  }
  if (wrongCodePoints === 0) return `      ${name}: every scored code point right`
  return [`      ${name}: ${wrongCodePoints} of ${samples.scored[place]} scored code points wrong. What it shows where a value is wrong:`, `kind  ${shown.kind}`, `depth ${shown.depth}`, `cont  ${shown.container}`].join('\n')
}

const row4 = runsOfRow(4)
if (row4.length > 0) {
  const wholeOfRule = wholeSamplesOf(restartAtNextLine, validation)
  const wholeOfSeed = row4.map(({tablesFile}) => wholeSamplesOf(parserOfTables(tablesOf(tablesFile)), validation))
  const places = Array.from({length: validation.sampleCount}, (_, place) => place)
  const count = (wanted: (place: number) => boolean) => places.filter(wanted).length
  const inEverySeed = (place: number) => wholeOfSeed.every(whole => whole[place] === 1)
  const inNoSeed = (place: number) => wholeOfSeed.every(whole => whole[place] === 0)
  print('## Whole samples, row 4 against row 2')
  print()
  print(`Of the ${validation.sampleCount} validation samples, the rule "anew at the next line after an error" has ${count(place => wholeOfRule[place] === 1)} right as a whole.`)
  print()
  tableOf(['row 4', 'right as a whole', 'right where the rule is wrong', 'wrong where the rule is right', 'both right', 'both wrong'], [
    ...row4.map(({record}, seedAt) => {
      const whole = wholeOfSeed[seedAt]!
      return [`seed ${record.seed}`, String(count(place => whole[place] === 1)), String(count(place => whole[place] === 1 && wholeOfRule[place] === 0)), String(count(place => whole[place] === 0 && wholeOfRule[place] === 1)), String(count(place => whole[place] === 1 && wholeOfRule[place] === 1)), String(count(place => whole[place] === 0 && wholeOfRule[place] === 0))]
    }),
    [`every one of the ${row4.length} seeds`, String(count(inEverySeed)), String(count(place => inEverySeed(place) && wholeOfRule[place] === 0)), String(count(place => inNoSeed(place) && wholeOfRule[place] === 1)), String(count(place => inEverySeed(place) && wholeOfRule[place] === 1)), String(count(place => inNoSeed(place) && wholeOfRule[place] === 0))],
  ])
  print('In the last line, "right" is right in every seed and "wrong" is wrong in every seed.')
  print()
  const firstSeed = row4[0]!
  const sides = [
    {title: `Row 4 right in every seed, the rule wrong`, wanted: (place: number) => inEverySeed(place) && wholeOfRule[place] === 0},
    {title: `The rule right, row 4 wrong in every seed`, wanted: (place: number) => inNoSeed(place) && wholeOfRule[place] === 1},
  ]
  print('The lines of a sample are the ones of lab/recovery-toml/dump.ts: orig is the document, brok the broken text, label, depth and cont the label of every code point of the broken text (blank where the damage added the code point, ? where a value is not scored), and first has ^ under the first error and d under the first damage. Letters of display kinds: w whitespace, p punctuation, s string, e escape, n number, l literal, E error, k key, h header name, c comment. In the texts, ⏎ is a line feed. Under them, what each parser shows where it has a value wrong.')
  print()
  for (const {title, wanted} of sides) {
    const candidates = places.filter(wanted)
    const short = candidates.filter(place => validation.start[place + 1]! - validation.start[place]! <= longestShown)
    print(`### ${title}: ${candidates.length} samples`)
    print()
    print(`The first ${Math.min(samplesPerSide, short.length)} in the dataset's order of the ${short.length} with at most ${longestShown} code points.`)
    print()
    print('```')
    for (const place of short.slice(0, samplesPerSide)) {
      const sample = allowedSampleAt(validation.seed, validation.index[place]!)
      if (sample === undefined) throw new Error(`the validation sample ${validation.index[place]} is in the test split`)
      print(describeSample(sample as Sample))
      print(describeWrong('row 2, anew at the next line', restartAtNextLine, validation, place))
      print(describeWrong(`row 4, seed ${firstSeed.record.seed}`, parserOfTables(tablesOf(firstSeed.tablesFile)), validation, place))
      print()
    }
    print('```')
    print()
  }
}
