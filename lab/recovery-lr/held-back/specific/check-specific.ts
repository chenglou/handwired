// HELD BACK. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read
// this file, see ../README.md. Its output holds counts and names of kinds, and no text of a sample.
//
// Checks the set of typical mistakes:
// - The kinds: every name once, and every example a valid program and a text that the parser rejects.
// - Every sample, with values that this file takes anew from the two texts:
//   - the original is a valid program, and both texts have at most 512 code points,
//   - the parser rejects the broken text, at the token and with the stack that the sample says,
//   - the places of the kept code points rise, and a kept code point is the code point of its counterpart,
//   - a kept code point has the display kind, the depth, the container and the hash of the stack that its
//     counterpart has in the original, taken from the original anew, and an added one has none,
//   - the scored code points are the kept ones from the first error on, at least 20,
//   - a kind that only adds text keeps every code point of the original, and a kind that only lacks text adds
//     none,
//   - a whole token that is missing stands right before the next kept token, and not before white space or a
//     comment, unless added text stands in its place (rules 4 and 5 of ../written/REPAIR.md),
//   - the sample's valid program is the generator's program for a draw that the sample names.
// - The set: the count per kind, every kind with samples of its own, no broken text twice, the same samples
//   when they are made again, and how many programs have the tokens of a train or validation program.
// - README.md: its table of the kinds, their examples and its list of what a table can show are those of kinds.ts.
// - The check itself: six samples with a fault put in by hand are each seen.
//
// Run from the repo root: bun lab/recovery-lr/held-back/specific/check-specific.ts [--count 6000] [--without-dataset]
// It takes about 15 s, most of it for the train and validation programs.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {defaultSeed, programAt as datasetProgramAt, splitOfTokens, trainSampleCount, validationSampleCount} from '../../dataset.ts'
import {type ValidLabels, labelsOfValidText} from '../../labels.ts'
import {isValid, maximumCodePoints, parseText} from '../../parser.ts'
import {type Sample, alignmentOfTexts, isScored} from '../../sample.ts'
import {isTrivia} from '../../tables.ts'
import {kindOfName, kinds} from './kinds.ts'
import {examplesOfKinds, reachOfKinds, tableOfKinds} from './numbers.ts'
import {programAt} from './programs.ts'
import {type SpecificSample, minimumScored, specificSampleAt, specificSampleCount, specificSeed} from './specific.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 40) console.log(`PROBLEM: ${text}`)
}
const options = process.argv.slice(2)
const count = options.includes('--count') ? Number(options[options.indexOf('--count') + 1]) : specificSampleCount
const withDataset = !options.includes('--without-dataset')

const terminalsOf = (labels: ValidLabels): string => Array.from(labels.tokens.kind).filter(kind => !isTrivia(kind)).join(' ')

// The whole tokens of the original that are missing before kept white space or a kept comment, with no added
// text in their place.
function missingBeforeWhiteSpace(sample: Sample, labels: ValidLabels): number {
  const {tokens} = labels
  // Per code point of the original: the token that it is in.
  const tokenAt = new Int32Array(labels.codePoints.length)
  for (let token = 0; token < tokens.count; token++) {
    const start = tokens.start[token]!
    tokenAt.fill(token, start, start + tokens.length[token]!)
  }
  let found = 0
  let lastKept = -1, addedSince = false
  for (let position = 0; position < sample.alignment.length; position++) {
    const counterpart = sample.alignment[position]!
    if (counterpart === -1) {
      addedSince = true
      continue
    }
    // The original's code points from lastKept + 1 to counterpart - 1 are missing here.
    if (!addedSince && counterpart > lastKept + 1 && isTrivia(tokens.kind[tokenAt[counterpart]!]!)) {
      for (let token = tokenAt[lastKept + 1]!; token <= tokenAt[counterpart - 1]!; token++) {
        if (!isTrivia(tokens.kind[token]!) && tokens.start[token]! > lastKept && tokens.start[token]! + tokens.length[token]! <= counterpart) found++
      }
    }
    lastKept = counterpart
    addedSince = false
  }
  return found
}

// What is wrong with a sample, in words that name no text of it.
function problemsOfSample({sample, kinds: names, forms, program}: SpecificSample): string[] {
  const found: string[] = []
  const {original, broken, alignment} = sample
  if (names.length < 1 || names.length > 2 || forms.length !== names.length || names.join() !== sample.edits.join()) found.push('the kinds, the forms and the edits do not fit')
  if (!isValid(original)) return [...found, 'the original is no valid program']
  const originalCodePoints = Array.from(original), brokenCodePoints = Array.from(broken)
  if (originalCodePoints.length > maximumCodePoints || brokenCodePoints.length > maximumCodePoints) found.push('a text has more than 512 code points')
  if (brokenCodePoints.length !== sample.codePoints.length || brokenCodePoints.some((character, position) => character.codePointAt(0) !== sample.codePoints[position])) found.push('the code points are not those of the broken text')
  const parsed = parseText(broken)
  if (parsed.parse.valid) return [...found, 'the parser accepts the broken text']
  if (parsed.parse.firstErrorToken !== sample.firstErrorToken || parsed.parse.firstErrorPosition !== sample.firstErrorPosition) found.push('the first error is not where the sample says')
  if (parsed.parse.stack.join() !== sample.startStack.join()) found.push('the stack at the first error is not the sample\'s')
  if (alignment.length !== brokenCodePoints.length) return [...found, 'the alignment does not have one entry per code point']
  const labels = labelsOfValidText(original)
  let lastKept = -1, scored = 0, added = 0
  for (let position = 0; position < alignment.length; position++) {
    const counterpart = alignment[position]!
    if (counterpart === -1) {
      added++
      if (sample.labelKind[position] !== -1 || sample.labelDepth[position] !== -1 || sample.labelContainer[position] !== -1 || sample.labelStack[position] !== 0) found.push('an added code point has a label')
      if (isScored(sample, position)) found.push('an added code point is scored')
      continue
    }
    if (counterpart <= lastKept || counterpart >= originalCodePoints.length) return [...found, 'the places of the kept code points do not rise']
    lastKept = counterpart
    if (originalCodePoints[counterpart] !== brokenCodePoints[position]) found.push('a kept code point is another code point than its counterpart')
    if (sample.labelKind[position] !== labels.kind[counterpart] || sample.labelDepth[position] !== labels.depth[counterpart] || sample.labelContainer[position] !== labels.container[counterpart] || sample.labelStack[position] !== labels.stack[counterpart]) {
      found.push('a kept code point does not have the labels of its counterpart in the original')
    }
    if (position >= parsed.parse.firstErrorPosition) scored++
  }
  if (scored !== sample.scored) found.push('the number of scored code points is wrong')
  if (scored < minimumScored) found.push(`fewer than ${minimumScored} code points are scored`)
  const changes = new Set(names.map(name => kindOfName(name).changes))
  const kept = alignment.length - added
  if (changes.size === 1 && changes.has('adds') && kept !== originalCodePoints.length) found.push('a kind that only adds text has lost a code point of the original')
  if (changes.size === 1 && changes.has('lacks') && added > 0) found.push('a kind that only lacks text has added a code point')
  if (missingBeforeWhiteSpace(sample, labels) > 0) found.push('a whole token is missing before kept white space')
  // The program is the generator's, and the original has its tokens where only white space was moved.
  if (!isValid(program)) found.push('the program of the sample is not valid')
  if (changes.size === 1 && changes.has('lacks') && terminalsOf(labelsOfValidText(program)) !== terminalsOf(labels)) found.push('the original of a kind that only lacks text has other tokens than the program')
  return [...new Set(found)]
}

// The kinds.
const names = new Set(kinds.map(kind => kind.name))
if (names.size !== kinds.length) problem('two kinds have one name')
for (const kind of kinds) {
  if (!isValid(kind.example.meant)) problem(`the example of "${kind.name}": the parser rejects what was meant`)
  // A kind that is only drawn with another kind leaves a valid program by itself.
  if (isValid(kind.example.broken) !== (kind.onlyWithAnotherKind === true)) problem(`the example of "${kind.name}": the parser ${kind.onlyWithAnotherKind === true ? 'rejects' : 'accepts'} the broken text`)
  if (kind.example.meant === kind.example.broken) problem(`the example of "${kind.name}" changes nothing`)
  const kept = Array.from(alignmentOfTexts(kind.example.meant, kind.example.broken)).filter(counterpart => counterpart !== -1).length
  if (kind.changes === 'adds' && kept !== Array.from(kind.example.meant).length) problem(`the example of "${kind.name}", which only adds text, lacks a code point`)
  if (kind.changes === 'lacks' && kept !== Array.from(kind.example.broken).length) problem(`the example of "${kind.name}", which only lacks text, adds a code point`)
  if (kind.description.includes('\n') || kind.reach.why.includes('\n')) problem(`"${kind.name}": a text of the README's table has a line break`)
}
console.log(`${kinds.length} kinds, ${kinds.filter(kind => kind.onlyWithAnotherKind === true).length} of them only drawn with another kind, since it leaves a valid program by itself. Every other example is a valid program and a text that the parser rejects.`)

// The samples.
const started = performance.now()
const samples: SpecificSample[] = []
for (let index = 0; index < count; index++) samples.push(specificSampleAt(specificSeed, index))
const perKind = new Map<string, {alone: number, withAnother: number}>(kinds.map(kind => [kind.name, {alone: 0, withAnother: 0}]))
const brokenTexts = new Set<string>(), programTokens = new Set<string>(), ids = new Set<string>()
let withProblems = 0, scoredCodePoints = 0
for (const specific of samples) {
  const found = problemsOfSample(specific)
  if (found.length > 0) {
    withProblems++
    problem(`sample ${specific.sample.id} (${specific.kinds.join(' and ')}): ${found.join('; ')}`)
  }
  for (const name of specific.kinds) perKind.get(name)![specific.kinds.length === 1 ? 'alone' : 'withAnother']++
  brokenTexts.add(specific.sample.broken)
  ids.add(specific.sample.id)
  programTokens.add(terminalsOf(labelsOfValidText(specific.program)))
  scoredCodePoints += specific.sample.scored
}
if (ids.size !== samples.length) problem('two samples have one id')
if (brokenTexts.size !== samples.length) problem(`${samples.length - brokenTexts.size} samples have a broken text that another sample has too`)
console.log(`${samples.length} samples in ${((performance.now() - started) / 1000).toFixed(1)} s: ${samples.filter(({kinds: drawn}) => drawn.length === 1).length} with one kind and ${samples.filter(({kinds: drawn}) => drawn.length === 2).length} with two. ${withProblems} have a problem.`)
console.log(`${scoredCodePoints.toLocaleString('en-US')} scored code points, ${(scoredCodePoints / samples.length).toFixed(0)} per sample. ${brokenTexts.size} distinct broken texts, and ${programTokens.size} distinct lists of tokens among the programs.`)
console.log('Samples per kind (alone, with another kind):')
for (const kind of kinds) {
  const {alone, withAnother} = perKind.get(kind.name)!
  console.log(`  ${String(alone).padStart(4)} ${String(withAnother).padStart(4)}  ${kind.name}`)
  if (count >= 3000 && alone + withAnother < 40) problem(`the kind "${kind.name}" has only ${alone + withAnother} samples`)
  if (count >= 3000 && kind.onlyWithAnotherKind !== true && alone < 20) problem(`the kind "${kind.name}" has only ${alone} samples of its own`)
  if (kind.onlyWithAnotherKind === true && alone > 0) problem(`the kind "${kind.name}" is the only kind of a sample`)
}

// The same samples a second time, and the generator's programs.
const again = Math.min(count, 400)
let differing = 0
for (let index = 0; index < again; index++) {
  const second = specificSampleAt(specificSeed, index * Math.floor(count / again))
  const first = samples[index * Math.floor(count / again)]!
  if (second.sample.broken !== first.sample.broken || second.sample.original !== first.sample.original || second.kinds.join() !== first.kinds.join() || second.sample.alignment.join() !== first.sample.alignment.join()) differing++
}
if (differing > 0) problem(`${differing} of ${again} samples differ when they are made again`)
let invalidPrograms = 0
for (let index = 0; index < 2000; index++) {
  const {text} = programAt(specificSeed, index)
  if (!isValid(text) || text.length > maximumCodePoints || text !== programAt(specificSeed, index).text) invalidPrograms++
}
if (invalidPrograms > 0) problem(`${invalidPrograms} of 2,000 programs of the generator are not valid, too long or not the same twice`)
console.log(`${again} samples are the same when they are made again. 2,000 programs of the generator are valid, of at most 512 code points, and the same twice.`)

// No program of the set has the tokens of a train or validation program.
if (withDataset) {
  const datasetTokens = new Set<string>()
  let train = 0, validation = 0
  for (let index = 0; train < trainSampleCount || validation < validationSampleCount; index++) {
    const {labels} = datasetProgramAt(defaultSeed, index)
    datasetTokens.add(terminalsOf(labels))
    if (splitOfTokens(labels) === 'train') train++
    else validation++
  }
  const shared = [...programTokens].filter(tokens => datasetTokens.has(tokens)).length
  const samplesShared = samples.filter(({program}) => datasetTokens.has(terminalsOf(labelsOfValidText(program)))).length
  console.log(`${datasetTokens.size.toLocaleString('en-US')} distinct lists of tokens among the programs of the train and validation samples. ${shared} of them are the tokens of a program of this set, in ${samplesShared} samples.`)
  if (samplesShared > samples.length / 100) problem(`${samplesShared} samples have a program with the tokens of a train or validation program`)
}

// README.md holds the table of the kinds, their examples and what a table can show, as kinds.ts and the samples
// give them today.
if (count === specificSampleCount) {
  const readme = readFileSync(join(import.meta.dir, 'README.md'), 'utf8')
  for (const [name, text] of [['the table of the kinds', tableOfKinds(samples)], ['the examples of the kinds', examplesOfKinds()], ['the list of what a table can show', reachOfKinds()]] as const) {
    if (!readme.includes(text)) problem(`README.md does not hold ${name} as numbers.ts prints it`)
  }
  console.log('README.md holds the table of the kinds, their examples and the list of what a table can show, as numbers.ts prints them.')
}

// The check sees a fault. Each is put into a copy of the first sample that it fits.
{
  const copyOf = (specific: SpecificSample): SpecificSample => ({...specific, sample: {
    ...specific.sample, alignment: specific.sample.alignment.slice(), labelKind: specific.sample.labelKind.slice(), labelDepth: specific.sample.labelDepth.slice(),
    labelContainer: specific.sample.labelContainer.slice(), labelStack: specific.sample.labelStack.slice(),
  }})
  const firstKept = (sample: Sample, from = 0): number => sample.alignment.findIndex((counterpart, position) => position >= from && counterpart !== -1)
  const faults: {name: string, sees: string, make: () => SpecificSample | undefined}[] = [
    {name: 'a kept code point with another depth', sees: 'labels of its counterpart', make: () => {
      const copy = copyOf(samples[0]!)
      copy.sample.labelDepth[firstKept(copy.sample, copy.sample.firstErrorPosition)]!++
      return copy
    }},
    {name: 'a kept code point with the label of its neighbour in the original', sees: 'labels of its counterpart', make: () => {
      // The alignment is moved by one at a place where the neighbour is another token.
      for (const specific of samples) {
        const copy = copyOf(specific)
        const {alignment, labelKind} = copy.sample
        const at = alignment.findIndex((counterpart, position) => position > 0 && counterpart > 0 && alignment[position - 1] === counterpart - 1 && labelKind[position] !== labelKind[position - 1])
        if (at === -1) continue
        copy.sample.labelKind[at] = labelKind[at - 1]!
        return copy
      }
      return undefined
    }},
    {name: 'an added code point that is called kept', sees: 'do not rise', make: () => {
      const specific = samples.find(({sample}) => sample.alignment.some((counterpart, position) => counterpart === -1 && position > 0 && sample.alignment[position - 1] !== -1))
      if (specific === undefined) return undefined
      const copy = copyOf(specific)
      const at = copy.sample.alignment.findIndex((counterpart, position) => counterpart === -1 && position > 0 && copy.sample.alignment[position - 1] !== -1)
      copy.sample.alignment[at] = copy.sample.alignment[at - 1]!
      return copy
    }},
    {name: 'a broken text that is a valid program', sees: 'the parser accepts', make: () => {
      const copy = copyOf(samples[0]!)
      copy.sample = {...copy.sample, broken: copy.sample.original}
      return copy
    }},
    {name: 'a kind that only adds text, with a code point of the original lost', sees: 'has lost a code point', make: () => {
      const specific = samples.find(({kinds: drawn, sample}) => drawn.length === 1 && kindOfName(drawn[0]!).changes === 'adds' && sample.alignment[0] === 0)
      if (specific === undefined) return undefined
      const copy = copyOf(specific)
      copy.sample.alignment[0] = -1
      copy.sample.labelKind[0] = copy.sample.labelDepth[0] = copy.sample.labelContainer[0] = -1
      copy.sample.labelStack[0] = 0
      return copy
    }},
    {name: 'a token that is missing at the end of its line, before the line break', sees: 'missing before kept white space', make: () => {
      // The `in` stays at the end of its line in the original, as the program has it.
      const original = 'let area w h =\n  let half = w / 2 in\n  let rest = h - 1 in\n  half * rest\nlet side = 4\n', broken = original.replace(' in\n  let', '\n  let')
      const alignment = alignmentOfTexts(original, broken)
      const sample = {...samples[0]!.sample, original, broken, alignment, edits: ['missing in']}
      return {...samples[0]!, sample, kinds: ['missing in'], forms: ['before `let`'], program: original}
    }},
  ]
  let seen = 0
  for (const fault of faults) {
    const faulty = fault.make()
    if (faulty === undefined) problem(`no sample fits the fault "${fault.name}"`)
    else if (!problemsOfSample(faulty).some(found => found.includes(fault.sees))) problem(`the check does not see ${fault.name}`)
    else seen++
  }
  console.log(`${seen} of ${faults.length} faults that were put in by hand are seen.`)
}

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
