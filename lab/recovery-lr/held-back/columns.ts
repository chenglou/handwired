// HELD BACK. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read
// this file or its output, see README.md.
//
// The columns of ../learn/columns.ts on the three sets of the final table: the validation samples, the generated
// mistakes and the written cases. Two reviews of the foundation asked for these columns next to "all three" and
// "whole", see FINAL-SCORING.md. This command prints them for the parser as it is, and says how many of the scored
// code points each column is about. Whoever runs the final scoring adds the other rows in `rows` below: a row is a
// name and a function that gives a parser's output for a sample.
//
// Run from the repo root: bun lab/recovery-lr/held-back/columns.ts
// It prints counts and no text of a sample.
import {defaultSeed, loadSamples} from '../dataset.ts'
import {columnsHeader, columnsOfOutputs, columnsRow, describeColumns, samplesAhead} from '../learn/columns.ts'
import {runRecoveryParserOnTokens} from '../learn/recovery-parser.ts'
import {baseTables} from '../learn/recovery-tables.ts'
import {type ParserOutput, outputOfRun} from '../learn/score.ts'
import type {Sample} from '../sample.ts'
import {loadSpecific} from './specific/specific.ts'
import {partsOfWritten} from './written/score.ts'

const base = baseTables()
const rows: [name: string, parse: (sample: Sample) => ParserOutput][] = [
  ['the parser as it is', sample => outputOfRun(runRecoveryParserOnTokens(sample.codePoints, sample.tokens, base))],
]

const written = partsOfWritten().all
const sets: [name: string, samples: Sample[]][] = [
  ['the 5,000 validation samples', loadSamples('validation', defaultSeed, 5000)],
  ['the generated mistakes', loadSpecific().map(({sample}) => sample)],
  ['the written cases with full agreement', written.fullAgreement],
  ['all written cases over their agreed code points', written.agreedCodePoints],
]
for (const [setName, samples] of sets) {
  console.log(`\n${setName}:`)
  console.log(columnsHeader)
  const rightOfRows: Int32Array[] = []
  let columnsOfLastRow = columnsOfOutputs([], rows[0]![1]).columns
  for (const [name, parse] of rows) {
    const {columns, rightPerSample} = columnsOfOutputs(samples, parse)
    console.log(columnsRow(name, columns))
    rightOfRows.push(rightPerSample)
    columnsOfLastRow = columns
  }
  console.log(describeColumns(columnsOfLastRow))
  // For each pair of rows: in how many samples each has more scored code points right.
  for (let left = 0; left < rows.length; left++) {
    for (let right = left + 1; right < rows.length; right++) {
      const ahead = samplesAhead(rightOfRows[left]!, rightOfRows[right]!)
      console.log(`${rows[left]![0]} has more right in ${ahead.leftAhead} samples, ${rows[right]![0]} in ${ahead.rightAhead}, and they are level in ${ahead.level}.`)
    }
  }
}
