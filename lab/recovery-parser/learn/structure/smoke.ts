// Smoke runs of the three kinds of added structure: one pass of the trainer over the train split per run, with
// every default, and the score of the last snapped tables on the validation split. They show that training can use
// the structure. They are no result: nothing is tuned, each run has one seed, and two log points of one run differ
// by up to a point.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/structure/smoke.ts [plain] [classes] [display] [bit]
// Without a name it does all four runs, about half a minute each:
//   plain    today's tables, for comparison
//   classes  a class for the apostrophe, and two added tokenizer states
//   display  open entries of the display table
//   bit      the bit "the token is the first on its line"
// The tables and the trainer's log of a run go to <scratch>/structure/smoke/<name>.json and .log. The script prints
// the rows of the score that a run's structure is meant for, and what the trained cells of the structure hold, from
// differencesOf.
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {displayKind} from '../../labels.ts'
import {codePointKindScored, kindsOf, loadStandardSamples, refuseUnknownOptions, validationPart} from '../data.ts'
import {createTrace} from '../recovery-parser.ts'
import {
  type RecoveryTables, addClasses, addFirstOnLineBit, addStates, asIsTables, classNames, describeDifferences, differencesOf, grammarCellName, grammarChoiceName, openDisplayEntries, saveTables,
} from '../recovery-tables.ts'
import {cellsReadAt, isRead, rowOf, runOnSample, scoreTables, sharesOf} from '../score.ts'
import {train} from '../soft/train.ts'
import {packForTwin, placesForTwin} from '../soft/twin-data.ts'
import {createModel} from '../soft/twin.ts'

const scratch = process.env['RECOVERY_SCRATCH']
if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to a folder outside the repo: the runs\' logs and tables go there')
const folder = join(scratch, 'structure', 'smoke')
mkdirSync(folder, {recursive: true})

const bases: Record<string, () => RecoveryTables> = {
  plain: () => asIsTables(),
  classes: () => addStates(addClasses(asIsTables(), [{name: 'apostrophe', codePoints: [0x27]}]), 2, []),
  display: () => openDisplayEntries(asIsTables()),
  bit: () => addFirstOnLineBit(asIsTables()),
}
refuseUnknownOptions('structure/smoke.ts', [])
const names = process.argv.slice(2).length === 0 ? Object.keys(bases) : process.argv.slice(2)
for (const name of names) if (bases[name] === undefined) throw new Error(`smoke.ts takes ${Object.keys(bases).join(', ')}, and got ${name}`)

const samples = loadStandardSamples()
const validation = validationPart(samples)
const trainPlaces = placesForTwin(samples, 'train')

// The first letters of the keys without quotes that start with t, f or n, in the validation samples of the kind
// unquotedKey: how many there are, and how many of them `tables` show as a key. Today's tokenizer starts a literal
// at such a letter.
function firstLettersOfKeys(tables: RecoveryTables) {
  const trace = createTrace()
  const tally = {letters: 0, shownAsKey: 0}
  for (let place = 0; place < validation.sampleCount; place++) {
    if (!kindsOf(validation, place).includes('unquotedKey')) continue
    const start = validation.start[place]!
    const length = validation.start[place + 1]! - start
    runOnSample(trace, validation, place, tables)
    const isKey = (position: number) => position >= 0 && (validation.flags[start + position]! & codePointKindScored) !== 0 && validation.labelKind[start + position] === displayKind.key
    for (let position = validation.firstDamage[place]!; position < length; position++) {
      if (!isKey(position) || isKey(position - 1) || !'tfn'.includes(String.fromCodePoint(validation.codePoints[start + position]!))) continue
      tally.letters++
      if (trace.displayKind[position] === displayKind.key) tally.shownAsKey++
    }
  }
  return tally
}

// The numbers of one line of the table: the main number of four rows of the score, and the first letters.
const percent = (share: number) => (100 * share).toFixed(1)
function lineOf(name: string, tables: RecoveryTables, changed: string) {
  const score = scoreTables(tables, validation)
  const row = (group: string) => sharesOf(rowOf(score, group)!)
  const letters = firstLettersOfKeys(tables)
  return `| ${name} | ${changed} | ${percent(row('all').allThree)} | ${percent(row('group: needs a character class').allThree)} | ${percent(row('group: needs a display fix').allThree)} | ${percent(row('group: needs a line rule').allThree)} | ${percent(row('kind: singleQuotedString').allThree)} | ${percent(row('kind: unquotedKey').kind)} | ${letters.shownAsKey} of ${letters.letters} | ${percent(row('kind: colonWithoutValue').allThree)} |`
}
const lines = [
  '| tables | cells changed against the run\'s base | all three, all samples | all three, group "needs a character class" | all three, group "needs a display fix" | all three, group "needs a line rule" | all three, singleQuotedString | display kind, unquotedKey | first letters t, f, n of keys without quotes shown as a key | all three, colonWithoutValue |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  lineOf('the parser as it is', asIsTables(), '0'),
]

for (const name of names) {
  const base = bases[name]!()
  const data = packForTwin(samples, trainPlaces, undefined, base)
  const model = createModel(base)
  const logFile = join(folder, `${name}.log`)
  writeFileSync(logFile, '')
  const started = performance.now()
  const result = await train(model, data, {
    epochs: 1, validation, trainedOn: {samples, places: trainPlaces}, logEverySamples: 8000, log: line => appendFileSync(logFile, `${line}\n`),
  })
  const tables = result.last
  saveTables(join(folder, `${name}.json`), tables, `smoke run ${name} of structure/smoke.ts: one pass over the train split, the last snapped tables`)
  const differences = differencesOf(base, tables)
  const read = cellsReadAt(tables, samples, trainPlaces)
  const lastPoints = result.points.slice(-3).map(point => percent(point.allThree))
  console.log(`Run ${name}: ${data.sampleCount} train samples in ${((performance.now() - started) / 1000).toFixed(0)} s, ${result.samplesPerSecond.toFixed(0)} samples per second of training. ${differences.length} cells changed against the run's base (${differencesOf(asIsTables(), tables).length} cells differ from today's parser), and a code point of a trained text reads ${differences.filter(difference => isRead(read, difference)).length} of them. All three on the validation split at the last 3 log points: ${lastPoints.join(', ')}.`)
  lines.push(lineOf(`one pass, ${name}`, tables, String(differences.length)))

  // What the cells of the structure hold after training. Only cells that a code point of a trained text reads are
  // listed: training moves the others through small shares of the twin, and the exact parser never reads them there.
  if (name === 'classes') {
    const apostrophe = classNames.length
    const ofStructure = differences.filter(difference => difference.table === 'tokenizer' && isRead(read, difference)
      && (difference.cell % tables.classCount === apostrophe || Math.floor(difference.cell / tables.classCount) >= asIsTables().lexerStateCount || /^state 2[67],/.test(difference.after)))
    console.log(`  The changed tokenizer cells that a trained text reads and that are of the class apostrophe, of an added state (state 26, state 27), or lead into one, ${ofStructure.length}:`)
    console.log(describeDifferences(ofStructure).split('\n').map(line => `    ${line}`).join('\n'))
  }
  if (name === 'display') {
    const ofStructure = differences.filter(difference => difference.table === 'display')
    console.log(`  The changed entries of the display table, ${ofStructure.length}, ${ofStructure.filter(difference => isRead(read, difference)).length} of them read by a trained text (marked):`)
    console.log(describeDifferences(ofStructure).split('\n').map((line, index) => `    ${line}${isRead(read, ofStructure[index]!) ? '   (read)' : ''}`).join('\n'))
  }
  if (name === 'bit') {
    // The cells with the bit that hold another choice than the cell without the bit, where a trained text reads both.
    const contexts = asIsTables().contextCount
    const other: string[] = []
    for (let cell = 0; cell < tables.grammarNext.length; cell++) {
      if (cell % tables.contextCount < contexts || read.grammar[cell] === 0 || read.grammar[cell - contexts] === 0) continue
      const withBit = grammarChoiceName(tables, cell)
      const without = grammarChoiceName(tables, cell - contexts)
      if (withBit !== without) other.push(`    ${grammarCellName(tables, cell - contexts).padEnd(52)}  without the bit: ${without.padEnd(26)}  with the bit: ${withBit}`)
    }
    console.log(`  The grammar cells that hold another choice with the bit than without, where a trained text reads both, ${other.length}:`)
    console.log(other.join('\n'))
  }
}

console.log('')
console.log('The last snapped tables on the validation split, in percent. One seed and no tuning: no result.')
console.log(lines.join('\n'))
