// HELD BACK. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read
// this file or its output, see ../README.md.
//
// What the list of choices can express on this set, kind by kind: a search per sample, in which a cell may hold
// another choice at every read. No table is trained or read: the search starts from the parser as it is, and
// follows the rules of a run of ../../learn/recovery-parser.ts (frozen cells are followed, a token gets 16 steps
// and is then skipped, a frozen display entry shows what it shows).
//
// It is a search of its own and not the one of ../../learn/search/per-sample.ts, for one reason. Both keep a
// number of runs after every token, the ones with the most code points right. Where runs are level, the search
// of learn/ keeps the ones with the shortest stack. In this set the first error's token is often an added one,
// which has no label, so every run is level after it, and the runs with the shortest stacks are the ones that
// threw the most away: on `if (c) { a } else { b }` it loses the run that reads the `{` as `then`. This search
// keeps, among level runs, the ones that changed the least: the fewest steps at open cells that are not the
// parser's own default reduction. Among those it keeps two sets, the runs with the fewest steps and the runs with
// the shortest stacks. Its numbers are still what the list can at least do, and no proof of what it cannot do:
// with more runs kept it finds more.
//
// Per kind, over the samples with that kind alone:
// - "out of reach": the samples with a scored label that no parser of the experiment can give, because one token
//   of the broken text, with the white space after it, holds code points with two labels, see scoredOutOfReach
//   in ../../stats.ts.
// - "all three": the share of the scored code points that the best run has right.
// - "whole": the samples in which the best run has every scored code point right.
// - "whole but for white space": the samples in which the best run has every scored code point of every token
//   right, and is wrong at white space or comments only.
//
// Run from the repo root:
//   bun lab/recovery-lr/held-back/specific/reach.ts [--width 64] [--count 6000] [--forms] [--without-end-early] [--search-of-learn]
// The output holds counts per kind and form, and no text of a sample. It takes about 4 minutes on 4 threads.
// With --search-of-learn, the search of learn/ runs in its place, for the comparison of the two.
import {displayKind, displayKindCount} from '../../labels.ts'
import {type PackedSamples, packSamples, packedComment} from '../../learn/data.ts'
import {containerOfStack, depthOfStack} from '../../learn/recovery-parser.ts'
import {type RecoveryTables, applyChoice, baseTables, choiceStop, choicesOf, maximumStepsPerToken, tokenSkipped, tokenStays, tokenTaken, withoutEndEarly} from '../../learn/recovery-tables.ts'
import {searchPerSample} from '../../learn/search/per-sample.ts'
import type {Sample} from '../../sample.ts'
import {scoredOutOfReach} from '../../stats.ts'
import {kindNames} from './kinds.ts'
import {specificSampleAt, specificSampleCount, specificSeed} from './specific.ts'

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

type Request = {share: number, shares: number, count: number, width: number, withoutEndEarly: boolean}
type Reply = {right: Int32Array, rightInTokens: Int32Array, scoredInTokens: Int32Array}

if (!Bun.isMainThread) {
  // A worker thread: the samples whose index is `share` modulo `shares`.
  self.onmessage = (event: MessageEvent<Request>) => {
    const {share, shares, count, width} = event.data
    const layout = event.data.withoutEndEarly ? withoutEndEarly(baseTables()) : baseTables()
    const size = Math.ceil((count - share) / shares)
    const reply: Reply = {right: new Int32Array(size), rightInTokens: new Int32Array(size), scoredInTokens: new Int32Array(size)}
    for (let index = share, place = 0; index < count; index += shares, place++) {
      const best = bestOfSample(specificSampleAt(specificSeed, index).sample, layout, width)
      reply.right[place] = best.right
      reply.rightInTokens[place] = best.rightInTokens
      reply.scoredInTokens[place] = best.scoredInTokens
    }
    postMessage(reply)
  }
} else if (import.meta.main) {
  const options = process.argv.slice(2)
  const optionOf = (name: string): string | undefined => options.includes(name) ? options[options.indexOf(name) + 1] : undefined
  const width = Number(optionOf('--width') ?? 64), count = Number(optionOf('--count') ?? specificSampleCount)
  const byForm = options.includes('--forms'), leaveOutEndEarly = options.includes('--without-end-early'), searchOfLearn = options.includes('--search-of-learn')
  const shares = 4
  let replies: Reply[]
  if (searchOfLearn) {
    // The search of ../../learn/search/per-sample.ts on the same samples, for the comparison in README.md. It
    // does not say which code points are wrong, so the column "whole but for white space" is empty.
    const layout = leaveOutEndEarly ? withoutEndEarly(baseTables()) : baseTables()
    const right = await searchPerSample(packSamples(Array.from({length: count}, (_, index) => specificSampleAt(specificSeed, index).sample), layout), layout, width)
    replies = Array.from({length: shares}, (_, share) => {
      const ofShare = right.filter((_, index) => index % shares === share)
      return {right: ofShare, rightInTokens: new Int32Array(ofShare.length).fill(-1), scoredInTokens: new Int32Array(ofShare.length)}
    })
  } else {
    const workers = Array.from({length: shares}, () => new Worker(import.meta.url))
    replies = await Promise.all(workers.map((worker, share) => new Promise<Reply>((resolve, reject) => {
      worker.onmessage = event => resolve(event.data as Reply)
      worker.onerror = event => reject(new Error(`worker ${share}: ${event.message}`))
      worker.postMessage({share, shares, count, width, withoutEndEarly: leaveOutEndEarly} satisfies Request)
    })))
    for (const worker of workers) worker.terminate()
  }

  type Row = {samples: number, scored: number, right: number, whole: number, outOfReach: number, wholeInTokens: number}
  const rows = new Map<string, Row>()
  for (let index = 0; index < count; index++) {
    const {sample, kinds, forms} = specificSampleAt(specificSeed, index)
    const reply = replies[index % shares]!, place = Math.floor(index / shares)
    const names = [kinds.length === 1 ? 'every sample with one kind' : 'every sample with two kinds']
    if (kinds.length === 1) names.push(kinds[0]!, ...(byForm ? [`${kinds[0]}: ${forms[0]}`] : []))
    for (const name of names) {
      const row = rows.get(name) ?? {samples: 0, scored: 0, right: 0, whole: 0, outOfReach: 0, wholeInTokens: 0}
      rows.set(name, row)
      row.samples++
      row.scored += sample.scored
      row.right += reply.right[place]!
      if (reply.right[place] === sample.scored) row.whole++
      if (scoredOutOfReach(sample) > 0) row.outOfReach++
      if (reply.rightInTokens[place] === reply.scoredInTokens[place]) row.wholeInTokens++
    }
  }
  const percent = (part: number, whole: number): string => (100 * part / Math.max(1, whole)).toFixed(1).padStart(5)
  console.log(`${count} samples, ${width} runs kept${leaveOutEndEarly ? ', without "end an item early"' : ''}${searchOfLearn ? ', by the search of learn/search/per-sample.ts' : ''}. Per kind, over the samples with that kind alone:`)
  console.log('samples  out of reach  all three  whole  whole but for white space  kind')
  const order = ['every sample with one kind', 'every sample with two kinds', ...kindNames]
  const placeOf = (name: string): number => order.indexOf(name.split(':')[0]!)
  for (const [name, row] of [...rows].sort((left, right) => placeOf(left[0]) - placeOf(right[0]) || left[0].localeCompare(right[0]))) {
    console.log(`${String(row.samples).padStart(7)}  ${percent(row.outOfReach, row.samples)}         ${percent(row.right, row.scored)}      ${percent(row.whole, row.samples)}  ${searchOfLearn ? '    -' : percent(row.wholeInTokens, row.samples)}                      ${name}`)
  }
}
