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
7. **What is shown.** The display kind's mix is the sum over (event, next grammar state) of the product of the two shares, put on the kind that the display table has for the pair. The container after is "none" with the share of the depths 0 and below, and "an object" with the sum over the depths above 0 of (the depth's share after) × (the share of "an object" at its level after).

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
- **Extra targets from `../intended.ts`** (`intendedLexerWeight`, `intendedEventWeight`, `intendedGrammarWeight`): the cross-entropy of the tokenizer state after a kept code point, of its event, and of the grammar state after it, against the states that today's parser has at the code point's counterpart in the original. They are left out at code points whose display kind is not scored, e.g. a quote that lost its backslash, whose intended event is `escape`.
- **Keeping the run on track** (`onTrackProbability`): after a kept code point, with this probability, the twin's whole state is replaced by the intended state. Gradients do not cross a replaced state. A code point that the damage added has no intended state, so with probability 1 gradients cross the stretches of added code points and nothing else, and with a lower probability also longer stretches. The state includes the kind of every open level, which the core's arrays do not have, so `twin-data.ts` makes the intended stacks from the samples themselves and keeps them in a cache file. Making them takes about half a minute once.
- **A temperature** (`temperature`): a trainable mix is softmax(weights / temperature), so a temperature below 1 makes every mix closer to one choice.
- **A cost on a mix being far from one choice** (`sharpnessCost`): the weight of the mean entropy of the trainable mixes. A mix's entropy is 0 for one choice and ln(8) = 2.08 for a uniform mix over the 8 next states of a grammar cell.

The backward pass is written by hand in `stepBackward`, in the order of the step's parts from last to first.

## Snapping

`snappedTables(model)` returns tables in which every trainable cell holds the choice with the largest weight. Among equal weights it keeps the base tables' choice, e.g. in a cell that started uniform and that no training sample read. `saveTables` of the core writes them as JSON, which `../score.ts --tables` reads.

## Training

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/soft/train.ts --name smoke --train-samples 400 --epochs 50 --log-every 4000
bun lab/recovery-parser/learn/score.ts --tables $RECOVERY_SCRATCH/soft/runs/smoke/best.json --cells
```

`train.ts` runs Adam over the weights of the trainable cells, in batches of 32 samples, split over up to 4 worker threads. It writes `log.txt`, `best.json` and `last.json` to `<scratch>/soft/runs/<name>`: the snapped tables with the best score on the validation split, and the ones after the last sample. It never reads the test split. Its options:

| Option | Default | Meaning |
| --- | --- | --- |
| `--train-samples` | all | the first so many train samples that give the twin a step |
| `--epochs` | 1 | passes over those samples |
| `--batch` | 32 | samples per step of Adam |
| `--learning-rate` | 0.05 | |
| `--seed` | 1 | the order of the samples, the draws that keep a run on track, and which cells `--open-share` picks |
| `--workers` | 4 | worker threads, or 0 to run in the main thread |
| `--start` | `base` | `base`: every trainable mix starts with `--start-share` (0.9) on today's choice. `uniform`: every choice starts with the same share |
| `--open-share` | 1 | the share of the open cells that are trainable, picked at random, e.g. 0.1 for a tenth |
| `--intended` | 0 | one weight for the three extra targets |
| `--on-track` | 0 | the probability of keeping the run on track after a kept code point |
| `--temperature`, `--temperature-end` | 1 | the temperature at the first and at the last sample |
| `--sharpness-cost` | 0 | the weight of the cost on a mix being far from one choice |
| `--log-every` | 2000 | samples between two log lines |

A log line has the loss per labeled code point since the line before, with its parts, the mean entropy and the mean largest share of the trainable mixes, the score of the snapped tables on the validation split in the exact parser, the number of cells in which they differ from the base tables, and the samples per second.

An arm calls the same parts from its own script, e.g. with hand-written recovery as the base tables and its holes as the trainable cells:

```ts
import {loadStandardSamples, splitNames, validationPart} from '../data.ts'
import {asIsTables, saveTables} from '../recovery-tables.ts'
import {train} from './train.ts'
import {packForTwin, placesForTwin} from './twin-data.ts'
import {createModel} from './twin.ts'

const samples = loadStandardSamples()
const data = packForTwin(samples, placesForTwin(samples, splitNames.indexOf('train')))
const base = asIsTables()
// The masks say which cells are trainable. Here: every open grammar cell and no tokenizer cell.
const model = createModel(base, {trainable: {lexer: new Uint8Array(base.lexerOpen.length), grammar: base.grammarOpen}, start: 'base'})
const everySample = Int32Array.from({length: data.sampleCount}, (_, place) => place)
const result = await train(model, data, everySample, {epochs: 1, validation: validationPart(samples), sharpnessCost: 0.01})
saveTables(`${process.env['RECOVERY_SCRATCH']}/grammar-only.json`, result.best, 'grammar cells only')
```

Keeping the run on track also needs the third argument of `packForTwin`: `loadIntendedObjects(samples, softCacheFolderOf())`.

Speed on the machine of these runs, an 18 core machine with other jobs running: 515 samples per second in one thread and 1,380 with 4 worker threads, at the start of a run from today's choices. The runs below that keep the state on track with probability 0.5 ran at 4,800 and 5,300 samples per second, since most of their shares are 0 and a step skips them.

## Checks

Each check is a script that ends with "Every check passed." or with a count of failures. Run them from the repo root with `RECOVERY_SCRATCH` set.

**`bun lab/recovery-parser/learn/soft/check-twin.ts`** (about 30 s): the twin with exact tables is the exact parser. For 2,500 broken samples of the train split, with today's tables and with 20 random settings of every open cell, 5 of them with added states, the twin runs from the first error to position 512 and every share has to be exactly 0 or 1 and equal to the trace of `recovery-parser.ts`: the tokenizer state after, the event, the token, the context, the grammar state after, the stack action, the display kind, the depth after and the container after.

- Today's tables: 2,500 runs, 1,025,774 positions, 0 runs differ. No run reaches an end of the depths -8 to 24.
- Random settings: 50,000 runs, 20,515,480 positions, 0 runs differ when the twin's depth range holds the depths that the exact parser reaches in the run. With the depths -8 to 24, 14,075 runs differ, all of them among the 14,339 runs that reach an end of that range.
- The intended stacks of `twin-data.ts` are the exact parser's stack after every code point of 2,182 original documents, 515,245 code points.

**`bun lab/recovery-parser/learn/soft/check-gradient.ts`** (about 15 s, and half a minute more the first time, for the intended stacks): the backward pass against finite differences on random mixes. Every open cell is trainable with random weights. There are 4 settings: the three losses alone; every option on; a depth range of -1 to 17, so that shares reach its ends; sharp mixes with the run kept on track. Each uses 24 samples with 1,264 steps. Per setting and group of weights, the check compares 6 random directions, each of which moves every weight of the group, and about 60 single weights. The largest differences over the 4 settings:

| Group of weights | 24 directions, relative | 240 single weights, absolute | single weights with a gradient of at least 1e-4, relative |
| --- | --- | --- | --- |
| tokenizer, next state | 1.3e-7 | 5.7e-11 | 2.5e-7 |
| tokenizer, event | 1.0e-7 | 2.2e-11 | 3.4e-8 |
| grammar, next state | 1.3e-8 | 2.5e-11 | 1.1e-7 |
| grammar, stack action | 7.5e-9 | 2.9e-11 | 1.1e-7 |

The largest relative difference is 2.5e-7. A direction's difference is divided by the length of the group's gradient. For single weights with a gradient below 1e-4 only the absolute difference is reported: the objective holds terms -ln(share + 1e-6), in which a rounding error of 1e-16 in a share near 0 is an error of 1e-10, so a finite difference of the objective cannot resolve a small gradient to many digits.

**`bun lab/recovery-parser/learn/soft/check-circuit.ts`** (under 1 s): one step of the twin as a Handwired circuit, see [below](#the-step-as-a-handwired-circuit).

**`bun lab/recovery-parser/learn/soft/check-train.ts`** (1 s): the trainer's parts. The gradients of a batch of 96 samples from 4 worker threads are the gradients from one thread, up to 8e-5 on a largest gradient of 1.9e10. Two runs with the same seed end with the same 52,910 weights bit for bit, and another seed with other weights. A model at its start snaps to the base tables, and a trained model's snapped tables keep the ground rules and are the same after saving and loading. With a tenth of the open cells trainable, no weight of another cell moves and no other cell changes.

To see that the checks can fail, `twin.ts` was broken in five ways, one at a time: level l written by a push at depth l instead of l - 1, no gradient from the context to the levels' kinds, no gradient to the pop that stays at the lowest depth, half the gradient from the display kind to the event, and `by token` reading the gradient of the wrong action. `check-twin.ts` failed for the first, which changes the step itself, and `check-gradient.ts` and `check-circuit.ts` failed for all five.

## A smoke run

These runs only show that the loss falls and that snapped tables can be scored. Nothing was tuned, each setting ran once with seed 1, and the dataset is a snapshot under review, so they are no result of the experiment.

400 train samples, 50 passes, 20,000 samples, about 15 s per run. The score is of the snapped tables in the exact parser on the validation split, 5,203 broken samples: the percentage of labeled code points from the first damage on with all three labels right. Today's tables have 40.8%.

| Run | Loss per code point, first 4,000 samples | Loss, last 4,000 samples | Best all three | Cells changed |
| --- | --- | --- | --- | --- |
| defaults: start at today's choices, every open cell trainable | 1.23 | 0.099 | 92.5% | 892 |
| `--start uniform` | 2.09 | 0.096 | 92.9% | 1,161 |
| `--intended 0.3 --on-track 0.5 --temperature 1 --temperature-end 0.5 --sharpness-cost 0.01` | 0.60 | 0.51 | 77.3% | 255 |
| `--open-share 0.1`: 127 of the 1,326 open cells | 8.49 | 8.15 | 50.7% | 54 |

The losses of the third run hold the extra targets. The loss of the fourth run stays high. Its other cells hold today's choice as exact 0 and 1, so a label that they give a share of 0 costs 13.8 whatever the trainable cells hold, but how much of the loss that explains was not measured. For the default run, `score.ts` gives the same numbers from `best.json` as the trainer's log: all three 92.5%, display kind 96.6%, depth 95.2%, container 98.6%, whole samples 65.8%.

One pass over all 38,119 train samples that give the twin a step takes about 30 s with 4 worker threads. In the same four settings its best snapped tables had 95.2%, 95.3%, 84.3% and 51.6% of all three right on the validation split.

## The step as a Handwired circuit

`step-circuit.ts` builds one step with the repo's runtime, `src/runtime/numeric-ui-core.ts`: the cells' mixes, the state before the step and a one-hot of the code point's class are source cells, a product of two shares is `circuit.multiply`, and a sum is `circuit.affine`. So the step is a program that Handwired can express, and not a separate model. The softmax that turns weights into mixes is not in the circuit: the mixes are its inputs.

The circuit has the full size: 53,026 source cells and 55,123 operations, 54,963 of them products (ReGLU operations) and 160 sums, 15 operations deep. 44,616 of the products are the tokenizer's, because the class is a one-hot and the circuit holds the cells of all 33 classes: 858 products of a tokenizer state's share and a class, and 858 × 51 products with a cell's mixes.

`check-circuit.ts` fills every mix and the state with random shares, some of them exactly 0 in every other trial, picks a random class and gives every output a random gradient. It compares `evaluateReference` with the twin's `stepForward` on 143 values, and `backpropagateReference` with the twin's `stepBackward` on the gradients by all 52,993 mixes and shares of the state before, over 6 trials for a step at a code point and 2 for the step at position 512, which reads no object. The circuit computes in 32-bit floats and the twin in 64-bit floats: the largest difference of a value is 3.7e-7, and of a gradient 9.0e-7 of the larger of 1 and the gradient.

Not built: the whole run as one program. It would be this step once per code point, with the state after one step as the state before the next, and the loss at the end.

## Files

- `twin.ts`: the twin. `createModel` (base tables, trainable cells, where the weights start), `mixesInto` (softmax), `createTwinRunner` with `stepForward`, `stepBackward` and `runSample`, `runBatch`, `objective` (the loss per code point plus the sharpness cost, with gradients by the weights), `snappedTables`.
- `twin-data.ts`: `packForTwin` turns the core's arrays into what the twin reads, with the exact parser's state at every sample's first error. `placesForTwin` lists the broken samples of a split that give the twin a step. `loadIntendedObjects` makes and caches the intended stacks.
- `train.ts`: `train`, `createBatchRunner` for batches over worker threads, `randomTrainableCells`, and the command. `train-worker.ts` is the worker thread.
- `step-circuit.ts`: `buildStepCircuit`, the step as a Handwired circuit.
- `check-twin.ts`, `check-gradient.ts`, `check-circuit.ts`, `check-train.ts`: the checks.
