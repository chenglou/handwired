# The runs of the frozen recipe on the dataset as it is

The dataset of the folder above `learn/` has damage that knows nothing of TOML: ten edits on code points and lines. These commands run the recipe of `../recipe.ts` on its train split with nothing tuned, save the tables of every run with a record, and score them on the validation split. They make three rows of the experiment:

- **Row 4**, the primary row: the training, then the count and the last step, i.e. `primary` of `runRecipe`.
- **Row 5**: the same with the search before the count, i.e. `withSearch` of the same call. One training gives both rows.
- **Row 6**: the search and the count from the recipe's base, without the training. It is the control "search-alone" of `lab/recovery-parser/learn/arms/combined/combined.ts`, the recipe `counted(searched(untrained)(1))` there: the same cells, the same four passes, the same order per seed. That control has no last step, so row 6 has none, and a record of row 6 also holds the score with the last step added.

Rows 1 and 2, the parser as it is and the rule "anew at the next line after an error", take no run: `table.ts` and `report.ts` score them next to the saved runs.

## Commands

Run from the repo root. The tables and the records go to `<RECOVERY_SCRATCH>/neutral/`, or to `--folder`.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-toml/learn/runs/run.ts --rows 4,5 --seed 1     # one training, about 13 minutes with 4 threads, then rows 4 and 5
bun lab/recovery-toml/learn/runs/run.ts --rows 6 --seed 11      # the search and the count without the training
bun lab/recovery-toml/learn/runs/table.ts [--write-list]        # the table of all saved runs, and with the option tables.json
bun lab/recovery-toml/learn/runs/check.ts                       # every saved table: frozen cells, valid documents, broken texts up to their first error
bun lab/recovery-toml/learn/runs/report.ts                      # the breakdowns, what the search changes, and samples
```

- `run.ts` saves `row-4.seed-1.tables.json` and `row-4.seed-1.record.json`. The record holds the settings, the dataset's key, the commit, a hash of the files of `learn/` that the run executed, the times, every row of the score on the validation split, the row "all" on the train split, and what the tables show on valid texts that are too deep. A seed that has a record is not run again without `--again`. `--to 3000 --folder <folder>` tries the command on the first 3,000 samples in a minute.
- `table.ts --write-list` writes `tables.json`: every saved table with its row, its seed and the sha256 of its file. A final scoring takes exactly these files.
- `check.ts` ends with "Every check passed." or with a count of failures. Its top comment lists what it checks.

Nothing here reads the test split or the folder `held-back/`.

## The runs of October 16, on the validation split

Dataset 314a0404b2bd51ba, the standard set: 42,082 train samples, and 5,382 validation samples with 709,413 scored code points. Rows 4 and 5 ran once with the seeds 1 to 5, row 6 with the seeds 11, 12 and 13, as the JSON control did. Nothing was changed after a score, and no run failed. A number with brackets is the mean of the seeds with the lowest and the highest.

| | all three | whole | display kind | depth | container |
| --- | --- | --- | --- | --- | --- |
| row 1, the parser as it is | 64.14 | 12.02 | 86.25 | 69.77 | 81.43 |
| row 2, anew at the next line after an error | 91.45 | 36.03 | 93.92 | 95.65 | 97.26 |
| row 4, the training, the count, the last step | 90.70 (89.23 to 91.68) | 33.64 (32.48 to 35.23) | 94.68 (93.30 to 96.77) | 92.97 (91.64 to 93.81) | 94.24 (92.86 to 95.06) |
| row 5, the same with the search before the count | 96.51 (96.37 to 96.63) | 55.59 (54.31 to 57.30) | 97.76 (97.66 to 97.85) | 98.27 (98.18 to 98.33) | 98.90 (98.79 to 99.00) |
| row 6, the search and the count without the training | 95.82 (95.62 to 95.94) | 51.14 (48.42 to 53.34) | 97.22 (97.14 to 97.27) | 98.01 (97.89 to 98.11) | 98.71 (98.63 to 98.80) |

- **Row 4 is not above the one rule on validation.** Two of its five seeds are above the rule in all three, 91.68 and 91.66 against 91.45, and none is in whole samples. What it loses is the name of a header after an error: 49.5% (36.7 to 56.2) of the 50,459 code points of header names are right, against 94.8% for the rule and 0% for the parser as it is, which counts the `[` of such a header as the start of an array. Row 4 is ahead of the rule in strings, 94.8% against 87.3%, in escapes, numbers, comments and white space, e.g. on the rest of the line of the error, which the rule shows as the parser as it is does. The rule is ahead in keys and punctuation too, 97.1% against 94.7% and 90.4% against 86.4%.
- **The training does not fit the train split either**: row 4 has 90.72% there, so the row is not held back by what differs between the splits.
- **The search is what gets above the rule**, with or without the training: row 5 is 5.06 points of all three and 19.6 of whole samples above the rule, in every seed, and header names are right at 97.4%. Its four passes take 35 to 40 seconds after a training of about 700, and its last pass still changes cells in every seed.
- **With the training before the search, the mean is 0.69 points of all three and 4.45 of whole samples higher**, and the ranges of rows 5 and 6 do not overlap in either. The two rows ran with other seeds, as on the JSON side.
- **Every row but the first two shows almost no added code point as an error**: 24 (8 to 48), 1 (0 to 2) and 6 (5 to 7) of 45,815, where the parser as it is shows 3,187.

`report.ts` prints all of it with the breakdowns and with samples of row 4 against the rule. The saved files are in `recovery-scratch/transfer/toml/runs/neutral/`: the tables and records, `tables.json`, `table.md`, `report.md`, `check.txt` and the logs.
