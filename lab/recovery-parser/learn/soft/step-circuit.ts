// One step of the twin as a Handwired circuit, built with the repo's runtime: the cells' mixes and the state before
// the step are source cells, the state after and everything else the step computes are wires, and every operation is
// a product of two wires or a weighted sum. check-circuit.ts compares its values and its gradients with twin.ts.
//
// The code point's class is a one-hot of source cells here, so the circuit holds every tokenizer cell and the host
// only writes the class. The softmax that turns weights into mixes is not part of the circuit: the mixes are its
// inputs. The mixes of the display table's entries are source cells only when the shape has open entries, and the
// bit "first on its line" is one only when the shape has 16 contexts.
import {type Terms, type Wire, Circuit} from '../../../../src/runtime/numeric-ui-core.ts'
import {maximumDepth} from '../recovery-parser.ts'
import {actionByToken, actionCount, actionNone, actionOfToken, actionPop, actionPushArray, actionPushObject, classNames, today, tokenNames} from '../recovery-tables.ts'
import type {TwinShape} from './twin.ts'

export function buildStepCircuit(shape: TwinShape, depthLow: number, depthHigh: number, readsObjects = true) {
  const {classCount, lexerStateCount, eventCount, tokenCount, contextCount, grammarStateCount, displayKindCount, lexerCells, grammarCells, displayEntries, tokenOfEvent, display, displayMixed} = shape
  const depthCount = depthHigh - depthLow + 1
  const hasFirstOnLine = contextCount > today.contextCount
  // The source cells, in this order.
  let sourceSize = 0
  const take = (count: number) => {
    const first = sourceSize
    sourceSize += count
    return first
  }
  const sources = {
    lexerBefore: take(lexerStateCount), characterClass: take(classCount), grammarBefore: take(grammarStateCount), depthBefore: take(depthCount),
    // The share of "this level is an object" for the levels 1 to 16: level l is at objectsBefore + l - 1.
    objectsBefore: take(maximumDepth),
    lexerNext: take(lexerCells * lexerStateCount), lexerEvent: take(lexerCells * eventCount), grammarNext: take(grammarCells * grammarStateCount), grammarAction: take(grammarCells * actionCount),
    display: take(displayMixed.includes(1) ? displayEntries * displayKindCount : 0), firstOnLineBefore: take(hasFirstOnLine ? 1 : 0),
  }
  const circuit = new Circuit(sourceSize)
  for (let cell = 0; cell < sourceSize; cell++) circuit.assumeRange(circuit.source(cell), 0, 1)
  const source = (first: number, entry: number) => circuit.source(first + entry)
  const sum = (terms: Terms, bias = 0) => circuit.affine(terms, bias)
  // The product of two wires, built once per pair.
  const products = new Map<string, Wire>()
  const product = (left: Wire, right: Wire) => {
    const key = left < right ? `${left} ${right}` : `${right} ${left}`
    let wire = products.get(key)
    if (wire === undefined) {
      wire = circuit.multiply(left, right)
      products.set(key, wire)
    }
    return wire
  }
  const ones = (wires: readonly Wire[]): Terms => wires.map(wire => [wire, 1] as const)

  // The tokenizer.
  const eventTerms: Wire[][] = Array.from({length: eventCount}, () => [])
  const lexerAfterTerms: Wire[][] = Array.from({length: lexerStateCount}, () => [])
  for (let state = 0; state < lexerStateCount; state++) {
    for (let characterClass = 0; characterClass < classCount; characterClass++) {
      const share = product(source(sources.lexerBefore, state), source(sources.characterClass, characterClass))
      const cell = state * classCount + characterClass
      for (let event = 0; event < eventCount; event++) eventTerms[event]!.push(product(share, source(sources.lexerEvent, cell * eventCount + event)))
      for (let next = 0; next < lexerStateCount; next++) lexerAfterTerms[next]!.push(product(share, source(sources.lexerNext, cell * lexerStateCount + next)))
    }
  }
  const events = eventTerms.map(terms => sum(ones(terms)))
  const lexerAfter = lexerAfterTerms.map(terms => sum(ones(terms)))
  const tokens = Array.from({length: tokenCount}, (_, token) => sum(ones(events.filter((_, event) => tokenOfEvent[event] === token))))

  // The context.
  const depthClassOf = (index: number) => today.depthClass[Math.max(0, Math.min(maximumDepth, depthLow + index))]!
  const levelOf = (index: number) => depthLow + index <= 0 ? 0 : Math.min(maximumDepth, depthLow + index)
  const depthBefore = Array.from({length: depthCount}, (_, index) => source(sources.depthBefore, index))
  const objectBefore = (level: number) => source(sources.objectsBefore, level - 1)
  const contexts: Wire[] = []
  for (let depthClass = 0; depthClass < today.contextCount / 2; depthClass++) {
    const depths = depthBefore.filter((_, index) => depthClassOf(index) === depthClass)
    const objectTerms: Wire[] = []
    if (readsObjects) for (let index = 0; index < depthCount; index++) if (depthClassOf(index) === depthClass && levelOf(index) > 0) objectTerms.push(product(depthBefore[index]!, objectBefore(levelOf(index))))
    contexts.push(sum([...ones(depths), ...objectTerms.map(wire => [wire, -1] as const)]), sum(ones(objectTerms)))
  }
  // The bit "first on its line": its share of every context goes to the context with the bit, 8 further on. After
  // the step the bit is 1 at a line feed, and otherwise the bit before times the share of the token `none`.
  const firstOnLineAfter: Wire[] = []
  if (hasFirstOnLine) {
    const bit = source(sources.firstOnLineBefore, 0)
    const withBit = contexts.map(context => product(context, bit))
    contexts.splice(0, contexts.length, ...contexts.map((context, index) => sum([[context, 1], [withBit[index]!, -1]])), ...withBit)
    const lineFeed = source(sources.characterClass, classNames.indexOf('lineFeed'))
    const kept = product(bit, tokens[tokenNames.indexOf('none')]!)
    firstOnLineAfter.push(sum([[lineFeed, 1], [kept, 1], [product(kept, lineFeed), -1]]))
  }

  // The grammar.
  const grammarAfterTerms: Wire[][] = Array.from({length: grammarStateCount}, () => [])
  const actionTerms: Wire[][] = Array.from({length: actionCount}, () => [])
  for (let state = 0; state < grammarStateCount; state++) {
    for (let token = 0; token < tokenCount; token++) {
      const stateToken = product(source(sources.grammarBefore, state), tokens[token]!)
      for (let context = 0; context < contextCount; context++) {
        const share = product(stateToken, contexts[context]!)
        const cell = (state * tokenCount + token) * contextCount + context
        for (let next = 0; next < grammarStateCount; next++) grammarAfterTerms[next]!.push(product(share, source(sources.grammarNext, cell * grammarStateCount + next)))
        for (let action = 0; action < actionCount; action++) {
          // The share of `by token` goes to what the token does.
          actionTerms[action === actionByToken ? actionOfToken[token]! : action]!.push(product(share, source(sources.grammarAction, cell * actionCount + action)))
        }
      }
    }
  }
  const grammarAfter = grammarAfterTerms.map(terms => sum(ones(terms)))
  const actions = [actionNone, actionPushArray, actionPushObject, actionPop].map(action => sum(ones(actionTerms[action]!)))
  const [, pushArray, pushObject, pop] = actions as [Wire, Wire, Wire, Wire]

  // The depth and the levels' kinds.
  const push = sum([[pushArray, 1], [pushObject, 1]])
  const stay = sum([[pushArray, -1], [pushObject, -1], [pop, -1]], 1)
  const last = depthCount - 1
  const depthAfter = depthBefore.map((before, index) => sum(ones([
    product(stay, before),
    index > 0 ? product(push, depthBefore[index - 1]!) : product(pop, before),
    index < last ? product(pop, depthBefore[index + 1]!) : product(push, before),
  ])))
  const objectsAfter = Array.from({length: maximumDepth}, (_, levelIndex) => {
    const level = levelIndex + 1
    const below = depthBefore[level - 1 - depthLow]!
    return sum([[objectBefore(level), 1], [product(objectBefore(level), product(below, push)), -1], [product(below, pushObject), 1]])
  })

  // The display kind and the container after.
  const kindTerms: Wire[][] = Array.from({length: displayKindCount}, () => [])
  for (let event = 0; event < eventCount; event++) {
    for (let next = 0; next < grammarStateCount; next++) {
      // The share of the pair goes to the entry's kind, or is split by the entry's mix when the entry is open.
      const entry = event * grammarStateCount + next
      const pair = product(events[event]!, grammarAfter[next]!)
      if (displayMixed[entry] === 0) kindTerms[display[entry]!]!.push(pair)
      else for (let kind = 0; kind < displayKindCount; kind++) kindTerms[kind]!.push(product(pair, source(sources.display, entry * displayKindCount + kind)))
    }
  }
  const kinds = kindTerms.map(terms => sum(ones(terms)))
  const inContainer = depthAfter.filter((_, index) => levelOf(index) > 0)
  const inObject = depthAfter.flatMap((after, index) => levelOf(index) > 0 ? [product(after, objectsAfter[levelOf(index) - 1]!)] : [])
  // In the order of containerNone, containerObject and containerArray.
  const containers = [sum(ones(depthAfter.filter((_, index) => levelOf(index) === 0))), sum(ones(inObject)), sum([...ones(inContainer), ...inObject.map(wire => [wire, -1] as const)])]

  return {circuit, sourceSize, sources, depthCount, outputs: {events, tokens, contexts, lexerAfter, grammarAfter, actions, depthAfter, objectsAfter, firstOnLineAfter, kinds, containers}}
}
