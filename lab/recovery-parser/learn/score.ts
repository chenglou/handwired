// How a parser is scored: over the labeled code points at or after the first damage of the broken samples, the share
// with all three labels right (the main number), with the display kind right, with the depth right, with the
// container right, and the share of samples in which every such code point is right. Always with breakdowns.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/score.ts [--tables <file.json>] [--split validation] [--cells]
//       [--from 0] [--to 60000] [--seed 20261015] [--scratch <folder>]
// Without --tables it scores today's tables. --split takes one split or several with commas, e.g. train,validation.
// The test split is read only when --split names it. --cells also lists the cells that differ from today's tables.
import {
  type Samples, cacheFolderOf, codePointKindScored, codePointLabeled, heldOutByKind, heldOutByTemplate, loadSamples, optionOf, reachableNames, splitNames, standardRange,
} from './data.ts'
import type {Split} from '../samples.ts'
import {type RecoveryTrace, createTrace, positionCount, runRecoveryParserInto} from './recovery-parser.ts'
import {type RecoveryTables, asIsTables, checkTables, describeDifferences, differencesOf, loadTables} from './recovery-tables.ts'

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
export function sharesOf(row: ScoreRow) {
  return {
    allThree: row.allRight / row.codePoints, kind: row.kindRight / row.kindScored, depth: row.depthRight / row.codePoints,
    container: row.containerRight / row.codePoints, whole: row.wholeSamples / (row.samples - row.nothingToRecover),
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
  const rows: ScoreRow[] = groups.names.map(group => ({group, samples: 0, nothingToRecover: 0, codePoints: 0, allRight: 0, depthRight: 0, containerRight: 0, kindScored: 0, kindRight: 0, wholeSamples: 0}))
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
    for (let position = firstDamage; position < length; position++) {
      const flags = samples.flags[start + position]!
      if ((flags & codePointLabeled) === 0) continue
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
      if (depthIsRight && containerIsRight && kindIsRight) allRight++
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

const percent = (share: number) => Number.isNaN(share) ? '    -' : (100 * share).toFixed(1).padStart(5)
const count = (value: number) => String(value).padStart(7)

// The score as aligned text: per group the samples, the samples with nothing to recover, the percentages of code
// points with all three labels right, the display kind right, the depth right and the container right, and the
// percentage of samples with something to recover in which every code point is right.
export function describeScore(score: Score): string {
  const lines = [`${'samples'.padStart(7)} ${'nothing'.padStart(7)}  ${'all 3'.padStart(5)} ${'kind'.padStart(5)} ${'depth'.padStart(5)} ${'cont.'.padStart(5)}  ${'whole'.padStart(5)}  group`]
  for (const row of score.rows) {
    const shares = sharesOf(row)
    lines.push(`${count(row.samples)} ${count(row.nothingToRecover)}  ${percent(shares.allThree)} ${percent(shares.kind)} ${percent(shares.depth)} ${percent(shares.container)}  ${percent(shares.whole)}  ${row.group}`)
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
  console.log(`Tables: ${tablesFile ?? 'today\'s'}${loaded.note === '' ? '' : ` (${loaded.note})`}. ${differences.length} cells differ from today's tables.`)
  if (process.argv.includes('--cells') && differences.length > 0) console.log(describeDifferences(differences))
  console.log(`Seed ${seed}, samples ${from} to ${to - 1}, split${splits.length === 1 ? '' : 's'} ${splits.join(', ')}: ${score.rows[0]!.samples} broken samples, ${score.validSamples} valid ones left out. Scored in ${milliseconds.toFixed(0)} ms.`)
  console.log('Percentages of the labeled code points at or after the first damage: all three labels right, the display kind right (of those whose')
  console.log('kind is scored), the depth right, the container right. Then the percentage of samples with something to recover that are right as a whole.')
  console.log('')
  console.log(describeScore(score))
}
