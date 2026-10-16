# A recovering parser written by hand

This folder holds the recovery that a programmer writes by hand, as choices of open cells. `rules.ts` holds 35 rules. Each rule has a name, the reason a person would give for it, an example, and the cells it sets. `handwrittenTables()` returns the tables.

The rules set only open cells, to choices that the core allows. No rule adds a state or a character class.

**What these tables are for.** They are a recovery that a person can read rule by rule, to compare the trained arms with. They are not the best that the open cells can hold, and their score is not the score to beat: the search of `../search`, started from these tables, changes 429 cells and ends at 97.7% on the validation split, where the rules have 96.5%. So a trained arm without added structure has to pass 97.7%, not 96.5%, before its tables show something that a plain search does not find. `numberToBeat()` of `../arms/harness.ts` gives an arm that number as a row. What the search gets and the rules do not is listed under [What the rules leave](#what-the-rules-leave).

**The rules were written with the old snapshot's samples in view, so for them no split of this dataset counts as unseen.** They were written before the dataset was reviewed, from a snapshot of it that had other samples, other splits and other labels. About 45% of the samples of a seed are other texts now, and a document's split is decided in another way, so a sample that the rules were tuned on can be in the validation split today. The rules are as they were then: no rule and no cell was changed for the reviewed dataset. Every number below was made again on it. A number of these tables on the validation split says how well rules from the old snapshot carry over to the reviewed dataset, and is no number on unseen data. The same holds for every tables that start from these, e.g. the search from them.

**How the rules were made.** They were written from JSON's grammar and from reading samples of the old snapshot's train split, with `show.ts` and `where-wrong.ts`. No script picked a cell's choice. But scores were in view the whole time:

- The train scores of hand-made variants were compared, and three variants were dropped after reading why they scored worse. One rule and one exception were added with the train score in view.
- `report.ts` scores the validation split by default, so every run of it during the writing showed validation numbers of the old snapshot, per kind of damage too. Nine validation samples were read to write the sentences of the table per kind.
- Five rules came from a review of the first 32 rules. The review tried cells with the train and validation scores in view. They are marked in [The rules](#the-rules).
- The scripts of this folder refuse the test split. But the files of samples that the builder of the first 32 rules was told to read before writing anything held test samples of the old snapshot: 704 of their 3,202 samples, among them all 60 samples of each of the four kinds of damage that are held out for the test split. Which of these files were read is not recorded. So the held-out kinds count as possibly seen by these rules.

## Result

On the validation split, over the scored code points, the share with all three labels right goes from 42.7% to 96.5%. On the train split it goes from 41.9% to 96.2%. A scored code point is one from the first error on whose label has a scored value, see `../README.md`.

| row | broken samples | nothing to recover | all three, as it is | all three, hand-written | display kind | depth | container | whole samples | bound of the plain table parser, all three |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| all | 5021 | 425 | 42.7 | 96.5 | 49.1 → 98.7 | 75.1 → 97.7 | 88.7 → 99.6 | 11.9 → 80.4 | 97.9 |
| source: damage | 3862 | 302 | 40.3 | 96.4 | 47.2 → 98.5 | 72.9 → 97.8 | 87.4 → 99.5 | 9.3 → 77.2 | 97.6 |
| source: typing | 1159 | 123 | 57.2 | 96.9 | 61.1 → 99.7 | 88.4 → 97.0 | 96.5 → 99.7 | 21.0 → 91.7 | 99.7 |
| group: out of reach | 407 | 0 | 25.6 | 78.0 | 45.1 → 96.2 | 53.5 → 79.9 | 84.8 → 97.0 | 0.5 → 24.3 | 84.6 |
| group: needs a nesting fix | 76 | 0 | 26.5 | 76.1 | 63.4 → 99.8 | 43.6 → 76.0 | 86.3 → 94.2 | 3.9 → 31.6 | 43.3 |
| group: needs a character class | 326 | 0 | 10.1 | 92.2 | 16.5 → 93.1 | 50.5 → 98.4 | 81.5 → 99.2 | 0.0 → 15.6 | 100.0 |
| group: needs a line rule | 488 | 0 | 63.8 | 99.0 | 65.6 → 100.0 | 96.6 → 99.0 | 99.2 → 100.0 | 0.0 → 98.0 | 100.0 |
| group: needs a display fix | 37 | 0 | 18.3 | 98.2 | 31.1 → 98.2 | 56.7 → 100.0 | 80.9 → 100.0 | 0.0 → 0.0 | 99.1 |
| group: within reach of the tables | 3687 | 425 | 47.4 | 99.5 | 52.3 → 99.7 | 79.1 → 99.8 | 88.8 → 99.9 | 16.6 → 93.3 | 100.0 |
| debatable | 369 | 59 | 43.3 | 80.9 | 62.4 → 98.9 | 68.1 → 80.7 | 91.2 → 97.4 | 6.1 → 52.3 | 77.7 |
| not debatable | 4652 | 366 | 42.6 | 97.6 | 48.2 → 98.7 | 75.5 → 98.8 | 88.5 → 99.7 | 12.3 → 82.5 | 99.4 |
| line ends with a carriage return | 127 | 10 | 56.9 | 97.7 | 62.5 → 99.2 | 87.5 → 98.4 | 94.8 → 99.8 | 5.1 → 65.0 | 98.9 |
| family: half typed | 1598 | 34 | 55.3 | 97.6 | 58.5 → 99.7 | 89.8 → 97.8 | 97.1 → 99.7 | 10.0 → 91.0 | 99.7 |
| family: slip | 75 | 6 | 40.1 | 95.5 | 44.7 → 97.5 | 71.0 → 97.7 | 89.9 → 99.7 | 11.6 → 55.1 | 98.0 |
| family: cut off | 483 | 290 | 44.2 | 90.8 | 58.8 → 99.7 | 72.5 → 90.7 | 93.6 → 99.3 | 10.9 → 81.3 | 89.5 |
| family: separator | 1362 | 0 | 53.5 | 97.6 | 58.8 → 98.6 | 84.1 → 98.9 | 93.0 → 99.8 | 18.9 → 85.2 | 98.8 |
| family: bracket | 280 | 55 | 31.3 | 72.8 | 62.9 → 98.3 | 46.4 → 71.4 | 83.3 → 95.2 | 8.0 → 27.6 | 58.6 |
| family: comment | 518 | 6 | 52.7 | 98.8 | 56.7 → 99.6 | 87.5 → 99.2 | 94.5 → 99.9 | 6.6 → 83.0 | 99.8 |
| family: other notation | 881 | 5 | 14.3 | 97.3 | 23.3 → 97.7 | 52.1 → 99.3 | 80.8 → 99.7 | 2.6 → 55.0 | 99.8 |
| family: inside a string | 267 | 0 | 37.9 | 94.4 | 42.2 → 96.0 | 82.7 → 98.1 | 96.3 → 99.3 | 0.0 → 47.9 | 99.3 |
| family: wrapper | 664 | 33 | 40.8 | 97.9 | 51.4 → 99.1 | 61.7 → 98.7 | 71.7 → 99.6 | 10.1 → 85.1 | 99.9 |
| family: several documents | 114 | 0 | 36.7 | 95.2 | 42.2 → 100.0 | 62.6 → 95.2 | 66.9 → 100.0 | 7.0 → 90.4 | 96.8 |

The first two number columns are the main number, as it is and hand-written. The next four show "as it is → hand-written". The last column is the dataset's bound for the plain table parser, whose depth follows the tokenizer's events. These tables are no tables of that parser: 21 of their grammar cells hold a stack action that does something else than their token does, e.g. a pop at a comma. So they pass the bound in the group "needs a nesting fix", 76.1% against 43.3%, and in the family of bracket damage, 72.8% against 58.6%. The held-out kinds and the held-out template are only in the test split, so they have no row here.

Three things that these numbers do not show:

- **No error is shown any more.** Of the 54,162 code points that the damage added to the validation samples, today's parser shows 89.6% as an error, and these tables show none: 75.3% as a string, 9.2% as a key, 8.8% as white space and the rest as punctuation, numbers and other kinds. No validation sample shows an error anywhere from its first damage on. The score does not see this, since an added code point has no label. `valid` and the first error are still today's, so a page can still report the first error, but nothing in the text is marked as wrong. Whether a recovering highlighter should mark the damage is an open question, see `../README.md`.
- **Some texts get worse.** On the train split, 453 of the 40,457 broken samples lose a code point that today's parser gets right, and 151 of them lose more than they gain: 9,840 code points lost against 3,021,419 gained. On the validation split 45 samples lose a code point and 10 lose more than they gain (648 lost, 364,477 gained). `worse.ts` lists them by the cells at the first lost code point. The main sources on the train split: the tokenizer's wait after a line feed inside a string, which keeps a string open that an inner quote without a backslash closed by accident (50 samples, 1,970 code points); a string after a key that is read as the next key when it is the key's value (132 samples, 1,923 code points); the comma that closes a second container after a closing bracket of the other kind, when that bracket was only mistyped (15 samples, 1,216 code points); and a sentence in front of the document that holds an opening brace, which the rules open as an object (9 samples, 1,108 code points).
- **Valid JSON that is too deep.** A valid JSON text of 17 levels or more has a first error, so its rest may be shown otherwise than today. The rules keep its depth right at every code point, as today's parser does: `check.ts` runs 300 such texts with nothing after their nested containers and 300 with members after them, and no depth is wrong in either. The first 32 rules had the depth wrong at 21% of the code points after the 17th bracket of the first form, because they closed a container at a comma or a colon by the kind at level 16, which is not the innermost container above 16 levels.

The ground rules hold: `check.ts` runs the 47,960 texts of the train and validation splits and finds no difference from today's parser before a first error, nor in the first error's position and kind.

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
| grammar `error` | after the first error | inside a container: a closing brace closed a nested array, and the object around it still has to close. At depth 0: a comma came after the document | on the train and validation splits, two cells that no rule names lead into the state, in 41 samples: a colon that was typed twice, see below |
| grammar `end` inside a container | no text reaches it there | a closing square bracket closed a nested object, and the array around it still has to close | nothing |
| grammar `colon`, `valueOrClose`, `commaOrClose` at depth 0 | no text reaches them there | after the document, a comma and a string. Then after the colon. Then after a string as the value, or after a closing bracket that may be one too many | nothing |

## The rules

"Samples" is how many of the 45,478 broken texts of the train and validation splits read a cell of the rule, from the first error on. "Kept" counts open cells that a rule relies on and that hold the right choice today.

| rule | table | cells | samples | reason |
| --- | --- | --- | --- | --- |
| a word without quotes starts | tokenizer | 11 | 15,581 | A character that starts no JSON token starts a word, and a word is read as a string without quotes: a key where a key may come, a string elsewhere. |
| a word goes on | tokenizer | 24 | 16,263 | Inside a word every character but a colon, a comma, a bracket and a line feed is part of the word, spaces and quotes included, so that 'Ada Lovelace' and ObjectId("507f") are one word each. |
| a word ends at punctuation | tokenizer | 6 + 1 kept | 16,633 | A colon, a comma or a bracket ends a word and is read as itself: the colon after a key without quotes, the comma or the closing bracket after a value without quotes, the opening brace after a statement in front of the document. |
| a literal or a number turns into a word | tokenizer | 311 + 12 kept | 5,483 | A character that cannot continue a literal or a number makes the token a word, e.g. the i of nil, the a of name, the p of 12px, the second dot of 1.4.2. |
| an unfinished literal or number ends | tokenizer | 116 | 2,615 | White space, a comma, a colon or a bracket after a literal or a number that is still being typed is read as itself, and the typed characters keep their kind. |
| leading zeros | tokenizer | 2 | 540 | A digit after a leading zero continues the number. |
| a number starts with its sign or its point | tokenizer | 3 | 934 | A plus sign or a decimal point where a token may start begins a number, as a minus sign does. |
| a word that starts with a slash | tokenizer | 51 | 4,981 | A slash where a token may start begins a comment or a path. It is read as a word in which a colon is a word character too, and of which the grammar sees nothing, so that a comment leaves the grammar where it was. Brackets still count, so that a pair of them in a comment stays a pair. |
| a line feed inside a string | tokenizer | 5 | 5,664 | A JSON string holds no raw line feed. A line feed inside a string is white space, and the tokenizer waits for the first character of the next line, which says what the line feed was, see the next rule. After a backslash or inside a \u escape the string ends at the line feed. |
| the line after a line feed inside a string | tokenizer | 23 | 5,629 | After a line feed inside a string, white space is skipped. Then a quote starts the next string and a bracket is read as itself: the closing quote of the string before was not typed yet. Any other character goes on with the string: the line feed was pasted into it. |
| a raw control character in a string | tokenizer | 2 | 409 | A tab or another control character inside a string is content: someone pasted the text without escaping it. |
| a backslash before any character | tokenizer | 21 | 913 | After a backslash and a character that JSON does not escape, the string goes on: the backslash was meant as a backslash. |
| a \u escape that is too short | tokenizer | 66 | 14 | A character that is no hex digit ends a \u escape of fewer than three hex digits, and is read as the string reads it: a quote ends the string, a backslash starts an escape, anything else is content. After three hex digits the tokenizer is in the state that also waits after a line feed inside a string, and is read by that rule. |
| a control character between tokens | tokenizer | 7 | 103 | A control character between tokens is skipped like white space, e.g. a NUL or an end-of-file character after the document. An escape character starts a color code of a terminal, e.g. ␛[34;1m, so after a control character an opening square bracket, digits and characters without a class of their own are skipped too, and a quote starts a string. |
| trailing comma | grammar | 5 | 5,046 | A closing bracket right after a comma closes the container: the comma was one too many. |
| colon without a value | grammar | 5 | 2,440 | A comma or a closing brace right after a colon: the value is not typed yet, and the object goes on or ends as the character says. |
| key without a colon | grammar | 8 | 7,627 | A comma, a closing brace or another string right after a key: the key is still being typed and has no colon yet, so a string is the next key, shown as a key. |
| missing colon | grammar | 9 | 739 | A number, a literal or an opening bracket right after a key can only be the key's value: the colon is missing. |
| missing comma | grammar | 23 | 10,029 | After a complete value, the start of a token is the next entry: the next key inside an object, the next item inside an array. An opening bracket opens a container, so that its closing bracket finds it. |
| an opening brace after a value in the outermost object | grammar | 1 | 299 | An opening brace after a complete value in the outermost object starts the object again: the line before was cut off and a new document follows, e.g. one document per line. The stack stays as it is, so the new object takes the place of the one that was cut. In a nested object the brace opens an object, so that a pair of braces stays a pair, e.g. in '${file}'. |
| extra comma | grammar | 12 | 1,807 | A comma where an entry should start changes nothing. |
| a number or a literal as a key | grammar | 6 | 3,082 | Where a key may come, a token that starts like a number or a literal is the key, e.g. the n of a key without quotes, name, or the dots of an ellipsis. |
| no key before a colon or a container | grammar | 18 | 515 | Where a key may come, a colon is followed by the value, and an opening bracket opens a container, so that its closing bracket finds it. |
| a colon after a value | grammar | 3 | 2,186 | A colon after a complete value inside an object: the value was really the next key, e.g. after a colon without a value, so a value comes next. |
| a key inside a nested array | grammar | 2 | 675 | A colon after a value inside an array that is inside another container: only an object has keys, so the array lost its closing bracket. The colon closes the array, and the value of the key comes next. |
| a colon inside the outermost array | grammar | 1 | 58 | No object is around the outermost array, so a colon after one of its values belongs to no key: the opening bracket was no real one, e.g. the [ of a sentence in front of the document. The colon closes the array, and what follows is read as after the document. |
| a closing bracket of the other kind | grammar | 16 + 6 kept | 928 | A closing bracket of the other kind closes the innermost container: it was mistyped, or the innermost container is still being typed and the bracket is the one of the container around it. One step can pop only once, so inside a nested container the grammar remembers the bracket: the state `error` after a brace, the state `end` after a square bracket. |
| a closing bracket that may be one too many | grammar | 5 | 5,915 | A closing bracket that closes the outermost container where the grammar did not expect that bracket may be one too many: a closing brace after a comma, after a key or after a colon, and a closing bracket of the other kind after a complete value. The grammar then expects a comma or a closing bracket at depth 0, where the rule `the document goes on after its end` lets a comma open the object again at once. When no comma follows, the document has ended. |
| the close that is owed after a brace | grammar | 44 + 4 kept | 351 | After a closing brace closed a nested array: when the container that is now innermost is an object, the brace was its closing brace. A comma closes the object, and the next key follows in the container around it, unless the object is the outermost one: there a comma shows that the document goes on. Another closing brace closes the object, and the next container still has to close. Anything else is read as after a complete value. When the innermost container is an array, nothing is owed. |
| the close that is owed after a square bracket | grammar | 46 + 2 kept | 441 | After a closing square bracket closed a nested object: when the container that is now innermost is an array, the bracket was its closing bracket. A comma closes the array, and the next entry follows in the container around it, unless the array is the outermost one. Another closing square bracket closes the array, and the next container still has to close. Anything else is read as after a complete value. When the innermost container is an object, nothing is owed. |
| a key state inside an array | grammar | 19 + 2 kept | 50 | After the close that is owed, the grammar expects a key, but the container that it lands in may be an array. There the state reads as the state that expects a value. |
| after the document | grammar | 7 | 7,422 | After a complete top-level value, an opening bracket starts a new document, a closing bracket is a stray one and pops nothing, and any other token is text around the document. |
| the document goes on after its end | grammar | 27 + 6 kept | 1,685 | After the document, a comma, a string, a colon and a value are a member: the document was closed too early, e.g. by a stray closing bracket, or its opening brace is missing. A number or a literal as the value opens the object again. A string as the value does so at the comma after it, because a string can also be a line of text in front of a document, e.g. the fence line after "Okay, the result:". |
| before the document | grammar | 4 | 263 | Before the first value, a colon or a comma changes nothing, and a closing bracket pops nothing. |
| deeper than the maximum depth | grammar | 6 | 0 | An opening bracket at depth 16 still opens a container, so that its closing bracket finds it. Above 16 levels the stack keeps no kinds, so there the rules that close a container at a comma or a colon do not close it: the depth stays a count of brackets, as it is today for a valid JSON text that is too deep. |

The rules set 648 of the 710 open tokenizer cells and 267 of the 616 open grammar cells, and rely on 13 and 20 more as they are. On the train and validation splits, the exact parser reads 446 of the 915 cells that differ from today's.

**A cell that the rules miss on the reviewed dataset.** Two open cells that no rule names are read, at 41 code points in all: (value, colon, depth 1, object) and (value, colon, depth 2 to 15, object), the second colon of a colon that was typed twice, e.g. `"version":: "2.8.3"`. They still lead into the grammar state `error`, to which the rules give another meaning. The old snapshot had no such text: a key that is pressed twice is a form of the kind `typingSlip`, which the review of the dataset added. A rule "a colon where a value should come changes nothing" would cover it, and was not written, so that the rules stay what they were.

Five of the rules came from the review of the first 32 rules: "an opening brace after a value in the outermost object", "a closing bracket that may be one too many", "a control character between tokens", "a colon inside the outermost array", and nine cells of the two rules for a line feed inside a string. On the old snapshot the review measured what each added on top of the first 32 rules, and the five together added 1.1 points on that snapshot's validation split. Those numbers are not made again, since the first 32 rules are not in the repo as tables. What can be made again is the main number of the 35 rules without one rule, on the reviewed dataset's validation split, where all 35 have 96.5%:

| rule | cells | all three without the rule | difference |
| --- | --- | --- | --- |
| an opening brace after a value in the outermost object | 1 | 96.4 | -0.2 |
| a closing bracket that may be one too many | 5 | 96.5 | -0.0 |
| a control character between tokens | 7 | 96.5 | -0.0 |
| a colon inside the outermost array | 1 | 96.5 | -0.0 |
| a line feed inside a string | 5 | 96.1 | -0.4 |
| the line after a line feed inside a string | 23 | 95.6 | -0.9 |

`report.ts --without-each-rule` prints the main number without each rule. Read it with care: the cells of a rule that is left out hold today's choice, which for most grammar cells is the state `error`, and the rules give that state a meaning. So a text often recovers by accident, e.g. without "trailing comma" the main number only falls from 96.5 to 95.5. The three rules that the score leans on most are the ones of a word: without "a word ends at punctuation" it is 74.6, without "a word goes on" 82.7, and without "a word without quotes starts" 85.3.

## Per kind of damage

The validation split, the main number. A sample with several kinds is in the row of each, so a row also holds what other kinds in its samples cost. The search's column is the search of `../search` started from these tables: where it is higher, the cells can hold more than the rules do. The numbers are new. A difference in the last column, e.g. "the search gets 41.8 points more", is worked out from the counts of code points, so it can be 0.1 away from the difference of the two rounded columns. **The sentences of the last column were written from reading samples of the old snapshot**, and were only changed where a number in them had to be made again, and in the row of foreignLiteral, where what the sentence said of the search's tables no longer holds for the search's tables of this dataset. `typingSlip` is a kind that the old snapshot did not have, and its sentence is from the train split of the reviewed dataset. `stringConcatenation` has no validation sample.

| kind | samples | as it is | hand-written | search from the hand-written tables | what the rules leave |
| --- | --- | --- | --- | --- | --- |
| openStringAtLineEnd | 500 | 67.1 | 99.9 | 99.0 | Nothing of its own. The rest is other damage in the same samples. |
| openStringMidLine | 176 | 14.7 | 82.5 | 86.1 | The open string ends at the next quote, which opens the next string in the original, so every quote up to the line feed is read in the opposite role, and a bracket inside the open string is never seen. |
| keyWithoutColon | 301 | 62.3 | 99.4 | 99.7 | Nothing of its own. |
| colonWithoutValue | 360 | 63.9 | 99.2 | 99.8 | When the next key follows the colon, a frozen cell reads the key as the value, so it is shown as a string. The colon after it puts the grammar back. |
| partialLiteral | 165 | 41.9 | 100.0 | 100.0 | Nothing of its own. |
| partialNumber | 123 | 38.0 | 99.0 | 99.0 | Nothing of its own. |
| typingSlip | 75 | 40.1 | 95.5 | 93.4 | A wrong character in the place of a colon, e.g. `;`, has the class of a letter, so it starts a word and is shown as a key. An opening bracket that comes twice, e.g. `{{`, reads as a container whose closer is missing, so the depth stays one too high to the text's end. A colon that comes twice reads a cell that no rule names. |
| cutOff | 451 | 47.8 | 92.9 | 96.6 | 288 of the 451 samples have nothing to recover. A line that is cut after a complete value or inside a string value, followed by a document on the next line, is read by the rule for an opening brace after a value in the outermost object. Left: a line that is cut after a key, a colon or a comma, where the brace on the next line still opens a nested object. |
| headMissing | 14 | 21.7 | 77.6 | 89.7 | The depth at the start is unknown. When the text starts at a member of the outermost object, the rule "the document goes on after its end" finds the object at the second member. Deeper starts stay wrong. The search gets 12.1 points more, so the cells can hold a rule that is missing here. |
| middleCutOut | 18 | 35.9 | 85.3 | 89.3 | The removed span can hold any number of brackets and quotes. |
| missingComma | 567 | 61.7 | 98.1 | 98.8 | Nothing of its own. |
| trailingComma | 737 | 50.3 | 98.6 | 98.8 | Nothing of its own. |
| extraComma | 75 | 56.3 | 99.1 | 99.3 | Nothing of its own. |
| missingColon | 29 | 64.7 | 95.8 | 95.8 | Before a string value, the string reads as the next key, because the rule for a key without a colon has the cell. It is shown as a key, and the comma after it puts the grammar back. |
| foreignKeySeparator | 24 | 2.1 | 68.4 | 90.9 | The = or => and the value after it are one word, which reads as the next key and is shown as a key. Depth and container are right. The search gets 22.6 points more, so the cells can hold a rule that is missing here. |
| missingCloser | 181 | 29.3 | 76.1 | 81.0 | After a removed closer the next entry reads as one more entry of the container that is still open, and only the indentation says otherwise. Recovered: a key right after an array's items, and a nested container that is still open when the bracket of the container around it comes and a comma follows. |
| strayCloser | 64 | 15.9 | 46.9 | 88.8 | A stray closer inside a nested container reads as a real one. Recovered: a stray closer after the document's end, a closer of the outermost container that the grammar did not expect when a comma follows it, and the members after a comma when the document closed too early. The search gets 41.8 points more, so the cells can hold a rule that is missing here. |
| wrongCloser | 35 | 66.3 | 99.2 | 98.9 | Almost nothing in this split. On the train split 89.3%: a mistyped closer of a nested container with a comma after it is read as the closer of the container around it, so two levels close where one was meant. |
| lineComment | 476 | 53.1 | 98.8 | 99.3 | A comment is a word, not a state of its own. Left: a comment with a comma and then a colon inside a nested array, where the colon closes the array, and a comment with a bracket that has no partner. |
| blockComment | 59 | 61.6 | 99.7 | 99.8 | As lineComment. The lines of a comment over several lines are words, which a key state takes as keys without a colon. |
| hashComment | 15 | 31.0 | 99.3 | 98.6 | As lineComment, and a # comment is a plain word, so its colon counts. |
| unquotedKey | 256 | 5.8 | 98.0 | 98.1 | The first letter of a key that starts with t, f or n is shown as a literal: the cell that reads it is frozen. |
| singleQuotedString | 333 | 4.4 | 97.0 | 98.0 | Read as words, since the apostrophe has no class. Left: a colon, a comma or a bracket inside the string ends the word, and True, False and None in the same texts are shown as strings. |
| curlyQuotes | 63 | 7.1 | 89.6 | 91.5 | As singleQuotedString. Most of what is left comes from the no-break spaces in the same samples. |
| nonBreakingSpace | 42 | 4.7 | 86.1 | 85.2 | A no-break space has the class of a letter, so it starts a word: the indentation is shown as part of the key that follows it. |
| foreignLiteral | 232 | 12.9 | 98.6 | 99.1 | True, None, undefined and the like are shown as strings, not as literals: a word is read with a string's events. The search's tables show them as strings too. The dataset gives such a word no label, so no score sees how it is shown. |
| unquotedValue | 51 | 27.0 | 99.3 | 99.2 | Nothing of its own. The rest is the first letter of keys without quotes, and other damage. |
| numberFormat | 53 | 27.6 | 99.5 | 99.6 | Nothing of its own. |
| callWrapper | 79 | 28.0 | 97.3 | 98.4 | ObjectId("…") is one word and shown as a string, which is right. A colon inside the call, e.g. in the time of ISODate("…T03:27:21Z"), ends the word, and the digits of NumberLong(15) are shown as a string. |
| tuple | 3 | 0.0 | 91.7 | 90.8 | Three samples. The round brackets are word characters. |
| templatePlaceholder | 17 | 40.2 | 99.9 | 99.9 | Nothing of its own. |
| ellipsis | 77 | 39.8 | 99.7 | 99.6 | Nothing of its own. |
| unescapedQuote | 80 | 42.6 | 89.2 | 94.1 | The inner quote ends the string, and the text after it is a word, which reads as the next key and is shown as a key. An inner quote before a bracket, e.g. "{"id": 1}", changes the depth. |
| unescapedBackslash | 94 | 33.6 | 98.1 | 98.6 | A backslash before a letter that JSON escapes, e.g. the \t of C:\temp, is a valid escape. A backslash before the closing quote keeps the string open up to the line feed. |
| rawLineFeedInString | 78 | 42.2 | 94.8 | 97.1 | The tokenizer waits after the line feed, and text on the next line goes on with the string. Left: a next line that starts with a quote or a bracket, and the first character of a next line that is a hex digit, which is shown as an escape. |
| rawTabInString | 27 | 30.4 | 99.1 | 99.3 | Nothing of its own. |
| missingOpeningQuote | 15 | 35.2 | 99.4 | 99.7 | Nothing of its own: the word runs to the comma, and its closing quote is a word character. |
| doubledQuote | 14 | 30.8 | 83.2 | 86.9 | The second quote opens a string that swallows a bracket or a colon on its way to the end of the line. |
| codeFence | 335 | 66.4 | 99.5 | 99.8 | Nothing of its own. |
| proseAround | 200 | 63.8 | 99.5 | 99.8 | Nothing of its own. |
| statementWrapper | 175 | 3.5 | 98.8 | 99.2 | Nothing of its own. |
| quotedDocument | 24 | 0.0 | 82.7 | 91.5 | "…" around the document: the first quote opens a string that ends at the document's first quote. '…' is a word and works. The search gets 8.7 points more, so the cells can hold a rule that is missing here. |
| byteOrderMark | 19 | 5.0 | 97.8 | 99.3 | Nothing of its own. |
| textAfterEnd | 25 | 33.8 | 87.6 | 98.1 | 19 of the 25 samples have nothing to recover. The search gets 10.5 points more, so the cells can hold a rule that is missing here. |
| ansiColorCodes | 3 | 0.0 | 57.7 | 96.2 | Three samples. After the escape character, the bracket, the digits and the letter that ends the code are skipped. Left: a number right after a code is skipped too, and a literal there is read as a word, e.g. the true of ␛[33mtrue. The search gets 38.6 points more, so the cells can hold a rule that is missing here. |
| backslashEscapedDocument | 11 | 0.0 | 77.3 | 85.6 | Read as words: \"id\" is a key without quotes. Left: the \n and the indentation after it are part of the word, and a colon inside a string ends the word. The search gets 8.3 points more, so the cells can hold a rule that is missing here. |
| htmlEntities | 11 | 2.2 | 99.0 | 99.3 | Nothing of its own: &quot;id&quot; is a word. |
| newlineDelimited | 79 | 53.9 | 92.0 | 96.9 | One document per line works, also after a line that was cut after a complete value. What is left is the cut line of cutOff in the same samples. |
| commaSeparatedRecords | 6 | 64.8 | 100.0 | 100.0 | Nothing. |
| logLines | 29 | 0.9 | 100.0 | 100.0 | Nothing. |

## What the rules leave

23,554 of the 675,949 scored code points of the validation split are wrong, 3.5 points, in 899 samples. The search from these tables has 15,239 wrong code points, 8,315 fewer, in 948 samples.

**Within reach of the cells, and not in the rules: at least 1.2 points.** `where-wrong.ts --causes` guesses the cause of each wrong sample from its first wrong code point and counts every wrong code point of the sample for that cause, so the counts are rough:

| cause | wrong, hand-written | wrong, search from the hand-written tables |
| --- | --- | --- |
| a closing bracket that is missing, with no sign of it but the indentation | 3,736 | 2,912 |
| a stray closing bracket inside the document | 2,916 | 611 |
| = or => in the place of a colon | 1,463 | 411 |
| a no-break space read as a letter | 1,414 | 1,513 |
| a cut line, then a document on the next line | 1,183 | 494 |
| a word after a complete string, read as the next key | 1,124 | 708 |
| a bracket, a colon or a comma inside a string that is open by mistake | 1,059 | 1,078 |
| the first letter of a key without quotes, shown as a literal | 800 | 906 |
| a colon inside a word | 781 | 271 |
| a text that starts inside the document | 649 | 299 |
| the next key after a colon without a value, shown as a string | 262 | 137 |
| a raw line feed inside a string | 260 | 178 |
| color codes of a terminal | 124 | 11 |
| a word for a literal, shown as a string | 32 | 18 |
| a brace in the place of the bracket of a nested array | 0 | 10 |
| another wrong depth | 5,274 | 3,795 |
| another wrong display kind or container | 2,477 | 1,887 |

For most of these I have no rule that I can state, only tables that do better. One that can be read off the search's tables: after `=>` the value in quotes is shown as a string, but for its opening quote, where the rules show it as a key.

The search's tables are not better in every way: they have 79.4% of the samples right as a whole, where the rules have 80.4%, they have the depth of valid JSON that is too deep wrong at 18% to 30% of the code points after the 17th bracket, and they cannot be read rule by rule.

**What no tables of these cells got right in any run so far.** Each entry names what is missing:

- **A class for the apostrophe and for the curly quotes, and a tokenizer state for a string between them.** Such strings are read as words, which breaks at a colon, a comma or a bracket inside the string, e.g. `'2026-11-08T03:27:21Z'`.
- **A class for the no-break space.** It has the class of a letter, so it starts a word. The search gets none of these code points: its tables have more of them wrong than the rules, 1,513 against 1,414.
- **Open entries of the display table.** The core keeps the display table fixed unless an arm opens it. The first letter of a key without quotes that starts with `t`, `f` or `n` is read by a frozen cell as the start of a literal, and the display table shows a literal's start as a literal whatever the grammar expects. The dataset has a group for these samples, "needs a display fix": the rules have 98.2% of its code points and none of its 37 validation samples right as a whole.
- **A stack action that pops twice.** A closing bracket of the other kind inside a nested container should close two containers in one step. The rules close the second one at the comma after it, so the bracket itself keeps a wrong depth, and when no comma follows, so does the rest.
- **The column of a line's first token.** Without the indentation, a removed closing bracket leaves no sign, and a stray one inside a nested container reads as a real one.
- **Memory of the character before, and looking ahead.** A quote right after a closing quote, a quote right after a word character inside a string, and a string that is open by mistake in the middle of a line cannot be told from the ordinary case when they are read.

`rules-with-structure.md` says which structures a programmer would add first. Its list and its order were made on the old snapshot, and its counts are made again on the reviewed dataset.

## Where two readings contradict

Some cells have two sensible readings, and the cell holds one choice. `two-readings.ts` counts, in the train split, what the original says at the first code point of each sample that reads such a cell: the label's display kind for a string, and for a bracket, a colon or a comma the depth after its counterpart in the original against the parser's depth before it. A count says what the original wants at one cell, not what a choice is worth: a choice also changes what the parser reads afterwards, and an added code point has no label and still moves the parser. The choices were made on the old snapshot, where the counts were close or most readers were added code points, by that snapshot's train score. The counts below are the reviewed dataset's.

- **A string after a key, (colon, string)**: the next key, after a key without a colon, against the key's value, after a missing colon. The label is a key in 1,714 samples at depth 1 and a string in 107, and 1,334 against 132 in a nested object. So the string is the next key.
- **A closing bracket of the other kind inside a nested container**: the original is two or more levels up in 541 samples, one level up in 144, and not higher in 41. So the bracket closes the container, and the grammar remembers that the container around it still has to close.
- **The comma after such a bracket**: in a nested container the original is one level up in 167 samples (78 after a square bracket in an array, 89 after a brace in an object), two or more levels up in 9, and at the same depth or deeper in 44. So the comma closes the container. In the outermost container the original is never one level up: it keeps the depth in 63 samples and is deeper in 24. A comma there shows that the document goes on, so the bracket was mistyped and nothing is owed.
- **A colon after a value inside a nested array** (depth 2 to 15): the original is one level up or more in 528 samples (the array's closing bracket is missing), against 20 in which it is deeper, 23 added colons and 39 that are no punctuation in the original, e.g. the colon of a comment or of a text in single quotes. So the colon closes the array.
- **A colon after a value inside the outermost array**: 43 of the 54 samples that read the cell do so at an added colon, e.g. the colon of `Fields marked [optional may be null:` in front of a document, and no original asks for a close. The choice to close the array there was made by the old snapshot's train score.
- **An opening brace after a complete value inside the outermost object**: the original keeps the depth in 154 samples (the brace starts the object again, e.g. after a cut line), goes deeper in 8, and in 111 the brace is string content or an added code point, e.g. in `'${file}'`, where a nested object keeps the pair of braces a pair. The choice to start the object again was made by the old snapshot's train score.
- **An opening brace after a complete value inside a nested object**: the brace is string content or an added code point in 233 samples, the original keeps the depth in 23, is one level up in 15 and deeper in 3. So the brace opens a nested object.
- **A comma after the document**: starts the sequence that can open the object again. A comma between documents is not hurt by it, because an opening bracket after the comma starts a document either way.
- **A line feed inside a string**: ends the string when the next line starts with a quote or a bracket, and is content otherwise. In the first 40,000 samples of the dataset, 3,651 samples need the first reading and 542 the second (the dataset's README).

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
bun lab/recovery-parser/learn/handwritten/two-readings.ts   # train: what the original says at the cells with two readings
bun lab/recovery-parser/learn/handwritten/show.ts --kind missingCloser --wrong --cells   # samples of the train split, the parser's output under the labels
bun lab/recovery-parser/learn/score.ts --tables <scratch>/handwritten/tables.json        # the core's own scorer on the saved tables
bun lab/recovery-parser/learn/search/search.ts --from <scratch>/handwritten/tables.json --out <scratch>/search/search-from-handwritten.json   # the search from these tables, about 160 s
```

`show.ts`, `where-wrong.ts` and `worse.ts` read the train split, or the validation split with `--split validation`. `two-readings.ts` reads the train split and has no `--split`. `report.ts` takes `--split train`, `validation` or both. All of them refuse the test split, whose samples are not loaded, see `../arms/README.md`, and an option that a script does not have is an error, e.g. `two-readings.ts --split validation`. A file for `--tables` that was saved with another version of the dataset is read after a line that starts with "Note:".

## Not checked

- The test split, and with it the held-out kinds (conflictMarkers, nonFiniteNumber, logPrefix, concatenated) and the held-out template.
- A port into the highlighter's program. The rules use the stack actions `pop`, `none` and `push an object` on tokens that are no brackets, which the program does not have.
- Texts outside the train and validation splits. That no other text falls into the grammar state `error` by a cell that no rule names is not proven: the rules name the cells that the old snapshot's two splits read, and the cells that follow from the same reasons. The reviewed dataset already has one such text, the colon that is typed twice.
- Whether the sentences of the table per kind still describe what the rules leave on the reviewed dataset. They were written from the old snapshot's samples.
- What a rule for the colon that is typed twice would add. No rule was changed for the reviewed dataset.
