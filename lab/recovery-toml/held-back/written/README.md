# Broken TOML written by agents

This folder holds a test set of broken TOML for the TOML track of the transfer experiment (`lab/recovery-toml/`). Agents write its cases from what broken TOML looks like in real use, e.g. a config file that a person edits, a file written with the habits of YAML, or the output of a program.

**The set is held back.** Whoever builds the parser, the train data or the training reads nothing in `lab/recovery-toml/held-back/`, this page included, and no code outside that folder imports from it. A parser that was shaped by a look at the cases, at their repairs or at a description of them says nothing about broken TOML that nobody has seen. Such a reader gets numbers from `scoreTables` of `score.ts`, through whoever runs the final scoring.

The page up to [How a code point gets its label](#how-a-code-point-gets-its-label) is for a writer of cases. With `REPAIR.md` and `THEMES.md` it says everything a writer needs. The rest is for those who check the set and read its numbers.

## What a case is

A case is a broken payload, one line that says where such a payload comes from, and a repair. The repair says which valid TOML document the author of the broken payload meant, and which code point of the broken payload is which code point of that document. E.g. someone who knows YAML writes `port: 8080`, and meant `port = 8080`: the `:` stands in the place of the `=`.

The set tests a TOML highlighter that goes on after an error. The highlighter gives every code point of a text three values: what the code point is shown as, how many arrays and inline tables are open after it, and whether the innermost open one is an array or an inline table. For a broken payload, the right values are those of the document that its author meant: the `p` of `port: 8080` is a part of a key at depth 0, because the `p` of `port = 8080` is.

After you, a second agent repairs each of your broken payloads without seeing your repair. A code point of a broken payload is scored only where your repair and the second repair give it the same values. A code point where they differ is called disputed and is kept apart.

## The steps of a writer

1. Read this page, `REPAIR.md` and `THEMES.md`. `THEMES.md` says which situations your file covers and what to avoid. Read the three examples in `examples/broken/examples.txt` and `examples/repairs/examples.txt`.
2. Write about 50 broken payloads into `broken/<name>.txt`, where `<name>` is the name that `THEMES.md` gives your theme, e.g. `broken/hand-edits.txt`. Think of the situation first, then of the file that it happens to, then of the damage. Do not read the other writers' files.
3. Write one repair per broken payload into `repairs/<name>.txt`, by the rules of `REPAIR.md`. Copy the lines of the broken payload and add the marks.
4. Run the check from the repo's root, fix what it calls a problem, and read what it prints for every case:

   ```sh
   bun lab/recovery-toml/held-back/written/check.ts <name>
   ```

   Run it until its last line says 0 problems, e.g. `50 cases, 0 problems, 4 lines to look at`. A case without a problem can still be a case that the tools read in another way than you meant, so read the list of the damage and the `align` row of every case, as `REPAIR.md` says under "Check your file".
5. Commit your two files and no other path.

To try the tools first, run them on the examples:

```sh
bun lab/recovery-toml/held-back/written/check.ts examples --set lab/recovery-toml/held-back/written/examples
bun lab/recovery-toml/held-back/written/show.ts examples-01 --set lab/recovery-toml/held-back/written/examples
```

## The rules for a case

1. **The broken payload is what its situation really produces, in the places where it produces it.** The content is realistic: keys and values are what such a file holds in real use, e.g. `max_connections = 100` or `edition = "2021"`, and not `foo` and `bar`. Vary the files: other tools, other shapes, other sizes, with and without headers, arrays, inline tables, comments, dates and strings of several lines.
2. **The repair follows `REPAIR.md`:** the valid TOML document that the author most likely meant, with the smallest change. So a broken payload is a valid document with the damage and with no other change.
3. **The broken payload has 40 to 480 code points, and the repaired document at most 480.** Most of your broken payloads have between 100 and 350.
4. **The table parser of `lab/recovery-toml/` rejects the broken payload.** The parser reads TOML 1.0 and keeps no names. So a payload whose only fault is a key that is defined twice or a date such as `2024-13-45` is no case: the parser sees no error in it. A payload with something that TOML 1.1 allows and TOML 1.0 does not is a case, e.g. an inline table on several lines.
5. **The repaired document is valid for the table parser, for the reference and for Bun's parser.** Bun's parser refuses a key or a table that is defined twice, so the document defines none twice.
6. **Something is left to recover.** A score counts the code points from the parser's first error on. A payload that is only cut off, or a whole document with other text after it, has nothing there. Such a case is fine, and a file holds at most three of them.
7. **No two cases have the same broken payload, and no two differ in names and numbers alone.** Every case has its own id, which starts with the name of your file, e.g. `hand-edits-07`.
8. **Mark a repair as unsure when another repair is as sensible and would change the label of a kept code point,** with the line `unsure: …` that says the other reading.

## The two files of a writer

Both files are UTF-8 with plain line feeds. `REPAIR.md` describes their format under "The aligned text" and "The two files": the markers, the three marks of an aligned text, and how a character that cannot be seen is written. A writer's files differ from what that page shows in one line: every repair has a line `from: …` that says in one line where such a broken payload comes from.

The first example, in `examples/broken/examples.txt`:

```
⟦case examples-01⟧
⟦broken⟧
[package]
name = "tide-gauge"
authors = ["Mira Okafor <mira@tidegauge.dev>"
version = "0.4.1  # bump before the release
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }⟦lf⟧
⟦end⟧
```

And its repair, in `examples/repairs/examples.txt`:

```
⟦repair examples-01⟧
from: a Cargo.toml typed from memory, with a closing quote and a closing bracket forgotten
unsure: the quote could be missing at the end of its line, with the remark as a part of the string
⟦aligned⟧
[package]
name = "tide-gauge"
authors = ["Mira Okafor <mira@tidegauge.dev>"⟦missing⟧]⟦/⟧
version = "0.4.1⟦missing⟧"⟦/⟧  # bump before the release
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }⟦lf⟧
⟦end⟧
```

For this case the check prints:

```
--- examples-01  from: a Cargo.toml typed from memory, with a closing quote and a closing bracket forgotten
    unsure: the quote could be missing at the end of its line, with the remark as a part of the string
    repaired: 206 code points on 9 lines. broken: 204 code points on 9 lines.
    first damage at 75, first error of the parser as it is at 76 (expectedCommaOrClose), 128 scored code points from there on
    what the alignment says the damage is:
      missing before 75: "]"
      missing before 92: """
      code points 0 to 76
doc   [package]⏎name = "tide-gauge"⏎authors = ["Mira Okafor <mira@tidegauge.dev>"]⏎
label phhhhhhhpwkkkkwpwsssssssssssswkkkkkkkwpwpsssssssssssssssssssssssssssssssssspw
depth 00000000000000000000000000000000000000001111111111111111111111111111111111100
cont  ----------------------------------------aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa--

      code points 77 to 154
doc   version = "0.4.1"  # bump before the release⏎edition = "2021"⏎⏎[dependencies]⏎
label kkkkkkkwpwssssssswwcccccccccccccccccccccccccwkkkkkkkwpwsssssswwphhhhhhhhhhhhpw

      code points 155 to 205
doc   serde = { version = "1.0", features = ["derive"] }⏎
label kkkkkwpwpwkkkkkkkwpwssssspwkkkkkkkkwpwpsssssssspwpw
depth 000000001111111111111111111111111111112222222221100
cont  --------ttttttttttttttttttttttttttttttaaaaaaaaatt--

      code points 0 to 119
brok  [package]⏎name = "tide-gauge"⏎authors = ["Mira Okafor <mira@tidegauge.dev>"⏎version = "0.4.1  # bump before the release⏎
align ........................................................................................................................
want  phhhhhhhpwkkkkwpwsssssssssssswkkkkkkkwpwpsssssssssssssssssssssssssssssssssswkkkkkkkwpwsssssswwcccccccccccccccccccccccccw
wantd 000000000000000000000000000000000000000011111111111111111111111111111111111?????????????????????????????????????????????
wantc ----------------------------------------aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?????????????????????????????????????????????
now   phhhhhhhpwkkkkwpwsssssssssssswkkkkkkkwpwpsssssssssssssssssssssssssssssssssswkkkkkkkwpwsssssssssssssssssssssssssssssssssE
nowd  000000000000000000000000000000000000000011111111111111111111111111111111111111111111111111111111111111111111111111111111
nowc  ----------------------------------------aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
miss                                                                                              kkkkkkkkkkkkkkkkkkkkkkkkkkkk
first                                                                            d^

      code points 120 to 203
brok  edition = "2021"⏎⏎[dependencies]⏎serde = { version = "1.0", features = ["derive"] }⏎
align ....................................................................................
want  kkkkkkkwpwsssssswwphhhhhhhhhhhhpwkkkkkwpwpwkkkkkkkwpwssssspwkkkkkkkkwpwpsssssssspwpw
wantd ??????????????????000000000000000000000001111111111111111111111111111112222222221100
wantc ??????????????????-----------------------ttttttttttttttttttttttttttttttaaaaaaaaatt--
now   kkkkkkkwpwsssssswwpkkkkkkkkkkkkpwkkkkkwpwpwkkkkkkkwpwssssspwlkkkkkkkwpwpsssssssspwpw
nowd  111111111111111111222222222222211111111112222222222222222222222222222223333333332211
nowc  aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaattttttttttttttttttttttttttttttaaaaaaaaattaa
miss                    ***********************ddddddddddddddddddd*ddddddddddddddddddddd**
```

`REPAIR.md` explains every row. Three things to see here:

- The `align` row has only dots: the broken payload only lacks two code points, and the list of the damage names them and where they are missing.
- The `wantd` and `wantc` rows hold `?` from the line feed after the `authors` line up to the `[` of `[dependencies]`. The `]` of the array is missing, so nothing in the broken payload shows where the array ended, and the depth and the container are not scored up to the next bracket. The display kind in the `want` row is scored there.
- The parser as it is reports its first error at the `v` of `version`, the `^` of the `first` row. A score counts the 128 code points from there on that have a scored value.

## How a code point gets its label

The label of a code point of a broken payload has three values: the display kind, the depth and the container. `written.ts` computes it in these steps:

1. **The two texts.** The aligned text of a repair gives the broken payload, the repaired document, and for every code point of the broken payload either the index of its counterpart in the repaired document or that it is extra. The broken payload that the aligned text gives must be the one of the file in `broken/`.
2. **One fixed form.** Of two equal code points of which one is extra, the later one is, and the same holds for a missing one. `slideChanges` moves a kept code point to the left onto an equal extra one, by one place or over a whole extra run whose first code point is the same, e.g. the indentation after an extra comment line onto the indentation before it. So two repairers who mean the same repair give the same alignment in most cases. The form is not the same in every case: on 200,000 random alignments over two to six letters, 16 of 8,169 other markings of the same repair got another form, as `written.test.ts` counts. So `compare.ts` says when two repairs with a difference have the same repaired document.
3. **The label of the counterpart.** `labelReference` of `lab/recovery-toml/reference.ts` labels the repaired document, and a code point of the broken payload takes the label of its counterpart. A code point that stands in the place of another takes it too, e.g. a `:` for `=` is punctuation.
4. **No label** for an extra code point, and for what is left of a literal or a number with a slip in it, e.g. the `rue` of `True` and the digits of `1O0` for `100`: the highlighter has nothing to show such a word as. It is such a word when the literal or number lacks a code point in the broken payload and an extra code point that can be a part of a word stands right against what is left of it.
5. **A value that is not scored.** `REPAIR.md` lists the cases under "What the tools do by a fixed rule": the depth and the container after a missing bracket up to the next bracket, the display kind of the start of a string that lost its opening quote where that start reads as a number or a literal, the display kind of a quote that lost its backslash, and the display kind of what reads as an escape after a backslash that lost its second half. These are the rules of the written set of the JSON experiment that apply to TOML. The JSON rule for a number with a leading zero is left out: rule 5 of `REPAIR.md` makes such a number an octal number, e.g. `0o755`.
6. **Two repairs.** A code point is agreed when both repairs give it a label with the same scored values, extra when neither gives it a label, and disputed otherwise. A value that the reading of one repair does not score is no dispute. Only agreed code points have a label in the end.
7. **From the first error on.** A score counts the code points from the first error of the parser as it is on that have a label with a scored value. The experiment changes only what the parser does from its first error on.

## The second repair and the comparison

A second repairer gets `REPAIR.md` and the files of `broken/`, and reads nothing else of this folder: not `repairs/`, not this page, not `THEMES.md`. The repairs go into `second-repairs/`, in a file with the name of the file of broken payloads, e.g. `second-repairs/hand-edits.txt` for `broken/hand-edits.txt`, with the same ids. `REPAIR.md` names the check for it.

```sh
bun lab/recovery-toml/held-back/written/compare.ts
```

compares the two repairs of every case and lists the code points where the labels differ. For the examples, with `--set lab/recovery-toml/held-back/written/examples`, its output starts with:

```
--- examples-01: the labels differ at 27 code points, 27 of them from the parser's first error at 76 on
    code points 92 to 93 "  ": writer: whitespace, depth 0, no container. second: string, depth 0, no container.
    code points 94 to 118 "# bump before the release": writer: comment, depth 0, no container. second: string, depth 0, no container.
```

The second repair of that example puts the missing quote at the end of the line, which is the other reading that the writer's `unsure` line names. Under these lines the command prints the two repairs side by side, with a row `agree` that has `.` under an agreed code point, `+` under one without a label by both repairs, and `!` under a disputed one. Its last line counts the cases, e.g. `3 cases with two repairs: 2 with the same labels at every code point, 1 with a difference, 1 of them with a difference from the parser's first error on, where a score counts. 0 cases have no second repair.`

A case with a difference is read by a person or an agent with both repairs side by side. When one of the two repairs breaks a rule of `REPAIR.md`, that repair is corrected. When the two are two readings of the same payload, the case stays disputed: its disputed code points are never scored, and it is not among the cases with full agreement.

## How other code scores its tables

`scoreTables` of `score.ts` takes any `ParserTables` of `lab/recovery-toml/table-parser.ts` and reads the set by itself:

```ts
import {scoreTables} from './score.ts'
const {all, perFile, unmarked} = scoreTables(tables)
console.log(all.fullAgreement.right / all.fullAgreement.scored, all.fullAgreement.wholeRight / (all.fullAgreement.cases - all.fullAgreement.nothingToRecover))
```

- `all` is a `WrittenScore`, `perFile` maps each writer's file, e.g. `hand-edits.txt`, to one, and `unmarked` is the one of the cases of which no repair is marked as unsure.
- A `WrittenScore` has two scores. `fullAgreement` counts the cases without a disputed code point from the first error on, and it is the set's main number. `agreedCodePoints` counts all cases and leaves the disputed code points out. A case with one repair has no disputed code point.
- A `Score` has `cases`, `nothingToRecover`, `scored`, `right`, `wholeRight`, and per value `kindScored`, `kindRight`, `nestingScored`, `depthRight` and `containerRight`. A code point is right when every scored value is right, which is the number "all three" of the JSON experiment, and a case is right as a whole when all of its counted code points are, which is "whole".

`bun lab/recovery-toml/held-back/written/score.ts` prints these numbers for the parser as it is. A reader that is no setting of the tables takes what a score needs from `readWritten().cases` of `written.ts`: `broken`, `firstErrorPosition`, and `labelsOfWritten(writtenCase)`, which has one label per code point of the broken payload, or `undefined` for a code point without one.

`readWritten()` also returns `problems` and `leftOut`. A case with a problem in its broken payload or in one of its repairs is left out of `cases`, and `leftOut` has its id. So `problems` must be empty before a number of the set is used: `bun lab/recovery-toml/held-back/written/check.ts` prints them.

## The files of this folder

- `README.md`, `REPAIR.md` and `THEMES.md`: the rules for the writers and the repairers.
- `broken/`, `repairs/` and `second-repairs/`: the set. One file per writer in each, with the same name.
- `examples/`: three worked cases in a folder of the same layout, with second repairs. They are no part of the set, and no score counts them.
- `format.ts` reads and writes the files. `written.ts` computes the labels and reads the set, with `readWritten(folder, options)`. `show.ts` prints a case, `check.ts` checks one writer's file or the whole set, `compare.ts` compares the two repairs of each case, and `score.ts` scores tables.
- `written.test.ts` tests the tools, the examples and the pages' printed examples. Its test of the set compares counts only, so that a failure prints no text of a case.

Every command takes `--set <folder>` for another folder of the same layout. `check.ts` without a name checks every file of the set and prints one line per case, and `show.ts <id>` prints one case of it, with `--second` as the second repair reads it and with `--both` both repairs side by side.
