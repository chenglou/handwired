// Edits turn the text its author meant into the broken text, and say which code point of one is which code point of
// the other.
//
// An edit removes `remove` code points of the original at `at` and puts `insert` there. A code point of the broken text
// is then one of three things:
// - kept: it is a code point of the original that no edit touched, and takes that code point's label.
// - replaced one for one: an edit with `oneForOne` put it in the place of one code point of the original that plays the
//   same part, e.g. ' for ", = for a colon, or ] for }. It takes that code point's label too.
// - added: every other inserted code point, e.g. an extra comma or a comment's text. It has no counterpart and no label.
//
// Where the broken text is the same whichever of two equal code points an edit touches, e.g. the `}}` that is left of
// `}}}`, the edits say that the later one was removed, and that of `}}}}` for `}}}` the last one was added: see
// canonicalEdits. So next to one such edit, a kept code point has the label of the earlier of the two code points
// that it can stand for. That is a rule for each edit alone: an edit moves as a whole and stops at the next edit, so
// it is no rule for every way of pairing the two texts. E.g. when the line of an inner `}` is removed and the line of
// the outer `}` follows, the `}` that is left is the outer one.
//
// Text that is added before the whole original is the exception, unless it is one code point, once or repeated. It
// stays where it is, e.g. a log prefix that happens to start with the document's first characters: the whole prefix
// is added, and the whole document is kept. See canonicalEdits.

export type Edit = {
  // An index into the original's code points.
  at: number
  remove: number
  insert: string
  // True when `insert` has exactly `remove` code points and each stands for the removed code point at the same offset.
  oneForOne?: boolean
  // The order among edits that only insert at the same place: a lower rank comes first, and edits of one rank keep the
  // order in which their kinds were applied. Text around a document has a negative rank before it and a positive one
  // after it, e.g. -5 for a sentence and -4 for a code fence, so that the sentence comes first.
  rank?: number
}

export const removeRange = (from: number, to: number): Edit => ({at: from, remove: to - from, insert: ''})
export const insertAt = (at: number, text: string): Edit => ({at, remove: 0, insert: text})
export const replaceOneForOne = (at: number, text: string): Edit => ({at, remove: Array.from(text).length, insert: text, oneForOne: true})

// Puts the edits of several kinds of damage into one list in text order, or returns undefined when two of them touch
// the same code points, e.g. one removes a comma that the other replaces.
export function mergeEdits(lists: readonly (readonly Edit[])[], originalLength: number): Edit[] | undefined {
  const merged: {edit: Edit, order: number}[] = []
  lists.forEach((list, listIndex) => list.forEach((edit, editIndex) => merged.push({edit, order: listIndex * 100_000 + editIndex})))
  merged.sort((left, right) =>
    left.edit.at - right.edit.at
    // At one place, pure insertions come before an edit that removes from that place on.
    || Number(left.edit.remove > 0) - Number(right.edit.remove > 0)
    || (left.edit.rank ?? 0) - (right.edit.rank ?? 0)
    || left.order - right.order)
  // The end of the last removed range. An edit that starts before it touches code points that another edit removed.
  let covered = 0
  for (const {edit} of merged) {
    if (edit.at < covered || edit.at + edit.remove > originalLength) return undefined
    if (edit.remove > 0) covered = edit.at + edit.remove
  }
  return merged.map(({edit}) => edit)
}

export type AppliedEdits = {
  broken: string
  // For each code point of the broken text: the index of its counterpart in the original, or -1 when the damage added it.
  alignment: number[]
  // For each code point of the broken text: whether it stands in the place of its counterpart and differs from it.
  replaced: boolean[]
  // The index in the broken text of the first code point that is added or replaced, or of the first kept code point
  // after a removed part, or the broken text's length when the edits only removed the original's end. -1 without edits.
  firstDamage: number
}

// Moves every edit that only removes, and every edit that only inserts, to the right as far as the broken text stays
// the same. Removing `ab` before another `a` gives the same text as removing the `ba` after the first `a`, and adding
// `}` before a `}` gives the same text as adding it after that `}`. Which of the two happened is not in the text, so
// the dataset always says the later one: then the code points that a reader meets first are kept ones, with the labels
// of the earlier code points of the original. The edits are in text order and don't overlap, as mergeEdits returns
// them, and an edit never moves into the place of the edit after it.
//
// One insertion does not move: text before the whole original, unless it is one code point, once or repeated. Such a
// text came from somewhere else as a whole, e.g. the log prefix `2026-06-19 12:23:40,515 - app.orders - ERROR - `
// before the document `20142`. Moved, the `20` of the year would be kept as the start of the number, and the text
// `26-06-19 … ERROR - 20` would be the added one. A second `{` before the `{` of a document still moves: there the
// two readings add the same text, and the first brace is the kept one.
export function canonicalEdits(original: readonly string[], edits: readonly Edit[]): Edit[] {
  const moved: Edit[] = [...edits]
  // From the last edit to the first, so that each edit moves up to where the edit after it now is.
  for (let index = moved.length - 1; index >= 0; index--) {
    const edit = moved[index]!
    const limit = moved[index + 1]?.at ?? original.length
    if (edit.oneForOne === true) continue
    if (edit.insert === '' && edit.remove > 0) {
      let at = edit.at
      while (at + edit.remove < limit && original[at + edit.remove] === original[at]) at++
      if (at !== edit.at) moved[index] = {...edit, at}
    } else if (edit.remove === 0 && edit.insert !== '') {
      const inserted = Array.from(edit.insert)
      if (edit.at === 0 && inserted.some(character => character !== inserted[0])) continue
      let at = edit.at
      while (at < limit && original[at] === inserted[0]) {
        inserted.push(inserted.shift()!)
        at++
      }
      if (at !== edit.at) moved[index] = {...edit, at, insert: inserted.join('')}
    }
  }
  return moved
}

// Applies edits that are in text order and don't overlap.
export function applyEdits(original: readonly string[], edits: readonly Edit[]): AppliedEdits {
  const broken: string[] = []
  const alignment: number[] = []
  const replaced: boolean[] = []
  let firstDamage = -1
  let position = 0
  for (const edit of edits) {
    if (edit.at < position) throw new Error(`edits overlap or are out of order at ${edit.at}`)
    for (; position < edit.at; position++) {
      broken.push(original[position]!)
      alignment.push(position)
      replaced.push(false)
    }
    if (firstDamage === -1 && (edit.remove > 0 || edit.insert !== '')) firstDamage = broken.length
    const inserted = Array.from(edit.insert)
    if (edit.oneForOne === true && inserted.length !== edit.remove) throw new Error(`a one for one edit must insert as many code points as it removes, at ${edit.at}`)
    inserted.forEach((character, offset) => {
      broken.push(character)
      alignment.push(edit.oneForOne === true ? edit.at + offset : -1)
      replaced.push(edit.oneForOne === true && character !== original[edit.at + offset])
    })
    position += edit.remove
  }
  if (position > original.length) throw new Error('an edit removes past the end of the original')
  for (; position < original.length; position++) {
    broken.push(original[position]!)
    alignment.push(position)
    replaced.push(false)
  }
  return {broken: broken.join(''), alignment, replaced, firstDamage}
}
