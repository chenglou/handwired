// The bar "a table filled by hand-written rules" as a scoring runs it: one function from samples to what the
// scorer of ../../score.ts needs per sample.
//
//   import {rulesBar} from './bars/rules/bar.ts'
//   const score = scoreOutputs(samples, rulesBar())          // any list of samples of ../../../sample.ts
//
// The tables are the saved ones: tables.json holds the rules of rules.ts with the display entries that the count
// of ../../search/count.ts gives on the 40,000 train samples, as for the trained rows. check.ts makes them again
// and compares. They are tables of the experiment like any other, so the faster route works too:
//   const tables = tablesOfTheBar()
//   scoreTables(tables, packSamples(samples, tables))
//
//   bun lab/recovery-lr/learn/bars/rules/bar.ts     # the validation samples by both routes
import {defaultSeed, loadSamples} from '../../../dataset.ts'
import type {Sample} from '../../../sample.ts'
import {packSamples} from '../../data.ts'
import {standardValidationCount} from '../../options.ts'
import {runRecoveryParserOnTokens} from '../../recovery-parser.ts'
import {type RecoveryTables, loadTablesOfThisDataset} from '../../recovery-tables.ts'
import {type ParserOutput, outputOfRun, scoreHeader, scoreOutputs, scoreRow, scoreTables} from '../../score.ts'
import {savedTablesPath} from './report.ts'

// The saved tables of the bar. Throws when the file was saved with another version of the dataset: then the count
// has to be made again, with report.ts --save.
export const tablesOfTheBar = (): RecoveryTables => loadTablesOfThisDataset(savedTablesPath).tables

// The bar as a parser for scoreOutputs: for a sample, per token of its broken text the display kind, the depth,
// the container, the hash of the stack's symbols and whether the token was taken, then the reductions of the parse
// and the number of inserted tokens.
export function rulesBar(): (sample: Sample) => ParserOutput {
  const tables = tablesOfTheBar()
  return sample => outputOfRun(runRecoveryParserOnTokens(sample.codePoints, sample.tokens, tables))
}

if (import.meta.main) {
  const samples = loadSamples('validation', defaultSeed, standardValidationCount)
  console.log(`The bar on ${samples.length} validation samples, by the exact parser on whole texts and by the loop on packed samples:`)
  console.log(scoreHeader)
  const tables = tablesOfTheBar()
  console.log(scoreRow('rulesBar with scoreOutputs', scoreOutputs(samples, rulesBar())))
  console.log(scoreRow('scoreTables on packed samples', scoreTables(tables, packSamples(samples, tables)).score))
}
