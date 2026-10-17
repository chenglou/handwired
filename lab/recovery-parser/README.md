# Training a strict parser to recover from errors

A parser that gives up at the first error can be turned into one that keeps going, by training the table entries that valid input never reads. Valid input is parsed exactly as before. On JSON the trained parser ended up slightly better than recovery rules written by hand. On TOML and on a parser made by bison, the gradient training alone did not carry over with JSON's settings and random damage as its training data. Filling the same entries by trial and error did, and so did gradient training once it was given a fairer start: one small hand-written rule on TOML, realistic mistakes in the training data on the bison parser.

This section explains the experiment and its results in plain words. The folders hold the details, and the rest of this file documents the JSON dataset.

## The starting point

The JSON highlighter in `src/json-search/highlighter` is a parser written as lookup tables: "in state X, on character Y, go to state Z". It labels each character as a key, a string, a number and so on.

It is strict. In `{ name: 'get_weather' }` the key has no quotes, so everything after it is shown as an error.

The tables have about 1,560 entries, and valid JSON only ever reads about 240 of them. The other 1,300 are reached only after something has gone wrong.

## The idea

Those 1,300 entries are free. Valid JSON never reads them, so whatever goes into them, valid JSON is parsed exactly as before, and a broken payload is still reported as broken at the same place. Only what is shown after the error changes. Training fills the free entries in:

1. **Soften:** each free entry holds a weighted mix of its possible choices instead of one choice.
2. **Train:** broken payloads are run through, and gradient descent shifts the weights toward the choices that label them correctly.
3. **Round:** each entry is set to its strongest choice, which gives an ordinary exact lookup table again. Only that table is scored.

A second way to fill the entries needs no gradients: trial and error, which the folders call "the search". It changes one entry at a time and keeps the change when more characters come out right on the training payloads.

The training runs on a soft copy of the table parser written for this experiment (`learn/soft/`), at about 1,000 payloads per second. One step of that soft parser was also built as a Handwired circuit, and its values and gradients are the same (`learn/soft/README.md`). The whole run as one circuit was not built.

## The training data

Valid payloads are broken with 55 types of realistic mistakes, such as a missing comma, single quotes or a cut-off end. That gives about 40,000 broken payloads. The correct labels come from the payload before it was broken:

```
before   { "name": "get_weather", "arguments": { "city": "Osaka", "days": 2 } }
after    { name: 'get_weather', arguments: { city: 'Osaka', days: 2 } }
answer   pwkkkkpwssssssssssssspwkkkkkkkkkpwpwkkkkpwssssssspwkkkkpwnwpwp
```

Here `k` is a key, `s` a string, `n` a number, `p` punctuation and `w` white space.

A character counts as right only when its label, its nesting depth and its container (object or array) are all right. Scoring starts at the first error.

## The result on JSON

The same payload under three parsers (`E` is an error, `l` a literal such as `null`):

```
payload              { name: 'get_weather', arguments: { city: 'Osaka', days: 2 } }
answer               pwkkkkpwssssssssssssspwkkkkkkkkkpwpwkkkkpwssssssspwkkkkpwnwpwp
original parser      pwlEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE    0 of 60 right
hand-written rules   pwlkkkpwssssssssssssspwkkkkkkkkkpwpwkkkkpwssssssspwkkkkpwnwpwp   59 of 60
trained              pwkkkkpwssssssssssssspwkkkkkkkkkpwpwkkkkpwssssssspwkkkkpwnwpwp   60 of 60
```

"Hand-written rules" are 35 recovery rules written the way a programmer would write them, in the same free entries.

The final test ran once, on payloads that the training never saw. A cell is characters right / payloads entirely right, in percent, and "trained" is the mean of 5 training runs with gradient descent alone.

| | Familiar types of mistakes (5,306 payloads) | 4 types never trained on (2,029) | Broken payloads written by other agents (215) |
|---|---|---|---|
| Original parser | 41.8 / 12.8 | 28.0 / 2.0 | 22.1 / 2.3 |
| Hand-written rules | 96.6 / 79.6 | 98.9 / 87.2 | 82.7 / 56.7 |
| Trained | 98.1 / 79.8 | 97.1 / 68.9 | 85.6 / 46.3 |

- **Familiar mistakes:** the trained parser is above the hand-written rules.
- **Unfamiliar mistakes:** it has about as many characters right and fewer payloads entirely right. It slips by a few characters often, where the hand-written rules slip rarely and then lose most of a payload.
- **The middle column favours the rules:** their author may have seen those 4 types.
- **The worst failure:** text in front of the JSON, such as the prefix of a log line. A comma or a colon in the prefix can throw off the nesting of the whole document.
- **Trial and error without gradients** does as well on familiar mistakes (98.1) and falls to 77.5 on the 4 unseen types.

The record with every row is `learn/final/RESULTS.md`.

## Beyond JSON

### Random damage in place of realistic mistakes

JSON was trained again on random damage only: delete a character, duplicate a line, cut the end off. On validation data the score fell from 98.0 / 80.5 to 82.8 / 61.8. The parser still learns slips such as a missing bracket. It does not learn habits from other languages, which random damage never makes:

```
payload                  { name: 'get_weather', arguments: { city: 'Osaka', days: 2 } }
answer                   pwkkkkpwssssssssssssspwkkkkkkkkkpwpwkkkkpwssssssspwkkkkpwnwpwp
trained, random damage   pwkksspwssssssssssssssssssssssssssssssssssssssssssssssssssssss   17 of 60 right
```

It reads everything after the first quote as one long string. So the training data has to hold the kinds of mistakes that matter. Details: `learn/arms/neutral-damage/README.md`.

### Another language: TOML

`../recovery-toml/` holds a TOML highlighter in the same table form, about four times larger, and the same procedure with no setting changed. The final test ran once on two sets that nobody on the training side saw.

| | 36 typical TOML mistakes (3,000 payloads) | Broken payloads written by agents (144) |
|---|---|---|
| Original parser | 69.3 / 9.5 | 61.7 / 4.9 |
| One rule: after an error, start anew on the next line | 89.8 / 37.9 | 84.3 / 29.6 |
| 39 hand-written rules | 98.7 / 81.7 | 94.0 / 60.6 |
| Gradient descent alone, random damage | 86.6 / 28.6 | 81.8 / 21.0 |
| Gradient descent, then trial and error, random damage | 92.9 / 50.7 | 89.1 / 43.0 |
| Trial and error alone, random damage | 93.8 / 46.3 | 89.8 / 43.0 |
| Gradient descent, then trial and error, with TOML mistakes in the training data | 98.3 / 82.7 | 92.7 / 55.4 |

- **By the rule fixed beforehand the track failed:** gradient descent alone is below the one simple rule on both sets, in every run.
- **Where it loses:** almost entirely the section headers after an error. It reads `[tasks.clean]` as an array of strings about half the time.
- **What carries over:** filling the unused entries from data. With trial and error, and with TOML mistakes in the training data, the result is level with the hand-written rules, and valid TOML is parsed as before.
- **Gradients add nothing to trial and error here** in characters right.

The record is `../recovery-toml/RESULTS.md`.

### Another kind of parser: a table made by bison

The JSON and TOML tables are made by hand. Most parsers in use come from a generator such as yacc, bison or Menhir. `../recovery-lr/` holds a small ML-like language with a parser made by bison: about 3,800 table entries, of which about 2,400 are free.

These numbers are from validation data only. The final test has not run.

| | Characters right / programs entirely right |
|---|---|
| Original parser | 2.0 / 0.0 |
| Panic mode, the textbook recovery | 60.8 / 27.6 |
| Panic mode with a hand-picked list of tokens to restart at | 78.9 / 35.6 |
| yacc error productions, written by hand | 84.5 / 39.3 |
| Table filled by hand-written rules | 88.0 / 48.7 |
| Gradient descent alone | 82.9 / 35.9 |
| Gradient descent, then trial and error | 88.1 / 48.4 |
| Trial and error alone | 87.4 / 44.5 |

The picture is the same as on TOML: gradient descent alone is above both panic modes, a little below yacc error productions and below the hand-written rules, and trial and error brings it level with the hand-written rules. Details: `../recovery-lr/learn/runs/README.md`.

With realistic mistakes in the training data the order changes. `../recovery-lr/kinds/` holds 34 types of mistakes that people make in such a language, e.g. `;;` after a definition, `==` for `=` or commas in a list, and a training set that is half random damage and half these mistakes. On validation programs with these mistakes, characters right:

| | Characters right |
|---|---|
| Hand-written rules | 90.6 |
| yacc error productions | 90.6 |
| Gradient descent alone, trained on random damage | 79.4 |
| Gradient descent alone, trained on the half-and-half set | 94.1 |
| Gradient descent, then trial and error, half-and-half set | 96.2 |

The validation programs hold the same 34 types as the training data, on other programs. So this shows that the types are learned, and not how the parser does on mistakes that someone else wrote. The types were written in under an hour and were not reviewed.

## How to read this

- **JSON is a clear success.** A strict parser became a recovering one with no recovery code written, and valid JSON is unchanged by construction.
- **The rule for TOML and bison was strict on purpose:** gradient descent alone, every setting frozen as tuned for JSON, and random damage as the training data. A failure by that rule says that the gradient step does not carry over as it is. It does not say that training cannot work there.
- **Two fairer starts were tried on validation data, after the tests above:**
  - **One small hand-written rule on TOML, with gradient descent for the rest.** Only the entries that start a new line after an error are set by hand. Gradient descent alone then has 95.7 / 52.9 when it may change those entries too, and 94.2 / 46.2 when they stay fixed, against 91.5 / 36.0 for the one rule, 90.7 / 33.6 for gradient descent without it and 94.9 / 50.7 for the 39 hand-written rules. The lost section headers are back: 95% right. Details: `../recovery-toml/learn/line-rule/README.md`.
  - **More passes and more data on the bison parser.** Neither moves gradient descent alone: 83.1 after 3 passes, 83.6 after 30, and 83.5 with ten times the data. The training does not fit the data it has, since trial and error reaches 89.5 on the same training programs. So the gap there is in how the soft parser is trained and rounded, not in the amount of data. Details: `../recovery-lr/learn/scale/README.md`.
- **Realistic mistakes in the training data help everywhere they were tried:** on JSON, on TOML and on the bison parser.
- **Not done yet:** training damage for the cases the tests showed, e.g. text in front of a JSON document; a look at why the soft bison parser trains poorly; the bison parser's final test.
- **These later numbers are not results on unseen data.** Their settings were chosen with validation scores in view.
- **The final tests of JSON and TOML are used up.** A setting that is tuned after looking at them needs new unseen data.

## Where things are

- `lab/recovery-parser/`: the JSON dataset (the rest of this file), the agent-written test in `written/`, and everything about training in `learn/`.
- `lab/recovery-toml/`: the TOML track.
- `lab/recovery-lr/`: the bison track.
- Each track has a folder `held-back/` or `written/` with its tests. Whoever builds training data or a training for a track does not read them.

---

# The JSON dataset: broken JSON for a parser that keeps going

The JSON highlighter in `src/json-search/highlighter` does not recover from an error. After the first error of a text its grammar stays in the state `error`: every key is shown as a plain string, e.g. the `"b"` of `{"a": 1 "b": 2}`, a character that starts no token turns the rest of its line into an error, and the depth is wrong after a bracket that is missing or one too many. This folder makes the data for an experiment that asks whether the same loop, with other tables, can keep labeling the text after the error, e.g. so that the `"b"` is still shown as a key.

The data is synthetic. A sample is a broken text of at most 512 code points, the valid text that its author meant, and for every code point of the broken text the label of its counterpart in the valid text. Nothing is stored: sample `i` of a seed is a function of the seed and `i` alone, so `sampleAt(seed, i)` makes it without the samples before it, in about 0.25 ms. Two seeds give unrelated samples.

## What a sample holds

The type `Sample` in `samples.ts` has a comment on every field. The main ones:

- `original`: the valid text that was meant. `documents` holds the same text as one document, or as several when the text is e.g. one document per line. In a sample of a typing replay the original is the document that the typing leads to, and when an entry is being deleted, the document before the deletion.
- `broken`: the text that the parser gets.
- `lineEnd`: what ends the lines of the original: `\n`, or `\r\n` in a few valid samples, in one form of `newlineDelimited` and in one damaged document in 20 with several lines.
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

An edit that only removes or only adds is moved to the right as far as the broken text stays the same, so of two equal code points the later one is the removed or the added one. E.g. of `}}}}` for `}}}` the last `}` is the added one, and when a line `  }` stands before the `}` that ends a document, the first `}` is the kept one and the line feed and the second `}` are added. So next to one such edit, a kept code point has the label of the earlier of the two code points that it can stand for, which is what a parser that reads from the left takes it for.

Text that is added before the whole original is the one exception: it stays there, unless it is one code point, once or repeated. E.g. the log prefix `2026-06-19 12:23:40,515 - app.orders - ERROR - ` before the lone number `20142` is added as a whole, and the number is kept as a whole. Moved to the right, the `20` of the year would be kept as the start of the number. A second `{` before the `{` of a document does move, so the first brace is the kept one.

The rule about two equal code points holds for each edit alone and not for every way of pairing the two texts: an edit moves as a whole and stops at the next edit. E.g. when the line `    }⏎` of an inner object is removed and the line `  }` of the outer one follows, the `}` that is left is the outer one, with the outer one's depth, and a reader from the left takes it for the inner one. Such a sample is flagged `no`, or no depth is scored in it from that bracket on.

A code point that stands in the place of one other code point has that one's label, e.g. the `'` that stands for a `"`, a `]` for a `}`, a `=` or a `;` for a colon, and the two swapped letters of `ture`. `replaced` marks these. A word of another notation that stands for a literal or a number has no label, e.g. `True`, `None`, `nil`, `undefined` and `NaN`: the highlighter has no display kind for a word that is not JSON's, and the label "literal" on `True` would contradict the label "string" on a value without quotes, e.g. `Tallinn`.

### What is not scored

A value of a label is `undefined` when it is not scored. The depth and the container are scored together or not at all. `unscoredKinds` and `unscoredNesting` list the code points. There are four rules, and the function `unscoredOf` in `samples.ts` applies them:

- A kind of damage says that no reading of the broken text can give a display kind. E.g. the two inner quotes of `"call "Ana" back"` are each the second half of an escape `\"` in the original, the comma of `"name": "tiny-gl,` at the end of a line is inside the open string for every reader, and so are the colon and the value of `"tar: true,` when the key lost its closing quote. And in `"count": "_id": 7`, where the value of `"count"` is not typed yet, every reader takes the key `"_id"` for that value.
- Before the first error of the parser as it is, a value that the parser as it is does not give is not scored. Up to its first error a text is the start of a valid text, and every arm of the experiment reads valid JSON as now, so no arm can give another value there. E.g. in `{"a": ⏎ "b": 1}`, where the value of `"a"` is not typed yet, `"b"` is read as that value, as in the valid `{"a": "b"}`, and its label says key. And the `1.4` of the value `1.4.2` without quotes is read as a number.
- Where the labels' depth or container changes at a code point that is not a bracket, a bracket was removed before it, and nothing in the text shows the change. From there to the next kept bracket the depth and the container are not scored. E.g. in `{"tags": ["ops", "beta"⏎}`, where the `]` is missing, the line feed has the depth 1 in the original, and a reader is still inside the array.
- A string value that lost its opening quote and stands after white space or punctuation starts where a number or a literal can start. The code points at its start that read as one are not scored, e.g. the `0.2` of `version: 0.2.0` and the `t` of `NODE_ENV: test`: at the `t` no parser can tell `test` from `true`. The white space before the value can be the damage's own, e.g. the indentation of the line after an added comment. A key without quotes is scored as a key from its first letter on: no literal can stand where a key is expected, so a parser knows at the `n` of `name` that it reads a key. Whether tables can show it so is another question, see `needsDisplayFix`.

So before the first error every scored value is what the parser as it is gives, and `invariants.test.ts` checks that.

## What a score counts

A score counts the code points from `firstErrorPosition` on that have a label with a scored value: `scoredCodePoints(sample)`. Before that position every arm gives the same as the parser as it is. A sample with no such code point has nothing to recover, e.g. a text that is cut off, and only tests that the part before the damage keeps its labels: 7.5% of the broken samples.

The parser as it is does not recover on purpose, so nearly any change to its error cells scores better. `hand-rules.ts` therefore has four settings of the tables that are written by hand and train nothing, and `stats.ts` prints every score for all five readers. `stay` ignores what the parser as it is rejects: a tokenizer error starts no error line, and a token that the grammar does not accept leaves the grammar where it was. `resync` also moves the grammar to the state that follows such a token in valid JSON, e.g. a string where a comma was expected inside an object is the next key. And it gives the tokenizer's error cells another event where what the character is is plain, e.g. the line feed that ends an open string is white space, and the comma after `tru` is a comma. `words` also reads a word where no token of JSON starts as a string, e.g. the `port` and the `production` of `{port: 8080, "env": production}`: the tokenizer gives the word the events of a string, so the grammar shows it as a key or as a string, as it does with a string between quotes. That is one more row of the tokenizer's table. `lines` also has one tokenizer state more than the tables as they are: after a string that a line feed ended, an opening brace at the very start of the next line does not open, e.g. the second brace of `{"id": "7a919a⏎{"id": "7a919a-2", "ok": true}`, two lines of a file with one document per line, where a length limit cut the first line short. In the first 40,000 samples of the default seed:

| Reader | Code points with every scored value right | Samples right as a whole | The same two for the group "within reach of the tables" |
| --- | --- | --- | --- |
| the parser as it is | 41.2% | 10.3% | 47.5%, 14.6% |
| `stay` | 72.4% | 28.3% | 79.7%, 39.1% |
| `resync` | 82.7% | 69.7% | 93.2%, 85.7% |
| `words` | 91.9% | 75.1% | 98.0%, 91.5% |
| `lines` | 92.3% | 75.3% | 98.0%, 91.5% |

A trained result is a gain only over the best hand rule. Over all samples that is `lines`, and for one kind of damage it is the best of the four, which `stats.ts` prints per kind as what is "left".

The hand rules are a floor that was found by hand, and none of them is the best table that a person can write: one more rule can always score higher on some samples. `lines` is such a rule on top of `words`: in the group "needs a line rule" it has 98.7% of the code points right, where `words` has 95.3%. A reader of the dataset built another one, which is no setting of `hand-rules.ts`: `words` with a second copy of the tokenizer's 26 states, which the tokenizer enters at the first cell that valid JSON never reads, and in which a word after an opening brace or a comma is a key, also when it starts with t, f or n. That table keeps the two conditions below and has 27 states more than the tables as they are. It has 93.4% of the samples of the group "within reach of the tables" right as a whole, where `words` has 91.5%, e.g. 51.1% of the samples with a key without quotes against 16.8%, and it has 92.8% of the samples of the group "needs a line rule" right, where `words` has 94.5%. An arm that adds states can aim at these numbers, and its result is a gain only over them.

Three more things to keep in mind when a number is read:

- One number over all broken samples says little, because 18% of the samples are in groups where tables of the highlighter's layout cannot have every label right, by a proof or by the judgment of their forms: "out of reach", "needs a nesting fix", "needs a character class" and "needs a display fix" below. `groupOf(sample)` puts every sample into one of six groups, see below, and the group "within reach of the tables" is the one to report first.
- What an arm can reach at most depends on which cells it may change. `stats.ts` prints two upper bounds per group:

  | Arm | Code points that can have every scored value right | Samples that can be right as a whole | The same two for the group within reach |
  | --- | --- | --- | --- |
  | changes only cells of the grammar table | 60.8% | 45.7% | 70.4%, 64.5% |
  | also changes cells of the tokenizer's table | 97.9% | 92.4% | 100%, 100% |

  For the first arm, the depth and the container are sums over the tokenizer's events, and no grammar cell feeds them, so they stay what the parser as it is gives, and a display kind can only change between key and string. That holds for every setting of the grammar table. For the second arm the bound comes from `limits.ts`. It holds for every setting of the cells that valid JSON never reads, with or without more states, as long as the classes, the events and the display table are as they are, see "What the two proofs assume" below, and `conditionProblems(tables)` says whether tables are of that arm. In the group within reach it is 100% by the group's definition. Both are upper bounds and no estimates: a code point counts when some run of the loop has it right, whether or not one table gives that run in every sample. And both are bounds for the loop of `table-parser.ts`, in which the depth changes by the tokenizer's event: a parser that changes the depth by something else, e.g. by an action that a grammar cell holds, is another parser, and neither bound says anything about it.
- 88.6% of the scored container labels are "object" and 44.1% of the depth labels are 1. The parser as it is has the container right for 86.9%, which is less than the answer "object" every time. `stats.ts` prints the container per label value. In a text of several lines, the start of a line and its indentation say much about keys and depth, so the scores for texts on one line are printed apart.

## Where the samples come from

Out of 100 samples, 5 are valid documents, 20 are texts of typing replays and 75 are damaged documents.

**Documents** (`documents.ts`). 21 templates, e.g. a package manifest, an editor's settings, a log event, an API response, a table as an array of arrays, a document that is nested 16 levels deep, and a lone string or number. Two documents of one template differ in the members they have, e.g. a JSON-RPC message is a request, a notification without an id, a result or an error, so that a template has many sequences of tokens, see the splits below. A document is written in one of six styles: on one line without spaces, on one line with spaces, indented with 2 or 4 spaces, indented with tabs, on one line with a space inside the brackets, or wrapped, i.e. the one-line text with a line feed after a comma wherever a line has reached a width, so that its lines start in the middle of containers. Free text, e.g. a note, a bio or a message, is put together from words, and four texts in ten hold something that a serializer must escape or that means something in JSON: phrases between quotes, line feeds with a letter, a digit, a quote, a bracket or spaces after them, tabs, backslashes, brackets. Together the originals reach all 88 cells of the grammar table that a valid text can reach. A few of the valid samples also have a space before every colon or lines that end with `\r\n`.

**Typing replays** (`typing.ts`). A person adds an entry to a document, deletes an entry, changes a value, or types a whole document, key by key, in a plain editor or in an editor that adds the closing bracket and the closing quote. Every key press leaves a text, and a sample is one broken text of a replay. In one replay in three a key press goes wrong, e.g. `;` for `:` or `k` for `l`, and Backspace takes it back: the text with the wrong character is a sample like any other. The valid texts of a replay are not samples.

**Damaged documents** (`damage.ts` and `damage/`). Out of 100, 60 have one kind of damage, drawn by the weights in the table of kinds below. 14 have two or three kinds that have nothing to do with each other, with more than white space between them and at least 8 code points or one line apart, and whose origins fit, e.g. no marker line of a merge conflict inside a log line. 26 are a combination with one cause, drawn by these weights:

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

One damaged document in 20 with several lines is a file whose lines end with `\r\n`, as files from Windows do: the same damage to the same document, with a carriage return before every line feed of the document and of the added text. Which documents get these line ends is a hash of the document, so every broken text of one document has them or none has.

## The kinds of damage

In the examples, ⏎ stands for a line feed, → for a tab, ⍽ for a no-break space (U+00A0), ◊ for a byte order mark (U+FEFF) and ␛ for the escape character. The weight says how often a kind is drawn among the samples with one kind of damage, relative to the other weights, e.g. `trailingComma` with 7.5 is drawn 1.5 times as often as `openStringAtLineEnd` with 5. A kind is also part of combinations and of typing replays, so its share of all samples is another number, which `stats.ts` prints.

| Kind | Family | Example | Weight | Can a parser label the rest? |
| --- | --- | --- | --- | --- |
| openStringAtLineEnd | half typed | `{⏎  "name": "tiny-glob",⏎  "pri⏎}` | 5 | line rule: a JSON string holds no raw line feed, so "a string that is open at a line feed ends there" is sound. The display kind of a comma that ends up inside the open string is not scored. In a file whose lines end with a carriage return and a line feed, the string must end at the carriage return, which the tables cannot tell from a tab |
| openStringMidLine | half typed | `{"email": "ada@example.com, "role": "admin"}` | 1.6 | no: the open string ends at the next quote, which opens the next string in the original, and every later quote is read in the opposite role. line rule for a key without its closing quote when no quote follows on its line: the string then ends at the line feed, and the display kind of what it took, the colon and the value, is not scored |
| keyWithoutColon | half typed | `{⏎  "strict": true,⏎  "tar"⏎}` | 3.2 | yes. When the next key follows, on the same line or on the next, it needs the rule "a string after a key is the next key", which contradicts the rule for a forgotten colon |
| colonWithoutValue | half typed | `{⏎  "version": ,⏎  "license": "MIT"⏎}` | 3.5 | yes. When the next key follows, every parser reads it as the value, as in valid JSON, so its display kind is not scored, and the colon after it shows that it was a key |
| partialLiteral | half typed | `{"paid": tru, "currency": "EUR"}` | 1.2 | yes: the typed letters are literal characters in the original too, and what follows is read as what it is |
| partialNumber | half typed | `{"lat": 59., "lon": 10.75}` | 0.8 | yes, as partialLiteral |
| typingSlip | slip | `{"debug": ture, "port"; 8080}` | 1.2 | yes: a wrong letter inside a literal goes on with the literal, a wrong character in the place of a colon or a comma stands for it, and a stray character between two tokens is skipped. no for an opening bracket that comes twice, which reads as a container whose closer is missing. The tables need a class for ; and for m to show them as punctuation |
| cutOff | cut off | `{"id": 42, "name": "Ada Lovel` | 7 | yes, and nothing is left to recover: no kept character comes after the cut |
| headMissing | cut off | `"id": 42, "name": "Ada"}` | 0.6 | no: the depth at the start is unknown, and a text that starts inside a string has every later quote in the opposite role |
| middleCutOut | cut off | `{"id": 7, "tags": ["urgent", "dr...lling": true}` | 0.6 | no: the removed span can hold any number of brackets and quotes. yes when a span without a marker is exactly one entry: what is left are the commas around it, the text of extraComma or of trailingComma |
| missingComma | separator | `{⏎  "version": "0.4.1"⏎  "private": true⏎}` | 5.5 | yes: after a complete value, a string inside an object is the next key, and the start of a value inside an array is the next item |
| trailingComma | separator | `{⏎  "host": "localhost",⏎  "port": 8080,⏎}` | 7.5 | yes: a closing bracket after a comma closes the container |
| extraComma | separator | `{"id": 7, , "tags": ["ops"]}` | 1.5 | yes: a comma where a key or a value should start changes nothing |
| missingColon | separator | `{⏎  "port" 8080,⏎  "host": "localhost"⏎}` | 0.8 | yes. When the value is a string, it needs the rule "a string after a key is that key's value", which contradicts the rule for a half-typed key |
| foreignKeySeparator | separator | `{"id"=>42, "name"=>"Ada", "manager"=>nil}` | 0.6 | yes: where a colon is expected, = stands for it and > is skipped. The tables need a class for =, which is in the class of most letters |
| missingCloser | bracket | `{"tags": ["ops", "beta"}` | 2.7 | yes when the closer of the container around it follows and is of the other kind, with the rule that such a closer closes two containers. Otherwise no: the next entry reads as one more entry of the open container. The loop of the highlighter cannot close two containers at one bracket |
| strayCloser | bracket | `{⏎  "name": "Ada",⏎  },⏎  "active": true⏎}` | 1.5 | yes after the document's end, when no open container has the bracket's kind, and when it closes the top-level container and a comma follows. Otherwise no: it reads as a real closer. A closer right before the same closer is the kept one, and the second is the added one. The loop of the highlighter lowers the depth at every closing bracket that the tokenizer reads by a cell of valid JSON, so there it can only label what comes after the document's end |
| wrongCloser | bracket | `{"point": [59.91, 10.75}}` | 0.8 | yes, with the rule that a closer of the other kind closes one container, which contradicts the rule for a missing closer. The loop of the highlighter then has the wrong kind for a container around it, when the tokenizer reads the closer by a cell of valid JSON |
| lineComment | comment | `{⏎  "port": 8080,⏎  // "debug": true,⏎  "host": "localhost"⏎}` | 2.8 | yes: // starts nothing else in JSON, the comment ends at the line feed, and the grammar stays where it was |
| blockComment | comment | `{"port": /* default */ 8080, "host": "localhost"}` | 0.6 | yes, with a state inside the comment and one after a *. Between a colon and its value the comment's end must be found, which needs * as a class of its own when the comment holds a digit |
| hashComment | comment | `{⏎  "retries": 3, # was 5⏎  "timeout": 30⏎}` | 0.3 | yes, as lineComment, for a parser that reads # as the start of a comment. The highlighter's classes lump # with letters, so its tables read the note as words, which works unless the note holds a quote, a colon or a bracket |
| conflictMarkers | comment | `{⏎<<<<<<< HEAD⏎  "version": "0.4.1",⏎=======⏎  "version": "0.5.0",⏎>>>>>>> release/0.5⏎  "license": "MIT"⏎}` | 1.2 | yes: a marker line starts with a character that starts no token and is skipped up to its line feed, and the other side's lines read as more members |
| unquotedKey | other notation | `{⏎  "host": "localhost",⏎  port: 8080⏎}` | 1.5 | yes: where a key may come, a word up to the colon is the key. A key that starts with t, f or n, e.g. name, needs a display fix as long as the tokenizer has read no cell before it that valid JSON never reads: it then reads that letter from the state between as the start of true, false or null, by a cell that valid JSON reads, and the display table shows it as a literal. After such a cell, e.g. after the key port, tables can be in a state of their own, in which a word after a comma is a key |
| singleQuotedString | other notation | `{"roles": ['admin', 'billing'], "active": true}` | 1 | yes for a parser that reads the apostrophe as a quote. The highlighter's classes lump the apostrophe with letters, so its tables read 'admin' as one word, which is enough unless the string holds a space, a comma, a colon, a bracket, a quote or a backslash. A string that holds both kinds of quote stands in single quotes with \' in a Python print and in backticks in a Node print, and the tables then need the backtick as a quote |
| curlyQuotes | other notation | `{“name”: “Ada”, “age”: 36}` | 1.2 | yes for a parser that reads “ and ” as quotes. As with single quotes, the tables read “Ada” as one word, and need a class when the string holds a character that ends a word |
| nonBreakingSpace | other notation | `{"name":⍽"Ada", "age": 36}` | 0.5 | yes for a parser that reads U+00A0 as white space, which the highlighter's classes cannot |
| foreignLiteral | other notation | `{"active": True, "manager": None}` | 2.8 | yes: a word where a value may come, up to a comma, a closer or white space, is one value. The word has no label: it is not a JSON literal, and the highlighter has no display kind for it |
| nonFiniteNumber | other notation | `{"mean": NaN, "count": 0}` | 1.5 | yes, as foreignLiteral |
| unquotedValue | other notation | `{⏎  "env": production,⏎  "port": 8080⏎}` | 0.9 | yes: the value runs to the next comma or closer. line rule for several words that run to a line feed. Leading characters that read as a number or a literal, e.g. the 1.4 of 1.4.2 and the t of test, are shown as one by every parser, so their display kind is not scored. A colon inside the value, e.g. in a time, needs a tokenizer that knows that it is not reading a key |
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
| missingOpeningQuote | inside a string | `{⏎  "city": Lisbon",⏎  "country": "PT"⏎}` | 0.3 | yes when the closing quote ends what is left: a key that is one word, or a value of one word or of several words with spaces between them, e.g. 362 Rua das Flores", which runs on to the quote as a value without quotes runs on to its comma. no when the content holds a character that ends it before the closing quote: a comma, a bracket, a quote, a backslash, a tab or a line feed, a space at either end, and in a key any space or a colon. The leading characters of a value that read as a number or a literal, e.g. the 2.0 of 2.0", are shown as one by every parser, so their display kind is not scored. A key that starts so, e.g. name", needs a display fix where a key without quotes does |
| doubledQuote | inside a string | `{⏎  "city": "Lisbon"",⏎  "country": "PT"⏎}` | 0.3 | yes for a parser that knows that it stands right after a closing quote: a second quote there is skipped, and content there opens the string again. The highlighter's tokenizer is in the same state after a closing quote as between any two tokens, so its tables read the second quote as the start of a string, unless a cell that valid JSON never reads has led them into states of their own before |
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

Three fields say what tables of the highlighter's own layout cannot do for a sample:

- `needsClass`: what the tokenizer must tell apart and cannot with its 33 character classes, which lump most characters with letters, e.g. the apostrophe as a quote. It is a judgment, written next to each form. A string in single quotes that holds no space, comma, colon, bracket, quote or backslash needs no class, since the tables read `'admin'` as one word. A sample can need two classes, e.g. the apostrophe as a quote and the backtick as a quote, when Node prints `` `5' 11"` `` next to `'two words'`. In a file with `\r\n` line ends, a string that is open at its line end needs the carriage return apart from the tab: the string must end at the one and go on at the other, and the two are one class.
- `needsNestingFix`: the scored depths and containers cannot all come out of the highlighter's loop. E.g. the `}` of `{"tags": ["ops", "beta"}` must close two containers, a `}` too many lowers the depth of everything after it, and after a `}` in the place of a `]` the loop has the wrong kind for the container around it. Each of the three holds where the tokenizer reads the bracket by a cell that valid JSON reads.
- `needsDisplayFix`: the scored display kinds cannot all come out of the loop as long as the display table is as it is. E.g. in `{name: "Ada"}` the tokenizer reads the `n` as the start of `null`, by a cell that valid JSON reads, and the display table shows that as a literal in every grammar state.

The last two are proofs and no judgments. `limits.ts` follows the loop over the broken text and looks for a run that has every scored label right. A field is true when there is none, and `limitsFor(sample)` gives the code point at which the runs come to an end.

### What the two proofs assume

The parser is the loop of `table-parser.ts` with other tables, under two conditions. Both are the experiment's own, and nothing else is assumed about the tables:

1. A cell that some valid JSON text reads is as it is: 148 of the tokenizer's 858 cells and 88 of the grammar's 704. That is what makes valid JSON read as now. Every other cell may hold anything, and the tables may have more states.
2. The 33 character classes, the events with their tokens and their depth changes, and the display table are as they are. So an event is shown as the same kind in every grammar state, also in an added one, except that the code points of a string are a key or a string. And the depth moves only at an event that opens or closes a container, by one level.

`conditionProblems(tables)` checks both on any tables, e.g. it names an opened display cell or an added class, so an arm can say whether the proofs and the bound hold for it. All four hand rules pass it.

Two things follow from the conditions, and the proofs are these two things and no more:

- Up to the first cell of the tokenizer's table that valid JSON never reads, the tokenizer reads a broken text as now, whatever the grammar does. E.g. in `{"a": 1 "b": 2}` every code point is read by a cell that valid JSON reads, so all that tables can change is whether `"b"` is shown as a key. And in `{name: 1}` the `n` is read from the state `between` by the cell that starts `null`.
- From that cell on nothing is decided. The cell can lead to a state that the tables added, whose cells are all free, so every later code point can get any event. E.g. after the `p` of `{port: 1, name: 2}` the tables can be in a state in which a word after a comma is a key, so the `n` of `name` is no limit there. Two limits are left: a code point is shown as one event's kind, and the depth moves by one level per code point at most, at a code point that gets the event of a bracket and is therefore shown as punctuation.

So the same damage can be proven out of the loop's reach in one text and not in another. E.g. a `}` too many is proven so when every code point before it is read by a cell that valid JSON reads, and not after a comment, whose `/` is read by a cell that valid JSON never reads: tables can then be in a state that skips the `}`.

What the proofs do not show is that a sample can be labeled. They do not ask that one table gives the same answer wherever it reads the same cell, or that a rule stands behind the answers, e.g. they let a letter of a comment get the event of a closing bracket where that fits one text. They let the grammar show any string as a key or as a string. And after the first cell that valid JSON never reads they take the kind of every container for right, since tables can then give a bracket the event of the other kind. A search that follows the kinds with the loop's own arithmetic found a run for the same samples, on every one of 20,000 that it could decide.

`invariants.test.ts` holds three sorts of tables against the bound: the hand rules, tables that use four spare rows of the tokenizer's table as a second tokenizer, which remembers across a comma whether a key comes next, and tables with something drawn at random in every cell that valid JSON never reads.

### The groups

`groupOf(sample)` gives one group per sample, the first that fits in this order. The shares are of the broken samples:

| Group | Share | What puts a sample there | What that says about a parser |
| --- | --- | --- | --- |
| out of reach | 8.5% | the flag is `no` | A judgment about every parser that reads from the left with a state and a stack, whatever its tables and classes. It is the strictest reading, see the known limits |
| needs a nesting fix | 1.5% | `needsNestingFix` | A proof: under the two conditions the loop cannot give the scored depths and containers, whatever the cells hold that valid JSON never reads, with any number of added states. It takes a parser whose depth does not follow the tokenizer's events, e.g. one that closes two containers at one bracket |
| needs a character class | 7.5% | `needsClass` is not empty | A judgment per form: the form's rule must tell two characters apart that are in one class. With the classes as they are, tables still get a part of these samples right, e.g. a string in single quotes without a space: `words` has 85.4% of the code points of this group right |
| needs a line rule | 9.1% | the flag is `line rule` | A judgment: a parser can label the sample when it ends a token at a line feed. Tables can hold such a rule, since the cell for a line feed inside a string is one that valid JSON never reads, and `resync` holds it. It excludes the rule that a line feed inside a string is content |
| needs a display fix | 0.9% | `needsDisplayFix` | A proof, as for the nesting: a cell that valid JSON reads shows a scored code point as another kind than its label says, so with the display table as it is the loop cannot show it right. Most of these samples need one changed display cell, for the first letter of a key without quotes that starts with t, f or n. A second quote after a closing quote needs more, a tokenizer state of its own after a closing quote, which the cells that valid JSON reads leave no room for |
| within reach of the tables | 72.6% | none of the above | Nothing is known that keeps the loop from labeling the sample: the flag is `yes`, no form asks for a class, and some run of the loop has every scored label right when the cells that valid JSON never reads may hold anything. The tables may need more tokenizer states and grammar states than they have, e.g. a state inside a block comment, and nobody counted how many. It does not say that one setting of the tables labels every sample of the group: some rules exclude each other, see below, and `words` has 91.5% of these samples right as a whole |

So a report on an arm should say what the arm is: which cells it may change, whether its tables have more states, whether its display table is changed, whether its depth follows the tokenizer's events, and whether `conditionProblems` is empty for its tables. An arm that changes only grammar cells cannot reach the 100% of the last group, see the bounds above.

`debatable` marks a sample where another repair is as sensible as the one that the labels describe and would give other scored labels to kept code points, e.g. a `}` too many, where the labels say that the `}` is to be skipped, and a person could as well say that the `}` is right and the text after it is the mistake. 8.9% of the broken samples.

### Rules that exclude each other

Some rules behind a `yes` or a `line rule` contradict each other, so no single parser gets all of these samples right. `needsRules` lists the rules of this kind that a sample needs, and `contradictions` in `damage/types.ts` lists the pairs. In the first 40,000 samples:

| A rule | Samples | The rule that it excludes | Samples |
| --- | --- | --- | --- |
| a string that is open at a line feed ends there, e.g. after `"name": "tiny-gl` at the end of a line | 3,651 | a line feed inside a string is content, e.g. in a note of several lines that was pasted between quotes | 542 |
| a string after a key is the next key, e.g. `"tar" "license": "MIT"`, where `"tar"` is half typed | 1,678 | a string after a key is that key's value, e.g. `"port" "8080"`, where the colon is missing | 117 |
| a closer of the other kind closes one container, e.g. the first `}` of `[59.91, 10.75}}` | 214 | a closer of the other kind closes two containers, e.g. the `}` of `["ops", "beta"}` | 248 |
| a comma after the top-level value is skipped, e.g. between the records of `{"id": 1}, {"id": 2}` | 77 | a comma after the top-level value opens the value again, e.g. after the first `}` of `{"name": "Ada"}, "active": true}` | 73 |

For a string after a key, the two rules agree with one that asks for a line feed: on a new line the string is the next key, on the same line it is the value. The tables as they are cannot hold that rule, since a line feed between two tokens leaves no trace in the tokenizer's state or the grammar's.

## Splits and what is held out

`splitOf(document)` is a hash of `splitKeyOf(document)`, the document's tokens as the grammar table reads them: brackets, colons, commas, strings, and numbers or literals, e.g. `{"id": 7}` and `{ "port":8080 }` are both `{s:n}`. 80 of 100 sequences go to train, 10 to validation and 10 to test, and a sample is in the split of its document. So no original is in two splits, all broken texts of one original are in one split, and a validation or test document's sequence of tokens is in no train document.

The same holds for every document of a text of several documents: a record is in the split that the same record has as a document of its own, and a text is only made of records of one split, which is the text's split (`splitOfDocuments`). The first record of a stream decides, and a later record that falls into another split is made again with other values. So no validation or test document has the tokens of a record inside a train text, and no text outside train is made of records whose tokens training has. The price is that a text of several documents outside train rarely has records of two sequences: the second sequence must fall into the same split, which one sequence in ten does. In the first 40,000 samples, the records have more than one sequence in 335 of the 859 train texts of several documents, and in 16 of the 319 others. A record that is one string, one number or one literal counts by its text in these two numbers, e.g. `1⏎2⏎3⏎` counts as three; by sequences of tokens alone they are 333 and 15.

A document that is one string, one number or one literal is the exception. Its sequence is one token, `s` or `n`, which is the same for every such document, so its text decides its split, e.g. `"abc"` with any white space around it. The three literals are split by hand, `true` in train, `false` in validation and `null` in test, because a hash put all three into train. So a half-typed scalar alone, e.g. `fa`, `nu` or `"abc`, is in validation and in test too. For these documents the test split holds no sequence of tokens that training lacks.

The ten smallest sequences of more than one token are split by hand too, because a hash put all ten into train, and no validation or test document was an empty container. The template `scalar` makes them, and so do small documents of other templates, e.g. of `tree`: about 1% of the samples. `[{}]`, `{s:[]}`, `[s]` and `{s:n}` are in train, `[]`, `{s:{}}` and `[n]` in validation, and `{}`, `[[]]` and `{s:s}` in test. So each of validation and test has one of the two empty containers, one container that holds an empty one, and one container with one entry, and train has no document that is `[]` or `{}` alone. A sequence is still in one split only.

How many shapes of document a split tests differs from template to template, and `stats.ts` prints it: per template and split the samples, the distinct sequences, and the share of the samples that have the most frequent one. In the first 40,000 samples every template but `scalar` has 32 or more distinct sequences in test, and every one that is not held out has 29 or more in validation, e.g. `remoteCall` 29 in validation and 35 in test, `numberGrid` 35 and 50, `sensorReadings` 67 and 81, `messages` 146 and 160. `scalar` has 15 in validation and 11 in test: the three sequences that each got by hand, and lone scalars, which count by their text. For a text of several documents what is counted is the list of the distinct sequences of its records, and the record types are rarer and have fewer, e.g. `records: event` 8 and 10, `records: row` 10 and 2, `records: pair` none and 1.

Training never sees four kinds and one template. A sample that has one of them is only made from an original of the test split, which makes the test split about 20% of the samples. What decides whether a sample is held out is fixed by the first try at it, and the later tries only draw other documents, so a held-out kind is as frequent as its weight says, and it sits on the held-out template as often as that template takes it, e.g. 13% of the `conflictMarkers` samples.

- `conflictMarkers` (family comment): the marker lines are skipped up to their line feed, as a `//` or `#` comment on a line of its own is.
- `nonFiniteNumber` (family other notation): a word where a value may come, as `undefined` and `nil` are.
- `logPrefix` (family wrapper): text right before the document, in four formats that no line of the kind `logLines` has. It is on the document's first line, unless the document starts with a line feed, as 2% of them do. The kind takes small documents, and `{}`, `[[]]` and `{s:s}` are always in test, so 2% of its samples are made from one of the three, where 0.3% of all samples are.
- `concatenated` (family several documents): a new document right after a complete one. One document per line reaches the same cells of the grammar table.
- The template `order`: a business record with an array of objects, a nested object, nulls and strings with escapes. Other templates have each of these features, and none has its sequence of tokens.

What these tell depends on the arm. Tables read cells and not kinds, and the held-out kinds reach cells that kinds in training reach too, so for tables they hold nothing new, and `resync` scores as well on them as on the rest. They are new to an arm that sees characters, e.g. a network that never saw `<<<<<<<` or `NaN`. Every run of 8 tokens of the template `order` is in some training document, 90% of its runs of 16 and 16% of its runs of 24, so the template is new only to an arm that looks at more than a few tokens.

Reports should give four groups apart and never one number for "the test split", of which a half is held out: nothing held out, a held-out kind on a template that training has, kinds that training has on the held-out template, and both. Per kind the test split is small: most kinds have fewer than 100 test samples in 40,000. `sampleAt(seed, index, {kind, split: 'test'})` makes a test sample of one kind, so an evaluation set with a fixed number per kind, e.g. 400, can be made besides the samples in their own mix.

## Run it

From the repo's root:

```sh
bun test lab/recovery-parser                               # the invariants, about 3 seconds
bun lab/recovery-parser/check-table-parser.ts              # table-parser.ts against the reference, on about 36,000 texts
bun lab/recovery-parser/check-samples.ts [samples] [seed]  # a second derivation of every sample, by default of 40,000, and the split of every document
bun lab/recovery-parser/stats.ts <file> [samples] [seed]   # statistics, by default of the first 40,000 samples
bun lab/recovery-parser/dump.ts <folder> [seed] [samples]  # text files for reading
```

`stats.ts` writes the counts per source, split, group, kind, family, template and style, the sequences of tokens per template and split, the samples on each side of the rules that exclude each other, what the five readers get right per group and per kind, what two arms can reach at most, and which cells of the two tables the samples reach, at the first error and over whole texts for the four hand rules. `dump.ts` writes two files per kind with 60 samples, one with the whole texts and one cut down to the columns around the damage, `all.txt` with the first 300 samples in the dataset's order, `valid.txt`, and `typing-replays.txt` with whole replays. In these files every code point of a broken text stands above its label and above what the parser as it is shows for it, and the header of a sample that needs a nesting fix or a display fix names the code point at which the loop comes to its limit. Give both a path outside the repo: the files are large and can be made again at any time.

## Files

- `table-parser.ts`: the highlighter as a plain loop over its tables, with the tables as an argument, and a trace of every position. `check-table-parser.ts` compares it with the reference.
- `hand-rules.ts`: the four hand-written settings of the tables, `stay`, `resync`, `words` and `lines`.
- `limits.ts`: what the loop cannot give when only the cells that valid JSON never reads may change: these cells, the two fields `needsNestingFix` and `needsDisplayFix`, the most code points that a run of the loop can have right, and `conditionProblems`, which checks the two conditions on any tables.
- `splits.ts`: the split of a document by its sequence of tokens, and of a text of several documents.
- `labels.ts`: the labels of a valid text, and the sequence of tokens that the split is made of. The depth and the container come from a scan with a real stack that reads neither the reference nor the tables.
- `documents.ts`: the templates and the styles.
- `edits.ts`, `scan.ts`, `random.ts`: edits with their alignment and their canonical form, where the entries, strings and containers of a document are, and random numbers as a hash of the seed, the index and a counter.
- `damage.ts` and `damage/`: the kinds, one file per family, the rules that exclude each other, and the combinations.
- `typing.ts`: the typing replays.
- `samples.ts`: `sampleAt`, `labelsOf`, `groupOf`, `limitsFor` and `mostRightFor`, what is not scored, and what is held out.
- `check-samples.ts`: a second derivation of a sample's alignment, labels, first damage and unscored values, with its own JSON parser and no code of the dataset. Run as a script it also checks, with a sequence of tokens of its own, that no document's sequence is in two splits.
- `stats.ts`, `dump.ts`: the statistics and the text files.
- `invariants.test.ts`: e.g. every original is valid, every broken text is rejected, the edits give the broken text, text before the whole original is added as a whole, every text of a typing replay is what its edits give, the form texts of raw line feeds and of single quotes give the numbers that the edits give, a string without its opening quote has the flag that its row above says, before its first error the parser as it is gives every scored label, the second derivation agrees and notices samples that are spoiled on purpose, the two fields of `limits.ts` are true exactly when no run of the loop has every scored label right, the hand rules read valid documents as before, they and tables that are made to score high stay at or below the bound, and no sequence of more than one token is in two splits, with every record of a text of several documents taken as a document.

`written/` holds a second, small evaluation set: 240 broken texts that agents wrote from what broken JSON looks like where they have seen it, each with the document that its author meant and with two more repairs by agents who saw only the broken text. The writers did not see the generator, and by a judgment per case 194 of their cases have only damage that the kinds above also make, and 46 have damage that no kind makes, e.g. the marks of a diff or the quoted-printable encoding of a mail. The set is for one last evaluation at the end of the experiment. Whoever builds or trains a parser reads nothing under `written/`, also not its README, and uses one call: `scoreTables(tables)` of `written/score.ts`, with any `ParserTables` of `table-parser.ts`. The call returns `all`, `generatorKinds`, `otherDamage` and `unmarked`, each with the two scores `fullAgreement` and `agreedCodePoints`, and a score has `cases`, `nothingToRecover`, `scored`, `right` and `wholeRight`, counted as `stats.ts` counts a sample. The main number is `all.fullAgreement.right / all.fullAgreement.scored`, over the cases in which the writer and the repairers agree on every code point that a score counts. `generatorKinds` and `otherDamage` are the two parts of the set by its damage, and `unmarked` leaves out the cases that a writer or a repairer marked as open to another reading. A report gives all four. `written/README.md` is for those who write, repair or check the set.

## Known limits

- The weights are estimates from three surveys of where broken JSON comes from (hand editing, the output of programs and models, and other notations). Nobody measured them.
- The words of strings come from a small list, and the text of a comment is drawn without a look at the member next to it, e.g. `// in EUR` above a port number. The other side of a merge conflict is a mechanical variant of the kept side, which can read oddly. What follows real files is the syntax: where a comment sits, which characters it holds, how a tool prints.
- No text is past the highlighter's capacity: none is longer than 512 code points, and none is nested deeper than 16 levels, in the original or as the parser as it is counts the brackets of the broken text. E.g. a typing step is left out when an open string hides closing brackets and a brace in the string's content then opens a 17th level.
- The first error of the samples reaches 131 of the 192 error cells of the grammar table that a first error can reach, and 191 of the tokenizer's 620. Most of the others need depth 16, or an error in the middle of a `\u` escape, an exponent or a literal. A reader that goes on after an error reads more cells, and which ones depends on its tables: over whole texts `stay` reads 335 error cells of the grammar table, `resync` 205, and `words` and `lines` 185, and they read 280, 280, 261 and 261 of the tokenizer's. `lines` also reads the cells of the state that it adds. A quarter of the cells that a hand rule reads are reached by 7 samples or fewer in 40,000. Tables that are trained on these samples learn nothing about the cells that no sample makes them read.
- Left out: a document without its outer braces, what Java prints for a map, the layout of Python's `pprint`, and escapes of other languages such as `\0` and `\u{…}`. `\r\n` line ends are left out of typing replays, of texts of several documents apart from one form of `newlineDelimited`, and of `quotedDocument` and `backslashEscapedDocument`, which write a line feed as the two characters `\n`.
- The flag `no` is the strictest reading. It is also given where a rule made for one form would label the sample and that rule excludes rules that far more samples need, e.g. `"note": "call "Ana" back"`, where a rule that shows a word between two strings as a string labels everything and excludes the rule that a string after a complete value is the next key. So tables get a part of these samples right: `words`, one setting for all samples, has 13.9% of the samples of the group "out of reach" right as a whole. `needsClass` is strict in the same way: a string in single quotes with a space in it needs the apostrophe as a quote, and tables that read words still have most of its code points right.
- `needsNestingFix` and `needsDisplayFix` prove what the loop cannot give, and a sample without them is not shown to be within reach: the group "within reach of the tables" rests on the judgments `yes` and `needsClass` of its forms, on the assumption that the tables get the states they need, and on nobody having found an obstacle. The bound of the arm that changes tokenizer cells is as loose as the two conditions are. After the first cell that valid JSON never reads it lets tables give any event to any code point, which no table that follows a rule does, and how much such a table loses against the bound is not known: the best hand rule has 92.3% of the code points and 75.3% of the samples right, where the bound says 97.9% and 92.4%.
- The record types of the texts of several documents are narrow outside train, see the splits above: few lists of sequences per type, e.g. `records: pair` none in validation and 1 in test, and records of more than one sequence in 16 of the 319 texts outside train. It matters to an arm that sees tokens, and not to tables, which read cells.
- A few very short broken texts are in train and outside it. Of the 11,087 broken samples outside train among the first 40,000, 56 have a broken text that a train sample has too, e.g. `{`, `[`, `0.` and `{...}`. 37 of them are a `{` or a `[` alone, a document cut off after its first bracket, and 47 have nothing to recover. Their originals differ, so no original is in two splits. It cannot be avoided for a text of a few code points.
- A typing text with `.` or `m` in the place of a comma has the kinds `missingComma` and `typingSlip`, e.g. `"price":"49.60"."status"`, where the damage kind `typingSlip` alone describes the same text. In the typing text the wrong character is added and has no label, and in the damage kind it stands for the comma and has the comma's label. Both are right, and the counts per kind differ by a few samples: 6 such typing texts in 40,000.
- The place of the damage follows the surveys, so several frequent kinds damage the end of a text, e.g. half of the trailing commas sit in the last tenth, and such a sample has few code points to score. The score per code point is carried by the samples with early damage, which is why `stats.ts` also prints the share of samples that are right as a whole and the mean of the samples' own shares.
