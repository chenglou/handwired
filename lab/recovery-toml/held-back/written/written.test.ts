// Tests of the tools of the written set of broken TOML: the files' format, the labels that a repair gives, the values
// that are not scored, two repairs of one case, the score, the edits of the train data's damage that make a case's
// damage, the worked examples and the pages that print them.
//
// The texts of these tests are made up here. The test of the set itself, at the end, compares counts only, so that a
// failure prints no text of a held-back case.
import {expect, test} from 'bun:test'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {displayKind} from '../../kinds.ts'
import {classesOfTheChecks} from '../../learn/check-texts.ts'
import {addClasses, addFirstOnLineBit, asIsTables, openDisplayEntries} from '../../learn/recovery-tables.ts'
import {defaultTables} from '../../table-parser.ts'
import {parserAsItIs, restartAtNextLine} from '../parsers.ts'
import {caseNotes, shapeOf} from './check.ts'
import {differenceLines, differencesOf} from './compare.ts'
import {type Aligned, alignedOfLines, brokenFileText, linesOfAligned, linesOfText, readBrokenFile, readRepairFile, repairFileText, textOfLines} from './format.ts'
import {couldComeFromEdits, neutralEditsOf} from './neutral-edits.ts'
import {scoreCases, scoreCasesWith, scoreRecoveryTables, scoreTables, scoreWith} from './score.ts'
import {describeCase} from './show.ts'
import {
  alignmentProblems, brokenTextProblems, canStandFor, caseOf, labelsOfWritten, opinionOf, readWritten, readsAsNumberOrLiteral, repairProblems,
  scoredCodePointsOfWritten, slideChanges, validTextProblems, writtenFolder,
} from './written.ts'

// An aligned text from the lines of a file, written here as one string. A line feed at its start or its end is
// written here as it is, and goes into the lines as ⟦lf⟧, as a file has it. The text has no problem.
function alignedOf(text: string): Aligned {
  const [, leading, body, trailing] = /^(\n*)([\s\S]*?)(\n*)$/.exec(text)!
  const {aligned, problems} = alignedOfLines(`${'⟦lf⟧'.repeat(leading!.length)}${body!}${'⟦lf⟧'.repeat(trailing!.length)}`.split('\n'), 1)
  expect(problems).toEqual([])
  return aligned
}
const repairOf = (text: string, unsure?: string) => ({aligned: alignedOf(text), from: 'a made-up situation', note: undefined, unsure})
// A case with the writer's repair and, when given, a second repair, from aligned texts.
const madeCase = (writer: string, second?: string) => {
  const repair = repairOf(writer)
  return caseOf({id: 'made-01', broken: repair.aligned.broken}, 'made.txt', [{name: 'writer', repair}, ...(second === undefined ? [] : [{name: 'second' as const, repair: repairOf(second)}])])
}
const letters = 'wpsenlE.khc'
// The display kinds that a case's labels ask for, one letter per code point: a blank for no label, ? for a kind that
// is not scored.
const wantedKinds = (writtenCase: ReturnType<typeof madeCase>) => labelsOfWritten(writtenCase).map(label => label === undefined ? ' ' : label.kind === undefined ? '?' : letters[label.kind]!).join('')
const wantedDepths = (writtenCase: ReturnType<typeof madeCase>) => labelsOfWritten(writtenCase).map(label => label === undefined ? ' ' : label.depth === undefined ? '?' : String(label.depth)).join('')

test('a text comes back from its lines as it went in', () => {
  const texts = [
    'port = 8080', 'a = 1\nb = 2\n', '\n\na = 1\n\n\n', 'a = 1 \nb = 2  ', '\ta = "x\u00a0y"\r\n', '\ufeffa = 1', 'name = "⟦x⟧"', 'a = "\u200b\u001b[0m"', '', ' ',
    'a = 1\n\n\nb = 2', 'title = "東京 ☕"',
  ]
  for (const text of texts) {
    const lines = linesOfText(text)
    // No line holds a character that cannot be seen as itself, and none ends with a space.
    for (const line of lines) expect(line.endsWith(' ') || Array.from('\t\r\u00a0\ufeff\u200b\u001b').some(character => line.includes(character))).toBe(false)
    expect(textOfLines(lines, 1)).toEqual({text, problems: []})
  }
  expect(linesOfText('\ta = 1 \n')).toEqual(['⟦tab⟧a = 1⟦sp⟧⟦lf⟧'])
})

test('an aligned text gives the broken payload, the repaired document and which code point is which', () => {
  expect(alignedOf('port ⟦: for =⟧ 8080⟦extra⟧,⟦/⟧')).toEqual({
    broken: 'port : 8080,', repaired: 'port = 8080', alignment: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, -1],
    replaced: [false, false, false, false, false, true, false, false, false, false, false, false],
  })
  expect(alignedOf('host = ⟦missing⟧"⟦/⟧db⟦missing⟧"⟦/⟧')).toEqual({broken: 'host = db', repaired: 'host = "db"', alignment: [0, 1, 2, 3, 4, 5, 6, 8, 9], replaced: new Array<boolean>(9).fill(false)})
  // A run goes on over the lines of the file, and a name of a character that cannot be seen stands in it as anywhere.
  const wrapped = alignedOf('⟦extra⟧Here it is:\n\n⟦/⟧a⟦nbsp for sp⟧= 1⟦extra⟧⟦tab⟧# x⟦/⟧⟦lf⟧')
  expect(wrapped.broken).toBe('Here it is:\n\na\u00a0= 1\t# x\n')
  expect(wrapped.repaired).toBe('a = 1\n')
  expect(wrapped.alignment).toEqual([...new Array<number>(13).fill(-1), 0, 1, 2, 3, 4, -1, -1, -1, -1, 5])
  expect(wrapped.replaced[14]).toBe(true)
  // A text without marks changes nothing.
  expect(alignedOf('a = 1\nb = 2')).toEqual({broken: 'a = 1\nb = 2', repaired: 'a = 1\nb = 2', alignment: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], replaced: new Array<boolean>(11).fill(false)})
})

test('an aligned text comes back from its lines as it went in', () => {
  const texts = [
    'port ⟦: for =⟧ 8080⟦extra⟧,⟦/⟧', '⟦extra⟧Here it is:\n\n⟦/⟧a⟦nbsp for sp⟧= 1⟦extra⟧⟦tab⟧# x⟦/⟧⟦lf⟧', 'a = ⟦extra⟧True⟦/⟧⟦missing⟧true⟦/⟧\nb = 2⟦missing⟧\n⟦/⟧',
    'a = {⟦lf for sp⟧  b = 1⟦extra⟧, ⟦/⟧}', '⟦lf⟧a = 1⟦sp⟧\nb = ⟦missing⟧""⟦/⟧', 'a = ⟦“ for "⟧x⟦” for "⟧ ⟦extra⟧ ⟦/⟧',
  ]
  for (const text of texts) {
    const aligned = alignedOf(text)
    expect(alignedOfLines(linesOfAligned(aligned), 1)).toEqual({aligned, problems: []})
  }
})

test('a file that does not show what its texts hold, or whose marks do not fit, is refused', () => {
  const problemsOf = (text: string) => alignedOfLines(text.split('\n'), 1).problems.join(' | ')
  expect(problemsOf('a = 1 ')).toContain('ends with a space')
  expect(problemsOf('\ta = 1')).toContain('Write it as ⟦tab⟧')
  expect(problemsOf('a\u00a0= 1')).toContain('Write it as ⟦nbsp⟧')
  expect(problemsOf('\na = 1')).toContain('starts with an empty line')
  expect(problemsOf('a = 1\n')).toContain('ends with an empty line')
  expect(problemsOf('a = ⟦quote⟧')).toContain('names no character and is no mark')
  expect(problemsOf('a = ⟦extra⟧1')).toContain('has no ⟦/⟧')
  expect(problemsOf('a = 1⟦/⟧')).toContain('ends no run')
  expect(problemsOf('a = ⟦extra⟧⟦/⟧1')).toContain('is empty')
  expect(problemsOf('a = ⟦extra⟧x⟦missing⟧y⟦/⟧⟦/⟧')).toContain('a mark stands inside the run')
  expect(problemsOf('a ⟦= for =⟧ 1')).toContain('names the same code point twice')
  expect(problemsOf('a ⟦ab for =⟧ 1')).toContain('names no two code points')
  expect(problemsOf('a = 1⟦end⟧')).toContain('is a marker')
  expect(problemsOf('a = ⟦tab')).toContain('⟦ without ⟧')
  expect(textOfLines(['a = 1⟦extra⟧,⟦/⟧'], 1).problems.join(' | ')).toContain('a mark of an aligned text stands in a text that is no aligned text')

  const brokenFile = (text: string) => readBrokenFile(text).problems.join(' | ')
  expect(brokenFile('⟦case a-01⟧\n⟦broken⟧\na = 1\n')).toContain('has no ⟦end⟧ line')
  expect(brokenFile('⟦case a 01⟧\n⟦broken⟧\na = 1\n⟦end⟧\n')).toContain('an id is made of')
  expect(brokenFile('⟦case a-01⟧\nfrom: somewhere\n⟦broken⟧\na = 1\n⟦end⟧\n')).toContain('this file has no header lines')
  expect(brokenFile('⟦case a-01⟧\n⟦aligned⟧\na = 1\n⟦end⟧\n')).toContain('the section ⟦broken⟧ is missing')
  expect(brokenFile('a = 1\n')).toContain('outside an entry only empty lines can stand')
  expect(brokenFile('⟦case a-01⟧\n⟦broken⟧\na = 1\n⟦end⟧\n\n⟦case a-01⟧\n⟦broken⟧\nb = 1\n⟦end⟧\n')).toContain('the id stands twice')
  expect(brokenFile('⟦case a-01⟧\r\n⟦broken⟧\r\na = 1\r\n⟦end⟧\r\n')).toContain('carriage returns')
  const repairFile = (text: string, role: 'writer' | 'second') => readRepairFile(text, role).problems.join(' | ')
  expect(repairFile('⟦repair a-01⟧\n⟦aligned⟧\na = 1\n⟦end⟧\n', 'writer')).toContain('the line "from: …" is missing')
  expect(repairFile('⟦repair a-01⟧\n⟦aligned⟧\na = 1\n⟦end⟧\n', 'second')).toBe('')
  expect(repairFile('⟦repair a-01⟧\nfrom: somewhere\n⟦aligned⟧\na = 1\n⟦end⟧\n', 'second')).toContain('the header "from" is not one of note, unsure')
  expect(repairFile('⟦repair a-01⟧\nfrom: somewhere\nunsure:\n⟦aligned⟧\na = 1\n⟦end⟧\n', 'writer')).toContain('says the other reading in a sentence')
  expect(repairFile('⟦case a-01⟧\n⟦broken⟧\na = 1\n⟦end⟧\n', 'writer')).toContain('this file holds entries that start with ⟦repair id⟧')
})

test('files of broken payloads and repair files come back as they went in', () => {
  const broken = [{id: 'a-01', broken: 'port : 8080,\n'}, {id: 'a-02', broken: '\ta = "x\u00a0y" \r\n\n'}]
  expect(readBrokenFile(brokenFileText(broken))).toEqual({items: [{...broken[0]!, line: 1}, {...broken[1]!, line: 6}], problems: []})
  const repairs = [
    {id: 'a-01', aligned: alignedOf('port ⟦: for =⟧ 8080⟦extra⟧,⟦/⟧⟦lf⟧'), from: 'a config file edited by hand', note: undefined, unsure: 'the comma could start a second value'},
    {id: 'a-02', aligned: alignedOf('⟦extra⟧Here it is:\n\n⟦/⟧a = 1'), from: 'the answer of a language model', note: 'the sentence is no part of the file', unsure: undefined},
  ]
  const read = readRepairFile(repairFileText(repairs), 'writer')
  expect(read.problems).toEqual([])
  expect(read.items.map(({line: _line, ...repair}) => repair)).toEqual(repairs)
})

test('the alignment is put into one fixed form: of two equal code points the later one is extra or missing', () => {
  // Whichever = a repairer marks, the second one is extra.
  const first = slideChanges(alignedOf('a ⟦extra⟧=⟦/⟧= 1'))
  expect(first).toEqual(slideChanges(alignedOf('a =⟦extra⟧=⟦/⟧ 1')))
  expect(first.alignment).toEqual([0, 1, 2, -1, 3, 4])
  // A comment line that is extra as a whole line: its indentation keeps the label, and the next line's is extra.
  const line = slideChanges(alignedOf('[a]\n⟦extra⟧  // note\n⟦/⟧  b = 1'))
  expect(line.alignment).toEqual([0, 1, 2, 3, 4, 5, ...new Array<number>(10).fill(-1), 6, 7, 8, 9, 10])
  expect(line).toEqual(slideChanges(alignedOf('[a]\n  ⟦extra⟧// note\n  ⟦/⟧b = 1')))
  // After one move another can be open: of the three `a` the first two are kept.
  expect(slideChanges(alignedOf('⟦extra⟧a⟦/⟧a⟦extra⟧x⟦/⟧a = 1')).alignment).toEqual([0, 1, -1, -1, 2, 3, 4, 5])
  // An extra code point right before an equal kept one changes places with it, also at the end of a longer run.
  const doubled = slideChanges(alignedOf('tags = [1⟦extra⟧;,⟦/⟧, 2]'))
  expect(doubled.alignment).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, -1, 9, -1, 10, 11, 12])
  expect(doubled).toEqual(slideChanges(alignedOf('tags = [1⟦extra⟧;⟦/⟧,⟦extra⟧,⟦/⟧ 2]')))
  // A kept code point does not move into the middle of a run, onto an equal code point that is there by chance.
  expect(slideChanges(alignedOf('[a]\n⟦extra⟧# skip\n⟦/⟧key = 1')).alignment).toEqual([0, 1, 2, 3, ...new Array<number>(7).fill(-1), 4, 5, 6, 7, 8, 9, 10])
  // Of two brackets of which one is missing, the kept one is the first of the document.
  const bracket = slideChanges(alignedOf('x = ⟦missing⟧[⟦/⟧[1]]'))
  expect(bracket.alignment).toEqual([0, 1, 2, 3, 4, 6, 7, 8])
  expect(bracket).toEqual(slideChanges(alignedOf('x = [⟦missing⟧[⟦/⟧1]]')))
  // A code point that stands in the place of another is no equal code point.
  expect(slideChanges(alignedOf('a ⟦extra⟧:⟦/⟧⟦: for =⟧ 1')).alignment).toEqual([0, 1, -1, 2, 3, 4])
})

test('the fixed form of random alignments: still an alignment of the same two texts, and mostly the same for another marking of the same repair', () => {
  let state = 4242
  const random = (below: number) => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0
    return Math.floor((state / 0x100000000) * below)
  }
  let wrong = 0
  let otherMarkings = 0
  let otherForms = 0
  for (let round = 0; round < 200000; round++) {
    // Up to 13 steps over two to six letters: a step is an extra code point, a missing one, or one that both texts have.
    const broken: string[] = []
    const repaired: string[] = []
    const alignment: number[] = []
    const alphabet = ['ab', 'abc', 'ab \n', 'abcdef'][round % 4]!
    const length = 2 + random(12)
    for (let step = 0; step < length; step++) {
      const letter = alphabet[random(alphabet.length)]!
      const kind = random(5)
      if (kind === 1) repaired.push(letter)
      else {
        alignment.push(kind === 0 ? -1 : repaired.length)
        broken.push(letter)
        if (kind !== 0) repaired.push(letter)
      }
    }
    const aligned = {broken: broken.join(''), repaired: repaired.join(''), alignment, replaced: alignment.map(() => false)}
    const slid = slideChanges(aligned)
    // The fixed form pairs equal code points in the same order, keeps as many as before, and is its own fixed form.
    let last = -1
    let fine = slid.alignment.length === alignment.length && slid.alignment.filter(counterpart => counterpart !== -1).length === alignment.filter(counterpart => counterpart !== -1).length
    slid.alignment.forEach((counterpart, position) => {
      if (counterpart === -1) return
      if (counterpart <= last || broken[position] !== repaired[counterpart]) fine = false
      last = counterpart
    })
    if (!fine || slideChanges({...aligned, alignment: slid.alignment}).alignment.join() !== slid.alignment.join()) wrong++
    // Another marking of the same repair: one kept code point changes places with an equal extra neighbor, or with
    // the last code point of the extra run after it.
    const moved = [...alignment]
    const position = random(moved.length)
    if (moved[position] === -1) continue
    let to = -1
    if (random(2) === 0) {
      const neighbor = position + (random(2) === 0 ? 1 : -1)
      if (neighbor >= 0 && neighbor < moved.length && moved[neighbor] === -1 && broken[neighbor] === broken[position]) to = neighbor
    } else {
      let end = position + 1
      while (end < moved.length && moved[end] === -1) end++
      if (end - 1 > position && broken[end - 1] === broken[position] && (position === 0 || moved[position - 1] !== -1)) to = end - 1
    }
    if (to === -1) continue
    moved[to] = moved[position]!
    moved[position] = -1
    otherMarkings++
    if (slideChanges({...aligned, alignment: moved}).alignment.join() !== slid.alignment.join()) otherForms++
  }
  // These are the numbers of README.md.
  expect({wrong, otherMarkings, otherForms}).toEqual({wrong: 0, otherMarkings: 8169, otherForms: 16})
})

test('a code point takes the label of its counterpart, and an extra one has none', () => {
  const kindsOf = (text: string) => opinionOf('writer', repairOf(text)).labels.map(label => label === undefined ? ' ' : letters[label.kind]!).join('')
  expect(kindsOf('[server]\nport⟦: for =⟧ 8080⟦extra⟧,⟦/⟧ ⟦extra⟧//⟦/⟧⟦missing⟧#⟦/⟧ note')).toBe('phhhhhhpwkkkkpwnnnn w  ccccc')
  expect(kindsOf('tags = ⟦( for [⟧⟦“ for "⟧a⟦” for "⟧⟦; for ,⟧ 1⟦) for ]⟧')).toBe('kkkkwpwpssspwnp')
  // A word in the place of a literal has no label, whether it is marked as a whole or by its one changed letter.
  expect(kindsOf('debug = ⟦extra⟧True⟦/⟧⟦missing⟧true⟦/⟧')).toBe('kkkkkwpw    ')
  expect(kindsOf('debug = ⟦extra⟧T⟦/⟧⟦missing⟧t⟦/⟧rue')).toBe('kkkkkwpw    ')
  expect(kindsOf('debug = t⟦extra⟧u⟦/⟧r⟦missing⟧u⟦/⟧e')).toBe('kkkkkwpw    ')
  expect(kindsOf('count = 1⟦extra⟧O⟦/⟧⟦missing⟧0⟦/⟧0')).toBe('kkkkkwpw   ')
  // A literal or a number that only lacks code points keeps its labels, and so does one with text added to it.
  expect(kindsOf('debug = tru⟦missing⟧e⟦/⟧')).toBe('kkkkkwpwlll')
  expect(kindsOf('ratio = ⟦missing⟧0⟦/⟧.5')).toBe('kkkkkwpwnn')
  expect(kindsOf('count = 1⟦extra⟧,⟦/⟧000')).toBe('kkkkkwpwn nnn')
  expect(kindsOf('wait = 30⟦extra⟧s⟦/⟧')).toBe('kkkkwpwnn ')
  const depths = opinionOf('writer', repairOf('a = {b = [1,⟦extra⟧,⟦/⟧ 2]}')).labels.map(label => label === undefined ? ' ' : `${label.depth}${'-ta'[label.container]!}`).join(' ')
  expect(depths).toBe('0- 0- 0- 0- 1t 1t 1t 1t 1t 2a 2a 2a   2a 2a 1t 0-')
})

test('the values that no highlighter can be asked for are not scored', () => {
  // The start of a string that lost its opening quote, where it reads as a number or a literal.
  expect(readsAsNumberOrLiteral(Array.from('1.2.3'), 0)).toBe(3)
  expect(readsAsNumberOrLiteral(Array.from('x = true-color # c'), 4)).toBe(4)
  expect(readsAsNumberOrLiteral(Array.from('info'), 0)).toBe(3)
  expect(readsAsNumberOrLiteral(Array.from('db.internal'), 0)).toBe(0)
  expect(readsAsNumberOrLiteral(Array.from('2024-01-15 # c'), 0)).toBe(10)
  const version = madeCase('[release]\nversion = ⟦missing⟧"⟦/⟧2.4.0-rc1⟦missing⟧"⟦/⟧\nchannel = "stable"\n')
  expect(wantedKinds(version)).toBe('phhhhhhhpwkkkkkkkwpw???sssssswkkkkkkkwpwssssssssw')
  // A string that lost only its closing quote starts as a string.
  expect(wantedKinds(madeCase('[release]\nversion = "2.4.0-rc1⟦missing⟧"⟦/⟧\nchannel = "stable"\n'))).toBe(`phhhhhhhpwkkkkkkkwpw${'s'.repeat(10)}wkkkkkkkwpwssssssssw`)

  // After a bracket that is missing, the depth and the container up to the next bracket, also the one of a header.
  const array = madeCase('ports = [8001, 8002⟦missing⟧]⟦/⟧\nname = "edge"\n[tls]\ncert = "/etc/edge.pem"\n')
  expect(wantedDepths(array)).toBe(`0000000011111111111${'?'.repeat(15)}${'0'.repeat(29)}`)
  expect(wantedKinds(array)).not.toContain('?')
  const opening = madeCase('ports = ⟦missing⟧[⟦/⟧8001, 8002]\nname = "edge-proxy-eu-west"\n')
  expect(wantedDepths(opening)).toBe(`00000000??????????${'0'.repeat(30)}`)

  // A quote that lost its backslash, and what reads as an escape after a backslash that lost its second half.
  const quotes = madeCase('greeting = "say ⟦missing⟧\\⟦/⟧"hi⟦missing⟧\\⟦/⟧" now"\nlang = "en-GB"\n')
  expect(wantedKinds(quotes)).toBe('kkkkkkkkwpwsssss?ss?ssssswkkkkwpwsssssssw')
  const path = madeCase('home = "C:\\⟦missing⟧\\⟦/⟧Users\\⟦missing⟧\\⟦/⟧temp\\⟦missing⟧\\⟦/⟧zoe"\nshell = "pwsh"\n')
  expect(path.broken.startsWith('home = "C:\\Users\\temp\\zoe"')).toBe(true)
  // The U and the t read as the second halves of escapes. The z does not, so it is a part of the string.
  expect(wantedKinds(path)).toBe('kkkkwpwssse?sssse?sssesssswkkkkkwpwssssssw')
})

test('which code points can stand for another, and what in an alignment is against the rules', () => {
  expect([canStandFor('“', '"'), canStandFor('`', '\''), canStandFor('(', '['), canStandFor('<', '{'), canStandFor(')', ']'), canStandFor(':', '='), canStandFor(';', ','), canStandFor('\u00a0', ' '), canStandFor('\n', ' ')]).toEqual(new Array<boolean>(9).fill(true))
  expect([canStandFor(')', '['), canStandFor('/', '-'), canStandFor('T', 't'), canStandFor(';', '#'), canStandFor('=', ':'), canStandFor('x', ' ')]).toEqual(new Array<boolean>(6).fill(false))
  expect(alignmentProblems(alignedOf('since = 2024⟦/ for -⟧01'))).toEqual(['⟦/ for -⟧ at code point 12: such a code point does not stand for the other by the rules. Mark the one as extra and the other as missing'])
  expect(alignmentProblems(alignedOf('port ⟦extra⟧:⟦/⟧⟦missing⟧=⟦/⟧ 1')).join()).toContain('write ⟦: for =⟧')
  expect(alignmentProblems(alignedOf('port ⟦extra⟧= 1⟦/⟧⟦missing⟧= 1⟦/⟧')).join()).toContain('is extra and missing at code point 5')
  expect(alignmentProblems(alignedOf('port⟦: for =⟧ ⟦extra⟧True⟦/⟧⟦missing⟧true⟦/⟧ ⟦extra⟧//⟦/⟧⟦missing⟧#⟦/⟧ x'))).toEqual([])
})

test('what the checks say about texts that cannot be a case', () => {
  expect(validTextProblems('a = 1\nb = [1, 2]\n')).toEqual([])
  expect(validTextProblems('a = 1\nb = [1, 2\n').join()).toContain('not valid TOML for the table parser')
  expect(validTextProblems('a = 1\nb = [1, 2\n').join()).toContain('not valid TOML for the reference')
  // The tables keep no names, and Bun's parser refuses a key that is defined twice.
  expect(validTextProblems('a = 1\na = 2\n').map(problem => problem.split(':')[0])).toEqual(['it is not valid TOML for Bun\'s parser'])
  // What TOML 1.1 adds is not valid for the tables.
  expect(validTextProblems('a = {b = 1,\n c = 2}\n').join()).toContain('not valid TOML for the table parser')
  expect(validTextProblems(`a = "${'x'.repeat(480)}"`).join()).toContain('at most 480')
  const fits = `name = "${'x'.repeat(40)}"\n`
  expect(brokenTextProblems(`${fits}port : 1\n`)).toEqual([])
  expect(brokenTextProblems(fits).join()).toContain('it is valid TOML')
  expect(brokenTextProblems('port : 1\n').join()).toContain('a broken payload has 40 to 480')
  expect(brokenTextProblems(`a = "${'x'.repeat(480)}`).join()).toContain('a broken payload has 40 to 480')
  expect(brokenTextProblems(`${fits}a = 1\na = 2\n`).join()).toContain('it is valid TOML')
  const repair = repairOf(`${fits}port ⟦: for =⟧ 1\n`)
  expect(repairProblems(repair, `${fits}port : 1\n`)).toEqual([])
  expect(repairProblems(repair, `${fits}port :  1\n`).join()).toContain('The two first differ at code point 57, on line 2')
  expect(repairProblems(repairOf(`${fits}port ⟦extra⟧:⟦/⟧ 1\n`), `${fits}port : 1\n`).join()).toContain('the repaired document: it is not valid TOML')
  expect(() => caseOf({id: 'made-01', broken: `${fits}port :  1\n`}, 'made.txt', [{name: 'writer', repair}])).toThrow('does not give the broken payload')
})

test('two repairs of one case: agreed, without a label, and disputed code points', () => {
  const start = '[server]\nhost = "edge-01.internal"\n'
  // The writer takes `off` for false, and the second repairer for a string. Both take the comma for extra.
  const writtenCase = madeCase(`${start}debug = ⟦extra⟧off⟦/⟧⟦missing⟧false⟦/⟧⟦extra⟧,⟦/⟧\nport = 80\n`, `${start}debug = ⟦missing⟧"⟦/⟧off⟦missing⟧"⟦/⟧⟦extra⟧,⟦/⟧\nport = 80\n`)
  const marks = writtenCase.agreement.map(state => state === 'agreed' ? '.' : state === 'extra' ? '+' : '!').join('')
  expect(marks).toBe(`${'.'.repeat(start.length + 8)}!!!+${'.'.repeat(11)}`)
  expect(writtenCase.firstErrorPosition).toBe(start.length + 8)
  expect(writtenCase.disputedFromFirstError).toBe(true)
  expect(wantedKinds(writtenCase).slice(start.length)).toBe('kkkkkwpw    wkkkkwpwnnw')
  expect(differencesOf(writtenCase)).toEqual([{from: 43, to: 45, text: 'off', writer: 'no label', second: 'string, depth 0, no container'}])
  expect(differenceLines(writtenCase)).toEqual([
    '--- made-01: the labels differ at 3 code points, 3 of them from the parser\'s first error at 43 on',
    '    code points 43 to 45 "off": writer: no label. second: string, depth 0, no container.',
  ])
  expect(scoredCodePointsOfWritten(writtenCase)).toBe(11)
  // Two equal lines one after the other, of which one is extra: the fixed form keeps the first, whichever is marked.
  const doubledLine = madeCase('[a]\nname = "edge-01"\n⟦extra⟧name = "edge-01"\n⟦/⟧port = 80⟦extra⟧,⟦/⟧\nwait = 5\n', '[a]\n⟦extra⟧name = "edge-01"\n⟦/⟧name = "edge-01"\nport = 80⟦extra⟧,⟦/⟧\nwait = 5\n')
  expect(differencesOf(doubledLine)).toEqual([])
  // With another line between the two, the repairs keep different lines. The repaired documents are the same, and the
  // comparison says so.
  const sameDocument = madeCase('[a]\n⟦extra⟧<<<< ours\n⟦/⟧name = "edge-01"\n⟦extra⟧====\nname = "edge-01"\n⟦/⟧port = 80\n', '[a]\n⟦extra⟧<<<< ours\nname = "edge-01"\n====\n⟦/⟧name = "edge-01"\nport = 80\n')
  expect(sameDocument.opinions[0]!.text).toBe(sameDocument.opinions[1]!.text)
  // The writer keeps the first of the two lines, at the code points 14 to 30, and the second repairer the other one.
  const disputed = sameDocument.agreement.flatMap((state, position) => state === 'disputed' ? [position] : [])
  expect(disputed).toEqual([...Array.from({length: 17}, (_, offset) => 14 + offset), ...Array.from({length: 17}, (_, offset) => 36 + offset)])
  expect(differencesOf(sameDocument).every(difference => (difference.writer === 'no label') === (difference.from >= 36) && (difference.second === 'no label') === (difference.from < 36))).toBe(true)
  expect(differenceLines(sameDocument)[1]).toBe('    the two repaired documents are the same: the repairs differ only in which code points of the broken payload they keep')

  // A value that the reading of one repair does not score is no dispute: the writer takes 30s for a string, whose 30
  // reads as a number, and the second repairer takes 30 for a number with an s too many.
  const unit = madeCase(`${start}wait = ⟦missing⟧"⟦/⟧30s⟦missing⟧"⟦/⟧\nport = 80\n`, `${start}wait = 30⟦extra⟧s⟦/⟧\nport = 80\n`)
  expect(unit.agreement.slice(start.length + 7, start.length + 10)).toEqual(['agreed', 'agreed', 'disputed'])
  expect(wantedKinds(unit).slice(start.length)).toBe('kkkkwpw?? wkkkkwpwnnw')

  // Two repairs that add another value where one is missing give the same labels.
  const added = madeCase(`${start}wait =⟦missing⟧ ""⟦/⟧\nport = 80\n`, `${start}wait =⟦missing⟧ 0⟦/⟧\nport = 80\n`)
  expect(differencesOf(added)).toEqual([])
  expect(added.disputedFromFirstError).toBe(false)
  expect(added.opinions.map(opinion => opinion.name)).toEqual(['writer', 'second'])
})

test('the score of made-up cases', () => {
  const start = '[server]\nhost = "edge-01.internal"\n'
  // The parser as it is shows the rest of the line of a `:` as an error and goes on with the next line.
  const colon = madeCase(`${start}port⟦: for =⟧ 80\ndebug = true\n`)
  expect(colon.firstErrorPosition).toBe(start.length + 4)
  const score = scoreCases(defaultTables, [colon])
  expect(score).toEqual({cases: 1, nothingToRecover: 0, scored: 18, right: 14, kindScored: 18, kindRight: 14, nestingScored: 18, depthRight: 18, containerRight: 18, wholeRight: 0})
  // A payload that is cut off has nothing to recover.
  const cutOff = madeCase(`${start}tags = ["db", "prim⟦missing⟧"]⟦/⟧`)
  expect(scoreCases(defaultTables, [cutOff])).toEqual({cases: 1, nothingToRecover: 1, scored: 0, right: 0, kindScored: 0, kindRight: 0, nestingScored: 0, depthRight: 0, containerRight: 0, wholeRight: 0})
  expect(caseNotes(cutOff).join()).toContain('nothing to recover')
  // A disputed code point is never counted, and a case with one from the first error on is no case with full agreement.
  const disputed = madeCase(`${start}debug = ⟦extra⟧off⟦/⟧⟦missing⟧false⟦/⟧\nport = 80\n`, `${start}debug = ⟦missing⟧"⟦/⟧off⟦missing⟧"⟦/⟧\nport = 80\n`)
  const scores = scoreTables(defaultTables, [colon, disputed])
  expect([scores.all.fullAgreement.cases, scores.all.agreedCodePoints.cases, scores.perFile.get('made.txt')!.agreedCodePoints.cases, scores.unmarked.fullAgreement.cases]).toEqual([1, 2, 2, 1])
  expect(scores.all.agreedCodePoints.scored).toBe(18 + 11)
  // The exact parser of learn/ with today's tables counts what the plain table parser counts.
  const header = madeCase(`${start}port⟦: for =⟧ 80\n[tls]\non = true\n`)
  expect(scoreCasesWith(parserAsItIs.show, [colon, header, disputed])).toEqual(scoreCases(defaultTables, [colon, header, disputed]))
  // After its first error the parser as it is counts the `[` of a header as the start of an array, so it has the depth
  // after the bracket and the three code points of the name wrong. The rule "anew at the next line after an error"
  // reads the header as one, and changes nothing on the line of the error.
  const asItIs = scoreCases(defaultTables, [header])
  const withTheRule = scoreCasesWith(restartAtNextLine.show, [header])
  expect([asItIs.scored, asItIs.right, withTheRule.scored, withTheRule.right]).toEqual([21, 13, 21, 17])
  expect(scoreCasesWith(restartAtNextLine.show, [colon])).toEqual(score)
})

test('what the check asks a writer to look at', () => {
  const fits = `name = "${'x'.repeat(40)}"\n`
  expect(caseNotes(madeCase(`${fits}port ⟦: for =⟧ 1\n`))).toEqual([])
  expect(caseNotes(madeCase(`⟦extra⟧Here is the file, as you asked for it, with the new name:\n⟦/⟧\n${fits}`)).join()).toContain('the repaired document starts with white space')
  expect(caseNotes(madeCase(`⟦extra⟧${'Here is the file.\n'.repeat(4)}\n⟦/⟧${fits.trimEnd()}`)).join()).toContain('keeps only 49 of the broken payload\'s 122 code points')
  expect(caseNotes(madeCase(`${fits}limits = {a = 1,⟦lf for sp⟧ b = 2}\n`)).join()).toContain('Bun\'s parser accepts the broken payload')
  expect(caseNotes(madeCase(`${fits}port ⟦: for =⟧ 1\n`), 'made-00').join()).toContain('differs from the one of made-00 in names and numbers alone')
  expect(shapeOf('[server]\nport: 8080\n')).toBe(shapeOf('[database]\ntimeout: 30\n'))
  expect(shapeOf('port: 8080')).not.toBe(shapeOf('port = 8080'))
})

test('which edits of the train data\'s damage make a damaged place', () => {
  const start = '[server]\nhost = "edge-01.internal"\nlink = "a:b"\n'
  // What the edits make of a repair, which need not be a case: a deleted line leaves valid TOML.
  const derivedOf = (aligned: string) => {
    const repair = repairOf(aligned)
    return neutralEditsOf({broken: repair.aligned.broken, opinions: [opinionOf('writer', repair)]})
  }
  // The edits by their names, and after "other:" the extra and the missing text of every place that no three edits
  // make.
  const editsOf = (aligned: string) => {
    const {edits, otherPlaces} = derivedOf(aligned)
    return [...edits, ...(otherPlaces.length === 0 ? [] : ['other:', ...otherPlaces.map(place => `${place.extra}|${place.missing}`)])].join(' ')
  }
  expect(editsOf(`${start}tags = ["db", "cache"⟦missing⟧]⟦/⟧\nwait = 5\n`)).toBe('deleteCodePoint')
  expect(editsOf(`${start}wait =⟦extra⟧=⟦/⟧ 5\n`)).toBe('insertCodePoint')
  expect(editsOf(`${start}wait⟦: for =⟧ 5\n`)).toBe('replaceCodePoint')
  expect(editsOf(`${start}debug = t⟦extra⟧u⟦/⟧r⟦missing⟧u⟦/⟧e\n`)).toBe('swapNeighbours')
  expect(editsOf(`${start}wait =⟦missing⟧ ""⟦/⟧\n`)).toBe('deleteRun')
  expect(editsOf(`${start}⟦missing⟧wait = 5\n⟦/⟧debug = true\n`)).toBe('deleteLine')
  expect(editsOf(`${start}tags = ["db", "cac⟦missing⟧he"]⟦/⟧`)).toBe('cutTail')
  expect(editsOf(`${start}wait = 5⟦extra⟧ = 5⟦/⟧\n`)).toBe('duplicateRun')
  expect(editsOf(`${start}wait = 5\n⟦extra⟧wait = 5\n⟦/⟧debug = true\n`)).toBe('duplicateLine')
  expect(editsOf(`${start}wait = 5⟦extra⟧edge-01⟦/⟧\n`)).toBe('copyRun')
  // An edit writes only code points of the payload: the document holds a colon and no semicolon.
  expect(editsOf(`${start}wait = 5⟦extra⟧;⟦/⟧\n`)).toBe('other: ;|')
  expect(editsOf(`[server]\nhost = "edge-01.internal"\nwait⟦: for =⟧ 5\n`)).toBe('other: :|=')
  // An extra text that the document does not hold as one run takes an edit per piece, and a text that takes more than
  // three edits is no place of a sample.
  expect(editsOf(`${start}wait = 5⟦extra⟧b5e⟦/⟧\n`)).toBe('insertCodePoint insertCodePoint insertCodePoint')
  expect(editsOf(`${start}wait = 5⟦extra⟧b5eb⟦/⟧\n`)).toBe('other: b5eb|')
  expect(editsOf(`${start}debug = ⟦extra⟧on⟦/⟧⟦missing⟧true⟦/⟧\n`)).toBe('deleteRun insertCodePoint insertCodePoint')
  // The fixed form cuts an extra line before an empty line in two, and the two are one place: a run of the document.
  expect(editsOf(`${start}wait = 5\n⟦extra⟧]\n⟦/⟧\ntags = ["db"]\n`)).toBe('copyRun')
  // A copy of the end of a line is no copy of a line.
  expect(editsOf(`${start}tags = ["db"]\n⟦extra⟧]\n⟦/⟧wait = 5\n`)).toBe('duplicateRun')
  // A sample has at most three edits: the quotes that are missing around two values are four.
  const fourQuotes = derivedOf(`${start}zone = ⟦missing⟧"⟦/⟧north⟦missing⟧"⟦/⟧\nrole = ⟦missing⟧"⟦/⟧cache⟦missing⟧"⟦/⟧\n`)
  expect(fourQuotes).toEqual({edits: ['deleteCodePoint', 'deleteCodePoint', 'deleteCodePoint', 'deleteCodePoint'], otherPlaces: []})
  expect(couldComeFromEdits(fourQuotes)).toBe(false)
  expect(couldComeFromEdits(derivedOf(`${start}zone = ⟦missing⟧"⟦/⟧north⟦missing⟧"⟦/⟧\n`))).toBe(true)

  // The parts of a score that kinds.txt makes: a case without a line is in none of them.
  const colon = {...madeCase(`${start}wait⟦: for =⟧ 5\ndebug = true\n`), damage: {edits: ['replaceCodePoint'], other: undefined}}
  const quotes = {...madeCase(`${start}zone = ⟦missing⟧"⟦/⟧north⟦missing⟧"⟦/⟧\nrole = ⟦missing⟧"⟦/⟧cache⟦missing⟧"⟦/⟧\n`), damage: {edits: fourQuotes.edits, other: '4 edits where a sample has at most 3'}}
  const fence = {...madeCase(`⟦extra⟧\`\`\`toml\n⟦/⟧${start}wait = 5`), damage: {edits: [], other: 'a code fence before the document'}}
  const scores = scoreTables(defaultTables, [colon, quotes, fence, madeCase(`${start}wait =⟦extra⟧=⟦/⟧ 5\n`)])
  expect([scores.all, scores.neutralEdits, scores.otherDamage, scores.moreEdits].map(score => score.fullAgreement.cases)).toEqual([4, 1, 2, 1])
})

const examplesFolder = join(writtenFolder, 'examples')

test('the three examples have no problem, and the tools read them as the pages say', () => {
  const {cases, problems} = readWritten(examplesFolder)
  expect(problems).toEqual([])
  expect(cases.map(writtenCase => [writtenCase.id, writtenCase.opinions.length, writtenCase.firstErrorPosition, scoredCodePointsOfWritten(writtenCase), writtenCase.disputedFromFirstError])).toEqual([
    ['examples-01', 2, 76, 101, true], ['examples-02', 2, 13, 84, false], ['examples-03', 2, 5, 95, false],
  ])
  const readme = readFileSync(join(writtenFolder, 'README.md'), 'utf8')
  const repairPage = readFileSync(join(writtenFolder, 'REPAIR.md'), 'utf8')
  const asWriter = readWritten(examplesFolder, {opinions: 'writer'}).cases
  const asSecond = readWritten(examplesFolder, {opinions: 'second'}).cases
  // What the pages print for a case is what the check prints for it.
  expect(readme).toContain(`\n${describeCase(asWriter[0]!)}\n`)
  expect(repairPage).toContain(`\n${describeCase(asSecond[1]!)}\n`)
  expect(readme).toContain(`\n${differenceLines(cases[0]!).join('\n')}\n`)
  // Every case and every repair that a page shows is in the files of the examples, line for line.
  const files = ['broken', 'repairs', 'second-repairs'].map(folder => readFileSync(join(examplesFolder, folder, 'examples.txt'), 'utf8'))
  let shown = 0
  for (const page of [readme, repairPage]) {
    for (const [, , block] of page.matchAll(/^(`{3,4})\n(⟦(?:case|repair) examples-[\s\S]*?⟦end⟧\n)\1$/gm)) {
      expect(files.some(file => file.includes(block!))).toBe(true)
      shown++
    }
  }
  expect(shown).toBe(4)
})

test('the files of the set have no problem', () => {
  // Counts only: a problem's text can quote a case, and nobody who builds or trains a parser may read one.
  const {cases, problems} = readWritten()
  expect(problems.length).toBe(0)
  const scores = scoreTables(defaultTables, cases)
  expect(scores.all.agreedCodePoints.cases).toBe(cases.length)
  expect(cases.every(writtenCase => labelsOfWritten(writtenCase).length === Array.from(writtenCase.broken).length)).toBe(true)
  expect(cases.every(writtenCase => labelsOfWritten(writtenCase).every(label => label === undefined || label.kind === undefined || (label.kind !== displayKind.error && label.kind !== displayKind.pastEnd)))).toBe(true)
  // The numbers of README.md, under "The set as it is".
  expect([cases.length, cases.filter(writtenCase => writtenCase.opinions.length === 2).length, scores.all.fullAgreement.cases, scores.all.fullAgreement.nothingToRecover]).toEqual([150, 150, 144, 2])
  expect([scores.all.fullAgreement.scored, scores.all.agreedCodePoints.scored]).toEqual([20303, 20986])
  expect([scores.all.fullAgreement.right, scores.all.fullAgreement.wholeRight]).toEqual([12530, 7])
  // Tables of the recovery experiment, which only the exact parser of learn/ runs, give every score of the plain table
  // parser: today's tables, and tables with added classes, open display entries and the bit "first on its line" in
  // which no cell is changed. So the tables of a training are scored with the counts of this page.
  expect(scoreRecoveryTables(asIsTables(), cases)).toEqual(scores)
  expect(scoreRecoveryTables(addFirstOnLineBit(openDisplayEntries(addClasses(asIsTables(), classesOfTheChecks))), cases)).toEqual(scores)
  // The rule "anew at the next line after an error", the row that trained tables are read against.
  const withTheRule = scoreWith(restartAtNextLine, cases)
  expect([withTheRule.all.fullAgreement.right, withTheRule.all.fullAgreement.wholeRight, withTheRule.unmarked.fullAgreement.right, withTheRule.unmarked.fullAgreement.wholeRight]).toEqual([17105, 42, 15493, 36])
  // kinds.txt names for every case the edits that neutral-edits.ts derives from the writer's repair, and has a reason
  // after "new:" for the cases whose damage one to three edits do not make.
  const derived = cases.map(writtenCase => neutralEditsOf(writtenCase))
  expect(cases.filter((writtenCase, index) => writtenCase.damage === undefined || writtenCase.damage.edits.join(' ') !== derived[index]!.edits.join(' ') || (writtenCase.damage.other === undefined) !== couldComeFromEdits(derived[index]!)).length).toBe(0)
  expect([scores.neutralEdits, scores.otherDamage, scores.moreEdits].map(score => score.agreedCodePoints.cases)).toEqual([69, 81, 18])
})
