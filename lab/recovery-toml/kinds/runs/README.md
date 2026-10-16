# The runs of the frozen recipe on the mixed set

The mixed set of `../mixed.ts` is half the dataset's samples, whose damage knows nothing of TOML, and half samples of the folder above, whose damage is one or two kinds of mistakes written for TOML. These commands run the recipe of `../../learn/recipe.ts` on its train split with nothing tuned, save the tables of every run with a record, and score them on the validation split. They make two rows of the experiment:

- **Row 7**: the training, then the count and the last step, i.e. `primary` of `runRecipe`.
- **Row 8**: the same with the search before the count, i.e. `withSearch` of the same call. One training gives both rows.

They are the rows 4 and 5 of `../../learn/runs/` with another train split and nothing else changed. `run.ts` calls `runRecipe(mixedSet(), seed)`, and `runRecipe` takes its train samples from the set that it is given. So the rule of the classes, the training, the search and the count all read the mixed train split, e.g. the rule picks the no-break space, which no sample of the dataset has. Rows 1 and 2, the parser as it is and the rule "anew at the next line after an error", take no run: `report.ts` scores them next to the saved runs.

## Commands

Run from the repo root. The tables and the records go to `<RECOVERY_SCRATCH>/mixed/`, or to `--folder`.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-toml/kinds/runs/run.ts --seed 1              # one training, 14 to 18 minutes with 4 threads, then rows 7 and 8
bun lab/recovery-toml/kinds/runs/report.ts [--write-list]     # every table of the validation split, and with the option tables.json
bun lab/recovery-toml/kinds/runs/check.ts                     # every saved table: frozen cells, valid documents, broken texts up to their first error, the scores a second time
```

- `run.ts` saves `row-7.seed-1.tables.json` and `row-7.seed-1.record.json`, and the same for row 8. A record has the fields of the records of `../../learn/runs/`, and also the key of the kinds, the samples per half, and the score rows per half, per family and per kind. A seed that has a record is not run again without `--again`. `--to 3000 --folder <folder>` tries the command on the first 3,000 indexes in a minute.
- `report.ts` scores every saved table again and stops when a table does not give the score of its record. When `<RECOVERY_SCRATCH>/neutral/tables.json` is there, the tables of the rows 4 and 5 are scored on the same samples and stand beside. `--write-list` writes `tables.json`: every saved table with its row, its seed and the sha256 of its file.
- `check.ts` ends with "Every check passed." or with a count of failures. Its top comment lists what it checks.

Nothing here reads the test split or the folder `held-back/`.

## The runs of October 16, on the validation split

Dataset 314a0404b2bd51ba, kinds 7c1dc7d0c43cb036. The mixed set has 42,082 train samples, 21,041 of each half, and 5,382 validation samples, 2,691 of each half. Rows 7 and 8 ran once with the seeds 1 to 5. Nothing was changed after a score, and no run failed. A cell holds all three and whole samples in percent, and a number with brackets is the mean of the seeds with the lowest and the highest.

| | The mixed validation split: 5,382 samples, 817,204 scored code points | Its half of the dataset: 2,691 samples, 357,086 | Its half of the kinds: 2,691 samples, 460,118 |
| --- | --- | --- | --- |
| row 1, the parser as it is | 67.49 / 10.83 | 62.86 / 11.63 | 71.09 / 10.03 |
| row 2, anew at the next line after an error | 89.12 / 36.49 | 91.05 / 34.49 | 87.62 / 38.50 |
| row 7, the training, the count, the last step | 90.40 (89.78 to 91.12) / 34.12 (28.65 to 36.64) | 89.73 (88.70 to 90.20) / 32.19 (27.57 to 35.53) | 90.92 (90.41 to 91.88) / 36.06 (29.73 to 39.76) |
| row 8, the same with the search before the count | 97.34 (97.21 to 97.48) / 64.53 (62.78 to 65.64) | 95.68 (95.50 to 95.83) / 52.31 (50.98 to 54.37) | 98.63 (98.45 to 98.83) / 76.74 (74.58 to 78.56) |
| beside: row 4, trained on the dataset's damage alone | 88.62 (87.19 to 89.58) / 30.12 (28.61 to 31.31) | 90.63 (89.05 to 91.68) / 32.84 (31.85 to 34.67) | 87.06 (85.74 to 88.06) / 27.40 (25.38 to 29.10) |
| beside: row 5, the same with the search | 93.84 (93.41 to 94.18) / 50.09 (48.92 to 51.06) | 96.26 (96.19 to 96.36) / 54.73 (53.36 to 56.89) | 91.96 (91.26 to 92.61) / 45.46 (43.78 to 47.05) |

- **Row 7 is above the one rule on the half of the kinds and below it on the half of the dataset, in every seed, in all three.** Its lowest seed has 90.41 on the half of the kinds, where the rule has 87.62, and its highest seed has 90.20 on the half of the dataset, where the rule has 91.05. In whole samples its mean is below the rule on both halves, and one seed of five is above the rule on each.
- **What row 7 loses is what row 4 loses: the name of a header after an error.** 49.7% (43.2 to 52.8) of the 25,492 code points of header names are right in the half of the dataset and 36.7% (30.1 to 43.6) of 32,825 in the half of the kinds, against 94.9% and 93.9% for the rule. So a kind that only adds whole lines, where the rule has 100%, loses 4 to 9 points, e.g. `codeFence` alone has 91.3% (89.6 to 92.1).
- **What row 7 adds is in the kinds that starting anew at the next line does not help,** e.g. on the samples with that kind alone: `carriageReturnLineEnds` 93.5% against 31.7% for the rule, `inlineTableOnLines` 94.8% against 62.1%, `linePrefix` 90.9% against 62.8%, `colonForEquals` 92.8% against 68.8%, `foreignQuotes` 86.3% against 71.0%.
- **Row 8 is above the rule in every seed, on both halves, in all three and in whole samples**: by 4.63 points of all three and 17.8 of whole samples on the half of the dataset, and by 11.0 and 38.2 on the half of the kinds. Header names are right at 97.3% and 98.9%.
- **The kinds in the training are worth 6.67 points of all three and 31.3 of whole samples on the half of the kinds**, row 8 against row 5, and 3.86 and 8.7 without the search, row 7 against row 4. On the half of the dataset the rows of the mixed set are a little lower than the rows trained on the dataset alone, which had twice as many such train samples: row 8 is 0.58 points of all three and 2.4 of whole samples below row 5.
- **The training does not fit the train split**, as in row 4: row 7 has 90.51% (89.96 to 91.39) there. Row 8 has 98.36% (98.32 to 98.43). The search takes 58 to 65 seconds after a training of 825 to 1,090, and its fourth pass still changes cells in every seed.
- **Where row 8 stays low**, on the samples with the kind alone: `otherBrackets` 79.4% (70.9 to 90.9) of 12 samples, `unescapedQuote` 84.5% of 5, `valueOnNextLine` 89.2% (85.6 to 99.5) of 15, `arrayWithoutBrackets` 90.6% (86.0 to 97.2) of 28. The README of the folder above says of each of them that no tables can show all of it, or that it needs a rule that another kind excludes. `unescapedBackslash` has 94.7% of 7 samples, with one seed at 75.5%. Fewer than half of the samples are right as a whole for `unquotedString` (45.4% of 133) and `entriesOnOneLine` (45.6% of 36), and for six kinds with 5 to 23 samples.

On the validation split of the dataset's standard set, 5,382 samples with 709,413 scored code points, which is where `../../learn/runs/README.md` reports: row 7 has 89.82 (89.05 to 90.41) / 32.95 (28.26 to 35.84) and row 8 has 95.96 (95.73 to 96.09) / 52.89 (51.51 to 55.00), next to 91.45 / 36.03 for the rule, 90.70 / 33.64 for row 4 and 96.51 / 55.59 for row 5. `report.ts` gives the rows 1, 2, 4 and 5 there the numbers of that README.

## How the damage itself is shown

No label is the display kind `error`, so the shares do not say how an added code point is shown. Added code points that are shown as an error:

| | mixed, of 44,348 | half of the dataset, of 22,984 | half of the kinds, of 21,364 |
| --- | --- | --- | --- |
| rows 1 and 2 | 9,137 | 1,651 | 7,486 |
| row 7 | 614 (329 to 1,394) | 43 (3 to 176) | 570 (326 to 1,218) |
| row 8 | 1 (0 to 3) | 0 (0 to 2) | 1 (0 to 3) |

## The classes that the rule picked

The rule does not depend on the seed. On the mixed train split it picks 25 code points, where it picks 18 on the dataset's train split alone. The 7 more: the no-break space, the byte order mark, the backtick, `“`, `”`, `;` and `K`. The first six come from the kinds, e.g. the backtick is an added code point at 94% of its 5,537 occurrences, most of them the fences of `codeFence`. `K` has a distance of 0.50 here and 0.49 on the dataset alone. The first that are not picked: `%` at 0.47, `F`, `D`, `H`, and `<` at 0.42. The parentheses are not picked either, at 0.26, nor is the escape character, which is always added, as is the rest of its class. `report.ts` prints the table.

## What was checked

`check.ts` on the 10 saved tables ends with "Every check passed.":

- Each file loads, so its 3,534 frozen tokenizer cells, 266 frozen grammar cells and 150 display entries that are not open hold today's. Its sha256 is the one of its record and of `tables.json`.
- 49,084 valid texts get today's trace at all 513 positions: the 47,458 documents of the mixed set, the valid texts of the checks of `../../learn/`, and 175 texts with one of the 25 picked code points in a comment or in a string, since no document has e.g. a no-break space.
- 71,975 texts with an error get today's trace up to their first error, the 23,732 broken texts of the kinds among them.
- 2,000 valid texts that are too deep are shown as today.
- The scores of every record are counted a second time from the samples' own labels, without the arrays of `../../learn/data.ts`: the same scored code points, right code points and whole samples, on the mixed validation split and on each half.

The trial on the first 3,000 indexes ran twice with seed 1 and saved the same two files, byte for byte.

## Known limits

- **The half of the kinds on validation is made by the same 49 kinds as its train half**, on other documents. So its numbers say how well the tables take up these kinds, and not how they do on a mistake that the kinds' author did not write. The held-back test is for that.
- **The kinds are small on validation.** 18 of the 49 have fewer than 25 samples with the kind alone, e.g. `unescapedQuote` has 5.
- **A record lists the files that differed from the commit when its run started.** They are the report of this folder and files of another agent's folder, `learn/handwritten/`. A run executes none of them: all 10 records have the same hash of the executed files.

## Files

- `mixed-runs.ts`: the rows, the record, and `scoreRowsOfMixed`, the score rows per half, per family and per kind.
- `run.ts`, `report.ts`, `check.ts`: the commands above.
- In `recovery-scratch/transfer/toml/runs/mixed/`: the 10 files of tables with their records, `tables.json`, `report.md`, `check.txt`, and `logs/` with the output of every run.
