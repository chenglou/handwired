// A miniml program as a tree, for the generator of valid programs. idioms.ts holds its programs as plain miniml
// text, `definitionsOf` reads such a text into a tree, generate.ts changes and builds trees, and `linesOfDefinition`
// writes a tree as text again: with the brackets that the grammar needs, and in the layout of a `Style`.
//
// The tree has no brackets of its own, apart from the node `brackets` for brackets that the grammar does not
// need, e.g. `(x)`. Whoever builds a tree puts any expression anywhere, e.g. a sum as the argument of a call, and
// `withBrackets` adds what makes the text parse as the tree says.
import {type TreeNode, labelsOfValidText, treeOf} from './labels.ts'
import type {Random} from './random.ts'
import {commentKind, isTrivia, tables} from './tables.ts'

export const operators = ['||', '&&', '=', '<>', '<', '<=', '>', '>=', '^', '::', '+', '-', '*', '/'] as const
export type Operator = typeof operators[number]

export type Expression =
  | {type: 'name', text: string}
  // An integer, a string with its quotes, `true` or `false`, as it is written.
  | {type: 'literal', text: string}
  | {type: 'unit'}
  | {type: 'tuple', items: Expression[]}
  | {type: 'list', items: Expression[]}
  // Brackets that the grammar does not need, e.g. `(x)` and `(a * b) + c`.
  | {type: 'brackets', inner: Expression}
  | {type: 'application', head: Expression, arguments: Expression[]}
  | {type: 'negation', operand: Expression}
  | {type: 'operation', operator: Operator, left: Expression, right: Expression}
  | {type: 'conditional', condition: Expression, then: Expression, otherwise: Expression | undefined}
  | {type: 'function', parameters: string[], body: Expression}
  | {type: 'local', binding: Binding, body: Expression}

// `let [rec] target parameters = value`. The target is a name, `_` or `()`, and so is every parameter. Only a name
// takes parameters.
export type Binding = {recursive: boolean, target: string, parameters: string[], value: Expression}

export type Definition = {
  binding: Binding
  // The text of a comment that stands before the definition, without `(*` and `*)`.
  comment: string | undefined
}

const operatorOfTerminal: Record<string, Operator> = {
  OR: '||', AND: '&&', EQ: '=', NE: '<>', LT: '<', LE: '<=', GT: '>', GE: '>=', CARET: '^', CONS: '::', PLUS: '+', MINUS: '-', STAR: '*', SLASH: '/',
}

// The definitions of a valid program. Brackets that only group are left out of the tree, e.g. `f (g x)` is the
// application of `f` to the application `g x`. Throws when the text is no valid program.
export function definitionsOf(text: string): Definition[] {
  const labels = labelsOfValidText(text)
  const {tokens, codePoints} = labels
  const textOfToken = (token: number): string => String.fromCodePoint(...codePoints.subarray(tokens.start[token], tokens.start[token]! + tokens.length[token]!))
  const nameOf = (node: TreeNode): string => tables.symbolNames[node.symbol]!
  const shapeOf = (node: TreeNode): string => node.children.map(nameOf).join(' ')
  const parameterOf = (node: TreeNode): string => node.children.length === 2 ? '()' : textOfToken(node.children[0]!.token)
  const parametersOf = (node: TreeNode): string[] => node.children.length === 0 ? [] : [...parametersOf(node.children[0]!), parameterOf(node.children[1]!)]
  const bindingOf = (node: TreeNode, recursive: boolean): Binding => {
    const [first, second, third, fourth] = node.children
    if (nameOf(first!) === 'IDENT') return {recursive, target: textOfToken(first!.token), parameters: parametersOf(second!), value: expressionOf(fourth!)}
    if (nameOf(first!) === 'UNDERSCORE') return {recursive, target: '_', parameters: [], value: expressionOf(third!)}
    return {recursive, target: '()', parameters: [], value: expressionOf(fourth!)}
  }
  // The expressions of `tuple_rest` and `elements`, which are lists that grow to the right.
  const listed = (node: TreeNode): Expression[] => node.children.length === 1 ? [expressionOf(node.children[0]!)] : [...listed(node.children[0]!), expressionOf(node.children[2]!)]
  const atomOf = (node: TreeNode): Expression => {
    const children = node.children
    switch (shapeOf(node)) {
      case 'IDENT': return {type: 'name', text: textOfToken(children[0]!.token)}
      case 'INT': case 'STRING': case 'TRUE': case 'FALSE': return {type: 'literal', text: textOfToken(children[0]!.token)}
      case 'LPAREN RPAREN': return {type: 'unit'}
      case 'LPAREN expr RPAREN': return expressionOf(children[1]!)
      case 'LPAREN expr COMMA tuple_rest RPAREN': return {type: 'tuple', items: [expressionOf(children[1]!), ...listed(children[3]!)]}
      case 'LBRACK RBRACK': return {type: 'list', items: []}
      case 'LBRACK elements RBRACK': return {type: 'list', items: listed(children[1]!)}
      default: throw new Error(`an atom of the shape ${shapeOf(node)}`)
    }
  }
  const atomsOf = (node: TreeNode): Expression[] => node.children.length === 1 ? [atomOf(node.children[0]!)] : [...atomsOf(node.children[0]!), atomOf(node.children[1]!)]
  const expressionOf = (node: TreeNode): Expression => {
    const children = node.children
    switch (shapeOf(node)) {
      case 'application': {
        const [head, ...others] = atomsOf(children[0]!)
        return others.length === 0 ? head! : {type: 'application', head: head!, arguments: others}
      }
      case 'MINUS expr': return {type: 'negation', operand: expressionOf(children[1]!)}
      case 'LET binding IN expr': return {type: 'local', binding: bindingOf(children[1]!, false), body: expressionOf(children[3]!)}
      case 'LET REC binding IN expr': return {type: 'local', binding: bindingOf(children[2]!, true), body: expressionOf(children[4]!)}
      case 'FUN parameter parameters ARROW expr': return {type: 'function', parameters: [parameterOf(children[1]!), ...parametersOf(children[2]!)], body: expressionOf(children[4]!)}
      case 'IF expr THEN expr': return {type: 'conditional', condition: expressionOf(children[1]!), then: expressionOf(children[3]!), otherwise: undefined}
      case 'IF expr THEN expr ELSE expr': return {type: 'conditional', condition: expressionOf(children[1]!), then: expressionOf(children[3]!), otherwise: expressionOf(children[5]!)}
      default: {
        const operator = operatorOfTerminal[nameOf(children[1]!)]
        if (children.length !== 3 || operator === undefined) throw new Error(`an expression of the shape ${shapeOf(node)}`)
        return {type: 'operation', operator, left: expressionOf(children[0]!), right: expressionOf(children[2]!)}
      }
    }
  }
  const definitions: Definition[] = []
  const collect = (node: TreeNode) => {
    if (node.children.length === 0) return
    collect(node.children[0]!)
    const definition = node.children[1]!
    const recursive = definition.children.length === 3
    // A comment between the definition's `let` and the token before it.
    let comment: string | undefined
    for (let token = definition.children[0]!.token - 1; token >= 0 && isTrivia(tokens.kind[token]!); token--) {
      if (tokens.kind[token] === commentKind) comment = textOfToken(token).slice(2, -2).trim()
    }
    definitions.push({binding: bindingOf(definition.children[recursive ? 2 : 1]!, recursive), comment})
  }
  collect(treeOf(labels).children[0]!)
  return definitions
}

// How a program is laid out. The probabilities are drawn anew at every place that they are about.
export type Style = {
  // One level of indentation, e.g. two spaces or a tab.
  unit: string
  // The longest line that the layout aims for. A line is longer where nothing can be broken, e.g. at a long string.
  width: number
  // Every definition stands on one line, however long.
  definitionsOnOneLine: boolean
  // A local definition at the start of a line ends its line after `in`, although the rest would fit.
  breakLocal: number
  // A conditional that would fit on its line is broken before `else` all the same.
  breakConditional: number
  // A branch that would fit after `then` or `else` goes on a line of its own.
  branchOnOwnLine: number
  // The value of a definition with parameters starts on the next line although it would fit.
  breakAfterEquals: number
  // A list of two or more items that would fit has one item per line.
  breakList: number
  // The `in` after a value of several lines stands on a line of its own, and otherwise at the end of the value's last line.
  inOnOwnLine: number
  // A broken operation has its operator at the start of the next line, and otherwise at the end of the line.
  operatorFirst: boolean
  // A broken list has its brackets on lines of their own, and otherwise its items hang after `[ `.
  listAsBlock: boolean
  // What stands between two items of a tuple and of a list, e.g. `, ` or `,`.
  comma: string
  semicolon: string
  // ( a, b ) and [ 1; 2 ] where true.
  spaceInsideBrackets: boolean
  // The operators that are written without spaces around them, e.g. `x::xs`.
  tightOperators: readonly Operator[]
  // let x=1 where true.
  tightEquals: boolean
  // An `if`, a `fun` or a local definition as the right operand of an operator, or after the `-` of a negation,
  // stands without brackets where the grammar allows, e.g. `x :: if c then [] else rest`.
  bareOpenOperand: number
  // Brackets around a condition, e.g. `if (x > 0) then`.
  bracketCondition: number
  // Brackets around an operand that needs none, e.g. `(a * b) + c`.
  bracketOperand: number
}

// How tightly a node holds its parts together: an operand needs brackets when its level is below the level that
// its place asks for. From the loosest: a whole expression, the operators in the order of LANGUAGE.md, a negation,
// an application, an atom.
export const operatorLevel: Record<Operator, number> = {'||': 1, '&&': 2, '=': 3, '<>': 3, '<': 3, '<=': 3, '>': 3, '>=': 3, '^': 4, '::': 5, '+': 6, '-': 6, '*': 7, '/': 7}
export const groupsFromTheRight: readonly Operator[] = ['||', '&&', '^', '::']
const negationLevel = 8, applicationLevel = 9, atomLevel = 10

// The same tree with a node `brackets` wherever the text needs brackets to parse as the tree says.
// - `minimumLevel` is the level that the node's place asks for, 0 where a whole expression can stand.
// - `atRightEdge` says that nothing of an operation around the node follows it. An `if`, a `fun` and a local
//   definition take everything to their right, so as an operand they can only stand bare at the right edge, e.g.
//   in `a + if c then 1 else 2` and not in `(if c then 1 else 2) + a`.
// - `elseFollows` says that an `else` follows the node, which an `if` without `else` at the node's right edge would
//   take for its own, e.g. in `if a then (if b then 1) else 2`.
export function withBrackets(node: Expression, minimumLevel: number, atRightEdge: boolean, elseFollows: boolean, style: Style, random: Random): Expression {
  const whole = (inner: Expression): Expression => withBrackets(inner, 0, true, false, style, random)
  const bracketed = (): Expression => ({type: 'brackets', inner: whole(node)})
  switch (node.type) {
    case 'name': case 'literal': case 'unit': return node
    case 'tuple': return {type: 'tuple', items: node.items.map(whole)}
    case 'list': return {type: 'list', items: node.items.map(whole)}
    case 'brackets': return {type: 'brackets', inner: whole(node.inner)}
    case 'application': {
      if (minimumLevel > applicationLevel) return bracketed()
      const atom = (inner: Expression): Expression => withBrackets(inner, atomLevel, false, false, style, random)
      return {type: 'application', head: atom(node.head), arguments: node.arguments.map(atom)}
    }
    case 'negation':
      if (minimumLevel > negationLevel) return bracketed()
      return {type: 'negation', operand: withBrackets(node.operand, negationLevel, atRightEdge, elseFollows, style, random)}
    case 'operation': {
      const level = operatorLevel[node.operator]
      if (minimumLevel > level || (minimumLevel > 0 && random.chance(style.bracketOperand))) return bracketed()
      const fromTheRight = groupsFromTheRight.includes(node.operator)
      return {
        type: 'operation', operator: node.operator,
        left: withBrackets(node.left, fromTheRight ? level + 1 : level, false, false, style, random),
        right: withBrackets(node.right, fromTheRight ? level : level + 1, atRightEdge, elseFollows, style, random),
      }
    }
    case 'conditional': case 'function': case 'local': {
      const bare = minimumLevel === 0 || (minimumLevel <= negationLevel && atRightEdge && random.chance(style.bareOpenOperand))
      if (!bare) return bracketed()
      if (node.type === 'function') return {type: 'function', parameters: node.parameters, body: withBrackets(node.body, 0, true, elseFollows, style, random)}
      if (node.type === 'local') return {type: 'local', binding: {...node.binding, value: whole(node.binding.value)}, body: withBrackets(node.body, 0, true, elseFollows, style, random)}
      if (node.otherwise === undefined && elseFollows) return bracketed()
      const condition = whole(node.condition)
      return {
        type: 'conditional',
        condition: condition.type !== 'brackets' && random.chance(style.bracketCondition) ? {type: 'brackets', inner: condition} : condition,
        then: withBrackets(node.then, 0, true, node.otherwise !== undefined, style, random),
        otherwise: node.otherwise === undefined ? undefined : withBrackets(node.otherwise, 0, true, elseFollows, style, random),
      }
    }
  }
}

const bindingHead = (binding: Binding, style: Style): string =>
  `let ${binding.recursive ? 'rec ' : ''}${[binding.target, ...binding.parameters].join(' ')}${style.tightEquals ? '=' : ' ='}`
const afterEquals = (style: Style): string => style.tightEquals ? '' : ' '

// An expression on one line. The tree must have its brackets, see withBrackets.
export function inline(node: Expression, style: Style): string {
  const inside = style.spaceInsideBrackets ? ' ' : ''
  switch (node.type) {
    case 'name': case 'literal': return node.text
    case 'unit': return '()'
    case 'tuple': return `(${inside}${node.items.map(item => inline(item, style)).join(style.comma)}${inside})`
    case 'list': return node.items.length === 0 ? '[]' : `[${inside}${node.items.map(item => inline(item, style)).join(style.semicolon)}${inside}]`
    case 'brackets': return `(${inline(node.inner, style)})`
    case 'application': return [node.head, ...node.arguments].map(part => inline(part, style)).join(' ')
    // `- -x` keeps its space, so that the two signs do not read as one.
    case 'negation': return `-${node.operand.type === 'negation' ? ' ' : ''}${inline(node.operand, style)}`
    case 'operation': {
      const space = style.tightOperators.includes(node.operator) ? '' : ' '
      return `${inline(node.left, style)}${space}${node.operator}${space}${inline(node.right, style)}`
    }
    case 'conditional': return `if ${inline(node.condition, style)} then ${inline(node.then, style)}${node.otherwise === undefined ? '' : ` else ${inline(node.otherwise, style)}`}`
    case 'function': return `fun ${node.parameters.join(' ')} -> ${inline(node.body, style)}`
    case 'local': return `${bindingHead(node.binding, style)}${afterEquals(style)}${inline(node.binding.value, style)} in ${inline(node.body, style)}`
  }
}

const appendToLast = (lines: string[], text: string) => { lines[lines.length - 1] = `${lines.at(-1) ?? ''}${text}` }

// The lines of an expression that starts at `column` of a line whose indentation is `indent`. The first line
// comes without what stands before the expression on its line, and every further line with its own indentation.
// `atLineStart` says that only the indentation stands before the expression.
function linesOf(node: Expression, indent: string, column: number, atLineStart: boolean, style: Style, random: Random): string[] {
  const flat = inline(node, style)
  const fits = column + flat.length <= style.width
  const deeper = indent + style.unit
  // The lines of an expression that starts a line of its own, with their indentation.
  const block = (inner: Expression, innerIndent: string): string[] => {
    const lines = linesOf(inner, innerIndent, innerIndent.length, true, style, random)
    return [innerIndent + lines[0]!, ...lines.slice(1)]
  }
  switch (node.type) {
    case 'name': case 'literal': case 'unit': return [flat]
    case 'local': {
      if (fits && !(atLineStart && random.chance(style.breakLocal))) return [flat]
      const head = bindingHead(node.binding, style)
      const value = inline(node.binding.value, style)
      const lines: string[] = []
      if (column + head.length + value.length + 4 <= style.width || node.binding.value.type === 'name' || node.binding.value.type === 'literal') lines.push(`${head}${afterEquals(style)}${value} in`)
      else {
        lines.push(head, ...block(node.binding.value, deeper))
        if (random.chance(style.inOnOwnLine)) lines.push(`${indent}in`)
        else appendToLast(lines, ' in')
      }
      return [...lines, ...block(node.body, indent)]
    }
    case 'conditional': {
      if (fits && !random.chance(style.breakConditional)) return [flat]
      const lines: string[] = []
      // The branches of a chain `if .. else if .. else ..` all start at the indentation of the first `if`.
      for (let branch: Expression = node, first = true; ; first = false) {
        const start = first ? '' : `${indent}else `
        if (branch.type !== 'conditional') {
          // The last `else`.
          const text = inline(branch, style)
          if (branch.type !== 'local' && indent.length + 5 + text.length <= style.width && !random.chance(style.branchOnOwnLine)) lines.push(`${indent}else ${text}`)
          else lines.push(`${indent}else`, ...block(branch, deeper))
          break
        }
        const head = `${start}if ${inline(branch.condition, style)} then`
        const then = inline(branch.then, style)
        const startColumn = first ? column : 0
        if (branch.then.type !== 'local' && branch.then.type !== 'conditional' && startColumn + head.length + 1 + then.length <= style.width && !random.chance(style.branchOnOwnLine)) lines.push(`${head} ${then}`)
        else lines.push(head, ...block(branch.then, deeper))
        if (branch.otherwise === undefined) break
        branch = branch.otherwise
      }
      return lines
    }
    case 'function': {
      if (fits) return [flat]
      return [`fun ${node.parameters.join(' ')} ->`, ...block(node.body, deeper)]
    }
    case 'operation': {
      if (fits) return [flat]
      // The operands of a chain of operators of one level, e.g. the three of `a && b && c`.
      const level = operatorLevel[node.operator]
      const fromTheRight = groupsFromTheRight.includes(node.operator)
      const operands: Expression[] = [], chainOperators: Operator[] = []
      let rest: Expression = node
      while (rest.type === 'operation' && operatorLevel[rest.operator] === level) {
        operands.push(fromTheRight ? rest.left : rest.right)
        chainOperators.push(rest.operator)
        rest = fromTheRight ? rest.right : rest.left
      }
      operands.push(rest)
      if (!fromTheRight) {
        operands.reverse()
        chainOperators.reverse()
      }
      const lines = linesOf(operands[0]!, indent, column, atLineStart, style, random)
      for (const [place, operator] of chainOperators.entries()) {
        const operand = operands[place + 1]!
        if (style.operatorFirst) {
          const operandLines = linesOf(operand, deeper, deeper.length + operator.length + 1, false, style, random)
          lines.push(`${deeper}${operator} ${operandLines[0]!}`, ...operandLines.slice(1))
        } else {
          appendToLast(lines, ` ${operator}`)
          lines.push(...block(operand, deeper))
        }
      }
      return lines
    }
    case 'application': {
      if (fits) return [flat]
      // The head and the arguments that fit stay on the first line, and the others get a line each.
      let first = inline(node.head, style)
      let onFirstLine = 0
      while (onFirstLine < node.arguments.length - 1 && column + first.length + 1 + inline(node.arguments[onFirstLine]!, style).length <= style.width) first += ` ${inline(node.arguments[onFirstLine++]!, style)}`
      return [first, ...node.arguments.slice(onFirstLine).flatMap(argument => block(argument, deeper))]
    }
    case 'list': {
      if (node.items.length === 0 || (fits && !(node.items.length >= 2 && random.chance(style.breakList)))) return [flat]
      // A list inside a broken list stays on its line where it fits, e.g. the rows of a grid.
      const itemStyle = {...style, breakList: 0}
      if (style.listAsBlock) {
        const lines = ['[']
        for (const [place, item] of node.items.entries()) {
          const itemLines = linesOf(item, deeper, deeper.length, true, itemStyle, random)
          lines.push(deeper + itemLines[0]!, ...itemLines.slice(1))
          if (place < node.items.length - 1) appendToLast(lines, style.semicolon.trimEnd())
        }
        return [...lines, `${indent}]`]
      }
      const hanging = `${indent}  `
      const lines: string[] = []
      for (const [place, item] of node.items.entries()) {
        const itemLines = linesOf(item, hanging, hanging.length, false, itemStyle, random)
        lines.push(`${place === 0 ? '[ ' : hanging}${itemLines[0]!}`, ...itemLines.slice(1))
        appendToLast(lines, place < node.items.length - 1 ? style.semicolon.trimEnd() : ' ]')
      }
      return lines
    }
    case 'tuple': {
      if (fits) return [flat]
      const hanging = `${indent} `
      const lines: string[] = []
      for (const [place, item] of node.items.entries()) {
        const itemLines = linesOf(item, hanging, hanging.length, false, style, random)
        lines.push(`${place === 0 ? '(' : hanging}${itemLines[0]!}`, ...itemLines.slice(1))
        appendToLast(lines, place < node.items.length - 1 ? style.comma.trimEnd() : ')')
      }
      return lines
    }
    case 'negation': {
      if (fits) return [flat]
      const lines = linesOf(node.operand, indent, column + 1, false, style, random)
      return [`-${node.operand.type === 'negation' ? ' ' : ''}${lines[0]!}`, ...lines.slice(1)]
    }
    case 'brackets': {
      if (fits) return [flat]
      const lines = linesOf(node.inner, deeper, column + 1, false, style, random)
      lines[0] = `(${lines[0]!}`
      appendToLast(lines, ')')
      return lines
    }
  }
}

// The lines of a definition at the top of a program. The tree must have its brackets, see withBrackets.
export function linesOfDefinition(binding: Binding, style: Style, random: Random): string[] {
  const head = bindingHead(binding, style)
  const {value} = binding
  const flat = `${head}${afterEquals(style)}${inline(value, style)}`
  if (style.definitionsOnOneLine) return [flat]
  const ownLines = value.type === 'local' ? random.chance(style.breakLocal)
    : value.type === 'conditional' ? random.chance(style.breakConditional)
    : value.type === 'list' ? value.items.length >= 2 && random.chance(style.breakList)
    : binding.parameters.length > 0 && random.chance(style.breakAfterEquals)
  if (flat.length <= style.width && !ownLines) return [flat]
  // A list and a function start on the line of the `=` and go on below it.
  if ((value.type === 'list' && value.items.length >= 2) || (value.type === 'function' && value.body.type !== 'function')) {
    const lines = linesOf(value, '', head.length + 1, false, {...style, breakList: 1}, random)
    if (lines.length > 1) return [`${head}${afterEquals(style)}${lines[0]!}`, ...lines.slice(1)]
  }
  const lines = linesOf(value, style.unit, style.unit.length, true, style, random)
  return [head, style.unit + lines[0]!, ...lines.slice(1)]
}
