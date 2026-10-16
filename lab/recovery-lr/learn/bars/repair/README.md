# The bar "cheapest repair": a search at parse time

Row 7 of the final table: where the grammar's table rejects a token, a search tries changes of the tokens near that token and takes the cheapest one after which the parser goes on. It is the method of Burke and Fisher (1987) with what later work added (Corchuelo and others 2002; Diekmann and Tratt 2020, whose algorithm is called CPCT+). The bar looks ahead and compares repairs while it parses, which one cell of a table cannot do, so it is in the table for reference.

**No number here is a result.** The scores are of the 5,000 validation samples and are here to show what the bar does.

## What the bar knows

The grammar's LALR(1) table, i.e. the frozen cells of [`../../../tables.ts`](../../../tables.ts), and the scanner's tokens. It has no author: nothing in it names a token of miniml, and none of its numbers was set on samples. The one thing that comes from samples is the display kind of a token that a repair takes out, which is the count that every bar may use (`dropped-kinds.json`, from the first 5,000 train samples).

## The method

The parser shifts and reduces by the table. It keeps its stack as it was before each of the last 15 tokens. Where the table rejects a token:

1. **The search.** An edit puts a terminal in before a token, takes a token out, or reads a token as another terminal. Every edit costs 1. The search goes through the sequences of edits by cost, 1 first. A sequence is a repair when the parser then shifts 3 tokens after the last edit and has then got through at least the 3 tokens from the rejected one on, or accepts the end of the text. Edits may stand at the rejected token, after it as far as the parser gets, and at the 15 tokens before it, e.g. a missing `in` shows at the next `let`, some tokens later, and the repair is an `in` put in before those tokens. Of the repairs of the lowest cost the search takes the one after which the parser gets furthest, then the one that takes out or reads anew the fewest tokens of the text, then the one that starts nearest to the rejected token.
2. **The second phase**, when the search has tried 2,000,000 edits without a repair: tokens are dropped from the rejected one on, as few as possible, and for that number the stack is cut down as little as possible, until the parser shifts 3 tokens or accepts the end. This is panic mode with a look ahead.

After a repair the parser goes on from the end of the repair's last edit, and no later repair starts before that place.

A token that is taken out is shown with the stack as it is and with the display kind of `dropped-kinds.json`. A token that is read as another terminal is shown as that terminal, and the stack holds it as that terminal.

## The numbers, and where each comes from

| number | value | from |
| --- | --- | --- |
| shifts that make a repair (`shiftsNeeded`) | 3 | Corchuelo's and CPCT+'s three shifts, and the least distance of Burke and Fisher's parse check |
| the cost of an edit | 1 for each of the three | CPCT+'s costs for putting in and taking out. Burke and Fisher's three single-token repairs are these three edits |
| how far back an edit may stand (`tokensBack`) | 15 tokens | the look-ahead that ML-Yacc recommends, whose error recovery is Burke and Fisher's |
| the order of repairs of one cost | by how far the parser gets, to the end of the text | CPCT+, which stops after 250 tokens. A text here has at most 512 code points |
| the limit of a search (`maximumTries`) | 2,000,000 tried edits | in place of CPCT+'s half a second, so that a run gives the same output on every machine. One search then takes 0.2 s at most here |
| the limit of cost (`maximumCost`) | 8 | no search of the validation samples ended at it: the limit of tried edits comes first |

I worked without a network and wrote these values as I know the papers. I did not look them up again.

**Three choices are mine**, made before any score and not changed after:

- Among repairs of one cost that get equally far, the one that leaves the most tokens of the text as they are comes first. So `)` after `(v + 1)` gets a `(` put in before it, which makes a `()`, and is not taken out. Burke and Fisher try putting in before taking out too.
- The second phase orders its trials by dropped tokens first, then by how much of the stack is cut.
- CPCT+ has no edit "read as another terminal", which costs 2 there as taking out and putting in.

`variants.ts` shows how much hangs on each number, on 5,000 train samples. Nothing was chosen by it:

| numbers | all three | whole | stack | rejected tokens: with a repair, with the second phase |
| --- | --- | --- | --- | --- |
| the bar | 85.99 | 49.28 | 78.96 | 6422, 96 |
| edits only at the rejected token and after it, as in CPCT+ (`tokensBack` 0) | 78.71 | 34.92 | 72.21 | 6819, 14 |
| `tokensBack` 3 | 82.48 | 43.44 | 75.57 | 6599, 38 |
| `tokensBack` 30 | 86.76 | 50.24 | 79.73 | 6415, 81 |
| one edit at most, as Burke and Fisher's first phase (`maximumCost` 1) | 84.96 | 49.76 | 78.40 | 5622, 920 |
| `maximumCost` 2 | 85.88 | 49.22 | 78.89 | 6262, 243 |
| `shiftsNeeded` 2 | 85.68 | 48.98 | 78.63 | 6664, 87 |
| `shiftsNeeded` 5 | 86.44 | 49.66 | 79.47 | 6128, 105 |
| `maximumTries` 200,000 | 85.93 | 49.30 | 78.90 | 6385, 140 |
| `maximumTries` 20,000 | 85.30 | 49.82 | 78.38 | 5977, 612 |

Going back before the rejected token is what counts: without it the bar has 78.7 in all three, with 15 tokens 86.0. A second and a third edit add one point.

## Scores on validation

5,000 validation samples, 21 s in one thread:

| parser | all three | whole | kind | depth | container | stack | whole by stack | constituents: found, right | the same without the ones before the first error | inserted per sample |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a search for the cheapest repair | 85.51 | 49.42 | 95.4 | 87.1 | 94.9 | 78.61 | 30.42 | 97.5, 97.4 | 95.8, 95.8 | 0.90 |

The table rejects 6,490 tokens there, 1.30 per sample. The search finds a repair at 6,392 of them: one edit at 5,594, two at 679, three at 112, four to seven at 7. 1,916 repairs start before the rejected token. The repairs put in 4,515 terminals, take out 1,453 tokens and read 1,354 as another terminal. At 98 rejected tokens the search ends at its limit of tried edits and the second phase goes on, 53 of them at the end of the text.

## The function for the final scoring

```ts
import {outputsOfCheapestRepair, scoreOfCheapestRepair} from './lab/recovery-lr/learn/bars/repair/repair.ts'

outputsOfCheapestRepair(samples: readonly Pick<Sample, 'tokens'>[]): ParserOutput[]   // one output per sample, in order
scoreOfCheapestRepair(samples: readonly Sample[]): Score
```

A `ParserOutput` is the one of [`../../score.ts`](../../score.ts): per token the display kind, the depth, the container, the hash of the stack's symbols and whether the stack holds the token, then every reduction and the number of terminals put in. The bar reads a sample's tokens and nothing else of the sample. `cheapestRepair(sample, kindOfDropped, settings, records)` is the bar on one sample, and fills `records` with what it did at every rejected token.

## What was checked

`check.ts`, about a minute:

- **Valid programs**: on 9,000 (6,000 of the generator, 3,000 random sentences of the grammar) the bar gives the labels at all 2,013,243 code points, with the hash of the stack, and the 942,206 reductions of the plain parser. It starts no search there.
- **The search against a search that tries everything**, with the parser step of `../../../explore.ts`, on the first error of 3,000 samples: what the search returns is a repair by the definition above. Where it returns one edit (2,607 samples), no single edit ranks higher. Where it returns two (296) or more (77) or nothing (20), no single edit is a repair, and in 63 of the samples with two, no pair ranks higher. This check found one fault while the bar was written: of two sequences that lead to the same stack at the same place, the search kept the first one and not the one that ranks higher.
- **The whole bar against the plain parser**: in 2,941 of the 3,000 samples every rejected token gets a repair of the search, 4,384 edits in all. There the tokens with the edits made are a valid program, and the bar's output is what the plain parser has when it reads the edited tokens: every shifted token with its kind, depth, container and stack, every token that was taken out with the stack before it, and the same reductions over the same tokens.
- **The second phase**, at the 59 rejected tokens that reach it: no smaller number of dropped tokens and no higher part of the stack lets the parser go on.
- **A known repair**: 400 programs with a `#` between two tokens. The bar takes the `#` out and has every scored code point right in all three and in the stack, and exactly the original's constituents.
- The same output for a sample whatever ran before, and `dropped-kinds.json` is what the count gives today.

## Five broken programs

By the author of this bar, with the program that was meant. They chose nothing. `show.ts` prints them, and `show.ts --validation 0` validation samples. Under the text: `.` a scored code point that is right in all three, `X` one that is not, `+` an added code point, then the bar's output with the wanted label under it. Kinds: `w` white space, `k` keyword, `n` name, `d` defined name, `a` parameter, `l` constant, `o` operator, `p` punctuation. Containers: `l` let, `=`, `n` in, `i` if, `t` then, `e` else, `(`.

```
--- a missing `in`
meant: "let area w h =\n  let twice = 2 * w in\n  twice * h\nlet unit = area 1 1\n"
text             let area w h =⏎  let twice = 2 * w⏎  twice * h⏎let unit = area 1 1⏎
right                                                           ....................
kind             kkkwddddwawawpwwwkkkwdddddwpwlwownwwwnnnnnwownwkkkwddddwpwnnnnwlwlw
kind wanted      kkkwddddwawawpwwwkkkwdddddwpwlwownwwwnnnnnwownwkkkwddddwpwnnnnwlwlw
depth            1111111111111111122222222222222222222222222222211111111111111111111
depth wanted     1111111111111111122222222222222222222222222222211111111111111111111
container        lllllllllllll====llllllllll==========nnnnnnnnnnlllllllll===========
container wanted lllllllllllll====llllllllll=======nnnnnnnnnnnnnlllllllll===========
20 of 20 scored code points right in all three, 20 in the stack; constituents: 34 of the original's 34 found, 34 of the parse's 34 are the original's; 1 tokens put in
rejected: `let` at code point 47. IN put in before `twice` at code point 37

--- a missing `then`
meant: "let sign n = if n < 0 then 0 - 1 else 1\n"
text             let sign n = if n < 0 0 - 1 else 1⏎
right                                        .......
kind             kkkwddddwawpwkkwnwowlwlwowlwkkkkwlw
kind wanted      kkkwddddwawpwkkwnwowlwlwowlwkkkkwlw
depth            11111111111112222222222222222222222
depth wanted     11111111111112222222222222222222222
container        lllllllllll==iiiiiiiiiiitttteeeeeee
container wanted lllllllllll==iiiiiiiiitttttteeeeeee
7 of 7 scored code points right in all three, 7 in the stack; constituents: 19 of the original's 24 found, 19 of the parse's 23 are the original's; 1 tokens put in
rejected: `else` at code point 28. THEN put in before `-` at code point 24

--- a bracket that is not closed
meant: "let total = add (mul 2 3) 4\nlet next = total + 1\n"
text             let total = add (mul 2 3 4⏎let next = total + 1⏎
right                                       .....................
kind             kkkwdddddwpwnnnwpnnnwlwlwlwkkkwddddwpwnnnnnwowlw
kind wanted      kkkwdddddwpwnnnwpnnnwlwlwlwkkkwddddwpwnnnnnwowlw
depth            111111111111111122222222222111111111111111111111
depth wanted     111111111111111122222222211111111111111111111111
container        llllllllll======(((((((((((lllllllll============
container wanted llllllllll======(((((((((==lllllllll============
21 of 21 scored code points right in all three, 21 in the stack; constituents: 25 of the original's 28 found, 25 of the parse's 28 are the original's; 1 tokens put in
rejected: `let` at code point 27. RPAREN put in before `let` at code point 27

--- a bracket too many
meant: "let scale k v = k * (v + 1)\nlet zero = scale 0 0\n"
text             let scale k v = k * (v + 1))⏎let zero = scale 0 0⏎
right                                       +......................
kind             kkkwdddddwawawpwnwowpnwowlppwkkkwddddwpwnnnnnwlwlw
kind wanted      kkkwdddddwawawpwnwowpnwowlp wkkkwddddwpwnnnnnwlwlw
depth            11111111111111111111222222222111111111111111111111
depth wanted     111111111111111111112222222 2111111111111111111111
container        llllllllllllll======(((((((((lllllllll============
container wanted llllllllllllll======((((((( (lllllllll============
22 of 22 scored code points right in all three, 21 in the stack; constituents: 32 of the original's 32 found, 32 of the parse's 32 are the original's; 1 tokens put in
rejected: `)` at code point 27. LPAREN put in before `)` at code point 27

--- `==` for `=` and `thn` for `then`
meant: "let rec fact n = if n = 0 then 1 else n * fact (n - 1)\n"
text             let rec fact n = if n == 0 thn 1 else n * fact (n - 1)⏎
right                                   +...XXXX........................
kind             kkkwkkkwddddwawpwkkwnwoowlwnnnwlwkkkkwnwownnnnwpnwowlpw
kind wanted      kkkwkkkwddddwawpwkkwnwo wlwkkkwlwkkkkwnwownnnnwpnwowlpw
depth            1111111111111111122222222222222222222222222222233333333
depth wanted     11111111111111111222222 2222222222222222222222233333333
container        lllllllllllllll==iiiiiiiiiiiiiitteeeeeeeeeeeeee((((((((
container wanted lllllllllllllll==iiiiii iiitttttteeeeeeeeeeeeee((((((((
27 of 31 scored code points right in all three, 27 in the stack; constituents: 33 of the original's 33 found, 33 of the parse's 34 are the original's; 2 tokens put in
rejected: `=` at code point 23. TRUE put in before `=` at code point 23
rejected: `else` at code point 33. THEN put in before `1` at code point 31
```

What they show: the missing `in` and the bracket are repaired as a person would. The missing `then` is put in one token late, since the repair nearest to the rejected token comes first, and the code points before `else` are not scored. `==` becomes `n = true = 0`, and `thn` stays a name: a repair makes the text a program, not the program that was meant.

## Effort, and what is not in the bar

About three hours of an agent's work, and no knowledge of miniml. The method, the order of repairs and the four numbers from the literature were written down before the bar ran on any sample. The two limits of a search were set after runs on train samples had shown that a search takes milliseconds: a tenth of the tried edits gives 85.93 for 85.99. The five programs above were written after that. Not in the bar, and in Burke and Fisher's: a repair that joins two tokens into one, and "scope recovery", which closes open brackets and blocks in one step. Closing two or more brackets costs as many edits here, and where a text ends inside many open constructs the search gives up and the second phase cuts the stack. That costs constituents and none of the three values, since no token follows.

## Caveats

- **The bar changes what stands before the first error.** A repair that starts before the rejected token reads the tokens between anew, e.g. after an `in` is put in. A score counts the code points from the first error on, so it sees the stack that the repair leaves and not the tokens before.
- **The kinds of dropped tokens look odd**, e.g. a dropped name is shown as a string. The count is over the dropped tokens whose depth and container the bar has right, and the tokens that this bar takes out with the right depth are mostly pieces of a string or a comment that lost its end. 21 of the 37 terminals are never dropped so in the 5,000 train samples and stay `error`, which costs the column "kind" and not "all three".
- **Time.** One search tries 57,000 edits on average on validation and 2,000,000 at most. The slowest sample takes 0.2 s.

## Commands

Run from the repo root.

```sh
bun lab/recovery-lr/learn/bars/repair/repair.ts [--validation <samples>]   # the score on validation
bun lab/recovery-lr/learn/bars/repair/check.ts                             # the checks, about a minute
bun lab/recovery-lr/learn/bars/repair/show.ts [--validation <first sample>] [--count <samples>]
bun lab/recovery-lr/learn/bars/repair/variants.ts [--train <samples>]      # other numbers, about 2 minutes
bun lab/recovery-lr/learn/bars/repair/count.ts                             # writes dropped-kinds.json
```

## Files

- `repair.ts`: the search (`findRepair`), the bar on one sample (`cheapestRepair`), the functions for the final scoring.
- `dropped-kinds.ts`, `dropped-kinds.json`, `count.ts`: the display kind of a dropped token per terminal, also for [`../tree-sitter`](../tree-sitter/README.md).
- `check.ts`, `variants.ts`, `show.ts`, `examples.ts`.
