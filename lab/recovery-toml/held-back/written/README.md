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

`score.ts` reads the set by itself and scores three sorts of parser on it:

- `scoreTables(tables)` takes any `ParserTables` of `lab/recovery-toml/table-parser.ts`, i.e. tables with today's classes and contexts.
- `scoreRecoveryTables(tables)` takes `RecoveryTables` of `lab/recovery-toml/learn/recovery-tables.ts`, which is what a training and the recipe make. Such tables can have added classes and the bit "first on its line", which the plain table parser cannot run, so the exact parser of `learn/recovery-parser.ts` runs them. With `asIsTables()`, and with added structure and no cell changed, it gives the numbers of `scoreTables(defaultTables)`: a test compares every score.
- `scoreWith(parser)` takes a parser of `../parsers.ts`, e.g. `restartAtNextLine`, the one rule without any training that trained tables are read against.

```ts
import {loadTables} from '../../learn/recovery-tables.ts'
import {scoreRecoveryTables} from './score.ts'
const {all, perFile, neutralEdits, otherDamage, moreEdits, unmarked} = scoreRecoveryTables(loadTables(file).tables)
console.log(all.fullAgreement.right / all.fullAgreement.scored, all.fullAgreement.wholeRight / (all.fullAgreement.cases - all.fullAgreement.nothingToRecover))
```

- `all` is a `WrittenScore`, and `perFile` maps each writer's file, e.g. `hand-editing.txt`, to one.
- `neutralEdits` and `otherDamage` are the `WrittenScore` of the two parts that `kinds.txt` makes of the set: the cases whose damage one to three edits of the train data's damage make, and the other cases. The first says how a result carries over to other documents with damage that the train data could have, and the second how it carries over to damage that the train data cannot have. A report gives both beside `all`. `moreEdits` is the part of `otherDamage` in which every damaged place is what the edits make, and the edits are more than the three of a sample. [What the damage is](#what-the-damage-is) says how the line is drawn.
- `unmarked` is the `WrittenScore` of the cases of which no repair is marked as unsure. In the other cases with full agreement, the agreement rests on a reading that a repairer called open, so a result is held against `unmarked.fullAgreement` too.
- A `WrittenScore` has two scores. `fullAgreement` counts the cases without a disputed code point from the first error on, and it is the set's main number. `agreedCodePoints` counts all cases and leaves the disputed code points out. A case with one repair has no disputed code point.
- A `Score` has `cases`, `nothingToRecover`, `scored`, `right`, `wholeRight`, and per value `kindScored`, `kindRight`, `nestingScored`, `depthRight` and `containerRight`. A code point is right when every scored value is right, which is the number "all three" of the JSON experiment, and a case is right as a whole when all of its counted code points are, which is "whole".

`bun lab/recovery-toml/held-back/written/score.ts` prints these numbers for the parser as it is and for the rule. With `--tables <file.json>` it prints them for the tables of a file that `learn/` saved too, e.g. `--tables $RECOVERY_SCRATCH/recipe/seed-1.primary.tables.json`. Tables in which a cell differs from today's are a final number, so the command then asks for the environment variable `RECOVERY_FINAL=yes`, and it refuses a file that was saved with another dataset. A reader that is no setting of the tables takes what a score needs from `readWritten().cases` of `written.ts`: `broken`, `firstErrorPosition`, and `labelsOfWritten(writtenCase)`, which has one label per code point of the broken payload, or `undefined` for a code point without one.

`readWritten()` also returns `problems` and `leftOut`. A case with a problem in its broken payload or in one of its repairs is left out of `cases`, and `leftOut` has its id. So `problems` must be empty before a number of the set is used: `bun lab/recovery-toml/held-back/written/check.ts` prints them.

## The files of this folder

- `README.md`, `REPAIR.md` and `THEMES.md`: the rules for the writers and the repairers.
- `broken/`, `repairs/` and `second-repairs/`: the set. One file per writer in each, with the same name.
- `examples/`: three worked cases in a folder of the same layout, with second repairs. They are no part of the set, and no score counts them.
- `kinds.txt` says for every case which edits of the train data's damage make its damage, and whether one to three of them do. `neutral-edits.ts` derives the lines from the writers' repairs and says where the file differs, and `bun lab/recovery-toml/held-back/written/written.ts --kinds` counts the cases per writer's file and per edit.
- `format.ts` reads and writes the files. `written.ts` computes the labels and reads the set, with `readWritten(folder, options)`. `show.ts` prints a case, `check.ts` checks one writer's file or the whole set, `compare.ts` compares the two repairs of each case, and `score.ts` scores tables.
- `check-overlap.ts` checks that no broken payload and no repaired document of the set is among generated samples, as the same text or as the same TOML value.
- `written.test.ts` tests the tools, the examples and the pages' printed examples. Its test of the set compares counts only, so that a failure prints no text of a case.

Every command but `check-overlap.ts` takes `--set <folder>` for another folder of the same layout. `check.ts` without a name checks every file of the set and prints one line per case, and `show.ts <id>` prints one case of it, with `--second` as the second repair reads it and with `--both` both repairs side by side.

## The set as it is

The set has 150 cases: three writers wrote 50 each, every writer from one cause of broken TOML, and every broken payload was repaired a second time by an agent who saw only the broken payload and `REPAIR.md`. It is used once, at the end of the experiment, to see how far a result on the train data carries over to broken TOML that no generator made. The train data's damage is ten edits that know nothing of TOML, and the writers did not see it. One to three of these edits make the damage of 69 cases, and 81 cases have damage that such edits do not make, see [What the damage is](#what-the-damage-is).

Whoever builds or trains a parser reads nothing in this folder: not the cases, the repairs and `kinds.txt`, and not this page, the tools and the tests either, whose examples describe sorts of damage that only the cases have. Such a reader gets numbers alone, from whoever runs the final scoring with `score.ts`.

The three files are `hand-editing.txt`, `model-and-paste.txt` and `other-notations.txt`. `THEMES.md` calls the first theme `hand-edits`, and its third theme, `programs-and-transport`, was written as `model-and-paste`: what the answer of a language model and a copy from a page or a terminal do to a file, e.g. a code fence, line numbers and typographic quotes. So the set has no merge conflict of a version control tool, no template that was not rendered, no byte order mark and no HTML entity, which the third theme also lists. 12 cases of `other-notations.txt` are files caught in the middle of typing or of a move from another notation, e.g. a key without its value yet.

### What the set holds

| Writer's file | Cases | With full agreement | With a disputed code point | Scored code points | Of them in cases with full agreement |
| --- | --- | --- | --- | --- | --- |
| `hand-editing.txt` | 50 | 50 | 0 | 6,376 | 6,376 |
| `model-and-paste.txt` | 50 | 47 | 3 | 7,283 | 7,044 |
| `other-notations.txt` | 50 | 47 | 3 | 7,327 | 6,883 |
| All | 150 | 144 | 6 | 20,986 | 20,303 |

A case has full agreement when no code point from the first error of the parser as it is on is disputed. The broken payloads have 34,994 code points, and 22,980 of them stand from that first error on. Of these, 20,986 are scored, 1,885 are extra by both repairs, 2 are what is left of a literal with a slip in it, and 107 are disputed. Of the scored ones, 16 have no scored display kind and 264, in 9 cases, no scored depth and container, by the rules of the `?`.

In 136 cases the two repairs give the same repaired document. In 4 more the documents differ and every label is the same, e.g. one repair adds `# ` before a remark that lost its comment sign and the other adds `#`: `hand-editing-22`, `model-and-paste-12`, `model-and-paste-25` and `other-notations-50`. In 4 cases the labels differ only before the first error, where no score counts, and 6 cases have a disputed code point from the first error on, see [Where the two repairs differ](#where-the-two-repairs-differ).

2 cases have nothing to recover, and a score counts no code point of them. `model-and-paste-25` is only cut off. In `other-notations-48` a string of several lines is not closed, so the parser as it is reads the rest of the payload as the string and reports its first error at the end.

The broken payloads have 73 to 477 code points, with a median of 220, and all but 2 are on several lines. 3 hold tabs, 1 has lines that end with a carriage return and a line feed, 12 hold a character outside ASCII, and 1 holds a character outside the Basic Multilingual Plane, the emoji of `other-notations-16`. A case has 140 scored code points on average, a tenth of the cases has 61 or fewer, and a tenth 231 or more.

The cases are not 150 trials that have nothing to do with each other. The three causes overlap, so the same sort of damage comes from two writers, in other files. By a reader's count of all cases:

- A value, a key or the name of a header without its quotes: 14 cases, e.g. `hand-editing-18` and `other-notations-07`.
- A number, a prompt or a sign of a diff before the lines: 10 cases, all of `model-and-paste.txt`.
- Sentences or a code fence around the document or in its middle: 8 cases.
- A closing bracket or brace that is missing: 7 cases, e.g. `hand-editing-05` and `other-notations-43`, which both lack the bracket of an array on several lines.
- Dots in the place of something that is left out: 6 cases. Typographic quotes: 5. A closing quote that is missing: 5.
- A key without a value: 4 cases. The comment sign of another notation: 4. A word of another notation for a literal or for no value: 4.
- An inline table half turned into a table with a header: `hand-editing-44` and `other-notations-50`, which are the same situation in two files.

So a parser that fails on one sort of damage loses several cases at once. The same sort of file comes several times too: by the writers' `from:` lines, 19 cases are a file of Cargo, e.g. a `Cargo.toml`, and 18 a `pyproject.toml`. `hand-editing-13` and `model-and-paste-09` are nearly the same config of a GitLab runner, with other damage.

No broken payload and no repaired document of the set is among the first 60,000 generated samples of the default seed, neither as the same text nor as the same TOML value. `bun lab/recovery-toml/held-back/written/check-overlap.ts` checks it in about 10 seconds, and its first line is `60000 samples of seed 20261016: 0 of 150 broken payloads and 0 of 300 repaired documents are among them, as the same text or as the same TOML value.` Parts of the texts are in both: 1,004 of the 1,630 keys and header names of the writers' repaired documents and 320 of their 888 strings are also in the documents of these samples, e.g. `edition` and `"2021"`. The writers and the generator's templates draw on the same files. Run the check again when the dataset changes.

### What the damage is

The train data of this track is damaged by ten edits that know nothing of TOML, see `lab/recovery-toml/damage.ts`: delete, insert, replace or swap a code point, delete, duplicate or copy a run of 2 to 20 code points, delete or duplicate a line, and cut the tail. A sample gets one to three of them, and an edit writes only copies of code points that the payload holds. `kinds.txt` says for every case whether such edits make its damage, i.e. whether the generator of the train data could have made this broken payload out of this repaired document. Where it could not, the damage needs knowledge of how TOML gets broken.

`neutral-edits.ts` derives the answer from the writer's repair. A damaged place is what the repair changes between two kept code points: text that is extra, text that is missing, or both. Every place gets the fewest edits that make it, e.g. `deleteCodePoint` for a quote that is missing, `replaceCodePoint` for a `:` in the place of `=`, and `copyRun` for an extra line `]` in a document that has a `]` at the end of another line. No edits make a place with an extra code point that the document does not hold, e.g. a typographic quote, or a place that takes more than three edits, e.g. a sentence before the document. A line of `kinds.txt` is the id of a case, the names of the edits in text order, and for a case whose damage one to three edits do not make ` new: ` and the reason in a few words, which a reader of all cases wrote. `written.test.ts` holds the names and the mark of every line against what `neutral-edits.ts` derives.

| Writer's file | One to three edits make the damage | More than three edits make it | A damaged place that no edits make |
| --- | --- | --- | --- |
| `hand-editing.txt` | 39 | 5 | 6 |
| `model-and-paste.txt` | 8 | 1 | 41 |
| `other-notations.txt` | 22 | 12 | 16 |
| All | 69 | 18 | 63 |

- **One to three edits, 69 cases.** A sample of the train data could have this damage. 47 cases take one edit, 17 take two and 5 take three. Most are slips of typing and files in the middle of typing: `deleteCodePoint` is in 36 cases, e.g. a closing quote or bracket that is missing, `deleteRun` and `insertCodePoint` are in 12 each, `replaceCodePoint` is in 9, `copyRun` in 4, and `swapNeighbours` and `cutTail` in 1 each. No case has `duplicateRun`, `deleteLine` or `duplicateLine`.
- **More than three edits, 18 cases.** Up to three edits make every damaged place, and one cause damaged more places than a sample has edits. E.g. the quotes that are missing around two values are four deleted code points, and a list of YAML has a dash before every item. Each place looks like damage of the train data, and no sample has so many.
- **A place that no edits make, 63 cases.** E.g. a sentence and a code fence around the document, a line number before every line, typographic quotes, `True` for `true`, and `export` before a key. In 12 of them, one to three edits would make the damage if an edit could write a code point that the document does not hold: `hand-editing-01`, `-35`, `-36` and `-44`, `model-and-paste-09`, `-17`, `-19` and `-40`, and `other-notations-05`, `-13`, `-24` and `-34`. E.g. `hand-editing-01` has an apostrophe in the place of a closing quote, in a document without an apostrophe.

The line is literal: it follows what the document holds, and not what a person would call the same sort of damage. E.g. the colons of YAML after three keys are three `replaceCodePoint` in `other-notations-01`, whose document has a colon inside an address, and a colon after two keys is damage that no edit makes in `other-notations-13`, whose document has none. And that the generator can make a payload does not say that it often does: two edits that fall on the two quotes of one value are possible and rare. So the 69 cases have damage that the train data could have, in documents that the train data lacks.

`scoreTables` gives the scores of the two parts as `neutralEdits` and `otherDamage`, and of the 18 cases as `moreEdits`. The answer is by the writer's repair. The second repair gives another answer for one case, `other-notations-32`: the writer adds two quotes at each end of a string, which two `deleteRun` make, and the second repair takes a backslash for extra that the document then lacks.

### What the parser as it is gets right

Each row has the percentage of the scored code points with display kind, depth and container right, the percentage of the cases with something to recover in which every scored code point is right, and the percentage of the scored display kinds, depths and containers that are right. `bun lab/recovery-toml/held-back/written/score.ts` prints the same numbers. No recovery rule was written for the set. One rule that knows nothing of the set is run on it, see [What one rule without any training gets right](#what-one-rule-without-any-training-gets-right).

| Cases | Count | Nothing to recover | Scored code points | All three | Whole | Kind | Depth | Container |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cases with full agreement | 144 | 2 | 20,303 | 61.7 | 4.9 | 75.6 | 74.6 | 79.9 |
| Full agreement, one to three edits make the damage | 69 | 2 | 8,255 | 59.4 | 9.0 | 79.2 | 69.4 | 77.4 |
| Full agreement, other damage | 75 | 0 | 12,048 | 63.3 | 1.3 | 73.2 | 78.0 | 81.6 |
| Full agreement, other damage that more than three edits make | 18 | 0 | 2,546 | 65.6 | 0.0 | 77.5 | 79.3 | 89.0 |
| Full agreement, no repair marked as unsure | 128 | 2 | 18,510 | 62.3 | 4.8 | 75.3 | 75.4 | 80.2 |
| All cases, the agreed code points | 150 | 2 | 20,986 | 61.8 | 5.4 | 75.4 | 75.1 | 80.2 |
| Agreed code points, one to three edits make the damage | 69 | 2 | 8,255 | 59.4 | 9.0 | 79.2 | 69.4 | 77.4 |
| Agreed code points, other damage | 81 | 0 | 12,731 | 63.4 | 2.5 | 72.9 | 78.7 | 82.0 |
| `hand-editing.txt`, full agreement | 50 | 0 | 6,376 | 58.7 | 8.0 | 78.2 | 69.7 | 81.7 |
| `model-and-paste.txt`, full agreement | 47 | 1 | 7,044 | 60.2 | 4.3 | 69.8 | 77.6 | 78.8 |
| `other-notations.txt`, full agreement | 47 | 1 | 6,883 | 66.0 | 2.2 | 79.3 | 75.8 | 79.4 |

The set has something to score: in the cases with full agreement the parser as it is has 7,773 of 20,303 scored code points wrong, and it has every scored code point right in 7 of the 142 cases with something to recover (`hand-editing-06`, `-07`, `-41` and `-45`, `model-and-paste-18` and `-29`, `other-notations-41`). It starts higher than the JSON parser as it is, which shows everything after its first error as an error and had 22.0% of the code points and 2.3% of the cases of the JSON set right. The TOML parser as it is goes on after its first error and gets most of the later lines right, so a recovery has less room to show here.

One thing it never gets right after its first error is a header: all 2,249 scored code points whose label is the name of a header are wrong, which is 29% of the wrong code points. E.g. it shows `[tasks.docs]` as keys inside an array, at depth 1. 1,975 of the wrong code points are shown as an error, and 1,423 of the wrong code points stand on the line of the first error.

### What one rule without any training gets right

The rule: after an error, the parser as it is starts anew at the next line, i.e. the tokenizer is between tokens, the grammar is at the start of a line and no container is open. `lab/recovery-toml/learn/restart-at-next-line.ts` holds it, and it reads no trained table and nothing of this folder. A review of the foundation found that this rule alone gets most of what the parser as it is has wrong, on the train data's validation split and on both held-back sets, so **a trained parser is read by what it adds to these rows**, and not by what it adds to the parser as it is.

| Cases | Count | Nothing to recover | Scored code points | All three | Whole | Kind | Depth | Container |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cases with full agreement | 144 | 2 | 20,303 | 84.2 | 29.6 | 85.6 | 96.2 | 96.3 |
| Full agreement, one to three edits make the damage | 69 | 2 | 8,255 | 89.2 | 34.3 | 90.5 | 96.9 | 97.1 |
| Full agreement, other damage | 75 | 0 | 12,048 | 80.9 | 25.3 | 82.3 | 95.8 | 95.7 |
| Full agreement, other damage that more than three edits make | 18 | 0 | 2,546 | 85.9 | 0.0 | 86.0 | 99.7 | 99.9 |
| Full agreement, no repair marked as unsure | 128 | 2 | 18,510 | 83.7 | 28.6 | 85.2 | 95.9 | 95.9 |
| All cases, the agreed code points | 150 | 2 | 20,986 | 84.0 | 31.1 | 85.3 | 96.3 | 96.4 |
| Agreed code points, one to three edits make the damage | 69 | 2 | 8,255 | 89.2 | 34.3 | 90.5 | 96.9 | 97.1 |
| Agreed code points, other damage | 81 | 0 | 12,731 | 80.6 | 28.4 | 81.9 | 96.0 | 96.0 |
| `hand-editing.txt`, full agreement | 50 | 0 | 6,376 | 89.9 | 32.0 | 90.5 | 97.5 | 97.8 |
| `model-and-paste.txt`, full agreement | 47 | 1 | 7,044 | 75.4 | 34.8 | 77.7 | 93.9 | 93.8 |
| `other-notations.txt`, full agreement | 47 | 1 | 6,883 | 88.1 | 21.7 | 89.1 | 97.4 | 97.6 |

In the cases with full agreement the rule has 17,105 of 20,303 scored code points right, where the parser as it is has 12,530, and 42 of the 142 cases with something to recover right as a whole, where the parser as it is has 7. What is left is mostly the display kind: depth and container are right at 96% of the code points. The rule gets the least in `model-and-paste.txt`, whose damage is mostly text around the document.

### Where the two repairs differ

`compare.ts` names 10 cases in which the two repairs give a code point other labels. Each was read with both repairs side by side. In all 10 the two repairs are two readings of the same payload, and each reading has a rule of `REPAIR.md` on its side. So no repair was corrected or left out, and nothing was settled: a disputed code point has no label.

In 4 cases the labels differ only before the first error of the parser as it is. No score counts such a code point, and the cases have full agreement:

- `hand-editing-32`, 1 code point: a `3` that was typed for the comment sign is the first character of the remark for the writer, and extra for the second repair.
- `hand-editing-45`, 1 code point: a comma that was typed before the closing quote stays a part of the string for the writer, and is extra for the second repair.
- `other-notations-29`, 1 code point: the space of `[merge-tools "meld"]` is extra for the writer, with a dot in its place, and stays as white space before the dot for the second repair.
- `other-notations-32`, 1 code point: a backslash at the end of a line inside a string is an escape of a string of several lines for the writer, and extra for the second repair.

6 cases have a disputed code point from the first error on, 107 code points in all:

| What the repairs differ on | Cases | Disputed code points |
| --- | --- | --- |
| Of two things in the payload one is too many, and the repairs keep different ones: the upper and the lower side of a search and replace block of a coding assistant | `model-and-paste-50` | 63 |
| A remark after an arrow, with no comment sign: a comment that lacks its sign, or text that is no part of the document | `model-and-paste-09` | 36 |
| A space that extra text brought along and that TOML takes as indentation: kept, or extra with the text. The space after the sign column of a diff, and the space after `export` | `model-and-paste-41` with 4, `other-notations-15` with 1 | 5 |
| Where the three closing quotes go that a string of several lines lacks: before or after the line feed of its last line | `other-notations-05` with 1, `other-notations-30` with 2 | 3 |

Rule 10 of `REPAIR.md`, read to the letter, decides `model-and-paste-50` for the writer: the first of two things stays. The case stays disputed all the same. In `model-and-paste-26` and `model-and-paste-41` both repairs keep the later of two things against the letter of the same rule, because the payload itself says which one is meant, and the second repair of `model-and-paste-50` reads its payload in that way.

The writers marked 19 repairs as unsure and the second repairers 7, in 21 cases. 5 of the 6 disputed cases are among them, and 16 of the 144 cases with full agreement. The row of the table above without these 16 is there so that a result can be held against both.

### What is dropped, and what to know about some cases

- **No case is dropped.** A case is dropped only when its writer or both repairers say that the meaning of the payload cannot be known, and nobody says so of any case.
- **No text of a case or of a repair was changed,** and no repair is left out. `check.ts` names 0 problems in the three files, for the writers' repairs and for the second repairs.
- **Two cases hold two files in one payload:** `model-and-paste-06`, two settings files of an answer, each in its own code fence, and `model-and-paste-30`, the output of `head` for two files. Both repairs of each keep both files as one document, which is valid TOML and which nobody meant as one file. The second repairs are marked as unsure, with the reading that drops the second file.
- **In four cases a line without a comment sign is extra by both repairs, where it could be a comment that lacks its sign:** the marks for lines that are left out in `model-and-paste-13`, `-14` and `-17`, and the path of the file inside the fence in `model-and-paste-44`. That is the question on which `model-and-paste-09` is disputed. The second repairs of `-13`, `-14` and `-44` name the other reading in a `note:` and not as `unsure:`, so `-13` and `-44` count as marked by nobody.
- **In two cases a label stands under another bracket than the one that a reader takes for the document's:** the `[` of a printed Python list in `model-and-paste-43`, and the `[` of what is left of a color code in `model-and-paste-48`. Of two equal code points the later one is the extra one, so the header's bracket is extra and the bracket before it has its label. Both stand before the first error, so no score counts them.
- **Two broken payloads are valid TOML 1.1,** which Bun's parser accepts: the inline table on several lines of `other-notations-10` and the times without seconds of `other-notations-39`. The table parser reads TOML 1.0 and rejects both, as rule 4 for a case asks.
- **`model-and-paste-34` keeps 114 of its 345 code points:** the rest is the frame and the line numbers of a terminal tool. `check.ts` asks to look at such a case, and the repair is the smallest change.
