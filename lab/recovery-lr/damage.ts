// The damage of the train and validation samples, fixed by the lead: edits on code points and lines that know
// nothing of the language. Do not tune it.
//
// Ten edits, each with the same weight:
//  1. delete one code point
//  2. insert one code point, drawn from the code points of the original program, each place with the same weight
//  3. replace one code point with another one, drawn the same way and different from the one replaced
//  4. swap two neighbouring code points that differ
//  5. delete a run of 2 to 20 code points
//  6. duplicate a run of 2 to 20 code points in place: the copy follows the run
//  7. copy a run of 2 to 20 code points from elsewhere in the text and insert it at a random place
//  8. delete one line with its line break
//  9. duplicate one line
// 10. cut the text's tail at a random place
// Places and lengths are uniform over what the text allows, e.g. a run of a text of 9 code points has 2 to 9. A
// sample gets one edit with probability 0.6, two with 0.3 and three with 0.1, applied one after another, so a
// later edit can touch what an earlier one added.
//
// The result says for every code point which code point of the original it is, or -1 for one that an edit added.
// A swap keeps the code point that now comes first and adds the other one, e.g. `tehn` for `then` keeps t, e, n
// and adds the h: that is what a shortest edit script says of the two texts, and it keeps the places of the kept
// code points rising, which sample.ts asks for.
import type {Random} from './random.ts'

export type Damaged = {
  codePoints: number[]
  // Per code point: its place in the original, or -1 for a code point that an edit added.
  alignment: number[]
  // The names of the edits, in the order in which they were applied.
  edits: string[]
}

export const editNames = [
  'delete a code point', 'insert a code point', 'replace a code point', 'swap two code points', 'delete a run', 'duplicate a run', 'copy a run', 'delete a line',
  'duplicate a line', 'cut the tail',
] as const
const lineFeed = 10

export function damageProgram(original: ArrayLike<number>, random: Random): Damaged {
  if (original.length === 0) throw new Error('an empty program has no code point to insert')
  let codePoints = Array.from(original)
  let alignment = codePoints.map((_, place) => place)
  const edits: string[] = []
  const splice = (from: number, remove: number, addedCodePoints: readonly number[], addedAlignment: readonly number[]) => {
    codePoints = [...codePoints.slice(0, from), ...addedCodePoints, ...codePoints.slice(from + remove)]
    alignment = [...alignment.slice(0, from), ...addedAlignment, ...alignment.slice(from + remove)]
  }
  const added = (count: number): number[] => new Array<number>(count).fill(-1)
  const drawn = (): number => original[random.integer(0, original.length - 1)]!
  // The start and the end of every line. A line ends after its line feed, and the last line at the text's end.
  const lines = (): [start: number, end: number][] => {
    const list: [number, number][] = []
    let start = 0
    for (let place = 0; place < codePoints.length; place++) {
      if (codePoints[place] !== lineFeed) continue
      list.push([start, place + 1])
      start = place + 1
    }
    if (start < codePoints.length) list.push([start, codePoints.length])
    return list
  }
  // Applies one edit of the given kind, or returns false when the text allows none of that kind, e.g. no swap in `aaa`.
  const apply = (kind: typeof editNames[number]): boolean => {
    const length = codePoints.length
    switch (kind) {
      case 'delete a code point': {
        if (length < 1) return false
        splice(random.integer(0, length - 1), 1, [], [])
        return true
      }
      case 'insert a code point': {
        splice(random.integer(0, length), 0, [drawn()], [-1])
        return true
      }
      case 'replace a code point': {
        if (length < 1) return false
        const at = random.integer(0, length - 1)
        const others = Array.from(original).filter(codePoint => codePoint !== codePoints[at])
        if (others.length === 0) return false
        splice(at, 1, [random.pick(others)], [-1])
        return true
      }
      case 'swap two code points': {
        const places: number[] = []
        for (let place = 0; place + 1 < length; place++) if (codePoints[place] !== codePoints[place + 1]) places.push(place)
        if (places.length === 0) return false
        const at = random.pick(places)
        splice(at, 2, [codePoints[at + 1]!, codePoints[at]!], [alignment[at + 1]!, -1])
        return true
      }
      case 'delete a run': case 'duplicate a run': case 'copy a run': {
        if (length < 2) return false
        const runLength = random.integer(2, Math.min(20, length))
        const at = random.integer(0, length - runLength)
        if (kind === 'delete a run') splice(at, runLength, [], [])
        else if (kind === 'duplicate a run') splice(at + runLength, 0, codePoints.slice(at, at + runLength), added(runLength))
        else {
          // Elsewhere: not inside the run and not at its two ends, where the copy would be a duplicate in place.
          const places: number[] = []
          for (let place = 0; place <= length; place++) if (place < at || place > at + runLength) places.push(place)
          if (places.length === 0) return false
          splice(random.pick(places), 0, codePoints.slice(at, at + runLength), added(runLength))
        }
        return true
      }
      case 'delete a line': case 'duplicate a line': {
        const list = lines()
        if (list.length === 0) return false
        const [start, end] = random.pick(list)
        if (kind === 'delete a line') splice(start, end - start, [], [])
        else {
          // A last line without a line feed gets one before its copy.
          const line = codePoints.slice(start, end)
          const copy = line.at(-1) === lineFeed ? line : [lineFeed, ...line]
          splice(end, 0, copy, added(copy.length))
        }
        return true
      }
      case 'cut the tail': {
        if (length < 1) return false
        const at = random.integer(0, length - 1)
        splice(at, length - at, [], [])
        return true
      }
    }
  }
  const editCount = random.weighted([[1, 0.6], [2, 0.3], [3, 0.1]])
  for (let edit = 0; edit < editCount; edit++) {
    // A kind that the text allows no edit of is drawn again, e.g. every kind but an insertion in an empty text.
    for (;;) {
      const kind = random.pick(editNames)
      if (!apply(kind)) continue
      edits.push(kind)
      break
    }
  }
  return {codePoints, alignment, edits}
}
