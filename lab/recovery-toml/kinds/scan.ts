// Where the parts of a valid TOML document are, in code points: its lines, headers, entries, keys, values, strings,
// arrays, inline tables and comments. The kinds of mistakes pick their places from this, e.g. "the last entry below a
// header" or "a string that holds a backslash". It is what lab/recovery-parser/scan.ts is for JSON.
//
// The scan follows the grammar of ../reference.ts and reads none of its code. check.ts makes the labels of a document
// from the scan alone and compares them with the reference labeler's, so a part that the scan puts in the wrong place
// is found.

// A part of the text: from `start` to one before `end`.
export type Range = {start: number, end: number}

export type StringPart = Range & {
  quote: '"' | '\''
  // 1 for a string on one line, e.g. "a", and 3 for a string between three quotes, which may hold line feeds.
  quoteLength: 1 | 3
  role: 'value' | 'key' | 'header'
  // The escapes of a string between quotes, each from its backslash on, e.g. the six code points of é. In a
  // string between three quotes, a backslash at the end of a line with the white space and the line end after it.
  escapes: Range[]
}
// One part of a key, e.g. the `server` and the `"tls v2"` of `server."tls v2"`. `string` is null for a part without quotes.
export type KeyPart = Range & {string: StringPart | null}
export type Key = Range & {
  parts: KeyPart[]
  // The positions of the dots between the parts.
  dots: number[]
}
export type Value = Range & {
  // `date` is a date, a time or both. `boolean` is true or false. `number` is every other word, e.g. 8080, 0x1f, -inf.
  type: 'string' | 'number' | 'date' | 'boolean' | 'array' | 'inlineTable'
  string: StringPart | null
  // The array or the inline table, when the value is one.
  container: Container | null
  // The array or the inline table that the value stands in, or null for the value of an entry on a line of its own.
  within: Container | null
  // The entry that the value is the value of, or null for an item of an array.
  entry: Entry | null
}
// A key, an equals sign and a value: on a line of its own, or inside an inline table.
export type Entry = {
  key: Key
  equals: number
  value: Value
  // The inline table that the entry stands in, or null for an entry on a line of its own.
  within: Container | null
  // The entry's place among the entries of its inline table, or among the entries below its header.
  index: number
  // The position of the comma after the entry, or -1. An entry on a line of its own has none.
  commaAfter: number
  table: Table
}
export type Item = {value: Value, index: number, commaAfter: number}
export type Container = {
  type: 'array' | 'inlineTable'
  open: number
  close: number
  // 1 for a container that no other container holds.
  depth: number
  parent: Container | null
  // The values of an array, and the entries of an inline table. The other list is empty.
  items: Item[]
  entries: Entry[]
  // Whether a line end stands between the two brackets.
  severalLines: boolean
  value: Value
}
// `[name]` or `[[name]]`, from its first bracket to one past its last.
export type Header = Range & {
  double: boolean
  key: Key
  // The position of the first closing bracket.
  close: number
}
// A comment from its # to the end of its line, without the line end.
export type Comment = Range & {
  // True when only white space stands before the comment on its line.
  ownLine: boolean
  // The array that the comment stands in, or null.
  within: Container | null
}
// A header with the entries below it, or the entries above the first header, whose `header` is null.
export type Table = {header: Header | null, entries: Entry[]}
export type Line = {
  start: number
  // The position of the line end, or the text's length for a last line without one.
  end: number
  // The start of the next line: `end` plus the 1 or 2 code points of the line end.
  next: number
}
export type Scan = {
  text: string
  codePoints: string[]
  lineEnd: '\n' | '\r\n'
  lines: Line[]
  tables: Table[]
  headers: Header[]
  // The entries on lines of their own, in text order.
  entries: Entry[]
  // The entries of inline tables.
  inlineEntries: Entry[]
  // Every value, with the items of arrays and the values inside inline tables.
  values: Value[]
  strings: StringPart[]
  containers: Container[]
  comments: Comment[]
}

const isBareKeyCharacter = (character: string | undefined) => character !== undefined && /^[A-Za-z0-9_-]$/.test(character)
const isWordCharacter = (character: string | undefined) => character !== undefined && /^[A-Za-z0-9_+\-.:]$/.test(character)
export const isSpaceOrTab = (character: string | undefined) => character === ' ' || character === '\t'

// Scans a document that the reference labeler accepts. The result of scanning any other text is not defined.
export function scan(text: string): Scan {
  const codePoints = Array.from(text)
  const length = codePoints.length
  const scanned: Scan = {text, codePoints, lineEnd: text.includes('\r\n') ? '\r\n' : '\n', lines: [], tables: [], headers: [], entries: [], inlineEntries: [], values: [], strings: [], containers: [], comments: []}
  let index = 0
  let table: Table = {header: null, entries: []}
  scanned.tables.push(table)
  // The start of the line that is being read, to tell a comment on a line of its own from one after a value.
  let lineStart = 0

  const fail = (what: string): never => { throw new Error(`the scan expected ${what} at ${index} of ${JSON.stringify(text)}`) }
  const skipSpaces = () => { while (isSpaceOrTab(codePoints[index])) index++ }
  const lineEndLength = () => codePoints[index] === '\n' ? 1 : codePoints[index] === '\r' && codePoints[index + 1] === '\n' ? 2 : 0
  const endLine = () => {
    const end = index
    index += lineEndLength()
    scanned.lines.push({start: lineStart, end, next: index})
    lineStart = index
  }
  const readComment = (within: Container | null) => {
    const start = index
    while (index < length && codePoints[index] !== '\n' && codePoints[index] !== '\r') index++
    scanned.comments.push({start, end: index, ownLine: codePoints.slice(lineStart, start).every(isSpaceOrTab), within})
  }
  const skipSpacesCommentsAndLines = (within: Container) => {
    for (;;) {
      skipSpaces()
      if (codePoints[index] === '#') readComment(within)
      if (lineEndLength() === 0) return
      endLine()
    }
  }

  const readString = (role: StringPart['role'], mayHaveThreeQuotes: boolean): StringPart => {
    const start = index
    const quote = codePoints[index] as '"' | '\''
    const escapes: Range[] = []
    const threeQuotes = mayHaveThreeQuotes && codePoints[index + 1] === quote && codePoints[index + 2] === quote
    index += threeQuotes ? 3 : 1
    for (;;) {
      const character = codePoints[index]
      if (character === undefined) fail('the end of a string')
      if (character === quote) {
        if (!threeQuotes) {
          index++
          break
        }
        // Three quotes close the string, and up to two quotes may stand right before them.
        let run = 1
        while (codePoints[index + run] === quote) run++
        index += Math.min(run, 5)
        if (run >= 3) break
      } else if (character === '\\' && quote === '"') {
        const escapeStart = index
        index++
        const escaped = codePoints[index]
        if (escaped === 'u') index += 5
        else if (escaped === 'U') index += 9
        else if (escaped !== undefined && 'btnfr"\\'.includes(escaped)) index++
        else {
          while (isSpaceOrTab(codePoints[index])) index++
          if (lineEndLength() === 0) fail('an escape')
          // The line end after such a backslash is shown as string, and it ends a line of the text like any other.
          const escapeEnd = index
          endLine()
          escapes.push({start: escapeStart, end: escapeEnd})
          continue
        }
        escapes.push({start: escapeStart, end: index})
      } else if (lineEndLength() > 0) endLine()
      else index++
    }
    const part: StringPart = {start, end: index, quote, quoteLength: threeQuotes ? 3 : 1, role, escapes}
    scanned.strings.push(part)
    return part
  }

  // A key. After it, `index` stands after the white space that follows the key.
  const readKey = (role: 'key' | 'header'): Key => {
    const start = index
    const parts: KeyPart[] = []
    const dots: number[] = []
    for (;;) {
      const character = codePoints[index]
      if (character === '"' || character === '\'') {
        const string = readString(role, false)
        parts.push({start: string.start, end: string.end, string})
      } else {
        const partStart = index
        while (isBareKeyCharacter(codePoints[index])) index++
        if (index === partStart) fail('a key')
        parts.push({start: partStart, end: index, string: null})
      }
      const end = index
      skipSpaces()
      if (codePoints[index] !== '.') return {start, end, parts, dots}
      dots.push(index)
      index++
      skipSpaces()
    }
  }

  const readValue = (within: Container | null, entry: Entry | null): Value => {
    const start = index
    const character = codePoints[index]
    const value: Value = {type: 'number', start, end: start, string: null, container: null, within, entry}
    scanned.values.push(value)
    if (character === '"' || character === '\'') {
      value.type = 'string'
      value.string = readString('value', true)
    } else if (character === '[' || character === '{') {
      const container: Container = {type: character === '[' ? 'array' : 'inlineTable', open: index, close: -1, depth: (within?.depth ?? 0) + 1, parent: within, items: [], entries: [], severalLines: false, value}
      scanned.containers.push(container)
      value.type = container.type
      value.container = container
      index++
      if (container.type === 'array') readItems(container)
      else readInlineEntries(container)
      container.close = index
      index++
      container.severalLines = codePoints.slice(container.open, container.close).includes('\n')
    } else {
      let end = index
      while (isWordCharacter(codePoints[end])) end++
      if (end === index) fail('a value')
      let word = codePoints.slice(index, end).join('')
      // A date, one space and a digit: the time follows.
      if (/^\d{4}-\d{2}-\d{2}$/.test(word) && codePoints[end] === ' ' && /^\d$/.test(codePoints[end + 1] ?? '')) {
        end++
        while (isWordCharacter(codePoints[end])) end++
        word = codePoints.slice(index, end).join('')
      }
      value.type = word === 'true' || word === 'false' ? 'boolean' : /^\d{4}-\d{2}-\d{2}/.test(word) || /^\d{2}:\d{2}/.test(word) ? 'date' : 'number'
      index = end
    }
    value.end = index
    return value
  }

  const readItems = (container: Container) => {
    for (;;) {
      skipSpacesCommentsAndLines(container)
      if (codePoints[index] === ']') return
      const item: Item = {value: readValue(container, null), index: container.items.length, commaAfter: -1}
      container.items.push(item)
      skipSpacesCommentsAndLines(container)
      if (codePoints[index] === ',') {
        item.commaAfter = index
        index++
      } else if (codePoints[index] !== ']') fail('a comma or the ] of an array')
    }
  }

  const readEntry = (within: Container | null, place: number): Entry => {
    const key = readKey('key')
    if (codePoints[index] !== '=') fail('an equals sign')
    const entry = {key, equals: index, within, index: place, commaAfter: -1, table} as Entry
    index++
    skipSpaces()
    entry.value = readValue(within, entry)
    return entry
  }

  const readInlineEntries = (container: Container) => {
    skipSpaces()
    if (codePoints[index] === '}') return
    for (;;) {
      const entry = readEntry(container, container.entries.length)
      container.entries.push(entry)
      scanned.inlineEntries.push(entry)
      skipSpaces()
      if (codePoints[index] === '}') return
      if (codePoints[index] !== ',') fail('a comma or the } of an inline table')
      entry.commaAfter = index
      index++
      skipSpaces()
    }
  }

  while (index < length) {
    skipSpaces()
    const character = codePoints[index]
    if (character === '[') {
      const start = index
      const double = codePoints[index + 1] === '['
      index += double ? 2 : 1
      skipSpaces()
      const key = readKey('header')
      if (codePoints[index] !== ']') fail('the ] of a header')
      const header: Header = {start, end: index + (double ? 2 : 1), double, key, close: index}
      index = header.end
      scanned.headers.push(header)
      table = {header, entries: []}
      scanned.tables.push(table)
    } else if (character !== undefined && character !== '#' && character !== '\n' && character !== '\r') {
      const entry = readEntry(null, table.entries.length)
      table.entries.push(entry)
      scanned.entries.push(entry)
    }
    skipSpaces()
    if (codePoints[index] === '#') readComment(null)
    if (index < length && lineEndLength() === 0) fail('the end of a line')
    if (index < length || index > lineStart) endLine()
  }
  return scanned
}

// The line that a position stands in. A position on a line end belongs to the line that it ends.
export function lineAt(scanned: Scan, position: number): Line {
  let low = 0
  let high = scanned.lines.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (scanned.lines[middle]!.next <= position) low = middle + 1
    else high = middle
  }
  return scanned.lines[low]!
}
export const lineIndexAt = (scanned: Scan, position: number) => scanned.lines.indexOf(lineAt(scanned, position))

// The white space that the line of a position starts with, e.g. two spaces below an indented header.
export function indentationAt(scanned: Scan, position: number): string {
  const line = lineAt(scanned, position)
  let end = line.start
  while (end < line.end && isSpaceOrTab(scanned.codePoints[end])) end++
  return scanned.codePoints.slice(line.start, end).join('')
}

// Whether only white space stands between a position and the end of its line.
export function lastOnLine(scanned: Scan, position: number): boolean {
  const line = lineAt(scanned, position)
  return scanned.codePoints.slice(position, line.end).every(isSpaceOrTab)
}
// Whether only white space stands between the start of a position's line and the position.
export function firstOnLine(scanned: Scan, position: number): boolean {
  const line = lineAt(scanned, position)
  return scanned.codePoints.slice(line.start, position).every(isSpaceOrTab)
}

// The comment that stands after a position on the position's line, or undefined.
export function commentAfter(scanned: Scan, position: number): Comment | undefined {
  const line = lineAt(scanned, position)
  return scanned.comments.find(comment => comment.start >= position && comment.start < line.end)
}

// Whether an entry on a line of its own stands on one line, with its key first on the line.
export const onOneLine = (scanned: Scan, entry: Entry) => lineAt(scanned, entry.key.start) === lineAt(scanned, entry.value.end)

// The text of a part.
export const textOf = (scanned: Scan, part: Range) => scanned.codePoints.slice(part.start, part.end).join('')
// The text between the quotes of a string, as written, e.g. with its backslashes.
export const contentOf = (scanned: Scan, string: StringPart) => scanned.codePoints.slice(string.start + string.quoteLength, string.end - string.quoteLength).join('')
