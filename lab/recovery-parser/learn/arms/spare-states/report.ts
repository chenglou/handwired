// The tables of README.md of the arm "spare states", from the runs that run.ts and search.ts saved. It trains
// nothing: it reads the saved records and tables, and use.ts counts per saved tables what the exact parser does
// with the spare states.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after run.ts:
//   bun lab/recovery-parser/learn/arms/spare-states/report.ts
// A reported setting without a saved run is left out and named in the last line.
import {existsSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {refuseUnknownOptions} from '../../data.ts'
import {type RecoveryTables, asIsTables, differencesOf, lexerStateNames, loadTablesOfThisDataset, today} from '../../recovery-tables.ts'
import {sharesOf} from '../../score.ts'
import {createCellArrays, mixesInto, snappedTables} from '../../soft/twin.ts'
import {type ArmRecord, type SettingResult, type Spread, armFolderOf, baselines, describeComparison, fileNameOf, percentSpread, rowNamed, savedResultOf, spreadOf, validationOfTheStandardSet} from '../harness.ts'
import {
  type BaseKind, type SpareCounts, type TrainerSetting, baseOf, createSpareModel, defaultNoise, namedTrainerSettings, reportedRows, searchSettingNameOf, settingNameOf, stateUseOf,
} from './spare-states.ts'
import {type UseOfSpareStates, useOfSavedTables} from './use.ts'

refuseUnknownOptions('arms/spare-states/report.ts', [])
const plain = namedTrainerSettings['plain']!
const threePasses = namedTrainerSettings['three-passes']!
const trainerLabel = (trainer: TrainerSetting) => trainer === plain ? 'plain pass' : '3 passes'
const spareCountsOf = (entries: string): SpareCounts[] => entries.split(',').map(entry => {
  const [tokenizer, grammar] = entry.split('+').map(Number)
  return {tokenizer: tokenizer!, grammar: grammar!}
})
const noSpareState: SpareCounts = {tokenizer: 0, grammar: 0}
// The spare states of a run in a sentence, e.g. "4 spare tokenizer states and 2 spare grammar states", and as the
// name of a row, e.g. "4 tokenizer and 2 grammar".
const inWords = (spare: SpareCounts) => (['tokenizer', 'grammar'] as const).filter(table => spare[table] > 0).map(table => `${spare[table]} spare ${table} state${spare[table] === 1 ? '' : 's'}`).join(' and ')
const countsName = (spare: SpareCounts) => spare.tokenizer + spare.grammar === 0 ? 'none' : [...(spare.tokenizer === 0 ? [] : [`${spare.tokenizer} tokenizer`]), ...(spare.grammar === 0 ? [] : [`${spare.grammar} grammar`])].join(' and ')

// The reported runs, as the commands of README.md ran them: per kind of base and trainer's setting, the numbers of
// spare states, each as spare tokenizer states and spare grammar states.
const reportedOfToday = [{trainer: plain, spare: spareCountsOf('1+0,2+0,4+0,8+0,16+0,0+1,0+2,0+4,4+2')}, {trainer: threePasses, spare: spareCountsOf('2+0,4+0,8+0,0+2')}]
const reportedBesideAPerson = [
  {kind: 'hand-written', trainer: plain, spare: spareCountsOf('2+0,4+0,0+2,2+2,4+2')}, {kind: 'hand-written', trainer: threePasses, spare: spareCountsOf('2+2,4+2')},
  {kind: 'words', trainer: plain, spare: spareCountsOf('1+0,2+0')},
] as const

// The saved runs of one setting: its result, and per run what the parser does with the spare states.
type SavedRuns = {kind: BaseKind, spare: SpareCounts, folder: string, result: SettingResult, use: UseOfSpareStates[]}
// The saved runs of the setting `name` of an arm, whose tables have `spare` states on a base of the given kind, or
// undefined when the setting has no saved run.
function savedRunsOf(armName: string, name: string, kind: BaseKind, spare: SpareCounts): SavedRuns | undefined {
  const folder = join(armFolderOf(armName), fileNameOf(name))
  if (!existsSync(folder) || !readdirSync(folder).some(fileName => fileName.endsWith('.record.json'))) return undefined
  const result = savedResultOf(armName, name)
  const base = baseOf(kind, spare)
  const use = (result.seeds.length === 0 ? ['no-seed'] : result.seeds.map(seed => `seed-${seed}`)).map(run => useOfSavedTables(join(folder, `${run}.tables.json`), base))
  return {kind, spare, folder, result, use}
}

// A row of a table: the saved runs of one setting, under a short name, e.g. "plain pass: 4 tokenizer".
type Row = {name: string, trainer: TrainerSetting, runs: SavedRuns}
// The rows that are read against one control. `controlRuns` are the control's saved runs when it is a setting of
// the arm: a baseline has no file of tables to count in. `references` are other tables without a seed, shown next
// to the control.
type Block = {controlName: string, control: SettingResult, controlRuns?: SavedRuns, references: {name: string, result: SettingResult}[], rows: Row[]}

// The code points of the broken validation samples from their first error on: the only ones that can be read in a
// spare state.
const validation = validationOfTheStandardSet()
const codePointsFromAFirstError = stateUseOf(asIsTables(), validation).codePoints

const missing: string[] = []
// The rows of the settings that have a saved run with 3 seeds or more, which a comparison needs. The others are
// named in the last line, e.g. a setting whose run is still going.
function rowsOf(kind: BaseKind, trainer: TrainerSetting, spareCounts: readonly SpareCounts[], nameOf: (spare: SpareCounts) => string): Row[] {
  return spareCounts.flatMap(spare => {
    const settingName = settingNameOf(kind, spare, trainer)
    const runs = savedRunsOf('spare-states', settingName, kind, spare)
    if (runs !== undefined && runs.result.seeds.length >= 3) return [{name: nameOf(spare), trainer, runs}]
    missing.push(settingName)
    return []
  })
}

const allThreeOf = (rowName: string) => (record: ArmRecord) => sharesOf(rowNamed(record, rowName)).allThree
const wholeOf = (rowName: string) => (record: ArmRecord) => sharesOf(rowNamed(record, rowName)).whole
const overRecords = (result: SettingResult, value: (record: ArmRecord) => number) => spreadOf(result.records.map(value))
const signed = (points: number) => `${points > 0 ? '+' : ''}${points.toFixed(2)}`
// A spread of differences in points, e.g. "-1.24 (-1.60 to -0.90)".
const pointsSpread = (values: readonly number[]) => {
  const {mean, lowest, highest} = spreadOf(values)
  return values.length === 1 ? signed(100 * mean) : `${signed(100 * mean)} (${signed(100 * lowest)} to ${signed(100 * highest)})`
}
const pointsPerSeed = (values: readonly number[]) => values.map(value => signed(100 * value)).join(', ')
// A range of counts over the seeds, e.g. "155 to 192".
const countRange = (values: readonly number[]) => Math.min(...values) === Math.max(...values) ? Math.min(...values).toLocaleString('en-US') : `${Math.min(...values).toLocaleString('en-US')} to ${Math.max(...values).toLocaleString('en-US')}`
// Two spreads by the rule of describeComparison: they are apart when the two ranges do not overlap, i.e. every seed
// of one is above every seed of the other. A spread that is apart from its control's is printed in bold.
const areApart = (first: Spread, second: Spread) => first.lowest > second.highest || second.lowest > first.highest
const marked = (spread: Spread, control: Spread) => areApart(spread, control) ? `**${percentSpread(spread)}**` : percentSpread(spread)
const table = (heads: readonly string[], lines: readonly (readonly string[])[]) => [`| ${heads.join(' | ')} |`, `| ${heads.map(() => '---').join(' | ')} |`, ...lines.map(line => `| ${line.join(' | ')} |`)].join('\n')
const print = (...paragraphs: string[]) => {
  for (const paragraph of paragraphs) {
    console.log('')
    console.log(paragraph)
  }
}

// The scores of some blocks: all three per reported row, whole samples of all validation samples, and whole samples
// of one more row.
function describeScores(blocks: readonly Block[], wholeRow: {row: string, label: string}) {
  const columns = [...reportedRows.map(({row, label}) => ({label, of: allThreeOf(row)})), {label: 'whole samples', of: wholeOf('all')}, {label: `whole samples, ${wholeRow.label}`, of: wholeOf(wholeRow.row)}]
  const plainLine = (name: string, result: SettingResult) => [name, ...columns.map(column => percentSpread(overRecords(result, column.of)))]
  print('Scores. All three per row of the score, then whole samples. In bold: the range is apart from the control\'s, i.e. every seed is on one side of every seed of the control.', table(['tables', ...columns.map(column => column.label)], blocks.flatMap(block => [
    plainLine(block.controlName, block.control), ...block.references.map(reference => plainLine(reference.name, reference.result)),
    ...block.rows.map(row => [row.name, ...columns.map(column => marked(overRecords(row.runs.result, column.of), overRecords(block.control, column.of)))]),
  ])))
  const perSeed = (result: SettingResult, value: (record: ArmRecord) => number, digits: number) => result.records.map(record => (100 * value(record)).toFixed(digits)).join(', ')
  const wholeCounts = (result: SettingResult, rowName: string) => result.records.map(record => rowNamed(record, rowName).wholeSamples.toLocaleString('en-US')).join(', ')
  const withSomethingToRecover = (rowName: string) => {
    const row = rowNamed(blocks[0]!.control.records[0]!, rowName)
    return (row.samples - row.nothingToRecover).toLocaleString('en-US')
  }
  print(`The seeds one by one: all three on all samples, then whole samples of all samples, as a percentage and as a count of the ${withSomethingToRecover('all')} samples with something to recover, then whole samples, ${wholeRow.label}, of ${withSomethingToRecover(wholeRow.row)} samples.`,
    blocks.flatMap(block => [{name: block.controlName, result: block.control}, ...block.references, ...block.rows.map(row => ({name: row.name, result: row.runs.result}))])
      .map(({name, result}) => `- ${name}: ${perSeed(result, allThreeOf('all'), 2)}; ${perSeed(result, wholeOf('all'), 2)} (${wholeCounts(result, 'all')}); ${perSeed(result, wholeOf(wholeRow.row), 1)} (${wholeCounts(result, wholeRow.row)})`).join('\n'))
}

// The comparisons of a row with its control over every row of the records, in all three and in whole samples, each
// with the broken validation samples of the row, the difference of the two means in points, and whether the two
// ranges are apart.
function comparisonsOf(row: Row, control: SettingResult) {
  const comparisons: {rowName: string, samples: number, measure: string, difference: number, apart: boolean}[] = []
  for (const {name, samples} of control.records[0]!.rows) {
    for (const [measure, value] of [['all three', allThreeOf(name)], ['whole samples', wholeOf(name)]] as const) {
      const ours = overRecords(row.runs.result, value)
      const theirs = overRecords(control, value)
      if (!Number.isNaN(ours.mean) && !Number.isNaN(theirs.mean)) comparisons.push({rowName: name, samples, measure, difference: 100 * (ours.mean - theirs.mean), apart: areApart(ours, theirs)})
    }
  }
  return comparisons
}
const describeDifference = (comparison: ReturnType<typeof comparisonsOf>[number]) => `${comparison.rowName}${comparison.measure === 'all three' ? '' : `, ${comparison.measure}`} ${signed(comparison.difference)} (${comparison.samples.toLocaleString('en-US')} samples)`
const describeDifferences = (comparisons: ReturnType<typeof comparisonsOf>) => comparisons.length === 0 ? 'none' : comparisons.map(describeDifference).join('; ')

// Every row of the records against a control that has the same seeds: how many comparisons are apart and which,
// the same-seed differences of the main number, and the row whose mean falls most.
function describeEveryRow(blocks: readonly Block[]) {
  for (const block of blocks) {
    const perRow = block.rows.map(row => ({row, comparisons: comparisonsOf(row, block.control)}))
    const all = perRow.flatMap(({comparisons}) => comparisons)
    const apart = all.filter(comparison => comparison.apart)
    print(`Against "${block.controlName}", over the ${block.control.records[0]!.rows.length} rows of a record, in all three and in whole samples: ${apart.length} of ${all.length.toLocaleString('en-US')} comparisons are apart, ${apart.filter(comparison => comparison.difference > 0).length} of them upward. Per setting, the comparisons that are apart, with the difference of the means in points, then the largest fall of a mean of all three:`,
      perRow.map(({row, comparisons}) => {
        const largestFall = comparisons.filter(comparison => comparison.measure === 'all three').sort((left, right) => left.difference - right.difference)[0]!
        return `- ${row.name}: ${comparisons.filter(comparison => comparison.apart).length} apart: ${describeDifferences(comparisons.filter(comparison => comparison.apart))}. Largest fall: ${describeDifference(largestFall)}${largestFall.apart ? ', apart' : ', ranges overlap'}.`
      }).join('\n'))
  }
  // The main number with the same seed: a setting against its control, seed by seed.
  const sameSeed = blocks.flatMap(block => block.rows.map(row => ({row, differences: row.runs.result.records.map((record, index) => allThreeOf('all')(record) - allThreeOf('all')(block.control.records[index]!))})))
  const summary = (pairs: typeof sameSeed) => {
    const differences = pairs.flatMap(pair => pair.differences)
    return `above the control in ${differences.filter(difference => difference > 0).length} of ${differences.length} pairs, by ${signed(100 * spreadOf(differences).mean)} points on average`
  }
  print('All three on all samples, a setting against its control with the same seed, in points:', sameSeed.map(({row, differences}) => `- ${row.name}: ${pointsPerSeed(differences)}: above in ${differences.filter(difference => difference > 0).length} of ${differences.length}, ${signed(100 * spreadOf(differences).mean)} on average`).join('\n'),
    `The settings with 4 spare tokenizer states or more: ${summary(sameSeed.filter(({row}) => row.runs.spare.tokenizer >= 4))}. The other settings: ${summary(sameSeed.filter(({row}) => row.runs.spare.tokenizer < 4))}.`)
}

// Every row of the records against a control without a seed: the rows of all three that every seed has on one side
// of the control, by half a point or more on average.
function describeRowsOnOneSide(blocks: readonly Block[]) {
  print(`Rows of all three, of the ${blocks[0]!.control.records[0]!.rows.length} of a record, in which every seed is on one side of the control and the mean differs by 0.5 points or more:`, blocks.flatMap(block => block.rows.map(row => {
    const oneSided = comparisonsOf(row, block.control).filter(comparison => comparison.measure === 'all three' && comparison.apart && Math.abs(comparison.difference) >= 0.5).sort((left, right) => left.difference - right.difference)
    return `- ${row.name}: below: ${describeDifferences(oneSided.filter(comparison => comparison.difference < 0))}. Above: ${describeDifferences(oneSided.filter(comparison => comparison.difference > 0).reverse())}.`
  })).join('\n'))
}

// What the exact parser does with the spare states, and the same tables without them. The last columns are, with
// 'the folded tables', the scores of the tables with every spare state folded away, as tables of their own against
// the control, whose row is then the first one, and with 'one table', what the tables lose when only the spare
// states of one table are taken away.
function describeUse(blocks: readonly Block[], lastColumns: 'the folded tables' | 'one table') {
  const shares = (use: readonly UseOfSpareStates[], share: (use: UseOfSpareStates) => number) => percentSpread(spreadOf(use.map(share)), 1)
  const lossesOf = (row: Row, part: (use: UseOfSpareStates) => number, value: (record: ArmRecord) => number) => row.runs.use.map((use, index) => part(use) - value(row.runs.result.records[index]!))
  const smallerLosses = (row: Row, part: (use: UseOfSpareStates) => {sent: number, folded: number} | null) => row.runs.use.some(use => part(use) === null) ? '' : pointsPerSeed(lossesOf(row, use => Math.max(part(use)!.sent, part(use)!.folded), allThreeOf('all')))
  const foldedColumns = [{label: 'the folded tables: all three', row: 'all'}, {label: 'needs a character class', row: 'group: needs a character class'}, {label: 'unquotedKey', row: 'kind: unquotedKey'}]
    .map(({label, row}) => ({label, of: allThreeOf(row), part: (use: UseOfSpareStates) => use.folded.allThree[reportedRows.findIndex(reported => reported.row === row)]!}))
  const withFolded = lastColumns === 'the folded tables'
  print(`What the exact parser does with the spare states, and the same tables without them. The code points are the ones of the broken validation samples from their first error on, ${codePointsFromAFirstError.toLocaleString('en-US')} of them. "Sent" and "folded": the spare states are taken away one after the other, each sent to its stand-in or folded into it, and the tables are scored again: the differences from the tables with the spare states, in points. `
    + (withFolded ? 'The folded tables are tables in which no text is in a spare state: their scores, in bold where the range is apart from the control\'s.' : 'The last two columns are of tables with spare states of both tables: only the spare states of one table are taken away, and the others are kept.'),
  table([
    'tables', 'spare states that a train sample reads', 'code points read in a spare tokenizer state, %', 'in a spare grammar state, %', ...(withFolded ? ['in a tokenizer state of today\'s other than `string` and `between`, %'] : []),
    'sent: all three', 'whole samples', 'folded: all three', 'whole samples', 'the smaller of the two losses of all three, seed by seed',
    ...(withFolded ? foldedColumns.map(column => column.label) : ['only the spare tokenizer states taken away: the smaller loss, seed by seed', 'only the spare grammar states taken away: the smaller loss, seed by seed']),
  ], blocks.flatMap(block => [
    ...(withFolded && block.controlRuns !== undefined ? [[block.controlName, '', '0.0', '0.0', shares(block.controlRuns.use, use => use.otherTokenizerStatesShare), '', '', '', '', '', ...foldedColumns.map(column => percentSpread(overRecords(block.control, column.of)))]] : []),
    ...block.rows.map(row => {
      const read = row.runs.use.map(use => use.readByTrain)
      const sent = lossesOf(row, use => use.sent.allThree[0]!, allThreeOf('all'))
      const folded = lossesOf(row, use => use.folded.allThree[0]!, allThreeOf('all'))
      return [
        row.name, `${countRange(read)} of ${row.runs.spare.tokenizer + row.runs.spare.grammar}`, shares(row.runs.use, use => use.tokenizerShare), shares(row.runs.use, use => use.grammarShare),
        ...(withFolded ? [shares(row.runs.use, use => use.otherTokenizerStatesShare)] : []),
        pointsSpread(sent), pointsSpread(lossesOf(row, use => use.sent.whole, wholeOf('all'))), pointsSpread(folded), pointsSpread(lossesOf(row, use => use.folded.whole, wholeOf('all'))), pointsPerSeed(sent.map((loss, index) => Math.max(loss, folded[index]!))),
        ...(withFolded ? foldedColumns.map(column => marked(spreadOf(row.runs.use.map(column.part)), overRecords(block.control, column.of))) : [smallerLosses(row, use => use.onlyTokenizerStates), smallerLosses(row, use => use.onlyGrammarStates)]),
      ]
    }),
  ])))
}

// Where a run starts, before any training: per table, the share of an open cell's mix that is on the base's next
// state and the share that leads into a spare state, as means over the open cells of today's states, and in how
// many cells the start already snaps to another choice than the base's.
function startOf(kind: BaseKind, spare: SpareCounts, trainer: TrainerSetting, seed: number, noise: number = defaultNoise) {
  const base = baseOf(kind, spare)
  const model = createSpareModel(base, kind, seed, trainer, noise)
  const mixes = createCellArrays(model.shape)
  mixesInto(model, 1, mixes)
  const sharesOfTable = (trainable: Uint8Array, cellsOfTodaysStates: number, mix: Float64Array, width: number, baseNext: Uint8Array, firstSpare: number) => {
    let cells = 0
    let onBase = 0
    let intoSpare = 0
    for (let cell = 0; cell < cellsOfTodaysStates; cell++) {
      if (trainable[cell] === 0) continue
      cells++
      onBase += mix[cell * width + baseNext[cell]!]!
      for (let state = firstSpare; state < width; state++) intoSpare += mix[cell * width + state]!
    }
    return {onBase: onBase / cells, intoSpare: intoSpare / cells}
  }
  return {
    tokenizer: sharesOfTable(model.trainableLexer, today.lexerStateCount * base.classCount, mixes.lexerNext, base.lexerStateCount, base.lexerNext, today.lexerStateCount),
    grammar: sharesOfTable(model.trainableGrammar, today.grammarStateCount * base.tokenCount * base.contextCount, mixes.grammarNext, base.grammarStateCount, base.grammarNext, today.grammarStateCount),
    snappedAway: differencesOf(base, snappedTables(model)).length,
  }
}
const startsOf = (row: Row) => row.runs.result.seeds.map(seed => startOf(row.runs.kind, row.runs.spare, row.trainer, seed))
const percentOver = (values: readonly number[]) => percentSpread(spreadOf(values), 1)

// The start of the runs in which every open cell is trainable.
function describeStart(blocks: readonly Block[]) {
  print('Where the runs start, before any training, over the seeds of the run. The shares are means over the open cells of today\'s states.',
    table(['tables', 'open tokenizer cells: share of the mix on the base\'s next state, %', 'that leads into a spare state, %', 'open grammar cells: on the base\'s next state, %', 'that leads into a spare state, %', 'cells in which the snapped start differs from the base'],
      blocks.flatMap(block => block.rows).map(row => {
        const starts = startsOf(row)
        return [row.name, percentOver(starts.map(start => start.tokenizer.onBase)), percentOver(starts.map(start => start.tokenizer.intoSpare)), percentOver(starts.map(start => start.grammar.onBase)), percentOver(starts.map(start => start.grammar.intoSpare)), countRange(starts.map(start => start.snappedAway))]
      })))
}

// Beside a person's rules: how much of the person's tables a run moves, and where it starts.
function describeMoved(blocks: readonly Block[]) {
  print('What a run changes in the person\'s tables, over the seeds: the cells of the person\'s states that lead into a spare state after the run, how many of them the person\'s rules had set, i.e. the person\'s tables hold another choice than today\'s there, and in how many broken validation samples the text reads such a cell. And where the run starts: the share of the person\'s next state in the mix of an open cell, as a mean over the open cells of the person\'s states, and the cells in which the start already snaps to a spare state.',
    table(['tables', 'cells of the person\'s states that lead into a spare state', 'of them, cells that the person\'s rules set', `validation samples in which the text reads such a cell, of ${blocks[0]!.rows[0]!.runs.use[0]!.brokenSamples.toLocaleString('en-US')}`, 'at the start: the person\'s next state in the mix of an open tokenizer cell, %', 'of an open grammar cell, %', 'cells in which the snapped start differs from the person\'s tables'],
      blocks.flatMap(block => block.rows).map(row => {
        const starts = startsOf(row)
        const {use} = row.runs
        return [row.name, countRange(use.map(one => one.cellsIntoSpareStates)), countRange(use.map(one => one.cellsIntoSpareStatesThatTheBaseSet)), countRange(use.map(one => one.samplesThatReadSuchACell)), percentOver(starts.map(start => start.tokenizer.onBase)), percentOver(starts.map(start => start.grammar.onBase)), countRange(starts.map(start => start.snappedAway))]
      })))
}

const comparedRows = ['all', 'group: within reach of the tables']
const describeSentences = (blocks: readonly Block[]) => print('The sentences of describeComparison:', blocks.flatMap(block => block.rows.flatMap(row => comparedRows.map(rowName => `- ${describeComparison(row.runs.result, block.control, rowName)}`))).join('\n'))
// The two settings of the trainer against each other, where both ran on the same base with the same spare states.
const describeTrainers = (blocks: readonly Block[]) => print('The two settings of the trainer with the same spare states:', blocks.flatMap(block => block.rows.filter(row => row.trainer === threePasses).flatMap(row => {
  const withPlain = block.rows.find(other => other.trainer === plain && other.runs.spare.tokenizer === row.runs.spare.tokenizer && other.runs.spare.grammar === row.runs.spare.grammar)
  return withPlain === undefined ? [] : comparedRows.map(rowName => `- ${describeComparison(row.runs.result, withPlain.runs.result, rowName)}`)
})).join('\n'))

// The tuning runs, on the seeds 11, 12 and 13: the size of the random part of a spare state's start, `noise`.
console.log('## The start of a spare state, tuning runs')
const tunedSettings = [
  ...[0, 0.3, 1, 2, 3].map(noise => ({spare: {tokenizer: 4, grammar: 0}, trainer: plain, noise})), {spare: {tokenizer: 1, grammar: 0}, trainer: plain, noise: 0},
  {spare: {tokenizer: 4, grammar: 0}, trainer: threePasses, noise: 1},
]
print('Every run with a size of the random part that is not the default, and the run with 3 passes on the same seeds. "Sent" is all three of the same tables with every spare state sent to its stand-in, as a difference in points.', table(
  ['spare states', 'trainer', 'noise', 'all three', 'within reach', 'whole samples', 'at the start: share of an open tokenizer cell\'s mix that leads into a spare state, %', 'cells in which the snapped start differs from the base, per seed', 'spare states that are a copy of another spare state, per seed', 'spare states that a train sample reads, per seed', 'own cells of the spare states that differ from the base, per seed', `validation code points read in a spare state, of ${codePointsFromAFirstError.toLocaleString('en-US')}, per seed`, 'sent: all three'],
  tunedSettings.flatMap(({spare, trainer, noise}) => {
    const name = settingNameOf('today', spare, trainer, noise)
    const run = savedRunsOf('spare-states-tune', name, 'today', spare)
    if (run === undefined) {
      missing.push(name)
      return []
    }
    const base = baseOf('today', spare)
    const firstSpareCell = today.lexerStateCount * base.classCount
    // The cells of the spare states that the run changed, whether a text reads them or not.
    const ownCellsChanged = run.result.seeds.map(seed => {
      const tables = loadTablesOfThisDataset(join(run.folder, `seed-${seed}.tables.json`)).tables
      let changed = 0
      for (let cell = firstSpareCell; cell < base.lexerNext.length; cell++) if (tables.lexerNext[cell] !== base.lexerNext[cell] || tables.lexerEvent[cell] !== base.lexerEvent[cell]) changed++
      return changed
    })
    const starts = run.result.seeds.map(seed => startOf('today', spare, trainer, seed, noise))
    return [[
      countsName(spare), trainerLabel(trainer), String(noise), percentSpread(overRecords(run.result, allThreeOf('all'))), percentSpread(overRecords(run.result, allThreeOf('group: within reach of the tables'))), percentSpread(overRecords(run.result, wholeOf('all'))),
      percentOver(starts.map(start => start.tokenizer.intoSpare)), starts.map(start => start.snappedAway).join(', '), run.use.map(use => use.copies).join(', '), run.use.map(use => use.readByTrain).join(', '), `${ownCellsChanged.join(', ')} of ${base.lexerNext.length - firstSpareCell}`,
      run.use.map(use => Math.round(use.tokenizerShare * codePointsFromAFirstError).toLocaleString('en-US')).join(', '), pointsSpread(run.use.map((use, index) => use.sent.allThree[0]! - allThreeOf('all')(run.result.records[index]!))),
    ]]
  })))

print('## Today\'s tables with spare states, every open cell trainable')
const blocksOfToday = reportedOfToday.flatMap(({trainer, spare}): Block[] => {
  const controlRuns = savedRunsOf('spare-states', settingNameOf('today', noSpareState, trainer), 'today', noSpareState)
  if (controlRuns === undefined) {
    missing.push(settingNameOf('today', noSpareState, trainer))
    return []
  }
  return [{controlName: `${trainerLabel(trainer)}: none, the control`, control: controlRuns.result, controlRuns, references: [], rows: rowsOf('today', trainer, spare, counts => `${trainerLabel(trainer)}: ${countsName(counts)}`)}]
})
describeScores(blocksOfToday, {row: 'kind: unquotedKey', label: 'unquotedKey'})
describeEveryRow(blocksOfToday)
describeUse(blocksOfToday, 'the folded tables')
describeStart(blocksOfToday)
// Where the control is after a first error, next to today's tables: the tokenizer states of today's that the most
// code points are read in, without `string` and `between`.
const mostRead = (tables: RecoveryTables) => {
  const use = stateUseOf(tables, validation)
  return lexerStateNames.map((name, state) => ({name, share: use.lexerCodePoints[state]! / use.codePoints})).filter(({name}) => name !== 'string' && name !== 'between')
    .sort((left, right) => right.share - left.share).slice(0, 5).map(({name, share}) => `${name} ${(100 * share).toFixed(1)}%`).join(', ')
}
for (const block of blocksOfToday) {
  const firstSeed = block.control.seeds[0]
  print(`The tokenizer states of today's that the most code points from a first error on are read in, without \`string\` and \`between\`. "${block.controlName}", seed ${firstSeed}: ${mostRead(loadTablesOfThisDataset(join(block.controlRuns!.folder, `seed-${firstSeed}.tables.json`)).tables)}. Today's tables: ${mostRead(asIsTables())}.`)
}
describeSentences(blocksOfToday)

print('## Spare states beside rules that a person wrote: only the spare states\' cells and the steps into them trainable')
const rowsOfBaselines = baselines()
const baselineNamed = (part: string) => rowsOfBaselines.find(baseline => baseline.name.includes(part))!
const persons = {
  'hand-written': {label: 'hand-written', control: baselineNamed('hand-written'), references: []},
  words: {label: '`words`', control: baselineNamed('hand rule words'), references: [{name: '`lines`: `words` with a state that a person added', result: baselineNamed('hand rule lines')}]},
}
const blocksBesideAPerson = (['hand-written', 'words'] as const).map((kind): Block => ({
  controlName: `${persons[kind].label}, the control`, control: persons[kind].control, references: persons[kind].references,
  rows: reportedBesideAPerson.filter(reported => reported.kind === kind).flatMap(({trainer, spare}) => rowsOf(kind, trainer, spare, counts => `${persons[kind].label} + ${countsName(counts)}, ${trainerLabel(trainer)}`)),
}))
describeScores(blocksBesideAPerson, {row: 'group: needs a line rule', label: 'needs a line rule'})
describeRowsOnOneSide(blocksBesideAPerson)
describeMoved(blocksBesideAPerson)
describeUse(blocksBesideAPerson, 'one table')
describeSentences(blocksBesideAPerson)
describeTrainers(blocksBesideAPerson)

// The search of search.ts, which was run from the hand-written tables with 2 spare tokenizer states: each order of
// the cells with the spare states and without them.
const searched: {name: string, result: SettingResult}[] = []
const searchedSpare: SpareCounts = {tokenizer: 2, grammar: 0}
const searchRunsOf = (spare: SpareCounts) => (['most read first', 'random'] as const).flatMap(order => {
  const name = searchSettingNameOf('hand-written', spare, order)
  const runs = savedRunsOf('spare-states-search', name, 'hand-written', spare)
  if (runs === undefined) missing.push(name)
  return runs === undefined ? [] : [runs]
})
const searchedWith = searchRunsOf(searchedSpare)
const searchedWithout = searchRunsOf(noSpareState)
if (searchedWith.length === 2 && searchedWithout.length === 2) {
  const scoreColumns = [allThreeOf('all'), allThreeOf('group: within reach of the tables'), wholeOf('all')]
  const scores = (record: ArmRecord) => scoreColumns.map(value => (100 * value(record)).toFixed(2))
  const spreads = (ofRecords: ArmRecord[]) => scoreColumns.map(value => percentSpread(spreadOf(ofRecords.map(value))))
  const orders = searchedWith.flatMap((runs, index) => runs.result.records.map((record, at) => ({
    name: runs.result.seeds.length === 0 ? 'the most read cells first' : `a random order, seed ${runs.result.seeds[at]}`, record, use: runs.use[at]!, control: searchedWithout[index]!.result.records[at]!,
  })))
  print(`## The search of every open cell from the hand-written tables with ${inWords(searchedSpare)}`, table(
    ['order of the cells', 'with the spare states: all three', 'within reach', 'whole samples', 'spare states that a train sample reads', 'validation code points read in a spare state, %', 'the same tables with the spare states sent to their stand-ins: all three', 'folded: all three', 'searched without spare states: all three', 'within reach', 'whole samples'],
    [
      ...orders.map(order => [order.name, ...scores(order.record), `${order.use.readByTrain} of ${searchedSpare.tokenizer + searchedSpare.grammar}`, (100 * (order.use.tokenizerShare + order.use.grammarShare)).toFixed(2), (100 * order.use.sent.allThree[0]!).toFixed(2), (100 * order.use.folded.allThree[0]!).toFixed(2), ...scores(order.control)]),
      [`the ${orders.length} orders`, ...spreads(orders.map(order => order.record)), '', '', '', '', ...spreads(orders.map(order => order.control))],
    ]))
  const orderNames = ['the most read cells first', 'random orders']
  searched.push(...searchedWith.map((runs, index) => ({name: `search from the hand-written tables with ${inWords(searchedSpare)}, ${orderNames[index]}`, result: runs.result})))
  searched.push(...searchedWithout.map((runs, index) => ({name: `search from the hand-written tables, ${orderNames[index]}`, result: runs.result})))
}

print('## What the main number does not show')
const everyRow = [
  ...blocksOfToday.flatMap(block => [{name: block.controlName, result: block.control}, ...block.rows.map(row => ({name: row.name, result: row.runs.result}))]),
  ...blocksBesideAPerson.flatMap(block => [{name: block.controlName, result: block.control}, ...block.references, ...block.rows.map(row => ({name: row.name, result: row.runs.result}))]), ...searched,
]
// How many of some records have a wrong depth on valid JSON that is too deep, in one of the two forms of such texts,
// e.g. "2 of 5".
const withAWrongDepth = (ofRecords: readonly ArmRecord[], form: 'nothingAfter' | 'membersAfter') => `${ofRecords.filter(record => record.wrongDepthsOnDeepValidJson[form] > 0).length} of ${ofRecords.length}`
print('From the records. The last four columns are the depth of valid JSON of 17 to 19 levels, which no sample holds: the share of wrong depths from the 17th bracket on and how many seeds have a wrong depth at all, on texts with nothing after their nested containers and on texts with members after them.',
  table(['tables', 'cells changed against the base', 'added code points shown as an error, %', 'code points shown as past the end', 'wrong depths, nothing after, %', 'seeds with a wrong depth', 'wrong depths, members after, %', 'seeds with a wrong depth'], everyRow.map(({name, result}) => {
    const counts = (value: (record: ArmRecord) => number) => {
      const spread = overRecords(result, value)
      return spread.count === 1 || spread.lowest === spread.highest ? Math.round(spread.mean).toLocaleString('en-US') : `${Math.round(spread.mean).toLocaleString('en-US')} (${spread.lowest.toLocaleString('en-US')} to ${spread.highest.toLocaleString('en-US')})`
    }
    return [
      name, counts(record => record.cellsChangedAgainstBase.total), percentSpread(overRecords(result, record => record.addedShownAsError), 1), counts(record => record.shownAsPastEnd),
      percentSpread(overRecords(result, record => record.wrongDepthsOnDeepValidJson.nothingAfter), 1), withAWrongDepth(result.records, 'nothingAfter'), percentSpread(overRecords(result, record => record.wrongDepthsOnDeepValidJson.membersAfter), 1), withAWrongDepth(result.records, 'membersAfter'),
    ]
  })))
const records = everyRow.flatMap(({result}) => result.records)
const recordsOfRows = (rows: readonly Row[]) => rows.flatMap(row => row.runs.result.records)
print([
  `- The ground rules hold on the fixed texts in ${records.filter(record => record.groundRules.hold).length} of the ${records.length} records of the table.`,
  `- Tables of the dataset's plain table parser, in every record of the row: ${everyRow.filter(({result}) => result.records.every(record => record.plainParserProblems.length === 0)).map(({name}) => name).join('; ')}.`,
  ...blocksOfToday.map(block => `- Seeds with a wrong depth, all settings with spare states against "${block.controlName}": ${withAWrongDepth(recordsOfRows(block.rows), 'nothingAfter')} with nothing after and ${withAWrongDepth(recordsOfRows(block.rows), 'membersAfter')} with members after, where the control has ${withAWrongDepth(block.control.records, 'nothingAfter')} and ${withAWrongDepth(block.control.records, 'membersAfter')}.`),
].join('\n'))
if (missing.length > 0) print(`${missing.length} settings of this report have no saved run, or one of fewer than 3 seeds: ${missing.map(name => JSON.stringify(name)).join(', ')}.`)
