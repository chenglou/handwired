# What the final table has to show and say

**Held back.** This page is for whoever runs the one final scoring, and for the lead. It gathers what two reviews of the foundation asked of the final table, so that nothing of it has to be found again in the reviews. Each point says why in a sentence, and names the function or the command that gives it. The rows and what "carried over" means are the lead's decisions and are not repeated here.

## Columns, in every row and on every set

`../learn/columns.ts` reads them off a parser's output, so every row can have them. `columns.ts` in this folder prints them for the parser as it is on the three sets, and takes more rows.

| column | why | from |
| --- | --- | --- |
| all three near the damage | More than half of every score is code that the damage did not touch: a later definition at the top that stands whole in the broken text. Any recovery that finds the next `let` has it right. The column is "all three" over the other scored code points | `columnsOfOutputs`, `untouchedLaterDefinitions` |
| every token right | The samples in which every scored code point of a token that is no white space and no comment is right. White space after added text keeps the label of the stack before the reductions that the added token causes, which no table can show, so "whole" alone undercounts | `columnsOfOutputs` |
| all three inside open strings, and inside open comments | Inside a string that is left open, the labels want the kind string at 18% of the code points in train samples, at 39% in the generated mistakes and at 95% in the written cases. A table has one kind per token, set by the count on train samples. Counted apart, this loss shows as what it is | `columnsOfOutputs` |
| tokens skipped after 16 steps, and of them the ones whose steps were all at frozen cells | The 16 steps also count the grammar's own reductions. No token of a valid validation program needs more than 14, and a program of these sets may: a table then skips a token that the grammar takes, and the bars without a limit of steps do not. The count also explains the inserted tokens of a trained row: its tables skip a token by going in a circle of inserted and dropped definitions | `scoreTables(...).totals`, `describeTotals` of `../learn/score.ts`, for the rows that are tables |
| constituents without the ones before the first open cell | The pair over all constituents is mostly what every parser has before its first error: the parser as it is finds 42.6% of them over all and 1.0% without | `sharesOf(score).constituentsFoundAfter` and `constituentsRightAfter` |

How many of the scored code points each column is about, by `columns.ts` of this folder:

| set | scored code points | near the damage | inside open strings | inside open comments |
| --- | --- | --- | --- | --- |
| the 5,000 validation samples | 678,386 | 314,081 (46.3%) | 4,893 (0.7%) | 18,679 (2.8%) |
| the generated mistakes | 1,010,371 | 439,019 (43.5%) | 2,219 (0.2%) | 14,333 (1.4%) |
| the written cases with full agreement | 26,105 | 8,531 (32.7%) | 222 (0.9%) | 135 (0.5%) |
| all written cases over their agreed code points | 27,368 | 8,641 (31.6%) | 222 (0.8%) | 135 (0.5%) |

The review counted 55.8%, 57.6% and 68.9% of the scored code points in untouched definitions, where this table has 53.7%, 56.5% and 68.4%. The difference is one condition: here the `let` of such a definition has to be a token of its own in the broken text, so a definition inside a comment that the damage left open is not counted as untouched. `written/README.md` counts 71.4% for the written cases: its count takes in the definition whose `let` is the first error's token, where the parser's step is the recovery.

**On the written set, also give for each pair of rows the number of cases in which each row is ahead** (`samplesAhead`). One point of all three is about 260 code points there, which is two cases.

## Row 13, the search per sample

Two searches exist, and both give what the list of choices can at least do. On the generated mistakes with one kind, the search of `../learn/search/per-sample.ts` finds 77.2% of the samples whole and the search that was written for this set finds 88.8%, each with 64 runs kept, because the two keep other runs among level ones. The higher of the two per sample is also a run that the list allows. `search-per-sample.ts` in this folder makes the row that way for any list of samples (`bestOfBothSearches`), and prints each search alone beside it. **Say under the table which search made the row.** Before the foundation's review the search of `learn/` alone made it.

What each search finds, with 64 runs kept, all three and whole:

| set | the search of `learn/` | the search of this folder | the better of the two per sample |
| --- | --- | --- | --- |
| the first 1,000 validation samples | 94.38, 63.20 | 95.10, 69.60 | 95.23, 70.20 |
| the first 400 generated mistakes | 95.81, 69.50 | 97.13, 80.00 | 97.25, 83.50 |
| the written cases with full agreement | 96.61, 68.84 | 97.87, 82.41 | 97.87, 82.41 |
| all written cases over their agreed code points | 96.74, 70.00 | 97.94, 82.86 | 97.94, 82.86 |

The search of this folder has every token right in 73.7%, 89.0%, 86.4% and 86.7% of the samples of these four sets. The 400 generated samples took 47 s and the 1,000 validation samples 41 s, on 4 threads with other jobs running.

## What to say under the table

- **The bars were chosen with typical mistakes in view, and the recipe was not.** Rows 4, 5 and 6 were chosen on the train samples and on their authors' own broken programs: 32 mistakes for rows 4 and 5 (`../learn/bars/yacc/own-programs.ts`) and 98 pairs for row 6 (`../learn/bars/rules/broken.ts`). About 20 of the 41 kinds of the generated set are on the first list. The design allows a bar's author their own broken examples. Row 9 has seen no mistake of these kinds.
- **Row 4 comes in forms**, `yaccBarOf` of `../learn/bars/yacc/bar.ts`. Show the bar, and under it the bar without the rule for a missing local `let`, which is the bar as its author left it: the rule adds 1.4 points on validation and takes one mistake of the author's own list from 99 to 55. The safe reading of "above row 4" is above both. And the lead decides once whether `error` may count as a symbol that stands above its expression: with that reading the bar has 84.45 on validation, without it 79.91.
- **Row 5 has one detail more than its author gave it**, the textbook's "take an expression as there": 78.88 / 35.56 on validation, where it had 78.73 / 34.62.
- **Row 6's validation number is not of unseen data**: its author's tool printed the validation score of every variant. The held-back sets decide.
- **Row 7 moves by about a point within usual settings.** Its numbers (3 shifts, 15 tokens back) were written down before any data. With 30 tokens back and 5 shifts it has 86.55 / 50.54 on validation, where the bar has 85.51 / 49.42.
- **Row 9 is trained with the 48 exact stacks**, as the lead decided. A row that is trained with the twin of levels is reported apart, with the note that its form (`pusherBelow`) was picked after its validation score was seen.
- **Dropped tokens are counted finer in some rows.** Rows 3, 7 and 8 show a dropped token by one kind per terminal. Rows 4 and 5 and the tables read an entry per state on top and terminal.
- **"One output per token allows" is an upper bound and no more.** Frozen cells are followed after the first error too, e.g. a definition without `let` after the first one is read as arguments and a comparison, and after `let mut` the name is read as a parameter. Call the number an upper bound, and give "every token right" next to "whole".
- **"Whole" on the written set and on validation are not comparable**: rule 4 of `written/REPAIR.md` keeps the labels of white space showable, and the train data has no such rule.
- **The disputed code points of the written set stay unsettled.** The main number is of the 199 cases with full agreement, with all 210 over their agreed code points beside it. A correction now would be made by someone who has seen both repairs.

## Secrecy

- A commit that touches this folder gets a subject that names no content of a set, e.g. "held-back: fixes after the review", since every agent in the worktree sees the subjects with `git log`. The 11 earlier subjects name themes.
- The dumps of the two sets are below `recovery-scratch/transfer/lr/build/` (`held-back-specific/samples.txt`, `held-back-written/cases.txt` and `all-cases.txt`), no longer next to the train dump in `data/`.
- `../check-guard.ts` reads TypeScript files only. A reviewer's scan of every file found no line of a case or a template outside this folder.
