// Shows that the restricted search of this folder is the search of ../../search/search.ts when nothing restricts
// it, in both orders of the cells. With every open cell as its cells it has to give the tables that search.ts made:
// - with the most read cells first, from the hand-written tables: the tables of the number to beat,
// - in the random order of the seed 1, from today's tables: the tables of `search.ts --order 1`.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after the two commands that make
// the number to beat, see numberToBeat in ../harness.ts, and after `bun lab/recovery-parser/learn/search/search.ts
// --order 1`. About 8 minutes, with 4 worker threads:
//   bun lab/recovery-parser/learn/arms/holes/check-search.ts
import {existsSync} from 'node:fs'
import {join} from 'node:path'
import {refuseUnknownOptions} from '../../data.ts'
import {type RecoveryTables, asIsTables, loadTablesOfThisDataset, tablesToJson} from '../../recovery-tables.ts'
import {prepareSamples} from '../../search/sample-runs.ts'
import {numberToBeatFileOf, trainPartOfTheStandardSet} from '../harness.ts'
import {type Cell, handTables} from './holes.ts'
import {searchCells} from './restricted-search.ts'

refuseUnknownOptions('arms/holes/check-search.ts', [])
const scratch = process.env['RECOVERY_SCRATCH']
if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to a folder outside the repo: the tables that search.ts made are read from there')
const fileOfTheRandomOrder = join(scratch, 'search', 'search-from-today-order-1.json')
if (!existsSync(fileOfTheRandomOrder)) throw new Error(`${fileOfTheRandomOrder} is missing. Make it with \`bun lab/recovery-parser/learn/search/search.ts --order 1\`.`)
const hand = handTables()
const everyOpenCell: Cell[] = [
  ...Array.from(hand.lexerOpen, (open, cell) => ({grammar: false, cell, open})),
  ...Array.from(hand.grammarOpen, (open, cell) => ({grammar: true, cell, open})),
].filter(({open}) => open === 1)
const trainSamples = prepareSamples(trainPartOfTheStandardSet())

let failures = 0
async function check(start: RecoveryTables, startName: string, orderSeed: number | undefined, expectedFile: string, expectedName: string) {
  const expected = loadTablesOfThisDataset(expectedFile).tables
  const result = await searchCells(start, everyOpenCell, trainSamples, orderSeed)
  const same = tablesToJson(result.tables) === tablesToJson(expected)
  if (!same) failures++
  console.log(`The search of all ${everyOpenCell.length} open cells from ${startName}, ${orderSeed === undefined ? 'with the most read cells first' : `in the random order of the seed ${orderSeed}`}, ended after ${result.passes} passes, ${result.changes} changes of a cell and ${(result.runs / 1e6).toFixed(1)} million runs of a sample. Its tables are ${same ? '' : 'NOT '}${expectedName}.`)
}
await check(hand, 'the hand-written tables', undefined, numberToBeatFileOf(scratch), 'the tables of the number to beat')
await check(asIsTables(), 'today\'s tables', 1, fileOfTheRandomOrder, 'the tables of `search.ts --order 1`')
console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
