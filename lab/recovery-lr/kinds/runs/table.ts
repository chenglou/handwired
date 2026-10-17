// Prints one markdown table: the saved runs of the recipe on the mixed train split next to the saved runs on the
// dataset's train split and the bars, each scored on four sets of validation samples:
//   the mixed validation split of ../mixed.ts, 5,000 samples
//   its half with the dataset's damage, 2,500 samples
//   its half with the kinds of mistakes, 2,500 samples
//   the dataset's own validation split, 5,000 samples
// Every row is scored here from its saved tables, also the rows of ../../learn/runs/, whose records only hold the
// score on the dataset's validation split. The bars are the ones of ../../learn/runs/table.ts, with their counts
// made on the dataset's train samples as there.
//
// Run from the repo root: bun lab/recovery-lr/kinds/runs/table.ts --mixed <folder of the mixed runs> --neutral <folder of the runs on the dataset>
// It reads the train and the validation split only, and no held-back set.
import {defaultSeed, loadSamples} from '../../dataset.ts'
import {barRows} from '../../learn/bars.ts'
import {panicModeByHand} from '../../learn/bars/panic/panic.ts'
import {rulesBar} from '../../learn/bars/rules/bar.ts'
import {yaccErrorProductions} from '../../learn/bars/yacc/bar.ts'
import {type PackedSamples, packSamples} from '../../learn/data.ts'
import {numberOf, optionOf, refuseUnknownOptions, standardValidationCount} from '../../learn/options.ts'
import {recipeRowNames} from '../../learn/recipe.ts'
import {type RecoveryTables, loadTables, terminalsKeyOf} from '../../learn/recovery-tables.ts'
import {describeSpread, savedRunsOf, tablesFileNameOf} from '../../learn/runs/runs.ts'
import {type Score, scoreOutputs, scoreTables, sharesOf} from '../../learn/score.ts'
import type {Sample} from '../../sample.ts'
import {existsSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {eachMixedSample} from '../mixed.ts'

refuseUnknownOptions('kinds/runs/table.ts', ['--mixed', '--neutral', '--bars-train'])
const mixedFolder = optionOf('--mixed'), neutralFolder = optionOf('--neutral')
if (mixedFolder === undefined || neutralFolder === undefined) throw new Error('kinds/runs/table.ts needs --mixed and --neutral, the folders of the saved runs')

const mixed = [...eachMixedSample('validation', standardValidationCount)]
const setNames = ['the mixed validation split', 'its half with the dataset\'s damage', 'its half with the kinds', 'the dataset\'s own validation split'] as const
const sets: Sample[][] = [
  mixed.map(entry => entry.sample), mixed.filter(entry => entry.half === 'neutral').map(entry => entry.sample), mixed.filter(entry => entry.half === 'kinds').map(entry => entry.sample),
  loadSamples('validation', defaultSeed, standardValidationCount),
]
const train = loadSamples('train', defaultSeed, numberOf('--bars-train', 5000))

// The samples of a set packed for the added terminals of some tables, made once per set and key.
const packedOf = new Map<string, PackedSamples>()
function scoreOn(set: number, tables: RecoveryTables): Score {
  const key = `${set} ${terminalsKeyOf(tables)}`
  let packed = packedOf.get(key)
  if (packed === undefined) {
    packed = packSamples(sets[set]!, tables)
    packedOf.set(key, packed)
  }
  return scoreTables(tables, packed).score
}

// A line of the table: per set, the scores of the line's seeds.
type Line = {name: string, seeds: number[], scores: Score[][]}
const lines: Line[] = []
const barsOfSets = sets.map(set => [
  ...barRows(train, set).map(({name, score}) => ({name: `bar: ${name}`, score})),
  {name: 'bar: yacc error productions, with the count', score: scoreOutputs(set, yaccErrorProductions)},
  {name: 'bar: panic mode with a hand-written list of synchronizing tokens, with the count', score: scoreOutputs(set, panicModeByHand)},
  {name: 'bar: a table filled by hand-written rules, with the count', score: scoreOutputs(set, rulesBar())},
])
barsOfSets[0]!.forEach((bar, place) => lines.push({name: bar.name, seeds: [], scores: barsOfSets.map(bars => [bars[place]!.score])}))
// The saved tables of a folder for a row, by their file names, so that the records of both folders need not have one form.
function linesOfFolder(folder: string, trainedOn: string) {
  if (!existsSync(folder)) throw new Error(`${folder} does not exist`)
  for (const row of [9, 10] as const) {
    const seeds = readdirSync(folder).flatMap(name => {
      const match = /^row-(\d+)\.seed-(\d+)\.tables\.json$/.exec(name)
      return match !== null && Number(match[1]) === row ? [Number(match[2])] : []
    }).sort((left, right) => left - right)
    if (seeds.length === 0) continue
    const tables = seeds.map(seed => loadTables(join(folder, tablesFileNameOf(row, seed))).tables)
    lines.push({name: `row ${row}, trained on ${trainedOn}: ${recipeRowNames[row]}`, seeds, scores: sets.map((_, set) => tables.map(tablesOfSeed => scoreOn(set, tablesOfSeed)))})
  }
}
linesOfFolder(neutralFolder, 'the dataset\'s train split')
linesOfFolder(mixedFolder, 'the mixed train split')
// The records of the dataset's runs hold the score on the dataset's validation split: the scores made here must be the same.
for (const {record} of savedRunsOf(neutralFolder)) {
  if (record.row !== 9 && record.row !== 10) continue
  const line = lines.find(candidate => candidate.name.startsWith(`row ${record.row}, trained on the dataset`))!
  const here = line.scores[3]![line.seeds.indexOf(record.seed)]!
  if (sharesOf(here).allThree.toFixed(4) !== sharesOf(record.validation).allThree.toFixed(4)) throw new Error(`row ${record.row} seed ${record.seed} of ${neutralFolder} scores ${sharesOf(here).allThree} here and ${sharesOf(record.validation).allThree} in its record`)
}

console.log(`The four sets: ${sets.map((set, place) => `${setNames[place]} (${set.length} samples, ${lines[0]!.scores[place]![0]!.scoredCodePoints} scored code points)`).join(', ')}. A number with brackets is the mean of the seeds with the lowest and the highest. Every number is a percentage. The scores of the rows trained on the dataset's train split on the dataset's own validation split are the ones in their records.`)
console.log('')
console.log(`| parser | seeds | all three: ${setNames.join(' | all three: ')} | whole: ${setNames.join(' | whole: ')} |`)
console.log(`| --- | --- |${' --- |'.repeat(2 * sets.length)}`)
for (const {name, seeds, scores} of lines) {
  const cells = (shareOf: (shares: ReturnType<typeof sharesOf>) => number) => scores.map(ofSet => describeSpread(ofSet.map(score => shareOf(sharesOf(score))))).join(' | ')
  console.log(`| ${name} | ${seeds.join(', ')} | ${cells(shares => shares.allThree)} | ${cells(shares => shares.whole)} |`)
}
