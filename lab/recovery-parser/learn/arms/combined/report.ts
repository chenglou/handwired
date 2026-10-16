// Every table of README.md and every comparison behind its sentences, from the records and the tables that run.ts
// saved. It trains nothing. A recipe that was not run yet is left out of its table.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/combined/report.ts [--candidates]
// --candidates also writes <RECOVERY_SCRATCH>/arms/combined/final-candidates.json: per candidate its name, its
// recipe in one sentence, and the saved tables of the seeds 1 to 5 and of the seeds 21 to 25, after a check that
// each file loads as tables of this dataset.
//
// What a table holds besides the scores, since the main number shows none of it:
// - code points of the validation texts that are shown as "past the end", as a count,
// - on valid JSON deeper than 16 levels, over the four forms of deep-valid.ts, as counts of code points: wrong
//   depths, display kinds other than today's, and display kinds that are not what the code point is, which today's
//   tables have too, since they show every key after the 17th bracket as a string,
// - the code points that the damage added and that are shown as an error, as a count.
// And next to the groups of the dataset, the two sources of the samples: typing replays and damaged documents.
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {groupNames, refuseUnknownOptions} from '../../data.ts'
import {type RecoveryTables, loadTablesOfThisDataset} from '../../recovery-tables.ts'
import {sharesOf} from '../../score.ts'
import {armNameOf, confirmationSeeds as seedsOfExtraFactsConfirmation, savedTablesOf, settingOfKey} from '../extra-facts/facts.ts'
import {type ArmRecord, type SettingResult, armFolderOf, baselineTables, baselines, describeComparison, numberToBeat, numberToBeatFileOf, percentSpread, rowNamed, savedResultOf, spreadOf} from '../harness.ts'
import {
  type Candidate, type Recipe, type Step, bestOfExtraFacts, candidates, confirmationSeeds, countOfCandidate, describeRecipe, fromHandWritten, generic, passesOfTheSearch, recipeWith, reportedSeeds,
  savedRecipeOf, savedTablesFileOf, searchOfCandidate, searchOrders, searched, shortNameOf, shownAsTodayOfCandidate, steps, trainingOfCandidate, tuningSeeds, withHandClasses,
} from './combined.ts'
import {countsOnTooDeepTexts, tooDeepForms} from './deep-valid.ts'

refuseUnknownOptions('arms/combined/report.ts', ['--candidates'])

// One row of a table: a setting's records, the tables of each, and a name per run, e.g. "11" for a seed.
type Row = {label: string, result: SettingResult, tables: RecoveryTables[], runs: string[]}

const withinReach = 'group: within reach of the tables'
const sources = ['typing', 'damage']
const print = (line = '') => console.log(line)

// What some tables do on the too deep valid texts, per form, counted once per tables.
const knownTooDeepCounts = new Map<RecoveryTables, ReturnType<typeof countsOnTooDeepTexts>[]>()
const tooDeepCounts = (tables: RecoveryTables) => {
  let counts = knownTooDeepCounts.get(tables)
  if (counts === undefined) {
    counts = tooDeepForms.map(form => countsOnTooDeepTexts(tables, form.texts))
    knownTooDeepCounts.set(tables, counts)
  }
  return counts
}
type TooDeepCount = 'wrongDepths' | 'kindsOtherThanTodays' | 'wrongKinds'
const onTooDeepTexts = (tables: RecoveryTables, count: TooDeepCount) => tooDeepCounts(tables).reduce((total, counts) => total + counts[count], 0)

// The rows that every table is read against.
const baselineRows = baselines()
const rowOfBaseline = (place: number, label: string): Row => ({label, result: {...baselineRows.at(place)!, name: label}, tables: [baselineTables().at(place)!.tables], runs: ['']})
const asItIs = rowOfBaseline(0, 'the parser as it is')
const handWritten = rowOfBaseline(-1, 'hand-written, 35 rules')
const toBeat: Row = {label: 'the number to beat', result: {...numberToBeat(), name: 'the number to beat'}, tables: [loadTablesOfThisDataset(numberToBeatFileOf(process.env['RECOVERY_SCRATCH']!)).tables], runs: ['']}

// A row of ../extra-facts/: its best setting with the trainer's setting three-base, for some of the seeds that it saved.
function rowOfExtraFacts(savedWith: readonly number[] | undefined, seeds: readonly number[], label: string): Row {
  const name = settingOfKey('all').name
  const arm = armNameOf('three-base', savedWith)
  const saved = savedResultOf(arm, name)
  const records = seeds.map(seed => saved.records[saved.seeds.indexOf(seed)]!)
  return {label, result: {name: label, seeds: [...seeds], records}, tables: seeds.map(seed => savedTablesOf(arm, name, seed)), runs: seeds.map(String)}
}
const bestOfExtraFactsReported = rowOfExtraFacts(undefined, reportedSeeds, 'the best row of extra-facts, seeds 1 to 5')
const bestOfExtraFactsConfirmed = rowOfExtraFacts(seedsOfExtraFactsConfirmation, seedsOfExtraFactsConfirmation, 'the best row of extra-facts, seeds 11 to 15')

// The row of a recipe of a step, or undefined when it was not run with the step's seeds.
function rowOf(step: Step, recipe: Recipe, label = shortNameOf(recipe)): Row | undefined {
  const result = savedRecipeOf(step, recipe)
  if (result === undefined) return undefined
  return {label, result: {...result, name: label}, tables: step.seeds.map(seed => loadTablesOfThisDataset(savedTablesFileOf(step.armName, recipe, seed)).tables), runs: step.seeds.map(String)}
}
// Several rows as one, e.g. the searches of three orders: every run of each.
const together = (label: string, rows: readonly Row[], runNames: readonly string[]): Row => ({
  label, result: {name: label, seeds: rows.flatMap(row => row.result.records).map((_, index) => index + 1), records: rows.flatMap(row => row.result.records)},
  tables: rows.flatMap(row => row.tables), runs: rows.flatMap((row, index) => row.runs.map(run => `${run} ${runNames[index]}`)),
})

const valuesOf = (row: Row, value: (record: ArmRecord) => number) => row.result.records.map(value)
// A difference in points with its sign, e.g. "+0.21".
const signed = (difference: number) => `${Number(difference.toFixed(2)) >= 0 ? '+' : ''}${difference.toFixed(2).replace(/^-0\.00$/, '0.00')}`
const shareOf = (rowName: string, share: 'allThree' | 'whole') => (record: ArmRecord) => sharesOf(rowNamed(record, rowName))[share]
const percents = (row: Row, rowName: string, share: 'allThree' | 'whole', digits = 2) => percentSpread(spreadOf(valuesOf(row, shareOf(rowName, share))), digits)
// A count over the runs: one number, or the mean with the lowest and the highest, and in how many runs it is not 0.
function counts(values: readonly number[]) {
  const spread = spreadOf(values)
  const withAny = values.filter(value => value > 0).length
  return `${spread.lowest === spread.highest ? spread.lowest : `${Math.round(spread.mean)} (${spread.lowest} to ${spread.highest})`}, ${withAny} of ${values.length}`
}
const pastEndOf = (row: Row) => valuesOf(row, record => record.shownAsPastEnd)
const onTooDeepTextsOfRow = (row: Row, count: TooDeepCount) => row.tables.map(tables => onTooDeepTexts(tables, count))
// A count over the runs without the runs that have any: the mean with the lowest and the highest.
const plainCounts = (values: readonly number[]) => counts(values).replace(/, \d+ of \d+$/, '')
const addedAsErrorOf = (row: Row) => valuesOf(row, record => rowNamed(record, 'all').addedShownAsError)
const addedCodePoints = rowNamed(asItIs.result.records[0]!, 'all').addedCodePoints

// The main table of some rows, then all three and whole samples per group and per source.
function printRows(rows: readonly Row[]) {
  print('| setting | runs | all three | all three, within reach | whole samples | whole samples, within reach | shown as past the end: code points, runs with any | wrong depths on too deep valid JSON: code points, runs with any | display kinds on too deep valid JSON other than today\'s: code points, runs with any | wrong display kinds on too deep valid JSON: code points | added code points shown as an error: code points, runs with any | cells changed against the base |')
  print('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const row of rows) {
    const changed = spreadOf(valuesOf(row, record => record.cellsChangedAgainstBase.total))
    print(`| ${row.label} | ${row.result.records.length} | ${percents(row, 'all', 'allThree')} | ${percents(row, withinReach, 'allThree')} | ${percents(row, 'all', 'whole')} | ${percents(row, withinReach, 'whole')} | ${counts(pastEndOf(row))} | ${counts(onTooDeepTextsOfRow(row, 'wrongDepths'))} | ${counts(onTooDeepTextsOfRow(row, 'kindsOtherThanTodays'))} | ${plainCounts(onTooDeepTextsOfRow(row, 'wrongKinds'))} | ${counts(addedAsErrorOf(row))} | ${changed.lowest === changed.highest ? changed.lowest : `${Math.round(changed.mean)} (${changed.lowest} to ${changed.highest})`} |`)
  }
  const groups = [...groupNames].reverse()
  const first = asItIs.result.records[0]!
  for (const share of ['allThree', 'whole'] as const) {
    print()
    print(`${share === 'allThree' ? 'All three' : 'Whole samples'} per group of the dataset, with the group's validation samples:`)
    print()
    print(`| setting | ${groups.map(group => `${group}, ${rowNamed(first, `group: ${group}`).samples}`).join(' | ')} |`)
    print(`| --- | ${groups.map(() => '---').join(' | ')} |`)
    for (const row of rows) print(`| ${row.label} | ${groups.map(group => percents(row, `group: ${group}`, share, 1)).join(' | ')} |`)
  }
  print()
  print('All three and whole samples per source of the samples, with the source\'s validation samples that have something to recover:')
  print()
  print(`| setting | ${sources.flatMap(source => ['all three', 'whole samples'].map(share => `${share}, ${source}, ${rowNamed(first, `source: ${source}`).samples - rowNamed(first, `source: ${source}`).nothingToRecover}`)).join(' | ')} |`)
  print(`| --- | ${sources.map(() => '--- | ---').join(' | ')} |`)
  for (const row of rows) print(`| ${row.label} | ${sources.flatMap(source => [percents(row, `source: ${source}`, 'allThree'), percents(row, `source: ${source}`, 'whole')]).join(' | ')} |`)
}

// One line per run of a row: what a mean hides when the runs fall into clusters.
function printRuns(rows: readonly Row[]) {
  const groups = [...groupNames].reverse().slice(1)
  print(`| setting | run | all three | all three, within reach | whole samples | whole samples, within reach | ${groups.map(group => `all three, ${group}`).join(' | ')} | ${sources.map(source => `all three, ${source} | whole samples, ${source}`).join(' | ')} | shown as past the end | too deep valid JSON, per form: wrong depths | the same: display kinds other than today's | the same: wrong display kinds | added code points shown as an error |`)
  print(`| --- | --- | --- | --- | --- | --- | ${groups.map(() => '---').join(' | ')} | ${sources.map(() => '--- | ---').join(' | ')} | --- | --- | --- | --- | --- |`)
  for (const row of rows) {
    row.result.records.forEach((record, index) => {
      const percent = (rowName: string, share: 'allThree' | 'whole', digits = 2) => (100 * shareOf(rowName, share)(record)).toFixed(digits)
      const perForm = (count: TooDeepCount) => tooDeepCounts(row.tables[index]!).map(counts => counts[count]).join(', ')
      print(`| ${row.label} | ${row.runs[index] === '' ? 'no seed' : row.runs[index]} | ${percent('all', 'allThree')} | ${percent(withinReach, 'allThree')} | ${percent('all', 'whole')} | ${percent(withinReach, 'whole')} | ${groups.map(group => percent(`group: ${group}`, 'allThree', 1)).join(' | ')} | ${sources.map(source => `${percent(`source: ${source}`, 'allThree')} | ${percent(`source: ${source}`, 'whole')}`).join(' | ')} | ${record.shownAsPastEnd} | ${perForm('wrongDepths')} | ${perForm('kindsOtherThanTodays')} | ${perForm('wrongKinds')} | ${rowNamed(record, 'all').addedShownAsError} |`)
    })
  }
}

// Two rows next to each other on one share of one row of the score: both ranges and whether they overlap. For two
// rows with the same runs, e.g. the same seeds, also the differences run by run. And how many runs of the row
// with the lower mean reach the range of the other.
function compare(first: Row, second: Row, rowName: string, share: 'allThree' | 'whole'): string {
  const [firstValues, secondValues] = [valuesOf(first, shareOf(rowName, share)), valuesOf(second, shareOf(rowName, share))]
  const [firstSpread, secondSpread] = [spreadOf(firstValues), spreadOf(secondValues)]
  const overlap = firstSpread.lowest <= secondSpread.highest && secondSpread.lowest <= firstSpread.highest
  const where = rowName === 'all' ? 'all validation samples' : rowName
  const sentences = [share === 'allThree' && first.result.records.length !== 2 && second.result.records.length !== 2 ? describeComparison(first.result, second.result, rowName)
    : `Whole samples, ${where}: ${JSON.stringify(first.label)} has ${percentSpread(firstSpread)} over ${firstValues.length} run${firstValues.length === 1 ? '' : 's'}, ${JSON.stringify(second.label)} has ${percentSpread(secondSpread)} over ${secondValues.length}. The means differ by ${signed(100 * (firstSpread.mean - secondSpread.mean))} points, and the two ranges ${overlap ? 'overlap, so these runs do not tell the two settings apart' : 'do not overlap'}.`]
  if (first.runs.length > 1 && first.runs.join('|') === second.runs.join('|')) {
    const differences = firstValues.map((value, index) => 100 * (value - secondValues[index]!))
    sentences.push(`Run by run, in the order of the seeds ${first.runs.join(', ')}: ${differences.map(signed).join(', ')}, so the first is above in ${differences.filter(difference => difference > 0).length} of ${differences.length}.`)
  }
  if (firstValues.length > 1 || secondValues.length > 1) {
    const [lower, higher, lowerValues] = firstSpread.mean < secondSpread.mean ? [first, secondSpread, firstValues] : [second, firstSpread, secondValues]
    sentences.push(`${lowerValues.filter(value => value >= higher.lowest).length} of the ${lowerValues.length} run${lowerValues.length === 1 ? '' : 's'} of ${JSON.stringify(lower.label)} reach the lowest run of the other.`)
  }
  return sentences.join(' ')
}
function printComparisons(first: Row, second: Row) {
  for (const share of ['allThree', 'whole'] as const) for (const rowName of ['all', withinReach]) print(`- ${compare(first, second, rowName, share)}`)
}

// What parts add, one line each: a row minus its control, in points, as the mean, then run by run against the
// control's run of the same seed, and whether the two ranges overlap.
function printParts(parts: readonly {label: string, row: Row | undefined, control: Row | undefined}[]) {
  print('| part | runs | all three | all three, within reach | whole samples |')
  print('| --- | --- | --- | --- | --- |')
  for (const {label, row, control} of parts) {
    if (row === undefined || control === undefined) continue
    const controlRunOf = row.runs.map(run => control.runs.indexOf(run.split(' ')[0]!))
    if (controlRunOf.includes(-1)) throw new Error(`${JSON.stringify(row.label)} has a run whose seed ${JSON.stringify(control.label)} does not have`)
    const added = (rowName: string, share: 'allThree' | 'whole') => {
      const [values, controlValues] = [valuesOf(row, shareOf(rowName, share)), valuesOf(control, shareOf(rowName, share))]
      const differences = values.map((value, index) => 100 * (value - controlValues[controlRunOf[index]!]!))
      const [spread, controlSpread] = [spreadOf(values), spreadOf(controlValues)]
      const overlap = spread.lowest <= controlSpread.highest && controlSpread.lowest <= spread.highest
      return `${signed(spreadOf(differences).mean)} (${differences.map(signed).join(', ')}), ${overlap ? 'the ranges overlap' : 'the ranges do not overlap'}`
    }
    print(`| ${label} | ${row.runs.length} against ${control.runs.length} | ${added('all', 'allThree')} | ${added(withinReach, 'allThree')} | ${added('all', 'whole')} |`)
  }
}

// A step's rows with its first recipe as the control of the others.
function printStep(title: string, note: string, rows: readonly (Row | undefined)[], control: Row | undefined = rows[0]) {
  const present = rows.filter(row => row !== undefined)
  print(`## ${title}`)
  print()
  print(note)
  print()
  if (present.length === 0 || control === undefined) {
    print('Not run.')
    print()
    return
  }
  printRows(present)
  print()
  for (const row of present) if (row !== control) printComparisons(row, control)
  print()
}

const stepOf = (name: string) => {
  const step = steps[name]
  if (step === undefined) throw new Error(`combined.ts has no step ${name}`)
  return step
}
const tuningRow = (recipe: Recipe) => rowOf(stepOf('kept'), recipe)
// The recipes of the search without the training and of the rows with the training that they are read against.
const untrained = recipeWith({passes: 0}, generic)
const searchedToTheEnd = (recipe: Recipe) => recipeWith({searchOrder: searchOrders[0]!}, recipe)
const counted = (recipe: Recipe) => recipeWith({displayByCount: true}, recipe)
const inTurns = (recipe: Recipe) => recipeWith({inTurns: true}, counted(searchedToTheEnd(recipe)))
const firstSearch = searched(generic)(searchOrders[0]!)
// The search after the training or without it, with the steps after it: the control of a row with the training is
// the row without it that has the same steps.
const stepsAfterTheSearch = [
  {name: `the search of at most ${passesOfTheSearch} passes`, withTraining: firstSearch, without: searched(untrained)(searchOrders[0]!), displayEntriesSet: false},
  {name: 'the search until a pass changes nothing', withTraining: searchedToTheEnd(generic), without: searchedToTheEnd(untrained), displayEntriesSet: false},
  {name: `the search of at most ${passesOfTheSearch} passes, then the count`, withTraining: counted(firstSearch), without: counted(searched(untrained)(searchOrders[0]!)), displayEntriesSet: true},
  {name: 'the search until a pass changes nothing, then the count', withTraining: counted(searchedToTheEnd(generic)), without: counted(searchedToTheEnd(untrained)), displayEntriesSet: true},
  {name: 'the search and the count in turns', withTraining: inTurns(generic), without: inTurns(untrained), displayEntriesSet: true},
]

print(`Dataset ${asItIs.result.records[0]!.datasetKey}, validation split of the standard set, the exact parser, percentages. A number with brackets is the mean of the runs, with the lowest and the highest. The damage added ${addedCodePoints} code points to the validation samples. The depths and the display kinds on too deep valid JSON are counted from the first error on, in four forms: ${tooDeepForms.map((form, index) => `${form.name} (${form.texts.length} texts, ${tooDeepCounts(asItIs.tables[0]!)[index]!.fromFirstError} code points)`).join(', ')}.`)
print()
print('## The rows that the arm is read against')
print()
printRows([asItIs, handWritten, toBeat, bestOfExtraFactsReported, bestOfExtraFactsConfirmed])
print()
printRuns([bestOfExtraFactsReported, bestOfExtraFactsConfirmed])
print()

// 1. The recipe without the losses.
{
  const controlOfHand = rowOfExtraFacts(seedsOfExtraFactsConfirmation, tuningSeeds, shortNameOf(bestOfExtraFacts))
  const [genericRow, genericControl, handRow] = [tuningRow(generic), tuningRow(recipeWith({tooDeepCells: 'trained', endEvents: 'allowed'}, generic)), tuningRow(withHandClasses)]
  printStep('1. The two kept settings', `The seeds ${tuningSeeds.join(', ')}. The control of a line is the same training without the two kept settings. For the classes chosen by hand that is the best row of ../extra-facts/, from the runs that it saved with these seeds.`, [genericRow, genericControl, handRow, controlOfHand])
  if (handRow !== undefined) printComparisons(handRow, controlOfHand)
  if (handRow !== undefined && genericRow !== undefined) printComparisons(handRow, genericRow)
  print()
  printRuns([genericRow, genericControl, handRow, controlOfHand].filter(row => row !== undefined))
  print()
}

// 2. What each part adds when the others are there.
{
  const parts = [
    {name: 'the classes from the train samples', recipe: recipeWith({classes: 'none'}, generic), group: 'needs a character class'},
    {name: 'the open display entries', recipe: recipeWith({displayEntries: false}, generic), group: 'needs a display fix'},
    {name: 'the bit', recipe: recipeWith({firstOnLineBit: false}, generic), group: 'needs a line rule'},
  ]
  const whole = tuningRow(generic)
  printStep('2. What each part adds when the others are there', `The seeds ${tuningSeeds.join(', ')}. Each row is the generic recipe without one of its three additions, and the control is the recipe with all three.`, [whole, ...parts.map(({recipe}) => tuningRow(recipe))])
  if (whole !== undefined) {
    print('What a part adds: the recipe with all three minus the recipe without the part, in points, as the mean and seed by seed.')
    print()
    print('| part | all three | all three, within reach | whole samples | all three in the part\'s group | the part\'s group |')
    print('| --- | --- | --- | --- | --- | --- |')
    for (const {name, recipe, group} of parts) {
      const without = tuningRow(recipe)
      if (without === undefined) continue
      const added = (rowName: string, share: 'allThree' | 'whole') => {
        const differences = valuesOf(whole, shareOf(rowName, share)).map((value, index) => 100 * (value - valuesOf(without, shareOf(rowName, share))[index]!))
        return `${signed(spreadOf(differences).mean)} (${differences.map(signed).join(', ')})`
      }
      print(`| ${name} | ${added('all', 'allThree')} | ${added(withinReach, 'allThree')} | ${added('all', 'whole')} | ${added(`group: ${group}`, 'allThree')} | ${group} |`)
    }
    print()
  }
}

// 3. The trainer.
printStep('3. The trainer', `The seeds ${tuningSeeds.join(', ')}. The control is the generic recipe, three passes.`, stepOf('trainer').recipes.map(tuningRow))

// 4. Spare states.
printStep('4. Spare states on top', `The seeds ${tuningSeeds.join(', ')}. The control is the generic recipe without a spare state.`, stepOf('spare-states').recipes.map(tuningRow))

// 5. A search after the training: how many passes it needs, then the search in three orders, and the same search
// without the training.
{
  const trained = tuningRow(generic)
  const untilNothingChanges = tuningRow(recipeWith({searchOrder: searchOrders[0]!}, generic))
  const limited = [2, 4].map(searchPasses => tuningRow(recipeWith({searchOrder: searchOrders[0]!, searchPasses}, generic)))
  printStep('5a. How many passes the search needs', `The seeds ${tuningSeeds.join(', ')}. The search of ../holes/restricted-search.ts goes over the cells that the recipe may change, from the trained tables, in its first order. The control is the search that ends by a pass that changes nothing.`, [untilNothingChanges, ...limited, trained])
  const orderNames = searchOrders.map(order => `order ${order}`)
  const searchedRows = searchOrders.map(order => tuningRow(searched(generic)(order)))
  const searchedThenCounted = tuningRow(counted(firstSearch))
  const everySearch = searchedRows.every(row => row !== undefined) ? together(`generic, then searched, the three orders`, searchedRows, orderNames) : undefined
  printStep('5b. The search in three orders', `The seeds ${tuningSeeds.join(', ')}. The search of at most ${passesOfTheSearch} passes, in three orders per seed.`, [trained, ...searchedRows, everySearch, searchedThenCounted])
  if (searchedThenCounted !== undefined && searchedRows[0] !== undefined) printComparisons(searchedThenCounted, searchedRows[0])
  print()
  print('## 5c. The search without the training')
  print()
  print(`The seeds ${tuningSeeds.join(', ')}. The search from today's tables with the recipe's additions, over the same cells: there a seed only draws the order, and it draws the order of the search after the training of the same seed. The search sets no display entry, so after the search alone the tables hold today's display table, where the trained tables hold trained entries. The count after the search, and the search and the count in turns, set the entries without gradients. A row with the training is compared with the row without it that has the same steps.`)
  print()
  const rowsOfTheSteps = stepsAfterTheSearch.map(({name, withTraining, without}) => ({withTraining: tuningRow(withTraining), without: tuningRow(without), name}))
  const presentOfTheSteps = rowsOfTheSteps.flatMap(({withTraining, without}) => [without, withTraining]).filter(row => row !== undefined)
  if (presentOfTheSteps.length === 0) {
    print('Not run.')
  } else {
    printRows([toBeat, ...(trained === undefined ? [] : [trained]), ...presentOfTheSteps])
    print()
    for (const {withTraining, without} of rowsOfTheSteps) if (withTraining !== undefined && without !== undefined) printComparisons(without, withTraining)
    // The strongest control without gradients against the number to beat and against the training alone.
    const strongest = rowsOfTheSteps.at(-1)!.without
    if (strongest !== undefined) for (const other of [toBeat, ...(trained === undefined ? [] : [trained])]) printComparisons(strongest, other)
    print()
    printRuns([trained, untilNothingChanges, ...limited, ...searchedRows, ...presentOfTheSteps].filter(row => row !== undefined).filter((row, index, rows) => rows.findIndex(other => other.label === row.label) === index))
  }
  print()
}

// 6. The search that counts whole samples first.
{
  const searchedRows = searchOrders.map(order => tuningRow(searched(generic)(order)))
  const forWhole = searchOrders.map(order => tuningRow(recipeWith({searchCounts: 'whole samples'}, searched(generic)(order))))
  printStep('6. A search that counts whole samples first', `The seeds ${tuningSeeds.join(', ')}. The control is the generic recipe without a search. A search for whole samples and the search for code points of the same order go over the cells in the same order, in at most ${passesOfTheSearch} passes.`, [tuningRow(generic), ...forWhole, ...searchedRows])
  forWhole.forEach((row, index) => {
    const control = searchedRows[index]
    if (row !== undefined && control !== undefined) printComparisons(row, control)
  })
  print()
  printRuns([...forWhole, ...searchedRows].filter(row => row !== undefined))
  print()
}

// 7. The hand-written tables as the base.
printStep('7. The hand-written tables as the base', `The seeds ${tuningSeeds.join(', ')}. The control is the same recipe from today's tables, with the classes chosen by hand. The row without a training is the hand-written tables with the additions and no cell changed: one tables, whatever the seed.`, [...stepOf('hand-written').recipes.map(tuningRow), handWritten])

// 8. The third kept setting.
printStep('8. Today\'s kinds in the display entries of the state `error`', `The seeds ${tuningSeeds.join(', ')}. The generic recipe with its search of at most ${passesOfTheSearch} passes and its count, and the same with today's kinds in the display entries of the grammar state \`error\` as the last step. The control is the recipe without that step.`, stepOf('shown-as-today').recipes.map(tuningRow))

// 9. The target that shows added code points as an error, on the first candidate, and the candidates.
{
  const reported = stepOf('candidates')
  const confirmation = stepOf('confirmation')
  const rowsOf = (step: Step, seedsName: string) => candidates.map(({name, recipe}) => rowOf(step, recipe, `${name}, seeds ${seedsName}`))
  const [reportedRows, confirmationRows] = [rowsOf(reported, '1 to 5'), rowsOf(confirmation, '21 to 25')]
  const [target, targetThenSearched] = stepOf('error-target').recipes.map(recipe => rowOf(stepOf('error-target'), recipe))
  const [trainingOfGeneric, searchOfGeneric] = [rowOf(reported, trainingOfCandidate(candidates[0]!)), rowOf(reported, searchOfCandidate(candidates[0]!))]
  printStep('9. Added code points as an error at the weight 0.1', `The seeds ${reportedSeeds.join(', ')}. The target on the training of the first candidate, and with the candidate's search after it. The control of each is the same recipe without the target, with the same seeds. No row has the count as its last step.`, [trainingOfGeneric, target, searchOfGeneric, targetThenSearched])
  if (targetThenSearched !== undefined && searchOfGeneric !== undefined) printComparisons(targetThenSearched, searchOfGeneric)
  print()

  print('## The candidates')
  print()
  print(`Each candidate ran once with the seeds ${reportedSeeds.join(', ')} and once with the seeds ${confirmationSeeds.join(', ')}, which nothing had used. The last step of the two candidates from today's tables, today's kinds in the display entries of the state \`error\`, came after a review of their first scores: the rows "then the count" are what was scored first.`)
  print()
  for (const {name, description} of candidates) print(`- ${name}: ${description}`)
  print()
  // A candidate's recipe step by step, as rows of one step of the arm. The fourth row is the candidate itself for
  // the two lines from today's tables, and for the third line what the setting would cost.
  const stagesOf = (step: Step, candidate: Candidate, seedsName: string) => [
    {recipe: trainingOfCandidate(candidate), name: 'the training alone'}, {recipe: searchOfCandidate(candidate), name: 'then searched'},
    {recipe: countOfCandidate(candidate), name: 'then the count'}, {recipe: shownAsTodayOfCandidate(candidate), name: 'then today\'s kinds in the state error'},
  ].map(({recipe, name}) => rowOf(step, recipe, `${candidate.name}, ${name}${describeRecipe(recipe) === describeRecipe(candidate.recipe) ? ', the candidate' : ''}, seeds ${seedsName}`))
  const present = [...reportedRows, ...confirmationRows].filter(row => row !== undefined)
  if (present.length === 0) {
    print('Not run.')
  } else {
    printRows([handWritten, toBeat, bestOfExtraFactsReported, bestOfExtraFactsConfirmed, ...present])
    print()
    printRuns([handWritten, toBeat, ...present])
    print()
    for (const row of present) {
      for (const other of [handWritten, toBeat, row.label.endsWith('1 to 5') ? bestOfExtraFactsReported : bestOfExtraFactsConfirmed]) printComparisons(row, other)
    }
    // The candidates against each other, with the same seeds.
    for (const rows of [reportedRows, confirmationRows]) {
      for (let first = 0; first < rows.length; first++) for (let second = first + 1; second < rows.length; second++) if (rows[first] !== undefined && rows[second] !== undefined) printComparisons(rows[second]!, rows[first]!)
    }
    print()
    print('The candidates in the samples of typing replays, in the damaged documents and in the group "out of reach", against the hand-written tables and the number to beat:')
    print()
    for (const row of present) {
      for (const other of [handWritten, toBeat]) for (const rowName of ['source: typing', 'source: damage', 'group: out of reach']) for (const share of ['allThree', 'whole'] as const) print(`- ${compare(row, other, rowName, share)}`)
    }
    print()
    print('How many runs of a candidate, of both sets of seeds, are below a row that it is read against:')
    print()
    candidates.forEach((candidate, place) => {
      const runs = [reportedRows[place], confirmationRows[place]].filter(row => row !== undefined)
      const below = (other: Row, rowName: string, share: 'allThree' | 'whole') => {
        const highestOfOther = spreadOf(valuesOf(other, shareOf(rowName, share))).highest
        return runs.flatMap(row => valuesOf(row, shareOf(rowName, share))).filter(value => value < highestOfOther).length
      }
      const runCount = runs.reduce((total, row) => total + row.runs.length, 0)
      for (const rowName of ['all', 'source: typing', 'source: damage', 'group: out of reach']) {
        print(`- ${candidate.name}, ${rowName === 'all' ? 'all validation samples' : rowName}, ${runCount} runs: in all three ${below(handWritten, rowName, 'allThree')} are below the hand-written tables and ${below(toBeat, rowName, 'allThree')} below the number to beat, in whole samples ${below(handWritten, rowName, 'whole')} and ${below(toBeat, rowName, 'whole')}.`)
      }
      print(`- ${candidate.name}, all validation samples, ${runCount} runs: in all three ${below(bestOfExtraFactsReported, 'all', 'allThree')} are below the highest run of the best row of extra-facts with the seeds 1 to 5 and ${below(bestOfExtraFactsConfirmed, 'all', 'allThree')} below its highest run with the seeds 11 to 15.`)
    })
    print()
    print('Each step of a candidate against the candidate without the step, with the same seeds:')
    print()
    for (const [step, seedsName] of [[reported, '1 to 5'], [confirmation, '21 to 25']] as const) {
      for (const candidate of candidates) {
        const stages = stagesOf(step, candidate, seedsName)
        for (let stage = 1; stage < stages.length; stage++) if (stages[stage] !== undefined && stages[stage - 1] !== undefined) printComparisons(stages[stage]!, stages[stage - 1]!)
      }
    }
    print()
    printRows([[reported, '1 to 5'] as const, [confirmation, '21 to 25'] as const].flatMap(([step, seedsName]) => candidates.flatMap(candidate => stagesOf(step, candidate, seedsName))).filter(row => row !== undefined))
  }
  print()

  // Every part in one table: on the tuning seeds first, then the parts that the candidates' runs tell.
  const whole = tuningRow(generic)
  const untilNothingChanges = tuningRow(recipeWith({searchOrder: searchOrders[0]!}, generic))
  const searchedRows = searchOrders.map(order => tuningRow(searched(generic)(order)))
  const forWhole = searchOrders.map(order => tuningRow(recipeWith({searchCounts: 'whole samples'}, searched(generic)(order))))
  const orderNames = searchOrders.map(order => `order ${order}`)
  const handClasses = tuningRow(withHandClasses)
  print('## What each part adds, in one table')
  print()
  print(`The seeds ${tuningSeeds.join(', ')}: a row with the part minus the same recipe without it.`)
  print()
  printParts([
    {label: 'the two kept settings, generic', row: whole, control: tuningRow(recipeWith({tooDeepCells: 'trained', endEvents: 'allowed'}, generic))},
    {label: 'the two kept settings, with the classes chosen by hand', row: handClasses, control: rowOfExtraFacts(seedsOfExtraFactsConfirmation, tuningSeeds, 'the best row of extra-facts')},
    {label: 'the classes from the train samples', row: whole, control: tuningRow(recipeWith({classes: 'none'}, generic))},
    {label: 'the open display entries', row: whole, control: tuningRow(recipeWith({displayEntries: false}, generic))},
    {label: 'the bit', row: whole, control: tuningRow(recipeWith({firstOnLineBit: false}, generic))},
    {label: 'the classes chosen by hand in place of the rule\'s', row: handClasses, control: whole},
    {label: 'three passes in place of one', row: whole, control: tuningRow(recipeWith({passes: 1}, generic))},
    {label: 'five passes in place of three', row: tuningRow(recipeWith({passes: 5}, generic)), control: whole},
    {label: 'the display entries by a count as the last step', row: tuningRow(counted(generic)), control: whole},
    {label: '4 spare tokenizer states', row: tuningRow(recipeWith({spareTokenizerStates: 4}, generic)), control: whole},
    {label: '2 spare grammar states', row: tuningRow(recipeWith({spareGrammarStates: 2}, generic)), control: whole},
    {label: 'a search after the training until a pass changes nothing, the first order', row: untilNothingChanges, control: whole},
    ...[2, 4].map(searchPasses => ({label: `the search stopped after ${searchPasses} passes, against the search until a pass changes nothing`, row: tuningRow(recipeWith({searchOrder: searchOrders[0]!, searchPasses}, generic)), control: untilNothingChanges})),
    ...stepsAfterTheSearch.map(({name, withTraining, without, displayEntriesSet}) => ({label: `the training before ${name}: with the training minus without it${displayEntriesSet ? '' : ', where the control\'s display entries were never set'}`, row: tuningRow(withTraining), control: tuningRow(without)})),
    {label: `a search of at most ${passesOfTheSearch} passes after the training, three orders`, row: searchedRows.every(row => row !== undefined) ? together('searched', searchedRows, orderNames) : undefined, control: whole},
    {label: 'the display entries by a count after the search of the first order', row: tuningRow(counted(firstSearch)), control: searchedRows[0]},
    {label: 'today\'s kinds in the display entries of the state error as the last step', row: tuningRow(recipeWith({todaysKindsInErrorState: true}, counted(firstSearch))), control: tuningRow(counted(firstSearch))},
    ...searchOrders.map((order, index) => ({label: `the search counts whole samples first, order ${order}`, row: forWhole[index], control: searchedRows[index]})),
    {label: 'the hand-written tables as the base, three passes', row: tuningRow(fromHandWritten), control: handClasses},
    {label: 'the hand-written tables as the base, one pass', row: tuningRow(recipeWith({passes: 1}, fromHandWritten)), control: handClasses},
  ])
  print()
  for (const [step, seedsName] of [[reported, '1 to 5'], [confirmation, '21 to 25']] as const) {
    const [genericRow, handRow, handWrittenRow] = candidates.map(candidate => rowOf(step, candidate.recipe))
    const rowsOfStage = (stage: (candidate: Candidate) => Recipe) => candidates.map(candidate => rowOf(step, stage(candidate)))
    const [trainings, searches, countedRows, shownAsTodayRows] = [rowsOfStage(trainingOfCandidate), rowsOfStage(searchOfCandidate), rowsOfStage(countOfCandidate), rowsOfStage(shownAsTodayOfCandidate)]
    print(`The seeds ${seedsName}, the candidates:`)
    print()
    printParts([
      {label: 'the classes chosen by hand in place of the rule\'s', row: handRow, control: genericRow},
      {label: 'the hand-written tables as the base, against the same recipe from today\'s tables, both without today\'s kinds in the state error', row: handWrittenRow, control: countedRows[1]},
      ...candidates.map((candidate, index) => ({label: `the search after the training, ${candidate.name}`, row: searches[index], control: trainings[index]})),
      ...candidates.map((candidate, index) => ({label: `the display entries by a count after the search, ${candidate.name}`, row: countedRows[index], control: searches[index]})),
      ...candidates.map((candidate, index) => ({label: `today's kinds in the display entries of the state error as the last step, ${candidate.name}`, row: shownAsTodayRows[index], control: countedRows[index]})),
      ...(step === reported ? [
        {label: 'added code points as an error at the weight 0.1, generic, the training alone', row: target, control: trainings[0]},
        {label: 'added code points as an error at the weight 0.1, generic, the training and the search', row: targetThenSearched, control: searches[0]},
      ] : []),
    ])
    print()
  }

  // Every saved run of the arm with the two kept settings, counted once, by the tables that it started from: the
  // kept cells hold the base's choices, and only today's tables as the base keep the depth of every too deep text.
  for (const start of ['today', 'hand-written'] as const) {
    const seen = new Set<string>()
    const kept = {runs: 0, withPastEnd: 0, withWrongDepth: 0, shownAsToday: 0, shownAsTodayWithOtherKinds: 0, othersWithOtherKinds: 0}
    for (const step of Object.values(steps)) {
      for (const recipe of step.recipes) {
        const key = `${step.armName}, ${describeRecipe(recipe)}`
        if (seen.has(key) || recipe.start !== start || recipe.tooDeepCells !== 'kept' || recipe.endEvents !== 'ruled out') continue
        seen.add(key)
        const row = rowOf(step, recipe)
        if (row === undefined) continue
        const withOtherKinds = onTooDeepTextsOfRow(row, 'kindsOtherThanTodays').filter(count => count > 0).length
        kept.runs += row.tables.length
        kept.withPastEnd += pastEndOf(row).filter(count => count > 0).length
        kept.withWrongDepth += onTooDeepTextsOfRow(row, 'wrongDepths').filter(count => count > 0).length
        if (recipe.todaysKindsInErrorState) {
          kept.shownAsToday += row.tables.length
          kept.shownAsTodayWithOtherKinds += withOtherKinds
        } else {
          kept.othersWithOtherKinds += withOtherKinds
        }
      }
    }
    print(`Of the ${kept.runs} saved runs of the arm from ${start === 'today' ? 'today\'s tables' : 'the hand-written tables'} with the two kept settings, ${kept.withPastEnd} show a code point as past the end, and ${kept.withWrongDepth} have a wrong depth on too deep valid JSON in one of the four forms. ${kept.shownAsToday} of them have today's kinds in the state \`error\` as their last step, and ${kept.shownAsTodayWithOtherKinds} of those show a code point of such a text otherwise than today's tables. Of the other ${kept.runs - kept.shownAsToday}, ${kept.othersWithOtherKinds} do.`)
    print()
  }

  if (process.argv.includes('--candidates')) {
    const filesOf = (step: Step, recipe: Recipe) => step.seeds.map(seed => {
      const file = savedTablesFileOf(step.armName, recipe, seed)
      loadTablesOfThisDataset(file)
      return file
    })
    const file = join(armFolderOf('combined'), 'final-candidates.json')
    writeFileSync(file, `${JSON.stringify(candidates.map(({name, description, recipe}) => ({name, description, tables: filesOf(reported, recipe), confirmationTables: filesOf(confirmation, recipe)})), null, 1)}\n`)
    print(`Wrote ${file}: ${candidates.length} candidates, each with ${reported.seeds.length} and ${confirmation.seeds.length} files of tables that load as tables of this dataset.`)
  }
}
