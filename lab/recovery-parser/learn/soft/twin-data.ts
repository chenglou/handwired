// The samples as the twin reads them: per sample the exact parser's state at the first error, where the twin starts,
// and per code point the class, the labels and the intended states. packForTwin makes them from the arrays of data.ts,
// in SharedArrayBuffers, so that worker threads read the same memory.
//
// Keeping a run on track replaces the twin's whole state by the intended state, and the state includes the kind of
// every open level, which data.ts does not hold: its labels only have the innermost container. intendedObjectsOf makes
// the stack after every kept code point's counterpart from the sample itself, and loadIntendedObjects keeps the stacks
// of a whole set in a cache file.
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {type Sample, sampleAt} from '../../samples.ts'
import {containerObject, runTableParser} from '../../table-parser.ts'
import {type Samples, codePointLabeled} from '../data.ts'
import {createTrace, maximumDepth, runRecoveryParserInto} from '../recovery-parser.ts'
import {type RecoveryTables, actionPop, actionPushArray, actionPushObject, asIsTables} from '../recovery-tables.ts'
import type {TwinData} from './twin.ts'

// For every code point of a sample's broken text: the stack of today's parser after the code point's counterpart in
// the original, as bits, where bit l - 1 is 1 when level l is an object. 0 for a code point that the damage added.
// Each document is parsed on its own, as in intended.ts.
export function intendedObjectsOf(sample: Sample): Uint16Array {
  const stacks: number[] = []
  for (const document of sample.documents) {
    const trace = runTableParser(document)
    if (!trace.valid) throw new Error(`sample ${sample.id}: today's parser rejects the document ${JSON.stringify(document)}`)
    let depth = 0
    let stack = 0
    for (let position = 0; position < trace.length; position++) {
      const depthAfter = trace.depthAfter[position]!
      if (depthAfter > depth) {
        // An opening bracket: the new level's kind is the container after it.
        const bit = 1 << (depthAfter - 1)
        stack = trace.containerAfter[position] === containerObject ? stack | bit : stack & ~bit
      } else if (depthAfter < depth) {
        stack &= ~(1 << (depth - 1))
      }
      depth = depthAfter
      stacks.push(stack)
    }
  }
  return Uint16Array.from(sample.alignment, index => index === -1 ? 0 : stacks[index]!)
}

// The intended stacks of every code point of `samples`, see intendedObjectsOf. Making them takes about half a
// millisecond per sample, since every sample is made again. With a cache folder they are read from a file whose name
// holds a hash of the samples' arrays, so another dataset gets another file.
export function loadIntendedObjects(samples: Samples, cacheFolder: string | undefined): Uint16Array {
  let path: string | undefined
  if (cacheFolder !== undefined) {
    mkdirSync(cacheFolder, {recursive: true})
    const hashes = [samples.index, samples.start, samples.codePoints, samples.labelDepth, samples.labelContainer].map(array => Bun.hash(array).toString(16))
    path = join(cacheFolder, `intended-stacks-${samples.seed}-${Bun.hash(hashes.join('.')).toString(16)}.bin`)
    if (existsSync(path)) {
      const bytes = readFileSync(path)
      if (bytes.byteLength === 2 * samples.codePointCount) return new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    }
  }
  const stacks = new Uint16Array(samples.codePointCount)
  for (let place = 0; place < samples.sampleCount; place++) {
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    const sample = sampleAt(samples.seed, samples.index[place]!)
    const ofSample = intendedObjectsOf(sample)
    if (ofSample.length !== length) throw new Error(`sample ${sample.id} has ${ofSample.length} code points, and the arrays ${length}`)
    for (let position = 0; position < length; position++) {
      const stack = ofSample[position]!
      // The stack has to agree with the label: no level above the label's depth, and the label's container at its depth.
      if ((samples.flags[start + position]! & codePointLabeled) !== 0) {
        const depth = samples.labelDepth[start + position]!
        const innermostIsObject = depth >= 1 && ((stack >> (depth - 1)) & 1) === 1
        if ((stack >> depth) !== 0 || innermostIsObject !== (samples.labelContainer[start + position] === containerObject)) {
          throw new Error(`sample ${sample.id}, code point ${position}: the intended stack ${stack.toString(2)} does not fit the label's depth ${depth} and container ${samples.labelContainer[start + position]}`)
        }
      } else if (stack !== 0) {
        throw new Error(`sample ${sample.id}, code point ${position}: a code point without a label has the intended stack ${stack.toString(2)}`)
      }
      stacks[start + position] = stack
    }
  }
  if (path !== undefined) {
    const partial = `${path}.${process.pid}.partial`
    writeFileSync(partial, new Uint8Array(stacks.buffer))
    renameSync(partial, path)
  }
  return stacks
}

const shared = <Typed>(type: new (buffer: SharedArrayBuffer) => Typed, bytesPerEntry: number, length: number) => new type(new SharedArrayBuffer(bytesPerEntry * length))

// The samples at `places` of `samples` for the twin, in that order. `intendedObjects` holds the intended stacks of
// every code point of `samples`, see loadIntendedObjects. Without it the twin cannot keep a run on track.
//
// `tables` are the tables that the twin will run, or others with the same added structure, e.g. the model's base
// tables. Without them, today's. They decide the class of every code point, which tables with added classes give
// otherwise than today's, and they give the state at the first error: every cell that a text reads before its first
// error is frozen, so every choice of the open cells gives the same state there.
export function packForTwin(samples: Samples, places: ArrayLike<number>, intendedObjects?: Uint16Array, tables: RecoveryTables = asIsTables()): TwinData {
  const sampleCount = places.length
  let codePointCount = 0
  for (let at = 0; at < sampleCount; at++) codePointCount += samples.start[places[at]! + 1]! - samples.start[places[at]!]!
  const data: TwinData = {
    sampleCount, classCount: tables.classCount,
    index: shared(Int32Array, 4, sampleCount), start: shared(Int32Array, 4, sampleCount + 1), firstDamage: shared(Int32Array, 4, sampleCount),
    firstError: shared(Int32Array, 4, sampleCount), startLexerState: shared(Uint8Array, 1, sampleCount), startGrammarState: shared(Uint8Array, 1, sampleCount),
    startDepth: shared(Int8Array, 1, sampleCount), startObjects: shared(Uint16Array, 2, sampleCount),
    classes: shared(Uint8Array, 1, codePointCount), flags: shared(Uint8Array, 1, codePointCount), labelKind: shared(Int8Array, 1, codePointCount),
    labelDepth: shared(Int8Array, 1, codePointCount), labelContainer: shared(Int8Array, 1, codePointCount), intendedLexerAfter: shared(Int8Array, 1, codePointCount),
    intendedEvent: shared(Int8Array, 1, codePointCount), intendedGrammarAfter: shared(Int8Array, 1, codePointCount),
    intendedObjects: shared(Uint16Array, 2, codePointCount), hasIntendedObjects: intendedObjects !== undefined,
  }
  const trace = createTrace()
  const lastClassEntry = tables.classOfCodePoint.length - 1
  let codePointAt = 0
  for (let at = 0; at < sampleCount; at++) {
    const place = places[at]!
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    data.index[at] = samples.index[place]!
    data.firstDamage[at] = samples.firstDamage[place]!
    runRecoveryParserInto(trace, samples.codePoints, start, length, false, tables)
    const firstError = trace.firstErrorPosition
    if (firstError !== samples.firstErrorPosition[place]) throw new Error(`sample ${samples.index[place]}: the parser's first error is at ${firstError}, and the sample says ${samples.firstErrorPosition[place]}`)
    data.firstError[at] = firstError
    if (firstError >= 0) {
      // The stack before the first error, from the actions of the steps before it.
      let depth = 0
      let objects = 0
      for (let position = 0; position < firstError; position++) {
        const action = trace.action[position]!
        if (action === actionPushObject || action === actionPushArray) {
          depth++
          if (depth < 1 || depth > maximumDepth) throw new Error(`sample ${samples.index[place]}: depth ${depth} before the first error`)
          const bit = 1 << (depth - 1)
          objects = action === actionPushObject ? objects | bit : objects & ~bit
        } else if (action === actionPop) {
          objects &= ~(1 << (depth - 1))
          depth--
        }
      }
      if (firstError > 0 && depth !== trace.depthAfter[firstError - 1]) throw new Error(`sample ${samples.index[place]}: the stack has ${depth} levels before the first error, and the trace says ${trace.depthAfter[firstError - 1]}`)
      data.startLexerState[at] = trace.lexerStateBefore[firstError]!
      data.startGrammarState[at] = trace.grammarBefore[firstError]!
      data.startDepth[at] = depth
      data.startObjects[at] = objects
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
      if (intendedObjects !== undefined) data.intendedObjects[to] = intendedObjects[from]!
    }
    codePointAt += length
    data.start[at + 1] = codePointAt
  }
  return data
}

// The places of the broken samples of one split that give the twin something to do: a labeled code point at or after
// both the first damage and the first error. E.g. a text that is only cut off has its first error after its last
// code point, and the twin has no step to take.
export function placesForTwin(samples: Samples, split: number): Int32Array {
  const places: number[] = []
  for (let place = 0; place < samples.sampleCount; place++) {
    if (samples.split[place] !== split || samples.firstDamage[place] === -1) continue
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    const from = Math.max(samples.firstDamage[place]!, samples.firstErrorPosition[place]!)
    let labeled = false
    for (let position = from; position < length && !labeled; position++) labeled = (samples.flags[start + position]! & codePointLabeled) !== 0
    if (labeled) places.push(place)
  }
  return Int32Array.from(places)
}

// The scratch folder's part for this folder's caches, or undefined without a scratch folder.
export function softCacheFolderOf(scratchFolder: string | undefined = process.env['RECOVERY_SCRATCH']) {
  return scratchFolder === undefined || scratchFolder === '' ? undefined : join(scratchFolder, 'soft', 'cache')
}
