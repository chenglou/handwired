# A recovering parser written by hand

This folder holds the recovery that a programmer writes by hand, as choices of open cells. It is the answer key that the trained arms are compared against, and the score to beat. `rules.ts` holds 32 rules. Each rule has a name, the reason a person would give for it, an example, and the cells it sets. `handwrittenTables()` returns the tables.

The rules set only open cells, to choices that the core allows. No rule adds a state or a character class. What the cells cannot express is listed below, not faked.

The rules were written from JSON's grammar and from reading samples of the train split, with `show.ts` and `where-wrong.ts`. No script picked a cell's choice by its score. The test split was never read. Every number below is preliminary, because the dataset is a snapshot under review.

## Result

On the validation split, over the labeled code points at or after the first damage, the share with all three labels right goes from 40.8% to 94.4%. On the train split it goes from 41.0% to 94.5%.

| group | broken samples | nothing to recover | all three, as it is | all three, hand-written | display kind | depth | container | whole samples |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 5203 | 368 | 40.8 | 94.4 | 47.7 → 98.1 | 74.6 → 96.0 | 88.4 → 99.3 | 11.6 → 72.0 |
| source: damage | 4061 | 285 | 37.8 | 94.0 | 45.5 → 97.9 | 72.0 → 95.8 | 87.0 → 99.2 | 9.8 → 68.3 |
| source: typing | 1142 | 83 | 59.2 | 96.9 | 61.7 → 99.3 | 90.7 → 97.2 | 97.0 → 99.6 | 18.3 → 85.4 |
| reachable: yes | 4046 | 368 | 39.9 | 97.7 | 44.9 → 98.2 | 74.8 → 99.4 | 87.4 → 99.8 | 15.1 → 78.6 |
| reachable: line rule | 652 | 0 | 60.2 | 91.8 | 66.6 → 99.3 | 90.0 → 92.4 | 98.0 → 99.7 | 1.4 → 81.1 |
| reachable: no | 505 | 0 | 20.0 | 69.0 | 44.5 → 95.2 | 50.3 → 71.5 | 83.3 → 94.3 | 0.0 → 12.5 |
| needs a class | 588 | 0 | 7.9 | 95.1 | 14.0 → 95.3 | 53.6 → 99.3 | 80.9 → 99.7 | 0.0 → 23.1 |
| needs no class | 4615 | 368 | 48.2 | 94.2 | 55.4 → 98.7 | 79.4 → 95.2 | 90.1 → 99.2 | 13.3 → 78.8 |
| debatable | 472 | 15 | 33.1 | 81.3 | 51.5 → 97.3 | 65.6 → 83.4 | 90.5 → 98.3 | 5.3 → 48.1 |
| not debatable | 4731 | 353 | 41.7 | 95.9 | 47.3 → 98.2 | 75.7 → 97.4 | 88.2 → 99.4 | 12.3 → 74.5 |
| family: half typed | 1621 | 14 | 55.5 | 96.8 | 58.2 → 99.2 | 90.3 → 97.4 | 97.1 → 99.7 | 10.8 → 83.5 |
| family: cut off | 494 | 310 | 35.3 | 64.5 | 63.0 → 99.0 | 56.8 → 65.0 | 87.1 → 95.2 | 7.1 → 52.2 |
| family: separator | 1496 | 0 | 51.2 | 97.3 | 56.4 → 98.7 | 82.7 → 98.4 | 92.0 → 99.7 | 18.9 → 84.6 |
| family: bracket | 254 | 15 | 20.0 | 60.8 | 67.5 → 97.6 | 32.4 → 61.0 | 81.7 → 94.4 | 6.7 → 15.1 |
| family: comment | 569 | 4 | 52.7 | 98.5 | 56.5 → 99.4 | 88.0 → 98.9 | 94.1 → 99.6 | 6.5 → 81.8 |
| family: other notation | 1017 | 0 | 13.8 | 95.8 | 21.7 → 96.4 | 55.4 → 99.1 | 81.0 → 99.7 | 2.8 → 35.4 |
| family: inside a string | 246 | 0 | 31.3 | 89.6 | 36.2 → 93.5 | 79.5 → 95.3 | 93.2 → 97.6 | 1.2 → 38.2 |
| family: wrapper | 643 | 25 | 38.0 | 97.7 | 48.1 → 99.1 | 59.3 → 98.2 | 69.5 → 99.4 | 6.8 → 81.9 |
| family: several documents | 165 | 0 | 39.9 | 78.7 | 55.2 → 100.0 | 58.7 → 78.7 | 78.2 → 99.3 | 4.2 → 73.9 |

The first two number columns are the main number, as it is and hand-written. The other columns show "as it is → hand-written". The held-out kinds and the held-out template are only in the test split, so they have no row here.

The ground rules hold: `check.ts` runs the 49,028 texts of the train and validation splits and finds no difference from today's parser before a first error, nor in the first error's position and kind.

## How the rules read a broken text

The tokenizer:

- **A word.** A character that starts no JSON token starts a word, and a word is read as a string without quotes. In a key position the grammar goes on to expect a colon, so the word is shown as a key, e.g. the `port` of `{port: 8080}`. Elsewhere it is shown as a string, e.g. the `production` of `"env": production`. A word ends at a colon, a comma, a bracket or a line feed. Spaces, digits and quotes are word characters.
- **The same cells read other notations**, because their characters have the class of a letter: `'single quoted'` and `“curly quoted”` strings, `ObjectId("507f")`, `&quot;id&quot;`, `\"id\"`, a `#` comment, the lines of a code fence and of a sentence around the document. This works as long as the text between the quotes holds no colon, comma or bracket.
- **A word that starts with a slash**, e.g. a comment, is a word in which a colon is a word character too, and of which the grammar sees nothing.
- **A string ends at the line feed.** The closing quote is not typed yet.
- **A literal or a number that is not complete** ends at white space, a comma, a colon or a bracket, e.g. `tru,`. Any other character turns it into a word, e.g. the `i` of `nil`.

The grammar:

- A token in a place where the grammar has no entry is read as the nearest sensible thing, e.g. a string after a complete value inside an object is the next key (a comma is missing), a closing brace after a comma closes the object (the comma was one too many), a string after a key is the next key (the first key is still being typed).
- An opening bracket always opens a container, so that its closing bracket finds it.
- After the document's end, an opening bracket starts a new document, a closing bracket pops nothing, and anything else is text around the document.
- Three rules repair the stack. A colon after a value inside a nested array closes the array. A closing bracket of the other kind inside a nested container closes it, and the comma after it closes the container around it. A member after the document's end opens the object again.

Some states get a second meaning through their open cells. No state is added, so a text that reaches one of them the old way is read by the new meaning too.

| state | meaning today | second meaning | what the second meaning costs |
| --- | --- | --- | --- |
| tokenizer `errorLine` | after a tokenizer error, up to the line feed | inside a word | nothing: every cell of the state is open |
| tokenizer `exponentSign` | after `1e+` | inside a word that starts with a slash | `1e+` followed by a space or a letter goes on as such a word. A digit in the word leads to `exponentDigits` by a frozen cell, whose frozen cells end the word at white space after the digit |
| grammar `error` | after the first error | inside a container: a closing brace closed a nested array, and the object around it still has to close. At depth 0: a comma came after the document | almost nothing: on the train and validation splits, 2 cells that no rule names lead into the state, 4 times in all, in texts with color codes at depth 16 |
| grammar `end` inside a container | no text reaches it there | a closing square bracket closed a nested object, and the array around it still has to close | nothing |
| grammar `colon`, `valueOrClose`, `commaOrClose` at depth 0 | no text reaches them there | after the document, a comma and a string. Then after the colon. Then after a string as the value | nothing |

## The rules

"Samples" is how many of the 46,492 broken texts of the train and validation splits read a cell of the rule, from the first error on. "Kept" counts open cells that a rule relies on and that hold the right choice today.

| rule | table | cells | samples | reason |
| --- | --- | --- | --- | --- |
| a word without quotes starts | tokenizer | 11 | 16,306 | A character that starts no JSON token starts a word, and a word is read as a string without quotes: a key where a key may come, a string elsewhere. |
| a word goes on | tokenizer | 24 | 16,949 | Inside a word every character but a colon, a comma, a bracket and a line feed is part of the word, spaces and quotes included, so that 'Ada Lovelace' and ObjectId("507f") are one word each. |
| a word ends at punctuation | tokenizer | 6 + 1 kept | 17,159 | A colon, a comma or a bracket ends a word and is read as itself: the colon after a key without quotes, the comma or the closing bracket after a value without quotes, the opening brace after a statement in front of the document. |
| a literal or a number turns into a word | tokenizer | 316 + 12 kept | 5,534 | A character that cannot continue a literal or a number makes the token a word, e.g. the i of nil, the a of name, the p of 12px, the second dot of 1.4.2. |
| an unfinished literal or number ends | tokenizer | 117 | 2,706 | White space, a comma, a colon or a bracket after a literal or a number that is still being typed is read as itself, and the typed characters keep their kind. |
| leading zeros | tokenizer | 2 | 652 | A digit after a leading zero continues the number. |
| a number starts with its sign or its point | tokenizer | 3 | 920 | A plus sign or a decimal point where a token may start begins a number, as a minus sign does. |
| a word that starts with a slash | tokenizer | 51 | 5,333 | A slash where a token may start begins a comment or a path. It is read as a word in which a colon is a word character too, and of which the grammar sees nothing, so that a comment leaves the grammar where it was. Brackets still count, so that a pair of them in a comment stays a pair. |
| a string ends at the line feed | tokenizer | 6 | 5,780 | A JSON string holds no raw line feed, so a line feed inside a string means that the closing quote is not typed yet: the string ends there and the line feed is white space. |
| a raw control character in a string | tokenizer | 2 | 147 | A tab or another control character inside a string is content: someone pasted the text without escaping it. |
| a backslash before any character | tokenizer | 21 | 994 | After a backslash and a character that JSON does not escape, the string goes on: the backslash was meant as a backslash. |
| a \u escape that is too short | tokenizer | 88 | 14 | A character that is no hex digit ends a \u escape, and is read as the string reads it: a quote ends the string, a backslash starts an escape, anything else is content. |
| a control character between tokens | tokenizer | 1 | 102 | A control character between tokens is skipped like white space, e.g. a NUL or an end-of-file character after the document. |
| trailing comma | grammar | 6 | 7,320 | A closing bracket right after a comma closes the container: the comma was one too many. |
| colon without a value | grammar | 6 | 2,863 | A comma or a closing brace right after a colon: the value is not typed yet, and the object goes on or ends as the character says. |
| key without a colon | grammar | 9 | 9,282 | A comma, a closing brace or another string right after a key: the key is still being typed and has no colon yet, so a string is the next key, shown as a key. |
| missing colon | grammar | 9 | 676 | A number, a literal or an opening bracket right after a key can only be the key's value: the colon is missing. |
| missing comma | grammar | 24 | 11,095 | After a complete value, the start of a token is the next entry: the next key inside an object, the next item inside an array. An opening bracket opens a container, so that its closing bracket finds it. |
| extra comma | grammar | 12 | 1,828 | A comma where an entry should start changes nothing. |
| a number or a literal as a key | grammar | 6 | 3,246 | Where a key may come, a token that starts like a number or a literal is the key, e.g. the n of a key without quotes, name, or the dots of an ellipsis. |
| no key before a colon or a container | grammar | 18 | 617 | Where a key may come, a colon is followed by the value, and an opening bracket opens a container, so that its closing bracket finds it. |
| a colon after a value | grammar | 3 | 2,436 | A colon after a complete value inside an object: the value was really the next key, e.g. after a colon without a value, so a value comes next. |
| a key inside a nested array | grammar | 2 | 619 | A colon after a value inside an array that is inside another container: only an object has keys, so the array lost its closing bracket. The colon closes the array, and the value of the key comes next. |
| a colon inside the outermost array | grammar | 1 | 56 | No object is around the outermost array, so a colon after one of its values belongs to no key and changes nothing. |
| a closing bracket of the other kind | grammar | 18 + 6 kept | 1,103 | A closing bracket of the other kind closes the innermost container: it was mistyped, or the innermost container is still being typed and the bracket is the one of the container around it. One step can pop only once, so inside a nested container the grammar remembers the bracket: the state `error` after a brace, the state `end` after a square bracket. |
| the close that is owed after a brace | grammar | 44 + 4 kept | 274 | After a closing brace closed a nested array: when the container that is now innermost is an object, the brace was its closing brace. A comma closes the object, and the next key follows in the container around it, unless the object is the outermost one: there a comma shows that the document goes on. Another closing brace closes the object, and the next container still has to close. Anything else is read as after a complete value. When the innermost container is an array, nothing is owed. |
| the close that is owed after a square bracket | grammar | 46 + 2 kept | 376 | After a closing square bracket closed a nested object: when the container that is now innermost is an array, the bracket was its closing bracket. A comma closes the array, and the next entry follows in the container around it, unless the array is the outermost one. Another closing square bracket closes the array, and the next container still has to close. Anything else is read as after a complete value. When the innermost container is an object, nothing is owed. |
| a key state inside an array | grammar | 19 + 2 kept | 31 | After the close that is owed, the grammar expects a key, but the container that it lands in may be an array. There the state reads as the state that expects a value. |
| after the document | grammar | 7 | 7,556 | After a complete top-level value, an opening bracket starts a new document, a closing bracket is a stray one and pops nothing, and any other token is text around the document. |
| the document goes on after its end | grammar | 27 + 6 kept | 1,313 | After the document, a comma, a string, a colon and a value are a member: the document was closed too early, e.g. by a stray closing bracket, or its opening brace is missing. A number or a literal as the value opens the object again. A string as the value does so at the comma after it, because a string can also be a line of text in front of a document, e.g. the fence line after "Okay, the result:". |
| before the document | grammar | 4 | 198 | Before the first value, a colon or a comma changes nothing, and a closing bracket pops nothing. |
| deeper than the maximum depth | grammar | 6 | 10 | An opening bracket at depth 16 still opens a container, so that its closing bracket finds it. |

The rules set 648 of the 710 open tokenizer cells and 267 of the 616 open grammar cells, and rely on 13 and 20 more as they are. On the train and validation splits, 3 open cells that no rule names are read, 16 times in all, by texts with color codes at depth 16.

`report.ts --without-each-rule` prints the main number without each rule. Read it with care: the cells of a rule that is left out hold today's choice, which for most grammar cells is the state `error`, and the rules give that state a meaning. So a text often recovers by accident, e.g. without "trailing comma" the main number only falls from 94.4 to 93.7.

## Per kind of damage

The validation split, the main number. A sample with several kinds is in the row of each, so a row also holds what other kinds in its samples cost.

| kind | samples | as it is | hand-written | left | why the rest is left |
| --- | --- | --- | --- | --- | --- |
| openStringAtLineEnd | 486 | 65.7 | 99.5 | 0.5 | Nothing of its own. The rest is other damage in the same samples. |
| openStringMidLine | 166 | 10.2 | 74.4 | 25.6 | Out of reach. The open string ends at the next quote, which opens the next string in the original, so every quote up to the line feed is read in the opposite role, and a bracket inside the open string is never seen. |
| keyWithoutColon | 360 | 62.9 | 99.7 | 0.3 | Nothing of its own. |
| colonWithoutValue | 354 | 62.8 | 97.2 | 2.8 | When the next key follows the colon, a frozen cell reads the key as the value, so it is shown as a string. The colon after it puts the grammar back. |
| partialLiteral | 169 | 42.3 | 99.1 | 0.9 | Nothing of its own. |
| partialNumber | 103 | 39.8 | 98.7 | 1.3 | Nothing of its own. |
| cutOff | 456 | 40.6 | 69.9 | 30.1 | 310 of the 456 samples have nothing to recover. The rest is a cut line followed by more documents, one per line: the next line's opening brace reads as a value inside the cut object, one level too deep. The rule needs to know that the brace is the first token on its line. |
| headMissing | 17 | 0.0 | 36.0 | 64.0 | The depth at the start is unknown. When the text starts at a member of the outermost object, the rule "the document goes on after its end" finds the object at the second member. Deeper starts stay wrong. |
| middleCutOut | 21 | 34.0 | 49.3 | 50.7 | Out of reach. The removed span can hold any number of brackets and quotes. |
| missingComma | 657 | 60.2 | 98.6 | 1.4 | Nothing of its own. |
| trailingComma | 809 | 45.9 | 97.6 | 2.4 | Nothing of its own. |
| extraComma | 61 | 54.9 | 99.3 | 0.7 | Nothing of its own. |
| missingColon | 26 | 67.2 | 94.4 | 5.6 | Before a string value, the string reads as the next key, because the rule for a key without a colon has the cell. It is shown as a key, and the comma after it puts the grammar back. |
| foreignKeySeparator | 18 | 2.8 | 71.6 | 28.4 | The = or => and the value after it are one word, which reads as the next key and is shown as a key. Depth and container are right. |
| missingCloser | 173 | 17.4 | 63.1 | 36.9 | Mostly out of reach without the indentation: after a removed closer the next entry reads as one more entry of the container that is still open. Recovered: a key right after an array's items, and a nested container that is still open when the bracket of the container around it comes and a comma follows. |
| strayCloser | 54 | 12.3 | 35.4 | 64.6 | A stray closer inside the document reads as a real one. Recovered: a stray closer after the document's end, and the members after a comma when the document closed too early. |
| wrongCloser | 27 | 67.0 | 100.0 | 0.0 | Nothing in this split. On the train split 88.5%: a mistyped closer of a nested container with a comma after it is read as the closer of the container around it, so two levels close where one was meant. |
| lineComment | 520 | 53.6 | 98.6 | 1.4 | A comment is a word, not a state of its own. Left: a comment with a comma and then a colon inside a nested array, where the colon closes the array, and a comment with a bracket that has no partner. |
| blockComment | 91 | 55.2 | 97.2 | 2.8 | As lineComment. The lines of a comment over several lines are words, which a key state takes as keys without a colon. |
| hashComment | 21 | 33.4 | 96.4 | 3.6 | As lineComment, and a # comment is a plain word, so its colon counts. |
| unquotedKey | 356 | 6.2 | 97.4 | 2.6 | The first letter of a key that starts with t, f or n is shown as a literal: the cell that reads it is frozen. |
| singleQuotedString | 430 | 4.4 | 95.9 | 4.1 | Read as words, since the apostrophe has no class. Left: a colon, a comma or a bracket inside the string ends the word, and True, False and None in the same texts are shown as strings. |
| curlyQuotes | 64 | 6.6 | 89.8 | 10.2 | As singleQuotedString. Most of what is left comes from the no-break spaces in the same samples. |
| nonBreakingSpace | 31 | 2.3 | 78.7 | 21.3 | A no-break space has the class of a letter, so it starts a word: the indentation is shown as part of the key that follows it. |
| foreignLiteral | 251 | 13.2 | 94.6 | 5.4 | True, None, undefined and the like are shown as strings, not as literals: a word is a string to the tokenizer, and its display kind cannot depend on where it stands. |
| unquotedValue | 45 | 26.4 | 93.4 | 6.6 | Nothing of its own. The rest is the first letter of keys without quotes, and other damage. |
| numberFormat | 64 | 29.1 | 99.9 | 0.1 | Nothing of its own. |
| callWrapper | 85 | 19.0 | 95.8 | 4.2 | ObjectId("…") is one word and shown as a string, which is right. A colon inside the call, e.g. in the time of ISODate("…T03:27:21Z"), ends the word, and the digits of NumberLong(15) are shown as a string. |
| tuple | 1 | 0.0 | 87.8 | 12.2 | One sample. The round brackets are word characters. |
| templatePlaceholder | 23 | 43.5 | 99.7 | 0.3 | Nothing of its own. |
| ellipsis | 81 | 48.7 | 99.4 | 0.6 | Nothing of its own. |
| stringConcatenation | 4 | 62.1 | 79.4 | 20.6 | Four samples. The second string reads as the next key. |
| unescapedQuote | 67 | 27.5 | 83.0 | 17.0 | Out of reach in general. The inner quote ends the string, and the text after it is a word, which reads as the next key and is shown as a key. An inner quote before a bracket, e.g. "{"id": 1}", changes the depth. |
| unescapedBackslash | 110 | 29.2 | 93.7 | 6.3 | A backslash before a letter that JSON escapes, e.g. the \t of C:\temp, is a valid escape. A backslash before the closing quote keeps the string open up to the line feed. |
| rawLineFeedInString | 63 | 34.2 | 82.8 | 17.2 | The opposite rule is in force: a string ends at the line feed. The rest of the string is a word, which reads as the next key. |
| rawTabInString | 16 | 62.7 | 99.4 | 0.6 | Nothing of its own. |
| missingOpeningQuote | 14 | 18.9 | 95.6 | 4.4 | Nothing of its own: the word runs to the comma, and its closing quote is a word character. |
| doubledQuote | 15 | 20.9 | 73.2 | 26.8 | The second quote opens a string that runs to the line feed, and swallows a bracket or a colon on its way. |
| codeFence | 285 | 66.0 | 99.4 | 0.6 | Nothing of its own. |
| proseAround | 147 | 64.5 | 98.1 | 1.9 | A sentence with a bracket or a quote that has no partner. |
| statementWrapper | 196 | 7.1 | 98.9 | 1.1 | Nothing of its own. |
| quotedDocument | 17 | 0.0 | 86.3 | 13.7 | "…" around the document: the first quote opens a string that ends at the document's first quote. '…' is a word and works. |
| byteOrderMark | 29 | 3.3 | 97.6 | 2.4 | Nothing of its own. |
| textAfterEnd | 21 | 59.1 | 96.1 | 3.9 | 17 of the 21 samples have nothing to recover. |
| ansiColorCodes | 10 | 1.2 | 0.0 | 100.0 | Out of reach, and the one kind that is worse than as it is. The [ of every color code opens an array, where today everything after the first code is an error at the same depth. A fix needs a state after the escape character, and a class for the letter that ends the code. |
| backslashEscapedDocument | 20 | 0.0 | 94.2 | 5.8 | Read as words: \"id\" is a key without quotes. Left: the \n and the indentation after it are part of the word, and a colon inside a string ends the word. |
| htmlEntities | 10 | 2.0 | 99.2 | 0.8 | Nothing of its own: &quot;id&quot; is a word. |
| newlineDelimited | 123 | 49.0 | 70.7 | 29.3 | One document per line works. What is left is the cut line of cutOff in the same samples. |
| commaSeparatedRecords | 12 | 71.8 | 100.0 | 0.0 | Nothing. |
| logLines | 30 | 2.2 | 100.0 | 0.0 | Nothing. |

## What the cells cannot express

Each entry names what is missing, the kinds of damage it would help, and how many of the 5,203 broken validation samples have these kinds. "Wrong code points" is a rough count from `where-wrong.ts --split validation --causes`, which guesses the cause of a sample from its first wrong code point. In all, 38,331 of the 681,596 labeled code points are wrong.

- **A class for the apostrophe and for the curly quotes, and a tokenizer state for a string between them.** The rules read such strings as words, which breaks at a colon, a comma or a bracket inside the string, e.g. `'2026-11-08T03:27:21Z'`. Kinds: singleQuotedString (430 samples), curlyQuotes (64), quotedDocument (17), and callWrapper (85) for the same colon. About 1,110 wrong code points for the colon alone.
- **A class for the no-break space.** It has the class of a letter, so it starts a word. Kind: nonBreakingSpace (31 samples), about 1,700 wrong code points.
- **A display kind for a word that stands for a literal.** The tokenizer does not know whether a word stands where a key or where a value may come, and the display table shows a string's events as a key or as a string only. So `True` is shown as a string. An event of its own for words, shown as a key before a colon and as a literal elsewhere, would do. Kinds: foreignLiteral (251 samples), and nonFiniteNumber in the test split. About 2,290 wrong code points.
- **Open entries of the display table.** The core keeps the display table fixed. Its entries for a literal's or a number's characters before a colon, e.g. (literalStart, colon), are read only after an error. With these open, the `t` of `tags:` could be shown as a key. Kind: unquotedKey (356 samples), about 1,200 wrong code points.
- **A token for a word, apart from the token for a string.** The grammar cannot tell `= "x"` after a key from the next key in quotes, nor a word right after a closing quote from the next key. Kinds: foreignKeySeparator (18 samples, about 1,200 wrong code points), unescapedQuote (67) and rawLineFeedInString (63) (about 2,070 for a word after a complete string).
- **A stack action that pops twice.** A closing bracket of the other kind inside a nested container should close two containers in one step. The rules close the second one at the comma after it, with the grammar states `error` and `end` as the memory. So the bracket itself keeps a wrong depth, and when no comma follows, e.g. at the end of the text, so does the rest. Kind: missingCloser (173 samples), and the typing replays in which a container is still open.
- **Whether a token is the first on its line.** A line feed is white space to the grammar. With such a bit: an opening brace at the start of a line after a cut line starts a new document (cutOff with newlineDelimited, 43 samples, about 6,070 wrong code points), the string on the next line after a colon without a value is the next key (colonWithoutValue, 354 samples, about 680 wrong code points), and a string on the same line after a key is its value (missingColon, 26 samples).
- **The column of a line's first token.** Without the indentation, a removed closing bracket leaves no sign, and a stray one reads as a real one. Kinds: missingCloser (173 samples, about 6,700 wrong code points, the largest cause that is left), strayCloser (54 samples, about 2,880).
- **A comment state.** A comment is a word, so a bracket in it counts and must have a partner, a comma ends the word, and the lines of a block comment are plain words. The one tokenizer state without frozen cells is the word state. Kinds: lineComment (520 samples), blockComment (91), hashComment (21). Little is left: the three rows are at 96.4% to 98.6%.
- **A state after the escape character**, and a class for the letter that ends a color code. The `[` of every code opens an array. Kind: ansiColorCodes (10 samples), about 980 wrong code points.
- **Memory of the character before.** A quote right after a closing quote (doubledQuote, 15 samples) and a quote right after a word character inside a string (unescapedQuote, 67) cannot be told from an ordinary quote.
- **Looking ahead.** A string that is open by mistake ends at the next quote (openStringMidLine, 166 samples, about 5,050 wrong code points). A raw line feed inside a string (rawLineFeedInString, 63) cannot be told from an open string at the end of a line when the line feed is read. A text that starts inside the document (headMissing, 17, about 1,950 wrong code points) or that lost a span (middleCutOut, 21) has an unknown depth.

`rules-with-structure.md` says which of these a programmer would add first.

## Where two readings contradict

Some cells have two sensible readings, and the cell holds one choice. In these places I counted, in the train split, how often the label agrees with each reading where the parser reads that cell, and took the more frequent one. No score was involved. The counts are from probes that are not in the repo, over the first read of the cell in each sample.

- **A string after a key, (colon, string)**: the next key, after a key without a colon, against the key's value, after a missing colon. By the forms of the damage in the train split of the first 30,000 samples: 287 against 64.
- **A closing bracket of the other kind inside a nested container**: the label is two or more levels up in 556 samples and one level up in 142. So the bracket closes the container, and the grammar remembers that the container around it still has to close.
- **The comma after such a bracket**: in a nested container the label is one level up in 140 samples and not in 20, so the comma closes the container. In the outermost container the label is never one level up, in 39 samples: a comma shows that the document goes on, so there the bracket was mistyped and nothing is owed.
- **A colon after a value inside a nested array**: the array's closing bracket is missing (the label is one level up or more in 495 samples) against a colon of a comment or of a text in single quotes, and a key after a stray closing brace (51). In the outermost array the label is never one level up, in 44 samples, so there the colon changes nothing.
- **An opening brace after a complete value inside an object**: opens a nested object, so that a pair of braces stays a pair, e.g. in `'${file}'` (the brace is string content or an added code point in 408 samples), against starts the next object in the place of the open one (the label's depth stays the same in 219). The second reading is right after a cut line, which is why cutOff with newlineDelimited stays wrong.
- **A comma after the document**: starts the sequence that can open the object again. A comma between documents is not hurt by it, because an opening bracket after the comma starts a document either way.
- **A line feed inside a string**: ends the string (openStringAtLineEnd, 9% of the samples) against is content (rawLineFeedInString, 1%).

## Commands

Run from the repo root, with `RECOVERY_SCRATCH` set to a folder outside the repo as in `../README.md`.

```sh
bun lab/recovery-parser/learn/handwritten/rules.ts          # prints the rules with their cells, saves <scratch>/handwritten/tables.json
bun lab/recovery-parser/learn/handwritten/report.ts         # validation, next to the parser as it is
bun lab/recovery-parser/learn/handwritten/report.ts --split train
bun lab/recovery-parser/learn/handwritten/check.ts          # the ground rules on train and validation, open cells that are read and that no rule names, samples per rule
bun lab/recovery-parser/learn/handwritten/where-wrong.ts --causes          # train: the cells at the first wrong code point of every sample
bun lab/recovery-parser/learn/handwritten/where-wrong.ts --split validation --causes
bun lab/recovery-parser/learn/handwritten/show.ts --kind missingCloser --wrong --cells   # samples of the train split, the parser's output under the labels
bun lab/recovery-parser/learn/score.ts --tables <scratch>/handwritten/tables.json        # the core's own scorer on the saved tables
```

`show.ts` and `where-wrong.ts` take `--split train` or `--split validation` and refuse the test split. `report.ts` reads the test split only when `--split test` names it. I never ran it so.

## Not checked

- The test split, and with it the held-out kinds (conflictMarkers, nonFiniteNumber, logPrefix, concatenated) and the held-out template.
- A port into the highlighter's program. The rules use the stack actions `pop`, `none` and `push an object` on tokens that are no brackets, which the program does not have.
- Texts outside the train and validation splits. That no other text falls into the grammar state `error` by a cell that no rule names is not proven: the rules name the cells that these two splits read, and the cells that follow from the same reasons.
- Whether another set of rules of the same size scores higher. The rules stop where reading samples stopped paying, not at a proven optimum.
- The reviewed dataset. When it replaces the snapshot, every number here has to be made again with the commands above.
