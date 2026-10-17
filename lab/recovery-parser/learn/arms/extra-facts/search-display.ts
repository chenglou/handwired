// The comparison without gradients for the open display entries: a search of every open cell and a count of the
// display entries. The search is the one of ../../search/search.ts, run by searchCells of
// ../holes/restricted-search.ts, which tries one cell at a time on the train split and reads the display table as
// the tables hold it. The count is displayEntriesByCount of facts.ts. Every run starts from the hand-written tables,
// as the number to beat does.
//
// - In turns: the display entries are counted, every open cell is searched, the entries are counted again, and so on
//   until the count after a search changes no entry, or for `maximumRounds` rounds.
// - Two controls of the search in turns: the search alone, with today's display table, and the tables of that search
//   with one count after it. They say how much of the score a search without open entries has, and how much one
//   count gives.
//
// A search ends in other tables for another order of its cells. Without --seeds the cells of a pass go from the most
// read one to the least read one, which is the order of the number to beat. The search alone is then the number to
// beat itself, which report.ts reads and counts, so only the search in turns runs, as a setting without a seed. With
// --seeds a seed draws a random order for every pass, the search in turns and its two controls run, and the range
// over the seeds says how far the orders are apart.
//
// The other additions of the arm have no such comparison here: when these runs were made, the search refused tables
// with added classes or with the bit "first on its line". The search runs such tables now, when prepareSamples gets
// the tables whose classes it will run, and ../combined/ has the search with all three additions.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/extra-facts/search-display.ts [--seeds 1,2,3]
// The tables and the records go to <RECOVERY_SCRATCH>/arms/extra-facts-search/, and report.ts reads them from there.
import {optionOf, refuseUnknownOptions} from '../../data.ts'
import {handwrittenTables} from '../../handwritten/rules.ts'
import {type RecoveryTables, openDisplayEntries, tablesToJson} from '../../recovery-tables.ts'
import {prepareSamples} from '../../search/sample-runs.ts'
import {type ArmSetting, type Built, runArm, trainPartOfTheStandardSet} from '../harness.ts'
import type {Cell} from '../holes/holes.ts'
import {searchCells} from '../holes/restricted-search.ts'
import {armNameOfTheSearch, displayEntriesByCount, savedTablesOf, settingNamesOfTheSearch} from './facts.ts'

refuseUnknownOptions('arms/extra-facts/search-display.ts', ['--seeds'])
const seeds = optionOf('--seeds')?.split(',').map(Number)
const maximumRounds = 4

const trainSamples = trainPartOfTheStandardSet()
const searchSamples = prepareSamples(trainSamples)

// A search of every open cell of `start`, in the random order of `orderSeed`, or with the most read cells first.
async function searched(start: RecoveryTables, orderSeed?: number) {
  const everyOpenCell: Cell[] = [
    ...Array.from(start.lexerOpen, (open, cell) => ({grammar: false, cell, open})),
    ...Array.from(start.grammarOpen, (open, cell) => ({grammar: true, cell, open})),
  ].filter(({open}) => open === 1)
  const result = await searchCells(start, everyOpenCell, searchSamples, orderSeed)
  if (!result.lastPassChangedNothing) throw new Error(`the search did not end in ${result.passes} passes`)
  return result
}

// The search alone, in the random order of `orderSeed`: the hand-written tables with today's display table.
async function searchedAlone(orderSeed: number): Promise<Built> {
  const base = handwrittenTables().tables
  return {tables: (await searched(base, orderSeed)).tables, base}
}

// The tables that the search alone saved for the same seed, with their display entries counted once.
const searchedThenCounted = (orderSeed: number): Built =>
  ({tables: displayEntriesByCount(savedTablesOf(armNameOfTheSearch, settingNamesOfTheSearch.randomOrderAlone, orderSeed), trainSamples), base: openDisplayEntries(handwrittenTables().tables)})

// The search and the count in turns, in the random order of `orderSeed`, or with the most read cells first.
async function searchedInTurns(orderSeed?: number): Promise<Built> {
  const base = openDisplayEntries(handwrittenTables().tables)
  let tables = displayEntriesByCount(base, trainSamples)
  for (let round = 1; round <= maximumRounds; round++) {
    const ofRound = await searched(tables, orderSeed)
    const counted = displayEntriesByCount(ofRound.tables, trainSamples)
    const entriesChanged = tablesToJson(counted) !== tablesToJson(ofRound.tables)
    console.log(`Round ${round}: the search changed a cell ${ofRound.changes} times in ${ofRound.passes} passes, and the count then ${entriesChanged ? 'changed' : 'did not change'} the display entries.`)
    tables = counted
    if (!entriesChanged) break
  }
  return {tables, base}
}

// The setting "then the open display entries by a count" reads the tables that the search alone saved, so the search
// alone runs before it.
const settings: ArmSetting[] = seeds === undefined
  ? [{name: settingNamesOfTheSearch.inTurns, withoutSeed: true, build: () => searchedInTurns()}]
  : [
    {name: settingNamesOfTheSearch.randomOrderAlone, build: searchedAlone},
    {name: settingNamesOfTheSearch.randomOrderThenCount, build: searchedThenCounted},
    {name: settingNamesOfTheSearch.randomOrderInTurns, build: seed => searchedInTurns(seed)},
  ]
await runArm({name: armNameOfTheSearch, ...(seeds === undefined ? {} : {seeds}), settings})
