// Checks the tools of the written set of broken miniml programs:
// 1. The files' format: a text and an aligned text come back from their lines as they went in, and a file that does
//    not show what its texts hold, or whose marks do not fit, is refused.
// 2. The labels: a kept code point has the label of its counterpart, an added one has none, and two markings of the
//    same repair give the same sample.
// 3. What keeps a pair of texts from being a case, and rule 4 of REPAIR.md.
// 4. Two repairs of one case: agreed, added and disputed code points, and the sample without the disputed ones.
// 5. Against samples with the train data's damage: the copy of makeSample's kept tokens and constituents gives what
//    makeSample gives, an alignment comes back from a file as it went in, and the parser as it is shows a valid
//    program as its labels say.
// 6. What the check asks a writer to look at.
// 7. The three examples have no problem, and the tools read them as the pages say.
// 8. The files of the set have no problem. This part and the next ones print counts only, so that their output
//    quotes no case.
// 9. The edits of the train data's damage that make a damaged place, see neutral-edits.ts: one made-up repair per
//    edit, and kinds.txt against what the repairs of the set give.
// 10. The parts of the set for the final scoring, see score.ts: they add up, and the parser as it is has the same
//    score by the exact parser and by the loop over packed samples.
// 11. README.md holds the numbers that numbers.ts and score.ts give for the set.
//
// The texts of parts 1 to 6 are made up here. Run from the repo root:
//   bun lab/recovery-lr/held-back/written/check-written.ts
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {damageProgram} from '../../damage.ts'
import {containerNames, displayKindNames, labelsOfValidText} from '../../labels.ts'
import {textOf} from '../../parser.ts'
import {createRandom} from '../../random.ts'
import {packSamples} from '../../learn/data.ts'
import {baseTables} from '../../learn/recovery-tables.ts'
import {scoreTables, sharesOf} from '../../learn/score.ts'
import {isScored, makeSample} from '../../sample.ts'
import {caseNotes, shapeOf} from './check.ts'
import {beyondTheLabels, differenceLines, differencesOf} from './compare.ts'
import {type Aligned, alignedOfLines, blankRepairFileText, brokenFileText, linesOfAligned, linesOfText, readBrokenFile, readRepairFile, repairFileText, textOfLines} from './format.ts'
import {couldComeFromEdits, damagePartOf, damagedPlacesOf, kindsLineOf, mostEditsOfSample, neutralEditsOf, neutralEditsOfPlaces, readKinds} from './neutral-edits.ts'
import {readmeLines} from './numbers.ts'
import {disputedCodePointsOf, partsOfWritten, rowsOfParts, scoreOfParserAsItIs} from './score.ts'
import {describeCase, wrongBeforeFirstError} from './show.ts'
import {
  type Opinion, type WrittenCase, brokenTextProblems, caseOf, changeRunsOf, firstDamageOf, keptTokensAndConstituents, missingBeforeWhiteSpace, opinionOf, readWritten, samplesOfWritten,
  shownBeforeFirstError, validTextProblems, writtenFolder,
} from './written.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 20) console.log(`PROBLEM: ${text}`)
}
const expect = (condition: boolean, text: () => string) => {
  if (!condition) problem(text())
}
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const expectSame = (found: unknown, wanted: unknown, name: string) => expect(same(found, wanted), () => `${name}: found ${JSON.stringify(found)}, and ${JSON.stringify(wanted)} is wanted`)
const expectHolds = (text: string, part: string, name: string) => expect(text.includes(part), () => `${name}: ${JSON.stringify(text.slice(0, 300))} does not hold ${JSON.stringify(part)}`)

// An aligned text from the lines of a file, written here as one string. A line feed at its start or its end is
// written here as it is, and goes into the lines as ⟦lf⟧, as a file has it. The text has no problem.
function alignedOf(text: string): Aligned {
  const [, leading, body, trailing] = /^(\n*)([\s\S]*?)(\n*)$/.exec(text)!
  const {aligned, problems: found} = alignedOfLines(`${'⟦lf⟧'.repeat(leading!.length)}${body!}${'⟦lf⟧'.repeat(trailing!.length)}`.split('\n'), 1)
  expect(found.length === 0, () => `the aligned text ${JSON.stringify(text)} has problems: ${found.join('; ')}`)
  return aligned
}
// The opinion that an aligned text gives, which has no problem.
function madeOpinion(text: string, name: Opinion['name'] = 'writer'): Opinion {
  const aligned = alignedOf(text)
  const opinion = opinionOf(name, {aligned, note: undefined, unsure: undefined}, aligned.broken, 'made-01')
  if ('problems' in opinion) throw new Error(`the made-up repair ${JSON.stringify(text)} has problems: ${opinion.problems.join('; ')}`)
  return opinion
}
// What keeps an aligned text from being a repair of its own broken program, as one text.
function repairProblemsOf(text: string): string {
  const aligned = alignedOf(text)
  const opinion = opinionOf('writer', {aligned, note: undefined, unsure: undefined}, aligned.broken, 'made-01')
  return 'problems' in opinion ? opinion.problems.join(' | ') : ''
}
// A case with the writer's repair and, when given, a second repair, from aligned texts.
function madeCase(writer: string, second?: string): WrittenCase {
  const first = madeOpinion(writer)
  return caseOf({id: 'made-01', broken: first.sample.broken}, 'made.txt', 'a made-up situation', [first, ...(second === undefined ? [] : [madeOpinion(second, 'second')])])
}
// A made-up program that is long enough for a case, before and after the part that a check is about.
const before = 'let width = 72\nlet height = 24\n'
const after = '\nlet cells = width * height\nlet () = print_int cells\n'

// 1. The files' format.
{
  const texts = [
    'let limit = 10', 'let a = 1\nlet b = 2\n', '\n\nlet a = 1\n\n\n', 'let a = 1 \nlet b = 2  ', '\tlet a = "x y"\r\n', '﻿let a = 1', 'let name = "⟦x⟧"', 'let a = "​\u001b[0m"', '', ' ',
    'let a = 1\n\n\nlet b = 2', 'let title = "東京 ☕"',
  ]
  for (const text of texts) {
    const lines = linesOfText(text)
    // No line holds a character that cannot be seen as itself, and none ends with a space.
    expect(lines.every(line => !line.endsWith(' ') && !Array.from('\t\r ﻿​\u001b').some(character => line.includes(character))), () => `the lines of ${JSON.stringify(text)} hold a character that cannot be seen`)
    expectSame(textOfLines(lines, 1), {text, problems: []}, `the text ${JSON.stringify(text)} from its lines`)
  }
  expectSame(linesOfText('\tlet a = 1 \n'), ['⟦tab⟧let a = 1⟦sp⟧⟦lf⟧'], 'the lines of a text with a tab, a last space and a last line feed')

  expectSame(alignedOf('let limit ⟦missing⟧= ⟦/⟧10⟦added⟧;;⟦/⟧'), {broken: 'let limit 10;;', repaired: 'let limit = 10', alignment: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, -1, -1]}, 'an aligned text with a missing and an added run')
  // A run goes on over the lines of the file, and a name of a character that cannot be seen stands in it as anywhere.
  const wrapped = alignedOf('⟦added⟧Here it is:\n\n⟦/⟧let a⟦added⟧⟦nbsp⟧⟦/⟧⟦missing⟧ ⟦/⟧= 1⟦added⟧⟦tab⟧-- x⟦/⟧⟦lf⟧')
  expectSame([wrapped.broken, wrapped.repaired], ['Here it is:\n\nlet a = 1\t-- x\n', 'let a = 1\n'], 'the two texts of an aligned text with runs over several lines')
  expectSame(wrapped.alignment, [...new Array<number>(13).fill(-1), 0, 1, 2, 3, 4, -1, 6, 7, 8, -1, -1, -1, -1, -1, 9], 'the alignment of that aligned text')
  // A text without marks changes nothing.
  expectSame(alignedOf('let a = 1\nlet b = 2'), {broken: 'let a = 1\nlet b = 2', repaired: 'let a = 1\nlet b = 2', alignment: Array.from({length: 19}, (_, index) => index)}, 'an aligned text without marks')

  const alignedTexts = [
    'let limit ⟦missing⟧= ⟦/⟧10⟦added⟧;;⟦/⟧', '⟦added⟧Here it is:\n\n⟦/⟧let a⟦added⟧⟦nbsp⟧⟦/⟧⟦missing⟧ ⟦/⟧= 1⟦added⟧⟦tab⟧-- x⟦/⟧⟦lf⟧', 'let a = ⟦added⟧True⟦/⟧⟦missing⟧true⟦/⟧\nlet b = 2⟦missing⟧\n⟦/⟧',
    '⟦lf⟧let a = 1⟦sp⟧\nlet b = ⟦missing⟧()⟦/⟧', 'let a = ⟦added⟧“⟦/⟧⟦missing⟧"⟦/⟧x⟦added⟧”⟦/⟧⟦missing⟧"⟦/⟧ ⟦added⟧ ⟦/⟧',
  ]
  for (const text of alignedTexts) {
    const aligned = alignedOf(text)
    expectSame(alignedOfLines(linesOfAligned(aligned), 1), {aligned, problems: []}, `the aligned text ${JSON.stringify(text)} from its lines`)
  }

  const linesProblems = (text: string) => alignedOfLines(text.split('\n'), 1).problems.join(' | ')
  const refused: [text: string, part: string][] = [
    ['let a = 1 ', 'ends with a space'], ['\tlet a = 1', 'Write it as ⟦tab⟧'], ['let a = 1', 'Write it as ⟦nbsp⟧'], ['\nlet a = 1', 'starts with an empty line'], ['let a = 1\n', 'ends with an empty line'],
    ['let a = ⟦quote⟧', 'names no character and is no mark'], ['let a = ⟦added⟧1', 'has no ⟦/⟧'], ['let a = 1⟦/⟧', 'ends no run'], ['let a = ⟦added⟧⟦/⟧1', 'is empty'],
    ['let a = ⟦added⟧x⟦missing⟧y⟦/⟧⟦/⟧', 'a mark stands inside the run'], ['let a ⟦: for =⟧ 1', 'is no mark of this set'], ['let a = 1⟦extra⟧;;⟦/⟧', '⟦extra⟧ is no mark of this set'],
    ['let a = 1⟦end⟧', 'is a marker'], ['let a = ⟦tab', '⟦ without ⟧'],
  ]
  for (const [text, part] of refused) expectHolds(linesProblems(text), part, `the lines ${JSON.stringify(text)}`)
  expectHolds(textOfLines(['let a = 1⟦added⟧;;⟦/⟧'], 1).problems.join(' | '), 'a mark of an aligned text stands in a text that is no aligned text', 'a mark in a broken program')

  const brokenFile = (text: string) => readBrokenFile(text).problems.join(' | ')
  const refusedFiles: [found: string, part: string][] = [
    [brokenFile('⟦case a-01⟧\n⟦broken⟧\nlet a = 1\n'), 'has no ⟦end⟧ line'], [brokenFile('⟦case a 01⟧\n⟦broken⟧\nlet a = 1\n⟦end⟧\n'), 'an id is made of'],
    [brokenFile('⟦case a-01⟧\nfrom: somewhere\n⟦broken⟧\nlet a = 1\n⟦end⟧\n'), 'this file has no header lines'], [brokenFile('⟦case a-01⟧\n⟦aligned⟧\nlet a = 1\n⟦end⟧\n'), 'the section ⟦broken⟧ is missing'],
    [brokenFile('let a = 1\n'), 'outside an entry only empty lines can stand'], [brokenFile('⟦case a-01⟧\n⟦broken⟧\nlet a = 1\n⟦end⟧\n\n⟦case a-01⟧\n⟦broken⟧\nlet b = 1\n⟦end⟧\n'), 'the id stands twice'],
    [brokenFile('⟦case a-01⟧\r\n⟦broken⟧\r\nlet a = 1\r\n⟦end⟧\r\n'), 'carriage returns'],
    [readRepairFile('⟦repair a-01⟧\n⟦aligned⟧\nlet a = 1\n⟦end⟧\n', 'writer').problems.join(' | '), 'the line "from: …" is missing'],
    [readRepairFile('⟦repair a-01⟧\nfrom: somewhere\n⟦aligned⟧\nlet a = 1\n⟦end⟧\n', 'second').problems.join(' | '), 'the header "from" is not one of note, unsure'],
    [readRepairFile('⟦repair a-01⟧\nfrom: somewhere\nunsure:\n⟦aligned⟧\nlet a = 1\n⟦end⟧\n', 'writer').problems.join(' | '), 'says the other reading in a sentence'],
    [readRepairFile('⟦case a-01⟧\n⟦broken⟧\nlet a = 1\n⟦end⟧\n', 'writer').problems.join(' | '), 'this file holds entries that start with ⟦repair id⟧'],
  ]
  for (const [found, part] of refusedFiles) expectHolds(found, part, 'a file that is refused')
  expectSame(readRepairFile('⟦repair a-01⟧\n⟦aligned⟧\nlet a = 1\n⟦end⟧\n', 'second').problems, [], 'a second repair without a line "from"')

  const broken = [{id: 'a-01', broken: 'let limit 10;;\n'}, {id: 'a-02', broken: '\tlet a = "x y" \r\n\n'}]
  expectSame(readBrokenFile(brokenFileText(broken)), {items: [{...broken[0]!, line: 1}, {...broken[1]!, line: 6}], problems: []}, 'a file of broken programs from its text')
  const repairs = [
    {id: 'a-01', aligned: alignedOf('let limit ⟦missing⟧= ⟦/⟧10⟦added⟧;;⟦/⟧⟦lf⟧'), from: 'a file edited by hand', note: undefined, unsure: 'the 10 could be a parameter'},
    {id: 'a-02', aligned: alignedOf('⟦added⟧Here it is:\n\n⟦/⟧let a = 1'), from: 'the answer of a language model', note: 'the sentence is no part of the file', unsure: undefined},
  ]
  const readRepairs = readRepairFile(repairFileText(repairs), 'writer')
  expectSame([readRepairs.problems, readRepairs.items.map(({line: _line, ...repair}) => repair)], [[], repairs], 'a repair file from its text')
  // The file that a second repairer starts from holds every broken program as an aligned text that changes nothing.
  const blank = readRepairFile(blankRepairFileText(brokenFileText(broken)), 'second')
  expectSame([blank.problems, blank.items.map(repair => [repair.id, repair.aligned.broken, repair.aligned.repaired])], [[], broken.map(entry => [entry.id, entry.broken, entry.broken])], 'the file that a second repairer starts from')
  console.log(`1. ${texts.length} texts and ${alignedTexts.length} aligned texts come back from their lines as they went in, ${refused.length + 1} lines and ${refusedFiles.length} files with a fault are refused, and files come back from their text.`)
}

// 2. The labels.
{
  // A kept code point has the label of its counterpart, and an added one has none.
  const opinion = madeOpinion(`${before}let area = ⟦missing⟧(⟦/⟧width + 2) * height⟦added⟧;;⟦/⟧${after}`)
  const {sample, labels} = opinion
  let kept = 0
  for (let position = 0; position < sample.codePoints.length; position++) {
    const counterpart = sample.alignment[position]!
    if (counterpart === -1) {
      expectSame([sample.labelKind[position], sample.labelDepth[position], sample.labelContainer[position]], [-1, -1, -1], `the label of the added code point ${position}`)
      continue
    }
    kept++
    expectSame([sample.labelKind[position], sample.labelDepth[position], sample.labelContainer[position], sample.labelStack[position]], [labels.kind[counterpart], labels.depth[counterpart], labels.container[counterpart], labels.stack[counterpart]], `the label of the kept code point ${position}`)
  }
  expectSame(kept, sample.codePoints.length - 2, 'the kept code points of a repair with one missing and two added code points')
  // The `width` after the missing bracket is a name at depth 2 inside the brackets.
  const widthAt = Array.from(sample.broken).join('').indexOf('width + 2')
  expectSame([displayKindNames[sample.labelKind[widthAt]!], sample.labelDepth[widthAt], containerNames[sample.labelContainer[widthAt]!]], ['name', 2, '('], 'the label after a missing opening bracket')

  // Two markings of the same repair give the same sample: of two equal code points the later one is added or
  // missing, and what an added text and the missing text at its place share at their start and end is kept.
  const sameRepairs: [name: string, markings: string[]][] = [
    ['a doubled =', [`${before}let ratio ⟦added⟧=⟦/⟧= width / height${after}`, `${before}let ratio =⟦added⟧=⟦/⟧ width / height${after}`]],
    ['a line that is added with its indentation', [`${before}let area =\n⟦added⟧  -- in cells\n⟦/⟧  width * height${after}`, `${before}let area =\n  ⟦added⟧-- in cells\n  ⟦/⟧width * height${after}`, `${before}let area =⟦added⟧\n  -- in cells⟦/⟧\n  width * height${after}`]],
    ['a word in another form', [`${before}let rows = if height > 40 then 3 ⟦added⟧elif⟦/⟧⟦missing⟧else if⟦/⟧ height > 20 then 2 else 1${after}`, `${before}let rows = if height > 40 then 3 el⟦missing⟧se ⟦/⟧if height > 20 then 2 else 1${after}`]],
    ['one of two closing brackets', [`${before}let area = (width * height)⟦added⟧)⟦/⟧${after}`, `${before}let area = (width * height⟦added⟧)⟦/⟧)${after}`]],
    ['one of two spaces that is missing', [`${before}let area =⟦missing⟧ ⟦/⟧ width * height⟦added⟧;;⟦/⟧${after}`, `${before}let area = ⟦missing⟧ ⟦/⟧width * height⟦added⟧;;⟦/⟧${after}`]],
  ]
  for (const [name, markings] of sameRepairs) {
    const samples = markings.map(marking => madeOpinion(marking).sample)
    for (const other of samples.slice(1)) {
      expectSame(Array.from(other.alignment), Array.from(samples[0]!.alignment), `two markings of ${name}: the alignment`)
      expectSame([Array.from(other.labelKind), Array.from(other.labelDepth), Array.from(other.labelContainer)], [Array.from(samples[0]!.labelKind), Array.from(samples[0]!.labelDepth), Array.from(samples[0]!.labelContainer)], `two markings of ${name}: the labels`)
    }
  }
  // Of `elif` for `else if`, the `el` is kept as the start of `else` and the `if` as `if`, one level deeper.
  const slip = madeOpinion(`${before}let rows = if height > 40 then 3 ⟦added⟧elif⟦/⟧⟦missing⟧else if⟦/⟧ height > 20 then 2 else 1${after}`).sample
  const elifAt = slip.broken.indexOf('elif')
  expectSame([0, 1, 2, 3].map(offset => [displayKindNames[slip.labelKind[elifAt + offset]!], slip.labelDepth[elifAt + offset], containerNames[slip.labelContainer[elifAt + offset]!]]), [['keyword', 2, 'else'], ['keyword', 2, 'else'], ['keyword', 3, 'if'], ['keyword', 3, 'if']], 'the labels of elif for else if')
  // Positions count code points: a character outside the Basic Multilingual Plane is one, and so is a carriage return.
  const wide = madeOpinion(`${before}let mood = "fine" ⟦added⟧🙂 ⟦/⟧^ "!"⟦cr⟧\nlet tab = "⟦tab⟧"${after}`).sample
  const smileyAt = Array.from(wide.broken).indexOf('🙂')
  expectSame([wide.codePoints.length, Array.from(wide.broken).length, wide.alignment[smileyAt], wide.alignment[smileyAt + 1], wide.alignment[smileyAt + 2], displayKindNames[wide.labelKind[smileyAt + 2]!], wide.firstErrorPosition], [wide.broken.length - 1, wide.broken.length - 1, -1, -1, smileyAt, 'operator', smileyAt], 'a broken program with a character of two UTF-16 units')
  console.log(`2. A kept code point has the label of its counterpart and an added one has none, and ${sameRepairs.length} repairs give the same sample however they are marked.`)
}

// 3. What keeps a pair of texts from being a case.
{
  expectHolds(brokenTextProblems('let a = True\nlet b = if a then 2 esle 3\nlet c = a b').join(' | '), 'it is a valid program', 'a broken program that the parser accepts')
  expectHolds(brokenTextProblems('let a = (1').join(' | '), 'a broken program has 40 to 480', 'a broken program that is too short')
  expectHolds(brokenTextProblems(`let a = (${'1 + '.repeat(120)}1`).join(' | '), 'a broken program has 40 to 480', 'a broken program that is too long')
  expectSame(brokenTextProblems(`${before}let area = (width * height${after}`), [], 'a broken program')
  expectSame(validTextProblems(`${before}let area = (width * height)${after}`), [], 'a repaired program')
  expectHolds(validTextProblems(`${before}let area = (width * height${after}`).join(' | '), 'it is no valid program: the parser reports an error at code point 58, line 4: the token "let", where the parser takes one of', 'a repaired program that the parser rejects')
  expectHolds(validTextProblems(`let a = ${'1 + '.repeat(120)}1`).join(' | '), 'a repaired program has at most 480', 'a repaired program that is too long')

  expectSame(repairProblemsOf(`${before}let area = (width * height${after}`), 'the repair changes nothing yet: the aligned text has no mark', 'a repair without a mark')
  expectHolds(repairProblemsOf(`${before}let area = (width * height)${after}let last = (1 + cells⟦missing⟧)⟦/⟧`), 'has nothing to score', 'a repair of a program that only lacks its end')
  expectHolds(repairProblemsOf(`${before}let area = (width ⟦added⟧* ⟦/⟧⟦missing⟧* ⟦/⟧height${after}`), 'the repair changes nothing yet', 'a repair that takes text away and puts it back')
  expectHolds(repairProblemsOf(`${before}let area = width ⟦added⟧* ⟦/⟧⟦missing⟧* ⟦/⟧height⟦added⟧;;⟦/⟧${after}`), '"* " is added and missing at code point 48', 'the same text added and missing at one place')
  const other = opinionOf('writer', {aligned: alignedOf(`${before}let area = (width * height⟦missing⟧)⟦/⟧${after}`), note: undefined, unsure: undefined}, `${before}let area = (width * height;${after}`, 'made-01')
  expectHolds('problems' in other ? other.problems.join(' | ') : '', 'the aligned text does not give the broken program', 'a repair of another broken program')

  // Rule 4: a whole token that is missing stands right before the next token of the broken program.
  const rule = 'By rule 4 of REPAIR.md'
  const misplaced = [
    `${before}let area w h⟦missing⟧ =⟦/⟧\n  w * h${after}`, `${before}let area = (width * height⟦missing⟧)⟦/⟧${after}`, `${before}let area = ⟦missing⟧(⟦/⟧ width + 2) * height${after}`,
    `${before}let area = width *⟦missing⟧ ()⟦/⟧${after}`, `${before}let area =\n  ⟦added⟧match width with\n  | 0 -> 0⟦/⟧⟦missing⟧()⟦/⟧${after}`, `${before}let area = (width * height⟦missing⟧)⟦/⟧ (* in cells *)${after}`,
    `${before}let a = ⟦added⟧begin⟦/⟧ ⟦missing⟧(⟦/⟧ width * height)${after}`,
    // The fixed form takes the second of the two closing brackets for the missing one, which then stands before
    // the line feed, and the line feed is one bracket less deep for it.
    `${before}let area = (width * (height + 2⟦missing⟧)⟦/⟧)${after}`,
  ]
  for (const text of misplaced) expectHolds(repairProblemsOf(text), rule, `the repair ${JSON.stringify(text)}`)
  const wellPlaced = [
    `${before}let area w h\n  ⟦missing⟧= ⟦/⟧w * h${after}`, `${before}let area = (width * height\n⟦missing⟧)⟦/⟧${after.slice(1)}`, `${before}let area =  ⟦missing⟧(⟦/⟧width + 2) * height${after}`,
    `${before}let area = width *\n⟦missing⟧() ⟦/⟧${after.slice(1)}`, `${before}let area =\n  ⟦added⟧match width with\n  | 0 -> 0⟦/⟧\n⟦missing⟧() ⟦/⟧${after.slice(1)}`,
    // A token in another form is missing at the place of the added one, also before white space.
    `${before}let sizes = [width⟦added⟧,⟦/⟧⟦missing⟧;⟦/⟧ height]${after}`, `${before}let twice = fun f x ⟦added⟧=>⟦/⟧⟦missing⟧->⟦/⟧ f (f x)${after}`, `${before}let a = ⟦added⟧begin⟦/⟧⟦missing⟧(⟦/⟧ if width > 9 then 1 ⟦added⟧end⟦/⟧⟦missing⟧)⟦/⟧${after}`,
    // A part of a token that is missing is no whole token. In the second repair the fixed form moves the missing
    // ` *)` behind the ` *` after it, so that the `*` of the product is missing before a space. No scored value hangs
    // on that, and the repairer's own marks put no token there.
    `${before}let name = "wide⟦missing⟧"⟦/⟧ ^ "screen"${after}`, `${before}let area = width (* in cells⟦missing⟧ *)⟦/⟧ * height${after}`,
    // The last token of the program, with nothing after it.
    `${before}let area = (width * height)${after}let last = [cells;⟦added⟧;⟦/⟧ 2⟦missing⟧]⟦/⟧`,
  ]
  for (const text of wellPlaced) expectSame(repairProblemsOf(text), '', `the repair ${JSON.stringify(text)}`)
  expectSame(missingBeforeWhiteSpace(labelsOfValidText('let area w h =\n  w * h'), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20, 21]), [{tokens: ['='], position: 12, whiteSpaceIndex: 14, changesDepthOrContainer: true}], 'the missing token that rule 4 names')
  expectSame(missingBeforeWhiteSpace(labelsOfValidText('let area = (w * h)\nlet b = 1'), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27]).map(entry => [entry.tokens, entry.changesDepthOrContainer]), [[[')'], false]], 'a missing closing bracket before a line feed, which leaves the depth and the container as they are')
  console.log(`3. Texts that cannot be a case are refused, ${misplaced.length} repairs with a missing token before white space are refused by rule 4, and ${wellPlaced.length} repairs are not.`)
}

// 4. Two repairs of one case.
{
  // The writer takes the second closing bracket for added, and the second repairer misses an opening one. They agree
  // on everything but the bracket and what stands inside the second repairer's brackets.
  const writer = `${before}let area = width * height⟦added⟧)⟦/⟧ + 1${after}`
  const second = `${before}let area = ⟦missing⟧(⟦/⟧width * height) + 1${after}`
  const disputedCase = madeCase(writer, second)
  const broken = disputedCase.broken
  // The disputed code points: `width * height)` and the space after the bracket, which is white space inside the
  // brackets for the second repairer. The first error is at the bracket.
  const from = broken.indexOf('width * height)'), bracket = from + 'width * height'.length, to = bracket + 2
  expectSame(disputedCase.agreement.map(state => state[0]).join(''), `${'a'.repeat(from)}${'d'.repeat(to - from)}${'a'.repeat(Array.from(broken).length - to)}`, 'the agreement of two repairs that differ on a bracket')
  expectSame([disputedCase.disputedFromFirstError, disputedCase.sample.firstErrorPosition], [true, bracket], 'the first error and whether a code point after it is disputed')
  const {sample} = disputedCase
  const writerSample = disputedCase.opinions[0]!.sample
  for (let position = 0; position < sample.codePoints.length; position++) {
    const disputed = position >= from && position < to
    expectSame([sample.alignment[position], sample.labelKind[position], sample.labelDepth[position], sample.labelContainer[position], sample.labelStack[position]],
      disputed ? [-1, -1, -1, -1, 0] : [writerSample.alignment[position], writerSample.labelKind[position], writerSample.labelDepth[position], writerSample.labelContainer[position], writerSample.labelStack[position]], `code point ${position} of the sample without the disputed code points`)
    expectSame(isScored(sample, position), position >= to, `whether code point ${position} is scored`)
  }
  expectSame([sample.scored, writerSample.scored], [Array.from(broken).length - to, Array.from(broken).length - to + 1], 'the scored code points of the sample without the disputed ones, and of the writer\'s sample')
  // A token with a disputed code point is no kept token, and no constituent starts or ends at it.
  const disputedTokens = Array.from({length: sample.tokens.count}, (_, token) => token).filter(token => sample.tokens.start[token]! >= from && sample.tokens.start[token]! < to)
  expect(disputedTokens.every(token => sample.keptToken[token] === -1) && writerSample.keptToken.filter(token => token !== -1).length - sample.keptToken.filter(token => token !== -1).length === 3, () => 'the tokens with a disputed code point are still kept tokens')
  expectSame(differencesOf(disputedCase).map(difference => [difference.from, difference.to, difference.writer, difference.second]), [
    [from, from + 4, 'name, depth 1, in =', 'name, depth 2, in ('], [from + 5, from + 5, 'whitespace, depth 1, in =', 'whitespace, depth 2, in ('], [from + 6, from + 6, 'operator, depth 1, in =', 'operator, depth 2, in ('],
    [from + 7, from + 7, 'whitespace, depth 1, in =', 'whitespace, depth 2, in ('], [from + 8, from + 13, 'name, depth 1, in =', 'name, depth 2, in ('], [bracket, bracket, 'added', 'punctuation, depth 2, in ('],
    [bracket + 1, bracket + 1, 'whitespace, depth 1, in =', 'whitespace, depth 2, in ('],
  ], 'the differences of the two repairs')
  expectHolds(differenceLines(disputedCase)[0]!, `the labels differ at 16 code points, 2 of them from the parser's first error at ${bracket} on`, 'the first line about a case with a difference')
  expectSame([samplesOfWritten([disputedCase]).length, samplesOfWritten([disputedCase], 'agreed code points').length], [0, 1], 'the samples of a case with a disputed code point from the first error on')

  // The same repair marked in two ways: full agreement, also on the stack and the constituents.
  const sameCase = madeCase(`${before}let area = (width * height)⟦added⟧)⟦/⟧${after}`, `${before}let area = (width * height⟦added⟧)⟦/⟧)${after}`)
  expectSame([sameCase.agreement.includes('disputed'), sameCase.disputedFromFirstError, sameCase.constituentsAgreed, sameCase.stackAgreed.reduce((total, agreed) => total + agreed, 0)], [false, false, true, Array.from(sameCase.broken).length - 1], 'two markings of one repair as two opinions')
  expect(sameCase.sample === sameCase.opinions[0]!.sample, () => 'the sample of a case without a disputed code point is not the writer\'s sample')
  expectSame(samplesOfWritten([sameCase, disputedCase]).map(found => found.id), ['made-01'], 'the samples of the cases with full agreement')

  // Two repairs with the same display kind, depth and container on stacks that differ: the `;` between two values in
  // brackets is taken away by the one and is a `,` in another form for the other.
  const stackCase = madeCase(`${before}let size = (width⟦added⟧;⟦/⟧ height)${after}`, `${before}let size = (width⟦added⟧;⟦/⟧⟦missing⟧,⟦/⟧ height)${after}`)
  expectSame([stackCase.agreement.includes('disputed'), stackCase.constituentsAgreed], [false, false], 'two repairs with the same labels and other constituents')
  expect(stackCase.stackAgreed.includes(0) && stackCase.agreement.every((state, position) => state !== 'agreed' || stackCase.stackAgreed[position] === 1 || position > stackCase.broken.indexOf(';')), () => 'the stacks of two repairs with the same labels differ at another place than after the `;`')
  expectHolds(beyondTheLabels(stackCase), 'stand on another stack by the second repair, and the two repairs give other constituents', 'what two repairs with the same labels differ in')
  console.log('4. Two repairs of one case: the agreed, added and disputed code points, the sample without the disputed ones, and what repairs with the same labels still differ in.')
}

// 5. Against samples with the train data's damage.
{
  // Valid programs that are made up here, so that this check does not hang on the dataset's generator.
  const programs = [
    '(* Totals for the weekly report. *)\nlet rec sum xs = if xs = [] then 0 else head xs + sum (tail xs)\n\nlet average xs =\n  let total = sum xs in\n  let count = length xs in\n  if count = 0 then 0 else total / count\n',
    'let width = 72\nlet rec repeat text count = if count = 0 then "" else text ^ repeat text (count - 1)\nlet indent depth = repeat "  " depth\nlet line depth text = indent depth ^ text\n',
    'let rec gcd a b =\n  if b = 0 then a else gcd b (a mod b)\n\nlet scores = [72; 85; 91]\nlet best = fold_left max 0 scores\nlet () = printf "best: %d\\n" best\n',
    'let compose f g = fun x -> f (g x)\nlet twice f = compose f f\nlet add_tax rate = fun price -> price + price * rate / 100\nlet () = print_int (twice (add_tax 8) 250)',
    'let clamp low high value =\n  if value < low then low\n  else if value > high then high\n  else value\n\nlet percent part whole = clamp 0 100 (part * 100 / whole)\nlet shown = (percent 3 8, "of the plan", [1; 2; 3])\n',
    'let rec range first last = if first > last then [] else first :: range (first + 1) last (* both ends *)\nlet evens = filter (fun n -> n mod 2 = 0) (range 1 20)\nlet _ = iter print_int evens\n',
    'let greeting name =\n  let title = if is_admin name then "Dr. " else "" in\n  "Hello, " ^ title ^ name ^ "!"\n\nlet () = print_string (greeting "Ada") let () = print_string (greeting "Grace")\n',
    'let unit_price = 1250\nlet rec total items = if items = [] then 0 else (fst (head items) * snd (head items)) + total (tail items)\nlet order = [(2, unit_price); (1, 300)]\nlet due = total order - -50 || false && true\n',
  ]
  const perProgram = 150
  let samples = 0, accepted = 0, refusedByRule4 = 0
  // What neutral-edits.ts says of these samples, whose damage is one to three edits: the samples for which it finds
  // one to three edits, and the most edits of a draw.
  let foundAsEdits = 0, mostEdits = 0
  programs.forEach((program, programIndex) => {
    const labels = labelsOfValidText(program)
    // The parser as it is shows a valid program as its labels say.
    const shownValid = shownBeforeFirstError(labels)
    expect(same([Array.from(shownValid.kind), Array.from(shownValid.depth), Array.from(shownValid.container)], [Array.from(labels.kind), Array.from(labels.depth), Array.from(labels.container)]), () => `program ${programIndex}: the parser as it is shows the valid program otherwise than its labels say`)
    const random = createRandom(20261016, programIndex)
    for (let draw = 0; draw < perProgram; draw++) {
      const damaged = damageProgram(labels.codePoints, random)
      const sample = makeSample({id: `${programIndex}:${draw}`, edits: damaged.edits, original: program, broken: textOf(damaged.codePoints), alignment: damaged.alignment}, labels)
      if (typeof sample === 'string') continue
      samples++
      const name = `program ${programIndex}, draw ${draw}`
      mostEdits = Math.max(mostEdits, damaged.edits.length)
      if (couldComeFromEdits(neutralEditsOfPlaces(damagedPlacesOf(sample.broken, {text: program, sample})))) foundAsEdits++
      const copy = keptTokensAndConstituents(labels, sample.tokens, sample.alignment)
      expect(same(Array.from(copy.keptToken), Array.from(sample.keptToken)) && same(Array.from(copy.constituents), Array.from(sample.constituents)), () => `${name}: the copy of the kept tokens and constituents differs from makeSample's`)
      // The alignment through a file: as lines of an aligned text and back.
      const aligned: Aligned = {broken: sample.broken, repaired: sample.original, alignment: Array.from(sample.alignment)}
      const reread = alignedOfLines(linesOfAligned(aligned), 1)
      expect(reread.problems.length === 0 && same(reread.aligned, aligned), () => `${name}: the aligned text does not come back from its lines`)
      const again = makeSample({id: sample.id, original: reread.aligned.repaired, broken: reread.aligned.broken, alignment: reread.aligned.alignment}, labels)
      expect(typeof again !== 'string' && same(Array.from(again.alignment), Array.from(sample.alignment)) && same(Array.from(again.labelStack), Array.from(sample.labelStack)), () => `${name}: the sample of the reread alignment is another one`)
      // The first error is no earlier than the damage: its token reaches the first damaged code point or comes after it.
      expect(firstDamageOf(sample.alignment, labels.codePoints.length) <= sample.firstErrorPosition + sample.tokens.length[sample.firstErrorToken]!, () => `${name}: the first damage comes after the token of the first error`)
      expect(changeRunsOf(sample.broken, sample.original, sample.alignment).length > 0, () => `${name}: the alignment changes nothing`)
      // The parser as it is shows the code points before the first error and none from it on.
      const shown = shownBeforeFirstError(sample)
      expect(shown.kind.every((kind, position) => (kind === -1) === (position >= sample.firstErrorPosition)), () => `${name}: the parser as it is shows a code point from its first error on, or none before it`)
      // The train data's damage knows no rule 4, so the written set's reader refuses a part of its samples.
      const opinion = opinionOf('writer', {aligned, note: undefined, unsure: undefined}, sample.broken, sample.id)
      if (!('problems' in opinion)) {
        accepted++
        expect(same(Array.from(opinion.sample.alignment), Array.from(sample.alignment)) && same(Array.from(opinion.sample.labelKind), Array.from(sample.labelKind)), () => `${name}: the written set's reader gives another sample`)
      } else if (opinion.problems.every(found => found.includes('By rule 4 of REPAIR.md'))) refusedByRule4++
      else problem(`${name}: the written set's reader refuses the sample for another reason than rule 4: ${opinion.problems.join('; ').slice(0, 300)}`)
    }
  })
  // The numbers of README.md, under "How a code point gets its label".
  expectSame([samples, accepted, refusedByRule4], [403, 353, 50], 'the samples of the damage, those that the written set\'s reader takes, and those that it refuses by rule 4')
  // The number of README.md, under "What the damage is".
  expectSame([mostEdits, mostEditsOfSample, foundAsEdits], [3, 3, 397], 'the most edits of a draw of the damage, the same in neutral-edits.ts, and the samples for which neutral-edits.ts finds one to three edits')
  console.log(`5. The parser as it is shows ${programs.length} valid programs as their labels say. Of ${programs.length * perProgram} draws of the train data's damage on them, ${samples} give a sample: the copy of the kept tokens and constituents gives what makeSample gives, and every alignment comes back from a file. The written set's reader takes ${accepted} of them as they are and refuses ${refusedByRule4} by rule 4 alone, and neutral-edits.ts finds one to three edits for ${foundAsEdits} of them.`)
}

// 6. What the check asks a writer to look at.
{
  expectSame([shapeOf('let rec count n = if n = 0 then 0 else 1 + count (n - 1) (* down *)'), shapeOf('let rec size k = if k = 7 then 12 else 3 + size (k - 20) (* up *)')], ['let rec a a = if a = 0 then 0 else 0 + a (a - 0) (* a *)', 'let rec a a = if a = 0 then 0 else 0 + a (a - 0) (* a *)'], 'the shape of two programs that differ in names and numbers')
  expectSame(shapeOf('let greeting = "hello, " ^ name'), 'let a = "" ^ a', 'the shape of a program with a string')
  const notesOf = (text: string, sameShape?: string) => caseNotes(madeCase(text), sameShape).join(' | ')
  expectSame(notesOf(`${before}let area = (width * height\n⟦missing⟧)⟦/⟧${after.slice(1)}`), '', 'a case with nothing to look at')
  expectHolds(notesOf(`⟦added⟧Sure, here is the whole program with the fix that you asked for in your last message:\n\n\`\`\`\n⟦/⟧let width = 72\nlet height = 24`), 'the repair keeps only 30 of', 'a repair that keeps little')
  expectHolds(notesOf(`⟦added⟧The fix:\n\n⟦/⟧\n${before}let cells = width * height`), 'the repaired program starts with white space', 'white space before the program that is kept')
  expectHolds(notesOf(`${before}let area = (width * height\n⟦missing⟧)⟦/⟧let cells = width * height\n⟦added⟧\nDone.⟦/⟧`), 'the repaired program ends with white space', 'white space after the program that is kept')
  expectHolds(notesOf(`${before}let tab = "[[tab]]"⟦added⟧;;⟦/⟧${after}`), 'a text holds [[tab]] as these characters', 'a name of a character in other brackets')
  expectHolds(notesOf(`${before}let cells = width (* the cells⟦missing⟧ *)⟦/⟧ * height${after}`), 'the first error is a comment that is not closed', 'a comment that is not closed')
  expectHolds(notesOf(`${before}let cells = width * height${after}let last = [cells;⟦added⟧;⟦/⟧ 2]`), 'only 3 of the', 'a first error near the end')
  expectHolds(notesOf(`${before}let area = (width * height\n⟦missing⟧)⟦/⟧${after.slice(1)}`, 'made-00'), 'differs from the one of made-00 in names, numbers and strings alone', 'a case with the shape of an earlier one')
  // The kept code points before the first error that the parser as it is shows as another thing: after a missing =,
  // the first name of the body reads as a parameter.
  const early = madeOpinion(`${before}let area w h\n  ⟦missing⟧= ⟦/⟧w * h${after}`).sample
  expectSame(wrongBeforeFirstError(early).map(position => early.broken[position]).join(''), 'w ', 'what the parser as it is shows otherwise before its first error')
  console.log('6. The check asks a writer to look at a repair that keeps little, white space around the program, a mistyped name of a character, a comment that is not closed, a late first error and a shape that comes twice.')
}

// 7. The three examples.
const examplesFolder = join(writtenFolder, 'examples')
{
  const {cases, problems: found} = readWritten(examplesFolder)
  expectSame(found, [], 'the problems of the examples')
  expectSame(cases.map(writtenCase => [writtenCase.id, writtenCase.opinions.length, writtenCase.sample.firstErrorPosition, writtenCase.sample.scored, writtenCase.disputedFromFirstError]), [
    ['examples-01', 2, 141, 174, true], ['examples-02', 2, 13, 148, false], ['examples-03', 2, 101, 79, false],
  ], 'the examples as the tools read them')
  const readme = readFileSync(join(writtenFolder, 'README.md'), 'utf8')
  const repairPage = readFileSync(join(writtenFolder, 'REPAIR.md'), 'utf8')
  const asWriter = readWritten(examplesFolder, {opinions: 'writer'}).cases
  const asSecond = readWritten(examplesFolder, {opinions: 'second'}).cases
  expectSame(asWriter.flatMap(writtenCase => caseNotes(writtenCase)), [], 'what the check asks to look at in the examples')
  // What the pages print for a case is what the check prints for it.
  if (cases.length === 3 && asWriter.length === 3 && asSecond.length === 3) {
    expectHolds(readme, `\n${describeCase(asWriter[0]!)}\n`, 'README.md, what the check prints for the first example')
    expectHolds(repairPage, `\n${describeCase(asSecond[1]!)}\n`, 'REPAIR.md, what the check prints for the second example')
    expectHolds(readme, `\n${differenceLines(cases[0]!).join('\n')}\n`, 'README.md, what the comparison prints for the first example')
  }
  // Every case and every repair that a page shows is in the files of the examples, line for line.
  const files = ['broken', 'repairs', 'second-repairs'].map(folder => readFileSync(join(examplesFolder, folder, 'examples.txt'), 'utf8'))
  let shown = 0
  for (const page of [readme, repairPage]) {
    for (const [, , block] of page.matchAll(/^(`{3,4})\n((?:⟦(?:case|repair) examples-[\s\S]*?⟦end⟧\n\n?)+)\1$/gm)) {
      for (const entry of block!.split(/\n(?=⟦(?:case|repair) )/)) {
        expect(files.some(file => file.includes(entry.trimEnd())), () => `a page shows an entry that is not in the files of the examples: ${JSON.stringify(entry.slice(0, 80))}`)
        shown++
      }
    }
  }
  expectSame(shown, 6, 'the entries of the examples that the pages show')
  console.log(`7. The three examples have no problem, and README.md and REPAIR.md print ${shown} of their entries and what the tools print for them.`)
}

// 8. The files of the set.
{
  // Counts only: a problem's text can quote a case, and nobody who builds or trains a parser may read one.
  const {cases, problems: found, leftOut} = readWritten()
  expect(found.length === 0, () => `the files of the set have ${found.length} problems, which keep ${leftOut.length} cases out: check.ts prints them`)
  expect(cases.every(writtenCase => writtenCase.opinions.every(opinion => opinion.sample.scored > 0)), () => 'a repair of the set has nothing to score')
  expect(cases.every(writtenCase => !Array.from(writtenCase.sample.labelKind).includes(displayKindNames.indexOf('error'))), () => 'a label of the set is the display kind error')
  const twice = cases.filter(writtenCase => writtenCase.opinions.length === 2).length
  console.log(`8. The set has ${cases.length} cases in ${new Set(cases.map(writtenCase => writtenCase.file)).size} files, ${twice} of them with two repairs, and ${found.length} problems. ${samplesOfWritten(cases).length} cases have full agreement from the first error on, and ${samplesOfWritten(cases, 'agreed code points').length} have an agreed code point there.`)
}

// 9. The edits that make a damaged place.
{
  const editsOf = (text: string) => {
    const derived = neutralEditsOf(madeCase(text))
    return `${derived.edits.join(', ')}${derived.otherPlaces.length === 0 ? '' : ` | ${derived.otherPlaces.map(place => `${place.added}/${place.missing}/${place.notInProgram}`).join(' ')}`}`
  }
  const rest = after.slice(1)
  expectSame(editsOf(`${before}let area = (width * height\n⟦missing⟧)⟦/⟧${rest}`), 'delete a code point', 'a missing code point')
  expectSame(editsOf(`${before}let area ⟦missing⟧= ⟦/⟧width * height${after}`), 'delete a run', 'a missing run')
  expectSame(editsOf(`${before}let area =\n⟦missing⟧  width * height\n⟦/⟧${rest}`), 'delete a line', 'a missing line')
  expectSame(editsOf(`${before}let area ⟦missing⟧= ⟦/⟧width * height\nlet cells = width * height\nlet () = print_int⟦missing⟧ cells\n⟦/⟧`), 'delete a run, cut the tail', 'a missing end')
  expectSame(editsOf(`${before}let area = width * height⟦added⟧)⟦/⟧${after}`), 'insert a code point', 'an added code point that the program holds')
  expectSame(editsOf(`${before}let area = width * height⟦added⟧;;⟦/⟧${after}`), ' | ;;//;', 'added code points that the program does not hold')
  expectSame(editsOf(`${before}let area ⟦added⟧*⟦/⟧⟦missing⟧=⟦/⟧ width * height${after}`), 'replace a code point', 'a code point in the place of another')
  expectSame(editsOf(`l⟦missing⟧e⟦/⟧t⟦added⟧e⟦/⟧ width = 72\nlet height = 24${after}`), 'swap two code points', 'two code points in the wrong order')
  expectSame(editsOf(`${before}let area = width * ⟦added⟧let cells ⟦/⟧height${after}`), 'copy a run', 'an added run that the program holds at another place')
  expectSame(editsOf(`${before}⟦added⟧let ⟦/⟧let area = width * height${after}`), 'duplicate a run', 'an added run beside its source')
  expectSame(editsOf(`${before}let area = (width\n  * height)\n⟦added⟧  * height)\n⟦/⟧${rest}`), 'duplicate a line', 'an added line beside its source')
  // A line that stands twice, the first time without its end: more code points than three copied runs hold.
  expectSame(editsOf(`${before}let scaled = width\n⟦added⟧  * area_of_the_whole_room_in_square_meters (hei\n⟦/⟧  * area_of_the_whole_room_in_square_meters (height)${after}`), 'duplicate a line, delete a run', 'a duplicated line that lost its end')
  // An added run that the fixed form of an alignment has one code point further right than the repair's marks: the
  // `(`, the name and the space are a run of the program, and the name, the space and the `(` are not.
  expectSame(editsOf(`${before}let area = ⟦added⟧(width ⟦/⟧(width * height)${after}`), 'duplicate a run', 'an added run that the fixed form moved')
  // The second pair of asterisks is a copy of the first, which two edits wrote.
  expectSame(editsOf(`${before}let area = width * ⟦added⟧**⟦/⟧24⟦added⟧**⟦/⟧${after}`), 'insert a code point, insert a code point, copy a run', 'a run that is a copy of text that an earlier edit wrote')
  const fourPlaces = neutralEditsOf(madeCase(`${before}let area = width⟦added⟧)⟦/⟧ * height⟦added⟧)⟦/⟧\nlet cells = width⟦added⟧)⟦/⟧ * height⟦added⟧)⟦/⟧\nlet () = print_int cells\n`))
  expectSame([fourPlaces.edits.length, damagePartOf(fourPlaces), couldComeFromEdits(fourPlaces)], [4, 'more edits', false], 'four places of one edit each')
  expectSame([kindsLineOf('made-01 delete a run, copy a run'), kindsLineOf('made-02 new: a sentence before the program'), kindsLineOf('made-03 insert a code point new: `;;` after a definition, with new: in it')], [
    {id: 'made-01', edits: ['delete a run', 'copy a run']}, {id: 'made-02', edits: [], other: 'a sentence before the program'}, {id: 'made-03', edits: ['insert a code point'], other: '`;;` after a definition, with new: in it'},
  ], 'the lines of kinds.txt')

  // The set: kinds.txt has a line for every case, with the edits that the writer's repair gives.
  const {cases} = readWritten()
  const kinds = readKinds()
  expectSame(kinds.problems.length, 0, 'the problems of kinds.txt')
  expectSame([...kinds.lines.keys()], cases.map(writtenCase => writtenCase.id), 'the cases of kinds.txt')
  const differs = cases.filter(writtenCase => {
    const listed = kinds.lines.get(writtenCase.id)
    const derived = neutralEditsOf(writtenCase)
    return listed === undefined || listed.edits.join(', ') !== derived.edits.join(', ') || (listed.other === undefined) !== couldComeFromEdits(derived)
  })
  expectSame(differs.map(writtenCase => writtenCase.id), [], 'the cases whose line of kinds.txt is not what neutral-edits.ts gives')
  console.log(`9. One made-up repair per edit of the train data's damage gives that edit. kinds.txt has ${kinds.lines.size} lines, ${[...kinds.lines.values()].filter(line => line.other === undefined).length} of them without "new:", and each is what the writer's repair gives.`)
}

// 10. The parts of the set for the final scoring.
const setParts = partsOfWritten()
{
  const {cases} = readWritten()
  const ids = (samples: readonly {id: string}[]) => samples.map(sample => sample.id).sort()
  const {all, perFile, neutralEdits, otherDamage, unmarked} = setParts
  for (const counted of ['fullAgreement', 'agreedCodePoints'] as const) {
    expectSame(ids([...neutralEdits[counted], ...otherDamage[counted]]), ids(all[counted]), `${counted}: the two parts of kinds.txt together`)
    expectSame(ids([...perFile.values()].flatMap(samples => samples[counted])), ids(all[counted]), `${counted}: the writers' files together`)
    expect(unmarked[counted].every(sample => all[counted].some(other => other.id === sample.id)), () => `${counted}: a case without a mark is no case of the set`)
  }
  expectSame(ids(all.agreedCodePoints), ids(cases.map(writtenCase => writtenCase.sample)), 'the cases over their agreed code points')
  expect(all.fullAgreement.every(sample => all.agreedCodePoints.includes(sample)), () => 'a case with full agreement is not among the cases over their agreed code points')
  // No disputed code point from the first error on is in a sample, and every one is in the list of them.
  const disputed = disputedCodePointsOf(cases)
  const disputedCases = new Set(disputed.filter(codePoint => codePoint.fromFirstError).map(codePoint => codePoint.id))
  expectSame(ids(all.agreedCodePoints.filter(sample => !all.fullAgreement.includes(sample))), [...disputedCases].sort(), 'the cases with a disputed code point from the first error on')
  expect(disputed.every(codePoint => cases.find(writtenCase => writtenCase.id === codePoint.id)!.sample.alignment[codePoint.position] === -1), () => 'a disputed code point has a label in its case\'s sample')
  expect(disputed.every(codePoint => codePoint.writer === undefined || codePoint.second === undefined || JSON.stringify(codePoint.writer) !== JSON.stringify(codePoint.second)), () => 'a disputed code point has the same label by both repairs')
  // The parser as it is, by the exact parser and by the loop over packed samples.
  const rows = rowsOfParts(setParts)
  for (const {name, samples} of rows.slice(0, 5)) expectSame(scoreOfParserAsItIs(samples), scoreTables(baseTables(), packSamples(samples)).score, `the score of the parser as it is by its two routes, ${name}`)
  const main = scoreOfParserAsItIs(all.fullAgreement)
  expect(main.wholeSamples === 0 && main.insertedTokens === 0 && main.allThreeRight * 20 < main.scoredCodePoints, () => 'the parser as it is has a whole case, inserts a token or has more than a twentieth of the scored code points right')
  console.log(`10. The set as samples: ${all.fullAgreement.length} cases with full agreement and ${all.agreedCodePoints.length} over their agreed code points, in ${rows.length} rows that add up. ${disputed.length} disputed code points, ${disputed.filter(codePoint => codePoint.fromFirstError).length} of them from the first error on, are in no sample. The parser as it is has ${main.allThreeRight} of ${main.scoredCodePoints} scored code points right by both routes.`)
}

// 11. README.md holds the numbers of the set.
{
  const {cases} = readWritten()
  const readme = readFileSync(join(writtenFolder, 'README.md'), 'utf8')
  for (const line of readmeLines(cases)) expectHolds(readme, line, 'README.md, a line of numbers.ts')
  const number = (value: number) => Number.isNaN(value) ? 'none' : value.toFixed(1)
  for (const {name, samples} of rowsOfParts(setParts)) {
    const score = scoreOfParserAsItIs(samples)
    const shares = sharesOf(score)
    const packed = packSamples(samples)
    expectHolds(readme, `| ${name} | ${score.samples} | ${score.scoredCodePoints.toLocaleString('en-US')} | ${number(100 * packed.boundCodePoints / packed.scoredCodePoints)} | ${number(shares.allThree)} | ${number(shares.whole)} | ${number(shares.kind)} | ${number(shares.depth)} | ${number(shares.container)} | ${number(shares.stack)} | ${number(shares.constituentsFound)}, ${number(shares.constituentsRight)} |`, 'README.md, a row of score.ts')
  }
  console.log('11. README.md holds the lines of numbers.ts and the rows of score.ts for the parser as it is.')
}

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
