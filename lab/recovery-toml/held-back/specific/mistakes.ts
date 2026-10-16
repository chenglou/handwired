// The kinds of mistakes that people make in TOML, and how one or two of them come together in one text. It is
// lab/recovery-parser/damage.ts for this held-back set.
//
// A kind is a function from a random source and a valid document to edits, or to nothing when the document has no
// place for the mistake. The kinds live in mistakes/, one file per family.
import {type Edit, mergeEdits} from '../../edits.ts'
import type {Random} from '../../random.ts'
import type {Scan} from './scan.ts'
import {aroundKinds} from './mistakes/around.ts'
import {bracketKinds} from './mistakes/brackets.ts'
import {otherLanguageKinds} from './mistakes/other-languages.ts'
import {quoteKinds} from './mistakes/quotes.ts'
import {separatorKinds} from './mistakes/separators.ts'
import {type KindDefinition, type Mistake, type Reachable, leastReachable} from './mistakes/types.ts'
import {valueKinds} from './mistakes/values.ts'

export const kinds: readonly KindDefinition[] = [...separatorKinds, ...quoteKinds, ...bracketKinds, ...valueKinds, ...otherLanguageKinds, ...aroundKinds]
const kindByName = new Map(kinds.map(kind => [kind.name, kind]))
export function kindNamed(name: string): KindDefinition {
  const kind = kindByName.get(name)
  if (kind === undefined) throw new Error(`no kind of mistake is named ${name}`)
  return kind
}

// The mistakes of one sample, already merged.
export type PlannedMistakes = {
  kinds: string[]
  forms: string[]
  edits: Edit[]
  reachable: Reachable
  unscoredKinds: number[]
  needsClass: string[]
  debatable: boolean
}

// Whether the edits of two mistakes sit apart: something other than white space stands between them, and they are on
// different lines or at least 8 code points from each other. Two mistakes that touch are one mistake of another kind,
// e.g. a missing closing quote right before a missing closing bracket.
function sitApart(scanned: Scan, left: readonly Edit[], right: readonly Edit[]) {
  const {codePoints} = scanned
  const isWhitespace = (character: string) => character === ' ' || character === '\t' || character === '\n' || character === '\r'
  for (const first of left) {
    for (const second of right) {
      const [early, late] = first.at <= second.at ? [first, second] : [second, first]
      const between = codePoints.slice(early.at + early.remove, late.at)
      if (between.every(isWhitespace) || (between.length < 8 && !between.includes('\n'))) return false
    }
  }
  return true
}

// Applies one or two kinds to the same document and merges their edits. Returns undefined when the document has no
// place for one of them, or when the two do not sit apart.
export function applyKinds(random: Random, scanned: Scan, names: readonly string[]): PlannedMistakes | undefined {
  const parts: Mistake[] = []
  for (const name of names) {
    const mistake = kindNamed(name).apply(random, scanned)
    if (mistake === undefined || mistake.edits.length === 0) return undefined
    if (parts.some(part => !sitApart(scanned, part.edits, mistake.edits))) return undefined
    parts.push(mistake)
  }
  const edits = mergeEdits(parts.map(part => part.edits), scanned.codePoints.length)
  if (edits === undefined) return undefined
  return {
    kinds: [...names], forms: parts.map((part, index) => `${names[index]!}: ${part.form}`), edits,
    reachable: leastReachable(parts.map(part => part.reachable)),
    unscoredKinds: [...new Set(parts.flatMap(part => part.unscoredKinds ?? []))].sort((left, right) => left - right),
    needsClass: [...new Set(parts.flatMap(part => part.needsClass === undefined ? [] : [part.needsClass]))],
    debatable: parts.some(part => part.debatable === true),
  }
}

// Two samples in three have one mistake, and the others have two of different kinds.
export const twoMistakesShare = 1 / 3

// The kinds of a sample: one by its weight, and for a sample with two mistakes a second one among the kinds that can
// share a text.
export function drawKinds(random: Random): string[] {
  const first = random.weighted(kinds.map(kind => [kind, kind.weight] as const))
  if (first.pairs === false || !random.chance(twoMistakesShare)) return [first.name]
  const others = kinds.filter(kind => kind.pairs !== false && kind.name !== first.name)
  return [first.name, random.weighted(others.map(kind => [kind.name, kind.weight] as const))]
}

export type {KindDefinition, Mistake, Reachable}
export {families, type Family} from './mistakes/types.ts'
