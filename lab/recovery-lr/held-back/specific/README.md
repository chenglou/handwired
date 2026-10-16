# Held back: mistakes that people make in an ML-like language

**Do not read this folder if you build the tables, the train data, the recovery parser, the twins, the training or the bars.** That holds for this page, for every file next to it, for a dump of the set outside the repo, and for a description of the set in a report or a message. [`../README.md`](../README.md) says who may read it.

This folder is one of the test sets of the track on bison's LR table (`lab/recovery-lr/`): 6,000 broken miniml programs that a generator makes from valid programs, with one or two mistakes each. The mistakes are of 41 kinds that people make in a language of this sort, e.g. a forgotten `in`, `;;` after a definition, `==` for `=`, or a program inside a code fence. The train data's damage knows nothing of the language: it deletes, inserts and copies code points and lines. So this set asks whether tables that were trained on such damage also recover from mistakes that have a cause. The other set, `../written/`, has broken programs that agents wrote by hand.

A sample has the shape of a train sample, `Sample` of `lab/recovery-lr/sample.ts`, and is made by the same `makeSample`. Nothing is stored: sample `index` is a function of the seed and the index, and the set is the first 6,000 samples of the seed 20261017.

## How other code reads the set

```ts
import {loadSpecific} from './specific.ts'

const set = loadSpecific()                       // the 6,000 samples, in 2.5 s
const samples = set.map(({sample}) => sample)    // whatever scores the train and validation samples scores these
```

- `sample` is a `Sample`: `isScored(sample, position)` is true for the kept code points from the first error on, and `labelKind`, `labelDepth`, `labelContainer`, `labelStack`, `keptToken` and `constituents` are what a score compares with. `sample.id` is e.g. `specific:1234`, and `sample.edits` holds the names of the kinds.
- `kinds` and `forms` name the one or two mistakes, e.g. `['missing in']` and ``['before `let`']``. `sort` is the sort of the program, e.g. `shop`. `program` is the valid program as the generator wrote it, and `thrown` lists the draws that were thrown away before the sample.
- No code outside `lab/recovery-lr/held-back/` may import from it. A command that scores tables on the set stands in this folder and imports the recovery parser and the score from outside, as `reach.ts` does.

## The programs

`programs.ts` writes the valid programs. It shares the grammar with the train data's generator and nothing else: not its sorts of programs, not its names, not its layouts.

- **16 sorts with 265 definitions** in `templates.ts`, as plain miniml: a shop, shapes, dates, a text report, a board game, functions that take functions, a bank account, sensors, roads, a cipher, tasks, the fields of a form, vectors, a search tree, a recipe and a vending machine. A program holds definitions of one sort in a random order, and one in six from another sort. `{a|b|c}` in a definition is one of the three texts, drawn per program.
- **Names** are written as `cartTotal` and `isEmpty`, and with `_` in a fifth of the programs. 30 names have other names that a program can use throughout, e.g. `rest` as `tailOf`.
- **Every definition is read by the experiment's parser** and becomes a tree, so the generator has no grammar of its own. Three changes are made to a tree, each with its own chance: a conditional is turned around (`if a < b then x else y` becomes `if a >= b then y else x`), a part of a body is pulled out into a local definition, and a function is written with `fun`.
- **One hand per program** writes the trees as text. A hand is a set of habits: the indentation (1 to 4 spaces or a tab), the longest line (60 to 130), whether a body always starts on the line after the `=`, where `then` and `else` stand (19% of the programs have a `then` at the start of a line), where `in` stands (at the line end, on its own line, or at the start of the next line), a `;` before or after an item of a long list, where a long operation breaks, spaces inside brackets, `a+b` and `f(x)` without spaces, the `=` of constants in one column, 0 to 2 empty lines between definitions, comments in three styles before a definition and at a line end (60% of the programs have one), a line end of `\r\n` (3%), a space at a line end, brackets around every condition, no line feed at the end (15%).

A program has 293 code points on average, from 65 to 511, and a broken text 58 tokens. The 6,000 programs have 5,755 distinct lists of tokens. 6 of those lists are also the tokens of a program of the train and validation samples, which have 42,232 lists: 8 samples.

## The kinds

A kind says what the author did. Every kind has several forms, e.g. a missing `in` before `let` and before a name, and `numbers.ts --forms` counts them. The last column is explained under [What a table can show](#what-a-table-can-show).

| | kind | what the author did | samples with the kind alone | with another kind | scored code points per sample, alone | can a table show all of it right |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | missing in | The `in` of a local definition is left out. | 88 | 83 | 133 | partly |
| 2 | missing then | The `then` of a conditional is left out. | 98 | 80 | 136 | partly |
| 3 | missing equals | The `=` of a binding is left out. | 80 | 91 | 149 | partly |
| 4 | missing arrow | The `->` of a function is left out. | 74 | 70 | 141 | partly |
| 5 | bracket left open | The closing `)` or `]` of a pair is left out. | 137 | 126 | 125 | yes |
| 6 | string left open | The closing quote of a string is left out. | 75 | 91 | 135 | partly |
| 7 | comment left open | The `*)` of a comment is left out. | 32 | 43 | 204 | no |
| 8 | missing operand | One side of an operator is left out. | 126 | 132 | 130 | yes |
| 9 | else without its if | The `if … then` of a conditional is gone, and its `else` is still there. | 98 | 76 | 131 | partly |
| 10 | definition cut in the middle | A definition stops in the middle, and the next definition follows. | 114 | 113 | 132 | yes |
| 11 | tuple without brackets | A tuple is written without its brackets, as OCaml allows. | 79 | 93 | 147 | partly |
| 12 | definition without let | The first definition starts without `let`, as in Haskell. | 103 | 69 | 269 | yes |
| 13 | bracket closed twice | A closing `)` or `]` stands twice. | 75 | 100 | 126 | partly |
| 14 | stray closing bracket | A closing bracket stands where no bracket is open. | 76 | 101 | 140 | partly |
| 15 | semicolons after a definition | A definition ends with `;;`, as in OCaml's toplevel, or with `;`, as a statement in C. | 166 | 157 | 160 | partly |
| 16 | in after a definition at the top | A definition at the top ends with `in`, as inside an expression. | 75 | 103 | 140 | partly |
| 17 | separator too many | A `;` or `,` stands after the last item of a list or tuple, or twice between two items. | 90 | 76 | 137 | yes |
| 18 | operator typed twice | An operator stands twice. | 70 | 109 | 131 | yes |
| 19 | type annotation | A name has a type after it, which miniml does not have. | 159 | 176 | 157 | yes |
| 20 | braces around a body | The body of a definition or of a function stands in braces. | 67 | 100 | 141 | yes |
| 21 | text around the program | A sentence stands before the program, as in an answer or a message, and sometimes one after it. | 65 | 76 | 274 | yes |
| 22 | code fence | The program stands in a code fence of Markdown, sometimes with a sentence before it. | 77 | 79 | 293 | yes |
| 23 | merge conflict | A definition stands twice between the marker lines of a merge conflict, the second time with a change. | 126 | 121 | 159 | partly |
| 24 | comment of another language | A remark stands after `//` or `#`, or between `/*` and `*/`. | 113 | 108 | 144 | partly |
| 25 | comment inside a comment | A comment holds a comment. Comments do not nest in miniml, so the outer one ends early and its rest is code. | 95 | 101 | 166 | partly |
| 26 | word that reads as a name | A keyword of another language that miniml reads as a name: `let mut`, `return`, `end`, `begin … end`. | 0 | 136 |  | partly |
| 27 | comma in a list | The items of a list are separated by `,`, where miniml has `;`. | 158 | 178 | 146 | yes |
| 28 | semicolon in a tuple | The items of a tuple are separated by `;`, where miniml has `,`. | 82 | 73 | 120 | yes |
| 29 | equality of another language | A comparison is written `==`, `===`, `!=`, `!==` or `/=`, where miniml has `=` and `<>`. | 183 | 179 | 147 | yes |
| 30 | fat arrow | The arrow of a function is written `=>`, where miniml has `->`. | 72 | 80 | 131 | yes |
| 31 | another word for let | A definition starts with the keyword of another language: `def`, `fun`, `val`, `var`, `const`, `fn`, `function`, `define`. | 120 | 125 | 246 | partly |
| 32 | another word for fun | A function starts with `function`, `lambda`, `fn` or `\`, where miniml has `fun`. | 85 | 84 | 158 | yes |
| 33 | elif | An `else if` is written as one word: `elif`, `elsif` or `elseif`. | 73 | 75 | 131 | partly |
| 34 | match with arms | A conditional is written as `match … with` and arms, or as `case … of`, which miniml does not have. The whole expression is added, and `()` is missing in its place. | 105 | 81 | 115 | partly |
| 35 | parameters in brackets with commas | The parameters stand in round brackets with commas between them, as in most languages. | 129 | 115 | 158 | yes |
| 36 | apostrophes around a string | A string stands between apostrophes or backticks, where miniml has `"`. | 87 | 91 | 149 | partly |
| 37 | keyword as a name | A parameter or a local name is a keyword of miniml: `in`, `fun` or `rec`. | 83 | 83 | 145 | partly |
| 38 | bracket of the other sort | A pair of brackets is closed with the bracket of the other sort. | 89 | 82 | 111 | yes |
| 39 | decimal point | A number has a decimal point, and miniml has integers only. | 76 | 71 | 144 | yes |
| 40 | operator of another language | An operator is written as elsewhere: `=<` and `=>` for `<=` and `>=`, `++` for `^`, `:` for `::`, `&` and `\|` for `&&` and `\|\|`. | 133 | 148 | 145 | yes |
| 41 | conditional of another language | A conditional is written as in C, with braces around its branches and no `then`, or as in Python, with `:`. | 80 | 99 | 150 | yes |

The example of every kind: what was meant, and what was typed. `⏎` is a line break.

````text
missing in
  meant   let area w h =⏎  let half = w / 2 in⏎  let rest = h - 1 in⏎  half * rest
  broken  let area w h =⏎  let half = w / 2⏎  let rest = h - 1 in⏎  half * rest
missing then
  meant   let sign n = if n < 0 then 0 - 1 else 1
  broken  let sign n = if n < 0 0 - 1 else 1
missing equals
  meant   let limit = 10⏎let double n = n * 2
  broken  let limit 10⏎let double n n * 2
missing arrow
  meant   let twice = fun n -> n * 2
  broken  let twice = fun n n * 2
bracket left open
  meant   let total = add (price * count) tax⏎let tax = 3
  broken  let total = add (price * count tax⏎let tax = 3
string left open
  meant   let greeting = "hello"⏎let count = 3
  broken  let greeting = "hello⏎let count = 3
comment left open
  meant   let width = 80 (* columns *)⏎let height = 24
  broken  let width = 80 (* columns⏎let height = 24
missing operand
  meant   let total = (price + tax) * count
  broken  let total = (price + ) * count
else without its if
  meant   let pick n = if n > 0 then n else 0⏎let zero = 0
  broken  let pick n = n else 0⏎let zero = 0
definition cut in the middle
  meant   let area w h = w * h⏎let side = 4
  broken  let area w h = w *⏎let side = 4
tuple without brackets
  meant   let pair = (1, 2)⏎let third = 3
  broken  let pair = 1, 2⏎let third = 3
definition without let
  meant   let double n = n * 2⏎let four = double 2
  broken  double n = n * 2⏎let four = double 2
bracket closed twice
  meant   let total = add (price * count) tax
  broken  let total = add (price * count)) tax
stray closing bracket
  meant   let total = price * count⏎let tax = 3
  broken  let total = price * count)⏎let tax = 3
semicolons after a definition
  meant   let limit = 10⏎let double n = n * 2
  broken  let limit = 10;;⏎let double n = n * 2;;
in after a definition at the top
  meant   let limit = 10⏎let double n = n * 2
  broken  let limit = 10 in⏎let double n = n * 2
separator too many
  meant   let primes = [2; 3; 5]
  broken  let primes = [2; 3; 5;]
operator typed twice
  meant   let total = price + tax
  broken  let total = price + + tax
type annotation
  meant   let scale factor n = factor * n
  broken  let scale (factor : int) (n : int) : int = factor * n
braces around a body
  meant   let double n = n * 2⏎let four = double 2
  broken  let double n = { n * 2 }⏎let four = double 2
text around the program
  meant   let limit = 10
  broken  Here is the code:⏎⏎let limit = 10⏎⏎Hope this helps!
code fence
  meant   let limit = 10⏎
  broken  ```ocaml⏎let limit = 10⏎```⏎
merge conflict
  meant   let limit = 10⏎let double n = n * 2
  broken  <<<<<<< HEAD⏎let limit = 10⏎=======⏎let limit = 12⏎>>>>>>> main⏎let double n = n * 2
comment of another language
  meant   let limit = 10⏎let double n = n * 2
  broken  let limit = 10 // the default⏎let double n = n * 2
comment inside a comment
  meant   (* old: (* slow *)⏎let limit = 10
  broken  (* old: (* slow *) remove later *)⏎let limit = 10
word that reads as a name
  meant   let double n = n * 2
  broken  let double n = return n * 2
comma in a list
  meant   let primes = [2; 3; 5]
  broken  let primes = [2, 3, 5]
semicolon in a tuple
  meant   let origin = (0, 0)
  broken  let origin = (0; 0)
equality of another language
  meant   let same a b = if a = b then 1 else 0
  broken  let same a b = if a == b then 1 else 0
fat arrow
  meant   let twice = fun n -> n * 2
  broken  let twice = fun n => n * 2
another word for let
  meant   let double n = n * 2⏎let four = double 2
  broken  def double n = n * 2⏎let four = double 2
another word for fun
  meant   let twice = fun n -> n * 2
  broken  let twice = function n -> n * 2
elif
  meant   let sign n = if n < 0 then 1 else if n = 0 then 2 else 3
  broken  let sign n = if n < 0 then 1 elif n = 0 then 2 else 3
match with arms
  meant   let name n = ()⏎let two = 2
  broken  let name n = match n with | 0 -> "zero" | _ -> "many"⏎let two = 2
parameters in brackets with commas
  meant   let add a b = a + b
  broken  let add(a, b) = a + b
apostrophes around a string
  meant   let greeting = "hello"
  broken  let greeting = 'hello'
keyword as a name
  meant   let double input = input * 2
  broken  let double in = in * 2
bracket of the other sort
  meant   let total = add (price * count) tax
  broken  let total = add (price * count] tax
decimal point
  meant   let rate = 250
  broken  let rate = 2.50
operator of another language
  meant   let both a b = a && b
  broken  let both a b = a & b
conditional of another language
  meant   let pick n = if n > 0 then n else 0
  broken  let pick n = if (n > 0) { n } else { 0 }
````

Some mistakes of this sort are no kind, because miniml reads them as a valid program: two expressions side by side are an application, and an `=` after an expression is a comparison.

- `where`, `end`, `begin … end`, `let mut` and `return` are names for miniml. `let total = price * count where count = 3` is a valid program. All but `where` are forms of the kind "word that reads as a name", which is only drawn as the second kind of a sample.
- A definition without `let`, and with `def` or `var` in its place, is only a mistake at the start of the program. After another definition, `def double n = n * 2` is read as three more arguments and a comparison. So the two kinds change the first definition, and "another word for let" changes every definition in a fifth of its samples, where the later ones cannot be shown right.
- miniml has one sign for equality, so `=` for `==` cannot happen, only `==` for `=`.

## How a sample is made

1. **The kinds are drawn first**, by their weights: one kind with probability 0.65, two different kinds with 0.35. Then programs are drawn until one has a place for each kind and the broken text is a sample. So a kind has about its weight's share of the samples, whatever share of the programs it fits. The place is drawn evenly among the places that the program has, e.g. among its local definitions for a missing `in`.
2. **The two texts.** The broken text is the program with the mistakes. The original of the sample is the valid program that a repair of the broken text gives by the rules of `../written/REPAIR.md`, so that the two test sets label the same mistake the same way:
   - A whole token that is missing stands right before the next token that the broken text has, after the white space between them (rule 4 there). E.g. for a forgotten `in` at the end of a line, the original has `let half = w / 2⏎  in half * h`, and not the `in` at the line end. White space has the depth and the container that the token before it left, and a parser only learns that a token is missing when it reads the next token. With the `in` at the line end, the line break would be labelled "after `in`", which no parser can show that reads from left to right. This changes white space only: the original has the tokens of the program.
   - A token that is typed in another form is added, and the token of miniml is missing at its place (rule 5), e.g. a `,` for the `;` of a list. Nothing says that the two play the same part.
   - An expression with words that miniml lacks is added as a whole, and `()` is missing in its place (rule 6): the kind "match with arms".
   - Of the two sides of a merge conflict, the upper one is kept (rule 9).
3. **`makeSample` brings the alignment into the form that every sample has**: of two equal code points of which one is added, the later one is, and what an added text and the missing text at its place share at their start and at their end is kept. So of `elif` for `else if`, the `el` and the `if` are kept, and of `const` for `let`, the `t`.
4. **A draw is thrown away** when the program has no place for a kind (53.8% of the 15,372 draws), when fewer than 20 code points would be scored (2.8%), when the edits of the two kinds touch (2.1%), when nothing would be scored (1.1%), when a text would be longer than 512 code points (0.8%), and when the broken text is still a valid program (0.4%). The lower limit of 20 scored code points is this set's own: a mistake near the end of a program, with a line break after it, says little about a recovery.

## What a table can show

The question for every kind: can a parser of the experiment's form show every scored code point of its samples right? Such a parser reads the scanner's tokens from left to right, does what bison's table does up to the first error, and from there on holds one choice per cell of state and token, from the list of `DESIGN.md` point 4, and one display kind per pair of token and state on top. It does not look ahead. "Yes" means that some table can do it for every sample of the kind. The cells that it needs may be needed otherwise by another kind.

Five things stand in the way, and the list of the kinds below refers to them.

1. **The scanner is frozen, and a token has one display kind.** A string without its closing quote is one token up to the next quote or the line end, with whatever code stands there. A comment without its `*)` takes the rest of the text. The label of each code point is the one of the original, so such a token wants several kinds. 4.5% of the samples have a scored label of this sort, 13,003 code points, so at most 98.7% of the scored code points can be right. That number is an upper bound and no more: points 2 to 5 put more out of reach, and the search per sample below is the lower bound.
2. **The parser reduces before it reads an open cell.** A token that can follow an expression somewhere in the grammar, e.g. `)`, `]`, `;`, `,`, `in`, `then`, `else`, `let` or an operator, is in the lookahead sets of the reductions of that expression: an LALR(1) table merges the sets of all the places where a rule ends. Those cells are frozen, since valid programs read them. So where such a token stands wrong, the parser first reduces every expression that the token could end, and only then reads a cell without an action, which is the first open cell. E.g. in `let f x = if a then g (x)) else c`, the second `)` reduces `g (x)` and then the whole `if a then g (x)`, as it would in `(if a then g (x))`. The first open cell is read in the state after `let f x =` and an expression. Nothing on the stack says that an `if` was there, and the `else c` that follows has its labels inside one. Text that is no token, e.g. `{`, `#` or `!`, is in no lookahead set: the parser reads an open cell right where it stands.

   White space is hit in the same way. White space and comments have the depth and the container of the stack as the token before them left it, and in the original that is the stack before the reductions that the next token causes. After added text, the white space keeps that label, and the parser has made the reductions. E.g. in `let f x = g (x);;⏎let y = 1`, the line break has depth 2 and the container `(` by its label, and the stack has neither after the first `;`. The train samples and the written set have labels of this sort too.
3. **Cells that valid programs read take the mistake for a program.** A name, a constant or a bracket after an expression is an argument. An `=` after an expression is a comparison. A `let` after an operator, `=`, `then` or `(` is a local definition. So the first error often comes later than the mistake: 1 to 19 code points later in 29.8% of the samples and 20 or more in 8.8%. The code points in between are not scored. Before the first error, 2.5% of the kept code points have another label than the parser gives them, in 16.0% of the samples. And in 14.4% of the samples the last kept token before the first error has another depth or container than its label, so the stack at the first error is not the one that the labels after it suppose.
4. **One cell, two needs.** After `let binding` inside an expression, a `let` is the body of a local definition whose `in` is missing, or the next definition at the top after a definition that was cut. The first needs `in` inserted and the second needs the open `let` ended early. A person tells the two apart by the indentation, and the cell sees the state and the token. The same holds for a `let` after the condition of an `if`.
5. **A token gets 16 steps.** A stack that was reduced away can sometimes be built again with inserted tokens, e.g. `if`, a name, `then` and a name before an `else` that lost its `if`. Every inserted name costs four steps, with its three reductions.

Kind by kind:

- **missing in**: partly. Each form by itself, yes. Before `let`, `if` or `fun`: insert `in`. A body that starts with a name, a constant or a bracket is read as arguments, the first error is the next `let` at the top, and the open `let` is ended early there. No table does both: the two are one cell, a `let` after `let binding`.
- **missing then**: partly. Insert `then` at a keyword. A branch that starts with a name, a constant or a bracket is read as arguments of the condition, and at the `else` a table inserts `then` and a name. No single choice at a `let` after a condition: it is the branch, or the next definition after a conditional without `else`.
- **missing equals**: partly. Insert `=` at the first token that is no parameter. A name at the start of the body was read as a parameter before the first error. No where the body starts with a bracket that holds another bracket: the `(` was read as the start of a parameter `()`, no choice gets an `=` in before it, and a skipped token has the depth of the stack.
- **missing arrow**: partly. Insert `->` at the first token that is no parameter. As for a missing `=`, no where the body starts with a bracket that holds another bracket.
- **bracket left open**: yes. At the first token that cannot stand inside the bracket, e.g. the `let` of the next definition, insert the closing bracket. What stands between the place of the bracket and that token was read inside the bracket before the first error.
- **string left open**: partly. Yes where the string ends its line: the scanner cuts the open string at the line end, and the token is read as a string. No where more code follows on the line: the scanner takes it into the same token, up to the next quote or the line end, and a token has one display kind.
- **comment left open**: no. The scanner is frozen: it reads everything up to the next `*)` as the comment, or up to the end of the text as one token that is no comment. The code points in it have many labels, and a token has one.
- **missing operand**: yes. Insert a name where the operand is missing. After a missing right side at the end of a definition, the next `let` is read as a local definition before the first error, and is ended early at the `let` after it.
- **else without its if**: partly. The `else` makes the parser reduce everything that an `else` can end, before it reads an open cell. Where the conditional was the whole value of a definition, the `=` is still there: drop the expression and insert `if`, a name, `then` and a name, 12 steps. In a local definition or after another `else`, those are reduced too, and to build them again takes more than 16 steps.
- **definition cut in the middle**: yes. At the next `let`, end the open rule early. After a token that an expression has to follow, e.g. `=` or an operator, that `let` is read as a local definition before the first error, and is ended early at the `let` after it.
- **tuple without brackets**: partly. As the value of a definition or an item of a list: at the `,`, drop the first item and insert `(` and a name, and close the bracket at the next token that cannot stand in it. In a branch or a body, the `,` first makes the parser reduce the conditional, function or local definition around the tuple, and the cell cannot tell how many of them there were.
- **definition without let**: yes. Insert `let` at a name that starts the program. Only the first definition can be a sample: after another definition, `double n = n * 2` is read as more arguments and a comparison, and the program stays valid.
- **bracket closed twice**: partly. Skip the second bracket. Yes where the pair stands directly in the value of a definition. In a conditional, a function or a local definition, the bracket makes the parser reduce that expression before it reads an open cell, so what follows has lost its `if` or `fun`. Inside another bracket, it closes that bracket.
- **stray closing bracket**: partly. Skip the bracket. As for a bracket that is closed twice: before the parser reads an open cell, the bracket makes it reduce every conditional, function and local definition that is open, so what follows in them has lost its depth and its container.
- **semicolons after a definition**: partly. Every token, yes: skip a `;` after the value of a definition. The white space between the `;` and the next `let` has the labels of the stack before the `;`, and the `;` has made the parser reduce the expression before it. So a sample is whole only where the definition ends with no bracket, conditional, function or local definition open.
- **in after a definition at the top**: partly. Every token, yes: skip the `in`. The white space after it, no: the `in` has made the parser reduce the whole binding, so the stack gives the container `let` where the label says `=`.
- **separator too many**: yes. After the last item: drop the separator from the stack at the closing bracket. Twice: skip the second one.
- **operator typed twice**: yes. Skip an operator that follows an operator.
- **type annotation**: yes. Skip the `:` and what the type holds besides names, which are read as parameters without a label. A `(` before a parameter was read as the start of `()`: drop it from the stack at the name, and skip the `)`.
- **braces around a body**: yes. Skip the braces. They are no tokens, so the parser reads an open cell before it reduces anything, and the white space after a brace keeps its labels.
- **text around the program**: yes. Skip every token that stands where a definition has to start and is no `let`. A sentence after the program is read as arguments of the last expression, and its signs are skipped.
- **code fence**: yes. Skip the backticks and the word after them where a definition has to start, and the closing fence after the last expression.
- **merge conflict**: partly. Every token, yes: skip the signs of the marker lines, and read the last `=` and the last `>` as a name where an operator would be left without its right side. The white space after the last marker line has the labels of the end of the upper side, and the `>` have made the parser reduce the value of the lower side. So a sample is whole only where the definition ends with no bracket, conditional, function or local definition open.
- **comment of another language**: partly. Every token, yes: skip the signs, and read the last `/` of `/* … */` as a name, so that the `*` before it has its right side. The words of the remark are read as arguments. A remark that holds `in`, e.g. "used in tests", makes the parser reduce the definition, and the white space after the remark has the labels of the stack before that.
- **comment inside a comment**: partly. The rest of the outer comment has no label: its words are read as arguments, and the `)` of its `*)` is read as a name, which reduces nothing. Old code in the rest, e.g. `let spare = 4`, starts a definition of its own, and the white space after it has the labels of the end of the definition before the comment.
- **word that reads as a name**: partly. The word has no label and is read as a name by cells that valid programs read too, which no table changes. After `let mut` the defined name is read as a parameter. `return` and `begin` before a keyword are an error of their own, at which the word has to be dropped from the stack.
- **comma in a list**: yes. Read a `,` after an item of a list as `;`.
- **semicolon in a tuple**: yes. Read a `;` after an expression in round brackets as `,`.
- **equality of another language**: yes. Skip an `=` that follows an `=`, and skip `!`. The `=` after a skipped `!` is then the comparison, and after `/` it is skipped.
- **fat arrow**: yes. Read an `=` after the parameters of a `fun` as `->`, and skip the `>` after it, shown as punctuation.
- **another word for let**: partly. Yes for the first definition: read a name, or `fun`, that starts the program as `let`. No where every definition has a word that is a name for miniml: after an expression, `def name` is read as two more arguments by cells that valid programs read, and the definition is never seen as one.
- **another word for fun**: yes. `\`: read it as `fun`. A word is read as a name and the parameters as its arguments, before the first error at the `->`. There drop them from the stack and insert `fun` and a name, 8 steps.
- **elif**: partly. The word is read as a name, and the first error is the next `then`, which makes the parser reduce the conditional before it. Where that conditional is the whole value of a definition or stands in brackets, drop what is left of it and insert `if`, `if` and a name, which gives the depth and the container of the labels. In the body of a local definition, the `then` reduces that definition too.
- **match with arms**: partly. Nothing in the expression has a label: its words are read as arguments, and `|`, `->` and `_` are skipped. Every token after it can be right. The white space right after it is right only where the arms leave the stack as it was before them, e.g. not after an arm with a conditional.
- **parameters in brackets with commas**: yes. The `(` was read as the start of a parameter `()`: drop it from the stack at the first name, and skip every `,` and the `)`.
- **apostrophes around a string**: partly. A string of one word that nothing follows in its application: insert a constant before the first sign, so that the word stands after a whole expression, where a table can skip it and show it as a string. No for a string with a space, which the scanner reads as white space, and no where arguments follow the string.
- **keyword as a name**: partly. Where an expression starts, and as a parameter: read `in` or `rec` as a name. An `in` that is an argument makes the parser reduce everything up to the definition before an open cell is read. A table can build `let name =` again and skip the `in`, which is right only where the `in` stood in no bracket and no conditional. `fun` where an expression can start is read as a function by a cell that valid programs read.
- **bracket of the other sort**: yes. Read a `]` where only a `)` can close as `)`, and the other way round.
- **decimal point**: yes. Skip the point. The digits after it are a number of their own, read as an argument at the same depth.
- **operator of another language**: yes. Read a lone `&`, `|` or `:` after an expression as the operator, shown as one. For `=<`, `=>` and `++`, skip the second sign: the first one is an operator of miniml and gives the same depth and container.
- **conditional of another language**: yes. Read a `{` or `:` after the condition as `then`, and skip the other braces and the `:` after `else`. Brackets that were added around the condition are closed before the first error.

These answers are reasoned from the grammar, the table and the list of choices. They were not tested with one table per kind: no table was fit to this set, and none should be. What was run is a search per sample.

### A search per sample

`reach.ts` runs a search per sample, in which a cell may hold another choice at every read and an open display entry another kind. It starts from the parser as it is, reads no trained table, and follows the rules of a run: frozen cells are followed, and a token gets 16 steps. It shows what the list of choices can express for one sample at a time, which is more than one table can do for all of them: e.g. for a tuple without brackets in the body of two local definitions, it drops the body, builds a stack of the same depth with inserted tokens and skips the rest of the tuple, and a cell cannot know that the depth was 4. It is a search that keeps 64 runs in each of two orders, so its numbers are what the list can at least do.

Over the samples with one kind, alone. "Out of reach" are the samples with a label of the sort of point 1 above. "Whole but for white space" are the samples in which the best run has every token right and is wrong at white space or comments only, which is point 2. All numbers are percentages.

| | samples | out of reach | all three | whole | whole but for white space | whole without "end an item early" |
| --- | --- | --- | --- | --- | --- | --- |
| every sample with one kind | 3,913 | 2.5 | 98.2 | 88.8 | 95.8 | 85.3 |
| every sample with two kinds | 2,087 | 8.3 | 95.5 | 61.1 | 75.7 | 58.5 |
| missing in | 88 | 0.0 | 100.0 | 100.0 | 100.0 | 30.7 |
| missing then | 98 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| missing equals | 80 | 0.0 | 99.8 | 98.8 | 98.8 | 98.8 |
| missing arrow | 74 | 0.0 | 99.8 | 98.6 | 98.6 | 91.9 |
| bracket left open | 137 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| string left open | 75 | 60.0 | 94.3 | 40.0 | 40.0 | 40.0 |
| comment left open | 32 | 100.0 | 18.3 | 0.0 | 0.0 | 0.0 |
| missing operand | 126 | 0.0 | 100.0 | 100.0 | 100.0 | 86.5 |
| else without its if | 98 | 0.0 | 94.5 | 67.3 | 67.3 | 67.3 |
| definition cut in the middle | 114 | 0.0 | 100.0 | 100.0 | 100.0 | 61.4 |
| tuple without brackets | 79 | 0.0 | 100.0 | 98.7 | 98.7 | 92.4 |
| definition without let | 103 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| bracket closed twice | 75 | 0.0 | 96.5 | 64.0 | 82.7 | 65.3 |
| stray closing bracket | 76 | 0.0 | 99.3 | 75.0 | 96.1 | 75.0 |
| semicolons after a definition | 166 | 0.0 | 95.8 | 33.7 | 99.4 | 33.7 |
| in after a definition at the top | 75 | 0.0 | 96.7 | 37.3 | 100.0 | 36.0 |
| separator too many | 90 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| operator typed twice | 70 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| type annotation | 159 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| braces around a body | 67 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| text around the program | 65 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| code fence | 77 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| merge conflict | 126 | 0.0 | 99.0 | 77.8 | 100.0 | 77.8 |
| comment of another language | 113 | 0.0 | 100.0 | 98.2 | 100.0 | 96.5 |
| comment inside a comment | 95 | 0.0 | 100.0 | 98.9 | 100.0 | 95.8 |
| comma in a list | 158 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| semicolon in a tuple | 82 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| equality of another language | 183 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| fat arrow | 72 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| another word for let | 120 | 0.0 | 94.7 | 86.7 | 86.7 | 86.7 |
| another word for fun | 85 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| elif | 73 | 0.0 | 95.8 | 86.3 | 86.3 | 86.3 |
| match with arms | 105 | 0.0 | 99.1 | 71.4 | 100.0 | 71.4 |
| parameters in brackets with commas | 129 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| apostrophes around a string | 87 | 21.8 | 99.7 | 78.2 | 98.9 | 75.9 |
| keyword as a name | 83 | 0.0 | 98.4 | 79.5 | 89.2 | 79.5 |
| bracket of the other sort | 89 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| decimal point | 76 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| operator of another language | 133 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |
| conditional of another language | 80 | 0.0 | 100.0 | 100.0 | 100.0 | 100.0 |

- **With one kind**, the search has 98.2% of the scored code points right in all three and 88.8% of the samples whole. In 95.8% of them every token is right: the 7 points between are samples that are wrong at white space only.
- **With two kinds**, 95.5% and 61.1%: a second mistake often stands where the first one has left another stack.
- **Without "end an item early"**, 97.6% and 85.3% with one kind, and 94.6% and 58.5% with two.
- Of the 40 kinds that have samples of their own, 22 are whole in every sample and 5 more in all but one or two. Without "end an item early", a missing `in` is whole in 30.7% of its samples, and a definition that is cut in the middle in 61.4%.

This search is not the one of `lab/recovery-lr/learn/search/per-sample.ts`. Both keep a number of runs after every token, the ones with the most code points right. Where runs are level, the search of `learn/` keeps the ones with the shortest stack. In this set the first error's token is added text in 61.6% of the samples. Added text has no label, so every run is level after it, and the runs with the shortest stacks are the ones that threw the most away. On this set the search of `learn/`, with 64 runs, finds 77.2% of the samples with one kind whole where this one finds 88.8%, and none of the 80 conditionals of another language where this one finds all (`reach.ts --search-of-learn`). So row 13 of the final table would be too low on this set with the search of `learn/` alone. `../search-per-sample.ts` holds this search for any list of samples and makes row 13 as the better of the two searches per sample, see `../FINAL-SCORING.md`. The order that this search uses among level runs is the fewest steps at open cells that are not the parser's own default reduction, and then the fewest steps or the shortest stack.

## Numbers

From `numbers.ts`, over the 6,000 samples:

- **Kinds.** 3,913 samples have one kind and 2,087 have two. A kind with the weight 1 has about 85 samples of its own and as many with another kind, see the table above. `numbers.ts --forms` prints every form with its count, e.g. 96 samples with a missing `in` before a name and 47 before `let`.
- **Size.** A broken text has 301 code points on average: a tenth of the texts have fewer than 171 and a tenth more than 428.
- **Scored code points.** 1,010,371 in all, 168 per sample. A tenth of the samples have fewer than 47 and half fewer than 155. None has fewer than 20.
- **The first error.** Its token starts at the first edit or before it in 61.5% of the samples, 1 to 19 code points after it in 29.8%, 20 to 99 after it in 8.3% and 100 or more after it in 0.5%. The token is added text in 61.6% of the samples, and text that is no token of the language in 18.2%.
- **Before the first error**, 2.5% of the kept code points have another label than the parser as it is gives them (18,007 of 712,621), in 16.0% of the samples. No table changes them and no score counts them. In 14.4% of the samples the last kept token before the first error has another depth or container than its label.
- **Programs per sort**: from 304 (tasks) to 433 (vending machine).
- **Draws.** 15,372 draws of a program gave the 6,000 samples, 39.0%.

## The check

`check-specific.ts` prints counts and no text of a sample. It takes the labels anew from the two texts of every sample and holds the sample against them:

- The original is a valid program, both texts have at most 512 code points, and the parser rejects the broken text at the token and with the stack that the sample says.
- The places of the kept code points rise, a kept code point is the code point of its counterpart, and it has the display kind, the depth, the container and the hash of the stack of its counterpart, taken from the original anew. An added code point has no label.
- The scored code points are the kept ones from the first error on, at least 20.
- A kind that only adds text keeps every code point of the original, and a kind that only lacks text adds none. The original of a kind that only lacks text has the tokens of the generator's program.
- A whole token that is missing stands right before the next kept token, and not before white space or a comment, unless added text stands in its place.
- Every kind has samples, a kind that leaves a valid program by itself is never alone, no broken text stands twice, 400 samples are the same when they are made again, and 2,000 programs of the generator are valid.
- This page holds the table of the kinds, their examples and the list of what a table can show as `kinds.ts` gives them.
- Six samples with a fault put in by hand are each seen: a kept code point with another depth, one with the display kind of its neighbour, an added code point that is called kept, a broken text that is a valid program, a lost code point in a kind that only adds, and an `in` that is missing at the end of its line.

The first run of the check found a mistake of the generator: of two closing brackets side by side, the sample calls the later one the missing one, and the generator had put the earlier one before the next token, so in 18 samples a bracket was missing before kept white space.

## Commands

Run from the repo root. All of them but `dump.ts` print counts and names of kinds only.

```sh
bun lab/recovery-lr/held-back/specific/check-specific.ts      # the check, about 6 s
bun lab/recovery-lr/held-back/specific/numbers.ts [--forms]   # the numbers, the table of the kinds, the examples
bun lab/recovery-lr/held-back/specific/reach.ts [--forms] [--width 64] [--without-end-early] [--search-of-learn]   # the search per sample, about 4 minutes on 4 threads
bun lab/recovery-lr/held-back/specific/dump.ts <file outside the repo> [--count 300] [--kind <name>]   # samples under their labels: held back
bunx tsc -p lab/recovery-lr/held-back/specific && bunx oxlint --type-aware lab/recovery-lr/held-back/specific
```

A dump of the first 300 samples is in `recovery-scratch/transfer/lr/build/held-back-specific/samples.txt`. Its first line says that it is held back.

## Files

- `templates.ts`: the 16 sorts of programs as plain miniml, and remarks for comments.
- `programs.ts`: `programAt(seed, index, attempt)`, the valid programs: the trees, the changes to them, the hands, the writing as text.
- `reading.ts`: a program as the parser reads it, for the kinds: its tokens and its tree. And the edits: `added`, `written`, `lacking`, `missing`, `applyEdits`.
- `kind.ts`: what a kind is. `kinds-missing.ts`, `kinds-added.ts`, `kinds-notation.ts`: the 41 kinds. `kinds.ts`: the list.
- `specific.ts`: `specificSampleAt(seed, index)` and `loadSpecific()`.
- `check-specific.ts`, `numbers.ts`, `reach.ts`, `dump.ts`: see above. `tsconfig.json` is for the type check of this folder.

## What to keep in mind

- **A generator made the set.** Every sample is one of 41 kinds in a program of one of 16 sorts, and the kinds are the ones that their author thought of. What a generator would not think of is in `../written/`.
- **The weights are not frequencies.** Every kind has the weight 1, 1.5 or 2, a comment left open 0.5, and a place is drawn evenly among the places that a program has. Nobody has counted how often people make each mistake in a language like this one.
- **The labels are those of one repair.** Where another repair is as sensible, the labels would be other ones: e.g. a bracket that is left open is closed where the program had it, and of a doubled bracket the later one is the added one.
- **"Whole" has a ceiling that no recovery lifts.** By the search, at least 88.8% of the samples with one kind can be whole, and in 7% the only wrong code points are white space after added text, see point 2. Every parser that follows bison's table up to the first error has that white space wrong. So the final table gives the samples with every token right next to "whole", see `../FINAL-SCORING.md`: by the search, at least 95.8% of the samples with one kind.
- **A kind that needs a place gets programs that have one.** E.g. the samples with a missing `in` are programs with a local definition, which 28% of the programs have. So the programs of one kind are not a sample of all programs.
- **8 samples have a program with the tokens of a train or validation program**, with other names and another layout.
