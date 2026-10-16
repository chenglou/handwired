// A report on saved tables, for a reader: the scores on a split, how many tokens a recovery inserts, and the open
// cells that the most samples read, with what each holds, in words.
//
//   bun lab/recovery-lr/learn/report.ts --tables <file.json> [--split train|validation] [--count <samples>] [--cells <how many>]
// Without --tables it reports on the parser as it is.
import {type PackedSamples, loadPacked} from './data.ts'
import {numberOf, optionOf, refuseUnknownOptions, standardValidationCount} from './options.ts'
import {type RecoveryTables, addFirstOnLineFlag, addTerminals, baseTables, cellCounts, choiceKindNames, differencesOf, displayKindCount, kindOfChoice, loadTablesForReport, withoutEndEarly} from './recovery-tables.ts'
import {describeTotals, scoreHeader, scoreRow, scoreTables, sharesOf} from './score.ts'
import {cellInWords, choiceInWords, displayEntryInWords} from './words.ts'

// The parser as it is in the layout of `tables`: with their added terminals, their flag and their lists.
export function baseInLayoutOf(tables: RecoveryTables): RecoveryTables {
  let base = baseTables()
  if (!tables.endEarly) base = withoutEndEarly(base)
  if (tables.addedTerminals.length > 0) base = addTerminals(base, tables.addedTerminals)
  return tables.firstOnLineFlag ? addFirstOnLineFlag(base) : base
}

// The lines of a report on `tables` with the packed samples `samples`, named `splitName` in the text.
export function reportOf(tables: RecoveryTables, samples: PackedSamples, splitName: string, cellsShown = 40): string[] {
  const lines: string[] = []
  const base = baseInLayoutOf(tables)
  const differences = differencesOf(base, tables)
  const counts = cellCounts(tables)
  const changedCells = new Set(differences.filter(difference => difference.table === 'cells').map(difference => difference.index))
  const changedEntries = new Set(differences.filter(difference => difference.table === 'display').map(difference => difference.index))
  lines.push(`The tables: ${tables.firstOnLineFlag ? 'with' : 'without'} the flag "first on its line", ${tables.endEarly ? 'with' : 'without'} the choices "end an item early", ${tables.addedTerminals.length === 0 ? 'no added terminal' : `added terminals for ${tables.addedTerminals.map(terminal => `\`${String.fromCodePoint(terminal.codePoint)}\``).join(' ')}`}.`)
  lines.push(`${counts.openCells} open cells, of which ${counts.keptCells} are cells of the end of input, and ${counts.openDisplayEntries} open display entries. ${changedCells.size} cells and ${changedEntries.size} display entries hold something else than the parser as it is.`)

  const reads = new Int32Array(tables.choice.length), readers = new Int32Array(tables.choice.length)
  const wantedKinds = new Int32Array(tables.display.length * displayKindCount)
  const {score, totals} = scoreTables(tables, samples, {reads, readers, wantedKinds})
  const shares = sharesOf(score)
  lines.push('', `The ${splitName} samples:`, scoreHeader, scoreRow('the tables', score), scoreRow('the parser as it is', scoreTables(base, samples).score), describeTotals(samples, score, totals))
  lines.push(`A recovery inserts ${shares.insertedPerSample.toFixed(2)} tokens per sample, and ${shares.samplesWithInserted.toFixed(1)}% of the samples have at least one inserted token.`)

  // What the cells that the samples read hold, by the kind of the choice.
  const readCells = Array.from(readers.keys()).filter(cell => readers[cell]! > 0)
  const byKind = new Map<string, {cells: number, reads: number}>()
  for (const cell of readCells) {
    const kind = choiceKindNames[kindOfChoice(tables.choice[cell]!)]!
    const entry = byKind.get(kind) ?? {cells: 0, reads: 0}
    entry.cells++
    entry.reads += reads[cell]!
    byKind.set(kind, entry)
  }
  const allReads = readCells.reduce((sum, cell) => sum + reads[cell]!, 0)
  lines.push('', `The samples read ${readCells.length} open cells, ${readCells.filter(cell => changedCells.has(cell)).length} of them changed, ${allReads} times. By what the cells hold:`)
  for (const [kind, entry] of [...byKind].sort((left, right) => right[1].reads - left[1].reads)) lines.push(`- ${kind}: ${entry.cells} cells, ${(100 * entry.reads / allReads).toFixed(1)}% of the reads`)

  lines.push('', `The ${Math.min(cellsShown, readCells.length)} open cells that the most samples read (samples that read the cell, reads):`)
  readCells.sort((left, right) => readers[right]! - readers[left]! || left - right)
  for (const cell of readCells.slice(0, cellsShown)) {
    lines.push(`- ${String(readers[cell]).padStart(5)} ${String(reads[cell]).padStart(6)}  ${cellInWords(tables, cell)}${changedCells.has(cell) ? ` (the parser as it is: ${choiceInWords(base, cell)})` : ' (as the parser as it is)'}`)
  }

  // The open display entries by the code points that are shown by them where the depth and the container are right.
  const shownBy = (entry: number): number => {
    let total = 0
    for (let kind = 0; kind < displayKindCount; kind++) total += wantedKinds[entry * displayKindCount + kind]!
    return total
  }
  const readEntries = Array.from(tables.display.keys()).filter(entry => tables.displayOpen[entry] === 1 && shownBy(entry) > 0).sort((left, right) => shownBy(right) - shownBy(left) || left - right)
  lines.push('', `The ${Math.min(cellsShown, readEntries.length)} open display entries that show the most scored code points (code points whose depth and container are right there, and how many of them want the entry's kind):`)
  for (const entry of readEntries.slice(0, cellsShown)) {
    lines.push(`- ${String(shownBy(entry)).padStart(6)} ${String(wantedKinds[entry * displayKindCount + tables.display[entry]!]).padStart(6)}  ${displayEntryInWords(tables, entry)}${changedEntries.has(entry) ? '' : ' (as the parser as it is)'}`)
  }
  return lines
}

if (import.meta.main) {
  refuseUnknownOptions('report.ts', ['--tables', '--split', '--count', '--cells'])
  const split = optionOf('--split') ?? 'validation'
  if (split !== 'train' && split !== 'validation') throw new Error(`--split is train or validation, and got ${split}`)
  const tablesFile = optionOf('--tables')
  const loaded = tablesFile === undefined ? {tables: baseTables(), note: 'the parser as it is'} : loadTablesForReport(tablesFile)
  console.log(`${tablesFile ?? 'No file'}: ${loaded.note}`)
  const samples = loadPacked(split, numberOf('--count', standardValidationCount), loaded.tables)
  for (const line of reportOf(loaded.tables, samples, split, numberOf('--cells', 40))) console.log(line)
}
