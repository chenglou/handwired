// Checks the commands that read saved tables, on tables with added structure: score.ts, compare.ts and
// handwritten/show.ts. The other checks cover what the commands are made of. This one runs the commands themselves,
// as a person would, on saved files of each kind of structure, see structure/README.md.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/check-commands.ts
//
// Per kind of structure (an added class with two added tokenizer states, open entries of the display table, the bit
// "first on its line", and all three with added states), the check saves tables in which a random half of the open
// cells holds a random choice, and the tables without any changed cell as their base. Then:
// 1. score.ts --tables <file> --base <base> --cells runs, prints the two counts of cells as this check counts them,
//    and its row "all" has the main number that scoreTables gives.
// 2. compare.ts <name>=<file>,<base> runs and its row holds the same two counts and the same main number.
// 3. handwritten/show.ts --tables <file> --split validation --wrong --cells runs and shows samples.
// And the two counts are not the same number once structure is added: a class that is added to tables whose cells
// are changed already adds to the cells that differ from today's parser, and changes no cell against its base.
// 4. A file of tables that was saved with another version of the dataset, or before the dataset's key was written:
//    compare.ts and score.ts score it after a line that starts with "Note:", and search.ts --from and
//    soft/train.ts --base refuse to start from it.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join, relative, resolve} from 'node:path'
import {createRandom} from '../random.ts'
import {datasetKey, loadSamples, refuseUnknownOptions, standardRange} from './data.ts'
import {handwrittenTables} from './handwritten/rules.ts'
import {type RecoveryTables, addClasses, addFirstOnLineBit, addStates, asIsTables, copyTables, differencesOf, grammarStateNames, openDisplayEntries, randomizeOpenCells, saveTables} from './recovery-tables.ts'
import {cellCountsOf, scoreTables, sharesOf} from './score.ts'

let failures = 0
const check = (holds: boolean, message: string) => {
  if (holds) return
  failures++
  console.log(`FAILED: ${message}`)
}

refuseUnknownOptions('check-commands.ts', [])
const scratch = process.env['RECOVERY_SCRATCH']
if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to a folder outside the repo: the check saves tables there, and the commands read the cache of the samples there')
const folder = join(scratch, 'check-commands')
mkdirSync(folder, {recursive: true})
const root = resolve(import.meta.dir, '../../..')
const here = relative(root, import.meta.dir)
// The commands score the samples of the first so many indexes, which they read from the cache of the standard set.
const lastIndex = 6000
const samples = loadSamples(standardRange.seed, 0, lastIndex)

const apostrophe = [{name: 'apostrophe', codePoints: [0x27]}]
const bases: {name: string, base: RecoveryTables, cellNamed: RegExp}[] = [
  {name: 'classes', base: addStates(addClasses(asIsTables(), apostrophe), 2, []), cellNamed: /^tokenizer +\(\w[\w ]*, apostrophe\)/m},
  {name: 'display', base: openDisplayEntries(asIsTables()), cellNamed: /^display +\(\w+, \w+\)/m},
  {name: 'bit', base: addFirstOnLineBit(asIsTables()), cellNamed: /^grammar +\(.*, first on its line\)/m},
  {name: 'all', base: addStates(addFirstOnLineBit(openDisplayEntries(addClasses(asIsTables(), apostrophe))), 2, [grammarStateNames.indexOf('colon')]), cellNamed: /^grammar +\(state 8, /m},
]

const run = (script: string, parameters: string[]) => {
  const result = Bun.spawnSync(['bun', join(here, script), ...parameters], {cwd: root, stdout: 'pipe', stderr: 'pipe'})
  return {exitCode: result.exitCode, output: `${result.stdout.toString()}${result.stderr.toString()}`}
}

const random = createRandom(20261015, 21)
for (const {name, base, cellNamed} of bases) {
  // A random half of the open cells and entries holds a random choice.
  const tables = copyTables(base)
  const randomTables = copyTables(base)
  randomizeOpenCells(randomTables, random)
  for (let cell = 0; cell < tables.lexerNext.length; cell++) if (random.chance(0.5)) { tables.lexerNext[cell] = randomTables.lexerNext[cell]!; tables.lexerEvent[cell] = randomTables.lexerEvent[cell]! }
  for (let cell = 0; cell < tables.grammarNext.length; cell++) if (random.chance(0.5)) { tables.grammarNext[cell] = randomTables.grammarNext[cell]!; tables.grammarAction[cell] = randomTables.grammarAction[cell]! }
  for (let entry = 0; entry < tables.display.length; entry++) if (random.chance(0.5)) tables.display[entry] = randomTables.display[entry]!
  const tablesFile = join(folder, `${name}.json`)
  const baseFile = join(folder, `${name}-base.json`)
  saveTables(tablesFile, tables, `check-commands.ts: ${name}`)
  saveTables(baseFile, base, `check-commands.ts: the base of ${name}`)
  const counts = cellCountsOf(tables, base)
  const mainNumber = (100 * sharesOf(scoreTables(tables, samples, {breakdowns: false}).rows[0]!).allThree)
  check(counts.changedAgainstBase!.total > 0 && counts.differFromToday.total >= counts.changedAgainstBase!.total, `${name}: the two counts of cells are ${counts.changedAgainstBase!.total} and ${counts.differFromToday.total}`)

  const score = run('score.ts', ['--tables', tablesFile, '--base', baseFile, '--to', String(lastIndex), '--cells'])
  const allRow = score.output.split('\n').find(line => line.endsWith('  all'))
  check(score.exitCode === 0, `score.ts on tables with ${name} ends with the exit code ${score.exitCode}: ${score.output.slice(-300)}`)
  check(score.output.includes(`Cells changed against the base ${baseFile}: ${counts.changedAgainstBase!.total} (`), `score.ts on tables with ${name} does not print ${counts.changedAgainstBase!.total} cells changed against the base`)
  check(score.output.includes(`Cells that differ from today's parser: ${counts.differFromToday.total} (`), `score.ts on tables with ${name} does not print ${counts.differFromToday.total} cells that differ from today's parser`)
  check(cellNamed.test(score.output), `score.ts --cells on tables with ${name} names no cell of the structure`)
  check(allRow !== undefined && allRow.trim().split(/\s+/)[2] === mainNumber.toFixed(1), `score.ts on tables with ${name} prints the row ${JSON.stringify(allRow)}, and scoreTables gives ${mainNumber.toFixed(1)}`)

  const compare = run('compare.ts', ['--to', String(lastIndex), `${name}=${tablesFile},${baseFile}`])
  const compareRow = compare.output.split('\n').find(line => line.startsWith(`| ${name} |`))
  check(compare.exitCode === 0, `compare.ts on tables with ${name} ends with the exit code ${compare.exitCode}: ${compare.output.slice(-300)}`)
  check(compareRow !== undefined && compareRow.startsWith(`| ${name} | ${counts.changedAgainstBase!.total} | ${counts.differFromToday.total} | `) && compareRow.includes(` | ${mainNumber.toFixed(2)} | `), `compare.ts on tables with ${name} prints the row ${JSON.stringify(compareRow)}`)
  // Without a base, tables with added structure have no count against a base.
  const withoutBase = run('compare.ts', ['--to', String(lastIndex), `${name}=${tablesFile}`])
  check(withoutBase.exitCode === 0 && withoutBase.output.includes(`| ${name} | no base given | ${counts.differFromToday.total} | `), `compare.ts without a base on tables with ${name} does not say "no base given"`)

  const show = run('handwritten/show.ts', ['--tables', tablesFile, '--split', 'validation', '--wrong', '--cells', '--limit', '3', '--to', String(lastIndex)])
  const shown = show.output.split('\n').filter(line => line.startsWith(`--- ${standardRange.seed}:`)).length
  check(show.exitCode === 0 && shown === 3, `show.ts on tables with ${name} ends with the exit code ${show.exitCode} and shows ${shown} samples: ${show.output.slice(-300)}`)
  check(name === 'classes' || name === 'bit' || /\(\w+, [\w ]+\) -> \w+$/m.test(show.output), `show.ts --cells on tables with ${name} prints no entry of the display table`)
  console.log(`${name}: ${counts.changedAgainstBase!.total} cells changed against the base, ${counts.differFromToday.total} cells differ from today's parser, all three ${mainNumber.toFixed(2)}% on the validation samples of the first ${lastIndex} indexes. score.ts, compare.ts and handwritten/show.ts run on the saved tables and print these numbers.`)
}

// The two counts once structure is added to tables whose cells are changed already.
{
  const handwritten = handwrittenTables().tables
  const withClass = addClasses(handwritten, apostrophe)
  const withBit = addFirstOnLineBit(handwritten)
  const before = cellCountsOf(handwritten, handwritten).differFromToday.total
  const afterClass = cellCountsOf(withClass, handwritten)
  const afterBit = cellCountsOf(withBit, handwritten)
  check(afterClass.changedAgainstBase!.total === 0 && afterBit.changedAgainstBase!.total === 0, 'adding structure to the hand-written tables changes cells against them')
  check(afterClass.differFromToday.total > before && afterBit.differFromToday.total > before, 'adding structure to the hand-written tables adds nothing to the cells that differ from today\'s parser')
  check(differencesOf(asIsTables(), addStates(asIsTables(), 2, [0])).length > 0 && differencesOf(addStates(asIsTables(), 2, [0]), addStates(asIsTables(), 2, [0])).length === 0, 'added states do not count as cells that differ from today\'s parser')
  console.log(`The hand-written tables differ from today's parser in ${before} cells. With a class for the apostrophe added and no cell changed, ${afterClass.differFromToday.total} cells differ from today's parser, and with the bit "first on its line" ${afterBit.differFromToday.total}. Against the hand-written tables as the base, both counts are 0.`)
}

// 4. Tables of another dataset.
{
  const ofThisDataset = join(folder, 'of-this-dataset.json')
  saveTables(ofThisDataset, handwrittenTables().tables, 'check-commands.ts')
  const text = readFileSync(ofThisDataset, 'utf8')
  const keyLine = `  "datasetKey": ${JSON.stringify(datasetKey())},\n`
  check(text.includes(keyLine), 'a saved file of tables does not hold the dataset\'s key')
  const others = [{name: 'another-dataset', text: text.replace(keyLine, '  "datasetKey": "0123456789abcdef",\n'), says: 'was saved with the dataset 0123456789abcdef'}, {name: 'without-a-key', text: text.replace(keyLine, ''), says: 'holds no dataset key'}]
  let noted = 0
  let refused = 0
  for (const other of others) {
    const file = join(folder, `${other.name}.json`)
    writeFileSync(file, other.text)
    // Commands that only report: the file is scored, after a note.
    for (const [script, parameters] of [['compare.ts', ['--to', String(lastIndex), `${other.name}=${file}`]], ['score.ts', ['--to', String(lastIndex), '--tables', file]]] as const) {
      const report = run(script, [...parameters])
      const says = report.exitCode === 0 && report.output.includes(`Note: ${file} ${other.says}`)
      check(says, `${script} on a file of tables that ${other.says} ends with the exit code ${report.exitCode} and ${report.output.includes('Note:') ? 'another note' : 'no note'}`)
      if (says) noted++
    }
    // Commands that start a run from the file: refused. The limits keep the run short in case it is not refused.
    for (const [script, parameters] of [
      ['search/search.ts', ['--from', file, '--out', join(folder, `search-from-${other.name}.json`), '--passes', '1', '--pairs', 'parts', '--runs', '1']],
      ['soft/train.ts', ['--base', file, '--name', `check-commands-${other.name}`, '--train-samples', '8']],
    ] as const) {
      const start = run(script, [...parameters])
      const says = start.exitCode !== 0 && start.output.includes(other.says) && start.output.includes('Make the tables again with this dataset')
      check(says, `${script} from a file of tables that ${other.says} ${start.exitCode === 0 ? 'runs' : 'fails with another error'}: ${start.output.slice(-200)}`)
      if (says) refused++
    }
  }
  const withoutNote = run('compare.ts', ['--to', String(lastIndex), `mine=${ofThisDataset}`])
  check(withoutNote.exitCode === 0 && !withoutNote.output.includes('Note:'), 'compare.ts prints a note for a file of tables of this dataset')
  console.log(`A file of tables with another dataset key, and one without a key: compare.ts and score.ts score them after a note (${noted} of 4 runs), and search.ts --from and soft/train.ts --base refuse them (${refused} of 4 runs). A file of this dataset gets no note.`)
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
