// Columns for the final table next to the main numbers of score.ts. A review of the foundation asked for them,
// because "all three" and "whole" alone hide three things:
// - More than half of the scored code points stand in a later definition that the damage did not touch, e.g. the
//   third definition of a program whose first one lost a bracket. Any recovery that finds the next `let` has those
//   right. So "all three" is also given over the other scored code points, the ones near the damage.
// - White space keeps the label of the original, and after added text no table can show it, e.g. the line break
//   after a `)` too many wants the bracket still open. So next to "whole" stand the samples with every token
//   right: the ones in which every scored code point of a token that is no white space and no comment has all
//   three right.
// - A string or a comment that the damage left open is one token for the scanner, over text that had several
//   labels, and a table has one display kind for the whole token. So the scored code points inside such tokens
//   are counted apart.
// The columns are read off a parser's output, like the scores of scoreOutputs, so every row of the final table can
// have them: a table through outputOfRun, a bar through its own function.
//
//   bun lab/recovery-lr/learn/columns.ts [--tables <file.json>] [--split train|validation] [--count <samples>]
// prints the columns of the parser as it is, of panic mode without knowledge of the language, and of the tables.
import {defaultSeed, loadSamples} from '../dataset.ts'
import {type ValidLabels, containerNames, displayKind, labelsOfValidText} from '../labels.ts'
import type {Sample} from '../sample.ts'
import {isTrivia, symbolOf} from '../tables.ts'
import {kindsOfDroppedTokensByCount, panicMode} from './bars.ts'
import {numberOf, optionOf, refuseUnknownOptions, standardValidationCount} from './options.ts'
import {runRecoveryParserOnTokens} from './recovery-parser.ts'
import {baseTables, bisonTerminalCount, loadTablesForReport} from './recovery-tables.ts'
import {type ParserOutput, outputOfRun} from './score.ts'

const letTerminal = symbolOf('LET'), openString = symbolOf('BADSTRING'), openComment = symbolOf('BADCOMMENT')
const letContainer = containerNames.indexOf('let')

// Per code point of a sample's broken text: 1 when it stands in a later definition that the damage did not touch.
// - A definition is a definition at the top of the original: from its `let` up to the `let` of the next one, or to
//   the end of the text, so the white space and the comments after it are part of it.
// - The damage did not touch it when all of its code points are kept and stand side by side in the broken text,
//   its `let` is a token of its own there, and no token of the broken text reaches over its end, e.g. no added
//   letter is glued to its last name.
// - It is a later one when it starts after the first error's position. A definition whose `let` is the first
//   error's token is not one: what the parser does at that `let` is the recovery.
// Every such code point is scored.
export function untouchedLaterDefinitions(sample: Sample, originalLabels: ValidLabels = labelsOfValidText(sample.original)): Uint8Array {
  const {tokens: originalTokens} = originalLabels
  const starts: number[] = []
  for (let token = 0; token < originalTokens.count; token++) {
    const start = originalTokens.start[token]!
    if (originalTokens.kind[token] === letTerminal && originalLabels.depth[start] === 1 && originalLabels.container[start] === letContainer) starts.push(start)
  }
  const placeInBroken = new Int32Array(originalLabels.codePoints.length).fill(-1)
  for (let position = 0; position < sample.alignment.length; position++) if (sample.alignment[position] !== -1) placeInBroken[sample.alignment[position]!] = position
  // The kind of the token of the broken text that starts at a code point, -1 where no token starts.
  const kindOfTokenAt = new Int32Array(sample.codePoints.length + 1).fill(-1)
  for (let token = 0; token < sample.tokens.count; token++) kindOfTokenAt[sample.tokens.start[token]!] = sample.tokens.kind[token]!
  const untouched = new Uint8Array(sample.codePoints.length)
  for (let index = 0; index < starts.length; index++) {
    const from = starts[index]!, to = index + 1 < starts.length ? starts[index + 1]! : originalLabels.codePoints.length
    const first = placeInBroken[from]!
    if (first === -1 || first <= sample.firstErrorPosition || kindOfTokenAt[first] !== letTerminal) continue
    const end = first + to - from
    if (end < sample.codePoints.length && kindOfTokenAt[end] === -1) continue
    let sideBySide = true
    for (let place = from; place < to && sideBySide; place++) sideBySide = placeInBroken[place] === first + place - from
    if (sideBySide) untouched.fill(1, first, end)
  }
  return untouched
}

const untouchedOfSample = new WeakMap<Sample, Uint8Array>()
function cachedUntouched(sample: Sample): Uint8Array {
  let untouched = untouchedOfSample.get(sample)
  if (untouched === undefined) {
    untouched = untouchedLaterDefinitions(sample)
    untouchedOfSample.set(sample, untouched)
  }
  return untouched
}

// The counts of the columns, as whole numbers, so that two sets add up.
export type Columns = {
  samples: number
  scoredCodePoints: number
  allThreeRight: number
  wholeSamples: number
  // The scored code points outside the later definitions that the damage did not touch, and the ones of them with
  // all three right.
  scoredNearDamage: number
  rightNearDamage: number
  // The samples in which every scored code point of a token that is no white space and no comment has all three
  // right. A whole sample is one of them.
  samplesWithEveryTokenRight: number
  // The scored code points inside a token that is an open string, and inside one that is an open comment, and the
  // ones of them with all three right.
  scoredInOpenStrings: number
  rightInOpenStrings: number
  scoredInOpenComments: number
  rightInOpenComments: number
}
export const emptyColumns = (): Columns => ({
  samples: 0, scoredCodePoints: 0, allThreeRight: 0, wholeSamples: 0, scoredNearDamage: 0, rightNearDamage: 0, samplesWithEveryTokenRight: 0,
  scoredInOpenStrings: 0, rightInOpenStrings: 0, scoredInOpenComments: 0, rightInOpenComments: 0,
})

// Adds one sample to the columns, from a parser's output, and returns the sample's scored code points with all
// three right.
export function addOutputToColumns(columns: Columns, sample: Sample, output: ParserOutput): number {
  const {tokens} = sample
  const untouched = cachedUntouched(sample)
  let allThreeRight = 0, everyTokenRight = true
  for (let token = sample.firstErrorToken; token < tokens.count; token++) {
    const terminal = tokens.kind[token]!
    for (let place = tokens.start[token]!; place < tokens.start[token]! + tokens.length[token]!; place++) {
      if (sample.alignment[place] === -1) continue
      const right = output.kind[token] === sample.labelKind[place] && output.depth[token] === sample.labelDepth[place] && output.container[token] === sample.labelContainer[place]
      if (right) allThreeRight++
      else if (!isTrivia(terminal)) everyTokenRight = false
      if (untouched[place] === 0) {
        columns.scoredNearDamage++
        if (right) columns.rightNearDamage++
      }
      if (terminal === openString) {
        columns.scoredInOpenStrings++
        if (right) columns.rightInOpenStrings++
      } else if (terminal === openComment) {
        columns.scoredInOpenComments++
        if (right) columns.rightInOpenComments++
      }
    }
  }
  columns.samples++
  columns.scoredCodePoints += sample.scored
  columns.allThreeRight += allThreeRight
  if (allThreeRight === sample.scored) columns.wholeSamples++
  if (everyTokenRight) columns.samplesWithEveryTokenRight++
  return allThreeRight
}

// The columns of any parser on samples, and per sample its scored code points with all three right, for
// samplesAhead.
export function columnsOfOutputs(samples: readonly Sample[], parse: (sample: Sample) => ParserOutput): {columns: Columns, rightPerSample: Int32Array} {
  const columns = emptyColumns()
  const rightPerSample = new Int32Array(samples.length)
  samples.forEach((sample, index) => { rightPerSample[index] = addOutputToColumns(columns, sample, parse(sample)) })
  return {columns, rightPerSample}
}

// For two rows on the same samples: in how many samples each row has more scored code points right than the
// other. On a small set, e.g. 200 written cases, one point of "all three" is two or three cases, and this count
// says whether a difference of the two rows is a few long cases or many.
export function samplesAhead(left: ArrayLike<number>, right: ArrayLike<number>): {leftAhead: number, rightAhead: number, level: number} {
  if (left.length !== right.length) throw new Error('the two rows are of other samples')
  let leftAhead = 0, rightAhead = 0
  for (let sample = 0; sample < left.length; sample++) {
    if (left[sample]! > right[sample]!) leftAhead++
    else if (right[sample]! > left[sample]!) rightAhead++
  }
  return {leftAhead, rightAhead, level: left.length - leftAhead - rightAhead}
}

// The columns as percentages.
export function sharesOfColumns(columns: Columns) {
  const share = (count: number, of: number): number => of === 0 ? NaN : 100 * count / of
  return {
    allThree: share(columns.allThreeRight, columns.scoredCodePoints), whole: share(columns.wholeSamples, columns.samples),
    nearDamage: share(columns.rightNearDamage, columns.scoredNearDamage), shareNearDamage: share(columns.scoredNearDamage, columns.scoredCodePoints),
    everyTokenRight: share(columns.samplesWithEveryTokenRight, columns.samples),
    inOpenStrings: share(columns.rightInOpenStrings, columns.scoredInOpenStrings), inOpenComments: share(columns.rightInOpenComments, columns.scoredInOpenComments),
  }
}

// The columns as one row of a markdown table, and the header that names them.
export const columnsHeader = '| parser | all three | whole | every token right | all three near the damage | all three inside open strings | all three inside open comments |\n| --- | --- | --- | --- | --- | --- | --- |'
export function columnsRow(name: string, columns: Columns): string {
  const shares = sharesOfColumns(columns)
  const number = (value: number): string => Number.isNaN(value) ? 'none' : value.toFixed(2)
  return `| ${name} | ${number(shares.allThree)} | ${number(shares.whole)} | ${number(shares.everyTokenRight)} | ${number(shares.nearDamage)} | ${number(shares.inOpenStrings)} | ${number(shares.inOpenComments)} |`
}
// What stands under such a table: how many of the scored code points each column is about.
export function describeColumns(columns: Columns): string {
  const share = (count: number): string => `${count} (${(100 * count / Math.max(1, columns.scoredCodePoints)).toFixed(1)}%)`
  return `${columns.samples} samples with ${columns.scoredCodePoints} scored code points. Near the damage, i.e. outside the later definitions that the damage did not touch: ${share(columns.scoredNearDamage)}. Inside open strings: ${share(columns.scoredInOpenStrings)}. Inside open comments: ${share(columns.scoredInOpenComments)}.`
}

if (import.meta.main) {
  refuseUnknownOptions('columns.ts', ['--tables', '--split', '--count'])
  const split = optionOf('--split') ?? 'validation'
  if (split !== 'train' && split !== 'validation') throw new Error(`--split is train or validation, and got ${split}`)
  const samples = loadSamples(split, defaultSeed, numberOf('--count', standardValidationCount))
  const tablesFile = optionOf('--tables')
  const base = baseTables()
  const errors = new Int8Array(bisonTerminalCount).fill(displayKind.error)
  const rows: [string, (sample: Sample) => ParserOutput][] = [
    ['the parser as it is', sample => outputOfRun(runRecoveryParserOnTokens(sample.codePoints, sample.tokens, base))],
    ['panic mode without knowledge of the language, dropped tokens shown as errors', sample => panicMode(sample, errors)],
  ]
  if (split === 'validation') {
    const counted = kindsOfDroppedTokensByCount(loadSamples('train', defaultSeed, 5000), panicMode)
    rows.push(['panic mode without knowledge of the language, with the count on 5,000 train samples', sample => panicMode(sample, counted)])
  }
  if (tablesFile !== undefined) {
    const {tables} = loadTablesForReport(tablesFile)
    rows.push([`the tables of ${tablesFile}`, sample => outputOfRun(runRecoveryParserOnTokens(sample.codePoints, sample.tokens, tables))])
  }
  console.log(`The ${split} split:`)
  console.log(columnsHeader)
  let last = emptyColumns()
  for (const [name, parse] of rows) {
    last = columnsOfOutputs(samples, parse).columns
    console.log(columnsRow(name, last))
  }
  console.log(describeColumns(last))
}
