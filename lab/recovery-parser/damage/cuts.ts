// A part of the text is missing at a place that no keystroke chose: the end, the start, or a span in the middle.
import {type Edit, insertAt, removeRange} from '../edits.ts'
import type {Random} from '../random.ts'
import {type Scan, previousToken} from '../scan.ts'
import type {Damage, KindDefinition} from './types.ts'

// The text stops early: a stream that closed, an output limit, or a document typed from the top in a plain editor.
function cutOff(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const length = codePoints.length
  if (length < 2) return undefined
  const way = random.weighted([['anywhere', 60], ['after an entry', 25], ['before the last closers', 15]] as const)
  let cut = random.integer(1, length - 1)
  let form = 'anywhere'
  const rootContainer = scanned.root.container
  if (way === 'after an entry' && rootContainer !== null && rootContainer.entries.length > 0) {
    // A writer that stopped between two records: before the entry's comma, after it, or after the line feed after it.
    const entry = random.pick(rootContainer.entries)
    const places = [entry.end]
    if (entry.commaAfter !== -1) {
      places.push(entry.commaAfter + 1)
      if (codePoints[entry.commaAfter + 1] === '\n') places.push(entry.commaAfter + 2)
    }
    cut = random.pick(places)
    form = 'right after an entry of the outermost container'
  } else if (way === 'before the last closers' && rootContainer !== null) {
    // A model that stopped one to three brackets early: the closers at the very end are missing, with the whitespace between them.
    const closers: number[] = []
    let index = previousToken(codePoints, length)
    while (index >= 0 && (codePoints[index] === '}' || codePoints[index] === ']') && closers.length < 3) {
      closers.push(index)
      index = previousToken(codePoints, index)
    }
    const first = closers[random.integer(0, closers.length - 1)]!
    cut = previousToken(codePoints, first) + 1
    form = `only the last ${closers.indexOf(first) + 1} closing brackets are missing`
  }
  if (cut <= 0 || cut >= length) return undefined
  const edits: Edit[] = [removeRange(cut, length)]
  if (random.chance(0.2)) {
    // What the tool that cut the text wrote in its place.
    const marker = random.pick(['...', '…', ' [truncated]', '...[truncated]', '... (truncated)', '<truncated>', `... (${length - cut} more characters)`, '\n[output truncated]'])
    edits.unshift(insertAt(cut, marker))
    form += ', with a marker'
  }
  return {edits, form, reachable: 'yes'}
}

// The text starts too late: the opening bracket that a request supplied was not put back, or a reader joined late.
function headMissing(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  if (codePoints.length < 6) return undefined
  const rootContainer = scanned.root.container
  const onlyOpener = rootContainer !== null && scanned.root.start === 0 && random.chance(rootContainer.type === 'object' ? 0.75 : 0.25)
  if (onlyOpener) return {edits: [removeRange(0, 1)], form: `the opening ${rootContainer.type === 'object' ? 'brace' : 'bracket'} is missing`, reachable: 'no'}
  return {edits: [removeRange(0, random.integer(2, Math.floor(codePoints.length / 2)))], form: 'the start is missing up to an arbitrary place', reachable: 'no'}
}

// A carrier kept the start and the end and dropped the middle, with or without a marker.
function middleCutOut(random: Random, scanned: Scan): Damage | undefined {
  const length = scanned.codePoints.length
  if (length < 24) return undefined
  const withMarker = random.chance(0.7)
  const span = withMarker ? random.integer(10, Math.max(10, Math.floor(length * 0.6))) : random.integer(1, 30)
  if (span >= length - 4) return undefined
  const from = random.integer(2, length - span - 2)
  const edits: Edit[] = [removeRange(from, from + span)]
  if (withMarker) edits.unshift(insertAt(from, random.pick(['...', '…', '<snip>', '...(truncated)...', ` [... ${span} characters omitted ...] `])))
  // A span that is exactly one entry of a container leaves the commas around the entry, and nothing else of it. That
  // is the text of an entry that was deleted between its commas, which a parser can label as it labels the texts of
  // extraComma and trailingComma: a comma where a key or a value should start changes nothing, and a closing bracket
  // after a comma closes the container. So such a text has their flag.
  const entry = withMarker ? undefined : scanned.entries.find(candidate => candidate.start === from && candidate.end === from + span)
  if (entry !== undefined && (entry.index > 0 || entry.commaAfter !== -1)) {
    const leaves = entry.index > 0 && entry.commaAfter !== -1 ? 'two commas with nothing between them, as extraComma does'
      : entry.commaAfter !== -1 ? 'a comma before the first entry, as extraComma does' : 'a comma before the closer, as trailingComma does'
    return {edits, form: `a short span with nothing in its place, which is exactly one entry and leaves ${leaves}`, reachable: 'yes'}
  }
  return {edits, form: withMarker ? 'a span with a marker in its place' : 'a short span with nothing in its place', reachable: 'no'}
}

export const cutKinds: KindDefinition[] = [
  {
    name: 'cutOff', family: 'cut off', origin: 'either', weight: 7,
    example: '{"id": 42, "name": "Ada Lovel',
    reachable: 'yes, and nothing is left to recover: no kept character comes after the cut',
    margin: 30,
    apply: cutOff,
  },
  {
    name: 'headMissing', family: 'cut off', origin: 'output', weight: 0.6,
    example: '"id": 42, "name": "Ada"}',
    reachable: 'no: the depth at the start is unknown, and a text that starts inside a string has every later quote in the opposite role',
    apply: headMissing,
  },
  {
    name: 'middleCutOut', family: 'cut off', origin: 'output', weight: 0.6,
    example: '{"id": 7, "tags": ["urgent", "dr...lling": true}',
    reachable: 'no: the removed span can hold any number of brackets and quotes. yes when a span without a marker is exactly one entry: what is left are the commas around it, the text of extraComma or of trailingComma',
    margin: 34,
    apply: middleCutOut,
  },
]
