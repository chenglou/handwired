# miniml

miniml is a small language that looks like OCaml. Only its syntax exists: a text is a valid program when the parser accepts it. Nothing checks names or types, so `let x = 1 2` is a valid program. Every example on this page is checked with the parser by `check-language.ts`.

## A program

A program is a list of definitions, one after another. Nothing stands between two definitions and nothing after the last one: no `;`, no `;;`, no `in`. The empty text is a valid program too.

```miniml
let limit = 10
let rec count n = if n = 0 then 0 else 1 + count (n - 1)
let () = print_int (count limit)
```

A definition is `let`, then an optional `rec`, then what it defines, then `=`, then one expression. It defines one of three things:

- a name with zero or more parameters, e.g. `let total = 0` and `let add x y = x + y`
- `_`, e.g. `let _ = run 1`
- `()`, e.g. `let () = main ()`

A parameter is a name, `_` or `()`, e.g. `let f x _ () = x`. Only a name takes parameters. There is no other pattern, e.g. no `(a, b)` and no `(x)` as a parameter.

An expression alone is no program: every program starts with `let`. A definition ends where the next definition starts, or at the end of the text. A `let` after a whole expression starts the next definition. A `let` where an expression has to come starts a local definition, see below, which needs its `in`. Line breaks and indentation mean nothing:

```miniml
let a = 1 let b =
  2
```

## Expressions

The smallest expressions are atoms:

- an integer, e.g. `42`
- a string, e.g. `"hello"`
- a name, e.g. `count`
- `true` and `false`
- `()`
- an expression in brackets, e.g. `(n - 1)`
- a tuple of two or more expressions, always in brackets, with `,` between them, e.g. `(a, b)` and `(1, "one", [])`
- a list in square brackets, with `;` between its expressions and none after the last, e.g. `[]`, `[1]` and `[a; b + 1; f c]`

Larger expressions:

- An application is two or more atoms side by side: the first is applied to the others, e.g. `f x y` and `print_string "done"`. Whatever is no atom needs brackets to be an argument, e.g. `f (g x) (-1) (fun y -> y)`.
- A negation is `-` before an expression, e.g. `-x` and `- f x`, which negates `f x`.
- An operation has an operator between two expressions, e.g. `a + b`. The operators are listed below.
- A conditional is `if` condition `then` expression, with or without `else` expression, e.g. `if a then b else c` and `if a then b`. An `else` belongs to the nearest `if` that has none.
- A function is `fun`, one or more parameters, `->` and an expression, e.g. `fun x -> x + 1` and `fun x _ () -> x`.
- A local definition is a definition followed by `in` and an expression, e.g. `let y = 2 in y * y` and `let rec go n = go (n - 1) in go 3`. It takes the same three forms as a definition at the top.

```miniml
let rec map f xs =
  if xs = [] then []
  else
    let rest = map f (tail xs) in
    f (head xs) :: rest

let pairs = [(1, "one"); (2, "two")]
let negate = fun x -> -x
let _ = map negate [1; 2; 3]
```

A conditional, a function and a local definition reach as far to the right as they can. They can stand without brackets wherever a whole expression has to come, e.g. after `=`, `then`, `else`, `->`, `in`, `(`, `[`, `,` and `;`, and also as the right side of an operator and after the `-` of a negation. As an argument and as the left side of an operator they need brackets.

```miniml
let a = 1 + if c then 2 else 3
let b = (if c then 2 else 3) + 1
let d = f (fun x -> x) (let y = 1 in y)
let e = [if c then 1; fun x -> x; let y = 1 in y]
```

## Operators

From the loosest to the tightest. Operators of one row bind equally.

| operators | meaning in OCaml | groups from |
| --- | --- | --- |
| `\|\|` | or | the right |
| `&&` | and | the right |
| `=` `<>` `<` `<=` `>` `>=` | comparisons | the left |
| `^` | string concatenation | the right |
| `::` | list construction | the right |
| `+` `-` | | the left |
| `*` `/` | | the left |
| `-` before an expression | negation | |
| application | | the left |

A conditional, a function and a local definition are looser than every operator: what follows them belongs to them.

| written | read as |
| --- | --- |
| `a + b * c` | `a + (b * c)` |
| `a - b - c` | `(a - b) - c` |
| `a / b * c` | `(a / b) * c` |
| `a :: b :: c` | `a :: (b :: c)` |
| `a + b :: c` | `(a + b) :: c` |
| `a ^ b ^ c` | `a ^ (b ^ c)` |
| `a ^ b :: c` | `a ^ (b :: c)` |
| `a :: b ^ c` | `(a :: b) ^ c` |
| `a < b = c` | `(a < b) = c` |
| `a ^ b = c + d` | `(a ^ b) = (c + d)` |
| `a = b && c <> d` | `(a = b) && (c <> d)` |
| `a && b && c` | `a && (b && c)` |
| `a \|\| b && c \|\| d` | `a \|\| ((b && c) \|\| d)` |
| `f a b` | `(f a) b` |
| `f a + g b` | `(f a) + (g b)` |
| `f a :: g b` | `(f a) :: (g b)` |
| `-a * b` | `(-a) * b` |
| `-f a` | `-(f a)` |
| `a - -b` | `a - (-b)` |
| `- -a` | `-(-a)` |
| `f -1` | `(f) - (1)` |
| `if a then b else c + d` | `if a then b else (c + d)` |
| `if a then b + c` | `if a then (b + c)` |
| `if a then if b then c else d` | `if a then (if b then c else d)` |
| `if a then b else if c then d else e` | `if a then b else (if c then d else e)` |
| `fun x -> x + 1` | `fun x -> (x + 1)` |
| `fun x -> fun y -> x y` | `fun x -> (fun y -> (x y))` |
| `let y = a in y + b` | `let y = a in (y + b)` |
| `a + let y = b in y * c` | `a + (let y = b in (y * c))` |
| `a * if b then c else d + e` | `a * (if b then c else (d + e))` |
| `- if a then b else c + d` | `-(if a then b else (c + d))` |
| `if a then b else c d` | `if a then b else (c d)` |
| `(a, b + c, d)` | `(a, (b + c), d)` |
| `[a; b :: c; d e]` | `[a; (b :: c); (d e)]` |

## Tokens

- A name starts with a letter or `_` and goes on with letters, digits, `_` and `'`, e.g. `x`, `x'`, `max_depth`, `Some`, `_tmp`, `item2`. Letters are `a` to `z` and `A` to `Z`. `_` alone is no name: it only stands for what a definition defines and for a parameter.
- The keywords are `let`, `rec`, `in`, `if`, `then`, `else`, `fun`, `true`, `false`. A keyword is no name. A longer word is a name, e.g. `letter` and `iff`.
- An integer is one or more digits, e.g. `0` and `007`. There is no other number: no sign, no `.`, no exponent.
- A string stands between two `"` on one line. Inside it, `\` takes the next character with it, e.g. `"say \"hi\""`, `"a\\b"` and `"tab\there"`. Every other character can be in a string, e.g. `"é (* no comment *)"`.
- A comment is `(*` up to the next `*)`, e.g. `(* note *)`. It can stand wherever white space can, and can go over several lines. Comments do not nest: the first `*)` ends the comment. `(*)` starts a comment too.
- White space is spaces, tabs, line feeds and carriage returns. It separates two tokens that would otherwise read as one, e.g. `let x`, and is free everywhere else, e.g. `f(1)` and `a+b`.
- A token is as long as it can be, e.g. `<=`, `<>`, `->`, `::`, `&&` and `||` are one token each, and `a<-b` is `a < -b`.

Every other character outside a string and a comment is an error wherever it stands, e.g. `.`, `!`, `:`, `|`, `&`, `#`, `@`, `%`, `~`, `{`, `}`, `\`, a backtick, a `'` that is not inside a name, and a letter such as `é`. So is a string or a comment that is not closed.

```miniml
(* A comment before the first definition. *)
let greet name = "hello, " ^ name ^ "!"   (* and one after an expression *)
let x' = greet (* in the middle *) "a \"quoted\" word"
let lines = [ "one" ;
  "two" ]
```

## What is not in the language

| not a program | why |
| --- | --- |
| `count 3` | an expression alone, without `let` |
| `let x = 1;; let y = 2` | nothing stands between definitions |
| `let x = 1; let y = 2` | the same: `;` only separates the expressions of a list |
| `let x = 1 in` | a definition at the top has no `in` |
| `let x = let y = 1` | a local definition needs `in` and an expression |
| `let x` | a definition needs `=` and an expression |
| `let x =` | the expression is missing |
| `let _ y = 1` | `_` and `()` take no parameters |
| `let (a, b) = pair` | no patterns: a definition defines a name, `_` or `()` |
| `let f (x) = x` | a parameter is a name, `_` or `()` |
| `let f x : int = x` | no types |
| `let x = (y : int)` | no types |
| `let x = fun -> 1` | a function has at least one parameter |
| `let x = fun (a, b) -> a` | no patterns as parameters |
| `let x = function a -> a` | no `function`: here it is a name, and `->` cannot follow |
| `let x = match a with b -> c` | no `match` |
| `let x = _` | `_` is no expression |
| `let true = 1` | a keyword is no name |
| `let x = a, b` | a tuple needs its brackets |
| `let x = (a,)` | no `,` after the last expression |
| `let x = [a; b;]` | no `;` after the last expression |
| `let x = [a, b]` | the expressions of a list are separated by `;` |
| `let x = (a; b)` | no sequence of expressions |
| `let x = if a then b; c` | the same |
| `let x = f if a then b else c` | an argument is an atom: brackets are missing |
| `let x = f fun y -> y` | the same |
| `let x = f let y = 1 in y` | the same |
| `let x = a == b` | equality is `=` |
| `let x = a != b` | inequality is `<>` |
| `let x = a => b` | no such operator |
| `let x = a ** b` | no such operator |
| `let x = a +. b` | no floats and no `.` |
| `let x = 1.5` | the same |
| `let x = a.b` | no fields |
| `let x = !a` | no `!` |
| `let x = a := b` | no `:` |
| `let x = a @ b` | no `@` |
| `let x = (+) 1 2` | an operator is no expression |
| `let x = * 2` | only `-` can stand before an expression |
| `let x = 'a'` | no characters: `'` is only part of a name |
| `let x = {a = 1}` | no records |
| `let x = "open` | the string is not closed on its line |
| `let x = 1 (* open` | the comment is not closed |
| `let x = (* a (* b *) c *) 1` | comments do not nest: the first `*)` ends the comment, and `c *) 1` is left |
| `let x = (1` | a bracket is not closed |
| `let x = 1)` | a bracket too many |
| `let x = if a then b else` | the expression after `else` is missing |
| `let x = fun y ->` | the expression after `->` is missing |
| `let x = 1 +` | the right side is missing |
| `let é = 1` | a name has the letters `a` to `z` and `A` to `Z` only |

Two more, which a table cannot hold: a line break inside a string, and a lone `|` or `&`.

```miniml-invalid
let x = "a
let x = a | b
let x = a & b
```

Words that are keywords in OCaml and not here are plain names, and two atoms side by side are always an application. So these are valid programs, whatever they would mean:

```miniml
let a = begin x end
let b = not x mod 2
let c = 1e5
let d = 1 2 "three" [] ()
let rec f x = 1 and g y = 2
let e = f(1)[2]
let g = x <- 1
```
