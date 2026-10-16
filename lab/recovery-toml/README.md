# A TOML highlighter as tables, in the form of the JSON one

This folder is the TOML track of the transfer experiment: does the recipe that trained the unused cells of the JSON highlighter (`lab/recovery-parser/`) work for another language, with nothing tuned for it? The track needs a parser of the same form for TOML. This is that parser as it is, without recovery: after the first error of a text its grammar stays in the state `error`.

- `kinds.ts`: the limits (512 code points, depth 16), the display kinds, the kinds of the first error, the numbers of the containers.
- `tables.ts`: the tables, built from transition functions that read like the grammar, e.g. `lexerStep(state, characterClass)`.
- `table-parser.ts`: the loop over the tables, with the exports of `lab/recovery-parser/table-parser.ts`: `defaultTables`, `runTableParser(text, tables)`, the name lists, the limits.
- `reference.ts`: `labelReference(text)`, a hand-written scanner that labels every code point of a valid text and says whether a text is valid. It reads `kinds.ts` and nothing of the tables.
- `check-*.ts`: the checks, see "The checks".
- `samples.ts` and the files around it: the dataset of broken TOML, see "The dataset" at the end.

## The form

One step per code point, as in the JSON parser:

1. The code point's character class.
2. The tokenizer's cell (tokenizer state, class) gives the next tokenizer state and an event.
3. A fixed table gives the event's token.
4. The grammar's cell (grammar state, token, context) gives the next grammar state and a stack action: none, push an array, push an inline table, pop. A context is the depth class (0, 1, 2 to 15, 16) times 2, plus 1 when the innermost open container is an inline table.
5. The display table gives the display kind of (event, grammar state after).

The output per code point is the display kind, the depth (the number of open arrays and inline tables after the code point) and the container (none, array, inline table). The first error is the first position at which the grammar enters the state `error`. A text is valid when it has none in its 513 positions.

## What differs from the JSON parser

A step reads and writes nothing that the JSON step does not. Three things differ from `lab/recovery-parser/table-parser.ts`:

- **The stack action is a table, `grammarAction`, with one entry per grammar cell.** The plain JSON parser changes the depth by the event alone. In TOML a `[` opens an array where a value may stand and a header at the start of a line, and only the grammar knows which. The table is not new to the experiment: `learn/recovery-tables.ts` has it for JSON, with `by token` in every cell. The numbers of the actions are the same. The TOML tables name the action in every cell and hold no `by token`. `actionOfToken` says what `by token` does, and the cells that lead into `error` and the row of `error` hold that: after an error the parser goes on counting brackets, as the JSON one does, so a header after an error counts as an array up to its `]`.
- **The open containers are a real stack**, as in `learn/recovery-parser.ts`, with that file's rules at the edges. The JSON tables `depthChange`, `objectWeight` and `levelWeight` are gone.
- **One grammar cell for the token `none` does not stay in its state:** after the first `]` of `]]`, white space is an error, e.g. the space of `[[a] ]`. In the JSON tables white space never changes the grammar.

The class table has 130 entries instead of 129: U+007F is a control character in TOML, so the last entry, which stands for every code point past the table, is U+0080.

## After an error: a choice of this track

The repo ships no TOML highlighter, so what "the parser as it is" does after its first error was chosen when these tables were built, and the experiment's first row rests on that choice. The grammar stays in the state `error`, the tokenizer goes on, a token is shown by its kind, and brackets are counted by token. The JSON parser as it is shows everything after its first error as an error. Two things follow:

- **The parser as it is starts high.** Outside the test split it has 64.4% of the scored code points right, where the JSON parser as it is had about 22% on its written set. A recovery has less room to show.
- **Every name of a header after an error is wrong,** since the `[` of a header counts as the start of an array: 412,030 code points of the train split, 20.8% of what the parser as it is has wrong there.

So the row to read a trained parser against is not this parser but one rule without any training: after an error, start anew at the next line. It has 91.8% outside the test split, see `learn/restart-at-next-line.ts` and "The row to read a result against" in `learn/README.md`.

## Words: why the tokenizer is large

A word without quotes is a key or a value by where it stands: `1979-05-27 = 1`, `true = 1` and `-1 = 1` are valid, and `1.5 = 2` sets the key `5` of the table `1`. The tokenizer reads a character from its own state and the character's class, so it cannot know where a word stands: after a comma comes a key in an inline table and a value in an array, and after a line end a key at the top level and a value inside an array.

So the tokenizer follows a word as a key and as a value at once, and its tokens tell the grammar which reading a character ends. E.g. in `12x` the `1` starts a word that can be either (`keyOrValue`), and the `x` says that the word is no value (`notValue`): the grammar goes on where a key stands and enters `error` where a value stands. The dot of `1.5` is the token `numberDot`, a dot for a key and part of the number for a value. The comment at "Words" in `tables.ts` lists every such event.

Two more tokens come from the first error, which has to be the first code point at which the text stops being the start of a valid text: the `#` of a comment is the token `comment`, an error where the line may not end, e.g. after `a =` or inside an inline table. And the carriage return of a line end is the token `newline`, with the line feed after it as white space.

## Sizes

| | TOML | JSON |
|---|---|---|
| Character classes | 47 | 33 |
| Tokenizer states | 111 | 26 |
| Events | 42 | 25 |
| Tokens | 23 | 11 |
| Contexts | 8 | 8 |
| Grammar states | 16 | 8 |
| Display kinds | 11 | 9 |
| Tokenizer cells | 5,217, of which a valid text reads 2,459 | 858, 148 |
| Grammar cells | 2,944, of which a valid text reads 205 | 704, 88 |
| Display entries | 672, of which a valid text reads 105 | 200 |

So 2,758 tokenizer cells and 2,739 grammar cells are read only at or after a first error. `check-cells.ts` counts them, and `cellsThatValidTextsRead()` in that file returns the masks.

## The display kinds

JSON's nine with the same numbers (`whitespace`, `punctuation`, `string`, `escape`, `number`, `literal`, `error`, `pastEnd`, `key`), then `headerName` and `comment`.

- `key` is a character of a key before an equals sign, with or without quotes. `headerName` is a character of a key inside `[…]` or `[[…]]`. The dots between the parts of a key and the brackets of a header are `punctuation`.
- A date or a time is a `number`: at its first digits nothing says yet that a date follows, e.g. the `1979` of `1979-05-27`. The space between a date and a time is `whitespace`.
- `inf` and `nan` are `number`, like the sign before them. `true` and `false` are `literal`.
- An escape in a key is `escape`. In a string of several lines, a backslash at the end of a line and the white space up to the line's end are `escape`.
- A carriage return and a line feed are `whitespace` outside a string and `string` inside one.

## Out of scope

The tables read TOML 1.0's syntax. They accept a text that TOML does not when:

- A key or a table is defined twice, or a table is added to where it may not be, e.g. `a = 1` twice, `[a]` twice, or `a.b = 2` after `a = {b = 1}`. The tables keep no names.
- A number inside a date or a time is out of its range, e.g. the month 13 or the hour 24. The tables read the form: 4 digits, 2 digits, 2 digits.
- An escape names a surrogate or a code point past U+10FFFF, e.g. `\uD801`. The tables read 4 or 8 hex digits.
- An integer does not fit in 64 bits.
- The file is no UTF-8. The parser reads code points, and a lone surrogate of a JavaScript string is a character like any from U+0080 up.

And they reject a text that TOML allows when it has more than 512 code points or nests deeper than 16, as the JSON parser does. A byte order mark at the start is rejected too.

Bun's parser reads TOML 1.1 and so accepts four things that TOML 1.0 and the tables reject: a line end or a comment inside an inline table, a comma before its `}`, a time without seconds, and the escapes `\e` and `\xHH`.

## The checks

Run from the repo root. Each prints its counts and ends with "every check passed".

- `bun lab/recovery-toml/check-table-parser.ts`: 6,236 valid documents, 236 written by hand and 6,000 generated, with 1,763,028 code points: the tables and the reference give the same display kind, depth and container at every code point, and Bun accepts every one. The check takes the two counts as arguments, and with 60,000 documents and 120,000 damaged texts it passes as well. Then 8,290 damaged texts, of which 5,666 are invalid: the tables and the reference agree on valid or invalid for every one, and Bun agrees on 8,105. The other 185 each have a reason from the section above: 138 a name defined twice, 4 a range in a date, 1 an escape's code point, 35 what TOML 1.1 adds, 6 the limits, 1 the byte order mark. And for 5,663 of the 5,666 invalid texts, the text before the first error is the start of a valid text that the reference accepts, with the same labels up to there. The other 3 would need more than 512 code points.
- `bun lab/recovery-toml/check-cells.ts`: the counts of the table above, by two searches that find the same cells. Then one valid text per cell and entry that a valid text reads, 2,769 texts: each reads its cell, and the tables and the reference agree at every code point.
- `bun lab/recovery-toml/check-short-texts.ts`: every text of 8 families, e.g. `a=` followed by every string of up to 5 of the characters `019_.e+-xb:` and space: 17,430,022 texts, 1,655,136 of them valid. The tables and the reference agree on every one, and Bun differs on 866, each for a reason from the section above. About 25 seconds.
- `bun lab/recovery-toml/check-toml-test.ts <folder>`: the official test suite, [toml-test](https://github.com/toml-lang/toml-test), with its list for TOML 1.0. Clone it into a folder outside the repo. All 208 valid cases are accepted by the tables and the reference, with the same labels. Of the 501 invalid cases, 393 are rejected, 9 are no UTF-8, and 99 are accepted and on the check's list by reason: 63 a name defined twice, 30 a range in a date or a time, 6 an escape's code point.
- `bunx tsc -p lab/recovery-toml` and `bunx oxlint --type-aware lab/recovery-toml`.

## The dataset

Broken TOML for the experiment, in the shapes and names of `lab/recovery-parser/`. `sampleAt(seed, index)` in `samples.ts` makes sample `index` of a seed without the ones before it, in about 0.15 ms. A sample is a valid document of at most 512 code points, a broken text made of it, and which code points of the broken text are which code points of the document. `labelsOf(sample)` gives every code point of the broken text the label of its counterpart, i.e. the display kind, the depth after it and the innermost container after it as `reference.ts` gives them, and `undefined` to a code point that the damage added. The type `Sample` has a comment on every field.

**Documents** (`documents.ts`). 18 templates. 16 are modeled on files that people write and tools generate: a Cargo manifest, a Cargo workspace, a pyproject, the config of a formatter, of a linter, of a static site, of a deploy, of an editor or a terminal, of a server, of a database and of a metrics agent, feature flags, strings for translation, a data file with records and dates, the tasks of a task runner, and a lockfile. Two are not: `deepNesting` nests arrays and inline tables up to 16 levels, and `oddities` holds what TOML allows and config files rarely have, e.g. the key `1979-05-27`, the number `-nan` and the header `[ g .  h  . i ]`. A template draws its tables, entries, names, values and comments, and a layout draws how the document is written, e.g. `key=value`, equals signs in one column, entries indented below their header, an array on one line or on several, strings between apostrophes, lines that end with `\r\n`. Every document is valid for the tables, for the reference labeler and for `Bun.TOML.parse`. In the first 60,000 samples the documents read all 205 grammar cells and all 105 display entries that a valid text can read, and 2,344 of the 2,459 such tokenizer cells. About half of the other 115 are read only by a text that TOML rejects for a number in it, e.g. the escape `\U10000000` or the minute 80, and the rest need one letter after one start of a word, e.g. `fal` followed by `r` as a key. `stats.ts` lists them.

**Damage** (`damage.ts`). The damage is fixed by the experiment and knows nothing of TOML: it reads which code points of a payload are equal and where its line feeds are. Ten edits, each as likely as the others, with positions and lengths drawn uniformly: delete one code point, insert a copy of one of the payload's code points, replace one code point with another of the payload's, swap two neighbours that differ, delete a run of 2 to 20 code points, write such a run twice, copy such a run to another place, delete a line, write a line twice, and cut the payload's tail. A sample gets one edit with probability 0.6, two with 0.3 and three with 0.1, each applied to what the edit before it left. A draw is thrown away, and the edits are drawn again on the same document, when the result is still valid for the tables, is the document again, has more than 512 code points, is counted deeper than 16 by the parser as it is, or leaves no code point to score.

**Labels and what is scored.** A kept code point has the label that it has in the document. What an edit inserts is added and has none: the code point of a replacement, the copy of a run or of a line, and of two swapped code points the one that moved to the right. The edits of a sample are in the canonical form of `lab/recovery-parser/edits.ts`, so of two equal code points the later one is the added or the removed one. Scores count the code points from the first error of the parser as it is on. Two of the JSON dataset's rules leave a value out: before that first error, a value that the parser as it is does not give, and the depth and the container from a code point at which they change without a bracket, i.e. after a removed bracket, up to the next kept bracket. The bracket of a header counts, so after a lost `]` the depth 0 is scored again from the next header on. The JSON dataset's other two rules rest on knowing the damage, and are not here: e.g. after a string lost its closing quote, the rest of its line is scored with the labels of the document, which no parser can give.

**Splits** (`splits.ts`). As in the JSON dataset, a document's split is a hash of its tokens, e.g. `[h]k=sk=n` for a header and two entries, whatever its names, values, comments and layout are: 80 of 100 sequences are in train, 10 in validation and 10 in test. So no document and no sequence of tokens is in two splits. The templates `deployConfig` and `taskRunner` are held out: their samples are only made from documents of the test split.

**Numbers**, for the first 60,000 samples of the default seed, 20261016:

| | |
|---|---|
| Samples per split | train 42,082, validation 5,382, test 12,536, of which 7,336 are of the two held-out templates |
| Samples with 1, 2 and 3 edits | 47.4%, 37.5% and 15.1%, where the draws are 60%, 30% and 10%: a draw of one edit is thrown away more often |
| Draws of edits | 145,497, of which 85,497 (58.8%) are thrown away: 69,300 are still valid, 14,660 leave nothing to score, 1,204 are longer than 512 code points, 133 have an edit without a place, 102 are unchanged, 98 are deeper than 16 |
| Scored code points per sample | mean 132.7, median 112, a tenth of the samples has 21 or fewer, a tenth 277 or more. 7,964,119 in all |
| From the first damaged code point to the first error | median 1 code point, mean 22.4. 36.7% of the samples have 0, and 13.4% more than 50, e.g. when the first edit fell into a comment and left the text valid, and a later edit broke it. With one edit: median 1, mean 3.2 |
| The parser as it is, outside the test split | 64.4% of the scored code points have display kind, depth and container right, and 11.3% of the samples have every one right |
| One rule without any training, outside the test split | 91.8% and 35.7%. The rule: after an error, the parser as it is starts anew at the next line, see `learn/restart-at-next-line.ts`. A trained parser is read by what it adds to this row |

A cut alone leaves nothing to score and a copy of a line with a key is valid for the tables, which keep no names, so `cutTail` is only in samples of two or three edits, and the two edits of lines are rare alone: 328 and 413 of 28,433 samples with one edit.

**Run it**, from the repo root:

```sh
bun test lab/recovery-toml/invariants.test.ts              # the invariants, about 2 seconds
bun lab/recovery-toml/check-samples.ts [samples] [seed]    # a second derivation of every sample, by default of 40,000, the splits, and that the damage reads no TOML
bun lab/recovery-toml/stats.ts <file> [samples] [seed]     # the numbers above and the cells, by default of 40,000 samples
bun lab/recovery-toml/dump.ts <folder> [seed]              # samples.txt and documents.txt for reading
```

Files: `documents.ts` (templates and layouts), `damage.ts` (the ten edits), `edits.ts` (edits, alignment and the canonical form, as in the JSON dataset), `labels.ts` (labels of a valid text and the sequence of tokens), `splits.ts`, `samples.ts` (`sampleAt`, `labelsOf`, `scoredCodePoints`, `groupOf`, which is the number of edits), `limits.ts` (the cells that valid TOML reads under the JSON names, `conditionProblems`, and a bound on the depth), `random.ts`, `check-samples.ts`, `stats.ts`, `dump.ts`, `invariants.test.ts`.

Known limits:

- The damage is blind, so some scored labels are out of every parser's reach, and nothing marks them. E.g. a copied `[` has no label, and the labels after it are those of a text without it. The JSON dataset has a judgment per form of damage for this (`reachable`, `needsClass`, `debatable`) and this one has none: the fields are constants in `Sample`. A review counted how much this is, on 5,000 train samples of another seed: 5.3% of the scored code points stand on the same line after an added run with an unpaired bracket or quote, e.g. the rest of a comment after a copied run that ends with a line feed, which is labeled as a comment and now stands on a line of its own. 8.9% stand anywhere after an added run with more opening than closing brackets, where the depth of the label is that of a text without the bracket, which a parser can give from the next entry on. Read by eye, 14 of 150 train samples have a stretch of 2 to 22 scored code points whose label no reader of the broken text would give. The data stays as it is, since the labels are exact by their rule. So a validation number has a ceiling below 100, most of all the share of whole samples.
- `limits.ts` proves little for this parser. A stack action per grammar cell and a display entry per event and state leave one limit, that the depth moves by one level per code point. 481 of the 60,000 samples (0.8%) have a scored depth out of that reach, e.g. a header after an array that lost its `]` and ends with a comma: the parser as it is reads the header's `[` as an array inside the array, and the label asks for depth 0 at the next code point.
- The words of free text come from a small list, and a comment is drawn without a look at the entry next to it, as in the JSON dataset.
- The largest sequence of tokens of a template can fall into validation or test and weigh much there, e.g. one sequence has 25.2% of the validation samples of `lockfile`. `stats.ts` prints the share per template and split.
