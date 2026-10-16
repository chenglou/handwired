// Lines as another language writes them: an entry as a member of a JSON object, a table as a block of YAML, an array
// as a YAML list, and a comment that starts with a semicolon or with two slashes.
import {type Edit, insertAt, removeRange, replaceOneForOne} from '../../../edits.ts'
import type {Random} from '../../../random.ts'
import {type Container, type Entry, type Scan, type Value, indentationOf, lineAt, lineEntries, onOneLine, restOfLine} from '../scan.ts'
import {colonEdits} from './separators.ts'
import {type KindDefinition, type Mistake, drawForm} from './types.ts'

const range = (from: number, to: number) => Array.from({length: Math.max(0, to - from)}, (_, offset) => from + offset)
const replaceWith = (at: number, remove: number, text: string): Edit => ({at, remove, insert: text})

// The edits that write a value as JSON does: every entry of an inline table in it as a member, and quotes for the
// apostrophes of a string. Returns undefined for a value that JSON cannot hold as it is, e.g. a string of several lines.
function jsonValueEdits(scanned: Scan, value: Value): Edit[] | undefined {
  if (value.type === 'string') {
    const part = value.string
    if (part.multiLine) return undefined
    if (part.quote === '"') return []
    if (/["\\]/.test(part.content)) return undefined
    return [replaceOneForOne(part.start, '"'), replaceOneForOne(part.end - 1, '"')]
  }
  if (value.type !== 'array' && value.type !== 'inlineTable') return []
  const edits: Edit[] = []
  for (const item of value.container.items) {
    const inner = jsonValueEdits(scanned, item.value)
    if (inner === undefined) return undefined
    edits.push(...inner)
  }
  for (const entry of value.container.entries) {
    const inner = jsonMemberEdits(scanned, entry)
    if (inner === undefined) return undefined
    edits.push(...inner)
  }
  return edits
}

// The edits that write an entry as a member of a JSON object: quotes around the key, a colon for the equals sign, and
// the value as JSON writes it. The quotes around a key without quotes are added. A key with a dot has no such form.
function jsonMemberEdits(scanned: Scan, entry: Entry): Edit[] | undefined {
  if (entry.key.parts.length !== 1) return undefined
  const key = entry.key.parts[0]!
  const edits: Edit[] = []
  if (!key.quoted) edits.push(insertAt(key.start, '"'), insertAt(key.end, '"'))
  else if (scanned.codePoints[key.start] === '\'') {
    if (/["\\]/.test(key.text)) return undefined
    edits.push(replaceOneForOne(key.start, '"'), replaceOneForOne(key.end - 1, '"'))
  }
  edits.push(...colonEdits(scanned, entry, true, true))
  const inner = jsonValueEdits(scanned, entry.value)
  if (inner === undefined) return undefined
  return [...edits, ...inner]
}

// Entries pasted from a JSON file: one, a few in a row, or every entry of a section with the braces of the object
// around them.
function jsonPastedIn(random: Random, scanned: Scan): Mistake | undefined {
  const endsItsLine = (entry: Entry) => {
    const rest = restOfLine(scanned, entry.value.end)
    return rest.onlySpace || rest.comment !== undefined
  }
  const fits = (entry: Entry) => endsItsLine(entry) && jsonMemberEdits(scanned, entry) !== undefined
  const sections = scanned.sections.filter(section => section.entries.length > 0 && section.entries.every(fits))
  const usable = lineEntries(scanned).filter(fits)
  if (usable.length === 0) return undefined
  const runs = scanned.sections.filter(section => section.entries.length >= 2 && section.entries.filter(fits).length >= 2)
  const bracedSections = sections.filter(section => section.entries.length <= 6 && lineAt(scanned, section.entries.at(-1)!.value.end).next > lineAt(scanned, section.entries.at(-1)!.value.end).end)
  const form = random.weighted([['one entry', 40], ['several entries in a row', runs.length > 0 ? 35 : 0], ['every entry of a section, between braces', bracedSections.length > 0 ? 25 : 0]] as const)
  if (form === 'one entry') {
    const entry = random.pick(usable)
    const comma = random.chance(0.8)
    return {edits: [...jsonMemberEdits(scanned, entry)!, ...(comma ? [insertAt(entry.value.end, ',')] : [])], form: `${form}${comma ? ', with a comma after it' : ''}`, reachable: 'yes'}
  }
  if (form === 'several entries in a row') {
    const section = random.pick(runs)
    // The longest stretches of entries that fit, of which one is taken, and of that up to four entries.
    const stretches: Entry[][] = []
    let stretch: Entry[] = []
    for (const entry of section.entries) {
      if (fits(entry)) stretch.push(entry)
      else {
        if (stretch.length >= 2) stretches.push(stretch)
        stretch = []
      }
    }
    if (stretch.length >= 2) stretches.push(stretch)
    if (stretches.length === 0) return undefined
    const chosen = random.pick(stretches)
    const count = random.integer(2, Math.min(4, chosen.length))
    const first = random.integer(0, chosen.length - count)
    const entries = chosen.slice(first, first + count)
    const lastComma = random.chance(0.3)
    const edits = entries.flatMap((entry, index) => [...jsonMemberEdits(scanned, entry)!, ...(index < entries.length - 1 || lastComma ? [insertAt(entry.value.end, ',')] : [])])
    return {edits, form: `${form}, ${entries.length} of them${lastComma ? ', the last one with a comma too' : ''}`, reachable: 'yes'}
  }
  const section = random.pick(bracedSections)
  const firstLine = lineAt(scanned, section.entries[0]!.key.start)
  const lastLine = lineAt(scanned, section.entries.at(-1)!.value.end)
  // A string of several lines in the section would get the indentation inside its text.
  if (scanned.strings.some(part => part.multiLine && part.start >= firstLine.start && part.end <= lastLine.end)) return undefined
  const outer = indentationOf(scanned, firstLine)
  const edits: Edit[] = [{...insertAt(firstLine.start, `${outer}{${scanned.lineEnd}`), rank: -1}, {...insertAt(lastLine.next, `${outer}}${scanned.lineEnd}`), rank: -1}]
  section.entries.forEach((entry, index) => {
    edits.push(...jsonMemberEdits(scanned, entry)!)
    if (index < section.entries.length - 1) edits.push(insertAt(entry.value.end, ','))
  })
  // The lines between the braces are indented by two more spaces, as a JSON file has them. An empty line stays empty.
  for (const line of scanned.lines) {
    if (line.start < firstLine.start || line.start > lastLine.start || line.end === line.start) continue
    edits.push(insertAt(line.start, '  '))
  }
  return {edits, form: `${form}, ${section.entries.length} of them`, reachable: 'yes'}
}

// A table as a block of YAML: the header's name with a colon after it, and below it the entries with colons, indented.
function yamlBlock(random: Random, scanned: Scan): Mistake | undefined {
  const fits = (entry: Entry) => onOneLine(scanned, entry)
  const blocks = scanned.sections.filter(section => section.header !== null && !section.header.array && section.header.name.parts.length === 1 && !section.header.name.parts[0]!.quoted
    && section.entries.length > 0 && section.entries.every(fits))
  if (blocks.length === 0) return undefined
  const every = blocks.length >= 2 && random.chance(0.4)
  const changed = every ? blocks : [random.pick(blocks)]
  const edits: Edit[] = []
  const unscoredKinds: number[] = []
  for (const section of changed) {
    const header = section.header!
    edits.push(removeRange(header.start, header.name.start), replaceWith(header.name.end, header.end - header.name.end, ':'))
    // At the first letter of the name nothing says that the line is a header: every parser shows a key.
    unscoredKinds.push(...range(header.name.start, header.name.end))
    for (const entry of section.entries) {
      const line = lineAt(scanned, entry.key.start)
      if (indentationOf(scanned, line) === '') edits.push(insertAt(line.start, '  '))
    }
  }
  // Every entry of a changed table gets a colon, also those of its inline tables, which YAML writes as { a: 1 }. With
  // every table as a block, the entries above the first header are written with colons too.
  const firstSection = scanned.sections[0]!
  for (const entry of scanned.entries) if (changed.includes(entry.section) || (every && entry.section === firstSection)) edits.push(...colonEdits(scanned, entry, true, true))
  return {edits, form: every ? `every table with a plain header, ${changed.length} of them` : `one table with ${changed[0]!.entries.length} ${changed[0]!.entries.length === 1 ? 'entry' : 'entries'}`, reachable: 'yes', unscoredKinds}
}

// An array as a YAML list: the key with a colon, and one line per value, each with a hyphen before it.
function yamlListItems(random: Random, scanned: Scan): Mistake | undefined {
  const {codePoints} = scanned
  const isBlank = (from: number, to: number) => codePoints.slice(from, to).every(character => character === ' ' || character === '\t')
  // A value that a YAML list item can be as it is. true and false are left out: after the hyphen, a word reads as a
  // second word of a key, see keyWithSpace.
  const plainItem = (value: Value) => value.type === 'number' || (value.type === 'string' && !value.string.multiLine)
  const onLines = (array: Container) => {
    // The opening bracket ends its line, every value starts a line, and the closing bracket has a line to itself.
    const closeLine = lineAt(scanned, array.close)
    return array.severalLines && restOfLine(scanned, array.open + 1).onlySpace && isBlank(closeLine.start, array.close) && restOfLine(scanned, array.close + 1).onlySpace
      && array.items.every(item => isBlank(lineAt(scanned, item.value.start).start, item.value.start))
  }
  const arrays = scanned.containers.filter(array => array.type === 'array' && array.depth === 1 && array.items.length > 0 && array.items.every(item => plainItem(item.value))
    && (onLines(array) || (!array.severalLines && !scanned.comments.some(comment => comment.start > array.open && comment.start < array.close))))
  if (arrays.length === 0) return undefined
  const array = random.pick(arrays)
  const edits = colonEdits(scanned, array.owner, true, false)
  if (array.severalLines) {
    edits.push(removeRange(array.owner.equals + 1, array.open + 1))
    for (const item of array.items) {
      edits.push(insertAt(item.value.start, '- '))
      if (item.commaAfter !== -1) edits.push(removeRange(item.commaAfter, item.commaAfter + 1))
    }
    const closeLine = lineAt(scanned, array.close)
    // The line of the closing bracket goes, with its line end, or with the line end before it when it is the text's last line.
    edits.push(closeLine.next > closeLine.end ? removeRange(closeLine.start, closeLine.next) : removeRange(closeLine.start - scanned.lineEnd.length, closeLine.end))
  } else {
    const itemStart = `${scanned.lineEnd}${indentationOf(scanned, lineAt(scanned, array.open))}  - `
    const first = array.items[0]!
    edits.push(removeRange(array.owner.equals + 1, first.value.start), insertAt(first.value.start, itemStart))
    for (let index = 1; index < array.items.length; index++) {
      const item = array.items[index]!
      edits.push(removeRange(array.items[index - 1]!.value.end, item.value.start), insertAt(item.value.start, itemStart))
    }
    edits.push(removeRange(array.items.at(-1)!.value.end, array.close + 1))
  }
  return {edits, form: `an array of ${array.items.length} ${array.items.length === 1 ? 'value' : 'values'} that the document has on ${array.severalLines ? 'several lines' : 'one line'}`, reachable: 'yes'}
}

const newComments = ['default', 'optional', 'in seconds', 'see the docs', 'do not change', 'TODO: revisit', 'was 3', 'dev only', 'added by ops', 'keep in sync with CI', 'not used yet', 'required'] as const

// A comment that starts with another mark than #: the comments of the document, or a new one.
function commentWithMark(random: Random, scanned: Scan, mark: string, name: string): Mistake | undefined {
  const {comments} = scanned
  const entries = lineEntries(scanned).filter(entry => {
    const rest = restOfLine(scanned, entry.value.end)
    return rest.onlySpace
  })
  const form = drawForm(random, [['one comment of the document', comments.length > 0 ? 50 : 0], ['every comment of the document', comments.length >= 2 ? 30 : 0], ['a new comment', entries.length > 0 ? (comments.length > 0 ? 20 : 100) : 0]] as const)
  if (form === undefined) return undefined
  if (form === 'a new comment') {
    const entry = random.pick(entries)
    const text = random.pick(newComments)
    if (random.chance(0.6)) {
      const line = lineAt(scanned, entry.key.start)
      return {edits: [insertAt(line.start, `${indentationOf(scanned, line)}${mark} ${text}${scanned.lineEnd}`)], form: `${form} on a line of its own, with ${name}`, reachable: 'yes'}
    }
    return {edits: [insertAt(entry.value.end, ` ${mark} ${text}`)], form: `${form} after a value, with ${name}`, reachable: 'yes'}
  }
  const ownLines = comments.filter(comment => comment.ownLine)
  const changed = form === 'every comment of the document' ? comments : [random.pick(ownLines.length > 0 && random.chance(0.7) ? ownLines : comments)]
  return {
    edits: changed.map(comment => replaceWith(comment.start, 1, mark)),
    form: `${form === 'every comment of the document' ? `${form}, ${changed.length} of them` : `${form}, ${changed[0]!.ownLine ? 'on a line of its own' : 'after a value'}`}, with ${name}`, reachable: 'yes',
  }
}

export const otherLanguageKinds: KindDefinition[] = [
  {
    name: 'jsonPastedIn', family: 'other language', weight: 3,
    description: 'Entries pasted from a JSON file: quotes around the key, a colon, a comma at the end of the line, and for a whole table the braces of the object.',
    meant: 'name = "tiny"\nversion = "0.4.1"\nprivate = true\n', example: '"name": "tiny",\n"version": "0.4.1",\nprivate = true\n',
    alignment: 'The quotes around a key and the commas are added and have no label. The colon stands for the equals sign. The braces are added on lines of their own, so the labels keep the depth 0 between them.',
    reachable: 'Yes: a key between quotes is valid TOML, the colon and the comma are as in colonForEquals and commaAtLineEnd, and a brace at the start of a line outside of every bracket is an error for the parser as it is, and can be skipped.',
    margin: 90,
    apply: jsonPastedIn,
  },
  {
    name: 'yamlBlock', family: 'other language', weight: 2,
    description: 'A table as a block of YAML: the name with a colon, and below it the entries with colons, indented.',
    meant: '[server]\nport = 8080\nhost = "localhost"\n', example: 'server:\n  port: 8080\n  host: "localhost"\n',
    alignment: 'The header\'s brackets are removed, and the colon after the name is added. The name keeps its label, header name, and its display kind is not scored. The indentation is added, and each colon of an entry stands for the equals sign.',
    reachable: 'Yes, apart from the name: at its first letter nothing says that the line is a header, so every parser shows a key. After the colon, the end of the line is as in valueLeftOut.',
    margin: 120,
    apply: yamlBlock,
  },
  {
    name: 'yamlListItems', family: 'other language', weight: 2,
    description: 'An array as a YAML list: the key with a colon, and one line per value with a hyphen before it.',
    meant: 'ports = [\n  8001,\n  8002,\n]\n', example: 'ports:\n  - 8001\n  - 8002\n',
    alignment: 'The brackets and the commas are removed, and the hyphens are added. The values keep their labels. The depth and the container are not scored from the removed bracket to the next bracket.',
    reachable: 'Yes for the display kinds, which is all that is scored up to the next bracket: the hyphen is a character of a key, and a quote or a digit after it starts a value as in missingEquals.',
    margin: 60,
    apply: yamlListItems,
  },
  {
    name: 'semicolonComment', family: 'other language', weight: 2,
    description: 'A comment that starts with a semicolon, as in an INI file: one comment of the document, every comment, or a new one.',
    meant: '# connection settings\nport = 8080\n', example: '; connection settings\nport = 8080\n',
    alignment: 'The semicolon is added and the # is removed. The comment\'s text keeps its label, comment. A new comment is added as a whole.',
    reachable: 'Yes: the semicolon is in the class `other`, where the tokenizer as it is gives up on the rest of the line, and the display table can show that rest as a comment. The same tokenizer cell reads the first character of an unquoted value such as `>=3.9`, and the grammar\'s state tells the two apart: a value is expected there, and here the start or the end of a line.',
    margin: 30,
    apply: (random, scanned) => commentWithMark(random, scanned, ';', 'a semicolon'),
  },
  {
    name: 'slashComment', family: 'other language', weight: 2,
    description: 'A comment that starts with two slashes, as in JavaScript or C: one comment of the document, every comment, or a new one.',
    meant: 'port = 8080 # default\n', example: 'port = 8080 // default\n',
    alignment: 'The two slashes are added and the # is removed. The comment\'s text keeps its label, comment. A new comment is added as a whole.',
    reachable: 'Yes, as for semicolonComment: the slash is in the class `other` too.',
    margin: 30,
    apply: (random, scanned) => commentWithMark(random, scanned, '//', 'two slashes'),
  },
]
