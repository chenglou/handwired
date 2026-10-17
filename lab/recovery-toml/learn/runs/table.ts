// Prints the table of all saved runs of a folder: per row of the experiment the mean over its seeds with the lowest
// and the highest, on the validation split, next to row 1 (the parser as it is) and row 2 (anew at the next line
// after an error), which are scored here. Then one line per saved run.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-toml/learn/runs/table.ts [--folder <folder>] [--write-list]
// Without --folder, the runs of <RECOVERY_SCRATCH>/neutral/. --write-list also writes tables.json to the folder: every
// saved table with its row, its seed and the sha256 of its file, which is what a final scoring takes.
import {writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {datasetKey, loadSamples, validationPart} from '../data.ts'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {asIsTables} from '../recovery-tables.ts'
import {type ScoreRow, sharesOf} from '../score.ts'
import {type RunRow, describeSpread, listFileName, parserOfTables, restartAtNextLine, rowNames, runRows, runsFolderOf, savedRunsOf, scoreRowsOf, sha256OfFile} from './runs.ts'

refuseUnknownOptions('runs/table.ts', ['--folder', '--write-list'])
const folder = runsFolderOf(optionOf('--folder'))
const runs = savedRunsOf(folder)
if (runs.length === 0) throw new Error(`${folder} holds no record of a run`)

// Every run has to be of one set of samples and of the dataset as it is, or the rows do not compare.
const {trainedOn} = runs[0]!.record
for (const {record, recordFile} of runs) {
  if (record.datasetKey !== datasetKey()) throw new Error(`${recordFile} is of the dataset ${record.datasetKey}, and the dataset is ${datasetKey()} now`)
  if (JSON.stringify(record.trainedOn) !== JSON.stringify(trainedOn)) throw new Error(`${recordFile} trained on other samples than ${runs[0]!.recordFile}`)
}
const validation = validationPart(loadSamples(trainedOn.datasetSeed, trainedOn.from, trainedOn.to))

const percent = (share: number) => 100 * share
type Line = {name: string, seeds: number[], rows: ScoreRow[]}
const lines: Line[] = [
  {name: '1, the parser as it is', seeds: [], rows: [scoreRowsOf(parserOfTables(asIsTables()), validation)[0]!]},
  {name: '2, anew at the next line after an error', seeds: [], rows: [scoreRowsOf(restartAtNextLine, validation)[0]!]},
  ...runRows.flatMap((row: RunRow) => {
    const ofRow = runs.filter(({record}) => record.row === row)
    return ofRow.length === 0 ? [] : [{name: `${row}, ${rowNames[row]}`, seeds: ofRow.map(({record}) => record.seed), rows: ofRow.map(({record}) => record.validation[0]!)}]
  }),
]
const first = lines[0]!.rows[0]!
console.log(`Dataset ${datasetKey()}, the validation split of the samples ${trainedOn.from} to ${trainedOn.to - 1}: ${first.samples} broken samples with ${first.codePoints} scored code points and ${first.addedCodePoints} added code points. A number with brackets is the mean of the seeds with the lowest and the highest.`)
console.log('')
console.log('| row | seeds | all three | whole | display kind | depth | container | added code points shown as an error |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |')
for (const {name, seeds, rows} of lines) {
  const spread = (shareOf: (shares: ReturnType<typeof sharesOf>) => number) => describeSpread(rows.map(row => percent(shareOf(sharesOf(row)))))
  console.log(`| ${name} | ${seeds.join(', ')} | ${spread(shares => shares.allThree)} | ${spread(shares => shares.whole)} | ${spread(shares => shares.kind)} | ${spread(shares => shares.depth)} | ${spread(shares => shares.container)} | ${describeSpread(rows.map(row => row.addedShownAsError), 0)} |`)
}
console.log('')
console.log('| row | seed | all three | whole | all three on train | cells changed against the base | training, s | search, s | commit | sha256 of the tables |')
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
for (const {record} of runs) {
  const shares = sharesOf(record.validation[0]!)
  console.log(`| ${record.row} | ${record.seed} | ${percent(shares.allThree).toFixed(2)} | ${percent(shares.whole).toFixed(2)} | ${percent(sharesOf(record.train).allThree).toFixed(2)} | ${record.cellsChangedAgainstBase.total} | ${record.seconds.training.toFixed(0)} | ${record.seconds.search.toFixed(0)} | ${record.commit.slice(0, 7)} | ${record.sha256.slice(0, 16)} |`)
}

if (process.argv.includes('--write-list')) {
  const tables = runs.map(({record, tablesFile}) => {
    const sha256 = sha256OfFile(tablesFile)
    if (sha256 !== record.sha256) throw new Error(`${tablesFile} has the sha256 ${sha256}, and its record says ${record.sha256}`)
    return {row: record.row, seed: record.seed, file: record.tablesFile, path: tablesFile, sha256, record: join(folder, `row-${record.row}.seed-${record.seed}.record.json`)}
  })
  const list = {
    format: 'recovery-toml saved tables 1',
    what: 'Every saved table of the runs on the dataset as it is, i.e. on damage that knows nothing of TOML. Row 4: the frozen recipe, the training, the count and the last step. Row 5: the same with the search before the count. Row 6: the search and the count without the training.',
    datasetKey: datasetKey(), trainedOn, tables,
  }
  writeFileSync(join(folder, listFileName), `${JSON.stringify(list, null, 1)}\n`)
  console.log(`\nWrote ${join(folder, listFileName)} with ${tables.length} tables.`)
}
