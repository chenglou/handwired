// A search per sample, which shows what the list of choices can express: every open cell may hold another choice
// at every read, and an open display entry another kind at every read, and of the runs that a beam keeps, the one
// with the most scored code points right is taken. Nothing is learned and no table comes out of it.
//
// A table has one choice per cell for all samples and one kind per display entry, so a table scores below what
// this search finds, as long as the beam does not lose the table's own run. The beam keeps the `width` runs with
// the most code points right after every token (64 unless told otherwise), so its number is what the list can at
// least do per sample, and no proof of what it cannot do. A wider beam finds more: on 400 validation samples of
// the stand-in generator, 94.4% of all three with 64 runs and 95.7% with 256, where one output per token allows
// 97.5%. And a beam of 64 loses the run of searched tables in about 7 of 100 samples, so with `alsoRunsOf` the
// search takes the better of its own run and the run of given tables, sample by sample.
//
// The rules of a run are the exact parser's: frozen cells are followed, a token gets 16 steps and is then skipped,
// the stack has its limit, and a frozen display entry shows what it shows. `stop` is not tried: in the state
// `stopped` a token can only be skipped or the state left, which skip and pop do without it.
//
//   bun lab/recovery-lr/learn/search/per-sample.ts [--split train|validation] [--count <samples>] [--width <runs kept>]
//     [--tables <file.json>] [--without-end-early]
// With --tables, the tables' own score on the same samples stands next to the search's, and their layout is used.
import {displayKind, displayKindCount} from '../../labels.ts'
import {type PackedSamples, loadPacked, messageOf, packedComment, refuseOtherTerminals} from '../data.ts'
import {flagOf, numberOf, optionOf, refuseUnknownOptions} from '../options.ts'
import {containerOfStack, depthOfStack} from '../recovery-parser.ts'
import {type RecoveryTables, applyChoice, baseTables, choiceStop, choicesOf, loadTablesForReport, maximumStepsPerToken, tokenSkipped, tokenStays, tokenTaken, withoutEndEarly} from '../recovery-tables.ts'
import {runSample, scorePack, scoreTables, sharesOf} from '../score.ts'

export const defaultWidth = 64

// One run that the beam holds: its stack, its code points with all three right so far, and its steps for the
// token at hand.
type Run = {stack: number[], right: number, steps: number}

const perKind = new Int32Array(displayKindCount)
// The code points of a token that have all three right when the token is shown with the kind, or with the best
// kind for -1, and with the depth and the container of the stack.
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

// The most scored code points of one sample that some run of the beam has right. `tables` give the layout: the
// lists of the cells, the frozen cells and the frozen display entries. What their open cells hold is not read.
export function bestOfSample(samples: PackedSamples, sample: number, tables: RecoveryTables, width: number = defaultWidth): number {
  const {terminalCount} = tables
  const first = samples.tokenStart[sample]!, end = samples.tokenStart[sample + 1]! - 1
  let kept: Run[] = [{stack: Array.from(samples.stackState.subarray(samples.stackStart[sample], samples.stackStart[sample + 1])), right: 0, steps: 0}]
  for (let at = first; at < end; at++) {
    const terminal = samples.terminal[at]!
    if (terminal < 0) {
      for (const run of kept) run.right += rightOfToken(samples, at, run.stack, terminal === packedComment ? displayKind.comment : displayKind.whitespace)
      continue
    }
    // The runs that have taken or skipped the token, the best one per stack.
    const done = new Map<string, Run>()
    const finish = (run: Run, entry: number) => {
      run.right += rightOfToken(samples, at, run.stack, tables.displayOpen[entry] === 1 ? -1 : tables.display[entry]!)
      const key = run.stack.join()
      const other = done.get(key)
      if (other === undefined || other.right < run.right) done.set(key, run)
    }
    // The most code points right with which a stack was reached while the token was read: a run that reaches the
    // stack again with no more is dropped.
    const reached = new Map<string, number>()
    const goOn = (run: Run, next: Run[]) => {
      const key = run.stack.join()
      if ((reached.get(key) ?? -1) >= run.right) return
      reached.set(key, run.right)
      next.push(run)
    }
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
        run.steps++
        const cell = state * terminalCount + terminal
        const choices = tables.open[cell] === 1 ? choicesOf(tables, cell) : [tables.choice[cell]!]
        for (const choice of choices) {
          if (choice === choiceStop) continue
          const child: Run = choices.length === 1 ? run : {stack: run.stack.slice(), right: run.right, steps: run.steps}
          const became = applyChoice(child.stack, choice)
          if (became === tokenStays) goOn(child, next)
          // A skipped token is shown by the entry of the state on top, and a taken one by the entry of its new state.
          else if (became === tokenSkipped || became === tokenTaken) finish(child, child.stack.at(-1)! * terminalCount + terminal)
          else throw new Error(`the cell ${cell} holds ${choice}, which the search per sample does not know`)
        }
      }
      // Within a token the runs that are not done differ only in what they had right before it.
      live = next.length > width * 4 ? next.sort((left, right) => right.right - left.right || left.stack.length - right.stack.length).slice(0, width * 4) : next
    }
    kept = [...done.values()].sort((left, right) => right.right - left.right || left.stack.length - right.stack.length).slice(0, width)
  }
  let most = 0
  for (const run of kept) if (run.right > most) most = run.right
  return most
}

export type PerSampleRequest = {samples: ReturnType<typeof messageOf>, tables: RecoveryTables, share: number, shares: number, width: number}
export type PerSampleReply = {right: Int32Array}

// The search for every sample, on 4 worker threads: per sample, the most code points right. With `alsoRunsOf`,
// tables of the same layout, a sample has at least what those tables have right.
export async function searchPerSample(samples: PackedSamples, layout: RecoveryTables, width: number = defaultWidth, alsoRunsOf?: RecoveryTables, workerCount = 4): Promise<Int32Array> {
  refuseOtherTerminals(samples, layout)
  const workers = Array.from({length: workerCount}, () => new Worker(new URL('./per-sample-worker.ts', import.meta.url).href))
  try {
    const replies = await Promise.all(workers.map((worker, share) => new Promise<PerSampleReply>((resolve, reject) => {
      worker.onmessage = event => resolve(event.data as PerSampleReply)
      worker.onerror = event => reject(new Error(`worker ${share}: ${event.message}`))
      worker.postMessage({samples: messageOf(samples), tables: layout, share, shares: workerCount, width} satisfies PerSampleRequest)
    })))
    const right = new Int32Array(samples.sampleCount)
    replies.forEach((reply, share) => reply.right.forEach((count, index) => { right[share + index * workerCount] = count }))
    if (alsoRunsOf !== undefined) for (let sample = 0; sample < samples.sampleCount; sample++) right[sample] = Math.max(right[sample]!, Math.floor(runSample(samples, sample, alsoRunsOf) / scorePack))
    return right
  } finally {
    for (const worker of workers) worker.terminate()
  }
}

// The two main numbers of the search per sample.
export function sharesOfPerSample(samples: PackedSamples, right: Int32Array): {allThree: number, whole: number} {
  let allRight = 0, whole = 0
  for (let sample = 0; sample < samples.sampleCount; sample++) {
    allRight += right[sample]!
    if (right[sample] === samples.scored[sample]) whole++
  }
  return {allThree: 100 * allRight / samples.scoredCodePoints, whole: 100 * whole / samples.sampleCount}
}

if (import.meta.main) {
  refuseUnknownOptions('per-sample.ts', ['--split', '--count', '--width', '--tables'], ['--without-end-early'])
  const split = optionOf('--split') ?? 'validation'
  if (split !== 'train' && split !== 'validation') throw new Error(`--split is train or validation, and got ${split}`)
  const tablesFile = optionOf('--tables')
  if (tablesFile !== undefined && flagOf('--without-end-early')) throw new Error('--without-end-early makes the layout, and --tables names it')
  const layout = tablesFile !== undefined ? loadTablesForReport(tablesFile).tables : flagOf('--without-end-early') ? withoutEndEarly(baseTables()) : baseTables()
  const width = numberOf('--width', defaultWidth)
  const samples = loadPacked(split, numberOf('--count', 600), layout)
  const started = performance.now()
  const best = await searchPerSample(samples, layout, width)
  const shares = sharesOfPerSample(samples, best)
  console.log(`${samples.sampleCount} ${split} samples, ${layout.endEarly ? 'with' : 'without'} "end an item early", a beam of ${width} runs: a search per sample has all three ${shares.allThree.toFixed(2)}, whole ${shares.whole.toFixed(2)}, in ${((performance.now() - started) / 1000).toFixed(0)} s.`)
  console.log(`One output per token allows ${(100 * samples.boundCodePoints / samples.scoredCodePoints).toFixed(2)}.`)
  if (tablesFile !== undefined) {
    const ofTables = sharesOf(scoreTables(layout, samples).score)
    let below = 0
    for (let sample = 0; sample < samples.sampleCount; sample++) {
      const right = Math.floor(runSample(samples, sample, layout) / scorePack)
      if (right > best[sample]!) {
        below++
        best[sample] = right
      }
    }
    const withTables = sharesOfPerSample(samples, best)
    console.log(`The tables of ${tablesFile} on the same samples: all three ${ofTables.allThree.toFixed(2)}, whole ${ofTables.whole.toFixed(2)}. The beam is below the tables in ${below} samples, and with the tables' own run for those: all three ${withTables.allThree.toFixed(2)}, whole ${withTables.whole.toFixed(2)}.`)
  }
}
