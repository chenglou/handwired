// Writes samples as text for a reader: the first neutral samples, and next to them the broken train samples of the
// standard set that have the same originals, so that the two kinds of damage can be compared document by document.
//
// Run from the repo root, with RECOVERY_SCRATCH set, and give it a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/neutral-damage/dump.ts <folder> [--samples 300] [--standard 60] [--seed 20261016]
// It writes <folder>/samples.txt and <folder>/standard-samples.txt. Neutral sample k and the k-th sample of the
// second file are made from the same original. Only train samples are written.
//
// The lines of a sample, one column per code point of the broken text (⏎ is a line feed, → a tab, ↵ a carriage
// return):
//   text   the broken text on one line
//   kind   the label's display kind: w whitespace, p punctuation, s string, e escape, n number, l literal, k key.
//          Blank where the damage added the code point, so that it has no label, and ? where the kind is not scored.
//   depth  the label's depth after the code point, 0 to 9 and then a to g, and ? where it is not scored
//   cont   the label's innermost open container after the code point: o object, a array, - none, ? not scored
//   first  ^ under the first error of the parser as it is, from which on a score counts, and d under the first
//          damaged code point when it comes before the first error
import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {visible} from '../../../dump.ts'
import {kindLetters} from '../../../labels.ts'
import {type Sample, labelsOf, scoredCodePoints} from '../../../samples.ts'
import {allowedSampleAt, optionOf, refuseUnknownOptions, standardRange} from '../../data.ts'
import {indexesOfTheOriginals, neutralSampleAt, neutralSeed} from './neutral.ts'

const depthLetter = (depth: number | undefined) => depth === undefined ? '?' : depth < 0 ? '-' : depth > 16 ? '+' : '0123456789abcdefg'[depth]!
const containerLetter = (container: number | undefined) => container === undefined ? '?' : '-oa'[container] ?? '?'

// The rows of a broken sample under its header lines.
export function describeSample(header: readonly string[], sample: Sample): string {
  const labels = labelsOf(sample)
  const row = (letter: (position: number) => string) => labels.map((_, position) => letter(position)).join('').trimEnd()
  return [
    ...header,
    `    first damage at ${sample.firstDamage}, first error at ${sample.firstErrorPosition}, ${scoredCodePoints(sample, labels)} scored code points of ${labels.length}`,
    `text  ${visible(sample.broken)}`,
    `kind  ${row(position => labels[position] === undefined ? ' ' : labels[position].kind === undefined ? '?' : kindLetters[labels[position].kind]!)}`,
    `depth ${row(position => labels[position] === undefined ? ' ' : depthLetter(labels[position].depth))}`,
    `cont  ${row(position => labels[position] === undefined ? ' ' : containerLetter(labels[position].container))}`,
    `first ${row(position => position === sample.firstErrorPosition ? '^' : position === sample.firstDamage ? 'd' : ' ')}${sample.firstErrorPosition >= labels.length ? `${' '.repeat(labels.length - (sample.firstDamage < labels.length ? sample.firstDamage + 1 : 0))}^` : ''}`,
  ].join('\n')
}

if (import.meta.main) {
  refuseUnknownOptions('arms/neutral-damage/dump.ts', ['--samples', '--standard', '--seed'])
  const folder = process.argv[2]
  if (folder === undefined || folder.startsWith('--')) throw new Error('usage: bun lab/recovery-parser/learn/arms/neutral-damage/dump.ts <folder> [--samples 300] [--standard 60] [--seed 20261016]')
  const neutralCount = Number(optionOf('--samples') ?? 300)
  const standardCount = Number(optionOf('--standard') ?? 60)
  const seed = Number(optionOf('--seed') ?? neutralSeed)
  mkdirSync(folder, {recursive: true})
  const legend = [
    'One column per code point of the broken text. ⏎ is a line feed, → a tab, ↵ a carriage return.',
    'kind: the label\'s display kind, w whitespace, p punctuation, s string, e escape, n number, l literal, k key. Blank: the damage added the code point, so it has no label. ?: not scored.',
    'depth: the label\'s depth after the code point, 0 to 9 and then a to g. cont: the innermost open container after it, o object, a array, - none. ?: not scored.',
    'first: ^ is the first error of the parser as it is, from which on a score counts. d is the first damaged code point, when it comes before the first error.',
  ].join('\n')

  const neutral: string[] = []
  for (let index = 0; index < neutralCount; index++) {
    const {sample, applied, original} = neutralSampleAt(seed, index)
    neutral.push(describeSample([
      `--- ${sample.id}  ${applied.length} edit${applied.length === 1 ? '' : 's'}  original: sample ${original.standardIndex} of the standard set, ${sample.template}, ${sample.style}`,
      ...applied.map(edit => `    ${edit.description}`),
    ], sample))
  }
  writeFileSync(join(folder, 'samples.txt'), `${legend}\nThe places in the sentence of an edit are places in the text as it was when the edit was applied.\n\nThe neutral samples 0 to ${neutralCount - 1} of seed ${seed}.\n\n${neutral.join('\n\n')}\n`)

  const standard: string[] = []
  const indexes = indexesOfTheOriginals()
  for (let place = 0; place < standardCount; place++) {
    const sample = allowedSampleAt(standardRange.seed, indexes[place]!)
    if (sample === undefined || sample.split !== 'train') throw new Error(`the sample ${indexes[place]} of the standard set is no train sample`)
    standard.push(describeSample([
      `--- ${sample.id}  ${sample.source}${sample.source === 'damage' ? ` / ${sample.recipe}` : ''}  kinds: ${sample.kinds.join(', ')}  ${sample.template}, ${sample.style}  the original of the neutral sample ${place}`,
      ...sample.forms.map(form => `    ${form}`),
    ], sample))
  }
  writeFileSync(join(folder, 'standard-samples.txt'), `${legend}\n\nThe first ${standardCount} broken samples of the train split of the standard set (seed ${standardRange.seed}), in the set's order.\n\n${standard.join('\n\n')}\n`)
  console.log(`wrote ${neutralCount} neutral samples to ${join(folder, 'samples.txt')} and ${standardCount} standard train samples to ${join(folder, 'standard-samples.txt')}`)
}
