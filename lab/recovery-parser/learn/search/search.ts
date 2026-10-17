// Fills the open cells by search, without gradients: for one open cell at a time, try its choices in the exact
// parser and keep the one with the best score on the train split, and go over the cells again until a pass changes
// nothing or a limit ends the search.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/search/search.ts [--from <tables.json> --out <tables.json>] [--pairs known]
//       [--passes 50] [--runs 1400] [--minutes <minutes>] [--workers 4] [--order 0] [--without-kinds hashComment,foreignLiteral]
//       [--end-events] [--scratch <folder>]
// --from   the tables to start from, e.g. the ones votes.ts saved. Without it, today's tables. With it, --out has to
//          name the output: the search does not make up a name from the name of the file it started from. A file
//          that was saved with another version of the dataset is refused, see otherDatasetOf in ../recovery-tables.ts.
// --out    where the tables go after every pass. A log goes next to it, with the same name and .log. Without --from
//          and --out, the tables go to <scratch>/search/search-from-today.json, with the order and the kinds that are
//          left out in the name.
// --passes the most passes over the open cells. A search that this limit ends can be repeated: it ends at the same
//          step on every machine.
// --pairs  which choices of a tokenizer cell a step tries:
//          parts  one part at a time: every other next state with the event the cell holds, and every other event
//                 with the next state it holds
//          known  those, and every pair of next state and event that some cell of today's tokenizer table holds, e.g.
//                 (string, stringStart)
//          all    every pair
//          A grammar cell's choices are always tried as pairs of next state and stack action.
// --end-events  also tries the three events of a text's end (end, endInsideToken, truncatedEnd) in a tokenizer cell.
//          Without it they are left out: a code point with such an event is shown as "past the end", the display kind
//          of the cells after a text, which no recovery would show for a character of the text. The first searches of
//          this folder tried them, and used the event `end` to give the grammar its token.
// --runs   the budget, in millions of runs of a sample. The search stops inside a pass when it is used up. It is a
//          count and not a time, so a rerun stops at the same step.
// --minutes  a stop by the clock. It is off unless the option is given, because a search that the clock stops cannot
//          be repeated: a rerun may stop at another step. When it is the one that stops the search, the log says so.
// --order  0 goes over the cells of a pass from the most read one to the least read one. Any other number is the seed
//          of a random order, a new one in every pass. The search ends in other tables for another order, so a few
//          orders say how much of a score is the order's doing.
// --without-kinds  leaves out every train sample with one of these kinds of damage. The validation rows of those
//          kinds then say how the search does on damage it has not seen, without a look at the test split.
//
// The score of a choice is two counts over the train split's scored code points, see ../score.ts: the code points
// with every scored label right, and the labels that are right one by one (display kind, depth, container).
// A choice is better when the first count is higher, or the first is the same and the second is higher. The second
// count lets the search keep a step that e.g. gets the depth right before another cell gets the display kind right.
//
// The search never reads the test split. It scores the validation split after every pass, for the log only.
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs'
import {basename, dirname, join} from 'node:path'
import {createRandom} from '../../random.ts'
import {cacheFolderOf, loadStandardSamples, optionOf, refuseUnknownOptions, selectSamples, trainPart, validationPart} from '../data.ts'
import {
  type RecoveryTables, actionByToken, actionCount, actionOfToken, asIsTables, checkTables, differencesOf, eventNames, grammarCellName, grammarChoiceName, lexerCellName, lexerChoiceName,
  loadTablesOfThisDataset, saveTables, today,
} from '../recovery-tables.ts'
import {scoreTables, sharesOf} from '../score.ts'
import {cellBitCount, messageOf, prepareSamples, totalScore} from './sample-runs.ts'
import type {Reply, Request} from './search-worker.ts'

refuseUnknownOptions('search/search.ts', ['--from', '--out', '--pairs', '--passes', '--runs', '--minutes', '--workers', '--order', '--without-kinds', '--end-events', '--scratch'])
const scratchFolder = optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH']
const fromFile = optionOf('--from')
const pairs = optionOf('--pairs') ?? 'known'
if (!['parts', 'known', 'all'].includes(pairs)) throw new Error(`--pairs takes parts, known or all, and got ${pairs}`)
const maximumPasses = Number(optionOf('--passes') ?? 50)
const maximumRuns = Number(optionOf('--runs') ?? 1400) * 1e6
const maximumMinutes = Number(optionOf('--minutes') ?? Infinity)
const orderSeed = Number(optionOf('--order') ?? 0)
const withoutKinds = (optionOf('--without-kinds') ?? '').split(',').filter(name => name !== '')
const withEndEvents = process.argv.includes('--end-events')
// The events of a text's end. Only a cell of the two classes of a text's end holds one today, and the search reads
// no such cell, since it runs the code points of a text and not the position after them.
const endEvents = new Set((['end', 'endInsideToken', 'truncatedEnd'] as const).map(name => eventNames.indexOf(name)))
const workerCount = Math.min(4, Math.max(1, Number(optionOf('--workers') ?? 4)))
if (fromFile !== undefined && optionOf('--out') === undefined) throw new Error('search.ts with --from needs --out <tables.json>: name the output yourself, e.g. --out $RECOVERY_SCRATCH/search/search-from-votes.json')
const outFile = optionOf('--out') ?? (scratchFolder === undefined ? undefined : join(scratchFolder, 'search', `search-from-today${orderSeed === 0 ? '' : `-order-${orderSeed}`}${withoutKinds.length === 0 ? '' : `-without-${withoutKinds.join('-')}`}.json`))
if (outFile === undefined) throw new Error('search.ts needs --out <tables.json>, or a scratch folder from --scratch or the environment variable RECOVERY_SCRATCH')
mkdirSync(dirname(outFile), {recursive: true})
const logFile = outFile.replace(/\.json$/, '') + '.log'
writeFileSync(logFile, '')
const log = (line: string) => {
  console.log(line)
  appendFileSync(logFile, line + '\n')
}

const started = performance.now()
const seconds = () => ((performance.now() - started) / 1000).toFixed(1)
const samples = loadStandardSamples(cacheFolderOf(scratchFolder))
const wholeTrain = trainPart(samples)
for (const kind of withoutKinds) if (!wholeTrain.kindNames.includes(kind)) throw new Error(`--without-kinds names ${kind}, which is no kind of damage`)
const leftOut = withoutKinds.map(kind => wholeTrain.kindNames.indexOf(kind))
const hasLeftOutKind = (place: number) => wholeTrain.kindList.subarray(wholeTrain.kindStart[place], wholeTrain.kindStart[place + 1]).some(kind => leftOut.includes(kind))
const train = withoutKinds.length === 0 ? wholeTrain : selectSamples(wholeTrain, Int32Array.from({length: wholeTrain.sampleCount}, (_, place) => place).filter(place => !hasLeftOutKind(place)))
const validation = validationPart(samples)
// Tables to start from have to be of this dataset: the search's output is saved with this dataset's key, and tables
// that were made with another version of the dataset may have seen samples that are validation or test samples now.
const tables: RecoveryTables = fromFile === undefined ? asIsTables() : loadTablesOfThisDataset(fromFile).tables
checkTables(tables)
// The search's own parser loop, in sample-runs.ts, gives every code point the class that the tables give it, and
// reads the bit "first on its line" when the tables have it.
const prepared = prepareSamples(train, tables)
const startTables = fromFile === undefined ? asIsTables() : loadTablesOfThisDataset(fromFile).tables

const percent = (count: number, of: number) => (100 * count / of).toFixed(2)
const validationLine = () => {
  const shares = sharesOf(scoreTables(tables, validation, {breakdowns: false}).rows[0]!)
  return `validation: all three ${(100 * shares.allThree).toFixed(2)}%, kind ${(100 * shares.kind).toFixed(2)}%, depth ${(100 * shares.depth).toFixed(2)}%, container ${(100 * shares.container).toFixed(2)}%, whole samples ${(100 * shares.whole).toFixed(2)}%`
}
// The search's two counts have to be the ones of score.ts.
const checkedTotal = () => {
  const total = totalScore(prepared, tables)
  const row = scoreTables(tables, train, {splits: ['train'], breakdowns: false}).rows[0]!
  if (row.allRight !== total.allRight || row.kindRight + row.depthRight + row.containerRight !== total.labelsRight || row.codePoints !== prepared.scoredCodePoints) {
    throw new Error(`the search counts ${total.allRight} code points with all three labels right and ${total.labelsRight} right labels on the train split, and score.ts ${row.allRight} and ${row.kindRight + row.depthRight + row.containerRight}`)
  }
  return total
}
let total = checkedTotal()
log(`Search from ${fromFile ?? 'today\'s tables'}, choices of a tokenizer cell: ${pairs}${withEndEvents ? ', with the events of a text\'s end' : ', without the events of a text\'s end'}, ${orderSeed === 0 ? 'most read cells first' : `random order ${orderSeed}`}, ${workerCount} worker threads, at most ${maximumPasses} passes and ${maximumRuns / 1e6} million runs${Number.isFinite(maximumMinutes) ? `, and a stop by the clock after ${maximumMinutes} minutes` : ', no stop by the clock'}.`)
log(`Dataset ${samples.datasetKey}. Train split${withoutKinds.length === 0 ? '' : ` without the kinds ${withoutKinds.join(', ')}`}: ${prepared.sampleCount} broken samples, ${prepared.scoredCodePoints} scored code points.`)
log(`Start: train all three ${percent(total.allRight, prepared.scoredCodePoints)}% (${total.allRight} code points, ${total.labelsRight} right labels). ${validationLine()}`)

// The pairs of next state and event that today's tokenizer table holds somewhere.
const knownPairs: number[] = []
{
  const seen = new Set<number>()
  for (let cell = 0; cell < today.lexerNext.length; cell++) {
    const pair = today.lexerNext[cell]! * 256 + today.lexerEvent[cell]!
    if (!seen.has(pair)) {
      seen.add(pair)
      knownPairs.push(pair)
    }
  }
  knownPairs.sort((left, right) => left - right)
}

// The choices to try for a cell, two numbers each, without the one the cell holds.
function candidatesOf(grammar: boolean, cell: number): Uint8Array {
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
    if (!withEndEvents && endEvents.has(event)) return
    if (seen.has(next * 256 + event)) return
    seen.add(next * 256 + event)
    candidates.push(next, event)
  }
  if (pairs === 'all') {
    for (let next = 0; next < tables.lexerStateCount; next++) for (let event = 0; event < tables.eventCount; event++) add(next, event)
  } else {
    for (let next = 0; next < tables.lexerStateCount; next++) add(next, eventNow)
    for (let event = 0; event < tables.eventCount; event++) add(nextNow, event)
    if (pairs === 'known') for (const pair of knownPairs) add(pair >> 8, pair & 255)
  }
  return Uint8Array.from(candidates)
}

// One request to every worker, and their replies in the order of the workers.
const workers = Array.from({length: workerCount}, () => new Worker(new URL('./search-worker.ts', import.meta.url).href))
function ask(requestOf: (share: number) => Request): Promise<Reply[]> {
  return Promise.all(workers.map((worker, share) => new Promise<Reply>((resolve, reject) => {
    worker.onmessage = event => resolve(event.data as Reply)
    worker.onerror = event => reject(new Error(`worker ${share}: ${event.message}`))
    worker.postMessage(requestOf(share))
  })))
}

const lexerCellCount = tables.lexerNext.length
const cellCount = cellBitCount(tables)
let runs = 0
let stoppedBy = ''
await ask(share => ({type: 'start', samples: messageOf(prepared), tables, share, shares: workerCount}))

let pass = 0
for (; pass < maximumPasses && stoppedBy === '';) {
  pass++
  // The open cells in the order of how many samples read them at the start of the pass, most read first: the cells
  // that most of the score depends on are settled before the cells that are read after them. Or in a random order.
  const readers = new Int32Array(cellCount)
  for (const reply of await ask(() => ({type: 'readers'}))) {
    if (reply.type !== 'readers') throw new Error('a worker gave another reply than readers')
    for (let bit = 0; bit < cellCount; bit++) readers[bit]! += reply.readers[bit]!
  }
  let order: number[] = []
  for (let bit = 0; bit < cellCount; bit++) if ((bit < lexerCellCount ? tables.lexerOpen[bit] : tables.grammarOpen[bit - lexerCellCount]) === 1) order.push(bit)
  if (orderSeed === 0) order.sort((left, right) => readers[right]! - readers[left]! || left - right)
  else order = createRandom(orderSeed, pass).shuffled(order)
  const readAtStart = order.filter(bit => readers[bit]! > 0).length
  let changes = 0
  let tried = 0
  const passRuns = runs
  for (const bit of order) {
    if (runs >= maximumRuns) stoppedBy = `the budget of ${maximumRuns / 1e6} million runs`
    else if (performance.now() - started > maximumMinutes * 60_000) stoppedBy = `the clock, after ${maximumMinutes} minutes: a rerun may stop at another step`
    if (stoppedBy !== '') break
    const grammar = bit >= lexerCellCount
    const cell = grammar ? bit - lexerCellCount : bit
    const candidates = candidatesOf(grammar, cell)
    const candidateCount = candidates.length / 2
    const allRight = new Int32Array(candidateCount)
    const labelsRight = new Int32Array(candidateCount)
    for (const reply of await ask(() => ({type: 'evaluate', grammar, cell, candidates}))) {
      if (reply.type !== 'evaluated') throw new Error('a worker gave another reply than evaluated')
      runs += reply.runs
      for (let candidate = 0; candidate < candidateCount; candidate++) {
        allRight[candidate]! += reply.allRight[candidate]!
        labelsRight[candidate]! += reply.labelsRight[candidate]!
      }
    }
    tried++
    // The best choice, and the first of several that are equally good. It has to be better than what the cell holds.
    let best = -1
    for (let candidate = 0; candidate < candidateCount; candidate++) {
      const bestAllRight = best === -1 ? 0 : allRight[best]!
      const bestLabelsRight = best === -1 ? 0 : labelsRight[best]!
      if (allRight[candidate]! > bestAllRight || (allRight[candidate] === bestAllRight && labelsRight[candidate]! > bestLabelsRight)) best = candidate
    }
    if (best === -1) continue
    const name = grammar ? grammarCellName(tables, cell) : lexerCellName(tables, cell)
    const before = grammar ? grammarChoiceName(tables, cell) : lexerChoiceName(tables, cell)
    const first = candidates[best * 2]!
    const second = candidates[best * 2 + 1]!
    if (grammar) {
      tables.grammarNext[cell] = first
      tables.grammarAction[cell] = second
    } else {
      tables.lexerNext[cell] = first
      tables.lexerEvent[cell] = second
    }
    for (const reply of await ask(() => ({type: 'apply', grammar, cell, first, second}))) if (reply.type === 'applied') runs += reply.runs
    total = {allRight: total.allRight + allRight[best]!, labelsRight: total.labelsRight + labelsRight[best]!}
    changes++
    log(`  pass ${pass}, ${seconds()} s: ${grammar ? 'grammar  ' : 'tokenizer'} ${name}  ${before}  ->  ${grammar ? grammarChoiceName(tables, cell) : lexerChoiceName(tables, cell)}   ${allRight[best]! >= 0 ? '+' : ''}${allRight[best]} code points, ${labelsRight[best]! >= 0 ? '+' : ''}${labelsRight[best]} labels, train all three ${percent(total.allRight, prepared.scoredCodePoints)}%`)
  }
  const checked = checkedTotal()
  if (checked.allRight !== total.allRight || checked.labelsRight !== total.labelsRight) throw new Error(`after pass ${pass} the steps add up to ${total.allRight} code points and ${total.labelsRight} labels, and a run of every sample gives ${checked.allRight} and ${checked.labelsRight}`)
  // Two counts: what the search changed, against the tables it started from, and what differs from today's parser.
  const changedAgainstStart = differencesOf(startTables, tables).length
  const differFromToday = differencesOf(asIsTables(), tables).length
  const note = `search from ${fromFile === undefined ? 'today\'s tables' : basename(fromFile)}, --pairs ${pairs}${withEndEvents ? ', --end-events' : ''}${orderSeed === 0 ? '' : `, --order ${orderSeed}`}${withoutKinds.length === 0 ? '' : `, without the kinds ${withoutKinds.join(', ')}`}, after pass ${pass}${stoppedBy === '' ? '' : `, which stopped by ${stoppedBy}`}: ${changedAgainstStart} cells changed against the tables it started from, ${differFromToday} cells differ from today's parser, train all three ${percent(total.allRight, prepared.scoredCodePoints)}%`
  saveTables(outFile, tables, note)
  log(`Pass ${pass} ${stoppedBy === '' ? 'done' : `stopped by ${stoppedBy}`} at ${seconds()} s: ${tried} of ${order.length} open cells tried (${readAtStart} were read at the start of the pass), ${changes} changed, ${((runs - passRuns) / 1e6).toFixed(1)} million runs. ${changedAgainstStart} cells changed against the tables the search started from, and ${differFromToday} cells differ from today's parser.`)
  log(`  train: all three ${percent(total.allRight, prepared.scoredCodePoints)}% (${total.allRight} code points, ${total.labelsRight} right labels). ${validationLine()}`)
  if (changes === 0 && stoppedBy === '') {
    stoppedBy = 'a pass that changed nothing'
    break
  }
}
if (stoppedBy === '') stoppedBy = `the limit of ${maximumPasses} passes`
log(`The search ended by ${stoppedBy}, in pass ${pass}, after ${(runs / 1e6).toFixed(1)} million runs and ${seconds()} s. Tables: ${outFile}`)
for (const worker of workers) worker.terminate()
