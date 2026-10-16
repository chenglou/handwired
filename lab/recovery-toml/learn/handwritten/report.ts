// The score of the hand-written recovery next to the parser as it is and next to the one rule "after an error, start
// anew at the next line" of ../restart-at-next-line.ts, on the two sets of sets.ts, and what each rule added.
//
// Run from the repo root:
//   bun lab/recovery-toml/learn/handwritten/report.ts [--set neutral,mixed] [--split validation] [--rows] [--steps] [--without-each-rule]
//       [--tables <file.json>] [--scratch <folder>]
// --split takes train, validation or both with a comma. The test split is refused.
// --rows adds every row of the score: per half of the mixed set, per number of edits or of kinds, per kind.
// --steps adds, per rule, the scores of the tables with the rules up to and including it, in the order `stepOrder` of
// rules.ts.
// --without-each-rule adds, per rule, the scores of the tables that leave the rule out. The cells of a rule that is
// left out hold today's choice, which for most grammar cells is the state `error`, where the parser stays.
// --tables scores saved tables in the place of the hand-written ones.
import {type Samples, type Split, splitsOfOption} from '../data.ts'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {type RecoveryTables, asIsTables, loadTablesForReport} from '../recovery-tables.ts'
import {scoreRestartAtNextLine} from '../restart-at-next-line.ts'
import {type Score, type ScoreRow, scoreTables, sharesOf} from '../score.ts'
import {handwrittenTables, rules, stepOrder} from './rules.ts'
import {loadSet, scratchFolderOf, setsOfOption} from './sets.ts'

const percent = (share: number) => Number.isNaN(share) ? '     -' : (100 * share).toFixed(2).padStart(6)
const pair = (row: ScoreRow | undefined) => row === undefined ? '     -      -' : `${percent(sharesOf(row).allThree)} ${percent(sharesOf(row).whole)}`

// The rows that the short report shows: all, and the two halves of the mixed set.
const mainRows = ['all', 'source: damage', 'source: kinds']

function describe(samples: Samples, splits: readonly Split[], columns: readonly (readonly [name: string, score: Score])[], everyRow: boolean): string {
  const lines = [`${'samples'.padStart(7)} ${'scored'.padStart(8)}  ${columns.map(([name]) => name.padStart(13)).join('  ')}  row`]
  const first = columns[0]![1]
  for (const row of first.rows) {
    if (!everyRow && !mainRows.includes(row.name)) continue
    if (row.name.startsWith('split:') && splits.length === 1) continue
    if (row.name === 'source: damage' && !samples.sourceNames.includes('kinds')) continue
    lines.push(`${String(row.samples).padStart(7)} ${String(row.codePoints).padStart(8)}  ${columns.map(([, score]) => pair(score.rows.find(other => other.name === row.name))).join('  ')}  ${row.name}`)
  }
  return lines.join('\n')
}

if (import.meta.main) {
  refuseUnknownOptions('handwritten/report.ts', ['--set', '--split', '--rows', '--steps', '--without-each-rule', '--tables', '--scratch'])
  const splits = splitsOfOption('handwritten/report.ts')
  const scratch = scratchFolderOf(optionOf('--scratch'))
  const tablesFile = optionOf('--tables')
  const handwritten: RecoveryTables = tablesFile === undefined ? handwrittenTables().tables : loadTablesForReport(tablesFile).tables
  console.log('Per column: the percentage of the scored code points with display kind, depth and container right (all three), then the percentage of samples with every scored code point right (whole).')
  for (const setName of setsOfOption(optionOf('--set'))) {
    const samples = loadSet(setName, scratch)
    const columns = [
      ['as it is', scoreTables(asIsTables(), samples, {splits})],
      ['the one rule', scoreRestartAtNextLine(samples, {splits})],
      ['hand-written', scoreTables(handwritten, samples, {splits})],
    ] as const
    console.log(`\nThe ${setName} set, split${splits.length === 1 ? '' : 's'} ${splits.join(', ')}:`)
    console.log(describe(samples, splits, columns, process.argv.includes('--rows')))
    const mainOf = (tables: RecoveryTables) => {
      const score = scoreTables(tables, samples, {splits})
      return mainRows.map(name => score.rows.find(row => row.name === name)).filter(row => row !== undefined && (row.name !== 'source: damage' || samples.sourceNames.includes('kinds'))).map(pair).join('  ')
    }
    const heading = setName === 'mixed' ? `${'all'.padStart(13)}  ${'damage half'.padStart(13)}  ${'kinds half'.padStart(13)}` : 'all'.padStart(13)
    if (process.argv.includes('--steps')) {
      console.log(`\nThe rules up to and including each one:\n${heading}`)
      console.log(`${mainOf(handwrittenTables([]).tables)}  no rule`)
      stepOrder.forEach((name, step) => console.log(`${mainOf(handwrittenTables(rules.filter(rule => stepOrder.indexOf(rule.name) <= step)).tables)}  ${step + 1}. ${name}`))
    }
    if (process.argv.includes('--without-each-rule')) {
      console.log(`\nEvery rule but one:\n${heading}`)
      console.log(`${mainOf(handwrittenTables().tables)}  every rule`)
      rules.forEach((rule, index) => console.log(`${mainOf(handwrittenTables(rules.filter(other => other !== rule)).tables)}  without ${index + 1}. ${rule.name}`))
    }
  }
}
