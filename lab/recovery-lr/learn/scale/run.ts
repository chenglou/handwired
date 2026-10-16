// What gradient training alone reaches when it gets more passes and more train samples than the frozen recipe of
// ../recipe.ts gives it. This is a study that changes settings on purpose, so its numbers are not rows of the
// frozen recipe. The settings were chosen with the scores of the validation split in view.
//
// One command is one training for one seed. It saves the snapped tables after each of the passes named by --at,
// e.g. after pass 3, 10 and 30 of one training of 30 passes. The trainer has no schedule and draws the order of a
// pass from the seed and the pass, so the tables after pass 3 of a longer training are the tables of a training of
// 3 passes. Each saved point gets the count of the recipe's step 8 and a record: the scores on the validation
// split and on the train samples of the run, the tokens skipped at the limit of 16 steps, the mean of the largest
// share of a cell, and the seconds of training up to that pass. With --search, the tables after the last pass also
// go through the recipe's search and count, as a second record.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/learn/scale/run.ts --seed 1 --train 40000 --passes 30 --at 1,2,3,5,10,20,30 --search --folder <folder>
//   bun lab/recovery-lr/learn/scale/run.ts --seed 1 --train 400000 --passes 3 --at 1,2,3 --folder <folder>
//   [--learning-rate 0.05] [--start-share 0.9] [--validation 5000]
//   bun lab/recovery-lr/learn/scale/run.ts --seed 1 --train 400000 --passes 0 --search --folder <folder>    # the search without training
//
// The train samples are the first --train samples of the train split. The added terminals are always picked from
// the first 40,000 train samples, as in the recipe's runs, so that every run trains the same cells whatever its
// count of train samples is. It reads the train and the validation split only, and no held-back set.
import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {eachSample, loadPacked} from '../data.ts'
import {numberOf, optionOf, flagOf, refuseUnknownOptions, standardTrainCount, standardValidationCount} from '../options.ts'
import {terminalsChosenFromTrainSamples} from '../picked-terminals.ts'
import {recipeSettings} from '../recipe.ts'
import {type RecoveryTables, addFirstOnLineFlag, addTerminals, baseTables, changeableCellsOf, datasetKey, differencesOf, saveTables} from '../recovery-tables.ts'
import {sha256OfFile, stateOfTheWorktree} from '../runs/runs.ts'
import {type RunTotals, type Score, scoreTables, sharesOf} from '../score.ts'
import {displayEntriesByCount} from '../search/count.ts'
import {searchCells} from '../search/search.ts'
import {createModel, meanLargestShare, sharesInto, snappedTables} from '../soft/model.ts'
import {train} from '../soft/train.ts'
import {referenceTwin} from '../soft/twin.ts'

export type ScaleRecord = {
  format: 'recovery-lr scale record 1'
  // 'training, then the count' or 'training, then the search, then the count'.
  steps: string
  seed: number
  trainSamples: number
  validationSamples: number
  // The passes of the training before these tables were snapped, and the steps of Adam that the passes hold.
  passes: number
  gradientSteps: number
  learningRate: number
  startShare: number
  batchSize: number
  datasetKey: string
  commit: string
  uncommittedFiles: string[]
  finishedAt: string
  // Seconds of training alone up to this pass, of the search, and of making and packing the samples.
  seconds: {training: number, search: number, makingTheSamples: number}
  // The mean over the trained cells and entries of the largest share, when these tables were snapped.
  meanLargestShare: number
  cellsChanged: number
  displayEntriesChanged: number
  validation: Score
  validationTotals: RunTotals
  // The score on the train samples that the run trained on.
  train: Score
  trainTotals: RunTotals
  // The line that the trainer logged at this pass.
  trainerLine: string
  tablesFile: string
  sha256: string
}

if (import.meta.main) {
  refuseUnknownOptions('scale/run.ts', ['--seed', '--train', '--passes', '--at', '--learning-rate', '--start-share', '--validation', '--folder'], ['--search'])
  const seed = numberOf('--seed', 1)
  const trainSamples = numberOf('--train', standardTrainCount)
  const passes = numberOf('--passes', recipeSettings.passes)
  const at = passes === 0 ? [] : (optionOf('--at') ?? String(passes)).split(',').map(Number)
  for (const pass of at) if (!Number.isInteger(pass) || pass < 1 || pass > passes) throw new Error(`--at names passes from 1 to ${passes}, and got ${pass}`)
  const learningRate = Number(optionOf('--learning-rate') ?? recipeSettings.learningRate)
  const startShare = Number(optionOf('--start-share') ?? recipeSettings.startShare)
  const folder = optionOf('--folder')
  if (folder === undefined) throw new Error('scale/run.ts needs --folder, a folder outside the repo for the tables and the records')
  mkdirSync(folder, {recursive: true})
  const otherSettings = `${learningRate === recipeSettings.learningRate ? '' : `.rate-${learningRate}`}${startShare === recipeSettings.startShare ? '' : `.start-share-${startShare}`}`
  const nameOf = (pass: number, searched: boolean): string => `train-${trainSamples}.passes-${pass}${otherSettings}${searched ? '.searched' : ''}.seed-${seed}`

  const worktree = stateOfTheWorktree()
  const commandStarted = performance.now()
  console.log(`bun ${process.argv.slice(1).join(' ')}`)
  const pickedTerminals = terminalsChosenFromTrainSamples(eachSample('train', standardTrainCount))
  const base = addFirstOnLineFlag(addTerminals(baseTables(), pickedTerminals))
  const trainPacked = loadPacked('train', trainSamples, base)
  const validation = loadPacked('validation', numberOf('--validation', standardValidationCount), base)
  const makingTheSamples = (performance.now() - commandStarted) / 1000
  console.log(`${trainPacked.sampleCount} train samples with ${trainPacked.scoredCodePoints} scored code points and ${validation.sampleCount} validation samples, made and packed in ${makingTheSamples.toFixed(0)} s. Picked terminals: ${pickedTerminals.map(terminal => String.fromCodePoint(terminal.codePoint)).join(' ')}. ${changeableCellsOf(base).length} cells may change. Dataset ${datasetKey()}, commit ${worktree.commit}.`)

  // The snapped tables at the passes of --at, taken when the trainer logs the end of a pass.
  const model = createModel(base, {start: 'base', startShare})
  const shares = new Float64Array(model.layout.logitCount)
  const points: {pass: number, tables: RecoveryTables, meanLargestShare: number, trainerLine: string}[] = []
  // With --passes 0 nothing is trained: --search then starts from the parser as it is, as row 11 of the recipe does.
  const training = passes === 0 ? {secondsPerPass: [] as number[], samplesPerSecond: 0} : await train(model, trainPacked, {
    seed, epochs: passes, learningRate, batchSize: recipeSettings.batchSize, workers: 4, twin: referenceTwin, logEverySamples: trainPacked.sampleCount, validation,
    log: line => {
      console.log(line)
      const samplesSeen = Number(/^\s*(\d+) samples/.exec(line)?.[1] ?? NaN)
      const pass = samplesSeen / trainPacked.sampleCount
      if (!at.includes(pass)) return
      sharesInto(model.layout, model.logits, shares)
      points.push({pass, tables: snappedTables(model), meanLargestShare: meanLargestShare(model.layout, shares), trainerLine: line})
    },
  })
  if (points.length !== at.length) throw new Error(`the trainer logged ${points.length} of the ${at.length} passes of --at`)
  console.log(`The training took ${training.secondsPerPass.reduce((total, seconds) => total + seconds, 0).toFixed(0)} s, ${training.samplesPerSecond.toFixed(0)} samples per second.`)

  const save = (pass: number, tables: RecoveryTables, steps: string, searched: boolean, searchSeconds: number, largestShare: number, trainerLine: string) => {
    const name = nameOf(pass, searched)
    const tablesFile = join(folder, `${name}.tables.json`)
    saveTables(tablesFile, tables, `scale study: ${steps}, ${pass} passes over ${trainPacked.sampleCount} train samples, rate ${learningRate}, start share ${startShare}, seed ${seed}`)
    const differences = differencesOf(base, tables)
    const onValidation = scoreTables(tables, validation), onTrain = scoreTables(tables, trainPacked)
    const record: ScaleRecord = {
      format: 'recovery-lr scale record 1', steps, seed, trainSamples: trainPacked.sampleCount, validationSamples: validation.sampleCount,
      passes: pass, gradientSteps: pass * Math.ceil(trainPacked.sampleCount / recipeSettings.batchSize), learningRate, startShare, batchSize: recipeSettings.batchSize,
      datasetKey: datasetKey(), commit: worktree.commit, uncommittedFiles: worktree.uncommittedFiles, finishedAt: new Date().toISOString(),
      seconds: {training: training.secondsPerPass.slice(0, pass).reduce((total, seconds) => total + seconds, 0), search: searchSeconds, makingTheSamples},
      meanLargestShare: largestShare,
      cellsChanged: differences.filter(difference => difference.table === 'cells').length, displayEntriesChanged: differences.filter(difference => difference.table === 'display').length,
      validation: onValidation.score, validationTotals: onValidation.totals, train: onTrain.score, trainTotals: onTrain.totals,
      trainerLine, tablesFile: `${name}.tables.json`, sha256: sha256OfFile(tablesFile),
    }
    writeFileSync(join(folder, `${name}.record.json`), `${JSON.stringify(record, null, 1)}\n`)
    const validationShares = sharesOf(record.validation), trainShares = sharesOf(record.train)
    console.log(`${name}: ${steps}. Validation: all three ${validationShares.allThree.toFixed(2)}, whole ${validationShares.whole.toFixed(2)}, stack ${validationShares.stack.toFixed(2)}, ${record.validationTotals.tokensSkippedByStepLimit} tokens skipped at the limit of steps. Train: all three ${trainShares.allThree.toFixed(2)}, whole ${trainShares.whole.toFixed(2)}. Largest share ${largestShare.toFixed(3)}. ${record.seconds.training.toFixed(0)} s of training.`)
  }

  for (const point of points) save(point.pass, displayEntriesByCount(point.tables, trainPacked).tables, 'training, then the count', false, 0, point.meanLargestShare, point.trainerLine)

  if (flagOf('--search')) {
    const last = passes === 0 ? {tables: base, meanLargestShare: NaN, trainerLine: ''} : points.find(point => point.pass === passes)
    if (last === undefined) throw new Error('--search needs the last pass in --at')
    const searchStarted = performance.now()
    const result = await searchCells(last.tables, changeableCellsOf(base), trainPacked, {orderSeed: seed * 10 + recipeSettings.searchOrder, maximumPasses: recipeSettings.searchPasses})
    const searchSeconds = (performance.now() - searchStarted) / 1000
    console.log(`The search ended ${result.lastPassChangedNothing ? `when pass ${result.passes} changed nothing` : `after its ${result.passes} passes`}, after ${result.changes} changes of a cell, in ${searchSeconds.toFixed(0)} s.`)
    save(passes, displayEntriesByCount(result.tables, trainPacked).tables, passes === 0 ? 'the search and the count, without training' : 'training, then the search, then the count', true, searchSeconds, last.meanLargestShare, last.trainerLine)
  }
  console.log(`The command took ${((performance.now() - commandStarted) / 1000).toFixed(0)} s.`)
}
