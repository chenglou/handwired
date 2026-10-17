// Checks of what the arm "generic" adds to the trainer, in three parts:
// 1. The cells of too deep valid JSON: tables with today's choice in the cells of cellsOfTooDeepValidJson and a
//    random choice in every other open cell show valid JSON of more than 16 levels as today's tables do, at every
//    code point: the texts of ../../check-deep.ts in both forms, and texts with a container after their deepest
//    part, which the mask was not made from. Without the mask, random open cells give other depths.
// 2. The events of a text's end: after ruleOutEndEvents no trainable tokenizer cell that a code point of a text
//    reads has a share for such an event, random weights never snap to one, and a short training leaves it so.
// 3. The recipe of the plain pass gives the tables that ../plain-pass/run.ts saved for seed 1, so the arm's control
//    is that run. And a recipe without a training gives today's tables, so its search starts from them.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after ../plain-pass/run.ts. About
// 40 s, most of it the training of the third part, with 4 worker threads:
//   bun lab/recovery-parser/learn/arms/generic/check.ts
import {join} from 'node:path'
import {createRandom} from '../../../random.ts'
import {deepTexts, deepTextsWithMembersAfter} from '../../check-deep.ts'
import {refuseUnknownOptions, standardRange} from '../../data.ts'
import {codePointsOf, runRecoveryParser} from '../../recovery-parser.ts'
import {type RecoveryTables, asIsTables, classNames, copyTables, eventNames, loadTablesOfThisDataset, randomizeOpenCells, tablesToJson, today} from '../../recovery-tables.ts'
import {train} from '../../soft/train.ts'
import {packForTwin, placesForTwin} from '../../soft/twin-data.ts'
import {createCellArrays, createModel, mixesInto, snappedTables} from '../../soft/twin.ts'
import {armFolderOf, fileNameOf, samplesOfTheStandardSet} from '../harness.ts'
import {buildRecipe, cellsOfTooDeepValidJson, plainPass, recipeWith, ruleOutEndEvents} from './generic.ts'

refuseUnknownOptions('arms/generic/check.ts', [])
let failures = 0
const check = (holds: boolean, sentence: string) => {
  if (!holds) failures++
  console.log(`${holds ? 'ok' : 'FAILED'}: ${sentence}`)
}

// Part 1.
const todays = asIsTables()
const keptCells = cellsOfTooDeepValidJson()
const cellsPerState = todays.tokenCount * todays.contextCount
const keptInTheErrorRow = keptCells.subarray(today.errorState * cellsPerState, (today.errorState + 1) * cellsPerState).reduce((total, kept) => total + kept, 0)
const keptCount = keptCells.reduce((total, kept) => total + kept, 0)
check(keptInTheErrorRow === cellsPerState && keptCount === cellsPerState + 6, `the mask holds the ${cellsPerState} cells of the row of the state error and 6 others: ${keptInTheErrorRow} and ${keptCount - keptInTheErrorRow}`)
check(keptCells.every((kept, cell) => kept === 0 || todays.grammarOpen[cell] === 1), 'every cell of the mask is open')
// Texts with a container after their deepest part: a too deep text of the check as the first of three members.
const withAContainerAfter = deepTexts(300).filter(text => Array.from(text).length <= 460).map(text => `[${text}, {"after": [1, {"inner": [true]}]}, [null]]`)
const deepForms = [{name: 'nothing after the nested containers', texts: deepTexts(300)}, {name: 'members after them', texts: deepTextsWithMembersAfter(300)}, {name: 'a container after the deepest part', texts: withAContainerAfter}]
// At how many code points of the texts `tables` show another display kind, depth or container than today's tables.
function differencesFromToday(tables: RecoveryTables, texts: readonly string[]) {
  let differences = 0
  for (const text of texts) {
    const {codePoints, truncated} = codePointsOf(text)
    const expected = runRecoveryParser(codePoints, truncated, todays)
    const trace = runRecoveryParser(codePoints, truncated, tables)
    for (let position = 0; position < codePoints.length; position++) {
      if (trace.displayKind[position] !== expected.displayKind[position] || trace.depthAfter[position] !== expected.depthAfter[position] || trace.containerAfter[position] !== expected.containerAfter[position]) differences++
    }
  }
  return differences
}
const randomSettings = 20
for (const form of deepForms) {
  let withTheMask = 0
  let withoutTheMask = 0
  for (let setting = 0; setting < randomSettings; setting++) {
    const random = copyTables(todays)
    randomizeOpenCells(random, createRandom(standardRange.seed, 100 + setting))
    withoutTheMask += differencesFromToday(random, form.texts)
    for (let cell = 0; cell < keptCells.length; cell++) {
      if (keptCells[cell] === 0) continue
      random.grammarNext[cell] = todays.grammarNext[cell]!
      random.grammarAction[cell] = todays.grammarAction[cell]!
    }
    withTheMask += differencesFromToday(random, form.texts)
  }
  check(withTheMask === 0 && withoutTheMask > 0, `${form.texts.length} too deep valid texts, ${form.name}, ${randomSettings} random settings of the open cells: ${withTheMask} code points are shown otherwise than today with today's choice in the cells of the mask, and ${withoutTheMask} without it`)
}

// Part 2.
const endEvents = (['end', 'endInsideToken', 'truncatedEnd'] as const).map(name => eventNames.indexOf(name))
const endClasses = (['end', 'truncatedEnd'] as const).map(name => classNames.indexOf(name))
const readByACodePoint = (cell: number) => !endClasses.includes(cell % todays.classCount)
check(Array.from(todays.lexerEvent).every((event, cell) => !readByACodePoint(cell) || !endEvents.includes(event)), 'today no tokenizer cell that a code point of a text reads holds an event of a text\'s end')
const model = createModel(todays, {start: 'uniform'})
ruleOutEndEvents(model)
// Every share of an event of a text's end in the trainable tokenizer cells that a code point reads, added up.
const mixes = createCellArrays(model.shape)
function sharesOfEndEvents() {
  mixesInto(model, 1, mixes)
  let total = 0
  for (let cell = 0; cell < model.trainableLexer.length; cell++) if (model.trainableLexer[cell] === 1 && readByACodePoint(cell)) for (const event of endEvents) total += mixes.lexerEvent[cell * todays.eventCount + event]!
  return total
}
const snapsToAnEndEvent = () => Array.from(snappedTables(model).lexerEvent).filter((event, cell) => readByACodePoint(cell) && endEvents.includes(event)).length
const weightsRandom = createRandom(standardRange.seed, 200)
for (let entry = 0; entry < model.weights.all.length; entry++) if (model.weights.all[entry] !== -Infinity) model.weights.all[entry] = 4 * weightsRandom.next() - 2
check(sharesOfEndEvents() === 0 && snapsToAnEndEvent() === 0, `with random weights, the events of a text's end have the share ${sharesOfEndEvents()} in the trainable tokenizer cells that a code point reads, and ${snapsToAnEndEvent()} of those cells snap to one`)
const samples = samplesOfTheStandardSet()
const fewTrainSamples = packForTwin(samples, placesForTwin(samples, 'train').subarray(0, 96), undefined, todays)
await train(model, fewTrainSamples, {seed: 1, epochs: 2, workers: 0, logEverySamples: 1e9, log: () => {}})
const brokenWeights = model.weights.all.filter(weight => Number.isNaN(weight) || weight === Infinity).length
check(sharesOfEndEvents() === 0 && snapsToAnEndEvent() === 0 && brokenWeights === 0, `after 2 passes over 96 train samples the share is ${sharesOfEndEvents()}, ${snapsToAnEndEvent()} cells snap to such an event, and ${brokenWeights} weights are not a number or infinite`)

// Part 3.
const savedPlainPass = loadTablesOfThisDataset(join(armFolderOf('plain-pass'), fileNameOf('one pass of the trainer from today\'s tables, defaults'), 'seed-1.tables.json')).tables
const built = await buildRecipe(plainPass, 1, 'generic')
check(tablesToJson(built.tables) === tablesToJson(savedPlainPass), 'the recipe of the plain pass gives the tables that ../plain-pass/run.ts saved for seed 1')
const withoutTraining = await buildRecipe(recipeWith({passes: 0}), 1, 'generic')
check(tablesToJson(withoutTraining.tables) === tablesToJson(todays), 'a recipe without a training gives today\'s tables')

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
