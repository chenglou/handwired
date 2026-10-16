# Generic: today's tables made to recover, without a rule that a person wrote

The question of this arm, in the words of the person who asked for the experiment: "use some generic recipe/method to turn a non-recovery parser into a recoverable one". So no recovery rule written by a person goes in. The base is today's tables, every open cell may change, and what comes out is read against the 35 rules that a person wrote by hand (`../../handwritten/`) and against the number to beat, the greedy search that starts from those rules. The trainer's plain pass, `../plain-pass/`, is this recipe untuned. This arm asks how good the recipe gets.

Three words, besides the ones of `../../README.md`:

- A **recipe** is one way to make the tables: the trainer's settings, the samples, which cells are kept out, and whether a search follows. `generic.ts` holds a recipe as a value, and its name says what is not as in the plain pass, e.g. "3 passes, uniform start, learning rate 0.1".
- **The best recipe** is the one that the tuning chose, see [The best recipe](#the-best-recipe): one pass of the trainer from a uniform start over four times the samples, with two settings that keep what no sample asks for. Its search is the greedy search of `../../search/` from the trained tables.
- A **step** is a list of recipes that are read next to each other. In a step of the tuning the first recipe is the control of the others.

## What the arm shows

A recipe without a rule written by a person gets above the rules written by hand in the code points of all samples, 97.29% against 96.52%, and stays below the number to beat, 97.75%. It is 0.10 points behind in the group of samples that the tables can label, and 6.7 points behind in whole samples. Its training is what the code points need: the search alone ends 2.8 points lower. In whole samples the ranges of the two overlap, so they are not told apart: 4 of the 15 searches without the training reach the range of the 15 with it, and the other 11 end below it.

The points with their numbers, on the validation split, with the seeds 1 to 5, every reported recipe run once. A number with brackets is the mean of the seeds, with the lowest and the highest. "All three" is the share of the scored code points with the display kind, the depth and the container right.

1. **The best recipe with its search is above the rules written by hand in the code points of all samples, and below the number to beat.** It has 97.29% of all three (97.12 to 97.47), against 96.52% and 97.75%, and neither pair of ranges overlaps. All 15 searches of three orders end between 97.12% and 97.47%. The number to beat is one search in one order, so the 0.45 points are against one draw of an order.
2. **In the group that tables of today's layout can label, it is 0.10 points behind the rules written by hand**: 99.41% (99.29 to 99.48) against 99.51%, with all 15 searches below them.
3. **Whole samples stay 6.7 points behind, and nothing that was tried closes the gap**: 73.76% (72.04 to 74.78) against 80.44%, and 5.9 and 6.1 points behind in the two other orders of the search. The trained tokenizer reads words in the states of numbers and of literals, so characters inside a word are shown as a number or as a literal, e.g. the `e` of `'env'`, which reads the frozen cell (zero, e). Of the wrong code points in the samples with 1 to 10 of them, 49.1% are characters of a string or of a key that are shown so, against 33.3% for the hand-written tables.
4. **The search needs the training for the code points. In whole samples the two are not told apart, and the search alone is far less steady.** The same search from today's tables, over the same cells and in the same 15 orders, ends at 94.53% of all three (88.02 to 95.81): its best order is 1.31 points below the lowest search from trained tables, and none of the 15 reaches the hand-written tables. In whole samples it has 66.28% (55.35 to 74.74) against 74.21% (72.04 to 76.13). The ranges overlap: 4 of its 15 orders have the lowest number of the other 15 or more, and 7 end at 55% to 61%, with nearly every whole sample of one group lost.
5. **Per group, the recipe is ahead of the rules written by hand in the code points of two groups, and the search alone is ahead there too**: 90.91% (89.35 to 91.84) against 76.07% in "needs a nesting fix" and 84.83% (83.72 to 85.76) against 78.04% in "out of reach", in all 15 searches with the training and in all 15 without it. In "needs a line rule" 13 of the 15 searches are above the hand-written tables, and the ranges overlap in two of the three orders. The recipe is behind in "needs a display fix" in all 15 searches, 97.41% (97.18 to 97.63) against 98.20%. In whole samples no search is above the hand-written tables in four of the five groups that have whole samples, e.g. 20.25% (19.41 to 20.88) against 24.32% in "out of reach".
6. **The search counts code points, and it can lose whole samples.** On the reported seeds all 15 searches from trained tables raise the whole samples of their seed, by 0.33 to 3.57 points. On the tuning seeds 2 of 9 lose 12 points of them: one group's whole samples fall from 95% to 2% for one wrong code point per sample.
7. **What the main number does not show is settled by construction, at a cost of 0.2 to 0.3 points of all three.** With 94 grammar cells kept and the events of a text's end ruled out, none of the 20 reported runs of the recipe and none of the 15 searches without the training has a wrong depth on valid JSON that is too deep or a code point shown as past the end, where three passes of the trainer alone break that depth at 60% and 68% of the code points in the two forms of such texts. The cost comes from the kept cells: without the events of a text's end the score is not told apart from its control.
8. **In the tuning, two things were told apart from their control: more steps of Adam under a uniform start, and the search after the training** (+0.50 points, and +0.43 on the reported seeds). The uniform start alone was not told apart. New samples in place of more passes were 0.10 points ahead on the tuning seeds and are not told apart on the reported ones, 96.87% (96.79 to 96.95) against 96.88% (96.79 to 97.03). The learning rate, the temperature, the sharpness cost, the extra targets, the open entries of the display table, a weight per sample and more weight on the first code points after the error were not told apart, or lost something.

## What the arm is

- **The base is today's tables, and nothing reads the hand-written ones.** A recipe may change every open cell of the tokenizer's table and of the grammar's table, 1,326 cells. The best recipe keeps 94 of them, so it may change 1,232. One recipe of the tuning also trains the 140 open entries of the display table. No recipe adds a state, a class or the bit "first on its line".
- **The tables are no tables of the dataset's plain table parser**: they hold grammar cells with a stack action that does something else than their token does, 62 in the first seed of the best recipe and 86 after its search, so the dataset's bound does not hold for them.
- **The tables of a seed are the last ones of its run**, never the best log point. A seed orders the samples of the training and draws the orders of the search.
- **Tuning and reporting use other seeds.** Every recipe of the tuning ran with the seeds 11, 12 and 13, saved under the arm name `generic-tuning`. The best recipe was then fixed and run once with the seeds 1 to 5, under `generic`. Its two controls, the search without the training and the training on the standard set, were added after a review and ran once with the same seeds. All of it was chosen with validation scores in view, so no number here is one on unseen data.

### The best recipe

`bestRecipe` in `generic.ts`, with the search after it:

1. **Train every open cell but 94, once**: one pass from a uniform start over four times the samples, with the trainer's defaults for the rest (learning rate 0.05, batches of 32, temperature 1, no sharpness cost, no extra target, today's display table). "Four times the samples" are the train samples of the indexes 0 to 239,999 of the standard set's seed, made by `loadSamples` as the standard set is, without the test split: 149,742 samples that give the twin a step, against 37,381.
2. **Keep what no sample asks for.** The 94 grammar cells that valid JSON of more than 16 levels reads hold today's choice (`cellsOfTooDeepValidJson`): the 6 cells of an opening bracket at depth 16 where a value may start, and the 88 cells of the row of the state `error`. With them every such text is shown as today, whatever the other open cells hold, which `check.ts` tries with 20 random settings of the open cells. And no tokenizer cell that a code point reads takes an event of a text's end (`ruleOutEndEvents`): the weights of those events start at -Infinity, so snapping never picks one, and no code point is shown as "past the end".
3. **Search from the trained tables**: `searchCells` of `../holes/restricted-search.ts`, which is the search of `../../search/search.ts`, over the 1,232 cells, on the train split of the standard set, in a random order that the seed draws anew for every pass. It tries no event of a text's end and leaves the 94 kept cells alone, so its tables keep both settings.

## Results

The validation split of the standard set, the exact parser: 5,021 broken samples, 425 of them with nothing to recover, 675,949 scored code points. Percentages. `report.ts` prints every table of this section, and for every two rows that are compared here a sentence with both ranges and whether they overlap.

| setting | all three | all three, within reach | whole samples | whole samples, within reach | cells changed against the base | shown as past the end: code points, runs | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers and members after, runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hand-written, the 35 rules of handwritten/rules.ts | 96.52 | 99.51 | 80.44 | 93.35 | 915 | 0, 0 of 1 | 0.0 and 0.0, 0 of 1 |
| search from the hand-written tables | 97.75 | 99.68 | 79.37 | 92.34 | 429 | 0, 0 of 1 | 18.5 and 30.2, 1 of 1 |
| one pass of the trainer from today's tables, defaults | 96.50 (95.88 to 96.74) | 99.11 (98.87 to 99.31) | 73.22 (72.76 to 73.54) | 84.89 (84.09 to 85.71) | 967 (935 to 984) | 50 (0 to 160), 2 of 5 | 3.0 and 4.7, 2 of 5 |
| the best recipe | 96.87 (96.79 to 96.95) | 99.25 (99.21 to 99.34) | 72.91 (70.74 to 73.93) | 84.72 (82.74 to 85.68) | 1023 (1016 to 1028) | 0, 0 of 5 | 0.0 and 0.0, 0 of 5 |
| 4 passes, uniform start, too deep cells kept, no event of a text's end | 96.88 (96.79 to 97.03) | 99.27 (99.15 to 99.45) | 73.98 (72.11 to 75.61) | 85.62 (84.00 to 87.25) | 1022 (1020 to 1024) | 0, 0 of 5 | 0.0 and 0.0, 0 of 5 |
| the best recipe, then searched, order 1 | 97.29 (97.12 to 97.47) | 99.41 (99.29 to 99.48) | 73.76 (72.04 to 74.78) | 85.79 (84.49 to 86.91) | 1033 (1028 to 1037) | 0, 0 of 5 | 0.0 and 0.0, 0 of 5 |
| the best recipe, then searched, order 2 | 97.34 (97.27 to 97.38) | 99.42 (99.36 to 99.45) | 74.55 (73.41 to 76.13) | 86.38 (84.89 to 88.29) | 1032 (1029 to 1037) | 0, 0 of 5 | 0.0 and 0.0, 0 of 5 |
| the best recipe, then searched, order 3 | 97.34 (97.27 to 97.44) | 99.39 (99.34 to 99.47) | 74.31 (73.85 to 74.70) | 86.22 (85.62 to 86.54) | 1031 (1027 to 1038) | 0, 0 of 5 | 0.0 and 0.0, 0 of 5 |
| no training, too deep cells kept, then searched, order 1 | 95.29 (94.87 to 95.74) | 97.99 (97.56 to 98.35) | 64.05 (55.35 to 72.91) | 80.71 (74.28 to 83.78) | 833 (763 to 858) | 0, 0 of 5 | 0.0 and 0.0, 0 of 5 |
| no training, too deep cells kept, then searched, order 2 | 94.75 (93.47 to 95.49) | 97.76 (97.10 to 98.19) | 65.18 (59.14 to 73.32) | 82.23 (80.29 to 84.43) | 809 (782 to 845) | 0, 0 of 5 | 0.0 and 0.0, 0 of 5 |
| no training, too deep cells kept, then searched, order 3 | 93.55 (88.02 to 95.81) | 96.90 (92.53 to 98.53) | 69.60 (59.33 to 74.74) | 82.82 (78.88 to 85.68) | 816 (751 to 855) | 0, 0 of 5 | 0.0 and 0.0, 0 of 5 |
| the 15 searches from the trained tables | 97.32 (97.12 to 97.47) | 99.40 (99.29 to 99.48) | 74.21 (72.04 to 76.13) | 86.13 (84.49 to 88.29) | 1032 (1027 to 1038) | 0, 0 of 15 | 0.0 and 0.0, 0 of 15 |
| the 15 searches from today's tables | 94.53 (88.02 to 95.81) | 97.55 (92.53 to 98.53) | 66.28 (55.35 to 74.74) | 81.92 (74.28 to 85.68) | 819 (751 to 858) | 0, 0 of 15 | 0.0 and 0.0, 0 of 15 |

The rows "no training" are the comparison without gradients: the best recipe's search from today's tables, over the same 1,232 cells, on the same train samples, in the same 15 orders. The row "4 passes" is the best recipe's training with the standard set in four passes in place of four times the samples in one, which are as many steps of the trainer.

- **The search adds 0.43 points to the training that it starts from**, 97.29 (97.12 to 97.47) against 96.87 (96.79 to 96.95), and the ranges do not overlap, in each of the three orders. Within reach of the tables and in whole samples the ranges of the first order overlap: +0.16 and +0.85 points.
- **Against the plain pass** the best recipe with its search has +0.79 points of all three, with ranges that do not overlap. Its whole samples are not told apart from the plain pass's in two of the three orders, 73.76 (72.04 to 74.78) and 74.55 (73.41 to 76.13) against 73.22 (72.76 to 73.54). In the third order the ranges do not overlap, 74.31 (73.85 to 74.70).
- **The search without the training ends 2.79 points lower**, over the 15 orders: 94.53 (88.02 to 95.81) against 97.32 (97.12 to 97.47), and 97.55 (92.53 to 98.53) against 99.40 (99.29 to 99.48) within reach of the tables. Neither pair of ranges overlaps, and every search from today's tables is below the hand-written tables. Its 15 orders are 7.78 points apart, and one of them ends at 88.02, where the 15 from trained tables are 0.35 points apart.
- **In whole samples the search without the training is not told apart from the search with it**: 66.28 (55.35 to 74.74) against 74.21 (72.04 to 76.13) on all samples, and 81.92 (74.28 to 85.68) against 86.13 (84.49 to 88.29) within reach of the tables. Both pairs of ranges overlap. 4 of its 15 orders have the lowest number of the other 15 or more on all samples, and 2 within reach of the tables. The others end below it.
- **Four times the samples are not told apart from the standard set in four passes**: 96.87 (96.79 to 96.95) against 96.88 (96.79 to 97.03), with ranges that overlap, as they do within reach of the tables and in whole samples, 72.91 (70.74 to 73.93) against 73.98 (72.11 to 75.61).
- **What the main number does not show**: none of the 20 runs of the best recipe, without and with its search, has a wrong depth on valid JSON of 17 to 19 levels, shows a code point as past the end or breaks the ground rules on the fixed texts, and 0.0% to 0.2% of the added code points are shown as an error. The same holds for the 15 searches from today's tables, with 0.3% to 4.0% of the added code points shown as an error. The number to beat has a wrong depth at 18.5% and 30.2% of the code points.
- `report.ts` also prints the display kind, the depth and the container alone for every row, next to the baselines of `../baselines.ts`.

All three per group of the dataset, against the hand-written tables:

| samples | hand-written | the best recipe | the best recipe, then searched, order 1 | the 15 searches from the trained tables, against the hand-written tables | no training, too deep cells kept, then searched, order 1 | the 15 searches from today's tables, against the hand-written tables |
| --- | --- | --- | --- | --- | --- | --- |
| all, 5021 | 96.52 | 96.87 (96.79 to 96.95) | 97.29 (97.12 to 97.47) | 15 above, 0 below | 95.29 (94.87 to 95.74) | 0 above, 15 below |
| within reach of the tables, 3687 | 99.51 | 99.25 (99.21 to 99.34) | 99.41 (99.29 to 99.48) | 0 above, 15 below | 97.99 (97.56 to 98.35) | 0 above, 15 below |
| needs a display fix, 37 | 98.20 | 96.94 (96.24 to 97.42) | 97.41 (97.18 to 97.63) | 0 above, 15 below | 93.06 (91.79 to 94.56) | 0 above, 15 below |
| needs a line rule, 488 | 98.98 | 98.85 (98.79 to 98.92) | 99.67 (98.94 to 99.92) | 13 above, 2 below | 99.11 (98.29 to 99.67) | 8 above, 7 below |
| needs a character class, 326 | 92.24 | 91.16 (90.86 to 91.45) | 92.27 (91.74 to 93.46) | 10 above, 5 below | 83.88 (81.62 to 85.84) | 0 above, 15 below |
| needs a nesting fix, 76 | 76.07 | 89.48 (88.96 to 90.24) | 90.91 (89.35 to 91.84) | 15 above, 0 below | 89.21 (80.30 to 92.67) | 15 above, 0 below |
| out of reach, 407 | 78.04 | 83.72 (83.50 to 83.94) | 84.83 (83.72 to 85.76) | 15 above, 0 below | 84.67 (83.05 to 85.61) | 15 above, 0 below |

Whole samples per group, in percent of the group's samples with something to recover:

| samples | hand-written | the best recipe | the best recipe, then searched, order 1 | the 15 searches from the trained tables, against the hand-written tables | no training, too deep cells kept, then searched, order 1 | the 15 searches from today's tables, against the hand-written tables |
| --- | --- | --- | --- | --- | --- | --- |
| all, 5021 | 80.44 | 72.91 (70.74 to 73.93) | 73.76 (72.04 to 74.78) | 0 above, 15 below | 64.05 (55.35 to 72.91) | 0 above, 15 below |
| within reach of the tables, 3687 | 93.35 | 84.72 (82.74 to 85.68) | 85.79 (84.49 to 86.91) | 0 above, 15 below | 80.71 (74.28 to 83.78) | 0 above, 15 below |
| needs a display fix, 37 | 0.00 | 0.00 (0.00 to 0.00) | 0.00 (0.00 to 0.00) | 0 above, 0 below | 0.00 (0.00 to 0.00) | 0 above, 0 below |
| needs a line rule, 488 | 97.95 | 94.51 (88.93 to 96.72) | 95.49 (89.55 to 97.95) | 0 above, 14 below | 39.14 (0.20 to 97.13) | 0 above, 15 below |
| needs a character class, 326 | 15.64 | 6.07 (5.52 to 7.06) | 6.13 (3.99 to 7.06) | 0 above, 15 below | 9.26 (5.21 to 14.11) | 0 above, 15 below |
| needs a nesting fix, 76 | 31.58 | 34.21 (32.89 to 35.53) | 30.53 (23.68 to 34.21) | 5 above, 4 below | 32.89 (28.95 to 40.79) | 6 above, 5 below |
| out of reach, 407 | 24.32 | 19.71 (16.95 to 21.62) | 20.25 (19.41 to 20.88) | 0 above, 15 below | 15.97 (14.74 to 16.95) | 0 above, 15 below |

- **Ahead of the hand-written tables in code points: "needs a nesting fix" and "out of reach"**, in all 15 searches, and already without the search, 89.48 (88.96 to 90.24) and 83.72 (83.50 to 83.94). The search without the training is above the hand-written tables there too, in all of its 15 orders, so the training is not what gives that lead.
- **"Needs a line rule" is not told apart**: 99.67 (98.94 to 99.92) against 98.98 in the first order, with ranges that overlap. 13 of the 15 searches are above, and the training alone is below in each of its 5 seeds, 98.85 (98.79 to 98.92). In whole samples the group is behind: no search is above the hand-written 97.95, and 14 are below.
- **Behind in code points: within reach of the tables and "needs a display fix"**, in all 15 searches. "Needs a character class" is not told apart, 92.27 (91.74 to 93.46) against 92.24, with 10 searches above and 5 below.
- **Behind in whole samples in four of the five groups that have whole samples.** No search is above the hand-written tables within reach of the tables, 85.79 (84.49 to 86.91) against 93.35, in "needs a line rule", in "needs a character class", 6.13 (3.99 to 7.06) against 15.64, or in "out of reach", 20.25 (19.41 to 20.88) against 24.32. In "needs a nesting fix" 5 searches are above and 4 below. No tables have a whole sample in "needs a display fix".
- **Where the training is told apart from the search alone**, over the 15 orders of each: on all samples, within reach of the tables, in "needs a display fix", 97.31 (96.92 to 97.63) against 90.56 (71.05 to 95.98), and in "needs a character class", 92.36 (91.19 to 93.46) against 80.27 (53.73 to 86.69). In the three other groups the ranges overlap.

The searches seed by seed. Every search of a seed with the training starts from the same trained tables, and every search without it from today's tables. All three on all samples:

| seed | the best recipe | the best recipe, then searched, order 1 | the best recipe, then searched, order 2 | the best recipe, then searched, order 3 | no training, too deep cells kept, then searched, order 1 | no training, too deep cells kept, then searched, order 2 | no training, too deep cells kept, then searched, order 3 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 96.86 | 97.30 | 97.38 | 97.27 | 95.34 | 93.47 | 95.06 |
| 2 | 96.79 | 97.28 | 97.34 | 97.44 | 95.47 | 94.99 | 93.59 |
| 3 | 96.86 | 97.47 | 97.31 | 97.30 | 95.74 | 94.94 | 95.27 |
| 4 | 96.95 | 97.29 | 97.27 | 97.30 | 95.04 | 95.49 | 88.02 |
| 5 | 96.87 | 97.12 | 97.38 | 97.37 | 94.87 | 94.84 | 95.81 |

Whole samples:

| seed | the best recipe | the best recipe, then searched, order 1 | the best recipe, then searched, order 2 | the best recipe, then searched, order 3 | no training, too deep cells kept, then searched, order 1 | no training, too deep cells kept, then searched, order 2 | no training, too deep cells kept, then searched, order 3 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 73.85 | 74.78 | 74.17 | 74.70 | 71.63 | 59.14 | 73.65 |
| 2 | 72.74 | 73.06 | 73.41 | 74.17 | 59.75 | 60.60 | 71.67 |
| 3 | 70.74 | 72.04 | 74.30 | 73.85 | 60.62 | 73.32 | 59.33 |
| 4 | 73.93 | 74.41 | 74.74 | 74.35 | 72.91 | 71.48 | 68.62 |
| 5 | 73.28 | 74.50 | 76.13 | 74.48 | 55.35 | 61.36 | 74.74 |

- **From the trained tables the order of the cells moves little**: a seed's three orders are 0.04 to 0.26 points apart in all three and 0.39 to 2.26 points in whole samples. Each of the 15 searches raises both numbers of its seed, all three by 0.25 to 0.65 points and whole samples by 0.33 to 3.57.
- **That the search raises whole samples is no property of the search.** On the tuning seeds 2 of its 9 runs lost 12.4 and 12.7 points of them, see [How the best recipe was chosen](#how-the-best-recipe-was-chosen). And in 7 of the 15 searches from today's tables fewer than half of the samples of the group "needs a line rule" are whole: those 7 have 55.35% to 61.36% of whole samples on all samples, and the other 8 have 68.62% to 74.74%. None of the 15 searches from trained tables lost that group.

## What keeps a sample from being whole

`whole-samples.ts` counts it, here for the best recipe with its search in the first order, as the mean of the seeds 1 to 5, next to the hand-written tables:

| wrong code points in a sample | the recipe, % of the samples | hand-written, % of the samples |
| --- | --- | --- |
| none, a whole sample | 73.8 | 80.4 |
| 1 | 6.1 | 3.8 |
| 2 or 3 | 5.2 | 3.4 |
| 4 to 10 | 7.7 | 4.9 |
| 11 or more | 7.3 | 7.5 |

So what the trained tables have more of is samples that are almost right: 19.0% of the samples have 1 to 10 wrong code points, against 12.1% for the hand-written tables. Those are 871 samples with 3,149 wrong code points for the recipe and 556 samples with 2,025 for the hand-written tables:

| of the wrong code points of those samples | the recipe, % | hand-written, % |
| --- | --- | --- |
| among the first 3 scored code points | 22.1 | 21.9 |
| among the last 3 scored code points | 3.9 | 4.8 |
| in between | 74.0 | 73.3 |
| the display kind alone is wrong | 85.5 | 83.5 |
| the depth or the container alone is wrong | 10.7 | 10.6 |
| both are wrong | 3.8 | 5.9 |
| the label's display kind is string | 44.0 | 34.3 |
| the label's display kind is key | 38.0 | 32.7 |
| the code point's class is e | 16.7 | 3.7 |
| the code point is shown as a number | 30.2 | 12.1 |
| the code point is shown as a literal | 20.0 | 21.5 |
| the label's display kind is string or key, and the code point is shown as a number or as a literal | 49.1 | 33.3 |
| the tokenizer is in a state of a number or of a literal before the code point | 57.2 | 11.6 |
| in such a state, and the code point reads a frozen tokenizer cell | 31.2 | 6.6 |
| the code point reads a frozen tokenizer cell | 66.1 | 54.5 |

- **It is neither the first code points after the error nor the last ones.** Three wrong code points in four are in between, as for the hand-written tables.
- **It is words that the tokenizer reads as numbers and as literals.** E.g. in `{'env': 'test', 'host': 'cache-2.internal'}`, whose original has double quotes, all 20 reported tables show the `e` of `env` as a number and the letters around it as a key. Their tokenizer goes to the state `zero` at the `'`, the state after the digit 0, and the letter `e` then reads the cell (zero, e), which is frozen: valid JSON reads it in `0e5`, where it starts an exponent and is shown as a number. Two of the five seeds also show the `-2` of `cache-2.internal` as a number, since (exponent, minus) is frozen too. 57.2% of the wrong code points of the almost right samples come while the tokenizer is in a state of a number or of a literal, against 11.6% for the hand-written tables, which read such words in the state `errorLine`, where every cell is open. Of all scored code points, right or wrong, 17.5% come in such a state, against 7.0%.
- **What such a code point is shown as**: 30.2% of the wrong code points are shown as a number, against 12.1%, and 49.1% are characters of a string or of a key that are shown as a number or as a literal, against 33.3%. Those are 1,545 wrong code points against 674, about three quarters of the 1,124 that the recipe has more than the hand-written tables in these samples. The case of the example, such a state and a frozen cell, is 31.2% against 6.6%.
- **The count is the same for the other tables of the recipe**: 57.6% in such a state without the search, 57.4% and 56.3% with the two other orders, and 57.1% for the seeds 11, 12 and 13 without the search.
- **Why training ends there is a reading of the tables, and no run tested it.** In a state of a number the cells of white space and of punctuation are frozen and already end the token as a word should end, so a few open cells are enough to make the state read letters. The state `errorLine` has no such cell, and its cells are also the ones that a comment up to the end of its line needs. A person wrote every cell of one state for words. Training takes the states that are nearly there, and the characters whose cells are frozen then come out wrong.
- **Which kinds of damage lose whole samples**: strings in single quotes, 8.6% whole against 44.1% for the hand-written tables, 118 samples, then literals of other languages such as `None` (45.8% against 76.8%, 71 samples), a backslash that is not escaped (28), a string that is left open in the middle of its line (26), a key without quotes (24), the document inside a line of code, e.g. after `const data = ` (22), and a raw line feed in a string (22). The command prints every kind.

## How the best recipe was chosen

Every recipe that was tried is a row of this table: 26 trained ones, and the search after one of them in three orders. The seeds 11, 12 and 13, as the mean and in brackets the lowest and the highest. "The best recipe" is the name of "1 pass, uniform start, too deep cells kept, no event of a text's end, 4 times the samples". The two rows that every step is read against are the hand-written tables, 96.52, 99.51, 80.44 and 93.35 in the first four columns, and the number to beat, 97.75, 99.68, 79.37 and 92.34.

| setting | all three | all three, within reach | whole samples | whole samples, within reach | cells changed against the base | shown as past the end: code points, runs | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers and members after, runs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 pass, start at today's choice | 96.23 (96.07 to 96.50) | 98.88 (98.74 to 99.07) | 72.33 (71.19 to 73.56) | 84.11 (83.14 to 85.35) | 974 (969 to 983) | 0, 0 of 3 | 8.8 and 9.8, 3 of 3 |
| 1 pass, uniform start | 96.32 (95.97 to 96.72) | 99.16 (98.91 to 99.32) | 71.27 (70.80 to 71.80) | 83.18 (82.62 to 83.51) | 1159 (1156 to 1162) | 0, 0 of 3 | 79.1 and 85.1, 3 of 3 |
| 3 passes, start at today's choice | 96.65 (96.46 to 96.94) | 98.99 (98.87 to 99.24) | 71.73 (71.13 to 72.15) | 83.35 (82.77 to 83.72) | 1040 (1033 to 1048) | 224 (216 to 236), 3 of 3 | 17.0 and 20.0, 3 of 3 |
| 3 passes, uniform start | 96.91 (96.90 to 96.92) | 99.29 (99.24 to 99.33) | 72.58 (71.32 to 74.85) | 84.56 (83.42 to 86.79) | 1159 (1155 to 1163) | 38 (0 to 115), 1 of 3 | 60.4 and 67.5, 3 of 3 |
| 1 pass, uniform start, learning rate 0.02 | 95.81 (95.71 to 95.86) | 98.98 (98.96 to 99.01) | 65.30 (64.66 to 65.75) | 74.69 (74.03 to 75.20) | 1157 (1156 to 1158) | 0, 0 of 3 | 72.2 and 80.7, 3 of 3 |
| 1 pass, uniform start, learning rate 0.1 | 96.62 (96.41 to 96.84) | 99.00 (98.89 to 99.16) | 70.55 (65.45 to 73.13) | 81.44 (74.92 to 85.07) | 1160 (1159 to 1161) | 0, 0 of 3 | 92.6 and 92.9, 3 of 3 |
| 1 pass, uniform start, learning rate 0.2 | 96.03 (95.58 to 96.51) | 98.60 (98.20 to 98.95) | 68.51 (63.32 to 73.61) | 79.09 (71.77 to 85.04) | 1160 (1159 to 1161) | 63 (0 to 188), 1 of 3 | 91.1 and 92.1, 3 of 3 |
| 1 pass, uniform start, temperature falls to 0.5 | 96.52 (96.04 to 96.77) | 99.08 (98.74 to 99.27) | 71.68 (70.34 to 72.72) | 83.35 (82.37 to 83.94) | 1158 | 2 (0 to 6), 1 of 3 | 86.0 and 88.9, 3 of 3 |
| 1 pass, uniform start, temperature falls to 0.2 | 95.97 (95.55 to 96.56) | 98.74 (98.45 to 99.17) | 68.62 (62.10 to 74.19) | 78.89 (70.42 to 85.53) | 1159 (1158 to 1160) | 0, 0 of 3 | 85.8 and 81.4, 3 of 3 |
| 1 pass, uniform start, sharpness cost 0.01 | 96.29 (95.90 to 96.70) | 99.16 (98.92 to 99.29) | 71.08 (70.71 to 71.28) | 82.96 (82.68 to 83.38) | 1160 (1158 to 1162) | 0, 0 of 3 | 78.9 and 85.8, 3 of 3 |
| 1 pass, uniform start, extra targets 0.3 | 96.02 (95.59 to 96.55) | 99.09 (98.85 to 99.22) | 68.79 (64.97 to 70.80) | 80.03 (74.59 to 82.86) | 1144 (1142 to 1145) | 0, 0 of 3 | 74.2 and 85.0, 3 of 3 |
| 1 pass, uniform start, batches of 8 | 96.86 (96.75 to 97.03) | 99.22 (98.99 to 99.40) | 74.02 (73.96 to 74.15) | 85.64 (85.22 to 85.96) | 1156 (1154 to 1160) | 47 (0 to 113), 2 of 3 | 42.7 and 47.9, 3 of 3 |
| 1 pass, uniform start, batches of 128 | 95.68 (95.58 to 95.83) | 99.02 (98.90 to 99.11) | 65.11 (64.62 to 65.51) | 74.48 (73.79 to 74.92) | 1158 (1157 to 1160) | 0, 0 of 3 | 98.5 and 99.3, 3 of 3 |
| 3 passes, uniform start, batches of 8 | 96.81 (96.54 to 97.10) | 99.10 (98.78 to 99.39) | 74.12 (73.17 to 75.17) | 85.65 (84.33 to 86.79) | 1150 (1144 to 1155) | 469 (0 to 1389), 2 of 3 | 25.2 and 19.5, 3 of 3 |
| 3 passes, uniform start, learning rate 0.1 | 96.80 (96.63 to 97.00) | 99.09 (99.02 to 99.24) | 73.40 (73.09 to 73.63) | 85.03 (84.86 to 85.25) | 1160 (1156 to 1164) | 7 (0 to 21), 2 of 3 | 58.7 and 65.1, 3 of 3 |
| 3 passes, uniform start, display table open | 96.99 (96.85 to 97.10) | 98.92 (98.78 to 99.10) | 73.98 (69.08 to 76.98) | 85.11 (78.57 to 89.09) | 1249 (1245 to 1253) | 0, 0 of 3 | 56.7 and 62.5, 3 of 3 |
| 1 pass, uniform start, every sample weighs the same | 96.44 (96.33 to 96.55) | 98.82 (98.67 to 99.02) | 73.87 (72.82 to 75.20) | 85.19 (83.97 to 86.51) | 1157 (1156 to 1159) | 0, 0 of 3 | 69.6 and 76.6, 3 of 3 |
| 1 pass, uniform start, sample weight power 0.5 | 96.40 (96.15 to 96.81) | 98.91 (98.45 to 99.34) | 73.67 (73.24 to 73.96) | 85.33 (84.92 to 85.53) | 1157 (1153 to 1161) | 0, 0 of 3 | 78.4 and 85.2, 3 of 3 |
| 1 pass, uniform start, the first 8 code points weigh 4 times | 96.08 (95.48 to 96.77) | 99.05 (98.70 to 99.28) | 72.29 (70.71 to 74.22) | 84.40 (82.89 to 86.02) | 1158 (1157 to 1160) | 22 (0 to 67), 1 of 3 | 76.7 and 84.5, 3 of 3 |
| 3 passes, uniform start, every sample weighs the same | 96.52 (96.29 to 96.65) | 98.87 (98.69 to 99.18) | 73.87 (72.54 to 74.85) | 85.22 (83.81 to 86.11) | 1151 (1148 to 1153) | 0, 0 of 3 | 52.1 and 54.0, 3 of 3 |
| 3 passes, uniform start, sample weight power 0.5 | 96.76 (96.50 to 96.92) | 99.08 (98.74 to 99.28) | 74.18 (73.98 to 74.52) | 85.90 (85.56 to 86.24) | 1155 (1154 to 1156) | 31 (0 to 93), 1 of 3 | 50.3 and 51.4, 3 of 3 |
| 3 passes, uniform start, too deep cells kept | 96.69 (96.61 to 96.75) | 99.21 (99.16 to 99.24) | 73.01 (71.02 to 74.13) | 84.88 (83.29 to 85.84) | 1068 (1063 to 1073) | 91 (0 to 204), 2 of 3 | 0.0 and 0.0, 0 of 3 |
| 3 passes, uniform start, no event of a text's end | 96.86 (96.62 to 97.05) | 99.23 (99.08 to 99.31) | 73.31 (72.58 to 74.70) | 85.17 (84.49 to 86.48) | 1103 (1098 to 1107) | 0, 0 of 3 | 56.1 and 60.9, 3 of 3 |
| 4 passes, uniform start | 96.92 (96.88 to 96.95) | 99.34 (99.31 to 99.41) | 73.38 (72.45 to 74.00) | 85.38 (84.40 to 86.05) | 1160 (1155 to 1163) | 37 (0 to 112), 1 of 3 | 46.2 and 52.4, 3 of 3 |
| 1 pass, uniform start, 4 times the samples | 97.02 (96.97 to 97.09) | 99.35 (99.29 to 99.40) | 73.66 (72.54 to 74.46) | 85.26 (84.12 to 85.99) | 1161 (1160 to 1163) | 33 (0 to 98), 1 of 3 | 8.0 and 9.3, 2 of 3 |
| the best recipe | 96.68 (96.25 to 96.92) | 99.23 (99.16 to 99.28) | 72.30 (71.50 to 73.83) | 84.14 (83.35 to 85.68) | 1024 (1022 to 1026) | 0, 0 of 3 | 0.0 and 0.0, 0 of 3 |
| the best recipe, then searched, order 1 | 97.18 (97.15 to 97.23) | 99.32 (99.18 to 99.43) | 75.01 (74.56 to 75.39) | 87.01 (86.70 to 87.43) | 1036 (1033 to 1041) | 0, 0 of 3 | 0.0 and 0.0, 0 of 3 |
| the best recipe, then searched, order 2 | 97.27 (97.22 to 97.36) | 99.39 (99.38 to 99.42) | 69.43 (61.44 to 74.63) | 84.56 (82.99 to 86.36) | 1035 (1031 to 1037) | 0, 0 of 3 | 0.0 and 0.0, 0 of 3 |
| the best recipe, then searched, order 3 | 97.15 (97.08 to 97.19) | 99.34 (99.24 to 99.40) | 69.37 (61.10 to 75.07) | 84.58 (82.40 to 87.40) | 1032 (1029 to 1034) | 0, 0 of 3 | 0.0 and 0.0, 0 of 3 |

`report.ts` prints the rows step by step, each recipe against its step's control. What the steps said:

- **The passes and the start** (the first four rows, every pair compared). Three passes from a uniform start are told apart from the plain pass, the first row: +0.68 points on all samples and +0.41 within reach of the tables, and neither pair of ranges overlaps. The two differ in two things. Of the two alone, the passes are told apart under a uniform start, 96.91 (96.90 to 96.92) against 96.32 (95.97 to 96.72). **The start alone is not told apart on all samples**, at one pass, 96.32 (95.97 to 96.72) against 96.23 (96.07 to 96.50), or at three, 96.91 (96.90 to 96.92) against 96.65 (96.46 to 96.94). Within reach of the tables the two starts at three passes are 15 of 462,419 code points apart, 99.29 (99.24 to 99.33) against 98.99 (98.87 to 99.24): the ranges do not overlap, by a margin that is no result. Whole samples are not told apart in any pair. A uniform start breaks the depth of valid JSON that is too deep at 60% to 85% of the code points, where the start at today's choice breaks it at 9% to 20%.
- **The other settings of the trainer, on one pass from a uniform start.** What moves the score is how many steps Adam takes. A pass has 1,169 steps with batches of 32. With batches of 8 it has four times as many and ends at 96.86 (96.75 to 97.03), above every seed of its control, with 74.02% of whole samples against 71.27%, and neither pair of ranges overlaps. With batches of 128 or a learning rate of 0.02 it ends at 95.7 to 95.8 with 65% of whole samples. The temperature, the sharpness cost and the extra targets are not told apart from the control on all samples, as in the arm `../holes/`.
- **On three passes neither smaller batches nor a larger learning rate is ahead any more**: the score has stopped rising at about 96.9, and smaller batches show up to 1,389 code points as past the end. So the trainer's setting is three passes from a uniform start with every other default, and it is the control of the next steps.
- **The open entries of the display table lose 0.38 points within reach of the tables**, 98.92 (98.78 to 99.10) against 99.29 (99.24 to 99.33), with ranges that do not overlap, and are not told apart on all samples. They are not in the best recipe.
- **A weight per sample moves whole samples on one pass and not on three.** The loss counts code points, so a long sample weighs more than a short one. With `sampleWeightPower` every loss of a sample is divided by (its scored code points) ^ power, so that 1 makes every sample weigh the same. On one pass that gives 73.87 (72.82 to 75.20) of whole samples against 71.27 (70.80 to 71.80), and the power 0.5 gives 73.67 (73.24 to 73.96). Neither range overlaps with the control's. What comes back are kinds of damage with short texts, e.g. a key without its colon is whole in 98.0% of its samples against 77.2%, and a stray closing bracket in 68.3% against 39.0% (`whole-samples.ts --step whole-samples --recipe 1` and `--recipe 0`). Strings in single quotes stay at 6.1% against 4.9%, where the hand-written tables have 44.1%. On three passes the gain is +1.3 and +1.6 points with ranges that overlap, and with every sample weighing the same all three falls by 0.39 points, with ranges that do not overlap. So the weight is not in the best recipe. Four times the weight on the first 8 scored code points after the error is not told apart from its control in any of the four comparisons.
- **Keeping the 94 cells of too deep valid JSON settles that depth in every seed, and costs 0.22 points of all three**: 96.69 (96.61 to 96.75) against 96.91 (96.90 to 96.92), and 0.08 within reach of the tables, with ranges that do not overlap in either row. The cost is the state `error` itself: with its row kept, a recovery can no longer use it as one of its 8 grammar states, since nothing leads out of it. The setting is in the best recipe: tables that break valid JSON for a fifth of a point are not a recovery that anyone would ship, and the hand-written rules keep that depth too.
- **Without the events of a text's end no code point is shown as past the end, and the score is not told apart from the control** in any of the four comparisons: -0.05 points on all samples with ranges that overlap.
- **New samples in place of repeated ones are a hint, not a result.** Four times the samples in one pass have 97.02 (96.97 to 97.09) against 96.92 (96.88 to 96.95) for the standard set in four passes: the ranges are 0.02 points apart, with 3 seeds each, in one of the 124 comparisons that the report prints for the tuning. The control on the seeds 1 to 5 does not tell the two apart, see [Results](#results), so the larger set is in the best recipe without a gain that held on other seeds. A fourth pass over the standard set adds nothing to three, 96.92 against 96.91.
- **The parts put together** are the best recipe, 96.68 (96.25 to 96.92). The two kept settings cost 0.34 points against the same pass without them, 97.02 (96.97 to 97.09), with ranges that do not overlap, and give no wrong depth and no code point past the end in any seed.
- **The search after the training** adds 0.50 points in its first order, 97.18 (97.15 to 97.23) against 96.68 (96.25 to 96.92), and 2.7 points of whole samples, 75.01 (74.56 to 75.39) against 72.30 (71.50 to 73.83), and neither pair of ranges overlaps. The best recipe was fixed with this order alone. The two other orders were run after the reported runs, and they end at 97.27 and 97.15 of all three with 69.43% and 69.37% of whole samples: in one seed of each, the whole samples fall from 73.83% to 61.44% and 61.10%. In the group "needs a line rule" they go from 95.1% to 1.6% and 2.0% there, while the group's all three stays at 99.2% and 98.9%: one code point is wrong in almost every sample of the group, and the search took the cell because it has more code points right elsewhere.

**The parts were tuned one at a time** and then put together, with one run of the whole on the tuning seeds. No setting of the whole recipe was tuned, e.g. the passes of the trainer when a search follows.

## What the arm does not show

- **Nothing here is a number on unseen data.** Every part of the recipe was chosen with validation scores in view, on the seeds 11, 12 and 13, among 26 trained recipes. The reported runs use other seeds and the same validation split. The test split and its held-out kinds were not scored.
- **Not how far the number to beat moves with the order of its cells.** It is one search in one order over all 1,326 open cells. The 15 orders of the search from today's tables are 7.78 points apart and the 15 from trained tables 0.35 points, and which of the two a search from the hand-written tables is like was not run. So the 0.45 points between the best recipe and the number to beat are against one draw of an order.
- **Not why training reads words in the states of numbers.** The count says that it does, in every seed that was looked at, and what it costs. The reason given above is a reading of the tables.
- **Not what removes that.** No weight of the loss did. What was not tried: more states for the tokenizer, which is another arm's question, several trainings of which the one with the most whole samples on the train split is kept, a search that counts whole samples in place of code points, and a loss that stops counting a sample once it is far off.
- **Not how good the trainer gets with more samples.** Eight times the samples, or several passes over the larger set, were not run.
- **Not that the search keeps whole samples.** A search that counts whole samples, or that refuses a change which breaks one, was not tried.
- **Not more than three orders of the search per trained seed**, and no control of the search on the tuning seeds.
- **Not what the two kept settings cost after the search.** The search was only run from the recipe with both.
- **Not how the damage itself should be shown.** The reported tables show almost no added code point as an error, as every table that scores well does, see "Not settled" in `../../README.md`.

## Commands

Run from the repo root. The first three commands make what the report compares with.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/handwritten/rules.ts                # the hand-written tables, which the next command starts from
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/handwritten/tables.json --out $RECOVERY_SCRATCH/search/search-from-handwritten.json   # the number to beat
bun lab/recovery-parser/learn/arms/plain-pass/run.ts              # the plain pass
bun lab/recovery-parser/learn/arms/generic/run.ts --step reported # the best recipe alone and with the search in three orders, seeds 1 to 5, about 50 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step reported-controls   # the 15 searches from today's tables and the 4 passes over the standard set, seeds 1 to 5, about 75 minutes
bun lab/recovery-parser/learn/arms/generic/report.ts              # every table above but the two of whole-samples.ts, and every comparison, from the saved runs, a few seconds
bun lab/recovery-parser/learn/arms/generic/whole-samples.ts --step reported --recipe 1   # what keeps a sample from being whole, for the best recipe with its search in the first order
bun lab/recovery-parser/learn/arms/generic/check.ts               # the two settings that keep cells or events out, and the plain pass as a recipe, about 40 s. check-all.ts runs it too
```

The tuning steps in the order in which they were run, each with the seeds 11, 12 and 13. A recipe that an earlier step saved is not run again. The step `combined` of the report has no command of its own: `more-samples` and `then-search` run its two recipes. The first order of `then-search` was run before the reported runs and its two other orders after them, with `--recipes 0,1` and `--recipes 2,3`:

```sh
bun lab/recovery-parser/learn/arms/generic/run.ts --step passes-and-start            # about 8 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step trainer                     # about 14 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step display-table               # about 5 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step more-steps                  # about 10 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step whole-samples               # about 5 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step too-deep                    # about 5 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step end-events                  # about 5 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step more-samples                # about 15 minutes, and 660 MB for the cache of the longer range of samples
bun lab/recovery-parser/learn/arms/generic/run.ts --step whole-samples-three-passes  # about 10 minutes
bun lab/recovery-parser/learn/arms/generic/run.ts --step then-search                 # about 30 minutes
```

One pass over the standard set takes 23 to 33 s with 4 worker threads and other jobs running, three passes 83 to 100 s, and one pass over four times the samples about 115 s after the samples are loaded. A search from trained tables takes 102 to 225 s, in 8 to 16 passes over the cells and 797 to 1,072 changes of a cell, over the 24 searches. A search from today's tables takes 113 to 422 s, in 16 to 29 passes and 2,362 to 4,588 changes, over the 15 searches.

## Files

- `generic.ts`: the recipe (`Recipe`, `plainPass`, `recipeWith`, `describeRecipe`), the function that builds a recipe's tables for a seed (`buildRecipe`), the two settings that keep something out (`cellsOfTooDeepValidJson`, `ruleOutEndEvents`), the best recipe (`bestRecipe`) with its searches and its two controls, and the steps.
- `run.ts`: runs the recipes of a step with the step's seeds and saves them through the harness.
- `report.ts`: the tables of this README and the sentences of every comparison, from the saved records.
- `whole-samples.ts`: what keeps a sample from being whole, from the saved tables of a recipe.
- `check.ts`: the cells of too deep valid JSON keep such a text as today for random settings of every other open cell, no tokenizer cell takes an event of a text's end, the recipe of the plain pass gives the tables of `../plain-pass/`, and a recipe without a training gives today's tables.
