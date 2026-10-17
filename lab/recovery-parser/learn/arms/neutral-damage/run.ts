// The runs of the arm "neutral damage": the frozen recipe of the candidate "generic" of ../combined/, trained on
// damage that knows nothing of JSON, and the rows that it is read against. README.md has the question, the rows and
// the results, and recipe.ts has the recipe's steps.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after the step `candidates` of
// ../combined/run.ts, whose trainings on the standard train set the row `standard` starts from:
//   bun lab/recovery-parser/learn/arms/neutral-damage/run.ts [--rows neutral,neutral-searched] [--again]
// --rows names rows of recipe.ts, and without it every row runs: neutral, neutral-searched, without-line-edits,
// standard and standard-without-classes. A row runs step by step, the training alone first, each step with the
// seeds 1 to 5, one seed after the other, and the tables and the records of a step go to
// <RECOVERY_SCRATCH>/arms/neutral-damage/<the step's name>/. A step starts from the tables that the step before it
// saved. A step that was saved with these seeds before is not run again, e.g. the training that two rows share,
// unless --again is given, and neither is a step that ../combined/run.ts saved. About 25 minutes for every row, with
// 4 worker threads: 15 trainings of 70 to 110 s each and 5 searches of about 15 s. report.ts then makes the tables
// of the README from the saved runs.
import {optionOf, refuseUnknownOptions} from '../../data.ts'
import {runArm, savedResultOf} from '../harness.ts'
import {type Row, armName, buildRow, fileSavedByCombined, rowsByName, seeds, settingNameOf, stepsOf} from './recipe.ts'

refuseUnknownOptions('arms/neutral-damage/run.ts', ['--rows', '--again'])
const rowNames = optionOf('--rows')?.split(',') ?? Object.keys(rowsByName)
for (const name of rowNames) if (rowsByName[name] === undefined) throw new Error(`arms/neutral-damage/run.ts has the rows ${Object.keys(rowsByName).join(', ')}, and --rows names ${name}`)
const again = process.argv.includes('--again')

// Whether a step was saved with the arm's seeds before.
function isSaved(step: Row): boolean {
  try {
    const saved = savedResultOf(armName, settingNameOf(step))
    return saved.seeds.length === seeds.length && saved.seeds.every((seed, index) => seed === seeds[index])
  } catch {
    return false
  }
}

for (const rowName of rowNames) {
  const row = rowsByName[rowName]!
  for (const recipe of stepsOf(row.recipe)) {
    const step: Row = {trainSet: row.trainSet, recipe}
    const name = settingNameOf(step)
    if (seeds.every(seed => fileSavedByCombined(step, seed) !== undefined)) {
      console.log(`${name}: ../combined/run.ts saved this step with the seeds ${seeds.join(', ')}, not run here.`)
      continue
    }
    if (!again && isSaved(step)) {
      console.log(`${armName}, ${name}: saved before with the seeds ${seeds.join(', ')}, not run again.`)
      continue
    }
    await runArm({name: armName, seeds, settings: [{name, build: seed => buildRow(step, seed)}]})
  }
}
