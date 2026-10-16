// The second counts of the final scoring: every count of count.ts that a set's own scorer also makes is held against
// that scorer's number. The sets' scorers are ../specific/score.ts, ../written/score.ts and ../../learn/score.ts.
// They run tables through parserOfTables of ../parsers.ts or through the loop over typed arrays of learn/, where
// count.ts runs them through parserOfCheckedTables, so a difference in the counting or in the parser shows.
import type {Samples} from '../../learn/data.ts'
import type {ScoreRow} from '../../learn/score.ts'
import type {Parser} from '../parsers.ts'
import {scoreWith as generatorScoreWith} from '../specific/score.ts'
import {type Score as WrittenScoreOfCases, scoresWith as writtenScoresWith} from '../written/score.ts'
import type {Counts} from './count.ts'
import {type generatorSet, writtenFileRows, writtenParts, type writtenSet} from './sets.ts'

export const countFields = ['texts', 'nothingToRecover', 'scored', 'right', 'whole', 'kindScored', 'kindRight', 'nestingScored', 'depthRight', 'containerRight', 'added', 'addedShownAsError'] as const
export type CountField = typeof countFields[number]

// How many counts were compared, and a sentence per count that differs.
export type Comparison = {compared: number, different: string[]}

// Holds counts of count.ts against counts that other code made of the same texts, field by field. `expected` has the
// other code's numbers under the names of count.ts, and only the fields that the other code counts. A row that
// count.ts left out for having no text counts as zeros.
export function compare(what: string, mine: Counts | undefined, expected: Partial<Record<CountField, number>>, result: Comparison) {
  for (const field of countFields) {
    const other = expected[field]
    if (other === undefined) continue
    result.compared++
    const own = mine?.[field] ?? 0
    if (own !== other) result.different.push(`${what}, ${field}: ${own} here and ${other} there`)
  }
}

const ofWrittenScore = (score: WrittenScoreOfCases | undefined): Partial<Record<CountField, number>> => score === undefined ? {texts: 0} : {
  texts: score.cases, nothingToRecover: score.nothingToRecover, scored: score.scored, right: score.right, whole: score.wholeRight, kindScored: score.kindScored, kindRight: score.kindRight,
  nestingScored: score.nestingScored, depthRight: score.depthRight, containerRight: score.containerRight,
}

// ../specific/score.ts: the samples, the scored code points, the right ones and the whole samples of every row.
export function compareWithGeneratorScorer(who: string, parser: Parser, counts: readonly Counts[], generator: ReturnType<typeof generatorSet>, result: Comparison) {
  const rows = generatorScoreWith(parser, generator.samples)
  for (const row of rows) compare(`${who}, generator, ${row.name}`, counts.find(mine => mine.name === row.name), {texts: row.samples, scored: row.scored, right: row.right, whole: row.whole}, result)
  for (const mine of counts) if (!rows.some(row => row.name === mine.name)) result.different.push(`${who}, generator: the row ${mine.name} is not a row of specific/score.ts`)
}

// ../written/score.ts: every count of every part, over the cases with full agreement and over all cases.
export function compareWithWrittenScorer(who: string, parser: Parser, counts: readonly Counts[], written: ReturnType<typeof writtenSet>, result: Comparison) {
  const scores = writtenScoresWith(parser.show, written.cases)
  const named = (name: string) => counts.find(mine => mine.name === name)
  for (const part of writtenParts) {
    compare(`${who}, written, ${part.fullAgreement}`, named(part.fullAgreement), ofWrittenScore(scores[part.key].fullAgreement), result)
    compare(`${who}, written, ${part.agreedCodePoints}`, named(part.agreedCodePoints), ofWrittenScore(scores[part.key].agreedCodePoints), result)
  }
  for (const file of written.files) {
    compare(`${who}, written, ${writtenFileRows(file).fullAgreement}`, named(writtenFileRows(file).fullAgreement), ofWrittenScore(scores.perFile.get(file)?.fullAgreement), result)
    compare(`${who}, written, ${writtenFileRows(file).agreedCodePoints}`, named(writtenFileRows(file).agreedCodePoints), ofWrittenScore(scores.perFile.get(file)?.agreedCodePoints), result)
  }
}

const ofLearnRow = (row: ScoreRow | undefined): Partial<Record<CountField, number>> => row === undefined ? {texts: 0} : {
  texts: row.samples, nothingToRecover: row.nothingToRecover, scored: row.codePoints, right: row.allRight, whole: row.wholeSamples, kindScored: row.kindScored, kindRight: row.kindRight,
  nestingScored: row.nestingScored, depthRight: row.depthRight, containerRight: row.containerRight, added: row.addedCodePoints, addedShownAsError: row.addedShownAsError,
}

// ../../learn/score.ts: every count, the added code points among them, of the rows that it has too ("all", the
// groups and the kinds of edits), and of each part of the samples, e.g. the documents of the held-out templates.
// `rowsOf` gives the rows of that scorer for some samples, with or without its breakdowns.
export function compareWithLearnScorer(who: string, counts: readonly Counts[], whole: Samples, parts: readonly {name: string, samples: Samples}[], rowsOf: (samples: Samples, breakdowns: boolean) => ScoreRow[], result: Comparison) {
  const learnRows = rowsOf(whole, true)
  for (const mine of counts) {
    if (mine.name !== 'all' && !mine.name.startsWith('group: ') && !mine.name.startsWith('kind: ')) continue
    compare(`${who}, dataset, ${mine.name}`, mine, ofLearnRow(learnRows.find(row => row.name === mine.name)), result)
  }
  for (const part of parts) compare(`${who}, dataset, ${part.name}`, counts.find(mine => mine.name === part.name), ofLearnRow(rowsOf(part.samples, false)[0]), result)
}
