# Broken JSON for a parser that keeps going

The JSON highlighter in `src/json-search/highlighter` gives up at the first error of a text: from there on it shows every code point as an error. This folder makes the data for an experiment that asks whether the same loop, with other tables, can keep labeling the text after the error, e.g. so that the `"b"` of `{"a": 1 "b": 2}` is still shown as a key.

The data is synthetic. A sample is a broken text of at most 512 code points, the valid text that its author meant, and for every code point of the broken text the label of its counterpart in the valid text. Nothing is stored: sample `i` of a seed is a function of the seed and `i` alone, so `sampleAt(seed, i)` makes it without the samples before it, in about 0.2 ms. Two seeds give unrelated samples.

## What a sample holds

The type `Sample` in `samples.ts` has a comment on every field. The main ones:

- `original`: the valid text that was meant. `documents` holds the same text as one document, or as several when the text is e.g. one document per line. In a sample of a typing replay the original is the document that the typing leads to, and when an entry is being deleted, the document before the deletion.
- `broken`: the text that the parser gets.
- `kinds`: the kinds of damage in the text, e.g. `['missingComma', 'openStringAtLineEnd']`. `forms` says what each kind did, e.g. "missingComma: at a line end between two members".
- `edits` and `alignment`: what turns the original into the broken text, and for every code point of the broken text the index of its counterpart in the original, or -1 when the damage added the code point.
- `firstDamage`: the index of the first damaged code point of the broken text.
- `firstErrorPosition`: where the parser as it is reports its first error. It is never before `firstDamage` and can be after it, e.g. `{"tags": ["ops", "beta", "active": true}` lacks its `]` after `"beta"`, and the first error is the colon.
- `reachable`, `needsRules`, `needsClass`, `needsNestingFix`, `needsDisplayFix` and `debatable`: see "Can a parser label the rest?" below.
- `split` and `heldOut`: see "Splits and what is held out" below.

`labelsOf(sample)` returns one entry per code point of the broken text. The entry is `undefined` for a code point that the damage added. Otherwise it has three values:

- `kind`: the display kind that the highlighter's reference gives the counterpart, as an index into the display kinds of `kinds.ts`: 0 whitespace, 1 punctuation, 2 string, 3 escape, 4 number, 5 literal, 8 key.
- `depth`: the number of open containers after the code point, e.g. 1 after the `{` of `{"a": 1}` and 0 after its `}`.
- `container`: the innermost open container after the code point: 0 none, 1 an object, 2 an array.

When the original is several documents, each document has the labels that it has alone, so the depth is 0 between two documents.

### Which code point is which

Where the broken text is the same whichever of two equal code points an edit touches, the edits say that the later one was removed or added. E.g. of `}}}}` for `}}}` the last `}` is the added one, and when a line `  }` stands before the `}` that ends a document, the first `}` is the kept one and the line feed and the second `}` are added. So a code point of the broken text has the label of the earliest code point that it can stand for, which is what a parser that reads from the left takes it for.

A code point that stands in the place of one other code point has that one's label, e.g. the `'` that stands for a `"`, a `]` for a `}`, a `=` or a `;` for a colon, and the two swapped letters of `ture`. `replaced` marks these. A word of another notation that stands for a literal or a number has no label, e.g. `True`, `None`, `nil`, `undefined` and `NaN`: the highlighter has no display kind for a word that is not JSON's, and the label "literal" on `True` would contradict the label "string" on a value without quotes, e.g. `Tallinn`.

### What is not scored

A value of a label is `undefined` when it is not scored. The depth and the container are scored together or not at all. `unscoredKinds` and `unscoredNesting` list the code points. There are three rules, and the function `unscoredOf` in `samples.ts` applies them:

- A kind of damage says that no reading of the broken text can give a display kind. E.g. the two inner quotes of `"call "Ana" back"` are each the second half of an escape `\"` in the original, and the comma of `"name": "tiny-gl,` at the end of a line is inside the open string for every reader.
- Before the first error of the parser as it is, a value that the parser as it is does not give is not scored. Up to its first error a text is the start of a valid text, and every arm of the experiment reads valid JSON as now, so no arm can give another value there. E.g. in `{"a": ⏎ "b": 1}`, where the value of `"a"` is not typed yet, `"b"` is read as that value, as in the valid `{"a": "b"}`, and its label says key. And the `1.4` of the value `1.4.2` without quotes is read as a number.
- Where the labels' depth or container changes at a code point that is not a bracket, a bracket was removed before it, and nothing in the text shows the change. From there to the next kept bracket the depth and the container are not scored. E.g. in `{"tags": ["ops", "beta"⏎}`, where the `]` is missing, the line feed has the depth 1 in the original, and a reader is still inside the array.

So before the first error every scored value is what the parser as it is gives, and `invariants.test.ts` checks that.

## What a score counts

A score counts the code points from `firstErrorPosition` on that have a label with a scored value: `scoredCodePoints(sample)`. Before that position every arm gives the same as the parser as it is. A sample with no such code point has nothing to recover, e.g. a text that is cut off, and only tests that the part before the damage keeps its labels: 7.5% of the broken samples.

The parser as it is gives up on purpose, so nearly any change to its error cells scores better. `hand-rules.ts` therefore has two settings of the tables that are written by hand and train nothing, and `stats.ts` prints every score for all three. `stay` ignores what the parser as it is rejects: a tokenizer error starts no error line, and a token that the grammar does not accept leaves the grammar where it was. `resync` also moves the grammar to the state that follows such a token in valid JSON, e.g. a string where a comma was expected inside an object is the next key. In the first 40,000 samples of the default seed:

| Reader | Code points with every scored value right | Samples right as a whole | The same two for the group "within reach of the tables" |
| --- | --- | --- | --- |
| the parser as it is | 41.3% | 10.8% | 48.0%, 15.3% |
| `stay` | 72.8% | 28.3% | 80.5%, 39.3% |
| `resync` | 80.8% | 52.6% | 91.4%, 74.7% |

A trained result is a gain only over the better hand rule. Three more things to keep in mind when a number is read:

- One number over all broken samples says little, because a fifth of the samples cannot be labeled by tables of the highlighter's layout whatever they hold. `groupOf(sample)` puts every sample into one of six groups, see below, and the group "within reach of the tables" is the one to report first.
- The first arm of the experiment changes only cells of the grammar table. The depth and the container are sums over the tokenizer's events, and no grammar cell feeds them, so they stay what the parser as it is gives. That arm can have every scored value right for at most 60.9% of the code points, and for 70.8% in the group within reach.
- 88.9% of the scored container labels are "object" and 45.4% of the depth labels are 1. The parser as it is has the container right for 87.4%, which is less than the answer "object" every time. `stats.ts` prints the container per label value. In a text of several lines, the start of a line and its indentation say much about keys and depth, so the scores for texts on one line are printed apart.

## Where the samples come from

Out of 100 samples, 5 are valid documents, 20 are texts of typing replays and 75 are damaged documents.

**Documents** (`documents.ts`). 21 templates, e.g. a package manifest, an editor's settings, a log event, an API response, a table as an array of arrays, a document that is nested 16 levels deep, and a lone string or number. A document is written in one of six styles: on one line without spaces, on one line with spaces, indented with 2 or 4 spaces, indented with tabs, on one line with a space inside the brackets, or wrapped, i.e. the one-line text with a line feed after a comma wherever a line has reached a width, so that its lines start in the middle of containers. Free text, e.g. a note, a bio or a message, is put together from words, and four texts in ten hold something that a serializer must escape or that means something in JSON: phrases between quotes, line feeds with a letter, a digit, a quote, a bracket or spaces after them, tabs, backslashes, brackets. Together the originals reach all 88 cells of the grammar table that a valid text can reach. A few of the valid samples also have a space before every colon or lines that end with `\r\n`.

**Typing replays** (`typing.ts`). A person adds an entry to a document, deletes an entry, changes a value, or types a whole document, key by key, in a plain editor or in an editor that adds the closing bracket and the closing quote. Every key press leaves a text, and a sample is one broken text of a replay. In one replay in three a key press goes wrong, e.g. `;` for `:` or `k` for `l`, and Backspace takes it back: the text with the wrong character is a sample like any other. The valid texts of a replay are not samples.

**Damaged documents** (`damage.ts` and `damage/`). Out of 100, 60 have one kind of damage, drawn by the weights in the table of kinds below. 14 have two or three kinds that have nothing to do with each other, at least 8 code points or one line apart, and whose origins fit, e.g. no marker line of a merge conflict inside a log line. 26 are a combination with one cause, drawn by these weights:

| Combination | Weight | What the text is |
| --- | --- | --- |
| jsoncFile | 6 | a config file with comments and with a comma after the last entry, as in `tsconfig.json`. One in three is being edited as well |
| javascriptLiteral | 5 | an object literal from a JavaScript file: keys without quotes, often single quotes, trailing commas, the assignment around it, a comment, `undefined` |
| pythonPrint | 5 | what Python prints for a dict: single quotes, `True`, `False` and `None`, sometimes a tuple, `nan` or a NumPy number |
| modelAnswer | 2.5 | a language model's answer: a sentence, a code fence, the document, the fence, and sometimes one more sentence |
| movedLine | 1.6 | a line that was moved to the end of its object, so the line before it has no comma and the moved line has one |
| nodePrint | 1.4 | what Node prints for an object: keys without quotes, single quotes, and `[Object]` for what is nested below the third level |
| fencedAndDamaged | 1.2 | a code fence around a document with one damage of its own |
| fencedAndCutOff | 1 | an opening code fence and a document that stops, as from a model that reached its output limit |
| answerCutOrDamaged | 0.8 | a model's sentence, the opening fence, and a document that stops or that has one damage of its own |
| mongoShell | 0.8 | a document copied from the MongoDB shell, with values such as `ObjectId("…")`, in the old shell's notation or the new one's |
| nothingEscaped | 0.8 | strings that a program put between quotes without escaping: inner quotes, raw line feeds and tabs, single backslashes |
| cutLineThenLines | 0.8 | one document per line, where a length limit cut one line short |
| json5File | 0.6 | a JSON5 file |
| webPageCopy | 0.6 | text copied from a web page: typographic quotes, and no-break spaces in the indentation |
| hjsonHabits | 0.6 | habits from HJSON and YAML: no quotes, no commas at line ends, `#` comments, `yes` and `no` |
| documentationExample | 0.6 | an example from documentation: `...` for what was left out, a note, a placeholder for a value |
| escapedInLogLine | 0.4 | a log line in the logfmt notation with the document in one of its fields, between quotes and with a backslash before each of its own quotes |
| byteOrderMarkAndMore | 0.4 | a file with a byte order mark and one more damage |

## The kinds of damage

In the examples, ⏎ stands for a line feed, → for a tab, ⍽ for a no-break space (U+00A0), ◊ for a byte order mark (U+FEFF) and ␛ for the escape character. The weight says how often a kind is drawn among the samples with one kind of damage, relative to the other weights, e.g. `trailingComma` with 7.5 is drawn 1.5 times as often as `openStringAtLineEnd` with 5. A kind is also part of combinations and of typing replays, so its share of all samples is another number, which `stats.ts` prints.

| Kind | Family | Example | Weight | Can a parser label the rest? |
| --- | --- | --- | --- | --- |
| openStringAtLineEnd | half typed | `{⏎  "name": "tiny-glob",⏎  "pri⏎}` | 5 | line rule: a JSON string holds no raw line feed, so "a string that is open at a line feed ends there" is sound. The display kind of a comma that ends up inside the open string is not scored |
| openStringMidLine | half typed | `{"email": "ada@example.com, "role": "admin"}` | 1.6 | no: the open string ends at the next quote, which opens the next string in the original, and every later quote is read in the opposite role. line rule for a key without its closing quote when no quote follows on its line: the string then ends at the line feed |
| keyWithoutColon | half typed | `{⏎  "strict": true,⏎  "tar"⏎}` | 3.2 | yes. When the next key follows, on the same line or on the next, it needs the rule "a string after a key is the next key", which contradicts the rule for a forgotten colon |
| colonWithoutValue | half typed | `{⏎  "version": ,⏎  "license": "MIT"⏎}` | 3.5 | yes. When the next key follows, every parser reads it as the value, as in valid JSON, so its display kind is not scored, and the colon after it shows that it was a key |
| partialLiteral | half typed | `{"paid": tru, "currency": "EUR"}` | 1.2 | yes: the typed letters are literal characters in the original too, and what follows is read as what it is |
| partialNumber | half typed | `{"lat": 59., "lon": 10.75}` | 0.8 | yes, as partialLiteral |
| typingSlip | slip | `{"debug": ture, "port"; 8080}` | 1.2 | yes: a wrong letter inside a literal goes on with the literal, a wrong character in the place of a colon or a comma stands for it, and a stray character between two tokens is skipped. no for an opening bracket that comes twice, which reads as a container whose closer is missing. The tables need a class for ; and for m to show them as punctuation |
| cutOff | cut off | `{"id": 42, "name": "Ada Lovel` | 7 | yes, and nothing is left to recover: no kept character comes after the cut |
| headMissing | cut off | `"id": 42, "name": "Ada"}` | 0.6 | no: the depth at the start is unknown, and a text that starts inside a string has every later quote in the opposite role |
| middleCutOut | cut off | `{"id": 7, "tags": ["urgent", "dr...lling": true}` | 0.6 | no: the removed span can hold any number of brackets and quotes |
| missingComma | separator | `{⏎  "version": "0.4.1"⏎  "private": true⏎}` | 5.5 | yes: after a complete value, a string inside an object is the next key, and the start of a value inside an array is the next item |
| trailingComma | separator | `{⏎  "host": "localhost",⏎  "port": 8080,⏎}` | 7.5 | yes: a closing bracket after a comma closes the container |
| extraComma | separator | `{"id": 7, , "tags": ["ops"]}` | 1.5 | yes: a comma where a key or a value should start changes nothing |
| missingColon | separator | `{⏎  "port" 8080,⏎  "host": "localhost"⏎}` | 0.8 | yes. When the value is a string, it needs the rule "a string after a key is that key's value", which contradicts the rule for a half-typed key |
| foreignKeySeparator | separator | `{"id"=>42, "name"=>"Ada", "manager"=>nil}` | 0.6 | yes: where a colon is expected, = stands for it and > is skipped. The tables need a class for =, which is in the class of most letters |
| missingCloser | bracket | `{"tags": ["ops", "beta"}` | 2.7 | yes when the closer of the container around it follows and is of the other kind, with the rule that such a closer closes two containers. Otherwise no: the next entry reads as one more entry of the open container. The loop of the highlighter cannot close two containers at one bracket |
| strayCloser | bracket | `{⏎  "name": "Ada",⏎  },⏎  "active": true⏎}` | 1.5 | yes after the document's end, when no open container has the bracket's kind, and when it closes the top-level container and a comma follows. Otherwise no: it reads as a real closer. A closer right before the same closer is the kept one, and the second is the added one. The loop of the highlighter lowers the depth at every closing bracket, so it can only label what comes after the document's end |
| wrongCloser | bracket | `{"point": [59.91, 10.75}}` | 0.8 | yes, with the rule that a closer of the other kind closes one container, which contradicts the rule for a missing closer. The loop of the highlighter then has the wrong kind for a container around it |
| lineComment | comment | `{⏎  "port": 8080,⏎  // "debug": true,⏎  "host": "localhost"⏎}` | 2.8 | yes: // starts nothing else in JSON, the comment ends at the line feed, and the grammar stays where it was |
| blockComment | comment | `{"port": /* default */ 8080, "host": "localhost"}` | 0.6 | yes, with a state inside the comment and one after a *. Between a colon and its value the comment's end must be found, which needs * as a class of its own when the comment holds a digit |
| hashComment | comment | `{⏎  "retries": 3, # was 5⏎  "timeout": 30⏎}` | 0.3 | yes, as lineComment, for a parser that reads # as the start of a comment. The highlighter's classes lump # with letters, so its tables read the note as words, which works unless the note holds a quote, a colon or a bracket |
| conflictMarkers | comment | `{⏎<<<<<<< HEAD⏎  "version": "0.4.1",⏎=======⏎  "version": "0.5.0",⏎>>>>>>> release/0.5⏎  "license": "MIT"⏎}` | 1.2 | yes: a marker line starts with a character that starts no token and is skipped up to its line feed, and the other side's lines read as more members |
| unquotedKey | other notation | `{⏎  "host": "localhost",⏎  port: 8080⏎}` | 1.5 | yes: where a key may come, a word up to the colon is the key. A key that starts with t, f or n, e.g. name, needs a display cell when no error came before it: the tokenizer reads that letter as the start of true, false or null, and the display table shows it as a literal |
| singleQuotedString | other notation | `{"roles": ['admin', 'billing'], "active": true}` | 1 | yes for a parser that reads the apostrophe as a quote. The highlighter's classes lump the apostrophe with letters, so its tables read 'admin' as one word, which is enough unless the string holds a space, a comma, a colon, a bracket, a quote or a backslash |
| curlyQuotes | other notation | `{“name”: “Ada”, “age”: 36}` | 1.2 | yes for a parser that reads “ and ” as quotes. As with single quotes, the tables read “Ada” as one word, and need a class when the string holds a character that ends a word |
| nonBreakingSpace | other notation | `{"name":⍽"Ada", "age": 36}` | 0.5 | yes for a parser that reads U+00A0 as white space, which the highlighter's classes cannot |
| foreignLiteral | other notation | `{"active": True, "manager": None}` | 2.8 | yes: a word where a value may come, up to a comma, a closer or white space, is one value. The word has no label: it is not a JSON literal, and the highlighter has no display kind for it |
| nonFiniteNumber | other notation | `{"mean": NaN, "count": 0}` | 1.5 | yes, as foreignLiteral |
| unquotedValue | other notation | `{⏎  "env": production,⏎  "port": 8080⏎}` | 0.9 | yes: the value runs to the next comma or closer. line rule for several words that run to a line feed. Leading characters that read as a number or a literal, e.g. the 1.4 of 1.4.2, are shown as one by every parser, so their display kind is not scored. A colon inside the value, e.g. in a time, needs a tokenizer that knows that it is not reading a key |
| numberFormat | other notation | `{"month": 03, "opacity": .5}` | 1.5 | yes: digits, letters, +, . and _ up to the next comma, closer or white space are one value. In 1,400,000 the digits after a comma come where a key must come, so they continue the number. After a leading zero the digits' display kind is not scored, since "03" as a string is as sensible |
| callWrapper | other notation | `{"_id": ObjectId("507f191e810c19729de860ea"), "qty": NumberLong(15)}` | 1 | yes for a parser that skips a name and ( before a value and ) after it. Around a string the tables read them as words. Around a number they need a class for the round brackets, which are in the class of most letters. Alone it is a document of the MongoDB shell, and in a Python print it is a number as NumPy prints it |
| tuple | other notation | `{'point': (12.5, 41.9)}` | 0 | yes for a parser that reads ( and ) as brackets, which the highlighter's classes cannot. Only in a Python print |
| templatePlaceholder | other notation | `{"userId": {{user_id}}, "active": true}` | 0.2 | yes: {{user_id}} opens two braces and closes two, and the other forms end at a comma, a closer or white space |
| ellipsis | other notation | `{"items": [{"id": 1}, ...], "total": 40}` | 1.3 | yes: the marker holds no quote and is skipped up to the next comma, closer or line feed. The [Object] and [Array] of Node open a bracket and close it |
| stringConcatenation | other notation | `{"msg": "request " + "completed"}` | 0.15 | yes with a plus, and inside an array. no for two strings next to each other inside an object, where the second reads as the next key |
| unescapedQuote | inside a string | `{"note": "call "Ana" on arrival", "paid": true}` | 1.9 | no: the inner quote ends the string, and nothing at that point says that it shouldn't. yes for an item of an array with two inner quotes around one word, which reads as a string, a word and a string. The inner quotes' display kind is not scored |
| unescapedBackslash | inside a string | `{"terminal.shell": "C:\Windows\System32\cmd.exe"}` | 2.4 | yes: after a backslash and a character that JSON doesn't escape, the string goes on. A backslash before the closing quote is line rule when the string ends its line, otherwise no. The form \xe9 needs a class for x |
| rawLineFeedInString | inside a string | `{"msg": "line 1⏎line 2", "code": 0}` | 1.2 | yes with the rule that a line feed inside a string is content, which contradicts the rule for a half-typed string |
| rawTabInString | inside a string | `{"notes": "fragile→handle with care"}` | 0.4 | yes: a tab inside a string reads as content |
| missingOpeningQuote | inside a string | `{⏎  "city": Lisbon",⏎  "country": "PT"⏎}` | 0.3 | yes when what is left reads as one word that the closing quote ends. no when the content holds a character that ends a word, e.g. a comma. A value that starts like a number or a literal, e.g. 2.0", is shown as one up to the quote, which the tables then read as the start of a string |
| doubledQuote | inside a string | `{⏎  "city": "Lisbon"",⏎  "country": "PT"⏎}` | 0.3 | yes for a parser that knows that it stands right after a closing quote: a second quote there is skipped, and content there opens the string again. The highlighter's tokenizer is in the same state after a closing quote as between any two tokens, so its tables read the second quote as the start of a string |
| codeFence | wrapper | `` ```json⏎{⏎  "id": 42⏎}⏎``` `` | 2.6 | yes: a fence line holds no bracket and no quote and ends at its line feed, and the document starts at depth 0 after it |
| proseAround | wrapper | `Here is the JSON you asked for:⏎⏎{"id": 42}` | 1.3 | yes when the quotes and brackets of the sentence before the document pair up, or it has none. A quote without its partner: line rule for a sentence on lines of its own, no for one on the document's first line. A bracket without its partner: no. A sentence only after the document leaves nothing to recover |
| statementWrapper | wrapper | `callback({"id": 42, "name": "Ada"});` | 2.5 | yes: no prefix holds an opening bracket or a double quote, so the document starts at the first opening bracket, at depth 0. The closing brackets of the guard )]}', come before the document, where they can only be skipped, which the highlighter's loop does only as long as it reads them as part of an error |
| logPrefix | wrapper | `INFO:root:{"event": "login", "user": 42}` | 1 | yes: the prefixes hold no double quote and no bracket |
| quotedDocument | wrapper | `b'{"ok": true, "items": [1, 2]}'` | 0.6 | yes for '…' and b'…'. no for "…", where the first quote opens a string that ends at the document's first quote |
| byteOrderMark | wrapper | `◊{"id": 42}` | 0.3 | yes: one character that starts no token, at the very start, is skipped |
| textAfterEnd | wrapper | `{⏎  "ok": true⏎};` | 0.6 | yes, and nothing is left to recover: every kept character comes before the damage |
| ansiColorCodes | wrapper | `␛[32m{"ok": true}␛[0m` | 0.2 | yes: after the escape character, the [, the digits and the semicolons up to the letter m are skipped, and that [ opens nothing. With a semicolon in the code, the tables need a class to find the m |
| backslashEscapedDocument | wrapper | `{\"id\": 42, \"name\": \"Ada\"}` | 0.6 | yes: a backslash where a token may start shows that the text is escaped once, and from then on \" is a quote |
| htmlEntities | wrapper | `{&quot;id&quot;: 42, &quot;name&quot;: &quot;Ada&quot;}` | 0.3 | yes for a parser with states that follow the characters of &quot;. The tables read a string between two entities as one word, and need more when it holds a character that ends a word |
| newlineDelimited | several documents | `{"t": 1, "v": 20.5}⏎{"t": 2, "v": 20.7}⏎` | 2.4 | yes: after a complete top-level value, the start of a value begins a new document at depth 0 |
| concatenated | several documents | `{"id":1}{"id":2}` | 0.7 | yes, as newlineDelimited |
| commaSeparatedRecords | several documents | `{"id": 1},⏎{"id": 2},⏎{"id": 3}` | 0.4 | yes with the rule that a comma after the top-level value is skipped, which contradicts the rule for a closer too many of the top-level container |
| logLines | several documents | `09:31:07 INFO {"event": "start"}⏎09:31:08 WARN {"event": "retry", "n": 2}` | 1 | yes: every document ends at depth 0, and the quotes and the brackets of the prefixes and of the plain lines come in closed pairs, [DONE] included |

## Can a parser label the rest?

Every sample has a flag, `reachable`, that says whether a parser can give every scored label. The parser meant here reads one code point at a time from left to right, with a state and a stack of the open containers, and reads valid JSON exactly as the highlighter does. It may tell any two characters apart and correct its depth.

- `yes`: some such parser can. The rule that it follows may contradict the rule that another sample needs, see below.
- `line rule`: it can when it takes a line feed inside a token as the token's end, e.g. "a string that is still open at a line feed ends there". Such a rule fits indented text and has nothing to hold on to in a text on one line.
- `no`: it cannot. A later character decides what an earlier one is, e.g. after an open string in the middle of a line, where the parser reads every later quote in the opposite role. Or the text reads as another valid continuation, e.g. after a missing closing bracket inside a line. Or only a rule made for this one form labels it, and that rule contradicts rules that far more texts need.

The flag is a judgment per form of a kind, written next to each form in `damage/`. A sample with several kinds has the least of their flags, and `no` when its kinds need two rules that exclude each other. A sample with nothing to recover has the flag `yes`, whatever its kinds.

Three fields say what tables of the highlighter's own layout cannot do for a sample. The first two follow from the parser as it is alone, with no judgment:

- `needsNestingFix`: a scored depth or container cannot come out of the highlighter's loop. Up to the first tokenizer error, the depth and the container are sums over events that come from cells that valid input reaches, so they are what the parser as it is gives. After that error the depth still changes by at most one per code point. E.g. the `}` of `{"tags": ["ops", "beta"}` must close two containers, and a `}` too many lowers the depth of everything after it.
- `needsDisplayFix`: a scored display kind cannot come out of the loop as long as the display table is as it is. E.g. in `{name: "Ada"}` the tokenizer reads the `n` as the start of `null`, by a cell that valid input reaches, and the display table shows it as a literal in every grammar state.
- `needsClass`: what the tokenizer must tell apart and cannot with its 33 character classes, which lump most characters with letters, e.g. the apostrophe as a quote. A string in single quotes that holds no space, comma, colon, bracket, quote or backslash needs no class, since the tables read `'admin'` as one word.

`groupOf(sample)` gives one group per sample, the first that fits in this order, with the share of the broken samples:

| Group | Share | What it takes |
| --- | --- | --- |
| out of reach | 8.6% | the flag is `no` |
| needs a nesting fix | 1.4% | `needsNestingFix` |
| needs a character class | 7.4% | `needsClass` is not empty |
| needs a line rule | 9.5% | the flag is `line rule` |
| needs a display cell | 0.9% | `needsDisplayFix` |
| within reach of the tables | 72.3% | none of the above: tables of the highlighter's own layout, with more states where needed, can label the sample |

`debatable` marks a sample where another repair is as sensible as the one that the labels describe and would give other scored labels to kept code points, e.g. a `}` too many, where the labels say that the `}` is to be skipped, and a person could as well say that the `}` is right and the text after it is the mistake. 8.9% of the broken samples.

### Rules that exclude each other

Some rules behind a `yes` or a `line rule` contradict each other, so no single parser gets all of these samples right. `needsRules` lists the rules of this kind that a sample needs, and `contradictions` in `damage/types.ts` lists the pairs. In the first 40,000 samples:

| A rule | Samples | The rule that it excludes | Samples |
| --- | --- | --- | --- |
| a string that is open at a line feed ends there, e.g. after `"name": "tiny-gl` at the end of a line | 3,677 | a line feed inside a string is content, e.g. in a note of several lines that was pasted between quotes | 532 |
| a string after a key is the next key, e.g. `"tar" "license": "MIT"`, where `"tar"` is half typed | 1,631 | a string after a key is that key's value, e.g. `"port" "8080"`, where the colon is missing | 122 |
| a closer of the other kind closes one container, e.g. the first `}` of `[59.91, 10.75}}` | 214 | a closer of the other kind closes two containers, e.g. the `}` of `["ops", "beta"}` | 257 |
| a comma after the top-level value is skipped, e.g. between the records of `{"id": 1}, {"id": 2}` | 77 | a comma after the top-level value opens the value again, e.g. after the first `}` of `{"name": "Ada"}, "active": true}` | 71 |

For a string after a key, the two rules agree with one that asks for a line feed: on a new line the string is the next key, on the same line it is the value. The tables as they are cannot hold that rule, since a line feed between two tokens leaves no trace in the tokenizer's state or the grammar's.

## Splits and what is held out

`splitOf(original)` is a hash of the original's tokens as the grammar table reads them: brackets, colons, commas, strings, and numbers or literals, e.g. `{"id": 7}` and `{ "port":8080 }` are both `{s:n}`. 80 of 100 sequences go to train, 10 to validation and 10 to test. So no original is in two splits, all broken texts of one original are in one split, and a validation or test document's sequence of tokens is in no train document. For a text of several documents the sequence is that of all of them together.

Training never sees four kinds and one template. A sample that has one of them is only made from an original that the hash puts into the test split, which makes the test split about 20% of the samples. What decides whether a sample is held out is fixed by the first try at it, and the later tries only draw other documents, so a held-out kind is as frequent as its weight says, and it sits on the held-out template as often as that template takes it, e.g. 14% of the `conflictMarkers` samples.

- `conflictMarkers` (family comment): the marker lines are skipped up to their line feed, as a `//` or `#` comment on a line of its own is.
- `nonFiniteNumber` (family other notation): a word where a value may come, as `undefined` and `nil` are.
- `logPrefix` (family wrapper): text before the document on the document's first line, in four formats that no line of the kind `logLines` has.
- `concatenated` (family several documents): a new document right after a complete one. One document per line reaches the same cells of the grammar table.
- The template `order`: a business record with an array of objects, a nested object, nulls and strings with escapes. Other templates have each of these features, and none has its sequence of tokens.

What these tell depends on the arm. Tables read cells and not kinds, and the held-out kinds reach cells that kinds in training reach too, so for tables they hold nothing new, and `resync` scores as well on them as on the rest. They are new to an arm that sees characters, e.g. a network that never saw `<<<<<<<` or `NaN`. Every run of 8 tokens of the template `order` is in some training document, 86% of its runs of 16 and 14% of its runs of 24, so the template is new only to an arm that looks at more than a few tokens.

Reports should give four groups apart and never one number for "the test split", of which a half is held out: nothing held out, a held-out kind on a template that training has, kinds that training has on the held-out template, and both. Per kind the test split is small: most kinds have fewer than 100 test samples in 40,000. `sampleAt(seed, index, {kind, split: 'test'})` makes a test sample of one kind, so an evaluation set with a fixed number per kind, e.g. 400, can be made besides the samples in their own mix.

## Run it

From the repo's root:

```sh
bun test lab/recovery-parser                               # the invariants, about 2 seconds
bun lab/recovery-parser/check-table-parser.ts              # table-parser.ts against the reference, on about 36,000 texts
bun lab/recovery-parser/check-samples.ts [samples] [seed]  # a second derivation of every sample, by default of 40,000
bun lab/recovery-parser/stats.ts <file> [samples] [seed]   # statistics, by default of the first 40,000 samples
bun lab/recovery-parser/dump.ts <folder> [seed] [samples]  # text files for reading
```

`stats.ts` writes the counts per source, split, group, kind, family, template and style, the samples on each side of the rules that exclude each other, what the three readers get right per group and per kind, and which cells of the two tables the samples reach. `dump.ts` writes two files per kind with 60 samples, one with the whole texts and one cut down to the columns around the damage, `all.txt` with the first 300 samples in the dataset's order, `valid.txt`, and `typing-replays.txt` with whole replays. In these files every code point of a broken text stands above its label and above what the parser as it is shows for it. Give both a path outside the repo: the files are large and can be made again at any time.

## Files

- `table-parser.ts`: the highlighter as a plain loop over its tables, with the tables as an argument, and a trace of every position. `check-table-parser.ts` compares it with the reference.
- `hand-rules.ts`: the two hand-written settings of the tables, `stay` and `resync`.
- `labels.ts`: the labels of a valid text, and the sequence of tokens that the split is made of. The depth and the container come from a scan with a real stack that reads neither the reference nor the tables.
- `documents.ts`: the templates and the styles.
- `edits.ts`, `scan.ts`, `random.ts`: edits with their alignment and their canonical form, where the entries, strings and containers of a document are, and random numbers as a hash of the seed, the index and a counter.
- `damage.ts` and `damage/`: the kinds, one file per family, the rules that exclude each other, and the combinations.
- `typing.ts`: the typing replays.
- `samples.ts`: `sampleAt`, `labelsOf`, `groupOf`, what is not scored, the splits and what is held out.
- `check-samples.ts`: a second derivation of a sample's alignment, labels, first damage and unscored values, with its own JSON parser and no code of the dataset.
- `stats.ts`, `dump.ts`: the statistics and the text files.
- `invariants.test.ts`: e.g. every original is valid, every broken text is rejected, the edits give the broken text, before its first error the parser as it is gives every scored label, the second derivation agrees and notices samples that are spoiled on purpose, the hand rules read valid documents as before, and no sequence of tokens is in two splits.

## Known limits

- The weights are estimates from three surveys of where broken JSON comes from (hand editing, the output of programs and models, and other notations). Nobody measured them.
- The words of strings come from a small list, and the text of a comment is drawn without a look at the member next to it, e.g. `// in EUR` above a port number. The other side of a merge conflict is a mechanical variant of the kept side, which can read oddly. What follows real files is the syntax: where a comment sits, which characters it holds, how a tool prints.
- No text is past the highlighter's capacity: none is longer than 512 code points, and none is nested deeper than 16 levels, in the original or as the parser as it is counts the brackets of the broken text. E.g. a typing step is left out when an open string hides closing brackets and a brace in the string's content then opens a 17th level.
- The first error of the samples reaches 134 of the 192 error cells of the grammar table that a first error can reach, and 182 of the tokenizer's 620. Most of the others need depth 16, or an error in the middle of a `\u` escape, an exponent or a literal. Tables that are trained on these samples learn nothing about those cells.
- Left out: a document without its outer braces, what Java prints for a map, the layout of Python's `pprint`, damaged documents with `\r\n` line ends (valid samples and one form of `newlineDelimited` have them), and escapes of other languages such as `\0` and `\u{…}`.
- The flag `no` is the strictest reading. About a third of the samples with it are labeled right by tables that are written for their form alone, e.g. `"note": "call "Ana" back"`, where a rule that shows a word between two strings as a string labels everything. Such a rule excludes rules that far more samples need, here the rule that a string after a complete value is the next key. `needsClass` is strict in the same way: a fifth of the samples with it are labeled right by tables that take a space for a part of a word.
- `needsNestingFix` and `needsDisplayFix` find what two facts about the loop rule out. They do not find everything that the loop cannot do, e.g. the depth of the lines after a line that was cut in `cutLineThenLines`, which must go back to 0 at a bracket.
- The place of the damage follows the surveys, so several frequent kinds damage the end of a text, e.g. half of the trailing commas sit in the last tenth, and such a sample has few code points to score. The score per code point is carried by the samples with early damage, which is why `stats.ts` also prints the share of samples that are right as a whole and the mean of the samples' own shares.
