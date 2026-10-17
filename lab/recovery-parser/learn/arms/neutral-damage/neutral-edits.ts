// The ten edits of the language-neutral damage, and the draw of the edits of one sample.
//
// An edit works on a text as a list of code points. It reads how long the text is, which of its code points are equal
// to each other, and where its line feeds are, and nothing else: no bracket, no quote, no token. So this file imports
// nothing but the type of the random source, and check.ts shows that the same draws make the same edits on a text in
// which every code point but the line feed is renamed.
//
// The edits, their weights and the number of edits per sample were fixed before any score existed, see README.md.
// Nothing here is tuned.
import type {Random} from '../../../random.ts'

// A text while it is being damaged: its code points, and for each one the index of the code point of the original
// that it is, or -1 when an edit put it there. An edit puts a code point there when it inserts it, when it replaces
// another one with it, when it swaps it with its neighbour, and when it copies it: of a run and its copy, the copy
// is the added one.
export type DamagedText = {codePoints: string[], origin: number[]}

// What an edit did: its place in neutralEditNames, and a sentence for a reader, with places in the text as it was
// when the edit was applied, e.g. 'delete a run: 7 code points at 30, "\"port\":"'.
export type AppliedNeutralEdit = {edit: number, description: string}

const lineFeed = '\n'
const shortestRun = 2
const longestRun = 20

const quoted = (codePoints: readonly string[]) => JSON.stringify(codePoints.join(''))

function insertInto(text: DamagedText, at: number, codePoints: readonly string[]) {
  text.codePoints.splice(at, 0, ...codePoints)
  text.origin.splice(at, 0, ...codePoints.map(() => -1))
}
function removeFrom(text: DamagedText, at: number, count: number) {
  text.codePoints.splice(at, count)
  text.origin.splice(at, count)
}

// A run of 2 to 20 code points: a length that the text has room for, then a start, both uniform.
function drawRun(random: Random, textLength: number) {
  if (textLength < shortestRun) return undefined
  const length = random.integer(shortestRun, Math.min(longestRun, textLength))
  return {start: random.integer(0, textLength - length), length}
}

// The lines of a text: each runs up to and including its line feed, and the last one has none when the text does
// not end with a line feed. So a carriage return before a line feed is the last code point of the line's content.
function linesOf(codePoints: readonly string[]) {
  const lines: {start: number, length: number}[] = []
  let start = 0
  for (let index = 0; index < codePoints.length; index++) {
    if (codePoints[index] !== lineFeed) continue
    lines.push({start, length: index + 1 - start})
    start = index + 1
  }
  if (start < codePoints.length) lines.push({start, length: codePoints.length - start})
  return lines
}

// An edit changes `text` and returns its sentence, or returns undefined and changes nothing when the text has no
// place for it, e.g. a swap in a text whose code points are all the same.
type NeutralEdit = {name: string, apply: (random: Random, text: DamagedText) => string | undefined}

export const neutralEdits: readonly NeutralEdit[] = [
  {
    name: 'delete one code point',
    apply(random, text) {
      if (text.codePoints.length === 0) return undefined
      const at = random.integer(0, text.codePoints.length - 1)
      const deleted = text.codePoints[at]!
      removeFrom(text, at, 1)
      return `${quoted([deleted])} at ${at}`
    },
  },
  {
    // The code point is the one at a uniform place of the same text, so a frequent code point is drawn more often.
    name: 'insert one code point',
    apply(random, text) {
      if (text.codePoints.length === 0) return undefined
      const at = random.integer(0, text.codePoints.length)
      const inserted = text.codePoints[random.integer(0, text.codePoints.length - 1)]!
      insertInto(text, at, [inserted])
      return `${quoted([inserted])} at ${at}`
    },
  },
  {
    // The new code point is drawn as an inserted one is, among the places that hold another code point than the
    // replaced one.
    name: 'replace one code point',
    apply(random, text) {
      if (text.codePoints.length === 0) return undefined
      const at = random.integer(0, text.codePoints.length - 1)
      const replaced = text.codePoints[at]!
      const others = text.codePoints.filter(codePoint => codePoint !== replaced)
      if (others.length === 0) return undefined
      const replacement = others[random.integer(0, others.length - 1)]!
      text.codePoints[at] = replacement
      text.origin[at] = -1
      return `${quoted([replaced])} at ${at} with ${quoted([replacement])}`
    },
  },
  {
    // Neither of the two is where the original has it, so both count as added.
    name: 'swap two neighbours',
    apply(random, text) {
      const places: number[] = []
      for (let index = 0; index + 1 < text.codePoints.length; index++) if (text.codePoints[index] !== text.codePoints[index + 1]) places.push(index)
      if (places.length === 0) return undefined
      const at = places[random.integer(0, places.length - 1)]!
      const first = text.codePoints[at]!
      const second = text.codePoints[at + 1]!
      text.codePoints[at] = second
      text.codePoints[at + 1] = first
      text.origin[at] = -1
      text.origin[at + 1] = -1
      return `${quoted([first, second])} at ${at}`
    },
  },
  {
    name: 'delete a run',
    apply(random, text) {
      const run = drawRun(random, text.codePoints.length)
      if (run === undefined) return undefined
      const deleted = text.codePoints.slice(run.start, run.start + run.length)
      removeFrom(text, run.start, run.length)
      return `${run.length} code points at ${run.start}, ${quoted(deleted)}`
    },
  },
  {
    // The copy follows the run.
    name: 'duplicate a run',
    apply(random, text) {
      const run = drawRun(random, text.codePoints.length)
      if (run === undefined) return undefined
      const copied = text.codePoints.slice(run.start, run.start + run.length)
      insertInto(text, run.start + run.length, copied)
      return `${run.length} code points at ${run.start}, ${quoted(copied)}`
    },
  },
  {
    // The copy goes to a uniform place outside the run. The run's two ends are left out as well: a copy there is a
    // run duplicated in place.
    name: 'copy a run to another place',
    apply(random, text) {
      const run = drawRun(random, text.codePoints.length)
      if (run === undefined || run.length === text.codePoints.length) return undefined
      const copied = text.codePoints.slice(run.start, run.start + run.length)
      const placeOutside = random.integer(0, text.codePoints.length - run.length - 1)
      const to = placeOutside < run.start ? placeOutside : placeOutside + run.length + 1
      insertInto(text, to, copied)
      return `${run.length} code points from ${run.start} to ${to}, ${quoted(copied)}`
    },
  },
  {
    // The line goes with its line feed. The last line of a text that does not end with a line feed has none.
    name: 'delete one line',
    apply(random, text) {
      const lines = linesOf(text.codePoints)
      if (lines.length === 0) return undefined
      const chosen = random.integer(0, lines.length - 1)
      const line = lines[chosen]!
      const deleted = text.codePoints.slice(line.start, line.start + line.length)
      removeFrom(text, line.start, line.length)
      return `line ${chosen + 1} of ${lines.length}, ${quoted(deleted)}`
    },
  },
  {
    // The copy follows the line, with the line's line feed when the line has one.
    name: 'duplicate one line',
    apply(random, text) {
      const lines = linesOf(text.codePoints)
      if (lines.length === 0) return undefined
      const chosen = random.integer(0, lines.length - 1)
      const line = lines[chosen]!
      const copied = text.codePoints.slice(line.start, line.start + line.length)
      insertInto(text, line.start + line.length, copied)
      return `line ${chosen + 1} of ${lines.length}, ${quoted(copied)}`
    },
  },
  {
    // At least one code point stays and at least one goes.
    name: 'cut the tail',
    apply(random, text) {
      if (text.codePoints.length < 2) return undefined
      const kept = random.integer(1, text.codePoints.length - 1)
      const cut = text.codePoints.length - kept
      removeFrom(text, kept, cut)
      return `${cut} code points from ${kept} on`
    },
  },
]
export const neutralEditNames: readonly string[] = neutralEdits.map(edit => edit.name)

// A sample gets one edit with probability 0.6, two with 0.3 and three with 0.1.
const editCounts: readonly (readonly [count: number, weight: number])[] = [[1, 0.6], [2, 0.3], [3, 0.1]]

// What a draw gives: the damaged text and its edits, or the edits that were drawn up to the one that the text had no
// place for, which is the last of the list.
export type NeutralDraw = {text: DamagedText, applied: AppliedNeutralEdit[]} | {noPlaceFor: number[]}

// Draws the edits of one sample and applies them to `original`, one after another, each to the text that the edit
// before it left. Every edit is one of the ten, each with the same weight.
export function drawNeutralDamage(random: Random, original: readonly string[]): NeutralDraw {
  const text: DamagedText = {codePoints: [...original], origin: original.map((_, index) => index)}
  const editCount = random.weighted(editCounts)
  const applied: AppliedNeutralEdit[] = []
  for (let step = 0; step < editCount; step++) {
    const edit = random.integer(0, neutralEdits.length - 1)
    const sentence = neutralEdits[edit]!.apply(random, text)
    if (sentence === undefined) return {noPlaceFor: [...applied.map(earlier => earlier.edit), edit]}
    applied.push({edit, description: `${neutralEdits[edit]!.name}: ${sentence}`})
  }
  return {text, applied}
}
