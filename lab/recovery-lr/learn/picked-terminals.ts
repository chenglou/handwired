// The rule that picks code points for terminals of their own from the train samples alone: the counterpart of the
// rule that picks character classes on the JSON side (classesChosenFromTrainSamples of
// lab/recovery-parser/learn/arms/extra-facts/facts.ts), with the same two thresholds.
//
// The scanner is frozen, so the rule only looks at the tokens that the scanner reads as BADCHAR, each one code
// point that starts no token. For every such token at or after a first error it counts what the code point is:
// the kind of the original's token that holds its counterpart, e.g. AND for an `&` that is left of `&&`, STRING for
// a `!` of a string that lost its opening quote, or "added" when the damage added it. A code point gets a terminal
// when at least 100 train samples have it there and its outcomes are far from the outcomes of the other BADCHAR
// code points: a distance of 0.5 or more, i.e. half of its occurrences would have to be something else.
//
//   bun lab/recovery-lr/learn/picked-terminals.ts [--train <samples>]
import {scan} from '../parser.ts'
import type {Sample} from '../sample.ts'
import {commentKind, newlineKind, whitespaceKind} from '../tables.ts'
import {eachSample} from './data.ts'
import {numberOf, refuseUnknownOptions, standardTrainCount} from './options.ts'
import {type AddedTerminal, badCharacter, bison, bisonTerminalCount} from './recovery-tables.ts'

// The outcomes: bison's terminals by their numbers, then white space, a comment, and "added".
const outcomeWhitespace = bisonTerminalCount, outcomeComment = bisonTerminalCount + 1, outcomeAdded = bisonTerminalCount + 2
const outcomeCount = bisonTerminalCount + 3
export const outcomeName = (outcome: number): string => outcome === outcomeAdded ? 'added' : outcome === outcomeComment ? 'comment' : outcome === outcomeWhitespace ? 'white space' : bison.symbolNames[outcome]!

export type CodePointOfTheRule = {
  codePoint: number
  // How often the code point is a BADCHAR token at or after a first error, and in how many train samples.
  occurrences: number
  samples: number
  // The shares of its outcomes, and of the outcomes of the other BADCHAR code points.
  shares: number[]
  sharesOfTheRest: number[]
  // The total variation distance of the two, from 0 to 1.
  distance: number
  picked: boolean
}

// The two thresholds of the rule, as on the JSON side.
export const leastSamplesOfTheRule = 100
export const leastDistanceOfTheRule = 0.5

// Every code point that at least 100 of the samples have as a BADCHAR token at or after their first error, from
// the largest distance down.
export function codePointsOfTheRule(trainSamples: Iterable<Sample>): CodePointOfTheRule[] {
  const countsOfCodePoint = new Map<number, {outcomes: Float64Array, samples: number, lastSample: number}>()
  const countsOfAll = new Float64Array(outcomeCount)
  let sampleNumber = 0
  for (const sample of trainSamples) {
    sampleNumber++
    const {tokens} = sample
    // The kind of the original's token at every code point of the original, made when the sample has a BADCHAR.
    let originalKind: Int32Array | undefined
    for (let token = sample.firstErrorToken; token < tokens.count; token++) {
      if (tokens.kind[token] !== badCharacter) continue
      const place = tokens.start[token]!
      let outcome = outcomeAdded
      if (sample.alignment[place] !== -1) {
        if (originalKind === undefined) {
          const original = Int32Array.from(sample.original, character => character.codePointAt(0)!)
          const originalTokens = scan(original)
          originalKind = new Int32Array(original.length)
          for (let originalToken = 0; originalToken < originalTokens.count; originalToken++) originalKind.fill(originalTokens.kind[originalToken]!, originalTokens.start[originalToken], originalTokens.start[originalToken]! + originalTokens.length[originalToken]!)
        }
        const kind = originalKind[sample.alignment[place]!]!
        outcome = kind === commentKind ? outcomeComment : kind === whitespaceKind || kind === newlineKind ? outcomeWhitespace : kind
      }
      const codePoint = sample.codePoints[place]!
      let counts = countsOfCodePoint.get(codePoint)
      if (counts === undefined) {
        counts = {outcomes: new Float64Array(outcomeCount), samples: 0, lastSample: -1}
        countsOfCodePoint.set(codePoint, counts)
      }
      counts.outcomes[outcome]!++
      countsOfAll[outcome]!++
      if (counts.lastSample !== sampleNumber) {
        counts.lastSample = sampleNumber
        counts.samples++
      }
    }
  }
  const total = (counts: ArrayLike<number>): number => Array.from(counts).reduce((sum, count) => sum + count, 0)
  const result: CodePointOfTheRule[] = []
  for (const [codePoint, counts] of countsOfCodePoint) {
    if (counts.samples < leastSamplesOfTheRule) continue
    const occurrences = total(counts.outcomes)
    const rest = Array.from(countsOfAll, (count, outcome) => count - counts.outcomes[outcome]!)
    const occurrencesOfTheRest = total(rest)
    // A code point that is the only BADCHAR has nothing to be told apart from.
    if (occurrencesOfTheRest === 0) continue
    const shares = Array.from(counts.outcomes, count => count / occurrences)
    const sharesOfTheRest = rest.map(count => count / occurrencesOfTheRest)
    const distance = shares.reduce((sum, share, outcome) => sum + Math.abs(share - sharesOfTheRest[outcome]!), 0) / 2
    result.push({codePoint, occurrences, samples: counts.samples, shares, sharesOfTheRest, distance, picked: distance >= leastDistanceOfTheRule})
  }
  return result.sort((left, right) => right.distance - left.distance || left.codePoint - right.codePoint)
}

// The name of a picked code point's terminal, e.g. "U+0026".
export const terminalNameOfCodePoint = (codePoint: number): string => `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`

// The terminals that the rule picks: one per picked code point, for addTerminals of recovery-tables.ts.
export const terminalsChosenFromTrainSamples = (trainSamples: Iterable<Sample>): AddedTerminal[] =>
  codePointsOfTheRule(trainSamples).filter(entry => entry.picked).map(({codePoint}) => ({name: terminalNameOfCodePoint(codePoint), codePoint}))

if (import.meta.main) {
  refuseUnknownOptions('picked-terminals.ts', ['--train'])
  const count = numberOf('--train', standardTrainCount)
  const entries = codePointsOfTheRule(eachSample('train', count))
  console.log(`${entries.length} code points are a BADCHAR token at or after the first error in at least ${leastSamplesOfTheRule} of ${count} train samples. The rule picks ${entries.filter(entry => entry.picked).length}, with a distance of ${leastDistanceOfTheRule} or more:`)
  for (const entry of entries) {
    const largest = entry.shares.map((share, outcome) => ({share, outcome})).filter(({share}) => share >= 0.05).sort((left, right) => right.share - left.share)
    console.log(`${entry.picked ? 'picked' : '      '}  ${JSON.stringify(String.fromCodePoint(entry.codePoint)).padEnd(8)} ${terminalNameOfCodePoint(entry.codePoint)}  distance ${entry.distance.toFixed(2)}  ${String(entry.samples).padStart(5)} samples  ${largest.map(({share, outcome}) => `${outcomeName(outcome)} ${(100 * share).toFixed(0)}%`).join(', ')}`)
  }
}
