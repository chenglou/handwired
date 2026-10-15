# Broken JSON for a parser that keeps going

The JSON highlighter in `src/json-search/highlighter` gives up at the first error of a text: from there on it shows every code point as an error. This folder makes the data for an experiment that asks whether the same loop, with other tables, can keep labeling the text after the error, e.g. so that the `"b"` of `{"a": 1 "b": 2}` is still shown as a key.

The data is synthetic. A sample is a broken text of at most 512 code points, the valid text that its author meant, and for every code point of the broken text the label of its counterpart in the valid text. Nothing is stored: sample `i` of a seed is a function of the seed and `i` alone, so `sampleAt(seed, i)` makes it without the samples before it.

## What a sample holds

The type `Sample` in `samples.ts` has a comment on every field. The main ones:

- `original`: the valid text that was meant. `documents` holds the same text as one document, or as several when the text is e.g. one document per line.
- `broken`: the text that the parser gets.
- `kinds`: the kinds of damage in the text, e.g. `['missingComma', 'openStringAtLineEnd']`. `forms` says what each kind did, e.g. "missingComma: at a line end between two members".
- `edits` and `alignment`: what turns the original into the broken text, and for every code point of the broken text the index of its counterpart in the original, or -1 when the damage added the code point.
- `firstDamage`: the index of the first damaged code point of the broken text. A score counts the labeled code points from that index on, because the parser as it is already has every label before that index right.
- `reachable`, `needsClass` and `debatable`: see "Can a parser label the rest?" below.
- `split` and `heldOut`: see "Splits and what is held out" below.

`labelsOf(sample)` returns one entry per code point of the broken text. The entry is `undefined` for a code point that the damage added. Otherwise it has three values:

- `kind`: the display kind that the highlighter's reference gives the counterpart, e.g. key, string, number or punctuation.
- `depth`: the number of open containers after the code point, e.g. 1 after the `{` of `{"a": 1}` and 0 after its `}`.
- `container`: the innermost open container after the code point: none, an object or an array.

Two cases need more than "the label of the counterpart":

- A code point that stands in the place of another one has that one's label, e.g. the `'` that stands for a `"`, the `T` of `True` for the `t` of `true`, and a `]` for a `}`. A replacement of another length has no label, e.g. `NaN` for a number.
- Some kept code points have a display kind that no reading of the broken text from left to right can give. E.g. in `"name": "tiny-gl,` at the end of a line, the comma is inside the open string for every reader, and its counterpart in the original is punctuation. And the two inner quotes of `"call "Ana" back"` are each the second half of an escape `\"` in the original. The `kind` of such a code point is `undefined` and is not scored. Its depth and its container are scored.

When the original is several documents, each document has the labels that it has alone, so the depth is 0 between two documents.

## Where the samples come from

Out of 100 samples, 5 are valid documents, 20 are texts of typing replays and 75 are damaged documents.

**Documents** (`documents.ts`). 21 templates, e.g. a package manifest, an editor's settings, a log event, an API response, a table as an array of arrays, a document that is nested 16 levels deep, and a lone string or number. A document is written in one of five styles: on one line without spaces, on one line with spaces, indented with 2 or 4 spaces, indented with tabs, or on one line with a space inside the brackets. Together the originals reach all 88 cells of the grammar table that a valid text can reach.

**Typing replays** (`typing.ts`). A person adds an entry to a document, deletes an entry, changes a value, or types a whole document, key by key, in a plain editor or in an editor that adds the closing bracket and the closing quote. Every key press leaves a text, and a sample is one broken text of a replay. The valid texts of a replay are not samples.

**Damaged documents** (`damage.ts` and `damage/`). Out of 100, 60 have one kind of damage, drawn by the weights in the table of kinds below. 14 have two or three kinds that have nothing to do with each other, at least 8 code points or one line apart. 26 are a combination with one cause:

| Combination | Weight | What the text is |
| --- | --- | --- |
| jsoncFile | 6 | a config file with comments and with a comma after the last entry, as in `tsconfig.json`. One in three is being edited as well |
| javascriptLiteral | 5 | an object literal from a JavaScript file: keys without quotes, often single quotes, trailing commas, the assignment around it, a comment, `undefined` |
| pythonPrint | 5 | what Python prints for a dict: single quotes, `True`, `False` and `None`, sometimes a tuple, `nan` or a NumPy number |
| modelAnswer | 2.5 | a language model's answer: a sentence, a code fence, the document, the fence, and sometimes one more sentence |
| movedLine | 1.6 | a line that was moved to the end of its object, so the line before it has no comma and the moved line has one |
| nodePrint | 1.4 | what Node prints for an object: keys without quotes and single quotes |
| fencedAndDamaged | 1.2 | a code fence around a document with one damage of its own |
| fencedAndCutOff | 1 | an opening code fence and a document that stops, as from a model that reached its output limit |
| mongoShell | 0.8 | a document copied from the MongoDB shell, with values such as `ObjectId("…")` |
| nothingEscaped | 0.8 | strings that a program put between quotes without escaping: inner quotes, raw line feeds and tabs, single backslashes |
| cutLineThenLines | 0.8 | one document per line, where a length limit cut one line short |
| json5File | 0.6 | a JSON5 file |
| webPageCopy | 0.6 | text copied from a web page: typographic quotes, and no-break spaces in the indentation |
| hjsonHabits | 0.6 | habits from HJSON and YAML: no quotes, no commas at line ends, `#` comments, `yes` and `no` |
| documentationExample | 0.6 | an example from documentation: `...` for what was left out, a note, a placeholder for a value |
| byteOrderMarkAndMore | 0.4 | a file with a byte order mark and one more damage |

## The kinds of damage

In the examples, ⏎ stands for a line feed, → for a tab, ⍽ for a no-break space (U+00A0), ◊ for a byte order mark (U+FEFF) and ␛ for the escape character. The weight is a kind's share among the samples with one kind of damage, out of 100. A kind is also part of combinations and of typing replays, so its share of all samples is another number, which `stats.ts` prints.

| Kind | Family | Example | Weight | Can a parser label the rest? |
| --- | --- | --- | --- | --- |
| openStringAtLineEnd | half typed | `{⏎  "name": "tiny-glob",⏎  "pri⏎}` | 5 | line rule: a JSON string holds no raw line feed, so "a string ends at the line feed" is sound. A comma that ends up inside the open string is not scored |
| openStringMidLine | half typed | `{"email": "ada@example.com, "role": "admin"}` | 1.6 | no: the open string ends at the next quote, which opens the next string in the original, and every later quote is read in the opposite role |
| keyWithoutColon | half typed | `{⏎  "strict": true,⏎  "tar"⏎}` | 3.2 | yes when a closer or a comma follows. line rule when the next key follows on the next line. no when it follows on the same line, where the text reads as a forgotten colon |
| colonWithoutValue | half typed | `{⏎  "version": ,⏎  "license": "MIT"⏎}` | 3.5 | yes when a comma or a closer follows. line rule when the next key follows on the next line. no when it follows on the same line, where it reads as the value |
| partialLiteral | half typed | `{"paid": tru, "currency": "EUR"}` | 1.2 | yes: the typed letters are literal characters in the original too, and what follows is read as what it is |
| partialNumber | half typed | `{"lat": 59., "lon": 10.75}` | 0.8 | yes, as partialLiteral |
| cutOff | cut off | `{"id": 42, "name": "Ada Lovel` | 7 | yes, and nothing is left to recover: no kept character comes after the cut |
| headMissing | cut off | `"id": 42, "name": "Ada"}` | 0.6 | no: the depth at the start is unknown, and a text that starts inside a string has every later quote in the opposite role |
| middleCutOut | cut off | `{"id": 7, "tags": ["urgent", "dr...lling": true}` | 0.6 | no: the removed span can hold any number of brackets and quotes |
| missingComma | separator | `{⏎  "version": "0.4.1"⏎  "private": true⏎}` | 5.5 | yes: after a complete value, a string inside an object is the next key, and the start of a value inside an array is the next item |
| trailingComma | separator | `{⏎  "host": "localhost",⏎  "port": 8080,⏎}` | 7.5 | yes: a closing bracket after a comma closes the container |
| extraComma | separator | `{"id": 7, , "tags": ["ops"]}` | 1.5 | yes: a comma where a key or a value should start changes nothing |
| missingColon | separator | `{⏎  "port" 8080,⏎  "host": "localhost"⏎}` | 0.8 | yes when the value is a number, a literal or a container, which can only be the value. line rule when the value is a string: on the same line it is the value, where a half-typed key has the next key on the next line |
| foreignKeySeparator | separator | `{"id"=>42, "name"=>"Ada", "manager"=>nil}` | 0.6 | yes: where a colon is expected, = and > are skipped and a value comes next |
| missingCloser | bracket | `{"tags": ["ops", "beta"}` | 2.7 | yes when the closer of the container around it follows and is of the other kind, so it closes both. Otherwise no: the next entry reads as one more entry of the open container, and the depth stays one too high |
| strayCloser | bracket | `{⏎  "name": "Ada",⏎  },⏎  "active": true⏎}` | 1.5 | yes after the document's end, when no open container has the bracket's kind, and when it closes the top-level container and a comma follows. Otherwise no: it reads as a real closer |
| wrongCloser | bracket | `{"point": [59.91, 10.75}}` | 0.8 | yes, with the rule "a closer of the wrong kind closes one level anyway", which contradicts the rule that recovers missingCloser |
| lineComment | comment | `{⏎  "port": 8080,⏎  // "debug": true,⏎  "host": "localhost"⏎}` | 2.8 | yes: // starts nothing else in JSON, the comment ends at the line feed, and the grammar stays where it was |
| blockComment | comment | `{"port": /* default */ 8080, "host": "localhost"}` | 0.6 | yes, with a state inside the comment and one after a *. Between two tokens of a line the comment's end must be found exactly, which needs * as a class of its own |
| hashComment | comment | `{⏎  "retries": 3, # was 5⏎  "timeout": 30⏎}` | 0.3 | yes, as lineComment. The tables can only skip it as they skip any word, which contradicts a key without quotes |
| conflictMarkers | comment | `{⏎<<<<<<< HEAD⏎  "version": "0.4.1",⏎=======⏎  "version": "0.5.0",⏎>>>>>>> release/0.5⏎  "license": "MIT"⏎}` | 1.2 | yes: a marker line starts with a character that starts no token and is skipped up to its line feed, and the other side's lines read as more members |
| unquotedKey | other notation | `{⏎  "host": "localhost",⏎  port: 8080⏎}` | 1.5 | yes: where a key may come, a word up to the colon is the key |
| singleQuotedString | other notation | `{"roles": ['admin', 'billing'], "active": true}` | 1 | yes for a parser that reads the apostrophe as a quote, which the highlighter's classes cannot: the apostrophe is in the class of most letters |
| curlyQuotes | other notation | `{“name”: “Ada”, “age”: 36}` | 1.2 | yes for a parser that reads “ and ” as quotes, which the highlighter's classes cannot |
| nonBreakingSpace | other notation | `{"name":⍽"Ada", "age": 36}` | 0.5 | yes for a parser that reads U+00A0 as white space, which the highlighter's classes cannot |
| foreignLiteral | other notation | `{"active": True, "manager": None}` | 2.8 | yes: a word where a value may come, up to a comma, a closer or white space, is one value |
| nonFiniteNumber | other notation | `{"mean": NaN, "count": 0}` | 1.5 | yes, as foreignLiteral. The word itself has no label, since it stands for a number, for null or for a string |
| unquotedValue | other notation | `{⏎  "env": production,⏎  "port": 8080⏎}` | 0.9 | yes: the value runs to the next comma, closer or line feed. Leading characters that read as a number or a literal, e.g. the 1.4 of 1.4.2, are not scored |
| numberFormat | other notation | `{"month": 03, "opacity": .5}` | 1.5 | yes: digits, letters, +, . and _ up to the next comma, closer or white space are one value. In 1,400,000 the digits after a comma come where a key must come, so they continue the number |
| callWrapper | other notation | `{"_id": ObjectId("507f191e810c19729de860ea"), "qty": NumberLong(15)}` | 1 | yes for a parser that skips a name and ( before a value and ) after it. The round brackets are in the class of most letters. Alone it is a document of the MongoDB shell, and in a Python print it is a number as NumPy prints it |
| tuple | other notation | `{'point': (12.5, 41.9)}` | 0 | yes for a parser that reads ( and ) as brackets, which the highlighter's classes cannot. Only in a Python print |
| templatePlaceholder | other notation | `{"userId": {{user_id}}, "active": true}` | 0.2 | yes: {{user_id}} opens two braces and closes two, and the other forms end at a comma, a closer or white space |
| ellipsis | other notation | `{"items": [{"id": 1}, ...], "total": 40}` | 1.3 | yes: the marker holds no bracket and no quote, and is skipped up to the next comma, closer or line feed |
| stringConcatenation | other notation | `{"msg": "request " + "completed"}` | 0.15 | yes with a plus, and inside an array. no for two strings next to each other inside an object, where the second reads as the next key |
| unescapedQuote | inside a string | `{"note": "call "Ana" on arrival", "paid": true}` | 1.9 | no: the inner quote ends the string, and nothing at that point says that it shouldn't. The inner quotes' display kind is not scored |
| unescapedBackslash | inside a string | `{"terminal.shell": "C:\Windows\System32\cmd.exe"}` | 2.4 | yes: after a backslash and a character that JSON doesn't escape, the string goes on. A backslash before the closing quote is line rule when the string ends its line, otherwise no |
| rawLineFeedInString | inside a string | `{"msg": "line 1⏎line 2", "code": 0}` | 1.2 | yes for a parser that stays inside a string across a line feed, which is the opposite of the rule that openStringAtLineEnd needs |
| rawTabInString | inside a string | `{"notes": "fragile→handle with care"}` | 0.4 | yes: a tab inside a string reads as content |
| missingOpeningQuote | inside a string | `{⏎  "city": Lisbon",⏎  "country": "PT"⏎}` | 0.3 | yes when what is left reads as one word that the closing quote ends. no when the content holds a character that ends a word, e.g. a comma |
| doubledQuote | inside a string | `{⏎  "city": "Lisbon"",⏎  "country": "PT"⏎}` | 0.3 | yes: a quote right after a closing quote is skipped, and content right after a closing quote opens the string again |
| codeFence | wrapper | `` ```json⏎{⏎  "id": 42⏎}⏎``` `` | 2.6 | yes: a fence line holds no bracket and no quote and ends at its line feed, and the document starts at depth 0 after it |
| proseAround | wrapper | `Here is the JSON you asked for:⏎⏎{"id": 42}` | 1.3 | yes when the quotes and brackets of the sentence before the document pair up, or it has none. When one has no partner: line rule for a sentence on lines of its own, no for one on the document's first line. A sentence only after the document leaves nothing to recover |
| statementWrapper | wrapper | `callback({"id": 42, "name": "Ada"});` | 2.5 | yes: no prefix holds an opening bracket or a double quote, so the document starts at the first opening bracket, at depth 0 |
| logPrefix | wrapper | `INFO:root:{"event": "login", "user": 42}` | 1 | yes: the prefixes hold no double quote, and their square brackets come in closed pairs, e.g. [2231] |
| quotedDocument | wrapper | `b'{"ok": true, "items": [1, 2]}'` | 0.6 | yes for '…' and b'…'. no for "…", where the first quote opens a string that ends at the document's first quote |
| byteOrderMark | wrapper | `◊{"id": 42}` | 0.3 | yes: one character that starts no token, at the very start, is skipped |
| textAfterEnd | wrapper | `{⏎  "ok": true⏎};` | 0.6 | yes, and nothing is left to recover: every kept character comes before the damage |
| ansiColorCodes | wrapper | `␛[32m{"ok": true}␛[0m` | 0.2 | yes: after the escape character, the [, the digits and the semicolons up to the letter m are skipped, and that [ opens nothing |
| backslashEscapedDocument | wrapper | `{\"id\": 42, \"name\": \"Ada\"}` | 0.6 | yes: a backslash where a token may start shows that the text is escaped once, and from then on \" is a quote |
| htmlEntities | wrapper | `{&quot;id&quot;: 42, &quot;name&quot;: &quot;Ada&quot;}` | 0.3 | yes for a parser with states that follow the characters of &quot;, which the highlighter's classes cannot tell apart |
| newlineDelimited | several documents | `{"t": 1, "v": 20.5}⏎{"t": 2, "v": 20.7}⏎` | 2.4 | yes: after a complete top-level value, the start of a value begins a new document at depth 0 |
| concatenated | several documents | `{"id":1}{"id":2}` | 0.7 | yes, as newlineDelimited |
| commaSeparatedRecords | several documents | `{"id": 1},⏎{"id": 2},⏎{"id": 3}` | 0.4 | yes: a comma at depth 0 after a complete value is skipped. The rule contradicts the one for a stray closer of the top-level container |
| logLines | several documents | `09:31:07 INFO {"event": "start"}⏎09:31:08 WARN {"event": "retry", "n": 2}` | 1 | yes: every document ends at depth 0, and the quotes and the brackets of the prefixes and of the plain lines come in closed pairs, [DONE] included |

## Can a parser label the rest?

Every sample has a flag, `reachable`, that says whether a parser that reads the text once from left to right, with a state and a few counters, can give the labels after the damage.

- `yes`: it can, with character classes of its choice. `needsClass` lists what the highlighter's 33 classes cannot tell apart, e.g. in a text with single quotes the apostrophe, which is in the class of most letters.
- `line rule`: it can with a rule about line feeds, e.g. "a string that is still open at a line feed ends there". Such a rule fits indented text and has nothing to hold on to in a text on one line.
- `no`: it cannot, e.g. after an open string in the middle of a line, where the parser reads every later quote in the opposite role. These samples show what a score looks like where no tables can be right.

A sample with several kinds has the least of their flags. `debatable` marks a sample where another repair is as sensible as the one that the labels describe, e.g. a `}` too many, where the labels say that the `}` is to be skipped, and a person could as well say that the `}` is right and the text after it is the mistake.

Some rules behind a `yes` contradict each other, so no single parser gets all of these samples right: "a string ends at a line feed" for a half-typed string against a raw line feed inside a string, a key without its colon against a missing colon before a string, a missing closer against a closer of the wrong kind, a `#` comment against a key without quotes, and commas between top-level records against a stray closer of the top-level container.

## Splits and what is held out

`splitOf(original)` is a hash of the original text: 80 of 100 originals go to train, 10 to validation and 10 to test. So no original is in two splits, and all broken texts of one original are in one split.

Training never sees four kinds and one template. A sample that has one of them is only made from an original that the hash puts into the test split, which makes the test split about 18% of the samples.

- `conflictMarkers` (family comment): the marker lines are skipped up to their line feed, as a `//` or `#` comment on a line of its own is, which training has.
- `nonFiniteNumber` (family other notation): a word where a value may come, as `True` and `undefined` are.
- `logPrefix` (family wrapper): text before the document on the document's first line, as in a statement around a document and in the lines of a log.
- `concatenated` (family several documents): a new document right after a complete one. One document per line reaches the same cells of the grammar table.
- The template `order`: a business record with an array of objects, a nested object, nulls and strings with escapes. Other templates have each of these features, and none has its sequence of tokens.

Each held-out kind is recovered by a rule that kinds in training need too, so the held-out samples tell a learned rule from a remembered kind.

## Run it

From the repo's root:

```sh
bun test lab/recovery-parser                               # the invariants, about 2 seconds
bun lab/recovery-parser/check-table-parser.ts              # table-parser.ts against the reference, on about 36,000 texts
bun lab/recovery-parser/stats.ts <file> [samples] [seed]   # statistics, by default of the first 40,000 samples
bun lab/recovery-parser/dump.ts <folder> [seed] [samples]  # text files for reading
```

`stats.ts` writes the counts per source, split, kind, family, template and style, what the parser as it is already gets right after the damage, and which cells of the two tables the samples reach. `dump.ts` writes one file per kind with 60 samples, `all.txt` with the first 300 samples in the dataset's order, `valid.txt`, and `typing-replays.txt` with whole replays. In these files every code point of a broken text stands above its label and above what the parser as it is shows for it. Give both a path outside the repo: the files are large and can be made again at any time.

In the first 40,000 samples of the default seed, the parser as it is has all three values right for 40% of the labeled code points from the first damage on: the display kind for 48%, the depth for 73% and the container for 87%. In 10% of the samples it has every one of them right. 77% of the broken samples have the flag `yes`, 12% `line rule` and 11% `no`. 6% have nothing to recover, e.g. a text that is cut off, and only test that the part before the damage keeps its labels.

## Files

- `table-parser.ts`: the highlighter as a plain loop over its tables, with the tables as an argument, and a trace of every position. `check-table-parser.ts` compares it with the reference.
- `labels.ts`: the labels of a valid text. The depth and the container come from a scan with a real stack that reads neither the reference nor the tables.
- `documents.ts`: the templates and the styles.
- `edits.ts`, `scan.ts`, `random.ts`: edits with their alignment, where the entries, strings and containers of a document are, and random numbers as a hash of the seed, the index and a counter.
- `damage.ts` and `damage/`: the kinds, one file per family, and the combinations.
- `typing.ts`: the typing replays.
- `samples.ts`: `sampleAt`, `labelsOf`, the splits and what is held out.
- `stats.ts`, `dump.ts`: the statistics and the text files.
- `invariants.test.ts`: e.g. every original is valid, every broken text is rejected, the edits give the broken text, the parser as it is has every label before the first damage right, and the split depends on the original alone.

## Known limits

- The weights are estimates from three surveys of where broken JSON comes from (hand editing, the output of programs and models, and other notations). Nobody measured them.
- The contents of strings come from small word lists, and the text of a comment is drawn without a look at the member next to it, e.g. `// in EUR` above a port number. What follows real files is the syntax: where a comment sits, which characters it holds, how a tool prints.
- No text is past the highlighter's capacity: none is longer than 512 code points, and none is nested deeper than 16 levels, in the original or as the parser as it is counts the brackets of the broken text. E.g. a typing step is left out when an open string hides closing brackets and a brace in the string's content then opens a 17th level.
- The first error of the samples reaches 139 of the 192 error cells of the grammar table that a first error can reach, and 165 of the tokenizer's 620. Most of the others need depth 16, or an error in the middle of a `\u` escape, an exponent or a literal. Tables that are trained on these samples learn nothing about those cells.
- Left out: a document without its outer braces, what Java prints for a map, the layout of Python's `pprint`, documents with `\r\n` line ends (one form of `newlineDelimited` has them), and escapes of other languages such as `\0` and `\u{…}`.
- The split is by the exact original text. Two documents of one template with other values can be in two splits.
- The flag is a judgment per form of a kind, written next to each form in `damage/`. Where learned tables do well on samples with the flag `no`, the judgment was too strict for those samples.
