// Numbers that describe the neutral set next to the broken samples of the train split of the standard set, which
// have the same originals:
// 1. the sizes, the scored code points per sample, and how far the first error lies after the first damage,
// 2. what can be said about the dataset's groups: the two proofs about the plain table parser and its bound. The
//    other groups are judgments about a kind of damage, which a neutral sample does not have,
// 3. which of the dataset's kinds of damage a neutral sample with one edit is also a text of, by a rough rule,
// 4. the character classes that the recipe's rule picks from each of the two sets,
// 5. what the dataset's typing replays hold that a neutral edit does not,
// 6. how often the damage changes how every later quote or bracket of a text is read, by a rough count.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo. About half a minute, and a few
// seconds more when the neutral set has no cache file yet:
//   bun lab/recovery-parser/learn/arms/neutral-damage/stats.ts
import type {Edit} from '../../../edits.ts'
import {type ValidLabel, displayKind, labelsOfValidText} from '../../../labels.ts'
import type {Sample} from '../../../samples.ts'
import {type Samples, allowedSampleAt, loadStandardSamples, refuseUnknownOptions, sourceNames, standardRange, trainPart} from '../../data.ts'
import {classNameOfCodePoint, codePointsOfTheRule} from '../extra-facts/facts.ts'
import {neutralEditNames} from './neutral-edits.ts'
import {loadNeutralSet, neutralSampleAt, neutralSeed} from './neutral.ts'

refuseUnknownOptions('arms/neutral-damage/stats.ts', [])
const percent = (count: number, total: number, digits = 1) => `${(100 * count / total).toFixed(digits)}%`
const sum = (values: ArrayLike<number>) => Array.from(values).reduce((total, value) => total + value, 0)
// The mean, the quartiles and the 90th percentile of some numbers, as text.
function spread(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!
  return `mean ${(sum(sorted) / sorted.length).toFixed(1)}, a quarter have ${at(0.25)} or fewer, a half ${at(0.5)} or fewer, three quarters ${at(0.75)} or fewer, nine tenths ${at(0.9)} or fewer`
}

const neutral = loadNeutralSet()
const standardTrain = trainPart(loadStandardSamples())

// 1 and 2: per set, from the arrays. `places` are the broken samples that are counted.
function describe(name: string, samples: Samples, places: readonly number[]) {
  const scored = places.map(place => samples.scored[place]!)
  const length = places.map(place => samples.start[place + 1]! - samples.start[place]!)
  const errorAfterDamage = places.map(place => samples.firstErrorPosition[place]! - samples.firstDamage[place]!)
  const added = places.map(place => {
    let count = 0
    for (let at = samples.start[place]!; at < samples.start[place + 1]!; at++) if (samples.labelKind[at] === -1 && samples.labelDepth[at] === -1 && (samples.flags[at]! & 1) === 0) count++
    return count
  })
  const beforeTheError = places.map((place, at) => Math.min(samples.firstErrorPosition[place]!, length[at]!) / length[at]!)
  const mostRight = sum(places.map(place => samples.mostRight[place]!))
  console.log(`${name}: ${places.length} samples, ${sum(length)} code points, ${sum(scored)} scored code points`)
  console.log(`  scored code points per sample: ${spread(scored)}. ${percent(scored.filter(count => count <= 5).length, places.length)} of the samples have 5 or fewer`)
  console.log(`  code points from the first damage to the first error: ${spread(errorAfterDamage)}. ${percent(errorAfterDamage.filter(distance => distance === 0).length, places.length)} of the samples have their first error at the first damaged code point`)
  console.log(`  the share of a text that lies before its first error: mean ${percent(sum(beforeTheError), places.length)}. Added code points per sample: ${spread(added)}`)
  console.log(`  no run of the plain table parser has every scored depth and container right (needsNestingFix): ${percent(sum(places.map(place => samples.needsNestingFix[place]!)), places.length)} of the samples. Every scored display kind (needsDisplayFix): ${percent(sum(places.map(place => samples.needsDisplayFix[place]!)), places.length)}`)
  console.log(`  the bound of the plain table parser: ${percent(mostRight, sum(scored), 2)} of the scored code points, and ${percent(places.filter(place => samples.mostRight[place] === samples.scored[place]).length, places.length)} of the samples as a whole`)
}
const allOf = (samples: Samples, keep: (place: number) => boolean) => Array.from({length: samples.sampleCount}, (_, place) => place).filter(keep)
console.log('1 and 2. The sets')
describe('The neutral set', neutral.samples, allOf(neutral.samples, () => true))
describe('The standard train set, every broken sample', standardTrain, allOf(standardTrain, place => standardTrain.firstDamage[place] !== -1))
describe('The standard train set, the broken samples with something to score, which are the ones that train', standardTrain, allOf(standardTrain, place => standardTrain.firstDamage[place] !== -1 && standardTrain.scored[place]! > 0))
describe('  of them, the damaged documents', standardTrain, allOf(standardTrain, place => standardTrain.scored[place]! > 0 && sourceNames[standardTrain.source[place]!] === 'damage'))
describe('  of them, the typing replays', standardTrain, allOf(standardTrain, place => standardTrain.scored[place]! > 0 && sourceNames[standardTrain.source[place]!] === 'typing'))
console.log('The dataset\'s groups "out of reach", "needs a character class" and "needs a line rule" are judgments that the dataset writes next to each form of a kind of damage, so they cannot be worked out for a neutral sample. The two proofs and the bound above can.')

// 3. The kind of damage of the dataset that a neutral sample with one edit is also a text of, or undefined. The
// rule is rough: it looks at what the one edit removed or added and at the labels around it, and it knows none of
// the conditions of a kind's forms, e.g. that the dataset's stray letter comes after a comma at a line end.
function kindByChance(sample: Sample, labels: readonly ValidLabel[]): string | undefined {
  const original = Array.from(sample.original)
  const kindAt = (index: number) => labels[index]?.kind
  const isQuote = (index: number) => original[index] === '"' && (kindAt(index) === displayKind.string || kindAt(index) === displayKind.key)
  // The strings of the original, each from its opening quote to its closing quote.
  const strings: {start: number, end: number}[] = []
  for (let index = 0; index < original.length; index++) {
    if (!isQuote(index)) continue
    let end = index + 1
    while (!isQuote(end)) end++
    strings.push({start: index, end})
    index = end
  }
  const tokenBefore = (index: number) => {
    let at = index - 1
    while (at >= 0 && kindAt(at) === displayKind.whitespace) at--
    return original[at]
  }
  const tokenFrom = (index: number) => {
    let at = index
    while (at < original.length && kindAt(at) === displayKind.whitespace) at++
    return original[at]
  }
  const isPunctuation = (index: number, characters: string) => kindAt(index) === displayKind.punctuation && characters.includes(original[index]!)
  const removals = sample.edits.filter(edit => edit.remove > 0)
  const insertions = sample.edits.filter(edit => edit.insert !== '')
  const removal: Edit | undefined = removals[0]
  const inserted = Array.from(insertions[0]?.insert ?? '')

  if (removal !== undefined && insertions.length === 0 && removals.length === 1 && removal.remove === 1) {
    const at = removal.at
    if (isPunctuation(at, ',')) return 'missingComma'
    if (isPunctuation(at, ':')) return 'missingColon'
    if (isPunctuation(at, '}]')) return 'missingCloser'
    if (isPunctuation(at, '{[')) return tokenBefore(at) === undefined ? 'headMissing' : undefined
    if (strings.some(part => part.start === at)) return 'missingOpeningQuote'
    if (strings.some(part => part.end === at)) return /^,?[ \t\r]*(\n|$)/.test(original.slice(at + 1).join('')) ? 'openStringAtLineEnd' : 'openStringMidLine'
    if (kindAt(at) === displayKind.literal) return kindAt(at + 1) === displayKind.literal ? 'typingSlip' : 'partialLiteral'
    if (kindAt(at) === displayKind.number) {
      let end = at + 1
      while (kindAt(end) === displayKind.number) end++
      return end === at + 1 && '.eE+-'.includes(original[at - 1] ?? ' ') ? 'partialNumber' : 'numberFormat'
    }
    if (kindAt(at) === displayKind.escape) return original[at] === '\\' && original[at + 1] === '"' ? 'unescapedQuote' : 'unescapedBackslash'
    return undefined
  }
  if (removal !== undefined && insertions.length === 0 && removals.length === 1) {
    if (removal.at === 0) return 'headMissing'
    if (removal.at + removal.remove === original.length) return 'cutOff'
    return /^\s*[}\]]\s*$/.test(original.slice(removal.at, removal.at + removal.remove).join('')) ? 'missingCloser' : 'middleCutOut'
  }
  if (removals.length === 0 && insertions.length === 1 && inserted.length === 1) {
    const at = insertions[0]!.at
    const added = inserted[0]!
    if (strings.some(part => part.start < at && at <= part.end)) return added === '"' ? 'unescapedQuote' : added === '\\' ? 'unescapedBackslash' : added === '\n' ? 'rawLineFeedInString' : added === '\t' ? 'rawTabInString' : undefined
    const before = tokenBefore(at)
    const from = tokenFrom(at)
    const closerFollows = from === '}' || from === ']'
    const besideAWord = [kindAt(at - 1), kindAt(at)].some(kind => kind === displayKind.literal || kind === displayKind.number)
    if (/[A-Za-z0-9.+_-]/.test(added) && besideAWord) return [kindAt(at - 1), kindAt(at)].includes(displayKind.literal) ? 'typingSlip' : 'numberFormat'
    if (added === ',') return closerFollows && before !== '{' && before !== '[' && before !== ',' ? 'trailingComma' : before === ',' || from === ',' || before === '{' || before === '[' ? 'extraComma' : undefined
    if (added === ':') return before === ':' || from === ':' ? 'typingSlip' : undefined
    if (added === '{' || added === '[') return before === added || from === added ? 'typingSlip' : undefined
    if (added === '}' || added === ']') return 'strayCloser'
    if (added === '"') return strings.some(part => part.end === at - 1 || part.start === at) ? 'doubledQuote' : undefined
    if (/\s/.test(added)) return undefined
    return !/[0-9tfn-]/.test(added) && (before === ',' || before === '{' || before === '[' || closerFollows) ? 'typingSlip' : undefined
  }
  if (removal !== undefined && removals.length === 1 && insertions.length === 1 && removal.remove === inserted.length) {
    const at = removal.at
    if (inserted.length === 1) {
      const added = inserted[0]!
      if (isPunctuation(at, '}]')) return added === '}' || added === ']' ? 'wrongCloser' : undefined
      if (isPunctuation(at, ':')) return added === ';' ? 'typingSlip' : added === '=' ? 'foreignKeySeparator' : undefined
      if (isPunctuation(at, ',')) return added === '.' || added === 'm' ? 'typingSlip' : undefined
      return kindAt(at) === displayKind.literal && /[a-z]/.test(added) ? 'typingSlip' : undefined
    }
    // Two neighbours in the other order.
    if (inserted.length === 2 && inserted[0] === original[at + 1] && inserted[1] === original[at]) {
      if (kindAt(at) === displayKind.literal && kindAt(at + 1) === displayKind.literal) return 'typingSlip'
      if (strings.some(part => part.end === at) && isPunctuation(at + 1, ':,')) return 'typingSlip'
    }
  }
  return undefined
}

{
  const byKind = new Map<string, number>()
  const byEdit = neutralEditNames.map(() => ({samples: 0, withAKind: 0}))
  let oneEdit = 0
  for (let index = 0; index < neutral.samples.sampleCount; index++) {
    if (neutral.editStart[index + 1]! - neutral.editStart[index]! !== 1) continue
    const {sample} = neutralSampleAt(neutralSeed, index)
    const kind = kindByChance(sample, labelsOfValidText(sample.original))
    const edit = neutral.editList[neutral.editStart[index]!]!
    oneEdit++
    byEdit[edit]!.samples++
    if (kind === undefined) continue
    byEdit[edit]!.withAKind++
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1)
  }
  const withAKind = sum([...byKind.values()])
  console.log('')
  console.log('3. Kinds of the dataset by chance')
  console.log(`Of the ${oneEdit} neutral samples with one edit, ${withAKind} (${percent(withAKind, oneEdit)}) are also a text of one of the dataset's kinds of damage, by the rough rule of kindByChance. That is ${percent(withAKind, neutral.samples.sampleCount)} of the set, and a sample with two or three edits is not counted.`)
  console.log(`  per kind, the samples and their share of the samples with one edit: ${[...byKind].sort((left, right) => right[1] - left[1]).map(([kind, count]) => `${kind} ${count} (${percent(count, oneEdit)})`).join(', ')}`)
  console.log(`  per edit, the samples with that one edit that are a text of a kind: ${neutralEditNames.map((name, edit) => `${name} ${byEdit[edit]!.withAKind} of ${byEdit[edit]!.samples}`).join(', ')}`)
}

// 4. The classes that the rule of ../extra-facts/facts.ts picks, which is the recipe's first step.
{
  console.log('')
  console.log('4. The character classes that the rule picks')
  for (const [name, samples] of [['the standard train set', standardTrain], ['the neutral set', neutral.samples]] as const) {
    const candidates = codePointsOfTheRule(samples)
    const describeCodePoint = (codePoint: number) => `${classNameOfCodePoint(codePoint)}${codePoint > 0x20 && codePoint < 0x7f ? ` ${String.fromCodePoint(codePoint)}` : ''}`
    console.log(`From ${name}: ${candidates.filter(entry => entry.picked).length} classes: ${candidates.filter(entry => entry.picked).map(entry => `${describeCodePoint(entry.codePoint)} (distance ${entry.distance.toFixed(2)}, ${entry.samples} samples)`).join(', ')}`)
    console.log(`  the next five that it does not pick: ${candidates.filter(entry => !entry.picked).slice(0, 5).map(entry => `${describeCodePoint(entry.codePoint)} (${entry.distance.toFixed(2)}, ${entry.samples} samples)`).join(', ')}`)
  }
}

// 5. The typing replays of the standard train set.
{
  const counts = {samples: 0, autoClosing: 0, closerAfterTheCursor: 0, wrongKey: 0, oneRunMissing: 0, oneShortRunOrTheTail: 0}
  const byAction = new Map<string, number>()
  for (let place = 0; place < standardTrain.sampleCount; place++) {
    if (sourceNames[standardTrain.source[place]!] !== 'typing') continue
    const sample = allowedSampleAt(standardRange.seed, standardTrain.index[place]!)
    if (sample?.typing === undefined) throw new Error(`the sample ${standardTrain.index[place]} of the standard set is no text of a typing replay`)
    counts.samples++
    byAction.set(sample.typing.action, (byAction.get(sample.typing.action) ?? 0) + 1)
    if (sample.typing.editor === 'auto-closing') counts.autoClosing++
    if (sample.kinds.includes('typingSlip')) counts.wrongKey++
    const removals = sample.edits.filter(edit => edit.remove > 0)
    const insertions = sample.edits.filter(edit => edit.insert !== '')
    // Between two removed runs stand only closing quotes, closing brackets and white space: what the editor put
    // after the cursor, e.g. the `"` of `"na"` while the key `"name"` is typed.
    const original = Array.from(sample.original)
    if (removals.some((run, at) => at > 0 && /^\s*["}\]][\s"}\]]*$/.test(original.slice(removals[at - 1]!.at + removals[at - 1]!.remove, run.at).join('')))) counts.closerAfterTheCursor++
    if (removals.length === 1 && insertions.length === 0) {
      counts.oneRunMissing++
      const run = removals[0]!
      if (run.remove <= 20 || run.at + run.remove === original.length) counts.oneShortRunOrTheTail++
    }
  }
  console.log('')
  console.log('5. The typing replays of the standard train set')
  console.log(`${counts.samples} texts: ${[...byAction].map(([action, count]) => `${action} ${percent(count, counts.samples)}`).join(', ')}.`)
  console.log(`  ${percent(counts.autoClosing, counts.samples)} come from the editor that closes quotes and brackets, and in ${percent(counts.closerAfterTheCursor, counts.samples)} a quote or a bracket that it added stands after the cursor. ${percent(counts.wrongKey, counts.samples)} hold a wrong key press.`)
  console.log(`  ${percent(counts.oneRunMissing, counts.samples)} are the original without one run of code points and with nothing added, and ${percent(counts.oneShortRunOrTheTail, counts.samples)} without one run of at most 20 code points or without the tail: texts that the neutral edits 1, 5 and 10 can make of the same original. In every replay the run is what is not typed yet of one member or item, so its end is a place that the dataset's scan of the JSON structure gives.`)
}

// 6. Damage after which a reader from the left cannot give the labels of what follows. Two rough counts, of the
// code points that the damage took away or put there before the last kept code point:
// - an odd number of quotes, so that every later quote is read in the opposite role, at least up to the end of its
//   line, e.g. after a run with one quote was copied into another place,
// - more opening than closing brackets or the other way round, so that the depth of what follows is another than
//   the labels', e.g. after an inserted `[`.
// A quote or a bracket that the damage put inside a string is counted too, which is why the counts are rough.
function imbalanceOf(sample: Sample, labels: readonly ValidLabel[]) {
  const original = Array.from(sample.original)
  let quotes = 0
  let brackets = 0
  const bracketOf = (character: string) => character === '{' || character === '[' ? 1 : character === '}' || character === ']' ? -1 : 0
  for (const edit of sample.edits) {
    // What comes after the last kept code point changes no label: a tail that was cut, or text after the end.
    if (edit.oneForOne === true || edit.at + edit.remove === original.length) continue
    for (let index = edit.at; index < edit.at + edit.remove; index++) {
      const kind = labels[index]!.kind
      if (original[index] === '"' && (kind === displayKind.string || kind === displayKind.key)) quotes++
      if (kind === displayKind.punctuation) brackets -= bracketOf(original[index]!)
    }
    for (const character of edit.insert) {
      if (character === '"') quotes++
      brackets += bracketOf(character)
    }
  }
  return {oddQuotes: quotes % 2 === 1, unbalancedBrackets: brackets !== 0}
}

{
  console.log('')
  console.log('6. Damage that changes how every later quote or bracket is read, by a rough count')
  const describeImbalance = (name: string, samples: readonly Sample[]) => {
    const counted = samples.map(sample => imbalanceOf(sample, sample.documents.flatMap(labelsOfValidText)))
    const quotes = counted.filter(found => found.oddQuotes).length
    const brackets = counted.filter(found => found.unbalancedBrackets).length
    const either = counted.filter(found => found.oddQuotes || found.unbalancedBrackets).length
    console.log(`${name}, ${samples.length} samples: an odd number of quotes added or removed in ${percent(quotes, samples.length)}, more opening than closing brackets or the other way round in ${percent(brackets, samples.length)}, one of the two in ${percent(either, samples.length)}`)
  }
  const neutralSamples = Array.from({length: neutral.samples.sampleCount}, (_, index) => neutralSampleAt(neutralSeed, index).sample)
  describeImbalance('The neutral set', neutralSamples)
  describeImbalance('  of them, the samples with one edit', neutralSamples.filter((_, index) => neutral.editStart[index + 1]! - neutral.editStart[index]! === 1))
  const standardSamples = allOf(standardTrain, place => standardTrain.firstDamage[place] !== -1 && standardTrain.scored[place]! > 0).map(place => allowedSampleAt(standardRange.seed, standardTrain.index[place]!)!)
  describeImbalance('The standard train set, the broken samples with something to score', standardSamples)
}
