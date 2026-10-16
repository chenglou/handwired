// Prints one markdown table of all saved runs of a folder on the validation split: per row of the recipe the mean
// over its seeds with the lowest and the highest, below the bars that are scored here on the same samples. Then one
// line per saved run.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/learn/runs/table.ts [--folder <folder>] [--bars-train 5000]
// Without --folder, the runs of <RECOVERY_LR_SCRATCH>/runs/neutral.
//
// The bars:
// - the ones of ../bars.ts that need no author: the parser as it is, skip, panic mode and its nearest table. Their
//   counts are made on the first --bars-train train samples, 5,000 as in the command of ../bars.ts.
// - the hand-made ones, each as its folder saved it, with its count of the 40,000 train samples: yacc error
//   productions (../bars/yacc), panic mode with a hand list (../bars/panic), a table filled by hand-written rules
//   (../bars/rules).
//
// It reads the train and the validation split only, and no held-back set.
import {defaultSeed, loadSamples} from '../../dataset.ts'
import {barRows} from '../bars.ts'
import {panicModeByHand} from '../bars/panic/panic.ts'
import {rulesBar} from '../bars/rules/bar.ts'
import {yaccErrorProductions} from '../bars/yacc/bar.ts'
import {numberOf, optionOf, refuseUnknownOptions} from '../options.ts'
import {type RecipeRow, recipeRowNames, recipeRows} from '../recipe.ts'
import {datasetKey} from '../recovery-tables.ts'
import {type Score, scoreOutputs, sharesOf} from '../score.ts'
import {describeSpread, runsFolderOf, savedRunsOf} from './runs.ts'

refuseUnknownOptions('runs/table.ts', ['--folder', '--bars-train'])
const folder = runsFolderOf(optionOf('--folder'))
const runs = savedRunsOf(folder)
if (runs.length === 0) throw new Error(`${folder} holds no record of a run`)

// Every run has to be of one set of samples and of the dataset as it is, or the rows do not compare.
const {trainSamples, validationSamples} = runs[0]!.record
for (const {record, recordFile} of runs) {
  if (record.datasetKey !== datasetKey()) throw new Error(`${recordFile} is of the dataset ${record.datasetKey}, and the dataset is ${datasetKey()} now`)
  if (record.trainSamples !== trainSamples || record.validationSamples !== validationSamples) throw new Error(`${recordFile} is of other samples than ${runs[0]!.recordFile}`)
}
const barsTrain = numberOf('--bars-train', 5000)
const validation = loadSamples('validation', defaultSeed, validationSamples)
const train = loadSamples('train', defaultSeed, barsTrain)

type Line = {name: string, seeds: number[], scores: Score[]}
const lines: Line[] = [
  ...barRows(train, validation).map(({name, score}) => ({name: `bar: ${name}`, seeds: [], scores: [score]})),
  {name: 'bar: yacc error productions, with the count', seeds: [], scores: [scoreOutputs(validation, yaccErrorProductions)]},
  {name: 'bar: panic mode with a hand-written list of synchronizing tokens, with the count', seeds: [], scores: [scoreOutputs(validation, panicModeByHand)]},
  {name: 'bar: a table filled by hand-written rules, with the count', seeds: [], scores: [scoreOutputs(validation, rulesBar())]},
  ...recipeRows.flatMap((row: RecipeRow) => {
    const ofRow = runs.filter(({record}) => record.row === row)
    return ofRow.length === 0 ? [] : [{name: `row ${row}: ${recipeRowNames[row]}`, seeds: ofRow.map(({record}) => record.seed), scores: ofRow.map(({record}) => record.validation)}]
  }),
]
const first = lines[0]!.scores[0]!
console.log(`Dataset ${datasetKey()}, the first ${validationSamples} samples of the validation split: ${first.samples} broken samples with ${first.scoredCodePoints} scored code points. The rows of the recipe were made from the first ${trainSamples} train samples. A number with brackets is the mean of the seeds with the lowest and the highest. Every number but the last column is a percentage.`)
console.log('')
console.log('| parser | seeds | all three | whole | kind | depth | container | stack | whole by stack | constituents after the first error: found | the same: right | inserted per sample |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const {name, seeds, scores} of lines) {
  const spread = (shareOf: (shares: ReturnType<typeof sharesOf>) => number, digits = 2) => describeSpread(scores.map(score => shareOf(sharesOf(score))), digits)
  console.log(`| ${name} | ${seeds.join(', ')} | ${spread(shares => shares.allThree)} | ${spread(shares => shares.whole)} | ${spread(shares => shares.kind, 1)} | ${spread(shares => shares.depth, 1)} | ${spread(shares => shares.container, 1)} | ${spread(shares => shares.stack)} | ${spread(shares => shares.wholeByStack)} | ${spread(shares => shares.constituentsFoundAfter, 1)} | ${spread(shares => shares.constituentsRightAfter, 1)} | ${spread(shares => shares.insertedPerSample)} |`)
}
console.log('')
console.log('| row | seed | all three | whole | all three on the train split | whole on the train split | all three after the training alone | cells changed | display entries changed | training, s | search, s | commit | sha256 of the tables |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const {record} of runs) {
  const shares = sharesOf(record.validation), onTrain = sharesOf(record.train)
  const afterTraining = record.validationAfterTheTrainingAlone === null ? 'none' : sharesOf(record.validationAfterTheTrainingAlone).allThree.toFixed(2)
  const training = record.seconds.trainingPerPass.reduce((total, seconds) => total + seconds, 0)
  console.log(`| ${record.row} | ${record.seed} | ${shares.allThree.toFixed(2)} | ${shares.whole.toFixed(2)} | ${onTrain.allThree.toFixed(2)} | ${onTrain.whole.toFixed(2)} | ${afterTraining} | ${record.cellsChanged} | ${record.displayEntriesChanged} | ${training.toFixed(0)} | ${record.seconds.search.toFixed(0)} | ${record.commit.slice(0, 7)} | ${record.sha256.slice(0, 16)} |`)
}
