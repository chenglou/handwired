# The final scoring

This folder scores the tables that the experiment ends with on the two sets that were kept for the end: the test split of the dataset, and the written evaluation set of `../../written/`. It is meant to run once, after every choice between tables is made on the validation split. Read `../README.md` and `../arms/README.md` first: the words are theirs.

- **The test split** holds four kinds of damage and one template that training never sees. Nothing in `learn/` loads it unless the environment variable `RECOVERY_FINAL` is `yes`, see "The test split" in `../arms/README.md`.
- **The written set** is 240 broken JSON texts that agents wrote without seeing the generator, each repaired by two more agents. A code point is scored where all three opinions agree. Before the final run only five tables are scored on it: today's tables and the dataset's four hand rules (`stay`, `resync`, `words`, `lines`), whose numbers are in the set's README already. Any other tables need `RECOVERY_FINAL=yes`, e.g. the hand-written rules and whatever a training made.

Whoever builds or chooses tables does not read `../../written/`, and does not run the commands of this folder with `RECOVERY_FINAL`.

## The list file

`run.ts` takes one file: a JSON list of entries. An entry is one row of the report, e.g. the five seeds of one setting of an arm.

```json
[
  {
    "name": "plain pass",
    "description": "arms/plain-pass/: every open cell trainable, one pass, defaults, the seeds 1 to 5",
    "tables": ["arms/plain-pass/one-pass/seed-1.tables.json", "arms/plain-pass/one-pass/seed-2.tables.json"],
    "confirmationTables": ["arms/plain-pass-again/one-pass/seed-11.tables.json"]
  },
  {
    "name": "search from the hand-written tables",
    "description": "the number to beat, one search in one order",
    "tables": ["/absolute/path/to/search/search-from-handwritten.json"]
  }
]
```

- `name` is the row's name in every table of the report, and `description` says what the tables are. Neither holds a line break or the character `|`.
- `tables` are files of saved tables, one per seed, as `runArm` saves them. Every number of the row is the mean over these files, with the lowest and the highest in brackets, or one number for one file.
- `confirmationTables` is optional: tables of the same setting that were made after the setting was chosen, e.g. with the seeds 11 to 15. They are a row of their own, named `<name>, confirmation files`.
- A path that is not absolute is read from the folder of the list file.
- The six baselines of `../arms/harness.ts` come first in every table, without an entry. The number to beat is not one of them: give it an entry, as above.

A list with a field that an entry does not have is refused, e.g. a misspelled `confirmationTables`. So are two rows with one name, a file that a row names twice, a file that an entry names in `tables` and in `confirmationTables`, and a file of tables that was saved with another dataset key.

## Commands

Run from the repo root.

```sh
export RECOVERY_SCRATCH=<the experiment's scratch folder>
bun lab/recovery-parser/learn/final/check.ts                                # the check of this folder, about 5 s. check-all.ts runs it too
bun lab/recovery-parser/learn/final/run.ts --dry-run <list.json>            # a dry run, a few seconds
RECOVERY_FINAL=yes bun lab/recovery-parser/learn/final/run.ts <list.json>   # the final run, once

bun lab/recovery-parser/learn/final/show.ts --case documents-and-web-01 now lines                  # a case of the written set, with two of the five tables
bun lab/recovery-parser/learn/final/show.ts --sample 20261015:163 --nesting hand-written mine=<tables.json>   # a sample that is not in the test split
bun lab/recovery-parser/learn/final/show.ts --differs words lines words lines                      # the cases that one tables have whole and the other do not
RECOVERY_FINAL=yes bun lab/recovery-parser/learn/final/show.ts --differs hand-written mine hand-written mine=<tables.json>
RECOVERY_FINAL=yes bun lab/recovery-parser/learn/final/show.ts --differs hand-written mine --in test hand-written mine=<tables.json>
```

`run.ts` prints the report and writes it as `<list name>.report.md` into `<RECOVERY_SCRATCH>/final/`, with every count next to it as `<list name>.counts.json`. The report has one table for the validation split (all three, all three within reach of the tables, whole samples), one for each of the four ways a test sample can be held out and one for the whole test split, and one for the written set (the cases with full agreement: code points right and whole cases right, over every case and over the two parts that `kinds.txt` makes). The file of counts holds, per file of tables, every row of the score on the validation split and on the whole test split, the rows of the groups for each of the four parts, and every part of the written set's score, also per writer's file.

Like `../arms/final.ts`, a final run appends a line to `<RECOVERY_SCRATCH>/arms/final-runs.log` before it loads a sample: the time, the dataset's key, the commit of the worktree and whether the worktree has uncommitted changes, the command, and the name, the path and a hash of each file of tables. `show.ts` appends such a line on every run with `RECOVERY_FINAL=yes`. The commit is there because no key covers the code that scores, e.g. `../score.ts`. A line that was written before the log held the commit has none, e.g. the line of the final run of 2026-10-16.

`show.ts` takes tables as `<name>=<tables.json>`, or as a name that needs no file: `now`, `stay`, `resync`, `words`, `lines` and `hand-written`. Its first comment explains the rows. It needs `RECOVERY_FINAL=yes` for a case of the written set with tables other than the five, and for every sample of the test split.

## What a dry run shows, and what it does not

A dry run needs no `RECOVERY_FINAL`. Every line that it prints or writes into its report starts with `dry run: `, its two files are named `<list name>.dry-run.report.md` and `<list name>.dry-run.counts.json`, and it writes no line to the log.

It shows that the list is read as meant, that every file loads and is of this dataset, that tables with added classes, open display entries and the bit "first on its line" run, and what the report will look like. Its validation table is the real one: the numbers are those of the arms' records.

It does not show:

- **Anything about the test split.** It loads no test sample. In its place stands the validation split again, with held-out bits that are made up from a sample's place: of every 10 samples, 4 have nothing held out, 1 a kind, 3 the template and 2 both. So its tables under "The test split" say nothing about held-out damage. The loading of the test split itself is a code path that no check and no dry run takes, so `run.ts` checks it when it loads the split. It stops unless every index from 0 to 59,999 stands once in the loaded set and the loaded set without its test samples has the indexes of the standard set, place by place, and it stops when the four parts do not add up to the whole split.
- **Anything about the written set for the tables of the list.** It scores the five tables there and writes "left for the final run" for every other row.

## The written set in the exact parser

`scoreWritten` of `written-score.ts` runs the experiment's exact parser and counts as `../../written/score.ts` counts. The numbers of the five tables are still not the ones of the set's README, because the two parsers differ: the README's are of the dataset's plain table parser, which keeps the open containers in a running sum, and the exact parser keeps a real stack, see `../plain-tables.ts`. E.g. after the `}` of `{"a": [1}, "b": 2}` the sum goes on with an array as the innermost container, so `"b"` is shown as a string, and the stack goes on with the object, so `"b"` is shown as a key. The table has the code points that are right and the whole cases, in percent, over the 221 cases with full agreement. In brackets are the two counts: of 19,343 scored code points, and of 215 cases with something to recover.

| tables | the plain table parser, as in the set's README | the exact parser, as `scoreWritten` counts |
| --- | --- | --- |
| `now` | 22.0 / 2.3 (4,265 and 5) | 22.1 / 2.3 (4,283 and 5) |
| `stay` | 50.4 / 18.1 (9,757 and 39) | 50.7 / 18.6 (9,808 and 40) |
| `resync` | 62.5 / 45.1 (12,090 and 97) | 62.8 / 45.6 (12,141 and 98) |
| `words` | 75.6 / 49.8 (14,625 and 107) | 75.9 / 50.2 (14,676 and 108) |
| `lines` | 76.1 / 50.2 (14,714 and 108) | 76.3 / 50.7 (14,765 and 109) |

The two parsers show something else in 7 to 9 of the 240 cases, and the right code points differ in two cases with full agreement, both with a closing bracket of the wrong kind. The final report gives the exact parser's numbers for every row, so that the baselines and the trained tables are read in the same parser.

`check.ts` holds the two sides against each other. With the plain table parser in the exact parser's place, the counting of `written-score.ts` gives every count of `../../written/score.ts`, for each of the five tables and in every part: 1,000 counts. With the exact parser, the counts are the same over the cases in which the two parsers show the same at every code point. The depth is the same at every code point of every case, and no display kind differs before the first code point at which the two parsers read another context.

**The check plants its faults without scoring any other tables on the written set.** On the set, the counts of one of the five tables are held against the counts of another, and differ for all 20 pairs. One changed cell is tried on cases that the check makes up, e.g. `{"a": 1 "b": [true, null]}`: there the exact parser's counts are the plain parser's for each of the five tables, and no longer with one changed open cell.

## Files

- `written-score.ts`: `scoreWritten(tables)`, the score of tables of the experiment on the written set, as counts in the parts of `../../written/score.ts`. `scoreWrittenWith` scores any parser over any cases, `scoredOnTheSetAlready` says whether tables are one of the five, and `sharesOfWritten` turns a score into shares.
- `run.ts`: the final run and the dry run.
- `show.ts`: one case or one sample with what named tables show for it, and `--differs`.
- `check.ts`: the check of this folder, in seven parts, see its first comment. It reads no test sample, and it scores only the five tables on the written set.
