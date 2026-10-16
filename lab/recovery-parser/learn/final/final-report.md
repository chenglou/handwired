# The final scores of the recovery experiment

Dataset a71c027d33a5cd7b, the exact parser. Scored at 2026-10-16T12:50:49.960Z from the list <RECOVERY_SCRATCH>/../notes/final/final.json. Every count is in <RECOVERY_SCRATCH>/final/final.counts.json.

A row is a baseline of arms/harness.ts or the tables that an entry of the list names. Where a row has several files of tables, a number is the mean over the files, with the lowest and the highest in brackets. All numbers are percentages.

| tables | files | what they are |
| --- | --- | --- |
| the parser as it is | none | a baseline of arms/harness.ts |
| the dataset's hand rule stay, as tables of the experiment | none | a baseline of arms/harness.ts |
| the dataset's hand rule resync, as tables of the experiment | none | a baseline of arms/harness.ts |
| the dataset's hand rule words, as tables of the experiment | none | a baseline of arms/harness.ts |
| the dataset's hand rule lines, as tables of the experiment | none | a baseline of arms/harness.ts |
| hand-written, the 35 rules of handwritten/rules.ts | none | a baseline of arms/harness.ts |
| search from the hand-written tables, the number to beat | 1 | search/search.ts from the 35 hand-written rules, one search in one order, no training |
| search from today's tables, no training | 1 | search/search.ts from today's tables, order 1, no hand rule and no training |
| plain pass | 5 | every open cell of today's tables trained, one pass, trainer defaults, seeds 1 to 5 |
| holes, every hand-written choice blanked, then trained | 5 | arms/holes/: the cells of the 35 hand-written rules blanked (100%) and trained, seeds 1 to 5 |
| holes, a tenth of the hand-written choices blanked, then trained | 5 | arms/holes/: 10% of the cells of the hand-written rules blanked and trained, seeds 1 to 5 |
| spare states, 4 tokenizer states | 5 | arms/spare-states/: today's tables with 4 spare tokenizer states, one pass, seeds 1 to 5 |
| spare states beside the hand-written rules | 5 | arms/spare-states/: the hand-written tables with 4 spare tokenizer and 2 spare grammar states, three passes from a uniform start, seeds 1 to 5 |
| generic of round 1, training then a search | 5 | arms/generic/: today's tables as they are, trained, then searched in order 1, seeds 1 to 5 |
| extra facts of round 1, classes chosen by hand | 5 | arms/extra-facts/: 15 classes chosen by hand, open display entries and the bit, three passes, seeds 1 to 5; confirmation seeds 11 to 15 |
| extra facts of round 1, classes chosen by hand, confirmation files | 5 | the same with tables that were made after the choice: arms/extra-facts/: 15 classes chosen by hand, open display entries and the bit, three passes, seeds 1 to 5; confirmation seeds 11 to 15 |
| extra facts of round 1, classes from the train samples | 5 | arms/extra-facts/: classes picked by a rule from the train samples, open display entries and the bit, one pass, seeds 1 to 5 |
| combined, generic, training alone | 5 | arms/combined/: the generic candidate before its search and count, seeds 1 to 5 |
| combined, generic | 5 | arms/combined/ candidate 1: nothing that a person knows about broken JSON; training, search, count, seeds 1 to 5; confirmation seeds 21 to 25 |
| combined, generic, confirmation files | 5 | the same with tables that were made after the choice: arms/combined/ candidate 1: nothing that a person knows about broken JSON; training, search, count, seeds 1 to 5; confirmation seeds 21 to 25 |
| combined, with the classes chosen by hand | 5 | arms/combined/ candidate 2: as the generic candidate with the 15 classes chosen by hand, seeds 1 to 5; confirmation seeds 21 to 25 |
| combined, with the classes chosen by hand, confirmation files | 5 | the same with tables that were made after the choice: arms/combined/ candidate 2: as the generic candidate with the 15 classes chosen by hand, seeds 1 to 5; confirmation seeds 21 to 25 |
| combined, from the hand-written tables | 5 | arms/combined/ candidate 3: as candidate 2 started from the 35 hand-written rules, seeds 1 to 5; confirmation seeds 21 to 25 |
| combined, from the hand-written tables, confirmation files | 5 | the same with tables that were made after the choice: arms/combined/ candidate 3: as candidate 2 started from the 35 hand-written rules, seeds 1 to 5; confirmation seeds 21 to 25 |
| no gradient, search and count in turns | 3 | arms/combined/ control: the generic candidate's additions without any training, the search and the count in turns, tuning seeds 11 to 13 |
| combined, generic, added characters as an error, training alone | 5 | arms/combined/: the generic training with the target that shows added code points as an error at the weight 0.1, seeds 1 to 5 |
| combined, generic, added characters as an error, then searched | 5 | arms/combined/: the row above, then the search of 4 passes, seeds 1 to 5 |

## The validation split

The validation split of the standard set (seed 20261015, indexes 0 to 59999): 5021 broken samples, 425 of them with nothing to recover, 675949 scored code points. "All three" is the share of the scored code points with the display kind, the depth and the container right. "Within reach of the tables" is the group of samples that tables of today's layout can label. "Whole samples" is the share of the samples with something to recover in which every scored code point is right.

| tables | all three | all three, within reach of the tables | whole samples |
| --- | --- | --- | --- |
| the parser as it is | 42.69 | 47.44 | 11.92 |
| the dataset's hand rule stay, as tables of the experiment | 73.81 | 79.00 | 28.74 |
| the dataset's hand rule resync, as tables of the experiment | 84.35 | 92.78 | 71.39 |
| the dataset's hand rule words, as tables of the experiment | 93.09 | 98.32 | 77.31 |
| the dataset's hand rule lines, as tables of the experiment | 93.23 | 98.27 | 77.48 |
| hand-written, the 35 rules of handwritten/rules.ts | 96.52 | 99.51 | 80.44 |
| search from the hand-written tables, the number to beat | 97.75 | 99.68 | 79.37 |
| search from today's tables, no training | 96.30 | 98.32 | 56.64 |
| plain pass | 96.50 (95.88 to 96.74) | 99.11 (98.87 to 99.31) | 73.22 (72.76 to 73.54) |
| holes, every hand-written choice blanked, then trained | 96.96 (96.87 to 97.06) | 99.24 (99.09 to 99.44) | 74.94 (73.35 to 75.81) |
| holes, a tenth of the hand-written choices blanked, then trained | 96.52 (96.37 to 96.60) | 99.48 (99.32 to 99.59) | 79.85 (78.05 to 80.42) |
| spare states, 4 tokenizer states | 96.83 (96.29 to 97.19) | 99.19 (99.11 to 99.26) | 74.20 (72.37 to 77.05) |
| spare states beside the hand-written rules | 97.16 (97.05 to 97.33) | 99.51 (99.35 to 99.60) | 79.23 (77.44 to 80.31) |
| generic of round 1, training then a search | 97.29 (97.12 to 97.47) | 99.41 (99.29 to 99.48) | 73.76 (72.04 to 74.78) |
| extra facts of round 1, classes chosen by hand | 98.03 (97.82 to 98.13) | 99.58 (99.27 to 99.68) | 83.60 (82.35 to 85.70) |
| extra facts of round 1, classes chosen by hand, confirmation files | 98.08 (97.78 to 98.24) | 99.61 (99.39 to 99.75) | 81.51 (79.48 to 82.38) |
| extra facts of round 1, classes from the train samples | 97.72 (97.48 to 97.88) | 99.48 (99.22 to 99.65) | 81.14 (79.44 to 82.27) |
| combined, generic, training alone | 97.98 (97.84 to 98.12) | 99.58 (99.45 to 99.62) | 80.23 (76.78 to 82.35) |
| combined, generic | 98.30 (98.27 to 98.37) | 99.67 (99.61 to 99.74) | 83.61 (82.79 to 84.29) |
| combined, generic, confirmation files | 98.27 (98.19 to 98.48) | 99.70 (99.58 to 99.81) | 84.81 (84.31 to 85.53) |
| combined, with the classes chosen by hand | 98.33 (98.18 to 98.43) | 99.68 (99.58 to 99.78) | 85.47 (84.77 to 86.40) |
| combined, with the classes chosen by hand, confirmation files | 98.33 (98.27 to 98.37) | 99.66 (99.59 to 99.72) | 86.37 (85.75 to 87.05) |
| combined, from the hand-written tables | 98.25 (98.18 to 98.36) | 99.66 (99.56 to 99.76) | 85.83 (85.03 to 86.60) |
| combined, from the hand-written tables, confirmation files | 98.28 (98.22 to 98.37) | 99.69 (99.60 to 99.73) | 85.03 (84.12 to 85.88) |
| no gradient, search and count in turns | 97.95 (97.83 to 98.12) | 99.57 (99.45 to 99.66) | 80.53 (76.85 to 82.68) |
| combined, generic, added characters as an error, training alone | 97.86 (97.62 to 97.99) | 99.42 (99.11 to 99.56) | 78.73 (77.39 to 80.31) |
| combined, generic, added characters as an error, then searched | 98.34 (98.26 to 98.46) | 99.65 (99.56 to 99.75) | 83.74 (82.85 to 84.83) |

## The test split

The test split of the standard set holds four kinds of damage and one template that training never sees. One table per way a sample can be held out, and one for the whole split, which is there to add up the four and not to report alone.

### Held out: nothing

5840 broken samples, 534 of them with nothing to recover, 727989 scored code points.

| tables | all three | all three, within reach of the tables | whole samples |
| --- | --- | --- | --- |
| the parser as it is | 41.78 | 48.13 | 12.83 |
| the dataset's hand rule stay, as tables of the experiment | 73.35 | 80.71 | 30.14 |
| the dataset's hand rule resync, as tables of the experiment | 82.70 | 93.03 | 70.83 |
| the dataset's hand rule words, as tables of the experiment | 92.21 | 98.03 | 76.54 |
| the dataset's hand rule lines, as tables of the experiment | 92.40 | 98.03 | 76.71 |
| hand-written, the 35 rules of handwritten/rules.ts | 96.55 | 99.58 | 79.59 |
| search from the hand-written tables, the number to beat | 97.80 | 99.77 | 78.02 |
| search from today's tables, no training | 96.10 | 98.32 | 56.20 |
| plain pass | 96.32 (95.81 to 96.61) | 99.07 (98.71 to 99.21) | 72.63 (72.16 to 73.16) |
| holes, every hand-written choice blanked, then trained | 96.72 (96.55 to 96.95) | 99.14 (98.96 to 99.40) | 74.12 (72.77 to 75.76) |
| holes, a tenth of the hand-written choices blanked, then trained | 96.55 (96.51 to 96.58) | 99.55 (99.48 to 99.62) | 79.19 (78.18 to 79.51) |
| spare states, 4 tokenizer states | 96.71 (96.54 to 96.81) | 99.17 (98.95 to 99.38) | 73.76 (72.31 to 76.05) |
| spare states beside the hand-written rules | 97.17 (97.09 to 97.37) | 99.58 (99.54 to 99.62) | 78.34 (77.03 to 79.06) |
| generic of round 1, training then a search | 97.45 (97.27 to 97.60) | 99.43 (99.29 to 99.53) | 73.86 (71.71 to 75.07) |
| extra facts of round 1, classes chosen by hand | 98.13 (98.03 to 98.21) | 99.56 (99.33 to 99.64) | 82.66 (81.10 to 85.15) |
| extra facts of round 1, classes chosen by hand, confirmation files | 98.11 (97.90 to 98.28) | 99.56 (99.41 to 99.67) | 80.68 (78.95 to 81.64) |
| extra facts of round 1, classes from the train samples | 97.79 (97.57 to 97.92) | 99.44 (99.20 to 99.57) | 80.39 (78.91 to 81.85) |
| combined, generic, training alone | 98.11 (98.03 to 98.15) | 99.59 (99.47 to 99.67) | 79.82 (76.91 to 81.74) |
| combined, generic | 98.44 (98.35 to 98.53) | 99.69 (99.60 to 99.77) | 83.20 (82.15 to 83.77) |
| combined, generic, confirmation files | 98.45 (98.32 to 98.66) | 99.69 (99.57 to 99.81) | 84.32 (83.42 to 85.68) |
| combined, with the classes chosen by hand | 98.59 (98.53 to 98.63) | 99.72 (99.68 to 99.77) | 85.36 (84.89 to 85.94) |
| combined, with the classes chosen by hand, confirmation files | 98.59 (98.52 to 98.69) | 99.73 (99.70 to 99.77) | 85.80 (85.38 to 86.52) |
| combined, from the hand-written tables | 98.49 (98.44 to 98.53) | 99.79 (99.76 to 99.86) | 85.85 (84.85 to 87.00) |
| combined, from the hand-written tables, confirmation files | 98.52 (98.31 to 98.63) | 99.75 (99.52 to 99.85) | 85.07 (84.13 to 86.11) |
| no gradient, search and count in turns | 98.06 (97.86 to 98.26) | 99.55 (99.40 to 99.64) | 79.53 (75.63 to 81.94) |
| combined, generic, added characters as an error, training alone | 98.08 (98.02 to 98.16) | 99.51 (99.41 to 99.60) | 78.59 (76.76 to 80.29) |
| combined, generic, added characters as an error, then searched | 98.56 (98.44 to 98.74) | 99.73 (99.62 to 99.81) | 83.23 (82.49 to 84.49) |

### Held out: a kind, on a template that training has

2030 broken samples, 1 of them with nothing to recover, 348871 scored code points.

| tables | all three | all three, within reach of the tables | whole samples |
| --- | --- | --- | --- |
| the parser as it is | 27.99 | 35.48 | 1.97 |
| the dataset's hand rule stay, as tables of the experiment | 65.83 | 78.50 | 34.55 |
| the dataset's hand rule resync, as tables of the experiment | 77.67 | 93.37 | 72.84 |
| the dataset's hand rule words, as tables of the experiment | 93.34 | 99.73 | 79.84 |
| the dataset's hand rule lines, as tables of the experiment | 93.34 | 99.73 | 79.84 |
| hand-written, the 35 rules of handwritten/rules.ts | 98.90 | 99.93 | 87.24 |
| search from the hand-written tables, the number to beat | 97.09 | 98.39 | 78.66 |
| search from today's tables, no training | 92.67 | 97.49 | 66.93 |
| plain pass | 96.21 (93.72 to 97.02) | 99.29 (99.12 to 99.46) | 66.83 (61.06 to 68.41) |
| holes, every hand-written choice blanked, then trained | 97.54 (93.82 to 98.55) | 99.72 (99.48 to 99.82) | 73.02 (63.23 to 77.67) |
| holes, a tenth of the hand-written choices blanked, then trained | 98.87 (98.76 to 98.92) | 99.91 (99.86 to 99.93) | 86.24 (82.80 to 87.28) |
| spare states, 4 tokenizer states | 97.03 (95.18 to 98.59) | 99.52 (99.29 to 99.80) | 71.80 (67.72 to 77.18) |
| spare states beside the hand-written rules | 98.37 (97.39 to 99.03) | 99.08 (97.69 to 99.87) | 82.55 (73.88 to 86.30) |
| generic of round 1, training then a search | 86.59 (81.87 to 93.56) | 91.86 (86.96 to 98.65) | 64.40 (62.05 to 69.89) |
| extra facts of round 1, classes chosen by hand | 94.37 (90.96 to 96.97) | 97.49 (92.06 to 99.51) | 75.40 (71.27 to 80.78) |
| extra facts of round 1, classes chosen by hand, confirmation files | 94.72 (91.09 to 96.45) | 98.60 (96.44 to 99.88) | 75.40 (69.44 to 80.73) |
| extra facts of round 1, classes from the train samples | 96.29 (95.27 to 98.58) | 99.45 (99.11 to 99.65) | 77.43 (74.57 to 80.29) |
| combined, generic, training alone | 97.13 (94.78 to 98.72) | 99.44 (99.20 to 99.69) | 68.93 (62.00 to 75.80) |
| combined, generic | 94.47 (92.65 to 96.27) | 98.20 (97.87 to 98.38) | 70.22 (67.27 to 73.24) |
| combined, generic, confirmation files | 92.01 (84.77 to 99.04) | 95.18 (89.06 to 99.86) | 74.08 (59.49 to 84.13) |
| combined, with the classes chosen by hand | 93.22 (83.85 to 97.27) | 96.19 (88.60 to 99.29) | 68.01 (60.72 to 78.46) |
| combined, with the classes chosen by hand, confirmation files | 94.80 (92.98 to 95.86) | 97.76 (96.83 to 98.60) | 73.17 (67.52 to 79.60) |
| combined, from the hand-written tables | 96.44 (90.26 to 99.20) | 96.63 (88.56 to 99.94) | 77.97 (70.08 to 88.22) |
| combined, from the hand-written tables, confirmation files | 93.58 (87.81 to 96.32) | 96.04 (90.81 to 98.77) | 76.16 (65.40 to 82.06) |
| no gradient, search and count in turns | 77.51 (70.27 to 87.72) | 82.91 (74.45 to 91.51) | 61.94 (56.14 to 68.80) |
| combined, generic, added characters as an error, training alone | 96.70 (93.94 to 99.00) | 99.37 (98.72 to 99.74) | 72.09 (62.79 to 78.36) |
| combined, generic, added characters as an error, then searched | 96.22 (91.72 to 98.90) | 98.43 (94.66 to 99.88) | 79.59 (72.15 to 85.02) |

### Held out: the template, with kinds that training has

3408 broken samples, 224 of them with nothing to recover, 555388 scored code points.

| tables | all three | all three, within reach of the tables | whole samples |
| --- | --- | --- | --- |
| the parser as it is | 41.83 | 53.20 | 4.27 |
| the dataset's hand rule stay, as tables of the experiment | 72.60 | 83.42 | 22.80 |
| the dataset's hand rule resync, as tables of the experiment | 81.59 | 96.53 | 66.83 |
| the dataset's hand rule words, as tables of the experiment | 90.51 | 97.99 | 70.45 |
| the dataset's hand rule lines, as tables of the experiment | 90.51 | 97.99 | 70.45 |
| hand-written, the 35 rules of handwritten/rules.ts | 96.57 | 99.68 | 73.40 |
| search from the hand-written tables, the number to beat | 97.88 | 99.79 | 70.35 |
| search from today's tables, no training | 96.29 | 98.88 | 55.34 |
| plain pass | 96.13 (95.68 to 96.85) | 99.58 (99.35 to 99.72) | 69.41 (68.37 to 70.92) |
| holes, every hand-written choice blanked, then trained | 96.89 (96.02 to 97.55) | 99.51 (99.34 to 99.75) | 70.99 (70.04 to 73.74) |
| holes, a tenth of the hand-written choices blanked, then trained | 96.63 (96.55 to 96.71) | 99.71 (99.67 to 99.79) | 73.80 (73.12 to 75.57) |
| spare states, 4 tokenizer states | 96.46 (95.75 to 97.27) | 99.66 (99.43 to 99.75) | 70.48 (67.78 to 73.78) |
| spare states beside the hand-written rules | 97.18 (97.11 to 97.34) | 99.64 (99.57 to 99.74) | 72.41 (71.29 to 73.24) |
| generic of round 1, training then a search | 97.07 (96.39 to 97.65) | 99.59 (99.44 to 99.71) | 69.53 (66.30 to 72.14) |
| extra facts of round 1, classes chosen by hand | 97.79 (97.48 to 97.96) | 99.82 (99.69 to 99.87) | 76.99 (74.78 to 79.71) |
| extra facts of round 1, classes chosen by hand, confirmation files | 98.11 (97.84 to 98.61) | 99.78 (99.73 to 99.85) | 75.57 (72.36 to 78.49) |
| extra facts of round 1, classes from the train samples | 97.53 (96.64 to 98.25) | 99.74 (99.70 to 99.82) | 72.17 (70.92 to 72.86) |
| combined, generic, training alone | 97.89 (97.50 to 98.58) | 99.75 (99.71 to 99.79) | 75.03 (72.33 to 76.82) |
| combined, generic | 98.17 (97.92 to 98.86) | 99.83 (99.80 to 99.85) | 77.27 (75.03 to 80.40) |
| combined, generic, confirmation files | 97.31 (94.69 to 98.92) | 99.72 (99.48 to 99.81) | 74.27 (69.69 to 76.54) |
| combined, with the classes chosen by hand | 97.95 (97.54 to 98.21) | 99.82 (99.78 to 99.85) | 77.51 (75.09 to 82.16) |
| combined, with the classes chosen by hand, confirmation files | 97.87 (97.36 to 98.63) | 99.74 (99.61 to 99.87) | 77.85 (74.43 to 79.93) |
| combined, from the hand-written tables | 98.68 (98.19 to 98.91) | 99.82 (99.74 to 99.89) | 80.86 (76.29 to 83.39) |
| combined, from the hand-written tables, confirmation files | 98.73 (98.35 to 99.00) | 99.84 (99.79 to 99.89) | 80.53 (78.52 to 81.50) |
| no gradient, search and count in turns | 98.18 (97.85 to 98.40) | 99.69 (99.60 to 99.77) | 73.50 (72.17 to 75.31) |
| combined, generic, added characters as an error, training alone | 97.73 (97.30 to 98.00) | 99.65 (99.40 to 99.80) | 73.42 (71.36 to 76.19) |
| combined, generic, added characters as an error, then searched | 97.73 (97.05 to 98.09) | 99.78 (99.60 to 99.83) | 76.09 (72.55 to 77.92) |

### Held out: a kind and the template

260 broken samples, 0 of them with nothing to recover, 48377 scored code points.

| tables | all three | all three, within reach of the tables | whole samples |
| --- | --- | --- | --- |
| the parser as it is | 23.47 | 28.78 | 1.15 |
| the dataset's hand rule stay, as tables of the experiment | 69.39 | 80.90 | 39.62 |
| the dataset's hand rule resync, as tables of the experiment | 85.46 | 99.97 | 83.08 |
| the dataset's hand rule words, as tables of the experiment | 95.67 | 100.00 | 83.46 |
| the dataset's hand rule lines, as tables of the experiment | 95.67 | 100.00 | 83.46 |
| hand-written, the 35 rules of handwritten/rules.ts | 99.42 | 99.99 | 88.46 |
| search from the hand-written tables, the number to beat | 97.79 | 99.75 | 78.46 |
| search from today's tables, no training | 95.86 | 99.70 | 67.31 |
| plain pass | 96.19 (96.09 to 96.29) | 99.10 (98.81 to 99.40) | 73.85 (71.92 to 76.54) |
| holes, every hand-written choice blanked, then trained | 97.96 (96.51 to 99.30) | 99.47 (99.17 to 99.91) | 77.00 (69.23 to 82.31) |
| holes, a tenth of the hand-written choices blanked, then trained | 99.44 (99.42 to 99.46) | 99.99 (99.99 to 99.99) | 88.54 (88.08 to 88.85) |
| spare states, 4 tokenizer states | 97.58 (96.28 to 98.69) | 99.43 (99.01 to 99.95) | 75.77 (73.08 to 78.08) |
| spare states beside the hand-written rules | 98.06 (92.52 to 99.52) | 98.20 (91.19 to 99.99) | 82.92 (71.54 to 88.85) |
| generic of round 1, training then a search | 89.22 (79.02 to 97.07) | 91.81 (79.76 to 99.90) | 70.54 (64.62 to 79.62) |
| extra facts of round 1, classes chosen by hand | 93.81 (81.66 to 97.64) | 95.58 (79.76 to 99.85) | 68.85 (62.31 to 79.23) |
| extra facts of round 1, classes chosen by hand, confirmation files | 96.63 (91.96 to 98.88) | 98.09 (93.84 to 99.99) | 73.92 (68.08 to 83.85) |
| extra facts of round 1, classes from the train samples | 97.25 (95.37 to 98.76) | 99.58 (99.08 to 100.00) | 80.31 (77.31 to 84.23) |
| combined, generic, training alone | 97.47 (96.49 to 98.89) | 99.56 (98.89 to 99.93) | 71.92 (61.15 to 83.08) |
| combined, generic | 97.46 (96.47 to 98.43) | 99.69 (99.50 to 99.90) | 75.38 (68.85 to 80.38) |
| combined, generic, confirmation files | 90.98 (75.83 to 99.21) | 94.85 (87.72 to 99.83) | 72.85 (61.15 to 81.54) |
| combined, with the classes chosen by hand | 93.00 (82.61 to 97.33) | 95.86 (83.16 to 99.99) | 72.46 (64.23 to 83.08) |
| combined, with the classes chosen by hand, confirmation files | 95.56 (92.83 to 98.09) | 98.62 (96.94 to 99.76) | 69.85 (62.31 to 79.62) |
| combined, from the hand-written tables | 97.13 (92.25 to 99.42) | 97.66 (91.37 to 99.98) | 79.62 (70.38 to 88.85) |
| combined, from the hand-written tables, confirmation files | 96.27 (91.10 to 98.53) | 97.29 (92.74 to 99.52) | 78.92 (74.23 to 81.92) |
| no gradient, search and count in turns | 77.75 (63.10 to 93.57) | 79.29 (62.96 to 96.88) | 55.26 (44.62 to 66.15) |
| combined, generic, added characters as an error, training alone | 97.34 (97.16 to 97.53) | 99.66 (99.53 to 99.89) | 74.00 (61.54 to 79.23) |
| combined, generic, added characters as an error, then searched | 95.16 (88.10 to 97.77) | 97.93 (90.10 to 99.95) | 76.62 (61.92 to 84.23) |

### The whole split

11538 broken samples, 759 of them with nothing to recover, 1680625 scored code points.

| tables | all three | all three, within reach of the tables | whole samples |
| --- | --- | --- | --- |
| the parser as it is | 38.41 | 45.98 | 7.98 |
| the dataset's hand rule stay, as tables of the experiment | 71.43 | 80.99 | 29.03 |
| the dataset's hand rule resync, as tables of the experiment | 81.37 | 94.37 | 70.32 |
| the dataset's hand rule words, as tables of the experiment | 91.98 | 98.49 | 75.53 |
| the dataset's hand rule lines, as tables of the experiment | 92.06 | 98.49 | 75.61 |
| hand-written, the 35 rules of handwritten/rules.ts | 97.13 | 99.71 | 79.41 |
| search from the hand-written tables, the number to beat | 97.68 | 99.45 | 75.89 |
| search from today's tables, no training | 95.44 | 98.33 | 58.23 |
| plain pass | 96.23 (95.68 to 96.70) | 99.27 (99.04 to 99.40) | 70.62 (69.90 to 71.37) |
| holes, every hand-written choice blanked, then trained | 96.98 (96.17 to 97.43) | 99.40 (99.27 to 99.62) | 73.06 (70.08 to 75.02) |
| holes, a tenth of the hand-written choices blanked, then trained | 97.14 (97.10 to 97.19) | 99.70 (99.64 to 99.75) | 79.15 (77.79 to 79.96) |
| spare states, 4 tokenizer states | 96.72 (96.09 to 97.36) | 99.41 (99.30 to 99.53) | 72.47 (70.63 to 75.64) |
| spare states beside the hand-written rules | 97.45 (97.09 to 97.69) | 99.43 (98.92 to 99.65) | 77.49 (74.61 to 78.94) |
| generic of round 1, training then a search | 94.83 (93.69 to 96.27) | 97.42 (95.89 to 99.29) | 70.72 (68.21 to 73.18) |
| extra facts of round 1, classes chosen by hand | 97.11 (96.15 to 97.74) | 99.01 (97.21 to 99.67) | 79.28 (77.15 to 81.93) |
| extra facts of round 1, classes chosen by hand, confirmation files | 97.36 (96.39 to 97.79) | 99.35 (98.64 to 99.75) | 78.01 (76.35 to 78.92) |
| extra facts of round 1, classes from the train samples | 97.38 (96.93 to 97.80) | 99.53 (99.42 to 99.60) | 77.40 (76.33 to 78.38) |
| combined, generic, training alone | 97.82 (97.25 to 98.43) | 99.60 (99.54 to 99.70) | 76.16 (74.35 to 78.40) |
| combined, generic | 97.50 (97.01 to 98.13) | 99.38 (99.30 to 99.46) | 78.82 (77.37 to 79.73) |
| combined, generic, confirmation files | 96.52 (93.81 to 98.43) | 98.47 (96.84 to 99.80) | 79.15 (77.15 to 81.06) |
| combined, with the classes chosen by hand | 97.10 (94.91 to 98.12) | 98.78 (96.56 to 99.66) | 79.47 (77.24 to 81.80) |
| combined, with the classes chosen by hand, confirmation files | 97.48 (97.15 to 97.99) | 99.23 (98.96 to 99.50) | 80.69 (79.67 to 82.02) |
| combined, from the hand-written tables | 98.09 (96.73 to 98.81) | 98.98 (96.84 to 99.83) | 82.74 (79.78 to 84.90) |
| combined, from the hand-written tables, confirmation files | 97.50 (96.16 to 98.10) | 98.81 (97.45 to 99.57) | 81.91 (79.44 to 82.85) |
| no gradient, search and count in turns | 93.25 (91.36 to 95.98) | 94.96 (92.35 to 97.66) | 73.85 (70.19 to 76.45) |
| combined, generic, added characters as an error, training alone | 97.65 (96.95 to 98.21) | 99.52 (99.38 to 99.67) | 75.73 (72.82 to 77.94) |
| combined, generic, added characters as an error, then searched | 97.70 (96.33 to 98.35) | 99.37 (98.24 to 99.84) | 80.27 (77.39 to 82.40) |

## The written set

The 240 broken texts of lab/recovery-parser/written/, scored in the exact parser. The numbers are of the cases with full agreement from the first error on: 221 cases, 6 of them with nothing to recover, 19343 scored code points. Of them, the cases whose damage is all of the generator's kinds: 180 cases, 6 of them with nothing to recover, 15513 scored code points. The cases with damage that no kind makes: 41 cases, 0 of them with nothing to recover, 3830 scored code points. "Code points" is the share of the scored code points with every scored value right, and "whole cases" the share of the cases with something to recover in which every scored code point is right.

| tables | code points, every case | whole cases, every case | code points, damage of the generator's kinds alone | whole cases, damage of the generator's kinds alone | code points, damage that no kind makes | whole cases, damage that no kind makes |
| --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | 22.14 | 2.3 | 23.73 | 2.9 | 15.69 | 0.0 |
| the dataset's hand rule stay, as tables of the experiment | 50.71 | 18.6 | 52.56 | 20.1 | 43.19 | 12.2 |
| the dataset's hand rule resync, as tables of the experiment | 62.77 | 45.6 | 64.77 | 46.6 | 54.67 | 41.5 |
| the dataset's hand rule words, as tables of the experiment | 75.87 | 50.2 | 78.88 | 51.1 | 63.68 | 46.3 |
| the dataset's hand rule lines, as tables of the experiment | 76.33 | 50.7 | 79.46 | 51.7 | 63.68 | 46.3 |
| hand-written, the 35 rules of handwritten/rules.ts | 82.69 | 56.7 | 87.28 | 59.8 | 64.10 | 43.9 |
| search from the hand-written tables, the number to beat | 82.06 | 53.5 | 86.15 | 57.5 | 65.46 | 36.6 |
| search from today's tables, no training | 73.70 | 37.7 | 75.79 | 42.5 | 65.20 | 17.1 |
| plain pass | 81.60 (80.47 to 82.85) | 42.2 (41.9 to 42.8) | 84.11 (82.81 to 86.08) | 44.9 (44.8 to 45.4) | 71.40 (69.69 to 75.14) | 30.7 (29.3 to 34.1) |
| holes, every hand-written choice blanked, then trained | 85.25 (83.82 to 86.67) | 47.6 (43.7 to 50.2) | 88.30 (87.20 to 89.58) | 51.5 (47.7 to 53.4) | 72.92 (69.09 to 75.54) | 31.2 (24.4 to 39.0) |
| holes, a tenth of the hand-written choices blanked, then trained | 82.18 (81.66 to 82.53) | 56.7 (56.3 to 57.2) | 86.70 (86.19 to 87.09) | 59.4 (59.2 to 59.8) | 63.87 (63.03 to 64.10) | 44.9 (43.9 to 48.8) |
| spare states, 4 tokenizer states | 82.78 (79.73 to 85.27) | 43.1 (40.0 to 47.0) | 85.96 (82.12 to 88.48) | 47.1 (43.7 to 51.7) | 69.92 (64.39 to 72.27) | 25.9 (22.0 to 29.3) |
| spare states beside the hand-written rules | 84.78 (84.26 to 85.34) | 51.0 (47.9 to 54.4) | 88.14 (87.47 to 88.86) | 55.4 (52.3 to 59.2) | 71.20 (69.84 to 72.06) | 32.2 (24.4 to 36.6) |
| generic of round 1, training then a search | 81.71 (80.36 to 82.74) | 42.1 (41.4 to 43.3) | 84.94 (84.32 to 85.43) | 45.7 (44.3 to 48.3) | 68.63 (62.27 to 76.34) | 26.8 (22.0 to 31.7) |
| extra facts of round 1, classes chosen by hand | 86.51 (85.43 to 87.18) | 49.0 (45.1 to 52.6) | 89.69 (88.49 to 90.96) | 52.5 (48.3 to 55.7) | 73.61 (71.91 to 76.08) | 34.1 (26.8 to 43.9) |
| extra facts of round 1, classes chosen by hand, confirmation files | 86.03 (85.49 to 86.77) | 46.3 (43.3 to 48.8) | 89.42 (87.82 to 91.04) | 49.9 (46.0 to 52.9) | 72.32 (69.45 to 76.06) | 31.2 (26.8 to 36.6) |
| extra facts of round 1, classes from the train samples | 85.70 (84.52 to 86.19) | 48.8 (44.7 to 53.0) | 89.31 (88.53 to 89.93) | 51.8 (47.1 to 55.7) | 71.08 (62.61 to 76.01) | 36.1 (34.1 to 41.5) |
| combined, generic, training alone | 85.64 (83.61 to 87.80) | 46.3 (42.3 to 49.3) | 89.21 (87.06 to 91.18) | 51.1 (46.6 to 54.0) | 71.15 (69.16 to 74.13) | 25.9 (17.1 to 39.0) |
| combined, generic | 85.18 (83.75 to 86.00) | 47.7 (46.0 to 49.8) | 88.99 (87.40 to 90.74) | 52.3 (49.4 to 54.0) | 69.73 (66.79 to 72.95) | 28.3 (17.1 to 34.1) |
| combined, generic, confirmation files | 83.60 (79.44 to 86.89) | 46.7 (41.9 to 50.2) | 87.38 (83.50 to 90.99) | 50.3 (45.4 to 52.3) | 68.29 (63.03 to 72.19) | 31.2 (17.1 to 43.9) |
| combined, with the classes chosen by hand | 83.34 (80.05 to 85.46) | 46.8 (44.2 to 49.8) | 87.89 (86.08 to 89.51) | 52.8 (50.6 to 55.2) | 64.90 (55.64 to 72.11) | 21.5 (12.2 to 31.7) |
| combined, with the classes chosen by hand, confirmation files | 84.00 (81.91 to 85.42) | 46.8 (43.3 to 49.8) | 87.82 (85.49 to 89.20) | 50.7 (48.9 to 52.9) | 68.51 (60.94 to 73.39) | 30.2 (19.5 to 36.6) |
| combined, from the hand-written tables | 86.55 (84.73 to 88.43) | 52.8 (47.0 to 55.3) | 89.42 (87.74 to 91.18) | 57.4 (53.4 to 59.2) | 74.93 (69.24 to 78.04) | 33.7 (19.5 to 39.0) |
| combined, from the hand-written tables, confirmation files | 85.51 (81.59 to 87.71) | 50.7 (45.1 to 54.9) | 88.63 (85.25 to 90.53) | 54.5 (48.9 to 58.6) | 72.85 (66.76 to 77.15) | 34.6 (29.3 to 41.5) |
| no gradient, search and count in turns | 80.02 (76.48 to 82.22) | 42.5 (31.2 to 50.2) | 83.87 (81.34 to 86.61) | 48.3 (36.8 to 55.2) | 64.45 (56.79 to 72.14) | 17.9 (7.3 to 29.3) |
| combined, generic, added characters as an error, training alone | 85.27 (83.74 to 86.96) | 44.7 (43.3 to 47.9) | 88.84 (87.55 to 90.05) | 48.7 (47.7 to 50.0) | 70.79 (65.46 to 74.44) | 27.3 (14.6 to 43.9) |
| combined, generic, added characters as an error, then searched | 83.61 (82.20 to 85.57) | 46.3 (44.2 to 50.2) | 88.23 (86.15 to 90.49) | 50.7 (48.3 to 55.7) | 64.87 (60.63 to 69.71) | 27.8 (22.0 to 36.6) |

## What the numbers are not

- For the dataset's hand rules and for the hand-written rules no split counts as unseen, the test split included: the hand rules were chosen by statistics over every split, and the hand-written rules were written with samples of every split of the old snapshot in view. The same holds for tables that started from them.
- The written set's README has slightly lower numbers for today's tables and for the dataset's hand rules. The README's numbers are of the dataset's plain table parser, which keeps the open containers in a running sum: now 22.05 and 2.3, stay 50.44 and 18.1, resync 62.50 and 45.1, words 75.61 and 49.8, lines 76.07 and 50.2. The numbers here are of the exact parser, which keeps a real stack and so has a few more code points right after a closing bracket that does not match, see final/README.md.
- A case of the written set with a disputed code point is in none of the numbers above. The counts of all cases over their agreed code points, per writer's file and without the cases that someone marked as open to another reading are in the file of counts.
