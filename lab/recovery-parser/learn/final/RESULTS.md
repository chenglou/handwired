# The results of the final scoring

`run.ts` ran once, on 2026-10-16 at 12:50 UTC, from the worktree at commit 55171b9. It scored the 95 files of tables in the 17 entries of `final-list.json`, and the six baselines, on the validation split, the test split and the written set. `final-list.json` and the run's report, `final-report.md`, are copies next to this file with paths written relative to `RECOVERY_SCRATCH`, and every count is in `<RECOVERY_SCRATCH>/final/final.counts.json`.

Nothing was trained, searched or changed after the run. Numbers that the counts file lacks, e.g. per held-out kind, are of the same saved tables, run again by the scripts in `<RECOVERY_SCRATCH>/../notes/final-*/`. A second count with other code agrees with the counts file in all 18,832 counts that it compared, of 11 tables.

## The main rows

A payload is a broken sample or a case of the written set, and the other words are those of `../README.md`. A cell is "all three / whole" in percent, as the mean (lowest to highest) of a row's files. The candidates are the 30 files of "generic", "classes chosen by hand" and "from the hand-written tables" of `../arms/combined/`, and the seeds 21 to 25 are their confirmation files. The columns "a kind" and "the template" have nothing else held out.

| tables | validation | test, held out: nothing | test, held out: a kind | test, held out: the template | written set |
|---|---|---|---|---|---|
| the parser as it is | 42.69 / 11.92 | 41.78 / 12.83 | 27.99 / 1.97 | 41.83 / 4.27 | 22.14 / 2.3 |
| the hand rule `lines` | 93.23 / 77.48 | 92.40 / 76.71 | 93.34 / 79.84 | 90.51 / 70.45 | 76.33 / 50.7 |
| hand-written | 96.52 / 80.44 | 96.55 / 79.59 | 98.90 / 87.24 | 96.57 / 73.40 | 82.69 / 56.7 |
| the number to beat | 97.75 / 79.37 | 97.80 / 78.02 | 97.09 / 78.66 | 97.88 / 70.35 | 82.06 / 53.5 |
| plain pass, seeds 1 to 5 | 96.50 (95.88 to 96.74) / 73.22 (72.76 to 73.54) | 96.32 (95.81 to 96.61) / 72.63 (72.16 to 73.16) | 96.21 (93.72 to 97.02) / 66.83 (61.06 to 68.41) | 96.13 (95.68 to 96.85) / 69.41 (68.37 to 70.92) | 81.60 (80.47 to 82.85) / 42.2 (41.9 to 42.8) |
| generic, training alone, seeds 1 to 5 | 97.98 (97.84 to 98.12) / 80.23 (76.78 to 82.35) | 98.11 (98.03 to 98.15) / 79.82 (76.91 to 81.74) | 97.13 (94.78 to 98.72) / 68.93 (62.00 to 75.80) | 97.89 (97.50 to 98.58) / 75.03 (72.33 to 76.82) | 85.64 (83.61 to 87.80) / 46.3 (42.3 to 49.3) |
| generic, seeds 1 to 5 | 98.30 (98.27 to 98.37) / 83.61 (82.79 to 84.29) | 98.44 (98.35 to 98.53) / 83.20 (82.15 to 83.77) | 94.47 (92.65 to 96.27) / 70.22 (67.27 to 73.24) | 98.17 (97.92 to 98.86) / 77.27 (75.03 to 80.40) | 85.18 (83.75 to 86.00) / 47.7 (46.0 to 49.8) |
| generic, seeds 21 to 25 | 98.27 (98.19 to 98.48) / 84.81 (84.31 to 85.53) | 98.45 (98.32 to 98.66) / 84.32 (83.42 to 85.68) | 92.01 (84.77 to 99.04) / 74.08 (59.49 to 84.13) | 97.31 (94.69 to 98.92) / 74.27 (69.69 to 76.54) | 83.60 (79.44 to 86.89) / 46.7 (41.9 to 50.2) |
| classes chosen by hand, seeds 1 to 5 | 98.33 (98.18 to 98.43) / 85.47 (84.77 to 86.40) | 98.59 (98.53 to 98.63) / 85.36 (84.89 to 85.94) | 93.22 (83.85 to 97.27) / 68.01 (60.72 to 78.46) | 97.95 (97.54 to 98.21) / 77.51 (75.09 to 82.16) | 83.34 (80.05 to 85.46) / 46.8 (44.2 to 49.8) |
| classes chosen by hand, seeds 21 to 25 | 98.33 (98.27 to 98.37) / 86.37 (85.75 to 87.05) | 98.59 (98.52 to 98.69) / 85.80 (85.38 to 86.52) | 94.80 (92.98 to 95.86) / 73.17 (67.52 to 79.60) | 97.87 (97.36 to 98.63) / 77.85 (74.43 to 79.93) | 84.00 (81.91 to 85.42) / 46.8 (43.3 to 49.8) |
| from the hand-written tables, seeds 1 to 5 | 98.25 (98.18 to 98.36) / 85.83 (85.03 to 86.60) | 98.49 (98.44 to 98.53) / 85.85 (84.85 to 87.00) | 96.44 (90.26 to 99.20) / 77.97 (70.08 to 88.22) | 98.68 (98.19 to 98.91) / 80.86 (76.29 to 83.39) | 86.55 (84.73 to 88.43) / 52.8 (47.0 to 55.3) |
| from the hand-written tables, seeds 21 to 25 | 98.28 (98.22 to 98.37) / 85.03 (84.12 to 85.88) | 98.52 (98.31 to 98.63) / 85.07 (84.13 to 86.11) | 93.58 (87.81 to 96.32) / 76.16 (65.40 to 82.06) | 98.73 (98.35 to 99.00) / 80.53 (78.52 to 81.50) | 85.51 (81.59 to 87.71) / 50.7 (45.1 to 54.9) |
| no gradient, seeds 11 to 13 | 97.95 (97.83 to 98.12) / 80.53 (76.85 to 82.68) | 98.06 (97.86 to 98.26) / 79.53 (75.63 to 81.94) | 77.51 (70.27 to 87.72) / 61.94 (56.14 to 68.80) | 98.18 (97.85 to 98.40) / 73.50 (72.17 to 75.31) | 80.02 (76.48 to 82.22) / 42.5 (31.2 to 50.2) |

Payloads with something to recover, by column: 4,596, 5,306, 2,029, 3,184, and 215 cases with full agreement (19,343 scored code points).

## What holds and what does not

1. **On kinds of damage that training saw, every candidate is above the hand-written rules.** With nothing held out all 30 files are above on both scores, e.g. generic seed 5, the lowest in whole payloads, has 98.35 / 82.15. With the template held out 29 of 30 are, and generic seed 21 is below on both with 94.69 / 69.69.
2. **The gain in whole payloads is in damaged documents, not in typing replays.** With nothing held out no candidate file has more whole typing replays than hand-written (1,038 to 1,080 against 1,098 of 1,201), and all have more whole damaged documents (3,302 to 3,542 against 3,125 of 4,105).
3. **On kinds that training never saw, no row is above the hand-written rules.** They have 98.90 / 87.24, and every other row of the report has a lower mean on both scores in this column. 93 of the 95 files have fewer whole payloads, and the other two start from the hand-written rules. The number to beat has fewer whole payloads than hand-written in every part of the test split.
4. **The search after the training adds on kinds that training saw and costs code points on the others.** From "generic, training alone" to "generic", the seeds gain 0.33 / 3.38 points with nothing held out, and go from 97.13 to 94.47 of all three with a kind held out and from 85.64 to 85.18 on the written set. The control without gradients has 77.51 with a kind held out. This does not show that gradients carry over and a search does not: the hand-written rules have no gradient and carry over best.
5. **The validation split does not say which file carries over.** The generic confirmation files have 98.19 to 98.48 on validation and 84.77 to 99.04 with a kind held out, and seed 21 is the highest on validation and the lowest there. On unseen kinds the seed decides more than the recipe.
6. **On the written set the candidates have more code points right and fewer whole cases.** Generic has 85.18 against the hand-written 82.69, above in 8 of its 10 files, and 47.7 against 56.7 of whole cases, below in 10 of 10 (90 to 108 against 122 of 215). "From the hand-written tables" has the report's highest mean, 86.55, level with the 86.51 of round 1's "extra facts, classes chosen by hand".
7. **Every table loses at least 9.9 points from validation to the written set**, e.g. hand-written 96.52 to 82.69. About two thirds of that loss is still there on the 180 cases with the generator's kinds alone, where hand-written has 87.28 and generic 88.99. On the 41 cases with damage that no kind makes they have 64.10 and 69.73.

## Why

In the examples the rows of tables are depths, and the marks are `k` wrong display kind, `d` depth, `c` container, `*` more than one.

**Unseen kinds: one cell that a log prefix reads decides a whole payload.** The loss of point 4 is in the kind `logPrefix`: its wrong code points go from 7,081 to 16,803 of 124,556 (mean of seeds 1 to 5), and those of the three other kinds together from 2,962 to 2,532. The prefix has no labels and the whole document comes after it. So one cell that the prefix reads, e.g. one that opens a container, can make the whole document wrong in many payloads, since the 652 payloads have five forms of prefix. The three worst cells that the search changed hold 55% to 91% of a seed's lost code points. On the train split, the payloads whose runs before and after the search first differ at one of these 15 cells gain 0 to 565 of the 5,545,145 code points per cell and lose 0 to 70. With one cell set back, the final tables lose 1 to 211 train code points for 13 cells, and 9,725 and 13,614 for two. The cell differs by seed. In test sample 20261015:32180, generic seed 2 opens an object at the comma of the time:

```
payload          2026-10-12 21:00:11,605 - app.orders - INFO - [953,"MG-204\t2\t12.50",]
label, depth                                                   11111111111111111111111 0
training alone   00000000000000000000000000000000000000000000001111111111111111111111110
  wrong                                                         kkk
with the search  00000000000000000001111111111111111111111111111111111111111111111111111
  wrong                                                        *cccc*******cc*cc****** *
```

**The written set: half of the wrong code points have the right display kind** and a wrong depth or container: 1,761 of 3,348 for hand-written and 1,412 of 2,867 for generic (mean of seeds 1 to 5). Hand-written fails in fewer cases and loses more in each: 25 of its 93 cases that are not whole hold 2,402 of the wrong code points. Generic has 112.4 such cases, 60.4 of them with 2 to 20 wrong code points against 39. Generic is behind in text before the document: in the 55 cases with such text (two more begin with a cut-off copy of the document), the 10 generic files start the document at another depth than 0 in 108 of 550 runs, hand-written in 3 of 55. In case `logs-and-transport-01` (its first 44 code points) the colon opens an object in seed 1. Seeds 1, 4, 5, 23 and 24 have all 83 scored code points wrong, the other five none:

```
payload       Oct 14 22:01:07 web-2 orders[8123]: {"level"
label, depth                                      11111111
hand-written  00000000000000000000000000001111100011111111
generic 1     00000000000000000000000000001111101122222222
  wrong                                           dddddddd
```

**What the generator does not make.** The 41 cases have e.g. every quote or brace written twice, marks before every line or the brackets of another notation. Known kinds come in other forms: 18 of the 57 written texts before a document hold a square or curly bracket, and 3.8% of 2,585 generated ones. In case `merges-and-tools-32` (its first 27 code points) hand-written counts every brace and has 82 of 82 wrong (generic seeds 1 to 5: 82, 50, 30, 18, 12):

```
payload       {{"query": "{search_term}",
label, depth  1 1111111111111111111111111
hand-written  122222222222222222222222222
  wrong         ddddddddddddddddddddddddd
```

## What the numbers are not

- **Not numbers on unseen data for the hand-written rules.** Their builder was told to read files with all 60 samples of each held-out kind of the old snapshot, and which files were read is not recorded. The dataset's hand rules and the classes chosen by hand rest on every split too, and so does each row that starts from one of the three.
- **Not free of people's choices for the generic rows.** People chose the additions, kept settings and recipe with validation scores in view, and added the recipe's last step after both sets of seeds were scored there.
- **Not a large sample on the written set.** Agents wrote its cases. One case is 0.47 points of whole cases, and cases move together, e.g. three CSV cells.
- **Not checked:** that a file was made with the seed in its name, the labels, the parser and the loader (both counts share them), and the cause of a loss by changing a cell back, since no changed tables ran on the test split or the written set. The run's line in the log holds no commit.

## What a later round could try (not done)

1. A validation part with kinds held out of training, to choose files and recipes by.
2. A search that keeps a changed cell only when kinds left out of its own samples do not lose.
3. In the generator: brackets in text before the document, more forms of log prefix, doubled quotes and braces.
4. Scores of the display kind and of the depth apart, per form of the damage.
