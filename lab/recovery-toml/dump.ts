// Writes samples and documents as text files for reading, in fixed width, so that every code point of a broken text
// stands above its label.
//
// Run from the repo root: bun lab/recovery-toml/dump.ts <folder> [seed]
// It writes samples.txt with the first 300 samples of the train split, and documents.txt with two valid documents per
// template. The documents come from the seed after the given one, so that the file shows no document of the given
// seed's test split.
//
// The lines of a sample:
//   orig   the original, i.e. the valid document its author meant. A line feed is ⏎, a tab is →, a carriage return
//          is ↵, see `visible` below.
//   brok   the broken text.
//   label  the label's display kind for every code point of the broken text, one letter each, see `kindLetters`. Blank
//          where the damage added the code point, and ? where the display kind is not scored.
//   depth  the label's nesting depth after the code point, 0 to 9 and then a to g for 10 to 16. ? where the depth and
//          the container are not scored.
//   cont   the label's innermost open container after the code point: a for an array, i for an inline table, - for none.
//   first  ^ under the first error of the parser as it is, from which on the code points are scored, and d under the
//          first damaged code point when it comes before the first error.
import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {templates} from './documents.ts'
import {errorKinds, kindLetters} from './kinds.ts'
import {type Sample, defaultSeed, heldOutTemplates, labelsOf, sampleAt, scoredCodePoints, splitKeyOf} from './samples.ts'
import {containerNames} from './table-parser.ts'

// One column per code point: characters that would break the columns are shown as another character.
const standIns: Record<string, string> = {'\n': '⏎', '\t': '→', '\r': '↵', '\u001b': '␛', '\u0000': '␀', '\u007f': '␡'}
export function visible(text: string) {
  let shown = ''
  for (const character of text) {
    const codePoint = character.codePointAt(0)!
    const standIn = standIns[character]
    if (standIn !== undefined) shown += standIn
    else if (codePoint < 0x20) shown += '␦'
    // Characters that a terminal draws two columns wide, e.g. 東 or 🌱, and the ones of a private use area, are shown as ◆.
    else if ((codePoint >= 0x1100 && codePoint <= 0x115f) || (codePoint >= 0x2600 && codePoint <= 0x27bf) || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
      || (codePoint >= 0xac00 && codePoint <= 0xd7a3) || (codePoint >= 0xe000 && codePoint <= 0xfaff) || (codePoint >= 0xff00 && codePoint <= 0xff60) || codePoint >= 0x1f000) shown += '◆'
    else shown += character
  }
  return shown
}

const depthLetter = (depth: number | undefined) => depth === undefined ? '?' : depth < 0 ? '-' : depth > 16 ? '+' : '0123456789abcdefg'[depth]!
const containerLetter = (container: number | undefined) => container === undefined ? '?' : containerNames[container] === 'none' ? '-' : containerNames[container]![0]!

export function describeSample(sample: Sample): string {
  const labels = labelsOf(sample)
  const perCodePoint = (letter: (index: number) => string) => Array.from({length: sample.alignment.length}, (_, index) => letter(index)).join('')
  const header = [
    `--- ${sample.id}  ${sample.split}${sample.heldOut.length > 0 ? ` (held out, ${sample.heldOut.join(', ')})` : ''}  ${sample.template}, ${sample.style}  ${sample.recipe}`,
    ...sample.forms.map(form => `    ${visible(form)}`),
  ]
  if (sample.source === 'valid') return [...header, `orig  ${visible(sample.original)}`].join('\n')
  header.push(`    first damage at ${sample.firstDamage}, first error at ${sample.firstErrorPosition} (${errorKinds[sample.firstErrorKind]}), ${scoredCodePoints(sample, labels)} code points to score${sample.needsNestingFix ? ', a scored depth is out of the loop\'s reach' : ''}`)
  return [
    ...header,
    `orig  ${visible(sample.original)}`,
    `brok  ${visible(sample.broken)}`,
    `label ${perCodePoint(index => labels[index] === undefined ? ' ' : labels[index].kind === undefined ? '?' : kindLetters[labels[index].kind]!)}`,
    `depth ${perCodePoint(index => labels[index] === undefined ? ' ' : depthLetter(labels[index].depth))}`,
    `cont  ${perCodePoint(index => labels[index] === undefined ? ' ' : containerLetter(labels[index].container))}`,
    `first ${perCodePoint(index => index === sample.firstErrorPosition ? '^' : index === sample.firstDamage ? 'd' : ' ')}${sample.firstErrorPosition >= sample.alignment.length ? '^' : ''}`,
  ].join('\n')
}

if (import.meta.main) {
  const folder = process.argv[2]
  if (folder === undefined) throw new Error('usage: bun lab/recovery-toml/dump.ts <folder> [seed]')
  const seed = Number(process.argv[3] ?? defaultSeed)
  const wanted = 300
  mkdirSync(folder, {recursive: true})
  const legend = [
    'Letters of display kinds: w whitespace, p punctuation, s string, e escape, n number, l literal, k key, h header name, c comment.',
    'In the texts, ⏎ is a line feed, → a tab, ↵ a carriage return, and ◆ a character that a terminal draws two columns wide. See the top of lab/recovery-toml/dump.ts for the lines.',
  ].join('\n')

  const train: Sample[] = []
  let scanned = 0
  for (; train.length < wanted; scanned++) {
    const sample = sampleAt(seed, scanned)
    if (sample.split === 'train') train.push(sample)
  }
  writeFileSync(join(folder, 'samples.txt'), `${legend}\n\nThe first ${train.length} samples of the train split of seed ${seed}, in the dataset's own order (from the first ${scanned} samples).\n\n${train.map(describeSample).join('\n\n')}\n`)

  // Two valid documents per template, as files have them: with their real line ends.
  const perTemplate = 2
  const documents = new Map<string, Sample[]>(templates.map(template => [template, []]))
  for (let index = 0; [...documents.values()].some(list => list.length < perTemplate); index++) {
    const sample = sampleAt(seed + 1, index, {source: 'valid'})
    const list = documents.get(sample.template)!
    if (list.length < perTemplate) list.push(sample)
  }
  const described = [...documents].flatMap(([template, list]) => list.map(sample =>
    `===== ${template}${heldOutTemplates.includes(sample.template) ? ' (held out of train and validation)' : ''}, style ${sample.style}, ${sample.alignment.length} code points${sample.lineEnd === '\r\n' ? ', lines end with a carriage return and a line feed' : ''}\n      tokens: ${splitKeyOf(sample.original)}\n${sample.original.replaceAll('\r\n', '\n')}${sample.original.endsWith('\n') ? '' : '\n'}`))
  writeFileSync(join(folder, 'documents.txt'), `${perTemplate} valid documents per template, of seed ${seed + 1}. The line "tokens" is what decides a document's split, see splits.ts.\n\n${described.join('\n')}\n`)
  console.log(`wrote samples.txt (${train.length} train samples) and documents.txt (${templates.length * perTemplate} documents) to ${folder}`)
}
