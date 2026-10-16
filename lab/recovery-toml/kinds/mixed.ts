// The mixed set: as many samples as the dataset's standard set has in its train split and in its validation split,
// half of them the dataset's own samples, whose damage knows nothing of TOML, and half of them samples of this
// folder, whose damage is a kind of mistake written for TOML.
//
// The standard set is the samples 0 to 59,999 of the dataset's default seed, as in ../learn/data.ts. The indexes of a
// split are taken in their order: the first, the third, the fifth and so on keep the dataset's sample, and the second,
// the fourth and so on get the sample of this folder with the same index, which is made of the same document. So
// every document of the standard set is in the mixed set once, a sample is in the split that the dataset's sample
// with its index is in, and no index of the test split is read past its split.
//
//   mixedTrainSamples()        the samples of the train split, each with the half it is from
//   mixedValidationSamples()   the same for the validation split
//   mixedSet()                 both splits as the arrays that ../learn/ reads, e.g. for runRecipe(mixedSet(), seed)
//   kindsHalf()                the samples of this folder alone, of both splits, as such arrays
//
// In the arrays, a sample of the dataset has the source `damage` and a group by its number of edits, e.g. `two
// edits`, and a sample of this folder has the source `kinds` and the group `one kind` or `two kinds`. So a score has
// a row per half, `source: damage` and `source: kinds`, and a row per kind.
import {readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {type LabeledText, type Samples, samplesOf} from '../learn/data.ts'
import {type Sample, defaultSeed, groupOf, labelsOf, sampleAt} from '../samples.ts'
import {groupOfKinds, kindsSampleAt} from './samples.ts'

export type Half = 'neutral' | 'kinds'
export type MixedSample = {
  // 'neutral' for a sample of the dataset, 'kinds' for a sample of this folder.
  half: Half
  // The sample's index in the dataset, which is also the index of the document it is made of.
  index: number
  sample: Sample
}
export type MixedSplit = 'train' | 'validation'

// The standard set of ../learn/data.ts: `to` is the first index left out.
export type Range = {seed: number, from: number, to: number}
export const standardRange: Range = {seed: defaultSeed, from: 0, to: 60_000}

// The dataset's samples of a range that are not in the test split, made once per range: the mixed set needs each
// one's split, and half of them as they are.
const neutralSamplesOfRange = new Map<string, Sample[]>()
function neutralSamples(range: Range): Sample[] {
  const key = `${range.seed}:${range.from}:${range.to}`
  let samples = neutralSamplesOfRange.get(key)
  if (samples === undefined) {
    samples = []
    for (let index = range.from; index < range.to; index++) {
      const sample = sampleAt(range.seed, index)
      if (sample.split !== 'test') samples.push(sample)
    }
    neutralSamplesOfRange.set(key, samples)
  }
  return samples
}
const indexOf = (sample: Sample) => Number(sample.id.split(':')[1])

// Which half the sample at a place of its split's list is from: the dataset's at the places 0, 2, 4 and so on.
export const halfAt = (placeInSplit: number): Half => placeInSplit % 2 === 0 ? 'neutral' : 'kinds'

// The mixed samples of one split, in the order of their indexes.
export function mixedSamples(split: MixedSplit, range: Range = standardRange): MixedSample[] {
  return neutralSamples(range).filter(sample => sample.split === split).map((neutral, place) => {
    const half = halfAt(place)
    const index = indexOf(neutral)
    return {half, index, sample: half === 'neutral' ? neutral : kindsSampleAt(range.seed, index, neutral)}
  })
}
export const mixedTrainSamples = (range: Range = standardRange) => mixedSamples('train', range)
export const mixedValidationSamples = (range: Range = standardRange) => mixedSamples('validation', range)

// A mixed sample as ../learn/data.ts takes it.
export function labeledTextOf({half, index, sample}: MixedSample): LabeledText {
  const {kinds, broken, firstDamage, original, alignment, replaced, firstErrorPosition, split} = sample
  return {index, split, source: half === 'neutral' ? 'damage' : 'kinds', kinds, group: half === 'neutral' ? groupOf(sample) : groupOfKinds(sample), broken, labels: labelsOf(sample), firstDamage, original, alignment, replaced, firstErrorPosition}
}

// The arrays of ../learn/data.ts for mixed samples.
export const arraysOf = (samples: readonly MixedSample[], seed: number = standardRange.seed): Samples => samplesOf(samples.map(labeledTextOf), seed)

// Both splits of the mixed set as arrays: the train samples, then the validation samples.
export function mixedSet(range: Range = standardRange): Samples {
  return arraysOf([...mixedTrainSamples(range), ...mixedValidationSamples(range)], range.seed)
}

// The samples of this folder alone, of both splits, as arrays: the half of the mixed set that is not the dataset's.
export function kindsHalf(range: Range = standardRange): Samples {
  return arraysOf([...mixedTrainSamples(range), ...mixedValidationSamples(range)].filter(mixed => mixed.half === 'kinds'), range.seed)
}

// A hash of this folder's source files, for a file of tables that were trained on the mixed set: the dataset's key
// says nothing about the kinds. Two runs with the same dataset key and the same key of the kinds read the same mixed set.
export function kindsKey(): string {
  const folder = import.meta.dir
  const files = readdirSync(folder).filter(name => name.endsWith('.ts')).sort()
  return Bun.hash(files.map(name => Bun.hash(readFileSync(join(folder, name))).toString(16)).join('.')).toString(16)
}
