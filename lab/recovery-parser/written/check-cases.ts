// What a writer runs on a case file: it says what is wrong with the file and prints every case back as the tools read
// it, see show.ts for the rows.
//
// Run from the repo root: bun lab/recovery-parser/written/check-cases.ts <file>
// The last line is "<number> cases, <number> problems", and the exit code is 1 when there is a problem.
//
// A problem is something that keeps a case out of the set: the file's format, an intended text that is not valid
// JSON, a broken text that is, a text past the highlighter's capacity, a broken text outside 20 to 500 code points, an
// id or a broken text that stands twice. A line that starts with "look at" names something that may be right and
// often is a mistake, e.g. a broken text of which the tools can pair less than half with the intended text.
import {readFileSync} from 'node:fs'
import {basename} from 'node:path'
import {visible} from '../dump.ts'
import {type CaseEntry, mistypedNames, readCaseFile} from './format.ts'
import {describeCase, whiteSpaceOnlyChanges} from './show.ts'
import {type WrittenCase, brokenTextProblems, caseOf, scoredCodePointsOfWritten, validTextProblems} from './written.ts'

export const shortestBroken = 20
export const longestBroken = 500
const isWhiteSpace = (character: string | undefined) => character === ' ' || character === '\t' || character === '\n' || character === '\r'

// What keeps a case out of the set, apart from what its file's format and the other cases say.
export function caseProblems(texts: Pick<CaseEntry, 'intended' | 'broken'>): string[] {
  const length = Array.from(texts.broken).length
  return [
    ...validTextProblems(texts.intended).map(problem => `the intended text: ${problem}`),
    ...brokenTextProblems(texts.broken).map(problem => `the broken text: ${problem}`),
    ...(length < shortestBroken || length > longestBroken ? [`the broken text has ${length} code points, and a case has ${shortestBroken} to ${longestBroken}`] : []),
  ]
}

// What may be right in a case and often is a mistake.
export function caseNotes(writtenCase: WrittenCase): string[] {
  const notes: string[] = []
  const writer = writtenCase.opinions[0]!
  const intended = Array.from(writtenCase.original)
  const kept = writer.alignment.filter(counterpart => counterpart !== -1).length
  if (kept * 2 < writer.alignment.length) notes.push(`the tools pair only ${kept} of the broken text's ${writer.alignment.length} code points with the intended text. Is the broken text the intended text with the damage and no other change?`)
  const whiteSpaceChanges = whiteSpaceOnlyChanges(writer, writtenCase.broken)
  if (whiteSpaceChanges >= 3) notes.push(`the two texts differ by white space alone in ${whiteSpaceChanges} places. Was one of them laid out anew? The broken text has the layout of the intended text wherever the damage did not touch it`)
  // White space outside the document, on a side where the broken text has other text: see the README's rule.
  const firstKept = writer.alignment.findIndex(counterpart => counterpart !== -1)
  const lastKept = writer.alignment.findLastIndex(counterpart => counterpart !== -1)
  const broken = Array.from(writtenCase.broken)
  if (isWhiteSpace(intended[0]) && broken.slice(0, Math.max(0, firstKept)).some(character => !isWhiteSpace(character))) notes.push('the intended text starts with white space, and the broken text has other text before the document. White space between that text and the document goes with the text, so the intended text starts with the document\'s first character')
  if (isWhiteSpace(intended.at(-1)) && lastKept !== -1 && broken.slice(lastKept + 1).some(character => !isWhiteSpace(character))) notes.push('the intended text ends with white space, and the broken text has other text after the document. White space between the document and that text goes with the text, so the intended text ends with the document\'s last character')
  for (const mistyped of [...mistypedNames(writtenCase.original), ...mistypedNames(writtenCase.broken)]) notes.push(`a text holds ${mistyped} as these characters. A character that cannot be seen is written between ⟦ and ⟧`)
  if (scoredCodePointsOfWritten(writtenCase) === 0) notes.push('no code point from the parser\'s first error on has a label, so the case has nothing to recover. That is right for a text that is cut off, and a set needs few such cases')
  return notes
}

if (import.meta.main) {
  const file = process.argv[2]
  if (file === undefined) throw new Error('usage: bun lab/recovery-parser/written/check-cases.ts <file>')
  const read = readCaseFile(readFileSync(file, 'utf8'))
  let problems = read.problems.length
  for (const problem of read.problems) console.log(`problem: ${problem}`)
  if (read.problems.length > 0) console.log('')
  const idOfBroken = new Map<string, string>()
  const brokenLengths: number[] = []
  let severalLines = 0
  for (const texts of read.items) {
    const found = caseProblems(texts)
    if (idOfBroken.has(texts.broken)) found.push(`the broken text is also the broken text of the case ${idOfBroken.get(texts.broken)}`)
    else idOfBroken.set(texts.broken, texts.id)
    problems += found.length
    brokenLengths.push(Array.from(texts.broken).length)
    if (texts.broken.includes('\n')) severalLines++
    // A case whose texts are not what they must be cannot be aligned, so its texts are printed as they are.
    if (validTextProblems(texts.intended).length > 0 || brokenTextProblems(texts.broken).length > 0) {
      console.log(`--- ${texts.id}  from: ${texts.from}`)
      for (const problem of found) console.log(`    problem: ${problem}`)
      console.log(`orig  ${visible(texts.intended)}\nbrok  ${visible(texts.broken)}\n`)
      continue
    }
    const writtenCase = caseOf(texts, basename(file))
    const described = describeCase(writtenCase).split('\n')
    // The problems and the notes stand right under the case's first line.
    console.log([described[0]!, ...found.map(problem => `    problem: ${problem}`), ...caseNotes(writtenCase).map(note => `    look at: ${note}`), ...described.slice(1)].join('\n'))
    console.log('')
  }
  const between = (from: number, to: number) => brokenLengths.filter(length => length >= from && length <= to).length
  console.log(`Broken texts by length in code points: ${between(0, 59)} under 60, ${between(60, 300)} from 60 to 300, ${between(301, Infinity)} over 300. ${severalLines} of ${read.items.length} are on several lines.`)
  console.log('The rules ask for most between 60 and 300, and for about a third on several lines.')
  console.log(`${read.items.length} cases, ${problems} problems`)
  if (problems > 0) process.exitCode = 1
}
