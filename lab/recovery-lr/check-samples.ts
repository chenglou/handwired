// Checks the labels, the neutral damage, the samples and the dataset:
// 1. The display kind of a state's token is the one that its terminal and the symbol below give, for every state
//    that a terminal leads into and every state that can lie below it.
// 2. On valid programs, the labels are derived a second way. The reductions give the tree, the tree gives the
//    symbols on the stack at every token (for every node above the token, its children to the left), and the
//    symbols give the kind, the depth, the container and the hash.
// 3. A few texts with their labels written out.
// 4. The neutral damage: what each of the ten edits does, and how often each is drawn.
// 5. The samples: what sample.ts promises of every field, on train and validation samples and on pairs by hand.
//    And the two columns from end to end: a parser that makes the one known repair of a text has every label,
//    every hash of the stack and exactly the sample's constituents.
// 6. The dataset: the same seed gives the same samples, and no validation program has the tokens of a train program.
//
// Run from the repo root: bun lab/recovery-lr/check-samples.ts
import {damageProgram, editNames} from './damage.ts'
import {defaultSeed, loadSamples, programAt, sampleAt, splitOf, splitOfTokens} from './dataset.ts'
import {randomSentence, textOfTerminals} from './explore.ts'
import {
  type TreeNode, type ValidLabels, containerNames, containerOf, containerOfSymbols, depthOf, depthOfSymbols, displayKind, displayKindNames, displayOfState, dumpLabels, emptyStackHash, kindOfTerminal,
  labelsOfTokens, labelsOfValidText, noSymbol, stackHashOf, stackHashOfSymbols, stackSymbolsOfValidText, symbolsOf, treeOf,
} from './labels.ts'
import {codePointsOf, firstOnLineOf, maximumCodePoints, parse, scan} from './parser.ts'
import {createRandom} from './random.ts'
import {type Sample, alignmentOfTexts, canonicalAlignment, constituentCounts, constituentOfKey, isScored, makeSample, restrictedConstituents} from './sample.ts'
import {actionReduce, actionShift, commentKind, isTrivia, symbolOf, tables} from './tables.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 20) console.log(`PROBLEM: ${text}`)
}
const expect = (condition: boolean, text: () => string) => {
  if (!condition) problem(text())
}
const {stateCount, symbolCount, terminalCount, transition, accessingSymbol, symbolNames} = tables

// 1. The display table of the states against kindOfTerminal.
{
  let entries = 0, pairs = 0
  for (let state = 0; state < stateCount; state++) {
    if (displayOfState[state] === -1) continue
    entries++
    const terminal = accessingSymbol[state]!
    for (let below = 0; below < stateCount; below++) {
      if (transition[below * symbolCount + terminal] !== state) continue
      pairs++
      const symbolBelow = below === tables.startState ? noSymbol : accessingSymbol[below]!
      expect(kindOfTerminal(terminal, symbolBelow) === displayOfState[state], () => `state ${state}: its token is a ${displayKindNames[displayOfState[state]!]}, and ${symbolNames[terminal]} after ${symbolNames[symbolBelow]} is a ${displayKindNames[kindOfTerminal(terminal, symbolBelow)]}`)
    }
  }
  expect(entries === 52, () => `${entries} states are entered by a terminal, and the README states 52`)
  console.log(`1. ${entries} states are entered by a token. For each of the ${pairs} pairs of such a state and a state below it, the kind is the one of the terminal and the symbol below.`)
}

// 2. The labels from the tree.
function checkLabelsByTree(text: string, labels: ValidLabels): number {
  const {tokens} = labels
  // Per token, the symbols on the stack right after its shift: for every node above the token, from the root, the
  // symbols of its children to the left of the path, and then the token's own terminal.
  const symbolsOfToken = new Map<number, number[]>()
  const walk = (node: TreeNode, before: number[]) => {
    if (node.token !== -1) {
      symbolsOfToken.set(node.token, [...before, node.symbol])
      return
    }
    let left = before
    for (const child of node.children) {
      walk(child, left)
      left = [...left, child.symbol]
    }
  }
  walk(treeOf(labels), [])
  let symbols: number[] = []
  let checked = 0
  for (let token = 0; token < tokens.count; token++) {
    const trivia = isTrivia(tokens.kind[token]!)
    if (!trivia) {
      const found = symbolsOfToken.get(token)
      if (found === undefined) {
        problem(`${JSON.stringify(text)}: token ${token} is not in the tree`)
        return checked
      }
      symbols = found
    }
    const kind = trivia ? (tokens.kind[token] === commentKind ? displayKind.comment : displayKind.whitespace) : kindOfTerminal(tokens.kind[token]!, symbols.at(-2) ?? noSymbol)
    const depth = depthOfSymbols(symbols), container = containerOfSymbols(symbols), hash = stackHashOfSymbols(symbols)
    for (let place = tokens.start[token]!; place < tokens.start[token]! + tokens.length[token]!; place++) {
      checked++
      if (labels.kind[place] !== kind || labels.depth[place] !== depth || labels.container[place] !== container || labels.stack[place] !== hash) {
        problem(`${JSON.stringify(text)}: code point ${place} has the labels ${displayKindNames[labels.kind[place]!]}, ${labels.depth[place]}, ${containerNames[labels.container[place]!]}, and the tree gives ${displayKindNames[kind]}, ${depth}, ${containerNames[container]}, or another stack`)
        return checked
      }
    }
  }
  return checked
}
{
  let programs = 0, checked = 0, tokenCount = 0
  const programCount = 3000, sentenceCount = 3000
  for (let index = 0; index < programCount; index++) {
    const {text, labels} = programAt(defaultSeed, index)
    checked += checkLabelsByTree(text, labels)
    programs++
    tokenCount += labels.tokens.count
  }
  for (let index = 0; programs < programCount + sentenceCount; index++) {
    const random = createRandom(defaultSeed + 5, index)
    const text = textOfTerminals(randomSentence(random, random.integer(3, 14), random.integer(4, 60)))
    if (Array.from(text).length > maximumCodePoints) continue
    checked += checkLabelsByTree(text, labelsOfValidText(text))
    programs++
  }
  // The functions over states against the functions over symbols, on the stacks of the same programs.
  let stacks = 0
  for (let index = 0; index < 500; index++) {
    const {labels} = programAt(defaultSeed, index)
    parse(labels.tokens, labels.codePoints.length, {shift: (_token, _state, stack) => {
      stacks++
      const symbols = symbolsOf(stack)
      expect(depthOf(stack) === depthOfSymbols(symbols) && containerOf(stack) === containerOfSymbols(symbols) && stackHashOf(stack) === stackHashOfSymbols(symbols), () => `a stack of program ${index} has other values by its states than by its symbols`)
    }})
  }
  expect(stackHashOf([tables.startState]) === emptyStackHash, () => 'the hash of the empty stack')
  console.log(`2. ${programs} valid programs (${programCount} generated, ${sentenceCount} sentences of the grammar): the four labels of all ${checked} code points are the ones that the tree gives. ${stacks} stacks have the same values by their states and by their symbols.`)
}

// 3. Labels written out: the text, the kinds (see kindLetters), the depths and the containers (see containerLetters).
{
  const written: [text: string, kinds: string, depths: string, containers: string][] = [
    // The brackets of the parameter () open a depth as every bracket does, and the space after them still has it.
    ['let rec f x _ () = x', 'kkkwkkkwdwawawppwpwn', '11111111111111222111', 'llllllllllllll(((==='],
    ['(* c *) let y = if a = 1 then (a, "s") else fun z -> [z; -2]\n', 'cccccccwkkkwdwpwkkwnwowlwkkkkwpnpwssspwkkkkwkkkwawppwpnpwolpw', '0000000011111111222222222222223333333332222233333333344444444', '........llllll==iiiiiiiiittttt(((((((((eeeeeffffff>>>[[[[[[[['],
    ['let _ = let z = f 1 in z + 2', 'kkkwdwpwkkkwdwpwnwlwkkwnwowl', '1111111122222222222222222222', 'llllll==llllll======nnnnnnnn'],
    ['let x = (1)\n\nlet y = 2', 'kkkwdwpwplpwwkkkwdwpwl', '1111111122222111111111', 'llllll==(((((llllll==='],
  ]
  for (const [text, kinds, depths, containers] of written) {
    const dump = dumpLabels(labelsOfValidText(text)).split('\n')
    expect(dump[1] === kinds && dump[2] === depths && dump[3] === containers, () => `the labels of ${JSON.stringify(text)} are\n${dump.slice(1).join('\n')}\nand written out are\n${kinds}\n${depths}\n${containers}`)
  }
  const stackOfOne = stackSymbolsOfValidText('let x = (1)')[7]?.join(' ')
  expect(stackOfOne === 'definitions LET IDENT parameters EQ LPAREN INT', () => `the stack at the 1 of let x = (1) is ${stackOfOne}`)
  const firstOnLine = Array.from(firstOnLineOf(scan(codePointsOf('let x =\n  1 (* c\n *) + 2\n')))).join('')
  // The 1 is the first token on its line. The + is not: the line feed before it is inside a comment. The end of input is.
  expect(firstOnLine === '0000000100000001', () => `first on its line: ${firstOnLine}`)
  console.log(`3. ${written.length} texts have the labels that are written out in this file.`)
}

// 4. The neutral damage. One edit at a time: `edits` of one entry, on generated programs.
{
  const counts = new Map<string, number>()
  const editCounts = [0, 0, 0, 0]
  let draws = 0
  const lineFeed = 10
  for (let index = 0; index < 4000; index++) {
    const original = Array.from(programAt(defaultSeed, index).labels.codePoints)
    const random = createRandom(defaultSeed + 6, index)
    for (let copy = 0; copy < 5; copy++) {
      const {codePoints, alignment, edits} = damageProgram(original, random)
      draws++
      editCounts[edits.length]!++
      for (const edit of edits) counts.set(edit, (counts.get(edit) ?? 0) + 1)
      // The kept code points are the original's, in rising places.
      let last = -1
      for (const [place, counterpart] of alignment.entries()) {
        if (counterpart === -1) continue
        expect(counterpart > last && original[counterpart] === codePoints[place], () => `damage of program ${index}: code point ${place} is no kept code point of the original`)
        last = counterpart
      }
      if (edits.length !== 1) continue
      const kept = alignment.filter(counterpart => counterpart !== -1)
      const addedPlaces = alignment.flatMap((counterpart, place) => counterpart === -1 ? [place] : [])
      const added = addedPlaces.map(place => codePoints[place]!)
      const keptSet = new Set(kept)
      const removedPlaces = original.flatMap((_, place) => keptSet.has(place) ? [] : [place])
      const contiguous = (places: number[]): boolean => places.every((place, at) => at === 0 || place === places[at - 1]! + 1)
      const fail = (why: string) => problem(`damage of program ${index}, "${edits[0]}": ${why}`)
      switch (edits[0] as typeof editNames[number]) {
        case 'delete a code point':
          if (added.length !== 0 || removedPlaces.length !== 1) fail('not one code point less')
          break
        case 'insert a code point':
          if (added.length !== 1 || removedPlaces.length !== 0 || !original.includes(added[0]!)) fail('not one more code point of the program')
          break
        case 'replace a code point':
          if (added.length !== 1 || removedPlaces.length !== 1 || addedPlaces[0] !== removedPlaces[0] || added[0] === original[removedPlaces[0]!] || !original.includes(added[0]!)) fail('not one code point replaced by another one of the program')
          break
        case 'swap two code points': {
          // The code point that now comes first is kept, and the other one is added after it.
          const place = addedPlaces[0]!
          if (added.length !== 1 || removedPlaces.length !== 1 || removedPlaces[0] !== place - 1 || added[0] !== original[place - 1] || codePoints[place - 1] !== original[place] || added[0] === codePoints[place - 1]) fail('not two neighbours swapped')
          break
        }
        case 'delete a run':
          if (added.length !== 0 || removedPlaces.length < 2 || removedPlaces.length > 20 || !contiguous(removedPlaces)) fail('not a run of 2 to 20 code points less')
          break
        case 'duplicate a run': {
          const run = added.length
          if (run < 2 || run > 20 || removedPlaces.length !== 0 || !contiguous(addedPlaces) || added.some((codePoint, at) => codePoint !== codePoints[addedPlaces[0]! - run + at])) fail('the added run is no copy of the run before it')
          break
        }
        case 'copy a run': {
          const run = added.length
          let fromSomewhere = false
          for (let start = 0; start + run <= original.length; start++) if (added.every((codePoint, at) => codePoint === original[start + at])) fromSomewhere = true
          if (run < 2 || run > 20 || removedPlaces.length !== 0 || !contiguous(addedPlaces) || !fromSomewhere) fail('the added run is no run of the program')
          break
        }
        case 'delete a line': {
          const first = removedPlaces[0]!, last = removedPlaces.at(-1)!
          const wholeLine = removedPlaces.length > 0 && contiguous(removedPlaces) && (first === 0 || original[first - 1] === lineFeed) && (original[last] === lineFeed || last === original.length - 1)
            && removedPlaces.slice(0, -1).every(place => original[place] !== lineFeed)
          if (added.length !== 0 || !wholeLine) fail('not one line less')
          break
        }
        case 'duplicate a line': {
          // The copy follows its line. A last line without a line feed gets one before its copy.
          const start = addedPlaces[0]!
          const line = added[0] === lineFeed && added.at(-1) !== lineFeed ? added.slice(1) : added
          const isCopy = contiguous(addedPlaces) && line.every((codePoint, at) => codePoint === codePoints[start - line.length + at]) && (start - line.length === 0 || codePoints[start - line.length - 1] === lineFeed)
          if (removedPlaces.length !== 0 || added.length === 0 || !isCopy) fail('the added text is no copy of the line before it')
          break
        }
        case 'cut the tail':
          if (added.length !== 0 || removedPlaces.length === 0 || removedPlaces.at(-1) !== original.length - 1 || !contiguous(removedPlaces)) fail('not a tail less')
          break
      }
    }
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0)
  for (const name of editNames) {
    const share = (counts.get(name) ?? 0) / total
    expect(share > 0.09 && share < 0.11, () => `the edit "${name}" is ${(100 * share).toFixed(1)}% of the edits, and each of the ten has the same weight`)
  }
  const shares = editCounts.slice(1).map(count => count / draws)
  expect(Math.abs(shares[0]! - 0.6) < 0.02 && Math.abs(shares[1]! - 0.3) < 0.02 && Math.abs(shares[2]! - 0.1) < 0.02, () => `the shares of one, two and three edits are ${shares.map(share => share.toFixed(3)).join(', ')}`)
  console.log(`4. ${draws} draws of the damage: one, two and three edits in ${shares.map(share => `${(100 * share).toFixed(1)}%`).join(', ')}; each of the ten edits is ${(100 * Math.min(...editNames.map(name => (counts.get(name) ?? 0) / total))).toFixed(1)}% to ${(100 * Math.max(...editNames.map(name => (counts.get(name) ?? 0) / total))).toFixed(1)}% of the ${total} edits; every single edit does what its name says.`)
}

// 5. The samples.
function checkSample(sample: Sample, name: string) {
  const fail = (why: string) => problem(`sample ${name}: ${why}`)
  const original = codePointsOf(sample.original), broken = codePointsOf(sample.broken)
  const originalLabels = labelsOfValidText(sample.original)
  if (sample.original === sample.broken) fail('the broken text is the original')
  if (broken.length > maximumCodePoints || original.length > maximumCodePoints) fail('a text is too long')
  if (broken.length !== sample.codePoints.length || broken.some((codePoint, place) => codePoint !== sample.codePoints[place])) fail('codePoints are not the broken text')
  // The alignment: rising, the same code points, and in the form that keeps the earlier code point.
  let last = -1, scored = 0
  for (let place = 0; place < broken.length; place++) {
    const counterpart = sample.alignment[place]!
    if (counterpart === -1) {
      if (sample.labelKind[place] !== -1 || sample.labelDepth[place] !== -1 || sample.labelContainer[place] !== -1 || sample.labelStack[place] !== 0) fail(`the added code point ${place} has a label`)
      continue
    }
    if (counterpart <= last || original[counterpart] !== broken[place]) fail(`code point ${place} is no kept code point`)
    last = counterpart
    if (sample.labelKind[place] !== originalLabels.kind[counterpart] || sample.labelDepth[place] !== originalLabels.depth[counterpart] || sample.labelContainer[place] !== originalLabels.container[counterpart] || sample.labelStack[place] !== originalLabels.stack[counterpart]) {
      fail(`code point ${place} does not have the label of its counterpart`)
    }
    if (sample.labelKind[place] === displayKind.error) fail(`code point ${place} has the label "error"`)
    if (place >= sample.firstErrorPosition) scored++
  }
  const again = canonicalAlignment(original, broken, sample.alignment)
  if (again.some((counterpart, place) => counterpart !== sample.alignment[place])) fail('the alignment is not in its canonical form')
  if (scored !== sample.scored || scored === 0) fail(`scored is ${sample.scored}, and ${scored} kept code points come from the first error on`)
  // The first error: up to it every cell is frozen and every token is shifted, and its own first cell is open.
  const tokens = scan(broken)
  if (tokens.count !== sample.tokens.count || tokens.kind.some((kind, token) => kind !== sample.tokens.kind[token] || tokens.start[token] !== sample.tokens.start[token])) fail('tokens are not the scanner\'s')
  const stack = [tables.startState]
  let reached = false
  for (let token = 0; token <= tokens.count && !reached;) {
    if (token < tokens.count && isTrivia(tokens.kind[token]!)) {
      token++
      continue
    }
    const cell = stack.at(-1)! * terminalCount + (token < tokens.count ? tokens.kind[token]! : tables.endSymbol)
    if (tables.frozen[cell] === 0) {
      reached = true
      if (token !== sample.firstErrorToken) fail(`the first open cell is read at token ${token}, and firstErrorToken is ${sample.firstErrorToken}`)
      if (stack.length !== sample.startStack.length || stack.some((state, level) => state !== sample.startStack[level])) fail('startStack is not the stack at the first open cell')
    } else if (tables.actionKind[cell] === actionShift) {
      stack.push(tables.actionArgument[cell]!)
      token++
    } else if (tables.actionKind[cell] === actionReduce) {
      const rule = tables.actionArgument[cell]!
      stack.length -= tables.ruleLength[rule]!
      stack.push(tables.gotoState[stack.at(-1)! * tables.nonterminalCount + tables.ruleLhs[rule]! - terminalCount]!)
    } else break
  }
  if (!reached) fail('the broken text reads no open cell')
  if (sample.firstErrorToken >= tokens.count || sample.firstErrorPosition !== tokens.start[sample.firstErrorToken]) fail('firstErrorPosition is not the start of the first error\'s token')
  // The kept tokens: the same text as one token of the original, in rising places.
  let lastKept = -1
  for (let token = 0; token < tokens.count; token++) {
    const originalToken = sample.keptToken[token]!
    if (originalToken === -1) continue
    const text = String.fromCodePoint(...broken.slice(tokens.start[token], tokens.start[token]! + tokens.length[token]!))
    const start = originalLabels.tokens.start[originalToken]!
    const originalText = String.fromCodePoint(...original.slice(start, start + originalLabels.tokens.length[originalToken]!))
    if (text !== originalText || originalToken <= lastKept || isTrivia(tokens.kind[token]!) || sample.alignment[tokens.start[token]!] !== start) fail(`token ${token} is not the token ${originalToken} of the original`)
    lastKept = originalToken
  }
  // The constituents: sorted, without repeats, between two kept tokens, and each one a reduction of the original.
  const originalConstituents = new Set<string>()
  for (let reduction = 0; reduction < originalLabels.reductionCount; reduction++) {
    originalConstituents.add(`${tables.ruleLhs[originalLabels.reductionRule[reduction]!]} ${originalLabels.reductionFirstToken[reduction]} ${originalLabels.reductionLastToken[reduction]}`)
  }
  let previousKey = -1
  for (const key of sample.constituents) {
    const {nonterminal, firstToken, lastToken} = constituentOfKey(key)
    if (key <= previousKey || nonterminal < terminalCount || firstToken > lastToken || sample.keptToken[firstToken] === -1 || sample.keptToken[lastToken] === -1) {
      fail(`the constituent ${key} is out of order or not between two kept tokens`)
      continue
    }
    previousKey = key
    // Some reduction of the original to the nonterminal has these two as its first and last kept tokens.
    let found = false
    for (let reduction = 0; reduction < originalLabels.reductionCount && !found; reduction++) {
      if (tables.ruleLhs[originalLabels.reductionRule[reduction]!] !== nonterminal) continue
      const first = originalLabels.reductionFirstToken[reduction]!, lastOfReduction = originalLabels.reductionLastToken[reduction]!
      if (first === -1 || first > sample.keptToken[firstToken]! || lastOfReduction < sample.keptToken[lastToken]!) continue
      const keptInside = Array.from(sample.keptToken).filter(originalToken => originalToken >= first && originalToken <= lastOfReduction)
      found = keptInside[0] === sample.keptToken[firstToken] && keptInside.at(-1) === sample.keptToken[lastToken]
    }
    if (!found) fail(`the constituent ${symbolNames[nonterminal]} ${firstToken}..${lastToken} is no reduction of the original`)
  }
}
{
  const trainCount = 3000, validationCount = 400
  const train = loadSamples('train', defaultSeed, trainCount), validation = loadSamples('validation', defaultSeed, validationCount)
  for (const sample of [...train, ...validation]) checkSample(sample, sample.id)
  // What the parser as it is gives before the first error against the labels there: no table may change it.
  let keptBefore = 0, wrongBefore = 0, scored = 0, codePointCount = 0, keptTokens = 0, tokenCount = 0, constituents = 0
  for (const sample of train) {
    const {tokens} = sample
    codePointCount += sample.codePoints.length
    scored += sample.scored
    constituents += sample.constituents.length
    for (let token = 0; token < tokens.count; token++) {
      if (isTrivia(tokens.kind[token]!)) continue
      tokenCount++
      if (sample.keptToken[token] !== -1) keptTokens++
    }
    const kind = new Int8Array(sample.codePoints.length).fill(-1), depth = new Int16Array(sample.codePoints.length), container = new Int8Array(sample.codePoints.length)
    const fill = (token: number, tokenKind: number, stack: readonly number[]) => {
      for (let at = token; at < sample.firstErrorToken && (at === token || isTrivia(tokens.kind[at]!)); at++) {
        const from = tokens.start[at]!, to = from + tokens.length[at]!
        kind.fill(at === token && tokenKind !== -1 ? tokenKind : tokens.kind[at] === commentKind ? displayKind.comment : displayKind.whitespace, from, to)
        depth.fill(depthOf(stack), from, to)
        container.fill(containerOf(stack), from, to)
      }
    }
    if (tokens.count > 0 && isTrivia(tokens.kind[0]!)) fill(0, -1, [tables.startState])
    parse(tokens, sample.codePoints.length, {shift: (token, state, stack) => fill(token, displayOfState[state]!, stack)})
    for (let place = 0; place < sample.firstErrorPosition; place++) {
      if (sample.alignment[place] === -1) continue
      keptBefore++
      if (kind[place] !== sample.labelKind[place] || depth[place] !== sample.labelDepth[place] || container[place] !== sample.labelContainer[place]) wrongBefore++
    }
  }
  console.log(`5. ${trainCount} train and ${validationCount} validation samples hold what sample.ts says. A train sample has ${(codePointCount / trainCount).toFixed(0)} code points, of which ${(scored / trainCount).toFixed(0)} are scored, ${(tokenCount / trainCount).toFixed(0)} tokens, of which ${(keptTokens / trainCount).toFixed(0)} are kept tokens, and ${(constituents / trainCount).toFixed(0)} constituents.`)
  console.log(`   Before the first error, ${(100 * wrongBefore / keptBefore).toFixed(1)}% of the ${keptBefore} kept code points have another label than the parser gives there, which no table may change.`)

  // Pairs by hand.
  const identity = (text: string): number[] => Array.from(codePointsOf(text), (_, place) => place)
  const make = (original: string, broken: string, alignment: number[]) => makeSample({id: 'by hand', original, broken, alignment})
  // The = is missing: the first error is the 1, and the kept code points from there on are scored.
  const missingEquals = make('let x = 1 + 2', 'let x 1 + 2', [0, 1, 2, 3, 4, 5, 8, 9, 10, 11, 12])
  if (typeof missingEquals === 'string') problem(`let x 1 + 2 is no sample: ${missingEquals}`)
  else {
    checkSample(missingEquals, 'let x 1 + 2')
    expect(missingEquals.firstErrorPosition === 6 && missingEquals.scored === 5 && missingEquals.startStack.join() === '0,2,4,7', () => `let x 1 + 2: first error at ${missingEquals.firstErrorPosition}, ${missingEquals.scored} scored, start stack ${missingEquals.startStack.join()}`)
    expect(missingEquals.labelKind[6] === displayKind.constant && missingEquals.labelDepth[6] === 1 && containerNames[missingEquals.labelContainer[6]!] === '=', () => 'let x 1 + 2: the label of the 1')
    const names = Array.from(missingEquals.constituents, key => { const {nonterminal, firstToken, lastToken} = constituentOfKey(key); return `${symbolNames[nonterminal]} ${firstToken}-${lastToken}` }).join(', ')
    expect(names === 'program 0-8, definitions 0-8, definition 0-8, binding 2-8, expr 4-4, expr 4-8, expr 8-8, application 4-4, application 8-8, atom 4-4, atom 8-8', () => `let x 1 + 2: the constituents are ${names}`)
    // A parse that has the original's reductions over the kept tokens has every constituent, and one more reduction is one too many.
    const own = Array.from(missingEquals.constituents, constituentOfKey)
    const same = constituentCounts(missingEquals, restrictedConstituents(missingEquals, own))
    const more = constituentCounts(missingEquals, restrictedConstituents(missingEquals, [...own, {nonterminal: symbolOf('atom'), firstToken: 4, lastToken: 6}, {nonterminal: symbolOf('parameters'), firstToken: -1, lastToken: -1}]))
    expect(same.shared === 11 && same.recoveredCount === 11 && more.shared === 11 && more.recoveredCount === 12 && more.originalCount === 11, () => 'let x 1 + 2: the counts of constituents')
  }
  // Two readings of one text: of `))` the first bracket is the kept one, whichever the alignment says was removed.
  const withoutBracket = 'let x = ((1) let y = 3'
  for (const removed of [11, 12]) {
    const reading = make('let x = ((1)) let y = 3', withoutBracket, identity('let x = ((1)) let y = 3').filter(place => place !== removed))
    if (typeof reading === 'string') problem(`${withoutBracket} is no sample: ${reading}`)
    else {
      checkSample(reading, withoutBracket)
      expect(Array.from(reading.alignment).join() === '0,1,2,3,4,5,6,7,8,9,10,11,13,14,15,16,17,18,19,20,21,22', () => `${withoutBracket}: the alignment is ${Array.from(reading.alignment).join()}`)
      expect(reading.firstErrorPosition === 13 && reading.scored === 9, () => `${withoutBracket}: the first error is at ${reading.firstErrorPosition} with ${reading.scored} scored`)
    }
  }
  // An added bracket before a bracket: the second one is the added one.
  const addedBracket = make('let x = (f) let y = 3', 'let x = ((f) let y = 3', [0, 1, 2, 3, 4, 5, 6, 7, -1, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
  if (typeof addedBracket === 'string') problem(`let x = ((f) let y = 3 is no sample: ${addedBracket}`)
  else expect(Array.from(addedBracket.alignment).join() === '0,1,2,3,4,5,6,7,8,-1,9,10,11,12,13,14,15,16,17,18,19,20', () => `let x = ((f) let y = 3: the alignment is ${Array.from(addedBracket.alignment).join()}`)
  // A text whose error is at its end has nothing to score.
  expect(make('let x = f ((1)) 2', 'let x = f ((1) 2', identity('let x = f ((1)) 2').filter(place => place !== 14)) === 'nothing to score', () => 'let x = f ((1) 2 has its error at the end and is a sample')
  // An alignment from the two texts alone: it keeps as many code points as the damage's own, and for a text with
  // one edit it is the sample's alignment.
  let alignedLikeSample = 0, singleEdits = 0
  for (const sample of train.slice(0, 600)) {
    const aligned = alignmentOfTexts(sample.original, sample.broken)
    const keptBy = (alignment: ArrayLike<number>): number => Array.from(alignment).filter(counterpart => counterpart !== -1).length
    expect(keptBy(aligned) >= keptBy(sample.alignment), () => `sample ${sample.id}: the shortest edit script keeps fewer code points than the damage`)
    expect(Array.from(canonicalAlignment(codePointsOf(sample.original), sample.codePoints, aligned)).join() === Array.from(aligned).join(), () => `sample ${sample.id}: the alignment of the two texts is not in its canonical form`)
    if (sample.edits.length !== 1) continue
    singleEdits++
    if (Array.from(aligned).join() === Array.from(sample.alignment).join()) alignedLikeSample++
  }
  expect(Array.from(alignmentOfTexts('let x = (1, 2)', 'let x = (1; 2)')).join() === '0,1,2,3,4,5,6,7,8,9,-1,11,12,13', () => 'the alignment of let x = (1; 2)')
  expect(alignedLikeSample >= 0.95 * singleEdits, () => `of ${singleEdits} samples with one edit, the shortest edit script gives the sample's alignment in ${alignedLikeSample}`)
  // One repair is known: a `#` between two tokens of a valid program is to be skipped. A parser that skips it has
  // every label of the sample at every scored code point, also the stack's hash, and has the sample's constituents
  // and no others. This is how a parser that recovers is scored, with the labels and the places of the broken text.
  let repaired = 0
  for (let index = 0; index < 400; index++) {
    const {text, labels} = programAt(defaultSeed, index)
    const random = createRandom(defaultSeed + 8, index)
    const realTokens = Array.from({length: labels.tokens.count}, (_, token) => token).filter(token => !isTrivia(labels.tokens.kind[token]!))
    if (realTokens.length < 2) continue
    // After a token that is not the last one, so that code points are left to score.
    const after = random.pick(realTokens.slice(0, -1))
    const at = labels.tokens.start[after]! + labels.tokens.length[after]!
    const broken = `${String.fromCodePoint(...labels.codePoints.slice(0, at))} # ${String.fromCodePoint(...labels.codePoints.slice(at))}`
    const sample = makeSample({id: 'a # to skip', original: text, broken, alignment: alignmentOfTexts(text, broken)}, labels)
    if (typeof sample === 'string') {
      if (sample !== 'too long') problem(`program ${index} with a # after token ${after} is no sample: ${sample}`)
      continue
    }
    checkSample(sample, `program ${index} with a #`)
    // The tokens without the `#`, and their places in the sample's tokens.
    const places = Array.from({length: sample.tokens.count}, (_, token) => token).filter(token => token !== sample.firstErrorToken)
    const skipped = {count: places.length, kind: Int32Array.from(places, token => sample.tokens.kind[token]!), start: Int32Array.from(places, token => sample.tokens.start[token]!), length: Int32Array.from(places, token => sample.tokens.length[token]!)}
    const parsed = labelsOfTokens(sample.codePoints, skipped)
    for (let place = sample.firstErrorPosition; place < sample.codePoints.length; place++) {
      if (!isScored(sample, place)) continue
      if (parsed.kind[place] !== sample.labelKind[place] || parsed.depth[place] !== sample.labelDepth[place] || parsed.container[place] !== sample.labelContainer[place] || parsed.stack[place] !== sample.labelStack[place]) {
        problem(`program ${index} with a # after token ${after}: the parser that skips the # has another label at code point ${place}`)
        break
      }
    }
    const reductions = Array.from({length: parsed.reductionCount}, (_, reduction) => ({
      nonterminal: tables.ruleLhs[parsed.reductionRule[reduction]!]!,
      firstToken: parsed.reductionFirstToken[reduction] === -1 ? -1 : places[parsed.reductionFirstToken[reduction]!]!,
      lastToken: parsed.reductionLastToken[reduction] === -1 ? -1 : places[parsed.reductionLastToken[reduction]!]!,
    }))
    const counts = constituentCounts(sample, restrictedConstituents(sample, reductions))
    expect(counts.shared === counts.originalCount && counts.shared === counts.recoveredCount && counts.shared > 0, () => `program ${index} with a # after token ${after}: the parser that skips the # shares ${counts.shared} constituents, of ${counts.originalCount} and ${counts.recoveredCount}`)
    expect(sample.keptToken.every((originalToken, token) => (originalToken === -1) === (token === sample.firstErrorToken || isTrivia(sample.tokens.kind[token]!))), () => `program ${index} with a #: a token other than the # is no kept token`)
    repaired++
  }
  // What makeSample refuses, and what it throws on.
  expect(make('let x = 1', 'let x = 1', identity('let x = 1')) === 'unchanged', () => 'an unchanged text is a sample')
  expect(make('let x = 1', 'let x = 12', [...identity('let x = 1'), -1]) === 'still valid', () => 'a valid text is a sample')
  expect(make('let x = 1', `let x = 1${' '.repeat(510)}`, [...identity('let x = 1'), ...new Array<number>(510).fill(-1)]) === 'too long', () => 'a long text is a sample')
  const throws = (run: () => unknown): boolean => {
    try {
      run()
    } catch {
      return true
    }
    return false
  }
  expect(throws(() => make('let x = ', 'let x', identity('let x'))), () => 'an original that is no valid program is taken')
  expect(throws(() => make('let x = 1', 'let y = 1', identity('let x = 1'))), () => 'a kept code point that differs from its counterpart is taken')
  expect(throws(() => make('let x = 12', 'let x = 21', [0, 1, 2, 3, 4, 5, 6, 7, 9, 8])), () => 'an alignment that does not rise is taken')
  expect(throws(() => make('let x = 1', 'let x = ', [0, 1, 2, 3, 4, 5, 6])), () => 'an alignment of another length is taken')
  console.log(`   Pairs by hand give the samples that are written out in this file, and makeSample refuses or throws where it says. A shortest edit script of the two texts gives the sample's alignment for ${alignedLikeSample} of ${singleEdits} samples with one edit.`)
  console.log(`   ${repaired} programs with a # between two tokens: the parser that skips the # has every label, every hash of the stack and exactly the sample's constituents.`)
}

// 6. The dataset.
{
  // The same samples again, one by one and as a list.
  const first = loadSamples('train', defaultSeed, 300), second = loadSamples('train', defaultSeed, 300)
  expect(first.every((sample, place) => sample.id === second[place]!.id && sample.broken === second[place]!.broken && sample.alignment.join() === second[place]!.alignment.join()), () => 'two calls of loadSamples give other samples')
  for (const sample of first.slice(0, 50)) {
    const index = Number(sample.id.split(':')[1])
    const {sample: alone, split} = sampleAt(defaultSeed, index)
    expect(alone.broken === sample.broken && split === 'train' && splitOf(sample.original) === 'train', () => `sample ${sample.id} is another one when it is made alone`)
  }
  const other = loadSamples('train', defaultSeed + 1, 50)
  expect(other.every((sample, place) => sample.broken !== first[place]!.broken), () => 'another seed gives the same samples')
  // The splits by tokens: 8 of 9 programs are train programs, and no validation program has a train program's tokens.
  const tokensOf = (labels: ValidLabels): string => Array.from(labels.tokens.kind).filter(kind => !isTrivia(kind)).join(' ')
  const trainTokens = new Set<string>(), validationTokens = new Set<string>()
  let trainPrograms = 0
  const programCount = 9000
  for (let index = 0; index < programCount; index++) {
    const {labels} = programAt(defaultSeed, index)
    if (splitOfTokens(labels) === 'train') {
      trainPrograms++
      trainTokens.add(tokensOf(labels))
    } else validationTokens.add(tokensOf(labels))
  }
  let shared = 0
  for (const sequence of validationTokens) if (trainTokens.has(sequence)) shared++
  expect(shared === 0, () => `${shared} validation programs have the tokens of a train program`)
  expect(Math.abs(trainPrograms / programCount - 8 / 9) < 0.02, () => `${trainPrograms} of ${programCount} programs are train programs`)
  // Why a draw of the damage gives no sample.
  const reasons = new Map<string, number>()
  let draws = 0
  for (let index = 0; index < 3000; index++) {
    const {text, labels} = programAt(defaultSeed, index)
    const random = createRandom(defaultSeed + 7, index)
    for (let copy = 0; copy < 3; copy++) {
      const damaged = damageProgram(labels.codePoints, random)
      const result = makeSample({id: '', original: text, broken: String.fromCodePoint(...damaged.codePoints), alignment: damaged.alignment}, labels)
      const reason = typeof result === 'string' ? result : 'a sample'
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
      draws++
    }
  }
  console.log(`6. The same seed gives the same samples. ${trainPrograms} of ${programCount} programs are train programs (${trainTokens.size} and ${validationTokens.size} distinct lists of tokens, none in both).`)
  console.log(`   Of ${draws} draws of the damage: ${[...reasons].sort((left, right) => right[1] - left[1]).map(([reason, count]) => `${(100 * count / draws).toFixed(1)}% ${reason}`).join(', ')}.`)
}

if (problems.length > 20) console.log(`... and ${problems.length - 20} more problems`)
console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
