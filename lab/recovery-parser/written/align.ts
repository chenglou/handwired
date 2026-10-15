// From a broken text and a valid text to what a sample of the dataset has: for every code point of the broken text the
// index of its counterpart in the valid text, or -1 when it is added, and whether it stands in the place of a
// counterpart that differs from it. A written case has no edits, only the two texts, so the edits are found here.
//
// The script is a shortest one: the fewest code points removed and added. Among the shortest scripts it is the one
// with the fewest edits, e.g. one removal of `"result": {…}⏎  }` and no three removals around a line feed and a brace
// that the removed part also holds. The edits are then put into the canonical form of edits.ts, so of two equal code
// points the later one is the removed or the added one, and text before the whole original stays there.
//
// Six rules go beyond the shortest script. Each is here because the dataset's own alignment is plainly the better one
// where the rule applies, and check-align.ts counts how often the result is the dataset's:
//
// 1. A run of 12 or more code points that both texts hold is kept, the longest first, and the script only decides
//    what lies between such runs. Without it, a text of which little is kept is paired letter by letter with
//    whatever the valid text holds, e.g. a sentence and a code fence before a document that is cut off after `{`.
// 2. A code point stands one for one for another only when both play the same part: a quote mark for a quote, a
//    bracket for a bracket of the same direction, `=` or `;` for a colon, `;` for a comma, white space for white
//    space. See `standsFor`. So the `'` of `'name'` and the `=` of `"id"=>42` have labels, and the dots of `...` in the
//    place of three other code points have none. Among the scripts with the fewest edits, the one with the most such
//    pairs is taken.
// 3. A kept run of 3 code points or fewer between two edits that are both longer than it, which together both remove
//    and add text, is a chance match and is not kept, e.g. the `t` and the `r` of `[truncated]` that the removed rest
//    of the document also holds. At the end of a text that is cut off, such runs are also not kept when the broken
//    text adds more code points after its last longer kept run than the runs keep, e.g. the `]` of that marker.
// 4. A code point that stands for another needs a kept code point or another pair beside it, unless the edit around
//    it removes nothing else. So the `]` of `[output truncated]` does not stand for the bracket that ends the
//    document, and the `=` of `"id" => 42` still stands for the colon.
// 5. A string that lost its end keeps its own closing quote. In `"exclu"⏎}` for `"exclude": ["dist"]⏎}` the script
//    with the fewest edits removes `de": ["dist` and keeps the quote after `dist`, which is the quote of a value. The
//    quote after `exclu` is taken for the closing quote of the key that it closes in the broken text.
// 6. A number or a literal is one word. Its code points keep their counterparts when the word is whole, e.g. the
//    digits of `1,400,000` and of `NumberLong(15)`, or when only code points are missing from it, e.g. `tru`, `59.`
//    and `.5`. Otherwise the word in the broken text is another word and all of it is added, e.g. `True`, `nil`, `NaN`
//    and `0x1F`: the highlighter has no display kind for a word that is not JSON's.
//
// What these rules do not give is listed in the README of this folder under "What the tools cannot know".
import {type Edit, applyEdits, canonicalEdits} from '../edits.ts'

export type Aligned = {
  // For each code point of the broken text: the index of its counterpart in the valid text, or -1 when it is added.
  alignment: number[]
  // For each code point of the broken text: whether it stands in the place of its counterpart and differs from it.
  replaced: boolean[]
}

// keep: the two code points are the same. pair: the broken one stands one for one for the valid one. remove: a code
// point of the valid text that the broken text lacks. add: a code point of the broken text without a counterpart.
type Step = 'keep' | 'pair' | 'remove' | 'add'

const sharedRunLength = 12
const chanceMatchLength = 3
// The costs of a script, added up so that fewer changed code points always win, then fewer edits, then more pairs.
// A text has at most 512 code points, so a script has at most 513 edits and 512 pairs.
const costPerCodePoint = 2 ** 20
const costPerEdit = 1024

const quoteMarks = '\'`“”„‟‘’‚‛«»‹›'
// White space in the wide sense of JavaScript's \s: with the no-break space, the byte order mark and every other space
// of Unicode.
const isWhiteSpace = (character: string) => /^\s$/u.test(character)

// Whether a code point of the broken text can stand in the place of a code point of the valid text that differs from
// it: both play the same part in the text.
export function standsFor(brokenCharacter: string, validCharacter: string) {
  if (isWhiteSpace(validCharacter)) return isWhiteSpace(brokenCharacter)
  if (validCharacter === '"') return quoteMarks.includes(brokenCharacter)
  if (validCharacter === '{' || validCharacter === '[') return '([{'.includes(brokenCharacter)
  if (validCharacter === '}' || validCharacter === ']') return ')]}'.includes(brokenCharacter)
  if (validCharacter === ':') return brokenCharacter === '=' || brokenCharacter === ';'
  if (validCharacter === ',') return brokenCharacter === ';'
  return false
}

// The best script for two texts that share no long run: the fewest code points removed and added, then the fewest
// edits, then the most pairs. Where several steps are on a best script, the first of keep, pair, add, remove is
// taken, so that a code point is kept as early as it can be.
function shortestScript(broken: readonly string[], valid: readonly string[]): Step[] {
  const width = broken.length + 1
  // The cost of the best script for the rest of both texts from a place on, when the step before was a keep, and
  // when it was a step of an edit, which costs no new edit to go on with.
  const afterKeep = new Float64Array((valid.length + 1) * width)
  const insideEdit = new Float64Array((valid.length + 1) * width)
  for (let validIndex = valid.length; validIndex >= 0; validIndex--) {
    for (let brokenIndex = broken.length; brokenIndex >= 0; brokenIndex--) {
      if (validIndex === valid.length && brokenIndex === broken.length) continue
      const cell = validIndex * width + brokenIndex
      let keep = Infinity
      let change = Infinity
      if (validIndex < valid.length) change = Math.min(change, costPerCodePoint + insideEdit[cell + width]!)
      if (brokenIndex < broken.length) change = Math.min(change, costPerCodePoint + insideEdit[cell + 1]!)
      if (validIndex < valid.length && brokenIndex < broken.length) {
        if (valid[validIndex] === broken[brokenIndex]) keep = afterKeep[cell + width + 1]!
        else if (standsFor(broken[brokenIndex]!, valid[validIndex]!)) change = Math.min(change, 2 * costPerCodePoint - 1 + insideEdit[cell + width + 1]!)
      }
      insideEdit[cell] = Math.min(keep, change)
      afterKeep[cell] = Math.min(keep, change + costPerEdit)
    }
  }
  const steps: Step[] = []
  let validIndex = 0
  let brokenIndex = 0
  let inside = false
  while (validIndex < valid.length || brokenIndex < broken.length) {
    const cell = validIndex * width + brokenIndex
    const best = inside ? insideEdit[cell]! : afterKeep[cell]!
    const opening = inside ? 0 : costPerEdit
    const both = validIndex < valid.length && brokenIndex < broken.length
    let step: Step
    if (both && valid[validIndex] === broken[brokenIndex] && afterKeep[cell + width + 1] === best) step = 'keep'
    else if (both && valid[validIndex] !== broken[brokenIndex] && standsFor(broken[brokenIndex]!, valid[validIndex]!) && opening + 2 * costPerCodePoint - 1 + insideEdit[cell + width + 1]! === best) step = 'pair'
    else if (brokenIndex < broken.length && opening + costPerCodePoint + insideEdit[cell + 1]! === best) step = 'add'
    else step = 'remove'
    steps.push(step)
    inside = step !== 'keep'
    if (step !== 'add') validIndex++
    if (step !== 'remove') brokenIndex++
  }
  return steps
}

// The longest run of code points that the two ranges share, and of several the earliest one in the valid text.
function longestSharedRun(broken: readonly string[], brokenStart: number, brokenEnd: number, valid: readonly string[], validStart: number, validEnd: number) {
  const width = brokenEnd - brokenStart + 1
  // lengths[brokenIndex - brokenStart + 1]: the length of the shared run that ends with the two code points.
  let lengthsBefore = new Uint16Array(width)
  let longest = {length: 0, validStart: 0, brokenStart: 0}
  for (let validIndex = validStart; validIndex < validEnd; validIndex++) {
    const lengths = new Uint16Array(width)
    for (let brokenIndex = brokenStart; brokenIndex < brokenEnd; brokenIndex++) {
      if (valid[validIndex] !== broken[brokenIndex]) continue
      const length = lengthsBefore[brokenIndex - brokenStart]! + 1
      lengths[brokenIndex - brokenStart + 1] = length
      if (length > longest.length) longest = {length, validStart: validIndex - length + 1, brokenStart: brokenIndex - length + 1}
    }
    lengthsBefore = lengths
  }
  return longest
}

// Rule 1: the longest shared run is kept when it has 12 code points or more, then the same on each side of it, and
// the shortest script decides the rest.
function scriptOf(broken: readonly string[], brokenStart: number, brokenEnd: number, valid: readonly string[], validStart: number, validEnd: number): Step[] {
  const run = longestSharedRun(broken, brokenStart, brokenEnd, valid, validStart, validEnd)
  if (run.length < sharedRunLength) return shortestScript(broken.slice(brokenStart, brokenEnd), valid.slice(validStart, validEnd))
  return [
    ...scriptOf(broken, brokenStart, run.brokenStart, valid, validStart, run.validStart),
    ...Array.from({length: run.length}, (): Step => 'keep'),
    ...scriptOf(broken, run.brokenStart + run.length, brokenEnd, valid, run.validStart + run.length, validEnd),
  ]
}

// A script as runs: a run of kept and paired code points, then an edit, i.e. a run of removed and added ones, and so on.
type Run = {isEdit: boolean, steps: Step[], removed: number, added: number}
function runsOf(steps: readonly Step[]): Run[] {
  const runs: Run[] = []
  for (const step of steps) {
    const isEdit = step === 'remove' || step === 'add'
    let run = runs.at(-1)
    if (run?.isEdit !== isEdit) runs.push(run = {isEdit, steps: [], removed: 0, added: 0})
    run.steps.push(step)
    if (step === 'remove') run.removed++
    if (step === 'add') run.added++
  }
  return runs
}

// Rule 3: a kept run of 3 code points or fewer between two edits that are both longer than it, and that together both
// remove and add text, becomes a part of one edit. The edit that results can make the kept run next to it a chance
// match too, so the runs are gone over until none is left. A pair counts as a kept code point here.
function withoutChanceMatches(steps: readonly Step[]): Step[] {
  let runs = runsOf(steps)
  for (let index = 1; index < runs.length - 1; index++) {
    const run = runs[index]!
    const before = runs[index - 1]!
    const after = runs[index + 1]!
    if (run.isEdit || run.steps.length > chanceMatchLength) continue
    if (before.removed + after.removed === 0 || before.added + after.added === 0) continue
    if (run.steps.length >= Math.max(before.removed, before.added) || run.steps.length >= Math.max(after.removed, after.added)) continue
    const merged: Run = {
      isEdit: true, steps: [...before.steps, ...run.steps.flatMap((): Step[] => ['remove', 'add']), ...after.steps],
      removed: before.removed + run.steps.length + after.removed, added: before.added + run.steps.length + after.added,
    }
    runs = [...runs.slice(0, index - 1), merged, ...runs.slice(index + 2)]
    // The merged edit now stands at index - 1, and the kept run before it is looked at next.
    index = Math.max(0, index - 3)
  }
  // The end of a text that is cut off, i.e. the script ends with a removal: the kept runs of 3 code points or fewer
  // after the last longer kept run are chance matches when the broken text adds more code points there than these
  // runs keep. E.g. `ed]` at the end of `["x... [truncated]` for `["x-ray", "urgent", "retired"]}`, where the rule
  // above keeps `ed` because only a quote is removed after it.
  const last = runs.at(-1)
  if (last !== undefined && last.isEdit && last.added === 0) {
    const lastLongRun = runs.findLastIndex(run => !run.isEdit && run.steps.length > chanceMatchLength)
    // Without a longer kept run, the first run is left out: a kept run at the very start of both texts, or text
    // before the whole original, e.g. the line of a code fence before `nul`, after which `nul` is kept.
    const from = lastLongRun !== -1 ? lastLongRun + 1 : 1
    const end = runs.slice(from)
    const kept = end.reduce((total, run) => total + (run.isEdit ? 0 : run.steps.length), 0)
    const added = end.reduce((total, run) => total + run.added, 0)
    if (kept > 0 && kept < added) return [...runs.slice(0, from).flatMap(run => run.steps), ...end.flatMap(run => run.isEdit ? run.steps : run.steps.flatMap((): Step[] => ['remove', 'add']))]
  }
  return runs.flatMap(run => run.steps)
}

// Rule 4: a pair with no kept code point and no other pair beside it in the broken text, inside an edit that removes
// more than the pair's own counterpart, is no pair: its code point is added and its counterpart removed.
function withoutLonePairs(steps: readonly Step[]): Step[] {
  const isAnchor = (step: Step | undefined) => step === 'keep' || step === 'pair'
  // The neighbor of a step in the broken text: the nearest step on that side that is no removal.
  const neighbor = (from: number, direction: 1 | -1) => {
    let index = from + direction
    while (steps[index] === 'remove') index += direction
    return steps[index]
  }
  // Whether the steps around `from` remove a code point before the next kept one on either side.
  const removesBeside = (from: number) => {
    for (let index = from - 1; index >= 0 && steps[index] !== 'keep'; index--) if (steps[index] === 'remove') return true
    for (let index = from + 1; index < steps.length && steps[index] !== 'keep'; index++) if (steps[index] === 'remove') return true
    return false
  }
  return steps.flatMap((step, index): Step[] =>
    step === 'pair' && !isAnchor(neighbor(index, -1)) && !isAnchor(neighbor(index, 1)) && removesBeside(index) ? ['remove', 'add'] : [step])
}

// The edits of a script. A pair is an edit of its own that replaces one for one.
function editsOf(steps: readonly Step[], broken: readonly string[], valid: readonly string[]): Edit[] {
  const edits: Edit[] = []
  let validIndex = 0
  let brokenIndex = 0
  for (const run of runsOf(steps)) {
    if (run.isEdit) {
      edits.push({at: validIndex, remove: run.removed, insert: broken.slice(brokenIndex, brokenIndex + run.added).join('')})
      validIndex += run.removed
      brokenIndex += run.added
      continue
    }
    for (const step of run.steps) {
      if (step === 'pair') edits.push({at: validIndex, remove: 1, insert: broken[brokenIndex]!, oneForOne: true})
      validIndex++
      brokenIndex++
    }
  }
  // Text before the whole original stays there, unless it is one code point, once or repeated: see canonicalEdits.
  // The script keeps a code point as early as it can, so it takes such a text for one that was added after the
  // original's first code points, e.g. the log prefix `2026-06-19 12:23:40 ERROR ` before the number `20142` for
  // `26-06-19 12:23:40 ERROR 20` after a kept `20`. When the first edit only adds, and the same broken text comes
  // from adding at the very start, the edit is put there, where canonicalEdits leaves it.
  const first = edits[0]
  if (first !== undefined && first.remove === 0 && first.at > 0) {
    const inserted = Array.from(first.insert)
    let at = first.at
    while (at > 0 && inserted.at(-1) === valid[at - 1]) {
      inserted.unshift(inserted.pop()!)
      at--
    }
    if (at === 0 && inserted.some(character => character !== inserted[0])) edits[0] = {at: 0, remove: 0, insert: inserted.join('')}
  }
  return edits
}

// Where the strings, and the numbers and literals, of a valid JSON text are. A string runs from its opening quote to
// its closing quote, both included. A word is a number or a literal: `end` is the index after its last code point.
function partsOf(valid: readonly string[]) {
  const strings: {open: number, close: number}[] = []
  const words: {start: number, end: number}[] = []
  for (let index = 0; index < valid.length; index++) {
    const character = valid[index]!
    if (character === '"') {
      const open = index
      index++
      while (index < valid.length && valid[index] !== '"') index += valid[index] === '\\' ? 2 : 1
      strings.push({open, close: index})
    } else if (!' \t\n\r{}[]:,'.includes(character)) {
      const start = index
      while (index + 1 < valid.length && !' \t\n\r{}[]:,"'.includes(valid[index + 1]!)) index++
      words.push({start, end: index + 1})
    }
  }
  return {strings, words}
}

export function align(broken: string, valid: string): Aligned {
  const brokenCodePoints = Array.from(broken)
  const validCodePoints = Array.from(valid)
  const steps = withoutLonePairs(withoutChanceMatches(scriptOf(brokenCodePoints, 0, brokenCodePoints.length, validCodePoints, 0, validCodePoints.length)))
  const applied = applyEdits(validCodePoints, canonicalEdits(validCodePoints, editsOf(steps, brokenCodePoints, validCodePoints)))
  if (applied.broken !== broken) throw new Error('align.ts found edits that do not give the broken text')
  const {alignment, replaced} = applied
  // The position in the broken text of every code point of the valid text, or -1 when it is removed.
  const positionOf = new Array<number>(validCodePoints.length).fill(-1)
  alignment.forEach((counterpart, position) => { if (counterpart !== -1) positionOf[counterpart] = position })
  const {strings, words} = partsOf(validCodePoints)

  // Rule 5: a string whose opening quote has a counterpart and whose closing quote has none. When what the broken
  // text has of its content is followed at once by a quote that the script took for the closing quote of a later
  // string, that quote is the string's own closing quote. A quote that opens a later string is left alone: after
  // `"cons` in `"cons"stopOnEntry": false` the quote opens the next key, and the string before it is open.
  const closingQuotes = new Set(strings.map(string => string.close))
  for (const {open, close} of strings) {
    if (positionOf[open] === -1 || positionOf[close] !== -1) continue
    let position = positionOf[open]! + 1
    while (position < alignment.length && alignment[position]! > open && alignment[position]! < close) position++
    const taken = alignment[position]
    if (taken === undefined || taken <= close || !closingQuotes.has(taken)) continue
    positionOf[taken] = -1
    positionOf[close] = position
    alignment[position] = close
  }

  // Rule 6: a number or a literal that is not whole in the broken text. What is left of it keeps its counterparts
  // when only code points are missing: nothing is added inside it, nothing right before it unless the word's first
  // code point is there, and nothing right after it unless its last one is there.
  for (const {start, end} of words) {
    const kept: number[] = []
    let paired = false
    for (let index = start; index < end; index++) {
      const position = positionOf[index]!
      if (position === -1) continue
      if (replaced[position] === true) paired = true
      else kept.push(position)
    }
    if (kept.length === end - start) continue
    let onlyMissing = kept.length > 0 && !paired
    if (onlyMissing) {
      const first = kept[0]!
      const last = kept.at(-1)!
      for (let position = first; position <= last; position++) if (alignment[position] === -1) onlyMissing = false
      if (positionOf[start] === -1 && first > 0 && alignment[first - 1] === -1) onlyMissing = false
      if (positionOf[end - 1] === -1 && last + 1 < alignment.length && alignment[last + 1] === -1) onlyMissing = false
    }
    if (onlyMissing) continue
    for (let index = start; index < end; index++) {
      const position = positionOf[index]!
      if (position === -1) continue
      alignment[position] = -1
      replaced[position] = false
      positionOf[index] = -1
    }
  }
  return {alignment, replaced}
}
