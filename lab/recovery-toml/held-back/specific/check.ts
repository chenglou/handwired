// Checks the held-back set of mistakes that people make in TOML, and prints its numbers.
//
// Run from the repo root: bun lab/recovery-toml/held-back/specific/check.ts [samples] [samples per kind] [seed]
// By default the 3,000 samples of the default seed that a final scoring takes, and 60 samples of each kind alone.
//
// What it checks:
// - Every kind's example in its definition: the text that the author meant is valid for the tables, for the reference
//   and for Bun's parser, the tables reject the broken text, and the kind makes that broken text of that valid text in
//   one of 4,000 draws.
// - Every sample, with a second derivation that shares no code with samples.ts beyond the edits: the edits give the
//   broken text and the alignment, in the canonical form. A kept code point is the code point of its counterpart, and
//   one that stands for another is of a pair that the rules allow, e.g. a colon for the equals sign. Every scored
//   value of a label is what the tables give the counterpart in the document, where the set takes it from the
//   reference. The depth and the container are left unscored by the two rules of unscoredOf that read no kind, and
//   by nothing else.
// - Every broken text is invalid for the tables and for the reference, has at most 512 code points and 16 levels, and
//   has a code point to score. The first error is where the tables report it, at or after the first damage.
// - Every document is valid for the tables, the reference and Bun's parser, is in the test split, and comes from a
//   template that the set uses. No document and no sequence of tokens of a sample is in the train or the validation
//   split of the dataset's first 20,000 samples.
// - A sample is the same when it is made twice.
// - No file of lab/recovery-toml/ outside held-back/ names the folder in an import.
// - The loader of the machinery, samplesOf of ../../learn/data.ts, takes the set as labeledTexts gives it, and counts
//   the same scored code points. The loader has checks of its own, e.g. that a scored depth is the one that the
//   tables give the counterpart.
// - README.md holds the two tables of the kinds as table.ts makes them from the kinds' definitions.
// - score.ts, which runs the exact parser of ../../learn/, counts for the parser as it is what this file counts with
//   the plain table parser: the samples, the scored code points, the right ones and the whole samples, in the row
//   "all" and in the row of every kind.
//
// With --markdown as the last argument, it also prints the table of numbers per kind that README.md holds.
import {readFileSync, readdirSync} from 'node:fs'
import {join, relative} from 'node:path'
import {applyEdits, canonicalEdits, mergeEdits} from '../../edits.ts'
import {capacity, displayKind, errorKinds, maximumDepth} from '../../kinds.ts'
import {samplesOf} from '../../learn/data.ts'
import {createRandom} from '../../random.ts'
import {labelReference} from '../../reference.ts'
import {defaultSeed as datasetSeed, sampleAt as datasetSampleAt} from '../../samples.ts'
import {splitKeyOf, splitOf} from '../../splits.ts'
import {runTableParser} from '../../table-parser.ts'
import {parserAsItIs} from '../parsers.ts'
import {type KindDefinition, kinds} from './mistakes.ts'
import {type Sample, defaultSeed, groupOf, groups, heldOutTemplates, labeledTexts, labelsOf, sampleAt, scoredCodePoints, standardCount, usedTemplates} from './samples.ts'
import {scan} from './scan.ts'
import {scoreWith} from './score.ts'
import {kindsTable, reachTable} from './table.ts'

const numbers = process.argv.slice(2).filter(argument => argument !== '--markdown').map(Number)
const sampleCount = numbers[0] ?? standardCount
const perKind = numbers[1] ?? 60
const seed = numbers[2] ?? defaultSeed

const problems: string[] = []
const problem = (text: string) => {
  if (problems.length < 40) console.log(`PROBLEM: ${text}`)
  problems.push(text)
}

const bunAccepts = (text: string) => {
  try {
    Bun.TOML.parse(text)
  } catch {
    return false
  }
  return true
}
const validEverywhere = (text: string) => runTableParser(text).valid && labelReference(text).valid && bunAccepts(text)

// A code point of the broken text may stand for a code point of the document in these pairs only, as in the written
// set: a quote of any sort for a quote, a colon for the equals sign, and white space for a space or a tab.
const quotes = '"\'“”‘’'
const whiteSpace = ' \t\n\u00a0'
const mayStandFor = (broken: string, original: string) => (quotes.includes(broken) && (original === '"' || original === '\'')) || (broken === ':' && original === '=') || (whiteSpace.includes(broken) && ' \t'.includes(original))

// Whether a kind makes its example of the text that the example's author meant, in one of 4,000 draws.
function makesItsExample(kind: KindDefinition) {
  const scanned = scan(kind.meant)
  for (let draw = 0; draw < 4000; draw++) {
    const mistake = kind.apply(createRandom(7, draw), scanned)
    if (mistake === undefined) continue
    const merged = mergeEdits([mistake.edits], scanned.codePoints.length)
    if (merged !== undefined && applyEdits(scanned.codePoints, canonicalEdits(scanned.codePoints, merged)).broken === kind.example) return true
  }
  return false
}

// The numbers of a row of samples: how many, the flags, the scored code points of each, and how the parser as it is
// does on them. `kindUnscored` counts the kept code points from the first error on whose display kind is not scored.
type Row = {
  samples: number, alone: number, heldOut: number, reachable: Record<string, number>, needsClass: number, scored: number[], kindUnscored: number, errorDistance: number,
  asItIsRight: number, asItIsWhole: number,
}
const newRow = (): Row => ({samples: 0, alone: 0, heldOut: 0, reachable: {yes: 0, 'line rule': 0, no: 0}, needsClass: 0, scored: [], kindUnscored: 0, errorDistance: 0, asItIsRight: 0, asItIsWhole: 0})
const drawnRows = new Map<string, Row>(kinds.map(kind => [kind.name, newRow()]))
const drawnTotal = newRow()
const aloneRows = new Map<string, Row>(kinds.map(kind => [kind.name, newRow()]))

const tokenSequences = new Set<string>()
const documents = new Set<string>()
let checked = 0

function checkSample(sample: Sample, rows: readonly Row[]) {
  const where = `${sample.id} (${sample.kinds.join(', ')})`
  const original = Array.from(sample.original)
  const broken = Array.from(sample.broken)

  // The document.
  if (!validEverywhere(sample.original)) problem(`${where}: the document is not valid for the tables, the reference and Bun's parser`)
  if (splitOf(sample.original) !== 'test') problem(`${where}: the document is in the split ${splitOf(sample.original)}`)
  if (!usedTemplates.includes(sample.template)) problem(`${where}: the template ${sample.template} is not one of the set`)
  if ((sample.heldOut.length > 0) !== heldOutTemplates.includes(sample.template)) problem(`${where}: heldOut does not fit the template ${sample.template}`)
  if (original.length > capacity || broken.length > capacity) problem(`${where}: a text is longer than ${capacity} code points`)
  tokenSequences.add(splitKeyOf(sample.original))
  documents.add(sample.original)

  // The edits and the alignment.
  const applied = applyEdits(original, sample.edits)
  if (applied.broken !== sample.broken) problem(`${where}: the edits do not give the broken text`)
  if (applied.alignment.join() !== sample.alignment.join() || applied.replaced.join() !== sample.replaced.join()) problem(`${where}: the edits do not give the alignment`)
  if (JSON.stringify(canonicalEdits(original, sample.edits)) !== JSON.stringify(sample.edits)) problem(`${where}: the edits are not in the canonical form`)
  let previous = -1
  let firstDamage = -1
  sample.alignment.forEach((index, position) => {
    if (firstDamage === -1 && (index !== position || sample.replaced[position] === true)) firstDamage = position
    if (index === -1) return
    if (index <= previous) problem(`${where}: the alignment goes back at ${position}`)
    previous = index
    const same = broken[position] === original[index]
    if (sample.replaced[position] === true ? same || !mayStandFor(broken[position]!, original[index]!) : !same) {
      problem(`${where}: at ${position}, ${JSON.stringify(broken[position])} is ${sample.replaced[position] === true ? 'said to stand for' : 'kept as'} ${JSON.stringify(original[index])}`)
    }
  })
  if (firstDamage === -1) firstDamage = broken.length
  if (firstDamage !== sample.firstDamage) problem(`${where}: the first damage is at ${firstDamage}, and the sample says ${sample.firstDamage}`)

  // The broken text.
  const trace = runTableParser(sample.broken)
  if (trace.valid) problem(`${where}: the tables accept the broken text`)
  if (labelReference(sample.broken).valid) problem(`${where}: the reference accepts the broken text`)
  if (trace.firstErrorPosition !== sample.firstErrorPosition || trace.firstErrorKind !== sample.firstErrorKind) problem(`${where}: the first error is at ${trace.firstErrorPosition} (${errorKinds[trace.firstErrorKind]}), and the sample says ${sample.firstErrorPosition}`)
  if (sample.firstErrorPosition < sample.firstDamage) problem(`${where}: the first error at ${sample.firstErrorPosition} is before the first damage at ${sample.firstDamage}`)
  for (let position = 0; position < trace.length; position++) {
    if (trace.depthAfter[position]! > maximumDepth) {
      problem(`${where}: the broken text is deeper than ${maximumDepth} levels`)
      break
    }
  }

  // The labels, against what the tables give the document.
  const labels = labelsOf(sample)
  const documentTrace = runTableParser(sample.original)
  const unscoredKinds = new Set(sample.unscoredKinds)
  const unscoredNesting = new Set(sample.unscoredNesting)
  // The two rules that leave a depth unscored, derived again: before the first error, a value that the parser as it
  // is does not give, and from a code point where the depth or the container changes without a bracket to the next
  // kept bracket.
  let previousDepth = 0
  let previousContainer = 0
  let afterRemovedBracket = false
  let kindUnscored = 0
  let asItIsRight = 0
  sample.alignment.forEach((index, position) => {
    const label = labels[position]
    if ((index === -1) !== (label === undefined)) problem(`${where}: at ${position}, a code point ${index === -1 ? 'that was added has a label' : 'that was kept has no label'}`)
    if (index === -1 || label === undefined) return
    const kind = documentTrace.displayKind[index]!
    const depth = documentTrace.depthAfter[index]!
    const container = documentTrace.containerAfter[index]!
    if (label.kind !== undefined && label.kind !== kind) problem(`${where}: at ${position}, the label's display kind is ${label.kind} and the tables give the counterpart ${kind}`)
    if ((label.depth === undefined) !== (label.container === undefined)) problem(`${where}: at ${position}, the depth and the container are not scored together`)
    if (label.depth !== undefined && (label.depth !== depth || label.container !== container)) problem(`${where}: at ${position}, the label's depth or container is not what the tables give the counterpart`)
    if ((label.kind === undefined) !== unscoredKinds.has(index) || (label.depth === undefined) !== unscoredNesting.has(index)) problem(`${where}: at ${position}, the label does not fit unscoredKinds and unscoredNesting`)

    const beforeFirstError = position >= sample.firstDamage && position < sample.firstErrorPosition
    const isBracket = kind === displayKind.punctuation && '{}[]'.includes(original[index]!)
    if (isBracket) afterRemovedBracket = false
    else if (depth !== previousDepth || container !== previousContainer) afterRemovedBracket = true
    previousDepth = depth
    previousContainer = container
    const nestingUnscored = afterRemovedBracket || (beforeFirstError && (depth !== trace.depthAfter[position] || container !== trace.containerAfter[position]))
    if (nestingUnscored !== (label.depth === undefined)) problem(`${where}: at ${position}, the depth is ${label.depth === undefined ? 'not scored' : 'scored'}, and the two rules say otherwise`)
    if (position < sample.firstErrorPosition) return
    if (label.kind === undefined) kindUnscored++
    // What the parser as it is has right: every scored value of the label.
    if (label.kind === undefined && label.depth === undefined) return
    if ((label.kind === undefined || label.kind === trace.displayKind[position]) && (label.depth === undefined || (label.depth === trace.depthAfter[position] && label.container === trace.containerAfter[position]))) asItIsRight++
  })
  const scored = scoredCodePoints(sample, labels)
  if (scored === 0) problem(`${where}: no code point to score`)

  // The fields that are derived from others.
  if (sample.kinds.length !== sample.editCount || sample.forms.length !== sample.kinds.length || sample.recipe !== (sample.kinds.length === 1 ? 'one mistake' : 'two mistakes')) problem(`${where}: kinds, forms, editCount and recipe do not fit`)
  if (!groups.includes(groupOf(sample))) problem(`${where}: the sample is in no group`)
  if (sample.lineEnd !== (sample.original.includes('\r\n') ? '\r\n' : '\n')) problem(`${where}: lineEnd does not fit the document`)

  checked++
  for (const row of rows) {
    row.samples++
    row.alone += Number(sample.kinds.length === 1)
    row.heldOut += Number(sample.heldOut.length > 0)
    row.reachable[sample.reachable]!++
    row.needsClass += Number(sample.needsClass.length > 0)
    row.scored.push(scored)
    row.kindUnscored += kindUnscored
    row.errorDistance += sample.firstErrorPosition - sample.firstDamage
    row.asItIsRight += asItIsRight
    row.asItIsWhole += Number(asItIsRight === scored)
  }
}

// The examples of the kinds.
for (const kind of kinds) {
  if (!validEverywhere(kind.meant)) problem(`${kind.name}: the text that its example's author meant is not valid: ${JSON.stringify(kind.meant)}`)
  if (runTableParser(kind.example).valid || labelReference(kind.example).valid) problem(`${kind.name}: the tables or the reference accept its example: ${JSON.stringify(kind.example)}`)
  if (!makesItsExample(kind)) problem(`${kind.name}: the kind does not make its example of the text that the example's author meant`)
}
console.log(`${kinds.length} kinds: every example's document is valid, the tables and the reference reject every example, and every kind makes its example of that document.`)

// The set as sampleAt draws it.
const started = performance.now()
const drawn: Sample[] = []
for (let index = 0; index < sampleCount; index++) {
  const sample = sampleAt(seed, index)
  drawn.push(sample)
  checkSample(sample, [drawnTotal, ...sample.kinds.map(name => drawnRows.get(name)!)])
  // Made twice, a sample is the same. Every 20th sample is enough to see a draw that depends on something else.
  if (index % 20 === 0 && JSON.stringify(sampleAt(seed, index)) !== JSON.stringify(sample)) problem(`${sample.id}: the sample differs when it is made twice`)
}
const seconds = (performance.now() - started) / 1000
console.log(`${sampleCount} samples of seed ${seed} in ${seconds.toFixed(1)} s (${(seconds * 1000 / sampleCount).toFixed(1)} ms per sample).`)

// Every kind alone, so that a rare kind is checked on as many samples as a frequent one.
for (const kind of kinds) {
  for (let index = 0; index < perKind; index++) {
    const sample = sampleAt(seed + 1, index, {kind: kind.name})
    if (sample.kinds.length !== 1 || sample.kinds[0] !== kind.name) problem(`${sample.id}: asked for ${kind.name} and got ${sample.kinds.join(', ')}`)
    checkSample(sample, [aloneRows.get(kind.name)!])
  }
}
console.log(`${kinds.length * perKind} more samples, ${perKind} of each kind alone, of seed ${seed + 1}.`)

// No document of the set, and no sequence of tokens, is in the train or the validation split of the dataset.
const datasetSamples = 20_000
let outsideTest = 0
let sharedSequences = 0
let sharedDocuments = 0
for (let index = 0; index < datasetSamples; index++) {
  const sample = datasetSampleAt(datasetSeed, index)
  if (sample.split === 'test') continue
  outsideTest++
  if (tokenSequences.has(splitKeyOf(sample.original))) sharedSequences++
  if (documents.has(sample.original)) sharedDocuments++
}
if (sharedSequences > 0 || sharedDocuments > 0) problem(`${sharedSequences} train or validation samples of the dataset have the sequence of tokens of a sample of this set, and ${sharedDocuments} have its document`)
console.log(`${documents.size} documents with ${tokenSequences.size} sequences of tokens, all in the test split. None of the ${outsideTest} train and validation samples among the dataset's first ${datasetSamples} has one of the sequences or one of the documents.`)

// No file outside held-back/ imports from it.
const tomlFolder = join(import.meta.dir, '..', '..')
const heldBackFolder = join(import.meta.dir, '..')
let filesRead = 0
const importsOf = (folder: string) => {
  for (const entry of readdirSync(folder, {withFileTypes: true})) {
    const path = join(folder, entry.name)
    if (path === heldBackFolder || entry.name === 'node_modules') continue
    if (entry.isDirectory()) importsOf(path)
    else if (entry.name.endsWith('.ts')) {
      filesRead++
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (/held-back/.test(line) && /\b(import|require|from)\b/.test(line) && !line.trimStart().startsWith('//')) problem(`${relative(tomlFolder, path)} names held-back/ in an import: ${line.trim()}`)
      }
    }
  }
}
importsOf(tomlFolder)
console.log(`${filesRead} files of lab/recovery-toml/ outside held-back/: none names held-back/ in an import.`)

// The machinery's loader takes the set.
const loaded = samplesOf(labeledTexts(seed, 0, sampleCount), seed)
const loadedScored = loaded.scored.reduce((total, value) => total + value, 0)
const setScored = drawn.reduce((total, sample) => total + scoredCodePoints(sample), 0)
if (loaded.sampleCount !== sampleCount || loadedScored !== setScored) problem(`the machinery's loader has ${loaded.sampleCount} samples with ${loadedScored} scored code points, and the set ${sampleCount} with ${setScored}`)
else console.log(`The machinery's loader takes the ${loaded.sampleCount} samples: ${loaded.codePointCount} code points, ${loadedScored} of them scored.`)

// The page's tables of the kinds are the ones that the definitions give.
const readme = readFileSync(join(import.meta.dir, 'README.md'), 'utf8')
if (!readme.includes(kindsTable()) || !readme.includes(reachTable())) problem('README.md does not hold the two tables of the kinds as table.ts prints them')
else console.log('README.md holds the two tables of the kinds as table.ts prints them.')

// score.ts counts what this file counts.
const sumOf = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)
const scoreRows = scoreWith(parserAsItIs, drawn)
let rowsCompared = 0
for (const [name, row] of [['all', drawnTotal] as const, ...kinds.map(kind => [`kind: ${kind.name}`, drawnRows.get(kind.name)!] as const)]) {
  const scoreRow = scoreRows.find(candidate => candidate.name === name)
  rowsCompared++
  if (scoreRow === undefined || scoreRow.samples !== row.samples || scoreRow.scored !== sumOf(row.scored) || scoreRow.right !== row.asItIsRight || scoreRow.whole !== row.asItIsWhole) {
    problem(`the row "${name}" of score.ts for the parser as it is has ${scoreRow?.samples} samples, ${scoreRow?.right} of ${scoreRow?.scored} code points right and ${scoreRow?.whole} whole samples, and this check counts ${row.samples}, ${row.asItIsRight} of ${sumOf(row.scored)} and ${row.asItIsWhole}`)
  }
}
console.log(`score.ts counts for the parser as it is what this check counts, in the row "all" and in the ${rowsCompared - 1} rows of the kinds.`)

// The numbers.
const sortedCopy = (values: readonly number[]) => [...values].sort((left, right) => left - right)
const quantile = (values: readonly number[], share: number) => values.length === 0 ? 0 : sortedCopy(values)[Math.min(values.length - 1, Math.floor(values.length * share))]!
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)
const mean = (values: readonly number[]) => values.length === 0 ? 0 : sum(values) / values.length
const pad = (text: string | number, width: number) => String(text).padStart(width)
const percent = (part: number, whole: number) => whole === 0 ? '-' : `${(100 * part / whole).toFixed(1)}`

console.log('')
console.log(`The set: the ${sampleCount} samples of seed ${seed}. Per kind: the samples with the kind, how many of them have it alone, and how many are of a held-out template.`)
console.log(`${'kind'.padEnd(28)}${pad('samples', 8)}${pad('alone', 7)}${pad('held out', 9)}`)
for (const kind of kinds) {
  const row = drawnRows.get(kind.name)!
  console.log(`${kind.name.padEnd(28)}${pad(row.samples, 8)}${pad(row.alone, 7)}${pad(row.heldOut, 9)}`)
}
console.log(`${'all'.padEnd(28)}${pad(drawnTotal.samples, 8)}${pad(drawnTotal.alone, 7)}${pad(drawnTotal.heldOut, 9)}`)
console.log('')
console.log(`One mistake ${drawn.filter(sample => sample.kinds.length === 1).length}, two mistakes ${drawn.filter(sample => sample.kinds.length === 2).length}. Debatable ${drawn.filter(sample => sample.debatable).length}. A scored depth out of the loop's reach ${drawn.filter(sample => sample.needsNestingFix).length}.`)
console.log(`Reachable: yes ${drawnTotal.reachable['yes']}, line rule ${drawnTotal.reachable['line rule']}, no ${drawnTotal.reachable['no']}. Groups: ${groups.map(group => `${group} ${drawn.filter(sample => groupOf(sample) === group).length}`).join(', ')}.`)
console.log(`Scored code points per sample: mean ${mean(drawnTotal.scored).toFixed(1)}, median ${quantile(drawnTotal.scored, 0.5)}, a tenth of the samples has ${quantile(drawnTotal.scored, 0.1)} or fewer, a tenth ${quantile(drawnTotal.scored, 0.9)} or more. ${sum(drawnTotal.scored)} in all.`)
console.log(`From the first damaged code point to the first error: mean ${(drawnTotal.errorDistance / drawnTotal.samples).toFixed(1)} code points.`)
console.log(`The parser as it is: ${percent(drawnTotal.asItIsRight, sum(drawnTotal.scored))}% of the scored code points have every scored value right, and ${percent(drawnTotal.asItIsWhole, drawnTotal.samples)}% of the samples have every one right.`)
for (const group of groups) {
  const inGroup = newRow()
  const before = checked
  for (const sample of drawn) if (groupOf(sample) === group) checkSample(sample, [inGroup])
  checked = before
  console.log(`  ${group}: ${inGroup.samples} samples, the parser as it is ${percent(inGroup.asItIsRight, sum(inGroup.scored))}% and ${percent(inGroup.asItIsWhole, inGroup.samples)}%.`)
}

console.log('')
console.log(`Each kind alone, ${perKind} samples of seed ${seed + 1}: the flag "reachable" (yes, line rule, no), the samples that need a character class, the scored code points per sample (mean, median,`)
console.log('a tenth of the samples has fewer, a tenth more), the kept code points from the first error on whose display kind is not scored, per sample, the code points from the first')
console.log('damage to the first error, per sample, and the parser as it is: the share of the scored code points with every scored value right, and the share of the samples with every one right.')
console.log(`${'kind'.padEnd(28)}${pad('yes', 5)}${pad('line', 6)}${pad('no', 5)}${pad('class', 7)}${pad('mean', 8)}${pad('median', 8)}${pad('10%', 6)}${pad('90%', 6)}${pad('unscored', 10)}${pad('to error', 10)}${pad('as it is', 10)}${pad('whole', 8)}`)
for (const kind of kinds) {
  const row = aloneRows.get(kind.name)!
  console.log(`${kind.name.padEnd(28)}${pad(row.reachable['yes']!, 5)}${pad(row.reachable['line rule']!, 6)}${pad(row.reachable['no']!, 5)}${pad(row.needsClass, 7)}${pad(mean(row.scored).toFixed(1), 8)}${pad(quantile(row.scored, 0.5), 8)}`
    + `${pad(quantile(row.scored, 0.1), 6)}${pad(quantile(row.scored, 0.9), 6)}${pad((row.kindUnscored / row.samples).toFixed(1), 10)}${pad((row.errorDistance / row.samples).toFixed(1), 10)}${pad(percent(row.asItIsRight, sum(row.scored)), 10)}${pad(percent(row.asItIsWhole, row.samples), 8)}`)
}

if (process.argv.includes('--markdown')) {
  console.log('')
  console.log(`| Kind | Samples of the ${sampleCount} | Alone | Yes, line rule, no | Scored code points, mean | Median | The parser as it is | Whole |`)
  console.log('|---|---|---|---|---|---|---|---|')
  for (const kind of kinds) {
    const drawnRow = drawnRows.get(kind.name)!
    const row = aloneRows.get(kind.name)!
    console.log(`| \`${kind.name}\` | ${drawnRow.samples} | ${drawnRow.alone} | ${row.reachable['yes']}, ${row.reachable['line rule']}, ${row.reachable['no']} | ${mean(row.scored).toFixed(1)} | ${quantile(row.scored, 0.5)} | ${percent(row.asItIsRight, sum(row.scored))}% | ${percent(row.asItIsWhole, row.samples)}% |`)
  }
}

console.log('')
console.log(`${checked} samples checked, ${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
else console.log('every check passed')
