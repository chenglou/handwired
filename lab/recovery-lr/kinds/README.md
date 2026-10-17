# Kinds of mistakes written for miniml, and the mixed set

The dataset's damage (`../damage.ts`) knows nothing of the language: ten edits on code points and lines. This folder holds a second train set that was declared before any held-back test was scored: half of its samples keep that damage, and the other half have one or two kinds of mistakes that a person or a language model makes when writing a miniml program, e.g. `==` for `=`, `[1, 2]` for `[1; 2]`, a local definition without its `in`.

**The kinds were written by one agent in under an hour, under a hard deadline, and nobody reviewed them: not the list, not the weights, not the code, not this README.** The author read three samples of every kind (see "What was checked"), and that is all the reading they got. No list of kinds was given to the author, and the author read no held-back set.

## The files

- `kinds.ts`: the 34 kinds, each with a name, who makes the mistake, an example, and the code that applies it to a valid program as edits on its code points. It also holds `scanProgram`, which reads from a program what the kinds need: the tokens, which bracket closes which, the definitions at the top, the local definitions with their `in`, the functions.
- `mixed.ts`: `kindsSampleAt(seed, index)` makes the sample of this folder for a program, and `eachMixedSample`, `mixedPacked` and `prepareMixedRecipe` give the mixed set to the training.
- `check.ts`: the checks of the mixed set. `bun lab/recovery-lr/kinds/check.ts` takes 13 s on a machine that does nothing else and ends with one line that says whether every check passed.
- `dump.ts`: `bun lab/recovery-lr/kinds/dump.ts <folder>` writes `samples.txt` with 300 samples of the kinds half for reading, at least three per kind, in the layout of `../dump.ts` with one more line per sample that says which variant of each kind it has.
- `runs/`: the frozen recipe run on the mixed train split, see "The runs" below.

## How a sample of a kind is made

A kind gets a valid program and returns edits: at a place of the program's code points, so many code points go and a text comes. The edits give the broken text and, for each of its code points, the place of its counterpart in the program or -1 for an added one. That pair goes to `makeSample` of `../sample.ts`, the one function that makes every sample of the dataset. So the labels of the kept code points are the original's, an added code point has no label, the alignment is brought to the dataset's form, and what is scored is what the dataset scores: the kept code points from the first error's token on. This folder has no label scheme of its own.

A code point that stands in the place of another is an added one, as in the dataset, e.g. the `,` of `[1, 2]` for `[1; 2]` has no label. Where the new text shares its start or its end with the old one, `makeSample` keeps the shared code points, e.g. of `fn` for `fun` the `f` and the `n` are kept and have the label of a keyword.

A kind applies only where the program has a place for it and returns nothing otherwise, e.g. `bangEquals` on a program without `<>`. For a program, kinds are drawn by their weights, one kind in 70% of the draws and two in 30%, again and again until a draw gives a sample. A draw is thrown away when the program has no place for a drawn kind, when the edits of two kinds are less than 8 code points apart, and for the dataset's own reasons: the broken text is unchanged, still a valid program, longer than 512 code points, or has no code point to score (which includes a first error at the end of input). The length is the only limit that the dataset's `makeSample` sets; this track has no separate limit on the depth, and a text of 512 code points stays below the parser's limit on its stack.

On the 20,000 train samples of the kinds half, 42,845 draws were made: 21,696 found no place, 793 had nothing to score, 332 were too long and 24 were still valid.

## The kinds

The two counts are the samples of the mixed set that have the kind; a sample with two kinds counts for both. In the examples, ⏎ is a line feed.

| kind | who makes it and why | example | samples on train | samples on validation |
| --- | --- | --- | --- | --- |
| **OCaml that miniml lacks** | | | | |
| doubleSemicolon | Someone used to the OCaml toplevel or to old OCaml files, where `;;` ends a definition | `let limit = 10;;⏎let twice x = 2 * x;;` | 1444 | 206 |
| inAfterTopDefinition | Someone who writes every `let` with its `in`, as inside a function, also at the top | `let limit = 10 in⏎let twice x = 2 * x` | 985 | 155 |
| sequenceSemicolon | An OCaml writer who runs two expressions one after the other with `;`, which miniml has only inside a list | `let () = print_string "a";⏎print_string "b"` | 161 | 15 |
| typeAnnotation | Anyone who writes OCaml, Rust or TypeScript and gives a name its type | `let total : int = 0⏎let add (x : int) y : int = x + y` | 1608 | 209 |
| patternParameters | An OCaml writer who takes a pair apart in the parameters, or someone who writes parameters as C does, in brackets with commas | `let add (x, y) = x + y⏎let twice(x) = 2 * x` | 969 | 134 |
| floatNumber | Anyone who needs a number with a fraction, and an OCaml writer who uses the operators for floats | `let half = 0.5⏎let area r = 3 *. r *. r` | 1105 | 144 |
| openLine | An OCaml writer or a model that starts a file by opening a module | `open List⏎⏎let total = 0` | 622 | 79 |
| **habits of other languages** | | | | |
| doubleEquals | Anyone coming from C, Java, JavaScript or Python, where equality is `==` | `let rec count n = if n == 0 then 0 else 1 + count (n - 1)` | 967 | 110 |
| bangEquals | Anyone coming from C, Java, JavaScript or Python, where inequality is `!=`, or from Haskell, where it is `/=` | `let differs a b = a != b` | 128 | 18 |
| wordOperatorAsSign | Anyone coming from C or JavaScript, where the remainder is `%` and negation is `!` | `let even n = n % 2 = 0⏎let off = !on` | 211 | 27 |
| arrowFunction | Anyone coming from JavaScript, Scala or Java, where a function is `x => x + 1` or `x -> x + 1` without a word before it | `let negate = fun x => -x⏎let twice = x -> 2 * x` | 332 | 35 |
| otherFunKeyword | Anyone coming from SML or Rust (`fn`), OCaml or JavaScript (`function`), Python (`lambda`) or Haskell (`\x ->`) | `let negate = fn x -> -x⏎let twice = \x -> 2 * x` | 366 | 46 |
| elif | Anyone coming from Python (`elif`), Ruby (`elsif`) or a shell, in a chain of conditions | `let sign x = if x > 0 then 1 elif x < 0 then -1 else 0` | 257 | 40 |
| conditionWithoutThen | Anyone coming from C or JavaScript, where no word follows the condition, or from Python, where a colon does | `let sign x = if (x > 0) 1 else 0⏎let big x = if x > 9: true else false` | 813 | 102 |
| otherDefinitionKeyword | Anyone coming from SML (`fun f x =`, `val x =`), JavaScript (`const`, `var`), Scala or Python (`def`) | `val limit = 10⏎fun twice x = 2 * x` | 1180 | 151 |
| semicolonAfterDefinition | Anyone coming from C, Java, JavaScript or Rust, where a statement ends with `;` | `let limit = 10;⏎let twice x = 2 * x;` | 1443 | 184 |
| bracesAroundBody | Anyone coming from C, Java, JavaScript or Rust, where a function's body stands in braces | `let twice x = {⏎  2 * x⏎}` | 747 | 94 |
| singleQuoteString | Anyone coming from Python, JavaScript or a shell, where a string can stand between single quotes | `let greeting = 'hello'` | 663 | 58 |
| otherComment | Anyone coming from C or JavaScript (`//`), Python or a shell (`#`), Haskell or SQL (`--`) | `let limit = 10 // the most⏎# helpers⏎let twice x = 2 * x` | 736 | 93 |
| haskellOperator | Anyone coming from Haskell or Elm, where a list is built with `:` and joined with `++` | `let full = first ++ " " ++ last⏎let more = 1 : rest` | 340 | 29 |
| **lists and tuples** | | | | |
| commaInList | Nearly everyone at first: every other language separates the items of a list with commas | `let primes = [2, 3, 5, 7]` | 422 | 44 |
| semicolonInTuple | Someone who has just learned that lists take `;` and now writes it in a tuple too | `let pair = (1; "one")` | 235 | 32 |
| trailingSeparator | An OCaml writer, whose lists may end with `;`, and anyone from Python, JavaScript or Rust, whose tuples and lists may end with `,` | `let primes = [2; 3; 5;]⏎let pair = (1, "one",)` | 569 | 68 |
| tupleWithoutBrackets | An OCaml, Python or Haskell writer: there a tuple needs no brackets | `let pair = 1, "one"` | 196 | 23 |
| **brackets and unfinished code** | | | | |
| missingClosingBracket | Everyone: a `)` or a `]` that was never typed or was deleted with the text before it | `let rec count n = 1 + count (n - 1⏎let limit = 10` | 1141 | 148 |
| extraClosingBracket | Everyone, above all with an editor that closes brackets by itself: one closing bracket too many | `let rec count n = 1 + count (n - 1))` | 1061 | 127 |
| wrongClosingBracket | Everyone: the closing bracket of the other kind | `let primes = [2; 3; 5)` | 722 | 91 |
| missingIn | Every OCaml writer, often: a local definition without its `in` | `let area w h =⏎  let half = w / 2⏎  half * h⏎let limit = 10` | 454 | 39 |
| unbracketedArgument | Anyone who passes a function, a conditional or a local definition as an argument and forgets that it needs brackets | `let doubled = map fun x -> 2 * x` | 256 | 31 |
| unclosedString | Everyone: a string whose closing quote was never typed | `let greeting = "hello⏎let limit = 10` | 462 | 58 |
| unfinishedDefinition | Everyone, while typing: a definition whose body is not written yet, with finished definitions after it | `let limit =⏎let twice x = 2 * x⏎let four = twice 2` | 613 | 90 |
| **around the program** | | | | |
| codeFence | A language model, or a person who pastes a model's answer: the program still has its code fence, and sometimes the sentence before it | `` ```ocaml⏎let limit = 10⏎``` `` | 1323 | 136 |
| mergeConflictMarkers | Anyone after a merge that left its marker lines in the file, around the two versions of a definition | `<<<<<<< HEAD⏎let limit = 10⏎=======⏎let limit = 11⏎>>>>>>> main⏎` | 421 | 53 |
| toplevelPrompt | Someone who copies definitions out of a session of the OCaml toplevel, with its `#` prompt and its `;;` | `# let limit = 10;;⏎# let twice x = 2 * x;;` | 771 | 95 |

The weights are the author's guesses of how common a mistake is, from 1.5 to 4, and were not measured on any real text. How often a kind comes also depends on how many programs have a place for it: `bangEquals` has 128 train samples because few generated programs have a `<>`.

## The mixed set

- The same programs, indexes and splits as the dataset's sets: the first 40,000 programs of the train split and the first 5,000 of the validation split of the seed 20261016. A program's split is the dataset's, by the hash of its tokens, so a train program stays a train program and no validation program enters the train split. The test split and the held-back sets are never read.
- Within a split, in the order of the indexes, the first, third, fifth program and so on keep the dataset's sample, and the second, fourth and so on get a sample of this folder. So the train split has 20,000 samples with the dataset's damage and 20,000 with kinds, and the validation split 2,500 and 2,500.
- Of the 20,000 train samples with kinds, 16,277 have one kind and 3,723 have two. Of the 2,500 validation samples, 2,036 and 464.
- The 20,000 train samples with kinds have 3,477,833 scored code points, and the 20,000 with the dataset's damage 2,688,805: a mistake of a kind sits early in the text more often, and 3,502 of the 20,000 have their first error at the first code point (a code fence, an `open` line, a comment with `#`, another word for the first `let`).
- A sample of this folder has the id of its program with `:kinds` after it, e.g. `20261016:8:kinds`, and its `edits` are the names of its kinds.
- The training takes it as it takes the dataset: `prepareMixedRecipe()` returns what `prepareRecipe()` of `../learn/recipe.ts` returns, with the mixed train samples in the place of the dataset's, and `trainedTables`, `searchedTables` and `countedTables` of the recipe take that. `mixedPacked(split, count, layout)` is `loadPacked` of `../learn/data.ts` for the mixed set.

## What was checked

`check.ts` on all 45,000 samples, with the result "Every check of the mixed set passed":

1. The samples at the places 0, 2, 4 and so on of a split are the dataset's own samples (the first 200 of each split are compared with `loadSamples`), the others are samples of this folder with the index of their program.
2. Every sample of the kinds half: at most 512 code points, rejected by the parser as it is, a first error where a second parse of the text finds it and not at the end of input, at least one code point to score, kept code points in the original's order, and on every kept code point the original's four labels, which the check takes from the original by `../labels.ts` and not from the sample. This is the dataset's own second derivation (check 3 of `../check-dataset.ts`); the dataset has no other one.
3. On 3,000 samples of the kinds half, the shortest edit script between the two texts (`alignmentOfTexts` of `../sample.ts`, which knows nothing of the kinds) never keeps fewer code points than the kinds' edits. In 45 of the 3,000 it keeps more: there the kinds' edits call a code point added that a shortest script would keep, so those samples have a few labels fewer than they could have, and none that is wrong.
4. No list of tokens of an original is in both splits (37,220 lists in train, 4,718 in validation), and no list of tokens of a broken text of the kinds half is in both splits (19,856 and 2,490). Every sample is in the split of its original.
5. 1,125 samples of the kinds half, every 20th, are the same when they are made alone a second time. Every choice is a hash of the seed, the index and a counter, as in the dataset.
6. Every kind has samples in both splits; the counts are in the table above.

By reading: the author read three samples of every kind alone, cut to the columns around the mistake, with the labels under the text. Two kinds were changed after that reading: `sequenceSemicolon` put a `;` after a plain value such as `let ports = [25];`, and now needs a function or a `let () =` before the `;`; `otherComment` turned a line of stars `(*****)` into `//*****`, and now only takes comments with a space inside both ends. The 300 samples of `samples.txt` were written and not read one by one.

## Known limits

- Nobody reviewed the kinds. A reviewer may find kinds that no person would write as they are written here, and kinds that are missing.
- The kinds come from what the author knows of OCaml and of the habits that people bring from other languages. No broken program written by a person was looked at, and no corpus was counted, so both the list and the weights are guesses.
- Some scored labels are out of every parser's reach, because the label is the original's and the scanner now reads the text differently: the text of a string between single quotes (the scanner reads names there, the label says string), the code after a string that lost its closing quote up to the end of its line, the text of a comment written with `//`, `#` or `--`.
- For three kinds the parser's first error is far behind the mistake: `missingIn`, `missingClosingBracket` and `unfinishedDefinition` are reported at the next `let` at the top or later, and the code points between the mistake and that token are not scored. When the mistake sits in the last definition, the error is the end of input and the draw is thrown away, so these kinds are under-counted at the end of a program.
- `otherDefinitionKeyword` writes `val`, `const`, `var` or `def` only for the first `let` of a program: after another definition such a word reads as a name and the text is often still valid. `fun` for `let` is written anywhere.
- `typeAnnotation` draws its type at random, e.g. `let all_ok : string = ...` for a boolean. miniml has no types, so the syntax is all that counts here, but a reader will find the types odd.
- The programs are the generator's, and some hold expressions that no person would write, e.g. `10000 3 > true`. A kind on such a program gives a sample that reads odd because the program does.
- In a sample with two kinds, the two are drawn independently. Nothing makes them the habits of one person, e.g. `;` after every definition together with `==`.
- `mergeConflictMarkers` only takes a definition of at most 100 code points that has a number, and the other version differs in that number alone.
- The share of samples with two kinds (18.6% of the kinds half on train) is lower than the 30% of the draws, because a draw of two kinds finds no place more often.

## The runs

The frozen recipe of `../learn/recipe.ts` was run on the mixed train split for the seeds 1 to 5, with no setting changed and nothing tuned: `runs/run.ts` calls the recipe's own `trainedTables`, `searchedTables` and `countedTables`, and the only difference from `../learn/runs/run.ts` is that the train samples come from `prepareMixedRecipe()`. One training per seed gives two rows: row 9 is the training then the count, row 10 is the training, then the search, then the count. The rule that picks code points for terminals of their own read the mixed train samples and picked `&` and `|`, the same two as on the dataset's train split, so 5,102 cells may change, as there. In the commands and below, `<scratch>` stands for the experiment's scratch folder, which is outside the repo and which other pages name `recovery-scratch`.

```sh
bun lab/recovery-lr/kinds/runs/run.ts --seed 1 --folder <scratch>/transfer/lr/runs/mixed
RECOVERY_LR_SCRATCH=<the scratch folder of ../learn/runs/README.md> bun lab/recovery-lr/kinds/runs/table.ts --mixed <that folder> --neutral <scratch>/transfer/lr/runs/neutral
```

The tables and a record per row and seed are in `<scratch>/transfer/lr/runs/mixed/`, with the logs in its folder `logs`. `runs/table.ts` scores every saved table itself on four sets of validation samples, also the tables of `../learn/runs/` that were trained on the dataset's train split, and it throws when a score that it makes for one of those on the dataset's validation split is not the one in that run's record. The bars are the ones of `../learn/runs/table.ts`, as the code had them at the commit 8233c23, with their counts made on the dataset's train samples.

The four sets: the mixed validation split (5000 samples, 773663 scored code points), its half with the dataset's damage (2500 samples, 336530 scored code points), its half with the kinds (2500 samples, 437133 scored code points), the dataset's own validation split (5000 samples, 678386 scored code points). A number with brackets is the mean of the seeds with the lowest and the highest. Every number is a percentage. The scores of the rows trained on the dataset's train split on the dataset's own validation split are the ones in their records.

| parser | seeds | all three: the mixed validation split | all three: its half with the dataset's damage | all three: its half with the kinds | all three: the dataset's own validation split | whole: the mixed validation split | whole: its half with the dataset's damage | whole: its half with the kinds | whole: the dataset's own validation split |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bar: the parser as it is |  | 1.95 | 2.06 | 1.88 | 2.02 | 0.28 | 0.00 | 0.56 | 0.00 |
| bar: skip every rejected token, dropped tokens shown as errors |  | 27.03 | 27.66 | 26.54 | 28.65 | 9.68 | 7.72 | 11.64 | 7.78 |
| bar: skip every rejected token, with the count |  | 27.54 | 28.46 | 26.84 | 29.42 | 12.64 | 11.56 | 13.72 | 11.54 |
| bar: panic mode, dropped tokens shown as errors |  | 69.67 | 59.44 | 77.55 | 60.28 | 39.66 | 21.48 | 57.84 | 22.30 |
| bar: panic mode, with the count |  | 70.03 | 60.04 | 77.72 | 60.83 | 42.42 | 26.48 | 58.36 | 27.44 |
| bar: panic mode that keeps the reductions made at a rejected token, with the count |  | 71.00 | 59.26 | 80.03 | 60.12 | 30.64 | 23.00 | 38.28 | 23.88 |
| bar: the nearest table to panic mode: pop where bison reports, dropped tokens shown as errors |  | 69.40 | 58.29 | 77.95 | 58.62 | 16.62 | 10.52 | 22.72 | 10.58 |
| bar: the nearest table to panic mode: pop where bison reports, with the count |  | 69.81 | 58.89 | 78.22 | 59.16 | 17.16 | 11.60 | 22.72 | 11.66 |
| bar: yacc error productions, with the count |  | 87.62 | 83.70 | 90.64 | 84.45 | 36.44 | 38.92 | 33.96 | 39.28 |
| bar: panic mode with a hand-written list of synchronizing tokens, with the count |  | 84.40 | 77.87 | 89.43 | 78.73 | 44.80 | 33.28 | 56.32 | 34.62 |
| bar: a table filled by hand-written rules, with the count |  | 89.28 | 87.52 | 90.63 | 88.03 | 47.62 | 48.04 | 47.20 | 48.66 |
| row 9, trained on the dataset's train split: training, then the count | 1, 2, 3, 4, 5 | 80.61 (78.36 to 85.31) | 82.25 (80.83 to 83.54) | 79.35 (76.45 to 87.25) | 82.87 (81.69 to 84.25) | 32.35 (30.42 to 33.92) | 35.16 (33.16 to 36.92) | 29.54 (25.72 to 30.92) | 35.88 (33.12 to 37.78) |
| row 10, trained on the dataset's train split: training, then the search, then the count | 1, 2, 3, 4, 5 | 83.09 (81.79 to 84.78) | 87.56 (87.07 to 87.98) | 79.65 (77.02 to 82.40) | 88.10 (87.71 to 88.50) | 42.64 (41.88 to 43.98) | 47.74 (46.76 to 49.60) | 37.53 (36.56 to 38.40) | 48.37 (47.62 to 49.84) |
| row 9, trained on the mixed train split: training, then the count | 1, 2, 3, 4, 5 | 88.51 (88.19 to 88.79) | 81.25 (80.20 to 81.75) | 94.09 (93.27 to 94.49) | 81.74 (81.09 to 82.16) | 39.46 (37.88 to 41.94) | 32.54 (29.24 to 35.08) | 46.38 (43.48 to 49.84) | 32.74 (30.20 to 34.64) |
| row 10, trained on the mixed train split: training, then the search, then the count | 1, 2, 3, 4, 5 | 91.94 (91.74 to 92.14) | 86.43 (86.09 to 86.76) | 96.18 (96.10 to 96.28) | 86.92 (86.65 to 87.22) | 51.10 (50.56 to 51.62) | 44.60 (43.28 to 46.32) | 57.59 (56.92 to 58.52) | 44.57 (43.66 to 45.66) |

What the table says:

- The dataset's damage alone does not cover the kinds. On the half of the validation split with the kinds, the tables trained on the dataset's train split have 79.65% of all three right in row 10 and 79.35% in row 9, below the bar of yacc error productions (90.64%) and the bar of hand-written rules (90.63%). Trained on the mixed train split, row 10 has 96.18% and row 9 has 94.09%, with all five seeds of row 10 between 96.10 and 96.28.
- The price on the dataset's own damage is about one point. On the dataset's own validation split, row 10 goes from 88.10% (87.71 to 88.50) to 86.92% (86.65 to 87.22), and row 9 from 82.87% to 81.74%. The mixed train split has half as many samples with the dataset's damage, 20,000 in the place of 40,000, and the same number of cells for both halves.
- Against the bars: trained on the mixed split, row 10 is above every bar on the mixed validation split (91.94% against 89.28% for the hand-written rules) and on its half with the kinds, and below the hand-written rules on the dataset's own validation split (86.92% against 88.03%), where the row trained on the dataset alone was level with that bar (88.10%). Whole samples follow the same order: 51.10% on the mixed validation split against 47.62% for the hand-written rules, and 44.57% on the dataset's own validation split against 48.66%.
- The tables trained on the dataset alone vary a lot between seeds on the kinds: row 9 goes from 76.45% to 87.25% on that half. What such tables do with a mistake they never saw depends on the seed.
- What this does not say: the half with the kinds in the validation split holds the same 34 kinds as the train split, on other programs. So 96% says that the recipe learns these kinds, and nothing about mistakes that other people write. No held-back set was read or scored here.

The runs one by one, from their records:

| row | seed | all three: mixed validation | its half with the dataset's damage | its half with the kinds | the dataset's own validation | all three on the mixed train split | cells changed | display entries changed | training, s | search, s | commit | sha256 of the tables |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 9 | 1 | 88.19 | 81.59 | 93.27 | 81.79 | 89.10 | 1890 | 2275 | 22 | 0 | d2fa1f7 | d424381ac6e31e59 |
| 9 | 2 | 88.26 | 80.20 | 94.47 | 81.09 | 89.07 | 1872 | 2241 | 25 | 0 | d2fa1f7 | 6e81225046066a3c |
| 9 | 3 | 88.65 | 81.07 | 94.49 | 81.65 | 89.41 | 1913 | 2254 | 23 | 0 | d2fa1f7 | 36c22bf0628ae53d |
| 9 | 4 | 88.79 | 81.75 | 94.22 | 82.16 | 89.86 | 1904 | 2290 | 49 | 0 | 12ba316 | 14155e6e915298fd |
| 9 | 5 | 88.63 | 81.64 | 94.01 | 81.99 | 89.23 | 1977 | 2230 | 55 | 0 | 12ba316 | 501bf6f05641d04e |
| 10 | 1 | 91.74 | 86.09 | 96.10 | 86.65 | 93.11 | 2298 | 2267 | 22 | 19 | d2fa1f7 | 02ffc8bafbe20637 |
| 10 | 2 | 92.07 | 86.67 | 96.22 | 87.01 | 93.17 | 2362 | 2235 | 25 | 21 | d2fa1f7 | 8af4596dec8f5a67 |
| 10 | 3 | 91.81 | 86.12 | 96.19 | 86.74 | 93.10 | 2384 | 2236 | 23 | 21 | d2fa1f7 | fe77c040b1c85147 |
| 10 | 4 | 91.93 | 86.49 | 96.12 | 87.00 | 93.20 | 2360 | 2276 | 49 | 30 | 12ba316 | 211caab628d3773d |
| 10 | 5 | 92.14 | 86.76 | 96.28 | 87.22 | 93.26 | 2377 | 2220 | 55 | 31 | 12ba316 | 3c4bbb75a8b3326c |

### Per kind

`bun lab/recovery-lr/kinds/runs/by-kind.ts --mixed <folder> --neutral <folder>` scores row 10 and two bars on the validation samples of each kind alone. The sets are small, 8 to 151 samples, so a line with few samples says little.

The samples of the mixed validation split that have one kind alone, and in the last line the ones with two kinds. Row 10 of the recipe, 5 seeds trained on the dataset's train split and 5 on the mixed train split: the mean with the lowest and the highest. Every number but the first two columns is the percentage of the scored code points with all three right.

| kind | samples | scored code points | bar: yacc error productions | bar: hand-written rules | row 10 trained on the dataset's train split | row 10 trained on the mixed train split |
| --- | --- | --- | --- | --- | --- | --- |
| doubleSemicolon | 151 | 22662 | 97.9 | 97.9 | 22.6 (21.0 to 24.4) | 97.6 (96.7 to 97.9) |
| inAfterTopDefinition | 108 | 15363 | 51.0 | 51.0 | 77.9 (50.9 to 97.6) | 97.4 (97.3 to 97.6) |
| sequenceSemicolon | 8 | 985 | 72.0 | 72.0 | 84.2 (82.4 to 84.8) | 76.9 (71.9 to 92.7) |
| typeAnnotation | 137 | 17447 | 96.4 | 100.0 | 97.7 (97.3 to 98.3) | 100.0 (100.0 to 100.0) |
| patternParameters | 84 | 15183 | 94.8 | 99.0 | 95.8 (95.8 to 95.8) | 100.0 (100.0 to 100.0) |
| floatNumber | 109 | 12440 | 100.0 | 100.0 | 97.6 (92.6 to 100.0) | 100.0 (99.9 to 100.0) |
| openLine | 57 | 14966 | 100.0 | 98.1 | 98.1 (98.1 to 98.1) | 99.6 (98.1 to 100.0) |
| doubleEquals | 72 | 14950 | 100.0 | 100.0 | 100.0 (100.0 to 100.0) | 100.0 (100.0 to 100.0) |
| bangEquals | 15 | 2753 | 100.0 | 100.0 | 98.6 (97.2 to 100.0) | 99.7 (98.8 to 100.0) |
| wordOperatorAsSign | 17 | 2551 | 100.0 | 100.0 | 99.1 (96.4 to 100.0) | 98.3 (92.9 to 99.9) |
| arrowFunction | 22 | 2697 | 91.7 | 95.0 | 83.2 (82.0 to 84.7) | 99.2 (97.5 to 100.0) |
| otherFunKeyword | 30 | 5799 | 90.6 | 99.5 | 98.8 (97.3 to 99.5) | 98.9 (97.5 to 99.6) |
| elif | 30 | 4108 | 49.7 | 49.7 | 50.1 (49.7 to 51.3) | 50.6 (49.8 to 51.6) |
| conditionWithoutThen | 63 | 7915 | 96.7 | 96.5 | 96.4 (95.9 to 96.6) | 98.2 (97.4 to 98.9) |
| otherDefinitionKeyword | 110 | 24588 | 75.5 | 64.1 | 87.6 (85.9 to 88.8) | 96.2 (95.5 to 97.9) |
| semicolonAfterDefinition | 129 | 20368 | 97.1 | 97.1 | 32.1 (15.5 to 95.8) | 97.0 (96.3 to 97.2) |
| bracesAroundBody | 71 | 10372 | 95.5 | 100.0 | 92.5 (90.0 to 94.3) | 99.3 (99.1 to 99.6) |
| singleQuoteString | 40 | 6449 | 94.2 | 94.3 | 90.9 (89.7 to 91.5) | 97.3 (96.5 to 97.9) |
| otherComment | 68 | 14599 | 95.3 | 91.2 | 90.0 (85.6 to 91.9) | 95.1 (94.7 to 95.4) |
| haskellOperator | 17 | 2660 | 100.0 | 99.5 | 99.6 (99.5 to 99.8) | 99.5 (99.3 to 100.0) |
| commaInList | 29 | 3973 | 100.0 | 100.0 | 85.4 (78.4 to 90.7) | 100.0 (100.0 to 100.0) |
| semicolonInTuple | 23 | 3410 | 83.5 | 83.5 | 86.4 (85.7 to 86.8) | 100.0 (99.8 to 100.0) |
| trailingSeparator | 51 | 6020 | 100.0 | 100.0 | 100.0 (100.0 to 100.0) | 100.0 (100.0 to 100.0) |
| tupleWithoutBrackets | 15 | 2767 | 88.0 | 97.8 | 97.8 (97.8 to 97.9) | 96.3 (93.6 to 97.8) |
| missingClosingBracket | 94 | 14097 | 100.0 | 100.0 | 100.0 (100.0 to 100.0) | 99.8 (99.8 to 100.0) |
| extraClosingBracket | 92 | 9798 | 85.3 | 91.7 | 96.6 (96.4 to 97.0) | 94.5 (93.7 to 95.2) |
| wrongClosingBracket | 64 | 6300 | 90.4 | 93.3 | 91.2 (88.9 to 92.9) | 99.0 (98.9 to 99.3) |
| missingIn | 20 | 4301 | 80.9 | 80.9 | 81.7 (80.0 to 84.3) | 82.3 (80.9 to 84.3) |
| unbracketedArgument | 20 | 3850 | 78.8 | 81.2 | 80.6 (78.8 to 81.9) | 88.0 (83.4 to 90.7) |
| unclosedString | 41 | 6026 | 82.3 | 82.3 | 82.0 (81.4 to 82.3) | 81.7 (81.4 to 82.0) |
| unfinishedDefinition | 52 | 7022 | 100.0 | 100.0 | 98.9 (97.5 to 100.0) | 100.0 (100.0 to 100.0) |
| codeFence | 89 | 21793 | 100.0 | 97.7 | 97.7 (96.8 to 98.4) | 100.0 (100.0 to 100.0) |
| mergeConflictMarkers | 36 | 6444 | 99.2 | 99.0 | 99.0 (99.0 to 99.0) | 99.1 (99.0 to 99.2) |
| toplevelPrompt | 72 | 19001 | 97.3 | 97.3 | 24.7 (23.4 to 26.3) | 97.0 (96.0 to 97.4) |
| two kinds | 464 | 103476 | 86.7 | 87.3 | 76.8 (73.4 to 79.5) | 93.3 (93.2 to 93.4) |

- Most of the gap between the two train sets comes from one mistake in four kinds: a `;`, a `;;` or an `in` after a definition at the top (`doubleSemicolon` 22.6% against 97.6%, `toplevelPrompt` 24.7% against 97.0%, `semicolonAfterDefinition` 32.1% against 97.0%, `inAfterTopDefinition` 77.9% against 97.4%). The tables trained on the dataset alone lose the rest of the program there, and in two of these kinds one seed of the five happens to get it right (95.8% and 97.6%). Both hand-made bars handle the `;` and not the `in`.
- Most other kinds are already above 90% with the dataset's damage alone, and the mixed train set adds a few points: `commaInList`, `semicolonInTuple`, `arrowFunction`, `bracesAroundBody`, `wrongClosingBracket`, `singleQuoteString`, `otherDefinitionKeyword`.
- Some kinds stay low for every parser here, the bars included: `elif` at 50%, `missingIn`, `unclosedString` and `unbracketedArgument` near 80%. For `unclosedString` part of the labels is out of every parser's reach (see "Known limits"). For `elif` the first error is the `then` after the `elif`, where the condition has already been read as an argument of the expression before it, and all four parsers score 50%. Whether tables can do better on `elif`, `missingIn` and `unbracketedArgument` was not looked at.
- On three kinds the tables trained on the mixed set are a little below the ones trained on the dataset alone: `extraClosingBracket` (94.5% against 96.6%), `tupleWithoutBrackets` and `sequenceSemicolon`, the last two on 15 and 8 samples.

Notes on the runs:

- The seeds 1 to 3 ran at the commit d2fa1f7 and the seeds 4 and 5 at 12ba316. Between the two, another agent added the folder `../learn/scale/` and changed no file that the recipe or this folder reads. The folder `runs/` itself was not committed yet when the runs started, which is why every record lists it among the files that differ from the commit.
- The seeds 4 and 5 took twice as long because other runs were using the machine at that time.
- While the table was being made, another agent had uncommitted changes in `../learn/data.ts` and `../learn/score.ts`. They change the upper bound that a score prints next to its row and add a counter, and not the columns of this table: the table's command checked that its scores of the dataset's rows on the dataset's validation split are the ones in their records, to four decimals of "all three".
- The yacc bar was changed by its author today (commit 2d51c26), so its numbers here can differ from an older table in `../learn/runs/README.md`.
- Seed 1 was run a second time, into `<scratch>/transfer/lr/runs/mixed-again/`, at the commit 8233c23 and with those uncommitted changes of the other agent loaded. The tables of both rows are the same byte for byte as the first time (sha256 d424381ac6e31e59… for row 9 and 02ffc8bafbe20637… for row 10). The other seeds were run once.
