// The generator of valid miniml programs: small programs of 17 sorts, as a person would write them, each at most
// 512 code points. dataset.ts damages them into samples.
//
//   generateProgram(seed, index)   the text of program `index` of a seed, always the same one
//   sortOfProgram(seed, index)     its sort, e.g. 'listRecursion'
//
// A program is made in five steps:
// 1. Idioms. The program's sort is drawn, then idioms of that sort until the program is long enough, see
//    idioms.ts. One definition in seven comes from the idioms of any sort or from another sort, so that no
//    construct belongs to one sort alone.
// 2. Holes. A hole of an idiom is filled with an expression of its kind, written with the names in scope and
//    with the functions that the program has defined so far, e.g. `Int` becomes `n + 1` or `length xs`.
// 3. Free expressions. In one program in three, one to three expressions anywhere in the program are replaced by
//    an expression that only follows the grammar, e.g. `"a" * [1]` or `- if x then y`. miniml checks no types, so
//    the program stays valid. Without this step most pairs of tokens that the grammar allows would never be
//    written, e.g. a string before `*`, and the cells of the parser's table that read them would never be read:
//    check-dataset.ts counts that the programs read every frozen cell.
// 4. Names. Every name of the vocabulary gets one of its other names for the whole program, e.g. `xs` is `items`.
// 5. Layout. A style is drawn per program: the indentation, the line width, where lines break, the spacing, the
//    brackets that are not needed, comments, blank lines, and in a few programs everything on one line.
import {type Hole, type Kind, type Sort, commentTexts, commonIdioms, headerComments, holes, idiomsOfSort, sorts, stringTexts, vocabulary} from './idioms.ts'
import {maximumCodePoints, scan} from './parser.ts'
import {type Random, createRandom} from './random.ts'
import {
  type Binding, type Definition, type Expression, type Operator, type Style, definitionsOf, groupsFromTheRight, inline, linesOfDefinition, operatorLevel, operators, withBrackets,
} from './syntax.ts'
import {newlineKind, whitespaceKind} from './tables.ts'

const kinds: readonly Kind[] = ['int', 'bool', 'string', 'list', 'pair', 'function', 'unit', 'any']
const isHole = (name: string): name is Hole => (holes as readonly string[]).includes(name)
const isName = (binder: string): boolean => binder !== '_' && binder !== '()'
const kindOfName = (name: string): Kind => vocabulary[name]?.[0] ?? 'any'

// An idiom's text with one alternative drawn for every `{a ~ b}`, the innermost first.
function withAlternativesDrawn(text: string, random: Random): string {
  for (;;) {
    const match = /\{([^{}]*)\}/.exec(text)
    if (match === null) return text
    text = `${text.slice(0, match.index)}${random.pick(match[1]!.split('~')).trim()}${text.slice(match.index + match[0].length)}`
  }
}

type Idiom = {kind: Kind, definitions: Definition[]}
const parsedIdioms = new Map<string, Idiom>()
// The definitions of an idiom's text after its alternatives are drawn. Nothing may change the trees that this
// returns: they are kept for the next program.
export function idiomOf(text: string): Idiom {
  const known = parsedIdioms.get(text)
  if (known !== undefined) return known
  const colon = text.indexOf(':')
  const kind = kinds.find(candidate => candidate === text.slice(0, colon))
  if (kind === undefined) throw new Error(`an idiom does not start with its kind: ${text}`)
  const idiom = {kind, definitions: definitionsOf(text.slice(colon + 1))}
  parsedIdioms.set(text, idiom)
  return idiom
}

// A function that an expression can call: its name, the kinds of its parameters and the kind of what it gives.
type KnownFunction = {name: string, parameters: Kind[], result: Kind}
const library: readonly KnownFunction[] = [
  {name: 'abs', parameters: ['int'], result: 'int'}, {name: 'max', parameters: ['int', 'int'], result: 'int'}, {name: 'min', parameters: ['int', 'int'], result: 'int'},
  {name: 'length', parameters: ['list'], result: 'int'}, {name: 'head', parameters: ['list'], result: 'int'}, {name: 'fst', parameters: ['pair'], result: 'int'},
  {name: 'snd', parameters: ['pair'], result: 'int'}, {name: 'string_length', parameters: ['string'], result: 'int'}, {name: 'int_of_string', parameters: ['string'], result: 'int'},
  {name: 'not', parameters: ['bool'], result: 'bool'}, {name: 'is_empty', parameters: ['list'], result: 'bool'}, {name: 'mem', parameters: ['int', 'list'], result: 'bool'},
  {name: 'string_of_int', parameters: ['int'], result: 'string'}, {name: 'trim', parameters: ['string'], result: 'string'}, {name: 'uppercase', parameters: ['string'], result: 'string'},
  {name: 'tail', parameters: ['list'], result: 'list'}, {name: 'reverse', parameters: ['list'], result: 'list'}, {name: 'append', parameters: ['list', 'list'], result: 'list'},
  {name: 'map', parameters: ['function', 'list'], result: 'list'}, {name: 'filter', parameters: ['function', 'list'], result: 'list'},
  {name: 'print_string', parameters: ['string'], result: 'unit'}, {name: 'print_endline', parameters: ['string'], result: 'unit'}, {name: 'print_int', parameters: ['int'], result: 'unit'},
  {name: 'print_newline', parameters: ['unit'], result: 'unit'},
]

// The names that an expression can use at its place, innermost last.
type Scope = readonly {name: string, kind: Kind}[]

const name = (text: string): Expression => ({type: 'name', text})
const literal = (text: string): Expression => ({type: 'literal', text})
const operation = (operator: Operator, left: Expression, right: Expression): Expression => ({type: 'operation', operator, left, right})
const call = (functionName: string, ...parameters: Expression[]): Expression => ({type: 'application', head: name(functionName), arguments: parameters})

// What fills the holes of one program. `functions` are the functions that the program has defined so far.
function createFiller(random: Random, functions: readonly KnownFunction[]) {
  const draw = <Item>(choices: readonly (readonly [make: () => Item, weight: number])[]): Item => random.weighted(choices)()
  const numberText = (): string => draw([
    [() => String(random.integer(0, 10)), 50],
    [() => random.pick(['10', '12', '16', '20', '24', '25', '30', '32', '50', '60', '64', '80', '100', '120', '128', '200', '255', '256', '365', '500', '512', '1000', '1024', '3600', '8080', '9999', '10000', '65535', '1000000']), 30],
    [() => String(random.integer(11, 999)), 17],
    [() => random.pick(['007', '00', '010', '0100']), 1.5],
    [() => String(random.integer(1000, 99999)), 1.5],
  ])
  const number = (): Expression => literal(numberText())
  const string = (): Expression => literal(`"${random.chance(0.12) ? `${random.pick(stringTexts)} ${random.pick(stringTexts)}` : random.pick(stringTexts)}"`)
  const flag = (): Expression => literal(random.chance(0.5) ? 'true' : 'false')
  const numbers = (): Expression => {
    const count = random.integer(1, 6)
    // A list of numbers that count up, or of numbers drawn one by one.
    const first = random.integer(0, 9), step = random.integer(1, 5)
    return {type: 'list', items: Array.from({length: count}, (_, place) => random.chance(0.3) ? literal(String(first + place * step)) : number())}
  }
  const strings = (): Expression => ({type: 'list', items: Array.from({length: random.integer(1, 5)}, string)})
  const nameOfKind = (scope: Scope, kind: Kind): Expression | undefined => {
    const fitting = scope.filter(entry => entry.kind === kind)
    return fitting.length === 0 ? undefined : name(random.pick(fitting).name)
  }
  // A call of a function that gives a value of the kind: one that the program has defined, where there is one,
  // in two calls of three.
  const callOf = (scope: Scope, kind: Kind, size: number): Expression | undefined => {
    const defined = functions.filter(candidate => candidate.result === kind), others = library.filter(candidate => candidate.result === kind)
    const candidates = defined.length > 0 && (others.length === 0 || random.chance(0.65)) ? defined : others
    if (candidates.length === 0) return undefined
    const chosen = random.pick(candidates)
    return call(chosen.name, ...chosen.parameters.map(parameter => expression(scope, parameter, Math.min(size, 1) - (random.chance(0.6) ? 1 : 0))))
  }
  const conditional = (scope: Scope, kind: Kind, size: number): Expression => ({type: 'conditional', condition: expression(scope, 'bool', size), then: expression(scope, kind, 0), otherwise: expression(scope, kind, 0)})
  // A function of one parameter, e.g. `fun x -> x + 1`. The parameter is in scope in the body.
  const functionOf = (scope: Scope, size: number): Expression => {
    const parameter = random.pick(['x', 'x', 'n', 'y', 'acc', 'item', 's', 'pair'])
    const parameters = draw([[() => [parameter], 8], [() => [parameter, parameter === 'y' ? 'x' : 'y'], 1.5], [() => ['_'], 0.5], [() => ['()'], 0.5]])
    const inner = [...scope, ...parameters.filter(isName).map(binder => ({name: binder, kind: kindOfName(binder)}))]
    return {type: 'function', parameters, body: expression(inner, kindOfName(parameter) === 'pair' || kindOfName(parameter) === 'any' ? 'int' : kindOfName(parameter), size)}
  }
  // An expression of a kind with about `size` operators or calls in it.
  const expression = (scope: Scope, kind: Kind, size: number): Expression => {
    const named = nameOfKind(scope, kind)
    const smaller = (): number => size - 1 - (random.chance(0.4) ? 1 : 0)
    switch (kind) {
      case 'int': {
        if (size <= 0) return named !== undefined && random.chance(0.65) ? named : number()
        return draw<Expression>([
          [() => expression(scope, 'int', 0), 2],
          [() => operation(random.pick<Operator>(['+', '-', '*', '/', '+', '*', '-']), expression(scope, 'int', size - 1), expression(scope, 'int', smaller())), 5],
          [() => callOf(scope, 'int', size) ?? number(), 3],
          [() => ({type: 'negation', operand: expression(scope, 'int', 0)}), 0.4],
          [() => conditional(scope, 'int', size - 1), 0.5],
          // A conditional as the right operand, e.g. `n + if c then 1 else 0`.
          [() => operation(random.pick<Operator>(['+', '-', '*']), expression(scope, 'int', 0), conditional(scope, 'int', 0)), 0.25],
          [() => ({type: 'local', binding: {recursive: false, target: 'tmp', parameters: [], value: expression(scope, 'int', size - 1)}, body: operation(random.pick<Operator>(['+', '*', '-']), name('tmp'), expression(scope, 'int', 0))}), 0.2],
        ])
      }
      case 'bool': {
        if (size <= 0) return named !== undefined && random.chance(0.6) ? named : random.chance(0.5) ? flag() : operation(random.pick<Operator>(['=', '<>', '<', '<=', '>', '>=']), nameOfKind(scope, 'int') ?? callOf(scope, 'int', 0) ?? number(), number())
        return draw<Expression>([
          // A comparison of two numbers. Where no name is in scope, its left side is a call, so that no two literals are compared.
          [() => operation(random.pick<Operator>(['=', '<>', '<', '<=', '>', '>=', '<', '>', '=']), nameOfKind(scope, 'int') !== undefined ? expression(scope, 'int', smaller()) : callOf(scope, 'int', 1) ?? number(), expression(scope, 'int', 0)), 5],
          [() => operation(random.pick<Operator>(['=', '<>']), nameOfKind(scope, 'list') ?? callOf(scope, 'list', 1) ?? numbers(), {type: 'list', items: []}), 0.7],
          [() => operation(random.pick<Operator>(['=', '<>', '=']), nameOfKind(scope, 'string') ?? callOf(scope, 'string', 1) ?? string(), string()), 0.7],
          [() => operation(random.pick<Operator>(['&&', '||']), expression(scope, 'bool', size - 1), expression(scope, 'bool', smaller())), 3],
          [() => call('not', expression(scope, 'bool', size - 1)), 0.8],
          [() => callOf(scope, 'bool', size) ?? flag(), 1],
          [() => expression(scope, 'bool', 0), 0.5],
        ])
      }
      case 'string': {
        if (size <= 0) return named !== undefined && random.chance(0.5) ? named : string()
        return draw<Expression>([
          [() => operation('^', expression(scope, 'string', smaller()), expression(scope, 'string', size - 1)), 5],
          [() => call('string_of_int', expression(scope, 'int', size - 1)), 2],
          [() => conditional(scope, 'string', size - 1), 0.5],
          [() => callOf(scope, 'string', size) ?? string(), 1],
          [() => expression(scope, 'string', 0), 2],
        ])
      }
      case 'list': {
        if (size <= 0) return named !== undefined && random.chance(0.5) ? named : random.chance(0.15) ? {type: 'list', items: []} : numbers()
        return draw<Expression>([
          [() => operation('::', expression(scope, 'int', smaller()), expression(scope, 'list', size - 1)), 3],
          [() => ({type: 'list', items: Array.from({length: random.integer(1, 3)}, () => expression(scope, 'int', size - 1))}), 2],
          [() => callOf(scope, 'list', size) ?? numbers(), 2],
          [() => expression(scope, 'list', 0), 2],
          [() => conditional(scope, 'list', size - 1), 0.3],
          [() => strings(), 0.3],
        ])
      }
      case 'pair': {
        if (size <= 0 && named !== undefined && random.chance(0.5)) return named
        return draw<Expression>([
          [() => ({type: 'tuple', items: [expression(scope, 'int', size - 1), expression(scope, 'int', size - 1)]}), 4],
          [() => ({type: 'tuple', items: [string(), expression(scope, 'int', size - 1)]}), 1.5],
          [() => ({type: 'tuple', items: [expression(scope, 'int', 0), expression(scope, 'int', 0), expression(scope, random.pick(['int', 'bool', 'string']), 0)]}), 0.7],
          [() => callOf(scope, 'pair', size) ?? ({type: 'tuple', items: [number(), number()]}), 1],
        ])
      }
      case 'unit': {
        if (size <= 0) return random.chance(0.3) ? {type: 'unit'} : callOf(scope, 'unit', 0) ?? {type: 'unit'}
        return draw<Expression>([
          [() => callOf(scope, 'unit', size) ?? {type: 'unit'}, 5],
          [() => ({type: 'conditional', condition: expression(scope, 'bool', size - 1), then: expression(scope, 'unit', 0), otherwise: undefined}), 1],
          [() => ({type: 'local', binding: {recursive: false, target: '()', parameters: [], value: expression(scope, 'unit', 0)}, body: expression(scope, 'unit', size - 1)}), 0.8],
          [() => ({type: 'local', binding: {recursive: false, target: '_', parameters: [], value: expression(scope, 'any', 0)}, body: expression(scope, 'unit', 0)}), 0.2],
          [() => ({type: 'unit'}), 0.5],
        ])
      }
      case 'function':
        if (named !== undefined && random.chance(0.3)) return named
        return functionOf(scope, Math.max(1, size))
      case 'any':
        return expression(scope, random.weighted([['int', 4], ['bool', 2], ['string', 2], ['list', 2], ['pair', 1], ['unit', 0.5], ['function', 1]] as const), size)
    }
  }
  const sizeOfHole = (): number => random.weighted([[0, 3], [1, 4], [2, 2]])
  const fill = (hole: Hole, scope: Scope): Expression => {
    switch (hole) {
      case 'Int': return expression(scope, 'int', sizeOfHole())
      case 'Bool': return expression(scope, 'bool', Math.max(1, sizeOfHole()))
      case 'String': return expression(scope, 'string', sizeOfHole())
      case 'List': return expression(scope, 'list', sizeOfHole())
      case 'Pair': return expression(scope, 'pair', sizeOfHole())
      case 'Unit': return expression(scope, 'unit', sizeOfHole())
      case 'Function': return expression(scope, 'function', sizeOfHole())
      case 'Any': return expression(scope, 'any', sizeOfHole())
      case 'Number': return number()
      case 'Text': return string()
      case 'Flag': return flag()
      case 'Numbers': return numbers()
      case 'Texts': return strings()
    }
  }
  return {fill, number, string}
}

// A copy of an idiom's expression with its holes filled. `scope` holds the names that are in scope at the expression.
function filled(node: Expression, scope: Scope, fill: (hole: Hole, scope: Scope) => Expression): Expression {
  const inner = (part: Expression): Expression => filled(part, scope, fill)
  const withBinders = (binders: readonly string[]): Scope => [...scope, ...binders.filter(isName).map(binder => ({name: binder, kind: kindOfName(binder)}))]
  switch (node.type) {
    case 'name': return isHole(node.text) ? fill(node.text, scope) : {...node}
    case 'literal': case 'unit': return {...node}
    case 'tuple': return {type: 'tuple', items: node.items.map(inner)}
    case 'list': return {type: 'list', items: node.items.map(inner)}
    case 'brackets': return {type: 'brackets', inner: inner(node.inner)}
    case 'application': return {type: 'application', head: inner(node.head), arguments: node.arguments.map(inner)}
    case 'negation': return {type: 'negation', operand: inner(node.operand)}
    case 'operation': return {type: 'operation', operator: node.operator, left: inner(node.left), right: inner(node.right)}
    case 'conditional': return {type: 'conditional', condition: inner(node.condition), then: inner(node.then), otherwise: node.otherwise === undefined ? undefined : inner(node.otherwise)}
    case 'function': return {type: 'function', parameters: [...node.parameters], body: filled(node.body, withBinders(node.parameters), fill)}
    case 'local': {
      const {binding} = node
      const value = filled(binding.value, withBinders(binding.parameters), fill)
      // What the local definition defines is a function when it has parameters.
      const defined = isName(binding.target) ? [{name: binding.target, kind: binding.parameters.length > 0 ? 'function' as const : kindOfName(binding.target)}] : []
      return {type: 'local', binding: {...binding, parameters: [...binding.parameters], value}, body: filled(node.body, [...scope, ...defined], fill)}
    }
  }
}

// An expression that only follows the grammar: any atom next to any operator, any expression in any place.
// `names` are the names that it is written with. The function that this returns takes a size, which is how many
// times an expression can hold another one: a list in a tuple in an `if` has the size 3, and the parts of an
// expression of size 0 are atoms that hold nothing.
export function createFreeExpressions(random: Random, names: readonly string[], number: () => Expression, string: () => Expression) {
  const draw = <Item>(choices: readonly (readonly [make: () => Item, weight: number])[]): Item => random.weighted(choices)()
  const freeName = (): Expression => name(random.pick(names))
  const binder = (): string => random.weighted([[random.pick(['x', 'y', 'n', 'tmp', 'acc', 'v', 'it', 'r', 'f', 'go']), 6], ['_', 2], ['()', 2]])
  const binding = (size: number): Binding => {
    const target = binder()
    return {recursive: random.chance(0.4), target, parameters: isName(target) ? Array.from({length: random.weighted([[0, 6], [1, 3], [2, 1]])}, binder) : [], value: whole(size)}
  }
  // The ten forms of an atom, each about as often as the others, so that every one comes to stand next to
  // every operator and every other atom. An atom of size 0 holds no expression.
  const atom = (size: number): Expression => draw<Expression>([
    [freeName, 20], [number, 11], [string, 10], [() => literal('true'), 7], [() => literal('false'), 7], [() => ({type: 'unit'}), 8], [() => ({type: 'list', items: []}), 8],
    [() => ({type: 'list', items: Array.from({length: random.weighted([[1, 5], [2, 4], [3, 1]])}, () => whole(size - 1))}), size > 0 ? 10 : 0],
    [() => ({type: 'tuple', items: Array.from({length: random.weighted([[2, 4], [3, 4], [4, 2]])}, () => whole(size - 1))}), size > 0 ? 10 : 0],
    [() => ({type: 'brackets', inner: whole(size - 1)}), size > 0 ? 9 : 0],
  ])
  // What stands between two operators: mostly an atom or an application, and sometimes an `if`, a `fun` or a
  // local definition, which withBrackets puts into brackets wherever it is not the last operand.
  const operand = (size: number): Expression => draw<Expression>([
    [() => atom(size), 50],
    [() => ({type: 'application', head: random.chance(0.6) ? freeName() : atom(size), arguments: Array.from({length: random.weighted([[1, 5], [2, 3], [3, 2]])}, () => atom(size))}), 22],
    [() => ({type: 'negation', operand: size > 0 && random.chance(0.3) ? openExpression(size) : random.chance(0.75) ? atom(size) : operand(size - 1)}), 8],
    [() => openExpression(size), size > 0 ? 20 : 0],
  ])
  const openExpression = (size: number): Expression => draw<Expression>([
    [() => ({type: 'conditional', condition: whole(size - 1), then: whole(size - 1), otherwise: random.chance(0.6) ? whole(size - 1) : undefined}), 9],
    [() => ({type: 'function', parameters: Array.from({length: random.weighted([[1, 6], [2, 3], [3, 1]])}, binder), body: whole(size - 1)}), 7],
    [() => ({type: 'local', binding: binding(size - 1), body: whole(size - 1)}), 9],
  ])
  // What stands where a whole expression can stand, e.g. after `then`: an `if`, a `fun` or a local definition
  // in one place in four, so that each of them comes to stand after every token that an expression can follow.
  const whole = (size: number): Expression => size > 0 && random.chance(0.25) ? openExpression(size) : expression(size)
  // One to four operands with operators drawn between them, e.g. `a < b ^ c`, as the tree that the text without
  // brackets parses to: the operators group as the parser groups them, by their levels.
  const expression = (size: number): Expression => {
    const operandCount = random.weighted([[1, 42], [2, 40], [3, 15], [4, 3]])
    const operands = Array.from({length: operandCount}, () => operand(size))
    // The last operand is the one place where an `if`, a `fun` or a local definition stands without brackets after
    // an operator, e.g. `a + if b then c`.
    if (operandCount > 1 && size > 0 && random.chance(0.3)) operands[operandCount - 1] = openExpression(size)
    const between = Array.from({length: operandCount - 1}, () => random.pick(operators))
    // Precedence climbing over the flat list.
    let place = 0
    const climb = (minimumLevel: number): Expression => {
      let left = operands[place]!
      for (;;) {
        const operator = between[place]
        if (operator === undefined || operatorLevel[operator] < minimumLevel) return left
        place++
        left = operation(operator, left, climb(groupsFromTheRight.includes(operator) ? operatorLevel[operator] : operatorLevel[operator] + 1))
      }
    }
    return climb(0)
  }
  return whole
}

// Every place of an expression in the definitions, as a function that puts another expression there.
function placesOf(definitions: readonly Definition[]): ((replacement: Expression) => void)[] {
  const places: ((replacement: Expression) => void)[] = []
  const visit = (node: Expression, put: (replacement: Expression) => void) => {
    places.push(put)
    switch (node.type) {
      case 'name': case 'literal': case 'unit': return
      case 'tuple': case 'list':
        for (const [place, item] of node.items.entries()) visit(item, replacement => { node.items[place] = replacement })
        return
      case 'brackets': return visit(node.inner, replacement => { node.inner = replacement })
      case 'application':
        visit(node.head, replacement => { node.head = replacement })
        for (const [place, argument] of node.arguments.entries()) visit(argument, replacement => { node.arguments[place] = replacement })
        return
      case 'negation': return visit(node.operand, replacement => { node.operand = replacement })
      case 'operation':
        visit(node.left, replacement => { node.left = replacement })
        visit(node.right, replacement => { node.right = replacement })
        return
      case 'conditional':
        visit(node.condition, replacement => { node.condition = replacement })
        visit(node.then, replacement => { node.then = replacement })
        if (node.otherwise !== undefined) visit(node.otherwise, replacement => { node.otherwise = replacement })
        return
      case 'function': return visit(node.body, replacement => { node.body = replacement })
      case 'local':
        visit(node.binding.value, replacement => { node.binding.value = replacement })
        visit(node.body, replacement => { node.body = replacement })
        return
    }
  }
  for (const {binding} of definitions) visit(binding.value, replacement => { binding.value = replacement })
  return places
}

// Calls `rename` for every name of the definitions, also where a name is defined, and puts what it returns in its place.
function renameAll(definitions: readonly Definition[], rename: (name: string) => string) {
  const binderOf = (binder: string): string => isName(binder) ? rename(binder) : binder
  const inBinding = (binding: Binding) => {
    binding.target = binderOf(binding.target)
    binding.parameters = binding.parameters.map(binderOf)
    visit(binding.value)
  }
  const visit = (node: Expression): void => {
    switch (node.type) {
      case 'name': node.text = rename(node.text); return
      case 'literal': case 'unit': return
      case 'tuple': case 'list': return node.items.forEach(visit)
      case 'brackets': return visit(node.inner)
      case 'application': visit(node.head); return node.arguments.forEach(visit)
      case 'negation': return visit(node.operand)
      case 'operation': visit(node.left); return visit(node.right)
      case 'conditional':
        visit(node.condition)
        visit(node.then)
        if (node.otherwise !== undefined) visit(node.otherwise)
        return
      case 'function': node.parameters = node.parameters.map(binderOf); return visit(node.body)
      case 'local': inBinding(node.binding); return visit(node.body)
    }
  }
  for (const {binding} of definitions) inBinding(binding)
}

function drawStyle(random: Random): Style {
  return {
    unit: random.weighted([['  ', 55], ['    ', 22], ['\t', 12], ['   ', 5], [' ', 3], ['        ', 3]]),
    width: random.weighted([[80, 45], [100, 15], [60, 22], [40, 13], [120, 5]]),
    definitionsOnOneLine: random.chance(0.12),
    breakLocal: random.weighted([[1, 60], [0.7, 25], [0.2, 15]]),
    breakConditional: random.pick([0.1, 0.5, 0.9]),
    branchOnOwnLine: random.pick([0, 0.2, 0.8]),
    breakAfterEquals: random.pick([0, 0.15, 0.6, 1]),
    breakList: random.pick([0, 0, 0.2, 0.6]),
    inOnOwnLine: random.pick([0, 0.5, 1]),
    operatorFirst: random.chance(0.6),
    listAsBlock: random.chance(0.6),
    comma: random.chance(0.88) ? ', ' : ',',
    semicolon: random.chance(0.85) ? '; ' : ';',
    spaceInsideBrackets: random.chance(0.08),
    tightOperators: random.weighted<readonly Operator[]>([[[], 75], [['::'], 10], [['::', '^'], 3], [['+', '-', '*', '/'], 6], [operators, 3], [['*', '/'], 3]]),
    tightEquals: random.chance(0.03),
    bareOpenOperand: random.pick([0.5, 0.8, 1]),
    bracketCondition: random.weighted([[0, 70], [1, 15], [0.4, 15]]),
    bracketOperand: random.weighted([[0, 60], [0.05, 25], [0.2, 15]]),
  }
}

// A comment with the given text. A text of several lines keeps its line breaks.
const comment = (text: string): string => `(*${text.startsWith('*') ? '' : ' '}${text} *)`

// The text of a program: its definitions in the style, with comments and blank lines between them.
function textOfProgram(definitions: readonly Definition[], sort: Sort, style: Style, random: Random): string {
  const commentText = (): string => random.pick(commentTexts)
  // Everything on one line, as a program that a tool has printed.
  if (random.chance(0.03)) {
    const parts = definitions.map(({binding}) => linesOfDefinition({...binding, value: withBrackets(binding.value, 0, true, false, style, random)}, {...style, definitionsOnOneLine: true}, random)[0]!)
    if (random.chance(0.2)) parts.splice(random.integer(0, parts.length), 0, comment(commentText()))
    return parts.join(random.chance(0.85) ? ' ' : '  ') + (random.chance(0.6) ? '\n' : '')
  }
  // How often a definition has the comment of its idiom before it, and how often some other comment.
  const idiomComments = random.weighted([[0, 35], [0.5, 35], [1, 30]]), otherComments = random.weighted([[0, 55], [0.1, 30], [0.3, 15]])
  const gapStyle = sort === 'settings' && random.chance(0.5) ? 'none' : random.weighted([['one', 50], ['none', 22], ['two', 5], ['mixed', 23]] as const)
  const lines: string[] = []
  if (random.chance(0.3)) {
    const header = random.chance(0.75) ? random.pick(headerComments[sort]) : commentText()
    // A header of one line, of several lines, or as a box of stars.
    lines.push(...random.weighted([
      [[comment(header)], 75],
      [`(* ${header}\n   ${commentText()} *)`.split('\n'), 12],
      [[`(*${'*'.repeat(header.length + 2)}*)`, `(* ${header} *)`, `(*${'*'.repeat(header.length + 2)}*)`], 5],
      [[`(** ${header} *)`], 8],
    ]))
    if (random.chance(0.7)) lines.push('')
  }
  for (const [place, {binding, comment: idiomComment}] of definitions.entries()) {
    if (place > 0) {
      const blankLines = gapStyle === 'one' ? 1 : gapStyle === 'none' ? 0 : gapStyle === 'two' ? 2 : random.weighted([[0, 3], [1, 6], [2, 1]])
      for (let blank = 0; blank < blankLines; blank++) lines.push('')
    }
    if (idiomComment !== undefined && random.chance(idiomComments)) lines.push(comment(idiomComment))
    else if (random.chance(otherComments)) lines.push(comment(commentText()))
    // A definition that is commented out.
    if (random.chance(0.012)) lines.push(comment(`let ${random.pick(['old', 'unused', 'debug', 'tmp', 'prev'])} = ${random.integer(0, 100)}`))
    lines.push(...linesOfDefinition({...binding, value: withBrackets(binding.value, 0, true, false, style, random)}, style, random))
  }
  if (random.chance(0.03)) lines.push(...(random.chance(0.5) ? [''] : []), comment(random.pick(['end', 'EOF', 'the end', commentText()])))
  let text = lines.join('\n')
  // Comments inside the definitions: at the end of a line, and in a few programs between two tokens of a line.
  // The scanner says where white space is, so that no comment lands inside a string or inside another comment.
  const insertions: {at: number, text: string}[] = []
  const atLineEnd = random.weighted([[0, 72], [0.06, 20], [0.15, 8]]), midLine = random.chance(0.04) ? 0.03 : 0
  const tokens = scan(Array.from(text, character => character.codePointAt(0)!))
  for (let token = 0; token < tokens.count; token++) {
    if (tokens.kind[token] === newlineKind && token > 0 && tokens.kind[token - 1] !== newlineKind && random.chance(atLineEnd)) insertions.push({at: tokens.start[token]!, text: `${random.pick([' ', '  ', '  ', '    '])}${comment(commentText())}`})
    else if (tokens.kind[token] === whitespaceKind && token > 0 && tokens.kind[token - 1] !== newlineKind && random.chance(midLine)) insertions.push({at: tokens.start[token]!, text: ` ${comment(commentText())}`})
  }
  if (insertions.length > 0) {
    const codePoints = Array.from(text)
    for (const insertion of insertions.reverse()) codePoints.splice(insertion.at, 0, insertion.text)
    text = codePoints.join('')
  }
  // Spaces at the end of a line, as an editor leaves them.
  if (random.chance(0.03)) text = text.split('\n').map(line => line !== '' && random.chance(0.2) ? `${line}${random.pick([' ', '  '])}` : line).join('\n')
  text += random.weighted([['\n', 85], ['', 13], ['\n\n', 2]])
  if (random.chance(0.02)) text = `\n${text}`
  // Lines that end with a carriage return and a line feed, as in a file from Windows.
  if (random.chance(0.02)) text = text.replaceAll('\n', '\r\n')
  return text
}

// A program with no definition: a file that holds comments only, e.g. settings that are all commented out. It is
// the one valid program that the parser accepts from its first state.
function textWithoutDefinitions(sort: Sort, random: Random): string {
  const lines = [comment(random.pick(headerComments[sort]))]
  for (let line = random.integer(0, 3); line > 0; line--) lines.push(comment(random.chance(0.5) ? `let ${random.pick(['debug', 'limit', 'port', 'x', 'verbose'])} = ${random.integer(0, 100)}` : random.pick(commentTexts)))
  return lines.join('\n') + (random.chance(0.8) ? '\n' : '')
}

function writeProgram(random: Random): {text: string, sort: Sort} {
  const sort = random.pick(sorts)
  if (random.chance(0.004)) return {text: textWithoutDefinitions(sort, random), sort}
  const functions: KnownFunction[] = []
  const {fill, number, string} = createFiller(random, functions)
  const definitions: Definition[] = []
  // The values that the program has defined so far, and the texts of the idioms that it has used.
  const values: {name: string, kind: Kind}[] = []
  const definedNames = new Set<string>(), usedIdioms = new Set<string>()
  const style = drawStyle(random)
  // How long the program is to be, in code points: short in one program in five.
  const targetLength = random.chance(0.2) ? random.integer(15, 120) : random.integer(60, 400)
  let length = 0
  for (let tries = 0; tries < 40 && length < targetLength && definitions.length < 14; tries++) {
    const source = random.weighted([[idiomsOfSort[sort], 86], [commonIdioms, 7], [idiomsOfSort[random.pick(sorts)], 7]])
    const template = random.pick(source)
    if (usedIdioms.has(template)) continue
    const idiom = idiomOf(withAlternativesDrawn(template, random))
    // No name is defined twice at the top of a program.
    if (idiom.definitions.some(({binding}) => isName(binding.target) && definedNames.has(binding.target))) continue
    usedIdioms.add(template)
    for (const {binding, comment: idiomComment} of idiom.definitions) {
      const scope = [...values, ...binding.parameters.filter(isName).map(parameter => ({name: parameter, kind: kindOfName(parameter)}))]
      const definition = {binding: {...binding, parameters: [...binding.parameters], value: filled(binding.value, scope, fill)}, comment: idiomComment}
      definitions.push(definition)
      length += inline(definition.binding.value, style).length + binding.target.length + 2 * binding.parameters.length + 8
      if (!isName(binding.target)) continue
      definedNames.add(binding.target)
      if (binding.parameters.length > 0) functions.push({name: binding.target, parameters: binding.parameters.map(parameter => isName(parameter) ? kindOfName(parameter) : 'unit'), result: idiom.kind})
      else values.push({name: binding.target, kind: idiom.kind})
    }
  }
  if (definitions.length === 0) return writeProgram(random)
  // Free expressions, in one program in three.
  const namesOfProgram = new Set<string>(['x'])
  renameAll(definitions, found => { namesOfProgram.add(found); return found })
  const freeExpression = createFreeExpressions(random, [...namesOfProgram], number, string)
  for (let count = random.weighted([[0, 67], [1, 23], [2, 8], [3, 2]]); count > 0; count--) {
    // At most 80 code points on one line: a longer one is drawn again.
    const size = random.weighted([[1, 5], [2, 5]])
    let drawn = freeExpression(size)
    for (let tries = 0; tries < 30 && inline(withBrackets(drawn, 0, true, false, style, random), style).length > 80; tries++) drawn = freeExpression(size)
    random.pick(placesOf(definitions))(drawn)
  }
  // A `rec` too many or one too few, and a parameter that is `_` or `()`: both stay valid.
  if (random.chance(0.04)) {
    // In one case of two a definition of `_` or `()`, where the program has one: `let rec () = ..` is valid too.
    const withoutName = definitions.filter(({binding}) => !isName(binding.target))
    const {binding} = random.pick(withoutName.length > 0 && random.chance(0.5) ? withoutName : definitions)
    binding.recursive = !binding.recursive
  }
  if (random.chance(0.02)) {
    const {binding} = random.pick(definitions)
    if (isName(binding.target)) binding.parameters.splice(random.integer(0, binding.parameters.length), 0, random.pick(['_', '()']))
  }
  // One written name per name of the vocabulary. Another name is only taken when nothing else in the program has it.
  const present = new Set<string>()
  renameAll(definitions, found => { present.add(found); return found })
  const writtenNames = new Map<string, string>()
  for (const found of [...present]) {
    const others = (vocabulary[found] ?? []).slice(1).filter(other => !present.has(other))
    if (others.length === 0 || random.chance(0.5)) continue
    const written = random.pick(others)
    writtenNames.set(found, written)
    present.add(written)
  }
  // `hd` goes with `tl`: a program that writes `head` short writes `tail` short too, and no other program does.
  if (present.has('head') && present.has('tail')) {
    if (writtenNames.get('head') !== 'hd') writtenNames.delete('tail')
    else if (writtenNames.get('tail') === 'tl' || !present.has('tl')) writtenNames.set('tail', 'tl')
  }
  renameAll(definitions, found => writtenNames.get(found) ?? found)
  // The layout. A program that comes out too long loses its last definition.
  for (;;) {
    const text = textOfProgram(definitions, sort, style, random)
    if (Array.from(text).length <= maximumCodePoints) return {text, sort}
    if (definitions.length === 1) return writeProgram(random)
    definitions.pop()
  }
}

// The program with the given index and its sort. It is a function of the seed and the index alone.
export function programOf(seed: number, index: number): {text: string, sort: Sort} {
  return writeProgram(createRandom(seed, index))
}
export const generateProgram = (seed: number, index: number): string => programOf(seed, index).text
export const sortOfProgram = (seed: number, index: number): Sort => programOf(seed, index).sort

if (import.meta.main) {
  const seed = Number(process.argv[2] ?? 1), first = Number(process.argv[3] ?? 0), count = Number(process.argv[4] ?? 1)
  for (let index = first; index < first + count; index++) {
    const {text, sort} = programOf(seed, index)
    console.log(`--- ${index} ${sort}\n${text}`)
  }
}
