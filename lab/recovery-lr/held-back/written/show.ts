// Prints a written case in a fixed-width form, so that every code point of the broken program stands above its label
// and above what the parser as it is shows for it.
//
// The command prints the texts of cases, so only those who may read this folder run it, see ../README.md.
//
// Run from the repo root: bun lab/recovery-lr/held-back/written/show.ts <case id> [more ids] [--set <folder>] [--second] [--both]
// It prints the case as the writer's repair reads it, with --second as the second repair reads it, and with --both
// the two repairs side by side with their agreement.
//
// The rows:
//   doc    the repaired program. A line feed is ⏎, a tab is →, a carriage return is ↵, a no-break space is ⍽, a byte
//          order mark is ◊, the escape character is ␛, and a character that a terminal draws two columns wide is ◆.
//   label  the display kind of every code point of the repaired program: w white space, c comment, k keyword, n name,
//          d defined name, a parameter, l constant, s string, o operator, p punctuation.
//   depth  the number of `(`, `[`, `let`, `if` and `fun` that are open at the code point, 0 to 9 and then a to z.
//   cont   the innermost of `( [ let = in if then else fun ->` that is open at the code point: ( [ l = n i t e f >,
//          and . for none.
//   brok   the broken program.
//   bad    ! under text that is no token of miniml for the scanner: a character that the language does not have, a
//          string that is not closed on its line, a comment that is not closed.
//   align  . under a kept code point, + under an added one.
//   want   the label's display kind for every code point of the broken program. Blank where it has no label.
//   wantd  the label's depth.   wantc  the label's container.
//   now, nowd, nowc  what the parser as it is shows up to its first error. From there on it has stopped.
//   early  x under a kept code point before the first error that the parser as it is shows as another thing than its
//          label. No score counts these code points.
//   first  ^ under the first code point of the token of the parser's first error, d under the first damaged code
//          point when it comes before that.
// A text is printed in blocks of up to 120 columns. A block ends after a line feed where it can, so that it holds whole
// lines of the text. The rows depth, cont, wantd, wantc, nowd and nowc are left out of a block in which every one of
// them would show depth 0 and no container, and the rows bad, now, early and first where they would be empty.
import {type ValidLabels, containerLetters, containerNames, displayKindNames, kindLetters} from '../../labels.ts'
import {type Sample} from '../../sample.ts'
import {isTrivia, symbolOf} from '../../tables.ts'
import {type Opinion, type WrittenCase, changeRunsOf, firstErrorInWords, namesOf, readWritten, setFolderOf, shownBeforeFirstError} from './written.ts'

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
    else if (codePoint < 0x20 || (codePoint >= 0x200b && codePoint <= 0x200f) || codePoint === 0x2060) shown += '␦'
    // Characters that a terminal draws two columns wide, e.g. 東 or ☕, are shown as ◆.
    else if ((codePoint >= 0x1100 && codePoint <= 0x115f) || (codePoint >= 0x2600 && codePoint <= 0x27bf) || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
      || (codePoint >= 0xac00 && codePoint <= 0xd7a3) || (codePoint >= 0xf900 && codePoint <= 0xfaff) || (codePoint >= 0xff00 && codePoint <= 0xff60) || codePoint >= 0x1f000) shown += '◆'
    else shown += character
  }
  return shown
}

const columns = 120
const kindLetter = (kind: number) => kind === -1 ? ' ' : kindLetters[kind]!
const depthLetter = (depth: number) => depth === -1 ? ' ' : depth > 35 ? '+' : '0123456789abcdefghijklmnopqrstuvwxyz'[depth]!
const containerLetter = (container: number) => container === -1 ? ' ' : containerLetters[container]!

// A row of letters, one per code point. A row that is `plainLetters` in a whole block is left out of the block, e.g.
// the depth row of a block at depth 0.
type Row = {name: string, letters: string[], plainLetters?: string}

// The rows in blocks of up to 120 columns, each block with the position of its first code point. A block ends after
// the last line feed of `text` within its columns, or after 120 columns when a line is longer.
function inBlocks(rows: readonly Row[], text: readonly string[]): string[] {
  const nameWidth = Math.max(...rows.map(row => row.name.length)) + 1
  const lines: string[] = []
  for (let from = 0; from < Math.max(1, text.length);) {
    let end = Math.min(text.length, from + columns)
    const lastLineFeed = text.lastIndexOf('\n', end - 1)
    if (end < text.length && lastLineFeed >= from) end = lastLineFeed + 1
    if (text.length > end - from) lines.push(`${''.padEnd(nameWidth)}code points ${from} to ${end - 1}`)
    for (const row of rows) {
      const letters = row.letters.slice(from, end)
      if (row.plainLetters !== undefined && letters.every(letter => row.plainLetters!.includes(letter))) continue
      lines.push(`${row.name.padEnd(nameWidth)}${letters.join('')}`.trimEnd())
    }
    if (end < text.length) lines.push('')
    from = Math.max(end, from + 1)
  }
  return lines
}

const repairedRows = (text: string, labels: ValidLabels): Row[] => [
  {name: 'doc', letters: Array.from(visible(text))}, {name: 'label', letters: Array.from(labels.kind, kindLetter)},
  {name: 'depth', letters: Array.from(labels.depth, depthLetter), plainLetters: '0'}, {name: 'cont', letters: Array.from(labels.container, containerLetter), plainLetters: '.'},
]
const alignRow = (sample: Sample): string[] => Array.from(sample.alignment, counterpart => counterpart === -1 ? '+' : '.')

const badTerminals = ['BADCHAR', 'BADSTRING', 'BADCOMMENT'].map(name => symbolOf(name))
// ! under every code point of a token that is no token of the language.
function badRow(sample: Sample): Row {
  const letters = new Array<string>(sample.codePoints.length).fill(' ')
  for (let token = 0; token < sample.tokens.count; token++) {
    const start = sample.tokens.start[token]!
    if (badTerminals.includes(sample.tokens.kind[token]!)) letters.fill('!', start, start + sample.tokens.length[token]!)
  }
  return {name: 'bad', letters, plainLetters: ' '}
}

// The kept code points before the first error that the parser as it is shows as another thing than their label.
export function wrongBeforeFirstError(sample: Sample): number[] {
  const shown = shownBeforeFirstError(sample)
  const positions: number[] = []
  for (let position = 0; position < sample.firstErrorPosition; position++) {
    if (sample.alignment[position] === -1) continue
    if (shown.kind[position] !== sample.labelKind[position] || shown.depth[position] !== sample.labelDepth[position] || shown.container[position] !== sample.labelContainer[position]) positions.push(position)
  }
  return positions
}

// The rows under the broken program that compare the labels of a sample with the parser as it is.
function wantAndNowRows(sample: Sample, firstDamage: number): Row[] {
  const shown = shownBeforeFirstError(sample)
  const early = new Set(wrongBeforeFirstError(sample))
  const perCodePoint = (letter: (position: number) => string) => Array.from({length: sample.codePoints.length}, (_, position) => letter(position))
  return [
    {name: 'want', letters: Array.from(sample.labelKind, kindLetter)},
    {name: 'wantd', letters: Array.from(sample.labelDepth, depthLetter), plainLetters: '0 '},
    {name: 'wantc', letters: Array.from(sample.labelContainer, containerLetter), plainLetters: '. '},
    {name: 'now', letters: Array.from(shown.kind, kindLetter), plainLetters: ' '},
    {name: 'nowd', letters: Array.from(shown.depth, depthLetter), plainLetters: '0 '},
    {name: 'nowc', letters: Array.from(shown.container, containerLetter), plainLetters: '. '},
    {name: 'early', plainLetters: ' ', letters: perCodePoint(position => early.has(position) ? 'x' : ' ')},
    {name: 'first', plainLetters: ' ', letters: perCodePoint(position => position === sample.firstErrorPosition ? '^' : position === firstDamage ? 'd' : ' ')},
  ]
}

const quotedText = (codePoints: readonly string[]) => `"${visible(codePoints.length > 70 ? `${codePoints.slice(0, 50).join('')} … ${codePoints.slice(-15).join('')}` : codePoints.join(''))}"`

// What an opinion makes of the damage, in words. Positions are code points of the broken program, counted from 0.
export function changesOf(opinion: Opinion, brokenText: string): string[] {
  const brokenLength = Array.from(brokenText).length
  const lines = changeRunsOf(brokenText, opinion.text, opinion.sample.alignment).map(({kind, position, codePoints}) =>
    kind === 'added' ? `added at ${position}${codePoints.length > 1 ? ` to ${position + codePoints.length - 1}` : ''}: ${quotedText(codePoints)}`
      : position === brokenLength ? `missing at the end: ${quotedText(codePoints)}` : `missing before ${position}: ${quotedText(codePoints)}`)
  return lines.length === 0 ? ['nothing: the two texts are the same'] : lines
}

const lineCount = (text: string) => text.split('\n').length
const sizeOf = (text: string) => `${Array.from(text).length} code points on ${lineCount(text)} line${lineCount(text) === 1 ? '' : 's'}`
const counted = (count: number, thing: string) => `${count} ${thing}${count === 1 ? '' : 's'}`

// How many tokens of the broken program have kept code points and are no token of the repaired program, e.g. `True`
// for `true`, and a string that lost its closing quote and now reaches to the end of its line. A parser shows a
// token as one thing, so such a token is harder to show right than a kept one.
export function changedTokensOf(sample: Sample): number {
  let count = 0
  for (let token = 0; token < sample.tokens.count; token++) {
    if (isTrivia(sample.tokens.kind[token]!) || sample.keptToken[token] !== -1) continue
    for (let position = sample.tokens.start[token]!; position < sample.tokens.start[token]! + sample.tokens.length[token]!; position++) {
      if (sample.alignment[position] !== -1) {
        count++
        break
      }
    }
  }
  return count
}

// A case as its first opinion sees it: the header, the changes in words, the repaired program with its labels, and
// the broken program with the alignment, the labels and what the parser as it is shows.
export function describeCase(writtenCase: WrittenCase): string {
  const opinion = writtenCase.opinions[0]!
  const {sample} = opinion
  const early = wrongBeforeFirstError(sample).length
  const changedTokens = changedTokensOf(sample)
  const header = [
    `--- ${writtenCase.id}${writtenCase.from === '' ? '' : `  from: ${writtenCase.from}`}`,
    ...(opinion.note === undefined ? [] : [`    note: ${opinion.note}`]),
    ...(opinion.unsure === undefined ? [] : [`    unsure: ${opinion.unsure}`]),
    `    repaired: ${sizeOf(opinion.text)}. broken: ${sizeOf(writtenCase.broken)}.`,
    `    first damage at ${writtenCase.firstDamage}. First error of the parser as it is ${firstErrorInWords(sample.codePoints, sample.tokens, sample.firstErrorToken, sample.startStack)}.`,
    `    ${counted(sample.scored, 'scored code point')} from there on${early === 0 ? '' : `, and ${counted(early, 'kept code point')} before it that the parser as it is shows as another thing than the label says`}${changedTokens === 0 ? '' : `. ${counted(changedTokens, 'token')} of the broken program ${changedTokens === 1 ? 'has' : 'have'} kept code points and ${changedTokens === 1 ? 'is' : 'are'} no token of the repaired program`}.`,
    '    what the alignment says the damage is:',
    ...changesOf(opinion, writtenCase.broken).map(line => `      ${line}`),
  ]
  const brokenRows: Row[] = [{name: 'brok', letters: Array.from(visible(writtenCase.broken))}, badRow(sample), {name: 'align', letters: alignRow(sample)}, ...wantAndNowRows(sample, writtenCase.firstDamage)]
  return [
    ...header,
    ...inBlocks(repairedRows(opinion.text, opinion.labels), Array.from(opinion.text)),
    '',
    ...inBlocks(brokenRows, Array.from(writtenCase.broken)),
  ].join('\n')
}

// A case with every opinion: per opinion the alignment and the label of every code point of the broken program, and
// under them the agreement: . agreed, + added by every opinion, ! disputed.
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
      {name: `${opinion.name} align`, letters: alignRow(opinion.sample)},
      {name: `${opinion.name} kind`, letters: Array.from(opinion.sample.labelKind, kindLetter)},
      {name: `${opinion.name} depth`, letters: Array.from(opinion.sample.labelDepth, depthLetter), plainLetters: '0 '},
      {name: `${opinion.name} cont`, letters: Array.from(opinion.sample.labelContainer, containerLetter), plainLetters: '. '},
    ]),
    {name: 'agree', letters: writtenCase.agreement.map(state => state === 'agreed' ? '.' : state === 'added' ? '+' : '!')},
    {name: 'first', plainLetters: ' ', letters: writtenCase.agreement.map((_, position) => position === writtenCase.sample.firstErrorPosition ? '^' : ' ')},
  ]
  return [...header, ...inBlocks(rows, Array.from(writtenCase.broken))].join('\n')
}

// A label in words, e.g. "name, depth 2, in (".
export const labelInWords = (sample: Sample, position: number) => sample.alignment[position] === -1 ? 'added'
  : `${displayKindNames[sample.labelKind[position]!]!}, depth ${sample.labelDepth[position]}, ${sample.labelContainer[position] === 0 ? 'in no container' : `in ${containerNames[sample.labelContainer[position]!]!}`}`

if (import.meta.main) {
  const commandArguments = process.argv.slice(2)
  const ids = namesOf(commandArguments)
  if (ids.length === 0) throw new Error('usage: bun lab/recovery-lr/held-back/written/show.ts <case id> [more ids] [--set <folder>] [--second] [--both]')
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
