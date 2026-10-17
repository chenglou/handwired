# The results of the final scoring of the TOML track

**Do not read this folder if you build the parser, the train data, the training or its machinery.** See `../README.md`.

`run.ts` ran once, on 2026-10-16 at 21:50 UTC, from the worktree at commit 6a3e159, and ended without a problem. It scored the 24 files of `list.json` and the rows 1 and 2 on the generator's set, on the written set and on the dataset's test split. `final-report.md` is a copy of its report with every breakdown, and every count is in `recovery-scratch/transfer/toml/held-back/final/final.counts.json`. Nothing was trained, searched or changed, and no table was scored on a held-back set before or after that run. The numbers below that the report does not print come from the file of counts alone, by `scripts/after.ts` in the same scratch folder.

A cell is "all three / whole" in percent, with the mean of a row's seeds and the lowest and the highest seed in brackets. The words are those of `README.md`.

## The verdict: failed

By the lead's rule as `README.md` reads it, the recipe did not carry over: with its lowest seed, neither row 4 nor row 7 is above the one rule (row 2) on either held-back set.

| All three | Row 2, the one rule | Row 3, hand-written rules | Row 4, lowest seed | Row 7, lowest seed |
| --- | --- | --- | --- | --- |
| The generator's set, 488,580 scored code points | 89.81 | 98.67 | 84.81 (seed 5) | 89.59 (seed 5) |
| The written cases with full agreement, 20,303 scored code points | 84.25 | 93.97 | 81.50 (seed 5) | 83.02 (seed 4) |

- **Row 4 is below the rule with every seed on both sets.** Its highest seed has 87.57 on the generator's set and 82.20 on the written cases.
- **Row 7 is level with the rule, not above it.** On the generator's set 4 of its 5 seeds are above the rule, seed 4 by 7 code points of 488,580, and seed 5 is 0.21 points below. On the written cases 2 of 5 seeds are above, and the mean is 0.40 below.
- **No trained row is above the hand-written rules.** Row 8 comes nearest: its lowest seed is 0.49 below row 3 on the generator's set and 3.02 below on the written cases.

**Two other readings of the rule give "partly",** so the verdict rests on choices that were written down before the run and that the lead may weigh otherwise:

- With the mean in the place of the lowest seed, row 7 is above the rule on the generator's set, 90.37 against 89.81, and on that set only.
- With the search counted in, the rows 5 and 8 are above the rule with every seed on both sets, and not above row 3. The rows 4 and 7, which the verdict reads, are the recipe without its search.

## All eight rows

The generator's set has 3,000 samples and 23,804 added code points. The written set has 144 cases with full agreement, 142 of them with something to recover, and 1,844 added code points. The dataset's test split has 12,536 samples with the train data's damage, on documents that no training saw.

| Row | Generator | Generator: added shown as an error | Written, full agreement | Written: added shown as an error | For reference: the dataset's test split |
| --- | --- | --- | --- | --- | --- |
| 1, the parser as it is | 69.29 / 9.5 | 8,135 | 61.72 / 4.9 | 951 | 62.31 / 10.3 |
| 2, one rule: anew at the next line | 89.81 / 37.9 | 8,135 | 84.25 / 29.6 | 951 | 91.72 / 35.3 |
| 3, 39 hand-written rules | 98.67 / 81.7 | 0 | 93.97 / 60.6 | 0 | 94.76 / 52.9 |
| 4, recipe on neutral damage, no search, seeds 1 to 5 | 86.63 (84.81 to 87.57) / 28.6 (25.0 to 31.9) | 291 (110 to 627) | 81.84 (81.50 to 82.20) / 21.0 (19.0 to 23.2) | 35 (8 to 83) | 89.28 (87.45 to 90.56) / 31.2 (29.7 to 32.7) |
| 5, the same with the search, seeds 1 to 5 | 92.90 (92.07 to 93.69) / 50.7 (49.3 to 52.1) | 1 (0 to 4) | 89.08 (87.82 to 90.52) / 43.0 (40.1 to 46.5) | 0 | 96.31 (96.21 to 96.38) / 56.7 (55.4 to 58.3) |
| 6, search and count without training, seeds 11 to 13 | 93.80 (93.13 to 94.38) / 46.3 (42.5 to 50.9) | 0 | 89.83 (88.96 to 90.35) / 43.0 (40.8 to 44.4) | 3 | 95.52 (95.47 to 95.57) / 51.7 (48.9 to 53.7) |
| 7, recipe on the mixed set, no search, seeds 1 to 5 | 90.37 (89.59 to 91.49) / 37.1 (31.6 to 40.6) | 455 (291 to 843) | 83.85 (83.02 to 84.76) / 21.1 (18.3 to 24.6) | 53 (20 to 107) | 88.74 (87.91 to 89.58) / 31.4 (28.7 to 33.4) |
| 8, the same with the search, seeds 1 to 5 | 98.34 (98.18 to 98.77) / 82.7 (80.2 to 85.3) | 0 | 92.74 (90.95 to 93.58) / 55.4 (52.1 to 56.3) | 1 (0 to 4) | 95.94 (95.73 to 96.42) / 55.0 (53.6 to 57.1) |

## What the rows say

1. **Without the search the recipe loses the names of headers, and with them the comparison with the one rule.** The rows 4 and 7 have 42.3% and 38.9% of the generator's 39,002 code points right whose label is the name of a header, and 36.6% and 34.2% of the written cases' 2,249. The rule has 97.3% and 82.2%. On all other scored code points both rows are above the rule: 90.48 and 94.83 against 89.16 on the generator's set, and 87.47 and 90.04 against 84.50 on the written cases. Validation showed the same (49.5% of header names for row 4), and the review of the training gave the reason: after the training alone, many code points are still read with the grammar in the state `error`, whose cells the recipe keeps as today's, and there the `[` of a header counts as the start of an array.
2. **With the search, the recipe on neutral damage is above the rule and far below the hand-written rules.** Row 5 is 3.1 and 4.8 points above the rule and 5.8 and 4.9 points below row 3. On the damage that it was trained on, the order is the other way round: on the dataset's test split row 5 has 96.31 / 56.7 and row 3 has 94.76 / 52.9.
3. **The loss is in the kind of damage, not in the documents.** The test split gives every row what validation gave it, e.g. row 5 has 96.31 against 96.51, and 96.20 on the documents of the two held-out templates against 96.47 on the others. From the test split to the held-back sets the rows 4, 5 and 6 lose 1.7 to 3.4 points on the generator's set and 5.7 to 7.4 on the written cases.
4. **Kinds written for the language close most of the gap, and only with the search.** Row 8 is 0.33 points below row 3 on the generator's set and 1.0 above it in whole samples: one of its five seeds is above row 3 in "all three", and four are in whole samples. On the written cases it is 1.2 and 5.2 below, with no seed above. Against row 5, the kinds add 5.4 / 32.0 points on the generator's set and 3.7 / 12.4 on the written cases. Row 8 is above the rule in all 36 kinds of the generator and below it in none in whole samples.
5. **Where row 8 and the rules differ, per kind, in whole samples:** row 8 is far above for an inline table on several lines (81.9 against 35.0) and for pasted JSON (72.8 against 43.5), and far below for typographic quotes (44.7 against 94.2) and for a comment that starts with a semicolon (51.0 against 74.3). Of the generator's samples, 72 are whole for row 3 and for no seed of row 8, 70 are whole for every seed of row 8 and not for row 3, and 2,161 are whole for both.
6. **The training adds nothing on the held-back sets that the search does not find alone.** Row 6, the search and the count without training, has 93.80 / 46.3 and 89.83 / 43.0, against row 5's 92.90 / 50.7 and 89.08 / 43.0. On validation row 5 was 0.69 points above row 6. The two rows ran with other seeds, and their ranges overlap on both sets.
7. **The search on neutral damage breaks some kinds that the rule has right.** For a comma at the end of a line the rule has 64.8% of the samples whole, row 5 has 27.7% and row 6 has 16.8%. For the marker lines of a merge conflict the rule has 96.03 / 71.9 and row 5 has 86.00 / 52.7. Row 5 is below the rule in whole samples in 3 kinds, row 6 in 9, and row 8 in none.
8. **A row that recovers no longer marks the damage.** The rows 1 and 2 show 8,135 of the generator's 23,804 added code points as an error. The rows 3, 5, 6 and 8 show 0 to 4 of them.
9. **The written set is harder for every row, most of all its file of what language models and pasting do.** There the rule has 75.43, row 5 has 84.43, row 8 has 89.24 and row 3 has 90.22. Of the 534 scored code points whose label is a comment, the rule has 34.8% right, row 5 has 34.9%, row 8 has 59.8% and row 3 has 65.7%. On the 69 cases whose damage the ten neutral edits could make, row 6 has 93.60 and row 8 has 94.52, against 94.39 for row 3 and 89.21 for the rule.

## What I did not expect from the validation numbers

- **The order of the rules and the recipe turns around.** On neutral damage row 5 is about 1.6 points above the hand-written rules, on validation and on the test split. On the held-back sets it is 4.9 and 5.8 points below. The rules gained 3.8 points from validation to the generator's set, and every row trained on neutral damage lost.
- **Row 8 is level with the rules on the generator's set.** Its kinds were written by an agent who saw neither held-back set. The first caveat below says how far that goes.
- **The search alone is not below the training with the search.**
- **Little is lost on documents that no training saw,** the two held-out templates included. On the generator's set the hand-written rules are 0.5 points lower on the documents of the held-out templates than on the others, and the rows 5, 6 and 8 are 0.6 to 1.2 lower. So the classes that the recipe makes for capital letters, which `../README.md` asked to look at, cost a few tenths of a point at most.
- **Row 7 is not above the rule.** On the kinds half of its own validation set it was 3.3 points above.

## Caveats

- **The generator's kinds and the train side's kinds are close.** 12 of the generator's 36 kinds have the same name among the 49 kinds of the mixed set, e.g. `colonForEquals` and `codeFence`, and most others have a near one, e.g. `inlineTableOnSeveralLines` and `inlineTableOnLines`. I compared the names and not the forms. So row 8's number on the generator's set says that kinds written by one agent carry over to the same kinds as another agent wrote them, on other documents. The written set is the test with less of that, and there row 8 is 1.2 points below the rules.
- **Row 3 and row 8 both had the 49 kinds in view, and the rows 4 to 6 did not.** The author of the rules read train and validation samples of both train sets. So row 8 against row 3 is the like-for-like pair, and row 5 against row 3 is not.
- **Row 3 is the rules alone, after about 75 minutes of writing.** The review found that the recipe's search from the hand-written tables adds 1.0 to 1.4 points on validation. Those tables were not scored here, so what they have on the held-back sets is not known.
- **Five seeds, three for row 6.** Row 7's place against the rule changes with the seed on both sets.
- **The weights of the generator's kinds are a judgment,** and the written set is small: one case is 0.7 points of "whole".
- **Row 6 has no last step, and its steps ran once before its saved runs** to time the search, with a train score in view.

## What was checked

- **Before the run:** `check.ts` passed, and the dry run from the same commit gave the known numbers of the rows 1 and 2 on both held-back sets (69.3 / 9.5 and 89.8 / 37.9, 61.7 / 4.9 and 84.2 / 29.6) and the training side's validation numbers for every file of the list, e.g. row 4 with 90.70 (89.23 to 91.68) / 33.6.
- **Before a text was scored:** each of the 24 files had the bytes that its sha256 names, was saved with this dataset, and keeps the ground rules. Every cell that differs from today's is an open one.
- **In the run:** 15,776 counts were held against the count of the set's own scorer, which runs the tables through another function, and none differs. Three tables with the added classes, open display entries and the bit of the listed tables, and no cell changed, have the counts of the parser as it is in all 3,528 counts. All 27 tables show the 3,000, 164 and 12,524 valid documents of the three sets, and every broken text before its first error, as the parser as it is does, with no code point different. The test split has 12,536 samples, 7,336 of them of a held-out template, as the dataset's README says.
- **The log** holds one final run.

## Files

- `final-report.md`: the report of the run, a copy of `final.report.md` in the scratch folder. The copy writes the scratch folder of the track, `recovery-scratch/transfer/toml/`, as `<RECOVERY_SCRATCH>`, and `list.json` by its path from the repo root.
- `recovery-scratch/transfer/toml/held-back/final/`: `final.counts.json`, `final.report.md`, `final-runs.log`, `final.stdout.txt`, the dry run's files, `check.txt`, and `after.txt` with the numbers of this page that the report does not print. Its `README.txt` lists them.
