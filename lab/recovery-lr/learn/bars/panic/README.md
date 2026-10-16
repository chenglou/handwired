# The bar "panic mode with a hand-written list of synchronizing tokens"

Row 5 of the transfer experiment's final table: panic mode over the base grammar's LALR(1) table, with the list of synchronizing tokens and its details chosen by hand for miniml. Nothing here is trained. The trained tables are compared with this bar, so it is meant to be as strong as its kind allows.

```ts
import {panicModeByHand} from './panic.ts'
const output = panicModeByHand(sample)    // a ParserOutput of ../../score.ts
scoreOutputs(samples, panicModeByHand)    // the score of the bar on any list of samples
```

`panicModeByHand(sample: Sample): ParserOutput` gives, per token of `sample.tokens`, the display kind, the depth, the container, the hash of the stack's symbols and whether the token was taken, then every reduction as (nonterminal, first token, last token). It never inserts a token. It reads `dropped-kinds.json`, which is committed.

## What the parser does

Every token is fed to the grammar's table: the parser reduces while the table says so, and shifts. Where the table rejects a token, i.e. the token reads an open cell, the stack is put back as it was before the token. That undoes the reductions that an LALR parser makes before it sees that a token has no action. Then:

- Where the state on top waits for an expression, the token is tried once more **as if an expression stood there**, and when the table takes it so, the expression counts as there. E.g. the `then` of `if then 1 else 2` is taken after `if expr`. It is the textbook's step of panic mode: stack the state after a nonterminal and go on. The expression covers no token and is no token, so the bar still counts no inserted token.
- A token that is not on the list is **dropped**, and the parser goes on with the next token on the same stack.
- A synchronizing token **cuts the stack down** to the highest part from which the table takes the token, and is taken there. Where no part of the stack takes it, it is dropped.

| token | what it does when the table rejects it | example |
| --- | --- | --- |
| `)` `]` `,` `;` | goes back to the nearest bracket that takes it, whatever stands open above | the `)` of `(if a then b + )` closes the bracket and gives up the `if` |
| `in` `then` `else` | goes back to the nearest `let`, `if` or `if .. then ..` that waits for it, also through an open bracket | the `in` of `let a = (f x in a` gives up the bracket |
| `let` | goes back to the bottom of the stack and starts a definition at the top | the second `let` of `let a = (1 + 2⏎let b = 3` |
| the end of input | cuts the stack down to the highest part that accepts it | |
| every other token: names, constants, strings, operators, `=`, `->`, `(`, `[`, `if`, `fun`, `rec`, `_`, text that is no token | is dropped | the second `+` of `a + + b` |

The detail that matters most is the `let`. The highest part of the stack that takes a `let` at all is nearly always the right side of an operator or the start of a bracket, where the `let` would be a local definition. After an error that is the wrong guess: the definitions that follow are then nested one inside the other.

A taken token is shown as the labels show it. A dropped token reads an entry of a display table over (state on top, terminal). `dropped-kinds.json` holds the 248 entries that the count sets: per entry, the kind that the most scored code points of the train samples want, among those whose depth and container the bar has right. It is the count of the trained rows. The depth, the container and the stack's hash are those of the stack as it is.

## Numbers

On the 5,000 validation samples, with the display kinds counted on the 40,000 train samples. The other rows are of `../../bars.ts` and `../yacc/`.

| parser | all three | whole | kind | depth | container | stack | constituents found, right | the same without the ones before the first error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | 2.02 | 0.00 | 29.1 | 18.9 | 13.8 | 0.14 | 42.6, 96.3 | 1.0, 40.0 |
| panic mode without knowledge of the language, with the count | 60.83 | 27.44 | 93.5 | 62.8 | 90.1 | 56.40 | 89.2, 97.2 | 81.3, 94.6 |
| **panic mode with a hand-written list, with the count** | **78.88** | **35.56** | 92.7 | 81.3 | 88.1 | **75.51** | 91.1, 96.9 | 84.7, 94.2 |
| panic mode with a hand-written list, dropped tokens shown as errors | 78.22 | 30.44 | 91.4 | 81.3 | 88.1 | 75.51 | 91.1, 96.9 | 84.7, 94.2 |
| yacc error productions, with the count | 84.45 | 39.28 | 94.5 | 86.0 | 92.5 | 72.49 | 96.1, 96.5 | 93.3, 95.1 |

On the author's own broken programs (`../yacc/own-programs.ts`, 32 typical mistakes and 24 written pairs): 85.4 all three, 55.7 whole, 83.0 stack on the 3,124 samples, and 87.5, 58.3, 85.1 on the written pairs. `../yacc/own-scores.ts` prints a row per mistake for both hand-made bars.

## What its kind does not allow

The parser only drops tokens and states, and takes an expression as there where one is missing. It never puts a token in, so a missing token stays missing:

| mistake of the author's list | panic mode | yacc error productions |
| --- | --- | --- |
| a missing `then` | 78.1 | 98.9 |
| a missing `=` in a definition | 66.7 | 89.9 |
| a missing `let` at the top | 62.0 | 88.3 |
| a misspelt keyword | 65.9 | 88.3 |
| `=>` for `->` | 79.3 | 99.2 |

E.g. after `let f x 1`, every token up to the next `let` is dropped with `let f x` on the stack, so the body has the container `let` where the labels have `=`.

Where nothing is missing, the bar is the stronger of the two hand-made ones, since it looks down the stack and takes back the reductions that the rejected token made: a `)` too many 99.9 (yacc 88.1), `;;` after a definition 93 of 100 samples wholly right (yacc 33), a keyword twice 96.8 (yacc 92.4).

## How the details were chosen

Each setting was scored on train samples 5,000 to 9,999 (display kinds counted on samples 0 to 4,999) and on the author's own broken programs. `PanicDetails` in `panic.ts` holds the four switches.

| details | train: all three, whole | own: all three, whole |
| --- | --- | --- |
| **the bar** | 79.72, 35.72 | 85.43, 55.57 |
| without the expression that is taken as there, which is the bar before the review | 79.61, 34.58 | 85.39, 54.58 |
| the bar before the review, and `in`, `then` and `else` do not go back through an open bracket | 79.13, 33.62 | 84.94, 53.46 |
| the bar before the review, and `let` like the other tokens of the list: taken by the highest part that takes it | 60.19, 24.92 | 70.96, 47.22 |
| the bar before the review without a list: every rejected token cuts the stack down, which is the panic mode of `../../bars.ts` | 62.65, 27.26 | 74.73, 52.30 |

The expression that is taken as there came from a review of the foundation, which tried the textbook's step on the bar. It changes more than the example above: the second `+` of `a + + b` is now taken with an expression between the two, where it was dropped. All three is the same there, and the stack column counts the code points after it as wrong. Over all samples the stack column gains: 75.25 to 75.51 on validation.

Also tried, with no gain: a rejected `let` keeps the part of the definition before it that the table can finish, in place of going back to the bottom (the same all three, 0.2 more constituents found and 0.3 fewer right).

**Effort and knowledge.** One author, four settings and one variant, after the work on the yacc bar had shown which tokens matter. What went in: the base grammar, LANGUAGE.md, the train samples, and the author's own list of typical mistakes. What did not: the held-back sets, any trained or searched table, and the skeptic's probe of hand-written mistakes.

## Checks

`check.ts`, about 12 s:

- **The labels exactly.** 5,000 valid programs with 1,437,094 code points get their display kinds, depths, containers, stack hashes and reductions, and no token is dropped.
- On 10,000 train and 5,000 validation samples, all 971,782 tokens before a first error are shown as the parser as it is shows them.
- The stack is a path of the base grammar's automaton after each of 1,069,758 tokens, and a taken token is on top of it. On those samples the bar drops 40,690 tokens and cuts the stack down 9,605 times, by 73,369 states.
- With every detail switched off, the bar gives what `panicMode` of `../../bars.ts` gives on 3,000 samples: the two bars differ by the list and its details alone.
- `dropped-kinds.json` is what the count gives, and the output has the shape that the scorer reads.

## Five broken programs

From `../yacc/examples.ts panic`, the same five as in `../yacc/README.md`. `kind`, `depth` and `in` are the wanted labels, and the row ` bar` under each is the bar's output, see `../yacc/show.ts` for the letters. Code points before the first error are not scored.

```
panic mode with a hand-written list  written:0  edits: written by the author  21 of 21 scored code points right in all three
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

panic mode with a hand-written list  written:1  edits: written by the author  43 of 43 scored code points right in all three
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

panic mode with a hand-written list  written:2  edits: written by the author  36 of 67 scored code points right in all three
meant   let sign n =⏎  if n < 0 then -1⏎  else if n = 0 then 0⏎  else 1⏎⏎let abs n = if n < 0 then -n else n⏎
broken  let sign n =⏎  if n < 0 -1⏎  else if n = 0 then 0⏎  else 1⏎⏎let abs n = if n < 0 then -n else n⏎
error                                ^
kind    kkkwddddwawpwwwkkwnwowlwolwwwkkkkwkkwnwowlwkkkkwlwwwkkkkwlwwkkkwdddwawpwkkwnwowlwkkkkwonwkkkkwnw
 bar    kkkwddddwawpwwwkkwnwowlwolwwwEEEEwkkwnwowlwkkkkwlwwwkkkkwlwwkkkwdddwawpwkkwnwowlwkkkkwonwkkkkwnw
depth   111111111111111222222222222222222233333333333333333333333333111111111111222222222222222222222222
 bar    111111111111111222222222222222222222222222222222222222222222111111111111222222222222222222222222
in      lllllllllll====iiiiiiiiittttteeeeeiiiiiiiiittttttttteeeeeeeellllllllll==iiiiiiiiitttttttteeeeeee
 bar    lllllllllll====iiiiiiiiiiiiiiiiiiiiiiiiiiiittttttttteeeeeeeellllllllll==iiiiiiiiitttttttteeeeeee
wrong                                ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

panic mode with a hand-written list  written:14  edits: written by the author  19 of 19 scored code points right in all three
meant   let rec fact n = if n <= 1 then 1 else n * fact (n - 1)⏎let ten = fact 10⏎
broken  let rec fact n = if n <= 1 then 1 else n * fact (n - 1))⏎let ten = fact 10⏎
error                                                          ^
kind    kkkwkkkwddddwawpwkkwnwoowlwkkkkwlwkkkkwnwownnnnwpnwowlp+wkkkwdddwpwnnnnwllw
 bar    kkkwkkkwddddwawpwkkwnwoowlwkkkkwlwkkkkwnwownnnnwpnwowlppwkkkwdddwpwnnnnwllw
depth   1111111111111111122222222222222222222222222222223333333+3111111111111111111
 bar    111111111111111112222222222222222222222222222222333333333111111111111111111
in      lllllllllllllll==iiiiiiiiiittttttteeeeeeeeeeeeee(((((((+(llllllll==========
 bar    lllllllllllllll==iiiiiiiiiittttttteeeeeeeeeeeeee(((((((((llllllll==========
wrong

panic mode with a hand-written list  written:16  edits: written by the author  25 of 29 scored code points right in all three
meant   let incr x = x + 1⏎let decr x = x - 1⏎let zero = decr (incr 0)⏎
broken  let incr x = x + 1⏎let decr x x - 1⏎let zero = decr (incr 0)⏎
error                                   ^
kind    kkkwddddwawpwnwowlwkkkwddddwawnwowlwkkkwddddwpwnnnnwpnnnnwlpw
 bar    kkkwddddwawpwnwowlwkkkwddddwawawcwawkkkwddddwpwnnnnwpnnnnwlpw
depth   1111111111111111111111111111111111111111111111111111222222222
 bar    1111111111111111111111111111111111111111111111111111222222222
in      lllllllllll========lllllllllll======lllllllll=======(((((((((
 bar    lllllllllll========llllllllllllllllllllllllll=======(((((((((
wrong                                   ^^^^
```

In the third, the `else` after `if n < 0 -1` finds no `if .. then ..` on the stack and is dropped, so the rest of the definition is read as the condition. In the fifth, `- 1` is dropped with `let decr x x` on the stack.

## Commands and files

Run from the repo root.

```sh
bun lab/recovery-lr/learn/bars/panic/panic.ts [--write]   # the scores on validation; --write counts dropped-kinds.json anew
bun lab/recovery-lr/learn/bars/panic/check.ts             # every check above
bun lab/recovery-lr/learn/bars/yacc/own-scores.ts         # both hand-made bars on the author's own broken programs
bun lab/recovery-lr/learn/bars/yacc/examples.ts panic     # the five programs above
```

- `panic.ts`: `runPanic`, `panicModeByHand`, the list and its details, the count, `dropped-kinds.json`.
- `check.ts`.
- The author's own broken programs and the tools to show a bar's output are in `../yacc/`: `own-programs.ts`, `show.ts`, `examples.ts`, `own-scores.ts`.
