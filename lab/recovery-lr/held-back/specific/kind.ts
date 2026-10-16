// HELD BACK. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read
// this file, see ../README.md.
//
// What a kind of mistake is, and what the kinds share.
import type {Random} from '../../random.ts'
import type {Edit, Node, Program, Token} from './reading.ts'

// One mistake in one program: the edits, and which form of the kind it is, e.g. "before `let`".
export type Mistake = {edits: Edit[], form: string}

// Whether a parser of the experiment's form can show every scored code point of a sample of the kind right. Such
// a parser reads the scanner's tokens from left to right, follows bison's table up to the first error, and from
// there on holds one choice per cell of state and token, from the list of DESIGN.md point 4, and one display kind
// per pair of token and state on top. It does not look ahead.
// - 'yes': some table can, for every sample of the kind. The cells that it needs may be needed otherwise by
//   another kind.
// - 'partly': in some forms or at some places, see `why`.
// - 'no': never, see `why`.
export type Reach = {answer: 'yes' | 'partly' | 'no', why: string}

export type Kind = {
  name: string
  // One line that says what the author did.
  description: string
  // A short pair for the README: what was meant and what was typed.
  example: {meant: string, broken: string}
  // How often the kind is drawn, relative to the others.
  weight: number
  // What the mistake does to the program, which check-specific.ts holds every sample against:
  // - 'adds': the broken text is the original with text added. Every code point of the original is kept.
  // - 'lacks': the broken text is the original with text missing. No code point of the broken text is added.
  // - 'both': text of the original is written another way.
  changes: 'adds' | 'lacks' | 'both'
  // True for a kind that leaves a valid program when it is the only mistake, so it is only drawn as the second
  // kind of a sample with two.
  onlyWithAnotherKind?: boolean
  reach: Reach
  // The mistake in the program, or undefined when the program has no place for it.
  apply: (program: Program, random: Random) => Mistake | undefined
}

export const pickOf = <Item>(random: Random, items: readonly Item[]): Item | undefined => items.length === 0 ? undefined : random.pick(items)

// What a token is in the words of a form, e.g. "`let`" or "a name".
export function inWords(token: Token | undefined): string {
  if (token === undefined) return 'the end of the program'
  if (token.terminal === 'IDENT') return 'a name'
  if (token.terminal === 'INT') return 'a number'
  if (token.terminal === 'STRING') return 'a string'
  return `\`${token.text}\``
}
// The tokens of a list or a tuple that separate its items: the `;` or `,` between its two brackets that are in
// no other bracket.
export function separatorsOf(program: Program, node: Node): Token[] {
  const separators: Token[] = []
  let depth = 0
  for (let index = node.first!.index + 1; index < node.last!.index; index++) {
    const token = program.tokens[index]!
    if (token.terminal === 'LPAREN' || token.terminal === 'LBRACK') depth++
    else if (token.terminal === 'RPAREN' || token.terminal === 'RBRACK') depth--
    else if (depth === 0 && (token.terminal === 'SEMI' || token.terminal === 'COMMA')) separators.push(token)
  }
  return separators
}

export const listShape = 'atom: LBRACK elements RBRACK', tupleShape = 'atom: LPAREN expr COMMA tuple_rest RPAREN', bracketsShape = 'atom: LPAREN expr RPAREN'
export const conditionalShapes = ['expr: IF expr THEN expr', 'expr: IF expr THEN expr ELSE expr'], conditionalWithElse = 'expr: IF expr THEN expr ELSE expr'
export const localShapes = ['expr: LET binding IN expr', 'expr: LET REC binding IN expr']
export const functionShape = 'expr: FUN parameter parameters ARROW expr'
export const bindingShapes = ['binding: IDENT parameters EQ expr', 'binding: UNDERSCORE EQ expr', 'binding: LPAREN RPAREN EQ expr']
export const namedBinding = 'binding: IDENT parameters EQ expr'

// The parameters of a binding with a name or of a function, as their nodes.
export function parametersOf(node: Node): Node[] {
  const list = (parameters: Node): Node[] => parameters.children.length === 0 ? [] : [...list(parameters.children[0]!), parameters.children[1]!]
  if (node.shape === namedBinding) return list(node.children[1]!)
  if (node.shape === functionShape) return [node.children[1]!, ...list(node.children[2]!)]
  return []
}

// Whether the binding is a definition at the top, and not a local one.
export const isAtTop = (binding: Node): boolean => binding.parent!.shape.startsWith('definition: ')

// Short remarks and sentences that the kinds add.
export const remarks = [
  'TODO: check the bounds', 'in cents', 'fixme', 'see issue 42', 'do not change', 'temporary', 'the default', 'kept for old callers', 'per item, not per order', 'used in tests',
  'only if positive', 'same as before', 'needs a review', 'slow but simple', 'remove later', 'from the old version', 'ask Maria first', "don't touch",
] as const
export const sentencesBefore = [
  'Here is the code:', 'Sure, here is the fixed version:', 'This should work:', 'Try this one.', "Here's what I have so far:", 'The module now looks like this:', 'Updated as requested:',
  'I rewrote the helpers, see below.', 'Here is the complete file.', 'The corrected program:', 'Okay, second attempt:', 'I moved the constants up and kept the rest.',
  'Certainly! Here is the program in miniml:', 'Fixed. The change is in the second definition:', 'See if this is what you meant.',
] as const
export const sentencesAfter = [
  'Let me know if you need anything else.', 'Hope this helps!', 'This passes all the tests.', 'Note that the last definition is new.', 'I left the names as they were.',
  'Tell me if the output should look different.', 'The other files need no change.', 'This version handles the empty case too.',
] as const
