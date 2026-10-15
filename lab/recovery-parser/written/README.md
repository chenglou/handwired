# Broken JSON written by hand

This folder holds a small evaluation set of broken JSON. Agents wrote its cases from what broken JSON looks like where they have seen it, e.g. in the output of a program, in a file that a person edits, or in the answer of a language model.

**The set is for one last evaluation at the end of the experiment.** Nobody who builds or trains a parser reads the files in `cases/` and `repairs/`, or prints a case with the tools of this folder: a parser that was shaped by a look at the cases says nothing about broken JSON that nobody has seen. [The set as it is](#the-set-as-it-is) gives the set's numbers and says how other code scores its tables on the set without a look at a case.

The page up to that heading is for a writer of cases, and it says everything a writer needs.

## What a case is

A case is a broken text and the document that its author meant, which is called the intended text. E.g. a Python program prints `{'paid': True}`, and its author meant `{"paid": true}`.

The set tests a JSON highlighter that goes on after an error. The highlighter gives every code point of a text three values: what the code point is shown as (white space, punctuation, a string, an escape, a number, a literal or a key), how many containers are open after it, and whether the innermost open container is an object or an array. For a broken text, the right values are those of the intended text: the `p` of `{'paid': True}` is a part of a key, at depth 1, inside an object, because the `p` of `{"paid": true}` is.

So the tools pair every code point of the broken text with its counterpart in the intended text. They get no list of changes from you. They work the changes out from the two texts alone, and they take every code point that the changes did not touch for the same code point in both texts. That is why the rules below are strict about the two texts.

After you, two other agents each repair your broken text without seeing your intended text. A code point of the broken text is scored only where your intended text and the two repairs give it the same values. A code point where they differ is called disputed and is kept apart.

## The rules

1. **The intended text is one valid JSON document: the one that the author of the broken text meant.** For a text that is cut off, it is the whole document, with an end that fits its start. Two lines of a log with one document each are two documents and cannot be a case. One such line can, with its time stamp as text that was added before the document.

2. **The broken text is the intended text with the damage, and with no other change.** Do not lay the text out anew, do not reorder keys, and do not change a value that the damage leaves alone. The same indentation, the same line ends and the same spaces stand in both texts, wherever the damage did not touch them. E.g. when the damage is a missing comma, the two texts differ by that one comma. Write the intended text first, copy it, and then damage the copy.

3. **Where the broken text has other text before the document, the intended text starts with the document's first character.** White space between that other text and the document goes with the other text. The same holds after the document. E.g. for a broken text that is a sentence, an empty line, a code fence, the document, a line feed and the closing fence, the intended text is the document alone, without a line feed at its end. On a side where the broken text has only white space, e.g. one line feed after the last brace of a file, the intended text has that same white space.

4. **A line inside the document that is no part of the document is added as a whole line, with its indentation and its line end.** E.g. a comment on a line of its own, or a marker line of a merge conflict. So the intended text is the broken text without that line. A comment at the end of a line that also holds a part of the document is added together with the white space before it: for `"port": 8080, // was 3000` the intended text has `"port": 8080,` and its line end.

5. **The content is realistic.** Keys and values are what such a text holds in real use, e.g. `"retries": 3` or `"shippedAt": null`, and not `foo` and `bar`. The damage is what your source really produces, in the places where it produces it. Vary the documents: other shapes, other sizes, other layouts.

6. **The broken text has 20 to 500 code points.** Most of your broken texts have between 60 and 300, and about a third of them are on several lines.

7. **Both texts fit the highlighter:** at most 512 code points, and brackets nested at most 16 levels deep.

8. **No two cases have the same broken text, and every case has its own id.**

Mark a case as `debatable` when another repair is as sensible as your intended text and would change what a kept code point is. E.g. in `{"name": "Ada"}, "active": true}` the first `}` may be one brace too many, or the text after it may be the mistake. Say the other repair in the note.

## The file

Your cases go into one text file in `lab/recovery-parser/written/cases/`, with a name that says your source, e.g. `python-print.txt`. The file is UTF-8 with plain line feeds. A case looks like this:

```
⟦case python-print-01⟧
from: what a Python program prints for a dict
⟦intended⟧
{"order_id": 48213, "paid": true, "coupon": null, "items": ["tea", "filter"]}
⟦broken⟧
{'order_id': 48213, 'paid': True, 'coupon': None, 'items': ['tea', 'filter']}
⟦end⟧
```

- `⟦case id⟧` starts a case. The id is made of letters, digits, dots, hyphens and underscores. Start it with your file's name, so that no other writer has the same id.
- `from: …` says in one line where such a broken text comes from. Every case has it.
- `note: …` is one optional line for anything a reader should know, e.g. the other repair of a debatable case.
- `debatable` is the optional mark, the word alone on its line.
- `⟦intended⟧` and `⟦broken⟧` each start a text, and `⟦end⟧` ends the case. A marker stands alone on its line, from the line's first character on. Copy the two brackets `⟦` and `⟧` from this page: they are U+27E6 and U+27E7, and no other bracket works.
- Empty lines between two cases are fine.

A text is written as it is. Quotes and backslashes need no escaping: what stands between the two marker lines is the text, character for character. The lines are joined with line feeds, and the line feed before the next marker line is not a part of the text. So the intended text of this case ends with `}`:

````
⟦case model-answer-01⟧
from: the answer of a language model, with a sentence and a code fence around the document
⟦intended⟧
{
  "city": "Lisbon",
  "wind": {"dir": "NW", "kmh": 14}
}
⟦broken⟧
Sure! Here is the JSON:

```json
{
  "city": "Lisbon",
  "wind": {"dir": "NW", "kmh": 14}
}
```⟦lf⟧
⟦end⟧
````

The broken text of this case ends with a line feed after the closing fence, which is written `⟦lf⟧`. The intended text follows rule 3: it starts with `{` and ends with `}`.

### Characters that cannot be seen

A character that cannot be seen is written as a name between `⟦` and `⟧`, and the file is refused when such a character stands in it as itself. That way a text holds exactly what the file shows.

| Written | Character |
| --- | --- |
| `⟦tab⟧` | a tab |
| `⟦cr⟧` | a carriage return |
| `⟦lf⟧` | a line feed, where a line break in the file cannot say it: at the very start or the very end of a text |
| `⟦sp⟧` | a space, where it cannot be seen: the last character of a line |
| `⟦nbsp⟧` | a no-break space, U+00A0 |
| `⟦bom⟧` | a byte order mark, U+FEFF |
| `⟦esc⟧` | the escape character, U+001B, as in the color codes of a terminal |
| `⟦U+200B⟧` | any other character by its code point, with 4 to 6 hexadecimal digits, e.g. a zero width space |

Four things follow:

- A tab is always `⟦tab⟧`, also in the indentation. The same holds for every control character, every space that is not the plain space, and every character without a width, e.g. a zero width joiner inside an emoji.
- A line of a text does not end with a plain space. Write the last space as `⟦sp⟧`, e.g. `"port": 8080,⟦sp⟧`.
- A text does not start or end with an empty line. A text that ends with a line feed has `⟦lf⟧` at the end of its last line, and one that ends with two has `⟦lf⟧⟦lf⟧`. Empty lines in the middle of a text are fine.
- The brackets themselves are `⟦U+27E6⟧` and `⟦U+27E7⟧` inside a text.

This case is a file from Windows with a byte order mark, tabs, and lines that end with a carriage return and a line feed:

```
⟦case windows-file-01⟧
from: a file saved on Windows by a program that puts strings between quotes without escaping them
note: the path could also be meant with forward slashes
debatable
⟦intended⟧
{⟦cr⟧
⟦tab⟧"name": "Zoë",⟦cr⟧
⟦tab⟧"path": "C:\\Users\\zoe"⟦cr⟧
}
⟦broken⟧
⟦bom⟧{⟦cr⟧
⟦tab⟧"name": "Zoë"⟦cr⟧
⟦tab⟧"path": "C:\Users\zoe"⟦cr⟧
}
⟦end⟧
```

## Check your file

From the repo's root:

```sh
bun lab/recovery-parser/written/check-cases.ts lab/recovery-parser/written/cases/python-print.txt
```

The check prints every case back as the tools read it, and its last line is e.g. `40 cases, 0 problems`. Run it until that line says 0 problems, and read what it prints for every case: a case without a problem can still be a case that the tools read in another way than you meant.

A line that starts with `problem:` names something that keeps a case out of the set: the format of the file, an intended text that is not valid JSON, a broken text that is valid JSON, a text that is too long or nested too deep, a broken text outside 20 to 500 code points, an id or a broken text that stands twice.

A line that starts with `look at:` names something that may be right and often is a mistake, e.g. that the tools can pair less than half of the broken text with the intended text, which is what a text looks like that was laid out anew.

For the first case above the check prints:

```
--- python-print-01  from: what a Python program prints for a dict
    intended: 77 code points on 1 line. broken: 77 code points on 1 line.
    first damage at 1, first error of the parser as it is at 1 (unexpectedCharacter), 68 scored code points from there on
    what the tools take for the damage:
      added at 28 to 31: "True"
      removed before 32: "true"
      added at 44 to 47: "None"
      removed before 48: "null"
      in the place of another: ' for ", at 1, 10, 20, 25, 34, 41, 50, 56, 60, 64, 67, 74
orig  {"order_id": 48213, "paid": true, "coupon": null, "items": ["tea", "filter"]}
label pkkkkkkkkkkpwnnnnnpwkkkkkkpwllllpwkkkkkkkkpwllllpwkkkkkkkpwpssssspwsssssssspp
depth 11111111111111111111111111111111111111111111111111111111111222222222222222210
cont  oooooooooooooooooooooooooooooooooooooooooooooooooooooooooooaaaaaaaaaaaaaaaao-

brok  {'order_id': 48213, 'paid': True, 'coupon': None, 'items': ['tea', 'filter']}
align .~........~.........~....~..++++..~......~..++++..~.....~...~...~..~......~..
want  pkkkkkkkkkkpwnnnnnpwkkkkkkpw    pwkkkkkkkkpw    pwkkkkkkkpwpssssspwsssssssspp
wantd 1111111111111111111111111111    111111111111    11111111111222222222222222210
wantc oooooooooooooooooooooooooooo    oooooooooooo    oooooooooooaaaaaaaaaaaaaaaao-
now   pEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE
nowd  11111111111111111111111111111111111111111111111111111111111111111111111111111
nowc  ooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo
miss   kkkkkkkkkkkkkkkkkkkkkkkkkkk    kkkkkkkkkkkk    kkkkkkkkkkk****************k*
first  ^
```

**The list under "what the tools take for the damage" is the first thing to read.** It must be the damage that you made, and nothing else. Positions count the code points of the broken text from 0. `added` is text of the broken text that has no counterpart, `removed before 32` is text of the intended text that the broken text lacks at that place, and `in the place of another` lists the code points that stand one for one for another, here every `'` for a `"`. If the list holds a change that you did not mean, e.g. a removed space, the two texts differ by more than the damage: fix the texts.

The rows show one column per code point. A line feed is shown as `⏎`, a tab as `→`, a carriage return as `↵`, a no-break space as `⍽`, a byte order mark as `◊`, the escape character as `␛`, and a character that takes two columns as `◆`. A text of more than 120 code points is printed in blocks of 120 columns.

| Row | What it shows |
| --- | --- |
| `orig` | the intended text |
| `label` | what each of its code points is shown as: `w` white space, `p` punctuation, `s` string, `e` escape, `n` number, `l` literal, `k` key |
| `depth` | the number of open containers after the code point, `0` to `9` and then `a` to `g` for 10 to 16 |
| `cont` | the innermost open container after the code point: `o` an object, `a` an array, `-` none |
| `brok` | the broken text |
| `align` | `.` a kept code point, `~` one that stands in the place of another, `+` an added one |
| `want`, `wantd`, `wantc` | the three values that the code point takes from its counterpart. Blank under an added code point, and `?` where a value is not scored |
| `now`, `nowd`, `nowc` | what the highlighter gives today, which the check calls the parser as it is. `E` is an error: today it shows everything after its first error so |
| `miss` | where today's highlighter differs from `want`: `k` the kind, `d` the depth, `c` the container, `*` more than one |
| `first` | `^` under the code point where today's highlighter reports its first error, and `d` under the first damaged code point when that comes earlier |

Read the `align` row against the `brok` row: every `+` and every `~` is damage, and every `.` is a code point that you left alone. Then read `want`: it is what a highlighter that recovers must show for your broken text.

A `?` in the `want` rows stands for a value that no highlighter can be asked for, so it is not scored. The rules are those of the dataset:

- After a bracket that is missing, the depth and the container are not scored up to the next bracket, since nothing in the broken text shows that a container started or ended. E.g. in `"tags": "tea", "filter", "count": 2}` for `"tags": ["tea", "filter"], "count": 2}` they are not scored from `"tea"` up to the last brace, also for the key `"count"`.
- The display kind of a quote that lost its backslash is not scored: in `"call "Ana" back"` the inner quotes were the second halves of `\"`, and no reader of the broken text can show them as an escape. The same holds for what reads as an escape after a backslash that lost its second half, e.g. the `t` of `C:\temp` for `C:\\temp` in a text that is broken at another place.
- The display kind of the start of a value that lost its quotes is not scored where that start reads as a number or a literal, e.g. the `2031` of `"due": 2031-07-04`, which is wanted as a string.
- Before the first error of today's highlighter, a value that today's highlighter does not give is not scored, since the experiment changes only what the highlighter does from its first error on. E.g. after a quote too many in `{"retries": "3, "host": "db"}`, today's highlighter reads `3, ` and the quote after it as the rest of a string, without an error, so the display kind of these four code points is not scored.

A score counts the code points from the `^` on that have a value in the `want` rows. A case where the header says "no scored code point from there on" has nothing to recover, e.g. a text that is cut off, where every code point after the cut is missing. Such a case is fine, and a file should hold few of them.

## What the tools cannot know

The tools see two texts. Some things about the damage are not in the texts, and the tools then read the damage by a fixed rule:

- **A word in the place of a literal or a number has no values.** `True`, `None`, `nil`, `undefined`, `NaN`, `0x1F` and the `%t` of a format string are shown as added, and the literal or number as removed: the highlighter has nothing to show a word as that is not JSON's. The same happens to a literal with a slip in it, e.g. `ture`, and to a number with a decimal comma, e.g. `3,5`. A literal or number that only lost code points keeps its values, e.g. `tru`, `59.` and the `409` of `"size":409"...`, and so does a number with text added around it or between its digits, e.g. `NumberLong(15)` and `1,400,000`. It is another word when a code point that can be a part of a word stands right against what is left of it, i.e. any code point but white space, JSON's punctuation, a quote mark and a round bracket. So the `12` of `12...` for `12.5` has no values, and neither has the `7` of `−7` for `-7`, where the first character is the true minus sign.
- **A code point stands one for one for another only in a few parts:** a quote mark for a quote, e.g. `'` and `“`, a bracket for a bracket of the same direction, e.g. `)` for `]`, `=` or `;` for a colon, `;` for a comma, and white space for white space, e.g. a no-break space for a space. Any other code point in another one's place is added, e.g. the `m` of `"a": 1m "b": 2` where the comma was meant, and a `’` for the `'` inside a string.
- **Of two equal code points, the later one is the added or the removed one.** E.g. when a comment line is added, the `align` row marks the comment's text, its line feed and the indentation of the next line as added, and takes the indentation before the comment for the kept one. Both readings give the kept code points the same values, so nothing is wrong. The values can stand under another code point than the one that a reader takes for the document's, e.g. under the `{` of a template tag `{% for … %}` on the line before an object, and under the `3` of a color code `[0;39m` right before the number `3`. In the same way, of a `)` and a `]` that could both stand for the brace that ends the document, the earlier one does, e.g. the `)` of `Wrapper(5)]`.
- **A chance match can pair a code point with the wrong counterpart.** It happens where the broken text holds added text and lacks a long part of the intended text at the same place, e.g. a text that is cut off and ends with `[truncated]`: a letter of the marker can be paired with the same letter in the part that is missing. The `align` row then has a `.` under a letter of the marker. The tools drop such a match of up to 3 code points when the changes on both of its sides are longer than it, and they drop every such match after the cut of a text that is cut off. A match of 4 code points or more can stay, and so can a shorter one between two short changes in the middle of a text, e.g. the `3` of `... (3 more)` in the place of three numbers. The dots of `...` in the place of entries can be paired with dots inside the entries that are missing, e.g. with those of `"0.2.0"`. A short part of the document between two long changes can be taken for a chance match, e.g. the `}` of `"port": 80, ...}, ...]`. Three short parts are never taken for one: what stands between two changes of one kind, e.g. the `:` of `&quot;:&quot;`, and the document's first code points after text before the document and its last code points before text after it, when the change on their other side only removes text or stays inside one value, e.g. the `}` between `NaN` and a closing code fence.
- **Text around the document can hold what the document's start or end looks like.** The tools take the changes that touch the fewest code points. E.g. after a line `  }` that is missing right before the last `}` and a closing code fence, they take the `}` that is left for the inner brace and the last one for missing, which changes fewer code points than the other reading. And where every quote of the document is replaced, e.g. by `&quot;`, a `[` and a `"` in a log prefix before the document can be taken for the document's first brace and the quote of its first key.

When the list of changes is not the damage that you made, look for an unintended difference between your two texts first. If there is none, and the tools read the damage in another way than you meant by one of these rules, keep the case and say in its note what the tools get wrong.

## What happens with the cases

- `blind.ts` writes the broken texts of all writers into part files, in a shuffled order and under ids that say nothing about the case.
- Two repairers per part write repairs, by the rules of `REPAIR.md`. Their files go into `repairs/`.
- `written.ts` reads `cases/` and `repairs/`. Per case it gives the opinions, i.e. your intended text and the repairs, the values of every code point by each opinion, and which code points are agreed, added by every opinion, or disputed. A value that the reading of one opinion does not score, by the rules of the `?` above, is no dispute with another opinion. `bun lab/recovery-parser/written/written.ts --disputed` prints every case with a disputed code point, opinion by opinion.
- `left-out.txt` names the repairs that are left out of their case because they plainly break a rule of `REPAIR.md`. A line is the repair file without its ending, the id of the broken text, and the reason.
- `no-label.txt` names text of a broken text that has no label, whatever the opinions make of it: `written.ts` takes it out before it holds the opinions against each other, so its code points are not scored and are no dispute. A line is the id of the case, the position of the text's first code point in the broken text, the reason, a colon and a space, and the text as a case file writes it, e.g. `⟦lf⟧` for a line feed. [Text without a label](#text-without-a-label) says what is on the list.
- `score.ts` prints what today's highlighter and four hand-written settings of its tables get right on the set, and `scoreTables` scores any other tables.
- `align.ts` pairs the code points of a broken text with those of a valid text, and `check-align.ts` measures it on generated samples whose changes are known: in 5,700 of them it finds the known pairing for 97.1% of the texts and for 99.96% of the code points. Taken as cases of this set, the same samples give today's highlighter and the four hand-written settings the scores that the samples' own values give, within 0.1 points per code point and about half a point per sample.
- `format.ts` reads and writes the files, `show.ts` prints a case, `check-repairs.ts` is the check for a repairer, and `written.test.ts` tests the folder.

## The set as it is

The set has 240 cases: six writers wrote 40 each, every writer from one source of broken JSON, and every broken text was repaired twice more by agents who saw only the broken text. It is used once, at the end of the experiment, to see how far a result on the generated samples carries over to damage that the generator's rules did not make. Whoever builds or trains a parser does not read `cases/`, `repairs/` and `left-out.txt`, and does not run `written.ts --disputed` or the two checks, which print cases. `score.ts` and the function below print numbers alone.

### How other code scores its tables

`scoreTables` of `score.ts` takes any `ParserTables` of `../table-parser.ts` and reads the set by itself. From a file in `lab/recovery-parser/`:

```ts
import {scoreTables} from './written/score.ts'
const {all, perFile} = scoreTables(tables)
console.log(all.fullAgreement.right / all.fullAgreement.scored, all.fullAgreement.wholeRight / (all.fullAgreement.cases - all.fullAgreement.nothingToRecover))
```

- `all` is a `WrittenScore`, and `perFile` maps each writer's file, e.g. `model-output.txt`, to one.
- A `WrittenScore` has two scores. `fullAgreement` counts the cases without a disputed code point from the first error on, and it is the set's main number. `agreedCodePoints` counts all cases and leaves the disputed code points out.
- A `Score` has `cases`, `nothingToRecover`, `scored`, `right`, `wholeRight`, and per value `kindScored`, `kindRight`, `nestingScored`, `depthRight` and `containerRight`. It counts as `stats.ts` counts a sample: over the code points from the first error of today's highlighter on that have a scored value, a code point is right when every scored value is right, and a case is right as a whole when all of its counted code points are.

`scoreCases(tables, cases)` scores a part of the set, with the cases of `readWritten().cases`. A reader that is no setting of the tables takes what a score needs from the same cases: `broken`, `firstErrorPosition`, and `labelsOfWritten(writtenCase)`, which has one label per code point of the broken text, as `labelsOf` has for a sample.

### What the set holds

| Writer's file | Cases | With full agreement | With a disputed code point | Scored code points | Of them in cases with full agreement |
| --- | --- | --- | --- | --- | --- |
| `documents-and-web.txt` | 40 | 37 | 3 | 3,772 | 3,613 |
| `hand-editing.txt` | 40 | 37 | 3 | 2,661 | 2,483 |
| `logs-and-transport.txt` | 40 | 38 | 2 | 3,563 | 3,339 |
| `merges-and-tools.txt` | 40 | 36 | 4 | 3,142 | 2,852 |
| `model-output.txt` | 40 | 38 | 2 | 3,547 | 3,498 |
| `other-notations.txt` | 40 | 36 | 4 | 3,987 | 3,609 |
| All | 240 | 222 | 18 | 20,672 | 19,394 |

The broken texts have 35,429 code points, and 27,048 of them stand from the first error of today's highlighter on. Of these, 20,672 are scored, 5,924 are added by every opinion, 224 have no label by the list of `no-label.txt`, and 228 are disputed. In 193 cases all opinions are the same text, and in 29 more they differ without a disputed code point from the first error on, e.g. a repair adds `null` where the writer knows the value that is missing, or the opinions differ only on text of the list.

7 cases have nothing to recover. A text that only stops early and a whole document with other text after it have no code point to score, as in the dataset, so the writers kept such cases few, and the set says nothing about them.

No broken text and no intended text of the set is among the first 60,000 generated samples of the default seed, of which 57,016 are broken: neither as the same text nor as the same JSON value.

### Text without a label

Two sorts of text have no label in the dataset, and the opinions of a case keep them in different ways. `no-label.txt` lists every such text of the set, and its code points have no label: they are not scored, and they are no dispute.

- **A placeholder without quotes that stands where a value is meant.** E.g. `{"userId": {{user_id}}, "active": true}` in the body of a saved request, where a number will stand. The generator's kind `templatePlaceholder` puts such text in the place of the whole value and gives it no label. In the set, a writer who knew the value wrote the value, and a repairer put quotes around the placeholder, as rule 4 of `REPAIR.md` says. So the same sort of text was scored as a string in one case and disputed in the next. The list has 18 placeholders in 11 cases: variables of templates and of saved requests, e.g. `{{user_id}}` and `${USER_ID}`, the verbs of a format string, e.g. `%d`, a name between angle brackets for a key that the reader has to fill in, a mark in the place of a secret that a script took out, the `[Object]` that Node prints for an object that lies too deep, and a note to self in the place of a password.
- **A line feed that stands for a space, inside a string that a program wrapped.** E.g. a mail program breaks a long line at a space of a string. The generator's form of `rawLineFeedInString` for a wrapped string removes the space and adds the line feed, so the line feed has no label there. The tools of this folder take the line feed for the space and give it the label of the string. The list has 4 such line feeds in 3 cases.

The edge of the first rule is the value: the list holds text that stands for a value that is not in the broken text. A value that is there, and only lacks its quotes or has another form, is no placeholder, and it is labeled as the dataset labels its kinds `unquotedValue`, `numberFormat` and `foreignLiteral`:

- A word or a date where a string is meant has the string's label, and the display kind of a start that reads as a number or a literal is not scored, e.g. the `2031` of `"due": 2031-07-04`. The word that a model writes without quotes where its source says nothing, in `model-output-32`, is such a word: it is the value that the answer gives, and all three opinions take it for a string.
- A number with text added to it keeps the labels of its digits, e.g. those of `1,400,000` and of `+5`, and the added text has none.
- A word of another notation in the place of a literal or a number has no label, e.g. `True`, `nil` and `0x1F`.

Where the opinions of a case differ on which of these three a text is, the text is disputed, e.g. `yes` as `true` or as the string `"yes"`, and `$9.99` as a number or as a string.

With the list, 5 cases that were disputed have full agreement, and 224 code points from the first error on have no label: 107 of them were disputed, 113 were scored as a string, and 4 are the line feeds. One of the 11 cases is `documents-and-web-33`, whose `from` line says that a number will stand in the place of its variable, and whose intended text has a string there, as both repairs have by rule 4. None of the variable's code points is scored now, so the case stays as it is.

### What five readers get right

`now` is today's highlighter, and the other four are the hand-written settings of `../hand-rules.ts`. Each cell is the percentage of the scored code points that are right, then the percentage of the cases with something to recover that are right as a whole. `bun lab/recovery-parser/written/score.ts` prints the same numbers.

| Cases | Count | Nothing to recover | Scored code points | `now` | `stay` | `resync` | `words` | `lines` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cases with full agreement | 222 | 6 | 19,394 | 22.0 / 1.9 | 50.4 / 17.1 | 62.5 / 44.0 | 75.6 / 48.6 | 76.1 / 49.1 |
| All cases, the agreed code points | 240 | 7 | 20,672 | 21.4 / 2.1 | 50.4 / 18.0 | 62.7 / 44.2 | 76.5 / 49.4 | 76.9 / 49.8 |
| `documents-and-web.txt`, full agreement | 37 | 1 | 3,613 | 15.3 / 0.0 | 56.5 / 16.7 | 78.5 / 63.9 | 89.0 / 66.7 | 89.0 / 66.7 |
| `hand-editing.txt`, full agreement | 37 | 2 | 2,483 | 31.2 / 0.0 | 60.8 / 17.1 | 72.3 / 40.0 | 82.4 / 54.3 | 82.4 / 54.3 |
| `logs-and-transport.txt`, full agreement | 38 | 3 | 3,339 | 20.5 / 2.9 | 40.1 / 8.6 | 51.3 / 37.1 | 56.4 / 40.0 | 56.4 / 40.0 |
| `merges-and-tools.txt`, full agreement | 36 | 0 | 2,852 | 18.8 / 2.8 | 49.1 / 25.0 | 54.8 / 50.0 | 73.5 / 55.6 | 73.5 / 55.6 |
| `model-output.txt`, full agreement | 38 | 0 | 3,498 | 40.3 / 5.3 | 57.2 / 21.1 | 73.7 / 50.0 | 79.5 / 52.6 | 82.0 / 55.3 |
| `other-notations.txt`, full agreement | 36 | 0 | 3,609 | 8.3 / 0.0 | 40.9 / 13.9 | 45.4 / 22.2 | 73.2 / 22.2 | 73.2 / 22.2 |

Every reader gets less right here than on generated samples: for the broken samples of one document among the first 6,000, `check-align.ts` prints 41.7% of the code points for `now`, 73.8% for `stay`, 82.7% for `resync`, 91.4% for `words` and 91.3% for `lines`.

### Where the opinions differ

When the repairs came in, 27 cases had a disputed code point from the first error on. Each of them was read with its three opinions side by side and put into one of five sorts:

| What the dispute is | Cases | What was done |
| --- | --- | --- |
| The opinions read the text differently | 18 | They stay disputed, with 228 code points |
| A placeholder stands where a value is meant, and the opinions keep it in different ways | 5 | The placeholders are on the list of `no-label.txt`, and the cases now have full agreement |
| The tools gave the same reading other counterparts | 2 | The tools were changed, and both cases now have full agreement |
| A repair is against a rule of `REPAIR.md` | 2 | The repair is left out, and both cases now have full agreement |
| The writer's intended text does not follow from the broken text by the damage alone | 0 | |

The 18 cases that stay disputed, by what the opinions differ on:

| What the opinions differ on | Cases | Disputed code points |
| --- | --- | --- |
| A value stands in a form that JSON lacks, e.g. a number with a currency sign, a number as the expression that computes it, an amount inside a call, or a word for a literal. One opinion writes the value that is meant, e.g. the number, and another makes a string of what stands there, as rule 4 of `REPAIR.md` says for a value without quotes | 5 | 41 |
| A program changed a character inside a string on the way, e.g. two hyphens into a dash. One opinion puts the character back that was meant, and another keeps what stands there as the string's content | 7 | 25 |
| Of two things in the text one is too many, e.g. the two sides of a merge conflict, and the opinions keep different ones | 3 | 142 |
| The writer knows of content that the broken text lacks, and `REPAIR.md` tells a repairer not to invent it, e.g. the entry after the last comma of a text that is cut off | 2 | 3 |
| The opinions mean the same document and keep other white space and another of two commas, where a wrapper that is removed runs over three lines and the rules do not say which white space goes with it | 1 | 17 |

- A value or a string: `documents-and-web-37`, `model-output-23`, `other-notations-08`, `other-notations-25`, `other-notations-29`.
- A character inside a string: `documents-and-web-05`, `documents-and-web-06`, `hand-editing-22`, `logs-and-transport-15`, `logs-and-transport-31`, `merges-and-tools-12`, `merges-and-tools-35`.
- One of two too many: `hand-editing-17`, `hand-editing-24`, `merges-and-tools-04`.
- Content that is not invented: `merges-and-tools-11`, `model-output-12`.
- White space: `other-notations-21`.

The 5 cases with a placeholder are `merges-and-tools-27`, `merges-and-tools-29`, `merges-and-tools-31`, `merges-and-tools-32` and `other-notations-12`, with 107 code points that were disputed.

The writers marked 31 cases as debatable, and 3 of those are among the 18. In 14 of the 18 a repairer marked the repair as unsure.

The two cases where the tools were wrong are `logs-and-transport-02`, with 1 disputed code point, and `model-output-22`, with 6. In both, `align.ts` took a short part of the document for a chance match, i.e. the first brace after a log prefix and the last two braces before a closing code fence, and one repairer had written the repair in another way to get around that. `align.ts` no longer takes such parts for chance matches, see the list under "What the tools cannot know". In `model-output-22` that repair still puts the missing bracket at another place among the white space than the writer and the other repair do, which gives three white space code points another depth. `written.ts` no longer takes that for a dispute: a value that the reading of one opinion does not score is no dispute with another opinion, and by the rule on a missing bracket the repair's reading does not score the depth there.

The same change of `align.ts` gives values to the short parts between two replaced quotes in `documents-and-web-10`, `documents-and-web-15`, `logs-and-transport-33` and `merges-and-tools-36`. The notes of these four cases, of `logs-and-transport-02` and of `model-output-22` describe how the tools read the case before the change.

### What is left out

- No case is left out, and no text of a case was changed.
- Two repairs are left out, both from `repairs/a-part-3.txt`: the one of `logs-and-transport-11` and the one of `logs-and-transport-14`. Each keeps white space that stands after text that follows the document. `REPAIR.md` asks for a repair that ends with the document's last character where text after the document is removed, and the writer's intended text and the other repair do. With the repair, each case had the kept white space as its only dispute, 1 and 2 code points. Without it, each case has the writer's opinion and one repair, which agree.
