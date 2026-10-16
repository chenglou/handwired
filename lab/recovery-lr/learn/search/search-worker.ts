// A worker thread of the search. It holds a share of the samples (every sample whose index leaves the remainder
// `share` when divided by the number of shares), each sample's packed score under the tables as they are, and one
// bit per sample and cell that says whether the sample's run reads the cell. Every worker gets the same changes
// of the tables in the same order, and all counts are whole numbers, so the search gives the same tables with any
// number of workers.
import {type PackedSamples, messageOf, samplesOfMessage} from '../data.ts'
import type {RecoveryTables} from '../recovery-tables.ts'
import {runSample, scorePack} from '../score.ts'

export type Request =
  | {type: 'start', samples: ReturnType<typeof messageOf>, tables: RecoveryTables, share: number, shares: number}
  // How many of the worker's samples read each cell.
  | {type: 'readers'}
  // Try other choices of one cell.
  | {type: 'evaluate', cell: number, candidates: Int16Array}
  | {type: 'apply', cell: number, choice: number}

export type Reply =
  | {type: 'started', samples: number}
  | {type: 'readers', readers: Int32Array}
  // Per choice: the change of the two counts of a packed score over the worker's samples, and how many runs of a
  // sample it took.
  | {type: 'evaluated', allRight: Int32Array, labelsRight: Int32Array, runs: number}
  | {type: 'applied', runs: number}

declare const self: {onmessage: ((event: {data: Request}) => void) | null, postMessage: (reply: Reply) => void}

let samples: PackedSamples
let tables: RecoveryTables
// The worker's samples, their packed scores, and the bits of the cells that their runs read.
let own: Int32Array
let scoreNow: Int32Array
let cellsRead: Uint8Array
let bytesPerSample = 0

// The worker's samples whose run reads the cell, as indexes into `own`.
function readersOf(cell: number): number[] {
  const byte = cell >> 3
  const mask = 1 << (cell & 7)
  const readers: number[] = []
  for (let index = 0; index < own.length; index++) if ((cellsRead[index * bytesPerSample + byte]! & mask) !== 0) readers.push(index)
  return readers
}

function handle(request: Request): Reply {
  switch (request.type) {
    case 'start': {
      samples = samplesOfMessage(request.samples)
      tables = request.tables
      bytesPerSample = Math.ceil(tables.choice.length / 8)
      const mine: number[] = []
      for (let sample = request.share; sample < samples.sampleCount; sample += request.shares) mine.push(sample)
      own = Int32Array.from(mine)
      scoreNow = new Int32Array(own.length)
      cellsRead = new Uint8Array(own.length * bytesPerSample)
      for (let index = 0; index < own.length; index++) scoreNow[index] = runSample(samples, own[index]!, tables, cellsRead, index * bytesPerSample)
      return {type: 'started', samples: own.length}
    }
    case 'readers': {
      const readers = new Int32Array(tables.choice.length)
      for (let index = 0; index < own.length; index++) {
        for (let cell = 0; cell < readers.length; cell++) if ((cellsRead[index * bytesPerSample + (cell >> 3)]! & (1 << (cell & 7))) !== 0) readers[cell]!++
      }
      return {type: 'readers', readers}
    }
    case 'evaluate': {
      const {cell, candidates} = request
      const readers = readersOf(cell)
      const allRight = new Int32Array(candidates.length)
      const labelsRight = new Int32Array(candidates.length)
      const choiceNow = tables.choice[cell]!
      for (let candidate = 0; candidate < candidates.length; candidate++) {
        tables.choice[cell] = candidates[candidate]!
        let allRightChange = 0, labelsRightChange = 0
        for (const index of readers) {
          const after = runSample(samples, own[index]!, tables), before = scoreNow[index]!
          allRightChange += Math.floor(after / scorePack) - Math.floor(before / scorePack)
          labelsRightChange += after % scorePack - before % scorePack
        }
        allRight[candidate] = allRightChange
        labelsRight[candidate] = labelsRightChange
      }
      tables.choice[cell] = choiceNow
      return {type: 'evaluated', allRight, labelsRight, runs: readers.length * candidates.length}
    }
    case 'apply': {
      // The readers under the tables before the change: only their runs can change.
      const readers = readersOf(request.cell)
      tables.choice[request.cell] = request.choice
      for (const index of readers) {
        cellsRead.fill(0, index * bytesPerSample, (index + 1) * bytesPerSample)
        scoreNow[index] = runSample(samples, own[index]!, tables, cellsRead, index * bytesPerSample)
      }
      return {type: 'applied', runs: readers.length}
    }
  }
}

self.onmessage = event => self.postMessage(handle(event.data))
