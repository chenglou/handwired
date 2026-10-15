// The trainable twin of the recovery parser: the same step as recovery-parser.ts, with every state as one number per
// possibility instead of one index, and every table cell as a mix over its choices instead of one choice.
//
// - The tokenizer state is 26 shares, the grammar state 8, the depth one share per depth of a range, and every level
//   1 to 16 of the stack holds the share of "this level is an object".
// - A cell holds a mix: a share per choice. A tokenizer cell has a mix over its next state and a mix over its event. A
//   grammar cell has a mix over its next state and a mix over its stack action. A cell that is not trained holds its
//   one choice as exact 0 and 1.
// - A step multiplies shares and adds the products, see stepForward. With exact tables every share is exactly 0 or 1,
//   and the twin is the exact parser: check-twin.ts compares the two. step-circuit.ts builds the same step as a
//   Handwired circuit, and check-circuit.ts compares the two.
//
// The twin starts at a text's first error with the exact parser's state, since every cell that a text reads before its
// first error is frozen. The loss is the cross-entropy of the display kind, the depth and the container against the
// labels, at the labeled code points from the first damage on. The backward pass is written by hand, see stepBackward,
// and check-gradient.ts compares it with finite differences.
//
// README.md of this folder says where treating the parts of the state as independent loses information.
import {createRandom} from '../../random.ts'
import {capacity, containerArray, containerNone, containerObject, maximumDepth, positionCount} from '../recovery-parser.ts'
import {type RecoveryTables, actionByToken, actionCount, actionNone, actionOfToken, actionPop, actionPushArray, actionPushObject, copyTables, today} from '../recovery-tables.ts'

// The bits of TwinData.flags, as in data.ts.
const codePointLabeled = 1
const codePointKindScored = 2

// The sizes and the fixed tables of a set of tables, which is all a step needs besides the cells' mixes.
export type TwinShape = {
  classCount: number
  lexerStateCount: number
  eventCount: number
  tokenCount: number
  contextCount: number
  grammarStateCount: number
  displayKindCount: number
  lexerCells: number
  grammarCells: number
  // tokenOfEvent[event], and display[event × grammarStateCount + grammar state after], as in RecoveryTables.
  tokenOfEvent: Uint8Array
  display: Uint8Array
}

export function shapeOf(tables: RecoveryTables): TwinShape {
  if (tables.contextCount !== 8) throw new Error(`the twin is written for 8 contexts, and these tables have ${tables.contextCount}`)
  return {
    classCount: tables.classCount, lexerStateCount: tables.lexerStateCount, eventCount: tables.eventCount, tokenCount: tables.tokenCount,
    contextCount: tables.contextCount, grammarStateCount: tables.grammarStateCount, displayKindCount: 1 + Math.max(...tables.display),
    lexerCells: tables.lexerStateCount * tables.classCount, grammarCells: tables.grammarStateCount * tables.tokenCount * tables.contextCount,
    tokenOfEvent: tables.tokenOfEvent.slice(), display: tables.display.slice(),
  }
}

// One number per choice of every cell, in four groups: the tokenizer cells' next states [cell × lexerStateCount + next
// state] and events [cell × eventCount + event], and the grammar cells' next states [cell × grammarStateCount + next
// state] and stack actions [cell × 5 + action]. The same layout holds the trainable weights, the mixes and the
// gradients. `all` is the four groups one after another, e.g. for Adam, and the other fields are views of its parts.
export type CellArrays = {
  all: Float64Array
  lexerNext: Float64Array
  lexerEvent: Float64Array
  grammarNext: Float64Array
  grammarAction: Float64Array
}

export const groupNames = ['lexerNext', 'lexerEvent', 'grammarNext', 'grammarAction'] as const
export type GroupName = typeof groupNames[number]

// How many numbers each group holds per cell.
export const groupWidths = (shape: TwinShape): Record<GroupName, number> =>
  ({lexerNext: shape.lexerStateCount, lexerEvent: shape.eventCount, grammarNext: shape.grammarStateCount, grammarAction: actionCount})

export const cellArraysLength = (shape: TwinShape) =>
  shape.lexerCells * (shape.lexerStateCount + shape.eventCount) + shape.grammarCells * (shape.grammarStateCount + actionCount)

// New arrays of zeros, or views of `buffer`, e.g. of a SharedArrayBuffer that a worker thread also holds.
export function createCellArrays(shape: TwinShape, buffer: ArrayBufferLike = new ArrayBuffer(8 * cellArraysLength(shape))): CellArrays {
  const lengths = [shape.lexerCells * shape.lexerStateCount, shape.lexerCells * shape.eventCount, shape.grammarCells * shape.grammarStateCount, shape.grammarCells * actionCount]
  const offsets = [0, lengths[0]!, lengths[0]! + lengths[1]!, lengths[0]! + lengths[1]! + lengths[2]!]
  const view = (group: number) => new Float64Array(buffer, 8 * offsets[group]!, lengths[group])
  return {all: new Float64Array(buffer, 0, cellArraysLength(shape)), lexerNext: view(0), lexerEvent: view(1), grammarNext: view(2), grammarAction: view(3)}
}

// The tables with trainable cells. A cell that is not trainable holds the choice of `base`, e.g. today's tables, or
// tables with a hand-written recovery. A trainable cell's mix over the choices of a group is the softmax of the
// group's weights for that cell, divided by a temperature.
export type TwinModel = {
  base: RecoveryTables
  shape: TwinShape
  // 1 where a cell is trainable. Only open cells can be.
  trainableLexer: Uint8Array
  trainableGrammar: Uint8Array
  weights: CellArrays
}

export type ModelOptions = {
  // The trainable cells, e.g. a tenth of the open cells. Without it, every open cell.
  trainable?: {lexer: Uint8Array, grammar: Uint8Array}
  // Where the weights start. 'base': every trainable mix gives `startShare` to the choice of the base tables and
  // splits the rest evenly over the other choices. 'uniform': every choice of a trainable mix has the same share.
  start?: 'base' | 'uniform'
  // From 0 to 1, both excluded. The default is 0.9.
  startShare?: number
}

// Per group: its width, the mask of trainable cells and the base tables' choices.
function groupsOf(model: TwinModel) {
  const widths = groupWidths(model.shape)
  return [
    {name: 'lexerNext', width: widths.lexerNext, trainable: model.trainableLexer, choice: model.base.lexerNext},
    {name: 'lexerEvent', width: widths.lexerEvent, trainable: model.trainableLexer, choice: model.base.lexerEvent},
    {name: 'grammarNext', width: widths.grammarNext, trainable: model.trainableGrammar, choice: model.base.grammarNext},
    {name: 'grammarAction', width: widths.grammarAction, trainable: model.trainableGrammar, choice: model.base.grammarAction},
  ] as const
}

export function createModel(base: RecoveryTables, options: ModelOptions = {}): TwinModel {
  const shape = shapeOf(base)
  const trainableLexer = (options.trainable?.lexer ?? base.lexerOpen).slice()
  const trainableGrammar = (options.trainable?.grammar ?? base.grammarOpen).slice()
  if (trainableLexer.length !== shape.lexerCells || trainableGrammar.length !== shape.grammarCells) throw new Error('the masks of trainable cells do not have one entry per cell')
  for (let cell = 0; cell < shape.lexerCells; cell++) if (trainableLexer[cell] === 1 && base.lexerOpen[cell] === 0) throw new Error(`the tokenizer cell ${cell} is frozen, and cannot be trainable`)
  for (let cell = 0; cell < shape.grammarCells; cell++) if (trainableGrammar[cell] === 1 && base.grammarOpen[cell] === 0) throw new Error(`the grammar cell ${cell} is frozen, and cannot be trainable`)
  const model: TwinModel = {base: copyTables(base), shape, trainableLexer, trainableGrammar, weights: createCellArrays(shape)}
  const startShare = options.startShare ?? 0.9
  if (!(startShare > 0 && startShare < 1)) throw new Error(`startShare has to be between 0 and 1, and is ${startShare}`)
  if ((options.start ?? 'base') === 'base') {
    for (const group of groupsOf(model)) {
      // softmax gives the base choice the share s when its weight is ln(s / (1 - s) × (choices - 1)) and the others are 0.
      const weight = Math.log(startShare / (1 - startShare) * (group.width - 1))
      for (let cell = 0; cell < group.trainable.length; cell++) if (group.trainable[cell] === 1) model.weights[group.name][cell * group.width + group.choice[cell]!] = weight
    }
  }
  return model
}

// Writes every cell's mix into `mixes`: softmax(weights / temperature) for a trainable cell, and exact 0 and 1 for
// every other cell.
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
      for (let choice = 0; choice < width; choice++) if (weights[row + choice]! > largest) largest = weights[row + choice]!
      let total = 0
      for (let choice = 0; choice < width; choice++) {
        const share = Math.exp((weights[row + choice]! - largest) / temperature)
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
// trainable mixes, two per trainable cell, and with `weightGradients`, adds `weight` times its gradient to it.
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
      for (let choice = 0; choice < width; choice++) if (weights[row + choice]! > weights[row + best]!) best = choice
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
  // The sample's index in the dataset, e.g. for the random draws of one sample.
  index: Int32Array
  // The code points of sample s are the entries start[s] to start[s + 1] - 1 of the arrays per code point.
  start: Int32Array
  firstDamage: Int32Array
  // The position of the first error, where the twin starts, and the exact parser's state before that position: the
  // tokenizer state, the grammar state, the depth, and bit l - 1 of startObjects is 1 when level l is an object.
  firstError: Int32Array
  startLexerState: Uint8Array
  startGrammarState: Uint8Array
  startDepth: Int8Array
  startObjects: Uint16Array
  // Per code point: its class, and the flags, labels and intended states of data.ts.
  classes: Uint8Array
  flags: Uint8Array
  labelKind: Int8Array
  labelDepth: Int8Array
  labelContainer: Int8Array
  intendedLexerAfter: Int8Array
  intendedEvent: Int8Array
  intendedGrammarAfter: Int8Array
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
  // Extra targets from intended.ts, at kept code points whose display kind is scored: the cross-entropy of the
  // tokenizer state after the code point, of the event, and of the grammar state after it. The default is 0 each.
  intendedLexerWeight?: number
  intendedEventWeight?: number
  intendedGrammarWeight?: number
  // Keeping the run on track: after a kept code point, with this probability, the twin's state is replaced by the
  // intended state, i.e. the state of today's parser after the code point's counterpart in the original. Gradients do
  // not cross a replaced state. The default is 0. It needs TwinData.intendedObjects.
  onTrackProbability?: number
  // The seed of the draws for onTrackProbability. A sample's draws depend on this seed and on the sample's index.
  onTrackSeed?: number
}

// What a batch adds up: the loss, how many labeled code points it counts, and its parts.
export type LossTally = {
  // Samples that the twin ran, i.e. that have a code point at or after their first error.
  samples: number
  // Labeled code points at or after both the first damage and the first error: the ones whose loss the open cells can
  // change. The loss per code point is `loss / codePoints`.
  codePoints: number
  // Steps that the twin took.
  positions: number
  loss: number
  kindLoss: number
  depthLoss: number
  containerLoss: number
  intendedLoss: number
  // How many states were replaced by the intended state.
  replaced: number
}

export const createTally = (): LossTally => ({samples: 0, codePoints: 0, positions: 0, loss: 0, kindLoss: 0, depthLoss: 0, containerLoss: 0, intendedLoss: 0, replaced: 0})
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
  const {classCount, lexerStateCount, eventCount, tokenCount, contextCount, grammarStateCount, displayKindCount, tokenOfEvent, display} = shape
  const depthCount = depthHigh - depthLow + 1
  const numbers = (perPosition: number) => new Float64Array(positions * perPosition)
  // The state before each position: the shares of the tokenizer states, of the grammar states and of the depths, and
  // per level 1 to 16 the share of "this level is an object" (entry 0 of a position's levels is not used).
  const lexerBefore = numbers(lexerStateCount)
  const grammarBefore = numbers(grammarStateCount)
  const depthBefore = numbers(depthCount)
  const objectsBefore = numbers(levelCount)
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
  const eventGradient = new Float64Array(eventCount)
  const kindGradient = new Float64Array(displayKindCount)
  const containerGradient = new Float64Array(3)
  const tokenGradient = new Float64Array(tokenCount)
  const contextGradient = new Float64Array(contextCount)
  const actionGradient = new Float64Array(actionCount)

  const depthClassCount = contextCount / 2
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
  }

  // One step: from the state before `position` and the class of its code point to everything the step computes.
  function stepForward(position: number, characterClass: number) {
    const lexerEventMix = mixes!.lexerEvent
    const lexerNextMix = mixes!.lexerNext
    const grammarNextMix = mixes!.grammarNext
    const grammarActionMix = mixes!.grammarAction
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

    // The display kind's mix follows from the event's and the next grammar state's.
    for (let kind = 0; kind < displayKindCount; kind++) kinds[kindBase + kind] = 0
    for (let event = 0; event < eventCount; event++) {
      const share = events[eventBase + event]!
      if (share === 0) continue
      const row = event * grammarStateCount
      for (let next = 0; next < grammarStateCount; next++) kinds[kindBase + display[row + next]!]! += share * grammarAfter[grammarBase + next]!
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
      for (let event = 0; event < eventCount; event++) {
        const share = events[eventBase + event]!
        const row = event * grammarStateCount
        for (let next = 0; next < grammarStateCount; next++) {
          const gradient = kindGradient[display[row + next]!]!
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

  function clearStateGradients() {
    lexerGradient.fill(0)
    grammarGradient.fill(0)
    depthGradient.fill(0)
    objectsGradient.fill(0)
  }
  function clearOutputGradients() {
    eventGradient.fill(0)
    kindGradient.fill(0)
    containerGradient.fill(0)
  }

  // Runs the twin on one sample, from its first error to the last of its code points, or to position `end` - 1 with
  // `end` given, e.g. 513 for the positions after the text too. Adds the sample's loss to `tally`, and with
  // `gradients`, the gradients of the loss by the cells' mixes to it. Neither is divided by the number of code points.
  function runSample(data: TwinData, place: number, options: LossOptions, tally: LossTally, gradients?: CellArrays, end?: number) {
    const start = data.start[place]!
    const length = data.start[place + 1]! - start
    const first = data.firstError[place]!
    const stop = end ?? length
    if (first < 0 || first >= stop) return
    const firstDamage = data.firstDamage[place]!
    const kindWeight = options.kindWeight ?? 1
    const depthWeight = options.depthWeight ?? 1
    const containerWeight = options.containerWeight ?? 1
    const intendedLexerWeight = options.intendedLexerWeight ?? 0
    const intendedEventWeight = options.intendedEventWeight ?? 0
    const intendedGrammarWeight = options.intendedGrammarWeight ?? 0
    const intendedTargets = intendedLexerWeight !== 0 || intendedEventWeight !== 0 || intendedGrammarWeight !== 0
    const onTrackProbability = options.onTrackProbability ?? 0
    if (onTrackProbability > 0 && !data.hasIntendedObjects) throw new Error('keeping the run on track needs the intended stacks, see twin-data.ts')
    const random = onTrackProbability > 0 ? createRandom(options.onTrackSeed ?? 0, data.index[place]!) : undefined

    tally.samples++
    setStateBefore(first, data.startLexerState[place]!, data.startGrammarState[place]!, data.startDepth[place]!, data.startObjects[place]!)
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
      if (position >= firstDamage && (flags & codePointLabeled) !== 0) {
        tally.codePoints++
        const depthIndex = data.labelDepth[at]! - depthLow
        const depthLoss = -depthWeight * Math.log(depthAfter[position * depthCount + depthIndex]! + lossFloor)
        const containerLoss = -containerWeight * Math.log(containers[position * 3 + data.labelContainer[at]!]! + lossFloor)
        tally.depthLoss += depthLoss
        tally.containerLoss += containerLoss
        tally.loss += depthLoss + containerLoss
        if ((flags & codePointKindScored) !== 0) {
          const kindLoss = -kindWeight * Math.log(kinds[position * displayKindCount + data.labelKind[at]!]! + lossFloor)
          tally.kindLoss += kindLoss
          tally.loss += kindLoss
          if (intendedTargets && data.intendedLexerAfter[at]! >= 0) {
            const intendedLoss = -intendedLexerWeight * Math.log(lexerAfter[position * lexerStateCount + data.intendedLexerAfter[at]!]! + lossFloor)
              - intendedEventWeight * Math.log(events[position * eventCount + data.intendedEvent[at]!]! + lossFloor)
              - intendedGrammarWeight * Math.log(grammarAfter[position * grammarStateCount + data.intendedGrammarAfter[at]!]! + lossFloor)
            tally.intendedLoss += intendedLoss
            tally.loss += intendedLoss
          }
        }
      }
      // Keeping the run on track: one draw per kept code point.
      const replace = random !== undefined && data.intendedLexerAfter[at]! >= 0 && random.next() < onTrackProbability
      if (replace) {
        replaced[position] = 1
        tally.replaced++
      }
      if (position + 1 < stop) {
        if (replace) setStateBefore(position + 1, data.intendedLexerAfter[at]!, data.intendedGrammarAfter[at]!, data.labelDepth[at]!, data.intendedObjects[at]!)
        else carry(position)
      }
    }
    if (gradients === undefined) return

    clearStateGradients()
    for (let position = stop - 1; position >= first; position--) {
      clearOutputGradients()
      // A replaced state is a constant: nothing after it depends on this step.
      if (replaced[position] === 1) clearStateGradients()
      const at = start + position
      if (position < length) {
        const flags = data.flags[at]!
        if (position >= firstDamage && (flags & codePointLabeled) !== 0) {
          const depthIndex = data.labelDepth[at]! - depthLow
          depthGradient[depthIndex]! -= depthWeight / (depthAfter[position * depthCount + depthIndex]! + lossFloor)
          const container = data.labelContainer[at]!
          containerGradient[container] = -containerWeight / (containers[position * 3 + container]! + lossFloor)
          if ((flags & codePointKindScored) !== 0) {
            const kind = data.labelKind[at]!
            kindGradient[kind] = -kindWeight / (kinds[position * displayKindCount + kind]! + lossFloor)
            if (intendedTargets && data.intendedLexerAfter[at]! >= 0) {
              const lexerState = data.intendedLexerAfter[at]!
              const event = data.intendedEvent[at]!
              const grammarState = data.intendedGrammarAfter[at]!
              lexerGradient[lexerState]! -= intendedLexerWeight / (lexerAfter[position * lexerStateCount + lexerState]! + lossFloor)
              eventGradient[event] = -intendedEventWeight / (events[position * eventCount + event]! + lossFloor)
              grammarGradient[grammarState]! -= intendedGrammarWeight / (grammarAfter[position * grammarStateCount + grammarState]! + lossFloor)
            }
          }
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
    lexerBefore, grammarBefore, depthBefore, objectsBefore, events, tokens, contexts, actions, lexerAfter, grammarAfter, depthAfter, objectsAfter, kinds, containers, replaced,
    // The gradient arrays, which change places in stepBackward, so read them through these functions.
    stateGradients: () => ({lexer: lexerGradient, grammar: grammarGradient, depth: depthGradient, objects: objectsGradient}),
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

// What training lowers: the loss per labeled code point of the samples at `places`, plus the sharpness cost. With
// `weightGradients`, writes the gradients by the weights into it. This is the one-thread form. train.ts splits the
// samples over worker threads and puts the parts together in the same way.
export function objective(model: TwinModel, runner: TwinRunner, data: TwinData, places: ArrayLike<number>, options: ObjectiveOptions, mixes: CellArrays, mixGradients?: CellArrays, weightGradients?: CellArrays) {
  const temperature = options.temperature ?? 1
  mixesInto(model, temperature, mixes)
  runner.setMixes(mixes)
  if (mixGradients !== undefined) mixGradients.all.fill(0)
  const tally = runBatch(runner, data, places, 0, places.length, options, mixGradients)
  const scale = 1 / Math.max(1, tally.codePoints)
  if (mixGradients !== undefined && weightGradients !== undefined) weightGradientsInto(model, temperature, mixes, mixGradients, scale, weightGradients)
  const sharpnessCost = options.sharpnessCost ?? 0
  const meanEntropy = addSharpnessCost(model, temperature, mixes, sharpnessCost, weightGradients)
  return {value: tally.loss * scale + sharpnessCost * meanEntropy, lossPerCodePoint: tally.loss * scale, meanEntropy, tally}
}
