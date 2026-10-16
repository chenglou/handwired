// The runs of the arm "combined": what the arms of round 1 found, put together. README.md has the question, the
// recipes and the results, and combined.ts has the recipes and the steps.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/combined/run.ts --step kept [--recipes 0,1] [--again]
// --step names a step of combined.ts, a list of recipes. Each recipe runs with the step's seeds, one seed after the
// other, and its tables and records go to <RECOVERY_SCRATCH>/arms/<the step's arm name>/<the recipe's name>/. A
// recipe that was saved with the step's seeds before is not run again, e.g. the control that two steps share,
// unless --again is given. --recipes runs only the recipes at these places of the step's list, 0 for the first one.
// A recipe with a step after its training, e.g. a search, starts from the tables that its training saved, so the
// training runs first. report.ts then makes the tables of the README from the saved runs.
import {optionOf, refuseUnknownOptions} from '../../data.ts'
import {runArm} from '../harness.ts'
import {buildRecipe, describeRecipe, savedRecipeOf, steps} from './combined.ts'

refuseUnknownOptions('arms/combined/run.ts', ['--step', '--recipes', '--again'])
const stepName = optionOf('--step')
const step = stepName === undefined ? undefined : steps[stepName]
if (step === undefined) throw new Error(`arms/combined/run.ts needs --step with one of ${Object.keys(steps).join(', ')}, and got ${stepName}`)
const again = process.argv.includes('--again')
const places = optionOf('--recipes')?.split(',').map(Number) ?? step.recipes.map((_, place) => place)
for (const place of places) if (step.recipes[place] === undefined) throw new Error(`the step ${stepName} has the recipes 0 to ${step.recipes.length - 1}, and --recipes names ${place}`)

for (const recipe of places.map(place => step.recipes[place]!)) {
  const name = describeRecipe(recipe)
  if (!again && savedRecipeOf(step, recipe) !== undefined) {
    console.log(`${step.armName}, ${name}: saved before with the seeds ${step.seeds.join(', ')}, not run again.`)
    continue
  }
  await runArm({name: step.armName, seeds: step.seeds, settings: [{name, build: seed => buildRecipe(recipe, seed, step.armName)}]})
}
