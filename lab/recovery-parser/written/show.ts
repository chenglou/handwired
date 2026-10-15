// Prints a written case in the fixed-width form of dump.ts, so that every code point of the broken text stands above
// its label and above what the parser as it is shows for it. The rows are those of dump.ts:
//   orig   the valid text. A line feed is ⏎, a tab is →, a carriage return is ↵, a no-break space is ⍽, a byte order
//          mark is ◊, the escape character is ␛, and a character that a terminal draws two columns wide is ◆.
//   label  the display kind of every code point of the valid text: w white space, p punctuation, s string, e escape,
//          n number, l literal, k key.
//   depth  the nesting depth after the code point, 0 to 9 and then a to g for 10 to 16.
//   cont   the innermost open container after the code point: o for an object, a for an array, - for none.
//   brok   the broken text.
//   align  . under a kept code point, ~ under one that stands in the place of another, + under an added one.
//   want   the label's display kind for every code point of the broken text. Blank where it has no label, and ? where
//          the display kind is not scored.
//   wantd  the label's depth.   wantc  the label's container. ? where the two are not scored.
//   now, nowd, nowc  what the parser as it is gives. E is an error.
//   miss   where the parser as it is differs from the label: k for the display kind, d for the depth, c for the
//          container, * for more than one.
//   first  ^ under the code point of the parser's first error, d under the first damaged code point when it comes
//          before that.
// A long text is printed in blocks of 120 columns, each with all of its rows.
import {errorKinds} from '../../../src/json-search/highlighter/kinds.ts'
import {visible} from '../dump.ts'
import {type ValidLabel, kindLetters, labelsOfValidText} from '../labels.ts'
import {containerNames, runTableParser} from '../table-parser.ts'
import {type Opinion, type WrittenCase, labelsOfWritten, scoredCodePointsOfWritten} from './written.ts'

const columns = 120
const depthLetter = (depth: number | undefined) => depth === undefined ? '?' : depth < 0 ? '-' : depth > 16 ? '+' : '0123456789abcdefg'[depth]!
const containerLetter = (container: number | undefined) => container === undefined ? '?' : container === 0 ? '-' : containerNames[container]![0]!

type Row = [name: string, letters: string[]]
// The rows in blocks of 120 columns. A text of one block has no line that says which columns it shows.
function inBlocks(rows: readonly Row[], length: number, indent = ''): string[] {
  const nameWidth = Math.max(...rows.map(([name]) => name.length)) + 1
  const lines: string[] = []
  for (let from = 0; from < Math.max(1, length); from += columns) {
    if (length > columns) lines.push(`${indent}${''.padEnd(nameWidth)}code points ${from} to ${Math.min(length, from + columns) - 1}`)
    for (const [name, letters] of rows) lines.push(`${indent}${name.padEnd(nameWidth)}${letters.slice(from, from + columns).join('')}`.trimEnd())
    if (from + columns < length) lines.push('')
  }
  return lines
}

const validRows = (name: string, text: string, labels: readonly ValidLabel[]): Row[] => [
  [name, Array.from(visible(text))], ['label', labels.map(label => kindLetters[label.kind]!)],
  ['depth', labels.map(label => depthLetter(label.depth))], ['cont', labels.map(label => containerLetter(label.container))],
]
const alignRow = (opinion: Opinion): string[] => opinion.alignment.map((counterpart, position) => counterpart === -1 ? '+' : opinion.replaced[position] === true ? '~' : '.')

// The rows under the broken text that compare the labels of a case with the parser as it is.
function wantAndNowRows(writtenCase: WrittenCase): Row[] {
  const labels = labelsOfWritten(writtenCase)
  const trace = runTableParser(writtenCase.broken)
  const perCodePoint = (letter: (position: number) => string) => Array.from({length: labels.length}, (_, position) => letter(position))
  return [
    ['want', perCodePoint(position => labels[position] === undefined ? ' ' : labels[position].kind === undefined ? '?' : kindLetters[labels[position].kind]!)],
    ['wantd', perCodePoint(position => labels[position] === undefined ? ' ' : depthLetter(labels[position].depth))],
    ['wantc', perCodePoint(position => labels[position] === undefined ? ' ' : containerLetter(labels[position].container))],
    ['now', perCodePoint(position => kindLetters[trace.displayKind[position]!]!)],
    ['nowd', perCodePoint(position => depthLetter(trace.depthAfter[position]))],
    ['nowc', perCodePoint(position => containerLetter(trace.containerAfter[position]))],
    ['miss', perCodePoint(position => {
      const label = labels[position]
      if (label === undefined) return ' '
      const kind = label.kind !== undefined && label.kind !== trace.displayKind[position]
      const depth = label.depth !== undefined && label.depth !== trace.depthAfter[position]
      const container = label.container !== undefined && label.container !== trace.containerAfter[position]
      return Number(kind) + Number(depth) + Number(container) > 1 ? '*' : kind ? 'k' : depth ? 'd' : container ? 'c' : ' '
    })],
    ['first', perCodePoint(position => position === writtenCase.firstErrorPosition ? '^' : position === writtenCase.firstDamage ? 'd' : ' ')],
  ]
}

const quoted = (codePoints: readonly string[]) => `"${visible(codePoints.length > 70 ? `${codePoints.slice(0, 50).join('')} … ${codePoints.slice(-15).join('')}` : codePoints.join(''))}"`

// What an opinion makes of the damage: the runs of the broken text that have no counterpart, and the runs of the
// valid text that the broken text lacks, each with the position in the broken text where it stands or is missing.
export type Change = {kind: 'added' | 'removed', position: number, codePoints: string[]}
export function changeRunsOf(opinion: Opinion, brokenText: string): Change[] {
  const broken = Array.from(brokenText)
  const valid = Array.from(opinion.text)
  const changes: Change[] = []
  // The next code point of the valid text that has no counterpart yet.
  let expected = 0
  let addedFrom = -1
  const endAdded = (position: number) => {
    if (addedFrom !== -1) changes.push({kind: 'added', position: addedFrom, codePoints: broken.slice(addedFrom, position)})
    addedFrom = -1
  }
  opinion.alignment.forEach((counterpart, position) => {
    if (counterpart === -1) {
      if (addedFrom === -1) addedFrom = position
      return
    }
    endAdded(position)
    if (counterpart > expected) changes.push({kind: 'removed', position, codePoints: valid.slice(expected, counterpart)})
    expected = counterpart + 1
  })
  endAdded(broken.length)
  if (expected < valid.length) changes.push({kind: 'removed', position: broken.length, codePoints: valid.slice(expected)})
  return changes
}

// How many places differ by white space alone. An added run and the removed run at its end are one place, so a raw
// line feed in the place of the two characters `\n`, or `<br>` in the place of a line feed, is no such place.
export function whiteSpaceOnlyChanges(opinion: Opinion, brokenText: string): number {
  const isWhiteSpace = (character: string) => character === ' ' || character === '\t' || character === '\n' || character === '\r'
  const changes = changeRunsOf(opinion, brokenText)
  let places = 0
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index]!
    const after = changes[index + 1]
    const samePlace = change.kind === 'added' && after?.kind === 'removed' && after.position === change.position + change.codePoints.length
    if ([...change.codePoints, ...(samePlace ? after.codePoints : [])].every(isWhiteSpace)) places++
    if (samePlace) index++
  }
  return places
}

// The same in words, with the code points that stand one for one for another. Positions are code points of the
// broken text, counted from 0.
export function changesOf(opinion: Opinion, brokenText: string): string[] {
  const broken = Array.from(brokenText)
  const valid = Array.from(opinion.text)
  const lines = changeRunsOf(opinion, brokenText).map(({kind, position, codePoints}) =>
    kind === 'added' ? `added at ${position}${codePoints.length > 1 ? ` to ${position + codePoints.length - 1}` : ''}: ${quoted(codePoints)}`
      : position === broken.length ? `removed at the end: ${quoted(codePoints)}` : `removed before ${position}: ${quoted(codePoints)}`)
  const pairs = new Map<string, number[]>()
  opinion.alignment.forEach((counterpart, position) => {
    if (opinion.replaced[position] !== true) return
    const pair = `${visible(broken[position]!)} for ${visible(valid[counterpart]!)}`
    pairs.set(pair, [...(pairs.get(pair) ?? []), position])
  })
  for (const [pair, positions] of pairs) lines.push(`in the place of another: ${pair}, at ${positions.length > 12 ? `${positions.slice(0, 12).join(', ')} and ${positions.length - 12} more` : positions.join(', ')}`)
  return lines.length === 0 ? ['nothing: the two texts are the same'] : lines
}

const lineCount = (text: string) => text.split('\n').length
const sizeOf = (text: string) => `${Array.from(text).length} code points on ${lineCount(text)} line${lineCount(text) === 1 ? '' : 's'}`

// A case as one opinion sees it: the header, the changes in words, the valid text with its labels, and the broken
// text with the alignment, the labels and what the parser as it is gives. `validName` is the name of the valid
// text's row: orig for a writer's intended text, and rep for a repair.
export function describeCase(writtenCase: WrittenCase, validName = 'orig'): string {
  const opinion = writtenCase.opinions[0]!
  const scored = scoredCodePointsOfWritten(writtenCase)
  const header = [
    `--- ${writtenCase.id}${writtenCase.from === '' ? '' : `  from: ${writtenCase.from}`}`,
    ...(writtenCase.note === undefined ? [] : [`    note: ${writtenCase.note}`]),
    ...(writtenCase.debatable ? ['    debatable: another repair is as sensible'] : []),
    ...(opinion.unsure === undefined ? [] : [`    unsure: ${opinion.unsure}`]),
    `    ${validName === 'orig' ? 'intended' : 'repaired'}: ${sizeOf(opinion.text)}. broken: ${sizeOf(writtenCase.broken)}.`,
    `    first damage at ${writtenCase.firstDamage}, first error of the parser as it is at ${writtenCase.firstErrorPosition} (${errorKinds[writtenCase.firstErrorKind]}), ${scored === 0 ? 'no scored code point from there on: nothing is left to recover' : `${scored} scored code point${scored === 1 ? '' : 's'} from there on`}`,
    '    what the tools take for the damage:',
    ...changesOf(opinion, writtenCase.broken).map(line => `      ${line}`),
  ]
  const brokenRows: Row[] = [['brok', Array.from(visible(writtenCase.broken))], ['align', alignRow(opinion)], ...wantAndNowRows(writtenCase)]
  return [
    ...header,
    ...inBlocks(validRows(validName, opinion.text, labelsOfValidText(opinion.text)), Array.from(opinion.text).length),
    '',
    ...inBlocks(brokenRows, writtenCase.agreement.length),
  ].join('\n')
}

// A case with every opinion: per opinion the alignment and the label of every code point of the broken text, and
// under them the agreement: . agreed, + added by every opinion, ! disputed, - without a label by no-label.txt.
export function describeOpinions(writtenCase: WrittenCase): string {
  const header = [
    `--- ${writtenCase.id}  ${writtenCase.file}  id for the repairers: ${writtenCase.blindId}  from: ${writtenCase.from}`,
    ...(writtenCase.note === undefined ? [] : [`    note: ${writtenCase.note}`]),
    ...(writtenCase.debatable ? ['    debatable: another repair is as sensible'] : []),
    ...writtenCase.noLabel.map(entry => `    without a label by no-label.txt, at ${entry.position}: ${quoted(Array.from(entry.text))}, ${entry.reason}`),
    ...writtenCase.opinions.flatMap(opinion => [
      `    ${opinion.name}${opinion.unsure === undefined ? '' : `, unsure: ${opinion.unsure}`}`,
      `      ${visible(opinion.text)}`,
      ...changesOf(opinion, writtenCase.broken).map(line => `        ${line}`),
    ]),
  ]
  const rows: Row[] = [
    ['brok', Array.from(visible(writtenCase.broken))],
    ...writtenCase.opinions.flatMap((opinion): Row[] => [
      [`${opinion.name} align`, alignRow(opinion)],
      [`${opinion.name} kind`, opinion.labels.map(label => label === undefined ? ' ' : kindLetters[label.kind]!)],
      [`${opinion.name} depth`, opinion.labels.map(label => label === undefined ? ' ' : depthLetter(label.depth))],
      [`${opinion.name} cont`, opinion.labels.map(label => label === undefined ? ' ' : containerLetter(label.container))],
    ]),
    ['agree', writtenCase.agreement.map(state => state === 'agreed' ? '.' : state === 'added' ? '+' : state === 'noLabel' ? '-' : '!')],
    ...wantAndNowRows(writtenCase),
  ]
  return [...header, ...inBlocks(rows, writtenCase.agreement.length)].join('\n')
}
