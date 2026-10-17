HELD BACK: whoever builds the parser, the train data, the training or its machinery does not read this file.

# The final scores of the TOML track

Scored at 2026-10-16T21:50:03.885Z by `RECOVERY_FINAL=yes bun lab/recovery-toml/held-back/final/run.ts --out <RECOVERY_SCRATCH>/held-back/final`, from the worktree at commit 6a3e1595c2b661703d07f3dd76802bd4d2c9dcc1. Dataset 314a0404b2bd51ba. The list is lab/recovery-toml/held-back/final/list.json (sha256 98d86bb47ba52e49a79e21ac9f01be7e7a9d9f7b60ad6557238fb36341f7fd69). Every count is in <RECOVERY_SCRATCH>/held-back/final/final.counts.json.

Words: "all three" is the share of the scored code points with the display kind, the depth and the container right. A scored code point is one from the first error of the parser as it is on whose label has a scored value. "Whole" is the share of the texts with something to recover in which every scored code point is right. An "added" code point is one that the damage put into the text, which has no label. Where a row has several seeds, a number is the mean over the seeds, with the lowest and the highest in brackets. All shares are in percent.

## The rows

The rows and the verdict's rule were fixed by the lead before any training on TOML. **The rows 4 and 7, which the verdict reads, leave out the search of the recipe.** The rows 5 and 8 have it, so they are the JSON side's candidate "generic" with all of its five steps.

| Row | What it is | Files |
| --- | --- | --- |
| 1 | The parser as it is: today's tables, which go on after an error and show tokens by their kind | none |
| 2 | One rule without training: after an error, the parser as it is starts anew at the next line (learn/restart-at-next-line.ts) | none |
| 3 | Hand-written rules: the 39 recovery rules of learn/handwritten/rules.ts in the table form, written by hand with the train and validation samples of both train sets in view. The rules alone, with no search after them | 1 |
| 4 | Recipe on neutral damage, no search: learn/recipe.ts on the dataset as it is, whose damage knows nothing of TOML: the training, the count and the last step. Seeds 1 to 5. The primary row | 5 |
| 5 | Recipe on neutral damage, with the search: the same with the search before the count, seeds 1 to 5. This is the candidate "generic" with all five steps, as the JSON side scored it | 5 |
| 6 | Search and count, no training, neutral damage: the recipe's base, its search and its count on the dataset as it is, without the training. Seeds 11 to 13 | 3 |
| 7 | Recipe on the mixed set, no search: learn/recipe.ts on train samples of which half have the dataset's damage and half have kinds of mistakes written for TOML: the training, the count and the last step. Seeds 1 to 5 | 5 |
| 8 | Recipe on the mixed set, with the search: the same with the search before the count, seeds 1 to 5 | 5 |

## The verdict

**Failed.**

The rule, on the two held-back sets and in "all three": "carried over with neutral damage alone" when row 4 with its lowest seed is above the rows 2 and 3 on both sets; "carried over with kinds written for the language" when row 7 with its lowest seed is, and row 4 is not; "partly" when row 4 or row 7 is above row 2 but not row 3, or on one set only; "failed" when neither is above row 2. The lowest seed of a row on a set is the seed with the lowest "all three" on that set.

| All three, in percent | Row 2 | Row 3 | Row 4, lowest seed | Row 7, lowest seed |
| --- | --- | --- | --- | --- |
| The generator's set | 89.81 | 98.67 | 84.81 (seed 5) | 89.59 (seed 5) |
| The written cases with full agreement | 84.25 | 93.97 | 81.50 (seed 5) | 83.02 (seed 4) |

Every trained row against the rows 2 and 3, with its lowest seed, in points of "all three". Only the rows 4 and 7 count for the verdict.

| Row | Set | Lowest seed | Mean | Lowest seed against row 2 | Lowest seed against row 3 |
| --- | --- | --- | --- | --- | --- |
| 4 | generator | 84.81 (seed 5) | 86.63 | not above, −5.00 | not above, −13.86 |
| 4 | written, full agreement | 81.50 (seed 5) | 81.84 | not above, −2.75 | not above, −12.47 |
| 5 | generator | 92.07 (seed 1) | 92.90 | above, +2.27 | not above, −6.59 |
| 5 | written, full agreement | 87.82 (seed 1) | 89.08 | above, +3.58 | not above, −6.15 |
| 6 | generator | 93.13 (seed 13) | 93.80 | above, +3.32 | not above, −5.54 |
| 6 | written, full agreement | 88.96 (seed 12) | 89.83 | above, +4.71 | not above, −5.01 |
| 7 | generator | 89.59 (seed 5) | 90.37 | not above, −0.21 | not above, −9.07 |
| 7 | written, full agreement | 83.02 (seed 4) | 83.85 | not above, −1.23 | not above, −10.95 |
| 8 | generator | 98.18 (seed 5) | 98.34 | above, +8.37 | not above, −0.49 |
| 8 | written, full agreement | 90.95 (seed 2) | 92.74 | above, +6.70 | not above, −3.02 |

## All eight rows on both held-back sets

The generator's set: 3,000 samples, 488,580 scored code points, 23,804 added code points. The written set's cases with full agreement: 144 cases, 142 of them with something to recover, 20,303 scored code points, 1,844 added code points.

| Row | Generator: all three | Generator: whole | Generator: added shown as an error | Written: all three | Written: whole | Written: added shown as an error |
| --- | --- | --- | --- | --- | --- | --- |
| 1, the parser as it is | 69.29 | 9.5 | 8,135 | 61.72 | 4.9 | 951 |
| 2, one rule without training | 89.81 | 37.9 | 8,135 | 84.25 | 29.6 | 951 |
| 3, hand-written rules | 98.67 | 81.7 | 0 | 93.97 | 60.6 | 0 |
| 4, recipe on neutral damage, no search | 86.63 (84.81 to 87.57) | 28.6 (25.0 to 31.9) | 291 (110 to 627) | 81.84 (81.50 to 82.20) | 21.0 (19.0 to 23.2) | 35 (8 to 83) |
| 5, recipe on neutral damage, with the search | 92.90 (92.07 to 93.69) | 50.7 (49.3 to 52.1) | 1 (0 to 4) | 89.08 (87.82 to 90.52) | 43.0 (40.1 to 46.5) | 0 (0 to 0) |
| 6, search and count, no training, neutral damage | 93.80 (93.13 to 94.38) | 46.3 (42.5 to 50.9) | 0 (0 to 0) | 89.83 (88.96 to 90.35) | 43.0 (40.8 to 44.4) | 3 (3 to 3) |
| 7, recipe on the mixed set, no search | 90.37 (89.59 to 91.49) | 37.1 (31.6 to 40.6) | 455 (291 to 843) | 83.85 (83.02 to 84.76) | 21.1 (18.3 to 24.6) | 53 (20 to 107) |
| 8, recipe on the mixed set, with the search | 98.34 (98.18 to 98.77) | 82.7 (80.2 to 85.3) | 0 (0 to 0) | 92.74 (90.95 to 93.58) | 55.4 (52.1 to 56.3) | 1 (0 to 4) |

Per file of tables, "all three / whole" on the generator's set, on the written cases with full agreement, and on the dataset's test split:

| Row | Seed | Generator | Written, full agreement | The dataset's test split |
| --- | --- | --- | --- | --- |
| 3 |  | 98.67 / 81.7 | 93.97 / 60.6 | 94.76 / 52.9 |
| 4 | 1 | 86.96 / 27.0 | 81.67 / 19.0 | 89.71 / 29.7 |
| 4 | 2 | 86.45 / 31.9 | 81.81 / 23.2 | 88.33 / 31.6 |
| 4 | 3 | 87.57 / 30.9 | 82.01 / 19.7 | 90.36 / 32.7 |
| 4 | 4 | 87.37 / 28.4 | 82.20 / 20.4 | 90.56 / 32.4 |
| 4 | 5 | 84.81 / 25.0 | 81.50 / 22.5 | 87.45 / 29.8 |
| 5 | 1 | 92.07 / 49.3 | 87.82 / 40.1 | 96.31 / 57.0 |
| 5 | 2 | 92.99 / 52.1 | 87.99 / 46.5 | 96.36 / 55.8 |
| 5 | 3 | 92.95 / 51.5 | 88.89 / 44.4 | 96.38 / 57.1 |
| 5 | 4 | 93.69 / 50.1 | 90.52 / 43.0 | 96.28 / 55.4 |
| 5 | 5 | 92.82 / 50.6 | 90.18 / 40.8 | 96.21 / 58.3 |
| 6 | 11 | 93.90 / 42.5 | 90.17 / 43.7 | 95.47 / 48.9 |
| 6 | 12 | 94.38 / 50.9 | 88.96 / 44.4 | 95.57 / 53.7 |
| 6 | 13 | 93.13 / 45.4 | 90.35 / 40.8 | 95.52 / 52.4 |
| 7 | 1 | 91.49 / 34.7 | 84.43 / 18.3 | 89.58 / 30.3 |
| 7 | 2 | 90.16 / 31.6 | 83.83 / 19.0 | 88.85 / 28.7 |
| 7 | 3 | 90.78 / 40.2 | 84.76 / 23.2 | 88.82 / 32.4 |
| 7 | 4 | 89.81 / 40.6 | 83.02 / 24.6 | 87.91 / 32.3 |
| 7 | 5 | 89.59 / 38.7 | 83.21 / 20.4 | 88.55 / 33.4 |
| 8 | 1 | 98.23 / 82.9 | 93.22 / 55.6 | 95.84 / 55.5 |
| 8 | 2 | 98.24 / 82.4 | 90.95 / 52.1 | 96.42 / 53.8 |
| 8 | 3 | 98.77 / 85.3 | 93.58 / 56.3 | 95.89 / 57.1 |
| 8 | 4 | 98.29 / 82.9 | 92.66 / 56.3 | 95.73 / 53.6 |
| 8 | 5 | 98.18 / 80.2 | 93.28 / 56.3 | 95.86 / 55.1 |

## The generator of typical mistakes

The generator of typical mistakes: the samples 0 to 2999 of seed 20261107. The weights of its kinds are a judgment and no measured frequencies, so the rows per kind and per group say more than the number over the set. A sample with two kinds is in the row of each.

### Per group, per number of mistakes, and the held-out templates apart

| All three, in percent | Texts | Scored code points | Row 1 | Row 2 | Row 3 | Row 4 | Row 5 | Row 6 | Row 7 | Row 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 3,000 | 488,580 | 69.29 | 89.81 | 98.67 | 86.63 (84.81 to 87.57) | 92.90 (92.07 to 93.69) | 93.80 (93.13 to 94.38) | 90.37 (89.59 to 91.49) | 98.34 (98.18 to 98.77) |
| documents of the two held-out templates | 1,453 | 232,642 | 69.60 | 89.80 | 98.42 | 85.61 (83.56 to 86.82) | 92.57 (91.69 to 93.16) | 93.18 (92.45 to 94.13) | 89.41 (88.26 to 90.72) | 97.82 (97.60 to 98.31) |
| template: deployConfig | 646 | 104,418 | 72.12 | 90.52 | 99.37 | 84.72 (83.27 to 86.41) | 93.98 (92.96 to 94.96) | 94.32 (92.58 to 95.22) | 88.29 (87.52 to 89.33) | 98.60 (98.11 to 99.25) |
| template: taskRunner | 807 | 128,224 | 67.54 | 89.22 | 97.65 | 86.33 (83.80 to 88.32) | 91.42 (90.65 to 91.86) | 92.24 (91.13 to 93.25) | 90.33 (88.86 to 91.86) | 97.19 (96.96 to 97.54) |
| documents of the 14 templates that the train data has | 1,547 | 255,938 | 69.01 | 89.81 | 98.89 | 87.56 (85.94 to 88.37) | 93.21 (92.43 to 94.18) | 94.37 (93.75 to 94.77) | 91.23 (90.60 to 92.18) | 98.81 (98.54 to 99.18) |
| one mistake | 2,031 | 296,279 | 71.34 | 90.62 | 98.97 | 88.40 (87.36 to 89.02) | 93.71 (92.95 to 94.35) | 94.58 (93.96 to 95.07) | 91.99 (91.47 to 92.75) | 98.58 (98.40 to 99.00) |
| two mistakes | 969 | 192,301 | 66.13 | 88.55 | 98.20 | 83.91 (80.88 to 85.79) | 91.67 (90.73 to 92.68) | 92.60 (91.86 to 93.31) | 87.86 (86.70 to 89.54) | 97.97 (97.81 to 98.41) |
| group: out of reach | 137 | 19,373 | 41.90 | 82.72 | 87.93 | 81.81 (80.78 to 83.70) | 87.32 (85.32 to 89.48) | 88.71 (88.10 to 89.04) | 83.89 (83.05 to 84.68) | 89.44 (88.77 to 89.85) |
| group: needs a nesting fix | 1 | 82 | 0.00 | 89.02 | 97.56 | 88.54 (85.37 to 90.24) | 89.51 (89.02 to 90.24) | 90.65 (89.02 to 91.46) | 84.88 (69.51 to 90.24) | 89.27 (89.02 to 90.24) |
| group: needs a character class | 114 | 23,654 | 49.99 | 75.49 | 99.82 | 80.92 (77.94 to 85.53) | 86.31 (84.46 to 88.72) | 86.25 (83.13 to 87.97) | 88.10 (85.42 to 90.53) | 96.52 (94.20 to 97.64) |
| group: needs a line rule | 148 | 26,864 | 80.02 | 93.86 | 99.62 | 88.08 (84.57 to 89.16) | 96.29 (94.92 to 97.81) | 97.54 (97.34 to 97.84) | 90.82 (89.78 to 92.41) | 99.40 (99.25 to 99.58) |
| group: within reach of the tables | 2,600 | 418,607 | 70.97 | 90.68 | 99.04 | 87.08 (85.40 to 88.04) | 93.32 (92.24 to 94.14) | 94.23 (93.66 to 94.76) | 90.77 (89.98 to 91.80) | 98.79 (98.59 to 99.19) |

| Whole, in percent | Texts | Scored code points | Row 1 | Row 2 | Row 3 | Row 4 | Row 5 | Row 6 | Row 7 | Row 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 3,000 | 488,580 | 9.5 | 37.9 | 81.7 | 28.6 (25.0 to 31.9) | 50.7 (49.3 to 52.1) | 46.3 (42.5 to 50.9) | 37.1 (31.6 to 40.6) | 82.7 (80.2 to 85.3) |
| documents of the two held-out templates | 1,453 | 232,642 | 10.4 | 38.3 | 81.2 | 27.8 (23.1 to 32.1) | 50.7 (49.3 to 52.6) | 45.1 (42.2 to 49.3) | 35.9 (31.9 to 39.4) | 82.2 (79.0 to 84.9) |
| template: deployConfig | 646 | 104,418 | 7.4 | 37.5 | 86.8 | 26.2 (20.9 to 29.7) | 54.1 (52.2 to 55.4) | 49.9 (46.3 to 56.0) | 31.9 (26.8 to 35.6) | 87.0 (84.4 to 90.1) |
| template: taskRunner | 807 | 128,224 | 12.8 | 39.0 | 76.7 | 29.1 (24.8 to 35.2) | 48.1 (47.0 to 50.4) | 41.3 (38.9 to 43.9) | 39.2 (35.8 to 43.1) | 78.4 (74.7 to 80.8) |
| documents of the 14 templates that the train data has | 1,547 | 255,938 | 8.6 | 37.5 | 82.1 | 29.4 (26.8 to 31.8) | 50.7 (49.4 to 51.7) | 47.3 (42.8 to 52.4) | 38.3 (31.4 to 41.7) | 83.2 (81.4 to 85.6) |
| one mistake | 2,031 | 296,279 | 12.7 | 45.2 | 85.4 | 35.2 (31.5 to 38.7) | 58.0 (56.8 to 59.4) | 54.5 (50.9 to 58.8) | 44.1 (38.7 to 47.8) | 86.2 (83.9 to 88.4) |
| two mistakes | 969 | 192,301 | 2.7 | 22.6 | 73.8 | 14.9 (11.5 to 17.8) | 35.4 (33.6 to 37.4) | 28.9 (25.0 to 34.3) | 22.6 (16.7 to 27.8) | 75.5 (72.4 to 78.6) |
| group: out of reach | 137 | 19,373 | 2.2 | 2.9 | 19.7 | 10.4 (7.3 to 12.4) | 17.7 (16.1 to 21.2) | 18.5 (16.8 to 19.7) | 8.9 (8.0 to 10.2) | 16.6 (15.3 to 19.7) |
| group: needs a nesting fix | 1 | 82 | 0.0 | 0.0 | 0.0 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) |
| group: needs a character class | 114 | 23,654 | 0.0 | 5.3 | 94.7 | 2.3 (0.9 to 3.5) | 9.1 (6.1 to 12.3) | 5.3 (5.3 to 5.3) | 23.7 (15.8 to 28.1) | 60.7 (53.5 to 71.1) |
| group: needs a line rule | 148 | 26,864 | 0.0 | 0.7 | 89.2 | 29.9 (23.0 to 35.8) | 71.4 (69.6 to 73.6) | 69.8 (63.5 to 75.0) | 33.1 (23.6 to 38.5) | 90.0 (87.8 to 93.2) |
| group: within reach of the tables | 2,600 | 418,607 | 10.8 | 43.3 | 84.0 | 30.7 (26.9 to 34.0) | 53.1 (51.5 to 54.9) | 48.2 (44.3 to 53.2) | 39.5 (33.6 to 43.4) | 86.8 (84.3 to 88.9) |

### Per kind of mistake

The mean over a row's seeds. The lowest and the highest seed of every cell are in the file of counts.

| All three, in percent | Texts | Scored code points | Row 1 | Row 2 | Row 3 | Row 4 | Row 5 | Row 6 | Row 7 | Row 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `colonForEquals` | 164 | 33,064 | 52.66 | 70.60 | 99.52 | 73.87 | 83.57 | 91.11 | 91.83 | 99.24 |
| `doubledEquals` | 105 | 17,616 | 78.91 | 94.09 | 99.88 | 90.07 | 97.32 | 97.24 | 92.75 | 99.48 |
| `missingEquals` | 98 | 15,701 | 86.75 | 97.61 | 99.62 | 91.23 | 98.23 | 98.00 | 91.88 | 99.43 |
| `missingCommaInArray` | 119 | 18,794 | 80.46 | 92.89 | 99.44 | 90.07 | 95.88 | 96.72 | 92.67 | 99.35 |
| `commaAtLineEnd` | 91 | 14,229 | 85.14 | 96.20 | 99.53 | 90.90 | 94.13 | 89.03 | 92.92 | 99.67 |
| `trailingCommaInInlineTable` | 173 | 26,394 | 80.40 | 94.05 | 99.03 | 91.77 | 96.58 | 95.35 | 92.97 | 99.14 |
| `unquotedString` | 166 | 29,436 | 75.11 | 89.18 | 98.45 | 87.74 | 93.53 | 94.84 | 90.22 | 98.57 |
| `missingClosingQuote` | 175 | 32,024 | 68.91 | 94.05 | 99.02 | 88.49 | 96.22 | 97.12 | 90.74 | 98.82 |
| `missingOpeningQuote` | 61 | 10,491 | 79.94 | 92.62 | 99.27 | 90.04 | 95.27 | 96.80 | 91.56 | 98.94 |
| `typographicQuotes` | 103 | 20,041 | 42.02 | 72.43 | 99.73 | 77.43 | 83.72 | 88.16 | 85.48 | 95.54 |
| `twoQuotesCloseMultiLine` | 25 | 4,688 | 50.94 | 71.35 | 73.38 | 67.69 | 71.38 | 71.94 | 70.73 | 73.75 |
| `lineFeedInString` | 62 | 9,687 | 60.27 | 69.41 | 78.48 | 75.34 | 78.46 | 81.37 | 75.08 | 81.81 |
| `unescapedBackslash` | 50 | 5,670 | 63.88 | 71.48 | 99.93 | 88.12 | 92.50 | 93.07 | 94.35 | 99.78 |
| `missingHeaderBracket` | 104 | 20,689 | 49.18 | 94.67 | 99.28 | 88.01 | 96.30 | 97.47 | 89.73 | 99.21 |
| `unbalancedDoubleBracket` | 134 | 23,109 | 45.51 | 95.66 | 99.46 | 87.84 | 97.64 | 98.05 | 85.69 | 99.52 |
| `missingArrayBracket` | 174 | 26,877 | 29.42 | 86.73 | 98.32 | 87.73 | 96.40 | 97.35 | 86.62 | 98.07 |
| `missingCloseBrace` | 99 | 16,654 | 22.66 | 95.81 | 99.38 | 93.37 | 96.13 | 96.35 | 91.13 | 98.17 |
| `inlineTableOnSeveralLines` | 160 | 25,515 | 82.42 | 73.29 | 99.00 | 78.20 | 76.62 | 81.44 | 92.84 | 99.25 |
| `keyWithSpace` | 98 | 18,078 | 77.48 | 93.84 | 98.98 | 87.59 | 96.56 | 95.59 | 89.70 | 98.90 |
| `valueLeftOut` | 170 | 29,629 | 82.40 | 96.51 | 99.52 | 90.00 | 97.62 | 97.32 | 91.35 | 99.49 |
| `headerWithTrailingDot` | 56 | 9,867 | 27.12 | 93.72 | 99.08 | 90.34 | 95.81 | 96.46 | 91.39 | 98.23 |
| `foreignLiteral` | 148 | 22,596 | 80.89 | 97.00 | 99.58 | 90.69 | 98.13 | 98.16 | 91.73 | 99.44 |
| `numberWithUnit` | 114 | 17,223 | 73.98 | 96.63 | 99.73 | 87.90 | 96.84 | 97.02 | 87.84 | 99.44 |
| `numberInAnotherForm` | 107 | 16,316 | 73.71 | 96.48 | 99.67 | 90.35 | 98.07 | 97.67 | 90.14 | 99.58 |
| `dateInAnotherForm` | 55 | 6,479 | 83.81 | 92.73 | 98.30 | 92.37 | 96.60 | 97.29 | 94.89 | 98.84 |
| `templatePlaceholder` | 49 | 8,245 | 79.37 | 94.42 | 99.48 | 90.11 | 94.19 | 91.31 | 92.73 | 98.52 |
| `jsonPastedIn` | 186 | 31,462 | 57.17 | 79.24 | 95.13 | 74.49 | 79.54 | 74.43 | 82.86 | 93.21 |
| `yamlBlock` | 129 | 26,579 | 63.15 | 75.08 | 99.80 | 74.96 | 86.11 | 90.36 | 90.42 | 99.82 |
| `yamlListItems` | 130 | 18,911 | 82.54 | 95.84 | 99.02 | 76.95 | 95.11 | 96.20 | 88.31 | 98.91 |
| `semicolonComment` | 105 | 18,984 | 76.23 | 90.79 | 97.33 | 85.32 | 90.72 | 92.13 | 89.10 | 95.61 |
| `slashComment` | 117 | 21,334 | 79.69 | 92.84 | 99.77 | 86.05 | 93.03 | 92.42 | 93.45 | 99.67 |
| `cutInTheMiddle` | 66 | 7,107 | 63.32 | 92.23 | 96.74 | 87.63 | 95.58 | 96.66 | 91.66 | 97.08 |
| `conflictMarkers` | 121 | 15,708 | 83.14 | 96.03 | 99.45 | 90.86 | 86.00 | 96.71 | 92.70 | 99.59 |
| `proseAround` | 97 | 22,833 | 82.26 | 95.82 | 98.66 | 90.10 | 97.15 | 96.48 | 87.77 | 98.87 |
| `codeFence` | 105 | 28,154 | 82.68 | 97.94 | 99.47 | 90.41 | 97.64 | 98.56 | 85.57 | 99.52 |
| `invisibleCharacter` | 53 | 10,697 | 79.35 | 88.15 | 99.00 | 89.04 | 95.12 | 89.50 | 91.96 | 98.90 |

| Whole, in percent | Texts | Scored code points | Row 1 | Row 2 | Row 3 | Row 4 | Row 5 | Row 6 | Row 7 | Row 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `colonForEquals` | 164 | 33,064 | 0.0 | 0.0 | 88.4 | 1.0 | 0.0 | 0.0 | 32.4 | 90.4 |
| `doubledEquals` | 105 | 17,616 | 15.2 | 54.3 | 96.2 | 30.1 | 66.9 | 61.9 | 41.3 | 89.3 |
| `missingEquals` | 98 | 15,701 | 20.4 | 77.6 | 94.9 | 45.5 | 84.1 | 77.9 | 44.9 | 92.9 |
| `missingCommaInArray` | 119 | 18,794 | 15.1 | 49.6 | 92.4 | 41.8 | 73.1 | 71.7 | 47.1 | 91.3 |
| `commaAtLineEnd` | 91 | 14,229 | 20.9 | 64.8 | 87.9 | 38.9 | 27.7 | 16.8 | 48.4 | 91.4 |
| `trailingCommaInInlineTable` | 173 | 26,394 | 17.3 | 65.3 | 94.8 | 47.6 | 76.6 | 14.5 | 49.1 | 96.1 |
| `unquotedString` | 166 | 29,436 | 1.2 | 2.4 | 50.0 | 11.0 | 14.7 | 21.7 | 15.8 | 53.0 |
| `missingClosingQuote` | 175 | 32,024 | 0.0 | 0.0 | 78.3 | 26.4 | 61.9 | 61.5 | 28.9 | 76.7 |
| `missingOpeningQuote` | 61 | 10,491 | 0.0 | 0.0 | 59.0 | 9.5 | 18.0 | 33.9 | 15.1 | 62.6 |
| `typographicQuotes` | 103 | 20,041 | 0.0 | 0.0 | 94.2 | 2.7 | 7.0 | 19.4 | 20.4 | 44.7 |
| `twoQuotesCloseMultiLine` | 25 | 4,688 | 0.0 | 0.0 | 4.0 | 0.0 | 0.0 | 0.0 | 1.6 | 4.0 |
| `lineFeedInString` | 62 | 9,687 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| `unescapedBackslash` | 50 | 5,670 | 0.0 | 2.0 | 98.0 | 18.0 | 48.8 | 41.3 | 64.0 | 96.0 |
| `missingHeaderBracket` | 104 | 20,689 | 7.7 | 49.0 | 86.5 | 39.2 | 74.0 | 74.0 | 46.5 | 85.4 |
| `unbalancedDoubleBracket` | 134 | 23,109 | 9.0 | 39.6 | 94.0 | 51.3 | 80.7 | 80.1 | 50.4 | 94.9 |
| `missingArrayBracket` | 174 | 26,877 | 6.9 | 26.4 | 74.7 | 29.4 | 65.4 | 67.0 | 21.3 | 75.7 |
| `missingCloseBrace` | 99 | 16,654 | 3.0 | 69.7 | 91.9 | 64.0 | 76.0 | 76.8 | 69.5 | 88.1 |
| `inlineTableOnSeveralLines` | 160 | 25,515 | 21.9 | 0.0 | 35.0 | 14.5 | 1.0 | 3.3 | 51.0 | 81.9 |
| `keyWithSpace` | 98 | 18,078 | 7.1 | 54.1 | 76.5 | 19.4 | 66.3 | 24.5 | 27.8 | 79.2 |
| `valueLeftOut` | 170 | 29,629 | 10.6 | 68.8 | 91.2 | 32.7 | 71.9 | 51.2 | 33.5 | 90.1 |
| `headerWithTrailingDot` | 56 | 9,867 | 0.0 | 0.0 | 89.3 | 38.9 | 68.6 | 69.6 | 43.9 | 82.5 |
| `foreignLiteral` | 148 | 22,596 | 23.6 | 73.0 | 93.9 | 40.3 | 79.1 | 77.7 | 42.0 | 93.4 |
| `numberWithUnit` | 114 | 17,223 | 14.0 | 75.4 | 95.6 | 42.3 | 79.8 | 74.0 | 40.4 | 92.6 |
| `numberInAnotherForm` | 107 | 16,316 | 0.9 | 6.5 | 79.4 | 34.6 | 59.1 | 59.2 | 35.9 | 77.6 |
| `dateInAnotherForm` | 55 | 6,479 | 3.6 | 25.5 | 49.1 | 37.1 | 56.0 | 50.3 | 40.4 | 69.1 |
| `templatePlaceholder` | 49 | 8,245 | 10.2 | 59.2 | 91.8 | 38.8 | 58.8 | 44.9 | 45.7 | 92.7 |
| `jsonPastedIn` | 186 | 31,462 | 0.0 | 0.0 | 43.5 | 0.0 | 0.0 | 0.0 | 16.3 | 72.8 |
| `yamlBlock` | 129 | 26,579 | 0.0 | 0.0 | 94.6 | 0.8 | 0.0 | 0.0 | 18.4 | 90.9 |
| `yamlListItems` | 130 | 18,911 | 0.0 | 0.0 | 92.3 | 0.0 | 0.0 | 0.0 | 23.4 | 89.7 |
| `semicolonComment` | 105 | 18,984 | 10.5 | 40.0 | 74.3 | 25.5 | 43.2 | 43.2 | 27.6 | 51.0 |
| `slashComment` | 117 | 21,334 | 8.5 | 45.3 | 95.7 | 20.3 | 49.6 | 45.3 | 40.5 | 96.6 |
| `cutInTheMiddle` | 66 | 7,107 | 10.6 | 37.9 | 65.2 | 25.5 | 56.1 | 59.1 | 28.2 | 60.0 |
| `conflictMarkers` | 121 | 15,708 | 18.2 | 71.9 | 90.9 | 39.8 | 52.7 | 58.4 | 42.5 | 90.1 |
| `proseAround` | 97 | 22,833 | 1.0 | 67.0 | 83.5 | 15.1 | 70.3 | 69.1 | 11.8 | 82.7 |
| `codeFence` | 105 | 28,154 | 0.0 | 72.4 | 90.5 | 14.1 | 75.2 | 67.9 | 6.5 | 96.4 |
| `invisibleCharacter` | 53 | 10,697 | 0.0 | 11.3 | 92.5 | 4.2 | 15.8 | 8.8 | 28.7 | 90.6 |

In how many of the 36 kinds the mean of a row is above and below the rows 2 and 3:

| Row | All three, against row 2 | Whole, against row 2 | All three, against row 3 | Whole, against row 3 |
| --- | --- | --- | --- | --- |
| 3 | 36 above, 0 below | 35 above, 0 below |  |  |
| 4 | 7 above, 29 below | 13 above, 19 below | 0 above, 36 below | 0 above, 35 below |
| 5 | 30 above, 6 below | 27 above, 3 below | 0 above, 36 below | 1 above, 34 below |
| 6 | 32 above, 4 below | 20 above, 9 below | 1 above, 35 below | 1 above, 34 below |
| 7 | 11 above, 25 below | 16 above, 19 below | 0 above, 36 below | 1 above, 34 below |
| 8 | 36 above, 0 below | 35 above, 0 below | 13 above, 23 below | 14 above, 20 below |

### Per display kind of the label

Over every sample of the set: of the scored code points whose label has the display kind, the share with every scored value right. The mean over a row's seeds.

| All three per display kind of the label, in percent | Scored code points | Row 1 | Row 2 | Row 3 | Row 4 | Row 5 | Row 6 | Row 7 | Row 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| whitespace | 74,103 | 81.5 | 93.3 | 99.4 | 94.3 | 94.5 | 95.0 | 97.6 | 99.0 |
| punctuation | 40,123 | 62.8 | 89.8 | 99.1 | 81.5 | 91.6 | 92.0 | 84.8 | 99.0 |
| string | 165,166 | 72.6 | 82.5 | 98.4 | 89.1 | 91.5 | 94.2 | 95.4 | 97.7 |
| escape | 649 | 79.7 | 85.5 | 94.0 | 96.7 | 97.6 | 98.9 | 97.3 | 98.2 |
| number | 14,497 | 76.0 | 88.7 | 99.1 | 91.0 | 92.1 | 94.6 | 94.7 | 98.3 |
| literal | 7,030 | 78.3 | 90.4 | 99.5 | 90.5 | 90.9 | 94.4 | 97.5 | 99.0 |
| key | 118,481 | 79.3 | 96.6 | 98.4 | 93.3 | 94.2 | 94.0 | 95.3 | 98.7 |
| headerName | 39,002 | 0.0 | 97.3 | 99.0 | 42.3 | 96.9 | 96.2 | 38.9 | 98.8 |
| comment | 28,822 | 73.6 | 84.9 | 98.1 | 88.7 | 88.8 | 86.3 | 95.8 | 96.8 |
| the display kind is not scored | 707 | 99.4 | 99.9 | 100.0 | 99.9 | 100.0 | 98.1 | 100.0 | 100.0 |

## The agent-written cases

The written set: the 150 cases of held-back/written/. A case has full agreement when its two repairs give every code point from the first error on the same label. "Agreed code points" counts every case and leaves the disputed code points out. "The ten neutral edits" are the edits of the train data's damage: the first part has the cases whose damage one to three of them could make, and "other damage" the rest.

| All three, in percent | Texts | Scored code points | Row 1 | Row 2 | Row 3 | Row 4 | Row 5 | Row 6 | Row 7 | Row 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cases with full agreement | 144 | 20,303 | 61.72 | 84.25 | 93.97 | 81.84 (81.50 to 82.20) | 89.08 (87.82 to 90.52) | 89.83 (88.96 to 90.35) | 83.85 (83.02 to 84.76) | 92.74 (90.95 to 93.58) |
| full agreement, one to three of the ten neutral edits make the damage | 69 | 8,255 | 59.43 | 89.21 | 94.39 | 84.45 (83.34 to 86.27) | 91.93 (89.72 to 93.28) | 93.60 (93.16 to 94.46) | 86.97 (85.89 to 87.61) | 94.52 (93.97 to 95.09) |
| full agreement, other damage | 75 | 12,048 | 63.28 | 80.85 | 93.68 | 80.05 (78.23 to 81.42) | 87.13 (85.84 to 88.99) | 87.24 (86.09 to 88.11) | 81.71 (80.05 to 83.22) | 91.51 (88.73 to 92.78) |
| full agreement, other damage that more than three neutral edits make | 18 | 2,546 | 65.55 | 85.86 | 97.37 | 85.93 (83.31 to 88.18) | 91.82 (89.59 to 94.38) | 93.07 (92.89 to 93.44) | 88.05 (86.92 to 90.42) | 95.57 (93.99 to 96.62) |
| full agreement, no repair marked as unsure | 128 | 18,510 | 62.31 | 83.70 | 94.37 | 81.57 (80.95 to 82.53) | 89.00 (87.70 to 90.66) | 89.65 (88.77 to 90.16) | 84.20 (83.57 to 85.25) | 93.34 (91.43 to 94.17) |
| full agreement, hand-editing.txt | 50 | 6,376 | 58.69 | 89.87 | 95.01 | 84.69 (82.86 to 86.37) | 93.96 (92.46 to 95.03) | 94.33 (93.90 to 95.03) | 86.38 (85.46 to 87.25) | 94.44 (93.38 to 95.28) |
| full agreement, model-and-paste.txt | 47 | 7,044 | 60.24 | 75.43 | 90.22 | 76.45 (73.95 to 79.39) | 84.43 (80.95 to 86.61) | 83.15 (81.84 to 84.16) | 79.06 (76.49 to 80.31) | 89.24 (85.58 to 91.20) |
| full agreement, other-notations.txt | 47 | 6,883 | 66.03 | 88.07 | 96.85 | 84.72 (83.31 to 85.49) | 89.32 (85.88 to 92.40) | 92.49 (91.68 to 93.07) | 86.41 (85.36 to 87.29) | 94.74 (94.19 to 95.73) |
| all cases, the agreed code points | 150 | 20,986 | 61.84 | 83.98 | 93.78 | 81.65 (81.14 to 81.96) | 88.88 (87.37 to 90.42) | 89.63 (88.97 to 90.23) | 83.52 (82.87 to 84.38) | 92.44 (90.64 to 93.23) |
| agreed code points, one to three of the ten neutral edits make the damage | 69 | 8,255 | 59.43 | 89.21 | 94.39 | 84.45 (83.34 to 86.27) | 91.93 (89.72 to 93.28) | 93.60 (93.16 to 94.46) | 86.97 (85.89 to 87.61) | 94.52 (93.97 to 95.09) |
| agreed code points, other damage | 81 | 12,731 | 63.40 | 80.58 | 93.38 | 79.84 (77.82 to 81.06) | 86.89 (85.59 to 88.91) | 87.06 (86.25 to 87.48) | 81.28 (79.95 to 82.66) | 91.09 (88.34 to 92.27) |
| agreed code points, other damage that more than three neutral edits make | 18 | 2,546 | 65.55 | 85.86 | 97.37 | 85.93 (83.31 to 88.18) | 91.82 (89.59 to 94.38) | 93.07 (92.89 to 93.44) | 88.05 (86.92 to 90.42) | 95.57 (93.99 to 96.62) |
| agreed code points, no repair marked as unsure | 129 | 18,662 | 62.57 | 83.83 | 94.41 | 81.62 (80.98 to 82.55) | 89.08 (87.80 to 90.74) | 89.69 (88.86 to 90.14) | 84.30 (83.58 to 85.37) | 93.40 (91.50 to 94.22) |
| agreed code points, hand-editing.txt | 50 | 6,376 | 58.69 | 89.87 | 95.01 | 84.69 (82.86 to 86.37) | 93.96 (92.46 to 95.03) | 94.33 (93.90 to 95.03) | 86.38 (85.46 to 87.25) | 94.44 (93.38 to 95.28) |
| agreed code points, model-and-paste.txt | 50 | 7,283 | 61.13 | 76.23 | 90.54 | 76.94 (74.49 to 79.69) | 84.71 (81.38 to 87.05) | 83.65 (82.44 to 84.68) | 79.34 (76.85 to 80.56) | 89.59 (86.05 to 91.49) |
| agreed code points, other-notations.txt | 50 | 7,327 | 65.28 | 86.54 | 95.92 | 83.69 (82.34 to 84.63) | 88.59 (84.97 to 91.44) | 91.50 (90.92 to 92.41) | 85.18 (84.20 to 85.98) | 93.53 (92.81 to 94.55) |

| Whole, in percent | Texts | Scored code points | Row 1 | Row 2 | Row 3 | Row 4 | Row 5 | Row 6 | Row 7 | Row 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| cases with full agreement | 144 | 20,303 | 4.9 | 29.6 | 60.6 | 21.0 (19.0 to 23.2) | 43.0 (40.1 to 46.5) | 43.0 (40.8 to 44.4) | 21.1 (18.3 to 24.6) | 55.4 (52.1 to 56.3) |
| full agreement, one to three of the ten neutral edits make the damage | 69 | 8,255 | 9.0 | 34.3 | 59.7 | 31.6 (28.4 to 34.3) | 55.5 (53.7 to 58.2) | 52.7 (50.7 to 53.7) | 30.1 (25.4 to 35.8) | 60.3 (58.2 to 61.2) |
| full agreement, other damage | 75 | 12,048 | 1.3 | 25.3 | 61.3 | 11.5 (8.0 to 14.7) | 31.7 (28.0 to 37.3) | 34.2 (32.0 to 36.0) | 13.1 (12.0 to 14.7) | 50.9 (45.3 to 53.3) |
| full agreement, other damage that more than three neutral edits make | 18 | 2,546 | 0.0 | 0.0 | 44.4 | 4.4 (0.0 to 5.6) | 3.3 (0.0 to 11.1) | 3.7 (0.0 to 5.6) | 3.3 (0.0 to 11.1) | 32.2 (27.8 to 38.9) |
| full agreement, no repair marked as unsure | 128 | 18,510 | 4.8 | 28.6 | 61.1 | 18.1 (15.9 to 21.4) | 42.7 (39.7 to 46.8) | 43.1 (40.5 to 45.2) | 19.5 (16.7 to 23.8) | 55.9 (53.2 to 57.9) |
| full agreement, hand-editing.txt | 50 | 6,376 | 8.0 | 32.0 | 66.0 | 29.2 (26.0 to 32.0) | 57.2 (54.0 to 60.0) | 55.3 (54.0 to 56.0) | 29.6 (26.0 to 32.0) | 59.6 (56.0 to 62.0) |
| full agreement, model-and-paste.txt | 47 | 7,044 | 4.3 | 34.8 | 63.0 | 16.5 (13.0 to 19.6) | 38.7 (34.8 to 43.5) | 41.3 (37.0 to 45.7) | 16.5 (13.0 to 21.7) | 49.6 (47.8 to 52.2) |
| full agreement, other-notations.txt | 47 | 6,883 | 2.2 | 21.7 | 52.2 | 16.5 (15.2 to 19.6) | 31.7 (28.3 to 37.0) | 31.2 (30.4 to 32.6) | 16.5 (6.5 to 23.9) | 56.5 (52.2 to 58.7) |
| all cases, the agreed code points | 150 | 20,986 | 5.4 | 31.1 | 60.8 | 20.9 (18.2 to 23.6) | 43.2 (39.9 to 46.6) | 43.2 (40.5 to 45.3) | 21.4 (18.9 to 24.3) | 55.8 (52.7 to 56.8) |
| agreed code points, one to three of the ten neutral edits make the damage | 69 | 8,255 | 9.0 | 34.3 | 59.7 | 31.6 (28.4 to 34.3) | 55.5 (53.7 to 58.2) | 52.7 (50.7 to 53.7) | 30.1 (25.4 to 35.8) | 60.3 (58.2 to 61.2) |
| agreed code points, other damage | 81 | 12,731 | 2.5 | 28.4 | 61.7 | 12.1 (9.9 to 16.0) | 33.1 (28.4 to 38.3) | 35.4 (32.1 to 38.3) | 14.1 (12.3 to 16.0) | 52.1 (46.9 to 54.3) |
| agreed code points, other damage that more than three neutral edits make | 18 | 2,546 | 0.0 | 0.0 | 44.4 | 4.4 (0.0 to 5.6) | 3.3 (0.0 to 11.1) | 3.7 (0.0 to 5.6) | 3.3 (0.0 to 11.1) | 32.2 (27.8 to 38.9) |
| agreed code points, no repair marked as unsure | 129 | 18,662 | 4.7 | 29.1 | 61.4 | 18.1 (15.7 to 21.3) | 43.0 (40.2 to 46.5) | 43.0 (40.2 to 45.7) | 20.0 (17.3 to 23.6) | 56.2 (53.5 to 58.3) |
| agreed code points, hand-editing.txt | 50 | 6,376 | 8.0 | 32.0 | 66.0 | 29.2 (26.0 to 32.0) | 57.2 (54.0 to 60.0) | 55.3 (54.0 to 56.0) | 29.6 (26.0 to 32.0) | 59.6 (56.0 to 62.0) |
| agreed code points, model-and-paste.txt | 50 | 7,283 | 6.1 | 38.8 | 65.3 | 17.6 (12.2 to 22.4) | 40.8 (36.7 to 46.9) | 44.2 (38.8 to 49.0) | 17.1 (14.3 to 22.4) | 52.7 (51.0 to 55.1) |
| agreed code points, other-notations.txt | 50 | 7,327 | 2.0 | 22.4 | 51.0 | 15.9 (14.3 to 18.4) | 31.4 (28.6 to 34.7) | 29.9 (28.6 to 30.6) | 17.1 (8.2 to 24.5) | 55.1 (51.0 to 57.1) |

Over the cases with full agreement, per display kind of the label:

| All three per display kind of the label, in percent | Scored code points | Row 1 | Row 2 | Row 3 | Row 4 | Row 5 | Row 6 | Row 7 | Row 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| whitespace | 2,632 | 79.7 | 92.4 | 97.2 | 93.6 | 93.4 | 93.9 | 96.0 | 95.9 |
| punctuation | 1,542 | 58.6 | 87.6 | 95.5 | 79.5 | 91.1 | 91.4 | 79.4 | 94.8 |
| string | 7,087 | 66.0 | 76.3 | 94.4 | 88.7 | 89.6 | 91.5 | 90.2 | 92.9 |
| escape | 11 | 54.5 | 72.7 | 100.0 | 89.1 | 90.9 | 93.9 | 90.9 | 83.6 |
| number | 436 | 82.3 | 95.0 | 96.1 | 95.6 | 95.6 | 95.0 | 94.7 | 94.6 |
| literal | 337 | 74.2 | 91.1 | 97.6 | 89.3 | 92.2 | 90.1 | 92.9 | 93.8 |
| key | 5,459 | 74.4 | 94.0 | 94.2 | 89.4 | 90.8 | 90.5 | 92.2 | 93.3 |
| headerName | 2,249 | 0.0 | 82.2 | 93.0 | 36.6 | 87.9 | 89.0 | 34.2 | 93.2 |
| comment | 534 | 29.2 | 34.8 | 65.7 | 35.8 | 34.9 | 34.8 | 60.9 | 59.8 |
| the display kind is not scored | 16 | 100.0 | 100.0 | 100.0 | 100.0 | 92.5 | 97.9 | 100.0 | 100.0 |

## For reference: the dataset's test split

The dataset's test split, with the train data's damage: the samples of seed 20261016 with the indexes 0 to 59999 whose document is in the test split: 12,536 samples, 1,672,484 scored code points, 106,849 added code points. The damage is the ten neutral edits of the train data, on documents that no training saw. The two held-out templates have no document in the train data at all. The other documents are of templates that the train data has, with sequences of tokens that it does not have. The rows of the other templates are in the file of counts.

| All three, in percent | Texts | Scored code points | Row 1 | Row 2 | Row 3 | Row 4 | Row 5 | Row 6 | Row 7 | Row 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 12,536 | 1,672,484 | 62.31 | 91.72 | 94.76 | 89.28 (87.45 to 90.56) | 96.31 (96.21 to 96.38) | 95.52 (95.47 to 95.57) | 88.74 (87.91 to 89.58) | 95.94 (95.73 to 96.42) |
| documents of the two held-out templates | 7,336 | 1,002,098 | 61.91 | 92.16 | 94.80 | 88.71 (86.70 to 90.11) | 96.20 (96.06 to 96.29) | 95.41 (95.36 to 95.45) | 88.37 (87.49 to 89.32) | 95.93 (95.46 to 96.66) |
| template: deployConfig | 3,678 | 495,661 | 65.06 | 92.10 | 95.93 | 87.76 (86.05 to 89.21) | 97.57 (97.46 to 97.65) | 96.49 (96.12 to 96.77) | 87.28 (86.55 to 88.13) | 97.01 (96.32 to 97.39) |
| template: taskRunner | 3,658 | 506,437 | 58.82 | 92.21 | 93.69 | 89.64 (87.35 to 90.98) | 94.87 (94.70 to 94.97) | 94.36 (94.11 to 94.81) | 89.44 (88.23 to 90.79) | 94.87 (94.46 to 96.06) |
| documents of the 16 templates that the train data has | 5,200 | 670,386 | 62.91 | 91.07 | 94.70 | 90.13 (88.56 to 91.24) | 96.47 (96.37 to 96.56) | 95.68 (95.61 to 95.79) | 89.30 (88.55 to 89.96) | 95.96 (95.85 to 96.12) |
| group: one edit | 6,004 | 793,421 | 63.07 | 92.58 | 95.12 | 90.25 (89.01 to 91.30) | 96.64 (96.56 to 96.76) | 95.84 (95.77 to 95.91) | 89.94 (89.47 to 90.47) | 96.30 (96.04 to 96.83) |
| group: two edits | 4,663 | 622,415 | 61.36 | 91.16 | 94.57 | 88.66 (86.54 to 90.09) | 96.10 (96.01 to 96.20) | 95.39 (95.39 to 95.39) | 88.01 (86.89 to 88.98) | 95.68 (95.52 to 96.05) |
| group: three edits | 1,869 | 256,648 | 62.25 | 90.41 | 94.08 | 87.80 (84.81 to 89.60) | 95.77 (95.63 to 95.84) | 94.84 (94.77 to 94.94) | 86.81 (85.60 to 88.27) | 95.49 (95.26 to 96.01) |
| kind: copyRun | 3,314 | 471,128 | 57.55 | 90.73 | 93.26 | 86.57 (84.39 to 88.19) | 94.70 (94.64 to 94.78) | 94.00 (93.93 to 94.12) | 85.37 (83.92 to 86.84) | 94.30 (94.02 to 94.60) |
| kind: cutTail | 721 | 56,620 | 61.51 | 89.52 | 93.79 | 88.56 (86.89 to 89.85) | 95.70 (95.51 to 95.98) | 94.69 (94.46 to 94.86) | 87.68 (87.06 to 88.63) | 95.39 (95.02 to 95.83) |
| kind: deleteCodePoint | 1,586 | 212,114 | 66.76 | 92.16 | 94.96 | 89.54 (87.62 to 90.89) | 96.03 (95.91 to 96.23) | 95.53 (95.39 to 95.69) | 89.01 (88.20 to 89.65) | 95.92 (95.60 to 96.47) |
| kind: deleteLine | 1,092 | 138,637 | 58.79 | 88.78 | 91.89 | 88.51 (85.72 to 89.90) | 95.22 (95.13 to 95.30) | 94.97 (94.77 to 95.11) | 87.49 (86.83 to 88.34) | 94.64 (94.04 to 95.34) |
| kind: deleteRun | 2,915 | 383,210 | 62.06 | 90.91 | 93.84 | 88.37 (86.88 to 89.84) | 95.66 (95.53 to 95.80) | 94.67 (94.56 to 94.79) | 87.76 (87.39 to 88.30) | 95.02 (94.71 to 95.46) |
| kind: duplicateLine | 1,198 | 159,582 | 53.63 | 88.30 | 92.81 | 88.21 (85.36 to 89.98) | 94.86 (94.61 to 95.18) | 94.15 (94.10 to 94.23) | 87.64 (86.18 to 88.34) | 94.37 (93.92 to 95.81) |
| kind: duplicateRun | 3,028 | 406,898 | 62.47 | 93.19 | 96.05 | 90.20 (87.60 to 91.71) | 97.74 (97.43 to 97.94) | 96.94 (96.75 to 97.12) | 89.83 (88.40 to 91.09) | 97.42 (97.18 to 97.88) |
| kind: insertCodePoint | 2,116 | 285,071 | 66.68 | 91.83 | 96.08 | 90.54 (88.22 to 91.83) | 97.26 (97.05 to 97.37) | 96.49 (96.39 to 96.62) | 90.11 (89.17 to 91.20) | 97.08 (96.85 to 97.41) |
| kind: replaceCodePoint | 2,276 | 316,891 | 65.09 | 91.65 | 95.03 | 89.67 (88.00 to 90.95) | 96.33 (96.14 to 96.42) | 95.47 (95.29 to 95.57) | 89.10 (88.53 to 90.07) | 96.02 (95.85 to 96.34) |
| kind: swapNeighbours | 1,757 | 241,549 | 65.47 | 92.79 | 96.36 | 89.90 (88.38 to 91.00) | 97.42 (97.22 to 97.49) | 96.26 (96.08 to 96.52) | 89.47 (88.59 to 90.06) | 97.22 (97.03 to 97.47) |

| Whole, in percent | Texts | Scored code points | Row 1 | Row 2 | Row 3 | Row 4 | Row 5 | Row 6 | Row 7 | Row 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 12,536 | 1,672,484 | 10.3 | 35.3 | 52.9 | 31.2 (29.7 to 32.7) | 56.7 (55.4 to 58.3) | 51.7 (48.9 to 53.7) | 31.4 (28.7 to 33.4) | 55.0 (53.6 to 57.1) |
| documents of the two held-out templates | 7,336 | 1,002,098 | 9.4 | 34.9 | 53.6 | 29.7 (27.6 to 31.7) | 57.0 (55.6 to 58.3) | 51.6 (48.5 to 53.9) | 30.3 (28.5 to 31.9) | 55.8 (54.0 to 58.1) |
| documents of the 16 templates that the train data has | 5,200 | 670,386 | 11.6 | 35.9 | 51.8 | 33.4 (31.8 to 34.4) | 56.4 (55.2 to 58.2) | 51.7 (49.3 to 53.6) | 33.0 (29.0 to 35.5) | 54.0 (53.0 to 55.8) |

| All three per display kind of the label, in percent | Scored code points | Row 1 | Row 2 | Row 3 | Row 4 | Row 5 | Row 6 | Row 7 | Row 8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| whitespace | 258,581 | 70.6 | 92.8 | 96.2 | 95.6 | 97.5 | 97.1 | 95.2 | 97.4 |
| punctuation | 141,113 | 56.8 | 91.6 | 94.4 | 84.7 | 96.6 | 96.0 | 84.3 | 96.3 |
| string | 584,537 | 67.4 | 87.8 | 93.5 | 93.4 | 95.3 | 94.4 | 92.6 | 95.0 |
| escape | 3,054 | 57.6 | 74.5 | 83.5 | 89.1 | 89.8 | 88.7 | 86.3 | 87.1 |
| number | 48,911 | 68.1 | 87.4 | 91.6 | 91.5 | 93.4 | 92.7 | 90.0 | 92.9 |
| literal | 25,375 | 74.1 | 94.2 | 94.6 | 93.6 | 95.1 | 94.5 | 93.1 | 94.8 |
| key | 384,904 | 69.9 | 97.1 | 96.8 | 94.4 | 97.6 | 96.8 | 93.5 | 97.0 |
| headerName | 133,165 | 0.0 | 94.9 | 96.5 | 44.6 | 96.4 | 95.8 | 45.8 | 96.3 |
| comment | 92,844 | 67.6 | 89.1 | 90.5 | 93.6 | 95.0 | 94.2 | 93.4 | 94.8 |

## Added code points that are shown as an error

A label is never the display kind `error`, so the shares above do not see whether a row still marks the damage itself. The count is over every added code point of a set.

| Row | Generator, of 23,804 | Written, all 150 cases, of 1,964 | The dataset's test split, of 106,849 |
| --- | --- | --- | --- |
| 1 | 8,135 | 1,027 | 6,147 |
| 2 | 8,135 | 1,027 | 6,161 |
| 3 | 0 | 0 | 0 |
| 4 | 291 (110 to 627) | 37 (8 to 92) | 68 (41 to 120) |
| 5 | 1 (0 to 4) | 0 (0 to 0) | 0 (0 to 1) |
| 6 | 0 (0 to 0) | 3 (3 to 3) | 5 (4 to 8) |
| 7 | 455 (291 to 843) | 53 (20 to 108) | 224 (37 to 792) |
| 8 | 0 (0 to 0) | 1 (0 to 4) | 0 (0 to 0) |

## What was checked in this run

- **The files.** Before a text was scored, each of the 24 files of the list had the bytes that its sha256 names, the list was what the three lists of the training side give now, and each file loaded: it was saved with this dataset, every frozen cell and every display entry that is not open holds today's, and every cell that differs from today's is an open one.
- **A second count.** 15,776 counts of this report were held against the count of the set's own scorer (`specific/score.ts`, `written/score.ts`, `learn/score.ts`), which runs the tables through another function: none differs.
- **Added structure alone changes nothing.** 3 tables with the classes, the open display entries and the bit of the listed tables and with no cell changed (for row 3: 8 added classes, open display entries, the bit "first on its line"; for rows 4, 5, 6: 18 added classes, open display entries, the bit "first on its line"; for rows 7, 8: 25 added classes, open display entries, the bit "first on its line") were held against the parser as it is in 3,528 counts: none differs.
- **As today where the ground rules ask for it, the generator's set.** 27 tables each show 3,000 valid documents (829,349 code points) and the 3,000 broken texts before their first error (331,037 code points) as the parser as it is does: no code point differs.
- **As today where the ground rules ask for it, the written set.** 27 tables each show 164 valid documents (36,207 code points) and the 150 broken texts before their first error (12,014 code points) as the parser as it is does: no code point differs.
- **As today where the ground rules ask for it, the dataset's test split.** 27 tables each show 12,524 valid documents (3,437,972 code points) and the 12,536 broken texts before their first error (1,650,677 code points) as the parser as it is does: no code point differs.
- **The dataset's split.** 60,000 indexes were made, 12,536 of them are samples of the test split, and 7,336 of those are documents of a held-out template.

| Row | Seed | File | sha256, first 16 | What the tables add to today's | Cells that differ from today's |
| --- | --- | --- | --- | --- | --- |
| 3 |  | handwritten/tables.json | 9483a6f2e6760651 | 8 added classes, open display entries, the bit "first on its line" | 7357: tokenizer 3066, grammar 4235, display 56 |
| 4 | 1 | neutral/row-4.seed-1.tables.json | a598dbcb329b6eac | 18 added classes, open display entries, the bit "first on its line" | 4459: tokenizer 1478, grammar 2772, display 209 |
| 4 | 2 | neutral/row-4.seed-2.tables.json | d3aec2e2476facbd | 18 added classes, open display entries, the bit "first on its line" | 4370: tokenizer 1544, grammar 2619, display 207 |
| 4 | 3 | neutral/row-4.seed-3.tables.json | d22336b01b07d66a | 18 added classes, open display entries, the bit "first on its line" | 4547: tokenizer 1533, grammar 2786, display 228 |
| 4 | 4 | neutral/row-4.seed-4.tables.json | f9f327107e202897 | 18 added classes, open display entries, the bit "first on its line" | 4390: tokenizer 1407, grammar 2757, display 226 |
| 4 | 5 | neutral/row-4.seed-5.tables.json | 90302b2fbd823644 | 18 added classes, open display entries, the bit "first on its line" | 4373: tokenizer 1514, grammar 2651, display 208 |
| 5 | 1 | neutral/row-5.seed-1.tables.json | dd0c98577273ac45 | 18 added classes, open display entries, the bit "first on its line" | 5234: tokenizer 2041, grammar 2974, display 219 |
| 5 | 2 | neutral/row-5.seed-2.tables.json | 20a9803af908b869 | 18 added classes, open display entries, the bit "first on its line" | 5094: tokenizer 2076, grammar 2808, display 210 |
| 5 | 3 | neutral/row-5.seed-3.tables.json | 36a88ecd0b055c79 | 18 added classes, open display entries, the bit "first on its line" | 5234: tokenizer 2047, grammar 2965, display 222 |
| 5 | 4 | neutral/row-5.seed-4.tables.json | 49d378bed96daf28 | 18 added classes, open display entries, the bit "first on its line" | 5149: tokenizer 1991, grammar 2941, display 217 |
| 5 | 5 | neutral/row-5.seed-5.tables.json | 620a858c8130071d | 18 added classes, open display entries, the bit "first on its line" | 5119: tokenizer 2061, grammar 2841, display 217 |
| 6 | 11 | neutral/row-6.seed-11.tables.json | 3c6bf232254323ec | 18 added classes, open display entries, the bit "first on its line" | 2372: tokenizer 1437, grammar 890, display 45 |
| 6 | 12 | neutral/row-6.seed-12.tables.json | 063624899fc6edf3 | 18 added classes, open display entries, the bit "first on its line" | 2315: tokenizer 1408, grammar 858, display 49 |
| 6 | 13 | neutral/row-6.seed-13.tables.json | 4e980076ba49b1cd | 18 added classes, open display entries, the bit "first on its line" | 2361: tokenizer 1437, grammar 881, display 43 |
| 7 | 1 | mixed/row-7.seed-1.tables.json | 48dbcbe5704e8122 | 25 added classes, open display entries, the bit "first on its line" | 4797: tokenizer 1739, grammar 2842, display 216 |
| 7 | 2 | mixed/row-7.seed-2.tables.json | bb30228e5383837d | 25 added classes, open display entries, the bit "first on its line" | 4914: tokenizer 1815, grammar 2887, display 212 |
| 7 | 3 | mixed/row-7.seed-3.tables.json | 051994f79e1016c0 | 25 added classes, open display entries, the bit "first on its line" | 4704: tokenizer 1712, grammar 2774, display 218 |
| 7 | 4 | mixed/row-7.seed-4.tables.json | 0c007138c35c2a87 | 25 added classes, open display entries, the bit "first on its line" | 4676: tokenizer 1693, grammar 2774, display 209 |
| 7 | 5 | mixed/row-7.seed-5.tables.json | de04e29af6d4972e | 25 added classes, open display entries, the bit "first on its line" | 4646: tokenizer 1669, grammar 2736, display 241 |
| 8 | 1 | mixed/row-8.seed-1.tables.json | a36c68c5b3cb92fe | 25 added classes, open display entries, the bit "first on its line" | 5569: tokenizer 2306, grammar 3031, display 232 |
| 8 | 2 | mixed/row-8.seed-2.tables.json | f8c9100389fe792f | 25 added classes, open display entries, the bit "first on its line" | 5641: tokenizer 2326, grammar 3079, display 236 |
| 8 | 3 | mixed/row-8.seed-3.tables.json | 82ea4e9b48edff82 | 25 added classes, open display entries, the bit "first on its line" | 5480: tokenizer 2298, grammar 2955, display 227 |
| 8 | 4 | mixed/row-8.seed-4.tables.json | 450a3eee5f4202ef | 25 added classes, open display entries, the bit "first on its line" | 5516: tokenizer 2339, grammar 2952, display 225 |
| 8 | 5 | mixed/row-8.seed-5.tables.json | 01d447d4178bbced | 25 added classes, open display entries, the bit "first on its line" | 5407: tokenizer 2241, grammar 2910, display 256 |

## What the numbers are not

- **Row 3 is the rules alone, and not the best that rules can reach.** Its author had the train and the validation samples of both train sets in view, wrote for about 75 minutes, and stopped when a change added 0.05 points or less. The review found that four passes of the recipe's search from the hand-written tables add 1.0 to 1.4 points of "all three" on validation. Those searched tables are not in the list.
- **Row 6 has no last step,** as the JSON control that it copies has none. Its steps ran once before its saved runs, to time the search, with a train score in view and no validation score.
- **The generator and the written set are two authors' views of how TOML gets broken.** The kinds of the mixed set (rows 7 and 8) were written by a third agent who saw neither. Where the three thought of the same mistake, e.g. a colon in the place of the equals sign, the rows 7 and 8 were trained on that mistake, in other documents.
- **Neither set shows everything.** The generator has no plain slip of typing that the written set has, e.g. a quote inside a string without its backslash. The written set has no merge conflict, no template that was not rendered, no byte order mark and no HTML entity.
- **The written set is small:** one case is 0.7 points of "whole", and the same sort of damage comes in several cases.
- **The dataset's test split has the dataset's ceiling below 100:** its labels are those of the document, and some of them no reader of the broken text would give.
