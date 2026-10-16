// What a writer runs on a file of cases, and what checks the whole set: it says what is wrong with the files and
// prints every case back as the tools read it, see show.ts for the rows.
//
// The command prints the texts of cases, so only those who may read this folder run it, see ../README.md.
//
// Run from the repo root:
//   bun lab/recovery-lr/held-back/written/check.ts hand-edits            one writer's file: broken/hand-edits.txt with repairs/hand-edits.txt
//   bun lab/recovery-lr/held-back/written/check.ts hand-edits --second   the same broken programs with second-repairs/hand-edits.txt alone
//   bun lab/recovery-lr/held-back/written/check.ts                       every file of the set, with one line per case
//   … --set <folder>                                                    another folder of the same layout, e.g. examples/ in this folder
// The last line is "<number> cases, <number> problems, <number> lines to look at", and the exit code is 1 when there
// is a problem.
//
// A problem is something that keeps a case out of the set: the format of a file, a repaired program that the parser
// rejects, a broken program that the parser accepts, an aligned text that does not give the broken program, a missing
// token before white space of the broken program (rule 4 of REPAIR.md), a broken program outside 40 to 480 code
// points, a case with nothing to score, an id or a broken program that stands twice. A line that starts with "look at"
// names something that may be right and often is a mistake, e.g. a repair that keeps less than half of the broken
// program.
import {symbolOf} from '../../tables.ts'
import {mistypedNames} from './format.ts'
import {describeCase} from './show.ts'
import {type WrittenCase, namesOf, readWritten, setFolderOf} from './written.ts'

const isWhiteSpace = (character: string | undefined) => character === ' ' || character === '\t' || character === '\n' || character === '\r'

// A broken program without what only names make different: every run of letters, digits, `_` and `'` that is no
// keyword is one letter, every run of digits one digit, and the content of every string is left out. Two cases with
// the same shape differ in their names, numbers and strings alone.
const keywords = new Set(['let', 'rec', 'in', 'if', 'then', 'else', 'fun', 'true', 'false'])
export const shapeOf = (text: string) => text.replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/[A-Za-z_][A-Za-z0-9_']*/g, word => keywords.has(word) ? word : 'a').replace(/\d+/g, '0')

const unclosedComment = symbolOf('BADCOMMENT')

// What may be right in a case and often is a mistake. `sameShape` is the id of an earlier case with the same shape.
export function caseNotes(writtenCase: WrittenCase, sameShape?: string): string[] {
  const notes: string[] = []
  const first = writtenCase.opinions[0]!
  const {sample} = first
  const repaired = Array.from(first.text)
  const broken = Array.from(writtenCase.broken)
  const kept = sample.alignment.reduce((total, counterpart) => total + Number(counterpart !== -1), 0)
  if (kept * 2 < sample.alignment.length) notes.push(`the repair keeps only ${kept} of the broken program's ${sample.alignment.length} code points. Is the repaired program the broken program with the smallest change?`)
  // White space outside the program, on a side where the broken program has other text: see REPAIR.md.
  const firstKept = sample.alignment.findIndex(counterpart => counterpart !== -1)
  const lastKept = sample.alignment.findLastIndex(counterpart => counterpart !== -1)
  if (isWhiteSpace(repaired[0]) && broken.slice(0, Math.max(0, firstKept)).some(character => !isWhiteSpace(character))) notes.push('the repaired program starts with white space, and the broken program has other text before the program. White space between that text and the program goes with the text, so the repaired program starts with the program\'s first character')
  if (isWhiteSpace(repaired.at(-1)) && lastKept !== -1 && broken.slice(lastKept + 1).some(character => !isWhiteSpace(character))) notes.push('the repaired program ends with white space, and the broken program has other text after the program. White space between the program and that text goes with the text, so the repaired program ends with the program\'s last character')
  for (const mistyped of [...mistypedNames(first.text), ...mistypedNames(writtenCase.broken)]) notes.push(`a text holds ${mistyped} as these characters. A character that cannot be seen and a mark are written between ⟦ and ⟧`)
  // Little to recover: few code points from the first error on, or a first error in a comment that takes the rest.
  if (sample.tokens.kind[sample.firstErrorToken] === unclosedComment) notes.push('the first error is a comment that is not closed. The scanner reads the rest of the program as that comment, so no parser can show what comes after it. A file holds at most two such cases')
  else if (sample.scored * 5 < kept || sample.scored < 20) notes.push(`only ${sample.scored} of the ${kept} kept code points stand from the parser's first error on, and a score counts no other. Put the damage where a good part of the program comes after it`)
  if (sameShape !== undefined) notes.push(`the broken program differs from the one of ${sameShape} in names, numbers and strings alone. Two such cases test the same thing: change the damage or the program of one`)
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
    else console.log([`${writtenCase.file} ${writtenCase.id}: ${Array.from(writtenCase.broken).length} code points, first error at ${writtenCase.sample.firstErrorPosition}, ${writtenCase.sample.scored} scored from there on`, ...found.map(note => `    look at: ${note}`)].join('\n'))
  }
  const lengths = cases.map(writtenCase => Array.from(writtenCase.broken).length)
  const between = (from: number, to: number) => lengths.filter(length => length >= from && length <= to).length
  console.log(`Broken programs by length in code points: ${between(0, 119)} under 120, ${between(120, 300)} from 120 to 300, ${between(301, Infinity)} over 300.`)
  console.log(`${cases.length} cases${only !== undefined && second ? ' with their second repairs' : ''}, ${problems.length} problems, ${notes} lines to look at`)
  if (problems.length > 0) process.exitCode = 1
}
