# Held back: the tests of the TOML track

**Do not read this folder if you build the parser, the train data, the training or its machinery.** That holds for every file below this page, for the dumps of the sets outside the repo, and for a description of the sets in a report or a message. Stop here.

The TOML track of the transfer experiment (`lab/recovery-toml/`) asks whether the recipe that trained the JSON highlighter to recover works for another language with nothing tuned for it. The answer is only worth something when the test is broken TOML that nobody on the training side has seen: not its texts, not its labels, and not the list of the mistakes in it. A parser, a kind of train damage or a setting that was shaped by a look at this folder says nothing about broken TOML that nobody has seen.

## Who may read the folder

- The agents whose task is one of the held-back sets.
- The reviewer of the sets.
- Whoever runs the final scoring, after the recipe and its training are frozen.

Everyone else gets numbers through whoever runs the final scoring, and no texts.

## The rules

- No code outside `held-back/` imports from it. `bun lab/recovery-toml/held-back/specific/check.ts` reads every file of `lab/recovery-toml/` outside this folder and fails when one names the folder in an import.
- Code in this folder may import from the rest of `lab/recovery-toml/`, e.g. the tables, the reference labeler and the documents of the dataset.
- Everything about a set that lies outside the repo, e.g. a dump for reading, a draft, the output of a check or a script that prints cases, goes below the one folder `recovery-scratch/transfer/toml/held-back/`, e.g. `recovery-scratch/transfer/toml/held-back/held-back-specific/`, and nowhere else: the folder beside it belongs to the builders of the parser, the train data and the machinery, who read their neighbours' folders. A text file for reading starts with a line that says that the file is held back.
- A report or a message that describes a set, its cases or its numbers per kind of mistake starts with the same line, and is not passed to an agent that builds or trains.
- A set takes its valid documents from the test split of the dataset (`../splits.ts`) and from the two templates that are held out of training, `deployConfig` and `taskRunner`, so that no document of a set and no sequence of tokens of one is in a train or validation sample.

## The final scoring

The two sets are scored once, after the recipe and its training are frozen. Three parsers are scored, each in the same rows, and `parsers.ts` holds them for both sets:

- **The parser as it is.** Unlike the JSON parser as it is, it goes on after its first error and shows tokens by their kind, so it starts high: 69.3% of the scored code points and 9.5% of whole samples on the generator's set, 61.7% and 4.9% on the written set's cases with full agreement.
- **One rule without any training:** after an error, the parser as it is starts anew at the next line (`../learn/restart-at-next-line.ts`). It has 89.8% and 37.9% on the generator's set, and 84.2% and 29.6% on the written set. The JSON experiment had 35 hand-written rules to hold its trained tables against, and the TOML track has this one rule. It reads no trained table and nothing of this folder, so its rows were fixed before any training ran.
- **The tables of the recipe.** They are read **by what they add to the rule's rows, per kind of mistake and in whole samples**, and not by what they add to the parser as it is. E.g. with the rule, 11 of the generator's 36 kinds still have no whole sample, and one kind gets worse.

```sh
export RECOVERY_FINAL=yes     # only for the final scoring: tables with a changed cell are refused without it
bun lab/recovery-toml/held-back/specific/score.ts --tables <file.json>    # per kind, per group, and the held-out templates apart
bun lab/recovery-toml/held-back/written/score.ts --tables <file.json>     # full agreement, the two parts by the damage, unmarked, per writer's file
```

Without `--tables` both commands print the first two parsers and need no `RECOVERY_FINAL`. A file of tables is one that `../learn/` saved, e.g. `$RECOVERY_SCRATCH/recipe/seed-1.primary.tables.json`.

What a report of the final scoring holds, from the review of the foundation:

- **The generator's set per kind and per group**, before its number over the set: the weights of the kinds are a judgment and no measured frequencies. In 9 kinds the parser as it is already has 14% to 24% of the samples whole, so a trained parser can only lose there, and 137 samples are out of reach by their builder's judgment.
- **The rows of the two held-out templates apart.** Step 1 of the recipe makes classes for 15 capital letters, since a capital letter in a train document is mostly the content of a string or a comment. In the documents of the two held-out templates a capital letter is part of a key far more often. If their rows fall behind the others, look at keys with a capital letter first. Nothing was added to the train templates because of this: that would shape the train data by the test.
- **The written set with its rows "no repair marked as unsure" and per writer's file.** Both repairers followed `written/REPAIR.md`, so their agreement says that the rules are clear, and less that two readers took the meaning alike.
- **What neither set shows.** The generator has no plain slip of typing that the written set has, e.g. a quote inside a string without its backslash, two entries joined on one line, a closing bracket too many. The written set has no merge conflict, no template that was not rendered, no byte order mark and no HTML entity. The two sets label two places differently, without a scored conflict: the quotes around a pasted JSON key and the indentation inside an inline table on several lines have no label in the generator and a label in the written set.
- **The dataset's validation numbers have a ceiling below 100**, most of all in whole samples, see the first of the dataset's known limits in `../README.md`. The two sets here have labels from a meant document, so their ceiling is not that one.

## The sets

- `written/`: broken TOML that agents wrote from what broken TOML looks like in real use, each case with a repair by its writer and a second repair by an agent who saw only the broken payload. Its `README.md` says how a case gets its labels and how tables are scored on it.
- `specific/`: a generator of 36 kinds of mistakes that people make in TOML, e.g. a colon in the place of the equals sign or a string without its closing quote, applied to valid documents with an exact alignment. Its `README.md` lists the kinds and says for each whether a parser of the tables' form can show every code point right after it.
- `parsers.ts`: the parsers that both sets are scored with, see [The final scoring](#the-final-scoring).
