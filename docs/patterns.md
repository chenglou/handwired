# Patterns

These constructions replace a familiar loop. The program runs every operation on every frame and can't stop early, so a loop becomes a count, a tree, a table, or the same work on every item. A pattern needs nothing new from the runtime: some patterns are packaged as builder functions, e.g. `emitFirstActive` and `emitApplySpringMatrix`, and others are builder code written by hand. Constructions that replace one expression, e.g. `a >= b` or `x / y`, are in [expressions.md](expressions.md), and choices that change what the user sees, e.g. hit-testing where elements are going instead of where they're drawn, are in [behavior-choices.md](behavior-choices.md). Most patterns rely on inputs that the host rounds onto a declared grid, e.g. pointer coordinates to 1/64 px ([Grids](execution-model.md#grids)).

Costs count operations, the total work of one evaluation, and layers, the longest chain of operations that must run one after another. n is the item count, k the number of steps or events, S the number of states, L the number of line slots, i.e. the lines that a program has outputs for, C the number of candidates, and K the number of DOM slots, i.e. reusable DOM nodes, which is fixed while building. Sizes come from each entry's long form and test, or from the code that the entry names. Most entries have a long form in [lab/ui-exploration/guide/patterns](../lab/ui-exploration/guide/patterns/README.md), which quotes the concrete demo code, and `bun test lab/ui-exploration/guide/examples/patterns` runs those entries' tests. The prototypes that the entries name, e.g. lists, hn-thread, input and instanced-items, are folders of [lab/ui-exploration](../lab/ui-exploration/README.md).

On the CPU executor, an evaluation's time follows its operations more than its layers, which is why several entries below say to keep the loop. E.g. lab/knuth-plass, a program for optimal line breaking, takes 8 to 11 µs per 1,000 operations both as a chain of 10,232 layers and as a tree of 230 layers, at 1,024 break points ([CPU numbers](../lab/knuth-plass/README.md#cpu-numbers)). A layer also has a cost of its own, about 10 µs per 1,000 layers, for copying the values that it reads and the results that it writes: the same 16,384 sums of two terms take 55 µs in 64 layers, 65 µs in 1,024 layers and 210 µs in 16,384 layers, in Bun 1.4.3 on an Apple M5 Max (`bun lab/runtime-cost/layers.ts`). So removing operations by adding layers doesn't always save time.

## Index

| Familiar code | Size of the circuit version, against the loop |
| --- | --- |
| [`findIndex` when the test flips once along the items](#findindex-when-the-test-flips-once-along-the-items) | 195 operations in 3 layers at 64 rows, against 447 in 34 for a tree |
| [`findIndex` when passing items can be anywhere, and keeping the best score so far](#findindex-when-passing-items-can-be-anywhere-and-keeping-the-best-score-so-far) | 316 operations in 31 layers at 64 candidates, against 127 in 127 for the loop |
| [`indexOf` and `lastIndexOf` of the same hits](#indexof-and-lastindexof-of-the-same-hits) | 2,554 operations in 19 layers at 513 items, against 5,125 in 51 for two trees |
| [Comparing each item's index with the selected index](#comparing-each-items-index-with-the-selected-index) | one sum, then a few operations per item, e.g. 4 in 2 layers |
| [Build every option, score each, and keep the best](#build-every-option-score-each-and-keep-the-best) | every option's operations plus the pick, e.g. 114 operations in 25 layers for 3 layouts |
| [Running totals](#running-totals) | 2,036 operations in 18 layers at 1,024 rows, against 1,023 in 1,023 |
| [A linear step repeated a runtime number of times](#a-linear-step-repeated-a-runtime-number-of-times) | 14 operations in 3 layers per spring at any step count |
| [A state machine over queued events](#a-state-machine-over-queued-events) | 897 operations in 10 layers at 64 events, against 129 in 65 |
| [A loop whose decision needs later input](#a-loop-whose-decision-needs-later-input) | two passes of one step per position, e.g. 240 operations per position for a search automaton of 8 states |
| [A loop over a set of states, as a tree of matrix products](#a-loop-over-a-set-of-states-as-a-tree-of-matrix-products) | 1,064,103 operations in 174 layers at 8 states and 1,024 code points, against 236,328 in 8,190 for two loops |
| [A stack of one bit per level](#a-stack-of-one-bit-per-level) | 5 operations per position after the depth, or 20 in one step that a loop runs at every position |
| [Following links one at a time](#following-links-one-at-a-time) | 342 operations in 7 layers at 63 segments and 32 line slots, against 94 in 32 |
| [`items.sort(compare)`](#itemssortcompare) | 4,096 operations in 3 layers at 64 items |
| [`items.filter(isVisible).slice(0, K)` into K DOM nodes](#itemsfilterisvisibleslice0-k-into-k-dom-nodes) | 7,824 operations in 57 layers for 1,000 items into 20 DOM slots |
| [A loop over items that mixes per-item work with values carried to the next item](#a-loop-over-items-that-mixes-per-item-work-with-values-carried-to-the-next-item) | the per-item work, once, at any item count |
| [Growing and shrinking children with min and max](#growing-and-shrinking-children-with-min-and-max) | 784 operations in 9 layers at 64 children |
| [A layout function of one runtime number](#a-layout-function-of-one-runtime-number) | 2 operations per threshold, in 3 layers |
| [A loop over data that rarely changes](#a-loop-over-data-that-rarely-changes) | 1 operation per read at any table size |

## Why a tree gives the loop's answer

A loop that visits parts one at a time is a chain, n layers deep for n parts. Several entries below combine parts in pairs, then pairs of pairs, so the longest chain grows like log2 n instead. The tree gives the loop's answer when the combining step gives the same result however the parts are grouped: combining a with b, and then the result with c, gives what combining a with the combination of b and c gives. E.g. "the left group's first hit if the left group has one, otherwise the right group's" returns the first hit among a, b and c in either grouping, and so does "the larger score, and the left one on a tie" for the first highest score. For a state machine, combining two events' tables means "the earlier event, then the later event", which any grouping of three events also means.

Whether the grouping can change a bit depends on what the combining step computes:

- Choosing a candidate never computes a new number. The step passes one candidate's values along, so every grouping returns the same bits, as long as every comparison is exact. `emitArgmax`'s comparison isn't: it keeps the left score when the right score is larger by less than about 9e-8, and for some scores by up to 2.4e-7, and with scores that close its tree can pick a different candidate from the loop ([the highest score so far](#findindex-when-passing-items-can-be-anywhere-and-keeping-the-best-score-so-far)).
- Sums and products round in FP32, so the grouping is part of the result. With row heights 229, 167.4, 208.5 and 194.4 px, the loop's content height is 799.300048828125, while adding in pairs gives 799.2999877929688, one FP32 step lower. Integers below 2^24, and multiples of a power-of-two grid while totals stay small, add exactly in any grouping, which is when [running totals](#running-totals) as a tree match the loop bit for bit. A spring's matrix power built by the circuit differs from JavaScript's squaring in its last bits for the same reason.
- Tables of integer states or positions, combined with index reads, copy integers without rounding, so [a state machine's tables](#a-state-machine-over-queued-events) and [links followed by doubling](#following-links-one-at-a-time) give the same bits in any grouping.

## When a tree takes less time than the loop

A tree removes layers and adds operations, so whether it takes less time depends on which of the two an executor's time follows. A tree that only gives the last value, e.g. the first hit, has n − 1 combines, as many as the loop has steps, in about log2 n levels. A tree that gives the loop's value after every step, e.g. every row's top or the state after every event, is a prefix network, and [src/runtime/prefix-networks.ts](../src/runtime/prefix-networks.ts) has two. For n steps, a power of two:

| Arrangement | Combines | Levels | At 1,024 steps |
| --- | --- | --- | --- |
| The loop | n − 1 | n − 1 | 1,023 combines in 1,023 levels |
| `sklanskyPrefix` | (n / 2) × log2 n | log2 n | 5,120 combines in 10 levels |
| `brentKungPrefix` | 2n − 2 − log2 n | 2 log2 n − 2 | 2,036 combines in 18 levels |

A combine costs at least one step of the loop: 1 addition for [running totals](#running-totals), S index reads for [a state machine](#a-state-machine-over-queued-events) in one of S states, where a step of the loop is 1 read, and S³ ANDs for [a set of S states](#a-loop-over-a-set-of-states-as-a-tree-of-matrix-products), where a step of the loop is S² reads. So Sklansky's network does at least log2 n / 2 times the loop's work, in the fewest levels, and Brent-Kung's about twice the loop's work or more, in about twice as many levels as Sklansky's.

- **On the CPU executor, the tree takes longer than the loop, with either network.** E.g. lab/knuth-plass's tree takes 1.7 to 7.7 times its chain's time ([CPU numbers](../lab/knuth-plass/README.md#cpu-numbers)), and [the tree over a set of states](#a-loop-over-a-set-of-states-as-a-tree-of-matrix-products) 5.4 times its two loops' time, for 4.5 times their operations.
- **On a GPU, a level of the tree is one dispatch over all of the level's combines, and the tree can take less time than the loop's program on the CPU.** E.g. lab/knuth-plass's tree of min-plus matrix products, with one dispatch per level, took 0.47 ms on WebGPU for a paragraph of 1,024 break points with at most 32 boxes, e.g. words, per line, against 3.4 ms for the chain's program on the CPU executor, and less time than the chain from 256 or 1,024 break points on, depending on that line limit ([GPU timings](../lab/knuth-plass/README.md#gpu-timings)).
- **Against plain JavaScript, the tree on a GPU needs many items in one dispatch, and data that stays on the GPU.** A round trip to the GPU has a fixed cost, e.g. 0.3 to 0.6 ms for one paragraph of that tree, where a JavaScript loop lays out a paragraph of 1,024 break points in 0.04 to 0.07 ms. With many paragraphs in one dispatch, the tree takes less time than the JavaScript loops once the dispatch holds enough paragraphs: from under 30 to about 190 paragraphs of 256 break points, depending on the line limit and on the browser session. What JavaScript uploads per evaluation decides the result: with every paragraph's line costs computed in JavaScript and uploaded, the GPU took 85 ms for 10,000 paragraphs against 37 ms for a JavaScript loop over typed arrays, and with only the break positions uploaded, 2n integers per paragraph, and the line costs computed on the GPU, it took 15 ms ([the GPU crossover](../lab/knuth-plass/README.md#the-gpu-crossover)).
- **A backend that runs one large kernel per layer can't run fewer kernels than the program's longest chain of gates.** A compiled layer is one sparse matrix multiplication followed by gates, i.e. ReGLU's `max(0, gate)` products and boolean rounding. Two multiplications in a row can merge into one ([rounding points](execution-model.md#rounding-points) says which sums a backend may merge), but nothing merges across a gate. E.g. HandwiredOS's program has 130 layers, and its longest chain of ReGLU and boolean operations is 71. HandwiredOS is many different pieces of logic instead of one repeated step, so it has no tree to build.
- **One program over many source tables is the other case where a GPU takes less time, again when the tables stay on the GPU.** E.g. over 100,000 JSON documents that stay on the GPU, src/json-search's search takes about 5 ms, where the same program takes 13 to 14 s on the CPU as generated JavaScript. Less time than the same program on the CPU isn't always less time than native code: for the same searches, RegExp on one thread takes 1.5 to 9 times the GPU's time, and RegExp in 8 workers about the GPU's time ([JSON search's measurements](../lab/json-search/README.md#is-the-gpu-clearly-faster)). One table of a program with nothing repeated doesn't get faster: one evaluation of HandwiredOS took about 2 ms on WebGPU, with one table's statements run one after another in a shader, and takes under 0.1 ms on the CPU executor.
- **Where a tree of matrix products isn't the answer.** A step whose effect over a block of steps has no fixed-size form has no tree at all, e.g. greedy line breaking carries the current line's width. Only part of a task may be a product of matrices: a product of 0/1 matrices clamped back to 0..1 can't compute a NOT, which picking a search's matches needs, so [the tree over a set of states](#a-loop-over-a-set-of-states-as-a-tree-of-matrix-products) carries integers next to its matrices. And for an automaton of up to 32 states, the loop itself has a form that a batched product of dense matrices doesn't match: a row of a 0/1 matrix fits in one 32-bit word, and one AND of two words does the work of 32 table reads. A backend can hold a row that way without a change to the program, wherever the ranges, grids and exact bits that the program declares prove that the AND gives the value of the gate over those reads. E.g. src/json-search's bit-emit.ts writes the search's step that way, and a search of 100,000 documents at 32 states takes 5.2 ms, where the shader with one f32 statement per operation takes 945 ms ([two writers of GPU code](../src/json-search/README.md#two-writers-of-gpu-code)).

The GPU times in this section are from WebGPU in headless Chrome on an Apple M5 Max, for evaluations that follow each other. After a pause of 200 ms or more, which a page that evaluates once per keystroke gets, JSON search's evaluations took 2 to 3 times as long ([what depends on what](../lab/json-search/README.md#what-depends-on-what)). The plain JavaScript times are from one thread, except where a count of workers is given. src/runtime has no GPU backend: the GPU code is in src/json-search, src/doom and lab/.

## Searching and choosing

Each item's test or score is computed in the same layers, and one small structure over the results picks one item: a count when the results read 1...1 0...0, or a tree when they can be in any order.

### `findIndex` when the test flips once along the items

A loop stops at the first item that fails the test. When the test passes for a run of items at the start and fails for every item after it, the number of items that pass is the index the loop returns.

```js
const pointedRow = rowBottoms.findIndex(rowBottom => pointerY < rowBottom) // e.g. the comment under the pointer, in rows of different heights
```
```txt
rowBottom                  40   80   80  140  180    pointerY = 90
[rowBottom <= pointerY]     1    1    1    0    0    their count, 3, is the pointed row
previous bit minus bit      0    0    0    1    0    the pointed row's one-hot, where row 0's previous bit is [pointerY >= 0]
```

- **Circuit version.** `emitCompare(circuit, rowBottom, '<=', pointerY)` for every row in the same layers, one `circuit.roundAffine` sum of the bits, and neighbor differences declared with `circuit.assumeOneHot(isPointedRow, true)`, so reading any field of the pointed row is 1 gather. The count gives the loop's index because the bits never go from 0 back to 1, and a sum of exact 0s and 1s is exact in any grouping below 2^24.
- **Cost.** O(n) operations in O(1) layers after the row bottoms, 3n + 3 operations in 3 layers: 195 in 3 at 64 rows, against 447 in 34 for a tree built with `emitFirstActive`. The loop is O(n) operations in O(n) layers.
- **Exact when.** The test is exact, e.g. pointerY on a 1/64 px grid and bottoms on a 1/4 px grid give integer bits, while bottoms off a grid get a sign cascade, 15 operations in 14 layers per row within 0..16,384. The bits are monotone: unsorted bottoms give a wrong row without an error, e.g. a height of −10 px makes the bottoms 40, 30 and 80, and at pointerY 35 the count is 1 while the loop returns 0, which `validateOneHotGroups` catches in tests. The count is the row's index only while the pointer is on the rows: above the first row it's 0, and at or below the last bottom it's the row count.
- **Don't use it when.** The test isn't monotone, e.g. hit bits of overlapping windows: use [the next entry](#findindex-when-passing-items-can-be-anywhere-and-keeping-the-best-score-so-far). Every row has the same height: `Math.floor(pointerY / rowHeight)` doesn't grow with the row count, e.g. lists' uniform list is 280 operations in 19 layers with 24 DOM slots. Depth doesn't matter and rows are many: a binary search over the sorted bottoms reads ceil(log2(n + 1)) of them, e.g. 42 operations in 42 layers among 10,000 rows, against 20,001 in 3 for counting every row's bit:
  ```ts
  const countTerms: [Wire, number][] = []
  for (let step = 2 ** 13; step >= 1; step /= 2) {
    // The bottom at the count so far plus step − 1. A read past the table clamps to the last bottom.
    const bottom = circuit.indexReadAffine(countTerms, step - 1, rowBottoms, 'clamp', 'clamp')
    circuit.assumeGrid(bottom, 1) // the bottoms' grid, so that the comparison is 2 operations
    countTerms.push([emitCompare(circuit, bottom, '<=', pointerY), step])
  }
  const count = circuit.affine(countTerms) // larger than the row count when pointerY is at or below the last bottom, so take Math.min(count, rowCount)
  ```
  `countBottomsAtOrAbove` in lists' [text-rows.ts](../lab/ui-exploration/lists/text-rows.ts) is this search.
- **Used in, long form, test.** hn-thread's pointed comment and lists' virtualized list. [count-instead-of-search.md](../lab/ui-exploration/guide/patterns/count-instead-of-search.md), tested by [count-instead-of-search.test.ts](../lab/ui-exploration/guide/examples/patterns/selection/count-instead-of-search.test.ts).

### `findIndex` when passing items can be anywhere, and keeping the best score so far

A loop that picks one candidate reads the candidates one at a time, so the result depends on a chain through every candidate. The circuit computes every test or score in the same layers, then picks one candidate with a balanced tree in O(log n) layers.

```js
const clickedIndex = targets.findIndex(target => contains(target, pointer)) // e.g. the topmost of overlapping click targets, front to back
let bestIndex = 0 // e.g. the best-fitting of several candidate layouts
for (let index = 1; index < scores.length; index++) if (scores[index] > scores[bestIndex]) bestIndex = index
```
```txt
[0 1 0 1 0 0 1 0]   hit bits, front to back
 \_/ \_/ \_/ \_/    up: each pair holds 1 when either side holds 1
  1   1   0   1
   \_/     \_/
    1       1
      \___/
        1           down: the 1 goes left when the left side holds 1, otherwise right
[0 1 0 0 0 0 0 0]   the one-hot of the first hit, or all zeros when nothing is hit
```

- **Circuit version.** `emitFirstActive(circuit, gate, hitBits)` in numeric-ui-core.ts builds this tree, where the gate is 1 when a selection should happen, e.g. `pressed`. `emitArgmax(circuit, scores, unit)`, where `unit` is a wire that holds exactly 1, e.g. `circuit.constant(1)`, builds the same shape for scores declared within 0..1: in each pair, a boolean atom compares the two scores and a select keeps the larger one, the left one on a tie, and the 1 goes down along those comparison bits. The tree gives the loop's answer because each combining step gives the same result however candidates are grouped ([why](#why-a-tree-gives-the-loops-answer)).
- **Cost.** O(n) operations in O(log n) layers, against O(n) in O(n) for the loop. At 64 candidates, `emitFirstActive` is 316 operations in 31 layers, against 127 in 127 for the chain, and `emitArgmax` is 437 in 33.
- **Exact when.** `emitFirstActive` returns an exact one-hot, or all zeros, when the gate and every candidate are exact bits, while fractional candidates split the route, e.g. [0.5, 0] sends 0.25 to each output. It declares the one-hot group itself only for bits it can prove, e.g. `emitCompare` bits and boolean atoms, and not for an AND of bits built with a ReLU, so when each hit bit is an AND of 4 edge comparisons, the caller declares the group with `circuit.assumeOneHot(selected, true)`. Once the group is declared, a masked read of the selection, e.g. the pressed target's left edge, compiles to one gather. `emitArgmax` needs an executor that keeps FP32 rounding at its atoms. It keeps the left candidate on an exact tie, whenever the right score is less than 8.9e-8 larger, and for some scores when the right score is up to 2.4e-7 larger. This tie band isn't transitive, so the tree can pick a different candidate from the loop. When the pick must match the loop, `emitHighestScoreExact` in the guide's [highest-score-tree.ts](../lab/ui-exploration/guide/examples/patterns/selection/highest-score-tree.ts) combines pairs with `emitCompare`: 500 operations in 39 layers at 64 scores on a 1/64 grid.
- **Don't use it when.** Candidates can't overlap, e.g. photos in a grid, since the hit bits already are the selection. The test flips once along the items, e.g. rows top to bottom: use [the count](#findindex-when-the-test-flips-once-along-the-items). There are only a few candidates on the CPU executor, which pays per operation: at 4 candidates the chain is 7 operations and the tree 16. Training needs a gradient through the pick: `backpropagateReference` throws on `emitArgmax`'s boolean atoms by default, so train through a soft read, e.g. a softmax, and run the tree ([indexing](../lab/ui-exploration/guide/sections/indexing.md#hard-attention-as-the-limit), [lab/cascade-argmax](../lab/cascade-argmax/README.md)). The code needs both the first and the last hit, or the first hit as an index instead of a one-hot: use [running totals of the hits](#indexof-and-lastindexof-of-the-same-hits).
- **Used in, long forms, tests.** The click priority of HandwiredOS's Photos in [photo-gallery.ts](../src/handwiredos/photo-gallery.ts) (the previous and next controls, then the thumbnails, then the main image), and [candidate-gallery.ts](../lab/candidate-gallery/candidate-gallery.ts)'s layout choice with `emitArgmax` and clicked thumbnail with `emitFirstActive`, while `emitFrontmost` in HandwiredOS's [window-manager.ts](../src/handwiredos/window-manager.ts) checks stacking ranks one at a time, since at 3 windows that chain is smaller than an `emitFirstActive` tree. [first-active-tree.md](../lab/ui-exploration/guide/patterns/first-active-tree.md) and [highest-score-tree.md](../lab/ui-exploration/guide/patterns/highest-score-tree.md), tested by [first-active-tree.test.ts](../lab/ui-exploration/guide/examples/patterns/selection/first-active-tree.test.ts), [highest-score-tree.test.ts](../lab/ui-exploration/guide/examples/patterns/selection/highest-score-tree.test.ts), and 'argmax breaks exact ties toward the lower-indexed candidate' in [numeric-ui-core.test.ts](../tests/runtime/numeric-ui-core.test.ts).

### `indexOf` and `lastIndexOf` of the same hits

Two trees, one from each end of the items, find the first and the last hit. Running totals of the hit bits give both in one pass, as counts of bits that flip once along the items.

```js
const hits = [0, 0, 1, 0, 1, 1, 0] // e.g. the positions of a text whose nesting depth is at most the depth at a bracket
let total = 0
const hitsThrough = hits.map(hit => total += hit)                 // [0, 0, 1, 1, 2, 3, 3]
const firstHit = hitsThrough.filter(count => count < 1).length    // 2, which is hits.indexOf(1)
const lastHit = hitsThrough.filter(count => count < total).length // 5, which is hits.lastIndexOf(1)
```

- **Circuit version.** `hitsThrough` is [running totals](#running-totals) of exact bits. The bits `[hitsThrough[i] < 1]` and `[hitsThrough[i] < total]` each read 1...1 0...0 along the items, so their counts are indexes, as in [the count](#findindex-when-the-test-flips-once-along-the-items): the first hit is `Σ relu(1 − hitsThrough[i])`, and the last hit is the sum of `emitCompare(circuit, hitsThrough[i], '<', total)` over the items. When nothing is hit, `total` is 0, the first sum is the item count and the second is 0.
- **Cost.** O(n) operations, 4 per item with a chain of totals: 2,052 operations in 515 layers at 513 items, or 2,554 in 19 layers with `brentKungPrefix`, against 5,125 in 51 for two `emitFirstActive` trees with the two sums that turn their one-hots into indexes. The first hit alone is 1,528 operations in 18 layers with `brentKungPrefix`, against 2,563 in 51 for one tree with its sum.
- **Exact when.** Every hit is an exact bit with a declared grid, e.g. an `emitCompare` bit, or a cell declared as `input([0, 1], {grid: 1})`. Every total is then a whole number below 2^24, every ReLU gives an exact bit, and every comparison with the total is an integer bit of 2 operations. Hits without a declared grid, e.g. `inputBit()` cells, give the same indexes, but `emitCompare` can't prove that the totals are whole numbers and builds a sign cascade for every comparison, e.g. 9,722 operations in 32 layers in place of 2,554 in 19, which `circuit.roundingPoints()` shows.
- **Don't use it when.** The code that uses the hit needs the hit item's fields: `emitFirstActive` returns a one-hot, which a masked read turns into one gather, while a count is an index, which `circuit.indexRead` takes. The hits already read 1...1 0...0: their sum is the index, with no totals.
- **Example and test.** [first-and-last-hit.ts](../lab/ui-exploration/guide/examples/patterns/selection/first-and-last-hit.ts), tested by [first-and-last-hit.test.ts](../lab/ui-exploration/guide/examples/patterns/selection/first-and-last-hit.test.ts), which compares every form with `indexOf` and `lastIndexOf` and pins these sizes.

### Comparing each item's index with the selected index

When the selection comes as one-hot bits, e.g. from the tree above, a per-item relation to it can be written as a lookup: every item gets a term for every possible selection, e.g. a thumbnail's falloff as `Σ selected[s] × falloff(index − s)`, items × possible selections terms in all. Computing the selected index once replaces that lookup with one sum and a few operations per item.

```js
const nearSelected = thumbnails.map((_, index) => Math.abs(index - selectedIndex) <= 1) // e.g. the photos next to the focused photo, which get a blur
```

- **Circuit version.** The selected index is one sum, `Σ s × selected[s]`, or comes straight from a count or an index read. Every item computes `d = selectedIndex − index`, and for an integer d, `relu(d + 1) − 2 relu(d) + relu(d − 1)` is 1 when d is 0 and 0 otherwise. "At most 1 away" adds that bit at d − 1, d and d + 1, so no item's operations read another item's wire, which [a program written once per item](#a-loop-over-items-that-mixes-per-item-work-with-values-carried-to-the-next-item) requires.
- **Cost.** One sum, then O(1) operations per item, e.g. the guide's row of cards computes each card's hovered bit, including the AND with a presence bit, in 4 operations in 2 layers.
- **Exact when.** The selection's bits are exact and indexes are integers below 2^24, so the sum and every ramp are exact.
- **Don't use it when.** Each item only needs its own selection bit in a circuit that writes every item out: the one-hot member already is that bit. The code reads values at the selected item, e.g. the selected photo's width: use a masked read or `circuit.indexRead` at the index ([expressions.md](expressions.md)). Neighbors wrap around, e.g. Previous on the first photo focuses the last: the difference of indexes doesn't wrap by itself, so add a bounded wrap correction ([expressions.md](expressions.md#familiar-expressions)).
- **Used in, long form, test.** The focus relation of the gallery in [instanced-items](../lab/ui-exploration/instanced-items/README.md). [instancing.md, "Habits that change along with the constants"](../lab/ui-exploration/guide/sections/instancing.md#habits-that-change-along-with-the-constants), and the row of cards' hovered stage in [cards-staged.ts](../lab/ui-exploration/guide/examples/instancing/cards-staged.ts), tested by [instancing.test.ts](../lab/ui-exploration/guide/examples/instancing/instancing.test.ts).

### Build every option, score each, and keep the best

The program builds every option in the same layers, scores each, and picks one with the tree above, so every output comes from the same option. When a score replaces hand-written rules, e.g. `viewportWidth / viewportHeight > 1.6 ? heroLayout() : stripLayout()`, the app's behavior changes too, and the numbers behind the score can sit in cells, where a designer or a solver can change them.

```js
const options = optionBuilders.map(build => build(viewportWidth, viewportHeight)) // e.g. a gallery's hero, grid and strip layouts
let bestOption = 0
for (let index = 1; index < options.length; index++) if (options[index].score > options[bestOption].score) bestOption = index
```

- **Circuit version.** Each option is ordinary builder code that returns its outputs and a score within 0..1, e.g. `Math.min(1, size / targetSize)` for each size, then the smallest of those. `emitArgmax(circuit, scores, unit)` gives the one-hot, and each output is a masked sum over it, which the compiler lowers to one gather. When each option either fits or doesn't, and earlier options are preferred, e.g. a toolbar that shows labels when they fit, otherwise icons, otherwise an overflow menu, `emitFirstActive` over the fit bits gives the one-hot instead.
- **Cost.** Every option's operations, plus O(C) operations in O(log C) layers for the pick, plus one gather per distinct picked number: 3 layouts of 8 photos are 114 operations in 25 layers, of which the scores are 60 operations in 16 layers.
- **Exact when.** `emitArgmax` throws when a score isn't declared within 0..1, and every output is exactly one option's value. Options with equal scores, e.g. every layout scoring 1 on a large viewport, and scores within `emitArgmax`'s tie band are picked by their order. A JavaScript version picks the same option only when its scores come out the same, e.g. the example keeps sizes on eighth-pixel grids and target sizes at powers of two, so every score is a multiple of 2^-10 in both FP32 and float64. A masked sum becomes a gather only when every option's value has a finite declared range; otherwise the dense sum runs, and an unpicked option holding Infinity turns `0 × Infinity` into NaN.
- **Don't use it when.** The choice depends only on one runtime width: use [the thresholds of a layout function](#a-layout-function-of-one-runtime-number), 2 operations per threshold. There are many options, or expensive ones: every option runs on every frame whether or not it's picked.
- **Used in, long form, test.** [candidate-gallery.ts](../lab/candidate-gallery/candidate-gallery.ts), a gallery that builds three layouts and shows the one that fits the viewport best. [run-every-candidate.md](../lab/ui-exploration/guide/patterns/run-every-candidate.md), tested by [run-every-candidate.test.ts](../lab/ui-exploration/guide/examples/patterns/candidates-and-tables/run-every-candidate.test.ts).

## Carrying a value from step to step

A loop that carries a value from step to step becomes a tree of combining steps when two steps combine into a step of the same kind: two additions into a sum, two spring steps into one matrix, two events into one table, two links into a longer link.

### Running totals

Each total reads the total before it, so the loop is a chain n layers deep.

```js
const rowTops = [] // e.g. the top of each row in a list whose rows have different heights
let top = 0
for (const height of heights) { rowTops.push(top); top += height }
```
```txt
h0   h1   h2   h3
 \___/     \___/      layer 1: 0..1 and 2..3
  0..1      2..3
     \______/         layer 2: 0..3, and 0..2 = (0..1) + h2
       0..3
```

- **Circuit version.** Three arrangements of the same additions, each built with `circuit.roundAffine`, which keeps a sum as its own operation with the caller's term order: a chain in the loop's order, one wide sum per total, or a Brent-Kung network, `brentKungPrefix(heights, combine)` in [src/runtime/prefix-networks.ts](../src/runtime/prefix-networks.ts), which takes any associative combine, e.g. `(earlier, later) => circuit.roundAffine([[earlier, 1], [later, 1]])`. With `circuit.affine`, the builder copies a sum of fewer than 4 terms into the sums that read it and sorts its terms, which regroups the additions.
- **Cost.** At 1,024 rows, the chain is 1,023 operations in 1,023 layers, wide sums 1,023 operations in 1 layer with 524,799 stored weights, i.e. O(n²) weights, and Brent-Kung about 2n operations in about 2 log2 n layers, 2,036 in 18.
- **Exact when.** The chain and wide sums take the loop's rounding steps, so they equal a loop that rounds every addition to FP32, bit for bit. Brent-Kung equals that loop only when every partial sum is exact, e.g. quarter-pixel heights with a content height within 2^22 px, or counts below 2^24. On long pages Brent-Kung is the more precise grouping: at 10,000 rows of 20 to 300 px, the loop's totals are up to 5.67 px from float64 sums of the same FP32 heights, and Brent-Kung's up to 0.26 px.
- **Don't use it when.** Depth doesn't matter, as on the CPU executor: the chain is the least work. A reference that adds one row at a time must match bit for bit on fractional heights: use the chain or wide sums. There are more than a few hundred rows: wide sums store n²/2 weights.
- **Used in, long form, test.** instanced-items' photo strip edges, hn-thread's row tops, lists' counts of visible items. [running-totals.md](../lab/ui-exploration/guide/patterns/running-totals.md), tested by [running-totals.test.ts](../lab/ui-exploration/guide/examples/patterns/combining-steps/running-totals.test.ts).

### A linear step repeated a runtime number of times

A program runs each of its layers once, so it can't run a loop a runtime number of times. When one step is linear with constant coefficients, any number of steps is one matrix power.

```js
for (let step = 0; step < steps; step++) { // e.g. a window's spring through a frame's 4 ms steps, where steps comes from the frame's timestamp
  velocity += (-stiffness * displacement - damping * velocity) * dt
  displacement += velocity * dt
}
```

- **Circuit version.** One step maps (displacement, velocity) through a 2×2 matrix M, so `steps` steps are M^steps. host-timing.ts's `springMatrixPower(springStepMatrix(constants), steps)` squares in float64, JavaScript writes the 4 entries into cells before each evaluation, and `emitApplySpringMatrix(circuit, matrix, displacement, velocity)` in numeric-ui-core.ts applies them with 4 products. The cells need finite declared ranges, e.g. `±springMatrixBound(constants)`. Matrix products are associative and powers of one matrix commute, so every grouping gives the same real matrix. The long form also builds the power in the circuit from the step count's binary digits, and reads M^i from a table of M^0 to M^300 with `circuit.indexRead`.
- **Cost.** 14 operations in 3 layers per spring at any step count, and 280 in 3 for 20 springs. Unrolling the loop with one mask per possible step is 3,301 operations in 902 layers for one spring and up to 300 steps. JavaScript pays O(log steps) 2×2 products per stiffness and damping pair per evaluation, or one array lookup when it computes the matrix of every step count once, as [template/toggle.ts](../template/toggle.ts) does.
- **Exact when.** Close to the float64 loop, not bit for bit, since the state rounds once per evaluation instead of once per step: within 3e-4 px over 1,000 random springs within ±2,000 px and ±20,000 px/s. Reading M^i from a table of powers gives the same outputs as writing M^i into cells, bit for bit, while the step count holds an integer.
- **Don't use it when.** The step isn't linear with constant coefficients, e.g. stiffness that depends on position, or items that push each other apart: unroll a small maximum count. Stiffness and damping are values inside the program: the steps no longer combine into constant weights, e.g. 2,142 operations in 1,295 layers for one spring built from binary digits, so keep them in JavaScript.
- **Used in, contract, long form, test.** `emitAnimatedObject` with host-timing.ts's `advanceFrame` is the default spring ([execution-model.md](execution-model.md#springs-and-time)), e.g. in window-manager.ts, where the windows, Photos' thumbnails and the two springs of a photo's zoom share one spring matrix. [matrix-powers.md](../lab/ui-exploration/guide/patterns/matrix-powers.md), tested by [matrix-powers.test.ts](../lab/ui-exploration/guide/examples/patterns/combining-steps/matrix-powers.test.ts).

### A state machine over queued events

Each step reads the state the previous step produced, so the loop is k layers deep for k events. When the state has few possible values, the steps can be regrouped.

```js
let state = initialState // e.g. a button that acts on release, over the pointer events queued in one frame
for (const event of events) state = nextState(state, event)
```
```txt
each event as a table from state to next state, over the states idle, armed, pressedOutside:
  downOnButton = [armed, armed, pressedOutside]      moveOutside = [idle, pressedOutside, pressedOutside]
two events as one table, one read per state:  combined[state] = later[earlier[state]]
  downOnButton, then moveOutside = [pressedOutside, pressedOutside, pressedOutside]
```

- **Circuit version.** Two ways to regroup the steps, then the step of a machine that can be in several states at once:
  - A prefix scan: JavaScript writes the machine's transition table into cells, each event's table is S index reads, two tables combine with one `circuit.indexRead` per state, and `sklanskyPrefix` or `brentKungPrefix` in [src/runtime/prefix-networks.ts](../src/runtime/prefix-networks.ts) gives every prefix, so the state before every event.
  - Speculation: each block of B events runs once from every possible start in the same layers, and one `circuit.indexRead` per block picks the run that starts where the state actually is.
  - Several states at once, e.g. an automaton built from a regular expression: the state is a 0/1 vector of S bits instead of one integer, and each step multiplies it by the current character class's matrix of transition bits. Each term of that product, `bit ? transitions[class][s][t] : 0`, is one index read, which lands past the table and reads +0 when the bit is 0 (the row `condition ? table[index] : 0` of [expressions.md](expressions.md#familiar-expressions) has the call). So a step is S² reads plus one ReLU per state for "none of these reads is 1", as `createStepAnd` in [data-program.ts](../src/json-search/regex/data-program.ts) builds it.
- **Cost.** The loop is O(k) operations in O(k) layers. The prefix scan is S reads per event plus S reads per combine, in O(log k) layers: that is O(S × k log k) operations with Sklansky's network and O(S × k) with Brent-Kung's ([the table of networks](#when-a-tree-takes-less-time-than-the-loop)), e.g. 897 operations in 10 layers and 681 in 14 for a 3-state button at 64 events, against 129 in 65 for the loop. From a constant initial state, e.g. state 0, every prefix is read only at that state, so the compiler removes S − 1 reads per prefix, and the scan is k + S × combines operations instead of S × (k + combines), e.g. 26,850 instead of 39,650 with Brent-Kung's network for a tokenizer of 26 states over 512 positions. Speculation is about S times the loop's operations in O(√k) layers, e.g. 1,000 operations in 25 layers for keyboard focus over 5 buttons at 64 events, against 193 in 129. A set of states costs S² reads per step, e.g. the step of src/json-search's search at 32 states is 1,156 operations for the code point's class and one pass, 1,025 of them reads.
- **Exact when.** Reads copy integers without rounding, so every grouping gives the same bits, while every table cell holds an integer state within 0..S − 1 and every event kind an integer within its declared range. A fractional cell doesn't throw, since the read floors it, so tests run `validateIndexReads`. Speculation's runs have to cover every value the state can hold when a block starts; otherwise the read returns the nearest end of the table, and every later block starts from the wrong state.
- **Don't use it when.** Operations cost more than layers, as on the CPU executor: at 64 events the loop is about 7 times fewer operations than the scan, and a JSON tokenizer of 26 states with its grammar of 8 states, over 512 code points, takes 3.0 times the loop's time as scans with Brent-Kung's network and 6.1 times with Sklansky's. The state has cheaper structure, e.g. a count, a latch, or an OR that resets: build that structure directly, as the input prototype does with running counts of downs and ups for pointer moves. The state has many possible values, e.g. a line's start among 1,000 segments: speculation runs once per value, so [follow links by doubling](#following-links-one-at-a-time) instead. An event's table depends on another state, e.g. whether a move passes the drag threshold depends on the press point: compute that state with its own scan first.
- **Used in, long forms, tests.** input's keyboard focus over 12 controls, and as loops, the tokenizer and the grammar of src/json-search's highlighter and the set of states of its search ([json-step.ts](../src/json-search/json-step.ts), [search-step.ts](../src/json-search/search-step.ts)). [state-machine-prefix-scan.md](../lab/ui-exploration/guide/patterns/state-machine-prefix-scan.md) and [speculation.md](../lab/ui-exploration/guide/patterns/speculation.md), tested by [state-machine-prefix-scan.test.ts](../lab/ui-exploration/guide/examples/patterns/combining-steps/state-machine-prefix-scan.test.ts) and [speculation.test.ts](../lab/ui-exploration/guide/examples/patterns/candidates-and-tables/speculation.test.ts), and the operation counts in [prefix-networks.test.ts](../tests/runtime/prefix-networks.test.ts).

### A loop whose decision needs later input

A loop that finds the longest match only knows where the match ends after reading past it, and then goes back, e.g. for `a+b|a` on `aaac`, the scan from position 0 reads `aaac` before it knows that only `a` matches. A program runs every step once, in order, so it can't go back.

```js
let end = -1 // e.g. the longest token that starts at `start`, as a tokenizer or a regular expression search takes it
let states = new Set([initialState])
for (let position = start; position < text.length && states.size > 0; position++) {
  states = nextStates(states, text[position])
  if ([...states].some(isAccepting)) end = position + 1
}
```
```js
// The two passes. `text` is an array of code points, e.g. [...'aaac'], `states` is every state of the automaton,
// [0, 1, ...], and transitions[class][from][to] and accepting[state] are booleans.
const reach = [...text.map(() => []), states.map(() => false)] // the reverse pass, from the end of the text
for (let position = text.length - 1; position >= 0; position--) {
  const steps = transitions[classOf(text[position])]
  reach[position] = states.map(from => states.some(to => steps[from][to] && (accepting[to] || reach[position + 1][to])))
}
const highlighted = [] // the forward pass
let reached = states.map(() => false)
for (let position = 0; position < text.length; position++) {
  const continuing = states.map(state => reached[state] && reach[position][state]) // the match in progress can still get longer
  const start = !continuing.some(Boolean) && reach[position][initialState] // no match continues, and one starts here
  highlighted[position] = continuing.some(Boolean) || start
  const live = continuing.map((bit, state) => bit || (state === initialState && start))
  const steps = transitions[classOf(text[position])]
  reached = states.map(to => states.some(from => live[from] && steps[from][to]))
}
```

- **Circuit version.** A reverse pass first, from the end of the text: `reach[position][state]` is 1 when some path from that state at that position reads at least one more code point and ends in an accepting state. The forward pass then knows at every position whether the match in progress can still get longer, `reached[state] && reach[position][state]` for some state, and when no match continues, a match starts at the position when `reach[position][initialState]`. So the forward pass never goes back to where a longest match ended. Each pass is the state machine above over a set of states, and the reverse pass reads the transition matrices by column instead of by row. Over exact bits, `bits.some(Boolean)` is `1 − relu(1 − sum)`, and "none of them" is `relu(1 − sum)`.
- **Cost.** Two passes of one step per position, about twice the operations of the forward pass alone. Every forward step reads the reverse pass at its position, so the forward pass starts after the whole reverse pass, and the layers grow with the text. E.g. the step of src/json-search's search, with the automaton in cells, is 240 operations per position at 8 states, 148 for the reverse pass with the code point's class and 92 for the forward pass, 664 at 16 states and 2,280 at 32.
- **Exact when.** Every value is an exact bit, so the passes are exact at any text length.
- **Don't use it when.** The decision only needs earlier input, e.g. the first position where a fixed string ends: the forward pass alone gives it. One earliest start per state looks cheaper than a reverse pass and doesn't work: when a longest match ends at a position, paths that started before that position must be dropped and a path in the same state that started there or later must survive, and one number per state can't tell the two apart. The layers matter: regroup the steps into [a tree of matrix products](#a-loop-over-a-set-of-states-as-a-tree-of-matrix-products), at S³ ANDs per combine where a step is S² reads.
- **Used in, test.** src/json-search's search, which finds every non-overlapping match, leftmost and then longest: the stages `reverse` and `forward` of [search-step.ts](../src/json-search/search-step.ts), which a loop runs once per position, tested by [regex-search.test.ts](../tests/json-search/regex/regex-search.test.ts) against a plain JavaScript scan that keeps the last accepting position and against RegExp, on hand-written and random patterns.

### A loop over a set of states, as a tree of matrix products

The two passes above are chains as long as the text. They regroup into a tree, since the effect of reading a block of neighboring positions has a fixed size: an S × S matrix of bits and one integer per state. `matrix[from][to]` is 1 when some path reads the whole block from the state `from` and ends in the state `to`. A state's integer is the position after the last code point of the longest path that starts in that state and ends in an accepting state inside the block, or 0 when there is no such path.

```js
// `text` is an array of code points, e.g. [...'aaac'], `states` is [0, 1, ...], and transitions[class][from][to] and
// accepting[state] are booleans, e.g. of a regular expression's automaton.
const blockOf = position => { // one code point as a block
  const matrix = transitions[classOf(text[position])]
  return {matrix, ends: states.map(from => matrix[from].some((bit, to) => bit && accepting[to]) ? position + 1 : 0)}
}
const followedBy = (earlier, later) => ({ // one block, then the block right after it in the text
  matrix: states.map(from => states.map(to => states.some(between => earlier.matrix[from][between] && later.matrix[between][to]))),
  ends: states.map(from => Math.max(earlier.ends[from], ...states.map(between => earlier.matrix[from][between] ? later.ends[between] : 0))),
})
// From the end of the text: item k is position text.length − 1 − k, and prefix k covers that position to the end.
const suffixes = brentKungPrefix(text.map((_, position) => blockOf(position)).toReversed(), (later, earlier) => followedBy(earlier, later)).toReversed()
const longestEnd = suffixes.map(suffix => suffix.ends[initialState]) // where the longest match that starts at each position ends, or 0
```

- **Circuit version.** A leaf's matrix is S² index reads of the transition cells at the code point's class, and its ends are one bit per state, "some step from this state reads this code point into an accepting state", times the constant position + 1. A combine is one clamped matrix product, `relu(a + b − 1)` for each AND and `1 − relu(1 − sum)` for each OR, and S maximums: each `bit ? end : 0` is one ReGLU, and each maximum is a tournament of `a + relu(b − a)`. `followedBy` gives the same block however the blocks are grouped, so `sklanskyPrefix` or `brentKungPrefix` in [src/runtime/prefix-networks.ts](../src/runtime/prefix-networks.ts), run from the end of the text, gives `longestEnd` at every position. Bits alone aren't enough: the forward pass above restarts a match when no match continues, which is a NOT of an OR, and a product of 0/1 matrices clamped back to 0..1 can't compute a NOT. From `longestEnd`, the scan position after a position is `Math.max(longestEnd[position], position + 1)` for every position at once, and [jump tables with one binary descent per position](#following-links-one-at-a-time) give every position the match that covers it. Every operation that holds an end declares the range 0..n with `circuit.assumeRange`, since the range that the builder infers for a maximum doubles at every level of the tree.
- **Cost.** A combine is S³ ANDs and S² ORs, plus the maximums, where a step of the loop is S² reads, and [the table of networks](#when-a-tree-takes-less-time-than-the-loop) has the number of combines. E.g. 8 states over 1,024 code points, with the matches picked: 1,064,103 operations in 174 layers with Brent-Kung's network and 1,278,722 in 124 with Sklansky's, against 236,328 in 8,190 for the two passes with every position written out.
- **Exact when.** Every matrix entry is an exact bit and every end a whole number within 0..n, so every grouping gives the same values.
- **Don't use it when.** Operations cost more than layers, as on the CPU executor: that tree took 10.8 ms per evaluation against 2.0 ms for the two passes, in Bun 1.4.3 on an Apple M5 Max. The automaton has many states: the operations grow with S³ × n, e.g. 16 states over 1,024 code points are 5.9 million operations, whose build and compile took about 15 s and 9 to 11 GB. The automaton has at most 32 states and the backend can hold a row of bits in one word: one AND of two words then does the work of a row of table reads in the loop itself ([where a tree of matrix products isn't the answer](#when-a-tree-takes-less-time-than-the-loop)).
- **Used in.** No program in this repo builds this tree: the snippet above is what to build from, and the sizes and times above come from a program built that way. src/json-search runs the two passes as loops. lab/knuth-plass builds a tree of matrix products of another kind, min-plus products for optimal line breaking, with one GPU dispatch per level ([README](../lab/knuth-plass/README.md)).

### A stack of one bit per level

A parser keeps a stack of open containers and reads its top, e.g. whether a comma leads to a key or a value in JSON. Each push or pop changes the stack that the previous character left, so the loop is a chain.

```js
const stack = [], inObject = [] // e.g. whether each position of a JSON text is inside an object or an array
for (const character of text) {
  inObject.push(stack.at(-1) === 'object')
  if (character === '{' || character === '[') stack.push(character === '{' ? 'object' : 'array')
  if (character === '}' || character === ']') stack.pop()
}
```
```txt
text           {   [   {   }   ]   }
depthBefore    0   1   2   3   2   1
codeBefore     0   1   1   5   1   1    bit d − 1 is 1 when the container at depth d is an object
inObject       0   1   0   1   0   1    [codeBefore >= 2^(depthBefore − 1)], and 0 at depth 0
```

- **Circuit version.** At a bounded depth, the stack's kinds fit in one integer whose bit d − 1 is 1 when the container at depth d is an object. A running total adds 2^depthBefore at `{` and subtracts 2^(depthBefore − 1) at `}`, where each weight is one index read at `depthBefore × kindCount + kind`, and the kind at the current depth is one comparison, `emitCompare(circuit, codeBefore, '>=', levelWeight)`, with `levelWeight = 2^(depthBefore − 1)` read from a table, since the containers below the current depth add up to less than that bit. The depth is its own running total of +1 and −1.
- **Cost.** O(n) operations, 5 per position after the depth with every position written out: a weight read, an addition, a level read and a 2-operation comparison, e.g. about 2,570 at 512 positions and depths up to 16, in 528 layers with chains of totals. In one step that a loop runs at every position, the comparison can't depend on the position, so it is a sign cascade of 17 operations everywhere, 20 operations per position after the depth, e.g. the step of src/json-search's highlighter is 37 operations in all.
- **Exact when.** Nothing reads the kind after the first mismatched bracket: until then, every container below the current depth is still open and every closer matched its opener's kind, so no bit at or above the depth is set, while e.g. `[}` subtracts a bit that was never added. E.g. a JSON grammar that stays in its error state after its first error never reads a wrong kind. The comparison at position p is a 2-operation integer bit while (p + 1) × 2^(maximum depth − 1) stays below 2^24 and every read and total has a grid ([Grids](execution-model.md#grids)). Past that, `emitCompare` builds a sign cascade of 17 operations, which is also exact, e.g. at position 511 at depths up to 16, and `circuit.roundingPoints()` lists which comparisons got one.
- **Don't use it when.** The stack holds more than one bit per level, e.g. the positions of open brackets: pair brackets by depth instead. With `threshold = depthBefore[bracket] − (isCloser ? 1 : 0)`, a closer's match is the last earlier position whose `depthBefore` is at most the threshold, and an opener's match is the position just before the first later position whose `depthBefore` is at most the threshold, i.e. [the last and the first hit](#indexof-and-lastindexof-of-the-same-hits) of one comparison per position. The maximum depth passes 24: the code's bits past 2^24 aren't exact in FP32.
- **Used in, test.** The container kinds of src/json-search's highlighter, as one step per position, in [json-step.ts](../src/json-search/json-step.ts), tested by [json-step.test.ts](../tests/json-search/json-step.test.ts), which nests an object inside arrays and an array inside objects at every depth from 1 to 16.

### Following links one at a time

Each step reads where the previous step landed, so following L links is L layers deep. Replacing every link by the link it points to doubles how far every link reaches, so L links take about log2 L rounds (pointer jumping).

```js
let start = 0 // e.g. where each line of a paragraph starts, from a table of where the next line starts
for (let line = 0; line < lineSlots; line++) {
  starts.push(start)
  if (start < segmentCount) start = nextStart[start]
}
```
```txt
segment s        0   1   2   3   4   5   6   7   8   9 | 10 = past the end
1 line later     3   3   4   6   6   8   9   9  10  10     nextStart[s]
2 lines later    6   6   6   9   9  10  10  10  10  10     (1 line later)[(1 line later)[s]]
line 3 starts at (1 line later)[(2 lines later)[0]] = (1 line later)[6] = 9
```

- **Circuit version.** `jumps[level] = jumps[level − 1].map(target => circuit.indexRead(target, jumps[level − 1]))`, then `starts[line] = circuit.indexRead(starts[line − 2^level], jumps[level])` with `level = Math.floor(Math.log2(line))`. Every read of one level reads the level before, so a level is one layer. The same tables answer the opposite question, which link covers a position, e.g. which match of a search a character belongs to, from where the scan goes after each position: one binary descent per position, `scan = 0; for (level = levels − 1; level >= 0; level--) if (jumps[level][scan] <= position) scan = jumps[level][scan]`, finds the last scan position at or before the position, in 4 operations per level, i.e. a read, a 2-operation comparison and a read that picks one of the two.
- **Cost.** O(n log L) operations in O(log L) layers, against O(L) in O(L) for the walk: 342 operations in 7 layers at 63 segments and 32 line slots, against 94 in 32. The next-start table isn't included, and it dominates at realistic sizes, e.g. 190,279 operations for 1,023 segments ([text-walker](../lab/ui-exploration/text-walker/README.md#merged-from-index-read-september-16-2026)).
- **Exact when.** Positions are integers below 2^24, which reads copy without rounding, so every grouping gives the same bits. Every `nextStart[s]` holds an integer within 1..n, and `nextStart[n − 1]` is n, as greedy line breaking gives, so a read clamped at the end still reads n.
- **Don't use it when.** Few links need following, e.g. a card caption of at most 3 lines. Each line needs its own width, which one next-start table can't express. Operations cost more than layers, as on the CPU executor: at 1,023 segments the walk is about 16 times fewer operations.
- **Long form and test.** [pointer-jumping.md](../lab/ui-exploration/guide/patterns/pointer-jumping.md), tested by [pointer-jumping.test.ts](../lab/ui-exploration/guide/examples/patterns/combining-steps/pointer-jumping.test.ts). The descent runs in lab/knuth-plass's [program.ts](../lab/knuth-plass/program.ts), from the last break point back, to mark the break points on the chosen path.

## The same work on every item, then counts and sums

Instead of visiting items in order and stopping at a match, the same computation runs on every item in the same layers, e.g. how many items come before this item, and the results are added up.

### `items.sort(compare)`

A sort reaches each item's place through comparisons that depend on earlier comparisons. The DOM needs each item's position after sorting, e.g. for a `translateY`, and that position is a count: how many items come before this item.

```js
const order = items.map((_, index) => index).sort((left, right) => keys[left] - keys[right] || left - right) // e.g. cards stacked by date
let top = 0
for (const item of order) { itemTops[item] = top; top += heights[item] }
```
```txt
keys                30   10   30   20
item 0 (key 30)      ·    1    0    1   → rank 2      an entry is 1 when the other item comes before this item,
item 1 (key 10)      0    ·    0    0   → rank 0      and of two equal keys, the earlier item comes first
item 2 (key 30)      1    1    ·    1   → rank 3
item 3 (key 20)      0    1    0    ·   → rank 1
```

- **Circuit version.** One `emitCompare(circuit, keys[earlier], '<=', keys[later])` per pair gives both of the pair's entries, and each rank is one sum of bits. An item's top is one sum of `comesBefore × height` products. When one item moves, e.g. a dragged card, the new ranks come from last frame's ranks without comparing every pair. With `fromRank` the dragged card's rank, a card above the dragged card is passed when `[rank < fromRank] AND [pointerY < midpoint]`, and a card below it when `[rank > fromRank] AND [pointerY > midpoint]`. A passed card moves by one rank, and the dragged card by the count of passed cards. Midpoints never decrease along ranks, so the passed cards form one run, the run that a swap loop walks.
- **Cost.** O(n²) operations in O(1) layers: 4,096 operations in 3 layers at 64 items, with keys on a grid, so every bit is 2 operations. When one card moves, O(n): 1,404 operations in 8 layers at 100 cards.
- **Exact when.** Keys are integers or declared on a grid; other keys get a sign cascade, still exact but 15 operations in 14 layers per `<=` within 0..16,384. Tops are exact while heights lie on a grid and totals stay below 2^24 grid steps. The update for one moved card reads last frame's tops, which must be in rank order.
- **Don't use it when.** There are well over a hundred items: a sorting network is O(n log² n) operations in O(log² n) layers, e.g. for 64 items with integer keys that each carry one value to their sorted place, 10,624 operations in 105 layers, against 16,512 in 5 for ranks ([loops, section 5](../lab/ui-exploration/guide/sections/loops.md#a-sorting-network-instead)). The order is known while building, e.g. a fixed menu: sort in JavaScript while building. Many items move in one frame, e.g. switching the sort from date to name: recompute the ranks.
- **Used in, long form, test.** lists' port of draggable-cards, a demo of [chenguini](https://github.com/chenglou/chenguini), a set of engineering and UI guidelines. [ranks-instead-of-sorting.md](../lab/ui-exploration/guide/patterns/ranks-instead-of-sorting.md), tested by [ranks-instead-of-sorting.test.ts](../lab/ui-exploration/guide/examples/patterns/every-item/ranks-instead-of-sorting.test.ts).

### `items.filter(isVisible).slice(0, K)` into K DOM nodes

Which items pass the filter isn't known while building, but the number of DOM nodes K is. Every item's visibility is computed in the same layers, a prefix sum numbers the visible items, and DOM slot k shows the visible item numbered k.

```js
const shownItems = items.filter(isVisible).slice(0, slotCount) // e.g. the first 20 products within a price range, in 20 reusable DOM nodes
```
```txt
item                     0   1   2   3   4   5   6   7
visible                  0   1   1   0   1   0   1   1
visibleThrough           0   1   2   2   3   3   4   5    a prefix sum of the visible bits
[visibleThrough <= 2]    1   1   1   1   0   0   0   0    the neighbor difference at item 4 marks what DOM slot 2 shows
```

- **Circuit version.** Each item's visibility bit, e.g. an AND of two `emitCompare` bits, then the counts from a Brent-Kung network of additions. Each DOM slot k then finds its item one of two ways: neighbor differences of `[visibleThrough[item] <= k]`, declared with `circuit.assumeOneHot`, so each field the slot shows is one gather, or a binary search over the counts with `circuit.indexReadAffine`, then `circuit.indexRead` at the found position with `{outOfRange: 'zero'}`. A slot's presence bit is `[visibleThrough[n − 1] >= k + 1]`.
- **Cost.** Visibility and counts are O(n) operations in O(log n) layers, 6,984 operations in 20 layers for 1,000 items. Into 20 DOM slots, in all, one-hots are O(n × K), 47,044 operations in 24 layers, and binary search O(K log n), 7,824 operations in 57 layers.
- **Exact when.** The visibility test is exact, e.g. integers or values on a declared grid, so the counts are sums of exact bits, exact in any grouping below 2^24. Nothing checks the one-hot declaration at runtime, so tests run `validateOneHotGroups`, and every field needs a finite declared range for its gather. The binary search's indexes hold integers, which `validateIndexReads` checks in tests.
- **Don't use it when.** The visible items form one run, e.g. rows scrolled into view: DOM slot k shows `firstVisibleRow + k`, e.g. 1,269 operations for hn-thread's 48 DOM slots, against 25,616 with this entry's routing, though rows of height 0 use up slots. The per-item work that each DOM slot runs is small: routing pays off only once that work costs more than about 2 + 2K operations, e.g. 42 for 20 slots. K is close to the item count: run the work for every item, and let JavaScript skip the hidden ones.
- **Used in, long form, test.** lists' capacity routing and hn-thread's rank slots. [compaction-into-slots.md](../lab/ui-exploration/guide/patterns/compaction-into-slots.md), tested by [compaction-into-slots.test.ts](../lab/ui-exploration/guide/examples/patterns/every-item/compaction-into-slots.test.ts).

### A loop over items that mixes per-item work with values carried to the next item

Writing the loop body out once per item in one circuit gives a program whose size grows with the item count, and whose carried values form a chain. Instead, the lines that read one item are written once as map stages that run for every item, like a shader over pixels, and the lines that carry a value become reductions between the stages.

```js
let rowTop = 0 // e.g. an expandable list, where a row's height depends on whether it's expanded
for (const row of rows) {
  const rowHeight = headerHeight + (row.expanded ? row.lineCount * lineHeight : 0) // reads this row only
  visible.push(rowTop + rowHeight > scrollTop && rowTop < scrollTop + viewportHeight) // this row only
  rowTop += rowHeight // carried to the next row
}
```

- **Circuit version.** A map stage is ordinary builder code over one item's values and shared values, e.g. scrollTop, compiled once as its own program and evaluated for every item. The reductions between stages, e.g. prefix sums, sums and first hits, run in between. src/runtime has no runner for map stages. The guide example's `buildMapStage` and `runListStages` in [one-program-per-item.ts](../lab/ui-exploration/guide/examples/patterns/every-item/one-program-per-item.ts) are a simple one, lab/ui-exploration/instanced-items has a staged builder with executors that generate one loop or one GPU compute shader per stage, and src/json-search's [loop-program.ts](../src/json-search/loop-program.ts) runs a step once per position of a document.
- **Cost.** O(p) operations at any item count, where p is the per-item work, and a frame does O(n × p) operations plus O(n) per reduction: the example's stages are 3 operations in 3 layers and 12 in 4, where the circuit with every row written out is 901 operations in 71 layers at 64 rows. instanced-items' gallery is 233 operations per photo at any photo count, and at 10,000 photos its staged executor takes about 4.1 ms per frame, against 43 ms for the circuit with every photo written out.
- **Exact when.** The staged program gives the written-out circuit's bits when each reduction takes the same FP32 steps, e.g. a prefix sum in row order that rounds after every addition. A stage boundary can move a rounding point: a per-item constant that was a weight becomes a product, e.g. writing HandwiredOS's thumbnails as a map stage moved their centers by up to 0.0012 px.
- **Don't use it when.** There are a handful of items whose constants sit in lookup tables: writing HandwiredOS's 20 small items as map stages made its program a fifth larger, since table entries that were weights became products. The items don't share a program, e.g. a settings page where every control is different. The backend needs the whole program as one fixed list of layers, e.g. an executor that runs a whole layer at once.
- **Used in, long forms and test.** instanced-items' gallery, and src/json-search, where a shader's `for` loop runs the work of one code point over the 512 positions of each document, e.g. the search's step at 8 states is 240 operations at any capacity, and its shader compiles in about 0.02 s ([json-search](../src/json-search/README.md#a-program-as-a-loop-over-positions) has the compile time of the same work written out once per position). [one-program-per-item.md](../lab/ui-exploration/guide/patterns/one-program-per-item.md) and [instancing](../lab/ui-exploration/guide/sections/instancing.md), tested by [one-program-per-item.test.ts](../lab/ui-exploration/guide/examples/patterns/every-item/one-program-per-item.test.ts).

### Growing and shrinking children with min and max

Handing out leftover width in rounds is a loop with a runtime number of rounds, e.g. the loop of the [Clay](https://github.com/nicbarker/clay) layout library, ported in layout-tree, took up to 226 rounds at 64 children over 1,000 random rows. In the final layout, every child's width is `clamp(level, low, high)` for one shared level, and the level can be found without rounds, which is called water filling.

```js
const widths = children.map(child => child.minWidth) // e.g. toolbar buttons that share a row, each growing up to its max-width
let leftover = rowWidth - sum(widths)
while (leftover > 0.01 && children.some((child, index) => widths[index] < child.maxWidth)) {
  const growingCount = children.filter((child, index) => widths[index] < child.maxWidth).length
  const added = children.map((child, index) => Math.min(leftover / growingCount, child.maxWidth - widths[index]))
  added.forEach((width, index) => { widths[index] += width; leftover -= width })
}
```

- **Circuit version.** Let `excess` be the width left after every child gets its low, and `filledAt(p) = Σ relu(p − low) − relu(p − high)` over the children. Each child tests the total at its own clamp points: it keeps its low when `[filledAt(low) >= excess]`, it reaches its high when `[filledAt(high) <= excess]` and it doesn't keep its low, and every other child is free and gets the level, `(excess − Σ atHigh × (high − low) + Σ free × low) / freeCount`, with `1 / freeCount` read through the free count's one-hot. The total only grows as the level rises, so these tests give the clamps the final layout has.
- **Cost.** O(1) layers. layout-tree's widths pass at 64 children is 784 operations in 9 layers when the children's lows and highs are constants, O(n), and 5,601 operations in 12 layers when they're runtime values, O(n²), since each child's test sums over every other child's clamp points.
- **Exact when.** Close, not bit for bit: the example's widths stayed within 0.001 px of a JavaScript loop over the sorted clamp points, on random rows of 1 to 8 children, half of them with many equal clamp points. When FP32 flips a clamp bit near a tie, the widths change continuously, e.g. a child that should be free at level 120.0001 gets clamped at its low of 120, so the flip shows up as drift in widths, not a jump.
- **Don't use it when.** Children wrap to the next line once they don't fit, i.e. flex-wrap: layout-tree scans one child at a time, 1,185 operations in 276 layers at 64 children.
- **Used in, long form, test.** layout-tree's `waterFill`. [Loops, section 6](../lab/ui-exploration/guide/sections/loops.md#6-grow-and-shrink-with-min-and-max-water-filling) with [water-fill.ts](../lab/ui-exploration/guide/examples/loops/water-fill.ts), tested by 'water filling matches a loop over the sorted breakpoints on random children, including equal breakpoints' in [loops.test.ts](../lab/ui-exploration/guide/examples/loops/loops.test.ts).

## Work JavaScript does ahead of time

Work that a loop would redo on every frame runs in JavaScript when the data changes, and the program compares with its results or reads them.

### A layout function of one runtime number

Laying out on every frame runs loops over words and lines. When the result only changes at a few widths, JavaScript finds those widths while preparing, and the program compares the runtime width with them and adds constants.

```js
const layout = layoutMessageList(messages, containerWidth) // e.g. every chat bubble's top, height and width, from a greedy line-breaking loop per message
```

- **Circuit version.** While preparing, the guide example's `findBreakpoints` calls the JavaScript layout as a black box every 1 px, and wherever two samples differ, bisects down to 1/64 px steps. The program computes `[containerWidth >= threshold]` with `emitCompare` for every threshold, and every output is its value below the first threshold plus `change × bit` for each threshold where the output changes. Whatever the layout computes on the way to its outputs, e.g. the text width `Math.min(480, containerWidth * 0.75)`, stays in JavaScript.
- **Cost.** T thresholds cost 2T operations plus one sum per output, in 3 layers whatever the layout does: 5 messages between 160 and 1,280 px have 45 thresholds, and every bubble's top, height and width, plus the content height, are 106 operations in 3 layers. JavaScript calls the layout once per 1 px plus about 6 times per threshold, 1,391 calls, whenever the text changes.
- **Exact when.** The host writes the width on the declared 1/64 px grid, so every comparison is an integer bit and gives the black box's own result at every width the host can write, e.g. all 71,681 widths the test compares. Every output's changes add up exactly, e.g. whole and half pixels far below 2^24, and the width stays within the tabulated range, which the example declares on the width cell. Every change falls between two 1 px samples that differ, which holds for a greedy line breaker, since it only moves line ends forward as the width grows, while with the rich inline layout of [pretext](https://github.com/chenglou/pretext), a text layout library, a paragraph can get more lines as it gets wider.
- **Don't use it when.** The result depends on a second runtime value, e.g. a width and a font scale. Each line has its own width, e.g. text flowing around a dragged window: use the line walker ([text, idea 2](../lab/ui-exploration/guide/sections/text.md#idea-2-the-walker-as-arithmetic)). The text changes at runtime, e.g. appended or edited chat messages, and thresholds that are weights can't change with it: keep each row's sorted thresholds in cells, as in [the next entry](#a-loop-over-data-that-rarely-changes), and count the thresholds that the width reaches with [the count's binary search](#findindex-when-the-test-flips-once-along-the-items), log2(T + 1) reads, e.g. 9 operations per row at 7 thresholds per row in lists' [text-rows.ts](../lab/ui-exploration/lists/text-rows.ts).
- **Used in, long form, test.** text-tabulated's Notes window, hn-thread's comment heights, whose `tabulateStaircase` in text-heights.ts takes the range of container widths and the bisection tolerance, and lists' text rows. When the thresholds come from a closed form, e.g. a grid's column count, the same count replaces one expression and is in [expressions.md](expressions.md), with the long form [threshold-counts.md](../lab/ui-exploration/guide/patterns/threshold-counts.md). [breakpoints-found-ahead-of-time.md](../lab/ui-exploration/guide/patterns/breakpoints-found-ahead-of-time.md), tested by [breakpoints.test.ts](../lab/ui-exploration/guide/examples/patterns/candidates-and-tables/breakpoints.test.ts).

### A loop over data that rarely changes

A loop that walks data on every frame, e.g. up a comment thread, is a chain in the program. When the data only changes between frames, JavaScript runs the loop for every possible input whenever the data changes and writes the results into cells, and the program reads the entry it needs.

```js
let ancestor = row // e.g. the pointed comment's ancestor at the pointed indent level
while (ancestor > 0 && depths[ancestor] > level) ancestor--
```
```txt
depths [0 1 2 1 2 3]    ancestorAtLevel, one row per comment and one column per level, e.g. row 3: [0 3 3 3], row 5: [0 3 4 5]
the program:            ancestor = ancestorAtLevel[row × 4 + level], 1 operation
```

- **Circuit version.** The host writes the table into cells, e.g. the guide example's `prepareAncestorTable(depths, rowCapacity, levelCount)`, and the program reads it with `circuit.indexReadAffine([[row, levelCount], [level, 1]], 0, ancestorTable, 'clamp', 'clamp')`, then e.g. `circuit.indexRead(ancestor, rowTops)`. The table sits in cells, so one compiled program runs any data, and the backward pass gives gradients to a table's values, e.g. a spring matrix, while a read's index gets none: `backpropagateReference` throws there unless the caller passes `{indexGradient: 'zero'}`.
- **Cost.** 1 operation in 1 layer per read at any table size: the ancestor and its top are 2 operations in 2 layers both at 64 rows × 8 levels and at 1,024 rows × 16 levels. JavaScript pays O(table size) whenever the data changes.
- **Exact when.** Each read's index holds an integer within its declared range, strictly inside ±2^24, which `validateIndexReads` checks in tests. Every cell holds a value within its declared range, including rows past the last comment. The table matches the data, so JavaScript rewrites it before the evaluation in which new data can be read.
- **Don't use it when.** The table's inputs change inside the frame, e.g. which comments are collapsed after this frame's click: the table would lag one evaluation. The table grows too fast, e.g. a line break rule over three neighboring classes needs 41 × 41 × 41 = 68,921 cells in code-points. Nothing changes at runtime and nothing will be learned: constants let the builder compute everything whose inputs are known, e.g. ranking 64 items is 64 constant operations when their widths are known while building, and 8,128 when the widths are in cells. Data in cells has its price where the program multiplies by it: every entry is a runtime value, so the program pays for the largest data it can hold, e.g. a search automaton of 32 states over 1,024 code points is 2,297,760 operations with the automaton in cells, and 133,529, 17 times fewer, with one pattern's automaton built into the program as constants, at the price of rebuilding and recompiling the program for each new pattern, in 0.3 to 0.5 s.
- **Used in, long form, test.** code-points' 41 × 41 pair table of line break rules, and the spring matrix that host-timing.ts writes. [tables-javascript-writes.md](../lab/ui-exploration/guide/patterns/tables-javascript-writes.md), tested by [tables-javascript-writes.test.ts](../lab/ui-exploration/guide/examples/patterns/candidates-and-tables/tables-javascript-writes.test.ts).

## More constructions in lab/

lab/ has more constructions for loops. Each one is explained in a section of [the guide](../lab/ui-exploration/guide/README.md) or in a prototype:

- DOM slots for one run of visible rows: slot k shows `firstVisibleRow + k` ([executor, UI jobs under each choice](../lab/ui-exploration/guide/sections/executor.md#ui-jobs-under-each-choice)), or row r goes to slot r % 64, as in the list of HandwiredOS's Monitor window, so that a row keeps its DOM node while it stays drawn ([value-list.ts](../src/handwiredos/value-list.ts)).
- Other ways to find the first hit: earlier-hit counts `relu(hit − hitsBefore)` ([loops, way 1](../lab/ui-exploration/guide/sections/loops.md#circuit-way-1-count-the-earlier-hits)), the largest key ([way 3](../lab/ui-exploration/guide/sections/loops.md#circuit-way-3-the-largest-key)), and numeric-library's exact minimum by counting.
- Per-item constants moved from weights to inputs ([instancing](../lab/ui-exploration/guide/sections/instancing.md#per-item-constants-from-weights-to-inputs)).
- A line's end as a count of "the line through segment j fits" bits, and the next-start table built from those counts ([text, idea 2](../lab/ui-exploration/guide/sections/text.md#a-lines-end-is-a-count)).
- Map lookups by id, e.g. lab/data-adapter's equality-bit lookup over 12 slots ([data-adapter](../lab/data-adapter/README.md)).
- One interpreter program whose rules live in cells, so different state machines run through one compiled program ([chains](../lab/ui-exploration/guide/sections/chains.md#batching-different-chains-together)).
