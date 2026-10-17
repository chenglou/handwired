// How a parser is scored, as the dataset says a score counts (see "What a score counts" in ../README.md): over the
// code points of the broken samples from the first error on whose label has a scored value, the share with every
// scored label right (the main number, "all three"), with the display kind right, with the depth right, with the
// container right, and the share of samples in which every such code point is right. Always with breakdowns.
//
// A label has three values, the display kind, the depth and the container, and the dataset leaves a value out where
// no parser can be asked for it, e.g. the depth after a removed bracket. "All three right" at a code point means
// that every value that is scored there is right. Before the first error nothing is counted: only frozen cells are
// read there, every tables give what today's parser gives, and the dataset scores no value there that today's parser
// does not give.
//
// Three things that these shares do not show are counted next to them:
// - The dataset's bound for the plain table parser (mostRightFor in ../samples.ts): the most scored code points that
//   one run of the loop of ../table-parser.ts can have right, whatever its open cells hold. That loop changes the
//   depth by the tokenizer's event. The parser of this experiment changes it by a stack action that a grammar cell
//   holds and keeps a real stack, so its reach is larger, and its score can be above the bound.
// - How the damage itself is shown. A code point that the damage added has no label, and no label is ever the
//   display kind `error`. So tables lose nothing in the shares by never showing an error.
// - Code points of the text that are shown as `pastEnd`, the display kind of the cells after a text's end. A
//   tokenizer cell can hold one of the three events of a text's end, and a code point that reads the cell is then
//   shown so.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/score.ts [--tables <file.json>] [--base <file.json>] [--split validation] [--cells]
//       [--from 0] [--to 60000] [--seed 20261015] [--scratch <folder>]
// Without --tables it scores today's tables. --split takes train, validation or both with a comma. --base names the
// tables that a run started from: the command then also counts the cells that the run changed. --cells lists the
// cells that differ from today's parser.
import {
  type Samples, cacheFolderOf, codePointKept, codePointKindScored, codePointNestingScored, groupNames, heldOutByKind, heldOutByTemplate, loadSamples, optionOf, refuseUnknownOptions, requireFinal, splitNames,
  splitsOfOption, standardRange,
} from './data.ts'
import {displayKind} from '../labels.ts'
import type {Split} from '../samples.ts'
import {type RecoveryTrace, createTrace, positionCount, runRecoveryParserInto} from './recovery-parser.ts'
import {type CellDifference, type RecoveryTables, asIsTables, checkTables, copyTables, describeDifferences, differencesOf, displayEntryOf, loadTablesForReport} from './recovery-tables.ts'

export type ScoreRow = {
  // Which samples the row counts, e.g. "all", "group: within reach of the tables" or "kind: missingComma".
  name: string
  // Broken samples in the row, and how many of them have no scored code point. Those have nothing to recover and are
  // in no other number of the row.
  samples: number
  nothingToRecover: number
  // Scored code points: at or after the first error, with a label that has a scored value. And how many of them have
  // every scored value right.
  codePoints: number
  allRight: number
  // How many of the code points have a display kind that is scored, and how many of those have it right.
  kindScored: number
  kindRight: number
  // How many of the code points have a depth and a container that are scored, and how many of those have the depth
  // right and the container right.
  nestingScored: number
  depthRight: number
  containerRight: number
  // Samples with something to recover in which every scored code point is right.
  wholeSamples: number
  // The dataset's bound for the plain table parser: the most of the code points that one run of the loop of
  // ../table-parser.ts can have right, added up over the samples, and the samples with something to recover in which
  // that is every one. See the top of this file: the parser of this experiment is not bound by it.
  plainBoundRight: number
  plainBoundWholeSamples: number
  // Code points that the damage added, which have no label, and how many of them are shown as the display kind `error`.
  addedCodePoints: number
  addedShownAsError: number
  // Samples in which a code point at or after the first damage is shown as `error`.
  samplesShowingError: number
  // Code points at or after the first damage that are shown as `pastEnd`.
  shownAsPastEnd: number
}

export type Score = {
  splits: readonly Split[]
  // The row "all" first, then the breakdowns. A sample with several kinds or families is in the row of each.
  rows: ScoreRow[]
  // Valid samples of the splits. They have no damage and are in no row.
  validSamples: number
}

export type ScoreOptions = {
  // The splits to score. Without it, the validation split alone. The test split needs RECOVERY_FINAL.
  splits?: readonly Split[]
  // False leaves out every row but "all", for a loop that only reads the main number.
  breakdowns?: boolean
}

// A row's shares, from 0 to 1, and NaN where there is nothing to divide by. `allThree` is the main number.
// `plainBound` and `plainBoundWhole` are the highest that `allThree` and `whole` can be for the plain table parser.
// `addedAsError` is the share of the added code points that are shown as an error, and `showsError` the share of the
// samples that show an error at or after the first damage.
export function sharesOf(row: ScoreRow) {
  const withSomething = row.samples - row.nothingToRecover
  return {
    allThree: row.allRight / row.codePoints, kind: row.kindRight / row.kindScored, depth: row.depthRight / row.nestingScored,
    container: row.containerRight / row.nestingScored, whole: row.wholeSamples / withSomething,
    plainBound: row.plainBoundRight / row.codePoints, plainBoundWhole: row.plainBoundWholeSamples / withSomething,
    addedAsError: row.addedShownAsError / row.addedCodePoints, showsError: row.samplesShowingError / row.samples,
  }
}

export const rowOf = (score: Score, name: string) => score.rows.find(row => row.name === name)

// The names of the rows of the four ways a sample can be held out. They are only there for a set of samples with the
// test split: a held-out sample is always in the test split.
export const heldOutRowNames = ['held out: nothing', 'held out: a kind, on a template that training has', 'held out: the template, with kinds that training has', 'held out: a kind and the template'] as const

// The rows of every sample, as indexes into the row names. Made once per set of samples.
type Rows = {names: string[], start: Int32Array, list: Uint16Array}
const rowsOfSamples = new WeakMap<Samples, Rows>()
function rowsOf(samples: Samples): Rows {
  const known = rowsOfSamples.get(samples)
  if (known !== undefined) return known
  const names = [
    'all', ...splitNames.map(name => `split: ${name}`), 'source: damage', 'source: typing', ...groupNames.map(name => `group: ${name}`),
    'debatable', 'not debatable', 'line ends with a carriage return', ...heldOutRowNames,
    ...samples.familyNames.map(name => `family: ${name}`), ...samples.kindNames.map(name => `kind: ${name}`),
  ]
  const first = (name: string) => names.indexOf(name)
  const [split, source, group, debatable, carriageReturns, heldOut, family, kind] = [first('split: train'), first('source: damage') - 1, first(`group: ${groupNames[0]}`), first('debatable'), first('line ends with a carriage return'), first(heldOutRowNames[0]), first(`family: ${samples.familyNames[0]}`), first(`kind: ${samples.kindNames[0]}`)]
  const start = new Int32Array(samples.sampleCount + 1)
  const list: number[] = []
  for (let place = 0; place < samples.sampleCount; place++) {
    // A valid sample is in no row.
    if (samples.firstDamage[place] !== -1) {
      list.push(0, split + samples.split[place]!, source + samples.source[place]!, group + samples.group[place]!, debatable + 1 - samples.debatable[place]!)
      if (samples.carriageReturns[place] === 1) list.push(carriageReturns)
      if (samples.withTest) {
        const held = samples.heldOut[place]!
        list.push(heldOut + ((held & heldOutByKind) !== 0 ? 1 : 0) + ((held & heldOutByTemplate) !== 0 ? 2 : 0))
      }
      for (let bit = 0; bit < samples.familyNames.length; bit++) if ((samples.families[place]! & (1 << bit)) !== 0) list.push(family + bit)
      for (let at = samples.kindStart[place]!; at < samples.kindStart[place + 1]!; at++) list.push(kind + samples.kindList[at]!)
    }
    start[place + 1] = list.length
  }
  const rows = {names, start, list: Uint16Array.from(list)}
  rowsOfSamples.set(samples, rows)
  return rows
}

// Which scored values of the label of one code point a trace has wrong, as bits: 0 when every scored value is right,
// and also when no value is scored there. `at` is the code point's entry in the arrays per code point, and
// `position` its place in its text.
export const wrongKind = 1
export const wrongDepth = 2
export const wrongContainer = 4
export function wrongLabelsAt(samples: Samples, at: number, trace: RecoveryTrace, position: number): number {
  const flags = samples.flags[at]!
  let wrong = 0
  if ((flags & codePointKindScored) !== 0 && trace.displayKind[position] !== samples.labelKind[at]) wrong |= wrongKind
  if ((flags & codePointNestingScored) !== 0) {
    if (trace.depthAfter[position] !== samples.labelDepth[at]) wrong |= wrongDepth
    if (trace.containerAfter[position] !== samples.labelContainer[at]) wrong |= wrongContainer
  }
  return wrong
}

// Scores any parser: `run` writes, for the sample at `place`, the display kind, the depth after and the container
// after of each of its code points into the trace's displayKind, depthAfter and containerAfter.
export function scoreWith(samples: Samples, options: ScoreOptions, run: (place: number, trace: RecoveryTrace) => void): Score {
  const splits = options.splits ?? ['validation']
  if (splits.includes('test')) requireFinal('A score of the test split')
  const wanted = splitNames.map(name => splits.includes(name))
  const rowsOfSample = rowsOf(samples)
  const rows: ScoreRow[] = rowsOfSample.names.map(name => ({
    name, samples: 0, nothingToRecover: 0, codePoints: 0, allRight: 0, kindScored: 0, kindRight: 0, nestingScored: 0, depthRight: 0, containerRight: 0, wholeSamples: 0,
    plainBoundRight: 0, plainBoundWholeSamples: 0, addedCodePoints: 0, addedShownAsError: 0, samplesShowingError: 0, shownAsPastEnd: 0,
  }))
  const trace = createTrace()
  let validSamples = 0
  let scoredSamples = 0
  for (let place = 0; place < samples.sampleCount; place++) {
    if (!wanted[samples.split[place]!]) continue
    const firstDamage = samples.firstDamage[place]!
    if (firstDamage === -1) {
      validSamples++
      continue
    }
    scoredSamples++
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    run(place, trace)
    let codePoints = 0
    let allRight = 0
    let kindScored = 0
    let kindRight = 0
    let nestingScored = 0
    let depthRight = 0
    let containerRight = 0
    let addedCodePoints = 0
    let addedShownAsError = 0
    let shownAsError = 0
    let shownAsPastEnd = 0
    const firstError = samples.firstErrorPosition[place]!
    for (let position = firstDamage; position < length; position++) {
      const flags = samples.flags[start + position]!
      const shown = trace.displayKind[position]
      if (shown === displayKind.error) shownAsError++
      else if (shown === displayKind.pastEnd) shownAsPastEnd++
      if ((flags & codePointKept) === 0) {
        addedCodePoints++
        if (shown === displayKind.error) addedShownAsError++
        continue
      }
      if (position < firstError) continue
      const scoresKind = (flags & codePointKindScored) !== 0
      const scoresNesting = (flags & codePointNestingScored) !== 0
      if (!scoresKind && !scoresNesting) continue
      codePoints++
      let isRight = true
      if (scoresKind) {
        kindScored++
        if (shown === samples.labelKind[start + position]) kindRight++
        else isRight = false
      }
      if (scoresNesting) {
        nestingScored++
        if (trace.depthAfter[position] === samples.labelDepth[start + position]) depthRight++
        else isRight = false
        if (trace.containerAfter[position] === samples.labelContainer[start + position]) containerRight++
        else isRight = false
      }
      if (isRight) allRight++
    }
    if (codePoints !== samples.scored[place]) throw new Error(`the sample at place ${place} has ${codePoints} scored code points in the arrays per code point, and the dataset's scoredCodePoints says ${samples.scored[place]}`)
    const mostRight = samples.mostRight[place]!
    const lastRow = options.breakdowns === false ? rowsOfSample.start[place]! + 1 : rowsOfSample.start[place + 1]!
    for (let at = rowsOfSample.start[place]!; at < lastRow; at++) {
      const row = rows[rowsOfSample.list[at]!]!
      row.samples++
      row.codePoints += codePoints
      row.allRight += allRight
      row.kindScored += kindScored
      row.kindRight += kindRight
      row.nestingScored += nestingScored
      row.depthRight += depthRight
      row.containerRight += containerRight
      if (codePoints === 0) row.nothingToRecover++
      else if (allRight === codePoints) row.wholeSamples++
      row.plainBoundRight += mostRight
      if (codePoints > 0 && mostRight === codePoints) row.plainBoundWholeSamples++
      row.addedCodePoints += addedCodePoints
      row.addedShownAsError += addedShownAsError
      if (shownAsError > 0) row.samplesShowingError++
      row.shownAsPastEnd += shownAsPastEnd
    }
  }
  if (scoredSamples === 0) throw new Error(`these samples have no broken sample of the split${splits.length === 1 ? '' : 's'} ${splits.join(', ')}`)
  return {splits, rows: rows.filter(row => row.samples > 0), validSamples}
}

// Runs the exact parser on the sample at `place` and writes its trace: the positions of the sample's code points, or
// with `everyPosition` all 513, which the first error and `valid` need. It does not check the tables.
export function runOnSample(trace: RecoveryTrace, samples: Samples, place: number, tables: RecoveryTables, everyPosition = false) {
  const start = samples.start[place]!
  const length = samples.start[place + 1]! - start
  runRecoveryParserInto(trace, samples.codePoints, start, length, false, tables, everyPosition ? positionCount : length)
}

// Scores tables in the exact parser. Throws when the tables break the ground rules.
export function scoreTables(tables: RecoveryTables, samples: Samples, options: ScoreOptions = {}): Score {
  checkTables(tables)
  return scoreWith(samples, options, (place, trace) => runOnSample(trace, samples, place, tables))
}

export type CellsRead = {lexer: Uint8Array, grammar: Uint8Array, display: Uint8Array}

// Which cells the exact parser reads with `tables` at a code point of the samples at `places`: 1 per tokenizer cell,
// per grammar cell and per entry of the display table that is read. Cells that are only read at the position after a
// text are not counted, since nothing that is shown or scored depends on them.
export function cellsReadAt(tables: RecoveryTables, samples: Samples, places: ArrayLike<number>): CellsRead {
  checkTables(tables)
  const lexer = new Uint8Array(tables.lexerNext.length)
  const grammar = new Uint8Array(tables.grammarNext.length)
  const display = new Uint8Array(tables.display.length)
  const trace = createTrace()
  for (let at = 0; at < places.length; at++) {
    const place = places[at]!
    runOnSample(trace, samples, place, tables)
    const length = samples.start[place + 1]! - samples.start[place]!
    for (let position = 0; position < length; position++) {
      lexer[trace.lexerCell[position]!] = 1
      grammar[trace.grammarCell[position]!] = 1
      display[displayEntryOf(tables, trace.event[position]!, trace.grammarAfter[position]!)] = 1
    }
  }
  return {lexer, grammar, display}
}

// Whether a cell in which two tables differ is one that `read` marks.
export const isRead = (read: CellsRead, difference: CellDifference) => (difference.table === 'tokenizer' ? read.lexer : difference.table === 'grammar' ? read.grammar : read.display)[difference.cell] === 1

// The same for every sample of the given splits.
export function cellsReadBy(tables: RecoveryTables, samples: Samples, splits: readonly Split[]): CellsRead {
  if (splits.includes('test')) requireFinal('The cells that the test split reads')
  const wanted = splitNames.map(name => splits.includes(name))
  return cellsReadAt(tables, samples, Int32Array.from({length: samples.sampleCount}, (_, place) => place).filter(place => wanted[samples.split[place]!]!))
}

// A copy of `tables` in which every cell and every entry of the display table that `read` does not mark holds the
// choice of `base`, and how many that puts back. When `read` holds the cells that `tables` read on some texts, the copy gives the same trace on those
// texts, since a cell that is put back is one that they never read. E.g. a training run moves cells that only its
// mixes read, and their choices in the snapped tables mean nothing.
export function withUnreadCellsOf(base: RecoveryTables, tables: RecoveryTables, read: CellsRead): {tables: RecoveryTables, putBack: number} {
  if (base.lexerNext.length !== tables.lexerNext.length || base.grammarNext.length !== tables.grammarNext.length) throw new Error('withUnreadCellsOf takes two tables with the same states and the same added structure')
  const result = copyTables(tables)
  let putBack = 0
  for (let cell = 0; cell < result.lexerNext.length; cell++) {
    if (read.lexer[cell] === 1 || (result.lexerNext[cell] === base.lexerNext[cell] && result.lexerEvent[cell] === base.lexerEvent[cell])) continue
    result.lexerNext[cell] = base.lexerNext[cell]!
    result.lexerEvent[cell] = base.lexerEvent[cell]!
    putBack++
  }
  for (let cell = 0; cell < result.grammarNext.length; cell++) {
    if (read.grammar[cell] === 1 || (result.grammarNext[cell] === base.grammarNext[cell] && result.grammarAction[cell] === base.grammarAction[cell])) continue
    result.grammarNext[cell] = base.grammarNext[cell]!
    result.grammarAction[cell] = base.grammarAction[cell]!
    putBack++
  }
  for (let entry = 0; entry < result.display.length; entry++) {
    if (read.display[entry] === 1 || result.display[entry] === base.display[entry]) continue
    result.display[entry] = base.display[entry]!
    putBack++
  }
  return {tables: result, putBack}
}

// Two counts of cells, which are not the same number once tables have added structure:
// - `changedAgainstBase`: the cells in which `tables` differ from the tables that a run started from. This is what
//   the run changed. Undefined without a base.
// - `differFromToday`: the cells in which `tables` do something else than today's parser. Structure adds to this
//   count without a run changing anything: every cell of an added state counts, and a class or the bit "first on its
//   line" that is added to tables whose cells are changed already copies those changed cells, e.g. a class for the
//   apostrophe copies the 26 cells of the class `other`.
// Each count is per table: tokenizer cells, grammar cells and entries of the display table.
export type CellCounts = {tokenizer: number, grammar: number, display: number, total: number}
export function countCells(differences: readonly CellDifference[]): CellCounts {
  const counts = {tokenizer: 0, grammar: 0, display: 0, total: differences.length}
  for (const difference of differences) counts[difference.table]++
  return counts
}
export function cellCountsOf(tables: RecoveryTables, base?: RecoveryTables): {changedAgainstBase: CellCounts | undefined, differFromToday: CellCounts} {
  return {changedAgainstBase: base === undefined ? undefined : countCells(differencesOf(base, tables)), differFromToday: countCells(differencesOf(asIsTables(), tables))}
}
export const describeCellCounts = (counts: CellCounts) => `${counts.total} (tokenizer ${counts.tokenizer}, grammar ${counts.grammar}, display table ${counts.display})`

const percent = (share: number) => Number.isNaN(share) ? '    -' : (100 * share).toFixed(1).padStart(5)
const count = (value: number) => String(value).padStart(7)

// The score as aligned text: per row the samples, the samples with nothing to recover, the percentages of the scored
// code points with every scored label right, the display kind right, the depth right and the container right, and
// the percentage of samples with something to recover in which every scored code point is right. Then what the
// shares do not show: the dataset's bound of "all 3" and of "whole" for the plain table parser, the percentage of the
// added code points that are shown as an error, the percentage of the samples that show an error at or after the
// first damage, and the number of code points that are shown as past the end.
export function describeScore(score: Score): string {
  const lines = [`${'samples'.padStart(7)} ${'nothing'.padStart(7)}  ${'all 3'.padStart(5)} ${'kind'.padStart(5)} ${'depth'.padStart(5)} ${'cont.'.padStart(5)}  ${'whole'.padStart(5)}  ${'bound'.padStart(5)} ${'boundw'.padStart(6)}  ${'addedE'.padStart(6)} ${'showsE'.padStart(6)} ${'pastEnd'.padStart(7)}  row`]
  for (const row of score.rows) {
    const shares = sharesOf(row)
    lines.push(`${count(row.samples)} ${count(row.nothingToRecover)}  ${percent(shares.allThree)} ${percent(shares.kind)} ${percent(shares.depth)} ${percent(shares.container)}  ${percent(shares.whole)}  ${percent(shares.plainBound)} ${percent(shares.plainBoundWhole).padStart(6)}  ${percent(shares.addedAsError).padStart(6)} ${percent(shares.showsError).padStart(6)} ${count(row.shownAsPastEnd)}  ${row.name}`)
  }
  return lines.join('\n')
}

// What the columns of describeScore mean, as lines to print above it.
export const scoreLegend = [
  'Percentages of the scored code points, i.e. the code points from the first error on whose label has a scored value: every scored label right',
  '(all 3), the display kind right, the depth right, the container right. whole: the samples with something to recover that are right as a whole.',
  'bound and boundw: the most that "all 3" and "whole" can be for the plain table parser, by the dataset\'s mostRightFor. The parser here has a',
  'stack action per grammar cell and a real stack, so its reach is larger. addedE: the percentage of the code points that the damage added that',
  'are shown as an error. showsE: the percentage of the samples that show an error at or after the first damage. pastEnd: code points shown as',
  'the cells after a text are.',
]

if (import.meta.main) {
  refuseUnknownOptions('score.ts', ['--tables', '--base', '--split', '--cells', '--from', '--to', '--seed', '--scratch'])
  const tablesFile = optionOf('--tables')
  const baseFile = optionOf('--base')
  const splits = splitsOfOption('score.ts')
  const seed = Number(optionOf('--seed') ?? standardRange.seed)
  const from = Number(optionOf('--from') ?? standardRange.from)
  const to = Number(optionOf('--to') ?? standardRange.to)
  const loaded = tablesFile === undefined ? {tables: asIsTables(), note: 'the tables of today'} : loadTablesForReport(tablesFile)
  const differences = differencesOf(asIsTables(), loaded.tables)
  const samples = loadSamples(seed, from, to, cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH']))
  const started = performance.now()
  const score = scoreTables(loaded.tables, samples, {splits})
  const milliseconds = performance.now() - started
  const read = cellsReadBy(loaded.tables, samples, splits)
  const differencesRead = differences.filter(difference => isRead(read, difference)).length
  console.log(`Tables: ${tablesFile ?? 'today\'s'}${loaded.note === '' ? '' : ` (${loaded.note})`}.`)
  if (baseFile !== undefined) console.log(`Cells changed against the base ${baseFile}: ${describeCellCounts(countCells(differencesOf(loadTablesForReport(baseFile).tables, loaded.tables)))}.`)
  console.log(`Cells that differ from today's parser: ${describeCellCounts(countCells(differences))}, and a code point of the scored samples reads ${differencesRead} of them. This count holds every cell of an added state, and the cells that an added class or the bit "first on its line" copied from cells that were changed before.`)
  if (process.argv.includes('--cells') && differences.length > 0) console.log(describeDifferences(differences))
  console.log(`Dataset ${samples.datasetKey}, seed ${seed}, the samples with the indexes ${from} to ${to - 1}, split${splits.length === 1 ? '' : 's'} ${splits.join(', ')}: ${score.rows[0]!.samples} broken samples, ${score.validSamples} valid ones left out. Scored in ${milliseconds.toFixed(0)} ms.`)
  for (const line of scoreLegend) console.log(line)
  console.log('')
  console.log(describeScore(score))
}
