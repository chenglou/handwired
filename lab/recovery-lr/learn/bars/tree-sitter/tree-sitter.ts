// The bar "tree-sitter": what tree-sitter 0.24.5 makes of a broken text, scored like every other parser.
//
// tree-sitter parses miniml by grammar.ts, which has bison's rules one for one, and reads the tokens of flex's
// table (scanner.c). When it meets an error it goes on with several stacks at a time, each with another repair, and
// keeps the cheapest: it skips tokens, drops what it has parsed, or puts in a token that is not there. Its tree
// holds every token of the text. What the parser could not place lies in error nodes, e.g. the `)` of `1 ) + 2`
// is `(expr (expr ..) (ERROR (RPAREN)) (PLUS) (expr ..))`, and a token that the parser put in is a node without text.
//
// The three values per token are read off the tree by one mapping, which outputOfTree holds:
//
// 1. The stack of a token is what stands to its left in the tree and is not closed yet: for every node from the
//    root down to the token, the children before the one that leads to the token, each as one symbol. A token is
//    its terminal, and a child with children of its own is its nonterminal, e.g. `expr`. For the `c` of
//    `let x = if a then b else c` the stack is `definitions LET IDENT parameters EQ IF expr THEN expr ELSE IDENT`.
//    This is the stack that bison's parser has right after it shifts the token, with three additions for the
//    empty rules, which tree-sitter's grammar cannot have and bison reduces before the next token: `definitions`
//    lies below everything, `parameters` lies after the name of a binding, and `parameters` lies after the first
//    parameter of a `fun`.
// 2. The display kind, the depth, the container and the hash of the stack are those of ../../../labels.ts for
//    this stack, e.g. the depth is the number of `(`, `[`, `let`, `if` and `fun` on it.
// 3. White space and comments have their own kinds and the other values of the token before them.
// 4. A token that the parser put in is on the stack as its terminal, e.g. a `then` that is not in the text is the
//    container of what follows it.
// 5. An error node stands on the stack that the parser had when it read the node's first token: the stack that
//    the token before it left, after the reductions that the grammar's table makes at that first token, and
//    without them when the table has no action for it there. The node's place in the tree does not say this:
//    tree-sitter moves an error node of skipped tokens, like a comment, to the right of every node that closes
//    after it, e.g. the `#` of `let x = 1 #` and a next `let` ends up after the whole definition, which was still
//    open at the `#`. Inside the error node the children before a token are on the stack. When the error node
//    ends, everything in it leaves the stack, as the parser has dropped it, and the stack is again point 1's.
// 6. A token that lies in an error node without a node between is a dropped token: the stack does not count as
//    holding it, and its display kind is the one that the most train code points of dropped tokens of its terminal
//    want (dropped-kinds.json), as for every bar that drops tokens.
//
// On a valid program the mapping gives the labels exactly, with the hash of the stack and the constituents:
// check.ts compares them. Every node that is no error node counts as a constituent, with its nonterminal and the
// tokens of the text that it covers.
//
//   bun lab/recovery-lr/learn/bars/tree-sitter/tree-sitter.ts [--validation <samples>]
import {join} from 'node:path'
import {defaultSeed, loadSamples} from '../../../dataset.ts'
import {containerOfSymbols, depthOfSymbols, displayKind, emptyStackHash, kindOfTerminal, noSymbol, stackHashOfSymbols} from '../../../labels.ts'
import type {Tokens} from '../../../parser.ts'
import type {Sample} from '../../../sample.ts'
import {actionReduce, commentKind, isTrivia, symbolOf, tables} from '../../../tables.ts'
import {numberOf, refuseUnknownOptions, standardValidationCount} from '../../options.ts'
import {type ParserOutput, type Score, addOutputToScore, emptyScore, scoreHeader, scoreRow} from '../../score.ts'
import {readDroppedKinds} from '../repair/dropped-kinds.ts'
import {type Tree, commentNode, errorNode, treesOf} from './trees.ts'

// [terminal]: the display kind of a token that lies in an error node, see point 6 and ../repair/dropped-kinds.ts.
export const kindOfDroppedToken = readDroppedKinds(join(import.meta.dir, 'dropped-kinds.json'))

const letTerminal = symbolOf('LET'), recTerminal = symbolOf('REC'), funTerminal = symbolOf('FUN'), identifierTerminal = symbolOf('IDENT')
const definitionsSymbol = symbolOf('definitions'), parametersSymbol = symbolOf('parameters'), parameterSymbol = symbolOf('parameter')

export type MappingOptions = {
  // [terminal]: the display kind of a token that lies in an error node without a node between.
  kindOfDropped: ArrayLike<number>
  // Point 5 of the mapping another way, for a comparison: an error node stands on the stack of its place in the
  // tree, as every other node does.
  errorNodesByTheirPlace?: boolean
}

// The stack that bison's parser has when it reads a terminal after a token that left the stack `symbols`: the
// symbols after the reductions that the grammar's table makes at the terminal. The symbols as they are when the
// table has no action for the terminal there, or when they are no stack of bison's parser.
function stackWhenReading(symbols: readonly number[], terminal: number): readonly number[] {
  const states = [tables.startState]
  for (const symbol of symbols) {
    const next = tables.transition[states.at(-1)! * tables.symbolCount + symbol]!
    if (next === -1) return symbols
    states.push(next)
  }
  const reduced = symbols.slice()
  for (;;) {
    const cell = states.at(-1)! * tables.terminalCount + terminal
    if (tables.frozen[cell] === 0) return symbols
    if (tables.actionKind[cell] !== actionReduce) return reduced
    const rule = tables.actionArgument[cell]!
    states.length -= tables.ruleLength[rule]!
    reduced.length -= tables.ruleLength[rule]!
    states.push(tables.gotoState[states.at(-1)! * tables.nonterminalCount + tables.ruleLhs[rule]! - tables.terminalCount]!)
    reduced.push(tables.ruleLhs[rule]!)
  }
}

// What tree-sitter's tree says of every token of a text, by the mapping at the top of this file. Throws when a
// token of the tree is no token of `tokens`, which are the scanner's tokens of the same text.
export function outputOfTree(tokens: Tokens, tree: Tree, options: MappingOptions): ParserOutput {
  const kind = new Int8Array(tokens.count), depth = new Int16Array(tokens.count), container = new Int8Array(tokens.count), stackHash = new Int32Array(tokens.count), taken = new Uint8Array(tokens.count)
  const reductions: {nonterminal: number, firstToken: number, lastToken: number}[] = []
  let insertedTokens = 0
  // The place in `tokens` of the token that starts at a code point.
  const tokenAt = new Map<number, number>()
  for (let token = 0; token < tokens.count; token++) tokenAt.set(tokens.start[token]!, token)
  // The node after the last node of every node's subtree.
  const subtreeEnd = new Int32Array(tree.nodeCount)
  {
    const open: number[] = [], left: number[] = []
    for (let node = 0; node < tree.nodeCount; node++) {
      open.push(node)
      left.push(tree.childCount[node]!)
      while (open.length > 0 && left.at(-1) === 0) {
        subtreeEnd[open.pop()!] = node + 1
        left.pop()
        if (left.length > 0) left[left.length - 1]!--
      }
    }
    if (open.length > 0) throw new Error('the nodes of a tree do not add up to their counts of children')
  }

  const stack: number[] = []
  // What bison has reduced before it reads the next token, see point 1.
  const beforeNextSymbol = () => {
    const top = stack.at(-1), below = stack.at(-2)
    if (top === undefined) stack.push(definitionsSymbol)
    else if (top === identifierTerminal && (below === letTerminal || below === recTerminal)) stack.push(parametersSymbol)
    else if (top === parameterSymbol && below === funTerminal) stack.push(parametersSymbol)
  }
  // The values of the token that was shown last, for the white space and the comments after it, and the stack
  // that the last token left, for an error node after it.
  let lastDepth = 0, lastContainer = 0, lastHash = emptyStackHash
  let stackAfterLastToken: readonly number[] = []
  let nextToken = 0
  const showTrivia = (upTo: number) => {
    for (; nextToken < upTo; nextToken++) {
      if (!isTrivia(tokens.kind[nextToken]!)) throw new Error(`token ${nextToken} of the text is not in the tree`)
      kind[nextToken] = tokens.kind[nextToken] === commentKind ? displayKind.comment : displayKind.whitespace
      depth[nextToken] = lastDepth
      container[nextToken] = lastContainer
      stackHash[nextToken] = lastHash
    }
  }

  // Goes through the subtree of a node, and returns the first and the last token of the text that it covers, as
  // places in `tokens`, -1 for none. `inError` says that the node's parent is an error node.
  const visit = (node: number, inError: boolean): {firstToken: number, lastToken: number} => {
    const symbol = tree.symbol[node]!
    if (symbol === commentNode) return {firstToken: -1, lastToken: -1}
    if (tree.childCount[node] === 0) {
      if (symbol === errorNode || symbol >= tables.terminalCount) throw new Error('a node without children is no token')
      beforeNextSymbol()
      const symbolBelow = stack.at(-1) ?? noSymbol
      stack.push(symbol)
      stackAfterLastToken = stack.slice()
      if (tree.missing[node] === 1) {
        insertedTokens++
        return {firstToken: -1, lastToken: -1}
      }
      const token = tokenAt.get(tree.start[node]!)
      if (token === undefined || tokens.kind[token] !== symbol || tokens.start[token]! + tokens.length[token]! !== tree.end[node]) throw new Error(`the tree has a token at code point ${tree.start[node]} that is no token of the text`)
      showTrivia(token)
      nextToken = token + 1
      kind[token] = inError ? options.kindOfDropped[symbol]! : kindOfTerminal(symbol, symbolBelow)
      taken[token] = inError ? 0 : 1
      depth[token] = lastDepth = depthOfSymbols(stack)
      container[token] = lastContainer = containerOfSymbols(stack)
      stackHash[token] = lastHash = stackHashOfSymbols(stack)
      return {firstToken: token, lastToken: token}
    }
    // The children of a node one after another. Returns the tokens of the text that they cover.
    const visitChildren = (): {firstToken: number, lastToken: number} => {
      let firstToken = -1, lastToken = -1
      let firstChild = true
      for (let child = node + 1; child < subtreeEnd[node]!; child = subtreeEnd[child]!) {
        if (tree.symbol[child] === commentNode) continue
        // The first item of a list stands on the empty list.
        if (firstChild && (symbol === definitionsSymbol || symbol === parametersSymbol) && tree.symbol[child] !== symbol) stack.push(symbol)
        firstChild = false
        const covered = visit(child, symbol === errorNode)
        if (covered.firstToken === -1) continue
        if (firstToken === -1) firstToken = covered.firstToken
        lastToken = covered.lastToken
      }
      return {firstToken, lastToken}
    }
    if (symbol === errorNode) {
      // Point 5: the error node's children stand on the stack as it was at the node's first token, and leave it at
      // the end.
      const outside = stack.slice()
      // The node's first token: the first node of its subtree that has no children and is no comment.
      let firstLeaf = node + 1
      while (firstLeaf < subtreeEnd[node]! && (tree.childCount[firstLeaf]! > 0 || tree.symbol[firstLeaf] === commentNode)) firstLeaf++
      const standsOn = options.errorNodesByTheirPlace === true ? outside : firstLeaf === subtreeEnd[node] ? stackAfterLastToken : stackWhenReading(stackAfterLastToken, tree.symbol[firstLeaf]!)
      stack.splice(0, stack.length, ...standsOn)
      const covered = visitChildren()
      stack.splice(0, stack.length, ...outside)
      stackAfterLastToken = standsOn
      return covered
    }
    beforeNextSymbol()
    // A list goes on from the list before it: `definitions definition` and `parameters parameter`.
    if ((symbol === definitionsSymbol || symbol === parametersSymbol) && stack.at(-1) === symbol) stack.pop()
    const height = stack.length
    const covered = visitChildren()
    stack.length = height
    stack.push(symbol)
    reductions.push({nonterminal: symbol, ...covered})
    return covered
  }
  // The root is `program`, which bison only reduces at the end of the text: its children stand on the empty stack.
  // Where the parser could place nothing, the root is an error node.
  const root = tree.symbol[0]
  if (root === undefined || (root !== symbolOf('program') && root !== errorNode)) throw new Error('the root of a tree is no program and no error node')
  let firstToken = -1, lastToken = -1
  for (let child = 1; child < tree.nodeCount; child = subtreeEnd[child]!) {
    const covered = visit(child, root === errorNode)
    if (covered.firstToken === -1) continue
    if (firstToken === -1) firstToken = covered.firstToken
    lastToken = covered.lastToken
  }
  if (root !== errorNode) reductions.push({nonterminal: root, firstToken, lastToken})
  showTrivia(tokens.count)
  return {kind, depth, container, stack: stackHash, taken, reductions, insertedTokens}
}

// The bar as one function for the final scoring: tree-sitter's output for each of the samples, in their order.
// All texts go through the parser in batches of one process, so 10,000 samples take about a second. Builds the
// parser of build.ts when it has to, which needs tree-sitter 0.24.5 and RECOVERY_LR_SCRATCH.
export function outputsOfTreeSitter(samples: readonly Pick<Sample, 'codePoints' | 'tokens'>[], options: MappingOptions = {kindOfDropped: kindOfDroppedToken}): ParserOutput[] {
  const trees = treesOf(samples.map(sample => sample.codePoints))
  return samples.map((sample, index) => outputOfTree(sample.tokens, trees[index]!, options))
}

// The bar's score on samples.
export function scoreOfTreeSitter(samples: readonly Sample[]): Score {
  const score = emptyScore()
  for (const [index, output] of outputsOfTreeSitter(samples).entries()) addOutputToScore(score, samples[index]!, output)
  return score
}

if (import.meta.main) {
  refuseUnknownOptions('tree-sitter.ts', ['--validation'])
  const validation = loadSamples('validation', defaultSeed, numberOf('--validation', standardValidationCount))
  const started = performance.now()
  const score = scoreOfTreeSitter(validation)
  console.log(`tree-sitter on ${validation.length} validation samples, ${((performance.now() - started) / 1000).toFixed(1)} s for the trees, the mapping and the score:`)
  console.log(scoreHeader)
  console.log(scoreRow('tree-sitter 0.24.5', score))
}
