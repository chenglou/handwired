// The second twin: a mix of states per level of the stack.
//
// The twin holds one share per state per level of the stack, with the top of the stack at level 0: level k holds
// the mix of the state that is k below the top. It is the twin of the design's point 6 and the one closest to the
// JSON side's: a fixed set of numbers, 100 states × 520 levels and 521 depths, whatever the logits are. The
// reference twin of ../soft/stacks-twin.ts holds whole stacks, so it knows which states occur together. This twin
// does not: each level is a mix of its own.
//
// Within a token the twin holds two stacks: the part that has not taken the token yet, the live part, and the
// part that has taken or skipped it. One small step is one step of the exact parser for the whole live part:
// - The share of a state on the top level times the share of a choice in the state's cell is the weight of that
//   choice. In a cell that is not trainable the one choice that the cell holds has the share 1.
// - The live part after the step is a sum of shifted copies of the live part before it, each weighed by the
//   choices that shift so: a push moves every level one down, a pop one up, and a reduction of n states n - 1 up.
// - The new top level holds the pushed states, the level below the top for a pop, and for a reduction of n states
//   the state after the nonterminal from every state of level n, each with its share of level n. A share of level
//   n that has no such state, or no state at all, goes to the state `stopped`. Here the twin can pair a state on
//   top with a state below it that no stack of the exact parser holds together.
// - A choice that takes or skips the token moves its weight to the other stack, with the same shifted copies.
// A token ends after 16 small steps, as in the exact parser, or when no more than `leastLive` of it is live,
// 0.001 unless another value is asked for. What is live then is skipped with the stack as it is.
//
// What the twin shows for a token: the display kind is read off the top level of the stack that has taken the
// token, with each state's display entry. The container is the one of the topmost level that starts one. The
// depth is a mix of its own, a share per depth, which every choice moves by what it does to the depth.
//
// Three things are not in the design's prototype (twin-cost.ts in the scratch folder of the transfer track):
// - The twin holds as many levels as the exact parser's stack has states, 520 where the prototype had 64, so the
//   rule of the stack's limit is the exact parser's: the part of a push whose stack is full is a skip. Levels
//   that hold nothing cost nothing: a level whose shares add up to `leastShare` or less, 1e-9 unless another value
//   is asked for, is cut off with every level below it, and so are the ends of the mix of depths.
// - A reduction by an empty rule pushes the state after the nonterminal from the state on top itself, as an
//   insertion does. The prototype read it off the whole mix of the top level.
// - The variant `pusherBelow`, off unless asked for: the level under a pushed state holds the state that pushed
//   it, with the push's weight, where the design's form holds the whole mix of the old top level there. The
//   README says what each form trains to.
//
// With exact tables every share is exactly 0 or 1 and the twin is the exact parser: ../soft/check-twin.ts. The
// gradient is exact for the numbers above, and the loss is smooth when `leastLive` and `leastShare` are 0:
// check-gradient.ts. With the settings that train, the loss has small jumps where a token's live part crosses
// `leastLive`.
import {containerCount} from '../../labels.ts'
import {itemDot, itemRule} from '../../tables.ts'
import {type PackedSamples, packedComment, refuseOtherTerminals} from '../data.ts'
import {
  bison, bisonTerminalCount, choicesOf, displayKind, displayKindCount, endOfInput, isTextTerminal, kindAccept, kindEndEarly, kindInsert, kindPop, kindReadAs, kindReduce, kindShift, kindSkip, kindStop,
  maximumStackHeight, maximumStepsPerToken, stateContainer, stateCount, stateOpensDepth, stateSymbol, stopped,
} from '../recovery-tables.ts'
import {type Layout, addLogitGradients, sharesInto} from '../soft/model.ts'
import {type LossTally, type Reading, type Twin, type TwinOptions, lossFloor, readingDepthCount} from '../soft/twin.ts'

export const defaultLeastLive = 1e-3
export const defaultLeastShare = 1e-9

// One level per state that the exact parser's stack can hold, and the depths 0 to 520.
const levelCount = maximumStackHeight
const maximumDepth = maximumStackHeight
const {nonterminalCount, ruleLength, ruleLhs, gotoState, transition, symbolCount} = bison

// What a choice does, as the twin sees it. A reduction that drops no state is a push that keeps the token.
const pushKeeping = 0, pushTaking = 1, skipping = 2, popping = 3, reducing = 4, accepting = 5

// [state × nonterminalCount + nonterminal]: the state after the nonterminal, or `stopped` where there is none.
const stateAfter = new Uint8Array(stateCount * nonterminalCount).fill(stopped)
for (let state = 0; state < bison.stateCount; state++) {
  for (let nonterminal = 0; nonterminal < nonterminalCount; nonterminal++) {
    const target = gotoState[state * nonterminalCount + nonterminal]!
    if (target === -1) continue
    if (stateOpensDepth[target] !== 0) throw new Error(`state ${target} is entered by a nonterminal and opens a depth: the twin moves the depth of a reduction by the dropped symbols only`)
    stateAfter[state * nonterminalCount + nonterminal] = target
  }
}
// The states that start a container, e.g. the state after `(`.
const containerStates = Uint8Array.from(Array.from({length: stateCount}, (_, state) => state).filter(state => stateContainer[state] !== 0))
// 1 for a symbol whose states open a depth. The depth of a stack is a sum over its symbols, so a choice that drops
// states lowers the depth by the dropped symbols that open one.
const symbolOpensDepth = new Uint8Array(symbolCount)
for (let state = 0; state < stateCount; state++) if (stateOpensDepth[state] === 1) symbolOpensDepth[stateSymbol[state]!] = 1
for (let state = 0; state < stateCount; state++) {
  if ((stateSymbol[state] === -1 ? 0 : symbolOpensDepth[stateSymbol[state]!]) !== stateOpensDepth[state]) throw new Error(`whether state ${state} opens a depth does not follow from its symbol`)
}
const openersAmong = (symbols: readonly number[]): number => symbols.reduce((count, symbol) => count + symbolOpensDepth[symbol]!, 0)
const longestRule = Math.max(...ruleLength)
const mostOpenersDropped = Math.max(...bison.ruleRhs.map(openersAmong))
// A change of the depth has the slot 1 - change: +1, 0, -1, and so on.
const changeSlots = mostOpenersDropped + 2
const unchangedSlot = 1

// How many of the states that a reduction or an item ended early drops open a depth. The states that a choice
// drops in a state are those of the symbols before the dot of an item of the state, so the count is one number.
function openersDropped(state: number, choice: number): number {
  const kind = choice >> 8, argument = choice & 255
  if (kind === kindReduce) return openersAmong(bison.ruleRhs[argument]!)
  const dropped = argument >> 4, nonterminal = bisonTerminalCount + (argument & 15)
  let openers = -1
  for (const item of bison.stateKernel[state]!) {
    const rule = itemRule(item), dot = itemDot(item)
    if (dot !== dropped || ruleLhs[rule] !== nonterminal) continue
    const count = openersAmong(bison.ruleRhs[rule]!.slice(0, dot))
    if (openers !== -1 && openers !== count) throw new Error(`state ${state}: two items that end early alike drop another number of symbols that open a depth`)
    openers = count
  }
  if (openers === -1) throw new Error(`state ${state} has no item to end early after ${dropped} symbols`)
  return openers
}

// A copy of a typed array with twice the room.
function grown<Typed extends Int32Array | Float64Array>(array: Typed): Typed {
  const larger = new (array.constructor as new (length: number) => Typed)(array.length * 2)
  larger.set(array)
  return larger
}
// target[targetFrom + i] += weight × source[sourceFrom + i], for `count` entries.
function addRange(target: Float64Array, targetFrom: number, source: Float64Array, sourceFrom: number, count: number, weight: number) {
  for (let index = 0; index < count; index++) target[targetFrom + index]! += weight * source[sourceFrom + index]!
}
function dotOfRanges(left: Float64Array, leftFrom: number, right: Float64Array, rightFrom: number, count: number): number {
  let sum = 0
  for (let index = 0; index < count; index++) sum += left[leftFrom + index]! * right[rightFrom + index]!
  return sum
}
function sumOfRange(values: Float64Array, from: number, count: number): number {
  let sum = 0
  for (let index = 0; index < count; index++) sum += values[from + index]!
  return sum
}

export function createTwin(layout: Layout, options: TwinOptions = {}): Twin {
  const leastLive = options['leastLive'] ?? defaultLeastLive
  const leastShare = options['leastShare'] ?? defaultLeastShare
  const pusherBelow = (options['pusherBelow'] ?? 0) !== 0
  if (!(leastLive >= 0 && leastLive < 1) || !(leastShare >= 0 && leastShare < 1)) throw new Error(`the twin of levels takes leastLive and leastShare from 0 to under 1, and got ${leastLive} and ${leastShare}`)
  // A live part under 1e-290 counts as none: the step divides by it.
  const liveFloor = Math.max(leastLive, 1e-290)
  const {base, cellOffset, displayOffset} = layout
  const {terminalCount, cellsPerCopy, display} = base
  const flagged = base.firstOnLineFlag

  // The choices of every cell that a token can read, as entries: a trainable cell has one entry per logit, at the
  // logit's place, and every other cell has one entry after the logits, for the choice that it holds, with the
  // share 1. So `shares` holds the mixes of the layout and then a 1 per cell that is not trainable.
  let fixedCells = 0
  for (let cell = 0; cell < base.choice.length; cell++) if (cellOffset[cell] === -1) fixedCells++
  const entryTotal = layout.logitCount + fixedCells
  const entryStart = new Int32Array(base.choice.length), entryCount = new Int32Array(base.choice.length)
  const entryType = new Uint8Array(entryTotal).fill(accepting)
  // Per entry: the pushed state, the number of dropped states and the nonterminal of a reduction, and the slot of
  // the choice's change of the depth.
  const entryPushed = new Uint8Array(entryTotal), entryDropped = new Uint8Array(entryTotal), entryNonterminal = new Uint8Array(entryTotal), entryChange = new Uint8Array(entryTotal)
  const shares = new Float64Array(entryTotal)
  const shareGradients = new Float64Array(entryTotal)
  function setEntry(entry: number, choice: number, state: number) {
    const kind = choice >> 8, argument = choice & 255
    const push = (type: number, pushed: number) => {
      if (pushed < 0) throw new Error(`the choice ${choice} pushes no state in state ${state}`)
      entryType[entry] = type
      entryPushed[entry] = pushed
      entryChange[entry] = unchangedSlot - stateOpensDepth[pushed]!
    }
    if (kind === kindReduce || kind === kindEndEarly) {
      const dropped = kind === kindReduce ? ruleLength[argument]! : argument >> 4
      const nonterminal = (kind === kindReduce ? ruleLhs[argument]! : bisonTerminalCount + (argument & 15)) - bisonTerminalCount
      if (dropped === 0) {
        push(pushKeeping, gotoState[state * nonterminalCount + nonterminal]!)
        return
      }
      entryType[entry] = reducing
      entryDropped[entry] = dropped
      entryNonterminal[entry] = nonterminal
      entryChange[entry] = unchangedSlot + openersDropped(state, choice)
    } else if (kind === kindPop) {
      entryType[entry] = popping
      entryChange[entry] = unchangedSlot + stateOpensDepth[state]!
    } else if (kind === kindSkip) {
      entryType[entry] = skipping
      entryChange[entry] = unchangedSlot
    } else if (kind === kindShift) push(pushTaking, argument)
    else if (kind === kindReadAs) push(pushTaking, transition[state * symbolCount + argument]!)
    else if (kind === kindStop) push(pushKeeping, stopped)
    else if (kind === kindInsert) push(pushKeeping, transition[state * symbolCount + argument]!)
    else if (kind !== kindAccept) throw new Error(`a cell holds ${choice}, which is no choice`)
  }
  {
    let nextFixed = layout.logitCount
    for (let cell = 0; cell < base.choice.length; cell++) {
      const state = Math.floor((cell % cellsPerCopy) / terminalCount), terminal = cell % terminalCount
      // The end of input takes no step in a twin, and no text holds the other terminals that are left out.
      if (!isTextTerminal(terminal) || terminal === endOfInput) continue
      if (cellOffset[cell] !== -1) {
        const list = choicesOf(base, cell)
        entryStart[cell] = cellOffset[cell]!
        entryCount[cell] = list.length
        list.forEach((choice, place) => setEntry(cellOffset[cell]! + place, choice, state))
      } else {
        entryStart[cell] = nextFixed
        entryCount[cell] = 1
        setEntry(nextFixed, base.choice[cell]!, state)
        shares[nextFixed] = 1
        nextFixed++
      }
    }
  }

  // The stacks of a sample, one frame per stack: the stack before a token, the live part after each small step of
  // the token, and the stack after the token, which is the stack before the next one. A frame holds its mix of
  // depths, from `frameDepthLow` to `frameDepthHigh`, and then its levels, `frameUsed` of them with one share per
  // state each. `frameMass` is the sum of the top level: the share of the token that the frame holds. The backward
  // pass reads the frames again, so a run with a gradient keeps every frame of a sample, and a run without one
  // keeps the last stack only.
  let tape = new Float64Array(1 << 18)
  let tapeTop = 0
  function reserve(count: number) {
    if (tapeTop + count <= tape.length) return
    let length = tape.length * 2
    while (tapeTop + count > length) length *= 2
    const larger = new Float64Array(length)
    larger.set(tape.subarray(0, tapeTop))
    tape = larger
  }
  let frameOffset = new Int32Array(256), frameUsed = new Int32Array(256), frameDepthOffset = new Int32Array(256), frameDepthLow = new Int32Array(256), frameDepthHigh = new Int32Array(256), frameMass = new Float64Array(256)
  let frameCount = 0
  function newFrame(offset: number, used: number, depthOffset: number, depthLow: number, depthHigh: number): number {
    if (frameCount === frameOffset.length) {
      frameOffset = grown(frameOffset)
      frameUsed = grown(frameUsed)
      frameDepthOffset = grown(frameDepthOffset)
      frameDepthLow = grown(frameDepthLow)
      frameDepthHigh = grown(frameDepthHigh)
      frameMass = grown(frameMass)
    }
    const frame = frameCount++
    frameOffset[frame] = offset
    frameUsed[frame] = used
    frameDepthOffset[frame] = depthOffset
    frameDepthLow[frame] = depthLow
    frameDepthHigh[frame] = depthHigh
    frameMass[frame] = sumOfRange(tape, offset, stateCount)
    return frame
  }

  // The stack that has taken or skipped the token at hand, while the token's steps add to it: `doneReach` levels
  // and the depths from `doneDepthLow` to `doneDepthHigh` can hold a share.
  const done = new Float64Array(levelCount * stateCount)
  const doneDepth = new Float64Array(readingDepthCount)
  let doneReach = 0, doneDepthLow = readingDepthCount, doneDepthHigh = -1
  // Moves `done` into a new frame and empties it. Levels and depths at the ends that hold `leastShare` or less are
  // cut off.
  function frameOfDone(): number {
    let used = Math.max(1, doneReach)
    while (used > 1 && sumOfRange(done, (used - 1) * stateCount, stateCount) <= leastShare) used--
    let low = doneDepthLow, high = doneDepthHigh
    while (low < high && doneDepth[low]! <= leastShare) low++
    while (high > low && doneDepth[high]! <= leastShare) high--
    if (low > high) low = high = 0
    reserve(high - low + 1 + used * stateCount)
    const depthOffset = tapeTop
    for (let depth = low; depth <= high; depth++) tape[tapeTop++] = doneDepth[depth]!
    const offset = tapeTop
    tape.set(done.subarray(0, used * stateCount), offset)
    tapeTop += used * stateCount
    done.fill(0, 0, doneReach * stateCount)
    if (doneDepthHigh >= doneDepthLow) doneDepth.fill(0, doneDepthLow, doneDepthHigh + 1)
    doneReach = 0
    doneDepthLow = readingDepthCount
    doneDepthHigh = -1
    return newFrame(offset, used, depthOffset, low, high)
  }

  // The weights of one small step, by what the choices do: filled by weighTop from the top level of a frame.
  const pushKeep = new Float64Array(stateCount), pushTake = new Float64Array(stateCount), stay = new Float64Array(stateCount)
  // With `pusherBelow`: the weights of the pushes by the state that pushes.
  const pushKeepFrom = new Float64Array(stateCount), pushTakeFrom = new Float64Array(stateCount)
  // [(dropped states - 1) × nonterminalCount + nonterminal]
  const reduceWeight = new Float64Array(longestRule * nonterminalCount)
  // [slot of a change of the depth]: the weight of the choices that keep the token, and of the ones that take or skip it.
  const keepChange = new Float64Array(changeSlots), takeChange = new Float64Array(changeSlots)
  // [1 + levels that the stack moves up]: the weight of the choices that keep the token, from a push at 0 on.
  const moveWeight = new Float64Array(longestRule + 1)
  let pushKeepAll = 0, pushTakeAll = 0, stayAll = 0, popAll = 0, reduceAll = 0
  // The share of the live part whose stack is full, 520 states high: its pushes are skips.
  let fullShare = 0
  function weighTop(from: number, used: number, mass: number, terminal: number, flagOffset: number) {
    pushKeep.fill(0)
    pushTake.fill(0)
    stay.fill(0)
    reduceWeight.fill(0)
    keepChange.fill(0)
    takeChange.fill(0)
    moveWeight.fill(0)
    if (pusherBelow) {
      pushKeepFrom.fill(0)
      pushTakeFrom.fill(0)
    }
    pushKeepAll = pushTakeAll = stayAll = popAll = reduceAll = 0
    fullShare = used === levelCount ? Math.min(1, sumOfRange(tape, from + (levelCount - 1) * stateCount, stateCount) / mass) : 0
    for (let state = 0; state < stateCount; state++) {
      const top = tape[from + state]!
      if (top === 0) continue
      const cell = flagOffset + state * terminalCount + terminal
      const first = entryStart[cell]!, end = first + entryCount[cell]!
      if (first === end) throw new Error(`a twin reads the cell ${cell}, which no token can read`)
      for (let entry = first; entry < end; entry++) {
        let weight = top * shares[entry]!
        if (weight === 0) continue
        const type = entryType[entry]!
        if (type <= pushTaking) {
          if (fullShare !== 0) {
            // The part whose stack is full skips the token.
            const skipped = weight * fullShare
            stay[state]! += skipped
            stayAll += skipped
            takeChange[unchangedSlot]! += skipped
            weight -= skipped
          }
          if (type === pushKeeping) {
            pushKeep[entryPushed[entry]!]! += weight
            pushKeepAll += weight
            keepChange[entryChange[entry]!]! += weight
            if (pusherBelow) pushKeepFrom[state]! += weight
          } else {
            pushTake[entryPushed[entry]!]! += weight
            pushTakeAll += weight
            takeChange[entryChange[entry]!]! += weight
            if (pusherBelow) pushTakeFrom[state]! += weight
          }
        } else if (type === skipping) {
          stay[state]! += weight
          stayAll += weight
          takeChange[unchangedSlot]! += weight
        } else if (type === popping) {
          popAll += weight
          moveWeight[2]! += weight
          keepChange[entryChange[entry]!]! += weight
        } else if (type === reducing) {
          const dropped = entryDropped[entry]!
          reduceWeight[(dropped - 1) * nonterminalCount + entryNonterminal[entry]!]! += weight
          reduceAll += weight
          moveWeight[dropped]! += weight
          keepChange[entryChange[entry]!]! += weight
        } else throw new Error('a stack of the twin reads the accept: the twin takes no step at the end of input')
      }
    }
    moveWeight[0] = pushKeepAll
  }

  // What the twin counts about its work: the tokens that took steps, their small steps, the levels that the
  // small steps held, the tokens that still had a live part after 16 small steps and that part's share, and what
  // the reductions and the pops did with levels that are mixes: the weight of the reductions that drop a state,
  // the part of it that found no state after the nonterminal and went to `stopped`, the weight of the pops, and
  // the part of it that found no state below. And the small steps in which a share of the live part has a full
  // stack, with those shares added up.
  const counters = {tokens: 0, smallSteps: 0, levels: 0, tokensAtStepLimit: 0, shareAtStepLimit: 0, shareReduced: 0, shareReducedToStopped: 0, sharePopped: 0, sharePoppedToStopped: 0, stepsWithFullStack: 0, shareWithFullStack: 0}

  // One small step of the frame's live part: the live part after the step is a new frame, and the part that takes
  // or skips the token is added to `done`.
  function stepForward(frame: number, terminal: number, flagOffset: number): number {
    const used = frameUsed[frame]!, mass = frameMass[frame]!
    const reach = Math.min(levelCount, used + 1)
    const depthLow = frameDepthLow[frame]!, depthHigh = frameDepthHigh[frame]!
    const nextLow = Math.max(0, depthLow - mostOpenersDropped), nextHigh = Math.min(maximumDepth, depthHigh + 1)
    reserve(nextHigh - nextLow + 1 + reach * stateCount)
    const values = tape
    const from = frameOffset[frame]!, depthFrom = frameDepthOffset[frame]!
    const depthTo = tapeTop, to = depthTo + nextHigh - nextLow + 1
    values.fill(0, depthTo, to + reach * stateCount)
    weighTop(from, used, mass, terminal, flagOffset)
    const inverse = 1 / mass
    counters.smallSteps++
    counters.levels += used
    if (fullShare !== 0) {
      counters.stepsWithFullStack++
      counters.shareWithFullStack += fullShare
    }

    // The top level: the pushed states, the level below the top for a pop, and the states after the nonterminals
    // of the reductions. The part of a pop or of a reduction whose stack has no state at the level that it reads is
    // what is left of the mass, and goes to `stopped`. Rounding can make a level's sum larger than the mass by
    // 1e-16, and what is left is then 0 and not negative: a negative share would double with every reduction that
    // follows, as any small share that is on the wrong level does in this twin, and has nothing to stop it at 0.
    for (let state = 0; state < stateCount; state++) values[to + state] = pushKeep[state]!
    if (popAll !== 0) {
      const scaled = popAll * inverse
      let below = 0
      if (used > 1) {
        for (let state = 0; state < stateCount; state++) {
          const share = values[from + stateCount + state]!
          values[to + state]! += scaled * share
          below += share
        }
      }
      const withoutBelow = Math.max(0, mass - below)
      values[to + stopped]! += scaled * withoutBelow
      counters.sharePopped += popAll
      counters.sharePoppedToStopped += scaled * withoutBelow
    }
    if (reduceAll !== 0) {
      for (let slot = 0; slot < reduceWeight.length; slot++) {
        const weight = reduceWeight[slot]!
        if (weight === 0) continue
        const dropped = Math.floor(slot / nonterminalCount) + 1, nonterminal = slot % nonterminalCount
        const scaled = weight * inverse
        let found = 0, withoutState = 0
        if (dropped < used) {
          const under = from + dropped * stateCount
          for (let state = 0; state < stateCount; state++) {
            const share = values[under + state]!
            if (share === 0) continue
            const target = stateAfter[state * nonterminalCount + nonterminal]!
            values[to + target]! += scaled * share
            found += share
            if (target === stopped) withoutState += share
          }
        }
        const withoutLevel = Math.max(0, mass - found)
        values[to + stopped]! += scaled * withoutLevel
        counters.shareReducedToStopped += scaled * (withoutLevel + withoutState)
      }
      counters.shareReduced += reduceAll
    }
    // The levels below the top: shifted copies of the live part.
    for (let move = -1; move < longestRule; move++) {
      const weight = moveWeight[move + 1]!
      if (weight === 0) continue
      const firstLevel = Math.max(pusherBelow && move === -1 ? 2 : 1, -move), endLevel = Math.min(reach, used - move)
      if (endLevel > firstLevel) addRange(values, to + firstLevel * stateCount, values, from + (firstLevel + move) * stateCount, (endLevel - firstLevel) * stateCount, weight * inverse)
    }
    if (pusherBelow) for (let state = 0; state < stateCount; state++) values[to + stateCount + state]! += pushKeepFrom[state]!

    // The part that takes or skips the token.
    for (let state = 0; state < stateCount; state++) done[state]! += pushTake[state]! + stay[state]!
    if (pushTakeAll !== 0) {
      const firstLevel = pusherBelow ? 2 : 1
      if (reach > firstLevel) addRange(done, firstLevel * stateCount, values, from + (firstLevel - 1) * stateCount, (reach - firstLevel) * stateCount, pushTakeAll * inverse)
      if (pusherBelow) for (let state = 0; state < stateCount; state++) done[stateCount + state]! += pushTakeFrom[state]!
    }
    if (stayAll !== 0 && used > 1) addRange(done, stateCount, values, from + stateCount, (used - 1) * stateCount, stayAll * inverse)
    if (reach > doneReach) doneReach = reach

    // The depth: sums of shifted copies too.
    for (let slot = 0; slot < changeSlots; slot++) {
      const change = unchangedSlot - slot
      const keeps = keepChange[slot]! * inverse, takes = takeChange[slot]! * inverse
      if (keeps !== 0) {
        for (let depth = depthLow; depth <= depthHigh; depth++) values[depthTo + Math.min(maximumDepth, Math.max(0, depth + change)) - nextLow]! += keeps * values[depthFrom + depth - depthLow]!
      }
      if (takes !== 0) {
        for (let depth = depthLow; depth <= depthHigh; depth++) doneDepth[Math.min(maximumDepth, Math.max(0, depth + change))]! += takes * values[depthFrom + depth - depthLow]!
        doneDepthLow = Math.min(doneDepthLow, Math.max(0, depthLow + change))
        doneDepthHigh = Math.max(doneDepthHigh, Math.min(maximumDepth, depthHigh + change))
      }
    }

    // Levels and depths at the ends that hold `leastShare` or less are cut off.
    let usedNext = reach
    while (usedNext > 1 && sumOfRange(values, to + (usedNext - 1) * stateCount, stateCount) <= leastShare) usedNext--
    let low = nextLow, high = nextHigh
    while (low < high && values[depthTo + low - nextLow]! <= leastShare) low++
    while (high > low && values[depthTo + high - nextLow]! <= leastShare) high--
    tapeTop = to + usedNext * stateCount
    return newFrame(to, usedNext, depthTo + low - nextLow, low, high)
  }

  // The steps of one token from the stack in the last frame. Afterwards the last frame is the stack that has
  // taken or skipped the token. Returns the number of small steps.
  function stepToken(terminal: number, flagOffset: number): number {
    let frame = frameCount - 1
    let steps = 0
    for (;;) {
      const mass = frameMass[frame]!
      if (steps === maximumStepsPerToken || !(mass > liveFloor)) {
        // What is live now is skipped, with the stack as it is.
        if (mass > liveFloor) {
          counters.tokensAtStepLimit++
          counters.shareAtStepLimit += mass
        }
        const used = frameUsed[frame]!
        addRange(done, 0, tape, frameOffset[frame]!, used * stateCount, 1)
        if (used > doneReach) doneReach = used
        const depthLow = frameDepthLow[frame]!, depthHigh = frameDepthHigh[frame]!
        for (let depth = depthLow; depth <= depthHigh; depth++) doneDepth[depth]! += tape[frameDepthOffset[frame]! + depth - depthLow]!
        doneDepthLow = Math.min(doneDepthLow, depthLow)
        doneDepthHigh = Math.max(doneDepthHigh, depthHigh)
        break
      }
      frame = stepForward(frame, terminal, flagOffset)
      steps++
    }
    frameOfDone()
    counters.tokens++
    return steps
  }

  // What the stack of a frame shows: a share per display kind for a token of `terminal` that the stack has taken
  // or skipped, and a share per container.
  const kindShares = new Float64Array(displayKindCount), containerShares = new Float64Array(containerCount)
  function showFrame(frame: number, terminal: number) {
    const from = frameOffset[frame]!, used = frameUsed[frame]!
    kindShares.fill(0)
    if (terminal >= 0) {
      for (let state = 0; state < stateCount; state++) {
        const share = tape[from + state]!
        if (share === 0) continue
        const entry = state * terminalCount + terminal
        const offset = displayOffset[entry]!
        if (offset === -1) kindShares[display[entry]!]! += share
        else for (let kind = 0; kind < displayKindCount; kind++) kindShares[kind]! += share * shares[offset + kind]!
      }
    }
    // The container: the one of the topmost level that starts one. `none` is the share of the stacks that have
    // none down to the level at hand.
    containerShares.fill(0)
    let none = 1
    for (let level = 0; level < used && none !== 0; level++) {
      let here = 0
      for (let index = 0; index < containerStates.length; index++) {
        const state = containerStates[index]!
        const share = tape[from + level * stateCount + state]!
        if (share === 0) continue
        containerShares[stateContainer[state]!]! += none * share
        here += share
      }
      none *= 1 - here
    }
    containerShares[0] = none
  }

  // The stacks that show tokens, in order: the stack at the first open cell, and the stack after every token that
  // took steps. Per such stack, for the backward pass: its frame, its token as a place in the packed tokens (-1 for
  // the first stack), the token's small steps, and the gradients of the loss by what the stack shows.
  let shownFrame = new Int32Array(256), shownToken = new Int32Array(256), shownSteps = new Int32Array(256), shownDepthStart = new Int32Array(257)
  let shownKindGradient = new Float64Array(256 * displayKindCount), shownContainerGradient = new Float64Array(256 * containerCount)
  let shownCount = 0
  let depthOfGradient = new Int32Array(1024), depthGradient = new Float64Array(1024)
  let depthGradientCount = 0
  function newShown(frame: number, token: number, steps: number): number {
    if (shownCount === shownFrame.length) {
      shownFrame = grown(shownFrame)
      shownToken = grown(shownToken)
      shownSteps = grown(shownSteps)
      shownDepthStart = grown(shownDepthStart)
      shownKindGradient = grown(shownKindGradient)
      shownContainerGradient = grown(shownContainerGradient)
    }
    const shown = shownCount++
    shownFrame[shown] = frame
    shownToken[shown] = token
    shownSteps[shown] = steps
    shownDepthStart[shown] = depthGradientCount
    shownKindGradient.fill(0, shown * displayKindCount, (shown + 1) * displayKindCount)
    shownContainerGradient.fill(0, shown * containerCount, (shown + 1) * containerCount)
    return shown
  }

  // The loss of the packed token `at`, which the stack `shown` shows with kindShares and containerShares.
  // `triviaKind` is the kind of white space or of a comment, which is shown as what it is, or -1.
  function lossOfToken(samples: PackedSamples, at: number, shown: number, triviaKind: number, tally: LossTally, withGradient: boolean, reading: Reading | null, row: number) {
    const {groupStart, groupKind, groupDepth, groupContainer, groupCount} = samples
    const frame = shownFrame[shown]!
    const depthOffset = frameDepthOffset[frame]!, depthLow = frameDepthLow[frame]!, depthHigh = frameDepthHigh[frame]!
    for (let group = groupStart[at]!; group < groupStart[at + 1]!; group++) {
      const count = groupCount[group]!, labelKind = groupKind[group]!, labelDepth = groupDepth[group]!, labelContainer = groupContainer[group]!
      const kindShare = triviaKind === -1 ? kindShares[labelKind]! : triviaKind === labelKind ? 1 : 0
      const depthHeld = labelDepth >= depthLow && labelDepth <= depthHigh
      const depthShare = depthHeld ? tape[depthOffset + labelDepth - depthLow]! : 0
      const containerShare = containerShares[labelContainer]!
      const kindLoss = -count * Math.log(kindShare + lossFloor), depthLoss = -count * Math.log(depthShare + lossFloor), containerLoss = -count * Math.log(containerShare + lossFloor)
      tally.kindLoss += kindLoss
      tally.depthLoss += depthLoss
      tally.containerLoss += containerLoss
      tally.loss += kindLoss + depthLoss + containerLoss
      tally.labelsWithoutShare += count * ((kindShare === 0 ? 1 : 0) + (depthShare === 0 ? 1 : 0) + (containerShare === 0 ? 1 : 0))
      if (!withGradient) continue
      if (triviaKind === -1) shownKindGradient[shown * displayKindCount + labelKind]! -= count / (kindShare + lossFloor)
      shownContainerGradient[shown * containerCount + labelContainer]! -= count / (containerShare + lossFloor)
      if (depthHeld) {
        if (depthGradientCount === depthGradient.length) {
          depthOfGradient = grown(depthOfGradient)
          depthGradient = grown(depthGradient)
        }
        depthOfGradient[depthGradientCount] = labelDepth
        depthGradient[depthGradientCount++] = -count / (depthShare + lossFloor)
      }
    }
    if (reading === null) return
    for (let depth = depthLow; depth <= depthHigh; depth++) reading.depth[row * readingDepthCount + depth] = tape[depthOffset + depth - depthLow]!
    reading.container.set(containerShares, row * containerCount)
    if (triviaKind === -1) reading.kind.set(kindShares, row * displayKindCount)
    else reading.kind[row * displayKindCount + triviaKind] = 1
  }

  // The gradients of the backward pass by the shares of three stacks: the stack that has taken the token at hand
  // (`gradientDone`), and the live part after and before the small step at hand. And the same for their depths,
  // which hold 0 outside the depths of their frame.
  let gradientDone = new Float64Array(levelCount * stateCount), gradientNext = new Float64Array(levelCount * stateCount), gradientBefore = new Float64Array(levelCount * stateCount)
  let depthGradientDone = new Float64Array(readingDepthCount), depthGradientNext = new Float64Array(readingDepthCount), depthGradientBefore = new Float64Array(readingDepthCount)

  // Adds the gradient of the container's loss of the stack `shown` by the shares of its frame to gradientDone.
  // With none(k) the share that has no container above level k, and here(k) the share of level k's states that
  // start one, a share of such a state s at level k adds none(k) to its container's share and takes none(k) times
  // what the levels below would have shown.
  const noneAbove = new Float64Array(levelCount), hereAt = new Float64Array(levelCount), wantedAt = new Float64Array(levelCount)
  function containerBackward(shown: number) {
    const frame = shownFrame[shown]!
    const from = frameOffset[frame]!, used = frameUsed[frame]!
    const gradients = shownContainerGradient, first = shown * containerCount
    let none = 1
    for (let level = 0; level < used; level++) {
      let here = 0, wanted = 0
      for (let index = 0; index < containerStates.length; index++) {
        const state = containerStates[index]!
        const share = tape[from + level * stateCount + state]!
        here += share
        wanted += share * gradients[first + stateContainer[state]!]!
      }
      noneAbove[level] = none
      hereAt[level] = here
      wantedAt[level] = wanted
      none *= 1 - here
    }
    // The gradient by "no container down to this level", from the lowest level up.
    let below = gradients[first]!
    for (let level = used - 1; level >= 0; level--) {
      const scale = noneAbove[level]!
      if (scale !== 0) {
        for (let index = 0; index < containerStates.length; index++) {
          const state = containerStates[index]!
          gradientDone[level * stateCount + state]! += scale * (gradients[first + stateContainer[state]!]! - below)
        }
      }
      below = wantedAt[level]! + (1 - hereAt[level]!) * below
    }
  }
  // The same for the display kind of the stack's own token: by the shares of the top level, and by the shares of
  // the trainable display entries.
  function kindBackward(shown: number, terminal: number) {
    const from = frameOffset[shownFrame[shown]!]!
    const first = shown * displayKindCount
    for (let state = 0; state < stateCount; state++) {
      const share = tape[from + state]!
      if (share === 0) continue
      const entry = state * terminalCount + terminal
      const offset = displayOffset[entry]!
      if (offset === -1) {
        gradientDone[state]! += shownKindGradient[first + display[entry]!]!
        continue
      }
      let sum = 0
      for (let kind = 0; kind < displayKindCount; kind++) {
        const gradient = shownKindGradient[first + kind]!
        sum += gradient * shares[offset + kind]!
        shareGradients[offset + kind]! += share * gradient
      }
      gradientDone[state]! += sum
    }
  }

  // The small step from `frame` to the frame after it, backwards: from the gradients by the live part after the
  // step (gradientNext) and by the stack that has taken the token (gradientDone, of `usedDone` levels) to the
  // gradient by the live part before the step (gradientBefore) and by the shares of the cells.
  const moveDot = new Float64Array(longestRule + 1), reduceDot = new Float64Array(longestRule * nonterminalCount), keepChangeDot = new Float64Array(changeSlots), takeChangeDot = new Float64Array(changeSlots)
  function stepBackward(frame: number, terminal: number, flagOffset: number, usedDone: number) {
    const used = frameUsed[frame]!, mass = frameMass[frame]!, from = frameOffset[frame]!
    const usedNext = frameUsed[frame + 1]!
    const reachDone = Math.min(levelCount, used + 1, usedDone)
    const depthLow = frameDepthLow[frame]!, depthHigh = frameDepthHigh[frame]!, depthFrom = frameDepthOffset[frame]!
    const values = tape
    weighTop(from, used, mass, terminal, flagOffset)
    const inverse = 1 / mass
    const toStopped = gradientNext[stopped]!

    // What a unit of each weight is worth, before the division by the frame's mass: the sums over the shifted
    // copies that the weight scales.
    for (let move = -1; move < longestRule; move++) {
      moveDot[move + 1] = 0
      if (moveWeight[move + 1] === 0) continue
      const firstLevel = Math.max(pusherBelow && move === -1 ? 2 : 1, -move), endLevel = Math.min(usedNext, used - move)
      if (endLevel > firstLevel) moveDot[move + 1] = dotOfRanges(gradientNext, firstLevel * stateCount, values, from + (firstLevel + move) * stateCount, (endLevel - firstLevel) * stateCount)
    }
    const takeFirstLevel = pusherBelow ? 2 : 1
    const pushTakeDot = pushTakeAll !== 0 && reachDone > takeFirstLevel ? dotOfRanges(gradientDone, takeFirstLevel * stateCount, values, from + (takeFirstLevel - 1) * stateCount, (reachDone - takeFirstLevel) * stateCount) : 0
    const stayEnd = Math.min(reachDone, used)
    const stayDot = stayAll !== 0 && stayEnd > 1 ? dotOfRanges(gradientDone, stateCount, values, from + stateCount, (stayEnd - 1) * stateCount) : 0
    depthGradientBefore.fill(0)
    for (let slot = 0; slot < changeSlots; slot++) {
      const change = unchangedSlot - slot
      const keeps = keepChange[slot]! * inverse, takes = takeChange[slot]! * inverse
      let keepDot = 0, takeDot = 0
      if (keeps !== 0 || takes !== 0 || fullShare !== 0) {
        for (let depth = depthLow; depth <= depthHigh; depth++) {
          const target = Math.min(maximumDepth, Math.max(0, depth + change))
          const share = values[depthFrom + depth - depthLow]!
          keepDot += depthGradientNext[target]! * share
          takeDot += depthGradientDone[target]! * share
          depthGradientBefore[depth]! += keeps * depthGradientNext[target]! + takes * depthGradientDone[target]!
        }
      }
      keepChangeDot[slot] = keepDot
      takeChangeDot[slot] = takeDot
    }
    let below = 0, popDot = 0
    if (popAll !== 0) {
      if (used > 1) {
        below = sumOfRange(values, from + stateCount, stateCount)
        popDot = dotOfRanges(gradientNext, 0, values, from + stateCount, stateCount)
      }
      popDot += toStopped * Math.max(0, mass - below)
    }
    if (reduceAll !== 0) {
      for (let slot = 0; slot < reduceWeight.length; slot++) {
        if (reduceWeight[slot] === 0) continue
        const dropped = Math.floor(slot / nonterminalCount) + 1, nonterminal = slot % nonterminalCount
        let found = 0, dot = 0
        if (dropped < used) {
          const under = from + dropped * stateCount
          for (let state = 0; state < stateCount; state++) {
            const share = values[under + state]!
            if (share === 0) continue
            dot += gradientNext[stateAfter[state * nonterminalCount + nonterminal]!]! * share
            found += share
          }
        }
        reduceDot[slot] = dot + toStopped * Math.max(0, mass - found)
      }
    }

    // The gradient by the top level through the weights, and by the shares of the cells.
    gradientBefore.fill(0, 0, used * stateCount)
    const skipScaled = inverse * (stayDot + takeChangeDot[unchangedSlot]!)
    // The sum over the choices of weight × what the weight is worth through the division by the mass, and the
    // gradient by the share whose stack is full.
    let scaledTotal = 0, fullGradient = 0
    for (let state = 0; state < stateCount; state++) {
      const top = values[from + state]!
      if (top === 0) continue
      const cell = flagOffset + state * terminalCount + terminal
      const first = entryStart[cell]!, end = first + entryCount[cell]!
      const skipDirect = gradientDone[state]!
      let byTop = 0
      for (let entry = first; entry < end; entry++) {
        const type = entryType[entry]!
        let direct = 0, scaled = 0
        if (type <= pushTaking) {
          const pushed = entryPushed[entry]!
          if (type === pushKeeping) {
            direct = gradientNext[pushed]! + (pusherBelow && usedNext > 1 ? gradientNext[stateCount + state]! : 0)
            scaled = inverse * (moveDot[0]! + keepChangeDot[entryChange[entry]!]!)
          } else {
            direct = gradientDone[pushed]! + (pusherBelow && reachDone > 1 ? gradientDone[stateCount + state]! : 0)
            scaled = inverse * (pushTakeDot + takeChangeDot[entryChange[entry]!]!)
          }
          if (fullShare !== 0) {
            fullGradient += top * shares[entry]! * (skipDirect + skipScaled - direct - scaled)
            direct = (1 - fullShare) * direct + fullShare * skipDirect
            scaled = (1 - fullShare) * scaled + fullShare * skipScaled
          }
        } else if (type === skipping) {
          direct = skipDirect
          scaled = skipScaled
        } else if (type === popping) scaled = inverse * (popDot + moveDot[2]! + keepChangeDot[entryChange[entry]!]!)
        else {
          const dropped = entryDropped[entry]!
          scaled = inverse * (reduceDot[(dropped - 1) * nonterminalCount + entryNonterminal[entry]!]! + moveDot[dropped]! + keepChangeDot[entryChange[entry]!]!)
        }
        const share = shares[entry]!
        shareGradients[entry]! += top * (direct + scaled)
        byTop += share * (direct + scaled)
        scaledTotal += top * share * scaled
      }
      gradientBefore[state]! += byTop
    }
    // The mass is the sum of the top level: every weight is divided by it, the part of a pop and of a reduction
    // that finds no state below is what is left of it, and the share whose stack is full is a level's sum over it.
    // Where rounding made what is left negative and the step took 0, the gradient is still the one of what is left:
    // the two differ by 1e-16.
    const byMass = -inverse * scaledTotal + toStopped * inverse * (popAll + reduceAll) - fullGradient * fullShare * inverse
    for (let state = 0; state < stateCount; state++) gradientBefore[state]! += byMass
    if (fullShare !== 0) for (let state = 0; state < stateCount; state++) gradientBefore[(levelCount - 1) * stateCount + state]! += fullGradient * inverse

    // The gradient by the levels that the step copies.
    for (let move = -1; move < longestRule; move++) {
      const weight = moveWeight[move + 1]!
      if (weight === 0) continue
      const firstLevel = Math.max(pusherBelow && move === -1 ? 2 : 1, -move), endLevel = Math.min(usedNext, used - move)
      if (endLevel > firstLevel) addRange(gradientBefore, (firstLevel + move) * stateCount, gradientNext, firstLevel * stateCount, (endLevel - firstLevel) * stateCount, weight * inverse)
    }
    if (pushTakeAll !== 0 && reachDone > takeFirstLevel) addRange(gradientBefore, (takeFirstLevel - 1) * stateCount, gradientDone, takeFirstLevel * stateCount, (reachDone - takeFirstLevel) * stateCount, pushTakeAll * inverse)
    if (stayAll !== 0 && stayEnd > 1) addRange(gradientBefore, stateCount, gradientDone, stateCount, (stayEnd - 1) * stateCount, stayAll * inverse)
    if (popAll !== 0 && used > 1) {
      const scaled = popAll * inverse
      for (let state = 0; state < stateCount; state++) gradientBefore[stateCount + state]! += scaled * (gradientNext[state]! - toStopped)
    }
    if (reduceAll !== 0) {
      for (let slot = 0; slot < reduceWeight.length; slot++) {
        const weight = reduceWeight[slot]!
        if (weight === 0) continue
        const dropped = Math.floor(slot / nonterminalCount) + 1, nonterminal = slot % nonterminalCount
        if (dropped >= used) continue
        const scaled = weight * inverse
        for (let state = 0; state < stateCount; state++) gradientBefore[dropped * stateCount + state]! += scaled * (gradientNext[stateAfter[state * nonterminalCount + nonterminal]!]! - toStopped)
      }
    }
  }

  // The backward pass of one sample: from the last stack that shows tokens to the first.
  function backward(samples: PackedSamples) {
    const {terminal: terminals, firstOnLine} = samples
    gradientDone.fill(0, 0, frameUsed[shownFrame[shownCount - 1]!]! * stateCount)
    depthGradientDone.fill(0)
    for (let shown = shownCount - 1; ; shown--) {
      const frame = shownFrame[shown]!
      const usedDone = frameUsed[frame]!
      const token = shownToken[shown]!
      // What the stack shows, for its own token and for the white space and the comments after it.
      containerBackward(shown)
      if (token !== -1) kindBackward(shown, terminals[token]!)
      for (let index = shownDepthStart[shown]!; index < shownDepthStart[shown + 1]!; index++) depthGradientDone[depthOfGradient[index]!]! += depthGradient[index]!
      if (shown === 0) break
      // The token's small steps: the live part after the last one was added to the stack as it was.
      const before = shownFrame[shown - 1]!
      const steps = shownSteps[shown]!
      const last = before + steps
      const usedLast = frameUsed[last]!
      const shared = Math.min(usedLast, usedDone) * stateCount
      gradientNext.set(gradientDone.subarray(0, shared))
      gradientNext.fill(0, shared, usedLast * stateCount)
      depthGradientNext.fill(0)
      for (let depth = frameDepthLow[last]!; depth <= frameDepthHigh[last]!; depth++) depthGradientNext[depth] = depthGradientDone[depth]!
      const flagOffset = flagged && firstOnLine[token] === 1 ? cellsPerCopy : 0
      for (let step = steps - 1; step >= 0; step--) {
        stepBackward(before + step, terminals[token]!, flagOffset, usedDone)
        const swapped = gradientNext
        gradientNext = gradientBefore
        gradientBefore = swapped
        const swappedDepth = depthGradientNext
        depthGradientNext = depthGradientBefore
        depthGradientBefore = swappedDepth
      }
      // The gradient by the stack before the token: the stack that has taken the token before.
      const swapped = gradientDone
      gradientDone = gradientNext
      gradientNext = swapped
      const swappedDepth = depthGradientDone
      depthGradientDone = depthGradientNext
      depthGradientNext = swappedDepth
    }
  }

  function runSample(samples: PackedSamples, sample: number, tally: LossTally, withGradient: boolean, reading: Reading | null) {
    const {terminal: terminals, firstOnLine} = samples
    tapeTop = 0
    frameCount = 0
    shownCount = 0
    depthGradientCount = 0
    // The stack at the first open cell: one state per level, and one depth.
    const height = samples.stackStart[sample + 1]! - samples.stackStart[sample]!
    let depth = 0
    for (let level = 0; level < height; level++) {
      const state = samples.stackState[samples.stackStart[sample + 1]! - 1 - level]!
      done[level * stateCount + state] = 1
      depth += stateOpensDepth[state]!
    }
    doneReach = height
    doneDepth[depth] = 1
    doneDepthLow = doneDepthHigh = depth
    let shown = newShown(frameOfDone(), -1, 0)
    showFrame(shownFrame[shown]!, -1)
    // The end of input is the last packed token, and takes no step here.
    const first = samples.tokenStart[sample]!, end = samples.tokenStart[sample + 1]! - 1
    if (reading !== null) {
      reading.tokenCount = end - first
      reading.kind.fill(0, 0, (end - first) * displayKindCount)
      reading.depth.fill(0, 0, (end - first) * readingDepthCount)
      reading.container.fill(0, 0, (end - first) * containerCount)
    }
    for (let at = first; at < end; at++) {
      const terminal = terminals[at]!
      if (terminal < 0) {
        // White space and comments take no step: they are shown with the stack as it is.
        lossOfToken(samples, at, shown, terminal === packedComment ? displayKind.comment : displayKind.whitespace, tally, withGradient, reading, at - first)
        continue
      }
      if (!withGradient) {
        // Only the stack before the token is needed: it moves to the start of the tape.
        const frame = frameCount - 1
        const depthOffset = frameDepthOffset[frame]!, length = frameOffset[frame]! + frameUsed[frame]! * stateCount - depthOffset
        tape.copyWithin(0, depthOffset, depthOffset + length)
        frameOffset[0] = frameOffset[frame]! - depthOffset
        frameUsed[0] = frameUsed[frame]!
        frameDepthOffset[0] = 0
        frameDepthLow[0] = frameDepthLow[frame]!
        frameDepthHigh[0] = frameDepthHigh[frame]!
        frameMass[0] = frameMass[frame]!
        frameCount = 1
        tapeTop = length
        shownCount = 0
      }
      const steps = stepToken(terminal, flagged && firstOnLine[at] === 1 ? cellsPerCopy : 0)
      shown = newShown(frameCount - 1, at, steps)
      showFrame(shownFrame[shown]!, terminal)
      lossOfToken(samples, at, shown, -1, tally, withGradient, reading, at - first)
    }
    shownDepthStart[shownCount] = depthGradientCount
    if (withGradient) backward(samples)
    tally.samples++
    tally.codePoints += samples.scored[sample]!
  }

  function run(logits: Float64Array, samples: PackedSamples, places: ArrayLike<number>, tally: LossTally, gradient: Float64Array | null = null, reading: Reading | null = null) {
    refuseOtherTerminals(samples, base)
    if (logits.length !== layout.logitCount || (gradient !== null && gradient.length !== layout.logitCount)) throw new Error(`the twin's layout has ${layout.logitCount} logits, and it got ${logits.length}${gradient === null ? '' : ` with a gradient of ${gradient.length}`}`)
    if (reading !== null && places.length !== 1) throw new Error(`a reading is of one sample, and the twin got ${places.length}`)
    sharesInto(layout, logits, shares)
    if (gradient !== null) shareGradients.fill(0)
    for (const name of Object.keys(counters) as (keyof typeof counters)[]) counters[name] = 0
    for (let index = 0; index < places.length; index++) {
      const sample = places[index]!
      if (!Number.isInteger(sample) || sample < 0 || sample >= samples.sampleCount) throw new Error(`the twin got the place ${sample}, and the samples have the places 0 to ${samples.sampleCount - 1}`)
      runSample(samples, sample, tally, gradient !== null, reading)
    }
    if (gradient !== null) addLogitGradients(layout, shares, shareGradients, gradient)
    for (const [name, count] of Object.entries(counters)) tally.counters[name] = (tally.counters[name] ?? 0) + count
  }

  return {name: `a mix of states per level of the stack${pusherBelow ? ', with the pushing state below a pushed one' : ''}`, run}
}
