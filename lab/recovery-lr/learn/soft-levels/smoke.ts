// The smoke run of the recipe's training with several twins, side by side: the same seed, the same train samples,
// the same trainer and settings, scored on validation samples only. It answers one question: does the twin of
// levels train to the score of the reference twin?
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/learn/soft-levels/smoke.ts [--seed 1] [--train 10000] [--validation 5000] [--name smoke]
//       [--twins stacks,levels,levels-pusher-below] [--bars-train 5000]
// Without --twins it runs these three.
// The twins by name:
//   stacks               the reference twin of ../soft/stacks-twin.ts, 48 exact stacks
//   stacks-192           the same twin with 192 stacks, and stacks-1000 with 1,000
//   levels               the twin of levels-twin.ts in the design's form
//   levels-pusher-below  the same in the variant `pusherBelow`
// For every twin: the steps 1 to 6 and 8 of ../recipe.ts, i.e. row 9, training then the count. Next to them: the
// parser as it is, panic mode without knowledge of the language with its count, and row 11, the search and the count
// without training. The tables of every twin, the trainer's log and a report per twin go to
// <scratch>/learn/soft-levels/<name>. It reads no held-back set.
import {appendFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {defaultSeed, loadSamples} from '../../dataset.ts'
import {kindsOfDroppedTokensByCount, panicMode} from '../bars.ts'
import {loadPacked} from '../data.ts'
import {learnFolder, numberOf, optionOf, refuseUnknownOptions, standardValidationCount} from '../options.ts'
import {countedTables, prepareRecipe, searchedTables, trainedTables} from '../recipe.ts'
import {differencesOf, saveTables} from '../recovery-tables.ts'
import {reportOf} from '../report.ts'
import {type Score, scoreHeader, scoreOutputs, scoreRow, scoreTables, sharesOf} from '../score.ts'
import {type TwinChoice, referenceTwin} from '../soft/twin.ts'

const levelsModule = new URL('./levels-twin.ts', import.meta.url).href
export const twinsByName: Record<string, TwinChoice> = {
  'stacks': referenceTwin,
  'stacks-192': {module: referenceTwin.module, options: {width: 192}},
  'stacks-1000': {module: referenceTwin.module, options: {width: 1000}},
  'levels': {module: levelsModule},
  'levels-pusher-below': {module: levelsModule, options: {pusherBelow: 1}},
}

if (import.meta.main) {
  refuseUnknownOptions('soft-levels/smoke.ts', ['--seed', '--train', '--validation', '--name', '--twins', '--bars-train'])
  const seed = numberOf('--seed', 1)
  const trainSamples = numberOf('--train', 10_000)
  const names = (optionOf('--twins') ?? 'stacks,levels,levels-pusher-below').split(',')
  for (const name of names) if (twinsByName[name] === undefined) throw new Error(`--twins takes ${Object.keys(twinsByName).join(', ')}, and got ${name}`)
  const folder = learnFolder('soft-levels', optionOf('--name') ?? 'smoke')
  const logFile = join(folder, 'log.txt')
  writeFileSync(logFile, '')
  const log = (line: string) => {
    console.log(line)
    appendFileSync(logFile, `${line}\n`)
  }
  log(`bun ${process.argv.slice(1).join(' ')}`)
  const prepared = prepareRecipe(trainSamples)
  const validation = loadPacked('validation', numberOf('--validation', standardValidationCount), prepared.base)
  log(`${prepared.train.sampleCount} train samples with ${prepared.train.scoredCodePoints} scored code points, ${validation.sampleCount} validation samples, seed ${seed}. The rule picks ${prepared.pickedTerminals.length === 0 ? 'no code point' : prepared.pickedTerminals.map(terminal => `\`${String.fromCodePoint(terminal.codePoint)}\``).join(' ')} for a terminal of its own.`)

  const rows: {name: string, onValidation: Score, onTrain: Score | null}[] = []
  rows.push({name: 'the parser as it is', onValidation: scoreTables(prepared.base, validation).score, onTrain: null})
  {
    // Panic mode without knowledge of the language, with the kinds of its dropped tokens by a count over train samples.
    const barsTrain = loadSamples('train', defaultSeed, numberOf('--bars-train', 5000))
    const counted = kindsOfDroppedTokensByCount(barsTrain, panicMode)
    rows.push({name: `panic mode without knowledge, with the count (over ${barsTrain.length} train samples)`, onValidation: scoreOutputs(loadSamples('validation', defaultSeed, validation.sampleCount), sample => panicMode(sample, counted)), onTrain: null})
  }
  const summaries: string[] = []
  for (const name of names) {
    log('')
    log(`The twin "${name}":`)
    const {tables: trained, training} = await trainedTables(prepared, seed, {twin: twinsByName[name]!, log, validation})
    const counted = countedTables(prepared, trained)
    rows.push({name: `${name}: the snapped tables of the training, before the count`, onValidation: scoreTables(trained, validation).score, onTrain: scoreTables(trained, prepared.train).score})
    rows.push({name: `${name}: row 9, training then the count`, onValidation: scoreTables(counted, validation).score, onTrain: scoreTables(counted, prepared.train).score})
    const file = join(folder, `${name}-row-9-seed-${seed}.json`)
    saveTables(file, counted, `soft-levels/smoke.ts, twin ${name}, row 9, seed ${seed}, ${prepared.train.sampleCount} train samples`)
    writeFileSync(file.replace(/\.json$/, '.report.txt'), `${reportOf(counted, validation, 'validation', 30).join('\n')}\n`)
    const differences = differencesOf(prepared.base, counted)
    const last = training.points.at(-1)!
    summaries.push(`${name}: ${training.secondsPerPass.map(seconds => `${seconds.toFixed(1)} s`).join(', ')} per pass on 4 worker threads, ${training.samplesPerSecond.toFixed(0)} samples per second. The loss per code point of the passes: ${training.points.slice(1).map(point => point.loss.toFixed(3)).join(', ')}. After the last pass the mean largest share of a mix is ${last.meanLargestShare.toFixed(3)} and the twin reads as its snapped tables at ${(100 * last.readsAsSnapped).toFixed(1)}% of the code points of 100 train samples. ${differences.filter(difference => difference.table === 'cells').length} cells and ${differences.filter(difference => difference.table === 'display').length} display entries hold something else than the parser as it is. Saved to ${file}.`)
  }
  {
    log('')
    const searched = countedTables(prepared, await searchedTables(prepared, prepared.base, seed, {log}))
    rows.push({name: 'row 11: the search and the count, without training', onValidation: scoreTables(searched, validation).score, onTrain: scoreTables(searched, prepared.train).score})
  }
  log('')
  log(`The validation samples, ${validation.sampleCount} of them. One seed on ${prepared.train.sampleCount} train samples: a smoke run, and no result.`)
  log(scoreHeader)
  for (const row of rows) log(scoreRow(row.name, row.onValidation))
  log('')
  log('All three / whole on the train samples of the run:')
  for (const row of rows) {
    if (row.onTrain === null) continue
    const shares = sharesOf(row.onTrain)
    log(`- ${row.name}: ${shares.allThree.toFixed(2)} / ${shares.whole.toFixed(2)}`)
  }
  log('')
  for (const summary of summaries) log(summary)
}
