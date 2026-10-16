# Held back: the tests of the track on bison's LR table

**Do not read this folder if you build the tables, the train data, the recovery parser, the twins, the training or the bars.** That holds for every file below this page, for a dump of a set outside the repo, and for a description of a set in a report or a message. Stop here.

The track of the transfer experiment in `lab/recovery-lr/` asks whether the recipe that trained the JSON highlighter to recover carries over to a parser table that a tool made, with nothing tuned for the language. The answer is only worth something when the test is broken programs that nobody on the training side has seen: not their texts, not their labels, and not the list of the mistakes in them. A parser, a kind of train damage, a hand-written rule or a setting that was shaped by a look at this folder says nothing about broken programs that nobody has seen.

## Who may read the folder

- The agents whose task is one of the held-back sets: those who write its rules and tools, its writers and its repairers. A second repairer of the written set reads only what `written/REPAIR.md` names.
- The reviewers of the sets.
- Whoever runs the final scoring, after the recipe and its training are frozen.

Everyone else gets numbers through whoever runs the final scoring, and no texts. That includes the authors of the hand-written bars: a bar that was written with a look at the test is no bar.

## The rules

- No code outside `held-back/` imports from it or names it in a path. `bun lab/recovery-lr/check-guard.ts` reads every TypeScript file of `lab/recovery-lr/` outside this folder and fails when one does.
- Code in this folder may import from the rest of `lab/recovery-lr/`, e.g. the tables, the plain parser, the labels and `makeSample`.
- A dump of a set for reading goes to a folder outside the repo, e.g. below `recovery-scratch/transfer/lr/build/`, and its first line says that the file is held back.
- A command of this folder that anyone may run prints counts and no text of a case, e.g. `written/check-written.ts`. A command that prints cases says so at the top of its file, e.g. `written/check.ts`.
- The skeptic's probe of hand-written mistakes in `recovery-scratch/transfer/lr/skeptic/` is no part of this folder and no source for it. Nobody on the training side and no author of a bar may use the probe to choose anything.
- A commit that touches this folder gets a subject that names no content of a set, e.g. "held-back: fixes after the review": every agent in the worktree sees the subjects with `git log`.

## The sets

- `written/`: broken programs that agents wrote from situations in which a program gets broken, each with a repair by its writer and a second repair by an agent who saw only the broken program. Its `README.md` says how a case gets its labels and how other code reads the set.
- `specific/`: 6,000 broken programs that a generator makes from valid programs of its own, with one or two mistakes each of 41 kinds that people make in a language of this sort, e.g. a forgotten `in` or `;;` after a definition. Its `README.md` lists the kinds, says how a sample gets its labels and how other code reads the set, and says for every kind what a table can show.

A set that is added later gets a folder of its own here, with a `README.md`, and a line in this list.

## For the final scoring

- `FINAL-SCORING.md`: what the final table has to show and say, gathered from the two reviews of the foundation.
- `columns.ts`: the columns that the reviews asked for next to "all three" and "whole", on the three sets of the final table. It takes more rows.
- `search-per-sample.ts`: row 13, the search per sample, as the better of two searches per sample, for any list of samples.

```sh
bun lab/recovery-lr/held-back/columns.ts
bun lab/recovery-lr/held-back/search-per-sample.ts --set validation|specific|written [--count <samples>] [--width 64] [--without-end-early]
bunx tsc -p lab/recovery-lr/held-back && bunx oxlint --type-aware lab/recovery-lr/held-back
```
