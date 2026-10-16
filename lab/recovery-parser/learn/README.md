# Learning a recovery parser: the shared core

The JSON highlighter is a parser written as tables. It does not recover: after the first error everything is shown as an error or loses its meaning, e.g. every key after a missing comma is shown as a plain string. This experiment changes the table cells that only broken input reaches, by hand or by training, and measures how much of a broken text is then labeled as its author meant it.

The files at the top of this folder are what every arm of the experiment shares. The folders hold what the arms are built from and compared with:

- `arms/`: the harness that every arm is scored and reported with, the baselines, and the arms themselves, each as a thin script in a folder of its own. Start there to write an arm.
- `handwritten/`: a recovery written by hand, as 35 rules that set open cells.
- `search/`: the open cells filled without gradients, by votes of the train samples and by a search that tries one cell at a time.
- `soft/`: the trainable twin of the parser and its trainer.
- `structure/`: what an arm can add to the tables besides states: character classes, e.g. one for the apostrophe, open entries of the display table, and a bit that tells the grammar whether a token is the first on its line. This README describes the tables without any of it.
- `final/`: the final scoring of the tables that the experiment ends with, on the test split and on the written evaluation set of `../written/`, which is meant to run once, after every choice between tables is made. It also shows one case or one sample with what named tables show for it. The two folders `final/` and `../written/` are only on the branch of the final scoring.

The dataset is the reviewed one of `lab/recovery-parser/`, whose README is the reference for everything about the samples. Every number in this folder was made on it, on the validation split, with the commands at the end. **A number is still preliminary where it is one seed of an untuned run**, and the text says so where it is.

## Words

- A **cell** is one entry of the tokenizer's table, (tokenizer state, class), or of the grammar's table, (grammar state, token, context). E.g. the grammar cell (commaOrClose, string, depth 1, object) is what the parser reads at the second `"` of `{"a": 1 "b": 2}`. A context is the depth class (0, 1, 2 to 15, 16) and whether the innermost open container is an object.
- A **frozen cell** is a cell that some text makes the parser read before that text's first error, e.g. (between, quote). JSON that the highlighter accepts only ever reads frozen cells. Frozen cells never change.
- An **open cell** is every other cell: the parser reads it only at or after a first error, e.g. (between, other), which the `x` of `[x]` reads. Open cells are what a hand-written recovery or a training run may change.
- A **choice** is what an open cell holds. A tokenizer cell holds a next tokenizer state and an event. A grammar cell holds a next grammar state and a stack action, one of: by token (an opening bracket pushes its kind, a closing bracket pops, any other token does nothing, which is what the parser does today), none, push an array, push an object, pop.
- **Snapping**: a trained cell holds a mix over choices, and snapping picks the one with the largest share. Only snapped tables run in the exact parser, and only scores of snapped tables in the exact parser count.
- The **base** of a run is the tables that it started from, e.g. today's tables, or today's tables with an added class.

The code keeps the names of `table-parser.ts`, where the tokenizer is the "lexer", e.g. `lexerNext`.

## Ground rules

For every choice of the open cells:

1. Every text gets the same trace as today up to its first error. So JSON that the highlighter accepts, i.e. valid JSON of at most 512 code points and 16 levels, is parsed exactly as today.
2. Every text has the same `valid`, first error position and first error kind as today.
3. Only what is shown from the first error on can change.

Rule 1 holds because frozen cells keep today's values: `checkTables` refuses tables in which a frozen cell differs, and `saveTables`, `loadTables`, `runRecoveryParser` and `scoreTables` call it. Rule 2 holds by construction: the parser finds the first error with today's tables, not with the tables it runs.

The rules rest on which cells are open. `recovery-tables.ts` finds the frozen cells by a search over everything a text can make today's parser do before its first error: over the tokenizer state, the grammar state, the depth and the kind of the innermost open container. The tokenizer's table has 858 cells, 148 frozen and 710 open. The grammar's table has 704 cells, 88 frozen and 616 open. Of the 616, 448 lead into the state `error` from another state today, 88 are the row of the state `error`, and 80 lead elsewhere but need a state and a context that no text has before an error. The 88 cells of the context "depth 0, object" are among the open ones and the recovery parser never reads them, since at depth 0 no container is open. The dataset finds the same 148 and 88 cells with a walk of its own (`cellsThatValidJsonReads` in `../limits.ts`), and `arms/check.ts` compares the two cell by cell.

How the rules are checked:

- `check-tables.ts`: for each of the 236 frozen cells, a text reads the cell before any error, so no cell is frozen without need. And no text reads an open cell before its first error: 68,107 texts, among them the originals and the broken texts of the samples with the indexes 0 to 29,999 that are not in the test split, and valid texts with 16 levels and with 512 code points. The same holds for every text of up to 6 code points, which the check goes through class by class, 17,303,316 texts. A table file with a changed frozen cell is refused, and so is one with a number that a byte does not hold. Every cell is also changed alone, in each of its two fields, and so is every bit of the masks of open cells: the 2,434 changes of a frozen cell or of a mask are refused, and the 2,652 changes of an open cell are not.
- `check-parser.ts`: with today's tables the parser gives the trace of `table-parser.ts` on 58,107 texts. And for 200 random settings of every open cell, 50 of them with added states, rules 1 and 2 hold on 5,168 texts each, with every valid text's whole trace identical.
- Both checks then run the same parts for tables with added structure, which is most of their time. `structure/README.md` says what those parts cover.
- `arms/harness.ts` runs every tables that an arm records on 2,800 fixed texts and writes into the record whether each has today's trace up to its first error and today's verdict. `arms/check.ts` shows that this check can say no: for tables with one changed frozen cell it does, for each of 40 frozen cells that were tried.
- A review of the first version ran its own exact search over 4,063,196 parser states, with the kind of every open container, and found the same 148 and 88 frozen cells. Those scripts are not in the repo.

**What rule 1 does not cover: valid JSON that is too deep or too long.** A valid JSON text of 17 levels or more has a first error at its 17th opening bracket, and reads open cells from there on, so tables may show the rest of it otherwise than today. The dataset has no text deeper than 16 levels, so no score sees that. Today's parser keeps the depth of such a text right at every code point. `check-deep.ts` counts the code points at which saved tables do not, on 300 texts with nothing but closing brackets after their innermost container, e.g. `[1, [2, [3]]]`, and on 300 texts in which members follow the nested containers, e.g. `[[[3], 2], 1]`. Tables can pass the first form and fail the second. The hand-written tables and the votes have no wrong depth in these two forms. Every search has, at 6% to 79% of the code points after the 17th bracket, and so have 2 of the 5 seeds of the trainer's plain pass, see the table of scores. Two forms are not every too deep text: `arms/combined/deep-valid.ts` adds texts with members and small containers on both sides of every nested container, and there the hand-written tables have 1,741 wrong depths, in 19 of the 2,000 texts, e.g. in `{"a": {"a": []}, "b": 1}` inside 14 objects, see `arms/combined/README.md`. The votes were not run on those texts. A valid text of more than 512 code points is safe: its first error is at position 512, after everything that is shown.

## The parser

`runRecoveryParser(codePoints, truncated, tables)` returns a trace with one entry per position: the class, the tokenizer state before and after, the event, the token, the context, the grammar state before and after, the two cells that were read, the stack action, the display kind, the depth after and the container after. And `valid`, the first error's position and its kind.

The open containers are a real stack, one kind per open level. Today's parser keeps the kinds in one integer, a running sum that an opening brace adds to and a closing brace subtracts from. The sum is only right while every closing bracket matches: after the `]` of `[{"b": 1], 2]` it still says "object". Before the first error the stack and the sum are the same. With today's tables, the stack gives another container than the sum in 3.3% of the broken texts of `check-parser.ts`, at 0.7% of their code points from the first error on, and another context at 1.3% of them.

The edges, chosen so that today's tables give today's depths everywhere, and today's contexts up to and at the first error:

- A pop at depth 0 or below lowers the depth as at any depth, so the depth can be negative, e.g. -1 after the `]` of `1]`.
- A push at depth 16 or above raises the depth as at any depth. The stack holds the kinds of the levels 1 to 16 only.
- The context of a depth below 0 is the one of depth 0, without a container. The context of a depth above 16 is the one of depth 16, with the kind at level 16, which above 16 levels is not the innermost container.
- Position 512 reads the context of an array or of no container, even inside an object, as in the highlighter's program.

**This parser is not the dataset's plain table parser.** The dataset's loop, `../table-parser.ts`, changes the depth by the tokenizer's event and keeps the running sum. Its two proofs (`needsNestingFix`, `needsDisplayFix`) and its bound (`mostRightFor`) are about that loop, and its README says that they say nothing about a parser whose depth changes by something else. Here a grammar cell holds a stack action, e.g. a comma can pop, and the stack is real. So this parser can label samples that the plain loop provably cannot: in the group "needs a nesting fix" the hand-written tables have 76.1% of the scored code points right, where the bound of the plain loop is 43.3%. Wherever the bound is printed, it is named as the bound of the plain table parser. `plainParserProblems` in `plain-tables.ts` says in sentences whether some tables are tables of the plain loop at all, and every record of an arm holds what it says.

What a port of trained tables into the highlighter's program would need:

- A stack action per grammar cell, read next to the next state. The depth then changes by the action, not by the event.
- Kinds that stay right after any pop: a pop has to clear the bit of the level it leaves, whichever bracket caused it, and a push has to set the bit by the action, not by the bracket. The program's test "is the innermost container an object" compares the sum with the bit of the current level, which is only right when no bit above that level is set.
- Today's tables next to the trained ones for the verdict. The program takes the first position whose grammar state is `error` as the first error. Trained tables can leave that state or never enter it, so `valid`, the first error's position and its kind have to come from today's tokenizer event and today's grammar cell at each position up to the first error.
- For added classes that hold a code point from U+0080 up, see `structure/README.md`: a way to give a few such code points a class without a table that reaches up to them. The class table here has one entry per code point up to the highest one of an added class, e.g. 8,224 entries for a class of the two curly quotes and 128,515 for a class of an emoji, against 129 today.

## How a parser is scored

As the dataset says a score counts (see "What a score counts" in `../README.md`):

- **The scored code points** of a broken sample are the ones from the first error of today's parser on whose label has a scored value. A label has three values, the display kind, the depth and the container. The dataset leaves a value out where no parser can be asked for it, e.g. the depth after a removed closing bracket, and the depth and the container are scored together or not at all. Before the first error nothing is counted: only frozen cells are read there, so every tables give what today's parser gives, and `check-data.ts` confirms that every scored value there is what today's parser gives.
- **All three** is the main number: the share of the scored code points at which every scored value is right. Next to it stand the share of the display kinds that are right (over the code points whose kind is scored), of the depths and of the containers (over the code points whose depth and container are scored), and the share of **whole samples**: samples in which every scored code point is right.
- A sample without a scored code point has nothing to recover, e.g. a text that is cut off. It is counted apart, and valid samples are left out.
- The rows: all, per split, damage against typing, the dataset's six groups (`groupOf`: within reach of the tables, needs a display fix, needs a line rule, needs a character class, needs a nesting fix, out of reach), debatable or not, the samples whose lines end with a carriage return and a line feed, per family and per kind.

`scoreTables` scores the validation split unless `options.splits` names the train split. Model selection uses the validation split.

`check-data.ts` makes every row of a score a second time, from the dataset's own functions and the exact parser's trace, with its own lists of the samples of each row, and compares all 16 counts of all 75 rows with `scoreTables`, for today's tables and for the hand-written ones. So a sample that is counted in the row of another group or kind, or as a whole sample with a wrong code point, fails a check.

**The test split is not in the samples that this folder loads.** `loadSamples` leaves a sample of the test split out when it makes the samples, so nothing that reads the arrays can score it, print it or train on it. The four held-out kinds of damage and the held-out template are only in the test split, so they are left out with it. Only `RECOVERY_FINAL=yes` opens the test split, and three scripts are meant to run so: `arms/final.ts`, and `final/run.ts` and `final/show.ts` of the final scoring. `check-guard.ts` checks all of that but the two scripts of `final/`, which `final/check.ts` checks. No number in this README is of the test split: the final scoring writes its own report, see `final/README.md`.

**Training reads the train split only.** `train` of `soft/train.ts` throws for a sample of the validation split, since the packed samples hold their split, and `countVotes` of `search/votes.ts` does the same. A call that wants such samples has to ask for them with `alsoOtherSplits: true`.

**The validation split is not all unseen text.** A sample has the split of its original document, by the document's tokens (`../splits.ts`), so two documents of two splits can end as the same short broken text. 52 of the 5,021 broken validation samples have a broken text that a broken train sample has too (15 texts). 32 of them are a `[` alone, and 29 of those are the document `[]` before its closing bracket is typed, or cut off after its first: `[]` is a validation document since the dataset split its ten smallest documents by hand, and one train sample, the first keystroke of a longer array, has the same text. Others are e.g. `0.` and `{...}`. 11 of the 52 have something to score: 60 of the 675,949 scored code points. `data.ts` prints the count.

Three things that the shares do not show are counted next to them, in every row:

- **The bound of the plain table parser.** The dataset's `mostRightFor` gives the most scored code points that one run of the plain loop can have right, whatever its open cells hold. On the validation split it is 97.94% of all three and 92.45% of whole samples. It is no bound for this parser, see [The parser](#the-parser).
- **How the damage itself is shown.** A code point that the damage added has no label, and no label is ever the display kind `error`. So tables lose nothing in the shares by never showing an error. The score counts the added code points that are shown as an error, and the samples that show an error at or after the first damage. Today's parser shows 89.6% of the added code points as an error. The hand-written tables show none.
- **Code points shown as "past the end"**, the display kind of the cells after a text. A tokenizer cell can hold one of the three events of a text's end, and a code point that reads the cell is then shown so. The search no longer tries these events. A trained cell can still snap to one.

Two counts of cells stand next to a score, under two names, because they are not the same number once tables have added structure:

- **Cells changed against the base**: what a run changed in the tables that it started from.
- **Cells that differ from today's parser**: every cell of an added state counts here, and so does every changed cell that an added class or the bit "first on its line" copied. E.g. the hand-written tables differ from today's parser in 915 cells. With a class for the apostrophe added to them and no cell changed, 940 cells differ, and 0 are changed against the base.

On the samples with the indexes 0 to 19,999 of the train and validation splits, a count that `check-data.ts` makes from the dataset's own functions and today's parser gives the same display kinds and depths as `scoreTables` in every count. Its container is 87.8% and its all three 41.8%, against 88.2% and 41.9%, because it runs today's parser with the running sum: the stack has 9,596 more containers right and 1,714 more code points with all three right.

## Scores on the validation split

The validation split of the standard set (seed 20261015, indexes 0 to 59,999) has 5,021 broken samples, 425 of them with nothing to recover, and 675,949 scored code points. The percentages are of those code points, and of the samples with something to recover for "whole samples". The last four columns are what the main number does not show. The rows come from `arms/baselines.ts`, `arms/plain-pass/run.ts`, `compare.ts` and `check-deep.ts`.

| tables | cells changed against the base | all three | display kind | depth | container | whole samples | added code points shown as an error | samples that show an error | wrong depths on valid JSON of 17 to 19 levels: nothing after, members after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | 0 | 42.69 | 49.15 | 75.06 | 88.65 | 11.92 | 89.6 | 61.0 | 0.0, 0.0 |
| the dataset's hand rule `stay` | 1,058 | 73.81 | 78.16 | 93.90 | 98.15 | 28.74 | 62.7 | 61.0 | 0.0, 0.0 |
| the dataset's hand rule `resync` | 1,078 | 84.35 | 88.17 | 94.97 | 98.33 | 71.39 | 60.2 | 44.8 | 0.0, 0.0 |
| the dataset's hand rule `words` | 1,078 | 93.09 | 97.00 | 95.36 | 98.60 | 77.31 | 3.7 | 13.9 | 0.0, 0.0 |
| the dataset's hand rule `lines` | 1,108 | 93.23 | 97.00 | 95.50 | 98.59 | 77.48 | 3.7 | 13.9 | 0.0, 0.0 |
| hand-written, 35 rules | 915 | 96.52 | 98.69 | 97.66 | 99.56 | 80.44 | 0.0 | 0.0 | 0.0, 0.0 |
| votes, the walk as specified | 210 | 69.47 | 80.83 | 77.17 | 89.30 | 63.19 | 4.0 | 11.0 | 0.0, 0.0 |
| votes, `--follow` | 302 | 80.84 | 88.65 | 86.83 | 96.25 | 67.04 | 0.9 | 2.0 | 0.0, 0.0 |
| search from today's tables | 870 | 94.34 | 96.07 | 97.95 | 99.71 | 72.78 | 0.4 | 6.2 | 5.6, 11.5 |
| search from today's tables, `--order 1` | 931 | 96.30 | 97.69 | 98.35 | 99.70 | 56.64 | 0.0 | 0.9 | 43.3, 48.1 |
| search from today's tables, `--order 2` | 937 | 89.41 | 92.40 | 94.70 | 98.95 | 55.11 | 5.4 | 33.9 | 79.0, 73.4 |
| search from the votes | 823 | 86.56 | 91.44 | 91.41 | 97.79 | 67.75 | 0.4 | 10.5 | 52.2, 54.6 |
| search from the hand-written tables | 429 | 97.75 | 99.09 | 98.53 | 99.71 | 79.37 | 0.0 | 0.2 | 18.5, 30.2 |
| the trainer's plain pass, 5 seeds: mean (lowest to highest) | 967 (935 to 984) | 96.50 (95.88 to 96.74) | 98.22 (98.11 to 98.27) | 98.13 (97.64 to 98.35) | 99.68 (99.39 to 99.79) | 73.22 (72.76 to 73.54) | 0.9 (0.7 to 1.1) | 6.2 (4.6 to 7.8) | 3.0 (0.0 to 12.3), 4.7 (0.0 to 16.4) |

The base of every row is today's tables, with two exceptions. The base of the two searches from other tables is the tables they started from. And the base of `lines` is today's tables with the tokenizer state that the rule adds: its tables differ from today's parser in 1,111 cells, since each of the 33 cells of that state counts there. The four hand rules are the dataset's (`../hand-rules.ts`) as tables of this experiment, with the stack action `by token` in every grammar cell. Their numbers here are not the ones of the dataset's statistics: those are over all splits, and this parser keeps a real stack, see `arms/README.md`.

**For the dataset's hand rules no split counts as unseen, the test split included.** `../hand-rules.ts` chooses between rules by the dataset's statistics, which `../stats.ts` counts over the samples of every split. So their rows are no numbers on unseen data, here or in `arms/final.ts`, and an arm that starts from one of them has no unseen split either. The same holds for the hand-written rules, see below.

All three per group of the dataset, with the group's validation samples:

| tables | within reach of the tables, 3,687 | needs a display fix, 37 | needs a line rule, 488 | needs a character class, 326 | needs a nesting fix, 76 | out of reach, 407 |
| --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | 47.4 | 18.3 | 63.8 | 10.1 | 26.5 | 25.6 |
| the dataset's hand rule `words` | 98.3 | 95.0 | 97.8 | 85.7 | 42.7 | 62.4 |
| the dataset's hand rule `lines` | 98.3 | 95.0 | 99.6 | 85.7 | 42.7 | 62.4 |
| hand-written, 35 rules | 99.5 | 98.2 | 99.0 | 92.2 | 76.1 | 78.0 |
| search from the hand-written tables | 99.7 | 98.0 | 99.1 | 94.9 | 90.3 | 85.4 |
| the trainer's plain pass, 5 seeds | 99.1 (98.9 to 99.3) | 96.2 (94.2 to 96.8) | 99.7 (98.9 to 99.9) | 89.7 (88.9 to 90.5) | 89.4 (83.1 to 92.8) | 81.6 (76.9 to 83.6) |
| the bound of the plain table parser | 100.0 | 99.1 | 100.0 | 100.0 | 43.3 | 84.6 |

What to take from it:

- **The number to beat is the search from the hand-written tables, 97.75%.** The hand-written tables are a recovery that a person can read, not the best that the cells hold: a plain search changes 429 of their cells and gains 1.2 points. It loses 1.1 points of whole samples on the way, and the depth of valid JSON that is too deep. `numberToBeat()` of `arms/harness.ts` gives an arm this row.
- **Where a search ends depends on where it starts and on the order of its cells.** From today's tables three orders end at 94.34%, 96.30% and 89.41%, 6.9 points apart, and from the votes the search ends at 86.56%. None of these is the limit of the cells.
- **The trainer's plain pass is no arm, and it is already at 96.50%.** It is one pass over the train split with every default, untuned. Its five seeds are 0.86 points apart, from 95.88% to 96.74%, so a difference of half a point between two runs of one seed each says nothing. The mean is 0.01 points below the hand-written tables, which lie inside the range of the seeds, and 1.2 below the search from them, which is above every seed.
- **The hand-written rules were written with the old snapshot's samples in view**, so for them no split of this dataset counts as unseen, see `handwritten/README.md`. The same holds for everything that starts from them.
- **Code points and whole samples do not rank the tables alike.** The hand-written tables have the most whole samples, 80.44%. The search with `--order 1` has 96.30% of the code points and 56.64% of the whole samples.
- **One added tokenizer state gives the group "needs a line rule" more than the open cells did.** The dataset's hand rule `lines` is `words` with a state for the start of the line after a string that a line feed ended. It has 99.6% of that group, where `words` has 97.8%, the hand-written tables 99.0% and the search from them 99.1%. Over all samples that is 0.14 points, 93.23% against 93.09%.
- **No tables that score well show the damage as an error**, and every search's tables and two of the trainer's five seeds break the depth of valid JSON that is too deep. Neither is in the main number. Whether a recovering highlighter should mark the damage, and whether texts that are too deep should be in the dataset, is not settled, see [Not settled](#not-settled).
- Code points shown as "past the end": 0 to 160 for the seeds of the trainer's plain pass, 0 for every other row.
- In the group "needs a nesting fix" the hand-written tables, the search from them and the trainer's plain pass are far above the bound of the plain table parser, 43.3%, with 76.1%, 90.3% and 89.4%. That is what the stack actions are for. The dataset's hand rules `words` and `lines`, which have no stack action, are at 42.7% there.

## Intended states

`intended.ts` gives, for every kept code point of a broken text, the state today's parser is in after the code point's counterpart in the original: the tokenizer state, the event, the grammar state, the depth and the container. Training can use them as extra targets, and to put a run back on track. The arrays of `data.ts` hold the depth and the container as `intendedDepthAfter` and `intendedContainerAfter`, at every kept code point, also where the label's are not scored.

Many of them cannot be reached. After a removed or an added part, frozen cells give something else than the intended state, and go on doing so up to the next open cell. E.g. in `{"a": 1 "b": 2}`, whose original has a comma after the `1`, the intended grammar state after the space is `key`, and the parser stays in `commaOrClose` there because the cell (commaOrClose, none) is frozen. A run that is put on `key` then reads the frozen cell (key, string) at the quote, and never the open cell (commaOrClose, string) that the parser reads there and that a recovery has to change.

So the samples' flags mark the kept code points whose intended state a parser of the broken text can be in (`codePointCanFollow`). `canFollowOf` in `intended.ts` walks the broken text with the state that every choice of the open cells gives, as long as frozen cells determine it, and its first comment says what is exact in that and what is assumed. Of the kept code points from a first damage on, 87.2% have the mark (indexes 0 to 19,999). Use the intended states only there.

The mark is no proof in either direction. `intended-reached.ts` counts where saved tables are in the intended state on the train split: at 85% to 96% of the code points with the mark for the hand-written tables, the followed votes and three searches, and at 3% to 10% of the code points without it. So without the mark a parser is seldom in the intended state, and it is not true that no choice of the open cells leads there: where the walk does not know the state, e.g. after a stretch of added code points, it leaves the mark off, and tables can still arrive at the intended state.

What the mark changes in training is in `soft/README.md`: with it, the extra targets do not lower the score of the snapped tables by much, and keeping a run on track still does.

## Reading samples

To read samples as aligned text, use `handwritten/show.ts`. It shows the train split unless `--split validation` is given, and the test split is not loaded at all.

```sh
bun lab/recovery-parser/learn/handwritten/show.ts --kind missingComma --limit 5      # the train split
bun lab/recovery-parser/learn/handwritten/show.ts --split validation --index 163 --tables <file.json>
```

Do not read the files of dumped samples that `lab/recovery-parser/dump.ts` writes. They hold test samples. The builders of the hand-written rules were told to read such files of the old snapshot, so the held-out kinds count as possibly seen by those rules.

## Files

- `dataset-key.ts`: the dataset's key, a hash of the source files that decide what the samples are, and the cache's key. Every record of an arm, every saved file of tables and every cache file of the samples holds the dataset's key.
- `recovery-tables.ts`: the type `RecoveryTables` (sizes, the tokenizer's next state and event per cell, the grammar's next state and stack action per cell, the fixed tables, the masks of open cells). `asIsTables()` returns today's tables. `checkTables`, `saveTables` and `loadTables` (JSON, with the dataset's key), `loadTablesForReport`, which says when a file was saved with another version of the dataset, and `loadTablesOfThisDataset`, which refuses such a file, `lexerCellName` and `grammarCellName`, `differencesOf` for the cells in which two tables differ, `addStates` for tables with more tokenizer states and grammar states, `addClasses` for tables with more classes, `openDisplayEntries` for tables whose display table may change, `addFirstOnLineBit` for tables whose grammar reads whether a token is the first on its line, `randomizeOpenCells`.
- `recovery-parser.ts`: `runRecoveryParser`, and `runRecoveryParserInto` for loops, which allocates nothing and does not check the tables.
- `plain-tables.ts`: between the dataset's layout of tables and this one. `recoveryTablesOf` turns e.g. a hand rule's tables into tables of the experiment, and `plainParserProblems` says what keeps tables from being tables of the plain table parser.
- `intended.ts`: `intendedOf(sample)`, the intended states and the mark of the ones that can be followed. `intended-reached.ts` counts where saved tables are in them.
- `data.ts`: `loadSamples(seed, from, to)` holds the samples of an index range that are not in the test split in typed arrays: code points, labels, flags, intended states, and per sample the split, the kinds, the families, the group, the count of scored code points, the bound of the plain table parser, and more. `standardRange` is seed 20261015, indexes 0 to 59,999: 47,960 samples, 42,630 of the train split and 5,330 of the validation split. A sample's place in the arrays is not its index in the dataset. `trainPart` and `validationPart` return the parts. `allowedSampleAt` gives one sample of the dataset, and none of the test split. The cache folder comes from `RECOVERY_SCRATCH`, and passing `null` as the cache folder makes the samples without a cache. `refuseUnknownOptions` is what makes a command fail for an option that it does not have, e.g. `search/mistakes.ts --split test`, where the command used to run as if the option were not there.
- `score.ts`: `scoreTables(tables, samples, options)`, `scoreWith` for a parser that is not made of these tables, `runOnSample` for the trace of one sample, `wrongLabelsAt` for what is wrong at one code point, `cellsReadBy` and `cellsReadAt` for the cells that the exact parser reads on some samples, `withUnreadCellsOf`, which puts another table's choice back into the cells that are not read, and `cellCountsOf` for the two counts of cells.
- `compare.ts`: several saved tables next to today's, one row each.
- `check-tables.ts`, `check-parser.ts`, `check-data.ts`, `check-deep.ts`, `check-guard.ts`, `check-commands.ts`: the checks. `check-texts.ts` makes their texts. `check-all.ts` runs them all.

## Commands

Run from the repo root. `RECOVERY_SCRATCH` is a folder outside the repo for the cache of the samples, about 165 MB for the standard set, and for the tables and logs of the arms. Without it the samples are made on every run, about 12 s for the standard set.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/data.ts                              # makes the cache of the standard set, about 12 s once
bun lab/recovery-parser/learn/check-all.ts                         # the type check, the lint and the checks of learn/, a bit over two minutes. Two checks need saved tables, see below
bun lab/recovery-parser/learn/score.ts                             # today's tables on the validation split, every row
bun lab/recovery-parser/learn/score.ts --tables <file.json> --base <base.json> --cells
bun lab/recovery-parser/learn/score.ts --to 20000 --split train,validation
bun lab/recovery-parser/learn/compare.ts <name>=<file.json>[,<base.json>] ...   # one row per saved tables
bun lab/recovery-parser/learn/check-deep.ts <name>=<file.json> ... # the depth on valid JSON of 17 to 19 levels, in both forms
bun lab/recovery-parser/learn/intended-reached.ts <name>=<file.json> ...   # where saved tables are in the intended state
```

`check-all.ts` runs `bunx tsc -p lab/recovery-parser/learn`, the lint and 17 checks, 4 at a time, in a bit over two minutes on an 18 core machine with little else running (130 s and 131 s in two runs) and longer with other jobs running, with the cache of the samples in place, and ends with "Every check passed." or with the names of the commands that failed. One of the 17 is the check of the final scoring, `final/check.ts`, about 5 s. Three are checks of arms: `arms/generic/check.ts`, `arms/spare-states/check.ts` and `arms/combined/check.ts`, which alone takes about as long as the whole command. Two of them compare with saved tables and fail in a scratch folder without them. `arms/generic/check.ts` compares with the tables that `arms/plain-pass/run.ts` saved for seed 1: make the table of scores below first. `arms/combined/check.ts` compares with the tables that `arms/extra-facts/run.ts --trainer three-base --settings all --seeds 11,12,13,14,15` saved for seed 11. That run is half of the arm's confirmation run, which takes about 20 minutes, see the commands of `arms/extra-facts/README.md`. The one check that `check-all.ts` leaves out is `arms/holes/check-search.ts`, which takes about 8 minutes. It is the one command that type-checks this folder: `bun run check` of the repo does not, since `lab/recovery-parser/tsconfig.json` only includes the dataset's own files. Every check alone also ends with the line "Every check passed." and the exit code 0, or with a count of failures and the exit code 1.

The table of scores, from an empty scratch folder, in about 17 minutes with one command after the other, and in less with two searches at a time:

```sh
bun lab/recovery-parser/learn/arms/baselines.ts                    # the first six rows, under 1 s
bun lab/recovery-parser/learn/handwritten/rules.ts                 # <scratch>/handwritten/tables.json
bun lab/recovery-parser/learn/search/votes.ts                      # <scratch>/search/votes.json
bun lab/recovery-parser/learn/search/votes.ts --follow             # <scratch>/search/votes-follow.json
bun lab/recovery-parser/learn/search/search.ts                     # <scratch>/search/search-from-today.json, about 2 minutes
bun lab/recovery-parser/learn/search/search.ts --order 1           # about 3 minutes
bun lab/recovery-parser/learn/search/search.ts --order 2           # about 6.5 minutes
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/search/votes.json --out $RECOVERY_SCRATCH/search/search-from-votes.json   # about 1.5 minutes
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/handwritten/tables.json --out $RECOVERY_SCRATCH/search/search-from-handwritten.json   # the number to beat, about 2.5 minutes
bun lab/recovery-parser/learn/arms/plain-pass/run.ts               # the last row, 5 seeds, about 2 minutes. It reads the number to beat, so it comes after the search above
bun lab/recovery-parser/learn/compare.ts hand-written=$RECOVERY_SCRATCH/handwritten/tables.json votes=$RECOVERY_SCRATCH/search/votes.json search=$RECOVERY_SCRATCH/search/search-from-today.json
```

Every search and every seed of the trainer gives the same tables when it is run again: the five searches of the table and the five seeds of the plain pass were each run twice for these numbers, and the files of tables are the same, byte for byte.

The cache file is made again by itself when a source file of the dataset, `data.ts`, `intended.ts` or `recovery-tables.ts` changes: its name holds a key of those files, so a file of another version of the dataset is never read. `check-guard.ts` checks that every file that `data.ts` imports, directly or through another file, is in the key, and that a change of one file gives another key. The file of intended stacks of `soft/twin-data.ts` has the dataset's key and a hash of `twin-data.ts` in its name. Cache files of an earlier key stay in the folder and are never read: put them into the trash when the folder grows.

## Taking a new commit of the dataset

The dataset's files are everything in `lab/recovery-parser/` that is not under `learn/`. They are the files of the dataset branch at its commit 83834c3, whole, with one change: `highlightReference` takes one argument on this branch, so seven calls lose their `, 0` (one in `labels.ts`, two each in `check-table-parser.ts`, `check-samples.ts` and `invariants.test.ts`). The dataset is finished at that commit, and every number in this folder is of it. The dataset branch goes on after it with a folder `lab/recovery-parser/written/`, which is no part of the dataset and is kept out of this branch on purpose: a merge takes the commit, not the branch's tip. After a merge of a later commit of the dataset:

1. Take the dataset branch's version of every dataset file, and make those calls take one argument again. `bunx tsc -p lab/recovery-parser` names every such call.
2. Run `bun test lab/recovery-parser`, `bun lab/recovery-parser/check-samples.ts` and `bun lab/recovery-parser/check-table-parser.ts`.
3. Run `bun lab/recovery-parser/learn/check-all.ts`. The cache of the samples is made again by itself, since its name holds a key of the dataset's source files, and every record of an arm holds that key as `datasetKey`.
4. Every number in the READMEs is then of another dataset: make the tables again with the commands above. Tables and records that were saved under `RECOVERY_SCRATCH` before are of the old dataset.

**A later commit of the dataset can move a sample from one split to another.** E.g. between the commit that the numbers of this folder were of before (3bf415c) and the commit that they are of now (83834c3), nine commits later, 176 of the 60,000 indexes of the standard set went from the train split to the test split and 173 from the train split to the validation split, by a count of the splits alone. Tables that were trained before such a commit have trained on samples that are scored after it. So every saved file of tables holds the dataset's key of the moment it was saved, a71c027d33a5cd7b for the dataset as it is, and:

- `arms/final.ts`, `search/search.ts --from`, `soft/train.ts --base`, and `numberToBeat` and `savedResultOf` of `arms/harness.ts` refuse a file with another key or without one. Make the tables again.
- `compare.ts`, `score.ts`, `check-deep.ts`, `intended-reached.ts`, `search/mistakes.ts` and the scripts of `handwritten/` that take `--tables` load such a file and print a line that starts with "Note:".

So take the dataset's last commit before the arms start, or keep one commit of the dataset up to and including the final numbers.

The baselines of `arms/harness.ts` follow the dataset's list of hand rules, so a hand rule that a later commit adds gets a row by itself. The rule `lines` came so, at 83834c3, with a tokenizer state of its own.

In code:

```ts
import {loadStandardSamples} from './data.ts'
import {actionNone, asIsTables, grammarCellOf, grammarStateNames, saveTables, tokenNames} from './recovery-tables.ts'
import {scoreTables, sharesOf} from './score.ts'

const samples = loadStandardSamples()
const tables = asIsTables()
// A comma where a value should come, in an array at depth 1: stay in the state `value` instead of `error`.
const cell = grammarCellOf(tables, grammarStateNames.indexOf('value'), tokenNames.indexOf('comma'), 2)
tables.grammarNext[cell] = grammarStateNames.indexOf('value')
tables.grammarAction[cell] = actionNone
const score = scoreTables(tables, samples)
console.log(sharesOf(score.rows[0]!).allThree)
saveTables(`${process.env['RECOVERY_SCRATCH']}/one-cell.json`, tables, 'one changed cell')
```

## Not settled

- **Should a recovering highlighter still mark the damage?** The labels say what kept code points are. Nothing says how an added code point should be shown, e.g. a stray closing bracket or the second quote of a doubled quote, so the best tables show no error anywhere. The numbers are in every score and in every record. A label `error` for some added code points would put them into the main number.
- **Valid JSON that is too deep.** Either such texts go into the dataset, with today's depths as labels, or an arm's tables have to pass `check-deep.ts --must-hold`. Of the tables above, the dataset's hand rules, the hand-written rules, the votes and three seeds of the trainer's plain pass pass it. Every record of an arm holds the two shares.
- **Should a tokenizer cell be allowed an event of a text's end at all?** The search leaves them out. The core still allows them, so a trained cell can snap to one, and `checkTables` accepts it.
- **Added character classes.** 6.5% of the broken validation samples are in the group "needs a character class", e.g. a string in single quotes with a space in it. The dataset names the class that a sample needs, and a sample can need two, e.g. the apostrophe as a quote and the backtick as a quote in a Node print with `'two words'` next to `` `5' 11"` ``. The most frequent class text among the train and validation samples of the standard set is "the apostrophe as a quote", 1,762 samples, and "the backtick as a quote" has 20. `addClasses` adds classes, see `structure/README.md`, and no arm has used it. The hand-written rules read such strings as words, which is why they have 92.2% of that group.
- **Keeping a run on track.** It costs score, see `soft/README.md`. States taken from tables that already recover, e.g. the trace of the hand-written tables on the broken text, were proposed in a review and are not built.
- **The test split, the held-out kinds and the held-out template** were never scored by anything here.
