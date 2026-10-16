// Writes samples of the held-back set as text files for reading, in fixed width, so that every code point of a broken
// text stands above its label.
//
// Run from the repo root: bun lab/recovery-toml/held-back/specific/dump.ts <folder> [seed]
// It writes samples.txt with the first 300 samples of the seed as sampleAt draws them, and per-kind.txt with 5 samples
// of each kind alone, of the seed after it. The folder is one outside the repo: the files hold the set's texts.
//
// The lines of a sample:
//   orig   the original, i.e. the valid document its author meant. A line feed is ⏎, a tab is →, a carriage return
//          is ↵, see `visible` in ../../dump.ts.
//   brok   the broken text.
//   align  . under a kept code point, + under one that the mistake added, ~ under one that stands for another, e.g. a
//          colon for the equals sign.
//   label  the label's display kind for every code point of the broken text, one letter each, see `kindLetters`. Blank
//          where the mistake added the code point, and ? where the display kind is not scored.
//   depth  the label's nesting depth after the code point, 0 to 9 and then a to g for 10 to 16. ? where the depth and
//          the container are not scored.
//   cont   the label's innermost open container after the code point: a for an array, i for an inline table, - for none.
//   first  ^ under the first error of the parser as it is, from which on the code points are scored, and d under the
//          first damaged code point when it comes before the first error.
import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {visible} from '../../dump.ts'
import {errorKinds, kindLetters} from '../../kinds.ts'
import {containerNames} from '../../table-parser.ts'
import {kinds} from './mistakes.ts'
import {type Sample, defaultSeed, groupOf, labelsOf, sampleAt, scoredCodePoints} from './samples.ts'

const depthLetter = (depth: number | undefined) => depth === undefined ? '?' : depth < 0 ? '-' : depth > 16 ? '+' : '0123456789abcdefg'[depth]!
const containerLetter = (container: number | undefined) => container === undefined ? '?' : containerNames[container] === 'none' ? '-' : containerNames[container]![0]!

export function describeSample(sample: Sample): string {
  const labels = labelsOf(sample)
  const perCodePoint = (letter: (index: number) => string) => Array.from({length: sample.alignment.length}, (_, index) => letter(index)).join('')
  const judgment = [`reachable: ${sample.reachable}`, ...sample.needsClass.map(need => `needs the class "${need}"`), ...(sample.debatable ? ['debatable'] : []), ...(sample.needsNestingFix ? ['a scored depth is out of the loop\'s reach'] : [])]
  return [
    `--- ${sample.id}  ${sample.template}${sample.heldOut.length > 0 ? ' (held out)' : ''}, ${sample.style}  ${sample.recipe}  ${judgment.join(', ')}  group: ${groupOf(sample)}`,
    ...sample.forms.map(form => `    ${visible(form)}`),
    `    first damage at ${sample.firstDamage}, first error at ${sample.firstErrorPosition} (${errorKinds[sample.firstErrorKind]}), ${scoredCodePoints(sample, labels)} code points to score`,
    `orig  ${visible(sample.original)}`,
    `brok  ${visible(sample.broken)}`,
    `align ${perCodePoint(index => sample.alignment[index] === -1 ? '+' : sample.replaced[index] === true ? '~' : '.')}`,
    `label ${perCodePoint(index => labels[index] === undefined ? ' ' : labels[index].kind === undefined ? '?' : kindLetters[labels[index].kind]!)}`,
    `depth ${perCodePoint(index => labels[index] === undefined ? ' ' : depthLetter(labels[index].depth))}`,
    `cont  ${perCodePoint(index => labels[index] === undefined ? ' ' : containerLetter(labels[index].container))}`,
    `first ${perCodePoint(index => index === sample.firstErrorPosition ? '^' : index === sample.firstDamage ? 'd' : ' ')}${sample.firstErrorPosition >= sample.alignment.length ? '^' : ''}`,
  ].join('\n')
}

if (import.meta.main) {
  const folder = process.argv[2]
  if (folder === undefined) throw new Error('usage: bun lab/recovery-toml/held-back/specific/dump.ts <folder> [seed]')
  const seed = Number(process.argv[3] ?? defaultSeed)
  const wanted = 300
  const perKind = 5
  mkdirSync(folder, {recursive: true})
  const legend = [
    'HELD BACK: whoever builds the parser, the train data or the training does not read this file.',
    '',
    'Letters of display kinds: w whitespace, p punctuation, s string, e escape, n number, l literal, k key, h header name, c comment.',
    'In the texts, ⏎ is a line feed, → a tab, ↵ a carriage return, and ◆ a character that a terminal draws two columns wide.',
    'The row "align" has . under a kept code point, + under an added one, and ~ under one that stands for another. See the top of lab/recovery-toml/held-back/specific/dump.ts for the other rows.',
  ].join('\n')
  const samples = Array.from({length: wanted}, (_, index) => sampleAt(seed, index))
  writeFileSync(join(folder, 'samples.txt'), `${legend}\n\nThe first ${wanted} samples of seed ${seed}, as sampleAt draws them.\n\n${samples.map(describeSample).join('\n\n')}\n`)
  const alone = kinds.map(kind => `===== ${kind.name}: ${kind.description}\n\n${Array.from({length: perKind}, (_, index) => describeSample(sampleAt(seed + 1, index, {kind: kind.name}))).join('\n\n')}`)
  writeFileSync(join(folder, 'per-kind.txt'), `${legend}\n\n${perKind} samples of each kind alone, of seed ${seed + 1}.\n\n${alone.join('\n\n')}\n`)
  console.log(`wrote samples.txt (${wanted} samples) and per-kind.txt (${kinds.length * perKind} samples) to ${folder}`)
}
