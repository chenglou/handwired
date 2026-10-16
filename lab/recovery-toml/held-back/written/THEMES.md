# The three themes

Three writers write about 50 cases each. Each writer has one theme, which is a cause of broken TOML, and writes into the two files that the theme names. The lists below say what a theme covers. They are a start and not a quota: add situations of your own that have the same cause, and leave out one that you cannot make realistic.

A theme is its cause and not its damage. The same damage can come from two causes, e.g. a value without quotes from a person who forgot them and from a program that printed the value as it was. It then belongs to the writer of the cause, with the file and the surroundings that this cause has.

## 1. `hand-edits`: a person edits a TOML file by hand

Files: `broken/hand-edits.txt` and `repairs/hand-edits.txt`. Ids: `hand-edits-01` and so on.

Slips of typing and of editing, in files that people really edit by hand, e.g. `Cargo.toml`, `pyproject.toml`, `netlify.toml`, `fly.toml`, `wrangler.toml`, `rustfmt.toml`, `.cargo/config.toml`, `starship.toml`, the `config.toml` of Hugo or of a GitLab runner, `book.toml`, a `Pipfile`, the settings of a game server or of a home tool.

- A quote, a bracket, an equals sign or a comma that is forgotten, typed twice or typed at the wrong place.
- A line that is half typed when the file is saved, e.g. a key without its value, or a header without its end.
- A deletion that left a part behind or took too much, e.g. the last value of an array with the comma before it left, or a line joined with the next one.
- A block that was moved or pasted to the wrong place, e.g. a key and its value inside an array, or a header in the middle of an inline table.
- A value that was changed and now needs quotes, e.g. a number that became a version with two dots or a size with a unit.
- A key or the name of a header that needs quotes and has none, e.g. one with a space, a slash or an `@`.
- A header that was edited by hand, e.g. `[[bin]`, `[tool.ruff.lint` or `[servers.alpha]]`.
- A string of several lines or a string in apostrophes whose start or end is damaged, and a path of Windows typed between quotes.
- What an editor did: a quote or a bracket that it closed by itself and the person closed again, a find-and-replace that also changed punctuation, the characters of a command that went into the text, e.g. `:wq`, and a block of comments of which only a part got its `#` removed.

## 2. `other-notations`: TOML written with the habits of another notation

Files: `broken/other-notations.txt` and `repairs/other-notations.txt`. Ids: `other-notations-01` and so on.

A person or a language model writes TOML and falls back on what another notation or a later version of TOML allows. The file is meant as TOML from the start, and the damage follows the other notation's rules, often at every place where the two differ.

- YAML: a colon after a key, a list with `- ` items, sections by indentation, `---`, `yes` and `no`.
- JSON: braces around the whole file, keys in quotes with colons, a comma at the end of every line, `null`, objects on several lines.
- INI, `.properties` and `.env`: `;` comments, values without quotes, `export NAME=value`, a section name with spaces, a key and a value without an equals sign.
- A programming language: `True`, `None`, `nil`, a tuple in round brackets, a string in backticks, strings joined with `+`, a number with a type at its end, e.g. `30u64` or `1.5f`.
- The config notations of other tools, e.g. a block with braces as in HCL or Nginx, or a semicolon at the end of a line.
- What TOML 1.1 allows and TOML 1.0 does not: an inline table on several lines, a comma before its `}`, a time without seconds, the escapes `\e` and `\xHH`.
- Numbers and dates in another form: `1,000`, `.5`, `5.`, `0755`, `10MB`, `30s`, `50%`, `2024/01/15`, `Jan 5 2024`.
- The comment signs of other languages: `//`, `/* … */`, `--`, `;`.

## 3. `programs-and-transport`: a program wrote, changed or carried the file

Files: `broken/programs-and-transport.txt` and `repairs/programs-and-transport.txt`. Ids: `programs-and-transport-01` and so on.

The author's document was right, or was meant right, and a program damaged it or wrapped it.

- A program that writes TOML by joining strings or from a template: a value printed without quotes, a quote or a backslash inside a value that is not escaped, a line feed inside a string of one line, the word that a language prints for no value in the place of a value, e.g. `None`, `undefined` or `<nil>`, a list printed in the language's own form, and a template that was not rendered, e.g. `{{ port }}`, `${HOME}`, `%s` or a line `{% if tls %}`.
- Merges and patches: the marker lines of a merge conflict with both sides, the marks of a diff before the lines, a patch of which only a part was applied.
- Copies from a web page, a PDF, a chat or a word processor: curly quotes, no-break spaces, a zero width space, a dash in the place of a hyphen outside a string, line numbers before the lines, a long line that was wrapped.
- Text around the document: the answer of a language model with sentences and a code fence, the `+++` lines of the front matter of a Markdown file with the text after them, the lines of a shell script around a here-document, a time stamp or the name of a service before every line of a log, the quotes and escapes of a string of a programming language that holds the document.
- Transport: two files joined without a line end between them, a line appended to a file that did not end with a line end, a byte order mark, carriage returns without line feeds, the color codes of a terminal, HTML entities such as `&quot;`, a file that was cut in the middle with other text after the cut.

## What to avoid

- **A case copied from a generator.** Write every case by hand from a situation that you can name in its `from:` line. Do not write or run a program that damages documents, do not apply one damage to many documents in turn, and do not read the damage of the train data or of the JSON experiment: nothing of `lab/recovery-toml/` outside this folder, and nothing of `lab/recovery-parser/`. A case that a generator could have made says nothing new.
- **Damage that leaves nothing to recover.** A score counts the code points from the parser's first error on. A payload that is only cut off at its end, a whole document with a sentence after it, or a slip on the last line has nothing there. A string of several lines that is never closed has nothing either: the parser reads the rest of the payload as the string. At most three cases of a file are of this sort. Put the damage where a good part of the document comes after it.
- **Cases that differ in names alone.** Two files of the same shape with the same damage at the same place are one case. When a sort of damage comes a second time, it comes in another sort of file, at another place, with other things around it. No sort of damage comes more than three times in a file, and a file has at least 25 sorts.
- **Damage that the parser does not see.** A key or a table that is defined twice, a month 13, or an integer that is too large is valid for the table parser, so such a payload is no case.
- **Damage that nobody can read.** When you cannot say which document the author meant, a second repairer cannot either. E.g. a file of which every second line is lost.
- **Several causes in one payload.** One cause can damage many places, e.g. every quote of a page that was copied from a word processor. Two causes that have nothing to do with each other do not meet in one payload.
- **The examples again.** The three cases of `examples/` and the snippets of `REPAIR.md` show the format. A case of the set is not one of them with other names.
