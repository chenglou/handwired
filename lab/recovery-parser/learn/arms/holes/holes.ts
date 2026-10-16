// What the scripts of the arm "holes" share: the decisions of the hand-written tables, a random share of them as
// blanks, the trainer's setting, and the comparison of a cell's choice with the hand-written one.
//
// A decision is a cell in which the hand-written tables of ../../handwritten/rules.ts hold another choice than
// today's tables. A blank is a decision that is taken back: the cell holds today's choice again, and a run may fill
// it. README.md says what the arm asks and what it found.
import {createRandom} from '../../../random.ts'
import {handwrittenTables} from '../../handwritten/rules.ts'
import {createTrace} from '../../recovery-parser.ts'
import {type RecoveryTables, actionByToken, actionOfToken, asIsTables, copyTables} from '../../recovery-tables.ts'
import {runOnSample} from '../../score.ts'
import {train} from '../../soft/train.ts'
import {type TwinData, createModel} from '../../soft/twin.ts'
import {trainPartOfTheStandardSet} from '../harness.ts'

// A cell of the tokenizer's table or of the grammar's table, by its index in that table.
export type Cell = {grammar: boolean, cell: number}

// The stack action of a grammar cell as what it does: an action that does what the cell's token does by itself is
// `by token`, e.g. `pop` in a cell of a closing bracket, and `none` in a cell of a comma. The parser cannot tell the
// two apart, so no run can either.
function actionInEffect(tables: RecoveryTables, cell: number) {
  const token = Math.floor(cell / tables.contextCount) % tables.tokenCount
  const action = tables.grammarAction[cell]!
  return action === actionOfToken[token] ? actionByToken : action
}

// Whether two tables hold the same choice in a cell: both parts of the choice, the next state and the event of a
// tokenizer cell, or the next state and what the stack action does of a grammar cell.
export function sameChoice(first: RecoveryTables, second: RecoveryTables, {grammar, cell}: Cell): boolean {
  if (grammar) return first.grammarNext[cell] === second.grammarNext[cell] && actionInEffect(first, cell) === actionInEffect(second, cell)
  return first.lexerNext[cell] === second.lexerNext[cell] && first.lexerEvent[cell] === second.lexerEvent[cell]
}

// Writes the choice that `from` hold in a cell into `tables`.
function copyChoice(tables: RecoveryTables, from: RecoveryTables, {grammar, cell}: Cell) {
  if (grammar) {
    tables.grammarNext[cell] = from.grammarNext[cell]!
    tables.grammarAction[cell] = from.grammarAction[cell]!
  } else {
    tables.lexerNext[cell] = from.lexerNext[cell]!
    tables.lexerEvent[cell] = from.lexerEvent[cell]!
  }
}

export const handTables = (): RecoveryTables => handwrittenTables().tables

// The shares of blanked decisions that run.ts reports, in percent. Each share is an arm of its own for the harness,
// e.g. "holes-10", so that the shares can run at the same time: a run of the harness moves the files of an earlier
// run of the same name away.
export const sharesOfTheArm = [10, 25, 50, 100] as const
export const armNameOf = (sharePercent: number) => `holes-${sharePercent}`
// The seed whose blanks the settings with fixed blanks use for every seed, so that their seeds only order the
// training and the search.
export const seedOfTheFixedBlanks = 1
// The names of a share's settings, which are also the names of their rows.
export const settingNamesOf = (sharePercent: number) => ({
  notFilled: `${sharePercent}% blanked, not filled`,
  trained: `${sharePercent}% blanked, trained`,
  searched: `${sharePercent}% blanked, searched`,
  trainedOnFixedBlanks: `${sharePercent}% blanked as with seed ${seedOfTheFixedBlanks}, trained`,
  searchedOnFixedBlanks: `${sharePercent}% blanked as with seed ${seedOfTheFixedBlanks}, searched`,
  searchedMostReadFirst: `${sharePercent}% blanked, searched with the most read cells first`,
  everyOpenCellTrained: 'every open cell trainable, the same setting of the trainer',
})

// The decisions of the hand-written tables: tokenizer cells first, then grammar cells, each in the order of the table.
export function decisionsOf(hand: RecoveryTables): Cell[] {
  const todays = asIsTables()
  const decisions: Cell[] = []
  for (let cell = 0; cell < hand.lexerNext.length; cell++) if (!sameChoice(hand, todays, {grammar: false, cell})) decisions.push({grammar: false, cell})
  for (let cell = 0; cell < hand.grammarNext.length; cell++) if (!sameChoice(hand, todays, {grammar: true, cell})) decisions.push({grammar: true, cell})
  return decisions
}

// The random stream of the draw of the blanks. The trainer orders the samples of its pass p with the stream p of the
// same seed, so the draw has a stream that no pass uses.
const streamOfTheBlanks = 1_000_000

export type Blanks = {
  // The blanked cells, in the order of decisionsOf.
  cells: Cell[]
  // The hand-written tables with today's choice in every blanked cell: the tables that a run starts from.
  base: RecoveryTables
  // The blanked cells as the masks of trainable cells that createModel takes.
  trainable: {lexer: Uint8Array, grammar: Uint8Array, display: 'none'}
}

// A random share of the decisions of the hand-written tables as blanks, e.g. 92 of the 915 for 10 percent: the count
// is the share of the decisions, rounded, and the seed picks which ones. With 100 percent every decision is a blank,
// whatever the seed is, and the base is today's tables.
export function blanksOf(sharePercent: number, seed: number): Blanks {
  if (!(sharePercent > 0 && sharePercent <= 100)) throw new Error(`the share of blanked decisions is a percentage above 0 and up to 100, and got ${sharePercent}`)
  const hand = handTables()
  const decisions = decisionsOf(hand)
  const count = Math.round(decisions.length * sharePercent / 100)
  const drawn = new Set(createRandom(seed, streamOfTheBlanks).shuffled(decisions).slice(0, count))
  const cells = decisions.filter(decision => drawn.has(decision))
  const todays = asIsTables()
  const base = copyTables(hand)
  const trainable = {lexer: new Uint8Array(hand.lexerNext.length), grammar: new Uint8Array(hand.grammarNext.length), display: 'none' as const}
  for (const blank of cells) {
    copyChoice(base, todays, blank)
    trainable[blank.grammar ? 'grammar' : 'lexer'][blank.cell] = 1
  }
  return {cells, base, trainable}
}

// What the arm sets of the trainer of ../../soft/train.ts. Everything else is the trainer's default.
export type TrainerSetting = {
  // Passes over the train samples.
  passes: number
  // 'base': the mix of a blanked cell starts with a share of 0.9 on today's choice, which the cell holds in the base.
  // 'uniform': every choice of a blanked cell starts with the same share.
  start: 'base' | 'uniform'
  learningRate: number
  // The temperature of the mixes at the last sample. It starts at 1.
  temperatureEnd: number
  // The weight of the cost on a mix being far from one choice.
  sharpnessCost: number
}

// The one setting of the reported runs. tune.ts tried 13 settings on the share 10 with the seeds 11, 12 and 13, and
// their means are within 0.2 points of each other on the validation split. The range of this one overlaps the range
// of each of the other 12, so it was taken for its cost and for its start, not for its score: a uniform start is
// the honest blank, and 3 passes are not told apart from 10. README.md has all 13 rows.
export const trainerSetting: TrainerSetting = {passes: 3, start: 'uniform', learningRate: 0.05, temperatureEnd: 1, sharpnessCost: 0}

export const describeTrainerSetting = (setting: TrainerSetting) =>
  `${setting.passes} pass${setting.passes === 1 ? '' : 'es'}, ${setting.start === 'base' ? 'start at today\'s choice' : 'uniform start'}, learning rate ${setting.learningRate}, temperature 1 to ${setting.temperatureEnd}, sharpness cost ${setting.sharpnessCost}`

// Trains the trainable cells of `base` on the train samples of `data` and returns the last snapped tables. The model
// is made here, once per call: `train` changes the model that it is given.
export async function trainCells(base: RecoveryTables, trainable: Blanks['trainable'] | undefined, data: TwinData, seed: number, setting: TrainerSetting): Promise<RecoveryTables> {
  const model = createModel(base, {start: setting.start, ...(trainable === undefined ? {} : {trainable})})
  const result = await train(model, data, {
    seed, epochs: setting.passes, learningRate: setting.learningRate, temperatureStart: 1, temperatureEnd: setting.temperatureEnd, sharpnessCost: setting.sharpnessCost,
    logEverySamples: 1e9, log: () => {},
  })
  return result.last
}

// How many broken train samples of the standard set read each cell when the exact parser runs them with `tables`.
export type Readers = {lexer: Int32Array, grammar: Int32Array}
export function trainReadersOf(tables: RecoveryTables): Readers {
  const train = trainPartOfTheStandardSet()
  const readers = {lexer: new Int32Array(tables.lexerNext.length), grammar: new Int32Array(tables.grammarNext.length)}
  // The last sample that was counted for a cell, so that a sample that reads a cell twice counts once.
  const lastCounted = {lexer: new Int32Array(tables.lexerNext.length).fill(-1), grammar: new Int32Array(tables.grammarNext.length).fill(-1)}
  const trace = createTrace()
  for (let place = 0; place < train.sampleCount; place++) {
    if (train.firstDamage[place] === -1) continue
    runOnSample(trace, train, place, tables)
    const length = train.start[place + 1]! - train.start[place]!
    for (let position = 0; position < length; position++) {
      const lexerCell = trace.lexerCell[position]!
      const grammarCell = trace.grammarCell[position]!
      if (lastCounted.lexer[lexerCell] !== place) {
        lastCounted.lexer[lexerCell] = place
        readers.lexer[lexerCell]!++
      }
      if (lastCounted.grammar[grammarCell] !== place) {
        lastCounted.grammar[grammarCell] = place
        readers.grammar[grammarCell]!++
      }
    }
  }
  return readers
}
export const readersOf = (readers: Readers, {grammar, cell}: Cell) => (grammar ? readers.grammar : readers.lexer)[cell]!
