# Where the trained tables win and lose on the held-back sets

**Do not read this folder if you build the parser, the train data, the training or its machinery.** See `../../README.md`.

The final scoring (`../RESULTS.md`) gave one number per row and kind. This folder asks where the trained tables are above and below the one rule (row 2) and the hand-written rules (row 3), code point by code point, and why. It runs the 24 files of `../list.json` on the two held-back sets again and keeps the outcome of every code point. It trains nothing and changes no table, and the final command does not run again: `load.ts` stops unless its count of right code points is the final run's for every text and parser, which holds for all 81,900 counts.

## Commands

Run from the repo root. The outputs show the held-back sets, so they go below `recovery-scratch/transfer/toml/held-back/`, e.g. into `.../held-back/final-where/`. The scripts ask for `RECOVERY_FINAL=yes`, since they run tables with changed cells on the held-back sets. All but the last also ask for `RECOVERY_SCRATCH`, the scratch folder of the TOML track (`recovery-scratch/transfer/toml/`), where they read the files of `../list.json` and the saved counts of the final run. Each takes about 5 seconds.

```sh
export RECOVERY_SCRATCH=<the scratch folder of the TOML track>
RECOVERY_FINAL=yes bun lab/recovery-toml/held-back/final/where/report.ts > <out>/where.txt                 # every table, in six sections
RECOVERY_FINAL=yes bun lab/recovery-toml/held-back/final/where/report.ts --cases > <out>/written-cases.txt # the 150 written cases one by one
RECOVERY_FINAL=yes bun lab/recovery-toml/held-back/final/where/examples.ts > <out>/examples.txt            # six texts with two rows' outputs under them
RECOVERY_FINAL=yes bun lab/recovery-toml/held-back/final/where/show.ts hand-editing-20 3 8.1 --lines 10-11 # one text, here with row 3 and row 8, seed 1
bun lab/recovery-toml/held-back/final/where/train-commas.ts                                                # what a comma at depth 0 is in the neutral train data
```

## Files

- `load.ts`: every parser of the final scoring on both sets, with the outcome of each code point and what the parser shows there, and the check against the saved counts of the final run.
- `report.ts`: the tables. Where the wrong code points are, per kind of the generator, what the kinds written for the training side add, how failures look, what the search does, and the written cases.
- `tags.ts`: for each of the generator's 36 kinds and each of the 150 written cases, whether one of the 49 kinds of the training side makes the mistake. It is one reader's judgment, and nothing checks it.
- `show.ts`, `examples.ts`: one text with the wanted labels and some parsers' outputs under it, and the six examples.
- `train-commas.ts`: a count on the train split for the sixth example. It reads no held-back text.

## What came out

`recovery-scratch/transfer/toml/held-back/final-where/notes.txt` has the findings with their numbers. In short, for the generator's set:

- **The rows 4 and 7 lose to the one rule in one place, the headers after an error.** On the later lines with a header, 54,193 code points, the rule has 98.75% right, row 4 has 50.29% and row 7 has 47.31%. On all other code points both are above the rule: 91.16% and 95.74% against 88.69%.
- **The reason is the grammar state in which a later line starts.** Today's tables read a header only from the state `lineStart`. Without the search the trained tables are in that state at 39% and 35% of the starts of later lines, and with the search at 83% and 89%.
- **Training on neutral damage alone misses the other notations.** On the 1,335 samples whose damage one to three neutral edits could make, row 5 has 97.66% against 98.55% for the hand-written rules. On the other 1,665 it has 89.73% against 98.75%, and row 8 has 98.16%.
- **The kinds written for the training side add nothing where they do not hold the mistake.** On the 15 written cases with full agreement that no training kind holds, row 8 has 75.94% and row 5 has 76.09%.
- **Row 8 and the hand-written rules fail alike:** in 518 and 550 of 3,000 samples, with a median of 5 wrong code points in such a sample.
