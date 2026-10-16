// The tables of README.md of the arm "generic" and the sentences of every comparison that the README makes, from
// the runs that run.ts saved. It trains nothing: it reads the saved records.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after run.ts ran the steps, and
// after ../plain-pass/run.ts and the two commands that make the number to beat. A few seconds:
//   bun lab/recovery-parser/learn/arms/generic/report.ts [--step passes-and-start]
// Without --step it reports every step of generic.ts. A recipe that was not run yet is named and left out.
//
// First the hand-written tables and the number to beat. Then the tuning: every recipe that was tried, once, in one
// table, and per step each recipe against the step's control. Then the reported runs, which the two reported steps
// make: next to the hand-written tables, the number to beat and the plain pass, per group against the hand-written
// tables, seed by seed, and each against its control. Every comparison is a sentence with both ranges and whether
// they overlap, on all three and on whole samples.
import {groupNames, optionOf, refuseUnknownOptions} from '../../data.ts'
import {sharesOf} from '../../score.ts'
import {type ArmRecord, type SettingResult, type Spread, baselines, describeComparison, describeSettings, numberToBeat, percentSpread, rowNamed, savedResultOf, spreadOf} from '../harness.ts'
import {type Recipe, type Step, bestOnTheStandardSet, bestRecipe, bestThenSearched, describeRecipe, reportedSteps, savedRecipeOf, searchOrders, searchedWithoutTraining, tuningSteps} from './generic.ts'

refuseUnknownOptions('arms/generic/report.ts', ['--step'])
const onlyStep = optionOf('--step')
const stepNames = [...Object.keys(tuningSteps), ...Object.keys(reportedSteps)]
if (onlyStep !== undefined && !stepNames.includes(onlyStep)) throw new Error(`arms/generic/report.ts takes --step with one of ${stepNames.join(', ')}, and got ${onlyStep}`)

const withinReach = 'group: within reach of the tables'
// The rows of the score per group, starting with the group that is within reach of the tables.
const groupRows = [...groupNames].reverse().map(group => `group: ${group}`)
const over = (result: SettingResult, value: (record: ArmRecord) => number) => spreadOf(result.records.map(value))
const allThree = (rowName: string) => (record: ArmRecord) => sharesOf(rowNamed(record, rowName)).allThree
const whole = (rowName: string) => (record: ArmRecord) => sharesOf(rowNamed(record, rowName)).whole
const count = (spread: Spread) => spread.lowest === spread.highest ? String(Math.round(spread.mean)) : `${Math.round(spread.mean)} (${spread.lowest} to ${spread.highest})`
const percent = (share: number, digits = 2) => (100 * share).toFixed(digits)
// In how many of a setting's runs a count is above 0, e.g. "2 of 3".
const runsWith = (result: SettingResult, value: (record: ArmRecord) => number) => `${result.records.filter(record => value(record) > 0).length} of ${result.records.length}`
const wrongDepth = (record: ArmRecord) => Math.max(record.wrongDepthsOnDeepValidJson.nothingAfter, record.wrongDepthsOnDeepValidJson.membersAfter)

// A saved recipe as a row of the report. The best recipe's name is long, e.g. "1 pass, uniform start, too deep cells
// kept, no event of a text's end, 4 times the samples, then searched, order 1", so the report writes "the best
// recipe" for that part of a name.
const nameOfTheBestRecipe = describeRecipe(bestRecipe)
const rowOf = (result: SettingResult): SettingResult => ({...result, name: result.name.replace(nameOfTheBestRecipe, 'the best recipe')})
const savedRowOf = (step: Step, recipe: Recipe): SettingResult | undefined => {
  const saved = savedRecipeOf(step, recipe)
  return saved === undefined ? undefined : rowOf(saved)
}

// One row per setting: the two rows of the main number, whole samples in the same two rows, and what no score shows.
function describeRows(results: readonly SettingResult[]): string {
  return [
    '| setting | all three | all three, within reach | whole samples | whole samples, within reach | cells changed against the base | shown as past the end: code points, runs | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers and members after, runs |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(result => `| ${result.name} | ${percentSpread(over(result, allThree('all')))} | ${percentSpread(over(result, allThree(withinReach)))} | ${percentSpread(over(result, whole('all')))} | ${percentSpread(over(result, whole(withinReach)))} | ${count(over(result, record => record.cellsChangedAgainstBase.total))} | ${count(over(result, record => record.shownAsPastEnd))}, ${runsWith(result, record => record.shownAsPastEnd)} | ${percent(over(result, record => record.wrongDepthsOnDeepValidJson.nothingAfter).mean, 1)} and ${percent(over(result, record => record.wrongDepthsOnDeepValidJson.membersAfter).mean, 1)}, ${runsWith(result, wrongDepth)} |`),
  ].join('\n')
}

// Two settings on whole samples, with both ranges and whether they overlap, as describeComparison says it for the
// main number.
function describeWholeSamples(first: SettingResult, second: SettingResult, rowName = 'all'): string {
  const [firstSpread, secondSpread] = [over(first, whole(rowName)), over(second, whole(rowName))]
  const overlap = firstSpread.lowest <= secondSpread.highest && secondSpread.lowest <= firstSpread.highest
  const difference = 100 * (firstSpread.mean - secondSpread.mean)
  const describe = (result: SettingResult, spread: Spread) => `${JSON.stringify(result.name)} has ${percentSpread(spread)}${result.seeds.length === 0 ? ' and no seed' : ` over ${result.seeds.length} seeds`}`
  return `Whole samples, ${rowName === 'all' ? 'all validation samples' : rowName}: ${describe(first, firstSpread)}, ${describe(second, secondSpread)}. The means differ by ${difference >= 0 ? '+' : ''}${difference.toFixed(2)} points, and the two ranges ${overlap ? 'overlap, so these seeds do not tell the two settings apart' : 'do not overlap'}.`
}

// Prints a setting against another one: the main number and whole samples, on all samples and within reach, or on
// the rows that are named.
function printAgainst(result: SettingResult, other: SettingResult, rowNames: readonly string[] = ['all', withinReach]) {
  console.log(`${JSON.stringify(result.name)} against ${JSON.stringify(other.name)}:`)
  for (const describe of [describeComparison, describeWholeSamples]) for (const rowName of rowNames) console.log(`- ${describe(result, other, rowName)}`)
  console.log('')
}

// In how many runs a share is above the one number of a setting without a seed, and in how many below, e.g.
// "13 above, 2 below".
function runsAgainst(runs: readonly ArmRecord[], other: SettingResult, value: (record: ArmRecord) => number): string {
  const reference = value(other.records[0]!)
  return `${runs.filter(record => value(record) > reference).length} above, ${runs.filter(record => value(record) < reference).length} below`
}

// How many runs of a setting reach the range of another one: the runs with the other's lowest number or more.
function runsReaching(result: SettingResult, other: SettingResult, value: (record: ArmRecord) => number): string {
  const lowest = over(other, value).lowest
  return `${result.records.filter(record => value(record) >= lowest).length} of ${JSON.stringify(result.name)} have the lowest number of ${JSON.stringify(other.name)} or more`
}

// The group in which a search can lose nearly every whole sample for one wrong code point per sample.
const lineRule = 'group: needs a line rule'

// In how many runs of some searches fewer than half of the samples of that group are whole, and the whole samples
// of those runs and of the other runs on all samples.
function describeLineRuleLoss(result: SettingResult): string {
  const wholeOf = (lost: boolean) => {
    const runs = result.records.filter(record => (whole(lineRule)(record) < 0.5) === lost).map(whole('all'))
    return runs.length === 0 ? 'none' : `${percent(Math.min(...runs))} to ${percent(Math.max(...runs))}`
  }
  return `In ${result.records.filter(record => whole(lineRule)(record) < 0.5).length} of ${JSON.stringify(result.name)} fewer than half of the samples of the group "needs a line rule" are whole. Whole samples on all samples of those runs: ${wholeOf(true)}. Of the other runs: ${wholeOf(false)}.`
}

// Prints the searches of some settings seed by seed, one column per setting, e.g. the orders of a search next to
// the training that they start from: on all samples, and in the group "needs a line rule".
function printSeeds(results: readonly SettingResult[]) {
  for (const [title, value] of [['All three on all validation samples', allThree('all')], ['Whole samples', whole('all')], ['Whole samples in the group "needs a line rule"', whole(lineRule)], ['All three in the group "needs a line rule"', allThree(lineRule)]] as const) {
    console.log(`${title}, seed by seed:`)
    console.log('')
    console.log(`| seed | ${results.map(result => result.name).join(' | ')} |`)
    console.log(`| --- | ${results.map(() => '---').join(' | ')} |`)
    results[0]!.seeds.forEach((seed, index) => console.log(`| ${seed} | ${results.map(result => percent(value(result.records[index]!))).join(' | ')} |`))
    console.log('')
  }
}

// Several settings as one, e.g. the three orders of a search with 5 seeds each as 15 searches. The seed of a run is
// then the seed of its order, as buildRecipe draws it.
const together = (name: string, results: readonly SettingResult[]): SettingResult => ({name, seeds: results.flatMap((result, index) => result.seeds.map(seed => seed * 10 + searchOrders[index]!)), records: results.flatMap(result => result.records)})

// How far the orders of a search are apart within a seed, and what each search changes against the tables that it
// started from, in points: the lowest and the highest over the seeds and the orders.
function describeOrders(start: SettingResult, searched: readonly SettingResult[], valueName: string, value: (record: ArmRecord) => number): string {
  const apart = start.seeds.map((_, index) => {
    const ofOrders = searched.map(result => 100 * value(result.records[index]!))
    return Math.max(...ofOrders) - Math.min(...ofOrders)
  })
  const changes = searched.flatMap(result => result.records.map((record, index) => 100 * (value(record) - value(start.records[index]!))))
  const signed = (points: number) => `${points >= 0 ? '+' : ''}${points.toFixed(2)}`
  return `${valueName}: the ${searched.length} orders of a seed are ${Math.min(...apart).toFixed(2)} to ${Math.max(...apart).toFixed(2)} points apart, and the ${changes.length} searches change their seed's number by ${signed(Math.min(...changes))} to ${signed(Math.max(...changes))} points, ${changes.filter(change => change > 0).length} of them upward.`
}

const toBeat = numberToBeat()
const handwritten = baselines().at(-1)!
const references = [handwritten, toBeat]
console.log('## The two rows that every step is read against')
console.log('')
console.log(describeRows(references))
console.log('')

// The tuning.
const tuningStepsToReport = Object.entries(tuningSteps).filter(([stepName]) => onlyStep === undefined || stepName === onlyStep)
if (onlyStep === undefined) {
  const tried = new Map<string, SettingResult>()
  for (const step of Object.values(tuningSteps)) {
    for (const recipe of step.recipes) {
      const saved = savedRowOf(step, recipe)
      if (saved !== undefined) tried.set(saved.name, saved)
    }
  }
  console.log(`## The tuning: the ${tried.size} recipes that were tried, each once, in the order of the steps`)
  console.log('')
  console.log(describeRows([...tried.values()]))
  console.log('')
}
for (const [stepName, step] of tuningStepsToReport) {
  const results: SettingResult[] = []
  const notRun: string[] = []
  for (const recipe of step.recipes) {
    const saved = savedRowOf(step, recipe)
    if (saved === undefined) notRun.push(describeRecipe(recipe))
    else results.push(saved)
  }
  console.log(`## The step ${stepName}, seeds ${step.seeds.join(', ')}`)
  console.log('')
  if (notRun.length > 0) console.log(`Not run yet: ${notRun.join('; ')}.\n`)
  if (results.length === 0) continue
  console.log(describeRows(results))
  console.log('')
  results.forEach((result, place) => {
    for (const other of step.everyPair === true ? results.slice(0, place) : results.slice(0, Math.min(place, 1))) printAgainst(result, other)
  })
  // A step with a search: the orders next to the training that they start from.
  const [start, ...searched] = results as [SettingResult, ...SettingResult[]]
  if (step.recipes.some(recipe => recipe.searchOrder !== undefined) && searched.length > 0) {
    printSeeds(results)
    console.log(describeOrders(start, searched, 'All three on all validation samples', allThree('all')))
    console.log(describeOrders(start, searched, 'Whole samples', whole('all')))
    console.log(describeLineRuleLoss(together(`the ${searched.length * step.seeds.length} searches`, searched)))
    console.log('')
  }
}

// What the main number does not show, counted over some runs.
function describeWhatNoScoreShows(name: string, runs: readonly ArmRecord[]): string {
  const addedAsError = spreadOf(runs.map(record => record.addedShownAsError))
  return `What the main number does not show, over ${name}: ${runs.filter(record => wrongDepth(record) > 0).length} have a wrong depth on valid JSON of 17 to 19 levels, ${runs.filter(record => record.shownAsPastEnd > 0).length} show a code point as past the end, ${runs.filter(record => !record.groundRules.hold).length} break the ground rules on the fixed texts, and ${percent(addedAsError.lowest, 1)}% to ${percent(addedAsError.highest, 1)}% of the added code points are shown as an error.`
}

// The reported runs: the best recipe without and with its search, and its two controls, the search without the
// training and the training on the standard set.
function reportTheReportedRuns() {
  const step = reportedSteps['reported']!
  const reported = (recipe: Recipe) => savedRowOf(step, recipe)
  console.log(`## The reported runs, seeds ${step.seeds.join(', ')}`)
  console.log('')
  const notRun = Object.values(reportedSteps).flatMap(reportedStep => reportedStep.recipes).filter(recipe => reported(recipe) === undefined)
  if (notRun.length > 0) {
    console.log(`Not run yet: ${notRun.map(describeRecipe).join('; ')}.`)
    return
  }
  const trained = reported(bestRecipe)!
  const searched = bestThenSearched.map(recipe => reported(recipe)!)
  const withoutTraining = searchedWithoutTraining.map(recipe => reported(recipe)!)
  const onTheStandardSet = reported(bestOnTheStandardSet)!
  const plainPassOfTheSeeds = savedResultOf('plain-pass', 'one pass of the trainer from today\'s tables, defaults')
  const everySearch = together(`the ${searched.length * trained.seeds.length} searches from the trained tables`, searched)
  const everySearchWithoutTraining = together(`the ${withoutTraining.length * trained.seeds.length} searches from today's tables`, withoutTraining)
  const rows = [trained, onTheStandardSet, ...searched, ...withoutTraining]

  console.log(describeRows([...references, plainPassOfTheSeeds, ...rows, everySearch, everySearchWithoutTraining]))
  console.log('')
  console.log(describeSettings([...baselines(), toBeat, plainPassOfTheSeeds, ...rows]))
  console.log('')
  console.log('Whole samples per group of the dataset, in percent of the group\'s samples with something to recover:')
  console.log('')
  console.log(`| setting | all | ${groupRows.map(rowName => rowName.replace('group: ', '')).join(' | ')} |`)
  console.log(`| --- | --- | ${groupRows.map(() => '---').join(' | ')} |`)
  for (const result of [...references, plainPassOfTheSeeds, ...rows]) console.log(`| ${result.name} | ${percentSpread(over(result, whole('all')))} | ${groupRows.map(rowName => percentSpread(over(result, whole(rowName)), 1)).join(' | ')} |`)
  console.log('')

  // Per group against the hand-written tables: the training alone, the search in its first order and the search
  // without the training in its first order, each search with how many of its runs in every order are above and
  // below the hand-written tables.
  const firstSearch = searched[0]!
  const firstWithoutTraining = withoutTraining[0]!
  for (const [title, value] of [['All three', allThree], ['Whole samples', whole]] as const) {
    console.log(`${title} against the hand-written tables, on all samples and per group of the dataset, with the group's validation samples:`)
    console.log('')
    console.log(`| samples | hand-written | ${trained.name} | ${firstSearch.name} | ${everySearch.name}, against the hand-written tables | ${firstWithoutTraining.name} | ${everySearchWithoutTraining.name}, against the hand-written tables |`)
    console.log('| --- | --- | --- | --- | --- | --- | --- |')
    for (const rowName of ['all', ...groupRows]) console.log(`| ${rowName.replace('group: ', '')}, ${rowNamed(handwritten.records[0]!, rowName).samples} | ${percentSpread(over(handwritten, value(rowName)))} | ${percentSpread(over(trained, value(rowName)))} | ${percentSpread(over(firstSearch, value(rowName)))} | ${runsAgainst(everySearch.records, handwritten, value(rowName))} | ${percentSpread(over(firstWithoutTraining, value(rowName)))} | ${runsAgainst(everySearchWithoutTraining.records, handwritten, value(rowName))} |`)
    console.log('')
  }
  for (const result of [trained, ...searched]) printAgainst(result, handwritten, groupRows)

  printSeeds([trained, ...searched, ...withoutTraining])
  console.log(`From the trained tables. ${describeOrders(trained, searched, 'All three on all validation samples', allThree('all'))}`)
  console.log(`From the trained tables. ${describeOrders(trained, searched, 'Whole samples', whole('all'))}`)
  console.log(describeLineRuleLoss(everySearch))
  console.log(describeLineRuleLoss(everySearchWithoutTraining))
  console.log('')
  console.log(describeWhatNoScoreShows(`the ${(1 + searched.length) * trained.seeds.length} runs of the best recipe, without and with its search`, [trained, ...searched].flatMap(result => result.records)))
  console.log(describeWhatNoScoreShows(everySearchWithoutTraining.name, everySearchWithoutTraining.records))
  console.log('')

  for (const result of rows) for (const other of [...references, plainPassOfTheSeeds]) printAgainst(result, other)
  console.log('The search against the training that it starts from:')
  console.log('')
  for (const result of searched) printAgainst(result, trained)
  console.log('The search from the trained tables against the same search from today\'s tables, which is the comparison without gradients:')
  console.log('')
  searched.forEach((result, order) => printAgainst(result, withoutTraining[order]!, ['all', ...groupRows]))
  printAgainst(everySearch, everySearchWithoutTraining, ['all', ...groupRows])
  for (const [title, value] of [['All three on all validation samples', allThree('all')], ['All three within reach of the tables', allThree(withinReach)], ['Whole samples', whole('all')], ['Whole samples within reach of the tables', whole(withinReach)]] as const) console.log(`${title}: ${runsReaching(everySearchWithoutTraining, everySearch, value)}.`)
  console.log('')
  console.log('The search from today\'s tables, every order together, against the hand-written tables and the number to beat:')
  console.log('')
  for (const other of references) printAgainst(everySearchWithoutTraining, other)
  console.log('Four times the samples in one pass against the standard set in four passes:')
  console.log('')
  printAgainst(trained, onTheStandardSet)
}
if (onlyStep === undefined || reportedSteps[onlyStep] !== undefined) reportTheReportedRuns()
