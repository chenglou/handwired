# Neutral damage: does the recipe need damage written with knowledge of JSON?

The trained tables of `../combined/` recover from broken JSON, and one place where knowledge of JSON went into them is the training damage: 55 kinds written by hand, e.g. single quotes and keys without quotes. This arm trains the same recipe on damage that knows nothing of the language and scores it on the validation split of the standard set, whose 55 kinds were then never written into the training damage.

**The answer: yes, for the notations that people write in place of JSON.** With neutral damage the recipe has 82.79 of all three, where it has 97.99 with the 55 kinds, the 35 hand-written rules 96.52 and the parser as it is 42.69. 70% of the loss is in the 518 samples that hold a string or a key without double quotes, a form that no neutral edit makes. Typing replays lose 0.74 points.

## The damage and the rows, all fixed before any score existed

**The damage** is ten edits on code points and lines, each with the same weight, e.g. delete one code point, copy a run of 2 to 20 code points, duplicate one line. A sample gets one to three edits, and its labels are the original's. `set.md` has the edits, the set and its check. The set has no typing replay: the dataset's hold knowledge of JSON.

**The recipe** is the one of the candidate "generic" of `../combined/`: the classes that a rule picks from the train samples, open display entries, the bit "first on its line", three passes of training, optionally 4 passes of a greedy search, the display entries by a count, and today's kinds in the grammar state `error`. Each step that reads damaged train samples reads the row's train set and nothing else (`recipe.ts`). Seeds 1 to 5, each once, nothing tuned.

- **(a) neutral damage, without the search**: the primary row. **(b)** the same with the search.
- **Neutral damage without line edits**, without the search. The 7,888 samples with a deleted or a duplicated line hold most of the labels that a reader from the left cannot give, e.g. after the deleted line `"scripts": {` every depth is one off.
- **The standard train set, without the search**: the 55 kinds and the typing replays, from the trainings that `../combined/run.ts` saved. What (a) is compared with. **The same without the classes**, a new training: the rule picks no class from the neutral set and 11 from the standard one.

**The trainer does not get the same from each set.** It takes the samples with a scored code point, 32 per step: 40,457 neutral ones (3,795 steps, 5,204,180 scored code points), 37,381 standard ones (3,507 steps, 5,545,145) and 32,569 without line edits (3,054 steps, 4,230,837). So (a) has 8% more steps and 6% fewer scored code points than the standard row.

## What the arm shows

The validation split, the exact parser: 4,596 samples with something to recover, 675,949 scored code points. A number with brackets is the mean of the trainer's seeds with the lowest and the highest, and two ranges are "apart" when they do not overlap. A kind "alone" is its samples that have no other kind.

1. **(a) has 82.79 (80.41 to 84.59) of all three, and the same recipe on the standard train set 97.99 (97.83 to 98.13).** The ranges are apart, and seed by seed the difference is -14.99, -17.54, -13.41, -14.32, -15.76. (a) is also below the hand rule `lines` and below one plain pass of the trainer on the 55 kinds, see the table.
2. **Strings and keys without double quotes lose the most.** Alone, each of the three kinds has ranges apart: `singleQuotedString` 44.5 (40.7 to 46.3) against 98.1 (96.5 to 98.8), `unquotedKey` 44.5 (37.5 to 54.7) against 99.9, `curlyQuotes` 57.2 (54.8 to 59.6) against 98.9. The 518 samples that hold one of them hold 72,385 of the 102,759 code points that (a) loses per seed, 70%: there (a) has 36.52 (33.28 to 43.79) against 98.61. The 70% says where the loss is, not what it is from: 20% is in the 184 samples with only these kinds and 50% in the 334 that hold another kind too, e.g. a trailing comma. The three kinds were put together after the table per kind was read.
   - No neutral edit writes these forms. In the neutral set the apostrophe after a first error is never the start or the end of a string, where it is one of the two in 95.6% of its 60,906 places in the standard train set. 7 of 40,457 neutral samples hold a key that lost both quotes, where the standard train set has 2,663 samples of `unquotedKey`.
   - Letters outside quotes come from a quote that an edit hit, e.g. `{"a": 1, b": 2}`, and that string goes on to the quote that is left. So the tables read a word without quotes on as a key or a string and miss the brackets after it, see the example.
3. **On the other 4,078 samples (a) has 92.43 (90.17 to 93.28) against 97.86 (97.74 to 98.01)**, below the hand-written 96.50. What loses the most there, alone and apart, is text around the document: `statementWrapper` 85.1 (77.6 to 92.2) against 100.0 and `logLines` 47.3 (40.9 to 62.2) against 100.0.
4. **Where (a) loses little, is level, or is above.**
   - Loses little, in 5 of 5 seeds with ranges apart: typing replays 96.23 (95.68 to 96.65) against 96.97 (96.70 to 97.19), also below the hand-written 96.92; alone, `trailingComma` 98.2 (95.9 to 99.3) against 100.0 and `missingComma` 98.1 (97.6 to 98.7) against 99.5 (99.1 to 99.7). The neutral set has no typing replay, but 71.9% of the standard train set's typing texts are the original without one run of code points, which a deleted run or line makes too (`set.md`).
   - Level: the group "out of reach", 85.6 (84.0 to 87.1) against 84.8 (83.3 to 85.5), (a) above in 4 of 5 seeds.
   - Above, alone: `missingCloser` 84.5 (81.1 to 89.2) against 69.7 (65.0 to 71.4), apart, and `openStringMidLine` 85.3 (84.3 to 86.4) against 82.7 (80.1 to 84.9), in 5 of 5 seeds with ranges that overlap.
5. **Neither the line edits nor the classes are the cause.** Without the line edits the row has 84.24 (83.11 to 86.78), above (a) in 5 of 5 seeds by 0.49 to 2.79 points, with ranges that overlap, and 13.75 below the standard row. That row differs from (a) in two things: the line edits, and a fifth fewer samples and steps. The classes add 0.25 points to the standard row, in 5 of 5 seeds, and in the group "needs a character class" (a) has 47.4 where the standard row without the classes has 95.5.
6. **The search costs whole samples on damage that it was not run on.** (b) against (a): -0.84 points of all three (-2.15, +2.47, +0.48, -5.01, 0.00), with ranges that overlap, and -5.08 of whole samples, apart, in 5 of 5 seeds. On the standard train set the same search adds 0.31 and 3.08, each in 5 of 5 seeds.
7. **What the main number hides is as in `../combined/`.** No neutral or standard row shows a code point as past the end or shows valid JSON deeper than 16 levels otherwise than today. (a) shows 16 (2 to 30) of the 54,162 added code points as an error, (b) 4 (0 to 10).

## The main rows

| row | all three | within reach | whole samples | all three on typing replays, mean | all three on damaged documents, mean |
| --- | --- | --- | --- | --- | --- |
| the parser as it is | 42.69 | 47.44 | 11.92 | 57.21 | 40.32 |
| the dataset's hand rule `lines` | 93.23 | 98.27 | 77.48 | 94.87 | 92.97 |
| hand-written, 35 rules | 96.52 | 99.51 | 80.44 | 96.92 | 96.45 |
| the plain pass | 96.50 (95.88 to 96.74) | 99.11 (98.87 to 99.31) | 73.22 (72.76 to 73.54) | 97.03 | 96.42 |
| standard, with the search | 98.30 (98.27 to 98.37) | 99.67 (99.61 to 99.74) | 83.61 (82.79 to 84.29) | 97.12 | 98.49 |
| standard, without the search | 97.99 (97.83 to 98.13) | 99.58 (99.44 to 99.63) | 80.54 (77.48 to 82.59) | 96.97 | 98.16 |
| standard, without the search and the classes | 97.74 (97.58 to 97.81) | 99.57 (99.46 to 99.67) | 79.19 (78.31 to 79.83) | 96.85 | 97.89 |
| (a) neutral, without the search | 82.79 (80.41 to 84.59) | 86.35 (83.52 to 87.75) | 61.83 (60.70 to 62.68) | 96.23 | 80.59 |
| (b) neutral, with the search | 81.94 (78.72 to 85.07) | 85.17 (81.18 to 88.10) | 56.75 (52.39 to 60.01) | 96.31 | 79.60 |
| neutral without line edits | 84.24 (83.11 to 86.78) | 87.81 (86.74 to 90.12) | 58.70 (53.83 to 65.60) | 96.24 | 82.28 |

## An example

Single quotes: seed 1 of (a), "neutral", and of the standard row. `report.ts --examples 8` prints more, e.g. a key without quotes, and a string left open in the middle of its line, where (a) has fewer wrong code points. The rows hold display kinds: `p` punctuation, `k` key, `s` string, `n` number, `w` white space. Under a row, `k` marks a wrong kind, `*` more than one wrong value, and `!` the first error.

```
text      {'name': [14], 'rate': 'up a', 'count': 218.78}
label     pkkkkkkpwpnnppwkkkkkkpwsssssspwkkkkkkkpwnnnnnnp
neutral   pkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
           !     kk***kkk      kkkkkkkkkk       kkkkkkkk*
standard  pkkkkkspwpnnppwkkkkkkpwsssssspwkkkkkkkpwnnnnnnp
           !    k
```

## What the numbers do not show

- **No spread from drawing the damage again**: the five seeds of a neutral row are the trainer's, all on the one set of the neutral seed 20261016. Seed by seed, every neutral row is 11.21 points or more below the standard row.
- **No number on unseen data**: the recipe's settings were chosen on this validation split with the 55 kinds as the train set, so the standard rows have that advantage.
- **Not a set that never holds a form of the 55 kinds**: by a rough rule 18.9% of the neutral samples are also a text of one of them, mostly a short span cut out.
- **Not what a few kinds or typing replays would add to neutral damage**, e.g. single quotes alone, and not other weights of the edits, more samples or another language.

## Commands

With `RECOVERY_SCRATCH` set, in this folder: `bun neutral.ts` makes the set, `bun run.ts` trains every row (25 minutes, after the candidates of `../combined/`), `bun report.ts --examples 8 --widest 110` prints every table and examples, `bun check-recipe.ts` checks the runs (6 minutes).
