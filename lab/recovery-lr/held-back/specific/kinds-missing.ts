// HELD BACK. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read
// this file, see ../README.md.
//
// The kinds in which something is missing: a keyword, a sign, a bracket, a quote, an operand, the end of a
// definition. The `reach` of each kind is explained in README.md under "What a table can show".
import {type Kind, bindingShapes, bracketsShape, conditionalShapes, conditionalWithElse, functionShape, inWords, isAtTop, listShape, localShapes, pickOf, tupleShape} from './kind.ts'
import {type Node, type Program, type Token, isLastOnLine, lacking, missing, nodesOfShape, tokenOf} from './reading.ts'

// The form of a missing token: whether the next token can still be read as a part of what stands before it.
const formBefore = (program: Program, token: Token): string => `before ${inWords(program.tokens[token.index + 1])}`

// The expression that a node 'expr: ...' is the whole of: the binding, branch or body that it fills.
function fillsAWholePlace(expression: Node): boolean {
  const parent = expression.parent!
  if (parent.shape.startsWith('binding: ') || parent.shape === functionShape || localShapes.includes(parent.shape)) return parent.children.at(-1) === expression
  if (conditionalShapes.includes(parent.shape)) return parent.children[3] === expression || parent.children[5] === expression
  return parent.shape.startsWith('elements: ')
}

export const kindsOfMissing: Kind[] = [
  {
    name: 'missing in',
    description: 'The `in` of a local definition is left out.',
    example: {meant: 'let area w h =\n  let half = w / 2 in\n  let rest = h - 1 in\n  half * rest', broken: 'let area w h =\n  let half = w / 2\n  let rest = h - 1 in\n  half * rest'},
    weight: 1,
    changes: 'lacks',
    reach: {answer: 'partly', why: "Each form by itself, yes. Before `let`, `if` or `fun`: insert `in`. A body that starts with a name, a constant or a bracket is read as arguments, the first error is the next `let` at the top, and the open `let` is ended early there. No table does both: the two are one cell, a `let` after `let binding`."},
    apply: (program, random) => {
      const local = pickOf(random, nodesOfShape(program, ...localShapes))
      if (local === undefined) return undefined
      const token = tokenOf(local, 'IN')
      const edits = missing(program, token)
      return edits && {edits, form: formBefore(program, token)}
    },
  },
  {
    name: 'missing then',
    description: 'The `then` of a conditional is left out.',
    example: {meant: 'let sign n = if n < 0 then 0 - 1 else 1', broken: 'let sign n = if n < 0 0 - 1 else 1'},
    weight: 1,
    changes: 'lacks',
    reach: {answer: 'partly', why: "Insert `then` at a keyword. A branch that starts with a name, a constant or a bracket is read as arguments of the condition, and at the `else` a table inserts `then` and a name. No single choice at a `let` after a condition: it is the branch, or the next definition after a conditional without `else`."},
    apply: (program, random) => {
      const conditional = pickOf(random, nodesOfShape(program, ...conditionalShapes))
      if (conditional === undefined) return undefined
      const token = tokenOf(conditional, 'THEN')
      const edits = missing(program, token)
      return edits && {edits, form: formBefore(program, token)}
    },
  },
  {
    name: 'missing equals',
    description: 'The `=` of a binding is left out.',
    example: {meant: 'let limit = 10\nlet double n = n * 2', broken: 'let limit 10\nlet double n n * 2'},
    weight: 1,
    changes: 'lacks',
    reach: {answer: 'partly', why: "Insert `=` at the first token that is no parameter. A name at the start of the body was read as a parameter before the first error. No where the body starts with a bracket that holds another bracket: the `(` was read as the start of a parameter `()`, no choice gets an `=` in before it, and a skipped token has the depth of the stack."},
    apply: (program, random) => {
      const binding = pickOf(random, nodesOfShape(program, ...bindingShapes))
      if (binding === undefined) return undefined
      const token = tokenOf(binding, 'EQ')
      const edits = missing(program, token)
      return edits && {edits, form: `${isAtTop(binding) ? 'at the top' : 'in a local definition'}, ${formBefore(program, token)}`}
    },
  },
  {
    name: 'missing arrow',
    description: 'The `->` of a function is left out.',
    example: {meant: 'let twice = fun n -> n * 2', broken: 'let twice = fun n n * 2'},
    weight: 1,
    changes: 'lacks',
    reach: {answer: 'partly', why: "Insert `->` at the first token that is no parameter. As for a missing `=`, no where the body starts with a bracket that holds another bracket."},
    apply: (program, random) => {
      const fun = pickOf(random, nodesOfShape(program, functionShape))
      if (fun === undefined) return undefined
      const token = tokenOf(fun, 'ARROW')
      const edits = missing(program, token)
      return edits && {edits, form: formBefore(program, token)}
    },
  },
  {
    name: 'bracket left open',
    description: 'The closing `)` or `]` of a pair is left out.',
    example: {meant: 'let total = add (price * count) tax\nlet tax = 3', broken: 'let total = add (price * count tax\nlet tax = 3'},
    weight: 1.5,
    changes: 'lacks',
    reach: {answer: 'yes', why: "At the first token that cannot stand inside the bracket, e.g. the `let` of the next definition, insert the closing bracket. What stands between the place of the bracket and that token was read inside the bracket before the first error."},
    apply: (program, random) => {
      const pair = pickOf(random, nodesOfShape(program, bracketsShape, tupleShape, listShape))
      if (pair === undefined) return undefined
      const edits = missing(program, pair.last!)
      return edits && {edits, form: `a \`${pair.last!.text}\`${isLastOnLine(program, pair.last!) ? ' at a line end' : ''}`}
    },
  },
  {
    name: 'string left open',
    description: 'The closing quote of a string is left out.',
    example: {meant: 'let greeting = "hello"\nlet count = 3', broken: 'let greeting = "hello\nlet count = 3'},
    weight: 1,
    changes: 'lacks',
    reach: {answer: 'partly', why: "Yes where the string ends its line: the scanner cuts the open string at the line end, and the token is read as a string. No where more code follows on the line: the scanner takes it into the same token, up to the next quote or the line end, and a token has one display kind."},
    apply: (program, random) => {
      const strings = program.tokens.filter(token => token.terminal === 'STRING')
      const endingALine = strings.filter(token => isLastOnLine(program, token))
      const token = pickOf(random, endingALine.length > 0 && random.chance(0.6) ? endingALine : strings)
      if (token === undefined) return undefined
      return {edits: [lacking(program, token.end - 1, token.end)], form: isLastOnLine(program, token) ? 'the string ends its line' : 'more follows on the line'}
    },
  },
  {
    name: 'comment left open',
    description: 'The `*)` of a comment is left out.',
    example: {meant: 'let width = 80 (* columns *)\nlet height = 24', broken: 'let width = 80 (* columns\nlet height = 24'},
    weight: 0.5,
    changes: 'lacks',
    reach: {answer: 'no', why: "The scanner is frozen: it reads everything up to the next `*)` as the comment, or up to the end of the text as one token that is no comment. The code points in it have many labels, and a token has one."},
    apply: (program, random) => {
      const comment = pickOf(random, program.comments)
      if (comment === undefined || !comment.text.endsWith('*)') || comment.text.length < 5) return undefined
      const isLast = program.comments.at(-1) === comment
      return {edits: [lacking(program, comment.end - 2, comment.end)], form: isLast ? 'no comment follows' : 'a later comment closes it'}
    },
  },
  {
    name: 'missing operand',
    description: 'One side of an operator is left out.',
    example: {meant: 'let total = (price + tax) * count', broken: 'let total = (price + ) * count'},
    weight: 1.5,
    changes: 'lacks',
    reach: {answer: 'yes', why: "Insert a name where the operand is missing. After a missing right side at the end of a definition, the next `let` is read as a local definition before the first error, and is ended early at the `let` after it."},
    apply: (program, random) => {
      const operations = program.nodes.filter(node => node.shape.startsWith('expr: expr '))
      const candidates: {operand: Node, side: string, operator: Token}[] = []
      for (const operation of operations) {
        const operator = operation.children[1]!.token!
        const [left, , right] = operation.children
        if (right!.first === right!.last) candidates.push({operand: right!, side: 'right', operator})
        // Without its left side, a `-` is a negation, which is no mistake.
        if (left!.first === left!.last && operator.terminal !== 'MINUS') candidates.push({operand: left!, side: 'left', operator})
      }
      const chosen = pickOf(random, candidates)
      if (chosen === undefined) return undefined
      const edits = missing(program, chosen.operand.first!)
      const neighbour = chosen.side === 'right' ? program.tokens[chosen.operand.first!.index + 1] : program.tokens[chosen.operand.first!.index - 1]
      return edits && {edits, form: chosen.side === 'right' ? `the right side, before ${inWords(neighbour)}` : `the left side, after ${inWords(neighbour)}`}
    },
  },
  {
    name: 'else without its if',
    description: 'The `if … then` of a conditional is gone, and its `else` is still there.',
    example: {meant: 'let pick n = if n > 0 then n else 0\nlet zero = 0', broken: 'let pick n = n else 0\nlet zero = 0'},
    weight: 1,
    changes: 'lacks',
    reach: {answer: 'partly', why: "The `else` makes the parser reduce everything that an `else` can end, before it reads an open cell. Where the conditional was the whole value of a definition, the `=` is still there: drop the expression and insert `if`, a name, `then` and a name, 12 steps. In a local definition or after another `else`, those are reduced too, and to build them again takes more than 16 steps."},
    apply: (program, random) => {
      const conditional = pickOf(random, nodesOfShape(program, conditionalWithElse))
      if (conditional === undefined) return undefined
      const edits = missing(program, tokenOf(conditional, 'IF'), tokenOf(conditional, 'THEN'))
      return edits && {edits, form: conditional.parent!.shape === conditionalWithElse && conditional.parent!.children[5] === conditional ? 'after another `else`' : 'the first of its conditional'}
    },
  },
  {
    name: 'definition cut in the middle',
    description: 'A definition stops in the middle, and the next definition follows.',
    example: {meant: 'let area w h = w * h\nlet side = 4', broken: 'let area w h = w *\nlet side = 4'},
    weight: 1.5,
    changes: 'lacks',
    reach: {answer: 'yes', why: "At the next `let`, end the open rule early. After a token that an expression has to follow, e.g. `=` or an operator, that `let` is read as a local definition before the first error, and is ended early at the `let` after it."},
    apply: (program, random) => {
      const definition = pickOf(random, program.definitions.slice(0, -1).filter(node => node.last!.index - node.first!.index >= 3))
      if (definition === undefined) return undefined
      // The definition keeps its `let` and one token more at least, and loses one token at least.
      const lastKept = program.tokens[random.integer(definition.first!.index + 1, definition.last!.index - 1)]!
      const lastOfDefinition = definition.last!
      const edits = missing(program, program.tokens[lastKept.index + 1]!, lastOfDefinition)
      const endsAnExpression = ['IDENT', 'INT', 'STRING', 'TRUE', 'FALSE', 'RPAREN', 'RBRACK', 'UNDERSCORE'].includes(lastKept.terminal)
      return edits && {edits, form: endsAnExpression ? 'after a name, a constant or a closing bracket' : `after ${inWords(lastKept)}, which something has to follow`}
    },
  },
  {
    name: 'tuple without brackets',
    description: 'A tuple is written without its brackets, as OCaml allows.',
    example: {meant: 'let pair = (1, 2)\nlet third = 3', broken: 'let pair = 1, 2\nlet third = 3'},
    weight: 1,
    changes: 'lacks',
    reach: {answer: 'partly', why: "As the value of a definition or an item of a list: at the `,`, drop the first item and insert `(` and a name, and close the bracket at the next token that cannot stand in it. In a branch or a body, the `,` first makes the parser reduce the conditional, function or local definition around the tuple, and the cell cannot tell how many of them there were."},
    apply: (program, random) => {
      const tuple = pickOf(random, nodesOfShape(program, tupleShape).filter(node => node.parent!.shape === 'application: atom' && node.parent!.parent!.shape === 'expr: application' && fillsAWholePlace(node.parent!.parent!)))
      if (tuple === undefined) return undefined
      const open = missing(program, tuple.first!), close = missing(program, tuple.last!)
      const place = tuple.parent!.parent!.parent!.shape
      return open && close && {edits: [...open, ...close], form: place.startsWith('elements: ') ? 'an item of a list' : place.startsWith('binding: ') ? 'the value of a binding' : 'a branch or a body'}
    },
  },
  {
    name: 'definition without let',
    description: 'The first definition starts without `let`, as in Haskell.',
    example: {meant: 'let double n = n * 2\nlet four = double 2', broken: 'double n = n * 2\nlet four = double 2'},
    weight: 1,
    changes: 'lacks',
    reach: {answer: 'yes', why: "Insert `let` at a name that starts the program. Only the first definition can be a sample: after another definition, `double n = n * 2` is read as more arguments and a comparison, and the program stays valid."},
    apply: program => {
      const definition = program.definitions[0]
      if (definition === undefined || definition.children[1]!.shape === 'REC' || definition.children[1]!.shape !== 'binding: IDENT parameters EQ expr') return undefined
      const edits = missing(program, definition.first!)
      return edits && {edits, form: 'the first definition'}
    },
  },
]
