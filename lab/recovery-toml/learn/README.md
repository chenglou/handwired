# The machinery of the recovery experiment, for the TOML tables

The JSON experiment (`lab/recovery-parser/learn/`) trained the table cells that valid JSON never reads, so that the highlighter recovers after an error. This folder is that machinery for the TOML tables of the folder above: the same files, copied and adapted, so that the recipe that came out of the JSON experiment can run on TOML with no setting changed. `lab/recovery-parser/learn/README.md` and the READMEs of its folders `soft/`, `structure/`, `search/` and `arms/combined/` explain the ideas. This README says what is here, what differs, and how to run it.

Nothing here has run on the dataset beyond loading it and scoring the parser as it is. The recipe itself has only run on a small set that a check makes, see [The check set](#the-check-set).

## Words

- A **cell** is one entry of the tokenizer's table, (tokenizer state, class), or of the grammar's table, (grammar state, token, context).
- A **frozen cell** is a cell that some text makes the parser read before that text's first error, e.g. (between, quote). Frozen cells never change, so every text gets today's trace up to its first error, and valid TOML is parsed exactly as today.
- An **open cell** is every other cell, e.g. (between, colon), which the colon of `a : 1` reads. Open cells are what a training or a search may change.
- A **choice** is what an open cell holds: a next tokenizer state and an event, or a next grammar state and a stack action (by token, none, push an array, push an inline table, pop).

## Files

| File | What it is | Against the JSON file of the same name |
| --- | --- | --- |
| `recovery-tables.ts` | The tables with their masks of open cells, saving and loading, `addClasses`, `openDisplayEntries`, `addFirstOnLineBit`, `addStates` | Today's stack actions are part of today's tables. The search for frozen cells is new, see below |
| `recovery-parser.ts` | The exact parser for such tables | Other imports |
| `data.ts` | Samples in typed arrays: `samplesOf(texts)` for any labeled texts, `loadSamples` for the dataset | Rewritten around a small type, see below |
| `score.ts` | All three and whole over the code points after the first error | No bound of the plain table parser. The groups are the dataset's: the number of edits |
| `soft/` | The trainable twin, its trainer and their checks | Other imports and names |
| `search/` | The greedy search over cells, its parser loop and its worker | `search.ts` is `searchCells` of `arms/holes/restricted-search.ts`. The votes are not ported |
| `recipe.ts` | The frozen recipe as `runRecipe`, and its parts | New file, each part a copy of a named JSON function |
| `check-set.ts`, `check-texts.ts` | The samples and the texts of the checks | New |
| `check-*.ts`, `soft/check-*.ts`, `search/check.ts`, `check-all.ts` | The checks | Ported, with the check set in the place of the JSON dataset |

Not ported, because the recipe uses none of it: the hand-written rules, the votes, the arms and their harness, the step as a Handwired circuit, the bound of the plain table parser, and the mark of the intended states that a parser can be in (`codePointCanFollow`). Without that mark, the twin's extra targets and keeping a run on track only do something with `intendedEverywhere`.

## Sizes

| | TOML | JSON |
| --- | --- | --- |
| Tokenizer cells | 5,217: 2,459 frozen, 2,758 open | 858: 148 frozen, 710 open |
| Grammar cells | 2,944: 205 frozen, 2,739 open | 704: 88 frozen, 616 open |
| Grammar cells with the bit "first on its line" | 5,888: 266 frozen, 5,622 open | 1,408: 176 frozen, 1,232 open |
| Display entries | 672: 105 read before an error, 522 open, 45 of a text's end that stay | 200: 37, 140, 23 |
| Kept grammar cells of the recipe, with the bit | 378 | 188 |
| Weights of the twin, with open display entries and the bit | 929,241 | 63,862 |

Of the 2,739 open grammar cells, 2,079 lead into the state `error` today, 184 are the row of that state, and 476 lead elsewhere but need a state and a context that no text has before an error. **With the bit, a cell is not frozen exactly when the cell without the bit is**, as it is for JSON: 144 cells are frozen without the bit and open with it, e.g. (afterKey, equals, depth 0), since a key and its equals sign stand on one line.

## What needed more than a changed import

- **Today's stack actions.** The JSON tables hold `by token` in every grammar cell. Today's TOML tables name an action in every cell, e.g. `none` for the `[` of a header. So a frozen cell has to hold today's action, and an open cell starts with it. A trained cell's mix starts with 0.9 on that action, which does the same as 0.9 on `by token` wherever the two are the same action.
- **The search for the frozen cells.** The JSON search keeps the depth and the kind of the innermost container, and guesses the kind after a closing bracket. With the TOML tables that search reaches 30 configurations by a guess alone, so its example texts can be wrong. `searchFrozenCells` runs in two forms, one that keeps two kinds of the stack and can only miss cells, and the guessing one, which can only find too many. `frozenSearchOf` throws when they differ, for any list of added classes. The search also follows the positions after a text's end, and finds no cell there that the first of them does not read.
- **The samples.** `data.ts` reads the dataset through the type `Dataset` (`defaultSeed`, `sampleAt`, `labelsOf`, `groupOf`) and loads `../samples.ts` when a function first asks for it, because the dataset was built at the same time. `samplesOf(texts)` makes the arrays from any labeled texts, e.g. broken texts that somebody labeled by hand: it finds each text's first error itself. A text of more than 512 code points is refused.
- **A damaged text that today's parser accepts** has no first error. The score counts it as a sample with nothing to recover, and the twin, the search, the count and the rule skip it. The dataset has no such sample. The check set has many.
- **The intended stacks** are in the arrays of `data.ts`, made from the parser's trace on the original, where the JSON side makes them from the samples again and keeps a cache file.
- **The rule of the classes** drops a picked code point that would leave its class without a code point, which `addClasses` refuses. The TOML tables have small classes, e.g. `digit8Or9` with two code points.
- **The kept cells** are found with too deep TOML texts of `check-texts.ts`, 2,000 of each of two forms as on the JSON side: a value of 17 to 19 levels with nothing but closing brackets after the innermost container, or with members after the nested containers.

## The recipe

`runRecipe(samples, seed)` of `recipe.ts` is the candidate "generic" of `lab/recovery-parser/learn/arms/combined/combined.ts`. `recipeSettings` lists every setting with the place on the JSON side that sets it:

1. The base: today's tables, the classes that the rule picks from the train samples (at least 100 samples, a distance of at least 0.5), open display entries, the bit.
2. The training: 3 passes, batches of 32, learning rate 0.05, a share of 0.9 on the base's choice, with the kept grammar cells and without the events of a text's end.
3. Only in the second row: 4 passes of the search over the same cells, in the random order of the seed.
4. The count of the display entries.
5. Today's kinds in the display entries of the grammar state `error`.

It returns the tables of two rows: steps 1, 2, 4, 5, which is the primary row, and all five.

Two things carry over as numbers and mean something else here:

- **The share of 0.9 is a larger weight.** A tokenizer cell's next state has 111 choices where JSON has 26, so the base's choice starts 6.9 above the others where it starts 5.4 for JSON. A step of Adam moves a weight by about 0.05, so a cell needs more steps to snap to another choice. On a set of 2,000 texts, 68 steps, the training changes no cell.
- **The rule's 100 samples** is a count, and the standard set is again the indexes 0 to 59,999.

## Step 1 on the dataset as it is

With the dataset's key 2942d0e59ca7ebdf, which changes with every change of a `.ts` file of the folder above. Nothing was trained.

- The standard set has 47,273 samples that are not in the test split: 41,872 train and 5,401 validation, with 6,231,653 scored code points. Every train sample gives the twin a step: 269 code points and 138 steps on average.
- The rule picks 18 code points: `→`, `ß`, `ö`, and the capital letters A, B, G, I, J, L, M, O, P, Q, S, V, W, X, Y. The three first are 95% to 97% the content of a comment, where the rest of the class `other` is not. The capitals are mostly the content of a string, where the rest of `otherLetter` and `otherHexLetter`, i.e. the small letters, is mostly a key. K is the first that is not picked, at a distance of 0.49.
- The base then has 65 classes and a class table of 8,597 entries: 7,215 tokenizer cells, 3,806 of them open, 5,622 open grammar cells, of which 378 are kept, 522 open display entries, and 1,234,935 weights. Both forms of the search for frozen cells find the same cells for these classes.
- The parser as it is has 64.25% of all three and 12.50% of whole samples on the validation split.

## Speed

On an 18 core machine with other jobs running. One step of the twin at one code point, forward and backward, in one thread, with open display entries and the bit, at the start of a training: 113 microseconds, against 20.5 for the JSON twin. One batch of 32 samples with 4 worker threads, on the first train samples of each dataset: 204 ms against 31 ms, i.e. 157 samples per second against 1,038. Three passes over the 41,872 train samples then take about 13 minutes.

## The check set

`check-set.ts` makes samples without the dataset: a valid document with one code point removed, added or replaced, or a few removed. The checks use it where the JSON checks use the dataset. It is no training set of the experiment: half of its documents are seven short ones written by hand, and more than half of its damaged texts are still valid.

What the recipe does on 8,000 such texts, seed 1, from `check-recipe.ts`. The numbers say that the steps work together and nothing about the experiment:

| | all three, train | whole, train | all three, validation | whole, validation |
| --- | --- | --- | --- | --- |
| the parser as it is | 62.6 | 8.2 | 69.2 | 5.3 |
| the training, the count, today's kinds in the state `error` | 73.5 | 10.0 | 77.4 | 7.5 |
| the same with the search before the count | 98.6 | 74.8 | 93.2 | 58.5 |

The training is 413 steps of Adam there, about a tenth of what the standard set gives it.

## Checks

Run from the repo root. Each ends with "Every check passed." or with a count of failures.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-toml/learn/check-all.ts                 # the type check, the lint and the 8 checks, about a minute and a half
```

- `check-tables.ts` (40 s): the counts above. Every frozen cell and every display entry that is not open has a text that today's parser reads without an error up to it. No text reads an open cell before its first error: 24,526 texts, among them valid ones with 16 levels and with 512 code points, and every text of up to 5 code points, 30 million with today's classes. Each cell, each entry and each bit of a mask is changed alone: a change of a frozen one is refused. All of it also with 8 added classes, open display entries, the bit and added states.
- `check-parser.ts` (11 s): with no open cell changed the parser gives the trace of `../table-parser.ts` at all 513 positions of 30,526 texts. With 100 random settings of every open cell, every text has today's trace before its first error and today's verdict. The same with added structure.
- `check-data.ts` (3 s): the arrays hold the texts and their labels, a scored label before a first error is what today's parser gives, and every count of every row of a score is the one that the check makes a second time with `../table-parser.ts`. On the check set, and on the dataset's samples 0 to 3,999 that are not in the test split.
- `soft/check-twin.ts` (80 s): the twin with exact tables is the exact parser, on 2,500 samples with today's tables and with 20 random settings, 20 million positions, and with added structure.
- `soft/check-gradient.ts` (25 s): the backward pass against finite differences in 8 settings. The largest relative difference of a direction is 7.9e-9.
- `soft/check-train.ts` (20 s): threads, seeds, snapping, trainable masks, the errors of a wrong call, and a short training: three passes over 720 samples in batches of 8 lower the loss from 2.45 to 0.73, and the snapped tables have 88.8% of the scored code points right where the parser as it is has 63.4%.
- `search/check.ts` (2 s): the search's parser loop counts what `score.ts` counts, and one pass of the search over 8,012 cells raises the check set's train samples from 71,760 to 108,242 of 113,577 scored code points.
- `check-recipe.ts` (80 s): the three kept settings keep a too deep valid text as it is shown today, for random settings of every other cell. The count is the best kind per entry. The rule picks a code point that is made to stand out. The recipe runs in both rows and gives the same tables for the same seed.

## Running the recipe

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-toml/learn/data.ts                      # makes the cache of the standard set
bun lab/recovery-toml/learn/score.ts                     # the parser as it is on the validation split, every row
bun lab/recovery-toml/learn/recipe.ts --seed 1           # both rows, saved to <scratch>/recipe/, scored on the validation split and on too deep valid texts
bun lab/recovery-toml/learn/score.ts --tables $RECOVERY_SCRATCH/recipe/seed-1.primary.tables.json --cells
```

To score labeled texts that are not in the dataset, e.g. a held-back set:

```ts
import {samplesOf} from './data.ts'
import {loadTables} from './recovery-tables.ts'
import {scoreTables, sharesOf} from './score.ts'

// One entry per broken text: its code points' labels, or undefined for a code point that the damage added.
const samples = samplesOf([{index: 0, split: 'validation', source: 'written', kinds: ['missingQuote'], broken: 'name = tiny"\n', labels, firstDamage: 7}])
const score = scoreTables(loadTables(file).tables, samples)
console.log(sharesOf(score.rows[0]!).allThree, sharesOf(score.rows[0]!).whole)
```

`samplesOf` finds the first error with today's parser. A text with the split `test` needs `RECOVERY_FINAL=yes` to be scored, as on the JSON side.

## Not done

- **The real run.** The recipe has not trained on the dataset. Per seed it needs about 13 minutes of training, and the search after it was only timed on the check set, 3 s for 4,410 samples.
- **The dataset's key** is a hash of every `.ts` file of the folder above, the checks and the statistics among them, as on the JSON side. A change of any of them gives another key: the cache is made again, and saved tables are then tables of another dataset.
- **A table of scores as the JSON arms have it**: `recipe.ts` prints one line per row for one seed. Several seeds, their spread and a saved record are the caller's.
- **The dataset as an import.** `data.ts` loads `../samples.ts` by its path when it is first needed. With the dataset in place, an import at the top does the same and lets the type check compare the two.
