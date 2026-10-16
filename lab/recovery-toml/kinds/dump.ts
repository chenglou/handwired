// Writes samples of this folder as text files for reading, in fixed width, so that every code point of a broken text
// stands above its label.
//
// Run from the repo root: bun lab/recovery-toml/kinds/dump.ts <folder> [samples per kind, default 8]
// It writes two files:
//   samples.txt   the first 300 samples of this folder's half of the mixed train split, in the layout of ../dump.ts:
//                 the original, the broken text, and the label's display kind, depth and container per code point.
//   by-kind.txt   per kind, samples with that kind alone, on documents of the train split, cut down to the columns
//                 around the damage. Its line `marks` has a + under an added code point, a ~ under one that stands in
//                 the place of another, and a < under a kept code point that follows a removed part.
import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {describeSample, visible} from '../dump.ts'
import {errorKinds, kindLetters} from '../kinds.ts'
import {type Sample, defaultSeed, labelsOf, sampleAt, scoredCodePoints} from '../samples.ts'
import {containerNames} from '../table-parser.ts'
import {kinds} from './list.ts'
import {mixedTrainSamples} from './mixed.ts'
import {sampleOfKind} from './samples.ts'

const depthLetter = (depth: number | undefined) => depth === undefined ? '?' : '0123456789abcdefg'[depth] ?? '+'
const containerLetter = (container: number | undefined) => container === undefined ? '?' : containerNames[container] === 'none' ? '-' : containerNames[container]![0]!

// A sample cut down to the columns around its damage: from 40 columns before the first damaged code point to 60
// after the last one, and at most `width` columns.
export function describeAroundDamage(sample: Sample, width = 230): string {
  const labels = labelsOf(sample)
  const length = sample.alignment.length
  const marks = sample.alignment.map((counterpart, position) => {
    if (counterpart === -1) return '+'
    if (sample.replaced[position]) return '~'
    const before = position === 0 ? -1 : sample.alignment.slice(0, position).findLast(index => index !== -1) ?? -1
    return counterpart !== before + 1 ? '<' : ' '
  })
  const damaged = marks.flatMap((mark, position) => mark === ' ' ? [] : [position])
  const from = Math.max(0, (damaged[0] ?? length) - 40)
  const to = Math.min(length, Math.max(from + 1, Math.min(from + width, (damaged.at(-1) ?? length) + 60)))
  const row = (letter: (position: number) => string) => Array.from({length: to - from}, (_, offset) => letter(from + offset)).join('')
  const broken = Array.from(sample.broken)
  return [
    `--- ${sample.id}  ${sample.template}, ${sample.style}  ${sample.forms.map(visible).join('; ')}`,
    `    first damage at ${sample.firstDamage}, first error at ${sample.firstErrorPosition} (${errorKinds[sample.firstErrorKind]}), ${scoredCodePoints(sample, labels)} code points to score, columns ${from} to ${to - 1} of ${length}${sample.needsNestingFix ? ', a scored depth is out of the loop\'s reach' : ''}`,
    `brok  ${row(position => visible(broken[position]!))}`,
    `marks ${row(position => marks[position]!)}`,
    `label ${row(position => labels[position] === undefined ? ' ' : labels[position].kind === undefined ? '?' : kindLetters[labels[position].kind]!)}`,
    `depth ${row(position => labels[position] === undefined ? ' ' : depthLetter(labels[position].depth))}`,
    `cont  ${row(position => labels[position] === undefined ? ' ' : containerLetter(labels[position].container))}`,
    `first ${row(position => position === sample.firstErrorPosition ? '^' : ' ')}`,
  ].join('\n')
}

if (import.meta.main) {
  const folder = process.argv[2]
  if (folder === undefined) throw new Error('usage: bun lab/recovery-toml/kinds/dump.ts <folder> [samples per kind]')
  const perKind = Number(process.argv[3] ?? 8)
  mkdirSync(folder, {recursive: true})
  const legend = [
    'Letters of display kinds: w whitespace, p punctuation, s string, e escape, n number, l literal, k key, h header name, c comment.',
    'In the texts, ⏎ is a line feed, → a tab, ↵ a carriage return, ␛ the escape character, and ◆ a character that a terminal draws two columns wide. See the top of lab/recovery-toml/dump.ts for the lines.',
  ].join('\n')

  const wanted = 300
  const half = mixedTrainSamples({seed: defaultSeed, from: 0, to: 1200}).filter(mixed => mixed.half === 'kinds').slice(0, wanted)
  if (half.length < wanted) throw new Error(`the first 1200 indexes give ${half.length} samples of this folder's half`)
  writeFileSync(join(folder, 'samples.txt'), `${legend}\n\nThe first ${half.length} samples of the half of the mixed train split whose damage is a kind of mistake written for TOML, of seed ${defaultSeed}, in the order of their indexes (the indexes ${half[0]!.index} to ${half.at(-1)!.index}). A label is blank under a code point that the damage added, and a code point that stands in the place of another, e.g. the colon of \`port: 80\`, has the label of the one it stands for.\n\n${half.map(mixed => describeSample(mixed.sample)).join('\n\n')}\n`)

  // Per kind, on the documents of the train split from a later part of the seed, so that the two files differ.
  const sections: string[] = []
  for (const kind of kinds) {
    const samples: Sample[] = []
    for (let index = 20_000; samples.length < perKind && index < 26_000; index++) {
      if (sampleAt(defaultSeed, index).split !== 'train') continue
      const sample = sampleOfKind(defaultSeed, index, kind.name)
      if (sample !== undefined) samples.push(sample)
    }
    sections.push(`===== ${kind.name} (${kind.family}): ${kind.description}\n\n${samples.map(sample => describeAroundDamage(sample)).join('\n\n')}`)
  }
  writeFileSync(join(folder, 'by-kind.txt'), `${legend}\nmarks: + an added code point, ~ a code point that stands in the place of another, < a kept code point that follows a removed part.\n\n${perKind} samples per kind, each with that kind alone, on documents of the train split of seed ${defaultSeed}, cut down to the columns around the damage.\n\n${sections.join('\n\n\n')}\n`)
  console.log(`wrote samples.txt (${half.length} samples) and by-kind.txt (${kinds.length} kinds, ${perKind} samples each) to ${folder}`)
}
