// Text files for a reader of the dataset:
//   samples.txt    the first 300 train samples, each with its labels under its broken text
//   documents.txt  three valid programs of every sort
//
// Run from the repo root, with a folder outside the repo: bun lab/recovery-lr/dump.ts <folder> [seed] [samples]
//
// A sample in samples.txt:
//   #7  20261016:8  nestedLet  edits: delete a run  first error at code point 31, 88 scored
//   meant   let area w h =⏎  let half = w / 2 in⏎  half * h⏎
//   broken  let area w h =⏎  let half = w in⏎  half * h⏎
//   kind    kkkwdddd...      one letter per code point, see kindLetters in labels.ts: w white space, c comment,
//                            k keyword, n name, d defined name, a parameter, l constant, s string, o operator,
//                            p punctuation. + for a code point that an edit added, which has no label.
//   depth   1111111...       the last digit of the depth
//   in      llllllll...      the container, see containerLetters: . none, ( [ l let, = n in, i if, t then, e else,
//                            f fun, > ->
//   error                ^   the first error: the first code point of the token at which the parser as it is
//                            reports its error. The code points from there on that have a label are scored.
// In the two texts, ⏎ stands for a line feed, → for a tab, ␍ for a carriage return and · for another control character.
import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {defaultSeed, programAt, sampleAt} from './dataset.ts'
import {type Sort, sorts} from './idioms.ts'
import {containerLetters, kindLetters} from './labels.ts'
import type {Sample} from './sample.ts'

// A text on one line: one visible character per code point.
export const onOneLine = (text: string): string => Array.from(text, character => character === '\n' ? '⏎' : character === '\t' ? '→' : character === '\r' ? '␍' : character.codePointAt(0)! < 32 ? '·' : character).join('')

// The lines of a sample for samples.txt.
export function dumpSample(sample: Sample, sort: Sort, number: number): string {
  const row = (letterOf: (position: number) => string): string => Array.from(sample.codePoints, (_, position) => sample.alignment[position] === -1 ? '+' : letterOf(position)).join('')
  return [
    `#${number}  ${sample.id}  ${sort}  edits: ${sample.edits.join(', ')}  first error at code point ${sample.firstErrorPosition}, ${sample.scored} scored`,
    `meant   ${onOneLine(sample.original)}`,
    `broken  ${onOneLine(sample.broken)}`,
    `kind    ${row(position => kindLetters[sample.labelKind[position]!]!)}`,
    `depth   ${row(position => String(sample.labelDepth[position]! % 10))}`,
    `in      ${row(position => containerLetters[sample.labelContainer[position]!]!)}`,
    `error   ${' '.repeat(sample.firstErrorPosition)}^`,
  ].join('\n')
}

if (import.meta.main) {
  const folder = process.argv[2]
  if (folder === undefined) throw new Error('usage: bun lab/recovery-lr/dump.ts <folder> [seed] [samples]')
  const seed = Number(process.argv[3] ?? defaultSeed), sampleCount = Number(process.argv[4] ?? 300)
  mkdirSync(folder, {recursive: true})
  const dumped: string[] = []
  for (let index = 0; dumped.length < sampleCount; index++) {
    const {sample, split, sort} = sampleAt(seed, index)
    if (split === 'train') dumped.push(dumpSample(sample, sort, dumped.length))
  }
  writeFileSync(join(folder, 'samples.txt'), `The first ${sampleCount} train samples of the seed ${seed}. lab/recovery-lr/dump.ts says how to read them.\n\n${dumped.join('\n\n')}\n`)
  // Three programs per sort: the first three of each in the order of their indexes.
  const programsOfSort = new Map<Sort, string[]>(sorts.map(sort => [sort, []]))
  for (let index = 0; [...programsOfSort.values()].some(programs => programs.length < 3); index++) {
    const {text, sort} = programAt(seed, index)
    const programs = programsOfSort.get(sort)!
    if (programs.length < 3) programs.push(`--- ${sort}, program ${seed}:${index}, ${Array.from(text).length} code points\n${text}${text.endsWith('\n') ? '' : '\n'}`)
  }
  writeFileSync(join(folder, 'documents.txt'), `Three valid programs of each of the ${sorts.length} sorts, as generate.ts writes them for the seed ${seed}.\n\n${sorts.map(sort => programsOfSort.get(sort)!.join('\n')).join('\n')}`)
  console.log(`Wrote samples.txt with ${sampleCount} train samples and documents.txt with ${3 * sorts.length} programs to ${folder}.`)
}
