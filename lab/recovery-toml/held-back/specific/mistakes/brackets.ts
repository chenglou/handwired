// A bracket of a header, of an array or of an inline table that is missing or one too many, and an inline table that
// is written on several lines.
import {type Edit, insertAt, removeRange, replaceOneForOne} from '../../../edits.ts'
import type {Random} from '../../../random.ts'
import {type Container, type Scan, indentationOf, lineAt, lineEntries, restOfLine, startsLikeValue} from '../scan.ts'
import type {KindDefinition, Mistake, Reachable} from './types.ts'

// What stands after a position, past white space and comments: a header, an entry, or the end of the text.
function whatFollows(scanned: Scan, position: number): 'a header' | 'an entry' | 'the end' {
  const header = scanned.headers.find(candidate => candidate.start >= position)
  const entry = lineEntries(scanned).find(candidate => candidate.key.start >= position)
  if (header === undefined && entry === undefined) return 'the end'
  return header !== undefined && (entry === undefined || header.start < entry.key.start) ? 'a header' : 'an entry'
}

function missingHeaderBracket(random: Random, scanned: Scan): Mistake | undefined {
  const headers = scanned.headers.filter(header => !header.array)
  if (headers.length === 0) return undefined
  const header = random.pick(headers)
  if (random.chance(0.7)) return {edits: [removeRange(header.end - 1, header.end)], form: 'the closing bracket', reachable: 'yes'}
  return {edits: [removeRange(header.start, header.start + 1)], form: 'the opening bracket', reachable: 'yes'}
}

// [[name] or [name]]: one bracket too few around the header of an array of tables, or one too many around the header
// of a table.
function unbalancedDoubleBracket(random: Random, scanned: Scan): Mistake | undefined {
  const doubled = scanned.headers.filter(header => header.array)
  const single = scanned.headers.filter(header => !header.array)
  if (doubled.length > 0 && (single.length === 0 || random.chance(0.75))) {
    const header = random.pick(doubled)
    if (random.chance(0.6)) return {edits: [removeRange(header.end - 1, header.end)], form: '[[name] for [[name]]', reachable: 'yes'}
    return {edits: [removeRange(header.start, header.start + 1)], form: '[name]] for [[name]]', reachable: 'yes'}
  }
  if (single.length === 0) return undefined
  const header = random.pick(single)
  if (random.chance(0.6)) return {edits: [insertAt(header.end, ']')], form: '[name]] for [name]', reachable: 'yes'}
  return {edits: [insertAt(header.start, '[')], form: '[[name] for [name]', reachable: 'yes'}
}

// The closing bracket of an array that is the value of an entry on a line of the document. When the bracket stands
// alone on its line, the line is missing.
function missingArrayBracket(random: Random, scanned: Scan): Mistake | undefined {
  const {codePoints} = scanned
  const arrays = scanned.containers.filter(container => container.type === 'array' && container.depth === 1 && whatFollows(scanned, container.close) !== 'the end')
  if (arrays.length === 0) return undefined
  const beforeEntry = arrays.filter(container => whatFollows(scanned, container.close) === 'an entry')
  const beforeHeader = arrays.filter(container => whatFollows(scanned, container.close) === 'a header')
  const beforeWhat = random.weighted([['an entry', beforeEntry.length > 0 ? 70 : 0], ['a header', beforeHeader.length > 0 ? 30 : 0]] as const)
  const array = random.pick(beforeWhat === 'an entry' ? beforeEntry : beforeHeader)
  const line = lineAt(scanned, array.close)
  const aloneOnLine = array.severalLines && codePoints.slice(line.start, array.close).every(character => character === ' ' || character === '\t') && restOfLine(scanned, array.close + 1).onlySpace
  const afterComma = array.items.length > 0 && array.items.at(-1)!.commaAfter !== -1
  let reachable: Reachable = 'yes'
  let why = ''
  if (beforeWhat === 'a header') {
    // After a comma, the header's bracket is read as an array inside the open array, by a cell that valid TOML reads,
    // and the label asks for depth 0 at that bracket. After a value, the bracket is an error, and can close the array.
    if (afterComma) {
      reachable = 'no'
      why = ', after a comma'
    }
  } else {
    // A key that starts like a value reads as the next value of the array: by a cell that valid TOML reads after a
    // comma, and as after missingCommaInArray otherwise.
    const next = lineEntries(scanned).find(entry => entry.key.start >= array.close)!
    if (startsLikeValue(codePoints[next.key.start])) {
      reachable = 'no'
      why = ' whose key starts like a value'
    }
  }
  return {
    edits: [aloneOnLine ? removeRange(line.start, line.next) : removeRange(array.close, array.close + 1)],
    form: `an array on ${array.severalLines ? 'several lines' : 'one line'}, ${beforeWhat} follows${why}`, reachable,
  }
}

function missingCloseBrace(random: Random, scanned: Scan): Mistake | undefined {
  const tables = scanned.containers.filter(container => {
    if (container.type !== 'inlineTable' || container.depth !== 1 || container.severalLines) return false
    const rest = restOfLine(scanned, container.close + 1)
    return (rest.onlySpace || rest.comment !== undefined) && whatFollows(scanned, container.close) !== 'the end'
  })
  if (tables.length === 0) return undefined
  const table = random.pick(tables)
  return {edits: [removeRange(table.close, table.close + 1)], form: `${whatFollows(scanned, table.close)} follows`, reachable: 'yes'}
}

// An inline table with one entry per line, as JSON writes an object and as TOML 1.1 allows.
function inlineTableOnSeveralLines(random: Random, scanned: Scan): Mistake | undefined {
  const {codePoints} = scanned
  const tables = scanned.containers.filter(container => container.type === 'inlineTable' && container.depth === 1 && !container.severalLines && container.entries.length > 0)
  if (tables.length === 0) return undefined
  const larger = tables.filter(container => container.entries.length >= 2)
  const table: Container = random.pick(larger.length > 0 && random.chance(0.8) ? larger : tables)
  const outer = indentationOf(scanned, lineAt(scanned, table.open))
  const inner = `${outer}${outer.includes('\t') ? '\t' : random.pick(['  ', '  ', '    '])}`
  // A line end at `at`, with `indentation` after it. A space that stands there becomes the line end: white space
  // stands for white space. In a document whose lines end with a carriage return and a line feed, the two are added.
  const lineBreak = (at: number, indentation: string): Edit[] => {
    if (codePoints[at] !== ' ') return [insertAt(at, `${scanned.lineEnd}${indentation}`)]
    if (scanned.lineEnd === '\n') return [replaceOneForOne(at, '\n'), insertAt(at + 1, indentation)]
    return [removeRange(at, at + 1), insertAt(at + 1, `${scanned.lineEnd}${indentation}`)]
  }
  const edits = [...lineBreak(table.open + 1, inner)]
  for (const entry of table.entries) if (entry.commaAfter !== -1) edits.push(...lineBreak(entry.commaAfter + 1, inner))
  const beforeClose = codePoints[table.close - 1] === ' ' ? table.close - 1 : table.close
  edits.push(...lineBreak(beforeClose, outer))
  return {edits, form: `an inline table with ${table.entries.length} ${table.entries.length === 1 ? 'entry' : 'entries'}`, reachable: 'yes'}
}

export const bracketKinds: KindDefinition[] = [
  {
    name: 'missingHeaderBracket', family: 'bracket', weight: 2,
    description: 'A header without its closing or its opening bracket.',
    meant: '[server]\nport = 8080\n', example: '[server\nport = 8080\n',
    alignment: 'The bracket is removed. Everything else is kept. A header\'s brackets open nothing, so the depth is scored as before.',
    reachable: 'Yes: without the closing bracket, the end of the line is an error for the parser as it is, and can end the header. Without the opening bracket, the name reads as a key up to the closing bracket, where the first error is, so its display kind is not scored, and the bracket can be skipped.',
    apply: missingHeaderBracket,
  },
  {
    name: 'unbalancedDoubleBracket', family: 'bracket', weight: 2,
    description: 'One bracket too few around the header of an array of tables, or one too many around the header of a table: `[[name]` or `[name]]`.',
    meant: '[[plugins]]\nname = "auth"\n', example: '[[plugins]\nname = "auth"\n',
    alignment: 'One bracket is removed, or added without a label. Of two equal brackets the later one is the removed or the added one.',
    reachable: 'Yes: after `[[name]`, the end of the line is an error for the parser as it is, and can end the header. After `[name]]`, the second closing bracket is an error, and can be skipped.',
    margin: 1,
    apply: unbalancedDoubleBracket,
  },
  {
    name: 'missingArrayBracket', family: 'bracket', weight: 3,
    description: 'An array without its closing bracket, on one line or on several, before an entry or before a header.',
    meant: 'ports = [8001, 8002]\nhost = "localhost"\n', example: 'ports = [8001, 8002\nhost = "localhost"\n',
    alignment: 'The bracket is removed, with its line when it stands alone on one. The depth and the container are not scored from there to the next bracket.',
    reachable: 'Yes when an entry follows whose key starts with a letter other than t, f, i and n: such a word is no value, is an error inside an array, and can close the array and be the key. No when the key starts like a value, e.g. `name` like `nan`: it reads as the next value. Yes when a header follows a value: its bracket is an error there. No when a header follows a comma: its bracket is read as an array inside the open array, by a cell that valid TOML reads, and the label asks for depth 0.',
    apply: missingArrayBracket,
  },
  {
    name: 'missingCloseBrace', family: 'bracket', weight: 2,
    description: 'An inline table without its closing brace.',
    meant: 'serde = {version = "1.0", optional = true}\nlog = "0.4"\n', example: 'serde = {version = "1.0", optional = true\nlog = "0.4"\n',
    alignment: 'The brace is removed. The depth and the container are not scored from there to the next bracket.',
    reachable: 'Yes: a line end inside an inline table is an error for the parser as it is. The line end can be white space, and the key or the header of the next line, which stands where a comma is expected, can close the table.',
    apply: missingCloseBrace,
  },
  {
    name: 'inlineTableOnSeveralLines', family: 'bracket', weight: 3,
    description: 'An inline table with one entry per line, as JSON writes an object. TOML 1.0 wants it on one line.',
    meant: 'serde = { version = "1.0", optional = true }\n', example: 'serde = {\n  version = "1.0",\n  optional = true\n}\n',
    alignment: 'Each line end stands for the space that the document has there, with its label: white space at depth 1 in an inline table. The indentation is added.',
    reachable: 'Yes: a line end inside an inline table is an error for the parser as it is, and can be white space, as in TOML 1.1.',
    margin: 60,
    apply: inlineTableOnSeveralLines,
  },
]
