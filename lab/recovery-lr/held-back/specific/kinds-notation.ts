// HELD BACK. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read
// this file, see ../README.md.
//
// The kinds in which a part of the program is written the way another language writes it: a separator, an
// operator, a keyword, a string, a list of parameters, a conditional. What is typed in the place of a token of
// miniml is added, and the token is missing at its place, as rule 5 of ../written/REPAIR.md says: nothing says
// that `,` plays the part of `;`. What the two share at their start and at their end is kept, e.g. the `el` and
// the `if` of `elif` for `else if`.
import {type Kind, type Mistake, bracketsShape, conditionalWithElse, functionShape, listShape, namedBinding, parametersOf, pickOf, separatorsOf, tupleShape} from './kind.ts'
import {type Edit, type Node, added, definitionOf, indentationAt, lineEndOfProgram, nodesOfShape, textOfNode, tokenOf, written} from './reading.ts'

const onOneLine = (text: string): string => text.replaceAll(/\s+/g, ' ')

// A conditional and the conditionals in its `else` branches, as pairs of condition and branch, and the last branch.
function chainOf(conditional: Node): {arms: {condition: Node, branch: Node}[], last: Node} {
  const arms: {condition: Node, branch: Node}[] = []
  let current = conditional
  for (;;) {
    arms.push({condition: current.children[1]!, branch: current.children[3]!})
    const otherwise = current.children[5]!
    if (otherwise.shape !== conditionalWithElse) return {arms, last: otherwise}
    current = otherwise
  }
}

export const kindsOfNotation: Kind[] = [
  {
    name: 'comma in a list',
    description: 'The items of a list are separated by `,`, where miniml has `;`.',
    example: {meant: 'let primes = [2; 3; 5]', broken: 'let primes = [2, 3, 5]'},
    weight: 2,
    changes: 'both',
    reach: {answer: 'yes', why: "Read a `,` after an item of a list as `;`."},
    apply: (program, random) => {
      const lists = nodesOfShape(program, listShape).filter(list => separatorsOf(program, list).length > 0)
      if (lists.length === 0) return undefined
      const scope = random.weighted([['every separator of one list', 60], ['one separator', 25], ['every list', lists.length > 1 ? 15 : 0]])
      const list = random.pick(lists)
      const separators = scope === 'every list' ? lists.flatMap(each => separatorsOf(program, each)) : scope === 'one separator' ? [random.pick(separatorsOf(program, list))] : separatorsOf(program, list)
      return {edits: separators.map(separator => written(program, separator.start, separator.end, ',')), form: scope}
    },
  },
  {
    name: 'semicolon in a tuple',
    description: 'The items of a tuple are separated by `;`, where miniml has `,`.',
    example: {meant: 'let origin = (0, 0)', broken: 'let origin = (0; 0)'},
    weight: 1,
    changes: 'both',
    reach: {answer: 'yes', why: "Read a `;` after an expression in round brackets as `,`."},
    apply: (program, random) => {
      const tuple = pickOf(random, nodesOfShape(program, tupleShape))
      if (tuple === undefined) return undefined
      const separators = separatorsOf(program, tuple)
      const every = random.chance(0.7)
      return {edits: (every ? separators : [random.pick(separators)]).map(separator => written(program, separator.start, separator.end, ';')), form: every ? 'every separator of one tuple' : 'one separator'}
    },
  },
  {
    name: 'equality of another language',
    description: 'A comparison is written `==`, `===`, `!=`, `!==` or `/=`, where miniml has `=` and `<>`.',
    example: {meant: 'let same a b = if a = b then 1 else 0', broken: 'let same a b = if a == b then 1 else 0'},
    weight: 2,
    changes: 'both',
    reach: {answer: 'yes', why: "Skip an `=` that follows an `=`, and skip `!`. The `=` after a skipped `!` is then the comparison, and after `/` it is skipped."},
    apply: (program, random) => {
      const equalities = program.nodes.filter(node => node.shape === 'expr: expr EQ expr'), inequalities = program.nodes.filter(node => node.shape === 'expr: expr NE expr')
      // A program has far more `=` than `<>`, so the `<>` are taken more often than their share.
      const comparison = pickOf(random, inequalities.length > 0 && (equalities.length === 0 || random.chance(0.5)) ? inequalities : equalities)
      if (comparison === undefined) return undefined
      const operator = comparison.children[1]!.token!
      const typed = operator.terminal === 'EQ' ? random.weighted([['==', 8], ['===', 2]]) : random.weighted([['!=', 7], ['/=', 1.5], ['!==', 1.5]])
      return {edits: [written(program, operator.start, operator.end, typed)], form: `\`${typed}\` for \`${operator.text}\``}
    },
  },
  {
    name: 'fat arrow',
    description: 'The arrow of a function is written `=>`, where miniml has `->`.',
    example: {meant: 'let twice = fun n -> n * 2', broken: 'let twice = fun n => n * 2'},
    weight: 1,
    changes: 'both',
    reach: {answer: 'yes', why: "Read an `=` after the parameters of a `fun` as `->`, and skip the `>` after it, shown as punctuation."},
    apply: (program, random) => {
      const fun = pickOf(random, nodesOfShape(program, functionShape))
      if (fun === undefined) return undefined
      const arrow = tokenOf(fun, 'ARROW')
      return {edits: [written(program, arrow.start, arrow.end, '=>')], form: '`=>` for `->`'}
    },
  },
  {
    name: 'another word for let',
    description: 'A definition starts with the keyword of another language: `def`, `fun`, `val`, `var`, `const`, `fn`, `function`, `define`.',
    example: {meant: 'let double n = n * 2\nlet four = double 2', broken: 'def double n = n * 2\nlet four = double 2'},
    weight: 1.5,
    changes: 'both',
    reach: {answer: 'partly', why: "Yes for the first definition: read a name, or `fun`, that starts the program as `let`. No where every definition has a word that is a name for miniml: after an expression, `def name` is read as two more arguments by cells that valid programs read, and the definition is never seen as one."},
    apply: (program, random) => {
      const word = random.weighted([['def', 30], ['fun', 15], ['val', 12], ['var', 12], ['const', 12], ['fn', 7], ['function', 6], ['define', 6]])
      const every = program.definitions.length > 1 && random.chance(0.2)
      // The word takes the place of `let`, and of `let rec`.
      const edits = (every ? program.definitions : program.definitions.slice(0, 1)).map(definition => written(program, definition.first!.start, definition.children[1]!.shape === 'REC' ? definition.children[1]!.last!.end : definition.first!.end, word))
      return edits.length === 0 ? undefined : {edits, form: `\`${word}\` for ${every ? 'every `let` at the top' : 'the first `let`'}`}
    },
  },
  {
    name: 'another word for fun',
    description: 'A function starts with `function`, `lambda`, `fn` or `\\`, where miniml has `fun`.',
    example: {meant: 'let twice = fun n -> n * 2', broken: 'let twice = function n -> n * 2'},
    weight: 1,
    changes: 'both',
    reach: {answer: 'yes', why: "`\\`: read it as `fun`. A word is read as a name and the parameters as its arguments, before the first error at the `->`. There drop them from the stack and insert `fun` and a name, 8 steps."},
    apply: (program, random) => {
      const fun = pickOf(random, nodesOfShape(program, functionShape))
      if (fun === undefined) return undefined
      const word = random.weighted([['function', 50], ['lambda', 15], ['fn', 15], ['\\', 20]])
      const keyword = fun.first!
      // `\x -> x` has no space after the sign.
      return {edits: [written(program, keyword.start, word === '\\' ? program.tokens[keyword.index + 1]!.start : keyword.end, word)], form: `\`${word}\` for \`fun\``}
    },
  },
  {
    name: 'elif',
    description: 'An `else if` is written as one word: `elif`, `elsif` or `elseif`.',
    example: {meant: 'let sign n = if n < 0 then 1 else if n = 0 then 2 else 3', broken: 'let sign n = if n < 0 then 1 elif n = 0 then 2 else 3'},
    weight: 1,
    changes: 'both',
    reach: {answer: 'partly', why: "The word is read as a name, and the first error is the next `then`, which makes the parser reduce the conditional before it. Where that conditional is the whole value of a definition or stands in brackets, drop what is left of it and insert `if`, `if` and a name, which gives the depth and the container of the labels. In the body of a local definition, the `then` reduces that definition too."},
    apply: (program, random) => {
      const conditional = pickOf(random, nodesOfShape(program, conditionalWithElse).filter(node => node.children[5]!.shape.startsWith('expr: IF')))
      if (conditional === undefined) return undefined
      const word = random.weighted([['elif', 60], ['elsif', 15], ['elseif', 25]])
      return {edits: [written(program, tokenOf(conditional, 'ELSE').start, conditional.children[5]!.first!.end, word)], form: `\`${word}\``}
    },
  },
  {
    name: 'match with arms',
    description: 'A conditional is written as `match … with` and arms, or as `case … of`, which miniml does not have. The whole expression is added, and `()` is missing in its place.',
    example: {meant: 'let name n = ()\nlet two = 2', broken: 'let name n = match n with | 0 -> "zero" | _ -> "many"\nlet two = 2'},
    weight: 1,
    changes: 'both',
    reach: {answer: 'partly', why: "Nothing in the expression has a label: its words are read as arguments, and `|`, `->` and `_` are skipped. Every token after it can be right. The white space right after it is right only where the arms leave the stack as it was before them, e.g. not after an arm with a conditional."},
    apply: (program, random): Mistake | undefined => {
      const conditional = pickOf(random, nodesOfShape(program, conditionalWithElse).filter(node => node.parent!.shape !== conditionalWithElse || node.parent!.children[5] !== node))
      if (conditional === undefined) return undefined
      const {arms, last} = chainOf(conditional)
      const text = (node: Node): string => onOneLine(textOfNode(program, node))
      // if x = 1 then a else if x = 2 then b else c  compares one thing with several values.
      const compared = arms.map(arm => arm.condition.shape === 'expr: expr EQ expr' ? text(arm.condition.children[0]!) : undefined)
      const sameThing = compared[0] !== undefined && compared.every(side => side === compared[0])
      const subject = sameThing ? compared[0]! : text(arms[0]!.condition)
      const cases = sameThing ? [...arms.map(arm => [text(arm.condition.children[2]!), text(arm.branch)]), ['_', text(last)]] : [['true', text(arms[0]!.branch)], ['false', text(conditional.children[5]!)]]
      const form = random.weighted([['match with arms on lines', 50], ['match on one line', 25], ['case of', 25]])
      const lineEnd = lineEndOfProgram(program), indentation = `${indentationAt(program, conditional.first!.start)}  `
      const typed = form === 'match with arms on lines' ? `match ${subject} with${cases.map(([pattern, result]) => `${lineEnd}${indentation}| ${pattern} -> ${result}`).join('')}`
        : form === 'match on one line' ? `match ${subject} with ${cases.map(([pattern, result]) => `${pattern} -> ${result}`).join(' | ')}`
        : `case ${subject} of${cases.map(([pattern, result]) => `${lineEnd}${indentation}${pattern} -> ${result}`).join('')}`
      // The `()` of the original stands right before the next token that the broken text has.
      const next = program.tokens[conditional.last!.index + 1]
      const place = next?.start ?? program.text.length
      const unit = next === undefined || ['RPAREN', 'RBRACK', 'COMMA', 'SEMI'].includes(next.terminal) ? '()' : '() '
      const edits: Edit[] = place === conditional.last!.end ? [{at: conditional.first!.start, remove: place - conditional.first!.start, original: unit, broken: typed}]
        : [{at: conditional.first!.start, remove: conditional.last!.end - conditional.first!.start, original: '', broken: typed}, {at: place, remove: 0, original: unit, broken: ''}]
      return {edits, form}
    },
  },
  {
    name: 'parameters in brackets with commas',
    description: 'The parameters stand in round brackets with commas between them, as in most languages.',
    example: {meant: 'let add a b = a + b', broken: 'let add(a, b) = a + b'},
    weight: 1.5,
    changes: 'both',
    reach: {answer: 'yes', why: "The `(` was read as the start of a parameter `()`: drop it from the stack at the first name, and skip every `,` and the `)`."},
    apply: (program, random) => {
      const withParameters = [...nodesOfShape(program, namedBinding), ...nodesOfShape(program, functionShape)].filter(node => parametersOf(node).length > 0 && parametersOf(node).every(parameter => parameter.shape === 'parameter: IDENT'))
      const node = pickOf(random, withParameters)
      if (node === undefined) return undefined
      const parameters = parametersOf(node).map(parameter => parameter.first!)
      const first = parameters[0]!, last = parameters.at(-1)!
      const nameEnd = program.tokens[first.index - 1]!.end
      // `add(a, b)` in a definition, and `add (a, b)` with the space kept in some. After `fun` the space stays.
      const open = node.shape === namedBinding && random.chance(0.7) ? written(program, nameEnd, first.start, '(') : added(first.start, '(')
      return {edits: [open, ...parameters.slice(0, -1).map(parameter => added(parameter.end, ',')), added(last.end, ')')], form: `${parameters.length === 1 ? 'one parameter' : 'several parameters'}${node.shape === functionShape ? ', in a function' : ''}`}
    },
  },
  {
    name: 'apostrophes around a string',
    description: 'A string stands between apostrophes or backticks, where miniml has `"`.',
    example: {meant: 'let greeting = "hello"', broken: "let greeting = 'hello'"},
    weight: 1,
    changes: 'both',
    reach: {answer: 'partly', why: "A string of one word that nothing follows in its application: insert a constant before the first sign, so that the word stands after a whole expression, where a table can skip it and show it as a string. No for a string with a space, which the scanner reads as white space, and no where arguments follow the string."},
    apply: (program, random) => {
      const string = pickOf(random, program.tokens.filter(token => token.terminal === 'STRING' && token.text.length > 2 && !/['`\\]/.test(token.text)))
      if (string === undefined) return undefined
      const sign = random.chance(0.8) ? "'" : '`'
      return {edits: [written(program, string.start, string.start + 1, sign), written(program, string.end - 1, string.end, sign)], form: sign === "'" ? 'apostrophes' : 'backticks'}
    },
  },
  {
    name: 'keyword as a name',
    description: 'A parameter or a local name is a keyword of miniml: `in`, `fun` or `rec`.',
    example: {meant: 'let double input = input * 2', broken: 'let double in = in * 2'},
    weight: 1,
    changes: 'both',
    reach: {answer: 'partly', why: "Where an expression starts, and as a parameter: read `in` or `rec` as a name. An `in` that is an argument makes the parser reduce everything up to the definition before an open cell is read. A table can build `let name =` again and skip the `in`, which is right only where the `in` stood in no bracket and no conditional. `fun` where an expression can start is read as a function by a cell that valid programs read."},
    apply: (program, random) => {
      const definition = pickOf(random, program.definitions)
      if (definition === undefined) return undefined
      const inside = (node: Node): boolean => definitionOf(node) === definition
      // The parameters of the definition and of its functions, and the names of its local definitions.
      const declared = program.nodes.filter(node => inside(node) && (node.shape === 'parameter: IDENT' || (node.shape === namedBinding && !node.parent!.shape.startsWith('definition: ')))).map(node => node.first!.text)
      const name = pickOf(random, declared)
      if (name === undefined) return undefined
      const keyword = random.weighted([['in', 70], ['fun', 15], ['rec', 15]])
      const uses = program.tokens.slice(definition.first!.index, definition.last!.index + 1).filter(token => token.terminal === 'IDENT' && token.text === name)
      return {edits: uses.map(use => written(program, use.start, use.end, keyword)), form: `\`${keyword}\``}
    },
  },
  {
    name: 'bracket of the other sort',
    description: 'A pair of brackets is closed with the bracket of the other sort.',
    example: {meant: 'let total = add (price * count) tax', broken: 'let total = add (price * count] tax'},
    weight: 1,
    changes: 'both',
    reach: {answer: 'yes', why: "Read a `]` where only a `)` can close as `)`, and the other way round."},
    apply: (program, random) => {
      const pair = pickOf(random, nodesOfShape(program, bracketsShape, tupleShape, listShape))
      if (pair === undefined) return undefined
      const close = pair.last!
      return {edits: [written(program, close.start, close.end, close.text === ')' ? ']' : ')')], form: close.text === ')' ? '`]` for `)`' : '`)` for `]`'}
    },
  },
  {
    name: 'decimal point',
    description: 'A number has a decimal point, and miniml has integers only.',
    example: {meant: 'let rate = 250', broken: 'let rate = 2.50'},
    weight: 1,
    changes: 'both',
    reach: {answer: 'yes', why: "Skip the point. The digits after it are a number of their own, read as an argument at the same depth."},
    apply: (program, random) => {
      const number = pickOf(random, program.tokens.filter(token => token.terminal === 'INT'))
      if (number === undefined) return undefined
      if (number.text.length >= 2 && random.chance(0.6)) return {edits: [added(number.start + random.integer(1, number.text.length - 1), '.')], form: 'inside the number'}
      return {edits: [added(number.end, random.pick(['.0', '.5', '.25', '.']))], form: 'after the number'}
    },
  },
  {
    name: 'operator of another language',
    description: 'An operator is written as elsewhere: `=<` and `=>` for `<=` and `>=`, `++` for `^`, `:` for `::`, `&` and `|` for `&&` and `||`.',
    example: {meant: 'let both a b = a && b', broken: 'let both a b = a & b'},
    weight: 1.5,
    changes: 'both',
    reach: {answer: 'yes', why: "Read a lone `&`, `|` or `:` after an expression as the operator, shown as one. For `=<`, `=>` and `++`, skip the second sign: the first one is an operator of miniml and gives the same depth and container."},
    apply: (program, random) => {
      const typedFor: Record<string, string> = {LE: '=<', GE: '=>', CARET: '++', CONS: ':', AND: '&', OR: '|'}
      const operation = pickOf(random, program.nodes.filter(node => node.shape.startsWith('expr: expr ') && Object.hasOwn(typedFor, node.children[1]!.shape)))
      if (operation === undefined) return undefined
      const operator = operation.children[1]!.token!
      return {edits: [written(program, operator.start, operator.end, typedFor[operator.terminal]!)], form: `\`${typedFor[operator.terminal]}\` for \`${operator.text}\``}
    },
  },
  {
    name: 'conditional of another language',
    description: 'A conditional is written as in C, with braces around its branches and no `then`, or as in Python, with `:`.',
    example: {meant: 'let pick n = if n > 0 then n else 0', broken: 'let pick n = if (n > 0) { n } else { 0 }'},
    weight: 1,
    changes: 'both',
    reach: {answer: 'yes', why: "Read a `{` or `:` after the condition as `then`, and skip the other braces and the `:` after `else`. Brackets that were added around the condition are closed before the first error."},
    apply: (program, random) => {
      const conditional = pickOf(random, nodesOfShape(program, conditionalWithElse).filter(node => !node.children[5]!.shape.startsWith('expr: IF') && (node.parent!.shape !== conditionalWithElse || node.parent!.children[5] !== node)))
      if (conditional === undefined) return undefined
      const [, condition, , branch, otherwise, last] = conditional.children
      const then = tokenOf(conditional, 'THEN')
      if (random.chance(0.3)) return {edits: [written(program, condition!.last!.end, then.end, ':'), added(otherwise!.token!.end, ':')], form: 'with `:`, as in Python'}
      const edits = [written(program, then.start, then.end, '{'), added(branch!.last!.end, ' }'), added(otherwise!.token!.end, ' {'), added(last!.last!.end, ' }')]
      const withBrackets = condition!.first!.terminal !== 'LPAREN' && random.chance(0.6)
      if (withBrackets) edits.push(added(condition!.first!.start, '('), added(condition!.last!.end, ')'))
      return {edits, form: `with braces, as in C${withBrackets ? ', and brackets around the condition' : ''}`}
    },
  },
]
