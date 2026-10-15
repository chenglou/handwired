// Checks the intended states, the typed arrays of data.ts and the scores of score.ts against the dataset's own
// samples and today's parser.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/check-data.ts [number of samples, default 20000] [--stats <file>] [--scratch <folder>]
//
// 1. Intended states: before the first damage they are the states of today's parser on the broken text, and at every
//    kept code point whose display kind is scored, the display table gives the label's kind for the intended event
//    and grammar state. The mark "a parser of the broken text can be in the intended state" (canFollow) is set at
//    every code point before the first damage and at no added code point, and the check counts how many of the kept
//    code points from the first damage on have it.
// 2. The arrays of loadSamples hold what sampleAt and labelsOf give, sample by sample.
// 3. scoreTables with today's tables against a count made here from sampleAt, labelsOf and today's parser: the same
//    samples, code points, display kinds right and depths right, the same scored code points before the first error
//    and wrong ones among them, the same added code points and shown errors. The container and all three labels can
//    differ, because today's parser keeps the containers in a running sum and the recovery parser in a stack. With --stats,
//    the percentages of the rows of a statistics file, as lab/recovery-parser/stats.ts writes it, are compared too.
//    This check reads every split, the test split too, and only with today's tables.
// 4. The time of one scoring pass over the validation part of the standard set.
import {readFileSync} from 'node:fs'
import {displayKind} from '../labels.ts'
import {type Label, labeledAfterDamage, labelsOf, sampleAt} from '../samples.ts'
import {runTableParser} from '../table-parser.ts'
import {
  cacheFolderOf, codePointCanFollow, codePointKindScored, codePointLabeled, codePointReplaced, heldOutByKind, heldOutByTemplate, kindsOf, loadSamples, loadStandardSamples, optionOf,
  reachableNames, sourceNames, splitNames, standardRange, textOf, validationPart,
} from './data.ts'
import {intendedOf} from './intended.ts'
import {asIsTables, today} from './recovery-tables.ts'
import {type ScoreRow, describeScore, rowOf, scoreTables, sharesOf} from './score.ts'

const sampleCount = Number(process.argv[2] !== undefined && !process.argv[2].startsWith('--') ? process.argv[2] : 20_000)
const statsFile = optionOf('--stats')
const cacheFolder = cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH'])
const seed = standardRange.seed
let failures = 0
const fail = (message: string) => {
  failures++
  if (failures <= 20) console.log(`FAILED: ${message}`)
}

const samples = loadSamples(seed, 0, sampleCount, cacheFolder)
// The count made here, as lab/recovery-parser/stats.ts counts its headroom table: one row for every broken sample.
const expected: ScoreRow = {
  group: 'all', samples: 0, nothingToRecover: 0, codePoints: 0, allRight: 0, depthRight: 0, containerRight: 0, kindScored: 0, kindRight: 0, wholeSamples: 0,
  beforeError: 0, wrongBeforeError: 0, samplesWrongBeforeError: 0, addedCodePoints: 0, addedShownAsError: 0, samplesShowingError: 0, shownAsPastEnd: 0,
}
const tally = {beforeDamage: 0, keptAndScored: 0, replaced: 0, added: 0, codePoints: 0, keptFromDamage: 0, canFollowFromDamage: 0}

for (let place = 0; place < sampleCount; place++) {
  const sample = sampleAt(seed, place)
  const labels: (Label | undefined)[] = labelsOf(sample)
  const intended = intendedOf(sample)
  const trace = runTableParser(sample.broken)
  const start = samples.start[place]!
  const length = sample.alignment.length

  // 2. The arrays against the sample.
  const perSample: [string, unknown, unknown][] = [
    ['text', textOf(samples, place), sample.broken], ['length', samples.start[place + 1]! - start, length], ['index', samples.index[place], place],
    ['firstDamage', samples.firstDamage[place], sample.firstDamage], ['split', splitNames[samples.split[place]!], sample.split],
    ['source', sourceNames[samples.source[place]!], sample.source], ['reachable', reachableNames[samples.reachable[place]!], sample.reachable],
    ['needsClass', samples.needsClass[place], Number(sample.needsClass.length > 0)], ['debatable', samples.debatable[place], Number(sample.debatable)],
    ['kinds', kindsOf(samples, place).join(','), sample.kinds.join(',')],
    ['held out by a kind', (samples.heldOut[place]! & heldOutByKind) !== 0, sample.heldOut.some(reason => reason.startsWith('kind'))],
    ['held out by the template', (samples.heldOut[place]! & heldOutByTemplate) !== 0, sample.heldOut.some(reason => reason.startsWith('template'))],
  ]
  if (sample.source !== 'valid') {
    perSample.push(['firstErrorPosition', samples.firstErrorPosition[place], trace.firstErrorPosition], ['firstErrorKind', samples.firstErrorKind[place], trace.firstErrorKind])
  }
  for (const [name, actual, wanted] of perSample) if (actual !== wanted) fail(`sample ${sample.id}: ${name} is ${String(actual)} in the arrays, and ${String(wanted)} in the sample`)
  tally.codePoints += length
  for (let position = 0; position < length; position++) {
    const label = labels[position]
    const flags = samples.flags[start + position]!
    const wantedFlags = (label === undefined ? 0 : codePointLabeled) | (label?.kind === undefined ? 0 : codePointKindScored) | (sample.replaced[position] === true ? codePointReplaced : 0)
      | (intended.canFollow[position] === 1 ? codePointCanFollow : 0)
    if (flags !== wantedFlags || samples.labelKind[start + position] !== (label?.kind ?? -1) || samples.labelDepth[start + position] !== (label?.depth ?? -1) || samples.labelContainer[start + position] !== (label?.container ?? -1)) {
      fail(`sample ${sample.id}, code point ${position}: the arrays do not hold the label`)
    }
    if (samples.intendedLexerAfter[start + position] !== intended.lexerStateAfter[position] || samples.intendedEvent[start + position] !== intended.event[position] || samples.intendedGrammarAfter[start + position] !== intended.grammarAfter[position]) {
      fail(`sample ${sample.id}, code point ${position}: the arrays do not hold the intended states`)
    }

    // 1. The intended states.
    if (sample.alignment[position] === -1) {
      tally.added++
      if (intended.event[position] !== -1 || intended.lexerStateAfter[position] !== -1 || intended.grammarAfter[position] !== -1 || intended.depthAfter[position] !== -1 || intended.containerAfter[position] !== -1) fail(`sample ${sample.id}, code point ${position}: an added code point has an intended state`)
      if (intended.canFollow[position] !== 0) fail(`sample ${sample.id}, code point ${position}: an added code point is marked as one whose intended state can be followed`)
      continue
    }
    if (sample.source !== 'valid' && position >= sample.firstDamage) {
      tally.keptFromDamage++
      if (intended.canFollow[position] === 1) tally.canFollowFromDamage++
    }
    if (sample.replaced[position] === true) tally.replaced++
    if (label !== undefined && label.kind !== undefined) {
      tally.keptAndScored++
      const shown = today.display[intended.event[position]! * today.grammarStateCount + intended.grammarAfter[position]!]
      if (shown !== label.kind) fail(`sample ${sample.id}, code point ${position}: the intended event and grammar state are shown as kind ${shown}, and the label's kind is ${label.kind}`)
    }
    if (label === undefined || intended.depthAfter[position] !== label.depth || intended.containerAfter[position] !== label.container) fail(`sample ${sample.id}, code point ${position}: the intended depth and container are not the label's`)
    if (sample.source === 'valid' || position < sample.firstDamage) {
      tally.beforeDamage++
      if (intended.lexerStateAfter[position] !== trace.lexerStateBefore[position + 1] || intended.event[position] !== trace.event[position] || intended.grammarAfter[position] !== trace.grammarAfter[position]
        || intended.depthAfter[position] !== trace.depthAfter[position] || intended.containerAfter[position] !== trace.containerAfter[position]) {
        fail(`sample ${sample.id}, code point ${position}, before the first damage: the intended states are not the states of today's parser on the broken text`)
      }
      // Before the first damage every cell that is read is frozen and gives the intended state.
      if (intended.canFollow[position] !== 1) fail(`sample ${sample.id}, code point ${position}, before the first damage: not marked as one whose intended state can be followed`)
    }
  }

  // 3. The count made here.
  if (sample.source === 'valid') continue
  expected.samples++
  let labeled = 0
  let right = 0
  let wrongBeforeError = 0
  let showsError = false
  for (let position = sample.firstDamage; position < length; position++) {
    const label = labels[position]
    const shown = trace.displayKind[position]
    if (shown === displayKind.error) showsError = true
    if (shown === displayKind.pastEnd) expected.shownAsPastEnd++
    if (label === undefined) {
      expected.addedCodePoints++
      if (shown === displayKind.error) expected.addedShownAsError++
      continue
    }
    labeled++
    const kindRight = label.kind === undefined || label.kind === trace.displayKind[position]
    const depthRight = label.depth === trace.depthAfter[position]
    const containerRight = label.container === trace.containerAfter[position]
    if (label.kind !== undefined) {
      expected.kindScored++
      if (kindRight) expected.kindRight++
    }
    if (depthRight) expected.depthRight++
    if (containerRight) expected.containerRight++
    if (kindRight && depthRight && containerRight) right++
    // Before the first error the running sum and the stack hold the same containers.
    if (position < trace.firstErrorPosition) {
      expected.beforeError++
      if (!(kindRight && depthRight && containerRight)) wrongBeforeError++
    }
  }
  expected.wrongBeforeError += wrongBeforeError
  if (wrongBeforeError > 0) expected.samplesWrongBeforeError++
  if (showsError) expected.samplesShowingError++
  if (labeled !== labeledAfterDamage(sample)) fail(`sample ${sample.id}: ${labeled} labeled code points from the damage on, and labeledAfterDamage says ${labeledAfterDamage(sample)}`)
  expected.codePoints += labeled
  expected.allRight += right
  if (labeled === 0) expected.nothingToRecover++
  else if (right === labeled) expected.wholeSamples++
}
console.log(`1. Intended states of ${sampleCount} samples: ${tally.beforeDamage} code points before a first damage have the states of today's parser on the broken text, ${tally.keptAndScored} kept code points are shown as their label's kind. ${tally.added} added code points have none, ${tally.replaced} are replaced.`)
console.log(`   A parser of the broken text can be in the intended state after every code point before a first damage, and after ${tally.canFollowFromDamage} of the ${tally.keptFromDamage} kept code points from a first damage on (${(100 * tally.canFollowFromDamage / tally.keptFromDamage).toFixed(1)}%), as intended.ts marks them.`)
// With `null` as the cache folder the samples are made now, whatever RECOVERY_SCRATCH says. They have to be the
// arrays above, which come from the cache when there is one.
{
  const fresh = loadSamples(seed, 0, Math.min(200, sampleCount), null)
  const fields = ['codePoints', 'flags', 'labelKind', 'labelDepth', 'labelContainer', 'intendedLexerAfter', 'intendedEvent', 'intendedGrammarAfter'] as const
  for (const field of fields) {
    for (let at = 0; at < fresh.codePointCount; at++) {
      if (fresh[field][at] !== samples[field][at]) {
        fail(`${field} at code point ${at}: ${fresh[field][at]} when made without a cache, and ${samples[field][at]} in the arrays`)
        break
      }
    }
  }
  if (fresh.codePointCount !== samples.start[fresh.sampleCount]) fail(`the first ${fresh.sampleCount} samples have ${fresh.codePointCount} code points when made without a cache, and ${samples.start[fresh.sampleCount]} in the arrays`)
}
console.log(`2. The arrays of loadSamples hold the ${sampleCount} samples as sampleAt and labelsOf give them, ${tally.codePoints} code points${cacheFolder === null ? '' : ', and the first 200 made without the cache are the same'}.`)

const score = scoreTables(asIsTables(), samples, {splits: ['train', 'validation', 'test']})
const all = score.rows[0]!
for (const field of ['samples', 'nothingToRecover', 'codePoints', 'kindScored', 'kindRight', 'depthRight', 'beforeError', 'wrongBeforeError', 'samplesWrongBeforeError', 'addedCodePoints', 'addedShownAsError', 'samplesShowingError', 'shownAsPastEnd'] as const) {
  if (all[field] !== expected[field]) fail(`${field}: scoreTables counts ${all[field]}, and the count made here ${expected[field]}`)
}
const percent = (share: number) => (100 * share).toFixed(1)
const [mine, theirs] = [sharesOf(all), sharesOf(expected)]
console.log(`3. Today's tables over the samples 0 to ${sampleCount - 1}, every split: ${all.samples} broken samples, ${all.nothingToRecover} with nothing to recover, ${all.codePoints} labeled code points from the damage on.`)
console.log(`   scoreTables and the count made here with today's parser agree on the display kind (${all.kindRight} of ${all.kindScored} right, ${percent(mine.kind)}%) and on the depth (${all.depthRight} right, ${percent(mine.depth)}%).`)
console.log(`   Container right: ${all.containerRight} with the stack (${percent(mine.container)}%), ${expected.containerRight} with today's running sum (${percent(theirs.container)}%), ${all.containerRight - expected.containerRight} more.`)
console.log(`   All three right: ${all.allRight} with the stack (${percent(mine.allThree)}%), ${expected.allRight} with today's running sum (${percent(theirs.allThree)}%), ${all.allRight - expected.allRight} more.`)
console.log(`   Whole samples right: ${all.wholeSamples} with the stack (${percent(mine.whole)}%), ${expected.wholeSamples} with today's running sum (${percent(theirs.whole)}%).`)
console.log(`   Both counts also agree on what the shares do not show: ${all.beforeError} scored code points come before the first error, and ${all.wrongBeforeError} of them are wrong for every choice of the open cells, in ${all.samplesWrongBeforeError} samples, so no tables pass ${percent(mine.ceiling)}% of all three and ${percent(mine.wholeCeiling)}% of whole samples. ${all.addedShownAsError} of the ${all.addedCodePoints} added code points are shown as an error (${percent(mine.addedAsError)}%), ${all.samplesShowingError} samples show an error at or after the first damage (${percent(mine.showsError)}%), and ${all.shownAsPastEnd} code points are shown as past the end.`)

if (statsFile !== undefined) {
  // A line of the statistics file's headroom table: samples, nothing, all 3, kind, depth, cont., whole, and the group.
  const lines = readFileSync(statsFile, 'utf8').split('\n')
  const header = lines[0] ?? ''
  if (!header.includes(`samples 0 to ${sampleCount - 1}.`)) fail(`the statistics file is not over the samples 0 to ${sampleCount - 1}: ${header}`)
  const groups: [mine: string, theirs: string][] = [
    ['all', 'every broken sample'], ['split: train', 'split: train'], ['split: validation', 'split: validation'], ['split: test', 'split: test'], ['source: damage', 'source: damage'],
    ['source: typing', 'source: typing'], ['reachable: yes', 'reachable: yes'], ['reachable: line rule', 'reachable: line rule'], ['reachable: no', 'reachable: no'],
    ['needs a class', 'needs a character class the highlighter lacks'], ['needs no class', 'needs no other character class'], ...samples.kindNames.map((name): [string, string] => [`kind: ${name}`, name]),
  ]
  let compared = 0
  let otherContainer = 0
  let otherAllThree = 0
  for (const [group, name] of groups) {
    const row = rowOf(score, group)
    const line = lines.find(candidate => candidate.endsWith(`  ${name}`))
    if (row === undefined || line === undefined) {
      if (row !== undefined || line !== undefined) fail(`the group ${group} is in ${row === undefined ? 'the statistics file' : 'the score'} only`)
      continue
    }
    const [theirSamples, theirNothing, theirAllThree, theirKind, theirDepth, theirContainer] = line.trim().split(/\s+/)
    const shares = sharesOf(row)
    const text = (share: number) => Number.isNaN(share) ? '-' : percent(share)
    compared++
    if (String(row.samples) !== theirSamples || String(row.nothingToRecover) !== theirNothing) fail(`${group}: ${row.samples} samples and ${row.nothingToRecover} with nothing to recover, and the statistics file says ${theirSamples} and ${theirNothing}`)
    if (text(shares.kind) !== theirKind || text(shares.depth) !== theirDepth) fail(`${group}: kind ${text(shares.kind)} and depth ${text(shares.depth)}, and the statistics file says ${theirKind} and ${theirDepth}`)
    if (text(shares.container) !== theirContainer) otherContainer++
    if (text(shares.allThree) !== theirAllThree) otherAllThree++
    if (group === 'all') console.log(`   The statistics file's row of every broken sample: all three ${theirAllThree}, kind ${theirKind}, depth ${theirDepth}, container ${theirContainer}. scoreTables: all three ${text(shares.allThree)}, kind ${text(shares.kind)}, depth ${text(shares.depth)}, container ${text(shares.container)}.`)
  }
  console.log(`   ${compared} rows of the statistics file compared: the samples, the display kind and the depth are the same in ${failures === 0 ? 'every row' : 'the rows without a failure above'}. The container's percentage differs in ${otherContainer} rows and the percentage of all three in ${otherAllThree}.`)
}

{
  const validation = validationPart(loadStandardSamples(cacheFolder))
  const tables = asIsTables()
  scoreTables(tables, validation)
  const times: number[] = []
  for (let pass = 0; pass < 5; pass++) {
    const started = performance.now()
    scoreTables(tables, validation)
    times.push(performance.now() - started)
  }
  const validationScore = scoreTables(tables, validation)
  console.log(`4. One scoring pass over the validation part of the standard set, ${validation.sampleCount} samples and ${validation.codePointCount} code points: ${Math.min(...times).toFixed(0)} to ${Math.max(...times).toFixed(0)} ms in 5 passes. Today's tables on it:`)
  console.log(describeScore({...validationScore, rows: validationScore.rows.slice(0, 1)}).split('\n').map(line => `   ${line}`).join('\n'))
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
