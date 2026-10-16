# The bar "yacc error productions"

Row 4 of the transfer experiment's final table: what a careful author of a yacc grammar gets out of bison's own error recovery for miniml. The grammar of the base parser gets rules added by hand, bison 2.3 makes a parser of it, and that parser's recovery runs unchanged: pop to a state that shifts `error`, shift it, discard tokens until one is accepted, and report no new error until three tokens are shifted. Nothing here is trained. The trained tables are compared with this bar, so it is meant to be as strong as its kind allows.

```ts
import {yaccErrorProductions} from './bar.ts'
const output = yaccErrorProductions(sample)   // a ParserOutput of ../../score.ts
scoreOutputs(samples, yaccErrorProductions)   // the score of the bar on any list of samples
```

`yaccErrorProductions(sample: Sample): ParserOutput` gives, per token of `sample.tokens`, the display kind, the depth, the container, the hash of the stack's symbols and whether the token was taken, then every reduction as (nonterminal, first token, last token), and the number of inserted tokens. It reads `tables.json` and `display-kinds.json`, both committed, and needs no bison.

## Numbers

On the 5,000 validation samples, with the display kinds counted on the 40,000 train samples. The other rows are of `../../bars.ts` and are here for the scale.

| parser | all three | whole | kind | depth | container | stack | constituents found, right | the same without the ones before the first error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | 2.02 | 0.00 | 29.1 | 18.9 | 13.8 | 0.14 | 42.6, 96.3 | 1.0, 40.0 |
| panic mode without knowledge of the language, with the count | 60.83 | 27.44 | 93.5 | 62.8 | 90.1 | 56.40 | 89.2, 97.2 | 81.3, 94.6 |
| **yacc error productions, with the count** | **83.08** | **37.10** | 94.3 | 84.6 | 91.2 | **72.49** | 95.6, 96.2 | 92.4, 94.5 |
| yacc error productions, discarded tokens shown as errors | 82.42 | 30.28 | 92.7 | 84.6 | 91.2 | 72.49 | 95.6, 96.2 | 92.4, 94.5 |

The bar counts 0.44 inserted tokens per sample: the terminals that the `error` of a reduced rule stands for, e.g. one for a missing `=`.

On the author's own broken programs (`own-programs.ts`, 32 typical mistakes with 100 samples each where a program has a place for them, and 24 written pairs): 90.3 all three, 53.9 whole, 82.6 stack on the 3,124 samples, and 89.1, 50.0, 81.1 on the written pairs. `own-scores.ts` prints a row per mistake. The weakest are a comment that is not closed (10.1, which no parser of the scanner's tokens can do much about), an `if` as an argument without its brackets (70.6: the labels count the missing bracket), a missing `(` (80.9) and a `;` between the parts of a tuple (83.7).

## The grammar

`miniml-errors.y` is `../../../grammar/miniml.y` with 26 rules added, and the 3 rules of `binding` a second time under the name `local_binding`. 13 of the added rules hold the token `error`. The added rules are of three sorts.

**Rules for text that the parser passes over.** bison gives a state that can shift `error` no default reduction. With `expr error` and `atom: error` in the grammar, nearly every state inside an expression can shift `error`, so the parser notices an error with the stack still standing, and the token is discarded where it stands.

| rule | passes over | example |
| --- | --- | --- |
| `definitions: definitions error` | text before a definition, up to the next `let` | the `)` of `) let a = 1` |
| `expr: expr error` | text after an expression | the `;;` of `let a = f x ;; let b = 2` |
| `atom: error` | text where an expression has to come | the second `+` of `a + + b` |

**Rules with `error` in the place of something that is missing.** bison reads the token at which the error was met again right after it has shifted `error`, so such a rule applies where that token fits.

| rule | what is missing | example |
| --- | --- | --- |
| `definition: error EQ expr` | a readable `let name parameters` | `lte x = 1` |
| `binding: error EQ expr`, and the same for `local_binding` | a readable name | `let 5 = 1` |
| `binding: IDENT parameters error expr`, and the same for `local_binding` | the `=`, or it stands behind junk | `let f x 1`, `let f x : int = 1` |
| `expr: expr error THEN expr`, with and without `ELSE expr` | the `if` | `let f x = x > 0 then 1 else 2` |
| `expr: expr error ELSE expr` | `if condition then` | `let f x = 1 else 2` |
| `expr: FUN error ARROW expr` | readable parameters | `fun (a, b) -> a` |
| `expr: FUN parameter parameters error expr` | the `->` | `fun x x + 1` |

**Rules without `error` for a construct whose end is missing.** The parser reduces by such a rule at a token that can follow an expression and cannot go on with the construct, e.g. at the `let` of the next definition. Unlike a rule that ends in `error`, it costs no discarded token when several constructs end at once, e.g. a bracket inside an `if` inside a local `let`. A compiler would report the error in the rule's action.

| rule | what is missing | example |
| --- | --- | --- |
| `atom: LPAREN expr`, `atom: LPAREN expr COMMA tuple_rest`, `atom: LBRACK elements` | the closing bracket | `let a = (1 + 2` before the next `let` |
| `expr: LET local_binding`, and with `REC` | `in expression` | a local `let y = 1` before the next `let` |
| `expr: IF expr` | `then expression` | `if a` before `)` |
| `expr: IF expr ELSE expr` | `then expression` | `if a else c` |
| `binding: IDENT parameters` | `= expression` | `let f x` before the next `let` |
| `application: application IF expr THEN expr`, with `ELSE expr`, and `application FUN parameter parameters ARROW expr` | what stands between an expression and an `if` or `fun`: brackets, an operator, `in`, `else` | `f if a then b else c` |
| `atom: BADSTRING` | the closing quote | `print "abc` |
| `elements: elements COMMA expr` | nothing: a `,` stands for the `;` | `[1, 2, 3]` |

`local_binding` is there because bison merges the lookahead sets of a state. With one `binding`, the state after a definition's expression would reduce at every token that can follow a local definition, and so a stray `)` after a definition at the top would end the definition. With two nonterminals the stray `)` is passed over at the top and ends a local definition.

bison counts 155 shift/reduce conflicts for the grammar, declared with `%expect 155`. All are between a shift and a reduction by a rule that more tokens can follow than in the base grammar, e.g. `atom: LPAREN expr` before `)`. Each is settled as a shift, which is bison's default and what the base grammar does in the same place. There is no reduce/reduce conflict.

## What is scored

The depth, the container and the stack's hash are functions of the symbols on the stack (`../../../labels.ts`). The stack of this parser holds the base grammar's symbols and `error`, and `yacc-parser.ts` says what counts as what:

- `local_binding` is `binding`.
- `error` counts as the symbols of the base grammar whose place it has, e.g. as `=` in `binding: IDENT parameters error expr`, and as nothing where it is text that is passed over (`errorStandsFor`).
- A token that a rule reads as another one counts as that one: an open string as a string, and the `,` of a list as a `;` (`symbolCountsAs`).
- The symbols of a rule for an unfinished construct count as themselves. The `else` of `if a else c` is taken on `if expr else`, which is not what the original's stack holds, so the stack column counts the code points after it as wrong.

**One reading goes further than the stack holds.** In the three rules for an `if` whose start is missing, `error` counts as the missing `if`, although it stands above the condition on the stack and not below it. The depth and the container are then right, and the hash is not. Without that reading, i.e. with `error` as nothing in those three rules, the bar has 79.84 all three and 33.48 whole on validation, and the same stack column.

A shifted token has the display kind that the labels give it. A discarded token, and a token shifted into a state that no valid program enters, reads an entry of a display table over (shifted or discarded, state on top, terminal). `display-kinds.json` holds the 139 entries that the count sets, 124 of them for discarded tokens: per entry, the kind that the most scored code points of the train samples want, among those whose depth and container the bar has right. It is the count of the trained rows. A discarded token has the depth and the container of the stack as it is when bison discards it.

A reduction gives its left side and the tokens that its right side covers. An `error` covers the tokens of the states that were popped for it and the tokens that were discarded before it was shifted.

## What its kind does not allow

- **Reductions before the error is seen.** An LALR parser reduces at a token before it finds that the token has no action, and bison cannot take that back. E.g. in `let a = f (n - 1);; let b = 2` the `;` first reduces the bracket and the application, and is then passed over with the stack at `let a = expr`. The white space after it is labelled with the bracket still on the stack. This costs whole samples: 33 of 100 with `;;` after a definition are wholly right, where panic mode has 93.
- **Lookahead sets merged over all contexts.** A stray `)` closes every unfinished `if` and local `let` above it, whether a bracket is open or not, since `)` is in the lookahead set of those rules in every context. A `)` too many has 86.7, where panic mode, which looks down the stack, has 99.9.
- **One guess per state and token.** A local `let` without `in` before another `let` is read as "the next definition at the top starts here". The other reading, a missing `in`, was tried and is worse (see below). bison cannot look at a second token or try both.

## How the grammar was chosen

Each grammar was built, checked on valid programs, and scored on train samples 5,000 to 9,999 (display kinds counted on samples 0 to 4,999) and on the author's own broken programs. The rules came from a table of the code points lost, grouped by the base parser's state and the token at the first error, e.g. "after `let binding`, at `let`".

| grammar | train: all three, whole | own: all three, whole |
| --- | --- | --- |
| 10 rules of the textbook kind: `definitions error`, `LET error`, `( error )`, `[ error ]`, `IF error THEN`, `LET error IN`, `FUN error ARROW` | 59.76, 11.80 | 67.20, 18.82 |
| the junk rules, the unfinished brackets, `let`, `if`, and `local_binding` | 79.66, 32.68 | 87.10, 46.03 |
| with the missing `if`, an `if` or `fun` as an argument, the open string | 82.87, 36.68 | 89.38, 49.90 |
| **the bar**: with `expr error ELSE expr`, `binding: IDENT parameters` and the `,` in a list | 84.10, 38.74 | 90.27, 53.33 |
| the bar without the three rules for a bracket that is not closed | 74.66, 33.14 | 83.92, 48.59 |
| the bar with "junk before the `=`" in place of "the `=` is missing" | 83.68, 37.22 | 89.56, 53.14 |
| the bar with a `fun` and a local definition that stop after their parameters | 84.03, 38.86 | 89.64, 51.98 |
| an earlier grammar with: a local `let` without `in` goes on with a following `let` | 76.04, 32.44 | 86.53, 48.24 |
| an earlier grammar with: an `if` as an argument counts as bracketed, and `;` between the parts of a tuple | 82.72, 36.60 | 89.78, 52.50 |

The textbook rules lose because each waits for one token, e.g. `( error )` for the `)`. When that token is the one that is missing, the parser discards the rest of the text.

**Effort and knowledge.** One author, 11 grammars, each scored within a minute. What went in: the base grammar, LANGUAGE.md, the train samples through the table of losses, and the author's own list of typical mistakes. What did not: the held-back sets, any trained or searched table, and the skeptic's probe of hand-written mistakes. One thing to know: `../../README.md` quotes three cells of a searched table on the stand-in data, "after `if expression`, at `else`: insert `then`", "after `let binding`, at `let`: end the expression early" and one of the state `stopped`. The author had read those lines. The first two are also rules of this bar, and both were also the largest two entries of the first grammar's table of losses.

## Checks

`check.ts`, about 25 s:

- `tables.json` is what bison 2.3 makes of `miniml-errors.y`, and bison reports nothing.
- **The port is bison's parser.** `runYacc` takes the steps of the generated C code, read from its debug output (a state entered, a token read, a symbol shifted, a reduction, the call of `yyerror`, a symbol popped, a token discarded, the result), on 24,148 texts: the broken texts of 10,000 train and 5,000 validation samples, 3,148 broken programs of the author, 2,000 valid programs, and 4,000 texts of random tokens. That is 10.1 million steps with 140,163 shifts of `error` and 102,148 discarded tokens. `yyparse` gives up in 1,974 texts, each time at the end of input.
- **Valid programs are read as the base parser reads them.** The automaton's 152 states and the base grammar's 99 are walked side by side along the same symbols: in the 110 pairs of states that a valid program can be in, the parser does what the base parser does in all 1,483 cells that the base parser has an action for. So every conflict is settled the way the base grammar goes, and every text is read as the base parser reads it up to its first error. An earlier grammar without `%prec LOWEST` on the rules of `local_binding` failed here in 27 cells: it reduced a local definition before a comparison.
- **The labels exactly.** 5,000 valid programs with 1,437,094 code points get their display kinds, depths, containers, stack hashes and reductions, with no call of `yyerror`.
- On the 15,000 samples, all 971,782 tokens before a first error are shown as the parser as it is shows them.
- The depth, the container and the hash that the run keeps next to its stack are those of `../../../labels.ts` for the symbols that the stack counts as, at 211,781 tokens.
- `display-kinds.json` is what the count gives, and the output has the shape that the scorer reads.

## Five broken programs

From `examples.ts yacc`. `kind`, `depth` and `in` are the wanted labels, and the row ` bar` under each is the bar's output, see `show.ts` for the letters. Code points before the first error are not scored.

```
yacc error productions  written:0  edits: written by the author  21 of 21 scored code points right in all three
meant   let area w h =⏎  let half = w / 2 in⏎  half * h⏎⏎let total = area 3 4⏎
broken  let area w h =⏎  let half = w / 2⏎  half * h⏎⏎let total = area 3 4⏎
error                                                 ^
kind    kkkwddddwawawpwwwkkkwddddwpwnwowlwwwnnnnwownwwkkkwdddddwpwnnnnwlwlw
 bar    kkkwddddwawawpwwwkkkwddddwpwnwowlwwwnnnnwownwwkkkwdddddwpwnnnnwlwlw
depth   1111111111111111122222222222222222222222222222111111111111111111111
 bar    1111111111111111122222222222222222222222222222111111111111111111111
in      lllllllllllll====lllllllll=======nnnnnnnnnnnnnllllllllll===========
 bar    lllllllllllll====lllllllll====================llllllllll===========
wrong

yacc error productions  written:1  edits: written by the author  43 of 43 scored code points right in all three
meant   let rec length xs = if xs = [] then 0 else 1 + length (tail xs)⏎let main () = print_int (length [1; 2; 3])⏎
broken  let rec length xs = if xs = [] then 0 else 1 + length (tail xs⏎let main () = print_int (length [1; 2; 3])⏎
error                                                                  ^
kind    kkkwkkkwddddddwaawpwkkwnnwowppwkkkkwlwkkkkwlwownnnnnnwpnnnnwnnwkkkwddddwppwpwnnnnnnnnnwpnnnnnnwplpwlpwlppw
 bar    kkkwkkkwddddddwaawpwkkwnnwowppwkkkkwlwkkkkwlwownnnnnnwpnnnnwnnwkkkwddddwppwpwnnnnnnnnnwpnnnnnnwplpwlpwlppw
depth   1111111111111111111122222222333222222222222222222222223333333331111111112221111111111112222222233333333322
 bar    1111111111111111111122222222333222222222222222222222223333333331111111112221111111111112222222233333333322
in      llllllllllllllllll==iiiiiiii[[[ttttttteeeeeeeeeeeeeeee(((((((((lllllllll(((============(((((((([[[[[[[[[((
 bar    llllllllllllllllll==iiiiiiii[[[ttttttteeeeeeeeeeeeeeee(((((((((lllllllll(((============(((((((([[[[[[[[[((
wrong

yacc error productions  written:2  edits: written by the author  67 of 67 scored code points right in all three
meant   let sign n =⏎  if n < 0 then -1⏎  else if n = 0 then 0⏎  else 1⏎⏎let abs n = if n < 0 then -n else n⏎
broken  let sign n =⏎  if n < 0 -1⏎  else if n = 0 then 0⏎  else 1⏎⏎let abs n = if n < 0 then -n else n⏎
error                                ^
kind    kkkwddddwawpwwwkkwnwowlwolwwwkkkkwkkwnwowlwkkkkwlwwwkkkkwlwwkkkwdddwawpwkkwnwowlwkkkkwonwkkkkwnw
 bar    kkkwddddwawpwwwkkwnwowlwolwwwkkkkwkkwnwowlwkkkkwlwwwkkkkwlwwkkkwdddwawpwkkwnwowlwkkkkwonwkkkkwnw
depth   111111111111111222222222222222222233333333333333333333333333111111111111222222222222222222222222
 bar    111111111111111222222222222222222233333333333333333333333333111111111111222222222222222222222222
in      lllllllllll====iiiiiiiiittttteeeeeiiiiiiiiittttttttteeeeeeeellllllllll==iiiiiiiiitttttttteeeeeee
 bar    lllllllllll====iiiiiiiiiiiiiieeeeeiiiiiiiiittttttttteeeeeeeellllllllll==iiiiiiiiitttttttteeeeeee
wrong

yacc error productions  written:14  edits: written by the author  18 of 19 scored code points right in all three
meant   let rec fact n = if n <= 1 then 1 else n * fact (n - 1)⏎let ten = fact 10⏎
broken  let rec fact n = if n <= 1 then 1 else n * fact (n - 1))⏎let ten = fact 10⏎
error                                                          ^
kind    kkkwkkkwddddwawpwkkwnwoowlwkkkkwlwkkkkwnwownnnnwpnwowlp+wkkkwdddwpwnnnnwllw
 bar    kkkwkkkwddddwawpwkkwnwoowlwkkkkwlwkkkkwnwownnnnwpnwowlpcwkkkwdddwpwnnnnwllw
depth   1111111111111111122222222222222222222222222222223333333+3111111111111111111
 bar    111111111111111112222222222222222222222222222222333333311111111111111111111
in      lllllllllllllll==iiiiiiiiiittttttteeeeeeeeeeeeee(((((((+(llllllll==========
 bar    lllllllllllllll==iiiiiiiiiittttttteeeeeeeeeeeeee(((((((==llllllll==========
wrong                                                           ^

yacc error productions  written:16  edits: written by the author  29 of 29 scored code points right in all three
meant   let incr x = x + 1⏎let decr x = x - 1⏎let zero = decr (incr 0)⏎
broken  let incr x = x + 1⏎let decr x x - 1⏎let zero = decr (incr 0)⏎
error                                   ^
kind    kkkwddddwawpwnwowlwkkkwddddwawnwowlwkkkwddddwpwnnnnwpnnnnwlpw
 bar    kkkwddddwawpwnwowlwkkkwddddwawawowlwkkkwddddwpwnnnnwpnnnnwlpw
depth   1111111111111111111111111111111111111111111111111111222222222
 bar    1111111111111111111111111111111111111111111111111111222222222
in      lllllllllll========lllllllllll======lllllllll=======(((((((((
 bar    lllllllllll========lllllllllllll====lllllllll=======(((((((((
wrong
```

In the fourth, the line feed after the stray `)` is wrong: the `)` reduced the bracket before it was passed over, and the label still has the bracket on the stack. In the first, third and fifth, the labels before the first error differ from what the parser gives, which no parser of the experiment can change and no score counts.

## Commands and files

Run from the repo root. `RECOVERY_LR_SCRATCH` is a folder outside the repo, needed by the build and by the check.

```sh
bun lab/recovery-lr/learn/bars/yacc/build.ts            # bison, flex and cc: writes tables.json
bun lab/recovery-lr/learn/bars/yacc/bar.ts [--write]    # the scores on validation; --write counts display-kinds.json anew
bun lab/recovery-lr/learn/bars/yacc/check.ts            # every check above
bun lab/recovery-lr/learn/bars/yacc/own-scores.ts       # both hand-made bars on the author's own broken programs
bun lab/recovery-lr/learn/bars/yacc/examples.ts yacc    # the five programs above
```

- `miniml-errors.y`: the grammar. `driver.c`: the C program that prints bison's arrays and the steps of `yyparse`. `build.ts`, `tables.json`.
- `yacc-parser.ts`: `runYacc`, the port of `yyparse` with its recovery, and what the symbols of the stack count as.
- `bar.ts`: `yaccErrorProductions`, the count, `display-kinds.json`.
- `own-programs.ts`: the author's typical mistakes and written pairs. `show.ts`, `examples.ts`, `own-scores.ts`: shared with `../panic/`.
- `check.ts`.
