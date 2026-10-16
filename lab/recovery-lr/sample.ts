// A sample: a broken text, the valid program that its author meant, and which code point of one is which code
// point of the other. makeSample is the one function that makes a sample, for the train and validation samples of
// dataset.ts and for the held-back sets alike.
//
// A code point of the broken text is one of two things:
// - kept: it is a code point of the original, and has that code point's labels.
// - added: it has no counterpart. Its alignment is -1, it has no label, and no score counts it. A code point that
//   stands in the place of another one is added too, e.g. the `;` of `(1; 2)` for `(1, 2)`: nothing here says that
//   the two play the same part, as ' for " does on the JSON side.
// The kept code points are in the same order in both texts. Where two readings give the same broken text, the
// sample takes the one that keeps the earlier code point, as lab/recovery-parser/edits.ts does: of `))` with one
// bracket removed, the bracket that is left is the first one, and of `xx` for `x`, the second `x` is the added one.
//
// Scores count the kept code points from the first error's token on, all of them: no label is left out as "not
// scored", as some are on the JSON side.
import {type ValidLabels, labelsOfValidText} from './labels.ts'
import {type Tokens, codePointsOf, maximumCodePoints, parse, scan} from './parser.ts'
import {isTrivia, tables} from './tables.ts'

export type Sample = {
  // A name that is unique in the sample's set, e.g. "20261016:1234".
  id: string
  // What made the broken text, for reports, e.g. ['delete a run', 'swap two code points'].
  edits: string[]
  // The valid program that the author meant, and the broken text.
  original: string
  broken: string
  // The code points of the broken text, at most 512.
  codePoints: Int32Array
  // Per code point of the broken text: the place of its counterpart in the original's code points, -1 for an added
  // code point. The places of the kept code points rise.
  alignment: Int32Array
  // The broken text as the scanner cuts it, white space and comments included. The scanner is frozen, so every
  // parser of the experiment reads these tokens.
  tokens: Tokens
  // The first error: the place in `tokens` of the first token that reads an open cell, which is the token at which
  // bison calls yyerror, and the code point at which that token starts. It is never the end of input: such a text
  // has nothing to score and is no sample.
  firstErrorToken: number
  firstErrorPosition: number
  // The stack of states when the parser reads that first open cell. Up to here every parser of the experiment does
  // what bison does. A parser that recovers goes on from this stack and the token firstErrorToken.
  startStack: number[]
  // The labels, per code point of the broken text: the display kind, the depth, the container and the hash of the
  // symbols on the stack, as the original has them at the counterpart, see labels.ts. -1 for an added code point
  // in the first three, and 0 in labelStack, which is no mark: use the alignment to tell.
  labelKind: Int8Array
  labelDepth: Int16Array
  labelContainer: Int8Array
  labelStack: Int32Array
  // How many code points a score counts: the kept ones from firstErrorPosition on. At least 1.
  scored: number
  // Per token of the broken text: the place of the original's token that it is, or -1. A token is a kept token when
  // its code points are exactly the code points of one token of the original, e.g. not the `xy` that is left of
  // `x y`. White space and comments have -1.
  keptToken: Int32Array
  // The original's constituents, restricted to the kept tokens, as sorted keys without repeats, see constituentKey.
  // Every reduction of the original's parse gives one: the nonterminal, and the first and the last kept token that
  // it covers, as places in `tokens`. A reduction that covers no kept token gives none.
  constituents: Int32Array
}

// Whether a score counts the code point: a kept one from the first error's token on.
export const isScored = (sample: Pick<Sample, 'alignment' | 'firstErrorPosition'>, position: number): boolean => position >= sample.firstErrorPosition && sample.alignment[position] !== -1

// Why a pair of texts is no sample.
export type Refusal = 'unchanged' | 'still valid' | 'too long' | 'nothing to score'

export type SampleInput = {
  id: string
  edits?: readonly string[]
  original: string
  broken: string
  // Per code point of the broken text: the place of its counterpart in the original's code points, or -1. The
  // places must rise, and a kept code point must be the same code point as its counterpart.
  alignment: ArrayLike<number>
}

type Edit = {
  // A place in the original's code points, how many code points are removed there, and what is put there.
  at: number
  remove: number
  insert: number[]
}

// The edits that an alignment stands for, in text order: between two kept code points, the original's code points
// that are left out and the broken text's code points that are added.
function editsOf(original: ArrayLike<number>, broken: ArrayLike<number>, alignment: ArrayLike<number>): Edit[] {
  const edits: Edit[] = []
  let position = 0
  let added: number[] = []
  const close = (upTo: number) => {
    // What the removed and the added text share at their start and at their end is kept, e.g. removing `ab` and
    // adding `a` at one place is removing the `b`.
    let removeFrom = position, removeTo = upTo
    while (removeFrom < removeTo && added.length > 0 && original[removeFrom] === added[0]) {
      removeFrom++
      added.shift()
    }
    while (removeFrom < removeTo && added.length > 0 && original[removeTo - 1] === added.at(-1)) {
      removeTo--
      added.pop()
    }
    if (removeTo > removeFrom || added.length > 0) edits.push({at: removeFrom, remove: removeTo - removeFrom, insert: added})
    added = []
  }
  for (let index = 0; index < broken.length; index++) {
    const counterpart = alignment[index]!
    if (counterpart === -1) {
      added.push(broken[index]!)
      continue
    }
    if (!Number.isInteger(counterpart) || counterpart < position || counterpart >= original.length) throw new Error(`the alignment of code point ${index} is ${counterpart}: the places of the kept code points must rise and lie in the original`)
    if (original[counterpart] !== broken[index]) throw new Error(`code point ${index} of the broken text is said to be code point ${counterpart} of the original, which is another code point`)
    close(counterpart)
    position = counterpart + 1
  }
  close(original.length)
  return edits
}

// Moves every edit that only removes, and every edit that only adds, to the right as far as the broken text stays
// the same, as canonicalEdits of lab/recovery-parser/edits.ts does. Removing `ab` before another `a` gives the same
// text as removing the `ba` after the first `a`, and which of the two happened is not in the text. So a sample
// always says the later one, and the code points that a reader meets first are the kept ones.
function canonicalEdits(original: ArrayLike<number>, edits: readonly Edit[]): Edit[] {
  const moved = [...edits]
  // From the last edit to the first, so that each edit moves up to where the edit after it now is.
  for (let index = moved.length - 1; index >= 0; index--) {
    const edit = moved[index]!
    const limit = moved[index + 1]?.at ?? original.length
    if (edit.insert.length === 0) {
      let at = edit.at
      while (at + edit.remove < limit && original[at + edit.remove] === original[at]) at++
      if (at !== edit.at) moved[index] = {...edit, at}
    } else if (edit.remove === 0) {
      const insert = [...edit.insert]
      let at = edit.at
      while (at < limit && original[at] === insert[0]) {
        insert.push(insert.shift()!)
        at++
      }
      if (at !== edit.at) moved[index] = {...edit, at, insert}
    }
  }
  return moved
}

// One pass: the edits of an alignment, moved, as an alignment again.
function movedAlignment(original: ArrayLike<number>, broken: ArrayLike<number>, alignment: ArrayLike<number>): Int32Array {
  const moved = new Int32Array(broken.length)
  let index = 0
  let position = 0
  const keepUpTo = (upTo: number) => {
    for (; position < upTo; position++) moved[index++] = position
  }
  for (const edit of canonicalEdits(original, editsOf(original, broken, alignment))) {
    keepUpTo(edit.at)
    for (let added = 0; added < edit.insert.length; added++) moved[index++] = -1
    position += edit.remove
  }
  keepUpTo(original.length)
  if (index !== broken.length) throw new Error('the moved edits do not give the broken text')
  for (let at = 0; at < broken.length; at++) if (moved[at] !== -1 && original[moved[at]!] !== broken[at]) throw new Error('the moved edits do not give the broken text')
  return moved
}

// The alignment of a pair of texts in the form that samples have: of two readings that give the same broken text,
// the one that keeps the earlier code point. Throws when the alignment does not fit the two texts.
// An edit that moves can come to stand next to another one, e.g. a removed run next to an added one, and the two
// then read as one edit that keeps what they share. So the edits are moved until nothing changes: every pass keeps
// more code points or the same ones earlier.
export function canonicalAlignment(original: ArrayLike<number>, broken: ArrayLike<number>, alignment: ArrayLike<number>): Int32Array {
  if (alignment.length !== broken.length) throw new Error(`the alignment has ${alignment.length} entries and the broken text ${broken.length} code points`)
  let current = movedAlignment(original, broken, alignment)
  for (let pass = 0; pass < 1000; pass++) {
    const next = movedAlignment(original, broken, current)
    if (next.every((counterpart, index) => counterpart === current[index])) return next
    current = next
  }
  throw new Error('the alignment does not settle')
}

// An alignment for a pair of texts that comes without one, e.g. a broken program that a person wrote next to the
// program that was meant. It is a shortest edit script: it keeps as many code points as any alignment can. Among
// the scripts of that length it is one with the fewest edits, where an edit is a run of removed and added code
// points between two kept ones. Without that, a duplicated line would be read as many small additions, since
// every code point of the copy is also somewhere in the text after it.
export function alignmentOfTexts(original: string, broken: string): Int32Array {
  const from = codePointsOf(original), to = codePointsOf(broken)
  const width = to.length + 1
  // The cost of a way to turn original[0..i) into broken[0..j): 4096 per removed or added code point, and 1 per
  // edit, so that the number of edits only decides between ways with the same number of code points.
  const perCodePoint = 4096, unreachable = 0x3fffffff
  // lastKept[i × width + j] is the lowest cost of the ways whose last step kept a code point, or that made no step.
  // lastEdited is the same for the ways whose last step removed or added one.
  const lastKept = new Int32Array((from.length + 1) * width).fill(unreachable), lastEdited = new Int32Array((from.length + 1) * width).fill(unreachable)
  lastKept[0] = 0
  for (let i = 0; i <= from.length; i++) {
    for (let j = 0; j <= to.length; j++) {
      const at = i * width + j
      const best = Math.min(lastKept[at]!, lastEdited[at]!)
      if (best >= unreachable) continue
      if (i < from.length && j < to.length && from[i] === to[j]) lastKept[at + width + 1] = Math.min(lastKept[at + width + 1]!, best)
      const edited = Math.min(lastKept[at]! + 1, lastEdited[at]!) + perCodePoint
      if (i < from.length) lastEdited[at + width] = Math.min(lastEdited[at + width]!, edited)
      if (j < to.length) lastEdited[at + 1] = Math.min(lastEdited[at + 1]!, edited)
    }
  }
  // Back from the end along one of the cheapest ways.
  const alignment = new Int32Array(to.length).fill(-1)
  let i = from.length, j = to.length
  let inEdit = lastEdited[i * width + j]! <= lastKept[i * width + j]!
  while (i > 0 || j > 0) {
    const at = i * width + j
    if (!inEdit) {
      alignment[j - 1] = i - 1
      i--
      j--
      inEdit = lastEdited[i * width + j]! <= lastKept[i * width + j]!
      continue
    }
    const cost = lastEdited[at]! - perCodePoint
    // The last step added broken[j - 1] or removed original[i - 1], and went on in an edit or opened one. Where
    // both are as cheap, the added code point is the later one, so that the earlier one is kept, e.g. of `hten`
    // for `then` the h is kept and the t after it is added, as damage.ts says of a swap.
    if (j > 0 && lastEdited[at - 1] === cost) j--
    else if (i > 0 && lastEdited[at - width] === cost) i--
    else if (j > 0 && lastKept[at - 1]! + 1 === cost) {
      j--
      inEdit = false
    } else {
      i--
      inEdit = false
    }
  }
  return canonicalAlignment(from, to, alignment)
}

// A constituent as one number: nonterminal × 2^20 + first token × 2^10 + last token. A text has at most 512 tokens.
export const constituentKey = (nonterminal: number, firstToken: number, lastToken: number): number => (nonterminal * 1024 + firstToken) * 1024 + lastToken
export const constituentOfKey = (key: number): {nonterminal: number, firstToken: number, lastToken: number} => ({nonterminal: key >> 20, firstToken: (key >> 10) & 1023, lastToken: key & 1023})

// The constituents of a parse of the sample's broken text, restricted to the kept tokens, as sorted keys without
// repeats: the form of sample.constituents. A reduction is given by its nonterminal and by the first and the last
// token that it covers, as places in sample.tokens. Tokens that the parser put in itself are not in sample.tokens
// and count for nothing, and a reduction that covers no token has -1 for both places.
export function restrictedConstituents(sample: Pick<Sample, 'keptToken'>, reductions: Iterable<{nonterminal: number, firstToken: number, lastToken: number}>): Int32Array {
  const {keptToken} = sample
  const keys = new Set<number>()
  for (const {nonterminal, firstToken, lastToken} of reductions) {
    if (firstToken === -1) continue
    let first = firstToken, last = lastToken
    while (first <= last && keptToken[first] === -1) first++
    while (last >= first && keptToken[last] === -1) last--
    if (first <= last) keys.add(constituentKey(nonterminal, first, last))
  }
  return Int32Array.from(keys).sort()
}

// The two shares of the column "constituents" for a parse of the broken text, given as restrictedConstituents
// gives it: how many of the original's constituents the parse has, and how many of the parse's constituents the
// original has, each with its total.
export function constituentCounts(sample: Pick<Sample, 'constituents'>, recovered: Int32Array): {originalCount: number, recoveredCount: number, shared: number} {
  const original = new Set(sample.constituents)
  let shared = 0
  for (const key of recovered) if (original.has(key)) shared++
  return {originalCount: sample.constituents.length, recoveredCount: recovered.length, shared}
}

// Makes the sample of a broken text, or says why the pair is no sample: the texts are the same, the broken text is
// longer than 512 code points or still valid, or no kept code point is left from the first error on. Throws when
// the original is not a valid program of at most 512 code points or the alignment does not fit the texts.
// `originalLabels` are the labels of the original, for a caller that makes several samples of one program.
export function makeSample(input: SampleInput, originalLabels: ValidLabels = labelsOfValidText(input.original)): Sample | Refusal {
  const {id, original, broken} = input
  if (original === broken) return 'unchanged'
  const originalCodePoints = originalLabels.codePoints
  let place = 0
  for (const character of original) if (originalCodePoints[place++] !== character.codePointAt(0)) throw new Error('the labels are not those of the original')
  if (place !== originalCodePoints.length) throw new Error('the labels are not those of the original')
  const codePoints = codePointsOf(broken)
  if (codePoints.length > maximumCodePoints) return 'too long'
  const alignment = canonicalAlignment(originalCodePoints, codePoints, input.alignment)
  const tokens = scan(codePoints)
  const parsed = parse(tokens, codePoints.length)
  if (parsed.valid) return 'still valid'

  const labelKind = new Int8Array(codePoints.length).fill(-1), labelDepth = new Int16Array(codePoints.length).fill(-1), labelContainer = new Int8Array(codePoints.length).fill(-1)
  const labelStack = new Int32Array(codePoints.length)
  let scored = 0
  for (let index = 0; index < codePoints.length; index++) {
    const counterpart = alignment[index]!
    if (counterpart === -1) continue
    labelKind[index] = originalLabels.kind[counterpart]!
    labelDepth[index] = originalLabels.depth[counterpart]!
    labelContainer[index] = originalLabels.container[counterpart]!
    labelStack[index] = originalLabels.stack[counterpart]!
    if (index >= parsed.firstErrorPosition) scored++
  }
  if (scored === 0) return 'nothing to score'

  // The kept tokens: a token of the broken text whose code points are, in order, all the code points of one token
  // of the original. The two tokens then have the same text, so the scanner gives both the same terminal.
  const originalTokens = originalLabels.tokens
  const originalTokenAt = new Int32Array(originalCodePoints.length + 1).fill(-1)
  for (let token = 0; token < originalTokens.count; token++) originalTokenAt[originalTokens.start[token]!] = token
  const keptToken = new Int32Array(tokens.count).fill(-1)
  // brokenTokenOf[token of the original] is the token of the broken text that it is, or -1.
  const brokenTokenOf = new Int32Array(originalTokens.count).fill(-1)
  for (let token = 0; token < tokens.count; token++) {
    if (isTrivia(tokens.kind[token]!)) continue
    const start = tokens.start[token]!, length = tokens.length[token]!
    const counterpart = alignment[start]!
    if (counterpart === -1) continue
    const originalToken = originalTokenAt[counterpart]!
    if (originalToken === -1 || originalTokens.length[originalToken] !== length) continue
    let consecutive = true
    for (let offset = 1; offset < length; offset++) if (alignment[start + offset] !== counterpart + offset) consecutive = false
    if (!consecutive) continue
    if (originalTokens.kind[originalToken] !== tokens.kind[token]) throw new Error('a kept token has another terminal than its counterpart')
    keptToken[token] = originalToken
    brokenTokenOf[originalToken] = token
  }
  // The original's constituents in the places of the broken text's tokens: of the tokens that a reduction covers,
  // the first and the last one that are kept.
  const keys = new Set<number>()
  for (let reduction = 0; reduction < originalLabels.reductionCount; reduction++) {
    let first = originalLabels.reductionFirstToken[reduction]!, last = originalLabels.reductionLastToken[reduction]!
    if (first === -1) continue
    while (first <= last && brokenTokenOf[first] === -1) first++
    while (last >= first && brokenTokenOf[last] === -1) last--
    if (first <= last) keys.add(constituentKey(tables.ruleLhs[originalLabels.reductionRule[reduction]!]!, brokenTokenOf[first]!, brokenTokenOf[last]!))
  }

  return {
    id, edits: [...(input.edits ?? [])], original, broken, codePoints, alignment, tokens,
    firstErrorToken: parsed.firstErrorToken, firstErrorPosition: parsed.firstErrorPosition, startStack: parsed.stack,
    labelKind, labelDepth, labelContainer, labelStack, scored, keptToken, constituents: Int32Array.from(keys).sort(),
  }
}
