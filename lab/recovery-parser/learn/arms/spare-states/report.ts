// The tables of README.md of the arm "spare states", from the runs that run.ts saved. It trains nothing: it reads
// the saved records and tables, and per saved tables it counts how much the exact parser is in a spare state and
// scores the same tables without their spare states. Those counts take a few seconds per tables, so they are kept
// in a file next to the tables, with a hash of the tables, and made again when the tables are others.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after run.ts:
//   bun lab/recovery-parser/learn/arms/spare-states/report.ts
// A setting without a saved run of 3 seeds or more is left out, e.g. one whose run is still going, and the last
// line says how many are missing.
import {existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {refuseUnknownOptions} from '../../data.ts'
import {type RecoveryTables, asIsTables, differencesOf, lexerStateNames, loadTablesOfThisDataset, today} from '../../recovery-tables.ts'
import {type Score, rowOf, scoreTables, sharesOf} from '../../score.ts'
import {createCellArrays, mixesInto, snappedTables} from '../../soft/twin.ts'
import {
  type ArmRecord, type SettingResult, type Spread, armFolderOf, baselines, describeComparison, describeSettings, fileNameOf, percentSpread, rowNamed, savedResultOf, spreadOf, trainPartOfTheStandardSet,
  validationOfTheStandardSet,
} from '../harness.ts'
import {
  type BaseKind, type SpareCounts, type TrainerSetting, baseOf, cellsInto, codePointsIn, createSpareModel, describeTrainer, namedTrainerSettings, reportedRows, sameState, searchSettingNameOf, settingNameOf, spareStatesOf, standInSamplesOf, stateUseOf, withoutSpareStates,
} from './spare-states.ts'

refuseUnknownOptions('arms/spare-states/report.ts', [])
const validation = validationOfTheStandardSet()
const train = trainPartOfTheStandardSet()
const standInSamples = standInSamplesOf(train)
const trainers = [namedTrainerSettings['plain']!, namedTrainerSettings['three-passes']!]
// The numbers of spare states of the reported runs, each as spare tokenizer states and spare grammar states.
const reportedCounts: SpareCounts[] = [[1, 0], [2, 0], [4, 0], [8, 0], [16, 0], [0, 1], [0, 2], [0, 4], [4, 2]].map(([tokenizer, grammar]) => ({tokenizer: tokenizer!, grammar: grammar!}))
const noSpareState: SpareCounts = {tokenizer: 0, grammar: 0}
const countsName = (spare: SpareCounts) => spare.tokenizer + spare.grammar === 0 ? 'none' : [...(spare.tokenizer === 0 ? [] : [`${spare.tokenizer} tokenizer`]), ...(spare.grammar === 0 ? [] : [`${spare.grammar} grammar`])].join(' and ')

// What the exact parser does with the spare states of one saved tables.
type UseOfSpareStates = {
  // A hash of the file of the tables that the counts are of.
  tablesHash: string
  // How many spare states a train sample reads, how many a cell of another state leads into, and how many are the
  // same state as a spare state with a lower number.
  readByTrain: number
  ledInto: number
  copies: number
  // The share of the code points of the broken validation samples from their first error on that are read in a
  // spare state of the tokenizer, and in one of the grammar. And the share that is read in a tokenizer state of
  // today's other than `string` and `between`, e.g. in a state of a number: after an error, tables can use such a
  // state for something else than its name says.
  tokenizerShare: number
  grammarShare: number
  otherTokenizerStatesShare: number
  // The validation score of the same tables without their spare states, per reported row as the share of all three,
  // and the share of whole samples: with every spare state sent to its stand-in, folded into its stand-in, and sent
  // to the base's choices.
  sent: {allThree: number[], whole: number}
  folded: {allThree: number[], whole: number}
  toBase: {allThree: number[], whole: number}
}

// The saved runs of one setting: its result, and per run what the parser does with the spare states.
type SavedRuns = {name: string, spare: SpareCounts, result: SettingResult, use: UseOfSpareStates[]}

// The saved runs of the setting `name` of an arm, whose tables have `spare` states on a base of the given kind, or
// undefined when the setting has no saved run.
function savedRunsOf(armName: string, name: string, kind: BaseKind, spare: SpareCounts): SavedRuns | undefined {
  const folder = join(armFolderOf(armName), fileNameOf(name))
  if (!existsSync(folder) || !readdirSync(folder).some(fileName => fileName.endsWith('.record.json'))) return undefined
  const result = savedResultOf(armName, name)
  const base = baseOf(kind, spare)
  const partOf = (score: Score) => ({allThree: reportedRows.map(({row}) => sharesOf(rowOf(score, row)!).allThree), whole: sharesOf(score.rows[0]!).whole})
  const use = (result.seeds.length === 0 ? ['no-seed'] : result.seeds.map(seed => `seed-${seed}`)).map(run => {
    const tablesFile = join(folder, `${run}.tables.json`)
    const useFile = join(folder, `${run}.use.json`)
    const tablesHash = Bun.hash(readFileSync(tablesFile)).toString(16)
    if (existsSync(useFile)) {
      const saved = JSON.parse(readFileSync(useFile, 'utf8')) as UseOfSpareStates
      if (saved.tablesHash === tablesHash) return saved
    }
    const tables = loadTablesOfThisDataset(tablesFile).tables
    const spareStates = spareStatesOf(tables)
    const onTrain = stateUseOf(tables, train)
    const onValidation = stateUseOf(tables, validation)
    const shareOf = (grammar: boolean) => spareStates.filter(state => state.grammar === grammar).reduce((total, state) => total + codePointsIn(onValidation, state), 0) / onValidation.codePoints
    const made: UseOfSpareStates = {
      tablesHash, readByTrain: spareStates.filter(state => codePointsIn(onTrain, state) > 0).length, ledInto: spareStates.filter(state => cellsInto(tables, state) > 0).length,
      copies: spareStates.filter((state, index) => spareStates.slice(0, index).some(earlier => sameState(tables, earlier, state))).length,
      tokenizerShare: shareOf(false), grammarShare: shareOf(true),
      otherTokenizerStatesShare: lexerStateNames.reduce((total, name, state) => total + (name === 'string' || name === 'between' ? 0 : onValidation.lexerCodePoints[state]!), 0) / onValidation.codePoints,
      sent: partOf(scoreTables(withoutSpareStates(tables, 'sent', base, standInSamples), validation)), folded: partOf(scoreTables(withoutSpareStates(tables, 'folded', base, standInSamples), validation)),
      toBase: partOf(scoreTables(withoutSpareStates(tables, 'base', base, standInSamples), validation)),
    }
    writeFileSync(useFile, `${JSON.stringify(made)}\n`)
    return made
  })
  return {name, spare, result, use}
}
const trainedRunsOf = (armName: string, kind: BaseKind, spare: SpareCounts, trainer: TrainerSetting, noise?: number) => savedRunsOf(armName, settingNameOf(kind, spare, trainer, noise), kind, spare)

const allThreeOf = (rowName: string) => (record: ArmRecord) => sharesOf(rowNamed(record, rowName)).allThree
const wholeOf = (record: ArmRecord) => sharesOf(rowNamed(record, 'all')).whole
const overRecords = (result: SettingResult, value: (record: ArmRecord) => number) => spreadOf(result.records.map(value))
// A spread of differences in points, e.g. "-1.24 (-1.60 to -0.90)".
const pointsSpread = (values: readonly number[]) => {
  const {mean, lowest, highest} = spreadOf(values)
  const signed = (value: number) => `${value > 0 ? '+' : ''}${(100 * value).toFixed(2)}`
  return values.length === 1 ? signed(mean) : `${signed(mean)} (${signed(lowest)} to ${signed(highest)})`
}
// Two spreads next to each other, by the rule of describeComparison: the difference of the means in points, and
// whether the two ranges overlap.
const against = (first: Spread, second: Spread) =>
  `${first.mean >= second.mean ? '+' : ''}${(100 * (first.mean - second.mean)).toFixed(2)}, ${first.lowest <= second.highest && second.lowest <= first.highest ? 'overlap' : 'apart'}`

const wholeOfUnquotedKeys = (record: ArmRecord) => sharesOf(rowNamed(record, 'kind: unquotedKey')).whole
const columns = [...reportedRows.map(({row, label}) => ({label, of: allThreeOf(row)})), {label: 'whole samples', of: wholeOf}, {label: 'whole samples, unquotedKey', of: wholeOfUnquotedKeys}]
const columnHeads = `${columns.map(column => column.label).join(' | ')} |`
const columnRules = `${columns.map(() => '---').join(' | ')} |`

// The tables of one base and one trainer's setting: the scores of every number of spare states next to the control,
// each against the control, and what the parser does with the spare states. `controlRuns` are the control's saved
// runs when it is a setting of the arm: a baseline has no file of tables to count in.
function describeRuns(title: string, control: SettingResult, runs: readonly SavedRuns[], controlRuns?: SavedRuns) {
  console.log('')
  console.log(`### ${title}`)
  console.log('')
  console.log(`All three per row of the score, and whole samples of all validation samples and of the ones with a key without quotes. The control is ${JSON.stringify(control.name)}.`)
  console.log('')
  console.log(`| spare states | ${columnHeads}`)
  console.log(`| --- | ${columnRules}`)
  console.log(`| none, the control | ${columns.map(column => percentSpread(overRecords(control, column.of))).join(' | ')} |`)
  for (const run of runs) console.log(`| ${countsName(run.spare)} | ${columns.map(column => percentSpread(overRecords(run.result, column.of))).join(' | ')} |`)
  console.log('')
  console.log('Against the control: the difference of the two means in points, and whether the two ranges overlap. "overlap" means that these seeds do not tell the setting from the control.')
  console.log('')
  console.log(`| spare states | ${columnHeads}`)
  console.log(`| --- | ${columnRules}`)
  for (const run of runs) console.log(`| ${countsName(run.spare)} | ${columns.map(column => against(overRecords(run.result, column.of), overRecords(control, column.of))).join(' | ')} |`)
  console.log('')
  for (const run of runs) for (const rowName of ['all', 'group: within reach of the tables']) console.log(`- ${describeComparison(run.result, control, rowName)}`)
  console.log('')
  console.log('What the exact parser does with the spare states. The code points are the ones of the broken validation samples from their first error on.')
  console.log('')
  console.log('| spare states | spare states that a train sample reads | code points read in a spare tokenizer state, % | in a tokenizer state of today\'s other than `string` and `between`, % | in a spare grammar state, % |')
  console.log('| --- | --- | --- | --- | --- |')
  const shares = (run: SavedRuns, share: (use: UseOfSpareStates) => number) => percentSpread(spreadOf(run.use.map(share)), 1)
  if (controlRuns !== undefined) console.log(`| none, the control | | 0.0 | ${shares(controlRuns, use => use.otherTokenizerStatesShare)} | 0.0 |`)
  for (const run of runs) {
    const read = run.use.map(use => use.readByTrain)
    console.log(`| ${countsName(run.spare)} | ${Math.min(...read) === Math.max(...read) ? read[0] : `${Math.min(...read)} to ${Math.max(...read)}`} of ${run.spare.tokenizer + run.spare.grammar} | ${shares(run, use => use.tokenizerShare)} | ${shares(run, use => use.otherTokenizerStatesShare)} | ${shares(run, use => use.grammarShare)} |`)
  }
  if (controlRuns !== undefined) {
    // Where the control is after a first error, next to today's tables: the tokenizer states of today's that the
    // most code points are read in, without `string` and `between`.
    const mostRead = (tables: RecoveryTables) => {
      const use = stateUseOf(tables, validation)
      return lexerStateNames.map((name, state) => ({name, share: use.lexerCodePoints[state]! / use.codePoints})).filter(({name}) => name !== 'string' && name !== 'between')
        .sort((left, right) => right.share - left.share).slice(0, 5).map(({name, share}) => `${name} ${(100 * share).toFixed(1)}%`).join(', ')
    }
    const controlTables = loadTablesOfThisDataset(join(armFolderOf('spare-states'), fileNameOf(controlRuns.name), `seed-${controlRuns.result.seeds[0]}.tables.json`)).tables
    console.log('')
    console.log(`The tokenizer states of today's that the most of these code points are read in, without \`string\` and \`between\`. The control's seed ${controlRuns.result.seeds[0]}: ${mostRead(controlTables)}. Today's tables: ${mostRead(asIsTables())}.`)
  }
  console.log('')
  console.log('The same tables without their spare states, scored again: the spare states are taken away one after the other, each sent to its stand-in, each folded into its stand-in, or each sent to the base\'s choices. The differences from the tables with the spare states are in points, per seed.')
  console.log('')
  console.log('| spare states | sent: all three | within reach | whole samples | unquotedKey | folded: all three | within reach | whole samples | unquotedKey | sent to the base\'s choices: all three |')
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  const columnOf = (rowName: string) => reportedRows.findIndex(({row}) => row === rowName)
  const unquotedKeyColumn = columnOf('kind: unquotedKey')
  const characterClassColumn = columnOf('group: needs a character class')
  for (const run of runs) {
    const drops = (part: (use: UseOfSpareStates) => number, value: (record: ArmRecord) => number) => pointsSpread(run.use.map((use, index) => part(use) - value(run.result.records[index]!)))
    const dropsOf = (way: 'sent' | 'folded') => [
      drops(use => use[way].allThree[0]!, allThreeOf('all')), drops(use => use[way].allThree[1]!, allThreeOf('group: within reach of the tables')), drops(use => use[way].whole, wholeOf),
      drops(use => use[way].allThree[unquotedKeyColumn]!, allThreeOf('kind: unquotedKey')),
    ].join(' | ')
    console.log(`| ${countsName(run.spare)} | ${dropsOf('sent')} | ${dropsOf('folded')} | ${drops(use => use.toBase.allThree[0]!, allThreeOf('all'))} |`)
  }
  console.log('')
  console.log('The tables with every spare state folded into a state of today\'s, in which no text is in a spare state, against the control: the score, and in brackets the difference of the two means and whether the two ranges overlap.')
  console.log('')
  console.log('| spare states that were folded | all three | within reach | whole samples | needs a character class | unquotedKey |')
  console.log('| --- | --- | --- | --- | --- | --- |')
  for (const run of runs) {
    const foldedAgainst = (part: (use: UseOfSpareStates) => number, value: (record: ArmRecord) => number) => {
      const spread = spreadOf(run.use.map(part))
      return `${percentSpread(spread)} (${against(spread, overRecords(control, value))})`
    }
    console.log(`| ${countsName(run.spare)} | ${foldedAgainst(use => use.folded.allThree[0]!, allThreeOf('all'))} | ${foldedAgainst(use => use.folded.allThree[1]!, allThreeOf('group: within reach of the tables'))} | ${foldedAgainst(use => use.folded.whole, wholeOf)} `
      + `| ${foldedAgainst(use => use.folded.allThree[characterClassColumn]!, allThreeOf('group: needs a character class'))} | ${foldedAgainst(use => use.folded.allThree[unquotedKeyColumn]!, allThreeOf('kind: unquotedKey'))} |`)
  }
  console.log('')
  console.log('All three on all validation samples, the seeds one by one:')
  console.log('')
  for (const run of [{spare: noSpareState, result: control}, ...runs]) console.log(`- ${countsName(run.spare)}: ${run.result.records.map(record => (100 * allThreeOf('all')(record)).toFixed(2)).join(', ')}`)
}

const missing: string[] = []
// The settings that have a saved run with 3 seeds or more, which a comparison needs. The others are named at the end,
// e.g. a setting whose run is still going.
const found = (runs: (SavedRuns | undefined)[], names: string[]) => runs.filter((run, index): run is SavedRuns => {
  const isReported = run !== undefined && run.result.seeds.length >= 3
  if (!isReported) missing.push(names[index]!)
  return isReported
})

// The tuning runs: the size of the random part of a spare state's start, with 4 spare tokenizer states and with 1.
console.log('## The start of a spare state, tuning runs')
const sizesOfTheRandomPart = [0, 0.3, 1, 2, 3]
const tunedSeeds = [11, 12, 13]
for (const tuned of [{tokenizer: 4, grammar: 0}, {tokenizer: 1, grammar: 0}]) {
  const base = baseOf('today', tuned)
  const firstSpareCell = today.lexerStateCount * base.classCount
  for (const trainer of trainers) {
    const runs = sizesOfTheRandomPart.map(noise => ({noise, run: trainedRunsOf('spare-states-tune', 'today', tuned, trainer, noise)})).filter((entry): entry is {noise: number, run: SavedRuns} => entry.run !== undefined)
    if (runs.length === 0) continue
    console.log('')
    console.log(`${countsName(tuned)} spare state${tuned.tokenizer === 1 ? '' : 's'}, ${describeTrainer(trainer)}, the seeds ${runs[0]!.run.result.seeds.join(', ')}:`)
    console.log('')
    console.log('| noise | all three | within reach | whole samples | spare states that are a copy of another spare state, per seed | that a cell of another state leads into | that a train sample reads | own cells of the spare states that differ from the base, of all | validation code points read in a spare state, % | all three without the spare states, each sent to its stand-in |')
    console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    for (const {noise, run} of runs) {
      // The cells of the spare states that the run changed, whether a text reads them or not.
      const ownCellsChanged = run.result.seeds.map(seed => {
        const tables = loadTablesOfThisDataset(join(armFolderOf('spare-states-tune'), fileNameOf(run.name), `seed-${seed}.tables.json`)).tables
        let changed = 0
        for (let cell = firstSpareCell; cell < base.lexerNext.length; cell++) if (tables.lexerNext[cell] !== base.lexerNext[cell] || tables.lexerEvent[cell] !== base.lexerEvent[cell]) changed++
        return changed
      })
      console.log(`| ${noise} | ${percentSpread(overRecords(run.result, allThreeOf('all')))} | ${percentSpread(overRecords(run.result, allThreeOf('group: within reach of the tables')))} | ${percentSpread(overRecords(run.result, wholeOf))} `
        + `| ${run.use.map(use => use.copies).join(', ')} | ${run.use.map(use => use.ledInto).join(', ')} | ${run.use.map(use => use.readByTrain).join(', ')} | ${ownCellsChanged.join(', ')} of ${base.lexerNext.length - firstSpareCell} `
        + `| ${percentSpread(spreadOf(run.use.map(use => use.tokenizerShare)))} | ${pointsSpread(run.use.map((use, index) => use.sent.allThree[0]! - allThreeOf('all')(run.result.records[index]!)))} |`)
    }
    // Where a run starts, before any training: how much of an open cell's mix leads into a spare state, over the
    // open tokenizer cells of today's states, and in how many cells the start already snaps to another choice than
    // the base's.
    console.log('')
    for (const noise of sizesOfTheRandomPart) {
      const starts = tunedSeeds.map(seed => {
        const model = createSpareModel(base, 'today', seed, trainer, noise)
        const mixes = createCellArrays(model.shape)
        mixesInto(model, 1, mixes)
        const shares: number[] = []
        for (let cell = 0; cell < firstSpareCell; cell++) {
          if (model.trainableLexer[cell] === 0) continue
          let share = 0
          for (let state = today.lexerStateCount; state < base.lexerStateCount; state++) share += mixes.lexerNext[cell * base.lexerStateCount + state]!
          shares.push(share)
        }
        return {mean: shares.reduce((total, share) => total + share, 0) / shares.length, highest: Math.max(...shares), snappedAway: differencesOf(base, snappedTables(model)).length}
      })
      console.log(`- The start with noise ${noise}: ${percentSpread(spreadOf(starts.map(start => start.mean)), 1)}% of an open cell's mix leads into a spare state, ${percentSpread(spreadOf(starts.map(start => start.highest)), 1)}% in the cell with the most, and the snapped tables differ from the base in ${starts.map(start => start.snappedAway).join(', ')} cells before any training.`)
    }
  }
}

console.log('')
console.log('## The reported runs')
const everyResult: SettingResult[] = []
for (const trainer of trainers) {
  const control = trainedRunsOf('spare-states', 'today', noSpareState, trainer)
  if (control === undefined) {
    missing.push(settingNameOf('today', noSpareState, trainer))
    continue
  }
  const runs = found(reportedCounts.map(spare => trainedRunsOf('spare-states', 'today', spare, trainer)), reportedCounts.map(spare => settingNameOf('today', spare, trainer)))
  describeRuns(`Today's tables with spare states, every open cell trainable, ${describeTrainer(trainer)}`, control.result, runs, control)
  everyResult.push(control.result, ...runs.map(run => run.result))
}
// The runs from tables that a person wrote: the control is those tables, which have no seed.
const rowsOfBaselines = baselines()
const handWritten = rowsOfBaselines.at(-1)!
const words = rowsOfBaselines.find(baseline => baseline.name.includes('hand rule words'))!
const lines = rowsOfBaselines.find(baseline => baseline.name.includes('hand rule lines'))!
for (const {kind, control, title} of [{kind: 'hand-written', control: handWritten, title: 'The hand-written tables'}, {kind: 'words', control: words, title: 'The dataset\'s hand rule `words`'}] as const) {
  for (const trainer of trainers) {
    const runs = found(reportedCounts.map(spare => trainedRunsOf('spare-states', kind, spare, trainer)), reportedCounts.map(spare => settingNameOf(kind, spare, trainer)))
    if (runs.length === 0) continue
    describeRuns(`${title} with spare states, only the spare states' cells and the steps into them trainable, ${describeTrainer(trainer)}`, control, runs)
    everyResult.push(...runs.map(run => run.result))
  }
}
console.log('')
console.log(`The dataset's hand rule \`lines\`, which is \`words\` with one more tokenizer state: ${columns.map(column => `${column.label} ${percentSpread(overRecords(lines, column.of))}`).join(', ')}.`)
// The search of search.ts: per base and number of spare states, each order of the cells with the spare states and
// without them.
for (const kind of ['today', 'hand-written'] as const) {
  for (const spare of reportedCounts) {
    const runsOf = (counts: SpareCounts) => (['most read first', 'random'] as const).map(order => savedRunsOf('spare-states-search', searchSettingNameOf(kind, counts, order), kind, counts))
    const withSpare = runsOf(spare)
    const without = runsOf(noSpareState)
    if (withSpare.some(run => run === undefined) || without.some(run => run === undefined)) continue
    console.log('')
    console.log(`### The search of every open cell from ${kind === 'today' ? 'today\'s tables' : 'the hand-written tables'}, ${countsName(spare)} spare states`)
    console.log('')
    console.log('| order of the cells | with the spare states: all three | within reach | whole samples | spare states that a train sample reads | validation code points read in a spare state, % | the same tables with the spare states sent to their stand-ins: all three | folded: all three | searched without spare states: all three | within reach | whole samples |')
    console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
    const scores = (record: ArmRecord) => [allThreeOf('all'), allThreeOf('group: within reach of the tables'), wholeOf].map(value => (100 * value(record)).toFixed(2)).join(' | ')
    const orders = withSpare.flatMap((run, index) => run!.result.records.map((record, at) => ({
      name: run!.result.seeds.length === 0 ? 'the most read cells first' : `a random order, seed ${run!.result.seeds[at]}`, record, use: run!.use[at]!, control: without[index]!.result.records[at]!,
    })))
    for (const order of orders) {
      console.log(`| ${order.name} | ${scores(order.record)} | ${order.use.readByTrain} of ${spare.tokenizer + spare.grammar} | ${(100 * (order.use.tokenizerShare + order.use.grammarShare)).toFixed(2)} `
        + `| ${(100 * order.use.sent.allThree[0]!).toFixed(2)} | ${(100 * order.use.folded.allThree[0]!).toFixed(2)} | ${scores(order.control)} |`)
    }
    const spreads = (records: ArmRecord[]) => [allThreeOf('all'), allThreeOf('group: within reach of the tables'), wholeOf].map(value => percentSpread(spreadOf(records.map(value)))).join(' | ')
    console.log(`| the ${orders.length} orders | ${spreads(orders.map(order => order.record))} | | | | | ${spreads(orders.map(order => order.control))} |`)
    everyResult.push(...withSpare.map(run => run!.result), ...without.map(run => run!.result))
  }
}
console.log('')
console.log(describeSettings([words, lines, handWritten, ...everyResult]))
if (missing.length > 0) {
  console.log('')
  console.log(`${missing.length} settings have no saved run of 3 seeds or more, e.g. ${JSON.stringify(missing[0])}.`)
}
