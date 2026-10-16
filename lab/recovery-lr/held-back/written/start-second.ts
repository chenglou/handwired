// Writes the file that a second repairer starts from: every broken program of one writer's file as an aligned text
// without marks, under the ids of the broken programs. The second repairer then adds the marks.
//
// Run from the repo root: bun lab/recovery-lr/held-back/written/start-second.ts <name of a writer's file> [--set <folder>]
// E.g. `start-second.ts hand-edits` reads broken/hand-edits.txt and writes second-repairs/hand-edits.txt. It reads
// nothing of repairs/, prints no text of a case, and does not write over a file that is there.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {blankRepairFileText, readBrokenFile} from './format.ts'
import {namesOf, setFolderOf} from './written.ts'

if (import.meta.main) {
  const commandArguments = process.argv.slice(2)
  const name = namesOf(commandArguments)[0]
  if (name === undefined) throw new Error('usage: bun lab/recovery-lr/held-back/written/start-second.ts <name of a writer\'s file> [--set <folder>]')
  const folder = setFolderOf(commandArguments)
  const brokenPath = join(folder, 'broken', `${name}.txt`)
  const secondPath = join(folder, 'second-repairs', `${name}.txt`)
  if (!existsSync(brokenPath)) throw new Error(`${brokenPath}: there is no such file of broken programs`)
  if (existsSync(secondPath)) throw new Error(`${secondPath} is there already, and this command does not write over it`)
  const brokenFile = readFileSync(brokenPath, 'utf8')
  mkdirSync(join(folder, 'second-repairs'), {recursive: true})
  writeFileSync(secondPath, blankRepairFileText(brokenFile))
  console.log(`${secondPath}: ${readBrokenFile(brokenFile).items.length} repairs without marks. Add the marks by the rules of REPAIR.md, then run check.ts ${name} --second.`)
}
