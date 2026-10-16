// What keeps a sample from being whole: for the saved tables of a recipe, the validation samples in which a few
// scored code points are wrong, where in the sample those code points are, which label is wrong at them, what they
// are shown as, and the whole samples per kind of damage against the hand-written tables. It trains nothing.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after run.ts saved the step:
//   bun lab/recovery-parser/learn/arms/generic/whole-samples.ts [--step passes-and-start] [--recipe 0]
// --recipe is the place of the recipe in the step's list, 0 for the first one. Every count is the mean over the
// recipe's seeds, and the same count of the hand-written tables stands next to it.
import {join} from 'node:path'
import {type Samples, codePointKindScored, codePointNestingScored, groupNames, optionOf, refuseUnknownOptions} from '../../data.ts'
import {handwrittenTables} from '../../handwritten/rules.ts'
import {createTrace} from '../../recovery-parser.ts'
import {type RecoveryTables, classNames, displayKindNames, lexerStateNames, loadTablesOfThisDataset, today} from '../../recovery-tables.ts'
import {runOnSample, wrongKind, wrongLabelsAt} from '../../score.ts'
import {armFolderOf, fileNameOf, validationOfTheStandardSet} from '../harness.ts'
import {describeRecipe, steps} from './generic.ts'

// How many wrong code points a sample has, as the columns of the first table.
const wrongCountNames = ['none, a whole sample', '1', '2 or 3', '4 to 10', '11 or more'] as const
const wrongCountOf = (wrong: number) => wrong === 0 ? 0 : wrong === 1 ? 1 : wrong <= 3 ? 2 : wrong <= 10 ? 3 : 4
// A sample is almost right when it has 1 to 10 wrong code points.
const almostRight = (wrong: number) => wrong >= 1 && wrong <= 10
// The tokenizer states of a number and of a literal: every state but `between`, the six of a string and `errorLine`.
const statesOfNumbersAndLiterals = new Set(lexerStateNames.map((name, state) => ['between', 'string', 'escape', 'hex4', 'hex3', 'hex2', 'hex1', 'errorLine'].includes(name) ? -1 : state).filter(state => state !== -1))
const [kindNumber, kindLiteral, kindString, kindKey] = ['number', 'literal', 'string', 'key'].map(name => displayKindNames.indexOf(name)) as [number, number, number, number]
// Where a wrong code point is among the scored code points of its sample.
const placeNames = ['among the first 3 scored code points', 'among the last 3 scored code points', 'in between'] as const

export type WholeSampleCounts = {
  // Samples with something to recover, by how many of their scored code points are wrong.
  samples: number
  byWrongCount: number[]
  // Over the samples that are almost right: their wrong code points, by where they are, by the label that is wrong
  // (the display kind alone, the depth or the container alone, both), by the display kind that the label asks for,
  // and by the class of the code point.
  wrongCodePoints: number
  byPlace: number[]
  kindAloneWrong: number
  nestingAloneWrong: number
  bothWrong: number
  byLabelKind: number[]
  byClass: number[]
  // How many of them read a frozen tokenizer cell, e.g. (zero, e), at how many the tokenizer is in a state of a
  // number or of a literal before the code point, e.g. `zero` or `tr`, and at how many both hold.
  atFrozenTokenizerCell: number
  inNumberOrLiteralState: number
  inSuchAStateAtFrozenCell: number
  // How many of them are shown as a number, as a literal, and as one of the two where the label asks for a string
  // or a key, e.g. the `e` of the key `'env'` shown as a number.
  shownAsNumber: number
  shownAsLiteral: number
  wordShownAsNumberOrLiteral: number
  // Almost right samples in which every code point from the first wrong one to the last scored one is wrong.
  almostRightSamples: number
  wrongToTheEnd: number
  // Per kind of damage and per group: samples with something to recover, and whole ones.
  samplesOfKind: number[]
  wholeOfKind: number[]
  samplesOfGroup: number[]
  wholeOfGroup: number[]
  // Over every sample with something to recover: the scored code points, right or wrong, and how many of them come
  // while the tokenizer is in a state of a number or of a literal.
  scoredCodePoints: number
  scoredInNumberOrLiteralState: number
}

export function wholeSampleCountsOf(tables: RecoveryTables, samples: Samples): WholeSampleCounts {
  const counts: WholeSampleCounts = {
    samples: 0, byWrongCount: wrongCountNames.map(() => 0), wrongCodePoints: 0, byPlace: placeNames.map(() => 0), kindAloneWrong: 0, nestingAloneWrong: 0, bothWrong: 0,
    byLabelKind: displayKindNames.map(() => 0), byClass: Array.from({length: today.classCount}, () => 0), atFrozenTokenizerCell: 0, inNumberOrLiteralState: 0, inSuchAStateAtFrozenCell: 0,
    shownAsNumber: 0, shownAsLiteral: 0, wordShownAsNumberOrLiteral: 0, almostRightSamples: 0, wrongToTheEnd: 0,
    samplesOfKind: samples.kindNames.map(() => 0), wholeOfKind: samples.kindNames.map(() => 0), samplesOfGroup: groupNames.map(() => 0), wholeOfGroup: groupNames.map(() => 0),
    scoredCodePoints: 0, scoredInNumberOrLiteralState: 0,
  }
  const trace = createTrace()
  // The wrong code points of one sample: the position in the text, and the place among the sample's scored code points.
  const wrongPositions: number[] = []
  const wrongScoredPlaces: number[] = []
  for (let place = 0; place < samples.sampleCount; place++) {
    const scored = samples.scored[place]!
    if (samples.firstDamage[place] === -1 || scored === 0) continue
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    runOnSample(trace, samples, place, tables)
    wrongPositions.length = 0
    wrongScoredPlaces.length = 0
    let scoredPlace = 0
    for (let position = samples.firstErrorPosition[place]!; position < length; position++) {
      if ((samples.flags[start + position]! & (codePointKindScored | codePointNestingScored)) === 0) continue
      counts.scoredCodePoints++
      if (statesOfNumbersAndLiterals.has(trace.lexerStateBefore[position]!)) counts.scoredInNumberOrLiteralState++
      if (wrongLabelsAt(samples, start + position, trace, position) !== 0) {
        wrongPositions.push(position)
        wrongScoredPlaces.push(scoredPlace)
      }
      scoredPlace++
    }
    const wrong = wrongPositions.length
    counts.samples++
    counts.byWrongCount[wrongCountOf(wrong)]!++
    counts.samplesOfGroup[samples.group[place]!]!++
    if (wrong === 0) counts.wholeOfGroup[samples.group[place]!]!++
    for (let at = samples.kindStart[place]!; at < samples.kindStart[place + 1]!; at++) {
      counts.samplesOfKind[samples.kindList[at]!]!++
      if (wrong === 0) counts.wholeOfKind[samples.kindList[at]!]!++
    }
    if (!almostRight(wrong)) continue
    counts.almostRightSamples++
    if (scored - wrongScoredPlaces[0]! === wrong) counts.wrongToTheEnd++
    for (let index = 0; index < wrong; index++) {
      const position = wrongPositions[index]!
      const scoredAt = wrongScoredPlaces[index]!
      const wrongLabels = wrongLabelsAt(samples, start + position, trace, position)
      counts.wrongCodePoints++
      counts.byPlace[scoredAt < 3 ? 0 : scoredAt >= scored - 3 ? 1 : 2]!++
      const kindIsWrong = (wrongLabels & wrongKind) !== 0
      const nestingIsWrong = (wrongLabels & ~wrongKind) !== 0
      if (kindIsWrong && nestingIsWrong) counts.bothWrong++
      else if (kindIsWrong) counts.kindAloneWrong++
      else counts.nestingAloneWrong++
      const labelKind = samples.labelKind[start + position]!
      if (labelKind >= 0) counts.byLabelKind[labelKind]!++
      counts.byClass[today.classOfCodePoint[Math.min(samples.codePoints[start + position]! + 1, today.classOfCodePoint.length - 1)]!]!++
      const atFrozenCell = tables.lexerOpen[trace.lexerCell[position]!] === 0
      const inSuchAState = statesOfNumbersAndLiterals.has(trace.lexerStateBefore[position]!)
      if (atFrozenCell) counts.atFrozenTokenizerCell++
      if (inSuchAState) counts.inNumberOrLiteralState++
      if (inSuchAState && atFrozenCell) counts.inSuchAStateAtFrozenCell++
      const shownKind = trace.displayKind[position]!
      if (shownKind === kindNumber) counts.shownAsNumber++
      if (shownKind === kindLiteral) counts.shownAsLiteral++
      if ((shownKind === kindNumber || shownKind === kindLiteral) && (labelKind === kindString || labelKind === kindKey)) counts.wordShownAsNumberOrLiteral++
    }
  }
  return counts
}

if (import.meta.main) {
  refuseUnknownOptions('arms/generic/whole-samples.ts', ['--step', '--recipe'])
  const stepName = optionOf('--step') ?? 'passes-and-start'
  const step = steps[stepName]
  if (step === undefined) throw new Error(`arms/generic/whole-samples.ts needs --step with one of ${Object.keys(steps).join(', ')}, and got ${stepName}`)
  const recipe = step.recipes[Number(optionOf('--recipe') ?? 0)]
  if (recipe === undefined) throw new Error(`the step ${stepName} has the recipes 0 to ${step.recipes.length - 1}`)
  const validation = validationOfTheStandardSet()
  const folder = join(armFolderOf(step.armName), fileNameOf(describeRecipe(recipe)))
  const ofSeeds = step.seeds.map(seed => wholeSampleCountsOf(loadTablesOfThisDataset(join(folder, `seed-${seed}.tables.json`)).tables, validation))
  const ofHand = wholeSampleCountsOf(handwrittenTables().tables, validation)
  // The mean over the seeds of a count, and the same count of the hand-written tables.
  const mean = (value: (counts: WholeSampleCounts) => number) => ofSeeds.reduce((total, counts) => total + value(counts), 0) / ofSeeds.length
  const percent = (count: number, of: number) => of === 0 ? '-' : (100 * count / of).toFixed(1)
  const pair = (value: (counts: WholeSampleCounts) => number, of: (counts: WholeSampleCounts) => number) => `${percent(mean(value), mean(of))} | ${percent(value(ofHand), of(ofHand))}`

  console.log(`The recipe ${JSON.stringify(describeRecipe(recipe))}, the mean of the seeds ${step.seeds.join(', ')}, next to the hand-written tables. Validation split, ${ofHand.samples} samples with something to recover.`)
  console.log('')
  console.log('| wrong code points in a sample | the recipe, % of the samples | hand-written, % of the samples |')
  console.log('| --- | --- | --- |')
  wrongCountNames.forEach((name, index) => console.log(`| ${name} | ${pair(counts => counts.byWrongCount[index]!, counts => counts.samples)} |`))
  console.log('')
  console.log(`The samples with 1 to 10 wrong code points: ${mean(counts => counts.almostRightSamples).toFixed(0)} for the recipe with ${mean(counts => counts.wrongCodePoints).toFixed(0)} wrong code points, ${ofHand.almostRightSamples} for the hand-written tables with ${ofHand.wrongCodePoints}. Of those wrong code points, ${mean(counts => counts.wordShownAsNumberOrLiteral).toFixed(0)} and ${ofHand.wordShownAsNumberOrLiteral} have a label of the display kind string or key and are shown as a number or as a literal.`)
  console.log('')
  console.log('| of the wrong code points of those samples | the recipe, % | hand-written, % |')
  console.log('| --- | --- | --- |')
  placeNames.forEach((name, index) => console.log(`| ${name} | ${pair(counts => counts.byPlace[index]!, counts => counts.wrongCodePoints)} |`))
  console.log(`| the display kind alone is wrong | ${pair(counts => counts.kindAloneWrong, counts => counts.wrongCodePoints)} |`)
  console.log(`| the depth or the container alone is wrong | ${pair(counts => counts.nestingAloneWrong, counts => counts.wrongCodePoints)} |`)
  console.log(`| both are wrong | ${pair(counts => counts.bothWrong, counts => counts.wrongCodePoints)} |`)
  displayKindNames.forEach((name, index) => {
    if (mean(counts => counts.byLabelKind[index]!) > 0 || ofHand.byLabelKind[index]! > 0) console.log(`| the label's display kind is ${name} | ${pair(counts => counts.byLabelKind[index]!, counts => counts.wrongCodePoints)} |`)
  })
  const classesByCount = classNames.map((name, index) => ({name, index})).sort((left, right) => mean(counts => counts.byClass[right.index]!) - mean(counts => counts.byClass[left.index]!)).slice(0, 8)
  for (const {name, index} of classesByCount) console.log(`| the code point's class is ${name} | ${pair(counts => counts.byClass[index]!, counts => counts.wrongCodePoints)} |`)
  console.log(`| the code point is shown as a number | ${pair(counts => counts.shownAsNumber, counts => counts.wrongCodePoints)} |`)
  console.log(`| the code point is shown as a literal | ${pair(counts => counts.shownAsLiteral, counts => counts.wrongCodePoints)} |`)
  console.log(`| the label's display kind is string or key, and the code point is shown as a number or as a literal | ${pair(counts => counts.wordShownAsNumberOrLiteral, counts => counts.wrongCodePoints)} |`)
  console.log(`| the tokenizer is in a state of a number or of a literal before the code point | ${pair(counts => counts.inNumberOrLiteralState, counts => counts.wrongCodePoints)} |`)
  console.log(`| in such a state, and the code point reads a frozen tokenizer cell | ${pair(counts => counts.inSuchAStateAtFrozenCell, counts => counts.wrongCodePoints)} |`)
  console.log(`| the code point reads a frozen tokenizer cell | ${pair(counts => counts.atFrozenTokenizerCell, counts => counts.wrongCodePoints)} |`)
  console.log(`| samples in which every code point from the first wrong one on is wrong, % of those samples | ${pair(counts => counts.wrongToTheEnd, counts => counts.almostRightSamples)} |`)
  console.log('')
  console.log(`Of all scored code points, right or wrong, the tokenizer is in a state of a number or of a literal before ${percent(mean(counts => counts.scoredInNumberOrLiteralState), mean(counts => counts.scoredCodePoints))}% for the recipe and before ${percent(ofHand.scoredInNumberOrLiteralState, ofHand.scoredCodePoints)}% for the hand-written tables.`)
  console.log('')
  console.log('Whole samples per group, in percent of the group\'s samples with something to recover:')
  console.log('')
  console.log('| group | samples | the recipe | hand-written |')
  console.log('| --- | --- | --- | --- |')
  ;[...groupNames].reverse().forEach(name => {
    const index = groupNames.indexOf(name)
    console.log(`| ${name} | ${ofHand.samplesOfGroup[index]} | ${pair(counts => counts.wholeOfGroup[index]!, counts => counts.samplesOfGroup[index]!)} |`)
  })
  console.log('')
  console.log('Whole samples per kind of damage, from the kind with the most whole samples lost against the hand-written tables to the one with the most gained:')
  console.log('')
  console.log('| kind | samples | whole with the recipe, % | whole with the hand-written tables, % | whole samples lost |')
  console.log('| --- | --- | --- | --- | --- |')
  const lostOfKind = validation.kindNames.map((name, index) => ({name, index, lost: ofHand.wholeOfKind[index]! - mean(counts => counts.wholeOfKind[index]!)})).filter(kind => ofHand.samplesOfKind[kind.index]! > 0).sort((left, right) => right.lost - left.lost)
  for (const {name, index, lost} of lostOfKind) console.log(`| ${name} | ${ofHand.samplesOfKind[index]} | ${pair(counts => counts.wholeOfKind[index]!, counts => counts.samplesOfKind[index]!)} | ${lost.toFixed(1)} |`)
}
