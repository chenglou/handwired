// Checks the mixed set of mixed.ts: the first 40,000 samples of its train split and the first 5,000 of its
// validation split.
// 1. The halves: the samples at the places 0, 2, 4 and so on of a split are the dataset's own samples, and the
//    others are samples of this folder on the program with the same index.
// 2. Every sample of the kinds half: the broken text has at most 512 code points and is rejected by the parser as
//    it is, its first error is where a second parse of the text finds it and is not the end of input, and at least
//    one code point is left to score. A kept code point is the original's code point and has the original's labels,
//    which are taken from the original here, by ../labels.ts, and not from the sample. The kept code points are in
//    the original's order. The original is a valid program.
// 3. A second look at the alignment, on the first 1,500 samples of the kinds half of each split: the shortest edit
//    script between the two texts, by alignmentOfTexts of ../sample.ts, knows nothing of the kinds. It may keep more
//    code points than the kinds' edits say, never fewer, and where both keep a code point with the same counterpart
//    the labels are the same by construction. The check counts the samples in which the two keep different numbers.
// 4. The splits: a sample's split is the split of its original, no list of tokens of an original is in both
//    splits, and no list of tokens of a broken text of the kinds half is in both splits.
// 5. The same sample twice: every 20th sample of the kinds half, made alone a second time, is the same.
// 6. The count of samples per kind on train and validation.
//
// Run from the repo root: bun lab/recovery-lr/kinds/check.ts [train samples, by default 40000] [validation samples, by default 5000]
import {type Split, defaultSeed, indexOfSample, loadSamples, splitOf, trainSampleCount, validationSampleCount} from '../dataset.ts'
import {labelsOfValidText} from '../labels.ts'
import {isValid, maximumCodePoints, parseText} from '../parser.ts'
import {type Sample, alignmentOfTexts} from '../sample.ts'
import {isTrivia} from '../tables.ts'
import {kinds} from './kinds.ts'
import {eachMixedSample, halfAt, kindsSampleAt} from './mixed.ts'

const problems: string[] = []
const problem = (text: string) => {
  if (problems.length < 30) console.log(`PROBLEM: ${text}`)
  problems.push(text)
}
const counts: Record<Split, number> = {train: Number(process.argv[2] ?? trainSampleCount), validation: Number(process.argv[3] ?? validationSampleCount)}
const terminalsOf = (tokens: Sample['tokens']): string => Array.from({length: tokens.count}, (_, token) => tokens.kind[token]!).filter(kind => !isTrivia(kind)).join(' ')
const same = (left: Sample, right: Sample): boolean => left.id === right.id && left.broken === right.broken && left.original === right.original && left.edits.join() === right.edits.join() && left.alignment.join() === right.alignment.join()
  && left.firstErrorPosition === right.firstErrorPosition && left.scored === right.scored && left.labelStack.join() === right.labelStack.join()

const originalLists: Record<Split, Set<string>> = {train: new Set(), validation: new Set()}
const brokenLists: Record<Split, Set<string>> = {train: new Set(), validation: new Set()}
const perKind: Record<Split, Map<string, number>> = {train: new Map(), validation: new Map()}
const kindCount: Record<Split, number[]> = {train: [0, 0, 0], validation: [0, 0, 0]}
const halves: Record<Split, {neutral: number, kinds: number}> = {train: {neutral: 0, kinds: 0}, validation: {neutral: 0, kinds: 0}}
let checkedTwice = 0, secondLooks = 0, secondLookKeepsMore = 0, secondLookKeepsFewer = 0, scoredOfKinds = 0, scoredOfNeutral = 0
const started = performance.now()

for (const split of ['train', 'validation'] as const) {
  const neutral = loadSamples(split, defaultSeed, Math.min(counts[split], 200))
  let place = 0
  for (const mixed of eachMixedSample(split, counts[split])) {
    const {sample, half, index} = mixed
    const name = `${split} sample ${sample.id}`
    if (half !== halfAt(place)) problem(`${name}: the half at place ${place} is ${half}`)
    if (indexOfSample(sample) !== index) problem(`${name}: its id does not hold its index ${index}`)
    halves[split][half]++
    // 4. The splits.
    if (splitOf(sample.original) !== split) problem(`${name}: its split is not the split of its original`)
    originalLists[split].add(terminalsOf(labelsOfValidText(sample.original).tokens))
    if (half === 'neutral') {
      // 1. The dataset's own sample, with the dataset's id.
      if (sample.id !== `${defaultSeed}:${index}`) problem(`${name}: a sample of the dataset's half has another id`)
      if (place < neutral.length && !same(neutral[place]!, sample)) problem(`${name}: it is not the dataset's sample at place ${place}`)
      scoredOfNeutral += sample.scored
      place++
      continue
    }
    place++
    if (sample.id !== `${defaultSeed}:${index}:kinds`) problem(`${name}: a sample of the kinds half has another id`)
    scoredOfKinds += sample.scored
    brokenLists[split].add(terminalsOf(sample.tokens))
    // 6. The counts.
    if (sample.edits.length < 1 || sample.edits.length > 2) problem(`${name}: it has ${sample.edits.length} kinds`)
    kindCount[split][sample.edits.length]!++
    for (const kind of sample.edits) perKind[split].set(kind, (perKind[split].get(kind) ?? 0) + 1)
    // 2. The sample against its two texts.
    const {codePoints, alignment} = sample
    if (codePoints.length > maximumCodePoints) problem(`${name}: the broken text has ${codePoints.length} code points`)
    if (!isValid(sample.original)) problem(`${name}: the original is no valid program`)
    const parsed = parseText(sample.broken)
    if (parsed.parse.valid) problem(`${name}: the broken text is a valid program`)
    if (parsed.parse.firstErrorToken !== sample.firstErrorToken || parsed.parse.firstErrorPosition !== sample.firstErrorPosition) problem(`${name}: a second parse finds the first error elsewhere`)
    if (sample.firstErrorToken >= sample.tokens.count || sample.firstErrorPosition >= codePoints.length) problem(`${name}: the first error is the end of input`)
    const labels = labelsOfValidText(sample.original)
    let previous = -1, scored = 0
    for (let position = 0; position < codePoints.length; position++) {
      const counterpart = alignment[position]!
      if (counterpart === -1) continue
      if (counterpart <= previous) problem(`${name}: the kept code points are not in the original's order at ${position}`)
      previous = counterpart
      if (labels.codePoints[counterpart] !== codePoints[position]) problem(`${name}: the kept code point ${position} is another code point than its counterpart`)
      if (sample.labelKind[position] !== labels.kind[counterpart] || sample.labelDepth[position] !== labels.depth[counterpart] || sample.labelContainer[position] !== labels.container[counterpart] || sample.labelStack[position] !== labels.stack[counterpart]) {
        problem(`${name}: the label of code point ${position} is not the original's`)
      }
      if (position >= sample.firstErrorPosition) scored++
    }
    if (scored !== sample.scored || scored < 1) problem(`${name}: ${scored} code points are left to score, and the sample says ${sample.scored}`)
    // 3. The shortest edit script as a second look at the alignment.
    if (halves[split].kinds <= 1500) {
      secondLooks++
      const shortest = alignmentOfTexts(sample.original, sample.broken)
      const keptByShortest = shortest.reduce((sum, counterpart) => sum + (counterpart === -1 ? 0 : 1), 0), keptByKinds = alignment.reduce((sum, counterpart) => sum + (counterpart === -1 ? 0 : 1), 0)
      if (keptByShortest > keptByKinds) secondLookKeepsMore++
      if (keptByShortest < keptByKinds) {
        secondLookKeepsFewer++
        problem(`${name}: the shortest edit script keeps fewer code points than the kinds' edits`)
      }
    }
    // 5. The same sample when it is made alone a second time.
    if (halves[split].kinds % 20 === 0) {
      checkedTwice++
      const again = kindsSampleAt(defaultSeed, index)
      if (!same(again.sample, sample) || again.split !== split) problem(`${name}: it is another sample when it is made alone a second time`)
    }
  }
  if (halves[split].neutral + halves[split].kinds !== counts[split]) problem(`the ${split} split has ${halves[split].neutral + halves[split].kinds} samples`)
}
let originalsInBoth = 0, brokenInBoth = 0
for (const list of originalLists.validation) if (originalLists.train.has(list)) originalsInBoth++
for (const list of brokenLists.validation) if (brokenLists.train.has(list)) brokenInBoth++
if (originalsInBoth > 0) problem(`${originalsInBoth} lists of tokens of an original are in both splits`)
if (brokenInBoth > 0) problem(`${brokenInBoth} lists of tokens of a broken text of the kinds half are in both splits`)
for (const kind of kinds) for (const split of ['train', 'validation'] as const) if ((perKind[split].get(kind.name) ?? 0) === 0) problem(`the kind ${kind.name} has no sample in the ${split} split`)

console.log(`1. The train split has ${halves.train.neutral} samples of the dataset and ${halves.train.kinds} of the kinds, the validation split ${halves.validation.neutral} and ${halves.validation.kinds}. The scored code points: ${scoredOfNeutral} in the dataset's half and ${scoredOfKinds} in the kinds half, of both splits.`)
console.log(`2. Every sample of the kinds half was held against its two texts: rejected, a first error that is not the end of input, something to score, the original's labels on the kept code points.`)
console.log(`3. The shortest edit script was made for ${secondLooks} samples of the kinds half: it keeps more code points than the kinds' edits in ${secondLookKeepsMore} of them and fewer in ${secondLookKeepsFewer}.`)
console.log(`4. ${originalLists.train.size} lists of tokens are in train originals and ${originalLists.validation.size} in validation originals, ${originalsInBoth} in both. Of the broken texts of the kinds half, ${brokenLists.train.size} lists are in train and ${brokenLists.validation.size} in validation, ${brokenInBoth} in both.`)
console.log(`5. ${checkedTwice} samples of the kinds half were made alone a second time.`)
console.log(`6. Samples per kind. A sample with two kinds counts for both. Train: ${kindCount.train[1]} samples with one kind and ${kindCount.train[2]} with two. Validation: ${kindCount.validation[1]} and ${kindCount.validation[2]}.`)
console.log('| kind | family | train | validation |\n| --- | --- | --- | --- |')
for (const kind of kinds) console.log(`| ${kind.name} | ${kind.family} | ${perKind.train.get(kind.name) ?? 0} | ${perKind.validation.get(kind.name) ?? 0} |`)
console.log(`The check took ${((performance.now() - started) / 1000).toFixed(0)} s.`)
console.log(problems.length === 0 ? 'Every check of the mixed set passed.' : `${problems.length} problems: NOT every check of the mixed set passed.`)
if (problems.length > 0) process.exit(1)
