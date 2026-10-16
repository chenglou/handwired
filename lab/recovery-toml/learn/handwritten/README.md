# Recovery rules for TOML written by hand

This folder holds the recovery that a programmer writes by hand for the TOML tables, as choices of open cells: the counterpart of the 35 rules of `lab/recovery-parser/learn/handwritten/`. It is row 3 of the transfer experiment, the row that trained tables are held against. With it the comparison is "the same cells, filled by hand or by training".

`rules.ts` holds 39 rules. Each rule has a name, the reason a person would give for it, an example, and the cells it names. `handwrittenTables()` returns the tables.

## What the rules may fill

The rules fill what the recipe's training may fill, and nothing else:

- **The base** is the recipe's base (`baseOfRecipe` of `../recipe.ts`): today's tables, open entries of the display table, the bit "first on its line", and added character classes. The one difference: the recipe's rule counts its classes out of the train samples, and here 8 classes with 17 code points are chosen by hand, e.g. one for the semicolon and one for the typographic quotes. `handChosenClasses` in `rules.ts` lists them.
- **No state is added.** Where a rule needs a state, it gives a second meaning to a state in a context that valid TOML never has, e.g. the grammar state `keyOrClose` at the top level. The comments above the rules list every such state.
- **The recipe's 378 kept grammar cells hold today's choice**, among them the whole row of the grammar state `error`, and the display entries of that state hold today's kinds. So the state `error` still takes in everything, as it does for trained tables, and the rules have to keep the grammar out of it: on the train and validation splits of both sets, no code point leaves the grammar in that state. A valid text with a value of more than 16 levels is shown as today.

The base has 55 classes, 6,105 tokenizer cells of which 3,569 are open, 5,244 open grammar cells that are not kept, and 483 open display entries outside the state `error`. The rules set 3,066 tokenizer cells, 4,235 grammar cells and 56 display entries to another choice than today's, and rely on 309, 652 and 6 more as they are. Most of the grammar cells come from one rule, "anything else changes nothing", with 2,911.

## How the rules were made

They were written in one session by one agent, from TOML's grammar, from broken texts of my own, and from the train splits of two sets: the dataset's standard set, whose damage knows nothing of TOML ("neutral"), and the mixed set of `../../kinds/`, half of which is kinds of mistakes written for TOML. `sets.ts` loads both. The test split, the held-back sets and every trained table were never read.

No script picked a cell's choice. But counts and scores were in view the whole time, and they made many choices:

- **Lists of wrong cells.** `where-wrong.ts` and `worse.ts` list the cells at the first wrong code point of every sample, with one example each. I read about 15 such lists of 30 to 70 entries, and wrote or changed rules from them.
- **Counts at cells with two readings.** `wants.ts` counts what the originals have at the code points that read a cell. About 40 cells were counted, see [Where two readings contradict](#where-two-readings-contradict).
- **Counts for the display entries.** `wants.ts --display` counts the labels' kinds per open display entry. The entries that the rules set follow these counts, as the recipe's count step does.
- **Variants by their train scores.** 24 times a rule was scored in two forms on the train splits of both sets, and the form with the higher score stayed. 9 of the new forms stayed, see [What was tried and dropped](#what-was-tried-and-dropped).
- **Validation scores.** `report.ts` scores the validation split by default, so validation numbers were printed during the writing, and one change came from a validation table: leaving out the rule "a missing comma" scored higher on the neutral validation split, which led to the narrower form of that rule. So no split of these two sets counts as unseen for these rules. The held-back sets do.

Few samples were read as a whole: the first 13 of the dataset's dump and about a dozen more. The rest of the reading was the excerpts of the lists, about 100 code points each.

**How much effort went in.** One session of about 75 minutes on the clock: a first draft of 28 rules, a second draft of 33 after the first lists and counts, and then the changes above, each scored on the train splits in under a second. A person would need a few days for the same lists, counts and variants. The session stopped when a change added 0.05 points or less: the last one that added more was the rule "a quote right after a word", 0.37 points on the neutral train split, which came from the list of samples that lose against the one rule. A longer effort would most likely find more of that sort.

## Result

The percentage of the scored code points with display kind, depth and container right ("all three") and the percentage of samples with every scored code point right ("whole"). A scored code point is one from the first error on whose label has a scored value, see `../README.md`.

| Validation split | Samples | Scored code points | The parser as it is | The one rule | Hand-written |
| --- | --- | --- | --- | --- | --- |
| Neutral set | 5,382 | 709,413 | 64.14 / 12.02 | 91.45 / 36.03 | 94.87 / 50.67 |
| Mixed set | 5,382 | 817,204 | 67.49 / 10.83 | 89.12 / 36.49 | 96.75 / 64.86 |
| Mixed set, the dataset's half | 2,691 | 357,086 | 62.86 / 11.63 | 91.05 / 34.49 | 94.41 / 50.50 |
| Mixed set, the half of kinds | 2,691 | 460,118 | 71.09 / 10.03 | 87.62 / 38.50 | 98.57 / 79.23 |

| Train split | Samples | Scored code points | The parser as it is | The one rule | Hand-written |
| --- | --- | --- | --- | --- | --- |
| Neutral set | 42,082 | 5,582,222 | 64.43 / 11.23 | 91.88 / 35.60 | 94.97 / 51.98 |
| Mixed set | 42,082 | 6,346,163 | 68.32 / 10.51 | 89.64 / 37.16 | 97.00 / 65.91 |
| Mixed set, the dataset's half | 21,041 | 2,774,351 | 64.45 / 11.21 | 91.76 / 35.73 | 94.88 / 51.78 |
| Mixed set, the half of kinds | 21,041 | 3,571,812 | 71.33 / 9.80 | 87.99 / 38.60 | 98.65 / 80.03 |

"The one rule" is `../restart-at-next-line.ts`: after an error, the parser as it is starts anew at the next line. On the neutral validation split the hand-written tables have the display kind right at 96.5% of the scored code points, the depth at 97.5% and the container at 98.2%.

Four things that these numbers do not show:

- **No error is shown any more.** No sample of the train and validation splits of either set shows the display kind `error` anywhere, also not at one of the 401,751 and 386,118 code points that the damage added. The score does not see this, since no label is an error. The first error and `valid` are still today's.
- **Some texts get worse.** On the neutral validation split, 574 of the 5,382 samples lose a code point that the parser as it is has right, 5,121 code points against 223,087 gained, and 239 samples lose more than they gain. Against the one rule, 566 samples lose 5,881 code points against 30,115 gained, and 428 lose more than they gain. On the mixed validation split: 3,945 lost and 243,031 gained against the parser as it is, 4,520 and 66,860 against the one rule. `worse.ts` lists the samples by the cells at the first lost code point.
- **Both training sets were in view**, see above.
- **The neutral set has a ceiling below 100.** Its labels follow one rule, and some of them no parser can give, see `../README.md`. E.g. after a quote that the damage put into the middle of a line, the rest of the line is labeled as the document had it.

## How the rules read a broken text

The tokenizer:

- **A line end ends a token.** A string of one line that is still open at the end of its line ends there, and so does a number or a literal that is not complete. Strings of several lines keep their line ends, by cells that valid TOML reads.
- **A character that starts nothing is one character of its own.** Today the tokenizer gives up the rest of the line after e.g. a colon or a `$`. With the rules it goes on as between tokens, and the grammar reads the character by where it stands, e.g. as the equals sign after a key.
- **Other notations get tokens that TOML has.** A semicolon is read as a comma, a parenthesis as a square bracket, a typographic quote or a backtick starts a string, and `//`, `/*` and `<!` start a comment. A no-break space and a color code of a terminal are skipped like white space.
- **A quote right after a word starts a string of one line.** Three quotes there are most often the end of a string of several lines whose start is lost.

The grammar:

- **A line end at the top level starts the next line anew**, wherever the line stopped. Two exceptions wait for the next line: after an equals sign without a value, and after a comma, a string at the start of the next line is still a value.
- **A token in a place where the grammar has no entry is read as the nearest sensible thing.** E.g. a value right after a key is that key's value (the equals sign is missing), a word where a value should stand is a string without quotes, and a closing bracket where nothing is open closes nothing. Where no rule says what a token means, the grammar stays where it is.
- **Inside an array, a key says that the array lost its closing bracket.** An equals sign, a word at the start of a line after a complete value, and an opening bracket at the start of a line after a value close the array. Inside an inline table, a line end after a complete value closes the table.
- **A container closes one level per code point.** When a header starts inside two open arrays, its first two code points close them.

Some states get a second meaning through their open cells. No state is added, so a text that reaches one of them the old way is read by the new meaning too.

| State | Meaning today | Second meaning | What the second meaning costs |
| --- | --- | --- | --- |
| tokenizer `errorLine` | after a tokenizer error, up to the line feed | inside a string between typographic quotes or backticks | nothing: every cell of the state is open, and no rule leads into it otherwise |
| tokenizer `afterCloseBracket` | right after a `]` | right after a slash or a `<`, where a second slash or a character without a class of its own starts a comment | a slash or such a character right after a `]` starts a comment, e.g. in `[1]/`, and a `]` right after a slash is read as the second bracket of `]]` |
| tokenizer `afterOpenBracket` | right after a `[` | right after a colon, where a slash starts no comment | a `[` right after a colon is read as the second bracket of `[[`, which the grammar reads as an opening bracket where a value may start |
| tokenizer `multiBasicEscapeSpaces` | after a backslash and white space in a string of several lines | inside a color code of a terminal | in a string of several lines, a `[`, a digit or a letter after a backslash and white space is skipped, and the letter ends the string |
| tokenizer `localHourColon` | after the two digits of an hour and a colon | after any number and a colon, e.g. the number of a line | the colon after a number of one or three digits is no sign for the equals sign, e.g. in `1: "one"`, where the rule for a value without an equals sign still reads the string as the value |
| grammar `arrayHeaderClose` inside a container | no text reaches it there | a closing bracket of the other kind closed a container, and the container around it still has to close | when the bracket was only mistyped, the next token closes one container too many |
| grammar `arrayHeaderClose` at the top level | between the two brackets of `]]` | inside a line that is a comment, after a semicolon at the start of the line | the space of `[[a] ]` is shown as a comment |
| grammar `headerOpen` and `arrayHeaderOpen` inside an array of depth 1 | no text reaches them there | after an opening bracket that came after a key: an array, or a header | a header inside an array of an array that lost two closing brackets is read by this meaning, which closes the last array at the header's name as well |
| grammar `keyOrClose` at the top level | no text reaches it there | after a comma: a string or a number is the next value of a list, a word is the next key | nothing |
| grammar `value` at the start of a line at the top level | no text reaches it there | after an equals sign without a value: a string is the value, anything else starts a line | a key in quotes on the line after an equals sign without a value is shown as a string, up to its equals sign |
| grammar states of the top level inside a container, e.g. `lineStart` | no text reaches them there | the container lost its closing bracket: every code point closes one | nothing |

## The rules

The rows are in the order in which `report.ts --steps` adds the rules: first the rules that stand in for the one rule, then the rules of the first draft, then the rules that were added later, in the order in which they went in. The first draft was written as a whole, so the order of its rules is one that I chose. In `rules.ts` the rules stand in another order, the one in which an earlier rule has a cell before a later one.

- **Cells it names**: the cells and display entries that the rule sets to another choice than today's, and the open ones that it relies on as they are.
- **Samples**: how many of the 94,928 broken texts of the two sets, train and validation, read a cell or an entry of the rule from the first error on. The dataset's half of the mixed set is in both sets.
- **Added when it went in**: the difference in "all three" between the rules up to and including this one and the rules before it, on the neutral validation split and on the mixed one. With no rule the two are 64.14 and 67.49, and with every rule 94.87 and 96.75.
- **Without it**: the difference in "all three" between every rule but this one and every rule. The cells of a rule that is left out go to the rules that fill what is left, most of all to "anything else changes nothing", so this column understates a rule whose cells would hold that rule's choice anyway, e.g. "a comma too many".

| | Rule | Cells it names | Samples | What it does | Added when it went in: neutral, mixed | Without it: neutral, mixed |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | anything else changes nothing | 2911 grammar | 19,664 | Where no rule says what a token means, the grammar stays where it is, where today it gives up the rest of the text. An opening bracket still opens a container, so that its closing bracket finds it. E.g. `name = <your-token>⏎[server] ???` | +15.67, +11.08 | −5.50, −4.49 |
| 2 | a line end at the top level | 18 grammar | 17,793 | At the top level a line end starts the next line anew, wherever the line stopped: after a key alone, inside a header without its closing bracket. E.g. `[server⏎host = "a"⏎por⏎name = "b"` | +1.94, +1.41 | −1.05, −1.17 |
| 3 | a line end ends a token | 139 tokenizer, 3 as today | 46,182 | A string of one line, a number or a literal that is still open at the end of its line ends there: the line feed, or the carriage return before it, is read as the end of the line. A string of several lines keeps its line ends. E.g. `name = "tiny-router⏎version = "6.9.17"` | +0.45, +0.24 | −22.80, −17.01 |
| 4 | a character that starts nothing | 221 tokenizer | 13,033 | Any other character that starts no token is one character of its own, e.g. a colon, a backslash or a $: the tokenizer goes on after it as between tokens, where today it gives up the rest of the line. The grammar reads it by where it stands, e.g. as the equals sign after a key. After a colon the tokenizer is in the state in which a slash starts no comment. E.g. `port: 8443⏎home = ${HOME}` | +0.30, +1.31 | −0.14, −1.33 |
| 5 | a word that breaks off | 945 tokenizer | 4,735 | A number, a date or a literal that is not complete ends at a character that cannot go on with it, e.g. the comma of `tru,`, and that character is read as between tokens. In a word that can only be a value, e.g. after 07:3, a letter goes on with the word. E.g. `enabled = tru⏎since = 2024-01-⏎at = 07:3x` | +0.42, +0.31 | −0.33, −0.32 |
| 6 | a token ends where the next one starts | 306 as today | 12,319 | Right after a word, a number, a closing bracket or the closing quotes of a string, a character that starts a token is read as between tokens. Today's tables hold this in every such open cell already, e.g. for the comma of `name,`, and the rules rely on it. E.g. `point = { x = 1, y}` | +0.00, +0.00 | +0.00, +0.00 |
| 7 | a closing bracket where nothing is open | 103 grammar | 13,011 | At the top level a closing bracket closes nothing, and the grammar stays where it is. E.g. `ports = [80, 443]]⏎]` | +0.00, +0.00 | +0.00, +0.00 |
| 8 | a state of the top level inside a container | 252 grammar | 1,106 | The start of a line, a header and the end of a header only come at the top level. When the grammar is in one of these states with a container still open, the container lost its closing bracket: every code point closes one container, and is read as at the top level. E.g. `tags = [["a", "b"⏎[server]` | +0.00, +0.00 | −0.19, −0.16 |
| 9 | the first token of a line | 250 grammar, 587 as today | 3,834 | A token that is the first on its line is read as any other token, where no rule above says otherwise. E.g. `point = {⏎  x = 1⏎}` | +0.00, +0.00 | −0.00, −0.17 |
| 10 | a string goes on | 782 tokenizer | 1,190 | Inside a string or a comment, a control character is content. After a backslash and a character that TOML does not escape, the string goes on: the backslash was meant as a backslash. A character that is no hex digit ends a \u escape and is read as the string reads it. E.g. `path = "C:\Users\ada"` | +0.15, +0.53 | −0.06, −0.16 |
| 11 | a carriage return alone | 144 tokenizer | 686 | A carriage return that no line feed follows ends its line by itself: the character after it is read as the first of the next line. Inside a string of several lines it is content. E.g. `[server]↵port = 8443↵` | +0.04, +0.56 | −0.06, −0.47 |
| 12 | a sign in the place of the equals sign | 48 grammar, 2 display, 12 as today | 14,555 | After a key, a character that starts nothing stands for the equals sign, e.g. the colon of YAML and JSON: the value comes next. Where a value should start, such a character starts a value without quotes, and an equals sign changes nothing. E.g. `port: 8443⏎name := "tiny"⏎point = { "x": 1 }⏎home = $HOME` | +0.05, +0.76 | −0.07, −0.10 |
| 13 | a value without an equals sign | 21 grammar | 21,826 | A string, a number or a literal right after a key is that key's value. A word that can only be a key goes on with the key, and an opening brace opens an inline table. E.g. `workers 32⏎host "127.0.0.1"⏎request limit = 30⏎server {` | +0.33, +0.29 | −0.45, −0.34 |
| 14 | a word where a value should stand | 20 grammar, 4 display | 42,678 | A word without quotes after an equals sign is a string without its quotes, and is shown as one, with its dots. After a complete value at the top level, more words, numbers and strings go on with the value, and an equals sign says that the value comes only now. E.g. `name = tiny-router⏎title = Tide Docs⏎version = 6.9.17` | +0.44, +0.42 | −0.57, −0.68 |
| 15 | a header in another form | 26 grammar, 2 display | 7,823 | Inside a header, a character that starts nothing stands for the dot between two parts of the name, and a word or a string after a part is the next part. An equals sign inside a header starts a value: the header lost its end. A second opening bracket after a space still starts the header of an array of tables. After a header, a key starts an entry on the same line, and a bracket opens nothing. E.g. `[server:tls]⏎[remote "origin"]⏎[ [rule] ]⏎[tls] enabled = true⏎[welcome] {` | +0.07, +0.08 | −0.10, −0.06 |
| 16 | an entry inside an array | 15 grammar | 5,554 | An array holds no keys. So an equals sign inside an array, and a word at the start of a line after a complete value, say that the array lost its closing bracket: the array closes there, and the entry is read. E.g. `ports = [80, 443⏎name = "a"` | +6.07, +4.71 | −1.96, −1.28 |
| 17 | a header inside a container | 30 grammar | 2,487 | An opening bracket at the start of a line, after a value inside an array or anywhere inside an inline table, starts a header: the container lost its closing bracket and closes there. After a comma inside an array the bracket opens an array, by a cell that valid TOML reads, and then a word without quotes right inside that array says that it is a header. E.g. `point = { x = 1, y = 2⏎[server]⏎members = [⏎  "core",⏎[workspace.dependencies]` | +3.03, +3.50 | −0.27, −0.20 |
| 18 | a missing comma | 35 grammar | 10,394 | After a complete value inside an array, the start of a value is the next value, and a word without quotes is a string without its quotes. Inside an inline table, a word that can only be a key after a complete value is the next key. A string or a number there goes on with the value, by the rule `anything else changes nothing`: a key in quotes is rare. E.g. `ports = [80 443]⏎tags = [web, prod]⏎point = { x = 1 y = 2 }` | −0.09, +0.02 | +0.07, −0.03 |
| 19 | a comma too many | 12 grammar | 1,032 | A comma where a value or a key should start changes nothing, and a closing brace right after a comma closes the inline table. E.g. `ports = [80,, 443]⏎point = { x = 1, y = 2, }` | +0.00, +0.53 | +0.00, +0.00 |
| 20 | an entry of an inline table without its value | 12 grammar | 1,732 | Inside an inline table, a comma right after an equals sign or after a key goes on with the next key, and a closing brace there closes the table. E.g. `point = { x = , y = 2 }` | +0.34, +0.60 | −0.00, −0.00 |
| 21 | a line end inside an inline table | 33 grammar | 4,786 | Inside an inline table a line end after the opening brace, after a comma, after a key and after an equals sign is white space, as JSON writes an object on several lines. A line end after a complete value closes the table: its closing brace is missing, or it stands on the next line, where it then closes nothing. E.g. `serde = {⏎  version = "1",⏎  features = ["derive"]⏎}⏎point = { x = 1, y = 2⏎name = "a"` | +0.76, +0.51 | −0.62, −0.31 |
| 22 | a closing bracket of the other kind | 369 grammar, 13 as today | 1,277 | A closing bracket of the other kind closes the innermost container, and so does a closing bracket where the grammar expects something else. Inside a nested container the bracket is taken for the one of the container around: that one still has to close, and the next token closes it. E.g. `ports = [80, 443}⏎point = { x = 1, y = 2 ]⏎serde = { features = ["derive" }` | −0.05, −0.03 | +0.05, +0.03 |
| 23 | a key state inside an array | 9 grammar, 34 as today | 242 | After an array closed at an equals sign, the container around it may be an array too. There the states of an entry read as they read at the top level: a value follows an equals sign, and a line end closes one more array and starts the next line. E.g. `matrix = [[1, 2⏎name = "a"` | +0.00, +0.00 | +0.00, +0.00 |
| 24 | a line end after an equals sign | 5 grammar, 1 as today | 3,332 | After an equals sign without a value, the next line is read as a line of its own, but a string or an opening bracket at its start is the value: it was put on the next line. An empty line ends the wait. E.g. `host =⏎port = 8443⏎description =⏎  "Something quiet"` | +0.03, +0.14 | −0.03, −0.17 |
| 25 | a character that does not show | 156 tokenizer | 512 | A no-break space, a byte order mark, a zero-width space and a control character between tokens are skipped like white space. E.g. `◊[server]⏎port⍽= 8443` | +0.00, +0.34 | +0.00, −0.27 |
| 26 | a string between foreign quotes | 129 tokenizer | 1,929 | A backtick or a typographic quote where a token may start begins a string, which runs to the next such quote or to the end of the line. E.g. `` title = “Tide Docs”⏎run = `cargo test` `` | +0.44, +0.94 | −0.01, −0.54 |
| 27 | parentheses | 156 tokenizer | 1,312 | A parenthesis is read as a square bracket, as Python writes a tuple. E.g. `ports = (80, 443)` | −0.03, +0.05 | +0.04, −0.05 |
| 28 | a color code of a terminal | 105 tokenizer | 181 | An escape character starts a color code of a terminal, e.g. ␛[34m: the opening bracket, the digits and the semicolons after it are skipped like white space, up to and including the letter that ends the code. E.g. `␛[34mport␛[0m = 8443` | +0.00, +0.14 | +0.00, −0.13 |
| 29 | a comment of another language | 157 tokenizer | 6,061 | Two slashes in a row, /* and <! start a comment that runs to the end of the line. Right after a colon a slash starts nothing, so that the slashes of https:// are no comment. E.g. `port = 8443 // default⏎/* optional */⏎<!-- per core -->` | −0.02, +0.26 | +0.02, −0.26 |
| 30 | an equals sign without a key | 4 grammar | 1,362 | An equals sign at the start of a line or after the dot of a key is followed by the value: the key is missing. E.g. `= "ltr"⏎server. = 1` | +0.04, +0.18 | −0.05, −0.04 |
| 31 | a list without brackets | 14 grammar, 3 as today | 5,380 | At the top level, after a comma that follows a value or a key, a string or a number is the next value of a list whose brackets are missing, or whose first line is. A word there is the key of the next entry on the same line. At the start of the next line a string is still the next value, and anything else is read as a line of its own. E.g. `tags = "web", "prod"⏎name = "tiny", port = 8443` | +0.04, +0.04 | −0.04, −0.07 |
| 32 | a mark before a line | 5 grammar, 2 display | 865 | After a + at the start of a line, the line is read as it would be without it: a word that starts with a sign is a key. After the number of a line and a dot, an opening bracket starts a header, and the colon after the number of a line is shown as punctuation. An opening brace at the start of a line opens nothing, e.g. the tag of a template. E.g. `+port = 8443⏎12: port = 8443⏎3. [server]⏎{% if production %}` | +0.02, +0.01 | −0.02, −0.01 |
| 33 | a character of another script in a key | 1 tokenizer | 2,276 | Inside a word that can only be a key, a character without a class of its own goes on with the word, e.g. a letter with an accent. E.g. `café = "open"⏎name = tiny-routér` | −0.00, +0.02 | +0.00, −0.02 |
| 34 | a semicolon | 78 tokenizer | 1,029 | A semicolon is read as a comma: it stands between two values of a list or between two entries, or it ends a line as in JavaScript. At the start of a line it starts a comment, as in INI files, see the rule `a line that starts with a comma`. E.g. `sizes = [1; 2; 3]⏎name = "tiny"; port = 8443;` | +0.00, +0.12 | −0.00, −0.16 |
| 35 | a line that starts with a comma | 22 grammar, 33 display, 2 as today | 735 | A semicolon at the start of a line starts a comment, as in INI files, and the tokenizer reads a semicolon as a comma. So after a comma at the start of a line at the top level, the rest of the line is skipped and shown as a comment. E.g. `; optional⏎workers = 32` | −0.03, +0.02 | +0.03, −0.02 |
| 36 | nothing is shown as an error | 13 display | 4,257 | A character that starts nothing is shown as a string wherever no rule above says what it stands for: most of them are content of a string that lost a quote. A dot where no key and no number stands is shown so too. E.g. `pattern = ^\d+$⏎url="mysql://app:p⏎@ss` | +0.02, +0.01 | −0.02, −0.01 |
| 37 | a number and a colon | 5 tokenizer | 568 | A colon right after a number of one, three or more digits is read as the colon after two digits is, which a cell that valid TOML reads takes for the colon of a time: the grammar stays where it is. So after the number of a line and a colon, the line is read as after a key, where a colon after a word stands for the equals sign. E.g. `1: [server]⏎2: port = 8443` | −0.00, +0.02 | +0.00, −0.02 |
| 38 | a bracket after a key | 21 grammar, 6 as today | 1,896 | An opening bracket after a key at the top level opens an array, whose equals sign is missing, or it starts a header after the number of a line. So the bracket opens an array, and the token after it says which it is: a word that can only be a key is the name of a header, and the array closes again. A word that starts like a number or a literal is a value until a character shows that it is a name. E.g. `tree [⏎  "shuttered",⏎]⏎ 12 [server]⏎ 13 [tool.black]` | +0.05, +0.03 | −0.05, −0.03 |
| 39 | a quote right after a word | 48 tokenizer | 20,476 | A quote or an apostrophe right after a word, a number or a closing bracket starts a string of one line, and never one of several lines: three quotes there are the end of a string of several lines whose start is lost, and read as the start of one they would take the rest of the text. E.g. `$git_branch\⏎$cmd_duration"""⏎add_newline = true` | +0.26, +0.11 | −0.26, −0.11 |

Read the last two columns with care. A rule's place in the order decides what it adds: "an entry inside an array" adds 6.07 points where it stands, because without it an array stays open after an error on its line, and "a line end ends a token" adds 0.45 where it stands and costs 22.80 when it alone is left out. Four rules cost a little on the neutral set and are there for the kinds: "parentheses", "a comment of another language", "a line that starts with a comma" and "a missing comma". "A closing bracket of the other kind" costs 0.05 and 0.03 on the validation splits. On the train splits its second part, the close that is owed, adds 0.03 and 0.01.

## Where two readings contradict

Some cells have two sensible readings, and the cell holds one choice. `wants.ts` counts, on the mixed train split, what the original has at the code points that read a cell: the grammar state after the counterpart, and the depth of the label against the parser's depth before the code point. A count says what the original wants at one cell, not what a choice is worth, and an added code point has no label and still moves the parser. Where the counts were close, the train scores of the two variants decided.

- **A word at the start of a line inside an array, after a complete value** (`ports = [80, 443⏎name = "a"`): the original is one level up, at a key, in 832 code points for a word that can only be a key and in 188 for a word that starts like a number or a literal. It is still inside the array, at a value, in 40 and 38. So the array closes.
- **The same word after a comma or after the opening bracket**: a value inside the array in 238, a key one level up in 41, the name of a header in 5. So the word is a string without quotes, and the array stays open until an equals sign.
- **A word right after the opening bracket of an array inside a container** (`"core",⏎[workspace.dependencies]`, where a cell that valid TOML reads opens an array at the bracket): the name of a header, two or three levels up, in 213, and a value in 146. So the word is the name of a header. At depth 1 the same cell has 794 values and 139 names, so there the word is a string.
- **An equals sign after a value inside an array**: the original is one level up in 139, and inside the array, in a string that lost a quote, in 110. So the array closes.
- **A line end after a complete value inside an inline table**: the original is at the start of a line at the top level in 775 code points, and stays inside the table in none that has a label. The line ends that the kinds add inside a table have no label, so the count does not see them: an inline table on several lines with a comma after every entry is still read right, since a line end after a comma is white space, and its closing brace on the last line then closes nothing. An inline table written as a block without commas is read wrong. Keeping the table open at a first word of the next line scored lower.
- **A word that starts like a number or a literal right after a key** (`workers 32` against `request timeout = 30`): a value in 626 code points, more of the key in 515. So it is the value.
- **A word after a complete value at the top level** (`title = Tide Docs` against `a = 1 b = 2` against `port = 8443 default`): more of the value, shown as a string, in 3,676, the next key in 463, a comment in 656. So it goes on with the value. The variant "the next key" lost 0.3 points on the neutral train split.
- **A comma after a value at the top level**: the original is inside an array or an inline table, whose bracket is lost, in 1,270, and the comma is added in 3,290, e.g. at the end of a line. After it, a word that starts like a number or a literal is a value in 269 and a key in 154.
- **An opening bracket after a key** (`tree [` against ` 12 [server]`): a header in 430, an array in 240. An array that is taken for a header costs every line of the array, and a header that is taken for an array costs its own line. So the bracket opens an array, and the next token can still turn it into a header. Reading the bracket as a header at once, and opening the array one token late, scored 0.02 points higher on the neutral train split and lost 0.76 points of whole samples on the half of kinds.
- **An opening bracket at the start of the line after an equals sign without a value**: a header in 100, an array as the value in 60. The array reading scored 0.03 points higher on the half of kinds, since a header that is read as an array costs less, so the bracket opens an array.
- **A semicolon**: a comment as in INI files, or a comma between two values or two entries. When the choice was made, the half of kinds had 98.43 on the train split with the comma and 98.32 with the comment. So it is a comma, and a comment only at the start of a line.
- **A closing bracket of the other kind inside a nested container**: the original is two levels up in 52 and 33 code points (brace and square bracket), one level up in 18 and 14. So the bracket closes the container, and the next token closes the one around it.

## What was tried and dropped

Each line is a variant that was scored on the train splits and did not stay, with what it changed in "all three".

- A colon as the tokenizer's event of the equals sign, so that only a colon stands for the equals sign: 0.11 lower on the neutral set, 0.05 lower on the half of kinds.
- A character that starts nothing and an equals sign right after it as one sign, e.g. `>=`: the same score, and fewer whole samples.
- A line end inside an open string closes the containers that were opened on its line: 0.12 lower on the neutral set.
- A word after a complete value is the next key: 0.31 lower on the neutral set.
- A word that starts like a number or a literal after a key goes on with the key: 0.03 lower on the neutral set.
- A colon after a number at the start of a line starts the line anew: 0.03 lower on the neutral set, 0.03 higher on the half of kinds.
- A parenthesis opens an array only where a value may start: 0.01 higher on the neutral set, fewer whole samples on the half of kinds.
- A character from U+0080 up where a token may start begins text that runs to the end of the line: 0.01 higher on the neutral set, 0.03 lower on the half of kinds.
- A `#` right after an equals sign is shown as a string, e.g. for a color without quotes: the counts of the mixed train split are 536 for a comment and 483 for a string.
- After a comma at the top level, the state after an equals sign: lower on both sets than the state "after a comma", in which a word is a key.
- Three variants of the close that is owed after a closing bracket of the other kind, among them none at all: 0.00 to 0.03 lower.

And what the first draft had otherwise, before the counts: a word at the start of a line after a comma inside an array closed the array, a line end inside an inline table was always white space, and a string after a complete value inside an inline table was the next key.

## What the rules cannot do in this table form

Each entry names what is missing. The counts are of the train split of the neutral set unless they say otherwise.

- **Set the depth to 0 at once.** The one rule starts every line after an error at depth 0. A grammar cell changes the depth by one level, so the rules close one container per code point, and the first code points of a line after two lost closing brackets have a wrong depth. And a cell cannot open two containers: a line `{ name = "a" },` of an array of tables whose first line is lost wants depth 2 after its brace. 41 samples start so, with 3,064 wrong code points.
- **Start anew whatever the line before was.** The one rule does not need to know why a line ended. The rules keep an array open over a line end, since valid TOML does, and so they keep it open after a string that took in the array's closing bracket, up to the next key or header: 1,181 samples have a wrong depth at such a line end.
- **Change what a cell that valid TOML reads does.** A string at the start of a line is a key, so the first item of a list whose first line is lost is shown as a key. The first characters of a string without quotes are shown as a number or a literal where they read as one, e.g. the `6.9` of `version = 6.9.17`. White space inside a string without quotes is shown as white space. An opening bracket after a comma inside an array opens an array, also when it starts a header. Two dashes start a key and no comment. And three quotes at the start of a line start a string of several lines: when they were the end of one whose start is lost, the string takes the rest of the text, since every cell inside such a string is one that valid TOML reads. The rule "a quote right after a word" only helps where the quotes follow a word.
- **Look ahead or back.** A quote that the damage put into the middle of a line, a key that follows a word on the same line, and whether a `[` after a key starts a header are known only later. The rules repair the last of these one token late.
- **Show one event in two ways after one grammar state.** The rest of a mangled literal or number, e.g. the `sle` of `fasle`, reads the display entries that the rest of a string without quotes reads, e.g. the `iny-router` of `tiny-router`. The entry holds "string". 1,469 of the 42,082 samples have at most 3 wrong code points and their first one there.
- **Tell one unexpected character from another in the grammar.** The tokenizer has one token for every character that starts nothing. So after a key, a `|` stands for the equals sign as a colon does, e.g. in `1 | [server]`, and a semicolon has to be read as a token that TOML has.
- **Remember how a container was opened.** An inline table that is written as a block, `server {⏎  host = "a"⏎  port = 1⏎}`, needs a state "inside a table on several lines" for its keys, its equals signs and its values. Without added states the rules close the table at the first line end after a value: the kind `inlineTableAsBlock` has 90.0% on the mixed validation split.

## Per kind of mistake

The mixed validation split, "all three" and "whole" in percent. A sample with two kinds is in the row of each. The dataset's ten edits are in the report of `report.ts --rows`.

| Kind | Samples | The parser as it is | The one rule | Hand-written |
| --- | --- | --- | --- | --- |
| `inlineTableAsBlock` | 23 | 73.95 / 4.35 | 68.01 / 0.00 | 90.03 / 30.43 |
| `arrayWithoutBrackets` | 50 | 77.86 / 16.00 | 88.32 / 58.00 | 91.78 / 84.00 |
| `commentWithoutHash` | 28 | 78.52 / 0.00 | 92.49 / 17.86 | 93.63 / 21.43 |
| `rawLineFeedInString` | 16 | 75.88 / 0.00 | 91.34 / 0.00 | 94.34 / 0.00 |
| `missingOpeningQuote` | 40 | 69.39 / 0.00 | 86.04 / 0.00 | 95.03 / 35.00 |
| `linePrefix` | 66 | 61.90 / 9.09 | 62.76 / 25.76 | 95.76 / 63.64 |
| `entriesOnOneLine` | 69 | 82.08 / 14.49 | 89.29 / 40.58 | 95.94 / 57.97 |
| `unescapedBackslash` | 22 | 48.94 / 0.00 | 80.25 / 0.00 | 96.07 / 27.27 |
| `doubledQuote` | 46 | 63.90 / 0.00 | 92.04 / 0.00 | 96.09 / 43.48 |
| `unescapedQuote` | 11 | 82.52 / 0.00 | 89.83 / 0.00 | 96.37 / 18.18 |
| `unquotedString` | 250 | 69.03 / 0.00 | 84.62 / 0.00 | 96.55 / 39.20 |
| `otherBrackets` | 18 | 69.38 / 0.00 | 74.92 / 16.67 | 97.19 / 77.78 |
| `foreignComment` | 162 | 78.15 / 9.88 | 88.69 / 33.95 | 97.29 / 46.30 |
| `dateFormat` | 37 | 75.45 / 0.00 | 89.32 / 5.41 | 97.57 / 24.32 |
| `wrongCloser` | 33 | 68.14 / 6.06 | 91.56 / 39.39 | 97.59 / 66.67 |
| `stringInTwoParts` | 17 | 79.07 / 5.88 | 94.07 / 47.06 | 98.25 / 52.94 |
| `headerForm` | 89 | 63.74 / 5.62 | 93.71 / 26.97 | 98.61 / 74.16 |
| `bareKeyCharacter` | 115 | 73.59 / 7.83 | 86.93 / 26.96 | 98.78 / 74.78 |
| `invisibleCharacter` | 65 | 63.97 / 1.54 | 78.86 / 6.15 | 98.79 / 89.23 |
| `missingClosingQuote` | 168 | 74.03 / 0.00 | 94.26 / 0.00 | 98.81 / 76.19 |
| `missingCloser` | 87 | 41.16 / 17.24 | 93.75 / 44.83 | 98.82 / 79.31 |
| `valueOnNextLine` | 26 | 86.93 / 30.77 | 83.69 / 3.85 | 98.92 / 69.23 |
| `equalsWithoutValue` | 126 | 81.28 / 23.81 | 96.80 / 74.60 | 98.98 / 86.51 |
| `inlineTableOnLines` | 106 | 81.48 / 9.43 | 64.46 / 0.00 | 99.00 / 89.62 |
| `strayCloser` | 62 | 19.35 / 1.61 | 97.29 / 30.65 | 99.20 / 93.55 |
| `foreignQuotes` | 88 | 41.67 / 1.14 | 71.90 / 4.55 | 99.21 / 84.09 |
| `headerBracket` | 132 | 45.47 / 10.61 | 94.96 / 40.15 | 99.23 / 84.09 |
| `foreignLiteral` | 166 | 84.29 / 21.08 | 95.81 / 75.90 | 99.31 / 89.16 |
| `keyAlone` | 79 | 77.79 / 20.25 | 96.10 / 65.82 | 99.38 / 88.61 |
| `conflictMarkers` | 61 | 80.68 / 18.03 | 96.07 / 73.77 | 99.40 / 90.16 |
| `extraComma` | 31 | 73.07 / 16.13 | 94.96 / 58.06 | 99.40 / 93.55 |
| `codeFence` | 129 | 84.38 / 1.55 | 96.06 / 68.99 | 99.47 / 85.27 |
| `missingEquals` | 85 | 79.52 / 15.29 | 94.63 / 75.29 | 99.49 / 91.76 |
| `missingComma` | 77 | 71.29 / 12.99 | 91.38 / 38.96 | 99.52 / 90.91 |
| `strayLine` | 53 | 76.93 / 3.77 | 96.27 / 56.60 | 99.52 / 86.79 |
| `otherAssignment` | 48 | 69.64 / 6.25 | 79.01 / 16.67 | 99.53 / 89.58 |
| `lineEndSeparator` | 112 | 82.28 / 11.61 | 95.68 / 69.64 | 99.62 / 90.18 |
| `colonForEquals` | 205 | 57.78 / 0.00 | 72.15 / 0.00 | 99.66 / 91.71 |
| `numberFormat` | 79 | 81.31 / 16.46 | 94.42 / 43.04 | 99.73 / 84.81 |
| `placeholderValue` | 59 | 77.42 / 15.25 | 90.39 / 45.76 | 99.73 / 89.83 |
| `proseAround` | 69 | 85.20 / 1.45 | 97.50 / 79.71 | 99.76 / 88.41 |
| `halfTypedValue` | 34 | 72.00 / 0.00 | 89.61 / 0.00 | 99.78 / 94.12 |
| `trailingCommaInInlineTable` | 66 | 77.33 / 24.24 | 95.75 / 60.61 | 99.80 / 96.97 |
| `frontMatter` | 40 | 82.69 / 0.00 | 97.05 / 65.00 | 99.89 / 90.00 |
| `ellipsis` | 29 | 79.77 / 17.24 | 96.22 / 75.86 | 99.95 / 96.55 |
| `unknownEscape` | 47 | 58.82 / 0.00 | 88.89 / 0.00 | 99.95 / 97.87 |
| `carriageReturnLineEnds` | 28 | 29.34 / 0.00 | 31.73 / 28.57 | 100.00 / 100.00 |
| `embeddedInCode` | 42 | 87.67 / 0.00 | 100.00 / 100.00 | 100.00 / 100.00 |
| `terminalCodes` | 23 | 60.76 / 0.00 | 70.33 / 0.00 | 100.00 / 100.00 |

What is left in the rows below 97%, from `where-wrong.ts --kind`:

- `inlineTableAsBlock`, `rawLineFeedInString`: the rule that they need is the opposite of a rule that more samples need, see the README of `../../kinds/`.
- `arrayWithoutBrackets`: a list of inline tables without its brackets wants depth 2 after a brace.
- `commentWithoutHash`: the words of a comment without its `#` stand where keys and values stand.
- `unquotedString`, `missingOpeningQuote`, `doubledQuote`, `unescapedQuote`, `unescapedBackslash`: cells that valid TOML reads, e.g. the first digits of `2.9.88` and the string that a stray quote opens up to the end of its line.
- `linePrefix`: after the number of a line, a key that starts like a literal or a number is read as a value, e.g. the `title` of `1 title = "x"`, and after `1 | ` the line is read as a value.
- `entriesOnOneLine`: a second entry after a space is read as more of the value.

## The checks

`check.ts` ends with "Every check passed." It checks:

- The tables keep the ground rules (`checkTables`): every frozen cell and every display entry that is not open holds today's.
- The recipe's 378 kept grammar cells and the display entries of the state `error` hold today's.
- Valid documents get today's trace at all 513 positions: the 47,464 documents of the train and validation samples, and 4,000 valid texts of `../check-texts.ts`, among them texts of 16 levels and of 512 code points. No position differs.
- The 94,928 broken texts of the two sets get today's trace before their first error, and today's first error.
- 2,000 valid texts with a value of more than 16 levels are shown as today from their first error on.
- No code point of the two sets reads an open cell that no rule names, and none leaves the grammar in the state `error`.

`../runs/check.ts --tables <a copy of the tables>` is a second check, written for the trained tables by another hand. It runs the plain parser of `../../table-parser.ts` beside the exact parser on 48,909 valid texts and 48,247 broken ones: no position differs. It reports one failure, which is no broken ground rule: it asks for a valid text with a code point of every added class, and no valid TOML holds the escape character, whose class is one of the eight. The copy needs another file name than `tables.json`, which that check takes for its list of runs.

## Commands

Run from the repo root, with `RECOVERY_SCRATCH` set to a folder outside the repo. The folder gets the cache of both sets.

```sh
bun lab/recovery-toml/learn/handwritten/rules.ts          # prints the rules with their cells, saves <scratch>/tables.json and its sha256
bun lab/recovery-toml/learn/handwritten/report.ts         # validation, both sets, next to the parser as it is and the one rule
bun lab/recovery-toml/learn/handwritten/report.ts --split train --rows
bun lab/recovery-toml/learn/handwritten/report.ts --steps --without-each-rule   # what each rule adds, about 2 minutes
bun lab/recovery-toml/learn/handwritten/check.ts          # the checks above, about 10 seconds
bun lab/recovery-toml/learn/handwritten/where-wrong.ts --set mixed --source kinds   # train: the cells at the first wrong code point of every sample
bun lab/recovery-toml/learn/handwritten/worse.ts          # train: the samples that lose code points against the one rule
bun lab/recovery-toml/learn/handwritten/wants.ts --grammar "(afterValue, keyOnly, depth 0)"   # train: what the originals have at a cell
bun lab/recovery-toml/learn/handwritten/wants.ts --display   # train: the labels' kinds per open display entry
bun lab/recovery-toml/learn/handwritten/show.ts --kind missingCloser --set mixed --wrong --cells   # samples of the train split, the parser's output under the labels
bun lab/recovery-toml/learn/handwritten/show.ts --examples   # what the tables show for the example of every rule
bun lab/recovery-toml/learn/handwritten/show.ts --text 'ports = [80, 443⏎name = "a"'
bun lab/recovery-toml/learn/score.ts --tables <scratch>/tables.json   # the folder's own scorer on the saved tables
```

`show.ts`, `where-wrong.ts`, `worse.ts` and `wants.ts` read the train split, or the validation split with `--split validation` where they have the option. All of them refuse the test split, whose samples are not loaded, and none imports from `../../held-back/`.

Files: `engine.ts` (what a rule is and how rules become tables), `rules.ts` (the classes and the rules), `sets.ts` (the two sets), and the commands above.

## Not checked

- The test split, the held-back sets and the two held-out templates.
- Texts outside the two sets. That no other text leads the grammar into the state `error` is not proven. The rule "anything else changes nothing" names every open cell of today's that leads there but the kept ones, so only a text that is too deep can.
- A port into a highlighter's program. The repo has none for TOML.
- Whether another order of the rules gives other tables. Where two rules name one cell, the earlier one in `rules.ts` has it, and no check lists these cells.
