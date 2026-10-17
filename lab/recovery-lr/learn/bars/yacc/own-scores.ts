// The two hand-made bars on the author's own broken programs, see own-programs.ts: one row per bar for all of
// them and for the written pairs, and one row per mistake.
//
//   bun lab/recovery-lr/learn/bars/yacc/own-scores.ts [--per-mistake <samples>]
import type {Sample} from '../../../sample.ts'
import {numberOf, refuseUnknownOptions} from '../../options.ts'
import {type ParserOutput, scoreOutputs, sharesOf} from '../../score.ts'
import {panicModeByHand} from '../panic/panic.ts'
import {yaccErrorProductions} from './bar.ts'
import {mistakeNames, ownSamples, writtenSamples} from './own-programs.ts'

refuseUnknownOptions('own-scores.ts', ['--per-mistake'])
const own = ownSamples(numberOf('--per-mistake', 100)), written = writtenSamples()
const bars: [name: string, parse: (sample: Sample) => ParserOutput][] = [['yacc error productions', yaccErrorProductions], ['panic mode with a hand-written list', panicModeByHand]]
const cells = (samples: readonly Sample[], parse: (sample: Sample) => ParserOutput): string => {
  const shares = sharesOf(scoreOutputs(samples, parse))
  return `${shares.allThree.toFixed(1)} | ${shares.whole.toFixed(1)} | ${shares.stack.toFixed(1)}`
}
console.log(`| broken programs | samples | ${bars.map(([name]) => `${name}: all three | whole | stack`).join(' | ')} |`)
console.log(`| --- | --- | ${bars.map(() => '--- | --- | ---').join(' | ')} |`)
const row = (title: string, samples: readonly Sample[]) => console.log(`| ${title} | ${samples.length} | ${bars.map(([, parse]) => cells(samples, parse)).join(' | ')} |`)
row('every mistake of the list', own)
row('the written pairs', written)
for (const mistake of mistakeNames) row(mistake, own.filter(sample => sample.edits[0] === mistake))
