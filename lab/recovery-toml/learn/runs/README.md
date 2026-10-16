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
