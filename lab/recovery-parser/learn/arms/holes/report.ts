// The tables of README.md of the arm "holes", from the runs that run.ts saved for the four shares. It trains
// nothing: it reads the saved records and tables, compares every blanked cell with the hand-written choice, counts
// where the filled tables show what the hand-written tables show, and for the share 10 scores every blanked cell
// that ended with another choice against the hand-written choice in that one cell, on the validation split.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after run.ts ran for the shares
// 10, 25, 50 and 100, and after ../plain-pass/run.ts and the two commands that make the number to beat. Under a
// minute:
//   bun lab/recovery-parser/learn/arms/holes/report.ts
import {join} from 'node:path'
import {codePointKept, codePointScored, refuseUnknownOptions} from '../../data.ts'
import {createTrace} from '../../recovery-parser.ts'
import {type RecoveryTables, copyTables, loadTablesOfThisDataset} from '../../recovery-tables.ts'
import {cellsReadAt, runOnSample, scoreTables, sharesOf} from '../../score.ts'
import {
  type ArmRecord, type SettingResult, armFolderOf, baselines, describeComparison, describeSettings, fileNameOf, numberToBeat, percentSpread, rowNamed, savedResultOf, spreadOf, validationOfTheStandardSet,
} from '../harness.ts'
import {
  type Cell, armNameOf, blanksOf, copyChoice, describeTrainerSetting, handTables, readersOf, sameChoice, seedOfTheFixedBlanks, settingNamesOf, sharesOfTheArm, trainReadersOf, trainerSetting,
} from './holes.ts'

refuseUnknownOptions('arms/holes/report.ts', [])
const toBeat = numberToBeat()
const hand = handTables()
const rowsOfBaselines = baselines()
const todaysResult = rowsOfBaselines[0]!
const handResult = rowsOfBaselines.at(-1)!
const plainPass = savedResultOf('plain-pass', 'one pass of the trainer from today\'s tables, defaults')
const trainReaders = trainReadersOf(hand)
const validation = validationOfTheStandardSet()
const withinReach = 'group: within reach of the tables'

// The runs of one setting: per run its record, its tables and its blanked cells.
type Run = {record: ArmRecord, tables: RecoveryTables, blanked: Cell[]}
// One row of the report: a share of blanked decisions and the runs of its three settings. The runs of a setting are
// in the order of the seeds. A setting with one run, e.g. a search without a seed, stands next to every run of the
// other settings, see `at`.
type ReportRow = {label: string, notFilled: ArmRecord[], trained: Run[], searched: Run[]}
const at = <Item>(items: readonly Item[], index: number): Item => items[Math.min(index, items.length - 1)]!

function savedRuns(sharePercent: number, settingName: string, seedOfBlanks: (seed: number) => number = seed => seed): {result: SettingResult, runs: Run[]} {
  const result = savedResultOf(armNameOf(sharePercent), settingName)
  const folder = join(armFolderOf(armNameOf(sharePercent)), fileNameOf(settingName))
  // A setting without a seed has one run, and its blanks do not depend on a seed: the share is 100.
  const seeds = result.seeds.length === 0 ? [null] : result.seeds
  const runs = seeds.map((seed, index) => ({
    record: result.records[index]!, tables: loadTablesOfThisDataset(join(folder, `${seed === null ? 'no-seed' : `seed-${seed}`}.tables.json`)).tables,
    blanked: blanksOf(sharePercent, seedOfBlanks(seed ?? 1)).cells,
  }))
  return {result, runs}
}

const reportRows: ReportRow[] = []
for (const sharePercent of sharesOfTheArm) {
  const names = settingNamesOf(sharePercent)
  const trained = savedRuns(sharePercent, names.trained)
  const searched = savedRuns(sharePercent, names.searched)
  const notFilled = sharePercent === 100 ? todaysResult.records : savedResultOf(armNameOf(sharePercent), names.notFilled).records
  reportRows.push({label: `${sharePercent}%`, notFilled, trained: trained.runs, searched: searched.runs})
  if (sharePercent !== 10) continue
  // The runs with the blanks of one seed stand next to that seed's run without training and to its search.
  const atFixedSeed = trained.result.seeds.indexOf(seedOfTheFixedBlanks)
  if (atFixedSeed === -1) throw new Error(`the share 10 has no run of the seed ${seedOfTheFixedBlanks}, whose blanks the setting with fixed blanks uses`)
  reportRows.push({
    label: `${sharePercent}%, the blanks of seed ${seedOfTheFixedBlanks} for every seed`, notFilled: [notFilled[atFixedSeed]!],
    trained: savedRuns(sharePercent, names.trainedOnFixedBlanks, () => seedOfTheFixedBlanks).runs, searched: [searched.runs[atFixedSeed]!],
  })
}

const spreadOver = (values: readonly number[], digits = 2) => percentSpread(spreadOf(values), digits)
const countsOver = (counts: readonly number[]) => Math.min(...counts) === Math.max(...counts) ? String(counts[0]) : `${Math.round(spreadOf(counts).mean)} (${Math.min(...counts)} to ${Math.max(...counts)})`
const ofCount = (part: number, whole: number) => whole === 0 ? '-' : `${part} of ${whole}, ${(100 * part / whole).toFixed(0)}%`

console.log(`The trainer's setting: ${describeTrainerSetting(trainerSetting)}.`)
console.log(`The hand-written tables hold ${blanksOf(100, 1).cells.length} decisions. The blanked cells of a run, per share: ${sharesOfTheArm.map(share => `${share}%: ${blanksOf(share, 1).cells.length}`).join(', ')}.`)

// a. What blanking costs, and how much of it comes back.
const measures: {name: string, of: (record: ArmRecord) => number}[] = [
  {name: 'All three, all validation samples', of: record => sharesOf(rowNamed(record, 'all')).allThree},
  {name: 'All three, the group "within reach of the tables"', of: record => sharesOf(rowNamed(record, withinReach)).allThree},
  {name: 'Whole samples, all validation samples', of: record => sharesOf(rowNamed(record, 'all')).whole},
]
for (const measure of measures) {
  const ofHand = measure.of(handResult.records[0]!)
  console.log('')
  console.log(`${measure.name}. The hand-written tables have ${(100 * ofHand).toFixed(2)}. "Comes back" is the share of what the blanks cost that the filled tables have again, per seed.`)
  console.log('')
  console.log('| blanked | not filled | trained | comes back | searched | comes back |')
  console.log('| --- | --- | --- | --- | --- | --- |')
  for (const row of reportRows) {
    const comesBack = (filled: readonly Run[]) => spreadOver(Array.from({length: Math.max(filled.length, row.notFilled.length)}, (_, index) => {
      const before = measure.of(at(row.notFilled, index))
      return (measure.of(at(filled, index).record) - before) / (ofHand - before)
    }), 1)
    const scores = (runs: readonly Run[]) => spreadOver(runs.map(run => measure.of(run.record)))
    console.log(`| ${row.label} | ${spreadOver(row.notFilled.map(measure.of))} | ${scores(row.trained)} | ${comesBack(row.trained)} | ${scores(row.searched)} | ${comesBack(row.searched)} |`)
  }
}

// The runs of the share 10 one by one: with a seed's own blanks, and with the blanks of one seed for every seed.
console.log('')
console.log('10% blanked, all three on all validation samples, the seeds one by one:')
console.log('')
for (const row of reportRows.filter(candidate => candidate.label.startsWith('10%'))) {
  const allThree = (record: ArmRecord) => (100 * measures[0]!.of(record)).toFixed(2)
  console.log(`- ${row.label}: not filled ${row.notFilled.map(allThree).join(', ')}; trained ${row.trained.map(run => allThree(run.record)).join(', ')}; searched ${row.searched.map(run => allThree(run.record)).join(', ')}.`)
}

// b. How many blanked cells hold the hand-written choice again, by how many train samples read the cell.
const readerBins: {name: string, from: number, to: number}[] = [
  {name: '1 to 9', from: 1, to: 9}, {name: '10 to 99', from: 10, to: 99}, {name: '100 to 999', from: 100, to: 999}, {name: '1,000 or more', from: 1000, to: Infinity},
]
const isRead = (cell: Cell) => readersOf(trainReaders, cell) > 0
const sameNextState = (tables: RecoveryTables, {grammar, cell}: Cell) => grammar ? tables.grammarNext[cell] === hand.grammarNext[cell] : tables.lexerNext[cell] === hand.lexerNext[cell]
const shareOf = (cells: readonly Cell[], holds: (cell: Cell) => boolean) => cells.filter(holds).length / cells.length
for (const filledBy of ['trained', 'searched'] as const) {
  console.log('')
  console.log(`The blanked cells that hold the hand-written choice again, ${filledBy}. A train sample reads a cell when the exact parser reads the cell on the sample's text with the hand-written tables. The filled tables are another parser and read other cells, so the third column counts the cells without such a reader that a train sample reads with the filled tables. The columns by readers add up the runs of a row.`)
  console.log('')
  console.log(`| blanked | blanked cells | of them, no train sample reads | of those, read with the filled tables, over the runs | hand's choice, of all blanked cells | hand's choice, of the cells that a train sample reads | hand's next state, of the cells that a train sample reads | ${readerBins.map(bin => `read by ${bin.name} train samples`).join(' | ')} | read by none |`)
  console.log(`| --- | --- | --- | --- | --- | --- | --- | ${readerBins.map(() => '---').join(' | ')} | --- |`)
  for (const row of reportRows) {
    const runs = row[filledBy]
    const pooled = (inBin: (readers: number) => boolean) => {
      const cells = runs.flatMap(run => run.blanked.filter(cell => inBin(readersOf(trainReaders, cell))).map(cell => sameChoice(run.tables, hand, cell)))
      return ofCount(cells.filter(same => same).length, cells.length)
    }
    // The cells without a reader under the hand-written tables, and whether a train sample reads them with the
    // tables of the run.
    const readWithFilledTables = runs.flatMap(run => {
      const readersWithFilledTables = trainReadersOf(run.tables)
      return run.blanked.filter(cell => !isRead(cell)).map(cell => readersOf(readersWithFilledTables, cell) > 0)
    })
    console.log(`| ${row.label} | ${runs[0]!.blanked.length} | ${countsOver(runs.map(run => run.blanked.filter(cell => !isRead(cell)).length))} | ${ofCount(readWithFilledTables.filter(read => read).length, readWithFilledTables.length)} `
      + `| ${spreadOver(runs.map(run => shareOf(run.blanked, cell => sameChoice(run.tables, hand, cell))), 1)} | ${spreadOver(runs.map(run => shareOf(run.blanked.filter(isRead), cell => sameChoice(run.tables, hand, cell))), 1)} `
      + `| ${spreadOver(runs.map(run => shareOf(run.blanked.filter(isRead), cell => sameNextState(run.tables, cell))), 1)} | ${readerBins.map(bin => pooled(readers => readers >= bin.from && readers <= bin.to)).join(' | ')} | ${pooled(readers => readers === 0)} |`)
  }
}

// Whether training and the search fill a blanked cell alike.
console.log('')
console.log('The blanked cells by what the trained tables and the searched tables of the same blanks hold, over the runs of a row.')
console.log('')
console.log('| blanked | cells | both hold hand\'s choice | only the trained tables hold hand\'s choice | only the searched tables hold hand\'s choice | both hold the same other choice | two other choices |')
console.log('| --- | --- | --- | --- | --- | --- | --- |')
for (const row of reportRows) {
  const counts = {both: 0, onlyTrained: 0, onlySearched: 0, sameOther: 0, twoOthers: 0}
  row.trained.forEach((run, index) => {
    const searched = at(row.searched, index).tables
    for (const cell of run.blanked) {
      const trainedIsHands = sameChoice(run.tables, hand, cell)
      const searchedIsHands = sameChoice(searched, hand, cell)
      counts[trainedIsHands && searchedIsHands ? 'both' : trainedIsHands ? 'onlyTrained' : searchedIsHands ? 'onlySearched' : sameChoice(run.tables, searched, cell) ? 'sameOther' : 'twoOthers']++
    }
  })
  const cells = row.trained.reduce((total, run) => total + run.blanked.length, 0)
  console.log(`| ${row.label} | ${cells} | ${counts.both} | ${counts.onlyTrained} | ${counts.onlySearched} | ${counts.sameOther} | ${counts.twoOthers} |`)
}

// The blanked cells of the share 10 that ended with another choice than the hand-written one, each judged alone and
// in both directions on the validation split: the filled tables against the same tables with the hand-written choice
// in that one cell, and the hand-written tables against themselves with the filled choice in that one cell.
//
// Only cells are counted, no code points: the cells of filled tables were chosen to fit each other, so the code
// points that one cell is worth inside them do not add up. E.g. for one searched run the single cells add up to
// 12,452 code points, and the whole tables are 3,007 code points above the hand-written ones.
const everyValidationPlace = Int32Array.from({length: validation.sampleCount}, (_, place) => place)
const codePointsRight = (tables: RecoveryTables) => scoreTables(tables, validation, {breakdowns: false}).rows[0]!.allRight
const rightWithHand = codePointsRight(hand)
const readByValidationWithHand = cellsReadAt(hand, validation, everyValidationPlace)
const isReadIn = (read: {lexer: Uint8Array, grammar: Uint8Array}, cell: Cell) => (cell.grammar ? read.grammar : read.lexer)[cell.cell] === 1
// The code points right with `tables`, minus the code points right with the choice of `other` in the one cell.
const lostByExchange = (tables: RecoveryTables, right: number, other: RecoveryTables, cell: Cell) => {
  const exchanged = copyTables(tables)
  copyChoice(exchanged, other, cell)
  return right - codePointsRight(exchanged)
}
console.log('')
console.log('The blanked cells that ended with another choice than the hand-written one, 10% blanked, over the runs of a row. Each cell is judged alone, by the scored code points of the validation split with all three labels right, in two directions. "In the filled tables": the filled tables against the same tables with the hand-written choice in that one cell. "In the hand-written tables": the hand-written tables with the filled choice in that one cell against the hand-written tables. A cell that no validation sample reads changes nothing.')
console.log('')
console.log('| blanked | filled by | blanked cells | with another choice than hand\'s | in the filled tables: not read | as many code points | the filled choice has more | the filled choice has fewer | in the hand-written tables: not read | as many code points | the filled choice has more | the filled choice has fewer | more in the filled tables and fewer in the hand-written ones |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const row of reportRows.filter(candidate => candidate.label.startsWith('10%'))) {
  for (const [filledBy, runs] of [['training', row.trained], ['the search', row.searched]] as const) {
    const inFilled = {notRead: 0, same: 0, more: 0, fewer: 0}
    const inHand = {notRead: 0, same: 0, more: 0, fewer: 0}
    let blanked = 0
    let other = 0
    let moreInFilledAndFewerInHand = 0
    for (const run of runs) {
      const read = cellsReadAt(run.tables, validation, everyValidationPlace)
      const right = codePointsRight(run.tables)
      blanked += run.blanked.length
      for (const cell of run.blanked) {
        if (sameChoice(run.tables, hand, cell)) continue
        other++
        // A cell that no validation sample reads with some tables is read by none with another choice in it
        // either: a text's run is the same up to its first read of the cell.
        const gainInFilled = isReadIn(read, cell) ? lostByExchange(run.tables, right, hand, cell) : undefined
        const gainInHand = isReadIn(readByValidationWithHand, cell) ? -lostByExchange(hand, rightWithHand, run.tables, cell) : undefined
        inFilled[gainInFilled === undefined ? 'notRead' : gainInFilled === 0 ? 'same' : gainInFilled > 0 ? 'more' : 'fewer']++
        inHand[gainInHand === undefined ? 'notRead' : gainInHand === 0 ? 'same' : gainInHand > 0 ? 'more' : 'fewer']++
        if (gainInFilled !== undefined && gainInFilled > 0 && gainInHand !== undefined && gainInHand < 0) moreInFilledAndFewerInHand++
      }
    }
    console.log(`| ${row.label} | ${filledBy} | ${blanked} | ${other} | ${inFilled.notRead} | ${inFilled.same} | ${inFilled.more} | ${inFilled.fewer} | ${inHand.notRead} | ${inHand.same} | ${inHand.more} | ${inHand.fewer} | ${moreInFilledAndFewerInHand} |`)
  }
}

// Where the filled tables show what the hand-written tables show, whatever the labels say: at the scored code
// points, and at the code points that the damage added, which have no label.
const shownByHand = {kind: new Int16Array(validation.codePointCount), depth: new Int16Array(validation.codePointCount), container: new Int8Array(validation.codePointCount)}
const trace = createTrace()
const brokenValidationPlaces = Array.from(everyValidationPlace).filter(place => validation.firstDamage[place] !== -1)
for (const place of brokenValidationPlaces) {
  runOnSample(trace, validation, place, hand)
  const start = validation.start[place]!
  for (let position = 0; position < validation.start[place + 1]! - start; position++) {
    shownByHand.kind[start + position] = trace.displayKind[position]!
    shownByHand.depth[start + position] = trace.depthAfter[position]!
    shownByHand.container[start + position] = trace.containerAfter[position]!
  }
}
function shownAsByHand(tables: RecoveryTables) {
  const counts = {scored: 0, scoredSame: 0, added: 0, addedSame: 0}
  for (const place of brokenValidationPlaces) {
    runOnSample(trace, validation, place, tables)
    const start = validation.start[place]!
    const firstError = validation.firstErrorPosition[place]!
    for (let position = validation.firstDamage[place]!; position < validation.start[place + 1]! - start; position++) {
      const flags = validation.flags[start + position]!
      const same = trace.displayKind[position] === shownByHand.kind[start + position] && trace.depthAfter[position] === shownByHand.depth[start + position] && trace.containerAfter[position] === shownByHand.container[start + position]
      if ((flags & codePointKept) === 0) {
        counts.added++
        if (same) counts.addedSame++
      } else if (position >= firstError && (flags & codePointScored) !== 0) {
        counts.scored++
        if (same) counts.scoredSame++
      }
    }
  }
  return {scored: counts.scoredSame / counts.scored, added: counts.addedSame / counts.added}
}
console.log('')
console.log('The code points of the broken validation samples at which the filled tables show the display kind, the depth and the container that the hand-written tables show: of the scored code points, and of the code points that the damage added, which have no label.')
console.log('')
console.log('| blanked | trained, scored code points | trained, added code points | searched, scored code points | searched, added code points |')
console.log('| --- | --- | --- | --- | --- |')
for (const row of reportRows) {
  const trained = row.trained.map(run => shownAsByHand(run.tables))
  const searched = row.searched.map(run => shownAsByHand(run.tables))
  console.log(`| ${row.label} | ${spreadOver(trained.map(shares => shares.scored))} | ${spreadOver(trained.map(shares => shares.added))} | ${spreadOver(searched.map(shares => shares.scored))} | ${spreadOver(searched.map(shares => shares.added))} |`)
}

// c. Training against the search of the same cells, and d. the share 100 against the same run with every open cell.
const comparisons = (first: SettingResult, second: SettingResult) => ['all', withinReach].map(rowName => `- ${describeComparison(first, second, rowName)}`).join('\n')
console.log('')
console.log('Training against the search of the same blanked cells:')
console.log('')
for (const sharePercent of sharesOfTheArm) {
  const names = settingNamesOf(sharePercent)
  console.log(comparisons(savedResultOf(armNameOf(sharePercent), names.trained), savedResultOf(armNameOf(sharePercent), names.searched)))
}
const names100 = settingNamesOf(100)
const trained100 = savedResultOf(armNameOf(100), names100.trained)
const everyOpenCell = savedResultOf(armNameOf(100), names100.everyOpenCellTrained)
console.log('')
console.log('Every decision blanked, so the cells that the person changed are the trainable cells: against every open cell as the trainable cells, and against the rows that every arm is read against:')
console.log('')
for (const other of [everyOpenCell, plainPass, handResult, toBeat]) console.log(comparisons(trained100, other))
console.log('')
console.log('Every open cell with the arm\'s setting of the trainer against the plain pass, which is one pass with the defaults:')
console.log('')
console.log(comparisons(everyOpenCell, plainPass))

console.log('')
console.log(describeSettings([
  ...rowsOfBaselines, toBeat, plainPass,
  ...sharesOfTheArm.flatMap(sharePercent => {
    const names = settingNamesOf(sharePercent)
    const namesOfShare = sharePercent === 100 ? [names.trained, names.searched, names.everyOpenCellTrained] : sharePercent === 10 ? [names.notFilled, names.trained, names.searched, names.trainedOnFixedBlanks] : [names.notFilled, names.trained, names.searched]
    return namesOfShare.map(name => savedResultOf(armNameOf(sharePercent), name))
  }),
]))
