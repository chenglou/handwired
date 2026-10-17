// The train and validation samples. Everyone loads samples through this file:
//   loadSamples('train', seed, count)       the first `count` train samples of a seed
//   loadSamples('validation', seed, count)  the same for validation
// The experiment's sets are the first 40,000 train samples and the first 5,000 validation samples of defaultSeed.
//
// A sample is one valid program of generate.ts with the neutral damage of damage.ts, see sample.ts for what it
// holds. Program `index` gives sample `index`: the damage is drawn again for the same program until it gives a
// sample, so every program is in the dataset once. Sample `index` of a seed is always the same sample, and can be
// made without the ones before it. Nothing is stored.
//
// The held-back sets are not here and are never loaded through this file: they are in held-back/, which nothing
// outside that folder may import.
import {damageProgram} from './damage.ts'
import {programOf} from './generate.ts'
import type {Sort} from './idioms.ts'
import {type ValidLabels, labelsOfValidText} from './labels.ts'
import {maximumCodePoints, textOf} from './parser.ts'
import {createRandom, hashText} from './random.ts'
import {type Refusal, type Sample, makeSample} from './sample.ts'
import {isTrivia} from './tables.ts'

export const defaultSeed = 20261016
export const trainSampleCount = 40_000, validationSampleCount = 5_000

export const splits = ['train', 'validation'] as const
export type Split = typeof splits[number]

// The valid program with the given index, its labels and its sort, e.g. 'listRecursion'. Throws when the
// generator hands out a text that is no valid program of at most 512 code points.
export function programAt(seed: number, index: number): {text: string, labels: ValidLabels, sort: Sort} {
  const {text, sort} = programOf(seed, index)
  const labels = labelsOfValidText(text)
  if (labels.codePoints.length > maximumCodePoints) throw new Error(`program ${seed}:${index} has ${labels.codePoints.length} code points`)
  return {text, labels, sort}
}

// The split of a program, by a hash of its tokens as the parser reads them: 8 of 9 lists of tokens are train
// lists. Two programs with the same tokens are in the same split, whatever their names, numbers, strings, comments
// and layout are, e.g. `let x = 1` and `let total = 42 (* sum *)`. So no validation program is a train program
// with other names.
export function splitOfTokens(labels: ValidLabels): Split {
  const terminals: number[] = []
  for (let token = 0; token < labels.tokens.count; token++) if (!isTrivia(labels.tokens.kind[token]!)) terminals.push(labels.tokens.kind[token]!)
  return hashText(terminals.join(' ')) % 9 === 0 ? 'validation' : 'train'
}
export const splitOf = (program: string): Split => splitOfTokens(labelsOfValidText(program))

// A different seed for the damage than for the programs, so that the two sequences of random numbers differ.
const damageSeed = (seed: number): number => seed ^ 0x5bd1e995

// The sample of a program, and why each draw of the damage before it gave none: the damaged text was unchanged,
// still valid, too long, or had nothing to score. Such a draw is thrown away and the damage is drawn again.
function sampleOfProgram(seed: number, index: number, text: string, labels: ValidLabels): {sample: Sample, refused: Refusal[]} {
  const random = createRandom(damageSeed(seed), index)
  const refused: Refusal[] = []
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const damaged = damageProgram(labels.codePoints, random)
    const sample = makeSample({id: `${seed}:${index}`, edits: damaged.edits, original: text, broken: textOf(damaged.codePoints), alignment: damaged.alignment}, labels)
    if (typeof sample !== 'string') return {sample, refused}
    refused.push(sample)
  }
  throw new Error(`program ${seed}:${index} gives no sample in 10,000 draws of the damage`)
}

// The sample with the given index, its split, the sort of its program, and the draws of the damage that were
// thrown away before it.
export function sampleAt(seed: number, index: number): {sample: Sample, split: Split, sort: Sort, refused: Refusal[]} {
  const {text, labels, sort} = programAt(seed, index)
  return {...sampleOfProgram(seed, index, text, labels), split: splitOfTokens(labels), sort}
}

// The first `count` samples of a split, in the order of their indexes. The indexes of the other split are passed
// over, so `count` train samples take about count × 9 / 8 programs.
export function loadSamples(split: Split, seed: number, count: number): Sample[] {
  const samples: Sample[] = []
  for (let index = 0; samples.length < count; index++) {
    const {text, labels} = programAt(seed, index)
    if (splitOfTokens(labels) === split) samples.push(sampleOfProgram(seed, index, text, labels).sample)
  }
  return samples
}

// The index of a sample in the programs of its seed, e.g. 1234 for the sample with the id "20261016:1234".
export const indexOfSample = (sample: Pick<Sample, 'id'>): number => Number(sample.id.split(':')[1])

if (import.meta.main) {
  const count = Number(process.argv[2] ?? 1000)
  const started = performance.now()
  const train = loadSamples('train', defaultSeed, count)
  console.log(`${count} train samples in ${((performance.now() - started) / 1000).toFixed(2)} s`)
  const sample = train[0]!
  console.log(sample.id, sample.edits)
  console.log(sample.broken)
}
