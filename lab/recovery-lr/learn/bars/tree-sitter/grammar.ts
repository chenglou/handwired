// miniml as a tree-sitter grammar, for tree-sitter 0.24.5: the rules of ../../../grammar/miniml.y one for one, so
// that a node of tree-sitter's tree is a reduction of bison's parser, e.g. a node `binding` is bison's `binding`.
// The grammar is written here as the JSON that `tree-sitter generate` takes, with functions that have the names
// of tree-sitter's own grammar.js: seq, choice, optional, prec.left, prec.right.
//
// Three things differ from miniml.y, and none of them changes which texts are programs:
// - Every token comes from scanner.c, which runs flex's table: tree-sitter's own scanner reads a keyword as a name
//   wherever the keyword cannot stand, so it would take `let then = 1`. The tokens have bison's names, e.g. LET.
// - tree-sitter has no rule that matches the empty text, so `definitions` and `parameters` have one item or more
//   here, and the rules that use them say `optional`.
// - The precedence of a rule is written at the rule. bison compares a rule with the next token, and tree-sitter
//   compares a rule with the rules that the next token goes on in. Both settle every conflict the same way, e.g.
//   in `if a then b else c + d` the `+` goes on in `c + d`.
//
// build.ts runs `tree-sitter generate` on the JSON. check.ts holds the rules against bison's and compares the
// parser with bison's on valid and on broken texts.

type Rule =
  | {type: 'SYMBOL', name: string}
  | {type: 'BLANK'}
  | {type: 'PATTERN', value: string}
  | {type: 'SEQ', members: Rule[]}
  | {type: 'CHOICE', members: Rule[]}
  | {type: 'PREC' | 'PREC_LEFT' | 'PREC_RIGHT', value: number, content: Rule}

const symbol = (name: string): Rule => ({type: 'SYMBOL', name})
const optional = (name: string): Rule => ({type: 'CHOICE', members: [symbol(name), {type: 'BLANK'}]})
// The symbols of a right side one after another. A name with `?` is a symbol that may be left out, e.g.
// seq('IDENT', 'parameters?', 'EQ', 'expr').
const seq = (...names: string[]): Rule => {
  const members = names.map(name => name.endsWith('?') ? optional(name.slice(0, -1)) : symbol(name))
  return members.length === 1 ? members[0]! : {type: 'SEQ', members}
}
const choice = (...members: Rule[]): Rule => ({type: 'CHOICE', members})
const prec = {
  plain: (value: number, content: Rule): Rule => ({type: 'PREC', value, content}),
  left: (value: number, content: Rule): Rule => ({type: 'PREC_LEFT', value, content}),
  right: (value: number, content: Rule): Rule => ({type: 'PREC_RIGHT', value, content}),
}

// The scanner's tokens in the order of bison's numbers, then the comment. scanner.c returns a token as its place
// in this list, and build.ts checks the order against the tables.
export const tokenNames = [
  'LET', 'REC', 'IN', 'IF', 'THEN', 'ELSE', 'FUN', 'TRUE', 'FALSE', 'IDENT', 'INT', 'STRING', 'ARROW', 'EQ', 'NE', 'LT', 'LE', 'GT', 'GE', 'PLUS', 'MINUS', 'STAR', 'SLASH', 'CONS', 'AND', 'OR',
  'CARET', 'LPAREN', 'RPAREN', 'LBRACK', 'RBRACK', 'COMMA', 'SEMI', 'UNDERSCORE',
  // Text that is no token of the language. No rule has them, so the parser has to recover at each one.
  'BADCHAR', 'BADSTRING', 'BADCOMMENT',
  'COMMENT',
] as const

// The precedence declarations of miniml.y, lowest first. `lowest` is the precedence of `let .. in e`,
// `fun .. -> e` and both forms of `if`: what follows them belongs to them.
const precedence = {lowest: 1, or: 2, and: 3, comparison: 4, caret: 5, cons: 6, sum: 7, product: 8, negation: 9}
const operation = (operator: string): Rule => seq('expr', operator, 'expr')

export const grammar = {
  name: 'miniml',

  externals: tokenNames.map(symbol),

  // scanner.c passes over white space itself. The pattern is here for the end of the text: there scanner.c has no
  // token to give, and tree-sitter's own scanner has to get past the white space before the end.
  extras: [symbol('COMMENT'), {type: 'PATTERN', value: '[ \\t\\r\\n]'}] satisfies Rule[],

  // The first rule is the start.
  rules: {
    program: optional('definitions'),

    definitions: choice(seq('definition'), seq('definitions', 'definition')),

    definition: choice(seq('LET', 'binding'), seq('LET', 'REC', 'binding')),

    binding: choice(seq('IDENT', 'parameters?', 'EQ', 'expr'), seq('UNDERSCORE', 'EQ', 'expr'), seq('LPAREN', 'RPAREN', 'EQ', 'expr')),

    parameters: choice(seq('parameter'), seq('parameters', 'parameter')),

    parameter: choice(seq('IDENT'), seq('UNDERSCORE'), seq('LPAREN', 'RPAREN')),

    expr: choice(
      prec.right(precedence.lowest, seq('LET', 'binding', 'IN', 'expr')),
      prec.right(precedence.lowest, seq('LET', 'REC', 'binding', 'IN', 'expr')),
      prec.right(precedence.lowest, seq('FUN', 'parameter', 'parameters?', 'ARROW', 'expr')),
      // Both forms of `if` have one precedence and group from the right, so an `else` goes to the nearest `if`.
      prec.right(precedence.lowest, seq('IF', 'expr', 'THEN', 'expr')),
      prec.right(precedence.lowest, seq('IF', 'expr', 'THEN', 'expr', 'ELSE', 'expr')),
      prec.right(precedence.or, operation('OR')),
      prec.right(precedence.and, operation('AND')),
      prec.left(precedence.comparison, operation('EQ')),
      prec.left(precedence.comparison, operation('NE')),
      prec.left(precedence.comparison, operation('LT')),
      prec.left(precedence.comparison, operation('LE')),
      prec.left(precedence.comparison, operation('GT')),
      prec.left(precedence.comparison, operation('GE')),
      prec.right(precedence.caret, operation('CARET')),
      prec.right(precedence.cons, operation('CONS')),
      prec.left(precedence.sum, operation('PLUS')),
      prec.left(precedence.sum, operation('MINUS')),
      prec.left(precedence.product, operation('STAR')),
      prec.left(precedence.product, operation('SLASH')),
      prec.plain(precedence.negation, seq('MINUS', 'expr')),
      seq('application'),
    ),

    application: choice(seq('atom'), seq('application', 'atom')),

    atom: choice(
      seq('INT'),
      seq('STRING'),
      seq('IDENT'),
      seq('TRUE'),
      seq('FALSE'),
      seq('LPAREN', 'RPAREN'),
      seq('LPAREN', 'expr', 'RPAREN'),
      seq('LPAREN', 'expr', 'COMMA', 'tuple_rest', 'RPAREN'),
      seq('LBRACK', 'RBRACK'),
      seq('LBRACK', 'elements', 'RBRACK'),
    ),

    tuple_rest: choice(seq('expr'), seq('tuple_rest', 'COMMA', 'expr')),

    elements: choice(seq('expr'), seq('elements', 'SEMI', 'expr')),
  } satisfies Record<string, Rule>,
}

// The right sides of a rule of the grammar, each as the names of its symbols, with every `optional` written out
// as two right sides, e.g. [['IDENT', 'parameters', 'EQ', 'expr'], ['IDENT', 'EQ', 'expr'], ...] for `binding`.
// check.ts compares them with bison's rules.
export function rightSidesOf(rule: Rule): string[][] {
  if (rule.type === 'SYMBOL') return [[rule.name]]
  if (rule.type === 'BLANK') return [[]]
  if (rule.type === 'PATTERN') throw new Error('a rule of the grammar has a pattern')
  if (rule.type === 'CHOICE') return rule.members.flatMap(rightSidesOf)
  if (rule.type === 'SEQ') return rule.members.reduce<string[][]>((starts, member) => starts.flatMap(start => rightSidesOf(member).map(rest => [...start, ...rest])), [[]])
  return rightSidesOf(rule.content)
}
