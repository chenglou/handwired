// The scores of the hand-written rules on the train and the validation samples, next to the parser as it is, with
// the display entries set by the count on the train samples, as for the trained rows.
//
//   bun lab/recovery-lr/learn/bars/rules/report.ts [--train <samples>] [--validation <samples>]
//     [--added]          what each rule adds on top of the rules above it
//     [--without-each]   the scores without each rule
//     [--cells <n>]      the n most read open cells with what they hold, in words
//     [--save]           writes the tables next to this file: the rules with the count on all 40,000 train samples
//     [--with-left-out]  with the rules that the bar leaves out, see rules.ts
// Without options: one row for the train samples and one for the validation samples, and one for the author's own
// broken programs of broken.ts.
import {join} from 'node:path'
import {type PackedSamples, loadPacked} from '../../data.ts'
import {flagOf, numberOf, refuseUnknownOptions, standardTrainCount, standardValidationCount} from '../../options.ts'
import {type RecoveryTables, saveTables} from '../../recovery-tables.ts'
import {reportOf} from '../../report.ts'
import {alignmentOfTexts, makeSample} from '../../../sample.ts'
import {type Score, scoreHeader, scoreRow, scoreTables, scoreTablesByExactParser, sharesOf} from '../../score.ts'
import {displayEntriesByCount} from '../../search/count.ts'
import {ownBrokenPrograms} from './broken.ts'
import {type RuleOptions, layoutOfTheRecipe, rules, tablesOfRules} from './rules.ts'

// The tables of the rules with the display entries that the count on `train` gives.
export const tablesWithCount = (train: PackedSamples, options: RuleOptions = {}): RecoveryTables => displayEntriesByCount(tablesOfRules(options).tables, train).tables

// The saved tables of the bar.
export const savedTablesPath = join(import.meta.dir, 'tables.json')

// The author's own broken programs as samples. A pair that gives no sample, e.g. a text that is still valid, is
// left out.
export const ownSamples = () => ownBrokenPrograms.flatMap(({meant, broken}, index) => {
  const sample = makeSample({id: `own:${index}`, original: meant, broken, alignment: alignmentOfTexts(meant, broken)})
  return typeof sample === 'string' ? [] : [sample]
})

if (import.meta.main) {
  refuseUnknownOptions('report.ts', ['--train', '--validation', '--cells'], ['--added', '--without-each', '--save', '--with-left-out'])
  const withLeftOut = flagOf('--with-left-out')
  const trainCount = numberOf('--train', standardTrainCount), validationCount = numberOf('--validation', standardValidationCount)
  const layout = layoutOfTheRecipe()
  const train = loadPacked('train', trainCount, layout), validation = loadPacked('validation', validationCount, layout)
  const scoresOf = (options: RuleOptions = {}): {train: Score, validation: Score} => {
    const tables = tablesWithCount(train, {withLeftOut, ...options})
    return {train: scoreTables(tables, train).score, validation: scoreTables(tables, validation).score}
  }
  const tables = tablesWithCount(train, {withLeftOut})
  const all = scoresOf()
  const own = ownSamples()
  console.log(`The hand-written rules${withLeftOut ? ', with the rules that the bar leaves out,' : ''} on ${trainCount} train and ${validationCount} validation samples, with the display entries by the count on the train samples:`)
  console.log(scoreHeader)
  console.log(scoreRow('the rules, train', all.train))
  console.log(scoreRow('the rules, validation', all.validation))
  console.log(scoreRow(`the rules, the author's ${own.length} own broken programs`, scoreTablesByExactParser(tables, own)))
  console.log(scoreRow('the parser as it is, validation', scoreTables(layout, validation).score))
  console.log(scoreRow('the rules with every dropped token shown as an error, validation', scoreTables(tablesOfRules({withLeftOut}).tables, validation).score))

  const short = (score: Score): string => {
    const shares = sharesOf(score)
    return `${shares.allThree.toFixed(2)} / ${shares.whole.toFixed(2)} / ${shares.stack.toFixed(2)}`
  }
  if (flagOf('--added')) {
    console.log('\nWhat each rule adds on top of the rules above it, as all three / whole / stack, train and validation:')
    console.log('| rule | train | validation | added to all three: train, validation |\n| --- | --- | --- | --- |')
    let before = scoresOf({only: () => false})
    console.log(`| no rule: the parser as it is, with the count | ${short(before.train)} | ${short(before.validation)} | |`)
    for (const [index, rule] of rules.entries()) {
      const now = scoresOf({only: (_, other) => other <= index})
      console.log(`| ${rule.name} | ${short(now.train)} | ${short(now.validation)} | ${(sharesOf(now.train).allThree - sharesOf(before.train).allThree).toFixed(2)}, ${(sharesOf(now.validation).allThree - sharesOf(before.validation).allThree).toFixed(2)} |`)
      before = now
    }
  }
  if (flagOf('--without-each')) {
    console.log('\nThe scores without each rule, as all three / whole / stack, train and validation:')
    console.log('| rule left out | train | validation | lost in all three: train, validation |\n| --- | --- | --- | --- |')
    for (const [index, rule] of rules.entries()) {
      const without = scoresOf({only: (_, other) => other !== index})
      console.log(`| ${rule.name} | ${short(without.train)} | ${short(without.validation)} | ${(sharesOf(all.train).allThree - sharesOf(without.train).allThree).toFixed(2)}, ${(sharesOf(all.validation).allThree - sharesOf(without.validation).allThree).toFixed(2)} |`)
    }
  }
  const cells = numberOf('--cells', 0)
  if (cells > 0) {
    console.log('')
    for (const line of reportOf(tables, validation, 'validation', cells)) console.log(line)
  }
  if (flagOf('--save')) {
    if (trainCount !== standardTrainCount) throw new Error(`--save needs the count on all ${standardTrainCount} train samples`)
    if (withLeftOut) throw new Error('--save writes the bar: without --with-left-out')
    saveTables(savedTablesPath, tables, `the hand-written rules of lab/recovery-lr/learn/bars/rules/rules.ts, with the display entries by the count on ${trainCount} train samples`)
    console.log(`\nSaved ${savedTablesPath}.`)
  }
}
