# Repairing broken TOML

You get broken TOML payloads, and you write one repair per payload. This page says everything a repairer needs. A writer of cases reads `README.md` first and then this page. A second repairer reads this page and the file of broken payloads, and nothing else of this folder.

## What a repair is for

The payloads test a TOML highlighter that goes on after an error. The highlighter gives every code point of a text three values: what the code point is shown as (white space, punctuation, a string, an escape, a number, a literal, a key, the name of a header or a comment), how many arrays and inline tables are open after it, and whether the innermost open one is an array or an inline table.

For a broken payload, the right values are those of the document that its author meant. E.g. in `port: 8080` the `port` is a key and the `8080` is a number, because they are in `port = 8080`. Your repair says what that document is, and which code point of the broken payload is which code point of the document. A code point of the broken payload then has the values of its counterpart. A code point without a counterpart is called extra, and it has no values.

So what matters in a repair is which code points of the broken payload you keep, and where they end up in the document. What you add matters little, e.g. `""` or `0` for a value that is missing.

## The rules

**Write the valid TOML document that the author most likely meant, with the smallest change to the broken payload.** It is one document of TOML 1.0, and it defines no key and no table twice.

1. **Keep every code point that belongs to the document exactly as it stands in the broken payload:** the same characters in the same order, with the same indentation, the same line ends and the same spaces. Do not lay the text out anew, do not sort keys, and do not correct what is not broken, e.g. a name with a spelling mistake or a value that looks wrong.
2. **Text that is no part of the document is extra,** e.g. a sentence around the document, a code fence, a marker line of a merge conflict, a line number before a line, the prompt of a shell, a comma at the end of a line, a bracket too many.
3. **Add only what is missing,** e.g. a quote, an equals sign, a comma between two values of an array, a closing bracket. A payload that is cut off gets what closes it and nothing more: `tags = ["db", "prim` becomes `tags = ["db", "prim"]`. What the author already typed stays: a key without a value gets a value, e.g. `timeout =` becomes `timeout = ""`, and is not removed.
4. **A code point stands in the place of another only in five parts:** a quote mark for a quote, e.g. `“` for `"`. A bracket for a bracket of the same direction, e.g. `(` for `[`. A colon for the equals sign. A semicolon for a comma. White space of another sort for a space, a tab or a line feed, e.g. a no-break space for a space. Any other code point in another one's place is extra, and the code point of the document is missing, e.g. a `/` in the place of the `-` of a date.
5. **A value without quotes that is not valid TOML becomes a string in quotes, with every code point kept,** e.g. `host = db.internal` becomes `host = "db.internal"`, `timeout = 30s` becomes `timeout = "30s"`, and `since = 2024/01/15` becomes `since = "2024/01/15"`. The same holds for a key and for the name of a header, e.g. `[my server]` becomes `["my server"]`. The exception is a value that only lacks code points: add them, e.g. `.5` becomes `0.5`, `tru` becomes `true`, and `0755` becomes `0o755`.
6. **A word of another notation for true or false is extra as a whole, and the literal is missing,** e.g. `True`, `TRUE`, `yes` and `on` for `true`. A word for no value, e.g. `null`, `None` or `nil`, is extra as a whole, and `""` is missing in its place, since TOML has no such word. The same holds for a placeholder that stands where a value is meant, e.g. `{{ port }}` or `<YOUR_TOKEN>` without quotes.
7. **A remark of the author stays a comment.** The comment sign of another notation is extra and `#` is missing, e.g. for `//`, `;` and `--`. The text of the remark is kept. Of `/* … */` both ends are extra.
8. **White space that TOML does not take at its place stands for a space,** by the last of the five parts of rule 4. E.g. a no-break space between a key and its equals sign. Also a line feed inside an inline table, which TOML 1.0 wants on one line: every line feed in it stands for a space, and the indentation after it is kept. Also a line feed that a program put in the place of a space when it wrapped a string of one line.
9. **A string keeps the quotes that its author typed.** A backslash that is meant as a backslash gets its second half, e.g. `"C:\Users\zoe"` becomes `"C:\\Users\\zoe"`, and a quote inside the string gets its backslash, e.g. `"say "hi" now"` becomes `"say \"hi\" now"`.
10. **Of two things of which one is too many, the first one stays,** e.g. the upper side of a merge conflict, with the lower side, the three marker lines and their line ends as extra.
11. **Where two readings are about equally likely, take the one that changes fewer code points, mark the repair as unsure, and say the other reading.** A changed code point is one that is extra, missing, or in the place of another. E.g. in `[[servers]` one `[` may be too many, or one `]` may be missing. Both change one code point, so rule 3 decides, and the `]` is added.

Two things about white space decide whether two repairs of one payload agree, so follow them to the letter:

- **Where text before the document is extra, all white space between that text and the document is extra too, so that the repaired document starts with the document's first character.** The same holds after the document. E.g. of a sentence, an empty line, a code fence, the document, a line feed and a closing fence, the document alone is kept, with no line feed at its end. On a side where the broken payload has only white space, that white space is kept, e.g. the line feed after the last line of a file.
- **A line that holds nothing of the document is extra as a whole line, with its indentation and its line end.** Where extra text shares its line with a part of the document, only that text is extra, e.g. the comma of `port = 8080,`.

## The aligned text

A repair is written as an aligned text: the broken payload with marks. It holds the broken payload and the repaired document at once.

| Mark | What it says | Example |
| --- | --- | --- |
| `⟦extra⟧…⟦/⟧` | The text between the two marks is in the broken payload and not in the document | `port = 8080⟦extra⟧,⟦/⟧` |
| `⟦missing⟧…⟦/⟧` | The text between the two marks is in the document and not in the broken payload | `host = ⟦missing⟧"⟦/⟧db.internal⟦missing⟧"⟦/⟧` |
| `⟦: for =⟧` | One code point of the broken payload, here `:`, stands in the place of one code point of the document, here `=` | `port⟦: for =⟧ 8080` |

Everything outside the marks is in both texts, as the same code points. So the aligned text without every `⟦missing⟧…⟦/⟧`, with the text of every `⟦extra⟧…⟦/⟧` and with the first side of every `⟦… for …⟧` is the broken payload, code point for code point. The check refuses a repair for which that does not hold.

- A run of extra or missing text can hold line feeds: it then goes on over several lines of the file, e.g. the three lines before the document in the third repair below.
- No mark stands inside a run, and no run is empty.
- Each side of `⟦… for …⟧` is one character as it is, or the name of a character that cannot be seen, e.g. `⟦nbsp for sp⟧` and `⟦lf for sp⟧`. The names are in the table further down.
- Where one code point is extra and another is missing at the same place, and rule 4 says that the one stands for the other, write `⟦… for …⟧`. The check refuses the two runs.

The surest way to write an aligned text is to copy the lines of the broken payload and then to add the marks.

A line feed that stands for a space is written `⟦lf for sp⟧`, and the file has no line break at its place. So an inline table on four lines, by rule 8:

```
serde = {
  version = "1.0",
  features = ["derive"],
}
```

is one line of the aligned text, with the indentation of every line kept and the comma before the `}` as extra:

```
serde = {⟦lf for sp⟧  version = "1.0",⟦lf for sp⟧  features = ["derive"]⟦extra⟧,⟦/⟧⟦lf for sp⟧}
```

## The two files

A file of broken payloads holds each payload under an id:

````
⟦case examples-02⟧
⟦broken⟧
[server]
host: "0.0.0.0"
port: 8080  // behind the proxy
debug: True
limits = {"burst": 20, "rate": 5}⟦lf⟧
⟦end⟧

⟦case examples-03⟧
⟦broken⟧
Here is the config with the new release channel:

```toml
[release]
version = 2.4.0-rc1
channel = "stable"
notify = ["ops@ledgersync.dev", "release-bot"]
```

Let me know if you want the old channel kept.
⟦end⟧
````

Your repair file holds one repair per broken payload, under the same id:

````
⟦repair examples-02⟧
⟦aligned⟧
[server]
host⟦: for =⟧ "0.0.0.0"
port⟦: for =⟧ 8080  ⟦extra⟧//⟦/⟧⟦missing⟧#⟦/⟧ behind the proxy
debug⟦: for =⟧ ⟦extra⟧True⟦/⟧⟦missing⟧true⟦/⟧
limits = {"burst"⟦: for =⟧ 20, "rate"⟦: for =⟧ 5}⟦lf⟧
⟦end⟧

⟦repair examples-03⟧
⟦aligned⟧
⟦extra⟧Here is the config with the new release channel:

```toml
⟦/⟧[release]
version = ⟦missing⟧"⟦/⟧2.4.0-rc1⟦missing⟧"⟦/⟧
channel = "stable"
notify = ["ops@ledgersync.dev", "release-bot"]⟦extra⟧
```

Let me know if you want the old channel kept.⟦/⟧
⟦end⟧
````

The first repair gives the document `host= "0.0.0.0"` and so on: no space is added before the equals sign, since the document is valid without it. The second repair follows the first rule on white space: the document starts with `[` and ends with `]`.

- `⟦repair id⟧` starts a repair, `⟦aligned⟧` starts its aligned text, and `⟦end⟧` ends it. `⟦case id⟧` and `⟦broken⟧` do the same in a file of broken payloads. Such a marker stands alone on its line, from the line's first character on. Copy the two brackets `⟦` and `⟧` from this page: they are U+27E6 and U+27E7, and no other bracket works.
- `unsure: …` is the optional mark of rule 11, one line before `⟦aligned⟧` that says the other reading in a sentence.
- `note: …` is one optional line for anything else that a reader should know.
- A writer's repair also has the line `from: …`, see `README.md`. A second repair has none.
- Empty lines between two entries are fine. The file is UTF-8 with plain line feeds.

A text is written as it is. Quotes and backslashes need no escaping: what stands between two marker lines is the text, character for character. The lines are joined with line feeds, and the line feed before the next marker line is not a part of the text. So the second broken payload above ends with the `.` of its sentence, and the first one ends with a line feed, which is written `⟦lf⟧`.

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

- A tab is always `⟦tab⟧`, also in the indentation. The same holds for every control character, every space that is not the plain space, and every character without a width.
- A line of a text does not end with a plain space. Write the last space as `⟦sp⟧`, e.g. `port = 8080⟦sp⟧`.
- A text does not start or end with an empty line. A text that ends with a line feed has `⟦lf⟧` at the end of its last line, and one that ends with two has `⟦lf⟧⟦lf⟧`. Empty lines in the middle of a text are fine.
- The brackets themselves are `⟦U+27E6⟧` and `⟦U+27E7⟧` inside a text.

A second repairer can start the repair file as a copy of the file of broken payloads, with `⟦repair` for every `⟦case` and `⟦aligned⟧` for every `⟦broken⟧`: a broken payload without marks is an aligned text that changes nothing.

## Check your file

From the repo's root, with the name of your file without its ending. A writer, for `broken/hand-edits.txt` and `repairs/hand-edits.txt`:

```sh
bun lab/recovery-toml/held-back/written/check.ts hand-edits
```

A second repairer, for `broken/hand-edits.txt` and `second-repairs/hand-edits.txt`:

```sh
bun lab/recovery-toml/held-back/written/check.ts hand-edits --second
```

The check prints every repair back as the tools read it, and its last line is e.g. `50 cases, 0 problems, 3 lines to look at`. Run it until that line says 0 problems, and read what it prints for every repair: a repair without a problem can still be a repair that the tools read in another way than you meant.

A line that starts with `problem:` names something that keeps a repair out of the set: the format of the file, an aligned text that does not give the broken payload, a repaired document that is not valid TOML, a mark against rule 4, an id that the file of broken payloads does not have, a broken payload without a repair. The repaired document has to be valid for three readers: the table parser and the reference of `lab/recovery-toml/`, which read TOML 1.0, and Bun's parser, which also refuses a key that is defined twice. It has at most 480 code points.

A line that starts with `look at:` names something that may be right and often is a mistake, e.g. a repair that keeps less than half of the broken payload.

For the first repair above the check prints:

```
--- examples-02
    repaired: 102 code points on 6 lines. broken: 103 code points on 6 lines.
    first damage at 13, first error of the parser as it is at 13 (unexpectedCharacter), 84 scored code points from there on
    what the alignment says the damage is:
      extra at 37 to 38: "//"
      missing before 39: "#"
      extra at 64 to 67: "True"
      missing before 68: "true"
      in the place of another: : for =, at 13, 29, 62, 86, 98
doc   [server]⏎host= "0.0.0.0"⏎port= 8080  # behind the proxy⏎debug= true⏎limits = {"burst"= 20, "rate"= 5}⏎
label phhhhhhpwkkkkpwssssssssswkkkkpwnnnnwwccccccccccccccccccwkkkkkpwllllwkkkkkkwpwpkkkkkkkpwnnpwkkkkkkpwnpw
depth 000000000000000000000000000000000000000000000000000000000000000000000000000001111111111111111111111100
cont  -----------------------------------------------------------------------------ttttttttttttttttttttttt--

brok  [server]⏎host: "0.0.0.0"⏎port: 8080  // behind the proxy⏎debug: True⏎limits = {"burst": 20, "rate": 5}⏎
align .............~...............~.......++.......................~.++++..................~...........~....
want  phhhhhhpwkkkkpwssssssssswkkkkpwnnnnww  cccccccccccccccccwkkkkkpw    wkkkkkkwpwpkkkkkkkpwnnpwkkkkkkpwnpw
wantd 0000000000000000000000000000000000000  0000000000000000000000000    00000000001111111111111111111111100
wantc -------------------------------------  -------------------------    ----------ttttttttttttttttttttttt--
now   phhhhhhpwkkkkEEEEEEEEEEEwkkkkEEEEEEEEEEEEEEEEEEEEEEEEEEEwkkkkkEEEEEEwkkkkkkwpwpsssssssEEEEEEEEEEEEEEEEw
nowd  0000000000000000000000000000000000000000000000000000000000000000000000000000001111111111111111111111111
nowc  ------------------------------------------------------------------------------ttttttttttttttttttttttttt
miss               kkkkkkkkkkk     kkkkkkkk  kkkkkkkkkkkkkkkkk      kk               kkkkkkkkkkkkkkkkkkkkkk**
first              ^
```

**The list under "what the alignment says the damage is" is the first thing to read.** It must hold what you meant to change and nothing else. Positions count the code points of the broken payload from 0. `extra` is text of the broken payload that the document leaves out, `missing before 39` is text of the document that the broken payload lacks at that place, and `in the place of another` lists the code points that stand one for one for another.

The rows show one column per code point. A line feed is shown as `⏎`, a tab as `→`, a carriage return as `↵`, a no-break space as `⍽`, a byte order mark as `◊`, the escape character as `␛`, and a character that takes two columns as `◆`. A text is printed in blocks of up to 120 columns, and a block ends after a line feed where it can.

| Row | What it shows |
| --- | --- |
| `doc` | your repaired document |
| `label` | what each of its code points is shown as: `w` white space, `p` punctuation, `s` string, `e` escape, `n` number, `l` literal, `k` key, `h` the name of a header, `c` comment |
| `depth` | the number of open arrays and inline tables after the code point, `0` to `9` and then `a` to `g` for 10 to 16 |
| `cont` | the innermost open container after the code point: `a` an array, `t` an inline table, `-` none |
| `brok` | the broken payload |
| `align` | `.` a code point that your repair keeps, `~` one that stands in the place of another, `+` an extra one |
| `want`, `wantd`, `wantc` | the three values that the code point takes from its counterpart in your document. Blank under a code point without a label, and `?` where a value is not scored |
| `now`, `nowd`, `nowc` | what the highlighter gives today, which the check calls the parser as it is. `E` is an error |
| `miss` | from the first error on, where today's highlighter differs from `want`: `k` the kind, `d` the depth, `c` the container, `*` more than one |
| `first` | `^` under the code point where today's highlighter reports its first error, and `d` under the first damaged code point when that comes earlier |

A block leaves out the rows `depth`, `cont`, `wantd`, `wantc`, `nowd` and `nowc` when they would show depth 0 and no container for all of its code points, and the rows `miss` and `first` when they would be empty.

Read the `align` row against the `brok` row: every `+` is a code point that you say is no part of the document, and every `.` is one that you keep. Then read `want`: it is what your repair says about each code point of the broken payload.

## What the tools do by a fixed rule

Four things that the tools do by themselves, so that nothing is wrong when you see them:

- **Of two equal code points of which one is extra, the later one is.** The tools move a kept code point to the left onto an equal extra one in two cases: by one place, and over a whole extra run whose first code point is the same. E.g. of the two `=` of `a == 1` the second one is extra, whichever you mark. And for a comment line that you mark as extra with its indentation and its line end, the `align` row keeps the indentation before the comment and marks the comment, its line feed and the indentation of the next line. The same is done for a missing code point. So two repairers who mean the same repair get the same labels in most cases.
- **What is left of a literal or a number with a slip in it has no label.** E.g. the `rue` of `True` when you mark only the `T` as extra, and the digits of `1O0` for `100`. The list of the damage then has a line "without a label, as what is left of a literal or a number with a slip in it". A literal or number that only lacks code points keeps its labels, e.g. `tru`.
- **A `?` in the `want` rows stands for a value that no highlighter can be asked for, so it is not scored.** After a bracket that is missing, the depth and the container are not scored up to the next bracket, since nothing in the broken payload shows that an array or an inline table started or ended. At the start of a string value that lost its opening quote, the display kind is not scored where that start reads as a number or a literal, e.g. the `2.4` of `version = 2.4.0-rc1`. And the display kind is not scored for a quote that lost its backslash, and for what reads as an escape after a backslash that lost its second half, e.g. the `U` of `"C:\Users"`.
- **A score counts the code points from the `^` on that have a value in the `want` rows.** A repair where the header says "no scored code point from there on" has nothing to recover, e.g. a payload that is cut off.
