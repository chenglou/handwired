# What a programmer would add next

`rules.ts` uses only the open cells of the tables as they are. This note lists the structures that a programmer would add to the parser next, in the order of what they gain for what they cost. No rule here is written. The core can add three of the structures since: the classes of 3 and 6, the bit of 4 and the open entries of 5, see `../structure/README.md`. The later arms can use the list to judge whether training finds the same structures, e.g. when an arm adds tokenizer states and one of them turns out to be "inside a string in apostrophes".

The gains are estimates from the validation split, not measurements. They come from `where-wrong.ts --split validation --causes`, which guesses the cause of each wrong sample from its first wrong code point and its kinds of damage, and counts every wrong code point of the sample for that cause. A gain is given in points of the main number, i.e. the share of the 675,949 scored code points. The hand-written rules have 96.5 points, so 3.5 are left.

The list and its order were made on the old snapshot of the dataset. The counts and the estimates below are made again on the reviewed dataset, and two entries are worth less now than they were then: the reviewed dataset gives a word such as `True` no label, so entry 2 lost most of its code points, and it no longer scores a code point before the first error. The order of the list was not made again.

Two limits on every estimate below:

- **The cells as they are hold more than the rules.** The search of `../search`, started from the hand-written tables, ends at 97.7 points with no structure added. So about 1.2 of the 3.5 points needs no structure, only cells that the rules do not have. The column "wrong, search" below says how much of each cause the search already gets. A structure is only worth what is left after it.
- **The cause of a sample is a guess.** Every wrong code point of a sample counts for the cause of its first one, and 7,751 of the rules' 23,554 wrong code points are in the two causes "another wrong depth" and "another wrong display kind or container", which no entry of the list claims.

## The list

| | structure | what it gives | validation samples with the kinds, of 5,021 broken ones | wrong code points with the rules | wrong, search from the rules' tables | estimated gain in points |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | the column of a line's first token, and the column of every open container | a closing bracket that is missing or stray in an indented text | missingCloser 181, strayCloser 64 | 6,652 | 3,523 | up to 0.5 |
| 2 | an event and a token for a word, with a display column of its own | `=` or `=>` read as a colon, a word after a string not read as a key | foreignKeySeparator 24, unescapedQuote 80 | 2,619 | 1,137 | up to 0.2 |
| 3 | a class for the apostrophe and the curly quotes, and tokenizer states for a string between them | a colon, a comma or a bracket inside such a string | singleQuotedString 333, curlyQuotes 63, quotedDocument 24 | 781 for the colon alone | 271 | under 0.1 for the colon alone |
| 4 | a bit for the grammar: the token is the first on its line | a new document after a line that was cut after a key, a colon or a comma, the next key after a colon without a value | 10 with a cut line before a document, colonWithoutValue 360, missingColon 29 | 1,445 | 631 | under 0.1 |
| 5 | open entries of the display table | the first letter of a key without quotes that starts with t, f or n | unquotedKey 256 | 800 | 906 | 0.1 |
| 6 | a class for the no-break space | indentation with no-break spaces shown as white space | nonBreakingSpace 42 | 1,414 | 1,513 | 0.2 |
| 7 | a stack action that pops twice | the depth at a closing bracket of the other kind, and after it when no comma follows | missingCloser 181, typing replays | not counted apart | not counted apart | not estimated |
| 8 | a comment state in the tokenizer | a comment with a bracket that has no partner, or with a comma and then a colon | lineComment 476, blockComment 59, hashComment 15 | not counted apart | not counted apart | under 0.1 |

Two structures of the first version of this list are gone, because the cells turned out to hold them: a cut line followed by a document on the next line (an opening brace after a complete value in the outermost object starts the object again), and the color codes of a terminal (the tokenizer state `nul` as the state after a control character). Both were in the list as "needs a structure", and a review found the cells. The same may hold for other entries: an estimate here is an upper bound on what the structure is needed for.

What is left after all eight is what a parser that reads from left to right without looking ahead cannot know: a string that is open by mistake in the middle of a line (0.16 points with the rules and with the search), a text that starts inside the document (0.10 with the rules, 0.04 with the search), a stray closer in a one-line text, an inner quote without a backslash.

## 1. The column of a line's first token

In an indented text the indentation says where a closing bracket is missing: a key that starts in the column of the keys of the container around it shows that the innermost container has ended. 93 validation samples with a missing closer and 25 with a stray one are wrong from a place on at which the brackets give no sign.

The structure: a counter for the column of the first token on each line, and a second stack with the column at which the members of each open container start. A token that is the first on its line and that starts left of the column of the innermost container pops until the columns fit. A closing bracket that would close a container whose members start left of the bracket is a stray one.

This is the most expensive structure of the list: a counter, a stack of numbers, and a comparison per line. It does nothing for a text on one line. The gain of up to 0.5 points is what the search from the rules' tables leaves of the two causes, and assumes that every missing and every stray closer in an indented text is found, so it is an upper bound. The dataset's README flags a missing and a stray closer as out of reach unless the brackets themselves show what happened, e.g. a closer of the other kind that follows.

## 2. An event and a token for a word

A word is read with the events of a string, because only those are shown as a key when the grammar expects a colon after them. So a word in a value position is shown as a string, and the grammar cannot tell a word from a string in quotes.

The structure: two events, "a word starts" and "a word goes on", with a token of their own, and a column in the display table: a key when the grammar expects a colon after the word, a literal elsewhere.

What a programmer would write with it:

- `True`, `None`, `undefined`, `NaN` shown as literals. On the old snapshot this was 0.3 points. The reviewed dataset gives such a word no label, since the highlighter has no display kind for a word that is not JSON's, so nothing is scored there any more: 32 wrong code points are left under this cause. A value without quotes that stands for a string, e.g. `production`, would be shown as a literal too, which is wrong for the kind unquotedValue.
- After a key, a word is the key's separator and value, e.g. `= "x"` or `=> nil`, and a string in quotes is the next key: 0.2 points with the rules, of which the search gets more than two thirds.
- After a complete string inside an object, a word is the rest of that string, e.g. the `Ana" on arrival"` of `"call "Ana" on arrival"`, and a string in quotes is the next key: a part of 0.2 points.

Without structure 3 the first of these costs more than it gives: every string in single quotes that is a value would be shown as a literal.

## 3. Strings in apostrophes and in curly quotes

The apostrophe and the curly quotes have the class `other`, the class of most letters. The hand-written rules read `'name'` as a word. The rules have 97.0% of the scored code points of the samples with single quotes right, because most such strings hold no colon, comma or bracket. It fails for `'2026-11-08T03:27:21Z'`, `'https://example.com'` and `'expected "}" but found "]"'`.

The structure: a class for the apostrophe, one for the two curly quotes, and per kind of quote a tokenizer state "inside the string" and one "after a backslash". The cells mirror the ones of the state `string`. An apostrophe inside a string in double quotes stays content, as today.

The gain is small in points, because the word reading already recovers most of it: the group "needs a character class" is at 92.2% with the rules and at 94.9% with the search from them. What it buys beyond the points: once these strings are strings, a word is almost always a literal or a key, which is what structure 2 needs.

A trained arm cannot find this one by adding states alone: without the class, the tokenizer cannot see an apostrophe.

## 4. The first token on its line

Today a line feed is white space, and white space gives the grammar no token. So the grammar cannot tell `"version":⏎  "license": "MIT"` from `"version": "license"`, and the hand-written rules had to pick one reading for both.

The structure: one bit, set by a line feed and cleared by the first token after it, that the grammar reads next to the token, as it reads the depth class and the kind of the innermost container. That doubles the grammar's contexts from 8 to 16.

What a programmer would write with it:

- An opening brace that is the first token on its line, after a key, a colon or a comma inside the outermost object: the line before was cut, and the brace starts a new document. After a complete value the rules do this without the bit, in the outermost object only. In a nested object the brace of `'${file}'` reads the same cell, and it is never the first token on its line, so the bit would also allow the rule there.
- A string that is the first token on its line, after a colon: the next key, shown as a key, where today a frozen cell reads it as the value. The reviewed dataset does not score that key's display kind before the first error, so little is left to gain. The catch: in the new context "first on its line", the cell (value, string) is read by valid JSON too, when a value stands on the line after its colon, e.g. `"description":⏎    "a long text"`. A rule there would change how such a valid text is shown, which breaks ground rule 1. A programmer would have to decide whether that is acceptable. The dataset's originals would show how often a value starts its own line.
- A string on the same line after a key: the key's value (a missing colon). A string on the next line after a key: the next key (a key without a colon). Today both are read as the next key.

## 5. Open entries of the display table

The core keeps the display table fixed. Some of its entries are read only after an error, as the open cells of the two other tables are: the characters of a literal or of a number when the grammar expects a colon after them. Valid JSON never has a literal or a number as a key.

With these entries open, a programmer would show them as a key. Then the `t` of `tags:` and the `n` of `name:` are keys, where today the frozen cell (between, t) starts a literal and the letter is shown as one. 203 validation samples are wrong first at such a letter, 0.1 points, and the dataset has a group for the samples in which nothing else can be right, "needs a display fix". No tables of the cells as they are get these code points: the search's tables have more of them wrong than the rules. The structure costs nothing in the parser: it only extends the search for open cells to the third table. The smoke run `display` of `../structure/README.md` shows 429 of 438 such letters as a key.

## 6. A class for the no-break space

U+00A0 has the class `other`. A text that was copied from a web page has it in the indentation. The rules read it as the start of a word, so the indentation is shown as part of the key after it. The depth and the container are right. A class that the tokenizer reads as it reads a space gives about 0.2 points for 42 samples.

## 7 and 8

- **A stack action that pops twice.** The hand-written rules get most of it with the grammar states `error` and `end` as memory, one token late. What is left is the bracket itself and the texts in which no comma follows it.
- **A comment state.** The hand-written rules read a comment as a word. That works because a comment's brackets and quotes mostly come in pairs, and because the grammar takes a word in any place. A state that skips to the line feed would be exact for `//`. For `#` it needs a class, and for `/* */` a class for the star. The tokenizer state `errorLine` is that state today, and the rules gave it up for the word state, because a word needs digits as word characters and no other state has open cells for the digits.

## What an arm with added states can and cannot find

- With added tokenizer states: a comment state (8), states of their own for what the rules put into `hex1` (after a line feed inside a string) and `nul` (after a control character), and a copy of `between` after a line feed (4). Not 3 and not 6, which need classes.
- With added grammar states: fresh states for what the rules put into `error`, `end`, and the states that no text reaches at depth 0. That should give about the same score as the hand-written rules, since the rules found a free state for each of these.
- With neither: the search from the hand-written tables is the mark, 97.7 on validation, 1.2 above the rules. An arm without added states that ends between 96.5 and 97.7 has found nothing that a plain search does not find. One that passes 97.7 has, and its cells are worth reading one by one with `differencesOf`.
