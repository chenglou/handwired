# The TOML track: did the recipe of the JSON experiment carry over?

**Held back: do not read this file if you build the parser, the train data, the training or its machinery.** It shows numbers and texts of the tests, see `held-back/README.md`.

## What was asked

The JSON highlighter is a table parser: for every code point, a cell of a table gives the next state. The experiment of `lab/recovery-parser/` trained the cells that valid JSON never reads, so that the highlighter recovers after an error and shows valid JSON exactly as before. Its recipe is a training, then a search that tries other choices cell by cell, then a count that picks the display kinds. This track asks **whether the same recipe, with no setting changed, does the same for TOML.** It ran on a TOML parser of the same form and was scored once, on two tests that nobody on the training side saw.

- A **payload** is one text that the highlighter gets: here a TOML document of at most 512 code points with a mistake in it, e.g. `port: 80` where TOML wants `port = 80`.
- A **row** is one parser that is scored, e.g. the parser as it is, or the tables that one way of training gives. The lead fixed the eight rows and the verdict's rule before any training on TOML.
- A **seed** is the number that a run takes its random order of payloads and cells from. Another seed gives other tables, so a trained row has five seeds (row 6 has three), and its number is the mean, with the lowest and the highest seed in brackets.
- **All three** is the share of the scored code points, i.e. those from a payload's first error on, with the display kind, the depth and the container right. **Whole** is the share of payloads with every scored code point right.
- **Neutral damage** knows nothing of TOML: ten edits on code points and lines, e.g. "delete a run of code points".

## The rows

| Row | Parser |
| --- | --- |
| 1 | The parser as it is |
| 2 | One rule without training: after an error, start anew at the next line |
| 3 | 39 recovery rules written by hand in the table form |
| 4 | The recipe trained on neutral damage, without its search: the primary row |
| 5 | Row 4 with the search, i.e. the whole recipe as it ran on JSON |
| 6 | The search and the count without training, on neutral damage |
| 7 | The recipe trained on the mixed set, without its search. Half of the set is neutral damage, half is 49 kinds of mistakes written for TOML by an agent who never saw the tests |
| 8 | Row 7 with the search: the whole recipe on damage written for the language, as on JSON |

## The result

The **generator** makes 36 kinds of typical mistakes: 3,000 payloads with 488,580 scored code points. The **written** set is 150 broken files that agents wrote, of which the 144 that two repairers labeled alike count: 20,303 scored code points. Both in all three / whole, in percent. The last column is all three on the dataset's test split, 12,536 payloads with neutral damage.

| Row | Generator | Written | Neutral damage |
| --- | --- | --- | --- |
| 1 | 69.29 / 9.5 | 61.72 / 4.9 | 62.31 |
| 2 | 89.81 / 37.9 | 84.25 / 29.6 | 91.72 |
| 3 | 98.67 / 81.7 | 93.97 / 60.6 | 94.76 |
| 4 | 86.63 (84.81 to 87.57) / 28.6 (25.0 to 31.9) | 81.84 (81.50 to 82.20) / 21.0 (19.0 to 23.2) | 89.28 |
| 5 | 92.90 (92.07 to 93.69) / 50.7 (49.3 to 52.1) | 89.08 (87.82 to 90.52) / 43.0 (40.1 to 46.5) | 96.31 |
| 6 | 93.80 (93.13 to 94.38) / 46.3 (42.5 to 50.9) | 89.83 (88.96 to 90.35) / 43.0 (40.8 to 44.4) | 95.52 |
| 7 | 90.37 (89.59 to 91.49) / 37.1 (31.6 to 40.6) | 83.85 (83.02 to 84.76) / 21.1 (18.3 to 24.6) | 88.74 |
| 8 | 98.34 (98.18 to 98.77) / 82.7 (80.2 to 85.3) | 92.74 (90.95 to 93.58) / 55.4 (52.1 to 56.3) | 95.94 |

## The verdict: failed

The lead's rule, in all three on the two held-back sets: "carried over with neutral damage alone" when row 4 with its lowest seed is above the rows 2 and 3 on both sets; "carried over with kinds written for the language" when row 7 is and row 4 is not; "partly" when a trained row is above row 2 but not row 3, or on one set only; "failed" when no trained row is above row 2. The final scoring read "a trained row" as row 4 or row 7, and wrote that down before its one run.

- **Row 4 is below the one rule with every seed on both sets,** by 10,935 to 24,424 code points on the generator and by 416 to 558 on the written set.
- **Row 7 is level with the rule in all three, and its lowest seed is below it on both sets:** 89.59 against 89.81, and 83.02 against 84.25. Its five seeds have +8,203, +1,729, +4,743, +7 and −1,046 code points against the rule on the generator, and +37, −85, +104, −249 and −211 on the written set.
- **Two other readings give "partly".** With the mean in the place of the lowest seed, row 7 is above the rule on the generator only. And the rows 4 and 7 are the recipe without its search: with it, the rows 5 and 8 are above the rule with every seed on both sets, and their lowest seeds are below row 3.

## Where the trained tables are above and below, and why

**The rows 4 and 7 are below the one rule in one place only: the headers after an error.** The generator's scored code points by where they stand, percent right:

| Part | Code points | Row 2 | Row 3 | Row 4 | Row 7 | Row 5 | Row 8 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The line of the first error | 23,028 | 42.36 | 95.02 | 72.36 | 88.18 | 74.37 | 93.52 |
| Later lines with a header, e.g. `[server.tls]` | 54,193 | 98.75 | 99.21 | 50.29 | 47.31 | 97.33 | 99.09 |
| Other later lines | 411,359 | 91.29 | 98.80 | 92.22 | 96.16 | 93.36 | 98.51 |

- **Against the rule,** row 4 has 10,735 right code points more outside later header lines and 26,261 fewer on them. Row 7 has 30,607 more and 27,880 fewer.
- **Why:** today's tables open a header only from the grammar state `lineStart`. Without the search, the trained tables are in that state at 38.8% (row 4) and 35.3% (row 7) of the later line starts at depth 0, so they read the `[` of a header as the start of an array (example 2). With the search the shares are 83.0% and 89.1%, and the hand-written rules have 93.2%.
- **The search repairs the headers.** In the mean of the seeds it makes 25,953 (row 4 to 5) and 28,096 (row 7 to 8) code points on later header lines right and 464 and 35 wrong. Elsewhere it makes 15,722 right and 10,555 wrong after training on neutral damage, and 12,237 and 1,334 after the mixed set.
- **Row 8 against the hand-written rules** has 1,597 right code points fewer on the generator and 32 whole payloads more. Both fail alike: in 518 and 550 payloads, of which half have at most 5 wrong code points. Row 8 is far above for an inline table on several lines (131 against 56 whole of 160) and far below for typographic quotes (46 against 97 of 103).

## Neutral damage alone, and what the kinds add

- **With the search, neutral damage alone (row 5) is above the one rule and far below the hand-written rules:** 3.1 and 4.8 points above row 2 on the two sets, 5.8 and 4.9 below row 3. On its own damage the order is the other way round: 96.31 against 94.76.
- **It misses other notations,** as on JSON, where neutral damage alone gave 82.8% of the scored code points on validation and damage written for JSON gave 98.0%. One to three neutral edits could make the damage of 1,335 of the generator's payloads: there row 5 has 97.66 and row 3 has 98.55. On the other 1,665, e.g. a colon after every key, row 5 has 89.73, row 3 has 98.75 and row 8 has 98.16.
- **In all three, the training adds nothing to the search alone:** row 6 is 0.90 and 0.75 points above row 5.
- **The kinds add 5.4 points on the generator and 3.7 on the written set with the search (row 8 over row 5), and 3.7 and 2.0 without it. They add nothing where no kind makes the mistake:** on the 15 such written cases, by one reader's judgment, row 8 has 75.94, row 5 has 76.09 and row 3 has 82.33.
- **Row 8 is above the one rule in all 36 kinds of the generator with every seed.** By the mean, row 5 is in 30, row 7 in 11, row 4 in 7.
- **One seed can get a whole kind wrong:** four seeds of row 8 have 148 to 150 of the 160 inline tables on several lines whole, and seed 5 has 58.

## Examples

Under each text stands the wanted display kind per code point, then what a row shows, with an `x` under a wrong code point: `w` white space, `p` punctuation, `s` string, `n` number, `k` key, `h` header name, `c` comment, `+` added by the mistake and not scored.

1. Training above the hand-written rules: a key that needs quotes. Row 3 has 13 of the payload's 48 scored code points right, and row 8 has 43 to 48.

```
text           tests/*.py = ["S101", "B011"]⏎
                    ^ the first error
wanted         kkkkkkkkkkwpwpsssssspwsssssspw
row 3          kkkkkpcccccccccccccccccccccccw
                    xxxxxxxxxxxxxxxxxxxxxxxx
row 8, seed 1  kkkkkssssswpwpsssssspwsssssspw
                    xxxxx
```

2. Without the search, a header after an error. After `"npm:prettier" = NULL`, every seed of the rows 4 and 7 has these 12 code points wrong and the other 57 right. The rows 2, 3, 5 and 8 have all 69.

```
text           [tasks.clean]⏎
wanted         phhhhhphhhhhpw
row 7, seed 1  phssssphsssspw
               xxxxxxxxxxxx
```

3. Neutral damage misses another notation: an entry below `server:`, as YAML writes a table. Row 5 has 19 to 37 of 40 right, and row 8 has 40 with every seed.

```
text             port: 3000⏎
wanted         ++kkkkpwnnnnw
row 5, seed 2  wwkkkkncnsssw
                     xx xxx
row 8, seed 2  wwkkkkpwnnnnw
```

## Limits

- **One language,** and a parser whose behavior after an error this track chose: it goes on, which makes the one rule strong.
- **One draw of the damage:** one seed of the dataset, and one agent's 49 kinds. 12 of the generator's 36 kinds have the same name among the 49, so the written set is the stricter test of row 8.
- **Agents wrote the tests.** The weights of the generator's kinds are a judgment, and the written set is small: one case is 0.7 points of whole.
- **The rows 2 and 3 are an agent's too.** The 39 rules took one session of about 75 minutes, with the 49 kinds in view, which the rows 4 to 6 never saw. So row 8 against row 3 is the like-for-like pair.

## What the recount and the analysis correct in the final report

- **"Row 7 is level with the rule" holds in all three only.** In whole payloads it is below the rule on the written set with every seed: 26 to 35 of 142 against 42.
- **"The test split gives every row what validation gave it"** holds for the rows 2, 3, 5, 6 and 8, within 0.3 points. The rows 1, 4 and 7 are 1.84, 1.42 and 1.07 lower.
- **"Little is lost on documents that no training saw"** does not hold for the rows 4 and 7. On the generator's documents of the two templates that the train data lacks, the rows 3, 5, 6 and 8 are 0.47 to 1.19 points lower than on its other documents, the rows 4 and 7 are 1.95 and 1.82 lower, and the rule 0.01. So on the 1,547 payloads of templates that the train data has, all five seeds of row 7 are above the rule, and on the other 1,453, one is.
- **The report gave the grammar state `error` as the reason for the lost headers.** The trained tables are in `error` at 22.5% (row 4) and 34.8% (row 7) of the later line starts, and in a state that is neither `error` nor `lineStart` at 38.8% and 29.9%.
- **Rounding:** in whole payloads on the generator, row 8 is 1.1 points above row 3 and row 5 is 4.5 above row 6, not 1.0 and 4.4.
- **11 of the 144 written cases have a document with the sequence of tokens of a train or validation document,** which `held-back/README.md` rules out. Without them the rows 2, 3, 4 and 7 have 84.16, 94.14, 82.05 and 84.09: no place changes.

## Files

- `held-back/final/`: the one final scoring with its report, and in `where/` the analysis per code point.
- `held-back/final-recount/`: the second count, in which none of 616,288 values differs.
- `held-back/results-check/`: the check of every number and example of this file.
