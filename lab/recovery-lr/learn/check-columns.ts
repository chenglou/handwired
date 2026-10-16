// Checks the columns of columns.ts:
// 1. Programs by hand, where a person can say which definitions the damage did not touch: the code points of
//    those definitions, and no others, are marked.
// 2. On train and validation samples: every marked code point is scored and stands in the original where the
//    broken text has it, the columns' "all three" and "whole" are the score's, the parts add up, and a whole
//    sample has every token right.
// 3. One repair is known for a whole set: a `#` between two tokens of a valid program is to be skipped. With
//    tables that skip it, every sample is whole and has every token right, and all three near the damage is 100%.
// 4. A parser that shows every token as the labels of its first kept code point want it is wrong only where one
//    token holds two labels: its samples with every token right are the samples in which no token that is no white
//    space holds two labels, counted a second way.
// 5. samplesAhead on rows by hand.
//
// Run from the repo root: bun lab/recovery-lr/learn/check-columns.ts
import {defaultSeed, loadSamples, programAt} from '../dataset.ts'
import {createRandom} from '../random.ts'
import {type Sample, alignmentOfTexts, makeSample} from '../sample.ts'
import {isTrivia} from '../tables.ts'
import {skipTables} from './bars.ts'
import {columnsOfOutputs, samplesAhead, sharesOfColumns, untouchedLaterDefinitions} from './columns.ts'
import {runRecoveryParserOnTokens} from './recovery-parser.ts'
import {badCharacter, baseTables, choiceSkip, stateCount} from './recovery-tables.ts'
import {type ParserOutput, outputOfRun, scoreOutputs} from './score.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 30) console.log(`PROBLEM: ${text}`)
}
const make = (original: string, broken: string): Sample => {
  const sample = makeSample({id: broken, original, broken, alignment: alignmentOfTexts(original, broken)})
  if (typeof sample === 'string') throw new Error(`${JSON.stringify(broken)} is no sample: ${sample}`)
  return sample
}

// 1. Programs by hand. `untouched` is the text of the broken program that is expected to be marked.
{
  const three = 'let a = (1 + 2)\nlet b = a * 2\n(* note *)\nlet c = b\n'
  const cases: {what: string, original: string, broken: string, untouched: string}[] = [
    {what: 'a bracket lost in the first definition: the error is at the second `let`, so the second definition is the recovery and the third is untouched', original: three, broken: three.replace('2)', '2'), untouched: 'let c = b\n'},
    {what: 'a stray token in the first definition: both later definitions are untouched, with the comment between them', original: three, broken: three.replace('(1 +', '(1 + )'), untouched: 'let b = a * 2\n(* note *)\nlet c = b\n'},
    {what: 'damage in the second definition: the first stands before the error and the third is untouched', original: three, broken: three.replace('a * 2', 'a * * 2'), untouched: 'let c = b\n'},
    {what: 'a letter glued to the `let` of the third definition: it is no token `let`, so nothing is untouched', original: three, broken: three.replace('(1 +', '(1 + )').replace('\nlet c', '\nxlet c'), untouched: 'let b = a * 2\n(* note *)\n'},
    {what: 'a letter glued to the end of the last definition', original: 'let a = (1 + 2)\nlet b = a', broken: 'let a = (1 + ) 2)\nlet b = ax', untouched: ''},
    {what: 'a local `let` is no definition at the top', original: 'let a = 1 +\n  2\nlet b =\n  let c = 3 in\n  c\n', broken: 'let a = 1 + +\n  2\nlet b =\n  let c = 3 in\n  c\n', untouched: 'let b =\n  let c = 3 in\n  c\n'},
  ]
  for (const {what, original, broken, untouched} of cases) {
    const sample = make(original, broken)
    const marked = untouchedLaterDefinitions(sample)
    const text = Array.from(sample.codePoints, (codePoint, position) => marked[position] === 1 ? String.fromCodePoint(codePoint) : '').join('')
    if (text !== untouched) problem(`${what}: marked ${JSON.stringify(text)}, expected ${JSON.stringify(untouched)}`)
  }
  console.log(`1. ${cases.length} programs by hand: the later definitions that the damage did not touch are marked, and nothing else.`)
}

const samples = [...loadSamples('train', defaultSeed, 1500), ...loadSamples('validation', defaultSeed, 700)]
const base = baseTables()
const asItIs = (sample: Sample): ParserOutput => outputOfRun(runRecoveryParserOnTokens(sample.codePoints, sample.tokens, base))
// Tables that skip every rejected token: a second parser for the checks, with some code points right.
const skipping = skipTables()
const bySkipping = (sample: Sample): ParserOutput => outputOfRun(runRecoveryParserOnTokens(sample.codePoints, sample.tokens, skipping))

// 2. Samples of the dataset.
{
  let marked = 0
  for (const sample of samples) {
    const untouched = untouchedLaterDefinitions(sample)
    let first = -1
    for (let position = 0; position < untouched.length; position++) {
      if (untouched[position] === 0) {
        first = -1
        continue
      }
      marked++
      if (position <= sample.firstErrorPosition || sample.alignment[position] === -1) problem(`sample ${sample.id}: the code point ${position} is marked and not scored`)
      // Side by side: inside a marked run the places in the original rise by one.
      if (first !== -1 && sample.alignment[position] !== sample.alignment[position - 1]! + 1) problem(`sample ${sample.id}: the marked code points around ${position} do not stand side by side in the original`)
      first = position
    }
  }
  for (const [name, parse] of [['the parser as it is', asItIs], ['skip every rejected token', bySkipping]] as const) {
    const score = scoreOutputs(samples, parse)
    const {columns, rightPerSample} = columnsOfOutputs(samples, parse)
    if (columns.samples !== score.samples || columns.scoredCodePoints !== score.scoredCodePoints || columns.allThreeRight !== score.allThreeRight || columns.wholeSamples !== score.wholeSamples) problem(`${name}: the columns count ${JSON.stringify(columns)} and the score ${JSON.stringify(score)}`)
    if (rightPerSample.reduce((sum, right) => sum + right, 0) !== score.allThreeRight) problem(`${name}: the code points right per sample do not add up to the score's`)
    if (columns.scoredNearDamage !== columns.scoredCodePoints - marked) problem(`${name}: ${columns.scoredNearDamage} scored code points near the damage, and ${columns.scoredCodePoints} - ${marked} are not marked`)
    if (columns.rightNearDamage > columns.allThreeRight || columns.allThreeRight - columns.rightNearDamage > marked) problem(`${name}: the code points right near the damage and the ones right in all do not fit`)
    if (columns.samplesWithEveryTokenRight < columns.wholeSamples) problem(`${name}: fewer samples with every token right than whole samples`)
  }
  console.log(`2. ${samples.length} samples: ${marked} code points stand in later definitions that the damage did not touch, each of them scored and side by side with its neighbours in the original. For two parsers the columns' all three and whole are the score's, and the parts add up.`)
}

// 3. A `#` to skip.
{
  const tables = baseTables()
  for (let state = 0; state < stateCount; state++) tables.choice[state * tables.terminalCount + badCharacter] = choiceSkip
  const withHash: Sample[] = []
  for (let index = 0; withHash.length < 400; index++) {
    const {text, labels} = programAt(defaultSeed, index)
    const random = createRandom(733, index)
    const real = Array.from({length: labels.tokens.count}, (_, token) => token).filter(token => !isTrivia(labels.tokens.kind[token]!))
    if (real.length < 2) continue
    const at = labels.tokens.start[real[random.integer(1, real.length - 1)]!]!
    const broken = `${text.slice(0, at)}# ${text.slice(at)}`
    const sample = makeSample({id: `hash:${index}`, original: text, broken, alignment: alignmentOfTexts(text, broken)}, labels)
    if (typeof sample !== 'string') withHash.push(sample)
  }
  const {columns} = columnsOfOutputs(withHash, sample => outputOfRun(runRecoveryParserOnTokens(sample.codePoints, sample.tokens, tables)))
  const shares = sharesOfColumns(columns)
  if (columns.wholeSamples !== withHash.length || columns.samplesWithEveryTokenRight !== withHash.length || columns.rightNearDamage !== columns.scoredNearDamage) problem(`with the # skipped, ${columns.wholeSamples} of ${withHash.length} samples are whole and ${columns.samplesWithEveryTokenRight} have every token right`)
  console.log(`3. ${withHash.length} programs with a # between two tokens, and tables that skip it: every sample is whole and has every token right. ${shares.shareNearDamage.toFixed(1)}% of their scored code points are near the damage.`)
}

// 4. A parser that shows every token as the labels of its first kept code point want it.
{
  const byFirstLabel = (sample: Sample): ParserOutput => {
    const {tokens} = sample
    const kind = new Int8Array(tokens.count).fill(-1), depth = new Int16Array(tokens.count).fill(-1), container = new Int8Array(tokens.count).fill(-1)
    for (let token = 0; token < tokens.count; token++) {
      for (let place = tokens.start[token]!; place < tokens.start[token]! + tokens.length[token]!; place++) {
        if (sample.alignment[place] === -1) continue
        kind[token] = sample.labelKind[place]!
        depth[token] = sample.labelDepth[place]!
        container[token] = sample.labelContainer[place]!
        break
      }
    }
    return {kind, depth, container, stack: new Int32Array(tokens.count), taken: new Uint8Array(tokens.count), reductions: [], insertedTokens: 0}
  }
  // Counted a second way: the samples in which every token that is no white space and no comment has one label
  // at all of its scored code points.
  let expected = 0
  for (const sample of samples) {
    let oneLabelPerToken = true
    for (let token = sample.firstErrorToken; token < sample.tokens.count && oneLabelPerToken; token++) {
      if (isTrivia(sample.tokens.kind[token]!)) continue
      const labels = new Set<number>()
      for (let place = sample.tokens.start[token]!; place < sample.tokens.start[token]! + sample.tokens.length[token]!; place++) {
        if (sample.alignment[place] !== -1) labels.add((sample.labelKind[place]! * 1024 + sample.labelDepth[place]!) * 16 + sample.labelContainer[place]!)
      }
      if (labels.size > 1) oneLabelPerToken = false
    }
    if (oneLabelPerToken) expected++
  }
  const {columns} = columnsOfOutputs(samples, byFirstLabel)
  if (columns.samplesWithEveryTokenRight !== expected) problem(`the parser of the labels has every token right in ${columns.samplesWithEveryTokenRight} samples, and ${expected} samples have one label per token`)
  console.log(`4. A parser that shows every token as its first kept code point wants: every token right in ${columns.samplesWithEveryTokenRight} of ${samples.length} samples, which are the samples with one label per token, and ${columns.wholeSamples} whole.`)
}

// 5. Two rows by hand.
{
  const ahead = samplesAhead([3, 5, 5, 0], [4, 5, 2, 0])
  if (ahead.leftAhead !== 1 || ahead.rightAhead !== 1 || ahead.level !== 2) problem(`samplesAhead counts ${JSON.stringify(ahead)}`)
  console.log('5. samplesAhead counts the samples in which each of two rows has more right.')
}

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
