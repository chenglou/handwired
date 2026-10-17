// Scores tables of the experiment on the written evaluation set of ../../written/: 240 broken JSON texts that agents
// wrote without seeing the generator, each repaired by two more agents. The set's README says what a case is.
//
// ../../written/score.ts scores ParserTables in the dataset's plain table parser. The experiment's tables are
// RecoveryTables, which can have added states, added classes, open display entries and the bit "first on its line",
// and which only run in the exact parser of ../recovery-parser.ts. scoreWritten runs that parser over every case and
// counts as ../../written/score.ts counts: over the code points from the first error of today's parser on that have a
// label with a scored value, a code point is right when every scored value is right, and a case is right as a whole
// when all of its counted code points are. The result has the parts of ../../written/score.ts, as counts.
//
// The two parsers are not the same parser, also with the same cells, see ../plain-tables.ts. The exact parser keeps
// the open containers in a real stack, and the plain table parser in a running sum, which is wrong after a closing
// bracket that does not match, e.g. after the } of {"a": [1}, "b": 2}: the sum goes on with an array as the
// innermost container, and the stack with the object. So for today's tables and for the dataset's hand rules,
// scoreWritten has a few more code points right than the set's README says, e.g. 75.9% for `words` where the README
// has 75.6%. check.ts counts where the two parsers differ, and checks the counting itself with the plain table
// parser in the exact parser's place.
//
// The set is for one last evaluation at the end of the experiment. Before that, only five tables may be scored on
// it: the ones that ../../written/score.ts prints, i.e. today's tables and the dataset's four hand rules. Any other
// tables need the environment variable RECOVERY_FINAL, as the test split does.
import {handRuleTables, handRules} from '../../hand-rules.ts'
import type {Label} from '../../labels.ts'
import type {Score, WrittenScore, WrittenScores} from '../../written/score.ts'
import {type WrittenCase, labelsOfWritten, readWritten} from '../../written/written.ts'
import {finalIsAllowed} from '../data.ts'
import {recoveryTablesOf} from '../plain-tables.ts'
import {capacity, codePointsOf, createTrace, runRecoveryParserInto} from '../recovery-parser.ts'
import {type RecoveryTables, asIsTables, checkTables, tablesToJson} from '../recovery-tables.ts'
import {wrongContainer, wrongDepth, wrongKind} from '../score.ts'

export type {Score, WrittenScore, WrittenScores}

// What a parser shows for a text, per code point: the display kind, the depth after the code point and the innermost
// open container after it. A trace of either parser has the three.
export type Shown = {displayKind: ArrayLike<number>, depthAfter: ArrayLike<number>, containerAfter: ArrayLike<number>}

// The exact parser with `tables`, as a function of a text. Every call writes into the same trace, so read what a
// call returns before the next call. Throws when the tables break the ground rules.
//
// The function that it returns throws for a text of more than 512 code points. The parser runs the first 512, so a
// count over the labels of a longer text would read entries of the trace that no run wrote, e.g. position 512 as
// white space at depth 0. No sample of the dataset and no case of the written set is that long.
export function exactParserWith(tables: RecoveryTables): (text: string) => Shown {
  checkTables(tables)
  const trace = createTrace()
  return text => {
    const {codePoints, truncated} = codePointsOf(text)
    if (truncated) throw new Error(`the exact parser runs the first ${capacity} code points of a text, and this text has more, so it cannot be scored or shown here: nothing is shown for the code points after them. The text starts with ${JSON.stringify(text.slice(0, 60))}`)
    runRecoveryParserInto(trace, codePoints, 0, codePoints.length, false, tables, codePoints.length)
    return trace
  }
}

// Which scored values of a label a parser has wrong at one code point, as the bits wrongKind, wrongDepth and
// wrongContainer of ../score.ts. 0 when every scored value is right, and also when no value is scored there.
export function wrongValuesAt(label: Label | undefined, shown: Shown, position: number): number {
  if (label === undefined) return 0
  let wrong = 0
  if (label.kind !== undefined && label.kind !== shown.displayKind[position]) wrong |= wrongKind
  if (label.depth !== undefined && label.depth !== shown.depthAfter[position]) wrong |= wrongDepth
  if (label.container !== undefined && label.container !== shown.containerAfter[position]) wrong |= wrongContainer
  return wrong
}

// The counts of one case: the fields of a Score that add up over cases.
export type CaseCounts = Pick<Score, 'scored' | 'right' | 'kindScored' | 'kindRight' | 'nestingScored' | 'depthRight' | 'containerRight'>

// Counts one text as scoreCases of ../../written/score.ts counts a case: `labels` has one entry per code point, and
// the code points from `firstErrorPosition` on whose label has a scored value are counted. A sample of the dataset
// is counted the same way, with the labels of labelsOf.
export function countText(labels: readonly (Label | undefined)[], firstErrorPosition: number, shown: Shown): CaseCounts {
  const counts = {scored: 0, right: 0, kindScored: 0, kindRight: 0, nestingScored: 0, depthRight: 0, containerRight: 0}
  if (firstErrorPosition === -1) return counts
  for (let position = firstErrorPosition; position < labels.length; position++) {
    const label = labels[position]
    if (label === undefined || (label.kind === undefined && label.depth === undefined)) continue
    counts.scored++
    const wrong = wrongValuesAt(label, shown, position)
    if (label.kind !== undefined) {
      counts.kindScored++
      if ((wrong & wrongKind) === 0) counts.kindRight++
    }
    if (label.depth !== undefined) {
      counts.nestingScored++
      if ((wrong & wrongDepth) === 0) counts.depthRight++
      if ((wrong & wrongContainer) === 0) counts.containerRight++
    }
    if (wrong === 0) counts.right++
  }
  return counts
}

// A text is right as a whole when it has something to recover and every counted code point is right.
export const isWhole = (counts: Pick<CaseCounts, 'scored' | 'right'>) => counts.scored > 0 && counts.right === counts.scored

function scoreOf(counted: readonly CaseCounts[]): Score {
  const score: Score = {cases: 0, nothingToRecover: 0, scored: 0, right: 0, kindScored: 0, kindRight: 0, nestingScored: 0, depthRight: 0, containerRight: 0, wholeRight: 0}
  for (const counts of counted) {
    score.cases++
    score.scored += counts.scored
    score.right += counts.right
    score.kindScored += counts.kindScored
    score.kindRight += counts.kindRight
    score.nestingScored += counts.nestingScored
    score.depthRight += counts.depthRight
    score.containerRight += counts.containerRight
    if (counts.scored === 0) score.nothingToRecover++
    else if (isWhole(counts)) score.wholeRight++
  }
  return score
}

// Scores any parser over `cases`: `shownFor` gives what the parser shows for a case's broken text. The parts are the
// ones of scoreTables in ../../written/score.ts, which says what each of them holds: all, perFile, generatorKinds,
// otherDamage and unmarked, each over the cases with full agreement and over the agreed code points of all cases.
export function scoreWrittenWith(cases: readonly WrittenCase[], shownFor: (writtenCase: WrittenCase) => Shown): WrittenScores {
  const counted = new Map(cases.map(writtenCase => [writtenCase, countText(labelsOfWritten(writtenCase), writtenCase.firstErrorPosition, shownFor(writtenCase))]))
  const countsOf = (some: readonly WrittenCase[]) => some.map(writtenCase => counted.get(writtenCase)!)
  const partOf = (some: readonly WrittenCase[]): WrittenScore =>
    ({fullAgreement: scoreOf(countsOf(some.filter(writtenCase => !writtenCase.disputedFromFirstError))), agreedCodePoints: scoreOf(countsOf(some))})
  const files = [...new Set(cases.map(writtenCase => writtenCase.file))].sort()
  return {
    all: partOf(cases), perFile: new Map(files.map(file => [file, partOf(cases.filter(writtenCase => writtenCase.file === file))])),
    generatorKinds: partOf(cases.filter(writtenCase => writtenCase.damage !== undefined && writtenCase.damage.other === undefined)),
    otherDamage: partOf(cases.filter(writtenCase => writtenCase.damage?.other !== undefined)),
    unmarked: partOf(cases.filter(writtenCase => !writtenCase.debatable && writtenCase.opinions.every(opinion => opinion.unsure === undefined))),
  }
}

// The cases of the written set, read once per process. Throws when the set's files have a problem: a case or a
// repair with a problem would be left out, and the numbers would be of another set.
let casesOfTheSet: WrittenCase[] | undefined
export function writtenCases(): readonly WrittenCase[] {
  if (casesOfTheSet === undefined) {
    const {cases, problems} = readWritten()
    if (problems.length > 0) throw new Error(`the written set has ${problems.length} problem${problems.length === 1 ? '' : 's'}, e.g.: ${problems[0]}`)
    casesOfTheSet = cases
  }
  return casesOfTheSet
}

// The names that ../../written/score.ts gives its five readers, and the tables of each as tables of the experiment:
// `now` is today's tables, and the others are the dataset's hand rules, with the stack action `by token` in every
// grammar cell. As tables they are the first five of baselineTables in ../arms/harness.ts.
export const readersOfTheSet = ['now', ...handRules] as const
export type ReaderOfTheSet = typeof readersOfTheSet[number]
export const tablesOfReader = (reader: ReaderOfTheSet): RecoveryTables => reader === 'now' ? asIsTables() : recoveryTablesOf(handRuleTables(reader))

// Whether `tables` are one of the five that may be scored on the written set before the final run: their numbers on
// the set are in the set's README already.
let textsOfTheReaders: Set<string> | undefined
export function scoredOnTheSetAlready(tables: RecoveryTables): boolean {
  textsOfTheReaders ??= new Set(readersOfTheSet.map(reader => tablesToJson(tablesOfReader(reader))))
  return textsOfTheReaders.has(tablesToJson(tables))
}

// Throws for tables that may not be run on the written set yet: any but the five of scoredOnTheSetAlready, unless
// the environment variable RECOVERY_FINAL is `yes`. `what` starts the error, e.g. "A score of these tables on the
// written set".
export function requireFinalOnTheWrittenSet(tables: RecoveryTables, what: string) {
  if (finalIsAllowed() || scoredOnTheSetAlready(tables)) return
  throw new Error(`${what} is for the final run only. Before it, the written set is scored and shown with today's tables and with the dataset's hand rules (${handRules.join(', ')}), and with no other tables: any other tables need the environment variable RECOVERY_FINAL set to yes, see final/README.md.`)
}

// The score of `tables` on the written set, in the exact parser. Throws when the tables break the ground rules, and
// without RECOVERY_FINAL for tables that are not one of the five of scoredOnTheSetAlready.
export function scoreWritten(tables: RecoveryTables): WrittenScores {
  requireFinalOnTheWrittenSet(tables, 'A score of these tables on the written set')
  const shown = exactParserWith(tables)
  return scoreWrittenWith(writtenCases(), writtenCase => shown(writtenCase.broken))
}

// A score's shares, from 0 to 1, and NaN where there is nothing to divide by: the code points with every scored
// value right, which is the main number, the cases with something to recover that are right as a whole, and the
// display kinds, the depths and the containers that are right, each over the code points where it is scored.
export function sharesOfWritten(score: Score) {
  return {
    codePoints: score.right / score.scored, wholeCases: score.wholeRight / (score.cases - score.nothingToRecover),
    kind: score.kindRight / score.kindScored, depth: score.depthRight / score.nestingScored, container: score.containerRight / score.nestingScored,
  }
}
