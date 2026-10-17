// HELD BACK: do not read this folder if you build the parser, the train data, the training or its machinery. See
// ../README.md.
//
// The check of ../../RESULTS.md, the record of the TOML track: every number and every example of that file is held
// against the counts of the one final scoring. It trains nothing, changes no table and writes no file.
//
// How it works. For each sentence, table line and example of RESULTS.md that holds a number, this file makes the
// same piece of text again, with the numbers worked out here, and asks that RESULTS.md holds that piece letter by
// letter. Then it takes every piece out of RESULTS.md and asks that no digit is left, apart from the numbers of
// rows, seeds and examples and what stands between backticks. So a number of RESULTS.md that differs from the counts
// fails the check, and so does a number that this file does not know.
//
// Where a number comes from, in the order of how much of it is counted here:
// - "the final counts": worked out here from final.counts.json and dry-run.counts.json, the saved counts of the one
//   final run and of its dry run on the validation split.
// - "every code point": the files of tables are run on the two held-back sets again by ../final/where/load.ts, which
//   stops unless its right code points of every text and parser are the final run's. The breakdown of those code
//   points, e.g. by the line that a code point stands on, is counted here with code of this file.
// - "the final counts, over texts that another file picks": the saved counts per text, summed here over texts that
//   a file of this folder's neighbours picks, e.g. the written cases that ../final/where/tags.ts marks by one
//   reader's judgment, or the payloads whose damage ../written/neutral-edits.ts can make from neutral edits.
// - "recount.txt": the output of the second count, read as text.
// - "a file of the repo": a README or a report says the number, e.g. "39 rules".
//
// Run from the repo root, with RECOVERY_SCRATCH set to the scratch folder of the TOML track, i.e. the folder outside
// the repo that holds runs/, handwritten/ and held-back/:
//   RECOVERY_FINAL=yes bun lab/recovery-toml/held-back/results-check/check.ts [--final <folder>] [--recount <file>] [--results <file>]
// RECOVERY_FINAL=yes is asked for because tables with changed cells are run on the held-back sets. No line is written
// to the log of final runs. --final names the folder of the final run's outputs and --recount the second count's
// recount.txt, by default held-back/final/ and held-back/final-recount/recount.txt of the scratch folder. --results
// names another file to check in the place of RESULTS.md, e.g. a copy with one number changed, which has to fail. It
// takes about 10 seconds and ends with "Every check passed." or with the pieces that failed.
import {readFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {kinds as kindsOfTheMixedSet} from '../../kinds/list.ts'
import {optionOf} from '../../learn/options.ts'
import {grammarStateNames} from '../../learn/recovery-tables.ts'
import {scratchFolder} from '../final/list.ts'
import {type Loaded, type ScoredParser, type SetKey, headerNameKind, loadAll, notCounted, right, traceOf, wrong} from '../final/where/load.ts'
import {parserNamed, placeOf, showText} from '../final/where/show.ts'
import {writtenTags} from '../final/where/tags.ts'
import {kinds as kindsOfTheGenerator} from '../specific/mistakes.ts'
import {couldComeFromEdits, neutralEditsOf} from '../written/neutral-edits.ts'

const heldBackLine = 'HELD BACK: whoever builds the parser, the train data, the training or its machinery does not read this file.'
const heldBackScratchFolder = join(scratchFolder(), 'held-back')
const finalFolder = resolve(optionOf('--final') ?? join(heldBackScratchFolder, 'final'))
const recountFile = resolve(optionOf('--recount') ?? join(heldBackScratchFolder, 'final-recount', 'recount.txt'))
const trackFolder = resolve(import.meta.dir, '..', '..')
const resultsFile = resolve(optionOf('--results') ?? join(trackFolder, 'RESULTS.md'))
const results = readFileSync(resultsFile, 'utf8')

// The saved counts of a run, as ../final/run.ts writes them.
type SetName = 'generator' | 'written' | 'dataset'
type Counts = {name: string, texts: number, nothingToRecover: number, scored: number, right: number, whole: number}
type SavedFile = {seed: number | null, generator: Counts[], written: Counts[], dataset: Counts[], rightPerText: Record<SetName, number[]>}
type Saved = {rows: {label: string, files: SavedFile[]}[], texts: Record<SetName, {ids: string[], scored: number[]}>}
const finalCounts = JSON.parse(readFileSync(join(finalFolder, 'final.counts.json'), 'utf8')) as Saved
const validationCounts = JSON.parse(readFileSync(join(finalFolder, 'dry-run.counts.json'), 'utf8')) as Saved

const fullAgreement = 'cases with full agreement'
const mainRowOf: Record<SetName, string> = {generator: 'all', written: fullAgreement, dataset: 'all'}
const rowLabels = ['1', '2', '3', '4', '5', '6', '7', '8'] as const

const filesOf = (row: string, saved: Saved = finalCounts) => {
  const found = saved.rows.find(candidate => candidate.label === row)
  if (found === undefined) throw new Error(`the saved counts have no row ${row}`)
  return found.files
}
const countsOf = (file: SavedFile, set: SetName, name: string = mainRowOf[set]) => {
  const found = file[set].find(candidate => candidate.name === name)
  if (found === undefined) throw new Error(`the saved counts of the set ${set} have no row named ${name}`)
  return found
}
const meanOf = (values: readonly number[]) => values.reduce((total, value) => total + value, 0) / values.length
const allThreeOf = (counts: Counts) => 100 * counts.right / counts.scored
const wholeOf = (counts: Counts) => 100 * counts.whole / (counts.texts - counts.nothingToRecover)
// Per file of a row, e.g. per seed: a number of the row's counts in a set.
const perFile = (row: string, set: SetName, pick: (counts: Counts) => number, name?: string, saved?: Saved) => filesOf(row, saved).map(file => pick(countsOf(file, set, name)))
const meanAllThree = (row: string, set: SetName, name?: string, saved?: Saved) => meanOf(perFile(row, set, allThreeOf, name, saved))
const meanWhole = (row: string, set: SetName, name?: string) => meanOf(perFile(row, set, wholeOf, name))

const withCommas = (value: number) => Math.round(value).toLocaleString('en-US')
const signed = (value: number) => `${value >= 0 ? '+' : '−'}${withCommas(Math.abs(value))}`
// E.g. "86.63 (84.81 to 87.57)" for a row with several files, and "89.81" for a row with one.
const spread = (values: readonly number[], digits: number) => values.length === 1 ? values[0]!.toFixed(digits) : `${meanOf(values).toFixed(digits)} (${Math.min(...values).toFixed(digits)} to ${Math.max(...values).toFixed(digits)})`
const listed = (parts: readonly string[]) => parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`

// The pieces of RESULTS.md that this file makes again, and the statements without a number that it works out.
type Piece = {source: string, text: string}
const pieces: Piece[] = []
const failures: string[] = []
const piece = (source: string, text: string) => { pieces.push({source, text}) }
// A piece that also says something that is true or false, e.g. "with every seed": `holds` is what the counts say.
const statement = (source: string, text: string, holds: boolean) => {
  piece(source, text)
  if (!holds) failures.push(`the counts do not say: ${text}`)
}
const fromCounts = 'the final counts'
const fromCodePoints = 'every code point'
const fromPickedTexts = 'the final counts, over texts that another file picks'
const fromRecount = 'recount.txt'
const fromRepo = 'a file of the repo'

// A piece whose number another file of the repo says: the file has to hold `said`.
const repoFileSays = (text: string, file: string, said: string) => {
  piece(fromRepo, text)
  if (!readFileSync(join(trackFolder, file), 'utf8').includes(said)) failures.push(`${file} does not hold "${said}", which stands behind: ${text}`)
}

// ---- What was asked, and the rows ----

repoFileSays('a TOML document of at most 512 code points', 'README.md', 'the limits (512 code points, depth 16)')
repoFileSays('39 recovery rules written by hand', 'learn/handwritten/README.md', '`rules.ts` holds 39 rules')
repoFileSays('half is 49 kinds of mistakes written for TOML', 'kinds/README.md', '49 kinds of mistakes that people and tools make when they write TOML')

// ---- The result ----

// The rows of the generator's counts that hold one kind of mistake each, e.g. "kind: colonForEquals".
const generatorKindRows = filesOf('1')[0]!.generator.filter(counts => counts.name.startsWith('kind: ')).map(counts => counts.name)
const generatorAll = countsOf(filesOf('1')[0]!, 'generator')
const writtenAgreed = countsOf(filesOf('1')[0]!, 'written')
const writtenEveryCase = countsOf(filesOf('1')[0]!, 'written', 'all cases, the agreed code points')
const datasetAll = countsOf(filesOf('1')[0]!, 'dataset')
piece(fromCounts, `The **generator** makes ${generatorKindRows.length} kinds of typical mistakes: ${withCommas(generatorAll.texts)} payloads with ${withCommas(generatorAll.scored)} scored code points. The **written** set is ${writtenEveryCase.texts} broken files that agents wrote, of which the ${writtenAgreed.texts} that two repairers labeled alike count: ${withCommas(writtenAgreed.scored)} scored code points.`)
piece(fromCounts, `The last column is all three on the dataset's test split, ${withCommas(datasetAll.texts)} payloads with neutral damage.`)
const cellOf = (row: string, set: SetName) => `${spread(perFile(row, set, allThreeOf), 2)} / ${spread(perFile(row, set, wholeOf), 1)}`
for (const row of rowLabels) piece(fromCounts, `| ${row} | ${cellOf(row, 'generator')} | ${cellOf(row, 'written')} | ${meanAllThree(row, 'dataset').toFixed(2)} |`)

// ---- The verdict ----

const heldBackSets = ['generator', 'written'] as const
const rightOfRule = (set: SetName, name?: string) => countsOf(filesOf('2')[0]!, set, name).right
const rightOfHandWritten = (set: SetName) => countsOf(filesOf('3')[0]!, set).right
// Per file of a row: its right code points minus those of the one rule.
const againstRule = (row: string, set: SetName, name?: string) => perFile(row, set, counts => counts.right, name).map(rightHere => rightHere - rightOfRule(set, name))
const lowestRight = (row: string, set: SetName) => Math.min(...perFile(row, set, counts => counts.right))
const lowestShare = (row: string, set: SetName) => Math.min(...perFile(row, set, allThreeOf))

// The lead's rule as ../final/README.md reads it: each trained row with its lowest seed on each set.
const aboveBoth = (row: string) => heldBackSets.every(set => lowestRight(row, set) > rightOfRule(set) && lowestRight(row, set) > rightOfHandWritten(set))
const aboveRuleSomewhere = (row: string) => heldBackSets.some(set => lowestRight(row, set) > rightOfRule(set))
const verdict = aboveBoth('4') ? 'carried over with neutral damage alone' : aboveBoth('7') ? 'carried over with kinds written for the language' : aboveRuleSomewhere('4') || aboveRuleSomewhere('7') ? 'partly' : 'failed'
statement(fromCounts, '## The verdict: failed', verdict === 'failed')

const rowFourBelow = heldBackSets.map(set => againstRule('4', set).map(difference => -difference))
statement(fromCounts, `- **Row 4 is below the one rule with every seed on both sets,** by ${withCommas(Math.min(...rowFourBelow[0]!))} to ${withCommas(Math.max(...rowFourBelow[0]!))} code points on the generator and by ${withCommas(Math.min(...rowFourBelow[1]!))} to ${withCommas(Math.max(...rowFourBelow[1]!))} on the written set.`, rowFourBelow.every(differences => differences.every(difference => difference > 0)))
const ruleShare = (set: SetName) => allThreeOf(countsOf(filesOf('2')[0]!, set))
statement(fromCounts, `- **Row 7 is level with the rule in all three, and its lowest seed is below it on both sets:** ${lowestShare('7', 'generator').toFixed(2)} against ${ruleShare('generator').toFixed(2)}, and ${lowestShare('7', 'written').toFixed(2)} against ${ruleShare('written').toFixed(2)}. Its five seeds have ${listed(againstRule('7', 'generator').map(signed))} code points against the rule on the generator, and ${listed(againstRule('7', 'written').map(signed))} on the written set.`, heldBackSets.every(set => lowestRight('7', set) < rightOfRule(set)) && filesOf('7').length === 5)
const meanAboveRule = (row: string, set: SetName) => meanAllThree(row, set) > ruleShare(set)
statement(fromCounts, 'With the mean in the place of the lowest seed, row 7 is above the rule on the generator only.', meanAboveRule('7', 'generator') && !meanAboveRule('7', 'written') && !meanAboveRule('4', 'generator') && !meanAboveRule('4', 'written'))
statement(fromCounts, 'the rows 5 and 8 are above the rule with every seed on both sets, and their lowest seeds are below row 3.', ['5', '8'].every(row => heldBackSets.every(set => againstRule(row, set).every(difference => difference > 0) && lowestRight(row, set) < rightOfHandWritten(set))))

// ---- Where the trained tables are above and below: every code point ----

const loaded: Loaded = loadAll()
const parsersOf = (row: string) => loaded.parsers.filter(parser => parser.row === row)
const fullAgreementPlaces = loaded.sets.written.texts.flatMap((text, place) => text.rows.includes(fullAgreement) ? [place] : [])
const everyGeneratorPlace = loaded.sets.generator.texts.map((_text, place) => place)

// The part of a text that a position is in: 0 for the line of the first error (and what stands before it, which no
// score counts), 1 for a later line on which a code point has the label "name of a header", 2 for another later line.
const partNames = ['The line of the first error', 'Later lines with a header, e.g. `[server.tls]`', 'Other later lines']
const partsOfText = (set: SetKey, place: number): Uint8Array => {
  const text = loaded.sets[set].texts[place]!
  const characters = Array.from(text.broken)
  const parts = new Uint8Array(characters.length)
  let afterFirstErrorLine = false
  let start = 0
  while (start < characters.length) {
    let end = start
    while (end < characters.length - 1 && characters[end] !== '\n') end++
    let hasHeaderName = false
    for (let position = start; position <= end; position++) if (text.labels[position]?.kind === headerNameKind) hasHeaderName = true
    const part = !afterFirstErrorLine ? 0 : hasHeaderName ? 1 : 2
    for (let position = start; position <= end; position++) parts[position] = part
    if (text.firstErrorPosition >= start && text.firstErrorPosition <= end) afterFirstErrorLine = true
    start = end + 1
  }
  return parts
}
const generatorParts = everyGeneratorPlace.map(place => partsOfText('generator', place))
// Counted and right code points of the generator's set per part, for one parser.
const countedPerPart = [0, 0, 0]
everyGeneratorPlace.forEach(place => loaded.parsers[0]!.outcomes.generator[place]!.forEach((outcome, position) => { if (outcome !== notCounted) countedPerPart[generatorParts[place]![position]!]!++ }))
const rightPerPart = (parser: ScoredParser) => {
  const counts = [0, 0, 0]
  everyGeneratorPlace.forEach(place => parser.outcomes.generator[place]!.forEach((outcome, position) => { if (outcome === right) counts[generatorParts[place]![position]!]!++ }))
  return counts
}
const rightPerPartOfParser = new Map(loaded.parsers.map(parser => [parser, rightPerPart(parser)]))
const meanRightInPart = (row: string, part: number) => meanOf(parsersOf(row).map(parser => rightPerPartOfParser.get(parser)![part]!))
const rowsOfPartsTable = ['2', '3', '4', '7', '5', '8']
partNames.forEach((name, part) => piece(fromCodePoints, `| ${name} | ${withCommas(countedPerPart[part]!)} | ${rowsOfPartsTable.map(row => (100 * meanRightInPart(row, part) / countedPerPart[part]!).toFixed(2)).join(' | ')} |`))

const outsideLaterHeaders = (row: string) => meanRightInPart(row, 0) + meanRightInPart(row, 2)
const moreOutside = (row: string) => outsideLaterHeaders(row) - outsideLaterHeaders('2')
const fewerOnHeaders = (row: string) => meanRightInPart('2', 1) - meanRightInPart(row, 1)
statement(fromCodePoints, `- **Against the rule,** row 4 has ${withCommas(moreOutside('4'))} right code points more outside later header lines and ${withCommas(fewerOnHeaders('4'))} fewer on them. Row 7 has ${withCommas(moreOutside('7'))} more and ${withCommas(fewerOnHeaders('7'))} fewer.`, moreOutside('4') > 0 && moreOutside('7') > 0 && fewerOnHeaders('4') > 0 && fewerOnHeaders('7') > 0)
// The headline: in each of the two other parts both rows are above the rule, with every seed.
statement(fromCodePoints, '**The rows 4 and 7 are below the one rule in one place only: the headers after an error.**', ['4', '7'].every(row => parsersOf(row).every(parser => [0, 2].every(part => rightPerPartOfParser.get(parser)![part]! > meanRightInPart('2', part)) && rightPerPartOfParser.get(parser)![1]! < meanRightInPart('2', 1))))

// The grammar state in which a parser is at the start of a later line whose wanted depth is 0, i.e. a line that
// starts outside every array and inline table: the share of those starts per state, in the mean of a row's seeds.
const lineStartState = grammarStateNames.indexOf('lineStart')
const errorState = grammarStateNames.indexOf('error')
const statesAtLaterLineStarts = (parser: ScoredParser) => {
  const counts = {starts: 0, inLineStart: 0, inError: 0}
  for (const text of loaded.sets.generator.texts) {
    if (text.firstErrorPosition === -1) continue
    const characters = Array.from(text.broken)
    const trace = traceOf(parser.tables!, text.broken)
    for (let position = text.firstErrorPosition + 1; position < characters.length; position++) {
      if (characters[position - 1] !== '\n' || text.labels[position - 1]?.depth !== 0) continue
      counts.starts++
      if (trace.grammarBefore[position] === lineStartState) counts.inLineStart++
      if (trace.grammarBefore[position] === errorState) counts.inError++
    }
  }
  return counts
}
const stateSharesOf = (row: string) => {
  const perSeed = parsersOf(row).map(statesAtLaterLineStarts)
  const share = (pick: (counts: typeof perSeed[number]) => number) => (100 * meanOf(perSeed.map(pick)) / perSeed[0]!.starts).toFixed(1)
  return {lineStart: share(counts => counts.inLineStart), error: share(counts => counts.inError), neither: share(counts => counts.starts - counts.inLineStart - counts.inError)}
}
const stateShares = Object.fromEntries(['3', '4', '5', '7', '8'].map(row => [row, stateSharesOf(row)]))
piece(fromCodePoints, `Without the search, the trained tables are in that state at ${stateShares['4']!.lineStart}% (row 4) and ${stateShares['7']!.lineStart}% (row 7) of the later line starts at depth 0`)
piece(fromCodePoints, `With the search the shares are ${stateShares['5']!.lineStart}% and ${stateShares['8']!.lineStart}%, and the hand-written rules have ${stateShares['3']!.lineStart}%.`)
piece(fromCodePoints, `The trained tables are in \`error\` at ${stateShares['4']!.error}% (row 4) and ${stateShares['7']!.error}% (row 7) of the later line starts, and in a state that is neither \`error\` nor \`lineStart\` at ${stateShares['4']!.neither}% and ${stateShares['7']!.neither}%.`)

// What the search changes: the tables of row 5 start from those of row 4 with the same seed, and row 8 from row 7.
// "Made right" is wrong before the search and right after it, "made wrong" the other way round, per seed.
const searchChanges = (before: string, after: string) => {
  const perSeed = parsersOf(before).map(parserBefore => {
    const parserAfter = parsersOf(after).find(parser => parser.seed === parserBefore.seed)!
    const counts = {madeRightOnHeaders: 0, madeWrongOnHeaders: 0, madeRightElsewhere: 0, madeWrongElsewhere: 0}
    everyGeneratorPlace.forEach(place => {
      const outcomesBefore = parserBefore.outcomes.generator[place]!
      const outcomesAfter = parserAfter.outcomes.generator[place]!
      outcomesBefore.forEach((outcomeBefore, position) => {
        const onHeaders = generatorParts[place]![position] === 1
        if (outcomeBefore === wrong && outcomesAfter[position] === right) counts[onHeaders ? 'madeRightOnHeaders' : 'madeRightElsewhere']++
        if (outcomeBefore === right && outcomesAfter[position] === wrong) counts[onHeaders ? 'madeWrongOnHeaders' : 'madeWrongElsewhere']++
      })
    })
    return counts
  })
  const mean = (pick: (counts: typeof perSeed[number]) => number) => withCommas(meanOf(perSeed.map(pick)))
  return {madeRightOnHeaders: mean(counts => counts.madeRightOnHeaders), madeWrongOnHeaders: mean(counts => counts.madeWrongOnHeaders), madeRightElsewhere: mean(counts => counts.madeRightElsewhere), madeWrongElsewhere: mean(counts => counts.madeWrongElsewhere)}
}
const neutralSearch = searchChanges('4', '5')
const mixedSearch = searchChanges('7', '8')
piece(fromCodePoints, `In the mean of the seeds it makes ${neutralSearch.madeRightOnHeaders} (row 4 to 5) and ${mixedSearch.madeRightOnHeaders} (row 7 to 8) code points on later header lines right and ${neutralSearch.madeWrongOnHeaders} and ${mixedSearch.madeWrongOnHeaders} wrong. Elsewhere it makes ${neutralSearch.madeRightElsewhere} right and ${neutralSearch.madeWrongElsewhere} wrong after training on neutral damage, and ${mixedSearch.madeRightElsewhere} and ${mixedSearch.madeWrongElsewhere} after the mixed set.`)

// Row 8 against the hand-written rules, from the saved counts: right code points, whole payloads, the payloads that
// are not whole and the median of their wrong code points, and two kinds.
const meanRight = (row: string, set: SetName, name?: string) => meanOf(perFile(row, set, counts => counts.right, name))
const meanWholeCount = (row: string, set: SetName, name?: string) => meanOf(perFile(row, set, counts => counts.whole, name))
const notWhole = (row: string) => generatorAll.texts - meanWholeCount(row, 'generator')
const medianOf = (values: readonly number[]) => {
  const sorted = [...values].sort((left, rightValue) => left - rightValue)
  return sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
}
// Per file of a row: the wrong code points of each of the generator's payloads that are not whole.
const wrongInFailing = (row: string) => filesOf(row).map(file => file.rightPerText.generator.flatMap((rightHere, place) => rightHere < finalCounts.texts.generator.scored[place]! ? [finalCounts.texts.generator.scored[place]! - rightHere] : []))
// "Half have at most 5": with every file of both rows, half of the payloads that are not whole have at most this
// many wrong code points, and it is the median of the hand-written rules and of the seeds of row 8 taken together.
const halfHaveAtMost = medianOf(wrongInFailing('3')[0]!)
const halfHaveAtMostHolds = ['3', '8'].every(row => wrongInFailing(row).every(wrongCounts => wrongCounts.filter(wrongCount => wrongCount <= halfHaveAtMost).length >= wrongCounts.length / 2)) && medianOf(wrongInFailing('8').flat()) === halfHaveAtMost
const kindRow = (kind: string) => `kind: ${kind}`
const kindTexts = (kind: string) => countsOf(filesOf('3')[0]!, 'generator', kindRow(kind)).texts
const wholeOfKind = (row: string, kind: string) => meanWholeCount(row, 'generator', kindRow(kind))
statement(fromCounts, `- **Row 8 against the hand-written rules** has ${withCommas(meanRight('3', 'generator') - meanRight('8', 'generator'))} right code points fewer on the generator and ${withCommas(meanWholeCount('8', 'generator') - meanWholeCount('3', 'generator'))} whole payloads more. Both fail alike: in ${withCommas(notWhole('8'))} and ${withCommas(notWhole('3'))} payloads, of which half have at most ${halfHaveAtMost} wrong code points. Row 8 is far above for an inline table on several lines (${withCommas(wholeOfKind('8', 'inlineTableOnSeveralLines'))} against ${withCommas(wholeOfKind('3', 'inlineTableOnSeveralLines'))} whole of ${kindTexts('inlineTableOnSeveralLines')}) and far below for typographic quotes (${withCommas(wholeOfKind('8', 'typographicQuotes'))} against ${withCommas(wholeOfKind('3', 'typographicQuotes'))} of ${kindTexts('typographicQuotes')}).`, halfHaveAtMostHolds)

// ---- Neutral damage alone, and what the kinds add ----

const pointsBetween = (row: string, other: string, set: SetName) => meanAllThree(row, set) - meanAllThree(other, set)
// A difference in points without its sign, e.g. "3.1".
const pointsOf = (value: number) => Math.abs(value).toFixed(1)
statement(fromCounts, `- **With the search, neutral damage alone (row 5) is above the one rule and far below the hand-written rules:** ${pointsOf(pointsBetween('5', '2', 'generator'))} and ${pointsOf(pointsBetween('5', '2', 'written'))} points above row 2 on the two sets, ${pointsOf(pointsBetween('5', '3', 'generator'))} and ${pointsOf(pointsBetween('5', '3', 'written'))} below row 3. On its own damage the order is the other way round: ${meanAllThree('5', 'dataset').toFixed(2)} against ${meanAllThree('3', 'dataset').toFixed(2)}.`, heldBackSets.every(set => pointsBetween('5', '2', set) > 0 && pointsBetween('5', '3', set) < 0) && pointsBetween('5', '3', 'dataset') > 0)
repoFileSays('where neutral damage alone gave 82.8% of the scored code points on validation and damage written for JSON gave 98.0%', 'kinds/README.md', 'reached 82.8% of the scored code points and 61.8% of whole samples on validation, where it reached 98.0% and 80.5% with damage that was written for JSON')

// The generator's payloads whose damage one to three of the ten neutral edits could make, by the test that the
// written set uses (../written/neutral-edits.ts). The right code points per text are the saved ones.
const neutralEditsCouldMake = loaded.generatorSamples.map(sample => couldComeFromEdits(neutralEditsOf({broken: sample.broken, opinions: [{name: 'writer', text: sample.original, note: undefined, unsure: undefined, alignment: sample.alignment, replaced: sample.replaced, labels: []}]})))
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)
// "All three" of a row over some texts of a set, in the mean of the row's files, from the saved counts per text.
const allThreeOver = (row: string, set: 'generator' | 'written', places: readonly number[]) => meanOf(filesOf(row).map(file => 100 * sum(places.map(place => file.rightPerText[set][place]!)) / sum(places.map(place => finalCounts.texts[set].scored[place]!))))
const neutralPlaces = everyGeneratorPlace.filter(place => neutralEditsCouldMake[place])
const otherPlaces = everyGeneratorPlace.filter(place => !neutralEditsCouldMake[place])
piece(fromPickedTexts, `One to three neutral edits could make the damage of ${withCommas(neutralPlaces.length)} of the generator's payloads: there row 5 has ${allThreeOver('5', 'generator', neutralPlaces).toFixed(2)} and row 3 has ${allThreeOver('3', 'generator', neutralPlaces).toFixed(2)}. On the other ${withCommas(otherPlaces.length)}, e.g. a colon after every key, row 5 has ${allThreeOver('5', 'generator', otherPlaces).toFixed(2)}, row 3 has ${allThreeOver('3', 'generator', otherPlaces).toFixed(2)} and row 8 has ${allThreeOver('8', 'generator', otherPlaces).toFixed(2)}.`)

statement(fromCounts, `- **In all three, the training adds nothing to the search alone:** row 6 is ${pointsBetween('6', '5', 'generator').toFixed(2)} and ${pointsBetween('6', '5', 'written').toFixed(2)} points above row 5.`, heldBackSets.every(set => pointsBetween('6', '5', set) > 0))

// The written cases with full agreement whose mistake no kind of the training side makes, by ../final/where/tags.ts.
const casesWithoutAKind = fullAgreementPlaces.filter(place => writtenTags[loaded.sets.written.texts[place]!.id]!.held === 'none')
piece(fromCounts, `- **The kinds add ${pointsOf(pointsBetween('8', '5', 'generator'))} points on the generator and ${pointsOf(pointsBetween('8', '5', 'written'))} on the written set with the search (row 8 over row 5), and ${pointsOf(pointsBetween('7', '4', 'generator'))} and ${pointsOf(pointsBetween('7', '4', 'written'))} without it.`)
statement(fromPickedTexts, `They add nothing where no kind makes the mistake:** on the ${casesWithoutAKind.length} such written cases, by one reader's judgment, row 8 has ${allThreeOver('8', 'written', casesWithoutAKind).toFixed(2)}, row 5 has ${allThreeOver('5', 'written', casesWithoutAKind).toFixed(2)} and row 3 has ${allThreeOver('3', 'written', casesWithoutAKind).toFixed(2)}.`, allThreeOver('8', 'written', casesWithoutAKind) <= allThreeOver('5', 'written', casesWithoutAKind))

// In how many of the generator's kinds a row is above the one rule in all three: by the mean of its files, and with
// every file.
const kindNames = generatorKindRows.map(name => name.slice('kind: '.length))
const kindsAboveRuleByMean = (row: string) => kindNames.filter(kind => meanRight(row, 'generator', kindRow(kind)) > rightOfRule('generator', kindRow(kind))).length
const kindsAboveRuleWithEverySeed = (row: string) => kindNames.filter(kind => againstRule(row, 'generator', kindRow(kind)).every(difference => difference > 0)).length
statement(fromCounts, `- **Row 8 is above the one rule in all ${kindNames.length} kinds of the generator with every seed.** By the mean, row 5 is in ${kindsAboveRuleByMean('5')}, row 7 in ${kindsAboveRuleByMean('7')}, row 4 in ${kindsAboveRuleByMean('4')}.`, kindsAboveRuleWithEverySeed('8') === kindNames.length)
const inlineTablesWhole = perFile('8', 'generator', counts => counts.whole, kindRow('inlineTableOnSeveralLines'))
const seedOfLowest = filesOf('8')[inlineTablesWhole.indexOf(Math.min(...inlineTablesWhole))]!.seed
const otherSeeds = inlineTablesWhole.filter(whole => whole !== Math.min(...inlineTablesWhole))
statement(fromCounts, `- **One seed can get a whole kind wrong:** four seeds of row 8 have ${Math.min(...otherSeeds)} to ${Math.max(...otherSeeds)} of the ${kindTexts('inlineTableOnSeveralLines')} inline tables on several lines whole, and seed ${seedOfLowest} has ${Math.min(...inlineTablesWhole)}.`, otherSeeds.length === 4)

// ---- The examples ----

// The blocks of RESULTS.md between lines of three backticks, in their order.
const blocks = [...results.matchAll(/```\n([\s\S]*?)\n```/g)].map(match => match[1]!.split('\n'))
type Example = {id: string, parsers: readonly string[], line: number}
const examples: Example[] = [
  {id: 'hand-editing-20', parsers: ['3', '8.1'], line: 10},
  {id: '20261107:2323', parsers: ['7.1'], line: 5},
  {id: '20261107:2483', parsers: ['5.2', '8.2'], line: 4},
]
if (blocks.length !== examples.length) failures.push(`RESULTS.md has ${blocks.length} blocks of example lines, and this check knows ${examples.length}`)
examples.forEach((example, index) => {
  const {set, at} = placeOf(loaded, example.id)
  // What ../final/where/show.ts prints for the line: the text, the wanted kinds, and per parser its kinds and an x
  // under each wrong code point. Every line of the block has to be one of these lines, in their order.
  const shownLines = showText(loaded, set, at, example.parsers.map(name => parserNamed(loaded, name)), example.line, example.line)
  let from = 0
  for (const blockLine of blocks[index] ?? []) {
    const found = shownLines.indexOf(blockLine, from)
    if (found === -1) failures.push(`example ${index + 1}: the tables do not show the line "${blockLine}" for line ${example.line} of ${example.id}`)
    else from = found + 1
  }
  if (!(blocks[index] ?? []).some(blockLine => blockLine.startsWith('wanted'))) failures.push(`example ${index + 1} has no line of wanted kinds`)
  piece(fromCodePoints, `\`\`\`\n${(blocks[index] ?? []).join('\n')}\n\`\`\``)
})
// The right code points of one text per file of a row, from the saved counts.
const rightOfText = (row: string, set: 'generator' | 'written', id: string) => filesOf(row).map(file => file.rightPerText[set][finalCounts.texts[set].ids.indexOf(id)]!)
const scoredOfText = (set: 'generator' | 'written', id: string) => finalCounts.texts[set].scored[finalCounts.texts[set].ids.indexOf(id)]!
const range = (values: readonly number[]) => `${Math.min(...values)} to ${Math.max(...values)}`
const everyOne = (values: readonly number[], wanted: number) => values.every(value => value === wanted)

piece(fromCounts, `Row 3 has ${rightOfText('3', 'written', 'hand-editing-20')[0]} of the payload's ${scoredOfText('written', 'hand-editing-20')} scored code points right, and row 8 has ${range(rightOfText('8', 'written', 'hand-editing-20'))}.`)

// The second example: the first error stands on the line `"npm:prettier" = NULL`, and in every seed of the rows 4
// and 7 the wrong code points are the first 12 of the header's line and no other.
{
  const {at} = placeOf(loaded, '20261107:2323')
  const text = loaded.sets.generator.texts[at]!
  const characters = Array.from(text.broken)
  const lineStarts = [0]
  characters.forEach((character, position) => { if (character === '\n' && position + 1 < characters.length) lineStarts.push(position + 1) })
  const lineOf = (position: number) => lineStarts.findLastIndex(start => start <= position)
  // The line of the first error without its line feed, and the start of line 5, which holds the header.
  const errorLine = characters.slice(lineStarts[lineOf(text.firstErrorPosition)], lineStarts[lineOf(text.firstErrorPosition) + 1]! - 1).join('')
  const headerLineStart = lineStarts[5 - 1]!
  const wrongCodePoints = 12
  const onlyTheHeaderIsWrong = ['4', '7'].every(row => parsersOf(row).every(parser => Array.from(parser.outcomes.generator[at]!).every((outcome, position) => (outcome === wrong) === (position >= headerLineStart && position < headerLineStart + wrongCodePoints))))
  const scored = scoredOfText('generator', '20261107:2323')
  statement(fromCodePoints, `After \`${errorLine}\`, every seed of the rows 4 and 7 has these ${wrongCodePoints} code points wrong and the other ${scored - wrongCodePoints} right. The rows 2, 3, 5 and 8 have all ${scored}.`, onlyTheHeaderIsWrong && ['2', '3', '5', '8'].every(row => everyOne(rightOfText(row, 'generator', '20261107:2323'), scored)))
}
{
  const id = '20261107:2483'
  const scored = scoredOfText('generator', id)
  const {at} = placeOf(loaded, id)
  statement(fromCounts, `Row 5 has ${range(rightOfText('5', 'generator', id))} of ${scored} right, and row 8 has ${scored} with every seed.`, everyOne(rightOfText('8', 'generator', id), scored) && loaded.sets.generator.texts[at]!.broken.includes('\nserver:\n'))
}

// ---- Limits ----

const sharedKindNames = kindsOfTheGenerator.filter(kind => kindsOfTheMixedSet.some(other => other.name === kind.name))
piece(fromRepo, `one agent's ${kindsOfTheMixedSet.length} kinds. ${sharedKindNames.length} of the generator's ${kindsOfTheGenerator.length} kinds have the same name among the ${kindsOfTheMixedSet.length}`)
piece(fromCounts, `one case is ${(100 / (writtenAgreed.texts - writtenAgreed.nothingToRecover)).toFixed(1)} points of whole.`)
repoFileSays('The 39 rules took one session of about 75 minutes, with the 49 kinds in view', 'learn/handwritten/README.md', 'One session of about 75 minutes on the clock')

// ---- What the recount and the analysis correct ----

const wholeOfSeven = perFile('7', 'written', counts => counts.whole)
const wholeOfRule = countsOf(filesOf('2')[0]!, 'written')
statement(fromCounts, `In whole payloads it is below the rule on the written set with every seed: ${range(wholeOfSeven)} of ${wholeOfRule.texts - wholeOfRule.nothingToRecover} against ${wholeOfRule.whole}.`, wholeOfSeven.every(whole => whole < wholeOfRule.whole))

// From the validation split to the test split of the dataset, all three, per row.
const fromValidationToTest = (row: string) => meanAllThree(row, 'dataset') - meanAllThree(row, 'dataset', 'all', validationCounts)
const rowsThatKeep = rowLabels.filter(row => Math.abs(fromValidationToTest(row)) <= 0.3)
const rowsThatLose = rowLabels.filter(row => fromValidationToTest(row) < -0.3)
statement(fromCounts, `holds for the rows ${listed(rowsThatKeep)}, within 0.3 points. The rows ${listed(rowsThatLose)} are ${listed(rowsThatLose.map(row => (-fromValidationToTest(row)).toFixed(2)))} lower.`, rowsThatKeep.length + rowsThatLose.length === rowLabels.length)

// The generator's documents of the two held-out templates against its other documents.
const heldOutTemplates = 'documents of the two held-out templates'
const trainTemplates = 'documents of the 14 templates that the train data has'
const lowerOnHeldOut = (row: string) => meanAllThree(row, 'generator', trainTemplates) - meanAllThree(row, 'generator', heldOutTemplates)
const lowerOfSearched = ['3', '5', '6', '8'].map(lowerOnHeldOut)
const seedsAboveRule = (name: string) => againstRule('7', 'generator', name).filter(difference => difference > 0).length
const numberWords = ['no', 'one', 'two', 'three', 'four', 'five']
const textsOf = (name: string) => countsOf(filesOf('2')[0]!, 'generator', name).texts
statement(fromCounts, `On the generator's documents of the two templates that the train data lacks, the rows 3, 5, 6 and 8 are ${Math.min(...lowerOfSearched).toFixed(2)} to ${Math.max(...lowerOfSearched).toFixed(2)} points lower than on its other documents, the rows 4 and 7 are ${lowerOnHeldOut('4').toFixed(2)} and ${lowerOnHeldOut('7').toFixed(2)} lower, and the rule ${lowerOnHeldOut('2').toFixed(2)}. So on the ${withCommas(textsOf(trainTemplates))} payloads of templates that the train data has, all ${numberWords[seedsAboveRule(trainTemplates)]} seeds of row 7 are above the rule, and on the other ${withCommas(textsOf(heldOutTemplates))}, ${numberWords[seedsAboveRule(heldOutTemplates)]} is.`, seedsAboveRule(trainTemplates) === 5 && textsOf(trainTemplates) + textsOf(heldOutTemplates) === generatorAll.texts)

const wholeBetween = (row: string, other: string) => meanWhole(row, 'generator') - meanWhole(other, 'generator')
// The final report's two numbers: 1.0 stands in ../final/RESULTS.md, and 4.4 in the report as it was sent.
piece(fromCounts, `row 8 is ${wholeBetween('8', '3').toFixed(1)} points above row 3 and row 5 is ${wholeBetween('5', '6').toFixed(1)} above row 6, not 1.0 and 4.4.`)
if (!readFileSync(join(trackFolder, 'held-back/final/RESULTS.md'), 'utf8').includes('1.0 above it in whole samples')) failures.push('held-back/final/RESULTS.md does not say "1.0 above it in whole samples"')

// The second count's own findings, read from its output: the written cases whose repaired document has the
// sequence of tokens of a train or validation document, and how many values it compared.
const recount = readFileSync(recountFile, 'utf8')
const recountSays = (text: string, said: RegExp) => {
  const found = said.exec(recount)
  if (found === null) failures.push(`recount.txt has no line like ${said}, which stands behind: ${text}`)
  return found ?? []
}
{
  const cases = recountSays('the written cases with a known sequence of tokens', /written: (\d+) of the 150 cases have a repaired document with the sequence of tokens of a train or validation document, (\d+) of them with full agreement\. Without them, on the (\d+) other cases with full agreement: row 1 [\d.]+; row 2 ([\d.]+); row 3 ([\d.]+); row 4 ([\d.]+) \(([\d.]+) to ([\d.]+)\); row 5 [^;]+; row 6 [^;]+; row 7 ([\d.]+) \(([\d.]+) to ([\d.]+)\); row 8 ([\d.]+) \(([\d.]+) to ([\d.]+)\)\./)
  const [, , withAgreement, otherCases, ruleShareWithout, handWrittenWithout, fourWithout, , fourHighest, sevenWithout, sevenLowest, , , , eightHighest] = cases
  statement(fromRecount, `- **${withAgreement} of the ${writtenAgreed.texts} written cases have a document with the sequence of tokens of a train or validation document,** which \`held-back/README.md\` rules out. Without them the rows 2, 3, 4 and 7 have ${ruleShareWithout}, ${handWrittenWithout}, ${fourWithout} and ${sevenWithout}: no place changes.`, Number(otherCases) === writtenAgreed.texts - Number(withAgreement) && Number(fourHighest) < Number(ruleShareWithout) && Number(sevenLowest) < Number(ruleShareWithout) && Number(eightHighest) < Number(handWrittenWithout))
  if (!readFileSync(join(trackFolder, 'held-back/README.md'), 'utf8').includes('no sequence of tokens of one is in a train or validation sample')) failures.push('held-back/README.md does not say that no sequence of tokens of a set is in a train or validation sample')
}
{
  const [, compared, differing] = recountSays('the second count', /In all: ([\d,]+) values compared, (\d+) differ\./)
  statement(fromRecount, `the second count, in which none of ${compared} values differs.`, differing === '0')
}

// ---- Every piece is in RESULTS.md, and no other number is ----

if (!results.includes('**Held back: do not read this file if you build the parser, the train data, the training or its machinery.**')) failures.push('RESULTS.md does not say that it is held back')
let rest = results
for (const {text} of pieces) {
  const at = rest.indexOf(text)
  if (at === -1) failures.push(`RESULTS.md does not hold: ${text}`)
  else rest = rest.slice(0, at) + ' '.repeat(text.length) + rest.slice(at + text.length)
}
// What may hold a digit without being a result: the names of rows, seeds and examples, e.g. "the rows 4 and 7", the
// numbers of the list of examples, the first cell of a table line, and what stands between backticks, e.g. the name
// of a file or a piece of TOML. `singleDigit` is one digit that is no part of a longer number.
const singleDigit = '\\d(?![.,]?\\d)'
const namesWithDigits = [new RegExp(`\\b[Rr]ows? ${singleDigit}(?:(?:, | and | to )${singleDigit})*`, 'g'), new RegExp(`\\bseeds? ${singleDigit}`, 'g'), new RegExp(`\\bexample ${singleDigit}`, 'g'), /^\d\. /gm, /`[^`\n]*`/g, /^\| \d \|/gm]
const withoutNames = (text: string) => namesWithDigits.reduce((masked, pattern) => masked.replace(pattern, found => ' '.repeat(found.length)), text)
rest = withoutNames(rest)
const leftOver = [...rest.matchAll(/[^\s|]*\d[^\s|]*/g)].map(match => match[0])
if (leftOver.length > 0) failures.push(`RESULTS.md has ${leftOver.length} numbers that this check does not know: ${leftOver.join(' ')}`)
const bytes = Buffer.byteLength(results, 'utf8')
const mostBytes = 12_000
if (bytes > mostBytes) failures.push(`RESULTS.md has ${bytes} bytes, and at most ${mostBytes} are allowed`)

console.log(heldBackLine)
console.log()
console.log(`The check of ${resultsFile}, ${bytes} bytes, against the final run of ${finalFolder}.`)
// How many numbers the pieces of each source hold, without the names of rows and seeds and without the examples.
const numbersIn = (text: string) => [...withoutNames(text).matchAll(/\d[\d,.]*\d|\d/g)].length
const piecesWithNumbers = pieces.filter(candidate => !candidate.text.startsWith('```'))
for (const source of [fromCounts, fromCodePoints, fromPickedTexts, fromRecount, fromRepo]) {
  const ofSource = piecesWithNumbers.filter(candidate => candidate.source === source)
  console.log(`  ${source}: ${ofSource.length} pieces with ${sum(ofSource.map(candidate => numbersIn(candidate.text)))} numbers`)
}
console.log(`  in all: ${piecesWithNumbers.length} pieces with ${sum(piecesWithNumbers.map(candidate => numbersIn(candidate.text)))} numbers, and ${examples.length} examples with ${sum(blocks.map(block => block.length))} lines, each line as the tables show it.`)
console.log()
if (failures.length === 0) console.log('Every check passed.')
else {
  for (const failure of failures) console.log(`FAILED: ${failure}`)
  console.log(`${failures.length} checks failed.`)
  process.exit(1)
}
