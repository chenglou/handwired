// The samples as the twin reads them: per sample the exact parser's state at the first error, where the twin starts,
// and per code point the class, the labels and the intended states. packForTwin makes them from the arrays of data.ts,
// in SharedArrayBuffers, so that worker threads read the same memory.
//
// Keeping a run on track replaces the twin's whole state by the intended state, and the state includes the kind of
// every open level, which data.ts does not hold: its intended states only have the innermost container.
// intendedObjectsOf makes the stack after every kept code point's counterpart from the sample itself, and
// loadIntendedObjects keeps the stacks of a whole set in a cache file.
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import type {Sample} from '../../samples.ts'
import {containerObject, runTableParser} from '../../table-parser.ts'
import {type Samples, allowedSampleAt, codePointKept, splitNames} from '../data.ts'
import {createTrace, maximumDepth, runRecoveryParserInto} from '../recovery-parser.ts'
import {type RecoveryTables, actionPop, actionPushArray, actionPushObject, asIsTables, today} from '../recovery-tables.ts'
import {type TwinData, classTableKeyOf} from './twin.ts'

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

// A hash of this file, for the name of the cache file of the intended stacks: a change of intendedObjectsOf gets
// another file.
let knownHashOfThisFile: string | undefined
const hashOfThisFile = () => knownHashOfThisFile ??= Bun.hash(readFileSync(join(import.meta.dir, 'twin-data.ts'))).toString(16)

// The intended stacks of every code point of `samples`, see intendedObjectsOf. Making them takes about half a
// millisecond per sample, since every sample is made again. With a cache folder they are read from a file whose name
// holds the dataset's key, a hash of this file and a hash of the samples' arrays, so another version of the dataset
// or of this file gets another file.
export function loadIntendedObjects(samples: Samples, cacheFolder: string | undefined): Uint16Array {
  let path: string | undefined
  if (cacheFolder !== undefined) {
    mkdirSync(cacheFolder, {recursive: true})
    const hashes = [samples.index, samples.start, samples.codePoints, samples.intendedDepthAfter, samples.intendedContainerAfter].map(array => Bun.hash(array).toString(16))
    path = join(cacheFolder, `intended-stacks-${samples.datasetKey}-${hashOfThisFile()}-${samples.seed}-${Bun.hash(hashes.join('.')).toString(16)}.bin`)
    if (existsSync(path)) {
      const bytes = readFileSync(path)
      if (bytes.byteLength === 2 * samples.codePointCount) return new Uint16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    }
  }
  const stacks = new Uint16Array(samples.codePointCount)
  for (let place = 0; place < samples.sampleCount; place++) {
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    // The arrays hold no sample of the test split unless they were loaded for final numbers, so this is no test sample.
    const sample = allowedSampleAt(samples.seed, samples.index[place]!)
    if (sample === undefined) throw new Error(`the sample ${samples.seed}:${samples.index[place]} of the arrays is in the test split`)
    const ofSample = intendedObjectsOf(sample)
    if (ofSample.length !== length) throw new Error(`sample ${sample.id} has ${ofSample.length} code points, and the arrays ${length}`)
    for (let position = 0; position < length; position++) {
      const stack = ofSample[position]!
      // The stack has to agree with the intended depth and container of the arrays: no level above the depth, and the
      // container at the depth.
      if ((samples.flags[start + position]! & codePointKept) !== 0) {
        const depth = samples.intendedDepthAfter[start + position]!
        const innermostIsObject = depth >= 1 && ((stack >> (depth - 1)) & 1) === 1
        if ((stack >> depth) !== 0 || innermostIsObject !== (samples.intendedContainerAfter[start + position] === containerObject)) {
          throw new Error(`sample ${sample.id}, code point ${position}: the intended stack ${stack.toString(2)} does not fit the intended depth ${depth} and container ${samples.intendedContainerAfter[start + position]}`)
        }
      } else if (stack !== 0) {
        throw new Error(`sample ${sample.id}, code point ${position}: a code point that the damage added has the intended stack ${stack.toString(2)}`)
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
// otherwise than today's, and they give the state at the first error, with the bit "first on its line" when the
// tables have it: every cell that a text reads before its first error is frozen, so every choice of the open cells
// gives the same state there. The samples keep a key of the tables' class table and their number of contexts, and
// a twin of tables with another class table or another number of contexts refuses to run them, e.g. a twin with a
// class for # on samples that were packed for a class for the apostrophe.
export function packForTwin(samples: Samples, places: ArrayLike<number>, intendedObjects?: Uint16Array, tables: RecoveryTables = asIsTables()): TwinData {
  const sampleCount = places.length
  let codePointCount = 0
  for (let at = 0; at < sampleCount; at++) codePointCount += samples.start[places[at]! + 1]! - samples.start[places[at]!]!
  const data: TwinData = {
    sampleCount, classCount: tables.classCount, classTable: classTableKeyOf(tables), contextCount: tables.contextCount,
    index: shared(Int32Array, 4, sampleCount), split: shared(Uint8Array, 1, sampleCount), start: shared(Int32Array, 4, sampleCount + 1),
    firstError: shared(Int32Array, 4, sampleCount), startLexerState: shared(Uint8Array, 1, sampleCount), startGrammarState: shared(Uint8Array, 1, sampleCount),
    startDepth: shared(Int8Array, 1, sampleCount), startObjects: shared(Uint16Array, 2, sampleCount), startFirstOnLine: shared(Uint8Array, 1, sampleCount),
    classes: shared(Uint8Array, 1, codePointCount), flags: shared(Uint8Array, 1, codePointCount), labelKind: shared(Int8Array, 1, codePointCount),
    labelDepth: shared(Int8Array, 1, codePointCount), labelContainer: shared(Int8Array, 1, codePointCount), intendedLexerAfter: shared(Int8Array, 1, codePointCount),
    intendedEvent: shared(Int8Array, 1, codePointCount), intendedGrammarAfter: shared(Int8Array, 1, codePointCount), intendedDepthAfter: shared(Int8Array, 1, codePointCount),
    intendedObjects: shared(Uint16Array, 2, codePointCount), hasIntendedObjects: intendedObjects !== undefined,
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
      if (intendedObjects !== undefined) data.intendedObjects[to] = intendedObjects[from]!
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

// The scratch folder's part for this folder's caches, or undefined without a scratch folder.
export function softCacheFolderOf(scratchFolder: string | undefined = process.env['RECOVERY_SCRATCH']) {
  return scratchFolder === undefined || scratchFolder === '' ? undefined : join(scratchFolder, 'soft', 'cache')
}
