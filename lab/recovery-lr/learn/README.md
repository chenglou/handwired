# The recovery parser on bison's table: tables, scores, bars, search

The parser that bison makes for miniml does not recover: at the first token without an action it reports an error and stops. This folder holds what the transfer experiment changes and measures on it: tables with one choice per cell that valid programs never read, the exact parser that runs such tables, how a recovery is scored, the bars that need no author, and the search and the count that fill the tables without gradients. The grammar's tables, the plain parser, the labels and the samples are in [the folder above](../README.md), and the design is `DESIGN.md` in the scratch folder of the transfer track.

**No number here is a result.** The real dataset was being built while this folder was written. Every number below is of the stand-in generator of commit 1d34574, with 40,000 train and 5,000 validation samples, and is here to show that the pieces work.

## Words

- A **cell** is (state, terminal) of the parser's action table. A **frozen** cell holds what the grammar's LALR(1) table holds: a shift, the accept or a reduction. A valid program reads frozen cells only. Every other cell is **open**.
- A **choice** is what an open cell holds, one of a list that depends on the cell's state.
- The **base** is the parser as it is, as tables: bison's default reduction where bison still reduces in an open cell, and `stop` in every other one.
- The **first error** of a text is the first token that reads an open cell. It is the token at which bison calls `yyerror`.
- A **step** is one read of a cell for the token at hand.

## The choices of an open cell

| choice | what the parser does | example |
| --- | --- | --- |
| stop | enters the added state `stopped`. The base where bison reports | |
| skip | drops the token | a stray `)` after `1 +` |
| pop | drops the state on top of the stack | |
| reduce by a rule | for a rule that is complete in the state. The base where bison reduces by default | |
| insert a terminal | enters the state after a terminal that the state shifts, and reads the token again | `then` when `if` follows `if a` |
| read as a terminal | enters the state after a terminal that the state shifts, and takes the token | an open string as a string |
| end an item early | for an item `A: α . β` of the state's kernel: drops the states of α and enters the state after A | `(1 + 2` before `let` becomes an atom |

The row of `stopped` holds skip, its base, or pop, which leaves the state. Four cases are left out of a list, each for a reason:

- At the end of input there is no skip and no "read as": there is no token.
- The start state has no pop: nothing is below it.
- Rule 0, `$accept: program $end`, is no reduction of a list, and `$end` is never inserted.
- An item that ends where a complete rule of the state ends is not ended early, e.g. `if a then b . else c` next to `if a then b .`: that is the rule's reduction.

**Every choice leaves the stack a path of the automaton**, so the parser only reads a goto where bison defined one. `check-tables.ts` goes through every state that can lie below a state and finds a goto for each reduction and each item ended early.

Sizes, from `cellCounts`:

| | |
| --- | --- |
| cells | 100 states × 38 terminals = 3,800 |
| frozen | 1,391 |
| open | 2,409: the grammar's 2,371 and the 38 of `stopped` |
| open cells of the end of input, which training and the search leave alone | 58 |
| open cells that may change | 2,351 |
| choices of those cells | 39,082, i.e. 16.6 per cell, from 2 to 37. Without "end an item early" 37,031, 15.8 per cell |
| the base | stop in 1,436 open cells, a default reduction in 935, skip in the 38 of `stopped` |
| display entries | 3,800: 52 frozen, 3,748 open |

The base holds stop in the 38 cells of the final state, where bison's default rule is rule 0. The parser never enters that state.

## The display table

A token is shown with a display kind from a table over (the token's terminal, the state on top after the token is taken or skipped). An entry is **frozen** when a shift reads it, e.g. (IDENT, the state after the name of a binding), which shows a defined name: 52 entries, one per state that a terminal leads into. Every other entry is open and holds any of the 11 kinds. The base holds `error` in all of them.

- A token that is read as another terminal reads the open entry of its own terminal and the new state, e.g. (BADSTRING, the state after a string).
- A skipped token reads the entry of its terminal and the state that is on top. That entry is a frozen one when the state was entered by a shift of the same terminal, e.g. the second `then` of `then then` is shown as a keyword whatever the tables hold.
- White space and comments are shown as what they are, with the depth and the container of the stack as it is.

The depth and the container of a token come from the stack, as in `../labels.ts`. The state `stopped` stands for no symbol: the depth, the container and the symbols of a stack are those of the states below it.

## What tables can have besides the base

Each is a function of `recovery-tables.ts` that takes tables and returns tables that read every text as before, until a new cell is changed. They can be called in either order.

- `addFirstOnLineFlag(tables)`: every cell gets a second copy, at `cell + cellsPerCopy`, which a token reads when it is the first on its line, i.e. a line feed stands between it and the token before it. The flag opens no frozen cell: it gives every open cell a second copy. The display table is not doubled.
- `addTerminals(tables, [{name, codePoint}])`: a BADCHAR token of a picked code point is read as a terminal of its own, e.g. the `&` that is left of a broken `&&`. The scanner stays frozen. The new terminal's column starts as a copy of BADCHAR's and is open in every state. `picked-terminals.ts` holds the rule that picks code points from the train samples alone, with the two thresholds of the JSON side: on 20,000 train samples it picks `:` `&` `|` `'` and `\`.
- `withoutEndEarly(tables)`: the switch that leaves "end an item early" out of every list.

## The rules of a run

`recovery-parser.ts` is the exact parser and the reference for these rules. `runRecoveryParser(text, tables)` returns what every token is shown as, the reductions, the open cells that were read, and more.

1. Up to the first error only frozen cells are read. So no choice changes what a text gets before its first error, where that error is, or whether the text is valid.
2. From the first read of an open cell on, a token gets at most 16 steps. A 17th step is a skip of the token, whatever the cell holds.
3. A step that would put more than 520 states on the stack is a skip of the token too.
4. Skipping the end of input ends the run, and so does the accept.

**One place where the base is not the parser as it is.** Where bison makes 16 or more default reductions at the first error's token before it reports, rule 2 skips the token first, and the parser goes on in the state it is in. 2 of the 6,740 texts of `check-parser.ts` are such texts, and none of the 5,000 validation samples.

How the ground rules are checked, in `check-parser.ts`, on 6,740 texts: valid programs, damaged programs, random sentences of the grammar and their damaged copies, texts that are no programs, the highest stacks that 512 code points can make, and broken train samples.

- With no open cell changed, in 5 layouts, the parser has the plain parser's verdict, first error, stack there, shifts and reductions, and its output at every code point before the first error. `../check-tools.ts` compares the plain parser with bison's generated C code.
- With a random choice in every open cell and a random kind in every open display entry, 36 settings, 242,640 runs: nothing before a first error changes, the first error and the verdict stay, the stack is a path of the automaton after every step with `stopped` only on top, and no token takes more than 16 steps. Both limits are met: 228,436 tokens are skipped after 16 steps and 18 at the limit of the stack.
- Tables with one frozen cell changed are seen: each of 40 gives some text another output before its first error.

## How a recovery is scored

A score counts the kept code points from the first error's token on, all of them. A kept code point has the labels of its counterpart in the original.

- **All three**: the code points whose token is shown with the label's display kind, depth and container. With it, **whole**: the samples with every scored code point right.
- **Stack**: the code points whose token is taken on the symbols that the original's stack holds there. A skipped token is not taken, so it is wrong here. White space and comments are right when the stack as it is holds the original's symbols.
- **Constituents**: every reduction gives a nonterminal and the first and the last kept token that it covers, and an item that is ended early counts as a reduction. "Found" is the share of the original's constituents that the recovered parse has, and "right" the share of the recovered parse's constituents that the original has. Both are given twice: over all constituents, and without the ones that the parser has before it reads the first open cell. The second pair is the one that tables can change, e.g. the parser as it is has 41.4% found over all and 1.3% without.
- Also counted: the tokens that a recovery inserts, per sample.

The stack and the constituents are read off the grammar. Nothing trains on them.

Two routes give the same counts, and `check-score.ts` compares all 17 of them for 15 tables on 2,200 samples:

- `scoreTables(tables, packedSamples)` runs the loop of `score.ts` from the first error on. The same loop is the search's.
- `scoreTablesByExactParser(tables, samples)` runs the exact parser on the whole text and counts code point by code point with the functions of `../sample.ts`.

The same check repairs five samples by hand with one cell each, e.g. `let x = (1 + 2 let y = 3` with "end the atom early" at `let`, and each then has every scored code point right in all three and in the stack, and exactly the original's constituents. And 400 programs with a `#` between two tokens are right everywhere with tables that skip every BADCHAR.

What a score does not count: the kept code points before the first error that are shown with another label than the original's, 10.7% of them in the validation samples (`bars.ts` prints the count). No tables change them.

One output per token allows at most 96.99% of all three on the 5,000 validation samples of the real dataset, and 642 of them cannot be whole. The count is `scoredOutOfReach` of `../stats.ts`, and `packSamples` holds it per sample as `bound`: a parser of the experiment shows a token with one kind, shows white space as white space, and shows a token and the white space after it with one depth and one container. E.g. a token can hold kept code points of two tokens of the original, and the spaces on both sides of a removed `then` are one run of white space with two containers. It is an upper bound and no more: frozen cells are followed after the first error too, and frozen display entries show what they show, so more is out of reach of every table than this count says. The search per sample below is the lower bound of what the list of choices can do.

`describeTotals` prints, next to the inserted tokens, the tokens that were skipped after 16 steps, and how many of them took all 16 steps at frozen cells. The two numbers go together: tables can skip a token by going in a circle, e.g. insert an empty definition and drop it again until the steps are used up, and every round counts as an inserted token. A token whose 16 steps were all at frozen cells is another case: the grammar's own reductions used the steps up, e.g. at a token that closes a chain of 16 `else if`. No token of the originals of the validation samples reads more than 14 cells, and a program with a longer chain has such a token.

### A parser that is no table

`scoreOutputs(samples, parse)` scores any parser. `parse(sample)` returns a `ParserOutput`: per token of `sample.tokens` the display kind, the depth, the container, the hash of the symbols on the parser's stack (`stackHashOfSymbols` of `../labels.ts`) and whether the token was taken, then every reduction of the parse as (nonterminal, first token, last token), and the number of inserted tokens. `panicMode` in `bars.ts` is an example. For a parser that drops tokens, `kindsOfDroppedTokensByCount(trainSamples, parse)` gives the kind per terminal that the most code points of the dropped tokens want, which is the count that every bar may use.

### Columns for the final table

`columns.ts` holds columns that a review of the foundation asked for next to "all three" and "whole". They are read off a `ParserOutput`, so every row can have them: `columnsOfOutputs(samples, parse)` returns the counts and, per sample, the scored code points with all three right.

- **All three near the damage.** More than half of the scored code points stand in a later definition that the damage did not touch (53.7% on validation), and any recovery that finds the next `let` has them right. `untouchedLaterDefinitions(sample)` marks them: a definition at the top of the original that starts after the first error's position, whose code points all stand side by side in the broken text, with its `let` a token of its own. The column is "all three" over the other scored code points.
- **Every token right.** The samples in which every scored code point of a token that is no white space and no comment has all three right. White space keeps the original's label, which no table can show after added text, so "whole" alone undercounts the samples that a reader would call right.
- **Inside open strings and open comments.** The scored code points inside a token that is an open string or an open comment, counted apart: such a token stands over text that had several labels, and a table has one display kind for it.
- `samplesAhead(left, right)`: for two rows on the same samples, in how many samples each has more right. On a set of 200 cases one point of all three is two or three cases.

`check-columns.ts` checks the marks on programs by hand and the counts against `scoreOutputs`.

## The bars that need no author

`bars.ts`, on the 5,000 validation samples, with the counts made on 5,000 train samples:

| parser | all three | whole | stack | constituents found, right | the same without the ones before the first error |
| --- | --- | --- | --- | --- | --- |
| the parser as it is | 1.34 | 0.10 | 0.08 | 41.4, 95.4 | 1.3, 41.1 |
| skip every rejected token, with the count | 27.16 | 11.02 | 23.67 | 62.7, 94.1 | 37.2, 87.7 |
| panic mode, with the count | 56.53 | 24.52 | 52.53 | 86.6, 96.5 | 77.5, 93.1 |
| panic mode that keeps the reductions made at a rejected token, with the count | 55.56 | 20.96 | 52.20 | 88.4, 96.3 | 80.4, 95.0 |
| the nearest table to panic mode: pop where bison reports, with the count | 52.73 | 11.56 | 49.38 | 79.5, 92.4 | 65.5, 87.3 |

- **Skip** is a table: `skip` in every open cell that holds `stop`.
- **Panic mode** is no table, since it looks at the whole stack: where the grammar's table rejects a token, the stack is cut down to the highest part from which the token can be shifted, and the token is dropped when no part can. An LALR parser reduces before it sees that a token has no action. The bar cuts down the stack from before the token was read, which undoes those reductions and has more right than the variant that keeps them.
- Without the count, every dropped token is shown as an error: 26.32 for skip and 56.10 for panic mode.

## The search, the count, and the search per sample

- `search/search.ts`: for one open cell at a time, try every choice of its list in the exact parser on the train samples and keep the best, over all 2,351 cells, until a pass changes nothing or a limit of passes. A choice is better when more code points have all three right, or as many and more labels are right one by one. The order is from the most read cell down, or random with `--order <seed>`. `searchCells(start, cells, packedTrain, options)` is the function, for any start tables and any list of cells.
- `search/count.ts`: `displayEntriesByCount(tables, packedTrain)` gives every open display entry the kind that the most train code points want there, among the code points whose depth and container are right. For the choices that the cells hold, no other display table has more train code points right.
- `search/per-sample.ts`: a search per sample, in which a cell may hold another choice at every read. It shows what the list of choices can express. It is a beam, so its number is what the list can at least do: a beam of 64 runs loses the run of searched tables in 5 to 10 of 100 samples, and `searchPerSample` can take those runs in.

A short run, to show that the pieces work:

| run | validation: all three | whole | stack | time |
| --- | --- | --- | --- | --- |
| 4 passes from the base, then the count | 84.22 | 42.64 | 76.56 | 14 s with loading |
| until a pass changes nothing, with the count in turns: 16 passes, 3 counts | 84.43 | 43.38 | 74.75 | 30 s |
| with the flag, 4 passes, then the count | 85.50 | 42.78 | 76.40 | 16 s |
| with the flag, random order of seed 1, 4 passes, then the count | 85.67 | 44.54 | 76.32 | 14 s |
| a search per sample, beam of 64, 1,000 validation samples | 94.77 | 64.50 | | 13 s |
| the same without "end an item early" | 92.41 | 49.00 | | 12 s |

Times, on 4 worker threads of an 18 core machine with other jobs running: 40,000 train samples are made and packed in 3.8 s and take 68 MB. `scoreTables` on them takes 0.2 s, and the loop alone 0.07 s. A pass of the search takes 1.5 to 2 s. The search gives the same tables with 1, 2 and 4 worker threads.

## A report on saved tables

`report.ts --tables <file>` prints the scores, the inserted tokens per sample, and the open cells and display entries that the most samples read, with what each holds in words (`words.ts`), e.g. for the searched tables:

```
-   556    576  after `if expression`, in an expression, at `else`: insert `then` (the parser as it is: stop)
-   427    442  after `let binding`, in an expression, at `let`: end the expression early, as `let binding` without `in expression` (the parser as it is: stop)
-   513   3971  in the state stopped, at `in`: leave the state stopped and read the token again (the parser as it is: skip the token)
```

A state is named by the top of the stack: the symbols before the dot of the longest item of its kernel, which every stack in that state ends with. The two numbers are the samples that read the cell and the reads.

## In code

```ts
import {itemDot, itemRule, symbolOf} from '../tables.ts'
import {loadPacked} from './data.ts'
import {baseTables, bison, cellOf, choicesOf, insertOf, saveTables} from './recovery-tables.ts'
import {scoreTables, sharesOf} from './score.ts'

const tables = baseTables()
const validation = loadPacked('validation', 5000, tables)
// After `if expression`, at `else`: insert `then`. The state is the one with the item `expr: IF expr . THEN expr`.
const state = bison.stateKernel.findIndex(kernel => kernel.some(item => bison.ruleRhs[itemRule(item)]![0] === symbolOf('IF') && itemDot(item) === 2))
const cell = cellOf(tables, state, symbolOf('ELSE'))
if (!choicesOf(tables, cell).includes(insertOf(symbolOf('THEN')))) throw new Error('not a choice of this cell')
tables.choice[cell] = insertOf(symbolOf('THEN'))
console.log(sharesOf(scoreTables(tables, validation).score).allThree)
saveTables(`${process.env['RECOVERY_LR_SCRATCH']}/one-cell.json`, tables, 'one changed cell')
```

For a twin: `choicesOf(tables, cell)` is a cell's list, with the base's choice in it. `effectOf(choice, state)` says what a choice does: how many states it drops, the nonterminal whose goto or the state that it pushes, and whether it takes the token. `applyChoice(stack, choice)` does one step on a stack of states in place. `changeableCellsOf(tables)` are the cells to train, and `tables.displayOpen` the entries. `PackedSamples` of `data.ts` hold per sample the stack at the first open cell, the tokens from there on with the flag, and per token how many kept code points want which kind, depth, container and stack. Snapped tables are a copy of the base with other choices, and `checkTables` refuses what is not in a cell's list.

## Commands

Run from the repo root. `RECOVERY_LR_SCRATCH` is a folder outside the repo. Tables and logs go to `<RECOVERY_LR_SCRATCH>/learn/`.

```sh
export RECOVERY_LR_SCRATCH=<a folder outside the repo>
bun lab/recovery-lr/learn/check-all.ts                                   # the type check, the lint and 18 checks, one after another, eight minutes or more
bun lab/recovery-lr/learn/check-all.ts --only check-score                # one of them
bun lab/recovery-lr/learn/bars.ts                                        # the bars without an author
bun lab/recovery-lr/learn/score.ts [--tables <file.json>] [--split train]
bun lab/recovery-lr/learn/columns.ts [--tables <file.json>] [--split train]   # the columns for the final table
bun lab/recovery-lr/learn/search/search.ts --passes 4 --count            # search-count.json and .log
bun lab/recovery-lr/learn/search/search.ts --flag --order 1 --passes 4 --count
bun lab/recovery-lr/learn/search/search.ts --in-turns                    # until a pass changes nothing, with the count in turns
bun lab/recovery-lr/learn/search/search.ts --from <file.json> --out <file.json> --passes 4   # from any saved tables
bun lab/recovery-lr/learn/search/per-sample.ts --count 1000 [--width 256] [--tables <file.json>] [--without-end-early]
bun lab/recovery-lr/learn/report.ts --tables <file.json> [--cells 40]
bun lab/recovery-lr/learn/picked-terminals.ts                            # what the rule picks from the train samples
```

Every command takes `--train` or `--validation` or `--count` for the number of samples, and fails for an option that it does not have.

## Files

- `recovery-tables.ts`: the tables, the lists of choices, the base, the additions, `checkTables`, saving and loading, names.
- `recovery-parser.ts`: the exact parser on whole texts.
- `data.ts`: `packSamples`, `loadPacked`, `eachSample`, and `prefixOf`, the reductions and the stack before the first open cell.
- `score.ts`: the loop `runSample`, `scoreTables`, `scoreOutputs`, `Score`, `sharesOf`, `scoreRow`, `wrongBeforeFirstError`.
- `columns.ts`: `columnsOfOutputs`, `untouchedLaterDefinitions`, `samplesAhead`, `columnsRow`.
- `bars.ts`: `skipTables`, `popTables`, `panicMode`, `kindsOfDroppedTokensByCount`.
- `search/`: `search.ts` with its worker, `count.ts`, `per-sample.ts` with its worker, `check.ts`.
- `picked-terminals.ts`, `words.ts`, `report.ts`, `options.ts`.
- `check-tables.ts`, `check-parser.ts`, `check-score.ts`, `check-columns.ts`, `check-commands.ts`, and `check-all.ts`, which also runs the checks of the folders below.
- `soft/`: the twin for training with 48 exact stacks, the trainer, and `../recipe.ts` next to this page, the frozen recipe as one function. Its README says what the twin is. The decision of the lead stands that row 9 is trained with this twin.
- `soft-levels/`: the second twin, a mix of states per level of the stack, in two forms. A row that is trained with it is reported apart from row 9, with the note that its form was picked after its validation score was seen.
- `bars/`: the hand-made bars and the bars that look ahead, each with a README: `yacc/`, `panic/`, `rules/`, `repair/`, `tree-sitter/`.

## Not settled

- **The end of input.** Its 58 open cells keep the base, so a parse that is still open at the end stays open, and the constituents that only the end would close are not found. A hand-written table may set those cells. The three main values do not see them.
- **The search per sample is a beam.** With 256 runs it finds 95.7% of all three where 64 runs find 94.4%, on 400 validation samples. What the list cannot express is not shown by it.
- **Numbers on the real dataset.** A saved file holds a key of the dataset's source files, i.e. of `../dataset.ts` and every file that it imports, so tables of the stand-in generator are named as such once the real generator is in place: `report.ts`, `score.ts` and `per-sample.ts` print a line that starts with "Note:", and `search.ts --from` refuses them.
- **The rule of 16 steps cuts the base** where bison reduces 16 times or more at the first error, see above.
