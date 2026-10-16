# Broken miniml programs written by agents

This folder holds a test set of broken programs for the track of the transfer experiment on bison's LR table (`lab/recovery-lr/`). The language is miniml, a small language that looks like OCaml, see `lab/recovery-lr/LANGUAGE.md`. Agents write the cases from situations in which a program gets broken, e.g. a person who edits a file, a person who writes miniml with the habits of another language, or a tool that wraps or changes the text.

**The set is held back.** Whoever builds the tables, the train data, the recovery parser, the twins or the bars reads nothing in `lab/recovery-lr/held-back/`, this page included, and no code outside that folder imports from it. A parser that was shaped by a look at the cases, at their repairs or at a description of them says nothing about broken programs that nobody has seen. Such a reader gets numbers through whoever runs the final scoring.

The page up to [How a code point gets its label](#how-a-code-point-gets-its-label) is for a writer of cases. With `REPAIR.md`, `THEMES.md` and `lab/recovery-lr/LANGUAGE.md` it says everything a writer needs. The rest is for those who check the set and read its numbers.

## What a case is

A case is a broken program, one line that says where such a program comes from, and a repair. The repair says which valid program the author of the broken program meant, and which code point of the broken program is which code point of that program. E.g. someone who knows OCaml writes `let limit = 10;;`, and meant `let limit = 10`: the `;;` is added.

Nobody writes miniml in real life. So a case is realistic when it could happen if the language were in use, by the habits of people and tools that write OCaml, F#, Haskell, Elm or similar code. Think of miniml as the language of a small tool or of a course, with files that people type, paste, merge and send around.

The set tests a highlighter for miniml that goes on after an error. The highlighter gives every code point of a text three values: what the code point is shown as, e.g. a keyword or a name, how many brackets, `let`, `if` and `fun` are open at it, and which of `( [ let = in if then else fun ->` is the innermost open one. For a broken program, the right values are those of the program that its author meant.

After you, a second agent repairs each of your broken programs without seeing your repair. A code point of a broken program is scored only where your repair and the second repair give it the same values. A code point where they differ is called disputed and is kept apart.

## The steps of a writer

1. Read `lab/recovery-lr/LANGUAGE.md`, this page, `REPAIR.md` and `THEMES.md`. `THEMES.md` says which situations your file covers and what to avoid. Read the three examples in `examples/broken/examples.txt` and `examples/repairs/examples.txt`. Of `lab/recovery-lr/` outside this folder, read `LANGUAGE.md` and nothing else.
2. Write about 70 broken programs into `broken/<name>.txt`, where `<name>` is the name that `THEMES.md` gives your theme, e.g. `broken/hand-edits.txt`. Think of the situation first, then of the program that it happens to, then of the damage. Do not read the other writers' files.
3. Write one repair per broken program into `repairs/<name>.txt`, by the rules of `REPAIR.md`. Copy the lines of the broken program and add the marks.
4. Run the check from the repo's root, fix what it calls a problem, and read what it prints for every case:

   ```sh
   bun lab/recovery-lr/held-back/written/check.ts <name>
   ```

   Run it until its last line says 0 problems, e.g. `70 cases, 0 problems, 4 lines to look at`. A case without a problem can still be a case that the tools read in another way than you meant, so read the list of the damage and the `align` row of every case, as `REPAIR.md` says under "Check your file".
5. Commit your two files and no other path.

To try the tools first, run them on the examples:

```sh
bun lab/recovery-lr/held-back/written/check.ts examples --set lab/recovery-lr/held-back/written/examples
bun lab/recovery-lr/held-back/written/show.ts examples-01 --set lab/recovery-lr/held-back/written/examples
```

## The rules for a case

1. **The broken program is what its situation really produces, in the places where it produces it.** The content is realistic: the definitions are what such a file holds in real use, e.g. `let max_retries = 3` or `let rec join parts = …`, and not `foo` and `bar`. Vary the programs: other tasks, other shapes, other sizes, with and without comments, strings, local definitions, functions, lists, tuples and conditionals.
2. **The repair follows `REPAIR.md`:** the valid program that the author most likely meant, with the smallest change. So a broken program is a valid program with the damage and with no other change.
3. **The broken program has 40 to 480 code points, and the repaired program at most 480.** Most of your broken programs have between 120 and 400.
4. **The parser of `lab/recovery-lr/` rejects the broken program.** miniml accepts more than it seems to: two expressions side by side are an application, and nothing checks names. So `let next = if ready then go esle wait` is a valid program with a name `esle`, and so is a program with `begin`, `end`, `and`, `mod` or `True` in an expression. A program whose only fault is of that sort is no case, and the check says so.
5. **The parser accepts the repaired program.**
6. **A good part of the program comes after the parser's first error.** A score counts the kept code points from the token of the parser's first error on. A program that is only cut off, or a whole program with other text after it, has nothing there, and the check refuses it. The first error can come later than your damage, because the parser reads much as an application: the check prints where it is.
7. **No two cases have the same broken program, and no two differ in names, numbers and strings alone.** Every case has its own id, which starts with the name of your file, e.g. `hand-edits-07`.
8. **Mark a repair as unsure when another repair is as sensible and would change the label of a kept code point,** with the line `unsure: …` that says the other reading.

## The two files of a writer

Both files are UTF-8 with plain line feeds. `REPAIR.md` describes their format under "The aligned text" and "The two files": the markers, the two marks of an aligned text, and how a character that cannot be seen is written. A writer's files differ from what that page shows in one line: every repair has a line `from: …` that says in one line where such a broken program comes from.

The first example, in `examples/broken/examples.txt`:

```
⟦case examples-01⟧
⟦broken⟧
(* Totals for the weekly report. *)
let rec sum xs = if xs = [] then 0 else head xs + sum (tail xs)

let average xs =
  let total = sum xs
  let count = length xs in
  if count = 0 then 0 else total / count

let heading = "Weekly average  (* shown above the table *)
let () = print_string (heading ^ ": " ^ string_of_int (average [12; 15; 9]))⟦lf⟧
⟦end⟧
```

And its repair, in `examples/repairs/examples.txt`:

```
⟦repair examples-01⟧
from: a file edited by hand, with the `in` of a local definition and the closing quote of a string forgotten
unsure: the quote could be missing at the end of its line, with the remark as a part of the string
⟦aligned⟧
(* Totals for the weekly report. *)
let rec sum xs = if xs = [] then 0 else head xs + sum (tail xs)

let average xs =
  let total = sum xs
  ⟦missing⟧in ⟦/⟧let count = length xs in
  if count = 0 then 0 else total / count

let heading = "Weekly average⟦missing⟧"⟦/⟧  (* shown above the table *)
let () = print_string (heading ^ ": " ^ string_of_int (average [12; 15; 9]))⟦lf⟧
⟦end⟧
```

For this case the check prints:

```
--- examples-01  from: a file edited by hand, with the `in` of a local definition and the closing quote of a string forgotten
    unsure: the quote could be missing at the end of its line, with the remark as a part of the string
    repaired: 348 code points on 11 lines. broken: 344 code points on 11 lines.
    first damage at 141. First error of the parser as it is at code point 141, line 6: the token "let", where the parser takes only `in`.
    203 scored code points from there on. 1 token of the broken program has kept code points and is no token of the repaired program.
    what the alignment says the damage is:
      missing before 141: "in "
      missing before 237: """
      code points 0 to 117
doc   (* Totals for the weekly report. *)⏎let rec sum xs = if xs = [] then 0 else head xs + sum (tail xs)⏎⏎let average xs =⏎
label cccccccccccccccccccccccccccccccccccwkkkwkkkwdddwaawpwkkwnnwowppwkkkkwlwkkkkwnnnnwnnwownnnwpnnnnwnnpwwkkkwdddddddwaawpw
depth 0000000000000000000000000000000000001111111111111111122222222333222222222222222222222222223333333333311111111111111111
cont  ....................................lllllllllllllll==iiiiiiii[[[ttttttteeeeeeeeeeeeeeeeeee(((((((((((lllllllllllllll==

      code points 118 to 210
doc     let total = sum xs⏎  in let count = length xs in⏎  if count = 0 then 0 else total / count⏎⏎
label wwkkkwdddddwpwnnnwnnwwwkkwkkkwdddddwpwnnnnnnwnnwkkwwwkkwnnnnnwowlwkkkkwlwkkkkwnnnnnwownnnnnww
depth 112222222222222222222222223333333333333333333333333334444444444444444444444444444444444444444
cont  ==llllllllll===========nnnllllllllll============nnnnniiiiiiiiiiiiittttttteeeeeeeeeeeeeeeeeeee

      code points 211 to 270
doc   let heading = "Weekly average"  (* shown above the table *)⏎
label kkkwdddddddwpwsssssssssssssssswwcccccccccccccccccccccccccccw
depth 111111111111111111111111111111111111111111111111111111111111
cont  llllllllllll================================================

      code points 271 to 347
doc   let () = print_string (heading ^ ": " ^ string_of_int (average [12; 15; 9]))⏎
label kkkwppwpwnnnnnnnnnnnnwpnnnnnnnwowsssswownnnnnnnnnnnnnwpnnnnnnnwpllpwllpwlpppw
depth 11112222222222222222223333333333333333333333333333333344444444455555555555433
cont  llll(((===============((((((((((((((((((((((((((((((((((((((((([[[[[[[[[[[(((

      code points 0 to 117
brok  (* Totals for the weekly report. *)⏎let rec sum xs = if xs = [] then 0 else head xs + sum (tail xs)⏎⏎let average xs =⏎
align ......................................................................................................................
want  cccccccccccccccccccccccccccccccccccwkkkwkkkwdddwaawpwkkwnnwowppwkkkkwlwkkkkwnnnnwnnwownnnwpnnnnwnnpwwkkkwdddddddwaawpw
wantd 0000000000000000000000000000000000001111111111111111122222222333222222222222222222222222223333333333311111111111111111
wantc ....................................lllllllllllllll==iiiiiiii[[[ttttttteeeeeeeeeeeeeeeeeee(((((((((((lllllllllllllll==
now   cccccccccccccccccccccccccccccccccccwkkkwkkkwdddwaawpwkkwnnwowppwkkkkwlwkkkkwnnnnwnnwownnnwpnnnnwnnpwwkkkwdddddddwaawpw
nowd  0000000000000000000000000000000000001111111111111111122222222333222222222222222222222222223333333333311111111111111111
nowc  ....................................lllllllllllllll==iiiiiiii[[[ttttttteeeeeeeeeeeeeeeeeee(((((((((((lllllllllllllll==

      code points 118 to 207
brok    let total = sum xs⏎  let count = length xs in⏎  if count = 0 then 0 else total / count⏎⏎
align ..........................................................................................
want  wwkkkwdddddwpwnnnwnnwwwkkkwdddddwpwnnnnnnwnnwkkwwwkkwnnnnnwowlwkkkkwlwkkkkwnnnnnwownnnnnww
wantd 112222222222222222222223333333333333333333333333334444444444444444444444444444444444444444
wantc ==llllllllll===========llllllllll============nnnnniiiiiiiiiiiiittttttteeeeeeeeeeeeeeeeeeee
now   wwkkkwdddddwpwnnnwnnwww
nowd  11222222222222222222222
nowc  ==llllllllll===========
first                        ^

      code points 208 to 266
brok  let heading = "Weekly average  (* shown above the table *)⏎
bad                 !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
align ...........................................................
want  kkkwdddddddwpwssssssssssssssswwcccccccccccccccccccccccccccw
wantd 11111111111111111111111111111111111111111111111111111111111
wantc llllllllllll===============================================

      code points 267 to 343
brok  let () = print_string (heading ^ ": " ^ string_of_int (average [12; 15; 9]))⏎
align .............................................................................
want  kkkwppwpwnnnnnnnnnnnnwpnnnnnnnwowsssswownnnnnnnnnnnnnwpnnnnnnnwpllpwllpwlpppw
wantd 11112222222222222222223333333333333333333333333333333344444444455555555555433
wantc llll(((===============((((((((((((((((((((((((((((((((((((((((([[[[[[[[[[[(((
```

`REPAIR.md` explains every row. Four things to see here:

- The `in` that is missing stands right before the second `let`, and not at the end of the line before it. That is rule 4 of `REPAIR.md`, and the check refuses the repair otherwise.
- The parser as it is reports its first error at that second `let`, the `^` of the `first` row. A score counts the 203 kept code points from there on.
- The `bad` row marks the string that is not closed: for the scanner it is one piece of text up to the end of its line. The `want` row still says what each of its code points is in the repaired program: a string, two spaces and a comment.
- The depth grows with every `let`, `if` and bracket that is open, and a bracket is still open at its closing bracket and at the white space after it. `REPAIR.md` says why, under "What the tools do by a fixed rule".

## How a code point gets its label

The label of a code point of a broken program has three values: the display kind, the depth and the container, as `lab/recovery-lr/labels.ts` gives them. `written.ts` computes it in these steps:

1. **The two texts.** The aligned text of a repair gives the broken program, the repaired program, and for every code point of the broken program either the index of its counterpart in the repaired program or that it is added. The broken program that the aligned text gives must be the one of the file in `broken/`.
2. **A sample.** `makeSample` of `lab/recovery-lr/sample.ts` makes a sample of the two texts and the alignment, as it does for the train data. So a case has every field of a sample: the tokens, the first error, the stack at the first error, the labels, the kept tokens and the constituents.
3. **One fixed form.** `makeSample` brings the alignment into the form that every sample has: of two equal code points of which one is added, the later one is, and the same holds for a missing one. What an added text and the missing text at its place share at their start and at their end is kept. So two repairers who mean the same repair give the same alignment in most cases, however they set their marks. Where they do not, e.g. for two letters in the wrong order, `compare.ts` says that the two repaired programs are the same.
4. **The label of the counterpart.** A kept code point takes the display kind, the depth, the container and the hash of the stack of its counterpart in the repaired program.
5. **No label** for an added code point. A code point that stands in the place of another one is added too, e.g. a `,` for the `;` of a list: nothing says that the two play the same part. Every kept code point has a label, also in a token that the scanner cuts in another way than in the repaired program, e.g. `elif` for `else if` and a string without its closing quote. No value is left out as not scored, as some are in the written sets of the JSON and TOML experiments. So some labels ask for what no table can show, as some labels of the train data do.
6. **Two repairs.** A code point is agreed when both repairs keep it and give it the same display kind, depth and container. It is added when both repairs say so, and disputed otherwise. Only agreed code points have a label in the end: the sample of a case gives a disputed code point as an added one.
7. **From the first error on.** A score counts the code points from the first error of the parser as it is on that have a label. The experiment changes only what the parser does from its first error on.

Rule 4 of `REPAIR.md` is what this set adds to the way the train data gets its labels. White space and comments have the depth and the container that the token before them left. Where a token is missing before white space, e.g. the `=` at the end of a line, that white space would be "after the `=`" by its label, and a parser only learns that the `=` is missing when it reads the next token. So a repair puts a missing token right before the next token of the broken program, and the white space keeps the label that every parser gives it. The train data's damage knows no such rule: of 403 samples that `check-written.ts` makes with it from eight programs, the check of this folder refuses 50 by rule 4 alone. In those, white space after a missing token has a label that hangs on the token.

## The second repair and the comparison

A second repairer gets `REPAIR.md`, `lab/recovery-lr/LANGUAGE.md` and the files of `broken/`, and reads nothing else of this folder: not `repairs/`, not this page, not `THEMES.md`. That is why the broken programs are in files of their own. The repairs go into `second-repairs/`, in a file with the name of the file of broken programs, e.g. `second-repairs/hand-edits.txt` for `broken/hand-edits.txt`, with the same ids. `REPAIR.md` names the check for it.

```sh
bun lab/recovery-lr/held-back/written/compare.ts
```

compares the two repairs of every case and lists the code points where the labels differ. For the examples, with `--set lab/recovery-lr/held-back/written/examples`, its output starts with:

```
--- examples-01: the labels differ at 29 code points, 29 of them from the parser's first error at 141 on
    code points 237 to 238 "  ": writer: whitespace, depth 1, in =. second: string, depth 1, in =.
    code points 239 to 265 "(* shown above the table *)": writer: comment, depth 1, in =. second: string, depth 1, in =.
```

The second repair of that example puts the missing quote at the end of the line, which is the other reading that the writer's `unsure` line names. Under these lines the command prints the two repairs side by side, with a row `agree` that has `.` under an agreed code point, `+` under one that both repairs call added, and `!` under a disputed one. Its last lines count the cases, e.g. `3 cases with two repairs: 2 with the same labels at every code point, 1 with a difference, 1 of them with a difference from the parser's first error on, where a score counts. 0 cases have no second repair.`

Two repairs with the same labels can still differ in what the columns "stack" and "constituents" of a report read: the symbols on the stack at a code point, and the nonterminals over the kept tokens. E.g. for `(width; height)` one repair takes the `;` away, which leaves an application, and the other reads the `;` as a `,`, which gives a tuple. `height` is a name at the same depth in the same brackets by both, on another stack. The command says so for every such case, and its last line counts them.

A case with a difference is read by a person or an agent with both repairs side by side. When one of the two repairs breaks a rule of `REPAIR.md`, that repair is corrected. When the two are two readings of the same program, the case stays disputed: its disputed code points are never scored, and it is not among the cases with full agreement.

## How other code reads the set

`readWritten()` of `written.ts` returns `cases`, `problems` and `leftOut`. A case with a problem in its broken program or in one of its repairs is left out of `cases`, and `leftOut` has its id. So `problems` must be empty before a number of the set is used: `bun lab/recovery-lr/held-back/written/check.ts` prints them.

```ts
import {readWritten, samplesOfWritten} from './written.ts'
const {cases, problems} = readWritten()
const samples = samplesOfWritten(cases)                              // the cases with full agreement: the set's main number
const allSamples = samplesOfWritten(cases, 'agreed code points')     // all cases, without their disputed code points
```

- A sample is a `Sample` of `lab/recovery-lr/sample.ts`, so whatever scores the train and validation samples scores these: `isScored(sample, position)` is true for the agreed code points from the first error on, and `labelKind`, `labelDepth`, `labelContainer`, `labelStack`, `keptToken` and `constituents` are what a score compares with. `sample.original` is the writer's repaired program, and `sample.edits` holds the name of the writer's file, e.g. `['hand-editing']`.
- In a sample, a disputed code point is given as an added one: its alignment is -1 and it has no label. A token with such a code point is no kept token, and the constituents are those of the kept tokens that are left.
- `'full agreement'` gives the cases without a disputed code point from the first error on. A case with one repair has none. `'agreed code points'` gives every case in which an agreed code point stands from the first error on.
- A `WrittenCase` also has `file`, `from`, `opinions` (per repair the repaired program, its labels and the sample as that repair alone reads it), `agreement` per code point, `stackAgreed` (1 where both repairs also give the same hash of the stack; `sample.labelStack` is the writer's), `constituentsAgreed`, and `disputedFromFirstError`.

`score.ts` gives the set in the parts that a report has, for the final scoring:

```ts
import {scoreRow, scoreTablesByExactParser} from '../../learn/score.ts'
import {partsOfWritten, rowsOfParts} from './score.ts'
for (const {name, samples} of rowsOfParts(partsOfWritten())) console.log(scoreRow(name, scoreTablesByExactParser(tables, samples)))
```

- `partsOfWritten()` reads the set and `kinds.txt`, and throws when a file has a problem, so that no number is made of a set that is not whole. It returns `all`, `perFile` by the name of the writer's file, `neutralEdits` and `otherDamage`, which are the two parts that `kinds.txt` makes of the set, and `unmarked`, the cases of which no repair is marked as unsure. Each is `{fullAgreement, agreedCodePoints}`, two lists of samples.
- `rowsOfParts(parts)` gives the 13 rows of a report in their order, each with a name and its samples: the first is the cases with full agreement, which is the set's main number.
- A parser that is no table of the experiment is scored with `scoreOutputs` of `lab/recovery-lr/learn/score.ts` on the same samples, and `reportOf` of `lab/recovery-lr/learn/report.ts` counts the inserted tokens and the open cells that the samples read, on `packSamples(samples, tables)`.
- `disputedCodePointsOf(cases)` lists every disputed code point with its label by each repair. The disputed code points are in no sample, and nothing settles them.
- `bun lab/recovery-lr/held-back/written/score.ts` prints the rows for the parser as it is. It runs no recovery.

No code outside `lab/recovery-lr/held-back/` may import from it, so a command that scores tables on the set stands in this folder and imports the recovery parser and the score from outside. Whoever runs the final scoring writes it.

## The files of this folder

- `README.md`, `REPAIR.md` and `THEMES.md`: the rules for the writers and the repairers.
- `broken/`, `repairs/` and `second-repairs/`: the set. One file per writer in each, with the same name.
- `kinds.txt` says for every case which edits of the train data's damage make its damage, and whether one to three of them do. `neutral-edits.ts` derives the lines from the writers' repairs and says where the file differs.
- `examples/`: three worked cases in a folder of the same layout, with second repairs. They are no part of the set, and no score counts them.
- `format.ts` reads and writes the files. `written.ts` makes the samples and reads the set, with `readWritten(folder, options)`. `show.ts` prints a case, `check.ts` checks one writer's file or the whole set, `compare.ts` compares the two repairs of each case, and `start-second.ts` writes the file that a second repairer starts from.
- `score.ts` gives the set in the parts of a report and scores the parser as it is. `numbers.ts` prints the numbers of this page, and `check-overlap.ts` checks that no case is among the samples of the dataset.
- `dump.ts` writes 60 cases, or all of them, with their label rows into a file outside the repo, for a human reader.
- `check-written.ts` checks the tools, the examples and the pages' printed examples, `kinds.txt` and the numbers of this page. Its parts about the set print counts only, so that its output quotes no case. `tsconfig.json` is for the type check of this folder: `bunx tsc -p lab/recovery-lr/held-back/written`.

Every command takes `--set <folder>` for another folder of the same layout, except `check-written.ts`. `check.ts` without a name checks every file of the set and prints one line per case, and `show.ts <id>` prints one case of it, with `--second` as the second repair reads it and with `--both` both repairs side by side. `check.ts`, `show.ts`, `compare.ts`, `neutral-edits.ts` and `dump.ts` print or write the texts of cases. `written.ts`, `score.ts`, `numbers.ts`, `check-overlap.ts` and `check-written.ts` print counts only.

## The set as it is

The set has 210 cases: three writers wrote 70 each, every writer from one cause of broken programs, and every broken program was repaired a second time by an agent who did not see the writer's repair. It is used once, at the end of the experiment, to see how far a result on the train data carries over to broken programs that no generator made. The train data's damage is ten edits that know nothing of miniml, and the writers did not see it. One to three of these edits make the damage of 89 cases, and 121 cases have damage that such edits do not make, see [What the damage is](#what-the-damage-is).

Whoever builds or trains a parser, or writes a bar, reads nothing in this folder: not the cases, the repairs and `kinds.txt`, and not this page, the tools and the checks either, whose examples describe sorts of damage that only the cases have. Such a reader gets numbers alone, from whoever runs the final scoring.

The three files are `hand-editing.txt`, `other-languages.txt` and `model-and-paste.txt`. `THEMES.md` calls the first theme `hand-edits`, and its third theme, `tools-and-transport`, was written as `model-and-paste`: what the answer of a language model and a copy from a page, a chat, a PDF or a terminal do to a program, e.g. a code fence, line numbers, typographic quotes, the signs of a diff and the marker lines of a merge conflict. So the set has no place of a template that was not filled in, no HTML entity, no color code of a terminal and no byte order mark, which the third theme also lists. No broken program holds a tab or a carriage return.

The two second repairers read `REPAIR.md`, `lab/recovery-lr/LANGUAGE.md` and the files of `broken/`, and also this page as it stood before the set was written, although the page says that a second repairer does not read it. The page held the rules for a case and the first example then, and no case of the set. They committed their repairs before they ran `compare.ts`, and no repair was changed afterwards.

### What the set holds

| Writer's file | Cases | With full agreement | With a disputed code point | Scored code points | Of them in cases with full agreement |
| --- | --- | --- | --- | --- | --- |
| `hand-editing.txt` | 70 | 69 | 1 | 10,146 | 10,047 |
| `model-and-paste.txt` | 70 | 68 | 2 | 8,888 | 8,726 |
| `other-languages.txt` | 70 | 62 | 8 | 8,334 | 7,332 |
| All | 210 | 199 | 11 | 27,368 | 26,105 |

A case has full agreement when no code point from the first error of the parser as it is on is disputed. The broken programs have 47,354 code points, and 29,878 of them stand from that first error on. Of these, 27,368 are scored, 2,429 are added by both repairs, and 81 are disputed.

In 190 cases the two repairs give the same repaired program, and in 194 they give every code point the same label. In 5 cases the labels differ only before the first error, where no score counts, and 11 cases have a disputed code point from the first error on. See [Where the two repairs differ](#where-the-two-repairs-differ).

No case has nothing to recover: the check refuses a case without a kept code point from the first error on. The broken programs have 61 to 463 code points, with a median of 224, and all but 2 are on several lines. 18 hold a character outside ASCII, and 2 hold a character outside the Basic Multilingual Plane. A case has 130 scored code points on average, a tenth of the cases has 66 or fewer, and a tenth 214 or more. In 22 cases the first error is the program's first token.

The writers' repairs change the programs at 426 places, and 95 cases have one damaged place. In 43 cases the broken program only lacks text, in 87 it only has added text, and in 80 both. 49 cases hold a line of which every code point but white space is added. E.g. a sentence between two definitions, a marker line of a merge conflict, or a line with the type of a function above its definition.

**Most of what a score counts is easy once a parser finds the next definition.** 19,539 of the 27,368 scored code points, 71.4%, stand in a later definition that the damage did not touch: a definition at the top of the program that comes after the first error and whose code points all stand in the broken program, side by side. A parser that closes what is open and starts anew at the `let` of such a definition reads it as the plain parser reads a valid program. In 36 cases every scored code point stands in such a definition. So what tells two recoveries apart is mostly the other 7,829 scored code points: the rest of the damaged definition, and whether the parser finds the start of the next one. `numbers.ts` counts them from the labels, and no recovery was run for the number.

Three things about the labels that bound what a parser can get:

- **One output per token.** Every parser of the experiment shows a token of the frozen scanner as one thing. A token of a broken program can hold kept code points with different labels. E.g. in `hand-editing-04` an apostrophe stands for the opening quote of a string, so the closing quote starts a string for the scanner that reaches to the end of the line, over an operator and a name of the repaired program. So 130 of the 26,105 scored code points of the cases with full agreement cannot be right, 0.5%, and 12 of the 199 cases with full agreement cannot be right as a whole: `hand-editing-04`, `-16`, `-49`, `-52`, `-58`, `-64` and `-70`, `model-and-paste-43` and `-44`, and `other-languages-26`, `-47` and `-48`. For all 210 cases over their agreed code points, it is 130 of 27,368. The train data's samples lose more here, since their damage cuts tokens at random: `bun lab/recovery-lr/learn/score.ts` prints that one output per token allows 97.04% of the scored code points of the 5,000 validation samples, where it allows 99.5% here. 161 tokens in 49 cases have kept code points and are no token of the repaired program. Most of them can still be shown right, e.g. the words of a string between typographic quotes, which the scanner cuts as names: each is one token whose code points all want the label of a string.
- **`hand-editing-70` has 85 of the 130.** Its first error is a comment that is not closed, and the scanner reads the rest of the program as that comment. Of its 135 scored code points, the 50 of the comment can be right. `THEMES.md` allows two such cases per file, and the set has this one.
- **Before the first error nothing can change.** The parser as it is shows 756 of the 17,115 code points that the writers' repairs keep before the first error as another thing than their label, 4.4%. E.g. after a missing `=`, the first name of the body reads as a parameter. No score counts them.
- **The first bound is an upper bound and no more.** Frozen cells are followed after the first error too, so more is out of reach of every table than one output per token says. E.g. in `other-languages-31` the definitions after the first one have no `let` and are read as arguments and a comparison. And white space after added text keeps the label of the stack before the reductions that the added token causes. So the final table gives the cases with every token right next to "whole", see `../FINAL-SCORING.md`.

The cases are not 210 trials that have nothing to do with each other. The three causes overlap, so the same sort of damage comes from two or three writers, in other programs. By a reader's count of all cases:

- A remark, a sentence, the output of a tool or a declaration of another language on lines of its own: 49 cases, by the count of `numbers.ts` above.
- A character outside ASCII, e.g. a typographic quote, a dash, an arrow, a ligature, an emoji or a no-break space: 18 cases, all of `model-and-paste.txt`.
- A mark before the lines, e.g. a line number, the quote sign of a mail, the sign of a diff or a prompt: 8 cases, all of `model-and-paste.txt`.
- A comment sign that is missing, too many or made by accident: 9 cases, e.g. `hand-editing-67` and `other-languages-14`, which are both a comment inside a commented-out block.
- Another character for a quote of a string, e.g. an apostrophe, a backtick or a typographic quote: 7 cases. A string that lacks one of its quotes: 4 cases.
- A separator of a list, a tuple or a call that is another one, too many or left over: 12 cases, e.g. `hand-editing-21` and `other-languages-36`, which both have commas in a list.
- A bracket that is missing: 8 cases. A bracket too many or of the wrong sort: 4 cases.
- A missing `in` after a local definition: 4 cases, and a missing `then`: 4 cases. In 4 more cases a sign of another language stands for one of the two, e.g. the colon of Python for `then`.
- A definition without its `let`: 4 cases. A keyword in another form or with a slip in it, e.g. `def`, `fn`, `elif`, `lte` and a capital letter: 16 cases.
- An expression that miniml lacks and that is added as a whole, or dots in the place of a body: 10 cases.
- `;;` after a definition: 3 cases, and a `;` at the end of every line: 3 cases.

So a parser that fails on one sort of damage loses several cases at once. The programs are alike too: all are what a course or a small tool would hold, 138 end with a definition `let () = …`, and the same names come in many of them, e.g. `head` in 35 of the writers' repaired programs, `tail` in 32 and `total` in 24.

No broken program and no repaired program of the set is among the samples of the dataset, neither as the same text nor, for a repaired program, as the same tokens. `bun lab/recovery-lr/held-back/written/check-overlap.ts` checks it in about 10 seconds, and its first line is `45330 programs of seed 20261016, which hold the first 40000 train and the first 5000 validation samples: 0 of 210 broken programs and 0 of 230 repaired programs of the written set are among their texts, and 0 of 215 repaired programs have the tokens of one of their programs.` Parts of the texts are in both: 276 of the 685 names and 58 of the 248 strings of the writers' repaired programs are also in a program of the dataset, e.g. the names of functions that every such program calls. Run the check again when the dataset changes.

### What the damage is

The train data of this track is damaged by ten edits that know nothing of miniml, see `lab/recovery-lr/damage.ts`: delete, insert, replace or swap a code point, delete, duplicate or copy a run of 2 to 20 code points, delete or duplicate a line, and cut the tail. A sample gets one to three of them, and an edit writes only copies of code points that the program holds. `kinds.txt` says for every case whether such edits make its damage, i.e. whether the generator of the train data could have made this broken program out of this repaired program. Where it could not, the damage needs knowledge of how people and tools break such programs.

`neutral-edits.ts` derives the answer from the writer's repair. A damaged place is what the repair changes between two kept code points: text that is added, text that is missing, or both. Every place gets the fewest edits that make it, e.g. "delete a code point" for a closing bracket that is missing, "replace a code point" for a `]` in the place of a `)`, and "copy a run" for an argument that was pasted into the head of a definition. No edits make a place with an added code point that the program does not hold, e.g. a typographic quote, or a place that takes more than three edits, e.g. a sentence before the program. A line of `kinds.txt` is the id of a case, the names of the edits in text order with `, ` between them, and for a case whose damage one to three edits do not make ` new: ` and what the damage is in a few words, which a reader of all cases wrote. `check-written.ts` holds the edits and the mark of every line against what `neutral-edits.ts` derives.

| Writer's file | One to three edits make the damage | More than three edits make it | A damaged place that no edits make |
| --- | --- | --- | --- |
| `hand-editing.txt` | 63 | 0 | 7 |
| `model-and-paste.txt` | 12 | 0 | 58 |
| `other-languages.txt` | 14 | 1 | 55 |
| All | 89 | 1 | 120 |

- **One to three edits, 89 cases.** A sample of the train data could have this damage. 60 cases take one edit, 23 take two and 6 take three. By the cases that an edit is in: "delete a run" 33, "copy a run" 19, "insert a code point" 18, "delete a code point" 16, "replace a code point" 8, "swap two code points" 2, "duplicate a line" 2, "delete a line" 1, "duplicate a run" 1. No case has "cut the tail": a program that is only cut off has nothing to score, and the check refuses it.
- **More than three edits, 1 case.** `other-languages-69` has `fn x =>` for `fun x ->` twice, which is four edits at four places. A report counts it with the other damage.
- **A place that no edits make, 120 cases.** E.g. a sentence and a code fence around the program, a line number before every line, typographic quotes, `;;` after every definition in a program without a `;`, and a `match` with its arms. In 36 of them, one to three edits would make the damage if an edit could write a code point that the program does not hold. E.g. `hand-editing-48` has a colon for one `;` of a list, in a program without a colon.

The line is literal: it follows what the program holds, and not what a person would call the same sort of damage. Three things follow.

- **Damage that only a person or a tool makes can be on the side of the edits.** E.g. a line that was moved up by one is "delete a line" and "copy a run" in `hand-editing-17`, the Markdown marks of `**5**` are two inserted asterisks and a copied run in `model-and-paste-07`, whose program holds an asterisk, and `elif` twice is "delete a run" twice in `other-languages-26`. The writer of `hand-editing.txt` counts 17 of its cases as damage that no simple list of kinds would make, and one to three edits make 16 of them. So the 89 cases have damage that the train data could have, in programs that the train data lacks, and not damage that the train data often has: a copied run that lands where a person would paste it is possible and rare.
- **The derivation finds a little less than the edits make.** It reads every damaged place by itself, and two edits of a sample can touch the same text. Held against samples whose damage is one to three edits by construction, it finds one to three edits for 2,951 of the first 3,000 validation samples of the dataset: all 1,364 with one edit, 1,123 of the 1,130 with two and 464 of the 506 with three. `bun lab/recovery-lr/held-back/written/neutral-edits.ts --samples 3000` prints the numbers. So a case can be marked `new:` although three edits make it. That cannot be for a case with an added code point that its program does not hold, and of the 120 cases only `other-languages-12` and `other-languages-35` have none: a pattern in brackets after `let` and after `fun`, and a remark of 26 code points after `--`.
- **The answer is by the writer's repair.** The second repair gives another answer for 1 case, `model-and-paste-59`: the writer puts two asterisks back into a comment, which is "delete a code point" twice, and the second repair adds the 12 code points of the remark.

`partsOfWritten` of `score.ts` gives the samples of the two parts as `neutralEdits` and `otherDamage`.

### What the parser as it is gets right

The parser as it is stops at its first error and shows every token from there on as an error. White space and comments are shown as what they are, with the depth and the container of the stack at the first error. Each row has the share of the scored code points that one output per token can have right, the percentage of the scored code points with display kind, depth and container right, the percentage of the cases in which every scored code point is right, the percentages with the kind, the depth and the container right, the percentage whose token is taken on the stack that the repaired program has there, and for the constituents first the share of the repaired programs' that the parser has and then the share of the parser's that the repaired programs have. `bun lab/recovery-lr/held-back/written/score.ts` prints the same numbers. No recovery was written for the set or run on it.

| Cases | Count | Scored code points | One output per token allows | All three | Whole | Kind | Depth | Container | Stack | Constituents: found, right |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cases with full agreement | 199 | 26,105 | 99.5 | 1.5 | 0.0 | 20.0 | 19.1 | 12.1 | 0.2 | 29.6, 94.5 |
| Full agreement, one to three edits make the damage | 87 | 12,642 | 99.1 | 1.3 | 0.0 | 19.4 | 21.5 | 14.5 | 0.1 | 30.0, 95.6 |
| Full agreement, other damage | 112 | 13,463 | 99.9 | 1.6 | 0.0 | 20.4 | 16.8 | 9.8 | 0.2 | 29.2, 93.4 |
| Full agreement, no repair marked as unsure | 187 | 24,476 | 99.5 | 1.4 | 0.0 | 20.0 | 17.7 | 11.6 | 0.1 | 29.4, 94.6 |
| All cases, the agreed code points | 210 | 27,368 | 99.5 | 1.5 | 0.0 | 19.9 | 19.2 | 12.0 | 0.2 | 29.8, 94.5 |
| Agreed code points, one to three edits make the damage | 89 | 12,817 | 99.1 | 1.3 | 0.0 | 19.4 | 21.4 | 14.4 | 0.1 | 30.6, 95.6 |
| Agreed code points, other damage | 121 | 14,551 | 99.9 | 1.7 | 0.0 | 20.4 | 17.2 | 10.0 | 0.2 | 29.0, 93.5 |
| `hand-editing.txt`, full agreement | 69 | 10,047 | 98.8 | 1.3 | 0.0 | 19.7 | 22.0 | 13.5 | 0.1 | 28.2, 95.4 |
| `hand-editing.txt`, agreed code points | 70 | 10,146 | 98.8 | 1.3 | 0.0 | 19.7 | 21.8 | 13.4 | 0.1 | 28.6, 95.3 |
| `model-and-paste.txt`, full agreement | 68 | 8,726 | 99.9 | 1.4 | 0.0 | 19.2 | 17.3 | 11.4 | 0.2 | 34.1, 97.6 |
| `model-and-paste.txt`, agreed code points | 70 | 8,888 | 99.9 | 1.5 | 0.0 | 19.2 | 18.2 | 11.8 | 0.2 | 34.6, 97.7 |
| `other-languages.txt`, full agreement | 62 | 7,332 | 99.9 | 1.9 | 0.0 | 21.2 | 17.1 | 11.1 | 0.2 | 25.5, 88.0 |
| `other-languages.txt`, agreed code points | 70 | 8,334 | 99.9 | 1.8 | 0.0 | 21.1 | 16.9 | 10.6 | 0.2 | 25.4, 88.6 |

The set has something to score: in the cases with full agreement the parser as it is has 387 of 26,105 scored code points right, and every scored code point in none of the 199 cases. What it has right is white space and comments where the depth and the container at the first error happen to be the label's. Nearly all constituents that it has are those from before the first error.

The columns "stack" and "constituents" take the writer's repair. Where the two repairs give a code point the same label, they can still differ in these two: 9 scored code points in 2 cases stand on another stack by the second repair. In `hand-editing-22` they are the 4 code points after a bracket that the repairs read in two ways, and in `hand-editing-53` they are 5 code points after text that the writer also gives back as missing where it belongs and the second repairer only calls added. The constituents over the kept tokens are the same by both repairs in every case.

### Where the two repairs differ

`compare.ts` names 16 cases in which the two repairs give a code point other labels. Each was read with both repairs side by side. No repair was corrected or left out, and nothing was settled: a disputed code point has no label.

In 5 cases the labels differ only before the first error of the parser as it is. No score counts such a code point, and the cases have full agreement:

- `hand-editing-26` and `other-languages-02`, 1 code point each: the space before a `*)` and before an `in` that are too many stays as white space for the writer, and is added with them for the second repair.
- `hand-editing-61`, 2 code points: a list ends with `; ]`. The writer keeps the `;` and has an item missing after it, and the second repair adds the `;` and its space. Both repairs are marked as unsure, each with the other's reading.
- `other-languages-43` and `other-languages-44`, 1 code point each: the `*` of the operator sections `(*2)` and `(*)` is added for the writer, and stays as an operator with `()` missing at its sides for the second repair.

11 cases have a disputed code point from the first error on, 81 code points in all:

| What the repairs differ on | Cases | Disputed code points |
| --- | --- | --- |
| A part of a definition in the form of another language: added as a whole, as rule 6 of `REPAIR.md` says of an expression that miniml lacks, or kept with the keywords of miniml missing at their places, as rule 5 says of a token in another form. The guards of Haskell in the place of a body, and a `where` line | `other-languages-39` with 40, `other-languages-41` with 21 | 61 |
| Words in brackets after a value: a comment that lost its two asterisks to a chat app, or a remark that is no part of the program | `model-and-paste-59` | 11 |
| White space beside added text: the line feed after an expression that is added as a whole, and a space beside added text in the middle of a line | `other-languages-04`, `-05`, `-17`, `-24`, `-38` and `-64`, `model-and-paste-39`, with 1 each | 7 |
| A closing bracket without an opening one: one too many, as rule 8 says, or the opening one is missing | `hand-editing-22` | 2 |

Seven of the 11 cases are out of the cases with full agreement over one scored code point of white space each, and their two repairs give every other scored code point the same label. In five of them an expression that miniml lacks fills whole lines, e.g. a `match` with its arms. Rule 6 adds the expression from its first word to the end of its last arm, and the rule about white space adds a line that holds nothing of the program as a whole line, with its indentation and its line end. The writer followed the first and the second repairer the second. One sentence in `REPAIR.md` would decide these, and it was not added, since that would settle a disputed code point after the fact. The row of the agreed code points counts these seven cases without the one code point.

The section on the comparison above says that a repair which breaks a rule of `REPAIR.md` is corrected. That was not done for this set: every disputed code point stays as the two repairers left it, so that nobody who has seen both repairs decides a label. Two second repairs are against the letter of a rule, and their repairers say so in their reports. In `hand-editing-22` rule 8 adds a closing bracket without an opening one, and in `model-and-paste-59` rule 10 takes the reading that changes fewer code points, which is the writer's with 2 against 12. With these two corrected, 201 cases would have full agreement, and with a sentence on white space 208. The two cases about a definition in the form of another language would stay disputed: each reading has a rule on its side.

The writers marked 9 repairs as unsure and the second repairers 9, in 16 cases. 4 of the 11 disputed cases are among them, and 12 of the 199 cases with full agreement. The row of the table above without these 12 is there so that a result can be held against both.

Four more things that the rules of `REPAIR.md` leave open, on which the two repairs of a case happened to agree:

- **Which side of a diff stays.** In `model-and-paste-36` and `model-and-paste-38` both repairs keep the new side, against the letter of rule 9, by which the first of two things stays: a diff says which one its author wants.
- **Text that was moved.** No mark says "moved". In `hand-editing-05`, `-40`, `-53` and `-59` the writer calls the text added where it stands and missing where it belongs. In `hand-editing-17`, two lines in the wrong order, both repairs keep the first line and are marked as unsure.
- **A word of another language that miniml reads as a name.** `mut` in `other-languages-65` and `return` in `other-languages-46` and `-55` are added by both repairs, by rule 6, although miniml accepts them, and `not` stays a name in `other-languages-52`, where only the `in` of `not in` is added.
- **A line number that miniml reads as an argument.** In `model-and-paste-26` both repairs add the numbers that are glued to the lines.

### What is dropped, and what to know about some cases

- **No case is dropped.** A case is dropped only when its writer or both repairers say that the meaning of the program cannot be known, and nobody says so of any case. `hand-editing-61` is the closest: both repairs call the other reading as likely. They differ at 2 code points before the first error and agree on every scored one.
- **No text of a case or of a repair was changed,** and no repair is left out. `check.ts` names 0 problems in the three files, for the writers' repairs and for the second repairs, and nothing in the format of the nine files had to be fixed. No case was found whose content is wrong, i.e. whose broken program is not what its `from:` line says, or whose repair by the writer breaks a rule of `REPAIR.md` to the letter.
- **In three cases a label asks for a comment where the scanner cuts code.** In `hand-editing-67` and `other-languages-14` a comment inside a commented-out block ends the block too early, and both repairs add the inner `*)`, so the text up to the last `*)` is wanted as a comment. Most of it stands before the first error. In `hand-editing-70` the comment is never closed, see above.
- **The repaired program of `model-and-paste-24` has no white space between two definitions.** A model's end-of-text token stands between `10` and `let`, and it is added with nothing missing in its place, so the repaired program holds `10let`, which miniml reads as two tokens. The labels are those of the program with a line feed there.
- **`other-languages-58` keeps 66 of its 125 code points,** the least of all cases: the rest is remarks in the comment signs of JavaScript and a `;` after every line. `model-and-paste-29` keeps 76 of 136, without the prompts and the answers of an interactive session. `check.ts` asks to look at a repair that keeps less than half, and there is none.
- **The labels of the train data and of this set differ in one rule.** Rule 4 of `REPAIR.md` puts a missing token right before the next token of the broken program, so that white space keeps a label that a parser can show. The train data's damage knows no such rule, see [How a code point gets its label](#how-a-code-point-gets-its-label). So the share of whole cases here and the share of whole samples on the validation split are not counted over the same sort of labels.
