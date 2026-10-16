// The comparison without gradients for the open display entries: a search of every open cell and a count of the
// display entries, in turns. The search is the one of ../../search/search.ts, run by searchCells of
// ../holes/restricted-search.ts, which tries one cell at a time on the train split and reads the display table as
// the tables hold it. The count is displayEntriesByCount of facts.ts. A run starts from the hand-written tables with
// their display entries counted, as the number to beat starts from the hand-written tables, and ends when the count
// after a search changes no entry, or after `maximumRounds` rounds.
//
// A search ends in other tables for another order of its cells. Without --seeds the cells of a pass go from the most
// read one to the least read one, which is the order of the number to beat, and the setting has no seed. With
// --seeds a seed draws a random order for every pass, and the range over the seeds says how far the orders are
// apart. The search refuses tables with added classes or with the bit "first on its line", so the other additions
// of the arm have no such comparison.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/extra-facts/search-display.ts [--seeds 1,2,3]
// The tables and the records go to <RECOVERY_SCRATCH>/arms/extra-facts-search/, and report.ts reads them from there.
import {optionOf, refuseUnknownOptions} from '../../data.ts'
import {handwrittenTables} from '../../handwritten/rules.ts'
import {openDisplayEntries, tablesToJson} from '../../recovery-tables.ts'
import {prepareSamples} from '../../search/sample-runs.ts'
import {type ArmSetting, type Built, runArm, trainPartOfTheStandardSet} from '../harness.ts'
import type {Cell} from '../holes/holes.ts'
import {searchCells} from '../holes/restricted-search.ts'
import {armNameOfTheSearch, displayEntriesByCount, settingNamesOfTheSearch} from './facts.ts'

refuseUnknownOptions('arms/extra-facts/search-display.ts', ['--seeds'])
const seeds = optionOf('--seeds')?.split(',').map(Number)
const maximumRounds = 4

const trainSamples = trainPartOfTheStandardSet()
const searchSamples = prepareSamples(trainSamples)

// The search and the count in turns, in the random order of `orderSeed`, or with the most read cells first.
async function searchedInTurns(orderSeed?: number): Promise<Built> {
  const base = openDisplayEntries(handwrittenTables().tables)
  let tables = displayEntriesByCount(base, trainSamples)
  const everyOpenCell: Cell[] = [
    ...Array.from(tables.lexerOpen, (open, cell) => ({grammar: false, cell, open})),
    ...Array.from(tables.grammarOpen, (open, cell) => ({grammar: true, cell, open})),
  ].filter(({open}) => open === 1)
  for (let round = 1; round <= maximumRounds; round++) {
    const searched = await searchCells(tables, everyOpenCell, searchSamples, orderSeed)
    if (!searched.lastPassChangedNothing) throw new Error(`the search of round ${round} did not end in ${searched.passes} passes`)
    const counted = displayEntriesByCount(searched.tables, trainSamples)
    const entriesChanged = tablesToJson(counted) !== tablesToJson(searched.tables)
    console.log(`Round ${round}: the search changed a cell ${searched.changes} times in ${searched.passes} passes, and the count then ${entriesChanged ? 'changed' : 'did not change'} the display entries.`)
    tables = counted
    if (!entriesChanged) break
  }
  return {tables, base}
}

const settings: ArmSetting[] = seeds === undefined
  ? [{name: settingNamesOfTheSearch.mostReadFirst, withoutSeed: true, build: () => searchedInTurns()}]
  : [{name: settingNamesOfTheSearch.randomOrder, build: seed => searchedInTurns(seed)}]
await runArm({name: armNameOfTheSearch, ...(seeds === undefined ? {} : {seeds}), settings})
