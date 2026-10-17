// Runs rows of the frozen recipe of ../recipe.ts for one seed, with nothing tuned or changed, and saves each row's
// tables with a record: the settings, the seed, the commit, the times, the score on the validation split and the
// score on the train split.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/learn/runs/run.ts --rows 9,10 --seed 1     # one training gives both rows
//   bun lab/recovery-lr/learn/runs/run.ts --rows 11 --seed 11      # the search and the count without training
//   bun lab/recovery-lr/learn/runs/run.ts --rows 12 --seed 1       # row 9 without the choice "end an item early"
// The files go to --folder, or to <RECOVERY_LR_SCRATCH>/runs/neutral: row-9.seed-1.tables.json and
// row-9.seed-1.record.json. A row that has a record there is not run again unless --again is given.
//
// --train and --validation take fewer samples than the standard 40,000 and 5,000, to try the command in a minute.
// Such a run has to name its folder with --folder, so that it never lands among the real runs.
//
// It reads the train and the validation split only, and no held-back set.
import {existsSync, mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {loadPacked} from '../data.ts'
import {flagOf, numberOf, optionOf, refuseUnknownOptions, standardTrainCount, standardValidationCount} from '../options.ts'
import {type RecipeRow, prepareRecipe, recipeRowNames, recipeSettings, rowsOfRecipe} from '../recipe.ts'
import {changeableCellsOf, datasetKey, differencesOf, saveTables} from '../recovery-tables.ts'
import {scoreHeader, scoreRow, scoreTables} from '../score.ts'
import {type RunRecord, recordFileNameOf, runsFolderOf, sha256OfFile, stateOfTheWorktree, tablesFileNameOf} from './runs.ts'

refuseUnknownOptions('runs/run.ts', ['--rows', '--seed', '--folder', '--train', '--validation'], ['--again'])
const rowsOption = optionOf('--rows')
if (rowsOption !== '9,10' && rowsOption !== '11' && rowsOption !== '12') throw new Error(`runs/run.ts needs --rows 9,10 (one training gives both rows), --rows 11 (the search and the count without training) or --rows 12 (row 9 without "end an item early"), and got ${rowsOption}`)
const rows = rowsOption.split(',').map(Number) as RecipeRow[]
const seed = Number(optionOf('--seed'))
if (!Number.isInteger(seed) || seed < 1) throw new Error(`runs/run.ts needs --seed with a whole number from 1 up, and got ${optionOf('--seed')}`)
const trainSamples = numberOf('--train', standardTrainCount), validationSamples = numberOf('--validation', standardValidationCount)
if ((trainSamples !== standardTrainCount || validationSamples !== standardValidationCount) && optionOf('--folder') === undefined) throw new Error('a run with --train or --validation is a try of the command and not a run of the experiment: name its folder with --folder')
const folder = runsFolderOf(optionOf('--folder'))
if (!flagOf('--again')) {
  const saved = rows.filter(row => existsSync(join(folder, recordFileNameOf(row, seed))))
  if (saved.length > 0) throw new Error(`${folder} has a record of row ${saved.join(' and ')} for seed ${seed}. Give --again to run the seed again from nothing.`)
}
mkdirSync(folder, {recursive: true})

const commandStarted = performance.now()
const startedAt = new Date().toISOString()
const worktree = stateOfTheWorktree()
const logged: string[] = []
const log = (line: string) => {
  console.log(line)
  logged.push(line)
}
log(`bun ${process.argv.slice(1).join(' ')}`)
log(`Dataset ${datasetKey()}. Commit ${worktree.commit}${worktree.uncommittedFiles.length === 0 ? '' : `, with ${worktree.uncommittedFiles.length} files under lab/recovery-lr that differ from it`}.`)

// The tables that the rows start from, with and without "end an item early", read the same packed samples.
const prepared = prepareRecipe(trainSamples)
const validation = loadPacked('validation', validationSamples, prepared.base)
log(`${prepared.train.sampleCount} train samples and ${validation.sampleCount} validation samples, made and packed in ${((performance.now() - commandStarted) / 1000).toFixed(0)} s.`)

const results = await rowsOfRecipe(seed, rows, {trainSamples, log, validation})
const searchLine = logged.find(line => line.startsWith('The search ended'))
const searchSeconds = searchLine === undefined ? 0 : Number(/in (\d+) s\.$/.exec(searchLine)?.[1] ?? NaN)

console.log('')
console.log(scoreHeader)
for (const result of results) {
  const tablesFile = join(folder, tablesFileNameOf(result.row, seed))
  saveTables(tablesFile, result.tables, `recipe row ${result.row} (${result.name}), seed ${seed}, ${prepared.train.sampleCount} train samples`)
  const differences = differencesOf(result.base, result.tables)
  const record: RunRecord = {
    format: 'recovery-lr run record 1', row: result.row, rowName: recipeRowNames[result.row], seed,
    trainSamples: prepared.train.sampleCount, validationSamples: validation.sampleCount, datasetKey: datasetKey(),
    commit: worktree.commit, uncommittedFiles: worktree.uncommittedFiles, startedAt, finishedAt: new Date().toISOString(),
    seconds: {trainingPerPass: result.training?.secondsPerPass ?? [], search: result.row === 10 || result.row === 11 ? searchSeconds : 0, command: (performance.now() - commandStarted) / 1000},
    settings: {...recipeSettings, orderSeedOfTheSearch: seed * 10 + recipeSettings.searchOrder, workerThreads: 4},
    pickedTerminals: prepared.pickedTerminals.map(terminal => String.fromCodePoint(terminal.codePoint)),
    cellsThatMayChange: changeableCellsOf(result.base).length,
    cellsChanged: differences.filter(difference => difference.table === 'cells').length,
    displayEntriesChanged: differences.filter(difference => difference.table === 'display').length,
    tablesFile: tablesFileNameOf(result.row, seed), sha256: sha256OfFile(tablesFile),
    validation: scoreTables(result.tables, validation).score,
    validationOfTheStart: scoreTables(result.base, validation).score,
    validationAfterTheTrainingAlone: result.trained === undefined ? null : scoreTables(result.trained, validation).score,
    train: scoreTables(result.tables, prepared.train).score,
    log: logged,
  }
  writeFileSync(join(folder, recordFileNameOf(result.row, seed)), `${JSON.stringify(record, null, 1)}\n`)
  console.log(scoreRow(`row ${result.row}, seed ${seed}, on the validation split: ${result.name}`, record.validation))
  if (record.validationAfterTheTrainingAlone !== null) console.log(scoreRow(`row ${result.row}, seed ${seed}, on the validation split: the snapped tables after the training alone`, record.validationAfterTheTrainingAlone))
  console.log(scoreRow(`row ${result.row}, seed ${seed}, on the train split`, record.train))
  console.log(`Saved ${tablesFile}, sha256 ${record.sha256}.`)
}
console.log(`The command took ${((performance.now() - commandStarted) / 1000).toFixed(0)} s.`)
