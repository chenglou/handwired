// HELD BACK. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read
// this file or its output, see ../README.md.
//
// The numbers of the set of typical mistakes, and the two parts of README.md that are made from kinds.ts: the
// table of the kinds and the block of their examples. check-specific.ts holds README.md against both.
//
// Run from the repo root: bun lab/recovery-lr/held-back/specific/numbers.ts [--forms]
// The output holds counts, names of kinds and the kinds' own examples, and no text of a sample.
import {firstEditPosition, outputsBeforeFirstError, scoredOutOfReach} from '../../stats.ts'
import {isTrivia, symbolOf} from '../../tables.ts'
import {kinds} from './kinds.ts'
import {type SpecificSample, type Thrown, loadSpecific} from './specific.ts'
import {sortNames} from './templates.ts'

const onOneLine = (text: string): string => text.replaceAll('\n', '⏎')

// The README's table of the kinds, one row per kind, with the counts of the samples.
export function tableOfKinds(samples: readonly SpecificSample[]): string {
  const rows = kinds.map((kind, place) => {
    const alone = samples.filter(({kinds: drawn}) => drawn.length === 1 && drawn[0] === kind.name)
    const withAnother = samples.filter(({kinds: drawn}) => drawn.length === 2 && drawn.includes(kind.name)).length
    const scored = alone.length === 0 ? '' : (alone.reduce((sum, {sample}) => sum + sample.scored, 0) / alone.length).toFixed(0)
    return `| ${place + 1} | ${kind.name} | ${kind.description.replaceAll('|', '\\|')} | ${alone.length} | ${withAnother} | ${scored} | ${kind.reach.answer} |`
  })
  return ['| | kind | what the author did | samples with the kind alone | with another kind | scored code points per sample, alone | can a table show all of it right |', '| --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n')
}

// The README's block of examples: per kind what was meant and what was typed, each on one line.
export function examplesOfKinds(): string {
  return kinds.map(kind => `${kind.name}\n  meant   ${onOneLine(kind.example.meant)}\n  broken  ${onOneLine(kind.example.broken)}`).join('\n')
}

// The README's list of what a table can show, one line per kind.
export function reachOfKinds(): string {
  return kinds.map(kind => `- **${kind.name}**: ${kind.reach.answer}. ${kind.reach.why}`).join('\n')
}

if (import.meta.main) {
  const samples = loadSpecific()
  const percent = (part: number, whole: number): string => `${(100 * part / whole).toFixed(1)}%`
  const quantiles = (values: number[]): string => {
    const sorted = [...values].sort((left, right) => left - right)
    const at = (share: number): number => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!
    return `mean ${(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(0)}, a tenth below ${at(0.1)}, half below ${at(0.5)}, a tenth above ${at(0.9)}, from ${sorted[0]} to ${sorted.at(-1)}`
  }
  console.log(`${samples.length} samples: ${samples.filter(({kinds: drawn}) => drawn.length === 1).length} with one kind, ${samples.filter(({kinds: drawn}) => drawn.length === 2).length} with two.\n`)
  console.log(`THE TABLE OF THE KINDS\n${tableOfKinds(samples)}\n`)
  console.log(`THE EXAMPLES\n${examplesOfKinds()}\n`)
  console.log(`WHAT A TABLE CAN SHOW\n${reachOfKinds()}\n`)

  console.log('THE SAMPLES')
  console.log(`Code points of a broken text: ${quantiles(samples.map(({sample}) => sample.codePoints.length))}.`)
  console.log(`Code points of a program: ${quantiles(samples.map(({program}) => program.length))}.`)
  console.log(`Scored code points of a sample: ${quantiles(samples.map(({sample}) => sample.scored))}.`)
  const scoredTotal = samples.reduce((sum, {sample}) => sum + sample.scored, 0)
  console.log(`Scored code points in all: ${scoredTotal.toLocaleString('en-US')}.`)
  const distances = samples.map(({sample}) => sample.firstErrorPosition - firstEditPosition(sample))
  console.log(`The first error's token starts at the first edit or before it in ${percent(distances.filter(distance => distance <= 0).length, samples.length)} of the samples, 1 to 19 code points after it in ${percent(distances.filter(distance => distance >= 1 && distance <= 19).length, samples.length)}, 20 to 99 after it in ${percent(distances.filter(distance => distance >= 20 && distance <= 99).length, samples.length)}, 100 or more after it in ${percent(distances.filter(distance => distance >= 100).length, samples.length)}.`)
  const badText = [symbolOf('BADCHAR'), symbolOf('BADSTRING'), symbolOf('BADCOMMENT')]
  let firstErrorAdded = 0, firstErrorNoToken = 0, keptBefore = 0, wrongBefore = 0, samplesWrongBefore = 0, lost = 0, samplesLost = 0, otherNesting = 0
  for (const {sample} of samples) {
    const {tokens, alignment} = sample
    const start = sample.firstErrorPosition, end = start + tokens.length[sample.firstErrorToken]!
    let kept = 0
    for (let position = start; position < end; position++) if (alignment[position] !== -1) kept++
    if (kept === 0) firstErrorAdded++
    if (badText.includes(tokens.kind[sample.firstErrorToken]!)) firstErrorNoToken++
    const outputs = outputsBeforeFirstError(sample)
    let wrongHere = 0
    for (let position = 0; position < start; position++) {
      if (alignment[position] === -1) continue
      keptBefore++
      if (outputs.kind[position] !== sample.labelKind[position] || outputs.depth[position] !== sample.labelDepth[position] || outputs.container[position] !== sample.labelContainer[position]) wrongHere++
    }
    wrongBefore += wrongHere
    if (wrongHere > 0) samplesWrongBefore++
    // The last kept token before the first error: whether the parser has it at the depth and in the container of its label.
    for (let token = sample.firstErrorToken - 1; token >= 0; token--) {
      const position = tokens.start[token]!
      if (isTrivia(tokens.kind[token]!) || alignment[position] === -1) continue
      if (outputs.depth[position] !== sample.labelDepth[position] || outputs.container[position] !== sample.labelContainer[position]) otherNesting++
      break
    }
    const out = scoredOutOfReach(sample)
    lost += out
    if (out > 0) samplesLost++
  }
  console.log(`The first error's token is added text in ${percent(firstErrorAdded, samples.length)} of the samples, and text that is no token of the language in ${percent(firstErrorNoToken, samples.length)}.`)
  console.log(`Before the first error, ${percent(wrongBefore, keptBefore)} of the kept code points have another label than the parser as it is gives (${wrongBefore.toLocaleString('en-US')} of ${keptBefore.toLocaleString('en-US')}), in ${percent(samplesWrongBefore, samples.length)} of the samples. No table changes them, and no score counts them.`)
  console.log(`In ${percent(otherNesting, samples.length)} of the samples the last kept token before the first error has another depth or container than its label.`)
  console.log(`${percent(samplesLost, samples.length)} of the samples have a scored label that no parser can give that shows a token with one kind and the white space after it with the token's depth and container: ${lost.toLocaleString('en-US')} code points, so at most ${percent(scoredTotal - lost, scoredTotal)} of the scored code points can be right, and ${percent(samples.length - samplesLost, samples.length)} of the samples whole.`)

  console.log('\nTHE PROGRAMS')
  console.log(sortNames.map(sort => `${sort} ${samples.filter(sample => sample.sort === sort).length}`).join(', '))

  console.log('\nTHE DRAWS THAT WERE THROWN AWAY')
  const thrown = new Map<Thrown, number>()
  let draws = samples.length
  for (const sample of samples) {
    for (const why of sample.thrown) {
      thrown.set(why, (thrown.get(why) ?? 0) + 1)
      draws++
    }
  }
  console.log(`${draws.toLocaleString('en-US')} draws of a program gave the ${samples.length} samples: ${percent(samples.length, draws)}. Thrown away: ${[...thrown].sort((left, right) => right[1] - left[1]).map(([why, count]) => `${why} ${percent(count, draws)}`).join(', ')}.`)

  if (process.argv.includes('--forms')) {
    console.log('\nTHE FORMS OF EVERY KIND (samples with the form, alone or with another kind)')
    for (const kind of kinds) {
      const forms = new Map<string, number>()
      for (const sample of samples) sample.kinds.forEach((name, place) => { if (name === kind.name) forms.set(sample.forms[place]!, (forms.get(sample.forms[place]!) ?? 0) + 1) })
      console.log(`${kind.name}: ${[...forms].sort((left, right) => right[1] - left[1]).map(([form, count]) => `${form} ${count}`).join('; ')}`)
    }
  }
}
