// The mixed set: as many samples as the dataset's sets have, the first 40,000 of the train split and the first 5,000
// of the validation split, on the same programs. Half of them are the dataset's own samples, whose damage knows
// nothing of miniml, and half of them have one or two kinds of mistakes of kinds.ts in the place of that damage.
//
// The programs of a split are taken in the order of their indexes, as ../dataset.ts takes them: the first, the third,
// the fifth and so on keep the dataset's sample, and the second, the fourth and so on get a sample of this folder
// that is made of the same program. So every program of the dataset's sets is in the mixed set once, a sample is in
// the split of its program, and no validation program enters the train split.
//
//   kindsSampleAt(seed, index)                 the sample of this folder for the program `index`
//   eachMixedSample(split, count)              the first `count` mixed samples of a split, one at a time
//   mixedPacked(split, count, layout)          the same, packed as ../learn/data.ts packs the dataset's samples
//   prepareMixedRecipe()                       what prepareRecipe of ../learn/recipe.ts gives, on the mixed train split:
//                                              trainedTables, searchedTables and countedTables of the recipe take it
//
// A sample of this folder is made by makeSample of ../sample.ts, as every sample of the dataset is: the labels of
// the kept code points are the original's, an added code point has none, and what is scored is what the dataset
// scores. Its id ends with ":kinds", e.g. "20261016:8:kinds", and its `edits` are the names of its kinds.
import {type Split, defaultSeed, programAt, sampleAt, splitOfTokens} from '../dataset.ts'
import type {Sort} from '../idioms.ts'
import type {ValidLabels} from '../labels.ts'
import {type PackedSamples, createPacker} from '../learn/data.ts'
import {standardTrainCount} from '../learn/options.ts'
import {terminalsChosenFromTrainSamples} from '../learn/picked-terminals.ts'
import type {Prepared} from '../learn/recipe.ts'
import {type RecoveryTables, addFirstOnLineFlag, addTerminals, baseTables} from '../learn/recovery-tables.ts'
import {textOf} from '../parser.ts'
import {type Random, createRandom, hashText} from '../random.ts'
import {type Refusal, type Sample, makeSample} from '../sample.ts'
import {type Damage, type Edit, type KindDefinition, type Scanned, applyEdits, kindNamed, kinds, scanProgram} from './kinds.ts'

// The share of the draws that are made with two kinds.
export const shareOfTwoKinds = 0.3
// How many draws of kinds one program gets.
const maximumDraws = 400

export type Half = 'neutral' | 'kinds'
// Which half the sample at a place of its split's list is from: the dataset's at the places 0, 2, 4 and so on.
export const halfAt = (placeInSplit: number): Half => placeInSplit % 2 === 0 ? 'neutral' : 'kinds'

// Why a draw of kinds gives no sample: the dataset's reasons, and that the program has no place for a drawn kind
// or that two kinds touch each other.
export type DrawRefusal = Refusal | 'no place'

// The random choices of a sample of this folder are apart from those of the dataset's sample with the same index.
const randomOf = (seed: number, index: number): Random => createRandom(hashText(`kinds of mistakes, seed ${seed}`), index)

// Whether the edits of two kinds sit apart: at least 8 code points lie between any two of them. Two mistakes that
// touch are one mistake of another kind.
function sitApart(left: readonly Edit[], right: readonly Edit[]): boolean {
  for (const first of left) {
    for (const second of right) {
      const [early, late] = first.at <= second.at ? [first, second] : [second, first]
      if (late.at - (early.at + early.remove) < 8) return false
    }
  }
  return true
}

function drawKinds(random: Random): KindDefinition[] {
  const first = random.weighted(kinds.map(kind => [kind, kind.weight] as const))
  if (!random.chance(shareOfTwoKinds)) return [first]
  return [first, random.weighted(kinds.filter(kind => kind !== first).map(kind => [kind, kind.weight] as const))]
}

type Original = {text: string, labels: ValidLabels, scanned: Scanned}

// One draw on a program: a sample, or the reason why the draw gives none.
function sampleOfDraw(id: string, random: Random, original: Original, drawn: readonly KindDefinition[]): {sample: Sample, forms: string[]} | DrawRefusal {
  const damages: Damage[] = []
  for (const kind of drawn) {
    const damage = kind.apply(random, original.scanned)
    if (damage === undefined || damage.edits.length === 0) return 'no place'
    damages.push(damage)
  }
  if (damages.length === 2 && damages.every(damage => damage.wholeText !== true) && !sitApart(damages[0]!.edits, damages[1]!.edits)) return 'no place'
  const applied = applyEdits(original.labels.codePoints, damages.flatMap(damage => damage.edits))
  if (applied === undefined) return 'no place'
  const sample = makeSample({id, edits: drawn.map(kind => kind.name), original: original.text, broken: textOf(applied.codePoints), alignment: applied.alignment}, original.labels)
  return typeof sample === 'string' ? sample : {sample, forms: drawn.map((kind, place) => `${kind.name}: ${damages[place]!.form}`)}
}

export type KindsSample = {sample: Sample, split: Split, sort: Sort, forms: string[], refused: DrawRefusal[]}

// The sample of this folder for the program with the given index: one or two kinds, drawn by their weights, again
// and again on the same program until a draw gives a sample. A draw is thrown away when the program has no place
// for a kind, when two kinds touch, and for the dataset's reasons: the result is unchanged, still valid, longer than
// 512 code points, or has nothing to score. So how often a kind comes also depends on how many programs have a
// place for it.
export function kindsSampleAt(seed: number, index: number): KindsSample {
  const {text, labels, sort} = programAt(seed, index)
  const original: Original = {text, labels, scanned: scanProgram(text, labels)}
  const random = randomOf(seed, index)
  const refused: DrawRefusal[] = []
  for (let draw = 0; draw < maximumDraws; draw++) {
    const made = sampleOfDraw(`${seed}:${index}:kinds`, random, original, drawKinds(random))
    if (typeof made === 'string') refused.push(made)
    else return {...made, split: splitOfTokens(labels), sort, refused}
  }
  throw new Error(`no kind of mistake gave a sample on the program ${seed}:${index} in ${maximumDraws} draws`)
}

// A sample with one given kind alone on the program with the given index, or the reason why 40 draws of the kind
// give none, e.g. 'no place' for `!=` on a program without `<>`. For dumps and counts per kind. Its random choices
// are not those of kindsSampleAt.
export function sampleOfKind(seed: number, index: number, name: string): KindsSample | DrawRefusal {
  const {text, labels, sort} = programAt(seed, index)
  const original: Original = {text, labels, scanned: scanProgram(text, labels)}
  const random = createRandom(hashText(`one kind, ${name}, seed ${seed}`), index)
  let last: DrawRefusal = 'no place'
  for (let draw = 0; draw < 40; draw++) {
    const made = sampleOfDraw(`${seed}:${index}:${name}`, random, original, [kindNamed(name)])
    if (typeof made !== 'string') return {...made, split: splitOfTokens(labels), sort, refused: []}
    last = made
  }
  return last
}

export type MixedSample = {half: Half, index: number, sample: Sample, sort: Sort, forms: string[]}

// The first `count` mixed samples of a split, in the order of their indexes, one at a time.
export function* eachMixedSample(split: Split, count: number, seed: number = defaultSeed): Generator<MixedSample> {
  let place = 0
  for (let index = 0; place < count; index++) {
    const {labels} = programAt(seed, index)
    if (splitOfTokens(labels) !== split) continue
    const half = halfAt(place++)
    if (half === 'neutral') {
      const {sample, sort} = sampleAt(seed, index)
      yield {half, index, sample, sort, forms: []}
    } else {
      const {sample, sort, forms} = kindsSampleAt(seed, index)
      yield {half, index, sample, sort, forms}
    }
  }
}

// The first `count` mixed samples of a split, or one half of them, packed for `layout`.
export function mixedPacked(split: Split, count: number, layout: RecoveryTables = baseTables(), seed: number = defaultSeed, half?: Half): PackedSamples {
  const packer = createPacker(layout)
  for (const mixed of eachMixedSample(split, count, seed)) if (half === undefined || mixed.half === half) packer.add(mixed.sample)
  return packer.finish()
}

function* mixedTrainSamples(count: number): Generator<Sample> {
  for (const mixed of eachMixedSample('train', count)) yield mixed.sample
}

// The steps 1 to 4 of ../learn/recipe.ts on the mixed train split: what prepareRecipe does, with the mixed samples
// in the place of the dataset's. The rule that picks code points for terminals of their own reads the mixed train
// samples, as it reads the train samples that a row trains on in the recipe.
export function prepareMixedRecipe(trainSamples: number = standardTrainCount): Prepared {
  const pickedTerminals = terminalsChosenFromTrainSamples(mixedTrainSamples(trainSamples))
  const base = addFirstOnLineFlag(addTerminals(baseTables(), pickedTerminals))
  return {base, pickedTerminals, train: mixedPacked('train', trainSamples, base)}
}
