# Extra facts: character classes, open display entries, and the bit "first on its line"

Today's tables decide by four things: the class of the character, the tokenizer state, the token and the context. Some damage cannot be told apart by those four, and the dataset says which samples. 326 broken validation samples are in the group "needs a character class", e.g. a string in single quotes with a space in it, where the apostrophe is in one class with most letters. 37 are in "needs a display fix", where what is shown follows from the event and the grammar state after it by a fixed table. 488 are in "needs a line rule", where it matters that a token is the first on its line. `../../structure/` has an addition for each: more character classes, open entries of the display table, and a bit that tells the grammar whether a token is the first on its line.

The question of this arm: **when training gets one of these additions, does it use it?** Every addition is measured against the same training without it, with the same setting of the trainer and the same seeds, and with two settings of the trainer.

**In short**, on the validation split, with the seeds 1 to 5, each setting run once. Where a sentence has two numbers, the first is of the trainer's setting `plain`, one pass from the base's choices, and the second of `three-uniform`, three passes from a uniform start. In brackets the lowest and the highest seed.

- **Character classes are used, with either setting of the trainer.** With 15 classes chosen by hand, all three goes from 96.50 (95.88 to 96.74) to 97.25 (97.21 to 97.33), and from 96.88 (96.69 to 97.02) to 97.61 (97.52 to 97.68). In the group "needs a character class" it goes from 89.7 to 94.7, and from 91.0 to 96.3. No pair of these ranges overlaps. In the group "within reach of the tables" the classes are not told apart from no addition.
- **A rule that reads only the train samples finds most of it.** It picks 11 code points, 9 of them among the 15 of the hand choice, and gains 3.9 and 3.8 points in the group where the hand choice gains 5.1 and 5.2. On all samples it ends at 97.04 (96.64 to 97.19) and 97.35 (97.24 to 97.51), 0.2 to 0.3 points below the hand choice. What it misses most is `=` in the place of a colon.
- **Open display entries are used with one setting of the trainer and not with the other.** With `plain`, all three goes from 96.50 to 97.49 (97.36 to 97.71), the largest gain of a single addition, also in the group "within reach of the tables", 99.11 to 99.50, and in whole samples, 73.22 to 78.52, and no pair of these ranges overlaps. With `three-uniform` it goes from 96.88 to 96.98 (96.92 to 97.08), which is not told apart from no addition. The difference is the start and not the passes: from the base's choices the entries gain 1.0 and 0.9 points with one pass and with three, and from a uniform start nothing with either.
- **Setting the display entries by a count after the training, without gradients, is worth 0.2 points with either setting.** With `plain`, training with open entries is 0.8 points above that count, so its gain is not in the display table alone. With `three-uniform` it is not told apart from the count.
- **The bit "first on its line" is not told apart from no addition**, in any row and with either setting: 96.69 (96.52 to 96.83) and 97.05 (96.82 to 97.25). Its group is at 99.7 and 99.1 without the bit.
- **All three additions together are at the number to beat, 97.75, and not above it**: 97.79 (97.71 to 98.01) and 97.68 (97.48 to 97.86), from today's tables, where the number to beat starts from the hand-written ones. In the group "within reach of the tables" they are below it, 99.53 and 99.26 against 99.68. A search without gradients that starts from the hand-written tables and sets the display entries by a count, in turns, ends at 97.94 with the most read cells first and at 97.81 (97.72 to 97.88) in three random orders.
- **A target that shows the added code points as an error is cheap at a small weight.** With open display entries and `plain`, the weight 0.1 shows 53.6% (46.0 to 59.9) of the added code points as an error, where the control shows none, for 0.15 points of all three, with ranges that overlap. The weight 1 shows 78.5% and 78.0%, and costs 0.9 and 0.3 points and 6 to 11 points of whole samples.
- **What the main number does not show follows the trainer's setting more than the addition.** The depth of valid JSON that is too deep is wrong at 40% to 71% of the code points with `three-uniform` and at 0% to 9% with `plain`, for every addition. With `plain`, the classes show 350 to 567 code points of the validation texts as "past the end", against 50 without them.

## Setup

**A setting** is today's tables with an addition, trained on the train split, with every open cell and every open entry trainable. Its control is the setting "no addition": the same call of the trainer with the same seeds on today's tables as they are. The tables of a seed are the last ones of its run, and nothing is picked on the validation split.

| key in `--settings` | what the setting adds to today's tables | open tokenizer cells | open grammar cells | open display entries |
| --- | --- | --- | --- | --- |
| `none` | nothing: the control | 710 of 858 | 616 of 704 | 0 of 200 |
| `classes-hand` | 15 classes chosen by hand | 1,081 of 1,248 | 616 of 704 | 0 |
| `classes-data` | 11 classes chosen by a rule from the train samples | 985 of 1,144 | 616 of 704 | 0 |
| `display` | open entries of the display table | 710 of 858 | 616 of 704 | 140 of 200 |
| `display-counted` | no training: the tables of `none` of the same seed, then every open display entry set by a count | 710 of 858 | 616 of 704 | 140 of 200 |
| `error-target-0.1`, `error-target-0.3`, `error-target-1` | open display entries, and a target at the code points that the damage added | 710 of 858 | 616 of 704 | 140 of 200 |
| `error-target-0.3-alone` | that target at the weight 0.3, without open display entries | 710 of 858 | 616 of 704 | 0 |
| `bit` | the bit "first on its line" | 710 of 858 | 1,232 of 1,408 | 0 |
| `all` | the 15 classes chosen by hand, open display entries and the bit | 1,081 of 1,248 | 1,232 of 1,408 | 140 of 200 |
| `all-data` | the 11 classes of the rule, open display entries and the bit | 985 of 1,144 | 1,232 of 1,408 | 140 of 200 |

No setting adds a tokenizer state or a grammar state.

**The trainer has two settings**, since a tuned one is being worked out by another arm at the time of these runs. `run.ts` takes the setting by name as `--trainer`, and `trainerSettings` in `facts.ts` holds one line per name, so a tuned setting is one more line.

- `plain`: one pass over the train samples, every mix starts with a share of 0.9 on the choice of the base, every other default. This is the plain pass of `../plain-pass/`, and the tables of "no addition" are the tables of that arm, byte for byte, for each of the 5 seeds.
- `three-uniform`: three passes, every mix starts uniform. This is the setting of `../holes/`, and the row "no addition" is that arm's row "every open cell trainable", 96.88 (96.69 to 97.02).

The two differ in the passes and in the start. Where their results differ, for the display entries, the two other pairs ran too, `one-uniform` and `three-base`, with the settings `none`, `display` and `display-counted` alone.

**The seeds are 1 to 5, and each reported setting was run once.** A seed orders the samples of the training, and for the settings with the target it also draws the code points that get the target.

**The classes chosen by hand** are one class for every character that the dataset's descriptions of the damage name as one that the tokenizer must tell apart (`needsClass` in `../../../README.md` and in `../../../damage/`). **This choice saw the dataset's description of the damage**, which names the character for every form, e.g. "the apostrophe as a quote" for a string in single quotes with a space in it. The 15 classes, with the train samples of the standard set that the dataset says need each: the apostrophe (1,596), the two round brackets (434, a class each), U+00A0 (300), the two typographic quotes `“` and `”` (265, a class each), `=` (208), the carriage return, taken out of the class that it shares with the tab (104), `x` (77, for `\xe9`), `#` (65), `;` (61), `&` (36), `m` (20, typed for a comma), the backtick (19) and `*` (6). Left out: "a colon inside a value without quotes" (18), since the colon has a class of its own already.

**The classes chosen from the train samples** come from a rule that reads no description, `codePointsOfTheRule` in `facts.ts`. For every code point at or after a first error in a train sample, the rule notes what the code point is: the event that today's parser has at its counterpart in the original, e.g. `stringStart` for an apostrophe that stands for a quote, or "added" when the damage added the code point. A code point gets a class of its own when 100 train samples or more have it there, and when its outcomes are far from the outcomes of the other code points of its class: a distance of 0.5 or more, where the distance is the share of the code point's occurrences that would have to be something else for the code point to be as the rest of its class. The two thresholds were set with the ranking of the train split in view, where the picked code points end at 0.70 and the next one is at 0.42, and before any score. The next section has what the rule picks.

**The target at the added code points.** A code point that the damage added has no label, and no score counts it. The settings with the target give such a code point, at or after the first error, the display kind `error` as its label. The trainer's loss has no weight per code point, and its files are not this arm's to change, so **the weight is a share**: with the weight 0.3 every added code point gets the target with the probability 0.3, drawn from the seed, and with the weight 1 every one gets it. The loss is divided by the number of code points with a target, the added ones among them. So a weight above 1 was not tried.

**The display entries by a count** is the comparison without gradients for the display table, `displayEntriesByCount` in `facts.ts`. It takes tables, here the tables of "no addition" of the same seed, and sets every open display entry to the kind that the most train code points want there: the scored code points that read the entry, whose depth and container are right or not scored. What is shown changes nothing that the parser does next, so for those cells of the tokenizer and of the grammar no other display table has more scored code points of the train split right. `search-display.ts` goes one step further: a search of every open cell with `searchCells` of `../holes/`, in turns with the count, from the hand-written tables. `../../search/search.ts` and `searchCells` refuse tables with added classes or with the bit, so the classes and the bit have no comparison without gradients here.

**What the arm is.** It may change every open cell, and every open display entry where a setting has them. Its tables have today's states. They have more classes, 16 contexts or a changed display table where a setting says so, and `plainParserProblems` of every record names it, e.g. "the tables have 15 added character classes". The arm starts from today's tables and trains on the train split alone. On the 2,800 fixed texts of the harness, the ground rules hold for every run.

**Nothing was tuned.** Before the reported runs, five settings ran once with the seed 11 and the trainer's setting `plain`, to see that the scripts run. After that try-out two settings were added, `error-target-0.3-alone` and `all-data`, and nothing else changed. The weights 0.1, 0.3 and 1 were fixed before any run. [Every setting that was tried](#every-setting-that-was-tried) has what ran with which setting of the trainer.

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

Chosen by hand and not by the rule, with the distance of each: equalsSign 0.40, carriageReturn 0.06, letterX 0.15, hash 0.37, letterM 0.14, star 0.09.

Picked by the rule and not chosen by hand: U+FEFF, U+2026.

- **The rule finds 9 of the 15 classes that were chosen by hand**: the apostrophe, the backtick, the two typographic quotes, U+00A0, the two round brackets, `;` and `&`.
- **It misses 6 of them.** Each is mostly something else than what the damage makes of it: `=` is the content of a string at 48% of its occurrences and stands for a colon at 30%, and `x` is the content of a string at 94% and the `x` of `\xe9` at fewer than 1%.
- **It picks 2 that no description names**: U+FEFF, the byte order mark before a document, and U+2026, the ellipsis that marks a text as cut. The damage added every one of their occurrences, where the rest of the class `other` is added at 12%.
- **The rule knows where a code point differs and not what a class is good for.** E.g. the backtick is picked because the damage adds nearly every backtick, e.g. the three of a code fence, in 2,317 train samples, and not for the 19 train samples in which it stands for a quote.

### What the cells of the new classes do

For the seed with the most of all three on the validation split: seed 4 of "classes chosen by hand" with the trainer's setting `three-uniform`, 97.68%. The counts are code points at or after a first error in the train split, read with that seed's tables. `report.ts --cells` prints them, and the cells behind each sentence.

- **The apostrophe**, 60,906 code points: between tokens it starts a string, which is shown as a key or as a string by what the grammar expects (49% of the apostrophes). Every other apostrophe is the content of that string, and none is read as the end of a string. The closing apostrophe leaves the tokenizer in a state for the inside of a word, for most of them the state `zero`, where the frozen cells of a number read the comma, the closing bracket or the white space that comes next, as they read it after a `0`.
- **The opening typographic quote**, 6,211: it starts a string at every occurrence, into the same state as the apostrophe.
- **The closing typographic quote**, 7,803: the content of a string (89%), and the start of one where it stands for an opening quote (11%). After 19% of them the tokenizer is between tokens.
- **U+00A0**, 10,228: white space at every occurrence, and the tokenizer stays between tokens.
- **`=`**, 4,452: between tokens it is a colon (40% of its occurrences, where the originals have a colon at 30%), and inside a word it is content.
- **The opening round bracket**, 3,357, of which the damage added 80%, e.g. the bracket of a call around the document: outside a string its cells hold the event of a colon, which is shown as punctuation (65%), or the start of a number (13%).
- **The closing round bracket**, 3,480: the content of a string (92%), also between tokens, and no cell that is read shows it as an error.
- **The carriage return**, 8,951: white space everywhere. Inside a string, 407 code points, it is shown as white space and takes the tokenizer out of the string, where the tab stays in it. That is the rule "a string that is open at the end of its line ends there" for lines that end with a carriage return and a line feed.
- **`#`**, 1,051: the content of a string. Between tokens it puts the tokenizer into the state `string`, so what follows a `#` is read as an open string.
- **`;`**, 2,205: between tokens it is a colon (28%), elsewhere the content of a string.
- **`&`**, 1,173, all added, e.g. the `&` of `&quot;`: between tokens it starts a string (50%), elsewhere it is shown as white space.
- **The backtick**, 11,760, all added: the content of a string at every occurrence, so the three backticks of a code fence are shown as a string.
- **`x`**, **`m`** and **`*`**, 20,614, 72,814 and 12,055: the content of a string at 98% to 100% of their occurrences, as the letters around them. Their cells lead to other tokenizer states than the cells of `other` and no event differs, so nothing here shows that training used these three classes.

The two classes that only the rule picks, in seed 2 of "classes chosen from the train samples" with `three-uniform`, 97.51%: **U+FEFF**, 197 code points, is white space at every occurrence, and **U+2026**, 177, starts a string between tokens (90%).

**These sentences are one seed.** Another seed and the other setting of the trainer hold other cells for the same score, as `../holes/` found for every trained cell. E.g. in the best seed of the same setting with `plain`, the closing apostrophe puts the tokenizer between tokens from two of its states and not from the others, and one backtick of every code fence holds an event of a text's end, so it is shown as "past the end".

## Results

The validation split of the standard set, the exact parser: 5,021 broken samples, 425 of them with nothing to recover, 675,949 scored code points. Percentages of all three, as the mean and in brackets the lowest and the highest of the seeds 1 to 5. The columns of the first table are all validation samples, the group "within reach of the tables" (3,687 samples), whole samples over all validation samples, and the five other groups, with 326, 37, 488, 76 and 407 samples. **A cell says "above" or "below" when its range does not overlap the range of the row "no addition" of the same table**, which `report.ts` counts. The sentences under the tables are the ones of `describeComparison` for the pairs that the text leans on, and `report.ts` prints them for every pair. The rows after the settings have no trainer: the hand-written tables and the number to beat, each as they are and with their display entries set by a count, and the search in turns with the count, with the most read cells first and in three random orders, see [The display entries without gradients](#the-display-entries-without-gradients). `report.ts` prints every table of this section.

### The trainer's setting `plain`: one pass from the base's choices

The seeds 1, 2, 3, 4, 5. A cell says "above" or "below" when its range does not overlap the range of the row "no addition".

| setting | all three | within reach of the tables | whole samples | needs a character class | needs a display fix | needs a line rule | needs a nesting fix | out of reach |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no addition | 96.50 (95.88 to 96.74) | 99.11 (98.87 to 99.31) | 73.22 (72.76 to 73.54) | 89.7 (88.9 to 90.5) | 96.2 (94.2 to 96.8) | 99.7 (98.9 to 99.9) | 89.4 (83.1 to 92.8) | 81.6 (76.9 to 83.6) |
| classes chosen by hand | 97.25 (97.21 to 97.33), above | 99.21 (99.07 to 99.32) | 75.26 (74.65 to 75.91), above | 94.7 (93.6 to 96.0), above | 96.7 (96.2 to 97.0) | 99.6 (99.0 to 99.7) | 91.9 (91.4 to 92.5) | 83.0 (81.4 to 83.6) |
| classes chosen from the train samples | 97.04 (96.64 to 97.19) | 99.14 (98.94 to 99.23) | 73.82 (73.04 to 74.46) | 93.6 (92.0 to 94.6), above | 95.8 (94.8 to 96.8) | 99.5 (99.1 to 99.8) | 92.0 (91.5 to 92.5) | 82.5 (81.0 to 83.6) |
| open display entries | 97.49 (97.36 to 97.71), above | 99.50 (99.48 to 99.56), above | 78.52 (77.83 to 79.29), above | 95.1 (93.9 to 96.0), above | 98.9 (98.7 to 99.1), above | 99.2 (98.8 to 99.4) | 91.4 (90.6 to 92.2) | 83.3 (81.9 to 84.0) |
| no addition, then the open display entries by a count | 96.69 (96.02 to 96.94) | 99.24 (99.01 to 99.45) | 75.21 (73.48 to 76.48) | 90.5 (89.5 to 91.3) | 97.7 (95.8 to 98.3) | 99.7 (98.9 to 99.9) | 89.4 (83.1 to 92.7) | 81.6 (76.9 to 83.7) |
| open display entries, added code points as an error at the weight 0.1 | 97.35 (97.23 to 97.44), above | 99.39 (99.29 to 99.46) | 77.30 (76.15 to 79.24), above | 94.3 (93.5 to 95.2), above | 98.6 (98.1 to 98.9), above | 99.3 (98.9 to 99.5) | 90.9 (90.2 to 91.6) | 83.4 (82.0 to 84.7) |
| open display entries, added code points as an error at the weight 0.3 | 97.19 (96.90 to 97.51), above | 99.30 (99.12 to 99.44) | 73.98 (71.39 to 76.35) | 93.4 (92.5 to 94.8), above | 98.6 (98.4 to 98.9), above | 98.9 (98.3 to 99.4) | 90.9 (89.7 to 91.8) | 83.9 (82.9 to 84.5) |
| open display entries, added code points as an error at the weight 1 | 96.59 (95.60 to 96.98) | 99.02 (98.48 to 99.26) | 67.93 (64.56 to 70.93), below | 89.5 (83.9 to 92.0) | 98.2 (96.6 to 98.9) | 99.2 (98.9 to 99.4) | 91.5 (91.3 to 91.7) | 83.6 (83.3 to 84.0) |
| added code points as an error at the weight 0.3 | 96.09 (95.33 to 96.42) | 98.83 (98.27 to 99.15) | 67.63 (57.53 to 72.06), below | 87.2 (83.8 to 88.5), below | 95.7 (93.9 to 96.4) | 99.0 (98.6 to 99.6) | 91.2 (89.4 to 92.7) | 82.6 (81.6 to 83.2) |
| the bit first on its line | 96.69 (96.52 to 96.83) | 99.09 (98.98 to 99.25) | 72.73 (72.04 to 73.80) | 90.8 (89.8 to 91.8) | 97.0 (96.5 to 97.3) | 99.7 (99.4 to 99.9) | 90.3 (86.6 to 92.5) | 82.3 (81.7 to 83.1) |
| classes chosen by hand, open display entries and the bit | 97.79 (97.71 to 98.01), above | 99.53 (99.37 to 99.67), above | 82.37 (79.90 to 83.44), above | 98.0 (97.4 to 98.2), above | 99.0 (98.8 to 99.1), above | 99.2 (99.0 to 99.4) | 91.8 (91.5 to 92.4) | 82.8 (81.6 to 84.0) |
| classes chosen from the train samples, open display entries and the bit | 97.72 (97.48 to 97.88), above | 99.48 (99.22 to 99.65) | 81.14 (79.44 to 82.27), above | 97.5 (97.0 to 98.3), above | 98.8 (98.5 to 99.1), above | 99.3 (99.0 to 99.7) | 91.6 (90.8 to 92.3) | 82.8 (82.4 to 83.4) |
| hand-written, the 35 rules of handwritten/rules.ts | 96.52 | 99.51, above | 80.44, above | 92.2, above | 98.2, above | 99.0 | 76.1, below | 78.0 |
| hand-written, then the open display entries by a count | 96.59 | 99.56, above | 83.90, above | 92.5, above | 99.2, above | 99.0 | 76.1, below | 78.0 |
| search from the hand-written tables | 97.75, above | 99.68, above | 79.37, above | 94.9, above | 98.0, above | 99.1 | 90.3 | 85.4, above |
| search from the hand-written tables, then the open display entries by a count | 97.84, above | 99.74, above | 82.16, above | 95.3, above | 99.0, above | 99.1 | 90.3 | 85.4, above |
| search from the hand-written tables and the display entries by a count, in turns | 97.94, above | 99.67, above | 82.07, above | 95.5, above | 99.1, above | 99.8 | 91.3 | 86.0, above |
| search from the hand-written tables in a random order and the display entries by a count, in turns | 97.81 (97.72 to 97.88), above | 99.74 (99.67 to 99.81), above | 82.98 (82.48 to 83.31), above | 95.0 (94.5 to 95.7), above | 99.2 (99.1 to 99.3), above | 99.2 (99.1 to 99.3) | 89.9 (89.2 to 90.6) | 85.4 (85.3 to 85.5), above |

| setting | added code points shown as an error | samples that show an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | cells changed against the base |
| --- | --- | --- | --- | --- | --- | --- |
| no addition | 0.9 (0.7 to 1.1) | 6.2 (4.6 to 7.8) | 50 (0 to 160) | 3.0 (0.0 to 12.3) | 4.7 (0.0 to 16.4) | 967 (935 to 984) |
| classes chosen by hand | 5.2 (3.9 to 6.2), above | 26.2 (24.1 to 28.0), above | 567 (73 to 1235) | 6.7 (0.0 to 22.3) | 9.4 (1.7 to 17.9) | 1233 (1208 to 1250) |
| classes chosen from the train samples | 3.7 (1.7 to 5.7), above | 20.2 (9.0 to 27.1), above | 350 (23 to 1297) | 2.9 (0.0 to 11.6) | 3.3 (0.0 to 9.9) | 1139 (1114 to 1149) |
| open display entries | 0.0 (0.0 to 0.0), below | 0.0 (0.0 to 0.1), below | 104 (0 to 286) | 0.0 (0.0 to 0.0) | 0.7 (0.2 to 1.7) | 953 (921 to 968) |
| no addition, then the open display entries by a count | 0.0 (0.0 to 0.1), below | 0.1 (0.0 to 0.4), below | 50 (0 to 160) | 3.0 (0.0 to 12.3) | 4.7 (0.0 to 16.4) | 997 (967 to 1011) |
| open display entries, added code points as an error at the weight 0.1 | 53.6 (46.0 to 59.9), above | 26.1 (22.2 to 28.1), above | 9 (0 to 45) | 1.1 (0.0 to 5.6) | 0.8 (0.2 to 1.7) | 962 (940 to 990) |
| open display entries, added code points as an error at the weight 0.3 | 65.1 (56.6 to 70.3), above | 36.7 (33.8 to 38.7), above | 6 (0 to 30) | 1.6 (0.0 to 5.6) | 2.2 (0.2 to 7.1) | 988 (977 to 999) |
| open display entries, added code points as an error at the weight 1 | 78.5 (71.9 to 84.4), above | 43.8 (41.7 to 45.7), above | 0 | 3.5 (0.0 to 17.6) | 3.8 (0.6 to 15.4) | 983 (969 to 1013) |
| added code points as an error at the weight 0.3 | 52.6 (44.4 to 58.3), above | 36.9 (33.2 to 42.1), above | 282 (0 to 762) | 5.4 (0.0 to 21.7) | 6.3 (0.2 to 16.6) | 974 (948 to 987) |
| the bit first on its line | 1.1 (0.1 to 2.1) | 7.8 (1.1 to 15.0) | 39 (0 to 138) | 0.2 (0.0 to 1.1) | 2.5 (1.1 to 5.1) | 1234 (1214 to 1252) |
| classes chosen by hand, open display entries and the bit | 0.0 (0.0 to 0.0), below | 0.0 (0.0 to 0.1), below | 208 (127 to 244) | 5.7 (0.0 to 19.0) | 7.9 (1.5 to 24.2) | 1416 (1364 to 1461) |
| classes chosen from the train samples, open display entries and the bit | 0.0 (0.0 to 0.0), below | 0.0 (0.0 to 0.0), below | 123 (0 to 202) | 0.8 (0.0 to 3.3) | 2.8 (0.6 to 7.3) | 1353 (1324 to 1372) |
| hand-written, the 35 rules of handwritten/rules.ts | 0.0, below | 0.0, below | 0 | 0.0 | 0.0 | 915 |
| hand-written, then the open display entries by a count | 0.0, below | 0.0, below | 0 | 0.0 | 0.0 | 921 |
| search from the hand-written tables | 0.0, below | 0.2, below | 0 | 18.5, above | 30.2, above | 429 |
| search from the hand-written tables, then the open display entries by a count | 0.0, below | 0.1, below | 0 | 18.5, above | 30.2, above | 447 |
| search from the hand-written tables and the display entries by a count, in turns | 0.0, below | 0.0, below | 0 | 0.0 | 0.0 | 527 |
| search from the hand-written tables in a random order and the display entries by a count, in turns | 0.0 (0.0 to 0.0), below | 0.0 (0.0 to 0.0), below | 0 | 14.4 (0.8 to 33.2) | 17.0 (0.3 to 32.4) | 481 (473 to 491) |

The ground rules hold on the fixed texts for 60 of the 60 runs.

The tables of "no addition" are the tables that ../plain-pass/ saved, byte for byte, for 5 of the 5 seeds.

### The trainer's setting `three-uniform`: three passes from a uniform start

Not run with the seeds of "no addition" and left out: open display entries, added code points as an error at the weight 0.1; added code points as an error at the weight 0.3; classes chosen from the train samples, open display entries and the bit.
The seeds 1, 2, 3, 4, 5. A cell says "above" or "below" when its range does not overlap the range of the row "no addition".

| setting | all three | within reach of the tables | whole samples | needs a character class | needs a display fix | needs a line rule | needs a nesting fix | out of reach |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no addition | 96.88 (96.69 to 97.02) | 99.27 (99.15 to 99.36) | 73.46 (71.54 to 74.56) | 91.0 (88.8 to 92.2) | 96.9 (96.4 to 97.3) | 99.1 (98.9 to 99.8) | 89.6 (88.3 to 91.1) | 83.6 (82.9 to 84.1) |
| classes chosen by hand | 97.61 (97.52 to 97.68), above | 99.34 (99.27 to 99.39) | 77.13 (75.85 to 78.29), above | 96.3 (95.7 to 96.8), above | 97.6 (97.0 to 97.9) | 99.9 (99.8 to 99.9), above | 92.4 (91.9 to 92.8), above | 83.7 (83.6 to 83.8) |
| classes chosen from the train samples | 97.35 (97.24 to 97.51), above | 99.28 (99.20 to 99.34) | 75.44 (74.48 to 76.35) | 94.9 (94.1 to 95.9), above | 97.1 (96.0 to 97.8) | 99.2 (98.6 to 99.9) | 91.1 (89.3 to 92.4) | 83.9 (82.6 to 84.3) |
| open display entries | 96.98 (96.92 to 97.08) | 99.16 (99.05 to 99.30) | 72.74 (67.97 to 76.37) | 93.1 (92.7 to 93.6), above | 98.7 (98.2 to 98.9), above | 98.4 (98.4 to 98.5), below | 88.9 (86.6 to 89.8) | 83.8 (83.4 to 84.1) |
| no addition, then the open display entries by a count | 97.09 (96.94 to 97.26) | 99.42 (99.32 to 99.48) | 75.41 (73.87 to 76.41) | 91.8 (89.8 to 93.0) | 98.5 (98.0 to 98.9), above | 99.1 (98.9 to 99.8) | 89.6 (88.3 to 91.1) | 83.7 (83.0 to 84.2) |
| open display entries, added code points as an error at the weight 0.3 | 96.94 (96.57 to 97.12) | 98.92 (98.53 to 99.29) | 72.14 (67.91 to 74.96) | 93.5 (92.7 to 93.9), above | 98.4 (97.9 to 98.8), above | 99.0 (98.4 to 99.4) | 90.1 (88.4 to 91.1) | 84.0 (82.9 to 84.7) |
| open display entries, added code points as an error at the weight 1 | 96.67 (96.23 to 96.94) | 98.78 (98.29 to 99.00), below | 66.41 (63.01 to 69.15), below | 92.2 (90.7 to 93.4) | 98.1 (97.8 to 98.6), above | 99.0 (98.2 to 99.3) | 90.2 (88.2 to 91.0) | 83.5 (82.3 to 84.4) |
| the bit first on its line | 97.05 (96.82 to 97.25) | 99.25 (99.17 to 99.38) | 73.20 (72.41 to 73.89) | 92.1 (91.6 to 92.5) | 96.9 (96.3 to 97.5) | 99.8 (99.4 to 99.9) | 88.9 (86.3 to 91.1) | 83.7 (82.0 to 84.7) |
| classes chosen by hand, open display entries and the bit | 97.68 (97.48 to 97.86), above | 99.26 (99.07 to 99.43) | 75.17 (70.28 to 78.24) | 96.7 (96.2 to 97.5), above | 98.5 (98.0 to 98.9), above | 99.2 (98.9 to 99.5) | 90.5 (87.7 to 91.7) | 85.5 (84.7 to 86.3), above |
| hand-written, the 35 rules of handwritten/rules.ts | 96.52, below | 99.51, above | 80.44, above | 92.2, above | 98.2, above | 99.0 | 76.1, below | 78.0, below |
| hand-written, then the open display entries by a count | 96.59, below | 99.56, above | 83.90, above | 92.5, above | 99.2, above | 99.0 | 76.1, below | 78.0, below |
| search from the hand-written tables | 97.75, above | 99.68, above | 79.37, above | 94.9, above | 98.0, above | 99.1 | 90.3 | 85.4, above |
| search from the hand-written tables, then the open display entries by a count | 97.84, above | 99.74, above | 82.16, above | 95.3, above | 99.0, above | 99.1 | 90.3 | 85.4, above |
| search from the hand-written tables and the display entries by a count, in turns | 97.94, above | 99.67, above | 82.07, above | 95.5, above | 99.1, above | 99.8 | 91.3, above | 86.0, above |
| search from the hand-written tables in a random order and the display entries by a count, in turns | 97.81 (97.72 to 97.88), above | 99.74 (99.67 to 99.81), above | 82.98 (82.48 to 83.31), above | 95.0 (94.5 to 95.7), above | 99.2 (99.1 to 99.3), above | 99.2 (99.1 to 99.3) | 89.9 (89.2 to 90.6) | 85.4 (85.3 to 85.5), above |

| setting | added code points shown as an error | samples that show an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | cells changed against the base |
| --- | --- | --- | --- | --- | --- | --- |
| no addition | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.1) | 16 (0 to 79) | 47.9 (41.7 to 68.8) | 54.6 (48.0 to 78.3) | 1158 (1156 to 1160) |
| classes chosen by hand | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 36 (0 to 81) | 39.7 (29.1 to 43.0) | 44.4 (32.1 to 50.1) | 1526 (1524 to 1531) |
| classes chosen from the train samples | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 19 (0 to 54) | 44.4 (42.0 to 50.5) | 50.2 (47.6 to 54.1) | 1405 (1403 to 1407) |
| open display entries | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 | 61.4 (40.8 to 77.9) | 67.9 (48.6 to 83.6) | 1247 (1239 to 1258) |
| no addition, then the open display entries by a count | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 16 (0 to 79) | 47.9 (41.7 to 68.8) | 54.6 (48.0 to 78.3) | 1169 (1165 to 1173) |
| open display entries, added code points as an error at the weight 0.3 | 66.5 (48.3 to 72.3), above | 32.2 (28.2 to 35.6), above | 8 (0 to 42) | 54.6 (40.5 to 78.6) | 61.8 (49.9 to 87.6) | 1218 (1212 to 1226) |
| open display entries, added code points as an error at the weight 1 | 78.0 (68.6 to 81.5), above | 41.5 (38.2 to 45.2), above | 69 (0 to 249) | 54.2 (43.8 to 59.5) | 63.2 (50.1 to 71.9) | 1196 (1174 to 1206) |
| the bit first on its line | 0.0 (0.0 to 0.0) | 0.2 (0.0 to 0.8) | 23 (0 to 58) | 63.1 (57.1 to 68.9) | 70.8 (63.4 to 79.0) | 1647 (1638 to 1653) |
| classes chosen by hand, open display entries and the bit | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 41 (10 to 92) | 63.4 (56.2 to 70.6) | 68.4 (61.6 to 76.7) | 2116 (2111 to 2119) |
| hand-written, the 35 rules of handwritten/rules.ts | 0.0 | 0.0 | 0 | 0.0, below | 0.0, below | 915 |
| hand-written, then the open display entries by a count | 0.0 | 0.0 | 0 | 0.0, below | 0.0, below | 921 |
| search from the hand-written tables | 0.0, above | 0.2, above | 0 | 18.5, below | 30.2, below | 429 |
| search from the hand-written tables, then the open display entries by a count | 0.0, above | 0.1, above | 0 | 18.5, below | 30.2, below | 447 |
| search from the hand-written tables and the display entries by a count, in turns | 0.0 | 0.0 | 0 | 0.0, below | 0.0, below | 527 |
| search from the hand-written tables in a random order and the display entries by a count, in turns | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | 0 | 14.4 (0.8 to 33.2), below | 17.0 (0.3 to 32.4), below | 481 (473 to 491) |

The ground rules hold on the fixed texts for 45 of the 45 runs.

### The classes

- `plain`. All three, all validation samples: "classes chosen by hand" has 97.25 (97.21 to 97.33) over 5 seeds, "no addition" has 96.50 (95.88 to 96.74) over 5 seeds. The means differ by +0.75 points, and the two ranges do not overlap.
- `plain`. All three, group: needs a character class: "classes chosen by hand" has 94.74 (93.64 to 96.05) over 5 seeds, "no addition" has 89.68 (88.86 to 90.46) over 5 seeds. The means differ by +5.07 points, and the two ranges do not overlap.
- `three-uniform`. All three, all validation samples: "classes chosen by hand" has 97.61 (97.52 to 97.68) over 5 seeds, "no addition" has 96.88 (96.69 to 97.02) over 5 seeds. The means differ by +0.73 points, and the two ranges do not overlap.
- `three-uniform`. All three, group: needs a character class: "classes chosen by hand" has 96.27 (95.73 to 96.81) over 5 seeds, "no addition" has 91.04 (88.76 to 92.20) over 5 seeds. The means differ by +5.23 points, and the two ranges do not overlap.
- `plain`. All three, all validation samples: "classes chosen from the train samples" has 97.04 (96.64 to 97.19) over 5 seeds, "no addition" has 96.50 (95.88 to 96.74) over 5 seeds. The means differ by +0.54 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- `three-uniform`. All three, all validation samples: "classes chosen from the train samples" has 97.35 (97.24 to 97.51) over 5 seeds, "no addition" has 96.88 (96.69 to 97.02) over 5 seeds. The means differ by +0.47 points, and the two ranges do not overlap.
- `plain`. All three, all validation samples: "classes chosen by hand" has 97.25 (97.21 to 97.33) over 5 seeds, "classes chosen from the train samples" has 97.04 (96.64 to 97.19) over 5 seeds. The means differ by +0.21 points, and the two ranges do not overlap.
- `three-uniform`. All three, all validation samples: "classes chosen by hand" has 97.61 (97.52 to 97.68) over 5 seeds, "classes chosen from the train samples" has 97.35 (97.24 to 97.51) over 5 seeds. The means differ by +0.26 points, and the two ranges do not overlap.

- **Training uses the classes with either setting of the trainer**: 0.7 points on all samples and 5 points in the group "needs a character class" for the hand choice, with ranges that do not overlap.
- **The gain is where the group says it is.** In the group "within reach of the tables" neither choice is told apart from no addition, with either setting.
- **The rule's classes have about three quarters of the hand choice's gain in the group**, 3.9 and 3.8 points against 5.1 and 5.2. On all samples the hand choice is 0.2 to 0.3 points above the rule with ranges that do not overlap, and in the group the two ranges overlap.
- **What the rule misses is mostly `=`.** The kind `foreignKeySeparator`, `=` or `=>` for a colon, 24 validation samples, goes from 71.9 (63.8 to 83.0) to 97.7 (97.0 to 99.2) with the hand choice and `plain`, and is not among the kinds that the rule's classes move. Both choices move `nonBreakingSpace`, 83.9 to 97.7 and 97.8, and `curlyQuotes`, 88.1 to 96.5 and 96.5.
- **The classes do not pay for the kind that they were named for as much as the display entries do.** `singleQuotedString`, 333 validation samples, is at 93.4 (92.9 to 93.7) without an addition and `plain`. The hand-chosen classes do not move it out of that range, and open display entries without any class raise it to 98.2 (97.9 to 98.6). With `three-uniform` it goes from 94.8 (94.2 to 95.3) to 96.4 (95.7 to 96.9) with the classes and to 97.1 (96.2 to 97.6) with the entries.

### The display entries

- `plain`. All three, all validation samples: "open display entries" has 97.49 (97.36 to 97.71) over 5 seeds, "no addition" has 96.50 (95.88 to 96.74) over 5 seeds. The means differ by +0.99 points, and the two ranges do not overlap.
- `plain`. All three, group: within reach of the tables: "open display entries" has 99.50 (99.48 to 99.56) over 5 seeds, "no addition" has 99.11 (98.87 to 99.31) over 5 seeds. The means differ by +0.39 points, and the two ranges do not overlap.
- `three-uniform`. All three, all validation samples: "open display entries" has 96.98 (96.92 to 97.08) over 5 seeds, "no addition" has 96.88 (96.69 to 97.02) over 5 seeds. The means differ by +0.10 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- `three-uniform`. All three, group: within reach of the tables: "open display entries" has 99.16 (99.05 to 99.30) over 5 seeds, "no addition" has 99.27 (99.15 to 99.36) over 5 seeds. The means differ by -0.11 points, and the two ranges overlap, so these seeds do not tell the two settings apart.

- **With `plain`, open display entries are the single addition with the largest gain**: a point on all samples, 0.4 points in the group "within reach of the tables", 5.3 points of whole samples, and 5.4 points in the group "needs a character class", which is as much as the classes give there. No pair of these ranges overlaps.
- **With `three-uniform` the gain on all samples is gone**: 0.10 points with ranges that overlap, and the mean of the group "within reach of the tables" is 0.11 below no addition. The group "needs a display fix" still gains 1.7 points, and the group "needs a line rule" loses 0.7: 98.4 (98.4 to 98.5) against 99.1 (98.9 to 99.8).
- **Open entries cost in a few kinds, with either setting**: `hashComment` 96.6 to 83.4 and 97.0 to 83.3 (15 samples), `unquotedValue` 98.0 to 93.7 and 98.5 to 92.8 (51 samples), `missingComma` 98.5 to 97.7 with both (567 samples), and with `three-uniform` also `logLines` 99.9 to 86.8 (29 samples) and `openStringMidLine` 85.6 to 82.3 (176 samples). Every pair of these ranges does not overlap.

**Is it the passes or the start?** `plain` and `three-uniform` differ in both, so the settings "no addition" and "open display entries" also ran with the two other pairs of passes and starts, with the same seeds. All three on all validation samples:

| trainer | passes | start | no addition | open display entries | no addition, then the open display entries by a count |
| --- | --- | --- | --- | --- | --- |
| `plain` | 1 | the base's choices | 96.50 (95.88 to 96.74) | 97.49 (97.36 to 97.71) | 96.69 (96.02 to 96.94) |
| `three-base` | 3 | the base's choices | 96.80 (96.61 to 96.99) | 97.69 (97.64 to 97.79) | 97.00 (96.76 to 97.23) |
| `one-uniform` | 1 | uniform | 96.62 (95.98 to 96.91) | 96.35 (96.08 to 96.56) | 96.76 (96.10 to 97.02) |
| `three-uniform` | 3 | uniform | 96.88 (96.69 to 97.02) | 96.98 (96.92 to 97.08) | 97.09 (96.94 to 97.26) |

- `three-base`. All three, all validation samples: "open display entries" has 97.69 (97.64 to 97.79) over 5 seeds, "no addition" has 96.80 (96.61 to 96.99) over 5 seeds. The means differ by +0.89 points, and the two ranges do not overlap.
- `one-uniform`. All three, all validation samples: "open display entries" has 96.35 (96.08 to 96.56) over 5 seeds, "no addition" has 96.62 (95.98 to 96.91) over 5 seeds. The means differ by -0.27 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- `one-uniform`. All three, group: within reach of the tables: "open display entries" has 98.52 (98.34 to 98.71) over 5 seeds, "no addition" has 99.33 (99.24 to 99.39) over 5 seeds. The means differ by -0.81 points, and the two ranges do not overlap.

- **It is the start.** From the base's choices, open display entries gain 1.0 and 0.9 points with one pass and with three, with ranges that do not overlap. From a uniform start they gain nothing on all samples with one pass or with three, and with one pass they lose 0.8 points in the group "within reach of the tables", 98.52 (98.34 to 98.71) against 99.33 (99.24 to 99.39).
- **A reading, which is not measured**: a start at the base gives every open entry a share of 0.9 on today's kind, e.g. `string` for the content of a string where a value is expected, and a uniform start gives each of the 8 kinds the same share, so the run has to find today's kinds again from the samples. The cells of the tokenizer and of the grammar lose less by a uniform start: today's choice of most open cells leads into an error, which a recovery replaces anyway.
- **The count is worth the same 0.1 to 0.2 points with all four settings**: it starts from tables that were trained with today's display table.
- **The best single addition of the arm is in this table**: open display entries with three passes from the base's choices, 97.69 (97.64 to 97.79). The classes, the bit and all three together did not run with that setting of the trainer.

### The display entries without gradients

- `plain`. All three, all validation samples: "open display entries" has 97.49 (97.36 to 97.71) over 5 seeds, "no addition, then the open display entries by a count" has 96.69 (96.02 to 96.94) over 5 seeds. The means differ by +0.80 points, and the two ranges do not overlap.
- `plain`. All three, group: within reach of the tables: "open display entries" has 99.50 (99.48 to 99.56) over 5 seeds, "no addition, then the open display entries by a count" has 99.24 (99.01 to 99.45) over 5 seeds. The means differ by +0.27 points, and the two ranges do not overlap.
- `three-uniform`. All three, all validation samples: "open display entries" has 96.98 (96.92 to 97.08) over 5 seeds, "no addition, then the open display entries by a count" has 97.09 (96.94 to 97.26) over 5 seeds. The means differ by -0.10 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- `three-uniform`. All three, group: within reach of the tables: "open display entries" has 99.16 (99.05 to 99.30) over 5 seeds, "no addition, then the open display entries by a count" has 99.42 (99.32 to 99.48) over 5 seeds. The means differ by -0.26 points, and the two ranges do not overlap.

- **A count after training without open entries is worth 0.2 points with either setting**, and is not told apart from no addition on all samples. It changes 9 to 32 of the 140 open entries, and it cannot lower the score on the train split.
- **With `plain`, training with open entries is 0.8 points above the count**, with ranges that do not overlap. So the gain of that setting is not in the display table alone: the cells of the tokenizer and of the grammar end elsewhere when the entries are trained with them.
- **With `three-uniform`, training with open entries is not told apart from the count on all samples, and is 0.26 points below it in the group "within reach of the tables"**, with ranges that do not overlap. So with that setting a count after the training is the better use of the open entries.
- **The number to beat with its display entries counted is 97.84**, 0.09 above the number to beat, and its whole samples go from 79.37 to 82.16. The hand-written tables go from 96.52 to 96.59, and from 80.44 to 83.90 in whole samples, the most of any row of the two tables.

**A search of the cells in turns with the count** is the comparison without gradients on the cells and the entries together, `search-display.ts`. It starts from the hand-written tables, as the number to beat does: it counts the display entries, searches every open cell with the search of `../../search/`, counts again, and ends when the count changes no entry.

- **With the most read cells first, the order of the number to beat, it ends at 97.94**, after 3 rounds and 4 minutes: 0.19 above the number to beat and 0.10 above the number to beat with counted entries. It has 99.67 in the group "within reach of the tables" and 82.07 of whole samples, and it has no wrong depth on valid JSON that is too deep, where the number to beat has 18.5% and 30.2%.
- **In three random orders it ends at 97.81 (97.72 to 97.88)**, with 99.74 (99.67 to 99.81) in the group "within reach of the tables" and 82.98 (82.48 to 83.31) of whole samples. So the four orders are 0.22 points apart, where three orders of the search from today's tables are 6.9 points apart (`../../README.md`). The depth of valid JSON that is too deep is wrong at 14.4% (0.8 to 33.2) and 17.0% (0.3 to 32.4) of the code points in the random orders: which order keeps it is an accident.
- **Training from today's tables with open display entries alone is below this search** with `plain`, 97.49 (97.36 to 97.71), and is not told apart from its random orders with `three-base`, 97.69 (97.64 to 97.79). With all three additions training is not told apart from the search on all samples, with either setting of the trainer. In the group "within reach of the tables" the search is above every trained setting's mean, 99.67 to 99.81 against 99.54 at most.

- `plain`. All three, all validation samples: "open display entries" has 97.49 (97.36 to 97.71) over 5 seeds, "search from the hand-written tables and the display entries by a count, in turns" has 97.94 and no seed. The means differ by -0.45 points, and the two ranges do not overlap.
- `plain`. All three, all validation samples: "classes chosen by hand, open display entries and the bit" has 97.79 (97.71 to 98.01) over 5 seeds, "search from the hand-written tables and the display entries by a count, in turns" has 97.94 and no seed. The means differ by -0.15 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- `plain`. All three, all validation samples: "open display entries" has 97.49 (97.36 to 97.71) over 5 seeds, "search from the hand-written tables in a random order and the display entries by a count, in turns" has 97.81 (97.72 to 97.88) over 3 seeds. The means differ by -0.32 points, and the two ranges do not overlap.
- `three-base`. All three, all validation samples: "open display entries" has 97.69 (97.64 to 97.79) over 5 seeds, "search from the hand-written tables in a random order and the display entries by a count, in turns" has 97.81 (97.72 to 97.88) over 3 seeds. The means differ by -0.12 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- `plain`. All three, all validation samples: "classes chosen by hand, open display entries and the bit" has 97.79 (97.71 to 98.01) over 5 seeds, "search from the hand-written tables in a random order and the display entries by a count, in turns" has 97.81 (97.72 to 97.88) over 3 seeds. The means differ by -0.02 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- `three-uniform`. All three, all validation samples: "classes chosen by hand, open display entries and the bit" has 97.68 (97.48 to 97.86) over 5 seeds, "search from the hand-written tables in a random order and the display entries by a count, in turns" has 97.81 (97.72 to 97.88) over 3 seeds. The means differ by -0.13 points, and the two ranges overlap, so these seeds do not tell the two settings apart.

### The bit "first on its line"

- `plain`. All three, all validation samples: "the bit first on its line" has 96.69 (96.52 to 96.83) over 5 seeds, "no addition" has 96.50 (95.88 to 96.74) over 5 seeds. The means differ by +0.18 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- `three-uniform`. All three, all validation samples: "the bit first on its line" has 97.05 (96.82 to 97.25) over 5 seeds, "no addition" has 96.88 (96.69 to 97.02) over 5 seeds. The means differ by +0.16 points, and the two ranges overlap, so these seeds do not tell the two settings apart.

- **The bit is not told apart from no addition in any row, with either setting of the trainer.**
- **Its group leaves little to gain**: "needs a line rule" is at 99.7 and 99.1 without the bit.
- **One kind moves with `plain`**: `missingColon`, 29 validation samples, from 90.6 (89.3 to 95.2) to 97.6 (95.8 to 98.0). `keyWithoutColon`, 301 samples, goes from 99.6 (99.6 to 99.7) to 99.0 (98.1 to 99.4).
- The bit doubles the open grammar cells, from 616 to 1,232, and a pass takes about half as long again: 133 s against 84 s for three passes.

### All three together

- `plain`. All three, all validation samples: "classes chosen by hand, open display entries and the bit" has 97.79 (97.71 to 98.01) over 5 seeds, "no addition" has 96.50 (95.88 to 96.74) over 5 seeds. The means differ by +1.29 points, and the two ranges do not overlap.
- `three-uniform`. All three, all validation samples: "classes chosen by hand, open display entries and the bit" has 97.68 (97.48 to 97.86) over 5 seeds, "no addition" has 96.88 (96.69 to 97.02) over 5 seeds. The means differ by +0.80 points, and the two ranges do not overlap.
- `plain`. All three, all validation samples: "classes chosen by hand, open display entries and the bit" has 97.79 (97.71 to 98.01) over 5 seeds, "search from the hand-written tables" has 97.75 and no seed. The means differ by +0.04 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- `plain`. All three, group: within reach of the tables: "classes chosen by hand, open display entries and the bit" has 99.53 (99.37 to 99.67) over 5 seeds, "search from the hand-written tables" has 99.68 and no seed. The means differ by -0.16 points, and the two ranges do not overlap.
- `three-uniform`. All three, all validation samples: "classes chosen by hand, open display entries and the bit" has 97.68 (97.48 to 97.86) over 5 seeds, "search from the hand-written tables" has 97.75 and no seed. The means differ by -0.07 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- `three-uniform`. All three, group: within reach of the tables: "classes chosen by hand, open display entries and the bit" has 99.26 (99.07 to 99.43) over 5 seeds, "search from the hand-written tables" has 99.68 and no seed. The means differ by -0.43 points, and the two ranges do not overlap.

- **With all three, training from today's tables is at the number to beat and not above it**, with either setting: 97.79 and 97.68 against 97.75, which is inside both ranges. The number to beat started from the hand-written tables, and these runs from today's.
- **In the group "within reach of the tables" both are below the number to beat**, 99.53 and 99.26 against 99.68, with ranges that do not overlap. What they have more is in the group "needs a character class", 98.0 and 96.7 against 94.9.
- **The additions do not add up.** With `plain` the classes give 0.75 points alone and the entries 0.99, and all three give 1.29. With `three-uniform` all three give 0.80, and the classes alone 0.73.
- **Whole samples**: with `plain` 82.37 (79.90 to 83.44), against 73.22 without an addition, 78.52 with the entries alone and 79.37 for the number to beat. With `three-uniform` 75.17 (70.28 to 78.24), not told apart from 73.46 without an addition.
- With the rule's classes in place of the hand choice, all three together is not told apart from the hand choice (`plain`).

### The target "an added code point is shown as an error"

The best tables of the experiment show almost no added code point as an error, where today's parser shows 89.6% of them so, and 61.0% of the samples show an error somewhere. The control of the target is the setting "open display entries", which the target was run with.

| trainer | weight | all three | within reach of the tables | whole samples | added code points shown as an error | samples that show an error |
| --- | --- | --- | --- | --- | --- | --- |
| `plain` | none: the control | 97.49 (97.36 to 97.71) | 99.50 (99.48 to 99.56) | 78.52 (77.83 to 79.29) | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.1) |
| `plain` | 0.1 | 97.35 (97.23 to 97.44) | 99.39 (99.29 to 99.46) | 77.30 (76.15 to 79.24) | 53.6 (46.0 to 59.9) | 26.1 (22.2 to 28.1) |
| `plain` | 0.3 | 97.19 (96.90 to 97.51) | 99.30 (99.12 to 99.44) | 73.98 (71.39 to 76.35) | 65.1 (56.6 to 70.3) | 36.7 (33.8 to 38.7) |
| `plain` | 1 | 96.59 (95.60 to 96.98) | 99.02 (98.48 to 99.26) | 67.93 (64.56 to 70.93) | 78.5 (71.9 to 84.4) | 43.8 (41.7 to 45.7) |
| `plain` | 0.3, without open display entries | 96.09 (95.33 to 96.42) | 98.83 (98.27 to 99.15) | 67.63 (57.53 to 72.06) | 52.6 (44.4 to 58.3) | 36.9 (33.2 to 42.1) |
| `three-uniform` | none: the control | 96.98 (96.92 to 97.08) | 99.16 (99.05 to 99.30) | 72.74 (67.97 to 76.37) | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) |
| `three-uniform` | 0.3 | 96.94 (96.57 to 97.12) | 98.92 (98.53 to 99.29) | 72.14 (67.91 to 74.96) | 66.5 (48.3 to 72.3) | 32.2 (28.2 to 35.6) |
| `three-uniform` | 1 | 96.67 (96.23 to 96.94) | 98.78 (98.29 to 99.00) | 66.41 (63.01 to 69.15) | 78.0 (68.6 to 81.5) | 41.5 (38.2 to 45.2) |

- `plain`. All three, all validation samples: "open display entries, added code points as an error at the weight 0.1" has 97.35 (97.23 to 97.44) over 5 seeds, "open display entries" has 97.49 (97.36 to 97.71) over 5 seeds. The means differ by -0.15 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- `plain`. All three, all validation samples: "open display entries, added code points as an error at the weight 0.3" has 97.19 (96.90 to 97.51) over 5 seeds, "open display entries" has 97.49 (97.36 to 97.71) over 5 seeds. The means differ by -0.30 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- `plain`. All three, all validation samples: "open display entries, added code points as an error at the weight 1" has 96.59 (95.60 to 96.98) over 5 seeds, "open display entries" has 97.49 (97.36 to 97.71) over 5 seeds. The means differ by -0.90 points, and the two ranges do not overlap.
- `three-uniform`. All three, all validation samples: "open display entries, added code points as an error at the weight 0.3" has 96.94 (96.57 to 97.12) over 5 seeds, "open display entries" has 96.98 (96.92 to 97.08) over 5 seeds. The means differ by -0.04 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- `three-uniform`. All three, all validation samples: "open display entries, added code points as an error at the weight 1" has 96.67 (96.23 to 96.94) over 5 seeds, "open display entries" has 96.98 (96.92 to 97.08) over 5 seeds. The means differ by -0.32 points, and the two ranges overlap, so these seeds do not tell the two settings apart.

- **A small weight gives most of it.** With `plain`, the weight 0.1 shows 53.6% (46.0 to 59.9) of the added code points as an error, in 26.1% of the samples, for 0.15 points of all three with ranges that overlap, and for 0.12 points in the group "within reach of the tables" with ranges that do not. The weight 0.3 shows 65.1% and 66.5%, for 0.30 and 0.04 points of all three, with ranges that overlap for both settings of the trainer.
- **A larger weight gives less per point**: from the weight 0.3 to the weight 1 the added code points that are shown as an error go from 65% to 78%, with either setting, and whole samples fall by 6 points: 73.98 to 67.93 and 72.14 to 66.41. With the weight 1 and `plain`, all three is 0.90 points below the control with ranges that do not overlap.
- **The target costs more without open display entries.** With `plain` and the weight 0.3, tables of today's display table show 52.6% (44.4 to 58.3) of the added code points as an error for 96.09 (95.33 to 96.42), where tables with open entries show 65.1% for 97.19 (96.90 to 97.51). With today's display table only the seven error events are shown as an error, and with open entries any event can be, by the grammar state after it.
- **The group "needs a display fix" stays above no addition at every weight**, by 1.2 to 2.5 points in the means. One kind loses with the target that the entries alone do not move out of the range of no addition: `missingColon`, 29 validation samples, from 90.6 (89.3 to 95.2) to 76.9 (75.9 to 77.9) at the weight 0.1 with `plain`.

### What the main number does not show

The second table of each setting of the trainer has it. What stands out:

- **The depth of valid JSON that is too deep depends on the trainer's setting far more than on the addition.** With `three-uniform` it is wrong at 40% to 71% of the code points for every setting, and with `plain` at 0% to 9%, as the means over the seeds. No addition protects it and none breaks it: within a setting of the trainer the range of every trained setting overlaps the range of no addition.
- **Classes with `plain` show code points of the text as "past the end"**: 567 (73 to 1,235) with the hand choice and 350 (23 to 1,297) with the rule's, against 50 (0 to 160) without an addition. In the best seed it is one backtick of every code fence, whose cell snapped to an event of a text's end. With `three-uniform` it is 36 (0 to 81).
- **Classes with `plain` also show more errors**: 5.2% (3.9 to 6.2) of the added code points and 26.2% of the samples, against 0.9% and 6.2%. With `three-uniform` the settings without the target show an error in 0.0% to 0.2% of the samples.
- **Open display entries with `plain` show almost no error**, in 0.0% (0.0 to 0.1) of the samples, and have the fewest wrong depths of that setting, 0.0 and 0.7 (0.2 to 1.7), with ranges that overlap the ones of no addition.
- **The count "cells changed against the base" grows with the structure**: 967 without an addition, 1,233 with 15 classes and 1,416 with all three (`plain`), and 1,158, 1,526 and 2,116 with `three-uniform`, where a uniform start changes more cells that no text reads.

## What the arm shows

- **Classes are used.** A class for the characters that the damage puts in the place of JSON syntax gives training 5 points in the group that needs them, with two settings of the trainer, and a rule that reads only the train samples finds three quarters of that.
- **Whether open display entries are used depends on the trainer.** One pass from today's kinds gains a point and gains in every row. Three passes from a uniform start gain nothing on all samples, and a count after the training does as well or better. The difference is the start: from today's kinds the entries gain with one pass and with three, and from a uniform start with neither.
- **The bit is not used by itself.** Nothing in these runs tells it apart from no addition, and its group is at 99% without it.
- **All three additions bring training from today's tables to the number to beat, and not past it.** The number to beat needed the hand-written tables to start from. With open display entries the search has more to gain too: in turns with a count it ends at 97.72 to 97.94 in four orders of its cells.
- **A highlighter that marks what it skips is cheap up to a point.** Half of the added code points are shown as an error for 0.15 points of all three, and two thirds for 0.0 to 0.3 points, with open display entries. Three quarters cost up to 0.9 points and 6 to 11 points of whole samples.
- **What the dataset has no sample for follows the trainer's setting, whatever is added**: the depth of valid JSON that is too deep is wrong at half of the code points with three passes from a uniform start.

## What the arm does not show

- **Nothing was tuned, and the tuned setting of the trainer is not in these runs.** The display entries show how much an addition's gain can depend on the trainer, so every gain here is the gain with these two settings. `run.ts --trainer` takes a tuned one.
- **All three additions with three passes from the base's choices were not run**, although that setting has the highest row of the display entries alone. It is the first run to make with `--trainer three-base`.
- **No number of the hand-chosen classes is a number on unseen data.** The choice read the dataset's descriptions of the damage, which describe the forms of every split. The rule read the train split alone.
- **Not which of the 15 classes pay.** The classes were trained together. In the best seed the cells of `x`, `m` and `*` do nothing that the events show.
- **No comparison without gradients for the classes and for the bit**: the search refuses such tables. For the display entries the comparison is a count, and a search in turns with the count from the hand-written tables. A search from today's tables with open entries was not run.
- **The weight of the target is a share of the added code points**, since the trainer's loss has no weight per code point. No weight above 1 was tried, and every added code point gets the same target, the white space of an added comment as the stray bracket. Whether a highlighter should mark what it skips, and what of it, is the design question that the numbers are for.
- **The bit with added states was not tried.** The dataset's hand rule `lines` gains its 1.8 points in the group "needs a line rule" with one added tokenizer state, and no setting here adds a state.
- **A port needs more than cells**: a class table for code points from U+0080 up, e.g. U+00A0 and the typographic quotes, and for the rule's classes U+FEFF, see `../../structure/README.md`. Tables with a changed display table are no tables of the dataset's plain table parser.
- **The test split, the held-out kinds and the held-out template** were not scored.

## Every setting that was tried

Everything that ran is in the tables above, with the seeds 1 to 5, once each:

- With `plain`, all 12 settings. With `three-uniform`, 9 of them: the weight 0.1 of the target, the target without open display entries and `all-data` were left out for lack of time.
- With `one-uniform` and `three-base`, the settings `none`, `display` and `display-counted`. The two were added after the results of the display entries were seen, to tell the passes from the start, and nothing else ran with them.
- The search in turns with the count: once with the most read cells first, and in three random orders.
- One try-out before the reported runs: the settings `none`, `display-counted`, `classes-data`, `error-target-0.3` and `all` with the trainer's setting `plain` and the seed 11, to see that the scripts run. Its numbers are not in any table.
- No learning rate, temperature or sharpness cost was changed.
- One hand choice of classes, and one rule with one pair of thresholds. No other list of classes was trained.

## Commands

Run from the repo root. Every setting of the trainer is an arm of its own for the harness, e.g. `extra-facts-plain` and `extra-facts-three-uniform`, so their runs are kept next to each other in the scratch folder. The search is the arm `extra-facts-search`.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/handwritten/rules.ts                # the hand-written tables, which the next command starts from
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/handwritten/tables.json --out $RECOVERY_SCRATCH/search/search-from-handwritten.json   # the number to beat, which the report compares with
bun lab/recovery-parser/learn/arms/plain-pass/run.ts              # the plain pass, whose tables the report compares the control with
bun lab/recovery-parser/learn/arms/extra-facts/run.ts --trainer plain            # 12 settings, 5 seeds, about 35 minutes with other jobs running
bun lab/recovery-parser/learn/arms/extra-facts/run.ts --trainer three-uniform --settings none,classes-hand,classes-data,display,display-counted,error-target-0.3,error-target-1,bit,all   # about 70 minutes
bun lab/recovery-parser/learn/arms/extra-facts/run.ts --trainer one-uniform --settings none,display,display-counted   # about 5 minutes
bun lab/recovery-parser/learn/arms/extra-facts/run.ts --trainer three-base --settings none,display,display-counted    # about 15 minutes
bun lab/recovery-parser/learn/arms/extra-facts/search-display.ts                 # the search in turns with the count, most read cells first, about 4 minutes
bun lab/recovery-parser/learn/arms/extra-facts/search-display.ts --seeds 1,2,3   # the same in three random orders, about 12 minutes
bun lab/recovery-parser/learn/arms/extra-facts/report.ts          # the tables above, from the saved runs, under a minute
bun lab/recovery-parser/learn/arms/extra-facts/report.ts --cells  # also the cells of the new classes in the best seed
```

`run.ts` takes `--settings` with keys of the table in [Setup](#setup), in the order to run them, and `--seeds`, e.g. `--settings none,display --seeds 11,12,13`. The setting `display-counted` reads the tables that `none` saved for the same seed, so `none` runs before it. A run of some settings leaves the saved files of the other settings as they are, and `report.ts` leaves out a setting that was not run with the seeds of "no addition".

A tuned setting of the trainer is one more line in `trainerSettings` of `facts.ts`, e.g. `'tuned': {passes: 10, start: 'uniform', learningRate: 0.1, temperatureEnd: 1, sharpnessCost: 0}`, and then `run.ts --trainer tuned`.

## Files

- `facts.ts`: the settings of the arm and of the trainer, the classes chosen by hand, the rule that chooses classes from the train samples (`codePointsOfTheRule`), the base of a setting (`baseOf`), the target at the added code points (`withErrorTarget`), and the display entries by a count (`displayEntriesByCount`).
- `run.ts`: the runs of one setting of the trainer.
- `search-display.ts`: the search of every open cell in turns with the count of the display entries, the comparison without gradients for the open entries.
- `report.ts`: the tables of this README, from the saved runs.
