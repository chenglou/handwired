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
- Every broken sample is in one of **six groups**, by what it takes to label it: "within reach of the tables" (73.4% of the broken validation samples), "needs a display fix", "needs a line rule", "needs a character class", "needs a nesting fix", "out of reach". Report the group "within reach of the tables" first: one number over all samples says little.
- The splits are train, validation and test. Train on the train split, choose on the validation split, and leave the test split alone, see [The test split](#the-test-split).
- Every record, every saved file of tables and every cache file holds the **dataset's key**, a hash of the dataset's source files, `a71c027d33a5cd7b` for the dataset as it is. Results of two keys are results on two datasets, see [Tables of another dataset](#tables-of-another-dataset).

## Setup

Run everything from the repo root.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/data.ts                    # the cache of the samples, about 12 s once
bun lab/recovery-parser/learn/arms/baselines.ts          # the rows that every arm is read against, under 1 s
bun lab/recovery-parser/learn/handwritten/rules.ts       # the hand-written tables, which the next command starts from
bun lab/recovery-parser/learn/search/search.ts --from $RECOVERY_SCRATCH/handwritten/tables.json --out $RECOVERY_SCRATCH/search/search-from-handwritten.json   # the number to beat, about 2.5 minutes
bun lab/recovery-parser/learn/arms/plain-pass/run.ts     # the first arm, 5 seeds, about 2 minutes
bun lab/recovery-parser/learn/check-all.ts               # the type check, the lint and the checks, a bit over two minutes. One of them reads the tables of the plain pass above
```

In a scratch folder with these runs alone, one command of `check-all.ts` fails: `combined/check.ts` compares with tables that a run of `extra-facts/` saves, see "Commands" in `../README.md`. Every other command passes.

## The shortest arm

`plain-pass/run.ts` is one pass of the trainer over the train split, with 5 seeds. All of it, without its first comment:

```ts
import {optionOf, refuseUnknownOptions} from '../../data.ts'
import {asIsTables} from '../../recovery-tables.ts'
import {train} from '../../soft/train.ts'
import {createModel} from '../../soft/twin.ts'
import {baselines, describeComparison, describeSettings, numberToBeat, runArm, trainDataFor} from '../harness.ts'

refuseUnknownOptions('arms/plain-pass/run.ts', ['--seeds'])
const seeds = (optionOf('--seeds') ?? '1,2,3,4,5').split(',').map(Number)
// The number to beat is read before anything trains, so that a missing file of its tables stops the arm here.
const toBeat = numberToBeat()
const base = asIsTables()
// The train samples that give the twin a step, packed once: every seed trains on the same samples in another order.
const data = trainDataFor(base)

const results = await runArm({
  name: 'plain-pass', seeds,
  settings: [{
    name: 'one pass of the trainer from today\'s tables, defaults',
    build: async seed => {
      // `train` changes the model that it is given, so every seed gets a model of its own.
      const model = createModel(base)
      // Without `validation` the trainer scores nothing while it trains: the harness scores the last tables.
      const result = await train(model, data, {seed, epochs: 1, logEverySamples: 1e9, log: () => {}})
      return {tables: result.last, base}
    },
  }],
})

const rows = baselines()
console.log('')
console.log('Next to the baselines and the number to beat:')
console.log('')
console.log(describeSettings([...rows, toBeat, ...results]))
if (seeds.length >= 3) {
  // Against the hand-written tables and against the number to beat, on all samples and in the group that is within
  // reach of the tables.
  for (const other of [rows.at(-1)!, toBeat]) {
    console.log('')
    for (const rowName of ['all', 'group: within reach of the tables']) console.log(describeComparison(results[0]!, other, rowName))
  }
}
```

What to keep of it in every arm:

- **The script calls `refuseUnknownOptions` with the options that it has.** Without the call, `run.ts --seed 3` would run the five default seeds as if nothing had been asked, where it now stops with "arms/plain-pass/run.ts has no option --seed. Its options: --seeds."
- **The model is made inside `build`.** `train` changes the model in place, so a model that is made once, above `runArm`, would go on training from the weights that the seed before left: the second seed would be a second pass, not a second run.
- **The seed goes into everything that is random**, here into `train`. A build that draws something itself draws from `createRandom(seed, stream)` of `../../random.ts`, never from `Math.random()`, which gives other tables on every run of the same seed.
- **Two rows are compared**: all samples, and the group "within reach of the tables".

An arm with two settings gives `runArm` two entries in `settings`, e.g. one with `createModel(base)` and one with `createModel(base, {trainable: {lexer: 'none', grammar: 'open', display: 'none'}})`, and compares them with `describeComparison(results[0]!, results[1]!)`.

## The calls

All in `harness.ts`, unless a file is named.

**`runArm({name, settings, seeds})`** runs each setting's `build(seed)` for every seed, one after the other, and returns one result per setting.

- `build` returns `{tables, base}`: snapped tables, and the tables that the build started from. It may be async. `base` is another object than `tables`, with the same states, classes, contexts and open entries: `recordOf` throws otherwise, e.g. for a build that changed its base in place and returns it twice.
- **`build` makes its model itself, once per seed.** `train` changes the model that it is given: the weights after the call are the trained ones. A model that is made once outside `build` is trained by the first seed, and the second seed then starts from the first seed's weights.
- `seeds` are 1 to 5 unless you pass others. With fewer than 5 the summary says that the run is a try-out. An empty list throws, and so do a seed that is named twice, e.g. `[1, 1, 2]`, and a seed that is no whole number, e.g. `2.5`.
- Per setting and seed it saves `<RECOVERY_SCRATCH>/arms/<name>/<setting>/seed-<seed>.tables.json` and `seed-<seed>.record.json`, and it prints and saves `summary.md`: one markdown row per setting with the mean, the lowest and the highest over the seeds, e.g. `96.50 (95.88 to 96.74)`. What an earlier run left in a setting's folder is moved into a folder `earlier-<time>` there first, so the files next to a summary are the files of that run.
- The seed has to reach everything that is random in the build: the order of the samples (`train`'s `seed`), a random choice of trainable cells, a random start. **All randomness of a build comes from its seed**: a build that draws something of its own takes `createRandom(seed, stream)` of `../../random.ts`, e.g. `createRandom(seed, 0).integer(0, 9)`, and never `Math.random()`. With `Math.random()` two runs of one seed give two tables, so a record cannot be made again, and the spread over the seeds also holds what the seed does not decide.
- **When every seed gives the same tables, the build does not use its seed**: `runArm` says so in the summary, e.g. "5, which all gave the same tables" in the column of the seeds, and `describeComparison` then calls the setting one run and no spread. A setting whose first seeds give the same tables and a later one other tables is not named.
- **A setting in which nothing is random** says so: `{name: 'search from the votes', withoutSeed: true, build: () => ...}`. It is built once, saved as `no-seed.tables.json` and `no-seed.record.json`, and reported and compared as one number, like a baseline.

**`recordOf(tables, base)`** returns the standard record of some tables. `runArm` calls it for you. It always scores the exact parser on the validation split of the standard set, and it throws for tables with a changed frozen cell. The record holds:

- `rows`: every row of the score as counts (`ScoreRow` in `../score.ts`): `all`, the six groups as `group: <name>`, the kinds of damage as `kind: <name>`, and the rows of the sources, the families and the debatable samples. `sharesOf(rowNamed(record, 'group: within reach of the tables')).allThree` is a share from 0 to 1. A row also has the display kind, the depth and the container alone, the whole samples, and the bound of the plain table parser.
- `addedShownAsError`, `samplesShowingError`, `shownAsPastEnd`: how the damage itself is shown. A code point that the damage added has no label, so tables lose nothing in the main number by showing no error at all.
- `wrongDepthsOnDeepValidJson`: the share of wrong depths on valid JSON of 17 to 19 levels, on texts with nothing after their nested containers and on texts with members after them. Today's parser has 0 in both, and no score sees such texts.
- `cellsChangedAgainstBase` and `cellsThatDifferFromToday`, per table, and `changedCellsReadByValidation`. See [What can still go wrong](#what-can-still-go-wrong) for why these are two counts.
- `structure`: the numbers of states, the added classes, the bit "first on its line", the open entries of the display table.
- `groundRules`: whether 2,800 fixed texts have today's trace up to their first error and today's verdict.
- `plainParserProblems`: what keeps the tables from being tables of the dataset's plain table parser, as sentences, see the next section.
- `datasetKey`: a key of the dataset's source files. Two records compare only when their keys are the same.
- `run`: the arm's name, the setting's name and the seed (`null` for a setting without a seed) when `runArm` made the record, and `null` for a record that `recordOf` was called for by itself.

**`describeSettings(results)`** gives the three markdown tables of some results: the scores, all three per group, and what the main number does not show. The table per group starts with the group "within reach of the tables".

**`describeComparison(first, second, rowName)`** gives one sentence with both means, both ranges and whether the ranges overlap. The third parameter is the row of the score that is compared, as a record names it. Without it the row is `'all'`, every validation sample. **An arm reports the row `'group: within reach of the tables'` beside `'all'`**: the row "all" also holds the samples that no tables of this layout can label, and two settings can differ in one of the two rows and not in the other. A row that the records do not have throws. The function also throws for a setting with a seed and fewer than 3 seeds. A setting without a seed is one number. Do not print a difference between two settings in any other way: a difference between two means says nothing without the spread.

**`baselines()`** gives the results of the six baselines, to print next to your rows: the parser as it is, the dataset's four hand rules, and the hand-written tables.

**`numberToBeat()`** gives the number to beat as a setting without a seed, for `describeSettings` and `describeComparison`: the tables of the plain search that starts from the hand-written tables, read from `<RECOVERY_SCRATCH>/search/search-from-handwritten.json`, with the hand-written tables as their base. It throws when the file is missing and when the file was saved with another dataset key, and the error names the two commands that make the file, see [Setup](#setup). Call it once, before `runArm`: the record is made on every call, and an arm that finds the file missing only after its training has lost the training.

**`savedResultOf(armName, settingName)`** gives the result of a setting that `runArm` ran before, read from the records that it saved, e.g. `savedResultOf('plain-pass', 'one pass of the trainer from today\'s tables, defaults')`. So an arm is compared with another arm without running that arm again: the result goes into `describeSettings` and `describeComparison` like one of your own. It throws when the setting's folder holds no record, for a record of another dataset key, since its score is then of other samples, and for a record that another run saved. After a rerun of the other arm it gives the rerun: the files of the run before are in a folder `earlier-<time>`, which it does not read.

**`trainDataFor(base)`** gives the train samples of the standard set that give the twin a step, packed for `base`, the tables that the build trains: what `train` takes. Its second argument are the intended stacks, `loadIntendedObjects(samplesOfTheStandardSet(), softCacheFolderOf())` of `../soft/twin-data.ts`, which only a run that is kept on track needs. **`trainPartOfTheStandardSet()`** gives the train split as a set of its own, for `countVotes` of `../search/votes.ts` and for `prepareSamples` of `../search/sample-runs.ts`, which take every broken sample of the set that they are given.

**`samplesOfTheStandardSet()`** and **`validationOfTheStandardSet()`** give the samples of the standard set (seed 20261015, indexes 0 to 59,999, without the test split) and their validation part, loaded once.

What a build function calls from the rest of `learn/`:

- **`train(model, data, options)`** of `../soft/train.ts` trains on every sample of `data` and returns `{best, last, bestPoint, points, samplesPerSecond}`. It changes `model` in place. The tables of a seed are `result.last`. With `options.validation`, `result.best` are the tables of the log point with the best score on one half of the validation split.
- **`createModel(base, {trainable, start, startShare})`** of `../soft/twin.ts`. Without `trainable`, every open cell and every open entry of the display table is trainable. With it, name all three tables, each as `'open'`, `'none'` or a mask. **A mask** is a `Uint8Array` with one entry per cell of the table, 1 for a trainable cell and 0 for every other one, e.g. a copy of `base.grammarOpen` in which the cells of one grammar state are set to 0. Only an open cell may be trainable, and an entry other than 0 and 1 throws.
- **`randomTrainableCells(tables, share, seed)`** of `../soft/train.ts` gives the three masks of a random share of the open cells, e.g. a tenth with 0.1. **`createRandom(seed, stream)`** of `../../random.ts` is the random source of the repo, and the only one that a build uses, e.g. `createRandom(seed, 0).integer(0, 9)`.
- **Structure**, all of `../recovery-tables.ts` and explained in `../structure/README.md`: `addStates(tables, addedTokenizerStates, [grammarStateShownAs, ...])` adds tokenizer states and grammar states, `addClasses(tables, [{name: 'apostrophe', codePoints: [0x27]}])` gives code points a character class of their own, `openDisplayEntries(tables)` lets entries of the display table change, and `addFirstOnLineBit(tables)` tells the grammar whether a token is the first on its line. Each takes tables and returns tables, in any order. The result is the arm's `base`, and `trainDataFor(base)` packs the samples for it.
- **`scoreTables(tables, samples, {splits})`**, `sharesOf(row)` and `cellCountsOf(tables, base)` of `../score.ts`, for a score that is no record, e.g. on the train split.

## The bound of the plain table parser is not this parser's bound

The dataset proves, per sample, what its plain table parser cannot label: `needsNestingFix`, `needsDisplayFix`, and the bound `mostRightFor`. That parser is the loop of `../../table-parser.ts`, whose depth moves only at a bracket that the tokenizer reads, and which keeps the kinds of the open containers in a running sum. On the validation split its bound is 97.94% of all three and 92.45% of whole samples.

The parser of this experiment has a stack action in every grammar cell, e.g. a comma can pop, and a real stack. So its reach is larger, and its score can be above the bound: in the group "needs a nesting fix" the hand-written tables have 76.1% where the bound is 43.3%. Every place that prints the bound names it as the bound of the plain table parser. When you quote it, do the same.

`plainParserProblems` in a record says whether your tables are tables of the plain loop: an empty list for today's tables and for the dataset's hand rules, and a sentence for a stack action that does something else than its token, for an added class, for the bit, and for a changed display table. Even with an empty list the two parsers are not the same: after a closing bracket that does not match, the real stack and the running sum disagree about the innermost container, the grammar reads another context, and the display kind can differ from there on. For the hand rule `words` that is 0.12% of the code points of 4,512 broken texts (`check.ts`).

## What a build function may read

- **The train split**, for training: `trainDataFor(base)` and `trainPartOfTheStandardSet()`. `train` throws for a sample of another split, and so does `countVotes`: `samplesOfTheStandardSet()` holds the validation split too, and a build that packed `placesForTwin(samples, 'validation')` by mistake would train on the split that its record scores. `alsoOtherSplits: true` switches the error off, and no arm should need it.
- **The validation split**, to choose between tables, e.g. the best of several log points. Then say so in the README: the validation score of tables that were chosen on the validation split is optimistic. `train` picks its `best` tables on one half of the validation split and reports the other half for this reason. The record of `runArm` is always the whole validation split.
- **Never the test split.** It is not in the samples, see below.
- **The dataset's hand rules `stay`, `resync`, `words` and `lines` as a base, with care.** For them no split counts as unseen, the test split included: `../../hand-rules.ts` chooses between rules by the dataset's statistics, which are over the samples of every split. An arm that starts from one of them has no unseen split either, and their rows in `baselines()` and in `final.ts` are no numbers on unseen data.
- **The hand-written tables as a base, with care**: their rules were written with the old snapshot's samples in view, so for them, and for everything that starts from them, no split of this dataset counts as unseen.

## The rows that every arm is read against

From `baselines.ts` and `plain-pass/run.ts`, on the validation split: 5,021 broken samples, 425 of them with nothing to recover, 675,949 scored code points. Percentages.

| setting | seeds | all three | display kind | depth | container | whole samples | cells changed against the base |
| --- | --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | none | 42.69 | 49.15 | 75.06 | 88.65 | 11.92 | 0 |
| the dataset's hand rule `stay`, as tables of the experiment | none | 73.81 | 78.16 | 93.90 | 98.15 | 28.74 | 1,058 |
| the dataset's hand rule `resync`, as tables of the experiment | none | 84.35 | 88.17 | 94.97 | 98.33 | 71.39 | 1,078 |
| the dataset's hand rule `words`, as tables of the experiment | none | 93.09 | 97.00 | 95.36 | 98.60 | 77.31 | 1,078 |
| the dataset's hand rule `lines`, as tables of the experiment | none | 93.23 | 97.00 | 95.50 | 98.59 | 77.48 | 1,108 |
| hand-written, the 35 rules of `../handwritten/rules.ts` | none | 96.52 | 98.69 | 97.66 | 99.56 | 80.44 | 915 |
| search from the hand-written tables, the number to beat | none | 97.75 | 99.09 | 98.53 | 99.71 | 79.37 | 429 |
| one pass of the trainer from today's tables, defaults | 5 | 96.50 (95.88 to 96.74) | 98.22 (98.11 to 98.27) | 98.13 (97.64 to 98.35) | 99.68 (99.39 to 99.79) | 73.22 (72.76 to 73.54) | 967 (935 to 984) |

All three per group of the dataset, with the group's validation samples:

| setting | within reach of the tables, 3,687 | needs a display fix, 37 | needs a line rule, 488 | needs a character class, 326 | needs a nesting fix, 76 | out of reach, 407 |
| --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | 47.4 | 18.3 | 63.8 | 10.1 | 26.5 | 25.6 |
| `stay` | 79.0 | 57.9 | 90.8 | 49.5 | 36.1 | 50.1 |
| `resync` | 92.8 | 70.3 | 96.7 | 49.9 | 42.3 | 53.3 |
| `words` | 98.3 | 95.0 | 97.8 | 85.7 | 42.7 | 62.4 |
| `lines` | 98.3 | 95.0 | 99.6 | 85.7 | 42.7 | 62.4 |
| hand-written, 35 rules | 99.5 | 98.2 | 99.0 | 92.2 | 76.1 | 78.0 |
| search from the hand-written tables | 99.7 | 98.0 | 99.1 | 94.9 | 90.3 | 85.4 |
| one pass of the trainer, 5 seeds | 99.1 (98.9 to 99.3) | 96.2 (94.2 to 96.8) | 99.7 (98.9 to 99.9) | 89.7 (88.9 to 90.5) | 89.4 (83.1 to 92.8) | 81.6 (76.9 to 83.6) |

What the main number does not show:

| setting | added code points shown as an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels: nothing after the nested containers | the same, members after | tables of the plain table parser |
| --- | --- | --- | --- | --- | --- |
| the parser as it is | 89.6 | 0 | 0.0 | 0.0 | yes |
| `stay` | 62.7 | 0 | 0.0 | 0.0 | yes |
| `resync` | 60.2 | 0 | 0.0 | 0.0 | yes |
| `words` | 3.7 | 0 | 0.0 | 0.0 | yes |
| `lines` | 3.7 | 0 | 0.0 | 0.0 | yes |
| hand-written, 35 rules | 0.0 | 0 | 0.0 | 0.0 | no: 21 grammar cells hold a stack action that does something else than their token does |
| search from the hand-written tables | 0.0 | 0 | 18.5 | 30.2 | no: 94 such grammar cells |
| one pass of the trainer, 5 seeds | 0.9 (0.7 to 1.1) | 50 (0 to 160) | 3.0 (0.0 to 12.3) | 4.7 (0.0 to 16.4) | no: 26 such grammar cells in the first seed |

The base of `lines` is today's tables with the tokenizer state that the rule adds, so its tables differ from today's parser in 1,111 cells. The base of the search is the hand-written tables, and its tables differ from today's parser in 983 cells.

The sentences of `describeComparison` for the plain pass, as `plain-pass/run.ts` prints them:

- All three, all validation samples: "one pass of the trainer from today's tables, defaults" has 96.50 (95.88 to 96.74) over 5 seeds, "hand-written, the 35 rules of handwritten/rules.ts" has 96.52 and no seed. The means differ by -0.01 points, and the two ranges overlap, so these seeds do not tell the two settings apart.
- All three, group: within reach of the tables: "one pass of the trainer from today's tables, defaults" has 99.11 (98.87 to 99.31) over 5 seeds, "hand-written, the 35 rules of handwritten/rules.ts" has 99.51 and no seed. The means differ by -0.39 points, and the two ranges do not overlap.
- All three, all validation samples: "one pass of the trainer from today's tables, defaults" has 96.50 (95.88 to 96.74) over 5 seeds, "search from the hand-written tables" has 97.75 and no seed. The means differ by -1.24 points, and the two ranges do not overlap.
- All three, group: within reach of the tables: "one pass of the trainer from today's tables, defaults" has 99.11 (98.87 to 99.31) over 5 seeds, "search from the hand-written tables" has 99.68 and no seed. The means differ by -0.57 points, and the two ranges do not overlap.

What to read from them:

- **Two seeds of one setting are up to 0.9 points apart.** The plain pass ranges from 95.88% to 96.74%. A setting that is half a point above another in one seed each has shown nothing.
- **The number to beat is the row "search from the hand-written tables", 97.75%.** `numberToBeat()` gives it. An arm without added structure that ends below it has found nothing that a search does not find, see `../search/README.md`.
- **The two rows of a comparison can disagree.** On all samples the plain pass is not told apart from the hand-written tables. In the group "within reach of the tables" it is 0.4 points below them, and no seed reaches them: what the trainer gains is in the groups "needs a nesting fix" and "out of reach", where it has 89.4% and 81.6% against 76.1% and 78.0%.
- **The dataset's `words` is 93.09% here, and the dataset's README says 91.9%.** That number is over all splits and from the plain table parser. Here it is the validation split and the parser with a real stack. The same holds for `lines`, 93.23% here and 92.3% there.
- **The plain pass is untuned.** It is the spread that matters in its row, not its mean.

## The test split

The test split is for final numbers only, after every choice is made. It holds four kinds of damage (`conflictMarkers`, `nonFiniteNumber`, `logPrefix`, `concatenated`) and one template (`order`) that are in no other split.

- `loadSamples` leaves every sample of the test split out when it makes the samples, so a script that reads the arrays cannot score, print or train on one. A sample's place in the arrays is therefore not its index in the dataset: `samples.index[place]` is.
- `allowedSampleAt(seed, index)` of `../data.ts` gives one sample of the dataset, and `undefined` for a sample of the test split. No file of `learn/` but `data.ts` may call the dataset's `sampleAt`: `../check-guard.ts` fails when one does.
- `scoreTables` with the split `test`, `loadSamples` with `withTest` and `placesOfSplit(samples, 'test')` throw unless the environment variable `RECOVERY_FINAL` is `yes`. `--split test` throws on every command, with or without it.
- `final.ts` is the script of this folder that is meant to run with it: `RECOVERY_FINAL=yes bun lab/recovery-parser/learn/arms/final.ts <name>=<tables.json> ...`. Two more scripts run with it, `run.ts` and `show.ts` of `../final/`, the folder of the final scoring, see `../final/README.md`. `final.ts` prints, per tables and for the baselines, a row for each of the four ways a test sample can be held out: nothing held out, a held-out kind on a template that training has, kinds that training has on the held-out template, and both. About a half of the test split is held out, so one number for the whole split is not to be reported alone.
- `final.ts` refuses a file of tables that was not saved with the dataset as it is now, see the next section. And every run appends a line to `<RECOVERY_SCRATCH>/arms/final-runs.log` before it loads a sample: the time, the dataset's key, and the name, the path and a hash of each file of tables. So the scratch folder says which tables were scored on the test split, and when.
- **`final.ts` was never run.** `check.ts` runs its report on validation samples whose held-out bits are made up, where the four rows hold the samples that they should and add up to the validation row. The loading of the test split itself is the one code path of `learn/` that no check has run, so read its first output with care.
- Do not read the files that `lab/recovery-parser/dump.ts` writes: they hold test samples.

## Tables of another dataset

A later commit of the dataset can move a sample from the train split to the validation split or to the test split. Tables that were trained before it have then trained on samples that are scored after it, see "Taking a new commit of the dataset" in `../README.md`. So:

- Every file that `saveTables` writes holds the dataset's key of the moment it was saved, as the field `datasetKey`. `runArm`, the trainer, the search and the votes all save with it.
- `final.ts`, `../search/search.ts --from` and `../soft/train.ts --base` refuse a file with another key, or with none. Make the tables again with the dataset as it is.
- `../compare.ts`, `../score.ts` and the other commands that only report load such a file and print a line that starts with "Note:".
- A record holds the key too. Compare two records only when their keys are the same, and after a merge of a later commit of the dataset, make every table again.

## What can still go wrong

- **A model that is made once for every seed.** `train` changes the model in place, and nothing throws when it gets a model that was trained before: the second seed goes on from the first seed's weights, and its record looks like any other. Make the model inside `build`, as the example does.
- **Randomness that does not come from the seed.** `Math.random()` in a build, or a `createRandom` with a fixed number in the place of the seed, e.g. a random tenth of the cells that is the same tenth for every seed. The first makes a record that no rerun gives again. The second is not seen by the harness when something else in the build still uses the seed, since the seeds then give other tables.
- **One row of a comparison.** `describeComparison(first, second)` compares all validation samples. Print the comparison on `'group: within reach of the tables'` beside it, as the third parameter.
- **A number to beat or a saved result of another dataset.** `numberToBeat()` and `savedResultOf` refuse a file that was saved with another dataset key. After a new commit of the dataset, make the search from the hand-written tables again, and run the other arm again.
- **`train(model, data, options)` trains on every sample of `data`.** `options.places` are places in `data`, from 0 to `data.sampleCount - 1`, not places in the samples that `data` was packed from. A place outside `data` throws. A place inside `data` that you did not mean does not. So pack exactly the samples of the run, with `trainDataFor(base)`, and pass no places.
- **`createModel(base, {trainable})` needs all three of `lexer`, `grammar` and `display`**, each as a mask, `'open'` or `'none'`. Without `trainable`, every open cell and every open entry of the display table is trainable. A model without any trainable cell makes `train` throw.
- **Pack the samples for the tables that you train.** `trainDataFor(base)` gives every code point the class that `base` gives it. A run on samples that were packed for other classes or without the bit throws. Tables with the same classes and more states are fine.
- **Two counts of cells.** "Cells changed against the base" is what your run changed. "Cells that differ from today's parser" also holds every cell of an added state, and the changed cells that an added class or the bit copied. E.g. two added tokenizer states and one grammar state are 154 cells that differ from today's parser before a run changes anything. Report the first, and name both. `recordOf` throws for a base with other states, classes, contexts or open entries than the tables. A base with the right layout and the wrong cells still gives a wrong count without an error, e.g. today's tables for a run that started from the votes.
- **An option that a command does not have is an error**, e.g. `search/mistakes.ts --split test`. Read the error: the command names its options. That only holds for a script that calls `refuseUnknownOptions`, so an arm's script calls it first, as the example does.
- **The last tables of a run are one draw.** The score of snapped tables moves by more than half a point between two log points of one run. Take the last tables (`result.last`), or tables chosen on one half of the validation split and scored on the other (`result.best` of a call with `validation`), and never the best of many log points on the whole split. Without `validation`, `result.best` is `result.last`.
- **A low loss is not a good parser.** The twin is not the parser once its cells hold mixes. Only the record counts.
- **Check the columns that the main number does not show.** Tables can gain a point and break the depth of valid JSON that is too deep, or show characters of the text as "past the end".
- **Say what the arm is** in its README: which cells it may change, whether its tables have more states, classes or the bit, whether its display table is open, and what `plainParserProblems` says.

## Files

- `harness.ts`: `recordOf`, `runArm`, `describeSettings`, `describeComparison`, `spreadOf`, `percentSpread`, `baselines`, `baselineTables`, `numberToBeat`, `savedResultOf`, `trainDataFor`, `trainPartOfTheStandardSet`, `groundRulesOn`, `armFolderOf`.
- `baselines.ts`: prints and saves the baselines' rows.
- `final.ts`: the test split, only with `RECOVERY_FINAL=yes`.
- `check.ts`, in seven parts:
  1. The dataset's cells of valid JSON are the experiment's frozen cells. The dataset's four hand rules as tables of the experiment hold the hand rule's cells, cell by cell, and give the depth of the dataset's plain table parser on 4,512 broken texts. The hand rule `lines` has a tokenizer state of its own: 623 code points are read in it, and its record counts 1,108 cells changed against today's tables with that state added, as a count made in the check does.
  2. The record: for today's tables, for the hand-written tables (every row is the row of `scoreTables` for those tables, 915 cells changed against today's tables by a count made in the check, and 0 with themselves as the base), and for tables with random open cells (the wrong depths on valid JSON that is too deep are the ones of `../check-deep.ts`, 74.2% and 80.6%). The three fields of how the damage is shown are the counts of `scoreTables`, for the hand-written tables, where all three are 0, and for today's tables and the random ones, where they are not. `recordOf` refuses a changed frozen cell, the tables as their own base and a base of another layout, each by the sentence of its reason, e.g. a base without the tables' added class, or with a class for another code point.
  3. The ground rules hold on the fixed texts for 12 random settings, and do not hold for tables with one changed frozen cell, for each of 40 frozen cells.
  4. The arithmetic of a report on records made up with known numbers, e.g. 0.92, 0.90 and 0.91 give "91.00 (90.00 to 92.00)": every cell of a setting's row in each of the three tables of `describeSettings`, for a setting of 3 seeds and for one without a seed, and the sentence of `describeComparison` with ranges that overlap and with ranges that do not, on the row "all" and on the row of a group.
  5. `runArm` with toy builds: a seed that picks one of the dataset's hand rules, so that every seed has another score and the summary's row is the mean, the lowest and the highest that the check works out, a setting without a seed, a build that ignores its seed, a build whose third seed gives other tables than its first two, lists of seeds that throw (none, a seed twice, the seed 2.5), and a rerun with fewer seeds. `savedResultOf` reads every setting back as the result that `runArm` returned, and refuses a setting that was never run, a record of another dataset and a record of another run. A record of another run is tried three times, with one of the arm, the setting and the seed wrong, e.g. the record of seed 1 under the file name of seed 2.
  6. `final.ts` without a test sample: its report on validation samples with made-up held-out bits, and its refusal of tables of another dataset.
  7. `numberToBeat` on scratch folders that the check makes: the file that it reads is `search/search-from-handwritten.json` of the scratch folder, the tables of the file come back as a setting without a seed, with the hand-written tables as the base, and it refuses a missing file, a file of another dataset and a file without a dataset key.
- `plain-pass/`: the first arm.
