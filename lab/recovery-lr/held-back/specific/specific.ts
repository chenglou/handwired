// HELD BACK. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read
// this file, see ../README.md.
//
// The samples of this set: valid programs of programs.ts with one or two mistakes of kinds.ts, in the shape of
// the train and validation samples, see ../../sample.ts.
//   loadSpecific()                        the set: specificSampleCount samples of specificSeed
//   specificSampleAt(seed, index)         one sample, with its kinds and what was thrown away before it
// Nothing is stored. Sample `index` of a seed is always the same sample and can be made without the ones before it.
//
// A sample has one kind with probability 0.65 and two with 0.35. The kinds are drawn first, by their weights.
// Then programs are drawn until one has a place for each kind and the broken text is a sample: the parser rejects
// it, at least 20 kept code points stand from its first error on, and it has at most 512 code points. So a kind
// has about its weight's share of the samples, whatever share of the programs it fits.
import {isValid, maximumCodePoints} from '../../parser.ts'
import {type Random, createRandom} from '../../random.ts'
import {type Refusal, type Sample, makeSample} from '../../sample.ts'
import type {Kind, Mistake} from './kind.ts'
import {kinds} from './kinds.ts'
import {programAt} from './programs.ts'
import {applyEdits, readProgram} from './reading.ts'
import type {SortName} from './templates.ts'

export const specificSeed = 20261017
export const specificSampleCount = 6000
const shareWithTwoKinds = 0.35
// A sample has at least this many scored code points: a mistake near the end of a program, with a line break
// after it and nothing else, says little about a recovery. The written set asks the same of its cases, as
// "a good part of the program comes after the parser's first error".
export const minimumScored = 20

// Why a drawn program gave no sample: the program has no place for a kind, the edits of the two kinds touch, or
// makeSample refuses the broken text.
export type Thrown = Refusal | 'no place for the kind' | 'the two kinds touch' | 'little to score'

export type SpecificSample = {
  sample: Sample
  // The sort of the valid program, e.g. 'shop'.
  sort: SortName
  // The kinds of the mistakes, which are also sample.edits, and the form of each, e.g. "before `let`".
  kinds: string[]
  forms: string[]
  // The valid program as the generator wrote it. sample.original differs from it where a whole token is missing,
  // see reading.ts.
  program: string
  // The draws that were thrown away before this sample.
  thrown: Thrown[]
}

// Two kinds that both change the start of the program, so that their edits always touch.
const neverTogether = [['text around the program', 'code fence'], ['another word for let', 'definition without let']]

const drawKind = (random: Random, alone: boolean): Kind => random.weighted(kinds.filter(kind => !alone || kind.onlyWithAnotherKind !== true).map(kind => [kind, kind.weight] as const))

// Whether a kept code point of the program stands between every edit of one mistake and every edit of the other.
function apart(first: Mistake, second: Mistake): boolean {
  return first.edits.every(one => second.edits.every(other => one.at + one.remove < other.at || other.at + other.remove < one.at))
}

export function specificSampleAt(seed: number, index: number): SpecificSample {
  const random = createRandom(seed ^ 0x2f6b1d35, index)
  const thrown: Thrown[] = []
  for (let round = 0; round < 50; round++) {
    // The first kind is one that is a mistake by itself. Two kinds of one sample differ.
    const drawn = [drawKind(random, true)]
    if (random.chance(shareWithTwoKinds)) {
      let second = drawKind(random, false)
      while (second === drawn[0] || neverTogether.some(pair => pair.includes(second.name) && pair.includes(drawn[0]!.name))) second = drawKind(random, false)
      drawn.push(second)
    }
    for (let attempt = 0; attempt < 60; attempt++) {
      const {text, sort} = programAt(seed, index, round * 60 + attempt)
      const program = readProgram(text)
      const mistakes: Mistake[] = []
      for (const kind of drawn) {
        const mistake = kind.apply(program, random)
        if (mistake === undefined || mistake.edits.length === 0) break
        mistakes.push(mistake)
      }
      if (mistakes.length < drawn.length) {
        thrown.push('no place for the kind')
        continue
      }
      const texts = mistakes.length === 2 && !apart(mistakes[0]!, mistakes[1]!) ? undefined : applyEdits(program, mistakes.flatMap(mistake => mistake.edits))
      if (texts === undefined) {
        thrown.push('the two kinds touch')
        continue
      }
      // The original can be longer than the program: a missing token gets a space of its own, see reading.ts.
      if (texts.original.length > maximumCodePoints) {
        thrown.push('too long')
        continue
      }
      if (!isValid(texts.original)) throw new Error(`the kinds ${drawn.map(kind => kind.name).join(' and ')} give an original that is no valid program:\n${texts.original}`)
      const names = drawn.map(kind => kind.name)
      const sample = makeSample({id: `specific:${index}`, edits: names, original: texts.original, broken: texts.broken, alignment: texts.alignment})
      if (typeof sample === 'string') {
        thrown.push(sample)
        continue
      }
      if (sample.scored < minimumScored) {
        thrown.push('little to score')
        continue
      }
      return {sample, sort, kinds: names, forms: mistakes.map(mistake => mistake.form), program: text, thrown}
    }
  }
  throw new Error(`sample ${seed}:${index} of the specific set: no program gives a sample in 3,000 draws`)
}

// The first `count` samples of a seed. Without arguments, the set.
export function loadSpecific(count: number = specificSampleCount, seed: number = specificSeed): SpecificSample[] {
  return Array.from({length: count}, (_, index) => specificSampleAt(seed, index))
}
