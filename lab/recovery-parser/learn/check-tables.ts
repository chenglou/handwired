// Checks which cells are open, since the experiment's ground rules rest on it.
//
// Run from the repo root: bun lab/recovery-parser/learn/check-tables.ts [number of dataset samples, default 30000]
//
// Every part runs for today's tables, and for today's tables with structure added to them, see structure/README.md:
// with added classes, with open entries of the display table, with the bit "first on its line", and with all three
// and added states.
//
// 1. Counts the frozen and the open cells of each table.
// 2. For every frozen cell, runs a text that makes today's parser read the cell before any error. So no cell is
//    frozen without need. With open entries of the display table, the same for every entry that is not open.
// 3. Runs today's parser on valid texts and on broken ones, and looks at every cell it reads before a first error:
//    none may be open, and neither may an entry of the display table. The texts are the dataset's originals, its
//    valid samples, its broken texts, and texts made in check-texts.ts, among them valid ones with 16 levels and with
//    512 code points. Then the same for every text of up to 6 code points.
// 4. Writes tables as JSON and reads them again, lists the cells in which two tables differ, and shows that a change
//    of a frozen cell is refused, and so is a file with a number that a byte does not hold, e.g. the state 259. With
//    the environment variable RECOVERY_SCRATCH it also saves the tables to a file in that folder and loads the file.
//    Then every cell, every entry of the display table and every bit of a mask is changed, one at a time: a change
//    of a frozen cell, of an entry that is not open or of a mask is refused, and a change of an open one is not.
//    And differencesOf lists no entry of the display table for an added grammar state unless the entry is open.
//
// Parts 2 and 3 run today's parser, table-parser.ts, which knows nothing of added structure. The check works out
// itself which cell of the tables a step of today's parser reads: the cell of an added class from the code point,
// and the bit "first on its line" from the text's line feeds and the trace's tokens.
//
// 5. The functions that add structure give the same tables in every order.
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {createRandom} from '../random.ts'
import {defaultSeed} from '../samples.ts'
import {type ParserTrace, classNames, contextNames, positionCount, runTableParser, tokenNames} from '../table-parser.ts'
import {checkTexts, classesOfTheChecks, textWithAddedClasses} from './check-texts.ts'
import {allowedSampleAt, refuseUnknownOptions} from './data.ts'
import {codePointsOf, createTrace, runRecoveryParserInto} from './recovery-parser.ts'
import {
  type AddedClass, type RecoveryTables, actionCount, actionNone, addClasses, addFirstOnLineBit, addStates, asIsTables, cellCounts, className, copyTables, describeDifferences, differencesOf, displayEntryName, displayEntryOf, displayKindNames,
  eventNames, frozenSearchOf, grammarCellName, grammarStateNames, lexerCellName, loadTables, openDisplayEntries, problemsOf, randomizeOpenCells, saveTables, tablesFromJson, tablesToJson, today,
} from './recovery-tables.ts'

refuseUnknownOptions('check-tables.ts', [])
const sampleCount = Number(process.argv[2] ?? 30_000)
let failures = 0
const fail = (message: string) => {
  failures++
  if (failures <= 20) console.log(`FAILED: ${message}`)
}

const variants: {name: string, tables: RecoveryTables}[] = [
  {name: 'today\'s tables', tables: asIsTables()},
  {name: `${classesOfTheChecks.length} added classes (${classesOfTheChecks.map(added => added.name).join(', ')})`, tables: addClasses(asIsTables(), classesOfTheChecks)},
  {name: 'open entries of the display table', tables: openDisplayEntries(asIsTables())},
  {name: 'the bit "first on its line"', tables: addFirstOnLineBit(asIsTables())},
  {name: 'all three, 2 added tokenizer states and an added grammar state', tables: addStates(addFirstOnLineBit(openDisplayEntries(addClasses(asIsTables(), classesOfTheChecks))), 2, [grammarStateNames.indexOf('colon')])},
]
const ones = (mask: Uint8Array) => mask.reduce((total, bit) => total + bit, 0)

// One code point per class. The class `end` stands for the end of the text. The code points are ones that no class
// of the checks takes out of its class of today's, e.g. the 5 for `digit`, since the checks add a class with the 7.
const codePointOfTodaysClass: Record<typeof classNames[number], string> = {
  end: '', truncatedEnd: '', space: ' ', tabOrCarriageReturn: '\t', lineFeed: '\n', control: '\u0001', quote: '"', backslash: '\\', slash: '/', openBrace: '{', closeBrace: '}',
  openBracket: '[', closeBracket: ']', colon: ':', comma: ',', minus: '-', plus: '+', dot: '.', zero: '0', digit: '5', a: 'a', b: 'b', e: 'e', capitalE: 'E', f: 'f', l: 'l', n: 'n',
  r: 'r', s: 's', t: 't', u: 'u', otherHexLetter: 'c', other: 'x',
}
const classOfCodePoint = (tables: RecoveryTables, codePoint: number) => tables.classOfCodePoint[Math.min(codePoint + 1, tables.classOfCodePoint.length - 1)]!
// A code point that `tables` give the class. For an added class it is the first of the class's listed code points
// that still has the class: a later added class may have taken some, as the class `seven` takes the 7 out of the
// class of the digits 7 to 9.
function codePointOfClass(tables: RecoveryTables, characterClass: number): string {
  if (characterClass < classNames.length && codePointOfTodaysClass[classNames[characterClass]!] === '') return ''
  const listed = characterClass < classNames.length ? [codePointOfTodaysClass[classNames[characterClass]!].codePointAt(0)!] : tables.addedClasses[characterClass - classNames.length]!.codePoints
  const codePoint = listed.find(candidate => classOfCodePoint(tables, candidate) === characterClass)
  if (codePoint === undefined) throw new Error(`check-tables.ts has no code point of the class ${className(tables, characterClass)} for these tables`)
  return String.fromCodePoint(codePoint)
}

// The cells of `tables` that a step of today's parser reads. The class is the one that `tables` give the code point,
// and it has to be a class whose code points have the trace's class today.
function lexerCellAt(tables: RecoveryTables, codePoints: readonly number[], trace: ParserTrace, position: number) {
  const characterClass = position < codePoints.length ? classOfCodePoint(tables, codePoints[position]!) : trace.characterClass[position]!
  if (tables.classToday[characterClass] !== trace.characterClass[position]) fail(`the tables give the code point ${codePoints[position]} the class ${className(tables, characterClass)}, and today's parser reads the class ${classNames[trace.characterClass[position]!]}`)
  return trace.lexerStateBefore[position]! * tables.classCount + characterClass
}
// The bit "first on its line" before every position of a text, counted here: a line feed sets it, and any other
// code point whose token is not `none` clears it.
const tokenNone = tokenNames.indexOf('none')
function firstOnLineBefore(codePoints: readonly number[], trace: ParserTrace) {
  const bits = new Uint8Array(positionCount)
  let bit = 0
  for (let position = 0; position < positionCount; position++) {
    bits[position] = bit
    if (position < codePoints.length && codePoints[position] === 0x0a) bit = 1
    else if (trace.token[position] !== tokenNone) bit = 0
  }
  return bits
}
// With the bit, the context of a token that is the first on its line is 8 more.
const grammarCellAt = (tables: RecoveryTables, trace: ParserTrace, firstOnLine: Uint8Array, position: number) =>
  (trace.grammarBefore[position]! * tables.tokenCount + trace.token[position]!) * tables.contextCount + trace.context[position]! + (tables.contextCount > contextNames.length ? firstOnLine[position]! * contextNames.length : 0)
const displayEntryAt = (tables: RecoveryTables, trace: ParserTrace, position: number) => displayEntryOf(tables, trace.event[position]!, trace.grammarAfter[position]!)
// The search numbers the display table's entries with today's 8 grammar states. The same entry in `tables`, which
// can have more states.
const entryOfSearch = (tables: RecoveryTables, entry: number) => displayEntryOf(tables, Math.floor(entry / grammarStateNames.length), entry % grammarStateNames.length)
const pastEnd = displayKindNames.indexOf('pastEnd')

for (const {name, tables} of variants) {
  if (problemsOf(tables).length > 0) fail(`${name}: ${problemsOf(tables).join('; ')}`)
  console.log(`${name[0]!.toUpperCase()}${name.slice(1)}:`)

  // 1. The counts.
  const counts = cellCounts(tables)
  const symbolCount = tables.tokenCount * tables.contextCount
  let openIntoError = 0
  let openErrorRow = 0
  for (let cell = 0; cell < tables.grammarNext.length; cell++) {
    if (tables.grammarOpen[cell] === 0) continue
    if (Math.floor(cell / symbolCount) === tables.errorState) openErrorRow++
    else if (tables.grammarNext[cell] === tables.errorState) openIntoError++
  }
  console.log(`1. Tokenizer table: ${counts.lexerCells} cells, ${counts.lexerFrozen} frozen and ${counts.lexerOpen} open.`)
  console.log(`   Grammar table: ${counts.grammarCells} cells, ${counts.grammarFrozen} frozen and ${counts.grammarOpen} open.`)
  console.log(`   Of the open grammar cells, ${openIntoError} lead into the error state from another state today, ${openErrorRow} are the error state's own row, and ${counts.grammarOpen - openIntoError - openErrorRow} lead elsewhere but need a state and a context that no text has before an error, e.g. ${grammarCellName(tables, tables.contextCount + 1)}.`)
  for (let added = 0; added < tables.addedClasses.length; added++) {
    const characterClass = classNames.length + added
    const frozen = Array.from({length: tables.lexerStateCount}, (_, state) => state * tables.classCount + characterClass).filter(cell => tables.lexerOpen[cell] === 0)
    console.log(`   The class ${className(tables, characterClass)}, whose code points have the class ${classNames[tables.classToday[characterClass]!]} today: ${frozen.length} of its ${tables.lexerStateCount} cells are frozen, ${frozen.map(cell => lexerCellName(tables, cell)).join(' ')}.`)
  }
  if (tables.contextCount > contextNames.length) {
    // The cells with the bit, and whether they are frozen where the cell without the bit is.
    const withBit = Array.from({length: tables.grammarNext.length}, (_, cell) => cell).filter(cell => cell % tables.contextCount >= contextNames.length && Math.floor(cell / symbolCount) < grammarStateNames.length)
    const frozenWithBit = withBit.filter(cell => tables.grammarOpen[cell] === 0)
    const otherThanWithout = withBit.filter(cell => tables.grammarOpen[cell] !== tables.grammarOpen[cell - contextNames.length])
    console.log(`   Of the ${withBit.length} cells of today's states with the bit "first on its line", ${frozenWithBit.length} are frozen, e.g. ${grammarCellName(tables, frozenWithBit.find(cell => grammarCellName(tables, cell).startsWith('(value, string'))!)}. ${otherThanWithout.length === 0 ? 'A cell with the bit is frozen exactly when the cell without the bit is' : `${otherThanWithout.length} are open where the cell without the bit is frozen, or frozen where it is open, e.g. ${grammarCellName(tables, otherThanWithout[0]!)}`}.`)
  }
  const search = frozenSearchOf(tables)
  if (counts.displayOpen > 0) {
    // An entry that is not open is one that the search found, or one of the three events of a text's end.
    const found = new Uint8Array(tables.display.length)
    search.displayFrozen.forEach((frozen, entry) => { found[entryOfSearch(tables, entry)] = frozen })
    const endEntries = Array.from(tables.display, (kind, entry) => kind === pastEnd && found[entry] === 0 ? 1 : 0).reduce((total: number, bit) => total + bit, 0)
    const open = Array.from(tables.displayOpen, (isOpen, entry) => isOpen === 1 ? displayEntryName(tables, entry) : '').filter(entryName => entryName !== '')
    console.log(`   Display table: ${counts.displayEntries} entries, ${counts.displayOpen} open. Of the other ${counts.displayEntries - counts.displayOpen}, a text reads ${ones(search.displayFrozen)} before any error, and ${endEntries} are entries of the three events of a text's end that no text reads before an error.`)
    console.log(`   Open, by event: ${eventNames.map(event => ({event, states: open.filter(entryName => entryName.startsWith(`(${event},`)).length})).filter(({states}) => states > 0).map(({event, states}) => `${event} ${states}`).join(', ')}.`)
    if (counts.displayOpen + ones(search.displayFrozen) + endEntries !== counts.displayEntries) fail(`${name}: an entry of the display table is neither open, nor read before an error, nor one of a text's end`)
  }

  // 2. A text for every frozen cell, from the search that found the cell frozen.
  let witnessed = 0
  let longestWitness = 0
  const checkWitness = (classes: number[], cellAt: (codePoints: readonly number[], trace: ParserTrace, firstOnLine: Uint8Array, position: number) => number, cell: number, cellName: string) => {
    const text = classes.map(characterClass => codePointOfClass(tables, characterClass)).join('')
    const position = classes.length - 1
    const trace = runTableParser(text)
    const {codePoints} = codePointsOf(text)
    longestWitness = Math.max(longestWitness, classes.length)
    if (cellAt(codePoints, trace, firstOnLineBefore(codePoints, trace), position) !== cell) fail(`the text ${JSON.stringify(text)} does not read the frozen cell ${cellName} at position ${position}`)
    else if (trace.firstErrorPosition !== -1 && trace.firstErrorPosition <= position) fail(`the text ${JSON.stringify(text)} reads the frozen cell ${cellName} at position ${position}, at or after its first error at ${trace.firstErrorPosition}`)
    else witnessed++
  }
  for (let cell = 0; cell < search.lexerFrozen.length; cell++) {
    const classes = search.lexerWitness(cell)
    if (classes !== undefined) checkWitness(classes, (codePoints, trace, _, position) => lexerCellAt(tables, codePoints, trace, position), cell, lexerCellName(tables, cell))
  }
  for (let cell = 0; cell < search.grammarFrozen.length; cell++) {
    const classes = search.grammarWitness(cell)
    if (classes !== undefined) checkWitness(classes, (_, trace, firstOnLine, position) => grammarCellAt(tables, trace, firstOnLine, position), cell, grammarCellName(tables, cell))
  }
  if (search.reachedByGuessAlone !== 0) fail(`the search reached ${search.reachedByGuessAlone} configurations only by guessing the kind of a container`)
  console.log(`2. ${witnessed} of the ${counts.lexerFrozen + counts.grammarFrozen} frozen cells are read before any error by a text of this check, the longest of ${longestWitness} code points. The search reached ${search.reachedByGuessAlone} configurations only by guessing the kind of a container.`)
  if (counts.displayOpen > 0) {
    witnessed = 0
    for (let entry = 0; entry < search.displayFrozen.length; entry++) {
      const classes = search.displayWitness(entry)
      if (classes !== undefined) checkWitness(classes, (_, trace, __, position) => displayEntryAt(tables, trace, position), entryOfSearch(tables, entry), `${displayEntryName(tables, entryOfSearch(tables, entry))} of the display table`)
    }
    console.log(`   ${witnessed} of the ${ones(search.displayFrozen)} entries of the display table that the search found are read before any error by a text of this check.`)
  }
}

// 3. No text reads an open cell before its first error.
const read = variants.map(({tables}) => ({lexerByValid: new Uint8Array(tables.lexerNext.length), grammarByValid: new Uint8Array(tables.grammarNext.length), displayByValid: new Uint8Array(tables.display.length), open: 0}))
const tally = {texts: 0, valid: 0, broken: 0, positions: 0}
const madeTally = new Map<string, number>()
function checkText(text: string, expectValid: boolean | undefined, made: string) {
  const trace = runTableParser(text)
  const {codePoints} = codePointsOf(text)
  if (expectValid !== undefined && trace.valid !== expectValid) fail(`a text made as ${made} is ${trace.valid ? 'valid' : 'broken'} for today's parser: ${JSON.stringify(text.slice(0, 80))}`)
  tally.texts++
  madeTally.set(made, (madeTally.get(made) ?? 0) + 1)
  if (trace.valid) tally.valid++
  else tally.broken++
  // A valid text is checked at all 513 positions, a broken one up to its first error.
  const positions = trace.valid ? positionCount : trace.firstErrorPosition
  tally.positions += positions
  const firstOnLine = firstOnLineBefore(codePoints, trace)
  variants.forEach(({name, tables}, variant) => {
    for (let position = 0; position < positions; position++) {
      const lexerCell = lexerCellAt(tables, codePoints, trace, position)
      const grammarCell = grammarCellAt(tables, trace, firstOnLine, position)
      const displayEntry = displayEntryAt(tables, trace, position)
      if (tables.lexerOpen[lexerCell] === 1 || tables.grammarOpen[grammarCell] === 1 || tables.displayOpen[displayEntry] === 1) {
        read[variant]!.open++
        fail(`${name}: position ${position} of ${JSON.stringify(text.slice(0, 80))} reads the open cell ${tables.lexerOpen[lexerCell] === 1 ? lexerCellName(tables, lexerCell) : tables.grammarOpen[grammarCell] === 1 ? grammarCellName(tables, grammarCell) : `${displayEntryName(tables, displayEntry)} of the display table`} before the first error`)
      }
      if (trace.valid) {
        read[variant]!.lexerByValid[lexerCell] = 1
        read[variant]!.grammarByValid[grammarCell] = 1
        read[variant]!.displayByValid[displayEntry] = 1
      }
    }
  })
}
for (let index = 0; index < sampleCount; index++) {
  // The texts of the train and validation splits: allowedSampleAt gives no sample of the test split.
  const sample = allowedSampleAt(defaultSeed, index)
  if (sample === undefined) continue
  for (const document of sample.documents) checkText(document, true, sample.source === 'valid' ? 'the dataset\'s valid samples' : 'the dataset\'s originals')
  if (sample.source !== 'valid') checkText(sample.broken, false, 'the dataset\'s broken texts')
}
for (const {text, made} of checkTexts(createRandom(20261015, 1), 20_000)) {
  const expectValid = made.startsWith('valid') ? true : made === 'too long' || made === 'too deep' ? false : undefined
  if (expectValid === true) JSON.parse(text)
  checkText(text, expectValid, `made here: ${made}`)
}
console.log(`3. ${tally.texts} texts, ${tally.valid} valid and ${tally.broken} broken, ${tally.positions} positions before a first error.`)
console.log(`   ${[...madeTally].map(([made, texts]) => `${made} ${texts}`).join(', ')}.`)
{
  // Texts with the code points of the added classes, which the texts above hold only here and there.
  const before = {...tally}
  const random = createRandom(20261015, 4)
  for (let index = 0; index < 4000; index++) checkText(textWithAddedClasses(random), undefined, 'made here: with code points of the added classes')
  console.log(`   And ${tally.texts - before.texts} texts with code points of the added classes, inside strings and between tokens: ${tally.valid - before.valid} valid and ${tally.broken - before.broken} broken, ${tally.positions - before.positions} positions before a first error.`)
}
variants.forEach(({name, tables}, variant) => {
  const counts = cellCounts(tables)
  const {lexerByValid, grammarByValid, displayByValid, open} = read[variant]!
  const missedByValid = [
    ...Array.from(tables.lexerOpen, (isOpen, cell) => isOpen === 0 && lexerByValid[cell] === 0 ? lexerCellName(tables, cell) : ''),
    ...Array.from(tables.grammarOpen, (isOpen, cell) => isOpen === 0 && grammarByValid[cell] === 0 ? grammarCellName(tables, cell) : ''),
  ].filter(cellName => cellName !== '')
  console.log(`   ${name}: ${open} of the positions read an open cell${counts.displayOpen > 0 ? ' or an open entry of the display table' : ''}. The valid texts alone read ${ones(lexerByValid)} of the ${counts.lexerFrozen} frozen tokenizer cells and ${ones(grammarByValid)} of the ${counts.grammarFrozen} frozen grammar cells${counts.displayOpen > 0 ? `, and ${ones(displayByValid)} of the ${ones(frozenSearchOf(tables).displayFrozen)} entries of the display table that the search found` : ''}.${missedByValid.length === 0 ? '' : ` Not read: ${missedByValid.join(' ')}`}`)
})

// Every short text. The parser only sees a code point's class, so one code point per class stands for every text.
// A text is only made longer while it has no error, and each step that is no first error has to read frozen cells.
// This part runs the recovery parser with today's cells, which check-parser.ts compares with today's parser.
for (const {name, tables} of variants) {
  const maximumLength = 6
  const codePoints = Array.from({length: tables.classCount}, (_, characterClass) => codePointOfClass(tables, characterClass)).filter(character => character !== '').map(character => character.codePointAt(0)!)
  const trace = createTrace()
  const text = new Int32Array(maximumLength)
  let texts = 0
  let openReads = 0
  // `length` is the number of code points of the text that ran: the step at `position` is its last code point, or
  // with `position` equal to `length` the step after its end.
  const checkLastStep = (position: number, length: number) => {
    if (trace.firstErrorPosition !== -1) return false
    if (tables.lexerOpen[trace.lexerCell[position]!] === 1 || tables.grammarOpen[trace.grammarCell[position]!] === 1 || tables.displayOpen[displayEntryOf(tables, trace.event[position]!, trace.grammarAfter[position]!)] === 1) {
      openReads++
      fail(`${name}: the text ${JSON.stringify(String.fromCodePoint(...text.subarray(0, length)))} reads an open cell at position ${position}, before any error`)
    }
    return true
  }
  const extend = (length: number) => {
    // The text up to `length` has no error. Its end position is a step too.
    texts++
    runRecoveryParserInto(trace, text, 0, length, false, tables, length + 1)
    checkLastStep(length, length)
    if (length === maximumLength) return
    for (const codePoint of codePoints) {
      text[length] = codePoint
      runRecoveryParserInto(trace, text, 0, length + 1, false, tables, length + 1)
      if (checkLastStep(length, length + 1)) extend(length + 1)
    }
  }
  extend(0)
  console.log(`   ${name}: every text of up to ${maximumLength} code points, as far as its ${codePoints.length} classes go: ${texts} texts without an error before their end, and ${openReads} of their steps read an open cell.`)
}

// 4. Saving, loading, the differences of two tables, and a frozen cell.
const scratchFolder = process.env['RECOVERY_SCRATCH']
variants.forEach(({name, tables}, variant) => {
  // With added classes, the changed tokenizer cell and the changed frozen cell are cells of the first added class.
  // With the bit, the changed grammar cell and the changed frozen one are cells with the bit.
  const firstOf = (mask: Uint8Array, bit: number, characterClass: number) => mask.findIndex((isOpen, cell) => isOpen === bit && cell % tables.classCount === characterClass)
  const hasBit = tables.contextCount > contextNames.length
  const firstWithBit = (bit: number) => tables.grammarOpen.findIndex((isOpen, cell) => isOpen === bit && cell % tables.contextCount >= contextNames.length)
  const changed = copyTables(tables)
  const openLexerCell = tables.addedClasses.length === 0 ? tables.lexerOpen.indexOf(1) : firstOf(tables.lexerOpen, 1, classNames.length)
  const openGrammarCell = hasBit ? firstWithBit(1) : tables.grammarOpen.indexOf(1)
  changed.lexerNext[openLexerCell] = 1
  changed.lexerEvent[openLexerCell] = 2
  changed.grammarNext[openGrammarCell] = 5
  changed.grammarAction[openGrammarCell] = actionNone
  // With open entries of the display table, a third change: a literal's first letter is shown as a key when the
  // grammar expects a colon after it.
  const openDisplayEntry = displayEntryOf(tables, eventNames.indexOf('literalStart'), grammarStateNames.indexOf('colon'))
  const hasOpenDisplay = tables.displayOpen[openDisplayEntry] === 1
  if (hasOpenDisplay) changed.display[openDisplayEntry] = displayKindNames.indexOf('key')
  const changes = hasOpenDisplay ? 3 : 2
  let loaded = tablesFromJson(tablesToJson(changed, 'two changed cells'))
  if (scratchFolder !== undefined && scratchFolder !== '') {
    mkdirSync(scratchFolder, {recursive: true})
    const file = join(scratchFolder, `check-tables${variant === 0 ? '' : `-${variant}`}.json`)
    saveTables(file, changed, 'two changed cells')
    loaded = loadTables(file)
  }
  // The loaded tables are the saved ones when they give the same file again. The cells of added states are left
  // out of the list: today's tables have no such state.
  const differences = differencesOf(asIsTables(), loaded.tables).filter(difference => difference.before !== 'no such state')
  if (tablesToJson(loaded.tables, loaded.note) !== tablesToJson(changed, 'two changed cells') || differencesOf(changed, loaded.tables).length !== 0 || differences.length !== changes) fail(`${name}: tables that were saved and loaded are not the tables that were saved`)
  console.log(`${variant === 0 ? '4. ' : '   '}${name[0]!.toUpperCase()}${name.slice(1)} with ${changes === 2 ? 'two' : 'three'} changed open cells, written${scratchFolder === undefined || scratchFolder === '' ? ' as JSON' : ' to a file'} and read again, differ from today's in ${differences.length} cells:`)
  console.log(describeDifferences(differences).split('\n').map(line => `   ${line}`).join('\n'))
  const broken = copyTables(tables)
  const frozenGrammarCell = hasBit ? firstWithBit(0) : tables.grammarOpen.indexOf(0)
  broken.grammarNext[frozenGrammarCell] = tables.errorState
  const problems = problemsOf(broken)
  if (problems.length !== 1) fail(`${name}: a changed frozen cell is not reported as one problem`)
  console.log(`   A change of the frozen cell ${grammarCellName(tables, frozenGrammarCell)} is refused: ${problems.join('; ')}.`)
  if (tables.addedClasses.length > 0) {
    const frozenLexerCell = firstOf(tables.lexerOpen, 0, classNames.length)
    const brokenClass = copyTables(tables)
    brokenClass.lexerNext[frozenLexerCell] = today.lexerStateCount - 1
    const classProblems = problemsOf(brokenClass)
    if (classProblems.length !== 1) fail(`${name}: a changed frozen cell of an added class is not reported as one problem`)
    console.log(`   A change of the frozen cell ${lexerCellName(tables, frozenLexerCell)} is refused: ${classProblems.join('; ')}.`)
    // A file whose class table is not the one that its added classes give.
    const otherTable = JSON.parse(tablesToJson(changed)) as {classOfCodePoint: number[]}
    otherTable.classOfCodePoint[0x27 + 1] = classNames.indexOf('quote')
    let refused = ''
    try {
      tablesFromJson(JSON.stringify(otherTable))
    } catch (error) {
      refused = String(error)
    }
    if (refused === '') fail(`${name}: a file that gives the apostrophe the class of the quote is loaded`)
    else console.log(`   A file that gives the apostrophe the class of the quote is refused: ${refused.replace(/^Error: /, '')}.`)
  }
  if (hasOpenDisplay) {
    // What the display table may not hold: another kind in an entry that a text reads before an error, the kind of
    // the cells after a text's end in an open entry, and another kind for an event of a text's end.
    const refusals: [string, number, number][] = [
      ['of the entry (stringStart, colon), which the quote of a key reads', displayEntryOf(tables, eventNames.indexOf('stringStart'), grammarStateNames.indexOf('colon')), displayKindNames.indexOf('string')],
      ['of an open entry to `pastEnd`', openDisplayEntry, pastEnd],
      ['of the entry (endInsideToken, error), which the end of a text inside a string reads', displayEntryOf(tables, eventNames.indexOf('endInsideToken'), tables.errorState), displayKindNames.indexOf('error')],
    ]
    for (const [what, entry, kind] of refusals) {
      const brokenDisplay = copyTables(tables)
      brokenDisplay.display[entry] = kind
      const displayProblems = problemsOf(brokenDisplay)
      if (displayProblems.length !== 1) fail(`${name}: a change ${what} is not reported as one problem`)
      console.log(`   A change ${what} is refused: ${displayProblems.join('; ')}.`)
    }
    // Without open entries, the same change of an entry that no text reads before an error is refused too.
    const fixed = asIsTables()
    fixed.display[openDisplayEntry] = displayKindNames.indexOf('key')
    if (problemsOf(fixed).length !== 1) fail('a change of the display table of today\'s tables is not reported as one problem')
  }
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
    if (refused === '') fail(`${name}: a file with the state ${value} in an open cell is loaded`)
    else if (value === 259) console.log(`   A file with the state 259 in an open cell is refused: ${refused.replace(/^Error: /, '')}.`)
  }
  // One change at a time, of every cell in each of its two fields, of every entry of the display table and of every
  // bit of the three masks. A change of a frozen cell, of an entry that is not open or of a mask has to be refused,
  // and a change of an open cell or an open entry to another choice must not be.
  {
    const probe = copyTables(tables)
    const tally = {refused: 0, taken: 0}
    const change = (array: Uint8Array, index: number, value: number, hasToBeRefused: boolean, what: () => string) => {
      const kept = array[index]!
      array[index] = value
      const isRefused = problemsOf(probe).length > 0
      array[index] = kept
      if (isRefused !== hasToBeRefused) fail(`${name}: a change of ${what()} is ${isRefused ? 'refused' : 'not refused'}`)
      else if (isRefused) tally.refused++
      else tally.taken++
    }
    for (let cell = 0; cell < probe.lexerNext.length; cell++) {
      const frozen = tables.lexerOpen[cell] === 0
      change(probe.lexerNext, cell, (probe.lexerNext[cell]! + 1) % probe.lexerStateCount, frozen, () => `the next state of the tokenizer cell ${lexerCellName(tables, cell)}`)
      change(probe.lexerEvent, cell, (probe.lexerEvent[cell]! + 1) % probe.eventCount, frozen, () => `the event of the tokenizer cell ${lexerCellName(tables, cell)}`)
      change(probe.lexerOpen, cell, 1 - probe.lexerOpen[cell]!, true, () => `the mask's bit of the tokenizer cell ${lexerCellName(tables, cell)}`)
    }
    for (let cell = 0; cell < probe.grammarNext.length; cell++) {
      const frozen = tables.grammarOpen[cell] === 0
      change(probe.grammarNext, cell, (probe.grammarNext[cell]! + 1) % probe.grammarStateCount, frozen, () => `the next state of the grammar cell ${grammarCellName(tables, cell)}`)
      change(probe.grammarAction, cell, (probe.grammarAction[cell]! + 1) % actionCount, frozen, () => `the stack action of the grammar cell ${grammarCellName(tables, cell)}`)
      change(probe.grammarOpen, cell, 1 - probe.grammarOpen[cell]!, true, () => `the mask's bit of the grammar cell ${grammarCellName(tables, cell)}`)
    }
    for (let entry = 0; entry < probe.display.length; entry++) {
      // Another kind, and for an open entry another one than `pastEnd`, which no open entry may hold. Every variant
      // of this check with an added grammar state has open entries, so no entry here may hold just any kind.
      let kind = (probe.display[entry]! + 1) % displayKindNames.length
      if (tables.displayOpen[entry] === 1 && kind === pastEnd) kind = (kind + 1) % displayKindNames.length
      change(probe.display, entry, kind, tables.displayOpen[entry] === 0, () => `the entry ${displayEntryName(tables, entry)} of the display table`)
      change(probe.displayOpen, entry, 1 - probe.displayOpen[entry]!, true, () => `the mask's bit of the entry ${displayEntryName(tables, entry)} of the display table`)
    }
    console.log(`   One change at a time: ${tally.refused} changes of a frozen cell in one of its two fields, of an entry of the display table that is not open, or of a bit of a mask are all refused. ${tally.taken} changes of an open cell in one of its two fields${tables.displayOpen.includes(1) ? ' or of an open entry' : ''} are not.`)
  }
})

// What differencesOf lists, for the count "cells that differ from today's" of score.ts and compare.ts.
{
  const colon = grammarStateNames.indexOf('colon')
  const describeFirst = (differences: ReturnType<typeof differencesOf>) => describeDifferences(differences.slice(0, 2)).replace(/\s+/g, ' ')
  // Tables that keep the ground rules differ from today's in open cells and open entries only, whatever they hold.
  variants.forEach(({name, tables}, variant) => {
    const changed = copyTables(tables)
    randomizeOpenCells(changed, createRandom(20261015, 6 + variant))
    const frozen = [...differencesOf(asIsTables(), tables), ...differencesOf(asIsTables(), changed)].filter(difference => !difference.open)
    if (frozen.length > 0) fail(`${name}: differencesOf lists ${frozen.length} differences from today's tables in cells that are not open, e.g. ${describeFirst(frozen)}`)
  })
  // Added states without open entries of the display table: every cell of an added state is listed, 33 per tokenizer
  // state and 88 per grammar state, and no entry of the display table is. The column of an added grammar state is
  // what addStates was told to copy, and no cell that a run can change.
  const withStates = addStates(asIsTables(), 2, [colon])
  const ofStates = differencesOf(asIsTables(), withStates)
  const cellsOfStates = 2 * today.classCount + today.tokenCount * today.contextCount
  if (ofStates.length !== cellsOfStates || ofStates.some(difference => difference.table === 'display')) fail(`differencesOf lists ${ofStates.length} differences for tables with 2 added tokenizer states and an added grammar state, ${ofStates.filter(difference => difference.table === 'display').length} of them entries of the display table, and the added states have ${cellsOfStates} cells`)
  // With open entries, the open entries of an added grammar state are listed like its cells: one per event but the
  // three events of a text's end.
  const entriesOfState = differencesOf(asIsTables(), addStates(openDisplayEntries(asIsTables()), 2, [colon])).filter(difference => difference.table === 'display')
  if (entriesOfState.length !== today.eventCount - 3 || entriesOfState.some(difference => !difference.open)) fail(`differencesOf lists ${entriesOfState.length} entries of the display table for an added grammar state with open entries, and the state has ${today.eventCount - 3} open ones`)
  // Two tables whose added grammar state copies another column differ in entries of that state, which are no frozen
  // cells: without open entries, the column of an added state may hold any kinds.
  const shownOtherwise = differencesOf(withStates, addStates(asIsTables(), 2, [grammarStateNames.indexOf('commaOrClose')]))
  if (shownOtherwise.length === 0 || shownOtherwise.some(difference => difference.table !== 'display' || !difference.open)) fail(`two tables whose added grammar state copies another column differ in ${shownOtherwise.length} cells, e.g. ${describeFirst(shownOtherwise)}`)
  console.log(`   differencesOf: tables with 2 added tokenizer states and an added grammar state differ from today's in the ${ofStates.length} cells of the added states and in no entry of the display table. With open entries, the ${entriesOfState.length} open entries of the added grammar state are listed too. No difference of the ${variants.length} kinds of tables from today's is in a frozen cell, with every open cell as it is and with a random choice in each.`)
}

// The lists of added classes that cannot be.
{
  const refusals: [string, AddedClass[]][] = [
    ['code points of two classes in one added class', [{name: 'mixed', codePoints: [0x27, 0x2d]}]],
    ['a class that would be left without a code point', [{name: 'feed', codePoints: [0x0a]}]],
    ['a code point in two added classes', [{name: 'first', codePoints: [0x27]}, {name: 'second', codePoints: [0x27, 0x60]}]],
    ['the name of a class of today', [{name: 'quote', codePoints: [0x27]}]],
    ['a code point twice in one added class', [{name: 'twice', codePoints: [0x27, 0x27]}]],
  ]
  for (const [what, classes] of refusals) {
    let refused = false
    try {
      addClasses(asIsTables(), classes)
    } catch {
      refused = true
    }
    if (!refused) fail(`addClasses takes ${what}`)
  }
  // A code point past today's class table, and the last one of the table: every other code point from U+0080 up
  // keeps the class `other`.
  const far = addClasses(asIsTables(), [{name: 'delete', codePoints: [0x7f]}, {name: 'face', codePoints: [0x1f600]}])
  const classOf = (codePoint: number) => className(far, far.classOfCodePoint[Math.min(codePoint + 1, far.classOfCodePoint.length - 1)]!)
  if (classOf(0x7f) !== 'delete' || classOf(0x1f600) !== 'face' || classOf(0x80) !== 'other' || classOf(0x1f601) !== 'other' || classOf(0x10ffff) !== 'other' || classOf(0x7e) !== 'other' || classOf(0x22) !== 'quote') fail('an added class of U+007F or of U+1F600 changes the class of another code point')
  console.log(`   addClasses refuses ${refusals.map(([what]) => what).join(', ')}.`)
}

// 5. The four functions in every order: 24 orders, one file.
{
  const functions: ((tables: RecoveryTables) => RecoveryTables)[] = [
    tables => addClasses(tables, classesOfTheChecks), openDisplayEntries, addFirstOnLineBit, tables => addStates(tables, 2, [grammarStateNames.indexOf('colon')]),
  ]
  const files = new Set<string>()
  const apply = (tables: RecoveryTables, left: number[]) => {
    if (left.length === 0) files.add(tablesToJson(tables))
    for (const next of left) apply(functions[next]!(tables), left.filter(other => other !== next))
  }
  apply(asIsTables(), [0, 1, 2, 3])
  if (files.size !== 1 || !files.has(tablesToJson(variants.at(-1)!.tables))) fail(`addClasses, openDisplayEntries, addFirstOnLineBit and addStates give ${files.size} different tables in their 24 orders`)
  console.log(`5. addClasses, openDisplayEntries, addFirstOnLineBit and addStates give the same tables in each of their 24 orders.`)
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
