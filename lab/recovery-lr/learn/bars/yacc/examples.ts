// Five broken programs of the author with a bar's output beside the wanted labels, for the READMEs of the two
// hand-made bars: a missing `in`, a missing `)`, a missing `then`, a `)` too many and a missing `=`.
//
//   bun lab/recovery-lr/learn/bars/yacc/examples.ts yacc
//   bun lab/recovery-lr/learn/bars/yacc/examples.ts panic
import type {Sample} from '../../../sample.ts'
import type {ParserOutput} from '../../score.ts'
import {panicModeByHand} from '../panic/panic.ts'
import {yaccErrorProductions} from './bar.ts'
import {writtenSamples} from './own-programs.ts'
import {showOutput} from './show.ts'

// The places of the five in the written pairs of own-programs.ts.
const examplePairs = [0, 1, 2, 14, 16]
export const exampleSamples = (): Sample[] => {
  const written = writtenSamples()
  return examplePairs.map(pair => written[pair]!)
}
export const showExamples = (title: string, parse: (sample: Sample) => ParserOutput): string => exampleSamples().map(sample => showOutput(sample, parse(sample), title)).join('\n\n')

if (import.meta.main) {
  const bar = process.argv[2]
  if (bar !== 'yacc' && bar !== 'panic') throw new Error('usage: bun lab/recovery-lr/learn/bars/yacc/examples.ts yacc|panic')
  console.log(bar === 'yacc' ? showExamples('yacc error productions', yaccErrorProductions) : showExamples('panic mode with a hand-written list', panicModeByHand))
}
