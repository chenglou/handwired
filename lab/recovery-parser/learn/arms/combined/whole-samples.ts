// What keeps a sample from being whole: for the saved tables of a recipe, how many scored code points of a
// validation sample are wrong, and for the samples with 1 to 10 wrong ones, where those code points are, which label
// is wrong, what the label asks for and what is shown, and which kinds of damage lose whole samples against the
// hand-written tables. It also names samples to read with ../../handwritten/show.ts. It trains nothing.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after run.ts saved the step:
//   bun lab/recovery-parser/learn/arms/combined/whole-samples.ts --step kept [--recipe 0]
// --recipe is the place of the recipe in the step's list, 0 for the first one. Every count is the mean over the
// step's seeds, and the same count of the hand-written tables stands next to it.
import {type Samples, codePointKindScored, codePointNestingScored, optionOf, refuseUnknownOptions} from '../../data.ts'
import {handwrittenTables} from '../../handwritten/rules.ts'
import {createTrace} from '../../recovery-parser.ts'
import {type RecoveryTables, displayKindNames, lexerStateNames, loadTablesOfThisDataset} from '../../recovery-tables.ts'
import {runOnSample, wrongKind, wrongLabelsAt} from '../../score.ts'
import {validationOfTheStandardSet} from '../harness.ts'
import {describeRecipe, savedTablesFileOf, steps} from './combined.ts'

const wrongCountNames = ['none, a whole sample', '1', '2 or 3', '4 to 10', '11 or more'] as const
const wrongCountOf = (wrong: number) => wrong === 0 ? 0 : wrong === 1 ? 1 : wrong <= 3 ? 2 : wrong <= 10 ? 3 : 4
// The display kinds of a token that has an inside: a wrong code point is "inside a word" when its label has such a
// kind and the code point before it has the same.
const kindsOfWords = new Set(['string', 'key', 'number', 'literal'].map(name => displayKindNames.indexOf(name)))
// The tokenizer states of a number and of a literal: every state of today's but `between`, the six of a string and
// `errorLine`. A spare state is none of them.
const statesOfNumbersAndLiterals = new Set(lexerStateNames.map((name, state) => ['between', 'string', 'escape', 'hex4', 'hex3', 'hex2', 'hex1', 'errorLine'].includes(name) ? -1 : state).filter(state => state !== -1))

type Counts = {
  samples: number
  byWrongCount: number[]
  // Over the samples with 1 to 10 wrong code points: the samples, their wrong code points, and of those the ones
  // among the first 3 scored code points of the sample, among its last 3, inside a word, with the display kind alone
  // wrong, in a tokenizer state of a number or of a literal, and per pair of the label's kind and the shown kind.
  almostRightSamples: number
  wrongCodePoints: number
  rightAfterTheError: number
  atTheEnd: number
  insideAWord: number
  kindAloneWrong: number
  inNumberOrLiteralState: number
  shownInPlaceOf: Map<string, number>
  // Per kind of damage: samples with something to recover, whole ones, and the places of the almost right ones.
  samplesOfKind: number[]
  wholeOfKind: number[]
  almostRightOfKind: number[][]
}

function countsOf(tables: RecoveryTables, samples: Samples): Counts {
  const counts: Counts = {
    samples: 0, byWrongCount: wrongCountNames.map(() => 0), almostRightSamples: 0, wrongCodePoints: 0, rightAfterTheError: 0, atTheEnd: 0, insideAWord: 0, kindAloneWrong: 0,
    inNumberOrLiteralState: 0, shownInPlaceOf: new Map(), samplesOfKind: samples.kindNames.map(() => 0), wholeOfKind: samples.kindNames.map(() => 0), almostRightOfKind: samples.kindNames.map(() => []),
  }
  const trace = createTrace()
  for (let place = 0; place < samples.sampleCount; place++) {
    const scored = samples.scored[place]!
    if (samples.firstDamage[place] === -1 || scored === 0) continue
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    runOnSample(trace, samples, place, tables)
    // The wrong code points of the sample: the position in the text, and the place among the scored code points.
    const wrong: {position: number, scoredPlace: number}[] = []
    let scoredPlace = 0
    for (let position = samples.firstErrorPosition[place]!; position < length; position++) {
      if ((samples.flags[start + position]! & (codePointKindScored | codePointNestingScored)) === 0) continue
      if (wrongLabelsAt(samples, start + position, trace, position) !== 0) wrong.push({position, scoredPlace})
      scoredPlace++
    }
    const almostRight = wrong.length >= 1 && wrong.length <= 10
    counts.samples++
    counts.byWrongCount[wrongCountOf(wrong.length)]!++
    for (let at = samples.kindStart[place]!; at < samples.kindStart[place + 1]!; at++) {
      const kind = samples.kindList[at]!
      counts.samplesOfKind[kind]!++
      if (wrong.length === 0) counts.wholeOfKind[kind]!++
      if (almostRight) counts.almostRightOfKind[kind]!.push(place)
    }
    if (!almostRight) continue
    counts.almostRightSamples++
    for (const {position, scoredPlace: placeAmongScored} of wrong) {
      const at = start + position
      const labelKind = samples.labelKind[at]!
      counts.wrongCodePoints++
      if (placeAmongScored < 3) counts.rightAfterTheError++
      else if (placeAmongScored >= scored - 3) counts.atTheEnd++
      if (kindsOfWords.has(labelKind) && position > 0 && samples.labelKind[at - 1] === labelKind) counts.insideAWord++
      if (wrongLabelsAt(samples, at, trace, position) === wrongKind) {
        counts.kindAloneWrong++
        const pair = `${displayKindNames[labelKind]} shown as ${displayKindNames[trace.displayKind[position]!]}`
        counts.shownInPlaceOf.set(pair, (counts.shownInPlaceOf.get(pair) ?? 0) + 1)
      }
      if (statesOfNumbersAndLiterals.has(trace.lexerStateBefore[position]!)) counts.inNumberOrLiteralState++
    }
  }
  return counts
}

refuseUnknownOptions('arms/combined/whole-samples.ts', ['--step', '--recipe'])
const stepName = optionOf('--step') ?? ''
const step = steps[stepName]
if (step === undefined) throw new Error(`arms/combined/whole-samples.ts needs --step with one of ${Object.keys(steps).join(', ')}, and got ${stepName}`)
const recipe = step.recipes[Number(optionOf('--recipe') ?? 0)]
if (recipe === undefined) throw new Error(`the step ${stepName} has the recipes 0 to ${step.recipes.length - 1}`)
const validation = validationOfTheStandardSet()
const ofSeeds = step.seeds.map(seed => countsOf(loadTablesOfThisDataset(savedTablesFileOf(step.armName, recipe, seed)).tables, validation))
const ofHand = countsOf(handwrittenTables().tables, validation)
const mean = (value: (counts: Counts) => number) => ofSeeds.reduce((total, counts) => total + value(counts), 0) / ofSeeds.length
const percent = (count: number, of: number) => of === 0 ? '-' : (100 * count / of).toFixed(1)
const pair = (value: (counts: Counts) => number, of: (counts: Counts) => number) => `${percent(mean(value), mean(of))} | ${percent(value(ofHand), of(ofHand))}`

console.log(`The recipe ${JSON.stringify(describeRecipe(recipe))}, the mean of the seeds ${step.seeds.join(', ')}, next to the hand-written tables. Validation split, ${ofHand.samples} samples with something to recover.`)
console.log('')
console.log('| wrong code points in a sample | the recipe, % of the samples | hand-written, % of the samples |')
console.log('| --- | --- | --- |')
wrongCountNames.forEach((name, index) => console.log(`| ${name} | ${pair(counts => counts.byWrongCount[index]!, counts => counts.samples)} |`))
console.log('')
console.log(`The samples with 1 to 10 wrong code points: ${mean(counts => counts.almostRightSamples).toFixed(0)} for the recipe with ${mean(counts => counts.wrongCodePoints).toFixed(0)} wrong code points, ${ofHand.almostRightSamples} for the hand-written tables with ${ofHand.wrongCodePoints}.`)
console.log('')
console.log('| of the wrong code points of those samples | the recipe, % | hand-written, % |')
console.log('| --- | --- | --- |')
console.log(`| among the first 3 scored code points, right after the error | ${pair(counts => counts.rightAfterTheError, counts => counts.wrongCodePoints)} |`)
console.log(`| among the last 3 scored code points, at the text's end | ${pair(counts => counts.atTheEnd, counts => counts.wrongCodePoints)} |`)
console.log(`| inside a word: the label is a string, a key, a number or a literal, as at the code point before | ${pair(counts => counts.insideAWord, counts => counts.wrongCodePoints)} |`)
console.log(`| the display kind alone is wrong | ${pair(counts => counts.kindAloneWrong, counts => counts.wrongCodePoints)} |`)
console.log(`| the tokenizer is in a state of a number or of a literal before the code point | ${pair(counts => counts.inNumberOrLiteralState, counts => counts.wrongCodePoints)} |`)
const pairNames = [...new Set(ofSeeds.flatMap(counts => [...counts.shownInPlaceOf.keys()]))].sort((left, right) => mean(counts => counts.shownInPlaceOf.get(right) ?? 0) - mean(counts => counts.shownInPlaceOf.get(left) ?? 0))
for (const name of pairNames.slice(0, 8)) console.log(`| ${name}, with the depth and the container right | ${pair(counts => counts.shownInPlaceOf.get(name) ?? 0, counts => counts.wrongCodePoints)} |`)
console.log('')
console.log('Whole samples per kind of damage, the ten kinds with the most whole samples lost against the hand-written tables, and the ten with the most gained:')
console.log('')
console.log('| kind | samples | whole with the recipe, % | whole with the hand-written tables, % | whole samples lost |')
console.log('| --- | --- | --- | --- | --- |')
const lostOfKind = validation.kindNames.map((name, index) => ({name, index, lost: ofHand.wholeOfKind[index]! - mean(counts => counts.wholeOfKind[index]!)})).filter(kind => ofHand.samplesOfKind[kind.index]! > 0).sort((left, right) => right.lost - left.lost)
for (const {name, index, lost} of [...lostOfKind.slice(0, 10), ...lostOfKind.slice(-10)]) console.log(`| ${name} | ${ofHand.samplesOfKind[index]} | ${pair(counts => counts.wholeOfKind[index]!, counts => counts.samplesOfKind[index]!)} | ${lost.toFixed(1)} |`)
console.log('')
// Samples to read: for each of the three kinds that lose the most whole samples, the first sample that is almost
// right with the tables of the step's first seed.
const firstSeed = ofSeeds[0]!
const examples = lostOfKind.slice(0, 3).flatMap(({name, index}) => firstSeed.almostRightOfKind[index]!.length === 0 ? [] : [{name, sampleIndex: validation.index[firstSeed.almostRightOfKind[index]![0]!]!}])
console.log(`Samples to read, each almost right with the tables of the seed ${step.seeds[0]}: ${examples.map(({name, sampleIndex}) => `${sampleIndex} (${name})`).join(', ')}. E.g.:`)
for (const {sampleIndex} of examples) console.log(`  bun lab/recovery-parser/learn/handwritten/show.ts --split validation --index ${sampleIndex} --tables ${savedTablesFileOf(step.armName, recipe, step.seeds[0]!)}`)
