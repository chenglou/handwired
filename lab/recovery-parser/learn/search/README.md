# The open cells filled without gradients: votes and a search

Training by gradients has to be compared with something plain, or its result means nothing. This folder fills the open cells of the recovery tables in two plain ways and scores both in the exact parser: by votes of the train samples (`votes.ts`), and by a search that tries the choices of one cell at a time (`search.ts`). Neither reads the test split, whose samples are not loaded. The words cell, frozen, open, choice and base are the ones of [the shared core](../README.md).

The numbers come from the standard set of the reviewed dataset (seed 20261015, indexes 0 to 59,999, without the test split): 40,759 broken train samples with 5,546,159 scored code points, and 4,878 broken validation samples with 675,695. A scored code point is one from the first error on whose label has a scored value, see `../README.md`. Every search and every vote is deterministic, so a row has no seed. But three orders of the cells show how much of a search's score is the order's doing: 7.5 points.

## Results

"All three" is the main number: the percentage of the scored code points with every scored label right. The other columns are the validation split's display kind, depth, container, and samples that are right as a whole.

| tables | cells changed against the base | train, all three | validation, all three | kind | depth | container | whole samples |
| --- | --- | --- | --- | --- | --- | --- | --- |
| today's tables | 0 | 41.91 | 42.68 | 49.14 | 75.06 | 88.65 | 11.10 |
| votes | 211 | 67.71 | 69.47 | 80.83 | 77.17 | 89.30 | 62.82 |
| votes, `--follow` | 303 | 80.10 | 80.84 | 88.66 | 86.83 | 96.25 | 66.67 |
| votes, `--stay` | 360 | 67.73 | 68.37 | 75.06 | 82.63 | 93.04 | 55.10 |
| votes, `--follow --stay` | 537 | 76.98 | 77.56 | 84.26 | 85.94 | 95.46 | 66.24 |
| search from today's tables | 866 | 94.69 | 94.22 | 96.23 | 97.60 | 99.64 | 72.88 |
| search from today's tables, `--order 1` | 894 | 96.25 | 96.16 | 97.58 | 98.29 | 99.71 | 57.50 |
| search from today's tables, `--order 2` | 946 | 88.88 | 88.65 | 92.01 | 94.04 | 98.74 | 55.21 |
| search from the votes | 785 | 86.24 | 86.52 | 91.38 | 91.34 | 97.75 | 67.11 |
| search from the votes with `--follow` | 744 | 86.45 | 86.49 | 91.52 | 91.20 | 98.01 | 68.00 |
| the hand-written tables of `../handwritten`, for comparison | 915 | 96.22 | 96.51 | 98.69 | 97.65 | 99.56 | 80.04 |
| search from the hand-written tables | 464 | 97.72 | 97.71 | 99.12 | 98.47 | 99.73 | 78.33 |

The base of a row is today's tables, and for a search from other tables it is those tables. The searches from the votes differ from today's parser in 858 and 827 cells, and the search from the hand-written tables in 978.

The same tables by the dataset's groups, validation split, all three:

| validation samples | today's | votes | votes, `--follow` | search | search, `--order 1` | search from the votes | search from the hand-written tables |
| --- | --- | --- | --- | --- | --- | --- | --- |
| all, 4,878 | 42.7 | 69.5 | 80.8 | 94.2 | 96.2 | 86.5 | 97.7 |
| damage, 3,779 | 40.3 | 65.5 | 78.3 | 94.0 | 96.1 | 84.8 | 97.8 |
| typing, 1,099 | 57.2 | 93.6 | 96.2 | 95.8 | 96.7 | 96.9 | 97.3 |
| within reach of the tables, 3,547 | 47.4 | 74.6 | 85.4 | 97.7 | 98.4 | 91.0 | 99.6 |
| needs a display fix, 37 | 18.3 | 26.8 | 39.2 | 90.1 | 93.6 | 61.6 | 98.1 |
| needs a line rule, 487 | 63.8 | 95.0 | 97.5 | 99.0 | 99.0 | 98.8 | 99.3 |
| needs a character class, 326 | 10.1 | 29.1 | 38.5 | 80.6 | 88.8 | 49.1 | 95.2 |
| needs a nesting fix, 74 | 26.5 | 41.9 | 77.6 | 80.3 | 90.2 | 92.5 | 88.5 |
| out of reach, 407 | 25.6 | 57.2 | 82.7 | 80.7 | 85.3 | 84.4 | 84.8 |

The rows per family and per kind of damage are in the output of `../score.ts` for each of the saved tables, and `../compare.ts` prints several tables side by side.

What the numbers say:

- **Where the search starts decides where it ends, and so does the order of its cells.** From today's tables three orders of the cells end at 94.2%, 96.2% and 88.6% on the validation split. From the votes the search ends at 86.5%, and most of that is in the samples that need a character class: 49.1% against 80.6%. From the hand-written tables it ends at 97.7%: 1.2 points above the tables it started from, and 1.5 above the best search from today's tables. So no search here is at the limit of the cells, and each is one of many places where no single cell can be improved.
- **The number to beat is 97.7%.** A gradient arm without added structure that ends below the search from the hand-written tables has found nothing that a plain search does not find. The hand-written rules were written with the old snapshot's samples in view, see `../handwritten/README.md`, so this number is no number on unseen data. Train and validation are 0.5 points or less apart for every search.
- **The votes get half of the way.** The walk as specified ends at 69.5%, and at 80.8% when it follows frozen cells. On the typing replays the followed votes are within a point of every search from today's tables, and in the group "out of reach" they are within 3 points of the best one.
- **The search's tables do not read like a recovery.** The votes change 211 to 303 cells, and many of them read like a rule, e.g. (commaOrClose, string, depth 1, object) goes to `colon`, which is what a missing comma needs (325 votes in the walk as specified, 4,240 of 4,407 with `--follow`). The search changes 860 to 950 cells and uses the tokenizer's states as memory without regard to their names.
- **Samples that are right as a whole** do not follow the code points. The hand-written tables have 80.0%, which the search from them lowers to 78.3% while it raises the code points. The search with `--order 1` has the most code points of the three orders and 57.5% of whole samples: of the 487 samples that need a line rule it has 99.0% of the code points and 5 samples right as a whole, because it shows the line feed that ends an open string as a number.

What the main number does not show, for the same tables on the validation split (the columns of `../compare.ts`, and `../check-deep.ts`):

| tables | added code points shown as an error | samples that show an error | wrong depths on valid JSON of 17 to 19 levels, nothing after the nested containers | the same, members after |
| --- | --- | --- | --- | --- |
| today's tables | 89.5% | 61.1% | 0% | 0% |
| votes | 4.1% | 11.2% | 0% | 0% |
| votes, `--follow` | 0.9% | 2.0% | 0% | 0% |
| search from today's tables | 0.5% | 9.5% | 22.4% | 39.0% |
| search, `--order 1` | 0.1% | 1.6% | 42.5% | 50.1% |
| search, `--order 2` | 6.5% | 33.3% | 68.6% | 70.4% |
| search from the votes | 0.5% | 10.9% | 51.9% | 51.4% |
| search from the votes with `--follow` | 0.4% | 7.8% | 61.3% | 51.5% |
| hand-written | 0.0% | 0.0% | 0% | 0% |
| search from the hand-written tables | 0.0% | 0.1% | 16.9% | 21.9% |

- **Errors.** A code point that the damage added has no label, so tables lose nothing in the main number by showing no error at all. Which of the search's tables still show errors is an accident of the order of the cells.
- **Valid JSON that is too deep.** A valid JSON text of 17 levels or more has a first error at its 17th opening bracket, and reads open cells from there on. Today's parser keeps its depth right at every code point, since the depth is a count of brackets. Every search loses that: the depth is wrong at 17% to 70% of the code points after the 17th bracket, of 300 such texts in each of two forms. The dataset has no such text, so the search's score does not see it. The votes change no cell that these texts read.
- **No code point is shown as "past the end".** A tokenizer cell can hold one of the three events of a text's end, and a code point with such an event is shown as the cells after a text are, which no recovery would show for a character of the text. The search leaves these events out unless `--end-events` asks for them. With them, the three orders show 226, 765 and 873 code points of the validation split so, and end at 93.9%, 96.4% and 88.6%, where they end at 94.2%, 96.2% and 88.6% without. So leaving them out costs nothing that these runs can tell.

## The votes

`votes.ts` walks every broken train sample with the parser forced onto the intended state (`../intended.ts`) after every kept code point. `countVotes` lets every broken sample of the set vote that it is given, so the set is the train split: a set with a sample of another split throws, unless the call says `alsoOtherSplits: true`. Where the walk knows the state before a kept code point and the cell that the code point reads is open, the sample votes for the choice that gives the intended state after the code point: a tokenizer cell's next state and event as one choice, a grammar cell's next state and stack action as one choice. Each cell takes its most voted choice. Of several choices with the same votes, today's wins. A cell without votes keeps today's choice.

The votes change 211 cells: 163 of the 710 open tokenizer cells and 59 of the 616 open grammar cells get votes, 222 of 1,326. There are 84,881 votes, and 76.9% of them are for the choice that their cell took. The most contested cell is (between, other), which every letter without a class of its own reads between tokens, and so do the apostrophe and the curly quotes: 35,891 votes for (string, stringStart), 10,230 for (between, whitespace) and 8,274 for (string, stringContent).

Most code points give no vote. Of the 6,045,835 code points at or after the first damage of the broken train samples:

| what the walk does with the code point | code points |
| --- | --- |
| added by the damage, so there is no intended state after it | 431,365 |
| kept, right after an added one: the walk does not know the state before it | 39,208 |
| kept, with a known state before | 5,575,262 |

And of those 5,575,262, once per table:

| the cell that the code point reads | tokenizer | grammar |
| --- | --- | --- |
| is frozen and gives the intended state | 5,431,934 | 5,504,919 |
| is frozen and gives another state than the intended one | 69,850 | 58,746 |
| is open: a vote | 73,478 | 11,403 |
| is open, and no single stack action gives the intended stack | | 194 |

The situations without a vote, with an example each:

- **An added code point**, e.g. every code point of a comment. The damage added it, so it has no counterpart in the original and no intended state.
- **A kept code point right after an added one.** The state between the added code points is anyone's guess, so the walk does not know which cell the kept code point reads. The walk goes on from the intended state after it.
- **A frozen cell that gives another state than the intended one.** This is the largest loss. E.g. in `{"a": 1 "b": 2}` the space after the `1` keeps the grammar in commaOrClose, and the intended state after the space is `key`, since the original has a comma there. The walk is forced onto `key`, so the quote reads (key, string), which is frozen. The cell that the parser reads at the quote, (commaOrClose, string), gets no vote from this sample. The same happens after a replaced code point of another class, e.g. the closing `'` of a string reads (string, other), which is frozen and stays in the string.
- **No single stack action**, e.g. the first kept code point after a removed part that closed two containers. 194 code points.

The third situation is why the walk as specified gets only half of the way: it is forced onto intended states that no parser of the broken text can be in. The core marks the kept code points whose intended state can be followed (`codePointCanFollow`, see `../intended.ts`), by a walk that follows frozen cells as `--follow` does. The votes do not use the mark, so that they stay the walk as it was specified and its variants.

Two options change the walk. Both go beyond "forced after every kept code point", and both are guesses that the scores have to judge:

- `--follow`: after a frozen cell the walk goes on from what the frozen cell gives, not from the intended state, since no choice of the open cells changes what a frozen cell gives. In the example above the quote then reads (commaOrClose, string) and votes for the next state `colon`. An added code point that reads two frozen cells is followed the same way, e.g. the added comma of `[1,]`.
- `--stay`: an added code point that reads an open cell votes for the choice that leaves the state as it is. This is right for a comment and wrong for the first quote of a string that the damage quoted twice.

## The search

`search.ts` starts from today's tables, or from saved tables with `--from`. For one open cell at a time it tries the cell's choices in the exact parser on the train split and keeps the best one, and it goes over all 1,326 open cells again until a pass changes nothing or a limit ends it. It scores the validation split after every pass, for the log only.

- **The score of a choice** is two counts over the train split: the scored code points with every scored label right, and the labels that are right one by one. A choice is better when the first count is higher, or the first is the same and the second is higher. The second count lets the search keep a step that e.g. gets the depth right before another cell gets the display kind right.
- **The choices of a grammar cell** are all 32 pairs of a next state and a stack action (a stack action that does what the cell's token does by itself is kept as `by token`, so there are four). **The choices of a tokenizer cell** are, with `--pairs known`, every other next state with the event the cell holds, every other event with the next state the cell holds, and every pair that some cell of today's tokenizer table holds, e.g. (string, stringStart): about 85 choices. `--pairs parts` leaves the known pairs out, and `--pairs all` tries every pair, 572 without the events of a text's end. In each case the three events of a text's end are left out, unless `--end-events` is given.
- **The order** of a pass is from the cell that the most samples read to the least read one. `--order <seed>` takes a random order.
- **What makes it fast**: only a sample whose run reads the cell can change, and only from its first read of the cell on. Each worker thread keeps one bit per sample and cell that says whether the sample's run reads the cell, and runs a sample again only from the state before that first read. The part of a sample before its first error is never run again. Up to four worker threads each take a share of the samples. All counts are whole numbers and every worker gets the same changes in the same order, so the result does not depend on the number of workers.
- **The limits** are counts, so a run can be repeated: `--passes` is the most passes over the cells, and `--runs` is a budget of sample runs, in millions. A stop by the clock is off unless `--minutes` is given, and the log says when it is the one that stopped the search, since a rerun may then stop at another step.
- **The output** goes to `--out`. With `--from` the search needs `--out`: it does not make up a name from the name of the file it started from.
- **The tables to start from have to be of this dataset.** `--from` refuses a file that was saved with another version of the dataset, or before the dataset's key was written into saved files: a later commit of the dataset can move train samples into the validation or the test split, see `../arms/README.md`. Make the tables again, e.g. with `votes.ts` or `../handwritten/rules.ts`.

`sample-runs.ts` holds the parser loop of the search. It has to count what `../score.ts` counts, and `check.ts` compares the two. The search also compares its running counts with `scoreTables` after every pass.

How far the runs got:

| run | how it ended | runs of a sample | time | validation, all three |
| --- | --- | --- | --- | --- |
| from today's tables | pass 19 changed nothing | 520.7 million | 169 s | 94.22 |
| from today's tables, `--order 1` | pass 20 changed nothing | 630.0 million | 206 s | 96.16 |
| from today's tables, `--order 2` | pass 28 changed nothing | 741.6 million | 233 s | 88.65 |
| from the votes | pass 15 changed nothing | 211.7 million | 71 s | 86.52 |
| from the votes with `--follow` | pass 16 changed nothing | 228.9 million | 78 s | 86.49 |
| from the hand-written tables | pass 12 changed nothing | 458.5 million | 136 s | 97.71 |
| from today's tables, `--pairs all` | the budget of 1,400 million runs, in pass 8, after 10 of the 1,326 cells | 1,401.0 million | 552 s | 94.02 |
| from today's tables, `--pairs parts`, `--passes 1` | the limit of 1 pass | 17.3 million | 7 s | 84.07 |

- From today's tables the first pass alone goes from 41.9% to 84.9% on the train split, and the passes after it add 7.5, 1.2, 0.5 and 0.2 points. From pass 8 on a pass changes fewer than 100 cells.
- The first step is the largest: the grammar cell (error, none, depth 1, object) goes from `error` to `colon`, which gets 865,103 more code points right, 15.6 points. After an error in an object at depth 1, every code point without a token then moves the grammar to `colon`, where string content is shown as a key. Today no key after a first error is shown as a key.
- From the hand-written tables the search changes 464 cells in 11 passes. Its first pass alone goes from 96.22% to 97.44% on the train split.
- The search gives the same tables with 1, 2 and 4 worker threads: two passes from today's tables take 98, 34 and 20 seconds, and the three files of tables are the same, byte for byte.
- With `--pairs all` a pass costs about eight times as many runs, 214.9 million in pass 5 against 26.7 million, and gains nothing: after 5 passes the train split is at 94.2%, where `--pairs known` is at 94.4%, and when the budget ends it is at 94.0% on the validation split against 94.2%. More choices per cell did not make better steps here.

## What is still wrong

`mistakes.ts` counts the wrong labels on the validation split and prints samples for reading. The best tables from today's tables (`--order 1`) are wrong at 25,945 of 675,695 scored code points, 3.84%, in 1,914 of 4,878 samples. Only the display kind is wrong at 55.4% of those code points and only the depth at 32.8%. Punctuation shown as a key is 16.2% of them, a key shown as a string 15.8%, a string shown as a key 6.8%, and white space shown as a key 4.2%.

30 wrong samples, drawn without order, by their groups:

- **Needs a line rule, 9 of 30**, each with one wrong code point: the line feed that ends an open string is shown as a number, e.g. after `"ema` at the end of a line. The rest of each text is right.
- **Needs a character class, 8 of 30**, with 2 to 41 wrong code points: strings in single quotes, `=>` for the colon, a backslash that should have been doubled. E.g. the colon after the key `'first name'` is shown as a key.
- **Within reach of the tables, 7 of 30**, with 1 to 14 wrong code points: a document with a backslash before every quote, keys without quotes next to a comment, a key without its colon, `ObjectId(…)` calls, a backslash that should have been doubled, a statement around the document.
- **Out of reach, 4 of 30**, with 7 to 89 wrong code points: a text that starts inside the document, a missing closing bracket, an inner quote without its backslash.
- **Needs a nesting fix and needs a display fix, 1 each**: a stray closing bracket, and a key without quotes that starts with a letter of a literal.

By kind, the lowest of the `--order 1` tables are missingCloser at 81.1%, backslashEscapedDocument at 81.2% and nonBreakingSpace at 81.4%. The family of bracket damage is at 84.8%, the group "out of reach" at 85.3% and "needs a character class" at 88.8%.

## Damage that the search has not seen

The test split holds kinds of damage that training never sees, and nothing here reads it. To get a first idea without it, one search left four kinds out of its train samples, one from each family of the held-out kinds, and the validation samples of those kinds were scored:

```sh
bun lab/recovery-parser/learn/search/search.ts --without-kinds hashComment,foreignLiteral,statementWrapper,newlineDelimited
```

It ended when pass 20 changed nothing, after 506.4 million runs and 192 s, with 36,724 of the 40,759 broken train samples. Validation split, all three:

| kind, validation samples | today's | search with the kind | search without the kind |
| --- | --- | --- | --- |
| hashComment, 15 | 31.0 | 77.0 | 86.8 |
| foreignLiteral, 232 | 12.9 | 85.8 | 80.2 |
| statementWrapper, 167 | 3.5 | 94.6 | 80.4 |
| newlineDelimited, 79 | 53.9 | 97.4 | 92.6 |
| all, 4,878 | 42.7 | 94.2 | 93.0 |

Three of the kinds that the search did not see lose 5 to 14 points and stay far above today's tables, and hashComment, with 15 samples, gains 10. How much of a difference is the missing kind is not settled by one run: callWrapper stayed in the train samples and differs by 3 points between the two searches, 95.0% and 92.1%, and three orders of the cells end 7.5 points apart on all samples.

Whether the dataset's own held-out kinds were seen by the hand-written rules is a separate question, see `../handwritten/README.md`: the files of samples that their builder was told to read held test samples.

## Commands

Run from the repo root, with `RECOVERY_SCRATCH` set to a folder outside the repo as in the core's README. Tables and logs go to `$RECOVERY_SCRATCH/search/`.

```sh
bun lab/recovery-parser/learn/search/check.ts                                  # the search counts what score.ts counts, and which samples vote, about 15 s
bun lab/recovery-parser/learn/search/votes.ts                                  # votes.json, under 1 s after the samples are loaded
bun lab/recovery-parser/learn/search/votes.ts --follow                         # votes-follow.json; also --stay, and both
bun lab/recovery-parser/learn/search/votes.ts --cells                          # also lists every cell with votes and how they split
bun lab/recovery-parser/learn/search/search.ts                                 # search-from-today.json and .log
bun lab/recovery-parser/learn/search/search.ts --order 1                       # the cells of a pass in a random order: search-from-today-order-1.json
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/search/votes.json --out $RECOVERY_SCRATCH/search/search-from-votes.json
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/search/votes-follow.json --out $RECOVERY_SCRATCH/search/search-from-votes-follow.json
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/handwritten/tables.json --out $RECOVERY_SCRATCH/search/search-from-handwritten.json   # the number to beat
bun lab/recovery-parser/learn/search/search.ts --pairs all --out $RECOVERY_SCRATCH/search/search-pairs-all.json   # every pair of a tokenizer cell
bun lab/recovery-parser/learn/search/search.ts --passes 2 --out $RECOVERY_SCRATCH/search/two-passes.json          # a run that ends at the same step on every machine
bun lab/recovery-parser/learn/search/search.ts --without-kinds hashComment,foreignLiteral,statementWrapper,newlineDelimited
bun lab/recovery-parser/learn/search/search.ts --end-events --out $RECOVERY_SCRATCH/search/search-end-events.json  # also the events of a text's end
bun lab/recovery-parser/learn/score.ts --tables $RECOVERY_SCRATCH/search/search-from-today.json --cells   # every row, and the cells
bun lab/recovery-parser/learn/search/mistakes.ts --tables $RECOVERY_SCRATCH/search/search-from-today-order-1.json --count 30   # wrong samples, for reading
bun lab/recovery-parser/learn/compare.ts search=$RECOVERY_SCRATCH/search/search-from-today.json votes=$RECOVERY_SCRATCH/search/votes.json   # several tables side by side
bun lab/recovery-parser/learn/check-deep.ts search=$RECOVERY_SCRATCH/search/search-from-today.json   # the depth on valid JSON of 17 to 19 levels
```

`search.ts` refuses tables with added classes or with the bit "first on its line", see `../structure/README.md`.

## Files

- `votes.ts`: `countVotes`, `tablesOfVotes`, and the command.
- `search.ts`: the search's main thread: the order of the cells, the choices to try, the limits, the log, the checks after every pass.
- `search-worker.ts`: a worker thread: its share of the samples, which cells each sample reads, and the tries.
- `sample-runs.ts`: the samples as the search holds them, and the parser loop that only computes a sample's score, from the first position that reads an open cell or from the first read of one cell.
- `check.ts`: the search's loop against `../score.ts`, and that `countVotes` refuses a set with validation samples.
- `mistakes.ts`: counts of the wrong labels and samples in fixed width, for reading. It shows the validation split and has no `--split`: an option that a command does not have is an error.
