// Valid JSON deeper than 16 levels, as report.ts and check.ts of the arm read it. The highlighter rejects such a
// text at its 17th opening bracket, and from there on the text reads open cells and open display entries, so tables
// may show the rest of it otherwise than today. No sample is so deep, so no score sees it.
//
// - `tooDeepForms` are the texts that the arm counts on, in four forms. Three are chains of nested containers with
//   members on one side: the two forms of ../../check-deep.ts, and those texts with a line feed after every
//   bracket, comma and colon. The fourth, `tooDeepTextsOfAnyShape`, has members and small containers on both sides
//   of every nested container, 17 to 30 levels, and four layouts. Only the fourth holds texts on which the
//   hand-written tables lose the depth, e.g. `{"a": {"a": []}, "b": 1}` inside 14 objects.
// - `kindsOfValidText` says what every code point of a valid text is, since the reference highlighter gives no
//   display kinds for a text that it rejects.
// - `countsOnTooDeepTexts` counts the wrong depths and the wrong display kinds of some tables on such texts.
import {displayKind, scanNesting} from '../../../labels.ts'
import {type Random, createRandom} from '../../../random.ts'
import {deepTexts, deepTextsWithMembersAfter} from '../../check-deep.ts'
import {standardRange} from '../../data.ts'
import {capacity, codePointsOf, createTrace, maximumDepth, runRecoveryParserInto, runRecoveryParserOnText} from '../../recovery-parser.ts'
import {type RecoveryTables, asIsTables, checkTables, eventNames} from '../../recovery-tables.ts'

// A valid JSON text with a line feed after every bracket, comma and colon, so that the next token is the first on
// its line: what the texts of ../../check-deep.ts lack. The tokenizer's events say which characters are such
// punctuation and not part of a string.
const punctuationEvents = new Set((['openObject', 'openArray', 'closeObject', 'closeArray', 'colon', 'comma'] as const).map(name => eventNames.indexOf(name)))
export function spreadOverLines(validText: string): string {
  const trace = runRecoveryParserOnText(validText, asIsTables())
  return Array.from(validText, (character, position) => punctuationEvents.has(trace.event[position]!) ? `${character}\n` : character).join('')
}

// What a string of the fourth form is made of: letters, digits, JSON's punctuation, escapes, and the code points
// that the arm's added classes take out of the class `other`, e.g. the apostrophe and U+FEFF.
const stringPieces = [
  'a', 'e', 'f', 'm', 'n', 't', 'u', 'x', 'Z', '0', '7', ' ', '-', '.', '{', '}', '[', ']', ':', ',', 'é', '東', '😀',
  '\'', '(', ')', ' ', '“', '”', '=', '#', ';', '&', '`', '*', '﻿', '…',
  '\\"', '\\\\', '\\/', '\\n', '\\t', '\\u00e9', '\\uD83D\\uDE00',
]
const numbers = ['0', '-0', '7', '-12', '3.25', '1e5', '1E-7', '2.5e+10']
const stringOf = (random: Random) => `"${Array.from({length: random.integer(0, 3)}, () => random.pick(stringPieces)).join('')}"`
function scalarOf(random: Random): string {
  const choice = random.next()
  return choice < 0.4 ? stringOf(random) : choice < 0.7 ? random.pick(numbers) : random.pick(['true', 'false', 'null'])
}

// A JSON value as a tree, so that its layout is chosen after its shape: the text of a scalar, or a container with
// its members.
type Value = string | {isObject: boolean, members: Value[]}

// A member beside a nested container: a scalar, or in one case of four a small container of its own, empty or with
// one or two scalars.
const memberBeside = (random: Random): Value =>
  random.chance(0.75) ? scalarOf(random) : {isObject: random.chance(0.5), members: Array.from({length: random.integer(0, 2)}, () => scalarOf(random))}

// `levels` nested containers, each with up to two members before the next container and up to two after it.
function nestedContainers(random: Random, levels: number, kinds: 'arrays' | 'objects' | 'both'): Value {
  const isObject = kinds === 'objects' || (kinds === 'both' && random.chance(0.5))
  const membersBeside = () => Array.from({length: random.weighted([[0, 6], [1, 3], [2, 1]])}, () => memberBeside(random))
  const before = membersBeside()
  const inside = levels === 1 ? [] : [nestedContainers(random, levels - 1, kinds)]
  return {isObject, members: [...before, ...inside, ...membersBeside()]}
}

const layouts = ['compact', 'spaced', 'a member per line', 'a member per line, with carriage returns'] as const
function textOf(value: Value, layout: typeof layouts[number], random: Random): string {
  if (typeof value === 'string') return value
  const lineEnd = layout === 'a member per line' ? '\n' : layout === 'a member per line, with carriage returns' ? '\r\n' : ''
  const members = value.members.map(member => `${value.isObject ? `${stringOf(random)}:${layout === 'compact' ? '' : ' '}` : ''}${textOf(member, layout, random)}`)
  const inside = members.length === 0 ? '' : `${lineEnd}${members.join(layout === 'spaced' ? ', ' : `,${lineEnd}`)}${lineEnd}`
  return value.isObject ? `{${inside}}` : `[${inside}]`
}

// `count` valid JSON texts of 17 to 30 levels and at most 512 code points, the same ones on every call: nested
// containers of one kind or of both, with members and small containers before and after each, in one of four
// layouts.
export function tooDeepTextsOfAnyShape(count: number): string[] {
  const random = createRandom(standardRange.seed, 29)
  const texts: string[] = []
  while (texts.length < count) {
    const value = nestedContainers(random, maximumDepth + random.integer(1, 14), random.pick(['arrays', 'objects', 'both', 'both'] as const))
    const text = textOf(value, random.pick(layouts), random)
    if (Array.from(text).length > capacity) continue
    JSON.parse(text)
    texts.push(text)
  }
  return texts
}

export const tooDeepForms: readonly {name: string, texts: readonly string[]}[] = [
  {name: 'nothing after the nested containers', texts: deepTexts(300)},
  {name: 'members after them', texts: deepTextsWithMembersAfter(300)},
  {name: 'those texts with a line feed after every bracket, comma and colon', texts: [...deepTexts(300), ...deepTextsWithMembersAfter(300)].map(spreadOverLines).filter(text => Array.from(text).length <= capacity)},
  {name: 'members and small containers before and after, 17 to 30 levels', texts: tooDeepTextsOfAnyShape(2000)},
]

// The display kind of every code point of a valid JSON text: a string is a key where its container is an object
// that expects a key, a number or a literal runs up to the next white space or punctuation mark, and an escape is
// two code points or the six of \uXXXX. check.ts compares it with the reference highlighter on texts that the
// reference accepts.
export function kindsOfValidText(text: string): number[] {
  const codePoints = Array.from(text)
  const kinds: number[] = []
  const openContainers: {isObject: boolean, keyComesNext: boolean}[] = []
  let at = 0
  while (at < codePoints.length) {
    const character = codePoints[at]!
    const innermost = openContainers.at(-1)
    if (' \t\n\r'.includes(character)) {
      kinds.push(displayKind.whitespace)
      at++
    } else if ('{}[]:,'.includes(character)) {
      kinds.push(displayKind.punctuation)
      at++
      if (character === '{' || character === '[') openContainers.push({isObject: character === '{', keyComesNext: character === '{'})
      else if (character === '}' || character === ']') openContainers.pop()
      else if (innermost !== undefined) innermost.keyComesNext = character === ',' && innermost.isObject
    } else if (character === '"') {
      const kind = innermost?.keyComesNext === true ? displayKind.key : displayKind.string
      kinds.push(kind)
      at++
      while (codePoints[at] !== '"') {
        const length = codePoints[at] !== '\\' ? 1 : codePoints[at + 1] === 'u' ? 6 : 2
        for (let step = 0; step < length; step++) kinds.push(length === 1 ? kind : displayKind.escape)
        at += length
      }
      kinds.push(kind)
      at++
    } else {
      const kind = 'tfn'.includes(character) ? displayKind.literal : displayKind.number
      for (; at < codePoints.length && !' \t\n\r{}[]:,"'.includes(codePoints[at]!); at++) kinds.push(kind)
    }
  }
  return kinds
}

// Over the code points of too deep valid texts from the first error on: how many there are, at how many the depth
// that `tables` give is not the one that the brackets give, at how many the display kind is not what the code point
// is, and at how many it is not what today's tables show. Today's tables have no wrong depth, and show every key
// after the first error as a string.
export function countsOnTooDeepTexts(tables: RecoveryTables, texts: readonly string[]) {
  checkTables(tables)
  const todaysTables = asIsTables()
  const [trace, todaysTrace] = [createTrace(), createTrace()]
  const counts = {fromFirstError: 0, wrongDepths: 0, wrongKinds: 0, kindsOtherThanTodays: 0}
  for (const text of texts) {
    const {codePoints, truncated} = codePointsOf(text)
    if (truncated) throw new Error('a text for countsOnTooDeepTexts has more than 512 code points')
    const depths = scanNesting(Array.from(text)).depth
    const kinds = kindsOfValidText(text)
    runRecoveryParserInto(trace, codePoints, 0, codePoints.length, false, tables, codePoints.length)
    runRecoveryParserInto(todaysTrace, codePoints, 0, codePoints.length, false, todaysTables, codePoints.length)
    if (trace.firstErrorPosition === -1) throw new Error(`today's parser accepts a text that should be too deep: ${JSON.stringify(text.slice(0, 80))}`)
    for (let position = trace.firstErrorPosition; position < codePoints.length; position++) {
      counts.fromFirstError++
      if (trace.depthAfter[position] !== depths[position]) counts.wrongDepths++
      if (trace.displayKind[position] !== kinds[position]) counts.wrongKinds++
      if (trace.displayKind[position] !== todaysTrace.displayKind[position]) counts.kindsOtherThanTodays++
    }
  }
  return counts
}
