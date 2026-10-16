// The open cells filled without gradients: a greedy search that tries the choices of one cell at a time in the
// exact parser on the train samples and keeps the best one, and goes over the cells again until a pass changes
// nothing or a limit of passes ends it. It is the search of the JSON side (lab/recovery-parser/learn/search/ and
// arms/holes/restricted-search.ts) on this parser's cells.
//
// - The score of a choice is two counts over the train samples: the scored code points with all three right, and
//   the labels that are right one by one. A choice is better when the first count is higher, or the first is the
//   same and the second is higher. Of several best choices the first of the cell's list is taken, and a cell only
//   changes for a choice that is better than the one it holds.
// - The choices of a cell are its whole list, see choicesOf: 16.6 on average.
// - The order of a pass is from the cell that the most samples read to the least read one, or with an order seed a
//   random order that is drawn anew for every pass.
// - Only a sample whose run reads the cell can change, so each of the 4 worker threads keeps one bit per sample
//   and cell, and runs only those samples again.
// - The search changes no display entry. `--count` sets them after it, see count.ts, and `--in-turns` goes on with
//   the search and the count in turns until a count changes no entry.
// - The cells of the end of input stay as they are: no label asks about them.
//
//   bun lab/recovery-lr/learn/search/search.ts [--from <tables.json>] [--out <file.json>] [--passes <most passes>]
//     [--order <seed>] [--train <samples>] [--validation <samples>] [--flag] [--without-end-early] [--count] [--in-turns]
// Without --from the search starts from the parser as it is, with the flag "first on its line" for --flag and
// without the choices "end an item early" for --without-end-early. It scores the validation samples after every
// pass, for the log only. --from refuses tables that were saved with another version of the dataset: a change of
// the generator moves samples between the splits.
import {mkdirSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {createRandom} from '../../random.ts'
import {type PackedSamples, loadPacked, messageOf, refuseOtherTerminals} from '../data.ts'
import {flagOf, learnFolder, numberOf, optionOf, refuseUnknownOptions, standardTrainCount, standardValidationCount} from '../options.ts'
import {type RecoveryTables, addFirstOnLineFlag, baseTables, cellName, changeableCellsOf, checkTables, choicesOf, copyTables, differencesOf, loadTablesOfThisDataset, saveTables, withoutEndEarly} from '../recovery-tables.ts'
import {scoreRow, scoreTables, sharesOf, totalScore} from '../score.ts'
import {displayEntriesByCount} from './count.ts'
import type {Reply, Request} from './search-worker.ts'

export type SearchOptions = {
  // With a seed, every pass has a random order of its own. Without, a pass goes from the most read cell down.
  orderSeed?: number | undefined
  // The most passes over the cells. A search also ends when a pass changes nothing.
  maximumPasses?: number
  workers?: number
  // Called after every pass with the tables as they are, e.g. to log a validation score.
  afterPass?: (pass: number, tables: RecoveryTables, changesOfPass: number, runs: number) => void
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

// Searches the choices of `cells` from the tables `start`, which are not changed, on the packed samples `train`.
// Every other cell and every display entry keeps what `start` holds.
export async function searchCells(start: RecoveryTables, cells: readonly number[], train: PackedSamples, options: SearchOptions = {}): Promise<SearchResult> {
  checkTables(start)
  refuseOtherTerminals(train, start)
  const tables = copyTables(start)
  for (const cell of cells) if (tables.open[cell] !== 1) throw new Error(`the search got the cell ${cellName(tables, cell)}, which is frozen`)
  const workerCount = options.workers ?? 4
  const maximumPasses = options.maximumPasses ?? 50
  const workers = Array.from({length: workerCount}, () => new Worker(new URL('./search-worker.ts', import.meta.url).href))
  // One request to every worker, and their replies in the order of the workers.
  const ask = (requestOf: (share: number) => Request): Promise<Reply[]> => Promise.all(workers.map((worker, share) => new Promise<Reply>((resolve, reject) => {
    worker.onmessage = event => resolve(event.data as Reply)
    worker.onerror = event => reject(new Error(`worker ${share}: ${event.message}`))
    worker.postMessage(requestOf(share))
  })))
  try {
    let total = totalScore(train, tables)
    let runs = 0, changes = 0, passes = 0
    let lastPassChangedNothing = false
    await ask(share => ({type: 'start', samples: messageOf(train), tables, share, shares: workerCount}))
    const inTableOrder = [...cells].sort((left, right) => left - right)
    // The cells from the most read one to the least read one, by how many samples read them with the tables as
    // they are at the start of the pass.
    const mostReadFirst = async (): Promise<number[]> => {
      const readers = new Int32Array(tables.choice.length)
      for (const reply of await ask(() => ({type: 'readers'}))) {
        if (reply.type !== 'readers') throw new Error('a worker gave another reply than readers')
        for (let cell = 0; cell < readers.length; cell++) readers[cell]! += reply.readers[cell]!
      }
      return [...inTableOrder].sort((left, right) => readers[right]! - readers[left]! || left - right)
    }
    while (passes < maximumPasses && !lastPassChangedNothing) {
      passes++
      const order = options.orderSeed === undefined ? await mostReadFirst() : createRandom(options.orderSeed, passes).shuffled(inTableOrder)
      let changesOfPass = 0
      for (const cell of order) {
        const candidates = Int16Array.from(choicesOf(tables, cell).filter(choice => choice !== tables.choice[cell]))
        const allRight = new Int32Array(candidates.length)
        const labelsRight = new Int32Array(candidates.length)
        for (const reply of await ask(() => ({type: 'evaluate', cell, candidates}))) {
          if (reply.type !== 'evaluated') throw new Error('a worker gave another reply than evaluated')
          runs += reply.runs
          for (let candidate = 0; candidate < candidates.length; candidate++) {
            allRight[candidate]! += reply.allRight[candidate]!
            labelsRight[candidate]! += reply.labelsRight[candidate]!
          }
        }
        // The best choice, and the first of several that are equally good. It has to be better than what the cell holds.
        let best = -1
        for (let candidate = 0; candidate < candidates.length; candidate++) {
          const bestAllRight = best === -1 ? 0 : allRight[best]!
          const bestLabelsRight = best === -1 ? 0 : labelsRight[best]!
          if (allRight[candidate]! > bestAllRight || (allRight[candidate] === bestAllRight && labelsRight[candidate]! > bestLabelsRight)) best = candidate
        }
        if (best === -1) continue
        const choice = candidates[best]!
        tables.choice[cell] = choice
        for (const reply of await ask(() => ({type: 'apply', cell, choice}))) if (reply.type === 'applied') runs += reply.runs
        total = {allRight: total.allRight + allRight[best]!, labelsRight: total.labelsRight + labelsRight[best]!}
        changesOfPass++
      }
      changes += changesOfPass
      lastPassChangedNothing = changesOfPass === 0
      options.afterPass?.(passes, tables, changesOfPass, runs)
    }
    // The steps have to add up to what a run of every sample gives with the tables at the end.
    const checked = totalScore(train, tables)
    if (checked.allRight !== total.allRight || checked.labelsRight !== total.labelsRight) throw new Error(`the steps of the search add up to ${total.allRight} code points and ${total.labelsRight} labels, and a run of every sample gives ${checked.allRight} and ${checked.labelsRight}`)
    return {tables, passes, lastPassChangedNothing, changes, runs}
  } finally {
    for (const worker of workers) worker.terminate()
  }
}

// The most rounds of a search and a count in turns. A round whose count changes no display entry ends the turns:
// the search before it ended with those entries, so the next one would change no cell.
export const roundsInTurns = 8

if (import.meta.main) {
  refuseUnknownOptions('search.ts', ['--from', '--out', '--passes', '--order', '--train', '--validation'], ['--flag', '--without-end-early', '--count', '--in-turns'])
  const from = optionOf('--from')
  if (from !== undefined && (flagOf('--flag') || flagOf('--without-end-early'))) throw new Error('--flag and --without-end-early make the tables that a search starts from, and --from names them')
  let start: RecoveryTables
  if (from !== undefined) start = loadTablesOfThisDataset(from).tables
  else {
    start = baseTables()
    if (flagOf('--without-end-early')) start = withoutEndEarly(start)
    if (flagOf('--flag')) start = addFirstOnLineFlag(start)
  }
  const orderOption = optionOf('--order')
  const orderSeed = orderOption === undefined ? undefined : Number(orderOption)
  const maximumPasses = numberOf('--passes', 50)
  const name = `search${from === undefined ? '' : '-from-tables'}${flagOf('--flag') ? '-flag' : ''}${flagOf('--without-end-early') ? '-without-end-early' : ''}${orderSeed === undefined ? '' : `-order-${orderSeed}`}${flagOf('--in-turns') ? '-in-turns' : flagOf('--count') ? '-count' : ''}`
  const out = optionOf('--out') ?? join(learnFolder('search'), `${name}.json`)
  if (from !== undefined && optionOf('--out') === undefined) throw new Error('a search with --from needs --out: it does not make up a name from the file that it started from')
  mkdirSync(dirname(out), {recursive: true})
  const lines: string[] = []
  const log = (line: string) => {
    console.log(line)
    lines.push(line)
    writeFileSync(out.replace(/\.json$/, '.log'), `${lines.join('\n')}\n`)
  }
  const loadStarted = performance.now()
  const train = loadPacked('train', numberOf('--train', standardTrainCount), start)
  const validation = loadPacked('validation', numberOf('--validation', standardValidationCount), start)
  log(`${train.sampleCount} train samples with ${train.scoredCodePoints} scored code points and ${validation.sampleCount} validation samples with ${validation.scoredCodePoints}, loaded in ${((performance.now() - loadStarted) / 1000).toFixed(1)} s.`)
  const cells = changeableCellsOf(start)
  log(`The search goes over ${cells.length} open cells${orderSeed === undefined ? ', the most read first' : `, in a random order of the seed ${orderSeed}`}, for at most ${maximumPasses} passes.`)
  const line = (what: string, tables: RecoveryTables) => {
    const trainShares = sharesOf(scoreTables(tables, train).score), validationShares = sharesOf(scoreTables(tables, validation).score)
    log(`${what}: train all three ${trainShares.allThree.toFixed(2)}, whole ${trainShares.whole.toFixed(2)}; validation all three ${validationShares.allThree.toFixed(2)}, whole ${validationShares.whole.toFixed(2)}, stack ${validationShares.stack.toFixed(2)}`)
  }
  line('The tables at the start', start)
  const searchFrom = async (tables: RecoveryTables): Promise<RecoveryTables> => {
    const started = performance.now()
    const result = await searchCells(tables, cells, train, {
      orderSeed, maximumPasses,
      afterPass: (pass, now, changesOfPass, runs) => line(`Pass ${pass}: ${changesOfPass} cells changed, ${(runs / 1e6).toFixed(1)} million runs of a sample so far, ${((performance.now() - started) / 1000).toFixed(0)} s`, now),
    })
    log(`The search ended ${result.lastPassChangedNothing ? `when pass ${result.passes} changed nothing` : `after its ${result.passes} passes`}, after ${result.changes} changes of a cell and ${(result.runs / 1e6).toFixed(1)} million runs of a sample, in ${((performance.now() - started) / 1000).toFixed(0)} s.`)
    return result.tables
  }
  let tables = await searchFrom(start)
  if (flagOf('--count') || flagOf('--in-turns')) {
    for (let round = 1; round <= (flagOf('--in-turns') ? roundsInTurns : 1); round++) {
      const counted = displayEntriesByCount(tables, train)
      tables = counted.tables
      line(`The count ${round}: ${counted.entriesChanged} display entries changed`, tables)
      if (!flagOf('--in-turns') || counted.entriesChanged === 0 || round === roundsInTurns) break
      tables = await searchFrom(tables)
    }
  }
  const differences = differencesOf(start, tables)
  saveTables(out, tables, `${name}: ${train.sampleCount} train samples, ${differences.filter(difference => difference.table === 'cells').length} cells and ${differences.filter(difference => difference.table === 'display').length} display entries changed against the tables at the start`)
  log(`${differences.filter(difference => difference.table === 'cells').length} cells and ${differences.filter(difference => difference.table === 'display').length} display entries differ from the tables at the start. Saved to ${out}.`)
  log(scoreRow('validation', scoreTables(tables, validation).score))
}
