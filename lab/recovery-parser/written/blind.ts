// Writes the broken texts of every case, and nothing else of the cases, into part files for the repairers.
//
// Run from the repo root: bun lab/recovery-parser/written/blind.ts <folder for the part files> [mapping file] [folder of the set]
// It writes part-1.txt, part-2.txt and so on with 80 broken texts each, in an order that a fixed seed shuffles, so
// that a part mixes the writers. A text's id is a hash of the text, see blindIdOf: it tells neither the writer nor the
// source, and written.ts finds the case of a repair by it without any other file. The mapping file is for people: it
// says for every id which case of which writer's file it is and which part holds it. Its default place is
// mapping.json next to the folder of the part files. The repairers get the part files and never the mapping.
import {mkdirSync, readdirSync, writeFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {createRandom} from '../random.ts'
import {partFileText} from './format.ts'
import {readWritten, writtenFolder} from './written.ts'

const casesPerPart = 80
const shuffleSeed = 20261015

if (import.meta.main) {
  const partsFolder = process.argv[2]
  if (partsFolder === undefined) throw new Error('usage: bun lab/recovery-parser/written/blind.ts <folder for the part files> [mapping file] [folder of the set]')
  const mappingFile = process.argv[3] ?? join(dirname(resolve(partsFolder)), 'mapping.json')
  const {cases, problems} = readWritten(process.argv[4] ?? writtenFolder)
  if (problems.length > 0) {
    for (const problem of problems) console.log(`problem: ${problem}`)
    throw new Error(`${problems.length} problems in the case files: no part file is written before they are gone`)
  }
  // Sorted by id first, so that the order depends on the texts alone and not on the names of the writers' files.
  const sorted = [...cases].sort((left, right) => left.blindId < right.blindId ? -1 : 1)
  const shuffled = createRandom(shuffleSeed, 0).shuffled(sorted)
  mkdirSync(partsFolder, {recursive: true})
  const mapping: {seed: number, parts: {file: string, ids: string[]}[], cases: Record<string, {id: string, file: string, part: string}>} = {seed: shuffleSeed, parts: [], cases: {}}
  for (let first = 0; first < shuffled.length; first += casesPerPart) {
    const part = shuffled.slice(first, first + casesPerPart)
    const file = `part-${first / casesPerPart + 1}.txt`
    writeFileSync(join(partsFolder, file), partFileText(part.map(writtenCase => ({id: writtenCase.blindId, broken: writtenCase.broken}))))
    mapping.parts.push({file, ids: part.map(writtenCase => writtenCase.blindId)})
    for (const writtenCase of part) mapping.cases[writtenCase.blindId] = {id: writtenCase.id, file: writtenCase.file, part: file}
  }
  writeFileSync(mappingFile, `${JSON.stringify(mapping, null, 2)}\n`)
  // A part file of an earlier run with more parts is no part of this run.
  const written = new Set(mapping.parts.map(part => part.file))
  const left = readdirSync(partsFolder).filter(name => /^part-\d+\.txt$/.test(name) && !written.has(name))
  if (left.length > 0) console.log(`The folder also holds ${left.join(', ')} from an earlier run, which this run did not write: move them away.`)
  console.log(`${cases.length} broken texts in ${mapping.parts.length} part files in ${resolve(partsFolder)}: ${mapping.parts.map(part => `${part.file} with ${part.ids.length}`).join(', ')}. The mapping is in ${resolve(mappingFile)}.`)
}
