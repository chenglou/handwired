// Checks of the rows that run.ts trains with the frozen recipe, in four parts:
// 1. The steps of recipe.ts are the recipe's. With the standard train set in the place of a neutral one, and from
//    nothing, they give for the seed 1 the tables that ../combined/run.ts saved, cell by cell: the training alone,
//    then the search, then the count, then today's kinds in the state `error`, which is the candidate "generic".
// 2. The train sets. The neutral set is the 40,457 samples of the neutral seed, the set without line edits holds
//    every sample of it without a deleted or a duplicated line and no other, and the rule that picks character
//    classes picks none from either.
// 3. The saved tables of the seed 1 of the two neutral rows are what the recipe gives from nothing on the neutral
//    set, at every step: the training alone, the count, today's kinds in the state `error`, and for the second row
//    the search before the count.
// 4. Every saved tables of the arm, each row and seed: every frozen cell and every display entry that is not open
//    holds what it holds today, the cells that valid JSON deeper than 16 levels reads hold today's choices, the
//    display entries of the state `error` hold today's kinds, no tokenizer cell that a code point reads holds an
//    event of a text's end, and the record says that the ground rules hold on the harness's fixed texts.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo, after run.ts. About 6 minutes with
// 4 worker threads: two trainings and two searches. --only-saved runs the parts 2 and 4 alone, in a few seconds.
//   bun lab/recovery-parser/learn/arms/neutral-damage/check-recipe.ts [--only-saved]
import {existsSync} from 'node:fs'
import {refuseUnknownOptions} from '../../data.ts'
import {type RecoveryTables, actionByToken, classNames, eventNames, loadTablesOfThisDataset, problemsOf, tablesToJson, today} from '../../recovery-tables.ts'
import {type Recipe, cellsOfTooDeepValidJson, savedTablesFileOf} from '../combined/combined.ts'
import {savedResultOf} from '../harness.ts'
import {neutralEditNames} from './neutral-edits.ts'
import {loadNeutralSet, neutralSeed} from './neutral.ts'
import {
  type Row, armName, baseOn, classesFrom, fileSavedByCombined, neutralDamage, neutralDamageWithoutLineEdits, primaryRow, rowsByName, savedTablesFileOfRow, searchedRow, seeds, settingNameOf, standardTrainSet,
  stepsOf, tablesOn, withTheSearch,
} from './recipe.ts'

refuseUnknownOptions('arms/neutral-damage/check-recipe.ts', ['--only-saved'])
const onlySaved = process.argv.includes('--only-saved')
let failures = 0
const check = (holds: boolean, sentence: string) => {
  if (!holds) failures++
  console.log(`${holds ? 'ok' : 'FAILED'}: ${sentence}`)
}
const firstSeed = seeds[0]!

// The steps of a recipe on a train set for one seed, each made from the tables of the step before it and none read
// from a file: the training alone first.
async function stepsFromNothing(row: Row, seed: number): Promise<{recipe: Recipe, tables: RecoveryTables}[]> {
  const made: {recipe: Recipe, tables: RecoveryTables}[] = []
  for (const recipe of stepsOf(row.recipe)) {
    const before = made.at(-1)
    made.push({recipe, tables: await tablesOn(row.trainSet, recipe, seed, () => before?.tables)})
  }
  return made
}

// Part 1.
if (!onlySaved) {
  const savedFiles = stepsOf(withTheSearch).map(recipe => savedTablesFileOf('combined', recipe, firstSeed))
  if (!savedFiles.every(file => existsSync(file))) {
    console.log(`skipped: the tables that ../combined/run.ts saved for the candidate "generic" and the seed ${firstSeed} are not all there, so the steps of recipe.ts are not compared with them`)
  } else {
    const made = await stepsFromNothing({trainSet: standardTrainSet, recipe: withTheSearch}, firstSeed)
    const different = made.filter(({tables}, step) => tablesToJson(tables) !== tablesToJson(loadTablesOfThisDataset(savedFiles[step]!).tables)).length
    check(different === 0 && made.length === 4, `with the standard train set and the seed ${firstSeed}, the steps of recipe.ts give from nothing the tables that ../combined/run.ts saved: ${made.length - different} of the ${made.length} steps of the candidate "generic" are the same, cell by cell`)
  }
}

// Part 2.
{
  const set = loadNeutralSet()
  const all = neutralDamage.samples()
  const lineEdits = ['delete one line', 'duplicate one line'].map(name => neutralEditNames.indexOf(name))
  const withALineEdit = Int32Array.from({length: all.sampleCount}, (_, place) => place).filter(place => set.editList.subarray(set.editStart[place], set.editStart[place + 1]).some(edit => lineEdits.includes(edit)))
  const without = neutralDamageWithoutLineEdits.samples()
  const left = new Set(without.index)
  check(all.seed === neutralSeed && all.sampleCount === 40_457 && !all.withTest, `the neutral set holds ${all.sampleCount} samples of the neutral seed ${all.seed}`)
  check(without.sampleCount === all.sampleCount - withALineEdit.length && withALineEdit.every(place => !left.has(all.index[place]!)) && left.size === without.sampleCount,
    `the set without line edits holds ${without.sampleCount} samples: the neutral set without its ${withALineEdit.length} samples with a deleted or a duplicated line`)
  check(classesFrom(neutralDamage).length === 0 && classesFrom(neutralDamageWithoutLineEdits).length === 0, `the rule picks ${classesFrom(neutralDamage).length} classes from the neutral set and ${classesFrom(neutralDamageWithoutLineEdits).length} from the set without line edits, where it picks ${classesFrom(standardTrainSet).length} from the standard train set`)
}

// Part 3.
if (!onlySaved) {
  for (const row of [primaryRow, searchedRow]) {
    const steps = stepsOf(row.recipe)
    const savedFiles = steps.map(recipe => savedTablesFileOfRow({trainSet: row.trainSet, recipe}, firstSeed))
    if (!savedFiles.every(file => existsSync(file))) {
      check(false, `the saved tables of ${JSON.stringify(settingNameOf(row))} and the seed ${firstSeed} are not all there: run run.ts first`)
      continue
    }
    const made = await stepsFromNothing(row, firstSeed)
    const different = made.filter(({tables}, step) => tablesToJson(tables) !== tablesToJson(loadTablesOfThisDataset(savedFiles[step]!).tables)).length
    check(different === 0, `${JSON.stringify(settingNameOf(row))}, seed ${firstSeed}: the recipe gives from nothing the saved tables at ${made.length - different} of its ${made.length} steps`)
  }
}

// Part 4.
{
  const endEvents = (['end', 'endInsideToken', 'truncatedEnd'] as const).map(name => eventNames.indexOf(name))
  const endClasses = (['end', 'truncatedEnd'] as const).map(name => classNames.indexOf(name))
  // The frozen cells and entries of `tables` that hold something else than today's: a frozen cell of an added class
  // holds what today's cell of the class of its code points holds, and one with the bit "first on its line" what
  // today's cell without the bit holds.
  const changedFrozenCells = (tables: RecoveryTables) => {
    const counts = {frozen: 0, changed: 0}
    for (let cell = 0; cell < tables.lexerOpen.length; cell++) {
      if (tables.lexerOpen[cell] === 1) continue
      counts.frozen++
      const cellToday = Math.floor(cell / tables.classCount) * today.classCount + tables.classToday[cell % tables.classCount]!
      if (tables.lexerNext[cell] !== today.lexerNext[cellToday] || tables.lexerEvent[cell] !== today.lexerEvent[cellToday]) counts.changed++
    }
    for (let cell = 0; cell < tables.grammarOpen.length; cell++) {
      if (tables.grammarOpen[cell] === 1) continue
      counts.frozen++
      const cellToday = Math.floor(cell / tables.contextCount) * today.contextCount + cell % today.contextCount
      if (tables.grammarNext[cell] !== today.grammarNext[cellToday] || tables.grammarAction[cell] !== actionByToken) counts.changed++
    }
    for (let entry = 0; entry < tables.displayOpen.length; entry++) {
      if (tables.displayOpen[entry] === 1) continue
      counts.frozen++
      if (tables.display[entry] !== today.display[entry]) counts.changed++
    }
    return counts
  }
  // Each step once: two rows on one train set share their training.
  const checkedSteps = new Set<string>()
  for (const row of Object.values(rowsByName)) {
    for (const recipe of stepsOf(row.recipe)) {
      const step: Row = {trainSet: row.trainSet, recipe}
      if (checkedSteps.has(settingNameOf(step))) continue
      checkedSteps.add(settingNameOf(step))
      // A step that ../combined/run.ts saved is not saved here, e.g. the training alone on the standard train set
      // with the rule's classes: the check of that arm reads it.
      if (seeds.every(seed => fileSavedByCombined(step, seed) !== undefined)) continue
      const files = seeds.map(seed => savedTablesFileOfRow(step, seed))
      if (!files.every(file => existsSync(file))) {
        check(false, `the saved tables of ${JSON.stringify(settingNameOf(step))} are not there for the seeds ${seeds.join(', ')}: run run.ts first`)
        continue
      }
      const base = baseOn(row.trainSet, recipe)
      const kept = cellsOfTooDeepValidJson(base)
      const totals = {frozen: 0, changedFrozen: 0, problems: 0, changedKept: 0, otherKindsInErrorState: 0, endEvents: 0}
      for (const file of files) {
        const {tables} = loadTablesOfThisDataset(file)
        const frozen = changedFrozenCells(tables)
        totals.frozen += frozen.frozen
        totals.changedFrozen += frozen.changed
        totals.problems += problemsOf(tables).length
        for (let cell = 0; cell < kept.length; cell++) if (kept[cell] === 1 && (tables.grammarNext[cell] !== base.grammarNext[cell] || tables.grammarAction[cell] !== base.grammarAction[cell])) totals.changedKept++
        if (recipe.todaysKindsInErrorState) for (let event = 0; event < tables.eventCount; event++) if (tables.display[event * tables.grammarStateCount + today.errorState] !== today.display[event * today.grammarStateCount + today.errorState]) totals.otherKindsInErrorState++
        totals.endEvents += Array.from(tables.lexerEvent).filter((event, cell) => !endClasses.includes(cell % tables.classCount) && endEvents.includes(event)).length
      }
      const records = savedResultOf(armName, settingNameOf(step)).records
      const groundRulesHold = records.length === seeds.length && records.every(record => record.groundRules.hold)
      check(totals.changedFrozen === 0 && totals.problems === 0 && totals.changedKept === 0 && totals.otherKindsInErrorState === 0 && totals.endEvents === 0 && groundRulesHold,
        `${settingNameOf(step)}, seeds ${seeds.join(', ')}: of the ${totals.frozen / files.length} frozen cells and entries of each of the ${files.length} tables, ${totals.changedFrozen} hold something else than today's, checkTables names ${totals.problems} problems, ${totals.changedKept} kept cells of too deep valid JSON are changed, ${recipe.todaysKindsInErrorState ? `${totals.otherKindsInErrorState} display entries of the state error hold another kind than today's, ` : ''}${totals.endEvents} tokenizer cells that a code point reads hold an event of a text's end, and the ground rules ${groundRulesHold ? 'hold' : 'do NOT hold'} on the fixed texts of every record`)
    }
  }
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
