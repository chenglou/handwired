// HELD BACK. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read
// this file or its output, see ../README.md.
//
// What the list of choices can express on this set, kind by kind: a search per sample, in which a cell may hold
// another choice at every read. No table is trained or read: the search starts from the parser as it is, and
// follows the rules of a run of ../../learn/recovery-parser.ts (frozen cells are followed, a token gets 16 steps
// and is then skipped, a frozen display entry shows what it shows).
//
// The search is bestOfSample of ../search-per-sample.ts, which also makes row 13 of the final table for any list
// of samples. It is a search of its own and not the one of ../../learn/search/per-sample.ts, for one reason. Both keep a
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
import {packSamples} from '../../learn/data.ts'
import {baseTables, withoutEndEarly} from '../../learn/recovery-tables.ts'
import {searchPerSample} from '../../learn/search/per-sample.ts'
import {scoredOutOfReach} from '../../stats.ts'
import {bestOfSample} from '../search-per-sample.ts'
import {kindNames} from './kinds.ts'
import {specificSampleAt, specificSampleCount, specificSeed} from './specific.ts'

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
