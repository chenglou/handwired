// HELD BACK. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read
// this file or its output, see README.md.
//
// Row 13 of the final table, "a search per sample, which shows what the list of choices can express", for any
// list of samples: the train side's validation samples, the generated mistakes and the written cases.
//
// Two searches exist, and both give what the list can at least do. Each keeps a number of runs after every token,
// the ones with the most code points right, and they differ in which of the level runs they keep:
// - The search of ../learn/search/per-sample.ts keeps the ones with the shortest stack.
// - The search of this file keeps the ones that changed the least: the fewest steps at open cells that are not the
//   parser's own default reduction. Among those it keeps two sets, the runs with the fewest steps and the runs
//   with the shortest stacks. It was written for the generated mistakes, see specific/README.md: there the first
//   error's token is often added text, which has no label, so every run is level after it, and the runs with the
//   shortest stacks are the ones that threw the most away.
// A review found the first search 11.6 points of whole samples below the second on the generated mistakes with one
// kind. Neither is above the other on every sample, and the higher of the two per sample is also a run that the
// list of choices allows. So the row takes, per sample, the most code points right of the two searches, and of the
// runs of given tables when there are some: bestOfBothSearches.
//
// Run from the repo root:
//   bun lab/recovery-lr/held-back/search-per-sample.ts --set validation|specific|written [--count <samples>] [--width 64] [--without-end-early]
// It prints, for each search and for the better of the two per sample, "all three", "whole" and, for the search of
// this file, the samples with every token right. It prints counts and no text of a sample. 400 generated samples
// take 47 s on 4 threads with other jobs running.
import {defaultSeed, loadSamples} from '../dataset.ts'
import {displayKind, displayKindCount} from '../labels.ts'
import {type PackedSamples, packSamples, packedComment} from '../learn/data.ts'
import {containerOfStack, depthOfStack} from '../learn/recovery-parser.ts'
import {type RecoveryTables, applyChoice, baseTables, choiceStop, choicesOf, maximumStepsPerToken, tokenSkipped, tokenStays, tokenTaken, withoutEndEarly} from '../learn/recovery-tables.ts'
import {runSample, scorePack} from '../learn/score.ts'
import {searchPerSample} from '../learn/search/per-sample.ts'
import type {Sample} from '../sample.ts'

// One run: its stack, the code points that it has right so far, of which in tokens, the steps at open cells in
// which it did another thing than the parser as it is, its steps for the token at hand, and all its steps.
type Run = {stack: number[], right: number, rightInTokens: number, changes: number, steps: number, allSteps: number}
// The order of the runs: the most code points right, then the fewest changes, then the fewest steps, e.g. a
// token that is skipped at once before one that is skipped after six reductions.
const better = (left: Run, right: Run): number => right.right - left.right || left.changes - right.changes || left.allSteps - right.allSteps || left.stack.length - right.stack.length
// A second order, which keeps other runs among level ones: the shortest stack before the fewest steps. A run
// that drops a part of the stack and builds another one in its place takes many steps and leaves a short stack.
const betterWithShortStack = (left: Run, right: Run): number => right.right - left.right || left.changes - right.changes || left.stack.length - right.stack.length || left.allSteps - right.allSteps
// The runs that go on after a token: the first `width` in each of the two orders.
function keptOf(runs: Run[], width: number): Run[] {
  if (runs.length <= width) return runs
  const kept = new Set(runs.sort(better).slice(0, width))
  for (const run of runs.sort(betterWithShortStack).slice(0, width)) kept.add(run)
  return [...kept]
}

export type Best = {right: number, rightInTokens: number, scoredInTokens: number}

const perKind = new Int32Array(displayKindCount)
// The code points of a packed token that have all three right when the token is shown with the kind, or with the
// best kind for -1, and with the depth and the container of the stack.
function rightOfToken(samples: PackedSamples, token: number, stack: readonly number[], kind: number): number {
  const depth = depthOfStack(stack), container = containerOfStack(stack)
  let right = 0
  perKind.fill(0)
  for (let group = samples.groupStart[token]!; group < samples.groupStart[token + 1]!; group++) {
    if (samples.groupDepth[group] !== depth || samples.groupContainer[group] !== container) continue
    if (kind === -1) {
      perKind[samples.groupKind[group]!]! += samples.groupCount[group]!
      if (perKind[samples.groupKind[group]!]! > right) right = perKind[samples.groupKind[group]!]!
    } else if (samples.groupKind[group] === kind) right += samples.groupCount[group]!
  }
  return right
}

// The best run that the search finds for one sample.
export function bestOfSample(sample: Sample, tables: RecoveryTables, width: number): Best {
  const samples = packSamples([sample], tables)
  const {terminalCount} = tables
  const first = samples.tokenStart[0]!, end = samples.tokenStart[1]! - 1
  let scoredInTokens = 0
  for (let at = first; at < end; at++) if (samples.terminal[at]! >= 0) for (let group = samples.groupStart[at]!; group < samples.groupStart[at + 1]!; group++) scoredInTokens += samples.groupCount[group]!
  let kept: Run[] = [{stack: Array.from(samples.stackState.subarray(samples.stackStart[0], samples.stackStart[1])), right: 0, rightInTokens: 0, changes: 0, steps: 0, allSteps: 0}]
  for (let at = first; at < end; at++) {
    const terminal = samples.terminal[at]!
    if (terminal < 0) {
      for (const run of kept) run.right += rightOfToken(samples, at, run.stack, terminal === packedComment ? displayKind.comment : displayKind.whitespace)
      continue
    }
    // The runs that have taken or skipped the token, the best one per stack.
    const done = new Map<string, Run>()
    const finish = (run: Run, entry: number) => {
      const right = rightOfToken(samples, at, run.stack, tables.displayOpen[entry] === 1 ? -1 : tables.display[entry]!)
      run.right += right
      run.rightInTokens += right
      const key = run.stack.join()
      const other = done.get(key)
      if (other === undefined || better(run, other) < 0) done.set(key, run)
    }
    // The fewest changes with which a stack was reached while the token was read. Within a token the runs differ
    // in what they had right before it and in their changes.
    const reached = new Map<string, Run>()
    let live = kept
    for (const run of live) run.steps = 0
    while (live.length > 0) {
      const next: Run[] = []
      for (const run of live) {
        const state = run.stack.at(-1)!
        if (run.steps === maximumStepsPerToken) {
          finish(run, state * terminalCount + terminal)
          continue
        }
        const cell = state * terminalCount + terminal
        const isOpen = tables.open[cell] === 1
        const choices = isOpen ? choicesOf(tables, cell) : [tables.choice[cell]!]
        for (const choice of choices) {
          if (choice === choiceStop) continue
          const child: Run = {stack: run.stack.slice(), right: run.right, rightInTokens: run.rightInTokens, changes: run.changes + (isOpen && choice !== tables.choice[cell] ? 1 : 0), steps: run.steps + 1, allSteps: run.allSteps + 1}
          const became = applyChoice(child.stack, choice)
          if (became === tokenStays) {
            const key = child.stack.join()
            const other = reached.get(key)
            if (other !== undefined && better(child, other) >= 0) continue
            reached.set(key, child)
            next.push(child)
          } else if (became === tokenSkipped || became === tokenTaken) finish(child, child.stack.at(-1)! * terminalCount + terminal)
          else throw new Error(`the cell ${cell} holds ${choice}, which the search does not know`)
        }
      }
      live = keptOf(next, width * 4)
    }
    kept = keptOf([...done.values()], width)
  }
  const best = kept.reduce((left, right) => better(left, right) <= 0 ? left : right)
  return {right: best.right, rightInTokens: best.rightInTokens, scoredInTokens}
}

export type BestRunsRequest = {samples: Sample[], tables: RecoveryTables, width: number}
export type BestRunsReply = {best: Best[]}

// The search of this file for every sample, on 4 worker threads.
export async function bestRunsOf(samples: readonly Sample[], layout: RecoveryTables, width = 64, workerCount = 4): Promise<Best[]> {
  const workers = Array.from({length: workerCount}, () => new Worker(new URL('./search-per-sample-worker.ts', import.meta.url).href))
  try {
    const replies = await Promise.all(workers.map((worker, share) => new Promise<BestRunsReply>((resolve, reject) => {
      worker.onmessage = event => resolve(event.data as BestRunsReply)
      worker.onerror = event => reject(new Error(`worker ${share}: ${event.message}`))
      worker.postMessage({samples: samples.filter((_, index) => index % workerCount === share), tables: layout, width} satisfies BestRunsRequest)
    })))
    return samples.map((_, index) => replies[index % workerCount]!.best[Math.floor(index / workerCount)]!)
  } finally {
    for (const worker of workers) worker.terminate()
  }
}

// Row 13: per sample, the most scored code points with all three right of the search of learn/, of the search of
// this file and of the runs of `alsoRunsOf`, which are tables of the layout. `ofLearn` and `ofThisFile` are what
// each search finds alone.
export async function bestOfBothSearches(samples: readonly Sample[], layout: RecoveryTables, width = 64, alsoRunsOf: readonly RecoveryTables[] = []): Promise<{right: Int32Array, ofLearn: Int32Array, ofThisFile: Best[]}> {
  const packed = packSamples(samples, layout)
  const ofLearn = await searchPerSample(packed, layout, width)
  const ofThisFile = await bestRunsOf(samples, layout, width)
  const right = Int32Array.from(samples, (_, index) => Math.max(ofLearn[index]!, ofThisFile[index]!.right, ...alsoRunsOf.map(tables => Math.floor(runSample(packed, index, tables) / scorePack))))
  return {right, ofLearn, ofThisFile}
}

if (import.meta.main) {
  const options = process.argv.slice(2)
  const optionOf = (name: string): string | undefined => options.includes(name) ? options[options.indexOf(name) + 1] : undefined
  const set = optionOf('--set'), width = Number(optionOf('--width') ?? 64), count = optionOf('--count') === undefined ? undefined : Number(optionOf('--count'))
  const layout = options.includes('--without-end-early') ? withoutEndEarly(baseTables()) : baseTables()
  // The two held-back sets are loaded here and not at the top of the file, so that a worker thread does not load them.
  const sets: [string, Sample[]][] = []
  if (set === 'validation') sets.push(['the validation samples', loadSamples('validation', defaultSeed, count ?? 5000)])
  else if (set === 'specific') {
    const {loadSpecific} = await import('./specific/specific.ts')
    sets.push(['the generated mistakes', loadSpecific(count).map(({sample}) => sample)])
  } else if (set === 'written') {
    const {partsOfWritten} = await import('./written/score.ts')
    const {all} = partsOfWritten()
    sets.push(['the written cases with full agreement', all.fullAgreement], ['all written cases over their agreed code points', all.agreedCodePoints])
  }
  if (sets.length === 0) throw new Error('usage: bun lab/recovery-lr/held-back/search-per-sample.ts --set validation|specific|written [--count <samples>] [--width 64] [--without-end-early]')
  for (const [name, samples] of sets) {
    const {right, ofLearn, ofThisFile} = await bestOfBothSearches(samples, layout, width)
    const scored = samples.reduce((sum, sample) => sum + sample.scored, 0)
    const row = (title: string, rightPerSample: ArrayLike<number>): string => {
      let allRight = 0, whole = 0
      samples.forEach((sample, index) => {
        allRight += rightPerSample[index]!
        if (rightPerSample[index] === sample.scored) whole++
      })
      return `  ${title}: all three ${(100 * allRight / scored).toFixed(2)}, whole ${(100 * whole / samples.length).toFixed(2)}`
    }
    const everyTokenRight = ofThisFile.filter(best => best.rightInTokens === best.scoredInTokens).length
    let learnAhead = 0, thisFileAhead = 0
    samples.forEach((_, index) => {
      if (ofLearn[index]! > ofThisFile[index]!.right) learnAhead++
      else if (ofThisFile[index]!.right > ofLearn[index]!) thisFileAhead++
    })
    console.log(`${name}: ${samples.length} samples with ${scored} scored code points, ${width} runs kept${layout.endEarly ? '' : ', without "end an item early"'}.`)
    console.log(row('the search of learn/search/per-sample.ts', ofLearn))
    console.log(`${row('the search of this file', ofThisFile.map(best => best.right))}, every token right ${(100 * everyTokenRight / samples.length).toFixed(2)}`)
    console.log(row('the better of the two per sample, which is row 13', right))
    console.log(`  The search of learn/ has more right in ${learnAhead} samples, and the search of this file in ${thisFileAhead}.`)
  }
}
