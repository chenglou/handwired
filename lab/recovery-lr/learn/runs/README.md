# The frozen recipe, run for real on the validation split

The recipe of `../recipe.ts` was run with no setting changed, on the first 40,000 train samples, and scored on the 5,000 validation samples. This folder holds the two commands and the numbers.

**What these numbers are, and are not.** They are of the validation split, which is one draw of the damage, made by a generator that knows nothing of the language. No held-back set was read and no test split was scored. The review of the machinery (the parser, the score, the twin, the trainer) had not finished when the runs started, so a fault that the review finds may change them. Nothing was tuned after a number was seen.

## Commands

Run from the repo root. `RECOVERY_LR_SCRATCH` is a folder outside the repo. The tables and records go to `--folder`, or to `<RECOVERY_LR_SCRATCH>/runs/neutral`. `<scratch>` stands for the experiment's scratch folder, which is outside the repo and which other pages name `recovery-scratch`.

```sh
export RECOVERY_LR_SCRATCH=<scratch>/transfer/lr/build/runs
F=<scratch>/transfer/lr/runs/neutral
bun lab/recovery-lr/learn/runs/run.ts --rows 9,10 --seed 1 --folder $F    # seeds 1 to 5: one training gives both rows
bun lab/recovery-lr/learn/runs/run.ts --rows 11 --seed 11 --folder $F     # seeds 11, 12, 13: the search and the count without training
bun lab/recovery-lr/learn/runs/run.ts --rows 12 --seed 1 --folder $F      # seeds 1 to 5: row 9 without the choice "end an item early"
bun lab/recovery-lr/learn/runs/table.ts --folder $F --bars-train 40000    # the two tables below, 12 s
```

`run.ts` calls `rowsOfRecipe` of `../recipe.ts` as it stands, saves `row-9.seed-1.tables.json` and `row-9.seed-1.record.json` per row, and refuses to run a row again that has a record unless `--again` is given. A record holds the settings, the seed, the commit, the times, the scores on the validation split (of the row's tables, of the tables that the row started from, of the snapped tables after the training alone), the score on the train split, and the recipe's log. `--train` and `--validation` take fewer samples to try the command, and then `--folder` has to be given.

`table.ts` reads every record of the folder and scores the bars on the same validation samples. `runs.ts` holds what the two share.

Three runs went at the same time, each with the trainer's 4 worker threads, as the recipe sets them. One command of the rows 9 and 10 took 50 s: 20 s to make and pack the samples, 19 to 20 s for the three passes of the training, 8 to 9 s for the search. Row 11 took 29 s per seed and row 12 32 to 46 s. All 18 runs were done in under 4 minutes of running.

## The numbers

Dataset `60c821012d537395`, the 5,000 validation samples with 678,386 scored code points. The rows of the recipe were made from the 40,000 train samples. A number with brackets is the mean of the seeds with the lowest and the highest. Every number but the last column is a percentage. "All three" is the share of scored code points with the display kind, the depth and the container all right, and "whole" the share of samples with all three right at every scored code point. The counts of the first eight bars were made on the same 40,000 train samples. The three hand-made bars are the ones that their folders saved, and their numbers are the ones in their READMEs.

| parser | seeds | all three | whole | kind | depth | container | stack | whole by stack | constituents after the first error: found | the same: right | inserted per sample |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bar: the parser as it is |  | 2.02 | 0.00 | 29.1 | 18.9 | 13.8 | 0.14 | 0.00 | 1.0 | 40.0 | 0.00 |
| bar: skip every rejected token, dropped tokens shown as errors |  | 28.65 | 7.78 | 56.4 | 33.7 | 42.0 | 26.35 | 6.06 | 40.8 | 90.2 | 0.00 |
| bar: skip every rejected token, with the count |  | 29.45 | 12.32 | 60.1 | 33.7 | 42.0 | 26.35 | 6.06 | 40.8 | 90.2 | 0.00 |
| bar: panic mode, dropped tokens shown as errors |  | 60.28 | 22.30 | 92.5 | 62.8 | 90.1 | 56.40 | 16.82 | 81.3 | 94.6 | 0.00 |
| bar: panic mode, with the count |  | 60.84 | 27.58 | 93.8 | 62.8 | 90.1 | 56.40 | 16.82 | 81.3 | 94.6 | 0.00 |
| bar: panic mode that keeps the reductions made at a rejected token, with the count |  | 60.13 | 24.08 | 93.0 | 62.0 | 88.8 | 55.92 | 14.10 | 85.9 | 96.1 | 0.00 |
| bar: the nearest table to panic mode: pop where bison reports, dropped tokens shown as errors |  | 58.62 | 10.58 | 82.2 | 60.8 | 76.8 | 56.37 | 8.18 | 70.8 | 90.2 | 0.00 |
| bar: the nearest table to panic mode: pop where bison reports, with the count |  | 59.18 | 11.68 | 83.0 | 60.8 | 76.8 | 56.37 | 8.18 | 70.8 | 90.2 | 0.00 |
| bar: yacc error productions, with the count |  | 83.08 | 37.10 | 94.3 | 84.6 | 91.2 | 72.49 | 17.96 | 92.4 | 94.5 | 0.44 |
| bar: panic mode with a hand-written list of synchronizing tokens, with the count |  | 78.73 | 34.62 | 92.7 | 81.2 | 88.0 | 75.25 | 24.06 | 84.5 | 94.1 | 0.00 |
| bar: a table filled by hand-written rules, with the count |  | 88.03 | 48.66 | 95.6 | 89.5 | 94.7 | 81.94 | 34.80 | 94.5 | 96.2 | 1.54 |
| row 9: training, then the count | 1, 2, 3, 4, 5 | 82.87 (81.69 to 84.25) | 35.88 (33.12 to 37.78) | 94.7 (94.3 to 95.0) | 85.2 (83.8 to 86.2) | 91.1 (90.6 to 92.1) | 74.94 (74.54 to 75.55) | 21.72 (20.44 to 23.04) | 89.8 (88.8 to 91.1) | 94.0 (93.4 to 94.7) | 3.43 (2.11 to 4.01) |
| row 10: training, then the search, then the count | 1, 2, 3, 4, 5 | 88.10 (87.71 to 88.50) | 48.37 (47.62 to 49.84) | 95.7 (95.5 to 95.9) | 90.0 (89.7 to 90.4) | 94.3 (94.2 to 94.4) | 78.49 (77.36 to 79.27) | 26.78 (25.32 to 27.52) | 93.7 (93.5 to 93.9) | 95.7 (95.5 to 95.9) | 1.84 (1.58 to 2.09) |
| row 11: the search and the count, without training | 11, 12, 13 | 87.40 (87.33 to 87.54) | 44.51 (43.38 to 45.84) | 95.0 (94.9 to 95.2) | 89.7 (89.6 to 90.0) | 94.0 (93.8 to 94.1) | 80.78 (80.15 to 81.39) | 29.83 (28.94 to 31.46) | 93.2 (93.0 to 93.5) | 95.7 (95.6 to 95.8) | 1.67 (1.56 to 1.81) |
| row 12: training, then the count, without "end an item early" | 1, 2, 3, 4, 5 | 75.05 (72.16 to 76.70) | 30.47 (27.78 to 34.60) | 94.8 (94.0 to 95.2) | 78.2 (75.6 to 80.0) | 90.6 (89.1 to 92.2) | 66.25 (63.50 to 67.91) | 16.84 (14.90 to 18.88) | 88.7 (87.1 to 91.1) | 94.4 (94.0 to 94.7) | 4.91 (3.64 to 6.03) |

**Two bars are stronger since these runs.** A review of the machinery, after the runs, gave yacc error productions one more rule and panic mode with a hand-written list one more choice. On the same validation samples they now have 84.45 / 39.28 and 78.88 / 35.56 (all three / whole), see `../bars/yacc/README.md` and `../bars/panic/README.md`. The table above and the bullets below keep the numbers of the bars as they were when the runs were made. With the stronger yacc bar, row 9 is 1.6 points below it in all three, not level with it.

Per run. "All three" and "whole" are of the validation split unless the column says otherwise.

| row | seed | all three | whole | all three on the train split | whole on the train split | all three after the training alone | cells changed | display entries changed | training, s | search, s | commit | sha256 of the tables |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 9 | 1 | 84.25 | 37.78 | 85.37 | 39.72 | 84.18 | 2113 | 2316 | 19 | 0 | 7e585fe | dc7ca1b5f0722d32 |
| 9 | 2 | 81.69 | 35.72 | 82.66 | 37.09 | 81.56 | 2044 | 2376 | 20 | 0 | 7e585fe | 06ceccc2a766a090 |
| 9 | 3 | 83.29 | 35.48 | 84.50 | 36.92 | 83.23 | 2112 | 2349 | 20 | 0 | 7e585fe | 3935c1ae78620b0e |
| 9 | 4 | 82.89 | 37.32 | 84.29 | 39.03 | 82.84 | 2126 | 2389 | 20 | 0 | 5661ac7 | 8c86325fae7c9d7c |
| 9 | 5 | 82.21 | 33.12 | 82.96 | 34.15 | 82.09 | 2088 | 2363 | 19 | 0 | 5661ac7 | d1ae792664ca5440 |
| 10 | 1 | 88.50 | 48.20 | 89.78 | 50.46 | 84.18 | 2545 | 2315 | 19 | 9 | 7e585fe | 27d858bbb435dd88 |
| 10 | 2 | 87.71 | 47.90 | 89.20 | 49.38 | 81.56 | 2564 | 2370 | 20 | 9 | 7e585fe | feeafad166bb5250 |
| 10 | 3 | 88.38 | 47.62 | 89.80 | 49.69 | 83.23 | 2618 | 2354 | 20 | 9 | 7e585fe | 3b267e1b7f874e4d |
| 10 | 4 | 87.87 | 48.28 | 89.23 | 50.22 | 82.84 | 2535 | 2394 | 20 | 8 | 5661ac7 | 24db8e0c9a8f4783 |
| 10 | 5 | 88.04 | 49.84 | 89.49 | 51.09 | 82.09 | 2579 | 2358 | 19 | 8 | 5661ac7 | 75b54e9171a4d7d6 |
| 11 | 11 | 87.54 | 43.38 | 88.72 | 44.58 | none | 1990 | 215 | 0 | 9 | 5661ac7 | c1d9f3650123c9b0 |
| 11 | 12 | 87.33 | 45.84 | 88.49 | 47.62 | none | 2125 | 203 | 0 | 9 | 5661ac7 | 5d51b9e8f4e71c4a |
| 11 | 13 | 87.33 | 44.32 | 88.64 | 46.12 | none | 2040 | 181 | 0 | 9 | 5661ac7 | 39de136ad8757f7e |
| 12 | 1 | 74.26 | 28.00 | 76.40 | 29.54 | 74.21 | 2102 | 2372 | 18 | 0 | 5661ac7 | ccb5f1b8b8fd5d09 |
| 12 | 2 | 76.64 | 29.18 | 78.58 | 30.49 | 76.53 | 2040 | 2365 | 23 | 0 | 5661ac7 | 02d0611f241b9f2c |
| 12 | 3 | 72.16 | 27.78 | 73.81 | 28.79 | 72.09 | 2136 | 2418 | 24 | 0 | 5661ac7 | 5e18a524547ea59a |
| 12 | 4 | 75.51 | 32.80 | 77.59 | 33.87 | 75.29 | 2079 | 2401 | 23 | 0 | 5661ac7 | d5065f6650ffc399 |
| 12 | 5 | 76.70 | 34.60 | 78.25 | 35.63 | 76.62 | 2105 | 2400 | 14 | 0 | 5661ac7 | cbce9f273f4aa167 |

The two commits differ from `0110f29` only by the files of this folder. No file under `lab/recovery-lr` differed from the commit when a run started. In every run the rule of step 2 picked `|` and `&` for a terminal of their own, and 5,102 cells could change.

## What the numbers say

- **Row 9, the training and the count, is above panic mode and level with yacc error productions, and below the table filled by hand.** Its 82.87 of all three is 22 points above panic mode without knowledge (60.84) and 4.1 above panic mode with a hand-written list (78.73), with every seed above both. It is 0.2 below yacc error productions (83.08), with two of five seeds above. It is 5.2 below the table filled by hand-written rules (88.03), with every seed below, and 12.8 below it in whole samples (35.88 against 48.66).
- **The search adds 5.2 points, and it does nearly as well without the training.** Row 10 has 88.10 of all three and 48.37 whole samples, level with the hand-written rules (88.03 and 48.66), and its seeds are 0.8 points apart where row 9's are 2.6 apart. But row 11, the search and the count from the parser as it is, has 87.40 and 44.51. So on this table the training gives the search 0.7 points of all three and 3.9 of whole samples, and the search alone is 4.5 points above the training alone. On the stack the order turns: row 11 has 80.78, row 10 has 78.49 and row 9 has 74.94, so the training lowers what the search reaches there.
- **The training does not fit its own train split closely.** Row 9 has 83.96 of all three on the train split, the mean of five seeds, which is 1.1 above its validation score. So it is not a case of learning the train samples by heart. The same tables after the search have 89.50 on the train split, so the cells can hold 5.5 points more of the train split than the training finds. At the end of the training the largest share of a cell was 0.78 to 0.79, the loss per code point was 0.90 to 1.05, and the shares read as the snapped tables at 84.5 to 89.0% of the reads: the training had not settled on a choice per cell after its three passes.
- **The count after the training adds almost nothing**: 82.78 before it and 82.87 after, since the training trains the display entries too.
- **Odd: the trained tables run into the limit of 16 steps often, and insert a lot.** On the 5,000 validation samples the tables of row 9 skip 3,673 to 4,307 tokens after 16 steps (seeds 1, 2 and 5 were looked at), where row 10 skips 889 (seed 1), row 11 skips 954 (seed 11) and the hand-written rules skip 61. Row 9 inserts 3.43 tokens per sample, twice what row 10 (1.84) and the rules (1.54) insert. So part of row 9's score rests on cells that loop until the limit cuts them off.
- **Odd: the search never came to rest.** Every one of the 8 searches (5 of row 10, 3 of row 11) ended because its 4 passes were over, not because a pass changed nothing, after 1,680 to 2,079 changes of a cell from the trained tables and 3,027 to 3,296 from the parser as it is. The 4 passes are the recipe's setting and were kept.
- **Without "end an item early" row 9 loses 7.8 points** (75.05 against 82.87) and falls below panic mode with a hand-written list. Its tables hit the limit of 16 steps even more often: 5,462 tokens for seed 1.

## Where the files are

`<scratch>/transfer/lr/runs/neutral/` holds the 18 tables `row-<row>.seed-<seed>.tables.json`, a record next to each, `logs/` with what every command printed, `table.md` with the output of `table.ts` as above, and `table.bars-5000.md` with the same when the counts of the bars are made on 5,000 train samples as in the command of `../bars.ts`: no bar moves by more than 0.03 of all three, and the whole samples of "skip every rejected token, with the count" go from 12.32 to 11.54.

A saved table was checked by another route: `bun lab/recovery-lr/learn/score.ts --tables <the tables of row 9, seed 1>` gives the record's 84.25 and 37.78. And seed 1 of the rows 9 and 10 was run a second time, alone on the machine (37 s), into another folder: both tables came out the same byte for byte, so running three seeds at once changed nothing.
