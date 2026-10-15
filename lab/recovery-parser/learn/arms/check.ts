// Checks the harness of the arms.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/check.ts
//
// 1. The dataset's hand rules as tables of the experiment: on the broken texts of the train and validation samples
//    of the first 6,000 indexes, the exact parser with the converted tables gives the depth of the dataset's plain
//    table parser with the hand rule's tables at every code point. The two parsers keep the kinds of the open
//    containers in other ways, a real stack and a running sum, and after a closing bracket that does not match they
//    can disagree about the innermost container. The grammar then reads another context, so the display kind can
//    differ from there on too. Up to the first code point that reads another context, everything is the same, and the
//    check counts what differs after it. The three are tables of the plain table parser, and the hand-written 35
//    rules are not. And the cells that the dataset takes for read by valid JSON are the experiment's frozen cells,
//    cell by cell, so the dataset's first condition and the experiment's first ground rule are the same rule.
//    Tables of the dataset's layout with one more tokenizer state convert too, with the same depth at every code
//    point: a later commit of the dataset has a hand rule with such a state.
// 2. The record of today's tables: its row "all" is the row of scoreTables, it has a row for each of the six groups
//    and for the kinds of damage, no cell is changed, the ground rules hold, and the depth of valid JSON that is too
//    deep is right. Tables with a changed frozen cell get no record.
// 3. The ground rules hold on the fixed texts for random settings of every open cell, with and without added
//    structure.
// 4. runArm with a toy build function: it saves the tables and the record of every setting and seed, the record it
//    returns is the record of the saved tables, and its summary has a row per setting. describeComparison refuses a
//    setting with fewer than 3 seeds and gives the ranges of both settings.
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {handRuleTables, handRules} from '../../hand-rules.ts'
import {cellsThatValidJsonReads} from '../../limits.ts'
import {createRandom} from '../../random.ts'
import {classNames, defaultTables, eventNames, lexerStateNames, runTableParser} from '../../table-parser.ts'
import {classesOfTheChecks} from '../check-texts.ts'
import {groupNames, loadSamples, standardRange, textOf} from '../data.ts'
import {handwrittenTables} from '../handwritten/rules.ts'
import {plainParserProblems, recoveryTablesOf} from '../plain-tables.ts'
import {createTrace, runRecoveryParserInto} from '../recovery-parser.ts'
import {addClasses, addFirstOnLineBit, addStates, asIsTables, copyTables, grammarStateNames, loadTables, openDisplayEntries, randomizeOpenCells, tablesToJson} from '../recovery-tables.ts'
import {scoreTables} from '../score.ts'
import {type ArmRecord, armFolderOf, baselineTables, describeComparison, describeSettings, fileNameOf, groundRulesOn, recordOf, rowNamed, runArm, validationOfTheStandardSet} from './harness.ts'

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
    const tally = {texts: 0, codePoints: 0, otherDepth: 0, differentBeforeAnotherContext: 0, textsWithAnotherContext: 0, otherContainer: 0, otherKind: 0}
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
    console.log(`   The hand rule ${rule} as tables of the experiment: on ${tally.texts} broken texts, ${tally.codePoints} code points, the exact parser gives the depth of the dataset's plain table parser at every one. In ${tally.textsWithAnotherContext} texts the real stack and the running sum disagree about a container. From the first code point that reads another context on, the container differs at ${share(tally.otherContainer)} code points and the display kind at ${share(tally.otherKind)}. Before it nothing differs.`)
  }
  // Tables of the dataset's layout with one more tokenizer state, as the hand rule `lines` of a later commit of the
  // dataset has it: the state after a string that a line feed ended, whose row is the row of the state between,
  // but for an opening brace, which gets the event of a comma.
  {
    const words = handRuleTables('words')
    const classCount = defaultTables.classCount
    const between = lexerStateNames.indexOf('between')
    const addedState = lexerStateNames.length
    const lexerNext = [...words.lexerNext]
    const lexerEvent = [...words.lexerEvent]
    for (let characterClass = 0; characterClass < classCount; characterClass++) {
      lexerNext.push(lexerNext[between * classCount + characterClass]!)
      lexerEvent.push(lexerEvent[between * classCount + characterClass]!)
    }
    lexerNext[lexerStateNames.indexOf('string') * classCount + classNames.indexOf('lineFeed')] = addedState
    lexerEvent[addedState * classCount + classNames.indexOf('openBrace')] = eventNames.indexOf('comma')
    lexerNext[addedState * classCount + classNames.indexOf('openBrace')] = between
    const plain = {...words, lexerNext, lexerEvent}
    const tables = recoveryTablesOf(plain)
    let codePoints = 0
    let otherDepth = 0
    let inAddedState = 0
    for (let place = 0; place < samples.sampleCount; place++) {
      if (samples.firstDamage[place] === -1) continue
      const start = samples.start[place]!
      const length = samples.start[place + 1]! - start
      const expected = runTableParser(textOf(samples, place), plain)
      runRecoveryParserInto(trace, samples.codePoints, start, length, false, tables, length)
      for (let position = 0; position < length; position++) {
        codePoints++
        if (trace.depthAfter[position] !== expected.depthAfter[position]) otherDepth++
        if (trace.lexerStateBefore[position] === addedState) inAddedState++
      }
    }
    check(tables.lexerStateCount === addedState + 1 && otherDepth === 0 && inAddedState > 0 && plainParserProblems(tables).length === 0, `tables with one more tokenizer state: ${otherDepth} of ${codePoints} code points have another depth than in the plain table parser, ${inAddedState} are read in the added state, and plainParserProblems says ${plainParserProblems(tables)[0] ?? 'nothing'}`)
    check(throws(() => recoveryTablesOf({...words, lexerNext: words.lexerNext.slice(0, -1)})), 'recoveryTablesOf takes tables whose tokenizer table is no whole number of states')
    console.log(`   Tables of the dataset's layout with one more tokenizer state convert too: ${tables.lexerStateCount} tokenizer states, ${inAddedState} code points are read in the added state, and the depth is the plain table parser's at every code point.`)
  }
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

// 2. The record of today's tables.
const validation = validationOfTheStandardSet()
{
  const record = recordOf(asIsTables(), asIsTables())
  const expected = scoreTables(asIsTables(), validation).rows[0]!
  check(JSON.stringify(rowNamed(record, 'all')) === JSON.stringify(expected), 'the record\'s row "all" is not the row of scoreTables')
  check(groupNames.every(group => record.rows.some(row => row.name === `group: ${group}`)), 'the record lacks a row of one of the six groups')
  const kindRows = record.rows.filter(row => row.name.startsWith('kind: ')).length
  check(kindRows >= 45, `the record has ${kindRows} rows of kinds of damage`)
  check(record.cellsChangedAgainstBase.total === 0 && record.cellsThatDifferFromToday.total === 0 && record.groundRules.hold && record.groundRules.texts > 2000, `the record of today's tables: ${JSON.stringify(record.cellsChangedAgainstBase)}, ground rules ${JSON.stringify(record.groundRules)}`)
  check(record.wrongDepthsOnDeepValidJson.nothingAfter === 0 && record.wrongDepthsOnDeepValidJson.membersAfter === 0 && record.shownAsPastEnd === 0, 'today\'s tables have a wrong depth on valid JSON that is too deep, or show a code point as past the end')
  check(record.datasetKey === validation.datasetKey && record.plainParserProblems.length === 0, 'the record of today\'s tables has another dataset key, or a problem with the plain table parser')
  const frozen = asIsTables()
  const cell = frozen.lexerOpen.indexOf(0)
  frozen.lexerEvent[cell] = (frozen.lexerEvent[cell]! + 1) % frozen.eventCount
  check(throws(() => recordOf(frozen, asIsTables())), 'tables with a changed frozen cell get a record')
  console.log(`2. The record of today's tables: ${record.rows.length} rows, among them the six groups and ${kindRows} kinds of damage, the row "all" as scoreTables gives it, no cell changed, the ground rules hold on ${record.groundRules.texts} fixed texts, and no wrong depth on valid JSON that is too deep. Tables with a changed frozen cell get no record.`)
}

// 3. The ground rules on the fixed texts, for random settings.
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
}

// 4. runArm with a toy build function: a seed picks one open grammar cell and sends it to another state.
{
  const base = asIsTables()
  const build = (stateName: string) => (seed: number) => {
    const tables = asIsTables()
    const random = createRandom(seed, 0)
    let cell = random.integer(0, tables.grammarNext.length - 1)
    while (tables.grammarOpen[cell] === 0) cell = random.integer(0, tables.grammarNext.length - 1)
    tables.grammarNext[cell] = grammarStateNames.indexOf(stateName)
    return {tables, base}
  }
  const lines: string[] = []
  const results = await runArm({name: 'check-of-the-harness', seeds: [1, 2, 3], log: line => lines.push(line), settings: [{name: 'one cell to value', build: build('value')}, {name: 'one cell to colon', build: build('colon')}]})
  const folder = armFolderOf('check-of-the-harness')
  let saved = 0
  for (const result of results) {
    for (const [at, seed] of result.seeds.entries()) {
      const tablesFile = join(folder, fileNameOf(result.name), `seed-${seed}.tables.json`)
      const recordFile = join(folder, fileNameOf(result.name), `seed-${seed}.record.json`)
      if (!existsSync(tablesFile) || !existsSync(recordFile)) continue
      const record = JSON.parse(readFileSync(recordFile, 'utf8')) as ArmRecord
      const again = recordOf(loadTables(tablesFile).tables, base)
      // The saved record is the record of the saved tables. A share with nothing to divide by is NaN, which JSON writes as null.
      if (JSON.stringify(record) === JSON.stringify(again) && JSON.stringify(record) === JSON.stringify(result.records[at])) saved++
    }
  }
  check(results.length === 2 && results.every(result => result.records.length === 3) && saved === 6, `runArm returned ${results.length} settings and saved ${saved} of 6 tables with their records`)
  check(results.every(result => result.records.every(record => record.cellsChangedAgainstBase.total <= 1)), 'a toy build changed more than one cell')
  const summary = readFileSync(join(folder, 'summary.md'), 'utf8')
  check(summary.includes('| one cell to value | 3 |') && summary.includes('| one cell to colon | 3 |') && summary.includes('Only 3 seeds') && summary === `${describeSettings(results)}\n\nOnly 3 seeds: a try-out, not a number to report.\n`, 'summary.md is not the tables of describeSettings with a row per setting')
  check(lines.join('\n').includes('| one cell to value | 3 |'), 'runArm did not print the summary')
  const comparison = describeComparison(results[0]!, results[1]!)
  check(comparison.includes('over 3 seeds') && (comparison.includes('overlap') || comparison.includes('do not overlap')), `the comparison is ${JSON.stringify(comparison)}`)
  check(throws(() => describeComparison({...results[0]!, seeds: [1, 2], records: results[0]!.records.slice(0, 2)}, results[1]!)), 'a comparison with 2 seeds does not throw')
  const baseline = {name: 'the parser as it is', seeds: [], records: [recordOf(asIsTables(), asIsTables())]}
  check(!throws(() => describeComparison(results[0]!, baseline)) && describeComparison(results[0]!, baseline).includes('no seed'), 'a comparison with a baseline, which has no seed, throws')
  const baselineNames = baselineTables().map(baseline => baseline.name)
  // The parser as it is, one row per hand rule of the dataset, and the hand-written rules.
  check(baselineNames.length === handRules.length + 2 && baselineTables().every(({tables}) => tablesToJson(tables).length > 0), `the baselines are ${baselineNames.join(', ')}`)
  console.log(`4. runArm with 2 settings and 3 seeds saved 6 tables, each with the record that recordOf gives for the saved tables, and a summary with a row per setting. describeComparison gives both ranges and refuses 2 seeds. The baselines: ${baselineNames.join('; ')}.`)
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
