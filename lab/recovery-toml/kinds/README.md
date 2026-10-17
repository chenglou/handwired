# Kinds of mistakes for TOML, for the training side

The dataset of the folder above damages a valid TOML document with ten edits that know nothing of TOML, e.g. "delete a run of code points". On JSON, the recipe trained on such damage alone reached 82.8% of the scored code points and 61.8% of whole samples on validation, where it reached 98.0% and 80.5% with damage that was written for JSON. Most of the loss sat in texts that another notation leaves behind, e.g. keys without quotes, which no blind edit makes.

This folder is the counterpart for TOML: 49 kinds of mistakes that people and tools make when they write TOML, each with an exact alignment, and the mixed set that the rows 7 and 8 of the experiment train on. Half of the mixed set is the dataset's samples and half is samples of these kinds.

The kinds were written before any training and without any sight of the held-back test. They come from TOML's rules and where they surprise, and from what YAML, JSON, INI files, shells, editors, templates, merges and language models leave in a file. Nothing here imports from `held-back/`.

## A sample

`kindsSampleAt(seed, index)` in `samples.ts` makes one sample, in about 0.5 ms. It takes the document of the dataset's sample with the same seed and index, i.e. of `sampleAt(seed, index)` of `../samples.ts`, and puts one or two kinds of mistakes into it in the place of the dataset's edits. So a sample is in the split of the dataset's sample with its index, the two sets are made of the same documents, and an index of the test split has no sample here: `kindsSampleAt` throws for it. A held-out template only has documents in the test split, so none of its documents is ever used.

A sample has the type `Sample` of the dataset, so `labelsOf`, `scoredCodePoints` and `describeSample` of the folder above read it. What differs:

- `id` ends with `:kinds`, e.g. `20261016:7:kinds`.
- `recipe` is `one kind` or `two kinds`, `editCount` is the number of kinds, `kinds` names them, e.g. `['colonForEquals', 'codeFence']`, and `forms` says which variant each one is, e.g. `colonForEquals: every entry below one header`.
- `replaced` can be true, see the third rule below.

The labels follow the dataset's rule, with the one addition that the JSON dataset has:

- A kept code point has the label of its counterpart in the document: display kind, depth and container.
- A code point that the mistake added has no label, e.g. the fence line of a code block or a second comma. A word of another notation has no label as a whole, e.g. `True` where the document has `true`, as in the JSON dataset: the highlighter has no display kind for it. White space that a kind writes is added too, also where the document had white space at that place, e.g. the line end and the indentation after the `{` of an inline table that is put on several lines.
- A code point that stands in the place of one code point of the document has that one's label, and `replaced` marks it. E.g. the colon of `port: 80` has the label of the equals sign, the `“` of `“web”` the label of the quote, the `(` of `(80, 443)` the label of the `[`, and the first `/` of `// default` the label of the `#`. The dataset's own edits never do this.

The edits are in the canonical form of `../edits.ts`. What is scored is what the dataset scores, by its two rules: before the first error of the parser as it is, a value that this parser does not give is left out, and so are the depth and the container from a removed bracket to the next kept bracket. `samples.ts` has a copy of the dataset's `unscoredOf`, which is not exported, and `check.ts` holds the copy against the dataset's samples.

No kind declares more values as not scored, where the JSON kinds do. So some scored labels are out of every parser's reach, as in the dataset, e.g. the comma inside a string that lost its closing quote in the middle of a line. The last column of the table below says for which kinds.

## How the kinds are drawn

A draw takes one kind by the weights of the table below, and with a probability of 0.45 a second one. Each kind is applied to the document alone, and the edits of the two are merged. A draw is thrown away, and the kinds are drawn again on the same document, when:

- the document has no place for a kind, e.g. a date in another form on a document without a date,
- two kinds touch: their edits overlap, or nothing but white space stands between them, or they are on one line and fewer than 8 code points apart. It is the rule of `lab/recovery-parser/damage.ts` for two kinds that have nothing to do with each other. A kind that changes the whole text, e.g. a code fence, only has to leave the other kind's code points alone,
- or for one of the dataset's reasons: the result is still valid for the tables, is longer than 512 code points, is counted deeper than 16 by the parser as it is, or leaves no code point to score.

Four kinds never share a sample: `linePrefix`, `embeddedInCode`, `terminalCodes` and `carriageReturnLineEnds` change every line, and the lines that a second kind adds would not fit them. Two kinds of the family "around the document" share a sample only as a sentence and a code fence, which is how an answer of a language model starts.

So the share of a kind is its weight times the share of documents that have a place for it. E.g. 30% of the documents have an inline table that can stand on several lines, and 6% have a backslash that can lose its escape: `stats.ts --places` prints the share per kind. The weights are my estimates of how often a mistake is made where it can be made. Nobody measured them.

## The mixed set

`mixed.ts` makes it from the dataset's standard set, i.e. the samples 0 to 59,999 of the seed 20261016 that are not in the test split. The indexes of a split are taken in their order: the first, the third, the fifth and so on keep the dataset's sample, and the second, the fourth and so on get the sample of this folder with the same index. So every document of the standard set is in the mixed set once.

| | train | validation |
| --- | --- | --- |
| Samples, as in the dataset's standard set | 42,082 | 5,382 |
| of the dataset, `half: 'neutral'` | 21,041 | 2,691 |
| of this folder, `half: 'kinds'` | 21,041 | 2,691 |

- `mixedTrainSamples()` and `mixedValidationSamples()` return the samples of a split as `{half, index, sample}`: the mark of the half, the index in the dataset, and the sample.
- `mixedSet()` returns both splits as the arrays of `../learn/data.ts`, e.g. for `runRecipe(mixedSet(), seed)`. It takes 13 seconds and keeps no cache file. In the arrays a sample of the dataset has the source `damage` and its group by the number of edits, e.g. `two edits`, and a sample of this folder has the source `kinds` and the group `one kind` or `two kinds`. So a score has the rows `source: damage` and `source: kinds`, and a row per kind, e.g. `kind: colonForEquals`.
- `kindsHalf()` returns the samples of this folder alone, of both splits, as such arrays.
- Each of them takes a range `{seed, from, to}` in the place of the standard set's, e.g. to try a command on the first 2,000 indexes.
- `kindsKey()` is a hash of this folder's `.ts` files, for the record of tables that were trained on the mixed set: the dataset's key says nothing about the kinds. As with the dataset's key, a change of any file gives another key, the checks among them.

## The kinds

In the examples, ⏎ stands for a line feed, ↵ for a carriage return, ⍽ for a no-break space (U+00A0), ◊ for a byte order mark (U+FEFF) and ␛ for the escape character. "Samples" is the number of samples of this folder's half of the mixed set that have the kind, of 23,732. A sample with two kinds counts for both.

| Kind | What it is | Example | Variants | Weight | Samples | Can a parser of the tables' form show every code point after it right? |
| --- | --- | --- | --- | --- | --- | --- |
| **assignment and separators** | | | | | | |
| colonForEquals | A colon in the place of an equals sign, as YAML and JSON write an entry | `[server]⏎host: "127.0.0.1"⏎port = 8443` | one entry; every entry below one header; every entry of the document, with or without those of inline tables; every entry of one inline table; an inline table as a JSON object, with quotes around its keys | 5 | 1958 | yes: after a key, a colon is read as the equals sign |
| otherAssignment | Another language's sign in the place of the equals sign: := =&gt; == -&gt; += &lt;- ?= | `name := "tiny"⏎port => 8443` | one entry; every entry below one header | 1 | 382 | yes: the sign's characters after a key are skipped up to the value |
| missingEquals | A key and its value with only a space between them, as the configs of nginx and ssh have it | `workers 32⏎host "127.0.0.1"` | one entry; every entry below one header | 1.5 | 630 | yes: a value after a key and a space is that key's value |
| lineEndSeparator | A comma, a semicolon or a backslash after an entry at the end of its line, as JSON, JavaScript and a shell end a line | `name = "tiny",⏎port = 8443;` | one entry; every entry below one header, or with a comma every one but the last; every entry of the document | 3 | 1112 | yes: a comma, a semicolon or a backslash after a complete value at depth 0 is skipped |
| entriesOnOneLine | Two or more entries on one line, with a comma, a semicolon, a space or nothing between them, or a header with its first entry | `name = "tiny", port = 8443⏎[tls] enabled = true` | two entries; a run of 3 to 5 entries; a header and its first entry | 1.5 | 532 | yes: after a complete value at depth 0, a comma or a semicolon is skipped and a word is the next key, and so is a word after a header |
| inlineTableOnLines | An inline table on several lines, as JSON writes an object. TOML 1.0 wants it on one line | `serde = {⏎  version = "1",⏎  features = ["derive"]⏎}` | one inline table; every inline table; with or without a comma after the last entry; indented by 2 spaces, 4 spaces or a tab | 10 | 956 | yes: a line end inside an inline table is white space |
| inlineTableAsBlock | An inline table written as a block of another notation, with an entry per line: as HCL and nginx write a block, or as JavaScript writes an object | `server {⏎  host = "127.0.0.1"⏎  port = 8443⏎}` | `name {` without an equals sign and without commas; `name = {` without commas; `name: {` with colons and commas | 2.5 | 195 | yes: a brace after a key opens an inline table, a line end inside an inline table is white space, and a word after a complete value is the next key |
| trailingCommaInInlineTable | A comma after the last entry of an inline table, which an array allows and an inline table of TOML 1.0 does not | `point = { x = 1, y = 2, }` | one inline table; every inline table | 5 | 597 | yes: a closing brace after a comma closes the inline table |
| missingComma | A comma that is missing between two values of an array or two entries of an inline table, or a semicolon in its place | `ports = [80 443]⏎point = { x = 1 y = 2 }⏎sizes = [1; 2; 3]` | at a line end of an array on several lines; inside a line of an array; in an inline table; every comma of one container; a semicolon in the place of every comma of one container | 3 | 695 | yes: after a complete value inside an array, the start of a value is the next value, and inside an inline table a word is the next key. A semicolon there is read as the comma |
| extraComma | A comma too many: two in a row, one on a line of its own, or one before the first value | `ports = [80,, 443]⏎tags = [, "a"]` | a second comma inside a line; a comma on a line of its own in an array on several lines; a comma before the first value of an array or an inline table | 1 | 299 | yes: a comma where a value or a key should start changes nothing |
| arrayWithoutBrackets | A list of values without brackets, as INI files and CSV write a list, or with a dash before each value, as YAML does | `tags = "web", "prod"⏎members =⏎  - "core"⏎  - "cli"` | an array on one line without its brackets; without its brackets and its commas; an array on several lines without its brackets and commas and with `- ` before every value | 1.5 | 322 | yes for the display kinds: a comma and a value after a complete value at depth 0 go on with the list, and a dash at the start of a line after an equals sign starts a value. The depth and the container of the list are not scored, since no bracket shows them |
| **values** | | | | | | |
| unquotedString | A string without its quotes, as INI files, YAML and .env files write a value | `name = tiny-router⏎version = 6.9.17` | the value of one entry; every string value below one header; one value or every value of an array; a value inside an inline table; every string of the document | 6 | 2166 | partly: a word where a value should stand runs to the end of its line at depth 0, and to a comma or a closing bracket inside a container, and is shown as a string. Its first characters are shown as a number or a literal where they read as one, e.g. the 6.9 of 6.9.17 and the t of tiny, by cells that valid TOML reads. A # in it starts a comment for every parser |
| foreignLiteral | True, yes, on, null, None, nil, NaN and the like in the place of a value. TOML has true and false in lower case and no word for no value | `debug = True⏎timeout = null` | one true or false; every true and false of the document, in one notation; null, None, nil, undefined, NULL or \~ in the place of any value; NaN or Infinity in the place of a number | 4 | 1560 | yes: the word has no label, and what follows it is read as it is |
| halfTypedValue | A number, a date or a literal that is not typed to its end | `enabled = tru⏎since = 2024-01-` | one value at the end of its line, cut where its start is no value | 1.5 | 326 | yes: the typed characters are shown as the value's kind, and the next line starts anew |
| numberFormat | A number as another language or a person writes it: with a unit, a leading zero, a comma in it, a suffix of a type | `timeout = 30s⏎mode = 0644⏎limit = 1,000` | a unit after the number, e.g. s, ms, MB, %; a zero before it; a dot after it; an underscore after it, or two in a row; no zero before the dot; a comma, a space or an apostrophe between the thousands; a comma for the decimal point; a suffix of a type, e.g. u32 or f; 0X for 0x; 0640 for 0o640 | 2.5 | 658 | yes: digits, letters and the signs of a number up to the next white space are one number. With a space or a comma inside the number, what stands after it is shown as a number only by a rule that reads digits after a complete value as more of that value |
| dateFormat | A date or a time in a form that TOML 1.0 does not read | `date = 2024/01/31⏎at = 07:32` | slashes or dots in the date; a month or a day without its zero; a time without seconds; an offset without its colon; the name of a time zone after the time | 3 | 291 | yes: digits and the signs of a date up to the next white space are one number. The name of a time zone after a space has no label |
| placeholderValue | The placeholder of a template or of a sample config in the place of a value | `token = <your-token>⏎name = {{ project_name }}⏎home = ${HOME}` | one value; 2 or 3 values below one header; the forms {{ name }}, \${NAME}, \$NAME, &lt;name&gt;, %NAME%, @NAME@, TODO, ???, CHANGEME, xxx | 1.5 | 529 | yes: the placeholder has no label, and its braces open and close in pairs |
| foreignQuotes | Typographic quotes or backticks around a string, as a word processor, a chat program or JavaScript writes them, or a letter before the opening quote, as Python and Rust mark a raw string | `` title = “Tide Docs”⏎run = `cargo test`⏎pattern = r"\d+" `` | one string; every string of the document; the pairs “ ”, „ “, « », ” ”, ‘ ’ and backticks; r, f, b, u, @ or L before the opening quote | 2 | 748 | yes for a parser with a character class for the quote: the string runs to the closing one. A letter before a quote has no label and the string after it is read as it is |
| otherBrackets | Parentheses or braces around the values of an array, as Python writes a tuple and C or Go an array | `ports = (80, 443)⏎tags = {"web", "prod"}` | one array, with ( ) or with { } | 0.8 | 185 | yes with ( ) for a parser with character classes for them. no with { }: the brace opens an inline table by a cell that valid TOML reads, so the container is shown as an inline table |
| **strings** | | | | | | |
| missingClosingQuote | A string without its closing quote, half typed or cut by a paste | `name = "tiny-router⏎version = "6.9.17"` | a string at the end of its line; a string that stops inside its content; a string before a comment; a string inside an array or an inline table | 4 | 1528 | yes at the end of a line: a string of one line holds no line end, so it ends there. no before a comment or inside a line: the string runs on to the next quote, which opens the next string in the document, and to the line's end, with the labels of the comment, the comma and the brackets inside it |
| missingOpeningQuote | A string without its opening quote | `name = tiny-router"` | the value of an entry; a string inside an array or an inline table | 1 | 371 | partly: the content is read as a string without quotes, see unquotedString. The closing quote opens a string for every parser, which ends at the line's end when nothing follows on the line. no when a comment or more values follow |
| doubledQuote | A quote typed twice, as an editor that pairs quotes leaves it | `name = "tiny-router""` | after the closing quote; before the opening quote | 1 | 370 | after the closing quote: yes when nothing follows on the line, where the quote opens a string that the line's end closes. Before the opening quote: the two quotes read as an empty string, and the content after them is shown as a string only by a rule that reads a word right after a value as more of that value, which is the opposite of what entriesOnOneLine needs |
| unescapedQuote | A quote inside a string without its backslash, or a string between the kind of quote that it holds | `quote = "She said "hello" and left."` | every \\" of one string without its backslash; a string between apostrophes that holds quotes, written between quotes; a string between quotes that holds an apostrophe, written between apostrophes | 3 | 96 | no: the inner quote ends the string, and nothing at that point says that it should not |
| unescapedBackslash | A backslash that is content, e.g. of a Windows path or a regular expression, in a string between quotes | `path = "C:\Users\ada"⏎pattern = "^\d+\.\d+$"` | one backslash where the document has two; quotes around a string that stood between apostrophes | 10 | 197 | yes: after a backslash and a character that TOML does not escape, the string goes on. Where the character after the backslash is one that TOML escapes, e.g. the t of C:\\temp, every parser shows an escape |
| unknownEscape | An escape of another language in a string between quotes: \\/ as JSON allows, \\' \\. \\\$ and the like, \\xe9, \\u{2190} | `url = "https:\/\/example.org\/docs"` | a backslash before every slash of a string; before an apostrophe; before one sign or every such sign of a string; \\x and two hex digits for a character; braces around the digits of a \\u escape | 1.5 | 458 | yes: after a backslash and a character that TOML does not escape, the string goes on |
| rawLineFeedInString | A string of one line that goes on in the next line: wrapped by an editor, or meant as a string of several lines, which TOML writes between three quotes | `description = "Something quiet over⏎something to."` | a line end in the place of a space of the string, with the next line indented or not; a string between three quotes with one quote at each end, or at its start alone | 0.8 | 121 | yes with the rule that a line end inside a string is content, which is the opposite of the rule that missingClosingQuote needs. With one quote at the start and three at the end, the string ends at the first of the three and the other two read as an empty string |
| stringInTwoParts | A long string written as two strings, joined with a + or just put next to each other, as JavaScript, Python and C write it | `description = "Something quiet over " +⏎  "something to."` | a + between the two strings, on one line or with the second string in the next line; no sign between them, with the second string in the next line or after a space | 0.8 | 134 | yes: after a complete value at depth 0, a + is skipped and a string is more of the value, also in the next line after a +. Without a +, the second string in the next line stands where a key in quotes stands and is shown as a key |
| **keys and headers** | | | | | | |
| bareKeyCharacter | A key without quotes that holds a character that TOML wants quotes for: a space, a sign of another notation, a letter with an accent, an index in brackets | `request timeout = 30⏎$schema = "v2"⏎deps[serde] = "1"` | a space in the place of \_ or -; a key without its quotes; a sign before the key, e.g. \$ or @; a sign after it, e.g. [] or ?; / : :: or -&gt; in the place of the dots; index brackets in the place of a dot, with or without quotes; a dot before or after the key, or two dots in a row; a letter with an accent | 2.5 | 1019 | partly: the characters of the key up to the mistake are shown as a key by cells that valid TOML reads, and a word or a sign between a key and its equals sign can be shown as more of the key. A sign before the first character has no label. The bracket in the place of a dot opens nothing after a key |
| headerBracket | A header with a bracket too few or too many | `[server⏎host = "a"⏎[[upstream]⏎name = "b"` | no closing bracket; no opening bracket; a second closing or opening bracket; one bracket where [[ or ]] is needed; a space between the two brackets of [[ or ]]; [[name without closing brackets | 3 | 1111 | yes when a closing bracket is missing or extra: the header ends at its line's end. Without the opening bracket the name stands where a key stands and is shown as a key by cells that valid TOML reads |
| headerForm | A header as another notation writes it: another sign between the parts of its name, a sign after it, other brackets, or the name and a colon | `[server:tls]⏎[remote "origin"]⏎server:` | : / :: -&gt; ][ or a space in the place of the dots, in one header or in every header; a space and quotes in the place of a dot, as git config has it; a dot before or after the name; : ; , or { after the header; &lt; &gt; { } or ( ) in the place of the brackets; the name and a colon without brackets, as YAML starts a part, with the entries indented or as they were | 2 | 744 | yes for a sign inside or after the header. With other brackets the name is read from an error on and can be shown as a header's name. Without brackets the name stands where a key stands and is shown as a key by cells that valid TOML reads |
| keyAlone | A key alone on its line: an entry that is being typed, or a flag as INI files have it | `[server]⏎host = "a"⏎por` | the whole key; a key that stops before its end. In half of the draws it is the last entry below its header | 2 | 794 | yes: a line end after a key starts the next line anew |
| equalsWithoutValue | A key and an equals sign without a value: half typed, or left empty as a sample config does | `host =⏎port = 8443` | one entry, with or without the space after the equals sign; 2 or 3 entries below one header; an entry of an inline table | 3 | 1158 | yes: a line end where a value should stand starts the next line anew, and inside an inline table a comma there goes on with the next entry |
| valueOnNextLine | A value that starts on the line after its equals sign | `description =⏎  "Something quiet over something"` | the value indented by 2 or 4 spaces, or not at all | 0.7 | 293 | yes with the rule that a line end after an equals sign is white space, which is the opposite of the rule that equalsWithoutValue needs |
| **brackets** | | | | | | |
| missingCloser | An array without its ] or an inline table without its } | `ports = [80, 443⏎name = "a"` | an array on one line; an array on several lines, where the line of the ] goes when the ] is alone on it; an inline table | 3 | 805 | yes for the display kinds, with the rule that a key and an equals sign, or a header, end an open array or inline table. The depth and the container are not scored from the lost bracket to the next kept bracket, and from that bracket on they are right only when the rule closed the container |
| strayCloser | A closing bracket too many, as an editor that pairs brackets leaves it, or as the rest of a removed array | `ports = [80, 443]]⏎]` | a second closing bracket after a container; a ] or a } on a line of its own after an entry; a ] or a } after a value that is no container | 1.5 | 576 | yes at depth 0: a closing bracket where nothing is open closes nothing. Inside an array, a second ] closes that array, by a cell that valid TOML reads |
| wrongCloser | A closing bracket of the other kind, or a parenthesis, in the place of a ] or a } | `ports = [80, 443}⏎point = { x = 1, y = 2 ]` | } or ) for the ] of an array; ] or ) for the } of an inline table | 1 | 292 | yes: a closing bracket of the other kind closes the innermost container. A parenthesis needs a character class |
| **comments** | | | | | | |
| foreignComment | A comment as another notation writes it: // ; -- /\* \*/ &lt;!-- --&gt; | `port = 8443 // default⏎; optional⏎workers = 32` | one comment of the document; every comment of the document; a new comment after an entry or on a line of its own | 3.5 | 1367 | yes on a line of its own and after a value: the sign starts nothing else there, and the comment ends at the line's end. With -- on a line of its own, the two characters read as a key by cells that valid TOML reads, and are shown so |
| commentWithoutHash | The text of a comment without its #: a note typed as it is, a comment that an editor switched on by mistake, or a long comment wrapped onto a second line | `port = 8443 default⏎keep in sync with CI` | a comment on a line of its own; a comment after a value; a line end in the place of a space of a comment | 1 | 241 | partly: after a complete value, text up to the line's end can be shown as a comment. On a line of its own the first word stands where a key stands and is shown as a key by cells that valid TOML reads, and the rest can be shown as a comment |
| **around the document** | | | | | | |
| codeFence | The fence of a Markdown code block around the document, as in an answer of a language model or a paste from a README | `` ```toml⏎[server]⏎port = 8443⏎``` `` | a fence before and after; an opening fence alone; three backticks or three tildes; with toml, another word or nothing after the opening fence | 3 | 1182 | yes: a fence line starts with a character that starts nothing, and is skipped up to its line end |
| proseAround | A sentence or a file name before the document, and sometimes a sentence after it | `Here is the updated file:⏎⏎[server]⏎port = 8443` | a sentence before; a sentence before and one after; with or without an empty line between | 1.5 | 616 | yes: the sentence has no label and ends at its line end. A sentence with an apostrophe opens a string that its line end closes |
| frontMatter | The fences of front matter around the document, as a page of Hugo or Zola has them, with or without the page's text after it | `+++⏎title = "About"⏎draft = false⏎+++⏎⏎# About` | +++ or --- before and after; with a heading and a sentence after the second fence or without | 1 | 385 | yes: a fence line is skipped up to its line end, and the text after the document has no label |
| embeddedInCode | The document inside a string of a program, with the program's lines around it | `cat > config.toml <<EOF⏎[server]⏎port = 8443⏎EOF` | a heredoc of a shell; a template string of JavaScript; a raw string of Rust; a block of YAML, with every line indented; the tags &lt;pre&gt; or &lt;pre&gt;&lt;code&gt; of HTML | 1 | 320 | yes: the program's lines have no label and end at their line ends. A quote in them opens a string that the line end closes |
| conflictMarkers | The marker lines of a merge conflict around 1 to 3 entries, with the other side's version of those lines | `<<<<<<< HEAD⏎port = 8443⏎=======⏎port = 8444⏎>>>>>>> main` | the document's lines first or the other side's lines first; with the lines of the common ancestor, as the style diff3 has them, or without | 1.5 | 428 | yes: a marker line starts with a character that starts nothing and is skipped up to its line end, and the other side's lines have no label |
| linePrefix | A mark or a number before every line: a document pasted from a diff, from a listing with line numbers, or from a quoted mail | `1  [server]⏎2  port = 8443` | a + before every line; a space before every line, a + before 1 to 3 lines, a line with - before them, with or without the line that starts a hunk; the number of every line in 7 forms; &gt; or \| before every line | 1.5 | 524 | yes for a mark that starts nothing: it is skipped, and the line is read from there. A number stands where a key stands, so after it the line's own key or header has to be read after a key |
| invisibleCharacter | A character that does not show: a byte order mark, a no-break space in the place of a space, a zero-width space, a form feed | `◊[server]⏎port⍽= 8443` | a byte order mark at the start, or before a later header; a no-break space in the place of one space, of every space around the equals signs, or of the indentation; a zero-width space before a key, after a key or after a value; a form feed before a later header | 1.2 | 512 | yes for a parser with a character class for it: the character is read as white space |
| terminalCodes | The color codes of a terminal, copied with the text: the escape character, a [, digits and a letter | `␛[34mport␛[0m = 8443` | the marks of a match around one key or value, as grep writes them; a color around every header; around every key; around the document | 0.5 | 175 | yes for a parser with states for the code: from the escape character to the letter everything is skipped, and its [ opens nothing |
| carriageReturnLineEnds | Line ends that TOML does not read: a carriage return alone, two of them before the line feed, or one after it | `[server]↵port = 8443↵` | a carriage return in the place of every line feed; one carriage return more at every line end; a carriage return after every line feed | 0.5 | 175 | yes: a carriage return ends a line by itself, and a second one is white space |
| strayLine | A line that is no TOML between the lines of the document | `[server]⏎port = 8443⏎---⏎[tls]` | a rule such as --- or \*\*\* before a header; --- as the first line; a command of a shell or of an editor, e.g. :wq; the tags of a template before and after 1 to 3 entries, e.g. {% if production %}; a note without a # | 1.5 | 579 | yes: the line has no label and ends at its line end, and the braces of a tag open and close in pairs |
| ellipsis | A marker for what was left out, in the place of some entries or of some values of an array | `tags = ["web", ...]⏎...` | ... … [...] &lt;snip&gt; (...) or "... more ..." on a line in the place of 1 or more entries; ... in the place of the last values of an array, or of values in its middle | 1.2 | 286 | yes: the marker has no label, and what follows it is read as it is |

### What the last column says

It is a judgment per kind, as the column "Can a parser label the rest?" of `lab/recovery-parser/README.md` is, and no proof. The parser meant is the loop of `../table-parser.ts` with other tables: one step per code point, a tokenizer cell per state and character class, a grammar cell per state, token and context with a stack action, and a display entry per event and grammar state. A cell that valid TOML reads stays as it is. The tables may have more states and more character classes than today's.

- **yes**: such tables can show every scored code point after the mistake right.
- **yes for a parser with a character class** or **with states**: they can when the tables get that class or those states. The recipe adds classes by its own rule, from the train samples, and adds no states. On the mixed train split that rule picks 25 code points: the no-break space, the byte order mark, the backtick, the semicolon and the quotes `“` and `”`, next to `→`, `ß` and `ö` of comments and 16 capital letters. It does not pick the parentheses, `<`, `>`, or the escape character. Nothing was trained for this: the rule only counts.
- **partly**: some scored code points are read by cells that valid TOML reads and are shown as something else than their label, whatever the other cells hold. E.g. the name of `server:` in the place of `[server]` stands where a key stands. Where such a mistake is the first error of its text, these code points come before the error and are not scored, by the dataset's first rule. They are scored when another error comes before them.
- **no**: a later character decides what an earlier one is, or the text reads as something else, e.g. the string that runs on after a quote that is missing inside a line.

### Rules that exclude each other

Some kinds are shown right only by rules that contradict each other at the same cell, as on the JSON side. One set of tables cannot have both sides right. The counts are samples of this folder's half of the mixed set.

| A rule | Samples | The rule that it excludes | Samples |
| --- | --- | --- | --- |
| A string that is open at a line end ends there: `missingClosingQuote` at the end of a line | 1,153 | A line end inside a string is content: `rawLineFeedInString` | 121 |
| A line end after an equals sign starts the next line anew: `equalsWithoutValue`, and `server:` of `headerForm` | 1,254 | A line end after an equals sign is white space: `valueOnNextLine`, and the YAML list of `arrayWithoutBrackets` | 377 |
| A line end inside an inline table is white space: `inlineTableOnLines`, `inlineTableAsBlock` | 1,151 | A line end inside an inline table ends it: `missingCloser` of an inline table. Only the display kinds are scored there, up to the next kept bracket | 185 |
| A semicolon after a complete value is skipped, and an entry may follow: `lineEndSeparator`, `entriesOnOneLine` | 463 | A semicolon after a complete value starts a comment: `foreignComment` | 306 |
| A word after a complete value at depth 0 is the next key: `entriesOnOneLine` with a space or nothing between two entries | 125 | It is a comment, or more of the value: `commentWithoutHash` after a value, the content after `""` of `doubledQuote`, a unit or a time zone after a space | 244 |

The first pair is the one that the JSON side has too. In the second pair the first token of the next line can tell the two apart in most texts: a key or a header on one side, a string, a number or a dash on the other.

## Numbers

Of this folder's half of the mixed set, 23,732 samples. `stats.ts` prints them, with the forms of every kind.

| | |
| --- | --- |
| Samples with one kind and with two | 16,466 (69.4%) and 7,266 (30.6%). Two kinds are drawn in 45 draws of 100, and such a draw is thrown away more often |
| Draws | 43,365, of which 19,633 (45.3%) are thrown away: 19,094 have no place for a kind or two kinds that touch, 272 are longer than 512 code points, 240 leave nothing to score, 14 are still valid, 13 are deeper than 16 |
| Scored code points per sample | mean 169.9, median 153, a tenth of the samples has 32 or fewer, a tenth 336 or more. 4,031,930 in all. The dataset's first 60,000 samples have a mean of 132.7 |
| From the first damaged code point to the first error | median 0, mean 1.4. 70.8% of the samples have 0, and 0.3% more than 50. The dataset's samples have a mean of 22.4, since a blind edit often falls into a comment or a string and leaves the text valid |
| Code points | a broken text has 278 on average, of which 7.8 are added. 5,053 samples have a code point that stands in the place of another |
| A scored depth out of the loop's reach, see `../limits.ts` | 110 samples (0.5%) |

The score of the parser as it is and of the one rule without training, "after an error, start anew at the next line" of `../learn/restart-at-next-line.ts`, in percent: the scored code points with display kind, depth and container right ("all three"), and the samples with every scored code point right ("whole").

| | Samples | Scored code points | As it is: all three | whole | The one rule: all three | whole |
| --- | --- | --- | --- | --- | --- | --- |
| Validation, this folder's half | 2,691 | 460,118 | 71.09 | 10.03 | 87.62 | 38.50 |
| Validation, the dataset's half | 2,691 | 357,086 | 62.86 | 11.63 | 91.05 | 34.49 |
| Validation, both halves | 5,382 | 817,204 | 67.49 | 10.83 | 89.12 | 36.49 |
| Train, this folder's half | 21,041 | 3,571,812 | 71.33 | 9.80 | 87.99 | 38.60 |
| Train, the dataset's half | 21,041 | 2,774,351 | 64.45 | 11.21 | 91.76 | 35.73 |
| Train, both halves | 42,082 | 6,346,163 | 68.32 | 10.51 | 89.64 | 37.16 |

So the one rule has less on this folder's half than on the dataset's, 87.6% against 91.1%, and more whole samples, 38.5% against 34.5%. Per kind, on the validation samples with that kind alone, the one rule has every code point right for the kinds that add whole lines, e.g. `codeFence`, `proseAround`, `frontMatter`, `embeddedInCode`, `conflictMarkers`, `strayLine`, and 99% or more for `keyAlone`, `equalsWithoutValue`, `foreignLiteral`, `halfTypedValue`, `extraComma`, `ellipsis` and `headerBracket`. A trained parser can add nothing there. The kinds on which the one rule has less than 90% of the code points:

| Kind alone, validation | Samples | As it is: all three | The one rule: all three | whole |
| --- | --- | --- | --- | --- |
| carriageReturnLineEnds | 28 | 29.3 | 31.7 | 28.6 |
| inlineTableOnLines | 53 | 88.1 | 62.1 | 0.0 |
| linePrefix | 66 | 61.9 | 62.8 | 25.8 |
| inlineTableAsBlock | 14 | 83.0 | 64.2 | 0.0 |
| otherBrackets | 12 | 65.3 | 67.2 | 25.0 |
| colonForEquals | 114 | 56.3 | 68.8 | 0.0 |
| terminalCodes | 23 | 60.8 | 70.3 | 0.0 |
| foreignQuotes | 51 | 39.1 | 71.0 | 7.8 |
| unescapedBackslash | 7 | 9.8 | 72.2 | 0.0 |
| otherAssignment | 26 | 70.6 | 75.0 | 23.1 |
| unescapedQuote | 5 | 66.3 | 76.9 | 0.0 |
| invisibleCharacter | 27 | 66.6 | 77.0 | 11.1 |
| valueOnNextLine | 15 | 95.7 | 78.7 | 6.7 |
| unquotedString | 133 | 68.4 | 84.2 | 0.0 |
| dateFormat | 15 | 85.3 | 86.0 | 6.7 |
| arrayWithoutBrackets | 28 | 73.5 | 86.3 | 78.6 |
| missingOpeningQuote | 18 | 69.2 | 87.3 | 0.0 |
| entriesOnOneLine | 36 | 83.6 | 88.0 | 58.3 |
| bareKeyCharacter | 57 | 79.8 | 89.0 | 36.8 |
| doubledQuote | 23 | 56.0 | 89.6 | 0.0 |

Two things about the parser as it is explain its rows. After a character that starts no token, e.g. the colon of `port: 80`, it shows the rest of the line as an error. And after a closing bracket where nothing is open, it counts a depth below 0 for the rest of the text, which is why it has 1.3% on `strayCloser` alone. The one rule shows the line of an error as the parser as it is does, so it has no whole sample where a scored code point of that line is shown wrong, e.g. the line end after a string without its closing quote.

## Run it

From the repo root:

```sh
bun lab/recovery-toml/kinds/check.ts [indexes] [seed]      # the checks, by default on the indexes 0 to 29,999: about 30 seconds
bun lab/recovery-toml/kinds/stats.ts [file] [--places]     # the numbers above. --places: how many documents have a place for each kind
bun lab/recovery-toml/kinds/stats.ts --table               # the table of kinds of this README
bun lab/recovery-toml/kinds/dump.ts <folder> [per kind]    # samples.txt and by-kind.txt for reading
bunx tsc -p lab/recovery-toml/kinds && bunx oxlint --type-aware lab/recovery-toml/kinds
```

`check.ts` ends with "every check passed". It checks:

1. The scan: the labels that follow from the parts of `scan.ts` are the reference labeler's at every code point of 23,603 documents.
2. This folder's copy of `unscoredOf` gives the dataset's values for the dataset's 23,603 samples of those indexes.
3. 23,603 samples of this folder: the check applies the edits itself, takes the labels from the tables' run on the original, and derives the first damage and what is not scored a second time. The label of every kept code point, 6.4 million, is the one of its counterpart. Every broken text is rejected by the parser as it is and by the reference labeler, and has a code point to score. No sample is of the test split or of a held-out template, and `kindsSampleAt` refuses all 6,397 indexes of the test split. `samplesOf` of `../learn/data.ts` takes the samples and counts the same scored code points.
4. A sample that is made twice is the same, 2,364 of them, and another seed gives another broken text.
5. The mixed set: the numbers of the table above, every index once, each sample of a document of its split, and the mark of the half says what the sample is.

`dump.ts` writes `samples.txt`, the first 300 samples of this folder's half of the mixed train split in the layout of `../dump.ts`, and `by-kind.txt`, some samples per kind with that kind alone, cut down to the columns around the damage.

## Files

- `scan.ts`: where the lines, headers, entries, keys, values, strings, arrays, inline tables and comments of a valid document are. The kinds pick their places from it.
- `types.ts`: what a kind is. `list.ts`: all 49.
- `assignment.ts`, `values.ts`, `strings.ts`, `keys-and-headers.ts`, `brackets.ts`, `comments.ts`, `around.ts`: the kinds, one file per family, each kind with its row of the table above.
- `samples.ts`: `kindsSampleAt`, and `sampleOfKind` for a sample with one given kind.
- `mixed.ts`: the mixed set.
- `check.ts`, `stats.ts`, `dump.ts`: see above.

## What reading the samples showed

I read about 280 samples closely in the layout of `by-kind.txt`: 4 to 8 of every kind alone, one of nearly every form, and 24 with two kinds.

- **The labels are where the rules put them.** In every sample that I read, a kept code point has the label of the original, an added one has none, and a `?` stands where the parser as it is gives something else before its first error, e.g. under the `6.9` of the unquoted `6.9.17` and under the name of `server:`.
- **One kind was wrong and is gone.** A first version wrote a table as a block, e.g. `server = {`, the entries on lines and a `}`, with the labels of the table `[server]`: depth 0 for the entries. The same text is an inline table on several lines without commas, for which `inlineTableOnLines` and `missingComma` ask for depth 1. `inlineTableAsBlock` took its place: the block is made of an inline table and keeps that table's labels. A header as YAML writes it, `server:`, went to `headerForm`.
- **Mistakes at the end of a document leave little to score.** E.g. a half-typed value on the last line has 1 scored code point, the line end. A tenth of the samples has 32 or fewer.
- **The templates `oddities` and `deepNesting` give texts that no person would write,** e.g. a key without its quotes inside 7 levels of brackets. They are 8% of the documents, as in the dataset.
- **The added texts come from short lists.** A sentence before a document is one of 12, a note of a new comment one of 11. The other side of a merge conflict is the document's line with one number or one word changed. What follows real files is the syntax, as in the JSON dataset.

## Known limits

- **The weights are estimates,** and so is the share of two kinds per sample.
- **A mistake is only as frequent as the documents allow.** The kinds work on the dataset's documents, so `unescapedBackslash` has 197 samples and `unescapedQuote` 96, with weights of 10 and 3: 6% and 9% of the documents have a place for them.
- **No values are declared as not scored,** see "A sample". The kinds with a "no" or a "partly" in the table have scored labels that no tables can give. So a validation number of this half has a ceiling below 100, as the dataset's half has.
- **Two kinds of one sample have nothing to do with each other,** but for a sentence and a code fence. The JSON dataset has combinations with one cause in a quarter of its damaged samples, e.g. a pasted JavaScript object with every key without quotes and every string in single quotes. Here the forms "every" of one kind stand for that, e.g. every entry with a colon, and no sample is a whole YAML or JSON document. The JSON dataset's typing replays have no counterpart either.
- **Left out on purpose:** what the tables accept, e.g. a key that is defined twice. A text that only stops, since nothing after it is scored. A string of several lines whose closing quotes are wrong, since the parser as it is then reads the rest of the text as a string and reports its first error at the end.
- **Samples of one document in the two sets.** A sample of this folder and the dataset's sample with the same index are made of the same document. The mixed set takes one of the two per index. A set that takes both, e.g. `kindsHalf()` next to the dataset's whole standard set, has every document twice.
