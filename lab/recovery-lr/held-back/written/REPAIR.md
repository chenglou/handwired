# Repairing broken miniml programs

You get broken programs in miniml, and you write one repair per program. This page says everything a repairer needs, together with `lab/recovery-lr/LANGUAGE.md`, which describes the language. A writer of cases reads `README.md` first and then this page. A second repairer reads this page, `LANGUAGE.md` and the file of broken programs, and nothing else of this folder.

## What a repair is for

The programs test a highlighter for miniml that goes on after an error. The highlighter gives every code point of a text three values:

- what the code point is shown as: white space, a comment, a keyword, a name, a defined name (the `f` of `let f x = …`), a parameter (the `x` of `let f x = …` and of `fun x -> …`), a constant (an integer, `true`, `false`), a string, an operator or punctuation.
- the depth: how many `(`, `[`, `let`, `if` and `fun` are open at the code point.
- the container: the innermost of `( [ let = in if then else fun ->` that is open at the code point.

For a broken program, the right values are those of the program that its author meant. E.g. someone forgets the `in` of `let total = sum xs in let count = length xs in total / count`. The second `let` still starts a local definition inside the body of the first one, because it does so in the program that was meant.

Your repair says what that program is, and which code point of the broken program is which code point of that program. A code point of the broken program then has the values of its counterpart. A code point without a counterpart is called added, and it has no values.

So what matters in a repair is which code points of the broken program you keep, and between which brackets and keywords they end up. What you add matters little, e.g. `()` for an expression that is missing.

## The rules

**Write the valid miniml program that the author most likely meant, with the smallest change to the broken program.** A program is valid when the parser accepts it. Nothing checks names or types, and nobody runs the program, so your repaired program only has to say what the author meant as far as the syntax goes.

1. **Keep every code point that belongs to the program exactly as it stands in the broken program:** the same characters in the same order, with the same indentation, the same line ends and the same spaces. Do not lay the text out anew, do not rename, and do not correct what miniml accepts as it stands. E.g. a name with a spelling mistake stays, and so do `True`, `None` and `not`, which are names for miniml.
2. **Text that is no part of the program is added,** e.g. a sentence around the program, a code fence, a marker line of a merge conflict, a line number before a line, the prompt and the answers of an interactive session, the `;;` after a definition, a `;` at the end of a line, a bracket too many.
3. **Add only what is missing,** e.g. an `=`, an `in`, a `then`, an `->`, a closing bracket, a closing quote, the `*)` of a comment. What the author already typed stays: `let total = price +` becomes `let total = price + ()`, and the `+` is not taken away. An expression that is missing is `()`, and a name that is missing after `let` or `fun` is `_`, e.g. `fun -> 0` becomes `fun _ -> 0`. An expression that stands where a definition has to start gets `let _ = ` before it. Take `_` there and not `()`: the brackets of `let () = …` stay open for the whole body, so the depth of every kept code point of the body would hang on your choice.
4. **A whole token that is missing stands right before the next token that the broken program has, after the white space and the comments between them.** A parser only learns that a token is missing when it reads the next token, and white space belongs to the token before it. E.g. the `=` that is missing in

   ```
   let indent depth
     repeat " " (depth * step)
   ```

   stands right before `repeat`, with a space of its own, and not at the end of the first line:

   ```
   let indent depth
     ⟦missing⟧= ⟦/⟧repeat " " (depth * step)
   ```

   The same holds for a closing bracket that is missing at the end of a line: it stands at the start of the next line that has a token, e.g. `⟦missing⟧)⟦/⟧let …`. A token that is missing after the program's last token stands at the very end. The check refuses a repair that breaks this rule. The rule is about whole tokens: a quote that is missing at the end of a string stands where the string ends.
5. **A token that the author typed in another form is added, and the token of miniml is missing right at its place.** E.g. `!=` or `/=` for `<>`, `=>` for `->`, `\` for `fun`, `elif` for `else if`, a `,` between the expressions of a list for `;`, `begin` and `end` around an expression for `(` and `)`, `def` for `let`, apostrophes or typographic quotes around a string for `"`. Write the added run first and the missing run right after it: `[72⟦added⟧,⟦/⟧⟦missing⟧;⟦/⟧ 85]`. Rule 4 does not move such a token. The same holds for a keyword with a slip in it, e.g. `esle` for `else`, where the program is not valid with the word as a name. For two letters in the wrong order, the first of the two stays and the second is added, e.g. `e⟦missing⟧l⟦/⟧s⟦added⟧l⟦/⟧e`.
6. **Keep a token only as what its author meant.** A kept token is shown as what it is in your repaired program. So a name of a value stays a name, a number stays a number, an operator an operator, and a keyword that keyword. What miniml has no such part for is added:
   - **A sign that miniml lacks is added alone,** and what stands around it stays. E.g. the `.` of `List.length names` and of `3.5`, the `!` of `!counter`, the `:` of `total := total + 1`, the `|` of `xs |> sort`, the `@` of `xs @ ys`, the second `*` of `a ** b`, the `$` of `show $ f x`, the `;` between two expressions that the author meant one after the other. Where two tokens would run together without the sign, a space is missing at its place: `List⟦added⟧.⟦/⟧⟦missing⟧ ⟦/⟧length names`.
   - **A type and a declaration that the program does not need are added,** e.g. `: int` after a parameter with the brackets that only the type needs, a line `val area : int -> int`, a line `open List`, a definition of a type. In `let f (x : int) = x` the `int` is no second parameter, although `let f x int = x` is a valid program.
   - **An expression that is built with words that miniml lacks is added as a whole, and `()` is missing in its place,** e.g. `match … with` and all of its arms, `try … with`, a loop, a record in braces, `function` with arms. It reaches from its first word as far as the author's language says: for `match`, to the end of the last arm. miniml would read `match xs with` as three names, and the author meant none of them as a name. By rule 4 the `()` stands right before the next token that the broken program has after the expression.
   - **A pattern in the place of a defined name or a parameter is added as a whole, and `_` is missing at its place,** e.g. `let ⟦added⟧(a, b)⟦/⟧⟦missing⟧_⟦/⟧ = pair`.
7. **A remark with the comment sign of another language is added as a whole,** from its sign to the end of its line or to its closing sign, e.g. `// in cells`, `-- in cells`, `# in cells` and `{- in cells -}`. The white space before the remark stays. A comment of miniml whose `*)` is missing gets it, by rule 3.
8. **A closing bracket without an opening one is added.** A closing bracket that is missing stands where the author most likely meant it. Where nothing in the program says so, it stands as late as it can: right before the first token that cannot be inside the brackets, e.g. the `let` of the next definition.
9. **Of two things of which one is too many, the first one stays,** e.g. the upper side of a merge conflict, with the lower side, the three marker lines and their line ends as added.
10. **Where two readings are about equally likely, take the one that changes fewer code points, mark the repair as unsure, and say the other reading.** A changed code point is one that is added or missing.

Two things about white space decide whether two repairs of one program agree, so follow them to the letter:

- **Where text before the program is added, all white space between that text and the program is added too, so that the repaired program starts with the program's first character.** The same holds after the program. E.g. of a sentence, an empty line, a code fence, the program, a line feed and a closing fence, the program alone is kept, with no line feed at its end. On a side where the broken program has only white space, that white space is kept, e.g. the line feed after the last line of a file.
- **A line that holds nothing of the program is added as a whole line, with its indentation and its line end.** Where added text shares its line with a part of the program, only that text is added, e.g. the `;;` of `let limit = 10;;`.

## The aligned text

A repair is written as an aligned text: the broken program with marks. It holds the broken program and the repaired program at once.

| Mark | What it says | Example |
| --- | --- | --- |
| `⟦added⟧…⟦/⟧` | The text between the two marks is in the broken program and not in the repaired program | `let limit = 10⟦added⟧;;⟦/⟧` |
| `⟦missing⟧…⟦/⟧` | The text between the two marks is in the repaired program and not in the broken program | `let limit ⟦missing⟧= ⟦/⟧10` |

Everything outside the marks is in both texts, as the same code points. So the aligned text without every `⟦missing⟧…⟦/⟧` and with the text of every `⟦added⟧…⟦/⟧` is the broken program, code point for code point. The check refuses a repair for which that does not hold.

- A run of added or missing text can hold line feeds: it then goes on over several lines of the file, e.g. the lower side of the conflict in the second repair below.
- No mark stands inside a run, and no run is empty.
- No mark says that one code point stands in the place of another. Such a code point is added, and the one that was meant is missing after it, e.g. `fun x ⟦added⟧=>⟦/⟧⟦missing⟧->⟦/⟧ x + 1`.

The surest way to write an aligned text is to copy the lines of the broken program and then to add the marks.

## The two files

A file of broken programs holds each program under an id:

```
⟦case examples-02⟧
⟦broken⟧
let rec gcd (a : int) (b : int) : int =
  if b == 0 then a else gcd b (a mod b);;

let scores = [72, 85, 91]
let best = List.fold_left max 0 scores;;
let () = Printf.printf "best: %d\n" best⟦lf⟧
⟦end⟧

⟦case examples-03⟧
⟦broken⟧
let width = 72
let rec repeat text count = if count = 0 then "" else text ^ repeat text (count - 1)
<<<<<<< HEAD
let indent depth = repeat "  " depth
=======
let indent depth = repeat "\t" depth
>>>>>>> use-tabs
let line depth text = indent depth ^ text⟦lf⟧
⟦end⟧
```

Your repair file holds one repair per broken program, under the same id:

```
⟦repair examples-02⟧
⟦aligned⟧
let rec gcd ⟦added⟧(⟦/⟧a ⟦added⟧: int) (⟦/⟧b⟦added⟧ : int) : int⟦/⟧ =
  if b ⟦added⟧==⟦/⟧⟦missing⟧=⟦/⟧ 0 then a else gcd b (a mod b)⟦added⟧;;⟦/⟧

let scores = [72⟦added⟧,⟦/⟧⟦missing⟧;⟦/⟧ 85⟦added⟧,⟦/⟧⟦missing⟧;⟦/⟧ 91]
let best = List⟦added⟧.⟦/⟧⟦missing⟧ ⟦/⟧fold_left max 0 scores⟦added⟧;;⟦/⟧
let () = Printf⟦added⟧.⟦/⟧⟦missing⟧ ⟦/⟧printf "best: %d\n" best⟦lf⟧
⟦end⟧

⟦repair examples-03⟧
⟦aligned⟧
let width = 72
let rec repeat text count = if count = 0 then "" else text ^ repeat text (count - 1)
⟦added⟧<<<<<<< HEAD
⟦/⟧let indent depth = repeat "  " depth⟦added⟧
=======
let indent depth = repeat "\t" depth
>>>>>>> use-tabs⟦/⟧
let line depth text = indent depth ^ text⟦lf⟧
⟦end⟧
```

The first repair gives the program `let rec gcd a b =` and so on. `mod` stays: it is a name for miniml, and `a mod b` is an application. The second repair keeps the upper side of the conflict, by rule 9.

- `⟦repair id⟧` starts a repair, `⟦aligned⟧` starts its aligned text, and `⟦end⟧` ends it. `⟦case id⟧` and `⟦broken⟧` do the same in a file of broken programs. Such a marker stands alone on its line, from the line's first character on. Copy the two brackets `⟦` and `⟧` from this page: they are U+27E6 and U+27E7, and no other bracket works.
- `unsure: …` is the optional mark of rule 10, one line before `⟦aligned⟧` that says the other reading in a sentence.
- `note: …` is one optional line for anything else that a reader should know.
- A writer's repair also has the line `from: …`, see `README.md`. A second repair has none.
- Empty lines between two entries are fine. The file is UTF-8 with plain line feeds.

A text is written as it is. Quotes and backslashes need no escaping: what stands between two marker lines is the text, character for character. So the `\n` and the `\t` in the strings above are a backslash and a letter. The lines are joined with line feeds, and the line feed before the next marker line is not a part of the text. So a text that ends with a line feed has `⟦lf⟧` at the end of its last line, as both programs above have.

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
- A line of a text does not end with a plain space. Write the last space as `⟦sp⟧`, e.g. `let limit =⟦sp⟧`.
- A text does not start or end with an empty line. A text that ends with a line feed has `⟦lf⟧` at the end of its last line, and one that ends with two has `⟦lf⟧⟦lf⟧`. Empty lines in the middle of a text are fine.
- The brackets themselves are `⟦U+27E6⟧` and `⟦U+27E7⟧` inside a text.

A second repairer starts the repair file with a command, from the repo's root and with the name of the file of broken programs without its ending:

```sh
bun lab/recovery-lr/held-back/written/start-second.ts hand-edits
```

It writes `second-repairs/hand-edits.txt` with every broken program of `broken/hand-edits.txt` as an aligned text without marks, which changes nothing yet. Add the marks to that file.

## Check your file

From the repo's root, with the name of your file without its ending. A writer, for `broken/hand-edits.txt` and `repairs/hand-edits.txt`:

```sh
bun lab/recovery-lr/held-back/written/check.ts hand-edits
```

A second repairer, for `broken/hand-edits.txt` and `second-repairs/hand-edits.txt`:

```sh
bun lab/recovery-lr/held-back/written/check.ts hand-edits --second
```

The check prints every repair back as the tools read it, and its last line is e.g. `70 cases, 0 problems, 3 lines to look at`. Run it until that line says 0 problems, and read what it prints for every repair: a repair without a problem can still be a repair that the tools read in another way than you meant.

A line that starts with `problem:` names something that keeps a repair out of the set: the format of the file, an aligned text that does not give the broken program, a repaired program that the parser rejects or that has more than 480 code points, a missing token before white space against rule 4, a repair after which no kept code point stands from the parser's first error on, an id that the file of broken programs does not have, a broken program without a repair. For a repaired program that the parser rejects, the line says where the parser stops and what it takes there.

A line that starts with `look at:` names something that may be right and often is a mistake, e.g. a repair that keeps less than half of the broken program.

For the first repair above the check prints:

```
--- examples-02
    repaired: 164 code points on 7 lines. broken: 191 code points on 7 lines.
    first damage at 12. First error of the parser as it is at code point 13, line 1: the token "a" (a name), where the parser takes only `)`.
    148 scored code points from there on.
    what the alignment says the damage is:
      added at 12: "("
      added at 15 to 22: ": int) ("
      added at 25 to 37: ": int) : int "
      added at 48: "="
      added at 79 to 80: ";;"
      added at 99: ","
      missing before 100: ";"
      added at 103: ","
      missing before 104: ";"
      added at 124: "."
      missing before 125: " "
      added at 147 to 148: ";;"
      added at 165: "."
      missing before 166: " "
      code points 0 to 83
doc   let rec gcd a b =⏎  if b = 0 then a else gcd b (a mod b)⏎⏎let scores = [72; 85; 91]⏎
label kkkwkkkwdddwawawpwwwkkwnwowlwkkkkwnwkkkkwnnnwnwpnwnnnwnpwwkkkwddddddwpwpllpwllpwllpw
depth 111111111111111111112222222222222222222222222223333333333311111111111112222222222222
cont  llllllllllllllll====iiiiiiiiittttttteeeeeeeeeee(((((((((((lllllllllll==[[[[[[[[[[[[[

      code points 84 to 163
doc   let best = List fold_left max 0 scores⏎let () = Printf printf "best: %d\n" best⏎
label kkkwddddwpwnnnnwnnnnnnnnnwnnnwlwnnnnnnwkkkwppwpwnnnnnnwnnnnnnwsssssssssssswnnnnw
depth 11111111111111111111111111111111111111111112222222222222222222222222222222222222
cont  lllllllll==============================llll(((==================================

      code points 0 to 108
brok  let rec gcd (a : int) (b : int) : int =⏎  if b == 0 then a else gcd b (a mod b);;⏎⏎let scores = [72, 85, 91]⏎
bad                  !         !      !
align ............+..++++++++..+++++++++++++..........+..............................++..................+...+.....
want  kkkwkkkwdddw aw        aw             pwwwkkwnwo wlwkkkkwnwkkkkwnnnwnwpnwnnnwnp  wwkkkwddddddwpwpll wll wllpw
wantd 111111111111 11        11             1111222222 222222222222222222222333333333  331111111111111222 222 22222
wantc llllllllllll ll        ll             ====iiiiii iiittttttteeeeeeeeeee(((((((((  ((lllllllllll==[[[ [[[ [[[[[
now   kkkwkkkwdddwp
nowd  1111111111112
nowc  llllllllllll(
first             d^

      code points 109 to 190
brok  let best = List.fold_left max 0 scores;;⏎let () = Printf.printf "best: %d\n" best⏎
bad                  !                                        !
align ...............+......................++................+.........................
want  kkkwddddwpwnnnn nnnnnnnnnwnnnwlwnnnnnn  wkkkwppwpwnnnnnn nnnnnnwsssssssssssswnnnnw
wantd 111111111111111 1111111111111111111111  1111122222222222 2222222222222222222222222
wantc lllllllll====== ======================  =llll(((======== =========================
```

**The list under "what the alignment says the damage is" is the first thing to read.** It must hold what you meant to change and nothing else. Positions count the code points of the broken program from 0. `added` is text of the broken program that the repaired program leaves out, and `missing before 100` is text of the repaired program that the broken program lacks at that place.

The rows show one column per code point. A line feed is shown as `⏎`, a tab as `→`, a carriage return as `↵`, a no-break space as `⍽`, a byte order mark as `◊`, the escape character as `␛`, and a character that takes two columns as `◆`. A text is printed in blocks of up to 120 columns, and a block ends after a line feed where it can.

| Row | What it shows |
| --- | --- |
| `doc` | your repaired program |
| `label` | what each of its code points is shown as: `w` white space, `c` comment, `k` keyword, `n` name, `d` defined name, `a` parameter, `l` constant, `s` string, `o` operator, `p` punctuation |
| `depth` | the number of `(`, `[`, `let`, `if` and `fun` that are open at the code point, `0` to `9` and then `a` to `z` |
| `cont` | the innermost of `( [ let = in if then else fun ->` that is open at the code point: `(`, `[`, `l`, `=`, `n`, `i`, `t`, `e`, `f`, `>`, and `.` for none |
| `brok` | the broken program |
| `bad` | `!` under text that is no token of miniml: a character that the language does not have, a string that is not closed on its line, a comment that is not closed |
| `align` | `.` a code point that your repair keeps, `+` an added one |
| `want`, `wantd`, `wantc` | the three values that the code point takes from its counterpart in your repaired program. Blank under an added code point |
| `now`, `nowd`, `nowc` | what the highlighter shows today, which the check calls the parser as it is. It stops at its first error, so the rows end there |
| `early` | `x` under a kept code point before the first error that today's highlighter shows as another thing than the `want` rows say. No score counts these code points |
| `first` | `^` under the first code point of the token at which today's highlighter reports its first error, and `d` under the first damaged code point when that comes earlier |

A block leaves out the rows `depth`, `cont`, `wantd`, `wantc`, `nowd` and `nowc` when they would show depth 0 and no container for all of its code points, and the rows `bad`, `now`, `early` and `first` when they would be empty.

Read the `align` row against the `brok` row: every `+` is a code point that you say is no part of the program, and every `.` is one that you keep. Then read `want`: it is what your repair says about each code point of the broken program.

## What the tools do by a fixed rule

Five things that the tools do by themselves, so that nothing is wrong when you see them:

- **Of two equal code points of which one is added, the later one is.** E.g. of the two `=` of `b == 0` the second one is added, whichever you mark. And for a line that you mark as added with its indentation and its line end, the `align` row keeps the indentation before the line and marks the indentation of the next line. The same is done for a missing code point: of two closing brackets of which one is missing, the second one is. So two repairers who mean the same repair get the same labels.
- **What an added text and the missing text at its place share at their start and at their end is kept.** E.g. of `elif` for `else if`, the `el` is kept as the start of `else` and the `if` as `if`, whether you mark the whole word or write `el⟦missing⟧se ⟦/⟧if`.
- **The depth and the container follow the parser.** The parser closes a bracket, a `let`, an `if` or a `fun` when it reads the first token after it, and not before. So a closing bracket and the white space after it are still inside the bracket, as the `)` of `(a mod b)` at depth 3 above. And the last token of a definition and the white space after it are still inside its `let`.
- **Every kept code point has a label and is scored, also in a token that the broken program cuts in another way.** E.g. a string that lost its closing quote is one piece of text up to the end of its line for the scanner, and the `bad` row shows it. The kept code points of that line still have the labels of your repaired program: the string, and after it whatever follows.
- **A score counts the kept code points from the `^` on.** The parser as it is reads much of what an author of another language types as valid miniml, e.g. `match xs with` as an application of three names. So its first error can come later than the first damage, and the `early` row shows what it has wrong before that.
