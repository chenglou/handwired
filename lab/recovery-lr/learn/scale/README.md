# Gradient training with more passes and more train samples

The frozen recipe of `../recipe.ts` trains for 3 passes over 40,000 train samples, with settings that were tuned for JSON. Its row 9, the training and the count, is about 5 points of all three below the search and below the table filled by hand-written rules (see `../runs/README.md`). Two signs there suggested that the training is cut short: the largest share of a cell is only 0.78 to 0.79 after the three passes, and the trained tables run into the limit of 16 steps about 4,000 times on the validation split. This folder measures what the same gradient training reaches on the validation split when it gets more passes and more train samples.

**What these numbers are, and are not.** This study changes settings on purpose, and the settings were chosen with the scores of the validation split in view. So its numbers are not rows of the frozen recipe and not results on unseen data. Only the train and the validation split were read. No held-back set was read and no test split was scored.

## Commands

Run from the repo root. `RECOVERY_LR_SCRATCH` is a folder outside the repo.

```sh
export RECOVERY_LR_SCRATCH=<scratch>/transfer/lr/build/runs
F=<scratch>/transfer/lr/runs/scale
bun lab/recovery-lr/learn/scale/run.ts --seed 1 --train 40000 --passes 30 --at 1,2,3,5,10,20,30 --search --folder $F          # seeds 1, 2, 3
bun lab/recovery-lr/learn/scale/run.ts --seed 1 --train 400000 --passes 3 --at 1,2,3 --search --folder $F                     # seeds 1, 2, 3
bun lab/recovery-lr/learn/scale/run.ts --seed 1 --train 160000 --passes 3 --at 1,2,3 --folder $F                              # seeds 1, 2, 3
bun lab/recovery-lr/learn/scale/run.ts --seed 1 --train 40000 --passes 10 --at 1,2,3,5,10 --learning-rate 0.01 --folder $F    # seeds 1, 2, 3
bun lab/recovery-lr/learn/scale/table.ts --folder $F                                                                          # the table below
```

`run.ts` is one training for one seed, with the recipe's trainer, twin, batch of 32, rate of 0.05 and share of 0.9 on the base's choice at the start unless an option says otherwise. It saves the snapped tables after each pass that `--at` names. The trainer has no schedule and draws the order of a pass from the seed and the pass, so the tables after pass 3 of a training of 30 passes are the tables of a training of 3 passes: the saved points after pass 3 give 84.25, 81.69 and 83.29 of all three for the seeds 1, 2 and 3, which are the numbers of row 9 for these seeds in `../runs/README.md`. Every saved point gets the recipe's count over the train samples of the run, and a record with the scores on the validation split and on the run's own train samples. With `--search`, the tables after the last pass also go through the recipe's search (4 passes) and count, over the train samples of the run.

The added terminals (`|` and `&`) are always picked from the first 40,000 train samples, so every run trains the same 5,102 cells whatever its count of train samples is.

## Can the dataset give more train samples soundly

Yes, for the validation split. `../../dataset.ts` makes sample `index` from program `index` and stores nothing, and a program is a validation program when a hash of its list of tokens is 0 modulo 9, whatever its index is. The first 400,000 train samples are the train programs among about the first 450,000 indexes. So a train program stays a train program, no validation program enters the train samples, and no program with the tokens of a validation program does either. The first 40,000 of the larger sets are the 40,000 of the recipe's runs. The held-back sets were made by other agents and were not read, so nothing was checked against them.

## The numbers

Dataset `60c821012d537395`, the 5,000 validation samples. Every number but the counts and the seconds is a percentage or a share. A number with brackets is the mean of the seeds with the lowest and the highest. "All three" is the share of scored code points with the display kind, the depth and the container all right, "whole" the share of samples with all three right at every scored code point, and "stack" the share of scored code points with the stack right. "Largest share of a cell" is the mean over the trained cells and display entries of the largest share when the tables were snapped. The first five rows are copied from `../runs/README.md`.

<!-- the output of table.ts -->
| steps | train samples | passes | steps of Adam | rate | share at the start | seeds | all three | whole | stack | largest share of a cell | tokens skipped at the limit of 16 steps | all three on its train samples | whole on its train samples | cells changed | training, s | search, s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bar: yacc error productions, with the count | 40000 | | | | | | 83.08 | 37.10 | 72.49 | | | | | | | |
| bar: a table filled by hand-written rules, with the count | 40000 | | | | | | 88.03 | 48.66 | 81.94 | | 61 | | | | | |
| row 9 of the frozen recipe: training, then the count | 40000 | 3 | 3750 | 0.05 | 0.9 | 1, 2, 3, 4, 5 | 82.87 (81.69 to 84.25) | 35.88 (33.12 to 37.78) | 74.94 (74.54 to 75.55) | 0.78 to 0.79 | 3673 to 4307 | 83.96 (82.66 to 85.37) | 37.38 (34.15 to 39.72) | 2097 (2044 to 2126) | 20 (19 to 20) | |
| row 10 of the frozen recipe: training, then the search, then the count | 40000 | 3 | 3750 | 0.05 | 0.9 | 1, 2, 3, 4, 5 | 88.10 (87.71 to 88.50) | 48.37 (47.62 to 49.84) | 78.49 (77.36 to 79.27) | 0.78 to 0.79 | 889 | 89.50 (89.20 to 89.80) | 50.17 (49.38 to 51.09) | 2568 (2535 to 2618) | 20 (19 to 20) | 9 (8 to 9) |
| row 11 of the frozen recipe: the search and the count, without training | 40000 | 0 | 0 | | | 11, 12, 13 | 87.40 (87.33 to 87.54) | 44.51 (43.38 to 45.84) | 80.78 (80.15 to 81.39) | | 954 | 88.62 (88.49 to 88.72) | 46.11 (44.58 to 47.62) | 2052 (1990 to 2125) | 0 | 9 (9 to 9) |
| training, then the count | 40000 | 1 | 1250 | 0.05 | 0.9 | 1, 2, 3 | 81.22 (80.18 to 82.60) | 32.93 (30.48 to 34.48) | 73.99 (72.80 to 75.44) | 0.771 (0.768 to 0.773) | 3802 (3302 to 4747) | 82.27 (81.44 to 83.55) | 34.17 (32.36 to 35.79) | 1105 (1031 to 1158) | 9 (9 to 10) | 0 (0 to 0) |
| training, then the count | 40000 | 2 | 2500 | 0.05 | 0.9 | 1, 2, 3 | 83.05 (81.46 to 85.15) | 36.07 (34.46 to 39.16) | 75.04 (74.03 to 76.22) | 0.777 (0.774 to 0.779) | 4004 (2290 to 4937) | 84.36 (82.79 to 86.39) | 37.57 (35.92 to 40.49) | 1743 (1732 to 1750) | 18 (18 to 18) | 0 (0 to 0) |
| training, then the count | 40000 | 3 | 3750 | 0.05 | 0.9 | 1, 2, 3 | 83.08 (81.69 to 84.25) | 36.33 (35.48 to 37.78) | 74.95 (74.54 to 75.55) | 0.785 (0.784 to 0.786) | 3904 (3673 to 4234) | 84.18 (82.66 to 85.37) | 37.91 (36.92 to 39.72) | 2090 (2044 to 2113) | 26 (26 to 27) | 0 (0 to 0) |
| training, then the count | 40000 | 5 | 6250 | 0.05 | 0.9 | 1, 2, 3 | 83.21 (82.13 to 84.99) | 36.08 (35.32 to 37.50) | 75.06 (73.79 to 76.21) | 0.803 (0.799 to 0.807) | 4014 (2898 to 4900) | 84.49 (83.50 to 86.17) | 37.50 (36.55 to 39.08) | 2410 (2356 to 2452) | 43 (42 to 44) | 0 (0 to 0) |
| training, then the count | 40000 | 10 | 12500 | 0.05 | 0.9 | 1, 2, 3 | 82.01 (77.71 to 84.79) | 36.27 (34.40 to 38.10) | 73.54 (70.23 to 75.98) | 0.823 (0.820 to 0.824) | 4078 (3109 to 5835) | 83.20 (79.00 to 85.86) | 37.57 (35.64 to 39.42) | 2733 (2690 to 2760) | 98 (96 to 103) | 0 (0 to 0) |
| training, then the count | 40000 | 20 | 25000 | 0.05 | 0.9 | 1, 2, 3 | 83.02 (81.98 to 83.58) | 36.47 (34.08 to 37.80) | 75.15 (73.25 to 76.20) | 0.838 (0.837 to 0.838) | 4169 (3693 to 4830) | 84.01 (82.87 to 84.71) | 37.47 (35.03 to 38.80) | 2988 (2934 to 3036) | 253 (243 to 268) | 0 (0 to 0) |
| training, then the count | 40000 | 30 | 37500 | 0.05 | 0.9 | 1, 2, 3 | 83.62 (82.39 to 85.17) | 35.11 (33.70 to 37.86) | 75.13 (74.45 to 75.72) | 0.847 (0.845 to 0.848) | 4175 (2606 to 5150) | 84.67 (83.65 to 86.32) | 36.57 (34.91 to 39.15) | 3073 (3007 to 3137) | 460 (448 to 485) | 0 (0 to 0) |
| training, then the search, then the count | 40000 | 30 | 37500 | 0.05 | 0.9 | 1, 2, 3 | 88.02 (87.70 to 88.46) | 48.07 (47.62 to 48.48) | 79.67 (79.05 to 80.17) | 0.847 (0.845 to 0.848) | 795 (613 to 947) | 89.45 (89.13 to 89.93) | 50.20 (49.95 to 50.57) | 3267 (3224 to 3288) | 460 (448 to 485) | 33 (31 to 34) |
<!-- the end of the output of table.ts -->

The seconds are of training alone, and they were measured on a loaded machine: 7 to 10 of these processes ran at once, each with 4 worker threads, next to the runs of other experiments, on 18 CPUs. Alone, a pass over 40,000 samples takes 6.5 s (the 19 to 20 s of row 9), so 30 passes take about 200 s and 3 passes over 400,000 samples the same.

All three of the snapped tables on the validation split after every pass, before the count, from the trainers' logs (passes 1 to 30):

- seed 1: 82.34 85.04 84.18 84.97 84.97 84.17 82.65 85.64 85.08 84.66 83.87 84.82 85.39 84.69 83.96 84.31 84.46 82.94 83.54 83.43 82.73 82.66 83.94 84.58 84.56 84.76 83.82 83.63 84.54 85.03
- seed 2: 80.75 81.40 81.56 82.11 82.38 82.58 82.20 81.12 82.25 77.52 82.66 83.67 81.86 81.97 81.98 82.97 83.04 82.71 79.07 83.46 81.10 82.25 82.68 83.26 82.86 83.35 83.58 83.33 82.06 82.32
- seed 3: 80.15 82.47 83.23 82.64 82.04 82.25 82.31 82.54 83.21 83.42 83.46 80.92 82.30 82.50 79.27 80.70 81.44 81.78 83.29 81.87 82.68 81.37 82.79 82.51 81.01 82.17 81.27 82.23 81.84 83.20

## What the numbers say

- **More passes over the same 40,000 samples do not move gradient training.** All three is 83.08 after 3 passes, 83.21 after 5, 82.01 after 10, 83.02 after 20 and 83.62 after 30, and whole samples go from 36.33 to 35.11. Every one of these is inside the spread of the seeds at 3 passes (81.69 to 84.25). After 30 passes, at 10 times the training time, gradient training alone is still 3.8 points of all three and 9.4 of whole samples below the search without training (87.40 and 44.51), and 4.4 and 13.6 below the table filled by hand-written rules (88.03 and 48.66). It stays level with yacc error productions (83.08 and 37.10).
- **The two signs of a training that is cut short do not go away with more passes.** The largest share of a cell rises slowly, from 0.785 after 3 passes to 0.847 after 30, and the tokens skipped at the limit of 16 steps stay at about 4,000 (3,904 after 3 passes, 4,175 after 30), where the hand-written rules skip 61. The score of the snapped tables jumps from one pass to the next, e.g. seed 2 has 82.25, 77.52 and 82.66 after the passes 9, 10 and 11, while the trainer's loss per code point is level from about pass 5 on (0.80 to 0.90). So 3 passes do not cut off a training that is on its way up: the training moves around one level.
- **The training does not fit its own train samples either.** After 30 passes it has 84.67 of all three on its train samples and 83.62 on validation, where the search reaches 89.5 on the same train samples with the same cells. So the tables that the training ends at are not held back by too few samples to learn from: they are 5 points below what the cells can hold on the samples that the training has seen 30 times.
- **The search after 30 passes gives what it gives after 3**: 88.02 of all three and 48.07 whole samples, against 88.20 and 47.91 for the same three seeds of row 10. A longer training gives the search nothing more.

## What ran and what did not

- Ran: 30 passes over 40,000 train samples for the seeds 1, 2 and 3, with points saved after the passes 1, 2, 3, 5, 10, 20 and 30, and the search and the count after pass 30. A command took 542 to 579 s on the loaded machine.
- Did not finish: one training of 100 passes for seed 1. 100 passes take about 11 minutes alone, which is over the 6 minutes that a run was allowed, and the run was stopped after pass 40 to free the machine for the runs on more samples. It saved no tables. Its log has the score of the snapped tables after every pass: the passes 31 to 40 give 85.31, 78.89, 83.94, 84.54, 84.21, 83.05, 82.66, 84.44, 82.72 and 79.89 of all three, and the largest share is 0.850 after pass 40. So 10 more passes show the same level and the same jumps.
- Still running when this was written: 3 passes over 400,000 and over 160,000 train samples, and 10 passes with a rate of 0.01, each for the seeds 1, 2 and 3.

## Where the files are

`<scratch>/transfer/lr/runs/scale/` holds the tables `train-<train samples>.passes-<passes>.seed-<seed>.tables.json` with a record next to each, and `logs/` with what every command printed.
