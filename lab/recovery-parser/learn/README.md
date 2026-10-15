# Learning a recovery parser: the shared core

The JSON highlighter is a parser written as tables. It does not recover: after the first error everything is shown as an error or loses its meaning, e.g. every key after a missing comma is shown as a plain string. This experiment changes the table cells that only broken input reaches, by hand or by training, and measures how much of a broken text is then labeled as its author meant it.

The files at the top of this folder are what every arm of the experiment shares. The folders hold what the arms are compared with and built from:

- `handwritten/`: a recovery written by hand, as 35 rules that set open cells.
- `search/`: the open cells filled without gradients, by votes of the train samples and by a search that tries one cell at a time.
- `soft/`: the trainable twin of the parser and its trainer. No arm is run yet.
- `structure/`: what an arm can add to the tables besides states, e.g. a character class for the apostrophe, or open entries of the display table. This README describes the tables without any of it.

**Every number in this folder is preliminary.** The dataset in `lab/recovery-parser/` is a snapshot that a reviewed version will replace. Every number has to be made again then, with the commands at the end.

## Words

- A **cell** is one entry of the tokenizer's table, (tokenizer state, class), or of the grammar's table, (grammar state, token, context). E.g. the grammar cell (commaOrClose, string, depth 1, object) is what the parser reads at the second `"` of `{"a": 1 "b": 2}`. A context is the depth class (0, 1, 2 to 15, 16) and whether the innermost open container is an object.
- A **frozen cell** is a cell that some text makes the parser read before that text's first error, e.g. (between, quote). JSON that the highlighter accepts only ever reads frozen cells. Frozen cells never change.
- An **open cell** is every other cell: the parser reads it only at or after a first error, e.g. (between, other), which the `x` of `[x]` reads. Open cells are what a hand-written recovery or a training run may change.
- A **choice** is what an open cell holds. A tokenizer cell holds a next tokenizer state and an event. A grammar cell holds a next grammar state and a stack action, one of: by token (an opening bracket pushes its kind, a closing bracket pops, any other token does nothing, which is what the parser does today), none, push an array, push an object, pop.
- **Snapping**: a trained cell holds a mix over choices, and snapping picks the one with the largest share. Only snapped tables run in the exact parser, and only scores of snapped tables in the exact parser count.

The code keeps the names of `table-parser.ts`, where the tokenizer is the "lexer", e.g. `lexerNext`.

## Ground rules

For every choice of the open cells:

1. Every text gets the same trace as today up to its first error. So JSON that the highlighter accepts, i.e. valid JSON of at most 512 code points and 16 levels, is parsed exactly as today.
2. Every text has the same `valid`, first error position and first error kind as today.
3. Only what is shown from the first error on can change.

Rule 1 holds because frozen cells keep today's values: `checkTables` refuses tables in which a frozen cell differs, and `saveTables`, `loadTables`, `runRecoveryParser` and `scoreTables` call it. Rule 2 holds by construction: the parser finds the first error with today's tables, not with the tables it runs.

The rules rest on which cells are open. `recovery-tables.ts` finds the frozen cells by a search over everything a text can make today's parser do before its first error: over the tokenizer state, the grammar state, the depth and the kind of the innermost open container. The tokenizer's table has 858 cells, 148 frozen and 710 open. The grammar's table has 704 cells, 88 frozen and 616 open. Of the 616, 448 lead into the state `error` from another state today, 88 are the row of the state `error`, and 80 lead elsewhere but need a state and a context that no text has before an error. The 88 cells of the context "depth 0, object" are among the open ones and the recovery parser never reads them, since at depth 0 no container is open.

How the rules are checked:

- `check-tables.ts`: for each of the 236 frozen cells, a text reads the cell before any error, so no cell is frozen without need. And no text reads an open cell before its first error: 81,051 texts, among them the originals and the broken texts of 30,000 samples, and valid texts with 16 levels and with 512 code points. The same holds for every text of up to 6 code points, which the check goes through class by class, 17,303,316 texts. A table file with a changed frozen cell is refused, and so is one with a number that a byte does not hold.
- `check-parser.ts`: with today's tables the parser gives the trace of `table-parser.ts` on 71,051 texts. And for 200 random settings of every open cell, 50 of them with added states, rules 1 and 2 hold on 5,906 texts each, with every valid text's whole trace identical.
- A review ran its own exact search over 4,063,196 parser states, with the kind of every open container, and found the same 148 and 88 frozen cells. It also ran 276 settings of the open cells and the saved tables of the arms on 80,381 texts of its own, with no difference from today's parser before a first error or in a verdict. Those scripts are not in the repo.

**What rule 1 does not cover: valid JSON that is too deep or too long.** A valid JSON text of 17 levels or more has a first error at its 17th opening bracket, and reads open cells from there on, so tables may show the rest of it otherwise than today. The dataset has no text deeper than 16 levels, so no score sees that. Today's parser keeps the depth of such a text right at every code point. `check-deep.ts` counts the code points of 300 such texts at which saved tables do not: none for the hand-written tables and the votes, a third to five sixths of the code points after the 17th bracket for the search's tables, see the table of scores. A valid text of more than 512 code points is safe: its first error is at position 512, after everything that is shown.

## The parser

`runRecoveryParser(codePoints, truncated, tables)` returns a trace with one entry per position: the class, the tokenizer state before and after, the event, the token, the context, the grammar state before and after, the two cells that were read, the stack action, the display kind, the depth after and the container after. And `valid`, the first error's position and its kind.

The open containers are a real stack, one kind per open level. Today's parser keeps the kinds in one integer, a running sum that an opening brace adds to and a closing brace subtracts from. The sum is only right while every closing bracket matches: after the `]` of `[{"b": 1], 2]` it still says "object". Before the first error the stack and the sum are the same. With today's tables, the stack gives another container than the sum in 3.2% of the broken texts of `check-parser.ts`, at 0.7% of their code points from the first error on, and another context at 1.3% of them.

The edges, chosen so that today's tables give today's depths everywhere, and today's contexts up to and at the first error:

- A pop at depth 0 or below lowers the depth as at any depth, so the depth can be negative, e.g. -1 after the `]` of `1]`.
- A push at depth 16 or above raises the depth as at any depth. The stack holds the kinds of the levels 1 to 16 only.
- The context of a depth below 0 is the one of depth 0, without a container. The context of a depth above 16 is the one of depth 16, with the kind at level 16, which above 16 levels is not the innermost container.
- Position 512 reads the context of an array or of no container, even inside an object, as in the highlighter's program.

What a port of trained tables into the highlighter's program would need:

- A stack action per grammar cell, read next to the next state. The depth then changes by the action, not by the event.
- Kinds that stay right after any pop: a pop has to clear the bit of the level it leaves, whichever bracket caused it, and a push has to set the bit by the action, not by the bracket. The program's test "is the innermost container an object" compares the sum with the bit of the current level, which is only right when no bit above that level is set.
- Today's tables next to the trained ones for the verdict. The program takes the first position whose grammar state is `error` as the first error. Trained tables can leave that state or never enter it, so `valid`, the first error's position and its kind have to come from today's tokenizer event and today's grammar cell at each position up to the first error.

## How a parser is scored

Over the labeled code points at or after the first damage of the broken samples: the share with all three labels right (the main number), with the display kind right (over the code points whose kind is scored), with the depth right, with the container right, and the share of samples in which every such code point is right. Samples with no labeled code point from the damage on are counted apart. Valid samples are left out. The rows: all, per split, damage against typing, reachable yes, line rule and no, needs a class or not, debatable or not, held out by a kind or by the template, per family and per kind.

`scoreTables` scores the validation split unless `options.splits` names others. Model selection uses the validation split. The test split is only for final numbers: the commands read it only with `--split test`.

Three things that these shares do not show are counted next to them, in every row:

- **The ceiling.** Some scored code points come before the first error, e.g. everything after a removed closing bracket up to the text's end. Only frozen cells are read there, so the ones that are wrong today stay wrong for every choice of the open cells. On the validation split they are 4,014 of the 681,596 scored code points, in 328 samples. So no tables pass 99.41% of all three, nor 93.2% of whole samples.
- **How the damage itself is shown.** A code point that the damage added has no label, and no label is ever the display kind `error`. So tables lose nothing in the shares by never showing an error. The score counts the added code points that are shown as an error, and the samples that show an error at or after the first damage. Today's parser shows 89.5% of the added code points as an error. The hand-written tables show none.
- **Code points shown as "past the end"**, the display kind of the cells after a text. A tokenizer cell can hold one of the three events of a text's end, and a code point that reads the cell is then shown so. The search no longer tries these events. A trained cell can still snap to one.

On the samples 0 to 19,999, `stats.ts` of the snapshot counts the same display kinds and depths as `scoreTables` in every row. Its container is 87.1% and its all three 40.1%, against 87.2% and 40.2%, because it runs today's parser with the running sum: the stack has 2,080 more containers right and 1,178 more code points with all three right.

## Scores on the validation split

Preliminary, until the reviewed dataset replaces the snapshot. The validation split of the standard set (seed 20261015, samples 0 to 59,999) has 5,203 broken samples, 368 of them with nothing to recover, and 681,596 labeled code points at or after the first damage. The percentages are of those code points, and of the samples for "whole samples". The last three columns are what the main number does not show. Every row comes from `compare.ts` and `check-deep.ts`.

| tables | cells that differ from today's | all three | display kind | depth | container | whole samples | added code points shown as an error | samples that show an error | wrong depths on valid JSON of 17 to 19 levels |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | 0 | 40.80 | 47.74 | 74.62 | 88.43 | 11.64 | 89.5 | 59.5 | 0.0 |
| hand-written, 35 rules | 915 | 95.49 | 98.25 | 96.93 | 99.26 | 73.15 | 0.0 | 0.0 | 0.0 |
| votes, the walk as specified | 175 | 65.32 | 77.49 | 75.54 | 88.80 | 59.13 | 7.1 | 13.4 | 0.0 |
| votes, `--follow` | 275 | 78.06 | 86.29 | 85.54 | 96.08 | 62.71 | 1.5 | 1.2 | 0.0 |
| search from today's tables | 904 | 93.69 | 95.67 | 97.56 | 99.53 | 67.22 | 0.3 | 5.5 | 75.1 |
| search from today's tables, `--order 1` | 865 | 94.47 | 96.70 | 97.46 | 99.61 | 67.92 | 2.7 | 22.0 | 72.1 |
| search from today's tables, `--order 2` | 951 | 94.62 | 96.70 | 97.56 | 99.57 | 66.56 | 5.3 | 33.6 | 53.5 |
| search from the votes | 744 | 83.19 | 88.78 | 89.91 | 97.39 | 62.77 | 0.3 | 11.7 | 84.0 |
| search from the hand-written tables | 977 | 96.54 | 98.65 | 97.60 | 99.37 | 68.31 | 0.3 | 4.7 | 33.6 |
| the trainer's test run: one pass over the train split, defaults, last tables | 967 | 94.54 | 96.95 | 97.29 | 99.42 | 66.54 | 0.9 | 3.5 | 0.0 |

What to take from it:

- **The number to beat is the search from the hand-written tables, 96.5%.** The hand-written tables are a recovery that a person can read, not the best that the cells hold: a plain search changes 421 of their cells and gains 1.0 point. From today's tables the same search ends 1.9 to 2.9 points lower, and from the votes 13 points lower, so where a search starts decides where it ends, and none of these is the limit of the cells. The ceiling is 99.41%.
- **The last row is no arm.** It is the trainer's default run, untuned, one seed, there to show that the trainer works. A second seed ends at 94.58%.
- **No tables that score well show the damage as an error**, and the search's tables break the depth of valid JSON that is too deep. Neither is in the main number. Whether a recovering highlighter should mark the damage, and whether texts that are too deep should be in the dataset, is not settled, see [Not settled](#not-settled).
- Code points shown as "past the end": 131 for the trainer's test run, 0 for every other row.

## Intended states

`intended.ts` gives, for every kept code point of a broken text, the state today's parser is in after the code point's counterpart in the original: the tokenizer state, the event, the grammar state, and with the labels the depth and the container. Training can use them as extra targets, and to put a run back on track.

Many of them cannot be reached. After a removed or an added part, frozen cells give something else than the intended state, and go on doing so up to the next open cell. E.g. in `{"a": 1 "b": 2}`, whose original has a comma after the `1`, the intended grammar state after the space is `key`, and the parser stays in `commaOrClose` there because the cell (commaOrClose, none) is frozen. A run that is put on `key` then reads the frozen cell (key, string) at the quote, and never the open cell (commaOrClose, string) that the parser reads there and that a recovery has to change.

So the samples' flags mark the kept code points whose intended state a parser of the broken text can be in (`codePointCanFollow`). `canFollowOf` in `intended.ts` walks the broken text with the state that every choice of the open cells gives, as long as frozen cells determine it, and its first comment says what is exact in that and what is assumed. Of the kept code points from a first damage on, 85.9% have the mark (samples 0 to 19,999). Use the intended states only there.

What the mark changes in training is in `soft/README.md`: with it, the extra targets no longer lower the score of the snapped tables, as they did before. Keeping a run on track still does, for another reason, and stays off by default.

## Reading samples

To read samples as aligned text, use `handwritten/show.ts`: it reads the scored snapshot and refuses the test split.

```sh
bun lab/recovery-parser/learn/handwritten/show.ts --kind missingComma --limit 5      # the train split
bun lab/recovery-parser/learn/handwritten/show.ts --split validation --index 15047 --tables <file.json>
```

Do not read the files of dumped samples that `lab/recovery-parser/dump.ts` wrote into a shared scratch folder while the dataset was under review. They hold test samples (704 of the 3,202 samples of the files per kind of damage, among them all 60 of each of the four held-out kinds), and they come from another version of the dataset than the snapshot here. The builders of this folder were told to read them, so the held-out kinds count as possibly seen by the hand-written rules.

## Files

- `recovery-tables.ts`: the type `RecoveryTables` (sizes, the tokenizer's next state and event per cell, the grammar's next state and stack action per cell, the fixed tables, the masks of open cells). `asIsTables()` returns today's tables. `checkTables`, `saveTables` and `loadTables` (JSON), `lexerCellName` and `grammarCellName`, `differencesOf` for the cells in which two tables differ, `addStates` for tables with more tokenizer states and grammar states, `addClasses` for tables with more classes, `openDisplayEntries` for tables whose display table may change, `randomizeOpenCells`.
- `recovery-parser.ts`: `runRecoveryParser`, and `runRecoveryParserInto` for loops, which allocates nothing and does not check the tables.
- `intended.ts`: `intendedOf(sample)`, the intended states and the mark of the ones that can be followed.
- `data.ts`: `loadSamples(seed, from, to)` holds the samples in typed arrays: code points, labels, flags, intended states, and per sample the split, the kinds, the families, reachable, needsClass, debatable, heldOut and the source. `standardRange` is seed 20261015, samples 0 to 59,999. `trainPart`, `validationPart` and `testPart` return the parts. The cache folder comes from `RECOVERY_SCRATCH`, and passing `null` as the cache folder makes the samples without a cache.
- `score.ts`: `scoreTables(tables, samples, options)`, `scoreWith` for a parser that is not made of these tables, `runOnSample` for the trace of one sample, `cellsReadBy` and `cellsReadAt` for the cells that the exact parser reads on some samples, and `withUnreadCellsOf`, which puts another table's choice back into the cells that are not read.
- `compare.ts`: several saved tables next to today's, one row each, as the table above.
- `check-tables.ts`, `check-parser.ts`, `check-data.ts`, `check-deep.ts`: the checks. `check-texts.ts` makes their texts.

## Commands

Run from the repo root. `RECOVERY_SCRATCH` is a folder outside the repo for the cache of the samples, about 170 MB for the standard set, and for the tables and logs of the arms. Without it the samples are made on every run, about 20 s for the standard set.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/data.ts                              # makes the cache of the standard set, about 20 s once
bun lab/recovery-parser/learn/score.ts                             # today's tables on the validation split, every row
bun lab/recovery-parser/learn/score.ts --tables <file.json> --split validation --cells
bun lab/recovery-parser/learn/score.ts --to 20000 --split train,validation,test
bun lab/recovery-parser/learn/compare.ts <name>=<file.json> ...    # one row per saved tables, as the table of scores
bun lab/recovery-parser/learn/check-tables.ts                      # about 12 s
bun lab/recovery-parser/learn/check-parser.ts                      # about 25 s
bun lab/recovery-parser/learn/check-data.ts 20000 --stats <a file written by lab/recovery-parser/stats.ts over 20000 samples>
bun lab/recovery-parser/learn/check-deep.ts <name>=<file.json> ... # the depth on valid JSON of 17 to 19 levels
bunx tsc -p lab/recovery-parser/learn                              # type-checks this folder and the folders in it
```

The table of scores, from an empty scratch folder, in about 16 minutes on 4 threads:

```sh
bun lab/recovery-parser/learn/handwritten/rules.ts                 # <scratch>/handwritten/tables.json
bun lab/recovery-parser/learn/search/votes.ts                      # <scratch>/search/votes.json
bun lab/recovery-parser/learn/search/votes.ts --follow             # <scratch>/search/votes-follow.json
bun lab/recovery-parser/learn/search/search.ts                     # <scratch>/search/search-from-today.json, about 3 minutes
bun lab/recovery-parser/learn/search/search.ts --order 1           # about 3.5 minutes
bun lab/recovery-parser/learn/search/search.ts --order 2           # about 6 minutes
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/search/votes.json
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/handwritten/tables.json   # <scratch>/search/search-from-tables.json
bun lab/recovery-parser/learn/soft/train.ts --name pass            # <scratch>/soft/runs/pass/last.json, about 25 s
bun lab/recovery-parser/learn/compare.ts hand-written=$RECOVERY_SCRATCH/handwritten/tables.json votes=$RECOVERY_SCRATCH/search/votes.json search=$RECOVERY_SCRATCH/search/search-from-today.json
```

The checks of the arms: `handwritten/check.ts`, `search/check.ts`, and `soft/check-twin.ts`, `soft/check-gradient.ts`, `soft/check-circuit.ts` and `soft/check-train.ts`. Each folder's README says what they check.

The cache file is made again by itself when a source file of the dataset, `data.ts` or `intended.ts` changes.

In code:

```ts
import {loadStandardSamples} from './data.ts'
import {actionNone, asIsTables, grammarCellOf, grammarStateNames, saveTables, tokenNames} from './recovery-tables.ts'
import {scoreTables, sharesOf} from './score.ts'

const samples = loadStandardSamples()
const tables = asIsTables()
// A comma where a value should come, in an array at depth 1: stay in the state `value` instead of `error`.
const cell = grammarCellOf(tables, grammarStateNames.indexOf('value'), tokenNames.indexOf('comma'), 2)
tables.grammarNext[cell] = grammarStateNames.indexOf('value')
tables.grammarAction[cell] = actionNone
const score = scoreTables(tables, samples)
console.log(sharesOf(score.rows[0]!).allThree)
saveTables(`${process.env['RECOVERY_SCRATCH']}/one-cell.json`, tables, 'one changed cell')
```

## Not settled

- **Should a recovering highlighter still mark the damage?** The labels say what kept code points are. Nothing says how an added code point should be shown, e.g. a stray closing bracket or the second quote of a doubled quote, so the best tables show no error anywhere. The numbers are in every score now. A label `error` for some added code points would put them into the main number.
- **Valid JSON that is too deep.** Either such texts go into the dataset, with today's depths as labels, or an arm's tables have to pass `check-deep.ts`. Today only the hand-written rules were changed to pass it.
- **Should a tokenizer cell be allowed an event of a text's end at all?** The search leaves them out. The core still allows them, so a trained cell can snap to one, and `checkTables` accepts it.
- **Added character classes.** 11% of the broken samples need a class that the highlighter lacks, e.g. the apostrophe. `addClasses` adds classes, see `structure/README.md`, and no arm has used it. The hand-written rules read such strings as words, which is why "needs a class" is at 94.8% there.
- **Keeping a run on track.** With the mark it costs less than before and still costs. States taken from tables that already recover, e.g. the trace of the hand-written tables on the broken text, were proposed in a review and are not built.
- **The test split, the held-out kinds and the held-out template** were never scored by anything here.
- **`bun run check` of the repo does not type-check this folder.** `lab/recovery-parser/tsconfig.json` includes only its own files, so `bunx tsc -p lab/recovery-parser/learn` has to be run by hand.
