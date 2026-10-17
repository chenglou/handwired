// One rule of recovery that takes no training, as a row to read trained tables against: after an error, the parser as
// it is starts anew at the next line. Up to the line feed that ends the line of the error, every code point is shown
// as the parser as it is shows it. The code point after that line feed is read as the first code point of a text: the
// tokenizer is between tokens, the grammar is at the start of a line, and no container is open, so the depth is 0.
// From there the parser as it is goes on until its next error, where the same holds again. E.g. in
//
//   port: 80
//   [tls]
//   on = true
//
// the colon is an error. After it the parser as it is counts the `[` of `[tls]` as the start of an array, so it shows
// `tls` as the start of a literal and a key, at depth 1. The rule shows `tls` as the name of a header, at depth 0.
//
// Why the row is here: the JSON experiment had 35 hand-written recovery rules to compare its trained tables with. The
// TOML track has no such rules, and today's TOML tables, unlike the JSON ones, go on after an error and show tokens by
// their kind. Most of TOML is one entry or one header per line, so this one rule gets most of what a recovery can get:
// on the validation split of the standard set, 5,382 samples, it raises the parser as it is from 64.14% of the scored
// code points and 12.02% of whole samples to 91.45% and 36.03%. Trained tables are therefore read by what they add to
// this row, not by what they add to the parser as it is.
//
// The rule is no setting of the tables: a cell can lower the depth by one level, and the rule sets it to 0 from any
// depth. It reads today's tables alone, so its row is the same before and after any training.
//
// What the rule cannot do, by its definition: a value on several lines, e.g. an array with one item per line, is cut
// at the line of its error, and its later lines are read as lines of a document, at depth 0.
//
// Run from the repo root:
//   bun lab/recovery-toml/learn/restart-at-next-line.ts [--split validation] [--from 0] [--to 60000] [--seed <the dataset's>] [--scratch <folder>]
// It prints every row of the score for the parser as it is and for the rule. --split takes train, validation or both
// with a comma.
import {type Samples, cacheFolderOf, loadSamples, splitsOfOption, standardRange} from './data.ts'
import {optionOf, refuseUnknownOptions} from './options.ts'
import {type RecoveryTrace, capacity, createTrace, runRecoveryParserInto} from './recovery-parser.ts'
import {type RecoveryTables, asIsTables} from './recovery-tables.ts'
import {type Score, type ScoreOptions, describeScore, scoreLegend, scoreTables, scoreWith, sharesOf} from './score.ts'

const lineFeed = 0x0a

// The run of the parser as it is on the rest of a text, from which the rule copies what it shows.
const restTrace = createTrace()
let todaysTables: RecoveryTables | undefined

// Writes what the rule shows for the code points codePoints[start] to codePoints[start + length - 1], at most 512,
// into the trace's displayKind, depthAfter and containerAfter. No other field of the trace is written: the rule runs
// the parser as it is once per error, on the rest of the text from the line after the error, and has no single run.
export function runRestartAtNextLineInto(trace: RecoveryTrace, codePoints: ArrayLike<number>, start: number, length: number) {
  if (length > capacity) throw new Error(`runRestartAtNextLineInto takes at most ${capacity} code points, and got ${length}`)
  todaysTables ??= asIsTables()
  let from = 0
  while (from < length) {
    const restLength = length - from
    // Only the code points run, so an error at the end of the text, e.g. a string that is not closed, is not found:
    // nothing comes after it.
    runRecoveryParserInto(restTrace, codePoints, start + from, restLength, false, todaysTables, restLength)
    let end = restLength
    if (restTrace.firstErrorPosition !== -1) {
      end = restTrace.firstErrorPosition
      while (end < restLength && codePoints[start + from + end] !== lineFeed) end++
      // The line feed itself still belongs to the line of the error.
      end = Math.min(end + 1, restLength)
    }
    for (let position = 0; position < end; position++) {
      trace.displayKind[from + position] = restTrace.displayKind[position]!
      trace.depthAfter[from + position] = restTrace.depthAfter[position]!
      trace.containerAfter[from + position] = restTrace.containerAfter[position]!
    }
    from += end
  }
}

// What the rule shows for a text of at most 512 code points: per code point the display kind, the depth after it and
// the container after it.
export function runRestartAtNextLine(codePoints: ArrayLike<number>): Pick<RecoveryTrace, 'displayKind' | 'depthAfter' | 'containerAfter'> {
  const trace = createTrace()
  runRestartAtNextLineInto(trace, codePoints, 0, codePoints.length)
  return trace
}

// The score of the rule on samples, with the rows of scoreTables.
export function scoreRestartAtNextLine(samples: Samples, options: ScoreOptions = {}): Score {
  return scoreWith(samples, options, (place, trace) => runRestartAtNextLineInto(trace, samples.codePoints, samples.start[place]!, samples.start[place + 1]! - samples.start[place]!))
}

if (import.meta.main) {
  refuseUnknownOptions('restart-at-next-line.ts', ['--split', '--from', '--to', '--seed', '--scratch'])
  const splits = splitsOfOption('restart-at-next-line.ts')
  const range = standardRange()
  const seed = Number(optionOf('--seed') ?? range.seed)
  const from = Number(optionOf('--from') ?? range.from)
  const to = Number(optionOf('--to') ?? range.to)
  const samples = loadSamples(seed, from, to, cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH']))
  const asIs = scoreTables(asIsTables(), samples, {splits})
  const rule = scoreRestartAtNextLine(samples, {splits})
  const percent = (share: number) => (100 * share).toFixed(2)
  const summary = (name: string, score: Score) => `${name}: all three ${percent(sharesOf(score.rows[0]!).allThree)}, whole ${percent(sharesOf(score.rows[0]!).whole)}`
  console.log(`Dataset ${samples.datasetKey}, seed ${seed}, the samples with the indexes ${from} to ${to - 1}, split${splits.length === 1 ? '' : 's'} ${splits.join(', ')}: ${asIs.rows[0]!.samples} broken samples with ${asIs.rows[0]!.codePoints} scored code points.`)
  console.log(summary('The parser as it is', asIs))
  console.log(summary('Anew at the next line after an error', rule))
  for (const line of scoreLegend) console.log(line)
  console.log('\nThe parser as it is')
  console.log(describeScore(asIs))
  console.log('\nAnew at the next line after an error')
  console.log(describeScore(rule))
}
