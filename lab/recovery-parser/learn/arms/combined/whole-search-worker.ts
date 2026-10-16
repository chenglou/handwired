// A worker thread of whole-search.ts. It is ../../search/search-worker.ts with one more count per choice: the
// samples in which every scored code point is right. It holds a share of the samples, one bit per sample and cell
// that says whether the sample's run reads the cell under the current tables, and each sample's score under them.
// A choice is tried by a run of every reader from its first changeable position.
import {codePointScored} from '../../data.ts'
import type {RecoveryTables} from '../../recovery-tables.ts'
import {type RunSamples, cellBitCount, messageOf, samplesOfMessage, scoreOfSample, scorePack} from '../../search/sample-runs.ts'

// The three counts of a score, in the order in which the search compares them: whole samples, scored code points
// with every label right, and labels that are right one by one.
export type Counts = {whole: number, allRight: number, labelsRight: number}

export type Request =
  | {type: 'start', samples: ReturnType<typeof messageOf>, tables: RecoveryTables, share: number, shares: number}
  // Try choices of one cell: `candidates` holds two numbers per choice, as in ../../search/search-worker.ts.
  | {type: 'evaluate', grammar: boolean, cell: number, candidates: Uint8Array}
  | {type: 'apply', grammar: boolean, cell: number, first: number, second: number}

export type Reply =
  | {type: 'started', counts: Counts}
  // Per choice: the change of the three counts over the worker's samples, and how many runs it took.
  | {type: 'evaluated', whole: Int32Array, allRight: Int32Array, labelsRight: Int32Array, runs: number}
  | {type: 'applied', runs: number}

declare const self: {onmessage: ((event: {data: Request}) => void) | null, postMessage: (reply: Reply) => void}

let samples: RunSamples
let tables: RecoveryTables
// The worker's samples that read an open cell, the scored code points of each, and its packed score now.
let own: Int32Array
let scoredOf: Int32Array
let scoreNow: Int32Array
let cellsRead: Uint8Array
let bytesPerSample = 0
let lexerCellCount = 0

const partsOf = (grammar: boolean) => grammar ? [tables.grammarNext, tables.grammarAction] as const : [tables.lexerNext, tables.lexerEvent] as const
// Whether the sample at `index` of `own` is whole with the packed score `score`: it has a scored code point, and
// every one of them is right.
const isWhole = (index: number, score: number) => scoredOf[index]! > 0 && Math.floor(score / scorePack) === scoredOf[index]

// The worker's samples whose run reads the cell, as indexes into `own`.
function readersOf(grammar: boolean, cell: number): number[] {
  const bit = grammar ? lexerCellCount + cell : cell
  const byte = bit >> 3
  const mask = 1 << (bit & 7)
  const readers: number[] = []
  for (let index = 0; index < own.length; index++) if ((cellsRead[index * bytesPerSample + byte]! & mask) !== 0) readers.push(index)
  return readers
}

function handle(request: Request): Reply {
  switch (request.type) {
    case 'start': {
      samples = samplesOfMessage(request.samples)
      tables = request.tables
      lexerCellCount = tables.lexerNext.length
      bytesPerSample = Math.ceil(cellBitCount(tables) / 8)
      const mine: number[] = []
      for (let sample = request.share; sample < samples.sampleCount; sample += request.shares) {
        if (samples.changeableFrom[sample]! < samples.start[sample + 1]! - samples.start[sample]!) mine.push(sample)
      }
      own = Int32Array.from(mine)
      scoredOf = new Int32Array(own.length)
      scoreNow = new Int32Array(own.length)
      cellsRead = new Uint8Array(own.length * bytesPerSample)
      const counts: Counts = {whole: 0, allRight: 0, labelsRight: 0}
      for (let index = 0; index < own.length; index++) {
        const sample = own[index]!
        for (let at = samples.start[sample]! + samples.changeableFrom[sample]!; at < samples.start[sample + 1]!; at++) if ((samples.flags[at]! & codePointScored) !== 0) scoredOf[index]!++
        scoreNow[index] = scoreOfSample(samples, sample, tables, cellsRead, index * bytesPerSample)
        counts.whole += Number(isWhole(index, scoreNow[index]!))
        counts.allRight += Math.floor(scoreNow[index]! / scorePack)
        counts.labelsRight += scoreNow[index]! % scorePack
      }
      return {type: 'started', counts}
    }
    case 'evaluate': {
      const [firstPart, secondPart] = partsOf(request.grammar)
      const readers = readersOf(request.grammar, request.cell)
      const candidateCount = request.candidates.length / 2
      const whole = new Int32Array(candidateCount)
      const allRight = new Int32Array(candidateCount)
      const labelsRight = new Int32Array(candidateCount)
      const firstBefore = firstPart[request.cell]!
      const secondBefore = secondPart[request.cell]!
      for (let candidate = 0; candidate < candidateCount; candidate++) {
        firstPart[request.cell] = request.candidates[candidate * 2]!
        secondPart[request.cell] = request.candidates[candidate * 2 + 1]!
        for (const index of readers) {
          const before = scoreNow[index]!
          const after = scoreOfSample(samples, own[index]!, tables)
          whole[candidate]! += Number(isWhole(index, after)) - Number(isWhole(index, before))
          allRight[candidate]! += Math.floor(after / scorePack) - Math.floor(before / scorePack)
          labelsRight[candidate]! += after % scorePack - before % scorePack
        }
      }
      firstPart[request.cell] = firstBefore
      secondPart[request.cell] = secondBefore
      return {type: 'evaluated', whole, allRight, labelsRight, runs: readers.length * candidateCount}
    }
    case 'apply': {
      const [firstPart, secondPart] = partsOf(request.grammar)
      // The readers under the tables before the change: only their runs can change.
      const readers = readersOf(request.grammar, request.cell)
      firstPart[request.cell] = request.first
      secondPart[request.cell] = request.second
      for (const index of readers) {
        cellsRead.fill(0, index * bytesPerSample, (index + 1) * bytesPerSample)
        scoreNow[index] = scoreOfSample(samples, own[index]!, tables, cellsRead, index * bytesPerSample)
      }
      return {type: 'applied', runs: readers.length}
    }
  }
}

self.onmessage = event => self.postMessage(handle(event.data))
