# Spare states: states that the parser does not have

The question of this arm, in the words of the person who asked for the experiment: beside filling holes, "see if things can learn new structures so to speak". Here the parser gets states that it does not have, with every cell open, and training may use them. Does the parser learn to remember something that today's states cannot hold?

Why a state can matter, from tables written by hand: the dataset's hand rule `lines` is the rule `words` with one more tokenizer state, and it has 99.6% of the group "needs a line rule" where `words` has 97.8%. And a second copy of the tokenizer's states, which remembers that a key without quotes has begun, lifted the samples with such keys that are right as a whole from 17% to 51% in the dataset's own measurement. The trainer knows neither.

Four words, besides the ones of `../../README.md`:

- A **spare state** is a tokenizer state or a grammar state that today's tables do not have. Today's tables have 26 tokenizer states and 8 grammar states, so the spare ones are numbered from 26 and from 8, e.g. "the tokenizer state 26". A spare tokenizer state has 33 cells, one per class, and a spare grammar state 88, one per token and context. All of them are open.
- A code point is **read in a state** when the parser is in the state before the code point. E.g. with tables that go into the state 26 at the `p` of `{port: 1}`, the letters `ort` and the colon are read in the state 26.
- A spare state is **sent** to a state of today's when every cell that leads into the spare state leads into that state instead, and nothing else changes. The spare state's own cells are then never read.
- A spare state is **folded** into a state of today's when it is sent there and that state's open cells take the spare state's choices, for the cells of the spare state that a train sample reads. The state of today's then does the spare state's job for every text that comes into it, also for the texts that came into it before. What the tables lose by the folding is what the spare state holds apart: something that this state of today's cannot hold next to its own job.

For both, the state of today's is the spare state's **stand-in**: the one of today's 26 tokenizer states, or 8 grammar states, with which the first 8,000 samples of the train split keep the most scored code points right.

**In short**, on the validation split, seeds 1 to 5, each setting run once:

- **Training uses spare tokenizer states, once their start has a random part.** Without it, 3 of the 4 spare states of a tuning run end as copies of another one, and no validation code point is read in a spare state. With it, 2.5% to 9.0% of the code points after a first error are read in a spare tokenizer state (plain pass, 1 to 16 spare states). They are read there in place of the states of numbers and literals, in which the control keeps the inside of a word without quotes.
- **The main number does not tell any setting from its control**, with either setting of the trainer. E.g. 4 spare tokenizer states have 96.83 (96.29 to 97.19) against 96.50 (95.88 to 96.74) with the plain pass, and 97.09 (96.93 to 97.22) against 96.88 (96.69 to 97.02) with 3 passes from a uniform start. The group "within reach of the tables" does not tell them apart either.
- **Two rows about words without quotes rise with 4 spare tokenizer states or more.** With the plain pass the kind `unquotedKey` gains 1.7 to 2.1 points and the group "needs a character class" 2.4 to 2.8, with ranges above the control's. With 3 passes from a uniform start and 2 to 8 spare tokenizer states the same two rows gain 0.4 to 1.8 points, and one of the six ranges is above the control's.
- **With every open cell trainable, the spare tokenizer states hold next to nothing that today's states cannot hold.** Taken out of the trained tables and folded into states of today's, they cost 0.02 to 0.15 points of all three, and the two rows keep their gain. So where spare states help, they help the training find better tables of today's layout. Today's tables have the room: `errorLine` has no frozen cell, and each of the ten states of a literal has one.
- **With every open cell trainable, spare grammar states are hardly used**: 0.4% to 1.1% of the code points with the plain pass, and no row moves.
- **Some states have a job that can be said in a sentence.** In the best seed, one spare state is the inside of a word without quotes, at 10.6% of the code points, one is the code point after a backslash inside a word, one has no job that I can name, and one is unused. Folded away, the four together cost 0.08 points.
- **Beside rules that a person wrote, spare states add 0.1 to 0.65 points to the hand-written tables and 0.6 to 1.1 points to the dataset's hand rule `words`.** Beside `words`, one spare tokenizer state finds the step that the state of `lines` adds: 99.1% of the group "needs a line rule", where `words` has 97.8% and `lines` 99.6%. Folded away, it costs 0.07 points. Beside the hand-written rules, 0.1 to 0.5 points do not move into a state of today's, and the spare grammar states hold them: e.g. one remembers that a new document began inside an unfinished one. This is the one place where spare states both add to the score and hold what they add.
- **A search uses spare states too, and gains nothing that its orders tell apart.** From the hand-written tables with 2 spare tokenizer states, the search of every open cell ends at 97.80 (97.78 to 97.83) in three orders, and at 97.73 (97.63 to 97.80) without spare states.
- **What the main number does not show**: beside a person's rules whole samples fall, by 0.6 to 2.4 points beside the hand-written tables and by 4.3 and 6.7 beside `words`, while all three rises. With every open cell trainable, spare states leave more code points shown as past the end, 92 to 1,655 on average against the control's 50. The depth of valid JSON that is too deep is wrong as often as in the controls, and beside the hand-written rules, which keep that depth, spare grammar states break it in some seeds.

## Setup

- **The base** is today's tables with spare states, from `addStates`: a spare tokenizer state starts as a copy of the state `errorLine`, a spare grammar state as a copy of the state `error`, and no cell leads into either. The display table has two kinds of columns: the one of the state `colon`, after which a string is shown as a key, and every other one, after which it is shown as a string. The spare grammar states take them in turn: the first is shown as `colon`, the second as `commaOrClose`, and so on. The display table itself stays fixed.
- **Every open cell is trainable**, the spare states' cells among them, and a cell of another state may lead into a spare one: 1,326 cells, and 33 more per spare tokenizer state and 88 more per spare grammar state.
- **The settings**: 1, 2, 4, 8 and 16 spare tokenizer states, 1, 2 and 4 spare grammar states, and 4 of the first with 2 of the second, with the plain pass. With 3 passes from a uniform start: 2, 4 and 8 spare tokenizer states, and 2 spare grammar states.
- **The control** of a setting is the same trainer's setting with the same seeds and no spare state. With no spare state and the plain pass, the arm's script gives the tables of `../plain-pass/` for each of the five seeds: the two files differ in their note and in nothing else.
- **Two settings of the trainer**, since the tuned one was still being worked out by another arm: the plain pass (1 pass, every mix starts with a share of 0.9 on the base's choice) and the setting that the arm `../holes/` chose (3 passes from a uniform start). The trainer's setting is one option of `run.ts`, `--trainer`, which also takes five values, so that a later run can put a tuned setting in.
- **A second kind of run starts from tables that a person wrote**, with spare states: the hand-written tables of `../../handwritten/`, and the dataset's hand rule `words`. There only the spare states' cells are trainable, and whether an open cell of another state leads into a spare state: such a cell keeps its event or its stack action, and its next state is the person's or a spare one. The control is the person's tables, which have no seed. The question there: does a spare state add something to rules that already recover? And for `words`: does training find what the state of `lines` does, which is known to help?
- The tables of a seed are the last ones of its run. The harness scores them in the exact parser on the validation split.

**What the arm is.** It may change every open cell, and its tables have more states than today's: up to 16 more tokenizer states and 4 more grammar states. They have today's classes, no bit, and today's display table with a copied column per spare grammar state. They are no tables of the dataset's plain table parser, since trained grammar cells hold stack actions that do something else than their token does. For the runs from the hand-written tables and from `words` no split of this dataset counts as unseen, see `../README.md`.

## The start of a spare state

Three things had to be solved before a run says anything about spare states.

**How a spare state gets a share at the start.** In the base no cell leads into a spare state. But a trainable cell holds a mix over every next state, the spare ones among them, so a part of every open cell's mix leads into each spare state from the first step on, and a part of the gradient reaches the spare state's own cells. With the plain pass's start, a cell gives 0.9 to the base's choice and splits the rest over the other states: with 4 spare tokenizer states, 1.4% of an open cell's mix leads into the 4 together. With a uniform start every state has the same share, 13.3% for the 4 together.

**How spare states come to differ.** Two spare states that start with the same weights get the same gradients and stay the same state. So `createSpareModel` adds a random number to every weight of a spare state's own cells, and to every weight with which a cell leads into a spare state: the size `noise` times a draw of the standard normal distribution, from the run's seed. With the size 1 and the plain pass's start, 2.3% of an open cell's mix leads into the 4 spare states on average, and 14% in the cell that has the most.

**The size was tuned** with 4 spare tokenizer states and the plain pass, on the seeds 11, 12 and 13. The table has all five sizes that were tried. "Sent" in the last column is defined above.

| noise | all three | within reach | whole samples | spare states that are a copy of another spare state, per seed | that a cell of another state leads into | that a train sample reads | own cells of the spare states that differ from the base, of all | validation code points read in a spare state, % | all three without the spare states, each sent to its stand-in |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 96.22 (95.99 to 96.42) | 98.85 (98.73 to 99.04) | 72.28 (70.91 to 73.59) | 3, 3, 3 | 1, 1, 0 | 0, 1, 0 | 96, 112, 104 of 132 | 0.00 (0.00 to 0.00) | 0.00 (0.00 to 0.00) |
| 0.3 | 96.22 (95.86 to 96.58) | 98.84 (98.70 to 98.98) | 72.36 (71.48 to 73.41) | 0, 0, 0 | 2, 4, 3 | 1, 4, 3 | 106, 115, 104 of 132 | 0.84 (0.02 to 2.21) | -0.10 (-0.17 to -0.01) |
| 1 | 96.54 (96.29 to 96.68) | 99.00 (98.89 to 99.20) | 72.95 (70.91 to 75.00) | 0, 0, 0 | 4, 4, 3 | 4, 4, 3 | 116, 118, 112 of 132 | 7.10 (6.23 to 7.73) | -0.98 (-1.24 to -0.71) |
| 2 | 96.58 (96.19 to 96.93) | 99.05 (98.79 to 99.24) | 73.88 (73.11 to 75.13) | 0, 0, 0 | 4, 4, 4 | 4, 4, 2 | 118, 122, 116 of 132 | 4.12 (3.43 to 5.26) | -0.51 (-0.59 to -0.41) |
| 3 | 96.34 (96.16 to 96.68) | 99.01 (98.50 to 99.33) | 72.57 (70.74 to 73.61) | 0, 0, 0 | 4, 4, 4 | 4, 4, 4 | 125, 129, 128 of 132 | 1.95 (0.85 to 3.12) | -0.29 (-0.45 to -0.18) |

One more run, with a single spare tokenizer state and no random part:

| noise | all three | within reach | whole samples | spare states that are a copy of another spare state, per seed | that a cell of another state leads into | that a train sample reads | own cells of the spare states that differ from the base, of all | validation code points read in a spare state, % | all three without the spare states, each sent to its stand-in |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 96.21 (95.99 to 96.55) | 98.86 (98.64 to 99.04) | 72.27 (71.02 to 73.59) | 0, 0, 0 | 0, 1, 1 | 0, 1, 1 | 25, 28, 24 of 33 | 0.00 (0.00 to 0.00) | +0.00 (0.00 to +0.01) |

- **Without the random part the spare states stay copies, and stay unused.** In all three seeds, 3 of the 4 spare states end as the same state as another spare state, cell by cell. A train sample reads one spare state in one seed and none in the two others, and no code point of the validation split is read in a spare state. A single spare state, which has no other spare state to be a copy of, is left unused too: 0.00% of the code points are read in it. So the random part does two things, and these runs do not tell them apart: it makes the spare states differ, and it gives some cells a larger share that leads into a spare state.
- **The scores do not tell the sizes apart**: every two of the five ranges of all three overlap.
- **The size 1 was taken**: the smallest of the five with which the train samples read 3 or 4 of the 4 spare states in every seed. A larger size moves the start away from the base: with the size 2 the snapped tables differ from the base in 59 to 72 cells before any training, with the size 3 in 196 to 209, and with the size 1 in none. So the size was chosen by whether the spare states get used, with the scores in view, and not by the score.
- One run with 3 passes from a uniform start and the size 1 was made on the same seeds, as a check that the spare states are used there too: 97.01 (96.89 to 97.07), no copy, and the train samples read 4, 3 and 4 of the 4 spare states.

**What the snapped tables do with a spare state that training left unused.** A spare state is unused when no cell that a text reads leads into it. Its own cells still hold what their weights ended at, and they differ from the base: the twin reads every cell that has a share, so training moves them. E.g. in the three runs without the random part, 96 to 112 of the 132 cells of the 4 spare states differ from the copies of `errorLine` that the states started as. No validation text reads any of them, so the tables parse those texts as the same tables without the states do. Two things follow: "cells changed against the base" counts these cells, 24 to 32 of the 33 cells of a spare tokenizer state whether a text reads the state or not, and a list of the cells of such tables shows choices that mean nothing. `withUnreadCellsOf` of `../../score.ts` puts the base's choice back into every cell that no text reads.

## Results

The validation split of the standard set, the exact parser: 5,021 broken samples, 425 of them with nothing to recover, 675,949 scored code points. Percentages, as the mean and in brackets the lowest and the highest of the seeds 1 to 5. Every setting was run once. `report.ts` prints every table of this section from the saved runs.

The columns of a table of scores: all three on all samples, in five of the dataset's six groups, and in the two kinds of damage in which tables written by hand gained from a state, keys without quotes (`unquotedKey`) and a document per line (`newlineDelimited`). Then whole samples, of all samples and of the ones with a key without quotes.

### Today's tables with spare states, the plain pass

| spare states | all | within reach | needs a line rule | needs a character class | needs a nesting fix | out of reach | unquotedKey | newlineDelimited | whole samples | whole samples, unquotedKey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none, the control | 96.50 (95.88 to 96.74) | 99.11 (98.87 to 99.31) | 99.66 (98.89 to 99.89) | 89.68 (88.86 to 90.46) | 89.39 (83.11 to 92.75) | 81.59 (76.88 to 83.61) | 95.22 (93.79 to 95.75) | 96.43 (91.99 to 97.59) | 73.22 (72.76 to 73.54) | 7.58 (5.86 to 9.38) |
| 1 tokenizer | 96.64 (96.19 to 96.87) | 99.23 (99.20 to 99.31) | 99.66 (98.87 to 99.88) | 90.01 (88.89 to 90.98) | 89.78 (83.12 to 92.50) | 81.67 (76.32 to 83.64) | 95.71 (95.42 to 96.33) | 96.35 (91.99 to 97.59) | 72.99 (72.32 to 73.85) | 7.34 (4.69 to 9.38) |
| 2 tokenizer | 96.49 (96.26 to 96.59) | 98.89 (98.45 to 99.27) | 99.64 (98.90 to 99.90) | 90.79 (89.69 to 93.18) | 89.49 (83.13 to 92.67) | 81.81 (76.00 to 83.79) | 95.89 (94.06 to 96.90) | 96.41 (91.99 to 97.59) | 73.56 (71.41 to 75.39) | 6.95 (1.95 to 10.55) |
| 4 tokenizer | 96.83 (96.29 to 97.19) | 99.19 (99.11 to 99.26) | 99.89 (99.87 to 99.92) | 92.05 (90.88 to 94.05) | 89.97 (83.12 to 92.66) | 81.29 (75.80 to 83.77) | 96.99 (96.53 to 98.21) | 97.54 (97.35 to 97.63) | 74.20 (72.37 to 77.05) | 9.92 (8.20 to 14.84) |
| 8 tokenizer | 96.75 (96.30 to 97.06) | 99.08 (98.98 to 99.22) | 99.70 (98.91 to 99.94) | 92.51 (91.68 to 93.36) | 89.84 (83.12 to 92.67) | 80.99 (75.69 to 83.13) | 97.35 (96.23 to 98.00) | 96.41 (91.99 to 97.59) | 74.86 (73.41 to 76.63) | 10.39 (8.20 to 13.67) |
| 16 tokenizer | 96.91 (96.51 to 97.09) | 99.12 (98.61 to 99.39) | 99.71 (98.89 to 99.94) | 92.09 (90.95 to 92.86) | 91.50 (89.34 to 92.68) | 82.83 (81.43 to 84.04) | 97.06 (96.47 to 97.44) | 96.46 (91.99 to 97.59) | 74.83 (72.95 to 75.61) | 11.09 (10.16 to 12.11) |
| 1 grammar | 96.38 (96.04 to 96.66) | 99.02 (98.74 to 99.23) | 99.81 (99.76 to 99.86) | 88.95 (87.42 to 90.13) | 90.43 (83.10 to 92.82) | 81.47 (77.31 to 83.01) | 94.97 (94.06 to 95.61) | 97.57 (97.51 to 97.63) | 73.14 (71.76 to 73.89) | 6.95 (5.86 to 8.59) |
| 2 grammar | 96.51 (96.09 to 96.76) | 99.04 (98.79 to 99.21) | 99.83 (99.77 to 99.88) | 90.10 (89.59 to 90.92) | 90.55 (83.40 to 92.81) | 81.34 (77.36 to 83.20) | 95.34 (94.66 to 96.02) | 97.46 (97.33 to 97.59) | 72.58 (70.69 to 74.13) | 7.19 (4.69 to 10.16) |
| 4 grammar | 96.45 (96.16 to 96.64) | 99.12 (98.96 to 99.28) | 99.62 (98.81 to 99.88) | 89.84 (89.26 to 90.39) | 88.48 (83.48 to 92.72) | 80.83 (77.06 to 83.44) | 95.46 (94.98 to 95.92) | 96.38 (92.36 to 97.57) | 72.75 (70.91 to 75.50) | 7.58 (6.25 to 9.77) |
| 4 tokenizer and 2 grammar | 96.76 (96.46 to 97.03) | 99.18 (98.97 to 99.28) | 99.88 (99.81 to 99.93) | 92.33 (90.91 to 94.01) | 88.50 (83.36 to 92.72) | 80.50 (76.57 to 83.70) | 96.88 (96.12 to 98.00) | 97.33 (96.61 to 97.59) | 74.14 (73.28 to 76.72) | 9.06 (6.64 to 11.72) |

Against the control: the difference of the two means in points, and whether the two ranges overlap. "overlap" means that these seeds do not tell the setting from the control, and "apart" that every seed of one is above every seed of the other.

| spare states | all | within reach | needs a line rule | needs a character class | needs a nesting fix | out of reach | unquotedKey | newlineDelimited | whole samples | whole samples, unquotedKey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 tokenizer | +0.14, overlap | +0.12, overlap | -0.00, overlap | +0.34, overlap | +0.39, overlap | +0.08, overlap | +0.50, overlap | -0.08, overlap | -0.23, overlap | -0.23, overlap |
| 2 tokenizer | -0.01, overlap | -0.22, overlap | -0.02, overlap | +1.11, overlap | +0.10, overlap | +0.22, overlap | +0.67, overlap | -0.02, overlap | +0.34, overlap | -0.62, overlap |
| 4 tokenizer | +0.33, overlap | +0.08, overlap | +0.23, overlap | +2.37, apart | +0.58, overlap | -0.30, overlap | +1.77, apart | +1.11, overlap | +0.98, overlap | +2.34, overlap |
| 8 tokenizer | +0.25, overlap | -0.03, overlap | +0.05, overlap | +2.83, apart | +0.44, overlap | -0.60, overlap | +2.13, apart | -0.02, overlap | +1.63, overlap | +2.81, overlap |
| 16 tokenizer | +0.41, overlap | +0.00, overlap | +0.05, overlap | +2.42, apart | +2.11, overlap | +1.24, overlap | +1.84, apart | +0.03, overlap | +1.61, overlap | +3.52, apart |
| 1 grammar | -0.12, overlap | -0.10, overlap | +0.15, overlap | -0.72, overlap | +1.04, overlap | -0.11, overlap | -0.25, overlap | +1.14, overlap | -0.09, overlap | -0.62, overlap |
| 2 grammar | +0.01, overlap | -0.08, overlap | +0.17, overlap | +0.42, overlap | +1.16, overlap | -0.24, overlap | +0.13, overlap | +1.03, overlap | -0.64, overlap | -0.39, overlap |
| 4 grammar | -0.05, overlap | +0.01, overlap | -0.04, overlap | +0.16, overlap | -0.91, overlap | -0.76, overlap | +0.24, overlap | -0.05, overlap | -0.48, overlap | +0.00, overlap |
| 4 tokenizer and 2 grammar | +0.26, overlap | +0.07, overlap | +0.22, overlap | +2.65, apart | -0.89, overlap | -1.09, overlap | +1.67, apart | +0.90, overlap | +0.91, overlap | +1.48, overlap |

- **The main number does not tell any setting from the control.** All nine ranges of all three overlap the control's, and so do all nine in the group "within reach of the tables". E.g. 4 spare tokenizer states have 96.83 (96.29 to 97.19) and the control 96.50 (95.88 to 96.74). The means of the five tokenizer settings differ from the control's by -0.01 to +0.41 points, and four of the five seeds with 16 spare states are above the control's best seed.
- **Two rows are above the control's range with 4 spare tokenizer states or more, and both are about words without quotes.** The kind `unquotedKey` has 96.99, 97.35, 97.06 and 96.88 with 4, 8 and 16 spare tokenizer states and with 4 and 2 spare grammar states, where the control has 95.22 (93.79 to 95.75): +1.7 to +2.1 points, ranges apart. The group "needs a character class", whose strings in single quotes the tables read as words, has 92.05 to 92.51 against 89.68 (88.86 to 90.46): +2.4 to +2.8 points, ranges apart. Of the 90 comparisons of the table, 9 are apart, and all 9 are these two rows and the whole samples with a key without quotes, in the four settings with 4 spare tokenizer states or more.
- **Whole samples with a key without quotes stay far from what a person's second copy of the states got**: 7.6% in the control, 9.1% to 11.1% with 4 spare tokenizer states or more, where the dataset measured 51% for the copy and 17% without it.
- **Spare grammar states change no row**: all 30 comparisons of the three settings with grammar states alone overlap.
- **The groups "needs a line rule", "needs a nesting fix" and "out of reach"** are not told from the control in any setting. The ranges of the group "needs a nesting fix" are wide, e.g. 83.11 to 92.75 in the control: it has 76 samples.

### Today's tables with spare states, 3 passes from a uniform start

| spare states | all | within reach | needs a line rule | needs a character class | needs a nesting fix | out of reach | unquotedKey | newlineDelimited | whole samples | whole samples, unquotedKey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none, the control | 96.88 (96.69 to 97.02) | 99.27 (99.15 to 99.36) | 99.08 (98.87 to 99.81) | 91.04 (88.76 to 92.20) | 89.58 (88.32 to 91.14) | 83.64 (82.89 to 84.07) | 96.07 (95.45 to 96.55) | 93.45 (91.99 to 97.40) | 73.46 (71.54 to 74.56) | 8.28 (6.25 to 9.38) |
| 2 tokenizer | 96.95 (96.91 to 96.97) | 99.30 (99.21 to 99.41) | 99.06 (98.86 to 99.76) | 91.71 (90.36 to 92.48) | 89.44 (88.33 to 91.11) | 83.41 (83.18 to 83.56) | 96.51 (96.27 to 96.67) | 93.36 (91.98 to 97.58) | 74.13 (72.63 to 75.04) | 8.44 (7.81 to 9.38) |
| 4 tokenizer | 97.09 (96.93 to 97.22) | 99.36 (99.21 to 99.46) | 98.90 (98.82 to 98.94) | 92.80 (92.35 to 93.23) | 89.35 (88.34 to 89.88) | 83.36 (83.07 to 83.80) | 96.88 (95.93 to 97.58) | 92.52 (91.99 to 92.65) | 75.34 (72.56 to 77.98) | 11.41 (5.86 to 16.02) |
| 8 tokenizer | 97.06 (96.79 to 97.17) | 99.30 (99.07 to 99.40) | 99.07 (98.86 to 99.84) | 92.35 (91.51 to 92.94) | 89.92 (89.52 to 91.31) | 83.75 (83.23 to 84.11) | 96.54 (96.00 to 97.18) | 93.63 (92.65 to 97.56) | 74.72 (74.39 to 75.48) | 9.06 (7.03 to 10.94) |
| 2 grammar | 97.00 (96.91 to 97.07) | 99.33 (99.28 to 99.37) | 99.06 (98.80 to 99.80) | 91.79 (90.31 to 92.43) | 89.23 (87.85 to 90.10) | 83.61 (83.21 to 84.03) | 96.48 (96.30 to 96.63) | 93.48 (92.60 to 96.85) | 73.18 (71.85 to 74.61) | 8.91 (7.42 to 12.11) |

| spare states | all | within reach | needs a line rule | needs a character class | needs a nesting fix | out of reach | unquotedKey | newlineDelimited | whole samples | whole samples, unquotedKey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 tokenizer | +0.07, overlap | +0.03, overlap | -0.02, overlap | +0.67, overlap | -0.14, overlap | -0.24, overlap | +0.43, overlap | -0.09, overlap | +0.67, overlap | +0.16, overlap |
| 4 tokenizer | +0.21, overlap | +0.09, overlap | -0.18, overlap | +1.76, apart | -0.23, overlap | -0.29, overlap | +0.81, overlap | -0.93, overlap | +1.88, overlap | +3.13, overlap |
| 8 tokenizer | +0.18, overlap | +0.03, overlap | -0.01, overlap | +1.31, overlap | +0.34, overlap | +0.10, overlap | +0.47, overlap | +0.18, overlap | +1.27, overlap | +0.78, overlap |
| 2 grammar | +0.12, overlap | +0.06, overlap | -0.02, overlap | +0.75, overlap | -0.35, overlap | -0.04, overlap | +0.41, overlap | +0.03, overlap | -0.27, overlap | +0.63, overlap |

- **The same picture with the other setting of the trainer.** No setting's range of all three is apart from the control's 96.88 (96.69 to 97.02): 2, 4 and 8 spare tokenizer states have 96.95, 97.09 and 97.06, and 2 spare grammar states 97.00 (96.91 to 97.07).
- **The group "needs a character class" is above the control's range with 4 spare tokenizer states**, 92.80 (92.35 to 93.23) against 91.04 (88.76 to 92.20), and above its mean by 0.7 to 1.8 points in all four settings. The kind `unquotedKey` is above the control's mean by 0.4 to 0.8 points in all four, with ranges that overlap. The two rows move the same way as with the plain pass, by less, and the setting with 2 spare grammar states moves them as much as the one with 2 spare tokenizer states: with this trainer's setting the rows do not single out the tokenizer states. This control is higher in both rows than the plain pass's, e.g. 96.07 against 95.22 in the kind `unquotedKey`.
- The settings with 1 and 16 spare tokenizer states, with 1 and 4 spare grammar states and with both kinds together were not run with this trainer's setting: a seed of it takes three times as long.

### What the parser does with the spare states

The code points are the ones of the broken validation samples from their first error on, 729,034 of them: no code point before a first error can be read in a spare state. The plain pass:

| spare states | spare states that a train sample reads | code points read in a spare tokenizer state, % | in a tokenizer state of today's other than `string` and `between`, % | in a spare grammar state, % |
| --- | --- | --- | --- | --- |
| none, the control | | 0.0 | 20.2 (20.0 to 20.3) | 0.0 |
| 1 tokenizer | 1 of 1 | 2.5 (0.0 to 5.2) | 17.8 (15.4 to 20.1) | 0.0 (0.0 to 0.0) |
| 2 tokenizer | 2 of 2 | 6.5 (3.6 to 9.3) | 13.9 (11.7 to 16.7) | 0.0 (0.0 to 0.0) |
| 4 tokenizer | 4 of 4 | 7.2 (3.8 to 11.9) | 13.2 (9.3 to 16.4) | 0.0 (0.0 to 0.0) |
| 8 tokenizer | 6 to 8 of 8 | 9.0 (4.0 to 11.9) | 11.9 (9.2 to 16.3) | 0.0 (0.0 to 0.0) |
| 16 tokenizer | 11 to 15 of 16 | 8.8 (7.2 to 10.1) | 12.2 (10.9 to 13.2) | 0.0 (0.0 to 0.0) |
| 1 grammar | 1 of 1 | 0.0 (0.0 to 0.0) | 20.2 (20.0 to 20.3) | 0.5 (0.0 to 2.5) |
| 2 grammar | 2 of 2 | 0.0 (0.0 to 0.0) | 20.1 (19.7 to 20.2) | 0.4 (0.0 to 2.0) |
| 4 grammar | 2 to 4 of 4 | 0.0 (0.0 to 0.0) | 20.5 (20.1 to 22.0) | 1.1 (0.0 to 2.4) |
| 4 tokenizer and 2 grammar | 6 of 6 | 7.5 (4.5 to 11.4) | 12.9 (9.7 to 15.7) | 0.2 (0.0 to 0.4) |

3 passes from a uniform start:

| spare states | spare states that a train sample reads | code points read in a spare tokenizer state, % | in a tokenizer state of today's other than `string` and `between`, % | in a spare grammar state, % |
| --- | --- | --- | --- | --- |
| none, the control | | 0.0 | 20.1 (20.0 to 20.2) | 0.0 |
| 2 tokenizer | 2 of 2 | 1.6 (0.1 to 4.6) | 18.8 (16.0 to 20.0) | 0.0 (0.0 to 0.0) |
| 4 tokenizer | 3 to 4 of 4 | 6.0 (0.2 to 10.4) | 14.8 (10.8 to 19.8) | 0.0 (0.0 to 0.0) |
| 8 tokenizer | 7 to 8 of 8 | 4.9 (0.7 to 8.2) | 15.6 (12.5 to 19.7) | 0.0 (0.0 to 0.0) |
| 2 grammar | 2 of 2 | 0.0 (0.0 to 0.0) | 20.4 (20.1 to 20.8) | 0.0 (0.0 to 0.0) |

- **Training uses the spare tokenizer states.** With the plain pass the train samples read every one of 1, 2 and 4 spare states, 6 to 8 of 8 and 11 to 15 of 16, and 2.5% to 9.0% of the code points are read in one.
- **They take over a job that today's states have in the control.** After a first error the control is in a tokenizer state other than `string` and `between` at 20.2% of the code points. E.g. its first seed is in `exponentDigits` at 4.9% of them, in `exponentSign` at 1.8% and in `zero` at 1.7%, where today's tables are in `errorLine` at 32.5%: the trained tables keep the inside of a word without quotes in states of numbers and literals. With 1, 2, 4, 8 and 16 spare tokenizer states that share falls to 17.8%, 13.9%, 13.2%, 11.9% and 12.2%, and the two shares together stay at 20% to 21%. The spare states are not read on top of today's, they are read in their place.
- **Why today's states can have that job.** A state of today's is tied to valid JSON only in its frozen cells. `errorLine` has none. Each of the ten states of a literal has one, the next letter of the literal, e.g. the `r` in the state `t`. `exponentSign`, `minus` and `dot` have two, a digit and a zero. A text can come into such a state after its first error by an open cell, and the state's open cells are then as free as a spare state's. Of the 858 tokenizer cells 710 are open, and of the 704 grammar cells 616.
- **Spare grammar states are hardly used**: 0.4% to 1.1% of the code points with the plain pass, and 0.0% in some seeds of every setting.
- **With 3 passes from a uniform start the spare tokenizer states are used less evenly**: 1.6%, 6.0% and 4.9% of the code points on average, and in one seed of each setting 0.1% to 0.7%. A uniform start gives a spare state the share of every other state from the first step on, and still some runs end almost without it.

### The same tables without their spare states

Per saved tables, the spare states are taken away one after the other, the one that the train samples read most first, and the tables are scored again: each spare state sent to its stand-in, each folded into its stand-in, or each cell that leads into one given the base's choice again, which is today's choice. The differences from the tables with the spare states are in points, per seed. The plain pass:

| spare states | sent: all three | within reach | whole samples | unquotedKey | folded: all three | within reach | whole samples | unquotedKey | sent to the base's choices: all three |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 tokenizer | -0.37 (-0.78 to -0.00) | -0.27 (-0.50 to +0.00) | -0.63 (-2.02 to +0.02) | -0.93 (-2.65 to -0.03) | -0.02 (-0.08 to +0.01) | -0.02 (-0.07 to +0.00) | -0.10 (-0.28 to +0.04) | -0.10 (-0.41 to +0.01) | -2.91 (-5.56 to -0.04) |
| 2 tokenizer | -0.78 (-1.39 to -0.32) | -0.38 (-0.54 to -0.10) | -1.79 (-3.18 to -0.24) | -2.32 (-4.05 to -1.09) | -0.05 (-0.11 to -0.00) | -0.02 (-0.05 to +0.01) | -0.15 (-0.50 to +0.02) | -0.05 (-0.23 to +0.11) | -6.30 (-7.84 to -4.51) |
| 4 tokenizer | -1.03 (-1.63 to -0.53) | -0.51 (-1.11 to -0.27) | -1.54 (-4.16 to +0.04) | -3.10 (-4.17 to -1.78) | -0.09 (-0.12 to -0.08) | -0.05 (-0.09 to -0.02) | -0.44 (-0.78 to -0.15) | -0.36 (-0.70 to -0.03) | -7.49 (-10.55 to -5.82) |
| 8 tokenizer | -1.56 (-2.34 to -0.59) | -0.91 (-1.44 to -0.40) | -3.87 (-6.29 to -1.94) | -4.75 (-7.46 to -0.88) | -0.04 (-0.13 to +0.01) | -0.04 (-0.10 to -0.01) | -0.87 (-1.54 to -0.28) | -0.20 (-0.56 to +0.01) | -8.84 (-11.22 to -6.17) |
| 16 tokenizer | -1.41 (-2.06 to -0.82) | -0.85 (-1.37 to -0.53) | -3.07 (-5.50 to -1.39) | -3.76 (-4.88 to -3.16) | -0.15 (-0.25 to -0.04) | -0.13 (-0.23 to -0.04) | -0.74 (-2.20 to +0.72) | -0.34 (-0.65 to -0.10) | -12.83 (-16.13 to -10.70) |
| 1 grammar | -0.10 (-0.36 to +0.00) | -0.05 (-0.21 to +0.01) | +0.05 (-0.04 to +0.20) | -0.05 (-0.13 to 0.00) | -0.17 (-0.76 to +0.04) | -0.10 (-0.29 to +0.01) | -1.14 (-5.79 to +0.24) | -0.06 (-0.27 to 0.00) | -0.61 (-2.51 to -0.00) |
| 2 grammar | -0.26 (-0.62 to +0.05) | +0.04 (+0.00 to +0.10) | +0.22 (-0.02 to +0.50) | -0.00 (-0.06 to +0.08) | -0.13 (-0.78 to +0.30) | -0.18 (-0.52 to +0.08) | -0.84 (-4.37 to +0.54) | -0.27 (-1.30 to +0.18) | -0.60 (-1.48 to -0.04) |
| 4 grammar | -0.33 (-0.67 to -0.13) | -0.05 (-0.34 to +0.06) | +0.76 (0.00 to +2.24) | -0.01 (-0.09 to +0.03) | -0.24 (-0.72 to +0.05) | -0.34 (-0.61 to -0.03) | -3.39 (-12.29 to +0.85) | -0.10 (-0.36 to +0.13) | -2.25 (-5.91 to -0.87) |
| 4 tokenizer and 2 grammar | -1.33 (-1.60 to -1.19) | -0.46 (-0.61 to -0.28) | -1.33 (-2.00 to -0.02) | -3.14 (-4.01 to -1.34) | -0.10 (-0.52 to +0.25) | -0.12 (-0.26 to +0.26) | -2.24 (-4.18 to -0.41) | -0.45 (-1.02 to +0.29) | -8.33 (-9.86 to -7.39) |

3 passes from a uniform start:

| spare states | sent: all three | within reach | whole samples | unquotedKey | folded: all three | within reach | whole samples | unquotedKey | sent to the base's choices: all three |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 tokenizer | -0.19 (-0.49 to +0.01) | -0.05 (-0.17 to +0.06) | -0.41 (-1.81 to +0.44) | -0.68 (-1.42 to -0.04) | -0.02 (-0.04 to -0.00) | -0.01 (-0.02 to +0.00) | -0.06 (-0.11 to 0.00) | -0.06 (-0.15 to +0.00) | -3.12 (-7.53 to -0.40) |
| 4 tokenizer | -0.62 (-1.15 to -0.03) | -0.21 (-0.47 to +0.05) | -2.15 (-4.57 to -0.04) | -2.15 (-4.11 to +0.34) | -0.02 (-0.04 to -0.01) | -0.02 (-0.03 to -0.01) | -0.27 (-0.41 to 0.00) | -0.01 (-0.18 to +0.06) | -5.60 (-8.81 to -0.51) |
| 8 tokenizer | -0.60 (-0.79 to -0.15) | -0.27 (-0.41 to -0.09) | -1.54 (-2.61 to -0.09) | -1.91 (-2.68 to -0.56) | -0.06 (-0.10 to -0.01) | -0.05 (-0.12 to -0.01) | -0.48 (-0.59 to -0.26) | -0.24 (-0.46 to -0.02) | -7.31 (-15.74 to -0.88) |
| 2 grammar | -0.65 (-0.94 to -0.02) | -0.07 (-0.14 to -0.02) | -0.13 (-0.22 to -0.09) | -0.04 (-0.19 to 0.00) | +0.00 (-0.02 to +0.02) | 0.00 (0.00 to 0.00) | 0.00 (0.00 to 0.00) | 0.00 (0.00 to 0.00) | -0.67 (-0.98 to -0.04) |

The folded tables are tables in which no text is ever in a spare state, so they parse every text as tables of today's layout would. Their scores against the control, with the difference of the two means and whether the two ranges overlap in brackets. The plain pass:

| spare states that were folded | all three | within reach | whole samples | needs a character class | unquotedKey |
| --- | --- | --- | --- | --- | --- |
| 1 tokenizer | 96.61 (96.11 to 96.84) (+0.11, overlap) | 99.21 (99.13 to 99.30) (+0.10, overlap) | 72.89 (72.24 to 73.69) (-0.34, overlap) | 89.87 (88.90 to 90.48) (+0.20, overlap) | 95.61 (95.24 to 96.33) (+0.40, overlap) |
| 2 tokenizer | 96.44 (96.15 to 96.57) (-0.06, overlap) | 98.87 (98.40 to 99.24) (-0.24, overlap) | 73.42 (71.41 to 74.89) (+0.19, overlap) | 90.43 (88.99 to 92.89) (+0.76, overlap) | 95.83 (94.17 to 96.88) (+0.61, overlap) |
| 4 tokenizer | 96.74 (96.17 to 97.11) (+0.24, overlap) | 99.14 (99.03 to 99.24) (+0.03, overlap) | 73.76 (71.58 to 76.78) (+0.54, overlap) | 91.59 (90.21 to 93.57) (+1.91, overlap) | 96.63 (95.89 to 98.18) (+1.41, apart) |
| 8 tokenizer | 96.71 (96.27 to 97.07) (+0.21, overlap) | 99.04 (98.92 to 99.19) (-0.07, overlap) | 73.99 (72.82 to 75.70) (+0.77, overlap) | 92.27 (91.57 to 92.72) (+2.60, apart) | 97.14 (96.12 to 97.57) (+1.93, apart) |
| 16 tokenizer | 96.76 (96.43 to 96.98) (+0.26, overlap) | 98.99 (98.56 to 99.25) (-0.13, overlap) | 74.09 (73.15 to 74.74) (+0.87, overlap) | 91.60 (90.86 to 92.27) (+1.92, apart) | 96.72 (96.11 to 97.10) (+1.50, apart) |
| 1 grammar | 96.20 (95.50 to 96.56) (-0.30, overlap) | 98.91 (98.45 to 99.17) (-0.20, overlap) | 71.99 (65.97 to 73.89) (-1.23, overlap) | 88.54 (87.14 to 90.12) (-1.14, overlap) | 94.91 (93.79 to 95.57) (-0.31, overlap) |
| 2 grammar | 96.38 (95.90 to 96.72) (-0.12, overlap) | 98.86 (98.36 to 99.29) (-0.26, overlap) | 71.74 (66.32 to 74.09) (-1.48, overlap) | 89.27 (88.64 to 90.13) (-0.40, overlap) | 95.08 (93.37 to 96.02) (-0.14, overlap) |
| 4 grammar | 96.21 (95.92 to 96.52) (-0.29, overlap) | 98.78 (98.50 to 99.25) (-0.33, overlap) | 69.36 (60.66 to 75.44) (-3.87, overlap) | 89.53 (89.16 to 90.04) (-0.15, overlap) | 95.36 (95.11 to 95.87) (+0.14, overlap) |
| 4 tokenizer and 2 grammar | 96.66 (96.05 to 97.17) (+0.16, overlap) | 99.06 (99.00 to 99.23) (-0.05, overlap) | 71.90 (69.26 to 76.31) (-1.33, overlap) | 91.55 (90.44 to 93.37) (+1.87, overlap) | 96.43 (95.96 to 96.98) (+1.22, apart) |

3 passes from a uniform start:

| spare states that were folded | all three | within reach | whole samples | needs a character class | unquotedKey |
| --- | --- | --- | --- | --- | --- |
| 2 tokenizer | 96.93 (96.91 to 96.95) (+0.05, overlap) | 99.29 (99.20 to 99.40) (+0.02, overlap) | 74.06 (72.61 to 74.98) (+0.61, overlap) | 91.57 (90.34 to 92.43) (+0.53, overlap) | 96.45 (96.27 to 96.54) (+0.37, overlap) |
| 4 tokenizer | 97.07 (96.91 to 97.18) (+0.19, overlap) | 99.35 (99.20 to 99.45) (+0.08, overlap) | 75.06 (72.17 to 77.98) (+1.61, overlap) | 92.66 (92.15 to 93.07) (+1.61, overlap) | 96.87 (95.95 to 97.62) (+0.80, overlap) |
| 8 tokenizer | 97.00 (96.69 to 97.13) (+0.12, overlap) | 99.25 (98.95 to 99.36) (-0.02, overlap) | 74.24 (73.91 to 74.89) (+0.79, overlap) | 92.08 (91.26 to 92.72) (+1.04, overlap) | 96.30 (95.61 to 97.04) (+0.23, overlap) |
| 2 grammar | 97.00 (96.91 to 97.09) (+0.12, overlap) | 99.33 (99.28 to 99.37) (+0.06, overlap) | 73.18 (71.85 to 74.61) (-0.27, overlap) | 91.84 (90.31 to 92.43) (+0.80, overlap) | 96.48 (96.30 to 96.63) (+0.41, overlap) |

- **Sent away, the spare tokenizer states cost 0.4 to 1.6 points of all three** with the plain pass, 0.6 to 3.9 points of whole samples and 0.9 to 4.8 points of the kind `unquotedKey`. So the trained tables need them: no state of today's takes a spare state's place as it is.
- **Folded, they cost 0.02 to 0.15 points of all three**, and 0.1 to 0.9 points of whole samples. So almost everything that a spare tokenizer state does, a state of today's can do with its open cells: the spare states hold next to nothing that today's states cannot hold. The accounts name the stand-ins, e.g. `errorLine` for the state that keeps the inside of a word.
- **The folded tables keep what the two rows gained.** With 4 spare tokenizer states or more folded away, the kind `unquotedKey` has 96.43 to 97.14, still above the control's range in all four settings, and the group "needs a character class" has 91.55 to 92.27, above it in two of the four. So where spare tokenizer states raise a row, they do it by what training finds, and tables of today's layout hold what it found. The control, trained on the same cells without them, does not find it.
- **Spare grammar states cost 0.1 to 0.3 points when they are sent away, and folding them can break whole samples**: with 4 spare grammar states, folding costs 3.4 points of whole samples on average and 12.3 in one seed. A grammar state of today's has fewer free cells than a tokenizer state: the stand-in's open cells have a job in the same tables, which the folding overwrites. For a grammar state the smaller of the two losses is the one to read, and the accounts give both.
- **Both ways are tries, not proofs.** A loss of nothing shows that today's states can hold the job. A loss shows that these two ways do not move the job, not that no tables of today's layout hold it.
- **With 3 passes from a uniform start the numbers are smaller and say the same**: sent away, the spare tokenizer states cost 0.2 to 0.6 points of all three, and folded 0.02 to 0.06. The 2 spare grammar states of that setting are read at less than 0.05% of the code points and still cost 0.65 points when they are sent away: a grammar state that a text is in for one token can decide the depth of everything after it. Folded, they cost 0.00 points.

### Spare states beside rules that a person wrote

Only the spare states' cells are trainable, and whether an open cell of another state leads into one. The plain pass. The control is the person's tables.

Beside the 35 hand-written rules:

| spare states | all | within reach | needs a line rule | needs a character class | needs a nesting fix | out of reach | unquotedKey | newlineDelimited | whole samples | whole samples, unquotedKey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none, the control | 96.52 | 99.51 | 98.98 | 92.24 | 76.07 | 78.04 | 98.05 | 91.98 | 80.44 | 17.19 |
| 2 tokenizer | 96.62 (96.50 to 96.68) | 99.53 (99.44 to 99.60) | 98.94 (98.90 to 98.98) | 93.04 (92.83 to 93.46) | 76.07 (76.06 to 76.07) | 78.11 (77.79 to 78.32) | 98.15 (98.10 to 98.23) | 91.91 (91.78 to 91.98) | 79.89 (78.44 to 80.29) | 17.03 (16.41 to 17.19) |
| 4 tokenizer | 96.69 (96.65 to 96.73) | 99.56 (99.52 to 99.61) | 99.05 (98.91 to 99.42) | 93.06 (92.58 to 93.47) | 76.07 (76.06 to 76.07) | 78.51 (78.02 to 78.80) | 98.11 (97.89 to 98.21) | 92.41 (91.87 to 93.95) | 79.85 (78.87 to 80.13) | 16.41 (15.23 to 17.19) |
| 2 grammar | 96.76 (96.55 to 96.84) | 99.36 (99.19 to 99.44) | 99.71 (98.82 to 99.94) | 91.12 (89.20 to 93.07) | 84.43 (83.55 to 85.08) | 81.38 (81.05 to 81.73) | 97.95 (97.56 to 98.06) | 96.94 (96.80 to 96.97) | 79.48 (76.22 to 80.35) | 17.11 (16.80 to 17.19) |
| 4 tokenizer and 2 grammar | 96.93 (96.81 to 97.01) | 99.46 (99.24 to 99.55) | 99.51 (97.89 to 99.93) | 92.46 (91.86 to 93.45) | 82.31 (80.01 to 84.20) | 81.36 (81.13 to 81.79) | 97.75 (97.06 to 98.22) | 95.98 (91.98 to 96.97) | 78.02 (76.26 to 80.42) | 14.53 (10.16 to 17.19) |

| spare states | all | within reach | needs a line rule | needs a character class | needs a nesting fix | out of reach | unquotedKey | newlineDelimited | whole samples | whole samples, unquotedKey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 tokenizer | +0.10, overlap | +0.02, overlap | -0.04, overlap | +0.80, apart | -0.00, overlap | +0.07, overlap | +0.10, apart | -0.08, overlap | -0.55, apart | -0.16, overlap |
| 4 tokenizer | +0.17, apart | +0.06, apart | +0.07, overlap | +0.82, apart | -0.00, overlap | +0.47, overlap | +0.06, overlap | +0.42, overlap | -0.59, apart | -0.78, overlap |
| 2 grammar | +0.25, apart | -0.15, apart | +0.73, overlap | -1.12, overlap | +8.36, apart | +3.34, apart | -0.10, overlap | +4.95, apart | -0.96, apart | -0.08, overlap |
| 4 tokenizer and 2 grammar | +0.41, apart | -0.04, overlap | +0.54, overlap | +0.23, overlap | +6.24, apart | +3.31, apart | -0.30, overlap | +3.99, overlap | -2.42, apart | -2.66, overlap |

The same tables without their spare states, as above. "Sent to the base's choices" gives the hand-written tables back, up to the cells that no text reads.

| spare states | sent: all three | within reach | whole samples | unquotedKey | folded: all three | within reach | whole samples | unquotedKey | sent to the base's choices: all three |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2 tokenizer | +0.02 (-0.07 to +0.11) | -0.00 (-0.11 to +0.07) | +0.41 (-0.11 to +1.83) | +0.09 (+0.04 to +0.15) | -0.02 (-0.16 to +0.04) | -0.00 (-0.05 to +0.04) | -0.50 (-3.48 to +0.94) | +0.01 (-0.03 to +0.09) | -0.10 (-0.16 to +0.01) |
| 4 tokenizer | -0.04 (-0.10 to +0.04) | +0.01 (-0.04 to +0.07) | +0.46 (+0.02 to +1.48) | +0.10 (-0.06 to +0.35) | -0.01 (-0.05 to +0.05) | -0.01 (-0.07 to +0.02) | -0.23 (-0.54 to +0.04) | -0.01 (-0.08 to +0.06) | -0.17 (-0.21 to -0.13) |
| 2 grammar | -0.09 (-0.19 to +0.21) | +0.16 (+0.08 to +0.32) | +1.00 (+0.15 to +4.29) | +0.11 (-0.01 to +0.49) | -0.12 (-0.41 to +0.16) | -0.17 (-0.40 to +0.04) | -0.16 (-0.39 to +0.11) | -0.22 (-0.69 to +0.00) | -0.25 (-0.32 to -0.03) |
| 4 tokenizer and 2 grammar | -0.16 (-0.25 to -0.00) | +0.09 (+0.01 to +0.31) | +2.08 (-0.07 to +3.61) | +0.42 (+0.01 to +1.05) | -0.33 (-0.52 to -0.18) | -0.12 (-0.52 to +0.09) | -0.34 (-0.65 to +0.24) | -0.53 (-1.29 to 0.00) | -0.41 (-0.50 to -0.29) |

With 3 passes from a uniform start, 4 spare tokenizer states and 2 spare grammar states, the one setting that was run with this trainer's setting beside the hand-written rules:

| spare states | all | within reach | needs a line rule | needs a character class | needs a nesting fix | out of reach | unquotedKey | newlineDelimited | whole samples | whole samples, unquotedKey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none, the control | 96.52 | 99.51 | 98.98 | 92.24 | 76.07 | 78.04 | 98.05 | 91.98 | 80.44 | 17.19 |
| 4 tokenizer and 2 grammar | 97.16 (97.05 to 97.33) | 99.51 (99.35 to 99.60) | 99.94 (99.92 to 99.95) | 92.95 (91.89 to 93.78) | 85.23 (80.94 to 88.33) | 82.21 (81.43 to 83.34) | 98.11 (97.95 to 98.22) | 96.78 (96.15 to 96.97) | 79.23 (77.44 to 80.31) | 15.47 (11.33 to 17.58) |

| spare states | sent: all three | within reach | whole samples | unquotedKey | folded: all three | within reach | whole samples | unquotedKey | sent to the base's choices: all three |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4 tokenizer and 2 grammar | -0.50 (-0.68 to -0.38) | -0.01 (-0.05 to +0.09) | +0.30 (-0.04 to +1.07) | -0.06 (-0.38 to +0.12) | -0.58 (-0.87 to -0.18) | -0.23 (-0.40 to -0.02) | -3.17 (-9.23 to +0.15) | -0.93 (-1.47 to -0.11) | -0.65 (-0.81 to -0.54) |

Beside the dataset's hand rule `words`. The dataset's hand rule `lines`, which is `words` with one more tokenizer state, has 93.23 of all three, 99.62 in the group "needs a line rule", 93.44 of `newlineDelimited` and 77.48 of whole samples.

| spare states | all | within reach | needs a line rule | needs a character class | needs a nesting fix | out of reach | unquotedKey | newlineDelimited | whole samples | whole samples, unquotedKey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none, the control | 93.09 | 98.32 | 97.84 | 85.72 | 42.70 | 62.44 | 92.65 | 85.75 | 77.31 | 16.41 |
| 1 tokenizer | 93.68 (93.64 to 93.71) | 98.95 (98.85 to 99.01) | 99.14 (98.82 to 99.45) | 86.12 (85.60 to 86.64) | 42.69 (42.67 to 42.75) | 62.11 (61.96 to 62.35) | 93.20 (92.73 to 93.41) | 93.55 (93.24 to 94.49) | 70.58 (67.41 to 75.59) | 13.67 (11.33 to 15.63) |
| 2 tokenizer | 94.22 (94.02 to 94.39) | 99.13 (99.01 to 99.21) | 99.23 (98.96 to 99.58) | 88.13 (87.46 to 88.80) | 42.74 (42.64 to 42.77) | 64.36 (63.82 to 65.07) | 94.52 (93.11 to 95.38) | 93.55 (93.25 to 94.45) | 73.06 (68.02 to 76.48) | 14.61 (11.33 to 16.41) |

| spare states | all | within reach | needs a line rule | needs a character class | needs a nesting fix | out of reach | unquotedKey | newlineDelimited | whole samples | whole samples, unquotedKey |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 tokenizer | +0.59, apart | +0.64, apart | +1.30, apart | +0.41, overlap | -0.01, overlap | -0.33, apart | +0.55, apart | +7.80, apart | -6.72, apart | -2.73, apart |
| 2 tokenizer | +1.13, apart | +0.81, apart | +1.40, apart | +2.42, apart | +0.04, overlap | +1.92, apart | +1.87, apart | +7.80, apart | -4.25, apart | -1.80, overlap |

| spare states | sent: all three | within reach | whole samples | unquotedKey | folded: all three | within reach | whole samples | unquotedKey | sent to the base's choices: all three |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 tokenizer | +0.13 (+0.00 to +0.22) | -0.28 (-0.39 to -0.22) | +6.86 (+2.07 to +10.07) | -0.36 (-0.87 to +0.21) | -0.07 (-0.17 to -0.00) | -0.08 (-0.20 to +0.04) | -0.03 (-0.20 to +0.28) | -0.00 (-0.14 to +0.18) | -0.59 (-0.62 to -0.55) |
| 2 tokenizer | -0.32 (-0.40 to -0.22) | -0.45 (-0.58 to -0.38) | +4.31 (+0.44 to +9.20) | -1.25 (-2.22 to -0.25) | -0.01 (-0.03 to -0.00) | -0.01 (-0.03 to +0.01) | -0.11 (-0.28 to +0.07) | +0.08 (+0.04 to +0.15) | -1.13 (-1.30 to -0.93) |

- **Beside the hand-written rules, spare states add 0.1 to 0.4 points of all three with the plain pass, and 0.65 with 3 passes from a uniform start.** Every seed of 4 spare tokenizer states, of 2 spare grammar states and of both together is above the hand-written 96.52: with both, 96.93 (96.81 to 97.01) with the plain pass and 97.16 (97.05 to 97.33) with 3 passes. The search from the hand-written tables, which may change every open cell and has no spare state, has 97.75.
- **The grammar states add where the rules are weakest**: with 2 spare grammar states the group "needs a nesting fix" goes from 76.1 to 84.4 (83.6 to 85.1), "out of reach" from 78.0 to 81.4 and the kind `newlineDelimited` from 92.0 to 96.9. The tokenizer states add in the group "needs a character class", 92.2 to 93.0. With both and 3 passes, "needs a nesting fix" has 85.2 (80.9 to 88.3) and "out of reach" 82.2.
- **They cost whole samples in every setting**: 80.44 in the hand-written tables, 79.9, 79.9, 79.5 and 78.0 with spare states and the plain pass and 79.2 with 3 passes, each range below 80.44. And 2 spare grammar states cost 0.15 points in the group "within reach of the tables".
- **With the plain pass, a part of what they add stays without them.** Sent to their stand-ins, the tables change by +0.02 to -0.16 points, where giving every changed cell its hand-written choice again loses 0.10 to 0.41. So with spare tokenizer states all of the gain is a change of where open cells lead, which states of today's can take. With spare grammar states 0.09 and 0.16 points are lost when they are sent away, and 0.12 and 0.33 when they are folded: these the two ways do not move into a state of today's.
- **With 3 passes from a uniform start, most of what they add is held by the spare states.** Of the 0.65 points, 0.50 are lost when the spare states are sent away and 0.58 when they are folded. In the best seed the two spare grammar states cost 0.24 and 0.20 points when each is sent away alone. So beside rules that stay as a person wrote them, a spare grammar state can hold something that these two ways do not move into a state of today's, 0.1 to 0.5 points of it. The accounts below name one such state.
- **Beside `words`, one spare tokenizer state finds what the state of `lines` does.** The group "needs a line rule" goes from 97.84 to 99.14 (98.82 to 99.45), where `lines` has 99.62, and the kind `newlineDelimited` from 85.75 to 93.55, where `lines` has 93.44. All three goes from 93.09 to 93.68 (93.64 to 93.71), above the 93.23 of `lines`, and to 94.22 (94.02 to 94.39) with two spare states.
- **And it does not need the spare state for it.** Folded, the tables lose 0.07 points with one spare state and 0.01 with two. So what training finds beside `words` is a better choice of open cells of today's states, which training reaches by way of a spare state.
- **Beside `words` whole samples fall by 6.7 and 4.3 points**, from 77.31 to 70.58 and 73.06, while all three rises. With one spare state, sending it to its stand-in gives 6.9 of those points back and raises all three by 0.13 more. So the trained spare state holds something that breaks many samples in a few code points each, which the loss, a sum over code points, does not weigh.

### A search of the same cells

The search of `../../search/` tries one cell at a time in the exact parser on the train split and keeps a choice that has more scored code points right. It is the comparison without gradients. `search.ts` runs it over every open cell of the hand-written tables with 2 spare tokenizer states, the spare states' cells among them, and over the hand-written tables without spare states, each in three orders of the cells, since a search ends in other tables for another order. With the most read cells first and no spare state it is the search of the number to beat, and it gives that number, 97.75.

| order of the cells | with the spare states: all three | within reach | whole samples | spare states that a train sample reads | validation code points read in a spare state, % | the same tables with the spare states sent to their stand-ins: all three | folded: all three | searched without spare states: all three | within reach | whole samples |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| the most read cells first | 97.78 | 99.61 | 79.05 | 2 of 2 | 1.11 | 97.72 | 97.66 | 97.75 | 99.68 | 79.37 |
| a random order, seed 1 | 97.83 | 99.73 | 79.70 | 2 of 2 | 2.24 | 97.49 | 97.72 | 97.63 | 99.58 | 79.63 |
| a random order, seed 2 | 97.79 | 99.71 | 79.92 | 2 of 2 | 1.82 | 97.75 | 97.54 | 97.80 | 99.70 | 79.79 |
| the 3 orders | 97.80 (97.78 to 97.83) | 99.68 (99.61 to 99.73) | 79.55 (79.05 to 79.92) | | | | | 97.73 (97.63 to 97.80) | 99.65 (99.58 to 99.70) | 79.60 (79.37 to 79.79) |

- **The search does begin to use a spare state.** A step into a copy of `errorLine` changes nothing while `errorLine` is as it was. Once the search has changed cells of `errorLine`, the copy is a state of its own, which is one way for the search to get started. In all three orders the train samples read both spare states, and 1.1% to 2.2% of the validation code points are read in one.
- **It gains nothing from them that three orders tell apart**: 97.80 (97.78 to 97.83) with the spare states and 97.73 (97.63 to 97.80) without, ranges that overlap. Without their spare states the three searched tables have 97.72, 97.49 and 97.75 when the states are sent to their stand-ins, and 97.66, 97.72 and 97.54 when they are folded: the better way of each loses 0.04 to 0.11 points.
- **The search is far above the training beside the hand-written rules**, 97.8 against 96.6 to 97.2, and the two are not on the same cells. The training may only make an open cell lead into a spare state, and the search may give every open cell every choice, since `searchCells` of `../holes/restricted-search.ts` takes cells and not choices. So the table says what the open cells hold beside these rules, 1.2 points with or without spare states, and the training of spare states alone reaches 0.1 to 0.65 of them.
- **Not run**: the search of every open cell from today's tables with spare states, which would be the counterpart of the main runs. From today's tables three orders of the search without spare states end 6.9 points apart, see `../../README.md`, so three orders would not show a difference of the size that this arm sees.

### What the main number does not show

Whole samples are in the tables of scores above. The rest, from the records of the runs:

| setting | added code points shown as an error | code points shown as past the end | wrong depths on valid JSON of 17 to 19 levels, nothing after the nested containers | the same, members after the nested containers | ground rules on the fixed texts | tables of the plain table parser |
| --- | --- | --- | --- | --- | --- | --- |
| the dataset's hand rule words, as tables of the experiment | 3.7 | 0 | 0.0 | 0.0 | hold | yes |
| the dataset's hand rule lines, as tables of the experiment | 3.7 | 0 | 0.0 | 0.0 | hold | yes |
| hand-written, the 35 rules of handwritten/rules.ts | 0.0 | 0 | 0.0 | 0.0 | hold | no: 21 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| no spare state, 1 pass from the base's choices | 0.9 (0.7 to 1.1) | 50 (0 to 160) | 3.0 (0.0 to 12.3) | 4.7 (0.0 to 16.4) | hold | no: 26 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 1 spare tokenizer state, 1 pass from the base's choices | 0.8 (0.6 to 1.0) | 97 (0 to 410) | 1.9 (0.0 to 6.8) | 4.9 (0.0 to 16.4) | hold | no: 25 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 2 spare tokenizer states, 1 pass from the base's choices | 0.6 (0.3 to 0.8) | 1655 (12 to 7824) | 2.0 (0.0 to 6.8) | 5.0 (0.0 to 17.5) | hold | no: 24 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 4 spare tokenizer states, 1 pass from the base's choices | 1.0 (0.6 to 1.8) | 269 (0 to 614) | 1.7 (0.0 to 3.0) | 4.2 (0.0 to 6.9) | hold | no: 24 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 8 spare tokenizer states, 1 pass from the base's choices | 0.8 (0.2 to 1.3) | 105 (43 to 225) | 4.1 (0.0 to 17.6) | 6.8 (0.0 to 26.8) | hold | no: 25 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 16 spare tokenizer states, 1 pass from the base's choices | 1.6 (0.2 to 5.3) | 551 (160 to 1600) | 4.6 (0.0 to 17.1) | 6.0 (0.0 to 23.2) | hold | no: 23 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 1 spare grammar state, 1 pass from the base's choices | 0.7 (0.4 to 1.2) | 401 (0 to 1208) | 6.8 (0.0 to 18.5) | 9.1 (0.4 to 20.8) | hold | no: 32 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 2 spare grammar states, 1 pass from the base's choices | 0.8 (0.4 to 1.2) | 294 (0 to 628) | 2.1 (0.0 to 8.3) | 2.0 (0.0 to 6.9) | hold | no: 37 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 4 spare grammar states, 1 pass from the base's choices | 1.3 (0.1 to 4.1) | 92 (0 to 231) | 3.4 (0.0 to 15.5) | 4.4 (0.0 to 18.5) | hold | no: 50 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 4 spare tokenizer states and 2 spare grammar states, 1 pass from the base's choices | 0.7 (0.2 to 1.2) | 292 (134 to 527) | 4.2 (0.0 to 18.1) | 6.6 (0.0 to 24.7) | hold | no: 34 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| no spare state, 3 passes from a uniform start | 0.0 (0.0 to 0.0) | 16 (0 to 79) | 47.9 (41.7 to 68.8) | 54.6 (48.0 to 78.3) | hold | no: 124 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 2 spare tokenizer states, 3 passes from a uniform start | 0.0 (0.0 to 0.0) | 32 (0 to 94) | 45.5 (41.6 to 59.9) | 53.6 (47.7 to 72.4) | hold | no: 123 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 4 spare tokenizer states, 3 passes from a uniform start | 0.0 (0.0 to 0.0) | 12 (0 to 61) | 41.9 (41.3 to 42.3) | 49.4 (47.9 to 50.9) | hold | no: 120 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 8 spare tokenizer states, 3 passes from a uniform start | 0.0 (0.0 to 0.0) | 26 (0 to 111) | 44.9 (17.8 to 61.2) | 53.5 (24.4 to 72.0) | hold | no: 118 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 2 spare grammar states, 3 passes from a uniform start | 0.0 (0.0 to 0.0) | 57 (0 to 121) | 58.0 (43.0 to 71.2) | 64.9 (48.5 to 79.4) | hold | no: 171 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 2 spare tokenizer states beside the hand-written rules, 1 pass from the base's choices | 0.0 (0.0 to 0.0) | 0 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | hold | no: 21 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 4 spare tokenizer states beside the hand-written rules, 1 pass from the base's choices | 0.0 (0.0 to 0.0) | 0 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | hold | no: 21 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 2 spare grammar states beside the hand-written rules, 1 pass from the base's choices | 0.0 (0.0 to 0.0) | 0 | 0.5 (0.0 to 2.5) | 3.9 (0.0 to 15.8) | hold | no: 46 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 4 spare tokenizer states and 2 spare grammar states beside the hand-written rules, 1 pass from the base's choices | 0.0 (0.0 to 0.0) | 0 | 1.3 (0.0 to 6.4) | 2.1 (0.0 to 8.8) | hold | no: 42 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 4 spare tokenizer states and 2 spare grammar states beside the hand-written rules, 3 passes from a uniform start | 0.0 (0.0 to 0.0) | 5 (0 to 12) | 8.4 (1.6 to 19.0) | 13.3 (7.6 to 18.3) | hold | no: 72 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 1 spare tokenizer state beside the dataset's hand rule words, 1 pass from the base's choices | 3.9 (3.9 to 4.0) | 0 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | hold | yes |
| 2 spare tokenizer states beside the dataset's hand rule words, 1 pass from the base's choices | 3.9 (3.9 to 4.0) | 0 | 0.0 (0.0 to 0.0) | 0.0 (0.0 to 0.0) | hold | yes |
| 2 spare tokenizer states beside the hand-written rules, searched with the most read cells first | 0.0 | 0 | 1.1 | 0.3 | hold | no: 96 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| 2 spare tokenizer states beside the hand-written rules, searched in a random order | 0.2 (0.1 to 0.2) | 0 | 23.0 (7.7 to 38.4) | 19.8 (11.8 to 27.9) | hold | no: 79 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| no spare state beside the hand-written rules, searched with the most read cells first | 0.0 | 0 | 18.5 | 30.2 | hold | no: 94 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |
| no spare state beside the hand-written rules, searched in a random order | 0.1 (0.0 to 0.1) | 0 | 0.2 (0.0 to 0.4) | 1.3 (0.0 to 2.6) | hold | no: 78 grammar cells hold a stack action that does something else than their token does, so the depth does not follow the tokenizer's events |

- **More code points are shown as past the end.** A trained tokenizer cell can snap to an event of a text's end, and a spare state brings 33 more cells that can. With the plain pass the control has 50 such code points (0 to 160), and every setting with spare states has more on average: 92 to 1,655, and 7,824 in one seed with 2 spare tokenizer states. With 3 passes from a uniform start it is 12 to 57, where that control has 16. Beside a person's rules it is 0 with the plain pass and 5 with 3 passes.
- **The depth of valid JSON that is too deep** is wrong as often as in the controls: at 1.7% to 6.8% of the code points in the first form of such texts with the plain pass, where the control has 3.0% (0.0 to 12.3), and at 42% to 58% with 3 passes from a uniform start, where that control has 47.9%. Spare states do not change what the trainer's setting does there.
- **Beside the hand-written rules, spare grammar states break that depth in some seeds**: 0.5% (0.0 to 2.5) and 3.9% (0.0 to 15.8) of the code points in the two forms with 2 spare grammar states, where the hand-written tables and the runs with spare tokenizer states have 0.0%. With both kinds of spare state and 3 passes from a uniform start it is wrong in every seed, at 8.4% (1.6 to 19.0) and 13.3% (7.6 to 18.3). The hand-written rules leave the stack alone in the contexts of depth 16, and the cells of a spare grammar state are trained without that rule.
- **Whole samples fall beside a person's rules**, by 0.6 to 2.4 points beside the hand-written tables and by 4.3 and 6.7 beside `words`, while all three rises. With every open cell trainable they do not fall: 73.0 to 74.9 with spare tokenizer states against the control's 73.2 with the plain pass.
- **The damage is shown as an error as seldom as in the controls**: with every open cell trainable, 0.6% to 1.6% of the added code points with the plain pass, and none with 3 passes.
- The ground rules hold on the fixed texts for every run.

## The accounts of the states

`account.ts` prints, for any saved tables and per spare state: how many code points of the validation split are read in the state, the cells that lead into it, its own cells that a text reads, what the labels say that the code points read in it are, three short train samples with a `^` under every code point that is read in the state, and the test. The test takes the state away in three ways, sent to its stand-in, folded into its stand-in, and with the base's choice back in every cell that leads into it, and scores the validation split again. The sentence is written by a person who reads that output. The accounts below are of the best seed of a kind of run, by all three on the validation split, so they are picked on the split that they are scored on.

In the samples, `want` is the display kind that the label wants and `got` the one that the tables give: `w` white space, `p` punctuation, `s` string, `e` escape, `n` number, `l` literal, `E` error, `k` key. `want` is blank where the damage added the code point. `⏎` stands for a line feed, `→` for a tab, and `◆` for a character that would break the columns, e.g. `…`.

### A state whose job is known: the hand rule `lines`

The dataset's hand rule `lines` has one tokenizer state more than `words`, the state 26 of its tables, and its author says what it is for: after a string that a line feed ended, an opening brace at the start of the next line is taken as a comma. The script on those tables:

- 672 code points of 651 validation samples are read in it, 0.09% of the code points from a first error on.
- Into it: (string, lineFeed) with the event `whitespace`, 671 times, and (escape, lineFeed) once.
- From it: white space leads to `between` (535 code points), a closing brace closes (76), an opening brace is read as a comma (11), and a letter starts a word (22).

```
sample 32149 of the train split, kinds: openStringAtLineEnd
text {⏎→"⏎}
in        ^
want pwwkwp
got  pwwkwp

sample 19538 of the train split, kinds: openStringAtLineEnd
text  {⏎  "tooltip1": "harbor\n[8] harbor argue\⏎  "letter": "Dear {name},\r\n\r\nThank you."⏎}⏎
in                                               ^
want wpwwwkkkkkkkkkkpwssssssseessssssssssssssssewwwkkkkkkkkpwssssssssssssseeeeeeeessssssssssswpw
got  wpwwwkkkkkkkkkkpwssssssseessssssssssssssssewwwkkkkkkkkpwssssssssssssseeeeeeeessssssssssswpw

sample 31027 of the train split, kinds: openStringAtLineEnd, code points 21 to 130 of 173
text ,⏎  "unicode": "caf\u00E9 \u2⏎  "pattern": {⏎    "one": "^\\d+\\.\\d+$",⏎    "other": "^\\d+\\.\\d+$ ({count})
in                                 ^
want pwwwkkkkkkkkkpwsssseeeeeeseeewwwkkkkkkkkkpwpwwwwwkkkkkpwsseesseeseesssspwwwwwkkkkkkkpwsseesseeseesssssssssssss
got  pwwwkkkkkkkkkpwsssseeeeeeseeewwwkkkkkkkkkpwpwwwwwkkkkkpwsseesseeseesssspwwwwwkkkkkkkpwsseesseeseesssssssssssss
```

In a sentence: entered at a line feed inside a string and left at the next code point: it remembers that a line feed ended the string, so that the next line starts a new member.

The test, in points of all three on the validation split:

| row | with the state | sent to the state `t` | folded into the state `n` | the base's choice back, which is today's |
| --- | --- | --- | --- | --- |
| all | 93.23 | +0.02 | +0.13 | -0.23 |
| needs a line rule | 99.62 | -0.01 | +0.01 | -2.48 |
| newlineDelimited | 93.44 | -0.06 | 0.00 | -7.75 |
| whole samples | 77.48 | -0.11 | 0.00 | -10.40 |

So the step out of the string at a line feed is worth 2.5 points in the group "needs a line rule", and a state of today's can take it: sent to the state `t`, where the tokenizer is after the `t` of `true`, the group loses 0.01 points. The state `t` has one frozen cell, the `r` that goes on with `true`. **So even the state that a person added by hand holds nothing that a state of today's cannot hold.** The one thing that only the added state does, the brace that is read as a comma, is read 11 times on the validation split.

### The plain pass, 4 spare tokenizer states, seed 2

The best seed of all the runs from today's tables with the plain pass: 97.19 of all three, 77.05 of whole samples.

**The tokenizer state 26.** 77,238 code points of 1,960 validation samples are read in it, 10.6% of the code points from a first error on. The labels call them a key (34%), a string (32%), or they were added by the damage (22%).

- Into it: (between, other) with the event `stringStart`, 7,509 times, (between, otherHexLetter) with `stringStart`, 706 times, and letters read in the state 27 and in the state `fraction`, which lead back into it.
- From it: a letter of the class `other` stays (23,515 code points), and so do most other letters and digits. A colon leads to `zero` with the event `colon` (4,662), a comma to `between` (2,040), a space to `fraction` (3,053), an `r` or a `u` to the state 27.

```
sample 31100 of the train split, kinds: unquotedKey
text { count: 879 }
in      ^^  ^
want pwkkkkkpwnnnwp
got  pwkkkkkpwnnnwp

sample 5087 of the train split, kinds: ellipsis
text [◆]
in     ^
want p p
got  psp

sample 21948 of the train split, kinds: unescapedBackslash
text ["5\' 11\"", false]
in        ^
want pss sssseespwlllllp
got  pssessnneespwlllllp
```

In a sentence: entered at the first letter of a word without quotes, kept through the word's letters and digits, left at the colon, the comma or the space after the word: it is the inside of a word without quotes. The hand-written rules keep the inside of a word in `errorLine`, and the control spreads it over states of numbers and literals.

The test: sent to the state `exponent`, all three falls by 1.07 points, the kind `unquotedKey` by 3.84, the group "needs a character class" by 7.24 and whole samples by 4.11. Folded into the state `errorLine`, all three falls by 0.04 points, `unquotedKey` by 0.00, the group by 0.24, and whole samples rise by 0.07. So the tables need a state for the inside of a word, and `errorLine` can be that state.

**The tokenizer state 27.** 8,825 code points of 1,454 validation samples, 1.2%. Into it: from the state 26 at an `r` (3,379 times), a `u` (1,523), a quote (916) and a minus (511). From it: most letters lead back to the state 26, a letter of the class `other` to `fraction`, a colon and a comma to `between`.

```
sample 16470 of the train split, kinds: foreignLiteral
text True
in     ^^
want
got  ssss

sample 24686 of the train split, kinds: byteOrderMark
text ◆""
in     ^
want  ss
got  sss

sample 18559 of the train split, kinds: singleQuotedString
text ['null']
in       ^
want pssssssp
got  pssssssp
```

In a sentence: a second state for the inside of a word, entered after an `r` or a `u` and left for the state 26 at most letters. No job that I can name.

The test: sent to `exponentDigits`, -0.15 points of all three. Folded into `errorLine`, +0.00.

**The tokenizer state 28.** 412 code points of 127 validation samples, 0.06%. The labels call 47% of them an escape. Into it: a backslash that is read in the state 26 (319 times), in the state 27 (48) or in `zero` (37), with the event `escape`. From it: the next code point leads back to the state 26 or 27, a letter with the event `escape`, a quote with `stringContent`.

```
sample 19797 of the train split, kinds: backslashEscapedDocument
text \"\"
in      ^
want  s s
got  Eses

sample 47750 of the train split, kinds: unquotedKey, singleQuotedString
text { json: '{"id": 1, "tags": []}', folder: 'C:\\temp\\' }
in                                                ^     ^
want pwkkkkpwss?ss?sssss?ssss?sssssspwkkkkkkpwssseesssseeswp
got  pwkkkkpwspnssspwnpwkkkkkkpwpppspwlkkkkkpwsspeesssseeswp

sample 5066 of the train split, kinds: backslashEscapedDocument
text {\"children\": null}
in               ^
want p kkkkkkkkk kpwllllp
got  pEkkkkkkkkkekpwllllp
```

In a sentence: entered at a backslash inside a word and left at the next code point: it remembers the backslash, so that the code point after it is shown as the second half of an escape, and a quote after it ends nothing. Today's state `escape` does that inside a string.

The test: sent to `tru`, -0.04 points of all three and -0.24 in the group "needs a character class". Folded into `hex1`, -0.03 and -0.22. This is the one state of the four whose job does not fold away, and it is worth 0.03 points.

**The tokenizer state 29.** 2 code points of 2 validation samples. 9 cells lead into it, and a validation text takes one of them. No job, and nothing is lost without it.

**All four taken away**: sent, -1.09 points of all three and -4.16 of whole samples. Folded, -0.08 and -0.26: the folded tables have 97.11 of all three, with no text in a spare state.

### The plain pass, 2 spare grammar states, seed 1

The best seed of the runs with spare grammar states alone: 96.76.

**The grammar state 8**, shown as `colon`. 56 code points of 51 validation samples, 0.01%. Into it: (commaOrClose, openObject, depth 2 to 15, object), 30 times, (end, closeArray, depth 0), 17 times, and 7 more cells. From it: 10 cells, most of them to `valueOrClose`. No job that I can name. The test: sent to `end`, +0.03 points of all three. Folded into `valueOrClose`, -0.02.

**The grammar state 9**, shown as `commaOrClose`. 52 code points of 50 validation samples, 0.01%. Into it: (commaOrClose, closeArray, depth 2 to 15, object), 46 times: a `]` where an object's comma or closing brace should come. From it: the next white space or token pops once more, e.g. (state 9, none, depth 2 to 15, array) holds `commaOrClose` and a pop.

```
sample 44256 of the train split, kinds: missingCloser
text [{"sensor": "th-04", "t": 1791844686, "v": 1.74]
in
want ppkkkkkkkkpwssssssspwkkkpwnnnnnnnnnnpwkkkpwnnnnp
got  ppkkkkkkkkpwssssssspwkkkpwnnnnnnnnnnpwkkkpwnnnnp

sample 15972 of the train split, kinds: keyWithoutColon, missingCloser
text [⏎  {⏎    "inner"⏎  null⏎]⏎
in                             ^
want pwwwpwwwwwkkkkkkkwwwllllwpw
got  pwwwpwwwwwkkkkkkkwwwllllwpw

sample 8379 of the train split, kinds: openStringAtLineEnd, strayCloser, code points 51 to 160 of 175
text ⏎      "type": "python",⏎    ],⏎      "request": "attach",⏎      "name": "Launch Pro,⏎      "program": "${file
in                                 ^
want wwwwwwwkkkkkkpwsssssssspwwwww       wwkkkkkkkkkpwsssssssspwwwwwwwkkkkkkpwsssssssssss?wwwwwwwkkkkkkkkkpwsssssss
got  wwwwwwwkkkkkkpwsssssssspwwwwwppwwwwwwwkkkkkkkkkpwsssssssspwwwwwwwkkkkkkpwsssssssssssswwwwwwwkkkkkkkkkpwsssssss
```

In a sentence: entered at a `]` that comes inside an object: it remembers that the object's closing brace is missing, and the next code point closes the array that the `]` was meant for.

The test: with today's choice back, the group "needs a nesting fix" loses 1.46 points and all three 0.02. Sent to `commaOrClose`, the group loses 0.25 and all three gains 0.02. Folded into `keyOrClose`, the group loses 0.00 and all three 0.02. So the job is real, it is worth 0.02 points, and the state `keyOrClose` can hold it.

### Beside the hand-written rules, 4 spare tokenizer states and 2 spare grammar states, seed 5

The best seed of the runs beside the hand-written rules: 97.01 of all three, where the hand-written tables have 96.52. With every spare state sent to its stand-in the tables have 96.82, with every one folded 96.72, and with the hand-written choices back 96.51.

| spare state | validation code points read in it | most taken step into it | in a sentence | sent, all three | folded, all three |
| --- | --- | --- | --- | --- | --- |
| tokenizer 26 | 144 | (t, a) and (f, other), 52 times each | a letter after a `t` or an `f` that started a word: no job that I can name | -0.00 | -0.00 |
| tokenizer 27 | 1,391 | (errorLine, closeBrace), 523 times, (errorLine, closeBracket), 325 | the code point after a closing bracket that ended a word: no job that I can name beyond that | -0.02 | -0.00 |
| tokenizer 28 | 997 | (errorLine, backslash) with `escape`, 344 times, (between, backslash), 284 | after a backslash outside a string: the next code point is the second half of an escape, as in the plain pass's state 28 above | -0.08 | -0.00 |
| tokenizer 29 | 296 | (fraction, quote), 61 times | no job that I can name | +0.00 | +0.00 |
| grammar 8, shown as `colon` | 78 | (commaOrClose, string, depth 0), 37 times, (colon, openObject, depth 1, object), 27 | see below | -0.09 | -0.28 |
| grammar 9, shown as `commaOrClose` | 126 | (commaOrClose, openObject, depth 2 to 15, object), 41 times | no job that I can name | +0.01 | -0.05 |

**The grammar state 8** is the one that holds something. Its most read cell is (state 8, string, depth 2 to 15, object), which holds `colon` and a pop, 36 code points.

```
sample 19757 of the train split, kinds: textAfterEnd, keyWithoutColon
text {⏎→"cou"⏎};
in
want pwwkkkkkwp
got  pwwkkkkkwpk

sample 55837 of the train split, kinds: newlineDelimited, cutOff
text {"⏎{"id":2,"name":"Margaret Kowalski","active":false}
in       ^
want pkwpkkkkpnpkkkkkkpssssssssssssssssssspkkkkkkkkplllllp
got  pkwpkkkkpnpkkkkkkpssssssssssssssssssspkkkkkkkkplllllp

sample 8763 of the train split, kinds: missingCloser
text [935, [{"flags": "{count} items, {selected} selected", "x": 740, "a.b": false, {}]]
in                                                                                   ^
want pnnnpwppkkkkkkkpwsssssssssssssssssssssssssssssssssssspwkkkpwnnnpwkkkkkpwlllllpwpppp
got  pnnnpwppkkkkkkkpwsssssssssssssssssssssssssssssssssssspwkkkpwnnnpwkkkkkpwlllllpwpppp
```

In a sentence: entered at an opening brace that comes where a colon should, i.e. a new document starts inside an unfinished one: it remembers that until the first string, which it shows as a key while it pops the stack once, so that the depth is the new document's. Its most taken step is another one, a word after the end of a document at depth 0, which it shows as a key and which no label scores.

Why `keyOrClose` cannot hold the job: after an opening brace the grammar is in `keyOrClose`, and valid JSON reads the cell of a string there, so that cell is frozen and cannot pop. A state that pops at its first key has to be another state.

The test: sent to `commaOrClose`, the kind `newlineDelimited` loses 4.99 points, the group "needs a nesting fix" 1.95, "out of reach" 1.94, and all three 0.09. Folded into `error`, all three loses 0.28 and the group "needs a nesting fix" 18.44, since the hand-written rules use the cells of `error` for other repairs. **So this state holds about 0.1 points that neither way moves into a state of today's.**

### Beside the dataset's hand rule `words`, 1 spare tokenizer state, seed 1

The best seed of that setting: 93.71 of all three, where `words` has 93.09 and `lines` 93.23.

**The tokenizer state 26.** 4,996 code points of 1,824 validation samples, 0.7%. 204 cells lead into it, and a validation text takes 42 of them: (errorLine, quote) 843 times, (t, other) 833, (string, lineFeed) with the event `whitespace` 650, (between, s) 607. From it: 30 of its 33 cells are read, most of them lead to `errorLine` or to `between`.

```
sample 32149 of the train split, kinds: openStringAtLineEnd
text {⏎→"⏎}
in        ^
want pwwkwp
got  pwwkwp

sample 39330 of the train split, kinds: doubledQuote
text  ""is over tide"
in                ^
want ws sssssssssssss
got  wsssswsssswlssss

sample 24686 of the train split, kinds: byteOrderMark
text ◆""
in     ^
want  ss
got  sss
```

In a sentence: several jobs in one state, since it is the only spare one. One of them is the job of the state that `lines` adds: it is entered at a line feed inside a string, by the same cell and with the same event, and the first sample is the one that the account of `lines` shows. The others I cannot name.

The test: with the choices of `words` back, the group "needs a line rule" loses 0.98 points, `newlineDelimited` 7.54 and all three 0.62. Sent to the state `tr`, all three gains 0.07, and whole samples gain 9.88 points, from 67.80 to 77.68. Folded into `fal`, all three loses 0.02. So training finds the step that `lines` adds, it does not need the spare state to hold it, and it pays for the other jobs in the same state with whole samples, see [Spare states beside rules that a person wrote](#spare-states-beside-rules-that-a-person-wrote).

### 3 passes from a uniform start, 4 spare tokenizer states, seed 1

The best seed of the runs with that setting of the trainer: 97.22 of all three. The same two jobs come out as with the plain pass.

| spare state | validation code points read in it | most taken step into it | in a sentence | sent, all three | folded, all three |
| --- | --- | --- | --- | --- | --- |
| tokenizer 28 | 47,706, 6.5% | (between, other) with `stringStart`, 7,586 times | the inside of a word without quotes: entered at the word's first letter, kept through most letters and digits, left at a colon for `integer` and at a space for `zero` | -1.09 | 0.00 |
| tokenizer 26 | 23,454, 3.2% | (state 28, other), 13,917 times, (exponentDigits, other), 4,035 | a second state for the inside of a word, which most letters leave again for the state 28 or for `exponentDigits`: no job that I can name | -0.43 | 0.00 |
| tokenizer 29 | 565, 0.08% | a backslash with the event `escape`, from the state 28 (212 times), from the state 26 (74) and from six states of today's | the code point after a backslash inside a word: a letter after it is shown as an escape, and a quote ends nothing | -0.07 | -0.00 |
| tokenizer 27 | 62, 0.01% | (tr, space), 31 times | no job that I can name | +0.00 | 0.00 |

All four taken away: sent, -1.15 points of all three and -4.57 of whole samples. Folded, -0.04 and -0.41. Each of the four alone folds into `errorLine` at a loss of 0.00 points.

### Beside the hand-written rules, 3 passes from a uniform start, seed 3

The best seed of that setting: 97.33 of all three. Only the test is given here. With every spare state sent to its stand-in the tables lose 0.68 points, with every one folded 0.57, and with the hand-written choices back 0.81. The four spare tokenizer states, each alone, lose 0.00 to 0.01 points when they are folded. The two spare grammar states do not fold away: the state 8 loses 0.24 points when it is sent to `commaOrClose` and 0.37 when it is folded into `valueOrClose`, and the state 9 loses 0.20 both ways. The state 8 is read at 218 validation code points, and its most taken step is (key, closeObject, depth 1, object), 375 times: a closing brace after a trailing comma. I have no sentence for what it remembers after that step, nor for the state 9. `account.ts` prints their cells and samples.

## What the arm shows

- **With every open cell trainable, the parser does not learn to remember something that today's states cannot hold, as far as this dataset's score can see.** Training does use spare tokenizer states, and the trained tables need them: sent away, they cost up to 1.6 points. But folded into states of today's they cost 0.02 to 0.15 points, in every setting with spare tokenizer states alone and with both settings of the trainer. What a spare tokenizer state does is a job that a state of today's can do with its open cells. Spare grammar states add nothing against the control there, and taking them away costs 0.1 to 0.3 points on average in either way with the plain pass.
- **Today's tables already have spare states.** A tokenizer state of today's is tied to valid JSON only in its frozen cells, and after a first error a text can come into it by an open cell. `errorLine` has no frozen cell and the ten states of a literal have one each. The control puts the inside of a word without quotes into such states, at 20% of the code points after a first error, and a spare state takes over a part of exactly that share.
- **A spare state can help the training without being needed by the parser.** With 4 spare tokenizer states or more the kind `unquotedKey` and the group "needs a character class" end above the control's range with the plain pass, and the folded tables, which use no spare state, keep that. So training with spare states and folding them away afterwards gives tables of today's layout that the same training without spare states did not reach. The main number does not move by more than its seeds do.
- **The start decides whether a spare state is used at all.** With the plain pass's start and no random part, spare states end as copies of each other and unused. This is the first thing to get right in any arm that adds states.
- **Where a person's rules stay fixed, a spare state is a way to add to them.** Beside the hand-written rules and beside `words`, spare states add 0.1 to 1.1 points, and training finds the step that the hand rule `lines` adds by a state. Beside `words`, and for the spare tokenizer states beside the hand-written rules, the gain stays when the spare states are folded or sent away: it was a better choice of where open cells of today's states lead.
- **The spare grammar states beside the hand-written rules are the one place where spare states both add to the score and hold what they add**: 0.1 to 0.2 points with the plain pass and 0.5 with 3 passes from a uniform start are lost in both ways of taking them away. The gain is in the groups "needs a nesting fix" and "out of reach", where the hand-written rules are weakest. One of them has a name: it pops the stack at the first key of a document that began inside an unfinished one. This is no limit of today's layout: the search of every open cell beside the same rules gets 1.2 points without any spare state. It says that rules which a person wants to keep as they are can be extended by a state that training fills.
- **A spare state's job can often be said in a sentence, and the sentence can be tested.** Of the 18 spare states in the accounts above, 9 have a job that I can name, and two jobs come out in both settings of the trainer: the inside of a word without quotes, and the code point after a backslash inside a word. The test of a sentence is the same tables without the state: the loss when the state is sent away says that the tables use it, and the loss when it is folded says what it holds apart.
- **Even the state that a person added by hand, the one of `lines`, folds into a state of today's without a loss.** So the example that made a state look necessary is one more case of today's states having the room.

## What the arm does not show

- **Nothing here is a number on unseen data.** The size of the random part was chosen on the validation split, on other seeds, and the accounts are of seeds that were picked on the validation split. For the hand-written tables and for the dataset's hand rules no split of this dataset counts as unseen. The test split was not scored.
- **Not that a state can never matter.** Today's tables leave 710 open tokenizer cells and 616 open grammar cells, and states that a text only comes into by an open cell. A recovery that has to remember more than those hold would need a state, and no row of this dataset's score asks for one, as far as these runs show. An added character class is another kind of structure, e.g. to tell an apostrophe from a letter, and this arm adds none.
- **Not why training finds more with spare tokenizer states.** The folded tables show that the gain in the two rows does not need the states. Whether it comes from the states' free cells, from the random part of their start, or from more cells to move through, is not measured: no run gave the control a random part at its start.
- **Not that the two ways of taking a state away find the least loss.** The stand-in is one state of today's, chosen on 8,000 train samples, the spare states are taken away one after the other, and nothing is trained after. A search over the open cells of the folded tables might get the rest back.
- **Not a tuned trainer.** Both settings are the ones that were at hand. The option `--trainer` takes the tuned one when another arm has it.
- **The sentences of the accounts are one reader's.** The script gives the counts, the cells and the samples. What a state "remembers" is read from them by a person, and the test only says what the tables lose without the state.
- **Spare grammar states got one kind of start and two columns of the display table.** Their display column is fixed to the one of `colon` or of `commaOrClose`. With open entries of the display table, see `../../structure/README.md`, a spare grammar state could show a token in a way of its own, which no run here allows.

## Commands

Run from the repo root. A seed of the plain pass takes about 35 s with 4 worker threads and other jobs running, and a seed of 3 passes about 90 s. A seed beside a person's rules takes 15 to 30 s with the plain pass and about 110 s with 3 passes. A search takes 2 to 4 minutes.

```sh
export RECOVERY_SCRATCH=<a folder outside the repo>
bun lab/recovery-parser/learn/handwritten/rules.ts                # the hand-written tables, for the runs beside them
bun lab/recovery-parser/learn/arms/spare-states/run.ts --states 0+0,1+0,2+0,4+0,8+0,16+0,0+1,0+2,0+4,4+2 --trainer plain
bun lab/recovery-parser/learn/arms/spare-states/run.ts --states 0+0,2+0,4+0,8+0,0+2 --trainer three-passes
bun lab/recovery-parser/learn/arms/spare-states/run.ts --states 2+0,4+0,0+2,4+2 --base hand-written --trainer plain
bun lab/recovery-parser/learn/arms/spare-states/run.ts --states 1+0,2+0 --base words --trainer plain
bun lab/recovery-parser/learn/arms/spare-states/run.ts --states 4+2 --base hand-written --trainer three-passes
bun lab/recovery-parser/learn/arms/spare-states/search.ts --states 2+0 --base hand-written    # the search in three orders, with and without the spare states
bun lab/recovery-parser/learn/arms/spare-states/report.ts          # every table of this README, from the saved runs
bun lab/recovery-parser/learn/arms/spare-states/account.ts --tables <file.json> [--base hand-written|words]   # what each spare state of saved tables does
bun lab/recovery-parser/learn/arms/spare-states/check.ts           # the arm's own checks, about 20 s
```

`--states` lists the runs, each as the spare tokenizer states and the spare grammar states, e.g. `4+2`. `--trainer` is `plain`, `three-passes`, or five values with commas: the passes, the start, the learning rate, the temperature at the end and the sharpness cost, e.g. `--trainer 10,uniform,0.02,0.5,0.01`. The tables and the records of the reported runs are under `<RECOVERY_SCRATCH>/arms/spare-states/`, one folder per setting, and `report.ts` keeps what it counts per tables in a file `seed-<seed>.use.json` next to them, with a hash of the tables: the first run of it takes about 5 minutes, and a later one seconds. `check.ts` is not among the checks that `../../check-all.ts` runs.

The tuning runs, as they were run:

```sh
bun lab/recovery-parser/learn/arms/spare-states/run.ts --arm spare-states-tune --seeds 11,12,13 --states 4+0 --trainer plain --noise 0     # and 0.3, 1, 2, 3
bun lab/recovery-parser/learn/arms/spare-states/run.ts --arm spare-states-tune --seeds 11,12,13 --states 1+0 --trainer plain --noise 0
bun lab/recovery-parser/learn/arms/spare-states/run.ts --arm spare-states-tune --seeds 11,12,13 --states 4+0 --trainer three-passes --noise 1
```

## Files

- `spare-states.ts`: the base of a run (`baseOf`), the start of the spare states (`createSpareModel`), the trainer's settings, how often the parser is in each state (`stateUseOf`), and tables without a spare state: sent (`withoutState`), folded (`foldedInto`), with the stand-in that costs least (`standInOf`), and all of them (`withoutSpareStates`).
- `run.ts`: the runs of one trainer's setting on one base.
- `search.ts`: the search of `../../search/` over every open cell of tables with spare states, in three orders, with and without the spare states.
- `account.ts`: the account of the spare states of any saved tables.
- `report.ts`: the tables of this README, from the saved runs.
- `check.ts`: without a spare state the model is the plain pass's, the start comes from the seed, a run beside a person's rules changes only what it may, and tables without a spare state have no step into it.
