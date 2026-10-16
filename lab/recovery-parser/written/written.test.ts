// The tools of the written evaluation set: the file format, the alignment of a broken text with a valid one, the
// agreement of several opinions, and the score.
// Run from the repo root: bun test lab/recovery-parser
import {expect, test} from 'bun:test'
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {displayKind} from '../../../src/json-search/highlighter/kinds.ts'
import {kinds} from '../damage.ts'
import {handRuleTables, handRules} from '../hand-rules.ts'
import {defaultSeed, sampleAt} from '../samples.ts'
import {defaultTables} from '../table-parser.ts'
import {align, standsFor} from './align.ts'
import {agreementWithDataset, writtenCasesAgainstDataset} from './check-align.ts'
import {caseNotes, caseProblems} from './check-cases.ts'
import {overlapWithSamples, textsOfSet} from './check-overlap.ts'
import {repairNotes} from './check-repairs.ts'
import {type CaseEntry, caseFileText, linesOfText, mistypedNames, partFileText, readCaseFile, readPartFile, readRepairFile, repairFileText, textOfLines} from './format.ts'
import {type Score, scoreCases, scoreTables} from './score.ts'
import {changesOf, describeCase, describeOpinions, whiteSpaceOnlyChanges} from './show.ts'
import {blindIdOf, brokenTextProblems, caseOf, labelsOfWritten, readWritten, scoredCodePointsOfWritten, validTextProblems, writtenFolder} from './written.ts'

// The set of the folder, read once for all the tests that look at it.
let setOfFolder: ReturnType<typeof readWritten> | undefined
const theSet = () => setOfFolder ??= readWritten()

// Texts that a file format gets wrong when it quotes or escapes: each must come back as it went in.
const awkwardTexts = [
  '{"path": "C:\\\\Users\\\\zoe", "quote": "she said \\"hi\\""}',
  '{"a": "C:\\Users\\zoe"}',
  '{\n\t"tabs": true\n}',
  '\ufeff{\r\n  "bom and carriage returns": 1\r\n}\r\n',
  '{"a":\u00a01,\u2003"b":\u200b2}',
  '\u001b[32m{"ok": true}\u001b[0m',
  'no line feed at the end',
  'one line feed at the end\n',
  'three line feeds at the end\n\n\n',
  '\n\nstarts with two line feeds',
  '\n',
  'a space at the end \nand on the last line ',
  '   ',
  'empty lines\n\n\nin the middle',
  'the brackets ⟦ and ⟧ and a name that is none: ⟦tab⟧ ⟦end⟧',
  '⟦end⟧',
  '⟦case fake⟧\n⟦broken⟧\nlines that look like markers\n⟦end⟧',
  '👨\u200d👩 and a lone \u0000 and \u007f and \u2028',
  '',
]

const charactersThatCannotBeSeen = ['\t', '\r', '\u00a0', '\ufeff', '\u001b', '\u200b', '\u200d', '\u2003', '\u2028', '\u0000', '\u007f']

test('a text comes back from its lines as it went in', () => {
  for (const text of awkwardTexts) {
    const lines = linesOfText(text)
    for (const line of lines) {
      // What a file shows is what the text holds: no character that cannot be seen, and no space at a line's end.
      expect(Array.from(line).filter(character => charactersThatCannotBeSeen.includes(character))).toEqual([])
      expect(line.endsWith(' ')).toBe(false)
    }
    if (lines.length > 0) {
      expect(lines[0]).not.toBe('')
      expect(lines.at(-1)).not.toBe('')
    }
    expect(textOfLines(lines, 1)).toEqual({text, problems: []})
  }
})

test('case files, part files and repair files come back as they went in', () => {
  const cases: Omit<CaseEntry, 'line'>[] = awkwardTexts.map((text, index) => ({
    id: `awkward-${index}`, from: 'a test with "quotes" and a \\ backslash', note: index % 2 === 0 ? 'a note: with a colon' : undefined, debatable: index % 3 === 0,
    intended: text, broken: awkwardTexts[(index + 1) % awkwardTexts.length]!,
  }))
  const readCases = readCaseFile(caseFileText(cases))
  expect(readCases.problems).toEqual([])
  expect(readCases.items.map(({line: _line, ...rest}) => rest)).toEqual(cases)
  const parts = cases.map(entry => ({id: blindIdOf(entry.broken), broken: entry.broken}))
  const readParts = readPartFile(partFileText(parts))
  expect(readParts.problems).toEqual([])
  expect(readParts.items.map(({line: _line, ...rest}) => rest)).toEqual(parts)
  const repairs = cases.map((entry, index) => ({id: blindIdOf(entry.broken), repaired: entry.intended, unsure: index % 2 === 0 ? 'the other reading' : undefined}))
  const readRepairs = readRepairFile(repairFileText(repairs))
  expect(readRepairs.problems).toEqual([])
  expect(readRepairs.items.map(({line: _line, ...rest}) => rest)).toEqual(repairs)
})

test('a file that does not show what its texts hold is refused', () => {
  const file = (lines: string[]) => `${lines.join('\n')}\n`
  const good = ['⟦case good-1⟧', 'from: a test', '⟦intended⟧', '{"a": 1}', '⟦broken⟧', '{"a": 1,}', '⟦end⟧']
  expect(readCaseFile(file(good))).toEqual({items: [{id: 'good-1', from: 'a test', note: undefined, debatable: false, intended: '{"a": 1}', broken: '{"a": 1,}', line: 1}], problems: []})
  const problemsOf = (lines: string[]) => readCaseFile(file(lines)).problems.join('\n')
  const changed = (from: string, to: string[]) => good.flatMap(line => line === from ? to : [line])
  expect(problemsOf(changed('{"a": 1,}', ['{\t"a": 1,}']))).toContain('⟦tab⟧')
  expect(problemsOf(changed('{"a": 1,}', ['{"a":\u00a01,}']))).toContain('⟦nbsp⟧')
  expect(problemsOf(changed('{"a": 1,}', ['{"a": 1,} ']))).toContain('ends with a space')
  expect(problemsOf(changed('{"a": 1,}', ['{"a": 1,}', '']))).toContain('ends with an empty line')
  expect(problemsOf(changed('{"a": 1,}', ['', '{"a": 1,}']))).toContain('starts with an empty line')
  expect(problemsOf(changed('{"a": 1,}', ['{"a": ⟦tabb⟧1,}']))).toContain('names no character')
  expect(problemsOf(changed('{"a": 1,}', ['{"a": ⟦tab 1,}']))).toContain('without ⟧')
  expect(problemsOf(changed('{"a": 1,}', ['{"a": 1,}⟧']))).toContain('⟦U+27E7⟧')
  expect(problemsOf(changed('⟦end⟧', ['  ⟦end⟧']))).toContain('a marker stands alone on its line')
  expect(problemsOf(changed('⟦end⟧', []))).toContain('has no ⟦end⟧ line')
  expect(problemsOf(changed('from: a test', []))).toContain('from: …')
  expect(problemsOf(changed('from: a test', ['from: a test', 'debatable: yes']))).toContain('alone on its line')
  expect(problemsOf(changed('from: a test', ['from: a test', 'kind: trailing comma']))).toContain('"kind"')
  expect(problemsOf(changed('⟦broken⟧', ['⟦repaired⟧']))).toContain('⟦broken⟧ is missing')
  expect(problemsOf([...good, ...good])).toContain('the id stands twice')
  expect(problemsOf(['some text', ...good])).toContain('outside an entry')
  expect(readCaseFile(good.join('\r\n')).problems.join('\n')).toContain('carriage returns')
  // A problem in one entry leaves the entries after it readable.
  const second = good.map(line => line.replace('good-1', 'good-2'))
  expect(readCaseFile(file([...changed('{"a": 1,}', ['{\t"a": 1,}']), '', ...second])).items.map(entry => entry.id)).toEqual(['good-2'])
  // The marks of a case and of a repair.
  expect(readCaseFile(file(changed('from: a test', ['from: a test', 'note: why', 'debatable']))).items[0]).toMatchObject({note: 'why', debatable: true})
  expect(readRepairFile(file(['⟦repair 0a1b2c3d⟧', 'unsure: the other reading', '⟦repaired⟧', '{"a": 1}', '⟦end⟧'])).items).toEqual([{id: '0a1b2c3d', repaired: '{"a": 1}', unsure: 'the other reading', line: 1}])
  expect(readRepairFile(file(good)).problems.join('\n')).toContain('⟦repair id⟧')
  expect(mistypedNames('{"a":[[tab]]1, "b": "<U+00A0>", "c": [1, 2]}')).toEqual(['[[tab]]', '<U+00A0>'])
})

// A broken text, the valid text, and under each code point of the broken text: . kept, ~ in the place of another,
// + added.
const pairs: [broken: string, valid: string, marks: string][] = [
  // Single quotes stand for double quotes.
  ['{\'a\': 1}', '{"a": 1}', '.~.~....'],
  // A word of another notation is added as a whole, and a literal that only lost its end is kept.
  ['{"a": True}', '{"a": true}', '......++++.'],
  ['{"m": nil}', '{"m": null}', '......+++.'],
  ['{"a": tru, "b": 1}', '{"a": true, "b": 1}', '..................'],
  ['{"lat": 59., "lon": .5}', '{"lat": 59.0, "lon": 0.5}', '.......................'],
  ['{"paid": ture}', '{"paid": true}', '.........++++.'],
  // A number is kept when text is added around it or between its digits.
  ['{"n": NumberLong(15)}', '{"n": 15}', '......+++++++++++..+.'],
  ['{"total": 1,400,000}', '{"total": 1400000}', '...........+...+....'],
  // Of two equal code points the later one is the added one, and text before the whole original stays there.
  ['[[1]]]', '[[1]]', '.....+'],
  ['{{"a": 1}', '{"a": 1}', '.+.......'],
  ['2026-06-19 12:23:40 ERROR 20142', '20142', '++++++++++++++++++++++++++.....'],
  ['{\n  // note\n  "a": 1\n}', '{\n  "a": 1\n}', '....++++++++++........'],
  // = stands for the colon, with and without spaces around the arrow.
  ['{"id"=>42}', '{"id": 42}', '.....~+...'],
  ['{"id" => 42}', '{"id": 42}', '.....+~+....'],
  // Round brackets for an array, no-break spaces for the indentation, and a quote before an added comma.
  ['{"point": (12.5, 41.9)}', '{"point": [12.5, 41.9]}', '..........~..........~.'],
  ['{\n\u00a0\u00a0"a": 1\n}', '{\n  "a": 1\n}', '..~~........'],
  ['[\'a\', \'b\',]', '["a", "b"]', '.~.~..~.~+.'],
  // Only removals.
  ['{"a": 1 "b": 2}', '{"a": 1, "b": 2}', '...............'],
  ['{a: 1}', '{"a": 1}', '......'],
  ['{"note": "call "Ana" back"}', '{"note": "call \\"Ana\\" back"}', '...........................'],
  // A long shared run is kept first: the sentence is added, and the start of the document is kept.
  ['Here is the record you asked for:\n{"version": "0.2.0", "con', '{"version": "0.2.0", "configurations": [{"type": "lldb", "request": "launch"}]}', `${'+'.repeat(34)}${'.'.repeat(25)}`],
  // No letter of a marker is paired with a letter of the part that is missing, also when the missing part is short.
  ['{"name": "Ada", "tags": ["x... [truncated]', '{"name": "Ada", "tags": ["x-ray", "urgent", "retired"]}', `${'.'.repeat(27)}${'+'.repeat(15)}`],
  ['{"name": "Ada", "tags": ["x... [truncated]', '{"name": "Ada", "tags": ["x"]}', `${'.'.repeat(27)}${'+'.repeat(15)}`],
  // Text before the whole original is no marker at a cut: the start of the literal after it is kept.
  ['```json\nnul', 'null', '++++++++...'],
  // The brace at the end is kept after a word of another notation.
  ['{"ok": FALSE\n}', '{"ok": false\n}', '.......+++++..'],
  ['{ id: 1, name: \'Ada\', manager: undefined }', '{"id": 1, "name": "Ada", "manager": null}', '.+.............~...~...........++++++++++.'],
  // What stands between two replacements of one kind is kept, however short: `&quot;` stands for every quote here.
  ['{&quot;id&quot;:7,&quot;tags&quot;:[&quot;a&quot;,&quot;b&quot;]}', '{"id":7,"tags":["a","b"]}', '.++++++..++++++...++++++....++++++..++++++.++++++.++++++.++++++..'],
  // The space between two dashes that each stand for two hyphens.
  ['{"note": "tea – –milk"}', '{"note": "tea -- --milk"}', '..............+.+......'],
  // The document's first brace is kept after a log prefix, before the `#012` that stands for every line feed.
  ['Mar  3 08:15:42 host7 app[311]: {#012  "level": "warn",#012  "code": 7#012}', '{\n  "level": "warn",\n  "code": 7\n}', `${'+'.repeat(32)}.++++${'.'.repeat(18)}++++${'.'.repeat(11)}++++.`],
  // The document's last braces are kept between a line that is missing and a closing code fence.
  ['```json\n{"job": {\n  "steps": [\n    {"id": 1}\n}}\n```', '{"job": {\n  "steps": [\n    {"id": 1}\n  ]\n}}', `${'+'.repeat(8)}${'.'.repeat(39)}++++`],
  // So is the brace between a word of another notation and a code fence, and the bracket between a fence and a word.
  ['{"value": NaN}\n```', '{"value": null}', '..........+++.++++'],
  ['```json\n[NaN, 1]', '[null, 1]', '++++++++.+++....'],
  // No letter of a notice after the cut is paired, also where only one or two letters of the notice stand between
  // two letters that the missing part holds too, and its bracket is not the bracket that ends the document.
  ['[{"state": "queu...\n\n[Preview ends here]  Open the whole file', '[{"state": "queued", "tries": 1}]', `${'.'.repeat(16)}${'+'.repeat(45)}`],
  // The bracket that ends a marker does not stand for the one bracket that is missing.
  ['{"period":null\n[output truncated]', '{"period":null}', `${'.'.repeat(14)}${'+'.repeat(19)}`],
  // What is before the cut is kept: the digits of a number that is cut off before a quote, which is no part of a
  // word, and the `":` after an added backslash.
  ['write(2, "{\\"job\\":77,\\"size\\":409"..., 24) = 24', '{"job":77,"size":4096}', `${'+'.repeat(10)}.+....+.....+.....+.....${'+'.repeat(14)}`],
  ['write(2, "{\\"job\\":77,\\"size\\":"..., 24) = 24', '{"job":77,"size":4096}', `${'+'.repeat(10)}.+....+.....+.....+..${'+'.repeat(14)}`],
  // The placeholder `%t` is another word than `true`, and a literal with two letters swapped is another word too.
  ['{"verified": %t, "score": %d}', '{"verified": true, "score": 12}', '.............++...........++.'],
  ['{"k": unll}', '{"k": null}', '......++++.'],
]

test('the alignment of pairs made by hand', () => {
  for (const [broken, valid, marks] of pairs) {
    const {alignment, replaced} = align(broken, valid)
    const brokenCodePoints = Array.from(broken)
    const validCodePoints = Array.from(valid)
    expect([broken, alignment.map((counterpart, position) => counterpart === -1 ? '+' : replaced[position] === true ? '~' : '.').join('')]).toEqual([broken, marks])
    // The counterparts rise, a kept code point is its counterpart, and one in the place of another is not.
    let before = -1
    alignment.forEach((counterpart, position) => {
      if (counterpart === -1) {
        expect(replaced[position]).toBe(false)
        return
      }
      expect(counterpart).toBeGreaterThan(before)
      before = counterpart
      expect(brokenCodePoints[position] === validCodePoints[counterpart]).toBe(replaced[position] === false)
      if (replaced[position] === true) expect(standsFor(brokenCodePoints[position]!, validCodePoints[counterpart]!)).toBe(true)
    })
  }
})

test('which code point is which, where the marks do not say it', () => {
  // The literal that lost its end: the comma after it is the comma after the whole literal.
  expect(align('{"a": tru, "b": 1}', '{"a": true, "b": 1}').alignment.slice(6, 11)).toEqual([6, 7, 8, 10, 11])
  // The quote after the half of a key is the key's own closing quote, and no quote of the value that is missing.
  expect(align('{"exclu"\n}', '{"exclude": ["dist"]\n}').alignment).toEqual([0, 1, 2, 3, 4, 5, 6, 9, 20, 21])
  // A quote that opens the next key is left with that key: the string before it is open.
  expect(align('{"cons"stop": false}', '{"console": "integratedTerminal", "stop": false}').alignment.slice(5, 8)).toEqual([5, 34, 35])
  // The comma that is added before a line end is the added one, and the line feed after it is kept.
  expect(align('{"a": 1,\n}\n', '{"a": 1\n}\n').alignment).toEqual([0, 1, 2, 3, 4, 5, 6, -1, 7, 8, 9])
  // The quotes that lost their backslash are the second halves of the escapes.
  expect(align('{"note": "call "Ana" back"}', '{"note": "call \\"Ana\\" back"}').alignment.slice(14, 21)).toEqual([14, 16, 17, 18, 19, 21, 22])
})

test('align.ts gives the dataset\'s alignment for most generated samples', () => {
  const {total} = agreementWithDataset(defaultSeed, 600)
  expect(total.samples).toBeGreaterThan(500)
  expect(total.sameAlignment / total.samples).toBeGreaterThan(0.95)
  expect(total.sameLabels / total.samples).toBeGreaterThan(0.95)
  expect(total.sameLabelCodePoints / total.codePoints).toBeGreaterThan(0.999)
  // A code point with another label than the dataset's is the kind of difference that would spoil a score.
  expect(total.otherLabel / total.codePoints).toBeLessThan(0.0001)
})

test('a generated sample as a written case has the dataset\'s scored labels, and the readers score the same', () => {
  const written = writtenCasesAgainstDataset(defaultSeed, 600)
  expect(written.sameScoredLabels / written.samples).toBeGreaterThan(0.95)
  for (const {byDataset, asWritten} of written.readers) {
    expect(Math.abs(asWritten.right / asWritten.scored - byDataset.right / byDataset.scored)).toBeLessThan(0.005)
    expect(Math.abs(asWritten.wholeRight / asWritten.withSomething - byDataset.wholeRight / byDataset.withSomething)).toBeLessThan(0.02)
  }
})

const madeUp = {
  id: 'made-up-1', from: 'a test', note: undefined, debatable: false,
  // A comma is missing after the 1, the Python word None stands for null, and a comma follows the last entry.
  intended: '{"a": 1, "b": null}',
  broken: '{"a": 1 "b": None,}',
}

test('three opinions about a made-up case', () => {
  const writtenCase = caseOf(madeUp, 'made-up.txt', [
    {name: 'part-1.a', repaired: '{"a": 1, "b": null}', unsure: undefined},
    // The second repairer takes None for a string that lost its quotes.
    {name: 'part-1.b', repaired: '{"a": 1, "b": "None"}', unsure: 'None could be the string "None"'},
  ])
  expect(writtenCase.opinions.map(opinion => opinion.name)).toEqual(['writer', 'part-1.a', 'part-1.b'])
  const marksOf = (index: number) => writtenCase.opinions[index]!.alignment.map(counterpart => counterpart === -1 ? '+' : '.').join('')
  //                        {"a": 1 "b": None,}
  expect(marksOf(0)).toBe('.............+++++.')
  expect(marksOf(1)).toBe(marksOf(0))
  expect(marksOf(2)).toBe('.................+.')
  expect(writtenCase.agreement.map(state => state === 'agreed' ? '.' : state === 'added' ? '+' : '!').join('')).toBe('.............!!!!+.')
  // The parser as it is reports its first error at the quote of "b", where a comma was expected.
  expect(writtenCase.firstErrorPosition).toBe(8)
  // The first damaged code point is the space before it: the first kept code point after the comma that is missing.
  expect(writtenCase.firstDamage).toBe(7)
  expect(writtenCase.disputedFromFirstError).toBe(true)
  expect(writtenCase.blindId).toBe(blindIdOf(madeUp.broken))
  expect(writtenCase.opinions[2]!.unsure).toBe('None could be the string "None"')
  const labels = labelsOfWritten(writtenCase)
  // The key "b" is a key at depth 1 inside an object by every opinion.
  for (const position of [8, 9, 10]) expect(labels[position]).toEqual({kind: displayKind.key, depth: 1, container: 1})
  // A disputed code point and one that every opinion calls added have no label, and the last brace closes the object.
  for (const position of [13, 14, 15, 16, 17]) expect(labels[position]).toBeUndefined()
  expect(labels[18]).toEqual({kind: displayKind.punctuation, depth: 0, container: 0})
  // From the first error on: "b": and the space after it, and the last brace.
  expect(scoredCodePointsOfWritten(writtenCase)).toBe(6)
  expect(describeOpinions(writtenCase)).toContain('agree          .............!!!!+.')
})

test('a value that an opinion does not score is no dispute with another opinion', () => {
  // A `]` is missing after the entry of "teams". The writer has it on a line of its own, and the repair has it
  // right after the brace, so the line feed after the brace is inside the array by the one and after it by the other.
  const texts = {...madeUp, intended: '{"teams": [\n  {"id": 1}\n],\n"count": 1}', broken: '{"teams": [\n  {"id": 1}\n,\n"count": 1}'}
  const writtenCase = caseOf(texts, 'made-up.txt', [{name: 'part-1.a', repaired: '{"teams": [\n  {"id": 1}]\n,\n"count": 1}', unsure: undefined}])
  const lineFeed = texts.broken.indexOf('\n,')
  expect(writtenCase.opinions.map(opinion => opinion.labels[lineFeed]!.depth)).toEqual([2, 1])
  // The repair's reading does not score the depth there, since a bracket is missing before the line feed, so the two
  // opinions agree, and the label has the display kind alone.
  expect(writtenCase.agreement[lineFeed]).toBe('agreed')
  expect(labelsOfWritten(writtenCase)[lineFeed]).toEqual({kind: displayKind.whitespace, depth: undefined, container: undefined})
  expect(writtenCase.agreement).not.toContain('disputed')
  // A display kind that both opinions score still makes a dispute.
  const otherKind = caseOf(madeUp, 'made-up.txt', [{name: 'part-1.a', repaired: '{"a": 1, "b": "None"}', unsure: undefined}])
  expect(otherKind.agreement).toContain('disputed')
})

test('the display kind of the digits after a leading zero is not scored', () => {
  // A file mode without quotes, which the writer means as a string.
  const texts = {...madeUp, intended: '{"mode": "0644", "owner": "www-data"}', broken: '{"mode": 0644, "owner": "www-data"}'}
  const asString = labelsOfWritten(caseOf(texts, 'made-up.txt'))
  for (const position of [9, 10, 11, 12]) expect(asString[position]).toEqual({kind: undefined, depth: 1, container: 1})
  // A repair that means the number 644 calls the zero added, so the zero is disputed, and the opinions agree on the
  // three digits after it, whose display kind neither reading scores.
  const both = caseOf(texts, 'made-up.txt', [{name: 'part-1.a', repaired: '{"mode": 644, "owner": "www-data"}', unsure: undefined}])
  expect(both.agreement.slice(9, 13).join()).toBe('disputed,agreed,agreed,agreed')
  for (const position of [10, 11, 12]) expect(labelsOfWritten(both)[position]).toEqual({kind: undefined, depth: 1, container: 1})
  expect(both.disputedFromFirstError).toBe(false)
  // The rule is for a value that is digits alone. A time without quotes is scored as a string after its first digit,
  const time = {...madeUp, intended: '{"open": "09:00", "days": 5}', broken: '{"open": 09:00, "days": 5}'}
  expect(labelsOfWritten(caseOf(time, 'made-up.txt')).slice(9, 14).map(label => label?.kind)).toEqual([undefined, displayKind.string, displayKind.string, displayKind.string, displayKind.string])
  // the digits of a number after a line feed that a window's edge put into it stay a number,
  const wrappedNumber = {...madeUp, intended: '[0.5, 0.0102, 3]', broken: '[0.5, 0.01\n02, 3]'}
  expect(labelsOfWritten(caseOf(wrappedNumber, 'made-up.txt')).slice(11, 13).map(label => label?.kind)).toEqual([displayKind.number, displayKind.number])
  // and so do digits inside a string between quotes.
  const quoted = {...madeUp, intended: '{"note": "call 0800 now", "ok": true}', broken: '{"note": "call 0800 now", "ok": true,}'}
  expect(labelsOfWritten(caseOf(quoted, 'made-up.txt')).slice(15, 19).map(label => label?.kind)).toEqual(new Array<number>(4).fill(displayKind.string))
})

test('a repair that left-out.txt names is no opinion of its case', () => {
  const folder = mkdtempSync(join(tmpdir(), 'written-'))
  mkdirSync(join(folder, 'cases'))
  mkdirSync(join(folder, 'repairs'))
  const texts = {...madeUp, intended: '{"retries": 3, "timeout": 30}', broken: '{"retries": 3, "timeout": 30,}'}
  const id = blindIdOf(texts.broken)
  writeFileSync(join(folder, 'cases', 'made-up.txt'), caseFileText([texts]))
  writeFileSync(join(folder, 'repairs', 'part-1.a.txt'), repairFileText([{id, repaired: texts.intended, unsure: undefined}]))
  // The second repair lays the text out anew, against the rule.
  writeFileSync(join(folder, 'repairs', 'part-1.b.txt'), repairFileText([{id, repaired: '{\n  "retries": 3,\n  "timeout": 30\n}', unsure: undefined}]))
  expect(readWritten(folder).cases[0]!.opinions.map(opinion => opinion.name)).toEqual(['writer', 'part-1.a', 'part-1.b'])
  writeFileSync(join(folder, 'left-out.txt'), `part-1.b ${id} lays the text out anew\n`)
  const {cases, problems} = readWritten(folder)
  expect(problems).toEqual([])
  expect(cases[0]!.opinions.map(opinion => opinion.name)).toEqual(['writer', 'part-1.a'])
  expect(cases[0]!.leftOut).toEqual([{name: 'part-1.b', reason: 'lays the text out anew'}])
  // A line that names no repair of the folder, and a line in another form, are problems.
  writeFileSync(join(folder, 'left-out.txt'), `part-1.c ${id} lays the text out anew\nsome other line\n`)
  expect(readWritten(folder).problems.map(problem => problem.slice(0, 40))).toEqual(['left-out.txt: repairs/part-1.c.txt has n', 'left-out.txt: a line is the name of a re'])
})

// A variable of a template stands where a number is meant, as the generator's kind templatePlaceholder writes it.
const withPlaceholder = {
  id: 'made-up-4', from: 'a test', note: undefined, debatable: false,
  intended: '{"userId": 48213, "active": true}',
  broken: '{"userId": {{user_id}}, "active": true}',
}
const placeholder = {position: 11, text: '{{user_id}}', reason: 'a variable of a template'}

test('text that no-label.txt names has no label and is no dispute', () => {
  // The writer has a number in the variable's place, and the repair puts quotes around the variable.
  const repairs = [{name: 'part-1.a', repaired: '{"userId": "{{user_id}}", "active": true}', unsure: undefined}]
  const withoutList = caseOf(withPlaceholder, 'made-up.txt', repairs)
  expect(withoutList.agreement.slice(11, 22).join()).toBe(new Array<string>(11).fill('disputed').join())
  expect(withoutList.disputedFromFirstError).toBe(true)
  const withList = caseOf(withPlaceholder, 'made-up.txt', repairs, [], [placeholder])
  expect(withList.agreement.slice(11, 22).join()).toBe(new Array<string>(11).fill('noLabel').join())
  expect(withList.agreement).not.toContain('disputed')
  expect(withList.disputedFromFirstError).toBe(false)
  expect(withList.noLabel).toEqual([placeholder])
  const labels = labelsOfWritten(withList)
  for (let position = 11; position < 22; position++) expect(labels[position]).toBeUndefined()
  // The code points around the variable keep their labels, and a score counts the 17 from the comma on: the parser
  // as it is reports its first error at the variable's second brace.
  expect(labels[10]).toEqual({kind: displayKind.whitespace, depth: 1, container: 1})
  expect(labels[22]).toEqual({kind: displayKind.punctuation, depth: 1, container: 1})
  expect(withList.firstErrorPosition).toBe(12)
  expect(scoredCodePointsOfWritten(withList)).toBe(17)
  expect(describeOpinions(withList)).toContain('agree          ...........-----------.................')
  expect(describeOpinions(withList)).toContain('without a label by no-label.txt, at 11: "{{user_id}}", a variable of a template')
  // The same holds where every opinion takes the variable for a string that lost its quotes, which a score would
  // otherwise count as a string.
  const asString = {...withPlaceholder, intended: '{"userId": "{{user_id}}", "active": true}'}
  expect(scoredCodePointsOfWritten(caseOf(asString, 'made-up.txt', repairs))).toBe(27)
  expect(scoredCodePointsOfWritten(caseOf(asString, 'made-up.txt', repairs, [], [placeholder]))).toBe(17)
  // A line feed in the place of a space, inside a string that a mail program wrapped.
  const wrapped = {...madeUp, intended: '{"note": "resync after the failure", "ok": true}', broken: '{"note": "resync after\nthe failure", "ok": true}'}
  const lineFeed = wrapped.broken.indexOf('\n')
  expect(labelsOfWritten(caseOf(wrapped, 'made-up.txt'))[lineFeed]).toEqual({kind: displayKind.string, depth: 1, container: 1})
  expect(labelsOfWritten(caseOf(wrapped, 'made-up.txt', [], [], [{position: lineFeed, text: '\n', reason: 'a wrapped line'}]))[lineFeed]).toBeUndefined()
  // An entry whose text does not stand at its position is refused.
  expect(() => caseOf(withPlaceholder, 'made-up.txt', repairs, [], [{...placeholder, position: 12}])).toThrow('does not have "{{user_id}}" at code point 12')
})

test('readWritten takes the texts of no-label.txt, and a line that names none is a problem', () => {
  const folder = mkdtempSync(join(tmpdir(), 'written-'))
  mkdirSync(join(folder, 'cases'))
  mkdirSync(join(folder, 'repairs'))
  const wrapped = {...madeUp, id: 'made-up-5', intended: '{"note": "resync after the failure", "ok": true}', broken: '{"note": "resync after\nthe failure", "ok": true}'}
  writeFileSync(join(folder, 'cases', 'made-up.txt'), caseFileText([withPlaceholder, wrapped, madeUp]))
  writeFileSync(join(folder, 'repairs', 'part-1.a.txt'), repairFileText([{id: blindIdOf(withPlaceholder.broken), repaired: '{"userId": "{{user_id}}", "active": true}', unsure: undefined}]))
  const lines = (...entries: string[]) => writeFileSync(join(folder, 'no-label.txt'), `${entries.join('\n')}\n`)
  // A line that starts with # explains the file, and a line feed is written as in a case file.
  lines('# what the file is for', '', 'made-up-4 11 a variable of a template: {{user_id}}', 'made-up-5 22 a wrapped line: ⟦lf⟧')
  const {cases, problems} = readWritten(folder)
  expect(problems).toEqual([])
  expect(cases.map(writtenCase => writtenCase.noLabel)).toEqual([[placeholder], [{position: 22, text: '\n', reason: 'a wrapped line'}], []])
  expect(cases[0]!.agreement).not.toContain('disputed')
  // The text is not at the position, the case is not in the folder, two lines name the same text, a line in another
  // form, and text that every opinion calls added, here the word None of the third case.
  const problemOf = (...entries: string[]) => {
    lines(...entries)
    return readWritten(folder).problems.join('\n')
  }
  expect(problemOf('made-up-4 12 a variable of a template: {{user_id}}')).toContain('no-label.txt, line 1: the broken text does not have "{{user_id}}" at code point 12, where "{user_id}}," stands')
  expect(problemOf('made-up-9 11 a variable of a template: {{user_id}}')).toContain('no-label.txt, line 1: no case has the id made-up-9')
  expect(problemOf('made-up-4 11 a variable of a template: {{user_id}}', 'made-up-4 13 its name: user_id')).toContain('no-label.txt, line 2: the text overlaps the text of another line of the case')
  expect(problemOf('made-up-4 {{user_id}}')).toContain('no-label.txt, line 1: a line is the id of a case')
  expect(problemOf('made-up-4 11 a tab that cannot be seen: {{user\t_id}}')).toContain('no-label.txt, line 1: the text: ')
  expect(problemOf('made-up-1 13 a word of Python: None')).toContain('every opinion of the case made-up-1 calls "None" at code point 13 added')
})

test('the list of the set: no placeholder and no line feed for a space is scored', () => {
  const {cases} = theSet()
  const listed = cases.filter(writtenCase => writtenCase.noLabel.length > 0)
  expect(listed.length).toBeGreaterThan(0)
  for (const writtenCase of listed) {
    const labels = labelsOfWritten(writtenCase)
    for (const entry of writtenCase.noLabel) {
      Array.from(entry.text).forEach((_, offset) => expect([writtenCase.id, entry.position + offset, writtenCase.agreement[entry.position + offset], labels[entry.position + offset]]).toEqual([writtenCase.id, entry.position + offset, 'noLabel', undefined]))
    }
  }
  // The variable of documents-and-web-33 stands where its `from` line says that a number will stand, and all three
  // opinions put quotes around it. Its first brace reads as valid JSON, and none of the 11 code points after it, which
  // a score would count, has a label.
  const saved = cases.find(writtenCase => writtenCase.id === 'documents-and-web-33')!
  const variable = saved.broken.indexOf('{{order_id}}')
  expect(saved.opinions.map(opinion => opinion.text.includes('"{{order_id}}"'))).toEqual([true, true, true])
  expect(saved.firstErrorPosition).toBe(variable + 1)
  const savedLabels = labelsOfWritten(saved)
  for (let position = variable; position < variable + 12; position++) expect(savedLabels[position]).toBeUndefined()
  expect(saved.disputedFromFirstError).toBe(false)
  // In no case of the set is a line feed scored that an opinion takes for a space inside a string.
  for (const writtenCase of cases) {
    const broken = Array.from(writtenCase.broken)
    const labels = labelsOfWritten(writtenCase)
    for (const opinion of writtenCase.opinions) {
      const valid = Array.from(opinion.text)
      opinion.alignment.forEach((counterpart, position) => {
        if (broken[position] === '\n' && valid[counterpart] === ' ' && opinion.labels[position]!.kind === displayKind.string) expect([writtenCase.id, position, labels[position]]).toEqual([writtenCase.id, position, undefined])
      })
    }
  }
})

test('a case with the writer\'s opinion alone, and its score', () => {
  const writtenCase = caseOf(madeUp, 'made-up.txt')
  expect(writtenCase.opinions.length).toBe(1)
  expect(writtenCase.agreement.join()).not.toContain('disputed')
  expect(writtenCase.disputedFromFirstError).toBe(false)
  expect(scoredCodePointsOfWritten(writtenCase)).toBe(6)
  expect(writtenCase).toMatchObject({original: madeUp.intended, documents: [madeUp.intended], lineEnd: '\n', needsNestingFix: false, needsDisplayFix: false, debatable: false})
  expect(changesOf(writtenCase.opinions[0]!, madeUp.broken)).toEqual(['removed before 7: ","', 'added at 13 to 17: "None,"', 'removed before 18: "null"'])
  expect(describeCase(writtenCase)).toContain('brok  {"a": 1 "b": None,}')
  // The parser as it is shows "b" as a string and everything after the word None as an error, and the hand rule
  // `words` reads the text as the labels say.
  const now = scoreCases(defaultTables, [writtenCase])
  expect(now).toMatchObject({cases: 1, nothingToRecover: 0, scored: 6, wholeRight: 0})
  expect(now.right).toBeLessThan(6)
  expect(scoreCases(handRuleTables('words'), [writtenCase])).toMatchObject({scored: 6, right: 6, wholeRight: 1})
  // A text that is cut off has nothing to recover, and counts as a case without being right or wrong.
  const cutOff = caseOf({...madeUp, id: 'made-up-2', intended: '{"id": 42, "name": "Ada Lovelace"}', broken: '{"id": 42, "name": "Ada Lovel'}, 'made-up.txt')
  expect(scoreCases(defaultTables, [cutOff])).toMatchObject({cases: 1, nothingToRecover: 1, scored: 0, wholeRight: 0})
  // scoreTables counts the cases with full agreement apart, per file too.
  const disputed = caseOf({...madeUp, id: 'made-up-3'}, 'other.txt', [{name: 'part-1.b', repaired: '{"a": 1, "b": "None"}', unsure: undefined}])
  const scores = scoreTables(handRuleTables('words'), [writtenCase, cutOff, disputed])
  expect(scores.all.fullAgreement).toMatchObject({cases: 2, scored: 6})
  expect(scores.all.agreedCodePoints).toMatchObject({cases: 3, scored: 12})
  expect([...scores.perFile.keys()]).toEqual(['made-up.txt', 'other.txt'])
  expect(scores.perFile.get('other.txt')!.fullAgreement.cases).toBe(0)
  // These three cases have no line of kinds.txt, so they are in neither of the two parts that the file makes.
  expect([scores.generatorKinds.agreedCodePoints.cases, scores.otherDamage.agreedCodePoints.cases, scores.unmarked.agreedCodePoints.cases]).toEqual([0, 0, 3])
})

test('scoreTables scores the two parts that kinds.txt makes, and the cases that nobody marked', () => {
  const sameRepair = {name: 'part-1.a', repaired: madeUp.intended, unsure: undefined}
  const cases = [
    caseOf(madeUp, 'made-up.txt', [sameRepair], [], [], {kinds: ['missingComma', 'foreignLiteral', 'trailingComma'], other: undefined}),
    // The same texts with damage that no kind makes, with a writer's mark, with a repairer's mark, and with a dispute.
    caseOf({...madeUp, id: 'made-up-6'}, 'made-up.txt', [sameRepair], [], [], {kinds: ['missingComma'], other: 'something that no kind makes'}),
    caseOf({...madeUp, id: 'made-up-7', debatable: true}, 'made-up.txt', [sameRepair], [], [], {kinds: ['missingComma'], other: undefined}),
    caseOf({...madeUp, id: 'made-up-8'}, 'made-up.txt', [{...sameRepair, unsure: 'None could be a string'}], [], [], {kinds: [], other: 'something that no kind makes'}),
    caseOf({...madeUp, id: 'made-up-9'}, 'made-up.txt', [{...sameRepair, repaired: '{"a": 1, "b": "None"}'}], [], [], {kinds: ['missingComma'], other: undefined}),
  ]
  const scores = scoreTables(handRuleTables('words'), cases)
  const counts = (pick: (score: typeof scores) => {fullAgreement: Score, agreedCodePoints: Score}) => [pick(scores).fullAgreement.cases, pick(scores).agreedCodePoints.cases]
  expect(counts(score => score.all)).toEqual([4, 5])
  expect(counts(score => score.generatorKinds)).toEqual([2, 3])
  expect(counts(score => score.otherDamage)).toEqual([2, 2])
  expect(counts(score => score.unmarked)).toEqual([2, 3])
  expect(scores.generatorKinds.fullAgreement.scored + scores.otherDamage.fullAgreement.scored).toBe(scores.all.fullAgreement.scored)
})

test('readWritten takes the lines of kinds.txt, and a case without a line is a problem', () => {
  const folder = mkdtempSync(join(tmpdir(), 'written-'))
  mkdirSync(join(folder, 'cases'))
  writeFileSync(join(folder, 'cases', 'made-up.txt'), caseFileText([withPlaceholder, madeUp]))
  // Without the file no case has a judgment, and nothing is wrong.
  expect(readWritten(folder).cases.map(writtenCase => writtenCase.damage)).toEqual([undefined, undefined])
  expect(readWritten(folder).problems).toEqual([])
  const lines = (...entries: string[]) => writeFileSync(join(folder, 'kinds.txt'), `${entries.join('\n')}\n`)
  lines('# what the file is for', '', 'made-up-4 templatePlaceholder', 'made-up-1 missingComma foreignLiteral new: a comma after a word of Python')
  const {cases, problems} = readWritten(folder)
  expect(problems).toEqual([])
  expect(cases.map(writtenCase => writtenCase.damage)).toEqual([{kinds: ['templatePlaceholder'], other: undefined}, {kinds: ['missingComma', 'foreignLiteral'], other: 'a comma after a word of Python'}])
  // A case with no kind at all has only the damage that no kind makes.
  lines('made-up-4 new: a variable of a template', 'made-up-1 missingComma')
  expect(readWritten(folder).cases[0]!.damage).toEqual({kinds: [], other: 'a variable of a template'})
  const problemOf = (...entries: string[]) => {
    lines(...entries)
    return readWritten(folder).problems
  }
  expect(problemOf('made-up-4 templatePlaceholder')).toEqual(['kinds.txt: the case made-up-1 has no line'])
  expect(problemOf('made-up-4 templatePlaceholder', 'made-up-1 missingcomma')).toEqual(['kinds.txt, line 2: missingcomma is no kind of the table of kinds in the dataset\'s README'])
  expect(problemOf('made-up-4 templatePlaceholder', 'made-up-1 missingComma', 'made-up-1 trailingComma')).toEqual(['kinds.txt, line 3: the case has a line before this one'])
  expect(problemOf('made-up-4 templatePlaceholder', 'made-up-1 missingComma', 'made-up-9 trailingComma')).toEqual(['kinds.txt, line 3: no case has the id made-up-9'])
  expect(problemOf('made-up-4', 'made-up-1 missingComma')).toEqual(['kinds.txt, line 1: the line names no kind and no damage that no kind makes'])
  expect(problemOf('made-up-4 templatePlaceholder templatePlaceholder', 'made-up-1 missingComma')).toEqual(['kinds.txt, line 1: a kind stands twice'])
  expect(problemOf('made-up-4 templatePlaceholder, ellipsis', 'made-up-1 missingComma').join()).toContain('kinds.txt, line 1: a line is the id of a case')
})

test('kinds.txt names every case of the set, with kinds of the generator', () => {
  const {cases, problems} = theSet()
  expect(problems).toEqual([])
  const names = new Set(kinds.map(kind => kind.name))
  for (const writtenCase of cases) {
    expect([writtenCase.id, writtenCase.damage === undefined]).toEqual([writtenCase.id, false])
    const {kinds: named, other} = writtenCase.damage!
    expect([writtenCase.id, named.filter(name => !names.has(name))]).toEqual([writtenCase.id, []])
    // A case has a kind, or damage that no kind makes, which the file says in a few words.
    expect(named.length > 0 || other !== undefined).toBe(true)
    if (other !== undefined) expect(other.split(' ').length).toBeGreaterThan(3)
    // What no-label.txt names is damage of a kind: a placeholder, with the marker that Node prints for a container,
    // and a raw line feed in a string.
    for (const entry of writtenCase.noLabel) {
      expect([writtenCase.id, entry.text === '\n' ? named.includes('rawLineFeedInString') : named.includes('templatePlaceholder') || named.includes('ellipsis')]).toEqual([writtenCase.id, true])
    }
  }
  // The two parts are the whole set, and the page states their sizes.
  const scores = scoreTables(defaultTables, cases)
  const withOther = cases.filter(writtenCase => writtenCase.damage!.other !== undefined)
  expect(scores.generatorKinds.agreedCodePoints.cases + scores.otherDamage.agreedCodePoints.cases).toBe(cases.length)
  expect(scores.generatorKinds.fullAgreement.cases + scores.otherDamage.fullAgreement.cases).toBe(scores.all.fullAgreement.cases)
  expect(scores.otherDamage.agreedCodePoints.cases).toBe(withOther.length)
  const readme = readFileSync(join(writtenFolder, 'README.md'), 'utf8')
  expect(readme).toContain(`| All | ${cases.length - withOther.length} | ${withOther.length} |`)
  expect(readme).toContain(`${cases.length - withOther.length} of their cases have only damage that the generator's kinds also make, in other documents and in other words, and ${withOther.length} have damage that no kind makes`)
  expect(readFileSync(join(writtenFolder, '..', 'README.md'), 'utf8')).toContain(`${cases.length - withOther.length} of their cases have only damage that the kinds above also make, and ${withOther.length} have damage that no kind makes`)
  for (const file of new Set(cases.map(writtenCase => writtenCase.file))) {
    const ofFile = cases.filter(writtenCase => writtenCase.file === file)
    const other = ofFile.filter(writtenCase => writtenCase.damage!.other !== undefined).length
    expect(readme).toContain(`| \`${file}\` | ${ofFile.length - other} | ${other} |`)
  }
})

test('what the checks say about texts that cannot be a case', () => {
  expect(validTextProblems('{"a": 1}')).toEqual([])
  expect(validTextProblems('{"a": 1,}').join()).toContain('not valid JSON')
  expect(validTextProblems(`[${'1,'.repeat(300)}1]`).join()).toContain('code points')
  expect(validTextProblems(`${'['.repeat(17)}${']'.repeat(17)}`).join()).toContain('16 levels')
  // Two documents, one per line, are no intended text.
  expect(validTextProblems('{"a": 1}\n{"a": 2}\n').join()).toContain('not valid JSON')
  expect(brokenTextProblems('{"a": 1,}')).toEqual([])
  expect(brokenTextProblems('{"a": 1}').join()).toContain('valid JSON')
  // An open string hides 16 closing brackets, and the parser as it is then counts a 17th level.
  expect(brokenTextProblems(`${'['.repeat(16)}"${']'.repeat(16)}"[`).join()).toContain('more than 16 open brackets')
  expect(caseProblems({intended: '[1]', broken: '[1,]'}).join()).toContain('20 to 500')
  expect(caseProblems({intended: '{"retries": 3, "timeout": 30}', broken: '{"retries": 3, "timeout": 30,}'})).toEqual([])
  // A broken text that is laid out anew, and white space that goes with text around the document.
  const laidOutAnew = caseOf({...madeUp, intended: '{\n    "retries": 3,\n    "timeout": 30,\n    "hosts": ["a", "b"]\n}', broken: '{"retries":3,"timeout":30,"hosts":["a","b"],}'}, 'made-up.txt')
  expect(changesOf(laidOutAnew.opinions[0]!, laidOutAnew.broken).length).toBeGreaterThan(8)
  const withFence = caseOf({...madeUp, intended: '{"retries": 3, "timeout": 30}\n', broken: '```json\n{"retries": 3, "timeout": 30}\n```\n'}, 'made-up.txt')
  expect(caseNotes(withFence).join()).toContain('ends with white space')
  const reformatted = caseOf({...madeUp, intended: '{\n  "a": 1,\n  "b": null\n}', broken: madeUp.broken}, 'made-up.txt')
  expect(repairNotes(reformatted).join()).toContain('white space code points that the broken text lacks')
  // A raw line feed in the place of the two characters \n is no place that differs by white space alone, and the
  // space that a diff puts before every unchanged line is.
  const rawLineFeeds = caseOf({...madeUp, intended: '{"a": "1\\n2", "b": "3\\n4", "c": "5\\n6"}', broken: '{"a": "1\n2", "b": "3\n4", "c": "5\n6"}'}, 'made-up.txt')
  expect(whiteSpaceOnlyChanges(rawLineFeeds.opinions[0]!, rawLineFeeds.broken)).toBe(0)
  expect(caseNotes(rawLineFeeds).join()).not.toContain('white space alone')
  const diff = caseOf({...madeUp, intended: '{\n"a": 1,\n"b": 2,\n"c": 3\n}', broken: ' {\n "a": 1,\n+"b": 2,\n "c": 3\n }'}, 'made-up.txt')
  expect(whiteSpaceOnlyChanges(diff.opinions[0]!, diff.broken)).toBe(4)
  expect(caseNotes(diff).join()).toContain('white space alone in 4 places')
})

// The fenced blocks of a markdown file, each without its fence lines.
function fencedBlocks(markdown: string): string[] {
  const blocks: string[] = []
  const lines = markdown.split('\n')
  for (let index = 0; index < lines.length; index++) {
    const fence = /^(`{3,})/.exec(lines[index]!)?.[1]
    if (fence === undefined) continue
    const block: string[] = []
    for (index++; index < lines.length && lines[index] !== fence; index++) block.push(lines[index]!)
    blocks.push(`${block.join('\n')}\n`)
  }
  return blocks
}

test('the examples of README.md and of REPAIR.md are what the two pages say', () => {
  const caseBlocks = fencedBlocks(readFileSync(join(writtenFolder, 'README.md'), 'utf8')).filter(block => block.startsWith('⟦case'))
  expect(caseBlocks.length).toBe(3)
  const read = readCaseFile(caseBlocks.join('\n'))
  expect(read.problems).toEqual([])
  expect(read.items.map(entry => entry.id)).toEqual(['python-print-01', 'model-answer-01', 'windows-file-01'])
  for (const entry of read.items) {
    expect(caseProblems(entry)).toEqual([])
    expect(caseNotes(caseOf(entry, 'README.md'))).toEqual([])
  }
  expect(read.items[1]!.broken.endsWith('```\n')).toBe(true)
  expect(read.items[2]).toMatchObject({debatable: true, broken: '\ufeff{\r\n\t"name": "Zoë"\r\n\t"path": "C:\\Users\\zoe"\r\n}'})
  // What the page prints for its first case is what the check prints.
  const printed = fencedBlocks(readFileSync(join(writtenFolder, 'README.md'), 'utf8')).find(block => block.startsWith('--- python-print-01'))
  expect(printed).toBe(`${describeCase(caseOf(read.items[0]!, 'README.md'))}\n`)

  const repairBlocks = fencedBlocks(readFileSync(join(writtenFolder, 'REPAIR.md'), 'utf8'))
  const part = readPartFile(repairBlocks.find(block => block.startsWith('⟦case'))!)
  const repairs = readRepairFile(repairBlocks.find(block => block.startsWith('⟦repair'))!)
  expect([part.problems, repairs.problems]).toEqual([[], []])
  expect(part.items.length).toBe(3)
  expect(repairs.items.map(repair => repair.id)).toEqual(part.items.map(entry => entry.id))
  for (const [index, entry] of part.items.entries()) {
    const repair = repairs.items[index]!
    // An id of a part file is the hash of its broken text.
    expect(entry.id).toBe(blindIdOf(entry.broken))
    expect([brokenTextProblems(entry.broken), validTextProblems(repair.repaired)]).toEqual([[], []])
    expect(repairNotes(caseOf({id: entry.id, from: '', note: undefined, debatable: false, intended: repair.repaired, broken: entry.broken}, 'REPAIR.md'))).toEqual([])
  }
  const unsure = caseOf({id: part.items[1]!.id, from: '', note: undefined, debatable: false, intended: repairs.items[1]!.repaired, broken: part.items[1]!.broken}, 'REPAIR.md')
  unsure.opinions[0]!.unsure = repairs.items[1]!.unsure
  expect(repairBlocks.find(block => block.startsWith('--- 62b4f3bc'))).toBe(`${describeCase(unsure, 'rep')}\n`)
})

test('the README has the numbers that score.ts gives', () => {
  const {cases} = theSet()
  const readers = [defaultTables, ...handRules.map(rule => handRuleTables(rule))].map(tables => scoreTables(tables, cases))
  const percent = (part: number, whole: number) => (100 * part / whole).toFixed(1)
  const row = (name: string, pick: (score: typeof readers[number]) => Score) => {
    const first = pick(readers[0]!)
    const cells = readers.map(score => `${percent(pick(score).right, pick(score).scored)} / ${percent(pick(score).wholeRight, pick(score).cases - pick(score).nothingToRecover)}`)
    return `| ${name} | ${first.cases} | ${first.nothingToRecover} | ${first.scored.toLocaleString('en-US')} | ${cells.join(' | ')} |`
  }
  const readme = readFileSync(join(writtenFolder, 'README.md'), 'utf8')
  expect(readme).toContain(row('Cases with full agreement', score => score.all.fullAgreement))
  expect(readme).toContain(row('All cases, the agreed code points', score => score.all.agreedCodePoints))
  expect(readme).toContain(row('Full agreement, damage of the generator\'s kinds alone', score => score.generatorKinds.fullAgreement))
  expect(readme).toContain(row('Full agreement, with damage that no kind makes', score => score.otherDamage.fullAgreement))
  expect(readme).toContain(row('Full agreement, marked by nobody as debatable or unsure', score => score.unmarked.fullAgreement))
  expect(readme).toContain(row('Agreed code points, damage of the generator\'s kinds alone', score => score.generatorKinds.agreedCodePoints))
  expect(readme).toContain(row('Agreed code points, with damage that no kind makes', score => score.otherDamage.agreedCodePoints))
  for (const file of readers[0]!.perFile.keys()) expect(readme).toContain(row(`\`${file}\`, full agreement`, score => score.perFile.get(file)!.fullAgreement))
  const disputed = cases.filter(writtenCase => writtenCase.disputedFromFirstError)
  const disputedCodePoints = disputed.reduce((total, writtenCase) => total + writtenCase.agreement.filter((state, position) => state === 'disputed' && position >= writtenCase.firstErrorPosition).length, 0)
  expect(readme).toContain(`| All | ${cases.length} | ${cases.length - disputed.length} | ${disputed.length} |`)
  expect(readme).toContain(`They stay disputed, with ${disputedCodePoints} code points`)
  // What becomes of the code points from the first error on, and how many cases have opinions that are one text.
  const fromFirstError = (wanted: string) => cases.reduce((total, writtenCase) => total + writtenCase.agreement.filter((state, position) => state === wanted && position >= writtenCase.firstErrorPosition).length, 0)
  const scored = cases.reduce((total, writtenCase) => total + scoredCodePointsOfWritten(writtenCase), 0)
  const counted = (value: number) => value.toLocaleString('en-US')
  expect(readme).toContain(`Of these, ${counted(scored)} are scored, ${counted(fromFirstError('added'))} are added by every opinion, ${counted(fromFirstError('noLabel'))} have no label by the list of \`no-label.txt\`, and ${counted(fromFirstError('disputed'))} are disputed.`)
  const oneText = cases.filter(writtenCase => writtenCase.opinions.every(opinion => opinion.text === writtenCase.original))
  expect(readme).toContain(`In ${oneText.length} cases all opinions are the same text, and in ${cases.length - disputed.length - oneText.filter(writtenCase => !writtenCase.disputedFromFirstError).length} more they differ without a disputed code point from the first error on`)
  // Every case that the page names as disputed is, and the page names every disputed case.
  for (const writtenCase of disputed) expect(readme).toContain(`\`${writtenCase.id}\``)
  expect(cases.flatMap(writtenCase => writtenCase.leftOut.map(() => writtenCase.id))).toEqual(['logs-and-transport-11'])
})

test('a repair of the set that is left out changes no scored code point', () => {
  const {cases} = theSet()
  const withLeftOut = cases.filter(writtenCase => writtenCase.leftOut.length > 0)
  expect(withLeftOut.length).toBeGreaterThan(0)
  for (const writtenCase of withLeftOut) {
    // The case again with every repair of the folder as an opinion.
    const repairs = writtenCase.leftOut.map(({name}) => {
      const repair = readRepairFile(readFileSync(join(writtenFolder, 'repairs', `${name}.txt`), 'utf8')).items.find(entry => entry.id === writtenCase.blindId)!
      return {name, repaired: repair.repaired, unsure: repair.unsure}
    })
    const opinions = writtenCase.opinions.slice(1).map(opinion => ({name: opinion.name, repaired: opinion.text, unsure: opinion.unsure}))
    const texts = {id: writtenCase.id, from: writtenCase.from, note: writtenCase.note, debatable: writtenCase.debatable, intended: writtenCase.original, broken: writtenCase.broken}
    const withAll = caseOf(texts, writtenCase.file, [...opinions, ...repairs], [], writtenCase.noLabel)
    // Leaving the repair out is what gives the case full agreement, and every label that the case has with the repair
    // is the label that it has without it.
    expect([writtenCase.id, writtenCase.disputedFromFirstError, withAll.disputedFromFirstError]).toEqual([writtenCase.id, false, true])
    expect(scoredCodePointsOfWritten(withAll)).toBe(scoredCodePointsOfWritten(writtenCase))
    const labels = labelsOfWritten(writtenCase)
    labelsOfWritten(withAll).forEach((label, position) => { if (label !== undefined) expect(label).toEqual(labels[position]!) })
  }
})

test('no text of the set is among generated samples, and a text that is among them is found', () => {
  // Every case with both of its repairs, also the repair that is left out.
  const cases = textsOfSet(writtenFolder, theSet().cases)
  expect(cases.length).toBe(theSet().cases.length)
  expect(cases.filter(entry => entry.repairs.length !== 2)).toEqual([])
  const sampleCount = 300
  const none = overlapWithSamples(cases, sampleCount)
  expect([none.broken, none.intended, none.repairs]).toEqual([[], [], []])
  expect(none.brokenSamples).toBeGreaterThan(250)
  // A case that is a generated sample is found by its two texts, and a repair by its JSON value in another layout.
  const sample = Array.from({length: sampleCount}, (_, index) => sampleAt(defaultSeed, index)).find(candidate => candidate.source === 'damage' && candidate.documents.length === 1 && candidate.original.startsWith('{'))!
  const laidOutAnew = JSON.stringify(JSON.parse(sample.original), null, 7)
  const found = overlapWithSamples([{id: 'a-sample', broken: sample.broken, intended: sample.original, repairs: [laidOutAnew, '{"not": "a sample"}']}], sampleCount)
  expect([found.broken, found.intended, found.repairs]).toEqual([['a-sample'], ['a-sample'], ['a-sample']])
})

test('the cases and the repairs of the folder have no problem', () => {
  const {cases, problems} = theSet()
  expect(problems).toEqual([])
  // Every case of the set is within the rules that the check of a case file asks for.
  for (const writtenCase of cases) expect([writtenCase.id, caseProblems({intended: writtenCase.original, broken: writtenCase.broken})]).toEqual([writtenCase.id, []])
  expect(new Set(cases.map(writtenCase => writtenCase.blindId)).size).toBe(cases.length)
})
