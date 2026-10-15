// How often saved tables are in the intended state, with and without the mark codePointCanFollow.
//
// The mark says that a parser of the broken text can be in the intended state after a kept code point, see
// canFollowOf in intended.ts. Its first rule is exact: where frozen cells decide the state and give another one, no
// tables reach the intended state. Its other rules are assumptions, e.g. after a stretch of added code points the
// walk does not know the state and leaves the mark off, and tables can still be in the intended state there. So
// "without the mark" does not mean "out of reach". This script counts, for today's tables and for saved tables, at
// how many kept code points from the first damage on the exact parser is in the intended state after the code point:
// the tokenizer state, the event, the grammar state, the depth and the container, all five.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/intended-reached.ts [--split train] <name>=<tables.json> ...
// --split is train or validation.
import {codePointCanFollow, codePointKept, loadStandardSamples, optionOf, refuseUnknownOptions, splitNames} from './data.ts'
import {createTrace} from './recovery-parser.ts'
import {type RecoveryTables, asIsTables, loadTablesForReport} from './recovery-tables.ts'
import {runOnSample} from './score.ts'

refuseUnknownOptions('intended-reached.ts', ['--split'])
const split = optionOf('--split') ?? 'train'
if (split !== 'train' && split !== 'validation') throw new Error(`--split takes train or validation, and got ${split}`)
const samples = loadStandardSamples()
const named = process.argv.slice(2).filter(argument => !argument.startsWith('--') && argument.includes('=')).map(argument => ({name: argument.slice(0, argument.indexOf('=')), tables: loadTablesForReport(argument.slice(argument.indexOf('=') + 1)).tables}))
const trace = createTrace()

function reachedBy(tables: RecoveryTables) {
  const tally = {marked: 0, markedReached: 0, unmarked: 0, unmarkedReached: 0}
  for (let place = 0; place < samples.sampleCount; place++) {
    const firstDamage = samples.firstDamage[place]!
    if (splitNames[samples.split[place]!] !== split || firstDamage === -1) continue
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    runOnSample(trace, samples, place, tables)
    for (let position = firstDamage; position < length; position++) {
      const at = start + position
      const flags = samples.flags[at]!
      if ((flags & codePointKept) === 0) continue
      const reached = trace.lexerStateAfter[position] === samples.intendedLexerAfter[at] && trace.event[position] === samples.intendedEvent[at] && trace.grammarAfter[position] === samples.intendedGrammarAfter[at]
        && trace.depthAfter[position] === samples.intendedDepthAfter[at] && trace.containerAfter[position] === samples.intendedContainerAfter[at]
      if ((flags & codePointCanFollow) !== 0) {
        tally.marked++
        if (reached) tally.markedReached++
      } else {
        tally.unmarked++
        if (reached) tally.unmarkedReached++
      }
    }
  }
  return tally
}

const percent = (part: number, whole: number) => `${(100 * part / whole).toFixed(1)}%`
console.log(`Dataset ${samples.datasetKey}, the ${split} split: kept code points from the first damage on, and at how many the exact parser is in the intended state after the code point.`)
console.log('')
console.log('| tables | code points with the mark | in the intended state | code points without the mark | in the intended state |')
console.log('| --- | --- | --- | --- | --- |')
for (const {name, tables} of [{name: 'the parser as it is', tables: asIsTables()}, ...named]) {
  const tally = reachedBy(tables)
  console.log(`| ${name} | ${tally.marked} | ${tally.markedReached} (${percent(tally.markedReached, tally.marked)}) | ${tally.unmarked} | ${tally.unmarkedReached} (${percent(tally.unmarkedReached, tally.unmarked)}) |`)
}
