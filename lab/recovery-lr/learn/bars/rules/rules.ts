// A table filled by hand-written rules: the recovery that a programmer who knows miniml and bison's automaton
// writes, as choices of the same open cells and from the same lists of choices that training gets. It is the
// counterpart of the 35 hand-written rules of the JSON side (lab/recovery-parser/learn/handwritten/rules.ts), and
// of the error routines that a textbook puts into the blank entries of an LR action table.
//
// Each rule below has a name, the reason a person would give for it, an example, and the cells it sets. A rule
// names its cells by what the states mean, e.g. "after the condition of an `if`", and gives them a choice of the
// cell's list, see ../../recovery-tables.ts. A rule sets open cells only, and no two rules set the same cell: a
// rule that says "the rest" sets the cells that no rule above it has set.
//
// The layout is the recipe's: the flag "first on its line", which gives every open cell a second copy, and a
// terminal of its own for each code point that the rule of ../../picked-terminals.ts picks from the train
// samples, `|` and `&`. The cells of the end of input keep what the parser as it is does, as they do for the
// trained tables. The display entries are not set here: the count of ../../search/count.ts sets them, as for the
// trained rows, see bar.ts.
//
// One rule is marked `leftOut`: it is written and measured, and the bar does not apply it. README.md says why, how
// the rules were written, what each added, and what they leave.
//
//   bun lab/recovery-lr/learn/bars/rules/rules.ts     # prints the rules with their cells
import {itemText} from '../../../tables.ts'
import {
  type AddedTerminal, type RecoveryTables, addFirstOnLineFlag, addTerminals, baseTables, bison, bisonTerminalCount, cellName, cellOf, checkTables, choiceName, choicePop, choiceSkip, choicesOf, droppedOfEndEarly,
  endOfInput, insertOf, kindEndEarly, kindOfChoice, nonterminalOfEndEarly, readAs, reduceBy, stopped,
} from '../../recovery-tables.ts'

// The code points that the rule of ../../picked-terminals.ts picks from the 40,000 train samples, in its order.
// check.ts runs the rule and compares.
export const pickedTerminals: readonly AddedTerminal[] = [{name: 'U+007C', codePoint: 0x7c}, {name: 'U+0026', codePoint: 0x26}]
const loneBar = 'U+007C', loneAmpersand = 'U+0026'

// The parser as it is, in the layout of the recipe.
export const layoutOfTheRecipe = (): RecoveryTables => addFirstOnLineFlag(addTerminals(baseTables(), pickedTerminals))

// What a cell is set to: a choice, or a function that gives the choice for the cell's state, e.g. the item to end
// early, which depends on the state.
type Choice = number | ((state: number) => number)
// Which copies of a cell a rule sets: both, the copy that a token reads when it is the first on its line, or the
// copy that every other token reads.
type Copies = 'both' | 'first on its line' | 'later on its line'

type CellSetter = {
  // Sets the cells of every one of the states for every one of the terminals. Each has to be open, and none may
  // have been set by a rule before.
  cells: (states: number | readonly number[], terminals: string | readonly string[], choice: Choice, copies?: Copies) => void
  // The same for the cells among them that are open and that no rule above has set: "the rest".
  rest: (states: number | readonly number[], terminals: string | readonly string[], choice: Choice, copies?: Copies) => void
  // Says that the rule relies on what open cells hold in the parser as it is, e.g. bison's default reduction of a
  // complete atom, which leads to the state that decides. The cells are not changed, and are counted apart.
  asItIs: (states: number | readonly number[], terminals: string | readonly string[], copies?: Copies) => void
}

export type Rule = {
  name: string
  // Why a person would write the rule.
  reason: string
  // A broken text that the rule is for.
  example: string
  // A rule that is written and measured and that the bar leaves out, see README.md.
  leftOut?: true
  cells: (set: CellSetter) => void
}

// ---- Terminals, by what they are in a program ----

// What an atom can start with, and what an expression can start with.
const atomStarts = ['TRUE', 'FALSE', 'IDENT', 'INT', 'STRING', 'LPAREN', 'LBRACK'] as const
const expressionStarts = [...atomStarts, 'LET', 'IF', 'FUN', 'MINUS'] as const
// The operators between two expressions. MINUS also starts an expression.
const binaryOperators = ['EQ', 'NE', 'LT', 'LE', 'GT', 'GE', 'PLUS', 'MINUS', 'STAR', 'SLASH', 'CONS', 'AND', 'OR', 'CARET'] as const
// What ends an expression inside a larger one.
const closingBrackets = ['RPAREN', 'RBRACK'] as const
const separators = ['COMMA', 'SEMI'] as const
const closingKeywords = ['IN', 'THEN', 'ELSE'] as const
// The starts of an expression that cannot go on with a complete expression. A `let` there starts the next
// definition, and a `-` is the operator.
const startsAfterAnExpression = expressionStarts.filter(terminal => terminal !== 'LET' && terminal !== 'MINUS')
// Every terminal that a text can hold but the end of input, with the two added ones.
const everyTerminal = [...bison.textTerminals.filter(terminal => terminal !== endOfInput).map(terminal => bison.symbolNames[terminal]!), ...pickedTerminals.map(terminal => terminal.name)]

// ---- States, by what they mean ----

const everyState = Array.from({length: bison.stateCount}, (_, state) => state)
// The state whose kernel holds the item, e.g. stateWith('expr: IF expr . THEN expr'), the state after the
// condition of an `if`.
function stateWith(item: string): number {
  const states = everyState.filter(state => bison.stateKernel[state]!.some(kernelItem => itemText(kernelItem) === item))
  if (states.length !== 1) throw new Error(`${states.length} states have the item ${item}`)
  return states[0]!
}
// The states that a symbol leads into, e.g. statesAfter('expr'), the states after a complete expression.
const statesAfter = (symbol: string): number[] => everyState.filter(state => state !== bison.startState && bison.symbolNames[bison.accessingSymbol[state]!] === symbol)
const hasGoto = (state: number, nonterminal: string): boolean => bison.gotoState[state * bison.nonterminalCount + bison.symbolNames.indexOf(nonterminal) - bisonTerminalCount] !== -1

// Between two definitions, and at the start of the text, where bison first puts an empty list of definitions.
const startOfText = bison.startState
const betweenDefinitions = stateWith('program: definitions .')
// After `let` and after `let rec`, of a definition and of a local definition: a name, `_` or `()` has to come.
const afterLet = [stateWith('definition: LET . binding'), stateWith('definition: LET REC . binding'), stateWith('expr: LET . binding IN expr'), stateWith('expr: LET REC . binding IN expr')]
// After the name that a `let` defines, where bison puts an empty list of parameters, and after the parameters.
const afterDefinedName = stateWith('binding: IDENT . parameters EQ expr')
const afterParametersOfLet = stateWith('binding: IDENT parameters . EQ expr')
// After the `_` and after the `()` that a `let` defines: `=` has to come.
const beforeEqualsOfLet = [stateWith('binding: UNDERSCORE . EQ expr'), stateWith('binding: LPAREN RPAREN . EQ expr')]
// After the `(` of `()` in the place of a name or of a parameter: `)` has to come.
const insideUnitOfLet = stateWith('binding: LPAREN . RPAREN EQ expr')
const insideUnitParameter = stateWith('parameter: LPAREN . RPAREN')
// After a complete parameter, where bison reduces by default.
const afterParameter = [...everyState.filter(state => bison.completeRules[state]!.some(rule => bison.symbolNames[bison.ruleLhs[rule]!] === 'parameter')), stateWith('parameters: parameters parameter .')]
// After `fun`, after its first parameter, where bison puts an empty list of further parameters, and after them.
const afterFun = stateWith('expr: FUN . parameter parameters ARROW expr')
const afterFirstParameterOfFun = stateWith('expr: FUN parameter . parameters ARROW expr')
const afterParametersOfFun = stateWith('expr: FUN parameter parameters . ARROW expr')
// A complete definition at the top, and a complete local definition, which waits for `in`.
const afterDefinition = [stateWith('definition: LET binding .'), stateWith('definition: LET REC binding .'), stateWith('definitions: definitions definition .')]
const afterLocalBinding = [stateWith('expr: LET binding . IN expr'), stateWith('expr: LET REC binding . IN expr')]

// The states that wait for an expression, e.g. after `=`, `then`, `+`, `(`.
const expressionExpected = everyState.filter(state => hasGoto(state, 'expr'))
const afterEqualsOfLet = expressionExpected.filter(state => bison.stateKernel[state]!.every(kernelItem => itemText(kernelItem).startsWith('binding: ')))
const afterIn = [stateWith('expr: LET binding IN . expr'), stateWith('expr: LET REC binding IN . expr')]
const afterArrow = stateWith('expr: FUN parameter parameters ARROW . expr')
const afterBinaryOperator = expressionExpected.filter(state => (binaryOperators as readonly string[]).includes(bison.symbolNames[bison.accessingSymbol[state]!]!) && bison.stateKernel[state]!.every(kernelItem => /^expr: expr \w+ \. expr$/.test(itemText(kernelItem))))
// A complete atom, an atom as the function or as an argument of an application, and an application that may get
// more arguments.
const afterCompleteAtom = everyState.filter(state => bison.completeRules[state]!.some(rule => bison.symbolNames[bison.ruleLhs[rule]!] === 'atom'))
const afterAtom = statesAfter('atom')
const afterApplication = stateWith('expr: application .')
// After a complete expression, by what the expression is part of.
const afterExpression = statesAfter('expr')
const afterBodyOfLet = afterExpression.filter(state => bison.completeRules[state]!.some(rule => bison.symbolNames[bison.ruleLhs[rule]!] === 'binding'))
const afterCondition = stateWith('expr: IF expr . THEN expr')
const afterThenBranch = stateWith('expr: IF expr THEN expr .')
const insideRoundBracket = stateWith('atom: LPAREN expr . RPAREN')
const afterListElement = [stateWith('elements: expr .'), stateWith('elements: elements SEMI expr .')]
const afterListElements = stateWith('atom: LBRACK elements . RBRACK')
const afterTupleElement = [stateWith('tuple_rest: expr .'), stateWith('tuple_rest: tuple_rest COMMA expr .')]
const afterTupleElements = stateWith('atom: LPAREN expr COMMA tuple_rest . RPAREN')
// After an expression that is complete as it stands and that an operator can still continue: the operand of an
// operator, the body of a `let … in`, of a `fun`, the `else` branch.
const afterOperand = afterExpression.filter(state => bison.completeRules[state]!.some(rule => bison.symbolNames[bison.ruleLhs[rule]!] === 'expr') && state !== afterThenBranch)

// ---- Choices ----

const skip = choiceSkip
const insert = (terminal: string): number => insertOf(bison.symbolNames.indexOf(terminal))
const readAsTerminal = (terminal: string): number => readAs(bison.symbolNames.indexOf(terminal))
// bison's default reduction of the state.
const reduceByDefault = (state: number): number => reduceBy(bison.defaultRule[state]!)
// The choice that ends an item of the state early, e.g. endEarly('atom') in the state after `( expression`, where
// it makes `( expression` an atom without its `)`. With `dropped`, the item with that many symbols before its dot.
const endEarly = (nonterminal: string, dropped?: number) => (state: number): number => {
  const choices = choicesOf(baseTables(), cellOf(baseTables(), state, bison.symbolNames.indexOf('BADCHAR')))
    .filter(choice => kindOfChoice(choice) === kindEndEarly && bison.symbolNames[nonterminalOfEndEarly(choice)] === nonterminal && (dropped === undefined || droppedOfEndEarly(choice) === dropped))
  if (choices.length !== 1) throw new Error(`state ${state} has ${choices.length} items of ${nonterminal} to end early${dropped === undefined ? '' : ` after ${dropped} symbols`}`)
  return choices[0]!
}
// In a state after a complete expression: the operator `*` is inserted where the state can shift it, and where
// it cannot, because the expression is an operand that binds as tightly, bison's default reduction leads to a
// state that can.
const insertAnOperator = (state: number): number => bison.transition[state * bison.symbolCount + bison.symbolNames.indexOf('STAR')] !== -1 ? insert('STAR') : reduceByDefault(state)

// The operator whose state gets a second meaning in the rule for a `,` without its opening bracket.
const operatorOfSecondMeaning = 'CARET'
const afterOperatorOfSecondMeaning = stateWith(`expr: expr ${operatorOfSecondMeaning} . expr`)

// The cells of a token that starts the next definition, in the states in which something is still open: each
// ends what is open early, and the token is read again by the state below.
function endWhatIsOpen(set: CellSetter, terminal: string) {
  set.cells([insideRoundBracket, afterListElements, afterTupleElements], terminal, endEarly('atom'))
  set.asItIs([...afterListElement, ...afterTupleElement], terminal)
  set.cells(afterCondition, terminal, endEarly('expr', 2))
  set.cells(afterLocalBinding, terminal, endEarly('expr'))
  set.cells([afterParametersOfLet, ...beforeEqualsOfLet, insideUnitOfLet], terminal, endEarly('binding'))
  set.cells(insideUnitParameter, terminal, endEarly('parameter'))
  set.cells([afterFun, afterParametersOfFun], terminal, endEarly('expr'))
  set.asItIs([afterDefinedName, afterFirstParameterOfFun, ...afterParameter], terminal)
}

export const rules: readonly Rule[] = [
  // ---- Text that is no token ----
  {
    name: 'a character that starts no token',
    reason: 'A character that no token starts with, e.g. `#`, `.` or `!`, is dropped where it stands, and the parser goes on in the state it is in.',
    example: 'let total = price # * count',
    cells: set => set.cells(everyState, 'BADCHAR', skip),
  },
  {
    name: 'a lone `&` or `|`',
    reason: 'A `&` or a `|` alone is what is left of `&&` or `||`: after a complete expression it is read as that operator. Where bison still reduces a complete atom or operand by default, that leads to the state that can take the operator. Anywhere else it is dropped.',
    example: 'let ok = ready & not failed',
    cells: set => {
      for (const [character, operator] of [[loneAmpersand, 'AND'], [loneBar, 'OR']] as const) {
        const takesOperator = (state: number): boolean => bison.transition[state * bison.symbolCount + bison.symbolNames.indexOf(operator)] !== -1
        set.cells(afterExpression.filter(takesOperator), character, readAsTerminal(operator))
        set.asItIs([...afterCompleteAtom, ...afterAtom, afterApplication, ...afterExpression.filter(state => !takesOperator(state) && bison.defaultRule[state] !== -1)], character)
        set.rest(everyState, character, skip)
      }
    },
  },
  {
    name: 'an open string',
    reason: 'A string that is not closed on its line is read as a string where an atom can stand: where an expression has to come, and as an argument. After a complete atom, bison\'s default reductions lead to the application that takes the argument. Anywhere else it is dropped.',
    example: 'let greeting = "hello ^ name',
    cells: set => {
      set.cells([...expressionExpected, afterApplication], 'BADSTRING', readAsTerminal('STRING'))
      set.asItIs([...afterCompleteAtom, ...afterAtom], 'BADSTRING')
      set.rest(everyState, 'BADSTRING', skip)
    },
  },
  {
    name: 'an open comment',
    reason: 'A comment that is not closed takes the rest of the text. It is dropped.',
    example: 'let total = 1 (* the sum',
    cells: set => set.cells(everyState, 'BADCOMMENT', skip),
  },

  // ---- A token that starts something new ----
  {
    name: 'the next definition starts',
    reason: 'A `let` after a complete expression can only start the next definition, so whatever is still open ends early: a bracket without its closing bracket, a list, a tuple, an `if` without its `then`, a local definition without its `in`, a `fun` without its `->`, the head of a definition without its `=`. A second `let` right after a `let` is dropped.',
    example: 'let area = (width * height\nlet volume = area * depth',
    cells: set => {
      endWhatIsOpen(set, 'LET')
      set.cells(afterLet, 'LET', skip)
    },
  },
  {
    name: 'a `rec` without its `let`',
    reason: '`rec` only follows `let`. After a name it shows that the name is a damaged `let`, e.g. `et rec`, so it starts the next definition as a `let` does: what is open ends early, bison\'s default reductions close the definition before, and between the definitions a `let` is put before the `rec`. Where an expression has to come, and after a `let rec`, it is dropped.',
    example: 'let limit = 10\net rec count n = if n = 0 then 0 else count (n - 1)',
    cells: set => {
      endWhatIsOpen(set, 'REC')
      set.asItIs([...afterCompleteAtom, ...afterAtom, afterApplication, ...afterExpression.filter(state => bison.defaultRule[state] !== -1), ...afterDefinition, startOfText], 'REC')
      set.cells(betweenDefinitions, 'REC', insert('LET'))
      set.rest(everyState, 'REC', skip)
    },
  },
  {
    name: 'an expression that ends before `if` or `fun`',
    reason: 'An `if` or a `fun` cannot go on with a complete expression: something is missing between the two, most often an `in`, or the head of the next definition. So the expression ends, and so does what it is the last part of: bison\'s default reductions lead down to the body of a `let` and close its definition. From there, the rule for a local definition without its `in` goes on, or the rule for text between definitions. After the condition and after the `then` branch of an `if` this holds for an `if` or a `fun` that is the first on its line: the `if` before it ends as it stands. On the same line a `then` or an `else` is missing, see below.',
    example: 'let clamp n =\n  let top = 100\n  if n > top then top else n',
    cells: set => {
      set.asItIs([...afterCompleteAtom, ...afterAtom, afterApplication, ...afterOperand, ...afterBodyOfLet], ['IF', 'FUN'])
      set.asItIs(afterThenBranch, ['IF', 'FUN'], 'first on its line')
      set.cells(afterCondition, ['IF', 'FUN'], endEarly('expr', 2), 'first on its line')
    },
  },

  // ---- A closing part whose opening part is missing ----
  {
    name: 'a `then` or an `else` without its `if`',
    reason: 'A `then` or an `else` after the complete body of a `let` has no `if` that waits for it: the `if` is damaged, e.g. `fi`, or lost with its line, and what stands before the keyword is what is left of the `if` and its condition. So that expression is dropped, which leads back to the state after the `=`, and there an `if` is put, as after `in` and after `->`. The branches that follow are then branches. The rules for a missing expression and a missing `then` put the condition and the first branch.',
    example: 'let sign n = fi n < 0 then 0 - 1 else 1',
    cells: set => {
      set.cells(afterBodyOfLet, ['THEN', 'ELSE'], choicePop)
      set.cells([...afterEqualsOfLet, ...afterIn, afterArrow], ['THEN', 'ELSE'], insert('IF'))
    },
  },
  {
    name: 'an `->` without its `fun`',
    reason: 'An `->` in an expression shows that its `fun` is damaged, e.g. `fn x ->`, or missing. In the same way, the complete expression before the `->` is dropped, and where an expression has to come, `fun` is put, and the rule for a `fun` without its parameter adds a name. After a complete atom, bison\'s default reductions lead to the expression that is dropped.',
    example: 'let twice = map (fn x -> x * 2) items',
    cells: set => {
      set.cells(expressionExpected, 'ARROW', insert('FUN'))
      set.asItIs([...afterCompleteAtom, ...afterAtom, afterApplication], 'ARROW')
      set.cells(afterExpression, 'ARROW', choicePop)
    },
  },
  {
    name: 'a `,` without its opening bracket',
    reason: 'A `,` after the complete body of a `let` separates the expressions of a tuple whose opening bracket is missing, e.g. a tuple that was written without brackets. What follows is still inside the tuple, so a bracket is put there. The body is the tuple\'s first expression and cannot be dropped, so the bracket has to be the right side of an operator: after the body `^` is put, after `^` a `,` puts a `(`, and the rule for a missing expression puts a name before the `,`. The state after `^` so has a second meaning: a text with a `,` right after a `^` is read the same way.',
    example: 'let pair = 1, 2',
    cells: set => {
      set.cells(afterBodyOfLet, 'COMMA', insert(operatorOfSecondMeaning))
      set.cells(afterOperatorOfSecondMeaning, 'COMMA', insert('LPAREN'))
    },
  },
  {
    name: 'a `;` without its opening bracket',
    leftOut: true,
    reason: 'The same as for a `,`, for a `;` after the complete body of a `let` and a list: after `^` a `;` puts a `[`. The train score is higher with this rule, and the bar leaves it out: a `;` or `;;` after a definition at the top is a habit of OCaml, and there a list that is put in swallows the next definition. Without the rule the `;` is dropped.',
    example: 'let primes = 2; 3; 5]',
    cells: set => {
      set.cells(afterBodyOfLet, 'SEMI', insert(operatorOfSecondMeaning))
      set.cells(afterOperatorOfSecondMeaning, 'SEMI', insert('LBRACK'))
    },
  },
  {
    name: 'an `in` without its `let`',
    reason: 'An `in` after a complete definition at the top has no local `let` that waits for it: the `let` is damaged, e.g. `lte`, or lost with its line, and what was read as the body of the definition was the local definition. What follows the `in` is still the body of a local definition, so the cells that the `in` reads next build one: the definition at the top is dropped down to its `let`, and `_ = let name =` is put there, which the `in` then closes. The price: when a person writes `in` after a definition at the top and goes on with the next definition, that definition is read as a local one.',
    example: 'let area w h =\n  lte half = w / 2 in\n  half * h',
    cells: set => {
      set.cells([stateWith('definition: LET binding .'), stateWith('definition: LET REC binding .')], 'IN', choicePop)
      set.cells([stateWith('definition: LET . binding'), stateWith('definition: LET REC . binding')], 'IN', insert('UNDERSCORE'))
      set.cells(stateWith('binding: UNDERSCORE EQ . expr'), 'IN', insert('LET'))
      set.cells([stateWith('expr: LET . binding IN expr'), stateWith('expr: LET REC . binding IN expr')], 'IN', insert('IDENT'))
      set.cells([stateWith('binding: IDENT parameters EQ . expr'), stateWith('binding: LPAREN RPAREN EQ . expr')], 'IN', endEarly('binding'))
    },
  },

  // ---- An opening part whose closing part is missing ----
  {
    name: 'an `if` without its `then`',
    reason: 'After the condition of an `if`, an `else` or the start of an expression on the same line shows that the `then` is missing: it is put there.',
    example: 'let sign n = if n < 0 0 - 1 else 1',
    cells: set => {
      set.cells(afterCondition, ['ELSE', ...atomStarts], insert('THEN'))
      set.cells(afterCondition, ['IF', 'FUN'], insert('THEN'), 'later on its line')
    },
  },
  {
    name: 'a second branch without its `else`',
    reason: 'After the `then` branch of an `if`, the start of an expression on the same line shows that the `else` is missing: it is put there.',
    example: 'let size n = if n < 10 then "small" if n < 100 then "medium" else "large"',
    cells: set => {
      set.cells(afterThenBranch, atomStarts, insert('ELSE'))
      set.cells(afterThenBranch, ['IF', 'FUN'], insert('ELSE'), 'later on its line')
    },
  },
  {
    name: 'a local definition without its `in`',
    reason: 'After a complete local definition, the start of an expression shows that the `in` is missing: it is put there.',
    example: 'let area w h = let half = w / 2 if half > 0 then half * h else 0',
    cells: set => set.cells(afterLocalBinding, startsAfterAnExpression, insert('IN')),
  },
  {
    name: 'a closing keyword inside a bracket',
    reason: 'An `in`, a `then` or an `else` after a complete expression inside a bracket, a list or a tuple shows that the closing bracket is missing: the bracket ends early, and the keyword is read again by what is around the bracket.',
    example: 'let f x = if (x > 0 then x else 0',
    cells: set => set.cells([insideRoundBracket, afterListElements, afterTupleElements], closingKeywords, endEarly('atom')),
  },
  {
    name: 'a closing bracket of the other kind',
    reason: 'A `]` inside a round bracket and a `)` inside a list cannot close what is innermost: its closing bracket is missing, so it ends early, and the bracket is read again by what is around. A `;` inside a round bracket does the same: the list around it goes on.',
    example: 'let total = sum [price; (tax + fee]',
    cells: set => {
      set.cells([insideRoundBracket, afterTupleElements], ['RBRACK', 'SEMI'], endEarly('atom'))
      set.cells(afterListElements, 'RPAREN', endEarly('atom'))
    },
  },
  {
    name: 'a list or a tuple without a separator',
    reason: 'A `,` between the expressions of a list is read as the `;` that the list wants. The start of an expression after the expressions of a list or of a tuple shows that the separator is missing: it is put there.',
    example: 'let primes = [2, 3, 5]',
    cells: set => {
      set.asItIs(afterListElement, 'COMMA')
      set.cells(afterListElements, 'COMMA', readAsTerminal('SEMI'))
      set.cells(afterListElements, startsAfterAnExpression, insert('SEMI'))
      set.cells(afterTupleElements, startsAfterAnExpression, insert('COMMA'))
    },
  },

  // ---- The heads of definitions and of functions ----
  {
    name: 'text between definitions',
    reason: 'Between two definitions only `let` can stand. A name there is a damaged `let`, e.g. `et`, and is read as `let`. Any other start of an expression but `(` is the body of a definition that lost its head: a `let` is put before it, and the rules for a missing name and a missing `=` do the rest. Everything else is dropped. After a complete definition, bison\'s default reductions lead back to the state between definitions.',
    example: 'et total = 1\nlet count = 2',
    cells: set => {
      set.asItIs(startOfText, everyTerminal)
      set.cells(betweenDefinitions, 'IDENT', readAsTerminal('LET'))
      set.cells(betweenDefinitions, expressionStarts.filter(terminal => !['IDENT', 'LET', 'LPAREN'].includes(terminal)), insert('LET'))
      set.rest(betweenDefinitions, everyTerminal, skip)
      set.rest(afterDefinition, everyTerminal, reduceByDefault)
    },
  },
  {
    name: 'a `let` without its name',
    reason: 'After `let`, an `=` or the start of an expression that is no name shows that the name is missing: a name is put there. `true` and `false` are read as the name. Anything else is dropped.',
    example: 'let = width * height',
    cells: set => {
      set.cells(afterLet, ['EQ', 'INT', 'STRING', 'LBRACK', 'IF', 'FUN', 'MINUS'], insert('IDENT'))
      set.cells(afterLet, ['TRUE', 'FALSE'], readAsTerminal('IDENT'))
      set.rest(afterLet, everyTerminal, skip)
    },
  },
  {
    name: 'a `(` in the place of a name or a parameter',
    reason: 'Only `()` can stand there. Before a name or a `_` the `(` is dropped: it starts a pattern, e.g. `(x)` or `(a, b)`, and the name is read as the name or the parameter. An `=` or an `->` shows that the `)` is missing. Anything else is dropped up to the `)`.',
    example: 'let first (a, b) = a',
    cells: set => {
      set.cells([insideUnitOfLet, insideUnitParameter], ['IDENT', 'UNDERSCORE'], choicePop)
      set.cells([insideUnitOfLet, insideUnitParameter], ['EQ', 'ARROW'], insert('RPAREN'))
      set.rest([insideUnitOfLet, insideUnitParameter], everyTerminal, skip)
    },
  },
  {
    name: 'a definition without its `=`',
    reason: 'After the name and the parameters of a definition, the start of an expression that is no parameter, an operator or an `in` shows that the `=` is missing: it is put there. A closing bracket, a `,` or a `;` is dropped, e.g. what is left of a pattern. After the name and after a parameter, bison\'s default reductions lead to the state that decides.',
    example: 'let limit 10',
    cells: set => {
      set.asItIs([afterDefinedName, ...afterParameter], everyTerminal)
      set.rest([afterParametersOfLet, ...beforeEqualsOfLet], [...expressionStarts, ...binaryOperators, 'ARROW', 'IN'], insert('EQ'))
      set.rest([afterParametersOfLet, ...beforeEqualsOfLet], everyTerminal, skip)
    },
  },
  {
    name: 'a `fun` without its parameter or its `->`',
    reason: 'After `fun`, an `->` shows that the parameter is missing: a name is put there. After the parameters, the start of an expression that is no parameter, or an operator, shows that the `->` is missing: it is put there, and a `-`, a `>` or an `=` is read as the `->` that it was. A closing bracket, a separator or a closing keyword ends the `fun` early.',
    example: 'let twice = map (fun x x * 2) items',
    cells: set => {
      set.cells(afterFun, 'ARROW', insert('IDENT'))
      set.cells([afterFun, afterParametersOfFun], [...closingBrackets, ...separators, ...closingKeywords], endEarly('expr'))
      set.rest(afterFun, everyTerminal, skip)
      set.asItIs(afterFirstParameterOfFun, everyTerminal)
      set.cells(afterParametersOfFun, ['MINUS', 'GT', 'EQ'], readAsTerminal('ARROW'))
      set.cells(afterParametersOfFun, ['INT', 'STRING', 'TRUE', 'FALSE', 'LBRACK', 'IF', 'FUN', ...binaryOperators.filter(terminal => !['MINUS', 'GT', 'EQ'].includes(terminal))], insert('ARROW'))
      set.rest(afterParametersOfFun, everyTerminal, skip)
    },
  },

  // ---- Inside an expression ----
  {
    name: 'a `_` in an expression',
    reason: '`_` is no expression. Where an expression has to come and as an argument it is read as a name. After a complete atom, bison\'s default reductions lead to the application that takes the argument. Anywhere else it is dropped.',
    example: 'let first = fst _ pair',
    cells: set => {
      set.cells([...expressionExpected, afterApplication], 'UNDERSCORE', readAsTerminal('IDENT'))
      set.asItIs([...afterCompleteAtom, ...afterAtom], 'UNDERSCORE')
      set.rest(everyState, 'UNDERSCORE', skip)
    },
  },
  {
    name: 'an expression is missing',
    reason: 'Where an expression has to come, a closing bracket, a separator or a closing keyword shows that the expression is missing: a name is put there, and the token is read again. A second `then`, `else`, `in`, `,` or `;` right after the first is dropped, and so is an operator.',
    example: 'let total = if ready then else 0',
    cells: set => {
      set.cells(stateWith('expr: IF expr THEN . expr'), 'THEN', skip)
      set.cells(stateWith('expr: IF expr THEN expr ELSE . expr'), 'ELSE', skip)
      set.rest(afterIn, 'IN', skip)
      set.cells([stateWith('atom: LPAREN expr COMMA . tuple_rest RPAREN'), stateWith('tuple_rest: tuple_rest COMMA . expr')], 'COMMA', skip)
      set.cells(stateWith('elements: elements SEMI . expr'), 'SEMI', skip)
      set.rest(expressionExpected, [...closingBrackets, ...separators, ...closingKeywords], insert('IDENT'))
      set.rest(expressionExpected, binaryOperators, skip)
    },
  },
  {
    name: 'an operator is missing',
    reason: 'After a complete expression, the start of an expression cannot go on with it: an operator is missing between the two, and `*` is put there. An application takes every atom as an argument, so this only comes after another repair, or before an `if` or a `fun` inside a bracket.',
    example: 'let total = (price + tax if round then 1 else 0)',
    cells: set => set.rest(afterExpression, startsAfterAnExpression, insertAnOperator),
  },
  {
    name: 'a closing bracket, separator or keyword that nothing waits for',
    reason: 'After a complete expression, a closing bracket, a `,`, a `;`, a `then`, an `else` or an `in` that the state does not take is dropped: more often its opening part was lost than the closing part of something inside. After the expressions of a list or a tuple, bison\'s default reductions lead to the state that decides.',
    example: 'let total = price * count) + tax',
    cells: set => {
      set.asItIs([...afterListElement, ...afterTupleElement], [...closingBrackets, ...separators, ...closingKeywords])
      set.rest([...afterExpression, afterListElements, afterTupleElements, ...afterLocalBinding], [...closingBrackets, ...separators, ...closingKeywords, 'ARROW'], skip)
    },
  },
  {
    name: 'an operator without its left side',
    reason: 'After the expressions of a list or a tuple and after a complete local definition, an operator has nothing to its left that it could go on with: it is dropped. No sample reads these cells: a parser only reaches them when a token is skipped after 16 steps.',
    example: 'let pair = (1, 2 let rest = 3',
    cells: set => set.rest([afterListElements, afterTupleElements, ...afterLocalBinding], binaryOperators, skip),
  },
]

// The terminal of a name in the layout of `tables`: one of bison's, or an added one.
function terminalOf(tables: RecoveryTables, name: string): number {
  const ofBison = bison.symbolNames.indexOf(name)
  if (ofBison !== -1 && ofBison < bisonTerminalCount) return ofBison
  const added = tables.addedTerminals.findIndex(terminal => terminal.name === name)
  if (added === -1) throw new Error(`no terminal ${name}`)
  return bisonTerminalCount + added
}

export type FilledTables = {
  tables: RecoveryTables
  // Per rule, in the order of `rules`: the cells that it set, and the cells that it relies on as they are.
  cellsOfRule: {name: string, set: number[], asItIs: number[]}[]
}

export type RuleOptions = {
  // With true, the rules that the bar leaves out are applied too.
  withLeftOut?: boolean
  // Only the rules for which this gives true are applied, e.g. to leave one out.
  only?: (rule: Rule, index: number) => boolean
}

// The tables of the rules: the parser as it is in the layout of the recipe, with the cells that the rules set.
// Every open display entry holds `error`: bar.ts sets them by the count.
export function tablesOfRules(options: RuleOptions = {}): FilledTables {
  const tables = layoutOfTheRecipe()
  const setBy = new Map<number, string>()
  const cellsOfRule: FilledTables['cellsOfRule'] = []
  rules.forEach((rule, index) => {
    if ((rule.leftOut === true && options.withLeftOut !== true) || (options.only !== undefined && !options.only(rule, index))) {
      cellsOfRule.push({name: rule.name, set: [], asItIs: []})
      return
    }
    const entry = {name: rule.name, set: [] as number[], asItIs: [] as number[]}
    const each = (states: number | readonly number[], terminals: string | readonly string[], copies: Copies, visit: (cell: number, state: number) => void) => {
      for (const state of new Set(typeof states === 'number' ? [states] : states)) {
        if (state === stopped) throw new Error(`the rule "${rule.name}" names the state stopped`)
        for (const name of new Set(typeof terminals === 'string' ? [terminals] : terminals)) {
          const terminal = terminalOf(tables, name)
          if (terminal === endOfInput) throw new Error(`the rule "${rule.name}" names a cell of the end of input`)
          if (copies !== 'first on its line') visit(cellOf(tables, state, terminal, 0), state)
          if (copies !== 'later on its line') visit(cellOf(tables, state, terminal, 1), state)
        }
      }
    }
    const put = (cell: number, state: number, choice: Choice) => {
      const value = typeof choice === 'number' ? choice : choice(state)
      if (!choicesOf(tables, cell).includes(value)) throw new Error(`the rule "${rule.name}" sets the cell ${cellName(tables, cell)} to ${choiceName(value)}, which is not in the cell's list`)
      tables.choice[cell] = value
      setBy.set(cell, rule.name)
      entry.set.push(cell)
    }
    rule.cells({
      cells: (states, terminals, choice, copies = 'both') => each(states, terminals, copies, (cell, state) => {
        if (tables.open[cell] !== 1) throw new Error(`the rule "${rule.name}" names the frozen cell ${cellName(tables, cell)}`)
        if (setBy.has(cell)) throw new Error(`the rule "${rule.name}" names the cell ${cellName(tables, cell)}, which the rule "${setBy.get(cell)}" has named`)
        put(cell, state, choice)
      }),
      rest: (states, terminals, choice, copies = 'both') => each(states, terminals, copies, (cell, state) => {
        if (tables.open[cell] === 1 && !setBy.has(cell)) put(cell, state, choice)
      }),
      asItIs: (states, terminals, copies = 'both') => each(states, terminals, copies, cell => {
        if (tables.open[cell] !== 1 || setBy.has(cell)) return
        setBy.set(cell, rule.name)
        entry.asItIs.push(cell)
      }),
    })
    cellsOfRule.push(entry)
  })
  checkTables(tables)
  return {tables, cellsOfRule}
}

if (import.meta.main) {
  const {tables, cellsOfRule} = tablesOfRules()
  const base = layoutOfTheRecipe()
  let set = 0, changed = 0, asItIs = 0
  for (const [index, rule] of rules.entries()) {
    const cells = cellsOfRule[index]!
    const changedCells = cells.set.filter(cell => tables.choice[cell] !== base.choice[cell]).length
    console.log(`${String(index + 1).padStart(2)}. ${rule.name}${rule.leftOut === true ? ' (left out of the bar)' : ''}: ${cells.set.length} cells set, ${changedCells} of them to another choice than the parser as it is has, and ${cells.asItIs.length} relied on as they are`)
    console.log(`    ${rule.reason}`)
    console.log(`    e.g. ${JSON.stringify(rule.example)}`)
    set += cells.set.length
    changed += changedCells
    asItIs += cells.asItIs.length
  }
  const open = Array.from(tables.open.keys()).filter(cell => tables.open[cell] === 1 && cell % tables.terminalCount !== endOfInput && Math.floor((cell % tables.cellsPerCopy) / tables.terminalCount) !== stopped)
  console.log(`${rules.filter(rule => rule.leftOut !== true).length} rules set ${set} of the ${open.length} open cells that may change, ${changed} of them to another choice than the parser as it is has, and rely on ${asItIs} more as they are. Each cell is counted in both copies of the flag "first on its line".`)
}

// The groups of states by their names, for try.ts.
export const stateGroups: Record<string, readonly number[]> = {
  everyState, expressionExpected, afterBinaryOperator, afterCompleteAtom, afterAtom, afterExpression, afterBodyOfLet, afterOperand, afterLet, afterDefinition, afterLocalBinding, afterListElement, afterTupleElement,
  afterParameter, beforeEqualsOfLet,
}
export const terminalGroups: Record<string, readonly string[]> = {atomStarts, expressionStarts, binaryOperators, closingBrackets, separators, closingKeywords}
