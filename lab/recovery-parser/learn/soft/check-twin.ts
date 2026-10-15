// Checks the invariant that ties the twin to the parser: with exact tables, every share of the twin is exactly 0 or
// 1, and at every position from the first error on the twin has the exact parser's trace.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/soft/check-twin.ts [broken samples, default 2500] [random settings, default 20]
//
// The tables are today's and random settings of every open cell, a quarter of them with added states. Per sample and
// tables, the twin runs from the first error to position 512, the last of the 513, and the check compares the
// tokenizer state after, the event, the token, the context, the grammar state after, the stack action, the display
// kind, the depth after and the container after with the trace of recovery-parser.ts.
//
// The twin holds a share per depth of a range, and the exact parser's depth has no bounds. So the comparison runs
// twice: with a range that holds every depth the exact parser reaches in that run, where every position has to be
// equal, and with the range that training uses, -8 to 24, where the check counts the runs that leave the range.
//
// It also checks the intended stacks of twin-data.ts against the exact parser on the originals of the first 2,000
// samples that are not in the test split.
import {createRandom} from '../../random.ts'
import {defaultSeed, sampleAt} from '../../samples.ts'
import {loadStandardSamples, splitNames} from '../data.ts'
import {type RecoveryTrace, containerObject, createTrace, positionCount, runRecoveryParser, runRecoveryParserInto} from '../recovery-parser.ts'
import {type RecoveryTables, actionCount, actionPop, actionPushArray, actionPushObject, addStates, asIsTables, checkTables, randomizeOpenCells} from '../recovery-tables.ts'
import {intendedObjectsOf, packForTwin, placesForTwin} from './twin-data.ts'
import {type TwinData, type TwinRunner, createCellArrays, createTally, createTwinRunner, defaultDepthHigh, defaultDepthLow, exactMixesInto, shapeOf} from './twin.ts'

const sampleCount = Number(process.argv[2] ?? 2500)
const settingCount = Number(process.argv[3] ?? 20)
let failures = 0
const fail = (message: string) => {
  failures++
  if (failures <= 20) console.log(`FAILED: ${message}`)
}

const samples = loadStandardSamples()
// Broken samples of the train split, in the dataset's order. The check reads no label, only texts.
const places = placesForTwin(samples, splitNames.indexOf('train')).subarray(0, sampleCount)
if (places.length < sampleCount) throw new Error(`the train split has only ${places.length} broken samples for the twin`)
const data = packForTwin(samples, places)

// The index of the one share that is 1 among `count` shares that are otherwise 0, or -1 when the shares are not that.
function oneHotIndex(shares: Float64Array, base: number, count: number): number {
  let found = -1
  for (let entry = 0; entry < count; entry++) {
    const share = shares[base + entry]!
    if (share === 0) continue
    if (share !== 1 || found !== -1) return -1
    found = entry
  }
  return found
}

type Comparison = {runs: number, positions: number, runsThatDiffer: number, runsThatLeaveTheRange: number}

// Runs the twin on one sample with the mixes it was given and compares every position from the first error on with
// `trace`. Returns the first difference, or undefined.
function compare(runner: TwinRunner, twinData: TwinData, place: number, trace: RecoveryTrace, shape: ReturnType<typeof shapeOf>): string | undefined {
  const first = twinData.firstError[place]!
  runner.runSample(twinData, place, {}, createTally(), undefined, positionCount)
  const differs = (name: string, position: number, actual: number, expected: number) => `${name} at position ${position} is ${actual}, and the parser's is ${expected}`
  for (let position = first; position < positionCount; position++) {
    let actual = oneHotIndex(runner.lexerAfter, position * shape.lexerStateCount, shape.lexerStateCount)
    if (actual !== trace.lexerStateAfter[position]) return differs('the tokenizer state after', position, actual, trace.lexerStateAfter[position]!)
    actual = oneHotIndex(runner.events, position * shape.eventCount, shape.eventCount)
    if (actual !== trace.event[position]) return differs('the event', position, actual, trace.event[position]!)
    actual = oneHotIndex(runner.tokens, position * shape.tokenCount, shape.tokenCount)
    if (actual !== trace.token[position]) return differs('the token', position, actual, trace.token[position]!)
    actual = oneHotIndex(runner.contexts, position * shape.contextCount, shape.contextCount)
    if (actual !== trace.context[position]) return differs('the context', position, actual, trace.context[position]!)
    actual = oneHotIndex(runner.grammarAfter, position * shape.grammarStateCount, shape.grammarStateCount)
    if (actual !== trace.grammarAfter[position]) return differs('the grammar state after', position, actual, trace.grammarAfter[position]!)
    actual = oneHotIndex(runner.actions, position * actionCount, actionCount)
    if (actual !== trace.action[position]) return differs('the stack action', position, actual, trace.action[position]!)
    actual = oneHotIndex(runner.kinds, position * shape.displayKindCount, shape.displayKindCount)
    if (actual !== trace.displayKind[position]) return differs('the display kind', position, actual, trace.displayKind[position]!)
    actual = oneHotIndex(runner.depthAfter, position * runner.depthCount, runner.depthCount)
    if (actual === -1 || actual + runner.depthLow !== trace.depthAfter[position]) return differs('the depth after', position, actual === -1 ? NaN : actual + runner.depthLow, trace.depthAfter[position]!)
    actual = oneHotIndex(runner.containers, position * 3, 3)
    if (actual !== trace.containerAfter[position]) return differs('the container after', position, actual, trace.containerAfter[position]!)
    // The level of the innermost container holds its kind as exactly 0 or 1.
    const depth = trace.depthAfter[position]!
    if (depth >= 1) {
      const share = runner.objectsAfter[position * 17 + Math.min(depth, 16)]!
      if (share !== (trace.containerAfter[position] === containerObject ? 1 : 0)) return `the share of "an object" at level ${Math.min(depth, 16)} after position ${position} is ${share}`
    }
  }
  return undefined
}

function checkTablesAgainstParser(name: string, tables: RecoveryTables, wide: Comparison, training: Comparison) {
  checkTables(tables)
  const shape = shapeOf(tables)
  const mixes = createCellArrays(shape)
  exactMixesInto(tables, mixes)
  const trainingRunner = createTwinRunner(shape)
  trainingRunner.setMixes(mixes)
  const trace = createTrace()
  // Runners by depth range, since a runner's arrays have the size of its range.
  const runners = new Map<string, TwinRunner>()
  for (let place = 0; place < data.sampleCount; place++) {
    const start = samples.start[places[place]!]!
    const length = samples.start[places[place]! + 1]! - start
    runRecoveryParserInto(trace, samples.codePoints, start, length, false, tables)
    const first = trace.firstErrorPosition
    if (first !== data.firstError[place]) {
      fail(`${name}, sample ${data.index[place]}: the first error is at ${first}, and the twin's data says ${data.firstError[place]}`)
      continue
    }
    let lowest = data.startDepth[place]!
    let highest = lowest
    for (let position = first; position < positionCount; position++) {
      lowest = Math.min(lowest, trace.depthAfter[position]!)
      highest = Math.max(highest, trace.depthAfter[position]!)
    }
    // A range that holds every depth of the run and one more at each end, in steps of 32 so that runners are shared.
    const low = Math.min(-32, -32 * Math.ceil((1 - lowest) / 32))
    const high = Math.max(32, 32 * Math.ceil((highest + 1) / 32))
    const key = `${low} ${high}`
    let runner = runners.get(key)
    if (runner === undefined) {
      runner = createTwinRunner(shape, low, high)
      runner.setMixes(mixes)
      runners.set(key, runner)
    }
    wide.runs++
    wide.positions += positionCount - first
    const difference = compare(runner, data, place, trace, shape)
    if (difference !== undefined) {
      wide.runsThatDiffer++
      fail(`${name}, sample ${data.index[place]}, depths ${low} to ${high}: ${difference}`)
    }
    training.runs++
    training.positions += positionCount - first
    const leaves = lowest <= defaultDepthLow || highest >= defaultDepthHigh
    if (leaves) training.runsThatLeaveTheRange++
    const trainingDifference = compare(trainingRunner, data, place, trace, shape)
    if (trainingDifference !== undefined) {
      training.runsThatDiffer++
      // Inside the range the twin has to be the parser.
      if (!leaves) fail(`${name}, sample ${data.index[place]}, depths ${defaultDepthLow} to ${defaultDepthHigh}: ${trainingDifference}`)
    }
  }
}

const started = performance.now()
const newComparison = (): Comparison => ({runs: 0, positions: 0, runsThatDiffer: 0, runsThatLeaveTheRange: 0})
const describe = (comparison: Comparison) => `${comparison.runs} runs, ${comparison.positions} positions, ${comparison.runsThatDiffer} runs differ from the parser`

{
  const wide = newComparison()
  const training = newComparison()
  checkTablesAgainstParser('today\'s tables', asIsTables(), wide, training)
  console.log(`Today's tables on ${data.sampleCount} broken samples of the train split:`)
  console.log(`  with a depth range that holds the run's depths: ${describe(wide)}.`)
  console.log(`  with the depths ${defaultDepthLow} to ${defaultDepthHigh}: ${describe(training)}, and ${training.runsThatLeaveTheRange} runs reach an end of the range.`)
}
{
  const wide = newComparison()
  const training = newComparison()
  let withAddedStates = 0
  for (let setting = 0; setting < settingCount; setting++) {
    const random = createRandom(defaultSeed + 31, setting)
    let tables = asIsTables()
    if (setting % 4 === 3) {
      tables = addStates(tables, random.integer(1, 3), Array.from({length: random.integer(1, 3)}, () => random.integer(0, tables.grammarStateCount - 1)))
      withAddedStates++
    }
    randomizeOpenCells(tables, random)
    checkTablesAgainstParser(`random setting ${setting}`, tables, wide, training)
  }
  console.log(`${settingCount} random settings of every open cell, ${withAddedStates} of them with added states, on the same samples:`)
  console.log(`  with a depth range that holds the run's depths: ${describe(wide)}.`)
  console.log(`  with the depths ${defaultDepthLow} to ${defaultDepthHigh}: ${describe(training)}, all of them among the ${training.runsThatLeaveTheRange} runs that reach an end of the range.`)
}

// The intended stacks: for a valid text, the stack that intendedObjectsOf gives after every code point has to be the
// stack of the exact parser, which the check builds from the parser's stack actions.
{
  const tables = asIsTables()
  let texts = 0
  let codePoints = 0
  let checked = 0
  for (let index = 0; checked < 2000; index++) {
    const sample = sampleAt(defaultSeed, index)
    // The test split is only read by a script that is told to.
    if (sample.split === 'test') continue
    checked++
    const stacks = intendedObjectsOf({...sample, alignment: Array.from({length: Array.from(sample.original).length}, (_, position) => position)})
    let offset = 0
    for (const document of sample.documents) {
      const trace = runRecoveryParser(Array.from(document, character => character.codePointAt(0)!), false, tables)
      texts++
      // The exact parser's stack, from its actions.
      let depth = 0
      let stack = 0
      for (let position = 0; position < trace.length; position++) {
        const action = trace.action[position]!
        if (action === actionPushObject || action === actionPushArray) {
          depth++
          stack = action === actionPushObject ? stack | (1 << (depth - 1)) : stack & ~(1 << (depth - 1))
        } else if (action === actionPop) {
          stack &= ~(1 << (depth - 1))
          depth--
        }
        codePoints++
        if (stacks[offset + position] !== stack) fail(`sample ${sample.id}: the intended stack after code point ${offset + position} is ${stacks[offset + position]!.toString(2)}, and the parser's is ${stack.toString(2)}`)
      }
      offset += trace.length
    }
  }
  console.log(`Intended stacks: on ${texts} original documents of ${checked} samples of the train and validation splits, ${codePoints} code points, the stack after every code point is the exact parser's.`)
}

console.log(`${((performance.now() - started) / 1000).toFixed(1)} s.`)
if (failures > 0) {
  console.log(`${failures} checks FAILED.`)
  process.exit(1)
}
console.log('Every check passed.')
