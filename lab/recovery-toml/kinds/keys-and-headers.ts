// A key or a header that TOML does not read: a character that no key without quotes holds, a bracket of a header that
// is missing or extra, a header as another notation writes it, and an entry that is not typed to its end.
import {type Edit, insertAt, removeRange, replaceOneForOne} from '../edits.ts'
import type {Random} from '../random.ts'
import {chooseForm} from './assignment.ts'
import {type Entry, type Header, type Key, type KeyPart, type Scan, contentOf, firstOnLine, indentationAt, isSpaceOrTab, lastOnLine, lineAt, onOneLine} from './scan.ts'
import type {Damage, KindDefinition} from './types.ts'

const accented: Record<string, string> = {a: 'áäå', e: 'éè', i: 'íï', o: 'óöø', u: 'úü', n: 'ñ', c: 'ç'}
const barePartsOf = (key: Key) => key.parts.filter(part => part.string === null)

// Another sign in the place of a dot of a key or of a header's name: the sign's first or last character stands for
// the dot, and its other character is added.
function dotAs(sign: string, dot: number): Edit[] {
  switch (sign) {
    case '::': return [replaceOneForOne(dot, ':'), insertAt(dot + 1, ':')]
    case '->': return [insertAt(dot, '-'), replaceOneForOne(dot, '>')]
    case '][': return [replaceOneForOne(dot, ']'), insertAt(dot + 1, '[')]
    default: return [replaceOneForOne(dot, sign)]
  }
}

function bareKeyCharacter(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const keys = [...scanned.entries, ...scanned.inlineEntries].map(entry => entry.key)
  if (keys.length === 0) return undefined
  const positionsIn = (part: KeyPart, wanted: (character: string) => boolean) => Array.from({length: part.end - part.start - 2}, (_, offset) => part.start + 1 + offset).filter(position => wanted(codePoints[position]!))
  const withJoiner = keys.flatMap(barePartsOf).map(part => positionsIn(part, character => character === '_' || character === '-')).filter(positions => positions.length > 0)
  const quoted = keys.flatMap(key => key.parts).filter(part => part.string !== null && part.string.escapes.length === 0 && contentOf(scanned, part.string) !== '' && !/^[A-Za-z0-9_-]*$/.test(contentOf(scanned, part.string)))
  const dotted = keys.filter(key => key.dots.length > 0)
  const indexable = dotted.flatMap(key => key.dots.map((dot, index) => ({dot, next: key.parts[index + 1]!})).filter(({next}) => next.string === null))
  const withLetter = keys.flatMap(barePartsOf).map(part => Array.from({length: part.end - part.start}, (_, offset) => part.start + offset).filter(position => accented[codePoints[position]!] !== undefined)).filter(positions => positions.length > 0)
  const form = chooseForm(random, [
    ['a space in the place of _ or -', withJoiner.length > 0 ? 28 : 0], ['a key without its quotes', quoted.length > 0 ? 12 : 0], ['a sign before the key', 16], ['a sign after the key', 12],
    ['another sign in the place of a dot', dotted.length > 0 ? 10 : 0], ['index brackets in the place of a dot', indexable.length > 0 ? 12 : 0], ['a letter with an accent', withLetter.length > 0 ? 10 : 0],
    ['a dot too many', 6],
  ] as const)!
  switch (form) {
    case 'a space in the place of _ or -': {
      const positions = random.pick(withJoiner)
      const every = positions.length > 1 && random.chance(0.5)
      return {edits: (every ? positions : [random.pick(positions)]).map(position => replaceOneForOne(position, ' ')), form}
    }
    case 'a key without its quotes': {
      const part = random.pick(quoted)
      return {edits: [removeRange(part.start, part.start + 1), removeRange(part.end - 1, part.end)], form}
    }
    case 'a sign before the key': {
      const sign = random.weighted([['$', 30], ['@', 25], ['*', 10], ['!', 10], ['+', 10], ['%', 5], ['&', 5], ['~', 5]] as const)
      return {edits: [insertAt(random.pick(keys).start, sign)], form: `${sign} before a key`}
    }
    case 'a sign after the key': {
      const sign = random.weighted([['[]', 30], ['?', 20], ['!', 15], ['*', 15], ['()', 10], ['+', 10]] as const)
      return {edits: [insertAt(random.pick(keys).end, sign)], form: `${sign} after a key`}
    }
    case 'another sign in the place of a dot': {
      const sign = random.weighted([['/', 40], [':', 30], ['::', 15], ['->', 15]] as const)
      return {edits: random.pick(dotted).dots.flatMap(dot => dotAs(sign, dot)), form: `${sign} in the place of every dot of a key`}
    }
    case 'index brackets in the place of a dot': {
      // flags[dark-mode] or flags["dark-mode"] for flags.dark-mode: the opening bracket stands for the dot.
      const {dot, next} = random.pick(indexable)
      const quotes = random.chance(0.3)
      return {edits: [replaceOneForOne(dot, '['), ...(quotes ? [insertAt(next.start, '"')] : []), insertAt(next.end, quotes ? '"]' : ']')], form: quotes ? 'index brackets and quotes in the place of a dot' : form}
    }
    case 'a dot too many': {
      // After the key, before it, or a second dot where the key has one, e.g. `name. = 1` and `a..b = 1`.
      const where = random.weighted([['a dot after a key', 50], ['a dot before a key', 20], ['two dots in a row in a key', dotted.length > 0 ? 30 : 0]] as const)
      if (where === 'two dots in a row in a key') return {edits: [insertAt(random.pick(random.pick(dotted).dots), '.')], form: where}
      const key = random.pick(keys)
      return {edits: [insertAt(where === 'a dot after a key' ? key.end : key.start, '.')], form: where}
    }
    case 'a letter with an accent': {
      const position = random.pick(random.pick(withLetter))
      return {edits: [replaceOneForOne(position, random.pick(Array.from(accented[codePoints[position]!]!)))], form}
    }
  }
}

function headerBracket(random: Random, scanned: Scan): Damage | undefined {
  if (scanned.headers.length === 0) return undefined
  const header = random.pick(scanned.headers)
  if (header.double) {
    const form = random.weighted([['one closing bracket where two are needed', 40], ['one opening bracket where two are needed', 25], ['a space between the two brackets', 20], ['no closing brackets', 15]] as const)
    switch (form) {
      case 'one closing bracket where two are needed': return {edits: [removeRange(header.end - 1, header.end)], form}
      case 'one opening bracket where two are needed': return {edits: [removeRange(header.start, header.start + 1)], form}
      case 'a space between the two brackets': return {edits: [insertAt(header.start + 1, ' '), insertAt(header.end - 1, ' ')], form}
      case 'no closing brackets': return {edits: [removeRange(header.close, header.end)], form}
    }
  }
  const form = random.weighted([['no closing bracket', 50], ['no opening bracket', 20], ['a second closing bracket', 18], ['a second opening bracket', 12]] as const)
  switch (form) {
    case 'no closing bracket': return {edits: [removeRange(header.close, header.end)], form}
    case 'no opening bracket': return {edits: [removeRange(header.start, header.start + 1)], form}
    case 'a second closing bracket': return {edits: [insertAt(header.end, ']')], form}
    case 'a second opening bracket': return {edits: [insertAt(header.start, '[')], form}
  }
}

function headerForm(random: Random, scanned: Scan): Damage | undefined {
  const {headers} = scanned
  if (headers.length === 0) return undefined
  const dotted = headers.filter(header => header.key.dots.length > 0)
  const gitStyle = dotted.filter(header => header.key.parts[1]!.string === null)
  const single = headers.filter(header => !header.double)
  // The headers of tables whose entries stand on one line each, right below the header's own indentation.
  const withEntries = scanned.tables.filter(table => table.header !== null && !table.header.double && firstOnLine(scanned, table.header.start) && table.entries.length > 0)
  const form = chooseForm(random, [
    ['another sign in the place of a dot', dotted.length > 0 ? 26 : 0], ['a space and quotes in the place of a dot', gitStyle.length > 0 ? 7 : 0], ['a dot at an end of the name', 12],
    ['a sign after the header', 22], ['other brackets', single.length > 0 ? 15 : 0], ['the name and a colon', withEntries.length > 0 ? 18 : 0],
  ] as const)!
  switch (form) {
    case 'the name and a colon': {
      // server: as YAML starts a part. The brackets go, with the white space inside them, and the colon is added. In
      // six texts of ten the entries are indented below it, when they are not yet and stand on one line each.
      const table = random.pick(withEntries)
      const header = table.header!
      const edits: Edit[] = [removeRange(header.start, header.key.start), {at: header.key.end, remove: header.end - header.key.end, insert: ':'}]
      const headerIndent = indentationAt(scanned, header.start)
      const indented = table.entries.every(entry => indentationAt(scanned, entry.key.start) === headerIndent && onOneLine(scanned, entry)) && random.chance(0.6)
      if (indented) for (const entry of table.entries) edits.push(insertAt(lineAt(scanned, entry.key.start).start, '  '))
      return {edits, form: indented ? 'the name and a colon in the place of a header, the entries indented' : 'the name and a colon in the place of a header'}
    }
    case 'another sign in the place of a dot': {
      const sign = random.weighted([[':', 27], ['/', 27], [' ', 18], ['::', 9], ['->', 9], ['][', 10]] as const)
      const every = dotted.length > 1 && random.chance(0.3)
      const changed = every ? dotted : [random.pick(dotted)]
      return {edits: changed.flatMap(header => header.key.dots.flatMap(dot => dotAs(sign, dot))), form: `${JSON.stringify(sign)} in the place of the dots of ${every ? 'every header that has one' : 'one header'}`}
    }
    case 'a space and quotes in the place of a dot': {
      // [remote "origin"], as git writes the header of a part of its config.
      const header = random.pick(gitStyle)
      const part = header.key.parts[1]!
      return {edits: [replaceOneForOne(header.key.dots[0]!, ' '), insertAt(part.start, '"'), insertAt(part.end, '"')], form}
    }
    case 'a dot at an end of the name': {
      const header = random.pick(headers)
      const which = random.weighted([['a dot after the name', 50], ['a dot before the name', 35], ['a dot and a star after the name', 15]] as const)
      return {edits: [which === 'a dot before the name' ? insertAt(header.key.start, '.') : insertAt(header.key.end, which === 'a dot after the name' ? '.' : '.*')], form: which}
    }
    case 'a sign after the header': {
      const sign = random.weighted([[':', 40], [' {', 25], [';', 20], [',', 15]] as const)
      return {edits: [insertAt(random.pick(headers).end, sign)], form: `${JSON.stringify(sign)} after a header`}
    }
    case 'other brackets': {
      const header: Header = random.pick(single)
      const [open, close] = random.weighted<readonly [string, string]>([[['<', '>'], 50], [['{', '}'], 25], [['(', ')'], 25]])
      return {edits: [replaceOneForOne(header.start, open), replaceOneForOne(header.close, close)], form: `${open}${close} around a header's name`}
    }
  }
}

// The entries on lines of their own that stand on one line with nothing after the value. With `preferLast`, the last
// entry below a header is picked in half of the draws: that is where a person types.
function pickEntryAtLineEnd(random: Random, scanned: Scan, preferLast: boolean): Entry | undefined {
  const entries = scanned.entries.filter(entry => onOneLine(scanned, entry) && lastOnLine(scanned, entry.value.end))
  if (entries.length === 0) return undefined
  const last = entries.filter(entry => entry.table.entries.at(-1) === entry)
  return random.pick(preferLast && last.length > 0 && random.chance(0.5) ? last : entries)
}

function keyAlone(random: Random, scanned: Scan): Damage | undefined {
  const entry = pickEntryAtLineEnd(random, scanned, true)
  if (entry === undefined) return undefined
  const {key} = entry
  // Half typed: the key stops inside its only part, which has no quotes.
  if (key.parts.length === 1 && key.parts[0]!.string === null && key.end - key.start > 1 && random.chance(0.4)) {
    return {edits: [removeRange(key.start + random.integer(1, key.end - key.start - 1), entry.value.end)], form: 'a key that stops before its end'}
  }
  return {edits: [removeRange(key.end, entry.value.end)], form: 'a key without its equals sign and its value'}
}

function equalsWithoutValue(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const inInlineTables = scanned.inlineEntries.filter(entry => entry.value.container === null)
  if (inInlineTables.length > 0 && random.chance(0.1)) {
    const {value} = random.pick(inInlineTables)
    return {edits: [removeRange(value.start, value.end)], form: 'an entry of an inline table without its value'}
  }
  // With or without the space after the equals sign.
  const keepSpace = random.chance(0.5)
  const withoutValue = (entry: Entry) => removeRange(keepSpace ? entry.value.start : entry.equals + 1, entry.value.end)
  const tables = scanned.tables.map(table => table.entries.filter(entry => onOneLine(scanned, entry) && lastOnLine(scanned, entry.value.end))).filter(entries => entries.length >= 2)
  if (tables.length > 0 && random.chance(0.15)) {
    const chosen = random.shuffled(random.pick(tables)).slice(0, random.integer(2, 3))
    return {edits: chosen.map(withoutValue), form: `${chosen.length} entries below one header without their values`}
  }
  const entry = pickEntryAtLineEnd(random, scanned, true)
  if (entry === undefined) return undefined
  return {edits: [withoutValue(entry)], form: `an entry without its value${keepSpace && isSpaceOrTab(codePoints[entry.equals + 1]) ? ', the space after the equals sign kept' : ''}`}
}

function valueOnNextLine(random: Random, scanned: Scan): Damage | undefined {
  if (scanned.entries.length === 0) return undefined
  const entry = random.pick(scanned.entries)
  const indent = random.chance(0.8) ? `${indentationAt(scanned, entry.key.start)}${random.chance(0.6) ? '  ' : '    '}` : ''
  return {edits: [{at: entry.equals + 1, remove: entry.value.start - entry.equals - 1, insert: `${scanned.lineEnd}${indent}`}], form: indent === '' ? 'a line end after the equals sign' : 'a line end after the equals sign, the value indented'}
}

export const keyAndHeaderKinds: KindDefinition[] = [
  {
    name: 'bareKeyCharacter', family: 'keys and headers', weight: 2.5,
    description: 'A key without quotes that holds a character that TOML wants quotes for: a space, a sign of another notation, a letter with an accent, an index in brackets',
    example: 'request timeout = 30⏎$schema = "v2"⏎deps[serde] = "1"',
    variants: 'a space in the place of _ or -; a key without its quotes; a sign before the key, e.g. $ or @; a sign after it, e.g. [] or ?; / : :: or -> in the place of the dots; index brackets in the place of a dot, with or without quotes; a dot before or after the key, or two dots in a row; a letter with an accent',
    showable: 'partly: the characters of the key up to the mistake are shown as a key by cells that valid TOML reads, and a word or a sign between a key and its equals sign can be shown as more of the key. A sign before the first character has no label. The bracket in the place of a dot opens nothing after a key',
    apply: bareKeyCharacter,
  },
  {
    name: 'headerBracket', family: 'keys and headers', weight: 3,
    description: 'A header with a bracket too few or too many',
    example: '[server⏎host = "a"⏎[[upstream]⏎name = "b"',
    variants: 'no closing bracket; no opening bracket; a second closing or opening bracket; one bracket where [[ or ]] is needed; a space between the two brackets of [[ or ]]; [[name without closing brackets',
    showable: 'yes when a closing bracket is missing or extra: the header ends at its line\'s end. Without the opening bracket the name stands where a key stands and is shown as a key by cells that valid TOML reads',
    apply: headerBracket,
  },
  {
    name: 'headerForm', family: 'keys and headers', weight: 2,
    description: 'A header as another notation writes it: another sign between the parts of its name, a sign after it, other brackets, or the name and a colon',
    example: '[server:tls]⏎[remote "origin"]⏎server:',
    variants: ': / :: -> ][ or a space in the place of the dots, in one header or in every header; a space and quotes in the place of a dot, as git config has it; a dot before or after the name; : ; , or { after the header; < > { } or ( ) in the place of the brackets; the name and a colon without brackets, as YAML starts a part, with the entries indented or as they were',
    showable: 'yes for a sign inside or after the header. With other brackets the name is read from an error on and can be shown as a header\'s name. Without brackets the name stands where a key stands and is shown as a key by cells that valid TOML reads',
    apply: headerForm,
  },
  {
    name: 'keyAlone', family: 'keys and headers', weight: 2,
    description: 'A key alone on its line: an entry that is being typed, or a flag as INI files have it',
    example: '[server]⏎host = "a"⏎por',
    variants: 'the whole key; a key that stops before its end. In half of the draws it is the last entry below its header',
    showable: 'yes: a line end after a key starts the next line anew',
    apply: keyAlone,
  },
  {
    name: 'equalsWithoutValue', family: 'keys and headers', weight: 3,
    description: 'A key and an equals sign without a value: half typed, or left empty as a sample config does',
    example: 'host =⏎port = 8443',
    variants: 'one entry, with or without the space after the equals sign; 2 or 3 entries below one header; an entry of an inline table',
    showable: 'yes: a line end where a value should stand starts the next line anew, and inside an inline table a comma there goes on with the next entry',
    apply: equalsWithoutValue,
  },
  {
    name: 'valueOnNextLine', family: 'keys and headers', weight: 0.7,
    description: 'A value that starts on the line after its equals sign',
    example: 'description =⏎  "Something quiet over something"',
    variants: 'the value indented by 2 or 4 spaces, or not at all',
    showable: 'yes with the rule that a line end after an equals sign is white space, which is the opposite of the rule that equalsWithoutValue needs',
    apply: valueOnNextLine,
  },
]
