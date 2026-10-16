# Spare states: states that the parser does not have

The question of this arm, in the words of the person who asked for the experiment: beside filling holes, "see if things can learn new structures so to speak". Here the parser gets tokenizer states and grammar states that it does not have, with every cell open, and training may use them. Does the parser learn to remember something that today's states cannot hold?

Why a state can matter, from tables written by hand: the dataset's hand rule `lines` is the rule `words` with one more tokenizer state, and it has 99.6% of the group "needs a line rule" where `words` has 97.8%.

Words, besides the ones of `../../README.md`:

- A **spare state** is a tokenizer state or a grammar state that today's tables do not have. Today's tables have 26 tokenizer states and 8 grammar states, so the spare ones are numbered from 26 and from 8, e.g. "the tokenizer state 26". A spare tokenizer state has 33 cells, one per class, and a spare grammar state 88, one per token and context. All of them are open.
- A code point is **read in a state** when the parser is in the state before the code point. E.g. with tables that go into the state 26 at the `p` of `{port: 1}`, the letters `ort` and the colon are read in the state 26.
- A spare state is **sent** to a state of today's when every cell that leads into the spare state leads into that state instead, and nothing else changes.
- A spare state is **folded** into a state of today's when it is sent there and that state's open cells take the spare state's choices, for the cells of the spare state that a train sample reads. The state of today's then does the spare state's job for every text that comes into it. What the tables lose by the folding is what the spare state holds apart: something that this state of today's cannot hold next to its own job.
- The state of today's is the spare state's **stand-in**: the one of today's states of the same table with which the first 8,000 samples of the train split keep the most scored code points right.

## What the arm shows

The validation split, the exact parser, the seeds 1 to 5, every reported setting run once. A number with brackets is the mean of the seeds with the lowest and the highest. "All three" is on all samples unless a row is named. Two ranges are "apart" when every seed of one setting is above every seed of the other.

1. **Training uses spare tokenizer states, and what it puts into them, today's states can hold.** With the plain pass, 2.5% to 9.0% of the code points after a first error are read in a spare tokenizer state. Sent to a state of today's as it is, the spare tokenizer states cost 0.4 to 1.6 points of all three. Folded into a state of today's, they cost 0.02 to 0.15.
2. **By their ranges, the seeds tell no setting from its control on the main number. Seed by seed, the settings with 4 spare tokenizer states or more are a little above it**: in 25 of 30 pairs with the same seed, by 0.27 points on average. E.g. 4 spare tokenizer states have 96.83 (96.29 to 97.19) against the control's 96.50 (95.88 to 96.74) with the plain pass.
3. **The gain is in rows about words without quotes, and tables of today's layout keep it.** Over all 73 rows of a record, 37 of 1,314 comparisons with the plain pass's control are apart, all of them upward and all with 4 spare tokenizer states or more, e.g. the kind `unquotedKey` by 1.7 to 2.1 points. With the spare states folded away, `unquotedKey` is still above the control's range. So where spare states help here, they help the training reach better tables of today's layout.
4. **Spare grammar states are hardly used when every open cell is trainable**: 0.4% to 1.1% of the code points are read in one with the plain pass, and no row of the three settings with grammar states alone is apart from the control.
5. **Beside rules that a person wrote, spare states add 0.1 to 0.65 points to the hand-written 96.52, and a run moves up to 337 of the 915 cells that the rules set to do it.** What stays as the person wrote it is the event or the stack action of every cell of the person's states, and the next state of the cells that training did not move. Whole samples fall in every setting.
6. **The spare grammar states beside the hand-written rules are the one place where spare states hold a part of what they add**: taking only them away costs 0.09 to 0.49 points in 19 of 20 seeds, of the 0.4 to 0.65 points that those settings add.
7. **Beside `words`, training finds the step out of a string at a line feed, and not the state of `lines`.** The group "needs a line rule" has 99.14% of its code points right, where `lines` has 99.62%, and 12% to 84% of its samples whole, where `lines` has 98.4% and `words` 96.7%.
8. **A search uses spare states too, and gains nothing that its orders tell apart**: 97.80 (97.78 to 97.83) in three orders against 97.73 (97.63 to 97.80) without spare states.
9. **Not in the main number**: more code points are shown as past the end, the depth of valid JSON that is too deep is wrong in more seeds, 31 of 45 against 2 of 5, and beside the hand-written rules, which keep that depth, spare grammar states break it.

## Setup

- **The base** is today's tables with spare states, from `addStates`: a spare tokenizer state starts as a copy of the state `errorLine`, a spare grammar state as a copy of the state `error`, and no cell leads into either. The display table stays fixed, with a column per spare grammar state: the first is shown as the state `colon`, after which a string is shown as a key, the second as `commaOrClose`, and so on in turn.
- **Every open cell is trainable**, the spare states' cells among them, and a cell of another state may lead into a spare one: 1,326 cells, and 33 more per spare tokenizer state and 88 more per spare grammar state. **The control** is the same trainer's setting with the same seeds and no spare state. With the plain pass it is the tables of `../plain-pass/`, seed by seed.
- **Two settings of the trainer**: the plain pass (1 pass, every mix starts with a share of 0.9 on the base's choice), and the setting that the arm `../holes/` chose (3 passes from a uniform start). `--trainer` of `run.ts` also takes five values, so that a tuned setting can be put in.
- **A second kind of run starts from tables that a person wrote**, with spare states: the hand-written tables of `../../handwritten/`, and the dataset's hand rule `words`. There only the spare states' cells are trainable, and whether an open cell of a person's state leads into a spare state: such a cell keeps its event or its stack action, and its next state is the person's or a spare one. The control is the person's tables, which have no seed.
- The tables of a seed are the last ones of its run, scored by the harness in the exact parser on the validation split.

**What the arm is.** It may change every open cell, and its tables have up to 16 more tokenizer states and 4 more grammar states than today's. They have today's classes, no bit, and today's display table with a copied column per spare grammar state. Trained grammar cells hold stack actions that do something else than their token does, so the tables are no tables of the dataset's plain table parser, except the ones beside `words`. For the runs from the hand-written tables and from `words` no split of this dataset counts as unseen, see `../README.md`.

## The start of a spare state

In the base no cell leads into a spare state. But a trainable cell holds a mix over every next state, so a part of every open cell's mix leads into each spare state from the first step on. Two spare states that start with the same weights get the same gradients and stay the same state. So `createSpareModel` adds a random number to every weight of a spare state's own cells, and to every weight with which a cell leads into a spare state: the size `noise` times a draw of the standard normal distribution, from the run's seed.

The size was tuned on the seeds 11, 12 and 13. Every run:

| spare states | trainer | noise | all three | within reach | whole samples | at the start: share of an open tokenizer cell's mix that leads into a spare state, % | cells in which the snapped start differs from the base, per seed | spare states that are a copy of another spare state, per seed | spare states that a train sample reads, per seed | own cells of the spare states that differ from the base, per seed | validation code points read in a spare state, of 729,034, per seed | sent: all three |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4 tokenizer | plain pass | 0 | 96.22 (95.99 to 96.42) | 98.85 (98.73 to 99.04) | 72.28 (70.91 to 73.59) | 1.4 (1.4 to 1.4) | 0, 0, 0 | 3, 3, 3 | 0, 1, 0 | 96, 112, 104 of 132 | 0, 1, 0 | 0.00 (0.00 to 0.00) |
| 4 tokenizer | plain pass | 0.3 | 96.22 (95.86 to 96.58) | 98.84 (98.70 to 98.98) | 72.36 (71.48 to 73.41) | 1.4 (1.4 to 1.4) | 0, 0, 0 | 0, 0, 0 | 1, 4, 3 | 106, 115, 104 of 132 | 2,032, 16,104, 162 | -0.10 (-0.17 to -0.01) |
| 4 tokenizer | plain pass | 1 | 96.54 (96.29 to 96.68) | 99.00 (98.89 to 99.20) | 72.95 (70.91 to 75.00) | 2.3 (2.2 to 2.3) | 0, 0, 0 | 0, 0, 0 | 4, 4, 3 | 116, 118, 112 of 132 | 53,518, 45,397, 56,343 | -0.98 (-1.24 to -0.71) |
| 4 tokenizer | plain pass | 2 | 96.58 (96.19 to 96.93) | 99.05 (98.79 to 99.24) | 73.88 (73.11 to 75.13) | 7.4 (7.3 to 7.5) | 59, 72, 66 | 0, 0, 0 | 4, 4, 2 | 118, 122, 116 of 132 | 25,010, 38,337, 26,804 | -0.51 (-0.59 to -0.41) |
| 4 tokenizer | plain pass | 3 | 96.34 (96.16 to 96.68) | 99.01 (98.50 to 99.33) | 72.57 (70.74 to 73.61) | 19.2 (19.1 to 19.3) | 196, 209, 196 | 0, 0, 0 | 4, 4, 4 | 125, 129, 128 of 132 | 6,211, 22,725, 13,735 | -0.29 (-0.45 to -0.18) |
| 1 tokenizer | plain pass | 0 | 96.21 (95.99 to 96.55) | 98.86 (98.64 to 99.04) | 72.27 (71.02 to 73.59) | 0.4 (0.4 to 0.4) | 0, 0, 0 | 0, 0, 0 | 0, 1, 1 | 25, 28, 24 of 33 | 0, 2, 22 | +0.00 (0.00 to +0.01) |
| 4 tokenizer | 3 passes | 1 | 97.01 (96.89 to 97.07) | 99.33 (99.21 to 99.40) | 73.22 (72.41 to 74.11) | 19.2 (19.2 to 19.2) | 809, 797, 796 | 0, 0, 0 | 4, 3, 4 | 132, 131, 129 of 132 | 50,781, 44,117, 20,684 | -0.51 (-0.80 to -0.25) |

- **With the plain pass's start and no random part, the spare states stay copies and stay unused.** 3 of the 4 end as the same state as another one, cell by cell, and 0, 1 and 0 of the 729,034 validation code points after a first error are read in a spare state. A single spare state is not used either: 0, 2 and 22 code points. This was run with the plain pass's start alone, where a single spare state has 0.4% of an open cell's mix, and not from a uniform start, where it has the share of every other state.
- **The scores do not tell the sizes apart**: every two of the five ranges of all three overlap. **The size 1 is the default.** It was the first size that was run, and the rule for it was written after the five sizes were in: the smallest size with which the train samples read 3 or 4 of the 4 spare states in every seed.
- **With the size 1 the snapped start is the base in these three seeds.** In the reported runs with the plain pass it differs from the base in 0 to 3 cells with spare tokenizer states alone, in 1 to 15 with spare grammar states, and in 0 to 8 beside a person's rules.
- **A spare state that training left unused still has changed cells**, since the twin reads every cell that has a share: e.g. 96 to 112 of the 132 cells of the 4 spare states without the random part. So "cells changed against the base" counts cells that no text reads.

## Results

The validation split of the standard set, the exact parser: 5,021 broken samples, 425 of them with nothing to recover, 675,949 scored code points. `report.ts` prints every table of this section from the saved runs, and more per setting: the seeds one by one, every row that is apart, and the sentences of `describeComparison`.

### Today's tables with spare states, every open cell trainable

All three per row of the score, then whole samples. In bold: the range is apart from the control's of the same trainer's setting. The two kinds of damage are the ones in which tables written by hand gained from a state: keys without quotes and a document per line. The column "needs a character class" was added after the results of the plain pass were in, so the count to read is the one over all rows below the table, which picks no row.

| tables | all | within reach | needs a line rule | needs a character class | needs a nesting fix | out of reach | unquotedKey | newlineDelimited | whole samples | whole samples, unquotedKey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| plain pass: none, the control | 96.50 (95.88 to 96.74) | 99.11 (98.87 to 99.31) | 99.66 (98.89 to 99.89) | 89.68 (88.86 to 90.46) | 89.39 (83.11 to 92.75) | 81.59 (76.88 to 83.61) | 95.22 (93.79 to 95.75) | 96.43 (91.99 to 97.59) | 73.22 (72.76 to 73.54) | 7.58 (5.86 to 9.38) |
| plain pass: 1 tokenizer | 96.64 (96.19 to 96.87) | 99.23 (99.20 to 99.31) | 99.66 (98.87 to 99.88) | 90.01 (88.89 to 90.98) | 89.78 (83.12 to 92.50) | 81.67 (76.32 to 83.64) | 95.71 (95.42 to 96.33) | 96.35 (91.99 to 97.59) | 72.99 (72.32 to 73.85) | 7.34 (4.69 to 9.38) |
| plain pass: 2 tokenizer | 96.49 (96.26 to 96.59) | 98.89 (98.45 to 99.27) | 99.64 (98.90 to 99.90) | 90.79 (89.69 to 93.18) | 89.49 (83.13 to 92.67) | 81.81 (76.00 to 83.79) | 95.89 (94.06 to 96.90) | 96.41 (91.99 to 97.59) | 73.56 (71.41 to 75.39) | 6.95 (1.95 to 10.55) |
| plain pass: 4 tokenizer | 96.83 (96.29 to 97.19) | 99.19 (99.11 to 99.26) | 99.89 (99.87 to 99.92) | **92.05 (90.88 to 94.05)** | 89.97 (83.12 to 92.66) | 81.29 (75.80 to 83.77) | **96.99 (96.53 to 98.21)** | 97.54 (97.35 to 97.63) | 74.20 (72.37 to 77.05) | 9.92 (8.20 to 14.84) |
| plain pass: 8 tokenizer | 96.75 (96.30 to 97.06) | 99.08 (98.98 to 99.22) | 99.70 (98.91 to 99.94) | **92.51 (91.68 to 93.36)** | 89.84 (83.12 to 92.67) | 80.99 (75.69 to 83.13) | **97.35 (96.23 to 98.00)** | 96.41 (91.99 to 97.59) | 74.86 (73.41 to 76.63) | 10.39 (8.20 to 13.67) |
| plain pass: 16 tokenizer | 96.91 (96.51 to 97.09) | 99.12 (98.61 to 99.39) | 99.71 (98.89 to 99.94) | **92.09 (90.95 to 92.86)** | 91.50 (89.34 to 92.68) | 82.83 (81.43 to 84.04) | **97.06 (96.47 to 97.44)** | 96.46 (91.99 to 97.59) | 74.83 (72.95 to 75.61) | **11.09 (10.16 to 12.11)** |
| plain pass: 1 grammar | 96.38 (96.04 to 96.66) | 99.02 (98.74 to 99.23) | 99.81 (99.76 to 99.86) | 88.95 (87.42 to 90.13) | 90.43 (83.10 to 92.82) | 81.47 (77.31 to 83.01) | 94.97 (94.06 to 95.61) | 97.57 (97.51 to 97.63) | 73.14 (71.76 to 73.89) | 6.95 (5.86 to 8.59) |
| plain pass: 2 grammar | 96.51 (96.09 to 96.76) | 99.04 (98.79 to 99.21) | 99.83 (99.77 to 99.88) | 90.10 (89.59 to 90.92) | 90.55 (83.40 to 92.81) | 81.34 (77.36 to 83.20) | 95.34 (94.66 to 96.02) | 97.46 (97.33 to 97.59) | 72.58 (70.69 to 74.13) | 7.19 (4.69 to 10.16) |
| plain pass: 4 grammar | 96.45 (96.16 to 96.64) | 99.12 (98.96 to 99.28) | 99.62 (98.81 to 99.88) | 89.84 (89.26 to 90.39) | 88.48 (83.48 to 92.72) | 80.83 (77.06 to 83.44) | 95.46 (94.98 to 95.92) | 96.38 (92.36 to 97.57) | 72.75 (70.91 to 75.50) | 7.58 (6.25 to 9.77) |
| plain pass: 4 tokenizer and 2 grammar | 96.76 (96.46 to 97.03) | 99.18 (98.97 to 99.28) | 99.88 (99.81 to 99.93) | **92.33 (90.91 to 94.01)** | 88.50 (83.36 to 92.72) | 80.50 (76.57 to 83.70) | **96.88 (96.12 to 98.00)** | 97.33 (96.61 to 97.59) | 74.14 (73.28 to 76.72) | 9.06 (6.64 to 11.72) |
| 3 passes: none, the control | 96.88 (96.69 to 97.02) | 99.27 (99.15 to 99.36) | 99.08 (98.87 to 99.81) | 91.04 (88.76 to 92.20) | 89.58 (88.32 to 91.14) | 83.64 (82.89 to 84.07) | 96.07 (95.45 to 96.55) | 93.45 (91.99 to 97.40) | 73.46 (71.54 to 74.56) | 8.28 (6.25 to 9.38) |
| 3 passes: 2 tokenizer | 96.95 (96.91 to 96.97) | 99.30 (99.21 to 99.41) | 99.06 (98.86 to 99.76) | 91.71 (90.36 to 92.48) | 89.44 (88.33 to 91.11) | 83.41 (83.18 to 83.56) | 96.51 (96.27 to 96.67) | 93.36 (91.98 to 97.58) | 74.13 (72.63 to 75.04) | 8.44 (7.81 to 9.38) |
| 3 passes: 4 tokenizer | 97.09 (96.93 to 97.22) | 99.36 (99.21 to 99.46) | 98.90 (98.82 to 98.94) | **92.80 (92.35 to 93.23)** | 89.35 (88.34 to 89.88) | 83.36 (83.07 to 83.80) | 96.88 (95.93 to 97.58) | 92.52 (91.99 to 92.65) | 75.34 (72.56 to 77.98) | 11.41 (5.86 to 16.02) |
| 3 passes: 8 tokenizer | 97.06 (96.79 to 97.17) | 99.30 (99.07 to 99.40) | 99.07 (98.86 to 99.84) | 92.35 (91.51 to 92.94) | 89.92 (89.52 to 91.31) | 83.75 (83.23 to 84.11) | 96.54 (96.00 to 97.18) | 93.63 (92.65 to 97.56) | 74.72 (74.39 to 75.48) | 9.06 (7.03 to 10.94) |
| 3 passes: 2 grammar | 97.00 (96.91 to 97.07) | 99.33 (99.28 to 99.37) | 99.06 (98.80 to 99.80) | 91.79 (90.31 to 92.43) | 89.23 (87.85 to 90.10) | 83.61 (83.21 to 84.03) | 96.48 (96.30 to 96.63) | 93.48 (92.60 to 96.85) | 73.18 (71.85 to 74.61) | 8.91 (7.42 to 12.11) |

- **No range of all three is apart from its control's**, on all samples or in the group "within reach of the tables". **Seed by seed**, the settings with 4 spare tokenizer states or more are above their control in 5, 4, 4 and 4 of 5 seeds with the plain pass (4, 8, 16, and 4 with 2 spare grammar states) and in 4 of 5 each with 3 passes (4, 8). The seven other settings are above in 18 of 35 pairs, by 0.02 points on average.
- **Over every row**, in all three and in whole samples, the 37 comparisons that are apart with the plain pass are 8 to 12 per setting with 4 spare tokenizer states or more, and none in the five other settings. In all four: the group "needs a character class" (+2.4 to +2.8), the kinds `unquotedKey` (+1.7 to +2.1), `singleQuotedString` (+2.8 to +3.3) and `foreignLiteral` (+1.5 to +1.8), and the family "other notation" (+1.4 to +1.9). With 3 passes 11 of 584 are apart, all upward, 6 of them with 4 spare tokenizer states.
- **No row falls with ranges apart.** Per setting, the largest fall of a mean is in a row of 3 to 29 samples, e.g. the kind `headMissing`, 14 samples, by 8.7 points with 4 spare grammar states, and once in the kind `proseAround`, 200 samples, by 3.4 points.
- **Whole samples with a key without quotes stay low**: 7.6% in the control and 9.1% to 11.1% with 4 spare tokenizer states or more. The dataset measured 51% for a second copy of the tokenizer's states that a person wrote, and 17% without it.

What the parser does with the spare states, and the same tables without them. The code points are the ones of the broken validation samples from their first error on, 729,034 of them. "Sent" and "folded": the spare states are taken away one after the other, the one that the train samples read most first, and the tables are scored again. The differences are in points. The last three columns are the scores of the folded tables, in which no text is in a spare state, in bold where the range is apart from the control's.

| tables | spare states that a train sample reads | code points read in a spare tokenizer state, % | in a spare grammar state, % | in a tokenizer state of today's other than `string` and `between`, % | sent: all three | whole samples | folded: all three | whole samples | the smaller of the two losses of all three, seed by seed | the folded tables: all three | needs a character class | unquotedKey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| plain pass: none, the control |  | 0.0 | 0.0 | 20.2 (20.0 to 20.3) |  |  |  |  |  | 96.50 (95.88 to 96.74) | 89.68 (88.86 to 90.46) | 95.22 (93.79 to 95.75) |
| plain pass: 1 tokenizer | 1 of 1 | 2.5 (0.0 to 5.2) | 0.0 (0.0 to 0.0) | 17.8 (15.4 to 20.1) | -0.37 (-0.78 to -0.00) | -0.63 (-2.02 to +0.02) | -0.02 (-0.08 to +0.01) | -0.10 (-0.28 to +0.04) | +0.00, -0.02, -0.08, +0.01, -0.03 | 96.61 (96.11 to 96.84) | 89.87 (88.90 to 90.48) | 95.61 (95.24 to 96.33) |
| plain pass: 2 tokenizer | 2 of 2 | 6.5 (3.6 to 9.3) | 0.0 (0.0 to 0.0) | 13.9 (11.7 to 16.7) | -0.78 (-1.39 to -0.32) | -1.79 (-3.18 to -0.24) | -0.05 (-0.11 to -0.00) | -0.15 (-0.50 to +0.02) | -0.11, -0.00, -0.05, -0.04, -0.07 | 96.44 (96.15 to 96.57) | 90.43 (88.99 to 92.89) | 95.83 (94.17 to 96.88) |
| plain pass: 4 tokenizer | 4 of 4 | 7.2 (3.8 to 11.9) | 0.0 (0.0 to 0.0) | 13.2 (9.3 to 16.4) | -1.03 (-1.63 to -0.53) | -1.54 (-4.16 to +0.04) | -0.09 (-0.12 to -0.08) | -0.44 (-0.78 to -0.15) | -0.10, -0.08, -0.12, -0.08, -0.08 | 96.74 (96.17 to 97.11) | 91.59 (90.21 to 93.57) | **96.63 (95.89 to 98.18)** |
| plain pass: 8 tokenizer | 6 to 8 of 8 | 9.0 (4.0 to 11.9) | 0.0 (0.0 to 0.0) | 11.9 (9.2 to 16.3) | -1.56 (-2.34 to -0.59) | -3.87 (-6.29 to -1.94) | -0.04 (-0.13 to +0.01) | -0.87 (-1.54 to -0.28) | +0.01, -0.02, -0.03, -0.04, -0.13 | 96.71 (96.27 to 97.07) | **92.27 (91.57 to 92.72)** | **97.14 (96.12 to 97.57)** |
| plain pass: 16 tokenizer | 11 to 15 of 16 | 8.8 (7.2 to 10.1) | 0.0 (0.0 to 0.0) | 12.2 (10.9 to 13.2) | -1.41 (-2.06 to -0.82) | -3.07 (-5.50 to -1.39) | -0.15 (-0.25 to -0.04) | -0.74 (-2.20 to +0.72) | -0.07, -0.20, -0.16, -0.25, -0.04 | 96.76 (96.43 to 96.98) | **91.60 (90.86 to 92.27)** | **96.72 (96.11 to 97.10)** |
| plain pass: 1 grammar | 1 of 1 | 0.0 (0.0 to 0.0) | 0.5 (0.0 to 2.5) | 20.2 (20.0 to 20.3) | -0.10 (-0.36 to +0.00) | +0.05 (-0.04 to +0.20) | -0.17 (-0.76 to +0.04) | -1.14 (-5.79 to +0.24) | -0.00, +0.00, +0.04, -0.05, -0.36 | 96.20 (95.50 to 96.56) | 88.54 (87.14 to 90.12) | 94.91 (93.79 to 95.57) |
| plain pass: 2 grammar | 2 of 2 | 0.0 (0.0 to 0.0) | 0.4 (0.0 to 2.0) | 20.1 (19.7 to 20.2) | -0.26 (-0.62 to +0.05) | +0.22 (-0.02 to +0.50) | -0.13 (-0.78 to +0.30) | -0.84 (-4.37 to +0.54) | +0.05, +0.01, +0.30, -0.15, -0.62 | 96.38 (95.90 to 96.72) | 89.27 (88.64 to 90.13) | 95.08 (93.37 to 96.02) |
| plain pass: 4 grammar | 2 to 4 of 4 | 0.0 (0.0 to 0.0) | 1.1 (0.0 to 2.4) | 20.5 (20.1 to 22.0) | -0.33 (-0.67 to -0.13) | +0.76 (0.00 to +2.24) | -0.24 (-0.72 to +0.05) | -3.39 (-12.29 to +0.85) | -0.40, -0.16, -0.01, -0.12, +0.05 | 96.21 (95.92 to 96.52) | 89.53 (89.16 to 90.04) | 95.36 (95.11 to 95.87) |
| plain pass: 4 tokenizer and 2 grammar | 6 of 6 | 7.5 (4.5 to 11.4) | 0.2 (0.0 to 0.4) | 12.9 (9.7 to 15.7) | -1.33 (-1.60 to -1.19) | -1.33 (-2.00 to -0.02) | -0.10 (-0.52 to +0.25) | -2.24 (-4.18 to -0.41) | -0.15, +0.19, -0.52, -0.29, +0.25 | 96.66 (96.05 to 97.17) | 91.55 (90.44 to 93.37) | **96.43 (95.96 to 96.98)** |
| 3 passes: none, the control |  | 0.0 | 0.0 | 20.1 (20.0 to 20.2) |  |  |  |  |  | 96.88 (96.69 to 97.02) | 91.04 (88.76 to 92.20) | 96.07 (95.45 to 96.55) |
| 3 passes: 2 tokenizer | 2 of 2 | 1.6 (0.1 to 4.6) | 0.0 (0.0 to 0.0) | 18.8 (16.0 to 20.0) | -0.19 (-0.49 to +0.01) | -0.41 (-1.81 to +0.44) | -0.02 (-0.04 to -0.00) | -0.06 (-0.11 to 0.00) | -0.01, -0.03, -0.00, +0.01, -0.04 | 96.93 (96.91 to 96.95) | 91.57 (90.34 to 92.43) | 96.45 (96.27 to 96.54) |
| 3 passes: 4 tokenizer | 3 to 4 of 4 | 6.0 (0.2 to 10.4) | 0.0 (0.0 to 0.0) | 14.8 (10.8 to 19.8) | -0.62 (-1.15 to -0.03) | -2.15 (-4.57 to -0.04) | -0.02 (-0.04 to -0.01) | -0.27 (-0.41 to 0.00) | -0.04, -0.03, -0.01, -0.02, -0.02 | 97.07 (96.91 to 97.18) | 92.66 (92.15 to 93.07) | 96.87 (95.95 to 97.62) |
| 3 passes: 8 tokenizer | 7 to 8 of 8 | 4.9 (0.7 to 8.2) | 0.0 (0.0 to 0.0) | 15.6 (12.5 to 19.7) | -0.60 (-0.79 to -0.15) | -1.54 (-2.61 to -0.09) | -0.06 (-0.10 to -0.01) | -0.48 (-0.59 to -0.26) | -0.01, -0.10, -0.06, -0.05, -0.07 | 97.00 (96.69 to 97.13) | 92.08 (91.26 to 92.72) | 96.30 (95.61 to 97.04) |
| 3 passes: 2 grammar | 2 of 2 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 20.4 (20.1 to 20.8) | -0.65 (-0.94 to -0.02) | -0.13 (-0.22 to -0.09) | +0.00 (-0.02 to +0.02) | 0.00 (0.00 to 0.00) | +0.02, -0.00, -0.00, -0.02, 0.00 | 97.00 (96.91 to 97.09) | 91.84 (90.31 to 92.43) | 96.48 (96.30 to 96.63) |

- **Spare tokenizer states are read in place of today's states.** After a first error the control is in a tokenizer state of today's other than `string` and `between` at 20.2% of the code points: e.g. its first seed is in `exponentDigits` at 4.9% of them and in `integer` at 4.6%, where today's tables are in `errorLine` at 32.5%. With spare tokenizer states that share falls to 11.9% to 17.8%, and the two shares together stay at 20% to 21%.
- **The trained tables need a state for the job, and a state of today's can be that state.** Today's tables have the room: `errorLine` has no frozen cell, and each of the ten states of a literal has one. Folded, the spare tokenizer states also cost 0.1 to 0.9 points of whole samples, against 0.6 to 3.9 when they are sent away. With 3 passes they cost 0.02 to 0.06 points of all three folded and 0.2 to 0.6 sent.
- **The folded tables keep the gain** in the kind `unquotedKey`, in all four settings with 4 spare tokenizer states or more, and in the group "needs a character class" in two of them. With 3 passes no folded range is apart from the control's.
- **Spare grammar states** cost 0.1 to 0.3 points either way with the plain pass. Folding them can break whole samples, by 12.3 points in one seed with 4 of them: a grammar state of today's has a job of its own in the same tables, which the folding overwrites.
- **Both ways are tries, not proofs.** A loss of nothing shows that today's states can hold the job. A loss shows that these two ways do not move the job, not that no tables of today's layout hold it.

### Spare states beside rules that a person wrote

In bold: every seed is on one side of the person's tables.

| tables | all | within reach | needs a line rule | needs a character class | needs a nesting fix | out of reach | unquotedKey | newlineDelimited | whole samples | whole samples, needs a line rule |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hand-written, the control | 96.52 | 99.51 | 98.98 | 92.24 | 76.07 | 78.04 | 98.05 | 91.98 | 80.44 | 97.95 |
| hand-written + 2 tokenizer, plain pass | 96.62 (96.50 to 96.68) | 99.53 (99.44 to 99.60) | 98.94 (98.90 to 98.98) | **93.04 (92.83 to 93.46)** | 76.07 (76.06 to 76.07) | 78.11 (77.79 to 78.32) | **98.15 (98.10 to 98.23)** | 91.91 (91.78 to 91.98) | **79.89 (78.44 to 80.29)** | 96.93 (96.31 to 97.95) |
| hand-written + 4 tokenizer, plain pass | **96.69 (96.65 to 96.73)** | **99.56 (99.52 to 99.61)** | 99.05 (98.91 to 99.42) | **93.06 (92.58 to 93.47)** | 76.07 (76.06 to 76.07) | 78.51 (78.02 to 78.80) | 98.11 (97.89 to 98.21) | 92.41 (91.87 to 93.95) | **79.85 (78.87 to 80.13)** | **96.27 (96.11 to 96.52)** |
| hand-written + 2 grammar, plain pass | **96.76 (96.55 to 96.84)** | **99.36 (99.19 to 99.44)** | 99.71 (98.82 to 99.94) | 91.12 (89.20 to 93.07) | **84.43 (83.55 to 85.08)** | **81.38 (81.05 to 81.73)** | 97.95 (97.56 to 98.06) | **96.94 (96.80 to 96.97)** | **79.48 (76.22 to 80.35)** | 94.75 (81.97 to 97.95) |
| hand-written + 2 tokenizer and 2 grammar, plain pass | **97.05 (96.91 to 97.17)** | 99.49 (99.27 to 99.59) | 99.53 (98.87 to 99.94) | 93.10 (92.02 to 93.64) | **83.57 (81.24 to 87.68)** | **81.52 (81.26 to 81.83)** | 98.08 (97.84 to 98.23) | 95.98 (91.98 to 97.50) | **78.70 (74.48 to 80.24)** | 94.22 (81.15 to 97.95) |
| hand-written + 4 tokenizer and 2 grammar, plain pass | **96.93 (96.81 to 97.01)** | 99.46 (99.24 to 99.55) | 99.51 (97.89 to 99.93) | 92.46 (91.86 to 93.45) | **82.31 (80.01 to 84.20)** | **81.36 (81.13 to 81.79)** | 97.75 (97.06 to 98.22) | 95.98 (91.98 to 96.97) | **78.02 (76.26 to 80.42)** | **94.39 (81.97 to 97.75)** |
| hand-written + 2 tokenizer and 2 grammar, 3 passes | **97.12 (96.99 to 97.22)** | 99.48 (99.37 to 99.58) | **99.91 (99.88 to 99.95)** | 92.33 (91.54 to 93.27) | **85.68 (79.66 to 89.40)** | **82.65 (81.49 to 83.25)** | 97.87 (97.35 to 98.26) | **96.94 (96.16 to 97.59)** | **78.51 (76.83 to 80.22)** | 96.76 (94.06 to 97.95) |
| hand-written + 4 tokenizer and 2 grammar, 3 passes | **97.16 (97.05 to 97.33)** | 99.51 (99.35 to 99.60) | **99.94 (99.92 to 99.95)** | 92.95 (91.89 to 93.78) | **85.23 (80.94 to 88.33)** | **82.21 (81.43 to 83.34)** | 98.11 (97.95 to 98.22) | **96.78 (96.15 to 96.97)** | **79.23 (77.44 to 80.31)** | 97.25 (96.31 to 97.95) |
| `words`, the control | 93.09 | 98.32 | 97.84 | 85.72 | 42.70 | 62.44 | 92.65 | 85.75 | 77.31 | 96.72 |
| `lines`: `words` with a state that a person added | 93.23 | 98.27 | 99.62 | 85.72 | 42.70 | 62.44 | 92.43 | 93.44 | 77.48 | 98.36 |
| `words` + 1 tokenizer, plain pass | **93.68 (93.64 to 93.71)** | **98.95 (98.85 to 99.01)** | **99.14 (98.82 to 99.45)** | 86.12 (85.60 to 86.64) | 42.69 (42.67 to 42.75) | **62.11 (61.96 to 62.35)** | **93.20 (92.73 to 93.41)** | **93.55 (93.24 to 94.49)** | **70.58 (67.41 to 75.59)** | **40.74 (11.68 to 84.43)** |
| `words` + 2 tokenizer, plain pass | **94.22 (94.02 to 94.39)** | **99.13 (99.01 to 99.21)** | **99.23 (98.96 to 99.58)** | **88.13 (87.46 to 88.80)** | 42.74 (42.64 to 42.77) | **64.36 (63.82 to 65.07)** | **94.52 (93.11 to 95.38)** | **93.55 (93.25 to 94.45)** | **73.06 (68.02 to 76.48)** | **61.64 (11.89 to 95.90)** |

What a run changes in the person's tables, as the lowest and the highest of the seeds, and where it starts. The hand-written rules set 915 cells, i.e. the hand-written tables hold another choice than today's there, and `words` sets 1,078.

| tables | cells of the person's states that lead into a spare state | of them, cells that the person's rules set | validation samples in which the text reads such a cell, of 5,021 | at the start: the person's next state in the mix of an open tokenizer cell, % | of an open grammar cell, % | cells in which the snapped start differs from the person's tables |
| --- | --- | --- | --- | --- | --- | --- |
| hand-written + 2 tokenizer, plain pass | 155 to 192 | 145 to 183 | 598 to 981 | 98.7 (98.6 to 98.7) | 100.0 (100.0 to 100.0) | 0 to 1 |
| hand-written + 4 tokenizer, plain pass | 155 to 190 | 147 to 181 | 740 to 1,047 | 97.5 (97.4 to 97.6) | 100.0 (100.0 to 100.0) | 0 to 1 |
| hand-written + 2 grammar, plain pass | 62 to 69 | 40 to 47 | 217 to 436 | 100.0 (100.0 to 100.0) | 96.1 (95.9 to 96.3) | 1 to 6 |
| hand-written + 2 tokenizer and 2 grammar, plain pass | 235 to 254 | 193 to 206 | 832 to 2,002 | 98.7 (98.6 to 98.7) | 96.3 (96.1 to 96.5) | 1 to 8 |
| hand-written + 4 tokenizer and 2 grammar, plain pass | 242 to 275 | 202 to 227 | 1,200 to 2,196 | 97.5 (97.4 to 97.6) | 96.2 (95.9 to 96.4) | 3 to 8 |
| hand-written + 2 tokenizer and 2 grammar, 3 passes | 441 to 498 | 285 to 311 | 1,467 to 2,717 | 30.7 (29.8 to 31.3) | 31.0 (30.2 to 32.0) | 1,209 to 1,254 |
| hand-written + 4 tokenizer and 2 grammar, 3 passes | 473 to 542 | 302 to 337 | 1,506 to 2,569 | 16.4 (15.6 to 17.0) | 31.1 (29.7 to 32.2) | 1,409 to 1,453 |
| `words` + 1 tokenizer, plain pass | 204 to 244 | 194 to 230 | 1,763 to 1,871 | 99.3 (99.3 to 99.3) | 100.0 (100.0 to 100.0) | 0 to 1 |
| `words` + 2 tokenizer, plain pass | 232 to 272 | 215 to 257 | 1,800 to 2,096 | 98.7 (98.6 to 98.7) | 100.0 (100.0 to 100.0) | 0 to 1 |

- **A run moves a part of the cells that the hand-written rules set**: 145 to 227 of the 915 with spare tokenizer states and the plain pass, 40 to 47 with 2 spare grammar states alone, and 285 to 337 with 3 passes. The text reads a moved cell in 217 to 2,717 of the 5,021 broken validation samples.
- **With 3 passes from a uniform start the run does not start from the person's tables.** Every other next state is shut out, so a uniform start gives the person's next state the share of one spare state, and the random part comes on top. With 4 and 2 spare states the person's next state starts with 16.4% of an open tokenizer cell's mix and 31.1% of an open grammar cell's, and the snapped start differs from the hand-written tables in 1,409 to 1,453 cells before any training.
- **The plain pass adds 0.1 to 0.5 points and 3 passes add 0.60 and 0.65.** The two settings of the trainer are not told apart with 2 and 2 spare states, 97.05 (96.91 to 97.17) against 97.12 (96.99 to 97.22), and are apart with 4 and 2, 96.93 (96.81 to 97.01) against 97.16 (97.05 to 97.33). The search from the hand-written tables, which may change every open cell and has no spare state, has 97.75.
- **The grammar states add where the rules are weakest**, in the groups "needs a nesting fix" and "out of reach". The tokenizer states add in the group "needs a character class", 92.2 to 93.0.
- **Whole samples fall in every setting beside the hand-written rules.** In the three settings with spare grammar states and the plain pass, seed 3 has 81% to 82% of the group "needs a line rule" whole, where the hand-written tables have 98.0%.
- **Some rows of all three fall in every seed**, by half a point or more. Beside the hand-written rules with 2 spare grammar states, e.g. the kinds `blockComment` by 3.2 points (59 samples), `missingColon` by 2.2 (29) and `lineComment` by 0.7 (476). Beside `words` with one spare tokenizer state, e.g. `textAfterEnd` by 15.4 (25), `nonBreakingSpace` by 5.7 (42), `foreignKeySeparator` by 3.9 (24) and `foreignLiteral` by 2.7 (232). `report.ts` lists them for every setting.
- **Beside `words`, the gain in the group "needs a line rule" comes with its samples broken.** Whole samples of that group, seed by seed: 11.7, 84.4, 11.9, 11.9 and 83.8 with one spare tokenizer state and 23.6, 11.9, 83.8, 93.0 and 95.9 with two, where `words` has 96.7 and `lines` 98.4. The wrong code point of seed 1 is the second white space after the line feed that ended the string: `wkwww` where the label wants `wwwww`, in the letters of `../../handwritten/show.ts`. With one spare tokenizer state, all three rises from 93.09 to 93.68 while 309 fewer of all samples are whole than with `words`, as the mean of the seeds, and 273 of them are in this group.

The same tables without their spare states. The last two columns are of tables with spare states of both tables: only the spare states of one table are taken away, and the others are kept.

| tables | spare states that a train sample reads | code points read in a spare tokenizer state, % | in a spare grammar state, % | sent: all three | whole samples | folded: all three | whole samples | the smaller of the two losses of all three, seed by seed | only the spare tokenizer states taken away: the smaller loss, seed by seed | only the spare grammar states taken away: the smaller loss, seed by seed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hand-written + 2 tokenizer, plain pass | 2 of 2 | 0.3 (0.2 to 0.5) | 0.0 (0.0 to 0.0) | +0.02 (-0.07 to +0.11) | +0.41 (-0.11 to +1.83) | -0.02 (-0.16 to +0.04) | -0.50 (-3.48 to +0.94) | +0.11, +0.01, +0.03, -0.07, +0.04 |  |  |
| hand-written + 4 tokenizer, plain pass | 4 of 4 | 0.4 (0.2 to 0.5) | 0.0 (0.0 to 0.0) | -0.04 (-0.10 to +0.04) | +0.46 (+0.02 to +1.48) | -0.01 (-0.05 to +0.05) | -0.23 (-0.54 to +0.04) | +0.05, -0.01, -0.01, +0.00, -0.04 |  |  |
| hand-written + 2 grammar, plain pass | 2 of 2 | 0.0 (0.0 to 0.0) | 0.1 (0.0 to 0.1) | -0.09 (-0.19 to +0.21) | +1.00 (+0.15 to +4.29) | -0.12 (-0.41 to +0.16) | -0.16 (-0.39 to +0.11) | +0.21, -0.12, -0.01, -0.17, -0.18 |  |  |
| hand-written + 2 tokenizer and 2 grammar, plain pass | 4 of 4 | 0.7 (0.2 to 1.6) | 0.1 (0.0 to 0.1) | -0.29 (-0.43 to -0.08) | +1.61 (+0.24 to +5.81) | -0.31 (-0.74 to -0.11) | -0.37 (-0.96 to +0.13) | -0.15, -0.23, -0.24, -0.08, -0.36 | -0.03, +0.01, -0.02, -0.00, -0.01 | -0.12, -0.27, -0.27, +0.01, -0.42 |
| hand-written + 4 tokenizer and 2 grammar, plain pass | 6 of 6 | 1.0 (0.3 to 1.5) | 0.1 (0.0 to 0.1) | -0.16 (-0.25 to -0.00) | +2.08 (-0.07 to +3.61) | -0.33 (-0.52 to -0.18) | -0.34 (-0.65 to +0.24) | -0.00, -0.14, -0.25, -0.18, -0.19 | +0.07, -0.02, -0.01, +0.07, -0.01 | -0.27, -0.11, -0.17, -0.25, -0.09 |
| hand-written + 2 tokenizer and 2 grammar, 3 passes | 4 of 4 | 1.0 (0.3 to 1.9) | 0.1 (0.1 to 0.2) | -0.40 (-0.48 to -0.28) | +1.12 (-0.09 to +2.33) | -0.67 (-0.84 to -0.44) | -2.93 (-10.07 to -0.22) | -0.28, -0.42, -0.48, -0.35, -0.46 | -0.02, +0.01, -0.00, -0.01, -0.05 | -0.27, -0.40, -0.44, -0.21, -0.49 |
| hand-written + 4 tokenizer and 2 grammar, 3 passes | 6 of 6 | 0.6 (0.4 to 0.7) | 0.1 (0.1 to 0.3) | -0.50 (-0.68 to -0.38) | +0.30 (-0.04 to +1.07) | -0.58 (-0.87 to -0.18) | -3.17 (-9.23 to +0.15) | -0.49, -0.38, -0.57, -0.18, -0.44 | -0.05, +0.01, -0.01, -0.01, +0.00 | -0.24, -0.35, -0.47, -0.17, -0.35 |
| `words` + 1 tokenizer, plain pass | 1 of 1 | 0.7 (0.7 to 0.8) | 0.0 (0.0 to 0.0) | +0.13 (+0.00 to +0.22) | +6.86 (+2.07 to +10.07) | -0.07 (-0.17 to -0.00) | -0.03 (-0.20 to +0.28) | +0.07, +0.22, +0.16, +0.00, +0.19 |  |  |
| `words` + 2 tokenizer, plain pass | 2 of 2 | 1.0 (0.8 to 1.4) | 0.0 (0.0 to 0.0) | -0.32 (-0.40 to -0.22) | +4.31 (+0.44 to +9.20) | -0.01 (-0.03 to -0.00) | -0.11 (-0.28 to +0.07) | -0.01, -0.02, -0.00, -0.03, -0.00 |  |  |

- **The spare tokenizer states hold nothing beside either person's rules.** Alone, they cost 0.01 to 0.07 points when they are folded. Beside `words` the gain in all three is a better choice of where open cells of today's states lead, which training reaches by way of a spare state: sent to its stand-in, the one spare state gives the whole samples back, e.g. from 67.80 to 77.68 with seed 1, and all three rises by 0.13 more.
- **The spare grammar states hold a part of the gain.** In the four settings with both kinds of spare state, taking only the spare tokenizer states away costs at most 0.05 points in any seed, by the smaller of the two losses. Taking only the spare grammar states away costs 0.09 to 0.49 points in 19 of the 20 seeds and nothing in one. With every spare state taken away, the smaller loss is 0.18 to 0.57 points in every seed with 3 passes, 0.08 to 0.36 with 2 and 2 spare states and the plain pass, and 0.00 to 0.25 with 4 and 2. With 2 spare grammar states alone, two of the five seeds lose 0.01 points or less.
- **This is no limit of today's layout**: the search of every open cell beside the same rules gets 1.2 points without any spare state, see below.

### A search of the same cells

The search of `../../search/` tries one cell at a time in the exact parser on the train split and keeps a choice that has more scored code points right. `search.ts` runs it over every open cell of the hand-written tables with 2 spare tokenizer states, the spare states' cells among them, and over the hand-written tables without spare states, each in three orders of the cells. With the most read cells first and no spare state it is the search of the number to beat, 97.75.

| order of the cells | with the spare states: all three | within reach | whole samples | spare states that a train sample reads | validation code points read in a spare state, % | the same tables with the spare states sent to their stand-ins: all three | folded: all three | searched without spare states: all three | within reach | whole samples |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| the most read cells first | 97.78 | 99.61 | 79.05 | 2 of 2 | 1.11 | 97.72 | 97.66 | 97.75 | 99.68 | 79.37 |
| a random order, seed 1 | 97.83 | 99.73 | 79.70 | 2 of 2 | 2.24 | 97.49 | 97.72 | 97.63 | 99.58 | 79.63 |
| a random order, seed 2 | 97.79 | 99.71 | 79.92 | 2 of 2 | 1.82 | 97.75 | 97.54 | 97.80 | 99.70 | 79.79 |
| the 3 orders | 97.80 (97.78 to 97.83) | 99.68 (99.61 to 99.73) | 79.55 (79.05 to 79.92) |  |  |  |  | 97.73 (97.63 to 97.80) | 99.65 (99.58 to 99.70) | 79.60 (79.37 to 79.79) |

- **The search does begin to use a spare state.** A step into a copy of `errorLine` changes nothing while `errorLine` is as it was. Once the search has changed cells of `errorLine`, the copy is a state of its own. In all three orders the train samples read both spare states.
- **The search and the training beside the hand-written rules are not on the same cells.** The training may only make an open cell lead into a spare state, and the search may give every open cell every choice, since `searchCells` of `../holes/restricted-search.ts` takes cells and not choices. So the table says what the open cells hold beside these rules, 1.2 points with or without spare states, and the training of spare states reaches 0.1 to 0.65 of them.
- **Not run**: the search of every open cell from today's tables with spare states. From today's tables three orders of the search without spare states end 6.9 points apart, see `../../README.md`, so three orders would not show a difference of the size that this arm sees.

### What the main number does not show

From the records. The last four columns are the depth of valid JSON of 17 to 19 levels, which no sample holds: the share of wrong depths from the 17th bracket on and how many seeds have a wrong depth at all, on texts with nothing after their nested containers and on texts with members after them.

| tables | cells changed against the base | added code points shown as an error, % | code points shown as past the end | wrong depths, nothing after, % | seeds with a wrong depth | wrong depths, members after, % | seeds with a wrong depth |
| --- | --- | --- | --- | --- | --- | --- | --- |
| plain pass: none, the control | 967 (935 to 984) | 0.9 (0.7 to 1.1) | 50 (0 to 160) | 3.0 (0.0 to 12.3) | 2 of 5 | 4.7 (0.0 to 16.4) | 2 of 5 |
| plain pass: 1 tokenizer | 998 (977 to 1,011) | 0.8 (0.6 to 1.0) | 97 (0 to 410) | 1.9 (0.0 to 6.8) | 2 of 5 | 4.9 (0.0 to 16.4) | 3 of 5 |
| plain pass: 2 tokenizer | 1,029 (1,020 to 1,037) | 0.6 (0.3 to 0.8) | 1,655 (12 to 7,824) | 2.0 (0.0 to 6.8) | 2 of 5 | 5.0 (0.0 to 17.5) | 3 of 5 |
| plain pass: 4 tokenizer | 1,082 (1,067 to 1,092) | 1.0 (0.6 to 1.8) | 269 (0 to 614) | 1.7 (0.0 to 3.0) | 3 of 5 | 4.2 (0.0 to 6.9) | 4 of 5 |
| plain pass: 8 tokenizer | 1,195 (1,176 to 1,208) | 0.8 (0.2 to 1.3) | 105 (43 to 225) | 4.1 (0.0 to 17.6) | 2 of 5 | 6.8 (0.0 to 26.8) | 3 of 5 |
| plain pass: 16 tokenizer | 1,416 (1,402 to 1,439) | 1.6 (0.2 to 5.3) | 551 (160 to 1,600) | 4.6 (0.0 to 17.1) | 2 of 5 | 6.0 (0.0 to 23.2) | 3 of 5 |
| plain pass: 1 grammar | 1,035 (1,019 to 1,045) | 0.7 (0.4 to 1.2) | 401 (0 to 1,208) | 6.8 (0.0 to 18.5) | 3 of 5 | 9.1 (0.4 to 20.8) | 5 of 5 |
| plain pass: 2 grammar | 1,108 (1,091 to 1,149) | 0.8 (0.4 to 1.2) | 294 (0 to 628) | 2.1 (0.0 to 8.3) | 3 of 5 | 2.0 (0.0 to 6.9) | 4 of 5 |
| plain pass: 4 grammar | 1,217 (1,192 to 1,242) | 1.3 (0.1 to 4.1) | 92 (0 to 231) | 3.4 (0.0 to 15.5) | 3 of 5 | 4.4 (0.0 to 18.5) | 4 of 5 |
| plain pass: 4 tokenizer and 2 grammar | 1,210 (1,194 to 1,220) | 0.7 (0.2 to 1.2) | 292 (134 to 527) | 4.2 (0.0 to 18.1) | 2 of 5 | 6.6 (0.0 to 24.7) | 2 of 5 |
| 3 passes: none, the control | 1,158 (1,156 to 1,160) | 0.0 (0.0 to 0.0) | 16 (0 to 79) | 47.9 (41.7 to 68.8) | 5 of 5 | 54.6 (48.0 to 78.3) | 5 of 5 |
| 3 passes: 2 tokenizer | 1,260 (1,253 to 1,263) | 0.0 (0.0 to 0.0) | 32 (0 to 94) | 45.5 (41.6 to 59.9) | 5 of 5 | 53.6 (47.7 to 72.4) | 5 of 5 |
| 3 passes: 4 tokenizer | 1,332 (1,329 to 1,334) | 0.0 (0.0 to 0.0) | 12 (0 to 61) | 41.9 (41.3 to 42.3) | 5 of 5 | 49.4 (47.9 to 50.9) | 5 of 5 |
| 3 passes: 8 tokenizer | 1,467 (1,462 to 1,471) | 0.0 (0.0 to 0.0) | 26 (0 to 111) | 44.9 (17.8 to 61.2) | 5 of 5 | 53.5 (24.4 to 72.0) | 5 of 5 |
| 3 passes: 2 grammar | 1,404 (1,396 to 1,409) | 0.0 (0.0 to 0.0) | 57 (0 to 121) | 58.0 (43.0 to 71.2) | 5 of 5 | 64.9 (48.5 to 79.4) | 5 of 5 |
| hand-written, the control | 915 | 0.0 | 0 | 0.0 | 0 of 1 | 0.0 | 0 of 1 |
| hand-written + 2 tokenizer, plain pass | 214 (203 to 242) | 0.0 (0.0 to 0.0) | 0 | 0.0 (0.0 to 0.0) | 0 of 5 | 0.0 (0.0 to 0.0) | 0 of 5 |
| hand-written + 4 tokenizer, plain pass | 267 (249 to 281) | 0.0 (0.0 to 0.0) | 0 | 0.0 (0.0 to 0.0) | 0 of 5 | 0.0 (0.0 to 0.0) | 0 of 5 |
| hand-written + 2 grammar, plain pass | 130 (127 to 134) | 0.0 (0.0 to 0.0) | 0 | 0.5 (0.0 to 2.5) | 1 of 5 | 3.9 (0.0 to 15.8) | 3 of 5 |
| hand-written + 2 tokenizer and 2 grammar, plain pass | 360 (347 to 374) | 0.0 (0.0 to 0.0) | 0 | 0.0 (0.0 to 0.0) | 0 of 5 | 0.2 (0.0 to 0.8) | 2 of 5 |
| hand-written + 4 tokenizer and 2 grammar, plain pass | 413 (390 to 432) | 0.0 (0.0 to 0.0) | 0 | 1.3 (0.0 to 6.4) | 1 of 5 | 2.1 (0.0 to 8.8) | 3 of 5 |
| hand-written + 2 tokenizer and 2 grammar, 3 passes | 701 (668 to 724) | 0.0 (0.0 to 0.0) | 0 | 8.7 (0.2 to 13.3) | 5 of 5 | 19.9 (4.7 to 29.6) | 5 of 5 |
| hand-written + 4 tokenizer and 2 grammar, 3 passes | 789 (755 to 832) | 0.0 (0.0 to 0.0) | 5 (0 to 12) | 8.4 (1.6 to 19.0) | 5 of 5 | 13.3 (7.6 to 18.3) | 5 of 5 |
| `words`, the control | 1,078 | 3.7 | 0 | 0.0 | 0 of 1 | 0.0 | 0 of 1 |
| `lines`: `words` with a state that a person added | 1,108 | 3.7 | 0 | 0.0 | 0 of 1 | 0.0 | 0 of 1 |
| `words` + 1 tokenizer, plain pass | 252 (227 to 271) | 3.9 (3.9 to 4.0) | 0 | 0.0 (0.0 to 0.0) | 0 of 5 | 0.0 (0.0 to 0.0) | 0 of 5 |
| `words` + 2 tokenizer, plain pass | 298 (279 to 320) | 3.9 (3.9 to 4.0) | 0 | 0.0 (0.0 to 0.0) | 0 of 5 | 0.0 (0.0 to 0.0) | 0 of 5 |
| search from the hand-written tables with 2 spare tokenizer states, the most read cells first | 504 | 0.0 | 0 | 1.1 | 1 of 1 | 0.3 | 1 of 1 |
| search from the hand-written tables with 2 spare tokenizer states, random orders | 453 (442 to 463) | 0.2 (0.1 to 0.2) | 0 | 23.0 (7.7 to 38.4) | 2 of 2 | 19.8 (11.8 to 27.9) | 2 of 2 |
| search from the hand-written tables, the most read cells first | 429 | 0.0 | 0 | 18.5 | 1 of 1 | 30.2 | 1 of 1 |
| search from the hand-written tables, random orders | 404 (400 to 408) | 0.1 (0.0 to 0.1) | 0 | 0.2 (0.0 to 0.4) | 1 of 2 | 1.3 (0.0 to 2.6) | 1 of 2 |

- **More code points are shown as past the end.** A trained tokenizer cell can snap to an event of a text's end, and a spare state brings 33 more cells that can. With the plain pass every setting with spare states has more such code points on average than the control's 50: 92 to 1,655, and 7,824 in one seed.
- **The depth of valid JSON that is too deep** is wrong at 1.7% to 6.8% of the code points in the first form with the plain pass, where the control has 3.0% (0.0 to 12.3). By seeds it is wrong more often: in 22 of the 45 seeds with spare states in the first form and in 31 of 45 in the second, where the control has 2 of 5 in both. With 3 passes every seed has it wrong, with or without spare states.
- **Beside the hand-written rules, spare grammar states break that depth**: in 2 or 3 of 5 seeds with the plain pass, on the texts with members after, and in every seed with 3 passes, at 8% to 20% of the code points. The hand-written rules leave the stack alone in the contexts of depth 16, and the cells of a spare grammar state are trained without that rule. With spare tokenizer states alone the depth stays right.
- The ground rules hold on the fixed texts for every run.

## What the states do

`account.ts` prints, for any saved tables and per spare state: how many validation code points are read in the state, the cells that lead into it, its own cells that a text reads, what the labels say that those code points are, three short train samples with the state marked, and the test: the state sent to its stand-in and folded into it, with the validation score again. The sentence is written by a person who reads that output. Each account is of the best seed of its setting by all three on the validation split, so it is picked on the split that it is scored on.

| tables | spare state | validation code points read in it | what it does | sent, all three | folded, all three |
| --- | --- | --- | --- | --- | --- |
| the hand rule `lines` | tokenizer 26 | 672 | entered at a line feed inside a string and left at the next code point, so that the next line starts a new member: the job that its author gave it | +0.02 | +0.13 |
| plain pass, 4 tokenizer, seed 2 | tokenizer 26 | 77,238 | the inside of a word without quotes: entered at the word's first letter, kept through its letters and digits, left at the colon, the comma or the space after it | -1.07 | -0.04 |
| | tokenizer 27 | 8,825 | a second state for the inside of a word: no job that I can name | -0.15 | +0.00 |
| | tokenizer 28 | 412 | the code point after a backslash inside a word: it is shown as the second half of an escape, and a quote there ends nothing | -0.04 | -0.03 |
| | tokenizer 29 | 2 | unused | 0.00 | 0.00 |
| plain pass, 2 grammar, seed 1 | grammar 8 | 56 | no job that I can name | +0.03 | -0.02 |
| | grammar 9 | 52 | entered at a `]` that comes inside an object: the next code point closes the array that the `]` was meant for | +0.02 | -0.02 |
| hand-written + 4 tokenizer and 2 grammar, plain pass, seed 5 | tokenizer 26 | 144 | no job that I can name | -0.00 | -0.00 |
| | tokenizer 27 | 1,391 | no job that I can name | -0.02 | -0.00 |
| | tokenizer 28 | 997 | the code point after a backslash outside a string | -0.08 | -0.00 |
| | tokenizer 29 | 296 | no job that I can name | +0.00 | +0.00 |
| | grammar 8 | 78 | entered at an opening brace where a colon should come, i.e. a new document starts inside an unfinished one: it shows the first string as a key and pops the stack once, so that the depth is the new document's | -0.09 | -0.28 |
| | grammar 9 | 126 | no job that I can name | +0.01 | -0.05 |
| `words` + 1 tokenizer, seed 1 | tokenizer 26 | 4,996 | several jobs in one state. One is the step out of a string at a line feed, by the cell and with the event of the state of `lines` | +0.07 | -0.02 |
| 3 passes, 4 tokenizer, seed 1 | tokenizer 28 | 47,706 | the inside of a word without quotes | -1.09 | 0.00 |
| | tokenizer 26 | 23,454 | a second state for the inside of a word: no job that I can name | -0.43 | 0.00 |
| | tokenizer 29 | 565 | the code point after a backslash inside a word | -0.07 | -0.00 |
| | tokenizer 27 | 62 | no job that I can name | +0.00 | 0.00 |
| hand-written + 4 tokenizer and 2 grammar, 3 passes, seed 3 | tokenizer 26 to 29 | 660 to 1,892 | no job that I can name | -0.01 to -0.32 | -0.01 to +0.01 |
| | grammar 8 | 218 | no job that I can name. Its most taken step is a closing brace after a trailing comma | -0.24 | -0.37 |
| | grammar 9 | 227 | no job that I can name | -0.20 | -0.20 |

- **Of the 24 states, 9 have a job that I can name**, one of them the state of `lines`. Two jobs come out with both settings of the trainer: the inside of a word without quotes, and the code point after a backslash inside a word. The two states that hold the most, the grammar states of the last account, have no sentence.
- **Even the state that a person added by hand folds into a state of today's.** The step out of the string at a line feed is worth 2.5 points in the group "needs a line rule", and sent to the state `t`, where the tokenizer is after the `t` of `true`, the group loses 0.01 points. The one thing that only the added state does, an opening brace that is read as a comma, is read 11 times on the validation split.
- **Why `keyOrClose` cannot hold the job of the grammar state 8 beside the hand-written rules**: after an opening brace the grammar is in `keyOrClose`, and valid JSON reads the cell of a string there, so that cell is frozen and cannot pop. Sent to `commaOrClose`, the kind `newlineDelimited` loses 5.0 points and the group "needs a nesting fix" 1.9.
- **The sentences are one reader's.** The script gives the counts, the cells and the samples, and the test only says what the tables lose without the state.

## What the arm does not show

- **Nothing here is a number on unseen data.** The size of the random part was chosen on the validation split, on other seeds, and the accounts are of seeds that were picked on the validation split. For the hand-written tables and for the dataset's hand rules no split of this dataset counts as unseen. The test split was not scored.
- **Not that a state can never matter.** A recovery that has to remember more than today's open cells hold would need a state, and no row of this dataset's score asks for one, as far as these runs show. An added character class is another kind of structure, and this arm adds none.
- **Not why training finds more with spare tokenizer states.** Whether the gain comes from the states' free cells, from the random part of their start, or from more cells to move through, is not measured: no run gave the control a random part at its start.
- **Not that the two ways of taking a state away find the least loss.** The stand-in is one state of today's, chosen on 8,000 train samples, the spare states are taken away one after the other, and nothing is trained after.
- **Not a tuned trainer**, and not every number of spare states with both settings: a seed of 3 passes takes three times as long as one of the plain pass.
- **Spare grammar states got two columns of the display table.** With open entries of the display table, see `../../structure/README.md`, a spare grammar state could show a token in a way of its own.

## Every run that was made

- **Tuning**, seeds 11, 12 and 13, in `<RECOVERY_SCRATCH>/arms/spare-states-tune/`: the seven rows of the table of the start.
- **Reported**, seeds 1 to 5, each once, in `<RECOVERY_SCRATCH>/arms/spare-states/`: the 13 settings of today's tables with their two controls, and the 9 settings beside a person's rules.
- **The search**, in `<RECOVERY_SCRATCH>/arms/spare-states-search/`: three orders with the spare states and three without.
- **Three try-outs with seed 1**, which are no reported runs. Before the tuning runs: the control and 2 spare tokenizer states with the plain pass, 96.69 and 96.26, which are the numbers of the reported seed 1 of those settings. And after the tuning runs, 22 minutes before the reported runs beside the hand-written rules: 2 spare tokenizer states and 2 spare grammar states beside those rules with the plain pass, 97.17. That setting was not in the first version of this README. A review asked for it, and its five seeds were then run, with the plain pass and, as a setting that no run had before, with 3 passes.

## Commands

Run from the repo root. A seed of the plain pass takes about 35 s with 4 worker threads and other jobs running, and a seed of 3 passes about 100 s. A search takes 2 to 4 minutes.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/handwritten/rules.ts                # the hand-written tables, for the runs beside them
bun lab/recovery-parser/learn/arms/spare-states/run.ts --states 0+0,1+0,2+0,4+0,8+0,16+0,0+1,0+2,0+4,4+2 --trainer plain
bun lab/recovery-parser/learn/arms/spare-states/run.ts --states 0+0,2+0,4+0,8+0,0+2 --trainer three-passes
bun lab/recovery-parser/learn/arms/spare-states/run.ts --states 2+0,4+0,0+2,2+2,4+2 --base hand-written --trainer plain
bun lab/recovery-parser/learn/arms/spare-states/run.ts --states 2+2,4+2 --base hand-written --trainer three-passes
bun lab/recovery-parser/learn/arms/spare-states/run.ts --states 1+0,2+0 --base words --trainer plain
bun lab/recovery-parser/learn/arms/spare-states/search.ts --states 2+0 --base hand-written    # the search in three orders, with and without the spare states
bun lab/recovery-parser/learn/arms/spare-states/report.ts          # every table of this README, from the saved runs
bun lab/recovery-parser/learn/arms/spare-states/account.ts --tables <file.json> [--base hand-written|words]   # what each spare state of saved tables does
bun lab/recovery-parser/learn/arms/spare-states/check.ts           # the arm's own checks, about 15 s
```

`--states` lists the runs, each as the spare tokenizer states and the spare grammar states, e.g. `4+2`. `--trainer` is `plain`, `three-passes`, or five values with commas: the passes, the start, the learning rate, the temperature at the end and the sharpness cost, e.g. `--trainer 10,uniform,0.02,0.5,0.01`. `report.ts` keeps what it counts per tables in a file `seed-<seed>.use.json` next to them, with a hash of the tables and of the two source files that make the counts, `use.ts` and `spare-states.ts`. Its first run, and the first one after a change of one of the two files, takes about 15 minutes with other jobs running, and a later one a second. `check.ts` is not among the checks that `../../check-all.ts` runs.

The tuning runs, as they were run:

```sh
bun lab/recovery-parser/learn/arms/spare-states/run.ts --arm spare-states-tune --seeds 11,12,13 --states 4+0 --trainer plain --noise 0     # and 0.3, 1, 2, 3
bun lab/recovery-parser/learn/arms/spare-states/run.ts --arm spare-states-tune --seeds 11,12,13 --states 1+0 --trainer plain --noise 0
bun lab/recovery-parser/learn/arms/spare-states/run.ts --arm spare-states-tune --seeds 11,12,13 --states 4+0 --trainer three-passes --noise 1
```

## Files

- `spare-states.ts`: the base of a run (`baseOf`), the start of the spare states (`createSpareModel`), the trainer's settings, how often the parser is in each state (`stateUseOf`), and tables without a spare state: sent (`withoutState`), folded (`foldedInto`), with the stand-in that costs least (`standInOf`), and all of them or the ones of one table (`withoutSpareStates`).
- `run.ts`: the runs of one trainer's setting on one base.
- `search.ts`: the search of `../../search/` over every open cell of tables with spare states, in three orders, with and without the spare states.
- `use.ts`: what `report.ts` counts per saved tables, and the file that keeps it.
- `report.ts`: the tables of this README, from the saved runs.
- `account.ts`: the account of the spare states of any saved tables.
- `check.ts`: without a spare state the model is the plain pass's, the start comes from the seed, a run beside a person's rules changes only what it may, and tables without a spare state have no step into it.
