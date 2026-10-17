// Checks of what the arm "combined" adds to the recipes of round 1, in six parts:
// 1. Valid JSON of more than 16 levels. For today's tables the mask of the kept cells is the one of
//    ../generic/generic.ts. For the bases of the arm's three lines, tables with the base's choice in the cells of
//    the mask and a random choice in every other open cell and open display entry give such texts the depth and
//    the container of the base at every code point, in five forms: the four of deep-valid.ts and texts with a
//    container after their deepest part. Without the mask, random open cells give other depths. Such random tables
//    show other display kinds than the base, and with today's kinds in the display entries of the state `error`,
//    the third kept setting, they show the base's kinds at every code point when the base holds today's cells.
//    The two bases of today's tables have no wrong depth on those texts. The hand-written base is checked to fail
//    in the form with members and small containers on both sides, as README.md says it does: the base itself has
//    wrong depths there, and its mask, which is made from chains of containers, does not keep what the base does.
//    And the display kinds of a valid text that deep-valid.ts scans are the reference highlighter's on texts that
//    the reference accepts.
// 2. The events of a text's end with added classes and spare states: after ruleOutEndEvents no trainable tokenizer
//    cell that a code point reads has a share for such an event, and random weights never snap to one.
// 3. The search that counts whole samples first, on 2,000 train samples and 60 cells: its steps add up to a run of
//    every sample, which the search checks itself, and no whole sample is lost.
// 4. The saved tables of the generic recipe for the first tuning seed, when run.ts saved them: the cells of the mask
//    hold the base's choice, and no tokenizer cell that a code point reads holds an event of a text's end.
// 5. The recipe without the arm's new parts, bestOfExtraFacts, gives the tables that ../extra-facts/run.ts saved
//    for its best row and the seed 11, so that row is the control of the arm's line with the classes chosen by hand.
// 6. The saved tables of the candidates, when run.ts saved them: the two from today's tables have the depth, the
//    container and the display kind of today's tables at every code point of the too deep valid texts.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after
// `../extra-facts/run.ts --trainer three-base --settings all --seeds 11,12,13,14,15`, whose tables the fifth part
// compares with: without them the check fails. 2 to 3 minutes, most of it the training of the fifth part, with 4
// worker threads. check-all.ts runs it too:
//   bun lab/recovery-parser/learn/arms/combined/check.ts
import {existsSync} from 'node:fs'
import {labelsOfValidText} from '../../../labels.ts'
import {createRandom} from '../../../random.ts'
import {deepTexts} from '../../check-deep.ts'
import {validText, validTextOfDepth} from '../../check-texts.ts'
import {refuseUnknownOptions, selectSamples, standardRange} from '../../data.ts'
import {codePointsOf, runRecoveryParser} from '../../recovery-parser.ts'
import {type RecoveryTables, asIsTables, classNames, copyTables, eventNames, loadTablesOfThisDataset, randomizeOpenCells, tablesToJson} from '../../recovery-tables.ts'
import {prepareSamples, scoreOfSample, scorePack} from '../../search/sample-runs.ts'
import {createCellArrays, mixesInto, snappedTables} from '../../soft/twin.ts'
import {armNameOf, confirmationSeeds as seedsOfExtraFactsConfirmation, savedTablesOf, settingOfKey} from '../extra-facts/facts.ts'
import {cellsOfTooDeepValidJson as cellsOfTooDeepValidJsonOfGeneric} from '../generic/generic.ts'
import {trainPartOfTheStandardSet} from '../harness.ts'
import {
  baseOf, bestOfExtraFacts, buildRecipe, candidates, cellsOfTooDeepValidJson, fromHandWritten, generic, modelOf, recipeWith, reportedSeeds, savedTablesFileOf, searchedCellsOf, tuningSeeds, withHandClasses,
  withTodaysKindsInErrorState,
} from './combined.ts'
import {countsOnTooDeepTexts, kindsOfValidText, tooDeepForms} from './deep-valid.ts'
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
const deepForms = [...tooDeepForms, {name: 'a container after the deepest part', texts: deepTexts(300).filter(text => Array.from(text).length <= 460).map(text => `[${text}, {"after": [1, {"inner": [true]}]}, [null]]`)}]
// The form in which the hand-written base loses the depth, see deep-valid.ts.
const formOfAnyShape = tooDeepForms[3]!
// At how many code points of the texts `tables` give another depth or container than `base`, and at how many
// another display kind.
function differencesFrom(base: RecoveryTables, tables: RecoveryTables, texts: readonly string[]) {
  const differences = {nesting: 0, kinds: 0}
  for (const text of texts) {
    const {codePoints, truncated} = codePointsOf(text)
    const expected = runRecoveryParser(codePoints, truncated, base)
    const trace = runRecoveryParser(codePoints, truncated, tables)
    for (let position = 0; position < codePoints.length; position++) {
      if (trace.depthAfter[position] !== expected.depthAfter[position] || trace.containerAfter[position] !== expected.containerAfter[position]) differences.nesting++
      if (trace.displayKind[position] !== expected.displayKind[position]) differences.kinds++
    }
  }
  return differences
}
const randomSettings = 10
for (const {name, recipe} of [{name: 'the generic recipe', recipe: generic}, {name: 'the recipe with the classes chosen by hand', recipe: withHandClasses}, {name: 'the recipe from the hand-written tables', recipe: fromHandWritten}]) {
  const base = baseOf(recipe)
  const kept = cellsOfTooDeepValidJson(base)
  for (const form of deepForms) {
    const withTheMask = {nesting: 0, kinds: 0, kindsWithTodaysInErrorState: 0}
    let withoutTheMask = 0
    for (let setting = 0; setting < randomSettings; setting++) {
      const random = copyTables(base)
      randomizeOpenCells(random, createRandom(standardRange.seed, 100 + setting))
      withoutTheMask += differencesFrom(base, random, form.texts).nesting
      for (let cell = 0; cell < kept.length; cell++) {
        if (kept[cell] === 0) continue
        random.grammarNext[cell] = base.grammarNext[cell]!
        random.grammarAction[cell] = base.grammarAction[cell]!
      }
      const differences = differencesFrom(base, random, form.texts)
      withTheMask.nesting += differences.nesting
      withTheMask.kinds += differences.kinds
      withTheMask.kindsWithTodaysInErrorState += differencesFrom(base, withTodaysKindsInErrorState(random), form.texts).kinds
    }
    const maskShouldHold = recipe.start === 'today' || form !== formOfAnyShape
    check((withTheMask.nesting === 0) === maskShouldHold && withoutTheMask > 0, `${name}, ${countOf(kept)} kept cells, ${form.texts.length} too deep valid texts with ${form.name}, ${randomSettings} random settings of the other open cells: ${withTheMask.nesting} code points have another depth or container than with the base${maskShouldHold ? '' : ', since these texts read cells that the mask of this base does not hold'}, and ${withoutTheMask} without the mask`)
    if (recipe.start === 'today') check(withTheMask.kinds > 0 && withTheMask.kindsWithTodaysInErrorState === 0, `the same tables with the mask: ${withTheMask.kinds} code points are shown otherwise than with the base, and ${withTheMask.kindsWithTodaysInErrorState} with today's kinds in the display entries of the state error`)
  }
  const wrongDepthsOfBase = deepForms.map(form => countsOnTooDeepTexts(base, form.texts).wrongDepths)
  check(wrongDepthsOfBase.every((count, form) => (count === 0) === (recipe.start === 'today' || deepForms[form] !== formOfAnyShape)), `${name}: the base has ${wrongDepthsOfBase.join(', ')} wrong depths on the too deep valid texts of the five forms`)
}
{
  const random = createRandom(standardRange.seed, 400)
  let codePoints = 0
  let differences = 0
  for (let text = 0; text < 3000; text++) {
    const valid = text % 3 === 0 ? validTextOfDepth(random, 16) : validText(random)
    const labels = labelsOfValidText(valid)
    const kinds = kindsOfValidText(valid)
    codePoints += labels.length
    differences += kinds.length === labels.length ? labels.filter((label, position) => label.kind !== kinds[position]).length : labels.length
  }
  check(differences === 0, `the display kinds that deep-valid.ts scans differ from the reference highlighter's at ${differences} of the ${codePoints} code points of 3,000 valid texts that the reference accepts, 1,000 of them with 16 levels`)
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

// Part 6.
for (const candidate of candidates) {
  const files = reportedSeeds.map(seed => savedTablesFileOf('combined', candidate.recipe, seed))
  if (!files.every(file => existsSync(file))) {
    console.log(`skipped: the saved tables of the candidate ${JSON.stringify(candidate.name)} are not there`)
    continue
  }
  const counts = files.map(file => deepForms.map(form => countsOnTooDeepTexts(loadTablesOfThisDataset(file).tables, form.texts)))
  const total = (count: 'wrongDepths' | 'kindsOtherThanTodays') => counts.flat().reduce((sum, ofForm) => sum + ofForm[count], 0)
  const sentence = `the saved tables of the candidate ${JSON.stringify(candidate.name)}, seeds ${reportedSeeds.join(', ')}, on the too deep valid texts of the five forms: ${total('wrongDepths')} wrong depths, and ${total('kindsOtherThanTodays')} code points shown otherwise than by today's tables`
  if (candidate.recipe.start === 'today') check(total('wrongDepths') === 0 && total('kindsOtherThanTodays') === 0, sentence)
  else console.log(`not a check, since this candidate keeps what the hand-written tables do: ${sentence}`)
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
