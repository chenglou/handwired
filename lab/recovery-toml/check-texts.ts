// Texts for check-table-parser.ts: edge cases written by hand, random valid TOML documents, and random edits of them.
// The generator is a simple one for this check and covers every feature that tables.ts reads. The documents and the
// damage of the experiment itself are made elsewhere.
//
// A generated document is valid for Bun.TOML.parse too: no key and no table is defined twice, the dates and times are
// in range, the integers fit in 53 bits, and no escape names a surrogate.
import {capacity, maximumDepth} from './kinds.ts'

// mulberry32, so two runs make the same texts.
export type Random = {
  next: () => number
  // An integer from minimum to maximum, both included.
  integer: (minimum: number, maximum: number) => number
  chance: (probability: number) => boolean
  pick: <Item>(items: readonly Item[]) => Item
}
export function createRandom(seed: number): Random {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
  const integer = (minimum: number, maximum: number) => minimum + Math.floor(next() * (maximum - minimum + 1))
  return {next, integer, chance: probability => next() < probability, pick: items => items[Math.floor(next() * items.length)]!}
}

const nested = (depth: number, inner = '') => '['.repeat(depth) + inner + ']'.repeat(depth)

// Valid texts written by hand, one or more per rule of tables.ts.
export const validEdgeCases: readonly string[] = [
  '', ' ', '\n', '\r\n', '\t\n\n', '# only a comment', '# a comment\n', '#\n', 'a = 1', 'a = 1\n', 'a=1\r\nb=2\r\n', '  a\t=\t1  # c\n',
  // Keys.
  'bare_key-1 = 1\n', '- = 1\n', '_ = 1\n', '1234 = 1\n', '"quoted key" = 1\n', '\'literal key\' = 1\n', '"" = 1\n', '\'\' = 1\n',
  '"\\u00e9\\t\\"" = 1\n', 'a.b.c = 1\n', 'a . b\t.\tc = 1\n', 'a."b.c".\'d\' = 1\n', '"a"."b" = 1\n', 'true = 1\n', 'false = 1\n',
  'inf = 1\n', 'nan = 1\n', '-inf = 1\n', '-nan = 1\n', '-1 = 1\n', '1979-05-27 = 1\n', '1979-05-27T07 = 1\n', '1979-05 = 1\n',
  '1.5 = 1\n', '3.14.15 = 1\n', '1.x = 1\n', '1."x" = 1\n', '1.\'x\' = 1\n', '1. x = 1\n', '1 .5 = 1\n', '1.5e3 = 1\n', '1e5.3 = 1\n',
  '1e-5 = 1\n', '0x1F = 1\n', '0x = 1\n', '00 = 1\n', '007 = 1\n', '0_1 = 1\n', '1_ = 1\n', '1__2 = 1\n', 'tru = 1\n', 'truex = 1\n',
  'tru.e = 1\n', '-0 = 1\n', '-00 = 1\n', '1.-5 = 1\n', '1.t = 1\n', '1.5.true = 1\n', '00.5 = 1\n', '0.0 = 1\n',
  't = 1\nf = 2\ni = 3\nn = 4\nin = 5\nna = 6\n', 'T = 1\nZ = 2\nE = 3\ne = 4\nU = 5\n', '1979-05-27 .x = 1\n', '1e. x = 1\n',
  // Headers.
  '[a]\n', '[a]', '[ a ]\n', '[a.b]\n', '[ a . b ]\n', '["a b".\'c\']\n', '[[a]]\n', '[[ a.b ]]\n', '[[a]] # c\n', '[a] # c\r\n',
  '[1.5]\n', '[[1.5]]\n', '[true]\n', '[tru]\n', '[[tru]]\n', '[ tru ]\n', '[1979-05-27]\n', '[1979-05]\n', '[0x]\n', '[1. x]\n',
  '[-]\n', '[1e5.x]\n', '[a]\nb = 1\n[[c]]\nd = 2\n[[c]]\nd = 3\n[e.f]\n',
  // Strings.
  'a = ""\n', 'a = \'\'\n', 'a = "x"\n', 'a = \'x\'\n', 'a = "\\b\\t\\n\\f\\r\\"\\\\"\n', 'a = "\\u00e9\\uABCD\\U0001F600\\U0010ffff"\n',
  'a = "tab\there # no comment"\n', 'a = \'C:\\path\\"quoted"\'\n', 'a = "é字😀 \'x\' [1] {2} = ,"\n', 'a = \'é字😀\t"x"\'\n',
  'a = """"""\n', 'a = \'\'\'\'\'\'\n', 'a = """x"""\n', 'a = """\nline 1\nline 2\n"""\n', 'a = """\r\nline 1\r\nline 2\r\n"""\r\n',
  'a = """a "quoted" word, and "" two"""\n', 'a = """x\\"""y"""\n', 'a = """x"""""\n', 'a = """x""""\n', 'a = """""x"""\n',
  'a = """one \\\n   two \\  \n\n  three \\\t\r\n four"""\n', 'a = """\\u00e9\\U0001F600\\t\\\\"""\n', 'a = """tab\tand # no comment\n"""\n',
  'a = \'\'\'x\'\'\'\n', 'a = \'\'\'\nline 1\nline 2\\\n\'\'\'\n', 'a = \'\'\'it\'s, and \'\' two\'\'\'\n', 'a = \'\'\'x\'\'\'\'\'\n', 'a = \'\'\'x\'\'\'\'\n',
  'a = \'\'\'\'\'x\'\'\'\n', 'a = \'\'\'\r\nx\r\n\'\'\'\n', 'a = ["""x""", \'\'\'y\'\'\']\n', 'a = {b = """x""", c = \'\'\'y\'\'\'}\n',
  // Integers.
  'a = 0\n', 'a = +0\n', 'a = -0\n', 'a = 7\n', 'a = 42\n', 'a = 123\n', 'a = 1234\n', 'a = 12345\n', 'a = +99\n', 'a = -17\n',
  'a = 1_000\n', 'a = 5_349_221\n', 'a = 1_2_3_4_5\n', 'a = 0xDEADBEEF\n', 'a = 0xdead_beef\n', 'a = 0x0\n', 'a = 0o01234567\n',
  'a = 0o7_5_5\n', 'a = 0b11010110\n', 'a = 0b1_0\n', 'a = 9007199254740991\n',
  // Floats.
  'a = 1.0\n', 'a = +1.0\n', 'a = -0.01\n', 'a = 3.1415\n', 'a = 5e+22\n', 'a = 1e06\n', 'a = -2E-2\n', 'a = 6.626e-34\n', 'a = 0.0\n',
  'a = 0e0\n', 'a = -0.0e-0\n', 'a = 224_617.445_991_228\n', 'a = 1e1_0\n', 'a = 1_0.0_1E+0_2\n', 'a = inf\n', 'a = +inf\n', 'a = -inf\n',
  'a = nan\n', 'a = +nan\n', 'a = -nan\n', 'a = 12.5\n', 'a = 123.5\n', 'a = 1234.5\n', 'a = 12345.5\n', 'a = 1e5\n', 'a = 12e5\n',
  // Booleans.
  'a = true\n', 'a = false\n', 'a = [true, false]\n',
  // Dates and times.
  'a = 1979-05-27\n', 'a = 0000-01-01\n', 'a = 1979-05-27T07:32:00\n', 'a = 1979-05-27t07:32:00\n', 'a = 1979-05-27 07:32:00\n',
  'a = 1979-05-27T07:32:00Z\n', 'a = 1979-05-27T07:32:00z\n', 'a = 1979-05-27T00:32:00-07:00\n', 'a = 1979-05-27T00:32:00+07:00\n',
  'a = 1979-05-27T00:32:00.999999-07:00\n', 'a = 1979-05-27 07:32:00.5Z\n', 'a = 1979-05-27T07:32:00.1\n', 'a = 07:32:00\n',
  'a = 00:00:00\n', 'a = 00:32:00.999999\n', 'a = 23:59:59.0\n', 'a = 1979-05-27 # a comment\n', 'a = 1979-05-27 \n', 'a = 1979-05-27\t\n',
  'a = [1979-05-27 , 07:32:00 , 1979-05-27 07:32:00 ]\n', 'a = {b = 1979-05-27 }\n', 'a = 1979-05-27  # two spaces\n',
  // Arrays.
  'a = []\n', 'a = [ ]\n', 'a = [1]\n', 'a = [1,]\n', 'a = [1, 2]\n', 'a = [ 1 , 2 , ]\n', 'a = [\n]\n', 'a = [\n  1,\n  2,\n]\n',
  'a = [ # c\n  1, # c\n  # c\n  2 # c\n  , # c\n]\n', 'a = [\r\n  1,\r\n  2\r\n]\r\n', 'a = [[1, 2], ["x", \'y\'], [[]]]\n', 'a = [[[[1]]]]\n',
  'a = [1, "x", 1.5, true, 1979-05-27, [1], {b = 1}]\n', 'a = [\n\n\n1\n\n\n]\n', 'a = [{}, {}]\n', 'a = [ { b = 1 }, { b = 2 }, ]\n',
  'a = [[], [], []]\n', 'a = [inf, nan, -inf, true]\n', 'a = [1.5, 2.5e3, 0x1F, 0o7, 0b1]\n', 'a = [1]# c\n',
  // Inline tables.
  'a = {}\n', 'a = { }\n', 'a = {b = 1}\n', 'a = { b = 1 }\n', 'a = {b = 1, c = 2}\n', 'a = { b = 1 , c = "x" }\n', 'a = {b.c = 1}\n',
  'a = {b . c = 1, "d e" = 2, \'f\' = 3}\n', 'a = {b = {c = {d = {}}}}\n', 'a = {b = [1, 2], c = [\n  3,\n  4,\n]}\n', 'a = {1.5 = 1, true = 2, 1979-05-27 = 3}\n',
  'a = {b = [{c = [{d = 1}]}]}\n', 'a = {tru = 1, 0x = 2, 1. x = 3}\n', 'a = {b = 1}# c\n',
  // Nesting up to the maximum depth, and the capacity.
  `a = ${nested(maximumDepth)}\n`, `a = ${nested(maximumDepth, '1')}\n`, `a = ${'{b = '.repeat(maximumDepth)}1${'}'.repeat(maximumDepth)}\n`,
  `a = ${'[{b = '.repeat(maximumDepth / 2)}1${'}]'.repeat(maximumDepth / 2)}\n`, `a = "${'x'.repeat(capacity - 6)}"`, `# ${'x'.repeat(capacity - 2)}`,
  `a = [${'1,'.repeat((capacity - 6) / 2)}]`, '\n'.repeat(capacity), `a = """${'\n'.repeat(capacity - 10)}"""`,
]

// Texts that TOML 1.0 does not allow, or that pass the limits, each with a text next to it in validEdgeCases above.
export const invalidEdgeCases: readonly string[] = [
  // Keys and lines.
  'a\n', 'a =\n', 'a = \n', '= 1\n', 'a = 1 b = 2\n', 'a = 1 2\n', 'a b = 1\n', 'a. = 1\n', '.a = 1\n', 'a..b = 1\n', 'a = 1\n = 2\n',
  'a: 1\n', 'a = 1,\n', 'a == 1\n', '"a" "b" = 1\n', 'a"b" = 1\n', '"a"b = 1\n', '"""a""" = 1\n', '\'\'\'a\'\'\' = 1\n', 'a\n= 1\n', 'a =\n1\n',
  'a.\nb = 1\n', '+1 = 1\n', '1e+5 = 1\n', '07:32 = 1\n', '1979-05-27 07 = 1\n', 'ä = 1\n', 'a! = 1\n', '1. = 1\n', '1.. = 1\n', '1.+ = 1\n',
  '1.,\n', 'a = 1 # c\rb = 2\n', 'a = 1\rb = 2\n', 'a = 1\r', '\r', '# c\r', '# c\u0000\n', '# c\u007f\n', '# c\u000b\n', '\u0000', '\ufeffa = 1\n',
  '\u00a0a = 1\n', 'a = 1\u00a0\n', 'a = 1\u000c\n',
  // Headers.
  '[]\n', '[ ]\n', '[a\n', '[a]]\n', '[[a]\n', '[[a] ]\n', '[ [a]]\n', '[ [a] ]\n', '[[a]]]\n', '[[[a]]]\n', '[a.]\n', '[.a]\n', '[a..b]\n',
  '[a] b = 1\n', '[a] [b]\n', '[a]]\n', '[a b]\n', '[a = 1]\n', '[a\n]\n', '["""a"""]\n', '[1.]\n', '[[1.]]\n', '[+1]\n', '[a,b]\n',
  '[[a]\n]\n', '[07:32]\n', '[a]\n[b\n', '[[]]\n', '[[ ]]\n', '[a]x\n',
  // Strings.
  'a = "x\n', 'a = "x', 'a = \'x\n', 'a = \'x', 'a = "x\ny"\n', 'a = \'x\ny\'\n', 'a = "\\q"\n', 'a = "\\x41"\n', 'a = "\\e"\n', 'a = "\\/"\n',
  'a = "\\u12"\n', 'a = "\\u12x4"\n', 'a = "\\U0001F60"\n', 'a = "\\U0001F60g"\n', 'a = "\\', 'a = "\\u', 'a = "x\u0000y"\n', 'a = "x\u007fy"\n',
  'a = \'x\u0001y\'\n', 'a = "x\ry"\n', 'a = "x" "y"\n', 'a = "x""y"\n', 'a = "x"\'y\'\n', 'a = "x"y\n', 'a = """x', 'a = """x""', 'a = """x"',
  'a = """x""""""\n', 'a = \'\'\'x\'\'\'\'\'\'\n', 'a = """x\\ y"""\n', 'a = """x\\  y\n"""\n', 'a = """x\ry"""\n', 'a = \'\'\'x\ry\'\'\'\n',
  'a = """x\u0000"""\n', 'a = \'\'\'x\u007f\'\'\'\n', 'a = """x"""y\n', 'a = """\\q"""\n', 'a = \'\'\'x', 'a = \'\'\'x\'\'', 'a = """x\\',
  // Numbers.
  'a = 01\n', 'a = 00\n', 'a = -01\n', 'a = +01\n', 'a = 0_1\n', 'a = 1_\n', 'a = _1\n', 'a = 1__2\n', 'a = 1_.5\n', 'a = 1._5\n', 'a = 1.5_\n',
  'a = 1.\n', 'a = .5\n', 'a = 1.e5\n', 'a = 1e\n', 'a = 1e+\n', 'a = 1e-\n', 'a = 1e_5\n', 'a = 1e5_\n', 'a = 1e5.3\n', 'a = 1.5.6\n',
  'a = +\n', 'a = -\n', 'a = ++1\n', 'a = --1\n', 'a = +-1\n', 'a = 1+1\n', 'a = 1-1\n', 'a = 0x\n', 'a = 0xG\n', 'a = 0x_1\n', 'a = 0x1_\n',
  'a = 0X1F\n', 'a = +0x1\n', 'a = -0x1\n', 'a = 0o8\n', 'a = 0o\n', 'a = 0O7\n', 'a = 0b2\n', 'a = 0b\n', 'a = 0B1\n', 'a = 0b1__0\n',
  'a = Inf\n', 'a = NaN\n', 'a = infinity\n', 'a = +i\n', 'a = in\n', 'a = na\n', 'a = nan1\n', 'a = 1x\n', 'a = 12abc\n', 'a = 1 .5\n',
  'a = 1. 5\n', 'a = 00.5\n', 'a = 1.5e\n', 'a = 1e5e5\n', 'a = 0e\n', 'a = 0.\n', 'a = -0.\n', 'a = 0_0\n', 'a = 1,5\n',
  // Literals and words.
  'a = tru\n', 'a = t\n', 'a = truee\n', 'a = True\n', 'a = TRUE\n', 'a = fals\n', 'a = falsey\n', 'a = null\n', 'a = abc\n', 'a = true false\n',
  'a = -true\n', 'a = +true\n', 'a = [tru]\n', 'a = [tru ]\n', 'a = {b = tru}\n', 'a = tru # c\n', 'a = tru',
  // Dates and times.
  'a = 1979-05\n', 'a = 1979-5-27\n', 'a = 197-05-27\n', 'a = 19790-05-27\n', 'a = 1979-05-2\n', 'a = 1979-05-277\n', 'a = 1979-05-27T\n',
  'a = 1979-05-27T07\n', 'a = 1979-05-27T07:32\n', 'a = 1979-05-27T07:32:0\n', 'a = 1979-05-27T07:32:00.\n', 'a = 1979-05-27T07:32:00+\n',
  'a = 1979-05-27T07:32:00+07\n', 'a = 1979-05-27T07:32:00+07:0\n', 'a = 1979-05-27T07:32:00+0700\n', 'a = 1979-05-27T07:32:00ZZ\n',
  'a = 1979-05-27T07:32:00Zx\n', 'a = 1979-05-27 07\n', 'a = 1979-05-27 07:32\n', 'a = 1979-05-27 7\n', 'a = 1979-05-27  07:32:00\n',
  'a = 1979-05-27\t07:32:00\n', 'a = 1979-05-27Z\n', 'a = 1979-05-27+07:00\n', 'a = 07:32\n', 'a = 7:32:00\n', 'a = 07:32:0\n',
  'a = 07:32:00.\n', 'a = 07:32:00Z\n', 'a = 07:32:00+07:00\n', 'a = 07:32:00x\n', 'a = 07:3x:00\n', 'a = 1979-05-27T07:32:00 Z\n',
  'a = 1979-05-27x\n', 'a = 1979-05-27 x\n', 'a = 1979-05-27 1979-05-27\n', 'a = -1979-05-27\n', 'a = +07:32:00\n', 'a = 123:00:00\n',
  'a = 12345-05-27\n', 'a = 1979_05_27\n', 'a = 0x07:32:00\n',
  // Arrays.
  'a = [\n', 'a = [1\n', 'a = [1,\n', 'a = [1 2]\n', 'a = [,]\n', 'a = [,1]\n', 'a = [1,,2]\n', 'a = [1,,]\n', 'a = [1]]\n', 'a = ]\n',
  'a = [1}\n', 'a = [1 # c]\n', 'a = [a = 1]\n', 'a = [1 = 2]\n', 'a = [1][2]\n', 'a = [1] [2]\n', 'a = [1]2\n', 'a = [[1]\n', 'a = [1.]\n',
  'a = [1\n[b]\n', 'a = [x]\n',
  // Inline tables.
  'a = {\n', 'a = {b\n', 'a = {b =\n', 'a = {b = 1\n', 'a = {b = 1,}\n', 'a = {b = 1, }\n', 'a = {,}\n', 'a = {,b = 1}\n', 'a = {b = 1,, c = 2}\n',
  'a = {b = 1 c = 2}\n', 'a = {b}\n', 'a = {b =}\n', 'a = {1}\n', 'a = {"b"}\n', 'a = {b = 1]\n', 'a = {\nb = 1\n}\n', 'a = {b = 1,\nc = 2}\n',
  'a = {b = 1 # c\n}\n', 'a = {b = 1}}\n', 'a = }\n', 'a = {b = 1}{c = 2}\n', 'a = {b = 1} c = 2\n', 'a = {b: 1}\n', 'a = {[b] = 1}\n',
  'a = {b = [1\n,2}\n', 'a = {b.= 1}\n', 'a = {b = 1.}\n',
  // The limits.
  `a = ${nested(maximumDepth + 1)}\n`, `a = ${'{b = '.repeat(maximumDepth + 1)}1${'}'.repeat(maximumDepth + 1)}\n`, `a = ${nested(40)}\n`,
  `a = "${'x'.repeat(capacity - 5)}"`, `# ${'x'.repeat(capacity - 1)}`, '\n'.repeat(capacity + 1), `a = 1\n${'x'.repeat(capacity + 20)}`,
]

// The pieces of a generated document.

const bareNames = ['name', 'port', 'host', 'enabled', 'max-size', 'server_name', 'x', 'ID', 'Key', 'data', 'zone', 'title', 'owner', 'Url', 'e', 'T', 'Z', 'bin', 'fast']
// Keys without quotes that start like a value, with what the key is once it is read: its parts.
const valueLikeKeys: readonly (readonly [text: string, parts: readonly string[]])[] = [
  ['1', ['1']], ['007', ['007']], ['1979', ['1979']], ['1979-05-27', ['1979-05-27']], ['1979-05', ['1979-05']], ['2026-01-01T00', ['2026-01-01T00']],
  ['true', ['true']], ['false', ['false']], ['inf', ['inf']], ['nan', ['nan']], ['-1', ['-1']], ['-inf', ['-inf']], ['-', ['-']], ['_', ['_']],
  ['1e5', ['1e5']], ['1e-5', ['1e-5']], ['0x1F', ['0x1F']], ['0x', ['0x']], ['0b1', ['0b1']], ['0o17', ['0o17']], ['tru', ['tru']],
  ['truer', ['truer']], ['00', ['00']], ['0', ['0']], ['-0', ['-0']], ['1_000', ['1_000']], ['1_', ['1_']], ['t', ['t']], ['f', ['f']],
  ['i', ['i']], ['n', ['n']], ['fals', ['fals']], ['nano', ['nano']], ['12345', ['12345']], ['1234', ['1234']], ['12', ['12']],
  ['1.5', ['1', '5']], ['3.14.15', ['3', '14', '15']], ['2.x', ['2', 'x']], ['4."q"', ['4', 'q']], ['5. y', ['5', 'y']], ['6 . 7', ['6', '7']],
  ['127.0.0.1', ['127', '0', '0', '1']], ['8.5e3', ['8', '5e3']], ['9e5.3', ['9e5', '3']], ['10.-5', ['10', '-5']], ['11.true', ['11', 'true']],
  ['00.5', ['00', '5']], ['0.0', ['0', '0']], ['13.\'z\'', ['13', 'z']], ['1979-05-28 .x', ['1979-05-28', 'x']], ['-2.5', ['-2', '5']],
]
const quotedKeys: readonly (readonly [text: string, name: string])[] = [
  ['"a b"', 'a b'], ['"ä"', 'ä'], ['""', ''], ['\'\'', ''], ['\'a.b\'', 'a.b'], ['"\\u00e9t\\u00E9"', 'été'], ['"quote\\""', 'quote"'],
  ['\'C:\\path\'', 'C:\\path'], ['"tab\\there"', 'tab\there'], ['"#"', '#'], ['\'[x]\'', '[x]'], ['"="', '='], ['"\\U0001F600"', '😀'],
  ['\'"\'', '"'], ['"\'"', '\''], ['"127.0.0.1"', '127.0.0.1'], ['"true"', 'true'], ['"\\\\"', '\\'],
]
const nonAsciiCharacters = ['é', 'ä', '字', '😀', '\u0080', '\u00a0', '\u2028', '\ud7ff', '\ue000', '\ufeff', '\u{10ffff}']
// A character that a string or a comment may hold as it is, other than the `excluded` ones: a tab, a character from
// U+0080 up, or any ASCII character from the space to ~, so that every class of tables.ts comes up.
function plainCharacter(random: Random, excluded: string) {
  for (;;) {
    const roll = random.next()
    const character = roll < 0.06 ? '\t' : roll < 0.2 ? random.pick(nonAsciiCharacters) : String.fromCodePoint(random.integer(0x20, 0x7e))
    if (!excluded.includes(character)) return character
  }
}
const hexDigitsOf = (random: Random, value: number, count: number) => {
  const text = value.toString(16).padStart(count, '0')
  return Array.from(text, digit => random.chance(0.5) ? digit.toUpperCase() : digit).join('')
}
// An escape of a string in quotes. \u and \U name any code point but a surrogate.
function escapeText(random: Random) {
  const roll = random.next()
  if (roll < 0.5) return random.pick(['\\b', '\\t', '\\n', '\\f', '\\r', '\\"', '\\\\'])
  if (roll < 0.8) return `\\u${hexDigitsOf(random, random.chance(0.5) ? random.integer(0, 0xd7ff) : random.integer(0xe000, 0xffff), 4)}`
  return `\\U${hexDigitsOf(random, random.chance(0.5) ? random.integer(0, 0xd7ff) : random.integer(0xe000, 0x10ffff), 8)}`
}
// The text of a comment after its #.
function commentText(random: Random) {
  let text = ''
  for (let character = random.pick([0, 0, 1, 3, 8, 20]); character > 0; character--) text += plainCharacter(random, '')
  return text
}

type Generator = {
  random: Random
  lineEnd: string
  // A number that makes the next name new.
  nextName: number
}

const digits = (random: Random, count: number) => Array.from({length: count}, () => String(random.integer(0, 9))).join('')
const twoDigits = (value: number) => String(value).padStart(2, '0')
// Digits with underscores between some of them, from the digits of one base, e.g. '1_000' or 'dead_BEEF'.
function digitsWithUnderscores(random: Random, characters: string, count: number, firstMayBeZero: boolean) {
  let text = ''
  for (let digit = 0; digit < count; digit++) {
    let character = random.pick(Array.from(characters))
    if (digit === 0 && !firstMayBeZero && character === '0') character = '1'
    if (digit > 0 && random.chance(0.2)) text += '_'
    text += character
  }
  return text
}

function integerText(random: Random) {
  const roll = random.next()
  if (roll < 0.1) return random.pick(['0', '+0', '-0'])
  if (roll < 0.25) return `0x${digitsWithUnderscores(random, random.pick(['0123456789abcdef', '0123456789ABCDEF', '0123456789abcdefABCDEF']), random.integer(1, 10), true)}`
  if (roll < 0.35) return `0o${digitsWithUnderscores(random, '01234567', random.integer(1, 12), true)}`
  if (roll < 0.45) return `0b${digitsWithUnderscores(random, '01', random.integer(1, 20), true)}`
  return random.pick(['', '', '+', '-']) + digitsWithUnderscores(random, '0123456789', random.integer(1, 9), false)
}

function floatText(random: Random) {
  if (random.chance(0.15)) return random.pick(['', '+', '-']) + random.pick(['inf', 'nan'])
  let text = random.pick(['', '', '+', '-']) + (random.chance(0.3) ? '0' : digitsWithUnderscores(random, '0123456789', random.integer(1, 6), false))
  const withFraction = random.chance(0.7)
  if (withFraction) text += `.${digitsWithUnderscores(random, '0123456789', random.integer(1, 5), true)}`
  if (!withFraction || random.chance(0.4)) text += random.pick(['e', 'E']) + random.pick(['', '+', '-']) + digitsWithUnderscores(random, '0123456789', random.integer(1, 2), true)
  return text
}

function dateText(random: Random) {
  return `${digits(random, 4)}-${twoDigits(random.integer(1, 12))}-${twoDigits(random.integer(1, 28))}`
}
function timeText(random: Random) {
  const fraction = random.chance(0.4) ? `.${digits(random, random.integer(1, 6))}` : ''
  return `${twoDigits(random.integer(0, 23))}:${twoDigits(random.integer(0, 59))}:${twoDigits(random.integer(0, 59))}${fraction}`
}
function dateOrTimeText(random: Random) {
  const roll = random.next()
  if (roll < 0.25) return dateText(random)
  if (roll < 0.45) return timeText(random)
  const offset = random.chance(0.6) ? random.pick(['Z', 'Z', 'z', `+${twoDigits(random.integer(0, 23))}:${twoDigits(random.integer(0, 59))}`, `-${twoDigits(random.integer(0, 23))}:${twoDigits(random.integer(0, 59))}`]) : ''
  return dateText(random) + random.pick(['T', 'T', 't', ' ']) + timeText(random) + offset
}

function basicStringText(random: Random) {
  let text = '"'
  for (let piece = random.integer(0, 8); piece > 0; piece--) text += random.chance(0.2) ? escapeText(random) : plainCharacter(random, '"\\')
  return `${text}"`
}
function literalStringText(random: Random) {
  let text = '\''
  for (let piece = random.integer(0, 8); piece > 0; piece--) text += plainCharacter(random, '\'')
  return `${text}'`
}
// A string of several lines in quotes: line ends, one or two quotes inside, a backslash at the end of a line, and
// sometimes one or two quotes right before the closing three.
function multiLineBasicText(generator: Generator) {
  const {random, lineEnd} = generator
  let text = `"""${random.chance(0.5) ? lineEnd : ''}`
  for (let piece = random.integer(0, 10); piece > 0; piece--) {
    const roll = random.next()
    if (roll < 0.15) text += lineEnd
    else if (roll < 0.25) text += escapeText(random)
    // One or two quotes, with a character after them so that they do not run into the closing quotes.
    else if (roll < 0.35) text += random.pick(['"', '""']) + random.pick([plainCharacter(random, '"\\'), lineEnd, escapeText(random)])
    else if (roll < 0.45) text += `\\${random.pick(['', ' ', '  \t'])}${lineEnd}${random.pick(['', '  ', lineEnd, `\t${lineEnd}  `])}`
    else text += plainCharacter(random, '"\\')
  }
  return `${text}${random.pick(['', '', '', '"', '""'])}"""`
}
function multiLineLiteralText(generator: Generator) {
  const {random, lineEnd} = generator
  let text = `'''${random.chance(0.5) ? lineEnd : ''}`
  for (let piece = random.integer(0, 10); piece > 0; piece--) {
    const roll = random.next()
    if (roll < 0.2) text += lineEnd
    else if (roll < 0.35) text += random.pick(['\'', '\'\'']) + random.pick([plainCharacter(random, '\''), lineEnd])
    else text += plainCharacter(random, '\'')
  }
  return `${text}${random.pick(['', '', '', '\'', '\'\''])}'''`
}

// White space, comments and line ends between the values of an array.
function arrayFiller(generator: Generator) {
  const {random, lineEnd} = generator
  const roll = random.next()
  if (roll < 0.45) return random.pick(['', ' ', ' ', '  ', '\t'])
  if (roll < 0.8) return `${lineEnd}${random.pick(['', '  ', '    ', '\t'])}`
  return `${random.pick(['', ' '])}#${commentText(random)}${lineEnd}${random.pick(['', '  '])}`
}

// A key without quotes of random characters, e.g. `0a`, `-_T9` or `e`: most start like a number or a literal and then
// turn out to be a key.
const bareKeyCharacters = Array.from('0123456789abcdefilnorstuxzABCDEFTUZGgkQ_-')
function randomBareKey(random: Random) {
  let text = ''
  for (let character = random.integer(1, 6); character > 0; character--) text += random.pick(bareKeyCharacters)
  return text
}

// A key that is new in its table, with dots in some. `used` holds the first parts of the keys of the table so far, so
// a dotted key never goes into a table that another key made.
function keyText(generator: Generator, used: Set<string>): string {
  const {random} = generator
  const roll = random.next()
  if (roll < 0.2) {
    const [text, parts] = random.pick(valueLikeKeys)
    if (!used.has(parts[0]!)) {
      used.add(parts[0]!)
      return text
    }
  } else if (roll < 0.35) {
    const [text, name] = random.pick(quotedKeys)
    if (!used.has(name)) {
      used.add(name)
      return text
    }
  } else if (roll < 0.5) {
    const text = randomBareKey(random)
    if (!used.has(text)) {
      used.add(text)
      return text
    }
  }
  // A name with a new number. A key of random characters can have taken it, e.g. `T4`, so the number goes on until
  // the name is new.
  let name = `${random.pick(bareNames)}${generator.nextName++}`
  while (used.has(name)) name = `${random.pick(bareNames)}${generator.nextName++}`
  used.add(name)
  if (!random.chance(0.2)) return name
  // A dotted key: more parts after the new first one, which may repeat no name of the table.
  let text = name
  for (let part = random.integer(1, 3); part > 0; part--) {
    const dot = random.pick(['.', '.', '.', ' . ', '. ', ' .', '\t.\t'])
    text += dot + random.pick([random.pick(bareNames), randomBareKey(random), randomBareKey(random), '1', '5e3', 'true', '"q r"', '\'s\'', '-', '2026-01-01', '0x'])
  }
  return text
}

function valueText(generator: Generator, depth: number): string {
  const {random} = generator
  const roll = random.next()
  if (roll < 0.14) return basicStringText(random)
  if (roll < 0.2) return literalStringText(random)
  if (roll < 0.25) return multiLineBasicText(generator)
  if (roll < 0.29) return multiLineLiteralText(generator)
  if (roll < 0.43) return integerText(random)
  if (roll < 0.55) return floatText(random)
  if (roll < 0.63) return random.pick(['true', 'false'])
  if (roll < 0.77) return dateOrTimeText(random)
  // The containers get rarer with the depth, so that documents stay small.
  if (depth >= 5 || random.chance(depth * 0.15)) return integerText(random)
  return roll < 0.9 ? arrayText(generator, depth + 1) : inlineTableText(generator, depth + 1)
}

function arrayText(generator: Generator, depth: number): string {
  const {random} = generator
  const count = random.integer(0, 4)
  if (count === 0) return random.pick(['[]', '[ ]', `[${arrayFiller(generator)}]`])
  let text = '['
  for (let item = 0; item < count; item++) {
    text += arrayFiller(generator) + valueText(generator, depth) + arrayFiller(generator)
    if (item < count - 1 || random.chance(0.3)) text += ','
  }
  return `${text}${arrayFiller(generator)}]`
}

function inlineTableText(generator: Generator, depth: number): string {
  const {random} = generator
  const count = random.integer(0, 3)
  const space = () => random.pick(['', ' ', ' ', '  ', '\t'])
  if (count === 0) return random.pick(['{}', '{ }', '{\t}'])
  const used = new Set<string>()
  const members = Array.from({length: count}, () => `${space()}${keyText(generator, used)}${space()}=${space()}${valueText(generator, depth)}${space()}`)
  return `{${members.join(',')}}`
}

// Containers nested to exactly `depth`, arrays and inline tables in a random order. The innermost one holds values of
// every kind but containers, so that e.g. a dotted key and a comment are read at depth 16 too.
function deepValueText(generator: Generator, depth: number): string {
  const {random} = generator
  const depthWithoutContainers = 5
  let text = random.chance(0.5) ? arrayText(generator, depthWithoutContainers) : inlineTableText(generator, depthWithoutContainers)
  for (let level = 1; level < depth; level++) {
    const roll = random.next()
    text = roll < 0.4 ? `[${text}]` : roll < 0.5 ? `[${arrayFiller(generator)}${text}${arrayFiller(generator)}]` : roll < 0.9 ? `{k = ${text}}` : `{ k.l = 1, "m" = ${text} }`
  }
  return text
}

// One valid document of at most `capacity` code points.
export function validDocument(seed: number): string {
  const random = createRandom(seed)
  const generator: Generator = {random, lineEnd: random.chance(0.15) ? '\r\n' : '\n', nextName: 1}
  const {lineEnd} = generator
  const target = random.integer(20, capacity)
  // The first parts of the keys of the table that the lines go into, and the names of the tables so far.
  let used = new Set<string>()
  const topLevelNames = used
  const tableNames: string[] = []
  const arrayTableNames: string[] = []
  const lines: string[] = []
  let length = 0
  const trailing = () => `${random.pick(['', '', ' ', '  ', '\t'])}${random.chance(0.2) ? `#${commentText(random)}` : ''}`
  const indent = () => random.pick(['', '', '', '  ', '\t'])
  for (let attempt = 0; attempt < 60 && length < target; attempt++) {
    const roll = random.next()
    let line: string
    let startsTable = false
    if (roll < 0.08) {
      line = random.pick(['', '', '  ', '\t'])
    } else if (roll < 0.16) {
      line = `${indent()}#${commentText(random)}`
    } else if (roll < 0.3) {
      // A header: a new table, a new array of tables, one more entry of an array of tables, or a table below one.
      const headerRoll = random.next()
      const space = () => random.pick(['', '', ' ', '\t'])
      let name: string
      let brackets = 1
      if (headerRoll < 0.2 && arrayTableNames.length > 0) {
        name = random.pick(arrayTableNames)
        brackets = 2
      } else if (headerRoll < 0.4 && tableNames.length + arrayTableNames.length > 0) {
        name = `${random.pick([...tableNames, ...arrayTableNames])}${random.pick(['.', ' . '])}below${generator.nextName++}`
      } else {
        name = keyText(generator, topLevelNames)
        // A name with a dot or in quotes is used once. A plain one may get entries and tables below it.
        const plain = /^[A-Za-z]+[0-9]+$/.test(name)
        if (random.chance(0.4)) {
          brackets = 2
          if (plain) arrayTableNames.push(name)
        } else if (plain) {
          tableNames.push(name)
        }
      }
      line = `${indent()}${'['.repeat(brackets)}${space()}${name}${space()}${']'.repeat(brackets)}${trailing()}`
      startsTable = true
    } else if (roll < 0.33) {
      line = `${indent()}${keyText(generator, used)} = ${deepValueText(generator, random.pick([maximumDepth, maximumDepth, maximumDepth - 1, 8]))}${trailing()}`
    } else {
      const equals = random.pick([' = ', ' = ', ' = ', '=', ' =', '= ', '\t=\t', '  =  '])
      line = `${indent()}${keyText(generator, used)}${equals}${valueText(generator, 0)}${trailing()}`
    }
    const lineLength = Array.from(line).length + lineEnd.length
    if (length + lineLength > capacity) continue
    lines.push(line)
    length += lineLength
    // The keys of the lines after a header go into a new table. A header that did not fit starts none.
    if (startsTable) used = new Set<string>()
  }
  const text = lines.join(lineEnd)
  // The last line has a line end or not.
  return lines.length > 0 && random.chance(0.8) ? text + lineEnd : text
}

// What random edits put into a text: the characters that TOML's grammar reads, and a few words of other notations.
const insertedPieces = [
  '"', '"', '\'', '\\', '#', '=', '=', '.', ',', ',', '[', ']', '[', ']', '{', '}', ':', '+', '-', '_', ' ', ' ', '\t', '\n', '\n', '\r', '\r\n',
  '0', '1', '7', '9', 'a', 'e', 'E', 'x', 'o', 'b', 't', 'f', 'i', 'n', 'T', 'Z', 'z', 'u', 'U', 'é', '\u0000', '\u007f', '\u00a0', '!', ';', '/',
  '"""', '\'\'\'', '[[', ']]', 'true', 'false', 'null', 'inf', 'nan', ' = ', ': ', ', ', '.5', '1e', '0x', '00', '07:32:00', '1979-05-27', 'T07', '\\u00', '\\x41', '\\e',
  ',}', ',]', '\n}', '{\n', ' #', '[x]', 'a = 1', '\na = 1\n', '\n[t]\n',
]

// A text with one to three random edits: a code point or a piece is removed, added, replaced, doubled or moved, a line
// is removed or doubled, two lines are joined, or the text is cut off. The result has at most `capacity` code points.
// It is often invalid and sometimes still valid.
export function damagedText(text: string, seed: number): string {
  const random = createRandom(seed)
  let codePoints = Array.from(text)
  for (let edit = random.pick([1, 1, 1, 2, 3]); edit > 0; edit--) {
    const before = codePoints
    const length = codePoints.length
    const at = random.integer(0, Math.max(0, length - 1))
    const span = random.integer(1, random.pick([1, 1, 2, 4, 10]))
    const roll = random.next()
    if (roll < 0.2) {
      codePoints = [...codePoints.slice(0, at), ...codePoints.slice(at + span)]
    } else if (roll < 0.45) {
      const insertAt = random.integer(0, length)
      codePoints = [...codePoints.slice(0, insertAt), ...Array.from(random.pick(insertedPieces)), ...codePoints.slice(insertAt)]
    } else if (roll < 0.6) {
      codePoints = [...codePoints.slice(0, at), ...Array.from(random.pick(insertedPieces)), ...codePoints.slice(at + 1)]
    } else if (roll < 0.68) {
      codePoints = [...codePoints.slice(0, at), ...codePoints.slice(at, at + span), ...codePoints.slice(at)]
    } else if (roll < 0.74 && length >= 2) {
      const first = random.integer(0, length - 2)
      codePoints = [...codePoints.slice(0, first), codePoints[first + 1]!, codePoints[first]!, ...codePoints.slice(first + 2)]
    } else if (roll < 0.82) {
      codePoints = codePoints.slice(0, at)
    } else {
      // The lines with their ends. One is removed or doubled, or loses its end, which joins it to the next line.
      const lines = codePoints.join('').split(/(?<=\n)/)
      const line = random.integer(0, lines.length - 1)
      const lineRoll = random.next()
      if (lineRoll < 0.4) lines.splice(line, 1)
      else if (lineRoll < 0.7) lines.splice(line, 0, lines[line]!)
      else lines[line] = lines[line]!.replace(/\r?\n$/, random.pick(['', ' ']))
      codePoints = Array.from(lines.join(''))
    }
    if (codePoints.length > capacity) codePoints = before
  }
  return codePoints.join('')
}
