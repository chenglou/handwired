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

## What the checks cover

Each check of the core and of the twin runs as before for today's tables, with the same texts and the same random settings, and then for tables with added structure. The classes that the checks add are in `../check-texts.ts`: the apostrophe, the two curly double quotes, U+00A0, the signs `=` `#` `*` and the round brackets, five classes, all taken from `other`.

- `../check-tables.ts`: with the five classes the tokenizer's table has 988 cells, 153 frozen and 835 open. Each of the 153 has a text that today's parser reads without an error up to the cell. No text reads an open cell before its first error: the 81,051 texts of before, 4,000 texts with code points of the five classes inside strings and between tokens, and every text of up to 6 code points, with one code point per class, 38,856,146 texts with the five classes. This part runs today's parser, `../table-parser.ts`, and works out the cell of a new class from the code point. Tables with the classes are the same after saving and loading, a changed frozen cell of a new class is refused, a file whose class table does not fit its added classes is refused, and `addClasses` refuses four lists that cannot be.
- `../check-parser.ts`, part c: on 6,906 texts, tables with the five classes and no cell changed give the trace of `asIsTables()` at all 513 positions, with the class of a code point compared as the class it has today. With 40 random settings of every open cell, 10 of them with added states, every text has today's trace before its first error and today's verdict.
- `../soft/check-twin.ts`: with the five classes, with today's choices and with 4 random settings, one of them with added states, the twin with exact tables is the exact parser on the 2,500 samples: 12,500 runs, none differs when the depth range holds the run's depths.
- `../soft/check-gradient.ts`: two more settings with the five classes and 2 added tokenizer states, on 24 samples of which 11 need a class. The backward pass agrees with finite differences as for today's tables: the largest relative difference of a direction is 3.8e-8.

To see that the checks can fail, the new code was broken on purpose, one place at a time: the samples packed with today's classes (`check-twin.ts` failed), the first error found with the class's number in today's table (`check-parser.ts` failed), and no cell of a new class frozen (`check-tables.ts` failed).

## Not done

- **The step as a Handwired circuit** has no part of its own for classes: `step-circuit.ts` builds a column per class of the shape it is given, so it builds the step of tables with added classes as it is.
- **The search and the votes** of `../search` run today's layout only.
- **The marks of the intended states** (`codePointCanFollow`) are made for today's classes. With a class for the apostrophe, a replaced quote reads a cell that no letter reads, so its intended state could be followed, and the marks do not say so.
