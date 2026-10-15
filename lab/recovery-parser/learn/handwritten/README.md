# A recovering parser written by hand

This folder holds the recovery that a programmer writes by hand, as choices of open cells. `rules.ts` holds 35 rules. Each rule has a name, the reason a person would give for it, an example, and the cells it sets. `handwrittenTables()` returns the tables.

The rules set only open cells, to choices that the core allows. No rule adds a state or a character class.

**What these tables are for.** They are a recovery that a person can read rule by rule, to compare the trained arms with. They are not the best that the open cells can hold, and their score is not the score to beat: the search of `../search`, started from these tables, changes 421 cells and ends at 96.5% on the validation split, where the rules have 95.5%. So a trained arm without added states has to pass 96.5%, not 95.5%, before its tables show something that a plain search does not find. What the search gets and the rules do not is listed under [What the rules leave](#what-the-rules-leave).

**How the rules were made.** They were written from JSON's grammar and from reading samples of the train split, with `show.ts` and `where-wrong.ts`. No script picked a cell's choice. But scores were in view the whole time:

- The train scores of hand-made variants were compared, and three variants were dropped after reading why they scored worse. One rule and one exception were added with the train score in view.
- `report.ts` scores the validation split by default, so every run of it during the writing showed validation numbers, per kind of damage too. Nine validation samples were read to write the sentences of the table per kind.
- Five rules came from a review of the first 32 rules. The review tried cells with the train and validation scores in view, so the gain of these five on the validation split is optimistic. On two other seeds of the dataset the review measured +0.56 points for the five together, against +1.12 on the validation split. They are marked in [The rules](#the-rules).
- The scripts of this folder refuse the test split. But the files of samples that the builder of the first 32 rules was told to read before writing anything hold test samples: 704 of their 3,202 samples, among them all 60 samples of each of the four kinds of damage that are held out for the test split. Which of these files were read is not recorded. So the held-out kinds count as possibly seen by these rules.

Every number below is preliminary, because the dataset is a snapshot under review.

## Result

On the validation split, over the labeled code points at or after the first damage, the share with all three labels right goes from 40.8% to 95.5%. On the train split it goes from 41.0% to 95.2%.

| group | broken samples | nothing to recover | all three, as it is | all three, hand-written | display kind | depth | container | whole samples | ceiling of all three |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 5203 | 368 | 40.8 | 95.5 | 47.7 → 98.2 | 74.6 → 96.9 | 88.4 → 99.3 | 11.6 → 73.2 | 99.4 |
| source: damage | 4061 | 285 | 37.8 | 95.3 | 45.5 → 98.1 | 72.0 → 96.9 | 87.0 → 99.2 | 9.8 → 69.7 | 99.4 |
| source: typing | 1142 | 83 | 59.2 | 96.9 | 61.7 → 99.3 | 90.7 → 97.2 | 97.0 → 99.6 | 18.3 → 85.4 | 99.4 |
| reachable: yes | 4046 | 368 | 39.9 | 98.0 | 44.9 → 98.4 | 74.8 → 99.5 | 87.4 → 99.8 | 15.1 → 79.9 | 100.0 |
| reachable: line rule | 652 | 0 | 60.2 | 98.2 | 66.6 → 99.3 | 90.0 → 98.8 | 98.0 → 99.8 | 1.4 → 81.9 | 99.2 |
| reachable: no | 505 | 0 | 20.0 | 69.3 | 44.5 → 95.5 | 50.3 → 71.7 | 83.3 → 94.0 | 0.0 → 12.5 | 94.6 |
| needs a class | 588 | 0 | 7.9 | 94.8 | 14.0 → 95.3 | 53.6 → 98.9 | 80.9 → 99.3 | 0.0 → 23.1 | 100.0 |
| needs no class | 4615 | 368 | 48.2 | 95.7 | 55.4 → 98.9 | 79.4 → 96.5 | 90.1 → 99.2 | 13.3 → 80.1 | 99.3 |
| debatable | 472 | 15 | 33.1 | 90.1 | 51.5 → 98.1 | 65.6 → 91.4 | 90.5 → 98.6 | 5.3 → 52.1 | 97.2 |
| not debatable | 4731 | 353 | 41.7 | 96.1 | 47.3 → 98.3 | 75.7 → 97.6 | 88.2 → 99.3 | 12.3 → 75.4 | 99.7 |
| family: half typed | 1621 | 14 | 55.5 | 96.9 | 58.2 → 99.2 | 90.3 → 97.5 | 97.1 → 99.7 | 10.8 → 83.7 | 99.5 |
| family: cut off | 494 | 310 | 35.3 | 84.6 | 63.0 → 99.0 | 56.8 → 85.1 | 87.1 → 95.7 | 7.1 → 52.7 | 96.4 |
| family: separator | 1496 | 0 | 51.2 | 97.3 | 56.4 → 98.7 | 82.7 → 98.4 | 92.0 → 99.7 | 18.9 → 84.7 | 99.6 |
| family: bracket | 254 | 15 | 20.0 | 62.9 | 67.5 → 97.7 | 32.4 → 63.1 | 81.7 → 94.6 | 6.7 → 15.9 | 91.0 |
| family: comment | 569 | 4 | 52.7 | 98.5 | 56.5 → 99.4 | 88.0 → 98.9 | 94.1 → 99.7 | 6.5 → 81.8 | 100.0 |
| family: other notation | 1017 | 0 | 13.8 | 95.6 | 21.7 → 96.3 | 55.4 → 98.9 | 81.0 → 99.5 | 2.8 → 35.5 | 100.0 |
| family: inside a string | 246 | 0 | 31.3 | 91.9 | 36.2 → 96.6 | 79.5 → 94.6 | 93.2 → 96.9 | 1.2 → 58.1 | 100.0 |
| family: wrapper | 643 | 25 | 38.0 | 98.8 | 48.1 → 99.3 | 59.3 → 99.3 | 69.5 → 99.7 | 6.8 → 83.7 | 100.0 |
| family: several documents | 165 | 0 | 39.9 | 96.7 | 55.2 → 100.0 | 58.7 → 96.7 | 78.2 → 99.8 | 4.2 → 73.9 | 98.7 |

The first two number columns are the main number, as it is and hand-written. The next four show "as it is → hand-written". The last column is the highest that the main number can be for any choice of the open cells: some scored code points come before the first error, where only frozen cells are read, e.g. everything after a removed closing bracket up to the text's end. The held-out kinds and the held-out template are only in the test split, so they have no row here.

Three things that these numbers do not show:

- **No error is shown any more.** Of the 56,916 code points that the damage added to the validation samples, today's parser shows 89.5% as an error, and these tables show none: 74.7% as a string, 9.3% as a key, 9.1% as white space and the rest as punctuation, numbers and other kinds. No validation sample shows an error anywhere from its first damage on. The score does not see this, since an added code point has no label. `valid` and the first error are still today's, so a page can still report the first error, but nothing in the text is marked as wrong. Whether a recovering highlighter should mark the damage is an open question, see `../README.md`.
- **Some texts get worse.** On the train split, 430 of the 41,289 broken samples lose a code point that today's parser gets right, and 137 of them lose more than they gain: 7,822 code points lost against 2,962,677 gained. On the validation split 54 samples lose a code point and 15 lose more than they gain (691 lost, 373,499 gained). `worse.ts` lists them by the cells at the first lost code point. The main sources: the tokenizer's wait after a line feed inside a string, which keeps a string open that an inner quote without a backslash closed by accident (52 train samples, 2,678 code points); a string after a key that is read as the next key when it is the key's value (106 samples, 1,405 code points); and the comma that closes a second container after a closing bracket of the other kind, when that bracket was only mistyped (10 samples, 873 code points).
- **Valid JSON that is too deep.** A valid JSON text of 17 levels or more has a first error, so its rest may be shown otherwise than today. The rules keep its depth right at every code point, as today's parser does: `check.ts` runs 300 such texts. The first 32 rules had the depth wrong at 21% of the code points after the 17th bracket, because they closed a container at a comma or a colon by the kind at level 16, which is not the innermost container above 16 levels.

The ground rules hold: `check.ts` runs the 49,028 texts of the train and validation splits and finds no difference from today's parser before a first error, nor in the first error's position and kind.

## How the rules read a broken text

The tokenizer:

- **A word.** A character that starts no JSON token starts a word, and a word is read as a string without quotes. In a key position the grammar goes on to expect a colon, so the word is shown as a key, e.g. the `port` of `{port: 8080}`. Elsewhere it is shown as a string, e.g. the `production` of `"env": production`. A word ends at a colon, a comma, a bracket or a line feed. Spaces, digits and quotes are word characters.
- **The same cells read other notations**, because their characters have the class of a letter: `'single quoted'` and `“curly quoted”` strings, `ObjectId("507f")`, `&quot;id&quot;`, `\"id\"`, a `#` comment, the lines of a code fence and of a sentence around the document. This works as long as the text between the quotes holds no colon, comma or bracket.
- **A word that starts with a slash**, e.g. a comment, is a word in which a colon is a word character too, and of which the grammar sees nothing.
- **A line feed inside a string** is white space, and the tokenizer waits for the next line. A quote there starts the next string, and a bracket is read as itself: the closing quote was not typed yet. Any other character goes on with the string: the line feed was pasted into it.
- **A literal or a number that is not complete** ends at white space, a comma, a colon or a bracket, e.g. `tru,`. Any other character turns it into a word, e.g. the `i` of `nil`.
- **After a control character between tokens**, an opening square bracket, digits and characters without a class of their own are skipped, e.g. the `[34;1m` of a terminal's color code.

The grammar:

- A token in a place where the grammar has no entry is read as the nearest sensible thing, e.g. a string after a complete value inside an object is the next key (a comma is missing), a closing brace after a comma closes the object (the comma was one too many), a string after a key is the next key (the first key is still being typed).
- An opening bracket opens a container, so that its closing bracket finds it. The one exception: an opening brace after a complete value in the outermost object starts that object again, e.g. after a line that was cut off.
- After the document's end, an opening bracket starts a new document, a closing bracket pops nothing, and anything else is text around the document.
- Four rules repair the stack. A colon after a value inside an array closes the array. A closing bracket of the other kind inside a nested container closes it, and the comma after it closes the container around it. A closing bracket that closes the outermost container where the grammar did not expect it leaves the grammar ready for a comma, which opens the object again. A member after the document's end opens the object again.

Some states get a second meaning through their open cells. No state is added, so a text that reaches one of them the old way is read by the new meaning too.

| state | meaning today | second meaning | what the second meaning costs |
| --- | --- | --- | --- |
| tokenizer `errorLine` | after a tokenizer error, up to the line feed | inside a word | nothing: every cell of the state is open |
| tokenizer `exponentSign` | after `1e+` | inside a word that starts with a slash | `1e+` followed by a space or a letter goes on as such a word. A digit in the word leads to `exponentDigits` by a frozen cell, whose frozen cells end the word at white space after the digit |
| tokenizer `hex1` | after `\u` and three hex digits | after a line feed inside a string | a line that goes on with the string and starts with a hex digit, e.g. with a `d`, shows that character as an escape. A quote after `\u` and three hex digits starts a string, where it should end one |
| tokenizer `nul` | after the letters `nul` | after a control character between tokens | `nul` followed by a digit or by a character without a class is skipped as white space. An `l` after a control character is shown as a literal |
| grammar `error` | after the first error | inside a container: a closing brace closed a nested array, and the object around it still has to close. At depth 0: a comma came after the document | almost nothing: on the train and validation splits, one cell that no rule names leads into the state, twice in all, in texts at depth 16 |
| grammar `end` inside a container | no text reaches it there | a closing square bracket closed a nested object, and the array around it still has to close | nothing |
| grammar `colon`, `valueOrClose`, `commaOrClose` at depth 0 | no text reaches them there | after the document, a comma and a string. Then after the colon. Then after a string as the value, or after a closing bracket that may be one too many | nothing |

## The rules

"Samples" is how many of the 46,492 broken texts of the train and validation splits read a cell of the rule, from the first error on. "Kept" counts open cells that a rule relies on and that hold the right choice today.

| rule | table | cells | samples | reason |
| --- | --- | --- | --- | --- |
| a word without quotes starts | tokenizer | 11 | 15,912 | A character that starts no JSON token starts a word, and a word is read as a string without quotes: a key where a key may come, a string elsewhere. |
| a word goes on | tokenizer | 24 | 16,485 | Inside a word every character but a colon, a comma, a bracket and a line feed is part of the word, spaces and quotes included, so that 'Ada Lovelace' and ObjectId("507f") are one word each. |
| a word ends at punctuation | tokenizer | 6 + 1 kept | 16,668 | A colon, a comma or a bracket ends a word and is read as itself: the colon after a key without quotes, the comma or the closing bracket after a value without quotes, the opening brace after a statement in front of the document. |
| a literal or a number turns into a word | tokenizer | 311 + 12 kept | 5,406 | A character that cannot continue a literal or a number makes the token a word, e.g. the i of nil, the a of name, the p of 12px, the second dot of 1.4.2. |
| an unfinished literal or number ends | tokenizer | 116 | 2,620 | White space, a comma, a colon or a bracket after a literal or a number that is still being typed is read as itself, and the typed characters keep their kind. |
| leading zeros | tokenizer | 2 | 651 | A digit after a leading zero continues the number. |
| a number starts with its sign or its point | tokenizer | 3 | 918 | A plus sign or a decimal point where a token may start begins a number, as a minus sign does. |
| a word that starts with a slash | tokenizer | 51 | 5,321 | A slash where a token may start begins a comment or a path. It is read as a word in which a colon is a word character too, and of which the grammar sees nothing, so that a comment leaves the grammar where it was. Brackets still count, so that a pair of them in a comment stays a pair. |
| a line feed inside a string | tokenizer | 5 | 5,777 | A JSON string holds no raw line feed. A line feed inside a string is white space, and the tokenizer waits for the first character of the next line, which says what the line feed was, see the next rule. After a backslash or inside a \u escape the string ends at the line feed. |
| the line after a line feed inside a string | tokenizer | 23 | 5,758 | After a line feed inside a string, white space is skipped. Then a quote starts the next string and a bracket is read as itself: the closing quote of the string before was not typed yet. Any other character goes on with the string: the line feed was pasted into it. |
| a raw control character in a string | tokenizer | 2 | 146 | A tab or another control character inside a string is content: someone pasted the text without escaping it. |
| a backslash before any character | tokenizer | 21 | 995 | After a backslash and a character that JSON does not escape, the string goes on: the backslash was meant as a backslash. |
| a \u escape that is too short | tokenizer | 66 | 14 | A character that is no hex digit ends a \u escape of fewer than three hex digits, and is read as the string reads it: a quote ends the string, a backslash starts an escape, anything else is content. After three hex digits the tokenizer is in the state that also waits after a line feed inside a string, and is read by that rule. |
| a control character between tokens | tokenizer | 7 | 103 | A control character between tokens is skipped like white space, e.g. a NUL or an end-of-file character after the document. An escape character starts a color code of a terminal, e.g. ␛[34;1m, so after a control character an opening square bracket, digits and characters without a class of their own are skipped too, and a quote starts a string. |
| trailing comma | grammar | 5 | 5,039 | A closing bracket right after a comma closes the container: the comma was one too many. |
| colon without a value | grammar | 5 | 2,454 | A comma or a closing brace right after a colon: the value is not typed yet, and the object goes on or ends as the character says. |
| key without a colon | grammar | 8 | 7,369 | A comma, a closing brace or another string right after a key: the key is still being typed and has no colon yet, so a string is the next key, shown as a key. |
| missing colon | grammar | 9 | 654 | A number, a literal or an opening bracket right after a key can only be the key's value: the colon is missing. |
| missing comma | grammar | 23 | 10,169 | After a complete value, the start of a token is the next entry: the next key inside an object, the next item inside an array. An opening bracket opens a container, so that its closing bracket finds it. |
| an opening brace after a value in the outermost object | grammar | 1 | 413 | An opening brace after a complete value in the outermost object starts the object again: the line before was cut off and a new document follows, e.g. one document per line. The stack stays as it is, so the new object takes the place of the one that was cut. In a nested object the brace opens an object, so that a pair of braces stays a pair, e.g. in '${file}'. |
| extra comma | grammar | 12 | 1,833 | A comma where an entry should start changes nothing. |
| a number or a literal as a key | grammar | 6 | 3,239 | Where a key may come, a token that starts like a number or a literal is the key, e.g. the n of a key without quotes, name, or the dots of an ellipsis. |
| no key before a colon or a container | grammar | 18 | 586 | Where a key may come, a colon is followed by the value, and an opening bracket opens a container, so that its closing bracket finds it. |
| a colon after a value | grammar | 3 | 2,392 | A colon after a complete value inside an object: the value was really the next key, e.g. after a colon without a value, so a value comes next. |
| a key inside a nested array | grammar | 2 | 605 | A colon after a value inside an array that is inside another container: only an object has keys, so the array lost its closing bracket. The colon closes the array, and the value of the key comes next. |
| a colon inside the outermost array | grammar | 1 | 56 | No object is around the outermost array, so a colon after one of its values belongs to no key: the opening bracket was no real one, e.g. the [ of a sentence in front of the document. The colon closes the array, and what follows is read as after the document. |
| a closing bracket of the other kind | grammar | 16 + 6 kept | 898 | A closing bracket of the other kind closes the innermost container: it was mistyped, or the innermost container is still being typed and the bracket is the one of the container around it. One step can pop only once, so inside a nested container the grammar remembers the bracket: the state `error` after a brace, the state `end` after a square bracket. |
| a closing bracket that may be one too many | grammar | 5 | 6,273 | A closing bracket that closes the outermost container where the grammar did not expect that bracket may be one too many: a closing brace after a comma, after a key or after a colon, and a closing bracket of the other kind after a complete value. The grammar then expects a comma or a closing bracket at depth 0, where the rule `the document goes on after its end` lets a comma open the object again at once. When no comma follows, the document has ended. |
| the close that is owed after a brace | grammar | 44 + 4 kept | 272 | After a closing brace closed a nested array: when the container that is now innermost is an object, the brace was its closing brace. A comma closes the object, and the next key follows in the container around it, unless the object is the outermost one: there a comma shows that the document goes on. Another closing brace closes the object, and the next container still has to close. Anything else is read as after a complete value. When the innermost container is an array, nothing is owed. |
| the close that is owed after a square bracket | grammar | 46 + 2 kept | 377 | After a closing square bracket closed a nested object: when the container that is now innermost is an array, the bracket was its closing bracket. A comma closes the array, and the next entry follows in the container around it, unless the array is the outermost one. Another closing square bracket closes the array, and the next container still has to close. Anything else is read as after a complete value. When the innermost container is an object, nothing is owed. |
| a key state inside an array | grammar | 19 + 2 kept | 34 | After the close that is owed, the grammar expects a key, but the container that it lands in may be an array. There the state reads as the state that expects a value. |
| after the document | grammar | 7 | 7,661 | After a complete top-level value, an opening bracket starts a new document, a closing bracket is a stray one and pops nothing, and any other token is text around the document. |
| the document goes on after its end | grammar | 27 + 6 kept | 1,868 | After the document, a comma, a string, a colon and a value are a member: the document was closed too early, e.g. by a stray closing bracket, or its opening brace is missing. A number or a literal as the value opens the object again. A string as the value does so at the comma after it, because a string can also be a line of text in front of a document, e.g. the fence line after "Okay, the result:". |
| before the document | grammar | 4 | 199 | Before the first value, a colon or a comma changes nothing, and a closing bracket pops nothing. |
| deeper than the maximum depth | grammar | 6 | 2 | An opening bracket at depth 16 still opens a container, so that its closing bracket finds it. Above 16 levels the stack keeps no kinds, so there the rules that close a container at a comma or a colon do not close it: the depth stays a count of brackets, as it is today for a valid JSON text that is too deep. |

The rules set 648 of the 710 open tokenizer cells and 267 of the 616 open grammar cells, and rely on 13 and 20 more as they are. On the train and validation splits, the exact parser reads 421 of the 915 cells that differ from today's. One open cell that no rule names is read, twice in all, at depth 16.

Five of the rules came from the review, with what each adds on the train split when it alone is put on top of the first 32 rules (94.54% there, 94.38% on validation):

| rule | cells that changed | train, code points | validation, code points |
| --- | --- | --- | --- |
| an opening brace after a value in the outermost object | 1 | +15,821 | +4,532 |
| a closing bracket that may be one too many | 5 | +7,412 | +849 |
| a line feed inside a string, and the line after it | 9 | +5,304 | +833 |
| a control character between tokens | 7 | +4,214 | +753 |
| a colon inside the outermost array | 1 | +3,377 | +569 |
| the five together | 23 | +35,657 (95.20%) | +7,622 (95.49%) |

The brace cell's gain on the validation split is large because 43 validation samples have a cut line before a document. The change that keeps the depth of a too deep text right (no close at a comma or a colon in the contexts of depth 16) moves no code point of either split.

`report.ts --without-each-rule` prints the main number without each rule. Read it with care: the cells of a rule that is left out hold today's choice, which for most grammar cells is the state `error`, and the rules give that state a meaning. So a text often recovers by accident, e.g. without "trailing comma" the main number only falls from 95.5 to 95.0.

## Per kind of damage

The validation split, the main number. A sample with several kinds is in the row of each, so a row also holds what other kinds in its samples cost. The search's column is the search of `../search` started from these tables: where it is higher, the cells can hold more than the rules do.

| kind | samples | as it is | hand-written | search from the hand-written tables | what the rules leave |
| --- | --- | --- | --- | --- | --- |
| openStringAtLineEnd | 486 | 65.7 | 99.5 | 99.5 | Nothing of its own. The rest is other damage in the same samples. |
| openStringMidLine | 166 | 10.2 | 75.4 | 78.1 | The open string ends at the next quote, which opens the next string in the original, so every quote up to the line feed is read in the opposite role, and a bracket inside the open string is never seen. |
| keyWithoutColon | 360 | 62.9 | 99.7 | 99.7 | Nothing of its own. |
| colonWithoutValue | 354 | 62.8 | 97.6 | 97.9 | When the next key follows the colon, a frozen cell reads the key as the value, so it is shown as a string. The colon after it puts the grammar back. |
| partialLiteral | 169 | 42.3 | 99.2 | 99.7 | Nothing of its own. |
| partialNumber | 103 | 39.8 | 98.7 | 98.7 | Nothing of its own. |
| cutOff | 456 | 40.6 | 94.5 | 96.1 | 310 of the 456 samples have nothing to recover. A line that is cut after a complete value or inside a string value, followed by a document on the next line, is read by the rule for an opening brace after a value in the outermost object. Left: a line that is cut after a key, a colon or a comma, where the brace on the next line still opens a nested object. |
| headMissing | 17 | 0.0 | 36.0 | 41.0 | The depth at the start is unknown. When the text starts at a member of the outermost object, the rule "the document goes on after its end" finds the object at the second member. Deeper starts stay wrong. |
| middleCutOut | 21 | 34.0 | 50.1 | 51.7 | The removed span can hold any number of brackets and quotes. |
| missingComma | 657 | 60.2 | 98.6 | 99.0 | Nothing of its own. |
| trailingComma | 809 | 45.9 | 97.6 | 97.7 | Nothing of its own. |
| extraComma | 61 | 54.9 | 99.3 | 99.6 | Nothing of its own. |
| missingColon | 26 | 67.2 | 94.4 | 94.4 | Before a string value, the string reads as the next key, because the rule for a key without a colon has the cell. It is shown as a key, and the comma after it puts the grammar back. |
| foreignKeySeparator | 18 | 2.8 | 71.6 | 86.8 | The = or => and the value after it are one word, which reads as the next key and is shown as a key. Depth and container are right. The search gets 15.2 points more, so the cells can hold a rule that is missing here. |
| missingCloser | 173 | 17.4 | 63.1 | 69.4 | After a removed closer the next entry reads as one more entry of the container that is still open, and only the indentation says otherwise. Recovered: a key right after an array's items, and a nested container that is still open when the bracket of the container around it comes and a comma follows. A tenth of what is scored in these samples comes before the first error, where no cell changes it. The search gets 6.3 points more, so the cells can hold a rule that is missing here. |
| strayCloser | 54 | 12.3 | 47.2 | 71.3 | A stray closer inside a nested container reads as a real one. Recovered: a stray closer after the document's end, a closer of the outermost container that the grammar did not expect when a comma follows it, and the members after a comma when the document closed too early. The search gets 24.1 points more, so the cells can hold a rule that is missing here. |
| wrongCloser | 27 | 67.0 | 100.0 | 98.2 | Nothing in this split. On the train split 90.0%: a mistyped closer of a nested container with a comma after it is read as the closer of the container around it, so two levels close where one was meant. |
| lineComment | 520 | 53.6 | 98.7 | 98.8 | A comment is a word, not a state of its own. Left: a comment with a comma and then a colon inside a nested array, where the colon closes the array, and a comment with a bracket that has no partner. |
| blockComment | 91 | 55.2 | 97.2 | 96.7 | As lineComment. The lines of a comment over several lines are words, which a key state takes as keys without a colon. |
| hashComment | 21 | 33.4 | 96.4 | 99.5 | As lineComment, and a # comment is a plain word, so its colon counts. |
| unquotedKey | 356 | 6.2 | 97.0 | 97.8 | The first letter of a key that starts with t, f or n is shown as a literal: the cell that reads it is frozen. |
| singleQuotedString | 430 | 4.4 | 95.5 | 97.2 | Read as words, since the apostrophe has no class. Left: a colon, a comma or a bracket inside the string ends the word, and True, False and None in the same texts are shown as strings. |
| curlyQuotes | 64 | 6.6 | 89.5 | 91.4 | As singleQuotedString. Most of what is left comes from the no-break spaces in the same samples. |
| nonBreakingSpace | 31 | 2.3 | 78.2 | 82.8 | A no-break space has the class of a letter, so it starts a word: the indentation is shown as part of the key that follows it. |
| foreignLiteral | 251 | 13.2 | 94.6 | 97.3 | True, None, undefined and the like are shown as strings, not as literals: a word is read with a string's events. The search shows all but the first letter of such a word as a literal, by a literal's tokenizer states. |
| unquotedValue | 45 | 26.4 | 93.4 | 97.7 | Nothing of its own. The rest is the first letter of keys without quotes, and other damage. |
| numberFormat | 64 | 29.1 | 99.9 | 99.7 | Nothing of its own. |
| callWrapper | 85 | 19.0 | 95.8 | 97.4 | ObjectId("…") is one word and shown as a string, which is right. A colon inside the call, e.g. in the time of ISODate("…T03:27:21Z"), ends the word, and the digits of NumberLong(15) are shown as a string. |
| tuple | 1 | 0.0 | 87.8 | 89.9 | One sample. The round brackets are word characters. |
| templatePlaceholder | 23 | 43.5 | 99.7 | 93.1 | Nothing of its own. The search loses 6.6 points here. |
| ellipsis | 81 | 48.7 | 99.2 | 99.3 | Nothing of its own. |
| stringConcatenation | 4 | 62.1 | 79.4 | 89.4 | Four samples. The second string reads as the next key. The search gets 10.0 points more, so the cells can hold a rule that is missing here. |
| unescapedQuote | 67 | 27.5 | 81.9 | 86.1 | The inner quote ends the string, and the text after it is a word, which reads as the next key and is shown as a key. An inner quote before a bracket, e.g. "{"id": 1}", changes the depth. |
| unescapedBackslash | 110 | 29.2 | 94.3 | 94.3 | A backslash before a letter that JSON escapes, e.g. the \t of C:\temp, is a valid escape. A backslash before the closing quote keeps the string open up to the line feed. |
| rawLineFeedInString | 63 | 34.2 | 93.5 | 92.9 | The tokenizer waits after the line feed, and text on the next line goes on with the string. Left: a next line that starts with a quote or a bracket, and the first character of a next line that is a hex digit, which is shown as an escape. |
| rawTabInString | 16 | 62.7 | 99.4 | 99.4 | Nothing of its own. |
| missingOpeningQuote | 14 | 18.9 | 95.6 | 95.6 | Nothing of its own: the word runs to the comma, and its closing quote is a word character. |
| doubledQuote | 15 | 20.9 | 73.2 | 80.6 | The second quote opens a string that swallows a bracket or a colon on its way to the end of the line. The search gets 7.4 points more, so the cells can hold a rule that is missing here. |
| codeFence | 285 | 66.0 | 99.9 | 99.9 | Nothing of its own. |
| proseAround | 147 | 64.5 | 100.0 | 100.0 | Nothing of its own. |
| statementWrapper | 196 | 7.1 | 98.9 | 98.7 | Nothing of its own. |
| quotedDocument | 17 | 0.0 | 86.3 | 96.3 | "…" around the document: the first quote opens a string that ends at the document's first quote. '…' is a word and works. The search gets 10.0 points more, so the cells can hold a rule that is missing here. |
| byteOrderMark | 29 | 3.3 | 97.6 | 98.2 | Nothing of its own. |
| textAfterEnd | 21 | 59.1 | 96.1 | 96.1 | 17 of the 21 samples have nothing to recover. |
| ansiColorCodes | 10 | 1.2 | 76.7 | 89.9 | After the escape character, the bracket, the digits and the letter that ends the code are skipped. Left: a number right after a code is skipped too, and a literal there is read as a word, e.g. the true of ␛[33mtrue. The search gets 13.2 points more, so the cells can hold a rule that is missing here. |
| backslashEscapedDocument | 20 | 0.0 | 94.2 | 97.0 | Read as words: \"id\" is a key without quotes. Left: the \n and the indentation after it are part of the word, and a colon inside a string ends the word. |
| htmlEntities | 10 | 2.0 | 99.2 | 93.6 | Nothing of its own: &quot;id&quot; is a word. The search loses 5.6 points here. |
| newlineDelimited | 123 | 49.0 | 95.5 | 97.5 | One document per line works, also after a line that was cut after a complete value. What is left is the cut line of cutOff in the same samples. |
| commaSeparatedRecords | 12 | 71.8 | 100.0 | 99.4 | Nothing. |
| logLines | 30 | 2.2 | 100.0 | 100.0 | Nothing. |

## What the rules leave

30,709 of the 681,596 labeled code points of the validation split are wrong, 4.5 points. They fall into three groups.

**Before the first error: 4,014 code points, 0.6 points.** Only frozen cells are read there, so no choice of the open cells changes them. E.g. after a removed closing bracket the depth is one too high up to the text's end, and the first error is only there. 328 of the 4,835 samples with something to recover hold such a code point and can never be right as a whole.

**Within reach of the cells, and not in the rules: at least 1.0 points.** The search from these tables has 23,552 wrong code points, 7,157 fewer. `where-wrong.ts --causes` guesses the cause of each wrong sample from its first wrong code point and counts every wrong code point of the sample for that cause, so the counts are rough:

| cause | wrong, hand-written | wrong, search from the hand-written tables |
| --- | --- | --- |
| a closing bracket that is missing, with no sign of it but the indentation | 6,697 | 5,503 |
| a bracket, a colon or a comma inside a string that is open by mistake | 4,876 | 4,030 |
| a stray closing bracket inside the document | 2,357 | 1,283 |
| a word for a literal, shown as a string | 2,250 | 1,037 |
| a text that starts inside the document | 1,954 | 1,802 |
| another wrong display kind or container | 1,829 | 1,538 |
| another wrong depth | 1,784 | 1,501 |
| a no-break space read as a letter | 1,749 | 1,380 |
| the first letter of a key without quotes, shown as a literal | 1,407 | 1,675 |
| a word after a complete string, read as the next key | 1,385 | 1,092 |
| `=` or `=>` in the place of a colon | 1,197 | 557 |
| a colon inside a word | 1,180 | 563 |
| a cut line, then a document on the next line | 934 | 515 |
| the next key after a colon without a value, shown as a string | 683 | 615 |
| color codes of a terminal | 229 | 99 |
| a raw line feed inside a string | 198 | 362 |

For most of these I have no rule that I can state, only tables that do better. Two that can be read off the search's tables: a word such as `True` is sent into the tokenizer state of a literal, e.g. `t`, whose frozen cells read `r`, `u`, `e`, so that all but its first letter are shown as a literal. And after `=>` the value in quotes is shown as a string, where the rules show it as a key.

The search's tables are not better in every way: they have 68.3% of the samples right as a whole, where the rules have 73.2%, and they cannot be read rule by rule.

**What no tables of these cells got right in any run so far.** Each entry names what is missing:

- **A class for the apostrophe and for the curly quotes, and a tokenizer state for a string between them.** Such strings are read as words, which breaks at a colon, a comma or a bracket inside the string, e.g. `'2026-11-08T03:27:21Z'`.
- **A class for the no-break space.** It has the class of a letter, so it starts a word. The search gets a part of these code points, not most.
- **Open entries of the display table.** The core keeps the display table fixed. The first letter of a key without quotes that starts with `t`, `f` or `n` is read by a frozen cell as the start of a literal, and the display table shows a literal's start as a literal whatever the grammar expects.
- **A stack action that pops twice.** A closing bracket of the other kind inside a nested container should close two containers in one step. The rules close the second one at the comma after it, so the bracket itself keeps a wrong depth, and when no comma follows, so does the rest.
- **The column of a line's first token.** Without the indentation, a removed closing bracket leaves no sign, and a stray one inside a nested container reads as a real one.
- **Memory of the character before, and looking ahead.** A quote right after a closing quote, a quote right after a word character inside a string, and a string that is open by mistake in the middle of a line cannot be told from the ordinary case when they are read.

`rules-with-structure.md` says which structures a programmer would add first.

## Where two readings contradict

Some cells have two sensible readings, and the cell holds one choice. `two-readings.ts` counts, in the train split, what the labels say at the first code point of each sample that reads such a cell. A count says what the labels want at one cell, not what a choice is worth: a choice also changes what the parser reads afterwards, and an added code point has no label and still moves the parser. So where the counts are close or most readers are added code points, the train score decided, and the entry says so.

- **A string after a key, (colon, string)**: the next key, after a key without a colon, against the key's value, after a missing colon. The label is a key in 1,851 samples at depth 1 and a string in 89, and 1,252 against 104 in a nested object. So the string is the next key.
- **A closing bracket of the other kind inside a nested container**: the label is two or more levels up in 545 samples, one level up in 142, and not higher in 28. So the bracket closes the container, and the grammar remembers that the container around it still has to close.
- **The comma after such a bracket**: in a nested container of the remembered kind the label is one level up in 138 samples and not in 27, so the comma closes the container. In the outermost container the label is never one level up: it keeps the depth in 72 samples and is deeper in 13. A comma there shows that the document goes on, so the bracket was mistyped and nothing is owed.
- **A colon after a value inside a nested array** (depth 2 to 15): the label is one level up or more in 481 samples (the array's closing bracket is missing), against 16 in which it is one level down, 27 added colons and 8 that are no punctuation in the original, e.g. the colon of a comment or of a text in single quotes. So the colon closes the array.
- **A colon after a value inside the outermost array**: 32 of the 44 samples that read the cell do so at an added colon, e.g. the colon of `Fields marked [optional may be null:` in front of a document, and no label asks for a close. The train score decided: closing the array there gets 3,377 more code points right than leaving it open, because the bracket of such a sentence was never a real one.
- **An opening brace after a complete value inside the outermost object**: the label keeps the depth in 175 samples (the brace starts the object again, e.g. after a cut line), goes one deeper in 12, and in 172 the brace is string content or an added code point, e.g. in `'${file}'`, where a nested object keeps the pair of braces a pair. The two readings are level by samples, and the train score decided: starting the object again gets 15,821 more code points right.
- **An opening brace after a complete value inside a nested object**: the brace is string content or an added code point in 234 samples, the label keeps the depth in 44 and goes one deeper in 3. So the brace opens a nested object. The review measured the other choice in every object at 16,497 code points fewer on the train split.
- **A comma after the document**: starts the sequence that can open the object again. A comma between documents is not hurt by it, because an opening bracket after the comma starts a document either way.
- **A line feed inside a string**: ends the string when the next line starts with a quote or a bracket (openStringAtLineEnd, 9% of the samples), and is content otherwise (rawLineFeedInString, 1%).

## Commands

Run from the repo root, with `RECOVERY_SCRATCH` set to a folder outside the repo as in `../README.md`.

```sh
bun lab/recovery-parser/learn/handwritten/rules.ts          # prints the rules with their cells, saves <scratch>/handwritten/tables.json
bun lab/recovery-parser/learn/handwritten/report.ts         # validation, next to the parser as it is
bun lab/recovery-parser/learn/handwritten/report.ts --split train
bun lab/recovery-parser/learn/handwritten/check.ts          # the ground rules on train and validation, open cells that are read and that no rule names, samples per rule, texts that are too deep
bun lab/recovery-parser/learn/handwritten/where-wrong.ts --causes          # train: the cells at the first wrong code point of every sample
bun lab/recovery-parser/learn/handwritten/where-wrong.ts --split validation --causes
bun lab/recovery-parser/learn/handwritten/worse.ts          # train: the samples that lose code points against the parser as it is
bun lab/recovery-parser/learn/handwritten/two-readings.ts   # train: what the labels say at the cells with two readings
bun lab/recovery-parser/learn/handwritten/show.ts --kind missingCloser --wrong --cells   # samples of the train split, the parser's output under the labels
bun lab/recovery-parser/learn/score.ts --tables <scratch>/handwritten/tables.json        # the core's own scorer on the saved tables
bun lab/recovery-parser/learn/search/search.ts --from <scratch>/handwritten/tables.json  # the search from these tables, about 100 s
```

`show.ts`, `where-wrong.ts`, `worse.ts` and `two-readings.ts` read the train split, or the validation split with `--split validation`, and refuse the test split. `report.ts` reads the test split only when `--split test` names it. It was never run so.

## Not checked

- The test split, and with it the held-out kinds (conflictMarkers, nonFiniteNumber, logPrefix, concatenated) and the held-out template.
- A port into the highlighter's program. The rules use the stack actions `pop`, `none` and `push an object` on tokens that are no brackets, which the program does not have.
- Texts outside the train and validation splits. That no other text falls into the grammar state `error` by a cell that no rule names is not proven: the rules name the cells that these two splits read, and the cells that follow from the same reasons.
- Whether the five rules from the review hold on other data as well as on these two splits. The two other seeds that the review scored say that about half of their validation gain is real.
- The reviewed dataset. When it replaces the snapshot, every number here has to be made again with the commands above.
