// The tables of README.md of the arm "extra facts", from the runs that run.ts and search-display.ts saved. Nothing
// is trained here: the script reads the saved records and tables, so it can be run again after a change of the
// report alone. It prints every table of the README under the heading that the table has there. Around the tables it
// prints what the README's sentences lean on: the sentences of describeComparison for the pairs of settings, the
// kinds of damage that a setting moves, and the comparisons seed by seed.
//
// Two settings are compared in one of two ways. Two sets of runs are compared by their ranges over the seeds, as
// describeComparison does it. Two settings that share what a seed draws are also compared seed by seed, e.g. the
// display entries by a count, whose tables are the tables of "no addition" of the same seed with other display
// entries: there the ranges hold the spread of the training, which both sides have in common.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/extra-facts/report.ts [--trainers plain,three-uniform] [--cells]
// Without --trainers it reports every trainer's setting of facts.ts that has saved runs. A setting that was not run
// is left out of the tables and named. The rows of search-display.ts and of the confirmation seeds are in the report
// when they were run. --cells also prints, for the best seed of each setting with added classes, what the cells of
// the new classes hold, which takes a run of the train split per setting.
import {existsSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {displayKind} from '../../../labels.ts'
import {optionOf, refuseUnknownOptions} from '../../data.ts'
import {handwrittenTables} from '../../handwritten/rules.ts'
import {createTrace} from '../../recovery-parser.ts'
import {
  type RecoveryTables, asIsTables, cellCounts, className, classNames, displayKindNames, eventNames, lexerChoiceName, lexerStateName, lexerStateNames, loadTablesOfThisDataset, openDisplayEntries, tablesToJson, today,
} from '../../recovery-tables.ts'
import {runOnSample, sharesOf} from '../../score.ts'
import {
  type ArmRecord, type SettingResult, type Spread, armFolderOf, baselines, describeComparison, fileNameOf, numberToBeat, numberToBeatFileOf, percentSpread, recordOf, rowNamed, savedResultOf, spreadOf,
  trainPartOfTheStandardSet, validationOfTheStandardSet,
} from '../harness.ts'
import {
  type SettingOfTheArm, additionsOf, armNameOf, armNameOfTheSearch, baseOf, classTodayNameOf, classesChosenByHand, classesChosenFromTrainSamples, codePointsOfTheRule, confirmationSeeds, describeTrainerSetting,
  displayEntriesByCount, leastDistanceOfTheRule, leastSamplesOfTheRule, outcomeNames, reportedSeeds, savedTablesOf, settingNamesOfTheSearch, settingOfKey, settingsOfTheArm, trainerSettings,
} from './facts.ts'

refuseUnknownOptions('arms/extra-facts/report.ts', ['--trainers', '--cells'])
const withCells = process.argv.includes('--cells')
const print = (line = '') => console.log(line)
const trainSamples = trainPartOfTheStandardSet()

// The saved result of a run of the harness, or undefined when it was not run.
function savedOrNone(armName: string, settingName: string): SettingResult | undefined {
  const folder = join(armFolderOf(armName), fileNameOf(settingName))
  if (!existsSync(folder) || !readdirSync(folder).some(name => name.endsWith('.record.json'))) return undefined
  return savedResultOf(armName, settingName)
}
// The saved result of a setting of the arm with a trainer's setting, for the reported seeds or for other seeds.
const savedOf = (trainerName: string, setting: SettingOfTheArm, seeds: readonly number[] = reportedSeeds) => savedOrNone(armNameOf(trainerName, seeds), setting.name)
const trainerNames = (optionOf('--trainers')?.split(',') ?? Object.keys(trainerSettings)).filter(name => {
  if (trainerSettings[name] === undefined) throw new Error(`facts.ts has no trainer's setting ${JSON.stringify(name)}. Its settings: ${Object.keys(trainerSettings).join(', ')}`)
  return savedOf(name, settingOfKey('none')) !== undefined
})

// The numbers of a record that the tables show.
const withinReach = 'group: within reach of the tables'
const allThreeOf = (rowName: string) => (record: ArmRecord) => sharesOf(rowNamed(record, rowName)).allThree
const wholeSamplesOf = (record: ArmRecord) => sharesOf(rowNamed(record, 'all')).whole
const wrongDepthsNothingAfter = (record: ArmRecord) => record.wrongDepthsOnDeepValidJson.nothingAfter
const wrongDepthsMembersAfter = (record: ArmRecord) => record.wrongDepthsOnDeepValidJson.membersAfter
const over = (result: SettingResult, value: (record: ArmRecord) => number) => spreadOf(result.records.map(value))
// Whether a range lies above or below the range of the control, counted here and not read off the table: nothing
// when the two ranges overlap.
const apartFrom = (spread: Spread, control: Spread) => spread.lowest > control.highest ? ', above' : spread.highest < control.lowest ? ', below' : ''
const counts = (spread: Spread) => spread.count === 1 || spread.lowest === spread.highest ? String(Math.round(spread.mean)) : `${Math.round(spread.mean)} (${spread.lowest} to ${spread.highest})`
const withSeparators = (count: number) => count.toLocaleString('en-US')
const percents = (result: SettingResult, value: (record: ArmRecord) => number, digits: number) => result.records.map(record => (100 * value(record)).toFixed(digits)).join(', ')
const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

// Two settings seed by seed: a number of the first setting's record minus the same number of the second's, in the
// order of the seeds. As text the differences are points, e.g. "+0.15, +0.21".
function seedBySeed(first: SettingResult, second: SettingResult, value: (record: ArmRecord) => number): number[] {
  if (first.seeds.length === 0 || first.seeds.join(' ') !== second.seeds.join(' ')) throw new Error(`${JSON.stringify(first.name)} and ${JSON.stringify(second.name)} do not have the same seeds`)
  return first.records.map((record, index) => value(record) - value(second.records[index]!))
}
const points = (difference: number, digits = 2) => {
  const text = (100 * difference).toFixed(digits)
  return text.startsWith('-') ? text : `+${text}`
}
const pointsOfSeeds = (differences: readonly number[], digits = 2) => differences.map(difference => points(difference, digits)).join(', ')

const groupRows = ['group: needs a character class', 'group: needs a display fix', 'group: needs a line rule', 'group: needs a nesting fix', 'group: out of reach'] as const
// The group that an addition is made for.
const ownGroupOf = (setting: SettingOfTheArm) => setting.classes !== 'none' && !setting.displayEntries ? groupRows[0] : setting.firstOnLineBit && !setting.displayEntries ? groupRows[2] : setting.displayEntries && setting.classes === 'none' ? groupRows[1] : undefined

// The two tables of some results: the scores, and what the main number does not show. With a control, a cell says
// "above" or "below" when its range does not overlap the control's range.
type Row = {name: string, result: SettingResult}
function describeRows(rows: readonly Row[], control?: SettingResult) {
  const cell = (result: SettingResult, value: (record: ArmRecord) => number, digits: number) =>
    `${percentSpread(over(result, value), digits)}${control === undefined || result === control ? '' : apartFrom(over(result, value), over(control, value))}`
  print('| setting | all three | within reach of the tables | whole samples | needs a character class | needs a display fix | needs a line rule | needs a nesting fix | out of reach |')
  print('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const {name, result} of rows) {
    print(`| ${name} | ${cell(result, allThreeOf('all'), 2)} | ${cell(result, allThreeOf(withinReach), 2)} | ${cell(result, wholeSamplesOf, 2)} | ${groupRows.map(rowName => cell(result, allThreeOf(rowName), 1)).join(' | ')} |`)
  }
  print()
  print('| setting | added code points shown as an error | samples that show an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | cells changed against the base |')
  print('| --- | --- | --- | --- | --- | --- | --- |')
  for (const {name, result} of rows) {
    print(`| ${name} | ${cell(result, record => record.addedShownAsError, 1)} | ${cell(result, record => record.samplesShowingError, 1)} | ${counts(over(result, record => record.shownAsPastEnd))} | ${cell(result, wrongDepthsNothingAfter, 1)} | ${cell(result, wrongDepthsMembersAfter, 1)} | ${counts(over(result, record => record.cellsChangedAgainstBase.total))} |`)
  }
}

// The kinds of damage in which the range of a setting does not overlap the range of the control, from the largest
// gain to the largest loss, with the kind's validation samples.
function kindsApart(result: SettingResult, control: SettingResult): string {
  const apart = control.records[0]!.rows.filter(row => row.name.startsWith('kind: ')).flatMap(row => {
    const [ofSetting, ofControl] = [over(result, allThreeOf(row.name)), over(control, allThreeOf(row.name))]
    return apartFrom(ofSetting, ofControl) === '' ? [] : [{name: row.name.slice('kind: '.length), samples: row.samples, ofSetting, ofControl}]
  }).sort((left, right) => (right.ofSetting.mean - right.ofControl.mean) - (left.ofSetting.mean - left.ofControl.mean))
  return apart.length === 0 ? 'none' : apart.map(({name, samples, ofSetting, ofControl}) => `\`${name}\` (${samples} samples) ${percentSpread(ofControl, 1)} to ${percentSpread(ofSetting, 1)}`).join('; ')
}
// The sentences of describeComparison for two settings on some rows of the score, each after `prefix`, which says
// what the two settings have in common, e.g. the trainer's setting.
const compare = (first: SettingResult, second: SettingResult, rowNames: readonly (string | undefined)[], prefix = '') => {
  for (const rowName of rowNames) if (rowName !== undefined) print(`- ${prefix}${describeComparison(first, second, rowName)}`)
}

// What the rule sees and picks, and the open cells of every setting.
print('## The two choices of classes')
print()
const ofTheRule = codePointsOfTheRule(trainSamples)
const picked = ofTheRule.filter(entry => entry.picked)
const describeOutcomes = (shares: readonly number[]) => shares.map((share, outcome) => ({share, outcome})).filter(({share}) => share >= 0.005).sort((left, right) => right.share - left.share).slice(0, 3).map(({share, outcome}) => `${outcomeNames[outcome]} ${(100 * share).toFixed(0)}%`).join(', ')
const codePointName = (codePoint: number) => `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}${codePoint > 0x20 && codePoint < 0x7f ? ` \`${String.fromCodePoint(codePoint).replace('`', '` ` `')}\`` : ''}`
print(`${ofTheRule.length} code points come at or after a first error in ${leastSamplesOfTheRule} train samples or more. The rule picks the ${picked.length} with a distance of ${leastDistanceOfTheRule} or more from the other code points of their class. The table has them and the 6 after them. "What it is" is the event at the code point's counterpart in the original, or "added".`)
print()
print('| code point | class today | train samples | occurrences | distance | what it is | what the rest of its class is | picked | chosen by hand |')
print('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
const chosenByHand = (codePoint: number) => classesChosenByHand.some(({codePoints}) => codePoints.includes(codePoint))
for (const entry of ofTheRule.slice(0, picked.length + 6)) {
  print(`| ${codePointName(entry.codePoint)} | ${classTodayNameOf(entry)} | ${withSeparators(entry.samples)} | ${withSeparators(entry.occurrences)} | ${entry.distance.toFixed(2)} | ${describeOutcomes(entry.shares)} | ${describeOutcomes(entry.sharesOfTheRest)} | ${entry.picked ? 'yes' : 'no'} | ${chosenByHand(entry.codePoint) ? 'yes' : 'no'} |`)
}
print()
const handOnly = classesChosenByHand.filter(({codePoints}) => !picked.some(entry => codePoints.includes(entry.codePoint)))
print(`Chosen by hand and not by the rule, with the distance of each: ${handOnly.map(({name, codePoints}) => {
  const entry = ofTheRule.find(candidate => candidate.codePoint === codePoints[0])
  return `${name} ${entry === undefined ? `(fewer than ${leastSamplesOfTheRule} train samples)` : entry.distance.toFixed(2)}`
}).join(', ')}. Picked by the rule and not chosen by hand: ${picked.filter(entry => !chosenByHand(entry.codePoint)).map(entry => codePointName(entry.codePoint)).join(', ')}.`)
const classesFromTrainSamples = classesChosenFromTrainSamples(trainSamples)
print()
print('## The settings')
print()
print('| key in `--settings` | the setting | open tokenizer cells | open grammar cells | open display entries |')
print('| --- | --- | --- | --- | --- |')
for (const setting of settingsOfTheArm) {
  const open = cellCounts(baseOf(additionsOf(setting, classesFromTrainSamples)))
  print(`| \`${setting.key}\` | ${setting.name} | ${withSeparators(open.lexerOpen)} of ${withSeparators(open.lexerCells)} | ${withSeparators(open.grammarOpen)} of ${withSeparators(open.grammarCells)} | ${open.displayOpen} of ${open.displayEntries} |`)
}

// The rows that no trainer's setting changes: the hand-written tables and the number to beat, each also with its
// display entries set by a count, and the rows of search-display.ts.
const toBeat = numberToBeat()
const handwritten = baselines().at(-1)!
const counted = (name: string, tables: RecoveryTables, startedFrom: RecoveryTables): SettingResult => ({name, seeds: [], records: [recordOf(displayEntriesByCount(tables, trainSamples), openDisplayEntries(startedFrom))]})
const handTables = handwrittenTables().tables
const handwrittenCounted = counted('hand-written, then the open display entries by a count', handTables, asIsTables())
const toBeatCounted = counted('search from the hand-written tables, then the open display entries by a count', loadTablesOfThisDataset(numberToBeatFileOf(process.env['RECOVERY_SCRATCH']!)).tables, handTables)
const searchInTurns = savedOrNone(armNameOfTheSearch, settingNamesOfTheSearch.inTurns)
// The random orders are rows when three of them or more were run, which a comparison needs, and when the search
// alone, the search with one count and the search in turns have the same orders.
const savedRandomOrders = [settingNamesOfTheSearch.randomOrderAlone, settingNamesOfTheSearch.randomOrderThenCount, settingNamesOfTheSearch.randomOrderInTurns].map(name => savedOrNone(armNameOfTheSearch, name))
const [randomAlone, randomThenCount, randomInTurns] = savedRandomOrders.every(result => result !== undefined && result.seeds.length >= 3 && result.seeds.join(' ') === savedRandomOrders[0]!.seeds.join(' ')) ? savedRandomOrders : []
const searches = [searchInTurns, randomAlone, randomThenCount, randomInTurns].filter(result => result !== undefined)
const withoutTrainer = [handwritten, handwrittenCounted, toBeat, toBeatCounted, ...searches]

// The settings of a trainer's setting that were run with the reported seeds, in the order of facts.ts. A table names
// a setting by its key, e.g. `classes-hand`, which the table of the settings explains.
type Reported = {setting: SettingOfTheArm, name: string, result: SettingResult}
const keyAsCode = (key: string) => `\`${key}\``
const reportedOf = new Map<string, Reported[]>()
const resultOf = (trainerName: string, key: string) => reportedOf.get(trainerName)?.find(entry => entry.setting.key === key)?.result

print()
print('## Results')
for (const trainerName of trainerNames) {
  const control = savedOf(trainerName, settingOfKey('none'))!
  // A setting is reported when it was run with the seeds of the control, so that every row has the same seeds.
  const results = settingsOfTheArm.flatMap(setting => {
    const result = savedOf(trainerName, setting)
    return result === undefined || result.seeds.join(', ') !== control.seeds.join(', ') ? [] : [{setting, name: keyAsCode(setting.key), result}]
  })
  reportedOf.set(trainerName, results)
  const leftOut = settingsOfTheArm.filter(setting => !results.some(entry => entry.setting === setting))
  const describedTrainer = describeTrainerSetting(trainerSettings[trainerName]!)
  print()
  print(`### The trainer's setting \`${trainerName}\``)
  print()
  print(`${describedTrainer[0]!.toUpperCase()}${describedTrainer.slice(1)}. The seeds ${control.seeds.join(', ')}. A cell says "above" or "below" when its range does not overlap the range of the row \`none\`.${leftOut.length === 0 ? '' : ` Not run with this setting of the trainer: ${leftOut.map(setting => keyAsCode(setting.key)).join(', ')}.`}`)
  print()
  describeRows(results, control)
  const runs = results.flatMap(({result}) => result.records)
  // The control of the plain trainer is the run of ../plain-pass/, so its tables have to be that arm's tables.
  let sameAsThePlainPass = ''
  if (trainerName === 'plain') {
    const plainPassFolder = join(armFolderOf('plain-pass'), fileNameOf('one pass of the trainer from today\'s tables, defaults'))
    const same = control.seeds.filter(seed => existsSync(join(plainPassFolder, `seed-${seed}.tables.json`))
      && tablesToJson(loadTablesOfThisDataset(join(plainPassFolder, `seed-${seed}.tables.json`)).tables) === tablesToJson(savedTablesOf(armNameOf(trainerName), settingOfKey('none').name, seed)))
    sameAsThePlainPass = ` The tables of \`none\` are the tables that \`../plain-pass/\` saved, byte for byte, for ${same.length} of the ${control.seeds.length} seeds.`
  }
  const meansOfWrongDepths = results.flatMap(({result}) => [over(result, wrongDepthsNothingAfter).mean, over(result, wrongDepthsMembersAfter).mean])
  const shownAsPastEnd = runs.map(record => record.shownAsPastEnd)
  print()
  print(`Over the rows of the second table, the wrong depths on valid JSON of 17 to 19 levels are ${(100 * Math.min(...meansOfWrongDepths)).toFixed(1)}% to ${(100 * Math.max(...meansOfWrongDepths)).toFixed(1)}% as means over the seeds, and ${Math.max(...shownAsPastEnd) === 0 ? 'no seed shows a code point' : `a seed shows ${withSeparators(Math.min(...shownAsPastEnd))} to ${withSeparators(Math.max(...shownAsPastEnd))} code points`} as past the end. The ground rules hold on the fixed texts for ${runs.filter(record => record.groundRules.hold).length} of the ${runs.length} runs.${sameAsThePlainPass}`)

  print()
  print('The kinds of damage in which a setting\'s range of all three does not overlap the range of `none`, from the largest gain to the largest loss, as the range of `none` and then the setting\'s:')
  print()
  for (const {name, result} of results.slice(1)) print(`- ${name}: ${kindsApart(result, control)}.`)

  print()
  print('As `describeComparison` says it:')
  print()
  const prefix = `\`${trainerName}\`. `
  for (const {setting, result} of results.slice(1)) compare(result, control, ['all', withinReach, ownGroupOf(setting)], prefix)
  const [hand, fromData, display, displayCounted, all, allFromData] = ['classes-hand', 'classes-data', 'display', 'display-counted', 'all', 'all-data'].map(key => resultOf(trainerName, key))
  if (hand !== undefined && fromData !== undefined) compare(hand, fromData, ['all', withinReach, groupRows[0]], prefix)
  if (all !== undefined && allFromData !== undefined) compare(all, allFromData, ['all', withinReach, groupRows[0]], prefix)
  if (display !== undefined && displayCounted !== undefined) compare(display, displayCounted, ['all', withinReach, groupRows[1]], prefix)
  // The target at the added code points was run with open display entries, so that setting is its control.
  if (display !== undefined) for (const {setting, result} of results) if (setting.errorTargetShare !== undefined && setting.displayEntries) compare(result, display, ['all', withinReach], prefix)
  for (const result of [display, all]) if (result !== undefined) for (const other of [toBeat, toBeatCounted, ...searches]) compare(result, other, ['all', withinReach], prefix)
}

// The settings that ran with all four pairs of passes and starts, next to each other.
print()
print('### Open display entries by the passes and the start')
print()
print('All three on all validation samples. A cell says "above" or "below" when its range does not overlap the range of `none` of the same row.')
print()
print('| trainer | passes | start | `none` | `display` | `display-counted` |')
print('| --- | --- | --- | --- | --- | --- |')
for (const trainerName of trainerNames) {
  const [control, display, displayCounted] = ['none', 'display', 'display-counted'].map(key => resultOf(trainerName, key))
  if (control === undefined || display === undefined || displayCounted === undefined) continue
  const cell = (result: SettingResult) => `${percentSpread(over(result, allThreeOf('all')))}${result === control ? '' : apartFrom(over(result, allThreeOf('all')), over(control, allThreeOf('all')))}`
  print(`| \`${trainerName}\` | ${trainerSettings[trainerName]!.passes} | ${trainerSettings[trainerName]!.start === 'base' ? 'the base\'s choices' : 'uniform'} | ${cell(control)} | ${cell(display)} | ${cell(displayCounted)} |`)
}

// The count against the tables that it started from, seed by seed.
print()
print('### The display entries by a count, seed by seed')
print()
print('The tables of `display-counted` are the tables of `none` of the same seed with other display entries. `display-counted` minus `none`, in points, in the order of the seeds, and how many of the open display entries the count changed:')
print()
print('| trainer | all three | within reach of the tables | whole samples | display entries that the count changed |')
print('| --- | --- | --- | --- | --- |')
const gainsOfTheCount: {all: number[], reach: number[]} = {all: [], reach: []}
for (const trainerName of trainerNames) {
  const [control, displayCounted] = ['none', 'display-counted'].map(key => resultOf(trainerName, key))
  if (control === undefined || displayCounted === undefined) continue
  const [all, reach, whole] = [allThreeOf('all'), allThreeOf(withinReach), wholeSamplesOf].map(value => seedBySeed(displayCounted, control, value))
  gainsOfTheCount.all.push(...all!)
  gainsOfTheCount.reach.push(...reach!)
  print(`| \`${trainerName}\` | ${pointsOfSeeds(all!)} | ${pointsOfSeeds(reach!)} | ${pointsOfSeeds(whole!)} | ${displayCounted.records.map(record => record.cellsChangedAgainstBase.display).join(', ')} |`)
}
const describeGains = (gains: readonly number[]) => `in ${gains.filter(gain => gain > 0).length} of the ${gains.length} runs, by ${points(Math.min(...gains))} to ${points(Math.max(...gains))} points`
print()
print(`On all validation samples the count is above the tables that it started from ${describeGains(gainsOfTheCount.all)}, and in the group within reach of the tables ${describeGains(gainsOfTheCount.reach)}.`)

print()
print('### Without a trainer')
print()
print('The hand-written tables and the number to beat, each as they are and with their display entries set by a count, and the rows of `search-display.ts`: the search and the count in turns with the most read cells first, and in random orders the search alone, the search with one count after it, and the search and the count in turns.')
print()
describeRows(withoutTrainer.map(result => ({name: result.name, result})))
if (searchInTurns !== undefined && randomAlone !== undefined && randomThenCount !== undefined && randomInTurns !== undefined) {
  print()
  print('The same per order of the cells, all three on all validation samples and in the group within reach of the tables. With the most read cells first, the search alone is the number to beat.')
  print()
  print('| order of the cells | the search alone | then one count | the search and the count in turns | within reach: the search alone | then one count | the search and the count in turns |')
  print('| --- | --- | --- | --- | --- | --- | --- |')
  const orders = [
    {name: 'the most read cells first', records: [toBeat, toBeatCounted, searchInTurns].map(result => result.records[0]!)},
    ...randomAlone.seeds.map((seed, index) => ({name: `random, seed ${seed}`, records: [randomAlone, randomThenCount, randomInTurns].map(result => result.records[index]!)})),
  ]
  for (const {name, records} of orders) print(`| ${name} | ${[allThreeOf('all'), allThreeOf(withinReach)].flatMap(value => records.map(record => (100 * value(record)).toFixed(2))).join(' | ')} |`)
  const gainsPerOrder = (first: number, second: number, value: (record: ArmRecord) => number) => pointsOfSeeds(orders.map(({records}) => value(records[first]!) - value(records[second]!)))
  print()
  print(`In the order of the rows, on all validation samples: the search with one count is ${gainsPerOrder(1, 0, allThreeOf('all'))} points from the search alone, and the search and the count in turns are ${gainsPerOrder(2, 1, allThreeOf('all'))} points from the search with one count. Within reach of the tables: ${gainsPerOrder(1, 0, allThreeOf(withinReach))} and ${gainsPerOrder(2, 1, allThreeOf(withinReach))}.`)
  print()
  compare(randomInTurns, randomAlone, ['all', withinReach])
  compare(randomThenCount, randomAlone, ['all', withinReach])
}

// The row with the most of all three was picked with the scores of the reported seeds in view, so it ran again with
// other seeds, with its control and with the same setting of the trainer's setting `plain`.
const confirmed = ['three-base', 'plain'].flatMap(trainerName => ['none', 'all'].flatMap(key => {
  const [reported, confirmation] = [resultOf(trainerName, key), savedOf(trainerName, settingOfKey(key), confirmationSeeds)]
  return reported === undefined || confirmation === undefined || confirmation.seeds.join(' ') !== confirmationSeeds.join(' ') ? [] : [{trainerName, key, reported, confirmation, both: {name: reported.name, seeds: [...reported.seeds, ...confirmation.seeds], records: [...reported.records, ...confirmation.records]}}]
}))
if (confirmed.length > 0) {
  const seedsText = (seeds: readonly number[]) => `${seeds[0]} to ${seeds.at(-1)}`
  print()
  print(`### The confirmation with the seeds ${seedsText(confirmationSeeds)}`)
  print()
  print('| trainer | setting | seeds | all three | within reach of the tables | whole samples | needs a character class | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after |')
  print('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const {trainerName, key, reported, confirmation, both} of confirmed) {
    const rows: [string, SettingResult][] = [[seedsText(reported.seeds), reported], [seedsText(confirmation.seeds), confirmation]]
    if (key === 'all') rows.push([`all ${both.records.length}`, both])
    for (const [seeds, result] of rows) {
      const cell = (value: (record: ArmRecord) => number, digits: number) => percentSpread(over(result, value), digits)
      print(`| \`${trainerName}\` | ${keyAsCode(key)} | ${seeds} | ${cell(allThreeOf('all'), 2)} | ${cell(allThreeOf(withinReach), 2)} | ${cell(wholeSamplesOf, 2)} | ${cell(allThreeOf(groupRows[0]), 1)} | ${counts(over(result, record => record.shownAsPastEnd))} | ${cell(wrongDepthsNothingAfter, 1)} | ${cell(wrongDepthsMembersAfter, 1)} |`)
    }
  }
  print()
  print(`The setting \`all\` seed by seed, the seeds ${seedsText(reportedSeeds)} and then the seeds ${seedsText(confirmationSeeds)}:`)
  print()
  const toBeatRow = rowNamed(toBeat.records[0]!, 'all')
  const toBeatShare = (rowName: string) => allThreeOf(rowName)(toBeat.records[0]!)
  for (const {trainerName, key, reported, confirmation, both} of confirmed) {
    if (key !== 'all') continue
    const twice = (value: (record: ArmRecord) => number, digits: number) => `${percents(reported, value, digits)} and ${percents(confirmation, value, digits)}`
    const above = (rowName: string) => both.records.filter(record => allThreeOf(rowName)(record) > toBeatShare(rowName)).length
    const lowest = Math.min(...both.records.map(record => rowNamed(record, 'all').allRight))
    const withWrongDepth = both.records.filter(record => wrongDepthsNothingAfter(record) > 0 || wrongDepthsMembersAfter(record) > 0).length
    print(`- \`${trainerName}\`. All three: ${twice(allThreeOf('all'), 2)}, above the number to beat, ${(100 * toBeatShare('all')).toFixed(2)}, in ${above('all')} of the ${both.records.length} seeds. The lowest seed has ${withSeparators(Math.abs(lowest - toBeatRow.allRight))} code points ${lowest >= toBeatRow.allRight ? 'more' : 'fewer'} right than the number to beat, of ${withSeparators(toBeatRow.codePoints)}. Within reach of the tables: ${twice(allThreeOf(withinReach), 2)}, above the number to beat, ${(100 * toBeatShare(withinReach)).toFixed(2)}, in ${above(withinReach)} of the ${both.records.length} seeds. Wrong depths on valid JSON of 17 to 19 levels, nothing after the nested containers: ${twice(wrongDepthsNothingAfter, 1)}, and members after: ${twice(wrongDepthsMembersAfter, 1)}, so ${withWrongDepth} of the ${both.records.length} seeds have a wrong depth there. Code points shown as past the end: ${reported.records.map(record => record.shownAsPastEnd).join(', ')} and ${confirmation.records.map(record => record.shownAsPastEnd).join(', ')}.`)
  }
  print()
  print(`As \`describeComparison\` says it for the seeds ${seedsText(confirmationSeeds)}:`)
  print()
  const confirmationOf = (trainerName: string, key: string) => confirmed.find(entry => entry.trainerName === trainerName && entry.key === key)?.confirmation
  for (const trainerName of ['three-base', 'plain']) {
    const [control, all] = [confirmationOf(trainerName, 'none'), confirmationOf(trainerName, 'all')]
    if (all === undefined) continue
    if (control !== undefined) compare(all, control, ['all', withinReach], `\`${trainerName}\`. `)
    for (const other of [toBeat, toBeatCounted, ...searches]) compare(all, other, ['all', withinReach], `\`${trainerName}\`. `)
  }
  const [ofThreeBase, ofPlain] = [confirmationOf('three-base', 'all'), confirmationOf('plain', 'all')]
  if (ofThreeBase !== undefined && ofPlain !== undefined) compare(ofThreeBase, ofPlain, ['all', withinReach], '`three-base` against `plain`. ')
  const [reportedThreeBase, reportedPlain] = [resultOf('three-base', 'all'), resultOf('plain', 'all')]
  if (reportedThreeBase !== undefined && reportedPlain !== undefined) compare(reportedThreeBase, reportedPlain, ['all', withinReach], `\`three-base\` against \`plain\`, the seeds ${seedsText(reportedSeeds)}. `)
}

// The target at the added code points, next to its control: the same setting without the target, with the same
// seeds, so the two are also compared seed by seed.
print()
print('### The target "an added code point is shown as an error"')
print()
print('The control of a weight is the row "none" above it: the same setting of the arm without the target. A cell says "above" or "below" when its range does not overlap the range of that control. "Minus its control" is the target minus its control seed by seed, in points, in the order of the seeds, with the mean.')
print()
print('| trainer | open display entries | weight | all three | minus its control | within reach of the tables | whole samples | minus its control | added code points shown as an error | the same, seed by seed |')
print('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
const targets: {trainerName: string, setting: SettingOfTheArm, result: SettingResult, control: SettingResult}[] = []
for (const trainerName of trainerNames) {
  for (const displayEntries of [true, false]) {
    const control = resultOf(trainerName, displayEntries ? 'display' : 'none')
    const ofControl = (reportedOf.get(trainerName) ?? []).filter(({setting}) => setting.errorTargetShare !== undefined && setting.displayEntries === displayEntries)
    if (control === undefined || ofControl.length === 0) continue
    const row = (weight: string, result: SettingResult) => {
      const cell = (value: (record: ArmRecord) => number, digits: number) => `${percentSpread(over(result, value), digits)}${result === control ? '' : apartFrom(over(result, value), over(control, value))}`
      const minusControl = (value: (record: ArmRecord) => number, digits: number) => {
        if (result === control) return ''
        const differences = seedBySeed(result, control, value)
        return `${pointsOfSeeds(differences, digits)} (mean ${points(mean(differences), digits)})`
      }
      print(`| \`${trainerName}\` | ${displayEntries ? 'yes' : 'no'} | ${weight} | ${cell(allThreeOf('all'), 2)} | ${minusControl(allThreeOf('all'), 2)} | ${cell(allThreeOf(withinReach), 2)} | ${cell(wholeSamplesOf, 2)} | ${minusControl(wholeSamplesOf, 1)} | ${cell(record => record.addedShownAsError, 1)} | ${percents(result, record => record.addedShownAsError, 1)} |`)
    }
    row('none', control)
    for (const {setting, result} of ofControl) {
      row(String(setting.errorTargetShare), result)
      targets.push({trainerName, setting, result, control})
    }
  }
}
for (const trainerName of trainerNames) {
  const [withEntries, withoutEntries] = [true, false].map(displayEntries => targets.find(target => target.trainerName === trainerName && target.setting.errorTargetShare === 0.3 && target.setting.displayEntries === displayEntries))
  if (withEntries === undefined || withoutEntries === undefined) continue
  const shownFewer = seedBySeed(withoutEntries.result, withEntries.result, record => record.addedShownAsError).filter(difference => difference < 0).length
  const [costWith, costWithout] = [withEntries, withoutEntries].map(({result, control}) => seedBySeed(result, control, allThreeOf('all')))
  const costsMore = costWithout!.filter((cost, index) => cost < costWith![index]!).length
  print()
  print(`\`${trainerName}\`, the weight 0.3: a seed draws the same added code points for the target with and without open display entries. Without them the target shows fewer added code points as an error in ${shownFewer} of the ${withEntries.result.seeds.length} seeds, and costs more of all three against its control in ${costsMore} of the ${withEntries.result.seeds.length}.`)
}

// A text as markdown code, also when the text holds a backtick.
const asCode = (text: string) => text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``
// The code points of the validation texts that tables show as "past the end", from the first damage on as the
// record counts them, from the most frequent one down, e.g. `"/"` 791 in 529 samples.
const validation = validationOfTheStandardSet()
function shownAsPastEndOf(tables: RecoveryTables): string {
  const occurrences = new Map<number, {codePoints: number, samples: number, lastSample: number}>()
  const trace = createTrace()
  for (let place = 0; place < validation.sampleCount; place++) {
    if (validation.firstDamage[place] === -1) continue
    const start = validation.start[place]!
    const length = validation.start[place + 1]! - start
    runOnSample(trace, validation, place, tables)
    for (let position = validation.firstDamage[place]!; position < length; position++) {
      if (trace.displayKind[position] !== displayKind.pastEnd) continue
      const codePoint = validation.codePoints[start + position]!
      const ofCodePoint = occurrences.get(codePoint) ?? {codePoints: 0, samples: 0, lastSample: -1}
      occurrences.set(codePoint, ofCodePoint)
      ofCodePoint.codePoints++
      if (ofCodePoint.lastSample !== place) {
        ofCodePoint.lastSample = place
        ofCodePoint.samples++
      }
    }
  }
  const sorted = [...occurrences].sort((left, right) => right[1].codePoints - left[1].codePoints)
  const others = sorted.slice(4).reduce((sum, [, {codePoints}]) => sum + codePoints, 0)
  return `${sorted.slice(0, 4).map(([codePoint, {codePoints, samples}]) => `${asCode(JSON.stringify(String.fromCodePoint(codePoint)))} ${codePoints} in ${samples} samples`).join(', ')}${others > 0 ? `, and ${others} of other code points` : ''}`
}
print()
print('### What is shown as "past the end"')
print()
print('For the seed of a setting that shows the most code points of the validation texts as "past the end": which code points they are.')
print()
for (const trainerName of trainerNames) {
  for (const key of ['none', 'classes-hand', 'classes-data', 'display', 'all']) {
    const result = resultOf(trainerName, key)
    if (result === undefined) continue
    const most = Math.max(...result.records.map(record => record.shownAsPastEnd))
    if (most === 0) {
      print(`- \`${trainerName}\`, ${keyAsCode(key)}: none in any seed.`)
      continue
    }
    const seed = result.seeds[result.records.findIndex(record => record.shownAsPastEnd === most)]!
    print(`- \`${trainerName}\`, ${keyAsCode(key)}, seed ${seed}, ${withSeparators(most)} code points: ${shownAsPastEndOf(savedTablesOf(armNameOf(trainerName), result.name, seed))}.`)
  }
}

if (withCells) {
  for (const trainerName of trainerNames) {
    for (const key of ['classes-hand', 'classes-data']) {
      const result = resultOf(trainerName, key)
      if (result === undefined) continue
      const scores = result.records.map(allThreeOf('all'))
      const bestSeed = result.seeds[scores.indexOf(Math.max(...scores))]!
      print()
      print(`### The cells of the new classes: \`${trainerName}\`, ${settingOfKey(key).name}, seed ${bestSeed}, the seed with the most of all three on the validation split`)
      print()
      describeClassCells(savedTablesOf(armNameOf(trainerName), settingOfKey(key).name, bestSeed), baseOf(additionsOf(settingOfKey(key), classesFromTrainSamples)))
    }
  }
}

// For every added class of `tables`, over the code points of the class at or after a first error in the train
// samples: what the tables do there, as the shares of the events, of the display kinds and of the code points after
// which the tokenizer is between tokens, next to what the code point is in the originals. Then the four cells of
// the class that the most code points read: what the cell holds, what it held in the base, and what the cell of
// the class that the code points came from holds in the same tables.
function describeClassCells(tables: RecoveryTables, base: RecoveryTables) {
  const readers = new Int32Array(tables.lexerNext.length)
  const events = new Int32Array(tables.classCount * tables.eventCount)
  const shownAs = new Int32Array(tables.classCount * displayKindNames.length)
  const betweenAfter = new Int32Array(tables.classCount)
  const between = lexerStateNames.indexOf('between')
  const trace = createTrace()
  for (let place = 0; place < trainSamples.sampleCount; place++) {
    if (trainSamples.firstDamage[place] === -1) continue
    runOnSample(trace, trainSamples, place, tables)
    const length = trainSamples.start[place + 1]! - trainSamples.start[place]!
    for (let position = trainSamples.firstErrorPosition[place]!; position < length; position++) {
      const cell = trace.lexerCell[position]!
      const characterClass = cell % tables.classCount
      readers[cell]!++
      events[characterClass * tables.eventCount + trace.event[position]!]!++
      shownAs[characterClass * displayKindNames.length + trace.displayKind[position]!]!++
      if (tables.lexerNext[cell] === between) betweenAfter[characterClass]!++
    }
  }
  const sharesOfClass = (ofClass: Int32Array, characterClass: number, names: readonly string[], total: number) =>
    names.map((name, index) => ({name, count: ofClass[characterClass * names.length + index]!})).filter(({count}) => count / total >= 0.005).sort((left, right) => right.count - left.count).slice(0, 4)
      .map(({name, count}) => `${name} ${(100 * count / total).toFixed(0)}%`).join(', ')
  for (let characterClass = today.classCount; characterClass < tables.classCount; characterClass++) {
    const cameFrom = tables.classToday[characterClass]!
    const cells = Array.from({length: tables.lexerStateCount}, (_, state) => state * tables.classCount + characterClass).filter(cell => readers[cell]! > 0).sort((left, right) => readers[right]! - readers[left]!)
    const total = cells.reduce((sum, cell) => sum + readers[cell]!, 0)
    const inOriginals = ofTheRule.find(entry => entry.codePoint === tables.addedClasses[characterClass - today.classCount]!.codePoints[0])
    print(`- **${className(tables, characterClass)}**, out of \`${classNames[cameFrom]}\`, ${withSeparators(total)} code points${inOriginals === undefined ? '' : `, in the originals ${describeOutcomes(inOriginals.shares)}`}. The events: ${sharesOfClass(events, characterClass, eventNames, total)}. Shown as: ${sharesOfClass(shownAs, characterClass, displayKindNames, total)}. Between tokens after it: ${(100 * betweenAfter[characterClass]! / total).toFixed(0)}%.`)
    for (const cell of cells.slice(0, 4)) {
      const state = Math.floor(cell / tables.classCount)
      const [holds, held, cameFromHolds] = [lexerChoiceName(tables, cell), lexerChoiceName(base, cell), lexerChoiceName(tables, state * tables.classCount + cameFrom)]
      print(`  - in \`${lexerStateName(state)}\`, ${withSeparators(readers[cell]!)} code points: [${holds}]${tables.lexerOpen[cell] === 1 ? '' : ', a frozen cell'}${holds === held ? ', as in the base' : `, in the base [${held}]`}${holds === cameFromHolds ? `, as \`${classNames[cameFrom]}\` there` : `, where \`${classNames[cameFrom]}\` holds [${cameFromHolds}]`}`)
    }
  }
}
