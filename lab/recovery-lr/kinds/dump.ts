// Writes 300 samples of this folder's half of the mixed train split as a text file for reading, in the layout of
// ../dump.ts: the program that was meant, the broken text, and under it the label's display kind, depth and
// container per code point, with + under a code point that a kind added.
//
// Run from the repo root: bun lab/recovery-lr/kinds/dump.ts <folder>
// It writes samples.txt: first the first samples of the kinds half in the order of their indexes, then, for every
// kind that has fewer than three samples among them, samples with that kind alone on later train programs, so that
// every kind has at least three. A sample's first line names its kinds and the form of each.
import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {defaultSeed, programAt, splitOfTokens} from '../dataset.ts'
import {dumpSample} from '../dump.ts'
import {kinds} from './kinds.ts'
import {eachMixedSample, sampleOfKind} from './mixed.ts'

if (import.meta.main) {
  const folder = process.argv[2]
  if (folder === undefined) throw new Error('usage: bun lab/recovery-lr/kinds/dump.ts <folder>')
  mkdirSync(folder, {recursive: true})
  const wanted = 300, leastPerKind = 3
  // The first samples of the kinds half. Enough room is left for the kinds that need more.
  const first: {text: string, kinds: string[]}[] = []
  for (const mixed of eachMixedSample('train', 2 * wanted)) {
    if (mixed.half !== 'kinds') continue
    first.push({text: `${dumpSample(mixed.sample, mixed.sort, first.length)}\nforms   ${mixed.forms.join('; ')}`, kinds: mixed.sample.edits})
  }
  const countOf = (list: readonly {kinds: string[]}[], name: string): number => list.filter(entry => entry.kinds.includes(name)).length
  // How many samples of the first part can be kept so that the added ones still fit in 300.
  let kept = wanted
  for (;;) {
    const missing = kinds.reduce((sum, kind) => sum + Math.max(0, leastPerKind - countOf(first.slice(0, kept), kind.name)), 0)
    if (kept + missing <= wanted) break
    kept--
  }
  const dumped = first.slice(0, kept)
  const added: string[] = []
  for (const kind of kinds) {
    // Train programs from a later part of the seed, so that they are not among the first samples.
    for (let index = 20_000; countOf(dumped, kind.name) < leastPerKind; index++) {
      if (splitOfTokens(programAt(defaultSeed, index).labels) !== 'train') continue
      const made = sampleOfKind(defaultSeed, index, kind.name)
      if (typeof made === 'string') continue
      dumped.push({text: `${dumpSample(made.sample, made.sort, dumped.length)}\nforms   ${made.forms.join('; ')}`, kinds: made.sample.edits})
      added.push(kind.name)
    }
  }
  const perKind = kinds.map(kind => `${kind.name} ${countOf(dumped, kind.name)}`).join(', ')
  writeFileSync(join(folder, 'samples.txt'), [
    `${dumped.length} samples of the half of the mixed train split whose damage is a kind of mistake written for miniml, of the seed ${defaultSeed}. lab/recovery-lr/dump.ts says how to read them; the line "forms" says which variant of each kind a sample has.`,
    `The first ${kept} are the first samples of that half in the order of their indexes. ${added.length === 0 ? 'Every kind has at least three samples among them.' : `The last ${added.length} have one kind alone on a later train program, for the kinds that had fewer than three samples: ${[...new Set(added)].join(', ')}.`}`,
    `Samples per kind in this file: ${perKind}.`,
    '',
    dumped.map(entry => entry.text).join('\n\n'),
    '',
  ].join('\n'))
  console.log(`Wrote samples.txt with ${dumped.length} samples to ${folder}. Per kind: ${perKind}.`)
}
