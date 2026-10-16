# Kinds of mistakes written for miniml, and the mixed set

The dataset's damage (`../damage.ts`) knows nothing of the language: ten edits on code points and lines. This folder holds a second train set that was declared before any held-back test was scored: half of its samples keep that damage, and the other half have one or two kinds of mistakes that a person or a language model makes when writing a miniml program, e.g. `==` for `=`, `[1, 2]` for `[1; 2]`, a local definition without its `in`.

**The kinds were written by one agent in under an hour, under a hard deadline, and nobody reviewed them: not the list, not the weights, not the code, not this README.** The author read three samples of every kind (see "What was checked"), and that is all the reading they got. No list of kinds was given to the author, and the author read no held-back set.

## The files

- `kinds.ts`: the 34 kinds, each with a name, who makes the mistake, an example, and the code that applies it to a valid program as edits on its code points. It also holds `scanProgram`, which reads from a program what the kinds need: the tokens, which bracket closes which, the definitions at the top, the local definitions with their `in`, the functions.
- `mixed.ts`: `kindsSampleAt(seed, index)` makes the sample of this folder for a program, and `eachMixedSample`, `mixedPacked` and `prepareMixedRecipe` give the mixed set to the training.
- `check.ts`: the checks of the mixed set. `bun lab/recovery-lr/kinds/check.ts` takes 13 s and ends with one line that says whether every check passed.
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
