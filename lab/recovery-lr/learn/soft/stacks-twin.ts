// The reference twin: a weighted set of exact stacks.
//
// The twin holds a set of stacks of states, each with a weight, and starts with the sample's stack at its first
// open cell, with the weight 1. A stack that reads a cell which is not trainable does what the cell holds, as the
// exact parser. A stack that reads a trainable cell splits into one stack per choice of the cell's list, each with
// the weight of its parent times the choice's share. So a stack's weight is the product of the shares of the
// choices that made it, and no goto is ever read off a mix: every stack is a path of the automaton.
//
// After every round of steps the heaviest `width` stacks are kept, 48 unless another width is asked for, and a
// new stack whose weight is under `leastWeight`, 1e-9, is not made. Both are the settings of the prototype that
// the design's review built (sk-beam.ts in the scratch folder of the transfer track). When all stacks have taken
// or skipped the token, their weights are divided by their sum, so the least weight is a share of the weight that
// is kept, at the first token of a sample and at its last. The prototype did not divide, and its weights fall
// from token to token. On 4,000 train samples at the start of a run the two keep the same number of stacks and
// have a loss of 8.4687 and 8.4699 per code point, so the difference is small.
//
// What the twin shows for a token is a mix over the stacks: the share of a depth is the weight of the stacks that
// have it, and the share of a display kind is the same sum with every stack's display entry, whose mix is the
// softmax of the entry's logits when the entry is trainable. The loss is the cross-entropy of the three against
// the labels.
//
// The gradient is exact for the stacks that are kept: every new stack is a node with its parent, the loss gives
// every stack a gradient by the logarithm of its weight, and a pass from the last node to the first adds them up
// along the parents. Which stacks are kept can change with the logits, so the loss has jumps where two stacks
// swap their places at the cut. With a width that holds every stack and a least weight of 0 the loss is smooth:
// check-gradient.ts compares the gradient with finite differences there.
//
// With exact tables one stack has the weight 1, and the twin is the exact parser: check-twin.ts.
import {containerCount, displayKind, displayKindCount} from '../../labels.ts'
import {type PackedSamples, packedComment, refuseOtherTerminals} from '../data.ts'
import {
  bison, bisonTerminalCount, choicesOf, kindAccept, kindEndEarly, kindInsert, kindPop, kindReadAs, kindReduce, kindShift, kindSkip, kindStop, maximumStackHeight, maximumStepsPerToken, stateContainer,
  stateOpensDepth, stopped,
} from '../recovery-tables.ts'
import {type Layout, addLogitGradients, sharesInto} from './model.ts'
import {type LossTally, type Reading, type Twin, type TwinOptions, lossFloor, readingDepthCount} from './twin.ts'

export const defaultWidth = 48
export const defaultLeastWeight = 1e-9

// A copy of a typed array with twice the room.
function grown<Typed extends Uint8Array | Int16Array | Int32Array | Float64Array>(array: Typed): Typed {
  const larger = new (array.constructor as new (length: number) => Typed)(array.length * 2)
  larger.set(array)
  return larger
}

// The k-th largest of the first `count` values, e.g. the second largest for k = 2. It puts the values in another
// order.
export function kthLargest(values: Float64Array, count: number, k: number): number {
  const target = k - 1
  let low = 0, high = count - 1
  while (low < high) {
    const pivot = values[(low + high) >> 1]!
    let left = low, right = high
    while (left <= right) {
      while (values[left]! > pivot) left++
      while (values[right]! < pivot) right--
      if (left > right) break
      const value = values[left]!
      values[left] = values[right]!
      values[right] = value
      left++
      right--
    }
    if (target <= right) high = right
    else if (target >= left) low = left
    else break
  }
  return values[target]!
}

export function createTwin(layout: Layout, options: TwinOptions = {}): Twin {
  const width = options['width'] ?? defaultWidth
  const leastWeight = options['leastWeight'] ?? defaultLeastWeight
  if (!Number.isInteger(width) || width < 1) throw new Error(`the twin of exact stacks keeps a whole number of stacks, at least 1, and got the width ${width}`)
  const {base, cellOffset, displayOffset} = layout
  const {terminalCount, cellsPerCopy, display} = base
  const choices = base.choice
  const flagged = base.firstOnLineFlag
  const {ruleLength, ruleLhs, gotoState, transition, nonterminalCount, symbolCount} = bison

  // Per trainable cell, the length of its list, and per logit of a cell, the choice that it stands for.
  const listLength = new Int32Array(choices.length)
  const choiceOfLogit = new Int16Array(layout.logitCount)
  for (let cell = 0; cell < choices.length; cell++) {
    if (cellOffset[cell] === -1) continue
    const list = choicesOf(base, cell)
    listLength[cell] = list.length
    choiceOfLogit.set(list, cellOffset[cell])
  }
  const shares = new Float64Array(layout.logitCount)
  const shareGradients = new Float64Array(layout.logitCount)

  // The states of all stacks of a sample, as linked elements: a stack is its top element, and the element below
  // is the rest of the stack. A new stack shares the elements of its parent, so a split copies nothing. Next to
  // each state: the depth and the container of the stack up to it, and its height. Element 0 stands for what is
  // below the start state.
  let elementState = new Uint8Array(1 << 14), elementBelow = new Int32Array(1 << 14), elementDepth = new Int16Array(1 << 14), elementContainer = new Uint8Array(1 << 14), elementHeight = new Int16Array(1 << 14)
  let elementCount = 1
  function pushState(below: number, state: number): number {
    if (elementCount === elementState.length) {
      elementState = grown(elementState)
      elementBelow = grown(elementBelow)
      elementDepth = grown(elementDepth)
      elementContainer = grown(elementContainer)
      elementHeight = grown(elementHeight)
    }
    const element = elementCount++
    elementState[element] = state
    elementBelow[element] = below
    elementDepth[element] = elementDepth[below]! + stateOpensDepth[state]!
    const container = stateContainer[state]!
    elementContainer[element] = container !== 0 ? container : elementContainer[below]!
    elementHeight[element] = elementHeight[below]! + 1
    return element
  }

  // The stacks: the top element, the weight, the node of the choice that made the stack (-1 for none), the steps
  // of the token at hand, and the display entry that the token is shown by once it is taken or skipped.
  let stackTop = new Int32Array(1 << 12), stackWeight = new Float64Array(1 << 12), stackNode = new Int32Array(1 << 12), stackSteps = new Uint8Array(1 << 12), stackEntry = new Int32Array(1 << 12)
  let stackCount = 0
  function newStack(top: number, weight: number, node: number, steps: number): number {
    if (stackCount === stackTop.length) {
      stackTop = grown(stackTop)
      stackWeight = grown(stackWeight)
      stackNode = grown(stackNode)
      stackSteps = grown(stackSteps)
      stackEntry = grown(stackEntry)
    }
    const stack = stackCount++
    stackTop[stack] = top
    stackWeight[stack] = weight
    stackNode[stack] = node
    stackSteps[stack] = steps
    stackEntry[stack] = -1
    return stack
  }

  // The nodes, for the gradient: the logit of the choice, the node of the parent stack's own choice (-1 for none),
  // and the gradient of the loss by the logarithm of the weight of the stack that the choice made.
  let nodeLogit = new Int32Array(1 << 14), nodeParent = new Int32Array(1 << 14), nodeGradient = new Float64Array(1 << 14)
  let nodeCount = 0
  function newNode(logit: number, parent: number): number {
    if (nodeCount === nodeLogit.length) {
      nodeLogit = grown(nodeLogit)
      nodeParent = grown(nodeParent)
      nodeGradient = grown(nodeGradient)
    }
    const node = nodeCount++
    nodeLogit[node] = logit
    nodeParent[node] = parent
    nodeGradient[node] = 0
    return node
  }

  // The stacks that still read the token, the ones of the next round, and the ones that have taken or skipped it.
  let live = new Int32Array(1 << 12), next = new Int32Array(1 << 12), done = new Int32Array(1 << 12)
  let nextCount = 0, doneCount = 0
  let cutWeights = new Float64Array(1 << 12)
  // What the twin counts about its work: the tokens that took steps, the stacks that were kept after each of
  // them, the stacks that the width or the least weight dropped, the share of the weight that was kept at each
  // token, added up, and the samples that lost every stack before their last token.
  const counters = {tokens: 0, stacksKept: 0, stacksDropped: 0, weightKept: 0, samplesCutShort: 0}

  // One step of a stack: applies a choice, with the limits of ../score.ts. Returns true when the token is taken or
  // skipped, and the stack's display entry is set then.
  function applyChoice(stack: number, choice: number, state: number, terminal: number): boolean {
    const kind = choice >> 8, argument = choice & 255
    const top = stackTop[stack]!
    if (kind === kindReduce || kind === kindEndEarly) {
      const dropped = kind === kindReduce ? ruleLength[argument]! : argument >> 4
      const nonterminal = kind === kindReduce ? ruleLhs[argument]! : bisonTerminalCount + (argument & 15)
      if (dropped === 0 && elementHeight[top]! >= maximumStackHeight) {
        stackEntry[stack] = state * terminalCount + terminal
        return true
      }
      let below = top
      for (let level = 0; level < dropped; level++) below = elementBelow[below]!
      stackTop[stack] = pushState(below, gotoState[elementState[below]! * nonterminalCount + nonterminal - bisonTerminalCount]!)
      return false
    }
    if (kind === kindPop) {
      stackTop[stack] = elementBelow[top]!
      return false
    }
    if (kind === kindSkip) {
      stackEntry[stack] = state * terminalCount + terminal
      return true
    }
    if (kind === kindAccept) throw new Error('a stack of the twin reads the accept: the twin takes no step at the end of input')
    // Every other choice pushes a state without dropping one, and needs room on the stack.
    if (elementHeight[top]! >= maximumStackHeight) {
      stackEntry[stack] = state * terminalCount + terminal
      return true
    }
    if (kind === kindShift || kind === kindReadAs) {
      const target = kind === kindShift ? argument : transition[state * symbolCount + argument]!
      stackTop[stack] = pushState(top, target)
      stackEntry[stack] = target * terminalCount + terminal
      return true
    }
    if (kind !== kindStop && kind !== kindInsert) throw new Error(`a cell holds ${choice}, which is no choice`)
    stackTop[stack] = pushState(top, kind === kindStop ? stopped : transition[state * symbolCount + argument]!)
    return false
  }
  function addNext(stack: number) {
    if (nextCount === next.length) next = grown(next)
    next[nextCount++] = stack
  }
  function addDone(stack: number) {
    if (doneCount === done.length) done = grown(done)
    done[doneCount++] = stack
  }

  // Keeps the heaviest `width` stacks of both lists together. Of stacks with the same weight at the cut, the ones
  // that come first stay: `next` before `done`, each in its order.
  function keepHeaviest() {
    const total = nextCount + doneCount
    while (cutWeights.length < total) cutWeights = grown(cutWeights)
    for (let index = 0; index < nextCount; index++) cutWeights[index] = stackWeight[next[index]!]!
    for (let index = 0; index < doneCount; index++) cutWeights[nextCount + index] = stackWeight[done[index]!]!
    const cut = kthLargest(cutWeights, total, width)
    let above = 0
    for (let index = 0; index < nextCount; index++) if (stackWeight[next[index]!]! > cut) above++
    for (let index = 0; index < doneCount; index++) if (stackWeight[done[index]!]! > cut) above++
    let atTheCut = width - above
    const keptOf = (list: Int32Array, count: number): number => {
      let kept = 0
      for (let index = 0; index < count; index++) {
        const weight = stackWeight[list[index]!]!
        if (weight > cut || (weight === cut && atTheCut-- > 0)) list[kept++] = list[index]!
      }
      return kept
    }
    nextCount = keptOf(next, nextCount)
    doneCount = keptOf(done, doneCount)
    counters.stacksDropped += total - width
  }

  // The steps of one token for the stacks in `done`, which holds the kept stacks of the token before. Afterwards
  // `done` holds the stacks that have taken or skipped the token, with weights that add up to 1.
  function stepToken(terminal: number, flagOffset: number, withGradient: boolean) {
    let liveCount = doneCount
    const swapped = live
    live = done
    done = swapped
    doneCount = 0
    for (let index = 0; index < liveCount; index++) stackSteps[live[index]!] = 0
    while (liveCount > 0) {
      nextCount = 0
      for (let index = 0; index < liveCount; index++) {
        const stack = live[index]!
        const top = stackTop[stack]!
        const state = elementState[top]!
        if (stackSteps[stack] === maximumStepsPerToken) {
          // The 17th step is a skip, whatever the cell holds.
          stackEntry[stack] = state * terminalCount + terminal
          addDone(stack)
          continue
        }
        const steps = stackSteps[stack]! + 1
        stackSteps[stack] = steps
        const cell = flagOffset + state * terminalCount + terminal
        const offset = cellOffset[cell]!
        if (offset === -1) {
          if (applyChoice(stack, choices[cell]!, state, terminal)) addDone(stack)
          else addNext(stack)
          continue
        }
        const weight = stackWeight[stack]!, node = stackNode[stack]!
        for (let logit = offset; logit < offset + listLength[cell]!; logit++) {
          const childWeight = weight * shares[logit]!
          // A share of exactly 0 is a choice that the cell does not hold, e.g. in exact tables.
          if (childWeight === 0) continue
          if (childWeight < leastWeight) {
            counters.stacksDropped++
            continue
          }
          const child = newStack(top, childWeight, withGradient ? newNode(logit, node) : -1, steps)
          if (applyChoice(child, choiceOfLogit[logit]!, state, terminal)) addDone(child)
          else addNext(child)
        }
      }
      if (nextCount + doneCount > width) keepHeaviest()
      const before = live
      live = next
      next = before
      liveCount = nextCount
    }
    counters.tokens++
    if (doneCount === 0) return
    let total = 0
    for (let index = 0; index < doneCount; index++) total += stackWeight[done[index]!]!
    for (let index = 0; index < doneCount; index++) stackWeight[done[index]!] = stackWeight[done[index]!]! / total
    counters.stacksKept += doneCount
    counters.weightKept += total
  }

  // The loss of one token, which the stacks in `done` show, and the gradients that it gives the stacks' nodes and
  // the display entries. The weights of the stacks add up to 1, so a label's share is the weight of the stacks
  // that have it. `triviaKind` is the kind of white space or of a comment, which is shown as what it is, or -1 for
  // a token that the stacks have taken or skipped.
  function showToken(samples: PackedSamples, at: number, triviaKind: number, tally: LossTally, withGradient: boolean, reading: Reading | null, row: number) {
    const {groupStart, groupKind, groupDepth, groupContainer, groupCount} = samples
    for (let group = groupStart[at]!; group < groupStart[at + 1]!; group++) {
      const count = groupCount[group]!, labelKind = groupKind[group]!, labelDepth = groupDepth[group]!, labelContainer = groupContainer[group]!
      let kindShare = triviaKind === labelKind ? 1 : 0, depthShare = 0, containerShare = 0
      for (let index = 0; index < doneCount; index++) {
        const stack = done[index]!
        const weight = stackWeight[stack]!, top = stackTop[stack]!
        if (triviaKind === -1) {
          const entry = stackEntry[stack]!
          const offset = displayOffset[entry]!
          kindShare += weight * (offset === -1 ? (display[entry] === labelKind ? 1 : 0) : shares[offset + labelKind]!)
        }
        if (elementDepth[top] === labelDepth) depthShare += weight
        if (elementContainer[top] === labelContainer) containerShare += weight
      }
      const kindLoss = -count * Math.log(kindShare + lossFloor), depthLoss = -count * Math.log(depthShare + lossFloor), containerLoss = -count * Math.log(containerShare + lossFloor)
      tally.kindLoss += kindLoss
      tally.depthLoss += depthLoss
      tally.containerLoss += containerLoss
      tally.loss += kindLoss + depthLoss + containerLoss
      tally.labelsWithoutShare += count * ((kindShare === 0 ? 1 : 0) + (depthShare === 0 ? 1 : 0) + (containerShare === 0 ? 1 : 0))
      if (!withGradient) continue
      // The gradient of a term -count × ln(share + floor) by the logarithm of a stack's weight, before the weights
      // were divided by their sum, is scale × (match - share) × the stack's weight, where match is the stack's own
      // share of the label. Without a dropped stack the terms with `share` add up to nothing over a cell's choices.
      const kindScale = -count / (kindShare + lossFloor), depthScale = -count / (depthShare + lossFloor), containerScale = -count / (containerShare + lossFloor)
      for (let index = 0; index < doneCount; index++) {
        const stack = done[index]!
        const weight = stackWeight[stack]!, top = stackTop[stack]!
        let byLogWeight = depthScale * ((elementDepth[top] === labelDepth ? 1 : 0) - depthShare) + containerScale * ((elementContainer[top] === labelContainer ? 1 : 0) - containerShare)
        if (triviaKind === -1) {
          const entry = stackEntry[stack]!
          const offset = displayOffset[entry]!
          byLogWeight += kindScale * ((offset === -1 ? (display[entry] === labelKind ? 1 : 0) : shares[offset + labelKind]!) - kindShare)
          // The entry's own share of the label's kind weighs as much as the stack.
          if (offset !== -1) shareGradients[offset + labelKind]! += kindScale * weight
        }
        const node = stackNode[stack]!
        if (node !== -1) nodeGradient[node]! += byLogWeight * weight
      }
    }
    if (reading === null) return
    for (let index = 0; index < doneCount; index++) {
      const stack = done[index]!
      const weight = stackWeight[stack]!, top = stackTop[stack]!
      reading.depth[row * readingDepthCount + elementDepth[top]!]! += weight
      reading.container[row * containerCount + elementContainer[top]!]! += weight
      if (triviaKind !== -1) continue
      const entry = stackEntry[stack]!
      const offset = displayOffset[entry]!
      if (offset === -1) reading.kind[row * displayKindCount + display[entry]!]! += weight
      else for (let kind = 0; kind < displayKindCount; kind++) reading.kind[row * displayKindCount + kind]! += weight * shares[offset + kind]!
    }
    if (triviaKind !== -1) reading.kind[row * displayKindCount + triviaKind] = 1
  }

  function runSample(samples: PackedSamples, sample: number, tally: LossTally, withGradient: boolean, reading: Reading | null) {
    const {terminal: terminals, firstOnLine} = samples
    elementCount = 1
    stackCount = 0
    nodeCount = 0
    let top = 0
    for (let at = samples.stackStart[sample]!; at < samples.stackStart[sample + 1]!; at++) top = pushState(top, samples.stackState[at]!)
    doneCount = 0
    addDone(newStack(top, 1, -1, 0))
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
        // White space and comments take no step: they are shown with the stacks as they are.
        showToken(samples, at, terminal === packedComment ? displayKind.comment : displayKind.whitespace, tally, withGradient, reading, at - first)
        continue
      }
      stepToken(terminal, flagged && firstOnLine[at] === 1 ? cellsPerCopy : 0, withGradient)
      // Every new stack was under the least weight: the sample ends here, without the loss of its other tokens.
      if (doneCount === 0) {
        counters.samplesCutShort++
        break
      }
      showToken(samples, at, -1, tally, withGradient, reading, at - first)
    }
    if (withGradient) {
      // From the last node to the first: a node's gradient is also its parent's, and the gradient by the share of
      // its choice is the gradient by the logarithm divided by the share.
      for (let node = nodeCount - 1; node >= 0; node--) {
        const byLogWeight = nodeGradient[node]!
        if (byLogWeight === 0) continue
        const parent = nodeParent[node]!
        if (parent !== -1) nodeGradient[parent]! += byLogWeight
        shareGradients[nodeLogit[node]!]! += byLogWeight / shares[nodeLogit[node]!]!
      }
    }
    tally.samples++
    tally.codePoints += samples.scored[sample]!
  }

  function run(logits: Float64Array, samples: PackedSamples, places: ArrayLike<number>, tally: LossTally, gradient: Float64Array | null = null, reading: Reading | null = null) {
    refuseOtherTerminals(samples, base)
    if (logits.length !== layout.logitCount || (gradient !== null && gradient.length !== layout.logitCount)) throw new Error(`the twin's layout has ${layout.logitCount} logits, and it got ${logits.length}${gradient === null ? '' : ` with a gradient of ${gradient.length}`}`)
    if (reading !== null && places.length !== 1) throw new Error(`a reading is of one sample, and the twin got ${places.length}`)
    sharesInto(layout, logits, shares)
    if (gradient !== null) shareGradients.fill(0)
    counters.tokens = counters.stacksKept = counters.stacksDropped = counters.weightKept = counters.samplesCutShort = 0
    for (let index = 0; index < places.length; index++) {
      const sample = places[index]!
      if (!Number.isInteger(sample) || sample < 0 || sample >= samples.sampleCount) throw new Error(`the twin got the place ${sample}, and the samples have the places 0 to ${samples.sampleCount - 1}`)
      runSample(samples, sample, tally, gradient !== null, reading)
    }
    if (gradient !== null) addLogitGradients(layout, shares, shareGradients, gradient)
    for (const [name, count] of Object.entries(counters)) tally.counters[name] = (tally.counters[name] ?? 0) + count
  }

  return {name: `${width} exact stacks`, run}
}
