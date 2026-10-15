// Commas and colons that are missing, extra, or written as another language writes them.
import {type Edit, insertAt, removeRange, replaceOneForOne} from '../edits.ts'
import type {Random} from '../random.ts'
import {type Container, type Entry, type Scan, indentationAt, lastOnLine} from '../scan.ts'
import type {Damage, KindDefinition, KindOptions} from './types.ts'

// A comma may only go when the two entries stay two tokens without it: it has whitespace next to it, or a quote or a
// bracket on one side. Without this rule [1,2] would become the valid [12].
function safeToRemoveComma(codePoints: readonly string[], comma: number) {
  const before = codePoints[comma - 1]!
  const after = codePoints[comma + 1]!
  return ' \t\n\r'.includes(before) || ' \t\n\r'.includes(after) || '"{}[]'.includes(before) || '"{}[]'.includes(after)
}
const atLineEnd = (codePoints: readonly string[], entry: Entry) => entry.commaAfter !== -1 && lastOnLine(codePoints, entry.commaAfter + 1)

function missingComma(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const {codePoints} = scanned
  const withComma = scanned.entries.filter(entry => entry.commaAfter !== -1 && safeToRemoveComma(codePoints, entry.commaAfter))
  if (withComma.length === 0) return undefined
  const lineEndInObject = withComma.filter(entry => atLineEnd(codePoints, entry) && entry.container.type === 'object')
  const lineEndInArray = withComma.filter(entry => atLineEnd(codePoints, entry) && entry.container.type === 'array')
  const onOneLine = withComma.filter(entry => !atLineEnd(codePoints, entry))
  const everyCommaOf = (container: Container) => container.entries.filter(entry => entry.commaAfter !== -1)
  const wholeContainers = scanned.containers.filter(container => container.entries.length >= 3 && everyCommaOf(container).every(entry => safeToRemoveComma(codePoints, entry.commaAfter)))
  const lineRuns = scanned.containers.filter(container => container.entries.filter(entry => atLineEnd(codePoints, entry)).length >= 3)
  const form = options.scope ?? random.weighted([
    ['line end in an object', lineEndInObject.length > 0 ? 52 : 0], ['line end in an array', lineEndInArray.length > 0 ? 11 : 0],
    ['inside a line', onOneLine.length > 0 ? 12 : 0], ['every comma of one container', wholeContainers.length > 0 ? 10 : 0],
    ['line ends in a row', lineRuns.length > 0 ? 10 : 0],
  ] as const)
  switch (form) {
    case 'line end in an object': {
      if (lineEndInObject.length === 0) return undefined
      // People append: in six texts of ten the comma is the one between the last two members.
      const beforeLast = lineEndInObject.filter(entry => entry.index === entry.container.entries.length - 2)
      const entry = random.pick(beforeLast.length > 0 && random.chance(0.6) ? beforeLast : lineEndInObject)
      return {edits: [removeRange(entry.commaAfter, entry.commaAfter + 1)], form: `at a line end between two members${beforeLast.includes(entry) ? ', the last two' : ''}`, reachable: 'yes'}
    }
    case 'line end in an array': {
      if (lineEndInArray.length === 0) return undefined
      const entry = random.pick(lineEndInArray)
      return {edits: [removeRange(entry.commaAfter, entry.commaAfter + 1)], form: 'at a line end between two items', reachable: 'yes'}
    }
    case 'inside a line': {
      if (onOneLine.length === 0) return undefined
      const entry = random.pick(onOneLine)
      return {edits: [removeRange(entry.commaAfter, entry.commaAfter + 1)], form: `inside a line, in an ${entry.container.type}`, reachable: 'yes'}
    }
    case 'every comma of one container': {
      if (wholeContainers.length === 0) return undefined
      const container = random.pick(wholeContainers)
      return {edits: everyCommaOf(container).map(entry => removeRange(entry.commaAfter, entry.commaAfter + 1)), form: `every comma of one ${container.type}`, reachable: 'yes'}
    }
    case 'line ends in a row': {
      if (lineRuns.length === 0) return undefined
      const entries = random.pick(lineRuns).entries.filter(entry => atLineEnd(codePoints, entry))
      const count = random.integer(2, Math.min(4, entries.length))
      const first = random.integer(0, entries.length - count)
      return {edits: entries.slice(first, first + count).map(entry => removeRange(entry.commaAfter, entry.commaAfter + 1)), form: `${count} line ends in a row`, reachable: 'yes'}
    }
    default:
      return undefined
  }
}

function trailingComma(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const {codePoints} = scanned
  const filled = scanned.containers.filter(container => container.entries.length > 0)
  if (filled.length === 0) return undefined
  const onLines = filled.filter(container => container.severalLines)
  const onOneLine = filled.filter(container => !container.severalLines)
  const lastEnd = (container: Container) => container.entries.at(-1)!.end
  // Arrays whose items are objects, e.g. records that a loop wrote.
  const recordArrays = scanned.containers.filter(container => container.type === 'array' && container.entries.length >= 2 && container.entries.every(entry => entry.value.type === 'object' && entry.value.container!.entries.length > 0))
  const form = options.scope ?? random.weighted([
    ['line end', onLines.length > 0 ? 45 : 0], ['line end and an empty line', onLines.length > 0 ? 15 : 0], ['one line', onOneLine.length > 0 ? 14 : 0],
    ['every container on several lines', onLines.length > 1 ? 12 : 0], ['every record', recordArrays.length > 0 ? 8 : 0], ['every container', filled.length > 1 ? 6 : 0],
  ] as const)
  switch (form) {
    case 'line end': {
      if (onLines.length === 0) return undefined
      return {edits: [insertAt(lastEnd(random.pick(onLines)), ',')], form: 'after the last entry, at a line end', reachable: 'yes'}
    }
    case 'line end and an empty line': {
      if (onLines.length === 0) return undefined
      // The person typed the comma, pressed Enter and is about to type: a line that holds only the entry's indentation.
      const container = random.pick(onLines)
      return {edits: [insertAt(lastEnd(container), `,\n${indentationAt(codePoints, container.entries.at(-1)!.start)}`)], form: 'after the last entry, then a line with only the indentation', reachable: 'yes'}
    }
    case 'one line': {
      if (onOneLine.length === 0) return undefined
      const container = random.pick(onOneLine)
      // A space after the comma only in a text that has spaces after its colons or commas.
      const first = container.entries[0]!
      const spaced = codePoints[(first.colon === -1 ? first.commaAfter : first.colon) + 1] === ' '
      return {edits: [insertAt(lastEnd(container), spaced && random.chance(0.4) && codePoints[lastEnd(container)] !== ' ' ? ', ' : ',')], form: `before the closer of a one-line ${container.type}`, reachable: 'yes'}
    }
    case 'every container on several lines': {
      if (onLines.length === 0) return undefined
      return {edits: onLines.map(container => insertAt(lastEnd(container), ',')), form: `in every container on several lines, ${onLines.length} of them`, reachable: 'yes'}
    }
    case 'every record': {
      if (recordArrays.length === 0) return undefined
      const array = random.pick(recordArrays)
      const edits = array.entries.map(entry => insertAt(lastEnd(entry.value.container!), ','))
      const alsoArray = random.chance(0.5)
      if (alsoArray) edits.push(insertAt(lastEnd(array), ','))
      return {edits, form: `in every record of one array${alsoArray ? ' and in the array' : ''}`, reachable: 'yes'}
    }
    case 'every container': {
      return {edits: filled.map(container => insertAt(lastEnd(container), ',')), form: `in every container, ${filled.length} of them`, reachable: 'yes'}
    }
    default:
      return undefined
  }
}

function extraComma(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const withComma = scanned.entries.filter(entry => entry.commaAfter !== -1)
  const lineEnd = withComma.filter(entry => atLineEnd(codePoints, entry))
  const inLine = withComma.filter(entry => !atLineEnd(codePoints, entry))
  const oneLineContainers = scanned.containers.filter(container => container.entries.length > 0 && !container.severalLines)
  const recordArrays = scanned.containers.filter(container => container.type === 'array' && container.entries.length >= 2 && container.entries.every(entry => entry.value.type === 'object' && entry.value.container!.entries.length > 0 && !entry.value.container!.severalLines))
  const form = random.weighted([
    ['doubled inside a line', inLine.length > 0 ? 35 : 0], ['doubled on a line of its own', lineEnd.length > 0 ? 35 : 0],
    ['leading', oneLineContainers.length > 0 ? 22 : 0], ['leading in every record', recordArrays.length > 0 ? 8 : 0],
  ] as const)
  switch (form) {
    case 'doubled inside a line': {
      if (inLine.length === 0) return undefined
      // The entry between two commas was deleted: `, ,` when the commas had a space after them, otherwise `,,`.
      const comma = random.pick(inLine).commaAfter
      const spaced = codePoints[comma + 1] === ' '
      return {edits: [insertAt(comma + 1, spaced && random.chance(0.7) ? ' ,' : ',')], form: 'a second comma after a comma, inside a line', reachable: 'yes'}
    }
    case 'doubled on a line of its own': {
      if (lineEnd.length === 0) return undefined
      const entry = random.pick(lineEnd)
      return {edits: [insertAt(entry.commaAfter + 1, `\n${indentationAt(codePoints, entry.start)},`)], form: 'a comma on a line of its own', reachable: 'yes'}
    }
    case 'leading': {
      if (oneLineContainers.length === 0) return undefined
      const container = random.pick(oneLineContainers)
      return {edits: [insertAt(container.open + 1, random.chance(0.4) ? ', ' : ',')], form: `before the first entry of an ${container.type}`, reachable: 'yes'}
    }
    case 'leading in every record': {
      if (recordArrays.length === 0) return undefined
      return {edits: random.pick(recordArrays).entries.map(entry => insertAt(entry.value.container!.open + 1, ',')), form: 'before the first member of every record of one array', reachable: 'yes'}
    }
  }
}

function missingColon(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  // Only where a space follows the colon, so that the key and the value stay apart, e.g. "port" 8080.
  const members = scanned.entries.filter(entry => entry.key !== null && codePoints[entry.colon + 1] === ' ')
  if (members.length === 0) return undefined
  const entry = random.pick(members)
  const isString = entry.value.type === 'string'
  return {
    edits: [removeRange(entry.colon, entry.colon + 1)],
    form: `before a ${entry.value.type === 'object' || entry.value.type === 'array' ? 'container' : entry.value.type}`,
    // A string after a key is also what a half-typed key before the next member looks like. The two differ in the line
    // feed between the strings, which is missing here.
    reachable: isString ? 'line rule' : 'yes',
  }
}

// `=>` or `=` between a key and its value, as Ruby prints a hash and as config files in other notations write it.
function foreignKeySeparator(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const members = scanned.entries.filter(entry => entry.key !== null)
  if (members.length === 0) return undefined
  const spaced = members.every(entry => codePoints[entry.colon + 1] === ' ')
  const form = random.weighted([['arrow', spaced && !scanned.severalLines ? 45 : 0], ['arrow with spaces', spaced && !scanned.severalLines ? 25 : 0], ['equals sign', 30]] as const)
  const edits: Edit[] = []
  if (form === 'equals sign') {
    // One member that a person typed that way, or every member of the text.
    const changed = random.chance(0.3) ? [random.pick(members)] : members
    for (const entry of changed) edits.push(spaced ? {at: entry.colon, remove: 1, insert: ' ='} : replaceOneForOne(entry.colon, '='))
    return {edits, form: `${spaced ? '" =" for' : '= for'} ${changed.length === members.length ? 'every colon' : 'one colon'}`, reachable: 'yes'}
  }
  // A Ruby print: every colon changes, and every null is nil.
  for (const entry of members) edits.push(form === 'arrow' ? {at: entry.colon, remove: 2, insert: '=>'} : {at: entry.colon, remove: 1, insert: ' =>'})
  for (const literal of scanned.literals) {
    if (codePoints[literal.start] === 'n') edits.push({at: literal.start, remove: 4, insert: 'nil'})
  }
  return {edits, form: form === 'arrow' ? '=> for every colon and its space, as Ruby prints a hash' : '" =>" for every colon, as Ruby 3.4 prints a hash', reachable: 'yes'}
}

export const separatorKinds: KindDefinition[] = [
  {
    name: 'missingComma', family: 'separator', weight: 5.5,
    example: '{⏎  "version": "0.4.1"⏎  "private": true⏎}',
    reachable: 'yes: after a complete value, a string inside an object is the next key, and the start of a value inside an array is the next item',
    styles: [['indented', 62], ['tabbed', 14], ['spaced', 16], ['compact', 8]],
    apply: missingComma,
  },
  {
    name: 'trailingComma', family: 'separator', weight: 7.5,
    example: '{⏎  "host": "localhost",⏎  "port": 8080,⏎}',
    reachable: 'yes: a closing bracket after a comma closes the container',
    styles: [['indented', 62], ['tabbed', 14], ['spaced', 16], ['compact', 8]],
    margin: 40,
    apply: trailingComma,
  },
  {
    name: 'extraComma', family: 'separator', weight: 1.5,
    example: '{"id": 7, , "tags": ["ops"]}',
    reachable: 'yes: a comma where a key or a value should start changes nothing',
    margin: 24,
    apply: extraComma,
  },
  {
    name: 'missingColon', family: 'separator', weight: 0.8,
    example: '{⏎  "port" 8080,⏎  "host": "localhost"⏎}',
    reachable: 'yes when the value is a number, a literal or a container, which can only be the value. line rule when the value is a string: on the same line it is the value, where a half-typed key has the next key on the next line',
    styles: [['indented', 60], ['tabbed', 10], ['spaced', 30]],
    apply: missingColon,
  },
  {
    name: 'foreignKeySeparator', family: 'separator', weight: 0.6,
    example: '{"id"=>42, "name"=>"Ada", "manager"=>nil}',
    reachable: 'yes: where a colon is expected, = and > are skipped and a value comes next',
    styles: [['spaced', 70], ['indented', 30]],
    margin: 60,
    apply: foreignKeySeparator,
  },
]
