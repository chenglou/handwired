# Broken JSON written by hand

This folder holds a small evaluation set of broken JSON. Agents write its cases from what broken JSON looks like where they have seen it, e.g. in the output of a program, in a file that a person edits, or in the answer of a language model. This page is for a writer of cases, and it says everything a writer needs.

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

A `?` in the `want` rows stands for a value that no highlighter can be asked for, so it is not scored. E.g. after a bracket that is missing, the depth is not scored up to the next bracket, since nothing in the broken text shows that a container ended. And the display kind of a quote that lost its backslash is not scored: in `"call "Ana" back"` the inner quotes were the second halves of `\"`, and no reader of the broken text can show them as an escape.

A score counts the code points from the `^` on that have a value in the `want` rows. A case where the header says "no scored code point from there on" has nothing to recover, e.g. a text that is cut off, where every code point after the cut is missing. Such a case is fine, and a file should hold few of them.

## What the tools cannot know

The tools see two texts. Some things about the damage are not in the texts, and the tools then read the damage by a fixed rule:

- **A word in the place of a literal or a number has no values.** `True`, `None`, `nil`, `undefined`, `NaN` and `0x1F` are shown as added, and the literal or number as removed: the highlighter has nothing to show a word as that is not JSON's. The same happens to a literal with a slip in it, e.g. `ture`, and to a number with a decimal comma, e.g. `3,5`. A literal or number that only lost code points keeps its values, e.g. `tru` and `59.`, and so does a number with text added around it or between its digits, e.g. `NumberLong(15)` and `1,400,000`.
- **A code point stands one for one for another only in a few parts:** a quote mark for a quote, e.g. `'` and `“`, a bracket for a bracket of the same direction, e.g. `)` for `]`, `=` or `;` for a colon, `;` for a comma, and white space for white space, e.g. a no-break space for a space. Any other code point in another one's place is added, e.g. the `m` of `"a": 1m "b": 2` where the comma was meant.
- **Of two equal code points, the later one is the added or the removed one.** E.g. when a comment line is added, the `align` row marks the comment's text, its line feed and the indentation of the next line as added, and takes the indentation before the comment for the kept one. Both readings give the kept code points the same values, so nothing is wrong.
- **A chance match can pair a code point with the wrong counterpart.** It happens where the broken text holds added text and lacks a long part of the intended text at the same place, e.g. a text that is cut off and ends with `[truncated]`: a letter of the marker can be paired with the same letter in the part that is missing. The `align` row then has a `.` under a letter of the marker. The tools drop such matches of up to 3 code points, and a longer one can stay.

When the list of changes is not the damage that you made, look for an unintended difference between your two texts first. If there is none, and the tools read the damage in another way than you meant by one of these rules, keep the case and say in its note what the tools get wrong.

## What happens with the cases

- `blind.ts` writes the broken texts of all writers into part files, in a shuffled order and under ids that say nothing about the case.
- Two repairers per part write repairs, by the rules of `REPAIR.md`. Their files go into `repairs/`.
- `written.ts` reads `cases/` and `repairs/`. Per case it gives the opinions, i.e. your intended text and the repairs, the values of every code point by each opinion, and which code points are agreed, added by every opinion, or disputed. `bun lab/recovery-parser/written/written.ts --disputed` prints every case with a disputed code point, opinion by opinion.
- `score.ts` prints what today's highlighter and four hand-written settings of its tables get right on the set, and `scoreTables` scores any other tables.
- `align.ts` pairs the code points of a broken text with those of a valid text, and `check-align.ts` measures it on generated samples whose changes are known: in 5,700 of them it finds the known pairing for 96.7% of the texts and for 99.95% of the code points. Taken as cases of this set, the same samples give today's highlighter and the four hand-written settings the scores that the samples' own values give, within 0.1 points per code point and 1 point per sample.
- `format.ts` reads and writes the files, `show.ts` prints a case, `check-repairs.ts` is the check for a repairer, and `written.test.ts` tests the folder.
