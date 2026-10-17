// HELD BACK. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read
// this file, see ../README.md.
//
// What a kind of mistake works with: a valid program as the experiment's parser reads it, i.e. its tokens and its
// tree, and the edits that turn the program into a broken text and into the valid program that the broken text's
// author meant.
//
// The two texts of a sample. A kind makes a mistake in a valid program. The broken text is that program with the
// mistake. The original of the sample is the valid program that a repair of the broken text gives, by the rules
// that ../written/REPAIR.md has for the written set. It is the program that the kind was given, with one
// difference: a whole token that is missing stands right before the next token that the broken text has, after
// the white space between them (rule 4 there). E.g. for
//     let half = width / 2 in⏎  half * height       with the `in` forgotten:
//     let half = width / 2⏎  half * height          the broken text
//     let half = width / 2⏎  in half * height       the original
// A parser only learns that a token is missing when it reads the next token, and white space has the depth and
// the container that the token before it left. With the `in` at the end of its line, the line break would be
// labelled as "after `in`", which no parser can show that reads from left to right.
import {type TreeNode, type ValidLabels, labelsOfValidText, treeOf} from '../../labels.ts'
import {commentKind, isTrivia, ruleText, tables} from '../../tables.ts'

export type Token = {
  // The place among the program's tokens, without white space and comments.
  index: number
  // The terminal's name in the grammar, e.g. 'LET', 'IDENT', 'LPAREN'.
  terminal: string
  text: string
  // The first code point, and the one after the last.
  start: number
  end: number
}

export type Node = {
  // The rule of a reduction, e.g. 'expr: IF expr THEN expr ELSE expr', and the terminal's name for a token.
  shape: string
  token: Token | undefined
  children: Node[]
  parent: Node | undefined
  // The first and the last token under the node. Both are undefined for a node without tokens, e.g. an empty
  // list of parameters.
  first: Token | undefined
  last: Token | undefined
}

export type Program = {
  text: string
  labels: ValidLabels
  tokens: Token[]
  comments: {start: number, end: number, text: string}[]
  // Every node of the tree, parents before children.
  nodes: Node[]
  // The top-level definitions, each a node 'definition: LET binding' or 'definition: LET REC binding'.
  definitions: Node[]
}

// Reads a valid program whose characters are all in the basic plane, so that a place in the text is a code point.
export function readProgram(text: string): Program {
  const labels = labelsOfValidText(text)
  if (labels.codePoints.length !== text.length) throw new Error('the program holds a character outside the basic plane')
  const tokens: Token[] = [], comments: Program['comments'] = []
  const tokenAt = new Map<number, Token>()
  for (let place = 0; place < labels.tokens.count; place++) {
    const kind = labels.tokens.kind[place]!, start = labels.tokens.start[place]!, end = start + labels.tokens.length[place]!
    if (kind === commentKind) comments.push({start, end, text: text.slice(start, end)})
    if (isTrivia(kind)) continue
    const token = {index: tokens.length, terminal: tables.symbolNames[kind]!, text: text.slice(start, end), start, end}
    tokens.push(token)
    tokenAt.set(place, token)
  }
  const nodes: Node[] = []
  const nodeOf = (tree: TreeNode, parent: Node | undefined): Node => {
    const token = tree.rule === -1 ? tokenAt.get(tree.token)! : undefined
    const node: Node = {shape: tree.rule === -1 ? token!.terminal : ruleText(tree.rule), token, children: [], parent, first: token, last: token}
    nodes.push(node)
    node.children = tree.children.map(child => nodeOf(child, node))
    if (token === undefined) {
      node.first = node.children.find(child => child.first !== undefined)?.first
      node.last = node.children.findLast(child => child.last !== undefined)?.last
    }
    return node
  }
  nodeOf(treeOf(labels), undefined)
  return {text, labels, tokens, comments, nodes, definitions: nodes.filter(node => node.shape.startsWith('definition: '))}
}

export const nodesOfShape = (program: Program, ...shapes: string[]): Node[] => program.nodes.filter(node => shapes.includes(node.shape))
// The child of a node that is the given token, e.g. the THEN of a conditional.
export const tokenOf = (node: Node, terminal: string): Token => {
  const token = node.children.find(child => child.shape === terminal)?.token
  if (token === undefined) throw new Error(`a node ${node.shape} has no ${terminal}`)
  return token
}
// The text that a node covers.
export const textOfNode = (program: Program, node: Node): string => program.text.slice(node.first!.start, node.last!.end)
// The top-level definition that a node is a part of, or undefined for a node above the definitions.
export function definitionOf(node: Node): Node | undefined {
  let current: Node | undefined = node
  while (current !== undefined && !current.shape.startsWith('definition: ')) current = current.parent
  return current
}

// Whether a line feed stands between the token and the next token, or the token is the program's last one.
export function isLastOnLine(program: Program, token: Token): boolean {
  const next = program.tokens[token.index + 1]
  return next === undefined || program.text.slice(token.end, next.start).includes('\n')
}
export function isFirstOnLine(program: Program, token: Token): boolean {
  const previous = program.tokens[token.index - 1]
  return previous === undefined || program.text.slice(previous.end, token.start).includes('\n')
}
// The start of the line that a place is on, and the place of the line feed that ends it, or the text's end.
export const lineStartOf = (program: Program, place: number): number => program.text.lastIndexOf('\n', place - 1) + 1
export function lineEndOf(program: Program, place: number): number {
  const end = program.text.indexOf('\n', place)
  const at = end === -1 ? program.text.length : end
  // Before the carriage return of a line that ends with one.
  return at > place && program.text[at - 1] === '\r' ? at - 1 : at
}
// The white space that the line of a place starts with.
export const indentationAt = (program: Program, place: number): string => /^[ \t]*/.exec(program.text.slice(lineStartOf(program, place)))![0]
// The line end that the program is written with.
export const lineEndOfProgram = (program: Program): string => program.text.includes('\r\n') ? '\r\n' : '\n'

// One change to a program: the code points from `at` on, `remove` of them, are replaced by `original` in the
// original of the sample and by `broken` in the broken text. Every code point of `broken` counts as added.
// E.g. {at: 9, remove: 1, original: ';', broken: ','} for a comma in the place of a list's `;`.
export type Edit = {at: number, remove: number, original: string, broken: string}

// Text that the broken text has and the original does not.
export const added = (at: number, text: string): Edit => ({at, remove: 0, original: '', broken: text})
// Text of the program that the broken text writes another way.
export const written = (program: Program, from: number, to: number, text: string): Edit => ({at: from, remove: to - from, original: program.text.slice(from, to), broken: text})
// A part of a token that the broken text lacks, e.g. the closing quote of a string. For a whole token, see missing.
export const lacking = (program: Program, from: number, to: number): Edit => written(program, from, to, '')

// The tokens from `first` to `last` are missing in the broken text, e.g. a forgotten `then`, or the end of a
// definition that was never typed. Of the white space on the two sides of the tokens, one side goes with them:
// the side before them when they end their line, so that the next line keeps its indentation, and the side
// after them otherwise. A side with a comment stays. In the original, the tokens stand right before the next
// token that the broken text has, see the top of this file, with a space after them unless they end in a closing
// bracket.
// Returns undefined where the alignment of the sample would not say what the kind means: the next token starts
// with the code point that the missing tokens start with. The sample keeps the earlier of two equal code points,
// so the `i` of a missing `in` before `if` would be kept, as a part of the `if`.
export function missing(program: Program, first: Token, last: Token = first): Edit[] | undefined {
  const {text, tokens} = program
  const before = tokens[first.index - 1], after = tokens[last.index + 1]
  const run = text.slice(first.start, last.end)
  const endOfBefore = before?.end ?? 0, startOfAfter = after?.start ?? text.length
  const gapBefore = text.slice(endOfBefore, first.start), gapAfter = text.slice(last.end, startOfAfter)
  const closesBracket = last.terminal === 'RPAREN' || last.terminal === 'RBRACK'
  const hasComment = (gap: string): boolean => gap.includes('(*')
  if (after === undefined) {
    // After the program's last token, the missing tokens stand at the very end.
    const from = before !== undefined && gapAfter !== '' && !hasComment(gapBefore) ? endOfBefore : first.start
    return [{at: from, remove: last.end - from, original: '', broken: ''}, {at: text.length, remove: 0, original: run, broken: ''}]
  }
  // Of two equal closing brackets side by side, the sample calls the later one the missing one, so the later
  // one is the one that gets its place here.
  if (closesBracket && first === last && after.text === last.text && gapAfter === '') return missing(program, after)
  if (after.text[0] === run[0]) return undefined
  // No space where the tokens stood right before the next one, or end in a bracket.
  const inOriginal = closesBracket || last.terminal === 'LPAREN' || last.terminal === 'LBRACK' || gapAfter === '' ? run : `${run} `
  if (gapBefore !== '' && before !== undefined && gapAfter.includes('\n') && !hasComment(gapBefore)) {
    // The white space before the tokens goes with them.
    return [{at: endOfBefore, remove: last.end - endOfBefore, original: '', broken: ''}, {at: startOfAfter, remove: 0, original: inOriginal, broken: ''}]
  }
  if (gapAfter !== '' && (gapBefore !== '' || before === undefined) && !hasComment(gapAfter) && !gapAfter.includes('\n')) {
    // The white space after the tokens goes with them.
    return [{at: first.start, remove: startOfAfter - first.start, original: inOriginal, broken: ''}]
  }
  // Both sides stay. Two tokens that the missing ones kept apart must not read as one.
  if (gapBefore === '' && gapAfter === '' && before !== undefined && /[A-Za-z0-9_']$/.test(before.text) && /^[A-Za-z0-9_']/.test(after.text)) return undefined
  if (gapAfter === '') return [{at: first.start, remove: last.end - first.start, original: inOriginal, broken: ''}]
  return [{at: first.start, remove: last.end - first.start, original: '', broken: ''}, {at: startOfAfter, remove: 0, original: inOriginal, broken: ''}]
}

export type TwoTexts = {original: string, broken: string, alignment: number[]}

// The original and the broken text that edits give, with the alignment: for every code point of the broken text
// its place in the original, or -1 for an added one. Returns undefined when two edits touch the same place.
export function applyEdits(program: Program, edits: readonly Edit[]): TwoTexts | undefined {
  const {text} = program
  const sorted = [...edits].sort((left, right) => left.at - right.at || left.remove - right.remove)
  let original = '', broken = ''
  const alignment: number[] = []
  let place = 0
  const keepUpTo = (upTo: number) => {
    for (; place < upTo; place++) {
      alignment.push(original.length)
      original += text[place]
      broken += text[place]
    }
  }
  for (let index = 0; index < sorted.length; index++) {
    const edit = sorted[index]!
    // Two edits may meet at a place only as the two halves that `missing` returns, which never happens between
    // the edits of two kinds: those need a kept code point between them.
    if (edit.at < place || (index > 0 && edit.at === place && sorted[index - 1]!.at + sorted[index - 1]!.remove === place && sorted[index - 1]!.remove === 0)) return undefined
    keepUpTo(edit.at)
    original += edit.original
    for (let count = 0; count < edit.broken.length; count++) alignment.push(-1)
    broken += edit.broken
    place += edit.remove
  }
  keepUpTo(text.length)
  return {original, broken, alignment}
}
