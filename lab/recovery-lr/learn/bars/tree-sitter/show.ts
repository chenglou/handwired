// Shows what the bar "tree-sitter" does with a broken text, beside the wanted labels: the five examples of
// ../repair/examples.ts, or validation samples. Under each, tree-sitter's tree as tree-sitter prints it.
//
//   bun lab/recovery-lr/learn/bars/tree-sitter/show.ts [--validation <first sample>] [--count <samples>]
import {defaultSeed, loadSamples} from '../../../dataset.ts'
import {numberOf, optionOf, refuseUnknownOptions} from '../../options.ts'
import {exampleSamples} from '../repair/examples.ts'
import {shownSample} from '../repair/show.ts'
import {outputsOfTreeSitter} from './tree-sitter.ts'
import {printedTreesOf} from './trees.ts'

refuseUnknownOptions('show.ts', ['--validation', '--count'])
const first = optionOf('--validation')
const samples = first === undefined ? exampleSamples() : loadSamples('validation', defaultSeed, Number(first) + numberOf('--count', 5)).slice(Number(first)).map(sample => ({name: `validation sample ${sample.id}: ${sample.edits.join(', ')}`, sample}))
const outputs = outputsOfTreeSitter(samples.map(({sample}) => sample))
const printed = printedTreesOf(samples.map(({sample}) => sample.codePoints))
for (const [index, {name, sample}] of samples.entries()) {
  console.log(`--- ${name}`)
  console.log(`meant: ${JSON.stringify(sample.original)}`)
  console.log(shownSample(sample, outputs[index]!))
  console.log(printed[index])
  console.log('')
}
