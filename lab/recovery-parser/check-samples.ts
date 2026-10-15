// A second derivation of what a sample holds, which shares no code with the dataset: its own JSON parser, its own
// application of the edits, its own first damage and its own reading of the rules about what is not scored. It
// takes from the dataset only the sample and labelsOf, to have something to compare with, and from the highlighter its
// plain JavaScript reference.
//
// Run from the repo root: bun lab/recovery-parser/check-samples.ts [samples, default 40000] [seed] [first index]
// invariants.test.ts runs it on a few thousand samples, and on samples that it spoils on purpose.
import {highlightReference} from '../../tests/json-search/highlighter/reference.ts'
import {type Sample, defaultSeed, labelsOf, sampleAt} from './samples.ts'

const kindOf = {whitespace: 0, punctuation: 1, string: 2, escape: 3, number: 4, literal: 5, key: 8} as const
const containerOf = {none: 0, object: 1, array: 2} as const
type OwnLabel = {kind: number, depth: number, container: number}

const isDigit = (character: string | undefined) => character !== undefined && character >= '0' && character <= '9'
const isSpace = (character: string | undefined) => character === ' ' || character === '\t' || character === '\n' || character === '\r'

// The labels of a text that is exactly one JSON value with optional white space around it, by a recursive descent
// parser with a stack. Throws on any other text.
export function ownLabels(text: string): OwnLabel[] {
  const codePoints = Array.from(text)
  const labels: OwnLabel[] = []
  const stack: number[] = []
  let index = 0
  const fail = (what: string): never => {
    throw new Error(`${what} at ${index} in ${JSON.stringify(text.slice(0, 80))}`)
  }
  const put = (kind: number) => {
    labels.push({kind, depth: stack.length, container: stack.at(-1) ?? containerOf.none})
    index++
  }
  const space = () => {
    while (isSpace(codePoints[index])) put(kindOf.whitespace)
  }
  const string = (kind: number) => {
    put(kind)
    for (;;) {
      const character = codePoints[index]
      if (character === undefined) return fail('the text ends inside a string')
      if (character === '"') return put(kind)
      if (character === '\\') {
        put(kindOf.escape)
        const escaped = codePoints[index]
        if (escaped === 'u') {
          put(kindOf.escape)
          for (let digit = 0; digit < 4; digit++) {
            if (!/^[0-9a-fA-F]$/.test(codePoints[index] ?? '')) fail('a \\u escape without four hexadecimal digits')
            put(kindOf.escape)
          }
        } else if (escaped !== undefined && '"\\/bfnrt'.includes(escaped)) put(kindOf.escape)
        else fail('an escape that JSON does not have')
      } else if (character.codePointAt(0)! < 0x20) fail('a control character inside a string')
      else put(kind)
    }
  }
  const digits = (what: string) => {
    if (!isDigit(codePoints[index])) fail(what)
    while (isDigit(codePoints[index])) put(kindOf.number)
  }
  const number = () => {
    if (codePoints[index] === '-') put(kindOf.number)
    if (codePoints[index] === '0') {
      put(kindOf.number)
      if (isDigit(codePoints[index])) fail('a digit after a leading zero')
    } else digits('a number without a digit')
    if (codePoints[index] === '.') {
      put(kindOf.number)
      digits('no digit after the decimal point')
    }
    if (codePoints[index] === 'e' || codePoints[index] === 'E') {
      put(kindOf.number)
      if (codePoints[index] === '+' || codePoints[index] === '-') put(kindOf.number)
      digits('no digit in the exponent')
    }
  }
  const value = () => {
    const character = codePoints[index]
    if (character === '{' || character === '[') {
      const isObject = character === '{'
      const closer = isObject ? '}' : ']'
      stack.push(isObject ? containerOf.object : containerOf.array)
      put(kindOf.punctuation)
      space()
      if (codePoints[index] !== closer) {
        for (;;) {
          if (isObject) {
            if (codePoints[index] !== '"') fail('a key was expected')
            string(kindOf.key)
            space()
            if (codePoints[index] !== ':') fail('a colon was expected')
            put(kindOf.punctuation)
            space()
          }
          value()
          space()
          if (codePoints[index] !== ',') break
          put(kindOf.punctuation)
          space()
        }
        if (codePoints[index] !== closer) fail('a comma or a closing bracket was expected')
      }
      stack.pop()
      put(kindOf.punctuation)
    } else if (character === '"') string(kindOf.string)
    else if (character === '-' || isDigit(character)) number()
    else {
      const word = character === 't' ? 'true' : character === 'f' ? 'false' : character === 'n' ? 'null' : fail('a value was expected')
      for (const letter of word) {
        if (codePoints[index] !== letter) fail(`a literal that is not ${word}`)
        put(kindOf.literal)
      }
    }
  }
  space()
  value()
  space()
  if (index !== codePoints.length) fail('text after the value')
  return labels
}

// The depth and the innermost container after each of the first `upTo` code points of a text that is read as JSON
// from the left with a stack. It means something up to the text's first error.
function ownNesting(codePoints: readonly string[], upTo: number) {
  const depth: number[] = []
  const container: number[] = []
  const stack: number[] = []
  let inString = false
  let escaped = false
  for (let index = 0; index < upTo; index++) {
    const character = codePoints[index]!
    if (escaped) escaped = false
    else if (inString) {
      if (character === '\\') escaped = true
      else if (character === '"') inString = false
    } else if (character === '"') inString = true
    else if (character === '{') stack.push(containerOf.object)
    else if (character === '[') stack.push(containerOf.array)
    else if (character === '}' || character === ']') stack.pop()
    depth.push(stack.length)
    container.push(stack.at(-1) ?? containerOf.none)
  }
  return {depth, container}
}

// How many code points of a text from `position` on are one JSON number or one literal or the start of one, e.g. 3 for
// `0.2.0`, 2 for `1.`, 1 for `test`, 4 for `nullable` and 0 for `production`.
function ownNumberOrLiteralStart(codePoints: readonly string[], position: number): number {
  for (const word of ['true', 'false', 'null']) {
    let length = 0
    while (length < word.length && codePoints[position + length] === word[length]) length++
    if (length > 0) return length
  }
  // The places in a number: after the minus sign, after a leading zero, in the integer part, after the point, in the
  // fraction, after the e, after the exponent's sign, in the exponent.
  let place: 'start' | 'minus' | 'zero' | 'integer' | 'point' | 'fraction' | 'e' | 'sign' | 'exponent' = 'start'
  let index = position
  for (; index < codePoints.length; index++) {
    const character = codePoints[index]!
    const digit = isDigit(character)
    if (place === 'start' && character === '-') place = 'minus'
    else if ((place === 'start' || place === 'minus') && digit) place = character === '0' ? 'zero' : 'integer'
    else if (place === 'integer' && digit) place = 'integer'
    else if ((place === 'zero' || place === 'integer') && character === '.') place = 'point'
    else if ((place === 'point' || place === 'fraction') && digit) place = 'fraction'
    else if ((place === 'zero' || place === 'integer' || place === 'fraction') && (character === 'e' || character === 'E')) place = 'e'
    else if (place === 'e' && (character === '+' || character === '-')) place = 'sign'
    else if ((place === 'e' || place === 'sign' || place === 'exponent') && digit) place = 'exponent'
    else break
  }
  return index - position
}

// What is wrong with a sample, as sentences, or an empty list.
export function sampleProblems(sample: Sample): string[] {
  const problems: string[] = []
  const original = Array.from(sample.original)
  const broken = Array.from(sample.broken)

  // The documents: joined they are the original, and each is one valid JSON text.
  if (sample.documents.join('') !== sample.original) problems.push('the documents joined are not the original')
  let labels: OwnLabel[] = []
  const documentStarts: number[] = []
  for (const document of sample.documents) {
    documentStarts.push(labels.length)
    try {
      JSON.parse(document)
      labels = labels.concat(ownLabels(document))
    } catch (error) {
      return [...problems, `a document is not valid JSON: ${(error as Error).message}`]
    }
    if (highlightReference(document).valid !== 1) problems.push('the reference highlighter rejects a document')
  }
  if (original.length > 512 || broken.length > 512) problems.push('a text is longer than 512 code points')
  if (labels.some(label => label.depth > 16)) problems.push('the original nests deeper than 16 levels')

  // The edits: in text order, apart from each other, and they give the broken text.
  const ownBroken: string[] = []
  const alignment: number[] = []
  const replaced: boolean[] = []
  let position = 0
  for (const [index, edit] of sample.edits.entries()) {
    const inserted = Array.from(edit.insert)
    if (edit.at < position || edit.at + edit.remove > original.length) return [...problems, `edit ${index} overlaps the edit before it or leaves the original`]
    if (edit.oneForOne === true && inserted.length !== edit.remove) problems.push(`edit ${index} replaces one for one and has two lengths`)
    for (; position < edit.at; position++) {
      ownBroken.push(original[position]!)
      alignment.push(position)
      replaced.push(false)
    }
    inserted.forEach((character, offset) => {
      ownBroken.push(character)
      alignment.push(edit.oneForOne === true ? edit.at + offset : -1)
      replaced.push(edit.oneForOne === true && character !== original[edit.at + offset])
    })
    position = edit.at + edit.remove
    // The canonical form: an edit that only removes or only inserts cannot move one code point to the right and
    // leave the broken text the same, unless it would run into the next edit.
    const limit = sample.edits[index + 1]?.at ?? original.length
    if (edit.oneForOne !== true && edit.insert === '' && edit.remove > 0 && edit.at + edit.remove < limit && original[edit.at + edit.remove] === original[edit.at]) problems.push(`the removal at ${edit.at} could start one code point later`)
    // Text before the whole original is the exception: it stays there, unless it is one code point, once or repeated.
    // So the first edit is never such a text with its first code points taken for the original's, e.g. the prefix
    // `2026-06-19 … - ` before `20142` as `26-06-19 … - 20` added after a kept `20`.
    const oneCodePoint = inserted.every(character => character === inserted[0])
    if (edit.remove === 0 && edit.insert !== '' && edit.at < limit && original[edit.at] === inserted[0] && (edit.at > 0 || oneCodePoint)) problems.push(`the insertion at ${edit.at} could sit one code point later`)
    if (index === 0 && edit.remove === 0 && edit.at > 0 && edit.at <= inserted.length && !oneCodePoint && inserted.slice(inserted.length - edit.at).join('') === original.slice(0, edit.at).join('')) {
      problems.push(`the insertion at ${edit.at} is text that stands before the whole original, with its first code points taken for the original's`)
    }
  }
  for (; position < original.length; position++) {
    ownBroken.push(original[position]!)
    alignment.push(position)
    replaced.push(false)
  }
  if (ownBroken.join('') !== sample.broken) problems.push('the edits do not give the broken text')
  if (alignment.length !== sample.alignment.length || alignment.some((index, at) => index !== sample.alignment[at])) problems.push('the alignment is not what the edits give')
  if (replaced.some((flag, at) => flag !== sample.replaced[at])) problems.push('the replaced flags are not what the edits give')
  let previous = -1
  alignment.forEach((index, at) => {
    if (index === -1) return
    if (index <= previous) problems.push(`the alignment does not rise at ${at}`)
    previous = index
    if (!replaced[at] && broken[at] !== original[index]) problems.push(`the kept code point at ${at} differs from its counterpart`)
  })

  const datasetLabels = labelsOf(sample)
  if (datasetLabels.length !== broken.length) return [...problems, 'labelsOf does not return one entry per code point']
  if (sample.source === 'valid') {
    if (sample.broken !== sample.original || sample.edits.length > 0 || sample.firstDamage !== -1 || sample.firstErrorPosition !== -1) problems.push('a valid sample is damaged')
    datasetLabels.forEach((label, at) => {
      const own = labels[at]!
      if (label === undefined || label.kind !== own.kind || label.depth !== own.depth || label.container !== own.container) problems.push(`the label at ${at} of a valid sample is not the text's own`)
    })
    return problems
  }

  // The first damage: the first added or replaced code point, the first kept one after a removed part, the first one of
  // a second document, or the length when only the end is missing.
  let firstDamage = -1
  let expected = 0
  for (let at = 0; at < broken.length && firstDamage === -1; at++) {
    const index = alignment[at]!
    if (index === -1 || replaced[at] === true || index !== expected || (documentStarts.length > 1 && index >= documentStarts[1]!)) firstDamage = at
    expected = index + 1
  }
  if (firstDamage === -1 && broken.length < original.length) firstDamage = broken.length
  if (firstDamage !== sample.firstDamage) problems.push(`the first damage is ${sample.firstDamage}, and the edits say ${firstDamage}`)

  // The parser as it is: it rejects the broken text, as JSON.parse does, at the sample's first error, never before the damage.
  const reference = highlightReference(sample.broken)
  let parses = true
  try {
    JSON.parse(sample.broken)
  } catch {
    parses = false
  }
  if (parses || reference.valid !== 0) problems.push('the broken text is not rejected')
  if (reference.firstErrorPosition !== sample.firstErrorPosition || reference.firstErrorKind !== sample.firstErrorKind) problems.push('the first error is not the reference highlighter\'s')
  if (reference.firstErrorPosition < firstDamage) problems.push('the first error comes before the first damage')

  // What is not scored. Before the first error, a value that the parser as it is does not give. And from a code point
  // that is not a bracket and whose depth or container differs from the kept code point before it, up to the next
  // kept bracket, the depth and the container.
  const errorAt = Math.min(reference.firstErrorPosition, broken.length)
  const read = ownNesting(broken, errorAt)
  const unscoredKinds = new Set(sample.unscoredKinds)
  const unscoredNesting = new Set(sample.unscoredNesting)
  const kept = new Set(alignment)
  for (const index of [...unscoredKinds, ...unscoredNesting]) if (!kept.has(index)) problems.push(`the code point ${index} of the original is listed as not scored and is not in the broken text`)
  let afterRemovedBracket = false
  let before: OwnLabel = {kind: kindOf.whitespace, depth: 0, container: containerOf.none}
  alignment.forEach((index, at) => {
    const label = datasetLabels[at]
    if (index === -1) {
      if (label !== undefined) problems.push(`the added code point at ${at} has a label`)
      return
    }
    const own = labels[index]!
    if (label === undefined) return void problems.push(`the kept code point at ${at} has no label`)
    const isBracket = own.kind === kindOf.punctuation && '{}[]'.includes(original[index]!)
    if (isBracket) afterRemovedBracket = false
    else if (own.depth !== before.depth || own.container !== before.container) afterRemovedBracket = true
    before = own
    const frozen = at < errorAt
    const nestingReadable = !frozen || (own.depth === read.depth[at] && own.container === read.container[at])
    const kindReadable = !frozen || own.kind === reference.displayKinds[at]
    if (at < firstDamage && (!nestingReadable || !kindReadable || unscoredKinds.has(index) || unscoredNesting.has(index))) problems.push(`before the first damage, the parser as it is does not give the label at ${at}, or the label is not scored`)
    // The depth and the container are scored together, and exactly when both rules allow it.
    if ((label.depth === undefined) !== (label.container === undefined)) problems.push(`the depth and the container at ${at} are not scored together`)
    if ((label.depth === undefined) !== unscoredNesting.has(index)) problems.push(`the depth at ${at} is scored or not against the sample's list`)
    if (unscoredNesting.has(index) !== (afterRemovedBracket || !nestingReadable)) problems.push(`the depth and the container at ${at} are ${unscoredNesting.has(index) ? 'not ' : ''}scored against the two rules`)
    if (label.depth !== undefined && (label.depth !== own.depth || label.container !== own.container)) problems.push(`the depth or the container at ${at} is not its counterpart's`)
    // The display kind is not scored where the parser as it is cannot give it, and where the kind of damage says so.
    if ((label.kind === undefined) !== unscoredKinds.has(index)) problems.push(`the display kind at ${at} is scored or not against the sample's list`)
    if (!kindReadable && !unscoredKinds.has(index)) problems.push(`the display kind at ${at}, before the first error, is scored and is not what the parser as it is gives`)
    if (label.kind !== undefined && label.kind !== own.kind) problems.push(`the display kind at ${at} is not its counterpart's`)
  })

  // A string value without its opening quote, after white space or punctuation: the code points at its start that read
  // as a number or a literal are not scored, e.g. the 0.2 of `version: 0.2.0`. The code point before the value counts
  // as white space or punctuation by its label when it is kept, and by what it is when the damage added it.
  alignment.forEach((index, at) => {
    if (index <= 0 || labels[index]!.kind !== kindOf.string) return
    const quote = labels[index - 1]!
    if (original[index - 1] !== '"' || quote.kind !== kindOf.string || kept.has(index - 1)) return
    if (at > 0) {
      const before = alignment[at - 1]!
      const added = broken[at - 1]!
      if (before === -1 && !isSpace(added) && !'{}[]:,'.includes(added)) return
      if (before !== -1 && (unscoredKinds.has(before) || (labels[before]!.kind !== kindOf.whitespace && labels[before]!.kind !== kindOf.punctuation))) return
    }
    const length = ownNumberOrLiteralStart(broken, at)
    for (let offset = 0; offset < length && alignment[at + offset] === index + offset && labels[index + offset]!.kind === kindOf.string; offset++) {
      if (!unscoredKinds.has(index + offset)) problems.push(`the display kind at ${at + offset} is scored as a string, and the code point starts a value without quotes that reads as a number or a literal there`)
    }
  })
  return problems
}

// The tokens of a valid document, one letter each: the brackets, the colon and the comma as they are, s for a string
// and n for a number or a literal, e.g. {s:n,s:[n,s]}. A string becomes a lone quote first, so that no letter of a
// literal is taken for one.
const ownSequence = (document: string) => document.replace(/"(?:[^"\\]|\\.)*"/gs, '"').replace(/[^\s{}[\]:,"]+/g, 'n').replace(/"/g, 's').replace(/\s+/g, '')

if (import.meta.main) {
  const sampleCount = Number(process.argv[2] ?? 40_000)
  const seed = Number(process.argv[3] ?? defaultSeed)
  const first = Number(process.argv[4] ?? 0)
  let failed = 0
  let labelsCompared = 0
  const splitOfOriginal = new Map<string, string>()
  const splitOfSequence = new Map<string, string>()
  for (let index = first; index < first + sampleCount; index++) {
    const sample = sampleAt(seed, index)
    const problems = sampleProblems(sample)
    const earlier = splitOfOriginal.get(sample.original)
    if (earlier !== undefined && earlier !== sample.split) problems.push('the same original is in two splits')
    splitOfOriginal.set(sample.original, sample.split)
    // No sequence of more than one token is in two splits, with each record of a text of several documents taken as
    // a document.
    for (const document of sample.documents) {
      const sequence = ownSequence(document)
      if (sequence.length === 1) continue
      const known = splitOfSequence.get(sequence)
      if (known !== undefined && known !== sample.split) problems.push(`a document with the tokens ${sequence.slice(0, 60)} is in the ${sample.split} split, and one with the same tokens was in the ${known} split`)
      splitOfSequence.set(sequence, sample.split)
    }
    if (sample.heldOut.length > 0 && sample.split !== 'test') problems.push('a held-out sample is outside the test split')
    labelsCompared += sample.alignment.filter(counterpart => counterpart !== -1).length
    if (problems.length === 0) continue
    failed++
    if (failed <= 20) console.log(`${sample.id} (${sample.kinds.join(', ')}): ${problems.slice(0, 4).join('; ')}\n  ${JSON.stringify(sample.broken.slice(0, 160))}`)
  }
  console.log(`${sampleCount} samples of seed ${seed} from index ${first}, ${labelsCompared} labels: ${failed === 0 ? 'the second derivation agrees on every one' : `${failed} samples differ`}`)
  if (failed > 0) process.exitCode = 1
}
