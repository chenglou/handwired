# A TOML highlighter as tables, in the form of the JSON one

This folder is the TOML track of the transfer experiment: does the recipe that trained the unused cells of the JSON highlighter (`lab/recovery-parser/`) work for another language, with nothing tuned for it? The track needs a parser of the same form for TOML. This is that parser as it is, without recovery: after the first error of a text its grammar stays in the state `error`.

- `kinds.ts`: the limits (512 code points, depth 16), the display kinds, the kinds of the first error, the numbers of the containers.
- `tables.ts`: the tables, built from transition functions that read like the grammar, e.g. `lexerStep(state, characterClass)`.
- `table-parser.ts`: the loop over the tables, with the exports of `lab/recovery-parser/table-parser.ts`: `defaultTables`, `runTableParser(text, tables)`, the name lists, the limits.
- `reference.ts`: `labelReference(text)`, a hand-written scanner that labels every code point of a valid text and says whether a text is valid. It reads `kinds.ts` and nothing of the tables.
- `check-*.ts`: the checks, see the end.

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

- `bun lab/recovery-toml/check-table-parser.ts`: 6,236 valid documents, 236 written by hand and 6,000 generated, with 1,763,027 code points: the tables and the reference give the same display kind, depth and container at every code point, and Bun accepts every one. Then 8,290 damaged texts, of which 5,667 are invalid: the tables and the reference agree on valid or invalid for every one, and Bun agrees on 8,105. The other 185 each have a reason from the section above: 138 a name defined twice, 4 a range in a date, 1 an escape's code point, 35 what TOML 1.1 adds, 6 the limits, 1 the byte order mark. And for 5,664 of the 5,667 invalid texts, the text before the first error is the start of a valid text that the reference accepts, with the same labels up to there. The other 3 would need more than 512 code points.
- `bun lab/recovery-toml/check-cells.ts`: the counts of the table above, by two searches that find the same cells. Then one valid text per cell and entry that a valid text reads, 2,769 texts: each reads its cell, and the tables and the reference agree at every code point.
- `bun lab/recovery-toml/check-short-texts.ts`: every text of 8 families, e.g. `a=` followed by every string of up to 5 of the characters `019_.e+-xb:` and space: 17,430,022 texts, 1,655,136 of them valid. The tables and the reference agree on every one, and Bun differs on 866, each for a reason from the section above. About 25 seconds.
- `bun lab/recovery-toml/check-toml-test.ts <folder>`: the official test suite, [toml-test](https://github.com/toml-lang/toml-test), with its list for TOML 1.0. Clone it into a folder outside the repo. All 208 valid cases are accepted by the tables and the reference, with the same labels. Of the 501 invalid cases, 393 are rejected, 9 are no UTF-8, and 99 are accepted and on the check's list by reason: 63 a name defined twice, 30 a range in a date or a time, 6 an escape's code point.
- `bunx tsc -p lab/recovery-toml` and `bunx oxlint --type-aware lab/recovery-toml`.
