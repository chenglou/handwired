// What a writer runs on a file of cases, and what checks the whole set: it says what is wrong with the files and
// prints every case back as the tools read it, see show.ts for the rows.
//
// Run from the repo root:
//   bun lab/recovery-toml/held-back/written/check.ts hand-edits            one writer's file: broken/hand-edits.txt with repairs/hand-edits.txt
//   bun lab/recovery-toml/held-back/written/check.ts hand-edits --second   the same broken payloads with second-repairs/hand-edits.txt alone
//   bun lab/recovery-toml/held-back/written/check.ts                       every file of the set, with one line per case
//   … --set <folder>                                                      another folder of the same layout, e.g. examples/ in this folder
// The last line is "<number> cases, <number> problems", and the exit code is 1 when there is a problem.
//
// A problem is something that keeps a case out of the set: the format of a file, a repaired document that is not valid
// TOML for the table parser, the reference or Bun's parser, a broken payload that the table parser accepts, an aligned
// text that does not give the broken payload, a mark against the rules of REPAIR.md, a broken payload outside 40 to
// 480 code points, an id or a broken payload that stands twice. A line that starts with "look at" names something that
// may be right and often is a mistake, e.g. a repair that keeps less than half of the broken payload.
import {mistypedNames} from './format.ts'
import {describeCase} from './show.ts'
import {type WrittenCase, bunAccepts, namesOf, readWritten, scoredCodePointsOfWritten, setFolderOf} from './written.ts'

const isWhiteSpace = (character: string | undefined) => character === ' ' || character === '\t' || character === '\n' || character === '\r'

// A broken payload without what only names make different: every run of letters is one letter, and every run of
// digits one digit. Two cases with the same shape differ in their names and numbers alone.
export const shapeOf = (text: string) => text.replace(/\p{L}+/gu, 'a').replace(/\d+/g, '0')

// What may be right in a case and often is a mistake. `sameShape` is the id of an earlier case with the same shape.
export function caseNotes(writtenCase: WrittenCase, sameShape?: string): string[] {
  const notes: string[] = []
  const first = writtenCase.opinions[0]!
  const repaired = Array.from(first.text)
  const broken = Array.from(writtenCase.broken)
  const kept = first.alignment.filter(counterpart => counterpart !== -1).length
  if (kept * 2 < first.alignment.length) notes.push(`the repair keeps only ${kept} of the broken payload's ${first.alignment.length} code points. Is the repaired document the broken payload with the smallest change?`)
  // White space outside the document, on a side where the broken payload has other text: see REPAIR.md.
  const firstKept = first.alignment.findIndex(counterpart => counterpart !== -1)
  const lastKept = first.alignment.findLastIndex(counterpart => counterpart !== -1)
  if (isWhiteSpace(repaired[0]) && broken.slice(0, Math.max(0, firstKept)).some(character => !isWhiteSpace(character))) notes.push('the repaired document starts with white space, and the broken payload has other text before the document. White space between that text and the document goes with the text, so the repaired document starts with the document\'s first character')
  if (isWhiteSpace(repaired.at(-1)) && lastKept !== -1 && broken.slice(lastKept + 1).some(character => !isWhiteSpace(character))) notes.push('the repaired document ends with white space, and the broken payload has other text after the document. White space between the document and that text goes with the text, so the repaired document ends with the document\'s last character')
  for (const mistyped of [...mistypedNames(first.text), ...mistypedNames(writtenCase.broken)]) notes.push(`a text holds ${mistyped} as these characters. A character that cannot be seen and a mark are written between ⟦ and ⟧`)
  if (scoredCodePointsOfWritten(writtenCase) === 0) notes.push('no code point from the parser\'s first error on has a label, so the case has nothing to recover. That is right for a text that is cut off, and a set needs few such cases')
  if (bunAccepts(writtenCase.broken)) notes.push('Bun\'s parser accepts the broken payload. That is right when the damage is something that TOML 1.1 allows and TOML 1.0 does not, e.g. a line end inside an inline table or a comma before its }, or a byte order mark')
  if (sameShape !== undefined) notes.push(`the broken payload differs from the one of ${sameShape} in names and numbers alone. Two such cases test the same thing: change the damage or the document of one`)
  return notes
}

if (import.meta.main) {
  const commandArguments = process.argv.slice(2)
  const folder = setFolderOf(commandArguments)
  const only = namesOf(commandArguments)[0]
  const second = commandArguments.includes('--second')
  // One file is read with the repairs of one repairer, so that a case is printed as that repairer reads it. The whole
  // set is read with both repairs of every case.
  const {cases, problems, leftOut} = readWritten(folder, only === undefined ? {} : {only, opinions: second ? 'second' : 'writer'})
  for (const problem of problems) console.log(`problem: ${problem}`)
  if (leftOut.length > 0) console.log(`Not printed below, since a problem keeps ${leftOut.length === 1 ? 'it' : 'them'} out: ${leftOut.join(', ')}`)
  if (problems.length > 0) console.log('')
  const idOfShape = new Map<string, string>()
  let notes = 0
  for (const writtenCase of cases) {
    const shape = shapeOf(writtenCase.broken)
    const found = caseNotes(writtenCase, idOfShape.get(shape))
    if (!idOfShape.has(shape)) idOfShape.set(shape, writtenCase.id)
    notes += found.length
    const described = describeCase(writtenCase).split('\n')
    // One file is printed case by case, with the notes right under the case's first line. The whole set is printed
    // with one line per case, and show.ts prints a case of it.
    if (only !== undefined) console.log(`${[described[0]!, ...found.map(note => `    look at: ${note}`), ...described.slice(1)].join('\n')}\n`)
    else console.log([`${writtenCase.file} ${writtenCase.id}: ${Array.from(writtenCase.broken).length} code points, first error at ${writtenCase.firstErrorPosition}, ${scoredCodePointsOfWritten(writtenCase)} scored from there on`, ...found.map(note => `    look at: ${note}`)].join('\n'))
  }
  const lengths = cases.map(writtenCase => Array.from(writtenCase.broken).length)
  const between = (from: number, to: number) => lengths.filter(length => length >= from && length <= to).length
  const nothingToRecover = cases.filter(writtenCase => scoredCodePointsOfWritten(writtenCase) === 0).length
  console.log(`Broken payloads by length in code points: ${between(0, 119)} under 120, ${between(120, 300)} from 120 to 300, ${between(301, Infinity)} over 300. ${nothingToRecover} of ${cases.length} have nothing to recover.`)
  console.log(`${cases.length} cases${only !== undefined && second ? ' with their second repairs' : ''}, ${problems.length} problems, ${notes} lines to look at`)
  if (problems.length > 0) process.exitCode = 1
}
