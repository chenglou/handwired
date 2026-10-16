# Combined: what round 1 found, put together

Round 1 found parts that help trained tables, see `../extra-facts/`, `../generic/` and `../spare-states/`. The question of this arm: **how good do trained tables get when all of it is used at once, what does each part add when the others are there, and what is left of the weak sides?** Round 1's best row, `../extra-facts/` with all three additions, had wrong depths on valid JSON deeper than 16 levels, code points shown as "past the end", and unsteady whole samples.

The arm has two lines, which the person who asked for the experiment wants kept apart:

- **generic**: nothing that a person knows about broken JSON goes in. The base is today's tables, the classes come from a rule that reads only train samples, and open display entries and the bit are structure.
- **with a person's knowledge**: first the 15 classes chosen by hand in place of the rule's, then also the 35 hand-written rules of `../../handwritten/` as the base.

**A recipe**, e.g. the generic one, has five steps. Add the classes, the open display entries and the bit to the base. Train every open cell and entry in three passes, from a share of 0.9 on the base's choice. Run 4 passes of the greedy search of `../holes/restricted-search.ts` over the same cells on the train split. Give every open display entry the kind that the most train code points want there. Put today's kinds back into the display entries of the grammar state `error`.

**Three kept settings** hold what no sample asks for. In the training and the search, the grammar cells that valid JSON deeper than 16 levels reads hold the base's choice, 188 cells for today's tables with the bit, and no trained tokenizer cell can take an event of a text's end. The third is the fifth step, which only the two candidates from today's tables have: such a text is in the state `error` from its 17th bracket on, so those entries are what it is shown by.

**What the arm is.** It may change every open cell but the kept ones, and every open display entry. Its tables have today's states, 11 or 15 more classes, 16 contexts and a changed display table, so they are no tables of the dataset's plain table parser. The rule picks U+FEFF and U+2026, so the generic candidate has the largest table of classes, 65,282 entries against 8,224 with the classes chosen by hand and 129 today, which a port into the highlighter has to solve. For the two lines with a person's knowledge no split counts as unseen.

## What the arm shows

The validation split, the exact parser. A number with brackets is the mean of the seeds with the lowest and the highest, "whole" is the share of samples with every scored code point right, and two ranges are "apart" when they do not overlap. The first two kept settings, the additions, the trainer and the search of the first order were tuned with the seeds 11, 12 and 13 on the generic line. Then the candidates ran once with the seeds 1 to 5 and once with the seeds 21 to 25, which nothing had used. After those scores, and without a change of a setting, came the search in two more orders, the count after it, the search without the training and the search for whole samples. Last, after a review, came the fifth step, which moves a seed by 0.05 points at most, and the controls of point 3.

1. **Without anything that a person knows, the generic candidate has 98.30 (98.27 to 98.37) of all three, and 98.27 (98.19 to 98.48) with the new seeds**, where the number to beat has 97.75 and round 1's best row 98.03 (97.82 to 98.13) and 98.08 (97.78 to 98.24). With the seeds 1 to 5 the ranges are apart, and with the new seeds they overlap: 3 of the 10 seeds are below that row's best seed. Within reach of the tables it has 99.67 and 99.70, at the number to beat's 99.68. Its whole samples, 83.61 and 84.81, are above the hand-written 80.44 in all 10 seeds, but not in the typing replays (point 8).
2. **On valid JSON deeper than 16 levels, the two candidates from today's tables do what today's parser does, and the third does not.** None of the 214 saved runs with the first two kept settings shows a code point as past the end, and none of the 165 from today's tables has a wrong depth on such texts, 594,957 code points in four forms. Without the two settings the same training has 165,640 wrong depths (85,554 to 215,619) and 364 code points past the end (128 to 555), for 0.08 points that the seeds do not tell apart. What such a text is shown as needs the third setting: without it 15 of the 20 candidate tables from today's tables show it otherwise than today, e.g. four show every `]` after the 17th bracket as a string, and with it none does. All 49 runs from the hand-written tables have wrong depths, as those tables themselves have, e.g. in `{"a": {"a": []}, "b": 1}` inside 14 objects.
3. **After the training, the search adds 0.39 points of all three and 4.9 of whole samples** when it runs until a pass changes nothing, apart in both, and 0.05 less with the 4 passes of the candidates, where it is above its training in 30 of 30 runs, by 0.22 to 0.36 points on average. **The training before the search adds 0.42 to 0.53 points.** The search sets no display entry, so its control without the training needs the count too, and ends at 97.42 without it. With the count after the search the control has 97.83 (97.68 to 97.99) against 98.36 (98.28 to 98.41), and with the search and the count in turns 97.95 (97.83 to 98.12) against 98.37 (98.30 to 98.41), apart in both. That control without gradients is above the number to beat in 3 of 3 seeds and level with the training alone, 97.97.
4. **To the training alone, the open display entries add the most of the three additions**: 0.57 points and 4.6 of whole samples, apart in both. The rule's classes add 0.21 and the bit 0.16, with ranges that overlap.
5. **Three passes are needed, and the count is a small step**: one pass is 0.28 points lower, apart, and five passes add 0.02. The count adds 1.2 points of whole samples to the training alone, in 3 of 3 seeds, and after the search between -0.01 and +0.29.
6. **A person's classes add whole samples, and a person's rules as the base add nothing.** The classes chosen by hand have 98.33 of all three with both sets of seeds, 0.03 and 0.05 points above the generic candidate with ranges that overlap, and 85.47 and 86.37 of whole samples, above it in 10 of 10 seeds and apart. The start from the hand-written rules has 98.25 and 98.28, below the same recipe from today's tables in 7 of 10 seeds, and 85.83 and 85.03 of whole samples, 0.36 points above and 1.34 below.
7. **Spare states and the remedy for whole samples are in no candidate.** To the training alone, 4 spare tokenizer states add 0.08 points (+0.15, -0.03, +0.14) and 2 spare grammar states 0.16 (+0.16, 0.00, +0.30), each with 2.2 of whole samples, and they were not run with a search after them. A search that counts whole train samples first (`whole-search.ts`) has 87.35 (87.23 to 87.45) of whole samples against 84.49, and 97.51 of all three against 98.31, apart in both: a trade, not a gain.
8. **What is still wrong.** Of the generic candidate's samples, 14.5% to 17.2% are not whole, by seed. **In the typing replays, 1,036 of the 4,596 samples, each of the 30 candidate runs has fewer whole samples than the hand-written tables and than the number to beat**: the generic candidate has 88.36 (87.93 to 88.90) against 91.70 and 90.06, and in all three 27 of the 30 runs are below the number to beat's 97.39 and 4 below the hand-written 96.92. Its gain is in the damaged documents: 98.49 against the number to beat's 97.80 and the hand-written 96.45, and 83.0 of whole samples against 76.3 and 77.2. In the group "out of reach" the generic candidate has fewer whole samples than the hand-written tables in 9 of 10 seeds, and a string left open in the middle of its line is whole in 10.9% of its samples against 41.8%. Of its wrong code points in samples with 1 to 10 of them, 52.6% come in a tokenizer state of a number or of a literal, against 11.6% for the hand-written tables: the trained tables still read words in those states. And the candidates show almost no code point that the damage added as an error, 0 to 14 of 54,162 in a seed. With that as a target at the weight 0.1, the generic training shows 28,619 (14,247 to 32,547), for 0.12 points that the seeds do not tell apart, and the search after it takes the cost away and leaves 6,084 (1,101 to 19,902).

## The main rows

| tables | all three | within reach | whole | whole, typing replays | past the end | too deep valid JSON: wrong depths | added, shown as an error |
| --- | --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | 42.69 | 47.44 | 11.92 | 21.04 | 0 | 0 | 48,535 |
| hand-written, 35 rules | 96.52 | 99.51 | 80.44 | 91.70 | 0 | 1,741 | 0 |
| the number to beat | 97.75 | 99.68 | 79.37 | 90.06 | 0 | 204,530 | 4 |
| generic, seeds 1 to 5 | 98.30 (98.27 to 98.37) | 99.67 (99.61 to 99.74) | 83.61 (82.79 to 84.29) | 88.40 (88.13 to 88.71) | 0 | 0 | 4 (0 to 9) |
| with the classes chosen by hand, seeds 1 to 5 | 98.33 (98.18 to 98.43) | 99.68 (99.58 to 99.78) | 85.47 (84.77 to 86.40) | 89.21 (89.09 to 89.29) | 0 | 0 | 7 (0 to 13) |
| from the hand-written tables, seeds 1 to 5 | 98.25 (98.18 to 98.36) | 99.66 (99.56 to 99.76) | 85.83 (85.03 to 86.60) | 88.82 (88.03 to 89.77) | 0 | 1,473 (1,374 to 1,661) | 0 |
| generic, seeds 21 to 25 | 98.27 (98.19 to 98.48) | 99.70 (99.58 to 99.81) | 84.81 (84.31 to 85.53) | 88.32 (87.93 to 88.90) | 0 | 0 | 5 (0 to 14) |
| with the classes chosen by hand, seeds 21 to 25 | 98.33 (98.27 to 98.37) | 99.66 (99.59 to 99.72) | 86.37 (85.75 to 87.05) | 89.46 (88.71 to 89.96) | 0 | 0 | 0 |
| from the hand-written tables, seeds 21 to 25 | 98.28 (98.22 to 98.37) | 99.69 (99.60 to 99.73) | 85.03 (84.12 to 85.88) | 88.75 (86.97 to 89.86) | 0 | 1,544 (1,391 to 1,661) | 0 |

The last three columns are counts of code points, as the mean of the seeds: of the validation texts, of the 594,957 of too deep valid JSON, and of the 54,162 that the damage added. In all three the generic candidate is above the hand-written rules in every group, e.g. 93.3 against 76.1 in "needs a nesting fix". `report.ts` prints the rest.

## What each part adds

A row with the part minus the same recipe without it, in points, for all three as the mean and then seed by seed. The seeds 11, 12 and 13, the generic line, on the training without a search unless the row names one.

| part | all three | whole samples |
| --- | --- | --- |
| the first two kept settings | -0.08 (-0.17, -0.01, -0.07) | -1.86 |
| the classes from the train samples | +0.21 (+0.23, +0.40, +0.00) | -0.60 |
| the open display entries | +0.57 (+0.68, +0.49, +0.54), apart | +4.63, apart |
| the bit | +0.16 (+0.26, +0.09, +0.13) | -1.43 |
| the search after the training, until a pass changes nothing | +0.39 (+0.45, +0.35, +0.36), apart | +4.89, apart |
| 4 passes of the search after the training, three orders | +0.34 over the 9 searches, apart | +4.20, apart |
| the training before the search until a pass changes nothing and the count | +0.53 (+0.58, +0.73, +0.29), apart | +6.45, apart |
| the training before the search and the count in turns | +0.42 (+0.57, +0.52, +0.18), apart | +4.14, apart |
| today's kinds in the state `error` after the search and the count | 0.00 (0.00, 0.00, 0.00) | 0.00 |
| the hand-written tables as the base, with the classes chosen by hand | -0.11 (-0.05, -0.11, -0.17) | +1.43, apart |

## What the arm does not show

- **No number on unseen data.** Every part was chosen with validation scores in view, the seeds 21 to 25 are new seeds on the same split, and the test split was not scored.
- **The two lines with a person's knowledge were not tuned**: their candidates take the passes, the search and the count of the generic line.
- **Not what the classes, the bit, the second and third pass or the first two kept settings add once the search has run.** They were measured on the training alone, where the count and the hand-written base also add something, and those two add nothing after the search.
- **Not a line from the hand-written tables that keeps valid JSON deeper than 16 levels.** Its 258 kept cells hold the rules' choices, which lose the depth of some such texts, and are not all the cells that the rules read on them (`check.ts`). The third setting would cost that line up to 1.09 points in a seed.
- **Not the third setting inside the training.** Those display entries are trained and counted and then put back, so the search chose its cells with other entries there.
- **Not how the damage should be shown**: the count erases what a target put into the display table.

## Every setting that was tried

With the seeds 11, 12 and 13, on the generic line unless the line says otherwise:

- The generic training without a search and a count, as the control, and without the first two kept settings.
- With the classes chosen by hand, against the best row of `../extra-facts/`.
- Without the classes, the open display entries or the bit, one at a time.
- One pass, five passes, and the count as the last step.
- 4 spare tokenizer states, 2 spare grammar states.
- The search in its first order until a pass changes nothing, and with 2 and 4 passes.
- 4 passes of the search in the orders 2 and 3, and the count after the first order.
- The search without the training, with 4 passes and until a pass changes nothing, each also with the count.
- The search and the count in turns, without the training and after it.
- 4 passes of a search that counts whole samples first.
- Today's kinds in the state `error` after the search and the count.
- From the hand-written tables: three passes, one pass, no training.

With the seeds 1 to 5 and 21 to 25: the three lines, each as its training alone, with its search, with its count, and with today's kinds in the state `error`. With the seeds 1 to 5: the generic training with the error target at the weight 0.1, alone and with the search after it.

## Commands

Run after the commands of `../extra-facts/README.md` for the number to beat and for `--trainer three-base --settings all` with the seeds 1 to 5 and 11 to 15.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
cd lab/recovery-parser/learn/arms/combined
bun run.ts --step kept            # a tuning step
bun run.ts --step candidates      # 50 minutes
bun run.ts --step confirmation
bun report.ts --candidates        # every table, and final-candidates.json
bun whole-samples.ts --step candidates --recipe 9
bun check.ts                      # 2 to 3 minutes, check-all.ts runs it too
```

The other steps are `parts`, `trainer`, `hand-written`, `spare-states`, `search-passes`, `then-search`, `search-alone`, `shown-as-today`, `whole-samples --recipes 0,1` and `error-target`. The search needed a change outside this folder: its parser loop, `../../search/sample-runs.ts`, now takes the classes and the contexts from the tables.
