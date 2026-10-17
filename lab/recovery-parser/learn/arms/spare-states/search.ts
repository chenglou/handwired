// The comparison without gradients of the arm "spare states": the search of ../../search/, which tries one cell at
// a time in the exact parser, over every open cell of tables with spare states, the spare states' cells among them.
// Does a search begin to use a spare state? In the base a spare state is a copy of another state and no cell leads
// into it, so a step into it changes nothing by itself.
//
// A search ends in other tables for another order of its cells. So it runs in three orders or more, with the spare
// states and without them: from the most read cell to the least read one, which has no seed, and in random orders,
// one per seed.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/spare-states/search.ts --states 2+0 [--base today|hand-written|words] [--seeds 1,2]
// --states is one run, as <spare tokenizer states>+<spare grammar states>. --base names the tables that the search
// starts from. With each, the search may give any open cell any choice, where the training of run.ts from tables
// that a person wrote may only make a cell of another state lead into a spare state. The tables and
// the records go to <RECOVERY_SCRATCH>/arms/spare-states-search/, and report.ts reads them.
import {optionOf, refuseUnknownOptions} from '../../data.ts'
import type {RecoveryTables} from '../../recovery-tables.ts'
import {prepareSamples} from '../../search/sample-runs.ts'
import {type ArmSetting, type Built, runArm, trainPartOfTheStandardSet} from '../harness.ts'
import {searchCells} from '../holes/restricted-search.ts'
import {type SpareCounts, baseKindOf, baseOf, searchSettingNameOf} from './spare-states.ts'

refuseUnknownOptions('arms/spare-states/search.ts', ['--states', '--base', '--seeds'])
const [tokenizer, grammar] = (optionOf('--states') ?? '').split('+').map(Number)
if (!Number.isInteger(tokenizer) || !Number.isInteger(grammar) || tokenizer! + grammar! < 1) throw new Error(`arms/spare-states/search.ts needs --states with one entry like 2+0, the spare tokenizer states and the spare grammar states, and got ${optionOf('--states')}`)
const withSpare: SpareCounts = {tokenizer: tokenizer!, grammar: grammar!}
const kind = baseKindOf(optionOf('--base'))
const seeds = (optionOf('--seeds') ?? '1,2').split(',').map(Number)
const searchSamples = prepareSamples(trainPartOfTheStandardSet())

const openCellsOf = (tables: RecoveryTables) => [
  ...Array.from(tables.lexerOpen.keys()).filter(cell => tables.lexerOpen[cell] === 1).map(cell => ({grammar: false, cell})),
  ...Array.from(tables.grammarOpen.keys()).filter(cell => tables.grammarOpen[cell] === 1).map(cell => ({grammar: true, cell})),
]
// The search of every open cell from the base with `spare` states, in a random order that `orderSeed` draws, or with
// the most read cells first when no seed is given.
const searched = async (spare: SpareCounts, orderSeed?: number): Promise<Built> => {
  const base = baseOf(kind, spare)
  const result = await searchCells(base, openCellsOf(base), searchSamples, orderSeed)
  if (!result.lastPassChangedNothing) throw new Error(`the search did not end in ${result.passes} passes`)
  console.log(`The search ended when pass ${result.passes} changed nothing, after ${result.changes} changes of a cell and ${(result.runs / 1e6).toFixed(1)} million runs of a sample.`)
  return {tables: result.tables, base}
}

const settings: ArmSetting[] = [withSpare, {tokenizer: 0, grammar: 0}].flatMap((spare): ArmSetting[] => [
  {name: searchSettingNameOf(kind, spare, 'most read first'), withoutSeed: true, build: () => searched(spare)},
  {name: searchSettingNameOf(kind, spare, 'random'), build: seed => searched(spare, seed)},
])

await runArm({name: 'spare-states-search', seeds, settings})
