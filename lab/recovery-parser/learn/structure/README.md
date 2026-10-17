# More structure for the parser

The shared core lets an arm change open cells and add tokenizer states and grammar states (`addStates`). This folder documents what else an arm can add, each as a function of `../recovery-tables.ts` that takes tables and returns tables. `../handwritten/rules-with-structure.md` says why a programmer would want them. With none of them used, tables, the parser, the twin and saved files are what they were. When the three were built, the exact parser got about 6% slower for such tables, measured on the old snapshot of the dataset: a scoring pass over that snapshot's train split took 143 to 145 ms where it took 135 to 137 ms before.

The numbers here were made on the reviewed dataset. **The smoke runs are one seed each and untuned, so their scores are preliminary**: five seeds of the plain run are 0.9 points apart, see `../arms/plain-pass/README.md`.

## Added character classes

The highlighter has 33 classes, and most code points that are no JSON syntax have the class `other`, e.g. the apostrophe, the letters without a class of their own, and every code point from U+0080 up. So the tokenizer cannot tell `'` from `x`.

```ts
import {addClasses, asIsTables} from '../recovery-tables.ts'

const tables = addClasses(asIsTables(), [{name: 'apostrophe', codePoints: [0x27]}, {name: 'curlyQuote', codePoints: [0x201c, 0x201d]}])
```

`addClasses(tables, classes)` takes the listed code points out of the class they have in `tables` and gives them a class of their own, after the classes that are there: here the classes 33 and 34. For every tokenizer state, the cell of a new class starts as a copy of the cell of the class that its code points came from. So the returned tables read every text exactly as `tables` do, until a cell of a new class is changed.

The code points of one new class have to come from one class, since the new cells are copies of that class's cells, and that class has to keep a code point, since a class without one has cells that no text reads. A new class can hold any code point, also one past today's class table, e.g. U+00A0: the class table gets longer, and every other code point from U+0080 up stays `other`.

**Which cells of a new class are open** comes from the search that finds the frozen cells of today's tables, run with the new classes: a step with a new class is today's step with the class that its code points have today, and it freezes the cell of the new class. E.g. an apostrophe inside a string is read by valid JSON, so the cell (string, apostrophe) is frozen. An apostrophe between tokens is an error today, so (between, apostrophe) is open. A class taken from `other` has that one frozen cell and 25 open ones.

**The ground rules.** A frozen cell of a new class has to hold what today's cell of the class of its code points holds, and `checkTables` refuses tables in which one does not. The parser finds the first error with today's tables as before, and reads them with the class that a code point has today (`classToday`).

**Saving and names.** A saved file has the field `addedClasses` when the tables have some, and no other field changes for tables without. `loadTables` checks that the file's class table is today's with the added classes. A cell of a new class is named with the class's name, e.g. "(between, apostrophe)". `differencesOf(asIsTables(), tables)` compares a cell of a new class with today's cell of the class that its code points came from, so `score.ts`, `compare.ts` and `handwritten/show.ts` say for such tables what differs from today's parser.

**The twin** needs nothing new: a class is a column of the tokenizer's table, and the twin reads the column of the code point's class. The classes of the samples have to be the ones of the twin's tables, so `packForTwin` takes the tables as its fourth argument. The packed samples carry a key of those tables' class table (`classTableKeyOf` in `../soft/twin.ts`, a hash of the table), and a run throws when the twin's tables give some code point another class. That also holds for two lists of added classes of the same length, e.g. a twin with a class for `#` on samples that were packed for a class for the apostrophe. Two lists that give every code point the same class are taken as the same, whatever the classes' names are.

```ts
const base = addStates(addClasses(asIsTables(), [{name: 'apostrophe', codePoints: [0x27]}]), 2, [])
const data = packForTwin(samples, trainPlaces, undefined, base)
const model = createModel(base)
```

## Open entries of the display table

The display table gives the display kind for (event, grammar state after), e.g. `key` for (stringStart, colon): a string is a key when the grammar expects a colon after it. The core kept the table fixed. But a text reads some of its entries only at or after a first error, as it reads the open cells of the two other tables, e.g. (literalStart, colon), the first letter of a literal when the grammar expects a colon after it. Valid JSON has no literal as a key.

```ts
import {asIsTables, displayEntryOf, displayKindNames, eventNames, grammarStateNames, openDisplayEntries} from '../recovery-tables.ts'

const tables = openDisplayEntries(asIsTables())
tables.display[displayEntryOf(tables, eventNames.indexOf('literalStart'), grammarStateNames.indexOf('colon'))] = displayKindNames.indexOf('key')
```

`openDisplayEntries(tables)` returns tables with the mask `displayOpen`: 1 where an entry may change. Tables that it did not make have no open entry, and their display table has to be today's, as before.

**Which entries are open** comes from the same search: a step without an error reads an entry, and the search marks it. Of the 200 entries, a text reads 37 before any error, 140 are open, and 23 are entries of the three events of a text's end that no text reads before an error. Those 23 are not open: the rows of `end`, `endInsideToken` and `truncatedEnd` are what the cells after a text read, and they hold `pastEnd` in every column.

**A choice** of an open entry is a display kind other than `pastEnd`, so 8 kinds. `checkTables` refuses `pastEnd` in an open entry, another kind in an entry that a text reads before an error, and another kind in a row of a text's end. Every text is then shown as today up to its first error, which is ground rule 1 for the display kind.

**With added grammar states**, the entries of an added state are open too, in either order of the two calls: `addStates(openDisplayEntries(tables), ...)` or `openDisplayEntries(addStates(tables, ...))`. Without open entries, the column of an added state is the one that `addStates` copied, as before.

**Saving and names.** A saved file has the field `displayOpen` when the tables have open entries. `differencesOf` lists a changed entry under the table `display`, with the event and the state as its name and the kinds as its choices, e.g. "(literalStart, colon)  literal -> key". `cellsReadAt` and `withUnreadCellsOf` of `../score.ts` count the entries like cells, and `handwritten/show.ts --cells` prints the entry that a step read when the tables have open ones.

**Two counts of cells.** `../score.ts`, `../compare.ts`, the trainer's log and every record of an arm give two counts under two names, both from `differencesOf`: the cells changed against the base, i.e. against the tables that a run started from, and the cells that differ from today's parser. They are the same number for tables of today's layout that a run made from today's tables. With added structure they are not: every cell of an added state differs from today's parser, 154 cells for 2 added tokenizer states and an added grammar state, and a class or the bit that is added to tables whose cells are changed already copies the changed cells, e.g. a class for the apostrophe that is added to the hand-written tables raises the count from 915 to 940 without a changed cell. So report the count against the base, and name both. For tables with open entries both counts include the changed entries. Against tables that lack an added grammar state, `differencesOf` lists the state's cells, 88 of them or 176 with the bit, and of its 25 entries only the open ones: 22 with open entries, since the three entries of a text's end hold `pastEnd`, and none without, since the state's column is then the copy that `addStates` was told to make and no cell that a run can change.

**The twin** holds a mix over the 9 display kinds per open entry, the softmax of 9 weights in which `pastEnd` has the share 0 whatever its weight is. The display kind's share of a step is the sum over (event, grammar state after) of the product of the two shares, put on the kind of the table for an entry that is not open, and split by the entry's mix for an open one. The weights are a fifth group next to the four of the cells, `display`. Without `trainable`, `createModel` makes every open entry trainable. With `trainable`, the display table has to be named next to the two others, as a mask, `'open'` or `'none'`: a call that leaves it out throws. `snappedTables` gives an entry the kind with the largest weight, never `pastEnd`.

```ts
const base = openDisplayEntries(asIsTables())
const model = createModel(base, {trainable: {lexer: base.lexerOpen, grammar: base.grammarOpen, display: base.displayOpen}})
```

## The bit "the token is the first on its line"

Today a line feed is white space, and white space gives the grammar no token. So the grammar reads the same cell for the second string of `"version": "license"` and of

```
"version":
  "license": "MIT"
```

```ts
import {addFirstOnLineBit, asIsTables, grammarCellOf, grammarStateNames, tokenNames} from '../recovery-tables.ts'

const tables = addFirstOnLineBit(asIsTables())
// A string that starts its line where a comma or a closing bracket should come, in an object at depth 1: context 3, and 8 more with the bit.
const cell = grammarCellOf(tables, grammarStateNames.indexOf('commaOrClose'), tokenNames.indexOf('string'), 8 + 3)
```

`addFirstOnLineBit(tables)` returns tables whose grammar has 16 contexts in place of 8. The parser keeps one bit: a line feed code point sets it, and the first code point after it whose token is not `none` clears it. So white space and the inside of a string leave the bit as it is, and a line feed sets it whatever its own token is. The grammar reads the bit next to the depth class and the kind of the innermost container: context + 8 is the context with the bit. A text's first token does not have the bit, since no line feed comes before it.

**Every code point reads its grammar cell with the bit while the bit is set**, not only the token that clears it. E.g. in `[`, a line feed, two spaces and `1`, the two spaces read the cell (valueOrClose, none, depth 1, array, first on its line), and the `1` reads (valueOrClose, scalar, depth 1, array, first on its line). So the cells of the token `none` have a copy with the bit too: 64 cells in today's 8 grammar states, 38 of them open. A recovery that sets a cell of the token `none`, e.g. "white space keeps the grammar state after an error", has to set both copies, and the indentation of a line can be trained to do something else than the white space inside a line.

A cell with the bit starts as a copy of the cell without, so the returned tables read every text exactly as `tables` do, until a cell with the bit is changed.

**Which cells with the bit are open** comes from the search, which now carries the bit through its steps. The grammar's table has 1,408 cells with the bit, 176 frozen and 1,232 open. E.g. (value, string) with the bit is read by valid JSON whose value starts its own line, so it is frozen. **A cell with the bit is frozen exactly when the cell without the bit is**: valid JSON can have a line feed before any token. So the bit opens no cell that is frozen today. What it adds is a second copy of every open cell, e.g. (commaOrClose, string) with the bit, where a recovery can do something else for a string that starts its line than for one that follows a value on the same line. `../handwritten/rules-with-structure.md` names this limit for the case "a string that starts its line after a colon".

**The ground rules.** A frozen cell with the bit has to hold what today's cell without the bit holds. The parser finds the first error with today's tables, which it reads with the context without the bit.

**Saving and names.** A saved file has `contextCount` 16 and nothing else new. A cell with the bit is named with its context, e.g. "(commaOrClose, string, depth 1, object, first on its line)". `differencesOf(asIsTables(), tables)` compares a cell with the bit with today's cell without.

**The twin** holds the bit as one more share. Before a step, the bit's share of every context goes to the context with the bit. After the step the bit is 1 at a line feed, and otherwise the share before times the share of the token `none`. `packForTwin` takes the bit at the first error from the exact parser, when it is given the tables. With one share for the bit, the twin cannot say which tokenizer states the bit goes with once its state is a mix, e.g. after a quote that ends a string in one half of the state and starts one in the other: see "Where the twin loses information" in `../soft/README.md`.

Keeping a run on track (`onTrackProbability`) replaces the tokenizer state, the grammar state, the depth and the stack by the intended ones, and **not the bit**: the bit follows from the line feeds of the broken text, and the bit of the original can be one that no parser of the broken text has, e.g. after a removed line feed. Gradients cross a replaced state through the bit only. `../soft/check-twin.ts` runs every sample kept on track and compares the twin's bit at every step with a count from the text's line feeds and the run's tokens.

## Using them together

The three functions and `addStates` can be called on each other's results in any order, and give the same tables in each of their 24 orders.

```ts
const base = addStates(addFirstOnLineBit(openDisplayEntries(addClasses(asIsTables(), [{name: 'apostrophe', codePoints: [0x27]}]))), 2, [grammarStateNames.indexOf('colon')])
const data = packForTwin(samples, trainPlaces, undefined, base)
const model = createModel(base)
```

`soft/train.ts` has no options for them. Its `--base` takes saved tables with any of the structure, e.g. tables that a three-line script saved with `saveTables`, and trains every open cell and entry of them.

## What the checks cover

Each check of the core and of the twin runs as before for today's tables, with the same texts and the same random settings, and then for tables with added structure. The classes that the checks add are in `../check-texts.ts`, eight of them. Five are taken out of `other`: the apostrophe, the two curly double quotes, U+00A0, the signs `=` `#` `*` and the round brackets. Three are not, so that the checks also run the code that reads which class of today's the code points of an added class have: the digits 7 to 9 out of `digit`, the carriage return out of `tabOrCarriageReturn`, and the 7 once more, out of the added class of the digits 7 to 9. Valid JSON reads a digit and a carriage return between tokens, where a code point of `other` is an error, so code that takes such a class for one out of `other` makes a check fail.

- `../check-tables.ts`, for each of the three alone and for all three with added states.
  - With the eight classes the tokenizer's table has 1,066 cells, 184 frozen and 882 open: a class out of `other` has 1 frozen cell, each of the two classes of digits has 13, and the carriage return's has 5. With open entries the display table has 140 open entries. With the bit the grammar's table has 176 frozen cells.
  - Each frozen cell, and each of the 37 entries that the search found, has a text that today's parser reads without an error up to it.
  - No text reads an open cell or an open entry before its first error: the 68,107 texts of the check without structure, 4,000 texts with code points of the eight classes inside strings and between tokens, and every text of up to 6 code points, with one code point per class, 54,305,443 texts with the eight classes. The first two of these run today's parser, `../table-parser.ts`, and work out the cell themselves: the cell of a new class from the code point, and the bit from the text's line feeds and the trace's tokens.
  - Tables with added structure are the same after saving and loading, and the four functions give the same tables in every order.
  - Refused: a changed frozen cell of a new class or with the bit, a file whose class table does not fit its added classes, five lists of classes that cannot be, a changed entry that a text reads before an error, `pastEnd` in an open entry, another kind for an event of a text's end, and a changed entry in tables without open entries.
  - Every cell in each of its two fields, every entry and every bit of the three masks is changed, one at a time, in each of the five kinds of tables. The 14,496 changes of a frozen cell, of an entry that is not open or of a mask are all refused, and the 17,230 changes of an open cell or an open entry are not.
  - `differencesOf` lists the 154 cells of 2 added tokenizer states and an added grammar state and no entry of the display table, and with open entries the state's 22 open entries too. No difference from today's tables is listed as one in a frozen cell.
- `../check-parser.ts`, on 6,168 texts.
  - Part c, for each of the three alone and for all three. With no cell changed, the tables give the trace of `asIsTables()` at all 513 positions, with the class of a code point compared as the class it has today and the context without the bit. 165,373 code points of those texts read a context with the bit. With 40 random settings of every open cell and every open entry, 10 of them with added states, every text has today's trace before its first error and today's verdict. In every run, the bit of every position's context is the one that the check counts from the trace's line feeds and tokens, and the two cells that the trace names are the cells of its state, class, token and context.
  - Part d: structure that is added to tables whose open cells are changed already. Each step gives every open cell and entry a random choice and then adds one kind of structure: two classes that are taken out of added classes (the 9 out of the digits 7 to 9, the star out of the signs), the bit, open entries, added states. Every text has the same trace at all 513 positions before and after each step. So a new class's cell is a copy of the cell of the class that its code points came out of, also when that cell is changed.
  - Part e: tables with 133 classes, 255 tokenizer states, 200 grammar states and the bit have 33,915 tokenizer cells and 35,200 grammar cells, more than 16 bits can number. The trace names the cells that were read, which `cellsReadAt` and `withUnreadCellsOf` go by, and the ground rules hold.
- `../soft/check-twin.ts`, for each of the three alone and for all three.
  - With today's choices and with 4 random settings, one of them with added states, the twin with exact tables is the exact parser on the 2,500 samples, the context with the bit among what is compared. 12,500 runs each, none differs when the depth range holds the run's depths.
  - For the tables with the bit, the same 12,500 runs once more, kept on track after every code point whose intended state can be followed. No parser gives the trace of such a run, so the check counts the bit itself from the text's line feeds and the run's tokens, and the twin's bit before and after every step has to be that count. 1,635,760 states are replaced, about 266,000 of them while the bit is set.
  - Samples that were packed for other tables are refused: for today's classes, for another list of added classes of the same length, and for tables with or without the bit where the twin's tables are the other way round. Samples packed for the same classes under other names run.
- `../soft/check-gradient.ts`: three more settings, with the eight classes, 2 added tokenizer states, an added grammar state, open entries of the display table and the bit, on 24 samples of which 11 need a class. Two of the settings keep the run on track, so the gradient crosses replaced states through the bit. All five groups of weights are compared, the display table's 1,458 weights among them. The backward pass agrees with finite differences as for today's tables: the largest relative difference of a direction is 2.0e-8.
- `../soft/check-circuit.ts`: the step of tables with the eight classes, an added grammar state, open entries and the bit, as a Handwired circuit of 78,693 source cells and 81,357 operations, has the twin's values and gradients in 4 trials, one of them at a line feed.
- `../soft/check-train.ts`, part 6, with the same structure.
  - The gradients of 4 threads are one thread's, a trained model's snapped tables keep the ground rules and are the same after saving and loading, and `onlyReadCells` gives the trained texts the trace of the snapped tables.
  - With the weight of `pastEnd` the largest of every open entry, no entry's mix gives `pastEnd` a share, at the temperatures 1 and 0.5, and no entry snaps to `pastEnd`.
  - With a tenth of the open cells and of the open entries trainable, 16 of the 162 entries: the model's trainable cells are the masks that `createModel` was given, every other cell's mix is the base's choice as exact 0 and 1, no weight of another cell or entry moves, and the snapped tables differ from the base in trainable cells and entries only.

To see that the checks can fail, the new code was broken on purpose, one place at a time, and a check failed each time:

| Broken | Failed |
| --- | --- |
| the samples packed with today's classes | `check-twin.ts` |
| the first error found with the class's number in today's table | `check-parser.ts` |
| no cell of a new class frozen | `check-tables.ts` |
| an open entry's mix read one kind off | `check-twin.ts`, `check-circuit.ts` |
| half the gradient by an open entry's mix | `check-gradient.ts`, `check-circuit.ts` |
| the entries of the event `whitespace` not found by the search | `check-tables.ts` |
| the twin's bit not cleared by a token | `check-twin.ts`, `check-circuit.ts` |
| no gradient from the bit to the share of the token `none` | `check-gradient.ts`, `check-circuit.ts` |
| the bit's gradient cleared at a replaced state | `check-gradient.ts` |
| the parser's bit not cleared by a string | `check-parser.ts`, `check-twin.ts` |
| the cells (any state, string) with the bit not frozen | `check-tables.ts` |

Two reviews then broke more places, in scratch copies of the code, and six of their changes passed every check of that time. The checks were extended until each of the six makes a check fail:

| Broken | Passed, before the checks were extended | Fails now |
| --- | --- | --- |
| every added class is taken for one out of `other`, in four places: where the parser finds the first error, the search for frozen cells, `problemsOf`, and the cell that `addClasses` copies. With a class for the 7, the valid text `[7]` is then broken | the 8 checks that run tables | `check-tables.ts`, `check-parser.ts`, `check-twin.ts`, `check-gradient.ts`, `check-train.ts` |
| an open entry's mix gives `pastEnd` a share | the four checks of `../soft` | `check-train.ts` |
| snapping picks `pastEnd` when its weight is the largest | `check-train.ts` | `check-train.ts` |
| `createModel` makes every open entry trainable, whatever `trainable.display` says | `check-gradient.ts`, `check-train.ts` | `check-train.ts` |
| an open entry that is not trainable has no share in the mixes | the four checks of `../soft` | `check-train.ts` |
| after a replaced state the twin's bit is 0, and the bit's gradient is cleared there too | the four checks of `../soft` | `check-twin.ts` |

And more places, each broken alone with the extended checks:

| Broken | Failed |
| --- | --- |
| each of the four places of the first row above | `check-tables.ts`, `check-parser.ts` |
| `addClasses` copies the cell of the class that the code points have today, where it has to copy the cell of the added class that they came out of | `check-parser.ts`, part d |
| after a replaced state the twin's bit is 0 | `check-twin.ts`, `check-gradient.ts` |
| samples that were packed for another list of added classes of the same length are not refused | `check-twin.ts` |
| `differencesOf` lists every display entry of an added grammar state | `check-tables.ts` |
| the trace keeps the numbers of the two cells in 16 bits | `check-parser.ts` |

## Smoke runs

These runs only show that training can use each kind of structure, and that the snapped tables can be scored. **They are no result of the experiment**: nothing was tuned, each run has one seed, and five seeds of the run `plain` range from 95.9% to 96.7% (`../arms/plain-pass/`), so a run here that is within that range of another is not told apart from it.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/structure/smoke.ts                  # four runs, about 2 minutes
bun lab/recovery-parser/learn/structure/smoke.ts display          # one of plain, classes, display, bit
```

Each run is one pass of the trainer over the 37,381 train samples that give the twin a step, with every default: the start at the base's choices, every open cell and every open entry trainable, seed 1. `plain` trains today's tables, for comparison. `classes` adds a class for the apostrophe and two tokenizer states. `display` opens the display table's entries. `bit` adds the bit. The numbers are of the last snapped tables in the exact parser on the validation split, in percent:

| run | cells changed against the run's base | all three, all samples | all three, group "needs a character class" | all three, group "needs a display fix" | all three, group "needs a line rule" | all three, singleQuotedString | display kind, unquotedKey | first letters t, f, n of keys without quotes that are shown as a key | all three, colonWithoutValue |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| the parser as it is | 0 | 42.7 | 10.1 | 18.3 | 63.8 | 4.4 | 25.1 | 0 of 438 | 63.9 |
| `plain` | 972 | 96.7 | 88.9 | 96.8 | 99.9 | 93.3 | 96.0 | 0 of 438 | 99.8 |
| `classes` | 1,053 | 96.7 | 90.8 | 95.9 | 99.6 | 93.5 | 94.2 | 0 of 438 | 99.7 |
| `display` | 966 | 97.5 | 95.2 | 98.9 | 99.4 | 98.3 | 98.4 | 429 of 438 | 99.8 |
| `bit` | 1,214 | 96.8 | 91.7 | 97.2 | 99.9 | 94.6 | 96.5 | 0 of 438 | 99.4 |

The tables of `classes` differ from today's parser in 1,065 cells: 12 cells of its two added tokenizer states were not changed and still count there.

All three at the last 3 log points of each run: 96.5, 96.8, 96.7 for `plain`, 96.3, 96.7, 96.7 for `classes`, 97.3, 97.2, 97.5 for `display`, 96.4, 96.7, 96.8 for `bit`. So `classes`, `bit` and `plain` are not told apart by these runs: `plain` and `classes` end inside the range of the five seeds of `plain`, and `bit` ends 0.1 points above the highest of them, where those seeds are 0.9 points apart. `display` ends 0.8 points above the highest of those five seeds, with one seed of its own.

What the trained cells of each structure hold, from `differencesOf` of the run's base and its last tables, for the cells that a code point of a trained text reads:

- **`classes`.** 22 cells of the class apostrophe changed. (between, apostrophe) holds the event `stringStart` and the next state `exponentDigits`, where it held `unexpectedCharacter` and `errorLine`. In 19 other states, e.g. the states of a number, of a literal and of an escape, the apostrophe's cell holds the event `stringContent` where it held an error event. One cell leads into the added state 26, (exponentSign, closeBracket), and 4 cells of state 26 changed. No changed cell that a trained text reads leads into state 27.
- **`display`.** 86 entries changed, and a trained text reads 71 of them. A literal's first letter is shown as a key when the grammar's next state is `keyOrClose`, `key` or `colon`, and a literal's later letters when it is `keyOrClose` or `key`. Of the 56 entries of the 7 error events, 55 changed, and none of the 55 holds `error`: 32 hold `string`, 11 `key`, 7 `whitespace`, 3 `punctuation` and 2 `literal`.
- **`bit`.** 97 grammar cells that a trained text reads both with and without the bit hold another choice with the bit, e.g. (value, comma, depth 2 to 15, object) holds the next state `keyOrClose` without the bit and `colon` with it, and (commaOrClose, string, depth 1, array) holds `value` without the bit and `error` with it.

What the main number does not show, from `../compare.ts` and `../check-deep.ts`:

| run | added code points shown as an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels, nothing after the nested containers | the same, members after |
| --- | --- | --- | --- | --- |
| the parser as it is | 89.6% | 0 | 0.0% | 0.0% |
| `plain` | 1.1% | 90 | 0.0% | 0.0% |
| `classes` | 4.2% | 282 | 0.0% | 0.0% |
| `display` | 0.0% | 0 | 0.0% | 0.2% |
| `bit` | 0.4% | 0 | 0.0% | 2.6% |

The run with the bit trains slower, since the grammar's part of a step has twice the cells, and the number moves with what else the machine runs. With 4 worker threads on an 18 core machine with other jobs running, two sets of the four runs gave 1,199 samples per second for `bit` against 1,229 to 1,632 for the others, and 910 against 1,306 to 1,417, each set with one or two other jobs with 4 worker threads running at the same time. The two sets ended with the same four tables, byte for byte.

On the 2,800 fixed texts of `../arms/harness.ts`, each run's tables have today's trace at every position before the first error, and today's verdict (`groundRulesOn`).

## Not done

- **The whole run as one circuit** is not built, as before. The step is, with all three: a column per class, the mixes of open display entries as source cells, and the bit as one more source cell and one more output.
- **The votes** of `../search` run today's layout only. The search is no longer in this list: `search.ts --from` and `searchCells` of `../arms/holes/restricted-search.ts` run tables with added classes, with the bit and with open display entries, since the search's parser loop reads the class that the tables give a code point and the context with the bit, see `../search/README.md`. The search leaves the open display entries as they are.
- **The hand-written rules** of `../handwritten` use none of the three.
- **The marks of the intended states** (`codePointCanFollow`) are made for today's tables. With a class for the apostrophe, a replaced quote reads a cell that no letter reads, so its intended state could be followed, and the marks do not say so. The marks that are set stay right: a state that today's open cells can reach can be reached with more open cells too.
- **No intended bit.** The twin's extra targets and the states that a run is put on have no bit "first on its line", for the reason given above.
- **`pastEnd` as a choice of a display entry**, and open entries in the rows of a text's end, are left out on purpose.
- **No arm has used any of the three and nothing was tuned.** The smoke runs are one seed each.

`../check-commands.ts` runs `../score.ts`, `../compare.ts` and `../handwritten/show.ts` as commands on saved tables of each kind of structure, and compares what they print with its own counts.
