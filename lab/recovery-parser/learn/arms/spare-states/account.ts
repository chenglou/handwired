// The account of the spare states of saved tables: what each spare state does, and what it is worth.
//
// Per spare state it prints:
// - how many code points of the validation split are read in the state, i.e. with the state before the code point,
// - the cells that lead into it, each with the state it comes from and the class or the token, and the state's own
//   cells that a text reads, which say where it goes on,
// - three short train samples with the state marked under the text,
// - the test: the same tables without the state, scored again, in three ways. "Sent": every cell that leads into
//   the state leads into a stand-in instead, the state of today's that costs the fewest right code points on a part
//   of the train split. "Folded": the same, and the stand-in's open cells take the spare state's choices, so that a
//   state of today's does the spare state's job. And every cell that leads into the state holds the base's choice
//   again. The drop is what the state is worth, per group and kind, and the drop after folding is what the state
//   holds apart from its stand-in. Both are tries: a drop says that this way does not move the state's job into a
//   state of today's, not that no tables of today's layout hold it.
// The sentence that says what the state remembers is for the reader to write, and the test is the check of it.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/spare-states/account.ts --tables <file.json> [--base today|hand-written|words]
// --base names the tables that the run started from, without their spare states.
import {type Samples, codePointKept, codePointKindScored, kindsOf, optionOf, refuseUnknownOptions} from '../../data.ts'
import {type RecoveryTrace, createTrace} from '../../recovery-parser.ts'
import {displayKindNames, grammarCellName, grammarChoiceName, lexerCellName, lexerChoiceName, loadTablesForReport, today} from '../../recovery-tables.ts'
import {type Score, rowOf, runOnSample, scoreTables, sharesOf} from '../../score.ts'
import {trainPartOfTheStandardSet, validationOfTheStandardSet} from '../harness.ts'
import {
  type SpareState, baseKindOf, baseOf, codePointsIn, reportedRows, samplesIn, spareStatesOf, standInOf, standInSamplesOf, stateNameOf, stateUseOf, withoutSpareStates, withoutState,
} from './spare-states.ts'

refuseUnknownOptions('arms/spare-states/account.ts', ['--tables', '--base'])
const tablesFile = optionOf('--tables')
if (tablesFile === undefined) throw new Error('arms/spare-states/account.ts needs --tables <file.json>')
const kind = baseKindOf(optionOf('--base'))
const tables = loadTablesForReport(tablesFile).tables
const base = baseOf(kind, {tokenizer: tables.lexerStateCount - today.lexerStateCount, grammar: tables.grammarStateCount - today.grammarStateCount})
const validation = validationOfTheStandardSet()
const train = trainPartOfTheStandardSet()
const standInSamples = standInSamplesOf(train)

const cellNameOf = (spare: SpareState, cell: number) => spare.grammar ? grammarCellName(tables, cell) : lexerCellName(tables, cell)
const choiceNameOf = (spare: SpareState, cell: number) => spare.grammar ? grammarChoiceName(tables, cell) : lexerChoiceName(tables, cell)

// The steps of the samples that have to do with a spare state: how often a text takes each cell that leads into the
// state, how many code points read each of the state's own cells, what the labels say that the code points read in
// the state are, and per sample that reads the state, the cell of its first step into it.
function stepsOf(samples: Samples, spare: SpareState) {
  const into = new Map<number, number>()
  const own = new Map<number, number>()
  const labelled = new Map<string, number>()
  const readers: {place: number, firstCellInto: number}[] = []
  const trace = createTrace()
  const add = (counts: Map<number, number>, cell: number) => counts.set(cell, (counts.get(cell) ?? 0) + 1)
  for (let place = 0; place < samples.sampleCount; place++) {
    const firstError = samples.firstErrorPosition[place]!
    if (samples.firstDamage[place] === -1 || firstError === -1) continue
    runOnSample(trace, samples, place, tables)
    const length = samples.start[place + 1]! - samples.start[place]!
    let firstCellInto = -1
    for (let position = firstError; position < length; position++) {
      const before = (spare.grammar ? trace.grammarBefore : trace.lexerStateBefore)[position]
      const after = (spare.grammar ? trace.grammarAfter : trace.lexerStateAfter)[position]
      const cell = (spare.grammar ? trace.grammarCell : trace.lexerCell)[position]!
      if (before === spare.state) {
        add(own, cell)
        const flags = samples.flags[samples.start[place]! + position]!
        const label = (flags & codePointKept) === 0 ? 'added by the damage' : (flags & codePointKindScored) === 0 ? 'not scored' : displayKindNames[samples.labelKind[samples.start[place]! + position]!]!
        labelled.set(label, (labelled.get(label) ?? 0) + 1)
      } else if (after === spare.state) {
        add(into, cell)
        if (firstCellInto === -1) firstCellInto = cell
      }
    }
    if (firstCellInto !== -1) readers.push({place, firstCellInto})
  }
  return {into, own, labelled, readers}
}
const mostFirst = <Key extends number | string>(counts: Map<Key, number>) => [...counts].sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))

// One column per code point: characters that would break the columns are shown as another character.
const standIns: Record<number, string> = {0x0a: '⏎', 0x09: '→', 0x0d: '↵'}
const visible = (codePoint: number) => standIns[codePoint] ?? (codePoint < 0x20 || codePoint === 0x7f || codePoint >= 0x1100 ? '◆' : String.fromCodePoint(codePoint))
const kindLetters = 'wpsenlE.k'

// A train sample as aligned lines: the text, a ^ under every code point that is read in the spare state, the display
// kind that the label wants (blank where the damage added the code point, ? where the kind is not scored) and the
// one that the tables give: w whitespace, p punctuation, s string, e escape, n number, l literal, E error, k key.
// A long text is cut to 110 code points around the first one that is read in the state.
function showSample(trace: RecoveryTrace, place: number, spare: SpareState, cellInto: number) {
  runOnSample(trace, train, place, tables)
  const start = train.start[place]!
  const length = train.start[place + 1]! - start
  const inState = (position: number) => (spare.grammar ? trace.grammarBefore : trace.lexerStateBefore)[position] === spare.state
  let firstRead = 0
  while (firstRead < length && !inState(firstRead)) firstRead++
  const from = length <= 110 ? 0 : Math.max(0, Math.min(firstRead - 30, length - 110))
  const to = Math.min(length, from + 110)
  const lines = {text: '', in: '', want: '', got: ''}
  for (let position = from; position < to; position++) {
    const flags = train.flags[start + position]!
    lines.text += visible(train.codePoints[start + position]!)
    lines.in += inState(position) ? '^' : ' '
    lines.want += (flags & codePointKept) === 0 ? ' ' : (flags & codePointKindScored) !== 0 ? kindLetters[train.labelKind[start + position]!]! : '?'
    lines.got += kindLetters[trace.displayKind[position]!]!
  }
  console.log(`  sample ${train.index[place]} of the train split, kinds: ${kindsOf(train, place).join(', ')}, first led into the state by ${cellNameOf(spare, cellInto)}${from > 0 || to < length ? `, code points ${from} to ${to - 1} of ${length}` : ''}`)
  for (const [name, line] of Object.entries(lines)) console.log(`    ${name.padEnd(5)}${line}`)
}

// The rows of the test: all three of every reported row with the tables as they are, and the points that each of the
// other tables has fewer, and the same for whole samples of all validation samples.
function describeTest(withTheState: Score, others: {name: string, score: Score}[]) {
  const percent = (share: number) => (100 * share).toFixed(2)
  const signed = (points: number) => `${points > 0 ? '+' : ''}${points.toFixed(2)}`
  console.log(`  | row | samples | all three | ${others.map(other => other.name).join(' | ')} |`)
  console.log(`  | --- | --- | --- | ${others.map(() => '---').join(' | ')} |`)
  for (const {row, label} of reportedRows) {
    const shares = sharesOf(rowOf(withTheState, row)!)
    console.log(`  | ${label} | ${rowOf(withTheState, row)!.samples} | ${percent(shares.allThree)} | ${others.map(other => signed(100 * (sharesOf(rowOf(other.score, row)!).allThree - shares.allThree))).join(' | ')} |`)
  }
  const whole = sharesOf(withTheState.rows[0]!).whole
  console.log(`  | whole samples, all | ${withTheState.rows[0]!.samples} | ${percent(whole)} | ${others.map(other => signed(100 * (sharesOf(other.score.rows[0]!).whole - whole))).join(' | ')} |`)
  // The kinds of damage that lose the most code points with the first of the other tables.
  const lostPerKind = withTheState.rows.filter(row => row.name.startsWith('kind: ')).map(row => ({name: row.name.slice(6), lost: row.allRight - rowOf(others[0]!.score, row.name)!.allRight, codePoints: row.codePoints}))
    .filter(kind => kind.lost !== 0).sort((left, right) => right.lost - left.lost)
  const describeKinds = (kinds: typeof lostPerKind) => kinds.length === 0 ? 'none' : kinds.map(kind => `${kind.name} ${kind.lost > 0 ? '-' : '+'}${Math.abs(kind.lost)} of ${kind.codePoints}`).join(', ')
  console.log(`  Scored code points with all three right, ${others[0]!.name}, by kind of damage: the largest losses ${describeKinds(lostPerKind.filter(kind => kind.lost > 0).slice(0, 6))}; the largest gains ${describeKinds(lostPerKind.filter(kind => kind.lost < 0).reverse().slice(0, 3))}.`)
}

const scoreWithStates = scoreTables(tables, validation)
const validationUse = stateUseOf(tables, validation)
const trainUse = stateUseOf(tables, train)
const spareStates = spareStatesOf(tables)
console.log(`Tables: ${tablesFile}. ${spareStates.length} spare state${spareStates.length === 1 ? '' : 's'}. The broken validation samples have ${validationUse.codePoints} code points from their first error on, and the broken train samples ${trainUse.codePoints}.`)
const trace = createTrace()
for (const spare of spareStates) {
  console.log('')
  const next = spare.grammar ? tables.grammarNext : tables.lexerNext
  const cellsPerState = spare.grammar ? tables.tokenCount * tables.contextCount : tables.classCount
  const cellsInto = Array.from(next.keys()).filter(cell => next[cell] === spare.state && Math.floor(cell / cellsPerState) !== spare.state)
  console.log(`## The ${stateNameOf(spare)}`)
  console.log(`Read in it: ${codePointsIn(validationUse, spare)} code points of ${samplesIn(validationUse, spare)} validation samples (${(100 * codePointsIn(validationUse, spare) / validationUse.codePoints).toFixed(2)}% of the code points from a first error on), and ${codePointsIn(trainUse, spare)} code points of ${samplesIn(trainUse, spare)} train samples.`)
  if (cellsInto.length === 0) {
    console.log('No cell of another state leads into it: training left it unused, and no text can read its cells.')
    continue
  }
  const validationSteps = stepsOf(validation, spare)
  console.log(`${cellsInto.length} cells of other states lead into it, and a validation text takes ${validationSteps.into.size} of them. The ones that are taken most, with how many times:`)
  for (const [cell, count] of mostFirst(validationSteps.into).slice(0, 10)) console.log(`  ${String(count).padStart(6)}  ${cellNameOf(spare, cell)} -> ${choiceNameOf(spare, cell)}`)
  console.log(`What the labels say that the validation code points read in it are, by display kind: ${mostFirst(validationSteps.labelled).map(([label, count]) => `${label} ${(100 * count / codePointsIn(validationUse, spare)).toFixed(0)}%`).join(', ')}.`)
  console.log(`Of its own ${cellsPerState} cells, a validation text reads ${validationSteps.own.size}. The ones that are read most, with how many code points:`)
  for (const [cell, count] of mostFirst(validationSteps.own).slice(0, 12)) console.log(`  ${String(count).padStart(6)}  ${cellNameOf(spare, cell)} -> ${choiceNameOf(spare, cell)}`)
  const trainSteps = stepsOf(train, spare)
  if (trainSteps.readers.length === 0) {
    console.log('No train sample reads it.')
    continue
  }
  // Three train samples: for each of the three cells by which the most train samples first come into the state, the
  // shortest such sample, and then the shortest ones of all.
  const firstCells = new Map<number, number>()
  for (const reader of trainSteps.readers) firstCells.set(reader.firstCellInto, (firstCells.get(reader.firstCellInto) ?? 0) + 1)
  const lengthOf = (place: number) => train.start[place + 1]! - train.start[place]!
  const shortestFirst = [...trainSteps.readers].sort((left, right) => lengthOf(left.place) - lengthOf(right.place) || left.place - right.place)
  const shown = mostFirst(firstCells).slice(0, 3).map(([cell]) => shortestFirst.find(reader => reader.firstCellInto === cell)!)
  for (const reader of shortestFirst) if (shown.length < 3 && !shown.includes(reader)) shown.push(reader)
  console.log('Train samples, with a ^ under every code point that is read in the state:')
  for (const reader of shown) showSample(trace, reader.place, spare, reader.firstCellInto)
  const sent = standInOf(tables, spare, standInSamples, 'sent')
  const folded = standInOf(tables, spare, standInSamples, 'folded')
  const nameOf = (state: number) => stateNameOf({grammar: spare.grammar, state})
  const describeLost = (lost: number) => lost >= 0 ? `${lost} fewer` : `${-lost} more`
  console.log(`The test, with stand-ins chosen on the first ${standInSamples.sampleCount} train samples. Sent to the ${nameOf(sent.standIn)}, those samples have ${describeLost(sent.lost)} scored code points right, and folded into the ${nameOf(folded.standIn)}, ${describeLost(folded.lost)}: no other state of today's does better. On the validation split, in points of all three:`)
  describeTest(scoreWithStates, [
    {name: `sent to the ${nameOf(sent.standIn)}`, score: scoreTables(sent.tables, validation)},
    {name: `folded into the ${nameOf(folded.standIn)}`, score: scoreTables(folded.tables, validation)},
    {name: 'sent to the base\'s choices', score: scoreTables(withoutState(tables, spare, 'base', base), validation)},
  ])
}
if (spareStates.length > 1) {
  console.log('')
  console.log('## Every spare state taken away')
  console.log('The spare states are taken away one after the other, the one that the train samples read most first. On the validation split, in points of all three:')
  describeTest(scoreWithStates, [
    {name: 'each sent to its stand-in', score: scoreTables(withoutSpareStates(tables, 'sent', base, standInSamples), validation)},
    {name: 'each folded into its stand-in', score: scoreTables(withoutSpareStates(tables, 'folded', base, standInSamples), validation)},
    {name: 'each sent to the base\'s choices', score: scoreTables(withoutSpareStates(tables, 'base', base, standInSamples), validation)},
  ])
}
