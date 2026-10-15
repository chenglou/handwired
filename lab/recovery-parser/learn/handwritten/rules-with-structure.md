# What a programmer would add next

`rules.ts` uses only the open cells of the tables as they are. This note lists the structures that a programmer would add to the parser next, in the order of what they gain for what they cost. Nothing here is built. The later arms can use the list to judge whether training finds the same structures, e.g. when an arm adds tokenizer states and one of them turns out to be "inside a string in apostrophes".

The gains are estimates from the validation split, not measurements. They come from `where-wrong.ts --split validation --causes`, which guesses the cause of each wrong sample from its first wrong code point and its kinds of damage, and counts every wrong code point of the sample for that cause. A gain is given in points of the main number, i.e. the share of the 681,596 labeled code points at or after the first damage. The hand-written rules have 95.5 points, so 4.5 are left. Every number is preliminary, as the dataset is a snapshot.

Two limits on every estimate below:

- **The cells as they are hold more than the rules.** The search of `../search`, started from the hand-written tables, ends at 96.5 points with no structure added. So about 1.0 of the 4.5 points needs no structure, only cells that the rules do not have. The column "wrong, search" below says how much of each cause the search already gets. A structure is only worth what is left after it.
- **0.6 points are out of reach for any structure that keeps the ground rules.** 4,014 of the wrong code points come before the first error, e.g. after a removed closing bracket up to the text's end. The trace before the first error is today's by ground rule 1.

## The list

| | structure | what it gives | validation samples with the kinds, of 5,203 broken ones | wrong code points with the rules | wrong, search from the rules' tables | estimated gain in points |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | the column of a line's first token, and the column of every open container | a closing bracket that is missing or stray in an indented text | missingCloser 173, strayCloser 54 | 9,054 | 6,786 | up to 1.0 |
| 2 | an event and a token for a word, with a display column of its own | `True` shown as a literal, `=` or `=>` read as a colon, a word after a string not read as a key | foreignLiteral 251, foreignKeySeparator 18, unescapedQuote 67 | 4,832 | 2,686 | 0.3 to 0.4 |
| 3 | a class for the apostrophe and the curly quotes, and tokenizer states for a string between them | a colon, a comma or a bracket inside such a string | singleQuotedString 430, curlyQuotes 64, quotedDocument 17 | 1,180 for the colon alone | 563 | 0.1 to 0.3 |
| 4 | a bit for the grammar: the token is the first on its line | a new document after a line that was cut after a key, a colon or a comma, the next key after a colon without a value | 43 with a cut line before a document, colonWithoutValue 354, missingColon 26 | 1,617 | 1,130 | under 0.2 |
| 5 | open entries of the display table | the first letter of a key without quotes that starts with t, f or n | unquotedKey 356 | 1,407 | 1,675 | 0.2 |
| 6 | a class for the no-break space | indentation with no-break spaces shown as white space | nonBreakingSpace 31 | 1,749 | 1,380 | 0.2 |
| 7 | a stack action that pops twice | the depth at a closing bracket of the other kind, and after it when no comma follows | missingCloser 173, typing replays | not counted apart | not counted apart | under 0.2 |
| 8 | a comment state in the tokenizer | a comment with a bracket that has no partner, or with a comma and then a colon | lineComment 520, blockComment 91, hashComment 21 | not counted apart | not counted apart | under 0.1 |

Two structures of the first version of this list are gone, because the cells turned out to hold them: a cut line followed by a document on the next line (an opening brace after a complete value in the outermost object starts the object again, 0.7 points), and the color codes of a terminal (the tokenizer state `nul` as the state after a control character, 0.1 points). Both were in the list as "needs a structure", and a review found the cells. The same may hold for other entries: an estimate here is an upper bound on what the structure is needed for.

What is left after all eight is what a parser that reads from left to right without looking ahead cannot know: a string that is open by mistake in the middle of a line (0.7 points with the rules, 0.6 with the search), a text that starts inside the document (0.3), a stray closer in a one-line text, an inner quote without a backslash.

## 1. The column of a line's first token

In an indented text the indentation says where a closing bracket is missing: a key that starts in the column of the keys of the container around it shows that the innermost container has ended. 165 validation samples with a missing closer and 29 with a stray one are wrong from a place on at which the brackets give no sign.

The structure: a counter for the column of the first token on each line, and a second stack with the column at which the members of each open container start. A token that is the first on its line and that starts left of the column of the innermost container pops until the columns fit. A closing bracket that would close a container whose members start left of the bracket is a stray one.

This is the most expensive structure of the list: a counter, a stack of numbers, and a comparison per line. It does nothing for a text on one line, which 29% of the broken samples are, by the dataset's statistics over the samples 0 to 19,999. The gain of up to 1.0 points assumes that every missing and every stray closer in an indented text is found, and leaves out the 0.3 points of these samples that come before the first error, so it is an upper bound.

## 2. An event and a token for a word

A word is read with the events of a string, because only those are shown as a key when the grammar expects a colon after them. So a word in a value position is shown as a string, and the grammar cannot tell a word from a string in quotes.

The structure: two events, "a word starts" and "a word goes on", with a token of their own, and a column in the display table: a key when the grammar expects a colon after the word, a literal elsewhere.

What a programmer would write with it:

- `True`, `None`, `undefined`, `NaN` shown as literals: 0.3 points with the rules. The cells hold half of this without the structure: the search sends such a word into the tokenizer state of a literal, e.g. `t`, whose frozen cells read `r`, `u`, `e`, so that all but the first letter are shown as a literal. A value without quotes that stands for a string, e.g. `production`, would be shown as a literal too, which is wrong for the kind unquotedValue (45 samples against 251 with foreign literals).
- After a key, a word is the key's separator and value, e.g. `= "x"` or `=> nil`, and a string in quotes is the next key: 0.2 points with the rules, half of which the search gets.
- After a complete string inside an object, a word is the rest of that string, e.g. the `Ana" on arrival"` of `"call "Ana" on arrival"`, and a string in quotes is the next key: a part of 0.2 points.

Without structure 3 the first of these costs more than it gives: every string in single quotes that is a value would be shown as a literal.

## 3. Strings in apostrophes and in curly quotes

The apostrophe and the curly quotes have the class `other`, the class of most letters. The hand-written rules read `'name'` as a word. That is right in 95.9% of the code points of the samples with single quotes, because most such strings hold no colon, comma or bracket. It fails for `'2026-11-08T03:27:21Z'`, `'https://example.com'` and `'expected "}" but found "]"'`.

The structure: a class for the apostrophe, one for the two curly quotes, and per kind of quote a tokenizer state "inside the string" and one "after a backslash". The cells mirror the ones of the state `string`. An apostrophe inside a string in double quotes stays content, as today.

The gain is small in points, 0.1 to 0.3, because the word reading already recovers most of it. What it buys beyond the points: once these strings are strings, a word is almost always a literal or a key, which is what structure 2 needs.

A trained arm cannot find this one by adding states alone: without the class, the tokenizer cannot see an apostrophe.

## 4. The first token on its line

Today a line feed is white space, and white space gives the grammar no token. So the grammar cannot tell `"version":⏎  "license": "MIT"` from `"version": "license"`, and the hand-written rules had to pick one reading for both.

The structure: one bit, set by a line feed and cleared by the first token after it, that the grammar reads next to the token, as it reads the depth class and the kind of the innermost container. That doubles the grammar's contexts from 8 to 16.

What a programmer would write with it:

- An opening brace that is the first token on its line, after a key, a colon or a comma inside the outermost object: the line before was cut, and the brace starts a new document. After a complete value the rules do this without the bit, in the outermost object only. In a nested object the brace of `'${file}'` reads the same cell, and it is never the first token on its line, so the bit would also allow the rule there.
- A string that is the first token on its line, after a colon: the next key, shown as a key, where today a frozen cell reads it as the value. 0.1 points. The catch: in the new context "first on its line", the cell (value, string) is read by valid JSON too, when a value stands on the line after its colon, e.g. `"description":⏎    "a long text"`. A rule there would change how such a valid text is shown, which breaks ground rule 1. A programmer would have to decide whether that is acceptable. The dataset's originals would show how often a value starts its own line.
- A string on the same line after a key: the key's value (a missing colon). A string on the next line after a key: the next key (a key without a colon). Today both are read as the next key.

## 5. Open entries of the display table

The core keeps the display table fixed. Some of its entries are read only after an error, as the open cells of the two other tables are: the characters of a literal or of a number when the grammar expects a colon after them. Valid JSON never has a literal or a number as a key.

With these entries open, a programmer would show them as a key. Then the `t` of `tags:` and the `n` of `name:` are keys, where today the frozen cell (between, t) starts a literal and the letter is shown as one. 254 validation samples have such a first letter, 0.2 points. No tables of the cells as they are get these code points: the search's tables have more of them wrong than the rules. The structure costs nothing in the parser: it only extends the search for open cells to the third table.

## 6. A class for the no-break space

U+00A0 has the class `other`. A text that was copied from a web page has it in the indentation. The rules read it as the start of a word, so the indentation is shown as part of the key after it. The depth and the container are right. A class that the tokenizer reads as it reads a space gives about 0.2 points for 31 samples.

## 7 and 8

- **A stack action that pops twice.** The hand-written rules get most of it with the grammar states `error` and `end` as memory, one token late. What is left is the bracket itself and the texts in which no comma follows it.
- **A comment state.** The hand-written rules read a comment as a word. That works because a comment's brackets and quotes mostly come in pairs, and because the grammar takes a word in any place. A state that skips to the line feed would be exact for `//`. For `#` it needs a class, and for `/* */` a class for the star. The tokenizer state `errorLine` is that state today, and the rules gave it up for the word state, because a word needs digits as word characters and no other state has open cells for the digits.

## What an arm with added states can and cannot find

- With added tokenizer states: a comment state (8), states of their own for what the rules put into `hex1` (after a line feed inside a string) and `nul` (after a control character), and a copy of `between` after a line feed (4). Not 3 and not 6, which need classes.
- With added grammar states: fresh states for what the rules put into `error`, `end`, and the states that no text reaches at depth 0. That should give about the same score as the hand-written rules, since the rules found a free state for each of these.
- With neither: the search from the hand-written tables is the mark, 96.5 on validation, 1.0 above the rules. An arm without added states that ends between 95.5 and 96.5 has found nothing that a plain search does not find. One that passes 96.5 has, and its cells are worth reading one by one with `differencesOf`.
