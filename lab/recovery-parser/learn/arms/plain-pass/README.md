# The trainer's plain pass, with 5 seeds

This arm is one pass of the trainer of `../../soft/train.ts` over the train split, from today's tables, with every default: every open cell is trainable, the mixes start with a share of 0.9 on today's choice, no extra target, no temperature schedule. Nothing is tuned. It is here for two things: to say how far two seeds of one setting are apart, before any other arm is read, and as the shortest example of an arm.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/arms/plain-pass/run.ts              # 5 seeds, about 2.5 minutes
```

**What the arm is.** It may change every open cell of the tokenizer's table and of the grammar's table, 1,326 cells. Its tables have today's states and classes, no bit, and today's display table. They are no tables of the dataset's plain table parser: the first seed's tables hold 24 grammar cells with a stack action that does something else than their token does, so the dataset's bound, 97.94% of all three, does not hold for them. A seed decides the order of the samples and nothing else. The tables of a seed are the last ones of its run. Nothing was chosen on the validation split.

## Result

The validation split of the standard set, the exact parser: 4,878 broken samples, 375 of them with nothing to recover, 675,695 scored code points. Percentages, as the mean and in brackets the lowest and the highest of the 5 seeds.

| | all three | display kind | depth | container | whole samples | cells changed against the base |
| --- | --- | --- | --- | --- | --- | --- |
| one pass of the trainer from today's tables, defaults | 96.62 (96.23 to 96.92) | 98.26 (98.02 to 98.46) | 98.21 (97.85 to 98.35) | 99.79 (99.78 to 99.80) | 72.23 (71.29 to 73.22) | 980 (976 to 990) |

The seeds one by one, all three: 96.60, 96.92, 96.82, 96.53, 96.23.

All three per group of the dataset:

| within reach of the tables | needs a display fix | needs a line rule | needs a character class | needs a nesting fix | out of reach |
| --- | --- | --- | --- | --- | --- |
| 99.0 (98.7 to 99.2) | 96.6 (95.6 to 97.2) | 99.8 (99.7 to 99.9) | 89.8 (88.0 to 91.1) | 91.9 (91.6 to 92.1) | 82.9 (81.1 to 84.0) |

What the main number does not show:

| added code points shown as an error | samples that show an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after |
| --- | --- | --- | --- | --- |
| 0.9 (0.7 to 1.1) | 5.7 (3.2 to 9.2) | 7 (0 to 20) | 3.0 (0.0 to 8.1) | 4.8 (0.0 to 9.4) |

The ground rules hold on the fixed texts for all 5 seeds.

## What it says

- **Two seeds of this setting are up to 0.69 points apart**, 96.23% to 96.92%. A difference of that size between two arms with one seed each is no difference.
- The mean is 0.1 points above the hand-written tables (96.51%), and the two are not told apart: the hand-written tables lie inside the range of the seeds. It is 1.1 points below the search from the hand-written tables (97.71%), which is the number to beat, see `../../search/README.md`.
- The trainer has more code points right than the hand-written tables in the groups "needs a nesting fix" (91.9% against 76.1%) and "out of reach" (82.9% against 78.0%), and fewer whole samples overall (72.23% against 80.04%).
- What the main number does not show differs from seed to seed: two seeds show 20 and 13 code points as past the end and three show none, and the depth of valid JSON that is too deep is right in both forms for one seed and wrong at up to 9.4% of the code points for the others. Nothing in the loss asks for either.
