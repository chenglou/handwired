// Checks the rule of restart-at-next-line.ts, on the small set of check-set.ts and, when the dataset ../samples.ts is
// there, on its samples with the indexes 0 to 3,999 that are not in the test split.
//
// Run from the repo root: bun lab/recovery-toml/learn/check-restart-at-next-line.ts [samples of the dataset, default 4000]
//
// 1. A second derivation gives the same display kind, depth and container at every code point. The rule is written
//    as runs of the exact parser on the rest of a text. The second derivation is one loop over the tables of
//    ../table-parser.ts with one addition: after the line feed that follows an error, the tokenizer state and the
//    grammar state are the ones of a text's start, and no container is open.
// 2. Up to the line feed that ends the line of the first error, the rule shows what the parser as it is shows, and a
//    text without an error is shown as the parser as it is shows it everywhere.
// 3. The row "all" of the rule's score, counted a second time from the arrays with the second derivation.
// 4. The example at the top of restart-at-next-line.ts is shown as that file says.
import {displayKind} from '../kinds.ts'
import {containerInlineTable, containerNone, defaultTables, grammarStateNames, maximumDepth, runTableParserOnCodePoints} from '../table-parser.ts'
import {checkSamples} from './check-set.ts'
import {type Samples, codePointKept, codePointKindScored, codePointNestingScored, datasetExists, makeSamples, splitNames, standardRange} from './data.ts'
import {refuseUnknownOptions} from './options.ts'
import {actionByToken, actionPop, actionPushArray, actionPushInlineTable} from './recovery-tables.ts'
import {runRestartAtNextLine, scoreRestartAtNextLine} from './restart-at-next-line.ts'

refuseUnknownOptions('check-restart-at-next-line.ts', [])
const datasetSamples = Number(process.argv[2] ?? 4000)
let failures = 0
const fail = (message: string) => {
  failures++
  if (failures <= 20) console.log(`FAILED: ${message}`)
}

const lineFeed = 0x0a
type Shown = {displayKind: number[], depthAfter: number[], containerAfter: number[]}

// The second derivation: the loop of ../table-parser.ts over the code points of a text, and after the line feed that
// follows an error, the states of a text's start.
function oneLoopWithARestart(codePoints: readonly number[]): Shown {
  const tables = defaultTables
  const shown: Shown = {displayKind: [], depthAfter: [], containerAfter: []}
  const kindAtLevel = new Uint8Array(maximumDepth + 1)
  const lastClassEntry = tables.classOfCodePoint.length - 1
  let lexerState = 0
  let grammarState = 0
  let depth = 0
  let afterError = false
  for (const codePoint of codePoints) {
    const lexerCell = lexerState * tables.classCount + tables.classOfCodePoint[Math.min(codePoint + 1, lastClassEntry)]!
    const event = tables.lexerEvent[lexerCell]!
    const token = tables.grammarToken[event]!
    const level = Math.min(depth, maximumDepth)
    const inInlineTable = level >= 1 && kindAtLevel[level] === containerInlineTable ? 1 : 0
    const cell = grammarState * tables.symbolCount + token * tables.contextCount + tables.depthClass[Math.max(level, 0)]! * 2 + inInlineTable
    const grammarAfter = tables.grammarNext[cell]!
    if (grammarAfter === tables.errorState) afterError = true
    let action = tables.grammarAction[cell]!
    if (action === actionByToken) action = tables.actionOfToken[token]!
    if (action === actionPushArray || action === actionPushInlineTable) {
      depth++
      if (depth >= 1 && depth <= maximumDepth) kindAtLevel[depth] = action === actionPushInlineTable ? containerInlineTable : 2
    } else if (action === actionPop) {
      depth--
    }
    shown.displayKind.push(tables.display[event * tables.grammarStateCount + grammarAfter]!)
    shown.depthAfter.push(depth)
    shown.containerAfter.push(depth <= 0 ? containerNone : kindAtLevel[Math.min(depth, maximumDepth)]!)
    lexerState = tables.lexerNext[lexerCell]!
    grammarState = grammarAfter
    if (afterError && codePoint === lineFeed) {
      lexerState = 0
      grammarState = 0
      depth = 0
      afterError = false
    }
  }
  return shown
}

type Counts = {samples: number, nothingToRecover: number, codePoints: number, allRight: number, wholeSamples: number}

function checkSet(name: string, samples: Samples) {
  const failuresBefore = failures
  const counts: Counts = {samples: 0, nothingToRecover: 0, codePoints: 0, allRight: 0, wholeSamples: 0}
  const tally = {texts: 0, codePoints: 0, withAnError: 0, withARestart: 0, differentFromAsIs: 0}
  for (let place = 0; place < samples.sampleCount; place++) {
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    const codePoints = Array.from(samples.codePoints.subarray(start, start + length))
    const rule = runRestartAtNextLine(codePoints)
    const second = oneLoopWithARestart(codePoints)
    const asIs = runTableParserOnCodePoints(codePoints, false)
    tally.texts++
    tally.codePoints += length
    // 1. The two derivations.
    for (let position = 0; position < length; position++) {
      if (rule.displayKind[position] !== second.displayKind[position] || rule.depthAfter[position] !== second.depthAfter[position] || rule.containerAfter[position] !== second.containerAfter[position]) {
        fail(`${name}, the sample at place ${place}: at ${position} the rule shows kind ${rule.displayKind[position]}, depth ${rule.depthAfter[position]}, container ${rule.containerAfter[position]}, and the second derivation ${second.displayKind[position]}, ${second.depthAfter[position]}, ${second.containerAfter[position]}`)
        break
      }
    }
    // 2. As the parser as it is, up to the end of the line of the first error. An error at the text's end has no line after it.
    const firstError = asIs.firstErrorPosition === -1 || asIs.firstErrorPosition >= length ? length : asIs.firstErrorPosition
    let sameUntil = firstError
    while (sameUntil < length && codePoints[sameUntil] !== lineFeed) sameUntil++
    sameUntil = Math.min(sameUntil + 1, length)
    if (firstError < length) tally.withAnError++
    if (sameUntil < length) tally.withARestart++
    let different = false
    for (let position = 0; position < length; position++) {
      const same = rule.displayKind[position] === asIs.displayKind[position] && rule.depthAfter[position] === asIs.depthAfter[position] && rule.containerAfter[position] === asIs.containerAfter[position]
      if (!same && position < sameUntil) {
        fail(`${name}, the sample at place ${place}: at ${position}, before the end of the line of the first error at ${firstError}, the rule does not show what the parser as it is shows`)
        break
      }
      if (!same) different = true
    }
    if (different) tally.differentFromAsIs++
    // 3. The row "all", for the splits that the score below counts.
    if (samples.firstDamage[place] === -1 || splitNames[samples.split[place]!] === 'test') continue
    const scoredFrom = samples.firstErrorPosition[place] === -1 ? length : samples.firstErrorPosition[place]!
    let scored = 0
    let right = 0
    for (let position = scoredFrom; position < length; position++) {
      const flags = samples.flags[start + position]!
      if ((flags & codePointKept) === 0 || (flags & (codePointKindScored | codePointNestingScored)) === 0) continue
      scored++
      const kindRight = (flags & codePointKindScored) === 0 || second.displayKind[position] === samples.labelKind[start + position]
      const nestingRight = (flags & codePointNestingScored) === 0 || (second.depthAfter[position] === samples.labelDepth[start + position] && second.containerAfter[position] === samples.labelContainer[start + position])
      if (kindRight && nestingRight) right++
    }
    counts.samples++
    counts.codePoints += scored
    counts.allRight += right
    if (scored === 0) counts.nothingToRecover++
    else if (right === scored) counts.wholeSamples++
  }
  const row = scoreRestartAtNextLine(samples, {splits: ['train', 'validation']}).rows[0]!
  for (const field of ['samples', 'nothingToRecover', 'codePoints', 'allRight', 'wholeSamples'] as const) {
    if (row[field] !== counts[field]) fail(`${name}: the row "all" of the rule's score has ${field} ${row[field]}, and the second count ${counts[field]}`)
  }
  if (tally.withARestart === 0 || tally.differentFromAsIs === 0) fail(`${name}: no text in which the rule starts anew, so the check shows nothing`)
  if (failures === failuresBefore) {
    console.log(`${name}: ${tally.texts} texts with ${tally.codePoints} code points. The rule and the second derivation show the same at every code point. ${tally.withAnError} texts have an error before their end, ${tally.withARestart} have a line after it, and in ${tally.differentFromAsIs} the rule shows something else than the parser as it is, never before the end of the line of the first error.`)
    console.log(`  The row "all": ${counts.allRight} of ${counts.codePoints} scored code points right (${(100 * counts.allRight / counts.codePoints).toFixed(2)}%), ${counts.wholeSamples} of ${counts.samples - counts.nothingToRecover} samples whole, as the second count has them.`)
  }
}

checkSet('The check set', checkSamples(4000))
if (datasetExists()) checkSet(`The dataset's samples 0 to ${datasetSamples - 1} outside the test split`, makeSamples(standardRange().seed, 0, datasetSamples))
else console.log('The dataset ../samples.ts is not there, so the check ran on the check set alone.')

// 4. The example of restart-at-next-line.ts.
{
  const text = 'port: 80\n[tls]\non = true\n'
  const codePoints = Array.from(text, character => character.codePointAt(0)!)
  const asIs = runTableParserOnCodePoints(codePoints, false)
  const rule = runRestartAtNextLine(codePoints)
  const name = [0, 1, 2].map(offset => text.indexOf('tls') + offset)
  const last = codePoints.length - 1
  if (asIs.firstErrorPosition !== text.indexOf(':')) fail(`the example: the first error is at ${asIs.firstErrorPosition}, not at the colon`)
  if (name.some(position => asIs.displayKind[position] === displayKind.headerName || asIs.depthAfter[position] !== 1)) fail('the example: the parser as it is does not show the name of the header as something else at depth 1')
  if (name.some(position => rule.displayKind[position] !== displayKind.headerName || rule.depthAfter[position] !== 0)) fail('the example: the rule does not show the name of the header as one, at depth 0')
  if (rule.displayKind[text.indexOf('on')] !== displayKind.key || rule.depthAfter[last] !== 0) fail('the example: the rule does not show the entry after the header as an entry at depth 0')
  if (grammarStateNames[asIs.grammarAfter[last]!] !== 'error') fail('the example: the parser as it is leaves the grammar state `error` after its first error')
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
