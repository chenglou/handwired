// Statistics of the dataset: what it holds, how much of it the parser as it is already gets right, and which cells
// of the tables it reaches.
//
// Run from the repo root: bun lab/recovery-parser/stats.ts <file> [samples, default 40000] [seed]
// It writes the report to the file and prints its first lines.
import {writeFileSync} from 'node:fs'
import {families, kinds, recipeNames} from './damage.ts'
import {type Label} from './labels.ts'
import {type Sample, defaultSeed, heldOutKinds, heldOutTemplate, labeledAfterDamage, labelsOf, sampleAt, sources, splits} from './samples.ts'
import {
  type ParserTables, type ParserTrace, classNames, contextNames, defaultTables, grammarCellName, grammarStateNames, isLexerErrorEvent, lexerCellName,
  lexerStateNames, positionCount, runTableParser, tokenNames,
} from './table-parser.ts'

const tables: ParserTables = defaultTables
const percent = (part: number, whole: number) => whole === 0 ? '    -' : `${(100 * part / whole).toFixed(1).padStart(5)}`
const count = (value: number) => String(value).padStart(7)

// The grammar table's cells that valid JSON can reach, found by walking the table itself from the start state over
// every depth and every kind of innermost container. Closing a container at depth 2 or more can lead back into an
// object or into an array, since a container may sit in either.
function cellsThatJsonAllows() {
  const allowed = new Set<number>()
  const seen = new Set<string>()
  // A configuration: the grammar state, the depth, and whether the innermost container is an object (1), an array (0) or none (0 at depth 0).
  const queue: [state: number, depth: number, inObject: number][] = [[0, 0, 0]]
  const token = (name: typeof tokenNames[number]) => tokenNames.indexOf(name)
  while (queue.length > 0) {
    const [state, depth, inObject] = queue.pop()!
    const key = `${state},${depth},${inObject}`
    if (seen.has(key)) continue
    seen.add(key)
    const context = tables.depthClass[depth]! * 2 + inObject
    for (const name of tokenNames) {
      if (name === 'lexerError') continue
      const cell = state * tables.symbolCount + token(name) * tables.contextCount + context
      const next = tables.grammarNext[cell]!
      if (next === tables.errorState) continue
      allowed.add(cell)
      if (name === 'openObject') queue.push([next, depth + 1, 1])
      else if (name === 'openArray') queue.push([next, depth + 1, 0])
      else if (name === 'closeObject' || name === 'closeArray') {
        if (depth - 1 === 0) queue.push([next, 0, 0])
        else queue.push([next, depth - 1, 0], [next, depth - 1, 1])
      } else queue.push([next, depth, inObject])
    }
  }
  return allowed
}

// The grammar cells that lead into the error state from another state, and the tokenizer cells whose event is an error.
const grammarErrorCells: number[] = []
for (let cell = 0; cell < tables.grammarNext.length; cell++) {
  if (tables.grammarNext[cell] === tables.errorState && Math.floor(cell / tables.symbolCount) !== tables.errorState) grammarErrorCells.push(cell)
}
const lexerErrorCells: number[] = []
for (let cell = 0; cell < tables.lexerEvent.length; cell++) if (isLexerErrorEvent(tables.lexerEvent[cell]!)) lexerErrorCells.push(cell)

type Headroom = {samples: number, nothingToRecover: number, allRight: number, labeled: number, right: number, kindScored: number, kindRight: number, depthRight: number, containerRight: number}
const emptyHeadroom = (): Headroom => ({samples: 0, nothingToRecover: 0, allRight: 0, labeled: 0, right: 0, kindScored: 0, kindRight: 0, depthRight: 0, containerRight: 0})

// Adds one sample to a headroom row: over the labeled code points at or after the first damage, how many the parser as
// it is gets right.
function addHeadroom(row: Headroom, sample: Sample, labels: readonly (Label | undefined)[], trace: ParserTrace) {
  row.samples++
  let labeled = 0
  let right = 0
  for (let index = sample.firstDamage; index < labels.length; index++) {
    const label = labels[index]
    if (label === undefined) continue
    labeled++
    const kindRight = label.kind === undefined || label.kind === trace.displayKind[index]
    const depthRight = label.depth === trace.depthAfter[index]
    const containerRight = label.container === trace.containerAfter[index]
    if (label.kind !== undefined) {
      row.kindScored++
      if (kindRight) row.kindRight++
    }
    if (depthRight) row.depthRight++
    if (containerRight) row.containerRight++
    if (kindRight && depthRight && containerRight) right++
  }
  row.labeled += labeled
  row.right += right
  if (labeled === 0) row.nothingToRecover++
  else if (right === labeled) row.allRight++
}
const headroomHeader = `${'samples'.padStart(7)} ${'nothing'.padStart(7)}  ${'all 3'.padStart(5)} ${'kind'.padStart(5)} ${'depth'.padStart(5)} ${'cont.'.padStart(5)}  ${'whole'.padStart(5)}`
const headroomLine = (row: Headroom) => {
  const withSomething = row.samples - row.nothingToRecover
  return `${count(row.samples)} ${count(row.nothingToRecover)}  ${percent(row.right, row.labeled)} ${percent(row.kindRight, row.kindScored)} ${percent(row.depthRight, row.labeled)} ${percent(row.containerRight, row.labeled)}  ${percent(row.allRight, withSomething)}`
}

function histogram(values: readonly number[], bucketSize: number, buckets: number) {
  const counts = Array.from({length: buckets}, () => 0)
  for (const value of values) counts[Math.min(buckets - 1, Math.floor(value / bucketSize))]!++
  return counts
}
const quartiles = (values: readonly number[]) => {
  const sorted = [...values].sort((left, right) => left - right)
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0
  return `smallest ${sorted[0] ?? 0}, quartiles ${at(0.25)} / ${at(0.5)} / ${at(0.75)}, largest ${sorted.at(-1) ?? 0}, mean ${(values.reduce((total, value) => total + value, 0) / Math.max(1, values.length)).toFixed(1)}`
}

export function report(seed: number, sampleCount: number): string {
  const lines: string[] = []
  const tally = (map: Map<string, number>, key: string, by = 1) => map.set(key, (map.get(key) ?? 0) + by)
  const bySource = new Map<string, number>()
  const bySplit = new Map<string, number>()
  const byReachable = new Map<string, number>()
  const byRecipe = new Map<string, number>()
  const byFamily = new Map<string, number>()
  const byKind = new Map<string, number>()
  const byKindAlone = new Map<string, number>()
  const byKindSplit = new Map<string, Map<string, number>>()
  const byTemplate = new Map<string, number>()
  const byStyle = new Map<string, number>()
  const byHeldOut = new Map<string, number>()
  const byKindCount = new Map<string, number>()
  const byEditCount = new Map<string, number>()
  const originalLengths: number[] = []
  const brokenLengths: number[] = []
  const relativeDamage: number[] = []
  const headroomByKind = new Map<string, Headroom>()
  const headroomByGroup = new Map<string, Headroom>()
  const grammarFirstError = new Map<number, number>()
  const lexerFirstError = new Map<number, number>()
  const validCells = new Map<number, number>()
  const validCellsBySplit = new Map<string, Set<number>>()
  const brokenTexts = new Map<string, number>()
  const originals = new Map<string, string>()
  const situations = new Set<string>()
  const firstErrorSituations = new Set<string>()
  const familyOf = new Map(kinds.map(kind => [kind.name, kind.family]))
  let needsClass = 0
  let debatable = 0
  let unscoredCodePoints = 0
  let splitConflicts = 0
  let damagedSamples = 0

  for (let index = 0; index < sampleCount; index++) {
    const sample = sampleAt(seed, index)
    tally(bySource, sample.source)
    tally(bySplit, sample.split)
    tally(byRecipe, sample.recipe)
    tally(byTemplate, sample.template.startsWith('records') ? 'records (several documents)' : sample.template)
    tally(byStyle, sample.style)
    originalLengths.push(Array.from(sample.original).length)
    brokenLengths.push(sample.alignment.length)
    const earlier = originals.get(sample.original)
    if (earlier !== undefined && earlier !== sample.split) splitConflicts++
    originals.set(sample.original, sample.split)
    // The cells that the valid documents reach, original by original.
    for (const document of sample.documents) {
      const trace = runTableParser(document)
      let cells = validCellsBySplit.get(sample.split)
      if (cells === undefined) validCellsBySplit.set(sample.split, cells = new Set())
      for (let position = 0; position < positionCount; position++) {
        const cell = trace.grammarBefore[position]! * tables.symbolCount + trace.token[position]! * tables.contextCount + trace.context[position]!
        validCells.set(cell, (validCells.get(cell) ?? 0) + 1)
        cells.add(cell)
      }
    }
    if (sample.source === 'valid') continue
    damagedSamples++
    tally(byReachable, sample.reachable)
    for (const held of sample.heldOut) tally(byHeldOut, held)
    tally(byKindCount, String(Math.min(sample.kinds.length, 4)))
    tally(byEditCount, sample.edits.length >= 10 ? '10 or more' : sample.edits.length >= 4 ? '4 to 9' : String(sample.edits.length))
    for (const family of new Set(sample.kinds.map(kind => familyOf.get(kind)!))) tally(byFamily, family)
    for (const kind of sample.kinds) {
      tally(byKind, kind)
      let perSplit = byKindSplit.get(kind)
      if (perSplit === undefined) byKindSplit.set(kind, perSplit = new Map())
      tally(perSplit, sample.split)
    }
    if (sample.kinds.length === 1) tally(byKindAlone, sample.kinds[0]!)
    if (sample.needsClass.length > 0) needsClass++
    if (sample.debatable) debatable++
    unscoredCodePoints += sample.unscoredKinds.length
    relativeDamage.push(sample.firstDamage / Math.max(1, sample.alignment.length))
    tally(brokenTexts, sample.broken)

    const trace = runTableParser(sample.broken)
    const labels = labelsOf(sample)
    const addTo = (map: Map<string, Headroom>, key: string) => {
      let row = map.get(key)
      if (row === undefined) map.set(key, row = emptyHeadroom())
      addHeadroom(row, sample, labels, trace)
    }
    for (const kind of sample.kinds) addTo(headroomByKind, kind)
    const lines1 = sample.broken.includes('\n') ? 'several lines' : 'one line'
    addTo(headroomByGroup, 'every broken sample')
    addTo(headroomByGroup, `source: ${sample.source}`)
    addTo(headroomByGroup, `reachable: ${sample.reachable}`)
    addTo(headroomByGroup, `reachable: ${sample.reachable}, ${lines1}`)
    addTo(headroomByGroup, `layout: ${lines1}`)
    addTo(headroomByGroup, sample.needsClass.length > 0 ? 'needs a character class the highlighter lacks' : 'needs no other character class')
    addTo(headroomByGroup, labeledAfterDamage(sample) === 0 ? 'nothing to recover' : 'something to recover')
    addTo(headroomByGroup, `split: ${sample.split}`)
    addTo(headroomByGroup, `kinds in the sample: ${Math.min(sample.kinds.length, 4)}${sample.kinds.length >= 4 ? ' or more' : ''}`)
    if (sample.source === 'damage') addTo(headroomByGroup, `recipe: ${sample.recipe}`)

    // The cells at the first error of the parser as it is.
    const position = trace.firstErrorPosition
    const grammarCell = trace.grammarBefore[position]! * tables.symbolCount + trace.token[position]! * tables.contextCount + trace.context[position]!
    grammarFirstError.set(grammarCell, (grammarFirstError.get(grammarCell) ?? 0) + 1)
    const lexerCell = trace.lexerStateBefore[position]! * tables.classCount + trace.characterClass[position]!
    if (isLexerErrorEvent(trace.event[position]!)) lexerFirstError.set(lexerCell, (lexerFirstError.get(lexerCell) ?? 0) + 1)
    firstErrorSituations.add(`${lexerCell},${grammarCell}`)
    // The situation at the first damaged code point: the tokenizer's state and the character's class, the grammar's
    // state, and the context.
    const damage = Math.min(sample.firstDamage, positionCount - 1)
    situations.add(`${trace.lexerStateBefore[damage]},${trace.characterClass[damage]},${trace.grammarBefore[damage]},${trace.context[damage]}`)
  }

  const table = (title: string, map: Map<string, number>, total: number, order?: readonly string[]) => {
    lines.push('', title)
    const keys = order === undefined ? [...map.keys()].sort((left, right) => map.get(right)! - map.get(left)!) : order.filter(key => map.has(key))
    for (const key of keys) lines.push(`  ${count(map.get(key)!)} ${percent(map.get(key)!, total)}%  ${key}`)
  }
  lines.push(`Recovery dataset, seed ${seed}, samples 0 to ${sampleCount - 1}.`)
  lines.push(`${damagedSamples} broken samples and ${sampleCount - damagedSamples} valid ones. Shares are of all samples for sources, splits, templates and styles, and of the broken samples elsewhere.`)
  table('Samples per source', bySource, sampleCount, sources)
  table('Samples per split', bySplit, sampleCount, splits)
  lines.push(`  ${splitConflicts} originals occur in two splits (must be 0).`)
  table(`Samples that training never sees (held-out kinds ${heldOutKinds.join(', ')}; held-out template ${heldOutTemplate})`, byHeldOut, damagedSamples)
  table('Broken samples per reachable flag', byReachable, damagedSamples, ['yes', 'line rule', 'no'])
  lines.push(`  ${needsClass} (${percent(needsClass, damagedSamples).trim()}%) need a character class the highlighter lacks. ${debatable} (${percent(debatable, damagedSamples).trim()}%) have another sensible repair. ${unscoredCodePoints} kept code points have a display kind that is not scored.`)
  table('Broken samples per way of choosing the kinds', byRecipe, damagedSamples, ['typing', 'one kind', 'several kinds', ...recipeNames])
  table('Broken samples per number of kinds', byKindCount, damagedSamples, ['1', '2', '3', '4'])
  table('Broken samples per number of edits', byEditCount, damagedSamples, ['0', '1', '2', '3', '4 to 9', '10 or more'])
  table('Broken samples per family (a sample counts once per family it has)', byFamily, damagedSamples, families)
  lines.push('', 'Broken samples per kind: samples that have the kind, their share, samples where it is the only kind, and train / validation / test')
  for (const kind of kinds) {
    const perSplit = byKindSplit.get(kind.name)
    lines.push(`  ${count(byKind.get(kind.name) ?? 0)} ${percent(byKind.get(kind.name) ?? 0, damagedSamples)}%  ${count(byKindAlone.get(kind.name) ?? 0)}  ${splits.map(split => String(perSplit?.get(split) ?? 0).padStart(6)).join(' ')}  ${kind.name} (${kind.family})${heldOutKinds.includes(kind.name) ? ', held out' : ''}`)
  }
  table('Samples per template', byTemplate, sampleCount)
  table('Samples per style', byStyle, sampleCount)

  lines.push('', 'Lengths in code points')
  lines.push(`  originals: ${quartiles(originalLengths)}`)
  lines.push(`  broken texts: ${quartiles(brokenLengths)}`)
  lines.push(`  originals in steps of 64: ${histogram(originalLengths, 64, 9).join(' ')}`)
  lines.push(`  broken texts in steps of 64: ${histogram(brokenLengths, 64, 9).join(' ')}`)
  lines.push('', 'Where the first damage sits, as a tenth of the broken text\'s length (the last column is "at the very end")')
  lines.push(`  ${histogram(relativeDamage, 0.1, 11).join(' ')}`)

  lines.push('', 'Headroom: what the parser as it is already gets right, over the labeled code points at or after the first damage.')
  lines.push('Columns: samples, samples with nothing to recover (no labeled code point from the damage on), then percentages of code points')
  lines.push('with all three right, the display kind right (of those whose display kind is scored), the depth right, the container right,')
  lines.push('and the percentage of samples with something to recover in which every code point is right.')
  lines.push('', `  ${headroomHeader}  group`)
  for (const key of [...headroomByGroup.keys()].sort()) lines.push(`  ${headroomLine(headroomByGroup.get(key)!)}  ${key}`)
  lines.push('', `  ${headroomHeader}  kind (every sample that has it)`)
  for (const kind of kinds) {
    const row = headroomByKind.get(kind.name)
    if (row !== undefined) lines.push(`  ${headroomLine(row)}  ${kind.name}`)
  }

  const allowed = cellsThatJsonAllows()
  const reachedAllowed = [...allowed].filter(cell => validCells.has(cell))
  lines.push('', 'The grammar table\'s cells that valid documents reach')
  lines.push(`  ${tables.grammarNext.length} cells. ${grammarErrorCells.length} lead into the error state from another state, ${tables.symbolCount} are the error state's own row.`)
  lines.push(`  Of the other ${tables.grammarNext.length - grammarErrorCells.length - tables.symbolCount}, valid JSON can reach ${allowed.size}: the rest need a context that no valid text has, e.g. an object as the innermost container at depth 0.`)
  lines.push(`  The originals reach ${reachedAllowed.length} of those ${allowed.size}.${reachedAllowed.length === allowed.size ? '' : ` Missing: ${[...allowed].filter(cell => !validCells.has(cell)).map(cell => grammarCellName(cell)).join(' ')}`}`)
  for (const split of splits) {
    const cells = validCellsBySplit.get(split) ?? new Set()
    lines.push(`  The originals of the ${split} split reach ${[...allowed].filter(cell => cells.has(cell)).length}.`)
  }
  const rarest = [...allowed].sort((left, right) => (validCells.get(left) ?? 0) - (validCells.get(right) ?? 0)).slice(0, 12)
  lines.push(`  The 12 least reached: ${rarest.map(cell => `${grammarCellName(cell)} ${validCells.get(cell) ?? 0}`).join(', ')}`)
  lines.push('  Reached per state and token, summed over contexts (rows: state before, columns: token):')
  lines.push(`  ${''.padEnd(13)}${tokenNames.map(name => name.slice(0, 10).padStart(11)).join('')}`)
  for (let state = 0; state < tables.grammarStateCount; state++) {
    if (state === tables.errorState) continue
    const row = tokenNames.map((_, token) => {
      let total = 0
      for (let context = 0; context < tables.contextCount; context++) total += validCells.get(state * tables.symbolCount + token * tables.contextCount + context) ?? 0
      return String(total).padStart(11)
    })
    lines.push(`  ${grammarStateNames[state]!.padEnd(13)}${row.join('')}`)
  }
  lines.push('  Reached per context:')
  for (let context = 0; context < tables.contextCount; context++) {
    let total = 0
    for (const [cell, cellCount] of validCells) if (cell % tables.contextCount === context) total += cellCount
    lines.push(`  ${count(total)}  ${contextNames[context]}`)
  }

  const coverage = (title: string, cells: readonly number[], reached: Map<number, number>, name: (cell: number) => string) => {
    const hit = cells.filter(cell => reached.has(cell))
    lines.push('', title)
    lines.push(`  ${hit.length} of ${cells.length} cells are reached at a first error, ${cells.length - hit.length} never.`)
    lines.push('  The 40 most reached, with the number of samples:')
    for (const cell of [...hit].sort((left, right) => reached.get(right)! - reached.get(left)!).slice(0, 40)) lines.push(`  ${count(reached.get(cell)!)}  ${name(cell)}`)
    lines.push(`  Reached by 1 to 4 samples: ${hit.filter(cell => reached.get(cell)! <= 4).length}. By 5 to 49: ${hit.filter(cell => reached.get(cell)! >= 5 && reached.get(cell)! < 50).length}. By 50 or more: ${hit.filter(cell => reached.get(cell)! >= 50).length}.`)
    lines.push(`  Never reached: ${cells.filter(cell => !reached.has(cell)).map(name).join(' ')}`)
  }
  coverage('The grammar table\'s error cells that the first error reaches', grammarErrorCells, grammarFirstError, cell => grammarCellName(cell))
  lines.push('  Reached per state and token, summed over contexts (rows: state before, columns: token):')
  lines.push(`  ${''.padEnd(13)}${tokenNames.map(name => name.slice(0, 10).padStart(11)).join('')}`)
  for (let state = 0; state < tables.grammarStateCount; state++) {
    if (state === tables.errorState) continue
    const row = tokenNames.map((_, token) => {
      let total = 0
      for (let context = 0; context < tables.contextCount; context++) total += grammarFirstError.get(state * tables.symbolCount + token * tables.contextCount + context) ?? 0
      return String(total).padStart(11)
    })
    lines.push(`  ${grammarStateNames[state]!.padEnd(13)}${row.join('')}`)
  }
  coverage('The tokenizer\'s error cells that the first error reaches (the first error is a tokenizer error)', lexerErrorCells, lexerFirstError, cell => lexerCellName(cell))
  lines.push(`  Tokenizer states: ${lexerStateNames.length}, character classes: ${classNames.length}.`)

  const repeated = [...brokenTexts].filter(([, times]) => times > 1)
  lines.push('', 'Duplicates and situations')
  lines.push(`  ${brokenTexts.size} distinct broken texts among ${damagedSamples}. ${repeated.length} occur more than once, ${repeated.reduce((total, [, times]) => total + times, 0)} samples in all.`)
  for (const [text, times] of repeated.sort((left, right) => right[1] - left[1]).slice(0, 12)) lines.push(`  ${count(times)}  ${JSON.stringify(text.length > 70 ? `${text.slice(0, 70)}…` : text)}`)
  lines.push(`  ${originals.size} distinct originals among ${sampleCount} samples.`)
  lines.push(`  ${situations.size} distinct situations at the first damaged code point (tokenizer state, character class, grammar state, context).`)
  lines.push(`  ${firstErrorSituations.size} distinct pairs of a tokenizer cell and a grammar cell at the first error of the parser as it is.`)
  return `${lines.join('\n')}\n`
}

if (import.meta.main) {
  const file = process.argv[2]
  if (file === undefined) throw new Error('usage: bun lab/recovery-parser/stats.ts <file> [samples] [seed]')
  const text = report(Number(process.argv[4] ?? defaultSeed), Number(process.argv[3] ?? 40_000))
  writeFileSync(file, text)
  console.log(text.split('\n').slice(0, 40).join('\n'))
  console.log(`… the whole report is in ${file}`)
}
