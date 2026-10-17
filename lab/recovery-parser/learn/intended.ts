// The intended states of a sample: for every code point of the broken text that the damage kept, the state today's
// parser is in after the code point's counterpart in the original, i.e. where the parser would be if the damage were
// not there. Training can use them as targets, and to put a run back on track after a code point it got wrong.
//
// Each document of a sample is parsed on its own, from the start state, so the first code point of a second document
// has the states of a text's first code point.
//
// Where the intended states are not defined, or cannot be what a parser of the broken text reaches:
// - A code point that the damage added has no counterpart: every array holds -1 there.
// - A replaced code point, e.g. ' for ", has the states of its counterpart, e.g. the event stringStart. The parser
//   reads the class of the code point that is there, here `other`, which the same tokenizer state also reads for
//   every letter without a class of its own. So one choice of that cell cannot be right for both. Sample.replaced
//   marks these code points, and Sample.needsClass the samples.
// - After a removed part, the intended states assume that the removed code points were read. Frozen cells then give
//   something else, and they go on doing so past the first kept code point, up to the next open cell. E.g. in
//   {"a": 1 "b": 2}, whose original has a comma after the 1, the intended grammar state after the space is `key`, and
//   the parser stays in `commaOrClose` there because the cell (commaOrClose, none) is frozen. A run that is put on
//   `key` reads the frozen cell (key, string) at the quote, and never the open cell (commaOrClose, string) that the
//   parser reads there and that a recovery has to change. The same holds after an added code point that frozen cells
//   read, e.g. the comma of a trailing comma. Sample.reachable says whether a parser that reads from left to right
//   can know what was removed. It does not say whether the cells can follow.
// - The first code point of a second document follows the last one of the first document. Before it, the parser of
//   the broken text is in the grammar state `end`, not in the start state, so the step that the intended states ask
//   for is one that today's tables do not have, e.g. (end, openObject, depth 0) to keyOrClose.
// - A kept code point whose display kind is not scored (Sample.unscoredKinds), e.g. a quote that lost its backslash:
//   its counterpart is part of an escape, so its intended event is `escape`, which no reading of the broken text gives.
//
// `canFollow` marks the kept code points whose intended state a parser of the broken text can be in, see canFollowOf.
// Use the intended states only there: as targets of training, and as states to put a run on.
//
// Before the first damage the broken text is the original, so there the intended states are the states of today's
// parser on the broken text. check-data.ts checks that, and that the intended depth and container are the labels'.
import type {Sample} from '../samples.ts'
import {containerObject, maximumDepth, runTableParser, tokenNames} from '../table-parser.ts'
import {actionNone, actionOfToken, actionPop, actionPushArray, actionPushObject, openMasks, today} from './recovery-tables.ts'

export type Intended = {
  // One entry per code point of the broken text, -1 where the damage added the code point.
  lexerStateAfter: Int8Array
  event: Int8Array
  grammarAfter: Int8Array
  // The same numbers as the label's depth and container, here from the parser's trace.
  depthAfter: Int8Array
  containerAfter: Int8Array
  // 1 where the intended state after the code point is one that a parser of the broken text can be in, see canFollowOf.
  canFollow: Uint8Array
}

// The trace of every document of a sample, one after another, indexed like the original: the states after each code
// point, and the stack after it as bits, where bit l - 1 is 1 when level l is an object.
function tracesOfDocuments(sample: Sample) {
  const lexerStateAfter: number[] = []
  const event: number[] = []
  const grammarAfter: number[] = []
  const depthAfter: number[] = []
  const containerAfter: number[] = []
  const stackAfter: number[] = []
  for (const document of sample.documents) {
    const trace = runTableParser(document)
    if (!trace.valid) throw new Error(`sample ${sample.id}: today's parser rejects the document ${JSON.stringify(document)}`)
    let depth = 0
    let stack = 0
    for (let position = 0; position < trace.length; position++) {
      // The tokenizer state after a code point is the state before the next position.
      lexerStateAfter.push(trace.lexerStateBefore[position + 1]!)
      event.push(trace.event[position]!)
      grammarAfter.push(trace.grammarAfter[position]!)
      depthAfter.push(trace.depthAfter[position]!)
      containerAfter.push(trace.containerAfter[position]!)
      const depthNow = trace.depthAfter[position]!
      if (depthNow > depth) {
        // An opening bracket: the new level's kind is the container after it.
        const bit = 1 << (depthNow - 1)
        stack = trace.containerAfter[position] === containerObject ? stack | bit : stack & ~bit
      } else if (depthNow < depth) {
        stack &= ~(1 << (depth - 1))
      }
      depth = depthNow
      stackAfter.push(stack)
    }
  }
  return {lexerStateAfter, event, grammarAfter, depthAfter, containerAfter, stackAfter}
}

const masks = openMasks(today.lexerStateCount, today.grammarStateCount)
const tokenNone = tokenNames.indexOf('none')

// For every code point of the broken text: 1 when the code point is kept and its intended state is one that a parser
// of the broken text can be in after it, for some choice of the open cells.
//
// The function walks the broken text and keeps the state that the parser is in for every choice of the open cells,
// as long as that state can be known:
// - It starts as the start state. While the two cells that a code point reads are frozen, the state after the code
//   point is what the frozen cells give, whatever the open cells hold. A kept code point can be followed there when
//   the frozen cells give its intended state, and not otherwise. E.g. the space after the 1 of {"a": 1 "b": 2}: the
//   frozen cells give `commaOrClose`, the intended state is `key`, so the space cannot be followed.
// - When a kept code point reads an open cell, a choice of that cell can give the intended state: the tokenizer's
//   cell its next state and event, and the grammar's cell its next state, when one stack action turns the stack before
//   into the intended one. Then the code point can be followed, and the walk goes on from the intended state. E.g.
//   the quote of the example reads the open cell (commaOrClose, string), which can lead to `colon`.
// - When the state is not known, e.g. after the characters of a comment, which read open cells and have no intended
//   state, the walk waits for the next kept code point that starts a token or is one, e.g. a quote, a digit, a
//   bracket or a comma. It takes that code point as one that can be followed, and goes on from its intended state.
//   Inside a token, e.g. at the letters of 'name' after its replaced quote, nothing says what the tokenizer is in.
// - A replaced code point and a code point whose display kind is not scored are never followed when they read an
//   open cell: the cell that would have to give their intended state is also read by other characters of the same
//   class. After them the state is not known.
//
// The first rule is exact: a kept code point that it leaves out can be followed by no choice of the open cells. The
// others are assumptions, so a code point that is marked can still be out of reach, e.g. the first token after a
// comment that held a bracket without a partner, and going on from the intended state after an open cell assumes
// that the cell holds the choice that gives it.
function canFollowOf(sample: Sample, traces: ReturnType<typeof tracesOfDocuments>): Uint8Array {
  const {classCount, tokenCount, contextCount} = today
  const lastClassEntry = today.classOfCodePoint.length - 1
  const unscored = new Set(sample.unscoredKinds)
  const codePoints = Array.from(sample.broken, character => character.codePointAt(0)!)
  const canFollow = new Uint8Array(codePoints.length)
  let known = true
  let lexerState = 0
  let grammarState = 0
  let depth = 0
  let stack = 0
  // The stack after one stack action, or -1 when the action leaves the depths 0 to 16.
  const stackAfterAction = (action: number) => {
    if (action === actionPushObject || action === actionPushArray) return depth >= maximumDepth ? -1 : action === actionPushObject ? stack | (1 << depth) : stack
    if (action === actionPop) return depth <= 0 ? -1 : stack & ~(1 << (depth - 1))
    return stack
  }
  const depthAfterAction = (action: number) => depth + (action === actionPushObject || action === actionPushArray ? 1 : action === actionPop ? -1 : 0)
  for (let position = 0; position < codePoints.length; position++) {
    const original = sample.alignment[position]!
    const kept = original !== -1
    const plain = kept && sample.replaced[position] !== true && !unscored.has(original)
    const goOnFromIntended = () => {
      lexerState = traces.lexerStateAfter[original]!
      grammarState = traces.grammarAfter[original]!
      depth = traces.depthAfter[original]!
      stack = traces.stackAfter[original]!
      known = true
    }
    if (!known) {
      if (plain && today.tokenOfEvent[traces.event[original]!] !== tokenNone) {
        canFollow[position] = 1
        goOnFromIntended()
      }
      continue
    }
    const characterClass = today.classOfCodePoint[Math.min(codePoints[position]! + 1, lastClassEntry)]!
    const lexerCell = lexerState * classCount + characterClass
    const lexerIsOpen = masks.lexerOpen[lexerCell] === 1
    if (lexerIsOpen && !plain) {
      known = false
      continue
    }
    // The event and the tokenizer state after: what the frozen cell gives, or the intended ones from an open cell.
    const event = lexerIsOpen ? traces.event[original]! : today.lexerEvent[lexerCell]!
    const lexerAfter = lexerIsOpen ? traces.lexerStateAfter[original]! : today.lexerNext[lexerCell]!
    const token = today.tokenOfEvent[event]!
    const context = today.depthClass[depth]! * 2 + (depth >= 1 && ((stack >> (depth - 1)) & 1) === 1 ? 1 : 0)
    const grammarCell = (grammarState * tokenCount + token) * contextCount + context
    const tokenizerFits = kept && event === traces.event[original] && lexerAfter === traces.lexerStateAfter[original]
    if (masks.grammarOpen[grammarCell] === 0) {
      const action = actionOfToken[token]!
      const stackNow = stackAfterAction(action)
      const grammarAfter = today.grammarNext[grammarCell]!
      const fits = tokenizerFits && grammarAfter === traces.grammarAfter[original] && depthAfterAction(action) === traces.depthAfter[original] && stackNow === traces.stackAfter[original]
      // Both cells are frozen, or the tokenizer's is open and can give the intended event: the state after is the
      // intended one exactly when the frozen grammar cell gives it.
      if (fits) canFollow[position] = 1
      if (lexerIsOpen && !fits) {
        // Another event of the open tokenizer cell reads another grammar cell.
        known = false
      } else if (stackNow === -1) {
        known = false
      } else {
        lexerState = lexerAfter
        grammarState = grammarAfter
        depth = depthAfterAction(action)
        stack = stackNow
      }
      continue
    }
    // An open grammar cell: one of its stack actions has to turn the stack before into the intended one.
    const oneActionFits = plain && tokenizerFits && [actionNone, actionPushObject, actionPushArray, actionPop].some(action =>
      depthAfterAction(action) === traces.depthAfter[original] && stackAfterAction(action) === traces.stackAfter[original])
    if (oneActionFits) {
      canFollow[position] = 1
      goOnFromIntended()
    } else {
      known = false
    }
  }
  return canFollow
}

export function intendedOf(sample: Sample): Intended {
  const traces = tracesOfDocuments(sample)
  if (sample.alignment.some(index => index >= traces.event.length)) throw new Error(`sample ${sample.id}: its alignment points past the ${traces.event.length} code points of its documents`)
  const along = (values: readonly number[]) => Int8Array.from(sample.alignment, index => index === -1 ? -1 : values[index]!)
  return {
    lexerStateAfter: along(traces.lexerStateAfter), event: along(traces.event), grammarAfter: along(traces.grammarAfter), depthAfter: along(traces.depthAfter), containerAfter: along(traces.containerAfter),
    canFollow: canFollowOf(sample, traces),
  }
}
