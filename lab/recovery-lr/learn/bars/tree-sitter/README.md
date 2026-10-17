# The bar "tree-sitter"

Row 8 of the final table: tree-sitter 0.24.5 parses the broken text with a grammar for the whole language, and the three values per code point are read off its tree. tree-sitter is a generalized LR parser that is made for broken text: at an error it goes on with several stacks at a time, each with another repair, and keeps the cheapest. It looks ahead and compares repairs, which one cell of a table cannot do, so it is in the table for reference.

**No number here is a result.** The scores are of the 5,000 validation samples and are here to show what the bar does.

## The grammar

`grammar.ts` has the rules of [`../../../grammar/miniml.y`](../../../grammar/miniml.y) one for one, under bison's names, so that a node of tree-sitter's tree is a reduction of bison's parser, e.g. `(binding (IDENT) (EQ) (expr ..))`. Three things differ, and none changes which texts are programs:

- **Every token comes from `scanner.c`**, which runs flex's table as `../../../parser.ts` does. tree-sitter's own scanner reads a keyword as a name wherever the keyword cannot stand: a probe with it takes `let then = 1` and `let if = then` as programs. With flex's table the parser reads the same tokens as bison's parser, also in broken text, and text that is no token is one of the three terminals that no rule has.
- **No empty rule.** tree-sitter has none, so `definitions` and `parameters` have one item or more, and the rules that use them say `optional`.
- **The precedence is written at the rules.** `tree-sitter generate` reports no conflict.

`build.ts` writes the grammar as JSON, runs `tree-sitter generate`, and compiles `driver.c` with the generated parser, `scanner.c` and `libtree-sitter.a`. The driver parses many texts in one process and prints every tree as numbers: 10,000 texts take under a second.

## The mapping from a tree to the three values

`outputOfTree` in `tree-sitter.ts`:

1. **The stack of a token** is what stands to its left in the tree and is not closed yet: for every node from the root down to the token, the children before the one that leads to the token, each as one symbol. A token is its terminal, and a child with children of its own is its nonterminal. For the `c` of `let x = if a then b else c` the stack is `definitions LET IDENT parameters EQ IF expr THEN expr ELSE IDENT`. This is the stack that bison's parser has right after it shifts the token, with three additions for the empty rules, which bison reduces before the next token: `definitions` lies below everything, `parameters` lies after the name of a binding, and `parameters` lies after the first parameter of a `fun`.
2. **The display kind, the depth, the container and the hash of the stack** are those of [`../../../labels.ts`](../../../labels.ts) for this stack, e.g. the depth is the number of `(`, `[`, `let`, `if` and `fun` on it.
3. **White space and comments** have their own kinds and the other values of the token before them.
4. **A token that the parser put in** is on the stack as its terminal, e.g. a `then` that is not in the text is the container of what follows it.
5. **An error node** stands on the stack that the parser had when it read the node's first token: the stack that the token before it left, after the reductions that the grammar's table makes at that first token, and without them when the table has no action for it there. The node's place in the tree does not say this. tree-sitter moves an error node of skipped tokens, like a comment, to the right of every node that closes after it: the `#` of `let x = 1 #` before a next `let` ends up after the whole definition, which was still open at the `#`. Inside the error node the children before a token are on the stack. When the error node ends, everything in it leaves the stack.
6. **A token that lies in an error node without a node between** is a dropped token: the stack does not count as holding it, and its display kind is the one of `dropped-kinds.json`, the count that every bar may use.

On a valid program the mapping gives the labels exactly, see the checks.

**The columns "stack" and "constituents".** Both are defined by the same mapping, since the grammar has bison's rules: the stack is point 1's, and every node that is no error node is a constituent with its nonterminal and the tokens of the text that it covers. Two things to know when reading them. The stack of a token inside an error node holds the node's earlier children, also tokens that the parser only skipped, so white space after a skipped token is never right in "stack". And a node counts as a constituent also when it lies inside an error node, where the parser has given it up.

**What was compared on train samples** (5,000), and nothing else of the mapping was: three readings of point 5. An error node on the stack of its place in the tree has 67.71 / 27.20 in all three and whole. On the stack that the token before it left, without the reductions, 66.84 / 28.56. Point 5 as it stands has 67.58 / 29.84. And the last sentence but one of point 5 the other way, so that the children of an error node do not see each other: 67.57 / 27.60.

## Scores on validation

5,000 validation samples, 0.8 s:

| parser | all three | whole | kind | depth | container | stack | whole by stack | constituents: found, right | the same without the ones before the first error | inserted per sample |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tree-sitter 0.24.5 | 66.90 | 29.20 | 93.3 | 69.1 | 90.4 | 60.95 | 13.02 | 91.9, 95.9 | 86.0, 93.1 | 0.10 |

Where the score goes:

- **The depth** is right at 69.1% of the scored code points, the kind at 93.3% and the container at 90.4%. tree-sitter is an LR parser: after `(1 + 2` a next `let` is a local definition for it, as for bison, and it reads on, one level too deep, until the text ends.
- **In 313 of the 5,000 samples the root of the tree is an error node**: the parser placed nothing, and the tree is the flat list of what was on its stack at the end. There 4.35% of the code points are right in all three. In the other 4,687 samples 74.01% are, and 31.15% of the samples are whole.
- **Tokens that lie directly in an error node** hold 61,841 scored code points, of which 13.8% are right in all three. Tokens in a node hold 418,632, of which 73.8% are right.
- A tree has 1.76 error nodes and 0.10 tokens that the parser put in on average.

## The function for the final scoring

```ts
import {outputsOfTreeSitter, scoreOfTreeSitter} from './lab/recovery-lr/learn/bars/tree-sitter/tree-sitter.ts'

outputsOfTreeSitter(samples: readonly Pick<Sample, 'codePoints' | 'tokens'>[]): ParserOutput[]   // one output per sample, in order
scoreOfTreeSitter(samples: readonly Sample[]): Score
```

A `ParserOutput` is the one of [`../../score.ts`](../../score.ts). The function needs tree-sitter 0.24.5 at `/opt/homebrew` (the program, `libtree-sitter.a` and the headers), `cc`, and `RECOVERY_LR_SCRATCH` set to a folder outside the repo: the first call builds the parser there, in under a second, and later calls use it until a source changes.

## What was checked

`check.ts`, about 15 s:

- **The rules**: the 53 right sides of `grammar.ts` are bison's 50 rules with its 2 empty rules written as `optional`.
- **The same texts are programs** for tree-sitter and for bison's parser, on 293,985 texts: 27,562 programs and 266,423 that are none. They are the texts that `../../../check-tools.ts` compares the plain parser with the C code on (6,000 generated programs, 12,000 damaged ones of which 5,844 are still programs, 3,000 random sentences of the grammar and 3,000 damaged ones, 3,000 random texts, texts by hand, a text for every cell of the parser's table, 178,089 texts through every cell of the scanner, every text of up to 3 code points), and the broken texts and the originals of 5,000 train and 5,000 validation samples. tree-sitter takes a text as a program when its tree has no error node and no token that the parser put in.
- **The tokens**: every token of every one of these trees is a token of the scanner, 6,288,793 in all.
- **Valid programs**: on 9,000 (6,000 of the generator, 3,000 random sentences of the grammar) the mapping gives the labels at all 2,013,243 code points, with the hash of the stack, and the tree has the 895,718 reductions of the plain parser that cover a token.
- **A known repair**: 400 programs with a `#` between two tokens. tree-sitter skips the `#`, and the mapping has every scored code point right in all three and exactly the original's constituents. The stack is right at 99.75%, for the reason above. With an error node read by its place in the tree, 14 samples are not whole.
- `dropped-kinds.json` is what the count gives today.

## Five broken programs

The five of [`../repair/examples.ts`](../repair/examples.ts), written by the author of this bar with the program that was meant. They chose nothing. `show.ts` prints them with tree-sitter's tree under each, and `show.ts --validation 0` validation samples. Under the text: `.` a scored code point that is right in all three, `X` one that is not, `+` an added code point, then the bar's output with the wanted label under it, and `d` for a dropped token. The letters are those of [`../repair/README.md`](../repair/README.md).

```
--- a missing `in`
meant: "let area w h =\n  let twice = 2 * w in\n  twice * h\nlet unit = area 1 1\n"
text             let area w h =⏎  let twice = 2 * w⏎  twice * h⏎let unit = area 1 1⏎
right                                                           XXXXXXXXXXXXXXXXXXXX
kind             kkkwddddwawawpwwwkkkwdddddwpwlwownwwwnnnnnwcwnwkkkwddddwpwnnnnwlwlw
kind wanted      kkkwddddwawawpwwwkkkwdddddwpwlwownwwwnnnnnwownwkkkwddddwpwnnnnwlwlw
depth            1111111111111111122222222222222222222222222222233333333333333333333
depth wanted     1111111111111111122222222222222222222222222222211111111111111111111
container        lllllllllllll====llllllllll====================lllllllll===========
container wanted lllllllllllll====llllllllll=======nnnnnnnnnnnnnlllllllll===========
dropped          ddd dddd     d   ddd ddddd d               d   ddd
0 of 20 scored code points right in all three, 0 in the stack; constituents: 21 of the original's 34 found, 21 of the parse's 24 are the original's; 0 tokens put in
(program (ERROR (LET) (IDENT) (parameters (parameters (parameter (IDENT))) (parameter (IDENT))) (EQ) (LET) (IDENT) (EQ) (expr (expr (application (atom (INT)))) (STAR) (expr (application (application (atom (IDENT))) (atom (IDENT))))) (STAR) (ERROR (application (atom (IDENT)))) (LET) (binding (IDENT) (EQ) (expr (application (application (application (atom (IDENT))) (atom (INT))) (atom (INT)))))))

--- a missing `then`
meant: "let sign n = if n < 0 then 0 - 1 else 1\n"
text             let sign n = if n < 0 0 - 1 else 1⏎
right                                        .....XX
kind             kkkwddddwawpwkkwnwowlwlwowlwkkkkwlw
kind wanted      kkkwddddwawpwkkwnwowlwlwowlwkkkkwlw
depth            11111111111112222222222222222222222
depth wanted     11111111111112222222222222222222222
container        lllllllllll==iiiiiiiiiiiiiiieeeeeii
container wanted lllllllllll==iiiiiiiiitttttteeeeeee
dropped          ddd dddd   d dd             dddd
5 of 7 scored code points right in all three, 0 in the stack; constituents: 12 of the original's 24 found, 12 of the parse's 18 are the original's; 0 tokens put in
(program (ERROR (LET) (IDENT) (parameters (parameter (IDENT))) (EQ) (IF) (expr (expr (application (atom (IDENT)))) (LT) (expr (expr (application (application (atom (INT))) (atom (INT)))) (MINUS) (expr (application (application (atom (INT))) (ERROR (ELSE)) (atom (INT))))))))

--- a bracket that is not closed
meant: "let total = add (mul 2 3) 4\nlet next = total + 1\n"
text             let total = add (mul 2 3 4⏎let next = total + 1⏎
right                                       .....................
kind             kkkwdddddwpwnnnwpnnnwlwlwlwkkkwddddwpwnnnnnwowlw
kind wanted      kkkwdddddwpwnnnwpnnnwlwlwlwkkkwddddwpwnnnnnwowlw
depth            111111111111111122222222222111111111111111111111
depth wanted     111111111111111122222222211111111111111111111111
container        llllllllll======(((((((((((lllllllll============
container wanted llllllllll======(((((((((==lllllllll============
dropped
21 of 21 scored code points right in all three, 21 in the stack; constituents: 25 of the original's 28 found, 25 of the parse's 28 are the original's; 1 tokens put in
(program (definitions (definitions (definition (LET) (binding (IDENT) (EQ) (expr (application (application (atom (IDENT))) (atom (LPAREN) (expr (application (application (application (application (atom (IDENT))) (atom (INT))) (atom (INT))) (atom (INT)))) (MISSING RPAREN))))))) (definition (LET) (binding (IDENT) (EQ) (expr (expr (application (atom (IDENT)))) (PLUS) (expr (application (atom (INT)))))))))

--- a bracket too many
meant: "let scale k v = k * (v + 1)\nlet zero = scale 0 0\n"
text             let scale k v = k * (v + 1))⏎let zero = scale 0 0⏎
right                                       +......................
kind             kkkwdddddwawawpwnwowpnwowlppwkkkwddddwpwnnnnnwlwlw
kind wanted      kkkwdddddwawawpwnwowpnwowlp wkkkwddddwpwnnnnnwlwlw
depth            11111111111111111111222222222111111111111111111111
depth wanted     111111111111111111112222222 2111111111111111111111
container        llllllllllllll======(((((((((lllllllll============
container wanted llllllllllllll======((((((( (lllllllll============
dropped                                     d
22 of 22 scored code points right in all three, 21 in the stack; constituents: 32 of the original's 32 found, 32 of the parse's 32 are the original's; 0 tokens put in
(program (definitions (definitions (definition (LET) (binding (IDENT) (parameters (parameters (parameter (IDENT))) (parameter (IDENT))) (EQ) (expr (expr (application (atom (IDENT)))) (STAR) (expr (application (atom (LPAREN) (expr (expr (application (atom (IDENT)))) (PLUS) (expr (application (atom (INT))))) (RPAREN)))))))) (ERROR (RPAREN)) (definition (LET) (binding (IDENT) (EQ) (expr (application (application (application (atom (IDENT))) (atom (INT))) (atom (INT))))))))

--- `==` for `=` and `thn` for `then`
meant: "let rec fact n = if n = 0 then 1 else n * fact (n - 1)\n"
text             let rec fact n = if n == 0 thn 1 else n * fact (n - 1)⏎
right                                   +X..XXXXXX.....XXXXXXXXX........
kind             kkkwkkkwddddwawpwkkwnwopwlwnnnwlwkkkkwnwownnnnwpnwowlpw
kind wanted      kkkwkkkwddddwawpwkkwnwo wlwkkkwlwkkkkwnwownnnnwpnwowlpw
depth            1111111111111111122222222222222222222222222222233333333
depth wanted     11111111111111111222222 2222222222222222222222233333333
container        lllllllllllllll==iiiiii==iiiiiiiieeeeeiiiiiiiii((((((((
container wanted lllllllllllllll==iiiiii iiitttttteeeeeeeeeeeeee((((((((
dropped          ddd ddd dddd   d dd    d         dddd
15 of 31 scored code points right in all three, 2 in the stack; constituents: 22 of the original's 33 found, 22 of the parse's 27 are the original's; 0 tokens put in
(program (ERROR (LET) (REC) (IDENT) (parameters (parameter (IDENT))) (EQ) (IF) (expr (expr (application (atom (IDENT)))) (EQ) (ERROR (EQ)) (expr (expr (application (application (application (application (atom (INT))) (atom (IDENT))) (atom (INT))) (ERROR (ELSE)) (atom (IDENT)))) (STAR) (expr (application (application (atom (IDENT))) (atom (LPAREN) (expr (expr (application (atom (IDENT)))) (MINUS) (expr (application (atom (INT))))) (RPAREN))))))))
```

What they show: tree-sitter closes an open bracket and skips a bracket too many as a person would. Where a keyword is missing it skips the keyword that does not fit, e.g. the `else`, and then cannot close the `if` or the definition around it: the whole text ends up in one error node. After the missing `in` it reads the next `let` as a local definition, as bison does.

## Effort, and what else was tried

About four hours of an agent's work. The grammar is bison's and has nothing that is there for recovery. tree-sitter has no setting for its recovery. What an author can choose is the form of the grammar and the mapping:

- **The form of the grammar.** A probe with a second grammar for the same language, written the way tree-sitter grammars usually are (lists with `repeat`, hidden rules for "an expression" and "an atom", one node per construct), gave the same verdicts on 27,000 texts and as many error nodes in broken text, 1.77 per sample with both. With one reading of the depth that fits both grammars (the opening tokens to the left of a token that are not inside a closed node), the depth is right at 69.58% of the scored code points of 5,000 train samples with that grammar and at 69.29% with this one. So the bar stays with bison's rules, which also give the columns "stack" and "constituents". The probe is not in the repo. Its files are in the scratch folder of this bar, under `variant/`.
- **The mapping.** See the readings of point 5 above. A mapping that parses the inside of an error node anew, e.g. "a `let` at the start of a line closes everything", would be a recovery of its author's and not tree-sitter's, and is not here.

## Caveats

- **tree-sitter's own scanner is not in the bar.** It reads a token by what the parser can take at that place, which can help and can hurt in broken text. With flex's table the bar answers "tree-sitter's parser and recovery on bison's tokens".
- **The mapping is the author's.** tree-sitter has no notion of the three values. Points 1 to 4 are fixed by the valid programs. Points 5 and 6 are a reading of what an error node means, and another reading gives up to a point less or more, see above.
- **What stands before the first error can differ from bison's.** Where the root is an error node, no token before the first error is in a node either. A score does not count those code points.

## Commands

Run from the repo root, with `RECOVERY_LR_SCRATCH` set to a folder outside the repo.

```sh
bun lab/recovery-lr/learn/bars/tree-sitter/build.ts                              # builds the parser in <RECOVERY_LR_SCRATCH>/tree-sitter
bun lab/recovery-lr/learn/bars/tree-sitter/tree-sitter.ts [--validation <samples>]   # the score on validation
bun lab/recovery-lr/learn/bars/tree-sitter/check.ts [--skip-without-tools]       # the checks, about 15 s
bun lab/recovery-lr/learn/bars/tree-sitter/show.ts [--validation <first sample>] [--count <samples>]
bun lab/recovery-lr/learn/bars/tree-sitter/count.ts                              # writes dropped-kinds.json
```

## Files

- `grammar.ts`: the grammar. `scanner.c`: flex's table as tree-sitter's scanner. `driver.c`: many texts in, trees as numbers out. `build.ts`: `tree-sitter generate` and `cc`.
- `trees.ts`: `treesOf(texts)`, `printedTreesOf(texts)`, `treeIsValid(tree)`.
- `tree-sitter.ts`: the mapping (`outputOfTree`) and the functions for the final scoring.
- `dropped-kinds.json`, `count.ts`, `check.ts`, `show.ts`.
