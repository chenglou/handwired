# Neutral damage: does the recipe need damage written with knowledge of JSON?

The trained tables of `../combined/` recover from broken JSON, and one place where knowledge of JSON went into them is the training damage: 55 kinds written by hand, e.g. single quotes and keys without quotes. This arm trains the same recipe on damage that knows nothing of the language and scores it on the validation split of the standard set, whose 55 kinds were then never written into the training damage. Nothing of the recipe is tuned.

**The answer: yes, for the notations that people write in place of JSON.** With neutral damage the recipe has 82.79 of all three, where it has 97.99 with the 55 kinds, the 35 hand-written rules 96.52 and the parser as it is 42.69. 70% of the loss is in the 518 samples with a string or a key without double quotes, a form that no neutral edit makes. Typing replays lose 0.74 points.

## The damage and the rows, all fixed before any score existed

**The damage** is ten edits on code points and lines, each with the same weight, e.g. delete one code point, copy a run of 2 to 20 code points, duplicate one line. A sample gets one to three edits, and its labels are the original's. `set.md` has the edits, the set of 40,457 samples and its check. The set has no typing replay: the dataset's hold knowledge of JSON.

**The recipe** is the one of the candidate "generic" of `../combined/`: the classes that a rule picks from the train samples, open display entries, the bit "first on its line", three passes of training, optionally 4 passes of a greedy search, the display entries by a count, and today's kinds in the grammar state `error`. Each step that reads damaged train samples reads the row's train set and nothing else (`recipe.ts`). Seeds 1 to 5, each once.

- **(a) neutral damage, without the search**: the primary row. **(b)** the same with the search.
- **Neutral damage without line edits**, without the search. The 7,888 samples with a deleted or a duplicated line hold most of the labels that a reader from the left cannot give, e.g. after the deleted line `"scripts": {` every depth is one off.
- **The standard train set, without the search**: the 55 kinds and the typing replays, from the trainings that `../combined/run.ts` saved. What (a) is compared with. **The same without the classes**, a new training: the rule picks no class from the neutral set and 11 from the standard one.

## What the arm shows

The validation split, the exact parser: 4,596 samples with something to recover, 675,949 scored code points. A number with brackets is the mean of the seeds with the lowest and the highest, and two ranges are "apart" when they do not overlap. A kind "alone" is its samples that have no other kind.

1. **(a) has 82.79 (80.41 to 84.59) of all three, and the same recipe on the standard train set 97.99 (97.83 to 98.13).** The ranges are apart, and seed by seed the difference is -14.99, -17.54, -13.41, -14.32, -15.76. (a) is also below the dataset's hand rule `lines`, 93.23, and below one plain pass of the trainer on the 55 kinds, 96.50.
2. **Most of the loss is in strings and keys without double quotes.** The 518 samples of the kinds `singleQuotedString`, `unquotedKey` and `curlyQuotes` hold 72,385 of the 102,759 code points that (a) loses per seed: there it has 36.52 (33.28 to 43.79) against 98.61. No neutral edit writes these forms. In the neutral set the apostrophe after a first error is never the start or the end of a string, where it is one of the two in 95.6% of its 60,906 places in the standard train set. 7 of 40,457 neutral samples hold a key that lost both quotes, where the standard train set has 2,663 samples of `unquotedKey`. Letters outside quotes come from a quote that an edit hit, e.g. `{"a": 1, b": 2}`, and that string goes on to the quote that is left. So the tables read a word without quotes on as a key or a string and miss the brackets after it, see the examples.
3. **On the other 4,078 samples (a) has 92.43 (90.17 to 93.28) against 97.86**, below the hand-written 96.50. What loses there, alone: text around the document, e.g. `statementWrapper` 85.1 against 100.0 and `logLines` 47.3 against 100.0, and small kinds that rewrite the whole text, e.g. `commaSeparatedRecords` 0.0 against 100.0 in 6 samples.
4. **Where (a) does not lose.** Typing replays: 96.23 (95.68 to 96.65) against 96.97 (96.70 to 97.19), though the neutral set has none. The group "out of reach": 85.6 against 84.8. Kinds near what an edit makes, alone: `trailingComma` 98.2 against 100.0 and `missingComma` 98.1 against 99.5. Above the standard row: `missingCloser` 84.5 against 69.7 and `openStringMidLine` 85.3 against 82.7. Whole samples are lower also where the code points are level, e.g. 80.87 against 87.45 in the typing replays.
5. **Neither the line edits nor the classes are the cause.** Without the line edits the row has 84.24 (83.11 to 86.78), above (a) in 5 of 5 seeds by 0.49 to 2.79 points, with ranges that overlap, and 13.75 below the standard row. The classes add 0.25 points to the standard row, in 5 of 5 seeds, and in the group "needs a character class" (a) has 47.4 where the standard row without the classes has 95.5.
6. **The search costs whole samples on damage that it was not run on.** (b) against (a): -0.84 points of all three (-2.15, +2.47, +0.48, -5.01, 0.00), with ranges that overlap, and -5.08 of whole samples, apart, in 5 of 5 seeds. On the standard train set the same search adds 0.31 and 3.08, each in 5 of 5 seeds.
7. **What the main number hides is as in `../combined/`.** No row of the arm shows a code point as past the end, and none has a wrong depth or a display kind other than today's on the 594,957 code points of valid JSON deeper than 16 levels. Without the last step, 3 of the 5 tables of (a) show such texts otherwise than today. (a) shows 16 (2 to 30) of the 54,162 added code points as an error, (b) 4 (0 to 10).

## The main rows

The last two columns: all three per source of the samples, as the mean.

| row | all three | within reach | whole samples | typing replays | damaged documents |
| --- | --- | --- | --- | --- | --- |
| the parser as it is | 42.69 | 47.44 | 11.92 | 57.21 | 40.32 |
| the dataset's hand rule `lines` | 93.23 | 98.27 | 77.48 | 94.87 | 92.97 |
| hand-written, 35 rules | 96.52 | 99.51 | 80.44 | 96.92 | 96.45 |
| the plain pass | 96.50 (95.88 to 96.74) | 99.11 (98.87 to 99.31) | 73.22 (72.76 to 73.54) | 97.03 | 96.42 |
| standard, with the search: the candidate "generic" | 98.30 (98.27 to 98.37) | 99.67 (99.61 to 99.74) | 83.61 (82.79 to 84.29) | 97.12 | 98.49 |
| standard, without the search | 97.99 (97.83 to 98.13) | 99.58 (99.44 to 99.63) | 80.54 (77.48 to 82.59) | 96.97 | 98.16 |
| standard, without the search and the classes | 97.74 (97.58 to 97.81) | 99.57 (99.46 to 99.67) | 79.19 (78.31 to 79.83) | 96.85 | 97.89 |
| (a) neutral, without the search | 82.79 (80.41 to 84.59) | 86.35 (83.52 to 87.75) | 61.83 (60.70 to 62.68) | 96.23 | 80.59 |
| (b) neutral, with the search | 81.94 (78.72 to 85.07) | 85.17 (81.18 to 88.10) | 56.75 (52.39 to 60.01) | 96.31 | 79.60 |
| neutral without line edits | 84.24 (83.11 to 86.78) | 87.81 (86.74 to 90.12) | 58.70 (53.83 to 65.60) | 96.24 | 82.28 |

## Three examples

Single quotes, a key without quotes, and a string left open in the middle of its line, where (a) has fewer wrong code points. Seed 1 of (a), "neutral", and of the standard row. The rows hold display kinds: `p` punctuation, `k` key, `s` string, `n` number, `l` literal, `w` white space, `?` not scored. Under a row, `k` or `d` marks a wrong kind or depth, `*` more than one wrong value, and `!` the first error.

```
text      {'name': [14], 'rate': 'up a', 'count': 218.78}
label     pkkkkkkpwpnnppwkkkkkkpwsssssspwkkkkkkkpwnnnnnnp
neutral   pkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk
           !     kk***kkk      kkkkkkkkkk       kkkkkkkk*
standard  pkkkkkspwpnnppwkkkkkkpwsssssspwkkkkkkkpwnnnnnnp
           !    k

text      {"name":"create_ticket",arguments:{"city":"Reykjavík","ids":[5,300],"filter":null}}
label     pkkkkkkpssssssssssssssspkkkkkkkkkppkkkkkkpssssssssssspkkkkkppnpnnnppkkkkkkkkpllllpp
neutral   pkkkkkkpssssssssssssssspkkkkkkkkkkkkkkkkkpssssssssssspkkkkkppnpnnnppkkkkkkkkpllllpp
                                  !        k*dddddddddddddddddddddddddddddddddddddddddddddd*
standard  pkkkkkkpssssssssssssssspkkkkkkkkkppkkkkkkpssssssssssspkkkkkppnpnnnppkkkkkkkkpllllpp
                                  !

text      {⏎  "name": "get_weather",⏎  "arguments": {"city": "Reyk"includeHourly": false}⏎}
label     pwwwkkkkkkpwssssssssssssspwwwkkkkkkkkkkkpwpkkkkkkpwsssss?kkkkkkkkkkkkkkpwlllllpwp
neutral   pwwwkkkkkkpwssssssssssssspwwwkkkkkkkkkkkpwpkkkkkkpwssssssskkkkkkkssssskpwlllllpwp
                                                                   k       kkkkk
standard  pwwwkkkkkkpwssssssssssssspwwwkkkkkkkkkkkpwpkkkkkkpwsssssspkkkpklpsssssnpwlllllpwp
                                                                   k   k kkkkkkkk
```

## What the numbers do not show

- **No number on unseen data**: the validation split only. The recipe's settings were chosen on this split with the 55 kinds as the train set, so the standard rows have that advantage.
- **Not a set that never holds a form of the 55 kinds**: by a rough rule 18.9% of the neutral samples are also a text of one of them, mostly a short span cut out.
- **Not what a few kinds would add to neutral damage**, e.g. single quotes alone, and not other weights of the edits or more samples: one set, nothing tuned.
- **Not what typing replays would add** (the standard train set holds 9,029), and not another language.

## Commands

With `RECOVERY_SCRATCH` set, in this folder: `bun neutral.ts` makes the set, `bun run.ts` trains every row (25 minutes, after the candidates of `../combined/`), `bun report.ts --examples 8 --widest 110` prints every table and the examples, and `bun check-recipe.ts` checks the runs (6 minutes).
