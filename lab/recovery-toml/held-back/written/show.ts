// Prints a written case in a fixed-width form, so that every code point of the broken payload stands above its label
// and above what the parser as it is shows for it.
//
// Run from the repo root: bun lab/recovery-toml/held-back/written/show.ts <case id> [more ids] [--set <folder>] [--second] [--both]
// It prints the case as the writer's repair reads it, with --second as the second repair reads it, and with --both
// the two repairs side by side with their agreement.
//
// The rows:
//   doc    the repaired document. A line feed is ⏎, a tab is →, a carriage return is ↵, a no-break space is ⍽, a byte
//          order mark is ◊, the escape character is ␛, and a character that a terminal draws two columns wide is ◆.
//   label  the display kind of every code point of the repaired document: w white space, p punctuation, s string,
//          e escape, n number, l literal, k key, h the name of a header, c comment.
//   depth  the number of open arrays and inline tables after the code point, 0 to 9 and then a to g for 10 to 16.
//   cont   the innermost open container after the code point: a for an array, t for an inline table, - for none.
//   brok   the broken payload.
//   align  . under a kept code point, ~ under one that stands in the place of another, + under an extra one.
//   want   the label's display kind for every code point of the broken payload. Blank where it has no label, and ?
//          where the display kind is not scored.
//   wantd  the label's depth.   wantc  the label's container. ? where the two are not scored.
//   now, nowd, nowc  what the parser as it is gives. E is an error.
//   miss   from the parser's first error on, where the parser as it is differs from the label: k for the display
//          kind, d for the depth, c for the container, * for more than one.
//   first  ^ under the code point of the parser's first error, d under the first damaged code point when it comes
//          before that.
// A text is printed in blocks of up to 120 columns. A block ends after a line feed where it can, so that it holds whole
// lines of the text. The rows depth, cont, wantd, wantc, nowd and nowc are left out of a block in which every one of
// them would show depth 0 and no container, and the rows miss and first where they would be empty.
import {errorKinds, kindLetters} from '../../kinds.ts'
import type {ReferenceLabel} from '../../reference.ts'
import {labelReference} from '../../reference.ts'
import {runTableParser} from '../../table-parser.ts'
import {type Opinion, type WrittenCase, changeRunsOf, labelsOfWritten, namesOf, readWritten, scoredCodePointsOfWritten, setFolderOf} from './written.ts'

// One column per code point: characters that would break the columns are shown as another character.
const standIns: Record<string, string> = {'\n': '⏎', '\t': '→', '\r': '↵', '\u001b': '␛', '\u0000': '␀', ' ': '␤', '\u007f': '␡'}
export function visible(text: string) {
  let shown = ''
  for (const character of text) {
    const codePoint = character.codePointAt(0)!
    const standIn = standIns[character]
    if (standIn !== undefined) shown += standIn
    else if (codePoint === 0xfeff) shown += '◊'
    else if (codePoint === 0xa0) shown += '⍽'
    else if (codePoint < 0x20) shown += '␦'
    // Characters that a terminal draws two columns wide, e.g. 東 or ☕, are shown as ◆.
    else if ((codePoint >= 0x1100 && codePoint <= 0x115f) || (codePoint >= 0x2600 && codePoint <= 0x27bf) || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
      || (codePoint >= 0xac00 && codePoint <= 0xd7a3) || (codePoint >= 0xf900 && codePoint <= 0xfaff) || (codePoint >= 0xff00 && codePoint <= 0xff60) || codePoint >= 0x1f000) shown += '◆'
    else shown += character
  }
  return shown
}

const columns = 120
const depthLetter = (depth: number | undefined) => depth === undefined ? '?' : depth < 0 ? '-' : depth > 16 ? '+' : '0123456789abcdefg'[depth]!
const containerLetter = (container: number | undefined) => container === undefined ? '?' : '-ta'[container]!

// A row of letters, one per code point. A row that is `plainLetters` in a whole block is left out of the block, e.g.
// the depth row of a block at depth 0.
type Row = {name: string, letters: string[], plainLetters?: string}

// The rows in blocks of up to 120 columns, each block with the position of its first code point. A block ends after
// the last line feed of `text` within its columns, or after 120 columns when a line is longer.
function inBlocks(rows: readonly Row[], text: readonly string[], indent = ''): string[] {
  const nameWidth = Math.max(...rows.map(row => row.name.length)) + 1
  const lines: string[] = []
  for (let from = 0; from < Math.max(1, text.length);) {
    let end = Math.min(text.length, from + columns)
    const lastLineFeed = text.lastIndexOf('\n', end - 1)
    if (end < text.length && lastLineFeed >= from) end = lastLineFeed + 1
    if (text.length > end - from) lines.push(`${indent}${''.padEnd(nameWidth)}code points ${from} to ${end - 1}`)
    for (const row of rows) {
      const letters = row.letters.slice(from, end)
      if (row.plainLetters !== undefined && letters.every(letter => row.plainLetters!.includes(letter))) continue
      lines.push(`${indent}${row.name.padEnd(nameWidth)}${letters.join('')}`.trimEnd())
    }
    if (end < text.length) lines.push('')
    from = Math.max(end, from + 1)
  }
  return lines
}

const repairedRows = (text: string, labels: readonly ReferenceLabel[]): Row[] => [
  {name: 'doc', letters: Array.from(visible(text))}, {name: 'label', letters: labels.map(label => kindLetters[label.kind]!)},
  {name: 'depth', letters: labels.map(label => depthLetter(label.depth)), plainLetters: '0'}, {name: 'cont', letters: labels.map(label => containerLetter(label.container)), plainLetters: '-'},
]
const alignRow = (opinion: Opinion): string[] => opinion.alignment.map((counterpart, position) => counterpart === -1 ? '+' : opinion.replaced[position] === true ? '~' : '.')

// The rows under the broken payload that compare the labels of a case with the parser as it is.
function wantAndNowRows(writtenCase: WrittenCase): Row[] {
  const labels = labelsOfWritten(writtenCase)
  const trace = runTableParser(writtenCase.broken)
  const perCodePoint = (letter: (position: number) => string) => Array.from({length: labels.length}, (_, position) => letter(position))
  return [
    {name: 'want', letters: perCodePoint(position => labels[position] === undefined ? ' ' : labels[position].kind === undefined ? '?' : kindLetters[labels[position].kind]!)},
    {name: 'wantd', letters: perCodePoint(position => labels[position] === undefined ? ' ' : depthLetter(labels[position].depth)), plainLetters: '0 '},
    {name: 'wantc', letters: perCodePoint(position => labels[position] === undefined ? ' ' : containerLetter(labels[position].container)), plainLetters: '- '},
    {name: 'now', letters: perCodePoint(position => kindLetters[trace.displayKind[position]!]!)},
    {name: 'nowd', letters: perCodePoint(position => depthLetter(trace.depthAfter[position])), plainLetters: '0'},
    {name: 'nowc', letters: perCodePoint(position => containerLetter(trace.containerAfter[position])), plainLetters: '-'},
    {name: 'miss', plainLetters: ' ', letters: perCodePoint(position => {
      const label = labels[position]
      if (label === undefined || position < writtenCase.firstErrorPosition) return ' '
      const kind = label.kind !== undefined && label.kind !== trace.displayKind[position]
      const depth = label.depth !== undefined && label.depth !== trace.depthAfter[position]
      const container = label.container !== undefined && label.container !== trace.containerAfter[position]
      return Number(kind) + Number(depth) + Number(container) > 1 ? '*' : kind ? 'k' : depth ? 'd' : container ? 'c' : ' '
    })},
    {name: 'first', plainLetters: ' ', letters: perCodePoint(position => position === writtenCase.firstErrorPosition ? '^' : position === writtenCase.firstDamage ? 'd' : ' ')},
  ]
}

const quoted = (codePoints: readonly string[]) => `"${visible(codePoints.length > 70 ? `${codePoints.slice(0, 50).join('')} … ${codePoints.slice(-15).join('')}` : codePoints.join(''))}"`

// What an opinion makes of the damage, in words. Positions are code points of the broken payload, counted from 0. A
// space that stands for another code point, or that another stands for, is shown as ␣.
export function changesOf(opinion: Opinion, brokenText: string): string[] {
  const broken = Array.from(brokenText)
  const repaired = Array.from(opinion.text)
  const lines = changeRunsOf(brokenText, opinion.text, opinion.alignment).map(({kind, position, codePoints}) =>
    kind === 'extra' ? `extra at ${position}${codePoints.length > 1 ? ` to ${position + codePoints.length - 1}` : ''}: ${quoted(codePoints)}`
      : position === broken.length ? `missing at the end: ${quoted(codePoints)}` : `missing before ${position}: ${quoted(codePoints)}`)
  const pairs = new Map<string, number[]>()
  opinion.alignment.forEach((counterpart, position) => {
    if (opinion.replaced[position] !== true) return
    const pair = `${visible(broken[position]!).replace(' ', '␣')} for ${visible(repaired[counterpart]!).replace(' ', '␣')}`
    pairs.set(pair, [...(pairs.get(pair) ?? []), position])
  })
  for (const [pair, positions] of pairs) lines.push(`in the place of another: ${pair}, at ${positions.length > 12 ? `${positions.slice(0, 12).join(', ')} and ${positions.length - 12} more` : positions.join(', ')}`)
  // A code point that is kept and has no label is what is left of a literal or a number with a slip in it.
  const slipped = opinion.alignment.flatMap((counterpart, position) => counterpart !== -1 && opinion.labels[position] === undefined ? [position] : [])
  if (slipped.length > 0) lines.push(`without a label, as what is left of a literal or a number with a slip in it: ${quoted(slipped.map(position => broken[position]!))}, at ${slipped.join(', ')}`)
  return lines.length === 0 ? ['nothing: the two texts are the same'] : lines
}

const lineCount = (text: string) => text.split('\n').length
const sizeOf = (text: string) => `${Array.from(text).length} code points on ${lineCount(text)} line${lineCount(text) === 1 ? '' : 's'}`

// A case as its first opinion sees it: the header, the changes in words, the repaired document with its labels, and
// the broken payload with the alignment, the labels and what the parser as it is gives.
export function describeCase(writtenCase: WrittenCase): string {
  const opinion = writtenCase.opinions[0]!
  const scored = scoredCodePointsOfWritten(writtenCase)
  const reference = labelReference(opinion.text)
  const header = [
    `--- ${writtenCase.id}${writtenCase.from === '' ? '' : `  from: ${writtenCase.from}`}`,
    ...(opinion.note === undefined ? [] : [`    note: ${opinion.note}`]),
    ...(opinion.unsure === undefined ? [] : [`    unsure: ${opinion.unsure}`]),
    `    repaired: ${sizeOf(opinion.text)}. broken: ${sizeOf(writtenCase.broken)}.`,
    `    first damage at ${writtenCase.firstDamage}, first error of the parser as it is at ${writtenCase.firstErrorPosition} (${errorKinds[writtenCase.firstErrorKind]!}), ${scored === 0 ? 'no scored code point from there on: nothing is left to recover' : `${scored} scored code point${scored === 1 ? '' : 's'} from there on`}`,
    '    what the alignment says the damage is:',
    ...changesOf(opinion, writtenCase.broken).map(line => `      ${line}`),
  ]
  const brokenRows: Row[] = [{name: 'brok', letters: Array.from(visible(writtenCase.broken))}, {name: 'align', letters: alignRow(opinion)}, ...wantAndNowRows(writtenCase)]
  return [
    ...header,
    ...inBlocks(repairedRows(opinion.text, reference.valid ? reference.labels : []), Array.from(opinion.text)),
    '',
    ...inBlocks(brokenRows, Array.from(writtenCase.broken)),
  ].join('\n')
}

// A case with every opinion: per opinion the alignment and the label of every code point of the broken payload, and
// under them the agreement: . agreed, + without a label by every opinion, ! disputed.
export function describeOpinions(writtenCase: WrittenCase): string {
  const header = [
    `--- ${writtenCase.id}  ${writtenCase.file}${writtenCase.from === '' ? '' : `  from: ${writtenCase.from}`}`,
    ...writtenCase.opinions.flatMap(opinion => [
      `    ${opinion.name}${opinion.unsure === undefined ? '' : `, unsure: ${opinion.unsure}`}${opinion.note === undefined ? '' : `, note: ${opinion.note}`}`,
      ...changesOf(opinion, writtenCase.broken).map(line => `        ${line}`),
    ]),
  ]
  const rows: Row[] = [
    {name: 'brok', letters: Array.from(visible(writtenCase.broken))},
    ...writtenCase.opinions.flatMap((opinion): Row[] => [
      {name: `${opinion.name} align`, letters: alignRow(opinion)},
      {name: `${opinion.name} kind`, letters: opinion.labels.map(label => label === undefined ? ' ' : kindLetters[label.kind]!)},
      {name: `${opinion.name} depth`, letters: opinion.labels.map(label => label === undefined ? ' ' : depthLetter(label.depth)), plainLetters: '0 '},
      {name: `${opinion.name} cont`, letters: opinion.labels.map(label => label === undefined ? ' ' : containerLetter(label.container)), plainLetters: '- '},
    ]),
    {name: 'agree', letters: writtenCase.agreement.map(state => state === 'agreed' ? '.' : state === 'extra' ? '+' : '!')},
    ...wantAndNowRows(writtenCase),
  ]
  return [...header, ...inBlocks(rows, Array.from(writtenCase.broken))].join('\n')
}

if (import.meta.main) {
  const commandArguments = process.argv.slice(2)
  const ids = namesOf(commandArguments)
  if (ids.length === 0) throw new Error('usage: bun lab/recovery-toml/held-back/written/show.ts <case id> [more ids] [--set <folder>] [--second] [--both]')
  const folder = setFolderOf(commandArguments)
  const both = commandArguments.includes('--both')
  const {cases, problems} = readWritten(folder, {opinions: both ? 'both' : commandArguments.includes('--second') ? 'second' : 'writer'})
  for (const id of ids) {
    const writtenCase = cases.find(candidate => candidate.id === id)
    if (writtenCase === undefined) {
      const about = problems.filter(problem => problem.includes(`case ${id}:`))
      console.log(`--- ${id}: ${about.length > 0 ? 'the case has a problem and is left out' : `no case of ${folder} has this id`}`)
      for (const problem of about) console.log(`    problem: ${problem}`)
    } else console.log(both ? describeOpinions(writtenCase) : describeCase(writtenCase))
    console.log('')
  }
}
