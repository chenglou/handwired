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
// c. The same for tables with added structure, see structure/README.md: with added classes. With no cell changed,
//    such tables give the trace of asIsTables() at every position of every text. With random settings of every open
//    cell, the ground rules hold. A trace of such tables is compared in today's terms, e.g. the class of an added
//    class's code point as the class that the code point has today.
import {createRandom} from '../random.ts'
import {defaultSeed, sampleAt} from '../samples.ts'
import {type ParserTrace, grammarStateNames, positionCount, runTableParser} from '../table-parser.ts'
import {checkTexts, classesOfTheChecks, textWithAddedClasses} from './check-texts.ts'
import {type RecoveryTrace, codePointsOf, createTrace, runRecoveryParserInto} from './recovery-parser.ts'
import {type RecoveryTables, addClasses, addStates, asIsTables, checkTables, randomizeOpenCells} from './recovery-tables.ts'

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
    const sample = sampleAt(defaultSeed, index)
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
  const sample = sampleAt(defaultSeed, 100_000 + index)
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
  ]
  // Writes a trace in today's terms.
  const inTodaysTerms = (trace: RecoveryTrace, tables: RecoveryTables) => {
    for (let position = 0; position < positionCount; position++) trace.characterClass[position] = tables.classToday[trace.characterClass[position]!]!
  }
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
    for (const {text, codePoints, truncated} of texts) {
      runRecoveryParserInto(plainTrace, codePoints, 0, codePoints.length, truncated, plain)
      runRecoveryParserInto(trace, codePoints, 0, codePoints.length, truncated, unchanged)
      inTodaysTerms(trace, unchanged)
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
        inTodaysTerms(trace, tables)
        const before = expected.valid ? positionCount : expected.firstErrorPosition
        const difference = verdictDifference(trace, expected) ?? differenceBefore(trace, expected, before)
        if (difference !== undefined) fail(`${variant.name}, setting ${setting}: ${difference} in ${JSON.stringify(text.slice(0, 80))}`)
        for (let position = before; position < expected.length; position++) {
          positionsFromError++
          if (trace.displayKind[position] !== expected.displayKind[position] || trace.depthAfter[position] !== expected.depthAfter[position] || trace.grammarAfter[position] !== expected.grammarAfter[position]) changedFromError++
        }
      }
    }
    console.log(`   ${variant.name}: ${failures === failuresBefore ? `with no cell changed, every text has the trace of today's tables at all ${positionCount} positions. With ${settingsPerVariant} random settings of every open cell, every run has today's trace before the first error, today's first error and today's \`valid\`` : 'see the failures above'}. From the first error on, the settings change the display kind, the depth or the grammar state at ${(100 * changedFromError / positionsFromError).toFixed(1)}% of the code points.`)
  }
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
