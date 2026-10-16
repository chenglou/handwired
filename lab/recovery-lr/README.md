# The recovery recipe on bison's LR table: the foundation

This folder is the transfer experiment's track on a parser table that a tool made: the LALR(1) table that bison 2.3 generates for miniml, a small ML-like language, with a scanner from flex 2.6.4. The question is whether the recipe of `lab/recovery-parser/learn/`, which trains the table cells that valid input never reads, carries over from the JSON highlighter to such a table.

What is here is stage A: the tools' tables as plain data, a plain scanner and parser of our own that do what the generated C code does, the labels, the shape of a sample, and the functions that load samples. The recovery parser, the bars, the twins and the held-back sets build on it in folders of their own.

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

`dataset.ts` gives the train and validation samples: `loadSamples('train', seed, count)`. A sample is one program of `generate.ts`, which is a stand-in for the experiment's generator, with the language-neutral damage of `damage.ts`, which is fixed. Programs are split by a hash of their tokens, 8 of 9 into train.

## Build and check

```sh
export RECOVERY_LR_SCRATCH=<a folder outside the repo>
bun lab/recovery-lr/grammar/build.ts       # bison, flex and cc; writes grammar/tables.json
bun lab/recovery-lr/check-all.ts           # the type check, the lint and every check, about 10 s
```

`grammar/tables.json` is committed, so nothing but the build and two checks needs the tools. The generated C files go to the scratch folder.

- `check-tools.ts`: the committed tables are what the tools make today. The plain scanner and parser give the same tokens and the same steps of `yyparse` as the generated C code on 273,985 texts: 27,034 valid, damaged and random ones (5.7 million steps), a text for every cell of the parser's table that a text can read, texts through every cell of the scanner with every code point from U+0000 to U+0080, and every text of up to 3 code points. Where bison's report prints a lookahead set, it is the set of `tables.ts`.
- `check-changed.ts`: 90 copies of the tables with one entry changed, 12 of them moves of the scanner, are each refused by `tables.ts` or seen by a text, except 4 that change nothing that is read. Then every move, kind and class of the scanner changed to every other value, and three other actions in every cell of the parser that a text reads: a text sees each one, except 691 changed moves that provably cut every text as before.
- `check-cells.ts`: the sizes; the lookahead sets derived a second way, from the canonical LR(1) automaton (727 states); no valid start of up to 10 tokens reads an open cell (214 million starts, as 322,362 distinct stacks); every frozen cell is read by a valid program; no valid program of 512 code points reaches the stack limit.
- `check-samples.ts`: the labels derived a second way, from the tree; what every edit of the damage does; what `sample.ts` promises of every field of a sample; the dataset gives the same samples twice, and no validation program has the tokens of a train program.
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
- `labels.ts`, `sample.ts`, `dataset.ts`, `damage.ts`, `generate.ts`, `random.ts`: see above.
- `explore.ts`, `reference.ts`: for the checks, the stacks of all valid starts, random sentences of the grammar, and the texts that are compared with the C program.
