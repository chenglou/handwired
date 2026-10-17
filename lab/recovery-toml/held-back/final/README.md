# The final scoring of the TOML track

**Do not read this folder if you build the parser, the train data, the training or its machinery.** See `../README.md`.

This folder scores the tables that the TOML track ends with on the two held-back sets: the generator of typical mistakes (`../specific/`) and the agent-written cases (`../written/`). For reference it also scores them on the dataset's test split, whose damage is the train data's. The scoring runs once, after the recipe and its training are frozen. It trains nothing and changes no table.

This page was written before the final run. `RESULTS.md` says what came out.

## The rows

The lead fixed the rows before any training on TOML.

| Row | What it is | Files |
| --- | --- | --- |
| 1 | The parser as it is. | none: `parserAsItIs` of `../parsers.ts` |
| 2 | One rule without training: after an error, the parser as it is starts anew at the next line. | none: `restartAtNextLine` of `../parsers.ts` |
| 3 | Hand-written recovery rules in the table form, the counterpart of the JSON side's 35 rules. | 1 |
| 4 | The frozen recipe on neutral damage: the training, the count and the last step. Seeds 1 to 5. The primary row. | 5 |
| 5 | The same with the search before the count. Seeds 1 to 5. | 5 |
| 6 | The search and the count without training, on neutral damage. Seeds 11 to 13. | 3 |
| 7 | The frozen recipe on the mixed set, i.e. half neutral damage and half kinds of mistakes written for TOML: the training, the count and the last step. Seeds 1 to 5. | 5 |
| 8 | The same with the search. Seeds 1 to 5. | 5 |

The rows 4 and 7 leave out the search of the recipe. The rows 5 and 8 have it, so they are the JSON side's candidate "generic" with all of its five steps.

## The verdict's rule

The lead's rule, on the two held-back sets and in "all three", i.e. the share of the scored code points with the display kind, the depth and the container right:

- **"Carried over with neutral damage alone"** when row 4 with its lowest seed is above the rows 2 and 3 on both sets.
- **"Carried over with kinds written for the language"** when row 7 with its lowest seed is, and row 4 is not.
- **"Partly"** when a trained row is above row 2 but not row 3, or on one set only.
- **"Failed"** when no trained row is above row 2.

How this folder reads the rule, fixed before the run in `verdictOf` of `report.ts`:

- The two sets are every sample of the generator's set, and the cases of the written set with full agreement.
- **The lowest seed of a row on a set is the seed with the lowest "all three" on that set.** So the lowest seed can be another seed on the other set. E.g. on the dataset's validation split, row 7's lowest seed is seed 4 and its highest is seed 1.
- "Above" is more than, by any margin. A row that is level with another row is not above it.
- The trained rows of "partly" and "failed" are the rows 4 and 7, each with its lowest seed: "partly" when one of the two is above row 2 on at least one set and neither of the first two verdicts holds, and "failed" when neither is above row 2 on either set.
- The rows 5, 6 and 8 are reported beside and decide nothing. The report has a table of every trained row against the rows 2 and 3, so another reading of the rule can be checked against the same numbers.

Whole samples are reported and not required.

## The list

`list.json` names the 24 files of saved tables with their row, seed and sha256. `list.ts` made it from the three lists that the training side left: `runs/neutral/tables.json` (rows 4, 5 and 6), `runs/mixed/tables.json` (rows 7 and 8) and `handwritten/tables.json` with the file `tables.json.sha256` beside it (row 3), all below `recovery-scratch/transfer/toml/`. A list is fixed once: `list.ts` refuses to write another list over it.

The paths in `list.json` are relative to that folder, the scratch folder of the TOML track, and every command that reads the list takes the folder from the environment variable `RECOVERY_SCRATCH`. At the final run the file held full paths and had the sha256 `98d86bb47ba52e49a79e21ac9f01be7e7a9d9f7b60ad6557238fb36341f7fd69`, which the run's log and `final-report.md` name: the paths were made relative after the run, so that the published file names no folder of the machine, and the sha256 of every file of tables in the list is as it was. The history was also rewritten when it was published, to take the same folders out of older versions of files, so the commit of the run, 469f614 in the run's log, is 6a3e159 in the published history. `final-report.md` and `RESULTS.md` give the published hash.

The review of the training made two tables by a search from the hand-written tables, which are about a point above row 3 on validation. They are not in the list: row 3 is the rules alone.

## Commands

Run from the repo root. `RECOVERY_SCRATCH` is the scratch folder of the TOML track, i.e. the folder outside the repo that holds `runs/`, `handwritten/` and `held-back/`, which these pages name `recovery-scratch/transfer/toml/`. `<out>` is a folder below its `held-back/`, e.g. `$RECOVERY_SCRATCH/held-back/final`.

```sh
export RECOVERY_SCRATCH=<the scratch folder of the TOML track>
bun lab/recovery-toml/held-back/final/check.ts                                      # the check of this folder, about 6 s
bun lab/recovery-toml/held-back/final/run.ts --dry-run --out <out>                  # a dry run, about 25 s
RECOVERY_FINAL=yes bun lab/recovery-toml/held-back/final/run.ts --out <out>         # the final run, once
bun lab/recovery-toml/held-back/final/report.ts <out>/final.counts.json <file.md>   # the report of saved counts again, without scoring
```

## What a run does

**Before a text is scored**, `run.ts` stops unless all of this holds:

- `list.json` is what the three lists of the training side give now, and it was made with the dataset as it is.
- Every file has the bytes that its sha256 names.
- Every file loads: it was saved with this dataset, and its tables keep the ground rules. A frozen cell and a display entry that is not open hold what they hold today, and every cell that differs from today's is an open one.
- A final run has `RECOVERY_FINAL=yes`, and the log holds no final run yet. A final run after one that does not count takes `--again "<why>"`, and the reason goes into the log.

**Then it scores** every row on three sets, with the counts of `count.ts`:

- **The generator's set**, the samples 0 to 2,999: every sample, per kind of mistake, per group, per number of mistakes, and the documents of the two held-out templates apart.
- **The written set**, 150 cases: the cases with full agreement, and every case over its agreed code points. Both again for the cases whose damage one to three of the ten neutral edits could make, for the cases with other damage, for the cases of which no repair is marked as unsure, and per writer's file.
- **The dataset's test split**, the samples of the standard set whose document is in the test split: every sample, the documents of the two held-out templates and the other documents apart, per number of edits and per kind of edit.

Per row of a set it counts the texts, the scored code points, those with every scored value right ("all three"), the texts that are right as a whole ("whole"), and how many of the code points that the damage added are shown as an error. For each set's main row it also counts per display kind of the label, e.g. over the code points whose label is the name of a header.

**While it scores, it checks.** A failed check does not stop the run: it is written at the top of the report under "Problems of this run", so that no number is made a second time.

- **A second count.** Every count that a set's own scorer also makes is held against that scorer: `../specific/score.ts`, `../written/score.ts` and `../../learn/score.ts`. Those run the tables through another function than `count.ts` does.
- **Added structure alone changes nothing.** For each list of added classes among the files, tables with those classes, open display entries and the bit "first on its line", and with no cell changed, have the counts of the parser as it is in every row.
- **As today where the ground rules ask for it.** Every table shows every valid document of the three sets, and every broken text before its first error, as the parser as it is shows them.
- **The dataset's split** has the sizes that the dataset's README gives: 12,536 samples, 7,336 of them of a held-out template.

**It writes** into `<out>`: `final.counts.json` with every count per file of tables, then `final.report.md`, and before any scoring one line into `final-runs.log` with the time, the commit, the command, and the path and sha256 of every file. Every file starts with a line that says that it is held back.

## What a dry run shows, and what it does not

A dry run needs no `RECOVERY_FINAL` and refuses to run with it. Every line of its report but the first starts with `dry run: `, its files are `dry-run.counts.json` and `dry-run.report.md`, and it writes no line to the log.

- **On the two held-back sets it scores only the rows 1 and 2 and the tables with no cell changed.** The rows 1 and 2 have to come out as `../README.md` gives them: 69.3 / 9.5 and 89.8 / 37.9 on the generator's set, and 61.7 / 4.9 and 84.2 / 29.6 on the written cases with full agreement. The rows 3 to 8 read "left for the final run" there.
- **It reads no sample of the dataset's test split.** In its place stands the validation split, and every file of the list is scored on it. The training side has those numbers already, so they show that the list is read as meant: e.g. row 4 has 90.70 (89.23 to 91.68) / 33.64 there. The rows of the held-out templates are made up from a sample's place, since the validation split has no document of a held-out template.
- **It does not show** anything of the rows 3 to 8 on a held-back set, the loading of the test split, or the verdict. `check.ts` writes the report of a final run with made-up counts for that.

## Files

- `list.ts`, `list.json`: the fixed list, see above.
- `sets.ts`: the three sets as broken texts with their labels, their added code points and the rows that count them.
- `count.ts`: the counts of a parser over a set, the counts per display kind of the label, and the check against the parser as it is.
- `second-count.ts`: the counts held against the sets' own scorers.
- `report.ts`: the verdict, the report, and the command that writes the report of saved counts again.
- `run.ts`: the dry run and the final run.
- `check.ts`: the check of this folder, see its first comment.
- `final-report.md`, `RESULTS.md`: a copy of the final run's report, and what it says. Both are added after the run. The copy writes the scratch folder as `<RECOVERY_SCRATCH>` and `list.json` by its path from the repo root, where the report of the run has full paths.
