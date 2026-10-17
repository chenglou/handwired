# One hand-written rule for the lines, then the training

The question: the TOML track held the recipe's training against one rule that takes no training, "after an error, start anew at the next line", and the training alone did not beat it (row 4 of `../runs/README.md`). The project's owner said that this comparison is harsh on the training: TOML is written line by line, so one small hand-written rule for the lines is cheap and fair, and the training should then do the rest. This folder tries exactly that: the rule is set by hand in the tables, and the recipe's gradient training runs on the other cells with no other setting changed.

**The idea came after the track's final scoring.** Every number here is on the validation split of the standard set, 5,382 samples with 709,413 scored code points, for a new variant that was thought of after the test split had been scored once. They are not a result on unseen data, and nothing here read the test split, the folder `held-back/` or `RESULTS.md`.

**State of this file: written on October 16, 2026 under a deadline of 17:00.** Both variants below have the seeds 1, 2 and 3 for the training with the count. The search ran only for the seeds whose training ended before 16:35: the seeds 1 and 2 of the fixed variant and the seed 1 of the trainable one.

## The rule, as cells

The rule in words: after an error, the rest of the line is skipped, and the line end starts the next line as a fresh line with no open container. `run.ts` sets it on the recipe's base (today's tables with the 18 classes that the recipe's rule picks, open display entries and the bit "first on its line") as three groups of cells. `run.ts --base` prints each cell with what it holds today and what the rule puts there.

| group | cells | what the rule puts there |
| --- | --- | --- |
| tokenizer cells of a line end | 142 open cells, 139 changed and 3 that hold the choice already | In every tokenizer state, a line feed gives the event `newline` and leads between tokens, and a carriage return gives `newline` and leads into the state `carriageReturn`. E.g. inside a string of one line, where the line feed is `controlCharacterInString` today. These are the cells of the hand-written rule "a line end ends a token" of `../handwritten/rules.ts`. A string of several lines keeps its line ends, by frozen cells. |
| grammar cells of a line end | 71 open cells, 70 changed and 1 that holds the choice already | The token `newline` leads into the state `lineStart`: at depth 0 in every grammar state but `error` (25 cells), and at depth 1 in every state whose cell leads into `error` today (46 cells), where the cell also closes the one open container, e.g. after `point = {x = 1` without its closing brace. The hand-written rule "a line end at the top level" names 18 of the cells of depth 0. |
| grammar cells that wait for the line end | 1,408 open cells, all changed | At depth 0 and at depth 1, every open cell that leads into the state `error` today stays in its state and changes no depth, for every token but the line end and the end of the text. E.g. after the colon of `port: 80`, the grammar stays in the state "after a key" until the line end. |

The third group is far larger than the other two, and the rule does not work without it. Today a grammar error leads into the state `error`, and the whole row of that state is one of the recipe's kept settings: a valid text with a value of more than 16 levels is in that state from its 17th bracket on and has to be shown as today. So the state `error` cannot be given a way out at the line end, and the cells that lead into `error` have to wait in their own state. With the first two groups alone, the base only recovers when the error is the line end itself: 65.74 in all three, 20.10 in whole samples.

What the cells cannot do that the one rule of `../restart-at-next-line.ts` does: that rule sets the depth to 0 from any depth, and a cell can close one container. So an error at depth 2 or more is not covered by the hand-set cells. The other way round, the cells show the rest of the line of the error by the state that the grammar waits in, where the one rule shows it as the parser as it is does.

The cells of depth 1 were added after a look at the validation split: with the cells of depth 0 alone, 142 tokenizer cells and 501 grammar cells, the base has 81.81 in all three, 40.36 in whole samples and 75.31% of the header names, since an error inside an array or an inline table of one line still led into the state `error`. That was the one change of the rule, and it was made before any training ran. `LINE_RULE_TOP_ONLY=1 bun lab/recovery-toml/learn/line-rule/run.ts --base` scores that first form.

No other hand-written rule is in: no class is chosen by hand, no display entry is set by hand, and no cell is set for a container that lost its bracket, a value without an equals sign and so on.

## What the training may change

The cells of a line end, 142 of the tokenizer and 71 of the grammar, are kept out of the training and of the search, the way the recipe keeps its 378 kept grammar cells: they are not trainable and hold the base's choice. For the 1,408 cells that wait there are two variants, `--waiting-cells` of `run.ts`:

- **fixed**: they are kept out too. This is the variant that was asked for, "keep the cells of the rule fixed". The training has 3,664 of the 3,806 open tokenizer cells, 3,765 of the 5,622 open grammar cells and every open display entry. The grammar cells that are left to it are those of depth 2 and more and those that do not lead into `error` today, so at depth 0 and 1 the training can change what the tokenizer says and what is shown, but not where the grammar goes after an error.
- **trainable**: they are set in the base and the training may change them, from the recipe's share of 0.9 on the base's choice, as it may change every other open cell. The training has 5,173 of the 5,622 open grammar cells. This variant was not asked for. It was added because the fixed variant leaves the training little of the grammar at depth 0 and 1, so a low number of the fixed variant could be read as "the training had nothing left to set". Three seeds, with the search for the first one only, see below.

Everything else is the recipe's, called from `../recipe.ts`: the classes of its rule, its kept cells, no events of a text's end in a trained tokenizer cell, 3 passes over the 42,082 train samples of the dataset as it is, batches of 32, learning rate 0.05, 4 worker threads, then the count and today's kinds in the state `error`. Row (c) has the recipe's search of four passes before the count, over the same cells that the training may change.

## The numbers

On the validation split. "Header names after an error" is the share of the 50,459 code points of a header's name at or after a first error that are shown as a header name with the right depth and container, the number in which row 4 lost to the one rule. A number with brackets is the mean of the seeds with the lowest and the highest. `table.ts` prints the table from the saved tables.

| | seeds | all three | whole samples | header names after an error |
| --- | --- | --- | --- | --- |
| the parser as it is | no training | 64.14 | 12.02 | 0.00 |
| the one rule: anew at the next line after an error | no training | 91.45 | 36.03 | 94.82 |
| row 4: the recipe's training, then the count | 1, 2, 3, 4, 5 | 90.70 (89.23 to 91.68) | 33.64 (32.48 to 35.23) | 49.50 (36.69 to 56.15) |
| the 39 hand-written rules | no training | 94.87 | 50.67 | 96.93 |
| row 5: the recipe's training, the search, then the count | 1, 2, 3, 4, 5 | 96.51 (96.37 to 96.63) | 55.59 (54.31 to 57.30) | 97.40 (97.22 to 97.70) |
| row 6: the search and the count without the training | 11, 12, 13 | 95.82 (95.62 to 95.94) | 51.14 (48.42 to 53.34) | 96.88 (96.62 to 97.32) |
| (a) the base with the cells of the line rule, no training | no training | 88.71 | 43.74 | 89.56 |
| (a) with the count | no training | 89.81 | 43.53 | 89.59 |
| (b) the line rule, the training, then the count; waiting cells fixed | 1, 2, 3 | 94.16 (94.15 to 94.18) | 46.23 (45.39 to 46.79) | 94.46 (94.24 to 94.62) |
| (c) the same with the search before the count; waiting cells fixed | 1, 2 | 94.22 (94.15 to 94.28) | 47.13 (46.66 to 47.60) | 95.32 (95.12 to 95.52) |
| (b) the line rule, the training, then the count; waiting cells trainable | 1, 2, 3 | 95.71 (95.54 to 95.90) | 52.92 (52.43 to 53.27) | 95.36 (94.98 to 95.79) |
| (c) the same with the search before the count; waiting cells trainable | 1 | 96.44 | 57.79 | 96.98 |

On the train split, row (b) has 94.65, 94.67 and 94.56 in the fixed variant and 96.23, 95.99 and 96.17 in the trainable one, so neither is far from its validation number.

## What ran and what did not

All times are local, October 16, 2026. Until about 16:33 the machine was running seven to ten trainings of other work (a load of 40 to 60 on 18 cores), so the first three trainings took 17 to 18 minutes each. The later three took 8 to 10 minutes.

- `run.ts --base` scored row (a).
- The fixed variant, seeds 1 and 2: started at 16:13, trainings of 1,021 and 1,025 seconds, row (b) saved at 16:30. That was before 16:35, so the search ran too: 82 and 81 seconds, four passes, row (c) saved at 16:32.
- The trainable variant, seed 1: started at 16:14, a training of 1,105 seconds, row (b) saved at 16:33, the search of 35 seconds, row (c) saved at 16:33.
- The trainable variant, seeds 2 and 3: started at 16:33, when the first seed had come out far above the fixed variant. Trainings of 607 and 608 seconds on a machine with less other work by then, row (b) saved at 16:43. That was after 16:35, so no search ran for them, and row (c) of this variant has one seed.
- The fixed variant, seed 3: started at 16:13 with the others and stopped by hand at 16:21, when the load made it look as if four trainings would not end before the deadline. Started again at 16:31 and stopped at 16:33, to give the machine to the seeds 2 and 3 of the trainable variant. Started a third time at 16:36, without the search: a training of 503 seconds, row (b) saved at 16:44.
- The checks of `../runs/check.ts` ran on all eleven saved files of tables, the two of row (a) with `--tables` and the nine of rows (b) and (c) with `--folder`: every check passed. Frozen cells hold today's, 48,909 valid texts get today's trace at every position, 48,247 broken texts keep today's trace up to their first error, and 2,000 valid texts with a value of more than 16 levels are shown as today. In every saved file the cells that the training may not change hold the rule's choice.
- `run.ts` is committed as the trainings read it: its sha256 in every record is the one of the file in the commit `7a7c7c8`. The first records say that the file was not committed, since those trainings started a minute before that commit. The commit after the runs changed comments of `run.ts` only, and the base that the changed file makes has the same tables byte for byte.

## What the numbers say

- **With the lines set by hand, the gradient training alone is above the one rule, which it was not without them.** The fixed variant has 94.16 in all three and 46.23 in whole samples, the trainable variant 95.71 and 52.92, against 91.45 and 36.03 for the one rule and 90.70 and 33.64 for row 4. Header names after an error are right at 94.5% and 95.4%, against 49.5% in row 4: that loss is gone. The seeds are close to each other, 0.36 points of all three from the lowest to the highest in the trainable variant, where the five seeds of row 4 were 2.5 points apart.
- **Against the 39 hand-written rules (94.87 and 50.67), the two variants fall on the two sides.** The fixed variant is 0.71 points of all three and 4.4 points of whole samples below them, in each of its three seeds. The trainable variant is above them in each of its three seeds, by 0.84 and 2.25 in the mean, without a search, and at the level of row 6, the search without a training (95.82 and 51.14).
- **Keeping the 1,408 waiting cells fixed holds the result down.** With them fixed, the grammar at depth 0 and 1 can only skip to the line end, and the search adds next to nothing on top: 94.22 and 47.13 on the seeds 1 and 2, which is 0.05 and 1.2 above the same two seeds without it, and below row 6, which has no hand-set cell at all. Left trainable, the training changed 830 to 867 of the 1,408 cells, at most 2 of them back into the state `error`, and gained 1.55 points of all three and 6.7 points of whole samples over the fixed variant. So what helps is the rule as the place where the training starts, with the cells of a line end fixed. Keeping the waiting cells out of the training as well costs more than it gives.
- **After the search the rule makes no difference that one seed can show.** The trainable variant with the search has 96.44 and 57.79 on its one seed, and row 5, the recipe's training and search without any hand-set cell, has 96.51 (96.37 to 96.63) and 55.59 (54.31 to 57.30). The search finds the lines by itself, as row 6 already said.
- **The rule alone, as cells, is not the one rule.** Row (a) has 88.71 in all three, 2.74 below the one rule, and 43.74 in whole samples, 7.7 above it. The two differ in what is named above: the cells do not cover an error at depth 2 or more, and they show the rest of the line of the error by the state that the grammar waits in. How much of the 2.74 points each of the two is was not measured. And the rule is one sentence but 1,621 cells, of which 1,408 are only there because the recipe keeps the row of the state `error`.

What these numbers are not: a result on unseen data. The variant was thought of after the track's final scoring, the split is the validation split, and the two variants are read against each other on it. The depth 1 cells of the rule were also added after a look at it.

## Files

- `run.ts`: the cells of the rule (`lineCellsOn`), the share of header names (`headerNamesAfterAnError`), and the run of one seed. `--base` prints the cells and scores the base without a training.
- `table.ts`: the table above.
- Saved outside the repo, in `recovery-scratch/transfer/toml/runs/line-rule/`: `base/` with the tables of row (a), `waiting-cells-fixed/` and `waiting-cells-trainable/` with the tables and records of rows (b) and (c) in the format of `../runs/run.ts` (`row-4` is (b), `row-5` is (c)), the logs, `base.log` with every cell of the rule, `table.md` and the output of the checks.
