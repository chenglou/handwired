# Combined: what round 1 found, put together

Each arm of round 1 found something that helps trained tables: character classes, open entries of the display table, the bit "first on its line" and three passes from the base's choices (`../extra-facts/`), two settings that keep what no sample asks for and a search after the training (`../generic/`), and spare states (`../spare-states/`). The question of this arm: **how good do trained tables get when all of it is used at once, what does each part add when the others are there, and what is left of the weak sides?** Round 1's best row, `../extra-facts/` with all three additions, had wrong depths on valid JSON deeper than 16 levels, showed code points as "past the end", and was unsteady in whole samples.

The arm has two lines, which the person who asked for the experiment wants kept apart:

- **generic**: nothing that a person knows about broken JSON goes in. The base is today's tables, the classes come from a rule that reads only train samples, and open display entries and the bit are structure.
- **with a person's knowledge**: first the 15 classes chosen by hand in place of the rule's, then also the 35 hand-written rules of `../../handwritten/` as the base, with every open cell trainable from the rules' choices.

**A recipe**, e.g. the generic one, has four steps. Add the classes, the open display entries and the bit to the base. Train every open cell and entry in three passes, from a share of 0.9 on the base's choice. Run 4 passes of the greedy search of `../holes/restricted-search.ts` over the same cells on the train split. Give every open display entry the kind that the most train code points want there. The training and the search have **two kept settings**: the grammar cells that valid JSON deeper than 16 levels reads hold the base's choice, 188 cells for today's tables with the bit, and no trained tokenizer cell can take an event of a text's end.

**What the arm is.** It may change every open cell but the kept ones, and every open display entry. Its tables have today's states, 11 or 15 more classes, 16 contexts and a changed display table, so they are no tables of the dataset's plain table parser. For the two lines with a person's knowledge no split counts as unseen, see `../README.md`.

## What the arm shows

The validation split, the exact parser. A number with brackets is the mean of the seeds with the lowest and the highest, "whole" is the share of samples with every scored code point right, and two ranges are "apart" when they do not overlap. Every part was tuned with the seeds 11, 12 and 13 on the generic line. The three candidates then ran once with the seeds 1 to 5 and once with the seeds 21 to 25, which nothing had used.

1. **Without anything that a person knows, the generic candidate has 98.30 (98.27 to 98.37) of all three, and 98.29 (98.22 to 98.49) with the new seeds**, where the number to beat has 97.75 and round 1's best row 98.03 (97.82 to 98.13) and 98.08 (97.78 to 98.24). With the seeds 1 to 5 the ranges are apart, and with the new seeds they overlap: 3 of the 10 seeds are below that row's best seed. Within reach of the tables it has 99.67 and 99.70, at the number to beat's 99.68. Its whole samples are 83.61 (82.79 to 84.29) and 84.81 (84.31 to 85.53), above the hand-written 80.44 in all 10 seeds.
2. **Round 1's two defects are gone in every run.** None of the 166 runs with the two kept settings shows a code point as past the end or has a wrong depth on too deep valid JSON, counted over 199,328 code points in three forms of such texts. The same training without the settings has 51,015 wrong depths (48,106 to 53,077) and 364 code points past the end (128 to 555), for 0.08 points more of all three, which the seeds do not tell apart.
3. **The search after the training is the largest part.** On the tuning seeds it adds 0.39 points of all three and 4.9 of whole samples when it runs until a pass changes nothing, apart in both, and 0.05 less with the 4 passes of the candidates. In the candidates it is above its training in 30 of 30 runs, by 0.22 to 0.36 points on average, and it steadies whole samples: the generic training alone has 80.23 (76.78 to 82.35). Without the training, the search until a pass changes nothing ends at 97.42 (97.28 to 97.68), 0.94 points lower and apart, with 75.26 (71.67 to 77.59) of whole samples against 84.63.
4. **Of the three additions, the open display entries add the most**: 0.57 points and 4.6 of whole samples, apart in both. The rule's classes add 0.21 and the bit 0.16, with ranges that overlap.
5. **Three passes are needed, and the count is a small last step**: one pass is 0.28 points lower, apart, and five passes add 0.02. The count adds 1.2 points of whole samples to the training alone, in 3 of 3 seeds, and after the search between -0.01 and +0.29.
6. **A person's classes add whole samples, and a person's rules as the base add nothing.** The classes chosen by hand have 98.33 of all three with both sets of seeds, 0.03 and 0.04 points above the generic candidate with ranges that overlap, and 85.47 (84.77 to 86.40) and 86.37 (85.75 to 87.05) of whole samples, above it in 10 of 10 seeds and apart. The start from the hand-written rules has 98.25 and 98.28, below the start from today's tables in 7 of 10 seeds, and 85.83 and 85.03 of whole samples, 0.36 points above and 1.34 below. Before the search it had 1.4 points more of whole samples.
7. **Spare states and the remedy for whole samples are in no candidate.** On the tuning seeds, 4 spare tokenizer states add 0.08 points (+0.15, -0.03, +0.14) and 2 spare grammar states 0.16 (+0.16, 0.00, +0.30), and each 2.2 of whole samples, to the training alone: they were not run with the search after them. The remedy, a search that counts whole train samples first (`whole-search.ts`), has 87.35 (87.23 to 87.45) of whole samples where the search for code points has 84.49, and 97.51 of all three where that has 98.31, apart in both: a trade, not a gain.
8. **What is still wrong.** Of the generic candidate's samples, 15% to 16% are not whole. A string that is left open in the middle of its line is whole in 10.9% of its samples, where the hand-written rules have 41.8%. And no candidate shows a code point that the damage added as an error, 0 of 54,162. With the target "an added code point is shown as an error" at the weight 0.1, the generic training shows 28,619 of them so (14,247 to 32,547), for 0.12 points of all three that the seeds do not tell apart. The search after it takes the cost away and leaves 6,084 (1,101 to 19,902).

## The main rows

| tables | all three | all three, within reach | whole samples | shown as past the end | wrong depths on too deep valid JSON | added code points shown as an error |
| --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | 42.69 | 47.44 | 11.92 | 0 | 0 | 48,535 |
| hand-written, 35 rules | 96.52 | 99.51 | 80.44 | 0 | 0 | 0 |
| the number to beat | 97.75 | 99.68 | 79.37 | 0 | 52,126 | 4 |
| the best row of extra-facts, seeds 1 to 5 | 98.03 (97.82 to 98.13) | 99.58 (99.27 to 99.68) | 83.60 (82.35 to 85.70) | 304 (168 to 458) | 20,811 (10,644 to 37,624) | 1 (0 to 4) |
| the best row of extra-facts, seeds 11 to 15 | 98.08 (97.78 to 98.24) | 99.61 (99.39 to 99.75) | 81.51 (79.48 to 82.38) | 443 (271 to 537) | 27,475 (917 to 52,931) | 1 (0 to 4) |
| generic, seeds 1 to 5 | 98.30 (98.27 to 98.37) | 99.67 (99.61 to 99.74) | 83.61 (82.79 to 84.29) | 0 | 0 | 0 |
| with the classes chosen by hand, seeds 1 to 5 | 98.33 (98.18 to 98.43) | 99.68 (99.58 to 99.78) | 85.47 (84.77 to 86.40) | 0 | 0 | 0 |
| from the hand-written tables, seeds 1 to 5 | 98.25 (98.18 to 98.36) | 99.66 (99.56 to 99.76) | 85.83 (85.03 to 86.60) | 0 | 0 | 0 |
| generic, seeds 21 to 25 | 98.29 (98.22 to 98.49) | 99.70 (99.58 to 99.81) | 84.81 (84.31 to 85.53) | 0 | 0 | 0 |
| with the classes chosen by hand, seeds 21 to 25 | 98.33 (98.27 to 98.37) | 99.66 (99.59 to 99.72) | 86.37 (85.75 to 87.05) | 0 | 0 | 0 |
| from the hand-written tables, seeds 21 to 25 | 98.28 (98.22 to 98.37) | 99.69 (99.60 to 99.73) | 85.03 (84.12 to 85.88) | 0 | 0 | 0 |

The last three columns are counts of code points, as the mean of the seeds: of the validation texts, of 199,328 code points of too deep valid JSON, and of the 54,162 that the damage added. The generic candidate is above the hand-written rules in every group, e.g. 93.3 against 76.1 in "needs a nesting fix". `report.ts` prints the rest.

## What each part adds

A row with the part minus the same recipe without it, in points, for all three as the mean and then seed by seed. The seeds 11, 12 and 13, on the generic line, each part on the training without a search unless the row names one.

| part | all three | whole samples |
| --- | --- | --- |
| the two kept settings | -0.08 (-0.17, -0.01, -0.07) | -1.86 |
| the classes from the train samples | +0.21 (+0.23, +0.40, +0.00) | -0.60 |
| the open display entries | +0.57 (+0.68, +0.49, +0.54), apart | +4.63, apart |
| the bit | +0.16 (+0.26, +0.09, +0.13) | -1.43 |
| the classes chosen by hand in place of the rule's | +0.11 (+0.05, -0.01, +0.28) | +3.47, apart |
| the display entries by a count as the last step | +0.02 (+0.01, +0.01, +0.05) | +1.20 |
| the search after the training, until a pass changes nothing | +0.39 (+0.45, +0.35, +0.36), apart | +4.89, apart |
| 4 passes of the search in place of that | -0.05 (-0.02, -0.11, -0.02) | -0.14 |
| the training before the search, until a pass changes nothing | +0.94 (+1.09, +1.13, +0.59), apart | +9.37, apart |
| 4 passes of the search after the training, three orders | +0.34 over the 9 searches, apart | +4.20 over the 9 searches, apart |
| the search counts whole samples first, in place of code points | -0.80 (-0.68, -0.96, -0.75), apart | +2.86, apart |
| the hand-written tables as the base, with the classes chosen by hand | -0.11 (-0.05, -0.11, -0.17) | +1.43, apart |

## What keeps a sample from being whole

For the generic candidate, the seeds 1 to 5 (`whole-samples.ts`): 83.6% of the samples are whole, 4.5% have one wrong code point, 7.8% have 2 to 10 and 4.1% more, where the hand-written tables have 80.4%, 3.8%, 8.3% and 7.5%. Of the 1,899 wrong code points in the samples with 1 to 10 of them, 27.1% are among the first three scored ones after the error, 5.8% among the last three, and 64.5% inside a word. 24.9% are a key shown as a string, 14.0% a string shown as a key, and 52.7% come while the tokenizer is in a state of a number or of a literal, against 11.6% for the hand-written tables: the trained tables still read words in those states. A string left open in the middle of its line, a raw line feed in a string and a value without quotes lose the most whole samples, and a key without quotes gains the most, 74.0% whole against 17.2%.

Three samples with the candidate's tables of seed 1. `want` is the label's display kind per code point (p punctuation, w white space, s string, k key, n number, l literal, e escape), `got` what is shown, `miss` the wrong ones:

```
text  [⏎    n⏎]      [2, ""São Paulo", true]⏎]      "name":"Chlo\xe9 Liskov","
want  pwwwwwlwp      pnpwsssssssssssspwllllpwp      kkkkkkpssssseeeesssssssspk
got   pwwwwwlsp      pnpwssssswsssssspwllllpwp      kkkkkkpssssseseessssssskpk
miss         k                k                                 k         k
```

## What the arm does not show

- **No number here is one on unseen data.** Every part was chosen with validation scores in view, the seeds 21 to 25 are new seeds on the same split, and the test split was not scored.
- **The two lines with a person's knowledge were not tuned**: their candidates take the passes, the search and the count of the generic line.
- **Not the search until a pass changes nothing in a candidate**: it takes 2 to 5.5 minutes, and 4 passes take one.
- **Not spare states with a search after them**, not both kinds at once, and not what the two kept settings cost after the search.
- **Not that every too deep valid text keeps its depth for the line from the hand-written tables.** The argument that covers every such text needs today's choices in the kept cells. The 258 kept cells of the hand-written base give its depths on the four forms that `check.ts` tries.
- **Not how the damage should be shown.** The count as the last step erases what a target put into the display table.

## Every setting that was tried

With the seeds 11, 12 and 13, on the generic line unless the line says otherwise:

- The generic training, without a search and a count: the control of the lines below.
- Without the two kept settings.
- With the classes chosen by hand, against the best row of `../extra-facts/` from that arm's saved runs.
- Without the classes, without the open display entries, without the bit.
- One pass, five passes, and the count as the last step.
- 4 spare tokenizer states, 2 spare grammar states.
- The search in its first order: until a pass changes nothing, 2 passes, 4 passes.
- The search of 4 passes in the orders 2 and 3, and the count after the first order.
- The search without the training: 4 passes, and until a pass changes nothing.
- The search of 4 passes that counts whole samples first.
- From the hand-written tables: three passes, one pass, no training.

With the seeds 1 to 5 and with the seeds 21 to 25: the three candidates, each as its training alone, with its search, and with its search and its count. With the seeds 1 to 5: the generic training with the error target at the weight 0.1, alone and with the search after it.

## Commands

Run after the commands of `../extra-facts/README.md` for the number to beat and for `--trainer three-base --settings all` with the seeds 1 to 5 and 11 to 15.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
cd lab/recovery-parser/learn/arms/combined
bun run.ts --step kept            # a tuning step
bun run.ts --step candidates      # the seeds 1 to 5, 50 minutes
bun run.ts --step confirmation    # the seeds 21 to 25
bun run.ts --step error-target
bun report.ts --candidates        # every table, and final-candidates.json
bun whole-samples.ts --step candidates --recipe 6
bun check.ts                      # the arm's check, about 3 minutes. check-all.ts does not run it
```

The other tuning steps are `parts`, `trainer`, `hand-written`, `spare-states`, `search-passes`, `then-search`, `search-alone` and `whole-samples --recipes 0,1`.

**The search needed a change outside this folder.** It refused tables with added classes or with the bit, because its parser loop, `../../search/sample-runs.ts`, gave every code point today's class and read 8 contexts. The loop now takes both from the tables, and `../../search/check.ts` and `../holes/check-search.ts` pass.

## Files

`combined.ts` has the recipe, the kept cells for any layout and base, the three lines, the steps and the candidates. `whole-search.ts` and its worker are the search that counts whole train samples first. The other files are the commands above.
