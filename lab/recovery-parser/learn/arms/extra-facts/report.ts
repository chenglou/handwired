// The tables of README.md of the arm "extra facts", from the runs that run.ts saved. Nothing is trained here: the
// script reads the saved records and tables, so it can be run again after a change of the report alone.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/extra-facts/report.ts [--trainers plain,three-uniform] [--cells]
// Without --trainers it reports every trainer's setting of facts.ts that has saved runs. A setting that was not run
// is left out of the tables and named. The rows of search-display.ts are in the tables when it was run. --cells also
// prints, for the best seed of each setting with added classes, what the cells of the new classes hold, which takes
// a run of the train split per setting.
import {existsSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {optionOf, refuseUnknownOptions} from '../../data.ts'
import {handwrittenTables} from '../../handwritten/rules.ts'
import {createTrace} from '../../recovery-parser.ts'
import {
  type RecoveryTables, asIsTables, cellCounts, className, classNames, displayKindNames, eventNames, lexerChoiceName, lexerStateName, lexerStateNames, loadTablesOfThisDataset, openDisplayEntries, tablesToJson, today,
} from '../../recovery-tables.ts'
import {runOnSample, sharesOf} from '../../score.ts'
import {
  type ArmRecord, type SettingResult, type Spread, armFolderOf, baselines, describeComparison, fileNameOf, numberToBeat, numberToBeatFileOf, percentSpread, recordOf, rowNamed, savedResultOf, spreadOf,
  trainPartOfTheStandardSet,
} from '../harness.ts'
import {
  type SettingOfTheArm, additionsOf, armNameOf, armNameOfTheSearch, baseOf, classTodayNameOf, classesChosenByHand, classesChosenFromTrainSamples, codePointsOfTheRule, describeTrainerSetting, displayEntriesByCount,
  leastDistanceOfTheRule, leastSamplesOfTheRule, outcomeNames, savedTablesOf, settingNamesOfTheSearch, settingOfKey, settingsOfTheArm, trainerSettings,
} from './facts.ts'

refuseUnknownOptions('arms/extra-facts/report.ts', ['--trainers', '--cells'])
const withCells = process.argv.includes('--cells')
const print = (line = '') => console.log(line)
const trainSamples = trainPartOfTheStandardSet()

// The saved result of a setting of a trainer's setting, or undefined when the setting was not run.
function savedOf(trainerName: string, setting: SettingOfTheArm): SettingResult | undefined {
  const folder = join(armFolderOf(armNameOf(trainerName)), fileNameOf(setting.name))
  if (!existsSync(folder) || !readdirSync(folder).some(name => name.endsWith('.record.json'))) return undefined
  return savedResultOf(armNameOf(trainerName), setting.name)
}
const trainerNames = (optionOf('--trainers')?.split(',') ?? Object.keys(trainerSettings)).filter(name => {
  if (trainerSettings[name] === undefined) throw new Error(`facts.ts has no trainer's setting ${JSON.stringify(name)}. Its settings: ${Object.keys(trainerSettings).join(', ')}`)
  return savedOf(name, settingOfKey('none')) !== undefined
})

// A share of a row of the score over the records of a setting, and other numbers of a record.
const shareOf = (result: SettingResult, rowName: string, share: 'allThree' | 'whole') => spreadOf(result.records.map(record => sharesOf(rowNamed(record, rowName))[share]))
const over = (result: SettingResult, value: (record: ArmRecord) => number) => spreadOf(result.records.map(value))
// Whether a range lies above or below the range of the control, counted here and not read off the table: nothing
// when the two ranges overlap.
const apartFrom = (spread: Spread, control: Spread) => spread.lowest > control.highest ? ', above' : spread.highest < control.lowest ? ', below' : ''
const counts = (spread: Spread) => spread.count === 1 || spread.lowest === spread.highest ? String(Math.round(spread.mean)) : `${Math.round(spread.mean)} (${spread.lowest} to ${spread.highest})`
const withSeparators = (count: number) => count.toLocaleString('en-US')

const groupRows = ['group: needs a character class', 'group: needs a display fix', 'group: needs a line rule', 'group: needs a nesting fix', 'group: out of reach'] as const
// The group that an addition is made for.
const ownGroupOf = (setting: SettingOfTheArm) => setting.classes !== 'none' && !setting.displayEntries ? groupRows[0] : setting.firstOnLineBit && !setting.displayEntries ? groupRows[2] : setting.displayEntries && setting.classes === 'none' ? groupRows[1] : undefined

// The two tables of some results next to a control: the scores, and what the main number does not show. A cell
// says "above" or "below" when its range does not overlap the control's range.
function describeAgainstControl(results: readonly {name: string, result: SettingResult}[], control: SettingResult) {
  const cell = (result: SettingResult, spread: Spread, controlSpread: Spread, digits: number) => `${percentSpread(spread, digits)}${result === control ? '' : apartFrom(spread, controlSpread)}`
  print('| setting | all three | within reach of the tables | whole samples | needs a character class | needs a display fix | needs a line rule | needs a nesting fix | out of reach |')
  print('| --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const {name, result} of results) {
    const scoreCell = (rowName: string, share: 'allThree' | 'whole', digits: number) => cell(result, shareOf(result, rowName, share), shareOf(control, rowName, share), digits)
    print(`| ${name} | ${scoreCell('all', 'allThree', 2)} | ${scoreCell('group: within reach of the tables', 'allThree', 2)} | ${scoreCell('all', 'whole', 2)} | ${groupRows.map(rowName => scoreCell(rowName, 'allThree', 1)).join(' | ')} |`)
  }
  print()
  print('| setting | added code points shown as an error | samples that show an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | cells changed against the base |')
  print('| --- | --- | --- | --- | --- | --- | --- |')
  for (const {name, result} of results) {
    const shareCell = (value: (record: ArmRecord) => number) => cell(result, over(result, value), over(control, value), 1)
    print(`| ${name} | ${shareCell(record => record.addedShownAsError)} | ${shareCell(record => record.samplesShowingError)} | ${counts(over(result, record => record.shownAsPastEnd))} | ${shareCell(record => record.wrongDepthsOnDeepValidJson.nothingAfter)} | ${shareCell(record => record.wrongDepthsOnDeepValidJson.membersAfter)} | ${counts(over(result, record => record.cellsChangedAgainstBase.total))} |`)
  }
}

// The kinds of damage in which the range of a setting does not overlap the range of the control, from the largest
// gain to the largest loss, with the kind's validation samples.
function kindsApart(result: SettingResult, control: SettingResult): string {
  const apart = control.records[0]!.rows.filter(row => row.name.startsWith('kind: ')).flatMap(row => {
    const [ofSetting, ofControl] = [shareOf(result, row.name, 'allThree'), shareOf(control, row.name, 'allThree')]
    return apartFrom(ofSetting, ofControl) === '' ? [] : [{name: row.name.slice('kind: '.length), samples: row.samples, ofSetting, ofControl}]
  }).sort((left, right) => (right.ofSetting.mean - right.ofControl.mean) - (left.ofSetting.mean - left.ofControl.mean))
  return apart.length === 0 ? 'none' : apart.map(({name, samples, ofSetting, ofControl}) => `\`${name}\` (${samples} samples) ${percentSpread(ofControl, 1)} to ${percentSpread(ofSetting, 1)}`).join('; ')
}

// What the rule sees and picks.
print('## The classes chosen from the train samples')
print()
const ofTheRule = codePointsOfTheRule(trainSamples)
const picked = ofTheRule.filter(entry => entry.picked)
const describeOutcomes = (shares: readonly number[]) => shares.map((share, outcome) => ({share, outcome})).filter(({share}) => share >= 0.005).sort((left, right) => right.share - left.share).slice(0, 3).map(({share, outcome}) => `${outcomeNames[outcome]} ${(100 * share).toFixed(0)}%`).join(', ')
const codePointName = (codePoint: number) => `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}${codePoint > 0x20 && codePoint < 0x7f ? ` \`${String.fromCodePoint(codePoint).replace('`', '` ` `')}\`` : ''}`
print(`${ofTheRule.length} code points come at or after a first error in ${leastSamplesOfTheRule} train samples or more. The rule picks the ${picked.length} with a distance of ${leastDistanceOfTheRule} or more from the other code points of their class. The table has them and the 6 after them.`)
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
}).join(', ')}.`)
print()
print(`Picked by the rule and not chosen by hand: ${picked.filter(entry => !chosenByHand(entry.codePoint)).map(entry => codePointName(entry.codePoint)).join(', ')}.`)
const classesFromTrainSamples = classesChosenFromTrainSamples(trainSamples)
for (const key of ['none', 'classes-hand', 'classes-data', 'display', 'bit', 'all']) {
  const open = cellCounts(baseOf(additionsOf(settingOfKey(key), classesFromTrainSamples)))
  print(`- ${settingOfKey(key).name}: ${open.lexerOpen} open tokenizer cells of ${open.lexerCells}, ${open.grammarOpen} open grammar cells of ${open.grammarCells}, ${open.displayOpen} open display entries of ${open.displayEntries}.`)
}

// The rows that no trainer's setting changes: the hand-written tables and the number to beat, each also with its
// display entries set by a count.
const toBeat = numberToBeat()
const handwritten = baselines().at(-1)!
const counted = (name: string, tables: RecoveryTables, startedFrom: RecoveryTables): SettingResult => ({name, seeds: [], records: [recordOf(displayEntriesByCount(tables, trainSamples), openDisplayEntries(startedFrom))]})
const handTables = handwrittenTables().tables
const handwrittenCounted = counted('hand-written, then the open display entries by a count', handTables, asIsTables())
const toBeatCounted = counted('search from the hand-written tables, then the open display entries by a count', loadTablesOfThisDataset(numberToBeatFileOf(process.env['RECOVERY_SCRATCH']!)).tables, handTables)
// The search and the count in turns, for the orders that search-display.ts was run with. The random orders are a
// row when three of them or more were run, which a comparison needs.
const searchedInTurns = Object.values(settingNamesOfTheSearch).flatMap(name => {
  const folder = join(armFolderOf(armNameOfTheSearch), fileNameOf(name))
  return existsSync(folder) && readdirSync(folder).some(fileName => fileName.endsWith('.record.json')) ? [savedResultOf(armNameOfTheSearch, name)] : []
}).filter(result => result.seeds.length === 0 || result.seeds.length >= 3)
const withoutTrainer = [handwritten, handwrittenCounted, toBeat, toBeatCounted, ...searchedInTurns]

for (const trainerName of trainerNames) {
  print()
  print(`## The trainer's setting \`${trainerName}\`: ${describeTrainerSetting(trainerSettings[trainerName]!)}`)
  print()
  const control = savedOf(trainerName, settingOfKey('none'))!
  // A setting is reported when it was run with the seeds of the control, so that every row has the same seeds.
  const results = settingsOfTheArm.flatMap(setting => {
    const result = savedOf(trainerName, setting)
    return result === undefined || result.seeds.join(', ') !== control.seeds.join(', ') ? [] : [{setting, name: setting.name, result}]
  })
  const leftOut = settingsOfTheArm.filter(setting => !results.some(entry => entry.setting === setting))
  if (leftOut.length > 0) print(`Not run with the seeds of "no addition" and left out: ${leftOut.map(setting => setting.name).join('; ')}.`)
  print(`The seeds ${control.seeds.join(', ')}. A cell says "above" or "below" when its range does not overlap the range of the row "no addition".`)
  print()
  describeAgainstControl([...results, ...withoutTrainer.map(result => ({name: result.name, result}))], control)
  const runs = results.flatMap(({result}) => result.records)
  print()
  print(`The ground rules hold on the fixed texts for ${runs.filter(record => record.groundRules.hold).length} of the ${runs.length} runs.`)

  if (trainerName === 'plain') {
    // The control of the plain trainer is the run of ../plain-pass/, so its tables have to be that arm's tables.
    const plainPassName = 'one pass of the trainer from today\'s tables, defaults'
    const plainPassFolder = join(armFolderOf('plain-pass'), fileNameOf(plainPassName))
    const same = control.seeds.filter(seed => existsSync(join(plainPassFolder, `seed-${seed}.tables.json`))
      && tablesToJson(loadTablesOfThisDataset(join(plainPassFolder, `seed-${seed}.tables.json`)).tables) === tablesToJson(savedTablesOf(trainerName, settingOfKey('none'), seed)))
    print()
    print(`The tables of "no addition" are the tables that ../plain-pass/ saved, byte for byte, for ${same.length} of the ${control.seeds.length} seeds.`)
  }

  print()
  print('As `describeComparison` says it:')
  print()
  const compare = (first: SettingResult, second: SettingResult, rowNames: readonly (string | undefined)[]) => {
    for (const rowName of rowNames) if (rowName !== undefined) print(`- ${describeComparison(first, second, rowName)}`)
  }
  const resultOf = (key: string) => results.find(entry => entry.setting.key === key)?.result
  for (const {setting, result} of results.slice(1)) compare(result, control, ['all', 'group: within reach of the tables', ownGroupOf(setting)])
  const [hand, fromData, display, displayCounted, all, allFromData] = ['classes-hand', 'classes-data', 'display', 'display-counted', 'all', 'all-data'].map(resultOf)
  if (hand !== undefined && fromData !== undefined) compare(hand, fromData, ['all', 'group: within reach of the tables', groupRows[0]])
  if (all !== undefined && allFromData !== undefined) compare(all, allFromData, ['all', 'group: within reach of the tables', groupRows[0]])
  if (display !== undefined && displayCounted !== undefined) compare(display, displayCounted, ['all', 'group: within reach of the tables', groupRows[1]])
  // The target at the added code points was run with open display entries, so that setting is its control.
  if (display !== undefined) for (const {setting, result} of results) if (setting.errorTargetShare !== undefined && setting.displayEntries) compare(result, display, ['all', 'group: within reach of the tables'])
  for (const result of [display, all]) if (result !== undefined) compare(result, toBeat, ['all', 'group: within reach of the tables'])
  if (all !== undefined) compare(all, toBeatCounted, ['all', 'group: within reach of the tables'])
  for (const searched of searchedInTurns) for (const result of [display, all]) if (result !== undefined) compare(result, searched, ['all', 'group: within reach of the tables', groupRows[1]])

  print()
  print('The kinds of damage in which a setting\'s range of all three does not overlap the range of "no addition", from the largest gain to the largest loss, as the range of "no addition" and then the setting\'s:')
  print()
  for (const {name, result} of results.slice(1)) print(`- ${name}: ${kindsApart(result, control)}.`)

  if (!withCells) continue
  for (const key of ['classes-hand', 'classes-data']) {
    const result = resultOf(key)
    if (result === undefined) continue
    const scores = result.records.map(record => sharesOf(rowNamed(record, 'all')).allThree)
    const bestSeed = result.seeds[scores.indexOf(Math.max(...scores))]!
    print()
    print(`### The cells of the new classes: ${settingOfKey(key).name}, seed ${bestSeed}, the seed with the most of all three on the validation split`)
    print()
    describeClassCells(savedTablesOf(trainerName, settingOfKey(key), bestSeed), baseOf(additionsOf(settingOfKey(key), classesFromTrainSamples)))
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
  const sharesOfClass = (counts: Int32Array, characterClass: number, names: readonly string[], total: number) =>
    names.map((name, index) => ({name, count: counts[characterClass * names.length + index]!})).filter(({count}) => count / total >= 0.005).sort((left, right) => right.count - left.count).slice(0, 4)
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
