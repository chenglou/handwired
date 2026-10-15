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
//    of the document also holds. After the cut of a text that is cut off, every such run is a chance match when the
//    broken text adds more code points there than the runs keep, e.g. the letters that `[Preview ends here]` shares
//    with the part that is missing. Three kinds of short run are never a chance match: one beside an edit that the
//    script makes at two places or more, e.g. the `:` of `&quot;:&quot;`, and the document's first code points
//    after other text and its last code points before other text, when the edit on their other side only removes
//    text or stays inside one value. See `withoutChanceMatches`.
// 4. A code point that stands for another needs a kept code point or another pair beside it, unless the edit around
//    it removes nothing else and the code point is not the broken text's first or last. So the `]` of
//    `[output truncated]` does not stand for the bracket that ends the document, and the `=` of `"id" => 42` still
//    stands for the colon.
// 5. A string that lost its end keeps its own closing quote. In `"exclu"⏎}` for `"exclude": ["dist"]⏎}` the script
//    with the fewest edits removes `de": ["dist` and keeps the quote after `dist`, which is the quote of a value. The
//    quote after `exclu` is taken for the closing quote of the key that it closes in the broken text.
// 6. A number or a literal is one word. Its code points keep their counterparts when the word is whole, e.g. the
//    digits of `1,400,000` and of `NumberLong(15)`, or when only code points are missing from it, e.g. `tru`, `59.`
//    and `.5`, also before added text that is no part of a word, e.g. the `409` of `"size":409"..., 24) = 24`.
//    Otherwise the word in the broken text is another word and all of it is added, e.g. `True`, `nil`, `NaN`, `0x1F`
//    and the `%t` of a format string: the highlighter has no display kind for a word that is not JSON's.
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

// Whether an added code point right against what is left of a number or a literal can be a part of one word with
// it: any code point but white space, JSON's punctuation, a quote mark and a round bracket. E.g. the `e` of `None`
// after the `n` that `null` also has, but not the quote after `409` in `"size":409"..., 24) = 24`.
const joinsWord = (character: string) => !isWhiteSpace(character) && !'{}[]:,"()'.includes(character) && !quoteMarks.includes(character)

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
//
// Three kinds of kept run are no chance match, however short:
// - A run beside an edit that the script makes at two places or more, with the same text removed and the same text
//   added, e.g. `&quot;` for `"`. Such an edit is a rule of the text's source, and what stands between two of them
//   is the document's own, e.g. the `:` of `&quot;:&quot;`.
// - The run with the valid text's last code point, when the script only adds text after it, and the edit before it
//   only removes text or changes nothing outside one number, literal or string: the end of the document before
//   other text. E.g. the `}⏎}` between a missing line `    ]` and a closing code fence, and the `}` between `NaN`
//   and such a fence. The `]` of `[Preview ends here]  Open the whole file` after a cut is none: the edit before it
//   removes the rest of the document.
// - The run with the valid text's first code point, when the script only adds text before it, and the edit after it
//   is of the same two sorts: the start of the document after other text, e.g. the `[` between a code fence and
//   `NaN`.
function withoutChanceMatches(steps: readonly Step[], broken: readonly string[], valid: readonly string[]): Step[] {
  let runs = runsOf(steps)
  const noChanceMatch = new Set<Run>()
  const editsByTexts = new Map<string, number[]>()
  const {strings, words} = partsOf(valid)
  // Whether an edit, which removes the valid code points from `from` up to `to`, only removes text or changes
  // nothing outside one number, literal or string.
  const removesOnlyOrInsideOneValue = (edit: Run, from: number, to: number) =>
    edit.added === 0 || words.some(word => word.start <= from && to <= word.end) || strings.some(string => string.open <= from && to <= string.close + 1)
  let validIndex = 0
  let brokenIndex = 0
  runs.forEach((run, index) => {
    if (run.isEdit && run.removed > 0 && run.added > 0) {
      const texts = `${valid.slice(validIndex, validIndex + run.removed).join('')}\u0000${broken.slice(brokenIndex, brokenIndex + run.added).join('')}`
      editsByTexts.set(texts, [...(editsByTexts.get(texts) ?? []), index])
    }
    if (run.isEdit && removesOnlyOrInsideOneValue(run, validIndex, validIndex + run.removed)) {
      if (index === 2 && runs[0]!.isEdit && runs[0]!.removed === 0) noChanceMatch.add(runs[1]!)
      if (index === runs.length - 3 && runs.at(-1)!.isEdit && runs.at(-1)!.removed === 0) noChanceMatch.add(runs.at(-2)!)
    }
    validIndex += run.isEdit ? run.removed : run.steps.length
    brokenIndex += run.isEdit ? run.added : run.steps.length
  })
  for (const indexes of editsByTexts.values()) {
    if (indexes.length < 2) continue
    for (const index of indexes) for (const beside of [runs[index - 1], runs[index + 1]]) if (beside !== undefined) noChanceMatch.add(beside)
  }
  for (let index = 1; index < runs.length - 1; index++) {
    const run = runs[index]!
    const before = runs[index - 1]!
    const after = runs[index + 1]!
    if (run.isEdit || run.steps.length > chanceMatchLength || noChanceMatch.has(run)) continue
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
  // The end of a text that is cut off, i.e. the script's last edit removes the valid text's end. The cut is taken to
  // be at the first edit of more than 3 code points after the last kept run that is longer than 3, or that is no
  // chance match by the list above. The kept runs after the cut are chance matches when the broken text adds
  // more code points from the cut on than these runs keep. E.g. `ed]` at the end of `["x... [truncated]` for
  // `["x-ray", "urgent", "retired"]}`, where the rule above keeps `ed` because only a quote is removed after it, and
  // the letters that `[Preview ends here]  Open the whole file` shares with the part that is missing, where the
  // edits between two such letters are as short as the letters. The `":` of `\"size\":"..., 24) = 24` stands before
  // the cut, since the edit before it adds one backslash. A short run of the document between a longer edit and
  // the cut is lost with the chance matches, e.g. the `, 2` of `[1, NaN, 2 ...` for `[1, null, 2, 3]`.
  const last = runs.at(-1)
  if (last !== undefined && last.isEdit && last.removed > 0) {
    const lastLongRun = runs.findLastIndex(run => !run.isEdit && (run.steps.length > chanceMatchLength || noChanceMatch.has(run)))
    // Without such a kept run, the first run is left out: a kept run at the very start of both texts.
    const cut = runs.findIndex((run, index) => index >= (lastLongRun !== -1 ? lastLongRun + 1 : 1) && run.isEdit && run.removed + run.added > chanceMatchLength)
    const end = cut === -1 ? [] : runs.slice(cut)
    const kept = end.reduce((total, run) => total + (run.isEdit ? 0 : run.steps.length), 0)
    const added = end.reduce((total, run) => total + run.added, 0)
    if (kept > 0 && kept < added) return [...runs.slice(0, cut).flatMap(run => run.steps), ...end.flatMap(run => run.isEdit ? run.steps : run.steps.flatMap((): Step[] => ['remove', 'add']))]
  }
  return runs.flatMap(run => run.steps)
}

// Rule 4: a pair with no kept code point and no other pair beside it in the broken text is no pair when the edit
// around it removes more than the pair's own counterpart, or when the pair is the broken text's first or last code
// point, e.g. the `]` of `"period":null⏎[output truncated]` for `"period":null}`. Its code point is added and its
// counterpart removed.
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
    step === 'pair' && !isAnchor(neighbor(index, -1)) && !isAnchor(neighbor(index, 1)) && (removesBeside(index) || neighbor(index, -1) === undefined || neighbor(index, 1) === undefined) ? ['remove', 'add'] : [step])
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
  // A pair that is alone is no pair before the chance matches are looked for, so that the script of a text that is
  // cut off ends with its removal, and again after it, when the kept code points beside a pair may be gone.
  const script = withoutLonePairs(scriptOf(brokenCodePoints, 0, brokenCodePoints.length, validCodePoints, 0, validCodePoints.length))
  const steps = withoutLonePairs(withoutChanceMatches(script, brokenCodePoints, validCodePoints))
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
  // when only code points are missing: nothing is added inside it, and no code point that can be a part of a word is
  // added right before it or right after it, see `joinsWord`.
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
      if (first > 0 && alignment[first - 1] === -1 && joinsWord(brokenCodePoints[first - 1]!)) onlyMissing = false
      if (last + 1 < alignment.length && alignment[last + 1] === -1 && joinsWord(brokenCodePoints[last + 1]!)) onlyMissing = false
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
