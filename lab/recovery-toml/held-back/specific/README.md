# Held back: mistakes that people make in TOML

**Do not read this folder if you build the parser, the train data, the training or its machinery.** See `../README.md`.

This folder is one of the tests of the TOML track (`lab/recovery-toml/`): a generator of broken TOML in which every break is a mistake that people really make, e.g. `port: 8080` with YAML's colon, or `name = "tiny` without its closing quote. The train data of the track knows nothing of TOML: its damage deletes, copies and swaps code points and lines. So this set asks whether tables that were trained on such damage recover from the mistakes of real files.

`sampleAt(seed, index)` of `samples.ts` makes sample `index` of a seed without the ones before it, in about 1 ms. A sample has the shape of a sample of `../../samples.ts`: a valid document, a broken text made of it, and which code points of the broken text are which code points of the document. `labelsOf(sample)` gives every code point of the broken text the label of its counterpart: the display kind, the depth after it and the innermost container after it, as `../../reference.ts` gives them.

**The set that a final scoring takes is the samples 0 to 2,999 of the default seed, 20261107.**

## How a sample is made

1. **The kinds.** One kind of mistake is drawn by its weight, see the table below. One sample in three gets a second kind, of those that can share a text. `sampleAt(seed, index, {kind})` asks for one kind alone.
2. **The document.** A template is drawn: with probability one half one of the two templates that are held out of training, `deployConfig` and `taskRunner`, and otherwise one of the 14 other templates that are modeled on real files. The templates `deepNesting` and `oddities` are left out: they hold what TOML allows and no such file has, e.g. the key `1979-05-27`, and a person's mistake in such a text is no real one. A document of the template is made as the dataset makes it (`../../documents.ts`), and it is drawn again until it is in the test split of `../../splits.ts`. So no document of the set, and no sequence of tokens of one, is in a train or validation sample.
3. **The mistakes.** Each kind looks for a place in the document, e.g. a string value that is the last thing on its line, and returns edits. Two mistakes must sit apart: something other than white space stands between them, and they are on different lines or at least 8 code points from each other.
4. **What is thrown away.** A try gives no sample when the document has no place for a mistake, or when the result is still valid for the tables, is longer than 512 code points, is counted deeper than 16 levels by the parser as it is, or leaves no code point to score. Another document is then drawn, and after 150 documents without a sample other kinds are drawn. `discarded` of a sample lists the reasons of its tries.

## The label of a code point

The edits of a sample are in the canonical form of `../../edits.ts`: of two equal code points, the later one is the removed or the added one. A code point of the broken text is then one of three things:

- **Kept.** It is a code point of the document that no edit touched, and has that code point's label.
- **Standing for another.** It stands in the place of one code point of the document and plays its part, and has its label. Only three pairs are allowed, all of them pairs of the written set: a quote of any sort for a quote or an apostrophe, e.g. `“` for `"`, a colon for the equals sign, and white space for a space, e.g. a line end.
- **Added.** It has no counterpart and no label, e.g. a second `=`, the unit of `30s`, a line of prose, or the word `True`, which takes the place of `true` as a whole.

A score counts the code points from the first error of the parser as it is on, as in the dataset. A value of a label is not scored where no parser can be asked for it. `unscoredOf` in `samples.ts` has the five rules:

1. **What a kind declares:** kept code points that every parser shows as something else, e.g. the comment that an open string takes with it, the backslash of `"C:\logs"`, and the name of `server:` for `[server]`, which starts as a key does.
2. **Before the first error,** a value that the parser as it is does not give. Up to its first error a text is the start of a valid text, and the experiment reads valid TOML as now.
3. **After a removed bracket:** where the labels' depth or container changes at a code point that is no bracket, the depth and the container are not scored up to the next kept bracket, e.g. for the lines after `ports = [80, 443`. The bracket of a header counts as one.
4. **A string without its opening quote:** the display kind of the code points at its start that read as a number or as true or false, e.g. the `0.4` of `version = 0.4.1`.
5. **A number with a slip in it:** when a number or a date lacks a code point and an added code point stands right against what is left of it, e.g. `2026/02/05` for `2026-02-05`, the display kind of what is left is not scored. The written set gives such code points no label at all. Here the depth and the container stay scored.

Rules 1 to 4 are those of the JSON dataset (`lab/recovery-parser/samples.ts`), and rule 5 is that of the written set (`../written/`).

## What a sample says about a parser

A sample of the dataset comes with no judgment, since its damage is blind. A sample of this set says, as a sample of the JSON dataset does:

- **`reachable`**: `yes`, `line rule` or `no`. Whether a parser of the tables' form can give every scored label. The parser meant has the loop of `../../table-parser.ts`: one code point at a time, a tokenizer state, a grammar state, the stack of open arrays and inline tables with one stack action per code point, the display kind from the event and the grammar state. It reads valid TOML exactly as the tables do. It may have more states and more character classes. `line rule` says that the labels need a string that is open at the end of its line to end there. `no` says that a later code point decides what an earlier one is, or that the text is the start of another valid text, or that the rule which would label the sample is at odds with a rule that far more samples need.
- **`needsClass`**: what the tokenizer must tell apart and cannot with the tables' 47 character classes, e.g. `the typographic quotes`.
- **`debatable`**: another repair is as sensible and gives other labels. Only a merge conflict is marked so: either side can be the document.
- **`needsNestingFix`**: the proof of `../../limits.ts` that the scored depths cannot come out of the loop, because the depth moves by one level per code point.
- **`groupOf(sample)`**: the first of `out of reach`, `needs a nesting fix`, `needs a character class`, `needs a line rule` and `within reach of the tables` that fits, with the names of the JSON dataset's groups.

**The flags are judgments per form of a mistake, and no proofs.** They were made by reading the tables: which cell reads the code point where the mistake shows, and whether a valid text reads that cell too. `check-cells.ts` of the parser gives those cells.

## The kinds

36 kinds in six families. The weight says how often the kind is drawn: 3 for what people do most, 1 for what is rare. In an example, `⏎` is a line feed. Each example is a real output: `check.ts` verifies that the kind makes the broken text of the document.

| Kind | Family | Weight | The mistake | The document | The broken text |
|---|---|---|---|---|---|
| `colonForEquals` | separator | 3 | A colon in the place of the equals sign, as YAML and JSON write an entry: in one entry, in every entry of a table or of the text, or in an inline table. | <code>port = 8080⏎host = "localhost"⏎</code> | <code>port: 8080⏎host = "localhost"⏎</code> |
| `doubledEquals` | separator | 2 | The equals sign typed twice, or written as the assignment of another language: `==`, `= =`, `=>` or `:=`. | <code>debug = false⏎</code> | <code>debug == false⏎</code> |
| `missingEquals` | separator | 2 | The equals sign is missing between a key and a value that is a string, a number, an array or an inline table. | <code>name = "tiny"⏎</code> | <code>name "tiny"⏎</code> |
| `missingCommaInArray` | separator | 2 | A comma is missing between two values of an array, on one line or at a line end. | <code>ports = &#91;8001, 8002&#93;⏎</code> | <code>ports = &#91;8001 8002&#93;⏎</code> |
| `commaAtLineEnd` | separator | 2 | A comma or a semicolon after an entry, as a line of JSON or of JavaScript ends: after one entry, or after every entry of a table. | <code>name = "tiny"⏎version = "0.4.1"⏎</code> | <code>name = "tiny",⏎version = "0.4.1"⏎</code> |
| `trailingCommaInInlineTable` | separator | 3 | A comma after the last entry of an inline table, which an array allows and TOML 1.0 forbids here. | <code>serde = &#123; version = "1.0", optional = true &#125;⏎</code> | <code>serde = &#123; version = "1.0", optional = true, &#125;⏎</code> |
| `unquotedString` | quote | 3 | A string value without its quotes, as YAML and INI files write one: one word, a version, a path, several words, or every string value of a table. | <code>name = "tiny-glob"⏎version = "0.4.1"⏎</code> | <code>name = tiny-glob⏎version = "0.4.1"⏎</code> |
| `missingClosingQuote` | quote | 3 | A string value without its closing quote: at the end of its line, before a comment, or inside an array or an inline table. | <code>name = "tiny" # the crate⏎edition = "2021"⏎</code> | <code>name = "tiny # the crate⏎edition = "2021"⏎</code> |
| `missingOpeningQuote` | quote | 1 | A string value without its opening quote. | <code>name = "tiny"⏎edition = "2021"⏎</code> | <code>name = tiny"⏎edition = "2021"⏎</code> |
| `typographicQuotes` | quote | 2 | The quotes that a word processor or a web page makes of straight quotes, around one string or around every string of the text. | <code>title = "Harbor Relay" # shown in the tab⏎</code> | <code>title = “Harbor Relay” # shown in the tab⏎</code> |
| `twoQuotesCloseMultiLine` | quote | 1 | A string of several lines that is closed with two quotes where it takes three. | <code>run = """⏎cargo fmt⏎cargo test⏎"""⏎alias = "t"⏎</code> | <code>run = """⏎cargo fmt⏎cargo test⏎""⏎alias = "t"⏎</code> |
| `lineFeedInString` | quote | 1 | A text of several lines between single quotes, where TOML takes three. | <code>run = """⏎cargo fmt⏎cargo test⏎"""⏎alias = "t"⏎</code> | <code>run = "⏎cargo fmt⏎cargo test⏎"⏎alias = "t"⏎</code> |
| `unescapedBackslash` | quote | 1 | A backslash that is content in a string between quotes, e.g. a Windows path or a regular expression. | <code>log&#95;dir = 'C:&#92;logs&#92;relay'⏎</code> | <code>log&#95;dir = "C:&#92;logs&#92;relay"⏎</code> |
| `missingHeaderBracket` | bracket | 2 | A header without its closing or its opening bracket. | <code>&#91;server&#93;⏎port = 8080⏎</code> | <code>&#91;server⏎port = 8080⏎</code> |
| `unbalancedDoubleBracket` | bracket | 2 | One bracket too few around the header of an array of tables, or one too many around the header of a table: `[[name]` or `[name]]`. | <code>&#91;&#91;plugins&#93;&#93;⏎name = "auth"⏎</code> | <code>&#91;&#91;plugins&#93;⏎name = "auth"⏎</code> |
| `missingArrayBracket` | bracket | 3 | An array without its closing bracket, on one line or on several, before an entry or before a header. | <code>ports = &#91;8001, 8002&#93;⏎host = "localhost"⏎</code> | <code>ports = &#91;8001, 8002⏎host = "localhost"⏎</code> |
| `missingCloseBrace` | bracket | 2 | An inline table without its closing brace. | <code>serde = &#123;version = "1.0", optional = true&#125;⏎log = "0.4"⏎</code> | <code>serde = &#123;version = "1.0", optional = true⏎log = "0.4"⏎</code> |
| `inlineTableOnSeveralLines` | bracket | 3 | An inline table with one entry per line, as JSON writes an object. TOML 1.0 wants it on one line. | <code>serde = &#123; version = "1.0", optional = true &#125;⏎</code> | <code>serde = &#123;⏎  version = "1.0",⏎  optional = true⏎&#125;⏎</code> |
| `keyWithSpace` | key or value | 2 | A key or a header's name of two words with a space between them, where TOML wants a hyphen, an underscore or quotes. | <code>log&#95;level = "info"⏎</code> | <code>log level = "info"⏎</code> |
| `valueLeftOut` | key or value | 3 | An entry without its value: nothing after the equals sign, or only the key. | <code>timeout = 30 # in seconds⏎retries = 3⏎</code> | <code>timeout = # in seconds⏎retries = 3⏎</code> |
| `headerWithTrailingDot` | key or value | 1 | A header with a dot too many: before the closing bracket, after the opening one, or two between two parts. | <code>&#91;server.tls&#93;⏎enabled = true⏎</code> | <code>&#91;server.tls.&#93;⏎enabled = true⏎</code> |
| `foreignLiteral` | key or value | 3 | true and false as another language writes them (True, TRUE, yes, on), and a word for "no value" (null, None, nil), which TOML does not have. | <code>debug = true⏎verbose = false⏎</code> | <code>debug = True⏎verbose = False⏎</code> |
| `numberWithUnit` | key or value | 2 | A number with its unit after it, e.g. a duration, a size or a percentage. | <code>timeout = 30⏎</code> | <code>timeout = 30s⏎</code> |
| `numberInAnotherForm` | key or value | 2 | A number in a notation that TOML does not have: a leading zero, an octal number without its o, a decimal point without a digit on one side, a comma between the thousands. | <code>mode = 0o755⏎ratio = 0.5⏎</code> | <code>mode = 0755⏎ratio = 0.5⏎</code> |
| `dateInAnotherForm` | key or value | 1 | A date or a time in another notation: slashes, a month or a day with one digit, a time without seconds. | <code>updated = 2026-02-05⏎</code> | <code>updated = 2026/02/05⏎</code> |
| `templatePlaceholder` | key or value | 1 | A placeholder of a template or of a shell where a value belongs, e.g. `${PORT}` or `{{ port }}`. | <code>port = 8080⏎host = "localhost"⏎</code> | <code>port = &#36;&#123;PORT&#125;⏎host = "localhost"⏎</code> |
| `jsonPastedIn` | other language | 3 | Entries pasted from a JSON file: quotes around the key, a colon, a comma at the end of the line, and for a whole table the braces of the object. | <code>name = "tiny"⏎version = "0.4.1"⏎private = true⏎</code> | <code>"name": "tiny",⏎"version": "0.4.1",⏎private = true⏎</code> |
| `yamlBlock` | other language | 2 | A table as a block of YAML: the name with a colon, and below it the entries with colons, indented. | <code>&#91;server&#93;⏎port = 8080⏎host = "localhost"⏎</code> | <code>server:⏎  port: 8080⏎  host: "localhost"⏎</code> |
| `yamlListItems` | other language | 2 | An array as a YAML list: the key with a colon, and one line per value with a hyphen before it. | <code>ports = &#91;⏎  8001,⏎  8002,⏎&#93;⏎</code> | <code>ports:⏎  - 8001⏎  - 8002⏎</code> |
| `semicolonComment` | other language | 2 | A comment that starts with a semicolon, as in an INI file: one comment of the document, every comment, or a new one. | <code># connection settings⏎port = 8080⏎</code> | <code>; connection settings⏎port = 8080⏎</code> |
| `slashComment` | other language | 2 | A comment that starts with two slashes, as in JavaScript or C: one comment of the document, every comment, or a new one. | <code>port = 8080 # default⏎</code> | <code>port = 8080 // default⏎</code> |
| `cutInTheMiddle` | around the text | 2 | A part of the text is missing in the middle: a span that a paste or a length limit dropped, with or without a mark such as ... in its place, or whole lines that an example leaves out. | <code>name = "tiny-glob"⏎version = "0.4.1"⏎edition = "2021"⏎license = "MIT"⏎</code> | <code>name = "tiny-gedition = "2021"⏎license = "MIT"⏎</code> |
| `conflictMarkers` | around the text | 2 | The marker lines of a merge conflict with the lines of the other side, or one marker line that was left behind. | <code>name = "tiny"⏎version = "0.4.1"⏎edition = "2021"⏎</code> | <code>name = "tiny"⏎&lt;&lt;&lt;&lt;&lt;&lt;&lt; HEAD⏎version = "0.4.1"⏎=======⏎version = "0.5.1"⏎&gt;&gt;&gt;&gt;&gt;&gt;&gt; main⏎edition = "2021"⏎</code> |
| `proseAround` | around the text | 2 | A sentence before the document, or one before and one after, as a language model writes around its answer. | <code>name = "tiny"⏎</code> | <code>Here is the TOML you asked for:⏎⏎name = "tiny"⏎</code> |
| `codeFence` | around the text | 2 | The lines of a markdown code fence around the document, or only the opening one. | <code>name = "tiny"⏎</code> | <code>&#96;&#96;&#96;toml⏎name = "tiny"⏎&#96;&#96;&#96;⏎</code> |
| `invisibleCharacter` | around the text | 1 | A character that an editor does not show: a byte order mark at the start, a no-break space in the place of a space, a zero width space. | <code>port = 8080⏎</code> | <code>⟨U+FEFF⟩port = 8080⏎</code> |

The second table says which code points of the example are kept, which stand for another and which are added, and gives the judgment that the sample's flag `reachable` holds.

| Kind | The alignment | Can a parser of the tables' form show every code point right after the mistake? |
|---|---|---|
| `colonForEquals` | The colon stands for the equals sign and has its label, punctuation. The white space before the equals sign is removed. | Yes. After a key, the colon is read by a cell that no valid text reads: the tokenizer as it is gives up on the rest of the line there, and the cell can do what the cell of the equals sign does. A key that is a number is the exception: `12:` is the start of a time. |
| `doubledEquals` | The second sign is added and has no label. Of two equal signs the later one is the added one. | Yes: the second sign stands where a value or an equals sign is expected, which is an error for the parser as it is, and can be skipped. The `>` is in the class `other`, see semicolonComment. |
| `missingEquals` | The equals sign and one space are removed. Everything else is kept. | Yes for the values that the kind takes: after a key and white space, a quote, a bracket, a digit or a sign is an error for the parser as it is, and can start the value. `true` and `false` are left out: a word after a key goes on with the key, see keyWithSpace. |
| `missingCommaInArray` | The comma is removed. Everything else is kept. | Yes: a value where a comma is expected is an error for the parser as it is, and can be the next value. No when the comma is missing at a line end and the next value is a word, e.g. `true`: after missingArrayBracket, a word at that place is the key of the next entry. |
| `commaAtLineEnd` | The comma is added and has no label. | Yes: a comma after a value outside of every bracket is an error for the parser as it is, and can be skipped. The semicolon is in the class `other`, see semicolonComment. |
| `trailingCommaInInlineTable` | The comma is added and has no label. | Yes: a closing brace where a key is expected is an error for the parser as it is, and can close the inline table. |
| `unquotedString` | The two quotes are removed. The content keeps its label, string. Where its start reads as a number or as true or false, e.g. the 0.4 of 0.4.1, the display kind is not scored. | Yes: a word that is no value, where a value is expected, is an error for the parser as it is, and can start a value that is shown as a string up to the end of the line, a comment, or a comma or bracket of its array. No for a word at the start of a line inside an array: after missingArrayBracket, a word there is the key of the next entry. |
| `missingClosingQuote` | The closing quote is removed. What the open string takes with it up to the end of the line, here the comment, keeps its label, and its display kind is not scored. | With the line rule: a string that is open at the end of its line ends there. The tokenizer as it is already goes back to between tokens at such a line end, by a cell that no valid text reads. No when more of an array or of an inline table follows on the line: the string takes the closing brackets with it, and a later quote is read in the opposite role. |
| `missingOpeningQuote` | The opening quote is removed. The content and the closing quote keep their label, string, with the start of the content as in unquotedString. | Yes when the closing quote stands after a letter or a digit: there it is read by a cell that no valid text reads, and can end the value. After another character, e.g. a period, the quote is read as the start of a string by a cell that valid TOML reads, and the line rule ends that string. |
| `typographicQuotes` | Each typographic quote stands for the straight one and has its label, string. | Yes with a character class for these quotes. The tables have them in the class `other`, with every code point from U+0080 up, where the tokenizer as it is gives up on the rest of the line. Without the class, a parser can show a string that is the last thing on its line, and not a comment, a comma or a bracket after it. |
| `twoQuotesCloseMultiLine` | One of the three closing quotes is removed. Everything else is kept. | No: two quotes are content of such a string, so every parser that reads valid TOML as now is still inside the string, and stays there up to the next three quotes or the end of the text. The parser as it is reports its first error after the next three quotes at the earliest, so a sample has something to score only when the document has a second such string, or a second mistake. |
| `lineFeedInString` | Two of the three quotes are removed at each end. The lines of the text keep their label, string. | Yes with a grammar state of its own, when the text starts on the line after the opening quote, the closing quote has a line to itself, and the text holds no quote and no escape: a line end right after a quote is read by a cell that no valid text reads, and can open a state that shows every line as a string. No otherwise. The line rule alone ends the string at its first line end, and the lines of the text then read as entries. |
| `unescapedBackslash` | Each quote stands for an apostrophe and has its label, string. In the other form, one backslash of two is removed. A backslash, and what reads as an escape after it, e.g. the r of \r, keeps its label, and its display kind is not scored. | Yes: after a backslash, a character that starts no escape is read by a cell that no valid text reads, and that cell can go on with the string. |
| `missingHeaderBracket` | The bracket is removed. Everything else is kept. A header's brackets open nothing, so the depth is scored as before. | Yes: without the closing bracket, the end of the line is an error for the parser as it is, and can end the header. Without the opening bracket, the name reads as a key up to the closing bracket, where the first error is, so its display kind is not scored, and the bracket can be skipped. |
| `unbalancedDoubleBracket` | One bracket is removed, or added without a label. Of two equal brackets the later one is the removed or the added one. | Yes: after `[[name]`, the end of the line is an error for the parser as it is, and can end the header. After `[name]]`, the second closing bracket is an error, and can be skipped. |
| `missingArrayBracket` | The bracket is removed, with its line when it stands alone on one. The depth and the container are not scored from there to the next bracket. | Yes when an entry follows whose key starts with a letter other than t, f, i and n: such a word is no value, is an error inside an array, and can close the array and be the key. No when the key starts like a value, e.g. `name` like `nan`: it reads as the next value. Yes when a header follows a value: its bracket is an error there. No when a header follows a comma: its bracket is read as an array inside the open array, by a cell that valid TOML reads, and the label asks for depth 0. |
| `missingCloseBrace` | The brace is removed. The depth and the container are not scored from there to the next bracket. | Yes: a line end inside an inline table is an error for the parser as it is. The line end can be white space, and the key or the header of the next line, which stands where a comma is expected, can close the table. |
| `inlineTableOnSeveralLines` | Each line end stands for the space that the document has there, with its label: white space at depth 1 in an inline table. The indentation is added. | Yes: a line end inside an inline table is an error for the parser as it is, and can be white space, as in TOML 1.1. |
| `keyWithSpace` | The space is added and has no label, and the underscore is removed. Both words keep their label, key. | Yes: a word after a key, where an equals sign is expected, is an error for the parser as it is, and can go on with the key. No when the second word of a key starts with i or n: it reads as the start of `inf` or `nan`, by the cell that reads a digit after a key, and a digit there starts a value after missingEquals. |
| `valueLeftOut` | The value is removed. Everything else is kept. | Yes: the end of the line, a comment, a comma or a closing brace where a value or an equals sign is expected is an error for the parser as it is, and can end the entry. |
| `headerWithTrailingDot` | The dot is added and has no label. | Yes: a closing bracket or a second dot where a part of the name is expected is an error for the parser as it is, and can be read as if the dot before it were not there. The parser as it is counts the closing bracket as the end of an array, and is at depth -1 from there on. |
| `foreignLiteral` | The word is added in the place of the value and has no label: the highlighter has no display kind for a word that is not TOML's. | Yes: the word has no label, and it ends at the end of the line, at a comment, or at a comma or bracket. No for a word at the start of a line inside an array, as for unquotedString. |
| `numberWithUnit` | The unit is added and has no label. The digits keep their label, number. | Yes: the digits are read as a number, and the letter after them, which makes the word a key for the tokenizer, is an error where a value stands. No for a unit after a space inside an array: a word after a value there is the key of the next entry after missingArrayBracket. |
| `numberInAnotherForm` | A digit, the o, a decimal point or a comma is added or removed. The digits that are kept keep their label, number. | Yes: every code point that is kept is a digit or a decimal point, and where the number breaks TOML's form the parser as it is reports an error, in a cell that can go on with the number. |
| `dateInAnotherForm` | A slash is added where a hyphen is removed, or digits are removed. With slashes the date is a word with a slip, and the display kind of its digits is not scored. Otherwise the digits that are kept keep their label, number. | Yes, as for numberInAnotherForm. The slash is in the class `other`. |
| `templatePlaceholder` | The placeholder is added in the place of the value and has no label. | Yes: the placeholder has no label. Its braces come in pairs, so a parser that counts them is at depth 0 after it. The dollar sign, the percent sign and the angle brackets are in the class `other`, where the tokenizer as it is gives up on the rest of the line. |
| `jsonPastedIn` | The quotes around a key and the commas are added and have no label. The colon stands for the equals sign. The braces are added on lines of their own, so the labels keep the depth 0 between them. | Yes: a key between quotes is valid TOML, the colon and the comma are as in colonForEquals and commaAtLineEnd, and a brace at the start of a line outside of every bracket is an error for the parser as it is, and can be skipped. |
| `yamlBlock` | The header's brackets are removed, and the colon after the name is added. The name keeps its label, header name, and its display kind is not scored. The indentation is added, and each colon of an entry stands for the equals sign. | Yes, apart from the name: at its first letter nothing says that the line is a header, so every parser shows a key. After the colon, the end of the line is as in valueLeftOut. |
| `yamlListItems` | The brackets and the commas are removed, and the hyphens are added. The values keep their labels. The depth and the container are not scored from the removed bracket to the next bracket. | Yes for the display kinds, which is all that is scored up to the next bracket: the hyphen is a character of a key, and a quote or a digit after it starts a value as in missingEquals. |
| `semicolonComment` | The semicolon is added and the # is removed. The comment's text keeps its label, comment. A new comment is added as a whole. | Yes: the semicolon is in the class `other`, where the tokenizer as it is gives up on the rest of the line, and the display table can show that rest as a comment. The same tokenizer cell reads the first character of an unquoted value such as `>=3.9`, and the grammar's state tells the two apart: a value is expected there, and here the start or the end of a line. |
| `slashComment` | The two slashes are added and the # is removed. The comment's text keeps its label, comment. A new comment is added as a whole. | Yes, as for semicolonComment: the slash is in the class `other` too. |
| `cutInTheMiddle` | The span is removed. A mark in its place is added and has no label. | No for a span: what is left of the lines around the cut can read as anything, e.g. as a key inside an open string, and the labels are those of the document. Yes when whole lines are left out with a mark on a line of its own: the mark has no label and ends with its line. |
| `conflictMarkers` | The marker lines and the lines of the other side are added and have no label. The document is the text resolved with one side. | Yes: a marker line starts with `<`, `=` or `>`, which is an error at the start of a line, and ends with its line. The lines of the other side read as more entries: the tables keep no names, so a key that stands twice is no error for them. |
| `proseAround` | The sentences are added and have no label. Every code point of the document is kept. | Yes: the sentence's second word is an error for the parser as it is, and the rest of the line can be skipped, brackets included. With a quote that has no partner in the sentence, the tokenizer is inside a string, and the line rule ends it. |
| `codeFence` | The fence lines are added and have no label. Every code point of the document is kept. | Yes: the backtick is in the class `other`, where the tokenizer as it is gives up on the rest of the line, and the fence lines have no label. |
| `invisibleCharacter` | A no-break space stands for the space and has its label, white space. The byte order mark and the zero width space are added and have no label. | Yes with a character class for the character. The three are in the class `other`, where the tokenizer as it is gives up on the rest of the line, and that rest is a header, an entry or a value with labels of its own. |

## What stands in the way, across the kinds

Most kinds show at a cell that no valid text reads, so tables that read valid TOML as now are free there. What limits a parser of this form is the same few things in many kinds:

- **The class `other`.** The tables have one character class for `;`, `/`, `<`, `>`, `$`, `%`, the backtick and every code point from U+0080 up. Outside a string, the tokenizer as it is reads any of them as an error and gives up on the rest of the line (its state `errorLine`). That is right where the rest of the line has one display kind or no label: a comment after `;` or `//`, a marker line of a conflict, a fence line, a placeholder, an unquoted value such as `>=3.9`. It is wrong where the line goes on with other labels: after a typographic quote comes the string and then maybe a comment, after a byte order mark comes the first line of the file, after a no-break space comes the value. Those samples have `needsClass`.
- **A word inside an array.** A word that is no value is the key of the next entry after `missingArrayBracket`, an unquoted string after `unquotedString`, and a word without a label after `foreignLiteral`. The place tells them apart: the first is the first token on its line and the others mostly are not. A word at the start of a line inside an array of several lines is flagged `no`.
- **A word that starts like a value.** The tokenizer reads the first letter of `name` as the start of `nan`, and of `timeout` as the start of `true`. So after an array without its bracket, such a key reads as the next value, as after `missingCommaInArray`. And after a key and a space, a second word that starts with i or n is read by the cell that reads a digit, which starts the value after `missingEquals`.
- **A string at the end of its line.** The line rule ends an open string at its line end, which `missingClosingQuote` needs. A text of several lines between single quotes (`lineFeedInString`) needs the opposite, and is within reach only where the opening quote ends its line, which a string that lost its closing quote does not do unless it is empty. `missingClosingQuote` leaves empty strings out.
- **What a valid text reads.** After a comma inside an array, the bracket of a header is the start of an inner array. After two quotes inside a string of several lines, everything is content. No table that reads valid TOML as now can do otherwise: `missingArrayBracket` before a header after a comma, and `twoQuotesCloseMultiLine`.
- **What nothing in the text says.** After a span was cut out, the rest of its line has the labels of the document, e.g. a key, and reads as anything, e.g. as the inside of a string.

## Numbers

For the set, i.e. the samples 0 to 2,999 of seed 20261107, as `check.ts` prints them:

| | |
|---|---|
| Mistakes per sample | one 2,031, two 969 |
| Documents | 1,453 samples of a held-out template (`taskRunner` 807, `deployConfig` 646), 1,547 of the 14 others (76 to 172 each, and `lockfile` 9: few of its sequences of tokens are in the test split). 128 documents have lines that end with a carriage return and a line feed |
| `reachable` | yes 2,713, line rule 150, no 137 |
| `needsClass` | 114 samples: the typographic quotes 62, the byte order mark 23, U+00A0 as white space 17, U+200B as nothing 13 |
| Groups | within reach of the tables 2,600, needs a line rule 148, needs a character class 114, needs a nesting fix 1, out of reach 137 |
| Debatable | 99, all with a merge conflict |
| A scored depth out of the loop's reach | 9 |
| Scored code points per sample | mean 162.9, median 152, a tenth of the samples has 36 or fewer, a tenth 310 or more. 488,580 in all |
| From the first damaged code point to the first error | mean 2.1 code points |
| The parser as it is | 69.3% of the scored code points have every scored value right, and 9.5% of the samples have every one right |
| The parser as it is, per group | within reach 71.0% and 10.8%, line rule 80.0% and 0.0%, character class 50.0% and 0.0%, out of reach 41.9% and 2.2% |

The parser as it is starts high, as on the dataset: after its first error it goes on showing tokens by their kind and counting brackets. E.g. after an inline table on several lines it has every code point right in 38% of the samples.

Per kind. The first two columns count the set's samples with the kind, and those that have it alone. The others are for 60 samples of the kind alone, of seed 20261108: the flag `reachable`, the scored code points per sample, and the parser as it is.

| Kind | Samples of the set | Of them alone | Alone: yes, line rule, no | Scored code points, mean | Median | The parser as it is | Whole |
|---|---|---|---|---|---|---|---|
| `colonForEquals` | 164 | 81 | 60, 0, 0 | 167.0 | 143 | 52.6% | 0.0% |
| `doubledEquals` | 105 | 54 | 60, 0, 0 | 130.3 | 117 | 82.5% | 23.3% |
| `missingEquals` | 98 | 55 | 60, 0, 0 | 111.1 | 98 | 90.4% | 36.7% |
| `missingCommaInArray` | 119 | 62 | 60, 0, 0 | 126.2 | 109 | 86.1% | 23.3% |
| `commaAtLineEnd` | 91 | 46 | 60, 0, 0 | 149.0 | 129 | 85.7% | 11.7% |
| `trailingCommaInInlineTable` | 173 | 78 | 60, 0, 0 | 84.7 | 70 | 88.2% | 38.3% |
| `unquotedString` | 166 | 77 | 60, 0, 0 | 136.0 | 122 | 79.2% | 0.0% |
| `missingClosingQuote` | 175 | 79 | 0, 51, 9 | 141.1 | 128 | 78.8% | 0.0% |
| `missingOpeningQuote` | 61 | 35 | 57, 3, 0 | 144.3 | 143 | 79.4% | 0.0% |
| `typographicQuotes` | 103 | 56 | 60, 0, 0 | 181.4 | 178 | 37.6% | 0.0% |
| `twoQuotesCloseMultiLine` | 25 | 1 | 0, 0, 60 | 85.0 | 67 | 16.2% | 0.0% |
| `lineFeedInString` | 62 | 32 | 47, 0, 13 | 128.4 | 102 | 60.3% | 0.0% |
| `unescapedBackslash` | 50 | 36 | 60, 0, 0 | 78.7 | 57 | 46.8% | 0.0% |
| `missingHeaderBracket` | 104 | 56 | 60, 0, 0 | 172.0 | 152 | 68.1% | 18.3% |
| `unbalancedDoubleBracket` | 134 | 67 | 60, 0, 0 | 176.8 | 144 | 41.7% | 11.7% |
| `missingArrayBracket` | 174 | 92 | 58, 0, 2 | 143.6 | 121 | 10.0% | 6.7% |
| `missingCloseBrace` | 99 | 49 | 60, 0, 0 | 130.8 | 118 | 13.6% | 3.3% |
| `inlineTableOnSeveralLines` | 160 | 82 | 60, 0, 0 | 116.6 | 96 | 89.9% | 38.3% |
| `keyWithSpace` | 98 | 42 | 53, 0, 7 | 173.2 | 182 | 80.9% | 16.7% |
| `valueLeftOut` | 170 | 74 | 60, 0, 0 | 123.6 | 110 | 90.3% | 28.3% |
| `headerWithTrailingDot` | 56 | 25 | 60, 0, 0 | 154.7 | 134 | 0.9% | 0.0% |
| `foreignLiteral` | 148 | 87 | 60, 0, 0 | 128.6 | 115 | 89.6% | 30.0% |
| `numberWithUnit` | 114 | 63 | 59, 0, 1 | 95.1 | 68 | 88.1% | 20.0% |
| `numberInAnotherForm` | 107 | 54 | 60, 0, 0 | 102.5 | 75 | 76.3% | 0.0% |
| `dateInAnotherForm` | 55 | 29 | 60, 0, 0 | 129.7 | 108 | 89.7% | 6.7% |
| `templatePlaceholder` | 49 | 21 | 60, 0, 0 | 175.3 | 173 | 87.8% | 18.3% |
| `jsonPastedIn` | 186 | 90 | 60, 0, 0 | 147.7 | 130 | 56.1% | 0.0% |
| `yamlBlock` | 129 | 77 | 60, 0, 0 | 184.0 | 193 | 61.2% | 0.0% |
| `yamlListItems` | 130 | 61 | 60, 0, 0 | 122.9 | 100 | 87.3% | 0.0% |
| `semicolonComment` | 105 | 53 | 60, 0, 0 | 153.9 | 127 | 83.0% | 20.0% |
| `slashComment` | 117 | 64 | 60, 0, 0 | 164.8 | 150 | 81.2% | 16.7% |
| `cutInTheMiddle` | 66 | 66 | 24, 0, 36 | 112.9 | 101 | 82.5% | 15.0% |
| `conflictMarkers` | 121 | 61 | 60, 0, 0 | 128.9 | 128 | 92.4% | 21.7% |
| `proseAround` | 97 | 45 | 59, 1, 0 | 244.2 | 251 | 85.4% | 0.0% |
| `codeFence` | 105 | 47 | 60, 0, 0 | 279.4 | 293 | 89.6% | 1.7% |
| `invisibleCharacter` | 53 | 34 | 60, 0, 0 | 214.1 | 208 | 81.8% | 3.3% |

`twoQuotesCloseMultiLine` is alone in one sample of the set: alone, the parser as it is reports no error before the next three quotes, so most such texts have nothing to score. `unescapedBackslash` and `dateInAnotherForm` have no sample of a held-out template: those templates have no backslash and no date.

## The rows that a result is read against

One rule without any training gets most of what the parser as it is has wrong: after an error, the parser as it is starts anew at the next line, i.e. the tokenizer is between tokens, the grammar is at the start of a line and no container is open. `lab/recovery-toml/learn/restart-at-next-line.ts` holds the rule, and it reads no trained table and nothing of this folder. A review of the foundation found this on the train data's validation split and on both held-back sets, so **a trained parser is read by what it adds to the rule's columns, per kind and in whole samples**, and not by what it adds to the parser as it is.

For the set, as `score.ts --markdown` prints it. A row of a kind counts the set's samples with the kind, alone or with a second mistake, so its numbers differ from those of the table above, which is of samples with the kind alone.

| Row | Samples | Scored code points | The parser as it is: all three | Whole | Anew at the next line after an error: all three | Whole |
|---|---|---|---|---|---|---|
| all | 3000 | 488580 | 69.3 | 9.5 | 89.8 | 37.9 |
| documents of the two held-out templates | 1453 | 232642 | 69.6 | 10.4 | 89.8 | 38.3 |
| template: deployConfig | 646 | 104418 | 72.1 | 7.4 | 90.5 | 37.5 |
| template: taskRunner | 807 | 128224 | 67.5 | 12.8 | 89.2 | 39.0 |
| documents of the 14 templates that the train data has | 1547 | 255938 | 69.0 | 8.6 | 89.8 | 37.5 |
| one mistake | 2031 | 296279 | 71.3 | 12.7 | 90.6 | 45.2 |
| two mistakes | 969 | 192301 | 66.1 | 2.7 | 88.6 | 22.6 |
| group: out of reach | 137 | 19373 | 41.9 | 2.2 | 82.7 | 2.9 |
| group: needs a nesting fix | 1 | 82 | 0.0 | 0.0 | 89.0 | 0.0 |
| group: needs a character class | 114 | 23654 | 50.0 | 0.0 | 75.5 | 5.3 |
| group: needs a line rule | 148 | 26864 | 80.0 | 0.0 | 93.9 | 0.7 |
| group: within reach of the tables | 2600 | 418607 | 71.0 | 10.8 | 90.7 | 43.3 |
| `colonForEquals` | 164 | 33064 | 52.7 | 0.0 | 70.6 | 0.0 |
| `doubledEquals` | 105 | 17616 | 78.9 | 15.2 | 94.1 | 54.3 |
| `missingEquals` | 98 | 15701 | 86.7 | 20.4 | 97.6 | 77.6 |
| `missingCommaInArray` | 119 | 18794 | 80.5 | 15.1 | 92.9 | 49.6 |
| `commaAtLineEnd` | 91 | 14229 | 85.1 | 20.9 | 96.2 | 64.8 |
| `trailingCommaInInlineTable` | 173 | 26394 | 80.4 | 17.3 | 94.0 | 65.3 |
| `unquotedString` | 166 | 29436 | 75.1 | 1.2 | 89.2 | 2.4 |
| `missingClosingQuote` | 175 | 32024 | 68.9 | 0.0 | 94.0 | 0.0 |
| `missingOpeningQuote` | 61 | 10491 | 79.9 | 0.0 | 92.6 | 0.0 |
| `typographicQuotes` | 103 | 20041 | 42.0 | 0.0 | 72.4 | 0.0 |
| `twoQuotesCloseMultiLine` | 25 | 4688 | 50.9 | 0.0 | 71.4 | 0.0 |
| `lineFeedInString` | 62 | 9687 | 60.3 | 0.0 | 69.4 | 0.0 |
| `unescapedBackslash` | 50 | 5670 | 63.9 | 0.0 | 71.5 | 2.0 |
| `missingHeaderBracket` | 104 | 20689 | 49.2 | 7.7 | 94.7 | 49.0 |
| `unbalancedDoubleBracket` | 134 | 23109 | 45.5 | 9.0 | 95.7 | 39.6 |
| `missingArrayBracket` | 174 | 26877 | 29.4 | 6.9 | 86.7 | 26.4 |
| `missingCloseBrace` | 99 | 16654 | 22.7 | 3.0 | 95.8 | 69.7 |
| `inlineTableOnSeveralLines` | 160 | 25515 | 82.4 | 21.9 | 73.3 | 0.0 |
| `keyWithSpace` | 98 | 18078 | 77.5 | 7.1 | 93.8 | 54.1 |
| `valueLeftOut` | 170 | 29629 | 82.4 | 10.6 | 96.5 | 68.8 |
| `headerWithTrailingDot` | 56 | 9867 | 27.1 | 0.0 | 93.7 | 0.0 |
| `foreignLiteral` | 148 | 22596 | 80.9 | 23.6 | 97.0 | 73.0 |
| `numberWithUnit` | 114 | 17223 | 74.0 | 14.0 | 96.6 | 75.4 |
| `numberInAnotherForm` | 107 | 16316 | 73.7 | 0.9 | 96.5 | 6.5 |
| `dateInAnotherForm` | 55 | 6479 | 83.8 | 3.6 | 92.7 | 25.5 |
| `templatePlaceholder` | 49 | 8245 | 79.4 | 10.2 | 94.4 | 59.2 |
| `jsonPastedIn` | 186 | 31462 | 57.2 | 0.0 | 79.2 | 0.0 |
| `yamlBlock` | 129 | 26579 | 63.1 | 0.0 | 75.1 | 0.0 |
| `yamlListItems` | 130 | 18911 | 82.5 | 0.0 | 95.8 | 0.0 |
| `semicolonComment` | 105 | 18984 | 76.2 | 10.5 | 90.8 | 40.0 |
| `slashComment` | 117 | 21334 | 79.7 | 8.5 | 92.8 | 45.3 |
| `cutInTheMiddle` | 66 | 7107 | 63.3 | 10.6 | 92.2 | 37.9 |
| `conflictMarkers` | 121 | 15708 | 83.1 | 18.2 | 96.0 | 71.9 |
| `proseAround` | 97 | 22833 | 82.3 | 1.0 | 95.8 | 67.0 |
| `codeFence` | 105 | 28154 | 82.7 | 0.0 | 97.9 | 72.4 |
| `invisibleCharacter` | 53 | 10697 | 79.3 | 0.0 | 88.1 | 11.3 |

What the rows say:

- **The rule does not solve every kind.** With it, 11 kinds still have no whole sample: `colonForEquals`, `missingClosingQuote`, `missingOpeningQuote`, `typographicQuotes`, `twoQuotesCloseMultiLine`, `lineFeedInString`, `inlineTableOnSeveralLines`, `headerWithTrailingDot`, `jsonPastedIn`, `yamlBlock` and `yamlListItems`. The rule changes nothing on the line of an error, so a kind that leaves scored code points on that line stays without a whole sample, e.g. the value after a colon, and so does a kind that spans many lines.
- **One kind gets worse:** `inlineTableOnSeveralLines` falls from 82.4% to 73.3% and from 21.9% of whole samples to none, since the rule cuts a value on several lines at the line of its error.
- **A parser can only lose in whole samples where the parser as it is already has many.** In 9 kinds the parser as it is has 14% to 24% of the samples whole, e.g. `foreignLiteral` 23.6%.
- **The documents of the two held-out templates** are not harder than the others for either parser: 69.6% against 69.0% as it is, 89.8% against 89.8% with the rule.

## How to score tables on the set

`bun lab/recovery-toml/held-back/specific/score.ts --tables <file.json>` prints the rows above with two more columns, for the tables of a file that `learn/` saved, e.g. `--tables $RECOVERY_SCRATCH/recipe/seed-1.primary.tables.json`. Tables in which a cell differs from today's are a final number, so the command then asks for the environment variable `RECOVERY_FINAL=yes`, and it refuses a file that was saved with another dataset. `scoreWith(parser, samples)` of `score.ts` gives the rows for a parser of `../parsers.ts`.

`labeledTexts()` of `samples.ts` gives the set in the shape that `samplesOf` of `../../learn/data.ts` takes, so the code that scores tables on the dataset scores them on the set too, with every column of its rows, e.g. the display kind, the depth and the container apart:

```ts
import {samplesOf} from '../../learn/data.ts'
import {scoreTables} from '../../learn/score.ts'
import {labeledTexts} from './samples.ts'
const score = scoreTables(tables, samplesOf(labeledTexts()), {splits: ['test']})
```

Every text is in the test split, so `scoreTables` asks for the environment variable `RECOVERY_FINAL`: the scoring of this set is a part of the final scoring. The rows of the score are the kinds, e.g. `kind: colonForEquals`, and the groups, e.g. `group: out of reach`. A sample with two kinds is in the row of each.

A reader that is no setting of the tables takes `sample.broken`, `sample.firstErrorPosition` and `labelsOf(sample)`, which has one label per code point of the broken text, or `undefined` for an added one.

## Run it

From the repo root:

```sh
bun lab/recovery-toml/held-back/specific/check.ts [samples] [samples per kind] [seed] [--markdown]   # every check and the numbers, about 15 seconds
bun lab/recovery-toml/held-back/specific/score.ts [--tables <file.json>] [--markdown]                # the parser as it is, the rule and tables, per kind, group and template
bun lab/recovery-toml/held-back/specific/dump.ts <folder outside the repo> [seed]                    # samples.txt and per-kind.txt for reading
bun lab/recovery-toml/held-back/specific/table.ts                                                    # the two tables of the kinds for this page
```

`check.ts` ends with "every check passed". Its top lists what it checks: the examples of this page, a second derivation of every label from the tables, that every broken text is invalid and every document is in the test split and in no train or validation sample of the dataset, that the machinery's loader takes the set, that `score.ts` counts for the parser as it is what the check counts, and that no file outside `held-back/` imports from it.

The dump of the set is in `recovery-scratch/transfer/toml/held-back/held-back-specific/`: `samples.txt` has the first 300 samples, and `per-kind.txt` 5 samples of each kind alone. Per sample they show the kinds and their forms, the document and the broken text on one line each, and under the broken text the alignment, the label's display kind, depth and container, and a mark under the first error.

## The files

- `samples.ts`: `sampleAt`, `labelsOf`, `scoredCodePoints`, `groupOf`, `labeledTexts`, the type `Sample`, and the rules for what is not scored.
- `mistakes.ts`: the list of the kinds, and how one or two of them are drawn and merged.
- `mistakes/`: the kinds, one file per family, and `types.ts` with what a kind is.
- `scan.ts`: the parts of a valid document with their positions, e.g. its entries, strings, arrays and comments, which the kinds pick their places from. It reads the labels of the reference and no grammar of its own.
- `score.ts`: the rows of a parser on the set, per kind, per group and for the held-out templates apart.
- `check.ts`, `dump.ts`, `table.ts`: see "Run it".

## Known limits

- **The flags are judgments.** Nothing proves that a sample with `yes` is within reach of tables that the recipe can find, e.g. `lineFeedInString` is `yes` with a grammar state of its own, which the recipe may not have. And the flag of a sample with two mistakes is the lesser of the two, with no look at how the two meet.
- **The documents are those of the dataset's generator.** Their names, values and comments come from its lists, so a mistake sits in text of the sort that training saw, in a document that it did not see.
- **The kinds and their weights are one list** of what goes wrong in TOML, from the brief of this track and from what the author of this folder knows of broken config files, with no survey behind it. The weights are 1 to 3 and no measured frequencies. The numbers per kind matter more than the number over the set.
- **A kind is one mistake, written one way per form.** E.g. a unit is one of 14, and a sentence before the document comes from a short list. The written set of `../written/` has the variety that a generator lacks.
- **A sample has at least one code point to score,** so a mistake on the last line of a document is rare, and a text that is only cut off is no sample.
- **Lines that end with a carriage return and a line feed** are in one document in 25, as in the dataset. A kind that adds a line adds such a line end.
