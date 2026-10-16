// Compares the table parser with the reference labeler in reference.ts and with Bun's TOML parser on many texts.
//
// 1. Valid documents, written by hand and generated: the tables and the reference give the same display kind, depth
//    and container at every code point, and the tables show every cell after the text as past the end.
// 2. Every text, valid or damaged: the tables and the reference agree on whether the text is valid.
// 3. Every text: Bun.TOML.parse agrees too, or the difference has a reason that the README lists. Where Bun rejects a
//    text that the tables accept, the reason is read from Bun's message, e.g. "Cannot redefine key". Where Bun accepts
//    a text that the tables reject, the reference is run again with one addition of TOML 1.1 or without the limits,
//    and has to accept the text then.
// 4. The first error of every invalid text: the text before the position of the first error is the start of a valid
//    text, and the tables label that start as the reference labels it. The valid text is the start with the shortest
//    ending that the tables accept, found by a search over the tables, and the reference has to accept it too. So the
//    tables report no error later than they could, and nothing before the first error is labeled otherwise than in a
//    valid text.
//
// Run from the repo root: bun lab/recovery-toml/check-table-parser.ts [valid documents, default 6000] [damaged texts, default 8000]
import {damagedText, invalidEdgeCases, validDocument, validEdgeCases} from './check-texts.ts'
import {capacity, displayKind, maximumDepth} from './kinds.ts'
import {type ReferenceOptions, labelReference} from './reference.ts'
import {
  type ParserTrace, actionPop, actionPushArray, actionPushInlineTable, classNames, containerArray, containerInlineTable, defaultTables,
  runTableParser,
} from './table-parser.ts'

// What differs between the table parser and the reference on one text, or null. On an invalid text only the verdict
// is compared: the reference labels valid texts only.
export function tableParserDifference(text: string, trace: ParserTrace = runTableParser(text)): string | null {
  const reference = labelReference(text)
  if (trace.valid !== reference.valid) return `valid: tables ${trace.valid}, reference ${reference.valid}${reference.valid ? '' : ` (${reference.reason})`}`
  if (!reference.valid) return null
  const {labels} = reference
  for (let position = 0; position < labels.length; position++) {
    const label = labels[position]!
    if (trace.displayKind[position] !== label.kind) return `display kind at ${position}: tables ${trace.displayKind[position]}, reference ${label.kind}`
    if (trace.depthAfter[position] !== label.depth) return `depth after ${position}: tables ${trace.depthAfter[position]}, reference ${label.depth}`
    if (trace.containerAfter[position] !== label.container) return `container after ${position}: tables ${trace.containerAfter[position]}, reference ${label.container}`
  }
  for (let position = labels.length; position <= capacity; position++) {
    if (trace.displayKind[position] !== displayKind.pastEnd) return `display kind at ${position}, after the text: tables ${trace.displayKind[position]}`
  }
  return null
}

// One code point per class, for the search below. The classes `end` and `truncatedEnd` have none.
export const codePointOfClass: number[] = classNames.map((_, characterClass) => defaultTables.classOfCodePoint.indexOf(characterClass, 1) - 1)

// The shortest code points that make a valid text of the first `upTo` code points of a text, which the tables have
// not rejected, or null when there are none. The search runs the tables from the state after those code points and
// never opens a container, so the open containers are always the first ones of the text's.
const completions = new Map<string, number[] | null>()
export function completionOf(codePoints: readonly number[], upTo: number): number[] | null {
  const tables = defaultTables
  const tokenCount = tables.symbolCount / tables.contextCount
  const kinds: number[] = []
  // One step of the parser. Returns the next tokenizer state, the next grammar state and the stack action.
  const step = (lexerState: number, grammarState: number, depth: number, characterClass: number) => {
    const lexerCell = lexerState * tables.classCount + characterClass
    const token = tables.grammarToken[tables.lexerEvent[lexerCell]!]!
    const context = tables.depthClass[depth]! * 2 + Number(depth >= 1 && kinds[depth - 1] === containerInlineTable)
    const cell = (grammarState * tokenCount + token) * tables.contextCount + context
    return {lexerAfter: tables.lexerNext[lexerCell]!, grammarAfter: tables.grammarNext[cell]!, action: tables.grammarAction[cell]!}
  }
  let lexerState = 0
  let grammarState = 0
  for (let position = 0; position < upTo; position++) {
    const characterClass = tables.classOfCodePoint[Math.min(codePoints[position]! + 1, tables.classOfCodePoint.length - 1)]!
    const {lexerAfter, grammarAfter, action} = step(lexerState, grammarState, kinds.length, characterClass)
    if (grammarAfter === tables.errorState) throw new Error('completionOf got a text with an error before the given position')
    if (action === actionPushArray || action === actionPushInlineTable) kinds.push(action === actionPushArray ? containerArray : containerInlineTable)
    else if (action === actionPop) kinds.pop()
    lexerState = lexerAfter
    grammarState = grammarAfter
  }
  const key = `${lexerState} ${grammarState} ${kinds.join('')}`
  const known = completions.get(key)
  if (known !== undefined) return known
  // Breadth first over (tokenizer state, grammar state, depth).
  type Reached = {lexerState: number, grammarState: number, depth: number, from: Reached | null, codePoint: number}
  const queue: Reached[] = [{lexerState, grammarState, depth: kinds.length, from: null, codePoint: -1}]
  const seen = new Set<number>([(lexerState * tables.grammarStateCount + grammarState) * (maximumDepth + 1) + kinds.length])
  let completion: number[] | null = null
  for (let head = 0; head < queue.length; head++) {
    const reached = queue[head]!
    // The text may end here when the class `end` leads to no error.
    if (step(reached.lexerState, reached.grammarState, reached.depth, 0).grammarAfter !== tables.errorState) {
      completion = []
      for (let at = reached; at.from !== null; at = at.from) completion.unshift(at.codePoint)
      break
    }
    for (let characterClass = 2; characterClass < tables.classCount; characterClass++) {
      const {lexerAfter, grammarAfter, action} = step(reached.lexerState, reached.grammarState, reached.depth, characterClass)
      if (grammarAfter === tables.errorState || action === actionPushArray || action === actionPushInlineTable) continue
      const depth = action === actionPop ? reached.depth - 1 : reached.depth
      const configuration = (lexerAfter * tables.grammarStateCount + grammarAfter) * (maximumDepth + 1) + depth
      if (seen.has(configuration)) continue
      seen.add(configuration)
      queue.push({lexerState: lexerAfter, grammarState: grammarAfter, depth, from: reached, codePoint: codePointOfClass[characterClass]!})
    }
  }
  completions.set(key, completion)
  return completion
}

// Checks the first error of an invalid text, see the top of this file. Returns what is wrong, or 'checked', or
// 'too long' when the valid text would have more than 512 code points and so would not be valid.
function firstErrorResult(text: string, trace: ParserTrace): string {
  const codePoints = Array.from(text, character => character.codePointAt(0)!)
  const errorPosition = trace.firstErrorPosition
  const completion = completionOf(codePoints, errorPosition)
  if (completion === null) return 'no ending makes the text before the first error valid'
  if (errorPosition + completion.length > capacity) return 'too long'
  const completed = String.fromCodePoint(...codePoints.slice(0, errorPosition), ...completion)
  const reference = labelReference(completed)
  if (!reference.valid) return `the reference rejects ${JSON.stringify(completed)} (${reference.reason})`
  for (let position = 0; position < errorPosition; position++) {
    const label = reference.labels[position]!
    if (trace.displayKind[position] !== label.kind || trace.depthAfter[position] !== label.depth || trace.containerAfter[position] !== label.container) {
      return `the label at ${position} is not the one of ${JSON.stringify(completed)}`
    }
  }
  return 'checked'
}

export function bunResult(text: string): {accepted: true} | {accepted: false, message: string} {
  try {
    Bun.TOML.parse(text)
    return {accepted: true}
  } catch (error) {
    return {accepted: false, message: error instanceof Error ? error.message : String(error)}
  }
}

// Why Bun rejects a text that the tables accept, from Bun's message, or null. Each reason is on the README's list of
// what the tables do not check.
export function reasonOfRejection(message: string): string | null {
  if (/Cannot (redefine|extend)/.test(message)) return 'a key or a table is defined twice'
  if (/Invalid (date|time|date-time offset): .*(must be between|is out of range)/.test(message)) return 'a number inside a date or a time is out of its range'
  if (message.includes('Escaped code point must be a Unicode scalar value')) return 'an escape names no Unicode scalar value'
  if (/Integer (is outside the 64-bit signed range|cannot be losslessly represented)/.test(message)) return 'an integer is too large for Bun'
  return null
}

// Why Bun accepts a text that the tables reject, or null: the reference accepts the text with one addition of TOML
// 1.1, or without the limits of 512 code points and depth 16, or without a byte order mark at its start.
const additionsOfToml11: readonly (readonly [option: ReferenceOptions, reason: string])[] = [
  [{linesInInlineTable: true}, 'TOML 1.1: a line end or a comment inside an inline table'],
  [{commaBeforeCloseBrace: true}, 'TOML 1.1: a comma before the } of an inline table'],
  [{timeWithoutSeconds: true}, 'TOML 1.1: a time without seconds'],
  [{moreEscapes: true}, 'TOML 1.1: the escapes \\e and \\xHH'],
  [{linesInInlineTable: true, commaBeforeCloseBrace: true, timeWithoutSeconds: true, moreEscapes: true}, 'TOML 1.1: several of its additions'],
]
export function reasonOfAcceptance(text: string): string | null {
  if (labelReference(text, {withoutLimits: true}).valid) return 'the limits: more than 512 code points, or nested deeper than 16'
  for (const [option, reason] of additionsOfToml11) if (labelReference(text, option).valid) return reason
  if (text.startsWith('﻿') && labelReference(text.slice(1)).valid) return 'a byte order mark at the start'
  return null
}

if (import.meta.main) {
  const documentCount = Number(process.argv[2] ?? 6000)
  const damagedCount = Number(process.argv[3] ?? 8000)
  const failures: string[] = []
  const fail = (what: string, text: string) => {
    failures.push(what)
    if (failures.length <= 20) console.log(`FAILED: ${what}\n  ${JSON.stringify(text)}`)
  }
  // Every difference between the tables and Bun, by its reason, with one example.
  const differences = new Map<string, {count: number, example: string}>()
  const compareWithBun = (text: string, valid: boolean) => {
    const bun = bunResult(text)
    if (bun.accepted === valid) return true
    const reason = bun.accepted ? reasonOfAcceptance(text) : reasonOfRejection(bun.message)
    if (reason === null) {
      fail(bun.accepted ? 'Bun accepts a text that the tables reject, and no reason is found' : `Bun rejects a text that the tables accept: ${bun.message}`, text)
      return false
    }
    const name = `${bun.accepted ? 'the tables reject, Bun accepts' : 'the tables accept, Bun rejects'}: ${reason}`
    const entry = differences.get(name) ?? {count: 0, example: text}
    entry.count++
    // The shortest example is the clearest.
    if (text.length < entry.example.length) entry.example = text
    differences.set(name, entry)
    return false
  }
  const printDifferences = () => {
    for (const [name, {count, example}] of [...differences].sort((left, right) => right[1].count - left[1].count)) {
      console.log(`    ${count.toLocaleString('en-US')} ${name}, e.g. ${JSON.stringify(example.length > 90 ? `${example.slice(0, 90)}…` : example)}`)
    }
    differences.clear()
  }

  // 1. Valid documents.
  const documents = [...validEdgeCases, ...Array.from({length: documentCount}, (_, index) => validDocument(20261016 + index))]
  let codePointsCompared = 0
  let agreedWithBun = 0
  for (const text of documents) {
    const trace = runTableParser(text)
    if (!trace.valid) fail(`the tables reject a document that is meant to be valid, at ${trace.firstErrorPosition}`, text)
    const difference = tableParserDifference(text, trace)
    if (difference !== null) fail(difference, text)
    codePointsCompared += trace.length
    if (compareWithBun(text, trace.valid)) agreedWithBun++
  }
  console.log(`${documents.length.toLocaleString('en-US')} valid documents, ${validEdgeCases.length} written by hand and ${documentCount.toLocaleString('en-US')} generated, with ${codePointsCompared.toLocaleString('en-US')} code points`)
  console.log(`  ${failures.length === 0 ? 'the tables accept every one, and give the reference\'s display kind, depth and container at every code point' : `${failures.length} failures`}`)
  console.log(`  Bun.TOML.parse accepts ${agreedWithBun.toLocaleString('en-US')}${agreedWithBun === documents.length ? ', every one' : ', and the others differ for these reasons:'}`)
  printDifferences()

  // 2 to 4. Damaged texts.
  const failuresBefore = failures.length
  const damaged = [...invalidEdgeCases, ...Array.from({length: damagedCount}, (_, index) => damagedText(documents[validEdgeCases.length + index % documentCount]!, 77_000 + index))]
  let stillValid = 0
  let sameAsBun = 0
  let firstErrorsChecked = 0
  let firstErrorsTooLong = 0
  for (const text of damaged) {
    const trace = runTableParser(text)
    const difference = tableParserDifference(text, trace)
    if (difference !== null) fail(difference, text)
    if (compareWithBun(text, trace.valid)) sameAsBun++
    if (trace.valid) {
      stillValid++
      continue
    }
    const result = firstErrorResult(text, trace)
    if (result === 'checked') firstErrorsChecked++
    else if (result === 'too long') firstErrorsTooLong++
    else fail(`first error at ${trace.firstErrorPosition}: ${result}`, text)
  }
  const invalid = damaged.length - stillValid
  console.log(`${damaged.length.toLocaleString('en-US')} damaged texts, ${invalidEdgeCases.length} written by hand and ${damagedCount.toLocaleString('en-US')} random edits of the documents: ${invalid.toLocaleString('en-US')} invalid and ${stillValid.toLocaleString('en-US')} still valid for the tables`)
  console.log(`  ${failures.length === failuresBefore ? 'the tables and the reference agree on valid or invalid for every one, and at every code point of the valid ones' : `${failures.length - failuresBefore} failures`}`)
  console.log(`  Bun.TOML.parse agrees on ${sameAsBun.toLocaleString('en-US')}${sameAsBun === damaged.length ? ', every one' : ', and the others differ for these reasons:'}`)
  printDifferences()
  console.log(`  first errors: of the ${invalid.toLocaleString('en-US')} invalid texts, ${firstErrorsChecked.toLocaleString('en-US')} have a valid text that starts like the text before the first error, with the same labels there`)
  console.log(`    ${firstErrorsTooLong.toLocaleString('en-US')} are not checked: the valid text would have more than ${capacity} code points`)
  console.log(failures.length === 0 ? 'every check passed' : `${failures.length} failures`)
  if (failures.length > 0) process.exitCode = 1
}
