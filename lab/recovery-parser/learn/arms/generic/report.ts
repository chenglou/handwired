// The tables of README.md of the arm "generic", from the runs that run.ts saved. It trains nothing: it reads the
// saved records.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after run.ts ran the steps, and
// after ../plain-pass/run.ts and the two commands that make the number to beat. A few seconds:
//   bun lab/recovery-parser/learn/arms/generic/report.ts [--step passes-and-start]
// Without --step it reports every step of generic.ts. A recipe of a step that was not run yet is named and left out.
//
// First the hand-written tables and the number to beat. Then per step: one row per recipe with what the main number
// shows and what it does not, and each recipe against the step's first one, which is its control, in the sentences
// of describeComparison. The step "reported" is also set next to the hand-written tables, the number to beat and the
// plain pass, with the tables of describeSettings, the whole samples per group, and the orders of the search seed by
// seed.
import {groupNames, optionOf, refuseUnknownOptions} from '../../data.ts'
import {sharesOf} from '../../score.ts'
import {type ArmRecord, type SettingResult, type Spread, baselines, describeComparison, describeSettings, numberToBeat, percentSpread, rowNamed, savedResultOf, spreadOf} from '../harness.ts'
import {describeRecipe, savedRecipeOf, steps} from './generic.ts'

refuseUnknownOptions('arms/generic/report.ts', ['--step'])
const onlyStep = optionOf('--step')
if (onlyStep !== undefined && steps[onlyStep] === undefined) throw new Error(`arms/generic/report.ts takes --step with one of ${Object.keys(steps).join(', ')}, and got ${onlyStep}`)

const withinReach = 'group: within reach of the tables'
const over = (result: SettingResult, value: (record: ArmRecord) => number) => spreadOf(result.records.map(value))
const allThree = (rowName: string) => (record: ArmRecord) => sharesOf(rowNamed(record, rowName)).allThree
const whole = (rowName: string) => (record: ArmRecord) => sharesOf(rowNamed(record, rowName)).whole
const count = (spread: Spread) => spread.lowest === spread.highest ? String(Math.round(spread.mean)) : `${Math.round(spread.mean)} (${spread.lowest} to ${spread.highest})`
// In how many of a setting's runs a count is above 0, e.g. "2 of 3".
const runsWith = (result: SettingResult, value: (record: ArmRecord) => number) => `${result.records.filter(record => value(record) > 0).length} of ${result.records.length}`
const wrongDepth = (record: ArmRecord) => Math.max(record.wrongDepthsOnDeepValidJson.nothingAfter, record.wrongDepthsOnDeepValidJson.membersAfter)

// One row per setting: the two rows of the main number, whole samples in the same two rows, and what no score shows.
function describeRows(results: readonly SettingResult[]): string {
  return [
    '| setting | all three | all three, within reach of the tables | whole samples | whole samples, within reach of the tables | cells changed against the base | code points shown as past the end | runs that show one so | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | runs with a wrong depth there |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(result => `| ${result.name} | ${percentSpread(over(result, allThree('all')))} | ${percentSpread(over(result, allThree(withinReach)))} | ${percentSpread(over(result, whole('all')))} | ${percentSpread(over(result, whole(withinReach)))} | ${count(over(result, record => record.cellsChangedAgainstBase.total))} | ${count(over(result, record => record.shownAsPastEnd))} | ${runsWith(result, record => record.shownAsPastEnd)} | ${percentSpread(over(result, record => record.wrongDepthsOnDeepValidJson.nothingAfter), 1)} | ${percentSpread(over(result, record => record.wrongDepthsOnDeepValidJson.membersAfter), 1)} | ${runsWith(result, wrongDepth)} |`),
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

// A setting against another one: the main number and whole samples, each on all samples and within reach.
function describeAgainst(result: SettingResult, other: SettingResult): string[] {
  return [describeComparison(result, other), describeComparison(result, other, withinReach), describeWholeSamples(result, other), describeWholeSamples(result, other, withinReach)].map(sentence => `- ${sentence}`)
}

const toBeat = numberToBeat()
const handwritten = baselines().at(-1)!
const references = [handwritten, toBeat]
console.log('## The two rows that every step is read against')
console.log('')
console.log(describeRows(references))
console.log('')

for (const [stepName, step] of Object.entries(steps)) {
  if (onlyStep !== undefined && stepName !== onlyStep) continue
  const results: SettingResult[] = []
  const notRun: string[] = []
  for (const recipe of step.recipes) {
    const saved = savedRecipeOf(step, recipe)
    if (saved === undefined) notRun.push(describeRecipe(recipe))
    else results.push(saved)
  }
  console.log(`## The step ${stepName}, seeds ${step.seeds.join(', ')}`)
  console.log('')
  if (notRun.length > 0) console.log(`Not run yet: ${notRun.join('; ')}.\n`)
  if (results.length === 0) continue
  console.log(describeRows(stepName === 'reported' ? [...references, ...results] : results))
  console.log('')
  const control = results[0]!
  for (const result of results.slice(1)) {
    console.log(`${JSON.stringify(result.name)} against the step's first setting:`)
    console.log(describeAgainst(result, control).join('\n'))
    console.log('')
  }
  if (stepName !== 'reported') continue
  const plainPassOfTheSeeds = savedResultOf('plain-pass', 'one pass of the trainer from today\'s tables, defaults')
  console.log(describeSettings([...baselines(), toBeat, plainPassOfTheSeeds, ...results]))
  console.log('')
  console.log('Whole samples per group of the dataset, in percent of the group\'s samples with something to recover:')
  console.log('')
  const groupsInReportOrder = [...groupNames].reverse()
  console.log(`| setting | all | ${groupsInReportOrder.join(' | ')} |`)
  console.log(`| --- | --- | ${groupsInReportOrder.map(() => '---').join(' | ')} |`)
  for (const result of [...references, plainPassOfTheSeeds, ...results]) console.log(`| ${result.name} | ${percentSpread(over(result, whole('all')))} | ${groupsInReportOrder.map(group => percentSpread(over(result, whole(`group: ${group}`)), 1)).join(' | ')} |`)
  console.log('')
  // The orders of the search, seed by seed: every searched setting starts from the trained tables of the first one.
  const [trained, ...searched] = results as [SettingResult, ...SettingResult[]]
  if (searched.length > 0) {
    const percent = (share: number) => (100 * share).toFixed(2)
    console.log('All three on all validation samples, and whole samples, per trained seed and order of the search:')
    console.log('')
    const columns = ['the training alone', ...searched.map((_, order) => `searched, order ${order + 1}`)]
    console.log(`| seed | ${columns.join(' | ')} | lowest to highest of the orders | whole samples: ${columns.join(' | ')} |`)
    console.log(`| --- | ${columns.map(() => '---').join(' | ')} | --- | ${columns.map(() => '---').join(' | ')} |`)
    trained.seeds.forEach((seed, index) => {
      const ofOrders = searched.map(result => allThree('all')(result.records[index]!))
      console.log(`| ${seed} | ${results.map(result => percent(allThree('all')(result.records[index]!))).join(' | ')} | ${percent(Math.min(...ofOrders))} to ${percent(Math.max(...ofOrders))} | ${results.map(result => percent(whole('all')(result.records[index]!))).join(' | ')} |`)
    })
    console.log('')
  }
  for (const result of results) {
    for (const other of [...references, plainPassOfTheSeeds]) {
      console.log(`${JSON.stringify(result.name)} against ${JSON.stringify(other.name)}:`)
      console.log(describeAgainst(result, other).join('\n'))
      console.log('')
    }
  }
}
