// The trainable twin of the recovery parser: the same step as recovery-parser.ts, with every state as one number per
// possibility instead of one index, and every table cell as a mix over its choices instead of one choice.
//
// - The tokenizer state is 26 shares, the grammar state 8, the depth one share per depth of a range, and every level
//   1 to 16 of the stack holds the share of "this level is an object". With tables of 16 contexts, one more share is
//   the bit "the token is the first on its line".
// - A cell holds a mix: a share per choice. A tokenizer cell has a mix over its next state and a mix over its event. A
//   grammar cell has a mix over its next state and a mix over its stack action. A cell that is not trained holds its
//   one choice as exact 0 and 1. An open entry of the display table holds a mix over the display kinds, and every
//   other entry is read from the table.
// - A step multiplies shares and adds the products, see stepForward. With exact tables every share is exactly 0 or 1,
//   and the twin is the exact parser: check-twin.ts compares the two. step-circuit.ts builds the same step as a
//   Handwired circuit, and check-circuit.ts compares the two.
//
// The twin starts at a text's first error with the exact parser's state, since every cell that a text reads before its
// first error is frozen. The loss is the cross-entropy of the display kind, the depth and the container against the
// labels, at the code points that a score counts: from the first error on, each value of a label that is scored. The
// backward pass is written by hand, see stepBackward, and check-gradient.ts compares it with finite differences.
//
// README.md of this folder says where treating the parts of the state as independent loses information.
import {createRandom} from '../../random.ts'
import {capacity, containerArray, containerNone, containerObject, maximumDepth, positionCount} from '../recovery-parser.ts'
import {
  type RecoveryTables, actionByToken, actionCount, actionNone, actionOfToken, actionPop, actionPushArray, actionPushObject, classNames, copyTables, displayKindCount, displayKindNames, today, tokenNames,
} from '../recovery-tables.ts'

// The bits of TwinData.flags, as in data.ts.
const codePointKindScored = 2
const codePointCanFollow = 8
const codePointNestingScored = 16

const classLineFeed = classNames.indexOf('lineFeed')
const tokenNone = tokenNames.indexOf('none')
// The contexts of tables without the bit "first on its line": 8. With the bit there are 16, and context + 8 is the
// context of a token that is the first on its line.
const contextsWithoutBit = today.contextCount

// A short text that stands for the class table of some tables: two tables give every code point the same class when
// their keys are the same. It is a 64-bit hash of the table, so that the samples and the twin can each carry it, and
// not the table itself, which has 8,224 entries once a class holds a curly quote. Two lists of added classes with
// the same number of classes have other keys, e.g. a class for the apostrophe and a class for #.
export const classTableKeyOf = (tables: RecoveryTables) => Bun.hash(tables.classOfCodePoint).toString(16)

// The sizes and the fixed tables of a set of tables, which is all a step needs besides the cells' mixes.
export type TwinShape = {
  classCount: number
  // The key of the tables' class table, see classTableKeyOf. A run compares it with the key of its samples.
  classTable: string
  lexerStateCount: number
  eventCount: number
  tokenCount: number
  contextCount: number
  grammarStateCount: number
  displayKindCount: number
  lexerCells: number
  grammarCells: number
  displayEntries: number
  // tokenOfEvent[event], and display[event × grammarStateCount + grammar state after], as in RecoveryTables.
  tokenOfEvent: Uint8Array
  display: Uint8Array
  // 1 where an entry of the display table is open. A step reads the display kind of such an entry from the entry's
  // mix, and of every other entry from `display`.
  displayMixed: Uint8Array
}

export function shapeOf(tables: RecoveryTables): TwinShape {
  if (tables.contextCount !== contextsWithoutBit && tables.contextCount !== 2 * contextsWithoutBit) throw new Error(`the twin is written for ${contextsWithoutBit} contexts, or ${2 * contextsWithoutBit} with the bit "first on its line", and these tables have ${tables.contextCount}`)
  return {
    classCount: tables.classCount, classTable: classTableKeyOf(tables), lexerStateCount: tables.lexerStateCount, eventCount: tables.eventCount, tokenCount: tables.tokenCount,
    contextCount: tables.contextCount, grammarStateCount: tables.grammarStateCount, displayKindCount,
    lexerCells: tables.lexerStateCount * tables.classCount, grammarCells: tables.grammarStateCount * tables.tokenCount * tables.contextCount, displayEntries: tables.display.length,
    tokenOfEvent: tables.tokenOfEvent.slice(), display: tables.display.slice(), displayMixed: tables.displayOpen.slice(),
  }
}

// One number per choice of every cell, in five groups: the tokenizer cells' next states [cell × lexerStateCount + next
// state] and events [cell × eventCount + event], the grammar cells' next states [cell × grammarStateCount + next
// state] and stack actions [cell × 5 + action], and the display kinds of the display table's entries [entry × 9 +
// display kind]. The same layout holds the trainable weights, the mixes and the gradients. `all` is the five groups
// one after another, e.g. for Adam, and the other fields are views of its parts.
export type CellArrays = {
  all: Float64Array
  lexerNext: Float64Array
  lexerEvent: Float64Array
  grammarNext: Float64Array
  grammarAction: Float64Array
  display: Float64Array
}

export const groupNames = ['lexerNext', 'lexerEvent', 'grammarNext', 'grammarAction', 'display'] as const
export type GroupName = typeof groupNames[number]

// How many numbers each group holds per cell.
export const groupWidths = (shape: TwinShape): Record<GroupName, number> =>
  ({lexerNext: shape.lexerStateCount, lexerEvent: shape.eventCount, grammarNext: shape.grammarStateCount, grammarAction: actionCount, display: shape.displayKindCount})

export const cellArraysLength = (shape: TwinShape) =>
  shape.lexerCells * (shape.lexerStateCount + shape.eventCount) + shape.grammarCells * (shape.grammarStateCount + actionCount) + shape.displayEntries * shape.displayKindCount

// New arrays of zeros, or views of `buffer`, e.g. of a SharedArrayBuffer that a worker thread also holds.
export function createCellArrays(shape: TwinShape, buffer: ArrayBufferLike = new ArrayBuffer(8 * cellArraysLength(shape))): CellArrays {
  const lengths = [shape.lexerCells * shape.lexerStateCount, shape.lexerCells * shape.eventCount, shape.grammarCells * shape.grammarStateCount, shape.grammarCells * actionCount, shape.displayEntries * shape.displayKindCount]
  let offset = 0
  const view = (group: number) => {
    const values = new Float64Array(buffer, 8 * offset, lengths[group])
    offset += lengths[group]!
    return values
  }
  return {all: new Float64Array(buffer, 0, cellArraysLength(shape)), lexerNext: view(0), lexerEvent: view(1), grammarNext: view(2), grammarAction: view(3), display: view(4)}
}

// The tables with trainable cells. A cell that is not trainable holds the choice of `base`, e.g. today's tables, or
// tables with a hand-written recovery. A trainable cell's mix over the choices of a group is the softmax of the
// group's weights for that cell, divided by a temperature.
export type TwinModel = {
  base: RecoveryTables
  shape: TwinShape
  // 1 where a cell or an entry of the display table is trainable. Only open ones can be.
  trainableLexer: Uint8Array
  trainableGrammar: Uint8Array
  trainableDisplay: Uint8Array
  weights: CellArrays
}

// Which cells of one table are trainable: a mask with 1 per trainable cell, 'open' for every open cell, or 'none'.
// A mask is a Uint8Array with one entry per cell of the table, 1 for a trainable cell and 0 for every other one,
// e.g. a copy of `base.grammarOpen` with some entries set to 0. Only an open cell may be trainable.
export type TrainableCells = Uint8Array | 'open' | 'none'

export type ModelOptions = {
  // The trainable cells of the tokenizer's table, of the grammar's table, and the trainable entries of the display
  // table, e.g. {lexer: 'none', grammar: 'open', display: 'none'} for a run that trains grammar cells only. Without
  // `trainable`, every open cell and every open entry is trainable. With it, all three have to be named: createModel
  // throws when one is missing, so that no table is trained without a word.
  trainable?: {lexer: TrainableCells, grammar: TrainableCells, display: TrainableCells}
  // Where the weights start. 'base': every trainable mix gives `startShare` to the choice of the base tables and
  // splits the rest evenly over the other choices. 'uniform': every choice of a trainable mix has the same share.
  start?: 'base' | 'uniform'
  // From 0 to 1, both excluded. The default is 0.9.
  startShare?: number
}

// The display kind that no mix of an open entry holds: the kind of the cells after a text's end. Its share is 0 for
// every weight.
const kindLeftOut = displayKindNames.indexOf('pastEnd')

// Per group: its width, the mask of trainable cells, the base tables' choices, and a choice that the group's mixes
// leave out, or -1.
function groupsOf(model: TwinModel) {
  const widths = groupWidths(model.shape)
  return [
    {name: 'lexerNext', width: widths.lexerNext, trainable: model.trainableLexer, choice: model.base.lexerNext, leftOut: -1},
    {name: 'lexerEvent', width: widths.lexerEvent, trainable: model.trainableLexer, choice: model.base.lexerEvent, leftOut: -1},
    {name: 'grammarNext', width: widths.grammarNext, trainable: model.trainableGrammar, choice: model.base.grammarNext, leftOut: -1},
    {name: 'grammarAction', width: widths.grammarAction, trainable: model.trainableGrammar, choice: model.base.grammarAction, leftOut: -1},
    {name: 'display', width: widths.display, trainable: model.trainableDisplay, choice: model.base.display, leftOut: kindLeftOut},
  ] as const
}

// The mask of trainable cells that a group's weights belong to.
export const trainableOf = (model: TwinModel, group: GroupName) => group === 'display' ? model.trainableDisplay : group === 'lexerNext' || group === 'lexerEvent' ? model.trainableLexer : model.trainableGrammar

export function createModel(base: RecoveryTables, options: ModelOptions = {}): TwinModel {
  const shape = shapeOf(base)
  // The mask of one table. With `trainable` given, a table that it does not name is an error: a missing mask used to
  // mean "every open one", which trained e.g. every open entry of the display table without a word.
  const maskOf = (table: 'lexer' | 'grammar' | 'display', open: Uint8Array) => {
    if (options.trainable === undefined) return open.slice()
    const chosen = (options.trainable as Partial<Record<typeof table, TrainableCells>>)[table]
    if (chosen === undefined) throw new Error(`createModel got \`trainable\` without \`${table}\`: name all three of lexer, grammar and display, each as a mask, 'open' or 'none'`)
    if (chosen === 'open') return open.slice()
    if (chosen === 'none') return new Uint8Array(open.length)
    if (!(chosen instanceof Uint8Array)) throw new Error(`createModel got \`trainable.${table}\` that is no mask, 'open' or 'none'`)
    // A mask holds 1 for a trainable cell and 0 for every other one. Another number, e.g. 2, used to make a cell that
    // the trainer never steps and whose mix is uniform all the same.
    const bad = chosen.findIndex(entry => entry !== 0 && entry !== 1)
    if (bad !== -1) throw new Error(`createModel got \`trainable.${table}\` with ${chosen[bad]} at entry ${bad}: a mask holds 1 for a trainable cell and 0 for every other cell`)
    return chosen.slice()
  }
  const trainableLexer = maskOf('lexer', base.lexerOpen)
  const trainableGrammar = maskOf('grammar', base.grammarOpen)
  const trainableDisplay = maskOf('display', base.displayOpen)
  if (trainableLexer.length !== shape.lexerCells || trainableGrammar.length !== shape.grammarCells || trainableDisplay.length !== shape.displayEntries) throw new Error('the masks of trainable cells do not have one entry per cell')
  for (let cell = 0; cell < shape.lexerCells; cell++) if (trainableLexer[cell] === 1 && base.lexerOpen[cell] === 0) throw new Error(`the tokenizer cell ${cell} is frozen, and cannot be trainable`)
  for (let cell = 0; cell < shape.grammarCells; cell++) if (trainableGrammar[cell] === 1 && base.grammarOpen[cell] === 0) throw new Error(`the grammar cell ${cell} is frozen, and cannot be trainable`)
  for (let entry = 0; entry < shape.displayEntries; entry++) if (trainableDisplay[entry] === 1 && base.displayOpen[entry] === 0) throw new Error(`the entry ${entry} of the display table is not open, and cannot be trainable`)
  const model: TwinModel = {base: copyTables(base), shape, trainableLexer, trainableGrammar, trainableDisplay, weights: createCellArrays(shape)}
  const startShare = options.startShare ?? 0.9
  if (!(startShare > 0 && startShare < 1)) throw new Error(`startShare has to be between 0 and 1, and is ${startShare}`)
  if ((options.start ?? 'base') === 'base') {
    for (const group of groupsOf(model)) {
      // softmax gives the base choice the share s when its weight is ln(s / (1 - s) × (choices - 1)) and the others are 0.
      const choices = group.leftOut === -1 ? group.width : group.width - 1
      const weight = Math.log(startShare / (1 - startShare) * (choices - 1))
      for (let cell = 0; cell < group.trainable.length; cell++) if (group.trainable[cell] === 1) model.weights[group.name][cell * group.width + group.choice[cell]!] = weight
    }
  }
  return model
}

// Writes every cell's mix into `mixes`: softmax(weights / temperature) for a trainable cell, and exact 0 and 1 for
// every other cell. A choice that a group leaves out has the share 0 in a trainable mix, whatever its weight is.
export function mixesInto(model: TwinModel, temperature: number, mixes: CellArrays) {
  for (const group of groupsOf(model)) {
    const weights = model.weights[group.name]
    const mix = mixes[group.name]
    const width = group.width
    for (let cell = 0; cell < group.trainable.length; cell++) {
      const row = cell * width
      if (group.trainable[cell] === 0) {
        for (let choice = 0; choice < width; choice++) mix[row + choice] = 0
        mix[row + group.choice[cell]!] = 1
        continue
      }
      let largest = -Infinity
      for (let choice = 0; choice < width; choice++) if (choice !== group.leftOut && weights[row + choice]! > largest) largest = weights[row + choice]!
      let total = 0
      for (let choice = 0; choice < width; choice++) {
        const share = choice === group.leftOut ? 0 : Math.exp((weights[row + choice]! - largest) / temperature)
        mix[row + choice] = share
        total += share
      }
      for (let choice = 0; choice < width; choice++) mix[row + choice] = mix[row + choice]! / total
    }
  }
}

// The mixes of exact tables: every cell holds its one choice as exact 0 and 1.
export function exactMixesInto(tables: RecoveryTables, mixes: CellArrays) {
  mixes.all.fill(0)
  const lexerStates = tables.lexerStateCount
  const grammarStates = tables.grammarStateCount
  for (let cell = 0; cell < tables.lexerNext.length; cell++) {
    mixes.lexerNext[cell * lexerStates + tables.lexerNext[cell]!] = 1
    mixes.lexerEvent[cell * tables.eventCount + tables.lexerEvent[cell]!] = 1
  }
  for (let cell = 0; cell < tables.grammarNext.length; cell++) {
    mixes.grammarNext[cell * grammarStates + tables.grammarNext[cell]!] = 1
    mixes.grammarAction[cell * actionCount + tables.grammarAction[cell]!] = 1
  }
  for (let entry = 0; entry < tables.display.length; entry++) mixes.display[entry * displayKindCount + tables.display[entry]!] = 1
}

// Turns gradients with respect to the mixes into gradients with respect to the weights, times `scale`, and writes
// them into `weightGradients`: for mix = softmax(weights / temperature), the gradient of weight j is
// mix[j] × (gradient[j] - Σ mix[i] × gradient[i]) / temperature. Cells that are not trainable get 0.
export function weightGradientsInto(model: TwinModel, temperature: number, mixes: CellArrays, mixGradients: CellArrays, scale: number, weightGradients: CellArrays) {
  for (const group of groupsOf(model)) {
    const mix = mixes[group.name]
    const gradient = mixGradients[group.name]
    const result = weightGradients[group.name]
    const width = group.width
    for (let cell = 0; cell < group.trainable.length; cell++) {
      const row = cell * width
      if (group.trainable[cell] === 0) {
        for (let choice = 0; choice < width; choice++) result[row + choice] = 0
        continue
      }
      let mean = 0
      for (let choice = 0; choice < width; choice++) mean += mix[row + choice]! * gradient[row + choice]!
      for (let choice = 0; choice < width; choice++) result[row + choice] = scale * mix[row + choice]! * (gradient[row + choice]! - mean) / temperature
    }
  }
}

// The cost on a mix being far from one choice: the mix's entropy, -Σ share × ln(share), which is 0 for one choice and
// ln(choices) for a uniform mix, e.g. 2.08 for the 8 next states of a grammar cell. Returns the mean entropy over the
// trainable mixes, two per trainable cell and one per trainable entry of the display table, and with
// `weightGradients`, adds `weight` times its gradient to it.
export function addSharpnessCost(model: TwinModel, temperature: number, mixes: CellArrays, weight: number, weightGradients?: CellArrays): number {
  const groups = groupsOf(model)
  let mixCount = 0
  for (const group of groups) for (let cell = 0; cell < group.trainable.length; cell++) mixCount += group.trainable[cell]!
  if (mixCount === 0) return 0
  let total = 0
  for (const group of groups) {
    const mix = mixes[group.name]
    const result = weightGradients?.[group.name]
    const width = group.width
    for (let cell = 0; cell < group.trainable.length; cell++) {
      if (group.trainable[cell] === 0) continue
      const row = cell * width
      let entropy = 0
      for (let choice = 0; choice < width; choice++) {
        const share = mix[row + choice]!
        if (share > 0) entropy -= share * Math.log(share)
      }
      total += entropy
      if (result === undefined || weight === 0) continue
      // The gradient of the entropy by weight j is -mix[j] × (ln(mix[j]) + entropy) / temperature.
      for (let choice = 0; choice < width; choice++) {
        const share = mix[row + choice]!
        if (share > 0) result[row + choice] = result[row + choice]! - weight / mixCount * share * (Math.log(share) + entropy) / temperature
      }
    }
  }
  return total / mixCount
}

// Snapping: tables in which every trainable cell holds the choice with the largest weight, which is the choice with
// the largest share at any temperature. Among equal weights the base tables' choice is kept, e.g. in a cell that
// started uniform and that no training sample read.
export function snappedTables(model: TwinModel): RecoveryTables {
  const tables = copyTables(model.base)
  for (const group of groupsOf(model)) {
    const weights = model.weights[group.name]
    const width = group.width
    const choices = tables[group.name]
    for (let cell = 0; cell < group.trainable.length; cell++) {
      if (group.trainable[cell] === 0) continue
      const row = cell * width
      let best = group.choice[cell]!
      for (let choice = 0; choice < width; choice++) if (choice !== group.leftOut && weights[row + choice]! > weights[row + best]!) best = choice
      choices[cell] = best
    }
  }
  return tables
}

// How far the trainable mixes are from one choice: the mean of the largest share, and how many mixes have a largest
// share below 0.9.
export function sharpnessOf(model: TwinModel, mixes: CellArrays) {
  let mixCount = 0
  let largestTotal = 0
  let below = 0
  for (const group of groupsOf(model)) {
    const mix = mixes[group.name]
    for (let cell = 0; cell < group.trainable.length; cell++) {
      if (group.trainable[cell] === 0) continue
      let largest = 0
      for (let choice = 0; choice < group.width; choice++) if (mix[cell * group.width + choice]! > largest) largest = mix[cell * group.width + choice]!
      mixCount++
      largestTotal += largest
      if (largest < 0.9) below++
    }
  }
  return {mixes: mixCount, meanLargestShare: mixCount === 0 ? 1 : largestTotal / mixCount, below90: below}
}

// The samples as the twin reads them, see twin-data.ts, which makes them. The arrays can be views of
// SharedArrayBuffers, so that worker threads read the same memory.
export type TwinData = {
  sampleCount: number
  // The number of classes, the key of the class table (see classTableKeyOf) and the number of contexts of the tables
  // that the samples were packed for, see packForTwin. A twin of tables that give a code point another class would
  // read other cells, and one with the bit "first on its line" needs the bit at the first error. So a run on samples
  // that were packed for another class table or another number of contexts throws.
  classCount: number
  classTable: string
  contextCount: number
  // The sample's index in the dataset, e.g. for the random draws of one sample.
  index: Int32Array
  // The sample's split, as an index into splitNames of ../data.ts: 0 is the train split. train refuses a sample of
  // another split unless TrainOptions.alsoOtherSplits is true.
  split: Uint8Array
  // The code points of sample s are the entries start[s] to start[s + 1] - 1 of the arrays per code point.
  start: Int32Array
  // The position of the first error, where the twin starts, and the exact parser's state before that position: the
  // tokenizer state, the grammar state, the depth, and bit l - 1 of startObjects is 1 when level l is an object.
  // startFirstOnLine is the bit "first on its line" there, 0 for tables without the bit.
  firstError: Int32Array
  startLexerState: Uint8Array
  startGrammarState: Uint8Array
  startDepth: Int8Array
  startObjects: Uint16Array
  startFirstOnLine: Uint8Array
  // Per code point: its class, and the flags, labels and intended states of data.ts. A label's value is -1 where it
  // is not scored. The intended depth is there at every kept code point.
  classes: Uint8Array
  flags: Uint8Array
  labelKind: Int8Array
  labelDepth: Int8Array
  labelContainer: Int8Array
  intendedLexerAfter: Int8Array
  intendedEvent: Int8Array
  intendedGrammarAfter: Int8Array
  intendedDepthAfter: Int8Array
  // Per code point with a counterpart in the original: the stack after the counterpart, bit l - 1 is 1 when level l is
  // an object. Only filled when hasIntendedObjects is true. Keeping the run on track needs it.
  intendedObjects: Uint16Array
  hasIntendedObjects: boolean
}

export type LossOptions = {
  // The weights of the three cross-entropies. The default is 1 each.
  kindWeight?: number
  depthWeight?: number
  containerWeight?: number
  // Extra targets from intended.ts: the cross-entropy of the tokenizer state after a code point, of the event, and of
  // the grammar state after it. The default is 0 each. They are only used at the code points that data.ts marks with
  // codePointCanFollow, where a parser of the broken text can be in the intended state. Elsewhere a parser is seldom
  // in the intended state, e.g. at the space after a removed comma, where frozen cells keep the grammar state and no
  // choice of the open cells leads to it.
  intendedLexerWeight?: number
  intendedEventWeight?: number
  intendedGrammarWeight?: number
  // Keeping the run on track: after a code point with the mark codePointCanFollow, with this probability, the twin's
  // state is replaced by the intended state, i.e. the state of today's parser after the code point's counterpart in
  // the original. Gradients do not cross a replaced state. The default is 0. It needs TwinData.intendedObjects.
  // The bit "first on its line" is not replaced: it follows from the line feeds of the broken text, and the bit of
  // the original can be one that no parser of the broken text has, e.g. after a removed line feed.
  onTrackProbability?: number
  // True uses the intended states at every kept code point, with or without the mark, as the first version of the
  // twin did. It is only here to measure what the mark changes: a run that is put on a state that the parser cannot
  // be in never reads the open cell that the parser reads next. The default is false.
  intendedEverywhere?: boolean
  // The seed of the draws for onTrackProbability. A sample's draws depend on this seed and on the sample's index.
  onTrackSeed?: number
  // How much a sample weighs. By default every scored code point weighs 1, so a sample weighs as much as it has
  // scored code points, e.g. 358 for a long text and 12 for a short one. With this power, every loss of a sample is
  // divided by (the sample's scored code points) ^ power: with 1 every sample weighs the same, whatever its length,
  // and 0.5 is in between. The default is 0.
  sampleWeightPower?: number
  // More weight on the code points right after the first error: the three label losses of the first
  // `firstCodePoints` scored code points of a sample weigh `firstCodePointsWeight` times as much as the ones of its
  // other code points, e.g. the first 8 weigh 4 times as much. The defaults are 0 code points and 1.
  firstCodePoints?: number
  firstCodePointsWeight?: number
}

// What a batch adds up: the loss, how many scored code points it counts, and its parts.
export type LossTally = {
  // Samples that the twin ran, i.e. that have a code point at or after their first error.
  samples: number
  // Scored code points: at or after the first error, with a label that has a scored value. They are the code points
  // that a score counts, see ../score.ts.
  codePoints: number
  // The weights of those code points added up, see LossOptions.sampleWeightPower and LossOptions.firstCodePoints:
  // the same number as `codePoints` when every code point weighs 1, and the number of samples when every sample
  // weighs the same. The loss per code point is `loss / weight`.
  weight: number
  // Steps that the twin took.
  positions: number
  loss: number
  kindLoss: number
  depthLoss: number
  containerLoss: number
  intendedLoss: number
  // How many states were replaced by the intended state.
  replaced: number
  // Code points, among `codePoints`, at which a label has a share of exactly 0, and the loss of their three labels.
  // A share is exactly 0 only when cells that hold exact 0 and 1 rule the label out, i.e. cells that are not
  // trainable. No weight changes such a loss, and each label costs -ln(lossFloor) = 13.8 there. With few trainable
  // cells these are most of the loss, so the loss without them says more: (kindLoss + depthLoss + containerLoss -
  // ruledOutLoss) / (codePoints - ruledOut).
  ruledOut: number
  ruledOutLoss: number
}

export const createTally = (): LossTally => ({samples: 0, codePoints: 0, weight: 0, positions: 0, loss: 0, kindLoss: 0, depthLoss: 0, containerLoss: 0, intendedLoss: 0, replaced: 0, ruledOut: 0, ruledOutLoss: 0})
export function addTally(total: LossTally, part: LossTally) {
  for (const field of Object.keys(total) as (keyof LossTally)[]) total[field] += part[field]
}

// A share's cross-entropy is -ln(share + lossFloor), so a share of exactly 0 costs 13.8 and not infinity.
export const lossFloor = 1e-6

// The depths that the twin holds a share for when nothing else is asked: -8 to 24. A pop at the lowest depth and a
// push at the highest leave the depth where it is, which the exact parser does not do, so the two differ once a share
// reaches an end of the range.
export const defaultDepthLow = -8
export const defaultDepthHigh = 24

const levelCount = maximumDepth + 1

// The arrays of one run and the functions that fill them. A runner holds, for every position, the state before the
// step, everything the step computes and the state after it, so that the backward pass can read them.
export function createTwinRunner(shape: TwinShape, depthLow: number = defaultDepthLow, depthHigh: number = defaultDepthHigh, positions: number = positionCount) {
  if (depthLow > -1 || depthHigh < maximumDepth + 1) throw new Error(`the depth range has to hold -1 to ${maximumDepth + 1}, and is ${depthLow} to ${depthHigh}`)
  const {classCount, classTable, lexerStateCount, eventCount, tokenCount, contextCount, grammarStateCount, displayKindCount, tokenOfEvent, display, displayMixed} = shape
  const depthCount = depthHigh - depthLow + 1
  const numbers = (perPosition: number) => new Float64Array(positions * perPosition)
  // The state before each position: the shares of the tokenizer states, of the grammar states and of the depths, and
  // per level 1 to 16 the share of "this level is an object" (entry 0 of a position's levels is not used).
  const lexerBefore = numbers(lexerStateCount)
  const grammarBefore = numbers(grammarStateCount)
  const depthBefore = numbers(depthCount)
  const objectsBefore = numbers(levelCount)
  // With the bit "first on its line": the bit's share before and after each position.
  const hasFirstOnLine = contextCount > contextsWithoutBit
  const firstOnLineBefore = numbers(1)
  const firstOnLineAfter = numbers(1)
  // What each step computes: the mixes of the event, the token, the context and the stack action (entries 1 to 4:
  // none, push an array, push an object, pop, and entry 0, `by token`, stays 0 since its share goes to what the token
  // does), the state after, and the mixes of the display kind and of the container after (none, object, array).
  const events = numbers(eventCount)
  const tokens = numbers(tokenCount)
  const contexts = numbers(contextCount)
  const actions = numbers(actionCount)
  const lexerAfter = numbers(lexerStateCount)
  const grammarAfter = numbers(grammarStateCount)
  const depthAfter = numbers(depthCount)
  const objectsAfter = numbers(levelCount)
  const kinds = numbers(displayKindCount)
  const containers = numbers(3)
  // 1 where the state after a position was replaced by the intended state.
  const replaced = new Uint8Array(positions)
  // What the three label losses of a position weigh, see LossOptions.sampleWeightPower and LossOptions.firstCodePoints.
  const labelWeights = new Float64Array(positions)

  // Per depth of the range: its depth class, and the level whose kind is the innermost container's, 0 for none.
  const classOfDepth = new Uint8Array(depthCount)
  const levelOfDepth = new Uint8Array(depthCount)
  for (let index = 0; index < depthCount; index++) {
    const depth = depthLow + index
    classOfDepth[index] = today.depthClass[depth < 0 ? 0 : depth > maximumDepth ? maximumDepth : depth]!
    levelOfDepth[index] = depth <= 0 ? 0 : depth > maximumDepth ? maximumDepth : depth
  }

  // Gradients of the loss. Before stepBackward they are by what the step computed: the state after, the event mix,
  // the display kind mix and the container mix. After it, the four state arrays are by the state before the step.
  let lexerGradient = new Float64Array(lexerStateCount)
  let grammarGradient = new Float64Array(grammarStateCount)
  let depthGradient = new Float64Array(depthCount)
  let objectsGradient = new Float64Array(levelCount)
  let lexerGradientBefore = new Float64Array(lexerStateCount)
  let grammarGradientBefore = new Float64Array(grammarStateCount)
  let depthGradientBefore = new Float64Array(depthCount)
  let objectsGradientBefore = new Float64Array(levelCount)
  // The gradient by the bit "first on its line": by the bit after the step before stepBackward, by the bit before the
  // step after it.
  const firstOnLineGradient = new Float64Array(1)
  const eventGradient = new Float64Array(eventCount)
  const kindGradient = new Float64Array(displayKindCount)
  const containerGradient = new Float64Array(3)
  const tokenGradient = new Float64Array(tokenCount)
  const contextGradient = new Float64Array(contextCount)
  const actionGradient = new Float64Array(actionCount)

  const depthClassCount = contextsWithoutBit / 2
  const classShare = new Float64Array(depthClassCount)
  const classObjectShare = new Float64Array(depthClassCount)

  let mixes: CellArrays | undefined

  // Sets the state before `position` to one tokenizer state, one grammar state, one depth and one kind per level.
  function setStateBefore(position: number, lexerState: number, grammarState: number, depth: number, objects: number) {
    const lexerBase = position * lexerStateCount
    for (let state = 0; state < lexerStateCount; state++) lexerBefore[lexerBase + state] = 0
    lexerBefore[lexerBase + lexerState] = 1
    const grammarBase = position * grammarStateCount
    for (let state = 0; state < grammarStateCount; state++) grammarBefore[grammarBase + state] = 0
    grammarBefore[grammarBase + grammarState] = 1
    const depthBase = position * depthCount
    for (let index = 0; index < depthCount; index++) depthBefore[depthBase + index] = 0
    depthBefore[depthBase + (depth < depthLow ? 0 : depth > depthHigh ? depthCount - 1 : depth - depthLow)] = 1
    const objectsBase = position * levelCount
    objectsBefore[objectsBase] = 0
    for (let level = 1; level < levelCount; level++) objectsBefore[objectsBase + level] = (objects >> (level - 1)) & 1
  }

  // The state before position + 1 is the state after `position`.
  function carry(position: number) {
    const lexerBase = position * lexerStateCount
    for (let state = 0; state < lexerStateCount; state++) lexerBefore[lexerBase + lexerStateCount + state] = lexerAfter[lexerBase + state]!
    const grammarBase = position * grammarStateCount
    for (let state = 0; state < grammarStateCount; state++) grammarBefore[grammarBase + grammarStateCount + state] = grammarAfter[grammarBase + state]!
    const depthBase = position * depthCount
    for (let index = 0; index < depthCount; index++) depthBefore[depthBase + depthCount + index] = depthAfter[depthBase + index]!
    const objectsBase = position * levelCount
    for (let level = 0; level < levelCount; level++) objectsBefore[objectsBase + levelCount + level] = objectsAfter[objectsBase + level]!
    firstOnLineBefore[position + 1] = firstOnLineAfter[position]!
  }

  // One step: from the state before `position` and the class of its code point to everything the step computes.
  function stepForward(position: number, characterClass: number) {
    const lexerEventMix = mixes!.lexerEvent
    const lexerNextMix = mixes!.lexerNext
    const grammarNextMix = mixes!.grammarNext
    const grammarActionMix = mixes!.grammarAction
    const displayMix = mixes!.display
    const lexerBase = position * lexerStateCount
    const eventBase = position * eventCount
    const tokenBase = position * tokenCount
    const contextBase = position * contextCount
    const grammarBase = position * grammarStateCount
    const actionBase = position * actionCount
    const depthBase = position * depthCount
    const objectsBase = position * levelCount
    const kindBase = position * displayKindCount
    const containerBase = position * 3

    // The tokenizer: the event's mix is the sum over the tokenizer states of the state's share times its cell's event
    // mix, and likewise the next state.
    for (let event = 0; event < eventCount; event++) events[eventBase + event] = 0
    for (let next = 0; next < lexerStateCount; next++) lexerAfter[lexerBase + next] = 0
    for (let state = 0; state < lexerStateCount; state++) {
      const share = lexerBefore[lexerBase + state]!
      if (share === 0) continue
      const cell = state * classCount + characterClass
      const eventRow = cell * eventCount
      const nextRow = cell * lexerStateCount
      for (let event = 0; event < eventCount; event++) events[eventBase + event]! += share * lexerEventMix[eventRow + event]!
      for (let next = 0; next < lexerStateCount; next++) lexerAfter[lexerBase + next]! += share * lexerNextMix[nextRow + next]!
    }

    // The token's mix follows from the event's by the fixed table.
    for (let token = 0; token < tokenCount; token++) tokens[tokenBase + token] = 0
    for (let event = 0; event < eventCount; event++) tokens[tokenBase + tokenOfEvent[event]!]! += events[eventBase + event]!

    // The context's mix: per depth class, the share of the depths of the class whose innermost container is an object,
    // i.e. the depth's share times the share of "an object" at the depth's level, and the rest of the class. Position
    // 512 reads no object, as in the exact parser.
    classShare.fill(0)
    classObjectShare.fill(0)
    const readsObjects = position !== capacity
    for (let index = 0; index < depthCount; index++) {
      const share = depthBefore[depthBase + index]!
      if (share === 0) continue
      const depthClass = classOfDepth[index]!
      classShare[depthClass]! += share
      const level = levelOfDepth[index]!
      if (level > 0 && readsObjects) classObjectShare[depthClass]! += share * objectsBefore[objectsBase + level]!
    }
    for (let depthClass = 0; depthClass < depthClassCount; depthClass++) {
      contexts[contextBase + depthClass * 2] = classShare[depthClass]! - classObjectShare[depthClass]!
      contexts[contextBase + depthClass * 2 + 1] = classObjectShare[depthClass]!
    }
    // The bit "first on its line": its share of every context goes to the context with the bit, 8 further on. After
    // the step the bit is 1 at a line feed, and otherwise the share before times the share of the token `none`, the
    // one token that leaves the bit as it is.
    if (hasFirstOnLine) {
      const bit = firstOnLineBefore[position]!
      for (let context = 0; context < contextsWithoutBit; context++) {
        const withBit = contexts[contextBase + context]! * bit
        contexts[contextBase + contextsWithoutBit + context] = withBit
        contexts[contextBase + context]! -= withBit
      }
      firstOnLineAfter[position] = characterClass === classLineFeed ? 1 : bit * tokens[tokenBase + tokenNone]!
    }

    // The grammar: the next state's mix and the stack action's mix are the sums over (grammar state, token, context) of
    // the product of the three shares times the cell's mix. The share of the action `by token` goes to what the token
    // does.
    for (let next = 0; next < grammarStateCount; next++) grammarAfter[grammarBase + next] = 0
    for (let action = 0; action < actionCount; action++) actions[actionBase + action] = 0
    for (let state = 0; state < grammarStateCount; state++) {
      const stateShare = grammarBefore[grammarBase + state]!
      if (stateShare === 0) continue
      for (let token = 0; token < tokenCount; token++) {
        const stateTokenShare = stateShare * tokens[tokenBase + token]!
        if (stateTokenShare === 0) continue
        const actionByTokenEntry = actionBase + actionOfToken[token]!
        for (let context = 0; context < contextCount; context++) {
          const share = stateTokenShare * contexts[contextBase + context]!
          if (share === 0) continue
          const cell = (state * tokenCount + token) * contextCount + context
          const nextRow = cell * grammarStateCount
          for (let next = 0; next < grammarStateCount; next++) grammarAfter[grammarBase + next]! += share * grammarNextMix[nextRow + next]!
          const actionRow = cell * actionCount
          actions[actionByTokenEntry]! += share * grammarActionMix[actionRow + actionByToken]!
          actions[actionBase + actionNone]! += share * grammarActionMix[actionRow + actionNone]!
          actions[actionBase + actionPushArray]! += share * grammarActionMix[actionRow + actionPushArray]!
          actions[actionBase + actionPushObject]! += share * grammarActionMix[actionRow + actionPushObject]!
          actions[actionBase + actionPop]! += share * grammarActionMix[actionRow + actionPop]!
        }
      }
    }

    // The depth's mix follows from the stack action's: a push moves every share one depth up, a pop one down, and
    // what the two leave stays. The step takes "stays" as 1 - push - pop and does not read the share of the action
    // `none`. The two are the same number when every mix adds up to 1, but with the share of `none`, the depth's
    // total would be multiplied by the actions' total, which is itself the depth's total times two others. A rounding
    // error of 1e-16 in a total then at least doubles with every step, and after 60 steps the shares are far from
    // adding up to 1.
    const pushArray = actions[actionBase + actionPushArray]!
    const pushObject = actions[actionBase + actionPushObject]!
    const pop = actions[actionBase + actionPop]!
    const push = pushArray + pushObject
    const stay = 1 - push - pop
    const last = depthCount - 1
    for (let index = 0; index < depthCount; index++) {
      let share = stay * depthBefore[depthBase + index]!
      // A push from the depth below, or at the lowest depth the pop that stays there.
      share += index > 0 ? push * depthBefore[depthBase + index - 1]! : pop * depthBefore[depthBase]!
      // A pop from the depth above, or at the highest depth the push that stays there.
      share += index < last ? pop * depthBefore[depthBase + index + 1]! : push * depthBefore[depthBase + last]!
      depthAfter[depthBase + index] = share
    }

    // The levels' kinds: a push at depth l - 1 writes level l. The share of that is the depth's share times the push's.
    objectsAfter[objectsBase] = 0
    for (let level = 1; level < levelCount; level++) {
      const below = depthBefore[depthBase + level - 1 - depthLow]!
      objectsAfter[objectsBase + level] = objectsBefore[objectsBase + level]! * (1 - below * push) + below * pushObject
    }

    // The display kind's mix follows from the event's and the next grammar state's: the product of the two shares goes
    // to the kind that the display table has for the pair, or is split by the entry's mix when the entry is open.
    for (let kind = 0; kind < displayKindCount; kind++) kinds[kindBase + kind] = 0
    for (let event = 0; event < eventCount; event++) {
      const share = events[eventBase + event]!
      if (share === 0) continue
      const row = event * grammarStateCount
      for (let next = 0; next < grammarStateCount; next++) {
        const entry = row + next
        const entryShare = share * grammarAfter[grammarBase + next]!
        if (displayMixed[entry] === 0) {
          kinds[kindBase + display[entry]!]! += entryShare
          continue
        }
        const mixRow = entry * displayKindCount
        for (let kind = 0; kind < displayKindCount; kind++) kinds[kindBase + kind]! += entryShare * displayMix[mixRow + kind]!
      }
    }

    // The container after: none at depth 0 or below, and at a depth above 0 the kind at the depth's level.
    let noContainer = 0
    let inContainer = 0
    let inObject = 0
    for (let index = 0; index < depthCount; index++) {
      const share = depthAfter[depthBase + index]!
      const level = levelOfDepth[index]!
      if (level === 0) noContainer += share
      else {
        inContainer += share
        inObject += share * objectsAfter[objectsBase + level]!
      }
    }
    containers[containerBase + containerNone] = noContainer
    containers[containerBase + containerObject] = inObject
    containers[containerBase + containerArray] = inContainer - inObject
  }

  // The backward pass of one step. Reads the gradients by what the step computed, adds the gradients by the cells'
  // mixes to `gradients`, and leaves the gradients by the state before the step in the four state gradient arrays.
  function stepBackward(position: number, characterClass: number, gradients: CellArrays) {
    const lexerEventMix = mixes!.lexerEvent
    const lexerNextMix = mixes!.lexerNext
    const grammarNextMix = mixes!.grammarNext
    const grammarActionMix = mixes!.grammarAction
    const displayMix = mixes!.display
    const lexerBase = position * lexerStateCount
    const eventBase = position * eventCount
    const tokenBase = position * tokenCount
    const contextBase = position * contextCount
    const grammarBase = position * grammarStateCount
    const actionBase = position * actionCount
    const depthBase = position * depthCount
    const objectsBase = position * levelCount
    const last = depthCount - 1

    // The container after.
    const noneGradient = containerGradient[containerNone]!
    const objectGradient = containerGradient[containerObject]!
    const arrayGradient = containerGradient[containerArray]!
    if (noneGradient !== 0 || objectGradient !== 0 || arrayGradient !== 0) {
      for (let index = 0; index < depthCount; index++) {
        const level = levelOfDepth[index]!
        if (level === 0) depthGradient[index]! += noneGradient
        else {
          const objectShare = objectsAfter[objectsBase + level]!
          depthGradient[index]! += objectGradient * objectShare + arrayGradient * (1 - objectShare)
          objectsGradient[level]! += (objectGradient - arrayGradient) * depthAfter[depthBase + index]!
        }
      }
    }

    // The display kind.
    let anyKind = false
    for (let kind = 0; kind < displayKindCount; kind++) if (kindGradient[kind] !== 0) anyKind = true
    if (anyKind) {
      const displayGradient = gradients.display
      for (let event = 0; event < eventCount; event++) {
        const share = events[eventBase + event]!
        const row = event * grammarStateCount
        for (let next = 0; next < grammarStateCount; next++) {
          const entry = row + next
          // The gradient by the share of the pair: the gradient of the entry's kind, or of the kinds of its mix.
          let gradient = 0
          if (displayMixed[entry] === 0) {
            gradient = kindGradient[display[entry]!]!
          } else {
            const mixRow = entry * displayKindCount
            const entryShare = share * grammarAfter[grammarBase + next]!
            for (let kind = 0; kind < displayKindCount; kind++) {
              gradient += kindGradient[kind]! * displayMix[mixRow + kind]!
              displayGradient[mixRow + kind]! += entryShare * kindGradient[kind]!
            }
          }
          if (gradient === 0) continue
          eventGradient[event]! += gradient * grammarAfter[grammarBase + next]!
          grammarGradient[next]! += gradient * share
        }
      }
    }

    // The levels' kinds and the depth, back to the stack action's mix and the state before.
    const pushArray = actions[actionBase + actionPushArray]!
    const pushObject = actions[actionBase + actionPushObject]!
    const pop = actions[actionBase + actionPop]!
    const push = pushArray + pushObject
    const stay = 1 - push - pop
    let gradientByStay = 0
    let gradientByPush = 0
    let gradientByPushObject = 0
    let gradientByPop = 0
    for (let index = 0; index < depthCount; index++) depthGradientBefore[index] = 0
    objectsGradientBefore[0] = 0
    for (let level = 1; level < levelCount; level++) {
      const depthIndex = level - 1 - depthLow
      const below = depthBefore[depthBase + depthIndex]!
      const gradient = objectsGradient[level]!
      const before = objectsBefore[objectsBase + level]!
      objectsGradientBefore[level] = gradient * (1 - below * push)
      if (gradient === 0) continue
      depthGradientBefore[depthIndex]! += gradient * (pushObject - before * push)
      gradientByPush -= gradient * before * below
      gradientByPushObject += gradient * below
    }
    for (let index = 0; index < depthCount; index++) {
      const gradient = depthGradient[index]!
      if (gradient === 0) continue
      gradientByStay += gradient * depthBefore[depthBase + index]!
      depthGradientBefore[index]! += stay * gradient
      // A push from the depth below, or at the lowest depth the pop that stays there.
      if (index > 0) {
        gradientByPush += gradient * depthBefore[depthBase + index - 1]!
        depthGradientBefore[index - 1]! += push * gradient
      } else {
        gradientByPop += gradient * depthBefore[depthBase]!
        depthGradientBefore[0]! += pop * gradient
      }
      // A pop from the depth above, or at the highest depth the push that stays there.
      if (index < last) {
        gradientByPop += gradient * depthBefore[depthBase + index + 1]!
        depthGradientBefore[index + 1]! += pop * gradient
      } else {
        gradientByPush += gradient * depthBefore[depthBase + last]!
        depthGradientBefore[last]! += push * gradient
      }
    }
    // "Stays" is 1 - push an array - push an object - pop, and nothing reads the share of the action `none`.
    const gradientByPushArray = gradientByPush - gradientByStay
    const gradientByPushObjectAction = gradientByPush + gradientByPushObject - gradientByStay
    const gradientByPopAction = gradientByPop - gradientByStay
    actionGradient[actionByToken] = 0
    actionGradient[actionNone] = 0
    actionGradient[actionPushArray] = gradientByPushArray
    actionGradient[actionPushObject] = gradientByPushObjectAction
    actionGradient[actionPop] = gradientByPopAction

    // The grammar. A cell matters when at least two of its three shares are not 0: then the gradient by the third
    // share is not 0 either, even if that share is.
    for (let token = 0; token < tokenCount; token++) tokenGradient[token] = 0
    for (let context = 0; context < contextCount; context++) contextGradient[context] = 0
    for (let state = 0; state < grammarStateCount; state++) grammarGradientBefore[state] = 0
    const grammarNextGradient = gradients.grammarNext
    const grammarActionGradient = gradients.grammarAction
    for (let state = 0; state < grammarStateCount; state++) {
      const stateShare = grammarBefore[grammarBase + state]!
      for (let token = 0; token < tokenCount; token++) {
        const tokenShare = tokens[tokenBase + token]!
        if (stateShare === 0 && tokenShare === 0) continue
        const stateTokenShare = stateShare * tokenShare
        const gradientByToken = actionGradient[actionOfToken[token]!]!
        for (let context = 0; context < contextCount; context++) {
          const contextShare = contexts[contextBase + context]!
          if (stateTokenShare === 0 && contextShare === 0) continue
          const cell = (state * tokenCount + token) * contextCount + context
          const nextRow = cell * grammarStateCount
          const actionRow = cell * actionCount
          let gradientByShare = grammarActionMix[actionRow + actionByToken]! * gradientByToken
            + grammarActionMix[actionRow + actionPushArray]! * gradientByPushArray
            + grammarActionMix[actionRow + actionPushObject]! * gradientByPushObjectAction
            + grammarActionMix[actionRow + actionPop]! * gradientByPopAction
          for (let next = 0; next < grammarStateCount; next++) gradientByShare += grammarNextMix[nextRow + next]! * grammarGradient[next]!
          grammarGradientBefore[state]! += tokenShare * contextShare * gradientByShare
          tokenGradient[token]! += stateShare * contextShare * gradientByShare
          contextGradient[context]! += stateTokenShare * gradientByShare
          const share = stateTokenShare * contextShare
          if (share === 0) continue
          for (let next = 0; next < grammarStateCount; next++) grammarNextGradient[nextRow + next]! += share * grammarGradient[next]!
          grammarActionGradient[actionRow + actionByToken]! += share * gradientByToken
          grammarActionGradient[actionRow + actionPushArray]! += share * gradientByPushArray
          grammarActionGradient[actionRow + actionPushObject]! += share * gradientByPushObjectAction
          grammarActionGradient[actionRow + actionPop]! += share * gradientByPopAction
        }
      }
    }

    // The bit "first on its line": back to the bit before the step, to the share of the token `none`, and from the
    // contexts with and without the bit to the contexts before the bit split them.
    if (hasFirstOnLine) {
      const bit = firstOnLineBefore[position]!
      let gradientByBit = 0
      if (characterClass !== classLineFeed) {
        gradientByBit = firstOnLineGradient[0]! * tokens[tokenBase + tokenNone]!
        tokenGradient[tokenNone]! += firstOnLineGradient[0]! * bit
      }
      for (let context = 0; context < contextsWithoutBit; context++) {
        const without = contextGradient[context]!
        const difference = contextGradient[contextsWithoutBit + context]! - without
        gradientByBit += difference * (contexts[contextBase + context]! + contexts[contextBase + contextsWithoutBit + context]!)
        contextGradient[context] = without + difference * bit
      }
      firstOnLineGradient[0] = gradientByBit
    }

    // The context.
    const readsObjects = position !== capacity
    for (let index = 0; index < depthCount; index++) {
      const context = classOfDepth[index]! * 2
      const withoutObject = contextGradient[context]!
      depthGradientBefore[index]! += withoutObject
      const level = levelOfDepth[index]!
      if (level > 0 && readsObjects) {
        const difference = contextGradient[context + 1]! - withoutObject
        depthGradientBefore[index]! += difference * objectsBefore[objectsBase + level]!
        objectsGradientBefore[level]! += difference * depthBefore[depthBase + index]!
      }
    }

    // The token and the tokenizer.
    for (let event = 0; event < eventCount; event++) eventGradient[event]! += tokenGradient[tokenOfEvent[event]!]!
    const lexerEventGradient = gradients.lexerEvent
    const lexerNextGradient = gradients.lexerNext
    for (let state = 0; state < lexerStateCount; state++) {
      const cell = state * classCount + characterClass
      const eventRow = cell * eventCount
      const nextRow = cell * lexerStateCount
      let gradientByShare = 0
      for (let event = 0; event < eventCount; event++) gradientByShare += lexerEventMix[eventRow + event]! * eventGradient[event]!
      for (let next = 0; next < lexerStateCount; next++) gradientByShare += lexerNextMix[nextRow + next]! * lexerGradient[next]!
      lexerGradientBefore[state] = gradientByShare
      const share = lexerBefore[lexerBase + state]!
      if (share === 0) continue
      for (let event = 0; event < eventCount; event++) lexerEventGradient[eventRow + event]! += share * eventGradient[event]!
      for (let next = 0; next < lexerStateCount; next++) lexerNextGradient[nextRow + next]! += share * lexerGradient[next]!
    }

    let swap = lexerGradient
    lexerGradient = lexerGradientBefore
    lexerGradientBefore = swap
    swap = grammarGradient
    grammarGradient = grammarGradientBefore
    grammarGradientBefore = swap
    swap = depthGradient
    depthGradient = depthGradientBefore
    depthGradientBefore = swap
    swap = objectsGradient
    objectsGradient = objectsGradientBefore
    objectsGradientBefore = swap
  }

  // Clears the gradients by the state that a replaced state stands in for: everything but the bit "first on its
  // line", which is not replaced.
  function clearReplacedGradients() {
    lexerGradient.fill(0)
    grammarGradient.fill(0)
    depthGradient.fill(0)
    objectsGradient.fill(0)
  }
  function clearStateGradients() {
    clearReplacedGradients()
    firstOnLineGradient[0] = 0
  }
  function clearOutputGradients() {
    eventGradient.fill(0)
    kindGradient.fill(0)
    containerGradient.fill(0)
  }

  // Runs the twin on one sample, from its first error to the last of its code points, or to position `end` - 1 with
  // `end` given, e.g. 513 for the positions after the text too. Adds the sample's loss to `tally`, and with
  // `gradients`, the gradients of the loss by the cells' mixes to it. Neither is divided by the weight of the code
  // points, LossTally.weight.
  function runSample(data: TwinData, place: number, options: LossOptions, tally: LossTally, gradients?: CellArrays, end?: number) {
    if (data.classTable !== classTable || data.contextCount !== contextCount) {
      throw new Error(`the samples were packed for tables with ${data.classCount} classes and ${data.contextCount} contexts, and the twin's tables have ${classCount} and ${contextCount}${data.classCount === classCount && data.contextCount === contextCount ? ', with other code points in their added classes' : ''}: give packForTwin the twin's tables`)
    }
    const start = data.start[place]!
    const length = data.start[place + 1]! - start
    const first = data.firstError[place]!
    const stop = end ?? length
    if (first < 0 || first >= stop) return
    const kindWeight = options.kindWeight ?? 1
    const depthWeight = options.depthWeight ?? 1
    const containerWeight = options.containerWeight ?? 1
    const intendedLexerWeight = options.intendedLexerWeight ?? 0
    const intendedEventWeight = options.intendedEventWeight ?? 0
    const intendedGrammarWeight = options.intendedGrammarWeight ?? 0
    const intendedTargets = intendedLexerWeight !== 0 || intendedEventWeight !== 0 || intendedGrammarWeight !== 0
    const onTrackProbability = options.onTrackProbability ?? 0
    const intendedEverywhere = options.intendedEverywhere === true
    if (onTrackProbability > 0 && !data.hasIntendedObjects) throw new Error('keeping the run on track needs the intended stacks, see twin-data.ts')
    const random = onTrackProbability > 0 ? createRandom(options.onTrackSeed ?? 0, data.index[place]!) : undefined
    const sampleWeightPower = options.sampleWeightPower ?? 0
    const firstCodePoints = options.firstCodePoints ?? 0
    const firstCodePointsWeight = options.firstCodePointsWeight ?? 1
    // What every loss of this sample is multiplied by: 1 / (its scored code points) ^ sampleWeightPower.
    let sampleWeight = 1
    if (sampleWeightPower !== 0) {
      let scored = 0
      for (let position = first; position < Math.min(stop, length); position++) if ((data.flags[start + position]! & (codePointNestingScored | codePointKindScored)) !== 0) scored++
      if (scored > 0) sampleWeight = scored ** -sampleWeightPower
    }
    let scoredBefore = 0

    tally.samples++
    setStateBefore(first, data.startLexerState[place]!, data.startGrammarState[place]!, data.startDepth[place]!, data.startObjects[place]!)
    firstOnLineBefore[first] = data.startFirstOnLine[place]!
    for (let position = first; position < stop; position++) {
      const inText = position < length
      const at = start + position
      stepForward(position, inText ? data.classes[at]! : 0)
      tally.positions++
      replaced[position] = 0
      if (!inText) {
        if (position + 1 < stop) carry(position)
        continue
      }
      const flags = data.flags[at]!
      // Whether the intended state after this code point may be used, as a target and as a state to put the run on:
      // the code point is kept, and a parser of the broken text can be in that state. With intendedEverywhere, as in
      // the first version: a target at every kept code point whose display kind is scored, and a state to put the
      // run on at every kept code point.
      const kept = data.intendedLexerAfter[at]! >= 0
      const canFollow = (flags & codePointCanFollow) !== 0
      const targetHere = kept && (intendedEverywhere ? (flags & codePointKindScored) !== 0 : canFollow)
      const replaceHere = kept && (intendedEverywhere || canFollow)
      // The loss of the label's values that are scored: the depth and the container together, and the display kind.
      const scoresNesting = (flags & codePointNestingScored) !== 0
      const scoresKind = (flags & codePointKindScored) !== 0
      if (scoresNesting || scoresKind) {
        const labelWeight = scoredBefore < firstCodePoints ? sampleWeight * firstCodePointsWeight : sampleWeight
        labelWeights[position] = labelWeight
        scoredBefore++
        tally.codePoints++
        tally.weight += labelWeight
        let depthShare = 1
        let containerShare = 1
        let kindShare = 1
        let labelLoss = 0
        if (scoresNesting) {
          depthShare = depthAfter[position * depthCount + data.labelDepth[at]! - depthLow]!
          containerShare = containers[position * 3 + data.labelContainer[at]!]!
          const depthLoss = -labelWeight * depthWeight * Math.log(depthShare + lossFloor)
          const containerLoss = -labelWeight * containerWeight * Math.log(containerShare + lossFloor)
          tally.depthLoss += depthLoss
          tally.containerLoss += containerLoss
          labelLoss += depthLoss + containerLoss
        }
        if (scoresKind) {
          kindShare = kinds[position * displayKindCount + data.labelKind[at]!]!
          const kindLoss = -labelWeight * kindWeight * Math.log(kindShare + lossFloor)
          tally.kindLoss += kindLoss
          labelLoss += kindLoss
        }
        tally.loss += labelLoss
        if (depthShare === 0 || containerShare === 0 || kindShare === 0) {
          tally.ruledOut++
          tally.ruledOutLoss += labelLoss
        }
      }
      // The extra targets, at every kept code point whose intended state may be used, scored or not.
      if (intendedTargets && targetHere) {
        const intendedLoss = sampleWeight * (-intendedLexerWeight * Math.log(lexerAfter[position * lexerStateCount + data.intendedLexerAfter[at]!]! + lossFloor)
          - intendedEventWeight * Math.log(events[position * eventCount + data.intendedEvent[at]!]! + lossFloor)
          - intendedGrammarWeight * Math.log(grammarAfter[position * grammarStateCount + data.intendedGrammarAfter[at]!]! + lossFloor))
        tally.intendedLoss += intendedLoss
        tally.loss += intendedLoss
      }
      // Keeping the run on track: one draw per code point whose intended state may be used.
      const replace = random !== undefined && replaceHere && random.next() < onTrackProbability
      if (replace) {
        replaced[position] = 1
        tally.replaced++
      }
      if (position + 1 < stop) {
        if (replace) {
          setStateBefore(position + 1, data.intendedLexerAfter[at]!, data.intendedGrammarAfter[at]!, data.intendedDepthAfter[at]!, data.intendedObjects[at]!)
          firstOnLineBefore[position + 1] = firstOnLineAfter[position]!
        } else {
          carry(position)
        }
      }
    }
    if (gradients === undefined) return

    clearStateGradients()
    for (let position = stop - 1; position >= first; position--) {
      clearOutputGradients()
      // A replaced state is a constant: nothing after it depends on this step, but for the bit "first on its line".
      if (replaced[position] === 1) clearReplacedGradients()
      const at = start + position
      if (position < length) {
        const flags = data.flags[at]!
        if ((flags & codePointNestingScored) !== 0) {
          const depthIndex = data.labelDepth[at]! - depthLow
          depthGradient[depthIndex]! -= labelWeights[position]! * depthWeight / (depthAfter[position * depthCount + depthIndex]! + lossFloor)
          const container = data.labelContainer[at]!
          containerGradient[container] = -labelWeights[position]! * containerWeight / (containers[position * 3 + container]! + lossFloor)
        }
        if ((flags & codePointKindScored) !== 0) {
          const kind = data.labelKind[at]!
          kindGradient[kind] = -labelWeights[position]! * kindWeight / (kinds[position * displayKindCount + kind]! + lossFloor)
        }
        if (intendedTargets && data.intendedLexerAfter[at]! >= 0 && (intendedEverywhere ? (flags & codePointKindScored) !== 0 : (flags & codePointCanFollow) !== 0)) {
          const lexerState = data.intendedLexerAfter[at]!
          const event = data.intendedEvent[at]!
          const grammarState = data.intendedGrammarAfter[at]!
          lexerGradient[lexerState]! -= sampleWeight * intendedLexerWeight / (lexerAfter[position * lexerStateCount + lexerState]! + lossFloor)
          eventGradient[event] = -sampleWeight * intendedEventWeight / (events[position * eventCount + event]! + lossFloor)
          grammarGradient[grammarState]! -= sampleWeight * intendedGrammarWeight / (grammarAfter[position * grammarStateCount + grammarState]! + lossFloor)
        }
      }
      stepBackward(position, position < length ? data.classes[at]! : 0, gradients)
    }
  }

  return {
    depthLow, depthHigh, depthCount,
    setMixes(value: CellArrays) { mixes = value },
    setStateBefore, carry, stepForward, stepBackward, runSample, clearStateGradients, clearOutputGradients,
    // What the steps computed, [position × the array's width + entry].
    lexerBefore, grammarBefore, depthBefore, objectsBefore, firstOnLineBefore, events, tokens, contexts, actions, lexerAfter, grammarAfter, depthAfter, objectsAfter, firstOnLineAfter, kinds, containers, replaced,
    // The gradient arrays, which change places in stepBackward, so read them through these functions.
    stateGradients: () => ({lexer: lexerGradient, grammar: grammarGradient, depth: depthGradient, objects: objectsGradient, firstOnLine: firstOnLineGradient}),
    outputGradients: () => ({events: eventGradient, kinds: kindGradient, containers: containerGradient}),
  }
}

export type TwinRunner = ReturnType<typeof createTwinRunner>

// Runs the samples at places[from] to places[to - 1] and returns what they add up to. With `gradients`, adds the
// gradients by the cells' mixes to it.
export function runBatch(runner: TwinRunner, data: TwinData, places: ArrayLike<number>, from: number, to: number, options: LossOptions, gradients?: CellArrays): LossTally {
  const tally = createTally()
  for (let at = from; at < to; at++) runner.runSample(data, places[at]!, options, tally, gradients)
  return tally
}

export type ObjectiveOptions = LossOptions & {
  // The temperature of the softmaxes. The default is 1.
  temperature?: number
  // The weight of the cost on a mix being far from one choice, see addSharpnessCost. The default is 0.
  sharpnessCost?: number
}

// What training lowers: the loss of the samples at `places` divided by the weight of their scored code points, which
// is the loss per scored code point when every code point weighs 1, plus the sharpness cost. With
// `weightGradients`, writes the gradients by the weights into it. This is the one-thread form. train.ts splits the
// samples over worker threads and puts the parts together in the same way.
export function objective(model: TwinModel, runner: TwinRunner, data: TwinData, places: ArrayLike<number>, options: ObjectiveOptions, mixes: CellArrays, mixGradients?: CellArrays, weightGradients?: CellArrays) {
  const temperature = options.temperature ?? 1
  mixesInto(model, temperature, mixes)
  runner.setMixes(mixes)
  if (mixGradients !== undefined) mixGradients.all.fill(0)
  const tally = runBatch(runner, data, places, 0, places.length, options, mixGradients)
  const scale = tally.weight === 0 ? 1 : 1 / tally.weight
  if (mixGradients !== undefined && weightGradients !== undefined) weightGradientsInto(model, temperature, mixes, mixGradients, scale, weightGradients)
  const sharpnessCost = options.sharpnessCost ?? 0
  const meanEntropy = addSharpnessCost(model, temperature, mixes, sharpnessCost, weightGradients)
  return {value: tally.loss * scale + sharpnessCost * meanEntropy, lossPerCodePoint: tally.loss * scale, meanEntropy, tally}
}
