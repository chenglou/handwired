// A worker thread of search.ts, as lab/recovery-parser/learn/search/search-worker.ts. It holds a share of the samples (every sample whose index leaves the remainder
// `share` when divided by the number of shares), and one bit per sample and cell that says whether the sample's run
// reads the cell under the current tables. Every worker gets the same changes to the tables in the
// same order, and all counts are whole numbers, so the search gives the same tables with any number of workers.
import type {RecoveryTables} from '../recovery-tables.ts'
import {type RunSamples, cellBitCount, changesOfChoices, messageOf, samplesOfMessage, scoreOfSample} from './sample-runs.ts'

export type Request =
  | {type: 'start', samples: ReturnType<typeof messageOf>, tables: RecoveryTables, share: number, shares: number}
  // How many of the worker's samples read each cell.
  | {type: 'readers'}
  // Try choices of one cell: `candidates` holds two numbers per choice, the next state and the event of a tokenizer
  // cell, or the next state and the stack action of a grammar cell.
  | {type: 'evaluate', grammar: boolean, cell: number, candidates: Uint8Array}
  | {type: 'apply', grammar: boolean, cell: number, first: number, second: number}

export type Reply =
  | {type: 'started', samples: number}
  | {type: 'readers', readers: Int32Array}
  // Per choice: the change of the two counts of a packed score over the worker's samples, and how many runs it took.
  | {type: 'evaluated', allRight: Int32Array, labelsRight: Int32Array, runs: number}
  | {type: 'applied', runs: number}

declare const self: {onmessage: ((event: {data: Request}) => void) | null, postMessage: (reply: Reply) => void}

let samples: RunSamples
let tables: RecoveryTables
// The worker's samples that read an open cell.
let own: Int32Array
let cellsRead: Uint8Array
let bytesPerSample = 0
let lexerCellCount = 0

const partsOf = (grammar: boolean) => grammar ? [tables.grammarNext, tables.grammarAction] as const : [tables.lexerNext, tables.lexerEvent] as const

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
      cellsRead = new Uint8Array(own.length * bytesPerSample)
      for (let index = 0; index < own.length; index++) scoreOfSample(samples, own[index]!, tables, cellsRead, index * bytesPerSample)
      return {type: 'started', samples: own.length}
    }
    case 'readers': {
      const readers = new Int32Array(cellBitCount(tables))
      for (let index = 0; index < own.length; index++) {
        for (let bit = 0; bit < readers.length; bit++) if ((cellsRead[index * bytesPerSample + (bit >> 3)]! & (1 << (bit & 7))) !== 0) readers[bit]!++
      }
      return {type: 'readers', readers}
    }
    case 'evaluate': {
      const readers = readersOf(request.grammar, request.cell)
      const changes = changesOfChoices(samples, readers.map(index => own[index]!), tables, request.grammar, request.cell, request.candidates)
      if (changes.readers !== readers.length) throw new Error(`${readers.length} samples are listed as readers of the cell ${request.cell}, and the runs of ${changes.readers} read it`)
      return {type: 'evaluated', allRight: changes.allRight, labelsRight: changes.labelsRight, runs: readers.length * request.candidates.length / 2}
    }
    case 'apply': {
      const [firstPart, secondPart] = partsOf(request.grammar)
      // The readers under the tables before the change: only their runs can change.
      const readers = readersOf(request.grammar, request.cell)
      firstPart[request.cell] = request.first
      secondPart[request.cell] = request.second
      for (const index of readers) {
        cellsRead.fill(0, index * bytesPerSample, (index + 1) * bytesPerSample)
        scoreOfSample(samples, own[index]!, tables, cellsRead, index * bytesPerSample)
      }
      return {type: 'applied', runs: readers.length}
    }
  }
}

self.onmessage = event => self.postMessage(handle(event.data))
