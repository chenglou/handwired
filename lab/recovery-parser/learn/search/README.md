# The open cells filled without gradients: votes and a search

Training by gradients has to be compared with something plain, or its result means nothing. This folder fills the open cells of the recovery tables in two plain ways and scores both in the exact parser: by votes of the train samples (`votes.ts`), and by a search that tries the choices of one cell at a time (`search.ts`). Neither reads the test split. The words cell, frozen, open and choice are the ones of [the shared core](../README.md).

Every number here is preliminary: the dataset is a snapshot that a reviewed version will replace. The numbers come from the standard set (seed 20261015, samples 0 to 59,999): 41,289 broken train samples with 5,455,335 labeled code points at or after the first damage, and 5,203 broken validation samples with 681,596.

## Results

"All three" is the main number: the percentage of the labeled code points at or after the first damage with the display kind, the depth and the container right. The other columns are the validation split's display kind, depth, container, and samples that are right as a whole.

| tables | cells that differ from today's | train, all three | validation, all three | kind | depth | container | whole samples |
| --- | --- | --- | --- | --- | --- | --- | --- |
| today's tables | 0 | 41.03 | 40.80 | 47.74 | 74.62 | 88.43 | 11.64 |
| votes | 175 | 65.16 | 65.32 | 77.49 | 75.54 | 88.80 | 59.13 |
| votes, `--follow` | 275 | 77.61 | 78.06 | 86.29 | 85.54 | 96.08 | 62.71 |
| votes, `--stay` | 410 | 64.72 | 64.46 | 71.97 | 81.52 | 92.88 | 48.91 |
| votes, `--follow --stay` | 546 | 72.44 | 72.23 | 78.31 | 88.18 | 96.40 | 59.40 |
| search from today's tables | 896 | 93.71 | 93.37 | 95.39 | 97.49 | 99.49 | 66.74 |
| search from today's tables, `--order 1` | 882 | 94.60 | 94.28 | 96.36 | 97.60 | 99.61 | 67.49 |
| search from today's tables, `--order 2` | 944 | 94.57 | 94.25 | 96.42 | 97.38 | 99.54 | 66.62 |
| search from the votes | 783 | 83.59 | 83.44 | 88.96 | 90.11 | 97.27 | 62.79 |
| search from the votes with `--follow` | 866 | 85.17 | 85.10 | 89.68 | 91.83 | 98.17 | 50.57 |

The best tables on the validation split are the ones of `--order 1`. They are ahead of `--order 2` by 0.03 points, which is no difference.

The same tables by group, validation split, all three:

| validation samples | today's | votes | votes, `--follow` | search | search, `--order 1` | search from the votes |
| --- | --- | --- | --- | --- | --- | --- |
| all, 5,203 | 40.8 | 65.3 | 78.1 | 93.4 | 94.3 | 83.4 |
| damage, 4,061 | 37.8 | 60.7 | 75.1 | 92.7 | 93.8 | 81.1 |
| typing, 1,142 | 59.2 | 93.9 | 96.4 | 97.3 | 97.4 | 98.0 |
| reachable: yes, 4,046 | 39.9 | 64.0 | 75.0 | 94.5 | 95.3 | 81.6 |
| reachable: line rule, 652 | 60.2 | 86.0 | 96.1 | 97.8 | 98.4 | 97.0 |
| reachable: no, 505 | 20.0 | 45.9 | 77.6 | 77.2 | 79.3 | 79.5 |
| needs a class, 588 | 7.9 | 25.0 | 30.7 | 82.5 | 85.9 | 43.5 |
| needs no class, 4,615 | 48.2 | 74.4 | 88.8 | 95.8 | 96.2 | 92.5 |

The rows per family and per kind of damage are in the output of `../score.ts` for each of the saved tables.

What the numbers say:

- **The search is the number to beat.** It ends at 93.4% to 94.3% on the validation split, against 40.8% today, in 4 to 5 minutes on 4 threads. Train and validation are 0.3 points apart.
- **The votes get half of the way.** The walk as specified ends at 65.3%, and at 78.1% when it follows frozen cells. On the typing replays the votes are within 4 points of the search, and where the damage cannot be undone from left to right (reachable: no) the followed votes are within 2 points of it.
- **Where the search starts and in which order it goes decides where it ends.** Three orders of the cells end 0.9 points apart. From the votes the search ends 9.9 points lower than from today's tables. 7.2 of those points are in the samples that need a class, which hold 18.4% of the code points: 43.5% against 82.5%. With every pair of a tokenizer cell as a choice it is slower per pass and was at 90.2% when its budget ended. So the search's score is one of many places where single cells cannot be improved, not the best that the open cells can hold. A gradient run that ends above 94.3% shows something that this search does not find, and a run that ends below it is not at the limit of the tables.
- **The search's tables do not read like a recovery.** The votes change 175 to 275 cells, and many of them read like a rule, e.g. (commaOrClose, string, depth 1, object) goes to `colon`, which is what a missing comma needs (327 votes in the walk as specified, 4,406 with `--follow`). The search changes 880 to 950 cells and uses the tokenizer's states as memory without regard to their names, e.g. with the default order (between, plus) holds (integer, end) and (errorLine, other) holds (fraction, stringContent). 4.0% of the wrong code points of the best tables are punctuation shown as "past the end", a display kind that no code point of a text has: the search used the event `end` for its token.
- **Samples that are right as a whole** are closer together than code points: 59.1% for the votes, 62.7% for the followed votes and 66.6% to 67.5% for the search.

## The votes

`votes.ts` walks every broken train sample with the parser forced onto the intended state (`../intended.ts`) after every kept code point. Where the walk knows the state before a kept code point and the cell that the code point reads is open, the sample votes for the choice that gives the intended state after the code point: a tokenizer cell's next state and event as one choice, a grammar cell's next state and stack action as one choice. Each cell takes its most voted choice. Of several choices with the same votes, today's wins. A cell without votes keeps today's choice.

The votes change 175 cells: 136 of the 710 open tokenizer cells and 51 of the 616 open grammar cells get votes, 187 of 1,326. There are 95,744 votes, and 77.3% of them are for the choice that their cell took. The most contested cell is (between, other), which every letter without a class of its own reads between tokens, and so do the apostrophe and the curly quotes: 41,210 votes for (string, stringStart), 9,355 for (between, whitespace) and 8,795 for (string, stringContent).

Most code points give no vote. Of the 5,899,536 code points at or after the first damage of the broken train samples:

| what the walk does with the code point | code points |
| --- | --- |
| added by the damage, so there is no intended state after it | 444,201 |
| kept, right after an added one: the walk does not know the state before it | 36,994 |
| kept, with a known state before | 5,418,341 |

And of those 5,418,341, once per table:

| the cell that the code point reads | tokenizer | grammar |
| --- | --- | --- |
| is frozen and gives the intended state | 5,256,882 | 5,344,074 |
| is frozen and gives another state than the intended one | 77,112 | 62,703 |
| is open: a vote | 84,347 | 11,397 |
| is open, and no single stack action gives the intended stack | | 167 |

The situations without a vote, with an example each:

- **An added code point**, e.g. every code point of a comment. The damage added it, so it has no counterpart in the original and no intended state.
- **A kept code point right after an added one.** The state between the added code points is anyone's guess, so the walk does not know which cell the kept code point reads. The walk goes on from the intended state after it.
- **A frozen cell that gives another state than the intended one.** This is the largest loss. E.g. in `{"a": 1 "b": 2}` the space after the `1` keeps the grammar in commaOrClose, and the intended state after the space is `key`, since the original has a comma there. The walk is forced onto `key`, so the quote reads (key, string), which is frozen. The cell that the parser reads at the quote, (commaOrClose, string), gets no vote from this sample. The same happens after a replaced code point of another class, e.g. the closing `'` of a string reads (string, other), which is frozen and stays in the string.
- **No single stack action**, e.g. the first kept code point after a removed part that closed two containers. 167 code points.

Two options change the walk. Both go beyond "forced after every kept code point", and both are guesses that the scores have to judge:

- `--follow`: after a frozen cell the walk goes on from what the frozen cell gives, not from the intended state, since no choice of the open cells changes what a frozen cell gives. In the example above the quote then reads (commaOrClose, string) and votes for the next state `colon`. An added code point that reads two frozen cells is followed the same way, e.g. the added comma of `[1,]`.
- `--stay`: an added code point that reads an open cell votes for the choice that leaves the state as it is. This is right for a comment and wrong for the first quote of a string that the damage quoted twice.

## The search

`search.ts` starts from today's tables, or from saved tables with `--from`. For one open cell at a time it tries the cell's choices in the exact parser on the train split and keeps the best one, and it goes over all 1,326 open cells again until a pass changes nothing or the budget ends. It scores the validation split after every pass, for the log only.

- **The score of a choice** is two counts over the train split: the code points with all three labels right, and the labels that are right one by one. A choice is better when the first count is higher, or the first is the same and the second is higher. The second count lets the search keep a step that e.g. gets the depth right before another cell gets the display kind right.
- **The choices of a grammar cell** are all 32 pairs of a next state and a stack action (a stack action that does what the cell's token does by itself is kept as `by token`, so there are four). **The choices of a tokenizer cell** are, with `--pairs known`, every other next state with the event the cell holds, every other event with the next state the cell holds, and every pair that some cell of today's tokenizer table holds, e.g. (string, stringStart): about 90 choices. `--pairs parts` leaves the known pairs out, and `--pairs all` tries all 650 pairs.
- **The order** of a pass is from the cell that the most samples read to the least read one. `--order <seed>` takes a random order.
- **What makes it fast**: only a sample whose run reads the cell can change, and only from its first read of the cell on. Each worker thread keeps one bit per sample and cell that says whether the sample's run reads the cell, and runs a sample again only from the state before that first read. The part of a sample before its first error is never run again. Up to four worker threads each take a share of the samples. All counts are whole numbers and every worker gets the same changes in the same order, so the result does not depend on the number of workers.
- **The budget** is a count of sample runs (`--runs`, in millions), not a time, so a rerun stops at the same step. A second stop by the clock (`--minutes`) is there for a slower machine, and the log says when it is the one that stopped the search.

`sample-runs.ts` holds the parser loop of the search. It has to count what `../score.ts` counts, and `check.ts` compares the two. The search also compares its running counts with `scoreTables` after every pass.

How far the runs got:

| run | how it ended | runs of a sample | time | validation, all three |
| --- | --- | --- | --- | --- |
| from today's tables | pass 19 changed nothing | 724.5 million | 288 s | 93.37 |
| from today's tables, `--order 1` | pass 21 changed nothing | 775.8 million | 285 s | 94.28 |
| from today's tables, `--order 2` | pass 18 changed nothing | 727.1 million | 239 s | 94.25 |
| from the votes | pass 12 changed nothing | 164.9 million | 61 s | 83.44 |
| from the votes with `--follow` | pass 18 changed nothing | 329.1 million | 114 s | 85.10 |
| from today's tables, `--pairs all` | the budget of 1,400 million runs, in pass 7, after 87 of the 1,326 cells | 1,400.0 million | 497 s | 90.23 |
| from today's tables, `--pairs parts`, `--passes 1` | the limit of 1 pass | 17.2 million | 6 s | 80.37 |

- From today's tables the first pass alone goes from 41.0% to 83.6% on the train split, and the passes after it add 2.7, 4.3, 2.4 and 0.4 points. From pass 9 on a pass changes fewer than 100 cells and adds 0.03 points or less.
- The first step is the largest: the grammar cell (error, none, depth 1, object) goes from `error` to `colon`, which gets 827,390 more code points right, 15 points. After an error in an object at depth 1, every code point without a token then moves the grammar to `colon`, where string content is shown as a key. Today no key after a first error is shown as a key.
- Two runs with the same options give the same tables: the run from today's tables was made twice. One, two and four worker threads give the same tables after two passes, in 58, 32 and 18 seconds.
- With `--pairs all` a pass costs six times as many runs and gains less: after 5 passes the train split is at 88.4%, where `--pairs known` is at 93.4%. More choices per cell did not make better steps here.

## What is still wrong

`mistakes.ts` counts the wrong labels on the validation split and prints samples for reading. The best tables (`--order 1`) are wrong at 38,963 of 681,596 code points, 5.72%, in 1,572 of 5,203 samples. Only the display kind is wrong at 57.9% of those code points and only the depth at 33.3%. A key shown as a string is 24.9% of them, and a string shown as a key 12.2%.

What 30 of those samples show (drawn by `--count 30`, and 30 more from the run with the default order, which show the same):

- **Quotes and words that the 33 classes lump with letters, 11 of 30.** An apostrophe, a curly quote and the first letter of a key without quotes all read the cells of a letter. The tables show the first one or two letters of such a key as a string, e.g. `'jsonrpc'` as `sskkkkkkk`, or single letters inside a string switch its kind. Each sample has scattered wrong display kinds, 1 to 40 of them, and hardly any such sample is right as a whole: 2.2% of the samples that need a class, at 85.9% of their code points.
- **A string left open in the middle of a line, 7 of 30**, e.g. `"module":"no"strict":true`. Between 1 and 13 code points around the place are wrong, and the rest of the text is right again.
- **A depth that is off by one for a long stretch, 3 of 30, with 13, 103 and 116 wrong code points.** After a missing closing bracket the depth stays one too high (missingCloser: 64.6% with all three right, the depth at 64.8%). And text that the damage added can push a level: two comment lines before a document leave all of it one level too deep.
- **Words of another notation, 2 of 30**: the letters of `True`, `None` and `NULL` are shown as a string.
- **The rest, 7 of 30**: a backslash that should have been doubled and a document with a backslash before every quote (2), a key shown as a string right after a block comment, a missing opening quote, a doubled quote, a quote without its backslash, and `=>` for the colon, after which every value is shown as a key.

By group, the lowest are reachable: no at 79.3%, the family of bracket damage at 69.2%, and needs a class at 85.9%.

## Damage that the search has not seen

The test split holds kinds of damage that training never sees, and nothing here reads it. To get a first idea without it, one search left four kinds out of its train samples, one from each family of the held-out kinds, and the validation samples of those kinds were scored:

```sh
bun lab/recovery-parser/learn/search/search.ts --without-kinds hashComment,foreignLiteral,statementWrapper,newlineDelimited
```

It ended when pass 26 changed nothing, after 534.0 million runs and 163 s, with 37,008 of the 41,289 broken train samples. Validation split, all three:

| kind, validation samples | today's | search with the kind | search without the kind |
| --- | --- | --- | --- |
| hashComment, 21 | 33.4 | 91.9 | 89.5 |
| foreignLiteral, 251 | 13.2 | 83.8 | 74.6 |
| statementWrapper, 196 | 7.1 | 92.0 | 81.8 |
| newlineDelimited, 123 | 49.0 | 95.6 | 87.3 |
| all, 5,203 | 40.8 | 93.4 | 91.7 |

The kinds that the search did not see lose 2 to 10 points and stay far above today's tables. How much of the loss is the missing kind is not settled by one run: callWrapper stayed in the train samples and differs as much between the two searches, 91.9% and 82.4%, and three orders of the cells already end 0.9 points apart on all samples.

## Commands

Run from the repo root, with `RECOVERY_SCRATCH` set to a folder outside the repo as in the core's README. Tables and logs go to `$RECOVERY_SCRATCH/search/`.

```sh
bun lab/recovery-parser/learn/search/check.ts                                  # the search counts what score.ts counts, about 15 s
bun lab/recovery-parser/learn/search/votes.ts                                  # votes.json, under 1 s after the samples are loaded
bun lab/recovery-parser/learn/search/votes.ts --follow                         # votes-follow.json; also --stay, and both
bun lab/recovery-parser/learn/search/votes.ts --cells                          # also lists every cell with votes and how they split
bun lab/recovery-parser/learn/search/search.ts                                 # search-from-today.json and .log
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/search/votes.json          # search-from-votes.json
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/search/votes-follow.json   # search-from-votes-follow.json
bun lab/recovery-parser/learn/search/search.ts --order 1                       # the cells of a pass in a random order: search-from-today-order-1.json
bun lab/recovery-parser/learn/search/search.ts --pairs all --out $RECOVERY_SCRATCH/search/search-pairs-all.json   # every pair of a tokenizer cell
bun lab/recovery-parser/learn/search/search.ts --without-kinds hashComment,foreignLiteral,statementWrapper,newlineDelimited
bun lab/recovery-parser/learn/score.ts --tables $RECOVERY_SCRATCH/search/search-from-today.json --cells   # every breakdown, and the cells
bun lab/recovery-parser/learn/search/mistakes.ts --tables $RECOVERY_SCRATCH/search/search-from-today-order-1.json --count 30   # wrong samples, for reading
```

## Files

- `votes.ts`: `countVotes`, `tablesOfVotes`, and the command.
- `search.ts`: the search's main thread: the order of the cells, the choices to try, the budget, the log, the checks after every pass.
- `search-worker.ts`: a worker thread: its share of the samples, which cells each sample reads, and the tries.
- `sample-runs.ts`: the samples as the search holds them, and the parser loop that only computes a sample's score, from the first position that reads an open cell or from the first read of one cell.
- `check.ts`: the search's loop against `../score.ts`.
- `mistakes.ts`: counts of the wrong labels and samples in fixed width, for reading.
