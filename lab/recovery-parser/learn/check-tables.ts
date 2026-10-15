// Checks which cells are open, since the experiment's ground rules rest on it.
//
// Run from the repo root: bun lab/recovery-parser/learn/check-tables.ts [number of dataset samples, default 30000]
//
// Every part runs for today's tables, and for today's tables with structure added to them, see structure/README.md:
// with added classes, and with open entries of the display table.
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
//
// Parts 2 and 3 run today's parser, table-parser.ts, which knows nothing of added structure. The check works out
// itself which cell of the tables a step of today's parser reads, e.g. the cell of an added class from the code point.
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {createRandom} from '../random.ts'
import {defaultSeed, sampleAt} from '../samples.ts'
import {type ParserTrace, classNames, positionCount, runTableParser} from '../table-parser.ts'
import {checkTexts, classesOfTheChecks, textWithAddedClasses} from './check-texts.ts'
import {codePointsOf, createTrace, runRecoveryParserInto} from './recovery-parser.ts'
import {
  type AddedClass, type RecoveryTables, actionNone, addClasses, asIsTables, cellCounts, className, copyTables, describeDifferences, differencesOf, displayEntryName, displayEntryOf, displayKindNames, eventNames,
  frozenSearchOf, grammarCellName, grammarStateNames, lexerCellName, loadTables, openDisplayEntries, problemsOf, saveTables, tablesFromJson, tablesToJson, today,
} from './recovery-tables.ts'

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
]
const ones = (mask: Uint8Array) => mask.reduce((total, bit) => total + bit, 0)

// One code point per class. The class `end` stands for the end of the text.
const codePointOfTodaysClass: Record<typeof classNames[number], string> = {
  end: '', truncatedEnd: '', space: ' ', tabOrCarriageReturn: '\t', lineFeed: '\n', control: '\u0001', quote: '"', backslash: '\\', slash: '/', openBrace: '{', closeBrace: '}',
  openBracket: '[', closeBracket: ']', colon: ':', comma: ',', minus: '-', plus: '+', dot: '.', zero: '0', digit: '7', a: 'a', b: 'b', e: 'e', capitalE: 'E', f: 'f', l: 'l', n: 'n',
  r: 'r', s: 's', t: 't', u: 'u', otherHexLetter: 'c', other: 'x',
}
const codePointOfClass = (tables: RecoveryTables, characterClass: number) =>
  characterClass < classNames.length ? codePointOfTodaysClass[classNames[characterClass]!] : String.fromCodePoint(tables.addedClasses[characterClass - classNames.length]!.codePoints[0]!)

// The cells of `tables` that a step of today's parser reads. The class is the one that `tables` give the code point,
// and it has to be a class whose code points have the trace's class today.
function lexerCellAt(tables: RecoveryTables, codePoints: readonly number[], trace: ParserTrace, position: number) {
  const characterClass = position < codePoints.length ? tables.classOfCodePoint[Math.min(codePoints[position]! + 1, tables.classOfCodePoint.length - 1)]! : trace.characterClass[position]!
  if (tables.classToday[characterClass] !== trace.characterClass[position]) fail(`the tables give the code point ${codePoints[position]} the class ${className(tables, characterClass)}, and today's parser reads the class ${classNames[trace.characterClass[position]!]}`)
  return trace.lexerStateBefore[position]! * tables.classCount + characterClass
}
const grammarCellAt = (tables: RecoveryTables, trace: ParserTrace, position: number) =>
  (trace.grammarBefore[position]! * tables.tokenCount + trace.token[position]!) * tables.contextCount + trace.context[position]!
const displayEntryAt = (tables: RecoveryTables, trace: ParserTrace, position: number) => displayEntryOf(tables, trace.event[position]!, trace.grammarAfter[position]!)
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
    console.log(`   The class ${className(tables, characterClass)}, from the class ${classNames[tables.classToday[characterClass]!]}: ${frozen.length} of its ${tables.lexerStateCount} cells are frozen, ${frozen.map(cell => lexerCellName(tables, cell)).join(' ')}.`)
  }
  const search = frozenSearchOf(tables)
  if (counts.displayOpen > 0) {
    // An entry that is not open is one that the search found, or one of the three events of a text's end.
    const endEntries = Array.from(tables.display, (kind, entry) => kind === pastEnd && search.displayFrozen[entry] === 0 ? 1 : 0).reduce((total: number, bit) => total + bit, 0)
    const open = Array.from(tables.displayOpen, (isOpen, entry) => isOpen === 1 ? displayEntryName(tables, entry) : '').filter(entryName => entryName !== '')
    console.log(`   Display table: ${counts.displayEntries} entries, ${counts.displayOpen} open. Of the other ${counts.displayEntries - counts.displayOpen}, a text reads ${ones(search.displayFrozen)} before any error, and ${endEntries} are entries of the three events of a text's end that no text reads before an error.`)
    console.log(`   Open, by event: ${eventNames.map(event => ({event, states: open.filter(entryName => entryName.startsWith(`(${event},`)).length})).filter(({states}) => states > 0).map(({event, states}) => `${event} ${states}`).join(', ')}.`)
    if (counts.displayOpen + ones(search.displayFrozen) + endEntries !== counts.displayEntries) fail(`${name}: an entry of the display table is neither open, nor read before an error, nor one of a text's end`)
  }

  // 2. A text for every frozen cell, from the search that found the cell frozen.
  let witnessed = 0
  let longestWitness = 0
  const checkWitness = (classes: number[], cellAt: (codePoints: readonly number[], trace: ParserTrace, position: number) => number, cell: number, cellName: string) => {
    const text = classes.map(characterClass => codePointOfClass(tables, characterClass)).join('')
    const position = classes.length - 1
    const trace = runTableParser(text)
    longestWitness = Math.max(longestWitness, classes.length)
    if (cellAt(codePointsOf(text).codePoints, trace, position) !== cell) fail(`the text ${JSON.stringify(text)} does not read the frozen cell ${cellName} at position ${position}`)
    else if (trace.firstErrorPosition !== -1 && trace.firstErrorPosition <= position) fail(`the text ${JSON.stringify(text)} reads the frozen cell ${cellName} at position ${position}, at or after its first error at ${trace.firstErrorPosition}`)
    else witnessed++
  }
  for (let cell = 0; cell < search.lexerFrozen.length; cell++) {
    const classes = search.lexerWitness(cell)
    if (classes !== undefined) checkWitness(classes, (codePoints, trace, position) => lexerCellAt(tables, codePoints, trace, position), cell, lexerCellName(tables, cell))
  }
  for (let cell = 0; cell < search.grammarFrozen.length; cell++) {
    const classes = search.grammarWitness(cell)
    if (classes !== undefined) checkWitness(classes, (_, trace, position) => grammarCellAt(tables, trace, position), cell, grammarCellName(tables, cell))
  }
  if (search.reachedByGuessAlone !== 0) fail(`the search reached ${search.reachedByGuessAlone} configurations only by guessing the kind of a container`)
  console.log(`2. ${witnessed} of the ${counts.lexerFrozen + counts.grammarFrozen} frozen cells are read before any error by a text of this check, the longest of ${longestWitness} code points. The search reached ${search.reachedByGuessAlone} configurations only by guessing the kind of a container.`)
  if (counts.displayOpen > 0) {
    witnessed = 0
    for (let entry = 0; entry < search.displayFrozen.length; entry++) {
      const classes = search.displayWitness(entry)
      if (classes !== undefined) checkWitness(classes, (_, trace, position) => displayEntryAt(tables, trace, position), entry, `${displayEntryName(tables, entry)} of the display table`)
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
  variants.forEach(({name, tables}, variant) => {
    for (let position = 0; position < positions; position++) {
      const lexerCell = lexerCellAt(tables, codePoints, trace, position)
      const grammarCell = grammarCellAt(tables, trace, position)
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
  const sample = sampleAt(defaultSeed, index)
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
  const checkLastStep = (position: number) => {
    if (trace.firstErrorPosition !== -1) return false
    if (tables.lexerOpen[trace.lexerCell[position]!] === 1 || tables.grammarOpen[trace.grammarCell[position]!] === 1 || tables.displayOpen[displayEntryOf(tables, trace.event[position]!, trace.grammarAfter[position]!)] === 1) {
      openReads++
      fail(`${name}: the text ${JSON.stringify(String.fromCodePoint(...text.subarray(0, position)))} reads an open cell at position ${position}, before any error`)
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
  console.log(`   ${name}: every text of up to ${maximumLength} code points, as far as its ${codePoints.length} classes go: ${texts} texts without an error before their end, and ${openReads} of their steps read an open cell.`)
}

// 4. Saving, loading, the differences of two tables, and a frozen cell.
const scratchFolder = process.env['RECOVERY_SCRATCH']
variants.forEach(({name, tables}, variant) => {
  // With added classes, the changed tokenizer cell and the changed frozen cell are cells of the first added class.
  const firstOf = (mask: Uint8Array, bit: number, characterClass: number) => mask.findIndex((isOpen, cell) => isOpen === bit && cell % tables.classCount === characterClass)
  const changed = copyTables(tables)
  const openLexerCell = tables.addedClasses.length === 0 ? tables.lexerOpen.indexOf(1) : firstOf(tables.lexerOpen, 1, classNames.length)
  const openGrammarCell = tables.grammarOpen.indexOf(1)
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
  // The loaded tables are the saved ones when they give the same file again.
  const differences = differencesOf(asIsTables(), loaded.tables)
  if (tablesToJson(loaded.tables, loaded.note) !== tablesToJson(changed, 'two changed cells') || differencesOf(changed, loaded.tables).length !== 0 || differences.length !== changes) fail(`${name}: tables that were saved and loaded are not the tables that were saved`)
  console.log(`${variant === 0 ? '4. ' : '   '}${name[0]!.toUpperCase()}${name.slice(1)} with ${changes === 2 ? 'two' : 'three'} changed open cells, written${scratchFolder === undefined || scratchFolder === '' ? ' as JSON' : ' to a file'} and read again, differ from today's in ${differences.length} cells:`)
  console.log(describeDifferences(differences).split('\n').map(line => `   ${line}`).join('\n'))
  const broken = copyTables(tables)
  const frozenGrammarCell = tables.grammarOpen.indexOf(0)
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
})

// The lists of added classes that cannot be.
{
  const refusals: [string, AddedClass[]][] = [
    ['code points of two classes in one added class', [{name: 'mixed', codePoints: [0x27, 0x2d]}]],
    ['a class that would be left without a code point', [{name: 'feed', codePoints: [0x0a]}]],
    ['a code point in two added classes', [{name: 'first', codePoints: [0x27]}, {name: 'second', codePoints: [0x27, 0x60]}]],
    ['the name of a class of today', [{name: 'quote', codePoints: [0x27]}]],
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

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
