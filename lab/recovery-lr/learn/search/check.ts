// Checks the search, the count and the search per sample, on 1,200 train samples:
// 1. The search gives the same tables with 1, 2 and 4 worker threads, its steps add up to the score of its
//    tables, no pass lowers the train score, and it changes open cells only, none of the end of input and no
//    display entry. With an order seed it gives the same tables for the same seed.
// 2. The search runs tables with the flag, with added terminals and without "end an item early", and the exact
//    parser on whole texts gives its tables the score that the loop gives them.
// 3. The count never lowers the train score, changes open display entries only, and for the entries that show the
//    most code points no other kind has more code points right.
// 4. The search per sample has no more right than one output per token allows, has at least what the searched
//    tables have on most samples and, with the tables' own runs taken in, on every sample, and gives the same
//    numbers on worker threads as in one thread.
//
// Run from the repo root: bun lab/recovery-lr/learn/search/check.ts
import {defaultSeed, loadSamples} from '../../dataset.ts'
import {displayKindCount} from '../../labels.ts'
import {packSamples} from '../data.ts'
import {type RecoveryTables, addFirstOnLineFlag, addTerminals, baseTables, changeableCellsOf, copyTables, endOfInput, kindEndEarly, kindOfChoice, tablesToJson, terminalOfCell, withoutEndEarly} from '../recovery-tables.ts'
import {runSample, scorePack, scoreTables, scoreTablesByExactParser} from '../score.ts'
import {displayEntriesByCount} from './count.ts'
import {bestOfSample, searchPerSample} from './per-sample.ts'
import {searchCells} from './search.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 30) console.log(`PROBLEM: ${text}`)
}
const expect = (holds: boolean, text: () => string) => {
  if (!holds) problem(text())
}
const samples = loadSamples('train', defaultSeed, 1200)
const train = packSamples(samples)
const base = baseTables()

// 1. The search.
let searched: RecoveryTables
{
  const cells = changeableCellsOf(base)
  const scoresAfterPasses: number[] = [scoreTables(base, train).score.allThreeRight]
  const withFour = await searchCells(base, cells, train, {maximumPasses: 2, afterPass: (_pass, tables) => { scoresAfterPasses.push(scoreTables(tables, train).score.allThreeRight) }})
  searched = withFour.tables
  for (const workers of [1, 2]) {
    const other = await searchCells(base, cells, train, {maximumPasses: 2, workers})
    expect(tablesToJson(other.tables) === tablesToJson(searched) && other.runs === withFour.runs && other.changes === withFour.changes, () => `the search with ${workers} worker threads gives other tables than with 4`)
  }
  expect(scoresAfterPasses.every((score, pass) => pass === 0 || score >= scoresAfterPasses[pass - 1]!) && scoresAfterPasses.at(-1)! > 20 * scoresAfterPasses[0]!, () => `the train score after the passes is ${scoresAfterPasses.join(', ')}`)
  let changedCells = 0
  for (let cell = 0; cell < base.choice.length; cell++) {
    if (searched.choice[cell] === base.choice[cell]) continue
    changedCells++
    expect(base.open[cell] === 1 && terminalOfCell(base, cell) !== endOfInput, () => `the search changed the cell ${cell}, which is frozen or a cell of the end of input`)
  }
  expect(searched.display.every((kind, entry) => kind === base.display[entry]), () => 'the search changed a display entry')
  const firstOrder = await searchCells(base, cells, train, {maximumPasses: 1, orderSeed: 7}), again = await searchCells(base, cells, train, {maximumPasses: 1, orderSeed: 7}), otherOrder = await searchCells(base, cells, train, {maximumPasses: 1, orderSeed: 8})
  expect(tablesToJson(firstOrder.tables) === tablesToJson(again.tables) && tablesToJson(firstOrder.tables) !== tablesToJson(otherOrder.tables), () => 'the search in a random order gives other tables for the same seed, or the same for another')
  let refused = false
  try {
    await searchCells(base, [base.open.indexOf(0)], train, {maximumPasses: 1})
  } catch {
    refused = true
  }
  expect(refused, () => 'the search takes a frozen cell')
  console.log(`1. Two passes of the search over ${cells.length} cells on ${train.sampleCount} train samples give the same tables with 1, 2 and 4 worker threads: ${changedCells} cells changed after ${(withFour.runs / 1e6).toFixed(2)} million runs of a sample, and the train samples go from ${(100 * scoresAfterPasses[0]! / train.scoredCodePoints).toFixed(2)}% of all three to ${scoresAfterPasses.slice(1).map(score => (100 * score / train.scoredCodePoints).toFixed(2)).join('% and ')}%. A random order gives the same tables for the same seed.`)
}

// 2. Other layouts.
{
  const layouts: [string, RecoveryTables][] = [
    ['with the flag', addFirstOnLineFlag(baseTables())], ['with added terminals', addTerminals(baseTables(), [{name: 'ampersand', codePoint: 0x26}, {name: 'colon', codePoint: 0x3a}])],
    ['without "end an item early"', withoutEndEarly(baseTables())],
  ]
  const lines: string[] = []
  for (const [name, layout] of layouts) {
    const packed = packSamples(samples, layout)
    const result = await searchCells(layout, changeableCellsOf(layout), packed, {maximumPasses: 1})
    const byLoop = scoreTables(result.tables, packed).score, byExactParser = scoreTablesByExactParser(result.tables, samples)
    expect(JSON.stringify(byLoop) === JSON.stringify(byExactParser), () => `${name}: the searched tables have ${JSON.stringify(byLoop)} by the loop and ${JSON.stringify(byExactParser)} by the exact parser`)
    if (!layout.endEarly) expect(result.tables.choice.every(choice => kindOfChoice(choice) !== kindEndEarly), () => 'the search without "end an item early" puts such a choice into a cell')
    if (layout.firstOnLineFlag) expect(result.tables.choice.some((choice, cell) => cell >= layout.cellsPerCopy && choice !== result.tables.choice[cell - layout.cellsPerCopy]), () => 'no cell with the flag holds another choice than the cell without')
    lines.push(`${name} ${(100 * byLoop.allThreeRight / byLoop.scoredCodePoints).toFixed(2)}%`)
  }
  console.log(`2. One pass of the search in other layouts, all three on the train samples by the loop and by the exact parser alike: ${lines.join(', ')}.`)
}

// 3. The count.
{
  const before = scoreTables(searched, train).score
  const counted = displayEntriesByCount(searched, train)
  const after = scoreTables(counted.tables, train).score
  expect(after.allThreeRight >= before.allThreeRight && after.stackRight === before.stackRight && after.depthRight === before.depthRight && after.sharedConstituents === before.sharedConstituents, () => 'the count lowers the train score, or changes what the parser does')
  expect(counted.tables.choice.every((choice, cell) => choice === searched.choice[cell]) && counted.tables.display.every((kind, entry) => kind === searched.display[entry] || searched.displayOpen[entry] === 1), () => 'the count changes a cell or a frozen display entry')
  expect(displayEntriesByCount(counted.tables, train).entriesChanged === 0, () => 'a second count changes entries')
  // The entries that show the most code points: no other kind has more code points right.
  const wantedKinds = new Int32Array(counted.tables.display.length * displayKindCount)
  scoreTables(counted.tables, train, {wantedKinds})
  const shownBy = (entry: number): number => wantedKinds.subarray(entry * displayKindCount, (entry + 1) * displayKindCount).reduce((sum, count) => sum + count, 0)
  const mostShown = Array.from(counted.tables.display.keys()).filter(entry => counted.tables.displayOpen[entry] === 1 && shownBy(entry) > 0).sort((left, right) => shownBy(right) - shownBy(left)).slice(0, 25)
  let tried = 0
  for (const entry of mostShown) {
    const other = copyTables(counted.tables)
    for (let kind = 0; kind < displayKindCount; kind++) {
      other.display[entry] = kind
      tried++
      if (scoreTables(other, train).score.allThreeRight > after.allThreeRight) problem(`the display entry ${entry} has more code points right with the kind ${kind} than with the count's`)
    }
  }
  console.log(`3. The count changes ${counted.entriesChanged} open display entries and raises the train samples from ${(100 * before.allThreeRight / before.scoredCodePoints).toFixed(2)}% to ${(100 * after.allThreeRight / after.scoredCodePoints).toFixed(2)}% of all three. For the ${mostShown.length} entries that show the most code points, none of ${tried} other kinds has more right.`)
}

// 4. The search per sample.
{
  const tables = displayEntriesByCount(searched, train).tables
  const count = 300
  const few = packSamples(samples.slice(0, count))
  const best = await searchPerSample(few, tables)
  let allRight = 0, ofTables = 0, below = 0
  for (let sample = 0; sample < count; sample++) {
    const right = Math.floor(runSample(few, sample, tables) / scorePack)
    allRight += best[sample]!
    ofTables += right
    if (best[sample]! < right) below++
    if (best[sample]! > few.bound[sample]!) problem(`the search per sample has ${best[sample]} code points of sample ${sample} right, and one output per token allows ${few.bound[sample]}`)
    if (sample % 10 === 0 && bestOfSample(few, sample, tables) !== best[sample]) problem(`the search per sample gives another number for sample ${sample} on a worker thread`)
  }
  // The beam of 64 runs can lose the tables' own run. With `alsoRunsOf` no sample is below the tables.
  const withTables = await searchPerSample(few, tables, undefined, tables)
  expect(allRight > ofTables && below <= count / 8 && withTables.every((right, sample) => right >= best[sample]! && right >= Math.floor(runSample(few, sample, tables) / scorePack)), () => `the search per sample has ${allRight} code points right and the searched tables ${ofTables}, and it is below them in ${below} of ${count} samples`)
  console.log(`4. The search per sample on ${count} train samples: ${(100 * allRight / few.scoredCodePoints).toFixed(2)}% of all three, where the searched tables have ${(100 * ofTables / few.scoredCodePoints).toFixed(2)}% and one output per token allows ${(100 * few.boundCodePoints / few.scoredCodePoints).toFixed(2)}%. Its beam is below the tables in ${below} samples, and in none when the tables' own runs are taken in.`)
}

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
