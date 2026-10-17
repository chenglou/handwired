# The three themes

Three writers write about 70 cases each. Each writer has one theme, which is a cause of broken programs, and writes into the two files that the theme names. The lists below say what a theme covers. They are a start and not a quota: add situations of your own that have the same cause, and leave out one that you cannot make realistic.

A theme is its cause and not its damage. The same damage can come from two causes, e.g. a `;;` after a definition from a person who knows OCaml and from a session of an interactive tool that was pasted into a file. It then belongs to the writer of the cause, with the program and the surroundings that this cause has.

Nobody writes miniml in real life. A case is realistic when it could happen if the language were in use: think of what people and tools do to OCaml, F#, Haskell and Elm code, and of what that looks like in a language with miniml's rules. The programs are what such a language would be used for, e.g. the exercises of a course, the helpers of a small tool, the rules of a game, a few definitions that work on lists and strings, a script with settings and one `let () = …` at its end.

## 1. `hand-edits`: a person edits a program by hand

Files: `broken/hand-edits.txt` and `repairs/hand-edits.txt`. Ids: `hand-edits-01` and so on.

Slips of typing and of editing by someone who knows miniml, in a program that was valid before.

- An `=`, an `in`, a `then`, an `->`, a bracket, a quote, a `;` or a `,` that is forgotten, typed twice or typed at the wrong place.
- A line that is half typed when the file is saved, e.g. a definition without its body yet, an `if` without its branches, an operator without its right side, a list that stops after a `;`.
- A deletion that left a part behind or took too much, e.g. an argument with one of its brackets left, the first half of a local definition, a line joined with the next one, the `(*` of a comment without its `*)`.
- A block that was moved or pasted to the wrong place, e.g. a definition in the middle of an expression, the `else` branch before the `then` branch, a line that stands twice.
- A change that is half done, e.g. a function that got a second parameter at its definition and a stray comma at its calls, a tuple that became a list with one separator left, a local definition that was pulled out to the top and kept its `in`.
- A keyword with a slip in it where a keyword has to stand, e.g. `lte` at the start of a definition or `fnu x -> …`, and a space inside a name or a number.
- What an editor did: a bracket or a quote that it closed by itself and the person closed again, a find-and-replace that also changed a keyword or a sign, the characters of a command that went into the text, e.g. `:w`, and a block of comments of which only a part got its comment signs removed.
- A slip with a string: a quote inside it that is not escaped, a backslash at its end, a string that goes on over a line end.

## 2. `other-languages`: miniml written with the habits of another language

Files: `broken/other-languages.txt` and `repairs/other-languages.txt`. Ids: `other-languages-01` and so on.

A person or a language model writes miniml and falls back on what another language allows. The program is meant as miniml from the start, and the damage follows the other language's rules, often at every place where the two differ. `lab/recovery-lr/LANGUAGE.md` lists what miniml does not have, under "What is not in the language".

- OCaml: `;;` after a definition, an `in` after a definition at the top, types after parameters and results, `match … with` and `function` with arms, `x.field`, `!counter` and `:=`, a `;` between two expressions, `begin … end` around a conditional, floats and `+.`, characters in apostrophes, a pattern after `let` or `fun`, `@` and `|>`, a comment inside a comment, a label before an argument.
- F#: a local definition without `in`, `|>` and `>>`, `elif`, `//` comments, `[1..10]` and `[| … |]`, a function of a tuple, e.g. `fun (a, b) -> …`.
- Haskell and Elm: a program that starts with a definition without `let`, a line with the type before a definition, `\x -> …`, `{- … -}` comments, `==` and `/=`, `++`, `$` and `.` between functions, `case … of`, guards with `|`, lists with commas.
- Standard ML, Scala, Rust, Swift and Kotlin: `fun f x = …` and `val x = …` at the start of a file, `fn x => …`, braces around a body, a `;` at the end of every line, `let x: Int = …`.
- Python, JavaScript and the C family: `def f(x):`, `return`, `!=`, `x => …`, calls with a comma between the arguments and no brackets around them, strings in apostrophes or backticks, `#` and `//` comments, a `,` or a `;` after the last item of a list.

Many habits of this sort leave a valid program, see "What to avoid": e.g. `let width = 80 -- columns` is 80 minus minus `columns` for miniml, and `printfn "%d" total` is an application. Keep the ones that the parser rejects.

## 3. `tools-and-transport`: a program wrote, changed or carried the text

Files: `broken/tools-and-transport.txt` and `repairs/tools-and-transport.txt`. Ids: `tools-and-transport-01` and so on.

The author's program was right, or was meant right, and a program damaged it or wrapped it.

- Merges and patches: the marker lines of a merge conflict with both sides, the signs of a diff before the lines, a patch of which only a part was applied, a line that a merge kept twice with a change between the two.
- Text around the program: the answer of a language model with sentences and a code fence, a session of an interactive tool with prompts and answers such as `val total : int = 25`, the message of a compiler with a line and a row of `^` between two lines of the program, the lines of a shell script around the program, a program inside a Markdown or HTML page with its tags.
- Copies from a web page, a PDF, a chat or a word processor: typographic quotes, no-break spaces, a zero width space, a dash or an arrow as one character in the place of `-` or `->`, line numbers before the lines, a long line that was wrapped inside a string or a comment, a ligature in the place of two signs, e.g. `≤` or `≠`.
- A program that writes miniml by joining strings or from a template: a value printed in another language's form, e.g. `None`, `3.0` or `['a', 'b']`, a quote or a backslash inside a string that is not escaped, a place that was not filled in, e.g. `{{ limit }}`, `${name}` or `%s`, a block of a template language around a definition.
- Transport: two files joined without a line end between them, HTML entities such as `&gt;` and `&quot;`, the quotes and escapes of a JSON string or of a string of another language that holds the program, the color codes of a terminal, a byte order mark, a file that was cut in the middle with other text after the cut.
- Tools that work on the text: a formatter that broke a line inside a string, a tool that put a marker or a `…` where it left lines out, a comment sign of another language that a tool put before some lines, a search and replace over many files that hit a keyword.

## What to avoid

- **A case made by damaging a program mechanically.** Write every case by hand from a situation that you can name in its `from:` line. Do not write or run a program that damages programs, do not take one program and remove, add or change one character after another, and do not apply one damage to many programs in turn. Do not read the damage of the train data or anything else of `lab/recovery-lr/` outside this folder but `LANGUAGE.md`, and nothing of `lab/recovery-parser/` or of the TOML track. A case that a generator could have made says nothing new.
- **Damage that leaves nothing to recover.** A score counts the kept code points from the parser's first error on. A program that is only cut off at its end, a whole program with a sentence after it, or a slip in the last definition has little or nothing there. A comment that is never closed has nothing either: the scanner reads the rest of the program as the comment. At most two cases of a file are of that last sort. Put the damage where a good part of the program comes after it: in most cases at least one whole definition follows the last damage.
- **Cases that differ in names alone.** Two programs of the same shape with the same damage at the same place are one case. When a sort of damage comes a second time, it comes in another sort of program, at another place, with other things around it. No sort of damage comes more than four times in a file, and a file has at least 30 sorts.
- **Damage that the parser does not see.** miniml accepts more than it seems to. Two expressions side by side are an application, so a missing operator, a missing `else`, a keyword with a slip in the middle of an expression (`esle`), and words such as `begin`, `end`, `and`, `mod`, `not`, `True` and `where` leave a valid program in most places. So does a definition without its `let` after another definition. The check names every broken program that the parser accepts: change the damage or drop the case.
- **Too much that miniml has no words for.** An expression with `match`, a loop or a record is added as a whole by rule 6 of `REPAIR.md`, and nothing in it is scored. At most eight cases of a file hold such an expression, and in each of them most of the program is kept.
- **Damage that nobody can read.** When you cannot say which program the author meant, a second repairer cannot either. E.g. a file of which every second line is lost.
- **Several causes in one program.** One cause can damage many places, e.g. every quote of a page that was copied from a word processor. Two causes that have nothing to do with each other do not meet in one program.
- **The examples again.** The three cases of `examples/` and the snippets of `REPAIR.md` and `LANGUAGE.md` show the format and the language. A case of the set is not one of them with other names.
