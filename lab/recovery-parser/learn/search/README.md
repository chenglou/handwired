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
| search from today's tables | 904 | 94.04 | 93.69 | 95.67 | 97.56 | 99.53 | 67.22 |
| search from today's tables, `--order 1` | 865 | 94.85 | 94.47 | 96.70 | 97.46 | 99.61 | 67.92 |
| search from today's tables, `--order 2` | 951 | 94.92 | 94.62 | 96.70 | 97.56 | 99.57 | 66.56 |
| search from the votes | 744 | 83.34 | 83.19 | 88.78 | 89.91 | 97.39 | 62.77 |
| search from the votes with `--follow` | 845 | 85.03 | 84.91 | 89.58 | 91.84 | 98.17 | 47.82 |
| the hand-written tables of `../handwritten`, for comparison | 915 | 95.20 | 95.49 | 98.25 | 96.93 | 99.26 | 73.15 |
| search from the hand-written tables | 977 | 96.74 | 96.54 | 98.65 | 97.60 | 99.37 | 68.31 |

The same tables by group, validation split, all three:

| validation samples | today's | votes | votes, `--follow` | search | search, `--order 2` | search from the votes | search from the hand-written tables |
| --- | --- | --- | --- | --- | --- | --- | --- |
| all, 5,203 | 40.8 | 65.3 | 78.1 | 93.7 | 94.6 | 83.2 | 96.5 |
| damage, 4,061 | 37.8 | 60.7 | 75.1 | 93.1 | 94.2 | 80.7 | 96.4 |
| typing, 1,142 | 59.2 | 93.9 | 96.4 | 97.1 | 97.2 | 98.5 | 97.2 |
| reachable: yes, 4,046 | 39.9 | 64.0 | 75.0 | 94.7 | 95.7 | 81.1 | 98.6 |
| reachable: line rule, 652 | 60.2 | 86.0 | 96.1 | 98.4 | 98.2 | 97.1 | 98.8 |
| reachable: no, 505 | 20.0 | 45.9 | 77.6 | 78.1 | 79.4 | 80.4 | 75.5 |
| needs a class, 588 | 7.9 | 25.0 | 30.7 | 82.7 | 86.7 | 42.3 | 96.3 |
| needs no class, 4,615 | 48.2 | 74.4 | 88.8 | 96.2 | 96.4 | 92.4 | 96.6 |

The rows per family and per kind of damage are in the output of `../score.ts` for each of the saved tables, and `../compare.ts` prints several tables side by side.

What the numbers say:

- **Where the search starts decides where it ends, and the best start so far is the hand-written tables.** From today's tables three orders of the cells end at 93.7%, 94.5% and 94.6% on the validation split. From the votes the search ends at 83.2%, more than 10 points lower, and most of that is in the samples that need a class: 42.3% against 82.7%. From the hand-written tables it ends at 96.5%: 1.0 point above the tables it started from, and 1.9 above the best search from today's tables. So no search here is at the limit of the cells, and each is one of many places where no single cell can be improved.
- **The number to beat is 96.5%, not 94.6%.** A gradient arm without added states that ends below the search from the hand-written tables has found nothing that a plain search does not find. Train and validation are 0.1 to 0.4 points apart for every search.
- **The votes get half of the way.** The walk as specified ends at 65.3%, and at 78.1% when it follows frozen cells. On the typing replays the votes are within 4 points of the search, and where the damage cannot be undone from left to right (reachable: no) the followed votes are within 2 points of it.
- **The search's tables do not read like a recovery.** The votes change 175 to 275 cells, and many of them read like a rule, e.g. (commaOrClose, string, depth 1, object) goes to `colon`, which is what a missing comma needs (327 votes in the walk as specified, 4,406 with `--follow`). The search changes 860 to 950 cells and uses the tokenizer's states as memory without regard to their names, e.g. with the default order (between, slash) holds (tr, stringContent) and (string, lineFeed) holds (integer, whitespace).
- **Samples that are right as a whole** are closer together than code points: 59.1% for the votes, 62.7% for the followed votes, 66.6% to 67.9% for the search from today's tables, 68.3% for the search from the hand-written tables, and 73.2% for the hand-written tables themselves, which the search lowers while it raises the code points.

What the main number does not show, for the same tables on the validation split (the columns of `../compare.ts`, and `../check-deep.ts`):

| tables | added code points shown as an error | samples that show an error | wrong depths on valid JSON of 17 to 19 levels |
| --- | --- | --- | --- |
| today's tables | 89.5% | 59.5% | 0% |
| votes | 7.1% | 13.4% | 0% |
| votes, `--follow` | 1.5% | 1.2% | 0% |
| search from today's tables | 0.3% | 5.5% | 75.1% |
| search, `--order 1` | 2.7% | 22.0% | 72.1% |
| search, `--order 2` | 5.3% | 33.6% | 53.5% |
| search from the votes | 0.3% | 11.7% | 84.0% |
| hand-written | 0.0% | 0.0% | 0% |
| search from the hand-written tables | 0.3% | 4.7% | 33.6% |

- **Errors.** A code point that the damage added has no label, so tables lose nothing in the main number by showing no error at all. Which of the search's tables still show errors is an accident of the order of the cells.
- **Valid JSON that is too deep.** A valid JSON text of 17 levels or more has a first error at its 17th opening bracket, and reads open cells from there on. Today's parser keeps its depth right at every code point, since the depth is a count of brackets. Every search loses that: the depth is wrong at a third to five sixths of the code points after the 17th bracket, of 300 such texts. The dataset has no such text, so the search's score does not see it. The votes change no cell that these texts read.
- **No code point is shown as "past the end".** The first version of this search also tried the three events of a text's end in a tokenizer cell, to give the grammar the token `end`. A code point with such an event is shown as the cells after a text are, which no recovery would show for a character of the text: the three orders then showed 819, 1,693 and 336 code points of the validation split so. Now these events are left out, unless `--end-events` asks for them. Leaving them out cost nothing: the three orders end at 93.7%, 94.5% and 94.6%, where they ended at 93.4%, 94.3% and 94.3% with them.

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

The third situation is why the walk as specified gets only half of the way: it is forced onto intended states that no parser of the broken text can be in. The core now marks the kept code points whose intended state can be followed (`codePointCanFollow`, see `../intended.ts`), by a walk that follows frozen cells as `--follow` does. The votes do not use the mark, so that they stay the walk as it was specified and its variants.

Two options change the walk. Both go beyond "forced after every kept code point", and both are guesses that the scores have to judge:

- `--follow`: after a frozen cell the walk goes on from what the frozen cell gives, not from the intended state, since no choice of the open cells changes what a frozen cell gives. In the example above the quote then reads (commaOrClose, string) and votes for the next state `colon`. An added code point that reads two frozen cells is followed the same way, e.g. the added comma of `[1,]`.
- `--stay`: an added code point that reads an open cell votes for the choice that leaves the state as it is. This is right for a comment and wrong for the first quote of a string that the damage quoted twice.

## The search

`search.ts` starts from today's tables, or from saved tables with `--from`. For one open cell at a time it tries the cell's choices in the exact parser on the train split and keeps the best one, and it goes over all 1,326 open cells again until a pass changes nothing or the budget ends. It scores the validation split after every pass, for the log only.

- **The score of a choice** is two counts over the train split: the code points with all three labels right, and the labels that are right one by one. A choice is better when the first count is higher, or the first is the same and the second is higher. The second count lets the search keep a step that e.g. gets the depth right before another cell gets the display kind right.
- **The choices of a grammar cell** are all 32 pairs of a next state and a stack action (a stack action that does what the cell's token does by itself is kept as `by token`, so there are four). **The choices of a tokenizer cell** are, with `--pairs known`, every other next state with the event the cell holds, every other event with the next state the cell holds, and every pair that some cell of today's tokenizer table holds, e.g. (string, stringStart): about 85 choices. `--pairs parts` leaves the known pairs out, and `--pairs all` tries every pair, 572 without the events of a text's end. In each case the three events of a text's end are left out, unless `--end-events` is given.
- **The order** of a pass is from the cell that the most samples read to the least read one. `--order <seed>` takes a random order.
- **What makes it fast**: only a sample whose run reads the cell can change, and only from its first read of the cell on. Each worker thread keeps one bit per sample and cell that says whether the sample's run reads the cell, and runs a sample again only from the state before that first read. The part of a sample before its first error is never run again. Up to four worker threads each take a share of the samples. All counts are whole numbers and every worker gets the same changes in the same order, so the result does not depend on the number of workers.
- **The budget** is a count of sample runs (`--runs`, in millions), not a time, so a rerun stops at the same step. A second stop by the clock (`--minutes`) is there for a slower machine, and the log says when it is the one that stopped the search.

`sample-runs.ts` holds the parser loop of the search. It has to count what `../score.ts` counts, and `check.ts` compares the two. The search also compares its running counts with `scoreTables` after every pass.

How far the runs got:

| run | how it ended | runs of a sample | time | validation, all three |
| --- | --- | --- | --- | --- |
| from today's tables | pass 16 changed nothing | 550.1 million | 169 s | 93.69 |
| from today's tables, `--order 1` | pass 19 changed nothing | 657.5 million | 203 s | 94.47 |
| from today's tables, `--order 2` | pass 30 changed nothing | 1,230.9 million | 368 s | 94.62 |
| from the votes | pass 13 changed nothing | 170.6 million | 48 s | 83.19 |
| from the votes with `--follow` | pass 14 changed nothing | 229.7 million | 65 s | 84.91 |
| from the hand-written tables | pass 9 changed nothing | 355.3 million | 96 s | 96.54 |
| from today's tables, `--pairs all` | the budget of 1,400 million runs, in pass 8, after 138 of the 1,326 cells | 1,400.4 million | 397 s | 86.82 |
| from today's tables, `--pairs parts`, `--passes 1` | the limit of 1 pass | 16.6 million | 5 s | 80.24 |

- From today's tables the first pass alone goes from 41.0% to 83.5% on the train split, and the passes after it add 2.7, 4.1, 1.2, 1.8 and 0.4 points. From pass 10 on a pass changes fewer than 100 cells.
- The first step is the largest: the grammar cell (error, none, depth 1, object) goes from `error` to `colon`, which gets 827,390 more code points right, 15 points. After an error in an object at depth 1, every code point without a token then moves the grammar to `colon`, where string content is shown as a key. Today no key after a first error is shown as a key.
- From the hand-written tables the search changes 421 cells in 8 passes. Its first pass alone goes from 95.20% to 96.34% on the train split.
- The search gives the same tables with 1, 2 and 4 worker threads: two passes from today's tables take 54, 29 and 15 seconds, and their steps are the first two passes of the whole run, step for step.
- With `--pairs all` a pass costs five to seven times as many runs and gains less: after 5 passes the train split is at 87.7%, where `--pairs known` is at 93.3%. More choices per cell did not make better steps here.

## What is still wrong

`mistakes.ts` counts the wrong labels on the validation split and prints samples for reading. The best tables from today's tables (`--order 2`) are wrong at 36,662 of 681,596 code points, 5.38%, in 1,617 of 5,203 samples. Only the display kind is wrong at 54.2% of those code points and only the depth at 34.6%. A key shown as an error is 12.0% of them, a string shown as an error 9.7%, a key shown as a string 9.7%, and a string shown as a key 7.6%. 4,014 of the wrong code points come before the first error, where no cell changes them.

The reading below is of the first version's tables, which still tried the events of a text's end: 30 samples of its best tables, and 30 more of its default order, which showed the same. It was not repeated for the tables above.

- **Quotes and words that the 33 classes lump with letters, 11 of 30.** An apostrophe, a curly quote and the first letter of a key without quotes all read the cells of a letter. The tables show the first one or two letters of such a key as a string, e.g. `'jsonrpc'` as `sskkkkkkk`, or single letters inside a string switch its kind. Each sample has scattered wrong display kinds, 1 to 40 of them, and hardly any such sample is right as a whole.
- **A string left open in the middle of a line, 7 of 30**, e.g. `"module":"no"strict":true`. Between 1 and 13 code points around the place are wrong, and the rest of the text is right again.
- **A depth that is off by one for a long stretch, 3 of 30, with 13, 103 and 116 wrong code points.** After a missing closing bracket the depth stays one too high. And text that the damage added can push a level: two comment lines before a document leave all of it one level too deep.
- **Words of another notation, 2 of 30**: the letters of `True`, `None` and `NULL` are shown as a string.
- **The rest, 7 of 30**: a backslash that should have been doubled and a document with a backslash before every quote (2), a key shown as a string right after a block comment, a missing opening quote, a doubled quote, a quote without its backslash, and `=>` for the colon, after which every value is shown as a key.

By group, the lowest of the `--order 2` tables are the family of bracket damage at 69.1%, reachable: no at 79.4%, and needs a class at 86.7%. By kind: middleCutOut at 58.5% and missingCloser at 64.6%.

## Damage that the search has not seen

The test split holds kinds of damage that training never sees, and nothing here reads it. To get a first idea without it, one search left four kinds out of its train samples, one from each family of the held-out kinds, and the validation samples of those kinds were scored:

```sh
bun lab/recovery-parser/learn/search/search.ts --without-kinds hashComment,foreignLiteral,statementWrapper,newlineDelimited
```

It ended when pass 15 changed nothing, after 296.6 million runs and 83 s, with 37,008 of the 41,289 broken train samples. Validation split, all three:

| kind, validation samples | today's | search with the kind | search without the kind |
| --- | --- | --- | --- |
| hashComment, 21 | 33.4 | 94.2 | 91.5 |
| foreignLiteral, 251 | 13.2 | 84.3 | 78.2 |
| statementWrapper, 196 | 7.1 | 93.8 | 75.3 |
| newlineDelimited, 123 | 49.0 | 97.2 | 95.5 |
| all, 5,203 | 40.8 | 93.7 | 91.6 |

The kinds that the search did not see lose 2 to 19 points and stay far above today's tables. How much of the loss is the missing kind is not settled by one run: callWrapper stayed in the train samples and differs by 3 points between the two searches, 88.9% and 91.7%, in the other direction, and three orders of the cells already end 0.9 points apart on all samples.

Whether the dataset's own held-out kinds were seen by the hand-written rules is a separate question, see `../handwritten/README.md`: the files of samples that their builder was told to read hold test samples.

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
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/handwritten/tables.json     # search-from-tables.json: the number to beat
bun lab/recovery-parser/learn/search/search.ts --order 1                       # the cells of a pass in a random order: search-from-today-order-1.json
bun lab/recovery-parser/learn/search/search.ts --pairs all --out $RECOVERY_SCRATCH/search/search-pairs-all.json   # every pair of a tokenizer cell
bun lab/recovery-parser/learn/search/search.ts --without-kinds hashComment,foreignLiteral,statementWrapper,newlineDelimited
bun lab/recovery-parser/learn/score.ts --tables $RECOVERY_SCRATCH/search/search-from-today.json --cells   # every breakdown, and the cells
bun lab/recovery-parser/learn/search/search.ts --end-events                    # as the first version: also the events of a text's end
bun lab/recovery-parser/learn/search/mistakes.ts --tables $RECOVERY_SCRATCH/search/search-from-today-order-2.json --count 30   # wrong samples, for reading
bun lab/recovery-parser/learn/compare.ts search=$RECOVERY_SCRATCH/search/search-from-today.json votes=$RECOVERY_SCRATCH/search/votes.json   # several tables side by side
bun lab/recovery-parser/learn/check-deep.ts search=$RECOVERY_SCRATCH/search/search-from-today.json   # the depth on valid JSON of 17 to 19 levels
```

## Files

- `votes.ts`: `countVotes`, `tablesOfVotes`, and the command.
- `search.ts`: the search's main thread: the order of the cells, the choices to try, the budget, the log, the checks after every pass.
- `search-worker.ts`: a worker thread: its share of the samples, which cells each sample reads, and the tries.
- `sample-runs.ts`: the samples as the search holds them, and the parser loop that only computes a sample's score, from the first position that reads an open cell or from the first read of one cell.
- `check.ts`: the search's loop against `../score.ts`.
- `mistakes.ts`: counts of the wrong labels and samples in fixed width, for reading.
