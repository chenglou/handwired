// The sign between a key and its value is another one, is typed twice or is missing, and a comma is missing or stands
// where TOML takes none.
import {type Edit, insertAt, removeRange, replaceOneForOne} from '../../../edits.ts'
import type {Random} from '../../../random.ts'
import {type Entry, type Scan, lineEntries, restOfLine} from '../scan.ts'
import {type KindDefinition, type KindOptions, type Mistake, drawForm} from './types.ts'

const isSpace = (character: string | undefined) => character === ' ' || character === '\t'

// The edits that write one entry with a colon: the colon stands for the equals sign. `tight` takes the white space
// before the sign away, as YAML and JSON write a key, and `spaced` puts a space after a colon that has none.
export function colonEdits(scanned: Scan, entry: Entry, tight: boolean, spaced: boolean): Edit[] {
  const {codePoints} = scanned
  const edits: Edit[] = []
  let spaceStart = entry.equals
  while (isSpace(codePoints[spaceStart - 1])) spaceStart--
  if (tight && spaceStart < entry.equals) edits.push(removeRange(spaceStart, entry.equals))
  edits.push(replaceOneForOne(entry.equals, ':'))
  if (spaced && !isSpace(codePoints[entry.equals + 1])) edits.push(insertAt(entry.equals + 1, ' '))
  return edits
}

function colonForEquals(random: Random, scanned: Scan, options: KindOptions = {}): Mistake | undefined {
  const onLines = lineEntries(scanned)
  const sections = scanned.sections.filter(section => section.entries.length >= 2)
  const inlineTables = scanned.containers.filter(container => container.type === 'inlineTable' && container.entries.length > 0)
  const form = options.scope ?? drawForm(random, [
    ['one entry', onLines.length > 0 ? 45 : 0], ['every entry of one section', sections.length > 0 ? 22 : 0], ['every entry of the text', scanned.entries.length > 1 ? 23 : 0],
    ['the entries of one inline table', inlineTables.length > 0 ? 10 : 0],
  ] as const)
  if (form === undefined) return undefined
  // Nine writers in ten write `key: value`, and the others keep the white space as it was.
  const tight = random.chance(0.9)
  const changed: Entry[] = form === 'one entry' ? [random.pick(onLines)]
    : form === 'every entry of one section' ? random.pick(sections).entries
    : form === 'the entries of one inline table' ? random.pick(inlineTables).entries
    : scanned.entries
  if (changed.length === 0) return undefined
  return {edits: changed.flatMap(entry => colonEdits(scanned, entry, tight, tight)), form: `${form}${form === 'one entry' ? '' : `, ${changed.length} of them`}${tight ? '' : ', with the white space as it was'}`, reachable: 'yes'}
}

function doubledEquals(random: Random, scanned: Scan): Mistake | undefined {
  if (scanned.entries.length === 0) return undefined
  const onLines = lineEntries(scanned)
  const entry = random.pick(onLines.length > 0 && random.chance(0.85) ? onLines : scanned.entries)
  const {equals} = entry
  const [edit, form] = random.weighted<[Edit, string]>([
    [[insertAt(equals + 1, '='), '== for ='], 55], [[insertAt(equals + 1, ' ='), '= = for ='], 10], [[insertAt(equals + 1, '>'), '=> for ='], 20], [[insertAt(equals, ':'), ':= for ='], 15],
  ])
  return {edits: [edit], form: `${form}${entry.container === null ? '' : ', in an inline table'}`, reachable: 'yes'}
}

// The equals sign is missing, and white space is left between the key and the value. A value that is true or false
// is left out: after `debug true`, nothing says whether `true` is the value or a second word of the key, see keyWithSpace.
function missingEquals(random: Random, scanned: Scan): Mistake | undefined {
  const {codePoints} = scanned
  const candidates = lineEntries(scanned).filter(entry => entry.value.type !== 'literal' && (isSpace(codePoints[entry.equals - 1]) || isSpace(codePoints[entry.equals + 1])))
  if (candidates.length === 0) return undefined
  const entry = random.pick(candidates)
  const bothSides = isSpace(codePoints[entry.equals - 1]) && isSpace(codePoints[entry.equals + 1])
  const what = entry.value.type === 'string' ? 'a string' : entry.value.type === 'number' ? 'a number' : entry.value.type === 'array' ? 'an array' : 'an inline table'
  return {edits: [removeRange(entry.equals, entry.equals + (bothSides ? 2 : 1))], form: `before ${what}`, reachable: 'yes'}
}

function missingCommaInArray(random: Random, scanned: Scan): Mistake | undefined {
  const {codePoints} = scanned
  const isLineEnd = (character: string | undefined) => character === '\n' || character === '\r'
  const commas: {at: number, lineEnd: boolean, wordFollows: boolean}[] = []
  for (const container of scanned.containers) {
    for (const item of container.items) {
      const after = codePoints[item.commaAfter + 1]
      // Without white space after the comma, the two values would run into one, e.g. [80443].
      if (item.commaAfter === -1 || item.index === container.items.length - 1 || !(isSpace(after) || isLineEnd(after))) continue
      commas.push({at: item.commaAfter, lineEnd: isLineEnd(after), wordFollows: /[a-z]/.test(codePoints[container.items[item.index + 1]!.value.start]!)})
    }
  }
  if (commas.length === 0) return undefined
  const atLineEnds = commas.filter(comma => comma.lineEnd)
  const comma = random.pick(atLineEnds.length > 0 && random.chance(0.5) ? atLineEnds : commas)
  // A word at the start of a line, where a comma is expected, is the key of the next entry after missingArrayBracket.
  const wordAtLineStart = comma.lineEnd && comma.wordFollows
  return {
    edits: [removeRange(comma.at, comma.at + 1)],
    form: `${comma.lineEnd ? 'at a line end, between two values of an array on several lines' : 'between two values on one line'}${wordAtLineStart ? ', the next value is a word' : ''}`, reachable: wordAtLineStart ? 'no' : 'yes',
  }
}

// A comma or a semicolon after an entry, as a line of JSON or of JavaScript ends.
function commaAtLineEnd(random: Random, scanned: Scan): Mistake | undefined {
  const endsItsLine = (entry: Entry) => {
    const rest = restOfLine(scanned, entry.value.end)
    return rest.onlySpace || rest.comment !== undefined
  }
  const candidates = lineEntries(scanned).filter(endsItsLine)
  if (candidates.length === 0) return undefined
  const sections = scanned.sections.map(section => section.entries.filter(endsItsLine)).filter(entries => entries.length >= 2)
  const mark = random.chance(0.65) ? ',' : ';'
  const every = sections.length > 0 && random.chance(0.3)
  const changed = every ? random.pick(sections) : [random.pick(candidates)]
  return {edits: changed.map(entry => insertAt(entry.value.end, mark)), form: `${mark === ',' ? 'a comma' : 'a semicolon'} after ${every ? `every entry of one section, ${changed.length} of them` : 'one entry'}`, reachable: 'yes'}
}

function trailingCommaInInlineTable(random: Random, scanned: Scan): Mistake | undefined {
  const tables = scanned.containers.filter(container => container.type === 'inlineTable' && container.entries.length > 0)
  if (tables.length === 0) return undefined
  const every = tables.length >= 2 && random.chance(0.3)
  const changed = every ? tables : [random.pick(tables)]
  return {edits: changed.map(table => insertAt(table.entries.at(-1)!.value.end, ',')), form: every ? `every inline table of the text, ${changed.length} of them` : 'one inline table', reachable: 'yes'}
}

export const separatorKinds: KindDefinition[] = [
  {
    name: 'colonForEquals', family: 'separator', weight: 3,
    description: 'A colon in the place of the equals sign, as YAML and JSON write an entry: in one entry, in every entry of a table or of the text, or in an inline table.',
    meant: 'port = 8080\nhost = "localhost"\n', example: 'port: 8080\nhost = "localhost"\n',
    alignment: 'The colon stands for the equals sign and has its label, punctuation. The white space before the equals sign is removed.',
    reachable: 'Yes. After a key, the colon is read by a cell that no valid text reads: the tokenizer as it is gives up on the rest of the line there, and the cell can do what the cell of the equals sign does. A key that is a number is the exception: `12:` is the start of a time.',
    margin: 30,
    apply: colonForEquals,
  },
  {
    name: 'doubledEquals', family: 'separator', weight: 2,
    description: 'The equals sign typed twice, or written as the assignment of another language: `==`, `= =`, `=>` or `:=`.',
    meant: 'debug = false\n', example: 'debug == false\n',
    alignment: 'The second sign is added and has no label. Of two equal signs the later one is the added one.',
    reachable: 'Yes: the second sign stands where a value or an equals sign is expected, which is an error for the parser as it is, and can be skipped. The `>` is in the class `other`, see semicolonComment.',
    margin: 2,
    apply: doubledEquals,
  },
  {
    name: 'missingEquals', family: 'separator', weight: 2,
    description: 'The equals sign is missing between a key and a value that is a string, a number, an array or an inline table.',
    meant: 'name = "tiny"\n', example: 'name "tiny"\n',
    alignment: 'The equals sign and one space are removed. Everything else is kept.',
    reachable: 'Yes for the values that the kind takes: after a key and white space, a quote, a bracket, a digit or a sign is an error for the parser as it is, and can start the value. `true` and `false` are left out: a word after a key goes on with the key, see keyWithSpace.',
    apply: missingEquals,
  },
  {
    name: 'missingCommaInArray', family: 'separator', weight: 2,
    description: 'A comma is missing between two values of an array, on one line or at a line end.',
    meant: 'ports = [8001, 8002]\n', example: 'ports = [8001 8002]\n',
    alignment: 'The comma is removed. Everything else is kept.',
    reachable: 'Yes: a value where a comma is expected is an error for the parser as it is, and can be the next value. No when the comma is missing at a line end and the next value is a word, e.g. `true`: after missingArrayBracket, a word at that place is the key of the next entry.',
    apply: missingCommaInArray,
  },
  {
    name: 'commaAtLineEnd', family: 'separator', weight: 2,
    description: 'A comma or a semicolon after an entry, as a line of JSON or of JavaScript ends: after one entry, or after every entry of a table.',
    meant: 'name = "tiny"\nversion = "0.4.1"\n', example: 'name = "tiny",\nversion = "0.4.1"\n',
    alignment: 'The comma is added and has no label.',
    reachable: 'Yes: a comma after a value outside of every bracket is an error for the parser as it is, and can be skipped. The semicolon is in the class `other`, see semicolonComment.',
    margin: 12,
    apply: commaAtLineEnd,
  },
  {
    name: 'trailingCommaInInlineTable', family: 'separator', weight: 3,
    description: 'A comma after the last entry of an inline table, which an array allows and TOML 1.0 forbids here.',
    meant: 'serde = { version = "1.0", optional = true }\n', example: 'serde = { version = "1.0", optional = true, }\n',
    alignment: 'The comma is added and has no label.',
    reachable: 'Yes: a closing brace where a key is expected is an error for the parser as it is, and can close the inline table.',
    margin: 6,
    apply: trailingCommaInInlineTable,
  },
]
