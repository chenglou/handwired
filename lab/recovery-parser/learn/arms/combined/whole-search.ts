// A search that counts whole samples first: the search of ../holes/restricted-search.ts with another rule for which
// choice of a cell is taken. That search takes a choice when more scored code points of the train split have every
// label right, and so it can give up one code point in each of many samples for more code points elsewhere. This
// one takes a choice when more train samples are whole, i.e. have every scored code point right, or as many are
// whole and more code points are right, or both are the same and more labels are right.
//
// Everything else is as there: the cells of a pass in a random order that a seed draws anew for every pass, the
// same choices per cell (candidatesOf), 4 worker threads, and an end by a pass that changes nothing, which has to
// come, since every change raises one of three counts that cannot fall without an earlier one rising.
import {createRandom} from '../../../random.ts'
import {type RecoveryTables, copyTables} from '../../recovery-tables.ts'
import {type RunSamples, messageOf, refuseOtherClasses} from '../../search/sample-runs.ts'
import type {Cell} from '../holes/holes.ts'
import {type SearchResult, candidatesOf} from '../holes/restricted-search.ts'
import type {Counts, Reply, Request} from './whole-search-worker.ts'

export async function searchForWholeSamples(start: RecoveryTables, cells: readonly Cell[], train: RunSamples, orderSeed: number, maximumPasses = 200): Promise<SearchResult> {
  refuseOtherClasses(train, start)
  const tables = copyTables(start)
  const lexerCellCount = tables.lexerNext.length
  const bitOf = ({grammar, cell}: Cell) => grammar ? lexerCellCount + cell : cell
  for (const cell of cells) if ((cell.grammar ? tables.grammarOpen : tables.lexerOpen)[cell.cell] !== 1) throw new Error(`the search got the ${cell.grammar ? 'grammar' : 'tokenizer'} cell ${cell.cell}, which is frozen`)
  const workerCount = 4
  const workers = Array.from({length: workerCount}, () => new Worker(new URL('./whole-search-worker.ts', import.meta.url).href))
  // One request to every worker, and their replies in the order of the workers.
  const ask = (requestOf: (share: number) => Request): Promise<Reply[]> => Promise.all(workers.map((worker, share) => new Promise<Reply>((resolve, reject) => {
    worker.onmessage = event => resolve(event.data as Reply)
    worker.onerror = event => reject(new Error(`worker ${share}: ${event.message}`))
    worker.postMessage(requestOf(share))
  })))
  // The three counts over every sample with the tables as they are, from workers that are started anew.
  const countsOf = async (): Promise<Counts> => {
    const total: Counts = {whole: 0, allRight: 0, labelsRight: 0}
    for (const reply of await ask(share => ({type: 'start', samples: messageOf(train), tables, share, shares: workerCount}))) {
      if (reply.type !== 'started') throw new Error('a worker gave another reply than started')
      total.whole += reply.counts.whole
      total.allRight += reply.counts.allRight
      total.labelsRight += reply.counts.labelsRight
    }
    return total
  }
  try {
    const total = await countsOf()
    let runs = 0
    let changes = 0
    let passes = 0
    let lastPassChangedNothing = false
    const inTableOrder = [...cells].sort((left, right) => bitOf(left) - bitOf(right))
    while (passes < maximumPasses && !lastPassChangedNothing) {
      passes++
      let changesOfPass = 0
      for (const cell of createRandom(orderSeed, passes).shuffled(inTableOrder)) {
        const candidates = candidatesOf(tables, cell)
        const candidateCount = candidates.length / 2
        const whole = new Int32Array(candidateCount)
        const allRight = new Int32Array(candidateCount)
        const labelsRight = new Int32Array(candidateCount)
        for (const reply of await ask(() => ({type: 'evaluate', grammar: cell.grammar, cell: cell.cell, candidates}))) {
          if (reply.type !== 'evaluated') throw new Error('a worker gave another reply than evaluated')
          runs += reply.runs
          for (let candidate = 0; candidate < candidateCount; candidate++) {
            whole[candidate]! += reply.whole[candidate]!
            allRight[candidate]! += reply.allRight[candidate]!
            labelsRight[candidate]! += reply.labelsRight[candidate]!
          }
        }
        // The best choice, and the first of several that are equally good. It has to be better than what the cell holds.
        let best = -1
        for (let candidate = 0; candidate < candidateCount; candidate++) {
          const bestWhole = best === -1 ? 0 : whole[best]!
          const bestAllRight = best === -1 ? 0 : allRight[best]!
          const bestLabelsRight = best === -1 ? 0 : labelsRight[best]!
          if (whole[candidate]! > bestWhole || (whole[candidate] === bestWhole && (allRight[candidate]! > bestAllRight || (allRight[candidate] === bestAllRight && labelsRight[candidate]! > bestLabelsRight)))) best = candidate
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
        total.whole += whole[best]!
        total.allRight += allRight[best]!
        total.labelsRight += labelsRight[best]!
        changesOfPass++
      }
      changes += changesOfPass
      lastPassChangedNothing = changesOfPass === 0
    }
    // The steps have to add up to what a run of every sample gives with the tables at the end.
    const checked = await countsOf()
    if (checked.whole !== total.whole || checked.allRight !== total.allRight || checked.labelsRight !== total.labelsRight) {
      throw new Error(`the steps of the search add up to ${total.whole} whole samples, ${total.allRight} code points and ${total.labelsRight} labels, and a run of every sample gives ${checked.whole}, ${checked.allRight} and ${checked.labelsRight}`)
    }
    return {tables, passes, lastPassChangedNothing, changes, runs}
  } finally {
    for (const worker of workers) worker.terminate()
  }
}
