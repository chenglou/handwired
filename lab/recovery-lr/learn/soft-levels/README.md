# The second twin: a mix of states per level of the stack

This folder holds a second twin for the training of the open cells of bison's table, behind the interface of [`../soft/twin.ts`](../soft/twin.ts). The reference twin of `../soft/` holds 48 whole stacks. This twin holds one share per state per level of the stack, with the top at level 0, which is the form of the design's point 6 and the one closest to the JSON side's twin: a fixed set of numbers, whatever the logits are. It was built to answer one question: **does a twin with one number per state and level train to the score of the reference twin?**

**No number here is a result.** Every run below is a smoke run: 10,000 train samples, three seeds, scored on the 5,000 validation samples only.

## The answer

The twin comes in two forms. They differ in one place: what the level under a pushed state holds.

- **The design's form**: every step is a sum of shifted copies of the stack, so the level under a pushed state holds the whole mix of the old top level. E.g. when the top is `stopped` with a share of 0.9 and another state with 0.1 inserts a `(`, the state under the `(` is `stopped` to 0.9, which no stack of the exact parser holds.
- **The variant `pusherBelow`**: the level under a pushed state holds the state that pushed it, with the weight of the push. Every other level is a shifted copy as before.

Row 9 of the recipe, training then the count, with each twin. All three / whole / stack on validation:

| twin | seed 1 | seed 2 | seed 3 | mean of all three |
| --- | --- | --- | --- | --- |
| the reference: 48 exact stacks | 80.32 / 31.24 / 71.88 | 78.51 / 29.44 / 72.50 | 78.31 / 30.22 / 72.22 | 79.05 |
| 192 exact stacks | 80.46 / 35.26 / 73.96 | 80.73 / 34.06 / 74.91 | 82.17 / 36.82 / 75.80 | 81.12 |
| 1,000 exact stacks | 78.64 / 32.14 / 69.90 | 79.15 / 33.28 / 72.71 | 80.93 / 34.60 / 74.18 | 79.57 |
| levels, the design's form | 77.99 / 28.48 / 69.79 | 78.49 / 28.90 / 69.51 | 77.89 / 28.72 / 69.35 | 78.12 |
| levels, the variant `pusherBelow` | 85.74 / 39.38 / 79.82 | 86.49 / 42.64 / 80.35 | 86.07 / 40.20 / 78.87 | 86.10 |
| row 11: the search and the count, without training | 86.61 / 42.92 / 80.50 | 86.28 / 41.44 / 81.05 | 87.31 / 44.12 / 79.39 | 86.73 |

For scale: the parser as it is has 2.02 / 0.00 / 0.14, and panic mode without knowledge of the language, with its count, has 60.83 / 27.44 / 56.40.

- **The design's form trains to the reference twin's score in all three, and under it in the stack column.** It is 0.9 points under the reference in all three on average, where the reference's own three seeds are 2.0 points apart, and 2.6 points under it in the stack column (69.6 against 72.2). It is 17 points above panic mode.
- **The variant trains 7 points above the reference twin**, in all three (86.1 against 79.0), in the stack column (79.7 against 72.2), and by 10 points in whole samples (40.7 against 30.3). It is level with the search (86.7), which the reference twin is 7.7 points under on this run.
- **More exact stacks do not close that gap**: 192 stacks reach 81.1 and 1,000 stacks 79.6.
- The same holds on the 10,000 train samples themselves, e.g. for seed 1: 81.52 / 32.94 for the reference, 78.90 / 29.77 for the design's form, 86.88 / 40.45 for the variant, 88.76 / 46.46 for the search. So no gap here is one of unseen data.

Both forms were written before the first training ran, and no setting of the twin was changed after a score was seen. The variant is not a rescue that was picked among several by its score: it is the only variant that was built. A second run of the variant with seed 1 saved the same tables, byte for byte.

## Why the design's form trains lower than the variant

At the start of the recipe's training, with 0.9 on the base's choice, on the 10,000 train samples (`compare-gradients.ts`):

| twin | loss per code point | labels without a share |
| --- | --- | --- |
| 48 exact stacks | 8.44 | 11.8% |
| 2,000 exact stacks | 5.56 | 3.0% |
| levels, the design's form | 11.34 | 0.3% |
| levels, the variant | 8.63 | 0.2% |

**The gradient of the design's form points the wrong way in a part of the most read cells.** For a cell, the exact parser's best change is the choice that raises the score most when only that cell is changed.

- The 40 trainable cells that the most samples read with the parser as it is are all of the state `stopped`, and the best change is "leave the state and read the token again" in all 40. The two twins of exact stacks and the variant favour it in all 40. The design's form favours it in 28 and has the gradient's sign wrong in 12.
- Of the 40 most read cells outside that row, 35 have a best change. Raising its logit lowers the twin's loss in all 35 cells for the two twins of exact stacks and for the variant, and in 28 for the design's form.
- The cosine between a cell's gradient in the variant and in the twin of 2,000 exact stacks is 1.00 on average in the row of `stopped` and 0.93 outside it. For the design's form it is 0.40 and 0.53. The two twins of exact stacks have 1.00 and 0.98 between them.
- Which choice a twin favours most is a weaker sign for every twin: outside the row of `stopped`, the twin of 48 stacks favours the best change in 28 of the 35 cells, the one of 2,000 stacks in 19, the variant in 14, and the design's form in 9.

**The risk that the design named is there in both forms, and is not what separates them.** A reduction of n states reads the state after its nonterminal off the mix at level n. At the start of a run, on 300 train samples, 46% of the weight of such reductions finds no state there and goes to `stopped` in the design's form, and 43% in the variant. In the exact parser it is 0% by the ground rule that every choice leaves the stack a path. In the third pass of the training it is 7.0% and 5.1%. A pop finds no state below for 12% of its weight in the design's form and for 2.4% in the variant.

## Why the variant trains above the exact stacks: what is measured, and a guess

Measured, after the third pass of seed 1:

| twin | the twin's own loss per code point | mean largest share of a mix | the twin reads as its snapped tables at | snapped tables, all three |
| --- | --- | --- | --- | --- |
| 48 exact stacks | 1.43 | 0.766 | 83.4% | 80.07 |
| 1,000 exact stacks | 0.77 | 0.759 | 82.9% | 78.39 |
| levels, the design's form | 1.50 | 0.828 | 70.2% | 77.90 |
| levels, the variant | 1.00 | 0.828 | 87.4% | 85.67 |

- The twin of 1,000 stacks has the lowest loss and not the best tables, and the tables of the twins of exact stacks move by up to 8 points from pass to pass while their loss falls, e.g. 73.4, 81.4 and 78.8 for 1,000 stacks with seed 2. So what limits them is the step from the mix to the snapped tables, not the mix.
- The mixes of both forms of this twin end closer to one choice, 0.83 against 0.76.
- A guess, not measured: with exact stacks, two choices of a cell give two stacks that both stay exact, so a cell that holds a half of each pays nothing later. In this twin a mix in a cell turns the levels that later steps read into mixes of states that do not belong together, which costs loss. So the loss itself pushes a cell towards one choice, which is what snapping needs.

## The twin

`levels-twin.ts`, `createTwin(layout, {leastLive, leastShare, pusherBelow})`.

- **The stack** is one share per state per level, for the 100 states and for as many levels as the exact parser's stack has states, 520. Within a token there are two stacks: the live part, which has not taken the token yet, and the part that has taken or skipped it.
- **One small step** is one step of the exact parser for the whole live part. The share of a state on the top level times the share of a choice in the state's cell is that choice's weight. The live part after the step is a sum of shifted copies of the live part before it: a push moves every level one down, a pop one up, a reduction of n states n - 1 up. The new top level holds the pushed states, the level below the top for a pop, and for a reduction the state after the nonterminal from every state of level n. A share without such a state goes to `stopped`.
- **A token ends** after 16 small steps, or when no more than `leastLive` of it is live, 0.001 as in the design. What is live then is skipped.
- **What a token shows**: the display kind from the top level of the stack that has taken the token, the container of the topmost level that starts one, and the depth from a mix of its own, a share per depth, which every choice moves by what it does to the depth.
- **The gradient** is the exact one of these numbers: a backward pass over the stacks of all small steps of a sample, which a run with a gradient keeps.

Where the twin leaves the design and its prototype (`twin-cost.ts` in the scratch folder of the transfer track):

- **520 levels in place of 64**, so that the limit of the stack is the exact parser's rule: the part of a push whose stack is full is a skip. To keep empty levels from costing time, a level whose shares add up to `leastShare` or less is cut off with every level below it, 1e-9 as the least weight of the reference twin. A small step holds 21 levels at the start of a run and about 30 during the training.
- **A reduction by an empty rule** pushes the state after its nonterminal from the state on top itself, as an insertion does. The prototype read it off the whole mix of the top level.
- **The variant `pusherBelow`**, above.

## Time

One pass over the 10,000 train samples on 4 worker threads:

| twin | first, second, third pass |
| --- | --- |
| 48 exact stacks | 1.5 s, 1.3 s, 1.3 s |
| 192 exact stacks | 5.3 s, 4.9 s, 5.0 s |
| 1,000 exact stacks | 26.7 s, 24.7 s, 25.3 s |
| levels, the design's form | 71 s, 50 s, 44 s |
| levels, the variant | 84 s, 45 s, 41 s |

So this twin is 30 to 60 times slower than the reference and two to three times slower than 1,000 exact stacks. By these numbers, three passes over 40,000 samples take about 11 minutes. At the start of a run one sample takes 5 ms without a gradient and 12 ms with one, in one thread, for 5.5 small steps per token on 21 levels. Every level is a full row of 100 shares, most of them 0: rows that list only the states with a share would be faster, and are not built.

## Checks

```sh
bun lab/recovery-lr/learn/soft-levels/check-all.ts   # 90 s, four commands at once
```

- **With exact tables the twin is the exact parser** (`../soft/check-twin.ts --twin`, for `levels-twin.ts` and for `pusher-below-twin.ts`). 16 tables without a trainable cell, 19,248 runs and 1,313,648 tokens: every share is exactly 0 or 1, at the display kind, the depth and the container of `../recovery-parser.ts`, with the loss of those outputs. 30,925 of the tokens are skipped after 16 steps and 56 at the limit of the stack, in three texts with almost 500 open brackets. The snapped twin is the exact parser of the snapped tables in 9,624 runs.
- **`check-twin.ts`**:
  - With mixes in display entries only the twin is still exact, and shows what the reference twin shows at 62,104 tokens, with its loss and its gradient to 8e-16.
  - With mixes in cells the shares that a token shows add up to 1: within 5e-13 for the display kinds and the containers, and within 5e-7 for the depths with the settings that train, where the ends of the mix of depths are cut off.
  - A run with a gradient has the loss of a run without one to the last digit.
- **`check-gradient.ts`**: the gradient against finite differences, in both forms.
  - Where the loss is smooth, i.e. without the cut at `leastLive`: 8 settings in 4 layouts with every cell and every open display entry trainable on random logits. Along 48 directions the largest difference is 1.1e-9 of the gradient's length, and for 192 single logits 4.0e-9 of the larger of 1 and the gradient. Every kind of choice has logits with a gradient.
  - With a `leastShare` of exactly 0 on 8 short samples: 1.6e-9.
  - On a text with 496 open brackets and logits that favour insertions, where 60 small steps have a share with a full stack: 6.9e-10.
  - With the settings that train: all 96 single logits are within 1e-4 at a step of 0.00001, the largest difference 9.4e-7, and 88 of 96 at a step of 0.001. The loss has small jumps where a token's live part crosses `leastLive`.
- **Faults**: 30 faults were put into a copy of the twin, one at a time, and each made a check fail: 11 the check against the exact parser (e.g. 17 small steps, no limit of the stack, no flag, a reduction that moves one level too many), 3 `check-twin.ts` (e.g. a pop without a state below that loses its share), and 16 `check-gradient.ts` (e.g. no gradient by the sum of the top level, by the level that a pop uncovers, by the full level).

## Commands

Run from the repo root with `RECOVERY_LR_SCRATCH` set to a folder outside the repo.

```sh
bun lab/recovery-lr/learn/soft-levels/smoke.ts --seed 1 --twins stacks,levels,levels-pusher-below   # 7 minutes
bun lab/recovery-lr/learn/soft-levels/compare-gradients.ts                                          # 2 minutes
bun lab/recovery-lr/learn/recipe.ts --seed 1 --rows 9 --twin lab/recovery-lr/learn/soft-levels/pusher-below-twin.ts
```

`smoke.ts` runs the steps of row 9 of `../recipe.ts` once per twin with the same seed and train samples, and prints the scores next to the parser as it is, panic mode and row 11. Its twins by name: `stacks`, `stacks-192`, `stacks-1000`, `levels`, `levels-pusher-below`. To train a row of the recipe with the variant from code: `rowsOfRecipe(seed, rows, {twin: {module: <path of levels-twin.ts>, options: {pusherBelow: 1}}})`.

## Files

- `levels-twin.ts`: the twin, `createTwin(layout, options)`. Its counters in a trainer's log: `tokens`, `smallSteps`, `levels` (added up over the small steps), `tokensAtStepLimit` and `shareAtStepLimit` (tokens with a live part after 16 small steps), `shareReduced` and `shareReducedToStopped`, `sharePopped` and `sharePoppedToStopped`, `stepsWithFullStack` and `shareWithFullStack`.
- `pusher-below-twin.ts`: the variant as a module of its own, for the commands that take a twin as a path.
- `check-twin.ts`, `check-gradient.ts`, `check-all.ts`: the checks.
- `smoke.ts`: the smoke run with several twins side by side.
- `compare-gradients.ts`: the twins' gradients at the start, cell by cell, against the exact parser's best change of a cell.
