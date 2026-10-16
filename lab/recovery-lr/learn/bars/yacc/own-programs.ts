// Broken programs of the author of the two hand-made bars (yacc error productions and panic mode with a list of
// synchronizing tokens), to choose the bars' details with. They are what the author takes for typical mistakes of
// someone who writes miniml, e.g. a missing `in`, next to the neutral damage of the train samples. They come from
// the author's own list below and from LANGUAGE.md's table of what is not in the language, and from nothing else:
// not from the sets that are held back for the final scoring, and not from anyone else's list of mistakes.
//
//   ownSamples(perMistake)   for every mistake of the list, `perMistake` samples: a valid program of the
//                            generator with the one mistake put in at a random place
//   writtenSamples()         the pairs that are written out below, a broken program and the program that was meant
//
//   bun lab/recovery-lr/learn/bars/yacc/own-programs.ts   prints how many samples every mistake gives, and one of each
import {programAt, splitOfTokens} from '../../../dataset.ts'
import {onOneLine} from '../../../dump.ts'
import {type ValidLabels, displayKind} from '../../../labels.ts'
import {codePointsOf, textOf} from '../../../parser.ts'
import {type Random, createRandom} from '../../../random.ts'
import {type Sample, alignmentOfTexts, makeSample} from '../../../sample.ts'
import {isTrivia, newlineKind, symbolOf} from '../../../tables.ts'

// The seed of the programs that the mistakes are put into. It is not the dataset's seed, so the programs are not
// the originals of the train and validation samples. Only programs whose tokens are in the train split are used.
const programSeed = 4242

const terminal = (name: string): number => symbolOf(name)
const LET = terminal('LET'), IN = terminal('IN'), IF = terminal('IF'), THEN = terminal('THEN'), ELSE = terminal('ELSE'), FUN = terminal('FUN'), REC = terminal('REC')
const IDENT = terminal('IDENT'), INT = terminal('INT'), STRING = terminal('STRING'), EQ = terminal('EQ'), NE = terminal('NE'), ARROW = terminal('ARROW')
const LPAREN = terminal('LPAREN'), RPAREN = terminal('RPAREN'), LBRACK = terminal('LBRACK'), RBRACK = terminal('RBRACK'), COMMA = terminal('COMMA'), SEMI = terminal('SEMI')
const operators = ['NE', 'LT', 'LE', 'GT', 'GE', 'PLUS', 'MINUS', 'STAR', 'SLASH', 'CONS', 'AND', 'OR', 'CARET'].map(terminal)
const keywords = [LET, IN, IF, THEN, ELSE, FUN, REC]

// A valid program as an edit sees it: its labels, and the places of its tokens that are no white space and no
// comment, in order.
type Program = {labels: ValidLabels, real: number[]}
// An edit of a program's text: at the code point `at`, `remove` code points are taken out and `insert` is put in.
type Edit = {at: number, remove: number, insert: string}

const kindOf = (program: Program, token: number): number => program.labels.tokens.kind[token]!
const startOf = (program: Program, token: number): number => program.labels.tokens.start[token]!
const endOf = (program: Program, token: number): number => startOf(program, token) + program.labels.tokens.length[token]!
const textOfToken = (program: Program, token: number): string => textOf(program.labels.codePoints.subarray(startOf(program, token), endOf(program, token)))
// The display kind, the depth and the container that the labels give a token.
const labelKindOf = (program: Program, token: number): number => program.labels.kind[startOf(program, token)]!
const depthOf = (program: Program, token: number): number => program.labels.depth[startOf(program, token)]!
// The tokens with one of the given terminals that `also` holds for.
const tokensOf = (program: Program, terminals: readonly number[], also: (token: number, place: number) => boolean = () => true): number[] =>
  program.real.filter((token, place) => terminals.includes(kindOf(program, token)) && also(token, place))
const removeToken = (program: Program, token: number): Edit => ({at: startOf(program, token), remove: endOf(program, token) - startOf(program, token), insert: ''})
const replaceToken = (program: Program, token: number, insert: string): Edit => ({...removeToken(program, token), insert})
const insertBefore = (program: Program, token: number, insert: string): Edit => ({at: startOf(program, token), remove: 0, insert})
const insertAfter = (program: Program, token: number, insert: string): Edit => ({at: endOf(program, token), remove: 0, insert})
// The token before and after a token among the tokens that are no white space and no comment, -1 for none.
const before = (program: Program, place: number): number => place > 0 ? program.real[place - 1]! : -1
const after = (program: Program, place: number): number => place + 1 < program.real.length ? program.real[place + 1]! : -1
const isTopLevelLet = (program: Program, token: number): boolean => kindOf(program, token) === LET && depthOf(program, token) === 1
// The place of the bracket that closes the bracket at `place`, -1 for none.
function closingOf(program: Program, place: number): number {
  let open = 0
  for (let at = place; at < program.real.length; at++) {
    const kind = kindOf(program, program.real[at]!)
    if (kind === LPAREN || kind === LBRACK) open++
    if (kind === RPAREN || kind === RBRACK) open--
    if (open === 0) return at
  }
  return -1
}

// One edit at a random one of the tokens, or undefined when the program has no such token.
const atOneOf = (random: Random, tokens: readonly number[], edit: (token: number) => Edit): Edit[] | undefined => tokens.length === 0 ? undefined : [edit(random.pick(tokens))]

// A word with two neighbouring letters swapped or one letter left out, e.g. `thne` or `ten` for `then`.
function misspelt(word: string, random: Random): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const at = random.integer(0, word.length - 1)
    const result = random.chance(0.5) && at + 1 < word.length ? word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2) : word.slice(0, at) + word.slice(at + 1)
    if (result !== word && result !== '' && !['let', 'rec', 'in', 'if', 'then', 'else', 'fun', 'true', 'false'].includes(result)) return result
  }
  return `${word}x`
}

// The author's list of typical mistakes. Each gives the edits of one mistake at a random place of a program, or
// undefined when the program has no place for it.
type Mistake = {name: string, edits: (program: Program, random: Random) => Edit[] | undefined}
const mistakes: Mistake[] = [
  {name: 'a missing in', edits: (program, random) => atOneOf(random, tokensOf(program, [IN]), token => removeToken(program, token))},
  {name: 'a missing then', edits: (program, random) => atOneOf(random, tokensOf(program, [THEN]), token => removeToken(program, token))},
  {name: 'a missing else', edits: (program, random) => atOneOf(random, tokensOf(program, [ELSE]), token => removeToken(program, token))},
  // The `()` of a unit value stays whole in the four mistakes with round brackets.
  {name: 'a missing )', edits: (program, random) => atOneOf(random, tokensOf(program, [RPAREN], (_, place) => kindOf(program, before(program, place)) !== LPAREN), token => removeToken(program, token))},
  {name: 'a missing (', edits: (program, random) => atOneOf(random, tokensOf(program, [LPAREN], (_, place) => after(program, place) !== -1 && kindOf(program, after(program, place)) !== RPAREN), token => removeToken(program, token))},
  {name: 'a ) too many', edits: (program, random) => atOneOf(random, tokensOf(program, [RPAREN], (_, place) => kindOf(program, before(program, place)) !== LPAREN), token => insertAfter(program, token, ')'))},
  {name: 'a missing ]', edits: (program, random) => atOneOf(random, tokensOf(program, [RBRACK]), token => removeToken(program, token))},
  {name: 'a missing [', edits: (program, random) => atOneOf(random, tokensOf(program, [LBRACK]), token => removeToken(program, token))},
  {name: 'a missing = in a definition', edits: (program, random) => atOneOf(random, tokensOf(program, [EQ], token => labelKindOf(program, token) === displayKind.punctuation), token => removeToken(program, token))},
  {name: 'a missing let at the top', edits: (program, random) => atOneOf(random, tokensOf(program, [LET], token => isTopLevelLet(program, token)), token => removeToken(program, token))},
  {name: ';; after a definition', edits: (program, random) => atOneOf(random, tokensOf(program, [LET], (token, place) => isTopLevelLet(program, token) && place > 0), token => insertAfter(program, before(program, program.real.indexOf(token)), ';;'))},
  {name: '; after a definition', edits: (program, random) => atOneOf(random, tokensOf(program, [LET], (token, place) => isTopLevelLet(program, token) && place > 0), token => insertAfter(program, before(program, program.real.indexOf(token)), ';'))},
  {name: 'in after a definition at the top', edits: (program, random) => atOneOf(random, tokensOf(program, [LET], (token, place) => isTopLevelLet(program, token) && place > 0), token => insertAfter(program, before(program, program.real.indexOf(token)), ' in'))},
  {name: ', between the elements of a list', edits: (program, random) => atOneOf(random, tokensOf(program, [SEMI]), token => replaceToken(program, token, ','))},
  {name: '; between the parts of a tuple', edits: (program, random) => atOneOf(random, tokensOf(program, [COMMA]), token => replaceToken(program, token, ';'))},
  {name: '; after the last element of a list', edits: (program, random) => atOneOf(random, tokensOf(program, [RBRACK], (_, place) => kindOf(program, before(program, place)) !== LBRACK), token => insertBefore(program, token, ';'))},
  {name: '== for =', edits: (program, random) => atOneOf(random, tokensOf(program, [EQ], token => labelKindOf(program, token) === displayKind.operator), token => replaceToken(program, token, '=='))},
  {name: '!= for <>', edits: (program, random) => atOneOf(random, tokensOf(program, [NE]), token => replaceToken(program, token, '!='))},
  {name: '=> for ->', edits: (program, random) => atOneOf(random, tokensOf(program, [ARROW]), token => replaceToken(program, token, '=>'))},
  {name: 'a missing ->', edits: (program, random) => atOneOf(random, tokensOf(program, [ARROW]), token => removeToken(program, token))},
  {name: 'a misspelt keyword', edits: (program, random) => atOneOf(random, tokensOf(program, keywords), token => replaceToken(program, token, misspelt(textOfToken(program, token), random)))},
  {name: 'a keyword twice', edits: (program, random) => atOneOf(random, tokensOf(program, keywords), token => insertAfter(program, token, ` ${textOfToken(program, token)}`))},
  {name: 'a string that is not closed', edits: (program, random) => atOneOf(random, tokensOf(program, [STRING]), token => ({at: endOf(program, token) - 1, remove: 1, insert: ''}))},
  {name: 'a comment that is not closed', edits: (program, random) => {
    const comments = Array.from({length: program.labels.tokens.count}, (_, token) => token).filter(token => labelKindOf(program, token) === displayKind.comment)
    return atOneOf(random, comments, token => ({at: endOf(program, token) - 2, remove: 2, insert: ''}))
  }},
  {name: 'an operator without its right side', edits: (program, random) => atOneOf(random, tokensOf(program, operators, (_, place) => [IDENT, INT, STRING].includes(kindOf(program, after(program, place)))), token => removeToken(program, after(program, program.real.indexOf(token))))},
  {name: 'an operator twice', edits: (program, random) => atOneOf(random, tokensOf(program, operators), token => insertAfter(program, token, ` ${textOfToken(program, token)}`))},
  {name: 'a missing operator', edits: (program, random) => atOneOf(random, tokensOf(program, operators), token => removeToken(program, token))},
  {name: 'a type after a parameter', edits: (program, random) => atOneOf(random, tokensOf(program, [IDENT], token => labelKindOf(program, token) === displayKind.parameter), token => insertAfter(program, token, ' : int'))},
  {name: 'a number with a point', edits: (program, random) => atOneOf(random, tokensOf(program, [INT]), token => insertAfter(program, token, '.5'))},
  {name: 'a ! before a name', edits: (program, random) => atOneOf(random, tokensOf(program, [IDENT], token => labelKindOf(program, token) === displayKind.name), token => insertBefore(program, token, '!'))},
  // `f (if a then b else c)` without the brackets, and the same for `fun` and `let`.
  {name: 'no brackets around an argument', edits: (program, random) => {
    const opening = tokensOf(program, [LPAREN], (_, place) => [IF, FUN, LET].includes(kindOf(program, after(program, place))) && closingOf(program, place) !== -1)
    if (opening.length === 0) return undefined
    const open = random.pick(opening)
    return [removeToken(program, open), removeToken(program, program.real[closingOf(program, program.real.indexOf(open))]!)]
  }},
  // What a text looks like while a line is being typed: the line stops after one of its tokens.
  {name: 'a line that stops early', edits: (program, random) => {
    const {tokens} = program.labels
    const candidates = program.real.filter((token, place) => after(program, place) !== -1 && kindOf(program, token) !== LET)
    if (candidates.length === 0) return undefined
    const last = random.pick(candidates)
    let end = last + 1
    while (end < tokens.count && tokens.kind[end] !== newlineKind) end++
    return end === last + 1 ? undefined : [{at: endOf(program, last), remove: startOf(program, end - 1) + tokens.length[end - 1]! - endOf(program, last), insert: ''}]
  }},
]
export const mistakeNames: readonly string[] = mistakes.map(mistake => mistake.name)

// The program with the edits made, and for every code point of the result its place in the program, -1 for an
// added one. The edits must not overlap.
function applyEdits(codePoints: Int32Array, edits: readonly Edit[]): {broken: string, alignment: number[]} {
  const result: number[] = [], alignment: number[] = []
  let position = 0
  for (const edit of [...edits].sort((left, right) => left.at - right.at)) {
    if (edit.at < position) throw new Error('two edits overlap')
    for (; position < edit.at; position++) {
      result.push(codePoints[position]!)
      alignment.push(position)
    }
    for (const codePoint of codePointsOf(edit.insert)) {
      result.push(codePoint)
      alignment.push(-1)
    }
    position += edit.remove
  }
  for (; position < codePoints.length; position++) {
    result.push(codePoints[position]!)
    alignment.push(position)
  }
  return {broken: textOf(result), alignment}
}

// For every mistake of the list, `perMistake` samples, each with the mistake's name as its one edit. A program
// that has no place for a mistake, or stays valid with it, or has nothing to score, is passed over.
export function ownSamples(perMistake: number): Sample[] {
  const samples: Sample[] = []
  const made = new Map<string, number>(mistakes.map(mistake => [mistake.name, 0]))
  for (let index = 0; index < 60 * perMistake && [...made.values()].some(count => count < perMistake); index++) {
    const {text, labels} = programAt(programSeed, index)
    if (splitOfTokens(labels) !== 'train') continue
    const program: Program = {labels, real: Array.from({length: labels.tokens.count}, (_, token) => token).filter(token => !isTrivia(labels.tokens.kind[token]!))}
    // Every program gets one mistake: the next one of the list that still needs samples and has a place in it.
    for (let turn = 0; turn < mistakes.length; turn++) {
      const mistake = mistakes[(index + turn) % mistakes.length]!
      if (made.get(mistake.name)! >= perMistake) continue
      const edits = mistake.edits(program, createRandom(programSeed, index))
      if (edits === undefined) continue
      const {broken, alignment} = applyEdits(labels.codePoints, edits)
      const sample = makeSample({id: `own:${index}`, edits: [mistake.name], original: text, broken, alignment}, labels)
      if (typeof sample === 'string') continue
      samples.push(sample)
      made.set(mistake.name, made.get(mistake.name)! + 1)
      break
    }
  }
  return samples
}

// Pairs that are written out: the broken program, and the program that was meant.
const written: {broken: string, meant: string}[] = [
  {
    meant: 'let area w h =\n  let half = w / 2 in\n  half * h\n\nlet total = area 3 4\n',
    broken: 'let area w h =\n  let half = w / 2\n  half * h\n\nlet total = area 3 4\n',
  },
  {
    meant: 'let rec length xs = if xs = [] then 0 else 1 + length (tail xs)\nlet main () = print_int (length [1; 2; 3])\n',
    broken: 'let rec length xs = if xs = [] then 0 else 1 + length (tail xs\nlet main () = print_int (length [1; 2; 3])\n',
  },
  {
    meant: 'let sign n =\n  if n < 0 then -1\n  else if n = 0 then 0\n  else 1\n\nlet abs n = if n < 0 then -n else n\n',
    broken: 'let sign n =\n  if n < 0 -1\n  else if n = 0 then 0\n  else 1\n\nlet abs n = if n < 0 then -n else n\n',
  },
  {
    meant: 'let limit = 10\nlet rec count n = if n = 0 then 0 else 1 + count (n - 1)\nlet () = print_int (count limit)\n',
    broken: 'let limit = 10;;\nlet rec count n = if n = 0 then 0 else 1 + count (n - 1);;\nlet () = print_int (count limit);;\n',
  },
  {
    meant: 'let primes = [2; 3; 5; 7]\nlet first = head primes\n',
    broken: 'let primes = [2, 3, 5, 7]\nlet first = head primes\n',
  },
  {
    meant: 'let same a b = a = b\nlet differ a b = a <> b\nlet both = same 1 1 && differ 1 2\n',
    broken: 'let same a b = a == b\nlet differ a b = a != b\nlet both = same 1 1 && differ 1 2\n',
  },
  {
    meant: 'let twice f x = f (f x)\nlet add_two = twice (fun n -> n + 1)\nlet four = add_two 2\n',
    broken: 'let twice f x = f (f x)\nlet add_two = twice (fun n => n + 1)\nlet four = add_two 2\n',
  },
  {
    meant: 'let swap pair = (snd pair, fst pair)\nlet origin = (0, 0)\n',
    broken: 'let swap (a, b) = (b, a)\nlet origin = (0, 0)\n',
  },
  {
    meant: 'let x = 1\nlet y = x + 1\nlet z = y * 2\n',
    broken: 'x = 1\nlet y = x + 1\nlet z = y * 2\n',
  },
  {
    meant: 'let scale k v = k * v\nlet half = scale 2 21\nlet greeting = "hello"\n',
    broken: 'let scale k v = k *\nlet half = scale 2 21\nlet greeting = "hello"\n',
  },
  {
    meant: 'let greet name = "hello, " ^ name ^ "!"\nlet shout = greet "world"\n',
    broken: 'let greet name = "hello,  ^ name ^ "!"\nlet shout = greet "world"\n',
  },
  {
    meant: 'let pick c a b =\n  if c then a else b\n\nlet one = pick true 1 2\nlet two = pick false 1 2\n',
    broken: 'let pick c a b =\n  if c then a else\n\nlet one = pick true 1 2\nlet two = pick false 1 2\n',
  },
  {
    meant: 'let step state =\n  let pc = fst state in\n  let acc = snd state in\n  (pc + 1, acc * 2)\n\nlet start = (0, 1)\n',
    broken: 'let step state =\n  let pc = fst state in\n  let acc = snd state\n  (pc + 1, acc * 2)\n\nlet start = (0, 1)\n',
  },
  {
    meant: 'let apply f = f (if ready then 1 else 2)\nlet ready = true\n',
    broken: 'let apply f = f if ready then 1 else 2\nlet ready = true\n',
  },
  {
    meant: 'let rec fact n = if n <= 1 then 1 else n * fact (n - 1)\nlet ten = fact 10\n',
    broken: 'let rec fact n = if n <= 1 then 1 else n * fact (n - 1))\nlet ten = fact 10\n',
  },
  {
    meant: 'let names = ["ann"; "bob"]\nlet count = length names\n',
    broken: 'let names = ["ann"; "bob";]\nlet count = length names\n',
  },
  {
    meant: 'let incr x = x + 1\nlet decr x = x - 1\nlet zero = decr (incr 0)\n',
    broken: 'let incr x = x + 1\nlet decr x x - 1\nlet zero = decr (incr 0)\n',
  },
  {
    meant: 'let compose f g = fun x -> f (g x)\nlet id = fun x -> x\n',
    broken: 'let compose f g = fun x f (g x)\nlet id = fun x -> x\n',
  },
  {
    meant: 'let ratio a b = a / b\nlet pi = 3\nlet tau = 2 * pi\n',
    broken: 'let ratio (a : int) (b : int) = a / b\nlet pi = 3.14\nlet tau = 2 * pi\n',
  },
  {
    meant: 'let max a b = if a > b then a else b\nlet biggest = max (max 1 2) 3\n',
    broken: 'let max a b = if a > b thn a else b\nlet biggest = max (max 1 2) 3\n',
  },
  {
    meant: 'let run () =\n  let n = read () in\n  if n > 0 then print_int n else print_string "none"\n\nlet () = run ()\n',
    broken: 'let run () =\n  let n = read () in\n  if n > 0 then print_int n; else print_string "none"\n\nlet () = run ()\n',
  },
  {
    meant: 'let pairs = [(1, "one"); (2, "two")]\nlet first = fst (head pairs)\n',
    broken: 'let pairs = [(1, "one"); (2, "two")\nlet first = fst (head pairs)\n',
  },
  {
    meant: 'let config = (80, "localhost", true)\nlet port = 80\n',
    broken: 'let config = {80, "localhost", true}\nlet port = 80\n',
  },
  {
    meant: 'let rec sum xs = if xs = [] then 0 else head xs + sum (tail xs)\nlet total = sum [1; 2; 3]\n',
    broken: 'let rec sum xs = if xs = [] then 0 else head xs + sum (tail xs) in\nlet total = sum [1; 2; 3]\n',
  },
]

// The written pairs as samples, with an alignment that keeps as many code points as any can.
export function writtenSamples(): Sample[] {
  return written.map(({broken, meant}, number) => {
    const sample = makeSample({id: `written:${number}`, edits: ['written by the author'], original: meant, broken, alignment: alignmentOfTexts(meant, broken)})
    if (typeof sample === 'string') throw new Error(`the written pair ${number} is no sample: ${sample}`)
    return sample
  })
}

if (import.meta.main) {
  const samples = ownSamples(Number(process.argv[2] ?? 100))
  for (const name of mistakeNames) {
    const ofMistake = samples.filter(sample => sample.edits[0] === name)
    console.log(`${String(ofMistake.length).padStart(5)}  ${name}${ofMistake.length === 0 ? '' : `   e.g. ${onOneLine(ofMistake[0]!.broken).slice(0, 140)}`}`)
  }
  console.log(`${samples.length} samples of ${mistakeNames.length} mistakes, and ${writtenSamples().length} written pairs.`)
}
