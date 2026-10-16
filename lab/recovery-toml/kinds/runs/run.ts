// Runs the frozen recipe for one seed on the train split of the mixed set, and saves the tables of its two rows with
// a record each: the settings, the dataset's key, the key of the kinds, the commit, the times and the scores on the
// mixed validation split.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-toml/kinds/runs/run.ts --seed 1
// One training gives both rows: row 7, the training, the count and the last step, and row 8, the same with the search
// before the count. The files go to <RECOVERY_SCRATCH>/mixed/, or to --folder: row-7.seed-1.tables.json,
// row-7.seed-1.record.json and the same for row 8. A seed that has a record there is not run again unless --again is
// given.
//
// The command calls runRecipe of ../../learn/recipe.ts as it stands, with mixedSet() of ../mixed.ts in the place of
// the dataset's standard set. runRecipe reads its train samples from the set that it is given, so the rule of the
// classes, the training, the search and the count all read the mixed train split. The kept grammar cells come from
// valid texts that are too deep and from the base, which holds the classes of the rule. No setting is read from
// anywhere else, and this file sets none.
//
// --to runs on the mixed set of the dataset's indexes 0 to `to - 1` in place of the standard set's 60,000, to try the
// command in a minute. Such a run has to name its folder with --folder, so that it never lands among the real runs.
import {existsSync, mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {datasetKey, trainPart, validationPart} from '../../learn/data.ts'
import {optionOf, refuseUnknownOptions} from '../../learn/options.ts'
import {describeRow, differencesOnTooDeepTexts, recipeSettings, runRecipe, tooDeepTextsOfTheCheck} from '../../learn/recipe.ts'
import {type RecoveryTables, asIsTables, saveTables} from '../../learn/recovery-tables.ts'
import {parserOfTables, restartAtNextLine, sha256OfFile} from '../../learn/runs/runs.ts'
import {cellCountsOf} from '../../learn/score.ts'
import {kindsKey, mixedSet, standardRange} from '../mixed.ts'
import {type MixedRow, type MixedRunRecord, halfRowsOf, kindsHalfRowName, neutralHalfRowName, recordFileNameOf, rowNamed, rowNames, runsFolderOf, scoreRowsOfMixed, sourcesHash, stateOfTheWorktree, tablesFileNameOf} from './mixed-runs.ts'

refuseUnknownOptions('kinds/runs/run.ts', ['--seed', '--folder', '--to', '--again'])
const seed = Number(optionOf('--seed'))
if (!Number.isInteger(seed) || seed < 1) throw new Error(`kinds/runs/run.ts needs --seed with a whole number from 1 up, and got ${optionOf('--seed')}`)
const to = Number(optionOf('--to') ?? standardRange.to)
if (to !== standardRange.to && optionOf('--folder') === undefined) throw new Error('a run with --to is a try of the command and not a run of the experiment: name its folder with --folder')
const range = {...standardRange, to}
const folder = runsFolderOf(optionOf('--folder'))
const rows: MixedRow[] = [7, 8]
if (!process.argv.includes('--again')) {
  const saved = rows.filter(row => existsSync(join(folder, recordFileNameOf(row, seed))))
  if (saved.length > 0) throw new Error(`${folder} has a record of row ${saved.join(' and ')} for seed ${seed}. Give --again to run the seed again from nothing.`)
}
mkdirSync(folder, {recursive: true})

const commandStarted = performance.now()
const startedAt = new Date().toISOString()
const worktree = stateOfTheWorktree()
const hashOfTheSources = sourcesHash()
const keyOfTheKinds = kindsKey()
const samples = mixedSet(range)
const secondsOfTheMixedSet = (performance.now() - commandStarted) / 1000
const trainSamples = trainPart(samples)
const validation = validationPart(samples)
const samplesOfHalf = (part: typeof samples) => {
  const source = (name: string) => part.sourceNames.indexOf(name)
  const count = (number: number) => part.source.reduce((total, value) => total + (value === number ? 1 : 0), 0)
  return {neutral: count(source('damage')), kinds: count(source('kinds'))}
}
const trainedOn = {
  set: 'mixed' as const, datasetSeed: range.seed, from: range.from, to, trainSamples: trainSamples.sampleCount, validationSamples: validation.sampleCount,
  trainSamplesOfHalf: samplesOfHalf(trainSamples), validationSamplesOfHalf: samplesOfHalf(validation),
}
const tooDeepTexts = tooDeepTextsOfTheCheck(2000)
console.log(`Dataset ${datasetKey()}, kinds ${keyOfTheKinds}, seed ${range.seed}, the mixed set of the indexes ${range.from} to ${to - 1}: ${trainSamples.sampleCount} train samples (${trainedOn.trainSamplesOfHalf.neutral} of the dataset, ${trainedOn.trainSamplesOfHalf.kinds} of the kinds), ${validation.sampleCount} validation samples (${trainedOn.validationSamplesOfHalf.neutral} and ${trainedOn.validationSamplesOfHalf.kinds}). Commit ${worktree.commit}${worktree.uncommittedFiles.length === 0 ? '' : `, with ${worktree.uncommittedFiles.length} files that differ from it`}.`)
const describeHalves = (name: string, halves: ReturnType<typeof halfRowsOf>) => {
  console.log(describeRow(`${name}, on the mixed validation split`, rowNamed(halves, 'all')!))
  console.log(`  ${describeRow('its half of the dataset', rowNamed(halves, neutralHalfRowName)!)}`)
  console.log(`  ${describeRow('its half of the kinds', rowNamed(halves, kindsHalfRowName)!)}`)
}
describeHalves('Row 1, the parser as it is', halfRowsOf(parserOfTables(asIsTables()), validation, 'validation'))
describeHalves('Row 2, anew at the next line after an error', halfRowsOf(restartAtNextLine, validation, 'validation'))

const stepsOfTheBase = ['today\'s tables with the classes that the rule picks from the mixed train samples, open display entries and the bit "first on its line"']
const stepOfTheTraining = `the training: ${recipeSettings.passes} passes over the mixed train samples in batches of ${recipeSettings.batchSize}, learning rate ${recipeSettings.learningRate}, from a share of ${recipeSettings.startShare} on the base's choice, with the kept grammar cells and without the events of a text's end`
const stepOfTheSearch = `the search: at most ${recipeSettings.searchPasses} passes over every open tokenizer cell and every grammar cell that is not kept, in a random order per pass, on the mixed train samples`
const stepOfTheCount = 'the count: every open display entry gets the kind that the most mixed train code points want there'
const lastStep = 'today\'s kinds in the display entries of the grammar state error'

const result = await runRecipe(samples, seed, {search: true, log: line => console.log(line)})
if (result.withSearch === undefined || result.search === undefined) throw new Error('runRecipe gave no tables of the row with the search')
const afterTheTraining = {name: 'the tables after the training alone', validation: halfRowsOf(parserOfTables(result.trained), validation, 'validation')}
const made: {row: MixedRow, tables: RecoveryTables, steps: string[]}[] = [
  {row: 7, tables: result.primary, steps: [...stepsOfTheBase, stepOfTheTraining, stepOfTheCount, lastStep]},
  {row: 8, tables: result.withSearch, steps: [...stepsOfTheBase, stepOfTheTraining, stepOfTheSearch, stepOfTheCount, lastStep]},
]
for (const {row, tables, steps} of made) {
  const tablesFile = join(folder, tablesFileNameOf(row, seed))
  saveTables(tablesFile, tables, `row ${row}, seed ${seed}, ${rowNames[row]}. Kinds ${keyOfTheKinds}.`)
  const validationRows = scoreRowsOfMixed(parserOfTables(tables), validation)
  const cells = cellCountsOf(tables, result.base)
  const record: MixedRunRecord = {
    format: 'recovery-toml run record 1', row, rowName: rowNames[row], seed, trainedOn,
    datasetKey: datasetKey(), kindsKey: keyOfTheKinds, commit: worktree.commit, uncommittedFiles: worktree.uncommittedFiles, sourcesHash: hashOfTheSources,
    startedAt, finishedAt: new Date().toISOString(),
    seconds: {mixedSet: secondsOfTheMixedSet, training: result.trainingSeconds, search: row === 7 ? 0 : result.searchSeconds, command: (performance.now() - commandStarted) / 1000},
    settings: {...recipeSettings, orderSeedOfTheSearch: seed * 10 + recipeSettings.searchOrder, workerThreads: 4},
    steps, classes: result.classes.map(added => added.name), keptGrammarCells: result.keptGrammarCells, search: row === 7 ? null : result.search,
    tablesFile: tablesFileNameOf(row, seed), sha256: sha256OfFile(tablesFile),
    validation: validationRows, train: halfRowsOf(parserOfTables(tables), trainSamples, 'train'),
    nextTo: afterTheTraining,
    tooDeepValidTexts: {texts: tooDeepTexts.length, ...differencesOnTooDeepTexts(tables, tooDeepTexts)},
    cellsChangedAgainstBase: cells.changedAgainstBase!, cellsThatDifferFromToday: cells.differFromToday,
  }
  writeFileSync(join(folder, recordFileNameOf(row, seed)), `${JSON.stringify(record, null, 1)}\n`)
  describeHalves(`Row ${row}, seed ${seed}, ${rowNames[row]}`, [rowNamed(validationRows, 'all')!, rowNamed(validationRows, neutralHalfRowName)!, rowNamed(validationRows, kindsHalfRowName)!])
  console.log(`  ${describeRow(afterTheTraining.name, rowNamed(afterTheTraining.validation, 'all')!)}`)
  console.log(`  ${describeRow('On the mixed train split', rowNamed(record.train, 'all')!)}`)
  console.log(`  On ${tooDeepTexts.length} too deep valid texts, ${record.tooDeepValidTexts.codePoints} code points from the first error on: ${record.tooDeepValidTexts.nesting} other depths or containers than today, ${record.tooDeepValidTexts.kind} other display kinds.`)
  console.log(`  Saved ${tablesFile}, sha256 ${record.sha256}.`)
}
