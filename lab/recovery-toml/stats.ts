// Statistics of the dataset: what it holds, how the draws of edits went, what the parser as it is already gets
// right, and which cells of the tables the documents and the broken texts read.
//
// Run from the repo root: bun lab/recovery-toml/stats.ts <file> [samples, default 40000] [seed]
// It writes the report to the file and prints its first lines.
import {writeFileSync} from 'node:fs'
import {editCountWeights, families, kindNamed, kinds} from './damage.ts'
import {templates} from './documents.ts'
import {errorKinds} from './kinds.ts'
import {cellsThatValidTomlReads} from './limits.ts'
import {type Sample, defaultSeed, discardReasons, heldOutTemplates, labelsOf, mostRightFor, sampleAt, scoredCodePoints, splitKeyOf, splits} from './samples.ts'
import {type ParserTrace, classNames, defaultTables, eventNames, grammarCellName, grammarStateNames, lexerStateNames, runTableParser} from './table-parser.ts'

const tables = defaultTables
const percent = (part: number, whole: number) => whole === 0 ? '    -' : `${(100 * part / whole).toFixed(1).padStart(5)}`
const count = (value: number) => String(value).padStart(7)
const tally = (map: Map<string, number>, key: string, by = 1) => map.set(key, (map.get(key) ?? 0) + by)

// The quantiles of a list of numbers, as one line.
function spread(values: number[]) {
  if (values.length === 0) return 'none'
  const sorted = [...values].sort((left, right) => left - right)
  const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!
  const mean = sorted.reduce((total, value) => total + value, 0) / sorted.length
  const shown = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1)
  return `mean ${mean.toFixed(1)}, least ${shown(sorted[0]!)}, 10% ${shown(at(0.1))}, 25% ${shown(at(0.25))}, median ${shown(at(0.5))}, 75% ${shown(at(0.75))}, 90% ${shown(at(0.9))}, most ${shown(sorted.at(-1)!)}`
}

// The cells that a run of the parser reads up to a position that is left out: the tokenizer's, the grammar's, and
// the entries of the display table.
function markCells(trace: ParserTrace, upTo: number, read: {tokenizer: Uint8Array, grammar: Uint8Array, display: Uint8Array}) {
  for (let position = 0; position < upTo; position++) {
    read.tokenizer[trace.lexerStateBefore[position]! * tables.classCount + trace.characterClass[position]!] = 1
    read.grammar[trace.grammarBefore[position]! * tables.symbolCount + trace.token[position]! * tables.contextCount + trace.context[position]!] = 1
    read.display[trace.event[position]! * tables.grammarStateCount + trace.grammarAfter[position]!] = 1
  }
}
const newCells = () => ({tokenizer: new Uint8Array(tables.lexerEvent.length), grammar: new Uint8Array(tables.grammarNext.length), display: new Uint8Array(tables.display.length)})
const countOf = (mask: Uint8Array) => mask.reduce((total, bit) => total + bit, 0)

export function report(seed: number, sampleCount: number): string {
  const lines: string[] = []
  const bySplit = new Map<string, number>()
  const byTemplate = new Map<string, number>()
  const byTemplateAndSplit = new Map<string, number>()
  const byStyle = new Map<string, number>()
  const byEditCount = new Map<string, number>()
  const byEditCountAndSplit = new Map<string, number>()
  const byKind = new Map<string, number>()
  const byKindAlone = new Map<string, number>()
  const byFamily = new Map<string, number>()
  const byReason = new Map<string, number>()
  const byErrorKind = new Map<string, number>()
  const byGap = new Map<string, number>()
  const gapNames = ['0', '1 to 2', '3 to 5', '6 to 10', '11 to 20', '21 to 50', 'more than 50']
  const gapOf = (gap: number) => gap === 0 ? '0' : gap <= 2 ? '1 to 2' : gap <= 5 ? '3 to 5' : gap <= 10 ? '6 to 10' : gap <= 20 ? '11 to 20' : gap <= 50 ? '21 to 50' : 'more than 50'
  const gaps: number[] = []
  const gapsOfOneEdit: number[] = []
  const scoredCounts: number[] = []
  const scoredShares: number[] = []
  const originalLengths: number[] = []
  const brokenLengths: number[] = []
  const sequences = new Map<string, Map<string, Map<string, number>>>()
  const splitsOfSequence = new Map<string, Set<string>>()
  const brokenTextsOfTrain = new Set<string>()
  const documentCells = newCells()
  const trainDocumentCells = newCells()
  const firstErrorGrammarCells = new Map<number, number>()
  const firstErrorTokenizerCells = new Map<number, number>()
  const brokenCells = newCells()
  let discardedDraws = 0
  let addedCodePoints = 0
  let keptCodePoints = 0
  let unscoredKinds = 0
  let unscoredNesting = 0
  let labeledFromFirstError = 0
  let needsNestingFix = 0
  let boundRight = 0
  let boundCounted = 0
  let carriageReturns = 0
  let bunAcceptsBroken = 0
  let firstErrorAtEnd = 0
  // What the parser as it is has right, on the samples outside the test split.
  const now = {samples: 0, counted: 0, allThree: 0, kind: 0, kindCounted: 0, nesting: 0, nestingCounted: 0, whole: 0}
  const nowByEditCount = new Map<number, {samples: number, counted: number, allThree: number, whole: number}>()
  const validationSamples: Sample[] = []

  for (let index = 0; index < sampleCount; index++) {
    const sample = sampleAt(seed, index)
    const labels = labelsOf(sample)
    const trace = runTableParser(sample.broken)
    tally(bySplit, sample.split)
    tally(byTemplate, sample.template)
    tally(byTemplateAndSplit, `${sample.template} ${sample.split}`)
    tally(byStyle, sample.style)
    tally(byEditCount, String(sample.editCount))
    tally(byEditCountAndSplit, `${sample.editCount} ${sample.split}`)
    for (const kind of sample.kinds) tally(byKind, kind)
    if (sample.editCount === 1) tally(byKindAlone, sample.kinds[0]!)
    for (const family of new Set(sample.kinds.map(kind => kindNamed(kind).family))) tally(byFamily, family)
    for (const reason of sample.discarded) tally(byReason, reason)
    discardedDraws += sample.discarded.length
    tally(byErrorKind, errorKinds[sample.firstErrorKind]!)
    const gap = sample.firstErrorPosition - sample.firstDamage
    gaps.push(gap)
    if (sample.editCount === 1) gapsOfOneEdit.push(gap)
    tally(byGap, gapOf(gap))
    const scored = scoredCodePoints(sample, labels)
    scoredCounts.push(scored)
    scoredShares.push(100 * scored / sample.alignment.length)
    originalLengths.push(Array.from(sample.original).length)
    brokenLengths.push(sample.alignment.length)
    if (sample.firstErrorPosition >= sample.alignment.length) firstErrorAtEnd++
    for (let position = 0; position < labels.length; position++) {
      const label = labels[position]
      if (label === undefined) addedCodePoints++
      else keptCodePoints++
      if (label !== undefined && position >= sample.firstErrorPosition) {
        labeledFromFirstError++
        if (label.kind === undefined) unscoredKinds++
        if (label.depth === undefined) unscoredNesting++
      }
    }
    if (sample.needsNestingFix) needsNestingFix++
    const bound = mostRightFor(sample, labels)
    boundRight += bound.right
    boundCounted += bound.counted
    if (sample.lineEnd === '\r\n') carriageReturns++
    try {
      Bun.TOML.parse(sample.broken)
      bunAcceptsBroken++
    } catch {}

    // The sequences of tokens, per template and split.
    const sequence = splitKeyOf(sample.original)
    const perSplit = sequences.get(sample.template) ?? new Map<string, Map<string, number>>()
    sequences.set(sample.template, perSplit)
    const perSequence = perSplit.get(sample.split) ?? new Map<string, number>()
    perSplit.set(sample.split, perSequence)
    tally(perSequence, sequence)
    const found = splitsOfSequence.get(sequence) ?? new Set<string>()
    splitsOfSequence.set(sequence, found)
    found.add(sample.split)

    // The cells: of the document, of the first error, and of the whole broken text as the parser as it is reads it.
    const originalTrace = runTableParser(sample.original)
    markCells(originalTrace, originalTrace.length + 1, documentCells)
    if (sample.split === 'train') markCells(originalTrace, originalTrace.length + 1, trainDocumentCells)
    if (sample.split !== 'test') {
      const at = sample.firstErrorPosition
      const grammarCell = trace.grammarBefore[at]! * tables.symbolCount + trace.token[at]! * tables.contextCount + trace.context[at]!
      firstErrorGrammarCells.set(grammarCell, (firstErrorGrammarCells.get(grammarCell) ?? 0) + 1)
      const tokenizerCell = trace.lexerStateBefore[at]! * tables.classCount + trace.characterClass[at]!
      firstErrorTokenizerCells.set(tokenizerCell, (firstErrorTokenizerCells.get(tokenizerCell) ?? 0) + 1)
      markCells(trace, trace.length + 1, brokenCells)
    }

    if (sample.split === 'train') brokenTextsOfTrain.add(sample.broken)
    if (sample.split === 'validation') validationSamples.push(sample)
    if (sample.split === 'test') continue
    now.samples++
    const perEditCount = nowByEditCount.get(sample.editCount) ?? {samples: 0, counted: 0, allThree: 0, whole: 0}
    nowByEditCount.set(sample.editCount, perEditCount)
    perEditCount.samples++
    let everyOneRight = true
    for (let position = sample.firstErrorPosition; position < labels.length; position++) {
      const label = labels[position]
      if (label === undefined || (label.kind === undefined && label.depth === undefined)) continue
      const kindRight = label.kind === undefined || label.kind === trace.displayKind[position]
      const nestingRight = label.depth === undefined || (label.depth === trace.depthAfter[position] && label.container === trace.containerAfter[position])
      now.counted++
      perEditCount.counted++
      if (label.kind !== undefined) {
        now.kindCounted++
        if (kindRight) now.kind++
      }
      if (label.depth !== undefined) {
        now.nestingCounted++
        if (nestingRight) now.nesting++
      }
      if (kindRight && nestingRight) {
        now.allThree++
        perEditCount.allThree++
      } else everyOneRight = false
    }
    if (everyOneRight) {
      now.whole++
      perEditCount.whole++
    }
  }

  const rows = (title: string, map: Map<string, number>, names: readonly string[], whole = sampleCount) => {
    lines.push('', title)
    for (const name of names) lines.push(`  ${name.padEnd(46)}${count(map.get(name) ?? 0)}  ${percent(map.get(name) ?? 0, whole)}%`)
  }

  lines.push(`The first ${sampleCount} samples of seed ${seed}. Every sample is a damaged document.`)
  rows('Samples per split', bySplit, splits)
  const heldOutCount = heldOutTemplates.reduce((total, template) => total + (byTemplate.get(template) ?? 0), 0)
  lines.push(`  of the test split, ${heldOutCount} samples (${percent(heldOutCount, bySplit.get('test') ?? 0).trim()}%) are of the held-out templates ${heldOutTemplates.join(' and ')}`)

  lines.push('', 'Samples per template: all, train, validation, test, and per split the distinct sequences of tokens with the share of the samples that have the most frequent one')
  for (const template of templates) {
    const perSplit = splits.map(split => {
      const perSequence = sequences.get(template)?.get(split)
      if (perSequence === undefined) return '       0'
      const samples = [...perSequence.values()].reduce((total, value) => total + value, 0)
      return `${count(samples)} (${perSequence.size} sequences, ${percent(Math.max(...perSequence.values()), samples).trim()}%)`
    })
    lines.push(`  ${template.padEnd(18)}${count(byTemplate.get(template) ?? 0)}  ${perSplit.join('  ')}${heldOutTemplates.includes(template) ? '  held out' : ''}`)
  }
  const inTwoSplits = [...splitsOfSequence.values()].filter(found => found.size > 1).length
  lines.push(`  ${splitsOfSequence.size} distinct sequences of tokens, ${inTwoSplits} of them in two splits`)
  rows('Samples per style', byStyle, [...byStyle.keys()].sort())
  lines.push(`  ${carriageReturns} samples (${percent(carriageReturns, sampleCount).trim()}%) have lines that end with a carriage return and a line feed`)

  lines.push('', 'Samples by number of edits: the samples, their share, and the share that the draw gives before any draw is thrown away')
  for (const [editCount, probability] of editCountWeights) {
    lines.push(`  ${String(editCount).padEnd(4)}${count(byEditCount.get(String(editCount)) ?? 0)}  ${percent(byEditCount.get(String(editCount)) ?? 0, sampleCount)}%   drawn ${(100 * probability).toFixed(0)}%   ${splits.map(split => `${split} ${byEditCountAndSplit.get(`${editCount} ${split}`) ?? 0}`).join(', ')}`)
  }
  lines.push('', 'Samples per kind of edit: the samples that have the kind, their share, and the samples whose one edit is of the kind')
  for (const kind of kinds) lines.push(`  ${kind.name.padEnd(20)}${count(byKind.get(kind.name) ?? 0)}  ${percent(byKind.get(kind.name) ?? 0, sampleCount)}%  ${count(byKindAlone.get(kind.name) ?? 0)}`)
  rows('Samples per family of edits', byFamily, families)

  const draws = sampleCount + discardedDraws
  lines.push('', `Draws of edits: ${draws}, of which ${sampleCount} gave a sample and ${discardedDraws} were thrown away (${percent(discardedDraws, draws).trim()}%), ${(draws / sampleCount).toFixed(2)} draws per sample`)
  for (const reason of discardReasons) lines.push(`  ${reason.padEnd(46)}${count(byReason.get(reason) ?? 0)}  ${percent(byReason.get(reason) ?? 0, draws)}% of the draws`)

  lines.push('', 'Lengths in code points')
  lines.push(`  original: ${spread(originalLengths)}`)
  lines.push(`  broken:   ${spread(brokenLengths)}`)
  lines.push(`  ${keptCodePoints} code points of the broken texts are kept and ${addedCodePoints} are added (${percent(addedCodePoints, keptCodePoints + addedCodePoints).trim()}%)`)
  lines.push('', 'Scored code points per sample, i.e. those from the first error on with a scored value')
  lines.push(`  ${spread(scoredCounts)}`)
  lines.push(`  as a share of the broken text, in percent: ${spread(scoredShares)}`)
  lines.push(`  total ${scoredCounts.reduce((total, value) => total + value, 0)}. Of the ${labeledFromFirstError} kept code points from the first error on, ${unscoredKinds} have a display kind that is not scored and ${unscoredNesting} (${percent(unscoredNesting, labeledFromFirstError).trim()}%) a depth and a container that are not scored`)

  lines.push('', 'How far the first error lies after the first damaged code point, in code points')
  lines.push(`  all samples:           ${spread(gaps)}`)
  lines.push(`  samples with one edit: ${spread(gapsOfOneEdit)}`)
  for (const name of gapNames) lines.push(`  ${name.padEnd(14)}${count(byGap.get(name) ?? 0)}  ${percent(byGap.get(name) ?? 0, sampleCount)}%`)
  lines.push(`  ${firstErrorAtEnd} samples have their first error at the end of the text`)
  rows('The kind of the first error', byErrorKind, errorKinds.filter(name => byErrorKind.has(name)))

  lines.push('', `What the parser as it is has right, on the ${now.samples} samples outside the test split`)
  lines.push(`  display kind, depth and container right: ${percent(now.allThree, now.counted).trim()}% of ${now.counted} scored code points`)
  lines.push(`  display kind right: ${percent(now.kind, now.kindCounted).trim()}%, depth and container right: ${percent(now.nesting, now.nestingCounted).trim()}%`)
  lines.push(`  samples with every scored code point right: ${percent(now.whole, now.samples).trim()}%`)
  for (const [editCount] of editCountWeights) {
    const perEditCount = nowByEditCount.get(editCount)
    if (perEditCount !== undefined) lines.push(`  ${editCount} edit${editCount === 1 ? '' : 's'}: ${percent(perEditCount.allThree, perEditCount.counted).trim()}% of the code points, ${percent(perEditCount.whole, perEditCount.samples).trim()}% of the samples`)
  }
  lines.push(`  ${needsNestingFix} samples (${percent(needsNestingFix, sampleCount).trim()}%) have a scored depth that the loop cannot reach, and the loop can have at most ${boundRight} of ${boundCounted} scored code points right (${(100 * boundRight / boundCounted).toFixed(2)}%), see limits.ts`)
  lines.push(`  ${bunAcceptsBroken} broken texts are accepted by Bun's parser, which reads TOML 1.1`)
  const shared = validationSamples.filter(sample => brokenTextsOfTrain.has(sample.broken)).length
  lines.push(`  ${shared} validation samples have the broken text of a train sample`)

  // The cells.
  const readable = cellsThatValidTomlReads()
  const tableNames = [['tokenizer', 'tokenizer cells'], ['grammar', 'grammar cells'], ['display', 'display entries']] as const
  lines.push('', 'Cells that a valid text can read, and how many of them the documents of the samples read (all documents, and the documents of the train split)')
  for (const [key, name] of tableNames) {
    const all = readable[key].reduce((total, bit, cell) => total + (bit & documentCells[key][cell]!), 0)
    const train = readable[key].reduce((total, bit, cell) => total + (bit & trainDocumentCells[key][cell]!), 0)
    const outside = documentCells[key].reduce((total, bit, cell) => total + (bit & (1 - readable[key][cell]!)), 0)
    lines.push(`  ${name.padEnd(16)} ${countOf(readable[key])} can be read, the documents read ${all} (${percent(all, countOf(readable[key])).trim()}%), the train documents ${train}${outside > 0 ? `, and ${outside} cells that no valid text should read` : ''}`)
  }
  lines.push('', 'Grammar cells that a valid text can read and no document reads')
  for (let cell = 0; cell < readable.grammar.length; cell++) if (readable.grammar[cell] === 1 && documentCells.grammar[cell] === 0) lines.push(`  ${grammarCellName(cell)}`)
  lines.push('', 'Display entries that a valid text can read and no document reads')
  for (let entry = 0; entry < readable.display.length; entry++) {
    if (readable.display[entry] === 1 && documentCells.display[entry] === 0) lines.push(`  (${eventNames[Math.floor(entry / tables.grammarStateCount)]}, ${grammarStateNames[entry % tables.grammarStateCount]})`)
  }
  lines.push('', 'Tokenizer cells that a valid text can read, per tokenizer state: how many, how many the documents read, and the classes of the cells that no document reads')
  lexerStateNames.forEach((state, stateIndex) => {
    const unread: string[] = []
    let can = 0
    for (let characterClass = 0; characterClass < tables.classCount; characterClass++) {
      const cell = stateIndex * tables.classCount + characterClass
      if (readable.tokenizer[cell] !== 1) continue
      can++
      if (documentCells.tokenizer[cell] === 0) unread.push(classNames[characterClass]!)
    }
    if (can > 0) lines.push(`  ${state.padEnd(26)}${String(can).padStart(3)} ${String(can - unread.length).padStart(3)}  ${unread.join(' ')}`)
  })

  const openGrammar = tables.grammarNext.length - countOf(readable.grammar)
  const openTokenizer = tables.lexerEvent.length - countOf(readable.tokenizer)
  const openRead = (key: 'tokenizer' | 'grammar') => brokenCells[key].reduce((total, bit, cell) => total + (bit & (1 - readable[key][cell]!)), 0)
  lines.push('', 'Cells that no valid text reads, and how many of them the broken texts outside the test split read')
  lines.push(`  at the first error: ${firstErrorGrammarCells.size} of the ${openGrammar} such grammar cells, with ${new Set([...firstErrorTokenizerCells.keys()].filter(cell => readable.tokenizer[cell] !== 1)).size} of the ${openTokenizer} such tokenizer cells`)
  lines.push(`  anywhere, as the parser as it is reads the text: ${openRead('grammar')} grammar cells and ${openRead('tokenizer')} tokenizer cells. Tables that recover read other cells after the first error, so these counts say little about them.`)
  lines.push('', 'The grammar cells of the first error with the most samples')
  for (const [cell, samples] of [...firstErrorGrammarCells].sort((left, right) => right[1] - left[1]).slice(0, 25)) lines.push(`  ${count(samples)}  ${grammarCellName(cell)}`)
  return lines.join('\n')
}

if (import.meta.main) {
  const file = process.argv[2]
  if (file === undefined) throw new Error('usage: bun lab/recovery-toml/stats.ts <file> [samples] [seed]')
  const sampleCount = Number(process.argv[3] ?? 40_000)
  const seed = Number(process.argv[4] ?? defaultSeed)
  const text = report(seed, sampleCount)
  writeFileSync(file, `${text}\n`)
  console.log(text.split('\n').slice(0, 70).join('\n'))
  console.log(`… the whole report is in ${file}`)
}
