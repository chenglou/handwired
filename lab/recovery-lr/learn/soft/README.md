# The twin for training, the trainer, and the recipe

This folder holds the part of the transfer experiment that trains the open cells of bison's table with gradients: the recovery parser of `../recovery-parser.ts` a second time, with a mix of choices in every trainable cell, a trainer with the settings of the JSON side, and their checks. The frozen recipe that uses them is `../recipe.ts`. The cells, the choices, the score, the search and the count are in [the folder above](../README.md).

**No number here is a result.** The runs below are one seed on at most 10,000 train samples, scored on validation only, to show that the pieces work.

## Logits, mixes and snapping

`model.ts`. A trainable cell has one logit per choice of its list (`choicesOf`, 2 to 37 choices), and its **mix** is the softmax of its logits: one share per choice, e.g. 0.9 for stop and 0.1 / 16 for each of 16 others. A trainable display entry has one logit per display kind, 11 of them. Every other cell and entry holds what the base tables hold.

- `createModel(base, options)` makes a `Model`: a `Layout` and the logits. By default every cell that may change is trainable (the open ones without the column of the end of input) and every open display entry. `trainable` takes masks, and `start` and `startShare` say where the logits start: by default 0.9 on the base's choice, i.e. on stop, on bison's default reduction, on skip in the row of `stopped`, and on the kind `error` in a display entry.
- A `Layout` says where the logits are: `cellOffset[cell]` and `displayOffset[entry]` are the place of the first logit, or -1 for what is not trainable, and `mixStart` lists the mixes one after another.
- `snappedTables(model)` gives tables again: every trainable cell and entry holds the choice with the largest logit, and among equal logits the base's choice.
- `sharesInto` is the softmax, `addLogitGradients` turns gradients by the shares into gradients by the logits, and `logitsOfTables(layout, tables)` gives logits of 0 and -Infinity that make every mix the choice of `tables`.

With the recipe's layout on 40,000 train samples, i.e. the flag and two added terminals, a model has 9,050 mixes, 5,102 of cells and 3,948 of display entries, and 128,456 logits.

## The interface of a twin

`twin.ts`. A twin is made once per thread for a layout, holds no logits, and has one function:

```ts
type Twin = {
  name: string
  run: (logits: Float64Array, samples: PackedSamples, places: ArrayLike<number>, tally: LossTally, gradient?: Float64Array | null, reading?: Reading | null) => void
}
type TwinFactory = (layout: Layout, options?: Record<string, number>) => Twin
```

- `run` runs the samples at `places` of `samples`, each from the stack at its first open cell to its last token, with the mix `softmax(logits)` in every trainable cell and entry. `logits` has `layout.logitCount` entries in the layout's order.
- It adds the samples' losses to `tally`, as sums: `loss`, `kindLoss`, `depthLoss`, `containerLoss`, `codePoints` (the scored code points, `samples.scored`), `samples`, `labelsWithoutShare`, and `counters`, which holds whatever the twin counts about its own work by name.
- With `gradient`, it adds the gradient of the summed loss by every logit to it. The caller clears it.
- With `reading`, `places` holds one sample, and the twin fills in what it shows per token: a share per display kind, per depth (0 to 520) and per container. With exact tables every share is exactly 0 or 1.
- The loss of a token is `-count × ln(share + 1e-6)` for each of the three labels of each group of its kept code points, where `share` is the twin's share of the label's value. White space and comments are shown as what they are, with the depth and the container of the stack as it is. The end of input takes no step: no label asks about it.

A twin is named by the path of a module that exports `createTwin`, a `TwinFactory`: `train(model, samples, {twin: {module, options}})`, `recipe.ts --twin <module>`, `check-twin.ts --twin <module>` and `check-gradient.ts --twin <module>`. `check-twin.ts --without-deep-texts` leaves out its three texts with almost 500 open brackets, for a twin that holds fewer levels of the stack. The first part of `check-gradient.ts` hands a twin the settings `{width: 2000, leastWeight: 0}`, which another twin ignores, and its second part allows for jumps that a twin without a cut does not have. The trainer's worker threads import the module themselves. For a twin that reads cells with a share: `choicesOf(base, cell)` is the list that a cell's logits follow, `effectOf(choice, state)` of `../recovery-tables.ts` says what a choice does to the stack and the token, and the rules of a run (16 steps per token, 520 states) are in `../score.ts`.

## The reference twin: a weighted set of exact stacks

`stacks-twin.ts`, after the prototype that the design's review built.

- The twin holds a set of stacks of states, each with a weight, and starts with the sample's stack at its first open cell, with the weight 1.
- A stack that reads a cell which is not trainable does what the cell holds. A stack that reads a trainable cell splits into one stack per choice, each with its parent's weight times the choice's share. So no goto is read off a mix: every stack is a path of the automaton.
- After every round of steps the heaviest 48 stacks are kept (`width`), and a new stack with a weight under 1e-9 is not made (`leastWeight`). When every stack has taken or skipped the token, the weights are divided by their sum.
- What it shows for a token is the mix of its stacks: the share of a depth is the weight of the stacks that have it, and the share of a kind is the same sum with each stack's display entry, which is a mix itself when the entry is trainable.
- The gradient is exact for the stacks that are kept. Every new stack is a node with its parent's node, the loss gives every stack a gradient by the logarithm of its weight, and one pass from the last node to the first adds them up.

What the twin is not:

- **Its loss has jumps.** Which stacks are kept changes with the logits, and the loss jumps where two stacks swap their places at the cut. A finite difference with a step of 0.001 crosses a jump for 26 of 160 logits in `check-gradient.ts`, and one with 0.00001 for none.
- **48 stacks leave labels without a share.** At the start of a run, 9.9% of the labels of 300 train samples have a share of exactly 0, so they cost 13.8 each and give no gradient. With 4,000 stacks it is 2.2%, and the loss per code point is 5.28 where 48 stacks have 7.67. During the smoke run below it falls from 4.6% in the first pass to 2.7% in the third.
- **Equal stacks are not merged.** Two stacks that are the same state by state stay two.
- **A mix that starts with 0.9 on a choice is not that choice**: before training the twin's largest shares are what the base tables give at 68.6% of the scored code points of 100 train samples.

**The width is a question of time, not of feasibility.** One pass over 10,000 train samples, with the flag, takes 1.4 s with 48 stacks, 5 s with 192 and 26 s with 1,000, on 4 worker threads. Only the width of 48 was scored: the other two were run for one pass without validation samples.

Not ported from the prototype: its option to merge equal stacks, which it left off. Changed: the weights are divided by their sum after every token, so that the least weight is a share of the kept weight at every token. On 4,000 train samples at the start of a run this keeps the same number of stacks and moves the loss per code point from 8.4699 to 8.4687.

## The trainer

`train.ts`, the trainer of the JSON side on the interface above: `train(model, packedSamples, options)` runs Adam over the logits and returns the snapped tables after the last sample.

| setting | value, as on the JSON side |
| --- | --- |
| batch | 32 samples |
| rate | 0.05 |
| Adam | decays 0.9 and 0.999, 1e-8 added to the root |
| gradient of a batch | divided by the batch's scored code points |
| order | drawn anew for every pass from the seed and the pass |
| threads | up to 4 worker threads, the parts of a batch added in the workers' order |

**The number of worker threads is part of what a seed means.** Two runs with the same seed and the same number of threads end with the same logits bit for bit. With another number of threads the parts of a batch's gradient are added in another order, the last digit differs, and a stack at the cut is kept or dropped by it: on 3,000 samples and three passes, the tables of 0 and 2 worker threads differ in 139 cells or entries, and the ones of 0 and 4 in 185. The recipe uses 4 unless its caller asks for another number, so the runs of a result have to keep one number.

Left out because the recipe never uses them: the temperature, the cost on a mix being far from one choice, the extra targets, keeping a run on track, and a "best" log point picked on half of the validation samples. The trainer cannot tell a train sample from a validation sample, since packed samples do not hold their split: the caller packs the train split.

A log line holds the loss per scored code point since the line before, the share of labels without a share, at how many code points of the first 100 trained samples the twin's largest shares are what the snapped tables give, the mean largest share of a mix, the twin's own counters, the score of the snapped tables on validation samples when the run has them, and how many cells and entries differ from the base. Only the score of snapped tables counts.

## The recipe

`../recipe.ts` holds the frozen recipe as `rowsOfRecipe(seed, rows, options)`, and its steps as functions: `prepareRecipe`, `trainedTables`, `searchedTables`, `countedTables`. The settings are those of the JSON side's candidate "generic" (`lab/recovery-parser/learn/arms/combined/combined.ts`), in `recipeSettings`, and none is tuned for this language.

| the JSON side | here |
| --- | --- |
| today's tables | the parser as it is, `baseTables()` |
| classes for the code points that a rule picks from the train samples: at least 100 samples, a distance of 0.5 or more | terminals of their own for the code points that the same rule with the same thresholds picks among the tokens that scan as BADCHAR. On 40,000 train samples it picks `\|` and `&`, on 10,000 only `&`, on 3,000 none: the threshold of 100 samples is not scaled to a smaller set |
| open display entries | nothing to do: every entry that no shift reads is open |
| the bit "first on its line" | the flag, a second copy of every cell |
| three passes from 0.9 on the base's choice, rate 0.05 | the same numbers, on the twin of this folder |
| kept: the cells of too deep valid JSON, and no event of a text's end | kept: the column of the end of input. The scanner is frozen, so the second has no counterpart |
| 4 passes of the search over the same cells, in a random order of seed × 10 + 1 | the same |
| every open display entry by a count over the train samples | the same |
| today's kinds in the display entries of the state `error` | no counterpart: no valid program reads an open cell or an open display entry |

The rows: 9 is training then the count, 10 the same with the search before the count, 11 the search and the count without training, 12 is row 9 on tables without "end an item early". Rows 9 and 10 share one training. A seed draws the order of the samples in every pass and the order of the search, and nothing else.

What has no JSON setting to carry over: the JSON twin held a share per depth from -8 to 24 and 16 levels of stack. The reference twin holds exact stacks, so it has no such range. Its 48 stacks and its least weight are the prototype's and were not tuned.

## Checks

Run from the repo root with `RECOVERY_LR_SCRATCH` set. Each ends with "Every check passed." or a count of problems. `../check-all.ts` type-checks and lints this folder and runs these three after its own checks.

```sh
bun lab/recovery-lr/learn/soft/check-twin.ts      # 10 s
bun lab/recovery-lr/learn/soft/check-gradient.ts  # 20 s
bun lab/recovery-lr/learn/soft/check-train.ts     # 10 s
```

**`check-twin.ts`: with exact tables the twin is the exact parser.**

- No trainable cell, 16 tables: the parser as it is, skip, pop, tables that insert a `(` wherever a cell can, and 12 random settings of every open cell and entry in 4 layouts (with and without the flag, added terminals, "end an item early"). On 1,200 train samples and three texts with almost 500 open brackets, 19,248 runs with 1,313,648 tokens: at every token the twin's shares are exactly 0 and 1, with the 1 at the kind, the depth and the container that `recovery-parser.ts` gives for the whole text, and the twin's loss is the loss of those outputs counted code point by code point. 30,925 of the tokens are skipped after 16 steps and 56 at the limit of the stack.
- The snapped twin: 8 models with random logits are snapped, and the twin is handed the snapped choices as logits of 0 and -Infinity. It is the exact parser of the snapped tables in 9,624 runs. So a logit's place in a mix means the same choice to the twin and to the snapping. A model at its start snaps to its base.
- The selection of the 48 heaviest stacks against a sort, 4,000 times, and the weight that the kept stacks hold at the start of a run: 95.5% at a token.

**`check-gradient.ts`: the gradient against finite differences.**

- Where the loss is smooth, i.e. with a width that holds every stack and a least weight of 0: 8 settings in 4 layouts, on tables with a random choice in every open cell, a random twentieth of the cells and every open display entry trainable, 16 samples each whose runs split and drop no stack. Along 96 random directions the largest difference is 5.3e-9 of the gradient's length, and for 537 single logits 1.0e-7 of the larger of 1 and the gradient. Every kind of choice has logits with a gradient. With every cell trainable no width holds every stack, which is why only a part is.
- With the settings that train, 48 stacks and every cell trainable: with a step of 0.00001, all 160 single logits are within 1e-4 of finite differences, the largest difference 1.6e-6. With a step of 0.001 it is 134 of 160, and along a direction that moves every logit by 0.0001 the difference is up to 19 times the gradient's length. Both are jumps of the loss.

**`check-train.ts`: the trainer and the recipe on small sets.** The gradient of a batch of 96 samples from 4 worker threads is the gradient from one thread up to 1.5e-11 on a largest gradient of 5.1e3. Two runs with the same seed end with the same 119,392 logits bit for bit, and another seed with other logits. Four passes over 400 samples lower the loss per code point from 6.53 to 2.37 and raise all three of the snapped tables on 300 validation samples from 2.0 to 48.2. With a tenth of the cells trainable nothing else changes. A model without a trainable cell, samples packed for other added terminals, a place outside the samples, 5 workers and a twin's module that is not there are errors. The recipe on 500 train samples gives four rows that keep the ground rules and the cells of the end of input, row 12 has no choice "end an item early", the count changes no cell, row 11 is the search and the count made step by step, and a second run with the same seed gives the same tables.

To see that the checks can fail, 15 faults were put into a copy of the twin and 6 into the trainer and the recipe, one at a time, and each made a check fail. In the twin, e.g.: the display entry of the state before for a token read as another one, 17 steps, no limit of the stack, no flag, white space with a kind of the stacks, no gradient to a parent's node, none to a display entry, the container's loss with the depth's scale, the lightest stacks kept. In the trainer and the recipe: a step up the gradient, a worker that gets one sample too few, an order that ignores the seed, snapping to the smallest logit, another order of the search, row 12 with "end an item early". The first version of `check-twin.ts` missed two of them, the limit of the stack and the lightest stacks kept, and got the three deep texts and the kept weight for them.

## A smoke run

```sh
bun lab/recovery-lr/learn/recipe.ts --seed 1 --rows 9,11 --train 10000 --name smoke
```

Seed 1, the first 10,000 train samples, scored on the 5,000 validation samples. The rule picks `&`, so 4,902 cells may change. It took 16 s in all: 9 s to make and pack the samples, 1.4 to 1.6 s per pass of the training (6,900 samples per second on 4 worker threads), and 2 s for the search. One pass over the 40,000 train samples takes 5 s.

| tables | all three | whole | stack | constituents found, right, without the ones before the first error | inserted per sample |
| --- | --- | --- | --- | --- | --- |
| the parser as it is | 2.02 | 0.00 | 0.14 | 1.0, 40.0 | 0.00 |
| the training, snapped, before the count | 80.07 | 28.90 | 71.88 | 84.7, 93.2 | 1.24 |
| row 9: training, then the count | 80.32 | 31.24 | 71.88 | 84.7, 93.2 | 1.24 |
| row 11: the search and the count, without training | 86.61 | 42.92 | 80.50 | 93.1, 95.4 | 1.30 |

- **The training alone is 6.3 points of all three below the search without training**, with a quarter of the full train set, where the JSON side had the two level on its full set. The gap is there on the 10,000 train samples themselves: row 9 has 81.52 / 32.94 on them and row 11 has 88.76 / 46.46, so the training's tables fit their own samples less well, and the gap is not one of unseen data. After the three passes the mixes are not yet close to one choice: the mean largest share is 0.77, and the twin's largest shares are what its snapped tables give at 83% of the code points. In a cell of 17 choices the logit of the base's choice starts 5 above the others and a step of Adam moves a logit by about 0.05, so a cell changes after 50 batches that read it at the earliest, and 10,000 samples give 938 batches where the full set gives 3,750.
- **The loss per code point** falls from 2.48 in the first pass to 1.59 and 1.43, and the snapped tables on validation have 77.29, 77.49 and 80.07 after the three passes. The twin keeps 46 to 47 stacks per token, which hold 95% to 97% of the weight.
- **Two runs of this command gave 79.97 and 80.32** for row 9, before and after a change of the twin that only moved its rounding (the shares divided by a sum that is 1). So tables of one seed depend on the last digit of the arithmetic, and a difference of a few tenths between two runs says nothing.
- **Row 9 changed 918 cells and 1,744 display entries.** Its most read cells on validation, with the samples that read them and the reads:

```
1347  3320  in the state stopped, at a name: skip the token (as the parser as it is)
 794  9487  at the start of the text, at a name: put empty definitions on the stack, which bison does by default (as the parser as it is)
 794  9370  after `program`, in a $accept, at a name: drop the `program` on top of the stack (the parser as it is: stop)
 794  9693  after `definitions`, a complete program, at a name: reduce `definitions` to a program, which bison does by default (as the parser as it is)
 724  2254  in the state stopped, at `)`: leave the state stopped and read the token again (the parser as it is: skip the token)
 712   764  after `let`, in a definition, at `)`: read the token as `(` (the parser as it is: stop)
 690   741  after `definitions`, a complete program, at `)`: insert `let` (the parser as it is: reduce `definitions` to a program, which bison does by default)
 409   415  after `(`, in a binding, at `let` that is the first on its line: end the binding early, as `(` without `) = expression` (the parser as it is: stop)
 353   361  after `let binding`, in an expression, at `let` that is the first on its line: end the expression early, as `let binding` without `in expression` (the parser as it is: stop)
 348  5118  after `definitions`, a complete program, at `in`: end the definitions early, as `definitions` without `definition` (the parser as it is: reduce `definitions` to a program, which bison does by default)
```

- **Trained tables skip a token by going in a circle.** The second to fourth lines are one circle: at a name between two definitions, the parser puts empty definitions on the stack, reduces them to a program, drops the program, and is where it was, until the 16 steps are used up and the token is skipped. The last line is a circle of one cell. 7,966 validation tokens are skipped after 16 steps with row 9's tables, and 840 with row 11's, whose 30 most read cells hold no such circle.

The files of the run are in `<RECOVERY_LR_SCRATCH>/learn/recipe/smoke`: the tables of both rows, `log.txt`, and a report per row with 30 cells and 30 display entries.

## Files

- `model.ts`: `Layout`, `Model`, `createModel`, `sharesInto`, `addLogitGradients`, `snappedTables`, `logitsOfTables`, `meanLargestShare`.
- `twin.ts`: the interface: `Twin`, `TwinFactory`, `TwinChoice`, `LossTally`, `Reading`, `loadTwin`, `referenceTwin`, `lossFloor`.
- `stacks-twin.ts`: the reference twin, `createTwin(layout, {width, leastWeight})`.
- `train.ts`: `train`, `createBatchRunner`, and a command that trains the parser as it is. `train-worker.ts` is its worker thread.
- `check-twin.ts`, `check-gradient.ts`, `check-train.ts`: the checks.
- `../recipe.ts`: the recipe and its command.
