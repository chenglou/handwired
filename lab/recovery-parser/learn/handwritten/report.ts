// The score of the hand-written recovery next to the parser as it is, with every breakdown, and what each rule is
// worth: the score without the rule.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/handwritten/report.ts [--split validation] [--without-each-rule] [--scratch <folder>] [--to 60000]
// --split takes train, validation or both with a comma. The test split is refused, see ../arms/README.md.
// --without-each-rule adds, per rule, the main number of the tables that leave the rule out. The cells of a rule that
// is left out hold today's choice, which for most grammar cells is the state `error`. Other rules give that state a
// meaning, so a text often recovers by accident, and the number understates what a grammar rule is worth.
import {cacheFolderOf, loadSamples, optionOf, refuseUnknownOptions, splitsOfOption, standardRange} from '../data.ts'
import {asIsTables} from '../recovery-tables.ts'
import {type ScoreRow, scoreTables, sharesOf} from '../score.ts'
import {handwrittenTables, rules} from './rules.ts'

const percent = (share: number) => Number.isNaN(share) ? '    -' : (100 * share).toFixed(1).padStart(5)

if (import.meta.main) {
  refuseUnknownOptions('handwritten/report.ts', ['--split', '--to', '--scratch', '--without-each-rule'])
  const splits = splitsOfOption('report.ts')
  const samples = loadSamples(standardRange.seed, standardRange.from, Number(optionOf('--to') ?? standardRange.to), cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH']))
  const asIs = scoreTables(asIsTables(), samples, {splits})
  const handwritten = scoreTables(handwrittenTables().tables, samples, {splits})
  const rowOfAsIs = new Map<string, ScoreRow>(asIs.rows.map(row => [row.name, row]))
  console.log(`Split${splits.length === 1 ? '' : 's'} ${splits.join(', ')}: ${handwritten.rows[0]!.samples} broken samples, ${handwritten.validSamples} valid ones left out.`)
  console.log('Percentages of the scored code points, i.e. the code points from the first error on whose label has a scored value. "as is" is the parser of today, "hand" the hand-written recovery.')
  console.log('all 3: every scored label right. whole: samples with something to recover in which every such code point is right. bound: the dataset\'s bound for the plain table parser.')
  console.log('')
  console.log(`${'samples'.padStart(7)} ${'nothing'.padStart(7)}  ${'all 3'.padStart(5)} ${'all 3'.padStart(5)}  ${'kind'.padStart(5)} ${'kind'.padStart(5)}  ${'depth'.padStart(5)} ${'depth'.padStart(5)}  ${'cont.'.padStart(5)} ${'cont.'.padStart(5)}  ${'whole'.padStart(5)} ${'whole'.padStart(5)}  ${'bound'.padStart(5)}`)
  console.log(`${''.padStart(7)} ${''.padStart(7)}  ${'as is'.padStart(5)} ${'hand'.padStart(5)}  ${'as is'.padStart(5)} ${'hand'.padStart(5)}  ${'as is'.padStart(5)} ${'hand'.padStart(5)}  ${'as is'.padStart(5)} ${'hand'.padStart(5)}  ${'as is'.padStart(5)} ${'hand'.padStart(5)}  ${'plain'.padStart(5)}  row`)
  for (const row of handwritten.rows) {
    const before = sharesOf(rowOfAsIs.get(row.name)!)
    const after = sharesOf(row)
    console.log(`${String(row.samples).padStart(7)} ${String(row.nothingToRecover).padStart(7)}  ${percent(before.allThree)} ${percent(after.allThree)}  ${percent(before.kind)} ${percent(after.kind)}  ${percent(before.depth)} ${percent(after.depth)}  ${percent(before.container)} ${percent(after.container)}  ${percent(before.whole)} ${percent(after.whole)}  ${percent(after.plainBound)}  ${row.name}`)
  }
  if (process.argv.includes('--without-each-rule')) {
    console.log('')
    console.log(`The main number without each rule (with every rule: ${percent(sharesOf(handwritten.rows[0]!).allThree).trim()}), and the difference:`)
    const all = sharesOf(handwritten.rows[0]!).allThree
    rules.forEach(rule => {
      const without = sharesOf(scoreTables(handwrittenTables(rules.filter(other => other !== rule)).tables, samples, {splits, breakdowns: false}).rows[0]!).allThree
      console.log(`${percent(without)}  ${(100 * (without - all)).toFixed(1).padStart(6)}  ${rule.name}`)
    })
  }
}
