// Kinds of mistakes written for miniml: what a person or a language model gets wrong when writing a program in it.
// Each kind turns a valid program into a broken one as edits on the program's code points, so that every code point
// that an edit leaves alone keeps the label of the original, by the alignment of ../sample.ts.
//
// A kind is applied to a program as scanProgram reads it: the tokens, which bracket closes which, the definitions at
// the top, the local definitions with their `in`, the functions. It returns undefined when the program has no place
// for it, e.g. `!=` for `<>` in a program without `<>`.
//
// The kinds were written in under an hour, under a deadline, and nobody reviewed them. See the README.
import type {ValidLabels} from '../labels.ts'
import {displayKind} from '../labels.ts'
import {textOf} from '../parser.ts'
import type {Random} from '../random.ts'
import {commentKind, isTrivia, symbolOf} from '../tables.ts'

export const families = [
  // What OCaml has and miniml lacks: `;;`, `in` at the top, a sequence with `;`, types, patterns, floats, `open`.
  'OCaml that miniml lacks',
  // What another language writes in that place: `==`, `!=`, `%`, `=>`, `elif`, `def`, braces, a `;` at the line's end.
  'habits of other languages',
  // The wrong separator in a list or a tuple, a separator too many, a tuple without its brackets.
  'lists and tuples',
  // A bracket, an `in`, a `then`, a quote or a body that is missing, too many, or of the other kind.
  'brackets and unfinished code',
  // Text around a program that is itself fine: a code fence, marker lines of a merge conflict, the prompt of the toplevel.
  'around the program',
] as const
export type Family = typeof families[number]

// An edit on the code points of the original: at `at`, `remove` code points go and the text `insert` comes.
export type Edit = {at: number, remove: number, insert: string}
const insertAt = (at: number, text: string): Edit => ({at, remove: 0, insert: text})
const removeRange = (from: number, to: number): Edit => ({at: from, remove: to - from, insert: ''})
const replaceRange = (from: number, to: number, text: string): Edit => ({at: from, remove: to - from, insert: text})

export type Damage = {
  edits: Edit[]
  // Which variant of the kind this is, e.g. "=> for ->".
  form: string
  // True when the edits touch the whole text, e.g. a code fence. Two kinds in one sample must sit apart unless one
  // of them is such a damage.
  wholeText?: boolean
}

export type KindDefinition = {
  name: string
  family: Family
  // How often the kind is drawn, relative to the other kinds. An estimate, see the README.
  weight: number
  // Who makes the mistake and why, in one sentence.
  who: string
  // A short broken text, with ⏎ for a line feed.
  example: string
  apply: (random: Random, scanned: Scanned) => Damage | undefined
}

export type Token = {terminal: number, start: number, end: number, text: string}
// A `let` with what it defines: places in `tokens`. `name` is the name, `_` or the `(` of `()`. `parameters` are the
// tokens between the name and the `=`.
export type Binding = {let: number, rec: boolean, name: number, parameters: number[], equals: number}
export type Definition = Binding & {last: number}
export type LocalDefinition = Binding & {in: number}
export type FunctionStart = {fun: number, parameters: number[], arrow: number}
export type Scanned = {
  text: string
  codePoints: Int32Array
  labels: ValidLabels
  // The tokens without white space and comments.
  tokens: Token[]
  comments: {start: number, end: number}[]
  // Per token: the token of the bracket that it opens or closes, or -1.
  partner: Int32Array
  // Per opening bracket: the `,` and `;` that stand directly inside it.
  separators: Map<number, number[]>
  // The definitions at the top, in order, and the local ones.
  definitions: Definition[]
  locals: LocalDefinition[]
  functions: FunctionStart[]
}

const terminalNames = ['LET', 'REC', 'IN', 'IF', 'THEN', 'ELSE', 'FUN', 'TRUE', 'FALSE', 'IDENT', 'INT', 'STRING', 'ARROW', 'EQ', 'NE', 'PLUS', 'MINUS', 'STAR', 'SLASH', 'CONS', 'CARET', 'LPAREN', 'RPAREN', 'LBRACK', 'RBRACK', 'COMMA', 'SEMI', 'UNDERSCORE'] as const
const T = Object.fromEntries(terminalNames.map(name => [name, symbolOf(name)])) as Record<typeof terminalNames[number], number>

export function scanProgram(text: string, labels: ValidLabels): Scanned {
  const {codePoints} = labels
  const tokens: Token[] = [], comments: {start: number, end: number}[] = []
  for (let token = 0; token < labels.tokens.count; token++) {
    const kind = labels.tokens.kind[token]!, start = labels.tokens.start[token]!, end = start + labels.tokens.length[token]!
    if (kind === commentKind) comments.push({start, end})
    else if (!isTrivia(kind)) tokens.push({terminal: kind, start, end, text: textOf(codePoints.subarray(start, end))})
  }
  const partner = new Int32Array(tokens.length).fill(-1)
  const separators = new Map<number, number[]>()
  const open: number[] = [], lets: number[] = []
  const inOf = new Map<number, number>()
  const functions: FunctionStart[] = []
  const bindingOf = (letToken: number): Binding => {
    const rec = tokens[letToken + 1]!.terminal === T.REC
    const name = letToken + (rec ? 2 : 1)
    let equals = name + 1
    while (tokens[equals]!.terminal !== T.EQ) equals++
    const parameters: number[] = []
    if (tokens[name]!.terminal !== T.LPAREN) for (let token = name + 1; token < equals; token++) parameters.push(token)
    return {let: letToken, rec, name, parameters, equals}
  }
  tokens.forEach((token, index) => {
    const {terminal} = token
    if (terminal === T.LPAREN || terminal === T.LBRACK) {
      open.push(index)
      separators.set(index, [])
    } else if (terminal === T.RPAREN || terminal === T.RBRACK) {
      const opener = open.pop()!
      partner[opener] = index
      partner[index] = opener
    } else if (terminal === T.COMMA || terminal === T.SEMI) separators.get(open.at(-1)!)?.push(index)
    else if (terminal === T.LET) lets.push(index)
    // A local definition's `in` belongs to the nearest `let` before it that has none yet.
    else if (terminal === T.IN) inOf.set(lets.pop()!, index)
    else if (terminal === T.FUN) {
      let arrow = index + 1
      while (tokens[arrow]!.terminal !== T.ARROW) arrow++
      const parameters: number[] = []
      for (let parameter = index + 1; parameter < arrow; parameter++) parameters.push(parameter)
      functions.push({fun: index, parameters, arrow})
    }
  })
  // The `let`s that are left have no `in`: they are the definitions at the top.
  const definitions = lets.map((letToken, place) => ({...bindingOf(letToken), last: (lets[place + 1] ?? tokens.length) - 1}))
  const locals = [...inOf].map(([letToken, inToken]) => ({...bindingOf(letToken), in: inToken})).sort((left, right) => left.let - right.let)
  return {text, codePoints, labels, tokens, comments, partner, separators, definitions, locals, functions}
}

const lineFeed = 10, space = 32, tab = 9
const pick = <Item>(random: Random, items: readonly Item[]): Item | undefined => items.length === 0 ? undefined : random.pick(items)
const lineStartOf = (scanned: Scanned, position: number): number => {
  let start = position
  while (start > 0 && scanned.codePoints[start - 1] !== lineFeed) start--
  return start
}
const lineEndOf = (scanned: Scanned, position: number): number => {
  let end = position
  while (end < scanned.codePoints.length && scanned.codePoints[end] !== lineFeed) end++
  return end
}
// Whether only spaces and tabs stand between the line's start and the position.
const firstOnLine = (scanned: Scanned, position: number): boolean => {
  for (let at = lineStartOf(scanned, position); at < position; at++) if (scanned.codePoints[at] !== space && scanned.codePoints[at] !== tab) return false
  return true
}
const lastOnLine = (scanned: Scanned, position: number): boolean => {
  for (let at = position, end = lineEndOf(scanned, position); at < end; at++) if (scanned.codePoints[at] !== space && scanned.codePoints[at] !== tab) return false
  return true
}
const tokensOf = (scanned: Scanned, terminal: number): number[] => scanned.tokens.flatMap((token, index) => token.terminal === terminal ? [index] : [])
// The brackets that are no `()`: the places of the opening ones.
const brackets = (scanned: Scanned, terminal: number): number[] => tokensOf(scanned, terminal).filter(index => scanned.partner[index] !== index + 1)
const tuples = (scanned: Scanned): number[] => brackets(scanned, T.LPAREN).filter(index => scanned.separators.get(index)!.length > 0)
const listsWithSeparators = (scanned: Scanned): number[] => brackets(scanned, T.LBRACK).filter(index => scanned.separators.get(index)!.length > 0)
const endsAnAtom = (terminal: number): boolean => terminal === T.IDENT || terminal === T.INT || terminal === T.STRING || terminal === T.RPAREN || terminal === T.RBRACK || terminal === T.TRUE || terminal === T.FALSE
const isOperatorToken = (scanned: Scanned, index: number): boolean => scanned.labels.kind[scanned.tokens[index]!.start] === displayKind.operator
const allBindings = (scanned: Scanned): Binding[] => [...scanned.definitions, ...scanned.locals]
const typeNames = ['int', 'int', 'string', 'bool', 'unit', 'int list', 'float', '\'a', '\'a list'] as const

const ocamlKinds: KindDefinition[] = [
  {
    name: 'doubleSemicolon', family: 'OCaml that miniml lacks', weight: 4,
    who: 'Someone used to the OCaml toplevel or to old OCaml files, where `;;` ends a definition',
    example: 'let limit = 10;;⏎let twice x = 2 * x;;',
    apply: (random, scanned) => {
      const {definitions, tokens} = scanned
      if (definitions.length === 0) return undefined
      if (random.chance(0.5)) return {edits: definitions.map(definition => insertAt(tokens[definition.last]!.end, ';;')), form: ';; after every definition'}
      return {edits: [insertAt(tokens[random.pick(definitions).last]!.end, ';;')], form: ';; after one definition'}
    },
  },
  {
    name: 'inAfterTopDefinition', family: 'OCaml that miniml lacks', weight: 3,
    who: 'Someone who writes every `let` with its `in`, as inside a function, also at the top',
    example: 'let limit = 10 in⏎let twice x = 2 * x',
    apply: (random, scanned) => {
      const definition = pick(random, scanned.definitions.slice(0, -1))
      return definition && {edits: [insertAt(scanned.tokens[definition.last]!.end, ' in')], form: 'in after a definition at the top'}
    },
  },
  {
    name: 'sequenceSemicolon', family: 'OCaml that miniml lacks', weight: 3,
    who: 'An OCaml writer who runs two expressions one after the other with `;`, which miniml has only inside a list',
    example: 'let () = print_string "a";⏎print_string "b"',
    apply: (random, scanned) => {
      const {definitions, tokens} = scanned
      const places: number[] = []
      for (let place = 0; place + 1 < definitions.length; place++) {
        const before = definitions[place]!, next = definitions[place + 1]!
        const definesNothing = (definition: Definition): boolean => tokens[definition.name]!.terminal === T.LPAREN || tokens[definition.name]!.terminal === T.UNDERSCORE
        // The first of the two is a function's body or the right side of `let () =`: nobody runs a second expression after a plain value.
        if (!next.rec && definesNothing(next) && (definesNothing(before) || before.parameters.length > 0)) places.push(place)
      }
      const place = pick(random, places)
      if (place === undefined) return undefined
      const next = definitions[place + 1]!
      return {edits: [insertAt(tokens[definitions[place]!.last]!.end, ';'), removeRange(tokens[next.let]!.start, tokens[next.equals + 1]!.start)], form: 'two definitions of () or _ as one with ; between'}
    },
  },
  {
    name: 'typeAnnotation', family: 'OCaml that miniml lacks', weight: 4,
    who: 'Anyone who writes OCaml, Rust or TypeScript and gives a name its type',
    example: 'let total : int = 0⏎let add (x : int) y : int = x + y',
    apply: (random, scanned) => {
      const {tokens} = scanned
      const type = random.pick(typeNames)
      const bindings = allBindings(scanned).filter(binding => tokens[binding.name]!.terminal === T.IDENT)
      const withParameters = bindings.filter(binding => binding.parameters.some(parameter => tokens[parameter]!.terminal === T.IDENT))
      const form = random.weighted([['the type of a value', bindings.some(binding => binding.parameters.length === 0) ? 3 : 0], ['the type of a result', withParameters.length > 0 ? 2 : 0], ['a parameter with its type', withParameters.length > 0 ? 4 : 0], ['a', 0.001]] as const)
      if (form === 'the type of a value') return {edits: [insertAt(tokens[random.pick(bindings.filter(binding => binding.parameters.length === 0)).name]!.end, ` : ${type}`)], form}
      if (form === 'the type of a result') return {edits: [insertAt(tokens[random.pick(withParameters).equals - 1]!.end, ` : ${type}`)], form}
      if (form === 'a parameter with its type') {
        const parameter = tokens[random.pick(random.pick(withParameters).parameters.filter(parameter => tokens[parameter]!.terminal === T.IDENT))]!
        return {edits: [insertAt(parameter.start, '('), insertAt(parameter.end, ` : ${type})`)], form}
      }
      return undefined
    },
  },
  {
    name: 'patternParameters', family: 'OCaml that miniml lacks', weight: 3,
    who: 'An OCaml writer who takes a pair apart in the parameters, or someone who writes parameters as C does, in brackets with commas',
    example: 'let add (x, y) = x + y⏎let twice(x) = 2 * x',
    apply: (random, scanned) => {
      const {tokens} = scanned
      const lists = [...allBindings(scanned).map(binding => binding.parameters), ...scanned.functions.map(start => start.parameters)].filter(list => list.length > 0 && list.every(parameter => tokens[parameter]!.terminal === T.IDENT || tokens[parameter]!.terminal === T.UNDERSCORE))
      const list = pick(random, random.chance(0.7) ? lists.filter(parameters => parameters.length > 1) : lists)
      if (list === undefined) return undefined
      const edits = [insertAt(tokens[list[0]!]!.start, '('), insertAt(tokens[list.at(-1)!]!.end, ')')]
      for (let place = 1; place < list.length; place++) edits.push(replaceRange(tokens[list[place - 1]!]!.end, tokens[list[place]!]!.start, ', '))
      return {edits, form: list.length > 1 ? 'the parameters as a tuple' : 'one parameter in brackets'}
    },
  },
  {
    name: 'floatNumber', family: 'OCaml that miniml lacks', weight: 3,
    who: 'Anyone who needs a number with a fraction, and an OCaml writer who uses the operators for floats',
    example: 'let half = 0.5⏎let area r = 3 *. r *. r',
    apply: (random, scanned) => {
      const {tokens} = scanned
      const numbers = tokensOf(scanned, T.INT)
      const operators = [T.PLUS, T.MINUS, T.STAR, T.SLASH].flatMap(terminal => tokensOf(scanned, terminal)).filter(index => index > 0 && endsAnAtom(tokens[index - 1]!.terminal))
      const form = random.weighted([['a number with a fraction', numbers.length > 0 ? 3 : 0], ['an operator for floats', operators.length > 0 ? 1 : 0], ['a', 0.001]] as const)
      if (form === 'a number with a fraction') return {edits: [insertAt(tokens[random.pick(numbers)]!.end, random.pick(['.0', '.5', '.25', '.75', '.']))], form}
      if (form === 'an operator for floats') return {edits: [insertAt(tokens[random.pick(operators)]!.end, '.')], form}
      return undefined
    },
  },
  {
    name: 'openLine', family: 'OCaml that miniml lacks', weight: 1.5,
    who: 'An OCaml writer or a model that starts a file by opening a module',
    example: 'open List⏎⏎let total = 0',
    apply: random => ({edits: [insertAt(0, `open ${random.pick(['List', 'Printf', 'Stdlib', 'Base', 'Core'])}\n${random.chance(0.6) ? '\n' : ''}`)], form: 'an open line before the program'}),
  },
]

const otherLanguageKinds: KindDefinition[] = [
  {
    name: 'doubleEquals', family: 'habits of other languages', weight: 4,
    who: 'Anyone coming from C, Java, JavaScript or Python, where equality is `==`',
    example: 'let rec count n = if n == 0 then 0 else 1 + count (n - 1)',
    apply: (random, scanned) => {
      const equals = tokensOf(scanned, T.EQ).filter(index => isOperatorToken(scanned, index))
      const index = pick(random, equals)
      if (index === undefined) return undefined
      const strict = random.chance(0.1)
      // Such a writer does it everywhere, in two samples of three.
      const places = random.chance(0.66) ? equals : [index]
      return {edits: places.map(place => insertAt(scanned.tokens[place]!.end, strict ? '==' : '=')), form: `${strict ? '===' : '=='} for =${places.length > 1 ? ', everywhere' : ''}`}
    },
  },
  {
    name: 'bangEquals', family: 'habits of other languages', weight: 3,
    who: 'Anyone coming from C, Java, JavaScript or Python, where inequality is `!=`, or from Haskell, where it is `/=`',
    example: 'let differs a b = a != b',
    apply: (random, scanned) => {
      const token = pick(random, tokensOf(scanned, T.NE).map(index => scanned.tokens[index]!))
      if (token === undefined) return undefined
      const written = random.weighted([['!=', 8], ['/=', 1], ['!==', 1]] as const)
      return {edits: [replaceRange(token.start, token.end, written)], form: `${written} for <>`}
    },
  },
  {
    name: 'wordOperatorAsSign', family: 'habits of other languages', weight: 3,
    who: 'Anyone coming from C or JavaScript, where the remainder is `%` and negation is `!`',
    example: 'let even n = n % 2 = 0⏎let off = !on',
    apply: (random, scanned) => {
      const {tokens} = scanned
      const places = tokens.flatMap((token, index) => token.terminal === T.IDENT && (token.text === 'mod' || token.text === 'not') && index + 1 < tokens.length ? [index] : [])
      const index = pick(random, places)
      if (index === undefined) return undefined
      const token = tokens[index]!
      if (token.text === 'mod') return {edits: [replaceRange(token.start, token.end, '%')], form: '% for mod'}
      return {edits: [replaceRange(token.start, tokens[index + 1]!.start, '!')], form: '! for not'}
    },
  },
  {
    name: 'arrowFunction', family: 'habits of other languages', weight: 3,
    who: 'Anyone coming from JavaScript, Scala or Java, where a function is `x => x + 1` or `x -> x + 1` without a word before it',
    example: 'let negate = fun x => -x⏎let twice = x -> 2 * x',
    apply: (random, scanned) => {
      const start = pick(random, scanned.functions)
      if (start === undefined) return undefined
      const {tokens} = scanned
      const arrow = tokens[start.arrow]!
      const form = random.weighted([['=> for ->', 5], ['no fun before the parameters', 3], ['no fun and => for ->', 2]] as const)
      const edits: Edit[] = []
      if (form !== 'no fun before the parameters') edits.push(replaceRange(arrow.start, arrow.end, '=>'))
      if (form !== '=> for ->') edits.push(removeRange(tokens[start.fun]!.start, tokens[start.fun + 1]!.start))
      return {edits, form}
    },
  },
  {
    name: 'otherFunKeyword', family: 'habits of other languages', weight: 3,
    who: 'Anyone coming from SML or Rust (`fn`), OCaml or JavaScript (`function`), Python (`lambda`) or Haskell (`\\x ->`)',
    example: 'let negate = fn x -> -x⏎let twice = \\x -> 2 * x',
    apply: (random, scanned) => {
      const start = pick(random, scanned.functions)
      if (start === undefined) return undefined
      const {tokens} = scanned
      const word = random.weighted([['fn', 3], ['function', 3], ['lambda', 2], ['\\', 2]] as const)
      const fun = tokens[start.fun]!
      return {edits: [word === '\\' ? replaceRange(fun.start, tokens[start.fun + 1]!.start, '\\') : replaceRange(fun.start, fun.end, word)], form: `${word} for fun`}
    },
  },
  {
    name: 'elif', family: 'habits of other languages', weight: 3,
    who: 'Anyone coming from Python (`elif`), Ruby (`elsif`) or a shell, in a chain of conditions',
    example: 'let sign x = if x > 0 then 1 elif x < 0 then -1 else 0',
    apply: (random, scanned) => {
      const {tokens} = scanned
      const places = tokensOf(scanned, T.ELSE).filter(index => tokens[index + 1]?.terminal === T.IF)
      if (places.length === 0) return undefined
      const word = random.weighted([['elif', 6], ['elsif', 2], ['elseif', 2]] as const)
      // The whole chain in half of the samples, one place otherwise.
      const chosen = random.chance(0.5) ? places : [random.pick(places)]
      return {edits: chosen.map(index => replaceRange(tokens[index]!.start, tokens[index + 1]!.end, word)), form: `${word} for else if${chosen.length > 1 ? ', everywhere' : ''}`}
    },
  },
  {
    name: 'conditionWithoutThen', family: 'habits of other languages', weight: 3,
    who: 'Anyone coming from C or JavaScript, where no word follows the condition, or from Python, where a colon does',
    example: 'let sign x = if (x > 0) 1 else 0⏎let big x = if x > 9: true else false',
    apply: (random, scanned) => {
      const {tokens} = scanned
      const index = pick(random, tokensOf(scanned, T.THEN))
      if (index === undefined) return undefined
      const colon = random.chance(0.4)
      return {edits: [replaceRange(tokens[index - 1]!.end, tokens[index]!.end, colon ? ':' : '')], form: colon ? ': for then' : 'no then'}
    },
  },
  {
    name: 'otherDefinitionKeyword', family: 'habits of other languages', weight: 3,
    who: 'Anyone coming from SML (`fun f x =`, `val x =`), JavaScript (`const`, `var`), Scala or Python (`def`)',
    example: 'val limit = 10⏎fun twice x = 2 * x',
    apply: (random, scanned) => {
      const {tokens, definitions} = scanned
      const functions = definitions.filter(definition => definition.parameters.length > 0)
      const first = definitions[0]
      if (first === undefined) return undefined
      // A word that is no keyword of miniml reads as a name after the definition before it, so only the first
      // definition gets one.
      if (functions.length === 0 || random.chance(0.4)) {
        const word = first.parameters.length > 0 ? random.pick(['def', 'fn', 'func', 'function']) : random.pick(['val', 'const', 'var', 'def'])
        return {edits: [replaceRange(tokens[first.let]!.start, tokens[first.let]!.end, word)], form: `${word} for the first let`}
      }
      const everywhere = random.chance(0.5)
      const chosen = everywhere ? functions : [random.pick(functions)]
      return {edits: chosen.map(definition => replaceRange(tokens[definition.let]!.start, tokens[definition.rec ? definition.let + 1 : definition.let]!.end, 'fun')), form: `fun for the let of a function${everywhere ? ', everywhere' : ''}`}
    },
  },
  {
    name: 'semicolonAfterDefinition', family: 'habits of other languages', weight: 4,
    who: 'Anyone coming from C, Java, JavaScript or Rust, where a statement ends with `;`',
    example: 'let limit = 10;⏎let twice x = 2 * x;',
    apply: (random, scanned) => {
      const {definitions, tokens} = scanned
      if (definitions.length === 0) return undefined
      if (random.chance(0.6)) return {edits: definitions.map(definition => insertAt(tokens[definition.last]!.end, ';')), form: '; after every definition'}
      return {edits: [insertAt(tokens[random.pick(definitions).last]!.end, ';')], form: '; after one definition'}
    },
  },
  {
    name: 'bracesAroundBody', family: 'habits of other languages', weight: 2,
    who: 'Anyone coming from C, Java, JavaScript or Rust, where a function\'s body stands in braces',
    example: 'let twice x = {⏎  2 * x⏎}',
    apply: (random, scanned) => {
      const {tokens} = scanned
      const definition = pick(random, scanned.definitions.filter(definition => definition.parameters.length > 0))
      if (definition === undefined) return undefined
      const severalLines = lineEndOf(scanned, tokens[definition.equals]!.end) < tokens[definition.last]!.start
      return {edits: [insertAt(tokens[definition.equals]!.end, ' {'), insertAt(tokens[definition.last]!.end, severalLines ? '\n}' : ' }')], form: 'braces around the body of a function'}
    },
  },
  {
    name: 'singleQuoteString', family: 'habits of other languages', weight: 3,
    who: 'Anyone coming from Python, JavaScript or a shell, where a string can stand between single quotes',
    example: 'let greeting = \'hello\'',
    apply: (random, scanned) => {
      const strings = tokensOf(scanned, T.STRING).map(index => scanned.tokens[index]!).filter(token => !token.text.slice(1, -1).includes('\'') && !token.text.includes('\\'))
      if (strings.length === 0) return undefined
      const chosen = random.chance(0.5) ? strings : [random.pick(strings)]
      return {edits: chosen.flatMap(token => [replaceRange(token.start, token.start + 1, '\''), replaceRange(token.end - 1, token.end, '\'')]), form: `single quotes around a string${chosen.length > 1 ? ', everywhere' : ''}`}
    },
  },
  {
    name: 'otherComment', family: 'habits of other languages', weight: 4,
    who: 'Anyone coming from C or JavaScript (`//`), Python or a shell (`#`), Haskell or SQL (`--`)',
    example: 'let limit = 10 // the most⏎# helpers⏎let twice x = 2 * x',
    apply: (random, scanned) => {
      const {codePoints} = scanned
      // A comment on one line with nothing after it on that line: the other languages' comments end with the line.
      // It has a space after its `(*` and before its `*)`, which leaves out a line of stars.
      const comments = scanned.comments.filter(comment => comment.end - comment.start >= 7 && codePoints[comment.start + 2] === space && codePoints[comment.end - 3] === space && lastOnLine(scanned, comment.end) && lineEndOf(scanned, comment.start) >= comment.end)
      if (comments.length === 0) return undefined
      const mark = random.weighted([['//', 5], ['#', 4], ['--', 2]] as const)
      const chosen = random.chance(0.6) ? comments : [random.pick(comments)]
      return {
        edits: chosen.flatMap(comment => {
          return [replaceRange(comment.start, comment.start + 2, mark), removeRange(comment.end - 3, comment.end)]
        }),
        form: `${mark} for a comment${chosen.length > 1 ? ', everywhere' : ''}`,
      }
    },
  },
  {
    name: 'haskellOperator', family: 'habits of other languages', weight: 2,
    who: 'Anyone coming from Haskell or Elm, where a list is built with `:` and joined with `++`',
    example: 'let full = first ++ " " ++ last⏎let more = 1 : rest',
    apply: (random, scanned) => {
      const {tokens} = scanned
      const places = [...tokensOf(scanned, T.CARET), ...tokensOf(scanned, T.CONS)]
      const index = pick(random, places)
      if (index === undefined) return undefined
      const token = tokens[index]!
      const same = random.chance(0.6) ? places.filter(place => tokens[place]!.terminal === token.terminal) : [index]
      const written = token.terminal === T.CARET ? '++' : ':'
      return {edits: same.map(place => replaceRange(tokens[place]!.start, tokens[place]!.end, written)), form: `${written} for ${token.text}${same.length > 1 ? ', everywhere' : ''}`}
    },
  },
]

const listAndTupleKinds: KindDefinition[] = [
  {
    name: 'commaInList', family: 'lists and tuples', weight: 4,
    who: 'Nearly everyone at first: every other language separates the items of a list with commas',
    example: 'let primes = [2, 3, 5, 7]',
    apply: (random, scanned) => {
      const list = pick(random, listsWithSeparators(scanned))
      if (list === undefined) return undefined
      return {edits: scanned.separators.get(list)!.map(index => replaceRange(scanned.tokens[index]!.start, scanned.tokens[index]!.end, ',')), form: 'commas between the items of a list'}
    },
  },
  {
    name: 'semicolonInTuple', family: 'lists and tuples', weight: 1.5,
    who: 'Someone who has just learned that lists take `;` and now writes it in a tuple too',
    example: 'let pair = (1; "one")',
    apply: (random, scanned) => {
      const tuple = pick(random, tuples(scanned))
      if (tuple === undefined) return undefined
      return {edits: scanned.separators.get(tuple)!.map(index => replaceRange(scanned.tokens[index]!.start, scanned.tokens[index]!.end, ';')), form: 'semicolons between the parts of a tuple'}
    },
  },
  {
    name: 'trailingSeparator', family: 'lists and tuples', weight: 3,
    who: 'An OCaml writer, whose lists may end with `;`, and anyone from Python, JavaScript or Rust, whose tuples and lists may end with `,`',
    example: 'let primes = [2; 3; 5;]⏎let pair = (1, "one",)',
    apply: (random, scanned) => {
      const {tokens, partner} = scanned
      const opener = pick(random, [...brackets(scanned, T.LBRACK), ...tuples(scanned)])
      if (opener === undefined) return undefined
      const separator = tokens[opener]!.terminal === T.LBRACK ? ';' : ','
      return {edits: [insertAt(tokens[partner[opener]! - 1]!.end, separator)], form: `a ${separator} after the last ${separator === ';' ? 'item of a list' : 'part of a tuple'}`}
    },
  },
  {
    name: 'tupleWithoutBrackets', family: 'lists and tuples', weight: 2,
    who: 'An OCaml, Python or Haskell writer: there a tuple needs no brackets',
    example: 'let pair = 1, "one"',
    apply: (random, scanned) => {
      const {tokens, partner} = scanned
      const before = new Set([T.EQ, T.IN, T.THEN, T.ELSE, T.ARROW])
      const tuple = pick(random, tuples(scanned).filter(index => index > 0 && before.has(tokens[index - 1]!.terminal)))
      if (tuple === undefined) return undefined
      return {edits: [removeRange(tokens[tuple]!.start, tokens[tuple]!.end), removeRange(tokens[partner[tuple]!]!.start, tokens[partner[tuple]!]!.end)], form: 'a tuple without its brackets'}
    },
  },
]

const bracketKinds: KindDefinition[] = [
  {
    name: 'missingClosingBracket', family: 'brackets and unfinished code', weight: 4,
    who: 'Everyone: a `)` or a `]` that was never typed or was deleted with the text before it',
    example: 'let rec count n = 1 + count (n - 1⏎let limit = 10',
    apply: (random, scanned) => {
      const opener = pick(random, [...brackets(scanned, T.LPAREN), ...brackets(scanned, T.LBRACK)])
      if (opener === undefined) return undefined
      const closer = scanned.tokens[scanned.partner[opener]!]!
      return {edits: [removeRange(closer.start, closer.end)], form: `no ${closer.text}`}
    },
  },
  {
    name: 'extraClosingBracket', family: 'brackets and unfinished code', weight: 3,
    who: 'Everyone, above all with an editor that closes brackets by itself: one closing bracket too many',
    example: 'let rec count n = 1 + count (n - 1))',
    apply: (random, scanned) => {
      const opener = pick(random, [...brackets(scanned, T.LPAREN), ...brackets(scanned, T.LBRACK)])
      if (opener === undefined) return undefined
      const closer = scanned.tokens[scanned.partner[opener]!]!
      return {edits: [insertAt(closer.end, closer.text)], form: `a second ${closer.text}`}
    },
  },
  {
    name: 'wrongClosingBracket', family: 'brackets and unfinished code', weight: 2,
    who: 'Everyone: the closing bracket of the other kind',
    example: 'let primes = [2; 3; 5)',
    apply: (random, scanned) => {
      const opener = pick(random, [...brackets(scanned, T.LPAREN), ...brackets(scanned, T.LBRACK)])
      if (opener === undefined) return undefined
      const closer = scanned.tokens[scanned.partner[opener]!]!
      const written = random.chance(0.85) ? (closer.text === ')' ? ']' : ')') : '}'
      return {edits: [replaceRange(closer.start, closer.end, written)], form: `${written} for ${closer.text}`}
    },
  },
  {
    name: 'missingIn', family: 'brackets and unfinished code', weight: 4,
    who: 'Every OCaml writer, often: a local definition without its `in`',
    example: 'let area w h =⏎  let half = w / 2⏎  half * h⏎let limit = 10',
    apply: (random, scanned) => {
      const local = pick(random, scanned.locals)
      if (local === undefined) return undefined
      return {edits: [removeRange(scanned.tokens[local.in - 1]!.end, scanned.tokens[local.in]!.end)], form: 'a local definition without in'}
    },
  },
  {
    name: 'unbracketedArgument', family: 'brackets and unfinished code', weight: 3,
    who: 'Anyone who passes a function, a conditional or a local definition as an argument and forgets that it needs brackets',
    example: 'let doubled = map fun x -> 2 * x',
    apply: (random, scanned) => {
      const {tokens, partner} = scanned
      const inside = new Set([T.FUN, T.IF, T.LET])
      const opener = pick(random, brackets(scanned, T.LPAREN).filter(index => index > 0 && endsAnAtom(tokens[index - 1]!.terminal) && inside.has(tokens[index + 1]!.terminal)))
      if (opener === undefined) return undefined
      const closer = tokens[partner[opener]!]!
      // A space stays where the bracket touched the token before it, e.g. `f(fun x -> x)`.
      return {edits: [replaceRange(tokens[opener]!.start, tokens[opener]!.end, tokens[opener - 1]!.end === tokens[opener]!.start ? ' ' : ''), removeRange(closer.start, closer.end)], form: `no brackets around ${tokens[opener + 1]!.text} as an argument`}
    },
  },
  {
    name: 'unclosedString', family: 'brackets and unfinished code', weight: 2,
    who: 'Everyone: a string whose closing quote was never typed',
    example: 'let greeting = "hello⏎let limit = 10',
    apply: (random, scanned) => {
      const token = pick(random, tokensOf(scanned, T.STRING).map(index => scanned.tokens[index]!))
      return token && {edits: [removeRange(token.end - 1, token.end)], form: 'a string without its closing quote'}
    },
  },
  {
    name: 'unfinishedDefinition', family: 'brackets and unfinished code', weight: 3,
    who: 'Everyone, while typing: a definition whose body is not written yet, with finished definitions after it',
    example: 'let limit =⏎let twice x = 2 * x⏎let four = twice 2',
    apply: (random, scanned) => {
      const {tokens} = scanned
      const definition = pick(random, scanned.definitions.slice(0, -1))
      return definition && {edits: [removeRange(tokens[definition.equals]!.end, tokens[definition.last]!.end)], form: 'a definition without its body'}
    },
  },
]

const aroundKinds: KindDefinition[] = [
  {
    name: 'codeFence', family: 'around the program', weight: 3,
    who: 'A language model, or a person who pastes a model\'s answer: the program still has its code fence, and sometimes the sentence before it',
    example: '```ocaml⏎let limit = 10⏎```',
    apply: (random, scanned) => {
      const language = random.weighted([['ocaml', 6], ['', 2], ['ml', 1], ['miniml', 1]] as const)
      const sentence = random.chance(0.3) ? `${random.pick(['Here is the program:', 'Here is the corrected code:', 'Sure, here is the updated version:'])}\n\n` : ''
      const endsWithLineFeed = scanned.codePoints.at(-1) === lineFeed
      return {edits: [insertAt(0, `${sentence}\`\`\`${language}\n`), insertAt(scanned.codePoints.length, endsWithLineFeed ? '```\n' : '\n```')], form: sentence === '' ? 'a code fence around the program' : 'a sentence and a code fence around the program', wholeText: true}
    },
  },
  {
    name: 'mergeConflictMarkers', family: 'around the program', weight: 2,
    who: 'Anyone after a merge that left its marker lines in the file, around the two versions of a definition',
    example: '<<<<<<< HEAD⏎let limit = 10⏎=======⏎let limit = 11⏎>>>>>>> main⏎',
    apply: (random, scanned) => {
      const {tokens, codePoints} = scanned
      // A short definition on lines of its own that has a number: the other version has another number.
      const places = scanned.definitions.flatMap(definition => {
        const start = tokens[definition.let]!.start, end = lineEndOf(scanned, tokens[definition.last]!.end)
        if (lineStartOf(scanned, start) !== start || end >= codePoints.length || !lastOnLine(scanned, tokens[definition.last]!.end) || end - start > 100) return []
        for (let index = definition.equals + 1; index <= definition.last; index++) if (tokens[index]!.terminal === T.INT) return [{start, end: end + 1, number: tokens[index]!}]
        return []
      })
      const place = pick(random, places)
      if (place === undefined) return undefined
      const other = `${textOf(codePoints.subarray(place.start, place.number.start))}${Number(place.number.text) + random.integer(1, 9)}${textOf(codePoints.subarray(place.number.end, place.end))}`
      const branch = random.pick(['main', 'feature', 'origin/main', 'fix-tests'])
      return {edits: [insertAt(place.start, '<<<<<<< HEAD\n'), insertAt(place.end, `=======\n${other}>>>>>>> ${branch}\n`)], form: 'the marker lines of a merge conflict around two versions of a definition'}
    },
  },
  {
    name: 'toplevelPrompt', family: 'around the program', weight: 2,
    who: 'Someone who copies definitions out of a session of the OCaml toplevel, with its `#` prompt and its `;;`',
    example: '# let limit = 10;;⏎# let twice x = 2 * x;;',
    apply: (_random, scanned) => {
      const {tokens, definitions} = scanned
      if (!definitions.every(definition => firstOnLine(scanned, tokens[definition.let]!.start))) return undefined
      return {edits: definitions.flatMap(definition => [insertAt(tokens[definition.let]!.start, '# '), insertAt(tokens[definition.last]!.end, ';;')]), form: 'a # before every definition and ;; after it', wholeText: true}
    },
  },
]

export const kinds: readonly KindDefinition[] = [...ocamlKinds, ...otherLanguageKinds, ...listAndTupleKinds, ...bracketKinds, ...aroundKinds]

const kindByName = new Map(kinds.map(kind => [kind.name, kind]))
export function kindNamed(name: string): KindDefinition {
  const kind = kindByName.get(name)
  if (kind === undefined) throw new Error(`no kind of mistake is named ${name}`)
  return kind
}

// The edits of one or more kinds on the original's code points: the broken text's code points with, for each, its
// place in the original or -1 for an added one. Undefined when two edits touch the same code points.
export function applyEdits(original: ArrayLike<number>, edits: readonly Edit[]): {codePoints: number[], alignment: number[]} | undefined {
  const sorted = edits.map((edit, order) => ({...edit, order})).sort((left, right) => left.at - right.at || left.order - right.order)
  const codePoints: number[] = [], alignment: number[] = []
  let position = 0
  for (const edit of sorted) {
    if (edit.at < position || edit.at + edit.remove > original.length) return undefined
    for (; position < edit.at; position++) {
      codePoints.push(original[position]!)
      alignment.push(position)
    }
    for (const character of edit.insert) {
      codePoints.push(character.codePointAt(0)!)
      alignment.push(-1)
    }
    position += edit.remove
  }
  for (; position < original.length; position++) {
    codePoints.push(original[position]!)
    alignment.push(position)
  }
  return {codePoints, alignment}
}
