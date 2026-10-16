// Checks of what the arm "combined" adds to the recipes of round 1, in five parts:
// 1. The cells of too deep valid JSON for a changed layout. For today's tables the mask is the one of
//    ../generic/generic.ts. For the bases of the arm's three lines, tables with the base's choice in the cells of
//    the mask and a random choice in every other open cell and open display entry give valid JSON of more than 16
//    levels the depth and the container of the base at every code point, in four forms: the two of
//    ../../check-deep.ts, texts with a container after their deepest part, and texts with a line feed after every
//    bracket, comma and colon. Without the mask, random open cells give other depths.
// 2. The events of a text's end with added classes and spare states: after ruleOutEndEvents no trainable tokenizer
//    cell that a code point reads has a share for such an event, and random weights never snap to one.
// 3. The search that counts whole samples first, on 2,000 train samples and 60 cells: its steps add up to a run of
//    every sample, which the search checks itself, and no whole sample is lost.
// 4. The saved tables of the generic recipe for the first tuning seed, when run.ts saved them: the cells of the mask
//    hold the base's choice, and no tokenizer cell that a code point reads holds an event of a text's end.
// 5. The recipe without the arm's new parts, bestOfExtraFacts, gives the tables that ../extra-facts/run.ts saved
//    for its best row and the seed 11, so that row is the control of the arm's line with the classes chosen by hand.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after
// `../extra-facts/run.ts --trainer three-base --settings all --seeds 11,12,13,14,15`. About 3 minutes, most of it
// the training of the fifth part, with 4 worker threads. check-all.ts does not run it:
//   bun lab/recovery-parser/learn/arms/combined/check.ts
import {existsSync} from 'node:fs'
import {createRandom} from '../../../random.ts'
import {deepTexts, deepTextsWithMembersAfter} from '../../check-deep.ts'
import {refuseUnknownOptions, selectSamples, standardRange} from '../../data.ts'
import {codePointsOf, runRecoveryParser} from '../../recovery-parser.ts'
import {type RecoveryTables, asIsTables, classNames, copyTables, eventNames, loadTablesOfThisDataset, randomizeOpenCells, tablesToJson} from '../../recovery-tables.ts'
import {prepareSamples, scoreOfSample, scorePack} from '../../search/sample-runs.ts'
import {createCellArrays, mixesInto, snappedTables} from '../../soft/twin.ts'
import {armNameOf, confirmationSeeds as seedsOfExtraFactsConfirmation, savedTablesOf, settingOfKey} from '../extra-facts/facts.ts'
import {cellsOfTooDeepValidJson as cellsOfTooDeepValidJsonOfGeneric} from '../generic/generic.ts'
import {trainPartOfTheStandardSet} from '../harness.ts'
import {baseOf, bestOfExtraFacts, buildRecipe, cellsOfTooDeepValidJson, fromHandWritten, generic, modelOf, recipeWith, savedTablesFileOf, searchedCellsOf, spreadOverLines, tuningSeeds, withHandClasses} from './combined.ts'
import {searchForWholeSamples} from './whole-search.ts'

refuseUnknownOptions('arms/combined/check.ts', [])
let failures = 0
const check = (holds: boolean, sentence: string) => {
  if (!holds) failures++
  console.log(`${holds ? 'ok' : 'FAILED'}: ${sentence}`)
}

// Part 1.
const sameMask = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((kept, cell) => kept === right[cell])
const countOf = (mask: Uint8Array) => mask.reduce((total, kept) => total + kept, 0)
check(sameMask(cellsOfTooDeepValidJson(asIsTables()), cellsOfTooDeepValidJsonOfGeneric()), `for today's tables the mask is the one of ../generic/generic.ts, ${countOf(cellsOfTooDeepValidJson(asIsTables()))} cells`)
const withAContainerAfter = deepTexts(300).filter(text => Array.from(text).length <= 460).map(text => `[${text}, {"after": [1, {"inner": [true]}]}, [null]]`)
const overLines = [...deepTexts(300), ...deepTextsWithMembersAfter(300)].map(spreadOverLines).filter(text => Array.from(text).length <= 512)
const deepForms = [
  {name: 'nothing after the nested containers', texts: deepTexts(300)}, {name: 'members after them', texts: deepTextsWithMembersAfter(300)},
  {name: 'a container after the deepest part', texts: withAContainerAfter}, {name: 'a line feed after every bracket, comma and colon', texts: overLines},
]
// At how many code points of the texts `tables` give another depth or container than `base`.
function differencesFrom(base: RecoveryTables, tables: RecoveryTables, texts: readonly string[]) {
  let differences = 0
  for (const text of texts) {
    const {codePoints, truncated} = codePointsOf(text)
    const expected = runRecoveryParser(codePoints, truncated, base)
    const trace = runRecoveryParser(codePoints, truncated, tables)
    for (let position = 0; position < codePoints.length; position++) if (trace.depthAfter[position] !== expected.depthAfter[position] || trace.containerAfter[position] !== expected.containerAfter[position]) differences++
  }
  return differences
}
const randomSettings = 10
for (const {name, recipe} of [{name: 'the generic recipe', recipe: generic}, {name: 'the recipe with the classes chosen by hand', recipe: withHandClasses}, {name: 'the recipe from the hand-written tables', recipe: fromHandWritten}]) {
  const base = baseOf(recipe)
  const kept = cellsOfTooDeepValidJson(base)
  for (const form of deepForms) {
    let withTheMask = 0
    let withoutTheMask = 0
    for (let setting = 0; setting < randomSettings; setting++) {
      const random = copyTables(base)
      randomizeOpenCells(random, createRandom(standardRange.seed, 100 + setting))
      withoutTheMask += differencesFrom(base, random, form.texts)
      for (let cell = 0; cell < kept.length; cell++) {
        if (kept[cell] === 0) continue
        random.grammarNext[cell] = base.grammarNext[cell]!
        random.grammarAction[cell] = base.grammarAction[cell]!
      }
      withTheMask += differencesFrom(base, random, form.texts)
    }
    check(withTheMask === 0 && withoutTheMask > 0, `${name}, ${countOf(kept)} kept cells, ${form.texts.length} too deep valid texts with ${form.name}, ${randomSettings} random settings of the other open cells: ${withTheMask} code points have another depth or container than with the base, and ${withoutTheMask} without the mask`)
  }
}

// Part 2.
{
  const endEvents = (['end', 'endInsideToken', 'truncatedEnd'] as const).map(name => eventNames.indexOf(name))
  const endClasses = (['end', 'truncatedEnd'] as const).map(name => classNames.indexOf(name))
  const recipe = recipeWith({spareTokenizerStates: 4, spareGrammarStates: 2}, generic)
  const base = baseOf(recipe)
  const model = modelOf(recipe, base, 1)
  const readByACodePoint = (cell: number) => !endClasses.includes(cell % base.classCount)
  const weightsRandom = createRandom(standardRange.seed, 200)
  for (let entry = 0; entry < model.weights.all.length; entry++) if (model.weights.all[entry] !== -Infinity) model.weights.all[entry] = 4 * weightsRandom.next() - 2
  const mixes = createCellArrays(model.shape)
  mixesInto(model, 1, mixes)
  let share = 0
  let trainableCells = 0
  for (let cell = 0; cell < model.trainableLexer.length; cell++) {
    if (model.trainableLexer[cell] === 0 || !readByACodePoint(cell)) continue
    trainableCells++
    for (const event of endEvents) share += mixes.lexerEvent[cell * base.eventCount + event]!
  }
  const snapped = Array.from(snappedTables(model).lexerEvent).filter((event, cell) => readByACodePoint(cell) && endEvents.includes(event)).length
  check(share === 0 && snapped === 0 && trainableCells > 0, `with ${base.addedClasses.length} added classes, 4 spare tokenizer states and random weights, the events of a text's end have the share ${share} in the ${trainableCells} trainable tokenizer cells that a code point reads, and ${snapped} of those cells snap to one`)
}

// Part 3.
{
  const base = baseOf(generic)
  const fewTrainSamples = selectSamples(trainPartOfTheStandardSet(), Int32Array.from({length: 2000}, (_, place) => place))
  const prepared = prepareSamples(fewTrainSamples, base)
  // The whole samples of the prepared samples: the ones with a scored code point and every scored code point right.
  const wholeSamplesWith = (tables: RecoveryTables) => {
    const expected = new Set<number>()
    for (let sample = 0; sample < prepared.sampleCount; sample++) {
      const scored = fewTrainSamples.scored[prepared.place[sample]!]!
      if (scored > 0 && Math.floor(scoreOfSample(prepared, sample, tables) / scorePack) === scored) expected.add(sample)
    }
    return expected
  }
  const cells = createRandom(standardRange.seed, 300).shuffled(searchedCellsOf(generic, base)).slice(0, 60)
  const before = wholeSamplesWith(base)
  const result = await searchForWholeSamples(base, cells, prepared, 1)
  const after = wholeSamplesWith(result.tables)
  const lost = [...before].filter(sample => !after.has(sample)).length
  check(result.lastPassChangedNothing && after.size >= before.size, `the search for whole samples over 60 cells on 2,000 train samples ended after ${result.passes} passes and ${result.changes} changes of a cell, with ${after.size} whole samples where today's tables have ${before.size}, and ${lost} samples that were whole are not any more`)
}

// Part 4.
{
  const file = savedTablesFileOf('combined-tuning', generic, tuningSeeds[0]!)
  if (!existsSync(file)) {
    console.log(`skipped: ${file} is not there, so the saved tables of the generic recipe are not checked`)
  } else {
    const base = baseOf(generic)
    const tables = loadTablesOfThisDataset(file).tables
    const kept = cellsOfTooDeepValidJson(base)
    const changedKeptCells = Array.from(kept).filter((isKept, cell) => isKept === 1 && (tables.grammarNext[cell] !== base.grammarNext[cell] || tables.grammarAction[cell] !== base.grammarAction[cell])).length
    const endEvents = (['end', 'endInsideToken', 'truncatedEnd'] as const).map(name => eventNames.indexOf(name))
    const endClasses = (['end', 'truncatedEnd'] as const).map(name => classNames.indexOf(name))
    const cellsWithAnEndEvent = Array.from(tables.lexerEvent).filter((event, cell) => !endClasses.includes(cell % tables.classCount) && endEvents.includes(event)).length
    check(changedKeptCells === 0 && cellsWithAnEndEvent === 0, `the saved tables of the generic recipe, seed ${tuningSeeds[0]}: ${changedKeptCells} of the ${countOf(kept)} kept cells hold another choice than the base, and ${cellsWithAnEndEvent} tokenizer cells that a code point reads hold an event of a text's end`)
  }
}

// Part 5.
{
  const seed = seedsOfExtraFactsConfirmation[0]!
  const saved = savedTablesOf(armNameOf('three-base', seedsOfExtraFactsConfirmation), settingOfKey('all').name, seed)
  const built = await buildRecipe(bestOfExtraFacts, seed, 'combined-check')
  check(tablesToJson(built.tables) === tablesToJson(saved), `the recipe without the arm's new parts gives the tables that ../extra-facts/run.ts saved for its best row and the seed ${seed}`)
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
