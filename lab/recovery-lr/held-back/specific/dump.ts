// HELD BACK. This command prints samples of the set: its output is for the agents of the held-back sets, the
// reviewers and whoever runs the final scoring, and for nobody else, see ../README.md.
//
// A text file for a reader of the set: samples, each with its labels under its broken text.
//
// Run from the repo root, with a file outside the repo:
//   bun lab/recovery-lr/held-back/specific/dump.ts <file> [--count 300] [--kind <name>] [--from <index>]
// Without --kind, the file holds the first samples of the set. With it, the first ones that have the kind.
//
// A sample in the file:
//   #7  specific:8  shop  missing in (before `let`)  first error at code point 31, 88 scored
//   meant   let area w h =⏎  let half = w / 2⏎  in let rest = h - 1 in⏎  half * rest⏎
//   broken  let area w h =⏎  let half = w / 2⏎  let rest = h - 1 in⏎  half * rest⏎
//   kind    kkkwdddd...      one letter per code point of the broken text, see kindLetters in ../../labels.ts:
//                            w white space, c comment, k keyword, n name, d defined name, a parameter, l constant,
//                            s string, o operator, p punctuation. + for an added code point, which has no label.
//   depth   1111111...       the last digit of the depth
//   in      llllllll...      the container, see containerLetters: . none, ( [ l let, = n in, i if, t then, e else,
//                            f fun, > ->
//   error                ^   the first error: the first code point of the token at which the parser as it is
//                            reports its error. The code points from there on that have a label are scored.
// In the two texts, ⏎ stands for a line feed, → for a tab, ␍ for a carriage return and · for another control
// character. `meant` is the original of the sample: where a whole token is missing, it stands right before the
// next token of the broken text, see reading.ts.
import {mkdirSync, writeFileSync} from 'node:fs'
import {dirname} from 'node:path'
import {containerLetters, kindLetters} from '../../labels.ts'
import {kindNames} from './kinds.ts'
import {type SpecificSample, specificSampleAt, specificSampleCount, specificSeed} from './specific.ts'

const onOneLine = (text: string): string => Array.from(text, character => character === '\n' ? '⏎' : character === '\t' ? '→' : character === '\r' ? '␍' : character.codePointAt(0)! < 32 ? '·' : character).join('')

export function dumpSample({sample, sort, kinds, forms}: SpecificSample, number: number): string {
  const row = (letterOf: (position: number) => string): string => Array.from(sample.codePoints, (_, position) => sample.alignment[position] === -1 ? '+' : letterOf(position)).join('')
  return [
    `#${number}  ${sample.id}  ${sort}  ${kinds.map((kind, place) => `${kind} (${forms[place]})`).join(' and ')}  first error at code point ${sample.firstErrorPosition}, ${sample.scored} scored`,
    `meant   ${onOneLine(sample.original)}`,
    `broken  ${onOneLine(sample.broken)}`,
    `kind    ${row(position => kindLetters[sample.labelKind[position]!]!)}`,
    `depth   ${row(position => String(sample.labelDepth[position]! % 10))}`,
    `in      ${row(position => containerLetters[sample.labelContainer[position]!]!)}`,
    `error   ${' '.repeat(sample.firstErrorPosition)}^`,
  ].join('\n')
}

if (import.meta.main) {
  const [file, ...options] = process.argv.slice(2)
  const optionOf = (name: string): string | undefined => options.includes(name) ? options[options.indexOf(name) + 1] : undefined
  if (file === undefined || file.startsWith('--') || options.some((option, place) => place % 2 === 0 && !['--count', '--kind', '--from'].includes(option))) throw new Error('usage: bun lab/recovery-lr/held-back/specific/dump.ts <file> [--count 300] [--kind <name>] [--from <index>]')
  const count = Number(optionOf('--count') ?? 300), kind = optionOf('--kind'), from = Number(optionOf('--from') ?? 0)
  if (kind !== undefined && !kindNames.includes(kind)) throw new Error(`no kind is called ${kind}. The kinds: ${kindNames.join(', ')}`)
  const dumped: string[] = []
  for (let index = from; index < specificSampleCount && dumped.length < count; index++) {
    const sample = specificSampleAt(specificSeed, index)
    if (kind === undefined || sample.kinds.includes(kind)) dumped.push(dumpSample(sample, dumped.length))
  }
  mkdirSync(dirname(file), {recursive: true})
  writeFileSync(file, `HELD BACK: samples of the test set lab/recovery-lr/held-back/specific. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read this file.\n${dumped.length} samples${kind === undefined ? '' : ` with the kind "${kind}"`}, from sample ${from} of the seed ${specificSeed} on. lab/recovery-lr/held-back/specific/dump.ts says how to read them.\n\n${dumped.join('\n\n')}\n`)
  console.log(`Wrote ${dumped.length} samples to ${file}.`)
}
