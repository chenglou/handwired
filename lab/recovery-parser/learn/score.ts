// How a parser is scored: over the labeled code points at or after the first damage of the broken samples, the share
// with all three labels right (the main number), with the display kind right, with the depth right, with the
// container right, and the share of samples in which every such code point is right. Always with breakdowns.
//
// Three things that these shares do not show are counted next to them:
// - The ceiling. Some of the scored code points come before the first error, e.g. everything after a removed closing
//   bracket up to the text's end. Only frozen cells are read there, so what is shown is today's for every choice of
//   the open cells, and the ones that are wrong today stay wrong for every tables.
// - How the damage itself is shown. A code point that the damage added has no label, and no label is ever the
//   display kind `error`. So tables lose nothing in the shares by never showing an error.
// - Code points of the text that are shown as `pastEnd`, the display kind of the cells after a text's end. A
//   tokenizer cell can hold one of the three events of a text's end, and a code point that reads the cell is then
//   shown so.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/score.ts [--tables <file.json>] [--split validation] [--cells]
//       [--from 0] [--to 60000] [--seed 20261015] [--scratch <folder>]
// Without --tables it scores today's tables. --split takes one split or several with commas, e.g. train,validation.
// The test split is read only when --split names it. --cells also lists the cells that differ from today's tables.
import {
  type Samples, cacheFolderOf, codePointKindScored, codePointLabeled, heldOutByKind, heldOutByTemplate, loadSamples, optionOf, reachableNames, splitNames, standardRange,
} from './data.ts'
import {displayKind} from '../labels.ts'
import type {Split} from '../samples.ts'
import {type RecoveryTrace, createTrace, positionCount, runRecoveryParserInto} from './recovery-parser.ts'
import {type CellDifference, type RecoveryTables, asIsTables, checkTables, copyTables, describeDifferences, differencesOf, displayEntryOf, loadTables} from './recovery-tables.ts'

export type ScoreRow = {
  // Which samples the row counts, e.g. "all", "reachable: yes" or "kind: missingComma".
  group: string
  // Broken samples in the group, and how many of them have no labeled code point from the first damage on. Those
  // have nothing to recover and are in no other number of the row.
  samples: number
  nothingToRecover: number
  // Labeled code points at or after the first damage, and how many of them have all three labels right, the depth
  // right and the container right.
  codePoints: number
  allRight: number
  depthRight: number
  containerRight: number
  // How many of the code points have a display kind that is scored, and how many of those have it right.
  kindScored: number
  kindRight: number
  // Samples with something to recover in which every such code point has all three labels right.
  wholeSamples: number
  // Of the code points: the ones before the first error, where only frozen cells are read, and how many of those do
  // not have all three labels right. No tables get them right, so 1 - wrongBeforeError / codePoints is the ceiling
  // of the main number.
  beforeError: number
  wrongBeforeError: number
  // Samples with such a wrong code point. They can never be right as a whole.
  samplesWrongBeforeError: number
  // Code points at or after the first damage that the damage added, which have no label, and how many of them are
  // shown as the display kind `error`.
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
  // The splits to score. Without it, the validation split alone. The test split is scored only when it is named here.
  splits?: readonly Split[]
  // False leaves out every row but "all", for a loop that only reads the main number.
  breakdowns?: boolean
}

// A row's shares, from 0 to 1, and NaN where there is nothing to divide by. `allThree` is the main number.
// `ceiling` and `wholeCeiling` are the highest that `allThree` and `whole` can be for any choice of the open cells.
// `addedAsError` is the share of the added code points that are shown as an error, and `showsError` the share of the
// samples that show an error at or after the first damage.
export function sharesOf(row: ScoreRow) {
  const withSomething = row.samples - row.nothingToRecover
  return {
    allThree: row.allRight / row.codePoints, kind: row.kindRight / row.kindScored, depth: row.depthRight / row.codePoints,
    container: row.containerRight / row.codePoints, whole: row.wholeSamples / withSomething,
    ceiling: (row.codePoints - row.wrongBeforeError) / row.codePoints, wholeCeiling: (withSomething - row.samplesWrongBeforeError) / withSomething,
    addedAsError: row.addedShownAsError / row.addedCodePoints, showsError: row.samplesShowingError / row.samples,
  }
}

export const rowOf = (score: Score, group: string) => score.rows.find(row => row.group === group)

// The groups of every sample, as indexes into the group names. Made once per set of samples.
type Groups = {names: string[], start: Int32Array, list: Uint16Array}
const groupsOfSamples = new WeakMap<Samples, Groups>()
function groupsOf(samples: Samples): Groups {
  const known = groupsOfSamples.get(samples)
  if (known !== undefined) return known
  const names = [
    'all', ...splitNames.map(name => `split: ${name}`), 'source: damage', 'source: typing', ...reachableNames.map(name => `reachable: ${name}`),
    'needs a class', 'needs no class', 'debatable', 'not debatable', 'held out: a kind', 'held out: the template', 'not held out',
    ...samples.familyNames.map(name => `family: ${name}`), ...samples.kindNames.map(name => `kind: ${name}`),
  ]
  const first = (name: string) => names.indexOf(name)
  const [split, source, reachable, needsClass, debatable, heldOut, family, kind] = [first('split: train'), first('source: damage') - 1, first('reachable: yes'), first('needs a class'), first('debatable'), first('held out: a kind'), first('not held out') + 1, first('not held out') + 1 + samples.familyNames.length]
  const start = new Int32Array(samples.sampleCount + 1)
  const list: number[] = []
  for (let place = 0; place < samples.sampleCount; place++) {
    // A valid sample is in no group.
    if (samples.firstDamage[place] !== -1) {
      list.push(0, split + samples.split[place]!, source + samples.source[place]!, reachable + samples.reachable[place]!, needsClass + 1 - samples.needsClass[place]!, debatable + 1 - samples.debatable[place]!)
      const held = samples.heldOut[place]!
      if ((held & heldOutByKind) !== 0) list.push(heldOut)
      if ((held & heldOutByTemplate) !== 0) list.push(heldOut + 1)
      if (held === 0) list.push(heldOut + 2)
      for (let bit = 0; bit < samples.familyNames.length; bit++) if ((samples.families[place]! & (1 << bit)) !== 0) list.push(family + bit)
      for (let at = samples.kindStart[place]!; at < samples.kindStart[place + 1]!; at++) list.push(kind + samples.kindList[at]!)
    }
    start[place + 1] = list.length
  }
  const groups = {names, start, list: Uint16Array.from(list)}
  groupsOfSamples.set(samples, groups)
  return groups
}

// Scores any parser: `run` writes, for the sample at `place`, the display kind, the depth after and the container
// after of each of its code points into the trace's displayKind, depthAfter and containerAfter.
export function scoreWith(samples: Samples, options: ScoreOptions, run: (place: number, trace: RecoveryTrace) => void): Score {
  const splits = options.splits ?? ['validation']
  const wanted = splitNames.map(name => splits.includes(name))
  const groups = groupsOf(samples)
  const rows: ScoreRow[] = groups.names.map(group => ({
    group, samples: 0, nothingToRecover: 0, codePoints: 0, allRight: 0, depthRight: 0, containerRight: 0, kindScored: 0, kindRight: 0, wholeSamples: 0,
    beforeError: 0, wrongBeforeError: 0, samplesWrongBeforeError: 0, addedCodePoints: 0, addedShownAsError: 0, samplesShowingError: 0, shownAsPastEnd: 0,
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
    let depthRight = 0
    let containerRight = 0
    let kindScored = 0
    let kindRight = 0
    let beforeError = 0
    let wrongBeforeError = 0
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
      if ((flags & codePointLabeled) === 0) {
        addedCodePoints++
        if (shown === displayKind.error) addedShownAsError++
        continue
      }
      codePoints++
      const depthIsRight = trace.depthAfter[position] === samples.labelDepth[start + position]
      const containerIsRight = trace.containerAfter[position] === samples.labelContainer[start + position]
      let kindIsRight = true
      if ((flags & codePointKindScored) !== 0) {
        kindScored++
        kindIsRight = trace.displayKind[position] === samples.labelKind[start + position]
        if (kindIsRight) kindRight++
      }
      if (depthIsRight) depthRight++
      if (containerIsRight) containerRight++
      const isRight = depthIsRight && containerIsRight && kindIsRight
      if (isRight) allRight++
      if (position < firstError) {
        beforeError++
        if (!isRight) wrongBeforeError++
      }
    }
    const lastGroup = options.breakdowns === false ? groups.start[place]! + 1 : groups.start[place + 1]!
    for (let at = groups.start[place]!; at < lastGroup; at++) {
      const row = rows[groups.list[at]!]!
      row.samples++
      row.codePoints += codePoints
      row.allRight += allRight
      row.depthRight += depthRight
      row.containerRight += containerRight
      row.kindScored += kindScored
      row.kindRight += kindRight
      if (codePoints === 0) row.nothingToRecover++
      else if (allRight === codePoints) row.wholeSamples++
      row.beforeError += beforeError
      row.wrongBeforeError += wrongBeforeError
      if (wrongBeforeError > 0) row.samplesWrongBeforeError++
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

const percent = (share: number) => Number.isNaN(share) ? '    -' : (100 * share).toFixed(1).padStart(5)
const count = (value: number) => String(value).padStart(7)

// The score as aligned text: per group the samples, the samples with nothing to recover, the percentages of code
// points with all three labels right, the display kind right, the depth right and the container right, and the
// percentage of samples with something to recover in which every code point is right. Then what the shares do not
// show: the ceilings of "all 3" and of "whole" for any choice of the open cells, the percentage of the added code
// points that are shown as an error, the percentage of the samples that show an error at or after the first damage,
// and the number of code points that are shown as past the end.
export function describeScore(score: Score): string {
  const lines = [`${'samples'.padStart(7)} ${'nothing'.padStart(7)}  ${'all 3'.padStart(5)} ${'kind'.padStart(5)} ${'depth'.padStart(5)} ${'cont.'.padStart(5)}  ${'whole'.padStart(5)}  ${'ceil.'.padStart(5)} ${'ceil.w'.padStart(6)}  ${'addedE'.padStart(6)} ${'showsE'.padStart(6)} ${'pastEnd'.padStart(7)}  group`]
  for (const row of score.rows) {
    const shares = sharesOf(row)
    lines.push(`${count(row.samples)} ${count(row.nothingToRecover)}  ${percent(shares.allThree)} ${percent(shares.kind)} ${percent(shares.depth)} ${percent(shares.container)}  ${percent(shares.whole)}  ${percent(shares.ceiling)} ${percent(shares.wholeCeiling).padStart(6)}  ${percent(shares.addedAsError).padStart(6)} ${percent(shares.showsError).padStart(6)} ${count(row.shownAsPastEnd)}  ${row.group}`)
  }
  return lines.join('\n')
}

if (import.meta.main) {
  const tablesFile = optionOf('--tables')
  const splits = (optionOf('--split') ?? 'validation').split(',') as Split[]
  for (const split of splits) if (!splitNames.includes(split)) throw new Error(`--split takes ${splitNames.join(', ')}, or several of them with commas, and got ${split}`)
  const seed = Number(optionOf('--seed') ?? standardRange.seed)
  const from = Number(optionOf('--from') ?? standardRange.from)
  const to = Number(optionOf('--to') ?? standardRange.to)
  const loaded = tablesFile === undefined ? {tables: asIsTables(), note: 'the tables of today'} : loadTables(tablesFile)
  const differences = differencesOf(asIsTables(), loaded.tables)
  const samples = loadSamples(seed, from, to, cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH']))
  const started = performance.now()
  const score = scoreTables(loaded.tables, samples, {splits})
  const milliseconds = performance.now() - started
  const read = cellsReadBy(loaded.tables, samples, splits)
  const differencesRead = differences.filter(difference => isRead(read, difference)).length
  console.log(`Tables: ${tablesFile ?? 'today\'s'}${loaded.note === '' ? '' : ` (${loaded.note})`}. ${differences.length} cells differ from today's tables, and a code point of the scored samples reads ${differencesRead} of them.`)
  if (process.argv.includes('--cells') && differences.length > 0) console.log(describeDifferences(differences))
  console.log(`Seed ${seed}, samples ${from} to ${to - 1}, split${splits.length === 1 ? '' : 's'} ${splits.join(', ')}: ${score.rows[0]!.samples} broken samples, ${score.validSamples} valid ones left out. Scored in ${milliseconds.toFixed(0)} ms.`)
  console.log('Percentages of the labeled code points at or after the first damage: all three labels right, the display kind right (of those whose')
  console.log('kind is scored), the depth right, the container right. Then the percentage of samples with something to recover that are right as a whole.')
  console.log('ceil. and ceil.w: the highest that "all 3" and "whole" can be for any choice of the open cells, since the scored code points before the')
  console.log('first error are shown as today. addedE: the percentage of the code points that the damage added that are shown as an error. showsE: the')
  console.log('percentage of the samples that show an error at or after the first damage. pastEnd: code points shown as the cells after a text are.')
  console.log('')
  console.log(describeScore(score))
}
