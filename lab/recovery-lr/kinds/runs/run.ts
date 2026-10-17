// Runs the frozen recipe of ../../learn/recipe.ts on the mixed train split of ../mixed.ts for one seed, with nothing
// tuned or changed, and saves the tables of two rows with one record each:
//   row 9   the training, then the count
//   row 10  the training, then the search, then the count
// One training gives both rows, as in ../../learn/runs/run.ts, whose file names and record this command keeps, with
// more scores in the record: on the mixed validation split, on each of its halves, and on the dataset's own
// validation split.
//
// Run from the repo root: bun lab/recovery-lr/kinds/runs/run.ts --seed 1 --folder <folder outside the repo>
// A seed that has a record in the folder is not run again unless --again is given. --train and --validation take
// fewer samples, to try the command.
//
// The only difference from the recipe is where the train samples come from: prepareMixedRecipe of ../mixed.ts in
// the place of prepareRecipe. So the rule that picks code points for terminals of their own reads the mixed train
// samples too. It reads the train and the validation split only, and no held-back set.
import {existsSync, mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {loadPacked} from '../../learn/data.ts'
import {flagOf, numberOf, optionOf, refuseUnknownOptions, standardTrainCount, standardValidationCount} from '../../learn/options.ts'
import {type RecipeRow, countedTables, recipeRowNames, recipeSettings, searchedTables, trainedTables} from '../../learn/recipe.ts'
import {type RecoveryTables, changeableCellsOf, datasetKey, differencesOf, saveTables} from '../../learn/recovery-tables.ts'
import {recordFileNameOf, sha256OfFile, stateOfTheWorktree, tablesFileNameOf} from '../../learn/runs/runs.ts'
import {scoreHeader, scoreRow, scoreTables} from '../../learn/score.ts'
import {mixedPacked, prepareMixedRecipe} from '../mixed.ts'

refuseUnknownOptions('kinds/runs/run.ts', ['--seed', '--folder', '--train', '--validation'], ['--again'])
const seed = Number(optionOf('--seed'))
if (!Number.isInteger(seed) || seed < 1) throw new Error(`kinds/runs/run.ts needs --seed with a whole number from 1 up, and got ${optionOf('--seed')}`)
const folder = optionOf('--folder')
if (folder === undefined) throw new Error('kinds/runs/run.ts needs --folder, a folder outside the repo for the tables and the records')
const trainSamples = numberOf('--train', standardTrainCount), validationSamples = numberOf('--validation', standardValidationCount)
if (!flagOf('--again') && existsSync(join(folder, recordFileNameOf(9, seed)))) throw new Error(`${folder} has a record for seed ${seed}. Give --again to run the seed again from nothing.`)
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

const prepared = prepareMixedRecipe(trainSamples)
const validationSets = {
  mixed: mixedPacked('validation', validationSamples, prepared.base),
  neutralHalf: mixedPacked('validation', validationSamples, prepared.base, undefined, 'neutral'),
  kindsHalf: mixedPacked('validation', validationSamples, prepared.base, undefined, 'kinds'),
  dataset: loadPacked('validation', validationSamples, prepared.base),
}
log(`${prepared.train.sampleCount} mixed train samples with ${prepared.train.scoredCodePoints} scored code points and ${validationSets.mixed.sampleCount} mixed validation samples, made and packed in ${((performance.now() - commandStarted) / 1000).toFixed(0)} s. The rule picks ${prepared.pickedTerminals.length === 0 ? 'no code point' : prepared.pickedTerminals.map(terminal => `\`${String.fromCodePoint(terminal.codePoint)}\``).join(' ')} for a terminal of its own. ${changeableCellsOf(prepared.base).length} cells may change.`)

const {tables: trained, training} = await trainedTables(prepared, seed, {log, validation: validationSets.mixed})
const searchStarted = performance.now()
const rows: {row: RecipeRow, tables: RecoveryTables, searchSeconds: number}[] = [{row: 9, tables: countedTables(prepared, trained), searchSeconds: 0}]
const searched = await searchedTables(prepared, trained, seed, {log})
rows.push({row: 10, tables: countedTables(prepared, searched), searchSeconds: (performance.now() - searchStarted) / 1000})

const scoresOf = (tables: RecoveryTables) => ({
  mixed: scoreTables(tables, validationSets.mixed).score, neutralHalf: scoreTables(tables, validationSets.neutralHalf).score, kindsHalf: scoreTables(tables, validationSets.kindsHalf).score,
  dataset: scoreTables(tables, validationSets.dataset).score,
})
console.log('')
console.log(scoreHeader)
for (const {row, tables, searchSeconds} of rows) {
  const tablesFile = join(folder, tablesFileNameOf(row, seed))
  saveTables(tablesFile, tables, `recipe row ${row} (${recipeRowNames[row]}) on the mixed train split, seed ${seed}, ${prepared.train.sampleCount} train samples`)
  const differences = differencesOf(prepared.base, tables)
  const validation = scoresOf(tables)
  const record = {
    format: 'recovery-lr mixed run record 1', row, rowName: recipeRowNames[row], seed, trainSet: 'the mixed train split of lab/recovery-lr/kinds/mixed.ts',
    trainSamples: prepared.train.sampleCount, validationSamples: validationSets.mixed.sampleCount, datasetKey: datasetKey(),
    commit: worktree.commit, uncommittedFiles: worktree.uncommittedFiles, startedAt, finishedAt: new Date().toISOString(),
    seconds: {trainingPerPass: training.secondsPerPass, search: searchSeconds, command: (performance.now() - commandStarted) / 1000},
    settings: {...recipeSettings, orderSeedOfTheSearch: seed * 10 + recipeSettings.searchOrder, workerThreads: 4},
    pickedTerminals: prepared.pickedTerminals.map(terminal => String.fromCodePoint(terminal.codePoint)),
    cellsThatMayChange: changeableCellsOf(prepared.base).length,
    cellsChanged: differences.filter(difference => difference.table === 'cells').length,
    displayEntriesChanged: differences.filter(difference => difference.table === 'display').length,
    tablesFile: tablesFileNameOf(row, seed), sha256: sha256OfFile(tablesFile),
    // The scores on the four validation sets: of the row's tables, of the tables that the row started from, and
    // of the snapped tables before the search and the count.
    validation, validationOfTheStart: scoresOf(prepared.base), validationAfterTheTrainingAlone: scoresOf(trained),
    train: scoreTables(tables, prepared.train).score,
    log: logged,
  }
  writeFileSync(join(folder, recordFileNameOf(row, seed)), `${JSON.stringify(record, null, 1)}\n`)
  console.log(scoreRow(`row ${row}, seed ${seed}, on the mixed validation split`, validation.mixed))
  console.log(scoreRow(`row ${row}, seed ${seed}, on its half with the dataset's damage`, validation.neutralHalf))
  console.log(scoreRow(`row ${row}, seed ${seed}, on its half with the kinds`, validation.kindsHalf))
  console.log(scoreRow(`row ${row}, seed ${seed}, on the dataset's own validation split`, validation.dataset))
  console.log(scoreRow(`row ${row}, seed ${seed}, on the mixed train split`, record.train))
  console.log(`Saved ${tablesFile}, sha256 ${record.sha256}.`)
}
console.log(`The command took ${((performance.now() - commandStarted) / 1000).toFixed(0)} s.`)
