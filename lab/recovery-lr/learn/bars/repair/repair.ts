// The bar "cheapest repair": a search at parse time for the fewest changes of the tokens that let the parser go
// on, after Burke and Fisher (1987) and its later forms (Corchuelo and others 2002; Diekmann and Tratt 2020,
// "CPCT+"). It has no author: it knows the grammar's table and nothing else of the language, and no number of it
// was chosen on samples. It looks ahead and compares repairs, which one cell of a table cannot do.
//
// The parser is the grammar's LALR(1) table, i.e. the frozen cells. Where the table rejects a token:
//
// 1. The search. An edit puts a terminal in before a token, takes a token out, or reads a token as another
//    terminal, e.g. `then` before the `else` of `if a else b`. Every edit costs 1. The search goes through the
//    sequences of edits by cost, 1 first, and a sequence is a repair when the parser then goes on: it shifts
//    `shiftsNeeded` tokens after the last edit and has then got through at least the `shiftsNeeded` tokens from
//    the rejected one on, or it accepts the end of the text. Edits may stand at the rejected token, after it as
//    far as the parser gets, and at the `tokensBack` tokens before it: the parser has kept its stack before each
//    of them, as Burke and Fisher's parser does, since an error often shows some tokens after the mistake, e.g. a
//    missing `in` shows at the next `let`. Of the repairs of the lowest cost the search takes the one after which
//    the parser gets furthest, then the one that takes out or reads anew the fewest tokens of the text, then the
//    one that starts nearest to the rejected token.
// 2. When the search finds nothing within `maximumCost` edits and `maximumTries` tried edits: tokens are dropped
//    from the rejected one on, as few as possible, and for that number the stack is cut down as little as
//    possible, until the parser shifts `shiftsNeeded` tokens or accepts the end. This is panic mode with a look
//    ahead, Burke and Fisher's second phase.
//
// The numbers, fixed once from the literature:
// - shiftsNeeded 3: Corchuelo's and CPCT+'s number of shifts, and the least distance of Burke and Fisher's parse check.
// - every edit costs 1: CPCT+'s costs for putting in and taking out. Burke and Fisher's three single-token
//   repairs are these three edits.
// - tokensBack 15: the look-ahead that ML-Yacc, which implements Burke and Fisher, recommends.
// - Repairs of one cost are ranked by how far the parser gets, as in CPCT+, to the end of the text: a text has at
//   most 512 code points, where CPCT+ stops after 250 tokens.
// - maximumCost and maximumTries stand in for CPCT+'s limit of half a second, so that a run gives the same output
//   on every machine. Their values are the README's, with what other values give.
//
// A token that is taken out is a dropped token: it is shown with the stack as it is and with the display kind of
// dropped-kinds.json, the count that every bar may use. A token that is read as another terminal is shown as that
// terminal, and the stack holds it as that terminal.
//
//   bun lab/recovery-lr/learn/bars/repair/repair.ts [--validation <samples>]
import {join} from 'node:path'
import {defaultSeed, loadSamples} from '../../../dataset.ts'
import {containerOf, depthOf, displayKind, displayOfState, emptyStackHash, stackHashOf} from '../../../labels.ts'
import type {Sample} from '../../../sample.ts'
import {actionAccept, actionShift, commentKind, isTrivia, tables as bison} from '../../../tables.ts'
import {numberOf, refuseUnknownOptions, standardValidationCount} from '../../options.ts'
import {type ParserOutput, type Score, scoreHeader, scoreOutputs, scoreRow} from '../../score.ts'
import {readDroppedKinds} from './dropped-kinds.ts'

export type RepairSettings = {
  shiftsNeeded: number
  tokensBack: number
  maximumCost: number
  // How many edits one search may try before it gives up.
  maximumTries: number
}
export const standardSettings: RepairSettings = {shiftsNeeded: 3, tokensBack: 15, maximumCost: 8, maximumTries: 2_000_000}

// [terminal]: the display kind of a token that a repair takes out, see dropped-kinds.ts.
export const kindOfDroppedToken = readDroppedKinds(join(import.meta.dir, 'dropped-kinds.json'))

const {terminalCount, nonterminalCount, frozen, actionKind, actionArgument, ruleLength, ruleLhs, gotoState, endSymbol} = bison
// The terminals that the search may put in: the ones that a rule of the grammar has.
const insertable: number[] = []
for (let terminal = 0; terminal < terminalCount; terminal++) if (terminal !== endSymbol && bison.ruleRhs.some(rightSide => rightSide.includes(terminal))) insertable.push(terminal)

// The stacks of a search. A stack is a number: its top state and the number of the stack below it. Two stacks
// with the same states have the same number, so a search can tell that it has been in a place before.
let stackCount = 0
let stackBelow = new Int32Array(1 << 16), stackTop = new Uint8Array(1 << 16)
const stackOfKey = new Map<number, number>()
const noStack = -1
function pushState(below: number, state: number): number {
  const key = (below + 1) * 128 + state
  let stack = stackOfKey.get(key)
  if (stack !== undefined) return stack
  if (stackCount === stackBelow.length) {
    const below2 = new Int32Array(stackCount * 2), top2 = new Uint8Array(stackCount * 2)
    below2.set(stackBelow)
    top2.set(stackTop)
    stackBelow = below2
    stackTop = top2
  }
  stack = stackCount++
  stackBelow[stack] = below
  stackTop[stack] = state
  stackOfKey.set(key, stack)
  return stack
}
function stackOfStates(states: readonly number[], height = states.length): number {
  let stack = noStack
  for (let level = 0; level < height; level++) stack = pushState(stack, states[level]!)
  return stack
}
// Feeds a terminal to a stack by the grammar's table: reduces while the table says so, then shifts. Returns the
// stack after the shift, or one of the two numbers below.
const rejectedStack = -1, acceptedStack = -2
function feedStack(stack: number, terminal: number): number {
  for (;;) {
    const cell = stackTop[stack]! * terminalCount + terminal
    if (frozen[cell] === 0) return rejectedStack
    if (actionKind[cell] === actionAccept) return acceptedStack
    if (actionKind[cell] === actionShift) return pushState(stack, actionArgument[cell]!)
    const rule = actionArgument[cell]!
    for (let dropped = ruleLength[rule]!; dropped > 0; dropped--) stack = stackBelow[stack]!
    stack = pushState(stack, gotoState[stackTop[stack]! * nonterminalCount + ruleLhs[rule]! - terminalCount]!)
  }
}
// How far the parser gets from a stack at a place in the terminals, without an edit: the place of the first
// terminal that it rejects, and one past the end of input when it accepts. `terminals` ends with the end of input.
function reachOf(stack: number, position: number, terminals: ArrayLike<number>, atMost: number): number {
  const end = terminals.length - 1
  for (; position < atMost; position++) {
    const after = feedStack(stack, terminals[position]!)
    if (after === rejectedStack) return position
    if (after === acceptedStack) return end + 1
    stack = after
  }
  return position
}

// How the searches of this process ended, for reports: with a repair, at the limit of tried edits, at the limit of
// cost, or with no edit left to try. And the edits that they tried.
export const searchCounts = {searches: 0, repairs: 0, endedByTries: 0, endedByCost: 0, endedWithNothingLeft: 0, tries: 0, mostTries: 0}

export const editInsert = 0, editDelete = 1, editReplace = 2
export type Edit = {
  kind: number
  // The place of the token that the edit stands at, among the tokens that are no white space and no comment: a
  // terminal is put in before that token, or the token is taken out or read as another terminal.
  position: number
  // The terminal that is put in or that the token is read as, -1 for a token that is taken out.
  terminal: number
}

// The nodes of a search: a stack and a place in the terminals, after a sequence of edits whose last one is the
// node's own. Node 0 is the start, without an edit.
type SearchNodes = {
  stack: number[]
  position: number[]
  parent: number[]
  edit: Edit[]
  // How many edits of the sequence take a token out or read it anew, and the place of the first edit.
  removed: number[]
  firstEdit: number[]
}

// The search of point 1 for the terminal at `errorPosition`, which the stack before it rejects. `stackAt(position)`
// gives the parser's stack of states before the terminal at a place from `firstPosition` to `errorPosition`.
// Returns the edits of the repair in the order of the text, or undefined when it finds none.
export function findRepair(terminals: ArrayLike<number>, errorPosition: number, firstPosition: number, stackAt: (position: number) => readonly number[], settings: RepairSettings): Edit[] | undefined {
  const {shiftsNeeded, maximumCost, maximumTries} = settings
  const end = terminals.length - 1
  stackCount = 0
  stackOfKey.clear()
  const nodes: SearchNodes = {stack: [stackOfStates(stackAt(firstPosition))], position: [firstPosition], parent: [-1], edit: [{kind: editInsert, position: firstPosition, terminal: -1}], removed: [0], firstEdit: [-1]}
  // The places that the search has been in, as stack × 1024 + position. A place holds the node of the level that
  // is being made which stands there, or `reachedBefore` when fewer edits lead there.
  const reachedBefore = -1
  const nodeAt = new Map<number, number>([[nodes.stack[0]! * 1024 + firstPosition, reachedBefore]])
  // Two sequences of edits that lead to the same place get equally far from there. So only one of them is kept:
  // the one with fewer edits, and of two with as many edits the one that ranks higher as a repair.
  const add = (stack: number, position: number, parent: number, edit: Edit, into: number[]) => {
    const key = stack * 1024 + position
    const removed = nodes.removed[parent]! + (edit.kind === editInsert ? 0 : 1), firstEdit = parent === 0 ? edit.position : nodes.firstEdit[parent]!
    const there = nodeAt.get(key)
    if (there === undefined) {
      nodeAt.set(key, nodes.stack.length)
      into.push(nodes.stack.length)
      nodes.stack.push(stack)
      nodes.position.push(position)
      nodes.parent.push(parent)
      nodes.edit.push(edit)
      nodes.removed.push(removed)
      nodes.firstEdit.push(firstEdit)
    } else if (there !== reachedBefore && (removed !== nodes.removed[there] ? removed < nodes.removed[there]! : firstEdit > nodes.firstEdit[there]!)) {
      nodes.parent[there] = parent
      nodes.edit[there] = edit
      nodes.removed[there] = removed
      nodes.firstEdit[there] = firstEdit
    }
  }
  let level = [0]
  let tries = 0
  const stacksOnTheWay: number[] = []
  for (let cost = 0; cost <= maximumCost; cost++) {
    // The nodes of this level are no longer changed: every place that the search has been in is reached.
    for (const node of level) nodeAt.set(nodes.stack[node]! * 1024 + nodes.position[node]!, reachedBefore)
    const next: number[] = []
    let best = -1, bestReach = -1
    for (const node of level) {
      // The parser goes on from the node as far as it can. The search has then been in every place on the way.
      stacksOnTheWay.length = 0
      let stack = nodes.stack[node]!, position = nodes.position[node]!
      for (;;) {
        stacksOnTheWay.push(stack)
        const after = feedStack(stack, terminals[position]!)
        if (after === rejectedStack) break
        position++
        if (after === acceptedStack) break
        stack = after
        // A node of the next level that stands here stays: it is looked at as a repair of its own level.
        if (!nodeAt.has(stack * 1024 + position)) nodeAt.set(stack * 1024 + position, reachedBefore)
      }
      const reach = position
      if (cost > 0 && (reach === end + 1 || (reach - nodes.position[node]! >= shiftsNeeded && reach >= errorPosition + shiftsNeeded))) {
        const better = reach !== bestReach ? reach > bestReach : nodes.removed[node] !== nodes.removed[best] ? nodes.removed[node]! < nodes.removed[best]! : nodes.firstEdit[node]! > nodes.firstEdit[best]!
        if (best === -1 || better) {
          best = node
          bestReach = reach
        }
        continue
      }
      // Once the level has a repair, the other nodes of the level are only looked at as repairs.
      if (best !== -1 || cost === maximumCost || tries > maximumTries) continue
      // Every edit at every place on the way, the last place first: the place that the parser stopped at.
      for (let index = Math.min(stacksOnTheWay.length - 1, end - nodes.position[node]!); index >= 0; index--) {
        const at = nodes.position[node]! + index, before = stacksOnTheWay[index]!
        for (const terminal of insertable) {
          tries++
          const after = feedStack(before, terminal)
          if (after >= 0) add(after, at, node, {kind: editInsert, position: at, terminal}, next)
        }
        if (at === end) continue
        tries++
        add(before, at + 1, node, {kind: editDelete, position: at, terminal: -1}, next)
        for (const terminal of insertable) {
          if (terminal === terminals[at]) continue
          tries++
          const after = feedStack(before, terminal)
          if (after >= 0) add(after, at + 1, node, {kind: editReplace, position: at, terminal}, next)
        }
      }
    }
    if (best === -1 && tries <= maximumTries && cost < maximumCost && next.length > 0) {
      level = next
      continue
    }
    searchCounts.searches++
    searchCounts.tries += tries
    searchCounts.mostTries = Math.max(searchCounts.mostTries, tries)
    if (best === -1) {
      if (tries > maximumTries) searchCounts.endedByTries++
      else if (cost === maximumCost) searchCounts.endedByCost++
      else searchCounts.endedWithNothingLeft++
      return undefined
    }
    searchCounts.repairs++
    const edits: Edit[] = []
    for (let node = best; node > 0; node = nodes.parent[node]!) edits.push(nodes.edit[node]!)
    return edits.reverse()
  }
  throw new Error('a search ended without a result')
}

type Stacks = {states: number[], firstToken: number[], lastToken: number[]}
type Reduction = {nonterminal: number, firstToken: number, lastToken: number}
const shifted = 1, accepted = 2, rejected = 0

// Feeds one terminal to the parser's stacks, as `feed` of ../../bars.ts does: reduces while the grammar's table
// says so, and shifts. Changes the stacks and adds to the reductions, also when the terminal is rejected.
function feed(stacks: Stacks, terminal: number, token: number, reductions: Reduction[]): number {
  const {states, firstToken, lastToken} = stacks
  for (;;) {
    const cell = states.at(-1)! * terminalCount + terminal
    if (frozen[cell] === 0) return rejected
    if (actionKind[cell] === actionAccept) return accepted
    if (actionKind[cell] === actionShift) {
      states.push(actionArgument[cell]!)
      firstToken.push(token)
      lastToken.push(token)
      return shifted
    }
    const rule = actionArgument[cell]!
    let first = -1, last = -1
    for (let dropped = 0; dropped < ruleLength[rule]!; dropped++) {
      states.pop()
      const lastBelow = lastToken.pop()!, firstBelow = firstToken.pop()!
      if (firstBelow === -1) continue
      first = firstBelow
      if (last === -1) last = lastBelow
    }
    states.push(gotoState[states.at(-1)! * nonterminalCount + ruleLhs[rule]! - terminalCount]!)
    firstToken.push(first)
    lastToken.push(last)
    reductions.push({nonterminal: ruleLhs[rule]!, firstToken: first, lastToken: last})
  }
}
const copyOf = (stacks: Stacks): Stacks => ({states: stacks.states.slice(), firstToken: stacks.firstToken.slice(), lastToken: stacks.lastToken.slice()})

// What the bar did at one rejected token, for reports and checks.
export type RepairRecord = {
  // The place of the rejected token among the tokens that are no white space and no comment, and the parser's
  // stack of states before it.
  errorPosition: number
  states: number[]
  // The edits of the search, or undefined when the search found none and the second phase dropped tokens and cut
  // the stack.
  edits: Edit[] | undefined
  droppedTokens: number
  cutStates: number
}

// The bar on one text, given by its tokens. `kindOfDropped[terminal]` is the display kind of a token that is
// taken out. `records`, when given, gets what was done at every rejected token.
export function cheapestRepair(sample: Pick<Sample, 'tokens'>, kindOfDropped: ArrayLike<number> = kindOfDroppedToken, settings: RepairSettings = standardSettings, records?: RepairRecord[]): ParserOutput {
  const {tokens} = sample
  const kind = new Int8Array(tokens.count), depth = new Int16Array(tokens.count), container = new Int8Array(tokens.count), stackHash = new Int32Array(tokens.count), taken = new Uint8Array(tokens.count)
  // The tokens that are no white space and no comment, as places in `tokens`, and their terminals with the end of
  // input after them.
  const tokenOf: number[] = [], terminals: number[] = []
  for (let token = 0; token < tokens.count; token++) {
    if (isTrivia(tokens.kind[token]!)) continue
    tokenOf.push(token)
    terminals.push(tokens.kind[token]!)
  }
  const end = terminals.length
  terminals.push(endSymbol)

  let stacks: Stacks = {states: [bison.startState], firstToken: [-1], lastToken: [-1]}
  let reductions: Reduction[] = []
  let insertedTokens = 0
  // The stacks before every token from `firstPosition` on, and the number of reductions made by then: what the
  // parser goes back to when a repair starts before the rejected token. A repair never starts before the end of
  // the repair before it.
  const stacksBefore: Stacks[] = [], reductionsBefore: number[] = []
  let firstPosition = 0
  const show = (position: number, shownKind: number, isTaken: boolean) => {
    const token = tokenOf[position]!
    kind[token] = shownKind
    taken[token] = isTaken ? 1 : 0
    depth[token] = depthOf(stacks.states)
    container[token] = containerOf(stacks.states)
    stackHash[token] = stackHashOf(stacks.states)
  }
  // Shifts the token at a place as a terminal, which the stack must take.
  const shift = (position: number, terminal: number) => {
    if (feed(stacks, terminal, tokenOf[position]!, reductions) !== shifted) throw new Error('a repair has a token that the parser does not shift')
    show(position, displayOfState[stacks.states.at(-1)!]!, true)
  }
  const drop = (position: number) => show(position, kindOfDropped[terminals[position]!]!, false)

  let position = 0
  for (;;) {
    stacksBefore[position] = copyOf(stacks)
    reductionsBefore[position] = reductions.length
    const attempt = copyOf(stacks), reductionsOfAttempt: Reduction[] = []
    const result = feed(attempt, terminals[position]!, position < end ? tokenOf[position]! : tokens.count, reductionsOfAttempt)
    if (result !== rejected) {
      stacks = attempt
      reductions.push(...reductionsOfAttempt)
      if (result === accepted) break
      show(position, displayOfState[stacks.states.at(-1)!]!, true)
      position++
      continue
    }
    const start = Math.max(firstPosition, position - settings.tokensBack)
    const edits = findRepair(terminals, position, start, at => stacksBefore[at]!.states, settings)
    if (edits !== undefined) {
      records?.push({errorPosition: position, states: stacks.states.slice(), edits, droppedTokens: 0, cutStates: 0})
      // Back to the stack before the first edit, then the edits with the tokens between them.
      let at = edits[0]!.position
      stacks = copyOf(stacksBefore[at]!)
      reductions = reductions.slice(0, reductionsBefore[at])
      for (const edit of edits) {
        for (; at < edit.position; at++) shift(at, terminals[at]!)
        if (edit.kind === editInsert) {
          if (feed(stacks, edit.terminal, -1, reductions) !== shifted) throw new Error('a repair puts in a terminal that the parser does not shift')
          insertedTokens++
        } else if (edit.kind === editDelete) drop(at++)
        else shift(at++, edit.terminal)
      }
      position = firstPosition = at
      continue
    }
    // The second phase: the fewest dropped tokens, and for them the highest part of the stack, after which the
    // parser shifts `shiftsNeeded` tokens or accepts the end. With every token dropped and the stack cut down to
    // the start state, the parser accepts the end, so the loop always finds a place.
    let droppedTokens = 0, height = stacks.states.length
    search: for (droppedTokens = 0; ; droppedTokens++) {
      if (position + droppedTokens > end) throw new Error('the second phase finds no place to go on')
      stackCount = 0
      stackOfKey.clear()
      for (height = stacks.states.length; height >= 1; height--) {
        if (droppedTokens === 0 && height === stacks.states.length) continue
        const from = position + droppedTokens
        const reach = reachOf(stackOfStates(stacks.states, height), from, terminals, from + settings.shiftsNeeded)
        if (reach === end + 1 || reach >= from + settings.shiftsNeeded) break search
      }
    }
    records?.push({errorPosition: position, states: stacks.states.slice(), edits: undefined, droppedTokens, cutStates: stacks.states.length - height})
    for (let dropped = 0; dropped < droppedTokens; dropped++) drop(position++)
    stacks.states.length = stacks.firstToken.length = stacks.lastToken.length = height
    firstPosition = position
  }

  // White space and comments: their own kinds, and the other values of the token before them.
  let lastDepth = 0, lastContainer = 0, lastHash = emptyStackHash
  for (let token = 0; token < tokens.count; token++) {
    if (!isTrivia(tokens.kind[token]!)) {
      lastDepth = depth[token]!
      lastContainer = container[token]!
      lastHash = stackHash[token]!
      continue
    }
    kind[token] = tokens.kind[token] === commentKind ? displayKind.comment : displayKind.whitespace
    depth[token] = lastDepth
    container[token] = lastContainer
    stackHash[token] = lastHash
  }
  return {kind, depth, container, stack: stackHash, taken, reductions, insertedTokens}
}

// The bar as one function for the final scoring: its output for each of the samples, in their order. 10,000
// samples take about 40 s in one thread.
export function outputsOfCheapestRepair(samples: readonly Pick<Sample, 'tokens'>[], settings: RepairSettings = standardSettings): ParserOutput[] {
  return samples.map(sample => cheapestRepair(sample, kindOfDroppedToken, settings))
}

// The bar's score on samples.
export const scoreOfCheapestRepair = (samples: readonly Sample[]): Score => scoreOutputs(samples, sample => cheapestRepair(sample))

if (import.meta.main) {
  refuseUnknownOptions('repair.ts', ['--validation'])
  const validation = loadSamples('validation', defaultSeed, numberOf('--validation', standardValidationCount))
  const started = performance.now()
  const score = scoreOfCheapestRepair(validation)
  console.log(`The cheapest repair on ${validation.length} validation samples, ${((performance.now() - started) / 1000).toFixed(1)} s:`)
  console.log(scoreHeader)
  console.log(scoreRow('a search for the cheapest repair', score))
  const {searches, repairs, endedByTries, endedByCost, endedWithNothingLeft, tries, mostTries} = searchCounts
  console.log(`${searches} rejected tokens, ${(searches / validation.length).toFixed(2)} per sample. The search found a repair at ${repairs}. It ended at the limit of tried edits at ${endedByTries}, at the limit of cost at ${endedByCost} and with nothing left to try at ${endedWithNothingLeft}: there the second phase went on. A search tried ${Math.round(tries / Math.max(1, searches))} edits on average and ${mostTries} at most.`)
}
