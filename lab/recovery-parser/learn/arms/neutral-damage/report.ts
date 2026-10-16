// Every table of README.md and every comparison behind its sentences, from the records and the tables that run.ts
// and the arms before it saved, and from the train sets for what the trainer takes from them. It trains nothing.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after run.ts:
//   bun lab/recovery-parser/learn/arms/neutral-damage/report.ts [--examples 3] [--widest 80]
// It prints, in this order:
// - the main table: the rows of the arm and the rows that they are read against, with what the main number hides,
// - each step of a row: the training alone, the search, the count, today's kinds in the state `error`,
// - what the trainer takes from each train set: samples, scored code points and steps,
// - comparisons of two rows with the same seeds: both ranges, whether they overlap, and the difference seed by seed,
//   also per group of the dataset for the primary row against the row of the standard train set,
// - all three and whole samples per group of the dataset and per source of the samples,
// - the rows on the samples with a string or a key without double quotes, on the ones of them with and without
//   another kind, and on every other sample, with the share of the primary row's loss in each part,
// - all three per kind of damage, the primary row next to the row of the standard train set, also on the samples
//   that have the kind alone, there with the range of the seeds,
// - with --examples, so many validation samples per kind for some kinds, each at most --widest code points long,
//   see examplesOf.
import {join} from 'node:path'
import {codePointKept, codePointKindScored, codePointScored, groupNames, optionOf, refuseUnknownOptions} from '../../data.ts'
import {createTrace} from '../../recovery-parser.ts'
import {type RecoveryTables, loadTablesOfThisDataset} from '../../recovery-tables.ts'
import {runOnSample, sharesOf, wrongContainer, wrongDepth, wrongKind, wrongLabelsAt} from '../../score.ts'
import {placesForTwin} from '../../soft/twin-data.ts'
import {candidates, describeRecipe, reportedSeeds, savedTablesFileOf} from '../combined/combined.ts'
import {countsOnTooDeepTexts, tooDeepForms} from '../combined/deep-valid.ts'
import {type ArmRecord, type SettingResult, armFolderOf, baselineTables, baselines, fileNameOf, percentSpread, rowNamed, savedResultOf, spreadOf, validationOfTheStandardSet} from '../harness.ts'
import {
  type Row, armName, fileSavedByCombined, primaryRow, savedTablesFileOfRow, searchedRow, seeds, settingNameOf, standardRow, standardWithoutClassesRow, stepsOf, withoutLineEditsRow,
} from './recipe.ts'

refuseUnknownOptions('arms/neutral-damage/report.ts', ['--examples', '--widest'])
const examplesPerKind = Number(optionOf('--examples') ?? 0)
const widestExample = Number(optionOf('--widest') ?? 80)
const print = (line = '') => console.log(line)

// One row of a table: a setting's records and the tables of each, one per seed, or one for a setting without a seed.
type ReportRow = {label: string, result: SettingResult, tables: RecoveryTables[]}

const withinReach = 'group: within reach of the tables'
const sources = ['typing', 'damage']
const validation = validationOfTheStandardSet()

// The rows that the arm is read against, from the records and the tables that earlier arms saved.
const baselineRows = baselines()
const rowOfBaseline = (nameHolds: string, label: string): ReportRow => {
  const place = baselineRows.findIndex(result => result.name.includes(nameHolds))
  if (place === -1) throw new Error(`the baselines have no row whose name holds ${JSON.stringify(nameHolds)}`)
  return {label, result: {...baselineRows[place]!, name: label}, tables: [baselineTables()[place]!.tables]}
}
const asItIs = rowOfBaseline('the parser as it is', 'the parser as it is')
const handRuleLines = rowOfBaseline('hand rule lines', 'the dataset\'s hand rule lines')
const handWritten = rowOfBaseline('hand-written', 'hand-written, 35 rules')
function rowOfSavedSetting(savedArm: string, settingName: string, label: string, fileOf: (seed: number) => string): ReportRow {
  const result = savedResultOf(savedArm, settingName)
  if (result.seeds.join(' ') !== seeds.join(' ')) throw new Error(`${savedArm}, ${settingName}: saved with the seeds ${result.seeds.join(', ')}, and the arm reads the seeds ${seeds.join(', ')}`)
  return {label, result: {...result, name: label}, tables: seeds.map(seed => loadTablesOfThisDataset(fileOf(seed)).tables)}
}
const plainPassName = 'one pass of the trainer from today\'s tables, defaults'
const plainPass = rowOfSavedSetting('plain-pass', plainPassName, 'the plain pass', seed => join(armFolderOf('plain-pass'), fileNameOf(plainPassName), `seed-${seed}.tables.json`))

// A row of the arm, or of ../combined/ when that arm saved the step, e.g. the training alone on the standard train set.
function rowOf(row: Row, label: string): ReportRow {
  const savedByCombined = seeds.every(seed => fileSavedByCombined(row, seed) !== undefined)
  return savedByCombined ? rowOfSavedSetting('combined', describeRecipe(row.recipe), label, seed => savedTablesFileOf('combined', row.recipe, seed))
    : rowOfSavedSetting(armName, settingNameOf(row), label, seed => savedTablesFileOfRow(row, seed))
}
const candidateOfCombined = rowOf({trainSet: standardRow.trainSet, recipe: candidates[0]!.recipe}, 'the standard train set, with the search: the candidate "generic"')
const standard = rowOf(standardRow, 'the standard train set, without the search')
const standardWithoutClasses = rowOf(standardWithoutClassesRow, 'the standard train set, without the search and without the classes')
const primary = rowOf(primaryRow, '(a) neutral damage, without the search')
const searched = rowOf(searchedRow, '(b) neutral damage, with the search')
const withoutLineEdits = rowOf(withoutLineEditsRow, 'neutral damage without line edits, without the search')

const valuesOf = (row: ReportRow, value: (record: ArmRecord) => number) => row.result.records.map(value)
const shareOf = (rowName: string, share: 'allThree' | 'whole') => (record: ArmRecord) => sharesOf(rowNamed(record, rowName))[share]
const percents = (row: ReportRow, rowName: string, share: 'allThree' | 'whole', digits = 2) => percentSpread(spreadOf(valuesOf(row, shareOf(rowName, share))), digits)
// A difference in points with its sign, e.g. "+0.21".
const signed = (difference: number, digits = 2) => `${Number(difference.toFixed(digits)) >= 0 ? '+' : ''}${difference.toFixed(digits).replace(/^-(0\.0+)$/, '$1')}`
// A count over the runs: one number, or the mean with the lowest and the highest.
function counts(values: readonly number[]) {
  const spread = spreadOf(values)
  return spread.lowest === spread.highest ? String(spread.lowest) : `${Math.round(spread.mean)} (${spread.lowest} to ${spread.highest})`
}

// What some tables do on valid JSON deeper than 16 levels, over the four forms of ../combined/deep-valid.ts.
const knownTooDeepCounts = new Map<RecoveryTables, {wrongDepths: number, kindsOtherThanTodays: number}>()
function onTooDeepTexts(tables: RecoveryTables) {
  let total = knownTooDeepCounts.get(tables)
  if (total === undefined) {
    total = {wrongDepths: 0, kindsOtherThanTodays: 0}
    for (const form of tooDeepForms) {
      const ofForm = countsOnTooDeepTexts(tables, form.texts)
      total.wrongDepths += ofForm.wrongDepths
      total.kindsOtherThanTodays += ofForm.kindsOtherThanTodays
    }
    knownTooDeepCounts.set(tables, total)
  }
  return total
}

function printMainTable(rows: readonly ReportRow[]) {
  print('| row | runs | all three | all three, within reach | whole samples | shown as past the end | too deep valid JSON: wrong depths | too deep valid JSON: display kinds other than today\'s | added code points shown as an error | cells changed against the base |')
  print('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const row of rows) {
    print(`| ${row.label} | ${row.result.records.length} | ${percents(row, 'all', 'allThree')} | ${percents(row, withinReach, 'allThree')} | ${percents(row, 'all', 'whole')} | ${counts(valuesOf(row, record => record.shownAsPastEnd))} | ${counts(row.tables.map(tables => onTooDeepTexts(tables).wrongDepths))} | ${counts(row.tables.map(tables => onTooDeepTexts(tables).kindsOtherThanTodays))} | ${counts(valuesOf(row, record => rowNamed(record, 'all').addedShownAsError))} | ${counts(valuesOf(row, record => record.cellsChangedAgainstBase.total))} |`)
  }
}

// What the trainer takes from the train set of each row: the broken samples with a scored code point, as trainOn of
// recipe.ts packs them, in steps of 32 samples, the trainer's default, for each of the recipe's passes. E.g. 40,457
// samples are 1,265 steps per pass, the last one with 9 samples.
const samplesPerStep = 32
function printTrainSets(rows: readonly Row[]) {
  print('| train set | broken samples | with a scored code point, which the trainer takes | their scored code points | steps per pass | passes | steps |')
  print('| --- | --- | --- | --- | --- | --- | --- |')
  for (const {trainSet, recipe} of rows) {
    const samples = trainSet.samples()
    const taken = placesForTwin(samples, 'train')
    const stepsPerPass = Math.ceil(taken.length / samplesPerStep)
    print(`| ${trainSet.name} | ${samples.firstDamage.filter(position => position !== -1).length} | ${taken.length} | ${taken.reduce((total, place) => total + samples.scored[place]!, 0)} | ${stepsPerPass} | ${recipe.passes} | ${stepsPerPass * recipe.passes} |`)
  }
}

function printGroupsAndSources(rows: readonly ReportRow[]) {
  const groups = [...groupNames].reverse()
  const first = asItIs.result.records[0]!
  for (const share of ['allThree', 'whole'] as const) {
    print(`${share === 'allThree' ? 'All three' : 'Whole samples'} per group of the dataset, with the group's validation samples that have something to recover:`)
    print()
    print(`| row | ${groups.map(group => `${group}, ${rowNamed(first, `group: ${group}`).samples - rowNamed(first, `group: ${group}`).nothingToRecover}`).join(' | ')} |`)
    print(`| --- | ${groups.map(() => '---').join(' | ')} |`)
    for (const row of rows) print(`| ${row.label} | ${groups.map(group => percents(row, `group: ${group}`, share, 1)).join(' | ')} |`)
    print()
  }
  print('All three and whole samples per source of the samples, with the source\'s validation samples that have something to recover:')
  print()
  print(`| row | ${sources.flatMap(source => ['all three', 'whole samples'].map(share => `${share}, ${source}, ${rowNamed(first, `source: ${source}`).samples - rowNamed(first, `source: ${source}`).nothingToRecover}`)).join(' | ')} |`)
  print(`| --- | ${sources.map(() => '--- | ---').join(' | ')} |`)
  for (const row of rows) print(`| ${row.label} | ${sources.flatMap(source => [percents(row, `source: ${source}`, 'allThree'), percents(row, `source: ${source}`, 'whole')]).join(' | ')} |`)
  print()
}

// Two rows next to each other on one share of one row of the score: both ranges, whether they overlap, and for two
// rows with the same seeds the difference seed by seed.
function compare(first: ReportRow, second: ReportRow, rowName: string, share: 'allThree' | 'whole'): string {
  const [firstValues, secondValues] = [valuesOf(first, shareOf(rowName, share)), valuesOf(second, shareOf(rowName, share))]
  const [firstSpread, secondSpread] = [spreadOf(firstValues), spreadOf(secondValues)]
  const overlap = firstSpread.lowest <= secondSpread.highest && secondSpread.lowest <= firstSpread.highest
  const sentences = [`${share === 'allThree' ? 'All three' : 'Whole samples'}, ${rowName === 'all' ? 'all validation samples' : rowName}: ${JSON.stringify(first.label)} has ${percentSpread(firstSpread)}, ${JSON.stringify(second.label)} has ${percentSpread(secondSpread)}. The means differ by ${signed(100 * (firstSpread.mean - secondSpread.mean))} points, and the two ranges ${overlap ? 'overlap' : 'do not overlap'}.`]
  if (firstValues.length > 1 && firstValues.length === secondValues.length) {
    const differences = firstValues.map((value, index) => 100 * (value - secondValues[index]!))
    sentences.push(`Seed by seed, ${seeds.join(', ')}: ${differences.map(difference => signed(difference)).join(', ')}, so the first is above in ${differences.filter(difference => difference > 0).length} of ${differences.length}.`)
  }
  return sentences.join(' ')
}
function printComparisons(first: ReportRow, second: ReportRow, rowNames: readonly string[] = ['all', withinReach, 'source: damage', 'source: typing']) {
  for (const share of ['allThree', 'whole'] as const) for (const rowName of rowNames) print(`- ${compare(first, second, rowName, share)}`)
  print()
}

// How many scored code points of every validation sample some tables have right, counted once per tables.
const knownRight = new Map<RecoveryTables, Int32Array>()
const sampleTrace = createTrace()
function rightPerSample(tables: RecoveryTables): Int32Array {
  let right = knownRight.get(tables)
  if (right === undefined) {
    right = new Int32Array(validation.sampleCount)
    for (let place = 0; place < validation.sampleCount; place++) {
      if (validation.firstDamage[place] === -1) continue
      const start = validation.start[place]!
      const length = validation.start[place + 1]! - start
      runOnSample(sampleTrace, validation, place, tables)
      for (let position = validation.firstErrorPosition[place]!; position < length; position++) {
        if ((validation.flags[start + position]! & codePointScored) !== 0 && wrongLabelsAt(validation, start + position, sampleTrace, position) === 0) right[place]!++
      }
    }
    knownRight.set(tables, right)
  }
  return right
}

// A row's score over the validation samples that `wanted` picks, e.g. the samples of one kind of damage: how many
// of them have something to recover, their scored code points, and per run of the row the code points with all
// three right and the whole samples.
function scoreOver(row: ReportRow, wanted: (place: number) => boolean) {
  const picked: number[] = []
  for (let place = 0; place < validation.sampleCount; place++) if (validation.firstDamage[place] !== -1 && validation.scored[place]! > 0 && wanted(place)) picked.push(place)
  const codePoints = picked.reduce((total, place) => total + validation.scored[place]!, 0)
  const right = row.tables.map(tables => picked.reduce((total, place) => total + rightPerSample(tables)[place]!, 0))
  const whole = row.tables.map(tables => picked.filter(place => rightPerSample(tables)[place] === validation.scored[place]).length)
  return {samples: picked.length, codePoints, right, whole}
}
const kindsAt = (place: number) => validation.kindList.subarray(validation.kindStart[place], validation.kindStart[place + 1])
const meanOf = (values: readonly number[]) => spreadOf(values).mean
const share = (count: number, of: number, digits = 1) => of === 0 ? '-' : (100 * count / of).toFixed(digits)
// The counts of the runs of a row as shares of `of`: the mean with the lowest and the highest, e.g. "98.2 (95.9 to 99.3)".
const shareSpread = (countsOfRuns: readonly number[], of: number, digits = 1) => of === 0 ? '-' : percentSpread(spreadOf(countsOfRuns.map(count => count / of)), digits)
// Two rows on the same samples, by the counts of their runs: whether the two ranges are apart, e.g. the highest of
// the first is below the lowest of the second, and in how many seeds the first has the higher count.
const rangesAreApart = (first: readonly number[], second: readonly number[]) => Math.max(...first) < Math.min(...second) || Math.min(...first) > Math.max(...second)
const seedsWithFirstAbove = (first: readonly number[], second: readonly number[]) => first.length !== second.length ? '-' : `${first.filter((count, index) => count > second[index]!).length} of ${first.length}`

// All three per kind of damage for two rows, as the mean of the seeds: the kinds from the one in which `first` has
// the fewest scored code points right against `second` to the one in which it has the most. A sample with two kinds
// is in the row of each, so a kind's row also holds what its samples lose by their other kinds, e.g. a trailing
// comma in a text with single quotes. The last columns are the samples that have the kind alone: there each row
// has the range of its seeds, since a mean alone does not say whether e.g. 98.2 against 100.0 is a loss in every
// seed.
function printKinds(first: ReportRow, second: ReportRow, third: ReportRow) {
  const kinds = validation.kindNames.flatMap((kind, kindIndex) => {
    const everySample = [first, second, third].map(row => scoreOver(row, place => kindsAt(place).includes(kindIndex)))
    const alone = [first, second].map(row => scoreOver(row, place => kindsAt(place).length === 1 && kindsAt(place)[0] === kindIndex))
    const [ofFirst, ofSecond, ofThird] = everySample as [ReturnType<typeof scoreOver>, ReturnType<typeof scoreOver>, ReturnType<typeof scoreOver>]
    if (ofFirst.samples === 0) return []
    return [{kind, ofFirst, ofSecond, ofThird, alone: alone as [ReturnType<typeof scoreOver>, ReturnType<typeof scoreOver>], lost: meanOf(ofSecond.right) - meanOf(ofFirst.right), apart: rangesAreApart(ofFirst.right, ofSecond.right)}]
  }).sort((left, right) => right.lost - left.lost)
  print(`| kind of damage | samples with something to recover | scored code points | all three, ${first.label} | all three, ${second.label} | difference in points | the ranges of the seeds | scored code points lost, mean of the seeds | all three, ${third.label} | samples with this kind alone | their scored code points | all three on them, the first | all three on them, the second | seeds with the first above on them | the ranges of the seeds on them | scored code points lost on them | whole samples of them, the first | whole samples of them, the second |`)
  print('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const {kind, ofFirst, ofSecond, ofThird, alone, lost, apart} of kinds) {
    const [aloneFirst, aloneSecond] = alone
    print(`| ${kind} | ${ofFirst.samples} | ${ofFirst.codePoints} | ${share(meanOf(ofFirst.right), ofFirst.codePoints)} | ${share(meanOf(ofSecond.right), ofFirst.codePoints)} | ${signed(100 * (meanOf(ofFirst.right) - meanOf(ofSecond.right)) / ofFirst.codePoints, 1)} | ${apart ? 'apart' : 'overlap'} | ${lost.toFixed(0)} | ${share(meanOf(ofThird.right), ofFirst.codePoints)} | ${aloneFirst.samples} | ${aloneFirst.codePoints} | ${shareSpread(aloneFirst.right, aloneFirst.codePoints)} | ${shareSpread(aloneSecond.right, aloneFirst.codePoints)} | ${aloneFirst.samples === 0 ? '-' : seedsWithFirstAbove(aloneFirst.right, aloneSecond.right)} | ${aloneFirst.samples === 0 ? '-' : rangesAreApart(aloneFirst.right, aloneSecond.right) ? 'apart' : 'overlap'} | ${(meanOf(aloneSecond.right) - meanOf(aloneFirst.right)).toFixed(0)} | ${share(meanOf(aloneFirst.whole), aloneFirst.samples)} | ${share(meanOf(aloneSecond.whole), aloneFirst.samples)} |`)
  }
  print()
}

// The kinds of damage that write a string or a key without double quotes. The three were put together after the
// table per kind was read: the group is in no commit from before the runs.
const kindsWithoutDoubleQuotes = ['singleQuotedString', 'unquotedKey', 'curlyQuotes']
const holdsOneOf = (place: number, kindNames: readonly string[]) => kindNames.some(kind => kindsAt(place).includes(validation.kindNames.indexOf(kind)))
const holdsOnly = (place: number, kindNames: readonly string[]) => kindsAt(place).every(kind => kindNames.includes(validation.kindNames[kind]!))
// The rows on parts of the validation split: the samples that hold a kind of `kindNames`, of those the ones whose
// kinds are all of `kindNames` and the ones that hold another kind too, and every other sample. Then how much of
// what `lower` loses against `higher` on the whole split is in each part: a sample with single quotes and a
// trailing comma loses by both kinds, so the part with another kind says where a loss is and not what it is from.
function printParts(rows: readonly ReportRow[], kindNames: readonly string[], lower: ReportRow, higher: ReportRow) {
  const parts = [
    {name: `the samples with one of ${kindNames.join(', ')}`, wanted: (place: number) => holdsOneOf(place, kindNames)},
    {name: 'of those, the samples with no other kind', wanted: (place: number) => holdsOneOf(place, kindNames) && holdsOnly(place, kindNames)},
    {name: 'of those, the samples with another kind too', wanted: (place: number) => holdsOneOf(place, kindNames) && !holdsOnly(place, kindNames)},
    {name: 'every other sample', wanted: (place: number) => !holdsOneOf(place, kindNames)},
  ]
  const spread = (values: readonly number[], of: number) => percentSpread(spreadOf(values.map(value => value / of)))
  for (const {name, wanted} of parts) {
    const scores = rows.map(row => scoreOver(row, wanted))
    print(`${name}: ${scores[0]!.samples} samples with something to recover, ${scores[0]!.codePoints} scored code points.`)
    print()
    print('| row | all three | whole samples | scored code points right, mean of the runs |')
    print('| --- | --- | --- | --- |')
    rows.forEach((row, index) => print(`| ${row.label} | ${spread(scores[index]!.right, scores[index]!.codePoints)} | ${spread(scores[index]!.whole, scores[index]!.samples)} | ${meanOf(scores[index]!.right).toFixed(0)} |`))
    print()
  }
  const lostIn = (wanted: (place: number) => boolean) => meanOf(scoreOver(higher, wanted).right) - meanOf(scoreOver(lower, wanted).right)
  const lostInAll = lostIn(() => true)
  print(`What ${JSON.stringify(lower.label)} loses against ${JSON.stringify(higher.label)}, in scored code points right, as the mean of the seeds: ${lostInAll.toFixed(0)} on every validation sample.`)
  print()
  for (const {name, wanted} of parts) print(`- ${name}: ${lostIn(wanted).toFixed(0)}, ${share(lostIn(wanted), lostInAll)}% of the loss`)
  print()
  const samplesPerOtherKind = new Map<string, number>()
  for (let place = 0; place < validation.sampleCount; place++) {
    if (validation.firstDamage[place] === -1 || validation.scored[place] === 0 || !holdsOneOf(place, kindNames) || holdsOnly(place, kindNames)) continue
    for (const kind of kindsAt(place)) {
      const otherKind = validation.kindNames[kind]!
      if (!kindNames.includes(otherKind)) samplesPerOtherKind.set(otherKind, (samplesPerOtherKind.get(otherKind) ?? 0) + 1)
    }
  }
  print(`The other kinds in the samples with another kind too, with the samples that hold each: ${[...samplesPerOtherKind].sort((left, right) => right[1] - left[1]).map(([otherKind, samples]) => `${otherKind} ${samples}`).join(', ')}.`)
  print()
}

// Validation samples to read, for one kind of damage: the first ones in the set's order that have the kind alone,
// are at most `widestExample` code points long, and in which the tables of the first seed of `worse` have more
// wrong code points than the ones of `better`. Per sample: the text on one line, the label's display kinds, what each of the two
// tables shows, and under each a mark at every wrong code point: k, d or c where the display kind, the depth or
// the container is wrong, and * where more than one is.
const kindLetters = 'wpsenlE.k'
const standIns: Record<number, string> = {0x0a: '⏎', 0x09: '→', 0x0d: '↵', 0xa0: '⍽', 0xfeff: '◊'}
const visible = (codePoint: number) => standIns[codePoint] ?? (codePoint < 0x20 ? '␦' : String.fromCodePoint(codePoint))
function examplesOf(kind: string, worse: {row: ReportRow, name: string}, better: {row: ReportRow, name: string}, count: number): string[] {
  const kindIndex = validation.kindNames.indexOf(kind)
  const traces = [createTrace(), createTrace()]
  const examples: string[] = []
  for (let place = 0; place < validation.sampleCount && examples.length < count; place++) {
    const start = validation.start[place]!
    const length = validation.start[place + 1]! - start
    if (length > widestExample || kindsAt(place).length !== 1 || kindsAt(place)[0] !== kindIndex) continue
    const firstError = validation.firstErrorPosition[place]!
    const rows = [worse, better].map(({row}, index) => {
      runOnSample(traces[index]!, validation, place, row.tables[0]!)
      let shown = ''
      let marks = ''
      let wrong = 0
      for (let position = 0; position < length; position++) {
        const wrongLabels = position >= firstError ? wrongLabelsAt(validation, start + position, traces[index]!, position) : 0
        if (wrongLabels !== 0) wrong++
        shown += kindLetters[traces[index]!.displayKind[position]!]
        marks += wrongLabels === 0 ? (position === firstError ? '!' : ' ') : wrongLabels === wrongKind ? 'k' : wrongLabels === wrongDepth ? 'd' : wrongLabels === wrongContainer ? 'c' : '*'
      }
      return {shown, marks, wrong}
    })
    if (rows[1]!.wrong >= rows[0]!.wrong) continue
    let text = ''
    let labels = ''
    for (let position = 0; position < length; position++) {
      const flags = validation.flags[start + position]!
      text += visible(validation.codePoints[start + position]!)
      labels += (flags & codePointKept) === 0 ? ' ' : (flags & codePointKindScored) === 0 ? '?' : kindLetters[validation.labelKind[start + position]!]
    }
    const width = Math.max(worse.name.length, better.name.length, 'label'.length)
    const line = (name: string, row: string) => `${name.padEnd(width)}  ${row}`.trimEnd()
    examples.push([
      `sample ${validation.index[place]} of the standard set, ${kind}, ${validation.scored[place]} scored code points: ${rows[0]!.wrong} wrong with ${worse.row.label}, seed ${seeds[0]}, and ${rows[1]!.wrong} with ${better.row.label}`,
      line('text', text), line('label', labels), line(worse.name, rows[0]!.shown), line('', rows[0]!.marks), line(better.name, rows[1]!.shown), line('', rows[1]!.marks),
    ].join('\n'))
  }
  return examples
}

const all = rowNamed(asItIs.result.records[0]!, 'all')
print(`Dataset ${asItIs.result.records[0]!.datasetKey}, validation split of the standard set, the exact parser, percentages: ${all.samples} broken samples, ${all.nothingToRecover} of them with nothing to recover, ${all.codePoints} scored code points, ${all.addedCodePoints} code points that the damage added. A number with brackets is the mean of the seeds ${reportedSeeds.join(', ')}, with the lowest and the highest. Too deep valid JSON: ${tooDeepForms.reduce((total, form) => total + countsOnTooDeepTexts(asItIs.tables[0]!, form.texts).fromFirstError, 0)} code points from the first error on, in the four forms of ../combined/deep-valid.ts.`)
print()
print('## The main table')
print()
printMainTable([asItIs, handRuleLines, handWritten, plainPass, candidateOfCombined, standard, standardWithoutClasses, primary, searched, withoutLineEdits])
print()

print('## Each step of a row')
print()
// The steps of the rows, each step once: two rows on one train set share their training.
const namedRows = [{row: primaryRow, name: 'neutral damage'}, {row: searchedRow, name: 'neutral damage'}, {row: withoutLineEditsRow, name: 'neutral damage without line edits'}, {row: standardRow, name: 'the standard train set'}, {row: standardWithoutClassesRow, name: 'the standard train set, without the classes'}]
const stepRows = new Map<string, ReportRow>()
for (const {row, name} of namedRows) {
  const done: string[] = []
  for (const recipe of stepsOf(row.recipe)) {
    done.push(done.length === 0 ? 'the training alone' : recipe.todaysKindsInErrorState ? 'then today\'s kinds in the state error' : recipe.displayByCount ? 'then the count' : 'then the search')
    const step: Row = {trainSet: row.trainSet, recipe}
    if (!stepRows.has(settingNameOf(step))) stepRows.set(settingNameOf(step), rowOf(step, `${name}: ${done.join(', ')}`))
  }
}
printMainTable([...stepRows.values()])
print()

print('## What the trainer takes from each train set')
print()
printTrainSets([primaryRow, withoutLineEditsRow, standardRow])
print()

print('## The primary row against the rows that it is read against')
print()
for (const other of [standard, standardWithoutClasses, candidateOfCombined, handWritten, handRuleLines, plainPass, asItIs]) printComparisons(primary, other)
print('## The primary row against the standard train set, per group of the dataset')
print()
printComparisons(primary, standard, [...groupNames].reverse().map(group => `group: ${group}`))
print('## The standard train set with the classes against without them')
print()
printComparisons(standard, standardWithoutClasses)
print('## Neutral damage without line edits against the primary row and against the standard train set')
print()
printComparisons(withoutLineEdits, primary)
printComparisons(withoutLineEdits, standard)
print('## The search: with it against without it, on neutral damage and on the standard train set')
print()
printComparisons(searched, primary)
printComparisons(candidateOfCombined, standard)
printComparisons(searched, candidateOfCombined)

print('## By group and by source')
print()
printGroupsAndSources([asItIs, handRuleLines, handWritten, candidateOfCombined, standard, standardWithoutClasses, primary, searched, withoutLineEdits])

print('## Strings and keys without double quotes, and every other sample')
print()
printParts([asItIs, handRuleLines, handWritten, plainPass, candidateOfCombined, standard, standardWithoutClasses, primary, searched, withoutLineEdits], kindsWithoutDoubleQuotes, primary, standard)

print('## By kind of damage: the primary row against the standard train set')
print()
printKinds(primary, standard, standardWithoutClasses)
print('## By kind of damage: the search on neutral damage, with it against without it')
print()
printKinds(searched, primary, candidateOfCombined)

if (examplesPerKind > 0) {
  print('## Samples to read')
  print()
  print('k, d or c under a code point: the display kind, the depth or the container is wrong there, * more than one of them. ! is the first error, where nothing is wrong there. Label letters: w whitespace, p punctuation, s string, e escape, n number, l literal, E error, k key, blank for a code point that the damage added, ? where the kind is not scored.')
  print()
  const [neutral, standardTables] = [{row: primary, name: 'neutral'}, {row: standard, name: 'standard'}]
  // Kinds in which the primary row loses the most on the samples that have the kind alone, and kinds in which it
  // has more right than the row of the standard train set.
  for (const kind of ['singleQuotedString', 'unquotedKey', 'logLines', 'statementWrapper', 'trailingComma']) for (const example of examplesOf(kind, neutral, standardTables, examplesPerKind)) print(`${example}\n`)
  for (const kind of ['missingCloser', 'openStringMidLine']) for (const example of examplesOf(kind, standardTables, neutral, examplesPerKind)) print(`${example}\n`)
}
