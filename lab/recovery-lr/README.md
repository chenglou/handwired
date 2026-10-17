# The recovery recipe on bison's LR table: the foundation

This folder is the transfer experiment's track on a parser table that a tool made: the LALR(1) table that bison 2.3 generates for miniml, a small ML-like language, with a scanner from flex 2.6.4. The question is whether the recipe of `lab/recovery-parser/learn/`, which trains the table cells that valid input never reads, carries over from the JSON highlighter to such a table.

What is here is the foundation: the tools' tables as plain data, a plain scanner and parser of our own that do what the generated C code does, the labels, the shape of a sample, and the dataset of train and validation samples. The recovery parser, the bars, the twins and the held-back sets build on it in folders of their own.

## The grammar

`grammar/miniml.y` has 50 productions: a program is a list of definitions `let [rec] name parameters = expression` without a terminator, with `if` with and without `else`, `fun`, local definitions, 14 binary operators, application, tuples and lists. [LANGUAGE.md](LANGUAGE.md) describes the language for someone who writes programs in it. The grammar is ambiguous as written, e.g. `a + b * c` and the dangling `else`: its 281 shift/reduce conflicts are all settled by the precedence declarations, 149 as a shift and 132 as a reduction, and bison reports none. `grammar/miniml.l` is the scanner: every start of a token is a token, e.g. an open string is a BADSTRING, so flex reports that it never backs up.

## Sizes

| | |
| --- | --- |
| states | 99, of which the parser never enters the final one |
| terminals that a text can hold | 38: 34 tokens, the end of input, and BADCHAR, BADSTRING, BADCOMMENT for text that is no token |
| nonterminals, productions | 12, 50 |
| action cells | 99 × 38 = 3,762 |
| frozen cells | 1,391: 642 shifts, the accept, 748 reductions |
| open cells | 2,371: bison reports the error in 1,398 and still reduces by default in 973 |
| gotos | 102 |
| scanner | 72 states × 39 classes of bytes, 40 rules. A text reaches 69 of the states: 2,622 cells, of which 755 are moves and the others end the token |

`tables.ts` counts these from `grammar/tables.json`, and `check-cells.ts` holds them against this table.

## Frozen and open cells, and the first error

A cell is (state, terminal). It is **frozen** when the grammar's LALR(1) table has an action there: a shift, the accept, or a reduction by a rule whose lookahead set holds the terminal. bison 2.3's report prints no lookahead set for a state with a single reduction, so `tables.ts` computes the sets from the rules. A valid text reads frozen cells only, and every frozen cell is read by some valid program.

Every other cell is **open**. In 973 of them bison still reduces by the state's default rule, and reports the error some steps later: in `let x 1` it reduces an empty parameter list at the `1` first. Such a reduction is the base's choice of an open cell, which training may replace.

**The first error** of a text is the first token that reads an open cell. It is the token at which bison calls `yyerror`: a parser with default reductions never shifts a token that read an open cell. `parse` returns the stack as it is when that cell is read, before the default reductions, and a parser that recovers starts there.

With the parser as it is, some text reads 3,373 of the 3,762 cells. The other 389 are open cells that only a parser that recovers can reach, e.g. after it pops a state.

## Labels

Per code point of a valid text, from the stack right after the code point's token is shifted (`labels.ts`):

- **display kind**, one of 11: whitespace, comment, keyword (`let rec in if then else fun`), name (an identifier in an expression), definedName (the identifier or `_` after `let` or `let rec`), parameter (an identifier or `_` among the parameters of a binding or a `fun`), constant (an integer, `true`, `false`), string, operator (`+ - * / :: ^ && || <> < <= > >=` and the `=` between two expressions), punctuation (`( ) [ ] , ; ->` and the `=` of a binding), error. No label is `error`: it is what a parser shows a token as that it cannot place.
- **depth**: the number of `(`, `[`, `let`, `if` and `fun` on the stack.
- **container**: the topmost symbol on the stack among `( [ let = in if then else fun ->`, where `=` only counts as the sign of a binding.
- **stack**: a hash of all the symbols on the stack, for the column "stack".

White space and comments have their own kinds, and the other three values as the token before them left the stack. All four are functions of the symbols on the stack, so a parser with other states can be scored too. `labelsOfValidText` also gives every reduction with its nonterminal and the tokens that it covers, for the column "constituents".

## Samples

`makeSample` in `sample.ts` makes a sample from a valid original, a broken text and the alignment, which says for every code point of the broken text which code point of the original it is, or -1 for an added one. A kept code point has the labels of its counterpart. An added one has none and is never scored. Scores count the kept code points from the first error's token on. Where two alignments give the same broken text, the sample has the one that keeps the earlier code point, e.g. of `))` with one bracket removed, the first bracket is the one that is left. `alignmentOfTexts` gives an alignment for a pair of texts that comes without one.

For the column "constituents", a sample also says which of its tokens are kept tokens, i.e. have exactly the code points of one token of the original, and holds the original's constituents restricted to them: for every reduction the nonterminal, and the first and the last kept token that it covers.

## The dataset

`dataset.ts` gives the train and validation samples: `loadSamples('train', seed, count)`. The experiment's sets are the first 40,000 train samples and the first 5,000 validation samples of the default seed. Nothing is stored: sample `index` is program `index` of `generate.ts` with the damage of `damage.ts`, and a function of the seed and the index alone.

**Programs.** `idioms.ts` holds 466 idioms of 17 sorts as plain miniml text, e.g. the length of a list by recursion: list functions by recursion, arithmetic helpers, strings put together with `^`, chains of `if` and `else if`, nested local definitions, tuples, functions as values, lists of lists, one step of a stack machine, settings, boolean logic, definitions of `()` that print, loops with an accumulator, `map` and `fold`, lookup tables, tests, and states as tuples. A program is idioms of one sort until it is long enough, and one definition in seven comes from the idioms of any sort. An idiom has alternatives and holes, e.g. `Int`, which is filled with an expression over the names in scope and the functions that the program has defined so far. Every name is written one way per program, e.g. `xs` as `items`. A layout is drawn per program: an indentation of one to eight spaces or a tab, a line width from 40 to 120, where a line breaks, the spaces around operators and inside brackets, brackets that are not needed, comments before definitions, at line ends and between tokens, and blank lines. 54% of the programs have a comment, 9% a tab, 5% are one line, and 2% end their lines with `\r\n`. A program has 286 code points and 74 tokens on average, and at most 512 code points. 206 of the 45,330 programs hold comments only.

**Free expressions.** In one program in three, one to three expressions are replaced by an expression that only follows the grammar, e.g. `"a" * [1]` and `x - if c then y`: miniml checks no types, so the program stays valid. They are there because the programs have to read every frozen cell of the parser's table, and most pairs of tokens that the grammar allows are in no sensible program. Without them the programs read 1,033 of the 1,391 frozen cells. With them they read every one: the 45,330 programs of the experiment's sets read each cell in 20 programs or more, 1,045 of the cells in 100 or more, and 1,115 in programs of all 17 sorts.

**Damage.** `damage.ts` is fixed: ten edits on code points and lines that know nothing of the language, one edit with probability 0.6, two with 0.3 and three with 0.1. A damaged text that is unchanged, still valid, too long or has nothing to score is thrown away, and the damage is drawn again for the same program. Of 118,386 draws, 38.0% gave a sample: 49.2% were still valid, 11.0% had nothing to score, 1.6% were too long and 0.1% unchanged. A text with more edits is a sample more often, so 47.4% of the samples have one edit, 37.4% two and 15.1% three.

**Splits.** A program is in the split of its tokens: 8 of 9 lists of tokens are train lists. The programs have 37,514 lists in train and 4,718 in validation, none in both. 19 validation samples have a broken text that a train sample has too, e.g. a text that is cut after a few code points.

**What the samples are like**, by `stats.ts` over the 45,000:

- A sample has 274 code points, of which 135 are scored. A tenth of the samples have fewer than 15 scored code points, and half have fewer than 108.
- The first error's token starts at the first edit or before it in 28% of the samples, 1 to 19 code points after it in 42%, and 100 or more after it in 9%: the parser takes what it can read as a valid start. The token is text that is no token in 15%, and its cell holds a default reduction in 61%.
- Before the first error, 6.9% of the kept code points have another label than the parser as it is gives, which no table can change. A third of them are white space, e.g. the space after a removed `=`. They are not scored.
- In 27.6% of the samples the last kept token before the first error has another depth or container than its label: the parser reaches its first error on another stack than the labels after it suppose, and no error has said so. E.g. a duplicated line `let y = f x in` opens a level that the original does not have: among the samples whose one edit is a duplicated line, 48% are of this sort. Whether a parser can still give the labels after such a first error depends on its list of choices.
- 13.0% of the samples have a scored label that no parser of the experiment can give, see `scoredOutOfReach`: such a parser reads the scanner's tokens, gives a token one display kind, and gives a token and the white space after it one depth and one container. E.g. `let x` without its space is the one name `letx`, and a string that lost a quote takes the text up to the next quote. So a parser has at most 97.44% of the scored code points and 87.0% of the samples right.

```sh
bun lab/recovery-lr/stats.ts               # the numbers above, and which frozen cells the programs read, about 15 s
bun lab/recovery-lr/dump.ts <folder>       # samples.txt with 300 train samples under their labels, and documents.txt
bun test lab/recovery-lr                   # the invariants of the dataset on 2,000 samples
```

## Build and check

```sh
export RECOVERY_LR_SCRATCH=<a folder outside the repo>
bun lab/recovery-lr/grammar/build.ts       # bison, flex and cc; writes grammar/tables.json
bun lab/recovery-lr/check-all.ts           # the type check, the lint, the test and every check, one after another, about a minute
```

`grammar/tables.json` is committed, so nothing but the build and two checks needs the tools. The generated C files go to the scratch folder.

- `check-tools.ts`: the committed tables are what the tools make today. The plain scanner and parser give the same tokens and the same steps of `yyparse` as the generated C code on 273,985 texts: 27,034 valid, damaged and random ones (6.9 million steps), a text for every cell of the parser's table that a text can read, texts through every cell of the scanner with every code point from U+0000 to U+0080, and every text of up to 3 code points. Where bison's report prints a lookahead set, it is the set of `tables.ts`.
- `check-changed.ts`: 90 copies of the tables with one entry changed, 12 of them moves of the scanner, are each refused by `tables.ts` or seen by a text, except 4 that change nothing that is read. Then every move, kind and class of the scanner changed to every other value, and three other actions in every cell of the parser that a text reads: a text sees each one, except 691 changed moves that provably cut every text as before.
- `check-cells.ts`: the sizes; the lookahead sets derived a second way, from the canonical LR(1) automaton (727 states); no valid start of up to 10 tokens reads an open cell (214 million starts, as 322,362 distinct stacks); every frozen cell is read by a valid program; no valid program of 512 code points reaches the stack limit.
- `check-samples.ts`: the labels derived a second way, from the tree; what every edit of the damage does; what `sample.ts` promises of every field of a sample; a parser that makes the one known repair of a text, skipping a `#` between two tokens, has every label, every hash of the stack and exactly the sample's constituents; the dataset gives the same samples twice, and no validation program has the tokens of a train program.
- `check-dataset.ts`: the experiment's 45,000 samples. Every idiom is valid with each of its alternatives; every program is valid, and together they read every frozen cell; a kept code point has the labels of its counterpart in the original, taken from the original anew; every broken text is rejected at the first token that reads an open cell, with a code point left to score; no list of tokens is in both splits; the draws that were thrown away are what they were taken for; the damage makes the same edits when every code point of a program but the line feed is exchanged for another one, and `damage.ts` imports nothing of the language; the same seed gives the same samples.
- `check-language.ts`: every example of LANGUAGE.md.
- `check-guard.ts`: no code outside `held-back/` names that folder, and none names the skeptic's probe of hand-written mistakes.

## Where this differs from the measured prototype

- The places of the kept code points rise. A swap of two neighbours keeps the code point that now comes first and adds the other one, where the prototype kept both.
- An alignment is brought into one form, see above. The prototype took the damage's own.
- Every code point also has the hash of the stack's symbols, and a sample has the kept tokens and the constituents.
- The goto table has -1 where the automaton has no transition. bison's compressed table gives some state for every pair.
- The scanner reads U+0000 as flex does, as a byte of the class that no rule names. The prototype turned it into the byte 0x80 before the C program saw it.
- `grammar/tables.json` holds what every rule of the scanner returns, so nothing reads `miniml.l` when the tables are loaded.

## Files

- `grammar/`: `miniml.y`, `miniml.l`, `driver.c` (the C program that prints the tables and the steps of `yyparse`), `build.ts`, `tables.json`.
- `tables.ts`: the tables as plain data, the items, the lookahead sets, frozen and open cells, the sizes.
- `parser.ts`: `scan` and `parse`, the limits (512 code points, 520 states on the stack).
- `labels.ts`, `sample.ts`, `dataset.ts`, `damage.ts`, `random.ts`: see above.
- `idioms.ts`, `syntax.ts`, `generate.ts`: the generator of valid programs: the idioms of the 17 sorts with the vocabulary, a program as a tree with its brackets and layouts, and the steps from idioms to a program's text.
- `stats.ts`, `dump.ts`, `invariants.test.ts`: the numbers of the dataset, the text files for a reader, and the test of the invariants.
- `explore.ts`, `reference.ts`: for the checks, the stacks of all valid starts, random sentences of the grammar, and the texts that are compared with the C program.
