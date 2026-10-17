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
// The same comparison runs for tables with added structure, see ../structure/README.md: with added classes, with
// open entries of the display table, with the bit "first on its line", and with all three, each with today's choices
// in every cell and with random settings. The context that the comparison checks at every position holds the bit.
//
// For the tables with the bit, each of those tables also runs kept on track, where no parser gives the trace: the
// bit is the one part of the state that is not replaced by the intended state, and it has to be what the text's line
// feeds and the run's tokens give, see checkBitOnTrack.
//
// Samples that were packed for tables with other classes, or without the bit, have to be refused.
//
// It also checks the intended stacks of twin-data.ts against the exact parser on the originals of the first 2,000
// samples that are not in the test split.
import {createRandom} from '../../random.ts'
import {defaultSeed} from '../../samples.ts'
import {classesOfTheChecks} from '../check-texts.ts'
import {allowedSampleAt, loadStandardSamples, refuseUnknownOptions} from '../data.ts'
import {type RecoveryTrace, containerObject, createTrace, positionCount, runRecoveryParser, runRecoveryParserInto} from '../recovery-parser.ts'
import {
  type RecoveryTables, actionCount, actionPop, actionPushArray, actionPushObject, addClasses, addFirstOnLineBit, addStates, asIsTables, checkTables, classNames, openDisplayEntries, randomizeOpenCells, tokenNames,
} from '../recovery-tables.ts'
import {intendedObjectsOf, loadIntendedObjects, packForTwin, placesForTwin, softCacheFolderOf} from './twin-data.ts'
import {type TwinData, type TwinRunner, createCellArrays, createTally, createTwinRunner, defaultDepthHigh, defaultDepthLow, exactMixesInto, shapeOf} from './twin.ts'

refuseUnknownOptions('soft/check-twin.ts', [])
const sampleCount = Number(process.argv[2] ?? 2500)
const settingCount = Number(process.argv[3] ?? 20)
let failures = 0
const fail = (message: string) => {
  failures++
  if (failures <= 20) console.log(`FAILED: ${message}`)
}

const samples = loadStandardSamples()
// Broken samples of the train split, in the dataset's order. The check reads no label, only texts.
const places = placesForTwin(samples, 'train').subarray(0, sampleCount)
if (places.length < sampleCount) throw new Error(`the train split has only ${places.length} broken samples for the twin`)
const todaysData = packForTwin(samples, places)

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

// `data` holds the samples as packed for the added structure of `tables`.
function checkTablesAgainstParser(name: string, tables: RecoveryTables, data: TwinData, wide: Comparison, training: Comparison) {
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
  checkTablesAgainstParser('today\'s tables', asIsTables(), todaysData, wide, training)
  console.log(`Today's tables on ${todaysData.sampleCount} broken samples of the train split:`)
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
    checkTablesAgainstParser(`random setting ${setting}`, tables, todaysData, wide, training)
  }
  console.log(`${settingCount} random settings of every open cell, ${withAddedStates} of them with added states, on the same samples:`)
  console.log(`  with a depth range that holds the run's depths: ${describe(wide)}.`)
  console.log(`  with the depths ${defaultDepthLow} to ${defaultDepthHigh}: ${describe(training)}, all of them among the ${training.runsThatLeaveTheRange} runs that reach an end of the range.`)
}

// A run that is kept on track, for tables with the bit "first on its line": after every code point whose intended
// state can be followed, the tokenizer state, the grammar state, the depth and the stack are replaced by the intended
// ones, and the bit is not. No parser gives the trace of such a run, so the check counts the bit itself, from the
// text's line feeds and the run's own tokens: a line feed sets the bit, and any other code point whose token is not
// `none` clears it. The bit before and after every step has to be that count, exactly 0 or 1.
const classLineFeed = classNames.indexOf('lineFeed')
const tokenNone = tokenNames.indexOf('none')
type OnTrack = {runs: number, positions: number, replaced: number, replacedWithBit: number}
function checkBitOnTrack(name: string, tables: RecoveryTables, data: TwinData, tally: OnTrack) {
  const shape = shapeOf(tables)
  const mixes = createCellArrays(shape)
  exactMixesInto(tables, mixes)
  const runner = createTwinRunner(shape)
  runner.setMixes(mixes)
  for (let place = 0; place < data.sampleCount; place++) {
    const first = data.firstError[place]!
    const start = data.start[place]!
    const length = data.start[place + 1]! - start
    runner.runSample(data, place, {onTrackProbability: 1, onTrackSeed: 3}, createTally(), undefined, positionCount)
    tally.runs++
    let bit: number = data.startFirstOnLine[place]!
    for (let position = first; position < positionCount; position++) {
      tally.positions++
      const before = runner.firstOnLineBefore[position]!
      const token = oneHotIndex(runner.tokens, position * shape.tokenCount, shape.tokenCount)
      // The positions after the text read the class `end`, as runSample gives it to the twin.
      const characterClass = position < length ? data.classes[start + position]! : 0
      const after = token === -1 ? -1 : characterClass === classLineFeed ? 1 : token === tokenNone ? bit : 0
      if (before !== bit || runner.firstOnLineAfter[position] !== after) {
        fail(`${name}, sample ${data.index[place]}, kept on track: the bit "first on its line" is ${before} before position ${position} and ${runner.firstOnLineAfter[position]} after it, and the line feeds and tokens give ${bit} and ${after}`)
        break
      }
      bit = after
      if (runner.replaced[position] === 1) {
        tally.replaced++
        tally.replacedWithBit += bit
      }
    }
  }
}

// Tables with added structure: today's choices in every cell, and random settings, the last one with added states.
{
  const settingsPerVariant = Math.max(2, Math.round(settingCount / 5))
  const variants: {name: string, make: () => RecoveryTables}[] = [
    {name: `${classesOfTheChecks.length} added classes`, make: () => addClasses(asIsTables(), classesOfTheChecks)},
    {name: 'open entries of the display table', make: () => openDisplayEntries(asIsTables())},
    {name: 'the bit "first on its line"', make: () => addFirstOnLineBit(asIsTables())},
    {name: 'all three', make: () => addFirstOnLineBit(openDisplayEntries(addClasses(asIsTables(), classesOfTheChecks)))},
  ]
  const intendedObjects = loadIntendedObjects(samples, softCacheFolderOf())
  for (const variant of variants) {
    const hasBit = variant.make().contextCount > asIsTables().contextCount
    const data = packForTwin(samples, places, hasBit ? intendedObjects : undefined, variant.make())
    const wide = newComparison()
    const training = newComparison()
    const onTrack: OnTrack = {runs: 0, positions: 0, replaced: 0, replacedWithBit: 0}
    checkTablesAgainstParser(`${variant.name}, today's choices`, variant.make(), data, wide, training)
    if (hasBit) checkBitOnTrack(`${variant.name}, today's choices`, variant.make(), data, onTrack)
    for (let setting = 0; setting < settingsPerVariant; setting++) {
      const random = createRandom(defaultSeed + 37, setting)
      // The last setting has 2 more tokenizer states and a grammar state more.
      const tables = setting === settingsPerVariant - 1 ? addStates(variant.make(), 2, [random.integer(0, 7)]) : variant.make()
      randomizeOpenCells(tables, random)
      checkTablesAgainstParser(`${variant.name}, random setting ${setting}`, tables, data, wide, training)
      if (hasBit) checkBitOnTrack(`${variant.name}, random setting ${setting}`, tables, data, onTrack)
    }
    console.log(`Tables with ${variant.name}, with today's choices and with ${settingsPerVariant} random settings of every open cell${variant.make().displayOpen.includes(1) ? ' and every open entry' : ''}, on the same samples:`)
    console.log(`  with a depth range that holds the run's depths: ${describe(wide)}.`)
    console.log(`  with the depths ${defaultDepthLow} to ${defaultDepthHigh}: ${describe(training)}, all of them among the ${training.runsThatLeaveTheRange} runs that reach an end of the range.`)
    if (hasBit) {
      if (onTrack.replacedWithBit === 0) fail(`${variant.name}: no state was replaced while the bit "first on its line" was set, so the runs that are kept on track say nothing about the bit`)
      console.log(`  kept on track after every code point whose intended state can be followed: ${onTrack.runs} runs, ${onTrack.positions} positions, ${onTrack.replaced} states replaced, ${onTrack.replacedWithBit} of them with the bit set. The bit before and after every step is the one that the text's line feeds and the run's tokens give.`)
    }
  }
}

// Samples that were packed for other tables are refused: the twin would read the cells of another class for a code
// point, or would start without the bit "first on its line". Two lists of added classes with the same number of
// classes are told apart, and two lists that give every code point the same class are not.
{
  const few = places.subarray(0, 20)
  const apostrophe = addClasses(asIsTables(), [{name: 'apostrophe', codePoints: [0x27]}])
  const hash = addClasses(asIsTables(), [{name: 'hash', codePoints: [0x23]}])
  const curly = addClasses(asIsTables(), [{name: 'curlyQuote', codePoints: [0x201c, 0x201d]}])
  const curlyInOtherWords = addClasses(asIsTables(), [{name: 'quoteMark', codePoints: [0x201d, 0x201c]}])
  const runs = (tablesOfTwin: RecoveryTables, tablesOfSamples: RecoveryTables) => {
    const shape = shapeOf(tablesOfTwin)
    const mixes = createCellArrays(shape)
    exactMixesInto(tablesOfTwin, mixes)
    const runner = createTwinRunner(shape)
    runner.setMixes(mixes)
    const data = packForTwin(samples, few, undefined, tablesOfSamples)
    try {
      for (let place = 0; place < data.sampleCount; place++) runner.runSample(data, place, {}, createTally())
    } catch {
      return false
    }
    return true
  }
  const cases: [string, RecoveryTables, RecoveryTables, boolean][] = [
    ['a twin with a class for the apostrophe on samples packed for today\'s classes', apostrophe, asIsTables(), false],
    ['a twin with a class for # on samples packed for a class for the apostrophe', hash, apostrophe, false],
    ['a twin of today\'s tables on samples packed for a class for the apostrophe', asIsTables(), apostrophe, false],
    ['a twin with the bit on samples packed for tables without the bit', addFirstOnLineBit(apostrophe), apostrophe, false],
    ['a twin without the bit on samples packed for tables with the bit', apostrophe, addFirstOnLineBit(apostrophe), false],
    ['a twin with a class for the apostrophe on samples packed for the same class', apostrophe, addStates(apostrophe, 2, [0]), true],
    ['a twin with a class for the two curly quotes on samples packed for the same class under another name, with its code points in the other order', curly, curlyInOtherWords, true],
  ]
  for (const [what, tablesOfTwin, tablesOfSamples, expected] of cases) if (runs(tablesOfTwin, tablesOfSamples) !== expected) fail(`${what} ${expected ? 'is refused' : 'runs'}`)
  console.log(`Samples packed for other tables: ${cases.filter(([, , , expected]) => !expected).length} runs with other classes or without the bit are refused, among them two lists of added classes of the same length, and ${cases.filter(([, , , expected]) => expected).length} runs with the same classes are not.`)
}

// The intended stacks: for a valid text, the stack that intendedObjectsOf gives after every code point has to be the
// stack of the exact parser, which the check builds from the parser's stack actions.
{
  const tables = asIsTables()
  let texts = 0
  let codePoints = 0
  let checked = 0
  for (let index = 0; checked < 2000; index++) {
    // allowedSampleAt gives no sample of the test split.
    const sample = allowedSampleAt(defaultSeed, index)
    if (sample === undefined) continue
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
console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
