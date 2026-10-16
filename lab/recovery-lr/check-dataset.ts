// Checks the dataset of the experiment: the first 40,000 train samples and the first 5,000 validation samples.
// 1. The idioms: every idiom is a valid program with every one of its alternatives, and no hole is left in a program.
// 2. The programs: every one is valid and has at most 512 code points, every sort is written, and together the
//    programs read every frozen cell of the parser's table, each cell in 15 programs or more.
// 3. The samples: a kept code point is the original's code point and has the original's labels, the kept code
//    points are in the original's order, the broken text is rejected, its first error is the first token that
//    reads an open cell, and a code point is left to score. The labels are taken from the original here, by
//    labels.ts, and not from the sample.
// 4. The splits: no list of tokens is in a train program and in a validation program, and a sample's split is
//    the split of its original.
// 5. The draws that were thrown away: a second look at each says the same.
// 6. The damage knows nothing of the language: damage.ts imports nothing but the type of the random numbers, and
//    with the letters of a program exchanged for others, it makes the same edits at the same places. Only the
//    line feed has to stay, since three edits are about lines.
// 7. The same seed gives the same samples, one by one and as a list, and another seed gives other samples. No
//    file of the dataset reads the clock or Math.random.
//
// Run from the repo root: bun lab/recovery-lr/check-dataset.ts [samples per split, by default all]
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {damageProgram, editNames} from './damage.ts'
import {defaultSeed, indexOfSample, loadSamples, programAt, sampleAt, splitOf, splitOfTokens, trainSampleCount, validationSampleCount} from './dataset.ts'
import {idiomOf} from './generate.ts'
import {type Sort, commonIdioms, holes, idiomsOfSort, sorts} from './idioms.ts'
import {labelsOfValidText} from './labels.ts'
import {codePointsOf, isValid, maximumCodePoints, parseText, scan, textOf} from './parser.ts'
import {createRandom} from './random.ts'
import {canonicalAlignment, isScored, makeSample} from './sample.ts'
import {actionError, actionReduce, actionShift, cellText, isTrivia, symbolOf, tables} from './tables.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 20) console.log(`PROBLEM: ${text}`)
}
const {stateCount, terminalCount, textTerminals, frozen} = tables
const perSplit = process.argv[2] === undefined ? undefined : Number(process.argv[2])
const trainCount = perSplit ?? trainSampleCount, validationCount = perSplit ?? validationSampleCount

// 1. The idioms.
{
  // Every text that the alternatives of an idiom give: each `{a ~ b}` with each of its alternatives.
  const alternativesOf = (text: string): string[] => {
    const match = /\{([^{}]*)\}/.exec(text)
    if (match === null) return [text]
    return match[1]!.split('~').flatMap(alternative => alternativesOf(`${text.slice(0, match.index)}${alternative.trim()}${text.slice(match.index + match[0].length)}`))
  }
  let idioms = 0, texts = 0
  for (const idiom of [...sorts.flatMap(sort => idiomsOfSort[sort]), ...commonIdioms]) {
    idioms++
    // An idiom with many places of alternatives has too many texts to try them all: the first 2,000 are tried.
    for (const text of alternativesOf(idiom).slice(0, 2000)) {
      texts++
      try {
        if (idiomOf(text).definitions.length === 0) problem(`the idiom ${text} defines nothing`)
      } catch (error) {
        problem(`the idiom ${text} is no valid program: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  for (const sort of sorts) if (idiomsOfSort[sort].length < 15) problem(`the sort ${sort} has ${idiomsOfSort[sort].length} idioms`)
  console.log(`1. ${idioms} idioms of ${sorts.length} sorts are valid programs with each of their alternatives, ${texts} texts in all.`)
}

// 2 to 5. The programs and the samples, in one pass over the indexes.
const trainLists = new Set<string>(), validationLists = new Set<string>()
{
  const identifier = symbolOf('IDENT')
  const programsReading = new Int32Array(stateCount * terminalCount)
  const readByProgram = new Uint8Array(stateCount * terminalCount)
  const programsOfSort = new Map<Sort, number>()
  const counts = {train: 0, validation: 0}
  let programs = 0, samples = 0, keptCodePoints = 0, scoredCodePoints = 0, draws = 0, refusedChecked = 0
  for (let index = 0; counts.train < trainCount || counts.validation < validationCount; index++) {
    const {sample, split, sort, refused} = sampleAt(defaultSeed, index)
    programs++
    programsOfSort.set(sort, (programsOfSort.get(sort) ?? 0) + 1)
    const name = `sample ${sample.id}`
    // The program: valid, short enough, without a hole, and what it reads.
    const original = codePointsOf(sample.original)
    if (original.length > maximumCodePoints) problem(`${name}: the original has ${original.length} code points`)
    readByProgram.fill(0)
    const parsed = parseText(sample.original, {cell: (state, terminal) => { readByProgram[state * terminalCount + terminal] = 1 }})
    if (!parsed.parse.valid) problem(`${name}: the original is no valid program`)
    for (let cell = 0; cell < readByProgram.length; cell++) {
      if (readByProgram[cell] === 0) continue
      programsReading[cell]!++
      if (frozen[cell] === 0) problem(`${name}: the original reads the open cell ${cellText(cell)}`)
    }
    const terminals: number[] = []
    for (let token = 0; token < parsed.tokens.count; token++) {
      const kind = parsed.tokens.kind[token]!
      if (isTrivia(kind)) continue
      terminals.push(kind)
      if (kind === identifier && (holes as readonly string[]).includes(textOf(original.subarray(parsed.tokens.start[token], parsed.tokens.start[token]! + parsed.tokens.length[token]!)))) problem(`${name}: a hole is left in the original`)
    }
    const lists = split === 'train' ? trainLists : validationLists
    lists.add(terminals.join(' '))
    if (splitOf(sample.original) !== split || splitOfTokens(labelsOfValidText(sample.original)) !== split) problem(`${name}: its split is not the split of its original`)
    if (counts[split] >= (split === 'train' ? trainCount : validationCount)) continue
    counts[split]++
    samples++
    if (indexOfSample(sample) !== index || sample.id !== `${defaultSeed}:${index}`) problem(`${name}: its id is not its index ${index}`)
    // The sample. The labels come from the original, by labels.ts.
    const labels = labelsOfValidText(sample.original)
    const broken = codePointsOf(sample.broken)
    if (sample.original === sample.broken) problem(`${name}: the broken text is the original`)
    if (broken.length > maximumCodePoints || broken.length !== sample.codePoints.length) problem(`${name}: the broken text has ${broken.length} code points`)
    if (isValid(sample.broken)) problem(`${name}: the broken text is a valid program`)
    if (sample.edits.length < 1 || sample.edits.length > 3 || sample.edits.some(edit => !(editNames as readonly string[]).includes(edit))) problem(`${name}: its edits are ${sample.edits.join(', ')}`)
    let lastCounterpart = -1, scored = 0
    for (let position = 0; position < broken.length; position++) {
      const counterpart = sample.alignment[position]!
      if (counterpart === -1) {
        if (sample.labelKind[position] !== -1 || sample.labelDepth[position] !== -1 || sample.labelContainer[position] !== -1 || isScored(sample, position)) problem(`${name}: the added code point ${position} has a label or is scored`)
        continue
      }
      keptCodePoints++
      if (counterpart <= lastCounterpart || broken[position] !== original[counterpart]) problem(`${name}: code point ${position} is not the original's code point ${counterpart}, or the kept code points are out of order`)
      lastCounterpart = counterpart
      if (sample.labelKind[position] !== labels.kind[counterpart] || sample.labelDepth[position] !== labels.depth[counterpart] || sample.labelContainer[position] !== labels.container[counterpart] || sample.labelStack[position] !== labels.stack[counterpart]) {
        problem(`${name}: code point ${position} does not have the labels of the original's code point ${counterpart}`)
      }
      if (position >= sample.firstErrorPosition) scored++
      if (isScored(sample, position) !== (position >= sample.firstErrorPosition)) problem(`${name}: isScored is wrong at code point ${position}`)
    }
    scoredCodePoints += scored
    if (scored === 0 || scored !== sample.scored) problem(`${name}: ${scored} code points are left to score, and the sample says ${sample.scored}`)
    // The first error: every token before it is shifted by frozen cells, and its own first cell is open.
    const tokens = scan(broken)
    const stack = [tables.startState]
    let firstOpenCellAt = -1
    for (let token = 0; token <= tokens.count && firstOpenCellAt === -1;) {
      if (token < tokens.count && isTrivia(tokens.kind[token]!)) {
        token++
        continue
      }
      const cell = stack.at(-1)! * terminalCount + (token < tokens.count ? tokens.kind[token]! : tables.endSymbol)
      if (frozen[cell] === 0) firstOpenCellAt = token
      else if (tables.actionKind[cell] === actionShift) {
        stack.push(tables.actionArgument[cell]!)
        token++
      } else if (tables.actionKind[cell] === actionReduce) {
        const rule = tables.actionArgument[cell]!
        stack.length -= tables.ruleLength[rule]!
        stack.push(tables.gotoState[stack.at(-1)! * tables.nonterminalCount + tables.ruleLhs[rule]! - terminalCount]!)
      } else break
    }
    if (firstOpenCellAt === -1 || firstOpenCellAt >= tokens.count || firstOpenCellAt !== sample.firstErrorToken || tokens.start[firstOpenCellAt] !== sample.firstErrorPosition) {
      problem(`${name}: the first open cell is read at token ${firstOpenCellAt}, and the sample says ${sample.firstErrorToken} at code point ${sample.firstErrorPosition}`)
    } else if (stack.length !== sample.startStack.length || stack.some((state, level) => state !== sample.startStack[level])) problem(`${name}: startStack is not the stack at the first open cell`)
    else if (tables.actionKind[stack.at(-1)! * terminalCount + tokens.kind[firstOpenCellAt]!] !== actionError && tables.actionKind[stack.at(-1)! * terminalCount + tokens.kind[firstOpenCellAt]!] !== actionReduce) problem(`${name}: the first open cell holds a shift`)
    // The draws that were thrown away, for one sample in 20: the same draws again, each looked at without makeSample.
    draws += refused.length + 1
    if (index % 20 !== 0) continue
    const random = createRandom(defaultSeed ^ 0x5bd1e995, index)
    for (const reason of [...refused, 'a sample']) {
      refusedChecked++
      const damaged = damageProgram(original, random)
      const text = textOf(damaged.codePoints)
      // A code point counts as kept by the alignment in the form that samples have, see canonicalAlignment.
      const firstError = damaged.codePoints.length > maximumCodePoints ? -1 : parseText(text).parse.firstErrorPosition
      const second = text === sample.original ? 'unchanged' : damaged.codePoints.length > maximumCodePoints ? 'too long' : isValid(text) ? 'still valid'
        : canonicalAlignment(original, damaged.codePoints, damaged.alignment).every((counterpart, position) => counterpart === -1 || position < firstError) ? 'nothing to score' : 'a sample'
      if (second !== reason) problem(`${name}: a draw was taken as "${reason}", and a second look says "${second}"`)
      if (reason === 'a sample' && text !== sample.broken) problem(`${name}: the draw that gave the sample is another text when it is drawn again`)
    }
  }
  for (const sort of sorts) if ((programsOfSort.get(sort) ?? 0) < programs / sorts.length / 2) problem(`the sort ${sort} has ${programsOfSort.get(sort) ?? 0} of the ${programs} programs`)
  let frozenCells = 0, read = 0, fewest = Infinity, fewestCell = -1
  for (let state = 0; state < stateCount; state++) {
    for (const terminal of textTerminals) {
      const cell = state * terminalCount + terminal
      if (frozen[cell] === 0) continue
      frozenCells++
      if (programsReading[cell]! > 0) read++
      else problem(`no program reads the frozen cell ${cellText(cell)}`)
      if (programsReading[cell]! < fewest) {
        fewest = programsReading[cell]!
        fewestCell = cell
      }
    }
  }
  // With fewer programs than the experiment has, a rare cell can be read by none: the count is only held to 15 for all of them.
  if (perSplit === undefined && fewest < 15) problem(`the frozen cell ${cellText(fewestCell)} is read by ${fewest} programs`)
  console.log(`2. ${programs.toLocaleString('en-US')} programs of ${programsOfSort.size} sorts are valid, have at most ${maximumCodePoints} code points and no hole, and read ${read} of the ${frozenCells} frozen cells and no open one. The cell that the fewest read, ${cellText(fewestCell)}, is read by ${fewest}.`)
  console.log(`3. ${counts.train.toLocaleString('en-US')} train and ${counts.validation.toLocaleString('en-US')} validation samples: the ${keptCodePoints.toLocaleString('en-US')} kept code points are the original's, in its order, with its labels. Every broken text is rejected at the first token that reads an open cell, and ${scoredCodePoints.toLocaleString('en-US')} code points are scored, at least one per sample.`)
  let inBoth = 0
  for (const list of validationLists) if (trainLists.has(list)) inBoth++
  if (inBoth > 0) problem(`${inBoth} lists of tokens are in a train program and in a validation program`)
  if (samples !== trainCount + validationCount) problem(`${samples} samples were checked`)
  console.log(`4. ${trainLists.size.toLocaleString('en-US')} lists of tokens are in train programs and ${validationLists.size.toLocaleString('en-US')} in validation programs, none in both. Every sample is in the split of its original.`)
  console.log(`5. ${draws.toLocaleString('en-US')} draws of the damage gave the ${samples.toLocaleString('en-US')} samples. ${refusedChecked.toLocaleString('en-US')} of the draws, drawn again and looked at without makeSample, are what dataset.ts took them for.`)
}

// 6. The damage and the language.
{
  const source = readFileSync(join(import.meta.dir, 'damage.ts'), 'utf8')
  const imports = [...source.matchAll(/^import .*$/gm)].map(match => match[0])
  if (imports.length !== 1 || imports[0] !== "import type {Random} from './random.ts'") problem(`damage.ts imports more than the type of the random numbers: ${imports.join(' | ')}`)
  // The code without its comments names nothing of the scanner, the parser or the labels.
  const code = source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|\s)\/\/.*$/gm, '$1')
  for (const word of ['token', 'scan', 'parse', 'label', 'table', 'keyword', 'bracket', 'require(', 'import(']) if (code.toLowerCase().includes(word)) problem(`the code of damage.ts holds the word "${word}"`)
  // Other letters, the same damage: every code point but the line feed is exchanged for another one, by a
  // one-to-one map that is drawn per program, and the damage of the exchanged text is the exchanged damage.
  let compared = 0
  for (let index = 0; index < 2000; index++) {
    const original = Array.from(programAt(defaultSeed, index).labels.codePoints)
    const mapRandom = createRandom(defaultSeed + 21, index)
    const distinct = [...new Set(original)].filter(codePoint => codePoint !== 10)
    const exchanged = new Map<number, number>([[10, 10]])
    // Code points that the program does not have, so that the map cannot hit a line feed or a code point twice.
    for (const [place, codePoint] of mapRandom.shuffled(distinct).entries()) exchanged.set(codePoint, 0x4e00 + place)
    const other = original.map(codePoint => exchanged.get(codePoint)!)
    for (let copy = 0; copy < 3; copy++) {
      const first = damageProgram(original, createRandom(defaultSeed + 22, index * 3 + copy)), second = damageProgram(other, createRandom(defaultSeed + 22, index * 3 + copy))
      compared++
      const same = first.edits.join() === second.edits.join() && first.alignment.join() === second.alignment.join() && first.codePoints.length === second.codePoints.length
        && first.codePoints.every((codePoint, position) => exchanged.get(codePoint) === second.codePoints[position])
      if (!same) problem(`program ${index}: with its code points exchanged for others, the damage makes other edits`)
    }
  }
  console.log(`6. damage.ts imports nothing of the language and names nothing of it. ${compared.toLocaleString('en-US')} draws of the damage make the same edits at the same places when every code point of the program but the line feed is exchanged for another one.`)
}

// 7. The same seed, the same samples.
{
  const count = 400
  const first = loadSamples('train', defaultSeed, count), second = loadSamples('train', defaultSeed, count)
  const same = (left: typeof first[number], right: typeof first[number]): boolean => left.id === right.id && left.broken === right.broken && left.original === right.original && left.alignment.join() === right.alignment.join()
    && left.edits.join() === right.edits.join() && left.labelKind.join() === right.labelKind.join() && left.firstErrorPosition === right.firstErrorPosition
  if (!first.every((sample, place) => same(sample, second[place]!))) problem('two calls of loadSamples give other samples')
  for (const sample of first.slice(0, 100)) {
    const alone = sampleAt(defaultSeed, indexOfSample(sample))
    if (!same(alone.sample, sample) || alone.split !== 'train') problem(`sample ${sample.id} is another one when it is made alone`)
  }
  // What a sample holds is what makeSample gives for its two texts and its alignment.
  for (const sample of first.slice(0, 100)) {
    const again = makeSample({id: sample.id, edits: sample.edits, original: sample.original, broken: sample.broken, alignment: sample.alignment})
    if (typeof again === 'string' || !same(again, sample)) problem(`sample ${sample.id} is another one when makeSample gets its texts and its alignment`)
  }
  const validation = loadSamples('validation', defaultSeed, 50)
  if (validation.some(sample => first.some(other => other.id === sample.id))) problem('a validation sample is a train sample')
  const otherSeed = loadSamples('train', defaultSeed + 1, 100)
  if (otherSeed.some((sample, place) => sample.broken === first[place]!.broken)) problem('another seed gives a sample of this seed')
  // Nothing of the dataset reads the clock or draws a number that is no function of the seed.
  for (const file of ['generate.ts', 'idioms.ts', 'syntax.ts', 'damage.ts', 'sample.ts', 'random.ts']) {
    const code = readFileSync(join(import.meta.dir, file), 'utf8').replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|\s)\/\/.*$/gm, '$1')
    for (const word of ['Math.random', 'Date.now', 'new Date', 'crypto.']) if (code.includes(word)) problem(`${file} uses ${word}`)
  }
  console.log(`7. Two calls give the same ${count} train samples, each of the first 100 is the same when it is made alone, and another seed gives other samples.`)
}

if (problems.length > 20) console.log(`... and ${problems.length - 20} more problems`)
console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
