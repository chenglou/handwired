# The arms: one harness for every experiment

An arm is one experiment: a way to fill the open cells of the highlighter's tables, e.g. "train the grammar cells only" or "add a class for the apostrophe, then train". Each arm is a thin script and a README in a folder of its own, `arms/<name>/`. This folder holds what the arms share, so that every arm is scored and reported the same way. This README is written for someone who builds an arm and has read nothing else.

## What you need to know first

The JSON highlighter is a parser written as two tables. The experiment changes the cells that only broken input reaches, and measures how much of a broken text is then labeled as its author meant it. The words, from `../README.md`:

- A **cell** is one entry of the tokenizer's table, (tokenizer state, class), or of the grammar's table, (grammar state, token, context). A **frozen cell** is one that some text reads before its first error, e.g. (between, quote). Every other cell is **open**, e.g. (between, other), which the `x` of `[x]` reads. Only open cells may change, so every text is read as today up to its first error.
- A **choice** is what an open cell holds: a next state and an event for a tokenizer cell, a next state and a stack action for a grammar cell.
- **Tables** are a `RecoveryTables` value of `../recovery-tables.ts`. `asIsTables()` gives today's. `checkTables` throws when a frozen cell is changed.
- **Snapping** turns a trained model into tables: every cell takes the choice with the largest share. Only snapped tables run in the exact parser, `../recovery-parser.ts`, and only their score counts.
- The **base** of a run is the tables that it started from, e.g. `asIsTables()`, or today's tables with an added class.

The samples are the dataset of `lab/recovery-parser/`: broken JSON, the text that was meant, and a label per code point. Its README is the reference. What an arm needs of it:

- A score counts the **scored code points**: the ones from the first error on whose label has a scored value. "All three" is the share of them at which the display kind, the depth and the container are right, each where it is scored.
- Every broken sample is in one of **six groups**, by what it takes to label it: "within reach of the tables" (72.7% of the broken validation samples), "needs a display fix", "needs a line rule", "needs a character class", "needs a nesting fix", "out of reach". Report the group "within reach of the tables" first: one number over all samples says little.
- The splits are train, validation and test. Train on the train split, choose on the validation split, and leave the test split alone, see [The test split](#the-test-split).

## Setup

Run everything from the repo root.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/data.ts                    # the cache of the samples, about 12 s once
bun lab/recovery-parser/learn/arms/baselines.ts          # the rows that every arm is read against, under 1 s
bun lab/recovery-parser/learn/arms/plain-pass/run.ts     # the first arm, 5 seeds, about 2.5 minutes
bun lab/recovery-parser/learn/check-all.ts               # the type check, the lint and every check, about a minute
```

## The shortest arm

`plain-pass/run.ts` is one pass of the trainer over the train split, with 5 seeds. All of it:

```ts
import {asIsTables} from '../../recovery-tables.ts'
import {train} from '../../soft/train.ts'
import {packForTwin, placesForTwin} from '../../soft/twin-data.ts'
import {createModel} from '../../soft/twin.ts'
import {baselines, describeComparison, describeSettings, runArm, samplesOfTheStandardSet} from '../harness.ts'

const samples = samplesOfTheStandardSet()
const base = asIsTables()
// The train samples that give the twin a step, packed once for the base tables.
const data = packForTwin(samples, placesForTwin(samples, 'train'), undefined, base)

const results = await runArm({
  name: 'plain-pass',
  settings: [{
    name: 'one pass of the trainer from today\'s tables, defaults',
    build: async seed => {
      const model = createModel(base)
      const result = await train(model, data, {seed, epochs: 1, logEverySamples: 1e9, log: () => {}})
      return {tables: result.last, base}
    },
  }],
})
console.log(describeSettings([...baselines(), ...results]))
console.log(describeComparison(results[0]!, baselines().at(-1)!))
```

An arm with two settings gives `runArm` two entries in `settings`, e.g. one with `createModel(base)` and one with `createModel(base, {trainable: {lexer: 'none', grammar: 'open', display: 'none'}})`, and compares them with `describeComparison(results[0]!, results[1]!)`.

## The calls

All in `harness.ts`.

**`runArm({name, settings, seeds})`** runs each setting's `build(seed)` for every seed, one after the other, and returns one result per setting.

- `build` returns `{tables, base}`: snapped tables, and the tables that the build started from. It may be async.
- `seeds` are 1 to 5 unless you pass others. With fewer than 5 the summary says that the run is a try-out.
- Per setting and seed it saves `<RECOVERY_SCRATCH>/arms/<name>/<setting>/seed-<seed>.tables.json` and `seed-<seed>.record.json`, and it prints and saves `summary.md`: one markdown row per setting with the mean, the lowest and the highest over the seeds, e.g. `96.62 (96.23 to 96.92)`.
- The seed has to reach everything that is random in the build: the order of the samples (`train`'s `seed`), a random choice of trainable cells, a random start.

**`recordOf(tables, base)`** returns the standard record of some tables. `runArm` calls it for you. It always scores the exact parser on the validation split of the standard set, and it throws for tables with a changed frozen cell. The record holds:

- `rows`: every row of the score as counts (`ScoreRow` in `../score.ts`): `all`, the six groups as `group: <name>`, the kinds of damage as `kind: <name>`, and the rows of the sources, the families and the debatable samples. `sharesOf(rowNamed(record, 'group: within reach of the tables')).allThree` is a share from 0 to 1. A row also has the display kind, the depth and the container alone, the whole samples, and the bound of the plain table parser.
- `addedShownAsError`, `samplesShowingError`, `shownAsPastEnd`: how the damage itself is shown. A code point that the damage added has no label, so tables lose nothing in the main number by showing no error at all.
- `wrongDepthsOnDeepValidJson`: the share of wrong depths on valid JSON of 17 to 19 levels, on texts with nothing after their nested containers and on texts with members after them. Today's parser has 0 in both, and no score sees such texts.
- `cellsChangedAgainstBase` and `cellsThatDifferFromToday`, per table, and `changedCellsReadByValidation`. See [What can still go wrong](#what-can-still-go-wrong) for why these are two counts.
- `structure`: the numbers of states, the added classes, the bit "first on its line", the open entries of the display table.
- `groundRules`: whether 2,800 fixed texts have today's trace up to their first error and today's verdict.
- `plainParserProblems`: what keeps the tables from being tables of the dataset's plain table parser, as sentences, see the next section.
- `datasetKey`: a key of the dataset's source files. Two records compare only when their keys are the same.

**`describeSettings(results)`** gives the three markdown tables of some results: the scores, all three per group, and what the main number does not show.

**`describeComparison(first, second)`** gives one sentence with both means, both ranges and whether the ranges overlap. It throws for a setting with fewer than 3 seeds. Do not print a difference between two settings in any other way: a difference between two means says nothing without the spread.

**`baselines()`** gives the results of the five baselines, to print next to your rows.

**`samplesOfTheStandardSet()`** and **`validationOfTheStandardSet()`** give the samples of the standard set (seed 20261015, indexes 0 to 59,999, without the test split) and their validation part, loaded once.

## The bound of the plain table parser is not this parser's bound

The dataset proves, per sample, what its plain table parser cannot label: `needsNestingFix`, `needsDisplayFix`, and the bound `mostRightFor`. That parser is the loop of `../../table-parser.ts`, whose depth moves only at a bracket that the tokenizer reads, and which keeps the kinds of the open containers in a running sum. On the validation split its bound is 97.94% of all three and 92.34% of whole samples.

The parser of this experiment has a stack action in every grammar cell, e.g. a comma can pop, and a real stack. So its reach is larger, and its score can be above the bound: in the group "needs a nesting fix" the hand-written tables have 76.1% where the bound is 43.4%. Every place that prints the bound names it as the bound of the plain table parser. When you quote it, do the same.

`plainParserProblems` in a record says whether your tables are tables of the plain loop: an empty list for today's tables and for the dataset's hand rules, and a sentence for a stack action that does something else than its token, for an added class, for the bit, and for a changed display table. Even with an empty list the two parsers are not the same: after a closing bracket that does not match, the real stack and the running sum disagree about the innermost container, the grammar reads another context, and the display kind can differ from there on. For the hand rule `words` that is 0.12% of the code points of 4,530 broken texts (`check.ts`).

## What a build function may read

- **The train split**, for training: `placesForTwin(samples, 'train')`, `trainPart(samples)`.
- **The validation split**, to choose between tables, e.g. the best of several log points. Then say so in the README: the validation score of tables that were chosen on the validation split is optimistic. `train` picks its `best` tables on one half of the validation split and reports the other half for this reason. The record of `runArm` is always the whole validation split.
- **Never the test split.** It is not in the samples, see below.
- The hand-written tables as a base, with care: their rules were written with the old snapshot's samples in view, so for them, and for everything that starts from them, no split of this dataset counts as unseen.

## The rows that every arm is read against

From `baselines.ts` and `plain-pass/run.ts`, on the validation split: 4,878 broken samples, 375 of them with nothing to recover, 675,695 scored code points. Percentages.

| setting | seeds | all three | display kind | depth | container | whole samples | cells changed against the base |
| --- | --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | none | 42.68 | 49.14 | 75.06 | 88.65 | 11.10 | 0 |
| the dataset's hand rule `stay`, as tables of the experiment | none | 73.80 | 78.15 | 93.91 | 98.15 | 28.09 | 1,058 |
| the dataset's hand rule `resync`, as tables of the experiment | none | 84.34 | 88.17 | 94.97 | 98.33 | 70.95 | 1,078 |
| the dataset's hand rule `words`, as tables of the experiment | none | 93.09 | 97.00 | 95.36 | 98.60 | 76.93 | 1,078 |
| hand-written, the 35 rules of `../handwritten/rules.ts` | none | 96.51 | 98.69 | 97.65 | 99.56 | 80.04 | 915 |
| one pass of the trainer from today's tables, defaults | 5 | 96.62 (96.23 to 96.92) | 98.26 (98.02 to 98.46) | 98.21 (97.85 to 98.35) | 99.79 (99.78 to 99.80) | 72.23 (71.29 to 73.22) | 980 (976 to 990) |

All three per group, with the group's validation samples:

| setting | within reach of the tables, 3,547 | needs a display fix, 37 | needs a line rule, 487 | needs a character class, 326 | needs a nesting fix, 74 | out of reach, 407 |
| --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | 47.4 | 18.3 | 63.8 | 10.1 | 26.5 | 25.6 |
| `stay` | 79.0 | 57.9 | 90.8 | 49.5 | 36.1 | 50.1 |
| `resync` | 92.8 | 70.3 | 96.7 | 49.9 | 42.3 | 53.3 |
| `words` | 98.3 | 95.0 | 97.8 | 85.7 | 42.7 | 62.4 |
| hand-written, 35 rules | 99.5 | 98.2 | 99.0 | 92.2 | 76.1 | 78.0 |
| one pass of the trainer, 5 seeds | 99.0 (98.7 to 99.2) | 96.6 (95.6 to 97.2) | 99.8 (99.7 to 99.9) | 89.8 (88.0 to 91.1) | 91.9 (91.6 to 92.1) | 82.9 (81.1 to 84.0) |

What the main number does not show:

| setting | added code points shown as an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | tables of the plain table parser |
| --- | --- | --- | --- | --- | --- |
| the parser as it is | 89.5 | 0 | 0.0 | 0.0 | yes |
| `stay` | 62.6 | 0 | 0.0 | 0.0 | yes |
| `resync` | 60.1 | 0 | 0.0 | 0.0 | yes |
| `words` | 3.7 | 0 | 0.0 | 0.0 | yes |
| hand-written, 35 rules | 0.0 | 0 | 0.0 | 0.0 | no: 21 grammar cells hold a stack action that does something else than their token does |
| one pass of the trainer, 5 seeds | 0.9 (0.7 to 1.1) | 7 (0 to 20) | 3.0 (0.0 to 8.1) | 4.8 (0.0 to 9.4) | no: 24 such grammar cells in the first seed |

What to read from them:

- **Two seeds of one setting are up to 0.7 points apart.** The plain pass ranges from 96.23% to 96.92%. A setting that is half a point above another in one seed each has shown nothing.
- **The number to beat is not in this table.** A plain search that starts from the hand-written tables ends at 97.71%, see `../search/README.md`. An arm without added structure that ends below it has found nothing that a search does not find.
- **The dataset's `words` is 93.09% here, and the dataset's README says 92.0%.** That number is over all splits and from the plain table parser. Here it is the validation split and the parser with a real stack.
- **The plain pass is untuned.** It is the spread that matters in its row, not its mean.

## The test split

The test split is for final numbers only, after every choice is made. It holds four kinds of damage (`conflictMarkers`, `nonFiniteNumber`, `logPrefix`, `concatenated`) and one template (`order`) that are in no other split.

- `loadSamples` leaves every sample of the test split out when it makes the samples, so a script that reads the arrays cannot score, print or train on one. A sample's place in the arrays is therefore not its index in the dataset: `samples.index[place]` is.
- `allowedSampleAt(seed, index)` of `../data.ts` gives one sample of the dataset, and `undefined` for a sample of the test split. No file of `learn/` but `data.ts` may call the dataset's `sampleAt`: `../check-guard.ts` fails when one does.
- `scoreTables` with the split `test`, `loadSamples` with `withTest`, `placesOfSplit(samples, 'test')` and `--split test` on any command throw unless the environment variable `RECOVERY_FINAL` is `yes`.
- `final.ts` is the one script that is meant to run with it: `RECOVERY_FINAL=yes bun lab/recovery-parser/learn/arms/final.ts <name>=<tables.json> ...`. It prints, per tables and for the baselines, a row for each of the four ways a test sample can be held out: nothing held out, a held-out kind on a template that training has, kinds that training has on the held-out template, and both. About a half of the test split is held out, so one number for the whole split is not to be reported alone. **It was never run.**
- Do not read the files that `lab/recovery-parser/dump.ts` writes: they hold test samples.

## What can still go wrong

- **`train(model, data, options)` trains on every sample of `data`.** `options.places` are places in `data`, from 0 to `data.sampleCount - 1`, not places in the samples that `data` was packed from. A place outside `data` throws. A place inside `data` that you did not mean does not.
- **`createModel(base, {trainable})` needs all three of `lexer`, `grammar` and `display`**, each as a mask, `'open'` or `'none'`. Without `trainable`, every open cell and every open entry of the display table is trainable.
- **Pack the samples for the tables that you train.** `packForTwin(samples, places, undefined, base)` gives every code point the class that `base` gives it. A run on samples that were packed for other classes or without the bit throws. Tables with the same classes and more states are fine.
- **Two counts of cells.** "Cells changed against the base" is what your run changed. "Cells that differ from today's parser" also holds every cell of an added state, and the changed cells that an added class or the bit copied. E.g. two added tokenizer states and one grammar state are 154 cells that differ from today's parser before a run changes anything. Report the first, and name both.
- **The last tables of a run are one draw.** The score of snapped tables moves by up to a point between two log points of one run. Take the last tables, or tables chosen on one half of the validation split and scored on the other, and never the best of many log points on the whole split.
- **A low loss is not a good parser.** The twin is not the parser once its cells hold mixes. Only the record counts.
- **Check the columns that the main number does not show.** Tables can gain a point and break the depth of valid JSON that is too deep, or show characters of the text as "past the end".
- **Say what the arm is** in its README: which cells it may change, whether its tables have more states, classes or the bit, whether its display table is open, and what `plainParserProblems` says.

## Files

- `harness.ts`: `recordOf`, `runArm`, `describeSettings`, `describeComparison`, `baselines`, `baselineTables`, `groundRulesOn`, `armFolderOf`.
- `baselines.ts`: prints and saves the baselines' rows.
- `final.ts`: the test split, only with `RECOVERY_FINAL=yes`.
- `check.ts`: the dataset's cells of valid JSON against the experiment's frozen cells, the dataset's hand rules as tables of the experiment against the dataset's plain table parser, the record of today's tables, the ground rules for random settings, and `runArm` with a toy build function.
- `plain-pass/`: the first arm.
