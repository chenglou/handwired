// The samples as the twin reads them: per sample the exact parser's state at the first error, where the twin starts,
// and per code point the class, the labels and the intended states. packForTwin makes them from the arrays of data.ts,
// in SharedArrayBuffers, so that worker threads read the same memory. It is
// lab/recovery-parser/learn/soft/twin-data.ts for TOML. The intended stacks, which the JSON file makes from the
// dataset's samples and keeps in a cache file, are in the arrays of data.ts here.
import {type Samples, splitNames} from '../data.ts'
import {createTrace, maximumDepth, runRecoveryParserInto} from '../recovery-parser.ts'
import {type RecoveryTables, actionPop, actionPushArray, actionPushInlineTable, asIsTables, today} from '../recovery-tables.ts'
import {type TwinData, classTableKeyOf} from './twin.ts'

const shared = <Typed>(type: new (buffer: SharedArrayBuffer) => Typed, bytesPerEntry: number, length: number) => new type(new SharedArrayBuffer(bytesPerEntry * length))

// The samples at `places` of `samples` for the twin, in that order.
//
// `tables` are the tables that the twin will run, or others with the same added structure, e.g. the model's base
// tables. Without them, today's. They decide the class of every code point, which tables with added classes give
// otherwise than today's, and they give the state at the first error, with the bit "first on its line" when the
// tables have it: every cell that a text reads before its first error is frozen, so every choice of the open cells
// gives the same state there. The samples keep a key of the tables' class table and their number of contexts, and
// a twin of tables with another class table or another number of contexts refuses to run them, e.g. a twin with a
// class for ! on samples that were packed for a class for the semicolon.
export function packForTwin(samples: Samples, places: ArrayLike<number>, tables: RecoveryTables = asIsTables()): TwinData {
  const sampleCount = places.length
  let codePointCount = 0
  for (let at = 0; at < sampleCount; at++) codePointCount += samples.start[places[at]! + 1]! - samples.start[places[at]!]!
  const data: TwinData = {
    sampleCount, classCount: tables.classCount, classTable: classTableKeyOf(tables), contextCount: tables.contextCount,
    index: shared(Int32Array, 4, sampleCount), split: shared(Uint8Array, 1, sampleCount), start: shared(Int32Array, 4, sampleCount + 1),
    firstError: shared(Int32Array, 4, sampleCount), startLexerState: shared(Uint8Array, 1, sampleCount), startGrammarState: shared(Uint8Array, 1, sampleCount),
    startDepth: shared(Int8Array, 1, sampleCount), startInlineTables: shared(Uint16Array, 2, sampleCount), startFirstOnLine: shared(Uint8Array, 1, sampleCount),
    classes: shared(Uint8Array, 1, codePointCount), flags: shared(Uint8Array, 1, codePointCount), labelKind: shared(Int8Array, 1, codePointCount),
    labelDepth: shared(Int8Array, 1, codePointCount), labelContainer: shared(Int8Array, 1, codePointCount), intendedLexerAfter: shared(Int8Array, 1, codePointCount),
    intendedEvent: shared(Int8Array, 1, codePointCount), intendedGrammarAfter: shared(Int8Array, 1, codePointCount), intendedDepthAfter: shared(Int8Array, 1, codePointCount),
    intendedInlineTables: shared(Uint16Array, 2, codePointCount),
  }
  const trace = createTrace()
  const lastClassEntry = tables.classOfCodePoint.length - 1
  let codePointAt = 0
  for (let at = 0; at < sampleCount; at++) {
    const place = places[at]!
    if (!(place >= 0 && place < samples.sampleCount)) throw new Error(`packForTwin got the place ${place}, and the samples have the places 0 to ${samples.sampleCount - 1}`)
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    data.index[at] = samples.index[place]!
    data.split[at] = samples.split[place]!
    runRecoveryParserInto(trace, samples.codePoints, start, length, false, tables)
    const firstError = trace.firstErrorPosition
    if (firstError !== samples.firstErrorPosition[place]) throw new Error(`sample ${samples.index[place]}: the parser's first error is at ${firstError}, and the sample says ${samples.firstErrorPosition[place]}`)
    data.firstError[at] = firstError
    if (firstError >= 0) {
      // The stack before the first error, from the actions of the steps before it.
      let depth = 0
      let inlineTables = 0
      for (let position = 0; position < firstError; position++) {
        const action = trace.action[position]!
        if (action === actionPushInlineTable || action === actionPushArray) {
          depth++
          if (depth < 1 || depth > maximumDepth) throw new Error(`sample ${samples.index[place]}: depth ${depth} before the first error`)
          const bit = 1 << (depth - 1)
          inlineTables = action === actionPushInlineTable ? inlineTables | bit : inlineTables & ~bit
        } else if (action === actionPop) {
          inlineTables &= ~(1 << (depth - 1))
          depth--
        }
      }
      if (firstError > 0 && depth !== trace.depthAfter[firstError - 1]) throw new Error(`sample ${samples.index[place]}: the stack has ${depth} levels before the first error, and the trace says ${trace.depthAfter[firstError - 1]}`)
      data.startLexerState[at] = trace.lexerStateBefore[firstError]!
      data.startGrammarState[at] = trace.grammarBefore[firstError]!
      data.startDepth[at] = depth
      data.startInlineTables[at] = inlineTables
      // The context that the first error reads holds the bit before it: the contexts with the bit are the upper half.
      data.startFirstOnLine[at] = trace.context[firstError]! >= today.contextCount ? 1 : 0
    }
    for (let position = 0; position < length; position++) {
      const from = start + position
      const to = codePointAt + position
      data.classes[to] = tables.classOfCodePoint[Math.min(samples.codePoints[from]! + 1, lastClassEntry)]!
      data.flags[to] = samples.flags[from]!
      data.labelKind[to] = samples.labelKind[from]!
      data.labelDepth[to] = samples.labelDepth[from]!
      data.labelContainer[to] = samples.labelContainer[from]!
      data.intendedLexerAfter[to] = samples.intendedLexerAfter[from]!
      data.intendedEvent[to] = samples.intendedEvent[from]!
      data.intendedGrammarAfter[to] = samples.intendedGrammarAfter[from]!
      data.intendedDepthAfter[to] = samples.intendedDepthAfter[from]!
      data.intendedInlineTables[to] = samples.intendedStack[from]!
    }
    codePointAt += length
    data.start[at + 1] = codePointAt
  }
  return data
}

// The places in `samples` of the broken samples of one split that give the twin something to do: a scored code
// point, i.e. one at or after the first error whose label has a scored value. E.g. a text that is only cut off has
// its first error after its last code point, and the twin has no step to take. `split` is 'train' or 'validation',
// and anything else throws, e.g. 'test'. The validation places are for reading how a twin does there, e.g. in a
// check: train refuses to train on them.
export function placesForTwin(samples: Samples, split: 'train' | 'validation'): Int32Array {
  // The type allows no other name. A caller without types, or with a cast, can still pass one, e.g. 'test'.
  const named: string = split
  if (named !== 'train' && named !== 'validation') throw new Error(`placesForTwin takes the split 'train' or 'validation', and got ${JSON.stringify(named)}`)
  const wanted = splitNames.indexOf(split)
  const places: number[] = []
  for (let place = 0; place < samples.sampleCount; place++) if (samples.split[place] === wanted && samples.firstDamage[place] !== -1 && samples.scored[place]! > 0) places.push(place)
  return Int32Array.from(places)
}
