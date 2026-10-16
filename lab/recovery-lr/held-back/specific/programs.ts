// HELD BACK. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read
// this file, see ../README.md.
//
// The valid programs of this set: programAt(seed, index, attempt) is always the same program, of at most 512 code
// points. It is made in four steps:
// 1. Pieces of one sort are drawn from templates.ts, and one piece in six from another sort.
// 2. Every piece is read by the parser of the experiment and becomes a tree, so nothing here has a grammar of
//    its own that could differ from bison's.
// 3. The trees are changed: other names, a function written with `fun`, a part of a body pulled out into a local
//    definition, a conditional turned around.
// 4. The trees are written as text by one hand, a set of habits that a person keeps through a file: where a
//    line breaks, where `then`, `else` and `in` stand, how lists are written, how much space there is.
// The habits are other ones than those of the train data's generator, e.g. `then` and `else` at the start of
// their lines, `in` on a line of its own, a `;` before every item of a list, the `=` of constants in one column.
import {type TreeNode, labelsOfValidText, treeOf} from '../../labels.ts'
import {isValid, maximumCodePoints} from '../../parser.ts'
import {type Random, createRandom} from '../../random.ts'
import {isTrivia, ruleText, tables} from '../../tables.ts'
import {type SortName, piecesOfSort, remarksOfAnySort, remarksOfSort, sortNames} from './templates.ts'

type Expression =
  // An integer, a string, a name, true or false, as its text.
  | {type: 'atom', text: string}
  | {type: 'unit'}
  // Brackets that the piece wrote around one expression.
  | {type: 'brackets', inner: Expression}
  | {type: 'tuple', items: Expression[]}
  | {type: 'list', items: Expression[]}
  // A function and its arguments.
  | {type: 'apply', parts: Expression[]}
  | {type: 'negate', operand: Expression}
  | {type: 'operation', operator: string, left: Expression, right: Expression}
  | {type: 'if', condition: Expression, then: Expression, otherwise: Expression | undefined}
  | {type: 'fun', parameters: string[], body: Expression}
  | {type: 'let', binding: Binding, body: Expression}
// `target` is a name, `_` or `()`, and so is a parameter.
type Binding = {recursive: boolean, target: string, parameters: string[], value: Expression}

// The definitions of a valid text as trees, read off the parse that the experiment's parser makes.
function definitionsOf(text: string): Binding[] {
  const labels = labelsOfValidText(text)
  const textOfToken = (token: number): string => {
    const start = labels.tokens.start[token]!
    return String.fromCodePoint(...labels.codePoints.subarray(start, start + labels.tokens.length[token]!))
  }
  const shapeOf = (node: TreeNode): string => node.rule === -1 ? tables.symbolNames[node.symbol]! : ruleText(node.rule)
  const child = (node: TreeNode, place: number): TreeNode => node.children[place]!
  const parameterOf = (node: TreeNode): string => node.children.map(part => textOfToken(part.token)).join('')
  const parametersOf = (node: TreeNode): string[] => node.children.length === 0 ? [] : [...parametersOf(child(node, 0)), parameterOf(child(node, 1))]
  const bindingOf = (node: TreeNode, recursive: boolean): Binding => {
    const shape = shapeOf(node)
    if (shape === 'binding: IDENT parameters EQ expr') return {recursive, target: textOfToken(child(node, 0).token), parameters: parametersOf(child(node, 1)), value: expressionOf(child(node, 3))}
    if (shape === 'binding: UNDERSCORE EQ expr') return {recursive, target: '_', parameters: [], value: expressionOf(child(node, 2))}
    return {recursive, target: '()', parameters: [], value: expressionOf(child(node, 3))}
  }
  const itemsOf = (node: TreeNode): Expression[] => node.children.length === 1 ? [expressionOf(child(node, 0))] : [...itemsOf(child(node, 0)), expressionOf(child(node, 2))]
  const expressionOf = (node: TreeNode): Expression => {
    const shape = shapeOf(node)
    switch (shape) {
      case 'expr: LET binding IN expr': return {type: 'let', binding: bindingOf(child(node, 1), false), body: expressionOf(child(node, 3))}
      case 'expr: LET REC binding IN expr': return {type: 'let', binding: bindingOf(child(node, 2), true), body: expressionOf(child(node, 4))}
      case 'expr: FUN parameter parameters ARROW expr': return {type: 'fun', parameters: [parameterOf(child(node, 1)), ...parametersOf(child(node, 2))], body: expressionOf(child(node, 4))}
      case 'expr: IF expr THEN expr': return {type: 'if', condition: expressionOf(child(node, 1)), then: expressionOf(child(node, 3)), otherwise: undefined}
      case 'expr: IF expr THEN expr ELSE expr': return {type: 'if', condition: expressionOf(child(node, 1)), then: expressionOf(child(node, 3)), otherwise: expressionOf(child(node, 5))}
      case 'expr: MINUS expr': return {type: 'negate', operand: expressionOf(child(node, 1))}
      case 'expr: application': return expressionOf(child(node, 0))
      case 'application: atom': return expressionOf(child(node, 0))
      case 'application: application atom': {
        const before = expressionOf(child(node, 0))
        return {type: 'apply', parts: [...(before.type === 'apply' ? before.parts : [before]), expressionOf(child(node, 1))]}
      }
      case 'atom: LPAREN RPAREN': return {type: 'unit'}
      case 'atom: LPAREN expr RPAREN': return {type: 'brackets', inner: expressionOf(child(node, 1))}
      case 'atom: LPAREN expr COMMA tuple_rest RPAREN': return {type: 'tuple', items: [expressionOf(child(node, 1)), ...itemsOf(child(node, 3))]}
      case 'atom: LBRACK RBRACK': return {type: 'list', items: []}
      case 'atom: LBRACK elements RBRACK': return {type: 'list', items: itemsOf(child(node, 1))}
      default:
        if (shape.startsWith('atom: ')) return {type: 'atom', text: textOfToken(child(node, 0).token)}
        if (shape.startsWith('expr: expr ')) return {type: 'operation', operator: textOfToken(child(node, 1).token), left: expressionOf(child(node, 0)), right: expressionOf(child(node, 2))}
        throw new Error(`no expression has the shape ${shape}`)
    }
  }
  const bindings: Binding[] = []
  const collect = (node: TreeNode) => {
    const shape = shapeOf(node)
    if (shape === 'definition: LET binding') bindings.push(bindingOf(child(node, 1), false))
    else if (shape === 'definition: LET REC binding') bindings.push(bindingOf(child(node, 2), true))
    else for (const part of node.children) collect(part)
  }
  collect(treeOf(labels))
  return bindings
}

// The pieces of a sort, each with `{a|b|c}` still in it.
const pieceTexts = Object.fromEntries(sortNames.map(sort => [sort, piecesOfSort[sort].trim().split(/\n\s*\n/)])) as Record<SortName, string[]>
const withAlternativesDrawn = (piece: string, random: Random): string => piece.replaceAll(/\{([^{}]*)\}/g, (_, alternatives: string) => random.pick(alternatives.split('|')))

// How tightly a kind of expression binds, as in LANGUAGE.md: 0 for a conditional, a function and a local
// definition, which go on as far as they can, then the operators, the negation, the application and the atoms.
const levelOfOperator: Record<string, number> = {'||': 1, '&&': 2, '=': 3, '<>': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, '^': 4, '::': 5, '+': 6, '-': 6, '*': 7, '/': 7}
const groupsFromTheRight = new Set(['||', '&&', '^', '::'])
function levelOf(expression: Expression): number {
  switch (expression.type) {
    case 'if': case 'fun': case 'let': return 0
    case 'operation': return levelOfOperator[expression.operator]!
    case 'negate': return 8
    case 'apply': return 9
    case 'atom': case 'unit': case 'brackets': case 'tuple': case 'list': return 10
  }
}
// The expression itself where its level is high enough for its place, and in brackets otherwise, e.g. a
// conditional as an argument.
const fitFor = (expression: Expression, minimumLevel: number): Expression => levelOf(expression) >= minimumLevel ? expression : {type: 'brackets', inner: expression}
// Whether an `else` right after the expression would become a part of it: it ends with an `if` without `else`.
function endsWithOpenConditional(expression: Expression): boolean {
  switch (expression.type) {
    case 'if': return expression.otherwise === undefined || endsWithOpenConditional(expression.otherwise)
    case 'fun': return endsWithOpenConditional(expression.body)
    case 'let': return endsWithOpenConditional(expression.body)
    case 'atom': case 'unit': case 'brackets': case 'tuple': case 'list': case 'apply': case 'negate': case 'operation': return false
  }
}
const leftOperand = (expression: Expression & {type: 'operation'}): Expression => fitFor(expression.left, levelOf(expression) + (groupsFromTheRight.has(expression.operator) ? 1 : 0))
const rightOperand = (expression: Expression & {type: 'operation'}): Expression => fitFor(expression.right, levelOf(expression) + (groupsFromTheRight.has(expression.operator) ? 0 : 1))
const thenBranch = (expression: Expression & {type: 'if'}): Expression => expression.otherwise !== undefined && endsWithOpenConditional(expression.then) ? {type: 'brackets', inner: expression.then} : expression.then

// The habits of one writer, kept through a program.
type Hand = {
  indentation: string
  // The longest line that the writer leaves on one line.
  width: number
  // Whether the body of a function always starts on the line after the `=`.
  bodyBelow: boolean
  // if c then      |  if c       |  if c then a
  //   a            |  then a     |  else b
  // else           |  else b     |
  //   b            |             |
  conditional: 'then ends the line' | 'then starts a line' | 'branch on the line'
  // Whether a short conditional stays on one line.
  shortConditionalOnOneLine: boolean
  // let x = 1 in   |  let x = 1  |  let x = 1
  // body           |  in         |  in body
  //                |  body       |
  localIn: 'ends the line' | 'on its own line' | 'starts the next line'
  shortLocalOnOneLine: boolean
  // [ a;    |  [ a
  //   b ]   |  ; b
  //         |  ]
  separators: 'after the item' | 'before the item'
  // Where a long operation breaks: `a` / `+ b`, or `a +` / `b`.
  operatorBreak: 'before the operator' | 'after the operator'
  spacesInsideBrackets: boolean
  spaceAfterSeparator: boolean
  // `a+b` for the arithmetic operators.
  tightArithmetic: boolean
  // `f(x)` where the first argument is in brackets.
  tightCalls: boolean
  // The `=` of constants that follow each other stand in one column.
  alignedEquals: boolean
  blankLines: number
  // Constants that follow each other have no empty line between them.
  constantsTogether: boolean
  // How often a definition has a comment before it, and one at the end of its line.
  commentBefore: number
  commentAfter: number
  commentStyle: 'plain' | 'doc' | 'stars'
  header: boolean
  finalLineFeed: boolean
  lineEnd: string
  // How often a line ends with a space that nobody sees.
  trailingSpace: number
  // Brackets around the condition of every conditional, as in C.
  bracketsAroundConditions: boolean
}

function drawHand(random: Random): Hand {
  return {
    indentation: random.weighted([['  ', 50], ['    ', 30], ['   ', 6], ['\t', 10], [' ', 4]]),
    width: random.weighted([[60, 2], [72, 3], [80, 5], [100, 3], [130, 1]]),
    bodyBelow: random.chance(0.35),
    conditional: random.weighted([['then ends the line', 3], ['then starts a line', 4], ['branch on the line', 4]]),
    shortConditionalOnOneLine: random.chance(0.75),
    localIn: random.weighted([['ends the line', 5], ['on its own line', 2], ['starts the next line', 3]]),
    shortLocalOnOneLine: random.chance(0.2),
    separators: random.weighted([['after the item', 6], ['before the item', 4]]),
    operatorBreak: random.weighted([['before the operator', 6], ['after the operator', 4]]),
    spacesInsideBrackets: random.chance(0.12),
    spaceAfterSeparator: random.chance(0.85),
    tightArithmetic: random.chance(0.12),
    tightCalls: random.chance(0.15),
    alignedEquals: random.chance(0.25),
    blankLines: random.weighted([[0, 2], [1, 6], [2, 2]]),
    constantsTogether: random.chance(0.5),
    commentBefore: random.weighted([[0, 4], [0.15, 3], [0.4, 2], [0.8, 1]]),
    commentAfter: random.weighted([[0, 6], [0.15, 3], [0.4, 1]]),
    commentStyle: random.weighted([['plain', 6], ['doc', 2], ['stars', 2]]),
    header: random.chance(0.3),
    finalLineFeed: random.chance(0.85),
    lineEnd: random.chance(0.03) ? '\r\n' : '\n',
    trailingSpace: random.chance(0.08) ? 0.15 : 0,
    bracketsAroundConditions: random.chance(0.08),
  }
}

// The writing of trees as text, for one hand.
function createWriter(hand: Hand) {
  const {indentation, width} = hand
  const indentationWidth = indentation === '\t' ? 4 : indentation.length
  const indented = (lines: readonly string[]): string[] => lines.map(line => indentation + line)
  const inBrackets = (open: string, inner: string, close: string): string => hand.spacesInsideBrackets && inner !== '' ? `${open} ${inner} ${close}` : `${open}${inner}${close}`
  const separator = (sign: string): string => hand.spaceAfterSeparator ? `${sign} ` : sign
  const operatorText = (operator: string): string => hand.tightArithmetic && '+-*/'.includes(operator) ? operator : ` ${operator} `
  const conditionOf = (expression: Expression & {type: 'if'}): Expression => hand.bracketsAroundConditions && expression.condition.type !== 'brackets' ? {type: 'brackets', inner: expression.condition} : fitFor(expression.condition, 1)

  // The expression on one line.
  const flat = (expression: Expression): string => {
    switch (expression.type) {
      case 'atom': return expression.text
      case 'unit': return '()'
      case 'brackets': return inBrackets('(', flat(expression.inner), ')')
      case 'tuple': return inBrackets('(', expression.items.map(flat).join(separator(',')), ')')
      case 'list': return inBrackets('[', expression.items.map(flat).join(separator(';')), ']')
      case 'apply': {
        const parts = expression.parts.map(part => flat(fitFor(part, 10)))
        const firstArgument = expression.parts[1]!
        const tight = hand.tightCalls && (firstArgument.type === 'brackets' || firstArgument.type === 'tuple' || firstArgument.type === 'unit' || levelOf(firstArgument) < 10)
        return tight ? `${parts[0]}${parts.slice(1).join(' ')}` : parts.join(' ')
      }
      case 'negate': return `-${flat(fitFor(expression.operand, 8))}`
      case 'operation': return `${flat(leftOperand(expression))}${operatorText(expression.operator)}${flat(rightOperand(expression))}`
      case 'if': return `if ${flat(conditionOf(expression))} then ${flat(thenBranch(expression))}${expression.otherwise === undefined ? '' : ` else ${flat(expression.otherwise)}`}`
      case 'fun': return `fun ${expression.parameters.join(' ')} -> ${flat(expression.body)}`
      case 'let': return `${headOf(expression.binding)} ${flat(expression.binding.value)} in ${flat(expression.body)}`
    }
  }
  const headOf = (binding: Binding): string => `let ${binding.recursive ? 'rec ' : ''}${[binding.target, ...binding.parameters].join(' ')} =`

  // Whether the writer never leaves the expression on one line, however short it is.
  const alwaysBroken = (expression: Expression): boolean => {
    if (expression.type === 'let') return !hand.shortLocalOnOneLine || expression.body.type === 'let'
    if (expression.type === 'if') return !hand.shortConditionalOnOneLine || expression.otherwise?.type === 'if'
    return false
  }

  // The expression as lines. The first line goes where the caller stands, and the others are indented from the
  // start of the caller's line. `room` is the number of columns that are left on the first line.
  const block = (expression: Expression, room: number): string[] => {
    const oneLine = flat(expression)
    if (oneLine.length <= room && !alwaysBroken(expression)) return [oneLine]
    const below = width - indentationWidth
    switch (expression.type) {
      case 'atom': case 'unit': case 'negate': return [oneLine]
      case 'brackets': {
        const inner = block(expression.inner, room - 2)
        if (inner.length === 1) return [oneLine]
        return [`(${inner[0]}`, ...inner.slice(1, -1).map(line => ` ${line}`), ` ${inner.at(-1)})`]
      }
      case 'tuple': case 'list': {
        const [open, close, sign] = expression.type === 'tuple' ? ['(', ')', ','] : ['[', ']', ';']
        const items = expression.items.map(item => block(item, below - 2))
        if (hand.separators === 'before the item') {
          return [...items.flatMap((item, place) => [`${place === 0 ? open : sign} ${item[0]}`, ...item.slice(1).map(line => `  ${line}`)]), close]
        }
        return [open, ...indented(items.flatMap((item, place) => place === items.length - 1 ? item : [...item.slice(0, -1), `${item.at(-1)}${sign}`])), close]
      }
      case 'apply': {
        const parts = expression.parts.map(part => fitFor(part, 10))
        // The function and the arguments that still fit stay on the first line.
        let head = flat(parts[0]!)
        let next = 1
        for (; next < parts.length - 1 && `${head} ${flat(parts[next]!)}`.length <= room; next++) head = `${head} ${flat(parts[next]!)}`
        return [head, ...parts.slice(next).flatMap(part => indented(block(part, below)))]
      }
      case 'operation': {
        const left = block(leftOperand(expression), room), right = block(rightOperand(expression), room - expression.operator.length - 1)
        if (hand.operatorBreak === 'before the operator') return [...left, `${expression.operator} ${right[0]}`, ...right.slice(1)]
        return [...left.slice(0, -1), `${left.at(-1)} ${expression.operator}`, ...right]
      }
      case 'if': {
        const lines: string[] = []
        let prefix = ''
        for (let current: Expression | undefined = expression; current !== undefined;) {
          if (current.type !== 'if') {
            // The last branch.
            const branch = block(current, below)
            if (hand.conditional === 'then ends the line') lines.push('else', ...indented(branch))
            else if (branch.length === 1 && branch[0]!.length + 5 <= width) lines.push(`else ${branch[0]}`)
            else lines.push('else', ...indented(branch))
            break
          }
          const condition = flat(conditionOf(current)), branch = block(thenBranch(current), below)
          if (hand.conditional === 'then ends the line') lines.push(`${prefix}if ${condition} then`, ...indented(branch))
          else if (hand.conditional === 'then starts a line') lines.push(`${prefix}if ${condition}`, `then ${branch[0]}`, ...indented(branch.slice(1)))
          else if (branch.length === 1 && `${prefix}if ${condition} then ${branch[0]}`.length <= width) lines.push(`${prefix}if ${condition} then ${branch[0]}`)
          else lines.push(`${prefix}if ${condition} then`, ...indented(branch))
          prefix = 'else '
          current = current.otherwise
        }
        return lines
      }
      case 'fun': {
        const body = block(expression.body, below)
        return [`fun ${expression.parameters.join(' ')} ->`, ...indented(body)]
      }
      case 'let': {
        const lines: string[] = []
        let current: Expression = expression
        let startsWithIn = false
        for (; current.type === 'let'; current = current.body) {
          const binding = bindingLines(current.binding, room)
          if (startsWithIn) binding[0] = `in ${binding[0]}`
          lines.push(...binding)
          startsWithIn = false
          if (hand.localIn === 'ends the line') lines[lines.length - 1] += ' in'
          else if (hand.localIn === 'on its own line') lines.push('in')
          else startsWithIn = true
        }
        const body = block(current, room)
        if (startsWithIn) body[0] = `in ${body[0]}`
        return [...lines, ...body]
      }
    }
  }

  // The lines of `let name parameters = value`, without what follows it.
  const bindingLines = (binding: Binding, room: number): string[] => {
    const head = headOf(binding)
    const value = block(binding.value, room - head.length - 1)
    const below = hand.bodyBelow && binding.parameters.length > 0 && binding.value.type !== 'atom'
    if (value.length === 1 && !below && head.length + 1 + value[0]!.length <= Math.max(room, 30)) return [`${head} ${value[0]}`]
    // A function written with `fun` and a list keep their first line next to the `=`.
    if (!below && (binding.value.type === 'fun' || ((binding.value.type === 'list' || binding.value.type === 'tuple') && hand.separators === 'after the item'))) return [`${head} ${value[0]}`, ...value.slice(1)]
    return [head, ...indented(block(binding.value, width - indentationWidth))]
  }
  return {bindingLines, flat}
}

// Other names for some of the names of the pieces, drawn per program: a program writes a name one way.
const otherNames: Record<string, readonly string[]> = {
  value: ['value', 'item', 'element', 'input'], values: ['values', 'items', 'elements', 'numbers'], amount: ['amount', 'sum', 'cents'], text: ['text', 'input', 'line', 'content'],
  left: ['left', 'one', 'lhs'], right: ['right', 'other', 'rhs'], entry: ['entry', 'record', 'pair'], state: ['state', 'machine', 'current'], point: ['point', 'position', 'spot'],
  tree: ['tree', 'root', 'subtree'], task: ['task', 'job', 'todo'], balance: ['balance', 'funds', 'saldo'], width: ['width', 'columns', 'span'], count: ['count', 'howMany', 'total'],
  total: ['total', 'grandTotal', 'sumSoFar'], name: ['name', 'label', 'title'], month: ['month', 'monthNumber'], vector: ['vector', 'direction', 'arrow'], place: ['place', 'town', 'stop'],
  code: ['code', 'letterCode', 'index'], checks: ['checks', 'outcomes', 'results'], queue: ['queue', 'backlog', 'pending'], cart: ['cart', 'order', 'basketLines'],
  first: ['first', 'headOf', 'firstOf'], rest: ['rest', 'tailOf', 'others'], isEmpty: ['isEmpty', 'isNil', 'noneLeft'], toString: ['toString', 'show', 'intToText'],
  printLine: ['printLine', 'say', 'writeLine', 'log'], listLength: ['listLength', 'lengthOf', 'countOf'], map: ['map', 'mapOver', 'forEach'],
}
// Names for a part of a body that is pulled out into a local definition.
const localNames = ['partial', 'inner', 'subtotal', 'candidate', 'chosen', 'outcome', 'firstPart', 'answer', "value'", 'tmp', 'raw', 'adjusted'] as const

// The name as the program writes it: with `_` between the words in a program that writes names that way.
const inWriting = (name: string, withUnderscores: boolean): string => withUnderscores && /^[a-z]/.test(name) ? name.replaceAll(/([a-z0-9])([A-Z])/g, (_, before: string, capital: string) => `${before}_${capital.toLowerCase()}`) : name

const isName = (text: string): boolean => /^[A-Za-z_][A-Za-z0-9_']*$/.test(text) && !['let', 'rec', 'in', 'if', 'then', 'else', 'fun', 'true', 'false', '_'].includes(text)

// A copy of the tree with every name passed through `rename`.
function renamed(binding: Binding, rename: (name: string) => string): Binding {
  const ofName = (text: string): string => isName(text) ? rename(text) : text
  const ofExpression = (expression: Expression): Expression => {
    switch (expression.type) {
      case 'atom': return {type: 'atom', text: ofName(expression.text)}
      case 'unit': return expression
      case 'brackets': return {type: 'brackets', inner: ofExpression(expression.inner)}
      case 'tuple': return {type: 'tuple', items: expression.items.map(ofExpression)}
      case 'list': return {type: 'list', items: expression.items.map(ofExpression)}
      case 'apply': return {type: 'apply', parts: expression.parts.map(ofExpression)}
      case 'negate': return {type: 'negate', operand: ofExpression(expression.operand)}
      case 'operation': return {...expression, left: ofExpression(expression.left), right: ofExpression(expression.right)}
      case 'if': return {type: 'if', condition: ofExpression(expression.condition), then: ofExpression(expression.then), otherwise: expression.otherwise === undefined ? undefined : ofExpression(expression.otherwise)}
      case 'fun': return {type: 'fun', parameters: expression.parameters.map(ofName), body: ofExpression(expression.body)}
      case 'let': return {type: 'let', binding: ofBinding(expression.binding), body: ofExpression(expression.body)}
    }
  }
  const ofBinding = (inner: Binding): Binding => ({recursive: inner.recursive, target: ofName(inner.target), parameters: inner.parameters.map(ofName), value: ofExpression(inner.value)})
  return ofBinding(binding)
}

const oppositeComparison: Record<string, string> = {'=': '<>', '<>': '=', '<': '>=', '>=': '<', '>': '<=', '<=': '>'}

// The changes to the tree of one definition, each with its own chance.
function changed(binding: Binding, random: Random): Binding {
  let {parameters, value} = binding
  // if a < b then x else y  becomes  if a >= b then y else x, where neither branch is a conditional.
  const turnedAround = (expression: Expression): Expression => {
    if (expression.type === 'if' && expression.otherwise !== undefined && expression.condition.type === 'operation' && Object.hasOwn(oppositeComparison, expression.condition.operator)
      && expression.then.type !== 'if' && expression.otherwise.type !== 'if' && random.chance(0.12)) {
      return {type: 'if', condition: {...expression.condition, operator: oppositeComparison[expression.condition.operator]!}, then: expression.otherwise, otherwise: expression.then}
    }
    return expression
  }
  value = turnedAround(value)
  // let total a b = a + b * 2  becomes  let total a b = let partial = b * 2 in a + partial
  if (value.type === 'operation' && random.chance(0.14)) {
    const side = random.chance(0.5) ? 'left' : 'right'
    const part = value[side]
    if (part.type === 'operation' || part.type === 'apply') {
      const name = random.pick(localNames)
      value = {type: 'let', binding: {recursive: false, target: name, parameters: [], value: part}, body: {...value, [side]: {type: 'atom', text: name}}}
    }
  }
  // let add a b = a + b  becomes  let add = fun a b -> a + b, or  let add a = fun b -> a + b
  if (parameters.length > 0 && !binding.recursive && binding.target !== '()' && random.chance(0.08)) {
    const kept = random.chance(0.5) ? 0 : parameters.length - 1
    value = {type: 'fun', parameters: parameters.slice(kept), body: value}
    parameters = parameters.slice(0, kept)
  }
  return {...binding, parameters, value}
}

export type GeneratedProgram = {text: string, sort: SortName}

// The program with the given index. `attempt` gives another program for the same index, for a caller that could
// not use the first one.
export function programAt(seed: number, index: number, attempt = 0): GeneratedProgram {
  const random = createRandom(seed ^ Math.imul(attempt + 1, 0x9e3779b1), index)
  const sort = random.pick(sortNames)
  const hand = drawHand(random)
  const writer = createWriter(hand)
  const withUnderscores = random.chance(0.2)
  const chosenNames = new Map<string, string>()
  const rename = (name: string): string => {
    if (!chosenNames.has(name)) chosenNames.set(name, inWriting(Object.hasOwn(otherNames, name) && random.chance(0.6) ? random.pick(otherNames[name]!) : name, withUnderscores))
    return chosenNames.get(name)!
  }
  const remarks = [...remarksOfSort[sort], ...remarksOfAnySort]
  const comment = (remark: string): string => hand.commentStyle === 'doc' ? `(** ${remark} *)` : hand.commentStyle === 'stars' ? `(*** ${remark} ***)` : `(* ${remark} *)`

  // The longest program that the writer aims for. A program can end up shorter, and never longer than 512.
  const aim = random.integer(110, 470)
  const order = random.shuffled(pieceTexts[sort])
  type Written = {lines: string[], isConstant: boolean}
  const written: Written[] = []
  let length = 0
  for (let next = 0; next < order.length; next++) {
    const fromOtherSort = random.chance(1 / 6)
    const piece = fromOtherSort ? random.pick(pieceTexts[random.pick(sortNames)]) : order[next]!
    const lines: Written[] = []
    for (const binding of definitionsOf(withAlternativesDrawn(piece, random))) {
      const tree = renamed(changed(binding, random), rename)
      const own = writer.bindingLines(tree, hand.width)
      if (random.chance(hand.commentBefore)) own.unshift(comment(random.pick(remarks)))
      else if (own.length === 1 && random.chance(hand.commentAfter)) own[0] += `  (* ${random.pick(remarks)} *)`
      lines.push({lines: own, isConstant: tree.parameters.length === 0 && own.length === 1})
    }
    const added = lines.reduce((sum, definition) => sum + definition.lines.join('\n').length + 1 + hand.blankLines, 0)
    if (length + added > aim) {
      if (written.length >= 2) break
      if (length + added > maximumCodePoints - 40) continue
    }
    written.push(...lines)
    length += added
  }

  // The `=` of constants that follow each other, in one column.
  if (hand.alignedEquals) {
    for (let from = 0; from < written.length;) {
      let to = from
      while (to < written.length && written[to]!.isConstant) to++
      if (to - from >= 2) {
        const column = Math.max(...written.slice(from, to).map(definition => definition.lines[0]!.indexOf(' =')))
        for (const definition of written.slice(from, to)) {
          const at = definition.lines[0]!.indexOf(' =')
          definition.lines[0] = `${definition.lines[0]!.slice(0, at)}${' '.repeat(column - at)}${definition.lines[0]!.slice(at)}`
        }
      }
      from = Math.max(to, from + 1)
    }
  }
  const lines: string[] = []
  if (hand.header) {
    const title = random.pick(remarksOfSort[sort])
    lines.push(...(random.chance(0.4) ? [`(* ${'-'.repeat(30)}`, `   ${title}`, `   ${'-'.repeat(30)} *)`] : [comment(title)]), ...(hand.blankLines === 0 ? [] : ['']))
  }
  written.forEach((definition, place) => {
    if (place > 0) {
      const together = hand.constantsTogether && definition.isConstant && written[place - 1]!.isConstant
      for (let blank = 0; blank < (together ? 0 : hand.blankLines); blank++) lines.push('')
    }
    lines.push(...definition.lines)
  })
  const text = lines.map(line => line !== '' && random.chance(hand.trailingSpace) ? `${line} ` : line).join(hand.lineEnd) + (hand.finalLineFeed ? hand.lineEnd : '')
  if (Array.from(text).length !== text.length) throw new Error(`program ${seed}:${index} holds a character outside the basic plane`)
  if (text.length > maximumCodePoints) return programAt(seed, index, attempt + 1000)
  if (!isValid(text)) throw new Error(`the generator wrote a text that is no valid program, ${seed}:${index}, attempt ${attempt}:\n${text}`)
  return {text, sort}
}

if (import.meta.main) {
  // Prints programs, so this output is held back too.
  const seed = Number(process.argv[2] ?? 1), count = Number(process.argv[3] ?? 5)
  for (let index = 0; index < count; index++) {
    const {text, sort} = programAt(seed, index)
    console.log(`--- ${sort}, program ${seed}:${index}, ${text.length} code points, ${Array.from(labelsOfValidText(text).tokens.kind).filter(kind => !isTrivia(kind)).length} tokens\n${text}`)
  }
}
