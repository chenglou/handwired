# The trainable twin of the parser

This folder holds the part of the experiment that tests the idea "unfreeze the cells that only broken input reaches, and train them": the recovery parser of `../recovery-parser.ts` written a second time, so that the choices of the open cells are weights that gradients can move. It builds on the shared core in the folder above, whose README explains cells, frozen and open cells, choices, snapping and the score. It does not run an arm of the experiment. Every number here is preliminary, since the dataset is a snapshot under review.

## What the twin holds

The exact parser keeps one index per part of its state, e.g. "the tokenizer state is `string`". The twin keeps one number per possibility, a share from 0 to 1:

- 26 shares for the tokenizer state, 8 for the grammar state, and one per depth of a range of depths, -8 to 24 unless another range is asked for.
- Per level 1 to 16 of the stack, the share of "this level is an object".

A cell holds a mix: one share per choice, e.g. 0.7 for the next state `value` and 0.3 for `error`. A tokenizer cell has a mix over its 26 next states and a mix over its 25 events. A grammar cell has a mix over its 8 next states and a mix over its 5 stack actions. A trainable cell's mix is the softmax of that cell's weights divided by a temperature. Every other cell, e.g. every frozen cell, holds its one choice as exact 0 and 1.

With exact tables every share is exactly 0 or 1 and the twin is the exact parser. `check-twin.ts` checks that, see [Checks](#checks).

The twin starts at a text's first error, with the exact parser's state there. Every cell that a text reads before its first error is frozen, so nothing before the first error can change.

## One step

`stepForward` in `twin.ts` computes, for one code point:

1. **The tokenizer.** The event's mix is the sum over the tokenizer states of (the state's share) × (the event mix of that state's cell for the code point's class). The next tokenizer state's mix is the same sum with the cells' next state mixes.
2. **The token.** Its mix follows from the event's by the fixed table, e.g. the shares of `numberStart` and `literalStart` add up to the share of the token `scalar`.
3. **The context.** Per depth class, the share of "an object is the innermost container" is the sum over the depths of the class of (the depth's share) × (the share of "an object" at that depth's level), and the rest of the class's share is "an array", or at depth 0 "no container".
4. **The grammar.** The next grammar state's mix and the stack action's mix are the sums over (grammar state, token, context) of the product of the three shares times the cell's mix. The share of the action `by token` goes to what the token does, e.g. to "pop" for a closing bracket.
5. **The depth.** A push moves every depth's share one depth up, a pop one down, and the rest stays.
6. **The levels' kinds.** A push at depth l - 1 writes level l. So level l becomes (its share of "an object") × (1 - the share of depth l - 1 × the share of a push) + (the share of depth l - 1) × (the share of "push an object").
7. **What is shown.** The display kind's mix is the sum over (event, next grammar state) of the product of the two shares, put on the kind that the display table has for the pair, or split by the entry's own mix when the entry is open, see `../structure/README.md`. The container after is "none" with the share of the depths 0 and below, and "an object" with the sum over the depths above 0 of (the depth's share after) × (the share of "an object" at its level after).

Two points differ from the shortest way to write this down:

- **The context is not the product of a depth class mix and one container mix.** Step 3 multiplies per depth, so depth 0 never has a container. With one product, a state that is half at depth 0 and half inside an object would also read the cells of the context "depth 0, object", which the exact parser never reads.
- **The share of the action `none` is not read.** Step 5 takes "the rest stays" as 1 - push - pop. The two are the same number when every mix adds up to 1. But with the share of `none`, the total of the depth's shares would be multiplied by the total of the action's shares, which is itself the depth's total times two others. A rounding error of 1e-16 in a total then at least doubles with every step. The first version of the twin did that, and about 40 steps after a first error its shares were far above 1, e.g. 2 million for a depth.

## Where the twin loses information

The twin holds each part of the state on its own, and a step multiplies the parts as if they had nothing to do with each other. With exact tables that is exact. Once a state is a mix, the twin can no longer say which possibilities go together:

- **Parts of the state.** Half "inside a string, and the grammar expects a comma" and half "between tokens, and the grammar expects a key" is stored as half and half for the tokenizer, and half and half for the grammar. The next step then also reads the cells of "inside a string, expects a key", with a share of a quarter, although no reading of the text is in that state.
- **The two mixes of a cell.** A tokenizer cell that is half (`string`, `stringStart`) and half (`between`, `whitespace`) also gives a quarter to (`string`, `whitespace`). The same holds for a grammar cell's next state and its stack action. A snapped cell holds one of each, so this only matters while training.
- **The event and the next grammar state.** Half "a quote that starts a key" and half "a comma" is shown as a quarter key, a quarter plain string and half punctuation, although the truth is half key and half punctuation.
- **The stack action and the depth.** The stack action's mix is one mix for the whole step. When only the cells of the context "depth 1" pop, their share of a pop also moves the share at depth 5 one depth down.
- **The stack.** A level has one share of "an object", whatever the depth is. Half "depth 1, in an object" and half "depth 2, in an array inside an array" makes level 1 half an object. After a pop, the half that is now at depth 1 is shown as half in an object, although all of it is in an array.
- **The depth range.** A pop at the lowest depth of the range and a push at the highest leave the share where it is. The exact parser's depth has no bounds, so the two differ once a share reaches an end of the range. With today's tables no run of `check-twin.ts` gets there. With random tables, 14,339 of 50,000 runs do.

So a low loss of the twin does not promise a good parser. Only the score of the snapped tables in the exact parser counts, and the trainer prints it.

## The loss and its options

The loss is the cross-entropy of the display kind, the depth and the container against the labels, at the labeled code points from the first damage on, divided by the number of those code points. A share's cross-entropy is -ln(share + 1e-6), so a share of exactly 0 costs 13.8 and not infinity. Labeled code points between the first damage and the first error are left out: frozen cells compute them, so their loss is a constant.

`LossOptions` and `ObjectiveOptions` in `twin.ts` hold what an arm can switch on:

- **Weights of the three losses** (`kindWeight`, `depthWeight`, `containerWeight`), 1 each by default.
- **Extra targets from `../intended.ts`** (`intendedLexerWeight`, `intendedEventWeight`, `intendedGrammarWeight`): the cross-entropy of the tokenizer state after a kept code point, of its event, and of the grammar state after it, against the states that today's parser has at the code point's counterpart in the original. They are only used at the code points that the core marks as ones whose intended state a parser of the broken text can be in (`codePointCanFollow`, 86% of the kept code points from the first damage on). Elsewhere no choice of the open cells leads to the intended state, e.g. at the space after a removed comma, where frozen cells keep the grammar in the state it was in.
- **Keeping the run on track** (`onTrackProbability`): after a code point with that mark, with this probability, the twin's whole state is replaced by the intended state. Gradients do not cross a replaced state. The state includes the kind of every open level, which the core's arrays do not have, so `twin-data.ts` makes the intended stacks from the samples themselves and keeps them in a cache file. Making them takes about half a minute once.
- **The intended states at every kept code point** (`intendedEverywhere`): the first version of the twin used them so, with or without the mark. The option is only there to measure what the mark changes, see [What the two options with intended states do](#what-the-two-options-with-intended-states-do).
- **A temperature** (`temperature`): a trainable mix is softmax(weights / temperature), so a temperature below 1 makes every mix closer to one choice.
- **A cost on a mix being far from one choice** (`sharpnessCost`): the weight of the mean entropy of the trainable mixes. A mix's entropy is 0 for one choice and ln(8) = 2.08 for a uniform mix over the 8 next states of a grammar cell.

The backward pass is written by hand in `stepBackward`, in the order of the step's parts from last to first.

## Snapping

`snappedTables(model)` returns tables in which every trainable cell holds the choice with the largest weight. Among equal weights it keeps the base tables' choice, e.g. in a cell that started uniform and that no training sample read. `saveTables` of the core writes them as JSON, which `../score.ts --tables` reads.

**Cells that only the twin reads.** The twin reads every cell that has a share, however small, so training also moves cells that the exact parser reads at no code point of a trained text. After one pass over the train split, the snapped tables of the default run differ from today's in 967 cells, and the exact parser reads 688 of them on the train texts. With a uniform start it is 587 of 1,157. So "cells changed" overstates what the exact parser uses, and the trainer logs both counts.

These other cells are not noise, though. The trainer also scores the snapped tables with the base tables' choice put back into them, which changes no trace of a trained text:

| run | cells changed | of those, read by a trained text | validation, snapped | validation, with the others as in the base |
| --- | --- | --- | --- | --- |
| 400 train samples, 50 passes | 892 | 354 | 92.5% | 90.9% |
| the same, seed 2 | 882 | 367 | 91.8% | 86.0% |
| the same, `--start uniform` | 1,161 | 331 | 92.9% | 87.4% |
| one pass over the train split | 967 | 688 | 94.5% | 94.5% |
| one pass, `--start uniform` | 1,157 | 587 | 95.0% | 95.0% |

After training on 400 samples, validation texts read cells that none of the 400 read, and what the twin put there through small shares is worth 1.6 to 5.8 points. After the whole train split the two scores are the same. So the trainer saves the snapped tables as they come, and `--only-read-cells` (`onlyReadCells` in `train`) saves the ones with the other cells put back, for a reader or a port that wants no cell without a text that reads it.

## Training

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/soft/train.ts --name smoke --train-samples 400 --epochs 50 --log-every 4000
bun lab/recovery-parser/learn/score.ts --tables $RECOVERY_SCRATCH/soft/runs/smoke/best.json --cells
```

`train.ts` runs Adam over the weights of the trainable cells, in batches of 32 samples, split over up to 4 worker threads. It writes `log.txt`, `best.json` and `last.json` to `<scratch>/soft/runs/<name>`. It never reads the test split.

`last.json` holds the snapped tables after the last sample. `best.json` holds the snapped tables of the log point with the best score on one half of the validation split, the samples at even places, and the log gives their score on the other half. The score of snapped tables moves by up to a point between two log lines, e.g. 95.2, 95.2, 95.2, 94.5 at the end of the one-pass run below, so the best of 20 log points is partly picked noise. Quote its score on the other half, or the last tables with the range of the last log points, which the run's last lines give. The two halves are not equally hard (today's tables have 41.6% and 40.0%), so compare a score on a half only with other scores on that half. To compare two arms, run several seeds: two seeds of the one-pass run end at 94.5% and 94.6%, and of the smoke run at 92.5% and 91.8%.

Its options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--train-samples` | all | the first so many train samples that give the twin a step |
| `--epochs` | 1 | passes over those samples |
| `--batch` | 32 | samples per step of Adam |
| `--learning-rate` | 0.05 | |
| `--seed` | 1 | the order of the samples, the draws that keep a run on track, and which cells `--open-share` picks |
| `--workers` | 4 | worker threads, or 0 to run in the main thread |
| `--base` | today's tables | saved tables to start from, e.g. the hand-written ones |
| `--start` | `base` | `base`: every trainable mix starts with `--start-share` (0.9) on the base tables' choice. `uniform`: every choice starts with the same share |
| `--open-share` | 1 | the share of the open cells that are trainable, picked at random, e.g. 0.1 for a tenth |
| `--intended` | 0 | one weight for the three extra targets |
| `--on-track` | 0 | the probability of keeping the run on track after a code point whose intended state can be followed |
| `--every-intended` | off | the intended states at every kept code point, as the first version used them |
| `--temperature`, `--temperature-end` | 1 | the temperature at the first and at the last sample |
| `--sharpness-cost` | 0 | the weight of the cost on a mix being far from one choice |
| `--depth-low`, `--depth-high` | -8, 24 | the depths that the twin holds a share for |
| `--only-read-cells` | off | scores, picks and saves the snapped tables with the base tables' choice in the cells that no trained text reads |
| `--log-every` | 2000 | samples between two log lines |

A log line has:

- The loss per labeled code point since the line before, with its parts. It holds the extra targets, and in a run that is kept on track it is the loss of a run that was put right after most code points. So it does not compare between runs with other options.
- **The loss of a free run**: the loss of the three labels on the first 100 trained samples, without the extra targets and without keeping the run on track. This one compares between runs. E.g. after the smoke run below, the run that is always kept on track has the lowest loss of all, 0.053, and a free-run loss of 1.65, against 0.099 and 0.062 for the default run.
- **The free-run loss without the code points at which a label is ruled out.** A cell that is not trainable holds exact 0 and 1, so a label that those cells rule out has a share of exactly 0 and costs 13.8 whatever is trained. With every open cell trainable there are none. With a random tenth of the open cells trainable, 39.6% of the code points of the fixed samples have such a label: the free-run loss is 9.32, and 0.93 without them.
- **How often the twin reads as its snapped tables**: the share of the labeled code points of the fixed samples at which the twin's largest shares are the display kind, the depth and the container that the exact parser gives with the snapped tables. See the next section.
- The mean entropy and the mean largest share of the trainable mixes.
- The score of the snapped tables on the validation split in the exact parser, on the whole split and on its two halves.
- The number of cells in which the snapped tables differ from the base tables, how many of those the exact parser reads at a code point of a trained text, and the score with the base tables' choice in the others.

## Where a run starts

"Start at the base tables' choices" does not mean that the twin starts as the base parser. With a share of 0.9 on the base choice, every step mixes in a tenth of other choices in each mix, and the shares drift:

| `--start-share` | the twin reads as the base parser, before training, at |
| --- | --- |
| 0.9, the default | 10.3% of the labeled code points of the 100 fixed samples |
| 0.999 | 100.0% |
| `--start uniform` | 0.5% |

A review of the twin measured the drift by distance on 400 train samples: with 0.9 the twin's reading is the exact parser's at every code point within 5 steps of the first error, at 88% in the steps 6 to 20, at 8% in the steps 21 to 100, and nowhere later. That count is not rerun here.

So the loss at the start of a default run is not the base parser's loss, and a run from a base that already recovers, e.g. the hand-written tables, does not start from that recovery's behaviour unless the start share is 0.999 or the base's cells are not trainable. In the smoke setting the start share made no clear difference to the end: 92.5% with 0.9, 91.9% with 0.999, 92.9% from a uniform start. One short run from the hand-written tables with a start share of 0.999 and every open cell trainable (400 samples, 10 passes) went from 95.5% to 94.9%: it is only a test of `--base`, not a result.

**The depth range.** A push at the highest depth of the range and a pop at the lowest leave the share where it is, which the exact parser does not do. The review measured that a uniform start puts more than 1% of the depth's share at an end of the range in 45% of the steps before training, because uniform action mixes push more than they pop, and in none after training. Here the smoke run from a uniform start ended at the same score, 92.9%, with `--depth-high 48` as with 24, in other tables, so the default range was left as it is.

## What the two options with intended states do

The intended states are the states of today's parser on the original. After a removed or an added part, many of them cannot be reached by any choice of the open cells, see `../intended.ts`. The first version of the twin used all of them, and a review measured that both options then lowered the score of the snapped tables while the twin's loss got lower. The mark `codePointCanFollow` takes the unreachable ones out. Snapped tables on the validation split, last log line, seed 1 unless noted:

| run | defaults | `--intended 0.3` | `--on-track 0.5` | `--on-track 1` |
| --- | --- | --- | --- | --- |
| 400 samples, 50 passes, with the mark | 92.5% | 92.5% | 89.4% | 72.8% |
| the same, every kept code point (`--every-intended`) | | 90.9% | 87.3% | 70.9% |
| the same with the mark, seed 2 | 91.8% | 92.7% | 90.9% | |
| one pass over the train split, with the mark | 94.5% | 95.5% | 92.1% | 60.6% |
| the same, every kept code point | | | | 66.7% |

- **The extra targets no longer cost.** With the mark they end at or above the default in all three pairs of runs. Whether they help is not shown by this: two log lines of one run differ by as much.
- **Keeping the run on track still costs**, less than before at a probability of 0.5, and at a probability of 1 the run ends lower than before after one pass (its best log point was 81.7%, after 6,048 samples). The cause is no longer a state that cannot be reached. A run that is put right after most code points never has to go on from its own mistakes, and the exact parser has to: after the smoke run with probability 1, the twin reads as its snapped tables at 67% of the code points of a free run, against 99.7% for the default run. So the option stays off by default. An arm that wants it should lower the probability to 0 by the end of training, and judge by the free-run loss and the snapped score, never by the loss.

An arm calls the same parts from its own script, e.g. with hand-written recovery as the base tables and its holes as the trainable cells:

```ts
import {loadStandardSamples, splitNames, validationPart} from '../data.ts'
import {asIsTables, saveTables} from '../recovery-tables.ts'
import {train} from './train.ts'
import {packForTwin, placesForTwin} from './twin-data.ts'
import {createModel} from './twin.ts'

const samples = loadStandardSamples()
const trainPlaces = placesForTwin(samples, splitNames.indexOf('train'))
const data = packForTwin(samples, trainPlaces)
const base = asIsTables()
// The masks say which cells are trainable. Here: every open grammar cell and no tokenizer cell.
const model = createModel(base, {trainable: {lexer: new Uint8Array(base.lexerOpen.length), grammar: base.grammarOpen, display: base.displayOpen}, start: 'base'})
const everySample = Int32Array.from({length: data.sampleCount}, (_, place) => place)
// `trainedOn` lets a log point count the changed cells that a trained text reads.
const result = await train(model, data, everySample, {epochs: 1, validation: validationPart(samples), trainedOn: {samples, places: trainPlaces}, sharpnessCost: 0.01})
saveTables(`${process.env['RECOVERY_SCRATCH']}/grammar-only.json`, result.last, 'grammar cells only')
```

This example ends at 65.1% of all three on the validation split after one pass, with 203 cells changed.

Keeping the run on track also needs the third argument of `packForTwin`: `loadIntendedObjects(samples, softCacheFolderOf())`.

Speed on the machine of these runs, an 18 core machine with other jobs running: 515 samples per second in one thread and 1,380 with 4 worker threads, at the start of a run from today's choices, as the first version measured it. A run that is kept on track is several times faster, since most of its shares are 0 and a step skips them. A log point also runs the first 100 trained samples twice in the main thread, and the exact parser over every trained text and over the validation split.

## Checks

Each check is a script that ends with "Every check passed." or with a count of failures. Run them from the repo root with `RECOVERY_SCRATCH` set.

**`bun lab/recovery-parser/learn/soft/check-twin.ts`** (about 30 s): the twin with exact tables is the exact parser. For 2,500 broken samples of the train split, with today's tables and with 20 random settings of every open cell, 5 of them with added states, the twin runs from the first error to position 512 and every share has to be exactly 0 or 1 and equal to the trace of `recovery-parser.ts`: the tokenizer state after, the event, the token, the context, the grammar state after, the stack action, the display kind, the depth after and the container after.

- Today's tables: 2,500 runs, 1,025,774 positions, 0 runs differ. No run reaches an end of the depths -8 to 24.
- Random settings: 50,000 runs, 20,515,480 positions, 0 runs differ when the twin's depth range holds the depths that the exact parser reaches in the run. With the depths -8 to 24, 14,075 runs differ, all of them among the 14,339 runs that reach an end of that range.
- The intended stacks of `twin-data.ts` are the exact parser's stack after every code point of 2,193 original documents, 502,979 code points. They are the documents of the first 2,000 samples that are not in the test split.

**`bun lab/recovery-parser/learn/soft/check-gradient.ts`** (about 17 s, and half a minute more the first time, for the intended stacks): the backward pass against finite differences on random mixes. Every open cell is trainable with random weights. There are 5 settings with today's tables: the three losses alone; every option on; a depth range of -1 to 17, so that shares reach its ends; sharp mixes with the run kept on track; the intended states at every kept code point, with targets and with the run kept on track. Each uses 24 samples with 1,264 steps. Per setting and group of weights, the check compares 6 random directions, each of which moves every weight of the group, and about 60 single weights. The largest differences over the 5 settings:

| Group of weights | 30 directions, relative | 300 single weights, absolute | single weights with a gradient of at least 1e-4, relative |
| --- | --- | --- | --- |
| tokenizer, next state | 1.3e-7 | 5.7e-11 | 2.5e-7 |
| tokenizer, event | 1.0e-7 | 2.2e-11 | 3.4e-8 |
| grammar, next state | 1.3e-8 | 2.5e-11 | 1.1e-7 |
| grammar, stack action | 6.3e-9 | 2.9e-11 | 1.1e-7 |

The largest relative difference is 2.5e-7. A direction's difference is divided by the length of the group's gradient. For single weights with a gradient below 1e-4 only the absolute difference is reported: the objective holds terms -ln(share + 1e-6), in which a rounding error of 1e-16 in a share near 0 is an error of 1e-10, so a finite difference of the objective cannot resolve a small gradient to many digits.

Each of the checks then runs tables with added structure, e.g. this one two more settings. `../structure/README.md` says what those parts cover.

**`bun lab/recovery-parser/learn/soft/check-circuit.ts`** (under 1 s): one step of the twin as a Handwired circuit, see [below](#the-step-as-a-handwired-circuit).

**`bun lab/recovery-parser/learn/soft/check-train.ts`** (2 s): the trainer's parts. The gradients of a batch of 96 samples from 4 worker threads are the gradients from one thread, up to 6e-9 on a largest gradient of 5.0e6. Two runs with the same seed end with the same 54,710 weights bit for bit, and another seed with other weights. 1,800 of the 54,710 are the display table's, which no run of today's tables trains. A model at its start snaps to the base tables, and a trained model's snapped tables keep the ground rules and are the same after saving and loading. With a tenth of the open cells trainable, no weight of another cell moves and no other cell changes. With `onlyReadCells`, the returned tables hold the base tables' choice in every cell that the exact parser reads at no code point of a trained text (932 of the 1,118 changed cells after 2 passes over 96 samples from a uniform start), and give the trained texts the same cells and the same trace as the snapped tables.

To see that the checks can fail, the first version of `twin.ts` was broken in five ways, one at a time: level l written by a push at depth l instead of l - 1, no gradient from the context to the levels' kinds, no gradient to the pop that stays at the lowest depth, half the gradient from the display kind to the event, and `by token` reading the gradient of the wrong action. `check-twin.ts` failed for the first, which changes the step itself, and `check-gradient.ts` and `check-circuit.ts` failed for all five.

## A smoke run

These runs only show that the loss falls and that snapped tables can be scored. Nothing was tuned, and the dataset is a snapshot under review, so they are no result of the experiment.

400 train samples, 50 passes, 20,000 samples, 5 to 12 s per run, seed 1. The score is of the snapped tables in the exact parser on the validation split, 5,203 broken samples: the percentage of labeled code points from the first damage on with all three labels right. Today's tables have 40.8%.

| Run | Loss per code point, first 4,000 samples | Loss, last 4,000 samples | Free-run loss at the end | All three, last tables | Lowest and highest of the last 5 log points | Cells changed, and read by a trained text |
| --- | --- | --- | --- | --- | --- | --- |
| defaults: start at today's choices, every open cell trainable | 1.23 | 0.099 | 0.062 | 92.5% | 87.4% to 92.5% | 892, 354 |
| `--start uniform` | 2.09 | 0.096 | 0.066 | 92.9% | 89.1% to 92.9% | 1,161, 331 |
| `--intended 0.3 --on-track 0.5 --temperature 1 --temperature-end 0.5 --sharpness-cost 0.01` | 0.30 | 0.066 | 0.358 | 91.5% | 88.6% to 91.8% | 437, 264 |
| `--open-share 0.1`: 127 of the 1,326 open cells | 8.49 | 8.15 | 9.32, and 0.93 without the labels that are ruled out | 50.1% | 49.9% to 50.7% | 79, 19 |

The first two losses of the third run hold the extra targets and are those of a run that is kept on track half of the time. Its free-run loss is almost six times the default run's, and its score is a point lower. The loss of the fourth run stays high because 39.6% of its code points have a label that cells outside the trainable tenth rule out, at 13.8 per label. For the default run, `score.ts` gives the same numbers from `last.json` as the trainer's log: all three 92.5%, display kind 96.6%, depth 95.2%, container 98.6%, whole samples 65.8%.

One pass over all 38,119 train samples that give the twin a step takes 13 to 26 s with 4 worker threads:

| Run | All three, last tables | Best log point, picked on one half: the other half, the whole split | Lowest and highest of the last 5 log points | Cells changed, and read by a trained text |
| --- | --- | --- | --- | --- |
| defaults | 94.5% | 95.1%, 95.2% | 94.5% to 95.2% | 967, 688 |
| defaults, seed 2 | 94.6% | 94.7%, 94.7% | 94.4% to 94.7% | 966, 672 |
| `--start uniform` | 95.0% | 95.4%, 95.3% | 95.0% to 95.3% | 1,157, 587 |
| the third setting above | 89.9% | 92.7%, 93.1% | 88.5% to 92.5% | 514, 376 |
| `--open-share 0.1` | 50.7% | 50.7%, 51.6% | 50.7% to 51.6% | 87, 35 |

What the score does not show, for the last tables of the default one-pass run on the validation split (`../compare.ts` and `../check-deep.ts`): 0.9% of the code points that the damage added are shown as an error, where today's tables show 89.5% so; 131 code points are shown as "past the end", the display kind of the cells after a text, because a tokenizer cell holds an event of a text's end; and the depth of a valid JSON text of 17 to 19 levels stays right at every code point, as today. From a uniform start the last tables show no error at all, and the depth of such texts is wrong at 87% of the code points after the 17th bracket. Neither is in the loss, so which run keeps which is an accident.

## The step as a Handwired circuit

`step-circuit.ts` builds one step with the repo's runtime, `src/runtime/numeric-ui-core.ts`: the cells' mixes, the state before the step and a one-hot of the code point's class are source cells, a product of two shares is `circuit.multiply`, and a sum is `circuit.affine`. So the step is a program that Handwired can express, and not a separate model. The softmax that turns weights into mixes is not in the circuit: the mixes are its inputs.

The circuit has the full size: 53,026 source cells and 55,123 operations, 54,963 of them products (ReGLU operations) and 160 sums, 15 operations deep. 44,616 of the products are the tokenizer's, because the class is a one-hot and the circuit holds the cells of all 33 classes: 858 products of a tokenizer state's share and a class, and 858 × 51 products with a cell's mixes.

`check-circuit.ts` fills every mix and the state with random shares, some of them exactly 0 in every other trial, picks a random class and gives every output a random gradient. It compares `evaluateReference` with the twin's `stepForward` on 143 values, and `backpropagateReference` with the twin's `stepBackward` on the gradients by all 52,993 mixes and shares of the state before, over 6 trials for a step at a code point and 2 for the step at position 512, which reads no object. The circuit computes in 32-bit floats and the twin in 64-bit floats: the largest difference of a value is 3.7e-7, and of a gradient 9.0e-7 of the larger of 1 and the gradient.

Not built: the whole run as one program. It would be this step once per code point, with the state after one step as the state before the next, and the loss at the end. A review measured two things that such a program has to deal with, with its own scripts, which are not rerun here:

- **The values drift slowly in 32-bit floats.** Over a run of 509 steps with the circuit's own state fed back, the total of the grammar state's shares fell from 1 to 0.9958, about with the square of the number of steps, and no share left the range 0 to 1. The largest difference from the 64-bit twin was 0.004. Dividing each part of the state by its total every so many steps would stop the drift.
- **The gradient by the state grows by about 1 per step on the way back**: from 1 at the last code point to about 500 at the first error, 509 steps earlier. The growth is in the direction "every share of a state up by the same amount", which the softmax removes, so the 64-bit trainer is right, and its gradient check passes on runs of that length. A 32-bit backward pass over a whole run would have to take the mean out of each state's gradient at every step.

## Files

- `twin.ts`: the twin. `createModel` (base tables, trainable cells, where the weights start), `mixesInto` (softmax), `createTwinRunner` with `stepForward`, `stepBackward` and `runSample`, `runBatch`, `objective` (the loss per code point plus the sharpness cost, with gradients by the weights), `snappedTables`. `LossTally` holds what a batch adds up, among it the code points at which a label is ruled out.
- `twin-data.ts`: `packForTwin` turns the core's arrays into what the twin reads, with the exact parser's state at every sample's first error. `placesForTwin` lists the broken samples of a split that give the twin a step. `loadIntendedObjects` makes and caches the intended stacks.
- `train.ts`: `train`, `createBatchRunner` for batches over worker threads, `randomTrainableCells`, and the command. A `TrainPoint` is what a log line holds. `train-worker.ts` is the worker thread.
- `step-circuit.ts`: `buildStepCircuit`, the step as a Handwired circuit.
- `check-twin.ts`, `check-gradient.ts`, `check-circuit.ts`, `check-train.ts`: the checks.
