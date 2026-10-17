// Valid JSON that the highlighter does not accept because it is too deep: texts of 17 to 19 levels.
//
// "Valid JSON is parsed exactly as today" holds for JSON that the highlighter accepts, i.e. at most 512 code points
// and 16 levels. A valid JSON text with 17 levels has a first error at its 17th opening bracket (tooDeep), and reads
// open cells from there on, so tables may show the rest of it otherwise than today. That is within the ground rules.
// But the dataset has no text deeper than 16 levels, so no score sees it. Today's parser keeps the depth of such a
// text right at every code point, since the depth is a count of brackets. This script counts, for today's tables and
// for saved tables, at how many code points of such texts the depth and the innermost container are not the ones
// that the brackets give.
//
// The texts come in two forms, and the counts are given for each:
// - "nothing after": after the innermost container closes, only closing brackets and white space follow, e.g.
//   [1, [2, [3]]]. The members of every container come before its nested container.
// - "members after": members follow the nested containers, e.g. [[[3], 2], 1], so after a closing bracket the text
//   goes on with a comma and a value or a member. Tables that pass the first form can fail this one: the tables of
//   the smoke run `display` of structure/smoke.ts have no wrong depth in the first form and 0.2% in this one.
//
// A valid JSON text of more than 512 code points needs no such check: its first error is at position 512, after
// every code point that is shown.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/check-deep.ts [--texts 300] [--must-hold] <name>=<tables.json> ...
// The command fails when today's tables have a wrong depth. With --must-hold it also fails when one of the saved
// tables has more wrong depths than today's tables, in either form.
import {scanNesting} from '../labels.ts'
import {createRandom} from '../random.ts'
import {tooDeepText, tooDeepTextWithMembersAfter} from './check-texts.ts'
import {optionOf, refuseUnknownOptions} from './data.ts'
import {codePointsOf, createTrace, runRecoveryParserInto} from './recovery-parser.ts'
import {type RecoveryTables, asIsTables, checkTables, loadTablesForReport} from './recovery-tables.ts'

// `count` valid JSON texts of 17 to 19 levels and at most 512 code points with nothing after their nested containers,
// the same ones on every call.
export function deepTexts(count: number): string[] {
  const random = createRandom(20261015, 17)
  return Array.from({length: count}, () => {
    const text = tooDeepText(random)
    JSON.parse(text)
    return text
  })
}

// `count` such texts with members after their nested containers, the same ones on every call.
export function deepTextsWithMembersAfter(count: number): string[] {
  const random = createRandom(20261015, 18)
  return Array.from({length: count}, () => {
    const text = tooDeepTextWithMembersAfter(random)
    JSON.parse(text)
    return text
  })
}

// Over the code points of `texts`: how many there are, how many come at or after the first error, and at how many
// the depth and the container that `tables` give are not the ones that the brackets give. Above 16 levels the
// parser keeps no kind per level, so some containers are wrong for every tables.
export function depthsOnDeepTexts(tables: RecoveryTables, texts: readonly string[]) {
  checkTables(tables)
  const trace = createTrace()
  const tally = {texts: texts.length, codePoints: 0, fromFirstError: 0, depthWrong: 0, containerWrong: 0}
  for (const text of texts) {
    const {codePoints, truncated} = codePointsOf(text)
    if (truncated) throw new Error('a text for depthsOnDeepTexts has more than 512 code points')
    const nesting = scanNesting(Array.from(text))
    runRecoveryParserInto(trace, codePoints, 0, codePoints.length, false, tables)
    if (trace.firstErrorPosition === -1) throw new Error(`today's parser accepts a text that should be too deep: ${JSON.stringify(text.slice(0, 80))}`)
    tally.codePoints += codePoints.length
    for (let position = trace.firstErrorPosition; position < codePoints.length; position++) {
      tally.fromFirstError++
      if (trace.depthAfter[position] !== nesting.depth[position]) tally.depthWrong++
      if (trace.containerAfter[position] !== nesting.container[position]) tally.containerWrong++
    }
  }
  return tally
}

// The shares of wrong depths of `tables` on the two forms of too deep texts, 300 texts each, from 0 to 1: what a
// record of an arm holds.
export function wrongDepthsOnDeepTexts(tables: RecoveryTables, textCount = 300) {
  const nothingAfter = depthsOnDeepTexts(tables, deepTexts(textCount))
  const membersAfter = depthsOnDeepTexts(tables, deepTextsWithMembersAfter(textCount))
  return {nothingAfter: nothingAfter.depthWrong / nothingAfter.fromFirstError, membersAfter: membersAfter.depthWrong / membersAfter.fromFirstError}
}

if (import.meta.main) {
  refuseUnknownOptions('check-deep.ts', ['--texts', '--must-hold'])
  const textCount = Number(optionOf('--texts') ?? 300)
  const forms = [{name: 'nothing after the nested containers', texts: deepTexts(textCount)}, {name: 'members after the nested containers', texts: deepTextsWithMembersAfter(textCount)}]
  const named = process.argv.slice(2).filter(argument => !argument.startsWith('--') && argument.includes('=')).map(argument => ({name: argument.slice(0, argument.indexOf('=')), file: argument.slice(argument.indexOf('=') + 1)}))
  const savedTables = named.map(({name, file}) => ({name, tables: loadTablesForReport(file).tables}))
  let todayWrong = 0
  let worse = 0
  for (const form of forms) {
    const today = depthsOnDeepTexts(asIsTables(), form.texts)
    todayWrong += today.depthWrong
    console.log(`${today.texts} valid JSON texts of 17 to 19 levels, ${form.name}: ${today.codePoints} code points, ${today.fromFirstError} of them at or after the first error (too deep).`)
    const line = (name: string, tally: typeof today) => `  ${name}: the depth is wrong at ${tally.depthWrong} of those code points (${(100 * tally.depthWrong / tally.fromFirstError).toFixed(1)}%), the container at ${tally.containerWrong} (${(100 * tally.containerWrong / tally.fromFirstError).toFixed(1)}%)`
    console.log(line('the parser as it is', today))
    for (const {name, tables} of savedTables) {
      const tally = depthsOnDeepTexts(tables, form.texts)
      console.log(line(name, tally))
      if (tally.depthWrong > today.depthWrong) worse++
    }
  }
  const mustHold = process.argv.includes('--must-hold')
  if (worse > 0) console.log(`${worse} counts of saved tables are above the count of today's tables${mustHold ? '' : ', which fails only with --must-hold'}.`)
  const failed = todayWrong > 0 || (mustHold && worse > 0)
  console.log(failed ? 'The check FAILED.' : 'Every check passed.')
  if (failed) process.exitCode = 1
}
