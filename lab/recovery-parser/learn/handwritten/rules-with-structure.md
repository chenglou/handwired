# What a programmer would add next

`rules.ts` uses only the open cells of the tables as they are. This note lists the structures that a programmer would add to the parser next, in the order of what they gain for what they cost. Nothing here is built. The later arms can use the list to judge whether training finds the same structures, e.g. when an arm adds tokenizer states and one of them turns out to be "inside a string in apostrophes".

The gains are estimates from the validation split, not measurements. They come from `where-wrong.ts --split validation --causes`, which guesses the cause of each wrong sample from its first wrong code point and its kinds of damage, and counts every wrong code point of the sample for that cause. A gain is given in points of the main number, i.e. the share of the 681,596 labeled code points at or after the first damage. The hand-written rules have 94.4 points, so 5.6 are left. Every number is preliminary, as the dataset is a snapshot.

## The list

| | structure | what it gives | validation samples with the kinds, of 5,203 broken ones | estimated gain in points |
| --- | --- | --- | --- | --- |
| 1 | a bit for the grammar: the token is the first on its line | a new document after a cut line, the next key after a colon without a value | 43 with a cut line before a document, colonWithoutValue 354, missingColon 26 | 1.0 |
| 2 | the column of a line's first token, and the column of every open container | a closing bracket that is missing or stray in an indented text | missingCloser 173, strayCloser 54 | up to 1.4 |
| 3 | a class for the apostrophe and the curly quotes, and tokenizer states for a string between them | a colon, a comma or a bracket inside such a string | singleQuotedString 430, curlyQuotes 64, quotedDocument 17 | 0.2 to 0.4 |
| 4 | an event and a token for a word, with a display column of its own | `True` shown as a literal, `=` or `=>` read as a colon, a word after a string not read as a key | foreignLiteral 251, foreignKeySeparator 18, unescapedQuote 67, rawLineFeedInString 63 | 0.5 to 0.8 |
| 5 | open entries of the display table | the first letter of a key without quotes that starts with t, f or n | unquotedKey 356 | 0.2 |
| 6 | a class for the no-break space | indentation with no-break spaces shown as white space | nonBreakingSpace 31 | 0.25 |
| 7 | a stack action that pops twice | the depth at a closing bracket of the other kind, and after it when no comma follows | missingCloser 173, typing replays | under 0.2 |
| 8 | a comment state in the tokenizer | a comment with a bracket that has no partner, or with a comma and then a colon | lineComment 520, blockComment 91, hashComment 21 | under 0.1 |
| 9 | a state after the escape character, and a class for the letter that ends a color code | color codes of a terminal | ansiColorCodes 10 | 0.15 |

The first six together are worth about 3.5 to 4 of the 5.6 points. The rest is out of reach for a parser that reads from left to right without looking ahead: a string that is open by mistake in the middle of a line (0.75 points), a text that starts inside the document (0.3), a stray closer in a one-line text, an inner quote without a backslash.

## 1. The first token on its line

Today a line feed is white space, and white space gives the grammar no token. So the grammar cannot tell `"version":⏎  "license": "MIT"` from `"version": "license"`, and the hand-written rules had to pick one reading for both.

The structure: one bit, set by a line feed and cleared by the first token after it, that the grammar reads next to the token, as it reads the depth class and the kind of the innermost container. That doubles the grammar's contexts from 8 to 16.

What a programmer would write with it:

- An opening brace that is the first token on its line, after a complete value or after a key inside the outermost object: the line before was cut, and the brace starts a new document. This is the largest cause that one small structure removes: 43 samples, 0.9 points. The hand-written rules read the brace as a nested object, because the same cell also reads the brace of `'${file}'`, which is never the first token on its line.
- A string that is the first token on its line, after a colon: the next key, shown as a key, where today a frozen cell reads it as the value. 0.1 points. The catch: in the new context "first on its line", the cell (value, string) is read by valid JSON too, when a value stands on the line after its colon, e.g. `"description":⏎    "a long text"`. A rule there would change how such a valid text is shown, which breaks ground rule 1. A programmer would have to decide whether that is acceptable. The dataset's originals would show how often a value starts its own line.
- A string on the same line after a key: the key's value (a missing colon). A string on the next line after a key: the next key (a key without a colon). Today both are read as the next key.

What a trained arm could do without the structure: with added tokenizer states, a second copy of the state `between` that a line feed leads to. It could give an opening brace another event there, e.g. one whose token is the tokenizer's error token, since every grammar cell of that token is open. The brace would then be shown as an error. If training finds a tokenizer state that behaves as `between` except at an opening bracket, this is it.

## 2. The column of a line's first token

In an indented text the indentation says where a closing bracket is missing: a key that starts in the column of the keys of the container around it shows that the innermost container has ended. 165 validation samples with a missing closer and 29 with a stray one are wrong from a place on at which the brackets give no sign.

The structure: a counter for the column of the first token on each line, and a second stack with the column at which the members of each open container start. A token that is the first on its line and that starts left of the column of the innermost container pops until the columns fit. A closing bracket that would close a container whose members start left of the bracket is a stray one.

This is the most expensive structure of the list: a counter, a stack of numbers, and a comparison per line. It does nothing for a text on one line, which 29% of the broken samples are, by the dataset's statistics over the samples 0 to 19,999. The gain of up to 1.4 points assumes that every missing and every stray closer in an indented text is found, so it is an upper bound.

## 3. Strings in apostrophes and in curly quotes

The apostrophe and the curly quotes have the class `other`, the class of most letters. The hand-written rules read `'name'` as a word. That is right in 95.9% of the code points of the samples with single quotes, because most such strings hold no colon, comma or bracket. It fails for `'2026-11-08T03:27:21Z'`, `'https://example.com'` and `'expected "}" but found "]"'`.

The structure: a class for the apostrophe, one for the two curly quotes, and per kind of quote a tokenizer state "inside the string" and one "after a backslash". The cells mirror the ones of the state `string`. An apostrophe inside a string in double quotes stays content, as today.

The gain is small in points, 0.2 to 0.4, because the word reading already recovers most of it. What it buys beyond the points: once these strings are strings, a word is almost always a literal or a key, which is what structure 4 needs.

A trained arm cannot find this one by adding states alone: without the class, the tokenizer cannot see an apostrophe.

## 4. An event and a token for a word

A word is read with the events of a string, because only those are shown as a key when the grammar expects a colon after them. So a word in a value position is shown as a string, and the grammar cannot tell a word from a string in quotes.

The structure: two events, "a word starts" and "a word goes on", with a token of their own, and a column in the display table: a key when the grammar expects a colon after the word, a literal elsewhere.

What a programmer would write with it:

- `True`, `None`, `undefined`, `NaN` shown as literals: 0.35 points. A value without quotes that stands for a string, e.g. `production`, would then be shown as a literal too, which is wrong for the kind unquotedValue (45 samples against 251 with foreign literals).
- After a key, a word is the key's separator and value, e.g. `= "x"` or `=> nil`, and a string in quotes is the next key: 0.2 points.
- After a complete string inside an object, a word is the rest of that string, e.g. the `Ana" on arrival"` of `"call "Ana" on arrival"`, and a string in quotes is the next key: a part of 0.3 points.

Without structure 3 the first of these costs more than it gives: every string in single quotes that is a value would be shown as a literal.

## 5. Open entries of the display table

The core keeps the display table fixed. Some of its entries are read only after an error, as the open cells of the two other tables are: the characters of a literal or of a number when the grammar expects a colon after them. Valid JSON never has a literal or a number as a key.

With these entries open, a programmer would show them as a key. Then the `t` of `tags:` and the `n` of `name:` are keys, where today the frozen cell (between, t) starts a literal and the letter is shown as one. 254 validation samples have such a first letter, 0.2 points. The structure costs nothing in the parser: it only extends the search for open cells to the third table.

## 6. A class for the no-break space

U+00A0 has the class `other`. A text that was copied from a web page has it in the indentation. The rules read it as the start of a word, so the indentation is shown as part of the key after it. The depth and the container are right. A class that the tokenizer reads as it reads a space gives 0.25 points for 31 samples.

## 7 to 9

- **A stack action that pops twice.** The hand-written rules get most of it with the grammar states `error` and `end` as memory, one token late. What is left is the bracket itself and the texts in which no comma follows it.
- **A comment state.** The hand-written rules read a comment as a word. That works because a comment's brackets and quotes mostly come in pairs, and because the grammar takes a word in any place. A state that skips to the line feed would be exact for `//`. For `#` it needs a class, and for `/* */` a class for the star. The tokenizer state `errorLine` is that state today, and the rules gave it up for the word state, because a word needs digits as word characters and no other state has open cells for the digits.
- **Color codes.** One state after the escape character, in which `[`, digits and `;` are skipped, and a class for the letters that end a code.

## What an arm with added states can and cannot find

- With added tokenizer states: a comment state (8), a state after the escape character without the class of the final letter (9, in part), a copy of `between` after a line feed (1, with the brace shown as an error). Not 3 and not 6, which need classes.
- With added grammar states: fresh states for what the rules put into `error`, `end`, and the states that no text reaches at depth 0. That should give the same score as the hand-written rules, not a higher one, since the rules found a free state for each of these.
- With neither: nothing beyond the hand-written rules is known to me. If an arm without added states scores clearly above 94.4 on validation, it found a reading that these rules miss, and its cells are worth reading one by one with `differencesOf`.
