// What the scripts of the arm "spare states" share: the tables with spare states, where the weights of a run start,
// the trainer's settings, and the test of a spare state: the same tables without it.
//
// A spare state is a tokenizer state or a grammar state that today's tables do not have, e.g. the tokenizer state 26.
// Every cell of a spare state is open, and in the base no cell leads into one. README.md says what the arm asks and
// what it found.
import {handRuleTables} from '../../../hand-rules.ts'
import {createRandom} from '../../../random.ts'
import {type Samples, selectSamples} from '../../data.ts'
import {handwrittenTables} from '../../handwritten/rules.ts'
import {recoveryTablesOf} from '../../plain-tables.ts'
import {createTrace} from '../../recovery-parser.ts'
import {type RecoveryTables, actionCount, addStates, asIsTables, copyTables, grammarStateName, grammarStateNames, lexerStateName, lexerStateNames, today} from '../../recovery-tables.ts'
import {type CellsRead, cellsReadAt, runOnSample, scoreTables} from '../../score.ts'
import {train} from '../../soft/train.ts'
import {type TwinData, type TwinModel, createModel} from '../../soft/twin.ts'

// What the arm sets of the trainer of ../../soft/train.ts. Everything else is the trainer's default.
export type TrainerSetting = {
  // Passes over the train samples.
  passes: number
  // 'base': a trainable mix starts with a share of 0.9 on the choice of the base. 'uniform': every choice of a
  // trainable mix starts with the same share.
  start: 'base' | 'uniform'
  learningRate: number
  // The temperature of the mixes at the last sample. It starts at 1.
  temperatureEnd: number
  // The weight of the cost on a mix being far from one choice.
  sharpnessCost: number
}

// The two settings of the reported runs: the plain pass of ../plain-pass/, and the setting that the arm "holes" chose.
export const namedTrainerSettings: Record<string, TrainerSetting> = {
  plain: {passes: 1, start: 'base', learningRate: 0.05, temperatureEnd: 1, sharpnessCost: 0},
  'three-passes': {passes: 3, start: 'uniform', learningRate: 0.05, temperatureEnd: 1, sharpnessCost: 0},
}

// The trainer's setting of an option `--trainer`: one of the names above, or five values with commas, the passes, the
// start, the learning rate, the temperature at the end and the sharpness cost, e.g. "10,uniform,0.02,0.5,0.01".
export function trainerSettingOf(option: string): TrainerSetting {
  const named = namedTrainerSettings[option]
  if (named !== undefined) return named
  const [passes, start, learningRate, temperatureEnd, sharpnessCost] = option.split(',')
  const setting = {passes: Number(passes), start, learningRate: Number(learningRate), temperatureEnd: Number(temperatureEnd), sharpnessCost: Number(sharpnessCost)}
  if (!(setting.passes >= 1) || (start !== 'base' && start !== 'uniform') || !(setting.learningRate > 0) || !(setting.temperatureEnd > 0) || !(setting.sharpnessCost >= 0)) {
    throw new Error(`--trainer takes ${Object.keys(namedTrainerSettings).join(' or ')}, or five values like 3,uniform,0.05,1,0 (passes, start, learning rate, temperature at the end, sharpness cost), and got ${option}`)
  }
  return {...setting, start}
}

// A trainer's setting in words, e.g. "1 pass from the base's choices". What is not the trainer's default is named.
export function describeTrainer(setting: TrainerSetting) {
  const others = [
    ...(setting.learningRate === 0.05 ? [] : [`learning rate ${setting.learningRate}`]), ...(setting.temperatureEnd === 1 ? [] : [`temperature 1 to ${setting.temperatureEnd}`]),
    ...(setting.sharpnessCost === 0 ? [] : [`sharpness cost ${setting.sharpnessCost}`]),
  ]
  return `${setting.passes} pass${setting.passes === 1 ? '' : 'es'} from ${setting.start === 'base' ? 'the base\'s choices' : 'a uniform start'}${others.length === 0 ? '' : `, ${others.join(', ')}`}`
}

// The two kinds of run:
// - 'today': the base is today's tables with spare states, and every open cell is trainable.
// - 'hand-written': the base is the hand-written tables of ../../handwritten/rules.ts with spare states. Only the
//   spare states' cells are trainable, and whether an open cell of another state leads into a spare state: such a
//   cell keeps its event or its stack action, and its next state is the hand-written one or a spare state.
// - 'words': the same with the dataset's hand rule `words` as the tables that a person wrote. The dataset's hand
//   rule `lines` is `words` with one more tokenizer state, so this kind asks whether training finds a state that is
//   known to help.
export type BaseKind = 'today' | 'hand-written' | 'words'
// The kind of an option `--base`, which is `today` when the option is left out.
export function baseKindOf(option: string | undefined): BaseKind {
  if (option === undefined || option === 'today') return 'today'
  if (option === 'hand-written' || option === 'words') return option
  throw new Error(`--base takes today, hand-written or words, and got ${option}`)
}

// How many spare tokenizer states and spare grammar states a run has.
export type SpareCounts = {tokenizer: number, grammar: number}

// The column of the display table that each spare grammar state copies. The display table has two kinds of columns:
// the one of the state `colon`, which shows a string as a key, and every other one, which shows it as a string. The
// spare grammar states take them in turn, the first one the column of `colon`, since today's tables have one state
// that shows a key and seven that show a string.
export const shownAsOf = (spareGrammarStates: number) => Array.from({length: spareGrammarStates}, (_, index) => grammarStateNames.indexOf(index % 2 === 0 ? 'colon' : 'commaOrClose'))

// The tables that a run starts from. A spare tokenizer state is a copy of the base's state `errorLine`, and a spare
// grammar state a copy of its state `error`, as addStates makes them.
export function baseOf(kind: BaseKind, spare: SpareCounts): RecoveryTables {
  const withoutSpareStates = kind === 'today' ? asIsTables() : kind === 'hand-written' ? handwrittenTables().tables : recoveryTablesOf(handRuleTables('words'))
  return addStates(withoutSpareStates, spare.tokenizer, shownAsOf(spare.grammar))
}

// The default size of the random part of a spare state's start, see createSpareModel. README.md has the sizes that
// were tried.
export const defaultNoise = 1

// The rows of a score that the arm reports, as a record names them, each with a short name: all samples, the group
// that today's layout can label, four other groups of the dataset, and the two kinds of damage in which tables
// written by hand gained from a state: keys without quotes, and a document per line.
export const reportedRows = [
  {row: 'all', label: 'all'},
  {row: 'group: within reach of the tables', label: 'within reach'},
  {row: 'group: needs a line rule', label: 'needs a line rule'},
  {row: 'group: needs a character class', label: 'needs a character class'},
  {row: 'group: needs a nesting fix', label: 'needs a nesting fix'},
  {row: 'group: out of reach', label: 'out of reach'},
  {row: 'kind: unquotedKey', label: 'unquotedKey'},
  {row: 'kind: newlineDelimited', label: 'newlineDelimited'},
] as const

// The spare states and the base of a run in words, e.g. "2 spare tokenizer states beside the hand-written rules".
function describeStates(kind: BaseKind, spare: SpareCounts) {
  const states = (count: number, table: string) => `${count} spare ${table} state${count === 1 ? '' : 's'}`
  const spareStates = spare.tokenizer + spare.grammar === 0 ? 'no spare state'
    : [...(spare.tokenizer === 0 ? [] : [states(spare.tokenizer, 'tokenizer')]), ...(spare.grammar === 0 ? [] : [states(spare.grammar, 'grammar')])].join(' and ')
  return `${spareStates}${kind === 'today' ? '' : kind === 'hand-written' ? ' beside the hand-written rules' : ' beside the dataset\'s hand rule words'}`
}

// The name of a run's row, which is also the name of its folder, e.g. "2 spare tokenizer states, 1 pass from the
// base's choices".
export const settingNameOf = (kind: BaseKind, spare: SpareCounts, trainer: TrainerSetting, noise: number = defaultNoise) =>
  `${describeStates(kind, spare)}, ${describeTrainer(trainer)}${noise === defaultNoise ? '' : `, noise ${noise}`}`

// The name of a row of search.ts, e.g. "2 spare tokenizer states, searched in a random order".
export const searchSettingNameOf = (kind: BaseKind, spare: SpareCounts, order: 'most read first' | 'random') =>
  `${describeStates(kind, spare)}, searched ${order === 'random' ? 'in a random order' : 'with the most read cells first'}`

// The random stream of a spare state's start. The trainer orders the samples of its pass p with the stream p of the
// same seed, so the start has a stream that no pass uses.
const streamOfTheStart = 2_000_000

// The model of a run, with the start of the spare states.
//
// How a spare state gets a share: in the base no cell leads into a spare state, but a trainable cell holds a mix
// over every next state, the spare ones among them. So from the first step on, a part of every trainable cell's mix
// leads into each spare state, and a part of the loss's gradient reaches the spare state's own cells.
//
// How spare states come to differ: two spare states that start with the same weights get the same gradients, stay
// the same state, and snap to one state. So every weight of a spare state's own cells, and every weight with which
// another cell leads into a spare state, starts with a random number added: `noise` times a draw of the standard
// normal distribution, from the run's seed.
//
// With the kinds 'hand-written' and 'words', a trainable cell of a state that is not spare can only keep the base's
// choice or lead into a spare state: every other next state, every other event and every other stack action has the weight
// -Infinity, which is the share 0, and a weight with the share 0 has the gradient 0, so it stays there.
export function createSpareModel(base: RecoveryTables, kind: BaseKind, seed: number, trainer: TrainerSetting, noise: number = defaultNoise): TwinModel {
  const model = createModel(base, {start: trainer.start, trainable: {lexer: 'open', grammar: 'open', display: 'none'}})
  const random = createRandom(seed, streamOfTheStart)
  const normal = () => Math.sqrt(-2 * Math.log(1 - random.next())) * Math.cos(2 * Math.PI * random.next())
  const onlyIntoSpare = kind !== 'today'
  // One table's cells: its two groups of weights with their widths, the base's choices, and the first spare state.
  const startOf = (trainable: Uint8Array, cellsPerState: number, firstSpare: number, next: {weights: Float64Array, width: number, choice: Uint8Array}, other: {weights: Float64Array, width: number, choice: Uint8Array}) => {
    for (let cell = 0; cell < trainable.length; cell++) {
      if (trainable[cell] === 0) continue
      if (Math.floor(cell / cellsPerState) >= firstSpare) {
        for (const group of [next, other]) for (let choice = 0; choice < group.width; choice++) group.weights[cell * group.width + choice]! += noise * normal()
        continue
      }
      if (onlyIntoSpare) {
        for (let state = 0; state < firstSpare; state++) if (state !== next.choice[cell]) next.weights[cell * next.width + state] = -Infinity
        for (let choice = 0; choice < other.width; choice++) if (choice !== other.choice[cell]) other.weights[cell * other.width + choice] = -Infinity
      }
      for (let state = firstSpare; state < next.width; state++) next.weights[cell * next.width + state]! += noise * normal()
    }
  }
  startOf(model.trainableLexer, base.classCount, today.lexerStateCount, {weights: model.weights.lexerNext, width: base.lexerStateCount, choice: base.lexerNext}, {weights: model.weights.lexerEvent, width: base.eventCount, choice: base.lexerEvent})
  startOf(model.trainableGrammar, base.tokenCount * base.contextCount, today.grammarStateCount, {weights: model.weights.grammarNext, width: base.grammarStateCount, choice: base.grammarNext}, {weights: model.weights.grammarAction, width: actionCount, choice: base.grammarAction})
  return model
}

// Trains the model of a run on the train samples of `data` and returns the last snapped tables. The model is made
// here, once per call: `train` changes the model that it is given.
export async function trainSpare(base: RecoveryTables, kind: BaseKind, data: TwinData, seed: number, trainer: TrainerSetting, noise: number = defaultNoise): Promise<RecoveryTables> {
  const model = createSpareModel(base, kind, seed, trainer, noise)
  const result = await train(model, data, {
    seed, epochs: trainer.passes, learningRate: trainer.learningRate, temperatureStart: 1, temperatureEnd: trainer.temperatureEnd, sharpnessCost: trainer.sharpnessCost, logEverySamples: 1e9, log: () => {},
  })
  return result.last
}

// A spare state of some tables, by its number in the tokenizer's states or in the grammar's states.
export type SpareState = {grammar: boolean, state: number}
export const spareStatesOf = (tables: RecoveryTables): SpareState[] => [
  ...Array.from({length: tables.lexerStateCount - today.lexerStateCount}, (_, index) => ({grammar: false, state: today.lexerStateCount + index})),
  ...Array.from({length: tables.grammarStateCount - today.grammarStateCount}, (_, index) => ({grammar: true, state: today.grammarStateCount + index})),
]
export const stateNameOf = ({grammar, state}: SpareState) => grammar ? `grammar ${grammarStateName(state)}` : `tokenizer ${lexerStateName(state)}`

// The cells of a state, as indexes into the table of the tokenizer or of the grammar.
const cellsOfState = (tables: RecoveryTables, {grammar, state}: SpareState) => {
  const cellsPerState = grammar ? tables.tokenCount * tables.contextCount : tables.classCount
  return Array.from({length: cellsPerState}, (_, index) => state * cellsPerState + index)
}

// How many cells of other states lead into a spare state.
export function cellsInto(tables: RecoveryTables, spare: SpareState): number {
  const next = spare.grammar ? tables.grammarNext : tables.lexerNext
  const own = new Set(cellsOfState(tables, spare))
  return next.reduce((count, state, cell) => count + Number(state === spare.state && !own.has(cell)), 0)
}

// Whether two spare states of one table are the same state: they hold the same choice in every cell, where a step
// into the state itself counts as the same choice, and two grammar states also have the same column of the display
// table. Two spare states that start with the same weights end so, see createSpareModel.
export function sameState(tables: RecoveryTables, first: SpareState, second: SpareState): boolean {
  if (first.grammar !== second.grammar) return false
  const next = first.grammar ? tables.grammarNext : tables.lexerNext
  const other = first.grammar ? tables.grammarAction : tables.lexerEvent
  const secondCells = cellsOfState(tables, second)
  const sameCells = cellsOfState(tables, first).every((cell, index) => {
    const secondCell = secondCells[index]!
    return other[cell] === other[secondCell] && (next[cell] === next[secondCell] || (next[cell] === first.state && next[secondCell] === second.state))
  })
  if (!sameCells || !first.grammar) return sameCells
  return Array.from({length: tables.eventCount}, (_, event) => event * tables.grammarStateCount).every(row => tables.display[row + first.state] === tables.display[row + second.state])
}

// How often the exact parser is in each state on the broken samples of `samples`: per tokenizer state and per
// grammar state, the code points that are read in the state, i.e. with the state before the code point, and the
// samples with such a code point. `codePoints` is the number of code points from a first error on, which are the
// only ones that can be read in a spare state. `readers` are the places of the samples that read `watched`.
export function stateUseOf(tables: RecoveryTables, samples: Samples, watched?: SpareState) {
  const use = {
    codePoints: 0, lexerCodePoints: new Int32Array(tables.lexerStateCount), lexerSamples: new Int32Array(tables.lexerStateCount),
    grammarCodePoints: new Int32Array(tables.grammarStateCount), grammarSamples: new Int32Array(tables.grammarStateCount), readers: [] as number[],
  }
  const lexerLast = new Int32Array(tables.lexerStateCount).fill(-1)
  const grammarLast = new Int32Array(tables.grammarStateCount).fill(-1)
  const trace = createTrace()
  for (let place = 0; place < samples.sampleCount; place++) {
    const firstError = samples.firstErrorPosition[place]!
    if (samples.firstDamage[place] === -1 || firstError === -1) continue
    runOnSample(trace, samples, place, tables)
    const length = samples.start[place + 1]! - samples.start[place]!
    let reads = false
    for (let position = firstError; position < length; position++) {
      const lexerState = trace.lexerStateBefore[position]!
      const grammarState = trace.grammarBefore[position]!
      use.codePoints++
      use.lexerCodePoints[lexerState]!++
      use.grammarCodePoints[grammarState]!++
      if (lexerLast[lexerState] !== place) {
        lexerLast[lexerState] = place
        use.lexerSamples[lexerState]!++
      }
      if (grammarLast[grammarState] !== place) {
        grammarLast[grammarState] = place
        use.grammarSamples[grammarState]!++
      }
      if (watched !== undefined && (watched.grammar ? grammarState : lexerState) === watched.state) reads = true
    }
    if (reads) use.readers.push(place)
  }
  return use
}
export type StateUse = ReturnType<typeof stateUseOf>
export const codePointsIn = (use: StateUse, {grammar, state}: SpareState) => (grammar ? use.grammarCodePoints : use.lexerCodePoints)[state]!
export const samplesIn = (use: StateUse, {grammar, state}: SpareState) => (grammar ? use.grammarSamples : use.lexerSamples)[state]!

// `tables` without a spare state: every cell that leads into the state leads into the state `standIn` of the same
// table instead, and keeps its event or its stack action. With 'base', such a cell holds the choice of `base` again,
// both parts of it, e.g. today's choice. No cell then leads into the spare state, so no text reads its cells.
export function withoutState(tables: RecoveryTables, {grammar, state}: SpareState, standIn: number | 'base', base: RecoveryTables): RecoveryTables {
  const result = copyTables(tables)
  const next = grammar ? result.grammarNext : result.lexerNext
  for (let cell = 0; cell < next.length; cell++) {
    if (next[cell] !== state) continue
    if (standIn !== 'base') {
      next[cell] = standIn
    } else if (grammar) {
      result.grammarNext[cell] = base.grammarNext[cell]!
      result.grammarAction[cell] = base.grammarAction[cell]!
    } else {
      result.lexerNext[cell] = base.lexerNext[cell]!
      result.lexerEvent[cell] = base.lexerEvent[cell]!
    }
  }
  return result
}

// `tables` with a spare state folded into the state `into` of today's: every cell that leads into the spare state
// leads into `into` instead, and every open cell of `into` takes the choice of the spare state's cell of the same
// class, or of the same token and context, when `read` marks that cell of the spare state as one that a text reads.
// A step from the spare state into itself becomes a step from `into` into itself. So `into` does the spare state's
// job, for every text that comes into it, also for the texts that came into it before. What the tables lose by
// that is what the spare state holds apart from `into`.
export function foldedInto(tables: RecoveryTables, spare: SpareState, into: number, read: CellsRead): RecoveryTables {
  const result = withoutState(tables, spare, into, tables)
  const [next, other, open, readCells] = spare.grammar ? [result.grammarNext, result.grammarAction, result.grammarOpen, read.grammar] : [result.lexerNext, result.lexerEvent, result.lexerOpen, read.lexer]
  const intoCells = cellsOfState(tables, {grammar: spare.grammar, state: into})
  cellsOfState(tables, spare).forEach((cell, index) => {
    const intoCell = intoCells[index]!
    if (readCells[cell] === 0 || open[intoCell] === 0) return
    next[intoCell] = next[cell]!
    other[intoCell] = other[cell]!
  })
  return result
}

// The samples that a stand-in is chosen on: the first 8,000 of the train split, so that the choice among today's
// states takes a second or two per spare state.
export const standInSamplesOf = (trainSamples: Samples) => selectSamples(trainSamples, Int32Array.from({length: Math.min(8000, trainSamples.sampleCount)}, (_, place) => place))

// The two ways to take a spare state away with a stand-in: 'sent' sends every cell that leads into the spare state
// to the stand-in and changes nothing else, see withoutState, and 'folded' also gives the stand-in the spare state's
// choices, see foldedInto.
export type Way = 'sent' | 'folded'

// The stand-in of a spare state: the state of today's that the spare state can be replaced by at the lowest cost,
// in one of the two ways. Each of today's states of the same table is tried, and the tables are scored on
// `samples`, a part of the train split. The stand-in is the state with the most scored code points right, `lost` is
// how many fewer that is than with the spare state, and `tables` are the tables without the spare state. When no
// sample reads the spare state, every state costs nothing, and the stand-in is the state that the spare state was
// copied from.
export function standInOf(tables: RecoveryTables, spare: SpareState, samples: Samples, way: Way): {standIn: number, lost: number, tables: RecoveryTables} {
  const copiedFrom = spare.grammar ? tables.errorState : lexerStateNames.indexOf('errorLine')
  const {readers} = stateUseOf(tables, samples, spare)
  if (readers.length === 0) return {standIn: copiedFrom, lost: 0, tables: withoutState(tables, spare, copiedFrom, tables)}
  // When the spare state is only sent away, only a sample that reads it can change. When it is folded, a sample
  // that reads the stand-in can change too.
  const scoredSamples = way === 'sent' ? selectSamples(samples, readers) : samples
  const read = cellsReadAt(tables, samples, readers)
  const rightWith = (candidate: RecoveryTables) => scoreTables(candidate, scoredSamples, {splits: ['train'], breakdowns: false}).rows[0]!.allRight
  const withTheState = rightWith(tables)
  let best = {standIn: copiedFrom, right: -1, tables}
  for (let state = 0; state < (spare.grammar ? today.grammarStateCount : today.lexerStateCount); state++) {
    const candidate = way === 'sent' ? withoutState(tables, spare, state, tables) : foldedInto(tables, spare, state, read)
    const right = rightWith(candidate)
    if (right > best.right || (right === best.right && state === copiedFrom)) best = {standIn: state, right, tables: candidate}
  }
  return {standIn: best.standIn, lost: withTheState - best.right, tables: best.tables}
}

// `tables` without any spare state: the spare states are taken away one after the other, the one that the samples
// read most first, each with its stand-in in the given way, or with 'base' each sent to the choices of `base`.
// With `taken`, only the spare states that it names are taken away, e.g. the ones of the grammar.
export function withoutSpareStates(tables: RecoveryTables, to: Way | 'base', base: RecoveryTables, samples: Samples, taken: (spare: SpareState) => boolean = () => true): RecoveryTables {
  const use = stateUseOf(tables, samples)
  let result = tables
  for (const spare of spareStatesOf(tables).filter(taken).sort((left, right) => codePointsIn(use, right) - codePointsIn(use, left))) {
    result = to === 'base' ? withoutState(result, spare, 'base', base) : standInOf(result, spare, samples, to).tables
  }
  return result
}
