// Checks the intended states, the typed arrays of data.ts and the scores of score.ts against the dataset's own
// samples and today's parser.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/check-data.ts [number of samples, default 20000] [--scratch <folder>]
//
// 1. Intended states: before the first damage they are the states of today's parser on the broken text, and at every
//    kept code point whose display kind is scored, the display table gives the label's kind for the intended event
//    and grammar state. The mark "a parser of the broken text can be in the intended state" (canFollow) is set at
//    every code point before the first damage and at no added code point, and the check counts how many of the kept
//    code points from the first damage on have it.
// 2. The arrays of loadSamples hold what sampleAt, labelsOf, groupOf, scoredCodePoints and mostRightFor of the
//    dataset give, sample by sample, and they hold no sample of the test split.
// 3. scoreTables with today's tables against a count made here from the dataset's functions and today's parser: the
//    same samples, scored code points, display kinds right and depths right, the same added code points and shown
//    errors. The container and all three labels can differ, because today's parser keeps the containers in a running
//    sum and the recovery parser in a stack. And before the first error today's parser gives every scored value, so
//    counting from the first error leaves nothing out that tables could change.
// 4. Every row of a score, in every count: a second count made here from the dataset's functions (sampleAt's sample,
//    labelsOf, groupOf, scoredCodePoints, mostRightFor, the kinds' families of damage.ts) and the exact parser's
//    trace, with its own rows per split, source, group, family, kind, debatable or not and carriage returns, against
//    scoreTables. For today's tables and for the hand-written tables, whose stack actions and changed cells make the
//    two parsers differ. A sample that is counted in the row of another group or kind, or as a whole sample with a
//    wrong code point, shows here.
// 5. The time of one scoring pass over the validation part of the standard set.
//
// The check reads the train and validation splits only: allowedSampleAt gives no sample of the test split.
import {kinds as kindDefinitions} from '../damage.ts'
import {displayKind} from '../labels.ts'
import {type Label, groupOf, labelsOf, mostRightFor, scoredCodePoints} from '../samples.ts'
import {runTableParser} from '../table-parser.ts'
import {
  allowedSampleAt, cacheFolderOf, codePointCanFollow, codePointKept, codePointKindScored, codePointNestingScored, codePointReplaced, groupNames, kindsOf, loadSamples, loadStandardSamples, optionOf,
  reachableNames, refuseUnknownOptions, sourceNames, splitNames, standardRange, textOf, validationPart,
} from './data.ts'
import {handwrittenTables} from './handwritten/rules.ts'
import {intendedOf} from './intended.ts'
import {codePointsOf, runRecoveryParser} from './recovery-parser.ts'
import {asIsTables, today} from './recovery-tables.ts'
import {type ScoreRow, describeScore, scoreTables, sharesOf} from './score.ts'

refuseUnknownOptions('check-data.ts', ['--scratch'])
const sampleCount = Number(process.argv[2] !== undefined && !process.argv[2].startsWith('--') ? process.argv[2] : 20_000)
const cacheFolder = cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH'])
const seed = standardRange.seed
let failures = 0
const fail = (message: string) => {
  failures++
  if (failures <= 20) console.log(`FAILED: ${message}`)
}

const samples = loadSamples(seed, 0, sampleCount, cacheFolder)
// The count made here: one row for every broken sample of the train and validation splits.
const emptyRow = (name: string): ScoreRow => ({
  name, samples: 0, nothingToRecover: 0, codePoints: 0, allRight: 0, kindScored: 0, kindRight: 0, nestingScored: 0, depthRight: 0, containerRight: 0, wholeSamples: 0,
  plainBoundRight: 0, plainBoundWholeSamples: 0, addedCodePoints: 0, addedShownAsError: 0, samplesShowingError: 0, shownAsPastEnd: 0,
})
const expected: ScoreRow = emptyRow('all')
// The second count of part 4: the rows by name, per tables, made with the exact parser.
const familyOfKind = new Map<string, string>(kindDefinitions.map(kind => [kind.name, kind.family]))
const tablesOfPart4 = [{name: 'today\'s tables', tables: asIsTables(), rows: new Map<string, ScoreRow>()}, {name: 'the hand-written tables', tables: handwrittenTables().tables, rows: new Map<string, ScoreRow>()}]
const tally = {
  beforeDamage: 0, keptAndScored: 0, replaced: 0, added: 0, codePoints: 0, keptFromDamage: 0, canFollowFromDamage: 0, leftOut: 0, scoredValuesBeforeError: 0, wrongBeforeError: 0,
  keptBetweenDamageAndError: 0, unscoredKinds: 0, unscoredNesting: 0, keptFromError: 0,
}

let place = 0
for (let index = 0; index < sampleCount; index++) {
  const sample = allowedSampleAt(seed, index)
  if (sample === undefined) {
    tally.leftOut++
    continue
  }
  if (place >= samples.sampleCount) {
    fail(`the arrays hold ${samples.sampleCount} samples, and sample ${sample.id} would be one more`)
    break
  }
  const labels: (Label | undefined)[] = labelsOf(sample)
  const intended = intendedOf(sample)
  const trace = runTableParser(sample.broken)
  const start = samples.start[place]!
  const length = sample.alignment.length
  const valid = sample.source === 'valid'

  // 2. The arrays against the sample.
  const perSample: [string, unknown, unknown][] = [
    ['text', textOf(samples, place), sample.broken], ['length', samples.start[place + 1]! - start, length], ['index', samples.index[place], index],
    ['firstDamage', samples.firstDamage[place], sample.firstDamage], ['split', splitNames[samples.split[place]!], sample.split],
    ['source', sourceNames[samples.source[place]!], sample.source], ['reachable', reachableNames[samples.reachable[place]!], sample.reachable],
    ['group', groupNames[samples.group[place]!], groupOf(sample)],
    ['needsClass', samples.needsClass[place], Number(sample.needsClass.length > 0)], ['needsNestingFix', samples.needsNestingFix[place], Number(sample.needsNestingFix)],
    ['needsDisplayFix', samples.needsDisplayFix[place], Number(sample.needsDisplayFix)], ['debatable', samples.debatable[place], Number(sample.debatable)],
    ['carriageReturns', samples.carriageReturns[place], Number(sample.lineEnd === '\r\n')], ['kinds', kindsOf(samples, place).join(','), sample.kinds.join(',')],
    ['heldOut', samples.heldOut[place], 0], ['held out, in the sample', sample.heldOut.length, 0],
    ['scored', samples.scored[place], valid ? 0 : scoredCodePoints(sample, labels)], ['mostRight', samples.mostRight[place], valid ? 0 : mostRightFor(sample, labels).right],
  ]
  if (!valid) perSample.push(['firstErrorPosition', samples.firstErrorPosition[place], trace.firstErrorPosition], ['firstErrorKind', samples.firstErrorKind[place], trace.firstErrorKind])
  for (const [name, actual, wanted] of perSample) if (actual !== wanted) fail(`sample ${sample.id}: ${name} is ${String(actual)} in the arrays, and ${String(wanted)} in the sample`)
  if (!valid && sample.firstErrorPosition < sample.firstDamage) fail(`sample ${sample.id}: its first error at ${sample.firstErrorPosition} is before its first damage at ${sample.firstDamage}`)
  tally.codePoints += length
  for (let position = 0; position < length; position++) {
    const label = labels[position]
    const flags = samples.flags[start + position]!
    const wantedFlags = (label === undefined ? 0 : codePointKept) | (label?.kind === undefined ? 0 : codePointKindScored) | (label?.depth === undefined ? 0 : codePointNestingScored)
      | (sample.replaced[position] === true ? codePointReplaced : 0) | (intended.canFollow[position] === 1 ? codePointCanFollow : 0)
    if (flags !== wantedFlags || samples.labelKind[start + position] !== (label?.kind ?? -1) || samples.labelDepth[start + position] !== (label?.depth ?? -1) || samples.labelContainer[start + position] !== (label?.container ?? -1)) {
      fail(`sample ${sample.id}, code point ${position}: the arrays do not hold the label`)
    }
    if (samples.intendedLexerAfter[start + position] !== intended.lexerStateAfter[position] || samples.intendedEvent[start + position] !== intended.event[position] || samples.intendedGrammarAfter[start + position] !== intended.grammarAfter[position]
      || samples.intendedDepthAfter[start + position] !== intended.depthAfter[position] || samples.intendedContainerAfter[start + position] !== intended.containerAfter[position]) {
      fail(`sample ${sample.id}, code point ${position}: the arrays do not hold the intended states`)
    }

    // 1. The intended states.
    if (sample.alignment[position] === -1) {
      tally.added++
      if (label !== undefined) fail(`sample ${sample.id}, code point ${position}: an added code point has a label`)
      if (intended.event[position] !== -1 || intended.lexerStateAfter[position] !== -1 || intended.grammarAfter[position] !== -1 || intended.depthAfter[position] !== -1 || intended.containerAfter[position] !== -1) fail(`sample ${sample.id}, code point ${position}: an added code point has an intended state`)
      if (intended.canFollow[position] !== 0) fail(`sample ${sample.id}, code point ${position}: an added code point is marked as one whose intended state can be followed`)
      continue
    }
    if (label === undefined) {
      fail(`sample ${sample.id}, code point ${position}: a kept code point has no label`)
      continue
    }
    if (!valid && position >= sample.firstDamage) {
      tally.keptFromDamage++
      if (intended.canFollow[position] === 1) tally.canFollowFromDamage++
      if (position < sample.firstErrorPosition) tally.keptBetweenDamageAndError++
      else tally.keptFromError++
      if (label.kind === undefined) tally.unscoredKinds++
      if (label.depth === undefined) tally.unscoredNesting++
    }
    if (sample.replaced[position] === true) tally.replaced++
    if (label.kind !== undefined) {
      tally.keptAndScored++
      const shown = today.display[intended.event[position]! * today.grammarStateCount + intended.grammarAfter[position]!]
      if (shown !== label.kind) fail(`sample ${sample.id}, code point ${position}: the intended event and grammar state are shown as kind ${shown}, and the label's kind is ${label.kind}`)
    }
    // The intended depth and container are the ones of the original at every kept code point. Where the label's are
    // scored, they are the same numbers.
    if (label.depth !== undefined && (intended.depthAfter[position] !== label.depth || intended.containerAfter[position] !== label.container)) fail(`sample ${sample.id}, code point ${position}: the intended depth and container are not the label's`)
    if (valid || position < sample.firstDamage) {
      tally.beforeDamage++
      if (intended.lexerStateAfter[position] !== trace.lexerStateBefore[position + 1] || intended.event[position] !== trace.event[position] || intended.grammarAfter[position] !== trace.grammarAfter[position]
        || intended.depthAfter[position] !== trace.depthAfter[position] || intended.containerAfter[position] !== trace.containerAfter[position]) {
        fail(`sample ${sample.id}, code point ${position}, before the first damage: the intended states are not the states of today's parser on the broken text`)
      }
      // Before the first damage every cell that is read is frozen and gives the intended state.
      if (intended.canFollow[position] !== 1) fail(`sample ${sample.id}, code point ${position}, before the first damage: not marked as one whose intended state can be followed`)
    }
    // Before the first error, every scored value is what today's parser gives.
    if (!valid && position < trace.firstErrorPosition) {
      if (label.kind !== undefined) {
        tally.scoredValuesBeforeError++
        if (label.kind !== trace.displayKind[position]) tally.wrongBeforeError++
      }
      if (label.depth !== undefined) {
        tally.scoredValuesBeforeError += 2
        if (label.depth !== trace.depthAfter[position]) tally.wrongBeforeError++
        if (label.container !== trace.containerAfter[position]) tally.wrongBeforeError++
      }
    }
  }

  // 3. The count made here.
  if (!valid) {
    expected.samples++
    let scored = 0
    let right = 0
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
      if (position < trace.firstErrorPosition || (label.kind === undefined && label.depth === undefined)) continue
      scored++
      let isRight = true
      if (label.kind !== undefined) {
        expected.kindScored++
        if (label.kind === shown) expected.kindRight++
        else isRight = false
      }
      if (label.depth !== undefined) {
        expected.nestingScored++
        if (label.depth === trace.depthAfter[position]) expected.depthRight++
        else isRight = false
        if (label.container === trace.containerAfter[position]) expected.containerRight++
        else isRight = false
      }
      if (isRight) right++
    }
    if (showsError) expected.samplesShowingError++
    if (scored !== scoredCodePoints(sample, labels)) fail(`sample ${sample.id}: ${scored} scored code points counted here, and scoredCodePoints says ${scoredCodePoints(sample, labels)}`)
    const bound = mostRightFor(sample, labels)
    expected.codePoints += scored
    expected.allRight += right
    expected.plainBoundRight += bound.right
    if (scored === 0) expected.nothingToRecover++
    else {
      if (right === scored) expected.wholeSamples++
      if (bound.right === scored) expected.plainBoundWholeSamples++
    }

    // 4. The same count with the exact parser, and the rows that the sample is in, from the sample's own fields.
    const rowNames = [
      'all', `split: ${sample.split}`, `source: ${sample.source}`, `group: ${groupOf(sample)}`, sample.debatable ? 'debatable' : 'not debatable',
      ...(sample.lineEnd === '\r\n' ? ['line ends with a carriage return'] : []),
      ...new Set(sample.kinds.map(kind => `family: ${familyOfKind.get(kind)}`)), ...new Set(sample.kinds.map(kind => `kind: ${kind}`)),
    ]
    const {codePoints, truncated} = codePointsOf(sample.broken)
    for (const {tables, rows} of tablesOfPart4) {
      const exact = runRecoveryParser(codePoints, truncated, tables)
      const ofSample = emptyRow('')
      let exactShowsError = false
      for (let position = sample.firstDamage; position < length; position++) {
        const label = labels[position]
        const shown = exact.displayKind[position]
        if (shown === displayKind.error) exactShowsError = true
        if (shown === displayKind.pastEnd) ofSample.shownAsPastEnd++
        if (label === undefined) {
          ofSample.addedCodePoints++
          if (shown === displayKind.error) ofSample.addedShownAsError++
          continue
        }
        if (position < sample.firstErrorPosition || (label.kind === undefined && label.depth === undefined)) continue
        ofSample.codePoints++
        const kindIsRight = label.kind === undefined || label.kind === shown
        const depthIsRight = label.depth === undefined || label.depth === exact.depthAfter[position]
        const containerIsRight = label.container === undefined || label.container === exact.containerAfter[position]
        if (label.kind !== undefined) {
          ofSample.kindScored++
          if (kindIsRight) ofSample.kindRight++
        }
        if (label.depth !== undefined) {
          ofSample.nestingScored++
          if (depthIsRight) ofSample.depthRight++
          if (containerIsRight) ofSample.containerRight++
        }
        if (kindIsRight && depthIsRight && containerIsRight) ofSample.allRight++
      }
      for (const name of rowNames) {
        let row = rows.get(name)
        if (row === undefined) {
          row = emptyRow(name)
          rows.set(name, row)
        }
        row.samples++
        if (ofSample.codePoints === 0) row.nothingToRecover++
        else {
          if (ofSample.allRight === ofSample.codePoints) row.wholeSamples++
          if (bound.right === ofSample.codePoints) row.plainBoundWholeSamples++
        }
        row.plainBoundRight += bound.right
        if (exactShowsError) row.samplesShowingError++
        for (const field of ['codePoints', 'allRight', 'kindScored', 'kindRight', 'nestingScored', 'depthRight', 'containerRight', 'addedCodePoints', 'addedShownAsError', 'shownAsPastEnd'] as const) row[field] += ofSample[field]
      }
    }
  }
  place++
}
if (place !== samples.sampleCount) fail(`the arrays hold ${samples.sampleCount} samples, and ${place} of the ${sampleCount} samples are not in the test split`)
if (samples.split.includes(splitNames.indexOf('test')) || samples.heldOut.some(bits => bits !== 0) || samples.withTest) fail('the arrays hold a sample of the test split, or one that is held out')
console.log(`1. Intended states of ${place} samples: ${tally.beforeDamage} code points before a first damage have the states of today's parser on the broken text, ${tally.keptAndScored} kept code points are shown as their label's kind. ${tally.added} added code points have none, ${tally.replaced} are replaced.`)
console.log(`   A parser of the broken text can be in the intended state after every code point before a first damage, and after ${tally.canFollowFromDamage} of the ${tally.keptFromDamage} kept code points from a first damage on (${(100 * tally.canFollowFromDamage / tally.keptFromDamage).toFixed(1)}%), as intended.ts marks them.`)
console.log(`   Of those ${tally.keptFromDamage} kept code points, ${tally.keptBetweenDamageAndError} come before the first error and ${tally.keptFromError} at or after it. The display kind is not scored at ${tally.unscoredKinds} of them, and the depth and the container at ${tally.unscoredNesting}.`)
// With `null` as the cache folder the samples are made now, whatever RECOVERY_SCRATCH says. They have to be the
// arrays above, which come from the cache when there is one.
{
  const fresh = loadSamples(seed, 0, Math.min(200, sampleCount), null)
  const fields = ['codePoints', 'flags', 'labelKind', 'labelDepth', 'labelContainer', 'intendedLexerAfter', 'intendedEvent', 'intendedGrammarAfter', 'intendedDepthAfter', 'intendedContainerAfter'] as const
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
console.log(`2. The arrays of loadSamples hold the ${place} samples of the indexes 0 to ${sampleCount - 1} that are not in the test split, as the dataset's functions give them, ${tally.codePoints} code points${cacheFolder === null ? '' : ', and the first 200 indexes made without the cache are the same'}. ${tally.leftOut} samples of the test split are left out, and no array holds one.`)

const score = scoreTables(asIsTables(), samples, {splits: ['train', 'validation']})
const all = score.rows[0]!
for (const field of ['samples', 'nothingToRecover', 'codePoints', 'kindScored', 'kindRight', 'nestingScored', 'depthRight', 'plainBoundRight', 'plainBoundWholeSamples', 'addedCodePoints', 'addedShownAsError', 'samplesShowingError', 'shownAsPastEnd'] as const) {
  if (all[field] !== expected[field]) fail(`${field}: scoreTables counts ${all[field]}, and the count made here ${expected[field]}`)
}
if (tally.wrongBeforeError > 0) fail(`${tally.wrongBeforeError} scored values before a first error are not what today's parser gives`)
const percent = (share: number) => (100 * share).toFixed(1)
const [mine, theirs] = [sharesOf(all), sharesOf(expected)]
console.log(`3. Today's tables over those samples, the train and the validation split: ${all.samples} broken samples, ${all.nothingToRecover} with nothing to recover, ${all.codePoints} scored code points.`)
console.log(`   scoreTables and the count made here with today's parser agree on the display kind (${all.kindRight} of ${all.kindScored} right, ${percent(mine.kind)}%) and on the depth (${all.depthRight} of ${all.nestingScored} right, ${percent(mine.depth)}%).`)
console.log(`   Container right: ${all.containerRight} with the stack (${percent(mine.container)}%), ${expected.containerRight} with today's running sum (${percent(theirs.container)}%), ${all.containerRight - expected.containerRight} more.`)
console.log(`   All three right: ${all.allRight} with the stack (${percent(mine.allThree)}%), ${expected.allRight} with today's running sum (${percent(theirs.allThree)}%), ${all.allRight - expected.allRight} more.`)
console.log(`   Whole samples right: ${all.wholeSamples} with the stack (${percent(mine.whole)}%), ${expected.wholeSamples} with today's running sum (${percent(theirs.whole)}%).`)
console.log(`   Before the first error, all ${tally.scoredValuesBeforeError} scored values are what today's parser gives, so a score that counts from the first error leaves out nothing that tables could change.`)
console.log(`   Both counts also agree on what the shares do not show: the plain table parser can have at most ${all.plainBoundRight} of the scored code points right (${percent(mine.plainBound)}%) and ${all.plainBoundWholeSamples} whole samples (${percent(mine.plainBoundWhole)}%), by the dataset's mostRightFor. ${all.addedShownAsError} of the ${all.addedCodePoints} added code points are shown as an error (${percent(mine.addedAsError)}%), ${all.samplesShowingError} samples show an error at or after the first damage (${percent(mine.showsError)}%), and ${all.shownAsPastEnd} code points are shown as past the end.`)

// 4. Every row of scoreTables against the rows of the second count, in every count.
{
  const countFields = ['samples', 'nothingToRecover', 'codePoints', 'allRight', 'kindScored', 'kindRight', 'nestingScored', 'depthRight', 'containerRight', 'wholeSamples', 'plainBoundRight', 'plainBoundWholeSamples', 'addedCodePoints', 'addedShownAsError', 'samplesShowingError', 'shownAsPastEnd'] as const
  for (const {name, tables, rows} of tablesOfPart4) {
    const scored = scoreTables(tables, samples, {splits: ['train', 'validation']})
    let rowsThatDiffer = 0
    for (const row of scored.rows) {
      const made = rows.get(row.name)
      if (made === undefined) {
        rowsThatDiffer++
        fail(`${name}: scoreTables has the row ${JSON.stringify(row.name)} with ${row.samples} samples, and the count made here has no such row`)
        continue
      }
      const differing = countFields.filter(field => row[field] !== made[field])
      if (differing.length > 0) {
        rowsThatDiffer++
        fail(`${name}, row ${JSON.stringify(row.name)}: ${differing.map(field => `${field} is ${row[field]} in scoreTables and ${made[field]} in the count made here`).join(', ')}`)
      }
    }
    for (const rowName of rows.keys()) {
      if (!scored.rows.some(row => row.name === rowName)) {
        rowsThatDiffer++
        fail(`${name}: the count made here has the row ${JSON.stringify(rowName)}, and scoreTables has no such row`)
      }
    }
    const count = (prefix: string) => scored.rows.filter(row => row.name.startsWith(prefix)).length
    if (count('group: ') < 5 || count('kind: ') < 40 || count('family: ') < 8) fail(`${name}: the score has ${count('group: ')} rows of groups, ${count('family: ')} of families and ${count('kind: ')} of kinds, too few for this check to mean much`)
    const all = scored.rows[0]!
    console.log(`4. ${name}: all ${scored.rows.length} rows of scoreTables (${count('group: ')} groups, ${count('family: ')} families, ${count('kind: ')} kinds, the splits, the sources, debatable or not, carriage returns) are the rows of a second count made here with the exact parser, in all ${countFields.length} counts, ${rowsThatDiffer} rows differ. All three right: ${all.allRight} of ${all.codePoints} (${(100 * all.allRight / all.codePoints).toFixed(1)}%), whole samples ${all.wholeSamples}.`)
  }
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
  console.log(`5. One scoring pass over the validation part of the standard set, ${validation.sampleCount} samples and ${validation.codePointCount} code points: ${Math.min(...times).toFixed(0)} to ${Math.max(...times).toFixed(0)} ms in 5 passes. Today's tables on it:`)
  console.log(describeScore({...validationScore, rows: validationScore.rows.slice(0, 1)}).split('\n').map(line => `   ${line}`).join('\n'))
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
