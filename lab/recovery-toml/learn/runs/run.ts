// Runs rows of the experiment for one seed on the train split of the standard set, and saves each row's tables with
// a record: the settings, the dataset's key, the commit, the time and the scores on the validation split.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-toml/learn/runs/run.ts --rows 4,5 --seed 1      # the frozen recipe: one training gives both rows
//   bun lab/recovery-toml/learn/runs/run.ts --rows 6 --seed 11       # the search and the count without the training
// The files go to <RECOVERY_SCRATCH>/neutral/, or to --folder: row-4.seed-1.tables.json and row-4.seed-1.record.json.
// A row that has a record there is not run again unless --again is given.
//
// --rows 4,5 calls runRecipe of ../recipe.ts as it stands and saves its two results. --rows 6 runs the parts of the
// recipe that the control "search-alone" of the JSON side has: the base, the search from the base, and the count.
// runs.ts says more about the rows.
//
// --to runs on the dataset's samples 0 to `to - 1` in place of the standard set's 60,000, to try the command in a
// minute. Such a run has to name its folder with --folder, so that it never lands among the real runs.
import {existsSync, mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {type Samples, datasetKey, loadSamples, standardRange, trainPart, validationPart} from '../data.ts'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {
  baseOfRecipe, classesChosenFromTrainSamples, describeRow, differencesOnTooDeepTexts, displayEntriesByCount, recipeSettings, runRecipe, searchedCellsOf, tooDeepTextsOfTheCheck, trainableGrammarCellsOf,
  withTodaysKindsInErrorState,
} from '../recipe.ts'
import {type RecoveryTables, asIsTables, cellCounts, saveTables} from '../recovery-tables.ts'
import {cellCountsOf} from '../score.ts'
import {prepareSamples} from '../search/sample-runs.ts'
import {searchCells} from '../search/search.ts'
import {type RunRecord, type RunRow, parserOfTables, recordFileNameOf, restartAtNextLine, rowNames, runsFolderOf, scoreRowsOf, sha256OfFile, sourcesHash, stateOfTheWorktree, tablesFileNameOf} from './runs.ts'

refuseUnknownOptions('runs/run.ts', ['--rows', '--seed', '--folder', '--to', '--again'])
const rowsOption = optionOf('--rows')
if (rowsOption !== '4,5' && rowsOption !== '6') throw new Error(`runs/run.ts needs --rows 4,5 (the frozen recipe, whose one training gives both rows) or --rows 6 (the search and the count without the training), and got ${rowsOption}`)
const seed = Number(optionOf('--seed'))
if (!Number.isInteger(seed) || seed < 1) throw new Error(`runs/run.ts needs --seed with a whole number from 1 up, and got ${optionOf('--seed')}`)
const range = standardRange()
const to = Number(optionOf('--to') ?? range.to)
if (to !== range.to && optionOf('--folder') === undefined) throw new Error('a run with --to is a try of the command and not a run of the experiment: name its folder with --folder')
const folder = runsFolderOf(optionOf('--folder'))
const rows: RunRow[] = rowsOption === '6' ? [6] : [4, 5]
if (!process.argv.includes('--again')) {
  const saved = rows.filter(row => existsSync(join(folder, recordFileNameOf(row, seed))))
  if (saved.length > 0) throw new Error(`${folder} has a record of row ${saved.join(' and ')} for seed ${seed}. Give --again to run the seed again from nothing.`)
}
mkdirSync(folder, {recursive: true})

const commandStarted = performance.now()
const startedAt = new Date().toISOString()
const worktree = stateOfTheWorktree()
const hashOfTheSources = sourcesHash()
const samples = loadSamples(range.seed, range.from, to)
const trainSamples = trainPart(samples)
const validation = validationPart(samples)
const tooDeepTexts = tooDeepTextsOfTheCheck(2000)
console.log(`Dataset ${datasetKey()}, seed ${range.seed}, the samples ${range.from} to ${to - 1}: ${trainSamples.sampleCount} train samples, ${validation.sampleCount} validation samples. Commit ${worktree.commit}${worktree.uncommittedFiles.length === 0 ? '' : `, with ${worktree.uncommittedFiles.length} files that differ from it`}.`)
console.log(describeRow('Row 1, the parser as it is, on the validation split', scoreRowsOf(parserOfTables(asIsTables()), validation)[0]!))
console.log(describeRow('Row 2, anew at the next line after an error', scoreRowsOf(restartAtNextLine, validation)[0]!))

type Made = {row: RunRow, tables: RecoveryTables, steps: string[], nextTo: {name: string, tables: RecoveryTables}}
type Shared = {base: RecoveryTables, classes: string[], keptGrammarCells: number, search: RunRecord['search'], trainingSeconds: number, searchSeconds: number}

const stepsOfTheBase = ['today\'s tables with the classes that the rule picks from the train samples, open display entries and the bit "first on its line"']
const stepOfTheTraining = `the training: ${recipeSettings.passes} passes over the train samples in batches of ${recipeSettings.batchSize}, learning rate ${recipeSettings.learningRate}, from a share of ${recipeSettings.startShare} on the base's choice, with the kept grammar cells and without the events of a text's end`
const stepOfTheSearch = `the search: at most ${recipeSettings.searchPasses} passes over every open tokenizer cell and every grammar cell that is not kept, in a random order per pass`
const stepOfTheCount = 'the count: every open display entry gets the kind that the most train code points want there'
const lastStep = 'today\'s kinds in the display entries of the grammar state error'

async function makeRows4And5(allSamples: Samples): Promise<{made: Made[], shared: Shared}> {
  const result = await runRecipe(allSamples, seed, {search: true, log: line => console.log(line)})
  if (result.withSearch === undefined || result.search === undefined) throw new Error('runRecipe gave no tables of the row with the search')
  const afterTheTraining = {name: 'the tables after the training alone', tables: result.trained}
  return {
    made: [
      {row: 4, tables: result.primary, steps: [...stepsOfTheBase, stepOfTheTraining, stepOfTheCount, lastStep], nextTo: afterTheTraining},
      {row: 5, tables: result.withSearch, steps: [...stepsOfTheBase, stepOfTheTraining, stepOfTheSearch, stepOfTheCount, lastStep], nextTo: afterTheTraining},
    ],
    shared: {base: result.base, classes: result.classes.map(added => added.name), keptGrammarCells: result.keptGrammarCells, search: result.search, trainingSeconds: result.trainingSeconds, searchSeconds: result.searchSeconds},
  }
}

async function makeRow6(): Promise<{made: Made[], shared: Shared}> {
  const classes = classesChosenFromTrainSamples(trainSamples)
  const base = baseOfRecipe(classes)
  const keptGrammarCells = cellCounts(base).grammarOpen - trainableGrammarCellsOf(base).reduce((total, bit) => total + bit, 0)
  console.log(`The rule picks ${classes.length} classes. The base has ${base.classCount} classes and ${base.contextCount} contexts. ${keptGrammarCells} grammar cells are kept. Searching on ${trainSamples.sampleCount} train samples.`)
  const started = performance.now()
  const found = await searchCells(base, searchedCellsOf(base), prepareSamples(trainSamples, base), seed * 10 + recipeSettings.searchOrder, recipeSettings.searchPasses)
  const searchSeconds = (performance.now() - started) / 1000
  console.log(`The search took ${searchSeconds.toFixed(0)} s: ${found.passes} passes, ${found.changes} changes of a cell, ${(found.runs / 1e6).toFixed(1)} million runs of a sample.`)
  const tables = displayEntriesByCount(found.tables, trainSamples)
  return {
    made: [{row: 6, tables, steps: [...stepsOfTheBase, stepOfTheSearch, stepOfTheCount], nextTo: {name: `the saved tables with the recipe's last step added: ${lastStep}`, tables: withTodaysKindsInErrorState(tables)}}],
    shared: {base, classes: classes.map(added => added.name), keptGrammarCells, search: {passes: found.passes, lastPassChangedNothing: found.lastPassChangedNothing, changes: found.changes, runs: found.runs}, trainingSeconds: 0, searchSeconds},
  }
}

const {made, shared} = rowsOption === '6' ? await makeRow6() : await makeRows4And5(samples)
for (const {row, tables, steps, nextTo} of made) {
  const tablesFile = join(folder, tablesFileNameOf(row, seed))
  saveTables(tablesFile, tables, `row ${row}, seed ${seed}: ${rowNames[row]}`)
  const validationRows = scoreRowsOf(parserOfTables(tables), validation)
  const cells = cellCountsOf(tables, shared.base)
  const record: RunRecord = {
    format: 'recovery-toml run record 1', row, rowName: rowNames[row], seed,
    trainedOn: {datasetSeed: range.seed, from: range.from, to, trainSamples: trainSamples.sampleCount, validationSamples: validation.sampleCount},
    datasetKey: datasetKey(), commit: worktree.commit, uncommittedFiles: worktree.uncommittedFiles, sourcesHash: hashOfTheSources,
    startedAt, finishedAt: new Date().toISOString(),
    seconds: {training: shared.trainingSeconds, search: row === 4 ? 0 : shared.searchSeconds, command: (performance.now() - commandStarted) / 1000},
    settings: {...recipeSettings, orderSeedOfTheSearch: seed * 10 + recipeSettings.searchOrder, workerThreads: 4},
    steps, classes: shared.classes, keptGrammarCells: shared.keptGrammarCells, search: row === 4 ? null : shared.search,
    tablesFile: tablesFileNameOf(row, seed), sha256: sha256OfFile(tablesFile),
    validation: validationRows, train: scoreRowsOf(parserOfTables(tables), trainSamples, 'train')[0]!,
    nextTo: {name: nextTo.name, validation: scoreRowsOf(parserOfTables(nextTo.tables), validation)[0]!},
    tooDeepValidTexts: {texts: tooDeepTexts.length, ...differencesOnTooDeepTexts(tables, tooDeepTexts)},
    cellsChangedAgainstBase: cells.changedAgainstBase!, cellsThatDifferFromToday: cells.differFromToday,
  }
  writeFileSync(join(folder, recordFileNameOf(row, seed)), `${JSON.stringify(record, null, 1)}\n`)
  console.log(describeRow(`Row ${row}, seed ${seed}, ${rowNames[row]}`, validationRows[0]!))
  console.log(`  ${nextTo.name}: ${describeRow('', record.nextTo.validation).slice(2)}`)
  console.log(`  On the train split: ${describeRow('', record.train).slice(2)}`)
  console.log(`  On ${tooDeepTexts.length} too deep valid texts, ${record.tooDeepValidTexts.codePoints} code points from the first error on: ${record.tooDeepValidTexts.nesting} other depths or containers than today, ${record.tooDeepValidTexts.kind} other display kinds.`)
  console.log(`  Saved ${tablesFile}, sha256 ${record.sha256}.`)
}
