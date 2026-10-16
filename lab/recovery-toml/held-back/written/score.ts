// What a parser gets right on the written set, counted as the JSON experiment counts its written set: over the code
// points from the first error of the parser as it is on that have a label with a scored value, a code point is right
// when every scored value is right, and a case is right as a whole when all of its counted code points are.
//
// Run from the repo root: bun lab/recovery-toml/held-back/written/score.ts [--set <folder>]
// It prints the parser as it is, over the cases with full agreement and over the agreed code points of all cases. It
// prints both again for the parts that kinds.txt makes of the set, i.e. the cases whose damage one to three of the
// train data's edits make and the cases with other damage, and per writer's file, and the first of them without the
// cases that a repairer marked as open to another reading. Other code scores its own tables with scoreTables(tables),
// which returns numbers alone: whoever builds or trains a parser calls it and reads nothing else of this folder.
import {type ParserTables, defaultTables, runTableParser} from '../../table-parser.ts'
import {neutralEditsOf} from './neutral-edits.ts'
import {type WrittenCase, labelsOfWritten, readWritten, setFolderOf} from './written.ts'

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
// - fullAgreement: the cases without a disputed code point from the first error on. This is the set's main number.
//   A case with one repair has no disputed code point.
// - agreedCodePoints: all cases, where a disputed code point is left out.
export type WrittenScore = {fullAgreement: Score, agreedCodePoints: Score}

// The scores of tables over the set and over its parts:
// - all: every case.
// - perFile: the cases of each writer's file, e.g. 'hand-editing.txt'.
// - neutralEdits and otherDamage: the two parts that kinds.txt makes of the set. The first has the cases whose damage
//   one to three of the ten edits of the train data make, so it says how a result carries over to other documents
//   with damage that the train data could have. The second has the other cases, whose damage needs knowledge of how
//   TOML gets broken, e.g. a colon after every key, so it says how a result carries over to other damage. A case that
//   kinds.txt does not name is in neither.
// - moreEdits: the cases of otherDamage in which up to three edits make every damaged place, and the edits are more
//   than the three that a sample of the train data has at most, e.g. the quotes that are missing around two values.
// - unmarked: the cases of which no repair is marked as unsure, i.e. without the cases whose agreement rests on a
//   reading that a repairer called open.
export type WrittenScores = {all: WrittenScore, perFile: Map<string, WrittenScore>, neutralEdits: WrittenScore, otherDamage: WrittenScore, moreEdits: WrittenScore, unmarked: WrittenScore}
export function scoreTables(tables: ParserTables, cases: readonly WrittenCase[] = readWritten().cases): WrittenScores {
  const scoreOf = (some: readonly WrittenCase[]): WrittenScore =>
    ({fullAgreement: scoreCases(tables, some.filter(writtenCase => !writtenCase.disputedFromFirstError)), agreedCodePoints: scoreCases(tables, some)})
  const files = [...new Set(cases.map(writtenCase => writtenCase.file))].sort()
  const otherDamage = cases.filter(writtenCase => writtenCase.damage?.other !== undefined)
  return {
    all: scoreOf(cases), perFile: new Map(files.map(file => [file, scoreOf(cases.filter(writtenCase => writtenCase.file === file))])),
    neutralEdits: scoreOf(cases.filter(writtenCase => writtenCase.damage !== undefined && writtenCase.damage.other === undefined)),
    otherDamage: scoreOf(otherDamage), moreEdits: scoreOf(otherDamage.filter(writtenCase => neutralEditsOf(writtenCase).otherPlaces.length === 0)),
    unmarked: scoreOf(cases.filter(writtenCase => writtenCase.opinions.every(opinion => opinion.unsure === undefined))),
  }
}

if (import.meta.main) {
  const folder = setFolderOf(process.argv.slice(2))
  const {cases, problems} = readWritten(folder)
  // Only the count is printed: a problem's text can quote a case, and this command's output is for every reader.
  if (problems.length > 0) console.log(`${problems.length} problems in the files: the cases and repairs that they name are left out of the numbers below. check.ts prints them.\n`)
  const scores = scoreTables(defaultTables, cases)
  const percent = (part: number, whole: number) => (whole === 0 ? '-' : (100 * part / whole).toFixed(1)).padStart(6)
  const line = (score: Score, name: string) =>
    `  ${String(score.cases).padStart(5)} ${String(score.nothingToRecover).padStart(7)} ${String(score.scored).padStart(7)}   ${percent(score.right, score.scored)} ${percent(score.wholeRight, score.cases - score.nothingToRecover)}   ${percent(score.kindRight, score.kindScored)} ${percent(score.depthRight, score.nestingScored)} ${percent(score.containerRight, score.nestingScored)}  ${name}`
  const repairedTwice = cases.filter(writtenCase => writtenCase.opinions.length === 2).length
  console.log(`The written set in ${folder}: ${cases.length} cases, ${repairedTwice} with two repairs, ${cases.length - repairedTwice} with the writer's repair alone.`)
  console.log('A score counts the code points from the first error of the parser as it is on that have a label with a scored value. The numbers are')
  console.log('those of the parser as it is. Columns: cases, cases with nothing to recover, counted code points, the percentage of code points with every')
  console.log('scored value right, the percentage of cases with something to recover in which every counted code point is right, and the percentage')
  console.log('of the scored display kinds, depths and containers that are right.')
  console.log(`\n  ${'cases'.padStart(5)} ${'nothing'.padStart(7)} ${'points'.padStart(7)}   ${'all 3'.padStart(6)} ${'whole'.padStart(6)}   ${'kind'.padStart(6)} ${'depth'.padStart(6)} ${'cont'.padStart(6)}`)
  console.log(line(scores.all.fullAgreement, 'cases with full agreement from the first error on'))
  console.log(line(scores.neutralEdits.fullAgreement, '  of them, the cases whose damage one to three of the ten edits make'))
  console.log(line(scores.otherDamage.fullAgreement, '  of them, the cases with other damage'))
  console.log(line(scores.moreEdits.fullAgreement, '    of those, the cases whose damage more than three edits make'))
  console.log(line(scores.unmarked.fullAgreement, '  of them, the cases of which no repair is marked as unsure'))
  console.log(line(scores.all.agreedCodePoints, 'all cases, the agreed code points'))
  console.log(line(scores.neutralEdits.agreedCodePoints, '  of them, the cases whose damage one to three of the ten edits make'))
  console.log(line(scores.otherDamage.agreedCodePoints, '  of them, the cases with other damage'))
  console.log(line(scores.moreEdits.agreedCodePoints, '    of those, the cases whose damage more than three edits make'))
  for (const [file, score] of scores.perFile) {
    console.log(line(score.fullAgreement, `${file}: cases with full agreement`))
    console.log(line(score.agreedCodePoints, `${file}: all cases, the agreed code points`))
  }
  if (problems.length > 0) process.exitCode = 1
}
