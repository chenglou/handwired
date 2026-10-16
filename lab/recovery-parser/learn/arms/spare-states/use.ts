// What the exact parser does with the spare states of saved tables, as report.ts reads it: how much of a text is
// read in a spare state, which cells of today's states lead into one, and the score of the same tables without
// their spare states. The counts take a few seconds per tables, so they are kept in a file next to the tables,
// e.g. seed-1.use.json next to seed-1.tables.json, with a hash of the tables and of the two source files that make
// the counts: for other tables or other code the counts are made again.
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import type {Samples} from '../../data.ts'
import {createTrace} from '../../recovery-parser.ts'
import {type RecoveryTables, actionByToken, lexerStateNames, loadTablesOfThisDataset, today} from '../../recovery-tables.ts'
import {type Score, rowOf, runOnSample, scoreTables, sharesOf} from '../../score.ts'
import {trainPartOfTheStandardSet, validationOfTheStandardSet} from '../harness.ts'
import {type SpareState, cellsInto, codePointsIn, reportedRows, sameState, spareStatesOf, standInSamplesOf, stateUseOf, withoutSpareStates} from './spare-states.ts'

// A validation score of tables without their spare states: all three per reported row, and whole samples of all
// validation samples, as shares.
type ScoreWithout = {allThree: number[], whole: number}

export type UseOfSpareStates = {
  // A hash of the file of the tables and of the source files that make the counts.
  key: string
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
  // The cells of today's states that lead into a spare state, how many of them hold another choice than today's in
  // the base, which beside a person's rules are the cells that the rules set, and in how many of the broken
  // validation samples the text reads such a cell.
  cellsIntoSpareStates: number
  cellsIntoSpareStatesThatTheBaseSet: number
  samplesThatReadSuchACell: number
  brokenSamples: number
  // The same tables without their spare states, each sent to its stand-in and each folded into its stand-in.
  sent: ScoreWithout
  folded: ScoreWithout
  // For tables with spare states of both tables: all three on all validation samples with only the spare tokenizer
  // states taken away, and with only the spare grammar states taken away, in each of the two ways. Null for tables
  // whose spare states are all of one table.
  onlyTokenizerStates: {sent: number, folded: number} | null
  onlyGrammarStates: {sent: number, folded: number} | null
}

// The cells of today's states that lead into a spare state, see UseOfSpareStates.
function cellsIntoSpareStatesOf(tables: RecoveryTables, base: RecoveryTables, samples: Samples) {
  const lexerInto = new Uint8Array(tables.lexerNext.length)
  const grammarInto = new Uint8Array(tables.grammarNext.length)
  let cells = 0
  let thatTheBaseSet = 0
  for (let cell = 0; cell < today.lexerStateCount * tables.classCount; cell++) {
    if (tables.lexerNext[cell]! < today.lexerStateCount) continue
    lexerInto[cell] = 1
    cells++
    if (base.lexerNext[cell] !== today.lexerNext[cell] || base.lexerEvent[cell] !== today.lexerEvent[cell]) thatTheBaseSet++
  }
  for (let cell = 0; cell < today.grammarStateCount * tables.tokenCount * tables.contextCount; cell++) {
    if (tables.grammarNext[cell]! < today.grammarStateCount) continue
    grammarInto[cell] = 1
    cells++
    if (base.grammarNext[cell] !== today.grammarNext[cell] || base.grammarAction[cell] !== actionByToken) thatTheBaseSet++
  }
  const trace = createTrace()
  let samplesThatRead = 0
  let brokenSamples = 0
  for (let place = 0; place < samples.sampleCount; place++) {
    const firstError = samples.firstErrorPosition[place]!
    if (samples.firstDamage[place] === -1 || firstError === -1) continue
    brokenSamples++
    runOnSample(trace, samples, place, tables)
    const length = samples.start[place + 1]! - samples.start[place]!
    for (let position = firstError; position < length; position++) {
      if (lexerInto[trace.lexerCell[position]!] === 0 && grammarInto[trace.grammarCell[position]!] === 0) continue
      samplesThatRead++
      break
    }
  }
  return {cells, thatTheBaseSet, samplesThatRead, brokenSamples}
}

const sourceHash = Bun.hash(['use.ts', 'spare-states.ts'].map(fileName => readFileSync(join(import.meta.dir, fileName), 'utf8')).join('\n')).toString(16)

// The counts of the saved tables of `tablesFile`, which a run made from `base`: read from the file next to the
// tables when that file is of the same tables and the same code, and made and saved otherwise.
export function useOfSavedTables(tablesFile: string, base: RecoveryTables): UseOfSpareStates {
  const useFile = tablesFile.replace(/\.tables\.json$/, '.use.json')
  const key = `${Bun.hash(readFileSync(tablesFile)).toString(16)}-${sourceHash}`
  if (existsSync(useFile)) {
    const saved = JSON.parse(readFileSync(useFile, 'utf8')) as UseOfSpareStates
    if (saved.key === key) return saved
  }
  const validation = validationOfTheStandardSet()
  const train = trainPartOfTheStandardSet()
  const standInSamples = standInSamplesOf(train)
  const tables = loadTablesOfThisDataset(tablesFile).tables
  const spareStates = spareStatesOf(tables)
  const onTrain = stateUseOf(tables, train)
  const onValidation = stateUseOf(tables, validation)
  const shareOf = (grammar: boolean) => spareStates.filter(state => state.grammar === grammar).reduce((total, state) => total + codePointsIn(onValidation, state), 0) / onValidation.codePoints
  const into = cellsIntoSpareStatesOf(tables, base, validation)
  const scoreWithout = (way: 'sent' | 'folded', taken?: (spare: SpareState) => boolean): Score => scoreTables(withoutSpareStates(tables, way, base, standInSamples, taken), validation)
  const partOf = (score: Score): ScoreWithout => ({allThree: reportedRows.map(({row}) => sharesOf(rowOf(score, row)!).allThree), whole: sharesOf(score.rows[0]!).whole})
  const hasBoth = spareStates.some(state => state.grammar) && spareStates.some(state => !state.grammar)
  const only = (grammar: boolean) => {
    const allThree = (way: 'sent' | 'folded') => sharesOf(scoreWithout(way, state => state.grammar === grammar).rows[0]!).allThree
    return hasBoth ? {sent: allThree('sent'), folded: allThree('folded')} : null
  }
  const made: UseOfSpareStates = {
    key, readByTrain: spareStates.filter(state => codePointsIn(onTrain, state) > 0).length, ledInto: spareStates.filter(state => cellsInto(tables, state) > 0).length,
    copies: spareStates.filter((state, index) => spareStates.slice(0, index).some(earlier => sameState(tables, earlier, state))).length,
    tokenizerShare: shareOf(false), grammarShare: shareOf(true),
    otherTokenizerStatesShare: lexerStateNames.reduce((total, name, state) => total + (name === 'string' || name === 'between' ? 0 : onValidation.lexerCodePoints[state]!), 0) / onValidation.codePoints,
    cellsIntoSpareStates: into.cells, cellsIntoSpareStatesThatTheBaseSet: into.thatTheBaseSet, samplesThatReadSuchACell: into.samplesThatRead, brokenSamples: into.brokenSamples,
    sent: partOf(scoreWithout('sent')), folded: partOf(scoreWithout('folded')), onlyTokenizerStates: only(false), onlyGrammarStates: only(true),
  }
  writeFileSync(useFile, `${JSON.stringify(made)}\n`)
  return made
}
