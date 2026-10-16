# Neutral damage: does the recipe need damage written with knowledge of JSON?

The trained tables of `../combined/` recover from broken JSON, and one place where knowledge of JSON went into them is the training damage: 55 kinds written by hand, e.g. single quotes and keys without quotes. This arm trains the same recipe on damage that knows nothing of the language and scores it on the validation split of the standard set, whose 55 kinds were then never written into the training damage. Nothing of the recipe is tuned here.

## The damage

Ten edits on code points and lines, each with the same weight: delete, insert, replace or swap one code point, delete, duplicate or copy a run of 2 to 20 code points, delete or duplicate one line, and cut the tail. A sample gets one edit with probability 0.6, two with 0.3 and three with 0.1, and a draw that is still valid JSON or leaves nothing to score is drawn again. The labels are the original's. The edits, their weights and the number of edits per sample were fixed before any score existed. `set.md` has the set, its check and its numbers: 40,457 samples from the originals of the standard train set, and no typing replay, since the dataset's typing replays hold knowledge of JSON.

## The rows, all fixed before any of them had a score

The recipe is the one of the candidate "generic" of `../combined/`: today's tables with the classes that a rule picks from the train samples, open display entries and the bit "first on its line", every open cell trained in three passes, optionally 4 passes of a greedy search, then the display entries set by a count, then today's kinds in the display entries of the grammar state `error`. Each step that reads damaged train samples reads the row's train set and nothing else: the rule, the training, the search and the count (`recipe.ts`). Seeds 1 to 5, each once.

- **(a) neutral damage, without the search.** The primary row.
- **(b) neutral damage, with the search.**
- **Neutral damage without line edits, without the search.** A review of the set found that the samples with a deleted or a duplicated line, 7,888 of 40,457, hold most of the labels that a reader from the left cannot give: the dataset's bound for the plain table parser is 62.3% of their scored code points and 95.2% of the others'. E.g. after the deleted line `"scripts": {` every depth is one off. This row leaves those samples out, so that a loss of (a) can be told apart: from these labels, or from the kinds that the damage lacks. Which samples are left out is a choice by edit and reads no JSON.
- **The standard train set, without the search**: the 55 kinds and the typing replays, from the trainings that `../combined/run.ts` saved. What (a) is compared with.
- **The standard train set, without the search and without the classes.** The rule picks no class from the neutral set and 11 from the standard train set, e.g. the apostrophe, so (a) has no added class. This row, a new training, says how much of the difference between the two rows above is the classes.

There is no row "neutral plus typing": that set was not built.

## Results

Not run yet.

## Commands

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/arms/neutral-damage/neutral.ts        # the set and its cache file
bun lab/recovery-parser/learn/arms/neutral-damage/run.ts            # every row, about 35 minutes
bun lab/recovery-parser/learn/arms/neutral-damage/check-recipe.ts   # about 7 minutes
```
