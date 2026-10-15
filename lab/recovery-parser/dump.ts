// Writes samples as text files for reading, in fixed width, so that every code point of a broken text stands above
// its label and above what the parser as it is shows for it.
//
// Run from the repo root: bun lab/recovery-parser/dump.ts <folder> [seed] [samples to scan, default 60000]
// It writes one file per kind of damage with 60 samples from short to long, all.txt with the first 300 samples in the
// dataset's own order, valid.txt, and typing-replays.txt with whole replays, one text per key press.
//
// The lines of a sample:
//   orig   the original, i.e. the valid text its author meant. A line feed is ⏎, a tab is →, see `visible` below.
//   label  the display kind of every code point of the original, one letter each, see `kindLetters`.
//   depth  the nesting depth after the code point, 0 to 9 and then a to g for 10 to 16.
//   cont   the innermost open container after the code point: o for an object, a for an array, - for none.
//   brok   the broken text.
//   align  . under a kept code point, ~ under one that was replaced one for one, + under one that the damage added.
//   want   the label's display kind for every code point of the broken text. Blank where it has no label, and ? where
//          the display kind is not scored.
//   wantd  the label's depth.   wantc  the label's container.
//   now, nowd, nowc  what the parser as it is gives.
//   miss   where the parser as it is differs from the label: k for the display kind, d for the depth, c for the
//          container, * for more than one. Only from the first damage on can it differ.
import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {errorKinds} from '../../src/json-search/highlighter/kinds.ts'
import {kinds} from './damage.ts'
import {kindLetters, labelsOfValidText} from './labels.ts'
import {createRandom} from './random.ts'
import {type Sample, defaultSeed, labeledAfterDamage, labelsOf, sampleAt, typingReplayOf} from './samples.ts'
import {containerNames, runTableParser} from './table-parser.ts'

// One column per code point: characters that would break the columns are shown as another character.
const standIns: Record<string, string> = {'\n': '⏎', '\t': '→', '\r': '↵', '\u001b': '␛', '\u0000': '␀', '\u001a': '␚', '\u2028': '␤', '\u007f': '␡'}
export function visible(text: string) {
  let shown = ''
  for (const character of text) {
    const codePoint = character.codePointAt(0)!
    const standIn = standIns[character]
    if (standIn !== undefined) shown += standIn
    else if (codePoint === 0xfeff) shown += '◊'
    else if (codePoint === 0xa0) shown += '⍽'
    else if (codePoint < 0x20) shown += '␦'
    // Characters that a terminal draws two columns wide, e.g. 東 or ☕, are shown as ◆.
    else if ((codePoint >= 0x1100 && codePoint <= 0x115f) || (codePoint >= 0x2600 && codePoint <= 0x27bf) || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
      || (codePoint >= 0xac00 && codePoint <= 0xd7a3) || (codePoint >= 0xf900 && codePoint <= 0xfaff) || (codePoint >= 0xff00 && codePoint <= 0xff60) || codePoint >= 0x1f000) shown += '◆'
    else shown += character
  }
  return shown
}

const depthLetter = (depth: number) => depth < 0 ? '-' : depth > 16 ? '+' : '0123456789abcdefg'[depth]!
const containerLetter = (container: number) => containerNames[container]![0] === 'n' ? '-' : containerNames[container]![0]!

export function describeSample(sample: Sample): string {
  const labels = labelsOf(sample)
  const originalLabels = sample.documents.flatMap(labelsOfValidText)
  const trace = runTableParser(sample.broken)
  const length = sample.alignment.length
  const perCodePoint = (letter: (index: number) => string) => Array.from({length}, (_, index) => letter(index)).join('')
  const miss = perCodePoint(index => {
    const label = labels[index]
    if (label === undefined) return ' '
    const kind = label.kind !== undefined && label.kind !== trace.displayKind[index]
    const depth = label.depth !== trace.depthAfter[index]
    const container = label.container !== trace.containerAfter[index]
    return Number(kind) + Number(depth) + Number(container) > 1 ? '*' : kind ? 'k' : depth ? 'd' : container ? 'c' : ' '
  })
  const header = [
    `--- ${sample.id}  ${sample.source}${sample.source === 'damage' ? ` / ${sample.recipe}` : ''}  kinds: ${sample.kinds.length === 0 ? 'none' : sample.kinds.join(', ')}  reachable: ${sample.reachable}  split: ${sample.split}${sample.heldOut.length > 0 ? ` (held out, ${sample.heldOut.join(', ')})` : ''}  ${sample.template}, ${sample.style}`,
    ...sample.forms.map(form => `    ${form}`),
  ]
  if (sample.needsClass.length > 0) header.push(`    needs a character class the highlighter lacks: ${sample.needsClass.join(', ')}`)
  if (sample.source === 'valid') return [...header, `orig  ${visible(sample.original)}`, `label ${originalLabels.map(label => kindLetters[label.kind!]).join('')}`, `depth ${originalLabels.map(label => depthLetter(label.depth)).join('')}`, `cont  ${originalLabels.map(label => containerLetter(label.container)).join('')}`].join('\n')
  header.push(`    first damage at ${sample.firstDamage}, first error now at ${sample.firstErrorPosition} (${errorKinds[sample.firstErrorKind]}), ${labeledAfterDamage(sample)} labeled code points from the damage on${sample.documents.length > 1 ? `, ${sample.documents.length} documents` : ''}${sample.debatable ? ', another repair is sensible' : ''}`)
  return [
    ...header,
    `orig  ${visible(sample.original)}`,
    `label ${originalLabels.map(label => kindLetters[label.kind!]).join('')}`,
    `depth ${originalLabels.map(label => depthLetter(label.depth)).join('')}`,
    `cont  ${originalLabels.map(label => containerLetter(label.container)).join('')}`,
    `brok  ${visible(sample.broken)}`,
    `align ${perCodePoint(index => sample.alignment[index] === -1 ? '+' : sample.replaced[index] === true ? '~' : '.')}`,
    `want  ${perCodePoint(index => labels[index] === undefined ? ' ' : labels[index].kind === undefined ? '?' : kindLetters[labels[index].kind]!)}`,
    `wantd ${perCodePoint(index => labels[index] === undefined ? ' ' : depthLetter(labels[index].depth))}`,
    `wantc ${perCodePoint(index => labels[index] === undefined ? ' ' : containerLetter(labels[index].container))}`,
    `now   ${perCodePoint(index => kindLetters[trace.displayKind[index]!]!)}`,
    `nowd  ${perCodePoint(index => depthLetter(trace.depthAfter[index]!))}`,
    `nowc  ${perCodePoint(index => containerLetter(trace.containerAfter[index]!))}`,
    `miss  ${miss}`,
  ].join('\n')
}

// A whole replay: the finished document, then the text after every key press with what the parser as it is shows.
function describeReplay(seed: number, index: number): string | undefined {
  const made = typingReplayOf(createRandom(seed, index))
  if (made === undefined) return undefined
  const {replay, template, style} = made
  const labels = labelsOfValidText(replay.finished)
  const lines = [
    `=== replay ${seed}:${index}  ${replay.editor} editor, ${replay.action}: ${replay.target}${replay.comma === 'none' ? '' : `, its comma ${replay.comma}`}  ${template}, ${style}`,
    `fin   ${visible(replay.finished)}`,
    `label ${labels.map(label => kindLetters[label.kind!]).join('')}`,
    `depth ${labels.map(label => depthLetter(label.depth)).join('')}`,
  ]
  replay.steps.forEach((step, stepIndex) => {
    lines.push(`  step ${stepIndex}  key: ${visible(step.key)}  ${step.valid ? 'valid' : `kinds: ${step.kinds.join(', ')}  reachable: ${step.reachable}`}`)
    lines.push(`  text  ${visible(step.text)}`)
    if (step.valid) return
    const trace = runTableParser(step.text)
    // The label of every kept code point, through the step's removals.
    const kept: number[] = []
    let position = 0
    for (const edit of step.edits) {
      for (; position < edit.at; position++) kept.push(position)
      position = edit.at + edit.remove
    }
    for (; position < labels.length; position++) kept.push(position)
    const unscored = new Set(step.unscoredKinds)
    lines.push(`  want  ${kept.map(original => unscored.has(original) ? '?' : kindLetters[labels[original]!.kind!]).join('')}`)
    lines.push(`  now   ${kept.map((_, brokenIndex) => kindLetters[trace.displayKind[brokenIndex]!]).join('')}`)
    lines.push(`  miss  ${kept.map((original, brokenIndex) => {
      const label = labels[original]!
      const kind = !unscored.has(original) && label.kind !== trace.displayKind[brokenIndex]
      const depth = label.depth !== trace.depthAfter[brokenIndex]
      const container = label.container !== trace.containerAfter[brokenIndex]
      return Number(kind) + Number(depth) + Number(container) > 1 ? '*' : kind ? 'k' : depth ? 'd' : container ? 'c' : ' '
    }).join('')}`)
  })
  return lines.join('\n')
}

if (import.meta.main) {
  const folder = process.argv[2]
  if (folder === undefined) throw new Error('usage: bun lab/recovery-parser/dump.ts <folder> [seed] [samples to scan]')
  const seed = Number(process.argv[3] ?? defaultSeed)
  const scanned = Number(process.argv[4] ?? 60_000)
  const perKind = 60
  mkdirSync(folder, {recursive: true})
  const legend = 'Letters of display kinds: w whitespace, p punctuation, s string, e escape, n number, l literal, E error, k key. See the top of lab/recovery-parser/dump.ts for the lines.\n\n'

  // Samples of each kind as they come in the dataset, up to three times as many as are printed, so that the printed
  // ones can be spread from short to long.
  const byKind = new Map<string, Sample[]>(kinds.map(kind => [kind.name, []]))
  const valid: Sample[] = []
  const first: Sample[] = []
  for (let index = 0; index < scanned; index++) {
    const sample = sampleAt(seed, index)
    if (index < 300) first.push(sample)
    if (sample.source === 'valid' && valid.length < perKind) valid.push(sample)
    for (const kind of sample.kinds) {
      const list = byKind.get(kind)
      if (list !== undefined && list.length < perKind * 3) list.push(sample)
    }
  }
  writeFileSync(join(folder, 'all.txt'), `${legend}The first ${first.length} samples of seed ${seed}, in the dataset's own order.\n\n${first.map(describeSample).join('\n\n')}\n`)
  writeFileSync(join(folder, 'valid.txt'), `${legend}${valid.length} valid samples of seed ${seed}.\n\n${valid.map(describeSample).join('\n\n')}\n`)
  for (const [kind, samples] of byKind) {
    // Samples with this kind alone come first in the choice, then those where it comes with others. The printed ones
    // are every third of the list by length, shortest first.
    const alone = samples.filter(sample => sample.kinds.length === 1)
    const withOthers = samples.filter(sample => sample.kinds.length > 1)
    const spread = (list: Sample[], count: number) => {
      const sorted = [...list].sort((left, right) => left.alignment.length - right.alignment.length)
      if (sorted.length <= count) return sorted
      return Array.from({length: count}, (_, index) => sorted[Math.floor(index * sorted.length / count)]!)
    }
    const aloneCount = Math.min(alone.length, Math.max(perKind - withOthers.length, Math.round(perKind * 0.75)))
    const chosen = [...spread(alone, aloneCount), ...spread(withOthers, perKind - aloneCount)]
    const text = `${legend}${chosen.length} samples with ${kind}, of seed ${seed}: ${Math.min(aloneCount, alone.length)} where it is the only kind, from short to long, then ${chosen.length - Math.min(aloneCount, alone.length)} where it comes with other kinds.\n\n${chosen.map(describeSample).join('\n\n')}\n`
    writeFileSync(join(folder, `kind-${kind}.txt`), text)
  }
  const replays: string[] = []
  for (let index = 0; replays.length < 40 && index < 400; index++) {
    const made = typingReplayOf(createRandom(seed, index))
    // Replays of short documents, so that a whole replay can be read, and every eighth one of any length.
    if (made === undefined || (made.replay.finished.length > 220 && index % 8 !== 0) || made.replay.steps.length > 80) continue
    const described = describeReplay(seed, index)
    if (described !== undefined) replays.push(described)
  }
  writeFileSync(join(folder, 'typing-replays.txt'), `${legend}${replays.length} typing replays of seed ${seed}. Each step is the text after one key press, with the labels of its code points (want), what the parser as it is shows (now), and where the two differ (miss).\n\n${replays.join('\n\n')}\n`)
  const counts = [...byKind].map(([kind, samples]) => `${kind} ${samples.length}`).join(', ')
  console.log(`wrote ${byKind.size + 3} files to ${folder} from ${scanned} samples of seed ${seed}. Samples found per kind, up to ${perKind * 3}: ${counts}`)
}
