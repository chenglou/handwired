# Generic: today's tables made to recover, without a rule that a person wrote

The question of this arm, in the words of the person who asked for the experiment: "use some generic recipe/method to turn a non-recovery parser into a recoverable one". So no recovery rule written by a person goes in. The base is today's tables, every open cell may change, and what comes out is read against the 35 rules that a person wrote by hand (`../../handwritten/`) and against the number to beat, the greedy search that starts from those rules. The trainer's plain pass, `../plain-pass/`, is this recipe untuned. This arm asks how good the recipe gets.

Two words, besides the ones of `../../README.md`:

- A **recipe** is one way to make the tables: the trainer's settings, the samples, which cells are kept out, and whether a search follows. `generic.ts` holds a recipe as a value, and its name says what is not as in the plain pass, e.g. "3 passes, uniform start, learning rate 0.1".
- A **step** is a list of recipes that are read next to each other, the first one as the control of the others.

**In short**, on the validation split, with the seeds 1 to 5, each reported recipe run once:

- **The best recipe ends above the rules written by hand on all samples, and below the number to beat**: 97.29% of all three (97.12% to 97.47%) against 96.52% and 97.75%, and neither pair of ranges overlaps. The recipe is one pass of the trainer from a uniform start over four times the samples, two settings that keep what no sample asks for, and then the greedy search from the trained tables. Two more orders of the search end at 97.34% each.
- **In the group that tables of today's layout can label, it is still 0.10 points behind the rules written by hand**: 99.41% (99.29% to 99.48%) against 99.51%, with all 15 searches below them.
- **Whole samples stay 6 to 7 points behind, and nothing that was tried moves them**: 73.76% (72.04% to 74.78%) against 80.44%, which is where the plain pass is, 73.22%. The trained tokenizer reads words in the states of numbers and of literals, and single characters inside them come out as numbers, e.g. the `e` of `'env'`, which reads the frozen cell (zero, e). More than half of the wrong code points of the samples that are almost right come in such a state, against one in nine for the hand-written tables.
- **Three things were told apart from their control in the tuning**: a uniform start with enough steps of Adam (96.91% against 96.23% for the plain pass, on the tuning seeds), new samples in place of more passes (+0.10 points), and the search after the training (+0.50 points, and +0.43 on the reported seeds). The learning rate, the temperature, the sharpness cost, the extra targets, the open entries of the display table, a weight per sample and more weight on the first code points after the error were not, or lost something.
- **The search needs the gradient**: the same search from today's tables ends at 89.41% to 96.30% in three orders, and from the trained tables at 97.12% to 97.47% in 15 searches.
- **The search counts code points, and whole samples are at its mercy.** On the reported seeds all 15 searches raise them, by 0.3 to 3.6 points. On the tuning seeds 2 of 9 searches lose 12 points of them: one group's whole samples fall from 95% to 2% for one wrong code point per sample.
- **What the main number does not show is settled by construction, for a price.** With 94 grammar cells kept and the events of a text's end ruled out, no run has a wrong depth on valid JSON that is too deep or a code point shown as past the end, where three passes of the trainer alone break that depth at 60% and 68% of the code points in the two forms of such texts. Keeping the cells costs 0.2 to 0.3 points of all three.

## What the arm is

- **The base is today's tables, and nothing reads the hand-written ones.** A recipe may change every open cell of the tokenizer's table and of the grammar's table, 1,326 cells. One setting of the tuning also trains the 140 open entries of the display table. No recipe adds a state, a class or the bit "first on its line".
- **The tables are no tables of the dataset's plain table parser**: they hold grammar cells with a stack action that does something else than their token does, 62 in the first seed of the best recipe and 86 after its search, so the dataset's bound does not hold for them.
- **The tables of a seed are the last ones of its run**, never the best log point. A seed orders the samples of the training and draws the orders of the search.
- **Tuning and reporting use other seeds.** Every setting was tried with the seeds 11, 12 and 13, and saved under the arm name `generic-tuning`. The best recipe was then fixed and run once with the seeds 1 to 5, under `generic`. All of it was chosen with validation scores in view, so no number here is one on unseen data.

## What keeps a sample from being whole

The plain pass has 73.2% of whole samples where the hand-written rules have 80.4%, and no recipe below closes that. `whole-samples.ts` counts why, here for the best recipe without its search, see [The best recipe](#the-best-recipe), as the mean of the seeds 11, 12 and 13, next to the hand-written tables:

| wrong code points in a sample | the recipe, % of the samples | hand-written, % of the samples |
| --- | --- | --- |
| none, a whole sample | 72.3 | 80.4 |
| 1 | 6.0 | 3.8 |
| 2 or 3 | 4.9 | 3.4 |
| 4 to 10 | 7.6 | 4.9 |
| 11 or more | 9.2 | 7.5 |

So what the trained tables have more of is samples that are almost right: 18.5% of the samples have 1 to 10 wrong code points, against 12.1% for the hand-written tables. Those are 851 samples with 3,106 wrong code points for the recipe and 556 samples with 2,025 for the hand-written tables:

| of the wrong code points of the samples with 1 to 10 of them | the recipe, % | hand-written, % |
| --- | --- | --- |
| among the first 3 scored code points of the sample | 22.3 | 21.9 |
| among the last 3 scored code points | 4.9 | 4.8 |
| in between | 72.8 | 73.3 |
| the display kind alone is wrong | 85.1 | 83.5 |
| the depth or the container alone is wrong | 12.0 | 10.6 |
| both are wrong | 2.9 | 5.9 |
| the label's display kind is string | 51.4 | 34.3 |
| the label's display kind is key | 30.3 | 32.7 |
| the code point's class is `e` | 13.5 | 3.7 |
| the tokenizer is in a state of a number or of a literal before the code point | 57.1 | 11.6 |
| the code point reads a frozen tokenizer cell | 70.9 | 54.5 |

- **It is neither the first code points after the error nor the last ones.** Three wrong code points in four are in between, as for the hand-written tables.
- **It is single characters inside words and strings, shown as a number.** E.g. in `{'env': 'test', 'host': 'cache-2.internal'}`, whose original has double quotes, the tables of two of the three seeds show the `e` of `env` as a number and the letters around it as a key. Their tokenizer goes to the state `zero` at the `'`, the state after the digit 0, and the letter `e` then reads the cell (zero, e), which is frozen: valid JSON reads it in `0e5`, where it starts an exponent and is shown as a number. The third seed reads such a word in the state `exponent` and shows the `-` of `cache-2.internal` as a number, since (exponent, minus) is frozen too. More than half of the wrong code points of the almost right samples come while the tokenizer is in a state of a number or of a literal, against one in nine for the hand-written tables, which read such words in the state `errorLine`, where every cell is open.
- **Why training ends there is a guess, not a measurement.** In a state of a number the cells of white space and of punctuation are frozen and already end the token as a word should end, so a few open cells are enough to make the state read letters. The state `errorLine` has no such cell, and its cells are also the ones that a comment up to the end of its line needs. A person wrote every cell of one state for words. Training takes the states that are nearly there and pays with the characters whose cells valid JSON owns.
- **Which kinds of damage lose whole samples**: strings in single quotes, 8.3% whole against 44.1% for the hand-written tables, 119 samples, then literals of other languages such as `None` (46.2% against 76.8%, 70 samples), a key without its colon (41), a backslash that is not escaped (39), a raw line feed in a string (30), a missing comma (28) and a key without quotes (22). Whole samples per group: 84.1% against 93.3% within reach of the tables, 91.1% against 98.0% in "needs a line rule", 6.2% against 15.6% in "needs a character class", and 33.8% against 31.6% in "needs a nesting fix".

A weight in the loss does not move a word into another state, and the two weights that were tried do not, see [Whole samples](#whole-samples).

## How the best recipe was chosen

Every table of this section is of the seeds 11, 12 and 13 on the validation split: 5,021 broken samples, 425 of them with nothing to recover, 675,949 scored code points. Percentages, as the mean and in brackets the lowest and the highest of the 3 seeds. `report.ts` prints the tables and, for every recipe, the sentences of `describeComparison` against its step's first recipe. **Every setting that was tried is in a table here**: 26 trained recipes, and the search after one of them in three orders.

The two rows that every step is read against:

| setting | all three | all three, within reach of the tables | whole samples | whole samples, within reach of the tables | cells changed against the base | code points shown as past the end | runs that show one so | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | runs with a wrong depth there |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hand-written, the 35 rules of handwritten/rules.ts | 96.52 | 99.51 | 80.44 | 93.35 | 915 | 0 | 0 of 1 | 0.0 | 0.0 | 0 of 1 |
| search from the hand-written tables | 97.75 | 99.68 | 79.37 | 92.34 | 429 | 0 | 0 of 1 | 18.5 | 30.2 | 1 of 1 |

### The trainer's setting

The passes over the train samples and the start of a trainable mix, with every other default of the trainer:

| setting | all three | all three, within reach of the tables | whole samples | whole samples, within reach of the tables | cells changed against the base | code points shown as past the end | runs that show one so | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | runs with a wrong depth there |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 pass, start at today's choice | 96.23 (96.07 to 96.50) | 98.88 (98.74 to 99.07) | 72.33 (71.19 to 73.56) | 84.11 (83.14 to 85.35) | 974 (969 to 983) | 0 | 0 of 3 | 8.8 (0.0 to 26.3) | 9.8 (0.2 to 28.9) | 3 of 3 |
| 1 pass, uniform start | 96.32 (95.97 to 96.72) | 99.16 (98.91 to 99.32) | 71.27 (70.80 to 71.80) | 83.18 (82.62 to 83.51) | 1159 (1156 to 1162) | 0 | 0 of 3 | 79.1 (67.8 to 97.2) | 85.1 (78.7 to 96.8) | 3 of 3 |
| 3 passes, start at today's choice | 96.65 (96.46 to 96.94) | 98.99 (98.87 to 99.24) | 71.73 (71.13 to 72.15) | 83.35 (82.77 to 83.72) | 1040 (1033 to 1048) | 224 (216 to 236) | 3 of 3 | 17.0 (6.5 to 37.5) | 20.0 (0.2 to 46.6) | 3 of 3 |
| 3 passes, uniform start | 96.91 (96.90 to 96.92) | 99.29 (99.24 to 99.33) | 72.58 (71.32 to 74.85) | 84.56 (83.42 to 86.79) | 1159 (1155 to 1163) | 38 (0 to 115) | 1 of 3 | 60.4 (43.5 to 70.4) | 67.5 (49.2 to 77.2) | 3 of 3 |

The first row is the plain pass with other seeds. **Three passes from a uniform start are the one setting of the four that is told apart from the plain pass**: +0.68 points on all samples and +0.41 within reach of the tables, and neither pair of ranges overlaps. Its three seeds are 0.02 points apart, where the plain pass's are 0.43 apart. The whole samples are not told apart in any pair. And a uniform start breaks the depth of valid JSON that is too deep at 60% to 85% of the code points, where the start at today's choice breaks it at 9% to 20%.

The other settings of the trainer, on one pass from a uniform start, which is the first row:

| setting | all three | all three, within reach of the tables | whole samples | whole samples, within reach of the tables | cells changed against the base | code points shown as past the end | runs that show one so | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | runs with a wrong depth there |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 pass, uniform start | 96.32 (95.97 to 96.72) | 99.16 (98.91 to 99.32) | 71.27 (70.80 to 71.80) | 83.18 (82.62 to 83.51) | 1159 (1156 to 1162) | 0 | 0 of 3 | 79.1 (67.8 to 97.2) | 85.1 (78.7 to 96.8) | 3 of 3 |
| 1 pass, uniform start, learning rate 0.02 | 95.81 (95.71 to 95.86) | 98.98 (98.96 to 99.01) | 65.30 (64.66 to 65.75) | 74.69 (74.03 to 75.20) | 1157 (1156 to 1158) | 0 | 0 of 3 | 72.2 (72.2 to 72.2) | 80.7 (80.7 to 80.8) | 3 of 3 |
| 1 pass, uniform start, learning rate 0.1 | 96.62 (96.41 to 96.84) | 99.00 (98.89 to 99.16) | 70.55 (65.45 to 73.13) | 81.44 (74.92 to 85.07) | 1160 (1159 to 1161) | 0 | 0 of 3 | 92.6 (85.9 to 97.8) | 92.9 (86.3 to 97.7) | 3 of 3 |
| 1 pass, uniform start, learning rate 0.2 | 96.03 (95.58 to 96.51) | 98.60 (98.20 to 98.95) | 68.51 (63.32 to 73.61) | 79.09 (71.77 to 85.04) | 1160 (1159 to 1161) | 63 (0 to 188) | 1 of 3 | 91.1 (85.9 to 95.0) | 92.1 (84.2 to 96.8) | 3 of 3 |
| 1 pass, uniform start, temperature falls to 0.5 | 96.52 (96.04 to 96.77) | 99.08 (98.74 to 99.27) | 71.68 (70.34 to 72.72) | 83.35 (82.37 to 83.94) | 1158 | 2 (0 to 6) | 1 of 3 | 86.0 (78.4 to 97.0) | 88.9 (83.4 to 97.2) | 3 of 3 |
| 1 pass, uniform start, temperature falls to 0.2 | 95.97 (95.55 to 96.56) | 98.74 (98.45 to 99.17) | 68.62 (62.10 to 74.19) | 78.89 (70.42 to 85.53) | 1159 (1158 to 1160) | 0 | 0 of 3 | 85.8 (81.4 to 93.1) | 81.4 (70.0 to 93.7) | 3 of 3 |
| 1 pass, uniform start, sharpness cost 0.01 | 96.29 (95.90 to 96.70) | 99.16 (98.92 to 99.29) | 71.08 (70.71 to 71.28) | 82.96 (82.68 to 83.38) | 1160 (1158 to 1162) | 0 | 0 of 3 | 78.9 (69.4 to 95.2) | 85.8 (79.8 to 96.7) | 3 of 3 |
| 1 pass, uniform start, extra targets 0.3 | 96.02 (95.59 to 96.55) | 99.09 (98.85 to 99.22) | 68.79 (64.97 to 70.80) | 80.03 (74.59 to 82.86) | 1144 (1142 to 1145) | 0 | 0 of 3 | 74.2 (68.0 to 86.7) | 85.0 (78.2 to 98.0) | 3 of 3 |
| 1 pass, uniform start, batches of 8 | 96.86 (96.75 to 97.03) | 99.22 (98.99 to 99.40) | 74.02 (73.96 to 74.15) | 85.64 (85.22 to 85.96) | 1156 (1154 to 1160) | 47 (0 to 113) | 2 of 3 | 42.7 (41.6 to 43.5) | 47.9 (45.7 to 51.0) | 3 of 3 |
| 1 pass, uniform start, batches of 128 | 95.68 (95.58 to 95.83) | 99.02 (98.90 to 99.11) | 65.11 (64.62 to 65.51) | 74.48 (73.79 to 74.92) | 1158 (1157 to 1160) | 0 | 0 of 3 | 98.5 (98.4 to 98.5) | 99.3 (99.3 to 99.3) | 3 of 3 |

- **What moves the score on one pass is how many steps Adam takes.** A pass has 1,169 steps with batches of 32. With batches of 8 it has four times as many and ends at 96.86, above every seed of the control, with 74.02% of whole samples against 71.27%, and neither pair of ranges overlaps. With batches of 128 or a learning rate of 0.02 it ends at 95.7 to 95.8 with 65% of whole samples.
- **The temperature, the sharpness cost and the extra targets are not told apart from the control** on all samples, as in the arm `../holes/`.

So the two settings that were ahead on one pass were run on three passes:

| setting | all three | all three, within reach of the tables | whole samples | whole samples, within reach of the tables | cells changed against the base | code points shown as past the end | runs that show one so | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | runs with a wrong depth there |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3 passes, uniform start | 96.91 (96.90 to 96.92) | 99.29 (99.24 to 99.33) | 72.58 (71.32 to 74.85) | 84.56 (83.42 to 86.79) | 1159 (1155 to 1163) | 38 (0 to 115) | 1 of 3 | 60.4 (43.5 to 70.4) | 67.5 (49.2 to 77.2) | 3 of 3 |
| 3 passes, uniform start, batches of 8 | 96.81 (96.54 to 97.10) | 99.10 (98.78 to 99.39) | 74.12 (73.17 to 75.17) | 85.65 (84.33 to 86.79) | 1150 (1144 to 1155) | 469 (0 to 1389) | 2 of 3 | 25.2 (6.5 to 34.7) | 19.5 (0.0 to 31.4) | 3 of 3 |
| 3 passes, uniform start, learning rate 0.1 | 96.80 (96.63 to 97.00) | 99.09 (99.02 to 99.24) | 73.40 (73.09 to 73.63) | 85.03 (84.86 to 85.25) | 1160 (1156 to 1164) | 7 (0 to 21) | 2 of 3 | 58.7 (50.7 to 63.2) | 65.1 (50.7 to 73.1) | 3 of 3 |

**On three passes neither is ahead any more**: the score has stopped rising at about 96.9, and smaller batches show up to 1,389 code points as past the end. So the trainer's setting is three passes from a uniform start with every other default, and it is the control of the next steps.

### The display table, as a setting of its own

| setting | all three | all three, within reach of the tables | whole samples | whole samples, within reach of the tables | cells changed against the base | code points shown as past the end | runs that show one so | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | runs with a wrong depth there |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3 passes, uniform start | 96.91 (96.90 to 96.92) | 99.29 (99.24 to 99.33) | 72.58 (71.32 to 74.85) | 84.56 (83.42 to 86.79) | 1159 (1155 to 1163) | 38 (0 to 115) | 1 of 3 | 60.4 (43.5 to 70.4) | 67.5 (49.2 to 77.2) | 3 of 3 |
| 3 passes, uniform start, display table open | 96.99 (96.85 to 97.10) | 98.92 (98.78 to 99.10) | 73.98 (69.08 to 76.98) | 85.11 (78.57 to 89.09) | 1249 (1245 to 1253) | 0 | 0 of 3 | 56.7 (43.4 to 64.2) | 62.5 (50.4 to 69.3) | 3 of 3 |

With the 140 open entries of the display table trainable, the score on all samples is not told apart from the control (+0.08, the ranges overlap), and **the group "within reach of the tables" loses 0.38 points, with ranges that do not overlap**. The whole samples spread from 69.08 to 76.98 over the three seeds. So the open entries are not in the best recipe. One run of `../../structure/smoke.ts` with the open entries ended 0.8 points above the highest seed of the plain pass after one pass. Three seeds on three passes do not show such a gain.

### Whole samples

Two weights of the loss, which this arm added to `../../soft/` as options that are off by default, see `LossOptions` in `../../soft/twin.ts` and the last setting of `../../soft/check-gradient.ts`. The loss counts code points, so a long sample weighs more than a short one, and the share of whole samples counts every sample once. With `sampleWeightPower` every loss of a sample is divided by (its scored code points) ^ power, so that 1 makes every sample weigh the same. The other weight puts 4 times the weight on the first 8 scored code points after the first error. On one pass:

| setting | all three | all three, within reach of the tables | whole samples | whole samples, within reach of the tables | cells changed against the base | code points shown as past the end | runs that show one so | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | runs with a wrong depth there |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 pass, uniform start | 96.32 (95.97 to 96.72) | 99.16 (98.91 to 99.32) | 71.27 (70.80 to 71.80) | 83.18 (82.62 to 83.51) | 1159 (1156 to 1162) | 0 | 0 of 3 | 79.1 (67.8 to 97.2) | 85.1 (78.7 to 96.8) | 3 of 3 |
| 1 pass, uniform start, every sample weighs the same | 96.44 (96.33 to 96.55) | 98.82 (98.67 to 99.02) | 73.87 (72.82 to 75.20) | 85.19 (83.97 to 86.51) | 1157 (1156 to 1159) | 0 | 0 of 3 | 69.6 (63.8 to 72.5) | 76.6 (72.1 to 79.7) | 3 of 3 |
| 1 pass, uniform start, sample weight power 0.5 | 96.40 (96.15 to 96.81) | 98.91 (98.45 to 99.34) | 73.67 (73.24 to 73.96) | 85.33 (84.92 to 85.53) | 1157 (1153 to 1161) | 0 | 0 of 3 | 78.4 (71.8 to 91.3) | 85.2 (78.2 to 98.1) | 3 of 3 |
| 1 pass, uniform start, the first 8 code points weigh 4 times | 96.08 (95.48 to 96.77) | 99.05 (98.70 to 99.28) | 72.29 (70.71 to 74.22) | 84.40 (82.89 to 86.02) | 1158 (1157 to 1160) | 22 (0 to 67) | 1 of 3 | 76.7 (66.9 to 95.2) | 84.5 (78.3 to 96.5) | 3 of 3 |

And the weight per sample on three passes:

| setting | all three | all three, within reach of the tables | whole samples | whole samples, within reach of the tables | cells changed against the base | code points shown as past the end | runs that show one so | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | runs with a wrong depth there |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3 passes, uniform start | 96.91 (96.90 to 96.92) | 99.29 (99.24 to 99.33) | 72.58 (71.32 to 74.85) | 84.56 (83.42 to 86.79) | 1159 (1155 to 1163) | 38 (0 to 115) | 1 of 3 | 60.4 (43.5 to 70.4) | 67.5 (49.2 to 77.2) | 3 of 3 |
| 3 passes, uniform start, every sample weighs the same | 96.52 (96.29 to 96.65) | 98.87 (98.69 to 99.18) | 73.87 (72.54 to 74.85) | 85.22 (83.81 to 86.11) | 1151 (1148 to 1153) | 0 | 0 of 3 | 52.1 (43.2 to 68.0) | 54.0 (47.1 to 64.1) | 3 of 3 |
| 3 passes, uniform start, sample weight power 0.5 | 96.76 (96.50 to 96.92) | 99.08 (98.74 to 99.28) | 74.18 (73.98 to 74.52) | 85.90 (85.56 to 86.24) | 1155 (1154 to 1156) | 31 (0 to 93) | 1 of 3 | 50.3 (42.9 to 58.3) | 51.4 (46.4 to 59.9) | 3 of 3 |

- **On one pass a weight per sample gives 2.4 to 2.6 points of whole samples, and the ranges do not overlap**: 73.87 (72.82 to 75.20) with every sample weighing the same against 71.27 (70.80 to 71.80). What comes back are kinds of damage with short texts: a key without its colon is whole in 98.0% of its samples against 77.2% with the control, which is what the hand-written tables have, a string that is open at the end of its line in 94.7% against 87.1%, and a stray closing bracket in 68.3% against 39.0%. Strings in single quotes are whole in 6.1% against 4.9%, where the hand-written tables have 44.1%: the words are still read in the states of numbers.
- **On three passes the gain is not told apart from the control, and it costs code points.** Whole samples are +1.3 and +1.6 points with ranges that overlap. With every sample weighing the same, all three falls by 0.39 points on all samples and by 0.42 within reach of the tables, and neither pair of ranges overlaps. So the weight per sample is not in the best recipe.
- **More weight on the first code points after the error is not told apart from the control** in any of the four comparisons, as the count above says it would not be: the wrong code points are not the first ones.

### Valid JSON that is too deep

A valid JSON text of more than 16 levels has its first error at its 17th opening bracket and reads open cells from there on. With today's tables that first error leads into the grammar state `error`, and the row of that state leads nowhere else, so the brackets go on counting. The setting keeps 94 grammar cells out of training (`cellsOfTooDeepValidJson` in `generic.ts`): the 6 cells of an opening bracket at depth 16 where a value may start, which the texts of `../../check-deep.ts` read, made anew from other random streams, and the 88 cells of the row of the state `error`. Tables with today's choice in those cells show every valid JSON text that is too deep as today, whatever the other open cells hold: `check.ts` tries that with 20 random settings of the open cells on the 600 texts of `check-deep.ts` and on 300 texts with a container after their deepest part.

| setting | all three | all three, within reach of the tables | whole samples | whole samples, within reach of the tables | cells changed against the base | code points shown as past the end | runs that show one so | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | runs with a wrong depth there |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3 passes, uniform start | 96.91 (96.90 to 96.92) | 99.29 (99.24 to 99.33) | 72.58 (71.32 to 74.85) | 84.56 (83.42 to 86.79) | 1159 (1155 to 1163) | 38 (0 to 115) | 1 of 3 | 60.4 (43.5 to 70.4) | 67.5 (49.2 to 77.2) | 3 of 3 |
| 3 passes, uniform start, too deep cells kept | 96.69 (96.61 to 96.75) | 99.21 (99.16 to 99.24) | 73.01 (71.02 to 74.13) | 84.88 (83.29 to 85.84) | 1068 (1063 to 1073) | 91 (0 to 204) | 2 of 3 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 of 3 |

**It settles the matter in every seed, and it costs 0.22 points of all three**, 96.69 (96.61 to 96.75) against 96.91 (96.90 to 96.92), and 0.08 within reach of the tables, with ranges that do not overlap in either row. The cost is the state `error` itself: with its row kept, a recovery can no longer use it as one of its 8 grammar states, since nothing leads out of it. The whole samples are not told apart. The setting is in the best recipe: tables that break valid JSON for a fifth of a point are not a recovery that anyone would ship, and the hand-written rules, which the result is read against, keep that depth too.

### Code points shown as past the end

A trained tokenizer cell can snap to one of the three events of a text's end, and a code point that reads the cell is then shown as "past the end". The setting takes those events out of the mixes of the tokenizer cells that a code point of a text reads (`ruleOutEndEvents` in `generic.ts`): their weights start at -Infinity, so their share is exactly 0 and snapping never picks them.

| setting | all three | all three, within reach of the tables | whole samples | whole samples, within reach of the tables | cells changed against the base | code points shown as past the end | runs that show one so | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | runs with a wrong depth there |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 3 passes, uniform start | 96.91 (96.90 to 96.92) | 99.29 (99.24 to 99.33) | 72.58 (71.32 to 74.85) | 84.56 (83.42 to 86.79) | 1159 (1155 to 1163) | 38 (0 to 115) | 1 of 3 | 60.4 (43.5 to 70.4) | 67.5 (49.2 to 77.2) | 3 of 3 |
| 3 passes, uniform start, no event of a text's end | 96.86 (96.62 to 97.05) | 99.23 (99.08 to 99.31) | 73.31 (72.58 to 74.70) | 85.17 (84.49 to 86.48) | 1103 (1098 to 1107) | 0 | 0 of 3 | 56.1 (43.4 to 67.4) | 60.9 (49.1 to 75.5) | 3 of 3 |

**No code point is shown as past the end, and the score is not told apart from the control** in any of the four comparisons: -0.05 points on all samples with ranges that overlap. It is in the best recipe.

### More samples instead of more passes

The dataset is a generator, so there are more train samples than the standard set holds. "4 times the samples" are the train samples of the indexes 0 to 239,999 of the same seed, made by `loadSamples` as the standard set is, without the test split: 149,742 samples that give the twin a step, against 37,381. One pass over them takes as many steps as four passes over the standard set.

| setting | all three | all three, within reach of the tables | whole samples | whole samples, within reach of the tables | cells changed against the base | code points shown as past the end | runs that show one so | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | runs with a wrong depth there |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4 passes, uniform start | 96.92 (96.88 to 96.95) | 99.34 (99.31 to 99.41) | 73.38 (72.45 to 74.00) | 85.38 (84.40 to 86.05) | 1160 (1155 to 1163) | 37 (0 to 112) | 1 of 3 | 46.2 (43.6 to 51.4) | 52.4 (49.8 to 57.0) | 3 of 3 |
| 1 pass, uniform start, 4 times the samples | 97.02 (96.97 to 97.09) | 99.35 (99.29 to 99.40) | 73.66 (72.54 to 74.46) | 85.26 (84.12 to 85.99) | 1161 (1160 to 1163) | 33 (0 to 98) | 1 of 3 | 8.0 (0.0 to 15.5) | 9.3 (0.0 to 14.7) | 2 of 3 |
| 1 pass, uniform start | 96.32 (95.97 to 96.72) | 99.16 (98.91 to 99.32) | 71.27 (70.80 to 71.80) | 83.18 (82.62 to 83.51) | 1159 (1156 to 1162) | 0 | 0 of 3 | 79.1 (67.8 to 97.2) | 85.1 (78.7 to 96.8) | 3 of 3 |

**Four times the samples in one pass are 0.10 points above the standard set in four passes on all samples, and the ranges do not overlap**: 97.02 (96.97 to 97.09) against 96.92 (96.88 to 96.95). Within reach of the tables and in whole samples the two are not told apart. A fourth pass over the standard set adds nothing to three: 96.92 against 96.91. So new samples give a little where repeated ones give nothing, at the same cost of training, and the best recipe takes them. More than four times the samples, and several passes over them, were not tried.

### The parts put together

One pass over four times the samples, with the cells of too deep valid JSON kept and without the events of a text's end, against the same pass without the two settings:

| setting | all three | all three, within reach of the tables | whole samples | whole samples, within reach of the tables | cells changed against the base | code points shown as past the end | runs that show one so | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | runs with a wrong depth there |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 pass, uniform start, 4 times the samples | 97.02 (96.97 to 97.09) | 99.35 (99.29 to 99.40) | 73.66 (72.54 to 74.46) | 85.26 (84.12 to 85.99) | 1161 (1160 to 1163) | 33 (0 to 98) | 1 of 3 | 8.0 (0.0 to 15.5) | 9.3 (0.0 to 14.7) | 2 of 3 |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples | 96.68 (96.25 to 96.92) | 99.23 (99.16 to 99.28) | 72.30 (71.50 to 73.83) | 84.14 (83.35 to 85.68) | 1024 (1022 to 1026) | 0 | 0 of 3 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 of 3 |

The two settings do what they did alone: no wrong depth and no code point past the end in any seed, for 0.34 points of all three on all samples and 0.12 within reach of the tables, with ranges that do not overlap. One seed of the three ends at 96.25, so the spread is wider than without the settings, 0.67 points against 0.12.

### Gradient, then search

The number to beat is a greedy search that starts from the hand-written tables. Here the same search starts from the trained tables of the recipe above: `searchCells` of `../holes/restricted-search.ts`, which is the search of `../../search/search.ts`, over the cells that the recipe trains, 1,232 of the 1,326 open cells, on the train split of the standard set, in a random order that the seed draws anew for every pass. It tries no event of a text's end and it leaves the 94 kept cells alone, so its tables keep both settings.

| setting | all three | all three, within reach of the tables | whole samples | whole samples, within reach of the tables | cells changed against the base | code points shown as past the end | runs that show one so | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | runs with a wrong depth there |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples | 96.68 (96.25 to 96.92) | 99.23 (99.16 to 99.28) | 72.30 (71.50 to 73.83) | 84.14 (83.35 to 85.68) | 1024 (1022 to 1026) | 0 | 0 of 3 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 of 3 |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 1 | 97.18 (97.15 to 97.23) | 99.32 (99.18 to 99.43) | 75.01 (74.56 to 75.39) | 87.01 (86.70 to 87.43) | 1036 (1033 to 1041) | 0 | 0 of 3 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 of 3 |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 2 | 97.27 (97.22 to 97.36) | 99.39 (99.38 to 99.42) | 69.43 (61.44 to 74.63) | 84.56 (82.99 to 86.36) | 1035 (1031 to 1037) | 0 | 0 of 3 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 of 3 |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 3 | 97.15 (97.08 to 97.19) | 99.34 (99.24 to 99.40) | 69.37 (61.10 to 75.07) | 84.58 (82.40 to 87.40) | 1032 (1029 to 1034) | 0 | 0 of 3 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 of 3 |

- **In its first order the search adds 0.50 points of all three and 2.7 points of whole samples, and neither pair of ranges overlaps**: 97.18 (97.15 to 97.23) against 96.68 (96.25 to 96.92), and 75.01 (74.56 to 75.39) against 72.30 (71.50 to 73.83). Within reach of the tables the gain is 0.09 points, with ranges that overlap. The best recipe was fixed with this order alone, and the two other orders were run after the reported runs.
- **It takes back what one seed of the training lost**: the three trained seeds are 0.67 points apart, and the searched ones 0.08.
- **Both settings hold after the search**, in every run: no wrong depth on valid JSON that is too deep, and no code point past the end.
- **A search costs as much as the training before it, or twice as much**: 105 to 225 s for 8 to 15 passes over the cells and 797 to 1,013 changes of a cell, over the 8 searches of the first order, where the training takes 107 to 114 s.
- **The order of the cells moves the score by little, and the whole samples by a lot.** The three orders end at 97.18, 97.27 and 97.15 of all three, each above the training alone with ranges that do not overlap, where three orders of the search from today's tables are 6.9 points apart. But with the second and the third order one seed's whole samples fall from 73.83% to 61.44% and 61.10%. In the group "needs a line rule" they go from 95.1% to 1.6% and 2.0%, while the group's all three stays at 99.2% and 98.9%: one code point is wrong in almost every sample of the group, and the search took the cell because it has more code points right elsewhere. So the search counts code points, and 2 of its 9 runs on the tuning seeds paid for them with 12 points of whole samples.
- **The search without the gradient is far behind.** `../../README.md` has the same search from today's tables over all 1,326 open cells in three orders: 94.34, 96.30 and 89.41 of all three, with 72.78, 56.64 and 55.11 of whole samples. From the trained tables every one of the 8 searches of the first order ends between 97.12 and 97.47. So the search needs a start in which a single cell already pays, and the training gives it one, as the hand-written tables do for the number to beat.

### The best recipe

`bestRecipe` in `generic.ts`, with the search after it:

1. **Train every open cell but 94, once**: one pass from a uniform start over four times the samples, with the trainer's defaults for the rest (learning rate 0.05, batches of 32, temperature 1, no sharpness cost, no extra target, today's display table).
2. **Keep what no sample asks for**: the 94 cells of too deep valid JSON hold today's choice, and no tokenizer cell that a code point reads takes an event of a text's end.
3. **Search from the trained tables**: the greedy search over the trained cells on the train split of the standard set.

How each part was chosen, by the tables above:

- A uniform start and more steps of Adam were told apart from the plain pass. Past three passes, which are 3,507 steps, a fourth pass, smaller batches and a larger learning rate were not told apart from three passes.
- New samples in place of repeated ones were 0.10 points ahead at the same cost, with ranges that do not overlap.
- The two settings that keep something out were taken for what the main number does not show, and one of them costs score: without the cells of too deep valid JSON the same recipe has 0.3 points more.
- The search was taken for its score and, in the one order that was run before the recipe was fixed, for its whole samples. The two orders that were run later show that it can lose whole samples too.
- Not in the recipe: the open entries of the display table, which lost 0.38 points within reach of the tables, a weight per sample, whose gain in whole samples was not told apart on three passes while it cost 0.39 points, more weight on the first code points, the temperature, the sharpness cost and the extra targets.

**The parts were tuned one at a time** and then put together, with one run of the whole on the tuning seeds, the tables above. No setting of the whole recipe was tuned, e.g. the passes of the trainer when a search follows.

## Results

The reported runs: the best recipe without its search and with it, each run once with the seeds 1 to 5. The validation split of the standard set, the exact parser: 5,021 broken samples, 425 of them with nothing to recover, 675,949 scored code points. Percentages, as the mean and in brackets the lowest and the highest of the 5 seeds. `report.ts` prints every table and every sentence of this section.

| setting | all three | all three, within reach of the tables | whole samples | whole samples, within reach of the tables | cells changed against the base | code points shown as past the end | runs that show one so | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | runs with a wrong depth there |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hand-written, the 35 rules of handwritten/rules.ts | 96.52 | 99.51 | 80.44 | 93.35 | 915 | 0 | 0 of 1 | 0.0 | 0.0 | 0 of 1 |
| search from the hand-written tables | 97.75 | 99.68 | 79.37 | 92.34 | 429 | 0 | 0 of 1 | 18.5 | 30.2 | 1 of 1 |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples | 96.87 (96.79 to 96.95) | 99.25 (99.21 to 99.34) | 72.91 (70.74 to 73.93) | 84.72 (82.74 to 85.68) | 1023 (1016 to 1028) | 0 | 0 of 5 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 of 5 |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 1 | 97.29 (97.12 to 97.47) | 99.41 (99.29 to 99.48) | 73.76 (72.04 to 74.78) | 85.79 (84.49 to 86.91) | 1033 (1028 to 1037) | 0 | 0 of 5 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 of 5 |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 2 | 97.34 (97.27 to 97.38) | 99.42 (99.36 to 99.45) | 74.55 (73.41 to 76.13) | 86.38 (84.89 to 88.29) | 1032 (1029 to 1037) | 0 | 0 of 5 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 of 5 |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 3 | 97.34 (97.27 to 97.44) | 99.39 (99.34 to 99.47) | 74.31 (73.85 to 74.70) | 86.22 (85.62 to 86.54) | 1031 (1027 to 1038) | 0 | 0 of 5 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 of 5 |

The three labels one by one, with the baselines of `../baselines.ts` and the plain pass:

| setting | seeds | all three | display kind | depth | container | whole samples | cells changed against the base | cells that differ from today's parser |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | none | 42.69 | 49.15 | 75.06 | 88.65 | 11.92 | 0 | 0 |
| the dataset's hand rule stay, as tables of the experiment | none | 73.81 | 78.16 | 93.90 | 98.15 | 28.74 | 1058 | 1058 |
| the dataset's hand rule resync, as tables of the experiment | none | 84.35 | 88.17 | 94.97 | 98.33 | 71.39 | 1078 | 1078 |
| the dataset's hand rule words, as tables of the experiment | none | 93.09 | 97.00 | 95.36 | 98.60 | 77.31 | 1078 | 1078 |
| the dataset's hand rule lines, as tables of the experiment | none | 93.23 | 97.00 | 95.50 | 98.59 | 77.48 | 1108 | 1111 |
| hand-written, the 35 rules of handwritten/rules.ts | none | 96.52 | 98.69 | 97.66 | 99.56 | 80.44 | 915 | 915 |
| search from the hand-written tables | none | 97.75 | 99.09 | 98.53 | 99.71 | 79.37 | 429 | 983 |
| one pass of the trainer from today's tables, defaults | 5 | 96.50 (95.88 to 96.74) | 98.22 (98.11 to 98.27) | 98.13 (97.64 to 98.35) | 99.68 (99.39 to 99.79) | 73.22 (72.76 to 73.54) | 967 (935 to 984) | 967 (935 to 984) |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples | 5 | 96.87 (96.79 to 96.95) | 98.39 (98.29 to 98.47) | 98.38 (98.34 to 98.41) | 99.73 (99.69 to 99.75) | 72.91 (70.74 to 73.93) | 1023 (1016 to 1028) | 1023 (1016 to 1028) |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 1 | 5 | 97.29 (97.12 to 97.47) | 98.69 (98.64 to 98.80) | 98.47 (98.31 to 98.56) | 99.73 (99.72 to 99.75) | 73.76 (72.04 to 74.78) | 1033 (1028 to 1037) | 1033 (1028 to 1037) |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 2 | 5 | 97.34 (97.27 to 97.38) | 98.69 (98.62 to 98.79) | 98.50 (98.43 to 98.56) | 99.73 (99.71 to 99.76) | 74.55 (73.41 to 76.13) | 1032 (1029 to 1037) | 1032 (1029 to 1037) |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 3 | 5 | 97.34 (97.27 to 97.44) | 98.70 (98.64 to 98.75) | 98.52 (98.44 to 98.65) | 99.73 (99.69 to 99.77) | 74.31 (73.85 to 74.70) | 1031 (1027 to 1038) | 1031 (1027 to 1038) |

All three per group of the dataset, with the group's validation samples:

| setting | within reach of the tables, 3687 | needs a display fix, 37 | needs a line rule, 488 | needs a character class, 326 | needs a nesting fix, 76 | out of reach, 407 |
| --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | 47.4 | 18.3 | 63.8 | 10.1 | 26.5 | 25.6 |
| the dataset's hand rule stay, as tables of the experiment | 79.0 | 57.9 | 90.8 | 49.5 | 36.1 | 50.1 |
| the dataset's hand rule resync, as tables of the experiment | 92.8 | 70.3 | 96.7 | 49.9 | 42.3 | 53.3 |
| the dataset's hand rule words, as tables of the experiment | 98.3 | 95.0 | 97.8 | 85.7 | 42.7 | 62.4 |
| the dataset's hand rule lines, as tables of the experiment | 98.3 | 95.0 | 99.6 | 85.7 | 42.7 | 62.4 |
| hand-written, the 35 rules of handwritten/rules.ts | 99.5 | 98.2 | 99.0 | 92.2 | 76.1 | 78.0 |
| search from the hand-written tables | 99.7 | 98.0 | 99.1 | 94.9 | 90.3 | 85.4 |
| one pass of the trainer from today's tables, defaults | 99.1 (98.9 to 99.3) | 96.2 (94.2 to 96.8) | 99.7 (98.9 to 99.9) | 89.7 (88.9 to 90.5) | 89.4 (83.1 to 92.8) | 81.6 (76.9 to 83.6) |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples | 99.3 (99.2 to 99.3) | 96.9 (96.2 to 97.4) | 98.8 (98.8 to 98.9) | 91.2 (90.9 to 91.5) | 89.5 (89.0 to 90.2) | 83.7 (83.5 to 83.9) |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 1 | 99.4 (99.3 to 99.5) | 97.4 (97.2 to 97.6) | 99.7 (98.9 to 99.9) | 92.3 (91.7 to 93.5) | 90.9 (89.3 to 91.8) | 84.8 (83.7 to 85.8) |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 2 | 99.4 (99.4 to 99.5) | 97.3 (97.1 to 97.4) | 99.7 (98.9 to 99.9) | 92.5 (91.2 to 93.2) | 90.6 (89.1 to 92.0) | 85.0 (84.4 to 85.3) |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 3 | 99.4 (99.3 to 99.5) | 97.2 (96.9 to 97.4) | 99.9 (99.8 to 99.9) | 92.3 (91.4 to 92.6) | 90.9 (90.4 to 91.4) | 85.3 (84.7 to 85.8) |

What the main number does not show:

| setting | added code points shown as an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels, nothing after the nested containers | the same, members after the nested containers | ground rules on the fixed texts | tables of the plain table parser |
| --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | 89.6 | 0 | 0.0 | 0.0 | hold | yes |
| the dataset's hand rule stay, as tables of the experiment | 62.7 | 0 | 0.0 | 0.0 | hold | yes |
| the dataset's hand rule resync, as tables of the experiment | 60.2 | 0 | 0.0 | 0.0 | hold | yes |
| the dataset's hand rule words, as tables of the experiment | 3.7 | 0 | 0.0 | 0.0 | hold | yes |
| the dataset's hand rule lines, as tables of the experiment | 3.7 | 0 | 0.0 | 0.0 | hold | yes |
| hand-written, the 35 rules of handwritten/rules.ts | 0.0 | 0 | 0.0 | 0.0 | hold | no: 21 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| search from the hand-written tables | 0.0 | 0 | 18.5 | 30.2 | hold | no: 94 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| one pass of the trainer from today's tables, defaults | 0.9 (0.7 to 1.1) | 50 (0 to 160) | 3.0 (0.0 to 12.3) | 4.7 (0.0 to 16.4) | hold | no: 26 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples | 0.0 (0.0 to 0.0) | 0 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | hold | no: 62 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 1 | 0.0 (0.0 to 0.1) | 0 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | hold | no: 86 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 2 | 0.0 (0.0 to 0.0) | 0 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | hold | no: 88 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 3 | 0.1 (0.0 to 0.2) | 0 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | hold | no: 103 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |

Whole samples per group of the dataset, in percent of the group's samples with something to recover:

| setting | all | within reach of the tables | needs a display fix | needs a line rule | needs a character class | needs a nesting fix | out of reach |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hand-written, the 35 rules of handwritten/rules.ts | 80.44 | 93.3 | 0.0 | 98.0 | 15.6 | 31.6 | 24.3 |
| search from the hand-written tables | 79.37 | 92.3 | 0.0 | 95.1 | 13.5 | 31.6 | 25.6 |
| one pass of the trainer from today's tables, defaults | 73.22 (72.76 to 73.54) | 84.9 (84.1 to 85.7) | 0.0 (0.0 to 0.0) | 95.8 (95.1 to 96.7) | 6.6 (5.8 to 8.3) | 32.4 (22.4 to 40.8) | 20.3 (17.4 to 22.6) |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples | 72.91 (70.74 to 73.93) | 84.7 (82.7 to 85.7) | 0.0 (0.0 to 0.0) | 94.5 (88.9 to 96.7) | 6.1 (5.5 to 7.1) | 34.2 (32.9 to 35.5) | 19.7 (17.0 to 21.6) |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 1 | 73.76 (72.04 to 74.78) | 85.8 (84.5 to 86.9) | 0.0 (0.0 to 0.0) | 95.5 (89.5 to 98.0) | 6.1 (4.0 to 7.1) | 30.5 (23.7 to 34.2) | 20.2 (19.4 to 20.9) |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 2 | 74.55 (73.41 to 76.13) | 86.4 (84.9 to 88.3) | 0.0 (0.0 to 0.0) | 97.3 (96.9 to 97.7) | 8.8 (6.4 to 12.6) | 32.6 (28.9 to 35.5) | 19.8 (17.7 to 22.6) |
| 1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 3 | 74.31 (73.85 to 74.70) | 86.2 (85.6 to 86.5) | 0.0 (0.0 to 0.0) | 96.8 (96.3 to 97.7) | 7.6 (7.1 to 8.6) | 30.0 (26.3 to 32.9) | 20.3 (18.4 to 22.1) |

Against the rules written by hand and against the number to beat, as `describeComparison` says it for the best recipe with the search in its first order, with "the best recipe, searched" for its name, "1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples, then searched, order 1":

- All three, all validation samples: the best recipe, searched, has 97.29 (97.12 to 97.47) over 5 seeds, the hand-written tables have 96.52 and no seed. The means differ by +0.78 points, and the two ranges do not overlap.
- All three, group: within reach of the tables: 99.41 (99.29 to 99.48) over 5 seeds against 99.51 and no seed. The means differ by -0.10 points, and the two ranges do not overlap.
- Whole samples, all validation samples: 73.76 (72.04 to 74.78) over 5 seeds against 80.44 and no seed. The means differ by -6.68 points, and the two ranges do not overlap.
- Whole samples, group: within reach of the tables: 85.79 (84.49 to 86.91) over 5 seeds against 93.35 and no seed. The means differ by -7.56 points, and the two ranges do not overlap.
- All three, all validation samples: the best recipe, searched, has 97.29 (97.12 to 97.47) over 5 seeds, the search from the hand-written tables has 97.75 and no seed. The means differ by -0.45 points, and the two ranges do not overlap.
- All three, group: within reach of the tables: 99.41 (99.29 to 99.48) over 5 seeds against 99.68 and no seed. The means differ by -0.28 points, and the two ranges do not overlap.
- Whole samples, all validation samples: 73.76 (72.04 to 74.78) over 5 seeds against 79.37 and no seed. The means differ by -5.61 points, and the two ranges do not overlap.
- All three, all validation samples, against the plain pass: 97.29 (97.12 to 97.47) over 5 seeds against 96.50 (95.88 to 96.74) over 5 seeds. The means differ by +0.79 points, and the two ranges do not overlap.
- All three, group: within reach of the tables, against the plain pass: 99.41 (99.29 to 99.48) against 99.11 (98.87 to 99.31). The means differ by +0.30 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- Whole samples, all validation samples, against the plain pass: 73.76 (72.04 to 74.78) against 73.22 (72.76 to 73.54). The means differ by +0.54 points, and the two ranges overlap, so these seeds do not tell the two settings apart.

And the search against the training alone, on the reported seeds:

- All three, all validation samples: 97.29 (97.12 to 97.47) with the search against 96.87 (96.79 to 96.95) without. The means differ by +0.43 points, and the two ranges do not overlap.
- All three, group: within reach of the tables: 99.41 (99.29 to 99.48) against 99.25 (99.21 to 99.34). The means differ by +0.16 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- Whole samples, all validation samples: 73.76 (72.04 to 74.78) against 72.91 (70.74 to 73.93). The means differ by +0.85 points, and the two ranges overlap, so these seeds do not tell the two settings apart.

The three orders of the search, seed by seed. Every searched setting of a seed starts from the same trained tables:

| seed | the training alone | searched, order 1 | searched, order 2 | searched, order 3 | lowest to highest of the orders | whole samples: the training alone | searched, order 1 | searched, order 2 | searched, order 3 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 96.86 | 97.30 | 97.38 | 97.27 | 97.27 to 97.38 | 73.85 | 74.78 | 74.17 | 74.70 |
| 2 | 96.79 | 97.28 | 97.34 | 97.44 | 97.28 to 97.44 | 72.74 | 73.06 | 73.41 | 74.17 |
| 3 | 96.86 | 97.47 | 97.31 | 97.30 | 97.30 to 97.47 | 70.74 | 72.04 | 74.30 | 73.85 |
| 4 | 96.95 | 97.29 | 97.27 | 97.30 | 97.27 to 97.30 | 73.93 | 74.41 | 74.74 | 74.35 |
| 5 | 96.87 | 97.12 | 97.38 | 97.37 | 97.12 to 97.38 | 73.28 | 74.50 | 76.13 | 74.48 |

- **The three orders say the same**: 97.29 (97.12 to 97.47), 97.34 (97.27 to 97.38) and 97.34 (97.27 to 97.44) of all three, and 99.41, 99.42 and 99.39 within reach of the tables. All 15 searches end between 97.12 and 97.47, above the hand-written tables and below the number to beat. Within reach of the tables the highest of the 15 has 99.48, below the hand-written 99.51.
- **A seed's three orders are 0.03 to 0.26 points apart** in all three, and 0.4 to 2.3 points in whole samples.
- **Every one of these 15 searches raises the whole samples of its own seed**, by 0.3 to 3.6 points. As settings the ranges still overlap: 73.76 (72.04 to 74.78), 74.55 (73.41 to 76.13) and 74.31 (73.85 to 74.70) with the search against 72.91 (70.74 to 73.93) without. And it is no property of the search: 2 of its 9 runs on the tuning seeds lost 12 points of whole samples, see [Gradient, then search](#gradient-then-search).

## Where the generic recipe is behind rules written by hand, and where it is ahead

**Ahead:**

- **Code points over all samples.** 97.29% against 96.52%, with all 15 searches above the hand-written tables. Without the search the training alone has 96.87% (96.79 to 96.95), which is above them too.
- **Samples that the hand-written rules leave**: 90.9% against 76.1% of all three in the group "needs a nesting fix", 84.8% against 78.0% in "out of reach", and 99.7% against 99.0% in "needs a line rule".
- **No person wrote a rule.** The recipe is a training of 2 minutes and a search of 2 to 4 minutes on 4 threads, from today's tables and the train samples.

**Behind:**

- **Whole samples, by 6.7 points**: 73.76% against 80.44%, and 85.8% against 93.3% within reach of the tables. No setting moved that: the trained tokenizer reads words in the states of numbers and of literals, and single characters inside them come out as numbers, see [What keeps a sample from being whole](#what-keeps-a-sample-from-being-whole). The whole samples of the best recipe are not told apart from the plain pass's.
- **The group "within reach of the tables", by 0.10 points**: 99.41% (99.29 to 99.48) against 99.51%, with all 15 searches below the hand-written tables. That group is three samples in four.
- **The number to beat, by 0.45 points**: 97.29% against 97.75%. A search that starts from the hand-written tables ends above every search that starts from trained ones. It is also ahead in whole samples, 79.37% against 73.76%. It breaks the depth of valid JSON that is too deep at 18.5% and 30.2% of the code points, where the best recipe breaks none.
- **The search can cost whole samples**, 12 points in 2 of its 9 runs on the tuning seeds, and nothing in the recipe sees that.
- **Nothing can be read off the tables.** The arm `../holes/` showed that trained cells are not a person's decisions. Here e.g. the first seed's tables hold 86 grammar cells with a stack action that does something else than their token does, where the hand-written tables hold 21.
- **What no sample asks for has to be named by a person.** The depth of valid JSON that is too deep and the events of a text's end are kept by two settings that a person added after looking at what training broke. The recipe is generic in its rules of recovery, and not in knowing what must not change. The first of the two costs 0.2 to 0.3 points.

## What the arm does not show

- **Nothing here is a number on unseen data.** Every part of the recipe was chosen with validation scores in view, on the seeds 11, 12 and 13, among 26 trained recipes. The reported runs use other seeds and the same validation split. The test split and its held-out kinds were not scored.
- **Not why training reads words in the states of numbers.** The count says that it does, in every seed that was looked at, and what it costs. The reason given above is a reading of the tables, and no run tested it.
- **Not what removes that.** No weight of the loss did. What was not tried: more states for the tokenizer, which is another arm's question, several trainings of which the one with the most whole samples on the train split is kept, a search that counts whole samples in place of code points, and a loss that stops counting a sample once it is far off.
- **Not how good the trainer gets with more samples.** Four times the samples in one pass were ahead of four passes. Eight times, or several passes over the larger set, were not run.
- **Not a search of the same cells without gradients.** The three searches from today's tables in `../../README.md` go over all 1,326 open cells and try no cell less, where the search here leaves 94 cells alone.
- **Not that the search keeps whole samples.** All 15 searches of the reported seeds raised them, and 2 of the 9 searches of the tuning seeds lost 12 points of them. A search that counts whole samples, or that refuses a change which breaks one, was not tried.
- **Not more than three orders of the search per trained seed.**
- **Not what the two kept settings cost after the search.** The search was only run from the recipe with both.
- **Not how the damage itself should be shown.** The reported tables show almost no added code point as an error, as every table that scores well does, see "Not settled" in `../../README.md`.

## Commands

Run from the repo root. The first four commands make what the report compares with.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/handwritten/rules.ts                # the hand-written tables, which the next command starts from
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/handwritten/tables.json --out $RECOVERY_SCRATCH/search/search-from-handwritten.json   # the number to beat
bun lab/recovery-parser/learn/arms/plain-pass/run.ts              # the plain pass, which the report compares with
bun lab/recovery-parser/learn/arms/generic/run.ts --step reported # the best recipe alone and with the search in three orders, seeds 1 to 5, about 50 minutes
bun lab/recovery-parser/learn/arms/generic/report.ts              # every table above, from the saved runs, a few seconds
bun lab/recovery-parser/learn/arms/generic/whole-samples.ts --step then-search --recipe 0   # what keeps a sample from being whole, for the best recipe with the seeds 11, 12 and 13
bun lab/recovery-parser/learn/arms/generic/check.ts               # the two settings that keep cells or events out, and the plain pass as a recipe, about 40 s
```

The tuning steps, as they were run, each with the seeds 11, 12 and 13. A recipe that an earlier step saved is not run again. The step `combined` of the report has no command of its own: `more-samples` and `then-search` run its two recipes. The first order of `then-search` was run before the reported runs and its two other orders after them, with `--recipes 0,1` and `--recipes 2,3`:

```sh
bun lab/recovery-parser/learn/arms/generic/run.ts --step passes-and-start            # about 8 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step trainer                     # about 14 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step more-steps                  # about 10 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step display-table               # about 5 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step whole-samples               # about 5 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step whole-samples-three-passes  # about 10 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step too-deep                    # about 5 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step end-events                  # about 5 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step more-samples                # about 15 minutes, and 660 MB for the cache of the longer range of samples
bun lab/recovery-parser/learn/arms/generic/run.ts --step then-search                 # about 30 minutes
```

One pass over the standard set takes 23 to 33 s with 4 worker threads and other jobs running, three passes 83 to 100 s, and one pass over four times the samples about 115 s after the samples are loaded.

## Files

- `generic.ts`: the recipe (`Recipe`, `plainPass`, `recipeWith`, `describeRecipe`), the function that builds a recipe's tables for a seed (`buildRecipe`), the two settings that keep something out (`cellsOfTooDeepValidJson`, `ruleOutEndEvents`), the steps, and the best recipe (`bestRecipe`).
- `run.ts`: runs the recipes of a step with the step's seeds and saves them through the harness.
- `report.ts`: the tables of this README and the sentences of every comparison, from the saved records.
- `whole-samples.ts`: what keeps a sample from being whole, from the saved tables of a recipe.
- `check.ts`: the cells of too deep valid JSON keep such a text as today for random settings of every other open cell, no tokenizer cell takes an event of a text's end, and the recipe of the plain pass gives the tables of `../plain-pass/`.
