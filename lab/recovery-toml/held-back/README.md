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
- A dump of a set for reading goes to a folder outside the repo, e.g. `recovery-scratch/transfer/toml/held-back-specific/`, and its first line says that the file is held back.
- A set takes its valid documents from the test split of the dataset (`../splits.ts`) and from the two templates that are held out of training, `deployConfig` and `taskRunner`, so that no document of a set and no sequence of tokens of one is in a train or validation sample.

## The sets

- `written/`: broken TOML that agents wrote from what broken TOML looks like in real use, each case with a repair by its writer and a second repair by an agent who saw only the broken payload. Its `README.md` says how a case gets its labels and how tables are scored on it.
- `specific/`: a generator of 36 kinds of mistakes that people make in TOML, e.g. a colon in the place of the equals sign or a string without its closing quote, applied to valid documents with an exact alignment. Its `README.md` lists the kinds and says for each whether a parser of the tables' form can show every code point right after it.
