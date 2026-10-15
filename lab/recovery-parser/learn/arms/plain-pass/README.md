# The trainer's plain pass, with 5 seeds

This arm is one pass of the trainer of `../../soft/train.ts` over the train split, from today's tables, with every default: every open cell is trainable, the mixes start with a share of 0.9 on today's choice, no extra target, no temperature schedule. Nothing is tuned. It is here for two things: to say how far two seeds of one setting are apart, before any other arm is read, and as the shortest example of an arm.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/handwritten/rules.ts                # the hand-written tables, which the next command starts from
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/handwritten/tables.json --out $RECOVERY_SCRATCH/search/search-from-handwritten.json   # the number to beat, about 2.5 minutes
bun lab/recovery-parser/learn/arms/plain-pass/run.ts              # 5 seeds, about 2 minutes
```

The arm reads the number to beat before it trains, so without the first two commands it stops at once, with an error that names them.

**What the arm is.** It may change every open cell of the tokenizer's table and of the grammar's table, 1,326 cells. Its tables have today's states and classes, no bit, and today's display table. They are no tables of the dataset's plain table parser: the first seed's tables hold 26 grammar cells with a stack action that does something else than their token does, so the dataset's bound, 97.94% of all three, does not hold for them. A seed decides the order of the samples and nothing else. The tables of a seed are the last ones of its run. Nothing was chosen on the validation split. A second run of the arm gave the same five tables, byte for byte.

## Result

The validation split of the standard set, the exact parser: 5,021 broken samples, 425 of them with nothing to recover, 675,949 scored code points. Percentages, as the mean and in brackets the lowest and the highest of the 5 seeds.

| | all three | display kind | depth | container | whole samples | cells changed against the base |
| --- | --- | --- | --- | --- | --- | --- |
| one pass of the trainer from today's tables, defaults | 96.50 (95.88 to 96.74) | 98.22 (98.11 to 98.27) | 98.13 (97.64 to 98.35) | 99.68 (99.39 to 99.79) | 73.22 (72.76 to 73.54) | 967 (935 to 984) |

The seeds one by one, all three: 96.69, 96.74, 95.88, 96.50, 96.70.

All three per group of the dataset:

| within reach of the tables | needs a display fix | needs a line rule | needs a character class | needs a nesting fix | out of reach |
| --- | --- | --- | --- | --- | --- |
| 99.1 (98.9 to 99.3) | 96.2 (94.2 to 96.8) | 99.7 (98.9 to 99.9) | 89.7 (88.9 to 90.5) | 89.4 (83.1 to 92.8) | 81.6 (76.9 to 83.6) |

What the main number does not show:

| added code points shown as an error | samples that show an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after |
| --- | --- | --- | --- | --- |
| 0.9 (0.7 to 1.1) | 6.2 (4.6 to 7.8) | 50 (0 to 160) | 3.0 (0.0 to 12.3) | 4.7 (0.0 to 16.4) |

The ground rules hold on the fixed texts for all 5 seeds.

Against the hand-written tables and against the number to beat, as `describeComparison` says it:

- All three, all validation samples: the plain pass has 96.50 (95.88 to 96.74) over 5 seeds, the hand-written tables have 96.52 and no seed. The means differ by -0.01 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- All three, group: within reach of the tables: the plain pass has 99.11 (98.87 to 99.31) over 5 seeds, the hand-written tables have 99.51 and no seed. The means differ by -0.39 points, and the two ranges do not overlap.
- All three, all validation samples: the plain pass has 96.50 (95.88 to 96.74) over 5 seeds, the search from the hand-written tables has 97.75 and no seed. The means differ by -1.24 points, and the two ranges do not overlap.
- All three, group: within reach of the tables: the plain pass has 99.11 (98.87 to 99.31) over 5 seeds, the search from the hand-written tables has 99.68 and no seed. The means differ by -0.57 points, and the two ranges do not overlap.

## What it says

- **Two seeds of this setting are up to 0.86 points apart**, 95.88% to 96.74%. Four of the five seeds are within 0.24 points of each other, and the third is 0.6 points below them. A difference of that size between two arms with one seed each is no difference.
- On all samples the mean is 0.01 points below the hand-written tables (96.52%), and the two are not told apart: the hand-written tables lie inside the range of the seeds. It is 1.2 points below the search from the hand-written tables (97.75%), which is the number to beat, see `../../search/README.md`, and which is above every seed.
- **In the group "within reach of the tables" the trainer is below the hand-written tables in every seed**, 99.11% (98.87% to 99.31%) against 99.51%. So the two rows of the comparison do not say the same, and an arm reports both.
- The trainer has more code points right than the hand-written tables in the groups "needs a nesting fix" (89.4% against 76.1%) and "out of reach" (81.6% against 78.0%), and fewer whole samples overall (73.22% against 80.44%).
- What the main number does not show differs from seed to seed: two seeds show 90 and 160 code points as past the end and three show none, and the depth of valid JSON that is too deep is right in both forms for three seeds and wrong at up to 16.4% of the code points for the two others. Nothing in the loss asks for either.
