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

- A sample is a `Sample` of `lab/recovery-lr/sample.ts`, so whatever scores the train and validation samples scores these: `isScored(sample, position)` is true for the agreed code points from the first error on, and `labelKind`, `labelDepth`, `labelContainer`, `labelStack`, `keptToken` and `constituents` are what a score compares with. `sample.original` is the writer's repaired program, and `sample.edits` holds the name of the writer's file, e.g. `['hand-edits']`.
- In a sample, a disputed code point is given as an added one: its alignment is -1 and it has no label. A token with such a code point is no kept token, and the constituents are those of the kept tokens that are left.
- `'full agreement'` gives the cases without a disputed code point from the first error on. A case with one repair has none. `'agreed code points'` gives every case in which an agreed code point stands from the first error on.
- A `WrittenCase` also has `file`, `from`, `opinions` (per repair the repaired program, its labels and the sample as that repair alone reads it), `agreement` per code point, `stackAgreed` (1 where both repairs also give the same hash of the stack; `sample.labelStack` is the writer's), `constituentsAgreed`, and `disputedFromFirstError`.

No code outside `lab/recovery-lr/held-back/` may import from it, so a command that scores tables on the set stands in this folder and imports the recovery parser and the score from outside. Whoever runs the final scoring writes it.

## The files of this folder

- `README.md`, `REPAIR.md` and `THEMES.md`: the rules for the writers and the repairers.
- `broken/`, `repairs/` and `second-repairs/`: the set. One file per writer in each, with the same name.
- `examples/`: three worked cases in a folder of the same layout, with second repairs. They are no part of the set, and no score counts them.
- `format.ts` reads and writes the files. `written.ts` makes the samples and reads the set, with `readWritten(folder, options)`. `show.ts` prints a case, `check.ts` checks one writer's file or the whole set, `compare.ts` compares the two repairs of each case, and `start-second.ts` writes the file that a second repairer starts from.
- `check-written.ts` checks the tools, the examples and the pages' printed examples. Its part about the set prints counts only, so that its output quotes no case. `tsconfig.json` is for the type check of this folder: `bunx tsc -p lab/recovery-lr/held-back/written`.

Every command takes `--set <folder>` for another folder of the same layout, except `check-written.ts`. `check.ts` without a name checks every file of the set and prints one line per case, and `show.ts <id>` prints one case of it, with `--second` as the second repair reads it and with `--both` both repairs side by side.

## The set as it is

The set is not written yet. This section gets its numbers when the three writers and the second repairers are done: the cases per writer's file, the cases with full agreement, the scored code points, what the two repairs differ on, and what is dropped.
