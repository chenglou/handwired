// Statistics of the dataset: what it holds, what the parser as it is and the hand-written settings of its tables
// already get right, and which cells of the tables the samples reach.
//
// Run from the repo root: bun lab/recovery-parser/stats.ts <file> [samples, default 40000] [seed]
// It writes the report to the file and prints its first lines.
import {writeFileSync} from 'node:fs'
import {displayKind} from '../../src/json-search/highlighter/kinds.ts'
import {contradictions, families, kinds, recipeNames} from './damage.ts'
import {type HandRule, handRuleTables, handRules} from './hand-rules.ts'
import type {Label} from './labels.ts'
import {cellsThatValidJsonReads} from './limits.ts'
import {type Sample, defaultSeed, groupOf, groups, heldOutKinds, heldOutTemplate, labelsOf, mostRightFor, sampleAt, sources, splitKeyOf, splits} from './samples.ts'
import {
  type ParserTables, type ParserTrace, classNames, containerNames, contextNames, defaultTables, eventNames, grammarCellName, grammarStateNames, isLexerErrorEvent,
  lexerCellName, lexerStateNames, positionCount, runTableParser, tokenNames,
} from './table-parser.ts'

const tables: ParserTables = defaultTables
const percent = (part: number, whole: number) => whole === 0 ? '    -' : `${(100 * part / whole).toFixed(1).padStart(5)}`
const count = (value: number) => String(value).padStart(7)

// The grammar table's cells that valid JSON can reach, found by walking the table itself from the start state over
// every depth and every kind of innermost container. Closing a container at depth 2 or more can lead back into an
// object or into an array, since a container may sit in either. `firstErrors` are the error cells next to that walk:
// the cells that some text reaches at its first grammar error, i.e. a state and a context that valid JSON reaches,
// with a token that leads into the error state.
function cellsThatJsonAllows() {
  const allowed = new Set<number>()
  const firstErrors = new Set<number>()
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
      const cell = state * tables.symbolCount + token(name) * tables.contextCount + context
      const next = tables.grammarNext[cell]!
      if (next === tables.errorState) {
        firstErrors.add(cell)
        continue
      }
      allowed.add(cell)
      if (name === 'openObject') queue.push([next, depth + 1, 1])
      else if (name === 'openArray') queue.push([next, depth + 1, 0])
      else if (name === 'closeObject' || name === 'closeArray') {
        if (depth - 1 === 0) queue.push([next, 0, 0])
        else queue.push([next, depth - 1, 0], [next, depth - 1, 1])
      } else queue.push([next, depth, inObject])
    }
  }
  return {allowed, firstErrors}
}

// The grammar cells that lead into the error state from another state, and the tokenizer cells whose event is an error.
const grammarErrorCells: number[] = []
for (let cell = 0; cell < tables.grammarNext.length; cell++) {
  if (tables.grammarNext[cell] === tables.errorState && Math.floor(cell / tables.symbolCount) !== tables.errorState) grammarErrorCells.push(cell)
}
const lexerErrorCells: number[] = []
for (let cell = 0; cell < tables.lexerEvent.length; cell++) if (isLexerErrorEvent(tables.lexerEvent[cell]!)) lexerErrorCells.push(cell)

// The readers that a score is given for: the parser as it is, and the hand-written settings of hand-rules.ts.
const readers = ['now', ...handRules] as const
type Reader = typeof readers[number]
const perReader = <Value>(make: (reader: Reader) => Value) => Object.fromEntries(readers.map(reader => [reader, make(reader)])) as Record<Reader, Value>
const readerTables = perReader((reader): ParserTables => reader === 'now' ? defaultTables : handRuleTables(reader))
const readerNotes: Record<Reader, string> = {
  now: 'the parser as it is, which shows everything after its first error as an error',
  stay: 'hand-rules.ts: a tokenizer error starts no error line, and a token that the grammar does not accept is ignored',
  resync: 'hand-rules.ts: as stay, and such a token moves the grammar to the state that follows it in valid JSON',
  words: 'hand-rules.ts: as resync, and a word where no token of JSON starts is read as a string, which the grammar shows as a key or a string',
  lines: 'hand-rules.ts: as words, with one more tokenizer state: after a string that a line feed ended, an opening brace at the very start of the next line does not open',
}
// The hand rule that the mean of the samples' own shares is printed for: the last one, which scores highest.
const lastRule: HandRule = handRules[handRules.length - 1]!

// What one reader gets right, over the code points that a score counts: those from the first error of the parser as
// it is on that have a label with a scored value.
type Score = {
  // Code points, and those where every scored value is right.
  scored: number, right: number
  // Per value: how many are scored, and how many of those are right.
  kindScored: number, kindRight: number, nestingScored: number, depthRight: number, containerRight: number
  // Code points whose label is key or string, and those shown as the label says.
  stringScored: number, stringRight: number
  // Samples with something to recover in which every code point is right, and the sum of the samples' own shares of
  // right code points.
  wholeRight: number, shareSum: number
}
const emptyScore = (): Score => ({scored: 0, right: 0, kindScored: 0, kindRight: 0, nestingScored: 0, depthRight: 0, containerRight: 0, stringScored: 0, stringRight: 0, wholeRight: 0, shareSum: 0})
// What two arms of the experiment can have right at most in a sample: the code points, and whether the whole sample.
// `grammar` is for an arm that changes only cells of the grammar table, `tokenizer` for an arm that also changes cells
// of the tokenizer's table, see `boundsOf`.
type Bounds = {grammarRight: number, grammarWhole: number, tokenizerRight: number, tokenizerWhole: number}
const emptyBounds = (): Bounds => ({grammarRight: 0, grammarWhole: 0, tokenizerRight: 0, tokenizerWhole: 0})
type Row = {samples: number, nothingToRecover: number, scores: Record<Reader, Score>, bounds: Bounds}
const emptyRow = (): Row => ({samples: 0, nothingToRecover: 0, scores: perReader(emptyScore), bounds: emptyBounds()})

// One sample's numbers for one reader, to be added to every row that the sample belongs to.
function scoreOf(sample: Sample, labels: readonly (Label | undefined)[], trace: ParserTrace): Score {
  const score = emptyScore()
  for (let position = sample.firstErrorPosition; position < labels.length; position++) {
    const label = labels[position]
    if (label === undefined || (label.kind === undefined && label.depth === undefined)) continue
    score.scored++
    const kindRight = label.kind === undefined || label.kind === trace.displayKind[position]
    const depthRight = label.depth === undefined || label.depth === trace.depthAfter[position]
    const containerRight = label.container === undefined || label.container === trace.containerAfter[position]
    if (label.kind !== undefined) {
      score.kindScored++
      if (kindRight) score.kindRight++
      if (label.kind === displayKind.key || label.kind === displayKind.string) {
        score.stringScored++
        if (kindRight) score.stringRight++
      }
    }
    if (label.depth !== undefined) {
      score.nestingScored++
      if (depthRight) score.depthRight++
      if (containerRight) score.containerRight++
    }
    if (kindRight && depthRight && containerRight) score.right++
  }
  if (score.scored > 0) {
    score.shareSum = score.right / score.scored
    if (score.right === score.scored) score.wholeRight = 1
  }
  return score
}
function addScores(row: Row, sampleScores: Record<Reader, Score>, sampleBounds: Bounds) {
  row.samples++
  if (sampleScores.now.scored === 0) row.nothingToRecover++
  for (const reader of readers) {
    const total = row.scores[reader]
    const one = sampleScores[reader]
    for (const key of Object.keys(total) as (keyof Score)[]) total[key] += one[key]
  }
  for (const key of Object.keys(row.bounds) as (keyof Bounds)[]) row.bounds[key] += sampleBounds[key]
}
const scoreHeader = `${'samples'.padStart(7)} ${'nothing'.padStart(7)}   ${readers.map(reader => `${reader.padStart(6)} ${'whole'.padStart(5)}`).join('   ')}   ${'mean'.padStart(5)}`
const scoreLine = (row: Row) => {
  const withSomething = row.samples - row.nothingToRecover
  const columns = readers.map(reader => `${percent(row.scores[reader].right, row.scores[reader].scored).padStart(6)} ${percent(row.scores[reader].wholeRight, withSomething)}`)
  return `${count(row.samples)} ${count(row.nothingToRecover)}   ${columns.join('   ')}   ${percent(row.scores[lastRule].shareSum, withSomething)}`
}
const valueLine = (row: Row, reader: Reader) => {
  const score = row.scores[reader]
  return `${percent(score.right, score.scored)} ${percent(score.kindRight, score.kindScored)} ${percent(score.stringRight, score.stringScored)} ${percent(score.depthRight, score.nestingScored)} ${percent(score.containerRight, score.nestingScored)}`
}

// Whether the first arm of the experiment, which changes only the grammar table's cells, can have a code point right:
// its depth and container are those of the parser as it is, and its display kind is that of the parser as it is,
// except that a code point of a string can be shown as a key or as a string.
const stringEvents = new Set(['stringStart', 'stringContent', 'stringEnd'].map(name => eventNames.indexOf(name as typeof eventNames[number])))
function grammarOnlyCanBeRight(label: Label, trace: ParserTrace, position: number) {
  if (label.depth !== undefined && (label.depth !== trace.depthAfter[position] || label.container !== trace.containerAfter[position])) return false
  if (label.kind === undefined || label.kind === trace.displayKind[position]) return true
  return stringEvents.has(trace.event[position]!) && (label.kind === displayKind.key || label.kind === displayKind.string)
}

// The two bounds of one sample. For the first arm every counted code point is looked at alone. For the second arm
// limits.ts looks for the one run of the loop that has the most counted code points right, under its two conditions.
function boundsOf(sample: Sample, labels: readonly (Label | undefined)[], trace: ParserTrace): Bounds {
  let counted = 0
  let grammarRight = 0
  for (let position = sample.firstErrorPosition; position < labels.length; position++) {
    const label = labels[position]
    if (label === undefined || (label.kind === undefined && label.depth === undefined)) continue
    counted++
    if (grammarOnlyCanBeRight(label, trace, position)) grammarRight++
  }
  const most = mostRightFor(sample, labels)
  if (most.counted !== counted) throw new Error(`stats.ts and limits.ts count other code points in the sample ${sample.id}`)
  if (most.right < grammarRight) throw new Error(`the bound of the second arm is below the bound of the first in the sample ${sample.id}`)
  return {grammarRight, grammarWhole: Number(counted > 0 && grammarRight === counted), tokenizerRight: most.right, tokenizerWhole: Number(counted > 0 && most.right === counted)}
}
const boundHeader = `${'points'.padStart(6)} ${'whole'.padStart(5)}   ${'points'.padStart(6)} ${'whole'.padStart(5)}`
const boundLine = (row: Row) => {
  const withSomething = row.samples - row.nothingToRecover
  const scored = row.scores.now.scored
  return `${percent(row.bounds.grammarRight, scored).padStart(6)} ${percent(row.bounds.grammarWhole, withSomething)}   ${percent(row.bounds.tokenizerRight, scored).padStart(6)} ${percent(row.bounds.tokenizerWhole, withSomething)}`
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

// What makes a sample one that training never sees, as one of four groups.
function heldOutGroupOf(sample: Sample) {
  const byKind = sample.heldOut.some(held => held.startsWith('kind'))
  const byTemplate = sample.heldOut.some(held => held.startsWith('template'))
  return byKind && byTemplate ? 'a held-out kind on the held-out template' : byKind ? 'a held-out kind on a template that training has'
    : byTemplate ? 'kinds that training has on the held-out template' : 'nothing held out'
}
const heldOutGroups = ['nothing held out', 'a held-out kind on a template that training has', 'kinds that training has on the held-out template', 'a held-out kind on the held-out template'] as const

export function report(seed: number, sampleCount: number): string {
  const lines: string[] = []
  const tally = (map: Map<string, number>, key: string, by = 1) => map.set(key, (map.get(key) ?? 0) + by)
  const bySource = new Map<string, number>()
  const byCarriageReturn = new Map<string, number>()
  const bySplit = new Map<string, number>()
  const byReachable = new Map<string, number>()
  const byGroup = new Map<string, number>()
  const byRecipe = new Map<string, number>()
  const byFamily = new Map<string, number>()
  const byKind = new Map<string, number>()
  const byKindAlone = new Map<string, number>()
  const byKindPart = new Map<string, Map<string, number>>()
  const byTemplate = new Map<string, number>()
  const byStyle = new Map<string, number>()
  const byHeldOut = new Map<string, number>()
  const byKindCount = new Map<string, number>()
  const byEditCount = new Map<string, number>()
  const byRule = new Map<string, number>()
  const byClass = new Map<string, number>()
  const heldOutKindOnOrder = new Map<string, [samples: number, onOrder: number]>()
  const originalLengths: number[] = []
  const brokenLengths: number[] = []
  const relativeDamage: number[] = []
  const rowsByKind = new Map<string, Row>()
  const rowsByKindAlone = new Map<string, Row>()
  const rowsByGroup = new Map<string, Row>()
  const grammarFirstError = new Map<number, number>()
  const lexerFirstError = new Map<number, number>()
  // Per hand rule and table: how many samples make the rule read each error cell somewhere in the text.
  const visited = Object.fromEntries(handRules.map(rule => [rule, {grammar: new Map<number, number>(), lexer: new Map<number, number>()}])) as Record<HandRule, {grammar: Map<number, number>, lexer: Map<number, number>}>
  const isGrammarErrorCell = new Set(grammarErrorCells)
  const isLexerErrorCell = new Set(lexerErrorCells)
  const validCells = new Map<number, number>()
  const validCellsBySplit = new Map<string, Set<number>>()
  const brokenTexts = new Map<string, number>()
  const originals = new Map<string, string>()
  const tokenSequences = new Map<string, Set<string>>()
  // Per template and split, and per held-out kind: how many samples have each sequence of tokens.
  const sequencesByTemplate = new Map<string, Map<string, Map<string, number>>>()
  const sequencesByHeldOutKind = new Map<string, Map<string, number>>()
  const situations = new Set<string>()
  const firstErrorSituations = new Set<string>()
  const familyOf = new Map(kinds.map(kind => [kind.name, kind.family]))
  let needsClass = 0
  let needsNestingFix = 0
  let needsDisplayFix = 0
  let debatable = 0
  let unscoredKinds = 0
  let unscoredNesting = 0
  let splitConflicts = 0
  let damagedSamples = 0
  // Texts of several documents: all of them, per split, and per split those whose records have more than one sequence.
  let severalDocuments = 0
  const severalBySplit = new Map<string, number>()
  const severalSequences = new Map<string, number>()
  // Labeled code points between the first damage and the first error, which no score counts: every arm gives them what
  // the parser as it is gives, and their labels are that or are not scored.
  let beforeFirstError = 0
  let beforeFirstErrorUnscored = 0
  // Over the scored code points: what a constant answer has right, and what the first arm can have right at most.
  const containerLabels = [0, 0, 0]
  const containerRightNow = [0, 0, 0]
  const depthLabels = new Map<number, number>()
  let shownAsErrorByTokenizer = 0

  for (let index = 0; index < sampleCount; index++) {
    const sample = sampleAt(seed, index)
    tally(bySource, sample.source)
    if (sample.lineEnd === '\r\n') tally(byCarriageReturn, sample.source)
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
      if (cells === undefined) validCellsBySplit.set(sample.split, cells = new Set<number>())
      for (let position = 0; position < positionCount; position++) {
        const cell = trace.grammarBefore[position]! * tables.symbolCount + trace.token[position]! * tables.contextCount + trace.context[position]!
        validCells.set(cell, (validCells.get(cell) ?? 0) + 1)
        cells.add(cell)
      }
    }
    // The sequences of tokens of the sample's documents, each alone: one for most samples, and one per record of a
    // text of several documents. The sample's shape is the list of its distinct sequences.
    let sequences = tokenSequences.get(sample.split)
    if (sequences === undefined) tokenSequences.set(sample.split, sequences = new Set<string>())
    const documentKeys = [...new Set(sample.documents.map(splitKeyOf))]
    for (const key of documentKeys) sequences.add(key)
    const splitKey = documentKeys.sort().join(' | ')
    if (sample.documents.length > 1) {
      severalDocuments++
      if (documentKeys.length > 1) severalSequences.set(sample.split, (severalSequences.get(sample.split) ?? 0) + 1)
      severalBySplit.set(sample.split, (severalBySplit.get(sample.split) ?? 0) + 1)
    }
    let perSplit = sequencesByTemplate.get(sample.template)
    if (perSplit === undefined) sequencesByTemplate.set(sample.template, perSplit = new Map<string, Map<string, number>>())
    let perSequence = perSplit.get(sample.split)
    if (perSequence === undefined) perSplit.set(sample.split, perSequence = new Map<string, number>())
    tally(perSequence, splitKey)
    for (const kind of sample.kinds) {
      if (!heldOutKinds.includes(kind)) continue
      let ofKind = sequencesByHeldOutKind.get(kind)
      if (ofKind === undefined) sequencesByHeldOutKind.set(kind, ofKind = new Map<string, number>())
      tally(ofKind, splitKey)
    }
    if (sample.source === 'valid') continue
    damagedSamples++
    tally(byReachable, sample.reachable)
    tally(byGroup, groupOf(sample))
    tally(byHeldOut, heldOutGroupOf(sample))
    tally(byKindCount, String(Math.min(sample.kinds.length, 4)))
    tally(byEditCount, sample.edits.length >= 10 ? '10 or more' : sample.edits.length >= 4 ? '4 to 9' : String(sample.edits.length))
    for (const family of new Set(sample.kinds.map(kind => familyOf.get(kind)!))) tally(byFamily, family)
    const part = sample.heldOut.length > 0 ? 'held out' : sample.split
    for (const kind of sample.kinds) {
      tally(byKind, kind)
      let perPart = byKindPart.get(kind)
      if (perPart === undefined) byKindPart.set(kind, perPart = new Map<string, number>())
      tally(perPart, part)
      if (heldOutKinds.includes(kind)) {
        const entry = heldOutKindOnOrder.get(kind) ?? [0, 0]
        entry[0]++
        if (sample.template === heldOutTemplate) entry[1]++
        heldOutKindOnOrder.set(kind, entry)
      }
    }
    if (sample.kinds.length === 1) tally(byKindAlone, sample.kinds[0]!)
    for (const rule of sample.needsRules) tally(byRule, rule)
    for (const need of sample.needsClass) tally(byClass, need)
    if (sample.needsClass.length > 0) needsClass++
    if (sample.needsNestingFix) needsNestingFix++
    if (sample.needsDisplayFix) needsDisplayFix++
    if (sample.debatable) debatable++
    unscoredKinds += sample.unscoredKinds.length
    unscoredNesting += sample.unscoredNesting.length
    relativeDamage.push(sample.firstDamage / Math.max(1, sample.alignment.length))
    tally(brokenTexts, sample.broken)

    const labels = labelsOf(sample)
    const traces = perReader(reader => runTableParser(sample.broken, readerTables[reader]))
    const trace = traces.now
    const sampleScores = perReader(reader => scoreOf(sample, labels, traces[reader]))
    const sampleBounds = boundsOf(sample, labels, trace)
    for (const rule of handRules) {
      if (sampleScores[rule].right > sampleBounds.tokenizerRight) throw new Error(`the hand rule ${rule} has more code points right than the bound of the second arm in the sample ${sample.id}`)
    }
    const addTo = (map: Map<string, Row>, key: string) => {
      let row = map.get(key)
      if (row === undefined) map.set(key, row = emptyRow())
      addScores(row, sampleScores, sampleBounds)
    }
    for (const kind of sample.kinds) addTo(rowsByKind, kind)
    if (sample.kinds.length === 1) addTo(rowsByKindAlone, sample.kinds[0]!)
    const layout = sample.broken.includes('\n') ? 'several lines' : 'one line'
    const group = groupOf(sample)
    addTo(rowsByGroup, 'every broken sample')
    addTo(rowsByGroup, `group: ${group}`)
    addTo(rowsByGroup, `group: ${group}, ${layout}`)
    addTo(rowsByGroup, `source: ${sample.source}`)
    addTo(rowsByGroup, `reachable: ${sample.reachable}`)
    addTo(rowsByGroup, `layout: ${layout}`)
    addTo(rowsByGroup, `split: ${sample.heldOut.length > 0 ? 'test, ' : `${sample.split}, `}${heldOutGroupOf(sample)}`)
    addTo(rowsByGroup, `kinds in the sample: ${Math.min(sample.kinds.length, 4)}${sample.kinds.length >= 4 ? ' or more' : ''}`)
    if (sample.debatable) addTo(rowsByGroup, 'another repair is sensible')
    if (sample.lineEnd === '\r\n') addTo(rowsByGroup, `line ends: a carriage return and a line feed, ${sample.documents.length > 1 ? 'several documents' : 'one document'}`)
    for (const rule of sample.needsRules) addTo(rowsByGroup, `rule: ${rule}`)
    if (sample.source === 'damage') addTo(rowsByGroup, `recipe: ${sample.recipe}`)

    for (let position = Math.max(0, sample.firstDamage); position < Math.min(sample.firstErrorPosition, labels.length); position++) {
      const label = labels[position]
      if (label === undefined) continue
      beforeFirstError++
      if (label.kind === undefined || label.depth === undefined) beforeFirstErrorUnscored++
    }
    for (let position = sample.firstErrorPosition; position < labels.length; position++) {
      const label = labels[position]
      if (label === undefined || (label.kind === undefined && label.depth === undefined)) continue
      if (label.container !== undefined) {
        containerLabels[label.container]!++
        if (label.container === trace.containerAfter[position]) containerRightNow[label.container]!++
        depthLabels.set(label.depth!, (depthLabels.get(label.depth!) ?? 0) + 1)
      }
      if (trace.displayKind[position] === displayKind.error) shownAsErrorByTokenizer++
    }

    // The error cells that each hand rule reads over the whole text, up to and with the cell after the last code point.
    for (const rule of handRules) {
      const ruleTrace = traces[rule]
      const grammarCells = new Set<number>()
      const lexerCells = new Set<number>()
      for (let at = 0; at <= ruleTrace.length; at++) {
        const grammarCell = ruleTrace.grammarBefore[at]! * tables.symbolCount + ruleTrace.token[at]! * tables.contextCount + ruleTrace.context[at]!
        if (isGrammarErrorCell.has(grammarCell)) grammarCells.add(grammarCell)
        const lexerCell = ruleTrace.lexerStateBefore[at]! * tables.classCount + ruleTrace.characterClass[at]!
        if (isLexerErrorCell.has(lexerCell)) lexerCells.add(lexerCell)
      }
      for (const cell of grammarCells) visited[rule].grammar.set(cell, (visited[rule].grammar.get(cell) ?? 0) + 1)
      for (const cell of lexerCells) visited[rule].lexer.set(cell, (visited[rule].lexer.get(cell) ?? 0) + 1)
    }

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
  lines.push(`  Lines that end with a carriage return and a line feed: ${sources.map(source => `${byCarriageReturn.get(source) ?? 0} ${source} samples`).join(', ')}.`)
  table('Samples per split', bySplit, sampleCount, splits)
  lines.push(`  ${splitConflicts} originals occur in two splits (must be 0).`)
  // A split key is a sequence of tokens, or for a document that is one scalar the token and the text, see splitKeyOf.
  // The documents are counted one by one, so a record of a text of several documents counts as a document.
  const sequencesOf = (split: string) => tokenSequences.get(split) ?? new Set<string>()
  const isLoneScalar = (key: string) => key.startsWith('s ') || key.startsWith('n ')
  const severalTokens = (split: string) => [...sequencesOf(split)].filter(key => !isLoneScalar(key))
  lines.push(`  ${severalTokens('train').length} distinct sequences of tokens among the documents of the train split, where each record of a text of several documents is a document.`)
  for (const split of ['validation', 'test']) {
    const shared = severalTokens(split).filter(sequence => sequencesOf('train').has(sequence)).length
    lines.push(`  ${severalTokens(split).length} distinct sequences of tokens among the documents of the ${split} split, ${shared} of them also in the train split (must be 0).`)
  }
  lines.push(`  ${severalDocuments} texts of several documents: ${splits.map(split => `${severalBySplit.get(split) ?? 0} in ${split}`).join(', ')}. Their records have more than one sequence in ${splits.map(split => `${severalSequences.get(split) ?? 0} texts of ${split}`).join(', ')}.`)
  const sharedScalars = ['validation', 'test'].flatMap(split => [...sequencesOf(split)].filter(key => isLoneScalar(key) && sequencesOf('train').has(key))).length
  lines.push(`  A document that is one string, number or literal has one token, so its text decides its split: ${splits.map(split => `${[...sequencesOf(split)].filter(isLoneScalar).length} such texts in ${split}`).join(', ')}, ${sharedScalars} of them in two splits (must be 0).`)
  lines.push('', 'Sequences of tokens per template and split: samples, distinct sequences, and the share of the samples that have the most frequent')
  lines.push('sequence. The test column holds the held-out samples too. A split with few sequences tests few shapes of document. For a text of')
  lines.push('several documents, the rows "records", what counts is the list of the distinct sequences of its records, whatever their number and order.')
  const describeSequences = (perSequence: Map<string, number> | undefined) => {
    if (perSequence === undefined) return `${'0'.padStart(6)} ${'0'.padStart(5)} ${'-'.padStart(4)} `
    const total = [...perSequence.values()].reduce((sum, value) => sum + value, 0)
    return `${String(total).padStart(6)} ${String(perSequence.size).padStart(5)} ${(100 * Math.max(...perSequence.values()) / total).toFixed(0).padStart(4)}%`
  }
  lines.push(`  ${splits.map(split => split.padStart(17)).join('  ')}  template`)
  for (const template of [...sequencesByTemplate.keys()].sort()) lines.push(`  ${splits.map(split => describeSequences(sequencesByTemplate.get(template)!.get(split))).join('  ')}  ${template}`)
  for (const kind of heldOutKinds) lines.push(`  ${' '.repeat(38)}${describeSequences(sequencesByHeldOutKind.get(kind))}  samples with the held-out kind ${kind}`)
  table(`Broken samples by what is held out (held-out kinds ${heldOutKinds.join(', ')}; held-out template ${heldOutTemplate}). All of them but the first group are in the test split`, byHeldOut, damagedSamples, heldOutGroups)
  for (const kind of heldOutKinds) {
    const [samples, onOrder] = heldOutKindOnOrder.get(kind) ?? [0, 0]
    lines.push(`  ${kind}: ${samples} samples, ${percent(onOrder, samples).trim()}% of them on the template ${heldOutTemplate}, which has ${percent(byTemplate.get(heldOutTemplate) ?? 0, sampleCount).trim()}% of all samples.`)
  }
  table('Broken samples per reachable flag', byReachable, damagedSamples, ['yes', 'line rule', 'no'])
  table('Broken samples per group, see `groups` in samples.ts: the first group in this order that fits', byGroup, damagedSamples, groups)
  lines.push(`  ${needsNestingFix} (${percent(needsNestingFix, damagedSamples).trim()}%) need a nesting fix, ${needsClass} (${percent(needsClass, damagedSamples).trim()}%) a character class, ${needsDisplayFix} (${percent(needsDisplayFix, damagedSamples).trim()}%) a display fix, whatever their group.`)
  lines.push(`  ${debatable} (${percent(debatable, damagedSamples).trim()}%) have another sensible repair. ${unscoredKinds} kept code points have a display kind that is not scored, ${unscoredNesting} a depth and a container that are not scored.`)
  table('What the samples that need a character class need', byClass, damagedSamples)
  lines.push('', 'Rules that exclude each other: the samples that need each side. No single parser labels the samples of both sides right.')
  for (const [left, right] of contradictions) lines.push(`  ${count(byRule.get(left) ?? 0)}  ${left}`, `  ${count(byRule.get(right) ?? 0)}  ${right}`, '')
  lines.pop()
  table('Broken samples per way of choosing the kinds', byRecipe, damagedSamples, ['typing', 'one kind', 'several kinds', ...recipeNames])
  table('Broken samples per number of kinds', byKindCount, damagedSamples, ['1', '2', '3', '4'])
  table('Broken samples per number of edits', byEditCount, damagedSamples, ['0', '1', '2', '3', '4 to 9', '10 or more'])
  table('Broken samples per family (a sample counts once per family it has)', byFamily, damagedSamples, families)
  lines.push('', 'Broken samples per kind: samples that have the kind, their share, samples where it is the only kind, and those in train / validation / test with nothing held out / held out')
  for (const kind of kinds) {
    const perPart = byKindPart.get(kind.name)
    lines.push(`  ${count(byKind.get(kind.name) ?? 0)} ${percent(byKind.get(kind.name) ?? 0, damagedSamples)}%  ${count(byKindAlone.get(kind.name) ?? 0)}  ${[...splits, 'held out'].map(part => String(perPart?.get(part) ?? 0).padStart(6)).join(' ')}  ${kind.name} (${kind.family})${heldOutKinds.includes(kind.name) ? ', held out' : ''}`)
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

  const everySample = rowsByGroup.get('every broken sample') ?? emptyRow()
  lines.push('', `Scores without training: what ${readers.length} readers already get right.`)
  for (const reader of readers) lines.push(`  ${reader.padEnd(7)} ${readerNotes[reader]}`)
  lines.push('A score counts the code points from the first error of the parser as it is on that have a label with a scored value.')
  lines.push(`Before that error every arm gives what the parser as it is gives: ${beforeFirstError} labeled code points lie between the first damage and the first error, ${beforeFirstErrorUnscored} of them with a value that is not scored.`)
  lines.push('Columns: samples, samples with nothing to recover (no scored code point), then per reader the percentage of code points with every scored')
  lines.push('value right and the percentage of samples with something to recover in which every code point is right, and last the mean over')
  lines.push(`those samples of each sample's own percentage of right code points, for ${lastRule}. A trained result is a gain only over the best hand rule.`)
  const groupOrder = (key: string) => {
    const prefixes = ['every broken sample', 'group: ', 'reachable: ', 'layout: ', 'line ends: ', 'source: ', 'split: ', 'kinds in the sample', 'another repair', 'rule: ', 'recipe: ']
    return prefixes.findIndex(prefix => key.startsWith(prefix))
  }
  lines.push('', `  ${scoreHeader}  group`)
  for (const key of [...rowsByGroup.keys()].sort((left, right) => groupOrder(left) - groupOrder(right) || left.localeCompare(right))) lines.push(`  ${scoreLine(rowsByGroup.get(key)!)}  ${key}`)
  lines.push('', 'Per value, in percent of the code points for which the value is scored: every value right, the display kind, the display kind of the')
  lines.push('code points labeled key or string, the depth, the container.')
  lines.push(`  ${'all'.padStart(5)} ${'kind'.padStart(5)} ${'k/s'.padStart(5)} ${'depth'.padStart(5)} ${'cont.'.padStart(5)}  reader, group`)
  for (const key of ['every broken sample', 'group: within reach of the tables', 'group: within reach of the tables, one line', 'group: within reach of the tables, several lines', 'layout: one line', 'layout: several lines']) {
    const row = rowsByGroup.get(key)
    if (row !== undefined) for (const reader of readers) lines.push(`  ${valueLine(row, reader)}  ${reader}, ${key}`)
  }
  const nowScore = everySample.scores.now
  const totalContainer = containerLabels.reduce((total, labels) => total + labels, 0)
  lines.push('', 'What an answer that reads nothing scores, over the same code points of every broken sample')
  lines.push(`  container: the labels are ${containerNames.map((name, container) => `${name} ${percent(containerLabels[container]!, totalContainer).trim()}%`).join(', ')}. The parser as it is has ${containerNames.map((name, container) => `${percent(containerRightNow[container]!, containerLabels[container]!).trim()}% of the ${name} labels`).join(', ')} right, ${percent(nowScore.containerRight, nowScore.nestingScored).trim()}% in all.`)
  const depthShares = [...depthLabels].sort((left, right) => right[1] - left[1])
  lines.push(`  depth: the most frequent labels are ${depthShares.slice(0, 4).map(([depth, labels]) => `${depth} with ${percent(labels, totalContainer).trim()}%`).join(', ')}. The parser as it is has ${percent(nowScore.depthRight, nowScore.nestingScored).trim()}% right.`)
  const read = cellsThatValidJsonReads()
  const readCount = (cells: Uint8Array) => cells.reduce((total, flag) => total + flag, 0)
  lines.push('', 'What two arms of the experiment can reach at most. Both run the loop of table-parser.ts and keep every cell that valid JSON')
  lines.push(`reads: ${readCount(read.tokenizer)} of the tokenizer's ${read.tokenizer.length} cells and ${readCount(read.grammar)} of the grammar's ${read.grammar.length}.`)
  lines.push('  grammar    An arm that changes only the other cells of the grammar table. The depth and the container are sums over the tokenizer\'s')
  lines.push('             events, which no grammar cell feeds, so they stay what the parser as it is gives, and a display kind can only change between')
  lines.push('             key and string on a code point of a string. The bound holds for every such table, with or without more grammar states.')
  lines.push('  tokenizer  An arm that also changes the other cells of the tokenizer\'s table, with or without more states. The classes, the events')
  lines.push('             and the display table are as they are. The bound holds for every such table: up to the first cell that valid JSON never')
  lines.push('             reads the tokenizer gives the events that it gives now, and after that cell the depth still moves by one level per code')
  lines.push('             point at most, at a code point that is shown as punctuation. conditionProblems(tables) of limits.ts says whether tables are')
  lines.push('             of this arm.')
  lines.push('Both are upper bounds and no estimates: a code point counts when some run of the loop has it right, whether or not one table gives')
  lines.push('that run in every sample, and whether or not the grammar can tell a key from a string there. For the second arm the bound is 100% in')
  lines.push('the group within reach by the group\'s definition, since needsNestingFix and needsDisplayFix are true exactly when it is below 100%.')
  lines.push('Columns: per arm the percentage of code points that can have every scored value right, and the percentage of samples with something')
  lines.push('to recover that can be right as a whole.')
  lines.push('', `  ${'grammar'.padStart(12)}   ${'tokenizer'.padStart(12)}`, `  ${boundHeader}  group`)
  for (const key of ['every broken sample', ...groups.map(group => `group: ${group}`), 'layout: one line', 'layout: several lines']) {
    const row = rowsByGroup.get(key)
    if (row !== undefined) lines.push(`  ${boundLine(row)}  ${key}`)
  }
  lines.push(`  The parser as it is has ${percent(nowScore.right, nowScore.scored).trim()}% of the code points right and shows ${percent(shownAsErrorByTokenizer, nowScore.scored).trim()}% as an error.`)

  const leftAbove = (row: Row) => {
    const best = Math.max(...handRules.map((rule: HandRule) => row.scores[rule].scored === 0 ? 0 : row.scores[rule].right / row.scores[rule].scored))
    return row.scores.now.scored === 0 ? '    -' : (100 * (1 - best)).toFixed(1).padStart(5)
  }
  for (const [title, rows] of [['kind (every sample that has it)', rowsByKind], ['kind (samples where it is the only kind)', rowsByKindAlone]] as const) {
    lines.push('', `  ${scoreHeader}  ${'left'.padStart(5)}  ${title}. "left" is what the best hand rule leaves, in percent of the code points`)
    for (const kind of kinds) {
      const row = rows.get(kind.name)
      if (row !== undefined) lines.push(`  ${scoreLine(row)}  ${leftAbove(row)}  ${kind.name}`)
    }
  }

  const {allowed, firstErrors} = cellsThatJsonAllows()
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

  const coverage = (title: string, cells: readonly number[], reached: Map<number, number>, name: (cell: number) => string, reachable: (cell: number) => boolean, why: string) => {
    const hit = cells.filter(cell => reached.has(cell))
    const possible = cells.filter(reachable)
    lines.push('', title)
    lines.push(`  ${hit.length} of ${cells.length} cells are reached at a first error, ${cells.length - hit.length} never.`)
    lines.push(`  ${possible.length} of the ${cells.length} can be the first error of some text within the capacity: ${why}. The samples reach ${possible.filter(cell => reached.has(cell)).length} of those ${possible.length}.`)
    lines.push('  The 40 most reached, with the number of samples:')
    for (const cell of [...hit].sort((left, right) => reached.get(right)! - reached.get(left)!).slice(0, 40)) lines.push(`  ${count(reached.get(cell)!)}  ${name(cell)}`)
    lines.push(`  Reached by 1 to 4 samples: ${hit.filter(cell => reached.get(cell)! <= 4).length}. By 5 to 49: ${hit.filter(cell => reached.get(cell)! >= 5 && reached.get(cell)! < 50).length}. By 50 or more: ${hit.filter(cell => reached.get(cell)! >= 50).length}.`)
    const neverReached = possible.filter(cell => !reached.has(cell))
    lines.push(`  Never reached, of those that can be: ${neverReached.length === 0 ? 'none' : neverReached.map(name).join(' ')}`)
  }
  // An opening bracket at depth 16 is the error tooDeep, which only a text deeper than 16 levels reaches, and the
  // samples stay within 16 levels.
  const tooDeep = (cell: number) => {
    const tokenName = tokenNames[Math.floor((cell % tables.symbolCount) / tables.contextCount)]
    return (tokenName === 'openObject' || tokenName === 'openArray') && cell % tables.contextCount >= 6 && grammarStateNames[Math.floor(cell / tables.symbolCount)]!.startsWith('value')
  }
  coverage('The grammar table\'s error cells that the first error reaches', grammarErrorCells, grammarFirstError, cell => grammarCellName(cell),
    cell => firstErrors.has(cell) && !tooDeep(cell), 'the others need a state and a context that no valid start of a text has, e.g. the state `end` inside a container, or are an opening bracket at depth 16, which the samples never have')
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
  // The state errorLine only follows an earlier error, and the class truncatedEnd only ends a text of more than 512 code points.
  coverage('The tokenizer\'s error cells that the first error reaches (the first error is a tokenizer error)', lexerErrorCells, lexerFirstError, cell => lexerCellName(cell),
    cell => lexerStateNames[Math.floor(cell / tables.classCount)] !== 'errorLine' && classNames[cell % tables.classCount] !== 'truncatedEnd',
    'the others are the row of the state errorLine, which only follows an earlier error, and the column of the class truncatedEnd, which only a text past the capacity has')
  lines.push(`  Tokenizer states: ${lexerStateNames.length}, character classes: ${classNames.length}.`)

  lines.push('', 'The error cells that a reader visits over whole texts. The two lists above count the cell of the first error only. A reader that')
  lines.push('goes on reads other error cells later in the text, and which ones depends on its tables, so the cells that get any signal in')
  lines.push('training are not the same for two arms. Per hand rule and table: the cells that some sample makes the rule read, of all error cells,')
  lines.push('how many samples reach a cell (a sample counts once per cell), and the samples that the rarest quarter of the visited cells has in all.')
  lines.push('The cells of the tokenizer state that the hand rule lines adds are not among the error cells, so they are not counted.')
  for (const rule of handRules) {
    for (const [name, cells, reached] of [['grammar table', grammarErrorCells, visited[rule].grammar], ['tokenizer table', lexerErrorCells, visited[rule].lexer]] as const) {
      const counts = [...reached.values()].sort((left, right) => left - right)
      const rarest = counts.slice(0, Math.ceil(counts.length / 4))
      lines.push(`  ${rule.padEnd(6)} ${name.padEnd(15)} ${String(counts.length).padStart(3)} of ${cells.length} cells. By 1 to 4 samples: ${counts.filter(value => value <= 4).length}, by 5 to 49: ${counts.filter(value => value >= 5 && value < 50).length}, by 50 or more: ${counts.filter(value => value >= 50).length}. Samples per cell: ${quartiles(counts)}. The rarest ${rarest.length} cells: ${rarest.reduce((total, value) => total + value, 0)} samples, at most ${rarest.at(-1) ?? 0} per cell.`)
    }
  }
  lines.push(`  At the first error of the parser as it is: ${grammarFirstError.size} cells of the grammar table and ${lexerFirstError.size} of the tokenizer's.`)

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
