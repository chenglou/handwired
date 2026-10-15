// What a reader gets right on the written evaluation set, counted as stats.ts counts it for the dataset: over the
// code points from the first error of the parser as it is on that have a label with a scored value, a code point is
// right when every scored value is right, and a case is right as a whole when all of its counted code points are.
//
// Run from the repo root: bun lab/recovery-parser/written/score.ts [folder]
// It prints the parser as it is and the four hand rules of hand-rules.ts, over the cases with full agreement and over
// the agreed code points of all cases. It prints both again for the two parts that kinds.txt makes of the set, i.e.
// the cases whose damage is all of the generator's kinds and the cases with damage that no kind makes, and per
// writer's file, and the first of them without the cases that someone marked as open to another reading. Other code
// scores its own tables with scoreTables(tables).
import {handRuleTables, handRules} from '../hand-rules.ts'
import {type ParserTables, defaultTables, runTableParser} from '../table-parser.ts'
import {type WrittenCase, labelsOfWritten, readWritten, writtenFolder} from './written.ts'

export type Score = {
  cases: number
  // Cases without a counted code point, e.g. a text that is cut off: nothing is left to recover in them.
  nothingToRecover: number
  // Code points that are counted, and those where every scored value is right.
  scored: number
  right: number
  // Per value: how many are scored, and how many of those are right.
  kindScored: number
  kindRight: number
  nestingScored: number
  depthRight: number
  containerRight: number
  // Cases with something to recover in which every counted code point is right.
  wholeRight: number
}
const noScore = (): Score => ({cases: 0, nothingToRecover: 0, scored: 0, right: 0, kindScored: 0, kindRight: 0, nestingScored: 0, depthRight: 0, containerRight: 0, wholeRight: 0})

// The score of tables over cases. Only agreed code points have a label, so a disputed code point is never counted.
export function scoreCases(tables: ParserTables, cases: readonly WrittenCase[]): Score {
  const score = noScore()
  for (const writtenCase of cases) {
    const labels = labelsOfWritten(writtenCase)
    const trace = runTableParser(writtenCase.broken, tables)
    let scored = 0
    let right = 0
    for (let position = writtenCase.firstErrorPosition; position < labels.length; position++) {
      const label = labels[position]
      if (label === undefined || (label.kind === undefined && label.depth === undefined)) continue
      scored++
      const kindRight = label.kind === undefined || label.kind === trace.displayKind[position]
      const depthRight = label.depth === undefined || label.depth === trace.depthAfter[position]
      const containerRight = label.container === undefined || label.container === trace.containerAfter[position]
      if (label.kind !== undefined) {
        score.kindScored++
        if (kindRight) score.kindRight++
      }
      if (label.depth !== undefined) {
        score.nestingScored++
        if (depthRight) score.depthRight++
        if (containerRight) score.containerRight++
      }
      if (kindRight && depthRight && containerRight) right++
    }
    score.cases++
    score.scored += scored
    score.right += right
    if (scored === 0) score.nothingToRecover++
    else if (right === scored) score.wholeRight++
  }
  return score
}

// The two ways to count the set:
// - fullAgreement: the cases without a disputed code point from the first error on. This is the set's main number: in
//   these cases three opinions agree on every code point that a score could count.
// - agreedCodePoints: all cases, where a disputed code point is left out. A case with a disputed code point is then
//   right as a whole when the code points around the dispute are right.
export type WrittenScore = {fullAgreement: Score, agreedCodePoints: Score}

// The scores of tables over the set and over its parts:
// - all: every case.
// - perFile: the cases of each writer's file.
// - generatorKinds and otherDamage: the two parts that kinds.txt makes of the set. The first has the cases whose
//   damage is all of the generator's kinds, written by someone who did not see the generator, so it says how a
//   result carries over to other documents with damage of sorts that the samples have. The second has the cases with
//   damage that no kind makes, e.g. the marks of a diff, so it says how a result carries over to other damage. A case
//   that kinds.txt does not name is in neither.
// - unmarked: the cases that their writer did not mark as debatable and of which no repair is marked as unsure, i.e.
//   without the cases whose agreement rests on a reading that someone called open.
export type WrittenScores = {all: WrittenScore, perFile: Map<string, WrittenScore>, generatorKinds: WrittenScore, otherDamage: WrittenScore, unmarked: WrittenScore}
export function scoreTables(tables: ParserTables, cases: readonly WrittenCase[] = readWritten().cases): WrittenScores {
  const scoreOf = (some: readonly WrittenCase[]): WrittenScore =>
    ({fullAgreement: scoreCases(tables, some.filter(writtenCase => !writtenCase.disputedFromFirstError)), agreedCodePoints: scoreCases(tables, some)})
  const files = [...new Set(cases.map(writtenCase => writtenCase.file))].sort()
  return {
    all: scoreOf(cases), perFile: new Map(files.map(file => [file, scoreOf(cases.filter(writtenCase => writtenCase.file === file))])),
    generatorKinds: scoreOf(cases.filter(writtenCase => writtenCase.damage !== undefined && writtenCase.damage.other === undefined)),
    otherDamage: scoreOf(cases.filter(writtenCase => writtenCase.damage?.other !== undefined)),
    unmarked: scoreOf(cases.filter(writtenCase => !writtenCase.debatable && writtenCase.opinions.every(opinion => opinion.unsure === undefined))),
  }
}

if (import.meta.main) {
  const folder = process.argv[2] ?? writtenFolder
  const {cases, problems} = readWritten(folder)
  for (const problem of problems) console.log(`problem: ${problem}`)
  if (problems.length > 0) console.log(`${problems.length} problems: the cases and repairs that they name are left out of the numbers below.\n`)
  const readers = ['now', ...handRules] as const
  const scores = readers.map(reader => scoreTables(reader === 'now' ? defaultTables : handRuleTables(reader), cases))
  const percent = (part: number, whole: number) => (whole === 0 ? '-' : (100 * part / whole).toFixed(1)).padStart(6)
  const line = (pick: (score: WrittenScores) => Score, name: string) => {
    const first = pick(scores[0]!)
    const perReader = scores.map(score => `${percent(pick(score).right, pick(score).scored)} ${percent(pick(score).wholeRight, pick(score).cases - pick(score).nothingToRecover)}`)
    return `  ${String(first.cases).padStart(5)} ${String(first.nothingToRecover).padStart(7)} ${String(first.scored).padStart(7)}   ${perReader.join('   ')}  ${name}`
  }
  const repaired = (wanted: number) => cases.filter(writtenCase => writtenCase.opinions.length - 1 === wanted).length
  console.log(`The written evaluation set in ${folder}: ${cases.length} cases, ${repaired(2)} with two repairs, ${repaired(1)} with one, ${repaired(0)} with the writer's opinion alone.`)
  console.log('A score counts the code points from the first error of the parser as it is on that have a label with a scored value, as stats.ts')
  console.log('does. "now" is the parser as it is, and the others are the hand rules of hand-rules.ts. Columns: cases, cases with nothing to recover,')
  console.log('counted code points, then per reader the percentage of code points with every scored value right and the percentage of cases with')
  console.log('something to recover in which every counted code point is right.')
  console.log(`\n  ${'cases'.padStart(5)} ${'nothing'.padStart(7)} ${'points'.padStart(7)}   ${readers.map(reader => `${reader.padStart(6)} ${'whole'.padStart(6)}`).join('   ')}`)
  console.log(line(score => score.all.fullAgreement, 'cases with full agreement from the first error on'))
  console.log(line(score => score.generatorKinds.fullAgreement, '  of them, the cases whose damage is all of the generator\'s kinds'))
  console.log(line(score => score.otherDamage.fullAgreement, '  of them, the cases with damage that no kind makes'))
  console.log(line(score => score.unmarked.fullAgreement, '  of them, the cases that nobody marked as debatable or unsure'))
  console.log(line(score => score.all.agreedCodePoints, 'all cases, the agreed code points'))
  console.log(line(score => score.generatorKinds.agreedCodePoints, '  of them, the cases whose damage is all of the generator\'s kinds'))
  console.log(line(score => score.otherDamage.agreedCodePoints, '  of them, the cases with damage that no kind makes'))
  for (const file of scores[0]!.perFile.keys()) {
    console.log(line(score => score.perFile.get(file)!.fullAgreement, `${file}: cases with full agreement`))
    console.log(line(score => score.perFile.get(file)!.agreedCodePoints, `${file}: all cases, the agreed code points`))
  }
  if (problems.length > 0) process.exitCode = 1
}
