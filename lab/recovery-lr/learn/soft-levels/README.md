# The second twin: a mix of states per level of the stack

This folder holds a second twin for the training of the open cells of bison's table, behind the interface of [`../soft/twin.ts`](../soft/twin.ts). The reference twin of `../soft/` holds 48 whole stacks. This twin holds one share per state per level of the stack, with the top at level 0, which is the form of the design's point 6 and the one closest to the JSON side's twin: a fixed set of numbers, whatever the logits are. It was built to answer one question: **does a twin with one number per state and level train to the score of the reference twin?**

**No number here is a result.** Every run below is a smoke run with the recipe's settings, scored on the 5,000 validation samples only: three seeds on 10,000 train samples, and one seed on the full 40,000.

## The answer

The twin comes in two forms. They differ in one place: what the level under a pushed state holds.

- **The design's form**: every step is a sum of shifted copies of the stack, so the level under a pushed state holds the whole mix of the old top level. E.g. when the top is `stopped` with a share of 0.9 and another state with 0.1 inserts a `(`, the state under the `(` is `stopped` to 0.9, which no stack of the exact parser holds.
- **The variant `pusherBelow`**: the level under a pushed state holds the state that pushed it, with the weight of the push. Every other level is a shifted copy as before.

Row 9 of the recipe, training then the count, with each twin on 10,000 train samples. All three / whole / stack on validation:

| twin | seed 1 | seed 2 | seed 3 | mean of all three |
| --- | --- | --- | --- | --- |
| the reference: 48 exact stacks | 80.32 / 31.24 / 71.88 | 78.51 / 29.44 / 72.50 | 78.31 / 30.22 / 72.22 | 79.05 |
| 192 exact stacks | 80.46 / 35.26 / 73.96 | 80.73 / 34.06 / 74.91 | 82.17 / 36.82 / 75.80 | 81.12 |
| 1,000 exact stacks | 78.64 / 32.14 / 69.90 | 79.15 / 33.28 / 72.71 | 80.93 / 34.60 / 74.18 | 79.57 |
| levels, the design's form | 78.12 / 28.42 / 69.90 | 78.99 / 28.92 / 69.49 | 77.97 / 28.74 / 69.35 | 78.36 |
| levels, the variant `pusherBelow` | 85.74 / 39.38 / 79.82 | 86.49 / 42.64 / 80.35 | 86.07 / 40.20 / 78.87 | 86.10 |
| row 11: the search and the count, without training | 86.61 / 42.92 / 80.50 | 86.28 / 41.44 / 81.05 | 87.31 / 44.12 / 79.39 | 86.73 |

For scale: the parser as it is has 2.02 / 0.00 / 0.14, and panic mode without knowledge of the language, with its count, has 60.83 / 27.44 / 56.40.

The same once on the full 40,000 train samples, seed 1:

| twin | all three / whole / stack | all three of the snapped tables after the first, second and third pass, before the count |
| --- | --- | --- |
| the reference: 48 exact stacks | 84.25 / 37.78 / 75.55 | 82.34, 85.04, 84.18 |
| levels, the design's form | 81.16 / 30.34 / 71.49 | 78.95, 80.07, 81.09 |
| levels, the variant `pusherBelow` | 86.06 / 41.88 / 79.37 | 86.05, 85.96, 85.94 |
| row 11: the search and the count, without training | 87.45 / 46.18 / 79.07 | |

- **The design's form trains to the reference twin's score on 10,000 samples and stays under it on 40,000.** On 10,000 samples it is 0.7 points under the reference in all three on average, where the reference's own three seeds are 2.0 points apart, and 2.6 points under it in the stack column (69.6 against 72.2). On 40,000 samples it is 3.1 points under it in all three and 4.1 in the stack column. It is 17 to 20 points above panic mode.
- **The variant trains above the reference twin**: by 7.0 points in all three on 10,000 samples (86.1 against 79.0), where it is level with the search (86.7), and by 1.8 points on 40,000, with 3.8 points more in the stack column and 4.1 more whole samples. The variant has its score early and gains nothing from four times the samples: 83.9 after one pass over 10,000 samples, 86.05 after one pass over 40,000, 85.94 after three. The reference twin gains 3.9 points from them.
- **More exact stacks do not close the gap on 10,000 samples**: 192 stacks reach 81.1 and 1,000 stacks 79.6.
- The same order holds on the train samples themselves. On the 10,000 of seed 1: 81.52 / 32.94 for the reference, 79.03 / 29.84 for the design's form, 86.88 / 40.45 for the variant, 88.76 / 46.46 for the search. On the 40,000: 85.37 / 39.72, 81.86 / 31.40, 86.86 / 42.80 and 88.59 / 47.87. So no gap here is one of unseen data.

Both forms were written before the first training ran. The variant is not a rescue that was picked among several by its score: it is the only variant that was built. One thing was changed after a run, and it is no setting: the first training of the design's form on 40,000 samples ended with a loss that is no number, see the next section, and the step that caused it was corrected. Every number here is of the corrected twin. A second run of the variant with seed 1 saved the same tables, byte for byte.

## The twin does not follow one stack for long

`follow.ts`. Take tables that skip every rejected token, so that the exact parser goes on through the whole text, and put all but a small share of every mix on the tables' choice. The share that a twin gives to what the exact parser of those tables shows, by the token's place from the first error on, on 400 train samples:

| off the tables' choice | twin | 0 to 4 | 5 to 9 | 10 to 19 | 20 to 39 | 40 to 79 | from 80 on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.001 | 48 exact stacks | 0.998 | 0.998 | 0.998 | 0.998 | 0.998 | 0.997 |
| 0.001 | levels, the design's form | 0.989 | 0.888 | 0.591 | 0.502 | 0.461 | 0.474 |
| 0.001 | levels, the variant | 0.990 | 0.930 | 0.664 | 0.509 | 0.462 | 0.473 |
| 1e-9 | 48 exact stacks | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 |
| 1e-9 | levels, the design's form | 1.000 | 1.000 | 0.997 | 0.754 | 0.548 | 0.557 |
| 1e-9 | levels, the variant | 1.000 | 1.000 | 1.000 | 0.866 | 0.574 | 0.566 |

**This is the risk that the design named first, measured, and both forms have it.** A reduction of n states reads the state after its nonterminal off the mix at level n, and multiplies the share of the state on top with the share of the state at that level, as if the two did not belong to the same stack. So when all but a share of 0.001 is one stack, a reduction keeps 0.999 × 0.999 of it, and what is off that stack grows with every reduction: with one part in a billion off the tables' choice, the twin gives what the exact parser shows a share of 0.55 from the 40th token on. A twin of whole stacks keeps a stack's weight as it is.

- So the twin's loss at a token that is far from the first error says little about the tables, and what trains the tables are the first tokens after an error.
- **The same growth made a training fail.** Where no stack is short, a reduction sends what is left of the mass to `stopped`, and rounding made that 1e-16 below 0. A negative share grows like any other share that is off the stack, and nothing stops it at 0: in the first pass of the design's form over 40,000 samples it grew from 1e-16 to 1 within 140 small steps of one sample of 70 tokens, and the loss was no number from there on. The twin now takes 0 where rounding leaves less than 0. With mixes that are all but 1e-15 one choice, `check-twin.ts` finds a token's shares adding up to 1e140 in the design's form of the twin as it was and to 1e68 in the variant, and to 1 now.
- At the start of a run, on 300 train samples, 46% of the weight of the reductions that drop a state finds no state after the nonterminal at its level and goes to `stopped` in the design's form, and 43% in the variant. In the exact parser it is 0%, by the ground rule that every choice leaves the stack a path. In the third pass of a training on 10,000 samples it is 7.0% and 5.1%.

## What separates the two forms: the gradient at the start

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

## Why the variant trains above the exact stacks: what is measured, and a guess

Measured, after the third pass of seed 1 on 10,000 samples:

| twin | the twin's own loss per code point | mean largest share of a mix | the twin reads as its snapped tables at | snapped tables, all three |
| --- | --- | --- | --- | --- |
| 48 exact stacks | 1.43 | 0.766 | 83.4% | 80.07 |
| 1,000 exact stacks | 0.77 | 0.759 | 82.9% | 78.39 |
| levels, the design's form | 1.50 | 0.827 | 70.7% | 78.03 |
| levels, the variant | 1.00 | 0.828 | 87.4% | 85.67 |

- The twin of 1,000 stacks has the lowest loss and not the best tables, and the tables of the twins of exact stacks move by up to 8 points from pass to pass while their loss falls, e.g. 73.4, 81.4 and 78.8 for 1,000 stacks with seed 2. So what limits them is the step from the mix to the snapped tables, not the mix.
- The mixes of both forms of this twin end closer to one choice, 0.83 against 0.76 on 10,000 samples and 0.87 against 0.79 on 40,000.
- A guess, not measured: with exact stacks, two choices of a cell give two stacks that both stay exact, so a cell that holds a half of each pays nothing later. In this twin a share that is off the main stack grows, as the section above shows, which costs loss. So the loss itself pushes a cell towards one choice, which is what snapping needs.

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

Not built: a reduction that reads the state after its nonterminal only off the states of its level that have one, each with its share among them. It would keep the share of the state on top whole where the level also holds states of other stacks, and so slow the growth of the section above.

## Time

One pass on 4 worker threads:

| twin | 10,000 samples: first, second, third pass | 40,000 samples |
| --- | --- | --- |
| 48 exact stacks | 1.4 s, 1.2 s, 1.1 s | 4.6 s, 4.5 s, 4.6 s |
| 192 exact stacks | 5.3 s, 4.9 s, 5.0 s | |
| 1,000 exact stacks | 26.7 s, 24.7 s, 25.3 s | |
| levels, the design's form | 65 s, 47 s, 42 s | 190 s, 147 s, 136 s |
| levels, the variant | 78 s, 40 s, 36 s | 191 s, 140 s, 126 s |

So this twin is 30 to 60 times slower than the reference and two to three times slower than 1,000 exact stacks: three passes over 40,000 samples take 8 minutes where the reference takes 14 s. At the start of a run one sample takes 5 ms without a gradient and 12 ms with one, in one thread, for 5.5 small steps per token on 21 levels. Every level is a full row of 100 shares, most of them 0: rows that list only the states with a share would be faster, and are not built.

## Checks

```sh
bun lab/recovery-lr/learn/soft-levels/check-all.ts   # 90 s, four commands at once, one thread each. ../check-all.ts runs the same four one after another
```

- **With exact tables the twin is the exact parser** (`../soft/check-twin.ts --twin`, for `levels-twin.ts` and for `pusher-below-twin.ts`). 16 tables without a trainable cell, 19,248 runs and 1,313,648 tokens: every share is exactly 0 or 1, at the display kind, the depth and the container of `../recovery-parser.ts`, with the loss of those outputs. 30,925 of the tokens are skipped after 16 steps and 56 at the limit of the stack, in three texts with almost 500 open brackets. The snapped twin is the exact parser of the snapped tables in 9,624 runs.
- **`check-twin.ts`**:
  - With mixes in display entries only the twin is still exact, and shows what the reference twin shows at 62,104 tokens, with its loss and its gradient to 8e-16.
  - With mixes in cells the shares that a token shows add up to 1: within 5e-13 for the display kinds and the containers, and within 5e-7 for the depths with the settings that train, where the ends of the mix of depths are cut off. The most negative share is -4e-14. The settings: random logits, the recipe's start, and tables that skip a rejected token or pop, with all but 1e-15 of every mix on their choice.
  - A run with a gradient has the loss of a run without one to the last digit.
- **`check-gradient.ts`**: the gradient against finite differences, in both forms.
  - Where the loss is smooth, i.e. without the cut at `leastLive`: 8 settings in 4 layouts with every cell and every open display entry trainable on random logits. Along 48 directions the largest difference is 1.1e-9 of the gradient's length, and for 192 single logits 4.0e-9 of the larger of 1 and the gradient. Every kind of choice has logits with a gradient.
  - With a `leastShare` of exactly 0 on 8 short samples: 1.3e-9.
  - On a text with 496 open brackets and logits that favour insertions, where 60 small steps have a share with a full stack: 4.0e-10.
  - With the settings that train: all 96 single logits are within 1e-4 at a step of 0.00001, the largest difference 9.3e-7, and 88 of 96 at a step of 0.001. The loss has small jumps where a token's live part crosses `leastLive`.
- **Faults**: 32 faults were put into a copy of the twin, one at a time, and 31 made a check fail: 11 the check against the exact parser (e.g. 17 small steps, no limit of the stack, no flag, a reduction that moves one level too many), 4 `check-twin.ts` (e.g. a pop without a state below that loses its share, a reduction whose rest for `stopped` may be negative), and 16 `check-gradient.ts` (e.g. no gradient by the sum of the top level, by the level that a pop uncovers, by the full level). The one that no check sees: a pop whose rest for `stopped` may be negative. No tables were found with which that alone lets a negative share grow.
- **What no check covers**: a loss that is no number showed up only in a training of 40,000 samples, not in any check that existed then. `check-twin.ts` now has mixes that are almost one choice, but a training on the full set is still the only test of a training on the full set.

## Commands

Run from the repo root with `RECOVERY_LR_SCRATCH` set to a folder outside the repo.

```sh
bun lab/recovery-lr/learn/soft-levels/smoke.ts --seed 1                  # 7 minutes: the three twins on 10,000 train samples
bun lab/recovery-lr/learn/soft-levels/smoke.ts --seed 1 --train 40000   # 20 minutes
bun lab/recovery-lr/learn/soft-levels/compare-gradients.ts               # 2 minutes
bun lab/recovery-lr/learn/soft-levels/follow.ts                          # 20 s
bun lab/recovery-lr/learn/recipe.ts --seed 1 --rows 9 --twin lab/recovery-lr/learn/soft-levels/pusher-below-twin.ts
```

`smoke.ts` runs the steps of row 9 of `../recipe.ts` once per twin with the same seed and train samples, and prints the scores next to the parser as it is, panic mode and row 11. Its twins by name, for `--twins`: `stacks`, `stacks-192`, `stacks-1000`, `levels`, `levels-pusher-below`. To train a row of the recipe with the variant from code: `rowsOfRecipe(seed, rows, {twin: {module: <path of levels-twin.ts>, options: {pusherBelow: 1}}})`.

## Files

- `levels-twin.ts`: the twin, `createTwin(layout, options)`. Its counters in a trainer's log: `tokens`, `smallSteps`, `levels` (added up over the small steps), `tokensAtStepLimit` and `shareAtStepLimit` (tokens with a live part after 16 small steps), `shareReduced` and `shareReducedToStopped`, `sharePopped` and `sharePoppedToStopped`, `stepsWithFullStack` and `shareWithFullStack`.
- `pusher-below-twin.ts`: the variant as a module of its own, for the commands that take a twin as a path.
- `check-twin.ts`, `check-gradient.ts`, `check-all.ts`: the checks.
- `smoke.ts`: the smoke run with several twins side by side.
- `compare-gradients.ts`: the twins' gradients at the start, cell by cell, against the exact parser's best change of a cell.
- `follow.ts`: how long a twin follows one stack.
