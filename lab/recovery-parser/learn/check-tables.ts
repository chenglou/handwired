// Checks which cells are open, since the experiment's ground rules rest on it.
//
// Run from the repo root: bun lab/recovery-parser/learn/check-tables.ts [number of dataset samples, default 30000]
//
// 1. Counts the frozen and the open cells of each table.
// 2. For every frozen cell, runs a text that makes today's parser read the cell before any error. So no cell is
//    frozen without need.
// 3. Runs today's parser on valid texts and on broken ones, and looks at every cell it reads before a first error:
//    none may be open. The texts are the dataset's originals, its valid samples, its broken texts, and texts made
//    in check-texts.ts, among them valid ones with 16 levels and with 512 code points. Then the same for every text
//    of up to 6 code points.
// 4. Writes tables as JSON and reads them again, lists the cells in which two tables differ, and shows that a change
//    of a frozen cell is refused, and so is a file with a number that a byte does not hold, e.g. the state 259. With
//    the environment variable RECOVERY_SCRATCH it also saves the tables to a file in that folder and loads the file.
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {createRandom} from '../random.ts'
import {defaultSeed, sampleAt} from '../samples.ts'
import {classNames, positionCount, runTableParser} from '../table-parser.ts'
import {checkTexts} from './check-texts.ts'
import {createTrace, runRecoveryParserInto} from './recovery-parser.ts'
import {
  actionNone, asIsTables, cellCounts, configurationsReachedByGuessAlone, copyTables, describeDifferences, differencesOf, frozenGrammarCellWitness, frozenLexerCellWitness, grammarCellName, lexerCellName,
  loadTables, problemsOf, saveTables, tablesFromJson, tablesToJson, today,
} from './recovery-tables.ts'

const sampleCount = Number(process.argv[2] ?? 30_000)
const tables = asIsTables()
let failures = 0
const fail = (message: string) => {
  failures++
  if (failures <= 20) console.log(`FAILED: ${message}`)
}

// 1. The counts.
const counts = cellCounts(tables)
const symbolCount = tables.tokenCount * tables.contextCount
let openIntoError = 0
let openErrorRow = 0
for (let cell = 0; cell < tables.grammarNext.length; cell++) {
  if (tables.grammarOpen[cell] === 0) continue
  if (Math.floor(cell / symbolCount) === tables.errorState) openErrorRow++
  else if (today.grammarNext[cell] === tables.errorState) openIntoError++
}
console.log(`1. Tokenizer table: ${counts.lexerCells} cells, ${counts.lexerFrozen} frozen and ${counts.lexerOpen} open.`)
console.log(`   Grammar table: ${counts.grammarCells} cells, ${counts.grammarFrozen} frozen and ${counts.grammarOpen} open.`)
console.log(`   Of the open grammar cells, ${openIntoError} lead into the error state from another state today, ${openErrorRow} are the error state's own row, and ${counts.grammarOpen - openIntoError - openErrorRow} lead elsewhere but need a state and a context that no text has before an error, e.g. ${grammarCellName(tables, tables.contextCount + 1)}.`)

// 2. A text for every frozen cell. One code point per class. The class `end` stands for the end of the text.
const codePointOfClass: Record<typeof classNames[number], string> = {
  end: '', truncatedEnd: '', space: ' ', tabOrCarriageReturn: '\t', lineFeed: '\n', control: '\u0001', quote: '"', backslash: '\\', slash: '/', openBrace: '{', closeBrace: '}',
  openBracket: '[', closeBracket: ']', colon: ':', comma: ',', minus: '-', plus: '+', dot: '.', zero: '0', digit: '7', a: 'a', b: 'b', e: 'e', capitalE: 'E', f: 'f', l: 'l', n: 'n',
  r: 'r', s: 's', t: 't', u: 'u', otherHexLetter: 'c', other: 'x',
}
let witnessed = 0
let longestWitness = 0
const checkWitness = (classes: number[], cellAt: (trace: ReturnType<typeof runTableParser>, position: number) => number, cell: number, name: string) => {
  const text = classes.map(characterClass => codePointOfClass[classNames[characterClass]!]).join('')
  const position = classes.length - 1
  const trace = runTableParser(text)
  longestWitness = Math.max(longestWitness, classes.length)
  if (cellAt(trace, position) !== cell) fail(`the text ${JSON.stringify(text)} does not read the frozen cell ${name} at position ${position}`)
  else if (trace.firstErrorPosition !== -1 && trace.firstErrorPosition <= position) fail(`the text ${JSON.stringify(text)} reads the frozen cell ${name} at position ${position}, at or after its first error at ${trace.firstErrorPosition}`)
  else witnessed++
}
const lexerCellAt = (trace: ReturnType<typeof runTableParser>, position: number) => trace.lexerStateBefore[position]! * tables.classCount + trace.characterClass[position]!
const grammarCellAt = (trace: ReturnType<typeof runTableParser>, position: number) => trace.grammarBefore[position]! * symbolCount + trace.token[position]! * tables.contextCount + trace.context[position]!
for (let cell = 0; cell < tables.lexerNext.length; cell++) {
  const classes = frozenLexerCellWitness(cell)
  if (classes !== undefined) checkWitness(classes, lexerCellAt, cell, lexerCellName(tables, cell))
}
for (let cell = 0; cell < tables.grammarNext.length; cell++) {
  const classes = frozenGrammarCellWitness(cell)
  if (classes !== undefined) checkWitness(classes, grammarCellAt, cell, grammarCellName(tables, cell))
}
if (configurationsReachedByGuessAlone !== 0) fail(`the search reached ${configurationsReachedByGuessAlone} configurations only by guessing the kind of a container`)
console.log(`2. ${witnessed} of the ${counts.lexerFrozen + counts.grammarFrozen} frozen cells are read before any error by a text of this check, the longest of ${longestWitness} code points. The search reached ${configurationsReachedByGuessAlone} configurations only by guessing the kind of a container.`)

// 3. No text reads an open cell before its first error.
const lexerReadByValid = new Uint8Array(tables.lexerNext.length)
const grammarReadByValid = new Uint8Array(tables.grammarNext.length)
const tally = {texts: 0, valid: 0, broken: 0, positions: 0, openReads: 0}
const madeTally = new Map<string, number>()
function checkText(text: string, expectValid: boolean | undefined, made: string) {
  const trace = runTableParser(text)
  if (expectValid !== undefined && trace.valid !== expectValid) fail(`a text made as ${made} is ${trace.valid ? 'valid' : 'broken'} for today's parser: ${JSON.stringify(text.slice(0, 80))}`)
  tally.texts++
  madeTally.set(made, (madeTally.get(made) ?? 0) + 1)
  if (trace.valid) tally.valid++
  else tally.broken++
  // A valid text is checked at all 513 positions, a broken one up to its first error.
  const positions = trace.valid ? positionCount : trace.firstErrorPosition
  for (let position = 0; position < positions; position++) {
    const lexerCell = lexerCellAt(trace, position)
    const grammarCell = grammarCellAt(trace, position)
    tally.positions++
    if (tables.lexerOpen[lexerCell] === 1 || tables.grammarOpen[grammarCell] === 1) {
      tally.openReads++
      fail(`position ${position} of ${JSON.stringify(text.slice(0, 80))} reads the open cell ${tables.lexerOpen[lexerCell] === 1 ? lexerCellName(tables, lexerCell) : grammarCellName(tables, grammarCell)} before the first error`)
    }
    if (trace.valid) {
      lexerReadByValid[lexerCell] = 1
      grammarReadByValid[grammarCell] = 1
    }
  }
}
for (let index = 0; index < sampleCount; index++) {
  const sample = sampleAt(defaultSeed, index)
  for (const document of sample.documents) checkText(document, true, sample.source === 'valid' ? 'the dataset\'s valid samples' : 'the dataset\'s originals')
  if (sample.source !== 'valid') checkText(sample.broken, false, 'the dataset\'s broken texts')
}
for (const {text, made} of checkTexts(createRandom(20261015, 1), 20_000)) {
  const expectValid = made.startsWith('valid') ? true : made === 'too long' || made === 'too deep' ? false : undefined
  if (expectValid === true) JSON.parse(text)
  checkText(text, expectValid, `made here: ${made}`)
}
const ones = (mask: Uint8Array) => mask.reduce((total, bit) => total + bit, 0)
console.log(`3. ${tally.texts} texts, ${tally.valid} valid and ${tally.broken} broken, ${tally.positions} positions before a first error: ${tally.openReads} read an open cell.`)
console.log(`   ${[...madeTally].map(([made, texts]) => `${made} ${texts}`).join(', ')}.`)
const missedByValid = [
  ...Array.from(tables.lexerOpen, (open, cell) => open === 0 && lexerReadByValid[cell] === 0 ? lexerCellName(tables, cell) : ''),
  ...Array.from(tables.grammarOpen, (open, cell) => open === 0 && grammarReadByValid[cell] === 0 ? grammarCellName(tables, cell) : ''),
].filter(name => name !== '')
console.log(`   The valid texts alone read ${ones(lexerReadByValid)} of the ${counts.lexerFrozen} frozen tokenizer cells and ${ones(grammarReadByValid)} of the ${counts.grammarFrozen} frozen grammar cells.${missedByValid.length === 0 ? '' : ` Not read: ${missedByValid.join(' ')}`}`)

// Every short text. The parser only sees a code point's class, so one code point per class stands for every text.
// A text is only made longer while it has no error, and each step that is no first error has to read frozen cells.
// This part runs the recovery parser with today's tables, which check-parser.ts compares with today's parser.
{
  const maximumLength = 6
  const codePoints = classNames.filter(name => name !== 'end' && name !== 'truncatedEnd').map(name => codePointOfClass[name].codePointAt(0)!)
  const trace = createTrace()
  const text = new Int32Array(maximumLength)
  let texts = 0
  let openReads = 0
  const checkLastStep = (position: number) => {
    if (trace.firstErrorPosition !== -1) return false
    if (tables.lexerOpen[trace.lexerCell[position]!] === 1 || tables.grammarOpen[trace.grammarCell[position]!] === 1) {
      openReads++
      fail(`the text ${JSON.stringify(String.fromCodePoint(...text.subarray(0, position)))} reads an open cell at position ${position}, before any error`)
    }
    return true
  }
  const extend = (length: number) => {
    // The text up to `length` has no error. Its end position is a step too.
    texts++
    runRecoveryParserInto(trace, text, 0, length, false, tables, length + 1)
    checkLastStep(length)
    if (length === maximumLength) return
    for (const codePoint of codePoints) {
      text[length] = codePoint
      runRecoveryParserInto(trace, text, 0, length + 1, false, tables, length + 1)
      if (checkLastStep(length)) extend(length + 1)
    }
  }
  extend(0)
  console.log(`   Every text of up to ${maximumLength} code points, as far as its classes go: ${texts} texts without an error before their end, and ${openReads} of their steps read an open cell.`)
}

// 4. Saving, loading, the differences of two tables, and a frozen cell.
const changed = copyTables(tables)
const openLexerCell = tables.lexerOpen.indexOf(1)
const openGrammarCell = tables.grammarOpen.indexOf(1)
changed.lexerNext[openLexerCell] = 1
changed.lexerEvent[openLexerCell] = 2
changed.grammarNext[openGrammarCell] = 5
changed.grammarAction[openGrammarCell] = actionNone
let loaded = tablesFromJson(tablesToJson(changed, 'two changed cells'))
const scratchFolder = process.env['RECOVERY_SCRATCH']
if (scratchFolder !== undefined && scratchFolder !== '') {
  mkdirSync(scratchFolder, {recursive: true})
  saveTables(join(scratchFolder, 'check-tables.json'), changed, 'two changed cells')
  loaded = loadTables(join(scratchFolder, 'check-tables.json'))
}
const afterLoading = differencesOf(changed, loaded.tables)
const differences = differencesOf(tables, loaded.tables)
if (afterLoading.length !== 0 || loaded.note !== 'two changed cells' || differences.length !== 2) fail('tables that were saved and loaded are not the tables that were saved')
console.log(`4. Tables with two changed open cells, written${scratchFolder === undefined || scratchFolder === '' ? ' as JSON' : ' to a file'} and read again, differ from today's in ${differences.length} cells:`)
console.log(describeDifferences(differences).split('\n').map(line => `   ${line}`).join('\n'))
const broken = copyTables(tables)
const frozenGrammarCell = tables.grammarOpen.indexOf(0)
broken.grammarNext[frozenGrammarCell] = tables.errorState
const problems = problemsOf(broken)
if (problems.length !== 1) fail('a changed frozen cell is not reported as one problem')
console.log(`   A change of the frozen cell ${grammarCellName(tables, frozenGrammarCell)} is refused: ${problems.join('; ')}.`)
// A number that a byte array would cut to its low 8 bits, e.g. 259 to 3, and a number that is no whole number.
for (const value of [259, -1, 1.5]) {
  const file = JSON.parse(tablesToJson(changed)) as {lexerNext: number[]}
  file.lexerNext[openLexerCell] = value
  let refused = ''
  try {
    tablesFromJson(JSON.stringify(file))
  } catch (error) {
    refused = String(error)
  }
  if (refused === '') fail(`a file with the state ${value} in an open cell is loaded`)
  else if (value === 259) console.log(`   A file with the state 259 in an open cell is refused: ${refused.replace(/^Error: /, '')}.`)
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
