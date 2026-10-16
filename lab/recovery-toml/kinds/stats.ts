// The numbers of this folder's half of the mixed set.
//
// Run from the repo root: bun lab/recovery-toml/kinds/stats.ts [file] [--places]
// It prints, and writes to the file when one is given:
// 1. The samples per kind, alone and with a second kind, their scored code points, and the forms of each kind.
// 2. The scored code points per sample, the distance from the first damage to the first error, and the draws that
//    were thrown away.
// 3. The score of the parser as it is and of the one rule "after an error, start anew at the next line" on the
//    validation samples of this folder's half, per kind, and on both halves of both splits.
// With --places also: for 2,000 documents of the train split, how many have a place for each kind, i.e. the share of
// documents on which one of 3 draws of the kind gives a sample, and why the other draws give none.
// With --table it prints the table of kinds of the README and nothing else.
import {writeFileSync} from 'node:fs'
import {type Samples, selectSamples} from '../learn/data.ts'
import {asIsTables} from '../learn/recovery-tables.ts'
import {scoreRestartAtNextLine} from '../learn/restart-at-next-line.ts'
import {type Score, type ScoreRow, scoreTables, sharesOf} from '../learn/score.ts'
import {sampleAt, scoredCodePoints} from '../samples.ts'
import {kinds} from './list.ts'
import {type MixedSample, arraysOf, mixedTrainSamples, mixedValidationSamples, standardRange} from './mixed.ts'
import {outcomesOfKind} from './samples.ts'

const lines: string[] = []
const print = (line = '') => {
  lines.push(line)
  console.log(line)
}
const percent = (share: number, digits = 1) => Number.isNaN(share) ? '-' : (100 * share).toFixed(digits)
const pad = (value: string | number, width: number) => String(value).padStart(width)

const train = mixedTrainSamples()
const validation = mixedValidationSamples()
const ofKinds = (samples: readonly MixedSample[]) => samples.filter(mixed => mixed.half === 'kinds')
const half = [...ofKinds(train), ...ofKinds(validation)]

// The table of kinds of the README: a row per kind, with the number of samples of this folder's half that have it.
if (process.argv.includes('--table')) {
  // A text as code in a cell of a Markdown table: between two backticks when it holds one, and with every | escaped.
  const code = (text: string) => (text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``).replaceAll('|', '\\|')
  // A text as a cell: what stands between backticks is code, and outside of it every character that Markdown reads
  // as markup is escaped, e.g. the * of *** and the < of <name>.
  const cell = (text: string) => text.split('`').map((part, index) => index % 2 === 1 ? part.replaceAll('|', '\\|') : part.replaceAll(/[\\*_|~$]/g, character => `\\${character}`).replaceAll('<', '&lt;').replaceAll('>', '&gt;')).join('`')
  console.log('| Kind | What it is | Example | Variants | Weight | Samples | Can a parser of the tables\' form show every code point after it right? |')
  console.log('| --- | --- | --- | --- | --- | --- | --- |')
  let family = ''
  for (const kind of kinds) {
    if (kind.family !== family) console.log(`| **${kind.family}** | | | | | | |`)
    family = kind.family
    const count = half.filter(({sample}) => sample.kinds.includes(kind.name)).length
    console.log(`| ${kind.name} | ${cell(kind.description)} | ${code(kind.example)} | ${cell(kind.variants)} | ${kind.weight} | ${count} | ${cell(kind.showable)} |`)
  }
  process.exit(0)
}

// 1. Per kind.
print(`This folder's half of the mixed set, of the dataset's standard set (seed ${standardRange.seed}, the indexes ${standardRange.from} to ${standardRange.to - 1}): ${ofKinds(train).length} train samples and ${ofKinds(validation).length} validation samples.`)
const twoKinds = half.filter(({sample}) => sample.editCount === 2).length
print(`${half.length - twoKinds} samples (${percent((half.length - twoKinds) / half.length)}%) have one kind and ${twoKinds} (${percent(twoKinds / half.length)}%) have two.`)
print('')
print('Samples per kind. A sample with two kinds counts for both. "alone": the samples in which the kind is the only one. "scored": the mean number of scored code points of those. "weight": what the kind is drawn by.')
print(`${pad('samples', 7)} ${pad('share', 6)} ${pad('train', 6)} ${pad('valid.', 6)} ${pad('alone', 6)} ${pad('scored', 7)} ${pad('weight', 6)}  kind`)
const formsOfKind = new Map<string, Map<string, number>>(kinds.map(kind => [kind.name, new Map()]))
for (const kind of kinds) {
  const withKind = half.filter(({sample}) => sample.kinds.includes(kind.name))
  const alone = withKind.filter(({sample}) => sample.editCount === 1)
  const scored = alone.reduce((total, {sample}) => total + scoredCodePoints(sample), 0)
  print(`${pad(withKind.length, 7)} ${pad(`${percent(withKind.length / half.length, 2)}%`, 6)} ${pad(withKind.filter(({sample}) => sample.split === 'train').length, 6)} ${pad(withKind.filter(({sample}) => sample.split === 'validation').length, 6)} ${pad(alone.length, 6)} ${pad(alone.length === 0 ? '-' : (scored / alone.length).toFixed(1), 7)} ${pad(kind.weight, 6)}  ${kind.name}`)
  for (const {sample} of withKind) {
    for (const form of sample.forms.filter(text => text.startsWith(`${kind.name}: `))) {
      const forms = formsOfKind.get(kind.name)!
      forms.set(form.slice(kind.name.length + 2), (forms.get(form.slice(kind.name.length + 2)) ?? 0) + 1)
    }
  }
}
print('')
print('The forms of each kind, with the number of samples. The forms of a kind with more than 14 of them, e.g. the units after a number, are counted under their first 3 words.')
for (const kind of kinds) {
  const merged = new Map<string, number>()
  for (const [form, count] of formsOfKind.get(kind.name)!) {
    const key = formsOfKind.get(kind.name)!.size > 14 ? form.split(' ').slice(0, 3).join(' ') : form
    merged.set(key, (merged.get(key) ?? 0) + count)
  }
  print(`${kind.name}: ${[...merged].sort((left, right) => right[1] - left[1]).map(([form, count]) => `${form} (${count})`).join('; ')}`)
}

// 2. Scored code points and draws.
const scoredCounts = half.map(({sample}) => scoredCodePoints(sample)).sort((left, right) => left - right)
const quantile = (values: readonly number[], share: number) => values[Math.min(values.length - 1, Math.floor(share * values.length))]!
const total = scoredCounts.reduce((sum, count) => sum + count, 0)
print('')
print(`Scored code points per sample: mean ${(total / half.length).toFixed(1)}, median ${quantile(scoredCounts, 0.5)}, a tenth of the samples has ${quantile(scoredCounts, 0.1)} or fewer, a tenth ${quantile(scoredCounts, 0.9)} or more. ${total} in all.`)
const distances = half.map(({sample}) => sample.firstErrorPosition - sample.firstDamage).sort((left, right) => left - right)
print(`From the first damaged code point to the first error: median ${quantile(distances, 0.5)}, mean ${(distances.reduce((sum, distance) => sum + distance, 0) / half.length).toFixed(1)}. ${percent(distances.filter(distance => distance === 0).length / half.length)}% of the samples have 0, and ${percent(distances.filter(distance => distance > 50).length / half.length)}% more than 50.`)
print(`${half.filter(({sample}) => sample.needsNestingFix).length} samples (${percent(half.filter(({sample}) => sample.needsNestingFix).length / half.length)}%) have a scored depth that the loop cannot reach, see ../limits.ts.`)
const reasons = new Map<string, number>()
for (const {sample} of half) for (const reason of sample.discarded) reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
const discarded = [...reasons.values()].reduce((sum, count) => sum + count, 0)
print(`Draws: ${half.length + discarded}, of which ${discarded} (${percent(discarded / (half.length + discarded))}%) are thrown away: ${[...reasons].sort((left, right) => right[1] - left[1]).map(([reason, count]) => `${count} ${reason}`).join(', ')}. "an edit has no place" also counts a kind that the document has no place for, and two kinds that touch.`)

// 3. Scores.
const score = (samples: Samples, splits: ('train' | 'validation')[]) => ({asIs: scoreTables(asIsTables(), samples, {splits}), rule: scoreRestartAtNextLine(samples, {splits})})
const mixedArrays = arraysOf([...train, ...validation])
const sourceRow = (result: Score, source: string): ScoreRow => result.rows.find(row => row.name === `source: ${source}`)!
print('')
print('The score of the parser as it is and of the one rule "after an error, start anew at the next line", in percent: the scored code points with the display kind, the depth and the container right ("all three"), and the samples with every scored code point right ("whole").')
print(`${pad('samples', 7)} ${pad('scored', 9)}  ${pad('as it is', 13)}  ${pad('the one rule', 13)}`)
print(`${pad('', 7)} ${pad('', 9)}  ${pad('all 3', 6)} ${pad('whole', 6)}  ${pad('all 3', 6)} ${pad('whole', 6)}`)
const scoreLine = (name: string, asIs: ScoreRow, rule: ScoreRow) => `${pad(asIs.samples, 7)} ${pad(asIs.codePoints, 9)}  ${pad(percent(sharesOf(asIs).allThree, 2), 6)} ${pad(percent(sharesOf(asIs).whole, 2), 6)}  ${pad(percent(sharesOf(rule).allThree, 2), 6)} ${pad(percent(sharesOf(rule).whole, 2), 6)}  ${name}`
for (const split of ['validation', 'train'] as const) {
  const scores = score(mixedArrays, [split])
  print(scoreLine(`${split}, the half of this folder`, sourceRow(scores.asIs, 'kinds'), sourceRow(scores.rule, 'kinds')))
  print(scoreLine(`${split}, the dataset's half`, sourceRow(scores.asIs, 'damage'), sourceRow(scores.rule, 'damage')))
  print(scoreLine(`${split}, both halves`, scores.asIs.rows[0]!, scores.rule.rows[0]!))
}
print('')
print('The same per kind, on the validation samples of this folder\'s half. A sample with two kinds counts for both.')
const validationHalf = arraysOf(ofKinds(validation))
const perKind = score(validationHalf, ['validation'])
for (const group of ['one kind', 'two kinds']) print(scoreLine(`group: ${group}`, perKind.asIs.rows.find(row => row.name === `group: ${group}`)!, perKind.rule.rows.find(row => row.name === `group: ${group}`)!))
for (const kind of kinds) {
  const asIs = perKind.asIs.rows.find(row => row.name === `kind: ${kind.name}`)
  const rule = perKind.rule.rows.find(row => row.name === `kind: ${kind.name}`)
  if (asIs !== undefined && rule !== undefined) print(scoreLine(kind.name, asIs, rule))
}
// The validation samples with one kind alone, per kind, for a row that no second kind is in.
print('')
print('And on the validation samples with that kind alone.')
for (const kind of kinds) {
  const places = Int32Array.from({length: validationHalf.sampleCount}, (_, place) => place).filter(place => validationHalf.kindStart[place + 1]! - validationHalf.kindStart[place]! === 1 && validationHalf.kindNames[validationHalf.kindList[validationHalf.kindStart[place]!]!] === kind.name)
  if (places.length === 0) continue
  const alone = score(selectSamples(validationHalf, places), ['validation'])
  print(scoreLine(kind.name, alone.asIs.rows[0]!, alone.rule.rows[0]!))
}

// With --places: how many documents have a place for each kind.
if (process.argv.includes('--places')) {
  const documents: number[] = []
  for (let index = 0; documents.length < 2000; index++) if (sampleAt(standardRange.seed, index).split === 'train') documents.push(index)
  const drawsPerDocument = 3
  print('')
  print(`How many of ${documents.length} documents of the train split have a place for each kind: the share of documents on which one of ${drawsPerDocument} draws of the kind alone gives a sample. Then the share of the draws that give a sample, and what the other draws give.`)
  for (const kind of kinds) {
    let withPlace = 0
    const outcomes = new Map<string, number>()
    for (const index of documents) {
      const drawn = outcomesOfKind(standardRange.seed, index, kind.name, drawsPerDocument)
      if (drawn.includes('a sample')) withPlace++
      for (const outcome of drawn) outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1)
    }
    const draws = documents.length * drawsPerDocument
    print(`${pad(`${percent(withPlace / documents.length)}%`, 6)} ${pad(`${percent((outcomes.get('a sample') ?? 0) / draws)}%`, 6)}  ${kind.name}: ${[...outcomes].filter(([outcome]) => outcome !== 'a sample').sort((left, right) => right[1] - left[1]).map(([outcome, count]) => `${percent(count / draws)}% ${outcome}`).join(', ')}`)
  }
}

const file = process.argv.slice(2).find(argument => !argument.startsWith('--'))
if (file !== undefined) writeFileSync(file, `${lines.join('\n')}\n`)
