// Where the parts of a valid JSON text are, in code points: strings, numbers, literals, containers, and the entries of
// each container with their keys, colons and commas. The damage kinds and the typing replays pick their places from
// this, e.g. "the last member of an object that spans several lines".
//
// An entry is a member of an object, i.e. a key, a colon and a value, or an item of an array.

export type StringPart = {
  // The opening quote, and one past the closing quote.
  start: number
  end: number
  role: 'key' | 'value'
  // The entry the string is the key or the value of, or null for a string that is the whole document.
  entry: Entry | null
  // The text between the quotes, as written, e.g. with its backslashes.
  content: string
  // Whether the content holds a backslash.
  hasEscape: boolean
}
export type Value = {
  type: 'string' | 'number' | 'literal' | 'object' | 'array'
  start: number
  // One past the value's last code point.
  end: number
  entry: Entry | null
  // The container, when the value is one.
  container: Container | null
}
export type Entry = {
  container: Container
  // The entry's place among its container's entries.
  index: number
  key: StringPart | null
  // The colon's position, or -1 for an item of an array.
  colon: number
  value: Value
  // The key's opening quote for a member, the value's start for an item.
  start: number
  end: number
  // The position of the comma after the entry, or -1 for the last entry.
  commaAfter: number
}
export type Container = {
  type: 'object' | 'array'
  open: number
  close: number
  // The number of open containers inside it, e.g. 1 for the top-level container.
  depth: number
  parent: Container | null
  entries: Entry[]
  value: Value
  // Whether the closing bracket is the first code point of its line that is not whitespace, as an indented layout writes it.
  severalLines: boolean
}
export type Scan = {
  text: string
  codePoints: string[]
  root: Value
  strings: StringPart[]
  numbers: Value[]
  literals: Value[]
  containers: Container[]
  entries: Entry[]
  // Whether the text has a line feed between its first and its last token.
  severalLines: boolean
  maximumDepth: number
}

const isWhitespace = (character: string | undefined) => character === ' ' || character === '\t' || character === '\n' || character === '\r'

// Scans a text that JSON.parse accepts. The result of scanning any other text is not defined.
export function scan(text: string): Scan {
  const codePoints = Array.from(text)
  const result: Scan = {text, codePoints, root: undefined as unknown as Value, strings: [], numbers: [], literals: [], containers: [], entries: [], severalLines: false, maximumDepth: 0}
  let index = 0
  const skipWhitespace = () => {
    while (isWhitespace(codePoints[index])) index++
  }
  const readString = (role: 'key' | 'value', entry: Entry | null): StringPart => {
    const start = index
    index++
    let hasEscape = false
    while (codePoints[index] !== '"') {
      if (codePoints[index] === '\\') {
        hasEscape = true
        index++
      }
      index++
    }
    index++
    const part: StringPart = {start, end: index, role, entry, content: codePoints.slice(start + 1, index - 1).join(''), hasEscape}
    result.strings.push(part)
    return part
  }
  const readValue = (entry: Entry | null, parent: Container | null): Value => {
    const character = codePoints[index]!
    const value: Value = {type: 'literal', start: index, end: index, entry, container: null}
    if (character === '"') {
      value.type = 'string'
      readString('value', entry)
    } else if (character === '{' || character === '[') {
      const container: Container = {
        type: character === '{' ? 'object' : 'array', open: index, close: -1, depth: (parent?.depth ?? 0) + 1, parent, entries: [], value, severalLines: false,
      }
      value.type = container.type
      value.container = container
      result.containers.push(container)
      result.maximumDepth = Math.max(result.maximumDepth, container.depth)
      index++
      skipWhitespace()
      while (codePoints[index] !== '}' && codePoints[index] !== ']') {
        const item: Entry = {container, index: container.entries.length, key: null, colon: -1, value: undefined as unknown as Value, start: index, end: index, commaAfter: -1}
        if (container.type === 'object') {
          item.key = readString('key', item)
          skipWhitespace()
          item.colon = index
          index++
          skipWhitespace()
        }
        item.value = readValue(item, container)
        item.end = index
        container.entries.push(item)
        result.entries.push(item)
        skipWhitespace()
        if (codePoints[index] === ',') {
          item.commaAfter = index
          index++
          skipWhitespace()
        }
      }
      container.close = index
      index++
      container.severalLines = firstOnLine(codePoints, container.close) && lineStart(codePoints, container.close) > container.open
    } else if (character === 't' || character === 'f' || character === 'n') {
      index += character === 'f' ? 5 : 4
      result.literals.push(value)
    } else {
      value.type = 'number'
      while (index < codePoints.length && '+-.eE0123456789'.includes(codePoints[index]!)) index++
      result.numbers.push(value)
    }
    value.end = index
    return value
  }
  skipWhitespace()
  result.root = readValue(null, null)
  result.severalLines = codePoints.slice(result.root.start, result.root.end).includes('\n')
  return result
}

// The index of the first code point of the line that holds `position`.
export function lineStart(codePoints: readonly string[], position: number) {
  let start = position
  while (start > 0 && codePoints[start - 1] !== '\n') start--
  return start
}
// The index of the line feed that ends the line of `position`, or the text's length.
export function lineEnd(codePoints: readonly string[], position: number) {
  let end = position
  while (end < codePoints.length && codePoints[end] !== '\n') end++
  return end
}
// The spaces and tabs at the start of the line that holds `position`.
export function indentationAt(codePoints: readonly string[], position: number) {
  const start = lineStart(codePoints, position)
  let end = start
  while (codePoints[end] === ' ' || codePoints[end] === '\t') end++
  return codePoints.slice(start, end).join('')
}
// Whether only spaces and tabs come before `position` on its line.
export function firstOnLine(codePoints: readonly string[], position: number) {
  let index = position - 1
  while (index >= 0 && (codePoints[index] === ' ' || codePoints[index] === '\t')) index--
  return index < 0 || codePoints[index] === '\n'
}
// Whether only spaces, tabs and a carriage return come between `position` and the end of its line.
export function lastOnLine(codePoints: readonly string[], position: number) {
  let index = position
  while (codePoints[index] === ' ' || codePoints[index] === '\t' || codePoints[index] === '\r') index++
  return index >= codePoints.length || codePoints[index] === '\n'
}
// Whether an entry has a line to itself: it starts its line, and after it only its comma comes before the line's end.
export function hasOwnLine(codePoints: readonly string[], entry: Entry) {
  return firstOnLine(codePoints, entry.start) && lastOnLine(codePoints, entry.commaAfter === -1 ? entry.end : entry.commaAfter + 1)
}
// The index of the first code point at or after `position` that is not whitespace, or the text's length.
export function nextToken(codePoints: readonly string[], position: number) {
  let index = position
  while (isWhitespace(codePoints[index])) index++
  return index
}
// The index of the last code point before `position` that is not whitespace, or -1.
export function previousToken(codePoints: readonly string[], position: number) {
  let index = position - 1
  while (index >= 0 && isWhitespace(codePoints[index])) index--
  return index
}
// The containers that are open at `position`, outermost first: those whose opening bracket is before it and whose
// closing bracket is at or after it.
export function openContainersAt(scanned: Scan, position: number) {
  return scanned.containers.filter(container => container.open < position && container.close >= position)
}

// A key that a JavaScript author can write without quotes, e.g. name or $ref, and not editor.fontSize.
export const isWordKey = (content: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(content)

export {isWhitespace}
