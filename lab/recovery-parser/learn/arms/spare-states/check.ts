// Checks of the arm "spare states", on short runs in this thread:
// 1. Without a spare state the model of a run is the model of the plain pass, so the control is the plain pass.
// 2. The start of the spare states comes from the seed: one seed gives the same weights twice, two seeds give other
//    weights, and without the random part every spare state starts with the same weights.
// 3. A run from tables that a person wrote changes only what it may: a cell of a spare state, or the next state of
//    an open cell of another state, which then is a spare state.
// 4. Tables without a spare state: no cell leads into the state, no text is in it, a spare state that is a copy of
//    a state of today's folds into that state without a changed trace, taking away a state that no text reads
//    changes no trace, and taking away the spare states of one table leaves the ones of the other table as they were.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, in a few seconds:
//   bun lab/recovery-parser/learn/arms/spare-states/check.ts
import {refuseUnknownOptions} from '../../data.ts'
import {createTrace} from '../../recovery-parser.ts'
import {type RecoveryTables, asIsTables, lexerStateName, lexerStateNames, today} from '../../recovery-tables.ts'
import {runOnSample} from '../../score.ts'
import {train} from '../../soft/train.ts'
import {packForTwin, placesForTwin} from '../../soft/twin-data.ts'
import {createModel} from '../../soft/twin.ts'
import {samplesOfTheStandardSet, trainPartOfTheStandardSet} from '../harness.ts'
import {baseOf, cellsInto, codePointsIn, createSpareModel, namedTrainerSettings, sameState, spareStatesOf, standInOf, standInSamplesOf, stateUseOf, withoutSpareStates} from './spare-states.ts'

refuseUnknownOptions('arms/spare-states/check.ts', [])
let failures = 0
const check = (holds: boolean, what: string) => {
  console.log(`${holds ? 'ok  ' : 'FAIL'}  ${what}`)
  if (!holds) failures++
}
const sameNumbers = (left: ArrayLike<number>, right: ArrayLike<number>) => left.length === right.length && Array.prototype.every.call(left, (value: number, index: number) => Object.is(value, right[index]))
const plain = namedTrainerSettings['plain']!
const uniform = namedTrainerSettings['three-passes']!

// 1.
for (const trainer of [plain, uniform]) {
  const model = createSpareModel(asIsTables(), 'today', 3, trainer)
  const plainModel = createModel(asIsTables(), {start: trainer.start})
  check(sameNumbers(model.weights.all, plainModel.weights.all) && sameNumbers(model.trainableLexer, plainModel.trainableLexer) && sameNumbers(model.trainableGrammar, plainModel.trainableGrammar),
    `without a spare state, the model of a run with a start at ${trainer.start === 'base' ? 'the base\'s choices' : 'uniform mixes'} is the model that createModel gives for today's tables`)
}

// 2.
const spare = {tokenizer: 3, grammar: 2}
const base = baseOf('today', spare)
const first = createSpareModel(base, 'today', 1, plain)
check(sameNumbers(first.weights.all, createSpareModel(base, 'today', 1, plain).weights.all), 'one seed gives the same start twice')
check(!sameNumbers(first.weights.all, createSpareModel(base, 'today', 2, plain).weights.all), 'two seeds give two starts')
const rowOf = (weights: Float64Array, width: number, cellsPerState: number, state: number) => weights.subarray(state * cellsPerState * width, (state + 1) * cellsPerState * width)
const sameStart = (noise: number) => {
  const model = createSpareModel(base, 'today', 1, plain, noise)
  const lexerRow = (state: number) => rowOf(model.weights.lexerEvent, base.eventCount, base.classCount, state)
  const grammarRow = (state: number) => rowOf(model.weights.grammarNext, base.grammarStateCount, base.tokenCount * base.contextCount, state)
  return sameNumbers(lexerRow(today.lexerStateCount), lexerRow(today.lexerStateCount + 1)) && sameNumbers(grammarRow(today.grammarStateCount), grammarRow(today.grammarStateCount + 1))
}
check(sameStart(0), 'without the random part, two spare states start with the same weights')
check(!sameStart(1), 'with it, two spare states start with other weights')

// 3. A short run from each of the two kinds of tables that a person wrote, with each start.
const samples = samplesOfTheStandardSet()
const trainPlaces = placesForTwin(samples, 'train').subarray(0, 300)
const data = packForTwin(samples, trainPlaces, undefined, asIsTables())
for (const kind of ['hand-written', 'words'] as const) {
  for (const trainer of [plain, uniform]) {
    const kindBase = baseOf(kind, spare)
    const model = createSpareModel(kindBase, kind, 1, trainer)
    const shut = Array.from(model.weights.all, weight => weight === -Infinity)
    const result = await train(model, data, {seed: 1, epochs: 2, workers: 0, logEverySamples: 1e9, log: () => {}})
    const tables = result.last
    // What a run may not do, per table: change a cell of a state that is not spare in anything but its next state,
    // or give it a next state that is neither the base's nor a spare one.
    const forbidden = (next: Uint8Array, baseNext: Uint8Array, other: Uint8Array, baseOther: Uint8Array, cellsPerState: number, firstSpare: number) =>
      Array.from(next.keys()).filter(cell => Math.floor(cell / cellsPerState) < firstSpare && (other[cell] !== baseOther[cell] || (next[cell] !== baseNext[cell] && next[cell]! < firstSpare))).length
    const changedOutside = forbidden(tables.lexerNext, kindBase.lexerNext, tables.lexerEvent, kindBase.lexerEvent, kindBase.classCount, today.lexerStateCount)
      + forbidden(tables.grammarNext, kindBase.grammarNext, tables.grammarAction, kindBase.grammarAction, kindBase.tokenCount * kindBase.contextCount, today.grammarStateCount)
    const into = spareStatesOf(tables).reduce((total, state) => total + cellsInto(tables, state), 0)
    check(changedOutside === 0, `from the ${kind} tables, ${trainer.passes === 1 ? 'a start at the base\'s choices' : 'a uniform start'}: a short run changes no cell of another state but in its next state, which is then a spare state. Cells that lead into a spare state: ${into}`)
    check(shut.every((isShut, index) => !isShut || model.weights.all[index] === -Infinity) && !model.weights.all.some(weight => Number.isNaN(weight)), 'every weight that started at -Infinity is still there, and no weight is NaN')
  }
}

// 4. On tables whose spare states a short run uses.
const used = (await train(createSpareModel(base, 'today', 1, uniform), data, {seed: 1, epochs: 2, workers: 0, logEverySamples: 1e9, log: () => {}})).last
const trainSamples = trainPartOfTheStandardSet()
const spareStates = spareStatesOf(used)
const use = stateUseOf(used, trainSamples)
check(spareStates.some(state => codePointsIn(use, state) > 0), `after a short run from a uniform start, train samples read ${spareStates.filter(state => codePointsIn(use, state) > 0).length} of the ${spareStates.length} spare states`)
check(spareStates.every(state => !spareStates.some(other => other !== state && sameState(used, state, other))) && sameState(base, spareStates[0]!, spareStates[1]!), 'no two spare states of the trained tables are the same state, and two of the base are')
const readState = spareStates.find(state => codePointsIn(use, state) > 0)!
// Whether two tables show the first 2,000 train samples alike: the display kind, the depth and the container.
const sameTraces = (left: RecoveryTables, right: RecoveryTables) => {
  const traces = [createTrace(), createTrace()] as const
  for (let place = 0; place < 2000; place++) {
    runOnSample(traces[0], trainSamples, place, left)
    runOnSample(traces[1], trainSamples, place, right)
    const length = trainSamples.start[place + 1]! - trainSamples.start[place]!
    for (let position = 0; position < length; position++) {
      if (traces[0].displayKind[position] !== traces[1].displayKind[position] || traces[0].depthAfter[position] !== traces[1].depthAfter[position] || traces[0].containerAfter[position] !== traces[1].containerAfter[position]) return false
    }
  }
  return true
}
const standInSamples = standInSamplesOf(trainSamples)
for (const way of ['sent', 'folded'] as const) {
  const {standIn, tables: without} = standInOf(used, readState, standInSamples, way)
  check(standIn < (readState.grammar ? today.grammarStateCount : today.lexerStateCount) && cellsInto(without, readState) === 0 && codePointsIn(stateUseOf(without, trainSamples), readState) === 0,
    `with a spare state ${way}, no cell leads into it and no train sample is in it, and its stand-in is a state of today's`)
}
// A spare state that is the same state as its stand-in loses nothing when it is folded into it, whatever leads where.
const twin = baseOf('hand-written', {tokenizer: 1, grammar: 0})
const twinState = spareStatesOf(twin)[0]!
const twinOf = lexerStateNames.indexOf('string')
twin.lexerNext.copyWithin(twinState.state * twin.classCount, twinOf * twin.classCount, (twinOf + 1) * twin.classCount)
twin.lexerEvent.copyWithin(twinState.state * twin.classCount, twinOf * twin.classCount, (twinOf + 1) * twin.classCount)
for (let cell = 0; cell < today.lexerStateCount * twin.classCount; cell++) if (twin.lexerOpen[cell] === 1 && twin.lexerNext[cell] === twinOf && cell % 2 === 0) twin.lexerNext[cell] = twinState.state
const foldedTwin = standInOf(twin, twinState, standInSamples, 'folded')
check(codePointsIn(stateUseOf(twin, standInSamples), twinState) > 0 && foldedTwin.lost <= 0 && sameTraces(foldedTwin.tables, baseOf('hand-written', {tokenizer: 1, grammar: 0})),
  `a spare state that is a copy of the state string, with half of the open steps into string sent to it, folds into the ${lexerStateName(foldedTwin.standIn)} without a changed trace`)
const noSpare = withoutSpareStates(used, 'sent', base, standInSamples)
const useWithout = stateUseOf(noSpare, trainSamples)
check(spareStates.every(state => codePointsIn(useWithout, state) === 0), 'without every spare state, no train sample is in a spare state')
check(sameTraces(noSpare, withoutSpareStates(noSpare, 'base', base, standInSamples)), 'taking the spare states away a second time changes no trace of 2,000 train samples')
const withoutGrammarStates = withoutSpareStates(used, 'sent', base, standInSamples, state => state.grammar)
check(spareStates.every(state => cellsInto(withoutGrammarStates, state) === (state.grammar ? 0 : cellsInto(used, state))), 'with only the spare grammar states taken away, no cell leads into one of them, and the same cells as before lead into each spare tokenizer state')

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks failed.`)
process.exit(failures === 0 ? 0 : 1)
