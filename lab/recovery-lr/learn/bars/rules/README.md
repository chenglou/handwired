# A table filled by hand-written rules

This folder holds the bar "the same mechanism, filled by hand": the recovery that a programmer who knows miniml and bison's automaton writes, as choices of the same open cells and from the same lists of choices that training gets. It is the counterpart of the 35 hand-written rules of the JSON side (`lab/recovery-parser/learn/handwritten/`), and of the error routines that a textbook puts into the blank entries of an LR action table.

`rules.ts` holds 27 rules, and one more that was written and measured and is left out. Each rule has a name, the reason a person would give for it, an example, and the cells it sets. A rule names its cells by what the states mean, e.g. "after the condition of an `if`, at an `else`: put a `then`". `tables.json` holds the tables that the rules give, with the display entries set by the count on the 40,000 train samples, as for the trained rows.

## For the final scoring

```ts
import {rulesBar, tablesOfTheBar} from './bars/rules/bar.ts'
import {scoreOutputs, scoreTables} from './score.ts'

const score = scoreOutputs(samples, rulesBar())     // samples: readonly Sample[] of ../../../sample.ts
```

`rulesBar()` returns a function `(sample: Sample) => ParserOutput`: per token of the sample's broken text the display kind, the depth, the container, the hash of the stack's symbols and whether the token was taken, then the reductions of the parse and the number of inserted tokens, which is all that the columns "all three", "whole", "stack" and "constituents" need. It runs the exact parser of `../../recovery-parser.ts` with the saved tables. The tables are tables of the experiment like any other, so `scoreTables(tablesOfTheBar(), packSamples(samples, tablesOfTheBar()))` gives the same counts faster, and `../../report.ts --tables lab/recovery-lr/learn/bars/rules/tables.json` prints the most read cells in words. `check.ts` compares the two routes.

## Result

All numbers are percentages of the scored code points, or of the samples for "whole". The display entries of every row are set by the count on the train samples.

| | all three | whole | stack | constituents found, right | the same without the ones before the first error | inserted tokens per sample |
| --- | --- | --- | --- | --- | --- | --- |
| the rules, 40,000 train samples | 88.43 | 49.88 | 82.40 | 96.8, 97.0 | 94.4, 96.1 | 1.50 |
| **the rules, 5,000 validation samples** | **88.03** | **48.66** | **81.94** | **96.8, 97.1** | **94.5, 96.2** | **1.54** |
| the rules, the author's own broken programs (88 samples) | 91.60 | 76.14 | 85.50 | 93.7, 94.2 | 92.2, 95.1 | 0.99 |
| for comparison, validation: the parser as it is | 2.02 | 0.00 | 0.14 | 42.6, 96.3 | 1.0, 40.0 | 0 |
| skip every rejected token | 29.42 | 11.54 | 26.35 | 65.7, 95.2 | 40.8, 90.2 | 0 |
| panic mode without knowledge of the language | 60.83 | 27.44 | 56.40 | 89.2, 97.2 | 81.3, 94.6 | 0 |
| the search from the parser as it is, with the flag, 4 passes | 87.36 | 46.84 | 80.76 | 96.0, 96.8 | 93.2, 95.7 | 2.63 |
| the search from these rules, until a pass changes nothing | 88.89 | 51.50 | 81.10 | 96.7, 97.0 | 94.4, 96.0 | 1.69 |

One output per token allows 97.0% of all three on the validation samples, and the search per sample of `../../search/per-sample.ts` finds 94.4% of all three and 63.2% of whole samples with a beam of 64 on 1,000 of them.

The search from these rules changes 1,040 cells and has 90.07% on the train samples, where the rules have 88.43%: the open cells can hold about 0.9 points more on validation than these rules, at the price of tables that nobody can read rule by rule. I did not read the cells that the search changed, see below.

## How the rules were made

I say here what went in, so that a reader can judge the bar.

- **Knowledge.** The grammar `../../../grammar/miniml.y`, LANGUAGE.md, the 99 states of bison's automaton with their items, lookahead sets and default reductions, and the lists of choices of `../../recovery-tables.ts`. I read every state. I know how LR parsers recover in textbooks and in yacc, and how people write OCaml.
- **Data in view.** The train and validation samples, their scores, and my own broken programs. The first set of 20 rules was written from the grammar and the automaton alone and had 82.25% on train and 81.61% on validation. Everything after that was written with the scores in view. `try.ts` prints the train and the validation score of every variant that I compared, so **validation is no unseen data for these rules**. Where the two scores disagreed I went by the train score. Two choices went by my own broken programs: the `;` below, against the train score, and a `(` before a name in a pattern, which is dropped with the train score unchanged.
- **Tools.** `where-wrong.ts` counts, per open cell, the samples whose first wrong code point follows a read of the cell. `wanted.ts` counts what the original's labels want after a cell. `show.ts` prints a run under the labels. `try.ts` scores hand-made variants: I name a group of cells by states and terminals and a few choices, and it prints one row per choice. I ran it for about 80 groups of cells. No script picked a choice, and no search filled a cell.
- **My own broken programs.** `broken.ts` holds 98 pairs of a broken program and the program that was meant: a keyword, a sign or a bracket left out or one too many, habits of other languages, slips, and one small program for most rows of the table "What is not in the language" of LANGUAGE.md. 88 of them are samples: the other 10 are still valid or have nothing to score. They are no test: two decisions below were made with them in view.
- **What I did not use.** Nothing of `held-back/`, no trained tables, and not the skeptic's probe of typical mistakes. I ran the search from these rules three times while they changed, for the number in the table above, and did not open its tables. One thing I saw by accident: `git log` printed the subject line of a commit of the held-back folder, which says that an expression without a definition around it is repaired with `let _ = `. I had the same repair in my own programs from LANGUAGE.md's first row, and no rule was changed for it.
- **Effort.** About one working day of an agent: a first full set of rules, then about 15 rounds of looking at wrong samples, stating a rule, and comparing variants.

## How the rules read a broken text

A choice sees the state on top of the stack, the token, and whether the token is the first on its line. Six ideas carry most of the score:

1. **What is no token is dropped or read as what it was.** A character that starts no token is dropped. A lone `&` or `|` is read as `&&` or `||`. An open string is read as a string.
2. **A `let` after a complete expression starts the next definition**, so whatever is still open ends early, state by state: `(1 + 2` becomes an atom, `if a` an expression, `let y = 1` without `in` an expression, a head without `=` a binding. A `rec` after a name does the same: the name was a damaged `let`, e.g. `et rec`.
3. **A closing part without its opening part gets one.** A `then` or an `else` after the complete body of a `let` has no `if` that waits: the expression before it, which is what is left of `fi a < b`, is dropped, and an `if` with a name as its condition is put there, so that the branches are branches. The same for `->` without `fun`, for `in` after a definition at the top, and for a `,` after a body, which gets a `(`.
4. **An opening part without its closing part gets one**: a `then` after a condition, an `else` between two branches on one line, an `in` after a local definition, a `;` in a list, a `=` after the head of a definition, an `->` after the parameters of a `fun`. Inside a bracket, a closing keyword or a closing bracket of the other kind ends the bracket early.
5. **An `if` or a `fun` after a complete expression ends that expression** and what it is the last part of: more often an `in` or the head of the next definition is missing than an operator. bison's default reductions do this, down to the body of the `let`. The flag decides in two places: after a condition or a `then` branch, an `if` on the same line gets the missing `then` or `else`, and an `if` that is the first on its line starts something new.
6. **Everything else keeps the parser where it is.** Where an expression has to come and a closing token comes, a name is put there. A closing bracket, a separator or a keyword that nothing waits for is dropped, and so is a second operator.

No rule lets the parser stop: on the train and validation samples that `check.ts` runs, no run enters the state `stopped` before the end of input, and every open cell that a run reads is named by a rule. The cells of the end of input hold what the parser as it is holds, as for the trained tables.

### Why a stray closing token is hard for this table

In an LALR table, `)`, `]`, `,`, `;`, `then`, `else` and `in` are lookahead tokens of nearly every complete expression. So a stray one first runs through frozen reductions, which close every `if`, `let … in` and `fun` around it, and only reaches an open cell at the body of the `let` or inside a bracket. E.g. in `let f x = if c then a else g x) y`, the `)` closes the `if` before any choice is asked. The rules can drop the `)` there, and cannot bring the `if` back: the rest of the definition is one level too high. The same holds for a `then` whose `if` is damaged inside a `let … in`: the `if` that the rules put is one level too high. These are the largest groups of what the rules leave.

### States with a second meaning

- The state after `^`: after a complete body, a `,` puts `^` and then `(`, so that the bracket is the right side of an operator. A text with a `,` right after a `^` is read the same way.
- The state after `let _ =`, at `in`: the rule "an `in` without its `let`" puts a `let` there, where a missing expression would get a name. A text with `let _ = in` is read the same way. The state after a `let` at the top, at `in`, puts `_` for the same rule.

## The rules

"Cells set" counts both copies of the flag. "Relied on" are open cells that the rule names and that keep what the parser as it is does, e.g. bison's default reduction of a complete atom, which leads to the state that decides. "Samples" is how many of 8,000 train and 5,000 validation samples read a cell of the rule. "Added in its place" is what the rule adds to all three on top of the rules above it in the file, and "lost without it" what all three loses when the rule alone is left out. Read both with care: a rule that says "the rest" sets other cells when a rule above it is missing, and without a rule its cells hold `stop` or a default reduction, which ends many samples.

| rule | cells set | relied on | samples | added in its place: train, validation | lost without it: train, validation |
| --- | --- | --- | --- | --- | --- |
| a character that starts no token | 198 | 0 | 413 | 0.69, 0.92 | 0.95, 1.23 |
| a lone `&` or `\|` | 290 | 106 | 275 | 1.16, 1.29 | 0.52, 0.62 |
| an open string | 174 | 24 | 1,338 | 2.15, 2.09 | 3.25, 3.16 |
| an open comment | 198 | 0 | 553 | 0.09, 0.10 | 0.10, 0.12 |
| the next definition starts | 34 | 20 | 2,751 | 13.30, 13.30 | 19.80, 19.05 |
| a `rec` without its `let` | 94 | 100 | 266 | 1.33, 1.62 | 0.44, 0.39 |
| an expression that ends before `if` or `fun` | 2 | 142 | 775 | 0.00, 0.00 | 0.71, 0.78 |
| a `then` or an `else` without its `if` | 36 | 0 | 1,551 | 0.09, 0.10 | 2.71, 2.96 |
| an `->` without its `fun` | 116 | 26 | 614 | -0.05, -0.05 | 0.85, 0.85 |
| a `,` without its opening bracket | 8 | 0 | 249 | 0.08, 0.06 | 0.05, 0.00 |
| a `;` without its opening bracket (left out) | 0 | 0 | 0 | | |
| an `in` without its `let` | 18 | 0 | 923 | 0.49, 0.50 | 0.93, 1.13 |
| an `if` without its `then` | 18 | 0 | 1,537 | 0.30, 0.28 | 1.06, 0.96 |
| a second branch without its `else` | 16 | 0 | 160 | 0.76, 0.71 | 0.00, 0.00 |
| a local definition without its `in` | 36 | 0 | 45 | 0.17, 0.19 | 0.30, 0.41 |
| a closing keyword inside a bracket | 18 | 0 | 488 | 0.99, 0.63 | 0.80, 0.73 |
| a closing bracket of the other kind | 10 | 0 | 342 | 0.54, 0.28 | 0.03, -0.02 |
| a list or a tuple without a separator | 38 | 4 | 40 | 0.02, 0.05 | 0.18, 0.29 |
| text between definitions | 252 | 64 | 1,623 | 9.38, 8.68 | 13.51, 13.15 |
| a `let` without its name | 224 | 0 | 1,167 | 1.78, 1.59 | 7.49, 7.95 |
| a `(` in the place of a name or a parameter | 124 | 0 | 529 | 1.60, 1.62 | 3.23, 3.27 |
| a definition without its `=` | 180 | 272 | 3,610 | 14.89, 14.73 | 20.04, 19.47 |
| a `fun` without its parameter or its `->` | 114 | 56 | 864 | 4.10, 4.42 | 4.82, 4.90 |
| a `_` in an expression | 130 | 24 | 92 | 0.25, 0.11 | 0.28, 0.16 |
| an expression is missing | 1,124 | 0 | 4,530 | 25.72, 26.41 | 27.07, 27.61 |
| an operator is missing | 398 | 0 | 954 | 0.13, 0.13 | 0.35, 0.28 |
| a closing bracket, separator or keyword that nothing waits for | 60 | 36 | 2,639 | 2.77, 2.81 | 2.77, 2.81 |
| an operator without its left side | 112 | 0 | 1 | 0.00, 0.00 | 0.00, 0.00 |

The rules set 4,022 of the 5,024 open cells that may change, 3,792 of them to another choice than the parser as it is has, and rely on 874 more as they are. The other 128 are the cells of the two states after the whole program, which no run enters. `rules.ts` prints each rule with its reason and its example, and `report.ts --added --without-each` makes the two columns again.

### What each rule added when it went in

All three on the 40,000 train and the 5,000 validation samples, in the order in which the rules were written.

| step | train | validation |
| --- | --- | --- |
| the first 20 rules, from the grammar and the automaton: what is no token, the next definition starts, the heads of `let` and `fun`, the missing `then`, `else`, `in`, `=` and `->`, a missing expression, a missing operator, a closing token that nothing waits for is dropped | 82.25 | 81.61 |
| a `then` or an `else` without its `if`, and an `in` without its `let`. Alone on the first 20 rules: `then` +1.62, `else` +2.15, `in` +0.91 | 85.62 | 85.29 |
| a closing keyword inside a bracket ends the bracket early, where it was dropped | 86.98 | 86.55 |
| a closing bracket of the other kind ends the bracket early | 87.24 | 86.75 |
| a `rec` without its `let` starts a definition, where it was dropped | 87.67 | 87.24 |
| an expression ends before `if` or `fun`, where an operator was put, and the flag decides after a `then` branch | 88.31 | 87.95 |
| after `=`, `in` and `->`, a `then` or an `else` puts the `if` at once. A `(` between definitions is dropped | 88.35 | 87.97 |
| a `,` and a `;` without their opening bracket | 88.59 | 88.19 |
| a `(` before a name in a pattern is dropped, `true` and `false` after `let` are read as the name, a list or a tuple without a separator | 88.60 | 88.23 |
| the expression before a stray `then`, `else` or `->` is dropped, where `^` was put after it: all three the same, and the stack column from 79.1 to 81.9 on validation | 88.60 | 88.23 |
| the rule for `;` is left out, see below | 88.39 | 87.99 |
| after a condition, an `if` that is the first on its line ends the `if` before it | 88.43 | 88.03 |

Variants that I compared and that changed all three by less than 0.1 on both sets are not listed, e.g. an operator after an operator dropped or given a name as its left side.

## Two decisions against or with the train score

**A `;` after the body of a `let`: dropped, against the train score.** The rule "a `;` without its opening bracket" puts a `[` there, as the rule for `,` puts a `(`. With it the rules have 88.64 on train and 88.28 on validation, 0.2 more. I left it out: `let a = 1;;` and `let a = 1;` before the next definition are habits of OCaml and the first rows of LANGUAGE.md's table, and the list that the rule opens swallows the next definition and everything after it. My own programs have 91.60 without the rule and 90.28 with it. `report.ts --with-left-out` scores the rules with it.

**An `in` after a definition at the top: a local definition is rebuilt, with the train score.** 5.8% of the train samples have such an `in`, mostly from a local `let` that the damage hit, e.g. `lte half = w / 2 in`, and the rule is worth 1.1 points on validation. The price: a person who writes `let a = 1 in` at the top and goes on with `let b = …` gets `b` read as a local definition, two levels too deep, up to the definition after it. In my own programs two samples gain 25 code points and two lose 41. A table cell cannot tell the two cases apart: both are an `in` after a complete definition, and the `let` that follows is shifted by a frozen cell. I kept the rule because I have no reason to think that one case is more frequent among real mistakes than the other, and the train samples speak for it. Without the rule the bar has 87.50 on train and 86.90 on validation.

## What the rules leave

On 12,000 train samples, 11.1% of the scored code points are wrong, in half of the samples. `where-wrong.ts` gives each wrong sample to the open cell that was read last before its first wrong code point, so the shares are rough:

| share of the wrong code points | where | why |
| --- | --- | --- |
| 13% | an open comment | It takes the rest of the text as one token, with one output. |
| 7% | a `then` whose `if` is rebuilt | The frozen reductions closed what was around the lost `if`, so the rebuilt one is too high, or the `then` was added and the `if` is one too many. |
| 6% | an `in` whose `let` is rebuilt | The same. |
| 5% | a `)` after the body of a `let` | The same: it is dropped, and what the frozen reductions closed stays closed. |
| 5% | an `else` whose `if` is rebuilt | The same. In a third of these samples the rebuilt `if` is one too many, e.g. for an `else` that the damage copied into a string. |
| 5% | an open string | It takes the rest of its line as one token. |
| 4% | a name between definitions | It is read as `let`, and is a comment's text or the body of a definition in other samples. |
| 3% | an `->` whose `fun` is rebuilt | In half of these samples the rebuilt `fun` is one too many, e.g. for an `->` of a copied run. |
| 3% | a `let` where a local definition waits for `in` | It is read as the next definition, and in these samples it is a second local definition. A cell cannot tell: both are first on their line. |

What no table of these cells and choices can do:

- **Bring back what a frozen reduction closed**, see above. This is the largest group.
- **Tell a missing `in` before a second local `let` from an unfinished definition before the next one.** With an `in` put there, the train score falls by 6 points. So `let xx = x * x` without `in` before `let yy = …` is read as two definitions, which a person would call wrong.
- **Undo a shift.** `et total = 1` after a definition is read as arguments of the definition before, without an error, until the `=`.
- **Give a token two outputs**: `letx` for `let x`, an open comment, an open string.
- **Look ahead**: whether a `(` at the top starts a damaged comment or an expression is in the tokens after it.

## My own broken programs

`show.ts --own` prints all of them. Five, with the wanted label in the first row of each pair and the bar's output in the second. `k` keyword, `n` name, `d` defined name, `a` parameter, `l` constant, `o` operator, `p` punctuation, `w` white space, `+` an added code point. In "in": `l` let, `=`, `n` in, `i` if, `t` then, `e` else, `(`.

A missing `then`, all 24 scored code points right, `then` and a name put at the `else`:

```
broken  let sign n = if n < 0 0 - 1 else 1⏎let one = sign 5⏎
depth   1111111111111222222222222222222222211111111111111111
  got   1111111111111222222222222222222222211111111111111111
in      lllllllllll==iiiiiiiiitttttteeeeeeellllllll=========
  got   lllllllllll==iiiiiiiiiiiiiiieeeeeeellllllll=========
first error                         ^
```

A missing `)`, all 26 right, the bracket ends early at `let`:

```
broken  let area = (width * height⏎let volume = area * depth⏎
depth   11111111111222222222222222211111111111111111111111111
  got   11111111111222222222222222211111111111111111111111111
in      lllllllll==((((((((((((((((lllllllllll===============
  got   lllllllll==((((((((((((((((lllllllllll===============
first error                        ^
```

`fi` for `if`, all 35 right, the expression `fi n < 0` dropped and an `if` with a name put at the `then`:

```
broken  let sign n = fi n < 0 then 0 - 1 else 1⏎let one = sign 5⏎
depth   11111111111112+222222222222222222222222211111111111111111
  got   111111111111111111111122222222222222222211111111111111111
in      lllllllllll==i+iiiiiiittttttttttteeeeeeellllllll=========
  got   lllllllllll===========ttttttttttteeeeeeellllllll=========
first error                   ^
```

`lte` for a local `let`, all 34 right, a local definition rebuilt at the `in`:

```
broken  let area w h =⏎  lte half = w / 2 in⏎  half * h⏎let unit = area 2 1⏎
depth   1111111111111111122+222222222222222222222222222211111111111111111111
  got   11111111111111111111111111111111112222222222222211111111111111111111
in      lllllllllllll====ll+llllll========nnnnnnnnnnnnnnlllllllll===========
  got   lllllllllllll=====================nnnnnnnnnnnnnnlllllllll===========
first error                               ^
```

An `in` after a definition at the top, all 15 wrong, the price of the rule above:

```
broken  let a = 1 in⏎let b = a + 1⏎
depth   111111111+++111111111111111
  got   111111111122233333333333333
in      llllll===+++=llllll========
  got   llllll====nnnllllll========
first error       ^
```

The 21 own samples with a wrong code point, by what is wrong: a missing `in` between two local definitions (28 of 45), an `in` after a definition at the top (15 of 15 and 29 of 29), an `if`, a `fun` or a `let` as an argument without brackets (19 of 29, 11 of 21, 5 of 15: the missing bracket's level cannot be known), an open comment (15 of 25), a missing `[` (8 of 32), and thirteen with 1 to 6 wrong code points, e.g. the name of an expression that stands alone, which is read as `let`.

## Commands

Run from the repo root, with `RECOVERY_LR_SCRATCH` set to a folder outside the repo.

```sh
bun lab/recovery-lr/learn/bars/rules/rules.ts                      # the rules with their reasons, examples and cells
bun lab/recovery-lr/learn/bars/rules/report.ts                     # train, validation and the own programs
bun lab/recovery-lr/learn/bars/rules/report.ts --added --without-each   # the two columns of the table of rules, about a minute
bun lab/recovery-lr/learn/bars/rules/report.ts --with-left-out     # with the rule for `;`
bun lab/recovery-lr/learn/bars/rules/report.ts --save              # writes tables.json: the rules with the count on the train samples
bun lab/recovery-lr/learn/bars/rules/check.ts                      # what has to hold, about 25 s
bun lab/recovery-lr/learn/bars/rules/bar.ts                        # the validation samples by the two routes
bun lab/recovery-lr/learn/bars/rules/show.ts --own                 # the own programs under their labels, with the cells that are read
bun lab/recovery-lr/learn/bars/rules/show.ts --sample 224 --text 'let x = (1 + 2 let y = 3'
bun lab/recovery-lr/learn/bars/rules/show.ts --first 20 --wrong --cell "35,THEN"
bun lab/recovery-lr/learn/bars/rules/where-wrong.ts [--stack]      # the cells before the first wrong code point
bun lab/recovery-lr/learn/bars/rules/wanted.ts --cell "35,RPAREN"  # what the labels want after a cell
bun lab/recovery-lr/learn/bars/rules/try.ts --states 35,32,37 --terminals THEN --choices "skip|pop"   # variants by their scores
bun lab/recovery-lr/learn/search/search.ts --from lab/recovery-lr/learn/bars/rules/tables.json --out <file.json> --passes 8 --count
```

`check.ts` holds: the two added terminals are the ones that the rule of `../../picked-terminals.ts` picks; `tables.json` is the rules as they are with the count; 3,000 valid programs get their labels exactly and read no open cell; on 8,000 train and 5,000 validation samples nothing before the first error differs from the parser as it is, no run stops, and no read cell is unnamed; the cells of the end of input are the base's; the two routes of `bar.ts` give the same 17 counts. `bunx tsc -p lab/recovery-lr/learn` and `bunx oxlint --type-aware lab/recovery-lr/learn/bars/rules` are clean. The check is not in `../../check-all.ts`, which is another author's file.

## Not checked

- The held-back sets. Nothing here has seen them.
- Whether the two decisions above are right for real mistakes. They rest on my own judgment of which mistakes people make.
- Texts in which a token takes more than 16 steps: 173 of 478,475 tokens from the first error on are skipped by that limit, mostly a `let` under many open brackets.
- The cells of the end of input. They hold what the parser as it is holds, so a parse that is open at the end stays open, and the constituents that only the end would close are not found. A hand-written table could close them: I left them, so that the bar has the cells that training has.
- Tables without "end an item early". 7 of the 27 rules use that choice, in 114 cells, e.g. every cell of "the next definition starts". So these rules are no bar for a row that leaves the choice out.
