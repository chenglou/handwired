# Repairing broken JSON

You get a part file with broken JSON texts, and you write one repair per text into a repair file. This page says everything a repairer needs.

## What a repair is for

Each broken text was written together with the document that its author meant. You do not see that document. Your repair is a second opinion about what the author meant, and another repairer writes a third.

The texts test a JSON highlighter that goes on after an error. The tools pair every code point of the broken text with its counterpart in a repair, and the code point then counts as what its counterpart is: a part of a key or of a string, a number, punctuation or white space, at the depth and in the container that the counterpart has in the repair. A code point of the broken text that has no counterpart is taken for text that the damage added.

A code point is scored only where the three opinions say the same about it. So what matters in a repair is which characters of the broken text you keep, and where they end up in the document. What you add matters little, e.g. `null` or `0` for a value that is missing.

## The rule

**Write the valid JSON document that the author most likely meant.** It is one document.

1. **Keep every character that belongs to that document exactly as it stands in the broken text:** the same characters in the same order, with the same indentation, the same line ends and the same spaces. Do not lay the text out anew, do not sort keys, and do not correct what is not broken, e.g. a key that stands twice or a value that looks wrong.
2. **Remove what is not a part of the document,** e.g. a comment, a sentence around the document, a code fence, a comma after the last entry, a marker such as `...` or `[truncated]`, a bracket too many.
3. **Add only what is missing,** e.g. a comma, a colon, a quote, a closing bracket. A text that is cut off gets what closes it and nothing more: `{"id": 42, "name": "Ada Lovel` becomes `{"id": 42, "name": "Ada Lovel"}`. What the author already typed stays: a key without a value gets a value, e.g. `"timeout":` becomes `"timeout": null`, and is not removed.
4. **A character in the place of another is replaced by the right one,** e.g. `'` by `"`, `True` by `true`, `None` by `null`, `=>` by `:`. A value without quotes that is no number and no literal gets quotes, and so does a key without quotes.
5. **Where two readings are about equally likely, take the one that changes less, mark the repair as unsure, and say the other reading.** E.g. in `{"host": "db.internal", "port": 5432}, "pool": 10}` the first `}` may be one brace too many, or the document may end there. Removing the brace changes one character, so that is the repair, with the other reading in the mark.

Two things about white space decide whether three repairs of one text agree, so follow them to the letter:

- **Where you remove text before the document, remove all white space between that text and the document too, so that the repair starts with the document's first character.** The same holds after the document. E.g. a sentence, an empty line, a code fence, the document, a line feed and a closing fence become the document alone, with no line feed at its end. On a side where the broken text has only white space, keep that white space as it is, e.g. the line feed after the last brace of a file.
- **Remove a line that holds nothing of the document as a whole line, with its indentation and its line end,** e.g. a comment on a line of its own or a marker line of a merge conflict. Where the text that you remove shares its line with a part of the document, remove it together with the white space before it: `"port": 8080, // was 3000` becomes `"port": 8080,` and its line end.

## The two files

A part file holds broken texts under ids that say nothing about them:

```
⟦case 6bf39c7b⟧
⟦broken⟧
{
  "port": 8080, // was 3000
  "hosts": ["api.internal", "db.internal"],
}
⟦end⟧

⟦case 62b4f3bc⟧
⟦broken⟧
{"host": "db.internal", "port": 5432}, "pool": 10}
⟦end⟧

⟦case 880ffb71⟧
⟦broken⟧
⟦bom⟧{⟦cr⟧
⟦tab⟧"name": "Zoë"⟦cr⟧
⟦tab⟧"path": "C:\Users\zoe"⟦cr⟧
}
⟦end⟧
```

Your repair file holds one repair per broken text, under the same id:

```
⟦repair 6bf39c7b⟧
⟦repaired⟧
{
  "port": 8080,
  "hosts": ["api.internal", "db.internal"]
}
⟦end⟧

⟦repair 62b4f3bc⟧
unsure: the document could end at the first }, and the rest would be text after the document
⟦repaired⟧
{"host": "db.internal", "port": 5432, "pool": 10}
⟦end⟧

⟦repair 880ffb71⟧
⟦repaired⟧
{⟦cr⟧
⟦tab⟧"name": "Zoë",⟦cr⟧
⟦tab⟧"path": "C:\\Users\\zoe"⟦cr⟧
}
⟦end⟧
```

- `⟦repair id⟧` starts a repair, `⟦repaired⟧` starts its text, and `⟦end⟧` ends it. A marker stands alone on its line, from the line's first character on. Copy the two brackets `⟦` and `⟧` from this page: they are U+27E6 and U+27E7, and no other bracket works.
- `unsure: …` is the optional mark of rule 5, one line that says the other reading.
- Empty lines between two repairs are fine. The file is UTF-8 with plain line feeds.

A text is written as it is, in both files. Quotes and backslashes need no escaping: what stands between the two marker lines is the text, character for character. The lines are joined with line feeds, and the line feed before the next marker line is not a part of the text. So the first repair above ends with `}`, as its broken text does.

A character that cannot be seen is written as a name between `⟦` and `⟧`, and a file is refused when such a character stands in it as itself. That way a text holds exactly what the file shows.

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

- A tab is always `⟦tab⟧`, also in the indentation. The same holds for every control character, every space that is not the plain space, and every character without a width. In the third text above, every line of the document ends with a carriage return and starts with a tab, and the repair keeps them all. The byte order mark is no part of a JSON document, so the repair leaves it out.
- A line of a text does not end with a plain space. Write the last space as `⟦sp⟧`.
- A text does not start or end with an empty line. A text that ends with a line feed has `⟦lf⟧` at the end of its last line. Empty lines in the middle of a text are fine.
- The brackets themselves are `⟦U+27E6⟧` and `⟦U+27E7⟧` inside a text.

The surest way to keep a text as it stands is to copy the lines of the broken text from the part file and then change only what the repair changes.

## Check your file

From the repo's root, with your repair file and the part file:

```sh
bun lab/recovery-parser/written/check-repairs.ts repairs-of-part-1.txt part-1.txt
```

The check prints every repair back as the tools read it, and its last line is e.g. `80 broken texts, 80 repairs, 0 problems`. Run it until that line says 0 problems, and read what it prints for every repair.

A line that starts with `problem:` names something that keeps a repair out of the set: the format of the file, a repair that is not valid JSON, a repair of more than 512 code points or with brackets nested more than 16 levels deep, an id that the part file does not have, a broken text without a repair.

A line that starts with `look at:` names something that may be right and often is a mistake, e.g. a repair with white space that the broken text lacks, which is what a text looks like that was laid out anew.

For the second repair above the check prints:

```
--- 62b4f3bc
    unsure: the document could end at the first }, and the rest would be text after the document
    repaired: 49 code points on 1 line. broken: 50 code points on 1 line.
    first damage at 36, first error of the parser as it is at 37 (extraAfterValue), 13 scored code points from there on
    what the tools take for the damage:
      added at 36: "}"
rep   {"host": "db.internal", "port": 5432, "pool": 10}
label pkkkkkkpwssssssssssssspwkkkkkkpwnnnnpwkkkkkkpwnnp
depth 1111111111111111111111111111111111111111111111110
cont  oooooooooooooooooooooooooooooooooooooooooooooooo-

brok  {"host": "db.internal", "port": 5432}, "pool": 10}
align ....................................+.............
want  pkkkkkkpwssssssssssssspwkkkkkkpwnnnn pwkkkkkkpwnnp
wantd 111111111111111111111111111111111111 1111111111110
wantc oooooooooooooooooooooooooooooooooooo oooooooooooo-
now   pkkkkkkpwssssssssssssspwkkkkkkpwnnnnppwsssssspwnnp
nowd  1111111111111111111111111111111111110000000000000-
nowc  oooooooooooooooooooooooooooooooooooo--------------
miss                                       ************d
first                                     d^
```

**The list under "what the tools take for the damage" is the first thing to read.** It is the difference between the broken text and your repair, seen from the repair: `added` is text of the broken text that your repair leaves out, `removed before 32` is text of your repair that the broken text lacks at that place, and `in the place of another` lists the code points that stand one for one for another, e.g. every `'` for a `"`. Positions count the code points of the broken text from 0. The list must hold what you meant to change and nothing else. If it holds e.g. a removed space or an added line feed that you did not mean, your repair differs from the broken text by more than the repair: fix it.

The rows show one column per code point. A line feed is shown as `⏎`, a tab as `→`, a carriage return as `↵`, a no-break space as `⍽`, a byte order mark as `◊`, the escape character as `␛`, and a character that takes two columns as `◆`. A text of more than 120 code points is printed in blocks of 120 columns.

| Row | What it shows |
| --- | --- |
| `rep` | your repair |
| `label` | what each of its code points is shown as: `w` white space, `p` punctuation, `s` string, `e` escape, `n` number, `l` literal, `k` key |
| `depth` | the number of open containers after the code point, `0` to `9` and then `a` to `g` for 10 to 16 |
| `cont` | the innermost open container after the code point: `o` an object, `a` an array, `-` none |
| `brok` | the broken text |
| `align` | `.` a code point that your repair keeps, `~` one that stands in the place of another, `+` one that your repair leaves out |
| `want`, `wantd`, `wantc` | the three values that the code point takes from its counterpart in your repair. Blank under a code point that your repair leaves out, and `?` where a value is not scored |
| `now`, `nowd`, `nowc` | what the highlighter gives today, which the check calls the parser as it is. `E` is an error: today it shows everything after its first error so |
| `miss` | where today's highlighter differs from `want`: `k` the kind, `d` the depth, `c` the container, `*` more than one |
| `first` | `^` under the code point where today's highlighter reports its first error, and `d` under the first damaged code point when that comes earlier |

Read the `align` row against the `brok` row: every `+` is a code point that you say is no part of the document, and every `.` is one that you keep. Then read `want`: it is what your repair says about each code point of the broken text.

Three things that the tools do by a fixed rule, so that nothing is wrong when you see them:

- A word in the place of a literal or a number is shown as added, and the literal or number as removed, e.g. `True` for `true` and `NaN` for a number. So is a literal with a slip in it, e.g. `ture`.
- A code point stands one for one for another only in a few parts: a quote mark for a quote, a bracket for a bracket of the same direction, `=` or `;` for a colon, `;` for a comma, and white space for white space. Any other code point in another one's place is shown as added.
- Of two equal code points, the later one is the added or the removed one. E.g. when you remove a comment line, the `align` row marks the comment's text, its line feed and the indentation of the next line as added, and takes the indentation before the comment for the kept one.
