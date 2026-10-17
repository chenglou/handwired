// The final scoring of the TOML track: the eight rows of the experiment on the two held-back sets and, for
// reference, on the dataset's test split. It is meant to run once, after the recipe and its training are frozen.
//
// Run from the repo root:
//   bun lab/recovery-toml/held-back/final/run.ts --dry-run --out <folder>
//   RECOVERY_FINAL=yes bun lab/recovery-toml/held-back/final/run.ts --out <folder>
// <folder> is below recovery-scratch/transfer/toml/held-back/, e.g. .../held-back/final. The list of the files of
// tables is list.json of this folder, see list.ts, or the file that is named after the options.
//
// Before a text is scored, the run refuses:
// - a list that is not what the three lists of the training side give now, or a file whose bytes do not have the
//   sha256 that the list names;
// - a file that was saved with another dataset, or whose tables break the ground rules: a frozen cell or a display
//   entry that is not open holds something else than today's;
// - a final run without RECOVERY_FINAL=yes, and a dry run with it;
// - a second final run, unless `--again "<why>"` says why the first one does not count. The reason goes into the log.
//
// The final run then appends one line to <folder>/final-runs.log, scores, and writes final.counts.json and
// final.report.md into <folder>, the counts first. From the first scored text on it stops for nothing: what goes
// wrong is written into the report under "Problems of this run", so that no number of a run that got halfway is lost
// or made a second time.
//
// A dry run scores, on the two held-back sets, only the parser as it is, the one rule, and tables that have what the
// listed tables add to today's and no cell changed. It reads no sample of the dataset's test split: the validation
// split stands in its place, and there every table of the list is scored, since the training side has those numbers
// already. It writes dry-run.counts.json and dry-run.report.md, and no line to the log.
import {appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs'
import {basename, join, resolve} from 'node:path'
import {type Samples, finalIsAllowed, requireFinal, samplesOf, selectSamples} from '../../learn/data.ts'
import {datasetKey} from '../../learn/dataset-key.ts'
import {optionOf, refuseUnknownOptions} from '../../learn/options.ts'
import {type RecoveryTables, addClasses, addFirstOnLineBit, asIsTables, differencesOf, loadTablesOfThisDataset, openDisplayEntries, problemsOf, today} from '../../learn/recovery-tables.ts'
import {scoreRestartAtNextLine} from '../../learn/restart-at-next-line.ts'
import {countCells, scoreTables} from '../../learn/score.ts'
import {type Parser, parserAsItIs, parserOfTables, restartAtNextLine} from '../parsers.ts'
import {countsOf, differencesFromToday, labelKindCountsOf, parserOfCheckedTables, scoredPerTextOf, todaysTracesOf} from './count.ts'
import {listFile, problemsOfList, readList, sha256OfFile} from './list.ts'
import {type AsTodayFacts, type FileCounts, type FileFacts, type RowCounts, type RunFacts, type SavedCounts, describeReport, dryRunMark, heldBackLine, mainRows} from './report.ts'
import {type Comparison, compare, compareWithGeneratorScorer, compareWithLearnScorer, compareWithWrittenScorer} from './second-count.ts'
import {datasetRowOfHeldOutTemplates, datasetRowOfTrainTemplates, datasetSet, generatorSet, writtenSet} from './sets.ts'

// What scores: the parser as it is, the rule, tables with no cell changed, or the tables of a file of the list.
// `quick` checks the tables once and is what the counts of the report come from. `checking` is the parser that the
// sets' own scorers take, which checks the tables at every text: the second counts run it.
type Scorer = {
  kind: 'as it is' | 'rule' | 'base' | 'listed'
  seed: number | null
  file: string | null
  sha256: string | null
  quick: Parser
  checking: Parser
  // Null for the rule, which is no setting of the tables.
  tables: RecoveryTables | null
}
type ScoredRow = {label: string, name: string, description: string, scorers: Scorer[]}

// What tables add to today's: their added classes, whether entries of the display table are open, and whether the
// grammar reads the bit "first on its line".
export const structureOf = (tables: RecoveryTables) => `${tables.addedClasses.length} added classes, ${tables.displayOpen.includes(1) ? 'open display entries' : 'no open display entry'}, ${tables.contextCount > today.contextCount ? 'the bit "first on its line"' : 'no bit'}`
const structureKeyOf = (tables: RecoveryTables) => JSON.stringify([tables.addedClasses, tables.displayOpen.includes(1), tables.contextCount])

// Today's tables with what `tables` add to them, and no cell changed.
export function baseOf(tables: RecoveryTables): RecoveryTables {
  if (tables.lexerStateCount !== today.lexerStateCount || tables.grammarStateCount !== today.grammarStateCount) throw new Error('a file of the list has added states, which the final scoring has no base for')
  let base = tables.addedClasses.length > 0 ? addClasses(asIsTables(), tables.addedClasses) : asIsTables()
  if (tables.displayOpen.includes(1)) base = openDisplayEntries(base)
  if (tables.contextCount > today.contextCount) base = addFirstOnLineBit(base)
  if (differencesOf(asIsTables(), base).length > 0) throw new Error('a base of the final scoring differs from today\'s tables in a cell')
  return base
}

// How many final runs a log holds: its lines that are a JSON object. The first line of the log says that the file
// is held back.
export const finalRunsIn = (logText: string) => logText.split('\n').filter(line => line.startsWith('{')).length

// JSON text with one line per object whose values are all numbers, strings, booleans or null, e.g. a row of counts,
// and one line per list of such values.
function jsonText(value: unknown, indent = ''): string {
  if (typeof value !== 'object' || value === null) return JSON.stringify(value)
  const inner = `${indent} `
  if (Array.isArray(value)) return (value as unknown[]).every(entry => typeof entry !== 'object' || entry === null) ? JSON.stringify(value) : `[\n${(value as unknown[]).map(entry => `${inner}${jsonText(entry, inner)}`).join(',\n')}\n${indent}]`
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.every(([, entry]) => typeof entry !== 'object' || entry === null)) return JSON.stringify(value)
  return `{\n${entries.map(([key, entry]) => `${inner}${JSON.stringify(key)}: ${jsonText(entry, inner)}`).join(',\n')}\n${indent}}`
}

// The text of a file of counts. Its first line says that the file is held back, as a field of the JSON object.
export const countsFileText = (counts: SavedCounts) => `{"heldBack": ${JSON.stringify(heldBackLine)},\n${Object.entries(counts).map(([key, value]) => ` ${JSON.stringify(key)}: ${jsonText(value, ' ')}`).join(',\n')}\n}\n`

export const logFileName = 'final-runs.log'

// The sizes that the dataset's README gives for the standard set, which the loaded split is held against.
const sizesOfTheDataset = {test: {texts: 12_536, ofHeldOutTemplates: 7_336}, validation: {texts: 5_382}}

if (import.meta.main) {
  refuseUnknownOptions('held-back/final/run.ts', ['--dry-run', '--out', '--again'])
  const dryRun = process.argv.includes('--dry-run')
  if (!dryRun) requireFinal('held-back/final/run.ts without --dry-run')
  if (dryRun && process.env['RECOVERY_FINAL'] !== undefined) throw new Error('held-back/final/run.ts --dry-run runs without the environment variable RECOVERY_FINAL: a dry run scores no changed table on a held-back set and reads no test sample. Leave out one of the two.')
  const outOption = optionOf('--out')
  if (outOption === undefined || outOption.startsWith('--')) throw new Error('name the folder of the outputs with --out <folder>, e.g. --out <recovery-scratch>/transfer/toml/held-back/final')
  const out = resolve(outOption)
  if (!out.split('/').includes('held-back')) throw new Error(`${out} is not below a folder named held-back: the outputs show the held-back sets, and such files go below recovery-scratch/transfer/toml/held-back/ and nowhere else`)
  const again = optionOf('--again')
  if (again !== undefined && (dryRun || again.startsWith('--') || again.trim() === '')) throw new Error('--again "<why>" is for a final run after one that does not count, and takes the reason')
  const positional = process.argv.slice(2).filter((argument, at, all) => !argument.startsWith('--') && all[at - 1] !== '--out' && all[at - 1] !== '--again')
  if (positional.length > 1) throw new Error(`held-back/final/run.ts takes one list file at most, and got ${positional.length}`)
  const listPath = resolve(positional[0] ?? listFile)
  const command = `${dryRun ? '' : 'RECOVERY_FINAL=yes '}bun lab/recovery-toml/held-back/final/run.ts ${process.argv.slice(2).map(argument => argument.includes(' ') ? JSON.stringify(argument) : argument).join(' ')}`

  // The list and its files, before anything is scored.
  const list = readList(listPath)
  const listProblems = problemsOfList(list)
  if (listProblems.length > 0) throw new Error(`the list ${listPath} cannot be scored: ${listProblems.join('; ')}`)
  const fileFacts: FileFacts[] = []
  const listedRows: ScoredRow[] = list.rows.map(row => ({
    label: String(row.row), name: row.name, description: row.description,
    scorers: row.tables.map(({seed, path, sha256}) => {
      const {tables} = loadTablesOfThisDataset(path)
      const problems = problemsOf(tables)
      if (problems.length > 0) throw new Error(`the tables of ${path} break the ground rules: ${problems.slice(0, 4).join('; ')}`)
      const differences = differencesOf(asIsTables(), tables)
      const frozen = differences.filter(difference => !difference.open)
      if (frozen.length > 0) throw new Error(`the tables of ${path} differ from today's in ${frozen.length} cells that are not open, e.g. ${frozen[0]!.name}`)
      const counts = countCells(differences)
      fileFacts.push({row: row.row, seed, path, sha256, structure: structureOf(tables), differFromToday: `${counts.total}: tokenizer ${counts.tokenizer}, grammar ${counts.grammar}, display ${counts.display}`})
      const name = `row ${row.row}${seed === null ? '' : `, seed ${seed}`}`
      return {kind: 'listed' as const, seed, file: path, sha256, quick: parserOfCheckedTables(name, tables), checking: parserOfTables(name, tables), tables}
    }),
  }))
  // One base per structure that a file of the list has, named by the rows that have it.
  const structures = new Map<string, {tables: RecoveryTables, rows: Set<string>}>()
  for (const row of listedRows) {
    for (const scorer of row.scorers) {
      const key = structureKeyOf(scorer.tables!)
      const known = structures.get(key) ?? {tables: scorer.tables!, rows: new Set<string>()}
      known.rows.add(row.label)
      structures.set(key, known)
    }
  }
  const baseRows: ScoredRow[] = [...structures.values()].map(({tables, rows}) => {
    const base = baseOf(tables)
    const name = `what the tables of row${rows.size === 1 ? '' : 's'} ${[...rows].join(', ')} add to today's, with no cell changed`
    return {label: 'base', name, description: structureOf(base), scorers: [{kind: 'base', seed: null, file: null, sha256: null, quick: parserOfCheckedTables(name, base), checking: parserOfTables(name, base), tables: base}]}
  })
  const rows: ScoredRow[] = [
    {label: '1', name: 'the parser as it is', description: 'today\'s tables, which go on after an error and show tokens by their kind', scorers: [{kind: 'as it is', seed: null, file: null, sha256: null, quick: parserAsItIs, checking: parserAsItIs, tables: asIsTables()}]},
    {label: '2', name: 'one rule without training', description: 'after an error, the parser as it is starts anew at the next line (learn/restart-at-next-line.ts)', scorers: [{kind: 'rule', seed: null, file: null, sha256: null, quick: restartAtNextLine, checking: restartAtNextLine, tables: null}]},
    ...listedRows,
  ]

  const git = (...parameters: string[]) => {
    const result = Bun.spawnSync(['git', ...parameters], {cwd: import.meta.dir, stdout: 'pipe', stderr: 'pipe'})
    if (result.exitCode !== 0) throw new Error(`git ${parameters.join(' ')} failed, so the run cannot name the commit of its code: ${result.stderr.toString().trim()}`)
    return result.stdout.toString().trim()
  }
  const commit = git('rev-parse', 'HEAD')
  const uncommittedChanges = git('status', '--porcelain', '--', resolve(import.meta.dir, '../..')) !== ''
  const time = new Date().toISOString()

  mkdirSync(out, {recursive: true})
  const logFile = join(out, logFileName)
  if (!dryRun) {
    const earlierRuns = existsSync(logFile) ? finalRunsIn(readFileSync(logFile, 'utf8')) : 0
    if (earlierRuns > 0 && again === undefined) throw new Error(`${logFile} holds ${earlierRuns} final run${earlierRuns === 1 ? '' : 's'} already. The final scoring runs once. If a run does not count, e.g. because the tooling failed halfway, say why with --again "<why>".`)
    if (!existsSync(logFile)) writeFileSync(logFile, `${heldBackLine}\n`)
    // The line is written before a text is scored, so a run that fails later is in the log too.
    appendFileSync(logFile, `${JSON.stringify({time, datasetKey: datasetKey(), commit, uncommittedChanges, command, again: again ?? null, list: listPath, listSha256: sha256OfFile(listPath), tables: fileFacts.map(({row, seed, path, sha256}) => ({row, seed, path, sha256}))})}\n`)
  }

  const problems: string[] = []
  const attempt = <Result>(what: string, run: () => Result): Result | undefined => {
    try {
      return run()
    } catch (error) {
      problems.push(`${what} failed: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  const generator = generatorSet()
  const written = writtenSet()
  const split = dryRun ? 'validation' : 'test'
  const dataset = datasetSet(split)
  const ofHeldOutTemplates = dataset.ofHeldOutTemplate.filter(Boolean).length
  if (dataset.indexesMade !== 60_000) problems.push(`the dataset's samples were made for ${dataset.indexesMade} indexes, and the standard set has 60,000`)
  if (dataset.texts.length !== sizesOfTheDataset[split].texts) problems.push(`the ${split} split has ${dataset.texts.length} samples here, and the dataset's README says ${sizesOfTheDataset[split].texts}`)
  if (!dryRun && ofHeldOutTemplates !== sizesOfTheDataset.test.ofHeldOutTemplates) problems.push(`${ofHeldOutTemplates} samples of the test split are of a held-out template, and the dataset's README says ${sizesOfTheDataset.test.ofHeldOutTemplates}`)
  if (dryRun && (finalIsAllowed() || dataset.labeledTexts.some(text => text.split === 'test'))) problems.push('a dry run kept a sample of the test split')

  // The dataset's samples as ../../learn/score.ts takes them, whole and in the two parts by the template.
  const placesOf = (heldOut: boolean) => Int32Array.from(dataset.ofHeldOutTemplate.flatMap((value, place) => value === heldOut ? [place] : []))
  const learnSets = attempt('the loading of the dataset\'s samples for the second count', () => {
    const whole = samplesOf(dataset.labeledTexts, dataset.seed)
    const parts: {name: string, samples: Samples}[] = [
      {name: datasetRowOfHeldOutTemplates, samples: selectSamples(whole, placesOf(true))},
      {name: datasetRowOfTrainTemplates, samples: selectSamples(whole, placesOf(false))},
    ]
    return {whole, parts}
  })

  // A dry run gives no text of a held-back set to the tables of a listed file. From here on the run stops for nothing.
  const scoresHeldBack = (scorer: Scorer) => !dryRun || scorer.kind !== 'listed'
  const secondCounts: Comparison = {compared: 0, different: []}

  const countsOfScorer = (label: string, scorer: Scorer): FileCounts | undefined => attempt(`the scoring of ${scorer.quick.name}`, () => {
    const onHeldBack = scoresHeldBack(scorer)
    const rightPerText: FileCounts['rightPerText'] = {generator: onHeldBack ? [] : null, written: onHeldBack ? [] : null, dataset: []}
    const counts: FileCounts = {
      seed: scorer.seed, file: scorer.file, sha256: scorer.sha256,
      generator: rightPerText.generator === null ? null : countsOf(scorer.quick, generator, rightPerText.generator),
      written: rightPerText.written === null ? null : countsOf(scorer.quick, written, rightPerText.written),
      dataset: countsOf(scorer.quick, dataset, rightPerText.dataset),
      rightPerText,
      labelKinds: {
        generator: onHeldBack ? labelKindCountsOf(scorer.quick, generator, mainRows.generator) : null,
        written: onHeldBack ? labelKindCountsOf(scorer.quick, written, mainRows.written) : null,
        dataset: labelKindCountsOf(scorer.quick, dataset, mainRows.dataset),
      },
    }
    const who = `row ${label}${scorer.seed === null ? '' : `, seed ${scorer.seed}`}`
    attempt(`the second count of ${scorer.quick.name}`, () => {
      if (counts.generator !== null) compareWithGeneratorScorer(who, scorer.checking, counts.generator, generator, secondCounts)
      if (counts.written !== null) compareWithWrittenScorer(who, scorer.checking, counts.written, written, secondCounts)
      if (learnSets === undefined) return
      const {tables} = scorer
      compareWithLearnScorer(who, counts.dataset, learnSets.whole, learnSets.parts, (samples, breakdowns) => (tables === null ? scoreRestartAtNextLine(samples, {splits: [split], breakdowns}) : scoreTables(tables, samples, {splits: [split], breakdowns})).rows, secondCounts)
    })
    return counts
  })
  const countsOfRow = ({label, name, description, scorers}: ScoredRow): RowCounts => ({label, name, description, files: scorers.flatMap(scorer => countsOfScorer(label, scorer) ?? [])})
  const rowCounts = rows.map(countsOfRow)
  const baseCounts = baseRows.map(countsOfRow)
  for (const [row, scored] of [...rows, ...baseRows].map((row, at) => [row, [...rowCounts, ...baseCounts][at]!] as const)) {
    if (scored.files.length !== row.scorers.length) problems.push(`the row ${row.label} (${row.name}) has the counts of ${scored.files.length} of its ${row.scorers.length} files`)
  }

  // Tables with no cell changed have the counts of the parser as it is, in every row of every set.
  const unchangedTables: Comparison = {compared: 0, different: []}
  const asItIs = rowCounts[0]!.files[0]
  for (const base of baseCounts) {
    for (const file of base.files) {
      for (const set of ['generator', 'written', 'dataset'] as const) {
        const [mine, expected] = [file[set], asItIs?.[set]]
        if (mine === null || mine.length !== expected?.length) {
          unchangedTables.different.push(`${base.name}, ${set}: other rows than the parser as it is`)
          continue
        }
        mine.forEach((row, at) => compare(`${base.name}, ${set}, ${row.name}`, row, expected[at]!, unchangedTables))
      }
    }
  }

  // Valid documents, and broken texts before their first error, are shown as today by every table.
  const asToday: AsTodayFacts[] = []
  for (const [name, set, heldBack] of [['the generator\'s set', generator, true], ['the written set', written, true], [dryRun ? 'the validation split' : 'the dataset\'s test split', dataset, false]] as const) {
    attempt(`the check of ${name} against the parser as it is`, () => {
      const todays = todaysTracesOf(parserAsItIs, set)
      const facts: AsTodayFacts = {set: name, parsers: 0, documents: todays.documents, validCodePoints: todays.validCodePoints, validDifferences: 0, brokenTexts: todays.brokenTexts, beforeErrorCodePoints: todays.beforeErrorCodePoints, beforeErrorDifferences: 0}
      for (const scorer of [...baseRows, ...listedRows].flatMap(row => row.scorers)) {
        if (heldBack && !scoresHeldBack(scorer)) continue
        const differences = differencesFromToday(scorer.quick, todays)
        facts.parsers++
        facts.validDifferences += differences.validDifferences
        facts.beforeErrorDifferences += differences.beforeErrorDifferences
      }
      asToday.push(facts)
      if (facts.validDifferences + facts.beforeErrorDifferences > 0) problems.push(`on ${name}, tables show ${facts.validDifferences} code points of valid documents and ${facts.beforeErrorDifferences} code points before a first error otherwise than the parser as it is`)
    })
  }
  if (secondCounts.different.length > 0) problems.push(`${secondCounts.different.length} counts differ from the count of a set's own scorer, e.g. ${secondCounts.different.slice(0, 3).join('; ')}`)
  if (unchangedTables.different.length > 0) problems.push(`${unchangedTables.different.length} counts of tables with no cell changed differ from the parser as it is, e.g. ${unchangedTables.different.slice(0, 3).join('; ')}`)

  const reportFile = join(out, dryRun ? 'dry-run.report.md' : 'final.report.md')
  const countsFile = join(out, dryRun ? 'dry-run.counts.json' : 'final.counts.json')
  // A final run's files are kept: what an earlier final run wrote under the same names is moved away first.
  const earlier = [reportFile, countsFile].filter(file => !dryRun && existsSync(file))
  if (earlier.length > 0) {
    let earlierFolder = join(out, `earlier-${time.replaceAll(/[^0-9T]/g, '').slice(0, 15)}`)
    while (existsSync(earlierFolder)) earlierFolder += '-again'
    mkdirSync(earlierFolder)
    for (const file of earlier) renameSync(file, join(earlierFolder, basename(file)))
  }
  const facts: RunFacts = {
    dryRun, time, commit, uncommittedChanges, command, listFile: listPath, listSha256: sha256OfFile(listPath), datasetKey: datasetKey(), countsFile,
    titles: {generator: generator.title, written: written.title, dataset: dataset.title},
    texts: {
      generator: {ids: generator.texts.map(text => text.id), scored: scoredPerTextOf(generator)},
      written: {ids: written.texts.map(text => text.id), scored: scoredPerTextOf(written)},
      dataset: {ids: dataset.texts.map(text => text.id), scored: scoredPerTextOf(dataset)},
    },
    files: fileFacts, secondCounts, unchangedTables, asToday,
    datasetSplit: {split, indexesMade: dataset.indexesMade, texts: dataset.texts.length, ofHeldOutTemplates}, problems,
  }
  // The counts first: report.ts writes the report of a file of counts again without scoring anything.
  writeFileSync(countsFile, countsFileText({format: 'recovery-toml final counts 1', ...facts, rows: rowCounts, bases: baseCounts}))
  const report = describeReport(rowCounts, baseCounts, facts)
  writeFileSync(reportFile, `${report.join('\n')}\n`)
  console.log(report.join('\n'))
  console.log(`${dryRun ? dryRunMark : ''}\n${dryRun ? dryRunMark : ''}The report is in ${reportFile}, and every count in ${countsFile}.${problems.length === 0 ? '' : ` The run had ${problems.length} problems, see the top of the report.`}`)
  if (problems.length > 0) process.exitCode = 1
}
