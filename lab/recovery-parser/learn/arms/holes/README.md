# Holes: a hand-written recovery with some of its decisions left blank

The question of this arm, in the words of the person who asked for the experiment: write recovery by hand in the source but with placeholders in some spots, and "see if the pre-structured method can learn the right holes". So a person has written a recovering parser and has left some of its decisions blank. Does training put the right decisions into the blanks?

The person's parser is the hand-written tables of `../../handwritten/`, 35 rules. Two words, besides the ones of `../../README.md`:

- A **decision** is a cell in which the hand-written tables hold another choice than today's tables. There are 915: 648 cells of the tokenizer's table and 267 of the grammar's.
- A **blank** is a decision that is taken back: the cell holds today's choice again, and a run may fill it. E.g. the tokenizer cell (between, a), which a letter `a` between tokens reads: the hand-written tables start a word there (`errorLine`, `stringStart`), and today's tables report an unexpected character.

**In short**, on the validation split, with the seeds 1 to 5, each setting run once:

- **The score comes back.** Blanking a tenth of the decisions costs 6.6 points of all three, 96.52% to 89.93% (87.76% to 90.80%), and training the blanks ends at 96.52% (96.37% to 96.60%). With a quarter, a half and all of the decisions blanked it ends at 96.50%, 96.44% and 96.96%.
- **The person's decisions do not come back.** After training, 11% to 14% of the blanked cells hold the hand-written choice again at the shares 10 to 50, and 28% at the share 100. Among the cells that 1,000 or more train samples read it is 25% to 48%.
- **Most of the other choices make no difference that the validation split can see.** Of 408 blanked cells that ended with another choice at the share 10, 321 give the same code points as the hand-written choice in that cell, 249 of them because no validation sample reads the cell. 46 give more and 41 give fewer.
- **What no label scores is lost.** The hand-written tables keep the depth of valid JSON that is too deep, by rules that a person wrote for it, and the dataset has no such text. After training the blanks that depth is wrong at 7% to 18% of the code points. Whole samples come back less than code points do: 79.3% and 77.5% of the lost ones at the shares 25 and 50.
- **A plain search of the same cells is not told apart from training** at the shares 10, 25 and 50. With every decision blanked the search ends at 88.25% and training at 96.96%.
- **Knowing which cells the person changed does not move the score**: 96.96% (96.87% to 97.06%) with the 915 cells trainable, 96.88% (96.69% to 97.02%) with all 1,326 open cells.

## Setup

- **The blanks.** For a share of 10, 25, 50 and 100 percent and a seed, the arm draws that share of the 915 decisions at random: 92, 229, 458 and 915 cells. The base of the run is the hand-written tables with today's choice back in the blanked cells.
- **Three settings per share.** "Not filled" is the base as it is, which says what blanking costs. "Trained": only the blanked cells are trainable, every other cell holds its one choice, and the run trains on the train split and snaps. "Searched": the search of `../../search/` over the blanked cells alone, from the same base, as the comparison without gradients. The harness scores each in the exact parser on the validation split.
- **A seed draws the blanked cells and orders the training.** So the spread over the seeds 1 to 5 holds two things: which decisions were blanked, and the order of the samples. To tell them apart, the share 10 has a fourth setting in which the blanks are the ones of seed 1 for every seed, so that its seeds only order the training.
- **The share 100** blanks every decision. Its base is today's tables for every seed, and its search has no seed. Its trainable cells are the 915 that the person changed, where the plain pass of `../plain-pass/` trains all 1,326 open cells. A third setting trains every open cell with this arm's setting of the trainer, so that the two runs differ in which cells are trainable and in nothing else.
- **What counts as the hand-written choice again**: both parts of the cell's choice, the next state and the event of a tokenizer cell, or the next state and the stack action of a grammar cell. A stack action that does what the cell's token does by itself counts as `by token`, e.g. `none` in a cell of a comma: the parser cannot tell the two apart, so no run can.
- **A train sample reads a cell** when the exact parser reads the cell on the sample's text with the hand-written tables. The tables below split the blanked cells by how many train samples read them, and count the cells that none reads apart. Such a cell is not one that a run cannot learn: the filled tables are another parser and read up to 58% of these cells, see [Which blanked cells hold the hand-written choice again](#which-blanked-cells-hold-the-hand-written-choice-again).

**What the arm is.** It may change the blanked cells and no other cell: 92 to 915 of the 1,326 open cells. Its tables have today's states and classes, no bit, and today's display table. They are no tables of the dataset's plain table parser, since the hand-written tables already hold 21 grammar cells with a stack action that does something else than their token does. The tables of a seed are the last ones of its run. For the hand-written tables no split of this dataset counts as unseen, see `../../handwritten/README.md`, so the same holds for every number here.

## The trainer's setting, and how it was chosen

The reported runs use one setting: **3 passes over the train samples, a uniform start, and every other default of the trainer** (learning rate 0.05, temperature 1, no sharpness cost). It is `trainerSetting` in `holes.ts`.

It was chosen with `tune.ts` on the share 10, with the seeds 11, 12 and 13, which draw other blanks than the seeds 1 to 5 of the reported runs. **13 settings of the trainer were tried, and the table has all of them**, so the chosen row can be read as one of thirteen. Validation split, the mean and in brackets the lowest and the highest of the 3 seeds. "Comes back" is the share of what the blanks cost that training gets back.

| passes | start | learning rate | temperature at the end | sharpness cost | all three | within reach of the tables | whole samples | comes back, all three | comes back, within reach | hand's choice, of all blanked cells | hand's choice, of the cells that a train sample reads |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| not filled | | | | | 90.67 (87.51 to 93.95) | 95.22 (92.78 to 97.85) | 72.20 (69.69 to 74.54) | | | | |
| 1 | today's choice | 0.05 | 1 | 0 | 96.33 (96.13 to 96.47) | 99.47 (99.39 to 99.51) | 80.14 (79.59 to 80.55) | 94.16 (85.12 to 99.52) | 98.99 (97.42 to 100.13) | 11.59 (10.87 to 11.96) | 13.53 (11.43 to 16.67) |
| 1 | uniform | 0.05 | 1 | 0 | 96.42 (96.31 to 96.52) | 99.48 (99.45 to 99.51) | 80.28 (80.07 to 80.55) | 96.86 (91.90 to 100.08) | 98.76 (96.34 to 100.05) | 6.52 (4.35 to 10.87) | 10.75 (4.76 to 20.00) |
| 3 | today's choice | 0.05 | 1 | 0 | 96.41 (96.38 to 96.46) | 99.48 (99.43 to 99.53) | 79.90 (79.57 to 80.33) | 97.38 (94.68 to 99.35) | 99.88 (98.22 to 101.73) | 10.14 (8.70 to 10.87) | 13.57 (11.43 to 15.00) |
| **3** | **uniform** | **0.05** | **1** | **0** | 96.46 (96.37 to 96.53) | 99.51 (99.50 to 99.54) | 80.33 (80.31 to 80.37) | 97.98 (94.34 to 100.14) | 100.21 (99.87 to 100.69) | 7.97 (6.52 to 8.70) | 16.55 (12.50 to 22.86) |
| 10 | today's choice | 0.05 | 1 | 0 | 96.37 (96.32 to 96.41) | 99.50 (99.42 to 99.56) | 79.75 (79.11 to 80.35) | 97.21 (95.98 to 97.86) | 100.18 (98.05 to 101.72) | 8.33 (4.35 to 10.87) | 12.74 (11.43 to 14.29) |
| 10 | uniform | 0.05 | 1 | 0 | 96.49 (96.48 to 96.51) | 99.51 (99.47 to 99.55) | 80.40 (80.18 to 80.55) | 99.62 (99.50 to 99.74) | 99.64 (97.77 to 101.07) | 7.97 (6.52 to 9.78) | 15.56 (10.00 to 20.00) |
| 3 | uniform | 0.02 | 1 | 0 | 96.42 (96.35 to 96.53) | 99.47 (99.43 to 99.50) | 80.16 (79.90 to 80.48) | 97.19 (93.48 to 100.12) | 99.02 (98.25 to 99.91) | 6.52 (3.26 to 8.70) | 13.13 (7.50 to 20.00) |
| 3 | uniform | 0.1 | 1 | 0 | 96.41 (96.25 to 96.51) | 99.47 (99.40 to 99.53) | 80.37 (80.20 to 80.48) | 98.72 (97.05 to 99.86) | 99.19 (98.42 to 100.48) | 6.88 (5.43 to 7.61) | 13.89 (9.52 to 17.14) |
| 3 | uniform | 0.2 | 1 | 0 | 96.51 (96.42 to 96.57) | 99.47 (99.42 to 99.53) | 79.82 (78.94 to 80.37) | 99.02 (96.31 to 100.60) | 98.68 (96.85 to 100.44) | 7.61 (4.35 to 10.87) | 14.25 (8.57 to 17.50) |
| 3 | uniform | 0.05 | 0.5 | 0 | 96.43 (96.29 to 96.53) | 99.49 (99.45 to 99.54) | 80.32 (80.13 to 80.50) | 99.15 (97.55 to 100.61) | 99.75 (99.20 to 100.70) | 9.06 (7.61 to 10.87) | 17.22 (15.00 to 20.00) |
| 3 | uniform | 0.05 | 0.2 | 0 | 96.45 (96.42 to 96.47) | 99.37 (99.16 to 99.53) | 80.20 (79.96 to 80.46) | 98.29 (96.41 to 99.31) | 96.96 (94.88 to 100.49) | 6.52 (5.43 to 7.61) | 11.94 (11.43 to 12.50) |
| 3 | uniform | 0.05 | 1 | 0.01 | 96.39 (96.30 to 96.52) | 99.42 (99.26 to 99.50) | 80.12 (79.72 to 80.44) | 96.57 (93.20 to 100.10) | 97.75 (94.45 to 99.94) | 6.88 (4.35 to 8.70) | 14.01 (9.52 to 20.00) |
| 3 | uniform | 0.05 | 1 | 0.1 | 96.37 (96.28 to 96.51) | 99.41 (99.28 to 99.50) | 79.82 (79.68 to 79.98) | 95.81 (90.67 to 99.98) | 96.95 (95.01 to 99.99) | 5.07 (4.35 to 5.43) | 9.40 (7.14 to 12.50) |
| the hand-written tables | | | | | 96.52 | 99.51 | 80.44 | | | | |

What the tuning says:

- **The chosen setting is told apart from none of the other 12 by its score.** The 13 means of all three lie between 96.33 and 96.51. Of the 78 pairs of settings, 72 have ranges that overlap on all samples, and all 78 in the group "within reach of the tables". The 6 pairs that do not overlap each have a run from a uniform start above a run from today's choice or above the temperature that falls to 0.2, e.g. 10 passes from a uniform start, 96.49 (96.48 to 96.51), against 10 passes from today's choice, 96.37 (96.32 to 96.41). So the setting was not picked by its score. A score of the chosen row is one of 13 that were looked at, and the reported runs below, with other seeds and other blanks, are the numbers to quote.
- **The start.** A blanked cell holds today's choice in the base, and by default a trainable mix starts with a share of 0.9 on it. A uniform start gives every choice the same share, which is the honest blank: the run then knows nothing about the cell. The uniform start has the higher mean at 1, 3 and 10 passes, by 0.05 to 0.12 points, so the honest blank costs nothing and was taken.
- **The passes.** 3 passes and 10 passes from a uniform start are 0.03 points apart with ranges that overlap, and 10 passes take three times as long. So 3. The 10 passes have the narrower range, 0.03 points against 0.16, which 3 seeds do not settle.
- **The learning rate, the temperature and the sharpness cost do not matter for the score**, and two of them cost something that the main number does not show. With a sharpness cost the depth of valid JSON that is too deep is wrong at 8% to 15% of the code points, against 1.3% and 2.6% for the chosen setting, and 5 to 17 code points are shown as past the end. 10 passes, a start at today's choice with 3 passes, and a learning rate of 0.2 also raise it, to 5.2% in the first form of such texts and 9% to 11% in the second. A temperature that falls to 0.2 lowers the group "within reach of the tables" to 99.37. So the defaults stay.
- **In every setting the score comes back and the hand-written choices do not**: 94% to 100% of the lost score, and the hand-written choice in 5% to 12% of the blanked cells. That is the arm's result, and no setting of the trainer changes it.

## Results

The validation split of the standard set, the exact parser: 5,021 broken samples, 425 of them with nothing to recover, 675,949 scored code points. Percentages, as the mean and in brackets the lowest and the highest of the seeds 1 to 5. A number without brackets is one run: a search without a seed, or the one run that the row with fixed blanks shares with seed 1. Every reported setting was run once, with the trainer's setting above. `report.ts` prints every table of this section.

### What blanking costs, and what comes back

"Comes back" is the share of what the blanks cost that the filled tables have again, per seed, e.g. 100% for tables that score as the hand-written ones.

All three, all validation samples. The hand-written tables have 96.52.

| blanked | not filled | trained | comes back | searched | comes back |
| --- | --- | --- | --- | --- | --- |
| 10% | 89.93 (87.76 to 90.80) | 96.52 (96.37 to 96.60) | 100.0 (97.6 to 101.4) | 96.60 (96.43 to 96.96) | 101.5 (98.8 to 107.0) |
| 10%, the blanks of seed 1 for every seed | 87.76 | 96.52 (96.50 to 96.54) | 100.0 (99.8 to 100.3) | 96.43 | 99.1 |
| 25% | 85.61 (81.68 to 88.45) | 96.50 (96.27 to 96.93) | 99.4 (97.3 to 102.8) | 96.64 (96.40 to 96.84) | 100.9 (98.7 to 103.6) |
| 50% | 74.84 (66.54 to 83.06) | 96.44 (96.14 to 97.02) | 99.5 (98.1 to 101.7) | 96.69 (95.81 to 97.32) | 100.3 (94.8 to 102.8) |
| 100% | 42.69 | 96.96 (96.87 to 97.06) | 100.8 (100.7 to 101.0) | 88.25 | 84.6 |

All three, the group "within reach of the tables". The hand-written tables have 99.51.

| blanked | not filled | trained | comes back | searched | comes back |
| --- | --- | --- | --- | --- | --- |
| 10% | 94.54 (92.88 to 95.24) | 99.48 (99.32 to 99.59) | 99.5 (95.6 to 101.9) | 99.46 (99.36 to 99.50) | 99.1 (97.9 to 99.8) |
| 10%, the blanks of seed 1 for every seed | 92.88 | 99.51 (99.50 to 99.54) | 100.1 (99.9 to 100.4) | 99.36 | 97.9 |
| 25% | 91.31 (88.24 to 93.24) | 99.40 (99.27 to 99.54) | 98.6 (96.3 to 100.5) | 99.30 (99.14 to 99.45) | 97.1 (94.1 to 99.4) |
| 50% | 80.92 (72.01 to 90.50) | 99.24 (99.03 to 99.39) | 98.4 (96.9 to 99.5) | 99.20 (98.59 to 99.51) | 97.3 (89.8 to 100.0) |
| 100% | 47.44 | 99.24 (99.09 to 99.44) | 99.5 (99.2 to 99.9) | 92.97 | 87.4 |

Whole samples, all validation samples. The hand-written tables have 80.44.

| blanked | not filled | trained | comes back | searched | comes back |
| --- | --- | --- | --- | --- | --- |
| 10% | 66.35 (58.66 to 73.35) | 79.85 (78.05 to 80.42) | 94.7 (77.8 to 99.9) | 80.30 (80.13 to 80.55) | 98.7 (96.0 to 100.8) |
| 10%, the blanks of seed 1 for every seed | 58.66 | 80.30 (80.22 to 80.46) | 99.3 (99.0 to 100.1) | 80.27 | 99.2 |
| 25% | 58.97 (51.91 to 66.38) | 76.46 (71.15 to 80.07) | 79.3 (59.4 to 98.7) | 76.28 (71.08 to 80.37) | 80.3 (59.2 to 99.8) |
| 50% | 45.27 (30.35 to 57.03) | 73.32 (62.90 to 77.72) | 77.5 (38.4 to 92.7) | 78.28 (75.61 to 79.37) | 92.6 (79.4 to 97.9) |
| 100% | 11.92 | 74.94 (73.35 to 75.81) | 92.0 (89.6 to 93.2) | 56.29 | 64.8 |

- **The code points come back at every share**: 99.4% to 100.8% of what was lost, as the mean over the seeds.
- **In the group "within reach of the tables" a little stays lost, and more with a larger share**: 99.48, 99.40, 99.24 and 99.24 against the hand-written 99.51. At the shares 50 and 100 no seed reaches the hand-written tables there.
- **Whole samples come back least**: at the shares 25 and 50 about a fifth of the lost ones stays lost, and one seed of the share 50 gets back 38.4%.
- **With every decision blanked, training ends 0.45 points above the hand-written tables on all samples and 0.26 below them in the group within reach**, and neither pair of ranges overlaps. So the two rows disagree, as they do for the plain pass.

**The two sources of spread, at the share 10.** All three on all samples, the seeds one by one:

- A seed's own blanks: not filled 87.76, 90.80, 90.35, 90.17, 90.56; trained 96.51, 96.58, 96.60, 96.52, 96.37; searched 96.43, 96.63, 96.55, 96.96, 96.44.
- The blanks of seed 1 for every seed: not filled 87.76; trained 96.51, 96.50, 96.50, 96.54, 96.54.

The order of the training alone moves the score by 0.04 points. With the blanks drawn anew the trained scores are 0.23 points apart, and whole samples 2.4 points, against 0.2 with fixed blanks. So at this share almost all of the spread is which decisions were blanked.

### Which blanked cells hold the hand-written choice again

A train sample reads a cell when the exact parser reads the cell on the sample's text with the hand-written tables. The columns by readers add up the runs of a row, e.g. "18 of 38" over 5 runs.

**Read the split by readers with care: it does not say which cells a run can learn.** The filled tables are another parser than the hand-written one and take other paths through the tables. Of the blanked cells that no train sample reads with the hand-written tables, a train sample reads 18% with the trained tables at the share 10, 37% at 25, 58% at 50 and 47% at 100. And the twin reads every cell that has a share, however small, so training also moves cells that no exact run reads, see `../../soft/README.md`. So the fair number is the one over all blanked cells, and the columns by readers are a breakdown of it.

Trained:

| blanked | blanked cells | of them, no train sample reads | of those, read with the trained tables | hand's choice, of all blanked cells | hand's choice, of the cells that a train sample reads | hand's next state, of the cells that a train sample reads | read by 1 to 9 train samples | read by 10 to 99 | read by 100 to 999 | read by 1,000 or more | read by none |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10% | 92 | 48 (40 to 57) | 42 of 238, 18% | 11.3 (5.4 to 17.4) | 16.5 (6.4 to 25.0) | 18.6 (6.4 to 28.8) | 5 of 84, 6% | 3 of 58, 5% | 11 of 42, 26% | 18 of 38, 47% | 15 of 238, 6% |
| 10%, the blanks of seed 1 for every seed | 92 | 40 | 24 of 200, 12% | 17.8 (15.2 to 20.7) | 24.6 (23.1 to 26.9) | 28.8 (26.9 to 30.8) | 13 of 100, 13% | 10 of 65, 15% | 15 of 40, 38% | 26 of 55, 47% | 18 of 200, 9% |
| 25% | 229 | 113 (106 to 128) | 212 of 567, 37% | 12.7 (10.0 to 15.7) | 16.0 (12.2 to 19.8) | 19.5 (16.3 to 22.8) | 14 of 225, 6% | 19 of 153, 12% | 23 of 118, 19% | 36 of 82, 44% | 53 of 567, 9% |
| 50% | 458 | 234 (227 to 247) | 680 of 1,170, 58% | 13.6 (11.8 to 15.7) | 17.1 (14.7 to 20.9) | 20.3 (18.0 to 24.0) | 48 of 427, 11% | 45 of 294, 15% | 57 of 231, 25% | 42 of 168, 25% | 120 of 1,170, 10% |
| 100% | 915 | 474 | 1,118 of 2,370, 47% | 27.9 (25.7 to 30.9) | 28.3 (27.0 to 29.7) | 31.2 (29.5 to 33.8) | 177 of 800, 22% | 136 of 590, 23% | 147 of 470, 31% | 164 of 345, 48% | 652 of 2,370, 28% |

Searched:

| blanked | blanked cells | of them, no train sample reads | of those, read with the searched tables | hand's choice, of all blanked cells | hand's choice, of the cells that a train sample reads | hand's next state, of the cells that a train sample reads | read by 1 to 9 train samples | read by 10 to 99 | read by 100 to 999 | read by 1,000 or more | read by none |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10% | 92 | 48 (40 to 57) | 14 of 238, 6% | 14.6 (10.9 to 18.5) | 30.5 (23.4 to 41.5) | 36.0 (28.6 to 51.2) | 17 of 84, 20% | 19 of 58, 33% | 11 of 42, 26% | 20 of 38, 53% | 0 of 238, 0% |
| 10%, the blanks of seed 1, one run | 92 | 40 | 4 of 40, 10% | 15.2 | 26.9 | 36.5 | 3 of 20, 15% | 4 of 13, 31% | 2 of 8, 25% | 5 of 11, 45% | 0 of 40, 0% |
| 25% | 229 | 113 (106 to 128) | 105 of 567, 19% | 16.9 (10.5 to 21.8) | 31.1 (18.7 to 37.1) | 37.3 (26.0 to 44.0) | 42 of 225, 19% | 64 of 153, 42% | 27 of 118, 23% | 45 of 82, 55% | 16 of 567, 3% |
| 50% | 458 | 234 (227 to 247) | 394 of 1,170, 34% | 15.3 (12.2 to 18.8) | 25.5 (19.9 to 31.6) | 30.5 (26.1 to 35.5) | 69 of 427, 16% | 88 of 294, 30% | 54 of 231, 23% | 76 of 168, 45% | 64 of 1,170, 5% |
| 100%, one run | 915 | 474 | 340 of 474, 72% | 9.0 | 14.7 | 17.7 | 20 of 160, 13% | 24 of 118, 20% | 14 of 94, 15% | 7 of 69, 10% | 17 of 474, 4% |

- **Training puts the hand-written choice back into about one blanked cell in eight** at the shares 10, 25 and 50, and into 28% with every decision blanked.
- **More readers help, and do not settle it.** Of the cells that 1,000 or more train samples read, 44% to 48% hold the hand-written choice after training at the shares 10, 25 and 100, and 25% at the share 50. E.g. the grammar cell (colon, closeObject, depth 2 to 15, object), which 2,717 train samples read: the hand-written tables go to `commaOrClose` there, and a tuning run went to `value`.
- **The same blanks trained in another order end with other choices**: with the blanks of seed 1, 15.2% to 20.7% of the 92 cells hold the hand-written choice, while the score stays within 0.04 points.
- **At the share 100 a cell that no train sample reads holds the hand-written choice as often as one that is read**: 652 of 2,370 such cells over the 5 runs, 27.5%, against 28.3% of the cells that are read. That is the reason for the warning above: with every decision blanked the trained tables are far from the hand-written ones, and "read with the hand-written tables" says little about what the run saw.
- **The search holds the hand-written choice more often than training where few decisions are blanked**, 14.6% against 11.3% of all blanked cells at the share 10, and it leaves a cell that nothing reads as it is. With every decision blanked it holds 9.0%.

What the trained tables and the searched tables of the same blanks hold, cell by cell, over the runs of a row:

| blanked | cells | both hold hand's choice | only the trained tables | only the searched tables | both hold the same other choice | two other choices |
| --- | --- | --- | --- | --- | --- | --- |
| 10% | 460 | 22 | 30 | 45 | 24 | 339 |
| 25% | 1,145 | 57 | 88 | 137 | 34 | 829 |
| 50% | 2,290 | 110 | 202 | 241 | 87 | 1,650 |
| 100% | 4,575 | 160 | 1,116 | 250 | 121 | 2,928 |

Training and the search agree on a cell's choice in one cell in ten: 46 of 460 at the share 10. So the two do not find the same tables, they find two of many tables with about the same score.

### Is the other choice as good?

For the share 10, every blanked cell that ended with another choice than the hand-written one is judged alone, by the scored code points of the validation split with all three labels right, in two directions:

- **In the filled tables**: the filled tables against the same tables with the hand-written choice in that one cell.
- **In the hand-written tables**: the hand-written tables with the filled choice in that one cell against the hand-written tables as they are.

A cell that no validation sample reads changes nothing. The counts are cells over the runs of a row.

| blanked | filled by | blanked cells | with another choice than hand's | in the filled tables: not read | as many code points | the filled choice has more | the filled choice has fewer | in the hand-written tables: not read | as many code points | the filled choice has more | the filled choice has fewer | more in the filled tables and fewer in the hand-written ones |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10% | training | 460 | 408 | 249 | 72 | 46 | 41 | 278 | 64 | 29 | 37 | 5 |
| 10% | the search | 460 | 393 | 276 | 62 | 46 | 9 | 287 | 43 | 35 | 28 | 10 |
| 10%, the blanks of seed 1 for every seed | training | 460 | 378 | 237 | 61 | 44 | 36 | 254 | 47 | 33 | 44 | 9 |
| 10%, the blanks of seed 1, one run | the search | 92 | 78 | 48 | 18 | 9 | 3 | 54 | 8 | 7 | 9 | 3 |

- **Four in five of the other choices make no difference on the validation split**: 321 of 408 in the trained tables, and 342 of 408 in the hand-written tables. Most of those cells are read by no validation sample at all.
- **The rest splits about evenly for training**: 46 cells with more code points and 41 with fewer in the trained tables, 29 and 37 in the hand-written tables. So where the validation split can tell, the trained choice is as often worse than the hand-written one as better.
- **The search leaves fewer cells that are worse in its own tables**, 9 against 41, since it only keeps a choice that has more code points right on the train split.
- **The table counts cells and no code points, on purpose.** The cells of filled tables were chosen to fit each other, so what one cell is worth inside them does not add up. E.g. in one searched run the single cells add up to 12,452 code points, and the whole tables are 3,007 code points above the hand-written ones. A cell with "more" in the filled tables is not shown to hold a better choice than the person's: 5 of the 46 such cells of training have fewer code points when their choice is put into the hand-written tables.

Where the filled tables show the display kind, the depth and the container that the hand-written tables show, on the broken validation samples: of the scored code points, and of the code points that the damage added, which have no label.

| blanked | trained, scored code points | trained, added code points | searched, scored code points | searched, added code points |
| --- | --- | --- | --- | --- |
| 10% | 99.79 (99.68 to 99.90) | 96.48 (92.08 to 98.74) | 99.69 (99.28 to 99.92) | 96.80 (96.21 to 97.74) |
| 10%, the blanks of seed 1 for every seed | 99.89 (99.87 to 99.90) | 94.38 (91.27 to 95.88) | 99.71 | 96.57 |
| 25% | 99.11 (98.64 to 99.74) | 91.27 (89.17 to 92.78) | 99.00 (98.46 to 99.52) | 91.77 (86.96 to 94.19) |
| 50% | 98.21 (97.80 to 98.68) | 86.85 (81.58 to 89.83) | 98.07 (97.06 to 98.60) | 87.77 (79.91 to 93.89) |
| 100% | 97.82 (97.71 to 98.02) | 84.88 (80.61 to 86.85) | 88.11 | 59.35 |

Where a label says what a code point is, the trained tables show what the person's tables show at 97.8% to 99.8% of the code points. Where no label does, they agree less, and less with every larger share: 96.5% down to 84.9%. E.g. a comment is added code points: nothing in the loss says how its letters are shown, only what the parser's state is after it.

### Training against a plain search of the same cells

As `describeComparison` says it, all three:

- 10% blanked, all validation samples: trained 96.52 (96.37 to 96.60), searched 96.60 (96.43 to 96.96). The means differ by -0.09 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- 10% blanked, within reach of the tables: trained 99.48 (99.32 to 99.59), searched 99.46 (99.36 to 99.50). +0.03 points, and the two ranges overlap.
- 25% blanked, all validation samples: trained 96.50 (96.27 to 96.93), searched 96.64 (96.40 to 96.84). -0.13 points, and the two ranges overlap.
- 25% blanked, within reach of the tables: trained 99.40 (99.27 to 99.54), searched 99.30 (99.14 to 99.45). +0.10 points, and the two ranges overlap.
- 50% blanked, all validation samples: trained 96.44 (96.14 to 97.02), searched 96.69 (95.81 to 97.32). -0.25 points, and the two ranges overlap.
- 50% blanked, within reach of the tables: trained 99.24 (99.03 to 99.39), searched 99.20 (98.59 to 99.51). +0.04 points, and the two ranges overlap.
- 100% blanked, all validation samples: trained 96.96 (96.87 to 97.06) over 5 seeds, searched 88.25 and no seed. +8.71 points, and the two ranges do not overlap.
- 100% blanked, within reach of the tables: trained 99.24 (99.09 to 99.44), searched 92.97 and no seed. +6.27 points, and the two ranges do not overlap.

**With up to half of the decisions blanked, the gradient finds nothing that the plain search of the same cells does not find, and the other way round.** At these shares the search takes 3 to 92 s per run, and training 49 to 105 s. **With every decision blanked the search fails and training does not**: the search starts from today's tables with the person's 915 cells as its cells, and ends 8.7 points below training and 6.1 below the search from today's tables over all 1,326 open cells (94.34%). So from the same start, leaving the search only the person's cells costs it 6.1 points, and it shows 71.1% of the group "needs a display fix" and 54.8% of "needs a character class" where training has 97.6% and 93.3%. Why is not measured. One reading: a search that changes one cell at a time needs tables in which a single cell already pays, the hand-written tables around a few blanks are such tables, and today's tables are not.

The search's choices of a tokenizer cell are the ones of `search.ts` with its defaults, which do not hold every pair of a next state and an event, so it reaches some hand-written choices only in two steps. `check-search.ts` shows that the restricted search is the search of `search.ts`: from the hand-written tables, with all 1,326 open cells as its cells, it gives the tables of the number to beat.

### Every decision blanked: does knowing which cells matter help?

With every decision blanked the trainable cells are the 915 that the person changed. The setting "every open cell" trains all 1,326 with the same setting of the trainer, from the same tables. All three:

- All validation samples: the 915 cells have 96.96 (96.87 to 97.06) over 5 seeds, every open cell has 96.88 (96.69 to 97.02). The means differ by +0.08 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- Within reach of the tables: 99.24 (99.09 to 99.44) against 99.27 (99.15 to 99.36). -0.03 points, and the two ranges overlap.
- Against the plain pass, which is one pass with the defaults over every open cell, all validation samples: 96.96 (96.87 to 97.06) against 96.50 (95.88 to 96.74), +0.46 points, and the two ranges do not overlap. Within reach: 99.24 against 99.11 (98.87 to 99.31), and the two ranges overlap.
- Every open cell with this arm's setting against the plain pass: 96.88 (96.69 to 97.02) against 96.50 (95.88 to 96.74), +0.38 points, and the two ranges overlap.
- Against the number to beat, the search from the hand-written tables: 96.96 against 97.75 on all samples and 99.24 against 99.68 within reach, and neither pair of ranges overlaps.

**For the score, no.** The mask of the person's cells is not told apart from every open cell. What stands 0.46 points above the plain pass is mostly the setting of the trainer, 3 passes from a uniform start, which every open cell gets too. **For what the score does not show, yes**: see the next table, where the person's cells keep the depth of valid JSON that is too deep wrong at 10% to 15% of the code points, and every open cell at 48% to 55%, with ranges that do not overlap. And no setting of this arm reaches the number to beat.

### What the main number does not show

| setting | whole samples | added code points shown as an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | grammar cells with a stack action that does something else than their token |
| --- | --- | --- | --- | --- | --- | --- |
| hand-written, 35 rules | 80.44 | 0.0 | 0 | 0.0 | 0.0 | 21 |
| search from the hand-written tables | 79.37 | 0.0 | 0 | 18.5 | 30.2 | 94 |
| the plain pass | 73.22 (72.76 to 73.54) | 0.9 (0.7 to 1.1) | 50 (0 to 160) | 3.0 (0.0 to 12.3) | 4.7 (0.0 to 16.4) | 26 in the first seed |
| 10% blanked, not filled | 66.35 (58.66 to 73.35) | 7.2 (2.2 to 9.3) | 0 | 0.0 | 1.0 (0.0 to 2.3) | 19 in the first seed |
| 10% blanked, trained | 79.85 (78.05 to 80.42) | 0.0 | 1 (0 to 3) | 7.3 (0.0 to 35.6) | 12.3 (0.0 to 34.0) | 24 |
| 10% blanked, searched | 80.30 (80.13 to 80.55) | 0.0 (0.0 to 0.2) | 0 | 2.3 (0.0 to 11.7) | 4.9 (0.0 to 21.6) | 24 |
| 10% blanked as with seed 1, trained | 80.30 (80.22 to 80.46) | 0.0 | 0 | 0.0 | 23.9 (23.8 to 24.0) | 24 |
| 25% blanked, trained | 76.46 (71.15 to 80.07) | 0.0 | 115 (0 to 569) | 13.2 (0.6 to 44.8) | 18.3 (0.0 to 55.7) | 28 |
| 25% blanked, searched | 76.28 (71.08 to 80.37) | 0.1 (0.0 to 0.2) | 0 | 8.9 (0.0 to 44.5) | 11.8 (0.0 to 53.4) | 23 |
| 50% blanked, trained | 73.32 (62.90 to 77.72) | 0.0 | 971 (0 to 2,177) | 8.1 (2.6 to 21.0) | 13.0 (1.0 to 35.7) | 44 |
| 50% blanked, searched | 78.28 (75.61 to 79.37) | 0.2 (0.1 to 0.4) | 0 | 8.0 (0.0 to 29.1) | 16.4 (0.0 to 29.6) | 37 |
| 100% blanked, trained | 74.94 (73.35 to 75.81) | 0.0 | 10 (0 to 37) | 10.4 (8.0 to 15.6) | 14.7 (11.7 to 19.1) | 59 |
| 100% blanked, searched | 56.29 | 3.6 | 0 | 30.8 | 16.8 | 66 |
| every open cell trainable, the same setting of the trainer | 73.46 (71.54 to 74.56) | 0.0 | 16 (0 to 79) | 47.9 (41.7 to 68.8) | 54.6 (48.0 to 78.3) | 124 |

The last column is the count of the first seed where a setting has seeds. The ground rules hold on the fixed texts for every run.

- **The depth of valid JSON that is too deep is a decision that training does not put back.** The hand-written rules leave the stack alone in the contexts of depth 16, so that such a text keeps the depth it has today. The dataset has no text deeper than 16 levels, so nothing in the train split asks for it, and the filled tables have that depth wrong at 7% to 18% of the code points, as the mean over the seeds. With the blanks of seed 1 all five orders of the training end at 0.0 and 23.9: which blanks were drawn decides it, and the order does not.
- **Trained tables show code points as past the end**, up to 2,177 in one seed of the share 50, where the hand-written tables and every searched tables show none. A trained tokenizer cell can snap to an event of a text's end, and the search does not try those events.
- **Whole samples**: the search keeps more of them than training at the share 50, 78.28 (75.61 to 79.37) against 73.32 (62.90 to 77.72), with ranges that overlap.

## What the arm shows

- **Training fills the blanks of a hand-written recovery so that the score is the hand-written one again**, for a tenth of the decisions and for all of them, in 3 passes. At the share 10, 13 settings of the trainer end within 0.2 points of each other.
- **It does not put the person's decisions into the blanks.** One blanked cell in eight holds the hand-written choice again, fewer than half of the cells that a thousand train samples read, and the same blanks trained in another order end with other choices. The tables that come out score like the person's parser and are not the person's parser.
- **The samples leave most of these choices open.** Four in five of the other choices change no scored code point of the validation split, most of them because nothing reads the cell. And the trained tables part from the person's most where no label is: they show what the hand-written tables show at 99.8% of the scored code points and at 96.5% of the added ones with a tenth blanked, and at 97.8% and 84.9% with every decision blanked.
- **What a person decided for a reason that no sample holds is lost**, e.g. the depth of valid JSON that is too deep, which every share of blanks breaks in some seeds.
- **With up to half of the decisions blanked, a plain search of the same cells is not told apart from training by its score**, and it takes less time. With every decision blanked the search ends 8.7 points below training.
- **The list of the person's cells does not raise the score** against training every open cell. In two columns that the score does not show, it keeps the tables nearer to the hand-written ones: the depth of valid JSON that is too deep, and the count of grammar cells whose stack action is not their token's, 59 against 124.

## What the arm does not show

- **Nothing here is a number on unseen data.** For the hand-written tables no split of this dataset counts as unseen, and the setting of the trainer was chosen with validation scores in view, among 13 settings, on other seeds.
- **Not whether a person would have left these blanks.** The blanks are a random share of the cells. A person leaves a whole rule open, or the cells of one state, and whether training fills such a hole is not measured: 35 rules set 915 cells, 26 cells per rule on average, and a random share takes a few cells out of many rules.
- **Not that the other choices are as good as the person's on other text.** "As many code points" is the validation split of this dataset. 249 of the 408 other choices are read by no validation sample, so nothing was measured for them.
- **Not which cells a run can learn.** The split by readers uses the hand-written parser's paths, and the trained parser takes others.
- **The comparison of the two masks is one setting of the trainer**, tuned on the share 10 and on blanks inside the hand-written tables, not on every open cell.
- **The test split and the held-out kinds** were not scored.

## Commands

Run from the repo root. The four shares are four arms for the harness, `holes-10` to `holes-100`, so that they can run at the same time: a run of the harness moves the files of an earlier run of the same name away.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/handwritten/rules.ts                # the hand-written tables, which the next command starts from
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/handwritten/tables.json --out $RECOVERY_SCRATCH/search/search-from-handwritten.json   # the number to beat
bun lab/recovery-parser/learn/arms/plain-pass/run.ts              # the plain pass, which the report compares with
bun lab/recovery-parser/learn/arms/holes/run.ts --share 10        # 5 seeds, about 10 minutes with other jobs running
bun lab/recovery-parser/learn/arms/holes/run.ts --share 25        # about 9 minutes
bun lab/recovery-parser/learn/arms/holes/run.ts --share 50        # about 14 minutes
bun lab/recovery-parser/learn/arms/holes/run.ts --share 100       # about 20 minutes
bun lab/recovery-parser/learn/arms/holes/report.ts                # the tables above, from the saved runs
bun lab/recovery-parser/learn/arms/holes/check-search.ts          # the restricted search is the search of search.ts, about 3 minutes
```

The tuning runs, as they were run. Each command runs every combination of its lists with the seeds 11, 12 and 13:

```sh
bun lab/recovery-parser/learn/arms/holes/tune.ts --name passes-1-and-3 --passes 1,3 --start base,uniform
bun lab/recovery-parser/learn/arms/holes/tune.ts --name passes-10-base --passes 10 --start base
bun lab/recovery-parser/learn/arms/holes/tune.ts --name passes-10-uniform --passes 10 --start uniform
bun lab/recovery-parser/learn/arms/holes/tune.ts --name learning-rate --passes 3 --start uniform --learning-rate 0.02,0.1,0.2
bun lab/recovery-parser/learn/arms/holes/tune.ts --name temperature --passes 3 --start uniform --temperature-end 0.5,0.2
bun lab/recovery-parser/learn/arms/holes/tune.ts --name sharpness-cost --passes 3 --start uniform --sharpness-cost 0.01,0.1
```

## Files

- `holes.ts`: the decisions, the blanks of a share and a seed (`blanksOf`), the trainer's setting, the comparison of a cell's choice with the hand-written one (`sameChoice`), and how many train samples read each cell (`trainReadersOf`).
- `restricted-search.ts`: `searchCells(start, cells, trainSamples)`, the search of `../../search/search.ts` over some cells alone, run by that search's own worker threads. `check-search.ts` shows that with every open cell it gives the tables of `search.ts`.
- `run.ts`: the reported runs of one share.
- `tune.ts`: the tuning runs.
- `report.ts`: the tables of this README, from the saved runs.
