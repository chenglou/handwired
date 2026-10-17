// The parts of a valid TOML document, with the positions of their code points: its lines, headers, entries, keys,
// values, arrays, inline tables, strings and comments. A mistake of mistakes/ picks its place among them, e.g. the
// closing quote of a string value that is the last thing on its line. It is lab/recovery-parser/scan.ts for TOML.
//
// The scan reads the labels of ../../labels.ts and not the text's grammar a second time: a run of code points that are
// shown as a string is a string, a `[` that raises the depth opens an array, and so on. So it only takes a valid text.
// Every position is an index into the text's code points, and an `end` is the index after the part's last code point.
import {type ValidLabel, displayKind, labelsOfValidText} from '../../labels.ts'

export type Part = {start: number, end: number}

export type StringPart = Part & {
  // What the string stands between: one quote or apostrophe, or three of them.
  quote: '"' | '\''
  multiLine: boolean
  // What stands between the quotes, as it is written, e.g. `C:\\logs` for the string "C:\\logs".
  content: string
  contentStart: number
  contentEnd: number
  // True when the content holds a backslash that starts an escape, which only a string in quotes can.
  hasEscape: boolean
}

// One part of a key, e.g. the `tasks` and the `"docs:serve"` of `tasks."docs:serve"`.
export type KeyPart = Part & {quoted: boolean, text: string}
export type Key = Part & {
  parts: KeyPart[]
  // The positions of the dots between the parts.
  dots: number[]
}

export type Value = Part & (
  | {type: 'string', string: StringPart}
  // A number, a date or a time. `text` is the value as written, e.g. `30_000` or `1979-05-27T07:32:00Z`.
  | {type: 'number', text: string}
  // true or false.
  | {type: 'literal', text: string}
  | {type: 'array', container: Container}
  | {type: 'inlineTable', container: Container}
)

// A key with its value: a line of the document, or an entry of an inline table.
export type Entry = {
  key: Key
  equals: number
  value: Value
  // The inline table that holds the entry, or null for an entry on a line of the document.
  container: Container | null
  // The entry's place among the entries of its inline table, or of its section.
  index: number
  // The position of the comma after the entry in an inline table, or -1.
  commaAfter: number
  // The section of an entry on a line of the document, and of the entry that holds this one otherwise.
  section: Section
}

// A value of an array.
export type Item = {value: Value, index: number, commaAfter: number}

export type Container = {
  type: 'array' | 'inlineTable'
  // The positions of the opening and of the closing bracket.
  open: number
  close: number
  // The values of an array, and the entries of an inline table. The other list is empty.
  items: Item[]
  entries: Entry[]
  // 1 for a container that is the value of an entry on a line of the document.
  depth: number
  parent: Container | null
  // True when a line end stands between the brackets.
  severalLines: boolean
  // The entry on a line of the document whose value holds the container.
  owner: Entry
}

export type Header = Part & {
  // True for [[name]].
  array: boolean
  name: Key
}

// A header with the entries below it. The first section of a document has no header: it holds the entries above the
// first header, and may be empty.
export type Section = {header: Header | null, entries: Entry[]}

export type Comment = Part & {
  // True when only white space stands before the comment on its line.
  ownLine: boolean
}

export type Line = {
  // The line's first code point, the position of its line end (the text's length for a last line without one), and
  // the first code point of the next line.
  start: number
  end: number
  next: number
}

export type Scan = {
  text: string
  codePoints: string[]
  labels: ValidLabel[]
  // What ends the document's lines.
  lineEnd: '\n' | '\r\n'
  lines: Line[]
  sections: Section[]
  headers: Header[]
  // Every entry, also those of inline tables, in text order.
  entries: Entry[]
  // The arrays and inline tables, in the order of their opening brackets.
  containers: Container[]
  // The strings that are values, in text order.
  strings: StringPart[]
  // The numbers, dates and times, and the literals, in text order.
  numbers: (Value & {type: 'number'})[]
  literals: (Value & {type: 'literal'})[]
  comments: Comment[]
}

type Token = Part & {type: 'space' | 'comment' | 'mark' | 'key' | 'headerName' | 'string' | 'number' | 'literal'}

// The tokens of a valid text by its labels: a mark is one code point of punctuation, and every other token is a run of
// code points of one display kind, with its escapes.
function tokensOf(labels: readonly ValidLabel[]): Token[] {
  const typeOfKind = new Map<number, Token['type']>([
    [displayKind.whitespace, 'space'], [displayKind.comment, 'comment'], [displayKind.key, 'key'], [displayKind.headerName, 'headerName'],
    [displayKind.string, 'string'], [displayKind.number, 'number'], [displayKind.literal, 'literal'],
  ])
  const tokens: Token[] = []
  for (let index = 0; index < labels.length;) {
    const kind = labels[index]!.kind
    if (kind === displayKind.punctuation) {
      tokens.push({type: 'mark', start: index, end: index + 1})
      index++
      continue
    }
    const type = typeOfKind.get(kind)
    if (type === undefined) throw new Error(`a token starts with the display kind ${kind} at ${index}`)
    const holdsEscapes = type === 'key' || type === 'headerName' || type === 'string'
    let end = index + 1
    while (end < labels.length && (labels[end]!.kind === kind || (holdsEscapes && labels[end]!.kind === displayKind.escape))) end++
    tokens.push({type, start: index, end})
    index = end
  }
  return tokens
}

const datePattern = /^\d{4}-\d{2}-\d{2}/
const timePattern = /^\d{2}:\d{2}/
// Whether a number of the scan is a date, a time, or a date with a time, e.g. 1979-05-27 or 07:32:00.
export const isDateOrTime = (text: string) => datePattern.test(text) || timePattern.test(text)

export function scan(text: string): Scan {
  const codePoints = Array.from(text)
  const labels = labelsOfValidText(text)
  const tokens = tokensOf(labels)
  const textOf = (part: Part) => codePoints.slice(part.start, part.end).join('')

  const lines: Line[] = []
  for (let start = 0; start < codePoints.length;) {
    let end = start
    while (end < codePoints.length && codePoints[end] !== '\n' && codePoints[end] !== '\r') end++
    const next = end === codePoints.length ? end : codePoints[end] === '\r' ? end + 2 : end + 1
    lines.push({start, end, next})
    start = next
  }

  const firstSection: Section = {header: null, entries: []}
  const result: Scan = {
    text, codePoints, labels, lineEnd: text.includes('\r\n') ? '\r\n' : '\n', lines, sections: [firstSection], headers: [], entries: [], containers: [], strings: [], numbers: [],
    literals: [], comments: [],
  }

  let position = 0
  let section = firstSection
  const markAt = (index: number) => tokens[index]?.type === 'mark' ? codePoints[tokens[index].start] : undefined
  const skipSpace = (withComments: boolean) => {
    while (tokens[position]?.type === 'space' || (withComments && tokens[position]?.type === 'comment')) position++
  }
  const expectMark = (mark: string) => {
    if (markAt(position) !== mark) throw new Error(`the scan expected ${mark} at ${tokens[position]?.start ?? codePoints.length}`)
    return tokens[position++]!.start
  }

  const stringPartOf = (token: Token): StringPart => {
    const quote = codePoints[token.start] as '"' | '\''
    const multiLine = token.end - token.start >= 6 && codePoints[token.start + 1] === quote && codePoints[token.start + 2] === quote
    const quoteLength = multiLine ? 3 : 1
    const contentStart = token.start + quoteLength
    const contentEnd = token.end - quoteLength
    let hasEscape = false
    for (let index = contentStart; index < contentEnd; index++) if (labels[index]!.kind === displayKind.escape) hasEscape = true
    return {start: token.start, end: token.end, quote, multiLine, content: codePoints.slice(contentStart, contentEnd).join(''), contentStart, contentEnd, hasEscape}
  }

  // A key of an entry, or the name of a header: parts with dots between them.
  const key = (type: 'key' | 'headerName'): Key => {
    const parts: KeyPart[] = []
    const dots: number[] = []
    for (;;) {
      const token = tokens[position]
      if (token?.type !== type) throw new Error(`the scan expected a part of a key at ${token?.start ?? codePoints.length}`)
      position++
      const first = codePoints[token.start]
      parts.push({start: token.start, end: token.end, quoted: first === '"' || first === '\'', text: textOf(token)})
      const before = position
      skipSpace(false)
      if (markAt(position) !== '.') {
        position = before
        break
      }
      dots.push(tokens[position++]!.start)
      skipSpace(false)
    }
    return {start: parts[0]!.start, end: parts.at(-1)!.end, parts, dots}
  }

  const value = (parent: Container | null, owner: Entry): Value => {
    const token = tokens[position]
    if (token === undefined) throw new Error('the scan expected a value at the end of the text')
    if (token.type === 'string') {
      position++
      const part = stringPartOf(token)
      result.strings.push(part)
      return {type: 'string', start: token.start, end: token.end, string: part}
    }
    if (token.type === 'literal') {
      position++
      const literal = {type: 'literal' as const, start: token.start, end: token.end, text: textOf(token)}
      result.literals.push(literal)
      return literal
    }
    if (token.type === 'number') {
      position++
      let end = token.end
      // A date, one space and a time are one value, e.g. 1979-05-27 07:32:00.
      const space = tokens[position]
      const time = tokens[position + 1]
      if (space?.type === 'space' && space.end - space.start === 1 && codePoints[space.start] === ' ' && time?.type === 'number') {
        end = time.end
        position += 2
      }
      const number = {type: 'number' as const, start: token.start, end, text: codePoints.slice(token.start, end).join('')}
      result.numbers.push(number)
      return number
    }
    const mark = markAt(position)
    if (mark !== '[' && mark !== '{') throw new Error(`the scan expected a value at ${token.start}`)
    position++
    const container: Container = {
      type: mark === '[' ? 'array' : 'inlineTable', open: token.start, close: -1, items: [], entries: [], depth: parent === null ? 1 : parent.depth + 1, parent, severalLines: false, owner,
    }
    result.containers.push(container)
    const closer = mark === '[' ? ']' : '}'
    for (;;) {
      skipSpace(true)
      if (markAt(position) === closer) break
      if (container.type === 'array') {
        const item: Item = {value: value(container, owner), index: container.items.length, commaAfter: -1}
        container.items.push(item)
        skipSpace(true)
        if (markAt(position) === ',') item.commaAfter = tokens[position++]!.start
      } else {
        const inner = entry(container, owner)
        skipSpace(true)
        if (markAt(position) === ',') inner.commaAfter = tokens[position++]!.start
      }
    }
    container.close = tokens[position++]!.start
    container.severalLines = codePoints.slice(container.open, container.close).includes('\n')
    return {type: container.type, start: container.open, end: container.close + 1, container}
  }

  const entry = (container: Container | null, owner: Entry | null): Entry => {
    const entryKey = key('key')
    skipSpace(false)
    const equals = expectMark('=')
    skipSpace(false)
    const list = container === null ? section.entries : container.entries
    // The value is set right below: it needs the entry as its owner.
    const made = {key: entryKey, equals, container, index: list.length, commaAfter: -1, section} as Entry
    list.push(made)
    result.entries.push(made)
    made.value = value(container, owner ?? made)
    return made
  }

  for (;;) {
    skipSpace(true)
    const token = tokens[position]
    if (token === undefined) break
    if (markAt(position) === '[') {
      const array = markAt(position + 1) === '['
      position += array ? 2 : 1
      skipSpace(false)
      const name = key('headerName')
      skipSpace(false)
      expectMark(']')
      const end = array ? expectMark(']') + 1 : tokens[position - 1]!.end
      const header: Header = {start: token.start, end, array, name}
      result.headers.push(header)
      section = {header, entries: []}
      result.sections.push(section)
    } else {
      entry(null, null)
    }
  }

  for (const token of tokens) {
    if (token.type !== 'comment') continue
    const line = lineAt(result, token.start)
    result.comments.push({start: token.start, end: token.end, ownLine: codePoints.slice(line.start, token.start).every(character => character === ' ' || character === '\t')})
  }
  return result
}

// The line that holds a position. The position of a line's end belongs to that line.
export function lineAt(scanned: Scan, position: number): Line {
  let low = 0
  let high = scanned.lines.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (scanned.lines[middle]!.start <= position) low = middle
    else high = middle - 1
  }
  const line = scanned.lines[low]
  if (line === undefined) throw new Error('the text has no line')
  return line
}

export const textOf = (scanned: Scan, part: Part) => scanned.codePoints.slice(part.start, part.end).join('')

// The white space that a line starts with.
export function indentationOf(scanned: Scan, line: Line): string {
  let end = line.start
  while (end < line.end && (scanned.codePoints[end] === ' ' || scanned.codePoints[end] === '\t')) end++
  return scanned.codePoints.slice(line.start, end).join('')
}

const isSpace = (character: string | undefined) => character === ' ' || character === '\t'

// What follows a position on its line: nothing but white space, or a comment.
export function restOfLine(scanned: Scan, position: number): {line: Line, comment: Comment | undefined, onlySpace: boolean} {
  const line = lineAt(scanned, position)
  const comment = scanned.comments.find(candidate => candidate.start >= position && candidate.start < line.end)
  const upTo = comment?.start ?? line.end
  const onlySpace = scanned.codePoints.slice(position, upTo).every(isSpace)
  return {line, comment: onlySpace ? comment : undefined, onlySpace: onlySpace && comment === undefined}
}

// Whether an entry on a line of the document starts and ends on that one line, e.g. not an array on several lines.
export const onOneLine = (scanned: Scan, entry: Entry) => lineAt(scanned, entry.key.start) === lineAt(scanned, entry.value.end - 1)

// The entries that stand on lines of the document, i.e. not in an inline table.
export const lineEntries = (scanned: Scan) => scanned.entries.filter(entry => entry.container === null)

// Whether a value is a number that is no date and no time, and has only digits, a sign, underscores and one decimal
// point, e.g. 30, -4, 30_000 or 0.5.
export const isPlainNumber = (value: Value): value is Value & {type: 'number'} => value.type === 'number' && /^[+-]?\d[\d_]*(\.\d[\d_]*)?$/.test(value.text) && !/^[+-]?0\d/.test(value.text)

// Whether only white space stands before a position on its line.
export function firstOnLine(scanned: Scan, position: number): boolean {
  const line = lineAt(scanned, position)
  return scanned.codePoints.slice(line.start, position).every(isSpace)
}

// Whether a code point starts a value: a quote, a bracket, a digit, a sign, or the first letter of true, false, inf
// and nan. A key that starts so reads as a value where a value may stand, e.g. the n of `name` as the n of `nan`.
export const startsLikeValue = (character: string | undefined) => character !== undefined && /^["'[{0-9+\-tfin]$/.test(character)

// The container that directly holds a value, or null for the value of an entry on a line of the document.
export function holderOf(scanned: Scan, value: Part): Container | null {
  let holder: Container | null = null
  for (const container of scanned.containers) if (container.open < value.start && value.end <= container.close && (holder === null || container.depth > holder.depth)) holder = container
  return holder
}
