// One text of a held-back set with what some parsers of the final scoring show for it, line by line, so that a
// reader sees where each parser is wrong.
//
// Run from the repo root:
//   RECOVERY_FINAL=yes bun lab/recovery-toml/held-back/final/where/show.ts <id> <parser>... [--lines <first>-<last>]
// <id> is the id of a sample of the generator's set, e.g. 20261107:12, or of a written case, e.g. hand-editing-07.
// A parser is a row and a seed, e.g. 2, 3, 4.1 for row 4 with seed 1, or 8.3. --lines takes the lines to print,
// counted from 1, e.g. --lines 4-9. Without it every line from the first error's line on is printed.
//
// Per line it prints:
//   text    the code points, with ⏎ for a line feed, ↵ for a carriage return and → for a tab
//   wanted  the display kind of the label, one letter per code point: w white space, p punctuation, s string,
//           e escape, n number, l literal, k key, h header name, c comment. A + stands under a code point that the
//           damage added, which has no label, and a ? where the display kind is not scored.
//   depth   the wanted depth, when a code point of the line has a depth other than 0
//   then per parser its display kinds (E is shown as an error), a line of x under every counted code point that
//   the parser has wrong, and its depths when one of them is wrong.
// Code points before the first error are shown and never counted. A ^ under the text marks the first error.
import {kindLetters} from '../../../kinds.ts'
import {type Loaded, type ScoredParser, type SetKey, depthOfShown, heldBackLine, kindOfShown, loadAll, notCounted, wrong} from './load.ts'

const visible = (character: string) => character === '\n' ? '⏎' : character === '\r' ? '↵' : character === '\t' ? '→' : character < ' ' ? '·' : character
const depthLetter = (depth: number | undefined) => depth === undefined ? '?' : depth < 0 ? '-' : depth.toString(36)

// Where a text is: its set and its place there. Throws for an id that neither set has.
export function placeOf(loaded: Loaded, id: string): {set: SetKey, at: number} {
  for (const set of ['generator', 'written'] as const) {
    const at = loaded.sets[set].texts.findIndex(text => text.id === id)
    if (at !== -1) return {set, at}
  }
  throw new Error(`no text of the two held-back sets has the id ${id}`)
}

// The parser that a name such as "2", "3" or "4.1" means.
export function parserNamed(loaded: Loaded, name: string): ScoredParser {
  const [row, seed] = name.split('.')
  const parser = loaded.parsers.find(candidate => candidate.row === row && (seed === undefined ? true : candidate.seed === Number(seed)))
  if (parser === undefined) throw new Error(`no parser of the final scoring is named ${name}: a name is a row, e.g. 2, or a row and a seed, e.g. 4.1`)
  return parser
}

// The lines of the picture of one text, see the top of this file. `firstLine` and `lastLine` count from 1.
export function showText(loaded: Loaded, set: SetKey, at: number, parsers: readonly ScoredParser[], firstLine?: number, lastLine?: number): string[] {
  const text = loaded.sets[set].texts[at]!
  const codePoints = Array.from(text.broken)
  // The start of every line, and the end after its line feed.
  const lineStarts = [0]
  codePoints.forEach((character, position) => { if (character === '\n' && position + 1 < codePoints.length) lineStarts.push(position + 1) })
  const lineOfFirstError = text.firstErrorPosition === -1 ? lineStarts.length : lineStarts.findLastIndex(start => start <= text.firstErrorPosition) + 1
  const from = firstLine ?? lineOfFirstError
  const to = Math.min(lastLine ?? lineStarts.length, lineStarts.length)
  const labelWidth = Math.max(6, ...parsers.map(parser => parser.name.length)) + 2
  const row = (label: string, cells: string) => `${label.padEnd(labelWidth)}${cells}`.trimEnd()
  const lines: string[] = []
  for (let line = from; line <= to; line++) {
    const start = lineStarts[line - 1]!
    const end = lineStarts[line] ?? codePoints.length
    const positions = Array.from({length: end - start}, (_unused, offset) => start + offset)
    lines.push(row(`line ${line}`, ''))
    lines.push(row('text', positions.map(position => visible(codePoints[position]!)).join('')))
    if (text.firstErrorPosition >= start && text.firstErrorPosition < end) lines.push(row('', `${' '.repeat(text.firstErrorPosition - start)}^ the first error`))
    lines.push(row('wanted', positions.map(position => {
      const label = text.labels[position]
      if (label === undefined) return text.added[position] === true ? '+' : ' '
      return label.kind === undefined ? '?' : kindLetters[label.kind]!
    }).join('')))
    const wantedDepths = positions.map(position => text.labels[position]?.depth)
    if (wantedDepths.some(depth => depth !== undefined && depth !== 0)) lines.push(row('depth', wantedDepths.map((depth, offset) => text.labels[positions[offset]!] === undefined ? ' ' : depthLetter(depth)).join('')))
    for (const parser of parsers) {
      const shown = parser.shown[set][at]!
      const outcomes = parser.outcomes[set][at]!
      lines.push(row(parser.name, positions.map(position => kindLetters[kindOfShown(shown[position]!)]!).join('')))
      if (positions.some(position => outcomes[position] === wrong)) lines.push(row('', positions.map(position => outcomes[position] === wrong ? 'x' : ' ').join('')))
      const depthWrong = positions.some(position => outcomes[position] !== notCounted && text.labels[position]?.depth !== undefined && text.labels[position].depth !== depthOfShown(shown[position]!))
      if (depthWrong) lines.push(row('  depth', positions.map(position => depthLetter(depthOfShown(shown[position]!))).join('')))
    }
    lines.push('')
  }
  return lines
}

if (import.meta.main) {
  const loaded = loadAll()
  const commandArguments = process.argv.slice(2)
  const linesAt = commandArguments.indexOf('--lines')
  const [firstLine, lastLine] = linesAt === -1 ? [undefined, undefined] : commandArguments[linesAt + 1]!.split('-').map(Number)
  const names = commandArguments.filter((_argument, index) => linesAt === -1 || (index !== linesAt && index !== linesAt + 1))
  const [id, ...parserNames] = names
  if (id === undefined || parserNames.length === 0) throw new Error('show.ts takes the id of a text and one or more parsers, e.g. 20261107:12 2 3 4.1')
  const {set, at} = placeOf(loaded, id)
  console.log(heldBackLine)
  console.log(`${id}, ${loaded.scored[set][at]} counted code points`)
  console.log(showText(loaded, set, at, parserNames.map(name => parserNamed(loaded, name)), firstLine, lastLine).join('\n'))
}
