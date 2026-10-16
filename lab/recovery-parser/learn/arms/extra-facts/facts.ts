// What the scripts of the arm "extra facts" share: the additions to the tables, the two ways to choose character
// classes, the trainer's settings, the target "an added code point is shown as an error", and the display entries
// set by a count. README.md says what the arm asks and what it found.
//
// Today's tables decide by the class of a character, the tokenizer state, the token and the context. An addition
// gives them one more thing to decide by, see ../../structure/README.md:
// - character classes: code points that get a class of their own, e.g. the apostrophe, which is in one class with
//   most letters today,
// - open entries of the display table: what is shown for an event and the grammar state after it may change where no
//   text reads the entry before its first error,
// - the bit "first on its line": the grammar reads whether a token is the first on its line.
import {join} from 'node:path'
import {displayKind} from '../../../labels.ts'
import {createRandom} from '../../../random.ts'
import {type Samples, codePointKept, codePointKindScored, codePointNestingScored} from '../../data.ts'
import {createTrace} from '../../recovery-parser.ts'
import {
  type AddedClass, type RecoveryTables, addClasses, addFirstOnLineBit, asIsTables, className, copyTables, displayEntryOf, displayKindCount, eventNames, loadTablesOfThisDataset, openDisplayEntries, today,
} from '../../recovery-tables.ts'
import {runOnSample} from '../../score.ts'
import {train} from '../../soft/train.ts'
import {type TwinData, createModel} from '../../soft/twin.ts'
import {armFolderOf, fileNameOf} from '../harness.ts'

// What the arm sets of the trainer of ../../soft/train.ts. Everything else is the trainer's default.
export type TrainerSetting = {
  // Passes over the train samples.
  passes: number
  // 'base': the mix of a trainable cell starts with a share of 0.9 on the choice that the cell holds in the base.
  // 'uniform': every choice of a trainable cell starts with the same share.
  start: 'base' | 'uniform'
  learningRate: number
  // The temperature of the mixes at the last sample. It starts at 1.
  temperatureEnd: number
  // The weight of the cost on a mix being far from one choice.
  sharpnessCost: number
}

// The trainer's settings that run.ts takes by name, as `--trainer <name>`. `plain` is the plain pass of
// ../plain-pass/, and `three-uniform` is the setting of ../holes/: the two that every setting of the arm ran with.
// `three-base` and `one-uniform` are the two other pairs of their passes and their starts, which say whether a
// difference between the two comes from the passes or from the start. A tuned setting gets a line here.
export const trainerSettings: Record<string, TrainerSetting> = {
  'plain': {passes: 1, start: 'base', learningRate: 0.05, temperatureEnd: 1, sharpnessCost: 0},
  'three-uniform': {passes: 3, start: 'uniform', learningRate: 0.05, temperatureEnd: 1, sharpnessCost: 0},
  'three-base': {passes: 3, start: 'base', learningRate: 0.05, temperatureEnd: 1, sharpnessCost: 0},
  'one-uniform': {passes: 1, start: 'uniform', learningRate: 0.05, temperatureEnd: 1, sharpnessCost: 0},
}
export const describeTrainerSetting = (setting: TrainerSetting) =>
  `${setting.passes} pass${setting.passes === 1 ? '' : 'es'}, ${setting.start === 'base' ? 'start at the base\'s choices' : 'uniform start'}, learning rate ${setting.learningRate}, temperature 1 to ${setting.temperatureEnd}, sharpness cost ${setting.sharpnessCost}`
// The seeds of every reported run, and the seeds of the confirmation. The row with the most of all three, the setting
// `all` with the trainer's setting `three-base`, was added after the validation scores of the reported seeds were
// seen, so it ran again with seeds that it had not been run with, next to its control and next to the same two
// settings with `plain`.
export const reportedSeeds: readonly number[] = [1, 2, 3, 4, 5]
export const confirmationSeeds: readonly number[] = [11, 12, 13, 14, 15]
// Every trainer's setting is an arm of its own for the harness, e.g. "extra-facts-plain", so that two of them can be
// kept next to each other: a run of the harness moves the files of an earlier run of the same name away. For the same
// reason a run with other seeds than the reported ones is an arm of its own, e.g.
// "extra-facts-three-base-seeds-11-12-13-14-15".
export const armNameOf = (trainerName: string, seeds: readonly number[] = reportedSeeds) =>
  `extra-facts-${trainerName}${seeds.join(' ') === reportedSeeds.join(' ') ? '' : `-seeds-${seeds.join('-')}`}`

// The classes chosen by hand: a class for every character that the dataset's descriptions of the damage name as one
// that the tokenizer must tell apart, see `needsClass` in ../../../README.md and in ../../../damage/. The choice saw
// those descriptions, which a rule that reads samples does not get. In the order of how many train samples of the
// standard set the dataset says need the class, from 1,596 for the apostrophe to 6 for the star. Not in the list: "a
// colon inside a value without quotes", 18 samples, since the colon has a class of its own already.
export const classesChosenByHand: readonly AddedClass[] = [
  {name: 'apostrophe', codePoints: [0x27]},
  {name: 'openParenthesis', codePoints: [0x28]},
  {name: 'closeParenthesis', codePoints: [0x29]},
  {name: 'noBreakSpace', codePoints: [0xa0]},
  {name: 'openCurlyQuote', codePoints: [0x201c]},
  {name: 'closeCurlyQuote', codePoints: [0x201d]},
  {name: 'equalsSign', codePoints: [0x3d]},
  {name: 'carriageReturn', codePoints: [0x0d]},
  {name: 'letterX', codePoints: [0x78]},
  {name: 'hash', codePoints: [0x23]},
  {name: 'semicolon', codePoints: [0x3b]},
  {name: 'ampersand', codePoints: [0x26]},
  {name: 'letterM', codePoints: [0x6d]},
  {name: 'backtick', codePoints: [0x60]},
  {name: 'star', codePoints: [0x2a]},
]

// The name of a class for one code point: the name of the hand-chosen class of that code point, or e.g. "U+FEFF".
export const classNameOfCodePoint = (codePoint: number) =>
  classesChosenByHand.find(({codePoints}) => codePoints.length === 1 && codePoints[0] === codePoint)?.name ?? `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`

// What a code point after a first error is, for the rule below: the event that today's parser has at its counterpart
// in the original, e.g. `stringStart` for an apostrophe that stands for a quote, or "added" when the damage added it.
export const outcomeNames: readonly string[] = [...eventNames, 'added']

// One code point of the train samples, as the rule below sees it.
export type CodePointOfTheRule = {
  codePoint: number
  // The class that the code point has today, by its number.
  classToday: number
  // How often the code point comes at or after a first error, and in how many train samples.
  occurrences: number
  samples: number
  // The shares of its outcomes, in the order of outcomeNames, and of the outcomes of the other code points of its class.
  shares: number[]
  sharesOfTheRest: number[]
  // The total variation distance of the two: the share of the code point's occurrences that would have to be
  // something else for the code point to be as the rest of its class, from 0 to 1.
  distance: number
  picked: boolean
}

// The two thresholds of the rule. They were set with the ranking of the train split in view and before any score.
export const leastSamplesOfTheRule = 100
export const leastDistanceOfTheRule = 0.5

// The rule that chooses classes from the train samples alone. For every code point at or after a first error it
// counts what the code point is: the event at its counterpart in the original, or "added". A code point gets a class
// of its own when at least 100 train samples have it there and its outcomes are far from the outcomes of the other
// code points of its class: a distance of 0.5 or more, i.e. half of its occurrences would have to be something else.
// E.g. the apostrophe is 48% the start of a string and 48% the end of one, where the rest of the class `other` is
// 85% the content of a string. Returns every code point that at least 100 train samples have, from the largest
// distance down.
export function codePointsOfTheRule(trainSamples: Samples): CodePointOfTheRule[] {
  const lastClassEntry = today.classOfCodePoint.length - 1
  const classOf = (codePoint: number) => today.classOfCodePoint[Math.min(codePoint + 1, lastClassEntry)]!
  const countsOfCodePoint = new Map<number, {outcomes: Float64Array, samples: number, lastSample: number}>()
  const countsOfClass = Array.from({length: today.classCount}, () => new Float64Array(outcomeNames.length))
  for (let place = 0; place < trainSamples.sampleCount; place++) {
    if (trainSamples.firstDamage[place] === -1) continue
    const start = trainSamples.start[place]!
    const length = trainSamples.start[place + 1]! - start
    for (let position = trainSamples.firstErrorPosition[place]!; position < length; position++) {
      const codePoint = trainSamples.codePoints[start + position]!
      const outcome = (trainSamples.flags[start + position]! & codePointKept) !== 0 ? trainSamples.intendedEvent[start + position]! : eventNames.length
      let counts = countsOfCodePoint.get(codePoint)
      if (counts === undefined) {
        counts = {outcomes: new Float64Array(outcomeNames.length), samples: 0, lastSample: -1}
        countsOfCodePoint.set(codePoint, counts)
      }
      counts.outcomes[outcome]!++
      countsOfClass[classOf(codePoint)]![outcome]!++
      if (counts.lastSample !== place) {
        counts.lastSample = place
        counts.samples++
      }
    }
  }
  const total = (counts: Float64Array) => counts.reduce((sum, count) => sum + count, 0)
  const result: CodePointOfTheRule[] = []
  for (const [codePoint, counts] of countsOfCodePoint) {
    if (counts.samples < leastSamplesOfTheRule) continue
    const occurrences = total(counts.outcomes)
    const rest = countsOfClass[classOf(codePoint)]!.map((count, outcome) => count - counts.outcomes[outcome]!)
    const occurrencesOfTheRest = total(rest)
    // A code point that is alone in its class has nothing to be told apart from.
    if (occurrencesOfTheRest === 0) continue
    const shares = Array.from(counts.outcomes, count => count / occurrences)
    const sharesOfTheRest = Array.from(rest, count => count / occurrencesOfTheRest)
    const distance = shares.reduce((sum, share, outcome) => sum + Math.abs(share - sharesOfTheRest[outcome]!), 0) / 2
    result.push({codePoint, classToday: classOf(codePoint), occurrences, samples: counts.samples, shares, sharesOfTheRest, distance, picked: distance >= leastDistanceOfTheRule})
  }
  return result.sort((left, right) => right.distance - left.distance || left.codePoint - right.codePoint)
}

// The classes that the rule chooses: one class per picked code point.
export const classesChosenFromTrainSamples = (trainSamples: Samples): AddedClass[] =>
  codePointsOfTheRule(trainSamples).filter(entry => entry.picked).map(({codePoint}) => ({name: classNameOfCodePoint(codePoint), codePoints: [codePoint]}))

// The name of today's class of a code point of the rule, e.g. "other".
export const classTodayNameOf = (entry: CodePointOfTheRule) => className(asIsTables(), entry.classToday)

// What a setting adds to today's tables.
export type Additions = {classes: readonly AddedClass[], displayEntries: boolean, firstOnLineBit: boolean}

// Today's tables with the additions: the base of a run, a new copy on every call.
export function baseOf(additions: Additions): RecoveryTables {
  let base = asIsTables()
  if (additions.classes.length > 0) base = addClasses(base, additions.classes)
  if (additions.displayEntries) base = openDisplayEntries(base)
  if (additions.firstOnLineBit) base = addFirstOnLineBit(base)
  return base
}

// The settings of the arm, by the key that run.ts takes in `--settings`, with the name of the setting's row.
// `errorTargetShare` is the weight of the target "an added code point is shown as an error", see withErrorTarget.
// `displayByCount` is the setting without gradients: the tables of the setting "none" of the same seed, with the open
// display entries set by a count, see displayEntriesByCount.
export type SettingOfTheArm = {key: string, name: string, classes: 'none' | 'hand' | 'train samples', displayEntries: boolean, firstOnLineBit: boolean, errorTargetShare?: number, displayByCount?: true}
export const settingsOfTheArm: readonly SettingOfTheArm[] = [
  {key: 'none', name: 'no addition', classes: 'none', displayEntries: false, firstOnLineBit: false},
  {key: 'classes-hand', name: 'classes chosen by hand', classes: 'hand', displayEntries: false, firstOnLineBit: false},
  {key: 'classes-data', name: 'classes chosen from the train samples', classes: 'train samples', displayEntries: false, firstOnLineBit: false},
  {key: 'display', name: 'open display entries', classes: 'none', displayEntries: true, firstOnLineBit: false},
  {key: 'display-counted', name: 'no addition, then the open display entries by a count', classes: 'none', displayEntries: true, firstOnLineBit: false, displayByCount: true},
  {key: 'error-target-0.1', name: 'open display entries, added code points as an error at the weight 0.1', classes: 'none', displayEntries: true, firstOnLineBit: false, errorTargetShare: 0.1},
  {key: 'error-target-0.3', name: 'open display entries, added code points as an error at the weight 0.3', classes: 'none', displayEntries: true, firstOnLineBit: false, errorTargetShare: 0.3},
  {key: 'error-target-1', name: 'open display entries, added code points as an error at the weight 1', classes: 'none', displayEntries: true, firstOnLineBit: false, errorTargetShare: 1},
  {key: 'error-target-0.3-alone', name: 'added code points as an error at the weight 0.3', classes: 'none', displayEntries: false, firstOnLineBit: false, errorTargetShare: 0.3},
  {key: 'bit', name: 'the bit first on its line', classes: 'none', displayEntries: false, firstOnLineBit: true},
  {key: 'all', name: 'classes chosen by hand, open display entries and the bit', classes: 'hand', displayEntries: true, firstOnLineBit: true},
  {key: 'all-data', name: 'classes chosen from the train samples, open display entries and the bit', classes: 'train samples', displayEntries: true, firstOnLineBit: true},
]
export const settingOfKey = (key: string): SettingOfTheArm => {
  const setting = settingsOfTheArm.find(candidate => candidate.key === key)
  if (setting === undefined) throw new Error(`the arm has no setting ${JSON.stringify(key)}. Its settings: ${settingsOfTheArm.map(candidate => candidate.key).join(', ')}`)
  return setting
}
export const additionsOf = (setting: SettingOfTheArm, classesFromTrainSamples: readonly AddedClass[]): Additions =>
  ({classes: setting.classes === 'hand' ? classesChosenByHand : setting.classes === 'train samples' ? classesFromTrainSamples : [], displayEntries: setting.displayEntries, firstOnLineBit: setting.firstOnLineBit})

// Trains every open cell and every open entry of `base` on the samples of `data` and returns the last snapped
// tables. The model is made here, once per call: `train` changes the model that it is given.
export async function trainTables(base: RecoveryTables, data: TwinData, seed: number, setting: TrainerSetting): Promise<RecoveryTables> {
  const model = createModel(base, {start: setting.start})
  const result = await train(model, data, {
    seed, epochs: setting.passes, learningRate: setting.learningRate, temperatureStart: 1, temperatureEnd: setting.temperatureEnd, sharpnessCost: setting.sharpnessCost,
    logEverySamples: 1e9, log: () => {},
  })
  return result.last
}

// The random stream of the draws of withErrorTarget. The trainer orders the samples of its pass p with the stream p
// of the same seed, so the draws have a stream that no pass uses.
const streamOfTheErrorTarget = 2_000_000

// The packed train samples with one more target: a code point that the damage added, at or after the first error,
// has the display kind `error` as its label. Such a code point has no label in the dataset and no score counts it.
//
// The trainer's loss has no weight per code point, so the weight is a share: every added code point gets the target
// with the probability `share`, drawn from the seed. With the share 1 every added code point has it. The loss is
// divided by the number of code points with a target, the added ones among them. Only the flags and the display
// kinds are new arrays, and `data` is not changed.
export function withErrorTarget(data: TwinData, share: number, seed: number): TwinData {
  if (!(share > 0 && share <= 1)) throw new Error(`the weight of the error target is a share above 0 and up to 1, and got ${share}`)
  const flags = new Uint8Array(new SharedArrayBuffer(data.flags.length))
  const labelKind = new Int8Array(new SharedArrayBuffer(data.labelKind.length))
  flags.set(data.flags)
  labelKind.set(data.labelKind)
  const random = createRandom(seed, streamOfTheErrorTarget)
  for (let place = 0; place < data.sampleCount; place++) {
    const start = data.start[place]!
    const length = data.start[place + 1]! - start
    const firstError = data.firstError[place]!
    if (firstError < 0) continue
    for (let position = firstError; position < length; position++) {
      const at = start + position
      if ((flags[at]! & codePointKept) !== 0 || random.next() >= share) continue
      flags[at] = flags[at]! | codePointKindScored
      labelKind[at] = displayKind.error
    }
  }
  return {...data, flags, labelKind}
}

// A copy of `tables` with open display entries, each set to the display kind that the most code points of the train
// samples want there: the scored code points that read the entry with `tables`, whose label has that kind, and whose
// depth and container are right or not scored. An entry that no such code point reads keeps its kind.
//
// What is shown changes nothing that the parser does next, so for these cells of the tokenizer and of the grammar no
// other display table has more scored code points of the train split with all three right. It is the comparison
// without gradients for the display entries: no search, one count.
export function displayEntriesByCount(tables: RecoveryTables, trainSamples: Samples): RecoveryTables {
  const result = openDisplayEntries(tables)
  const wanted = new Int32Array(result.display.length * displayKindCount)
  const trace = createTrace()
  for (let place = 0; place < trainSamples.sampleCount; place++) {
    if (trainSamples.firstDamage[place] === -1) continue
    const start = trainSamples.start[place]!
    const length = trainSamples.start[place + 1]! - start
    runOnSample(trace, trainSamples, place, result)
    for (let position = trainSamples.firstErrorPosition[place]!; position < length; position++) {
      const flags = trainSamples.flags[start + position]!
      if ((flags & codePointKindScored) === 0) continue
      const nestingRight = (flags & codePointNestingScored) === 0
        || (trace.depthAfter[position] === trainSamples.labelDepth[start + position] && trace.containerAfter[position] === trainSamples.labelContainer[start + position])
      if (nestingRight) wanted[displayEntryOf(result, trace.event[position]!, trace.grammarAfter[position]!) * displayKindCount + trainSamples.labelKind[start + position]!]!++
    }
  }
  for (let entry = 0; entry < result.display.length; entry++) {
    if (result.displayOpen[entry] !== 1) continue
    let best = result.display[entry]!
    for (let kind = 0; kind < displayKindCount; kind++) if (kind !== displayKind.pastEnd && wanted[entry * displayKindCount + kind]! > wanted[entry * displayKindCount + best]!) best = kind
    result.display[entry] = best
  }
  return result
}

// The arm's name for the harness and the settings' names of search-display.ts, the comparison without gradients for
// the open display entries. `inTurns` is the search and the count in turns with the most read cells first, which has
// no seed. The three others are in the random order of a seed: the search alone, the search with one count after
// it, and the search and the count in turns.
export const armNameOfTheSearch = 'extra-facts-search'
export const settingNamesOfTheSearch = {
  inTurns: 'search from the hand-written tables and the display entries by a count, in turns',
  randomOrderAlone: 'search from the hand-written tables in a random order',
  randomOrderThenCount: 'search from the hand-written tables in a random order, then the open display entries by a count',
  randomOrderInTurns: 'search from the hand-written tables in a random order and the display entries by a count, in turns',
}

// The tables that the harness saved for the setting `settingName` and a seed, in the run of the arm `armName`, e.g.
// armNameOf('plain') or armNameOfTheSearch.
export const savedTablesOf = (armName: string, settingName: string, seed: number): RecoveryTables =>
  copyTables(loadTablesOfThisDataset(join(armFolderOf(armName), fileNameOf(settingName), `seed-${seed}.tables.json`)).tables)
