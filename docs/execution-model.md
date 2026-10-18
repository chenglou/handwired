# Execution model

A handwired program has a fixed number of source cells and an ordered list of instructions. State, constants, and browser inputs enter through the source cells, one `Float32Array`. Each instruction appends one number after them, and a wire is the position of a source cell or of an instruction's number.

Wires have a type of their own, `Wire`, so a plain number doesn't type-check where a wire is expected, e.g. `emitMinimum(circuit, availableWidth, 1)` is refused instead of reading wire 1. `circuit.source(index)` returns a source cell's wire, `circuit.constant(value)` a constant, which is the same wire as `circuit.affine([], value)`, and `asWire(position)` turns a position counted by hand into a wire.

## FP32

`f(x)` means `Math.fround(x)`. Affine terms run in stored order:

```txt
value = f(bias)
for (wire, coefficient) in terms:
  value = f(value + f(f(coefficient) * values[wire]))
```

Ordinary builder expressions normalize terms by ascending wire. Explicitly rounded operations retain the caller's term order, including repeated terms. A backend that guarantees exactly the same values as the reference evaluator, `circuit.evaluateReference`, must keep the stored order, including when inlining remaps wire numbers.

## Instructions and macros

```txt
affine(left)      = left
reglu(left, gate) = f(left * max(0, gate))
boolean(score)   = f(f(f(score) + 8_388_609) - 8_388_609)
index(form, candidates, below, above) = values[candidates[floor(form)]], with a rule outside the table
```

`left`, `gate` and `form` are affine forms, i.e. a bias plus a sum of wires times coefficients. `boolean` accepts `0..1`; values below `0.5` become zero, and the rest become one. The docs call a `boolean` instruction a boolean atom and a `reglu` instruction a ReGLU, which is a ReLU of `gate` when `left` is the constant 1. `index` is described under [index reads](#index-reads). Instructions read sources and earlier instructions, never later ones.

Builder functions, also called macros, e.g. `emitMultiply` or `emitCompare`, expand into these instructions while the program is built. Each macro's exactness contract is in [Macro contracts](#macro-contracts).

`Circuit.affine` is a builder expression: small affine producers can be combined before execution. `Circuit.roundAffine` retains a specific evaluation, term order, and operand wires, so the builder never copies that operation's terms into the operations that read it, which would remove a required FP32 rounding point. It does not combine duplicate terms or move constant terms into the bias. The operation stores the terms array it's given without copying it, so don't change that array afterwards: build a longer sum from a new array, e.g. `circuit.roundAffine([...terms, [limit, 1]])`.

`circuit.multiply` and `circuit.select` record on their outputs which operation they expanded, and the program itself still contains only the four instructions above. The backward pass uses the record to differentiate the whole operation, e.g. a product's gradient for each operand is the other operand's value, where differentiating its ReLUs one by one, with zero slope at their corner, gives no gradient to a gate operand that is 0. The record also keeps the builder from removing the operation's rounding, and lets the compiler recognize masked products. Inlining a circuit preserves it.

Backpropagation differentiates the intended real arithmetic, not literal floating-point rounding. `backpropagateReference` throws when a gradient reaches a boolean atom, unless the caller passes `{booleanGradient: 'straight-through'}`. A soft comparison or a custom derivative is a training choice, not an exact derivative of a hard decision. Index reads have their own gradient options, described below.

## Compilation

Independent instructions at the same dependency depth share a layer. A layer gathers its earlier inputs, evaluates its sparse affine projection, applies gather reads, index reads, ReGLU gates and boolean rounding, and appends outputs.

By default, an instruction's layer is its build-time depth: one more than the depth of the deepest wire it reads. `compileTensorProgram(roots, lowerGathers, {recomputeDepths: true})`, or `createTensorEvaluator(roots, {recomputeDepths: true})`, instead places each live instruction one layer after the deepest value it reads in the compiled program. A masked sum lowered to a gather is then no longer placed after the products it replaced, and the operations after it can move to earlier layers. Compiled programs skip depths that have no live instruction, so the removed products only cost a layer when other live instructions share their depth. The option is off by default. Without lowered gathers, both choices give the same program, e.g. HandwiredOS's.

Compilation removes operations that cannot reach a requested output and may reorder independent values in packed storage. `wireOrder` maps packed values to source wire positions. Removed wires stay zero in a full result array and cannot be requested as outputs.

So `circuit.operations.length` can overstate a program, since some built operations end up with no readers: an ordinary affine sum of fewer than 4 terms is copied into the operations that read it, and a constant wire folds into their biases, while both stay in `circuit.operations`. Operations that keep their rounding, e.g. those of `roundAffine`, `multiply` and `select`, read both as written, so a small sum or a constant that only such operations read stays live. E.g. `sum = circuit.affine([[a, 1], [b, 1]])` read by `circuit.reglu([], 1, [[sum, 2], [c, 1]], -3)` is 2 built operations and 1 live one, and HandwiredOS's circuit holds 5,028 built operations for its 4,646 live ones. Count live operations in the compiled program instead, as `program.valueCount - program.sourceSize` for `program = circuit.compileTensorProgram(roots)`.

Building and compiling take time and memory that grow with the program, and a program of millions of operations takes seconds and gigabytes. E.g. in Bun 1.4.3 on an Apple M5 Max with 36 GB, a program of 2,367,454 built operations builds in about 3 s and compiles in 1.3 to 1.8 s, and the process reaches 4 to 5 GB. A program of 6.9 million built operations builds in about 10 s, compiles in about 5.5 s, and reaches 9 to 11 GB ([measurements](../lab/status.md#the-json-highlighter-and-regex-search-experiments-removed-october-14-2026)). One cost grows with the product of two sizes: `createTensorEvaluator` and `createTensorProgramEvaluator` find each root's packed position with `wireOrder.indexOf`, a scan per root, e.g. 8,001 roots over 400,002 values add about 100 ms to creating the evaluator.

The reference evaluator defines what a program computes, and a compiled program must reproduce every live value. `validateTensorEvaluation(source, circuit, tensorValues)` compares the two with `===`, which ignores zero's sign and fails on NaN, so tests of nonfinite edge cases check for a matching NaN or infinity themselves. That the two evaluators agree doesn't show that a program does what the JavaScript it replaces did. Check that separately against a plain JavaScript reference, as [template/toggle.test.ts](../template/toggle.test.ts) does.

## Declarations

The builder chooses constructions from what the caller declares about wires: `circuit.assumeRange(wire, minimum, maximum)` declares the range of a wire's values, `circuit.assumeGrid(wire, step)` declares that every value is a multiple of `step`, a power of two, e.g. 1/64 for pointer coordinates, see [Grids](#grids), and `circuit.assumeOneHot(members)` declares that the members are exact bits of which exactly one is 1, see [One-hot groups and gathers](#one-hot-groups-and-gathers). E.g. `emitCompare` builds 2 operations instead of 15 when both operands are declared on a grid, and a masked sum over a declared one-hot compiles to one gather.

The usual way to declare the cells of the source table is [cells.ts](../src/runtime/cells.ts), which [tutorial.md](tutorial.md) walks through. A program declares each cell once on a table from `createSourceTable()`, with what happens to the cell around an evaluation, its range, and optionally a grid, e.g. `viewportWidth: input([0, 16_384], {grid: 1})` or `on: stateBit()`. The cell functions are `constant`, `input`, `state` and `event`, with `inputBit` and `stateBit` for exact bits. `list`, `oneHot` and `permutation` declare groups of cells, and `table.atMostOne` adds a rule over declared cells. `table.createCircuit()` then makes the `assumeRange`, `assumeGrid` and `assumeOneHot` calls for every cell before any operation exists. The table also gives each cell its position, the initial table, a validator that checks a source table against every declaration, and, once `table.next` has paired each state cell with its next value and `finish` has run, the wires to write back. `createEvaluator` compiles that program and checks each source table before evaluating it. A computed wire, e.g. an index built from two cells, is declared with the same `assume` calls on the circuit.

For a cell declared as an exact bit, e.g. with `inputBit()` or `stateBit()`, `createCircuit` also calls `circuit.assumeBit(wire)`, which declares the range 0..1 and records that the wire holds exactly 0 or 1, where the range alone also allows 0.5. The record changes no operation that the builder appends, e.g. `emitCompare` still builds a sign cascade for a sum that reads the wire. A backend can read the record, e.g. src/json-search's bit-emit.ts holds such a value as one bit of a 32-bit word in the GPU code that it writes.

Declarations are promises from the caller, not proofs. That goes for `assumeRange`, `assumeGrid`, `assumeOneHot` and `assumeBit`, for the integer index of an index read, and for the exact 0 or 1 in an animated object's `settleCheck` and `snap` cells. A false declaration can still lead to an invalid optimization, e.g. a false grid turns an integer bit into a fraction, and a wire that is declared as an exact bit and holds 0.5 gets GPU code from bit-emit.ts that computes another value than the CPU. Tests check declarations against evaluated values with `validateGrids(circuit, values)`, `validateIndexReads(circuit, values)` and `validateOneHotGroups(circuit, values)`, and the validator from cells.ts checks a source table's ranges, exact bits, grids, one-hot and at-most-one rules.

A declaration doesn't change operations built before it, e.g. `multiply(velocity, timestep)` stays 3 operations when the timestep is declared nonnegative afterwards, so `assumeRange`, and `assumeOneHot` through it, throw when they narrow the range of a wire that an operation already reads, and `assumeGrid` throws when it changes the grid of such a wire, unless the caller passes `{allowExistingReaders: true}`. `inlineCircuit` takes the same option for the source circuit's declared ranges and grids. Declaring a one-hot group whose members already have 0..1 ranges doesn't throw, but builder code that ran before it keeps what it built, e.g. an `emitFirstActive` call over the members that ran earlier declared no group on its own selection. Declaring every cell before the first operation, as cells.ts does, avoids both cases.

Inferred ranges follow the rounded coefficient, product and accumulated sum at each FP32 step, and a product that may not be finite isn't treated as a finite 0.

## One-hot groups and gathers

`assumeOneHot(members)` declares that the members are exact bits of which exactly one is 1, and `assumeOneHot(members, true)` also allows all zeros. Like `assumeRange`, it's a promise from the caller. Two builder functions declare groups themselves. `emitArgmax` always declares its selection. `emitFirstActive` declares its selection only when the gate and every candidate are proven bits: a wire whose declared range contains only 0 or only 1, a boolean atom, the bit `emitCompare` returns, a member of a declared one-hot group, or an index read whose reachable candidates are all proven bits, where an out-of-range side with the `'zero'` rule adds +0, which is also a bit. E.g. a read of a table of hit test bits at a computed row qualifies, while a read that can reach an opacity within 0..1 doesn't. An operation inside `emitCompare`, e.g. a sign cascade stage within 0..1, isn't a proven bit.

A masked sum covering each group member exactly once can become a gather when every candidate has finite FP32 bounds. The executor resolves the group's index once, then reads one candidate per gather. When a candidate's bounds admit infinity, the masked sum must remain dense, since an unselected `Infinity * 0` can produce NaN. Bounds follow each rounded operation; finite float64 endpoints alone are insufficient.

The compiler recognizes the products `circuit.multiply` builds, with the member on either side, e.g. `Σ multiply(selected[j], height[j])`, and the same products written as ReGLUs: `f(value × max(0, bit))` for a value with finite bounds, `f(bit × max(0, value))` for a value with finite nonnegative bounds, and the pair `f(bit × max(0, value)) - f(bit × max(0, -value))` for a value that may be negative. The sum can have a bias, and a candidate can be an earlier gather read. `circuit.multiply` keeps a product with the constant 0, e.g. for a member whose candidate is always 0, so the sum still covers that member. A sum with any other term, a scaled term, e.g. `2 × multiply(selected[1], height[1])`, a missing member, or products of two groups stays dense, since replacing only part of a sum would change the order in which FP32 adds its terms. `inlineCircuit` copies the inlined circuit's groups onto the mapped wires. The builder doesn't infer groups through computation, e.g. a permutation computed from a declared permutation has no group until the caller declares one. A masked sum over fewer than 4 members has fewer than 4 terms, and the builder copies such a sum's terms into each operation that reads the sum, so the reading operation holds the products next to its other terms and stays dense. E.g. with 3 members, a masked sum requested as an output lowers to one gather, while `2 × sum + offset` keeps the 3 products live.

The gather returns `f(bias + selected candidate)`, where the executor computes the selected index as `Σ j × member[j]`, an exact whole number for exact bits. For a group that allows all zeros, the candidate is first multiplied by the sum of the members, so an inactive group adds 0. The dense sum returns the same value apart from the sign of an exactly zero result, because the dense sum also adds the zeros of the unselected products in wire order, e.g. over an inactive group with a `-0` bias, the dense sum returns `+0` and the gather returns `-0`. `validateTensorEvaluation` treats these as equal. When a declaration is false, e.g. two members hold 1, the executor clamps the index to the table, so the gather doesn't read outside the table, but returns a different value from the dense sum. `validateOneHotGroups` catches the false declaration in tests.

Gather lowering only shortens the read after a selection exists: the selection and every candidate are still computed.

## Index reads

`circuit.indexRead(index, candidates, {outOfRange})` appends one instruction that copies `candidates[floor(index)]`, e.g. the height of the row at a computed row index. `circuit.indexReadAffine(indexTerms, indexBias, candidates, below, above)` takes the index as an affine form and a rule per side, e.g. `[[firstRow, 1]]` with bias 3, `'clamp'` and `'zero'` reads the fourth visible row, and +0 past the end of the table. Small affine producers compose into the index form, as they compose into a ReGLU gate.

```txt
index = f(form)                                  the usual FP32 accumulation
position = floor(index)                          in float64, so nothing rounds
read = values[candidates[position]]              for 0 <= position <= count - 1
     = values[candidates[0]] or +0               for position < 0, per the below rule
     = values[candidates[count - 1]] or +0       for position > count - 1, per the above rule
     = NaN                                       for a NaN index
```

The selected value is copied without any rounding step, so `-0`, `Infinity` and `NaN` candidates come through unchanged, and integers and bits read through a table stay exact.

The contract:

- The index needs a declared range strictly inside ±2^24, where every integer is an FP32 value. Ranges follow FP32 rounding, so an endpoint that lands on ±2^24 can stand for a larger real value, and the builder refuses it: `indexReadAffine([[cell, 1]], 1, candidates, 'clamp', 'clamp')` with the cell declared within 0..2^24 has the range endpoint f(2^24 + 1) = 2^24, and at cell value 2^24 the read would land one position early. The builder also refuses an open range, e.g. an index built from a source cell without `assumeRange`. It infers the index form's range from the declared ranges of the form's operands, then narrows it with the range declared on the index wire of `indexRead`, or with `{indexRange: {minimum, maximum}}` for `indexReadAffine`.
- An integer index is computed exactly when every product and partial sum of its form is an integer within that span, e.g. `firstRow + 3` with `firstRow` declared in 0..9999.
- The range declared on the index wire is used even when the builder copies a small affine index into the read. E.g. `row = circuit.affine([[firstRow, 1], [offset, 1]])` followed by `circuit.assumeRange(row, 0, 999)` builds while `firstRow` and `offset` have no declared ranges, since the copied form adds the same terms in the same order and holds the exact value of `row`.
- The index must hold an integer. The builder can't check that, so `validateIndexReads(circuit, values)` checks in tests that every index form holds an integer within the range the builder accepted. E.g. an index built as `scrollTop / 28` fails at `scrollTop` 14.
- A NaN index only happens when a declared range on a computed wire is false, e.g. `assumeRange(difference, 0, 9)` on `a - b` while both cells hold `Infinity`. Both evaluators then read NaN.
- Candidates can be any earlier wires, can repeat, e.g. `[a, a, b]`, and need no declared range. With a constant index, the builder selects the candidate while building, and identical reads return one wire.
- The read's inferred range is the union of the ranges of the candidates its index range can reach, plus 0 when a side with the `'zero'` rule is reachable. E.g. an index declared in 2..9 over 4 candidates, with `'zero'` above, covers candidates 2 and 3, plus 0. A candidate with no declared range makes the read's range open.
- The builder freezes the candidates array and records it in a map keyed by the array's identity, so a table read many times is checked once. Changing the array after a read throws. Arrays with the same content share one table.

For an integer index, the read equals a one-hot masked sum over the same table, e.g. bits `[index >= j] = relu(index - j + 1) - relu(index - j)`, subtracted pairwise and multiplied into the candidates. The two differ in three cases, which `index-read.test.ts` checks:

- A fractional index: the read floors, while the ReLU bits interpolate. At index 2.5 over `[28, 44, 28, 60]`, the read returns 28 and the masked sum returns 44.
- An infinite candidate: the read returns the selected value, while the masked sum returns NaN, because an unselected `Infinity * 0` is NaN.
- A selected `-0`: the read returns `-0`, while the masked sum returns `+0`, since its accumulation starts from `+0`. `validateTensorEvaluation` treats these as equal.

In a tensor layer, an index read is one output row with no weights and no bias, plus one projection row after the gate rows that holds the index form. After the sparse matrix multiplication, the executor floors that row in float64 and copies the chosen candidate's packed value into the output row. A table whose candidates are at evenly spaced packed positions, e.g. a run of source cells, a reversed run or one repeated wire, is stored as a base position and a stride, so reading a 10,000-cell column costs one operation, one stored weight and no stored positions. Other tables store one position per candidate, and every read of the same table shares that array.

Backpropagation gives the selected candidate the output gradient, like the backward pass of a gather, so two reads of the same candidate add their gradients. The read is a step function of the index: its derivative is 0 between integers and undefined at them. By default, `backpropagateReference` throws when a nonzero gradient reaches an index read, so a training loop can't silently receive zeros for the index. `{indexGradient: 'zero'}` gives the index form no gradient. `{indexGradient: 'backward-difference'}` gives it `read(i) - read(i - 1)` at `i = floor(index)`, with the same rule outside the table, which is what the same backward pass gives the ReLU one-hot masked sum at an integer index.

Gather lowering is for selections that already exist as declared one-hots, e.g. `emitArgmax`'s output. For a read at a computed integer, use an index read: over 10,000 entries, a ReLU one-hot masked sum compiles to 30,002 live operations and 49,998 stored weights with gather lowering, while the index read compiles to 1 operation and 1 stored weight.

## Comparisons

`emitCompare(circuit, a, relation, b)` returns an exact bit of `a > b`, `a >= b`, `a < b`, `a <= b` or `a === b`, e.g. `emitCompare(circuit, pointerX, '>=', windowLeft)`. For every pair of values within the declared ranges, the bit equals JavaScript's comparison of the two wires' FP32 values. A threshold is a constant wire, e.g. `circuit.constant(3)`, which folds into the bias. JavaScript compares an FP32 value with a threshold that isn't an FP32 value, e.g. 5/24, the way it compares with the smallest FP32 value at or above that threshold, while `f(5 / 24)` is below 5/24, so pick the FP32 threshold before building.

The construction depends on the declarations, not on the call site:

- Both operands need finite declared ranges. The builder refuses an open range, e.g. a raw `requestAnimationFrame` timestamp, and refuses ranges whose difference can overflow FP32, e.g. two operands declared within ±3.4e38.
- When both operands lie on [grids](#grids) and every partial sum stays within 2^24 grid steps, the bit is built from the integer `D = (a - b) / grid`: `a >= b` is `relu(1 - relu(-D))`, which equals `relu(D + 1) - relu(D)` at every integer, `a > b` is `relu(1 - relu(1 - D))`, and `a === b` is `relu(1 - relu(D) - relu(-D))`. Every product and partial sum is a whole number of grid steps, so nothing rounds.
- Otherwise the difference `d = f(a - b)` stays its own operation, and a sign cascade turns it into a bit. For finite FP32 operands, `d` is 0 exactly when `a === b`, and otherwise has the sign of `a - b`, since subnormal values fill the gap next to 0. Each stage computes `min(limit, scale × input)` as `x - relu(x - limit)` with a power-of-two scale, which is exact while `x` is at most `2^24 × limit`. The stages are planned from the declared ranges until every nonzero `d`, down to 2^-149, reaches at least 1. E.g. operands within 0..16,384 get the scales 2^10, 2^24, 2^24, 2^24, 2^24, 2^24 and 2^19, and any finite bound needs at most 12 stages.

`{endWithBoolean: true}` ends with a boolean atom instead. The cascade then stops once every nonzero difference reaches 2^-45 and rounds a score next to 0.5, and grid operands use one atom on the score `0.5 + D × 2^-24`, which needs every partial sum within 2^22 grid steps. The atom needs an executor that keeps FP32 rounding at the atom, and `backpropagateReference` rejects it unless `booleanGradient` is `'straight-through'`.

The limits above come from the declared ranges. Integer bits count every partial sum of `sign × D + offset`, with the bias added first, against the 2^24 grid steps that FP32 holds exactly. The atom needs 2^22 grid steps because every partial score `0.5 + k × 2^-24` then stays within 0.25..0.75, where FP32 represents every multiple of 2^-24. In the sign cascade, a declared difference bound above 2^24 first comes down by up to 2^24 per stage without multiplying, since multiplying by less than 1 would round the smallest differences to 0, e.g. a first stage that multiplies by 2^-7 for a bound of 2^30 returns 0 for `2^-149 > 0`. Coefficients stay at most 2^127.

Costs, for operands within 0..16,384, or within ±8,192 on a 1/64 grid:

| Construction | `a > b` | `a >= b` | `a === b` |
| --- | --- | --- | --- |
| sign cascade | 16 operations, 15 layers | 15 operations, 14 layers | 28 operations, 14 layers |
| sign cascade ending with a boolean atom | 15 operations, 13 layers | 14 operations, 13 layers | 25 operations, 13 layers |
| integer bits on a 1/64 grid | 2 operations, 2 layers | 2 operations, 2 layers | 3 operations, 2 layers |
| one boolean atom on a 1/64 grid | 1 operation, 1 layer | 1 operation, 1 layer | 3 operations, 2 layers |

A small affine operand, which the builder normally copies into the operations that read it, becomes its own operation, since the bit is exact for the operand's own FP32 value. When grid operands span more than 2^24 grid steps, e.g. operands within 0..2^18 on a 1/64 grid, `emitCompare` builds the sign cascade instead.

What is guaranteed: on the CPU, the bit is correct for every nonzero FP32 difference, down to 2^-149. A backend that turns subnormal values into 0 may return the bit for equal operands when a difference is below 2^-126, as native comparisons on that hardware do too, e.g. on an Apple GPU. Two operands can only differ by that little when both are smaller than about 2^-103.

Backpropagation runs through integer bits and the sign cascade with no special case, since both are made of ReLU products. A cascade gives its operands gradient 0, the derivative of a step. Integer bits give an operand a nonzero gradient only when `D` is a fraction strictly between -1 and 1, e.g. between -1 and 0 for `a >= b`, and that gradient is ±1/grid, e.g. ±64 on a 1/64 grid. That only happens when a grid declaration is false.

`emitMinimumExact`, `emitMaximumExact` and `emitClampExact` select one operand with a comparison bit as `on × relu(bit) + off × relu(1 - bit)`, so the result is exactly one of the operands, e.g. `min(f(1000.37), f(0.3))` returns `f(0.3)`, while `emitMinimum` rebuilds it through a rounded difference and returns 0.29998779. Ties return the first operand, so the result differs from `Math.min` at most in the sign of zero.

HandwiredOS's window hit tests show what the declarations cost. A press hits a rectangle when it's at least half a pixel inside, so each rectangle compares its 4 edge distances with 0.5, e.g. `emitCompare(circuit, pointerX - windowLeft, '>=', half)`, and combines the bits as `relu(sum of bits - 3)`. The host rounds pointer coordinates and the viewport to 1/64 px and clamps pointer coordinates within ±32,768 px, and the pixel constants, window geometry and bit cells are declared on grids, so each comparison is an integer bit, and rectangles that share an edge, e.g. a window and its title bar, share that edge's bit. With pointer coordinates within ±65,536 px instead, each title bar's right edge distance spans more than 2^24 steps of its 1/128 px grid, and that comparison becomes a sign cascade, 13 more operations per window. Without grids on the window geometry, every hit test comparison is a sign cascade, 13 or 14 more operations for each. `{endWithBoolean: true}` doesn't fit these ranges either: the one-atom form needs every partial sum within 2^22 grid steps, so `emitCompare` would build sign cascades. The dock items' edges lie on no grid, since the dock divides a width by 3, so each item uses one boolean atom, `boolean(clamp01(min of the 4 edge distances))`, which costs fewer operations than sign cascades.

## Grids

A grid is declared with `circuit.assumeGrid(wire, step)`, e.g. `assumeGrid(pointerX, 1 / 64)` when the host writes pointer coordinates in 1/64 px, and checked in tests with `validateGrids(circuit, values)`, see [Declarations](#declarations).

The builder also infers grids it can prove. In a sum or a ReGLU product of wires with grids, each term contributes its wire's grid times the largest power of two dividing its coefficient, e.g. `0.5 × pointerX` lies on a 1/128 grid, and the result lies on the smallest of those grids, as long as every product and partial sum stays within 2^24 grid steps according to the declared ranges. E.g. `pointerX - dragStartX` on a 1/64 grid lies on the 1/64 grid, while `pointerX / 3` has no grid. Boolean atoms and comparison bits have grid 1. Index reads get no inferred grid, so declare one on a read before comparing it, e.g. `circuit.assumeGrid(rowHeight, 1)` for a read of whole-pixel row heights, or `emitCompare` builds a sign cascade. `circuit.constant(0)` gets no inferred grid either, since 0 is a multiple of every power of two and the builder picks none. `circuit.affine` folds a constant into its bias, so the constant's grid doesn't matter there, but `circuit.roundAffine` keeps reading the constant, and its sum gets no grid. E.g. with `count` within 0..1,000 on grid 1, comparing `circuit.roundAffine([[circuit.constant(0), 1], [count, 1]])` with `circuit.constant(3)` builds a 15-operation sign cascade, while comparing `circuit.roundAffine([[count, 1]])` builds a 2-operation integer bit. So start a running total from its first item rather than from `circuit.constant(0)`.

## Rounding points

The builder records rounding points: operations where the exact FP32 evaluation, term order and operand wires matter. `circuit.roundingPoints()` returns them in wire order, each with a kind:

- `'boolean'`: every boolean atom, recorded automatically. `(score + 8,388,609) - 8,388,609` only rounds to a bit when evaluated in FP32 as written, and a shader compiler that simplifies it to `score` breaks it. A backend keeps the stored FP32 evaluation.
- `'integer bit'`: every operation of `emitCompare`'s integer bits on grids, e.g. the ramp `relu(-D)` and the bit `relu(1 - relu(-D))` on `D = (a - b) / grid`. Every product and partial sum is a whole number of grid steps within 2^24, so a backend may add an operation's terms in any order, fuse them, or evaluate them in float64, and gets the same bits, as long as each operation stays its own operation.
- `'sign cascade'`: every operation of `emitCompare`'s sign cascade, i.e. the kept difference `f(a - b)`, which only has to keep the sign of `a - b`, and each stage `min(limit, scale × input)`, which computes exact values in real arithmetic. A backend may evaluate an operation's own sum in any order or in float64, but must keep each operation separate and reading the same wires, e.g. copying a stage into the next stage regroups terms at large magnitudes, and the partial sums round. The smallest differences also need subnormal values: a backend that turns subnormal values into 0 returns the bit for equal operands when a difference is below 2^-126.
- `'marked'`: operations recorded with `circuit.markRoundingPoint(wire)`, e.g. each step of a round chain `(x + 2^23 + 2^22) - (2^23 + 2^22)` built with `roundAffine`, as `emitRound` in src/handwiredos/value-list.ts builds it. A backend keeps the stored FP32 evaluation, term order and operand wires, like at a boolean atom.

A backend that reorders or fuses sums, or a GPU backend that guards against its shader compiler simplifying `(x + K) - K`, can keep the stored evaluation at these operations and relax it elsewhere. In six of seven UIs measured, stored order mattered only at boolean atoms, round chains and comparison differences ([lab/ui-exploration/codegen](../lab/ui-exploration/codegen/README.md#merged-from-exactness-budget-september-16-2026)). The builder records atoms and `emitCompare`'s operations itself, and round chains need `markRoundingPoint`. Inlining keeps the records. In circuits without `emitCompare` or marks, only the boolean atoms are recorded. HandwiredOS records 59 boolean atoms, 707 integer bit operations and 33 marked operations, the last being one settle score per `emitAnimatedObject` and the 2 steps of each round chain in Monitor's list.

## Springs and time

A spring runs as many fixed 4 ms steps as the elapsed time allows, and a program can't loop a runtime number of times, so JavaScript counts the steps and writes the effect of all of them into cells. `host-timing.ts` holds that host code: float64 functions that run between evaluations, never build operations and never touch the DOM. It's a separate module so that FP32 program semantics and float64 host arithmetic don't mix in one file.

### What JavaScript writes

- Times on a 1/64 ms grid. `quantizeTimeMs` rounds absolute timestamps before subtracting, so the durations of any split of a time span add up exactly. `quantizeFrameTiming(frameTimeStamp, previousFrameTimeMs, eventTimeStamps)` returns the frame's duration, 0 for the first frame after idle, and each event's time relative to the frame, e.g. -3.5 for a press 3.5 ms before the frame. Absolute timestamps stay in JavaScript, since an FP32 cell holding `performance.now()` stores it on a 0.5 ms grid from about 70 minutes into a session.
- A spring matrix per stiffness and damping pair. One semi-implicit Euler step of 4 ms, which updates the velocity from the spring and damping forces and then the position from the new velocity, is a 2×2 matrix on (displacement from the destination, velocity), so n steps are that matrix to the power n. Before each evaluation, JavaScript writes `springMatrixPower(springStepMatrix({stiffness, damping}), steps)` into the pair's 4 cells. Stiffness and damping stay editable, since they only enter the float64 computation.
- A settle check bit, a snap bit, and the evaluation's events.

### In the program

`emitApplySpringMatrix(circuit, matrix, displacement, velocity)` computes `(m0 × e + m1 × v, m2 × e + m3 × v)` with 4 `circuit.multiply` products: 14 operations in 3 layers for any step count. For displacements within ±2,000 px, velocities within ±5,000 px/s and up to 300 steps, the result is within 1e-3 px and 1e-2 px/s of a float64 Euler loop. The matrix cells need finite declared ranges, e.g. `±springMatrixBound(constants)`, so a host that writes an overflowing matrix fails the source range check.

`emitAnimatedObject(circuit, springs, {settleCheck, snap})` steps every spring of one animated object, e.g. a window's x, y, width, height and scale, and settles all of them with one exact bit. Each spring stores its displacement from its destination and its velocity, not a position:

```txt
(displacement', velocity') = matrix × (displacement, velocity)
displacement'' = f(f(destinationDuringSteps - destination) + displacement')
exceedance = Σ over springs of relu(|displacement''| - distance) + relu(|velocity'| - speed)
atRest = 1 when every displacement'' and velocity' is ±0, otherwise 0
settled = boolean(relu(0.5 × settleCheck + 0.5 × atRest - 2^20 × exceedance))
active = (1 - settled) × (1 - snap)
next displacement = f(displacement'' × active)
next velocity = f(velocity' × active)
position = f(destination + next displacement), drawn but not stored
```

It returns `{displacements, velocities, positions, settled, active}`: one wire per spring in the first three, i.e. the next displacement and velocity to write back and the position to draw, and two bits for the object, `settled` and `active`, where `active` is 1 while the object still moves.

The second line rebases the displacement onto this evaluation's destination. It adds the destination difference first, so when the destination is unchanged, the line adds exactly 0 and returns the stepped displacement unchanged, and rounding happens once per retarget instead of once per evaluation. FP32 then rounds the stored state at the size of the displacement and velocity rather than of the position, e.g. finely near rest at 100,000 px, where positions are 1/128 px apart. The drawn position rounds once at the destination's magnitude, and since it isn't stored, that rounding never builds up. Springs that store positions instead can fail to settle near 100,000 px.

A sum of nonnegative FP32 values is 0 only when every term is 0, so `exceedance` is 0 exactly when every spring is within both thresholds, e.g. `|displacement''| <= f(0.01)`, which is the same test as `< 0.01`, since no FP32 value lies between the two. The thresholds default to 0.01 px and 0.01 px/s, which fit a spring in pixels. A spring in another unit passes its own `settleDistance` and `settleSpeed`, e.g. the zoom of a photo in HandwiredOS's Photos goes from 0 to 1 and passes 2^-16 for both, since 0.01 of the photo's way is 10 px for a photo that grows by 1,000 px, which would show as a jump when the spring settles. `atRest` is built on the same fact: the ReLUs of every displacement and velocity are multiplied by 2^127 and added, so a nonzero value, down to 2^-149, adds at least 2^-22, and `relu(1 - 2^22 × sum)` is the bit. A settled or snapped object lands exactly on its destinations with zero velocity, up to the sign of zero.

- `settleCheck` is a bit the host writes. An object within both thresholds only settles while `settleCheck` is 1.
- An object whose springs are all exactly at rest, e.g. right after a snap, settles at any evaluation, so the object counts as not animating instead of staying active until the next settle check. Steps keep a spring at exact rest there until a destination changes, so settling at exact rest doesn't depend on which step counts the frames land on.
- `snap` places the object on its destinations, e.g. while the user drags it, or when `advanceFrame` plans a snap.
- `destinationDuringSteps` is the destination the stored displacement is measured from: the one the previous evaluation wrote back, usually a state cell, since the steps simulate time before this evaluation's events. It defaults to `destination`, which is right when this evaluation's events can't change the destination.
- The settle score adds `settleCheck` and `atRest` first, so the partial sum is exactly 0, 0.5 or 1 before the exceedance is subtracted, and 0.5 - 2^20 × 2^-45 is the FP32 value just below 0.5. The score is recorded as a `'marked'` rounding point.

Cost: 29 operations in 11 layers for an object of one spring, 52 operations for 2 springs, and 128 operations in 13 layers for 5 springs with a snap bit and separate destinations during steps. For comparison, `emitSpring`, which runs 4 Euler steps inside the program with stiffness, damping and the timestep as wires, is 46 operations in 33 layers for one spring.

### The ordering rule

Before an event with timestamp T is applied, springs step to T toward the destinations in effect before T, and a stopped clock starts at T. So a new destination starts pulling within 4 ms of T at any frame rate.

The familiar order, a frame that handles its inputs and then steps springs up to its timestamp, as in [ui.md](https://github.com/chenglou/chenguini/blob/main/docs/ui.md) of chenguini, a set of engineering and UI guidelines, depends on the frame rate when a destination changes between two frames: the new destination pulls from up to one frame plus 4 ms before the event, and an animation from rest starts up to one frame after the event. In a float64 copy of that order, 10, 30 and 60 fps differ from 120 fps by up to 359, 124 and 53 px at shared timestamps ([behavior-choices.md](behavior-choices.md#apply-events-at-their-timestamps-and-write-state-back-only-at-events-and-settle-checks)).

`advanceFrame(clock, frameTimeStamp, events, evaluate, writeBack)` plans a frame's evaluations in the rule's order. For each distinct event timestamp, an `'events'` evaluation runs the steps up to that timestamp and applies the events. Then a `'frame'` evaluation runs the steps up to the frame's timestamp. The host's `evaluate` callback writes each evaluation's matrices, settle check bit and events, runs the program, writes next state back when the evaluation's `writesBack` is true, and returns whether anything animates. The host keeps requesting frames while the returned clock runs.

### Settling at fixed simulated times

A spring can be within both thresholds at one step count and above the speed threshold a few steps later, as the remaining displacement accelerates it again. So a settle check once per frame depends on which step counts the frames happen to land on.

`advanceFrame` checks settling at simulated times `checkOriginMs + 64 k` ms, counted from when the clock started, with `'settle check'` evaluations that run steps up to that time with the settle check bit set, and at any evaluation while the clock is stopped. A check at simulated time c runs before events with timestamps at or after c, so at every frame rate, the check tests the same state against the same destinations. When the `evaluate` callback returns that nothing animates, the clock stops, and the next evaluation's duration is 0. The checks cost one more evaluation per 64 ms of animation, e.g. about one in four frames at 60 fps.

### Which evaluations write state back

With `'every evaluation'`, every evaluation writes next state back, so FP32 rounds the stored displacements and velocities once per evaluation, by different amounts at different frame rates. That rounding scales with the displacement, so it shrinks as springs come to rest: in the traces of [spring-matrix.test.ts](../tests/runtime/spring-matrix.test.ts), at 10, 30, 60 and 120 fps and with 500 ms stalls, positions stay within 1.4e-4 px of float64 springs whose steps don't depend on frame times, and within 1.5e-4 px of the 120 fps run, and springs settle at the same simulated times as float64.

With `'events and settle checks'`, only `'events'`, `'settle check'` and `'snap'` evaluations write state back, and a `'frame'` evaluation runs the program on a copy of the table. Stored state then depends only on the events, as long as no snap runs, see [Static bounds](#static-bounds): in the same traces, every stored table and every drawn output at a shared timestamp is identical in every bit at every frame rate, springs settle at the same simulated times as float64, and positions stay within 7.4e-5 px of float64. Use `'events and settle checks'` where stored state must be bit-identical across frame rates, e.g. to replay recorded events. HandwiredOS uses it.

Both policies keep these results far from the origin, since springs store displacements. With the same traces moved to 65,536, 131,072 and 1,048,576 px, springs settle at the same simulated times as float64. Up to 131,072 px, stored displacements stay within 1.4e-4 px of float64, and drawn positions within 3.9e-3 and 7.9e-3 px, half of FP32's spacing at those positions. At 1,048,576 px, FP32 values are 1/8 px apart, so a destination on a finer grid, e.g. 1/64 px, rounds before it reaches the program, and displacements differ from float64 by up to 0.10 px.

### Static bounds

- A frame's evaluations run at most `maxStepsPerFrame` steps together, 300 by default (1,200 ms), like ui.md's cap. Before each `'events'` or `'frame'` evaluation, when stepping to its time would run more steps than what's left of that budget, a `'snap'` evaluation runs first: the host writes 1 into the program's snap cells, e.g. the `snap` option of every `emitAnimatedObject`, every object lands on its destination with zero velocity, and the clock stops, which discards the backlog of steps. The evaluation then runs with the clock stopped. E.g. the first frame after a 2 s stall runs a snap and no steps, and shows every object at its destination.
- An event during such a stall still applies at its own timestamp. When stepping to the event would exceed what's left of the budget, springs first snap onto the destinations in effect before it, so its animation starts at its timestamp. When stepping from the event to the frame would exceed the budget too, springs snap again, onto the event's destinations. E.g. with a press 2.9 s before the first frame after a 3 s stall, the springs step to the press and snap before the frame.
- A snap's result doesn't depend on when it runs, but whether a snap runs depends on the frame times. The steps count from where springs last stepped in state that was written back. With `'every evaluation'`, that's less than 4 ms before the previous frame, so a frame gap of at most 1,200 ms never causes a snap. With `'events and settle checks'`, a frame evaluates a copy, so the steps count from the last event or settle check, which is less than 64 ms before the previous frame, and a frame gap from just above 1,140 ms can cause a snap, e.g. a 1,144 ms gap after an event at 0 ms and a frame at 60 ms, where `'every evaluation'` needs a 1,204 ms gap. Such a gap can cause a snap at one frame rate and not at another, and make stored state differ across frame rates. A stall that makes every frame rate snap, e.g. 3 s, leaves stored state bit-identical across them.
- This rule keeps the static bound: no frame runs more than 300 steps, and no time carries into later frames. `quantizeFrameTiming` clamps durations and event times to 1,200 ms.
- An event with a timestamp before the last evaluation that wrote state back applies at that evaluation's time, and an event after the frame's timestamp at the frame's.
- Inputs that change destinations, e.g. a viewport resize, should reach `advanceFrame` as timestamped events when stored state must be frame-rate independent. A destination computed from a cell that JavaScript overwrites every frame, e.g. a viewport width written without a resize event, changes at frame times, so springs pull toward it from frame times again.

### Magnitude limits

The exact settling and rebasing above hold while what the host writes stays within these limits:

- Matrix cells: declare them within `±springMatrixBound(constants)`, the largest `|entry|` of `M^n` for `n = 0..maxStepsPerFrame`, with headroom so every FP32 entry the host writes stays within it, e.g. 10.36 for stiffness 650 and damping 45. `springMatrixBound` throws for a spring whose powers overflow, e.g. stiffness 1e7 with 4 ms steps.
- Settle thresholds: at least 2^-22. A nonzero `relu(offset - threshold)` is at least the FP32 spacing just above the threshold, which is 2^-45 or more, and `2^20 × 2^-45 = 2^-25` is the spacing just below 0.5, so the boolean atom rounds the settle score to 0. E.g. at the default threshold of 0.01, a nonzero `relu(offset - threshold)` is at least 2^-30.
- Retargets: the rebase is `f(f(oldDestination - newDestination) + displacement)`. The destination difference is exact for destinations on a power-of-two grid within 2^23 grid steps, or of the same sign within 2^24 grid steps, e.g. whole-pixel destinations near 2^20, so only its sum with the displacement rounds, once per retarget. Destinations of opposite signs farther out can round the difference too, e.g. `(2^23 + 1) / 64` and `-(2^23 + 2) / 64` on the 1/64 grid differ by `(2^24 + 3) / 64`, which FP32 rounds to `(2^24 + 4) / 64`, so the drawn position moves by 1/64 px at the retarget. A destination that isn't an FP32 value rounds before it reaches the program, e.g. FP32 values near 2^20 px are 1/8 px apart.
- Rest bit: a backend that turns subnormal values into 0 also turns a displacement below 2^-126 into 0, so that displacement counts as rest.
- Times: `quantizeFrameTiming` returns durations and event times that are multiples of 1/64 ms within `maxStepsPerFrame × stepMs`, 1,200 ms by default, i.e. within 76,800 grid steps, which FP32 holds exactly in a cell. It clamps there, since springs snap past it, and `validateSpringClockConfig` refuses a configuration past 2^24 grid steps. `advanceFrame`'s `PlannedEvaluation.durationMs`, the time since the last evaluation that wrote state back, isn't clamped, e.g. 2,000 ms for the snap after a 2 s stall. A cell that holds it needs a declared range of its own, and FP32 holds it exactly only within 2^24 grid steps, 262,144 ms.

### Gradients

The backward pass reaches the 4 matrix cells: `circuit.multiply` gives each cell `displacement × outputGradient` or `velocity × outputGradient`, including at an entry of exactly 0, like the identity matrix at 0 steps. Stiffness and damping never reach the program, so the backward pass gives them nothing. JavaScript can finish the chain rule by summing `d output / d entry × d entry / d stiffness` over the 4 entries, with `d entry / d stiffness` from the float64 matrix power; a measurement in lab/ui-exploration/guide/sections/differentiability.md shows that this sum equals central differences of the whole spring. The settle bit is a boolean atom, so `backpropagateReference` throws unless `booleanGradient` is `'straight-through'`, and the gradient of a settled object reaches only its destinations. For the rest bit, the ReLUs of every displacement and velocity are multiplied by 2^127 and summed inside a ReLU, so at exact rest the backward pass stops at that ReLU's corner instead of scaling gradients by 2^149. Exact settling says nothing about whether gradients through many steps stay usable.

A closed-form matrix, `exp(A × elapsed)` with `A = [[0, 1], [-stiffness, -damping]]`, could replace the Euler power later without changing the program.

## Macro contracts

Exactness means equality to the stated FP32 calculation, ignoring the sign of zero, not equality to arbitrary JavaScript float64 arithmetic. The contracts are tested in tests/runtime/, by numeric-semantics.test.ts, macro-ranges.test.ts, index-read.test.ts, comparison.test.ts, spring-matrix.test.ts and gather-lowering.test.ts.

| Macro | Forward calculation | Exactness contract |
| --- | --- | --- |
| `emitMultiply(a, b)` | One ReGLU product, or for signed operands the difference of positive and negative products, `a × relu(b) - a × relu(-b)` | Equals `f(f(a) × f(b))` for finite operands, including a product overflowing to infinity. For signed operands, only one of the two products is nonzero, so the subtraction adds no error |
| `emitMaximum(a, b)` | `b + relu(a - b)` | Integer operands with magnitudes below 2^23; fractional operands can drift, see [Minimum and maximum](#minimum-and-maximum) |
| `emitMinimum(a, b)` | `a - relu(a - b)` | Same restriction as maximum |
| `emitSelect(gate, off, on)` | `gate × on + (1 - gate) × off`, with preserved rounding | At a gate of exactly 0 or 1, returns the corresponding finite operand exactly, including extreme magnitude differences, see [Selection](#selection) |
| The clamp to 0..1, `relu(v) - relu(v - 1)` | Two ReLUs and a subtraction | The upper plateau requires `v <= 2^24` when `v` is its own operation. When `v` is a small affine sum that the builder copies into both ReLUs, both copies must add without rounding, e.g. `v <= 2^23` for multiples of 1/2, see [Clamping](#clamping). Negative finite values produce 0 |
| Settled `emitSpring` | Select destination and multiply velocity by zero | Once its active bit reaches zero and the operands are finite, destination and zero velocity are exact. That depends on reaching an exact inactive bit, and doesn't imply that every integration step before settling equals a float64 spring's |
| `emitCompare(a, relation, b)` | Integer bits on `D = (a - b) / grid` when both operands lie on grids within 2^24 grid steps, otherwise the kept difference `f(a - b)` and stages of `min(limit, scale × input)` | An exact bit for every pair of FP32 values within finite declared ranges whose difference can't overflow, subnormal differences included, see [Comparisons](#comparisons) |
| `emitMinimumExact`, `emitMaximumExact`, `emitClampExact` | A comparison bit, then `on × relu(bit) + off × relu(1 - bit)` | Returns exactly one operand, up to the sign of zero; ties return the first operand, see [Comparisons](#comparisons) |
| `emitApplySpringMatrix(matrix, e, v)` | Four multiply products, summed per row | Equals `f(f(m0 × e) + f(m1 × v))` and `f(f(m2 × e) + f(m3 × v))` for finite operands, see [In the program](#in-the-program) |
| `emitAnimatedObject(springs, options)` | Matrix steps on each spring's stored displacement and velocity, a rebase onto the new destination, and one exceedance sum, one rest bit and one boolean atom per object | A settled, snapped or exactly resting object lands exactly on its destinations with zero velocity, up to the sign of zero; thresholds of at least 2^-22, see [In the program](#in-the-program) and [Magnitude limits](#magnitude-limits) |
| `emitFirstActive(gate, candidates)` | Up a balanced tree, `emitMaximum` of each pair; down, a node's route `r` gives `r × leftMaximum` to its left child and `r - r × leftMaximum` to its right child, starting from `gate × rootMaximum` | An exact one-hot, or all zeros, when the gate and every candidate are exact bits, since every value in the tree is then 0 or 1; fractional candidates split the route, e.g. candidates `[0.5, 0]` send 0.25 to each output. Declares the one-hot group only when the gate and every candidate are proven bits, as listed in [One-hot groups and gathers](#one-hot-groups-and-gathers). A cell that is only declared within `0..1`, or an AND of bits built with a ReLU, isn't a proven bit |
| `emitArgmax(scores, unit)` | Up a balanced tree, each pair computes `leftWins = boolean(c + s × left - s × right)`, where `c` is the FP32 value just above 0.5 and `s = 1 - c`, and keeps `emitSelect(leftWins, right, left)`; down, `route × leftWins` goes left and the rest goes right | Needs scores declared within `0..1`, `unit` declared exactly 1, and an executor that keeps FP32 rounding at the atoms; always declares the one-hot group. Keeps the left candidate on an exact tie, and also when the right score is larger by less than `8.9e-8`, or for some scores by up to `2.4e-7`. That band isn't transitive, so the tree can pick a different candidate from a loop, e.g. index 1 of `[0, 0.5, 0.5 + 2^-24, 0.5 + 2^-23]`, where the loop picks index 3. `emitHighestScoreExact` in the lab's [highest-score-tree.ts](../lab/ui-exploration/guide/examples/patterns/selection/highest-score-tree.ts) combines pairs with `emitCompare` and matches the loop |

### Selection

The expansion `off + gate × (on - off)` can lose a small selected value, or overflow `on - off` even when both candidates are finite, and regression tests cover both failures. `emitSelect`'s two-product expansion avoids subtracting the candidates during forward execution.

With a fractional gate, the selection interpolates between the operands with FP32 rounding; the interpolation is not an exact real-number calculation. Infinite or NaN candidates are outside the finite-operand contract because an unselected product can still compute `0 × Infinity`. Range propagation doesn't track NaN, and many operands have open declared ranges, e.g. every spring displacement in HandwiredOS, so the builder doesn't refuse them. In tests, `validateNoNaN(circuit, values)` names the operation that produced the first NaN, e.g. the product of a select's unpicked side, with the select's gate and operand values.

### Minimum and maximum

These constructions have narrower guarantees than native `Math.min` and `Math.max`. For example, `emitMaximum(2^24, -1)` produces 16,777,215, and the corresponding minimum produces 0 instead of -1. Fractional values can drift even at small magnitudes. `emitMinimumExact` and `emitMaximumExact` select an operand with a comparison bit instead, and need finite declared ranges on both operands, see [Comparisons](#comparisons).

The subtraction and the sum keep their rounding order and operand wires, and the range that the builder infers for the result describes that arithmetic, not an ideal min or max. For finite nonnegative inputs, the minimum's range is `0..a.maximum`, which allows a rounded result below the smaller input. The maximum's range is `0..1` only when both inputs are within `0..1`. Other cases get the range of the subtraction and the sum, which can include overflow.

### Clamping

The subtraction in the clamp to 0..1 stops producing the intended plateau at large magnitudes: `2^24 + 2` can produce 2, and `2^25` produces 0.

Those limits hold when `v` is its own operation, e.g. a source cell or a `roundAffine` result. When `v` is an ordinary affine sum of fewer than 4 terms, the builder copies its terms into both ReLUs, and each ReLU rounds its own sum, so the plateau holds only while both sums add without rounding: whole numbers up to 2^24, multiples of 1/2 up to 2^23, and multiples of 1/4 up to 2^22. E.g. for `v = x - 0.5` at `x = 2^23 + 1`, `relu(v)` computes `f(x - 0.5) = 2^23`, `relu(v - 1)` computes `f(x - 1.5) = 2^23 - 0.5`, and the clamp returns 0.5. Other fractions can round at any size, e.g. `v = x + 0.25` at `x = f(0.8)` returns 0.99999994. Keeping `v` as its own operation with `roundAffine` restores the limits above.

## Buffer lifetime

`evaluateReference` and `evaluateTensor` return fresh full wire arrays. `createTensorEvaluator(roots)` captures a compiled program and reuses work buffers. Its result contains only the requested roots, in the requested order, and the next call overwrites the same result array. Copy it when retaining a frame. Recreate the evaluator after changing the circuit. A caller that also needs the program itself, e.g. HandwiredOS, which validates the program and shows its counts in its Monitor window, compiles once with `program = circuit.compileTensorProgram(roots)` and builds the same evaluator with `circuit.createTensorProgramEvaluator(program)`; `createTensorEvaluator(roots)` would compile a second time. The evaluator that `createTensorProgramEvaluator` returns also has a `packedValues` property, the array that the evaluator computes in: after a call, `packedValues[index]` is the value of wire `program.wireOrder[index]`, i.e. the source cells and then every live operation, e.g. HandwiredOS's Monitor window shows each live operation's value from it. The next call overwrites the array, and an operation that the compiler removed has no value in it.

## Backends

All of src/runtime's execution is JavaScript on the CPU. "Tensor" in its names means a program packed into layers of sparse matrices, not a GPU. Other backends can run the same program, e.g. [src/json-search](../src/json-search/README.md) runs one program over 100,000 JSON documents at once on WebGPU, and patterns.md's [When a tree takes less time than the loop](patterns.md#when-a-tree-takes-less-time-than-the-loop) says when the GPU takes less time than the CPU. A compiled program says what each operation computes, and not how a backend has to hold its values. E.g. src/json-search has two writers of GPU code for the same program: loop-emit.ts writes every operation as one f32 statement, and bit-emit.ts holds a value as an integer or as one bit of a word where the program's declared ranges, grids and exact bits prove that the value is a whole number or a bit, and computes the same values ([two writers of GPU code](../src/json-search/README.md#two-writers-of-gpu-code)).
