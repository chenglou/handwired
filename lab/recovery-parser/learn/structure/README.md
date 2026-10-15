# More structure for the parser

The shared core lets an arm change open cells and add tokenizer states and grammar states (`addStates`). This folder documents what else an arm can add, each as a function of `../recovery-tables.ts` that takes tables and returns tables. `../handwritten/rules-with-structure.md` says why a programmer would want them. With none of them used, tables, the parser, the twin and saved files are what they were.

Every number here is preliminary: the dataset is a snapshot that a reviewed version will replace.

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

**The twin** needs nothing new: a class is a column of the tokenizer's table, and the twin reads the column of the code point's class. The classes of the samples have to be the ones of the twin's tables, so `packForTwin` takes the tables as its fourth argument, and a run on samples that were packed for other classes throws.

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

**The twin** holds a mix over the 9 display kinds per open entry, the softmax of 9 weights in which `pastEnd` has the share 0 whatever its weight is. The display kind's share of a step is the sum over (event, grammar state after) of the product of the two shares, put on the kind of the table for an entry that is not open, and split by the entry's mix for an open one. The weights are a fifth group next to the four of the cells, `display`, and `createModel` makes every open entry trainable unless `trainable.display` says otherwise. `snappedTables` gives an entry the kind with the largest weight, never `pastEnd`.

```ts
const base = openDisplayEntries(asIsTables())
const model = createModel(base, {trainable: {lexer: base.lexerOpen, grammar: base.grammarOpen, display: base.displayOpen}})
```

## What the checks cover

Each check of the core and of the twin runs as before for today's tables, with the same texts and the same random settings, and then for tables with added structure. The classes that the checks add are in `../check-texts.ts`: the apostrophe, the two curly double quotes, U+00A0, the signs `=` `#` `*` and the round brackets, five classes, all taken from `other`.

- `../check-tables.ts`, per kind of structure. With the five classes the tokenizer's table has 988 cells, 153 frozen and 835 open. With open entries the display table has 140 open entries. Each frozen cell, and each of the 37 entries that the search found, has a text that today's parser reads without an error up to it. No text reads an open cell or an open entry before its first error: the 81,051 texts of before, 4,000 texts with code points of the five classes inside strings and between tokens, and every text of up to 6 code points, with one code point per class, 38,856,146 texts with the five classes. The first two parts run today's parser, `../table-parser.ts`, and work out the cell of a new class from the code point. Tables with added structure are the same after saving and loading. Refused: a changed frozen cell of a new class, a file whose class table does not fit its added classes, four lists of classes that cannot be, a changed entry that a text reads before an error, `pastEnd` in an open entry, another kind for an event of a text's end, and a changed entry in tables without open entries.
- `../check-parser.ts`, part c, per kind of structure, on 6,906 texts: with no cell changed, the tables give the trace of `asIsTables()` at all 513 positions, with the class of a code point compared as the class it has today. With 40 random settings of every open cell and every open entry, 10 of them with added states, every text has today's trace before its first error and today's verdict.
- `../soft/check-twin.ts`, per kind of structure: with today's choices and with 4 random settings, one of them with added states, the twin with exact tables is the exact parser on the 2,500 samples. 12,500 runs each, none differs when the depth range holds the run's depths.
- `../soft/check-gradient.ts`: two more settings, with the five classes, 2 added tokenizer states, an added grammar state and open entries of the display table, on 24 samples of which 11 need a class. All five groups of weights are compared, the display table's 1,458 weights among them. The backward pass agrees with finite differences as for today's tables: the largest relative difference of a direction is 3.1e-8.
- `../soft/check-circuit.ts`: the step of tables with the five classes, an added grammar state and open entries, as a Handwired circuit of 63,623 source cells and 65,402 operations, has the twin's values and gradients in 3 trials.
- `../soft/check-train.ts`, part 6: with the same structure, the gradients of 4 threads are one thread's, a trained model's snapped tables keep the ground rules and are the same after saving and loading, and `onlyReadCells` gives the trained texts the trace of the snapped tables.

To see that the checks can fail, the new code was broken on purpose, one place at a time, and a check failed each time:

| Broken | Failed |
| --- | --- |
| the samples packed with today's classes | `check-twin.ts` |
| the first error found with the class's number in today's table | `check-parser.ts` |
| no cell of a new class frozen | `check-tables.ts` |
| an open entry's mix read one kind off | `check-twin.ts`, `check-circuit.ts` |
| half the gradient by an open entry's mix | `check-gradient.ts`, `check-circuit.ts` |
| the entries of the event `whitespace` not found by the search | `check-tables.ts` |

## Not done

- **The whole run as one circuit** is not built, as before. The step is: `step-circuit.ts` builds a column per class of the shape it is given, and the mixes of open display entries as source cells.
- **The search and the votes** of `../search` run today's layout only.
- **The marks of the intended states** (`codePointCanFollow`) are made for today's classes. With a class for the apostrophe, a replaced quote reads a cell that no letter reads, so its intended state could be followed, and the marks do not say so.
