// How a key gets its value and how entries are kept apart, written as another notation writes them: a colon, an
// arrow, no sign at all, a comma or a semicolon at the end of a line, two entries on one line, an inline table on
// several lines or as a block of another notation, and commas that are missing or extra.
import {type Edit, insertAt, removeRange, replaceOneForOne} from '../edits.ts'
import type {Random} from '../random.ts'
import {type Container, type Entry, type Scan, commentAfter, firstOnLine, indentationAt, isSpaceOrTab, lastOnLine, lineAt} from './scan.ts'
import type {Damage, KindDefinition} from './types.ts'

// One of the forms by weight, or undefined when no form has a place in the text.
export function chooseForm<Form extends string>(random: Random, forms: readonly (readonly [Form, number])[]): Form | undefined {
  return forms.some(([, weight]) => weight > 0) ? random.weighted(forms) : undefined
}

const tablesWithEntries = (scanned: Scan, fewest: number) => scanned.tables.filter(table => table.entries.length >= fewest)
const inlineTablesWithEntries = (scanned: Scan, fewest = 1) => scanned.containers.filter(container => container.type === 'inlineTable' && container.entries.length >= fewest)

// `port = 80` as `port: 80`. The colon stands in the place of the equals sign and has its label. YAML and JSON write
// no space before the colon, so with `tight` the one space before the equals sign goes.
function colonEdits(scanned: Scan, entry: Entry, tight: boolean, spaceAfter: boolean): Edit[] {
  const {codePoints} = scanned
  const edits: Edit[] = []
  if (tight && entry.key.end === entry.equals - 1 && codePoints[entry.equals - 1] === ' ') edits.push(removeRange(entry.equals - 1, entry.equals))
  edits.push(replaceOneForOne(entry.equals, ':'))
  if (spaceAfter && !isSpaceOrTab(codePoints[entry.equals + 1])) edits.push(insertAt(entry.equals + 1, ' '))
  return edits
}

function colonForEquals(random: Random, scanned: Scan): Damage | undefined {
  const tables = tablesWithEntries(scanned, 2)
  const inlineTables = inlineTablesWithEntries(scanned)
  const form = chooseForm(random, [
    ['one entry', scanned.entries.length > 0 ? 50 : 0], ['every entry below one header', tables.length > 0 ? 22 : 0], ['every entry of the document', scanned.entries.length > 1 ? 13 : 0],
    ['every entry of one inline table', inlineTables.length > 0 ? 9 : 0], ['an inline table as a JSON object', inlineTables.length > 0 ? 6 : 0],
  ] as const)
  if (form === undefined) return undefined
  const tight = random.chance(0.8)
  const spaceAfter = random.chance(0.7)
  const colons = (entries: readonly Entry[]) => entries.flatMap(entry => colonEdits(scanned, entry, tight, spaceAfter))
  switch (form) {
    case 'one entry': return {edits: colons([random.pick(scanned.entries)]), form}
    case 'every entry below one header': return {edits: colons(random.pick(tables).entries), form}
    case 'every entry of the document': {
      const inside = random.chance(0.5)
      return {edits: colons(inside ? [...scanned.entries, ...scanned.inlineEntries] : scanned.entries), form: inside ? 'every entry of the document, also those of inline tables' : form, wholeText: true}
    }
    case 'every entry of one inline table': return {edits: colons(random.pick(inlineTables).entries), form}
    case 'an inline table as a JSON object': {
      // {"version": "1", "features": ["std"]}: a quote on each side of every key that has none.
      const edits = random.pick(inlineTables).entries.flatMap(entry => [
        ...entry.key.parts.flatMap(part => part.string === null ? [insertAt(part.start, '"'), insertAt(part.end, '"')] : []),
        ...colonEdits(scanned, entry, true, spaceAfter),
      ])
      return {edits, form}
    }
  }
}

const otherSigns = [[':=', 30], ['=>', 25], ['==', 15], ['->', 10], ['+=', 10], ['<-', 5], ['?=', 5]] as const
// The equals sign stays where the other sign holds one, and the sign's other character is added. In `->` and `<-`
// the `>` and the `<` stand in the place of the equals sign.
function otherSignEdits(sign: typeof otherSigns[number][0], entry: Entry): Edit[] {
  switch (sign) {
    case ':=': return [insertAt(entry.equals, ':')]
    case '+=': return [insertAt(entry.equals, '+')]
    case '?=': return [insertAt(entry.equals, '?')]
    case '=>': return [insertAt(entry.equals + 1, '>')]
    case '==': return [insertAt(entry.equals + 1, '=')]
    case '->': return [insertAt(entry.equals, '-'), replaceOneForOne(entry.equals, '>')]
    case '<-': return [replaceOneForOne(entry.equals, '<'), insertAt(entry.equals + 1, '-')]
  }
}

function otherAssignment(random: Random, scanned: Scan): Damage | undefined {
  if (scanned.entries.length === 0) return undefined
  const tables = tablesWithEntries(scanned, 2)
  const sign = random.weighted(otherSigns)
  if (tables.length > 0 && random.chance(0.3)) return {edits: random.pick(tables).entries.flatMap(entry => otherSignEdits(sign, entry)), form: `${sign} for every equals sign below one header`}
  return {edits: otherSignEdits(sign, random.pick(scanned.entries)), form: `${sign} for one equals sign`}
}

// `port = 80` as `port 80`: the equals sign goes, with the space after it when it has a space on both sides. Where it
// has none, a space takes its place, so that the key and the value stay apart.
function withoutEquals(scanned: Scan, entry: Entry): Edit[] {
  const {codePoints} = scanned
  const before = isSpaceOrTab(codePoints[entry.equals - 1])
  const after = isSpaceOrTab(codePoints[entry.equals + 1])
  if (before && after) return [removeRange(entry.equals, entry.equals + 2)]
  if (!before && !after) return [{at: entry.equals, remove: 1, insert: ' '}]
  return [removeRange(entry.equals, entry.equals + 1)]
}

function missingEquals(random: Random, scanned: Scan): Damage | undefined {
  if (scanned.entries.length === 0) return undefined
  const tables = tablesWithEntries(scanned, 2)
  if (tables.length > 0 && random.chance(0.25)) return {edits: random.pick(tables).entries.flatMap(entry => withoutEquals(scanned, entry)), form: 'every entry below one header'}
  return {edits: withoutEquals(scanned, random.pick(scanned.entries)), form: 'one entry'}
}

function lineEndSeparator(random: Random, scanned: Scan): Damage | undefined {
  if (scanned.entries.length === 0) return undefined
  const tables = tablesWithEntries(scanned, 2)
  // A backslash at the end of a line is what a shell and a Makefile go on to the next line with.
  const sign = random.weighted([[',', 60], [';', 32], [' \\', 8]] as const)
  const after = (entries: readonly Entry[]) => entries.map(entry => insertAt(entry.value.end, sign))
  const form = chooseForm(random, [['one entry', 50], ['every entry below one header', tables.length > 0 ? 32 : 0], ['every entry of the document', scanned.entries.length > 1 ? 18 : 0]] as const)!
  switch (form) {
    case 'one entry': return {edits: after([random.pick(scanned.entries)]), form: `${sign} after one entry`}
    case 'every entry below one header': {
      const {entries} = random.pick(tables)
      // As JSON has it: a comma after every entry but the last.
      const butLast = sign === ',' && random.chance(0.6)
      return {edits: after(butLast ? entries.slice(0, -1) : entries), form: `${sign} after every entry below one header${butLast ? ' but the last' : ''}`}
    }
    case 'every entry of the document': return {edits: after(scanned.entries), form: `${sign} after every entry of the document`, wholeText: true}
  }
}

// Two entries below one header that stand on two lines one after the other, the first one without a comment.
function neighbouringEntries(scanned: Scan): [Entry, Entry][] {
  const pairs: [Entry, Entry][] = []
  for (const table of scanned.tables) {
    for (let index = 0; index + 1 < table.entries.length; index++) {
      const first = table.entries[index]!
      const second = table.entries[index + 1]!
      if (lineAt(scanned, first.value.end).next === lineAt(scanned, second.key.start).start && lastOnLine(scanned, first.value.end) && firstOnLine(scanned, second.key.start)) pairs.push([first, second])
    }
  }
  return pairs
}

function entriesOnOneLine(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const pairs = neighbouringEntries(scanned)
  const headersWithEntry = scanned.tables.filter(table => table.header !== null && table.entries.length > 0 && lastOnLine(scanned, table.header.end)
    && lineAt(scanned, table.header.end).next === lineAt(scanned, table.entries[0]!.key.start).start)
  const form = chooseForm(random, [['two entries', pairs.length > 0 ? 62 : 0], ['a run of entries', pairs.length > 1 ? 23 : 0], ['a header and its first entry', headersWithEntry.length > 0 ? 15 : 0]] as const)
  if (form === undefined) return undefined
  if (form === 'a header and its first entry') {
    const table = random.pick(headersWithEntry)
    return {edits: [{at: table.header!.end, remove: table.entries[0]!.key.start - table.header!.end, insert: ' '}], form}
  }
  const join = (first: Entry, second: Entry, separator: string): Edit => ({at: first.value.end, remove: second.key.start - first.value.end, insert: separator})
  // With nothing between them, two entries stay apart only after a quote or a closing bracket.
  const endsWithMark = (entry: Entry) => '"\']}'.includes(codePoints[entry.value.end - 1]!)
  const separator = random.weighted([[', ', 45], ['; ', 25], [' ', 20], ['', 10]] as const)
  if (form === 'two entries') {
    const [first, second] = random.pick(pairs)
    if (separator === '' && !endsWithMark(first)) return undefined
    return {edits: [join(first, second, separator)], form: `two entries with ${JSON.stringify(separator)} between them`}
  }
  // A run of pairs that follow each other: every entry below one header from a first to a last one.
  const start = random.integer(0, pairs.length - 2)
  const run: [Entry, Entry][] = [pairs[start]!]
  while (run.length < 4 && pairs[start + run.length]?.[0] === run.at(-1)![1] && (run.length < 2 || random.chance(0.5))) run.push(pairs[start + run.length]!)
  if (run.length < 2 || (separator === '' && !run.every(([first]) => endsWithMark(first)))) return undefined
  return {edits: run.map(([first, second]) => join(first, second, separator)), form: `${run.length + 1} entries with ${JSON.stringify(separator)} between them`}
}

// The edits that write one inline table on several lines, as JSON writes an object: a line end after the opening brace
// and after every comma, each entry indented, and the closing brace on a line of its own. With `commas` 'none' the
// commas between the entries go, and with 'also last' a comma follows the last entry.
function onSeveralLines(scanned: Scan, container: Container, step: string, commas: 'between' | 'also last' | 'none'): Edit[] {
  const {codePoints, lineEnd} = scanned
  const closeIndent = indentationAt(scanned, container.open)
  const edits: Edit[] = []
  // A line end and the indentation in the place of the white space from `from` on, and of what stands before it from `comma` on.
  const breakAt = (from: number, comma = from) => {
    let end = from
    while (isSpaceOrTab(codePoints[end])) end++
    edits.push({at: comma, remove: end - comma, insert: `${lineEnd}${closeIndent}${step}`})
  }
  breakAt(container.open + 1)
  for (const entry of container.entries) if (entry.commaAfter !== -1) breakAt(entry.commaAfter + 1, commas === 'none' ? entry.commaAfter : entry.commaAfter + 1)
  const lastEnd = container.entries.at(-1)!.value.end
  edits.push({at: lastEnd, remove: container.close - lastEnd, insert: `${commas === 'also last' ? ',' : ''}${lineEnd}${closeIndent}`})
  return edits
}

// An inline table that is the value of an entry on a line of its own, or an item of an array on several lines.
const inlineTablesForLines = (scanned: Scan) => inlineTablesWithEntries(scanned).filter(container => container.parent === null || (container.parent.type === 'array' && container.parent.severalLines && container.parent.parent === null))
const drawStep = (random: Random) => random.weighted([['  ', 55], ['    ', 35], ['\t', 10]] as const)

function inlineTableOnLines(random: Random, scanned: Scan): Damage | undefined {
  const candidates = inlineTablesForLines(scanned)
  if (candidates.length === 0) return undefined
  const step = drawStep(random)
  const commas = random.chance(0.4) ? 'also last' : 'between'
  const note = commas === 'also last' ? ', with a comma after the last entry' : ''
  if (candidates.length > 1 && random.chance(0.25)) return {edits: candidates.flatMap(container => onSeveralLines(scanned, container, step, commas)), form: `every inline table on several lines${note}`}
  return {edits: onSeveralLines(scanned, random.pick(candidates), step, commas), form: `one inline table on several lines${note}`}
}

function inlineTableAsBlock(random: Random, scanned: Scan): Damage | undefined {
  const candidates = inlineTablesForLines(scanned).filter(container => container.value.entry !== null && container.value.within === null)
  if (candidates.length === 0) return undefined
  const container = random.pick(candidates)
  const entry = container.value.entry!
  const step = drawStep(random)
  const form = random.weighted([['name {', 45], ['name = {', 25], ['name: {', 30]] as const)
  switch (form) {
    // As HCL and nginx write a block: no equals sign before the brace, and no commas.
    case 'name {': return {edits: [{at: entry.key.end, remove: container.open - entry.key.end, insert: ' '}, ...onSeveralLines(scanned, container, step, 'none')], form: '"name {", an entry per line and no commas'}
    case 'name = {': return {edits: onSeveralLines(scanned, container, step, 'none'), form: '"name = {", an entry per line and no commas'}
    // As JavaScript and JSON5 write an object: colons, and a comma after every entry but the last.
    case 'name: {': return {edits: [...[entry, ...container.entries].flatMap(inner => colonEdits(scanned, inner, true, true)), ...onSeveralLines(scanned, container, step, 'between')], form: '"name: {", an entry per line with colons and commas'}
  }
}

function trailingCommaInInlineTable(random: Random, scanned: Scan): Damage | undefined {
  const candidates = inlineTablesWithEntries(scanned)
  if (candidates.length === 0) return undefined
  const comma = (container: Container) => insertAt(container.entries.at(-1)!.value.end, ',')
  if (candidates.length > 1 && random.chance(0.3)) return {edits: candidates.map(comma), form: 'in every inline table'}
  return {edits: [comma(random.pick(candidates))], form: 'in one inline table'}
}

// A comma may only go when the two values stay two tokens without it: it has white space next to it, or a quote or a
// bracket on one side. Without this rule [1,2] would become the valid [12].
function safeToRemoveComma(codePoints: readonly string[], comma: number) {
  const before = codePoints[comma - 1]!
  const after = codePoints[comma + 1]!
  return ' \t\n\r'.includes(before) || ' \t\n\r'.includes(after) || '"\'{}[]'.includes(before) || '"\'{}[]'.includes(after)
}

// The commas of a container that stand between two of its values, i.e. all but one after the last value.
function commasBetween(container: Container): number[] {
  const commas = container.type === 'array' ? container.items.slice(0, -1).map(item => item.commaAfter) : container.entries.slice(0, -1).map(entry => entry.commaAfter)
  return commas.filter(comma => comma !== -1)
}

function missingComma(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const safe = (container: Container) => commasBetween(container).filter(comma => safeToRemoveComma(codePoints, comma))
  const arrays = scanned.containers.filter(container => container.type === 'array')
  const atLineEnd = arrays.flatMap(container => safe(container).filter(comma => lastOnLine(scanned, comma + 1)))
  const insideALine = arrays.flatMap(container => safe(container).filter(comma => !lastOnLine(scanned, comma + 1) && commentAfter(scanned, comma) === undefined))
  const inInlineTables = inlineTablesWithEntries(scanned, 2).flatMap(safe)
  const whole = scanned.containers.filter(container => commasBetween(container).length >= 2 && safe(container).length === commasBetween(container).length)
  const withCommas = scanned.containers.filter(container => commasBetween(container).length >= 1)
  const form = chooseForm(random, [
    ['at a line end, between two values of an array', atLineEnd.length > 0 ? 36 : 0], ['inside a line, between two values of an array', insideALine.length > 0 ? 23 : 0],
    ['between two entries of an inline table', inInlineTables.length > 0 ? 18 : 0], ['every comma of one container', whole.length > 0 ? 13 : 0],
    ['a semicolon in the place of every comma of one container', withCommas.length > 0 ? 10 : 0],
  ] as const)
  if (form === undefined) return undefined
  const without = (comma: number) => removeRange(comma, comma + 1)
  switch (form) {
    case 'at a line end, between two values of an array': return {edits: [without(random.pick(atLineEnd))], form}
    case 'inside a line, between two values of an array': return {edits: [without(random.pick(insideALine))], form}
    case 'between two entries of an inline table': return {edits: [without(random.pick(inInlineTables))], form}
    case 'every comma of one container': {
      const container = random.pick(whole)
      return {edits: commasBetween(container).map(without), form: `every comma of one ${container.type === 'array' ? 'array' : 'inline table'}`}
    }
    case 'a semicolon in the place of every comma of one container': {
      // [1; 2; 3], as some languages write a list. The semicolon stands for the comma.
      const container = random.pick(withCommas)
      const commas = [...container.items.map(item => item.commaAfter), ...container.entries.map(entry => entry.commaAfter)].filter(comma => comma !== -1)
      return {edits: commas.map(comma => replaceOneForOne(comma, ';')), form: `a semicolon in the place of every comma of one ${container.type === 'array' ? 'array' : 'inline table'}`}
    }
  }
}

function extraComma(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints, lineEnd} = scanned
  const commas = scanned.containers.flatMap(commasBetween)
  const insideALine = commas.filter(comma => !lastOnLine(scanned, comma + 1))
  const atLineEnd = commas.filter(comma => lastOnLine(scanned, comma + 1))
  const filled = scanned.containers.filter(container => !container.severalLines && container.items.length + container.entries.length > 0)
  const form = chooseForm(random, [
    ['a second comma after a comma, inside a line', insideALine.length > 0 ? 45 : 0], ['a comma on a line of its own', atLineEnd.length > 0 ? 25 : 0], ['a comma before the first value', filled.length > 0 ? 30 : 0],
  ] as const)
  if (form === undefined) return undefined
  switch (form) {
    case 'a second comma after a comma, inside a line': {
      // The value between two commas was deleted: `, ,` when the commas have a space after them, otherwise `,,`.
      const comma = random.pick(insideALine)
      return {edits: [insertAt(comma + 1, codePoints[comma + 1] === ' ' && random.chance(0.6) ? ' ,' : ',')], form}
    }
    case 'a comma on a line of its own': {
      const comma = random.pick(atLineEnd)
      return {edits: [insertAt(comma + 1, `${lineEnd}${indentationAt(scanned, comma)},`)], form}
    }
    case 'a comma before the first value': {
      const container = random.pick(filled)
      return {edits: [insertAt(container.open + 1, random.chance(0.4) ? ', ' : ',')], form: `a comma before the first value of an ${container.type === 'array' ? 'array' : 'inline table'}`}
    }
  }
}

function arrayWithoutBrackets(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const arrays = scanned.containers.filter(container => container.type === 'array' && container.parent === null && !container.severalLines && container.items.length >= 2)
  // An array with one value per line, the ] on a line of its own, and no comment in it.
  const onLines = scanned.containers.filter(container => container.type === 'array' && container.parent === null && container.severalLines && container.items.length >= 1 && lastOnLine(scanned, container.open + 1)
    && container.items.every(item => firstOnLine(scanned, item.value.start) && lastOnLine(scanned, item.commaAfter === -1 ? item.value.end : item.commaAfter + 1) && lineAt(scanned, item.value.start) === lineAt(scanned, item.value.end))
    && firstOnLine(scanned, container.close) && lastOnLine(scanned, container.close + 1) && lineAt(scanned, container.close).next > lineAt(scanned, container.close).end
    && !scanned.comments.some(comment => comment.start > container.open && comment.start < container.close))
  const form = chooseForm(random, [['an array on one line', arrays.length > 0 ? 75 : 0], ['an array on several lines as a list of YAML', onLines.length > 0 ? 25 : 0]] as const)
  if (form === undefined) return undefined
  if (form === 'an array on several lines as a list of YAML') {
    // The [ goes with the space before it, every value gets `- ` before it and loses its comma, and the line of
    // the ] goes.
    const container = random.pick(onLines)
    const closeLine = lineAt(scanned, container.close)
    const edits: Edit[] = [removeRange(isSpaceOrTab(codePoints[container.open - 1]) && random.chance(0.5) ? container.open - 1 : container.open, container.open + 1), removeRange(closeLine.start, closeLine.next)]
    for (const item of container.items) {
      edits.push(insertAt(item.value.start, '- '))
      if (item.commaAfter !== -1) edits.push(removeRange(item.commaAfter, item.commaAfter + 1))
    }
    return {edits, form}
  }
  const container = random.pick(arrays)
  const edits: Edit[] = [removeRange(container.open, container.items[0]!.value.start), removeRange(container.items.at(-1)!.value.end, container.close + 1)]
  // Without the commas too, where a space after each comma keeps the values apart, e.g. tags = "a" "b".
  const commas = commasBetween(container)
  const withoutCommas = commas.every(comma => isSpaceOrTab(codePoints[comma + 1])) && random.chance(0.2)
  if (withoutCommas) for (const comma of commas) edits.push(removeRange(comma, comma + 1))
  return {edits, form: withoutCommas ? 'an array on one line without its brackets and its commas' : 'an array on one line without its brackets'}
}

export const assignmentKinds: KindDefinition[] = [
  {
    name: 'colonForEquals', family: 'assignment and separators', weight: 5,
    description: 'A colon in the place of an equals sign, as YAML and JSON write an entry',
    example: '[server]⏎host: "127.0.0.1"⏎port = 8443',
    variants: 'one entry; every entry below one header; every entry of the document, with or without those of inline tables; every entry of one inline table; an inline table as a JSON object, with quotes around its keys',
    showable: 'yes: after a key, a colon is read as the equals sign',
    apply: colonForEquals,
  },
  {
    name: 'otherAssignment', family: 'assignment and separators', weight: 1,
    description: 'Another language\'s sign in the place of the equals sign: := => == -> += <- ?=',
    example: 'name := "tiny"⏎port => 8443',
    variants: 'one entry; every entry below one header',
    showable: 'yes: the sign\'s characters after a key are skipped up to the value',
    apply: otherAssignment,
  },
  {
    name: 'missingEquals', family: 'assignment and separators', weight: 1.5,
    description: 'A key and its value with only a space between them, as the configs of nginx and ssh have it',
    example: 'workers 32⏎host "127.0.0.1"',
    variants: 'one entry; every entry below one header',
    showable: 'yes: a value after a key and a space is that key\'s value',
    apply: missingEquals,
  },
  {
    name: 'lineEndSeparator', family: 'assignment and separators', weight: 3,
    description: 'A comma, a semicolon or a backslash after an entry at the end of its line, as JSON, JavaScript and a shell end a line',
    example: 'name = "tiny",⏎port = 8443;',
    variants: 'one entry; every entry below one header, or with a comma every one but the last; every entry of the document',
    showable: 'yes: a comma, a semicolon or a backslash after a complete value at depth 0 is skipped',
    apply: lineEndSeparator,
  },
  {
    name: 'entriesOnOneLine', family: 'assignment and separators', weight: 1.5,
    description: 'Two or more entries on one line, with a comma, a semicolon, a space or nothing between them, or a header with its first entry',
    example: 'name = "tiny", port = 8443⏎[tls] enabled = true',
    variants: 'two entries; a run of 3 to 5 entries; a header and its first entry',
    showable: 'yes: after a complete value at depth 0, a comma or a semicolon is skipped and a word is the next key, and so is a word after a header',
    apply: entriesOnOneLine,
  },
  {
    name: 'inlineTableOnLines', family: 'assignment and separators', weight: 10,
    description: 'An inline table on several lines, as JSON writes an object. TOML 1.0 wants it on one line',
    example: 'serde = {⏎  version = "1",⏎  features = ["derive"]⏎}',
    variants: 'one inline table; every inline table; with or without a comma after the last entry; indented by 2 spaces, 4 spaces or a tab',
    showable: 'yes: a line end inside an inline table is white space',
    apply: inlineTableOnLines,
  },
  {
    name: 'inlineTableAsBlock', family: 'assignment and separators', weight: 2.5,
    description: 'An inline table written as a block of another notation, with an entry per line: as HCL and nginx write a block, or as JavaScript writes an object',
    example: 'server {⏎  host = "127.0.0.1"⏎  port = 8443⏎}',
    variants: '`name {` without an equals sign and without commas; `name = {` without commas; `name: {` with colons and commas',
    showable: 'yes: a brace after a key opens an inline table, a line end inside an inline table is white space, and a word after a complete value is the next key',
    apply: inlineTableAsBlock,
  },
  {
    name: 'trailingCommaInInlineTable', family: 'assignment and separators', weight: 5,
    description: 'A comma after the last entry of an inline table, which an array allows and an inline table of TOML 1.0 does not',
    example: 'point = { x = 1, y = 2, }',
    variants: 'one inline table; every inline table',
    showable: 'yes: a closing brace after a comma closes the inline table',
    apply: trailingCommaInInlineTable,
  },
  {
    name: 'missingComma', family: 'assignment and separators', weight: 3,
    description: 'A comma that is missing between two values of an array or two entries of an inline table, or a semicolon in its place',
    example: 'ports = [80 443]⏎point = { x = 1 y = 2 }⏎sizes = [1; 2; 3]',
    variants: 'at a line end of an array on several lines; inside a line of an array; in an inline table; every comma of one container; a semicolon in the place of every comma of one container',
    showable: 'yes: after a complete value inside an array, the start of a value is the next value, and inside an inline table a word is the next key. A semicolon there is read as the comma',
    apply: missingComma,
  },
  {
    name: 'extraComma', family: 'assignment and separators', weight: 1,
    description: 'A comma too many: two in a row, one on a line of its own, or one before the first value',
    example: 'ports = [80,, 443]⏎tags = [, "a"]',
    variants: 'a second comma inside a line; a comma on a line of its own in an array on several lines; a comma before the first value of an array or an inline table',
    showable: 'yes: a comma where a value or a key should start changes nothing',
    apply: extraComma,
  },
  {
    name: 'arrayWithoutBrackets', family: 'assignment and separators', weight: 1.5,
    description: 'A list of values without brackets, as INI files and CSV write a list, or with a dash before each value, as YAML does',
    example: 'tags = "web", "prod"⏎members =⏎  - "core"⏎  - "cli"',
    variants: 'an array on one line without its brackets; without its brackets and its commas; an array on several lines without its brackets and commas and with `- ` before every value',
    showable: 'yes for the display kinds: a comma and a value after a complete value at depth 0 go on with the list, and a dash at the start of a line after an equals sign starts a value. The depth and the container of the list are not scored, since no bracket shows them',
    apply: arrayWithoutBrackets,
  },
]
