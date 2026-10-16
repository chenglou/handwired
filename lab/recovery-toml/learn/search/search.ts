// A greedy search over some cells, without gradients: for one of the cells at a time, try the cell's choices in the
// exact parser on the train samples and keep the best one, and go over the cells again until a pass changes nothing
// or a limit of passes is reached. Every other cell keeps what the start tables hold. It is searchCells of
// lab/recovery-parser/learn/arms/holes/restricted-search.ts, the search that the recipe of the JSON side runs after
// its training, with other imports.
//
// A choice is kept when it has more scored code points with every label right, or as many and more right labels. The
// cells of a pass are in one of two orders: from the most read cell to the least read one, or in a random order that
// a seed draws anew for every pass. The search ends in other tables for another order. It runs on 4 worker threads
// (search-worker.ts) with the parser loop of sample-runs.ts, and gives the same tables with any number of them.
//
// The TOML tables make the search slower than the JSON ones: a tokenizer cell has about three times as many choices
// to try, and there are about four times as many open cells.
import {createRandom} from '../random.ts'
import {type RecoveryTables, actionByToken, actionCount, actionOfToken, copyTables, eventNames, today} from '../recovery-tables.ts'
import {type RunSamples, cellBitCount, messageOf, refuseOtherClasses, totalScore} from './sample-runs.ts'
import type {Reply, Request} from './search-worker.ts'

// A cell of the tokenizer's table or of the grammar's table, by its index in that table.
export type Cell = {grammar: boolean, cell: number}

const endEvents = new Set((['end', 'endInsideToken', 'truncatedEnd'] as const).map(name => eventNames.indexOf(name)))

// The pairs of next state and event that today's tokenizer table holds somewhere, e.g. (basicOpen, stringStart).
const knownPairs = [...new Set(Array.from(today.lexerNext, (next, cell) => next * 256 + today.lexerEvent[cell]!))].sort((left, right) => left - right)

// The choices to try for a cell, two numbers each, without the one that the cell holds. For a tokenizer cell: every
// next state with the cell's event, every event with the cell's next state, and every pair that today's table holds
// somewhere, without the three events of a text's end. For a grammar cell: every next state with each of four stack
// actions.
export function candidatesOf(tables: RecoveryTables, {grammar, cell}: Cell): Uint8Array {
  const candidates: number[] = []
  if (grammar) {
    // A stack action that does what the cell's token does by itself is kept as `by token`, so there are four actions.
    const token = Math.floor(cell / tables.contextCount) % tables.tokenCount
    const kept = (action: number) => action === actionOfToken[token] ? actionByToken : action
    const nextNow = tables.grammarNext[cell]!
    const actionNow = kept(tables.grammarAction[cell]!)
    for (let next = 0; next < tables.grammarStateCount; next++) {
      for (let action = 0; action < actionCount; action++) {
        if (action !== kept(action) || (next === nextNow && action === actionNow)) continue
        candidates.push(next, action)
      }
    }
    return Uint8Array.from(candidates)
  }
  const nextNow = tables.lexerNext[cell]!
  const eventNow = tables.lexerEvent[cell]!
  const seen = new Set<number>([nextNow * 256 + eventNow])
  const add = (next: number, event: number) => {
    if (endEvents.has(event) || seen.has(next * 256 + event)) return
    seen.add(next * 256 + event)
    candidates.push(next, event)
  }
  for (let next = 0; next < tables.lexerStateCount; next++) add(next, eventNow)
  for (let event = 0; event < tables.eventCount; event++) add(nextNow, event)
  for (const pair of knownPairs) add(pair >> 8, pair & 255)
  return Uint8Array.from(candidates)
}

export type SearchResult = {
  tables: RecoveryTables
  // How many passes ran, and whether the last one changed nothing. Otherwise the limit of passes ended the search.
  passes: number
  lastPassChangedNothing: boolean
  // How often a cell got another choice, and how many runs of a sample the search took.
  changes: number
  runs: number
}

// Searches the choices of `cells` from the tables `start`, which are not changed, on the broken samples of `train`,
// e.g. prepareSamples(trainPart(samples), start). Without `orderSeed` a pass goes from the most read cell to the least read one. With it, every
// pass has a random order of its own, which the seed draws. The open entries of a display table stay as they are.
export async function searchCells(start: RecoveryTables, cells: readonly Cell[], train: RunSamples, orderSeed?: number, maximumPasses = 200): Promise<SearchResult> {
  refuseOtherClasses(train, start)
  const tables = copyTables(start)
  const lexerCellCount = tables.lexerNext.length
  const bitOf = ({grammar, cell}: Cell) => grammar ? lexerCellCount + cell : cell
  for (const cell of cells) if ((cell.grammar ? tables.grammarOpen : tables.lexerOpen)[cell.cell] !== 1) throw new Error(`the search got the ${cell.grammar ? 'grammar' : 'tokenizer'} cell ${cell.cell}, which is frozen`)
  const workerCount = 4
  const workers = Array.from({length: workerCount}, () => new Worker(new URL('./search-worker.ts', import.meta.url).href))
  // One request to every worker, and their replies in the order of the workers.
  const ask = (requestOf: (share: number) => Request): Promise<Reply[]> => Promise.all(workers.map((worker, share) => new Promise<Reply>((resolve, reject) => {
    worker.onmessage = event => resolve(event.data as Reply)
    worker.onerror = event => reject(new Error(`worker ${share}: ${event.message}`))
    worker.postMessage(requestOf(share))
  })))
  try {
    let total = totalScore(train, tables)
    let runs = 0
    let changes = 0
    let passes = 0
    let lastPassChangedNothing = false
    await ask(share => ({type: 'start', samples: messageOf(train), tables, share, shares: workerCount}))
    // The cells in the order of the tables: a random order is drawn from them as search.ts draws it, whatever the
    // order in which the caller lists the cells.
    const inTableOrder = [...cells].sort((left, right) => bitOf(left) - bitOf(right))
    // The cells from the most read one to the least read one, by how many samples read them with the tables as they
    // are at the start of the pass.
    const mostReadFirst = async () => {
      const readers = new Int32Array(cellBitCount(tables))
      for (const reply of await ask(() => ({type: 'readers'}))) {
        if (reply.type !== 'readers') throw new Error('a worker gave another reply than readers')
        for (let bit = 0; bit < readers.length; bit++) readers[bit]! += reply.readers[bit]!
      }
      return [...inTableOrder].sort((left, right) => readers[bitOf(right)]! - readers[bitOf(left)]! || bitOf(left) - bitOf(right))
    }
    while (passes < maximumPasses && !lastPassChangedNothing) {
      passes++
      const order = orderSeed === undefined ? await mostReadFirst() : createRandom(orderSeed, passes).shuffled(inTableOrder)
      let changesOfPass = 0
      for (const cell of order) {
        const candidates = candidatesOf(tables, cell)
        const candidateCount = candidates.length / 2
        const allRight = new Int32Array(candidateCount)
        const labelsRight = new Int32Array(candidateCount)
        for (const reply of await ask(() => ({type: 'evaluate', grammar: cell.grammar, cell: cell.cell, candidates}))) {
          if (reply.type !== 'evaluated') throw new Error('a worker gave another reply than evaluated')
          runs += reply.runs
          for (let candidate = 0; candidate < candidateCount; candidate++) {
            allRight[candidate]! += reply.allRight[candidate]!
            labelsRight[candidate]! += reply.labelsRight[candidate]!
          }
        }
        // The best choice, and the first of several that are equally good. It has to be better than what the cell holds.
        let best = -1
        for (let candidate = 0; candidate < candidateCount; candidate++) {
          const bestAllRight = best === -1 ? 0 : allRight[best]!
          const bestLabelsRight = best === -1 ? 0 : labelsRight[best]!
          if (allRight[candidate]! > bestAllRight || (allRight[candidate] === bestAllRight && labelsRight[candidate]! > bestLabelsRight)) best = candidate
        }
        if (best === -1) continue
        const first = candidates[best * 2]!
        const second = candidates[best * 2 + 1]!
        if (cell.grammar) {
          tables.grammarNext[cell.cell] = first
          tables.grammarAction[cell.cell] = second
        } else {
          tables.lexerNext[cell.cell] = first
          tables.lexerEvent[cell.cell] = second
        }
        for (const reply of await ask(() => ({type: 'apply', grammar: cell.grammar, cell: cell.cell, first, second}))) if (reply.type === 'applied') runs += reply.runs
        total = {allRight: total.allRight + allRight[best]!, labelsRight: total.labelsRight + labelsRight[best]!}
        changesOfPass++
      }
      changes += changesOfPass
      lastPassChangedNothing = changesOfPass === 0
    }
    // The steps have to add up to what a run of every sample gives with the tables at the end.
    const checked = totalScore(train, tables)
    if (checked.allRight !== total.allRight || checked.labelsRight !== total.labelsRight) throw new Error(`the steps of the search add up to ${total.allRight} code points and ${total.labelsRight} labels, and a run of every sample gives ${checked.allRight} and ${checked.labelsRight}`)
    return {tables, passes, lastPassChangedNothing, changes, runs}
  } finally {
    for (const worker of workers) worker.terminate()
  }
}
