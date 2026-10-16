// Writes cases of the written set into one text file for a human reader: per case what show.ts prints for it, i.e.
// the repaired program with its labels and the broken program with the alignment, the labels and what the parser as
// it is shows. A case whose two repairs give a code point other labels also has the lines of compare.ts and the two
// repairs side by side.
//
// The file holds the texts of cases, so it goes to a folder outside the repo, and its first line says that it is
// held back, see ../README.md. The command refuses a path inside the repo.
//
// Run from the repo root: bun lab/recovery-lr/held-back/written/dump.ts <file to write> [--all] [--set <folder>]
// Without --all it writes 60 cases, 20 of each writer's file: the cases whose number leaves 1 or 4 when it is divided
// by 7, e.g. hand-editing-01, -04, -08 and -11. The rule is fixed so that nobody picks the cases by what they show.
import {mkdirSync, writeFileSync} from 'node:fs'
import {dirname, join, resolve, sep} from 'node:path'
import {differenceLines, differencesOf} from './compare.ts'
import {neutralEditsOf, readKinds} from './neutral-edits.ts'
import {describeCase, describeOpinions} from './show.ts'
import {type WrittenCase, namesOf, readWritten, setFolderOf, writtenFolder} from './written.ts'

// Whether the fixed rule takes a case: its number leaves 1 or 4 when it is divided by 7.
export function isDumped(writtenCase: Pick<WrittenCase, 'id'>): boolean {
  const number = Number(/-(\d+)$/.exec(writtenCase.id)?.[1])
  return number % 7 === 1 || number % 7 === 4
}

// What the file holds for one case.
export function dumpOfCase(writtenCase: WrittenCase, kindsLine: string | undefined): string {
  const differences = differencesOf(writtenCase)
  const {edits} = neutralEditsOf(writtenCase)
  return [
    describeCase(writtenCase),
    '',
    `    kinds.txt: ${kindsLine ?? `no line. The edits of the train data's damage that make the damaged places: ${edits.join(', ')}`}`,
    ...(differences.length === 0 ? ['    the second repair gives every code point the same label'] : ['', ...differenceLines(writtenCase, differences), describeOpinions(writtenCase)]),
  ].join('\n')
}

if (import.meta.main) {
  const commandArguments = process.argv.slice(2)
  const path = namesOf(commandArguments)[0]
  if (path === undefined) throw new Error('usage: bun lab/recovery-lr/held-back/written/dump.ts <file to write> [--all] [--set <folder>]')
  const repoRoot = resolve(writtenFolder, '..', '..', '..', '..')
  if (resolve(path).startsWith(repoRoot + sep)) throw new Error(`${path} is inside the repo: a dump of the held-back set goes to a folder outside it`)
  const folder = setFolderOf(commandArguments)
  const {cases, problems} = readWritten(folder)
  if (problems.length > 0) throw new Error(`the files of the set have ${problems.length} problems: check.ts prints them`)
  const kinds = readKinds(folder).lines
  const chosen = commandArguments.includes('--all') ? cases : cases.filter(isDumped)
  const kindsLineOf = (id: string) => {
    const line = kinds.get(id)
    return line === undefined ? undefined : `${line.edits.join(', ')}${line.other === undefined ? '' : `${line.edits.length === 0 ? '' : ' '}new: ${line.other}`}`
  }
  const text = [
    `HELD BACK: ${chosen.length} of the ${cases.length} cases of the written set of ${join('lab', 'recovery-lr', 'held-back', 'written')}. Whoever builds or trains a parser, or writes a bar, does not read this file.`,
    'REPAIR.md in that folder explains the rows. A score counts the kept code points from the ^ of the row "first" on.',
    '',
    ...chosen.map(writtenCase => `${dumpOfCase(writtenCase, kindsLineOf(writtenCase.id))}\n`),
  ].join('\n')
  mkdirSync(dirname(resolve(path)), {recursive: true})
  writeFileSync(path, text)
  console.log(`${chosen.length} of ${cases.length} cases written to ${path}`)
}
