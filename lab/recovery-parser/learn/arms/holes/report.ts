// The tables of README.md of the arm "holes", from the runs that run.ts saved for the four shares. It trains
// nothing: it reads the saved records and tables, compares every blanked cell with the hand-written choice, counts
// where the filled tables show what the hand-written tables show, and for the share 10 judges every blanked cell
// that ended with another choice against the hand-written choice in that one cell, on the train split and on the
// validation split. Where it sets two settings next to each other, it gives both ranges and says whether they
// overlap, and where it sets runs against the hand-written tables, it counts the runs that reach them.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after run.ts ran for the shares
// 10, 25, 50 and 100, and after ../plain-pass/run.ts and the two commands that make the number to beat. About 20 s:
//   bun lab/recovery-parser/learn/arms/holes/report.ts
import {join} from 'node:path'
import {codePointKept, codePointScored, groupNames, refuseUnknownOptions} from '../../data.ts'
import {createTrace} from '../../recovery-parser.ts'
import {
  type RecoveryTables, actionByToken, actionOfToken, asIsTables, grammarCellName, grammarChoiceName, lexerCellName, lexerChoiceName, loadTablesOfThisDataset,
} from '../../recovery-tables.ts'
import {runOnSample, sharesOf} from '../../score.ts'
import {type RunSamples, cellBitCount, changesOfChoices, prepareSamples, scoreOfSample} from '../../search/sample-runs.ts'
import {
  type ArmRecord, type SettingResult, armFolderOf, baselines, describeComparison, describeSettings, fileNameOf, numberToBeat, numberToBeatFileOf, percentSpread, rowNamed, savedResultOf, spreadOf,
  trainPartOfTheStandardSet, validationOfTheStandardSet,
} from '../harness.ts'
import {
  type Cell, armNameOf, blanksOf, describeTrainerSetting, handTables, readersOf, sameChoice, seedOfTheFixedBlanks, settingNamesOf, sharesOfTheArm, trainReadersOf, trainerSetting,
} from './holes.ts'
import {candidatesOf} from './restricted-search.ts'

refuseUnknownOptions('arms/holes/report.ts', [])
const scratch = process.env['RECOVERY_SCRATCH']
if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to a folder outside the repo: the saved runs are read from there')
const toBeat = numberToBeat()
const hand = handTables()
const todays = asIsTables()
const rowsOfBaselines = baselines()
const todaysResult = rowsOfBaselines[0]!
const handResult = rowsOfBaselines.at(-1)!
const handRecord = handResult.records[0]!
const nameOfThePlainPass = 'one pass of the trainer from today\'s tables, defaults'
const trainReaders = trainReadersOf(hand)
const validation = validationOfTheStandardSet()
const withinReach = 'group: within reach of the tables'

// A run with its tables: its seed, or null for tables without a seed, e.g. a baseline's.
type SavedRun = {seed: number | null, record: ArmRecord, tables: RecoveryTables}
// The runs of a setting that runArm saved, in the order of the seeds.
function savedRunsOf(armName: string, settingName: string): {result: SettingResult, runs: SavedRun[]} {
  const result = savedResultOf(armName, settingName)
  const folder = join(armFolderOf(armName), fileNameOf(settingName))
  const seeds = result.seeds.length === 0 ? [null] : result.seeds
  return {result, runs: seeds.map((seed, index) => ({seed, record: result.records[index]!, tables: loadTablesOfThisDataset(join(folder, `${seed === null ? 'no-seed' : `seed-${seed}`}.tables.json`)).tables}))}
}
// A run of the arm that filled blanks, with its blanked cells. The blanks of the share 100 are every decision,
// whatever the seed is, so a run without a seed has them too.
type Run = SavedRun & {blanked: Cell[]}
const filledRunsOf = (sharePercent: number, settingName: string, seedOfBlanks: (seed: number) => number = seed => seed): Run[] =>
  savedRunsOf(armNameOf(sharePercent), settingName).runs.map(run => ({...run, blanked: blanksOf(sharePercent, seedOfBlanks(run.seed ?? 1)).cells}))

// One row of the report: a share of blanked decisions and the runs of its three settings. The runs of a setting are
// in the order of the seeds. A setting with one run, e.g. the blanks of one seed without a filling, stands next to
// every run of the other settings, see `at`.
type ReportRow = {label: string, notFilled: SavedRun[], trained: Run[], searched: Run[]}
const at = <Item>(items: readonly Item[], index: number): Item => items[Math.min(index, items.length - 1)]!

const reportRows: ReportRow[] = []
for (const sharePercent of sharesOfTheArm) {
  const names = settingNamesOf(sharePercent)
  const notFilled = sharePercent === 100 ? [{seed: null, record: todaysResult.records[0]!, tables: todays}] : savedRunsOf(armNameOf(sharePercent), names.notFilled).runs
  reportRows.push({label: `${sharePercent}%`, notFilled, trained: filledRunsOf(sharePercent, names.trained), searched: filledRunsOf(sharePercent, names.searched)})
  if (sharePercent !== 10) continue
  // The runs with the blanks of one seed stand next to that seed's run without a filling.
  const ofFixedSeed = notFilled.find(run => run.seed === seedOfTheFixedBlanks)
  if (ofFixedSeed === undefined) throw new Error(`the share 10 has no run of the seed ${seedOfTheFixedBlanks}, whose blanks the settings with fixed blanks use`)
  reportRows.push({
    label: `${sharePercent}%, the blanks of seed ${seedOfTheFixedBlanks} for every seed`, notFilled: [ofFixedSeed],
    trained: filledRunsOf(sharePercent, names.trainedOnFixedBlanks, () => seedOfTheFixedBlanks), searched: filledRunsOf(sharePercent, names.searchedOnFixedBlanks, () => seedOfTheFixedBlanks),
  })
}
const rowsOfTheShare10 = reportRows.filter(row => row.label.startsWith('10%'))
const everyDecision = reportRows.find(row => row.label === '100%')!
const names100 = settingNamesOf(100)
// The search of every decision with the most read cells first: one run without a seed, the sixth order next to the
// five random orders of the row "100%".
const searchedMostReadFirst = filledRunsOf(100, names100.searchedMostReadFirst)
const searchOrders = [...searchedMostReadFirst, ...everyDecision.searched]
const everyOpenCell = savedRunsOf(armNameOf(100), names100.everyOpenCellTrained)
const plainPass = savedRunsOf('plain-pass', nameOfThePlainPass)

// Shares as percentages, e.g. "96.52 (96.37 to 96.60)" for the mean, the lowest and the highest of several runs, and
// one number for one run or for runs that all print the same number.
function spreadOver(values: readonly number[], digits = 2) {
  const spread = spreadOf(values)
  return (100 * spread.lowest).toFixed(digits) === (100 * spread.highest).toFixed(digits) ? percentSpread({...spread, count: 1}, digits) : percentSpread(spread, digits)
}
const shareOf = (cells: readonly Cell[], holds: (cell: Cell) => boolean) => cells.filter(holds).length / cells.length
const counted = (count: number) => count.toLocaleString('en-US')
const countsOver = (counts: readonly number[]) => Math.min(...counts) === Math.max(...counts) ? counted(counts[0]!) : `${counted(Math.round(spreadOf(counts).mean))} (${counted(Math.min(...counts))} to ${counted(Math.max(...counts))})`
const ofCount = (part: number, whole: number) => whole === 0 ? '-' : `${counted(part)} of ${counted(whole)}, ${(100 * part / whole).toFixed(0)}%`
const handsChoiceShare = (run: Run) => shareOf(run.blanked, cell => sameChoice(run.tables, hand, cell))

// Two sets of runs next to each other on one number, as describeComparison of the harness says it for all three:
// both means, both ranges, and whether the ranges overlap, or how far apart they are. The range of one run is its
// one number.
type Measured = {name: string, values: readonly number[]}
function compared(what: string, first: Measured, second: Measured, digits = 2): string {
  const firstSpread = spreadOf(first.values)
  const secondSpread = spreadOf(second.values)
  const difference = 100 * (firstSpread.mean - secondSpread.mean)
  const apart = 100 * Math.max(firstSpread.lowest - secondSpread.highest, secondSpread.lowest - firstSpread.highest)
  return `- ${what}: ${first.name} ${spreadOver(first.values, digits)}, ${second.name} ${spreadOver(second.values, digits)}. The means differ by ${difference >= 0 ? '+' : ''}${difference.toFixed(digits)} points, and the two ranges ${apart <= 0 ? 'overlap' : `do not overlap: they are ${apart.toFixed(digits)} points apart`}.`
}
const comparisons = (first: SettingResult, second: SettingResult) => ['all', withinReach].map(rowName => `- ${describeComparison(first, second, rowName)}`).join('\n')

console.log(`The trainer's setting: ${describeTrainerSetting(trainerSetting)}.`)
console.log(`The hand-written tables hold ${blanksOf(100, 1).cells.length} decisions. The blanked cells of a run, per share: ${sharesOfTheArm.map(share => `${share}%: ${blanksOf(share, 1).cells.length}`).join(', ')}.`)

// 1. What blanking costs, and how much of it comes back.
type Measure = {name: string, of: (record: ArmRecord) => number}
const allThreeOfAll: Measure = {name: 'All three, all validation samples', of: record => sharesOf(rowNamed(record, 'all')).allThree}
const allThreeWithinReach: Measure = {name: 'All three, the group "within reach of the tables"', of: record => sharesOf(rowNamed(record, withinReach)).allThree}
const wholeSamples: Measure = {name: 'Whole samples, all validation samples', of: record => sharesOf(rowNamed(record, 'all')).whole}
const measures = [allThreeOfAll, allThreeWithinReach, wholeSamples]
for (const measure of measures) {
  const ofHand = measure.of(handRecord)
  const handsNumber = (100 * ofHand).toFixed(2)
  console.log('')
  console.log(`${measure.name}. The hand-written tables have ${handsNumber}. "Comes back" is the share of what the blanks cost that the filled tables have again, per seed.`)
  console.log('')
  console.log(`| blanked | not filled | trained | trained runs at ${handsNumber} or above | comes back | searched | searched runs at ${handsNumber} or above | comes back |`)
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const row of reportRows) {
    const columnsOf = (filled: readonly Run[]) => {
      const comesBack = Array.from({length: Math.max(filled.length, row.notFilled.length)}, (_, index) => {
        const before = measure.of(at(row.notFilled, index).record)
        return (measure.of(at(filled, index).record) - before) / (ofHand - before)
      })
      return `${spreadOver(filled.map(run => measure.of(run.record)))} | ${filled.filter(run => measure.of(run.record) >= ofHand).length} of ${filled.length} | ${spreadOver(comesBack, 1)}`
    }
    console.log(`| ${row.label} | ${spreadOver(row.notFilled.map(run => measure.of(run.record)))} | ${columnsOf(row.trained)} | ${columnsOf(row.searched)} |`)
  }
}

console.log('')
console.log('The trained tables against the hand-written ones:')
console.log('')
for (const row of reportRows) {
  for (const measure of measures) console.log(compared(`${measure.name}, ${row.label}`, {name: 'trained', values: row.trained.map(run => measure.of(run.record))}, {name: 'hand-written', values: [measure.of(handRecord)]}))
}

// All three per group of the dataset. Two more columns take groups together: the two groups in which the
// hand-written tables have about three quarters of the code points right, and the other four, in which they have
// 92% or more. Next to each stands how many of the runs are below the hand-written tables in the four groups, and
// how many are above them in the two.
const groups = [...groupNames].reverse()
const isOfTheTwoGroups = (group: string) => group === 'needs a nesting fix' || group === 'out of reach'
const twoGroups = groups.filter(isOfTheTwoGroups)
const fourGroups = groups.filter(group => !isOfTheTwoGroups(group))
const allThreeOfGroups = (together: readonly string[]) => (record: ArmRecord) => {
  const rows = together.map(group => rowNamed(record, `group: ${group}`))
  return rows.reduce((total, row) => total + row.allRight, 0) / rows.reduce((total, row) => total + row.codePoints, 0)
}
const ofFourGroups = allThreeOfGroups(fourGroups)
const ofTwoGroups = allThreeOfGroups(twoGroups)
const groupRow = (name: string, records: readonly ArmRecord[]) => {
  const perGroup = groups.map(group => spreadOver(records.map(allThreeOfGroups([group])), 1))
  const below = records.filter(record => ofFourGroups(record) < ofFourGroups(handRecord)).length
  const above = records.filter(record => ofTwoGroups(record) > ofTwoGroups(handRecord)).length
  const areRuns = records[0] !== handRecord
  console.log(`| ${name} | ${perGroup.join(' | ')} | ${spreadOver(records.map(ofFourGroups))} | ${areRuns ? `${below} of ${records.length}` : ''} | ${spreadOver(records.map(ofTwoGroups))} | ${areRuns ? `${above} of ${records.length}` : ''} |`)
}
console.log('')
console.log(`All three per group of the dataset. "The four groups" are ${fourGroups.join(', ')}, taken together, and "the two groups" are ${twoGroups.join(' and ')}.`)
console.log('')
console.log(`| tables | ${groups.join(' | ')} | the four groups | runs below the hand-written tables there | the two groups | runs above the hand-written tables there |`)
console.log(`| --- | ${groups.map(() => '---').join(' | ')} | --- | --- | --- | --- |`)
groupRow('hand-written', [handRecord])
for (const row of reportRows) {
  groupRow(`${row.label}, trained`, row.trained.map(run => run.record))
  groupRow(`${row.label}, searched`, row.searched.map(run => run.record))
}

// Whole samples in the group "needs a line rule", where one run can lose almost every sample.
const wholeInLineRule = (runs: readonly SavedRun[]) => runs.map(run => (100 * sharesOf(rowNamed(run.record, 'group: needs a line rule')).whole).toFixed(1)).join(', ')
console.log('')
console.log(`Whole samples in the group "needs a line rule", run by run: hand-written ${wholeInLineRule([{seed: null, record: handRecord, tables: hand}])}; ${reportRows.map(row => `${row.label}: trained ${wholeInLineRule(row.trained)}, searched ${wholeInLineRule(row.searched)}`).join('; ')}; 100%, searched with the most read cells first: ${wholeInLineRule(searchedMostReadFirst)}.`)

// The runs of the share 10 one by one: with a seed's own blanks, and with the blanks of one seed for every seed.
console.log('')
console.log('10% blanked, all three on all validation samples, the seeds one by one:')
console.log('')
for (const row of rowsOfTheShare10) {
  const allThree = (run: SavedRun) => (100 * allThreeOfAll.of(run.record)).toFixed(2)
  console.log(`- ${row.label}: not filled ${row.notFilled.map(allThree).join(', ')}; trained ${row.trained.map(allThree).join(', ')}; searched ${row.searched.map(allThree).join(', ')}.`)
}

// 2. How many blanked cells hold the hand-written choice again, by how many train samples read the cell.
const readerBins: {name: string, from: number, to: number}[] = [
  {name: '1 to 9', from: 1, to: 9}, {name: '10 to 99', from: 10, to: 99}, {name: '100 to 999', from: 100, to: 999}, {name: '1,000 or more', from: 1000, to: Infinity},
]
const isRead = (cell: Cell) => readersOf(trainReaders, cell) > 0
const sameNextState = (tables: RecoveryTables, {grammar, cell}: Cell) => grammar ? tables.grammarNext[cell] === hand.grammarNext[cell] : tables.lexerNext[cell] === hand.lexerNext[cell]
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
      + `| ${spreadOver(runs.map(handsChoiceShare), 1)} | ${spreadOver(runs.map(run => shareOf(run.blanked.filter(isRead), cell => sameChoice(run.tables, hand, cell))), 1)} `
      + `| ${spreadOver(runs.map(run => shareOf(run.blanked.filter(isRead), cell => sameNextState(run.tables, cell))), 1)} | ${readerBins.map(bin => pooled(readers => readers >= bin.from && readers <= bin.to)).join(' | ')} | ${pooled(readers => readers === 0)} |`)
  }
}
console.log('')
console.log('The share of the blanked cells that hold the hand-written choice again, training against the search:')
console.log('')
for (const row of reportRows) console.log(compared(row.label, {name: 'trained', values: row.trained.map(handsChoiceShare)}, {name: 'searched', values: row.searched.map(handsChoiceShare)}, 1))

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
  console.log(`| ${row.label} | ${[cells, counts.both, counts.onlyTrained, counts.onlySearched, counts.sameOther, counts.twoOthers].map(counted).join(' | ')} |`)
}

// The blanked cells of the share 10 that ended with another choice than the hand-written one, each judged alone and
// in both directions, by the scored code points with all three labels right: the filled tables against the same
// tables with the hand-written choice in that one cell, and the hand-written tables with the filled choice in that
// one cell against the hand-written tables. On the train split, which says what a run could learn about the cell,
// and on the validation split, which says what the score sees of the cell.
//
// Only cells are counted, no code points: the cells of filled tables were chosen to fit each other, so the code
// points that one cell is worth inside them do not add up.
//
// The exchange runs on the search's parser loop (../../search/sample-runs.ts), which counts what score.ts counts
// and runs only the samples that read the cell, each from its first read on.
const splitSamples = {train: prepareSamples(trainPartOfTheStandardSet()), validation: prepareSamples(validation)}
const splitNames = ['train', 'validation'] as const
// The samples whose run reads a cell with `tables`, for every cell.
function readersWith(samples: RunSamples, tables: RecoveryTables): (cell: Cell) => number[] {
  const bytesPerSample = Math.ceil(cellBitCount(tables) / 8)
  const cellsRead = new Uint8Array(samples.sampleCount * bytesPerSample)
  for (let sample = 0; sample < samples.sampleCount; sample++) {
    if (samples.changeableFrom[sample]! < samples.start[sample + 1]! - samples.start[sample]!) scoreOfSample(samples, sample, tables, cellsRead, sample * bytesPerSample)
  }
  return ({grammar, cell}) => {
    const bit = grammar ? tables.lexerNext.length + cell : cell
    const readers: number[] = []
    for (let sample = 0; sample < samples.sampleCount; sample++) if ((cellsRead[sample * bytesPerSample + (bit >> 3)]! & (1 << (bit & 7))) !== 0) readers.push(sample)
    return readers
  }
}
// How many more code points are right when one cell of `tables` holds the choice of `other`, or undefined when no
// sample reads the cell with `tables`: a text's run is the same up to its first read of the cell, so then no choice
// of the cell changes anything.
function gainOfExchange(samples: RunSamples, readers: (cell: Cell) => number[], tables: RecoveryTables, other: RecoveryTables, cell: Cell): number | undefined {
  const among = readers(cell)
  if (among.length === 0) return undefined
  const choice = cell.grammar ? Uint8Array.of(other.grammarNext[cell.cell]!, other.grammarAction[cell.cell]!) : Uint8Array.of(other.lexerNext[cell.cell]!, other.lexerEvent[cell.cell]!)
  return changesOfChoices(samples, among, tables, cell.grammar, cell.cell, choice).allRight[0]!
}
const readersWithHand = {train: readersWith(splitSamples.train, hand), validation: readersWith(splitSamples.validation, hand)}
// How the filled choice of a cell stands against the hand-written one on a split, by how many more code points the
// filled choice has right: no sample reads the cell, as many, more, or fewer.
type Outcome = 'notRead' | 'same' | 'more' | 'fewer'
const outcomeOf = (gainOfFilledChoice: number | undefined): Outcome => gainOfFilledChoice === undefined ? 'notRead' : gainOfFilledChoice === 0 ? 'same' : gainOfFilledChoice > 0 ? 'more' : 'fewer'
const noOutcomes = () => ({notRead: 0, same: 0, more: 0, fewer: 0})
const binsWithNone = [{name: 'none', from: 0, to: 0}, ...readerBins]
const cellName = (tables: RecoveryTables, {grammar, cell}: Cell) => grammar ? grammarCellName(tables, cell) : lexerCellName(tables, cell)
const choiceName = (tables: RecoveryTables, {grammar, cell}: Cell) => grammar ? grammarChoiceName(tables, cell) : lexerChoiceName(tables, cell)
const signed = (count: number | undefined) => count === undefined ? 'not read' : `${count > 0 ? '+' : ''}${counted(count)}`

const exchangeLines: string[] = []
const byReadersLines: string[] = []
const muchReadLines: string[] = []
for (const row of rowsOfTheShare10) {
  for (const [filledBy, runs] of [['training', row.trained], ['the search', row.searched]] as const) {
    const tallies = {train: {inFilled: noOutcomes(), inHand: noOutcomes(), moreInFilledAndFewerInHand: 0}, validation: {inFilled: noOutcomes(), inHand: noOutcomes(), moreInFilledAndFewerInHand: 0}}
    // The outcome in the filled tables on the train split, by how many train samples read the cell with the
    // hand-written tables.
    const byReaders = binsWithNone.map(() => noOutcomes())
    let blanked = 0
    let other = 0
    for (const run of runs) {
      const readersWithFilled = {train: readersWith(splitSamples.train, run.tables), validation: readersWith(splitSamples.validation, run.tables)}
      blanked += run.blanked.length
      for (const cell of run.blanked) {
        if (sameChoice(run.tables, hand, cell)) continue
        other++
        const readers = readersOf(trainReaders, cell)
        // What the filled choice has more than the hand-written one in this cell, in each direction.
        const gainsOn = (split: (typeof splitNames)[number]) => {
          const gainOfHandsChoice = gainOfExchange(splitSamples[split], readersWithFilled[split], run.tables, hand, cell)
          return {inFilled: gainOfHandsChoice === undefined ? undefined : 0 - gainOfHandsChoice, inHand: gainOfExchange(splitSamples[split], readersWithHand[split], hand, run.tables, cell)}
        }
        const gains = {train: gainsOn('train'), validation: gainsOn('validation')}
        for (const split of splitNames) {
          const {inFilled, inHand} = gains[split]
          tallies[split].inFilled[outcomeOf(inFilled)]++
          tallies[split].inHand[outcomeOf(inHand)]++
          if (inFilled !== undefined && inFilled > 0 && inHand !== undefined && inHand < 0) tallies[split].moreInFilledAndFewerInHand++
        }
        byReaders[binsWithNone.findIndex(bin => readers >= bin.from && readers <= bin.to)]![outcomeOf(gains.train.inFilled)]++
        if (row === reportRows[0] && filledBy === 'training' && readers >= 1000) {
          muchReadLines.push(`- seed ${run.seed}, ${cell.grammar ? 'grammar' : 'tokenizer'} cell ${cellName(hand, cell)}, ${counted(readers)} train samples read it: hand-written (${choiceName(hand, cell)}), trained (${choiceName(run.tables, cell)}). The trained choice against the hand-written one, in code points: in the trained tables ${signed(gains.train.inFilled)} on the train split and ${signed(gains.validation.inFilled)} on the validation split, in the hand-written tables ${signed(gains.train.inHand)} and ${signed(gains.validation.inHand)}.`)
        }
      }
    }
    for (const split of splitNames) {
      const {inFilled, inHand, moreInFilledAndFewerInHand} = tallies[split]
      exchangeLines.push(`| ${row.label} | ${filledBy} | ${split} | ${blanked} | ${other} | ${inFilled.notRead} | ${inFilled.same} | ${inFilled.more} | ${inFilled.fewer} | ${inHand.notRead} | ${inHand.same} | ${inHand.more} | ${inHand.fewer} | ${moreInFilledAndFewerInHand} |`)
    }
    const byReadersLine = (name: string, outcomes: ReturnType<typeof noOutcomes>) => `| ${row.label} | ${filledBy} | ${name} | ${outcomes.notRead + outcomes.same + outcomes.more + outcomes.fewer} | ${outcomes.notRead} | ${outcomes.same} | ${outcomes.fewer} | ${outcomes.more} |`
    binsWithNone.forEach((bin, index) => byReadersLines.push(byReadersLine(bin.name, byReaders[index]!)))
    byReadersLines.push(byReadersLine('all', tallies.train.inFilled))
  }
}
console.log('')
console.log('The blanked cells that ended with another choice than the hand-written one, 10% blanked, over the runs of a row. Each cell is judged alone, by the scored code points of a split with all three labels right, in two directions. "In the filled tables": the filled tables against the same tables with the hand-written choice in that one cell. "In the hand-written tables": the hand-written tables with the filled choice in that one cell against the hand-written tables. A cell that no sample of the split reads changes nothing.')
console.log('')
console.log('| blanked | filled by | split | blanked cells | with another choice than hand\'s | in the filled tables: not read | as many code points | the filled choice has more | the filled choice has fewer | in the hand-written tables: not read | as many code points | the filled choice has more | the filled choice has fewer | more in the filled tables and fewer in the hand-written ones |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const line of exchangeLines) console.log(line)
console.log('')
console.log('The same cells in the filled tables on the train split, by how many train samples read the cell with the hand-written tables. "The hand-written choice has more": the train samples ask for the hand-written choice in that cell of the filled tables, and the run did not put it there.')
console.log('')
console.log('| blanked | filled by | train samples that read the cell | cells with another choice than hand\'s | no train sample reads the cell with the filled tables | as many code points | the hand-written choice has more | the filled choice has more |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const line of byReadersLines) console.log(line)
console.log('')
console.log(`${reportRows[0]!.label} blanked, trained: the cells with another choice than the hand-written one that 1,000 or more train samples read, one by one. A number is what the trained choice has more (+) or fewer (-) than the hand-written choice in that one cell.`)
console.log('')
for (const line of muchReadLines) console.log(line)

// Where the filled tables show what the hand-written tables show, whatever the labels say: at the scored code
// points, and at the code points that the damage added, which have no label.
const shownByHand = {kind: new Int16Array(validation.codePointCount), depth: new Int16Array(validation.codePointCount), container: new Int8Array(validation.codePointCount)}
const trace = createTrace()
const brokenValidationPlaces = Array.from({length: validation.sampleCount}, (_, place) => place).filter(place => validation.firstDamage[place] !== -1)
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

// 3. Training against the search of the same cells.
console.log('')
console.log('Training against the search of the same blanked cells:')
console.log('')
for (const sharePercent of sharesOfTheArm) {
  const names = settingNamesOf(sharePercent)
  console.log(comparisons(savedResultOf(armNameOf(sharePercent), names.trained), savedResultOf(armNameOf(sharePercent), names.searched)))
  if (sharePercent === 10) console.log(comparisons(savedResultOf(armNameOf(sharePercent), names.trainedOnFixedBlanks), savedResultOf(armNameOf(sharePercent), names.searchedOnFixedBlanks)))
}
for (const row of reportRows) console.log(compared(`Whole samples, ${row.label}`, {name: 'trained', values: row.trained.map(run => wholeSamples.of(run.record))}, {name: 'searched', values: row.searched.map(run => wholeSamples.of(run.record))}))

// Every decision blanked: the search order by order, next to the training of the same cells.
const orderColumns: ((run: Run) => number)[] = [...measures.map(measure => (run: Run) => measure.of(run.record)), handsChoiceShare]
console.log('')
console.log(`Every decision blanked: the search of the ${everyDecision.trained[0]!.blanked.length} cells from today's tables, one order of the cells per row, and the training of the same cells.`)
console.log('')
console.log('| filled by | all three | within reach of the tables | whole samples | hand\'s choice, of all blanked cells |')
console.log('| --- | --- | --- | --- | --- |')
for (const run of searchOrders) console.log(`| the search, ${run.seed === null ? 'the most read cells first' : `a random order, seed ${run.seed}`} | ${orderColumns.map(of => spreadOver([of(run)])).join(' | ')} |`)
console.log(`| the search, the ${searchOrders.length} orders | ${orderColumns.map(of => spreadOver(searchOrders.map(of))).join(' | ')} |`)
console.log(`| training, ${everyDecision.trained.length} seeds | ${orderColumns.map(of => spreadOver(everyDecision.trained.map(of))).join(' | ')} |`)
console.log('')
for (const measure of measures) console.log(compared(measure.name, {name: `training, ${everyDecision.trained.length} seeds,`, values: everyDecision.trained.map(run => measure.of(run.record))}, {name: `the search, ${searchOrders.length} orders,`, values: searchOrders.map(run => measure.of(run.record))}))

// What the search tries in a tokenizer cell from today's choice does not hold every hand-written choice.
const tokenizerDecisions = blanksOf(100, 1).cells.filter(cell => !cell.grammar)
const choicesNotTried = new Map<string, number>()
for (const cell of tokenizerDecisions) {
  const candidates = candidatesOf(todays, cell)
  let tried = false
  for (let candidate = 0; candidate < candidates.length; candidate += 2) if (candidates[candidate] === hand.lexerNext[cell.cell] && candidates[candidate + 1] === hand.lexerEvent[cell.cell]) tried = true
  if (!tried) choicesNotTried.set(lexerChoiceName(hand, cell.cell), (choicesNotTried.get(lexerChoiceName(hand, cell.cell)) ?? 0) + 1)
}
console.log('')
console.log(`Of the ${tokenizerDecisions.length} decisions in the tokenizer's table, ${[...choicesNotTried.values()].reduce((total, count) => total + count, 0)} hold a choice that the search does not try from today's choice, since both parts differ from today's and no cell of today's table holds the pair: ${[...choicesNotTried].sort((left, right) => right[1] - left[1]).map(([choice, count]) => `(${choice}) in ${count} cells`).join(', ')}. The search can only get there in two steps. Every choice of a grammar cell is tried.`)

// 4. The share 100 against the same run with every open cell, and against the rows that every arm is read against.
const trained100 = savedResultOf(armNameOf(100), names100.trained)
console.log('')
console.log('Every decision blanked, so the cells that the person changed are the trainable cells: against every open cell as the trainable cells, and against the rows that every arm is read against:')
console.log('')
for (const other of [everyOpenCell.result, plainPass.result, handResult, toBeat]) console.log(comparisons(trained100, other))
console.log('')
console.log('Every open cell with the arm\'s setting of the trainer against the plain pass, which is one pass with the defaults:')
console.log('')
console.log(comparisons(everyOpenCell.result, plainPass.result))

// 5. What the main number does not show. Grammar cells with a stack action that does something else than their
// token does are counted as plainParserProblems counts them.
function otherStackActions(tables: RecoveryTables) {
  let count = 0
  for (let cell = 0; cell < tables.grammarAction.length; cell++) {
    const action = tables.grammarAction[cell]!
    if (action !== actionByToken && action !== actionOfToken[Math.floor(cell / tables.contextCount) % tables.tokenCount]) count++
  }
  return count
}
type Column = {name: string, of: (run: SavedRun) => number, digits: number}
const wrongDepths: Column[] = [
  {name: 'wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers', of: run => run.record.wrongDepthsOnDeepValidJson.nothingAfter, digits: 1},
  {name: 'the same, members after', of: run => run.record.wrongDepthsOnDeepValidJson.membersAfter, digits: 1},
]
const notShown: Column[] = [{name: 'added code points shown as an error', of: run => run.record.addedShownAsError, digits: 1}, ...wrongDepths]
const settingsOfTheReport: {name: string, runs: readonly SavedRun[]}[] = [
  {name: 'hand-written, 35 rules', runs: [{seed: null, record: handRecord, tables: hand}]},
  {name: 'search from the hand-written tables', runs: [{seed: null, record: toBeat.records[0]!, tables: loadTablesOfThisDataset(numberToBeatFileOf(scratch)).tables}]},
  {name: 'the plain pass: every open cell, one pass, defaults', runs: plainPass.runs},
  ...reportRows.flatMap(row => [
    ...(row.label === '100%' ? [] : [{name: `${row.label}, not filled`, runs: row.notFilled}]),
    {name: `${row.label}, trained`, runs: row.trained}, {name: `${row.label}, searched`, runs: row.searched},
  ]),
  {name: '100%, searched with the most read cells first', runs: searchedMostReadFirst},
  {name: 'every open cell, the arm\'s setting of the trainer', runs: everyOpenCell.runs},
]
console.log('')
console.log('What the main number does not show:')
console.log('')
console.log(`| setting | ${notShown.map(column => column.name).join(' | ')} | code points shown as past the end | grammar cells with a stack action that does something else than their token |`)
console.log(`| --- | ${notShown.map(() => '---').join(' | ')} | --- | --- |`)
for (const {name, runs} of settingsOfTheReport) {
  console.log(`| ${name} | ${notShown.map(column => spreadOver(runs.map(column.of), column.digits)).join(' | ')} | ${countsOver(runs.map(run => run.record.shownAsPastEnd))} | ${countsOver(runs.map(run => otherStackActions(run.tables)))} |`)
}
const brokenGroundRules = settingsOfTheReport.flatMap(({name, runs}) => runs.filter(run => !run.record.groundRules.hold).map(run => `${name}${run.seed === null ? '' : `, seed ${run.seed}`}`))
console.log('')
console.log(brokenGroundRules.length === 0 ? 'The ground rules hold on the fixed texts for every run of the table.' : `The ground rules do NOT hold on the fixed texts for: ${brokenGroundRules.join('; ')}.`)
console.log('')
console.log('Every decision blanked, by which cells are trainable and by the setting of the trainer:')
console.log('')
const trainings: {name: string, runs: readonly SavedRun[]}[] = [
  {name: 'the person\'s 915 cells, the arm\'s setting', runs: everyDecision.trained}, {name: 'every open cell, the arm\'s setting', runs: everyOpenCell.runs}, {name: 'every open cell, the plain pass', runs: plainPass.runs},
]
const columnsOfTheTrainings: Column[] = [...measures.map(measure => ({name: measure.name, of: (run: SavedRun) => measure.of(run.record), digits: 2})), ...wrongDepths]
console.log(`| trainable cells, setting of the trainer | ${columnsOfTheTrainings.map(column => column.name).join(' | ')} | grammar cells with a stack action that does something else than their token |`)
console.log(`| --- | ${columnsOfTheTrainings.map(() => '---').join(' | ')} | --- |`)
for (const {name, runs} of [...trainings, {name: 'the hand-written tables', runs: [{seed: null, record: handRecord, tables: hand}]}]) {
  console.log(`| ${name} | ${columnsOfTheTrainings.map(column => spreadOver(runs.map(column.of), column.digits)).join(' | ')} | ${countsOver(runs.map(run => otherStackActions(run.tables)))} |`)
}
console.log('')
for (const [first, second] of [[0, 1], [1, 2], [0, 2]] as const) {
  for (const column of [columnsOfTheTrainings[2]!, ...wrongDepths]) {
    console.log(compared(column.name, {name: `${trainings[first]!.name},`, values: trainings[first]!.runs.map(column.of)}, {name: `${trainings[second]!.name},`, values: trainings[second]!.runs.map(column.of)}, column.digits))
  }
}

console.log('')
console.log(describeSettings([
  ...rowsOfBaselines, toBeat, plainPass.result,
  ...sharesOfTheArm.flatMap(sharePercent => {
    const names = settingNamesOf(sharePercent)
    const namesOfShare = sharePercent === 100 ? [names.trained, names.searched, names.searchedMostReadFirst, names.everyOpenCellTrained]
      : sharePercent === 10 ? [names.notFilled, names.trained, names.searched, names.trainedOnFixedBlanks, names.searchedOnFixedBlanks] : [names.notFilled, names.trained, names.searched]
    return namesOfShare.map(name => savedResultOf(armNameOf(sharePercent), name))
  }),
]))
