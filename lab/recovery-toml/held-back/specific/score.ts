// What a parser gets right on the held-back set of mistakes that people make in TOML, in rows that a result is read
// by: per kind of mistake, per group, and for the documents of the two held-out templates apart.
//
// Run from the repo root: bun lab/recovery-toml/held-back/specific/score.ts [--tables <file.json>] [--markdown]
// It prints, for the set (the samples 0 to 2,999 of the default seed), the parser as it is, then the one rule without
// any training that trained tables are read against (after an error, anew at the next line, see ../parsers.ts), then
// the tables of each file that --tables names, e.g. the recipe's, which needs the environment variable
// RECOVERY_FINAL. Per row and parser: the percentage of the scored code points with every scored value right ("all
// three"), and the percentage of the samples in which every scored code point is right ("whole"). With --markdown the
// rows are printed as the table of README.md.
//
// The counting is the one of ../../learn/score.ts: the code points from the first error of the parser as it is on
// whose label has a scored value. For tables, scoreTables of that file on samplesOf(labeledTexts()) gives the same
// numbers in the rows "all", "kind: …" and "group: …": check.ts compares the scored code points of the two, and this
// file's rows for the parser as it is are the ones that check.ts prints.
import {type Parser, parsersOfCommand} from '../parsers.ts'
import {kinds} from './mistakes.ts'
import {type Sample, defaultSeed, groupOf, groups, heldOutTemplates, labelsOf, sampleAt, standardCount} from './samples.ts'

export type Row = {
  name: string
  samples: number
  // Scored code points, and those with every scored value right.
  scored: number
  right: number
  // Samples in which every scored code point is right. Every sample of the set has a scored code point.
  whole: number
}

// The rows that a sample is counted in. A sample with two kinds is in the row of each.
export function rowNamesOf(sample: Sample): string[] {
  return [
    'all',
    sample.heldOut.length > 0 ? 'documents of the two held-out templates' : 'documents of the 14 templates that the train data has',
    ...sample.heldOut,
    sample.kinds.length === 1 ? 'one mistake' : 'two mistakes',
    `group: ${groupOf(sample)}`,
    ...sample.kinds.map(kind => `kind: ${kind}`),
  ]
}

// Every row in the order in which it is printed, whether or not a sample is in it.
export const rowNames = [
  'all', 'documents of the two held-out templates', ...heldOutTemplates.map(template => `template: ${template}`), 'documents of the 14 templates that the train data has',
  'one mistake', 'two mistakes', ...groups.map(group => `group: ${group}`), ...kinds.map(kind => `kind: ${kind.name}`),
]

// The rows of a parser over samples of the set.
export function scoreWith(parser: Parser, samples: readonly Sample[]): Row[] {
  const rows = new Map<string, Row>(rowNames.map(name => [name, {name, samples: 0, scored: 0, right: 0, whole: 0}]))
  for (const sample of samples) {
    const labels = labelsOf(sample)
    const shown = parser.show(sample.broken)
    let scored = 0
    let right = 0
    for (let position = sample.firstErrorPosition; position < labels.length; position++) {
      const label = labels[position]
      if (label === undefined || (label.kind === undefined && label.depth === undefined)) continue
      scored++
      const kindRight = label.kind === undefined || label.kind === shown.displayKind[position]
      const nestingRight = label.depth === undefined || (label.depth === shown.depthAfter[position] && label.container === shown.containerAfter[position])
      if (kindRight && nestingRight) right++
    }
    for (const name of rowNamesOf(sample)) {
      const row = rows.get(name)
      if (row === undefined) throw new Error(`the sample ${sample.id} is in the row ${name}, which is not in rowNames`)
      row.samples++
      row.scored += scored
      row.right += right
      if (scored > 0 && right === scored) row.whole++
    }
  }
  return [...rows.values()]
}

// The set that a final scoring takes.
export function standardSet(): Sample[] {
  return Array.from({length: standardCount}, (_, index) => sampleAt(defaultSeed, index))
}

if (import.meta.main) {
  const parsers = parsersOfCommand(process.argv.slice(2))
  const samples = standardSet()
  const scores = parsers.map(parser => scoreWith(parser, samples))
  const percent = (part: number, whole: number) => whole === 0 ? '-' : (100 * part / whole).toFixed(1)
  const markdown = process.argv.includes('--markdown')
  console.log(`The held-back set of mistakes: the ${samples.length} samples of seed ${defaultSeed}. Per row: the samples, the scored code points, and per parser the percentage of the scored code points`)
  console.log('with every scored value right (all 3) and the percentage of the samples with every scored code point right (whole).')
  parsers.forEach((parser, index) => console.log(`  ${String.fromCodePoint(65 + index)}: ${parser.name}`))
  console.log('')
  if (markdown) {
    console.log(`| Row | Samples | Scored code points | ${parsers.map(parser => `${parser.name[0]!.toUpperCase()}${parser.name.slice(1)}: all three | Whole`).join(' | ')} |`)
    console.log(`|---|---|---|${parsers.map(() => '---|---|').join('')}`)
  } else {
    console.log(`${'samples'.padStart(7)} ${'points'.padStart(7)}  ${parsers.map((_, index) => `${`${String.fromCodePoint(65 + index)} all 3`.padStart(7)} ${'whole'.padStart(6)}`).join('  ')}  row`)
  }
  scores[0]!.forEach((first, rowIndex) => {
    if (first.samples === 0) return
    const cells = scores.map(rows => [percent(rows[rowIndex]!.right, rows[rowIndex]!.scored), percent(rows[rowIndex]!.whole, rows[rowIndex]!.samples)])
    if (markdown) console.log(`| ${first.name.startsWith('kind: ') ? `\`${first.name.slice(6)}\`` : first.name} | ${first.samples} | ${first.scored} | ${cells.map(([allThree, whole]) => `${allThree} | ${whole}`).join(' | ')} |`)
    else console.log(`${String(first.samples).padStart(7)} ${String(first.scored).padStart(7)}  ${cells.map(([allThree, whole]) => `${allThree!.padStart(7)} ${whole!.padStart(6)}`).join('  ')}  ${first.name}`)
  })
}
