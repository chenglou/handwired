// Checks the tooling of the final scoring. The check reads no sample of the test split, and it scores no tables on
// the written set but the five that may be scored there before the final run: today's tables and the dataset's
// four hand rules. Whatever needs other tables runs on cases that are made up here.
//
// Run from the repo root, with RECOVERY_SCRATCH set to the experiment's scratch folder and without RECOVERY_FINAL:
//   bun lab/recovery-parser/learn/final/check.ts
// ../check-all.ts runs it too. This folder and ../../written/ are only on the branch of the final scoring.
//
// 1. The counting of scoreWritten. With the dataset's plain table parser in the exact parser's place, the counting
//    of written-score.ts gives what ../../written/score.ts counts, for each of the five tables: every count of every
//    part, i.e. of the whole set, of the two parts that kinds.txt makes, of the cases that nobody marked, and of
//    each writer's file, over the cases with full agreement and over the agreed code points of all cases. The shares
//    of the cases with full agreement are the ones of the set's README.
// 2. The exact parser against the plain table parser, for each of the five tables. scoreWritten runs the exact
//    parser, which is not the plain one: it keeps the open containers in a real stack. On every case the exact
//    parser has the case's first error and the plain parser's depth at every code point, and no display kind
//    differs before the first code point at which the two read another context. Over the cases in which the two
//    show the same at every code point, scoreWritten's counting gives what ../../written/score.ts counts. Over the
//    whole set, scoreWritten has the same cases and scored code points and the same right depths, and the check
//    prints both sides of what differs: the code points right and the whole cases.
// 3. That these comparisons can fail. On the written set: the counts of one of the five tables are not the counts of
//    another, for every pair. With one changed cell: on three cases made up here, the exact parser's counts are the
//    plain parser's for each of the five tables, and no longer once one open cell of the experiment's tables is
//    changed. A fourth made-up case has a closing bracket that does not match, {"a": [1}, "b": 2}, and the exact
//    parser has more of it right than the plain one.
// 4. Tables with every kind of added structure run in the scorer: with no cell changed they give the made-up cases
//    the counts of today's tables, while code points read the added class and the bit "first on its line". And
//    scoreWritten refuses, without RECOVERY_FINAL, tables with a changed cell, tables with added structure and the
//    hand-written tables, and names RECOVERY_FINAL. The exact parser of the scorer refuses a text of more than 512
//    code points, and runs one of 512.
// 5. The dry run of run.ts, as a command, on a list of toy tables: three hand rules as the "seeds" of one entry, a
//    fourth as its confirmation file, and two tables with added structure and random open cells. Every line that it
//    prints and every line of its report is marked as a dry run. A row is the mean, the lowest and the highest that
//    the check works out from scores of its own. The baselines come first. The four parts by made-up held-out bits
//    hold the samples that one score of the relabeled samples puts into the four rows of ../arms/final.ts, and add
//    up to the validation split. On the written set only the five tables have numbers. The report that a final run
//    words from the same counts has the same tables and names no dry run. The log of the final runs and the cache
//    folder are as before the run. Without --dry-run the command refuses by its own first line, and a
//    list with a file of another dataset, with an unknown field, with one name twice, with one file twice, with one
//    file in an entry's tables and in its confirmation files, or without tables is refused. The line that a final
//    run appends to the log is written to a log in a folder that is made up here, and names the commit of the
//    worktree.
// 6. show.ts, as a command: a case of the written set with two of the five tables, a validation sample with any
//    tables, and the two lists of --differs on the written set and on the validation split, whose counts of whole
//    texts are the ones of scoreWritten and of scoreTables. It refuses a case of the written set with other tables,
//    a sample of the test split, and --differs on the test split, each with an error that names RECOVERY_FINAL.
// 7. The check that run.ts makes of the test split when it loads it, problemOfTheLoadedTestSplit, on arrays that are
//    made up here from the indexes of the standard set, without a test sample: every index of the range, with the
//    test split for an index that the standard set lacks. That set passes. Six changed sets do not, among them one
//    with the same two counts and other samples, which a comparison of the counts alone lets pass.
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs'
import {join, relative, resolve} from 'node:path'
import {visible} from '../../dump.ts'
import {handRuleTables} from '../../hand-rules.ts'
import {createRandom} from '../../random.ts'
import {type ParserTables, defaultTables, runTableParser} from '../../table-parser.ts'
import {scoreTables as scoreTablesOfTheSet} from '../../written/score.ts'
import {type WrittenCase, caseOf, labelsOfWritten} from '../../written/written.ts'
import {baselineTables, samplesOfTheStandardSet, validationOfTheStandardSet} from '../arms/harness.ts'
import {type Samples, allowedSampleAt, cacheFolderOf, datasetKey, heldOutByKind, heldOutByTemplate, refuseUnknownOptions, splitNames, standardRange} from '../data.ts'
import {handwrittenTables} from '../handwritten/rules.ts'
import {codePointsOf, runRecoveryParser} from '../recovery-parser.ts'
import {type RecoveryTables, addClasses, addFirstOnLineBit, addStates, asIsTables, copyTables, grammarStateNames, openDisplayEntries, randomizeOpenCells, saveTables, today} from '../recovery-tables.ts'
import {type ScoreRow, heldOutRowNames, scoreTables, sharesOf} from '../score.ts'
import {type RowCounts, appendToTheLogOfFinalRuns, describeReport, dryRunMark, problemOfTheLoadedTestSplit, wholeSplit} from './run.ts'
import {
  type ReaderOfTheSet, type Score, type WrittenScore, type WrittenScores, countText, exactParserWith, readersOfTheSet, scoreWritten, scoreWrittenWith, scoredOnTheSetAlready, sharesOfWritten, tablesOfReader,
  writtenCases,
} from './written-score.ts'

refuseUnknownOptions('final/check.ts', [])
if (process.env['RECOVERY_FINAL'] !== undefined) {
  console.log('FAILED: final/check.ts has to run without the environment variable RECOVERY_FINAL.')
  console.log('1 checks FAILED.')
  process.exit(1)
}
const scratch = process.env['RECOVERY_SCRATCH']
if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to the experiment\'s scratch folder: the check reads the cache of the samples there and writes its toy tables to <RECOVERY_SCRATCH>/final/check/')

let failures = 0
const check = (holds: boolean, message: string) => {
  if (holds) return
  failures++
  console.log(`FAILED: ${message}`)
}
// The message of the error that `run` throws, or undefined when it throws none.
const errorOf = (run: () => unknown): string | undefined => {
  try {
    run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return undefined
}

const countNames = ['cases', 'nothingToRecover', 'scored', 'right', 'kindScored', 'kindRight', 'nestingScored', 'depthRight', 'containerRight', 'wholeRight'] as const
// The counts that the parser does not decide, and the right depths, which are the same in the two parsers.
const countsOfBothParsers = ['cases', 'nothingToRecover', 'scored', 'kindScored', 'nestingScored', 'depthRight'] as const

// The parts of a score of the written set under their names, with one part per writer's file.
const partsOf = (scores: WrittenScores): Map<string, WrittenScore> =>
  new Map([['all', scores.all], ['generatorKinds', scores.generatorKinds], ['otherDamage', scores.otherDamage], ['unmarked', scores.unmarked], ...[...scores.perFile].map(([file, score]) => [`perFile ${file}`, score] as const)])

// The counts in which two scores of the written set differ, e.g. "all, fullAgreement, right: 4283 and 4265". A part
// that only one of the two has is one difference.
function differingCounts(first: WrittenScores, second: WrittenScores, names: readonly (keyof Score)[] = countNames): string[] {
  const [firstParts, secondParts] = [partsOf(first), partsOf(second)]
  const differences: string[] = []
  for (const part of new Set([...firstParts.keys(), ...secondParts.keys()])) {
    const [ofFirst, ofSecond] = [firstParts.get(part), secondParts.get(part)]
    if (ofFirst === undefined || ofSecond === undefined) {
      differences.push(`${part}: only one of the two has the part`)
      continue
    }
    for (const way of ['fullAgreement', 'agreedCodePoints'] as const) {
      for (const name of names) if (ofFirst[way][name] !== ofSecond[way][name]) differences.push(`${part}, ${way}, ${name}: ${ofFirst[way][name]} and ${ofSecond[way][name]}`)
    }
  }
  return differences
}
const comparedCounts = (scores: WrittenScores, names: readonly (keyof Score)[] = countNames) => partsOf(scores).size * 2 * names.length

const sharesAsText = (score: Score) => `${(100 * sharesOfWritten(score).codePoints).toFixed(1)} / ${(100 * sharesOfWritten(score).wholeCases).toFixed(1)}`
const countsAsText = (score: Score) => `${score.right} of ${score.scored} code points and ${score.wholeRight} of ${score.cases - score.nothingToRecover} cases`
// The shares of the cases with full agreement, code points and whole cases: as the set's README has them, which are
// the plain table parser's, and as the exact parser gives them.
const sharesInTheReadme: Record<ReaderOfTheSet, string> = {now: '22.0 / 2.3', stay: '50.4 / 18.1', resync: '62.5 / 45.1', words: '75.6 / 49.8', lines: '76.1 / 50.2'}
const sharesOfTheExactParser: Record<ReaderOfTheSet, string> = {now: '22.1 / 2.3', stay: '50.7 / 18.6', resync: '62.8 / 45.6', words: '75.9 / 50.2', lines: '76.3 / 50.7'}

const cases = writtenCases()
const readers = readersOfTheSet.map(reader => {
  const plain: ParserTables = reader === 'now' ? defaultTables : handRuleTables(reader)
  // What ../../written/score.ts counts, with its own reading of the set.
  return {reader, plain, tables: tablesOfReader(reader), ofTheSet: scoreTablesOfTheSet(plain)}
})
const withPlainParser = (plain: ParserTables) => (writtenCase: WrittenCase) => runTableParser(writtenCase.broken, plain)
const withExactParser = (tables: RecoveryTables) => {
  const shown = exactParserWith(tables)
  return (writtenCase: WrittenCase) => shown(writtenCase.broken)
}

// 1. The counting.
{
  let compared = 0
  for (const {reader, plain, ofTheSet} of readers) {
    const counted = scoreWrittenWith(cases, withPlainParser(plain))
    const differences = differingCounts(counted, ofTheSet)
    compared += comparedCounts(ofTheSet)
    check(differences.length === 0, `${reader}: with the plain table parser, the counting of written-score.ts differs from written/score.ts in ${differences.length} counts, e.g. ${differences[0]}`)
    check(sharesAsText(counted.all.fullAgreement) === sharesInTheReadme[reader], `${reader}: the plain table parser has ${sharesAsText(counted.all.fullAgreement)} on the cases with full agreement, and the set's README says ${sharesInTheReadme[reader]}`)
  }
  const all = readers[0]!.ofTheSet.all
  check(cases.length === 240 && all.agreedCodePoints.cases === 240 && all.fullAgreement.cases === 221 && all.fullAgreement.scored === 19343 && readers[0]!.ofTheSet.perFile.size === 6, `the written set has ${cases.length} cases, ${all.fullAgreement.cases} of them with full agreement and ${all.fullAgreement.scored} scored code points, in ${readers[0]!.ofTheSet.perFile.size} files`)
  console.log(`1. The written set: ${cases.length} cases in ${readers[0]!.ofTheSet.perFile.size} writers' files, ${all.fullAgreement.cases} with full agreement, ${all.fullAgreement.scored} scored code points in them. With the plain table parser in the exact parser's place, the counting of written-score.ts gives the counts of written/score.ts for each of the ${readers.length} tables: ${compared} counts, in the whole set, the two parts of kinds.txt, the cases that nobody marked and each writer's file. Code points right and whole cases, in percent of the cases with full agreement: ${readers.map(({reader, ofTheSet}) => `${reader} ${sharesAsText(ofTheSet.all.fullAgreement)}`).join(', ')}, as in the set's README.`)
}

// 2. The exact parser against the plain table parser.
{
  console.log('2. The exact parser against the plain table parser on the written set, per tables. Shares are code points right and whole cases, in percent of the cases with full agreement.')
  for (const {reader, plain, tables, ofTheSet} of readers) {
    const tally = {codePoints: 0, otherFirstError: 0, otherDepth: 0, otherContainer: 0, otherKind: 0, differentBeforeAnotherContext: 0, casesWithAnotherContext: 0}
    const shownTheSame: WrittenCase[] = []
    const shownOtherwise: WrittenCase[] = []
    for (const writtenCase of cases) {
      const expected = runTableParser(writtenCase.broken, plain)
      const {codePoints, truncated} = codePointsOf(writtenCase.broken)
      const trace = runRecoveryParser(codePoints, truncated, tables)
      if (trace.firstErrorPosition !== writtenCase.firstErrorPosition || trace.firstErrorKind !== writtenCase.firstErrorKind) tally.otherFirstError++
      // Whether a code point so far read another context in the two parsers.
      let anotherContext = false
      let differs = false
      for (let position = 0; position < codePoints.length; position++) {
        tally.codePoints++
        if (!anotherContext && trace.context[position] !== expected.context[position]) {
          anotherContext = true
          tally.casesWithAnotherContext++
        }
        const otherKind = trace.displayKind[position] !== expected.displayKind[position]
        const otherDepth = trace.depthAfter[position] !== expected.depthAfter[position]
        const otherContainer = trace.containerAfter[position] !== expected.containerAfter[position]
        if (otherKind) tally.otherKind++
        if (otherDepth) tally.otherDepth++
        if (otherContainer) tally.otherContainer++
        // The container after a code point is the context of the next one, so it may differ one code point before
        // the first other context. The display kind may not.
        if (!anotherContext && otherKind) tally.differentBeforeAnotherContext++
        if (otherKind || otherDepth || otherContainer) differs = true
      }
      (differs ? shownOtherwise : shownTheSame).push(writtenCase)
    }
    check(tally.otherFirstError === 0, `${reader}: the exact parser has another first error than the case in ${tally.otherFirstError} cases`)
    check(tally.otherDepth === 0, `${reader}: ${tally.otherDepth} code points have another depth in the exact parser than in the plain table parser`)
    check(tally.differentBeforeAnotherContext === 0, `${reader}: ${tally.differentBeforeAnotherContext} code points have another display kind before the two parsers read another context`)
    check(shownOtherwise.length > 0 && shownTheSame.length > 200, `${reader}: the two parsers show something else in ${shownOtherwise.length} of ${cases.length} cases, and this check expects a few`)
    // Where the two parsers show the same, the two scorers count the same.
    const ofTheSameCases = differingCounts(scoreWrittenWith(shownTheSame, withExactParser(tables)), scoreTablesOfTheSet(plain, shownTheSame))
    check(ofTheSameCases.length === 0, `${reader}: over the ${shownTheSame.length} cases in which the two parsers show the same, scoreWritten's counting differs from written/score.ts in ${ofTheSameCases.length} counts, e.g. ${ofTheSameCases[0]}`)
    // Over the whole set, what the parser does not decide is the same, and so are the right depths.
    const exact = scoreWritten(tables)
    const ofBothParsers = differingCounts(exact, ofTheSet, countsOfBothParsers)
    check(ofBothParsers.length === 0, `${reader}: scoreWritten differs from written/score.ts in ${ofBothParsers.length} counts that do not depend on the parser, e.g. ${ofBothParsers[0]}`)
    const [ofExact, ofPlain] = [exact.all.fullAgreement, ofTheSet.all.fullAgreement]
    check(sharesAsText(ofExact) === sharesOfTheExactParser[reader], `${reader}: the exact parser has ${sharesAsText(ofExact)} on the cases with full agreement, and this check expects ${sharesOfTheExactParser[reader]}`)
    check(ofExact.right > ofPlain.right && ofExact.wholeRight >= ofPlain.wholeRight, `${reader}: the exact parser has ${countsAsText(ofExact)} right, and the plain table parser ${countsAsText(ofPlain)}`)
    console.log(`   ${reader}: the same first error in all ${cases.length} cases, the same depth at all ${tally.codePoints} code points, and no other display kind before another context. In ${tally.casesWithAnotherContext} cases a code point reads another context, since the real stack and the running sum disagree about a container. The two parsers show something else in ${shownOtherwise.length} cases (${shownOtherwise.map(writtenCase => writtenCase.id).join(', ')}): another container at ${tally.otherContainer} code points and another display kind at ${tally.otherKind}. Over the other ${shownTheSame.length} cases, scoreWritten's counting gives the ${comparedCounts(ofTheSet)} counts of written/score.ts. Over all cases, the ${comparedCounts(ofTheSet, countsOfBothParsers)} counts that the parser does not decide are the same. The exact parser: ${sharesAsText(ofExact)}, ${countsAsText(ofExact)}. The plain table parser: ${sharesAsText(ofPlain)}, ${countsAsText(ofPlain)}.`)
  }
}

// Cases that are made up here, so that tables with a changed cell or with added structure can be scored: on the
// written set they may not be. The first three have no closing bracket that does not match: a missing comma, strings
// in single quotes, and a missing comma at a line's end. The fourth has a } where a ] closes an array.
const madeUp = [
  {intended: '{"a": 1, "b": [true, null]}', broken: '{"a": 1 "b": [true, null]}', kinds: ['missingComma']},
  {intended: '{"name": "Ada", "tags": ["x", "y"]}', broken: '{\'name\': \'Ada\', \'tags\': [\'x\', \'y\']}', kinds: ['singleQuotedString']},
  {intended: '{\n  "port": 8080,\n  "host": "db"\n}', broken: '{\n  "port": 8080\n  "host": "db"\n}', kinds: ['missingComma']},
  {intended: '{"a": [1], "b": 2}', broken: '{"a": [1}, "b": 2}', kinds: ['wrongCloser']},
].map(({intended, broken, kinds}, at) => caseOf({id: `made-up-${at + 1}`, from: 'made up in final/check.ts', note: undefined, debatable: false, intended, broken}, 'made-up.txt', [], [], [], {kinds, other: undefined}))
const withMatchingBrackets = madeUp.slice(0, 3)
const withAWrongCloser = madeUp.slice(3)

// 3. The comparisons can fail.
{
  // On the written set, with the five tables alone: the counts of one are not the counts of another.
  let pairs = 0
  let pairsThatDiffer = 0
  for (const first of readers) {
    for (const second of readers) {
      if (first === second) continue
      pairs++
      if (differingCounts(scoreWrittenWith(cases, withPlainParser(first.plain)), second.ofTheSet).length > 0) pairsThatDiffer++
    }
  }
  check(pairsThatDiffer === pairs, `on the written set, the counts of one of the five tables are the counts of another in ${pairs - pairsThatDiffer} of ${pairs} pairs, so the comparison of part 1 cannot tell tables apart`)

  // One changed cell, on the made-up cases: the grammar cell that the exact parser reads at the first error of the
  // first case, a string where a comma or a closing bracket should come. It takes the state `colon`, which reads
  // the string as the next key, or the state `error` where it holds `colon` already.
  const [firstCase] = withMatchingBrackets as [WrittenCase]
  const changes: string[] = []
  for (const {reader, plain, tables} of readers) {
    const ofThePlainParser = scoreTablesOfTheSet(plain, withMatchingBrackets)
    const unchanged = differingCounts(scoreWrittenWith(withMatchingBrackets, withExactParser(tables)), ofThePlainParser)
    check(unchanged.length === 0, `${reader}: on the made-up cases without a closing bracket that does not match, the exact parser's counts differ from the plain table parser's in ${unchanged.length} counts, e.g. ${unchanged[0]}`)
    const changed = copyTables(tables)
    const cell = runRecoveryParser(codePointsOf(firstCase.broken).codePoints, false, tables).grammarCell[firstCase.firstErrorPosition]!
    changed.grammarNext[cell] = changed.grammarNext[cell] === grammarStateNames.indexOf('colon') ? changed.errorState : grammarStateNames.indexOf('colon')
    const withTheChange = differingCounts(scoreWrittenWith(withMatchingBrackets, withExactParser(changed)), ofThePlainParser)
    check(tables.grammarOpen[cell] === 1 && withTheChange.length > 0, `${reader}: with one changed open cell, the exact parser's counts on the made-up cases are still the plain table parser's, so the comparison cannot fail`)
    const refusal = errorOf(() => scoreWritten(changed))
    check(refusal !== undefined && refusal.includes('RECOVERY_FINAL'), `${reader}: scoreWritten of the tables with one changed cell says ${JSON.stringify(refusal)}`)
    changes.push(`${reader} ${withTheChange.length}`)
    const exactOnTheWrongCloser = scoreWrittenWith(withAWrongCloser, withExactParser(tables)).all.fullAgreement
    const plainOnTheWrongCloser = scoreTablesOfTheSet(plain, withAWrongCloser).all.fullAgreement
    check(exactOnTheWrongCloser.scored === 10 && plainOnTheWrongCloser.scored === 10 && exactOnTheWrongCloser.right > plainOnTheWrongCloser.right, `${reader}: of the made-up case with a wrong closing bracket, the exact parser has ${exactOnTheWrongCloser.right} of ${exactOnTheWrongCloser.scored} code points right and the plain table parser ${plainOnTheWrongCloser.right} of ${plainOnTheWrongCloser.scored}`)
  }
  const wordsOnTheWrongCloser = [scoreWrittenWith(withAWrongCloser, withExactParser(tablesOfReader('words'))).all.fullAgreement.right, scoreTablesOfTheSet(handRuleTables('words'), withAWrongCloser).all.fullAgreement.right]
  console.log(`3. On the written set, the counts of one of the five tables differ from the counts of another in ${pairsThatDiffer} of ${pairs} pairs. On ${withMatchingBrackets.length} made-up cases without a closing bracket that does not match, the exact parser's counts are the plain table parser's for each of the five tables, and with one changed open cell they differ, in so many counts: ${changes.join(', ')}. scoreWritten refuses each of the changed tables on the written set. Of the made-up case ${JSON.stringify(withAWrongCloser[0]!.broken)}, the hand rule words has ${wordsOnTheWrongCloser[0]} of 10 scored code points right in the exact parser and ${wordsOnTheWrongCloser[1]} in the plain table parser.`)
}

// Tables with every kind of added structure, as ../check-commands.ts makes them: a class for the apostrophe, open
// entries of the display table, the bit "first on its line", two added tokenizer states and one added grammar state.
const withStructure = addStates(addFirstOnLineBit(openDisplayEntries(addClasses(asIsTables(), [{name: 'apostrophe', codePoints: [0x27]}]))), 2, [grammarStateNames.indexOf('colon')])
const withRandomCells = [72, 73].map(stream => {
  const tables = copyTables(withStructure)
  randomizeOpenCells(tables, createRandom(20261015, stream))
  return tables
})

// 4. Added structure, and the refusals.
{
  const unchanged = differingCounts(scoreWrittenWith(madeUp, withExactParser(withStructure)), scoreWrittenWith(madeUp, withExactParser(asIsTables())))
  check(unchanged.length === 0, `tables with added structure and no changed cell give the made-up cases other counts than today's tables, in ${unchanged.length} counts, e.g. ${unchanged[0]}`)
  let inAddedClass = 0
  let withTheBit = 0
  for (const writtenCase of madeUp) {
    const {codePoints} = codePointsOf(writtenCase.broken)
    const trace = runRecoveryParser(codePoints, false, withStructure)
    for (let position = 0; position < codePoints.length; position++) {
      if (trace.characterClass[position]! >= today.classCount) inAddedClass++
      if (trace.context[position]! >= today.contextCount) withTheBit++
    }
  }
  const apostrophes = madeUp.reduce((total, writtenCase) => total + writtenCase.broken.split('\'').length - 1, 0)
  check(inAddedClass === apostrophes && apostrophes > 0 && withTheBit > 0, `on the made-up cases, ${inAddedClass} code points read the added class, where the texts have ${apostrophes} apostrophes, and ${withTheBit} read a context with the bit "first on its line"`)
  const random = withRandomCells.map(tables => scoreWrittenWith(madeUp, withExactParser(tables)).all.fullAgreement)
  const todays = scoreWrittenWith(madeUp, withExactParser(asIsTables())).all.fullAgreement
  check(random.every(score => score.scored === todays.scored && score.cases === madeUp.length) && random.some(score => score.right !== todays.right), `tables with added structure and random open cells have ${random.map(score => `${score.right} of ${score.scored}`).join(' and ')} code points of the made-up cases right, and today's tables ${todays.right} of ${todays.scored}`)
  // What may be scored on the written set before the final run: the first five baselines, and nothing else.
  const baselines = baselineTables()
  const allowed = baselines.map(({tables}) => scoredOnTheSetAlready(tables))
  check(baselines.length === 6 && allowed.join() === 'true,true,true,true,true,false', `of the baselines (${baselines.map(baseline => baseline.name).join('; ')}), scoredOnTheSetAlready says ${allowed.join()}`)
  const refusals = [withStructure, ...withRandomCells, handwrittenTables().tables].map(tables => errorOf(() => scoreWritten(tables)))
  check(refusals.every(refusal => refusal !== undefined && refusal.includes('RECOVERY_FINAL')), `scoreWritten of tables with added structure and of the hand-written tables says ${JSON.stringify(refusals)}`)
  // A text that is cut at 512 code points is refused, and a text of 512 code points is not: an array of 255 numbers,
  // and a string of 510 emoji, which is 512 code points and 1,022 UTF-16 code units.
  const shown = exactParserWith(asIsTables())
  const arrayOf512 = `[${'1,'.repeat(254)}12]`
  const stringOf512 = `"${'\u{1F600}'.repeat(510)}"`
  const tooLong = [`${arrayOf512} `, `[${arrayOf512}]`, `${stringOf512} `].map(text => errorOf(() => shown(text)))
  const longEnough = [arrayOf512, stringOf512].map(text => errorOf(() => shown(text)))
  check([arrayOf512, stringOf512].every(text => Array.from(text).length === 512) && tooLong.every(refusal => refusal !== undefined && refusal.includes('512 code points')) && longEnough.every(refusal => refusal === undefined),
    `the exact parser of the scorer says ${JSON.stringify(tooLong)} for texts of 513 and 514 code points, and ${JSON.stringify(longEnough)} for texts of 512`)
  console.log(`4. Tables with an added class, open display entries, the bit "first on its line" and added states: with no cell changed they give the ${madeUp.length} made-up cases the counts of today's tables, ${inAddedClass} code points read the added class and ${withTheBit} a context with the bit. With random open cells they have ${random.map(score => `${score.right} of ${score.scored}`).join(' and ')} code points right, where today's tables have ${todays.right}. Of the 6 baselines, the first 5 may be scored on the written set before the final run. scoreWritten refuses the hand-written tables and the ${1 + withRandomCells.length} tables with added structure, and names RECOVERY_FINAL. The exact parser of the scorer refuses ${tooLong.length} texts of 513 and 514 code points, and runs ${longEnough.length} texts of 512, one of them a string of 510 emoji.`)
}

// The commands run from the repo root, without RECOVERY_FINAL.
const root = resolve(import.meta.dir, '../../../..')
const here = relative(root, import.meta.dir)
const environment = {...process.env}
delete environment['RECOVERY_FINAL']
const run = (script: string, parameters: readonly string[]) => {
  const result = Bun.spawnSync(['bun', join(here, script), ...parameters], {cwd: root, env: environment, stdout: 'pipe', stderr: 'pipe'})
  return {exitCode: result.exitCode, stdout: result.stdout.toString(), output: `${result.stdout.toString()}${result.stderr.toString()}`}
}
// What a command of this folder must leave as it is, unless it is a final run: the log of the final runs, and the
// cache folder, where a run that loads the test split would write a file of its own.
const logFile = join(scratch, 'arms', 'final-runs.log')
const stateOfTheScratchFolder = () => `${existsSync(logFile) ? statSync(logFile).size : 'no log'}; ${readdirSync(cacheFolderOf(scratch)!).sort().join(', ')}`
const stateBefore = stateOfTheScratchFolder()

const folder = join(scratch, 'final', 'check')
mkdirSync(folder, {recursive: true})
const validation = validationOfTheStandardSet()
const percent = (share: number, digits = 2) => Number.isNaN(share) ? '-' : (100 * share).toFixed(digits)
// The mean, the lowest and the highest as a row of the report has them, worked out here.
const spreadAsText = (shares: readonly number[], digits = 2) => shares.length === 1 ? percent(shares[0]!, digits)
  : `${percent(shares.reduce((total, share) => total + share, 0) / shares.length, digits)} (${percent(Math.min(...shares), digits)} to ${percent(Math.max(...shares), digits)})`
const withinReach = 'group: within reach of the tables'
const rowNamed = (rows: readonly ScoreRow[], name: string) => rows.find(row => row.name === name)!

// 5. The dry run of run.ts.
{
  const handRuleFiles = (['stay', 'resync', 'words', 'lines'] as const).map(rule => {
    saveTables(join(folder, `${rule}.json`), tablesOfReader(rule), `final/check.ts: the hand rule ${rule}`)
    return {file: `${rule}.json`, tables: tablesOfReader(rule)}
  })
  const structureFiles = withRandomCells.map((tables, at) => {
    saveTables(join(folder, `structure-${at + 1}.json`), tables, 'final/check.ts: added structure and random open cells')
    return {file: `structure-${at + 1}.json`, tables}
  })
  const entries = [
    {name: 'three hand rules as seeds', description: 'toy tables of final/check.ts', tables: handRuleFiles.slice(0, 3).map(({file}) => file), confirmationTables: [handRuleFiles[3]!.file]},
    // One file by its absolute path: the other paths are read from the list's folder.
    {name: 'added structure, random cells', description: 'toy tables of final/check.ts', tables: [structureFiles[0]!.file, join(folder, structureFiles[1]!.file)]},
  ]
  const listFile = join(folder, 'check-list.json')
  writeFileSync(listFile, `${JSON.stringify(entries, null, 1)}\n`)
  const reportFile = join(scratch, 'final', 'check-list.dry-run.report.md')
  const countsFile = join(scratch, 'final', 'check-list.dry-run.counts.json')
  const dryRun = run('run.ts', ['--dry-run', listFile])
  check(dryRun.exitCode === 0, `run.ts --dry-run ends with the exit code ${dryRun.exitCode}: ${dryRun.output.slice(-400)}`)
  const printed = dryRun.stdout.trimEnd().split('\n')
  const written = existsSync(reportFile) ? readFileSync(reportFile, 'utf8').trimEnd().split('\n') : []
  check(printed.length > 50 && printed.every(line => line.startsWith(dryRunMark)) && written.length > 50 && written.every(line => line.startsWith(dryRunMark)), `a line that run.ts --dry-run prints or writes into its report does not start with ${JSON.stringify(dryRunMark)}`)
  check(written.every((line, at) => line === printed[at]), 'the report file of the dry run does not hold the lines that the run prints')
  check(!existsSync(join(scratch, 'final', 'check-list.report.md')) && !existsSync(join(scratch, 'final', 'check-list.counts.json')), 'a dry run wrote the files of a final run')

  // The report's sections, and the cells of a row of a section's table.
  const lines = written.map(line => line.slice(dryRunMark.length))
  const sectionOf = (heading: string) => {
    const from = lines.indexOf(heading)
    const length = lines.slice(from + 1).findIndex(line => line.startsWith('#'))
    return from === -1 ? [] : lines.slice(from + 1, length === -1 ? undefined : from + 1 + length)
  }
  const cellsOf = (section: readonly string[], name: string) => section.find(line => line.startsWith(`| ${name} | `))?.split(' | ').slice(1).map(cell => cell.replace(/ \|$/, '')) ?? []
  const namesOf = (section: readonly string[]) => section.filter(line => line.startsWith('| ') && !line.startsWith('| tables | ') && !line.startsWith('| --- ')).map(line => line.split(' | ')[0]!.slice(2))
  const validationSection = sectionOf('## The validation split')
  const writtenSection = sectionOf('## The written set')
  const baselines = baselineTables()
  const rowNames = [...baselines.map(baseline => baseline.name), 'three hand rules as seeds', 'three hand rules as seeds, confirmation files', 'added structure, random cells']
  check(namesOf(validationSection).join('; ') === rowNames.join('; ') && namesOf(writtenSection).join('; ') === rowNames.join('; '), `the rows of the dry run's report are ${namesOf(validationSection).join('; ')}, and the baselines come first, then the entries of the list, each before its confirmation files`)

  // The validation split: every row against scores made here.
  const rowsOfTheReport: {name: string, tables: RecoveryTables[]}[] = [
    ...baselines.map(({name, tables}) => ({name, tables: [tables]})),
    {name: rowNames[6]!, tables: handRuleFiles.slice(0, 3).map(({tables}) => tables)}, {name: rowNames[7]!, tables: [handRuleFiles[3]!.tables]}, {name: rowNames[8]!, tables: structureFiles.map(({tables}) => tables)},
  ]
  const scoresOfRows = rowsOfTheReport.map(({name, tables}) => ({name, tables, scores: tables.map(ofRow => scoreTables(ofRow, validation).rows)}))
  let wrongValidationRows = 0
  for (const {name, scores} of scoresOfRows) {
    const expected = [
      spreadAsText(scores.map(rows => sharesOf(rowNamed(rows, 'all')).allThree)), spreadAsText(scores.map(rows => sharesOf(rowNamed(rows, withinReach)).allThree)), spreadAsText(scores.map(rows => sharesOf(rowNamed(rows, 'all')).whole)),
    ]
    if (cellsOf(validationSection, name).join(' | ') !== expected.join(' | ')) wrongValidationRows++
  }
  const threeHandRules = cellsOf(validationSection, rowNames[6]!)
  check(wrongValidationRows === 0 && /^\d+\.\d\d \(\d+\.\d\d to \d+\.\d\d\)$/.test(threeHandRules[0] ?? '') && cellsOf(validationSection, baselines[0]!.name)[0] === '42.69', `${wrongValidationRows} rows of the dry run's validation table are not the mean, the lowest and the highest of scoreTables for the row's tables. The row of the three hand rules is ${JSON.stringify(threeHandRules)}`)

  // Every count, from the file of counts.
  const counts = existsSync(countsFile) ? JSON.parse(readFileSync(countsFile, 'utf8')) as {dryRun: boolean, datasetKey: string, rows: RowCounts[]} : {dryRun: false, datasetKey: '', rows: []}
  check(counts.dryRun && counts.datasetKey === datasetKey() && counts.rows.map(row => row.name).join('; ') === rowNames.join('; ') && counts.rows.every((row, at) => row.tables.length === rowsOfTheReport[at]!.tables.length), 'the file of counts of the dry run does not say that it is a dry run, or does not hold the rows of the report with one entry per tables')
  check(counts.rows.slice(6).every(row => row.tables.every(ofTables => ofTables.file !== null && ofTables.file.startsWith(folder) && ofTables.hash === Bun.hash(readFileSync(ofTables.file)).toString(16))) && counts.rows.slice(0, 6).every(row => row.tables[0]!.file === null), 'the file of counts does not hold the path and the hash of every file of tables')
  // The validation samples with the held-out bits of a dry run, made here by the rule that run.ts states: of every
  // 10 samples, by place, 4 have nothing held out, 1 a kind, 3 the template and 2 both. One score of them has the
  // four rows that ../arms/final.ts prints.
  const both = heldOutByKind | heldOutByTemplate
  const bits = [0, 0, 0, 0, heldOutByKind, heldOutByTemplate, heldOutByTemplate, heldOutByTemplate, both, both]
  const relabeled: Samples = {...validation, withTest: true, heldOut: validation.heldOut.map((_, place) => bits[place % 10]!)}
  const sameCounts = (first: ScoreRow | undefined, second: ScoreRow | undefined) => first !== undefined && second !== undefined && Object.keys(first).every(count => count === 'name' || first[count as keyof ScoreRow] === second[count as keyof ScoreRow])
  let wrongParts = 0
  let wrongWholeSplits = 0
  let wrongValidationCounts = 0
  let comparedRows = 0
  for (const [at, {tables}] of scoresOfRows.entries()) {
    for (const [seed, ofRow] of tables.entries()) {
      const ofTables = counts.rows[at]?.tables[seed]
      if (ofTables === undefined) continue
      const expected = scoreTables(ofRow, relabeled, {splits: ['validation']}).rows
      if (ofTables.test.length !== 5 || ofTables.test.map(part => part.part).join('; ') !== [...heldOutRowNames, wholeSplit].join('; ')) wrongParts++
      for (const [part, heldOutRowName] of heldOutRowNames.entries()) {
        comparedRows++
        if (!sameCounts(ofTables.test[part]?.rows.find(row => row.name === 'all'), {...rowNamed(expected, heldOutRowName), name: 'all'})) wrongParts++
      }
      // The whole split of a dry run is the validation split, row for row.
      const whole = ofTables.test.at(-1)?.rows ?? []
      const ofValidation = scoresOfRows[at]!.scores[seed]!
      if (whole.length < 40 || !ofValidation.every(row => sameCounts(whole.find(candidate => candidate.name === row.name), row))) wrongWholeSplits++
      if (ofTables.validation.length !== ofValidation.length || !ofValidation.every((row, rowAt) => ofTables.validation[rowAt]!.name === row.name && sameCounts(ofTables.validation[rowAt], row))) wrongValidationCounts++
    }
  }
  check(wrongParts === 0 && comparedRows === 4 * 12, `${wrongParts} of ${comparedRows} parts by made-up held-out bits do not hold the counts of the row that one score of the relabeled validation samples gives, as arms/final.ts counts`)
  check(wrongWholeSplits === 0 && wrongValidationCounts === 0, `the counts of the whole split are not the validation split's for ${wrongWholeSplits} tables, and the validation counts are not the rows of scoreTables for ${wrongValidationCounts}`)
  // The report's tables of the parts, for the row of the three hand rules.
  const partsOfTheHandRules = heldOutRowNames.map((heldOutRowName, part) => {
    const scores = handRuleFiles.slice(0, 3).map(({tables}) => scoreTables(tables, relabeled, {splits: ['validation']}).rows)
    const ofThePart = counts.rows[6]?.tables.map(ofTables => ofTables.test[part]!.rows) ?? []
    const expected = [
      spreadAsText(scores.map(rows => sharesOf(rowNamed(rows, heldOutRowName)).allThree)), spreadAsText(ofThePart.map(rows => sharesOf(rowNamed(rows, withinReach)).allThree)),
      spreadAsText(scores.map(rows => sharesOf(rowNamed(rows, heldOutRowName)).whole)),
    ]
    return cellsOf(sectionOf(`### ${heldOutRowName[0]!.toUpperCase()}${heldOutRowName.slice(1)}`), rowNames[6]!).join(' | ') === expected.join(' | ')
  })
  check(partsOfTheHandRules.every(same => same) && cellsOf(sectionOf('### The whole split'), rowNames[6]!).join(' | ') === threeHandRules.join(' | '), `the tables of the four parts hold the row of the three hand rules as worked out here in ${partsOfTheHandRules.filter(same => same).length} of 4 parts, or the table of the whole split does not hold the validation row`)
  const brokenWith = [0, heldOutByKind, heldOutByTemplate, both].map(wanted => relabeled.heldOut.reduce((total, held, place) => total + Number(held === wanted && validation.firstDamage[place] !== -1), 0))

  // The written set: numbers for the five tables, and for nothing else.
  const partsOfTheSet = ['all', 'generatorKinds', 'otherDamage'] as const
  const writtenCells = (tables: readonly RecoveryTables[]) => {
    const scores = tables.map(ofRow => scoreWritten(ofRow))
    return partsOfTheSet.flatMap(part => [spreadAsText(scores.map(score => sharesOfWritten(score[part].fullAgreement).codePoints)), spreadAsText(scores.map(score => sharesOfWritten(score[part].fullAgreement).wholeCases), 1)])
  }
  const leftForTheFinalRun = Array.from({length: 6}, () => 'left for the final run').join(' | ')
  const scoredRows = scoresOfRows.filter(({tables}) => tables.every(scoredOnTheSetAlready))
  const wrongWrittenRows = scoresOfRows.filter(({name, tables}) => cellsOf(writtenSection, name).join(' | ') !== (tables.every(scoredOnTheSetAlready) ? writtenCells(tables).join(' | ') : leftForTheFinalRun))
  check(wrongWrittenRows.length === 0 && scoredRows.length === 7, `the dry run's table of the written set has ${wrongWrittenRows.length} rows that are not scoreWritten's numbers for the five tables and "left for the final run" for the others: ${wrongWrittenRows.map(row => row.name).join('; ')}`)
  let wrongWrittenCounts = 0
  for (const [at, {tables}] of scoresOfRows.entries()) {
    for (const [seed, ofRow] of tables.entries()) {
      const ofTables = counts.rows[at]?.tables[seed]
      if (ofTables === undefined) continue
      const expected = scoredOnTheSetAlready(ofRow) ? scoreWritten(ofRow) : null
      if (JSON.stringify(ofTables.written) !== JSON.stringify(expected === null ? null : {...expected, perFile: Object.fromEntries(expected.perFile)})) wrongWrittenCounts++
    }
  }
  check(wrongWrittenCounts === 0, `the file of counts holds other counts of the written set than scoreWritten for ${wrongWrittenCounts} tables, or counts for tables that a dry run may not score there`)
  check(stateOfTheScratchFolder() === stateBefore, `the dry run changed the log of the final runs or the cache folder: ${stateBefore} before, ${stateOfTheScratchFolder()} after`)
  // The report as a final run words it, made here from the dry run's counts: the same tables, and no word of a dry
  // run. Only the lines that say what was scored differ.
  const asAFinalRun = counts.rows.length === 0 ? [] : describeReport(counts.rows, {dryRun: false, time: new Date(), listFile, countsFile})
  const tableLines = (ofReport: readonly string[]) => ofReport.filter(line => line.startsWith('| ') || line.startsWith('#')).slice(1)
  check(asAFinalRun[0] === '# The final scores of the recovery experiment' && !asAFinalRun.some(line => line.toLowerCase().includes('dry run')) && tableLines(asAFinalRun).length > 50 && tableLines(asAFinalRun).join('\n') === tableLines(lines).join('\n'),
    'the report that describeReport words as a final run names a dry run, or does not hold the tables of the dry run\'s report')
  console.log(`5. run.ts --dry-run on a list of toy tables: ${printed.length} lines, each marked as a dry run, and the same lines in the report file. Worded as a final run, the report of the same counts has the same ${tableLines(asAFinalRun).length} lines of tables and headings and names no dry run. The ${baselines.length} baselines come first. The row of three hand rules as seeds is ${threeHandRules.join(' | ')} on the validation split, as worked out here, and the ${rowNames.length} rows of the validation table and of the written set's table are the numbers of scoreTables and of scoreWritten. The four parts by made-up held-out bits hold ${brokenWith.join(', ')} broken samples, as one score of the relabeled samples counts them for ${comparedRows / 4} tables, and the whole split is the validation split, row for row. On the written set ${scoredRows.length} rows have numbers and ${rowNames.length - scoredRows.length} say "left for the final run". The log of the final runs and the cache folder are as before.`)

  // What run.ts refuses.
  const withoutDryRun = run('run.ts', [listFile])
  check(withoutDryRun.exitCode !== 0 && withoutDryRun.output.includes('final/run.ts reads the test split') && withoutDryRun.output.includes('RECOVERY_FINAL'), `run.ts without --dry-run and without RECOVERY_FINAL ${withoutDryRun.exitCode === 0 ? 'runs' : `fails with: ${withoutDryRun.output.slice(-300)}`}`)
  const keyLine = `  "datasetKey": ${JSON.stringify(datasetKey())},\n`
  const ofThisDataset = readFileSync(join(folder, 'stay.json'), 'utf8')
  check(ofThisDataset.includes(keyLine), 'a saved file of tables does not hold the dataset\'s key')
  writeFileSync(join(folder, 'another-dataset.json'), ofThisDataset.replace(keyLine, '  "datasetKey": "0123456789abcdef",\n'))
  const refusedLists: [name: string, entries: unknown, says: string][] = [
    ['a file of another dataset', [{name: 'old tables', description: '', tables: ['stay.json', 'another-dataset.json']}], 'was saved with the dataset 0123456789abcdef'],
    ['an unknown field', [{name: 'misspelled', description: '', tables: ['stay.json'], confirmationTable: ['lines.json']}], 'has the field "confirmationTable"'],
    ['a name twice', [{name: 'twice', description: '', tables: ['stay.json']}, {name: 'twice', description: '', tables: ['lines.json']}], 'would have the name "twice"'],
    ['a file twice', [{name: 'one seed twice', description: '', tables: ['stay.json', 'stay.json']}], 'twice: two files of one seed are one run'],
    // The same file by its name and by its absolute path.
    ['a file in tables and in confirmationTables', [{name: 'one seed in both', description: '', tables: ['stay.json', 'lines.json'], confirmationTables: [join(folder, 'stay.json')]}], 'in "tables" and in "confirmationTables"'],
    ['no tables', [{name: 'empty', description: '', tables: []}], 'needs "tables"'],
  ]
  let refused = 0
  for (const [name, ofList, says] of refusedLists) {
    const file = join(folder, `refused-${name.replaceAll(' ', '-')}.json`)
    writeFileSync(file, `${JSON.stringify(ofList)}\n`)
    const result = run('run.ts', ['--dry-run', file])
    const refusedSo = result.exitCode !== 0 && result.output.includes(says)
    check(refusedSo, `run.ts --dry-run on a list with ${name} ${result.exitCode === 0 ? 'runs' : `fails with: ${result.output.slice(-300)}`}`)
    if (refusedSo) refused++
  }
  check(stateOfTheScratchFolder() === stateBefore, 'a refused run of run.ts changed the log of the final runs or the cache folder')
  // The line that a final run appends to the log, written here under a scratch folder that is made up, so that the
  // log of the final runs stays as it is.
  const madeUpScratch = join(folder, 'a-made-up-scratch-folder')
  appendToTheLogOfFinalRuns(madeUpScratch, new Date(Date.UTC(2026, 9, 16, 12, 0, 0)), 'a made-up line of final/check.ts', [{name: 'mine', file: join(folder, 'stay.json'), hash: 'abc'}])
  const logged = JSON.parse(readFileSync(join(madeUpScratch, 'arms', 'final-runs.log'), 'utf8').trimEnd().split('\n').at(-1)!) as {time: string, datasetKey: string, commit: string, uncommittedChanges: boolean, command: string, tables: {name: string, file: string, hash: string}[]}
  check(logged.time === '2026-10-16T12:00:00.000Z' && logged.datasetKey === datasetKey() && logged.command === 'a made-up line of final/check.ts' && logged.tables.length === 1 && logged.tables[0]!.name === 'mine' && logged.tables[0]!.file === join(folder, 'stay.json') && logged.tables[0]!.hash === 'abc', `the line of a final run in the log is ${JSON.stringify(logged)}`)
  // The commit and the uncommitted changes, as git says them to this check.
  const git = (parameters: readonly string[]) => Bun.spawnSync(['git', ...parameters], {cwd: root, stdout: 'pipe', stderr: 'pipe'}).stdout.toString().trim()
  const [commit, uncommittedChanges] = [git(['rev-parse', 'HEAD']), git(['status', '--porcelain']) !== '']
  check(/^[0-9a-f]{40}$/.test(logged.commit) && logged.commit === commit && logged.uncommittedChanges === uncommittedChanges, `the line of a final run in the log names the commit ${JSON.stringify(logged.commit)} and says ${JSON.stringify(logged.uncommittedChanges)} for uncommitted changes, and git says ${commit} and ${uncommittedChanges}`)
  console.log(`   Without --dry-run and without RECOVERY_FINAL, run.ts refuses by its own first line. A dry run refuses ${refused} of ${refusedLists.length} lists: with ${refusedLists.map(([name]) => name).join(', with ')}. The line that a final run appends to the log holds the time, the dataset's key, the commit of the worktree and whether it has uncommitted changes, as git says both, the command, and the name, the path and the hash of each file: it is written here to a log under ${madeUpScratch}.`)
}

// 6. show.ts.
{
  const show = (parameters: readonly string[]) => run('show.ts', parameters)
  const refusedForFinal = (result: {exitCode: number, output: string}) => result.exitCode !== 0 && result.output.includes('RECOVERY_FINAL')
  const structureFile = join(folder, 'structure-1.json')
  // A case of the written set, with two of the five tables.
  const [firstCase] = cases as [WrittenCase]
  const ofCase = show(['--case', firstCase.id, '--nesting', 'now', 'lines'])
  const rowsOfCase = ofCase.stdout.trimEnd().split('\n')
  const countsOfNow = countText(labelsOfWritten(firstCase), firstCase.firstErrorPosition, exactParserWith(asIsTables())(firstCase.broken))
  const length = Array.from(firstCase.broken).length
  // The rows start after the longest row name, `  container`, and two spaces. A row loses the blanks at its end.
  const nameWidth = '  container'.length + 2
  const lettersOf = (name: string) => rowsOfCase.find(row => row.startsWith(name.padEnd(nameWidth)))?.slice(nameWidth) ?? ''
  check(ofCase.exitCode === 0 && rowsOfCase[0]!.startsWith(`--- ${firstCase.id}  `) && rowsOfCase.includes(`    now: ${countsOfNow.scored - countsOfNow.right} of ${countsOfNow.scored} scored code points are wrong`), `show.ts --case ${firstCase.id} ends with the exit code ${ofCase.exitCode} and does not say how many code points today's tables have wrong: ${ofCase.output.slice(0, 300)}`)
  const labeled = labelsOfWritten(firstCase).findLastIndex(label => label !== undefined) + 1
  check(lettersOf('text') === visible(firstCase.broken).trimEnd() && ['now', 'lines'].every(name => lettersOf(name).length === length) && ['want', 'wantd', 'wantc'].every(name => lettersOf(name).length === labeled)
    && rowsOfCase.filter(row => row.startsWith('  miss')).length === 2 && rowsOfCase.filter(row => row.startsWith('  depth')).length === 2 && lettersOf('first').endsWith('^') && lettersOf('first').length === firstCase.firstErrorPosition + 1,
    `show.ts --case does not print the text and one letter per code point in the rows want, wantd, wantc, now and lines, a row of marks per tables, or the first error at ${firstCase.firstErrorPosition}`)
  const marksOfNow = Array.from((rowsOfCase[rowsOfCase.findIndex(row => row.startsWith('now'.padEnd(nameWidth))) + 3] ?? '').slice(nameWidth)).filter(letter => letter !== ' ').length
  check(marksOfNow === countsOfNow.scored - countsOfNow.right, `the row of marks under today's tables marks ${marksOfNow} code points, and ${countsOfNow.scored - countsOfNow.right} are wrong`)
  const refusedCases = [show(['--case', firstCase.id, 'hand-written']), show(['--case', firstCase.id, 'now', `mine=${structureFile}`])]
  check(refusedCases.every(refusedForFinal) && refusedCases.every(result => !result.output.includes(`--- ${firstCase.id}`)), 'show.ts shows a case of the written set with the hand-written tables or with saved tables, without RECOVERY_FINAL')

  // A sample of the validation split with any tables, and none of the test split. allowedSampleAt gives no sample
  // of the test split, so the first index without a sample is one of the test split.
  const place = validation.firstDamage.findIndex(firstDamage => firstDamage !== -1)
  const validationId = `${standardRange.seed}:${validation.index[place]}`
  const ofSample = show(['--sample', validationId, 'hand-written', `mine=${structureFile}`])
  check(ofSample.exitCode === 0 && ofSample.stdout.startsWith(`--- ${validationId}  split: validation`) && ofSample.stdout.split('\n').filter(row => row.startsWith('  miss')).length === 2, `show.ts --sample ${validationId} ends with the exit code ${ofSample.exitCode}: ${ofSample.output.slice(0, 300)}`)
  let testIndex = 0
  while (allowedSampleAt(standardRange.seed, testIndex) !== undefined) testIndex++
  const ofTestSample = show(['--sample', `${standardRange.seed}:${testIndex}`, 'now'])
  check(refusedForFinal(ofTestSample) && ofTestSample.output.includes('test split') && !ofTestSample.output.includes('---'), `show.ts --sample of the test sample ${testIndex} ${ofTestSample.exitCode === 0 ? 'runs' : `fails with: ${ofTestSample.output.slice(-300)}`}`)

  // --differs: the counts of whole texts are the scorers' counts.
  const wholeOf = (output: string) => /Right as a whole: (\d+) for \S+, (\d+) for \S+, (\d+) for both\./.exec(output)?.slice(1).map(Number) ?? []
  const listed = (output: string) => output.split('\n').filter(line => line.startsWith('  ')).length
  const onTheSet = show(['--differs', 'now', 'lines', 'now', 'lines'])
  const [wholeForNow, wholeForLines] = [scoreWritten(asIsTables()).all.agreedCodePoints.wholeRight, scoreWritten(tablesOfReader('lines')).all.agreedCodePoints.wholeRight]
  const ofTheSet = wholeOf(onTheSet.output)
  check(onTheSet.exitCode === 0 && ofTheSet[0] === wholeForNow && ofTheSet[1] === wholeForLines && listed(onTheSet.output) === Math.min(30, wholeForNow - ofTheSet[2]!) + Math.min(30, wholeForLines - ofTheSet[2]!), `show.ts --differs now lines says that ${ofTheSet.join(', ')} cases are whole for now, for lines and for both, and lists ${listed(onTheSet.output)}. scoreWritten counts ${wholeForNow} and ${wholeForLines}`)
  const onValidation = show(['--differs', 'hand-written', 'mine', '--in', 'validation', '--limit', '4', 'hand-written', `mine=${structureFile}`])
  const wholeOnValidation = [handwrittenTables().tables, withRandomCells[0]!].map(tables => scoreTables(tables, validation, {breakdowns: false}).rows[0]!.wholeSamples)
  const ofValidation = wholeOf(onValidation.output)
  check(onValidation.exitCode === 0 && ofValidation[0] === wholeOnValidation[0] && ofValidation[1] === wholeOnValidation[1] && listed(onValidation.output) === Math.min(4, wholeOnValidation[0]! - ofValidation[2]!) + Math.min(4, wholeOnValidation[1]! - ofValidation[2]!), `show.ts --differs --in validation says that ${ofValidation.join(', ')} samples are whole, and lists ${listed(onValidation.output)}. scoreTables counts ${wholeOnValidation.join(' and ')}`)
  const refusedLists = [show(['--differs', 'now', 'hand-written', 'now', 'hand-written']), show(['--differs', 'now', 'lines', '--in', 'test', 'now', 'lines'])]
  check(refusedLists.every(refusedForFinal), 'show.ts --differs runs on the written set with the hand-written tables, or on the test split, without RECOVERY_FINAL')
  check(stateOfTheScratchFolder() === stateBefore, 'a run of show.ts changed the log of the final runs or the cache folder')
  console.log(`6. show.ts shows the case ${firstCase.id} with today's tables and the hand rule lines: one letter per code point in every row, and ${countsOfNow.scored - countsOfNow.right} marks under today's tables for its ${countsOfNow.scored - countsOfNow.right} wrong code points of ${countsOfNow.scored}. It shows the validation sample ${validationId} with the hand-written tables and with tables with added structure. --differs counts ${ofTheSet[0]} and ${ofTheSet[1]} whole cases of the written set for now and lines, as scoreWritten does, and ${ofValidation[0]} and ${ofValidation[1]} whole validation samples for the hand-written tables and the tables with added structure, as scoreTables does. Without RECOVERY_FINAL it refuses a case with the hand-written tables or with saved tables, the test sample ${standardRange.seed}:${testIndex}, and --differs with the hand-written tables on the written set or on the test split. The log of the final runs and the cache folder are as before.`)
}

// 7. The check of the loaded test split.
{
  const standard = samplesOfTheStandardSet()
  const testSplit = splitNames.indexOf('test')
  const validationSplit = splitNames.indexOf('validation')
  const length = standardRange.to - standardRange.from
  type IndexesAndSplits = {index: Int32Array, split: Uint8Array}
  // A set as loadSamples gives it with the test split, made up from the standard set alone: every index of the
  // range, with the split that the standard set has for it, and the test split for an index that the standard set
  // lacks. No test sample is made for it.
  const madeUpSet = (): IndexesAndSplits => {
    const loaded = {index: Int32Array.from({length}, (_, at) => standardRange.from + at), split: new Uint8Array(length).fill(testSplit)}
    for (let place = 0; place < standard.sampleCount; place++) loaded.split[standard.index[place]! - standardRange.from] = standard.split[place]!
    return loaded
  }
  const countsOf = (loaded: IndexesAndSplits) => {
    const inTest = loaded.split.reduce((total, split) => total + Number(split === testSplit), 0)
    return {inTest, others: loaded.split.length - inTest}
  }
  const asLoaded = madeUpSet()
  const ofTheSet = countsOf(asLoaded)
  const problem = problemOfTheLoadedTestSplit(asLoaded, standard)
  check(problem === undefined && ofTheSet.others === standard.sampleCount && ofTheSet.inTest > 0, `the made-up set with every index of the standard range and ${ofTheSet.inTest} of them in the test split does not pass the check of the loaded test split: ${problem}`)
  // The first place of a sample that the standard set has, and the first of an index that it lacks.
  const kept = asLoaded.split.findIndex(split => split !== testSplit)
  const lacking = asLoaded.split.indexOf(testSplit)
  const changed = (change: (loaded: IndexesAndSplits) => void): IndexesAndSplits => {
    const loaded = madeUpSet()
    change(loaded)
    return loaded
  }
  const faults: [name: string, loaded: IndexesAndSplits, says: string][] = [
    ['one sample of the standard set in the test split and one index that the standard set lacks in the validation split', changed(loaded => { loaded.split[kept] = testSplit; loaded.split[lacking] = validationSplit }), 'where the standard set has'],
    ['an index twice', changed(loaded => { loaded.index[kept + 1] = loaded.index[kept]! }), 'twice'],
    ['the last index left out', {index: asLoaded.index.slice(0, -1), split: asLoaded.split.slice(0, -1)}, 'and not e.g.'],
    ['an index after the range', changed(loaded => { loaded.index[length - 1] = standardRange.to }), 'which is not one of'],
    ['no sample in the test split', changed(loaded => { loaded.split.fill(validationSplit) }), 'holds no sample of the test split'],
    ['one sample of the standard set in the test split', changed(loaded => { loaded.split[kept] = testSplit }), 'samples of the other splits'],
  ]
  let refused = 0
  for (const [name, loaded, says] of faults) {
    const ofFault = problemOfTheLoadedTestSplit(loaded, standard)
    const refusedSo = ofFault !== undefined && ofFault.includes(says)
    check(refusedSo, `a made-up set with ${name} ${ofFault === undefined ? 'passes the check of the loaded test split' : `is refused with: ${ofFault}`}`)
    if (refusedSo) refused++
  }
  // The first fault has the two counts of the set that passes, so a comparison of the counts alone lets it pass.
  const ofTheFirstFault = countsOf(faults[0]![1])
  check(ofTheFirstFault.inTest === ofTheSet.inTest && ofTheFirstFault.others === ofTheSet.others, `the first made-up fault has ${ofTheFirstFault.inTest} and ${ofTheFirstFault.others} samples in and outside the test split, and the set that passes ${ofTheSet.inTest} and ${ofTheSet.others}`)
  console.log(`7. The check of the loaded test split, on arrays made up from the standard set's indexes, without a test sample: the set with every index ${standardRange.from} to ${standardRange.to - 1}, ${ofTheSet.others} of them with the standard set's split and ${ofTheSet.inTest} in the test split, passes. ${refused} of ${faults.length} changed sets are refused: with ${faults.map(([name]) => name).join(', with ')}. The first of them has the same two counts as the set that passes, ${ofTheFirstFault.others} and ${ofTheFirstFault.inTest}.`)
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
