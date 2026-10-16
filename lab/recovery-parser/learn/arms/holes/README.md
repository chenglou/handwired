# Holes: a hand-written recovery with some of its decisions left blank

The question of this arm, in the words of the person who asked for the experiment: write recovery by hand in the source but with placeholders in some spots, and "see if the pre-structured method can learn the right holes". So a person has written a recovering parser and has left some of its decisions blank. Does training put the right decisions into the blanks?

The person's parser is the hand-written tables of `../../handwritten/`, 35 rules. Two words, besides the ones of `../../README.md`:

- A **decision** is a cell in which the hand-written tables hold another choice than today's tables. There are 915: 648 cells of the tokenizer's table and 267 of the grammar's.
- A **blank** is a decision that is taken back: the cell holds today's choice again, and a run may fill it. E.g. the tokenizer cell (between, a), which a letter `a` between tokens reads: the hand-written tables start a word there (`errorLine`, `stringStart`), and today's tables report an unexpected character.

## What the arm shows

The validation split, the seeds 1 to 5, every setting run once. A number with brackets is the mean of the seeds, with the lowest and the highest. "All" is all three on all samples, "within reach" is all three in the group "within reach of the tables", and "whole" is the share of whole samples.

**1. Training the blanks gets back the code points of all samples. It does not get back the whole samples, and within reach fewer runs get to the hand-written number at the larger shares: 3, 1, 0 and 0 of 5.**

| | all | within reach | whole |
| --- | --- | --- | --- |
| the hand-written tables | 96.52 | 99.51 | 80.44 |
| 10% blanked, trained | 96.52 (96.37 to 96.60) | 99.48 (99.32 to 99.59) | 79.85 (78.05 to 80.42) |
| 25% blanked, trained | 96.50 (96.27 to 96.93) | 99.40 (99.27 to 99.54) | 76.46 (71.15 to 80.07) |
| 50% blanked, trained | 96.44 (96.14 to 97.02) | 99.24 (99.03 to 99.39) | 73.32 (62.90 to 77.72) |
| 100% blanked, trained | 96.96 (96.87 to 97.06) | 99.24 (99.09 to 99.44) | 74.94 (73.35 to 75.81) |

None of the 20 runs whose seed draws the blanks has the hand-written tables' whole samples, 3,697 of 4,596: at the share 10 the five runs are 9, 8, 7, 1 and 110 samples short. One reported run has them: at the share 10 with the blanks of seed 1 for every seed, the run of seed 5 has 3,698. Within reach the means do not go on falling, 99.24 at the share 50 and at the share 100, but at these two shares no run has the hand-written number. With every decision blanked the hand-written number is outside the range of the seeds in all three columns: the trained tables are 0.45 points above it on all, 0.26 below within reach and 5.50 below on whole.

**2. The person's decisions do not come back.** After training, 11.3%, 12.7% and 13.6% of the blanked cells hold the hand-written choice again at the shares 10, 25 and 50, and 27.9% at the share 100. The same blanks trained with another order of the samples end with other choices, while all three stays within 0.04 points.

**3. Most of the other choices are in cells that the train samples leave open. Where the samples do tell the two choices apart, they ask for the trained one more often than for the person's in 4 of the 5 runs.** At the share 10, 408 of the 460 blanked cells of the five runs ended with another choice than the hand-written one. With the hand-written choice put back into that one cell of the trained tables, the train split has as many code points right in 279 of them, fewer in 75 and more in 54. Run by run, fewer and more are 13 and 8, 20 and 10, 11 and 9, 12 and 14, 19 and 13. Of the 20 such cells that 1,000 or more train samples read, it is 1, 11 and 8.

**4. What no sample holds is lost.** The hand-written tables keep the depth of valid JSON deeper than 16 levels right at every code point, and the dataset has no such text. The trained tables have that depth wrong at 7% to 13% of the code points in one form of such texts and at 12% to 18% in the other, as the means over the seeds, on the 600 texts of `../../check-deep.ts`.

**5. A plain search of the same cells is not told apart from training with up to half of the decisions blanked: the ranges of the two overlap on all, within reach and whole. With all of them blanked, training is above each of six orders of the search.** The six orders end at 88.25 to 96.43 of all, 8.2 points apart, and the best of them is 0.44 points below the lowest seed of the training on all, 0.03 within reach and 12.25 on whole.

**6. Knowing which cells the person changed does not move the three totals. It moves which groups the right code points are in.** With every decision blanked, training all 1,326 open cells instead of the person's 915 has ranges that overlap on all, within reach and whole. In the group "needs a character class" the person's cells have 93.34 (93.06 to 93.68) against 91.04 (88.76 to 92.20), and are above in each of the 5 seeds. In "needs a nesting fix" they have 81.94 (77.54 to 90.68) against 89.58 (88.32 to 91.14), and are below in each of the 5. Training every open cell has the depth of valid JSON that is too deep wrong at 47.9% of the code points against 10.4%, but the plain pass of `../plain-pass/`, which also trains every open cell, with one pass from the default start, has 3.0%: the 47.9% is what this arm's setting of the trainer does when every open cell is trainable, and not what the list of cells is worth.

## Setup

- **The blanks.** For a share of 10, 25, 50 and 100 percent and a seed, the arm draws that share of the 915 decisions at random: 92, 229, 458 and 915 cells. The base of the run is the hand-written tables with today's choice back in the blanked cells.
- **Three settings per share.** "Not filled" is the base as it is, which says what blanking costs. "Trained": only the blanked cells are trainable, every other cell holds its one choice, and the run trains on the train split and snaps. "Searched": the search of `../../search/` over the blanked cells alone, from the same base, as the comparison without gradients. The harness scores each in the exact parser on the validation split.
- **A seed draws the blanked cells, orders the samples of the training and orders the cells of the search.** A search ends in other tables for another order of its cells, so the seed draws a random order for every pass of the search, as `search.ts --order <seed>` does. The spread over the seeds 1 to 5 therefore holds two things: which decisions were blanked, and an order. To tell the two apart, the share 10 has a trained and a searched setting in which the blanks are the ones of seed 1 for every seed, so that their seeds only order.
- **The share 100** blanks every decision, so its base is today's tables for every seed, and its seeds only order. It has two more settings. A sixth search goes over the cells from the most read one to the least read one, which is the default order of `search.ts`. And a second training has every open cell trainable, 1,326 cells where the person changed 915, with the same setting of the trainer: the same run without the knowledge of which cells the person changed.
- **What counts as the hand-written choice again**: both parts of the cell's choice, the next state and the event of a tokenizer cell, or the next state and the stack action of a grammar cell. A stack action that does what the cell's token does by itself counts as `by token`, e.g. `none` in a cell of a comma: the parser cannot tell the two apart, so no run can.
- **A train sample reads a cell** when the exact parser reads the cell on the sample's text with the hand-written tables. A cell that none reads is not a cell that a run cannot learn: the filled tables are another parser and read up to 58% of these cells.

**What the arm is.** It may change the blanked cells and no other cell: 92 to 915 of the 1,326 open cells. Its tables have today's states and classes, no bit, and today's display table. They are no tables of the dataset's plain table parser, since the hand-written tables already hold 21 grammar cells with a stack action that does something else than their token does. The tables of a seed are the last ones of its run. For the hand-written tables no split of this dataset counts as unseen, see `../../handwritten/README.md`, so the same holds for every number here.

## The trainer's setting, and how it was chosen

The reported runs use one setting: **3 passes over the train samples, a uniform start, and every other default of the trainer** (learning rate 0.05, temperature 1, no sharpness cost). It is `trainerSetting` in `holes.ts`.

It was chosen with `tune.ts` on the share 10, with the seeds 11, 12 and 13, which draw other blanks than the seeds 1 to 5 of the reported runs. **13 settings of the trainer were tried, and the table has all of them**, so the chosen row can be read as one of thirteen. Validation split, the mean and in brackets the lowest and the highest of the 3 seeds.

| passes | start | learning rate | temperature at the end | sharpness cost | all three | within reach of the tables | whole samples | hand's choice, of all blanked cells |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| not filled | | | | | 90.67 (87.51 to 93.95) | 95.22 (92.78 to 97.85) | 72.20 (69.69 to 74.54) | |
| 1 | today's choice | 0.05 | 1 | 0 | 96.33 (96.13 to 96.47) | 99.47 (99.39 to 99.51) | 80.14 (79.59 to 80.55) | 11.59 (10.87 to 11.96) |
| 1 | uniform | 0.05 | 1 | 0 | 96.42 (96.31 to 96.52) | 99.48 (99.45 to 99.51) | 80.28 (80.07 to 80.55) | 6.52 (4.35 to 10.87) |
| 3 | today's choice | 0.05 | 1 | 0 | 96.41 (96.38 to 96.46) | 99.48 (99.43 to 99.53) | 79.90 (79.57 to 80.33) | 10.14 (8.70 to 10.87) |
| **3** | **uniform** | **0.05** | **1** | **0** | 96.46 (96.37 to 96.53) | 99.51 (99.50 to 99.54) | 80.33 (80.31 to 80.37) | 7.97 (6.52 to 8.70) |
| 10 | today's choice | 0.05 | 1 | 0 | 96.37 (96.32 to 96.41) | 99.50 (99.42 to 99.56) | 79.75 (79.11 to 80.35) | 8.33 (4.35 to 10.87) |
| 10 | uniform | 0.05 | 1 | 0 | 96.49 (96.48 to 96.51) | 99.51 (99.47 to 99.55) | 80.40 (80.18 to 80.55) | 7.97 (6.52 to 9.78) |
| 3 | uniform | 0.02 | 1 | 0 | 96.42 (96.35 to 96.53) | 99.47 (99.43 to 99.50) | 80.16 (79.90 to 80.48) | 6.52 (3.26 to 8.70) |
| 3 | uniform | 0.1 | 1 | 0 | 96.41 (96.25 to 96.51) | 99.47 (99.40 to 99.53) | 80.37 (80.20 to 80.48) | 6.88 (5.43 to 7.61) |
| 3 | uniform | 0.2 | 1 | 0 | 96.51 (96.42 to 96.57) | 99.47 (99.42 to 99.53) | 79.82 (78.94 to 80.37) | 7.61 (4.35 to 10.87) |
| 3 | uniform | 0.05 | 0.5 | 0 | 96.43 (96.29 to 96.53) | 99.49 (99.45 to 99.54) | 80.32 (80.13 to 80.50) | 9.06 (7.61 to 10.87) |
| 3 | uniform | 0.05 | 0.2 | 0 | 96.45 (96.42 to 96.47) | 99.37 (99.16 to 99.53) | 80.20 (79.96 to 80.46) | 6.52 (5.43 to 7.61) |
| 3 | uniform | 0.05 | 1 | 0.01 | 96.39 (96.30 to 96.52) | 99.42 (99.26 to 99.50) | 80.12 (79.72 to 80.44) | 6.88 (4.35 to 8.70) |
| 3 | uniform | 0.05 | 1 | 0.1 | 96.37 (96.28 to 96.51) | 99.41 (99.28 to 99.50) | 79.82 (79.68 to 79.98) | 5.07 (4.35 to 5.43) |
| the hand-written tables | | | | | 96.52 | 99.51 | 80.44 | |

What the tuning says:

- **The chosen setting is told apart from none of the other 12 by its score.** The 13 means of all three lie between 96.33 and 96.51. Of the 78 pairs of settings, 72 have ranges that overlap on all samples, and all 78 in the group "within reach of the tables". The 6 pairs that do not overlap each have a run from a uniform start above a run from today's choice or above the temperature that falls to 0.2, e.g. 10 passes from a uniform start, 96.49 (96.48 to 96.51), against 10 passes from today's choice, 96.37 (96.32 to 96.41). So the setting was not picked by its score, and the reported runs below, with other seeds and other blanks, are the numbers to quote.
- **The start.** A blanked cell holds today's choice in the base, and by default a trainable mix starts with a share of 0.9 on it. A uniform start gives every choice the same share, which is the honest blank: the run then knows nothing about the cell. The uniform start has the higher mean at 1, 3 and 10 passes, by 0.05 to 0.12 points, with ranges that overlap at 1 and 3 passes. So the honest blank costs nothing and was taken.
- **The passes.** 3 passes and 10 passes from a uniform start are 0.03 points apart with ranges that overlap, and 10 passes take three times as long. So 3. The 10 passes have the narrower range, 0.03 points against 0.16, which 3 seeds do not settle.
- **The learning rate, the temperature and the sharpness cost do not move the score**, and nothing that the score does not show speaks for one of them. The depth of valid JSON that is too deep is wrong at 1.3% and 2.6% of the code points for the chosen setting, in the two forms of such texts. With a sharpness cost it is 8% to 15%, and with 10 passes, with 3 passes from today's choice and with a learning rate of 0.2 it is 5.2% in the first form and 9% to 11% in the second. These are means of 3 seeds, and every one of these settings has a seed with 0.0, so the ranges overlap. With a sharpness cost 3 of the 6 runs show 16 to 28 code points as past the end, and one run with the temperature that falls to 0.2 shows 15, where the chosen setting shows none. So the defaults stay.
- **In every setting the code points of all samples come back and the hand-written choices do not**: training gets back 94% to 100% of what the blanks cost on all samples and 97% to 100% within reach, as the means of the settings, and the hand-written choice is in 5% to 12% of the blanked cells. The means of whole samples are 79.75 to 80.40 where the hand-written tables have 80.44, and the highest run of 7 of the 13 settings is above them, at 80.46 to 80.55.

## Results

The validation split of the standard set, the exact parser: 5,021 broken samples, 425 of them with nothing to recover, 675,949 scored code points. Percentages, as the mean and in brackets the lowest and the highest of the seeds 1 to 5. A number without brackets is one run, or runs that all print that number. Every reported setting was run once, with the trainer's setting above. `report.ts` prints every table of this section with more rows, and every pair of ranges that is said here to overlap or not. A share of wrong depths on valid JSON that is too deep is a share of the 600 texts of `../../check-deep.ts`. On 142 other texts of 17 to 19 levels a review found the settings in the same order and with other sizes, e.g. 23% to 39% in the first form where the person's 915 cells have 8.0% to 15.6% here, so read the order of the settings and not the sizes.

### What blanking costs, and what comes back

"Comes back" is the share of what the blanks cost that the filled tables have again, per seed, e.g. 100% for tables that score as the hand-written ones. At the share 100 the searched runs are the five random orders.

All three, all validation samples. The hand-written tables have 96.52.

| blanked | not filled | trained | trained runs at 96.52 or above | comes back | searched | searched runs at 96.52 or above | comes back |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10% | 89.93 (87.76 to 90.80) | 96.52 (96.37 to 96.60) | 3 of 5 | 100.0 (97.6 to 101.4) | 96.61 (96.46 to 96.96) | 3 of 5 | 101.5 (99.0 to 107.0) |
| 25% | 85.61 (81.68 to 88.45) | 96.50 (96.27 to 96.93) | 2 of 5 | 99.4 (97.3 to 102.8) | 96.66 (96.23 to 96.90) | 4 of 5 | 101.0 (96.5 to 103.7) |
| 50% | 74.84 (66.54 to 83.06) | 96.44 (96.14 to 97.02) | 2 of 5 | 99.5 (98.1 to 101.7) | 96.75 (95.91 to 97.36) | 4 of 5 | 101.1 (97.0 to 103.0) |
| 100% | 42.69 | 96.96 (96.87 to 97.06) | 5 of 5 | 100.8 (100.7 to 101.0) | 94.19 (91.93 to 96.43) | 0 of 5 | 95.7 (91.5 to 99.8) |

All three, the group "within reach of the tables". The hand-written tables have 99.51.

| blanked | not filled | trained | trained runs at 99.51 or above | comes back | searched | searched runs at 99.51 or above | comes back |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10% | 94.54 (92.88 to 95.24) | 99.48 (99.32 to 99.59) | 3 of 5 | 99.5 (95.6 to 101.9) | 99.46 (99.40 to 99.51) | 1 of 5 | 99.1 (98.4 to 100.2) |
| 25% | 91.31 (88.24 to 93.24) | 99.40 (99.27 to 99.54) | 1 of 5 | 98.6 (96.3 to 100.5) | 99.26 (99.03 to 99.42) | 0 of 5 | 96.7 (92.4 to 98.9) |
| 50% | 80.92 (72.01 to 90.50) | 99.24 (99.03 to 99.39) | 0 of 5 | 98.4 (96.9 to 99.5) | 99.17 (98.33 to 99.56) | 1 of 5 | 98.1 (93.8 to 100.2) |
| 100% | 47.44 | 99.24 (99.09 to 99.44) | 0 of 5 | 99.5 (99.2 to 99.9) | 97.32 (95.40 to 99.06) | 0 of 5 | 95.8 (92.1 to 99.1) |

Whole samples, all validation samples. The hand-written tables have 80.44.

| blanked | not filled | trained | trained runs at 80.44 or above | comes back | searched | searched runs at 80.44 or above | comes back |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10% | 66.35 (58.66 to 73.35) | 79.85 (78.05 to 80.42) | 0 of 5 | 94.7 (77.8 to 99.9) | 80.38 (80.18 to 80.55) | 2 of 5 | 99.7 (98.4 to 100.8) |
| 25% | 58.97 (51.91 to 66.38) | 76.46 (71.15 to 80.07) | 0 of 5 | 79.3 (59.4 to 98.7) | 77.64 (73.46 to 80.22) | 0 of 5 | 86.4 (72.6 to 98.9) |
| 50% | 45.27 (30.35 to 57.03) | 73.32 (62.90 to 77.72) | 0 of 5 | 77.5 (38.4 to 92.7) | 74.99 (61.58 to 80.24) | 0 of 5 | 84.5 (49.5 to 99.6) |
| 100% | 11.92 | 74.94 (73.35 to 75.81) | 0 of 5 | 92.0 (89.6 to 93.2) | 59.24 (57.14 to 61.10) | 0 of 5 | 69.1 (66.0 to 71.8) |

All three per group of the dataset, trained. "The four groups" are "within reach of the tables", "needs a display fix", "needs a line rule" and "needs a character class" taken together, where the hand-written tables have 92% or more of the code points right. "The two groups" are "needs a nesting fix" and "out of reach", where they have 76.1% and 78.0%.

| tables | within reach of the tables | needs a display fix | needs a line rule | needs a character class | needs a nesting fix | out of reach | the four groups | runs below the hand-written tables there | the two groups | runs above the hand-written tables there |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hand-written | 99.5 | 98.2 | 99.0 | 92.2 | 76.1 | 78.0 | 98.57 |  | 77.79 |  |
| 10%, trained | 99.5 (99.3 to 99.6) | 98.1 (97.7 to 98.2) | 99.0 (98.9 to 99.0) | 92.2 (92.1 to 92.3) | 75.7 (74.8 to 76.1) | 78.4 (78.1 to 78.8) | 98.54 (98.41 to 98.61) | 3 of 5 | 78.05 (77.76 to 78.38) | 4 of 5 |
| 25%, trained | 99.4 (99.3 to 99.5) | 98.1 (98.0 to 98.3) | 98.3 (96.4 to 99.0) | 91.8 (91.5 to 92.3) | 79.3 (75.6 to 87.9) | 79.6 (78.1 to 82.9) | 98.36 (98.23 to 98.55) | 5 of 5 | 79.55 (78.39 to 83.55) | 5 of 5 |
| 50%, trained | 99.2 (99.0 to 99.4) | 97.5 (96.5 to 97.9) | 99.1 (98.9 to 99.5) | 91.3 (90.5 to 92.0) | 77.0 (66.7 to 89.8) | 80.2 (78.7 to 83.2) | 98.27 (98.05 to 98.45) | 5 of 5 | 79.78 (77.14 to 84.04) | 3 of 5 |
| 100%, trained | 99.2 (99.1 to 99.4) | 97.6 (97.2 to 97.9) | 98.9 (98.9 to 99.0) | 93.3 (93.1 to 93.7) | 81.9 (77.5 to 90.7) | 83.2 (82.2 to 84.3) | 98.49 (98.34 to 98.68) | 3 of 5 | 83.08 (81.90 to 85.12) | 5 of 5 |

- **Within reach fewer runs get to the hand-written number at the larger shares**: 3, 1, 0 and 0 of the 5 trained runs are at 99.51 or above, and at the shares 50 and 100 the highest seed is 0.11 and 0.06 points below it. The means are the same at the shares 50 and 100, 99.24, and the ranges of every two shares overlap.
- **None of the 20 trained runs of the table has the hand-written tables' whole samples**: the means are 0.59, 3.98, 7.11 and 5.50 points below 80.44. That is no rule: with the blanks of seed 1 for every seed, the trained run of seed 5 has 80.46, and in the tuning runs above, with other blanks, single runs at the share 10 have up to 80.55. A run that is far below has lost one group as a whole: in "needs a line rule" the trained run of seed 2 has 40.0% of the whole samples at the share 25 and 0.8% at the share 50, where the hand-written tables have 98.0% and the other four runs of those shares 95.5% to 98.0%.
- **What comes back is a loss in the four groups and a gain in the two.** In the four groups the trained tables are below the hand-written 98.57 on the mean at every share, in every seed at the shares 25 and 50 and in 3 of the 5 at the shares 10 and 100. In the two groups they are above the hand-written 77.79 on the mean at every share, in 4, 5, 3 and 5 of the 5 seeds. So tables that have the hand-written all three again have fewer code points right where the hand-written tables were nearly right, and more where they were weakest.

**The sources of spread, at the share 10.** All three on all samples, the seeds one by one:

- A seed's own blanks: not filled 87.76, 90.80, 90.35, 90.17, 90.56; trained 96.51, 96.58, 96.60, 96.52, 96.37; searched 96.47, 96.63, 96.53, 96.96, 96.46.
- The blanks of seed 1 for every seed: not filled 87.76; trained 96.51, 96.50, 96.50, 96.54, 96.54; searched 96.47, 96.35, 96.55, 96.44, 96.43.

With the blanks of seed 1, the order of the samples moves the training by 0.04 points and the order of the cells moves the search by 0.20. With the blanks drawn anew, the trained runs are 0.23 points apart and the searched ones 0.50. That is one draw of blanks, so it says how far an order moves these 92 cells, and not which share of a spread is the order's in general.

### Which blanked cells hold the hand-written choice again

After training. **Whether a train sample reads a cell does not say whether a run can learn the cell.** The trained tables are another parser than the hand-written one and take other paths through the tables: the fourth column counts the blanked cells without a reader under the hand-written tables that a train sample reads with the trained tables. And the twin reads every cell that has a share, however small, so training also moves cells that no exact run reads, see `../../soft/README.md`. So the fair number is the one over all blanked cells.

| blanked | blanked cells | of them, no train sample reads | of those, read with the trained tables, over the runs | hand's choice, of all blanked cells | hand's choice, of the cells that a train sample reads |
| --- | --- | --- | --- | --- | --- |
| 10% | 92 | 48 (40 to 57) | 42 of 238, 18% | 11.3 (5.4 to 17.4) | 16.5 (6.4 to 25.0) |
| 10%, the blanks of seed 1 for every seed | 92 | 40 | 24 of 200, 12% | 17.8 (15.2 to 20.7) | 24.6 (23.1 to 26.9) |
| 25% | 229 | 113 (106 to 128) | 212 of 567, 37% | 12.7 (10.0 to 15.7) | 16.0 (12.2 to 19.8) |
| 50% | 458 | 234 (227 to 247) | 680 of 1,170, 58% | 13.6 (11.8 to 15.7) | 17.1 (14.7 to 20.9) |
| 100% | 915 | 474 | 1,118 of 2,370, 47% | 27.9 (25.7 to 30.9) | 28.3 (27.0 to 29.7) |

- **More readers raise the share and do not settle it.** Over the 5 runs of the share 10, the hand-written choice is in 5 of the 84 cells that 1 to 9 train samples read and in 18 of the 38 that 1,000 or more read. Of the cells with 1,000 or more readers, 44% to 48% hold the hand-written choice after training at the shares 10, 25 and 100, and 25% at the share 50. What the others hold is in the next section.
- **The same blanks trained in another order end with other choices**: with the blanks of seed 1, 15.2% to 20.7% of the 92 cells hold the hand-written choice.
- **At the share 100 a cell that no train sample reads holds the hand-written choice as often as one that is read**: 652 of 2,370 such cells over the 5 runs, 27.5%, against 28.3% of the cells that are read. With every decision blanked the trained tables are far from the hand-written ones, and "read with the hand-written tables" says little about what the run saw.
- **The search is not told apart from training in how often it holds the hand-written choice** with up to half of the decisions blanked: 14.1% (10.9 to 17.4), 15.3% (11.4 to 18.8) and 15.4% (10.7 to 18.6) of the blanked cells at the shares 10, 25 and 50, with ranges that overlap training's. With every decision blanked training holds it more often, 27.9% (25.7 to 30.9) against 11.6% (9.3 to 15.1) for the five random orders.
- **Training and the search fill a cell alike in one cell in ten**: over the 5 runs of the share 10, both hold the hand-written choice in 22 of the 460 cells and the same other choice in 27. So the two do not find the same tables, they find two of many tables with about the same score.

### What the samples say about a cell with another choice

For the share 10, every blanked cell that ended with another choice than the hand-written one is judged alone, by the scored code points of a split with all three labels right, in two directions:

- **In the filled tables**: the filled tables against the same tables with the hand-written choice in that one cell.
- **In the hand-written tables**: the hand-written tables with the filled choice in that one cell against the hand-written tables as they are.

A cell that no sample of the split reads changes nothing. The train split says what a run could learn about the cell, and the validation split what the score sees of it. The counts are cells over the 5 runs.

| filled by | split | blanked cells | with another choice than hand's | in the filled tables: not read | as many code points | the filled choice has more | the filled choice has fewer | in the hand-written tables: not read | as many code points | the filled choice has more | the filled choice has fewer | more in the filled tables and fewer in the hand-written ones |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| training | train | 460 | 408 | 192 | 87 | 75 | 54 | 223 | 86 | 53 | 46 | 9 |
| training | validation | 460 | 408 | 249 | 72 | 46 | 41 | 278 | 64 | 29 | 37 | 5 |
| the search | train | 460 | 395 | 226 | 61 | 108 | 0 | 237 | 64 | 74 | 20 | 15 |
| the search | validation | 460 | 395 | 278 | 55 | 54 | 8 | 285 | 49 | 37 | 24 | 10 |

The cells of the trained runs, in the trained tables on the train split, by how many train samples read the cell with the hand-written tables:

| train samples that read the cell | cells with another choice than hand's | no train sample reads the cell with the trained tables | as many code points | the hand-written choice has more | the trained choice has more |
| --- | --- | --- | --- | --- | --- |
| none | 223 | 187 | 12 | 10 | 14 |
| 1 to 9 | 79 | 5 | 40 | 14 | 20 |
| 10 to 99 | 55 | 0 | 25 | 15 | 15 |
| 100 to 999 | 31 | 0 | 9 | 7 | 15 |
| 1,000 or more | 20 | 0 | 1 | 8 | 11 |
| all | 408 | 192 | 87 | 54 | 75 |

So a trained cell with another choice than the person's is one of three cases:

- **The train samples do not tell the two choices apart**, 279 of the 408 cells: 192 that no train sample reads with the trained tables, and 87 with as many code points either way. Such a cell cannot be learned from the samples, whichever choice it ends with.
- **The trained choice fits the train samples better than the person's**, 75 cells, and 11 of the 20 cells that 1,000 or more train samples read. E.g. the grammar cell (colon, closeObject, depth 2 to 15, object), which 2,717 train samples read: the hand-written tables go to `commaOrClose` there and the trained tables of seed 1 go to `value`, which has 1,676 more code points right on the train split and 135 more on the validation split, and also more when it is put into the hand-written tables, 1,749 and 163.
- **The cell was learned wrong**, 54 cells, and 8 of the 20: the train samples ask for the hand-written choice in that cell of the trained tables, and the run did not put it there. E.g. the grammar cell (end, string, depth 0), which 3,359 train samples read: the hand-written tables stay in `end` there and the trained tables of seed 2 go to `error`, which has 1,672 fewer code points right on the train split and 33 fewer on the validation split.

More to read from the two tables:

- **For the search the third case is empty**, 0 of 395 cells: it ends when no choice that it tries makes a cell better on the train split.
- **On the validation split four in five of the other choices make no difference**: 321 of 408 in the trained tables, and 342 of 408 in the hand-written tables. The rest splits about evenly for training: 46 cells with more code points and 41 with fewer in the trained tables, 29 and 37 in the hand-written tables.
- **The tables count cells and no code points, on purpose.** What a choice is worth depends on the other cells, so the code points of single cells do not add up to the difference between two tables. E.g. the tokenizer cell (exponentSign, e), which 3,855 train samples read, holds the same trained choice in the seeds 1 and 4: against the hand-written choice it has 445 more code points right on the train split in the trained tables of seed 1 and 116 fewer in those of seed 4. And of the 46 cells with more code points on the validation split in the trained tables, 5 have fewer when their choice is put into the hand-written tables.

Where the filled tables show the display kind, the depth and the container that the hand-written tables show, on the broken validation samples: of the scored code points, and of the code points that the damage added, which have no label.

| blanked | trained, scored code points | trained, added code points | searched, scored code points | searched, added code points |
| --- | --- | --- | --- | --- |
| 10% | 99.79 (99.68 to 99.90) | 96.48 (92.08 to 98.74) | 99.69 (99.24 to 99.83) | 94.78 (87.14 to 97.62) |
| 25% | 99.11 (98.64 to 99.74) | 91.27 (89.17 to 92.78) | 98.85 (98.45 to 99.37) | 91.64 (84.56 to 95.58) |
| 50% | 98.21 (97.80 to 98.68) | 86.85 (81.58 to 89.83) | 98.12 (97.17 to 98.68) | 86.71 (82.99 to 90.91) |
| 100% | 97.82 (97.71 to 98.02) | 84.88 (80.61 to 86.85) | 94.05 (91.63 to 96.51) | 66.40 (54.44 to 78.73) |

Where a label says what a code point is, the trained tables show what the person's tables show at 97.8% to 99.8% of the code points. Where no label does, they agree less, and less with every larger share: 96.5% down to 84.9%. E.g. nothing in the loss says how the letters of an added comment are shown, only what the parser's state is after it.

### Training against a plain search of the same cells

**With up to half of the decisions blanked, the search is not told apart from training.** At the shares 10, 25 and 50 the ranges of the two overlap on all samples, within reach and on whole samples, see the three tables of [What blanking costs, and what comes back](#what-blanking-costs-and-what-comes-back). So do they at the share 10 with the blanks of seed 1 for every seed: training has 96.52 (96.50 to 96.54), 99.51 (99.50 to 99.54) and 80.30 (80.22 to 80.46), and the search 96.45 (96.35 to 96.55), 99.38 (99.25 to 99.52) and 80.32 (80.05 to 80.66). At these shares a search takes 2 to 63 s and a training 38 to 81 s, with other jobs running on the machine.

**With every decision blanked, training is above the search in each of six orders of its cells.** The search of the 915 cells from today's tables, one order per row:

| filled by | all three | within reach of the tables | whole samples | hand's choice, of all blanked cells |
| --- | --- | --- | --- | --- |
| the search, the most read cells first | 88.25 | 92.97 | 56.29 | 8.96 |
| the search, a random order, seed 1 | 96.41 | 99.06 | 60.29 | 15.08 |
| the search, a random order, seed 2 | 92.87 | 96.31 | 59.62 | 9.29 |
| the search, a random order, seed 3 | 91.93 | 95.40 | 58.07 | 10.49 |
| the search, a random order, seed 4 | 93.29 | 96.81 | 57.14 | 10.71 |
| the search, a random order, seed 5 | 96.43 | 99.01 | 61.10 | 12.24 |
| the search, the 6 orders | 93.20 (88.25 to 96.43) | 96.59 (92.97 to 99.06) | 58.75 (56.29 to 61.10) | 11.13 (8.96 to 15.08) |
| training, 5 seeds | 96.96 (96.87 to 97.06) | 99.24 (99.09 to 99.44) | 74.94 (73.35 to 75.81) | 27.89 (25.68 to 30.93) |

- The six orders end 8.2 points apart on all samples, from 88.25 to 96.43. The lowest of the six is the order with the most read cells first, which is the default of `search.ts`.
- The ranges of training and of the search do not overlap in any of the three columns: the best order is 0.44 points below the lowest seed of the training on all samples, 0.03 within reach and 12.25 on whole samples. Each of the six orders has 0.2% to 0.8% of the whole samples of the group "needs a line rule", where the trained runs have 90.0% to 98.0%.
- A search in a random order takes 4 to 6 minutes here, and a training a minute and a half.
- Whether the list of the person's cells helps the search is not told. From today's tables the search of all 1,326 open cells ends at 94.34, 96.30 and 89.41 in three orders (`../../README.md`), which lies inside the range of the six orders of the 915 cells.

The search's choices of a tokenizer cell are the ones of `search.ts` with its defaults, which do not hold every pair of a next state and an event. Of the 648 hand-written choices in the tokenizer's table, 68 are not among the choices that the search tries from today's choice, e.g. (`exponentSign`, `stringContent`) in 45 cells, so the search reaches them only in two steps. `check-search.ts` shows that the restricted search is the search of `search.ts` in both orders: with all 1,326 open cells as its cells it gives the tables of the number to beat from the hand-written tables, and the tables of `search.ts --order 1` from today's tables.

### Every decision blanked: the person's cells against every open cell

With every decision blanked the trainable cells are the 915 that the person changed. The setting "every open cell" trains all 1,326 with the same setting of the trainer, from the same tables. The plain pass of `../plain-pass/` also trains all 1,326, with one pass from the default start.

| trainable cells, setting of the trainer | All three, all validation samples | All three, the group "within reach of the tables" | Whole samples, all validation samples | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | grammar cells with a stack action that does something else than their token |
| --- | --- | --- | --- | --- | --- | --- |
| the person's 915 cells, the arm's setting | 96.96 (96.87 to 97.06) | 99.24 (99.09 to 99.44) | 74.94 (73.35 to 75.81) | 10.4 (8.0 to 15.6) | 14.7 (11.7 to 19.1) | 58 (55 to 59) |
| every open cell, the arm's setting | 96.88 (96.69 to 97.02) | 99.27 (99.15 to 99.36) | 73.46 (71.54 to 74.56) | 47.9 (41.7 to 68.8) | 54.6 (48.0 to 78.3) | 108 (92 to 124) |
| every open cell, the plain pass | 96.50 (95.88 to 96.74) | 99.11 (98.87 to 99.31) | 73.22 (72.76 to 73.54) | 3.0 (0.0 to 12.3) | 4.7 (0.0 to 16.4) | 26 (23 to 29) |
| the hand-written tables | 96.52 | 99.51 | 80.44 | 0.0 | 0.0 | 21 |

All three per group of the dataset:

| trainable cells, setting of the trainer | within reach of the tables | needs a display fix | needs a line rule | needs a character class | needs a nesting fix | out of reach |
| --- | --- | --- | --- | --- | --- | --- |
| the person's 915 cells, the arm's setting | 99.2 (99.1 to 99.4) | 97.6 (97.2 to 97.9) | 98.9 (98.9 to 99.0) | 93.3 (93.1 to 93.7) | 81.9 (77.5 to 90.7) | 83.2 (82.2 to 84.3) |
| every open cell, the arm's setting | 99.3 (99.1 to 99.4) | 96.9 (96.4 to 97.3) | 99.1 (98.9 to 99.8) | 91.0 (88.8 to 92.2) | 89.6 (88.3 to 91.1) | 83.6 (82.9 to 84.1) |
| seeds in which the person's cells are above every open cell | 2 of 5 | 5 of 5 | 1 of 5 | 5 of 5 | 0 of 5 | 3 of 5 |
| every open cell, the plain pass | 99.1 (98.9 to 99.3) | 96.2 (94.2 to 96.8) | 99.7 (98.9 to 99.9) | 89.7 (88.9 to 90.5) | 89.4 (83.1 to 92.8) | 81.6 (76.9 to 83.6) |
| the hand-written tables | 99.5 | 98.2 | 99.0 | 92.2 | 76.1 | 78.0 |

- **For the three totals the list of the person's cells makes no difference**: against every open cell with the same setting the ranges overlap on all samples (+0.08 points), within reach (-0.03) and on whole samples (+1.48).
- **Per group the list does make a difference, in both directions, and the two cancel in the totals.** For a seed the two settings get the same samples in the same order, so the seeds can be counted in pairs. The person's cells are above in each of the 5 seeds in "needs a character class", where the ranges do not overlap, and in "needs a display fix". They are below in each of the 5 seeds in "needs a nesting fix", where the ranges overlap. So the list keeps text of another notation, e.g. a string in single quotes, and loses in the nesting, where the hand-written tables are weakest.
- **The person's cells are 0.46 points above the plain pass on all samples**, with ranges that do not overlap. Which part of that is the setting is not told: every open cell with the arm's setting is 0.38 points above the plain pass, with ranges that overlap. Within reach and on whole samples the ranges of every pair of the three overlap.
- **What the arm's setting costs when every open cell is trainable**: the depth of valid JSON that is too deep is wrong at 47.9% and 54.6% of the code points, against the plain pass's 3.0% and 4.7%, with ranges that do not overlap. So the person's cells are not shown to keep that depth better than a training without the list: their 10.4% and 14.7% are below the control with the arm's setting, with ranges that do not overlap, and above the plain pass on the mean. The count of grammar cells whose stack action is not their token's reads the same way.
- **No setting of this arm reaches the number to beat**, the search from the hand-written tables: 96.96 against 97.75 on all samples and 99.24 against 99.68 within reach, and neither pair of ranges overlaps.

### What no label scores

| setting | added code points shown as an error | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | code points shown as past the end | grammar cells with a stack action that does something else than their token |
| --- | --- | --- | --- | --- | --- |
| hand-written, 35 rules | 0.0 | 0.0 | 0.0 | 0 | 21 |
| search from the hand-written tables | 0.0 | 18.5 | 30.2 | 0 | 94 |
| the plain pass: every open cell, one pass, defaults | 0.9 (0.7 to 1.1) | 3.0 (0.0 to 12.3) | 4.7 (0.0 to 16.4) | 50 (0 to 160) | 26 (23 to 29) |
| 10%, trained | 0.0 | 7.3 (0.0 to 35.6) | 12.3 (0.0 to 34.0) | 1 (0 to 3) | 28 (24 to 33) |
| 10%, searched | 0.0 (0.0 to 0.1) | 2.3 (0.0 to 11.7) | 4.9 (0.0 to 21.6) | 0 | 23 (23 to 24) |
| 25%, trained | 0.0 | 13.2 (0.6 to 44.8) | 18.3 (0.0 to 55.7) | 115 (0 to 569) | 33 (28 to 39) |
| 25%, searched | 0.0 | 8.6 (0.0 to 31.1) | 12.6 (0.0 to 37.2) | 0 | 31 (29 to 35) |
| 50%, trained | 0.0 | 8.1 (2.6 to 21.0) | 13.0 (1.0 to 35.7) | 971 (0 to 2,177) | 44 (40 to 47) |
| 50%, searched | 0.6 (0.1 to 1.5) | 14.7 (0.0 to 32.5) | 19.2 (0.0 to 34.1) | 0 | 38 (33 to 44) |
| 100%, trained | 0.0 | 10.4 (8.0 to 15.6) | 14.7 (11.7 to 19.1) | 10 (0 to 37) | 58 (55 to 59) |
| 100%, searched | 2.3 (1.4 to 3.9) | 47.4 (6.7 to 79.2) | 43.4 (14.4 to 69.4) | 0 | 66 (56 to 71) |
| 100%, searched with the most read cells first | 3.6 | 30.8 | 16.8 | 0 | 66 |
| every open cell, the arm's setting of the trainer | 0.0 | 47.9 (41.7 to 68.8) | 54.6 (48.0 to 78.3) | 16 (0 to 79) | 108 (92 to 124) |

The ground rules hold on the fixed texts for every run.

- **The depth of valid JSON that is too deep is a decision that no filling puts back.** The hand-written rules leave the stack alone in the contexts of depth 16, so that such a text keeps the depth it has today. The dataset has no text deeper than 16 levels, so nothing in the train split asks for it. The trained tables have that depth wrong at 7.3% to 13.2% of the code points in the first form of such texts and at 12.3% to 18.3% in the second, as the means of the four shares, and the searched tables at 2.3% to 47.4% and at 4.9% to 43.4%. With the blanks of seed 1, all five orders of the training end at 0.0% in the first form and at 23.8% to 24.0% in the second, and all five orders of the search at 0.0% in both: for these 92 blanks the order does not decide it.
- **Trained tables show code points as past the end**, up to 2,177 in one seed of the share 50, where the hand-written tables and every searched tables show none. A trained tokenizer cell can snap to an event of a text's end, and the search does not try those events.
- **Trained tables show no added code point as an error**, like the hand-written ones. Searched tables show up to 3.9% of them so.

## What the arm does not show

- **Nothing here is a number on unseen data.** For the hand-written tables no split of this dataset counts as unseen, and the setting of the trainer was chosen with validation scores in view, among 13 settings, on other seeds.
- **Not whether a person would have left these blanks.** The blanks are a random share of the cells. A person leaves a whole rule open, or the cells of one state, and whether training fills such a hole is not measured: 35 rules set 915 cells, 26 cells per rule on average, and a random share takes a few cells out of many rules.
- **Not that the other choices are as good as the person's on other text.** "As many code points" is the train split or the validation split of this dataset. 249 of the 408 other choices are read by no validation sample, so nothing was measured for them.
- **Not which cells a run can learn.** The count of a cell's readers uses the hand-written parser's paths, and the trained parser takes others.
- **Not how much of a spread is the order's.** Only the share 10 has runs with the same blanks for every seed, and for one draw of blanks. At the shares 25 and 50 a seed draws the blanks and the order together.
- **Not where the search ends in a seventh order.** Six orders of the 915 cells end 8.2 points apart.
- **The comparison of the person's cells with every open cell is one setting of the trainer**, tuned on the share 10 and on blanks inside the hand-written tables. That setting breaks the depth of valid JSON that is too deep when every open cell is trainable.
- **The test split and the held-out kinds** were not scored.

## Commands

Run from the repo root. The four shares are four arms for the harness, `holes-10` to `holes-100`, so that they can run at the same time: a run of the harness moves the files of an earlier run of the same name away. The times are with other jobs running on the machine.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/handwritten/rules.ts                # the hand-written tables, which the next command starts from
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/handwritten/tables.json --out $RECOVERY_SCRATCH/search/search-from-handwritten.json   # the number to beat
bun lab/recovery-parser/learn/arms/plain-pass/run.ts              # the plain pass, which the report compares with
bun lab/recovery-parser/learn/arms/holes/run.ts --share 10        # 5 seeds, about 9 minutes
bun lab/recovery-parser/learn/arms/holes/run.ts --share 25        # about 7 minutes
bun lab/recovery-parser/learn/arms/holes/run.ts --share 50        # about 11 minutes
bun lab/recovery-parser/learn/arms/holes/run.ts --share 100       # about 42 minutes, 28 of them the six searches
bun lab/recovery-parser/learn/arms/holes/report.ts                # the tables above, from the saved runs, about 20 s
bun lab/recovery-parser/learn/search/search.ts --order 1          # the search of every open cell in a random order, which the next command compares with, about 4 minutes
bun lab/recovery-parser/learn/arms/holes/check-search.ts          # the restricted search is the search of search.ts in both orders, about 8 minutes
```

The tuning runs, as they were run, about 30 minutes together. Each command runs every combination of its lists with the seeds 11, 12 and 13:

```sh
bun lab/recovery-parser/learn/arms/holes/tune.ts --name passes-1-and-3 --passes 1,3 --start base,uniform
bun lab/recovery-parser/learn/arms/holes/tune.ts --name passes-10-base --passes 10 --start base
bun lab/recovery-parser/learn/arms/holes/tune.ts --name passes-10-uniform --passes 10 --start uniform
bun lab/recovery-parser/learn/arms/holes/tune.ts --name learning-rate --passes 3 --start uniform --learning-rate 0.02,0.1,0.2
bun lab/recovery-parser/learn/arms/holes/tune.ts --name temperature --passes 3 --start uniform --temperature-end 0.5,0.2
bun lab/recovery-parser/learn/arms/holes/tune.ts --name sharpness-cost --passes 3 --start uniform --sharpness-cost 0.01,0.1
```

Every run was made twice, the second time from an empty scratch folder: the 13 tuned settings, every trained setting and the search with the most read cells first gave the same numbers both times, to the printed digit.

## Files

- `holes.ts`: the decisions, the blanks of a share and a seed (`blanksOf`), the trainer's setting, the comparison of a cell's choice with the hand-written one (`sameChoice`), and how many train samples read each cell (`trainReadersOf`).
- `restricted-search.ts`: `searchCells(start, cells, trainSamples, orderSeed)`, the search of `../../search/search.ts` over some cells alone, run by that search's own worker threads. Without `orderSeed` a pass goes from the most read cell to the least read one, and with it every pass has a random order that the seed draws. It refuses tables with an added class or with the bit "first on its line". `check-search.ts` shows that with every open cell it gives the tables of `search.ts`, in both orders.
- `run.ts`: the reported runs of one share.
- `tune.ts`: the tuning runs.
- `report.ts`: the tables and the comparisons of this README, from the saved runs.
