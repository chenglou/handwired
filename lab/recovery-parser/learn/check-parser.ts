// Checks the recovery parser against today's parser, table-parser.ts.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/check-parser.ts [dataset samples for check a, default 30000] [settings for check b, default 200]
//
// a. With asIsTables(), the trace is today's in every field at every one of the 513 positions, except two fields
//    after a first error: the container after a code point, where the real stack and today's running sum differ, and
//    the context, which holds the kind of the innermost container. The check counts how often they differ.
// b. For random settings of every open cell, some with added states, the ground rules hold on every text: (1) the
//    same trace as today at every position before the first error, and at all 513 positions of a valid text, (2) the
//    same `valid`, first error position and first error kind as today.
// c. The same for tables with added structure, see structure/README.md: with added classes, with open entries of
//    the display table, with the bit "first on its line", and with all three. With no cell changed, such tables give
//    the trace of asIsTables() at every position of every text. With random settings of every open cell and every
//    open entry, the ground rules hold. A trace of such tables is compared in today's terms: the class of an added
//    class's code point as the class that the code point has today, and a context without the bit. The bit itself
//    is compared, at every position of every run, with the bit that the check counts from the trace's line feeds and
//    tokens.
// d. Structure that is added to tables whose open cells are changed already leaves every text's trace as it was.
// e. With so many classes and states that a cell's number does not fit 16 bits, the trace names the cells that were
//    read, and the ground rules hold.
import {createRandom} from '../random.ts'
import {defaultSeed} from '../samples.ts'
import {type ParserTrace, classNames, grammarStateNames, positionCount, runTableParser, tokenNames} from '../table-parser.ts'
import {checkTexts, classesOfTheChecks, textWithAddedClasses} from './check-texts.ts'
import {allowedSampleAt, refuseUnknownOptions} from './data.ts'
import {type RecoveryTrace, codePointsOf, createTrace, runRecoveryParserInto} from './recovery-parser.ts'
import {type RecoveryTables, addClasses, addFirstOnLineBit, addStates, asIsTables, checkTables, grammarCellOf, lexerCellOf, openDisplayEntries, randomizeOpenCells, today} from './recovery-tables.ts'

refuseUnknownOptions('check-parser.ts', [])
const sampleCount = Number(process.argv[2] ?? 30_000)
const settingCount = Number(process.argv[3] ?? 200)
let failures = 0
const fail = (message: string) => {
  failures++
  if (failures <= 20) console.log(`FAILED: ${message}`)
}

// The fields that both traces have, per position.
const fields = ['characterClass', 'lexerStateBefore', 'event', 'token', 'context', 'grammarBefore', 'grammarAfter', 'displayKind', 'depthAfter', 'containerAfter'] as const

// The first difference between a trace and today's at the positions before `positions`, or undefined.
function differenceBefore(trace: RecoveryTrace, expected: ParserTrace, positions: number): string | undefined {
  for (const field of fields) {
    const actual = trace[field]
    const wanted = expected[field]
    for (let position = 0; position < positions; position++) {
      if (actual[position] !== wanted[position]) return `${field} at position ${position} is ${actual[position]}, and today's is ${wanted[position]}`
    }
  }
  return undefined
}
function verdictDifference(trace: RecoveryTrace, expected: ParserTrace): string | undefined {
  if (trace.valid !== expected.valid) return `valid is ${trace.valid}, and today's is ${expected.valid}`
  if (trace.firstErrorPosition !== expected.firstErrorPosition) return `the first error is at ${trace.firstErrorPosition}, and today's at ${expected.firstErrorPosition}`
  if (trace.firstErrorKind !== expected.firstErrorKind) return `the first error's kind is ${trace.firstErrorKind}, and today's ${expected.firstErrorKind}`
  if (trace.length !== expected.length) return `the length is ${trace.length}, and today's ${expected.length}`
  return undefined
}

// Check a.
{
  const tables = asIsTables()
  checkTables(tables)
  const trace = createTrace()
  const tally = {texts: 0, valid: 0, broken: 0, brokenWithOtherContainer: 0, codePointsFromError: 0, otherContainer: 0, otherContext: 0}
  const check = (text: string) => {
    const expected = runTableParser(text)
    const {codePoints, truncated} = codePointsOf(text)
    runRecoveryParserInto(trace, codePoints, 0, codePoints.length, truncated, tables)
    tally.texts++
    const difference = verdictDifference(trace, expected) ?? differenceBefore(trace, expected, expected.valid ? positionCount : expected.firstErrorPosition)
    if (difference !== undefined) fail(`${difference} in ${JSON.stringify(text.slice(0, 80))}`)
    if (expected.valid) {
      tally.valid++
      return
    }
    tally.broken++
    let otherContainer = 0
    for (let position = expected.firstErrorPosition; position < positionCount; position++) {
      for (const field of fields) {
        if (trace[field][position] === expected[field][position]) continue
        // The context of the first error's own position comes from the stack before it, so it has to be today's.
        if (field === 'containerAfter' || (field === 'context' && position > expected.firstErrorPosition)) continue
        fail(`${field} at position ${position}, at or after the first error, is ${trace[field][position]}, and today's is ${expected[field][position]} in ${JSON.stringify(text.slice(0, 80))}`)
      }
      if (position >= expected.length) continue
      tally.codePointsFromError++
      if (trace.containerAfter[position] !== expected.containerAfter[position]) otherContainer++
      if (trace.context[position] !== expected.context[position]) tally.otherContext++
    }
    tally.otherContainer += otherContainer
    if (otherContainer > 0) tally.brokenWithOtherContainer++
  }
  for (let index = 0; index < sampleCount; index++) {
    // The texts of the train and validation splits: allowedSampleAt gives no sample of the test split.
    const sample = allowedSampleAt(defaultSeed, index)
    if (sample === undefined) continue
    check(sample.broken)
    if (sample.source !== 'valid') for (const document of sample.documents) check(document)
  }
  for (const {text} of checkTexts(createRandom(20261015, 2), 10_000)) check(text)
  const share = (part: number, whole: number) => `${(100 * part / whole).toFixed(2)}%`
  console.log(`a. ${tally.texts} texts, ${tally.valid} valid and ${tally.broken} broken: with today's tables the recovery parser gives today's trace${failures === 0 ? '' : ', EXCEPT in the failures above'}.`)
  console.log(`   After a first error the container differs in ${tally.brokenWithOtherContainer} of the ${tally.broken} broken texts (${share(tally.brokenWithOtherContainer, tally.broken)}), at ${tally.otherContainer} of their ${tally.codePointsFromError} code points from the first error on (${share(tally.otherContainer, tally.codePointsFromError)}). The context differs at ${tally.otherContext} of them (${share(tally.otherContext, tally.codePointsFromError)}).`)
}

// The texts of the checks b and c, with today's trace of each: broken texts and originals of the dataset, and texts
// made here.
const texts: {text: string, codePoints: number[], truncated: boolean, expected: ParserTrace}[] = []
const add = (text: string) => texts.push({text, ...codePointsOf(text), expected: runTableParser(text)})
for (let index = 0; index < 2000; index++) {
  const sample = allowedSampleAt(defaultSeed, 100_000 + index)
  if (sample === undefined) continue
  add(sample.broken)
  if (sample.source !== 'valid') add(sample.original)
}
for (const {text} of checkTexts(createRandom(20261015, 3), 2000)) add(text)

// Check b.
{
  const valid = texts.filter(entry => entry.expected.valid).length
  const trace = createTrace()
  const colon = grammarStateNames.indexOf('colon')
  let runs = 0
  let positionsFromError = 0
  let changedFromError = 0
  let settingsWithAddedStates = 0
  for (let setting = 0; setting < settingCount; setting++) {
    // Every fourth setting has 3 more tokenizer states and 2 more grammar states.
    const tables = setting % 4 === 3 ? addStates(asIsTables(), 3, [colon, 0]) : asIsTables()
    if (setting % 4 === 3) settingsWithAddedStates++
    randomizeOpenCells(tables, createRandom(20261015, 1000 + setting))
    checkTables(tables)
    for (const {text, codePoints, truncated, expected} of texts) {
      runRecoveryParserInto(trace, codePoints, 0, codePoints.length, truncated, tables)
      runs++
      const before = expected.valid ? positionCount : expected.firstErrorPosition
      const difference = verdictDifference(trace, expected) ?? differenceBefore(trace, expected, before)
      if (difference !== undefined) fail(`setting ${setting}: ${difference} in ${JSON.stringify(text.slice(0, 80))}`)
      // How much a setting changes from the first error on, to show that the settings are not today's tables.
      for (let position = before; position < expected.length; position++) {
        positionsFromError++
        if (trace.displayKind[position] !== expected.displayKind[position] || trace.depthAfter[position] !== expected.depthAfter[position] || trace.grammarAfter[position] !== expected.grammarAfter[position]) changedFromError++
      }
    }
  }
  console.log(`b. ${settingCount} random settings of every open cell, ${settingsWithAddedStates} of them with added states, on ${texts.length} texts each, ${valid} valid and ${texts.length - valid} broken, ${runs} runs: ${failures === 0 ? 'every run has today\'s trace before the first error, today\'s first error and today\'s `valid`, and every valid text has today\'s whole trace' : 'see the failures above'}.`)
  console.log(`   From the first error on, the settings change the display kind, the depth or the grammar state at ${(100 * changedFromError / positionsFromError).toFixed(1)}% of the code points.`)
}

// Writes a trace of tables with added structure in today's terms, and returns at how many of the first `positions`
// positions the bit "first on its line" was set. Before that, at every position:
// - The bit of the context has to be the one that the trace's own line feeds and tokens give: a line feed sets it,
//   and any other code point whose token is not `none` clears it.
// - The two cells that the trace names have to be the cells of its tokenizer state and class, and of its grammar
//   state, token and context.
const lineFeed = classNames.indexOf('lineFeed')
const tokenNone = tokenNames.indexOf('none')
function inTodaysTerms(name: string, trace: RecoveryTrace, tables: RecoveryTables, positions: number) {
  const hasBit = tables.contextCount > today.contextCount
  let withBit = 0
  let bit = 0
  for (let position = 0; position < positionCount; position++) {
    const bitOfContext = trace.context[position]! >= today.contextCount ? 1 : 0
    if (bitOfContext !== (hasBit ? bit : 0)) fail(`${name}: the context at position ${position} ${bitOfContext === 1 ? 'has' : 'does not have'} the bit "first on its line", against the line feeds and tokens before it`)
    if (trace.lexerCell[position] !== lexerCellOf(tables, trace.lexerStateBefore[position]!, trace.characterClass[position]!) || trace.grammarCell[position] !== grammarCellOf(tables, trace.grammarBefore[position]!, trace.token[position]!, trace.context[position]!)) {
      fail(`${name}: the trace names the cells ${trace.lexerCell[position]} and ${trace.grammarCell[position]} at position ${position}, and the step read ${lexerCellOf(tables, trace.lexerStateBefore[position]!, trace.characterClass[position]!)} and ${grammarCellOf(tables, trace.grammarBefore[position]!, trace.token[position]!, trace.context[position]!)}`)
    }
    if (trace.characterClass[position] === lineFeed) bit = 1
    else if (trace.token[position] !== tokenNone) bit = 0
    if (bitOfContext === 1 && position < positions) withBit++
    trace.characterClass[position] = tables.classToday[trace.characterClass[position]!]!
    trace.context[position] = trace.context[position]! % today.contextCount
  }
  return withBit
}

// Check c.
{
  // More texts, with the code points of the added classes inside strings and between tokens.
  const random = createRandom(20261015, 4)
  for (let index = 0; index < 1000; index++) add(textWithAddedClasses(random))
  const valid = texts.filter(entry => entry.expected.valid).length
  const colon = grammarStateNames.indexOf('colon')
  const settingsPerVariant = Math.max(4, Math.round(settingCount / 5))
  const variants: {name: string, make: () => RecoveryTables}[] = [
    {name: `${classesOfTheChecks.length} added classes`, make: () => addClasses(asIsTables(), classesOfTheChecks)},
    {name: 'open entries of the display table', make: () => openDisplayEntries(asIsTables())},
    {name: 'the bit "first on its line"', make: () => addFirstOnLineBit(asIsTables())},
    {name: 'all three', make: () => addFirstOnLineBit(openDisplayEntries(addClasses(asIsTables(), classesOfTheChecks)))},
  ]
  const everyField = [...fields, 'lexerStateAfter', 'action'] as const
  const trace = createTrace()
  const plainTrace = createTrace()
  const plain = asIsTables()
  console.log(`c. Tables with added structure, on ${texts.length} texts, ${valid} valid and ${texts.length - valid} broken:`)
  for (const variant of variants) {
    const failuresBefore = failures
    // With no cell changed.
    const unchanged = variant.make()
    checkTables(unchanged)
    let codePointsWithBit = 0
    for (const {text, codePoints, truncated} of texts) {
      runRecoveryParserInto(plainTrace, codePoints, 0, codePoints.length, truncated, plain)
      runRecoveryParserInto(trace, codePoints, 0, codePoints.length, truncated, unchanged)
      codePointsWithBit += inTodaysTerms(`${variant.name}, no cell changed`, trace, unchanged, codePoints.length)
      for (const field of everyField) {
        for (let position = 0; position < positionCount; position++) {
          if (trace[field][position] !== plainTrace[field][position]) fail(`${variant.name}, no cell changed: ${field} at position ${position} is ${trace[field][position]}, and without the structure ${plainTrace[field][position]} in ${JSON.stringify(text.slice(0, 80))}`)
        }
      }
      if (trace.valid !== plainTrace.valid || trace.firstErrorPosition !== plainTrace.firstErrorPosition || trace.firstErrorKind !== plainTrace.firstErrorKind) fail(`${variant.name}, no cell changed: another verdict in ${JSON.stringify(text.slice(0, 80))}`)
    }
    // With random settings, every fourth with 3 more tokenizer states and 2 more grammar states.
    let positionsFromError = 0
    let changedFromError = 0
    for (let setting = 0; setting < settingsPerVariant; setting++) {
      const tables = setting % 4 === 3 ? addStates(variant.make(), 3, [colon, 0]) : variant.make()
      randomizeOpenCells(tables, createRandom(20261015, 5000 + setting))
      checkTables(tables)
      for (const {text, codePoints, truncated, expected} of texts) {
        runRecoveryParserInto(trace, codePoints, 0, codePoints.length, truncated, tables)
        inTodaysTerms(`${variant.name}, setting ${setting}`, trace, tables, 0)
        const before = expected.valid ? positionCount : expected.firstErrorPosition
        const difference = verdictDifference(trace, expected) ?? differenceBefore(trace, expected, before)
        if (difference !== undefined) fail(`${variant.name}, setting ${setting}: ${difference} in ${JSON.stringify(text.slice(0, 80))}`)
        for (let position = before; position < expected.length; position++) {
          positionsFromError++
          if (trace.displayKind[position] !== expected.displayKind[position] || trace.depthAfter[position] !== expected.depthAfter[position] || trace.grammarAfter[position] !== expected.grammarAfter[position]) changedFromError++
        }
      }
    }
    console.log(`   ${variant.name}: ${failures === failuresBefore ? `with no cell changed, every text has the trace of today's tables at all ${positionCount} positions. With ${settingsPerVariant} random settings of every open cell${unchanged.displayOpen.includes(1) ? ' and every open entry' : ''}, every run has today's trace before the first error, today's first error and today's \`valid\`` : 'see the failures above'}. From the first error on, the settings change the display kind, the depth or the grammar state at ${(100 * changedFromError / positionsFromError).toFixed(1)}% of the code points.${codePointsWithBit === 0 ? '' : ` With no cell changed, ${codePointsWithBit} code points of the texts read a context with the bit.`}`)
  }
}

// Check d. Structure that is added to tables whose open cells are changed already: every text keeps its whole trace.
// Check c shows that for tables with today's cells only. Each step below gives every open cell and every open entry
// of the tables so far a random choice, adds one kind of structure, and compares the traces before and after:
// - Two classes that are taken out of added classes whose cells are changed: the 9 out of the class of the digits 7
//   to 9, and the star out of the class of the signs. A new class's cell has to be a copy of the cell of the class
//   that its code points came out of, and not e.g. of the cell of the class that they have today.
// - The bit "first on its line": a cell with the bit is a copy of the cell without.
// - Open entries of the display table, which changes no entry.
// - Added states, which leave the cells and the entries of the states that were there as they were.
{
  const colon = grammarStateNames.indexOf('colon')
  const steps: {name: string, add: (tables: RecoveryTables) => RecoveryTables}[] = [
    {name: 'two classes taken out of added classes', add: tables => addClasses(tables, [{name: 'nine', codePoints: [0x39]}, {name: 'star', codePoints: [0x2a]}])},
    {name: 'the bit "first on its line"', add: addFirstOnLineBit},
    {name: 'open entries of the display table', add: openDisplayEntries},
    {name: '2 tokenizer states and a grammar state', add: tables => addStates(tables, 2, [colon])},
  ]
  const sameFields = ['lexerStateBefore', 'lexerStateAfter', 'event', 'token', 'grammarBefore', 'grammarAfter', 'action', 'displayKind', 'depthAfter', 'containerAfter'] as const
  const traceBefore = createTrace()
  const traceAfter = createTrace()
  const failuresBefore = failures
  let tables = addClasses(asIsTables(), classesOfTheChecks)
  let codePointsOfNewClasses = 0
  steps.forEach((step, index) => {
    randomizeOpenCells(tables, createRandom(20261015, 7000 + index))
    checkTables(tables)
    const added = step.add(tables)
    checkTables(added)
    for (const {text, codePoints, truncated} of texts) {
      runRecoveryParserInto(traceBefore, codePoints, 0, codePoints.length, truncated, tables)
      runRecoveryParserInto(traceAfter, codePoints, 0, codePoints.length, truncated, added)
      for (let position = 0; position < positionCount; position++) {
        const field = sameFields.find(name => traceBefore[name][position] !== traceAfter[name][position])
        // A new class has the class of today's that its code points had before, and the bit adds 8 to a context.
        const sameClass = added.classToday[traceAfter.characterClass[position]!] === tables.classToday[traceBefore.characterClass[position]!]
        const sameContext = traceAfter.context[position]! % tables.contextCount === traceBefore.context[position]
        if (field !== undefined || !sameClass || !sameContext) fail(`${step.name}, added to tables with changed cells: ${field ?? (sameClass ? 'context' : 'characterClass')} at position ${position} is ${traceAfter[field ?? 'context'][position]}, and ${traceBefore[field ?? 'context'][position]} before the structure was added, in ${JSON.stringify(text.slice(0, 80))}`)
        if (position < codePoints.length && traceAfter.characterClass[position]! >= tables.classCount) codePointsOfNewClasses++
      }
      if (traceBefore.valid !== traceAfter.valid || traceBefore.firstErrorPosition !== traceAfter.firstErrorPosition || traceBefore.firstErrorKind !== traceAfter.firstErrorKind) fail(`${step.name}, added to tables with changed cells: another verdict in ${JSON.stringify(text.slice(0, 80))}`)
    }
    tables = added
  })
  if (codePointsOfNewClasses === 0) fail('no code point of the texts has one of the two classes that check d adds')
  console.log(`d. Structure added to tables whose open cells are changed already, on the same texts, one step after the other (${steps.map(step => step.name).join('; ')}): ${failures === failuresBefore ? `every text has the same trace at all ${positionCount} positions before and after each step` : 'see the failures above'}. ${codePointsOfNewClasses} code points of the texts have one of the two new classes.`)
}

// Check e. Tables with so many classes and states that the number of a cell does not fit 16 bits: 100 more classes
// and 229 more tokenizer states give 33,915 tokenizer cells, and 192 more grammar states with the bit give 35,200
// grammar cells. The trace has to name the cells that the steps read, see inTodaysTerms: cellsReadAt and
// withUnreadCellsOf of score.ts go by the trace's cells. And the ground rules hold as for any tables.
{
  const manyClasses = Array.from({length: 100}, (_, index) => ({name: `letter${index}`, codePoints: [0x100 + index]}))
  const tables = addStates(addFirstOnLineBit(addClasses(asIsTables(), manyClasses)), 255 - today.lexerStateCount, new Array<number>(200 - today.grammarStateCount).fill(0))
  randomizeOpenCells(tables, createRandom(20261015, 8000))
  checkTables(tables)
  const trace = createTrace()
  const failuresBefore = failures
  let largestLexerCell = 0
  let largestGrammarCell = 0
  for (const {text, codePoints, truncated, expected} of texts) {
    runRecoveryParserInto(trace, codePoints, 0, codePoints.length, truncated, tables)
    for (let position = 0; position < positionCount; position++) {
      largestLexerCell = Math.max(largestLexerCell, trace.lexerCell[position]!)
      largestGrammarCell = Math.max(largestGrammarCell, trace.grammarCell[position]!)
    }
    inTodaysTerms('tables with many classes and states', trace, tables, 0)
    const difference = verdictDifference(trace, expected) ?? differenceBefore(trace, expected, expected.valid ? positionCount : expected.firstErrorPosition)
    if (difference !== undefined) fail(`tables with many classes and states: ${difference} in ${JSON.stringify(text.slice(0, 80))}`)
  }
  if (largestLexerCell < 2 ** 15 || largestGrammarCell < 2 ** 15) fail(`no step of check e read a cell whose number does not fit 16 bits: the largest are ${largestLexerCell} and ${largestGrammarCell}`)
  console.log(`e. Tables with ${tables.classCount} classes, ${tables.lexerStateCount} tokenizer states, ${tables.grammarStateCount} grammar states and the bit, ${tables.lexerNext.length} tokenizer cells and ${tables.grammarNext.length} grammar cells, with a random setting of every open cell: ${failures === failuresBefore ? 'the trace names the cells that every step read, up to the cells' : 'see the failures above. The largest cells read are'} ${largestLexerCell} and ${largestGrammarCell}, and every run has today's trace before the first error and today's verdict.`)
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
