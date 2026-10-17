# Extra facts: character classes, open display entries, and the bit "first on its line"

Today's tables decide by four things: the class of the character, the tokenizer state, the token and the context. Some damage cannot be told apart by those four, and the dataset says which samples. 326 broken validation samples are in the group "needs a character class", e.g. a string in single quotes with a space in it, where the apostrophe is in one class with most letters. 37 are in "needs a display fix", where what is shown follows from the event and the grammar state after it by a fixed table. 488 are in "needs a line rule", where it matters that a token is the first on its line. `../../structure/` has an addition for each: more character classes, open entries of the display table, and a bit that tells the grammar whether a token is the first on its line.

The question of this arm: **when training gets one of these additions, does it use it?** Every addition is measured against the same training without it, with the same setting of the trainer and the same seeds.

## What the arm shows

**Training uses the character classes. It uses the open display entries when its cells start from today's choices, and not when they start uniform. With the bit it gains nothing that a row of the score shows.** With all three additions and three passes from today's choices, training from today's tables ends above the number to beat in each of ten seeds, 98.03 and 98.08 against 97.75. Three things stand against that row. A search without gradients whose display entries are set by a count is not told apart from it. Each of its ten seeds has wrong depths on valid JSON deeper than 16 levels, which the dataset has no sample for. And in the group "within reach of the tables" it is at the number to beat, not above it.

The numbers are of the validation split and the exact parser. A number with brackets is the mean over the seeds 1 to 5 with the lowest and the highest seed, and every setting ran once. The trainer has four settings here, named by their passes over the train samples and by where a trainable cell starts: `plain` is one pass from the choice of the base, `three-base` is three passes from there, and `one-uniform` and `three-uniform` start from a uniform mix.

1. **Character classes are used**, with both settings of the trainer that they ran with. With 15 classes chosen by hand, all three goes from 96.50 (95.88 to 96.74) to 97.25 (97.21 to 97.33) with `plain` and from 96.88 (96.69 to 97.02) to 97.61 (97.52 to 97.68) with `three-uniform`, and the group "needs a character class" from 89.7 to 94.7 and from 91.0 to 96.3. No pair of these ranges overlaps. Within reach the classes are not told apart from no addition. The hand choice saw the dataset's descriptions of the damage. A rule that reads only the train samples picks 11 code points, 9 of them among the 15, and gains 3.9 and 3.8 points in the group where the hand choice gains 5.1 and 5.2.
2. **Open display entries are used from a start at the base's choices, and not from a uniform start.** From the base's choices all three goes from 96.50 to 97.49 (97.36 to 97.71) with one pass and from 96.80 (96.61 to 96.99) to 97.69 (97.64 to 97.79) with three, with ranges that do not overlap. From a uniform start it goes from 96.62 to 96.35 with one pass and from 96.88 to 96.98 with three, with ranges that overlap. The gain is not in every group: "needs a line rule" has a lower mean with the entries with all four settings of the trainer, and with three of them its range is below the range of no addition.
3. **Setting the display entries by a count after the training, without gradients, is a small gain that came in every run**: 0.11 to 0.26 points in each of 20 runs, where the two sides are the same tables with other display entries. From a uniform start the count does as well as training the entries, or better.
4. **The bit "first on its line" is not told apart from no addition**, on all samples, within reach or in its own group, with both settings of the trainer that it ran with: 96.69 (96.52 to 96.83) and 97.05 (96.82 to 97.25). Its group is at 99.7 and 99.1 without the bit. It moves five and six kinds of damage, of which one is the same with both settings: `missingColon`, 29 validation samples, is above no addition.
5. **All three additions together are at the number to beat with `plain` and `three-uniform`, and above it with `three-base`**: 97.79 (97.71 to 98.01) and 97.68 (97.48 to 97.86) against 97.75, and 98.03 (97.82 to 98.13). The row of `three-base` was added last, with the validation scores of the seeds 1 to 5 in view, so it ran again with the seeds 11 to 15: 98.08 (97.78 to 98.24). All ten seeds are above the number to beat, the lowest by 252 of 675,949 code points. These runs start from today's tables, where the number to beat starts from the hand-written ones. **What the main number does not show of that row**: each of the ten seeds has the depth of valid JSON deeper than 16 levels wrong, at up to 30% and 33% of the code points in the two forms of such texts, where the hand-written tables have none. A seed shows 168 to 537 code points of the validation texts as "past the end", e.g. spaces, `(` and `;`. Within reach the row has 99.58 (99.27 to 99.68) and 99.61 (99.39 to 99.75) against the number to beat's 99.68, with one of the ten seeds above it. Whole samples are 83.60 (82.35 to 85.70) with the seeds 1 to 5 and 81.51 (79.48 to 82.38) with the seeds 11 to 15.
6. **A search without gradients gets as far.** From the hand-written tables, a search of every open cell with one count of the display entries after it ends at 97.69 to 97.87 in four orders of its cells, and the best trained row is not told apart from that. The count gives 0.06 to 0.09 points in each order. Going on with the search and the count in turns adds 0.11 points with the most read cells first and nothing in three random orders. When this arm ran, the search refused tables with added classes or with the bit, so those two additions have no comparison without gradients here. The search runs such tables now, and `../combined/README.md` has the comparison, in its point 3.
7. **A target that shows the added code points as an error is cheap at a small weight.** With open display entries and `plain`, the weight 0.1 shows 53.6% (46.0 to 59.9) of the added code points as an error, where the control shows none, for 0.15 points of all three: the two ranges overlap, and each of the five seeds is below its control, by 0.04 to 0.27 points. The weight 1 shows 78.5% and 78.0% with the two settings of the trainer, for 0.90 and 0.32 points and 6 to 11 points of whole samples. Without open display entries the target shows fewer added code points as an error in each of the five seeds, 52.6% against 65.1% at the weight 0.3, for a cost that these seeds do not tell apart: 0.41 against 0.30 points, each against its own control.
8. **What the main number does not show follows the trainer's setting more than the addition.** As means over the seeds, the depth of valid JSON deeper than 16 levels is wrong at 0% to 9% of the code points with `plain`, at 8% to 20% with `three-base`, at 40% to 71% with `three-uniform` and at 68% to 91% with `one-uniform`, for every addition.

## Setup

**A setting** is today's tables with an addition, trained on the train split, with every open cell and every open entry trainable. Its control is the setting `none`, "no addition": the same call of the trainer with the same seeds on today's tables as they are. The tables of a seed are the last ones of its run, and nothing is picked on the validation split. No setting adds a tokenizer state or a grammar state.

| key in `--settings` | the setting | open tokenizer cells | open grammar cells | open display entries |
| --- | --- | --- | --- | --- |
| `none` | no addition | 710 of 858 | 616 of 704 | 0 of 200 |
| `classes-hand` | classes chosen by hand | 1,081 of 1,248 | 616 of 704 | 0 of 200 |
| `classes-data` | classes chosen from the train samples | 985 of 1,144 | 616 of 704 | 0 of 200 |
| `display` | open display entries | 710 of 858 | 616 of 704 | 140 of 200 |
| `display-counted` | no addition, then the open display entries by a count | 710 of 858 | 616 of 704 | 140 of 200 |
| `error-target-0.1` | open display entries, added code points as an error at the weight 0.1 | 710 of 858 | 616 of 704 | 140 of 200 |
| `error-target-0.3` | open display entries, added code points as an error at the weight 0.3 | 710 of 858 | 616 of 704 | 140 of 200 |
| `error-target-1` | open display entries, added code points as an error at the weight 1 | 710 of 858 | 616 of 704 | 140 of 200 |
| `error-target-0.3-alone` | added code points as an error at the weight 0.3 | 710 of 858 | 616 of 704 | 0 of 200 |
| `bit` | the bit first on its line | 710 of 858 | 1,232 of 1,408 | 0 of 200 |
| `all` | classes chosen by hand, open display entries and the bit | 1,081 of 1,248 | 1,232 of 1,408 | 140 of 200 |
| `all-data` | classes chosen from the train samples, open display entries and the bit | 985 of 1,144 | 1,232 of 1,408 | 140 of 200 |

**The trainer's settings** are the lines of `trainerSettings` in `facts.ts`, and `run.ts` takes one by name as `--trainer`. Everything else is the trainer's default: learning rate 0.05, temperature 1, no sharpness cost.

- `plain`: one pass over the train samples, and every mix starts with a share of 0.9 on the choice of the base. This is the plain pass of `../plain-pass/`.
- `three-uniform`: three passes, and every mix starts uniform. This is the setting of `../holes/`, and its row `none` is that arm's row "every open cell trainable".
- `three-base` and `one-uniform`: the two other pairs of passes and start. They were added after the display entries had given two answers with the first two, to tell the passes from the start, with the settings `none`, `display` and `display-counted`. `three-base` then also ran with `all`, as the last run with the seeds 1 to 5.

**The seeds.** Every reported setting ran once with the seeds 1 to 5. A seed orders the samples of the training, and for the settings with the target it also draws the code points that get the target. **The confirmation**: the setting `all` with `three-base` was picked after the scores of the seeds 1 to 5 were seen, so it ran again with the seeds 11 to 15, next to its control and next to the same two settings with `plain`. Before that, the seed 11 had run once, in a try-out of the scripts with `plain`, and no seed from 12 to 15 had run at all.

**The classes chosen by hand** are one class for every character that the dataset's descriptions of the damage name as one that the tokenizer must tell apart (`needsClass` in `../../../README.md` and in `../../../damage/`). **This choice saw the dataset's description of the damage**, which names the character for every form, e.g. "the apostrophe as a quote" for a string in single quotes with a space in it. The 15 classes, with the train samples of the standard set that the dataset says need each: the apostrophe (1,596), the two round brackets (434, a class each), U+00A0 (300), the two typographic quotes `“` and `”` (265, a class each), `=` (208), the carriage return, taken out of the class that it shares with the tab (104), `x` (77, for `\xe9`), `#` (65), `;` (61), `&` (36), `m` (20, typed for a comma), the backtick (19) and `*` (6). Left out: "a colon inside a value without quotes" (18), since the colon has a class of its own already.

**The classes chosen from the train samples** come from a rule that reads no description, `codePointsOfTheRule` in `facts.ts`. For every code point at or after a first error in a train sample, the rule notes what the code point is: the event that today's parser has at its counterpart in the original, e.g. `stringStart` for an apostrophe that stands for a quote, or "added" when the damage added the code point. A code point gets a class of its own when 100 train samples or more have it there, and when its outcomes are far from the outcomes of the other code points of its class: a distance of 0.5 or more, where the distance is the share of the code point's occurrences that would have to be something else for the code point to be as the rest of its class. The two thresholds were set with the ranking of the train split in view, where the picked code points end at 0.70 and the next one is at 0.42, and before any score.

**The target at the added code points.** A code point that the damage added has no label, and no score counts it. The settings with the target give such a code point, at or after the first error, the display kind `error` as its label. The trainer's loss has no weight per code point, and its files are not this arm's to change, so **the weight is a share**: with the weight 0.3 every added code point gets the target with the probability 0.3, drawn from the seed, and with the weight 1 every one gets it. So a weight above 1 was not tried.

**Without gradients.** The display entries by a count, `displayEntriesByCount` in `facts.ts`, takes tables, e.g. the tables of "no addition" of the same seed, and sets every open display entry to the kind that the most train code points want there: the scored code points that read the entry, whose depth and container are right or not scored. What is shown changes nothing that the parser does next, so for those cells of the tokenizer and of the grammar no other display table has more scored code points of the train split right. `search-display.ts` adds a search of every open cell, with `searchCells` of `../holes/`, from the hand-written tables: the search alone, the search with one count after it, and the search and the count in turns until the count changes no entry. `searchCells` refuses tables with added classes or with the bit, so the classes and the bit have no comparison without gradients here.

**What the arm is.** It may change every open cell, and every open display entry where a setting has them. Its tables have today's states. They have more classes, 16 contexts or a changed display table where a setting says so, and `plainParserProblems` of every record names it, e.g. "the tables have 15 added character classes". The arm starts from today's tables and trains on the train split alone. On the 2,800 fixed texts of the harness, the ground rules hold for every run.

**Nothing was tuned.** No learning rate, temperature or sharpness cost was changed, and the weights 0.1, 0.3 and 1 were fixed before any run. What was chosen with validation scores in view is the trainer's setting `three-base` for the setting `all`, see [the confirmation](#the-confirmation-with-the-seeds-11-to-15). [Every setting that was tried](#every-setting-that-was-tried) has what ran with which setting of the trainer.

## Results

The validation split of the standard set, the exact parser: 5,021 broken samples, 425 of them with nothing to recover, 675,949 scored code points. Percentages of all three, and the whole samples as a share of the samples with something to recover. The groups have 3,687 samples (within reach of the tables), 326, 37, 488, 76 and 407. A table names a setting by its key of the table in [Setup](#setup).

**`report.ts` prints every table of this README under the heading that the table has here**, with the paragraph before it and the sentences after it, and it prints every sentence that is quoted from `describeComparison`, for every pair of settings. It also lists the kinds of damage that each setting moves, and the code points that a setting shows as "past the end". The text between the tables is written by hand from that output.

Two settings are compared in one of two ways. Two sets of runs are compared by their ranges over the seeds: a cell of a table says "above" or "below" when its range does not overlap the range of its control, which `report.ts` counts. Two settings that share what a seed draws are also compared seed by seed, e.g. the count, whose tables are the tables of "no addition" of the same seed with other display entries.

### The trainer's setting `plain`

1 pass, start at the base's choices, learning rate 0.05, temperature 1 to 1, sharpness cost 0. The seeds 1, 2, 3, 4, 5. A cell says "above" or "below" when its range does not overlap the range of the row `none`.

| setting | all three | within reach of the tables | whole samples | needs a character class | needs a display fix | needs a line rule | needs a nesting fix | out of reach |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `none` | 96.50 (95.88 to 96.74) | 99.11 (98.87 to 99.31) | 73.22 (72.76 to 73.54) | 89.7 (88.9 to 90.5) | 96.2 (94.2 to 96.8) | 99.7 (98.9 to 99.9) | 89.4 (83.1 to 92.8) | 81.6 (76.9 to 83.6) |
| `classes-hand` | 97.25 (97.21 to 97.33), above | 99.21 (99.07 to 99.32) | 75.26 (74.65 to 75.91), above | 94.7 (93.6 to 96.0), above | 96.7 (96.2 to 97.0) | 99.6 (99.0 to 99.7) | 91.9 (91.4 to 92.5) | 83.0 (81.4 to 83.6) |
| `classes-data` | 97.04 (96.64 to 97.19) | 99.14 (98.94 to 99.23) | 73.82 (73.04 to 74.46) | 93.6 (92.0 to 94.6), above | 95.8 (94.8 to 96.8) | 99.5 (99.1 to 99.8) | 92.0 (91.5 to 92.5) | 82.5 (81.0 to 83.6) |
| `display` | 97.49 (97.36 to 97.71), above | 99.50 (99.48 to 99.56), above | 78.52 (77.83 to 79.29), above | 95.1 (93.9 to 96.0), above | 98.9 (98.7 to 99.1), above | 99.2 (98.8 to 99.4) | 91.4 (90.6 to 92.2) | 83.3 (81.9 to 84.0) |
| `display-counted` | 96.69 (96.02 to 96.94) | 99.24 (99.01 to 99.45) | 75.21 (73.48 to 76.48) | 90.5 (89.5 to 91.3) | 97.7 (95.8 to 98.3) | 99.7 (98.9 to 99.9) | 89.4 (83.1 to 92.7) | 81.6 (76.9 to 83.7) |
| `error-target-0.1` | 97.35 (97.23 to 97.44), above | 99.39 (99.29 to 99.46) | 77.30 (76.15 to 79.24), above | 94.3 (93.5 to 95.2), above | 98.6 (98.1 to 98.9), above | 99.3 (98.9 to 99.5) | 90.9 (90.2 to 91.6) | 83.4 (82.0 to 84.7) |
| `error-target-0.3` | 97.19 (96.90 to 97.51), above | 99.30 (99.12 to 99.44) | 73.98 (71.39 to 76.35) | 93.4 (92.5 to 94.8), above | 98.6 (98.4 to 98.9), above | 98.9 (98.3 to 99.4) | 90.9 (89.7 to 91.8) | 83.9 (82.9 to 84.5) |
| `error-target-1` | 96.59 (95.60 to 96.98) | 99.02 (98.48 to 99.26) | 67.93 (64.56 to 70.93), below | 89.5 (83.9 to 92.0) | 98.2 (96.6 to 98.9) | 99.2 (98.9 to 99.4) | 91.5 (91.3 to 91.7) | 83.6 (83.3 to 84.0) |
| `error-target-0.3-alone` | 96.09 (95.33 to 96.42) | 98.83 (98.27 to 99.15) | 67.63 (57.53 to 72.06), below | 87.2 (83.8 to 88.5), below | 95.7 (93.9 to 96.4) | 99.0 (98.6 to 99.6) | 91.2 (89.4 to 92.7) | 82.6 (81.6 to 83.2) |
| `bit` | 96.69 (96.52 to 96.83) | 99.09 (98.98 to 99.25) | 72.73 (72.04 to 73.80) | 90.8 (89.8 to 91.8) | 97.0 (96.5 to 97.3) | 99.7 (99.4 to 99.9) | 90.3 (86.6 to 92.5) | 82.3 (81.7 to 83.1) |
| `all` | 97.79 (97.71 to 98.01), above | 99.53 (99.37 to 99.67), above | 82.37 (79.90 to 83.44), above | 98.0 (97.4 to 98.2), above | 99.0 (98.8 to 99.1), above | 99.2 (99.0 to 99.4) | 91.8 (91.5 to 92.4) | 82.8 (81.6 to 84.0) |
| `all-data` | 97.72 (97.48 to 97.88), above | 99.48 (99.22 to 99.65) | 81.14 (79.44 to 82.27), above | 97.5 (97.0 to 98.3), above | 98.8 (98.5 to 99.1), above | 99.3 (99.0 to 99.7) | 91.6 (90.8 to 92.3) | 82.8 (82.4 to 83.4) |

| setting | added code points shown as an error | samples that show an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | cells changed against the base |
| --- | --- | --- | --- | --- | --- | --- |
| `none` | 0.9 (0.7 to 1.1) | 6.2 (4.6 to 7.8) | 50 (0 to 160) | 3.0 (0.0 to 12.3) | 4.7 (0.0 to 16.4) | 967 (935 to 984) |
| `classes-hand` | 5.2 (3.9 to 6.2), above | 26.2 (24.1 to 28.0), above | 567 (73 to 1235) | 6.7 (0.0 to 22.3) | 9.4 (1.7 to 17.9) | 1233 (1208 to 1250) |
| `classes-data` | 3.7 (1.7 to 5.7), above | 20.2 (9.0 to 27.1), above | 350 (23 to 1297) | 2.9 (0.0 to 11.6) | 3.3 (0.0 to 9.9) | 1139 (1114 to 1149) |
| `display` | 0.0 (0.0 to 0.0), below | 0.0 (0.0 to 0.1), below | 104 (0 to 286) | 0.0 (0.0 to 0.0) | 0.7 (0.2 to 1.7) | 953 (921 to 968) |
| `display-counted` | 0.0 (0.0 to 0.1), below | 0.1 (0.0 to 0.4), below | 50 (0 to 160) | 3.0 (0.0 to 12.3) | 4.7 (0.0 to 16.4) | 997 (967 to 1011) |
| `error-target-0.1` | 53.6 (46.0 to 59.9), above | 26.1 (22.2 to 28.1), above | 9 (0 to 45) | 1.1 (0.0 to 5.6) | 0.8 (0.2 to 1.7) | 962 (940 to 990) |
| `error-target-0.3` | 65.1 (56.6 to 70.3), above | 36.7 (33.8 to 38.7), above | 6 (0 to 30) | 1.6 (0.0 to 5.6) | 2.2 (0.2 to 7.1) | 988 (977 to 999) |
| `error-target-1` | 78.5 (71.9 to 84.4), above | 43.8 (41.7 to 45.7), above | 0 | 3.5 (0.0 to 17.6) | 3.8 (0.6 to 15.4) | 983 (969 to 1013) |
| `error-target-0.3-alone` | 52.6 (44.4 to 58.3), above | 36.9 (33.2 to 42.1), above | 282 (0 to 762) | 5.4 (0.0 to 21.7) | 6.3 (0.2 to 16.6) | 974 (948 to 987) |
| `bit` | 1.1 (0.1 to 2.1) | 7.8 (1.1 to 15.0) | 39 (0 to 138) | 0.2 (0.0 to 1.1) | 2.5 (1.1 to 5.1) | 1234 (1214 to 1252) |
| `all` | 0.0 (0.0 to 0.0), below | 0.0 (0.0 to 0.1), below | 208 (127 to 244) | 5.7 (0.0 to 19.0) | 7.9 (1.5 to 24.2) | 1416 (1364 to 1461) |
| `all-data` | 0.0 (0.0 to 0.0), below | 0.0 (0.0 to 0.0), below | 123 (0 to 202) | 0.8 (0.0 to 3.3) | 2.8 (0.6 to 7.3) | 1353 (1324 to 1372) |

Over the rows of the second table, the wrong depths on valid JSON of 17 to 19 levels are 0.0% to 9.4% as means over the seeds, and a seed shows 0 to 1,297 code points as past the end. The ground rules hold on the fixed texts for 60 of the 60 runs. The tables of `none` are the tables that `../plain-pass/` saved, byte for byte, for 5 of the 5 seeds.

- **What the rule's classes miss is `=`.** The kind `foreignKeySeparator`, `=` or `=>` for a colon, 24 validation samples, goes from 71.9 (63.8 to 83.0) to 97.7 (97.0 to 99.2) with the hand choice, and is not among the kinds that the rule's classes move. On all samples the hand choice is 0.21 points above the rule with ranges that do not overlap, and in the group the two ranges overlap.
- **The hand-chosen classes lose four kinds**: `missingColon`, 29 samples, 90.6 (89.3 to 95.2) to 82.5 (77.8 to 89.3), `hashComment` 96.6 to 92.3, `unquotedValue` 98.0 to 95.9 and `missingComma` 98.5 to 98.2. And they do not move the kind that the largest class was named for out of the range of no addition: `singleQuotedString`, 333 samples, 93.4 (92.9 to 93.7). Open display entries without any class raise it to 98.2 (97.9 to 98.6).
- **Open display entries are the single addition with the largest gain, and they do not gain in every row**: the group "needs a line rule" is at 99.2 (98.8 to 99.4) against 99.7 (98.9 to 99.9), with ranges that overlap, and three kinds are below no addition, `hashComment` 96.6 to 83.4 (15 samples), `unquotedValue` 98.0 to 93.7 (51) and `missingComma` 98.5 to 97.7 (567).
- **The bit moves no row of the table and five kinds**: two above no addition, `missingColon` 90.6 to 97.6 and `numberFormat` 98.6 to 99.3, and three below, `keyWithoutColon` 99.6 to 99.0, `colonWithoutValue` 99.7 to 99.5 and `backslashEscapedDocument`, 11 samples, 91.6 (90.4 to 92.9) to 84.7 (81.8 to 89.3). The bit doubles the open grammar cells, from 616 to 1,232, and a run takes a third longer, 43 s against 32 s.
- **The additions do not add up**: the classes give 0.75 points alone and the entries 0.99, and all three give 1.29. With the rule's classes in the place of the hand choice, all three together are not told apart from the hand choice.
- **Classes show more of the text as an error and as "past the end"**: 5.2% (3.9 to 6.2) of the added code points are shown as an error against 0.9%, and 567 (73 to 1,235) code points as "past the end" against 50 (0 to 160). In the seed with the most, 1,122 of the 1,235 are backticks, in 335 samples: a cell that a backtick reads holds an event of a text's end.

### The trainer's setting `three-uniform`

3 passes, uniform start, learning rate 0.05, temperature 1 to 1, sharpness cost 0. The seeds 1, 2, 3, 4, 5. A cell says "above" or "below" when its range does not overlap the range of the row `none`. Not run with this setting of the trainer: `error-target-0.1`, `error-target-0.3-alone`, `all-data`.

| setting | all three | within reach of the tables | whole samples | needs a character class | needs a display fix | needs a line rule | needs a nesting fix | out of reach |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `none` | 96.88 (96.69 to 97.02) | 99.27 (99.15 to 99.36) | 73.46 (71.54 to 74.56) | 91.0 (88.8 to 92.2) | 96.9 (96.4 to 97.3) | 99.1 (98.9 to 99.8) | 89.6 (88.3 to 91.1) | 83.6 (82.9 to 84.1) |
| `classes-hand` | 97.61 (97.52 to 97.68), above | 99.34 (99.27 to 99.39) | 77.13 (75.85 to 78.29), above | 96.3 (95.7 to 96.8), above | 97.6 (97.0 to 97.9) | 99.9 (99.8 to 99.9), above | 92.4 (91.9 to 92.8), above | 83.7 (83.6 to 83.8) |
| `classes-data` | 97.35 (97.24 to 97.51), above | 99.28 (99.20 to 99.34) | 75.44 (74.48 to 76.35) | 94.9 (94.1 to 95.9), above | 97.1 (96.0 to 97.8) | 99.2 (98.6 to 99.9) | 91.1 (89.3 to 92.4) | 83.9 (82.6 to 84.3) |
| `display` | 96.98 (96.92 to 97.08) | 99.16 (99.05 to 99.30) | 72.74 (67.97 to 76.37) | 93.1 (92.7 to 93.6), above | 98.7 (98.2 to 98.9), above | 98.4 (98.4 to 98.5), below | 88.9 (86.6 to 89.8) | 83.8 (83.4 to 84.1) |
| `display-counted` | 97.09 (96.94 to 97.26) | 99.42 (99.32 to 99.48) | 75.41 (73.87 to 76.41) | 91.8 (89.8 to 93.0) | 98.5 (98.0 to 98.9), above | 99.1 (98.9 to 99.8) | 89.6 (88.3 to 91.1) | 83.7 (83.0 to 84.2) |
| `error-target-0.3` | 96.94 (96.57 to 97.12) | 98.92 (98.53 to 99.29) | 72.14 (67.91 to 74.96) | 93.5 (92.7 to 93.9), above | 98.4 (97.9 to 98.8), above | 99.0 (98.4 to 99.4) | 90.1 (88.4 to 91.1) | 84.0 (82.9 to 84.7) |
| `error-target-1` | 96.67 (96.23 to 96.94) | 98.78 (98.29 to 99.00), below | 66.41 (63.01 to 69.15), below | 92.2 (90.7 to 93.4) | 98.1 (97.8 to 98.6), above | 99.0 (98.2 to 99.3) | 90.2 (88.2 to 91.0) | 83.5 (82.3 to 84.4) |
| `bit` | 97.05 (96.82 to 97.25) | 99.25 (99.17 to 99.38) | 73.20 (72.41 to 73.89) | 92.1 (91.6 to 92.5) | 96.9 (96.3 to 97.5) | 99.8 (99.4 to 99.9) | 88.9 (86.3 to 91.1) | 83.7 (82.0 to 84.7) |
| `all` | 97.68 (97.48 to 97.86), above | 99.26 (99.07 to 99.43) | 75.17 (70.28 to 78.24) | 96.7 (96.2 to 97.5), above | 98.5 (98.0 to 98.9), above | 99.2 (98.9 to 99.5) | 90.5 (87.7 to 91.7) | 85.5 (84.7 to 86.3), above |

| setting | added code points shown as an error | samples that show an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | cells changed against the base |
| --- | --- | --- | --- | --- | --- | --- |
| `none` | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.1) | 16 (0 to 79) | 47.9 (41.7 to 68.8) | 54.6 (48.0 to 78.3) | 1158 (1156 to 1160) |
| `classes-hand` | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 36 (0 to 81) | 39.7 (29.1 to 43.0) | 44.4 (32.1 to 50.1) | 1526 (1524 to 1531) |
| `classes-data` | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 19 (0 to 54) | 44.4 (42.0 to 50.5) | 50.2 (47.6 to 54.1) | 1405 (1403 to 1407) |
| `display` | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 | 61.4 (40.8 to 77.9) | 67.9 (48.6 to 83.6) | 1247 (1239 to 1258) |
| `display-counted` | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 16 (0 to 79) | 47.9 (41.7 to 68.8) | 54.6 (48.0 to 78.3) | 1169 (1165 to 1173) |
| `error-target-0.3` | 66.5 (48.3 to 72.3), above | 32.2 (28.2 to 35.6), above | 8 (0 to 42) | 54.6 (40.5 to 78.6) | 61.8 (49.9 to 87.6) | 1218 (1212 to 1226) |
| `error-target-1` | 78.0 (68.6 to 81.5), above | 41.5 (38.2 to 45.2), above | 69 (0 to 249) | 54.2 (43.8 to 59.5) | 63.2 (50.1 to 71.9) | 1196 (1174 to 1206) |
| `bit` | 0.0 (0.0 to 0.0) | 0.2 (0.0 to 0.8) | 23 (0 to 58) | 63.1 (57.1 to 68.9) | 70.8 (63.4 to 79.0) | 1647 (1638 to 1653) |
| `all` | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 41 (10 to 92) | 63.4 (56.2 to 70.6) | 68.4 (61.6 to 76.7) | 2116 (2111 to 2119) |

Over the rows of the second table, the wrong depths on valid JSON of 17 to 19 levels are 39.7% to 70.8% as means over the seeds, and a seed shows 0 to 249 code points as past the end. The ground rules hold on the fixed texts for 45 of the 45 runs.

- **The classes** gain as with `plain`, and here the rule's classes are above no addition on all samples too. No kind is below no addition with either choice.
- **Open display entries**: the group "needs a display fix" gains 1.7 points, the group "needs a line rule" is below no addition, and seven kinds are, e.g. `logLines`, 29 samples, 99.9 to 86.8.
- **The count after the training is the better use of the entries here**: 97.09 (96.94 to 97.26) against 96.98 (96.92 to 97.08) on all samples, with ranges that overlap, and 99.42 (99.32 to 99.48) against 99.16 (99.05 to 99.30) within reach, with ranges that do not.
- **The bit moves no row and six kinds**, five above no addition, e.g. `missingColon` 93.9 to 99.0, and `quotedDocument`, 24 samples, below.
- **All three together gain what the classes gain alone**: 0.80 points against 0.73.

### The trainer's setting `three-base`

3 passes, start at the base's choices, learning rate 0.05, temperature 1 to 1, sharpness cost 0. The seeds 1, 2, 3, 4, 5. A cell says "above" or "below" when its range does not overlap the range of the row `none`. Not run with this setting of the trainer: `classes-hand`, `classes-data`, `error-target-0.1`, `error-target-0.3`, `error-target-1`, `error-target-0.3-alone`, `bit`, `all-data`.

| setting | all three | within reach of the tables | whole samples | needs a character class | needs a display fix | needs a line rule | needs a nesting fix | out of reach |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `none` | 96.80 (96.61 to 96.99) | 99.05 (98.76 to 99.34) | 73.25 (72.52 to 73.74) | 90.6 (90.2 to 90.8) | 96.8 (95.9 to 97.3) | 99.8 (99.7 to 99.9) | 92.4 (92.1 to 92.6) | 83.8 (83.3 to 84.3) |
| `display` | 97.69 (97.64 to 97.79), above | 99.54 (99.47 to 99.56), above | 78.23 (76.94 to 79.00), above | 95.6 (95.1 to 96.1), above | 98.9 (98.4 to 99.1), above | 99.5 (99.4 to 99.6), below | 91.3 (90.7 to 91.7), below | 84.3 (84.0 to 84.8) |
| `display-counted` | 97.00 (96.76 to 97.23) | 99.18 (98.89 to 99.47) | 75.40 (73.91 to 76.57), above | 91.3 (91.1 to 91.7), above | 98.3 (97.9 to 98.6), above | 99.8 (99.7 to 99.9) | 92.4 (92.1 to 92.6) | 83.9 (83.4 to 84.3) |
| `all` | 98.03 (97.82 to 98.13), above | 99.58 (99.27 to 99.68) | 83.60 (82.35 to 85.70), above | 98.4 (98.0 to 98.6), above | 99.0 (98.8 to 99.2), above | 99.6 (99.1 to 99.9) | 92.2 (91.9 to 92.6) | 84.3 (83.8 to 84.9) |

| setting | added code points shown as an error | samples that show an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | cells changed against the base |
| --- | --- | --- | --- | --- | --- | --- |
| `none` | 0.9 (0.6 to 1.5) | 5.5 (2.1 to 11.4) | 379 (0 to 1114) | 12.1 (2.9 to 34.8) | 20.1 (7.1 to 49.9) | 1031 (1005 to 1046) |
| `display` | 0.0 (0.0 to 0.0), below | 0.0 (0.0 to 0.1), below | 168 (3 to 409) | 8.3 (0.0 to 25.0) | 9.9 (1.6 to 29.6) | 1045 (1023 to 1061) |
| `display-counted` | 0.1 (0.0 to 0.1), below | 0.2 (0.1 to 0.4), below | 379 (0 to 1114) | 12.1 (2.9 to 34.8) | 20.1 (7.1 to 49.9) | 1058 (1030 to 1069) |
| `all` | 0.0 (0.0 to 0.0), below | 0.0 (0.0 to 0.1), below | 304 (168 to 458) | 9.8 (4.7 to 18.0) | 15.2 (8.3 to 22.5) | 1587 (1553 to 1636) |

Over the rows of the second table, the wrong depths on valid JSON of 17 to 19 levels are 8.3% to 20.1% as means over the seeds, and a seed shows 0 to 1,114 code points as past the end. The ground rules hold on the fixed texts for 20 of the 20 runs.

- **Open display entries lose in two groups**, with ranges that do not overlap: "needs a line rule" and "needs a nesting fix".
- **Every row of this setting of the trainer has wrong depths on valid JSON that is too deep, the control included.**
- **The code points shown as "past the end" do not come from the classes here**: the control shows 379 (0 to 1,114) without any class, e.g. in its seed 1 a slash in 529 validation samples, and all three additions show 304 (168 to 458).
- The classes alone and the bit alone did not run with this setting of the trainer, so what each of them adds to the row `all` is not known.

### The trainer's setting `one-uniform`

1 pass, uniform start, learning rate 0.05, temperature 1 to 1, sharpness cost 0. The seeds 1, 2, 3, 4, 5. A cell says "above" or "below" when its range does not overlap the range of the row `none`. Not run with this setting of the trainer: `classes-hand`, `classes-data`, `error-target-0.1`, `error-target-0.3`, `error-target-1`, `error-target-0.3-alone`, `bit`, `all`, `all-data`.

| setting | all three | within reach of the tables | whole samples | needs a character class | needs a display fix | needs a line rule | needs a nesting fix | out of reach |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `none` | 96.62 (95.98 to 96.91) | 99.33 (99.24 to 99.39) | 72.42 (71.85 to 73.06) | 90.4 (89.9 to 91.1) | 97.1 (96.9 to 97.4) | 98.8 (98.8 to 98.9) | 86.5 (78.1 to 89.5) | 81.8 (76.1 to 83.9) |
| `display` | 96.35 (96.08 to 96.56) | 98.52 (98.34 to 98.71), below | 69.61 (63.90 to 75.52) | 91.9 (90.5 to 93.2) | 98.5 (98.2 to 98.8), above | 98.2 (97.4 to 98.4), below | 88.7 (88.2 to 89.8) | 83.5 (83.0 to 83.9) |
| `display-counted` | 96.76 (96.10 to 97.02) | 99.42 (99.32 to 99.47) | 74.41 (73.50 to 75.20), above | 90.9 (90.4 to 91.4) | 98.5 (98.1 to 98.8), above | 98.8 (98.8 to 98.9) | 86.5 (78.1 to 89.5) | 81.9 (76.2 to 84.0) |

| setting | added code points shown as an error | samples that show an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | cells changed against the base |
| --- | --- | --- | --- | --- | --- | --- |
| `none` | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 | 67.6 (59.7 to 72.2) | 78.0 (71.7 to 80.5) | 1158 (1155 to 1162) |
| `display` | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 | 86.5 (59.5 to 98.1) | 90.8 (72.0 to 97.8) | 1247 (1243 to 1250) |
| `display-counted` | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 | 67.6 (59.7 to 72.2) | 78.0 (71.7 to 80.5) | 1170 (1164 to 1174) |

Over the rows of the second table, the wrong depths on valid JSON of 17 to 19 levels are 67.6% to 90.8% as means over the seeds, and no seed shows a code point as past the end. The ground rules hold on the fixed texts for 15 of the 15 runs.

Open display entries lose here: 0.81 points within reach, with ranges that do not overlap.

### Open display entries by the passes and the start

All three on all validation samples. A cell says "above" or "below" when its range does not overlap the range of `none` of the same row.

| trainer | passes | start | `none` | `display` | `display-counted` |
| --- | --- | --- | --- | --- | --- |
| `plain` | 1 | the base's choices | 96.50 (95.88 to 96.74) | 97.49 (97.36 to 97.71), above | 96.69 (96.02 to 96.94) |
| `three-uniform` | 3 | uniform | 96.88 (96.69 to 97.02) | 96.98 (96.92 to 97.08) | 97.09 (96.94 to 97.26) |
| `three-base` | 3 | the base's choices | 96.80 (96.61 to 96.99) | 97.69 (97.64 to 97.79), above | 97.00 (96.76 to 97.23) |
| `one-uniform` | 1 | uniform | 96.62 (95.98 to 96.91) | 96.35 (96.08 to 96.56) | 96.76 (96.10 to 97.02) |

**It is the start.** A reading, which is not measured: a start at the base gives every open entry a share of 0.9 on today's kind, e.g. `string` for the content of a string where a value is expected, and a uniform start gives each of the 8 kinds the same share, so the run has to find today's kinds again from the samples. The cells of the tokenizer and of the grammar lose less by a uniform start: today's choice of most open cells leads into an error, which a recovery replaces anyway.

### The display entries by a count, seed by seed

The tables of `display-counted` are the tables of `none` of the same seed with other display entries. `display-counted` minus `none`, in points, in the order of the seeds, and how many of the open display entries the count changed:

| trainer | all three | within reach of the tables | whole samples | display entries that the count changed |
| --- | --- | --- | --- | --- |
| `plain` | +0.15, +0.21, +0.14, +0.20, +0.24 | +0.10, +0.14, +0.10, +0.14, +0.13 | +1.91, +3.07, +2.15, +2.09, +0.72 | 32, 31, 27, 27, 32 |
| `three-uniform` | +0.19, +0.18, +0.26, +0.16, +0.24 | +0.13, +0.12, +0.17, +0.13, +0.18 | +2.33, +1.33, +2.24, +2.02, +1.85 | 12, 14, 9, 13, 9 |
| `three-base` | +0.11, +0.23, +0.15, +0.24, +0.23 | +0.07, +0.17, +0.10, +0.17, +0.14 | +1.39, +3.15, +1.22, +3.24, +1.72 | 34, 30, 30, 19, 25 |
| `one-uniform` | +0.17, +0.13, +0.12, +0.11, +0.17 | +0.11, +0.08, +0.08, +0.08, +0.10 | +1.65, +1.94, +2.13, +2.26, +1.96 | 9, 12, 14, 13, 14 |

On all validation samples the count is above the tables that it started from in 20 of the 20 runs, by +0.11 to +0.26 points, and in the group within reach of the tables in 20 of the 20 runs, by +0.07 to +0.18 points.

- **By the ranges the count is not told apart from no addition on all samples, and seed by seed it is a gain in every run.** The ranges hold the spread of the training, which the two sides share.
- **With `plain`, training with open entries is 0.80 points above the count**, with ranges that do not overlap. So the gain of that setting is not in the display table alone: the cells of the tokenizer and of the grammar end elsewhere when the entries are trained with them.
- The count cannot lower the score on the train split.

### Without a trainer

The hand-written tables and the number to beat, each as they are and with their display entries set by a count, and the rows of `search-display.ts`: the search and the count in turns with the most read cells first, and in random orders the search alone, the search with one count after it, and the search and the count in turns.

| setting | all three | within reach of the tables | whole samples | needs a character class | needs a display fix | needs a line rule | needs a nesting fix | out of reach |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hand-written, the 35 rules of handwritten/rules.ts | 96.52 | 99.51 | 80.44 | 92.2 | 98.2 | 99.0 | 76.1 | 78.0 |
| hand-written, then the open display entries by a count | 96.59 | 99.56 | 83.90 | 92.5 | 99.2 | 99.0 | 76.1 | 78.0 |
| search from the hand-written tables | 97.75 | 99.68 | 79.37 | 94.9 | 98.0 | 99.1 | 90.3 | 85.4 |
| search from the hand-written tables, then the open display entries by a count | 97.84 | 99.74 | 82.16 | 95.3 | 99.0 | 99.1 | 90.3 | 85.4 |
| search from the hand-written tables and the display entries by a count, in turns | 97.94 | 99.67 | 82.07 | 95.5 | 99.1 | 99.8 | 91.3 | 86.0 |
| search from the hand-written tables in a random order | 97.74 (97.63 to 97.80) | 99.68 (99.58 to 99.76) | 79.76 (79.63 to 79.85) | 94.9 (94.5 to 95.5) | 98.2 (98.2 to 98.3) | 99.5 (99.3 to 99.9) | 89.5 (87.8 to 90.7) | 85.0 (84.6 to 85.3) |
| search from the hand-written tables in a random order, then the open display entries by a count | 97.81 (97.69 to 97.87) | 99.73 (99.63 to 99.82) | 83.08 (82.68 to 83.59) | 95.1 (94.7 to 95.8) | 99.2 (99.2 to 99.3) | 99.5 (99.3 to 100.0) | 89.5 (87.8 to 90.7) | 85.0 (84.6 to 85.4) |
| search from the hand-written tables in a random order and the display entries by a count, in turns | 97.81 (97.72 to 97.88) | 99.74 (99.67 to 99.81) | 82.98 (82.48 to 83.31) | 95.0 (94.5 to 95.7) | 99.2 (99.1 to 99.3) | 99.2 (99.1 to 99.3) | 89.9 (89.2 to 90.6) | 85.4 (85.3 to 85.5) |

| setting | added code points shown as an error | samples that show an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | cells changed against the base |
| --- | --- | --- | --- | --- | --- | --- |
| hand-written, the 35 rules of handwritten/rules.ts | 0.0 | 0.0 | 0 | 0.0 | 0.0 | 915 |
| hand-written, then the open display entries by a count | 0.0 | 0.0 | 0 | 0.0 | 0.0 | 921 |
| search from the hand-written tables | 0.0 | 0.2 | 0 | 18.5 | 30.2 | 429 |
| search from the hand-written tables, then the open display entries by a count | 0.0 | 0.1 | 0 | 18.5 | 30.2 | 447 |
| search from the hand-written tables and the display entries by a count, in turns | 0.0 | 0.0 | 0 | 0.0 | 0.0 | 527 |
| search from the hand-written tables in a random order | 0.1 (0.0 to 0.1) | 0.4 (0.2 to 0.7) | 0 | 5.8 (0.0 to 17.0) | 7.7 (0.0 to 20.4) | 414 (400 to 435) |
| search from the hand-written tables in a random order, then the open display entries by a count | 0.0 (0.0 to 0.1) | 0.0 (0.0 to 0.1) | 0 | 5.8 (0.0 to 17.0) | 7.7 (0.0 to 20.4) | 428 (417 to 444) |
| search from the hand-written tables in a random order and the display entries by a count, in turns | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 | 14.4 (0.8 to 33.2) | 17.0 (0.3 to 32.4) | 481 (473 to 491) |

The same per order of the cells, all three on all validation samples and in the group within reach of the tables. With the most read cells first, the search alone is the number to beat.

| order of the cells | the search alone | then one count | the search and the count in turns | within reach: the search alone | then one count | the search and the count in turns |
| --- | --- | --- | --- | --- | --- | --- |
| the most read cells first | 97.75 | 97.84 | 97.94 | 99.68 | 99.74 | 99.67 |
| random, seed 1 | 97.63 | 97.69 | 97.72 | 99.58 | 99.63 | 99.67 |
| random, seed 2 | 97.80 | 97.87 | 97.84 | 99.70 | 99.75 | 99.81 |
| random, seed 3 | 97.80 | 97.87 | 97.88 | 99.76 | 99.82 | 99.73 |

In the order of the rows, on all validation samples: the search with one count is +0.09, +0.06, +0.07, +0.08 points from the search alone, and the search and the count in turns are +0.11, +0.03, -0.03, +0.00 points from the search with one count. Within reach of the tables: +0.06, +0.05, +0.05, +0.06 and -0.07, +0.03, +0.07, -0.09.

- **What the search gains with open display entries is what one count gives**: 0.06 to 0.09 points in each of the four orders. Going on in turns adds 0.11 points to that with the most read cells first, and 0.03, -0.03 and 0.00 in the three random orders. By the ranges, the search in turns is not told apart from the search alone in the same random orders:
  - All three, all validation samples: "search from the hand-written tables in a random order and the display entries by a count, in turns" has 97.81 (97.72 to 97.88) over 3 seeds, "search from the hand-written tables in a random order" has 97.74 (97.63 to 97.80) over 3 seeds. The means differ by +0.07 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- **The order of the cells moves the search alone by 0.17 points**, 97.63 to 97.80, twice what one count gives it.
- **Which order keeps the depth of valid JSON that is too deep is an accident**: the search in turns with the most read cells first has no wrong depth, where the number to beat has 18.5% and 30.2%, and the random orders have 0% to 33%.
- **The count gives as much to tables without training**: 0.07 points to the hand-written tables and 0.09 to the number to beat, and 3.5 and 2.8 points of whole samples. The hand-written tables with counted entries have the highest mean of whole samples in this README, 83.90.
- **Within reach, the searched rows have the higher means**: 99.67 to 99.74, where the highest mean of a trained row is 99.61.

### The confirmation with the seeds 11 to 15

| trainer | setting | seeds | all three | within reach of the tables | whole samples | needs a character class | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `three-base` | `none` | 1 to 5 | 96.80 (96.61 to 96.99) | 99.05 (98.76 to 99.34) | 73.25 (72.52 to 73.74) | 90.6 (90.2 to 90.8) | 379 (0 to 1114) | 12.1 (2.9 to 34.8) | 20.1 (7.1 to 49.9) |
| `three-base` | `none` | 11 to 15 | 96.78 (96.46 to 96.98) | 99.10 (98.87 to 99.30) | 72.30 (71.13 to 74.00) | 89.8 (88.7 to 91.0) | 234 (4 to 496) | 16.5 (6.5 to 37.5) | 20.3 (0.2 to 46.6) |
| `three-base` | `all` | 1 to 5 | 98.03 (97.82 to 98.13) | 99.58 (99.27 to 99.68) | 83.60 (82.35 to 85.70) | 98.4 (98.0 to 98.6) | 304 (168 to 458) | 9.8 (4.7 to 18.0) | 15.2 (8.3 to 22.5) |
| `three-base` | `all` | 11 to 15 | 98.08 (97.78 to 98.24) | 99.61 (99.39 to 99.75) | 81.51 (79.48 to 82.38) | 98.2 (97.1 to 98.7) | 443 (271 to 537) | 13.6 (0.0 to 29.8) | 14.5 (1.2 to 32.8) |
| `three-base` | `all` | all 10 | 98.05 (97.78 to 98.24) | 99.60 (99.27 to 99.75) | 82.55 (79.48 to 85.70) | 98.3 (97.1 to 98.7) | 373 (168 to 537) | 11.7 (0.0 to 29.8) | 14.9 (1.2 to 32.8) |
| `plain` | `none` | 1 to 5 | 96.50 (95.88 to 96.74) | 99.11 (98.87 to 99.31) | 73.22 (72.76 to 73.54) | 89.7 (88.9 to 90.5) | 50 (0 to 160) | 3.0 (0.0 to 12.3) | 4.7 (0.0 to 16.4) |
| `plain` | `none` | 11 to 15 | 96.40 (96.07 to 96.68) | 98.99 (98.74 to 99.16) | 72.59 (71.19 to 73.56) | 89.0 (86.8 to 89.8) | 1 (0 to 3) | 6.7 (0.0 to 26.3) | 8.5 (0.2 to 28.9) |
| `plain` | `all` | 1 to 5 | 97.79 (97.71 to 98.01) | 99.53 (99.37 to 99.67) | 82.37 (79.90 to 83.44) | 98.0 (97.4 to 98.2) | 208 (127 to 244) | 5.7 (0.0 to 19.0) | 7.9 (1.5 to 24.2) |
| `plain` | `all` | 11 to 15 | 97.80 (97.38 to 97.99) | 99.52 (99.25 to 99.70) | 80.67 (77.13 to 82.40) | 97.2 (95.8 to 98.1) | 355 (254 to 537) | 5.9 (0.0 to 20.5) | 7.4 (1.8 to 20.9) |
| `plain` | `all` | all 10 | 97.79 (97.38 to 98.01) | 99.52 (99.25 to 99.70) | 81.52 (77.13 to 83.44) | 97.6 (95.8 to 98.2) | 281 (127 to 537) | 5.8 (0.0 to 20.5) | 7.7 (1.5 to 24.2) |

The setting `all` seed by seed, the seeds 1 to 5 and then the seeds 11 to 15:

- `three-base`. All three: 97.82, 98.13, 98.02, 98.05, 98.12 and 98.10, 98.11, 98.24, 98.16, 97.78, above the number to beat, 97.75, in 10 of the 10 seeds. The lowest seed has 252 code points more right than the number to beat, of 675,949. Within reach of the tables: 99.27, 99.68, 99.63, 99.67, 99.65 and 99.68, 99.60, 99.75, 99.64, 99.39, above the number to beat, 99.68, in 1 of the 10 seeds. Wrong depths on valid JSON of 17 to 19 levels, nothing after the nested containers: 18.0, 11.5, 8.2, 6.4, 4.7 and 0.0, 15.0, 23.2, 0.0, 29.8, and members after: 22.5, 18.7, 11.2, 8.3, 15.5 and 1.2, 15.9, 20.1, 2.2, 32.8, so 10 of the 10 seeds have a wrong depth there. Code points shown as past the end: 229, 458, 301, 168, 362 and 445, 537, 271, 459, 502.

What the two sets of seeds say together:

- **The main number holds**: the mean of the new seeds is at the mean of the reported ones, and every seed is above the number to beat. With either set of seeds the row is not told apart from the search with one count in random orders, 97.81 (97.69 to 97.87).
- **Within reach of the tables the row is at the number to beat, 99.68**: no seed from 1 to 5 is above it, and one seed from 11 to 15 is, as is one of `plain`. With the seeds 1 to 5 the row's range overlaps the range of its own control in that group, and with the seeds 11 to 15 it is above it.
- **The whole samples of the row are known to 2 points**: 83.60 with the seeds 1 to 5 and 81.51 with the seeds 11 to 15.
- **The new seeds have wrong depths on valid JSON that is too deep as the reported ones have**, and they show more code points as "past the end", 443 (271 to 537) against 304 (168 to 458). With `plain` and all three additions, each of the ten seeds has a wrong depth too.
- **`three-base` is not told apart from `plain` with all three additions**, with either set of seeds: the means are 0.24 and 0.28 points apart and the ranges overlap.

### The target "an added code point is shown as an error"

The best tables of the experiment show almost no added code point as an error, where today's parser shows 89.6% of them so.

The control of a weight is the row "none" above it: the same setting of the arm without the target. A cell says "above" or "below" when its range does not overlap the range of that control. "Minus its control" is the target minus its control seed by seed, in points, in the order of the seeds, with the mean.

| trainer | open display entries | weight | all three | minus its control | within reach of the tables | whole samples | minus its control | added code points shown as an error | the same, seed by seed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `plain` | yes | none | 97.49 (97.36 to 97.71) |  | 99.50 (99.48 to 99.56) | 78.52 (77.83 to 79.29) |  | 0.0 (0.0 to 0.0) | 0.0, 0.0, 0.0, 0.0, 0.0 |
| `plain` | yes | 0.1 | 97.35 (97.23 to 97.44) | -0.19, -0.04, -0.10, -0.13, -0.27 (mean -0.15) | 99.39 (99.29 to 99.46), below | 77.30 (76.15 to 79.24) | -0.6, -1.0, +0.9, -2.3, -3.1 (mean -1.2) | 53.6 (46.0 to 59.9), above | 59.9, 51.2, 46.0, 59.6, 51.3 |
| `plain` | yes | 0.3 | 97.19 (96.90 to 97.51) | -0.62, -0.20, -0.25, +0.15, -0.57 (mean -0.30) | 99.30 (99.12 to 99.44), below | 73.98 (71.39 to 76.35), below | -4.8, -1.8, -2.2, -6.0, -7.9 (mean -4.5) | 65.1 (56.6 to 70.3), above | 56.6, 70.3, 67.6, 68.1, 62.7 |
| `plain` | yes | 1 | 96.59 (95.60 to 96.98), below | -0.55, -0.46, -0.75, -0.63, -2.12 (mean -0.90) | 99.02 (98.48 to 99.26), below | 67.93 (64.56 to 70.93), below | -9.0, -8.0, -7.4, -14.5, -14.1 (mean -10.6) | 78.5 (71.9 to 84.4), above | 71.9, 82.3, 75.5, 78.4, 84.4 |
| `plain` | no | none | 96.50 (95.88 to 96.74) |  | 99.11 (98.87 to 99.31) | 73.22 (72.76 to 73.54) |  | 0.9 (0.7 to 1.1) | 1.1, 0.7, 1.1, 0.8, 1.0 |
| `plain` | no | 0.3 | 96.09 (95.33 to 96.42) | -0.47, -0.32, -0.55, -0.36, -0.37 (mean -0.41) | 98.83 (98.27 to 99.15) | 67.63 (57.53 to 72.06), below | -2.5, -1.3, -5.0, -3.8, -15.2 (mean -5.6) | 52.6 (44.4 to 58.3), above | 44.4, 58.3, 52.3, 50.2, 57.9 |
| `three-uniform` | yes | none | 96.98 (96.92 to 97.08) |  | 99.16 (99.05 to 99.30) | 72.74 (67.97 to 76.37) |  | 0.0 (0.0 to 0.0) | 0.0, 0.0, 0.0, 0.0, 0.0 |
| `three-uniform` | yes | 0.3 | 96.94 (96.57 to 97.12) | -0.07, +0.05, +0.13, -0.52, +0.19 (mean -0.04) | 98.92 (98.53 to 99.29) | 72.14 (67.91 to 74.96) | -2.2, +4.5, -2.9, -0.6, -1.9 (mean -0.6) | 66.5 (48.3 to 72.3), above | 68.9, 71.1, 72.0, 48.3, 72.3 |
| `three-uniform` | yes | 1 | 96.67 (96.23 to 96.94) | -0.21, -0.22, -0.31, -0.86, +0.02 (mean -0.32) | 98.78 (98.29 to 99.00), below | 66.41 (63.01 to 69.15) | -7.1, -2.7, -7.2, -8.8, -5.9 (mean -6.3) | 78.0 (68.6 to 81.5), above | 80.2, 81.5, 78.6, 68.6, 80.9 |

`plain`, the weight 0.3: a seed draws the same added code points for the target with and without open display entries. Without them the target shows fewer added code points as an error in 5 of the 5 seeds, and costs more of all three against its control in 3 of the 5.

- **A small weight gives most of it.** With `plain`, by the ranges, the weights 0.1 and 0.3 are not told apart from their control on all samples, and both are below it within reach. Seed by seed, the weight 0.1 is below its control in each of the five seeds. With `three-uniform`, the weight 0.3 is not told apart from its control in either row, and is above it in three of the five seeds.
- **A larger weight gives less per point**: from the weight 0.3 to the weight 1 the added code points that are shown as an error go from 65% to 78%, with either setting of the trainer, and whole samples fall by 6 points more.
- **Without open display entries the target shows fewer added code points as an error, and its cost is not told apart**: 0.41 points against its control, where the target with open entries costs 0.30 against its own, more in three of the five seeds, and both ranges overlap the range of their control. With today's display table only the seven error events are shown as an error, and with open entries any event can be, by the grammar state after it.
- One kind loses with the target that the entries alone do not move: `missingColon`, 29 validation samples, from 90.6 (89.3 to 95.2) to 76.9 (75.9 to 77.9) at the weight 0.1 with `plain`.

## The two choices of classes

94 code points come at or after a first error in 100 train samples or more. The rule picks the 11 with a distance of 0.5 or more from the other code points of their class. The table has them and the 6 after them. "What it is" is the event at the code point's counterpart in the original, or "added".

| code point | class today | train samples | occurrences | distance | what it is | what the rest of its class is | picked | chosen by hand |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| U+00A0 | other | 300 | 10,228 | 1.00 | whitespace 100% | stringContent 81%, added 12%, stringStart 4% | yes | yes |
| U+201C | other | 542 | 6,211 | 0.97 | stringStart 100% | stringContent 80%, added 12%, stringEnd 4% | yes | yes |
| U+0027 `'` | other | 4,966 | 60,906 | 0.94 | stringStart 48%, stringEnd 48%, stringContent 3% | stringContent 85%, added 12%, whitespace 1% | yes | yes |
| U+201D | other | 561 | 7,803 | 0.93 | stringEnd 90%, stringStart 10% | stringContent 80%, added 12%, stringStart 4% | yes | yes |
| U+0060 `` ` `` | other | 2,317 | 11,760 | 0.89 | added 100% | stringContent 81%, added 11%, stringStart 4% | yes | yes |
| U+0026 `&` | other | 111 | 1,173 | 0.89 | added 100% | stringContent 80%, added 11%, stringStart 4% | yes | yes |
| U+FEFF | other | 197 | 197 | 0.88 | added 100% | stringContent 80%, added 12%, stringStart 4% | yes | no |
| U+2026 | other | 177 | 177 | 0.88 | added 100% | stringContent 80%, added 12%, stringStart 4% | yes | no |
| U+003B `;` | other | 993 | 2,205 | 0.83 | added 92%, stringContent 5%, colon 2% | stringContent 80%, added 11%, stringStart 4% | yes | yes |
| U+0029 `)` | other | 2,109 | 3,480 | 0.71 | added 81%, stringContent 17%, closeArray 1% | stringContent 80%, added 11%, stringStart 4% | yes | yes |
| U+0028 `(` | other | 1,989 | 3,357 | 0.70 | added 80%, stringContent 18%, openArray 1% | stringContent 80%, added 11%, stringStart 4% | yes | yes |
| U+004E `N` | other | 3,166 | 4,264 | 0.42 | added 54%, stringContent 46% | stringContent 80%, added 11%, stringStart 4% | no | no |
| U+003D `=` | other | 3,018 | 4,452 | 0.40 | stringContent 48%, colon 30%, added 22% | stringContent 80%, added 12%, stringStart 4% | no | yes |
| U+004A `J` | other | 721 | 763 | 0.40 | added 52%, stringContent 48% | stringContent 80%, added 12%, stringStart 4% | no | no |
| U+0021 `!` | other | 570 | 609 | 0.39 | added 50%, stringContent 50% | stringContent 80%, added 12%, stringStart 4% | no | no |
| U+0023 `#` | other | 946 | 1,051 | 0.37 | stringContent 51%, added 49% | stringContent 80%, added 12%, stringStart 4% | no | yes |
| U+0049 `I` | other | 4,248 | 5,786 | 0.31 | stringContent 58%, added 42% | stringContent 80%, added 11%, stringStart 4% | no | no |

Chosen by hand and not by the rule, with the distance of each: equalsSign 0.40, carriageReturn 0.06, letterX 0.15, hash 0.37, letterM 0.14, star 0.09. Picked by the rule and not chosen by hand: U+FEFF, U+2026.

- **The rule finds 9 of the 15 classes that were chosen by hand**: the apostrophe, the backtick, the two typographic quotes, U+00A0, the two round brackets, `;` and `&`.
- **It misses 6 of them.** Each is mostly something else than what the damage makes of it: `=` is the content of a string at 48% of its occurrences and stands for a colon at 30%, and `x` is the content of a string at 94% and the `x` of `\xe9` at fewer than 1%.
- **It picks 2 that no description names**: U+FEFF, the byte order mark before a document, and U+2026, the ellipsis that marks a text as cut. The damage added every one of their occurrences, where the rest of the class `other` is added at 12%.
- **The rule knows where a code point differs and not what a class is good for.** E.g. the backtick is picked because the damage adds nearly every backtick, e.g. the three of a code fence, in 2,317 train samples, and not for the 19 train samples in which it stands for a quote.

**What the cells of the new classes do**, in the seed of the hand choice with the most of all three, seed 4 with `three-uniform`, 97.68%, over the code points at or after a first error in the train split. `report.ts --cells` prints the cells behind each sentence.

- **The apostrophe**, 60,906 code points: between tokens it starts a string (49% of the apostrophes), and every other apostrophe is the content of that string. The closing apostrophe leaves the tokenizer in a state for the inside of a word, where the frozen cells of a number read the comma, the closing bracket or the white space that comes next.
- **`=`**, 4,452: between tokens it is a colon (40% of its occurrences, where the originals have a colon at 30%), and inside a word it is content.
- **The carriage return**, 8,951: white space everywhere. Inside a string it takes the tokenizer out of the string, where the tab stays in it. That is the rule "a string that is open at the end of its line ends there" for lines that end with a carriage return and a line feed.
- **`x`**, **`m`** and **`*`**: the content of a string at 98% to 100% of their occurrences, as the letters around them. Their cells lead to other tokenizer states than the cells of `other` and no event differs, so nothing here shows that training used these three classes.

**These sentences are one seed.** Another seed and another setting of the trainer hold other cells for the same score, as `../holes/` found for every trained cell.

## What the arm does not show

- **Nothing was tuned, and a tuned setting of the trainer is not in these runs.** The display entries show how much an addition's gain can depend on the trainer, so every gain here is the gain with these four settings. `run.ts --trainer` takes a tuned one.
- **`three-base` ran with four settings of the arm only**: no addition, the display entries, the count and all three. It was picked with validation scores in view. The seeds 11 to 15 confirm its main number, and they are still the validation split.
- **No number of the hand-chosen classes is a number on unseen data.** The choice read the dataset's descriptions of the damage, which describe the forms of every split. The rule read the train split alone.
- **Not which of the 15 classes are used.** The classes were trained together.
- **No comparison without gradients for the classes and for the bit** in this arm: the search refused such tables when the arm ran. It runs them now, and `../combined/` ran it from today's tables with classes, open display entries and the bit. A search from today's tables with open entries was not run here either, so the searches here have the hand-written tables as their start and the trained rows do not.
- **The weight of the target is a share of the added code points.** Every added code point gets the same target, the white space of an added comment as the stray bracket. Whether a highlighter should mark what it skips, and what of it, is the design question that the numbers are for.
- **The bit with added states was not tried.** The dataset's hand rule `lines` gains its 1.8 points in the group "needs a line rule" with one added tokenizer state, and no setting here adds a state.
- **A port needs more than cells**: a class table for code points from U+0080 up, e.g. U+00A0 and the typographic quotes, see `../../structure/README.md`. Tables with a changed display table are no tables of the dataset's plain table parser.
- **The test split, the held-out kinds and the held-out template** were not scored.

## Every setting that was tried

Everything that ran is in the tables above, once each:

- With `plain`, all 12 settings, with the seeds 1 to 5. With `three-uniform`, 9 of them: the weight 0.1 of the target, the target without open display entries and `all-data` were left out for lack of time.
- With `three-base` and `one-uniform`, the settings `none`, `display` and `display-counted`, added after the results of the display entries were seen. With `three-base` also `all`, added after those.
- The confirmation with the seeds 11 to 15: `none` and `all`, with `three-base` and with `plain`. A review had run three of these four settings with the same seeds before, in a copy of its own, and the runs here give its tables, so the scores were known when the confirmation ran.
- The search from the hand-written tables: the search and the count in turns with the most read cells first, and in the random orders of the seeds 1 to 3 the search alone, the search with one count, and the two in turns. The search alone and the search with one count were added after the same review, as the controls of the random orders.
- One try-out before the reported runs: the settings `none`, `display-counted`, `classes-data`, `error-target-0.3` and `all` with `plain` and the seed 11, to see that the scripts run. Its numbers are not in any table, and the confirmation ran that seed again.
- One hand choice of classes, and one rule with one pair of thresholds. No other list of classes was trained.

## Commands

Run from the repo root. Every setting of the trainer is an arm of its own for the harness, e.g. `extra-facts-plain`, and so is a run with other seeds than 1 to 5, e.g. `extra-facts-three-base-seeds-11-12-13-14-15`, so the runs are kept next to each other in the scratch folder. The search is the arm `extra-facts-search`.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/handwritten/rules.ts                # the hand-written tables, which the next command starts from
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/handwritten/tables.json --out $RECOVERY_SCRATCH/search/search-from-handwritten.json   # the number to beat, which the report compares with
bun lab/recovery-parser/learn/arms/plain-pass/run.ts              # the plain pass, whose tables the report compares the control with
bun lab/recovery-parser/learn/arms/extra-facts/run.ts --trainer plain            # 12 settings, 5 seeds, about 35 minutes with other jobs running
bun lab/recovery-parser/learn/arms/extra-facts/run.ts --trainer three-uniform --settings none,classes-hand,classes-data,display,display-counted,error-target-0.3,error-target-1,bit,all   # about 70 minutes
bun lab/recovery-parser/learn/arms/extra-facts/run.ts --trainer three-base --settings none,display,display-counted,all   # about 25 minutes
bun lab/recovery-parser/learn/arms/extra-facts/run.ts --trainer one-uniform --settings none,display,display-counted   # about 5 minutes
bun lab/recovery-parser/learn/arms/extra-facts/run.ts --trainer three-base --settings none,all --seeds 11,12,13,14,15   # the confirmation, about 20 minutes
bun lab/recovery-parser/learn/arms/extra-facts/run.ts --trainer plain --settings none,all --seeds 11,12,13,14,15        # about 7 minutes
bun lab/recovery-parser/learn/arms/extra-facts/search-display.ts                 # the search and the count in turns, most read cells first, about 4 minutes
bun lab/recovery-parser/learn/arms/extra-facts/search-display.ts --seeds 1,2,3   # three random orders: the search alone, with one count, and in turns, about 25 minutes
bun lab/recovery-parser/learn/arms/extra-facts/report.ts          # every table above, from the saved runs, a few seconds
bun lab/recovery-parser/learn/arms/extra-facts/report.ts --cells  # also the cells of the new classes in the best seed
```

`run.ts` takes `--settings` with keys of the table in [Setup](#setup), in the order to run them, and `--seeds`. The setting `display-counted` reads the tables that `none` saved for the same seeds, so `none` runs before it. A run of some settings leaves the saved files of the other settings as they are, and `report.ts` leaves out a setting that was not run with the seeds of "no addition".

A tuned setting of the trainer is one more line in `trainerSettings` of `facts.ts`, e.g. `'tuned': {passes: 10, start: 'uniform', learningRate: 0.1, temperatureEnd: 1, sharpnessCost: 0}`, and then `run.ts --trainer tuned`.

## Files

- `facts.ts`: the settings of the arm and of the trainer, the seeds, the classes chosen by hand, the rule that chooses classes from the train samples (`codePointsOfTheRule`), the base of a setting (`baseOf`), the target at the added code points (`withErrorTarget`), and the display entries by a count (`displayEntriesByCount`).
- `run.ts`: the runs of one setting of the trainer.
- `search-display.ts`: the search of every open cell from the hand-written tables, alone, with one count of the display entries after it, and in turns with the count.
- `report.ts`: every table of this README, from the saved runs.
