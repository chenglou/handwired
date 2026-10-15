// Shows that the restricted search of this folder is the search of ../../search/search.ts when nothing restricts
// it: from the hand-written tables, with every open cell as its cells, it has to give the tables of the number to
// beat, which search.ts made from the same tables.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after the two commands that make
// the number to beat, see numberToBeat in ../harness.ts. About 3 minutes, with 4 worker threads:
//   bun lab/recovery-parser/learn/arms/holes/check-search.ts
import {refuseUnknownOptions} from '../../data.ts'
import {loadTablesOfThisDataset, tablesToJson} from '../../recovery-tables.ts'
import {prepareSamples} from '../../search/sample-runs.ts'
import {numberToBeatFileOf, trainPartOfTheStandardSet} from '../harness.ts'
import {type Cell, handTables} from './holes.ts'
import {searchCells} from './restricted-search.ts'

refuseUnknownOptions('arms/holes/check-search.ts', [])
const scratch = process.env['RECOVERY_SCRATCH']
if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to a folder outside the repo: the tables of the number to beat are read from there')
const expected = loadTablesOfThisDataset(numberToBeatFileOf(scratch)).tables
const hand = handTables()
const everyOpenCell: Cell[] = [
  ...Array.from(hand.lexerOpen, (open, cell) => ({grammar: false, cell, open})),
  ...Array.from(hand.grammarOpen, (open, cell) => ({grammar: true, cell, open})),
].filter(({open}) => open === 1)
const result = await searchCells(hand, everyOpenCell, prepareSamples(trainPartOfTheStandardSet()))
const same = tablesToJson(result.tables) === tablesToJson(expected)
console.log(`The search of all ${everyOpenCell.length} open cells from the hand-written tables ended after ${result.passes} passes, ${result.changes} changes of a cell and ${(result.runs / 1e6).toFixed(1)} million runs of a sample. Its tables are ${same ? '' : 'NOT '}the tables of the number to beat.`)
console.log(same ? 'Every check passed.' : '1 check FAILED.')
if (!same) process.exitCode = 1
