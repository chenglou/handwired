// Checks of the neutral set, in four parts:
// 1. The two pieces of the dataset's code that neutral.ts copies give what the dataset gives, on samples of the
//    standard set: what is not scored (unscoredOf), and the arrays of ../../data.ts (collectSamples).
// 2. Every neutral sample: its original is one valid document of the train split, the original of a train sample of
//    the standard set, and no document of a validation sample. The label of every kept code point is the original's,
//    by a parser of the dataset's check-samples.ts that shares no code with the labels. An added code point has no
//    label. What is not scored is what the dataset's rules say, by the dataset's second derivation and by a count of
//    this file. The sample has a first error, something to score, and the dataset's limits. The set of
//    makeNeutralSet holds the same samples as neutralSampleAt gives one by one.
// 3. The edits read nothing of JSON: neutral-edits.ts imports nothing but the type of the random source, and with
//    every code point but the line feed renamed, the same draws give the same edits.
// 4. The set has the form that the trainer and the search take: it packs for the twin and prepares for the search,
//    and every sample gives the twin a step.
// It also prints the counts of the set: the edits, the samples with one, two and three edits, and the draws that
// were thrown away with their reasons.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo. About half a minute:
//   bun lab/recovery-parser/learn/arms/neutral-damage/check.ts [--samples <count, at least 20000>]
// Without --samples it checks the whole set, 40,457 samples. It makes the samples itself and reads no cache file of
// the neutral set.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {ownLabels, sampleProblems} from '../../../check-samples.ts'
import {displayKind, labelsOfValidText} from '../../../labels.ts'
import {readsAsNumberOrLiteral} from '../../../limits.ts'
import {createRandom} from '../../../random.ts'
import {type Sample, heldOutTemplate, labelsOf, scoredCodePoints, splitKeyOf, splitOf} from '../../../samples.ts'
import {capacity, maximumDepth, runTableParser} from '../../../table-parser.ts'
import {type Samples, allowedSampleAt, codePointKept, codePointReplaced, loadSamples, loadStandardSamples, optionOf, refuseUnknownOptions, splitNames, standardRange} from '../../data.ts'
import {asIsTables} from '../../recovery-tables.ts'
import {prepareSamples} from '../../search/sample-runs.ts'
import {packForTwin, placesForTwin} from '../../soft/twin-data.ts'
import {drawNeutralDamage, neutralEditNames} from './neutral-edits.ts'
import {collectSamples, drawsPerOriginal, indexesOfTheOriginals, makeNeutralSet, neutralSampleAt, neutralSeed, rejections, unscoredOf} from './neutral.ts'

refuseUnknownOptions('arms/neutral-damage/check.ts', ['--samples'])
const sampleCount = Number(optionOf('--samples') ?? indexesOfTheOriginals().length)
if (!(sampleCount >= 20_000)) throw new Error(`--samples takes 20000 or more, and got ${optionOf('--samples')}`)
let failures = 0
const check = (holds: boolean, sentence: string) => {
  if (!holds) failures++
  console.log(`${holds ? 'ok' : 'FAILED'}: ${sentence}`)
}
const percent = (count: number, total: number) => `${(100 * count / total).toFixed(1)}%`
const sameNumbers = (left: ArrayLike<number>, right: ArrayLike<number>) => {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index++) if (left[index] !== right[index]) return false
  return true
}
// The names of the fields of some samples that are arrays of numbers, and the first one in which two sets differ.
const arrayFieldsOf = (samples: Samples) => Object.entries(samples).flatMap(([field, value]) => ArrayBuffer.isView(value) ? [field] : [])
const firstDifferentField = (left: Samples, right: Samples) => arrayFieldsOf(left).find(field => !sameNumbers((left as unknown as Record<string, ArrayLike<number>>)[field]!, (right as unknown as Record<string, ArrayLike<number>>)[field]!))

// Part 1.
{
  const upTo = 6000
  const standard = loadSamples(standardRange.seed, 0, upTo)
  const collected = collectSamples(standardRange.seed)
  let broken = 0
  let listsDiffer = 0
  let moreWithoutDeclared = 0
  for (let place = 0; place < standard.sampleCount; place++) {
    const sample = allowedSampleAt(standardRange.seed, standard.index[place]!)
    if (sample === undefined) throw new Error(`the sample ${standard.index[place]} of the arrays is in the test split`)
    collected.add(sample, standard.index[place]!)
    if (sample.source === 'valid') continue
    broken++
    const labels = sample.documents.flatMap(labelsOfValidText)
    const lists = (declared: readonly number[]) => unscoredOf(Array.from(sample.original), Array.from(sample.broken), labels, sample.alignment, sample.firstDamage, runTableParser(sample.broken), declared)
    // With what the sample's kinds declared, the copy has to give the sample's two lists. The kinds' declarations are
    // not in a sample, so its own list of display kinds stands for them: a rule that the copy lacked would not show
    // here, and part 2 looks for it. Without any declaration the copy may list fewer display kinds and never more.
    const withDeclared = lists(sample.unscoredKinds)
    const withoutDeclared = lists([])
    if (!sameNumbers(withDeclared.unscoredKinds, sample.unscoredKinds) || !sameNumbers(withDeclared.unscoredNesting, sample.unscoredNesting) || !sameNumbers(withoutDeclared.unscoredNesting, sample.unscoredNesting)) listsDiffer++
    if (withoutDeclared.unscoredKinds.some(index => !sample.unscoredKinds.includes(index))) moreWithoutDeclared++
  }
  check(listsDiffer === 0 && moreWithoutDeclared === 0, `the copy of the dataset's unscoredOf gives the dataset's lists of what is not scored for ${broken} broken samples of the standard set, and lists no display kind that the dataset scores: ${listsDiffer} and ${moreWithoutDeclared} samples differ`)
  const ownArrays = collected.done()
  const different = firstDifferentField(standard, ownArrays)
  check(different === undefined && ownArrays.sampleCount === standard.sampleCount && ownArrays.codePointCount === standard.codePointCount, `collectSamples gives the arrays of data.ts for the ${standard.sampleCount} samples of the indexes 0 to ${upTo - 1} that are not in the test split, in all ${arrayFieldsOf(standard).length} arrays${different === undefined ? '' : `: ${different} differs`}`)
}

// Part 2.
const set = makeNeutralSet(neutralSeed, sampleCount)
{
  const {samples} = set
  const standard = loadStandardSamples()
  // The documents of the validation samples of the standard set, and their tokens as the split reads them.
  const validation = splitNames.indexOf('validation')
  const validationDocuments = new Set<string>()
  const validationTokens = new Set<string>()
  for (let place = 0; place < standard.sampleCount; place++) {
    if (standard.split[place] !== validation) continue
    for (const document of allowedSampleAt(standardRange.seed, standard.index[place]!)!.documents) {
      validationDocuments.add(document)
      validationTokens.add(splitKeyOf(document))
    }
  }
  const originalPlaces = indexesOfTheOriginals()
  const counts = {
    notOfTrain: 0, ofValidation: 0, notTheStandardOriginal: 0, laterOriginal: 0, stillValid: 0, pastLimits: 0, noFirstError: 0, nothingToScore: 0, errorBeforeDamage: 0, badAlignment: 0, wrongLabel: 0, labelOnAdded: 0,
    keptCodePoints: 0, addedCodePoints: 0, scoredValues: 0, datasetProblems: 0, readAsTextBefore: 0, unexplainedUnscored: 0, unscoredKinds: 0, notAsTheSet: 0,
  }
  const editsPerSample = [0, 0, 0, 0]
  const keptEdits = neutralEditNames.map(() => 0)
  const keptAlone = neutralEditNames.map(() => 0)
  const thrownAway = rejections.map(() => 0)
  const thrownAwayAlone = neutralEditNames.map(() => rejections.map(() => 0))
  const thrownByEditCount = [0, 0, 0, 0]
  let draws = 0
  let drawsOfOriginalsGivenUp = 0
  const examples: string[] = []
  const note = (sample: Sample, what: string) => { if (examples.length < 12) examples.push(`${sample.id}: ${what}`) }
  for (let index = 0; index < sampleCount; index++) {
    const {sample, applied, original, thrownAway: everyThrownDraw, originalsGivenUp} = neutralSampleAt(neutralSeed, index)
    // The draws of an original that gave no sample are counted apart: 300 draws each, of a lone number or of "".
    const thrown = everyThrownDraw.slice(originalsGivenUp * drawsPerOriginal)
    drawsOfOriginalsGivenUp += originalsGivenUp * drawsPerOriginal
    if (originalsGivenUp > 0) counts.laterOriginal++
    draws += thrown.length + 1
    editsPerSample[applied.length]!++
    for (const {edit} of applied) keptEdits[edit]!++
    if (applied.length === 1) keptAlone[applied[0]!.edit]!++
    for (const {reason, edits} of thrown) {
      thrownAway[reason]!++
      thrownByEditCount[edits.length]!++
      if (edits.length === 1) thrownAwayAlone[edits[0]!]![reason]!++
    }

    // The original.
    const standardSample = allowedSampleAt(standardRange.seed, original.standardIndex)
    const isJson = (text: string) => {
      try {
        JSON.parse(text)
      } catch {
        return false
      }
      return true
    }
    if (splitOf(sample.original) !== 'train' || sample.template === heldOutTemplate || sample.split !== 'train' || sample.documents.length !== 1 || sample.documents[0] !== sample.original || !isJson(sample.original)) counts.notOfTrain++
    if (validationDocuments.has(sample.original) || validationTokens.has(splitKeyOf(sample.original))) counts.ofValidation++
    if (standardSample === undefined || standardSample.split !== 'train' || standardSample.heldOut.length > 0 || standardSample.source === 'valid' || standardSample.documents[0] !== sample.original || set.originalOf[index] !== original.standardIndex) counts.notTheStandardOriginal++
    if (original.standardIndex !== originalPlaces[(index + originalsGivenUp) % originalPlaces.length]) counts.notTheStandardOriginal++

    // The broken text.
    const originalCodePoints = Array.from(sample.original)
    const brokenCodePoints = Array.from(sample.broken)
    const trace = runTableParser(sample.broken)
    if (isJson(sample.broken) || trace.valid || sample.broken === sample.original) counts.stillValid++
    let deepest = 0
    for (let position = 0; position < trace.length; position++) deepest = Math.max(deepest, trace.depthAfter[position]!)
    if (brokenCodePoints.length > capacity || originalCodePoints.length > capacity || deepest > maximumDepth) counts.pastLimits++
    if (sample.firstErrorPosition !== trace.firstErrorPosition || sample.firstErrorPosition < 0 || sample.firstErrorPosition >= brokenCodePoints.length) counts.noFirstError++
    if (sample.firstErrorPosition < sample.firstDamage) counts.errorBeforeDamage++

    // The labels, against a parser that shares no code with labels.ts.
    const expected = ownLabels(sample.original)
    const labels = labelsOf(sample)
    const start = samples.start[index]!
    let previous = -1
    let scoredFromTheFirstError = 0
    if (labels.length !== brokenCodePoints.length || samples.start[index + 1]! - start !== brokenCodePoints.length) counts.badAlignment++
    for (let position = 0; position < brokenCodePoints.length; position++) {
      const counterpart = sample.alignment[position]!
      const label = labels[position]
      const flags = samples.flags[start + position]!
      const inArrays = {kind: samples.labelKind[start + position]!, depth: samples.labelDepth[start + position]!, container: samples.labelContainer[start + position]!}
      if (counterpart === -1) {
        counts.addedCodePoints++
        if (label !== undefined || (flags & codePointKept) !== 0 || inArrays.kind !== -1 || inArrays.depth !== -1 || inArrays.container !== -1) counts.labelOnAdded++
        continue
      }
      counts.keptCodePoints++
      if (counterpart <= previous || brokenCodePoints[position] !== originalCodePoints[counterpart] || sample.replaced[position] === true || (flags & codePointReplaced) !== 0 || (flags & codePointKept) === 0) counts.badAlignment++
      previous = counterpart
      const own = expected[counterpart]!
      if (label === undefined) {
        counts.wrongLabel++
        continue
      }
      // A scored value is the original's, in the sample's labels and in the arrays, and a value that is not scored is
      // -1 in the arrays.
      const scoredKind = label.kind !== undefined
      const scoredNesting = label.depth !== undefined
      if ((scoredKind && label.kind !== own.kind) || (scoredNesting && (label.depth !== own.depth || label.container !== own.container)) || (label.depth === undefined) !== (label.container === undefined)) counts.wrongLabel++
      if (inArrays.kind !== (scoredKind ? own.kind : -1) || inArrays.depth !== (scoredNesting ? own.depth : -1) || inArrays.container !== (scoredNesting ? own.container : -1)) counts.wrongLabel++
      counts.scoredValues += Number(scoredKind) + 2 * Number(scoredNesting)
      if (position >= sample.firstErrorPosition && (scoredKind || scoredNesting)) scoredFromTheFirstError++
      // A display kind that is not scored has one of the dataset's two reasons: before the first error the parser
      // as it is shows another kind, or the code point is at the start of a string value that lost its opening
      // quote, where it reads as a number or a literal.
      if (!scoredKind) {
        counts.unscoredKinds++
        const beforeTheError = position < sample.firstErrorPosition && trace.displayKind[position] !== own.kind
        let valueStart = position
        while (valueStart > 0 && sample.alignment[valueStart - 1] !== -1 && sample.alignment[valueStart - 1] === sample.alignment[valueStart]! - 1 && expected[sample.alignment[valueStart - 1]!]!.kind === displayKind.string) valueStart--
        const quote = sample.alignment[valueStart]! - 1
        const lostItsQuote = own.kind === displayKind.string && quote >= 0 && originalCodePoints[quote] === '"' && !sample.alignment.includes(quote) && readsAsNumberOrLiteral(brokenCodePoints, valueStart) > position - valueStart
        if (!beforeTheError && !lostItsQuote) {
          counts.unexplainedUnscored++
          note(sample, `the display kind at ${position} is not scored, and neither rule says so`)
        }
      }
    }
    if (scoredFromTheFirstError === 0 || scoredFromTheFirstError !== scoredCodePoints(sample) || scoredFromTheFirstError !== samples.scored[index]) counts.nothingToScore++

    // The dataset's second derivation. One sentence of it does not fit a neutral sample: it takes a copy that
    // follows the text's start for text before the whole original, which the dataset keeps at the very start.
    const problems = sampleProblems(sample)
    const others = problems.filter(problem => !problem.includes('is text that stands before the whole original'))
    if (others.length < problems.length) counts.readAsTextBefore++
    if (others.length > 0) {
      counts.datasetProblems++
      note(sample, others[0]!)
    }

    // The set holds this sample.
    if (samples.index[index] !== index || samples.firstErrorPosition[index] !== sample.firstErrorPosition || samples.firstDamage[index] !== sample.firstDamage || !sameNumbers(samples.codePoints.subarray(start, samples.start[index + 1]), brokenCodePoints.map(codePoint => codePoint.codePointAt(0)!))
      || !sameNumbers(set.editList.subarray(set.editStart[index], set.editStart[index + 1]), applied.map(({edit}) => edit))) counts.notAsTheSet++
  }
  for (const example of examples) console.log(`  ${example}`)
  check(counts.notOfTrain === 0 && counts.notTheStandardOriginal === 0, `the original of each of the ${sampleCount} neutral samples is one valid document of the train split, not of the held-out template, and the first document of a broken train sample of the standard set: ${counts.notOfTrain} and ${counts.notTheStandardOriginal} are not. The split of a document is a function of its tokens, so a document of the train split is the original of no validation or test sample`)
  check(counts.ofValidation === 0, `no original is a document of one of the ${validationDocuments.size} documents of the validation samples of the standard set, or has the tokens of one: ${counts.ofValidation}`)
  check(counts.stillValid === 0 && counts.pastLimits === 0, `every broken text is rejected by JSON.parse and by the parser as it is, differs from its original, and has at most ${capacity} code points and ${maximumDepth} levels: ${counts.stillValid} and ${counts.pastLimits} do not`)
  check(counts.noFirstError === 0 && counts.nothingToScore === 0 && counts.errorBeforeDamage === 0, `every sample has a first error inside its text, never before its first damage, and a scored code point from there on: ${counts.noFirstError}, ${counts.errorBeforeDamage} and ${counts.nothingToScore} do not`)
  check(counts.badAlignment === 0 && counts.wrongLabel === 0, `each of the ${counts.keptCodePoints} kept code points is the code point of the original that it is aligned with, in the original's order, and every scored value of its label is the original's, ${counts.scoredValues} values by a parser that shares no code with the labels: ${counts.badAlignment} code points and ${counts.wrongLabel} labels are not`)
  check(counts.labelOnAdded === 0, `none of the ${counts.addedCodePoints} added code points has a label: ${counts.labelOnAdded}`)
  check(counts.datasetProblems === 0 && counts.unexplainedUnscored === 0, `the dataset's second derivation finds the edits, the alignment, the first damage, the first error and what is not scored as its rules say in every sample, and each of the ${counts.unscoredKinds} display kinds that are not scored has one of the dataset's two reasons: ${counts.datasetProblems} samples and ${counts.unexplainedUnscored} display kinds do not. In ${counts.readAsTextBefore} samples it reads a copy that follows the text's start as text before the whole original, which is not counted`)
  check(counts.notAsTheSet === 0, `the set of makeNeutralSet holds the samples that neutralSampleAt gives one by one: ${counts.notAsTheSet} differ`)
  const again = [sampleCount - 1, 12_345, 7, 0].map(index => neutralSampleAt(neutralSeed, index))
  check(again.every(({sample}, at) => sample.broken === String.fromCodePoint(...samples.codePoints.subarray(samples.start[[sampleCount - 1, 12_345, 7, 0][at]!], samples.start[[sampleCount - 1, 12_345, 7, 0][at]! + 1]))), 'a sample that is made again, out of order, is the same sample')

  const editCount = keptEdits.reduce((total, count) => total + count, 0)
  console.log('')
  console.log(`The ${sampleCount} samples have ${editCount} edits. One edit: ${editsPerSample[1]} samples (${percent(editsPerSample[1]!, sampleCount)}), two: ${editsPerSample[2]} (${percent(editsPerSample[2]!, sampleCount)}), three: ${editsPerSample[3]} (${percent(editsPerSample[3]!, sampleCount)}). The draws are 60%, 30% and 10%.`)
  console.log(`${draws} draws made them, and ${draws - sampleCount} were thrown away (${percent(draws - sampleCount, draws)}): ${thrownByEditCount[1]} with one edit, ${thrownByEditCount[2]} with two, ${thrownByEditCount[3]} with three.`)
  for (const [reason, name] of rejections.entries()) console.log(`  ${name}: ${thrownAway[reason]}`)
  console.log(`Not among these draws: ${drawsOfOriginalsGivenUp} draws of originals that gave no sample in ${drawsPerOriginal} draws each, e.g. the lone number 223 and the empty string "". ${counts.laterOriginal} samples took the original of the next sample for that reason, or of one after it.`)
  console.log('')
  console.log('| edit | in the samples | share of the edits | alone: kept | alone: thrown away | of those: no place, unchanged, too long, still valid JSON, too deep, nothing to score |')
  console.log('| --- | --- | --- | --- | --- | --- |')
  for (const [edit, name] of neutralEditNames.entries()) {
    const thrown = thrownAwayAlone[edit]!
    const thrownTotal = thrown.reduce((total, count) => total + count, 0)
    console.log(`| ${name} | ${keptEdits[edit]} | ${percent(keptEdits[edit]!, editCount)} | ${keptAlone[edit]} (${percent(keptAlone[edit]!, keptAlone[edit]! + thrownTotal)}) | ${thrownTotal} | ${thrown.join(', ')} |`)
  }
  console.log('')
}

// Part 3.
{
  const source = readFileSync(join(import.meta.dir, 'neutral-edits.ts'), 'utf8')
  const imports = source.split('\n').filter(line => /^\s*import\b/.test(line) || /\brequire\(|\bimport\(/.test(line))
  check(imports.length === 1 && imports[0] === 'import type {Random} from \'../../../random.ts\'', `neutral-edits.ts imports nothing but the type of the random source: ${JSON.stringify(imports)}`)
  // The same draws on the original and on the original with other names for its code points. The line feed keeps
  // its name: the edits read lines.
  const renamedCount = Math.min(sampleCount, 20_000)
  const stream = 500_000_000
  let different = 0
  let noPlace = 0
  for (let index = 0; index < renamedCount; index++) {
    const original = Array.from(neutralSampleAt(neutralSeed, index).original.text)
    const names = new Map<string, string>([['\n', '\n']])
    const distinct = [...new Set(original)].filter(codePoint => codePoint !== '\n')
    const shuffled = createRandom(neutralSeed, stream + 2 * index + 1).shuffled(distinct.map((_, place) => String.fromCodePoint(0xe000 + place)))
    distinct.forEach((codePoint, place) => names.set(codePoint, shuffled[place]!))
    const drawn = drawNeutralDamage(createRandom(neutralSeed, stream + 2 * index), original)
    const drawnRenamed = drawNeutralDamage(createRandom(neutralSeed, stream + 2 * index), original.map(codePoint => names.get(codePoint)!))
    if ('noPlaceFor' in drawn || 'noPlaceFor' in drawnRenamed) {
      noPlace++
      if (!('noPlaceFor' in drawn && 'noPlaceFor' in drawnRenamed && sameNumbers(drawn.noPlaceFor, drawnRenamed.noPlaceFor))) different++
      continue
    }
    const sameText = drawn.text.codePoints.length === drawnRenamed.text.codePoints.length && drawn.text.codePoints.every((codePoint, position) => names.get(codePoint) === drawnRenamed.text.codePoints[position])
    if (!sameText || !sameNumbers(drawn.text.origin, drawnRenamed.text.origin) || !sameNumbers(drawn.applied.map(({edit}) => edit), drawnRenamed.applied.map(({edit}) => edit))) different++
  }
  check(different === 0, `with every code point but the line feed renamed, the same draws give the same edits, the same text under the new names and the same kept code points, for ${renamedCount} originals, ${noPlace} of them with a draw that had no place: ${different} differ. So an edit reads which code points are equal and where the line feeds are, and no bracket, quote or other character of JSON`)
  console.log('  What does read JSON is the choice of which draws are kept: a draw is thrown away when its text is still valid JSON, and when no label is left to score after the first error of the parser as it is.')
}

// Part 4.
{
  const {samples} = set
  const places = placesForTwin(samples, 'train')
  const packed = packForTwin(samples, places, undefined, asIsTables())
  const prepared = prepareSamples(samples)
  const scored = samples.scored.reduce((total, count) => total + count, 0)
  check(places.length === sampleCount && packed.sampleCount === sampleCount && prepared.sampleCount === sampleCount && prepared.scoredCodePoints === scored, `the set packs for the twin and prepares for the search, with today's tables: ${packed.sampleCount} and ${prepared.sampleCount} of its ${sampleCount} samples, ${prepared.scoredCodePoints} scored code points of ${scored}`)
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
