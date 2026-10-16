// The damage of the dataset: ten edits that work on code points and on lines and know nothing of TOML.
//
// The JSON dataset damages a document by kinds that know JSON, e.g. a comma that is missing between two members. This
// dataset asks whether the recipe needs that knowledge, so its damage is fixed and blind: it reads which code points
// of a payload are equal and where its line feeds are, and nothing else. It does not know what a bracket, a quote or
// a key is. check-samples.ts checks that: the same draws on a payload whose code points are swapped for others give
// the same edits.
//
// The ten edits, each as likely as the others. Positions and lengths are drawn uniformly.
//  1. deleteCodePoint: one code point is deleted.
//  2. insertCodePoint: one code point is inserted. It is a copy of a code point of the payload, drawn by its position.
//  3. replaceCodePoint: one code point is replaced with another one, drawn the same way among the code points that
//     differ from it.
//  4. swapNeighbours: two code points next to each other that differ change places.
//  5. deleteRun: a run of 2 to 20 code points is deleted.
//  6. duplicateRun: a run of 2 to 20 code points is written twice, the copy right after the run.
//  7. copyRun: a run of 2 to 20 code points is copied to another place, which is not inside the run or at its ends.
//  8. deleteLine: one line is deleted with its line feed.
//  9. duplicateLine: one line is written twice.
// 10. cutTail: the payload ends at a drawn position.
//
// A sample gets one edit with probability 0.6, two with 0.3 and three with 0.1. They are applied one after another,
// each to the payload that the edit before it left, so the second edit can fall into what the first one added.
//
// Which code point of the result is which code point of the original: an edit that deletes takes code points away, and
// what an edit inserts is added, also the code point of a replacement and the copy of a run or of a line. Of two
// swapped code points the one that moved to the right is added, when both were code points of the original: the kept
// code points stay in the original's order. samples.ts turns the result into edits of edits.ts and into labels.
import {type Edit, insertAt, removeRange} from './edits.ts'
import type {Random} from './random.ts'

export const families = ['code point', 'run', 'line', 'tail'] as const
export type Family = typeof families[number]
export type KindDefinition = {
  name: string
  family: Family
  // What the edit does, for reports.
  description: string
}
export const kinds: readonly KindDefinition[] = [
  {name: 'deleteCodePoint', family: 'code point', description: 'one code point is deleted'},
  {name: 'insertCodePoint', family: 'code point', description: 'a copy of one of the payload\'s code points is inserted'},
  {name: 'replaceCodePoint', family: 'code point', description: 'one code point is replaced with another one of the payload'},
  {name: 'swapNeighbours', family: 'code point', description: 'two code points next to each other change places'},
  {name: 'deleteRun', family: 'run', description: 'a run of 2 to 20 code points is deleted'},
  {name: 'duplicateRun', family: 'run', description: 'a run of 2 to 20 code points is written twice'},
  {name: 'copyRun', family: 'run', description: 'a run of 2 to 20 code points is copied to another place'},
  {name: 'deleteLine', family: 'line', description: 'one line is deleted with its line feed'},
  {name: 'duplicateLine', family: 'line', description: 'one line is written twice'},
  {name: 'cutTail', family: 'tail', description: 'the payload ends at a drawn position'},
]
export function kindNamed(name: string): KindDefinition {
  const kind = kinds.find(candidate => candidate.name === name)
  if (kind === undefined) throw new Error(`unknown kind of damage: ${name}`)
  return kind
}

// How many edits a sample gets, with the probability of each number.
export const editCountWeights: readonly (readonly [editCount: number, probability: number])[] = [[1, 0.6], [2, 0.3], [3, 0.1]]
const shortestRun = 2
const longestRun = 20

// A code point of a payload under damage.
export type Tracked = {
  character: string
  // The index of the code point's counterpart in the original, or -1 for a code point that an edit added.
  origin: number
}
const added = (character: string): Tracked => ({character, origin: -1})
const copyOf = (run: readonly Tracked[]) => run.map(tracked => added(tracked.character))
const textOf = (run: readonly Tracked[]) => JSON.stringify(run.map(tracked => tracked.character).join(''))

// The lines of a payload as ranges from a start to an end that is left out. A line ends after its line feed, and the
// last line ends where the payload ends. A carriage return before a line feed is a code point of the line like any other.
function linesOf(payload: readonly Tracked[]): [start: number, end: number][] {
  const lines: [number, number][] = []
  let start = 0
  payload.forEach((tracked, index) => {
    if (tracked.character !== '\n') return
    lines.push([start, index + 1])
    start = index + 1
  })
  if (start < payload.length) lines.push([start, payload.length])
  return lines
}

// What an edit made of a payload, and a description for dumps, e.g. `"=" at 14`. Positions in a description are
// positions in the payload that the edit got, which is the original only for the first edit.
type Applied = {payload: Tracked[], form: string}
// An edit returns undefined when the payload has no place for it, e.g. a swap in a payload of equal code points.
type Apply = (random: Random, payload: readonly Tracked[]) => Applied | undefined

// A run's length and start: the length is drawn first, from 2 to 20 or to the payload's length when that is less.
function drawRun(random: Random, payload: readonly Tracked[]): [start: number, length: number] | undefined {
  if (payload.length < shortestRun) return undefined
  const length = random.integer(shortestRun, Math.min(longestRun, payload.length))
  return [random.integer(0, payload.length - length), length]
}

const applyKind: Record<string, Apply> = {
  deleteCodePoint(random, payload) {
    if (payload.length === 0) return undefined
    const at = random.integer(0, payload.length - 1)
    return {payload: [...payload.slice(0, at), ...payload.slice(at + 1)], form: `${textOf([payload[at]!])} at ${at}`}
  },
  insertCodePoint(random, payload) {
    if (payload.length === 0) return undefined
    const at = random.integer(0, payload.length)
    const inserted = added(payload[random.integer(0, payload.length - 1)]!.character)
    return {payload: [...payload.slice(0, at), inserted, ...payload.slice(at)], form: `${textOf([inserted])} at ${at}`}
  },
  replaceCodePoint(random, payload) {
    if (payload.length === 0) return undefined
    const at = random.integer(0, payload.length - 1)
    const replaced = payload[at]!
    // Every position whose code point differs is as likely as any other, so a frequent code point is drawn more often.
    const others = payload.filter(tracked => tracked.character !== replaced.character)
    if (others.length === 0) return undefined
    const inserted = added(random.pick(others).character)
    return {payload: [...payload.slice(0, at), inserted, ...payload.slice(at + 1)], form: `${textOf([replaced])} at ${at} with ${textOf([inserted])}`}
  },
  swapNeighbours(random, payload) {
    const places: number[] = []
    for (let index = 0; index + 1 < payload.length; index++) if (payload[index]!.character !== payload[index + 1]!.character) places.push(index)
    if (places.length === 0) return undefined
    const at = random.pick(places)
    const first = payload[at]!
    const second = payload[at + 1]!
    // The first one moves behind the second. When both are code points of the original, the one that moved is added.
    const moved = first.origin !== -1 && second.origin !== -1 ? added(first.character) : first
    return {payload: [...payload.slice(0, at), second, moved, ...payload.slice(at + 2)], form: `${textOf([first, second])} at ${at}`}
  },
  deleteRun(random, payload) {
    const run = drawRun(random, payload)
    if (run === undefined) return undefined
    const [start, length] = run
    return {payload: [...payload.slice(0, start), ...payload.slice(start + length)], form: `${length} code points at ${start}, ${textOf(payload.slice(start, start + length))}`}
  },
  duplicateRun(random, payload) {
    const run = drawRun(random, payload)
    if (run === undefined) return undefined
    const [start, length] = run
    const end = start + length
    return {payload: [...payload.slice(0, end), ...copyOf(payload.slice(start, end)), ...payload.slice(end)], form: `${length} code points at ${start}, ${textOf(payload.slice(start, end))}`}
  },
  copyRun(random, payload) {
    const run = drawRun(random, payload)
    if (run === undefined) return undefined
    const [start, length] = run
    const end = start + length
    // The places before the run's start and after its end: `start` of them before, and the rest after.
    const placesAfter = payload.length - end
    if (start + placesAfter === 0) return undefined
    const drawn = random.integer(0, start + placesAfter - 1)
    const at = drawn < start ? drawn : end + 1 + (drawn - start)
    return {payload: [...payload.slice(0, at), ...copyOf(payload.slice(start, end)), ...payload.slice(at)], form: `${length} code points from ${start} to ${at}, ${textOf(payload.slice(start, end))}`}
  },
  deleteLine(random, payload) {
    const lines = linesOf(payload)
    if (lines.length === 0) return undefined
    const lineIndex = random.integer(0, lines.length - 1)
    const [start, end] = lines[lineIndex]!
    return {payload: [...payload.slice(0, start), ...payload.slice(end)], form: `line ${lineIndex + 1} of ${lines.length}, ${textOf(payload.slice(start, end))}`}
  },
  duplicateLine(random, payload) {
    const lines = linesOf(payload)
    if (lines.length === 0) return undefined
    const lineIndex = random.integer(0, lines.length - 1)
    const [start, end] = lines[lineIndex]!
    const line = payload.slice(start, end)
    // The last line may have no line feed. Its copy then starts on a line of its own.
    const copy = line.at(-1)!.character === '\n' ? copyOf(line) : [added('\n'), ...copyOf(line)]
    return {payload: [...payload.slice(0, end), ...copy, ...payload.slice(end)], form: `line ${lineIndex + 1} of ${lines.length}, ${textOf(line)}`}
  },
  cutTail(random, payload) {
    if (payload.length === 0) return undefined
    const at = random.integer(0, payload.length - 1)
    return {payload: payload.slice(0, at), form: `at ${at} of ${payload.length}`}
  },
}

// One edit as it was made, e.g. {kind: 'deleteCodePoint', form: '"=" at 14'}.
export type DamageStep = {kind: string, form: string}
export type Damaged = {
  // The broken text's code points, each with the index of its counterpart in the original.
  payload: Tracked[]
  steps: DamageStep[]
}

// Draws the number of edits and then the edits, and applies them to the original one after another. Returns undefined
// when the payload has no place for a drawn edit. With `firstKind` the first edit is of that kind.
export function damage(random: Random, original: readonly string[], firstKind?: string): Damaged | undefined {
  const editCount = random.weighted(editCountWeights)
  let payload: readonly Tracked[] = original.map((character, origin) => ({character, origin}))
  const steps: DamageStep[] = []
  for (let editIndex = 0; editIndex < editCount; editIndex++) {
    const kind = editIndex === 0 && firstKind !== undefined ? kindNamed(firstKind) : random.pick(kinds)
    const applied = applyKind[kind.name]!(random, payload)
    if (applied === undefined) return undefined
    payload = applied.payload
    steps.push({kind: kind.name, form: applied.form})
  }
  return {payload: [...payload], steps}
}

// The edits of edits.ts that turn the original into a damaged payload, in text order. Between two kept code points,
// what the original has and the payload lacks is removed first, and what the payload has more is inserted after it.
// samples.ts puts the edits into the canonical form of edits.ts.
export function editsOf(original: readonly string[], payload: readonly Tracked[]): Edit[] {
  const edits: Edit[] = []
  // The original's first code point that is neither kept nor removed so far.
  let next = 0
  let inserted = ''
  const closeGapUpTo = (index: number) => {
    if (index > next) edits.push(removeRange(next, index))
    if (inserted !== '') edits.push(insertAt(index, inserted))
    inserted = ''
    next = index
  }
  for (const tracked of payload) {
    if (tracked.origin === -1) {
      inserted += tracked.character
      continue
    }
    if (tracked.origin < next) throw new Error('the kept code points of a damaged payload are not in the original\'s order')
    closeGapUpTo(tracked.origin)
    next = tracked.origin + 1
  }
  closeGapUpTo(original.length)
  return edits
}
