// HELD BACK. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read
// this file, see ../README.md.
//
// The kinds in which text is added that is no part of the program: a bracket, a sign, a type, braces, sentences,
// a code fence, the marker lines of a merge conflict, a comment that miniml does not have. Added code points have
// no label, so these kinds ask one thing of a parser: to go on after them as if they were not there.
import type {Random} from '../../random.ts'
import {type Kind, type Mistake, bindingShapes, bracketsShape, functionShape, listShape, localShapes, namedBinding, parametersOf, pickOf, remarks, sentencesAfter, sentencesBefore, separatorsOf, tupleShape} from './kind.ts'
import {type Edit, type Node, type Program, type Token, added, indentationAt, isFirstOnLine, isLastOnLine, lineEndOf, lineEndOfProgram, lineStartOf, nodesOfShape, textOfNode, tokenOf} from './reading.ts'

// How many `(` and `[` are open after the token.
function openBracketsAfter(program: Program, token: Token): number {
  let depth = 0
  for (let index = 0; index <= token.index; index++) {
    const terminal = program.tokens[index]!.terminal
    if (terminal === 'LPAREN' || terminal === 'LBRACK') depth++
    else if (terminal === 'RPAREN' || terminal === 'RBRACK') depth--
  }
  return depth
}
const endsAnAtom = (token: Token): boolean => ['IDENT', 'INT', 'STRING', 'TRUE', 'FALSE'].includes(token.terminal)
const types = ['int', 'int', 'string', 'bool', 'int list', 'string list', 'float', 'unit', 'int * int', "'a", "'a list", 'int -> int', 'int option', 'Int', 'String', 'number'] as const
// What an edit of a merge changes in a definition: a number, a string or an operator of it.
function otherSideOf(program: Program, definition: Node, random: Random): string | undefined {
  const tokens = program.tokens.slice(definition.first!.index, definition.last!.index + 1)
  const changes: {token: Token, text: string}[] = []
  const otherOperator: Record<string, string> = {'+': '-', '-': '+', '<': '<=', '<=': '<', '>': '>=', '>=': '>', '*': '+', '&&': '||', '||': '&&'}
  for (const token of tokens) {
    if (token.terminal === 'INT') changes.push({token, text: String(Number(token.text) + random.pick([1, 2, 5, 10, 100]))})
    else if (token.terminal === 'STRING' && token.text.length > 3) changes.push({token, text: `"${random.pick(['new ', 'old ', 'my ', ''])}${token.text.slice(1, -1)}${random.pick(['', '!', ' v2', '.'])}"`})
    else if (Object.hasOwn(otherOperator, token.text)) changes.push({token, text: otherOperator[token.text]!})
  }
  const change = pickOf(random, changes.filter(({token, text}) => text !== token.text))
  if (change === undefined) return undefined
  return program.text.slice(definition.first!.start, change.token.start) + change.text + program.text.slice(change.token.end, definition.last!.end)
}

export const kindsOfAdded: Kind[] = [
  {
    name: 'bracket closed twice',
    description: 'A closing `)` or `]` stands twice.',
    example: {meant: 'let total = add (price * count) tax', broken: 'let total = add (price * count)) tax'},
    weight: 1,
    changes: 'adds',
    reach: {answer: 'partly', why: "Skip the second bracket. Yes where the pair stands directly in the value of a definition. In a conditional, a function or a local definition, the bracket makes the parser reduce that expression before it reads an open cell, so what follows has lost its `if` or `fun`. Inside another bracket, it closes that bracket."},
    apply: (program, random) => {
      const pair = pickOf(random, nodesOfShape(program, bracketsShape, tupleShape, listShape))
      return pair && {edits: [added(pair.last!.end, pair.last!.text)], form: `a second \`${pair.last!.text}\``}
    },
  },
  {
    name: 'stray closing bracket',
    description: 'A closing bracket stands where no bracket is open.',
    example: {meant: 'let total = price * count\nlet tax = 3', broken: 'let total = price * count)\nlet tax = 3'},
    weight: 1,
    changes: 'adds',
    reach: {answer: 'partly', why: "Skip the bracket. As for a bracket that is closed twice: before the parser reads an open cell, the bracket makes it reduce every conditional, function and local definition that is open, so what follows in them has lost its depth and its container."},
    apply: (program, random) => {
      const bracket = random.weighted([[')', 7], [']', 3]])
      const atEndOfDefinition = program.definitions.map(definition => definition.last!).filter(token => token.terminal !== 'RPAREN' && token.terminal !== 'RBRACK')
      const outsideBrackets = program.tokens.filter(token => endsAnAtom(token) && openBracketsAfter(program, token) === 0 && !atEndOfDefinition.includes(token))
      const atLineEnd = outsideBrackets.filter(token => isLastOnLine(program, token))
      const form = random.weighted([['at the end of a definition', atEndOfDefinition.length > 0 ? 5 : 0], ['at a line end inside a definition', atLineEnd.length > 0 ? 3 : 0], ['inside a line', outsideBrackets.length > 0 ? 2 : 0]])
      const token = pickOf(random, form === 'at the end of a definition' ? atEndOfDefinition : form === 'at a line end inside a definition' ? atLineEnd : outsideBrackets)
      return token && {edits: [added(token.end, bracket)], form: `a \`${bracket}\` ${form}`}
    },
  },
  {
    name: 'semicolons after a definition',
    description: 'A definition ends with `;;`, as in OCaml\'s toplevel, or with `;`, as a statement in C.',
    example: {meant: 'let limit = 10\nlet double n = n * 2', broken: 'let limit = 10;;\nlet double n = n * 2;;'},
    weight: 2,
    changes: 'adds',
    reach: {answer: 'partly', why: "Every token, yes: skip a `;` after the value of a definition. The white space between the `;` and the next `let` has the labels of the stack before the `;`, and the `;` has made the parser reduce the expression before it. So a sample is whole only where the definition ends with no bracket, conditional, function or local definition open."},
    apply: (program, random) => {
      const sign = random.weighted([[';;', 7], [';', 3]])
      const scope = random.weighted([['every definition', program.definitions.length > 1 ? 45 : 0], ['one definition', 35], ['every definition but the last', program.definitions.length > 2 ? 20 : 0]])
      const chosen = scope === 'every definition' ? program.definitions : scope === 'one definition' ? [random.pick(program.definitions.length > 1 ? program.definitions.slice(0, -1) : program.definitions)] : program.definitions.slice(0, -1)
      const placing = random.weighted([['', 80], [' ', 10], ['on its own line', sign === ';;' ? 10 : 0]])
      const lineEnd = lineEndOfProgram(program)
      return {edits: chosen.map(definition => added(definition.last!.end, placing === 'on its own line' ? `${lineEnd}${sign}` : `${placing}${sign}`)), form: `\`${sign}\` after ${scope}${placing === 'on its own line' ? ', on its own line' : ''}`}
    },
  },
  {
    name: 'in after a definition at the top',
    description: 'A definition at the top ends with `in`, as inside an expression.',
    example: {meant: 'let limit = 10\nlet double n = n * 2', broken: 'let limit = 10 in\nlet double n = n * 2'},
    weight: 1,
    changes: 'adds',
    reach: {answer: 'partly', why: "Every token, yes: skip the `in`. The white space after it, no: the `in` has made the parser reduce the whole binding, so the stack gives the container `let` where the label says `=`."},
    apply: (program, random) => {
      const allButLast = program.definitions.slice(0, -1)
      if (allButLast.length === 0) return undefined
      const every = allButLast.length > 1 && random.chance(0.4)
      return {edits: (every ? allButLast : [random.pick(allButLast)]).map(definition => added(definition.last!.end, ' in')), form: every ? 'after every definition but the last' : 'after one definition'}
    },
  },
  {
    name: 'separator too many',
    description: 'A `;` or `,` stands after the last item of a list or tuple, or twice between two items.',
    example: {meant: 'let primes = [2; 3; 5]', broken: 'let primes = [2; 3; 5;]'},
    weight: 1,
    changes: 'adds',
    reach: {answer: 'yes', why: "After the last item: drop the separator from the stack at the closing bracket. Twice: skip the second one."},
    apply: (program, random) => {
      const lists = nodesOfShape(program, listShape), tuples = nodesOfShape(program, tupleShape)
      const withSeparators = [...lists, ...tuples].filter(node => separatorsOf(program, node).length > 0)
      const form = random.weighted([['after the last item of a list', lists.length > 0 ? 4 : 0], ['after the last item of a tuple', tuples.length > 0 ? 2 : 0], ['twice', withSeparators.length > 0 ? 4 : 0], ['none', 0.001]])
      if (form === 'none') return undefined
      if (form === 'twice') {
        const separator = random.pick(separatorsOf(program, random.pick(withSeparators)))
        return {edits: [added(separator.end, random.chance(0.5) ? separator.text : ` ${separator.text}`)], form: `\`${separator.text}\` twice`}
      }
      const node = random.pick(form === 'after the last item of a list' ? lists : tuples)
      const lastOfItems = program.tokens[node.last!.index - 1]!
      return {edits: [added(lastOfItems.end, node.shape === listShape ? ';' : ',')], form}
    },
  },
  {
    name: 'operator typed twice',
    description: 'An operator stands twice.',
    example: {meant: 'let total = price + tax', broken: 'let total = price + + tax'},
    weight: 1,
    changes: 'adds',
    reach: {answer: 'yes', why: "Skip an operator that follows an operator."},
    apply: (program, random) => {
      // `- -` and `= =` are left out: the first is a negation and stays valid, the second is the kind of `==`.
      const operators = program.nodes.filter(node => node.shape.startsWith('expr: expr ') && !['MINUS', 'EQ'].includes(node.children[1]!.shape)).map(node => node.children[1]!.token!)
      const operator = pickOf(random, operators)
      if (operator === undefined) return undefined
      const sideBySide = operator.text.length === 1 && random.chance(0.4)
      return {edits: [added(operator.end, sideBySide ? operator.text : ` ${operator.text}`)], form: sideBySide ? 'side by side' : 'with a space between'}
    },
  },
  {
    name: 'type annotation',
    description: 'A name has a type after it, which miniml does not have.',
    example: {meant: 'let scale factor n = factor * n', broken: 'let scale (factor : int) (n : int) : int = factor * n'},
    weight: 2,
    changes: 'adds',
    reach: {answer: 'yes', why: "Skip the `:` and what the type holds besides names, which are read as parameters without a label. A `(` before a parameter was read as the start of `()`: drop it from the stack at the name, and skip the `)`."},
    apply: (program, random) => {
      const type = (): string => random.pick(types)
      const colon = random.chance(0.8) ? ' : ' : ': '
      const bindings = nodesOfShape(program, namedBinding), functions = nodesOfShape(program, functionShape)
      const constants = bindings.filter(binding => parametersOf(binding).length === 0)
      const withParameters = [...bindings, ...functions].filter(node => parametersOf(node).some(parameter => parameter.shape === 'parameter: IDENT'))
      const form = random.weighted([['after the name of a constant', constants.length > 0 ? 3 : 0], ['around a parameter', withParameters.length > 0 ? 4 : 0], ['after the parameters', withParameters.length > 0 ? 2 : 0], ['none', 0.001]])
      if (form === 'none') return undefined
      if (form === 'after the name of a constant') return {edits: [added(random.pick(constants).first!.end, `${colon}${type()}`)], form}
      const node = random.pick(withParameters)
      const parameters = parametersOf(node).filter(parameter => parameter.shape === 'parameter: IDENT')
      const edits: Edit[] = []
      const every = random.chance(0.6)
      if (form === 'around a parameter' || random.chance(0.4)) {
        for (const parameter of every ? parameters : [random.pick(parameters)]) edits.push(added(parameter.first!.start, '('), added(parameter.first!.end, `${colon}${type()})`))
      }
      if (form === 'after the parameters' && node.shape === namedBinding) {
        const lastParameter = parametersOf(node).at(-1)!.last!
        const annotation = `${colon}${type()}`
        // After a parameter that got brackets, the type follows the closing bracket.
        const atLast = edits.findLast(edit => edit.at === lastParameter.end)
        if (atLast !== undefined) atLast.broken += annotation
        else edits.push(added(lastParameter.end, annotation))
      }
      return edits.length === 0 ? undefined : {edits, form: `${form}${node.shape === functionShape ? ', in a function' : ''}`}
    },
  },
  {
    name: 'braces around a body',
    description: 'The body of a definition or of a function stands in braces.',
    example: {meant: 'let double n = n * 2\nlet four = double 2', broken: 'let double n = { n * 2 }\nlet four = double 2'},
    weight: 1,
    changes: 'adds',
    reach: {answer: 'yes', why: "Skip the braces. They are no tokens, so the parser reads an open cell before it reduces anything, and the white space after a brace keeps its labels."},
    apply: (program, random): Mistake | undefined => {
      const definitions = program.definitions.map(definition => definition.children.at(-1)!).filter(binding => bindingShapes.includes(binding.shape))
      const functions = nodesOfShape(program, functionShape)
      if (functions.length > 0 && random.chance(0.25)) {
        const fun = random.pick(functions)
        return {edits: [added(tokenOf(fun, 'ARROW').end, ' {'), added(fun.last!.end, ' }')], form: 'a function'}
      }
      const withParameters = definitions.filter(binding => parametersOf(binding).length > 0)
      const binding = pickOf(random, withParameters.length > 0 && random.chance(0.8) ? withParameters : definitions)
      if (binding === undefined) return undefined
      const sign = tokenOf(binding, 'EQ')
      const overLines = isLastOnLine(program, sign)
      const close = overLines ? `${lineEndOfProgram(program)}${indentationAt(program, binding.first!.start)}}` : ' }'
      return {edits: [added(sign.end, ' {'), added(binding.last!.end, close)], form: overLines ? 'a definition, with the braces on lines of their own' : 'a definition, on its line'}
    },
  },
  {
    name: 'text around the program',
    description: 'A sentence stands before the program, as in an answer or a message, and sometimes one after it.',
    example: {meant: 'let limit = 10', broken: 'Here is the code:\n\nlet limit = 10\n\nHope this helps!'},
    weight: 1,
    changes: 'adds',
    reach: {answer: 'yes', why: "Skip every token that stands where a definition has to start and is no `let`. A sentence after the program is read as arguments of the last expression, and its signs are skipped."},
    apply: (program, random) => {
      const lineEnd = lineEndOfProgram(program)
      const edits = [added(0, `${random.pick(sentencesBefore)}${lineEnd}${lineEnd}`)]
      const after = random.chance(0.45)
      if (after) edits.push(added(program.text.length, `${program.text.endsWith('\n') ? '' : lineEnd}${lineEnd}${random.pick(sentencesAfter)}${random.chance(0.7) ? lineEnd : ''}`))
      return {edits, form: after ? 'before and after' : 'before'}
    },
  },
  {
    name: 'code fence',
    description: 'The program stands in a code fence of Markdown, sometimes with a sentence before it.',
    example: {meant: 'let limit = 10\n', broken: '```ocaml\nlet limit = 10\n```\n'},
    weight: 1,
    changes: 'adds',
    reach: {answer: 'yes', why: "Skip the backticks and the word after them where a definition has to start, and the closing fence after the last expression."},
    apply: (program, random) => {
      const lineEnd = lineEndOfProgram(program)
      const fence = random.weighted([['```', 9], ['~~~', 1]])
      const language = random.pick(['ocaml', 'ocaml', 'ml', '', 'miniml', 'fsharp', 'sml'])
      const withSentence = random.chance(0.4), withSentenceAfter = withSentence && random.chance(0.4)
      const before = `${withSentence ? `${random.pick(sentencesBefore)}${lineEnd}${lineEnd}` : ''}${fence}${language}${lineEnd}`
      const after = `${program.text.endsWith('\n') ? '' : lineEnd}${fence}${withSentenceAfter ? `${lineEnd}${lineEnd}${random.pick(sentencesAfter)}` : ''}${random.chance(0.7) ? lineEnd : ''}`
      return {edits: [added(0, before), added(program.text.length, after)], form: withSentenceAfter ? 'with a sentence before and after' : withSentence ? 'with a sentence before' : 'the fence alone'}
    },
  },
  {
    name: 'merge conflict',
    description: 'A definition stands twice between the marker lines of a merge conflict, the second time with a change.',
    example: {meant: 'let limit = 10\nlet double n = n * 2', broken: '<<<<<<< HEAD\nlet limit = 10\n=======\nlet limit = 12\n>>>>>>> main\nlet double n = n * 2'},
    weight: 1.5,
    changes: 'adds',
    reach: {answer: 'partly', why: "Every token, yes: skip the signs of the marker lines, and read the last `=` and the last `>` as a name where an operator would be left without its right side. The white space after the last marker line has the labels of the end of the upper side, and the `>` have made the parser reduce the value of the lower side. So a sample is whole only where the definition ends with no bracket, conditional, function or local definition open."},
    apply: (program, random) => {
      // A definition that has its lines to itself.
      const alone = program.definitions.filter(definition => isFirstOnLine(program, definition.first!) && isLastOnLine(program, definition.last!))
      const definition = pickOf(random, alone)
      if (definition === undefined) return undefined
      const lowerSide = otherSideOf(program, definition, random)
      if (lowerSide === undefined) return undefined
      const lineEnd = lineEndOfProgram(program)
      const indentation = indentationAt(program, definition.first!.start)
      const [ours, theirs] = random.weighted([[['HEAD', random.pick(['main', 'origin/main', 'feature/rounding', 'fix-totals', 'theirs', 'a1b2c3d (update the limits)'])], 8], [['Updated upstream', 'Stashed changes'], 2]])
      const threeSides = random.chance(0.2)
      const base = threeSides ? `${lineEnd}||||||| ${random.pick(['base', 'merged common ancestors', '5f3c2aa'])}${lineEnd}${indentation}${textOfNode(program, definition)}` : ''
      const start = lineStartOf(program, definition.first!.start), end = lineEndOf(program, definition.last!.end)
      return {
        edits: [added(start, `<<<<<<< ${ours}${lineEnd}`), added(end, `${base}${lineEnd}=======${lineEnd}${indentation}${lowerSide}${lineEnd}>>>>>>> ${theirs}`)],
        form: `${threeSides ? 'three' : 'two'} sides${program.definitions[0] === definition ? ', at the start of the program' : ''}`,
      }
    },
  },
  {
    name: 'comment of another language',
    description: 'A remark stands after `//` or `#`, or between `/*` and `*/`.',
    example: {meant: 'let limit = 10\nlet double n = n * 2', broken: 'let limit = 10 // the default\nlet double n = n * 2'},
    weight: 1.5,
    changes: 'adds',
    reach: {answer: 'partly', why: "Every token, yes: skip the signs, and read the last `/` of `/* … */` as a name, so that the `*` before it has its right side. The words of the remark are read as arguments. A remark that holds `in`, e.g. \"used in tests\", makes the parser reduce the definition, and the white space after the remark has the labels of the stack before that."},
    apply: (program, random) => {
      const remark = random.pick(remarks)
      const sign = random.weighted([['//', 5], ['#', 3], ['/*', 2]])
      const comment = sign === '/*' ? `/* ${remark} */` : `${sign} ${remark}`
      const lineEnds = program.tokens.filter(token => isLastOnLine(program, token))
      const starts = program.definitions.filter(definition => isFirstOnLine(program, definition.first!))
      if (starts.length > 0 && random.chance(0.4)) {
        const definition = random.pick(starts)
        return {edits: [added(lineStartOf(program, definition.first!.start), `${indentationAt(program, definition.first!.start)}${comment}${lineEndOfProgram(program)}`)], form: `\`${sign}\` on a line of its own${program.definitions[0] === definition ? ', before the first definition' : ''}`}
      }
      const token = pickOf(random, lineEnds)
      return token && {edits: [added(token.end, `${random.pick([' ', '  '])}${comment}`)], form: `\`${sign}\` at a line end`}
    },
  },
  {
    name: 'comment inside a comment',
    description: 'A comment holds a comment. Comments do not nest in miniml, so the outer one ends early and its rest is code.',
    example: {meant: '(* old: (* slow *)\nlet limit = 10', broken: '(* old: (* slow *) remove later *)\nlet limit = 10'},
    weight: 1,
    changes: 'adds',
    reach: {answer: 'partly', why: "The rest of the outer comment has no label: its words are read as arguments, and the `)` of its `*)` is read as a name, which reduces nothing. Old code in the rest, e.g. `let spare = 4`, starts a definition of its own, and the white space after it has the labels of the end of the definition before the comment."},
    apply: (program, random) => {
      const starts = program.definitions.filter(definition => isFirstOnLine(program, definition.first!))
      const definition = pickOf(random, starts)
      if (definition === undefined) return undefined
      const [outer, inner, rest] = random.pick([
        ['let previous = 3', 'legacy', 'let spare = 4'], ['note:', 'see below', 'for the details'], ['TODO', 'ask first', 'rewrite this part'], ['disabled', 'too slow', 'until the next release'],
        ['let debug = true', 'never commit this', ''], ['old version', 'kept for now', 'let unused = 0'],
      ] as const)
      const kept = `(* ${outer} (* ${inner} *)`
      const lineEnd = lineEndOfProgram(program), indentation = indentationAt(program, definition.first!.start)
      return {edits: [{at: lineStartOf(program, definition.first!.start), remove: 0, original: `${indentation}${kept}${lineEnd}`, broken: `${indentation}${kept}${rest === '' ? '' : ` ${rest}`} *)${lineEnd}`}], form: outer.startsWith('let') || rest.startsWith('let') ? 'around old code' : 'around a remark'}
    },
  },
  {
    name: 'word that reads as a name',
    description: 'A keyword of another language that miniml reads as a name: `let mut`, `return`, `end`, `begin … end`.',
    example: {meant: 'let double n = n * 2', broken: 'let double n = return n * 2'},
    weight: 2.5,
    changes: 'adds',
    onlyWithAnotherKind: true,
    reach: {answer: 'partly', why: "The word has no label and is read as a name by cells that valid programs read too, which no table changes. After `let mut` the defined name is read as a parameter. `return` and `begin` before a keyword are an error of their own, at which the word has to be dropped from the stack."},
    apply: (program, random) => {
      const bindings = nodesOfShape(program, namedBinding)
      const form = random.weighted([['let mut', 3], ['return', 4], ['end', 2], ['begin and end', 2]])
      if (form === 'let mut') {
        const binding = pickOf(random, bindings.filter(binding => parametersOf(binding).length === 0))
        return binding && {edits: [added(binding.first!.start, 'mut ')], form}
      }
      const functions = program.definitions.map(definition => definition.children.at(-1)!).filter(binding => parametersOf(binding).length > 0)
      const binding = pickOf(random, functions)
      if (binding === undefined) return undefined
      if (form === 'end') return {edits: [added(binding.last!.end, isLastOnLine(program, tokenOf(binding, 'EQ')) ? `${lineEndOfProgram(program)}${indentationAt(program, binding.first!.start)}end` : ' end')], form}
      // The expression that gives the function's result: the body, under the local definitions around it.
      let result = binding.children.at(-1)!
      while (localShapes.includes(result.shape)) result = result.children.at(-1)!
      if (form === 'return') return {edits: [added(result.first!.start, 'return ')], form: `return before ${['LET', 'IF', 'FUN'].includes(result.first!.terminal) ? 'a keyword' : 'an expression'}`}
      const sign = tokenOf(binding, 'EQ')
      return {edits: [added(sign.end, ' begin'), added(binding.last!.end, ' end')], form}
    },
  },
]
