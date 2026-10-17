// The runs of the arm "spare states": today's tables get tokenizer states and grammar states that they do not have,
// with every cell open, and training may use them. Does the parser learn to remember something that today's states
// cannot hold? README.md has the question, the setup and the results.
//
// One call runs one trainer's setting on one base, for a list of numbers of spare states:
// - with the base `today`, every open cell is trainable, the spare states' cells among them. The run without a spare
//   state, "0+0", is the control: the same trainer's setting and the same seeds.
// - with the base `hand-written`, the base is the hand-written tables, and only the spare states' cells are
//   trainable, and whether an open cell of another state leads into a spare state. Its control is the hand-written
//   tables themselves, which have no seed.
// - with the base `words`, the same with the dataset's hand rule `words` in place of the hand-written tables.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/spare-states/run.ts --states 0+0,1+0,2+0 [--trainer plain] [--base today|hand-written|words]
//       [--seeds 1,2,3,4,5] [--noise 1] [--arm spare-states]
// --states lists the runs, each as <spare tokenizer states>+<spare grammar states>, e.g. 4+2. --trainer is `plain`
// (1 pass from the base's choices, the plain pass of ../plain-pass/), `three-passes` (3 passes from a uniform
// start), or five values with commas: the passes, the start, the learning rate, the temperature at the end and the
// sharpness cost, e.g. 10,uniform,0.02,0.5,0.01, so that a tuned setting can be put in. --noise is the size of the
// random part of a spare state's start. --arm names the folder under <RECOVERY_SCRATCH>/arms/: the reported runs are
// in `spare-states`, and the tuning runs in `spare-states-tune`. report.ts makes the tables of the README from the
// saved runs, and account.ts says what a spare state of saved tables does.
import {optionOf, refuseUnknownOptions} from '../../data.ts'
import {asIsTables} from '../../recovery-tables.ts'
import {type ArmSetting, runArm, trainDataFor} from '../harness.ts'
import {type SpareCounts, baseKindOf, baseOf, defaultNoise, settingNameOf, trainSpare, trainerSettingOf} from './spare-states.ts'

refuseUnknownOptions('arms/spare-states/run.ts', ['--states', '--trainer', '--base', '--seeds', '--noise', '--arm'])
const statesOption = optionOf('--states')
if (statesOption === undefined) throw new Error('arms/spare-states/run.ts needs --states, e.g. --states 0+0,1+0,2+0')
const runs: SpareCounts[] = statesOption.split(',').map(entry => {
  const [tokenizer, grammar] = entry.split('+').map(Number)
  if (!Number.isInteger(tokenizer) || !Number.isInteger(grammar) || tokenizer! < 0 || grammar! < 0) throw new Error(`--states takes entries like 4+2, the spare tokenizer states and the spare grammar states, and got ${entry}`)
  return {tokenizer: tokenizer!, grammar: grammar!}
})
const trainer = trainerSettingOf(optionOf('--trainer') ?? 'plain')
const kind = baseKindOf(optionOf('--base'))
const seeds = (optionOf('--seeds') ?? '1,2,3,4,5').split(',').map(Number)
const noise = Number(optionOf('--noise') ?? defaultNoise)
if (kind !== 'today' && runs.some(spare => spare.tokenizer + spare.grammar === 0)) throw new Error(`with --base ${kind} a run needs a spare state: without one, no cell is trainable, and the control is the base itself`)

// Every base of the arm has today's classes and contexts, so the train samples are packed once.
const data = trainDataFor(asIsTables())

const settings: ArmSetting[] = runs.map(spare => ({
  name: settingNameOf(kind, spare, trainer, noise),
  build: async seed => {
    const base = baseOf(kind, spare)
    return {tables: await trainSpare(base, kind, data, seed, trainer, noise), base}
  },
}))

await runArm({name: optionOf('--arm') ?? 'spare-states', seeds, settings})
