// What a repairer runs on a repair file: it holds the file against the part file with the broken texts, says what is
// wrong, and prints every repair back as the tools read it, see show.ts for the rows.
//
// Run from the repo root: bun lab/recovery-parser/written/check-repairs.ts <repair file> <part file>
// The last line is "<number> broken texts, <number> repairs, <number> problems", and the exit code is 1 when there
// is a problem.
//
// A problem is something that keeps a repair out of the set: the file's format, a repair that is not valid JSON or is
// past the highlighter's capacity, a repair of an id that the part does not have, a broken text without a repair. A
// line that starts with "look at" names something that may be right and often is a mistake, e.g. a repair that adds
// white space, which a repair of the damage alone rarely needs.
import {readFileSync} from 'node:fs'
import {basename} from 'node:path'
import {visible} from '../dump.ts'
import {mistypedNames, readPartFile, readRepairFile} from './format.ts'
import {describeCase, whiteSpaceOnlyChanges} from './show.ts'
import {type WrittenCase, brokenTextProblems, caseOf, validTextProblems} from './written.ts'

const isWhiteSpace = (character: string | undefined) => character === ' ' || character === '\t' || character === '\n' || character === '\r'

// What may be right in a repair and often is a mistake. The case is the broken text with the repair as its one opinion.
export function repairNotes(repaired: WrittenCase): string[] {
  const notes: string[] = []
  const opinion = repaired.opinions[0]!
  const valid = Array.from(opinion.text)
  const kept = new Set(opinion.alignment)
  const addedWhiteSpace = valid.filter((character, index) => isWhiteSpace(character) && !kept.has(index)).length
  if (addedWhiteSpace >= 3) notes.push(`the repair has ${addedWhiteSpace} white space code points that the broken text lacks. A repair adds only what is missing and keeps the layout of the broken text`)
  const whiteSpaceChanges = whiteSpaceOnlyChanges(opinion, repaired.broken)
  if (whiteSpaceChanges >= 3) notes.push(`the repair and the broken text differ by white space alone in ${whiteSpaceChanges} places. Was the text laid out anew? A repair keeps the layout of the broken text`)
  const keptCount = opinion.alignment.filter(counterpart => counterpart !== -1).length
  if (keptCount * 2 < opinion.alignment.length) notes.push(`the tools pair only ${keptCount} of the broken text's ${opinion.alignment.length} code points with the repair. That is right when most of the broken text is not a part of the document`)
  for (const mistyped of mistypedNames(opinion.text)) notes.push(`the repair holds ${mistyped} as these characters. A character that cannot be seen is written between ⟦ and ⟧`)
  return notes
}

if (import.meta.main) {
  const [repairFile, partFile] = process.argv.slice(2)
  if (repairFile === undefined || partFile === undefined) throw new Error('usage: bun lab/recovery-parser/written/check-repairs.ts <repair file> <part file>')
  const part = readPartFile(readFileSync(partFile, 'utf8'))
  const repairs = readRepairFile(readFileSync(repairFile, 'utf8'))
  let problems = part.problems.length + repairs.problems.length
  for (const problem of part.problems) console.log(`problem in the part file: ${problem}`)
  for (const problem of repairs.problems) console.log(`problem: ${problem}`)
  if (problems > 0) console.log('')
  const repairOf = new Map(repairs.items.map(repair => [repair.id, repair]))
  const partIds = new Set(part.items.map(entry => entry.id))
  for (const repair of repairs.items) {
    if (partIds.has(repair.id)) continue
    problems++
    console.log(`problem: repair ${repair.id}, line ${repair.line}: the part file has no broken text with this id\n`)
  }
  for (const entry of part.items) {
    const repair = repairOf.get(entry.id)
    if (repair === undefined) {
      problems++
      console.log(`--- ${entry.id}\n    problem: the broken text has no repair\nbrok  ${visible(entry.broken)}\n`)
      continue
    }
    const found = validTextProblems(repair.repaired).map(problem => `the repair: ${problem}`)
    // A broken text of a part file is one that the checks of the case files let through, so this never fires on a
    // part file that blind.ts wrote.
    found.push(...brokenTextProblems(entry.broken).map(problem => `the broken text: ${problem}`))
    problems += found.length
    if (found.length > 0) {
      console.log(`--- ${entry.id}`)
      for (const problem of found) console.log(`    problem: ${problem}`)
      console.log(`rep   ${visible(repair.repaired)}\nbrok  ${visible(entry.broken)}\n`)
      continue
    }
    const repaired = caseOf({id: entry.id, from: '', note: undefined, debatable: false, intended: repair.repaired, broken: entry.broken}, basename(repairFile))
    repaired.opinions[0]!.unsure = repair.unsure
    const described = describeCase(repaired, 'rep').split('\n')
    console.log([described[0]!, ...repairNotes(repaired).map(note => `    look at: ${note}`), ...described.slice(1)].join('\n'))
    console.log('')
  }
  console.log(`${part.items.length} broken texts, ${repairs.items.length} repairs, ${problems} problems`)
  if (problems > 0) process.exitCode = 1
}
