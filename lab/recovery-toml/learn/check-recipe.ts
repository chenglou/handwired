// Checks the parts of the recipe that are not checked elsewhere: the three kept settings, the count, the rule of the
// classes, and the recipe as a whole on the small set of check-set.ts. The set is no training set of the
// experiment, so the numbers of the last part say that the steps work together and nothing about the recipe.
//
// Run from the repo root: bun lab/recovery-toml/learn/check-recipe.ts
//
// 1. The kept cells. With the base's choice in them, with a random choice in every other open cell and with today's
//    kinds in the display entries of the state `error`, a valid text with a value of more than 16 levels is shown as
//    today from its first error on: the display kind, the depth, the container and the grammar state after every code
//    point. The texts are other ones than those that the kept cells were found with. Without the kept cells the same
//    random settings break them, so the check can fail.
// 2. No end event. A model with ruleOutEndEvents gives the three events of a text's end the share 0 in every
//    trainable tokenizer cell that a code point reads, and its snapped tables hold such an event in no cell that the
//    base does not hold it in, also when the weights of those events are raised.
// 3. The count. After displayEntriesByCount, the train samples have at least as many scored code points right, a
//    second count changes nothing, and no single entry can hold a kind that more train code points want.
// 4. The rule of the classes on a set in which one code point is made to stand out, and on the check set.
// 5. The recipe on a check set of 8,000 texts, both rows: the tables keep the ground rules, hold the base's choice in
//    every kept cell and today's kinds in the state `error`, hold no new end event, show too deep valid texts as
//    today, and have more scored code points right than the parser as it is on the train samples and on the
//    validation samples of that set. The set has to be that large for the training to change a cell: a cell only
//    snaps to another choice after about 50 steps of Adam, and three passes over the 720 train samples of 2,000
//    texts are 68 steps. On a set of 600 texts, two runs with the same seed give the same tables.
import {labelReference} from '../reference.ts'
import {capacity} from '../table-parser.ts'
import {checkSampleAt, checkSamples} from './check-set.ts'
import {type LabeledText, samplesOf, trainPart, validationPart} from './data.ts'
import {refuseUnknownOptions} from './options.ts'
import {createRandom} from './random.ts'
import {type RecoveryTables, asIsTables, cellCounts, checkTables, classNames, copyTables, displayEntryOf, displayKindCount, displayKindNames, eventNames, grammarCellName, randomizeOpenCells, tablesToJson, today} from './recovery-tables.ts'
import {
  baseOfRecipe, cellsOfTooDeepValidTexts, classesChosenFromTrainSamples, codePointsOfTheRule, differencesOnTooDeepTexts, displayEntriesByCount, recipeSettings, ruleOutEndEvents, runRecipe, tooDeepTextsOfTheCheck,
  trainableGrammarCellsOf, withTodaysKindsInErrorState,
} from './recipe.ts'
import {scoreTables, sharesOf} from './score.ts'
import {createCellArrays, createModel, mixesInto, snappedTables} from './soft/twin.ts'

refuseUnknownOptions('check-recipe.ts', [])
let failures = 0
const check = (holds: boolean, message: string) => {
  if (holds) return
  failures++
  if (failures <= 20) console.log(`FAILED: ${message}`)
}

const endEvents = (['end', 'endInsideToken', 'truncatedEnd'] as const).map(name => eventNames.indexOf(name))
const endClasses = (['end', 'truncatedEnd'] as const).map(name => classNames.indexOf(name))
// The tokenizer cells of `tables` that hold an event of a text's end and are no cells of the two classes of a
// text's end, as a list of their numbers.
const cellsWithAnEndEvent = (tables: RecoveryTables) => Array.from(tables.lexerEvent, (event, cell) => endEvents.includes(event) && !endClasses.includes(cell % tables.classCount) ? cell : -1).filter(cell => cell !== -1)

// Too deep valid texts that the kept cells were not found with.
const tooDeepTexts = tooDeepTextsOfTheCheck(600)
const wrongOnTooDeepTexts = (tables: RecoveryTables) => differencesOnTooDeepTexts(tables, tooDeepTexts)

// The base of the checks 1 and 2: the recipe's base with a class that the rule could pick.
const base = baseOfRecipe([{name: 'U+003B', codePoints: [0x3b]}])

// 1. The kept cells.
{
  const kept = cellsOfTooDeepValidTexts(base)
  const keptCount = kept.reduce((total, bit) => total + bit, 0)
  const cellsPerState = base.tokenCount * base.contextCount
  const outsideErrorRow = Array.from(kept, (bit, cell) => bit === 1 && Math.floor(cell / cellsPerState) !== base.errorState ? cell : -1).filter(cell => cell !== -1)
  const asIs = wrongOnTooDeepTexts(base)
  check(asIs.state + asIs.nesting + asIs.kind === 0 && asIs.openTokenizerCells === 0, `the base shows too deep valid texts otherwise than today at ${asIs.state + asIs.nesting + asIs.kind} code points, and ${asIs.openTokenizerCells} of their code points read an open tokenizer cell`)
  const totals = {withKept: {state: 0, nesting: 0, kind: 0}, withoutThird: {kind: 0}, withoutKept: {state: 0, nesting: 0}}
  const settings = 12
  for (let setting = 0; setting < settings; setting++) {
    const random = createRandom(20261016, 500 + setting)
    const changed = copyTables(base)
    randomizeOpenCells(changed, random)
    const withoutKept = wrongOnTooDeepTexts(changed)
    totals.withoutKept.state += withoutKept.state
    totals.withoutKept.nesting += withoutKept.nesting
    // The kept cells hold the base's choice again.
    for (let cell = 0; cell < kept.length; cell++) {
      if (kept[cell] === 0) continue
      changed.grammarNext[cell] = base.grammarNext[cell]!
      changed.grammarAction[cell] = base.grammarAction[cell]!
    }
    totals.withoutThird.kind += wrongOnTooDeepTexts(changed).kind
    const withKept = wrongOnTooDeepTexts(withTodaysKindsInErrorState(changed))
    totals.withKept.state += withKept.state
    totals.withKept.nesting += withKept.nesting
    totals.withKept.kind += withKept.kind
  }
  check(totals.withKept.state + totals.withKept.nesting + totals.withKept.kind === 0, `with the three kept settings, too deep valid texts have ${totals.withKept.state} other grammar states, ${totals.withKept.nesting} other depths or containers and ${totals.withKept.kind} other display kinds than today`)
  check(totals.withoutKept.state > 0 && totals.withoutKept.nesting > 0 && totals.withoutThird.kind > 0, 'random settings of the open cells do not change what a too deep valid text gets, so the check says nothing')
  console.log(`1. ${keptCount} of the ${cellCounts(base).grammarOpen} open grammar cells are kept: the ${keptCount - outsideErrorRow.length} open cells of the row of the state error and ${outsideErrorRow.length} others, ${outsideErrorRow.slice(0, 4).map(cell => grammarCellName(base, cell)).join(' ')}${outsideErrorRow.length > 4 ? ' ...' : ''}. `
    + `On ${tooDeepTexts.length} too deep valid texts, ${asIs.codePoints} code points from the first error on, with ${settings} random settings of every other open cell and entry: with the three kept settings every code point has today's grammar state, depth, container and display kind. `
    + `Without the kept cells ${totals.withoutKept.nesting} depths or containers differ over the ${settings} settings, and without today's kinds in the state error ${totals.withoutThird.kind} display kinds.`)
}

// 2. No end event.
{
  const model = createModel(base, {start: 'base', trainable: {lexer: 'open', grammar: trainableGrammarCellsOf(base), display: 'open'}})
  ruleOutEndEvents(model)
  // Raise the weights of the end events that are left, and of one other event per cell, far above the base's choice.
  const random = createRandom(20261016, 600)
  const {classCount, eventCount} = base
  let ruledOut = 0
  for (let cell = 0; cell < model.trainableLexer.length; cell++) {
    if (model.trainableLexer[cell] === 0) continue
    for (const event of endEvents) {
      if (model.weights.lexerEvent[cell * eventCount + event] === -Infinity) ruledOut++
      else model.weights.lexerEvent[cell * eventCount + event] = 20
    }
    const other = random.integer(0, endEvents[0]! - 1)
    model.weights.lexerEvent[cell * eventCount + other] = 15 + random.next()
  }
  const mixes = createCellArrays(model.shape)
  let sharesOfEndEvents = 0
  for (const temperature of [1, 0.5]) {
    mixesInto(model, temperature, mixes)
    for (let cell = 0; cell < model.trainableLexer.length; cell++) {
      if (model.trainableLexer[cell] === 0 || endClasses.includes(cell % classCount) || endEvents.includes(base.lexerEvent[cell]!)) continue
      for (const event of endEvents) if (mixes.lexerEvent[cell * eventCount + event] !== 0) sharesOfEndEvents++
    }
  }
  const snapped = snappedTables(model)
  checkTables(snapped)
  const before = cellsWithAnEndEvent(base)
  const after = cellsWithAnEndEvent(snapped)
  const changedCells = Array.from(snapped.lexerEvent, (event, cell) => event !== base.lexerEvent[cell] ? 1 : 0).reduce((total: number, bit) => total + bit, 0)
  check(sharesOfEndEvents === 0, `${sharesOfEndEvents} mixes give an event of a text's end a share`)
  check(after.every(cell => before.includes(cell)) && changedCells > 1000, `the snapped tables hold an event of a text's end in ${after.filter(cell => !before.includes(cell)).length} cells that the base does not hold it in, and ${changedCells} cells changed their event`)
  console.log(`2. ruleOutEndEvents takes the three events of a text's end out of ${ruledOut / 3} trainable tokenizer cells. With the weights of every other event of a text's end at 20 and of one other event at 15: no such cell gives an end event a share, ${changedCells} cells snap to another event, and none to an event of a text's end. The base holds such an event in ${before.length} cells that a code point reads.`)
}

const train = trainPart(checkSamples(2000))

// 3. The count.
{
  const start = baseOfRecipe([])
  const changed = copyTables(start)
  randomizeOpenCells(changed, createRandom(20261016, 700))
  // Random display entries on today's cells, so that many samples read many entries.
  const tables = copyTables(start)
  tables.display.set(changed.display)
  const counted = displayEntriesByCount(tables, train)
  checkTables(counted)
  const rowBefore = scoreTables(tables, train, {splits: ['train'], breakdowns: false}).rows[0]!
  const rowAfter = scoreTables(counted, train, {splits: ['train'], breakdowns: false}).rows[0]!
  const again = displayEntriesByCount(counted, train)
  // No other kind in one entry has more scored code points right.
  let betterSingleChanges = 0
  let triedChanges = 0
  const random = createRandom(20261016, 701)
  const probe = copyTables(counted)
  for (let trial = 0; trial < 60; trial++) {
    let entry = random.integer(0, probe.display.length - 1)
    while (probe.displayOpen[entry] === 0) entry = random.integer(0, probe.display.length - 1)
    const held = probe.display[entry]!
    for (let kind = 0; kind < displayKindCount; kind++) {
      if (kind === held || kind === displayKindNames.indexOf('pastEnd')) continue
      probe.display[entry] = kind
      triedChanges++
      if (scoreTables(probe, train, {splits: ['train'], breakdowns: false}).rows[0]!.allRight > rowAfter.allRight) betterSingleChanges++
    }
    probe.display[entry] = held
  }
  check(rowAfter.allRight > rowBefore.allRight && tablesToJson(again) === tablesToJson(counted) && betterSingleChanges === 0, `the count takes the train samples from ${rowBefore.allRight} to ${rowAfter.allRight} scored code points right, a second count ${tablesToJson(again) === tablesToJson(counted) ? 'changes nothing' : 'changes entries'}, and ${betterSingleChanges} other kinds of single entries have more right`)
  console.log(`3. The count, from random kinds in the ${cellCounts(start).displayOpen} open display entries of today's cells: the train samples of the check set go from ${rowBefore.allRight} to ${rowAfter.allRight} of ${rowAfter.codePoints} scored code points right. A second count changes nothing, and none of ${triedChanges} other kinds in single entries has more right.`)
}

// 4. The rule of the classes.
{
  // A set in which the semicolon stands out: 300 documents whose first line is `name = "x" # note! and more`, with a
  // semicolon in the place of that line's equals sign. So the semicolon comes at the first error of every sample, as
  // a code point that the damage added, and the `!` of the comment comes after it with the outcome "commentContent".
  // Both have the class `other` today, and each is far from the rest of that class.
  const texts: LabeledText[] = []
  const at = 5
  for (let index = 0; texts.length < 300; index++) {
    const original = `name = "x" # note! and more\n${checkSampleAt(20261016, index).original!}`
    const codePoints = Array.from(original)
    const reference = labelReference(original)
    if (codePoints.length > capacity || !reference.valid) continue
    const alignment = codePoints.map((_, position) => position === at ? -1 : position)
    texts.push({
      index, split: 'train', source: 'damage', kinds: ['replacedCodePoint'], broken: [...codePoints.slice(0, at), ';', ...codePoints.slice(at + 1)].join(''),
      labels: alignment.map(counterpart => counterpart === -1 ? undefined : reference.labels[counterpart]!), firstDamage: at, original, alignment,
    })
  }
  const made = samplesOf(texts)
  const ofTheSet = codePointsOfTheRule(made)
  const semicolon = ofTheSet.find(entry => entry.codePoint === 0x3b)
  const picked = classesChosenFromTrainSamples(made)
  check(semicolon !== undefined && semicolon.picked && semicolon.mostFrequentOutcome === 'added' && picked.some(added => added.name === 'U+003B' && added.codePoints[0] === 0x3b), `the rule does not pick the semicolon in a set made for it: ${JSON.stringify(semicolon)}`)
  check(ofTheSet.every(entry => entry.samples >= recipeSettings.leastSamplesOfTheRule) && ofTheSet.every((entry, index) => index === 0 || entry.distance <= ofTheSet[index - 1]!.distance), 'the list of the rule holds a code point of fewer than 100 samples, or is not in the order of the distances')
  baseOfRecipe(picked)
  const ofTheCheckSet = codePointsOfTheRule(train)
  const describe = (entry: (typeof ofTheSet)[number]) => `${JSON.stringify(String.fromCodePoint(entry.codePoint))} of the class ${classNames[entry.classToday]} (${entry.samples} samples, distance ${entry.distance.toFixed(2)}, ${(100 * entry.shareOfMostFrequentOutcome).toFixed(0)}% ${entry.mostFrequentOutcome})`
  console.log(`4. The rule of the classes. In a set of ${made.sampleCount} samples with a semicolon at the first error of each, where the damage added it, the rule picks ${picked.map(added => added.name).join(', ')}: ${semicolon === undefined ? '' : describe(semicolon)}. `
    + `In the train samples of the check set, ${ofTheCheckSet.length} code points come after a first error in at least ${recipeSettings.leastSamplesOfTheRule} samples, and the rule picks ${ofTheCheckSet.filter(entry => entry.picked).length} of them${ofTheCheckSet.filter(entry => entry.picked).length === 0 ? '' : `: ${ofTheCheckSet.filter(entry => entry.picked).map(describe).join('; ')}`}. The largest distances: ${ofTheCheckSet.slice(0, 3).map(describe).join('; ')}.`)
}

// 5. The recipe on a larger check set.
{
  const samplesOfTheRecipe = checkSamples(8000)
  const trainOfTheRecipe = trainPart(samplesOfTheRecipe)
  const validationOfTheRecipe = validationPart(samplesOfTheRecipe)
  const result = await runRecipe(samplesOfTheRecipe, 1)
  const rows: [string, RecoveryTables | undefined][] = [['the training, the count, today\'s kinds in the state error', result.primary], ['the same with the search before the count', result.withSearch]]
  const kept = cellsOfTooDeepValidTexts(result.base)
  const endCellsOfBase = cellsWithAnEndEvent(result.base)
  const scoreOf = (tables: RecoveryTables, split: 'train' | 'validation') => scoreTables(tables, split === 'train' ? trainOfTheRecipe : validationOfTheRecipe, {splits: [split], breakdowns: false}).rows[0]!
  const asIs = {train: scoreOf(asIsTables(), 'train'), validation: scoreOf(asIsTables(), 'validation')}
  const percent = (share: number) => `${(100 * share).toFixed(1)}%`
  console.log(`5. The recipe on a check set of ${samplesOfTheRecipe.sampleCount} texts, seed 1: ${result.classes.length} classes from the rule (${result.classes.map(added => added.name).join(', ')}), ${result.keptGrammarCells} kept grammar cells, ${result.trainingSeconds.toFixed(0)} s of training at ${result.samplesPerSecond.toFixed(0)} samples per second, ${result.searchSeconds.toFixed(0)} s of search (${result.search?.passes} passes, ${result.search?.changes} changes). `
    + `The parser as it is has ${asIs.train.allRight} of ${asIs.train.codePoints} scored code points right on the train samples (${percent(sharesOf(asIs.train).allThree)}, whole samples ${percent(sharesOf(asIs.train).whole)}) and ${asIs.validation.allRight} of ${asIs.validation.codePoints} on the validation samples (${percent(sharesOf(asIs.validation).allThree)}, ${percent(sharesOf(asIs.validation).whole)}).`)
  for (const [name, tables] of rows) {
    if (tables === undefined) {
      check(false, `the recipe gave no tables for the row: ${name}`)
      continue
    }
    checkTables(tables)
    let keptChanged = 0
    for (let cell = 0; cell < kept.length; cell++) if (kept[cell] === 1 && (tables.grammarNext[cell] !== result.base.grammarNext[cell] || tables.grammarAction[cell] !== result.base.grammarAction[cell])) keptChanged++
    let otherKindsInErrorState = 0
    for (let event = 0; event < tables.eventCount; event++) if (tables.display[displayEntryOf(tables, event, today.errorState)] !== today.display[event * today.grammarStateCount + today.errorState]) otherKindsInErrorState++
    const newEndEvents = cellsWithAnEndEvent(tables).filter(cell => !endCellsOfBase.includes(cell)).length
    const onTooDeep = wrongOnTooDeepTexts(tables)
    const ofTrain = scoreOf(tables, 'train')
    const ofValidation = scoreOf(tables, 'validation')
    check(keptChanged === 0 && otherKindsInErrorState === 0 && newEndEvents === 0, `${name}: ${keptChanged} kept cells changed, ${otherKindsInErrorState} display entries of the state error do not hold today's kind, and ${newEndEvents} cells hold a new event of a text's end`)
    check(onTooDeep.state + onTooDeep.nesting + onTooDeep.kind === 0, `${name}: too deep valid texts have ${onTooDeep.state} other grammar states, ${onTooDeep.nesting} other depths or containers and ${onTooDeep.kind} other display kinds than today`)
    check(ofTrain.allRight > asIs.train.allRight && ofValidation.allRight > asIs.validation.allRight, `${name}: ${ofTrain.allRight} scored code points right on the train samples and ${ofValidation.allRight} on the validation samples, against ${asIs.train.allRight} and ${asIs.validation.allRight} for the parser as it is`)
    check(ofTrain.shownAsPastEnd === 0 && ofValidation.shownAsPastEnd === 0, `${name}: ${ofTrain.shownAsPastEnd + ofValidation.shownAsPastEnd} code points are shown as past the end`)
    console.log(`   ${name}: ${ofTrain.allRight} right on the train samples (${percent(sharesOf(ofTrain).allThree)}, whole samples ${percent(sharesOf(ofTrain).whole)}) and ${ofValidation.allRight} on the validation samples (${percent(sharesOf(ofValidation).allThree)}, ${percent(sharesOf(ofValidation).whole)}). The tables keep the ground rules, hold the base's choice in the kept cells and today's kinds in the state error, hold no new event of a text's end, and show ${tooDeepTexts.length} too deep valid texts as today.`)
  }
  // The same seed, the same tables: two runs on a small set.
  const few = checkSamples(600)
  const first = await runRecipe(few, 3)
  const second = await runRecipe(few, 3)
  const same = tablesToJson(first.primary) === tablesToJson(second.primary) && first.withSearch !== undefined && second.withSearch !== undefined && tablesToJson(first.withSearch) === tablesToJson(second.withSearch)
  check(same, 'two runs of the recipe with the same seed give other tables')
  console.log(`   Two runs of the recipe on a set of ${few.sampleCount} texts with the same seed give ${same ? 'the same tables in both rows' : 'OTHER tables'}.`)
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
