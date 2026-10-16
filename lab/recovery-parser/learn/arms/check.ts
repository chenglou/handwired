// Checks the harness of the arms.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/check.ts
//
// 1. The dataset's hand rules as tables of the experiment: every cell of the converted tables is the hand rule's
//    cell, with the stack action `by token` in every grammar cell. On the broken texts of the train and validation
//    samples of the first 6,000 indexes, the exact parser with the converted tables gives the depth of the dataset's
//    plain table parser with the hand rule's tables at every code point. The two parsers keep the kinds of the open
//    containers in other ways, a real stack and a running sum, and after a closing bracket that does not match they
//    can disagree about the innermost container. The grammar then reads another context, so the display kind can
//    differ from there on too. Up to the first code point that reads another context, everything is the same, and the
//    check counts what differs after it. The four are tables of the plain table parser, and the hand-written 35
//    rules are not. And the cells that the dataset takes for read by valid JSON are the experiment's frozen cells,
//    cell by cell, so the dataset's first condition and the experiment's first ground rule are the same rule.
//    The hand rule `lines` has a tokenizer state of its own: code points are read in that state, and the record of
//    its tables counts the cells changed against today's tables with the same state added.
// 2. The record. For today's tables: its row "all" is the row of scoreTables, it has a row for each of the six
//    groups and for the kinds of damage, no cell is changed, the ground rules hold, and the depth of valid JSON that
//    is too deep is right. For the hand-written tables, whose score is not their base's: every row is the row of
//    scoreTables for those tables and not today's, the cells changed against the base are the cells that a count
//    made here finds, and with the hand-written tables as the base no cell is changed while as many differ from
//    today's parser. For tables with random open cells: the wrong depths on valid JSON that is too deep are the
//    ones of check-deep.ts for those tables, and not 0. The three fields of how the damage is shown are the counts
//    of scoreTables, divided here: for the hand-written tables, where all three are 0, and for today's tables and
//    the random ones, where they are not. Tables with a changed frozen cell get no record, and neither do tables
//    with themselves as the base, or with a base of another layout: each of those is refused with the sentence
//    that names the reason, also a base that lacks an added class or has a class for another code point.
// 3. The ground rules hold on the fixed texts for random settings of every open cell, with and without added
//    structure. And they do not hold for tables with one changed frozen cell, for every sixth frozen cell: the check
//    of the record can say "not hold".
// 4. The arithmetic of a report, on records made up with known numbers: the mean, the lowest and the highest, every
//    cell of a setting's row in each of the three tables of describeSettings, the sentence of describeComparison
//    with "overlap" and with "do not overlap", on the row "all" and on the row of a group, and its refusal of
//    fewer than 3 seeds.
// 5. runArm with toy build functions: a setting whose seed picks one of the dataset's hand rules, so that every seed
//    has another score, a setting without a seed, a build that ignores its seed, and a build whose third seed gives
//    other tables than its first two. runArm saves the tables and the record of every setting and seed, each record
//    is the record of its own saved tables and holds the arm, the setting and the seed, the summary's row is the
//    mean, the lowest and the highest that the check works out, only the build that ignores its seed is named, an
//    empty list of seeds, a seed that is named twice and a seed that is no whole number throw, and a rerun with
//    fewer seeds moves the earlier run's files away. savedResultOf reads every setting back as the result that
//    runArm returned, and refuses a folder without a record, a record of another dataset and a record of another
//    run: of another setting, of another arm, and of another seed.
// 6. arms/final.ts without a test sample: its report on validation samples whose held-out bits are made up has four
//    rows per tables that add up to the row of the whole split, which is the validation row of scoreTables. Its
//    tables have to be of this dataset: a file with another dataset key, or with none, is refused.
// 7. numberToBeat on scratch folders made here: the file is search/search-from-handwritten.json of the scratch
//    folder, its tables come back as a setting without a seed, with the hand-written tables as the base, and an
//    error says what to do for a missing file, for a file of another dataset and for a file without a dataset key.
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {handRuleTables, handRules} from '../../hand-rules.ts'
import {cellsThatValidJsonReads} from '../../limits.ts'
import {createRandom} from '../../random.ts'
import {runTableParser} from '../../table-parser.ts'
import {classesOfTheChecks} from '../check-texts.ts'
import {type Samples, datasetKey, groupNames, heldOutByKind, heldOutByTemplate, loadSamples, refuseUnknownOptions, standardRange, textOf} from '../data.ts'
import {handwrittenTables} from '../handwritten/rules.ts'
import {plainParserProblems, recoveryTablesOf} from '../plain-tables.ts'
import {createTrace, runRecoveryParserInto} from '../recovery-parser.ts'
import {
  type RecoveryTables, actionByToken, addClasses, addFirstOnLineBit, addStates, asIsTables, copyTables, grammarStateNames, loadTables, loadTablesForReport, loadTablesOfThisDataset, openDisplayEntries,
  otherDatasetOf, randomizeOpenCells, saveTables, tablesToJson,
} from '../recovery-tables.ts'
import {type ScoreRow, heldOutRowNames, scoreTables, sharesOf} from '../score.ts'
import {wrongDepthsOnDeepTexts} from '../check-deep.ts'
import {describeFinal, logLineOf, namedTablesOf} from './final.ts'
import {
  type ArmRecord, type SettingResult, armFolderOf, baselineTables, describeComparison, describeSettings, fileNameOf, groundRulesOn, numberToBeat, numberToBeatFileOf, percentSpread, recordOf, rowNamed, runArm,
  savedResultOf, spreadOf, todaysTablesWithTheStatesOf, trainDataFor, trainPartOfTheStandardSet, validationOfTheStandardSet,
} from './harness.ts'

refuseUnknownOptions('arms/check.ts', [])
let failures = 0
const check = (holds: boolean, message: string) => {
  if (holds) return
  failures++
  console.log(`FAILED: ${message}`)
}
const throws = (run: () => unknown) => {
  try {
    run()
  } catch {
    return true
  }
  return false
}
// The message of the error that `run` throws, or undefined when it throws none.
const errorOf = async (run: () => unknown): Promise<string | undefined> => {
  try {
    await run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  return undefined
}
// The cells in which two tables with the same layout differ, counted from the arrays.
const cellsThatDiffer = (left: RecoveryTables, right: RecoveryTables) => {
  let cells = 0
  for (let cell = 0; cell < left.lexerNext.length; cell++) if (left.lexerNext[cell] !== right.lexerNext[cell] || left.lexerEvent[cell] !== right.lexerEvent[cell]) cells++
  for (let cell = 0; cell < left.grammarNext.length; cell++) if (left.grammarNext[cell] !== right.grammarNext[cell] || left.grammarAction[cell] !== right.grammarAction[cell]) cells++
  for (let entry = 0; entry < left.display.length; entry++) if (left.display[entry] !== right.display[entry]) cells++
  return cells
}

// 1. The hand rules.
{
  // The dataset's cells that valid JSON reads against the experiment's frozen cells.
  const readByValidJson = cellsThatValidJsonReads()
  const today = asIsTables()
  let otherCells = 0
  for (let cell = 0; cell < today.lexerOpen.length; cell++) if (readByValidJson.tokenizer[cell] !== 1 - today.lexerOpen[cell]!) otherCells++
  for (let cell = 0; cell < today.grammarOpen.length; cell++) if (readByValidJson.grammar[cell] !== 1 - today.grammarOpen[cell]!) otherCells++
  check(readByValidJson.tokenizer.length === today.lexerOpen.length && readByValidJson.grammar.length === today.grammarOpen.length && otherCells === 0, `${otherCells} cells are frozen here and not read by valid JSON for the dataset, or the other way round`)
  console.log(`1. The cells that the dataset's limits.ts takes for read by valid JSON are the frozen cells of the experiment: ${today.lexerOpen.length} tokenizer cells and ${today.grammarOpen.length} grammar cells, ${otherCells} differ.`)
  const samples = loadSamples(standardRange.seed, 0, 6000)
  const trace = createTrace()
  for (const rule of handRules) {
    const plain = handRuleTables(rule)
    const tables = recoveryTablesOf(plain)
    // Cell by cell: the texts below read only a part of the cells, e.g. none of them reads (value, openObject,
    // depth 16, array), so a wrong cell there would pass a check by traces.
    let otherCells = 0
    for (let cell = 0; cell < plain.lexerNext.length; cell++) if (tables.lexerNext[cell] !== plain.lexerNext[cell] || tables.lexerEvent[cell] !== plain.lexerEvent[cell]) otherCells++
    for (let cell = 0; cell < plain.grammarNext.length; cell++) if (tables.grammarNext[cell] !== plain.grammarNext[cell] || tables.grammarAction[cell] !== actionByToken) otherCells++
    for (let entry = 0; entry < plain.display.length; entry++) if (tables.display[entry] !== plain.display[entry]) otherCells++
    check(tables.lexerNext.length === plain.lexerNext.length && tables.grammarNext.length === plain.grammarNext.length && tables.display.length === plain.display.length && otherCells === 0,
      `the hand rule ${rule}: ${otherCells} cells of the converted tables are not the hand rule's cell with the stack action \`by token\`, or the tables have other sizes`)
    const tally = {texts: 0, codePoints: 0, otherDepth: 0, differentBeforeAnotherContext: 0, textsWithAnotherContext: 0, otherContainer: 0, otherKind: 0, inAddedState: 0}
    for (let place = 0; place < samples.sampleCount; place++) {
      if (samples.firstDamage[place] === -1) continue
      tally.texts++
      const start = samples.start[place]!
      const length = samples.start[place + 1]! - start
      const expected = runTableParser(textOf(samples, place), plain)
      runRecoveryParserInto(trace, samples.codePoints, start, length, false, tables, length)
      // Whether a code point so far read another context in the two parsers.
      let anotherContext = false
      for (let position = 0; position < length; position++) {
        tally.codePoints++
        if (!anotherContext && trace.context[position] !== expected.context[position]) {
          anotherContext = true
          tally.textsWithAnotherContext++
        }
        if (trace.depthAfter[position] !== expected.depthAfter[position]) tally.otherDepth++
        if (trace.lexerStateBefore[position]! >= today.lexerStateCount) tally.inAddedState++
        const otherKind = trace.displayKind[position] !== expected.displayKind[position]
        const otherContainer = trace.containerAfter[position] !== expected.containerAfter[position]
        if (otherKind) tally.otherKind++
        if (otherContainer) tally.otherContainer++
        // The code point that first reads another context can itself be shown as another kind. The container after
        // a code point is the context of the next one, so it may differ one code point earlier.
        if (!anotherContext && otherKind) tally.differentBeforeAnotherContext++
      }
    }
    check(tally.otherDepth === 0, `the hand rule ${rule}: ${tally.otherDepth} code points have another depth in the exact parser than in the plain table parser`)
    check(tally.differentBeforeAnotherContext === 0, `the hand rule ${rule}: ${tally.differentBeforeAnotherContext} code points have another display kind before the two parsers read another context`)
    check(plainParserProblems(tables).length === 0, `the hand rule ${rule} is no setting of the plain table parser: ${plainParserProblems(tables)[0]}`)
    const share = (count: number) => `${count} (${(100 * count / tally.codePoints).toFixed(2)}%)`
    console.log(`   The hand rule ${rule} as tables of the experiment: all ${plain.lexerNext.length} tokenizer cells, ${plain.grammarNext.length} grammar cells and ${plain.display.length} entries of the display table are the hand rule's, with \`by token\` in every grammar cell. On ${tally.texts} broken texts, ${tally.codePoints} code points, the exact parser gives the depth of the dataset's plain table parser at every one. In ${tally.textsWithAnotherContext} texts the real stack and the running sum disagree about a container. From the first code point that reads another context on, the container differs at ${share(tally.otherContainer)} code points and the display kind at ${share(tally.otherKind)}. Before it nothing differs.`)
    // A hand rule with a tokenizer state of its own, which `lines` has. As a baseline, its base is today's tables
    // with that state added. Every cell of the added state differs from today's parser, which has no such state,
    // and against the base only the cells that hold something else than addStates put there.
    const addedStates = tables.lexerStateCount - today.lexerStateCount
    if (addedStates === 0) {
      check(tally.inAddedState === 0, `the hand rule ${rule} has today's states, and ${tally.inAddedState} code points are read in another one`)
      continue
    }
    const base = todaysTablesWithTheStatesOf(tables)
    const record = recordOf(tables, base)
    const changedHere = cellsThatDiffer(base, tables)
    const todaysCells = today.lexerNext.length
    let addedCellsAsInBase = 0
    for (let cell = todaysCells; cell < tables.lexerNext.length; cell++) if (tables.lexerNext[cell] === base.lexerNext[cell] && tables.lexerEvent[cell] === base.lexerEvent[cell]) addedCellsAsInBase++
    check(tally.inAddedState > 0 && record.structure.lexerStates === tables.lexerStateCount && changedHere > 1000 && record.cellsChangedAgainstBase.total === changedHere && record.cellsThatDifferFromToday.total === changedHere + addedCellsAsInBase,
      `the hand rule ${rule} has ${addedStates} tokenizer state of its own: ${tally.inAddedState} code points are read in it, and its record counts ${record.cellsChangedAgainstBase.total} cells changed against today's tables with that state and ${record.cellsThatDifferFromToday.total} that differ from today's parser, where a count made here finds ${changedHere} and ${changedHere + addedCellsAsInBase}`)
    console.log(`   The hand rule ${rule} has ${addedStates} tokenizer state of its own, so ${tables.lexerStateCount} in all: ${tally.inAddedState} code points are read in it. Its record counts ${record.cellsChangedAgainstBase.total} cells changed against today's tables with the same state added, as a count made here finds them, and ${record.cellsThatDifferFromToday.total} that differ from today's parser: ${addedCellsAsInBase} cells of the added state hold what addStates put there.`)
  }
  check(handRules.some(rule => handRuleTables(rule).lexerNext.length > today.lexerNext.length), 'no hand rule of the dataset has a tokenizer state of its own, so the check of such tables ran on none')
  const words = handRuleTables('words')
  check(throws(() => recoveryTablesOf({...words, lexerNext: words.lexerNext.slice(0, -1)})), 'recoveryTablesOf takes tables whose tokenizer table is no whole number of states')
  const handwrittenProblems = plainParserProblems(handwrittenTables().tables)
  check(handwrittenProblems.length === 1 && handwrittenProblems[0]!.includes('stack action'), `the hand-written tables: ${handwrittenProblems.join('; ')}`)
  check(plainParserProblems(asIsTables()).length === 0, 'today\'s tables are no tables of the plain table parser')
  check(plainParserProblems(addFirstOnLineBit(asIsTables())).some(problem => problem.includes('first on its line')) && plainParserProblems(addClasses(asIsTables(), classesOfTheChecks)).some(problem => problem.includes('added character class'))
    && plainParserProblems(addStates(asIsTables(), 2, [grammarStateNames.indexOf('colon')])).length === 0, 'plainParserProblems does not name the bit or the added classes, or names added states')
  const withDisplayChanged = openDisplayEntries(asIsTables())
  withDisplayChanged.display[withDisplayChanged.displayOpen.indexOf(1)] = 8
  check(plainParserProblems(withDisplayChanged).some(problem => problem.includes('display table')), 'plainParserProblems does not name a changed entry of the display table')
  console.log(`   Tables of the plain table parser: today's and the ${handRules.length} hand rules. Not: the hand-written tables (${handwrittenProblems[0]}), tables with the bit, with an added class, or with a changed entry of the display table.`)
}


// 2. The record.
const validation = validationOfTheStandardSet()
const sameRow = (left: ScoreRow, right: ScoreRow) => JSON.stringify(left) === JSON.stringify(right)
// Whether every row of the record is the row of scoreTables for `tables` on the validation split.
const rowsAreThoseOf = (record: ArmRecord, tables: RecoveryTables) => {
  const expected = scoreTables(tables, validation).rows
  return record.rows.length === expected.length && expected.every(row => sameRow(rowNamed(record, row.name), row))
}
// How the damage itself is shown, as a record holds it, from the counts of the row "all" of scoreTables: the share of
// the added code points that are shown as an error, the share of the samples that show an error, and the code
// points that are shown as past the end.
function damageShownBy(tables: RecoveryTables) {
  const all = scoreTables(tables, validation).rows[0]!
  return {addedShownAsError: all.addedShownAsError / all.addedCodePoints, samplesShowingError: all.samplesShowingError / all.samples, shownAsPastEnd: all.shownAsPastEnd}
}
function damageShownIn(record: ArmRecord) {
  return {addedShownAsError: record.addedShownAsError, samplesShowingError: record.samplesShowingError, shownAsPastEnd: record.shownAsPastEnd}
}
{
  const record = recordOf(asIsTables(), asIsTables())
  check(rowsAreThoseOf(record, asIsTables()), 'the rows of the record of today\'s tables are not the rows of scoreTables')
  check(groupNames.every(group => record.rows.some(row => row.name === `group: ${group}`)), 'the record lacks a row of one of the six groups')
  const kindRows = record.rows.filter(row => row.name.startsWith('kind: ')).length
  check(kindRows >= 45, `the record has ${kindRows} rows of kinds of damage`)
  check(record.cellsChangedAgainstBase.total === 0 && record.cellsThatDifferFromToday.total === 0 && record.groundRules.hold && record.groundRules.texts > 2000, `the record of today's tables: ${JSON.stringify(record.cellsChangedAgainstBase)}, ground rules ${JSON.stringify(record.groundRules)}`)
  check(record.wrongDepthsOnDeepValidJson.nothingAfter === 0 && record.wrongDepthsOnDeepValidJson.membersAfter === 0 && record.shownAsPastEnd === 0, 'today\'s tables have a wrong depth on valid JSON that is too deep, or show a code point as past the end')
  check(record.datasetKey === validation.datasetKey && record.datasetKey === datasetKey() && record.plainParserProblems.length === 0 && record.run === null, 'the record of today\'s tables has another dataset key, a problem with the plain table parser, or a run')
  const frozen = asIsTables()
  const cell = frozen.lexerOpen.indexOf(0)
  frozen.lexerEvent[cell] = (frozen.lexerEvent[cell]! + 1) % frozen.eventCount
  check(throws(() => recordOf(frozen, asIsTables())), 'tables with a changed frozen cell get a record')
  console.log(`2. The record of today's tables: ${record.rows.length} rows, among them the six groups and ${kindRows} kinds of damage, each as scoreTables gives it, no cell changed, the ground rules hold on ${record.groundRules.texts} fixed texts, and no wrong depth on valid JSON that is too deep. Tables with a changed frozen cell get no record.`)

  // Tables whose score is not their base's: the hand-written tables, with today's tables as the base.
  const handwritten = handwrittenTables().tables
  const ofHandwritten = recordOf(handwritten, asIsTables())
  const all = rowNamed(ofHandwritten, 'all')
  const changedHere = cellsThatDiffer(asIsTables(), handwritten)
  check(rowsAreThoseOf(ofHandwritten, handwritten), 'the rows of the record of the hand-written tables are not the rows of scoreTables for those tables')
  check(all.allRight !== rowNamed(record, 'all').allRight && all.allRight > 2 * rowNamed(record, 'all').allRight, 'the record of the hand-written tables has the score of today\'s tables')
  check(changedHere > 500 && ofHandwritten.cellsChangedAgainstBase.total === changedHere && ofHandwritten.cellsThatDifferFromToday.total === changedHere, `the record of the hand-written tables counts ${ofHandwritten.cellsChangedAgainstBase.total} cells changed against the base and ${ofHandwritten.cellsThatDifferFromToday.total} that differ from today's parser, and the tables differ from today's in ${changedHere} cells`)
  check(ofHandwritten.changedCellsReadByValidation > 0 && ofHandwritten.changedCellsReadByValidation < changedHere, `the record of the hand-written tables says that validation reads ${ofHandwritten.changedCellsReadByValidation} of the ${changedHere} changed cells`)
  check(ofHandwritten.plainParserProblems.some(problem => problem.includes('stack action')), 'the record of the hand-written tables does not say that they are no tables of the plain table parser')
  const withItselfAsBase = recordOf(handwritten, copyTables(handwritten))
  check(withItselfAsBase.cellsChangedAgainstBase.total === 0 && withItselfAsBase.cellsThatDifferFromToday.total === changedHere && sameRow(rowNamed(withItselfAsBase, 'all'), all), `with the hand-written tables as their own base, the record counts ${withItselfAsBase.cellsChangedAgainstBase.total} cells changed against the base and ${withItselfAsBase.cellsThatDifferFromToday.total} that differ from today's parser`)
  // The wrong depths on valid JSON that is too deep, for tables that have some.
  const randomTables = asIsTables()
  randomizeOpenCells(randomTables, createRandom(20261015, 33))
  const ofRandom = recordOf(randomTables, asIsTables())
  const deep = wrongDepthsOnDeepTexts(randomTables)
  check(deep.nothingAfter > 0 && deep.membersAfter > 0 && ofRandom.wrongDepthsOnDeepValidJson.nothingAfter === deep.nothingAfter && ofRandom.wrongDepthsOnDeepValidJson.membersAfter === deep.membersAfter,
    `the record of tables with random open cells says ${JSON.stringify(ofRandom.wrongDepthsOnDeepValidJson)} for the wrong depths on deep valid JSON, and check-deep.ts ${JSON.stringify(deep)}`)
  check(rowsAreThoseOf(ofRandom, randomTables) && ofRandom.cellsChangedAgainstBase.total === cellsThatDiffer(asIsTables(), randomTables), 'the record of tables with random open cells does not have their rows, or their changed cells')
  // How the damage is shown. The hand-written tables show no error and nothing as past the end, so their three
  // fields are 0, and a record that held one field in the place of another would still agree. Today's tables and
  // the random ones have other numbers in the fields, so for them it would not.
  const shownByHandwritten = damageShownBy(handwritten)
  const shownByRandom = damageShownBy(randomTables)
  const shownByToday = damageShownBy(asIsTables())
  check(JSON.stringify(damageShownIn(ofHandwritten)) === JSON.stringify(shownByHandwritten), `the record of the hand-written tables says ${JSON.stringify(damageShownIn(ofHandwritten))} for how the damage is shown, and the counts of scoreTables give ${JSON.stringify(shownByHandwritten)}`)
  check(JSON.stringify(damageShownIn(record)) === JSON.stringify(shownByToday) && JSON.stringify(damageShownIn(ofRandom)) === JSON.stringify(shownByRandom), `the records of today's tables and of tables with random open cells say ${JSON.stringify(damageShownIn(record))} and ${JSON.stringify(damageShownIn(ofRandom))} for how the damage is shown, and the counts of scoreTables give ${JSON.stringify(shownByToday)} and ${JSON.stringify(shownByRandom)}`)
  check(shownByToday.addedShownAsError > 0.5 && shownByToday.samplesShowingError > 0.5 && shownByToday.addedShownAsError !== shownByToday.samplesShowingError && new Set(Object.values(shownByRandom)).size === 3 && Object.values(shownByRandom).every(value => value > 0),
    `the check of how the damage is shown needs fields that are not 0 and differ from each other, and has ${JSON.stringify(shownByToday)} for today's tables and ${JSON.stringify(shownByRandom)} for tables with random open cells`)
  // A base that cannot be the tables that a run started from. Each is refused by the sentence of its reason: an
  // error from elsewhere, e.g. from differencesOf for a base with the bit, would not show that recordOf looked.
  const sameObjectError = await errorOf(() => recordOf(handwritten, handwritten))
  check(sameObjectError !== undefined && sameObjectError.includes('the same object as the tables and as their base'), `recordOf with the same object as the tables and as their base says ${JSON.stringify(sameObjectError)}`)
  const apostrophe = [{name: 'apostrophe', codePoints: [0x27]}]
  const otherLayouts: [name: string, tables: RecoveryTables, base: RecoveryTables][] = [
    ['two added tokenizer states and today\'s tables as the base', addStates(asIsTables(), 2, []), asIsTables()],
    ['an added class and today\'s tables as the base', addClasses(asIsTables(), apostrophe), asIsTables()],
    ['a class for the apostrophe and a base with a class for the backtick', addClasses(asIsTables(), apostrophe), addClasses(asIsTables(), [{name: 'backtick', codePoints: [0x60]}])],
    ['open entries of the display table and today\'s tables as the base', openDisplayEntries(asIsTables()), asIsTables()],
    ['today\'s tables and a base with the bit "first on its line"', asIsTables(), addFirstOnLineBit(asIsTables())],
  ]
  for (const [name, tables, base] of otherLayouts) {
    const layoutError = await errorOf(() => recordOf(tables, base))
    check(layoutError !== undefined && layoutError.includes('a base with other states, classes, contexts or open entries of the display table than the tables'), `recordOf for ${name} says ${JSON.stringify(layoutError)}`)
  }
  check(!throws(() => recordOf(addStates(asIsTables(), 2, []), addStates(asIsTables(), 2, []))) && !throws(() => recordOf(addClasses(asIsTables(), apostrophe), addClasses(asIsTables(), apostrophe))), 'recordOf refuses tables with added states or an added class and a base with the same ones')
  console.log(`   The record of the hand-written tables: every row as scoreTables gives it for those tables (all three ${(100 * sharesOf(all).allThree).toFixed(2)}%, today's tables ${(100 * sharesOf(rowNamed(record, 'all')).allThree).toFixed(2)}%), ${changedHere} cells changed against today's tables as a count made here finds them, and 0 changed with the hand-written tables as the base while ${withItselfAsBase.cellsThatDifferFromToday.total} differ from today's parser. Tables with random open cells have the wrong depths of check-deep.ts in their record, ${(100 * deep.nothingAfter).toFixed(1)}% and ${(100 * deep.membersAfter).toFixed(1)}%.`)
  const shownAsText = (shown: ReturnType<typeof damageShownBy>) => `${(100 * shown.addedShownAsError).toFixed(1)}% of the added code points as an error, an error in ${(100 * shown.samplesShowingError).toFixed(1)}% of the samples, ${shown.shownAsPastEnd} code points as past the end`
  console.log(`   How the damage is shown is in each record as the counts of scoreTables give it: ${shownAsText(shownByHandwritten)} for the hand-written tables, ${shownAsText(shownByToday)} for today's, and ${shownAsText(shownByRandom)} for tables with random open cells.`)
  console.log(`   recordOf refuses the tables as their own base, and a base of another layout, each with the sentence of its reason: ${otherLayouts.map(([name]) => name).join('; ')}.`)
}

// 3. The ground rules on the fixed texts, for random settings, and for a changed frozen cell.
{
  const random = createRandom(20261015, 31)
  const withStructure = addStates(addFirstOnLineBit(openDisplayEntries(addClasses(asIsTables(), classesOfTheChecks))), 2, [grammarStateNames.indexOf('colon')])
  let settings = 0
  let broken = 0
  for (const base of [asIsTables(), withStructure]) {
    for (let setting = 0; setting < 6; setting++) {
      const tables = copyTables(base)
      randomizeOpenCells(tables, random)
      settings++
      const groundRules = groundRulesOn(tables)
      if (!groundRules.hold) {
        broken++
        check(false, `the ground rules do not hold for a random setting: ${groundRules.problems[0]}`)
      }
    }
  }
  console.log(`3. ${settings} random settings of every open cell, half of them with added classes, open entries, the bit and added states: the ground rules hold on the fixed texts for ${settings - broken}.`)
  // One changed frozen cell: groundRulesOn does not call checkTables, so it has to find the change by the traces.
  let tried = 0
  let found = 0
  const frozenCells = (open: Uint8Array) => Array.from(open, (bit, cell) => bit === 0 ? cell : -1).filter(cell => cell !== -1)
  const today = asIsTables()
  for (const [at, cell] of frozenCells(today.lexerOpen).entries()) {
    if (at % 6 !== 0) continue
    const tables = asIsTables()
    tables.lexerNext[cell] = (tables.lexerNext[cell]! + 1) % tables.lexerStateCount
    tried++
    const groundRules = groundRulesOn(tables)
    if (!groundRules.hold && groundRules.problems.length > 0) found++
  }
  for (const [at, cell] of frozenCells(today.grammarOpen).entries()) {
    if (at % 6 !== 0) continue
    const tables = asIsTables()
    tables.grammarNext[cell] = (tables.grammarNext[cell]! + 1) % tables.grammarStateCount
    tried++
    const groundRules = groundRulesOn(tables)
    if (!groundRules.hold && groundRules.problems.length > 0) found++
  }
  check(tried >= 30 && found === tried, `groundRulesOn says "not hold" for ${found} of ${tried} tables with one changed frozen cell`)
  console.log(`   For ${found} of ${tried} tables with one changed frozen cell, every sixth frozen cell of each table, groundRulesOn says that the ground rules do not hold, with a sentence about the first difference.`)
}

// 4. The arithmetic of a report, on records made up with known numbers.
{
  const template = recordOf(asIsTables(), asIsTables())
  const recordWith = (share: number): ArmRecord => ({...template, rows: template.rows.map(row => row.name === 'all' ? {...row, codePoints: 100_000, allRight: Math.round(share * 100_000)} : row)})
  const setting = (name: string, shares: number[]): SettingResult => ({name, seeds: shares.map((_, index) => index + 1), records: shares.map(recordWith)})
  // A record with a known number in every field that describeSettings reads. `groups` are the shares of all three
  // in the six groups, in the dataset's order, from "out of reach" to "within reach of the tables".
  type KnownNumbers = {
    allThree: number, kind: number, depth: number, container: number, whole: number, groups: readonly number[], changedAgainstBase: number, differFromToday: number,
    addedShownAsError: number, shownAsPastEnd: number, wrongDepthsNothingAfter: number, wrongDepthsMembersAfter: number, groundRulesHold: boolean, plainParserProblems: string[],
  }
  const recordOfKnownNumbers = (known: KnownNumbers): ArmRecord => ({
    ...template,
    rows: template.rows.map(row => {
      if (row.name === 'all') {
        return {
          ...row, samples: 1000, nothingToRecover: 0, wholeSamples: Math.round(known.whole * 1000), codePoints: 100_000, allRight: Math.round(known.allThree * 100_000),
          kindScored: 100_000, kindRight: Math.round(known.kind * 100_000), nestingScored: 100_000, depthRight: Math.round(known.depth * 100_000), containerRight: Math.round(known.container * 100_000),
        }
      }
      const group = groupNames.findIndex(name => row.name === `group: ${name}`)
      return group === -1 ? row : {...row, codePoints: 10_000, allRight: Math.round(known.groups[group]! * 10_000)}
    }),
    cellsChangedAgainstBase: {...template.cellsChangedAgainstBase, total: known.changedAgainstBase}, cellsThatDifferFromToday: {...template.cellsThatDifferFromToday, total: known.differFromToday},
    addedShownAsError: known.addedShownAsError, shownAsPastEnd: known.shownAsPastEnd, wrongDepthsOnDeepValidJson: {nothingAfter: known.wrongDepthsNothingAfter, membersAfter: known.wrongDepthsMembersAfter},
    groundRules: {...template.groundRules, hold: known.groundRulesHold}, plainParserProblems: known.plainParserProblems,
  })
  const otherAction = '7 grammar cells hold a stack action that does something else than their token does'
  const everyField: SettingResult = {
    name: 'every field', seeds: [1, 2, 3], records: [
      {allThree: 0.92, kind: 0.95, depth: 0.97, container: 0.99, whole: 0.60, groups: [0.50, 0.55, 0.60, 0.65, 0.70, 0.975], changedAgainstBase: 100, differFromToday: 110,
        addedShownAsError: 0.10, shownAsPastEnd: 3, wrongDepthsNothingAfter: 0.20, wrongDepthsMembersAfter: 0.30, groundRulesHold: true, plainParserProblems: []},
      {allThree: 0.90, kind: 0.94, depth: 0.96, container: 0.985, whole: 0.58, groups: [0.52, 0.57, 0.62, 0.67, 0.72, 0.965], changedAgainstBase: 104, differFromToday: 118,
        addedShownAsError: 0.12, shownAsPastEnd: 0, wrongDepthsNothingAfter: 0.25, wrongDepthsMembersAfter: 0.35, groundRulesHold: true, plainParserProblems: [otherAction]},
      {allThree: 0.91, kind: 0.93, depth: 0.98, container: 0.98, whole: 0.62, groups: [0.51, 0.59, 0.61, 0.69, 0.71, 0.97], changedAgainstBase: 102, differFromToday: 111,
        addedShownAsError: 0.14, shownAsPastEnd: 6, wrongDepthsNothingAfter: 0.21, wrongDepthsMembersAfter: 0.31, groundRulesHold: false, plainParserProblems: [otherAction]},
    ].map(recordOfKnownNumbers),
  }
  // The row of the setting in each of the three tables, worked out by hand from the numbers above: per column the
  // mean of the three seeds, and in brackets the lowest and the highest. The table per group starts with the group
  // within reach of the tables, so its columns are the groups above from the last to the first.
  const rowsOfEveryField = [
    '| every field | 3 | 91.00 (90.00 to 92.00) | 94.00 (93.00 to 95.00) | 97.00 (96.00 to 98.00) | 98.50 (98.00 to 99.00) | 60.00 (58.00 to 62.00) | 102 (100 to 104) | 113 (110 to 118) |',
    '| every field | 97.0 (96.5 to 97.5) | 71.0 (70.0 to 72.0) | 67.0 (65.0 to 69.0) | 61.0 (60.0 to 62.0) | 57.0 (55.0 to 59.0) | 51.0 (50.0 to 52.0) |',
    '| every field | 12.0 (10.0 to 14.0) | 3 (0 to 6) | 22.0 (20.0 to 25.0) | 32.0 (30.0 to 35.0) | hold for 2 of 3 seeds | yes for 1 of 3 seeds |',
  ]
  const spread = spreadOf([0.92, 0.90, 0.91])
  check(Math.abs(spread.mean - 0.91) < 1e-12 && spread.lowest === 0.90 && spread.highest === 0.92 && spread.count === 3, `spreadOf of 0.92, 0.90, 0.91 is ${JSON.stringify(spread)}`)
  check(percentSpread(spread) === '91.00 (90.00 to 92.00)' && percentSpread(spreadOf([0.5])) === '50.00' && percentSpread(spreadOf([0.125, 0.455]), 1) === '29.0 (12.5 to 45.5)', `percentSpread gives ${percentSpread(spread)}, ${percentSpread(spreadOf([0.5]))} and ${percentSpread(spreadOf([0.125, 0.455]), 1)}`)
  const low = setting('low', [0.92, 0.90, 0.91])
  const high = setting('high', [0.93, 0.95, 0.94])
  const reaching = setting('reaching', [0.90, 0.91, 0.935])
  const apart = describeComparison(low, high)
  const overlapping = describeComparison(reaching, high)
  check(apart.includes('"low" has 91.00 (90.00 to 92.00) over 3 seeds') && apart.includes('"high" has 94.00 (93.00 to 95.00) over 3 seeds') && apart.includes('differ by -3.00 points') && apart.includes('do not overlap') && !apart.includes('ranges overlap'),
    `the comparison of 90 to 92 with 93 to 95 is ${JSON.stringify(apart)}`)
  check(describeComparison(high, low).includes('differ by +3.00 points') && describeComparison(high, low).includes('do not overlap'), `the comparison of 93 to 95 with 90 to 92 is ${JSON.stringify(describeComparison(high, low))}`)
  check(overlapping.includes('"reaching" has 91.50 (90.00 to 93.50) over 3 seeds') && overlapping.includes('ranges overlap, so these seeds do not tell the two settings apart') && !overlapping.includes('do not overlap'), `the comparison of 90 to 93.5 with 93 to 95 is ${JSON.stringify(overlapping)}`)
  check(throws(() => describeComparison(setting('two seeds', [0.9, 0.91]), high)) && throws(() => describeComparison(high, setting('one seed', [0.9]))), 'a comparison with 1 or 2 seeds does not throw')
  const baseline: SettingResult = {name: 'a baseline', seeds: [], records: [recordWith(0.925)]}
  const withBaseline = describeComparison(low, baseline)
  check(withBaseline.includes('"a baseline" has 92.50 and no seed') && withBaseline.includes('do not overlap') && describeComparison(reaching, baseline).includes('ranges overlap'), `the comparison with a baseline is ${JSON.stringify(withBaseline)}`)
  const sameTables: SettingResult = {...setting('ignores its seed', [0.9, 0.9, 0.9]), everySeedGaveTheSameTables: true}
  check(describeComparison(sameTables, high).includes('which all gave the same tables, so this is one run and no spread'), `the comparison of a setting whose seeds gave the same tables is ${JSON.stringify(describeComparison(sameTables, high))}`)
  // A comparison on another row than "all". In the group within reach of the tables the setting above has 96.5 to
  // 97.5 and the record below 99, so the ranges do not overlap there, and on all samples they do: 90 to 92 and 91.5.
  const oneRecord: SettingResult = {
    name: 'one record', seeds: [], records: [recordOfKnownNumbers({
      allThree: 0.915, kind: 0.96, depth: 0.975, container: 0.995, whole: 0.70, groups: [0.40, 0.45, 0.55, 0.65, 0.75, 0.99], changedAgainstBase: 50, differFromToday: 60,
      addedShownAsError: 0.05, shownAsPastEnd: 2, wrongDepthsNothingAfter: 0.10, wrongDepthsMembersAfter: 0.15, groundRulesHold: false, plainParserProblems: [otherAction],
    })],
  }
  const rowsOfOneRecord = [
    '| one record | none | 91.50 | 96.00 | 97.50 | 99.50 | 70.00 | 50 | 60 |',
    '| one record | 99.0 | 75.0 | 65.0 | 55.0 | 45.0 | 40.0 |',
    `| one record | 5.0 | 2 | 10.0 | 15.0 | BROKEN | no: ${otherAction} |`,
  ]
  const withinReach = describeComparison(everyField, oneRecord, 'group: within reach of the tables')
  const onAll = describeComparison(everyField, oneRecord)
  check(withinReach.startsWith('All three, group: within reach of the tables: "every field" has 97.00 (96.50 to 97.50) over 3 seeds, "one record" has 99.00 and no seed.') && withinReach.includes('differ by -2.00 points') && withinReach.includes('do not overlap'),
    `the comparison on the row of the group within reach of the tables is ${JSON.stringify(withinReach)}`)
  check(onAll.startsWith('All three, all validation samples: "every field" has 91.00 (90.00 to 92.00) over 3 seeds, "one record" has 91.50 and no seed.') && onAll.includes('differ by -0.50 points') && onAll.includes('ranges overlap') && onAll === describeComparison(everyField, oneRecord, 'all'),
    `the comparison of the same two settings on all samples is ${JSON.stringify(onAll)}`)
  check(throws(() => describeComparison(everyField, oneRecord, 'group: no such group')), 'a comparison on a row that the records do not have does not throw')
  // The tables of describeSettings: every cell of the rows worked out above, and the group "within reach of the
  // tables" first.
  const described = describeSettings([low, baseline, sameTables, everyField, oneRecord])
  const describedLines = described.split('\n')
  const missingRows = [...rowsOfEveryField, ...rowsOfOneRecord].filter(row => !describedLines.includes(row))
  check(missingRows.length === 0, `describeSettings does not give these rows, which follow from the numbers of the made-up records: ${missingRows.join('   ')}. It gives: ${describedLines.filter(line => line.startsWith('| every field |') || line.startsWith('| one record |')).join('   ')}`)
  check(described.includes('| low | 3 | 91.00 (90.00 to 92.00) |') && described.includes('| a baseline | none | 92.50 |') && described.includes('| ignores its seed | 3, which all gave the same tables | 90.00 (90.00 to 90.00) |') && described.includes('The 3 seeds of "ignores its seed" gave the same tables'),
    'describeSettings does not give the rows of made-up settings with their mean, lowest and highest')
  const groupHeader = describedLines.find(line => line.startsWith('| setting | ') && line.includes('within reach of the tables'))
  check(groupHeader !== undefined && groupHeader.startsWith('| setting | within reach of the tables, ') && groupHeader.trimEnd().endsWith(`out of reach, ${rowNamed(template, 'group: out of reach').samples} |`), `the table per group does not start with the group within reach of the tables: ${groupHeader}`)
  console.log('4. spreadOf, percentSpread, describeComparison and describeSettings on records made up with known numbers: 0.92, 0.90, 0.91 is "91.00 (90.00 to 92.00)", against 0.93 to 0.95 the means differ by -3.00 points and the ranges do not overlap, 0.90 to 0.935 overlaps with it, 1 or 2 seeds throw, a baseline has no seed, and a setting whose seeds gave the same tables is named as one run. The table per group starts with the group within reach of the tables.')
  console.log(`   Every cell of a setting's row in the three tables of describeSettings is the text that follows from the numbers of its records, for a setting of 3 seeds and for a setting without a seed, e.g. ${rowsOfEveryField[2]}`)
  console.log(`   describeComparison on the row of a group: ${withinReach}`)
}

// 5. runArm with toy build functions.
{
  const armName = 'check-of-the-harness'
  const rules = baselineTables().slice(1, 1 + handRules.length)
  const ruleOfSeed = (seed: number) => rules[(seed - 1) % rules.length]!
  // A build that changes one open grammar cell, the same one for every seed.
  const oneCell = () => {
    const tables = asIsTables()
    tables.grammarNext[tables.grammarOpen.indexOf(1)] = grammarStateNames.indexOf('colon')
    return {tables, base: asIsTables()}
  }
  // A build whose seeds 1 and 2 give the tables of oneCell and whose seed 3 gives other ones: its seeds did not all
  // give the same tables, though its first two did.
  const anotherCellForTheThirdSeed = (seed: number) => {
    const built = oneCell()
    if (seed === 3) built.tables.grammarNext[built.tables.grammarOpen.indexOf(1)] = grammarStateNames.indexOf('value')
    return built
  }
  const lines: string[] = []
  const settings = [
    {name: 'a hand rule per seed', build: (seed: number) => ({tables: ruleOfSeed(seed).tables, base: ruleOfSeed(seed).base})},
    {name: 'without a seed', withoutSeed: true as const, build: () => ({tables: handwrittenTables().tables, base: asIsTables()})},
    {name: 'ignores its seed', build: oneCell},
    {name: 'the third seed differs', build: anotherCellForTheThirdSeed},
  ]
  const seeds = [1, 2, 3]
  const results = await runArm({name: armName, seeds, log: line => lines.push(line), settings})
  const folder = armFolderOf(armName)
  let saved = 0
  let files = 0
  for (const result of results) {
    const runs = result.seeds.length === 0 ? [{seed: null, fileName: 'no-seed'}] : result.seeds.map(seed => ({seed, fileName: `seed-${seed}`}))
    for (const [at, {seed, fileName}] of runs.entries()) {
      const tablesFile = join(folder, fileNameOf(result.name), `${fileName}.tables.json`)
      const recordFile = join(folder, fileNameOf(result.name), `${fileName}.record.json`)
      files++
      if (!existsSync(tablesFile) || !existsSync(recordFile)) continue
      const record = JSON.parse(readFileSync(recordFile, 'utf8')) as ArmRecord
      const loaded = loadTables(tablesFile)
      const base = result.name === 'a hand rule per seed' ? ruleOfSeed(seed!).base : asIsTables()
      const again = recordOf(loaded.tables, base, {arm: armName, setting: result.name, seed})
      // The saved record is the record of the saved tables, with the run's names. A share with nothing to divide by is NaN, which JSON writes as null.
      if (JSON.stringify(record) === JSON.stringify(again) && JSON.stringify(record) === JSON.stringify(result.records[at]) && loaded.datasetKey === datasetKey() && record.run?.arm === armName && record.run.setting === result.name && record.run.seed === seed) saved++
    }
  }
  check(results.length === 4 && results[0]!.records.length === 3 && results[1]!.records.length === 1 && results[1]!.seeds.length === 0 && results[2]!.records.length === 3 && results[3]!.records.length === 3 && files === 10 && saved === 10, `runArm returned ${results.length} settings and saved ${saved} of ${files} tables with their records`)
  // Every seed has its own tables: the record of seed s is the score of the hand rule that seed s picks.
  const sharesOfSeeds = seeds.map(seed => sharesOf(scoreTables(ruleOfSeed(seed).tables, validation).rows[0]!).allThree)
  const recordedShares = results[0]!.records.map(record => sharesOf(rowNamed(record, 'all')).allThree)
  check(new Set(sharesOfSeeds).size === 3 && recordedShares.every((share, at) => share === sharesOfSeeds[at]) && results[0]!.records.every((record, at) => rowsAreThoseOf(record, ruleOfSeed(seeds[at]!).tables)), `the records of the seeds 1, 2, 3 have ${recordedShares.join(', ')}, and the hand rules that the seeds pick have ${sharesOfSeeds.join(', ')}`)
  check(results[0]!.everySeedGaveTheSameTables !== true && results[1]!.everySeedGaveTheSameTables !== true && results[2]!.everySeedGaveTheSameTables === true, 'runArm does not name the build that ignores its seed, or names another one')
  // The first two seeds of the last setting gave the same tables and the third gave others, so its seeds count.
  const tablesOfTheLastSetting = seeds.map(seed => tablesToJson(anotherCellForTheThirdSeed(seed).tables))
  check(tablesOfTheLastSetting[0] === tablesOfTheLastSetting[1] && tablesOfTheLastSetting[1] !== tablesOfTheLastSetting[2] && results[3]!.everySeedGaveTheSameTables !== true,
    'runArm says that every seed of the setting "the third seed differs" gave the same tables, or the toy build does not give the seeds 1 and 2 the same tables and the seed 3 other ones')
  // The summary's row, from the mean, the lowest and the highest worked out here.
  const percent = (share: number) => (100 * share).toFixed(2)
  const expectedRow = `| a hand rule per seed | 3 | ${percent(sharesOfSeeds.reduce((total, share) => total + share, 0) / 3)} (${percent(Math.min(...sharesOfSeeds))} to ${percent(Math.max(...sharesOfSeeds))}) |`
  const summary = readFileSync(join(folder, 'summary.md'), 'utf8')
  check(summary.includes(expectedRow), `summary.md has no row that starts with ${JSON.stringify(expectedRow)}`)
  check(summary.includes('| without a seed | none |') && summary.includes('| ignores its seed | 3, which all gave the same tables |') && summary.includes('The 3 seeds of "ignores its seed" gave the same tables') && summary.includes('Only 3 seeds')
    && summary.includes('| the third seed differs | 3 |') && !summary.includes('The 3 seeds of "the third seed differs"')
    && summary === `${describeSettings(results)}\n\nOnly 3 seeds: a try-out, not a number to report.\n`, 'summary.md is not the tables of describeSettings with a row per setting')
  check(lines.join('\n').includes(expectedRow) && lines.some(line => line.startsWith('The 3 seeds of "ignores its seed" gave the same tables')), 'runArm did not print the summary, or the line about the build that ignores its seed')
  const comparison = describeComparison(results[0]!, results[1]!)
  check(comparison.includes('over 3 seeds') && comparison.includes('"without a seed" has') && comparison.includes('and no seed'), `the comparison is ${JSON.stringify(comparison)}`)
  // savedResultOf reads each setting back from the files, as the result that runArm returned: the same name, seeds
  // and records, and the same word on a build that ignores its seed. So a report made from the files is the report
  // of the run.
  const readBack = results.map(result => savedResultOf(armName, result.name))
  check(readBack.every((result, at) => JSON.stringify(result) === JSON.stringify(results[at])) && readBack[2]!.everySeedGaveTheSameTables === true && readBack[3]!.everySeedGaveTheSameTables !== true
    && describeSettings(readBack) === describeSettings(results) && describeComparison(readBack[0]!, readBack[1]!) === comparison,
    'savedResultOf does not give the results that runArm returned for the four settings, or a report made from them is not the report of the run')
  // What savedResultOf refuses: a setting that was never run, a record of another dataset, and a record that
  // another run saved. A record names its run by the arm, the setting and the seed, so three records of another run
  // are tried, each with one of the three wrong and the other two right: the record of the setting without a seed
  // under another setting's name, the same record with another arm in it, and the record of seed 1 under the file
  // name of seed 2.
  const recordText = readFileSync(join(folder, fileNameOf('without a seed'), 'no-seed.record.json'), 'utf8')
  const recordTextOfSeed1 = readFileSync(join(folder, fileNameOf('a hand rule per seed'), 'seed-1.record.json'), 'utf8')
  const keyLine = ` "datasetKey": ${JSON.stringify(datasetKey())},\n`
  const withRun = (text: string, run: ArmRecord['run']) => `${JSON.stringify({...(JSON.parse(text) as ArmRecord), run}, null, 1)}\n`
  const recordsOfAnotherRun = [
    {settingName: 'a record of another setting', fileName: 'no-seed', text: recordText},
    {settingName: 'a record of another arm', fileName: 'no-seed', text: withRun(recordText, {arm: 'another-arm', setting: 'a record of another arm', seed: null})},
    {settingName: 'a record of another seed', fileName: 'seed-2', text: withRun(recordTextOfSeed1, {arm: armName, setting: 'a record of another seed', seed: 1})},
  ]
  const recordOfAnotherDataset = {settingName: 'a record of another dataset', fileName: 'no-seed', text: withRun(recordText.replace(keyLine, ' "datasetKey": "0123456789abcdef",\n'), {arm: armName, setting: 'a record of another dataset', seed: null})}
  for (const {settingName, fileName, text} of [recordOfAnotherDataset, ...recordsOfAnotherRun]) {
    mkdirSync(join(folder, fileNameOf(settingName)), {recursive: true})
    writeFileSync(join(folder, fileNameOf(settingName), `${fileName}.record.json`), text)
  }
  const neverRunError = await errorOf(() => savedResultOf(armName, 'a setting that was never run'))
  const otherDatasetError = await errorOf(() => savedResultOf(armName, 'a record of another dataset'))
  const otherRunErrors = await Promise.all(recordsOfAnotherRun.map(({settingName}) => errorOf(() => savedResultOf(armName, settingName))))
  // withRun changes the run of a record and nothing else: with the record's own run it gives the record's text.
  check(recordText.includes(keyLine) && withRun(recordText, (JSON.parse(recordText) as ArmRecord).run) === recordText && neverRunError !== undefined && neverRunError.includes('holds no record')
    && otherDatasetError !== undefined && otherDatasetError.includes('was saved with the dataset 0123456789abcdef') && otherRunErrors.every(error => error !== undefined && error.includes('holds the record of the run')),
    `savedResultOf says ${JSON.stringify(neverRunError)} for a setting that was never run, ${JSON.stringify(otherDatasetError)} for a record of another dataset, and for a record of another setting, of another arm and of another seed: ${JSON.stringify(otherRunErrors)}`)
  // Lists of seeds that cannot be meant: runArm throws before it builds anything.
  let built = 0
  const counting = [{name: 'never built', build: () => { built++; return oneCell() }}]
  const emptyError = await errorOf(() => runArm({name: armName, seeds: [], log: () => {}, settings: counting}))
  const twiceError = await errorOf(() => runArm({name: armName, seeds: [1, 2, 1], log: () => {}, settings: counting}))
  const fractionError = await errorOf(() => runArm({name: armName, seeds: [1, 2.5], log: () => {}, settings: counting}))
  check(emptyError !== undefined && emptyError.includes('empty list of seeds') && twiceError !== undefined && twiceError.includes('twice') && fractionError !== undefined && fractionError.includes('a seed is a whole number') && built === 0,
    `runArm with no seed says ${JSON.stringify(emptyError)}, with a seed named twice ${JSON.stringify(twiceError)}, with the seed 2.5 ${JSON.stringify(fractionError)}, and built ${built} times`)
  // A rerun with fewer seeds: the files of the earlier run are moved away, and the folder holds this run's files.
  // savedResultOf then gives the rerun, with its seeds in the order of their numbers, 2 before 11.
  const rerun = await runArm({name: armName, seeds: [11, 2], log: () => {}, settings: [settings[0]!]})
  const settingFolder = join(folder, fileNameOf('a hand rule per seed'))
  const left = readdirSync(settingFolder).filter(name => name.endsWith('.json')).sort()
  const earlier = readdirSync(settingFolder).filter(name => name.startsWith('earlier-')).sort().at(-1)
  check(left.join(',') === 'seed-11.record.json,seed-11.tables.json,seed-2.record.json,seed-2.tables.json' && earlier !== undefined && readdirSync(join(settingFolder, earlier)).filter(name => name.endsWith('.json')).length === 6, `after a rerun with two seeds the setting's folder holds ${left.join(', ')}, and its last folder of earlier files is ${earlier}`)
  const rerunReadBack = savedResultOf(armName, 'a hand rule per seed')
  check(rerunReadBack.seeds.join(',') === '2,11' && JSON.stringify(rerunReadBack.records) === JSON.stringify([rerun[0]!.records[1], rerun[0]!.records[0]]) && rerunReadBack.everySeedGaveTheSameTables !== true,
    `after the rerun with the seeds 11 and 2, savedResultOf gives the seeds ${rerunReadBack.seeds.join(', ')}, or not the records of the rerun`)
  const baselineNames = baselineTables().map(baseline => baseline.name)
  // The parser as it is, one row per hand rule of the dataset, and the hand-written rules.
  check(baselineNames.length === handRules.length + 2 && baselineTables().every(({tables}) => tablesToJson(tables).length > 0), `the baselines are ${baselineNames.join(', ')}`)
  // What a build function trains on is the train split only.
  const trainData = trainDataFor(asIsTables())
  const trainPart = trainPartOfTheStandardSet()
  check(trainData.sampleCount > 30_000 && trainData.split.every(split => split === 0) && trainPart.sampleCount > trainData.sampleCount && trainPart.split.every(split => split === 0), 'trainDataFor or trainPartOfTheStandardSet holds a sample that is not of the train split')
  console.log(`5. runArm with 4 settings and 3 seeds saved 10 tables, each with the record that recordOf gives for the saved tables and with the arm, the setting and the seed in it. The seeds 1, 2, 3 of the first setting have the scores of the hand rules that they pick (${sharesOfSeeds.map(percent).join(', ')}), and the summary's row is ${expectedRow.slice(2, -2)}. The setting without a seed is built once. The build that ignores its seed is named in the summary, and the build whose third seed gives other tables than its first two is not. No seed, a seed named twice and the seed 2.5 throw before anything is built. A rerun with the seeds 11 and 2 moves the 6 earlier files into ${earlier}.`)
  console.log(`   savedResultOf reads each of the 4 settings back as the result that runArm returned, so describeSettings and describeComparison give the same text for both, and after the rerun it gives the seeds 2 and 11. It refuses a setting that was never run, a record of another dataset, and a record of another run: of another setting, of another arm, and of seed 1 under the file name of seed 2.`)
  console.log(`   The baselines: ${baselineNames.join('; ')}. trainDataFor packs ${trainData.sampleCount} samples, all of the train split.`)
}

// 6. arms/final.ts, without a test sample.
{
  // The validation samples as a set "with the test split", with held-out bits made up from the place: of every 10
  // samples, 4 have nothing held out, 1 a kind, 3 the template and 2 both, so that the four rows have other counts.
  // The split stays the validation split, and no sample of the test split is loaded.
  const both = heldOutByKind | heldOutByTemplate
  const bits = [0, 0, 0, 0, heldOutByKind, heldOutByTemplate, heldOutByTemplate, heldOutByTemplate, both, both]
  const relabeled: Samples = {...validation, withTest: true, heldOut: validation.heldOut.map((_, place) => bits[place % 10]!)}
  // The broken samples per row, counted here, in the order of heldOutRowNames: nothing, a kind, the template, both.
  const brokenWith = [0, heldOutByKind, heldOutByTemplate, both].map(wanted => relabeled.heldOut.reduce((total, held, place) => total + Number(held === wanted && validation.firstDamage[place] !== -1), 0))
  const named = [{name: 'random open cells', tables: (() => { const tables = asIsTables(); randomizeOpenCells(tables, createRandom(20261015, 34)); return tables })()}]
  const lines = describeFinal(relabeled, named, 'validation')
  const tablesNames = [...baselineTables().map(baseline => baseline.name), 'random open cells']
  let wrongTables = 0
  for (const name of tablesNames) {
    const rows = lines.filter(line => line.startsWith(`| ${name} | `)).map(line => line.split(' | '))
    const expected = scoreTables(name === 'random open cells' ? named[0]!.tables : baselineTables().find(baseline => baseline.name === name)!.tables, validation).rows[0]!
    const numbers = (row: string[]) => ({samples: Number(row[2]), codePoints: Number(row[3])})
    const heldOutRows = rows.slice(0, 4).map(numbers)
    const whole = rows[4] === undefined ? undefined : numbers(rows[4])
    const ok = rows.length === 5 && heldOutRowNames.every((rowName, at) => rows[at]![1] === rowName) && whole !== undefined && rows[4]![1]!.startsWith('the whole validation split')
      && heldOutRows.reduce((total, row) => total + row.samples, 0) === whole.samples && heldOutRows.reduce((total, row) => total + row.codePoints, 0) === whole.codePoints
      && heldOutRows.every((row, at) => row.samples === brokenWith[at]) && new Set(brokenWith).size === 4 && whole.samples === expected.samples && whole.codePoints === expected.codePoints && rows[4]![4] === (100 * sharesOf(expected).allThree).toFixed(2)
    if (!ok) wrongTables++
  }
  check(lines.length === 2 + 5 * tablesNames.length && wrongTables === 0, `the report of arms/final.ts on relabeled validation samples has ${lines.length} lines, and the rows of ${wrongTables} tables do not hold the samples with their held-out bits (${brokenWith.join(', ')}), or do not add up to the validation row of scoreTables`)
  // Without RECOVERY_FINAL the report of the test split is refused, also for a set that says it holds the test split.
  const refusal = await errorOf(() => describeFinal(relabeled, named))
  check(refusal !== undefined && refusal.includes('RECOVERY_FINAL'), `describeFinal of the test split without RECOVERY_FINAL says ${JSON.stringify(refusal)}`)

  // The tables of a final run have to be of this dataset.
  const scratch = process.env['RECOVERY_SCRATCH']
  if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to a folder outside the repo')
  const finalFolder = join(scratch, 'arms', 'check-of-final')
  mkdirSync(finalFolder, {recursive: true})
  const ofThisDataset = join(finalFolder, 'this-dataset.json')
  const ofAnother = join(finalFolder, 'another-dataset.json')
  const withoutKey = join(finalFolder, 'without-a-key.json')
  saveTables(ofThisDataset, named[0]!.tables, 'check.ts')
  const text = readFileSync(ofThisDataset, 'utf8')
  const keyLine = `  "datasetKey": ${JSON.stringify(datasetKey())},\n`
  check(text.includes(keyLine), 'a saved file of tables does not hold the dataset\'s key')
  writeFileSync(ofAnother, text.replace(keyLine, '  "datasetKey": "0123456789abcdef",\n'))
  writeFileSync(withoutKey, text.replace(keyLine, ''))
  const accepted = namedTablesOf([`mine=${ofThisDataset}`])
  const anotherError = await errorOf(() => namedTablesOf([`mine=${ofThisDataset}`, `other=${ofAnother}`]))
  const withoutError = await errorOf(() => namedTablesOf([`old=${withoutKey}`]))
  check(accepted.length === 1 && accepted[0]!.name === 'mine' && accepted[0]!.file === ofThisDataset && accepted[0]!.hash === Bun.hash(readFileSync(ofThisDataset)).toString(16) && tablesToJson(accepted[0]!.tables) === tablesToJson(named[0]!.tables), 'namedTablesOf does not give the tables of a file of this dataset with its name, path and hash')
  check(anotherError !== undefined && anotherError.includes('0123456789abcdef') && withoutError !== undefined && withoutError.includes('no dataset key'), `namedTablesOf says ${JSON.stringify(anotherError)} for a file of another dataset and ${JSON.stringify(withoutError)} for a file without a key`)
  check(throws(() => namedTablesOf(['no-equals-sign'])) && throws(() => namedTablesOf([`=${ofThisDataset}`])), 'namedTablesOf takes an argument that is no <name>=<file>')
  check(throws(() => loadTablesOfThisDataset(ofAnother)) && throws(() => loadTablesOfThisDataset(withoutKey)) && !throws(() => loadTablesOfThisDataset(ofThisDataset)), 'loadTablesOfThisDataset does not refuse exactly the files of another dataset')
  // A command that only reports loads such a file, and says so.
  const notes: string[] = []
  loadTablesForReport(ofAnother, line => notes.push(line))
  loadTablesForReport(withoutKey, line => notes.push(line))
  loadTablesForReport(ofThisDataset, line => notes.push(line))
  check(notes.length === 2 && notes.every(note => note.startsWith('Note: ')) && otherDatasetOf(ofThisDataset, loadTables(ofThisDataset)) === undefined, `loadTablesForReport gives the notes ${JSON.stringify(notes)}`)
  const logLine = JSON.parse(logLineOf(new Date(Date.UTC(2026, 9, 15, 12, 0, 0)), datasetKey(), accepted)) as {time: string, datasetKey: string, tables: {name: string, file: string, hash: string}[]}
  check(logLine.time === '2026-10-15T12:00:00.000Z' && logLine.datasetKey === datasetKey() && logLine.tables.length === 1 && logLine.tables[0]!.name === 'mine' && logLine.tables[0]!.hash === accepted[0]!.hash, `the log line of a final run is ${JSON.stringify(logLine)}`)
  console.log(`6. arms/final.ts on the ${validation.sampleCount} validation samples with made-up held-out bits: ${tablesNames.length} tables with four rows each, which hold the ${brokenWith.join(', ')} broken samples of the four ways to be held out and add up to the row of the whole split, which is the validation row of scoreTables. Without RECOVERY_FINAL the report of the test split is refused. A file of tables holds the dataset's key ${datasetKey()}: a file with another key or without one is refused for a final run, and a command that only reports loads it with a note.`)
}

// 7. The number to beat, read from scratch folders that the check makes: one per file that numberToBeat can find.
{
  const folder = armFolderOf('check-of-the-number-to-beat')
  const scratchWith = (what: string) => join(folder, fileNameOf(what))
  // Tables that a search from the hand-written tables could end with: the hand-written tables with one more cell
  // changed, an open grammar cell that still leads into the state `error`.
  const handwritten = handwrittenTables().tables
  const found = copyTables(handwritten)
  const changedCell = found.grammarOpen.findIndex((open, cell) => open === 1 && found.grammarNext[cell] === found.errorState)
  found.grammarNext[changedCell] = grammarStateNames.indexOf('value')
  const text = tablesToJson(found, 'check.ts')
  const keyLine = `  "datasetKey": ${JSON.stringify(datasetKey())},\n`
  for (const [what, fileText] of [['a file of this dataset', text], ['a file of another dataset', text.replace(keyLine, '  "datasetKey": "0123456789abcdef",\n')], ['a file without a dataset key', text.replace(keyLine, '')]] as const) {
    mkdirSync(join(scratchWith(what), 'search'), {recursive: true})
    writeFileSync(numberToBeatFileOf(scratchWith(what)), fileText)
  }
  // The file is the one that the READMEs and the search's command name. Every file above is written through
  // numberToBeatFileOf, so without this line another file name would pass, e.g. the search from today's tables.
  check(numberToBeatFileOf(folder) === join(folder, 'search', 'search-from-handwritten.json'), `numberToBeat reads ${numberToBeatFileOf(folder)}, and the file of the search from the hand-written tables is ${join(folder, 'search', 'search-from-handwritten.json')}`)
  const toBeat = numberToBeat(scratchWith('a file of this dataset'))
  const record = toBeat.records[0]!
  check(toBeat.name === 'search from the hand-written tables' && toBeat.seeds.length === 0 && toBeat.records.length === 1 && rowsAreThoseOf(record, found) && record.run === null && record.datasetKey === datasetKey(),
    'numberToBeat does not give the tables of the file as one setting without a seed, with the rows of scoreTables for those tables')
  check(changedCell !== -1 && record.cellsChangedAgainstBase.total === 1 && record.cellsThatDifferFromToday.total === cellsThatDiffer(asIsTables(), found),
    `the record of the number to beat counts ${record.cellsChangedAgainstBase.total} cells changed against the base, where the tables differ from the hand-written ones in 1 cell, and ${record.cellsThatDifferFromToday.total} that differ from today's parser, where a count made here finds ${cellsThatDiffer(asIsTables(), found)}`)
  check(describeSettings([toBeat]).includes('| search from the hand-written tables | none |'), 'describeSettings does not take the number to beat as a setting without a seed')
  const missingError = await errorOf(() => numberToBeat(scratchWith('no file')))
  const otherDatasetError = await errorOf(() => numberToBeat(scratchWith('a file of another dataset')))
  const withoutKeyError = await errorOf(() => numberToBeat(scratchWith('a file without a dataset key')))
  const noScratchError = await errorOf(() => numberToBeat(''))
  const saysHowToMake = (error: string | undefined) => error !== undefined && error.includes('handwritten/rules.ts') && error.includes('search/search.ts --from')
  check(text.includes(keyLine) && saysHowToMake(missingError) && missingError!.includes('is missing') && saysHowToMake(otherDatasetError) && otherDatasetError!.includes('was saved with the dataset 0123456789abcdef')
    && saysHowToMake(withoutKeyError) && withoutKeyError!.includes('holds no dataset key') && noScratchError !== undefined && noScratchError.includes('RECOVERY_SCRATCH'),
    `numberToBeat says ${JSON.stringify(missingError)} for a missing file, ${JSON.stringify(otherDatasetError)} for a file of another dataset, ${JSON.stringify(withoutKeyError)} for a file without a key, and ${JSON.stringify(noScratchError)} without a scratch folder`)
  console.log(`7. numberToBeat on scratch folders made here: the tables of search/search-from-handwritten.json as the setting "${toBeat.name}" without a seed, with every row as scoreTables gives it and 1 cell changed against the hand-written tables, which are its base. A missing file, a file of another dataset and a file without a dataset key are each refused with the two commands that make the file: ${missingError}`)
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
