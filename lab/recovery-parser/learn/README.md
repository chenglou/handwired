# Learning a recovery parser: the shared core

The JSON highlighter is a parser written as tables. It does not recover: after the first error everything is shown as an error or loses its meaning, e.g. every key after a missing comma is shown as a plain string. This experiment changes the table cells that only broken input reaches, by hand or by training, and measures how much of a broken text is then labeled as its author meant it. The files at the top of this folder are what every arm of the experiment shares. They do not run an arm.

The dataset in `lab/recovery-parser/` is a snapshot that a reviewed version will replace, so every number below is preliminary.

## Words

- A **cell** is one entry of the tokenizer's table, (tokenizer state, class), or of the grammar's table, (grammar state, token, context). E.g. the grammar cell (commaOrClose, string, depth 1, object) is what the parser reads at the `"` of `{"a": 1 "b": 2}`.
- A **frozen cell** is a cell that some text makes the parser read before that text's first error, e.g. (between, quote). Valid JSON only ever reads frozen cells. Frozen cells never change.
- An **open cell** is every other cell: the parser reads it only at or after a first error, e.g. (between, other), which the `x` of `[x]` reads. Open cells are what a hand-written recovery or a training run may change.
- A **choice** is what an open cell holds. A tokenizer cell holds a next tokenizer state and an event. A grammar cell holds a next grammar state and a stack action, one of: by token (an opening bracket pushes its kind, a closing bracket pops, any other token does nothing, which is what the parser does today), none, push an array, push an object, pop.
- **Snapping**: a trained cell holds a mix over choices, and snapping picks the one with the largest share. Only snapped tables run in the exact parser, and only scores of snapped tables in the exact parser count.

The code keeps the names of `table-parser.ts`, where the tokenizer is the "lexer", e.g. `lexerNext`.

## Ground rules

For every choice of the open cells:

1. Every text gets the same trace as today up to its first error, so valid JSON is parsed exactly as today.
2. Every text has the same `valid`, first error position and first error kind as today.
3. Only what is shown from the first error on can change.

Rule 1 holds because frozen cells keep today's values: `checkTables` refuses tables in which a frozen cell differs, and `saveTables`, `loadTables`, `runRecoveryParser` and `scoreTables` call it. Rule 2 holds by construction: the parser finds the first error with today's tables, not with the tables it runs.

The rules rest on which cells are open. `recovery-tables.ts` finds the frozen cells by a search over everything a text can make today's parser do before its first error: over the tokenizer state, the grammar state, the depth and the kind of the innermost open container. The checks:

- `check-tables.ts`: for each of the 236 frozen cells, a text reads the cell before any error, so no cell is frozen without need. And no text reads an open cell before its first error: 81,051 texts, among them the originals and the broken texts of 30,000 samples, and valid texts with 16 levels and with 512 code points. The same holds for every text of up to 6 code points, which the check goes through class by class.
- `check-parser.ts`: with today's tables the parser gives the trace of `table-parser.ts` on 71,051 texts. And for 200 random settings of every open cell, 50 of them with added states, rules 1 and 2 hold on 5,906 texts each, with every valid text's whole trace identical.

Counts: the tokenizer's table has 858 cells, 148 frozen and 710 open. The grammar's table has 704 cells, 88 frozen and 616 open. Of the 616, 448 lead into the state `error` from another state today, 88 are the row of the state `error`, and 80 lead elsewhere but need a state and a context that no text has before an error. The 88 cells of the context "depth 0, object" are among the open ones and the recovery parser never reads them, since at depth 0 no container is open.

## The parser

`runRecoveryParser(codePoints, truncated, tables)` returns a trace with one entry per position: the class, the tokenizer state before and after, the event, the token, the context, the grammar state before and after, the two cells that were read, the stack action, the display kind, the depth after and the container after. And `valid`, the first error's position and its kind.

The open containers are a real stack, one kind per open level. Today's parser keeps the kinds in one integer, a running sum that an opening brace adds to and a closing brace subtracts from. The sum is only right while every closing bracket matches: after the `]` of `[{"b": 1], 2]` it still says "object". Before the first error the stack and the sum are the same. With today's tables, the stack gives another container than the sum in 3.2% of the broken texts of `check-parser.ts`, at 0.7% of their code points from the first error on.

The edges, chosen so that today's tables give today's depths:

- A pop at depth 0 or below lowers the depth as at any depth, so the depth can be negative, e.g. -1 after the `]` of `1]`.
- A push at depth 16 or above raises the depth as at any depth. The stack holds the kinds of the levels 1 to 16 only.
- The context of a depth below 0 is the one of depth 0, without a container. The context of a depth above 16 is the one of depth 16, with the kind at level 16.
- Position 512 reads the context of an array or of no container, even inside an object, as in the highlighter's program.

What a port of trained tables into the highlighter's program would need:

- A stack action per grammar cell, read next to the next state. The depth then changes by the action, not by the event.
- Kinds that stay right after any pop: a pop has to clear the bit of the level it leaves, whichever bracket caused it, and a push has to set the bit by the action, not by the bracket. The program's test "is the innermost container an object" compares the sum with the bit of the current level, which is only right when no bit above that level is set.
- Today's tables next to the trained ones for the verdict. The program takes the first position whose grammar state is `error` as the first error. Trained tables can leave that state or never enter it, so `valid`, the first error's position and its kind have to come from today's tokenizer event and today's grammar cell at each position up to the first error.

## Files

- `recovery-tables.ts`: the type `RecoveryTables` (sizes, the tokenizer's next state and event per cell, the grammar's next state and stack action per cell, the fixed tables, the masks of open cells). `asIsTables()` returns today's tables. `checkTables`, `saveTables` and `loadTables` (JSON), `lexerCellName` and `grammarCellName`, `differencesOf` for the cells in which two tables differ, `addStates` for tables with more tokenizer states and grammar states, `randomizeOpenCells`.
- `recovery-parser.ts`: `runRecoveryParser`, and `runRecoveryParserInto` for loops, which allocates nothing and does not check the tables.
- `intended.ts`: `intendedOf(sample)`, the state today's parser is in after the counterpart of every kept code point in the original: the tokenizer state after, the event, the grammar state after, the depth after and the container after. Its first comment says where these cannot be right, e.g. at a replaced code point or after a removed part.
- `data.ts`: `loadSamples(seed, from, to)` holds the samples in typed arrays: code points, labels, flags, intended states, and per sample the split, the kinds, the families, reachable, needsClass, debatable, heldOut and the source. `standardRange` is seed 20261015, samples 0 to 59,999. `trainPart`, `validationPart` and `testPart` return the parts.
- `score.ts`: `scoreTables(tables, samples, options)`, `scoreWith` for a parser that is not made of these tables, and `runOnSample` for the trace of one sample.
- `check-tables.ts`, `check-parser.ts`, `check-data.ts`: the checks. `check-texts.ts` makes their texts.

## How a parser is scored

Over the labeled code points at or after the first damage of the broken samples: the share with all three labels right (the main number), with the display kind right (over the code points whose kind is scored), with the depth right, with the container right, and the share of samples in which every such code point is right. Samples with no labeled code point from the damage on are counted apart. Valid samples are left out. The rows: all, per split, damage against typing, reachable yes, line rule and no, needs a class or not, debatable or not, held out by a kind or by the template, per family and per kind.

`scoreTables` scores the validation split unless `options.splits` names others. Model selection uses the validation split. The test split is only for final numbers: the command reads it only with `--split test`.

Today's tables (preliminary):

| samples | all three | display kind | depth | container | whole samples |
| --- | --- | --- | --- | --- | --- |
| validation part of the standard set, 5,203 broken | 40.8% | 47.7% | 74.6% | 88.4% | 11.6% |
| samples 0 to 19,999, every split, 18,979 broken | 40.2% | 47.5% | 73.2% | 87.2% | 10.6% |

On the samples 0 to 19,999, `stats.ts` of the snapshot counts the same display kinds and depths in every row. Its container is 87.1% and its all three 40.1%, because it runs today's parser with the running sum: the stack has 2,080 more containers right and 1,178 more code points with all three right, most of them after a closing bracket of the wrong kind (wrongCloser: container 72.9% with the sum and 97.0% with the stack).

## Commands

Run from the repo root. `RECOVERY_SCRATCH` is a folder outside the repo for the cache of the samples, about 170 MB for the standard set. Without it the samples are made on every run, about 20 s for the standard set.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/data.ts                              # makes the cache of the standard set, about 20 s once
bun lab/recovery-parser/learn/score.ts                             # today's tables on the validation split
bun lab/recovery-parser/learn/score.ts --tables <file.json> --split validation --cells
bun lab/recovery-parser/learn/score.ts --to 20000 --split train,validation,test
bun lab/recovery-parser/learn/check-tables.ts                      # about 11 s
bun lab/recovery-parser/learn/check-parser.ts                      # about 25 s
bun lab/recovery-parser/learn/check-data.ts 20000 --stats <a file written by lab/recovery-parser/stats.ts over 20000 samples>
bunx tsc -p lab/recovery-parser/learn                              # type-checks this folder and the folders in it
```

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
