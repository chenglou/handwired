// The numbers of the dataset: the programs per sort, which frozen cells of the parser's table they read, the
// splits, the draws of the damage that were thrown away, and what the samples look like.
//
// Run from the repo root: bun lab/recovery-lr/stats.ts [seed]
// It reads the experiment's sets: the first 40,000 train samples and the first 5,000 validation samples.
import {damageProgram, editNames} from './damage.ts'
import {defaultSeed, programAt, sampleAt, trainSampleCount, validationSampleCount} from './dataset.ts'
import {type Sort, sorts} from './idioms.ts'
import {containerOf, depthOf, displayKind, displayOfState, stackHashOf} from './labels.ts'
import {parse, parseText} from './parser.ts'
import {createRandom} from './random.ts'
import type {Sample} from './sample.ts'
import {actionError, cellText, commentKind, isTrivia, symbolOf, tables} from './tables.ts'

const {stateCount, terminalCount, textTerminals, frozen} = tables

// What the parser as it is gives for the code points before a sample's first error: the display kind, the depth,
// the container and the hash of the stack, as labels.ts gives them for a valid text. Every parser of the
// experiment gives the same there. -1 from the first error on.
export function outputsBeforeFirstError(sample: Sample): {kind: Int8Array, depth: Int16Array, container: Int8Array, stack: Int32Array} {
  const {tokens, codePoints} = sample
  const kind = new Int8Array(codePoints.length).fill(-1), depth = new Int16Array(codePoints.length).fill(-1), container = new Int8Array(codePoints.length).fill(-1)
  const stack = new Int32Array(codePoints.length)
  const fill = (token: number, tokenKind: number, states: readonly number[]) => {
    const currentDepth = depthOf(states), currentContainer = containerOf(states), currentHash = stackHashOf(states)
    for (let at = token; at < sample.firstErrorToken && (at === token || isTrivia(tokens.kind[at]!)); at++) {
      const from = tokens.start[at]!, to = from + tokens.length[at]!
      kind.fill(at === token && tokenKind !== -1 ? tokenKind : tokens.kind[at] === commentKind ? displayKind.comment : displayKind.whitespace, from, to)
      depth.fill(currentDepth, from, to)
      container.fill(currentContainer, from, to)
      stack.fill(currentHash, from, to)
    }
  }
  if (tokens.count > 0 && isTrivia(tokens.kind[0]!)) fill(0, -1, [tables.startState])
  parse(tokens, codePoints.length, {shift: (token, state, states) => fill(token, displayOfState[state]!, states)})
  return {kind, depth, container, stack}
}

// The first code point of the broken text at which it differs from the original: the first one that an edit
// added, or that follows something that an edit removed.
export function firstEditPosition(sample: Sample): number {
  for (let position = 0; position < sample.alignment.length; position++) if (sample.alignment[position] !== position) return position
  return sample.alignment.length
}

// The scored code points of a sample that no parser of the experiment can have right. Such a parser reads the
// scanner's tokens, and its outputs are those of labels.ts:
// - every code point of a token has one display kind, and white space and comments have their own, which no table
//   changes,
// - a token and the white space and comments after it have one depth and one container: those of the stack that
//   the token left.
// E.g. when the `then` of `if c then x` is removed, the space before it and the space after it are one run of
// white space after `c`, with the containers `if` and `then`: one of the two is wrong for every parser. And a
// space of a string that lost its quotes is white space for the scanner and a string for its label.
// The count is the least number of scored code points that such a parser has wrong.
export function scoredOutOfReach(sample: Sample): number {
  const {tokens, alignment} = sample
  const nestingAt = (position: number): number => sample.labelDepth[position]! * 16 + sample.labelContainer[position]!
  let lost = 0
  for (let token = 0; token < tokens.count;) {
    // A token and the white space and comments after it, or the white space and comments before the first token.
    let end = token + 1
    while (end < tokens.count && isTrivia(tokens.kind[end]!)) end++
    const from = Math.max(tokens.start[token]!, sample.firstErrorPosition), to = end < tokens.count ? tokens.start[end]! : sample.codePoints.length
    const nestings = new Set<number>()
    let scored = 0
    for (let position = from; position < to; position++) {
      if (alignment[position] === -1) continue
      scored++
      nestings.add(nestingAt(position))
    }
    // The most code points that are right with one depth and container for the run and one kind per token.
    let most = 0
    for (const nesting of nestings) {
      let right = 0
      for (let part = token; part < end; part++) {
        const kinds = new Map<number, number>()
        for (let position = Math.max(tokens.start[part]!, from); position < tokens.start[part]! + tokens.length[part]!; position++) {
          if (alignment[position] !== -1 && nestingAt(position) === nesting) kinds.set(sample.labelKind[position]!, (kinds.get(sample.labelKind[position]!) ?? 0) + 1)
        }
        const kind = tokens.kind[part]!
        right += isTrivia(kind) ? kinds.get(kind === commentKind ? displayKind.comment : displayKind.whitespace) ?? 0 : Math.max(0, ...kinds.values())
      }
      most = Math.max(most, right)
    }
    lost += scored - most
    token = end
  }
  return lost
}

if (import.meta.main) {
  const seed = Number(process.argv[2] ?? defaultSeed)
  const percent = (part: number, whole: number): string => `${(100 * part / whole).toFixed(1)}%`
  const quantiles = (values: number[]): string => {
    const sorted = [...values].sort((left, right) => left - right)
    const at = (share: number): string => String(Math.round(sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!))
    return `mean ${(values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)}, a tenth below ${at(0.1)}, a quarter below ${at(0.25)}, half below ${at(0.5)}, three quarters below ${at(0.75)}, nine tenths below ${at(0.9)}, largest ${at(1)}`
  }
  const bucketsOf = (values: number[], limits: [name: string, upTo: number][]): string => {
    const counts = limits.map(() => 0)
    for (const value of values) counts[limits.findIndex(([, upTo]) => value <= upTo)]!++
    return limits.map(([name], place) => `${name}: ${percent(counts[place]!, values.length)}`).join(', ')
  }

  const perSort = new Map<Sort, {programs: number, codePoints: number, tokens: number, train: Set<string>, validation: Set<string>, samples: number, scored: number}>()
  for (const sort of sorts) perSort.set(sort, {programs: 0, codePoints: 0, tokens: 0, train: new Set(), validation: new Set(), samples: 0, scored: 0})
  const programsReading = new Int32Array(stateCount * terminalCount), sortsReading = Array.from({length: stateCount * terminalCount}, () => new Set<Sort>())
  const readByProgram = new Uint8Array(stateCount * terminalCount)
  const counts = {train: 0, validation: 0}
  const refusals = new Map<string, number>()
  const editCounts = [0, 0, 0, 0], drawnEditCounts = [0, 0, 0, 0]
  const samplesWithEdit = new Map<string, number>()
  const scored: number[] = [], scoredShare: number[] = [], lengths: number[] = [], programLengths: number[] = [], distance: number[] = [], tokensBetween: number[] = []
  let keptBefore = 0, wrongBefore = 0, wrongWhiteSpaceBefore = 0, samplesWrongBefore = 0, wrongAtFirstError = 0, deeperAtFirstError = 0, shallowerAtFirstError = 0, otherStackAtFirstError = 0, withKeptTokenBefore = 0
  let lostToTokens = 0, samplesLostToTokens = 0, scoredTotal = 0, samples = 0, draws = 0
  let firstErrorIsNoToken = 0, firstCellReduces = 0
  // Per edit, over the samples with that one edit: how many there are, their scored code points, how many have a
  // wrong label before the first error, another depth or container at the last kept token before it, a scored
  // label that no parser can give, and their first errors' distances from the edit.
  const singleEdits = new Map<string, {samples: number, scored: number, wrongBefore: number, otherNesting: number, lost: number, distances: number[]}>()
  const programTexts = new Set<string>(), brokenTrainTexts = new Set<string>(), brokenValidationTexts: string[] = []
  let programs = 0
  const highestStacks: number[] = [], deepestLabels: number[] = []
  const noTokens = [symbolOf('BADCHAR'), symbolOf('BADSTRING'), symbolOf('BADCOMMENT')]

  for (let index = 0; counts.train < trainSampleCount || counts.validation < validationSampleCount; index++) {
    const {sample, split, sort, refused} = sampleAt(seed, index)
    programs++
    const ofSort = perSort.get(sort)!
    // The program.
    readByProgram.fill(0)
    const original = parseText(sample.original, {cell: (state, terminal) => { readByProgram[state * terminalCount + terminal] = 1 }})
    for (let cell = 0; cell < readByProgram.length; cell++) {
      if (readByProgram[cell] === 0) continue
      programsReading[cell]!++
      sortsReading[cell]!.add(sort)
    }
    const terminals = Array.from(original.tokens.kind).filter(kind => !isTrivia(kind))
    ofSort.programs++
    ofSort.codePoints += original.codePoints.length
    ofSort.tokens += terminals.length
    ofSort[split].add(terminals.join(' '))
    programLengths.push(original.codePoints.length)
    programTexts.add(sample.original)
    highestStacks.push(original.parse.highestStack)
    let deepest = 0
    for (const depth of sample.labelDepth) deepest = Math.max(deepest, depth)
    deepestLabels.push(deepest)
    // The sample, when it is one of the experiment's.
    if (counts[split] >= (split === 'train' ? trainSampleCount : validationSampleCount)) continue
    counts[split]++
    samples++
    if (split === 'train') brokenTrainTexts.add(sample.broken)
    else brokenValidationTexts.push(sample.broken)
    ofSort.samples++
    ofSort.scored += sample.scored
    draws += refused.length + 1
    for (const reason of refused) refusals.set(reason, (refusals.get(reason) ?? 0) + 1)
    editCounts[sample.edits.length]!++
    for (const edit of new Set(sample.edits)) samplesWithEdit.set(edit, (samplesWithEdit.get(edit) ?? 0) + 1)
    scored.push(sample.scored)
    scoredTotal += sample.scored
    lengths.push(sample.codePoints.length)
    scoredShare.push(100 * sample.scored / sample.codePoints.length)
    const firstEdit = firstEditPosition(sample)
    distance.push(sample.firstErrorPosition - firstEdit)
    let between = 0
    for (let token = 0; token < sample.firstErrorToken; token++) if (!isTrivia(sample.tokens.kind[token]!) && sample.tokens.start[token]! >= firstEdit) between++
    tokensBetween.push(between)
    if (noTokens.includes(sample.tokens.kind[sample.firstErrorToken]!)) firstErrorIsNoToken++
    if (tables.actionKind[sample.startStack.at(-1)! * terminalCount + sample.tokens.kind[sample.firstErrorToken]!] !== actionError) firstCellReduces++
    // Before the first error.
    const outputs = outputsBeforeFirstError(sample)
    let wrongHere = 0
    for (let position = 0; position < sample.firstErrorPosition; position++) {
      if (sample.alignment[position] === -1) continue
      keptBefore++
      if (outputs.kind[position] === sample.labelKind[position] && outputs.depth[position] === sample.labelDepth[position] && outputs.container[position] === sample.labelContainer[position]) continue
      wrongHere++
      if (sample.labelKind[position] === displayKind.whitespace || sample.labelKind[position] === displayKind.comment) wrongWhiteSpaceBefore++
    }
    wrongBefore += wrongHere
    if (wrongHere > 0) samplesWrongBefore++

    // The last kept token before the first error: the parser took it as the original's token, and the question
    // is whether it took it onto the original's stack.
    let lastKeptToken = sample.firstErrorToken - 1
    while (lastKeptToken >= 0 && sample.keptToken[lastKeptToken] === -1) lastKeptToken--
    let otherNesting = false
    if (lastKeptToken !== -1) {
      const position = sample.tokens.start[lastKeptToken]!
      withKeptTokenBefore++
      otherNesting = outputs.depth[position] !== sample.labelDepth[position] || outputs.container[position] !== sample.labelContainer[position]
      if (otherNesting) wrongAtFirstError++
      if (outputs.depth[position]! > sample.labelDepth[position]!) deeperAtFirstError++
      if (outputs.depth[position]! < sample.labelDepth[position]!) shallowerAtFirstError++
      if (outputs.stack[position] !== sample.labelStack[position]) otherStackAtFirstError++
    }
    const lost = scoredOutOfReach(sample)
    lostToTokens += lost
    if (lost > 0) samplesLostToTokens++
    if (sample.edits.length === 1) {
      const entry = singleEdits.get(sample.edits[0]!) ?? {samples: 0, scored: 0, wrongBefore: 0, otherNesting: 0, lost: 0, distances: []}
      singleEdits.set(sample.edits[0]!, entry)
      entry.samples++
      entry.scored += sample.scored
      if (wrongHere > 0) entry.wrongBefore++
      if (otherNesting) entry.otherNesting++
      if (lost > 0) entry.lost++
      entry.distances.push(sample.firstErrorPosition - firstEdit)
    }
  }
  // The edits as the damage draws them, for the shares before any draw is thrown away.
  for (let index = 0; index < 5000; index++) drawnEditCounts[damageProgram(programAt(seed, index).labels.codePoints, createRandom(seed + 11, index)).edits.length]!++

  console.log(`Seed ${seed}. ${programs.toLocaleString('en-US')} programs give the experiment's ${counts.train.toLocaleString('en-US')} train and ${counts.validation.toLocaleString('en-US')} validation samples.`)
  console.log(`\nPROGRAMS\nCode points per program: ${quantiles(programLengths)}.`)
  console.log(`The highest stack of a program, in states: ${quantiles(highestStacks)}.`)
  console.log(`The deepest label of a sample: ${quantiles(deepestLabels)}.`)
  console.log('sort                 programs  code points  tokens  distinct lists of tokens in train, in validation')
  for (const sort of sorts) {
    const entry = perSort.get(sort)!
    console.log(`${sort.padEnd(20)} ${String(entry.programs).padStart(8)}  ${(entry.codePoints / entry.programs).toFixed(0).padStart(11)}  ${(entry.tokens / entry.programs).toFixed(0).padStart(6)}  ${entry.train.size}, ${entry.validation.size}`)
  }
  const allTrain = new Set<string>(), allValidation = new Set<string>()
  for (const entry of perSort.values()) {
    for (const list of entry.train) allTrain.add(list)
    for (const list of entry.validation) allValidation.add(list)
  }
  console.log(`Distinct lists of tokens: ${allTrain.size} in train programs, ${allValidation.size} in validation programs, ${[...allValidation].filter(list => allTrain.has(list)).length} in both.`)

  console.log('\nFROZEN CELLS')
  const frozenCells: number[] = []
  for (let state = 0; state < stateCount; state++) for (const terminal of textTerminals) if (frozen[state * terminalCount + terminal] === 1) frozenCells.push(state * terminalCount + terminal)
  frozenCells.sort((left, right) => programsReading[left]! - programsReading[right]!)
  console.log(`The ${programs.toLocaleString('en-US')} programs read ${frozenCells.filter(cell => programsReading[cell]! > 0).length} of the ${frozenCells.length} frozen cells.`)
  console.log(`Cells by the number of programs that read them: ${[[1, 19], [20, 49], [50, 99], [100, 499], [500, 4999], [5000, Infinity]].map(([from, to]) => `${from}${to === Infinity ? ' or more' : ` to ${to}`}: ${frozenCells.filter(cell => programsReading[cell]! >= from! && programsReading[cell]! <= to!).length}`).join(', ')}.`)
  console.log(`Cells that programs of all ${sorts.length} sorts read: ${frozenCells.filter(cell => sortsReading[cell]!.size === sorts.length).length}. Read by fewer than 10 sorts: ${frozenCells.filter(cell => sortsReading[cell]!.size < 10).length}. The fewest sorts for a cell: ${Math.min(...frozenCells.map(cell => sortsReading[cell]!.size))}.`)
  console.log('The 30 cells that the fewest programs read (programs, sorts, cell):')
  for (const cell of frozenCells.slice(0, 30)) console.log(`  ${String(programsReading[cell]).padStart(5)}  ${String(sortsReading[cell]!.size).padStart(2)}  ${cellText(cell)}`)

  console.log('\nDRAWS OF THE DAMAGE')
  const thrownAway = draws - samples
  console.log(`${draws.toLocaleString('en-US')} draws gave the ${samples.toLocaleString('en-US')} samples (${percent(samples, draws)}). Thrown away: ${[...refusals].sort((left, right) => right[1] - left[1]).map(([reason, count]) => `${count.toLocaleString('en-US')} ${reason} (${percent(count, draws)})`).join(', ')}; ${thrownAway.toLocaleString('en-US')} in all.`)

  console.log('\nSAMPLES')
  console.log(`Code points per sample: ${quantiles(lengths)}.`)
  console.log(`Scored code points per sample: ${quantiles(scored)}. ${scoredTotal.toLocaleString('en-US')} in all.`)
  console.log(`Scored share of a sample's code points, in %: ${quantiles(scoredShare)}.`)
  console.log(`Samples by their number of edits: ${[1, 2, 3].map(count => `${count}: ${percent(editCounts[count]!, samples)}`).join(', ')}. As the damage draws them: ${[1, 2, 3].map(count => `${count}: ${percent(drawnEditCounts[count]!, 5000)}`).join(', ')}.`)
  console.log(`Samples that have an edit of a kind: ${editNames.map(name => `${name} ${samplesWithEdit.get(name) ?? 0}`).join(', ')}.`)
  console.log(`The first error's token starts this many code points after the first edit: ${quantiles(distance)}.`)
  console.log(`  ${bucketsOf(distance, [['before the edit, i.e. the edit is inside the token', -1], ['at the edit', 0], ['1 to 4 after', 4], ['5 to 19', 19], ['20 to 99', 99], ['100 or more', Infinity]])}.`)
  console.log(`Tokens that the parser takes between the first edit and the first error: ${bucketsOf(tokensBetween, [['none', 0], ['1', 1], ['2 to 5', 5], ['6 to 20', 20], ['more than 20', Infinity]])}.`)
  console.log(`The first error's token is text that is no token (BADCHAR, BADSTRING, BADCOMMENT) in ${percent(firstErrorIsNoToken, samples)} of the samples. Its cell holds a default reduction in ${percent(firstCellReduces, samples)}.`)

  console.log('\nBEFORE THE FIRST ERROR')
  console.log(`${percent(wrongBefore, keptBefore)} of the ${keptBefore.toLocaleString('en-US')} kept code points before the first error have another label than the parser as it is gives there. No table can change that, and they are not scored. ${percent(wrongWhiteSpaceBefore, wrongBefore)} of them are white space or comments, e.g. the space after a removed \`=\`, which has the container \`=\` in the original.`)
  console.log(`${samplesWrongBefore.toLocaleString('en-US')} samples (${percent(samplesWrongBefore, samples)}) have such a code point.`)
  console.log(`In ${wrongAtFirstError.toLocaleString('en-US')} samples (${percent(wrongAtFirstError, samples)}) the last kept token before the first error has another depth or container than its label: the parser reaches its first error with another stack than the labels after it suppose, and no error has said so. The parser is deeper than the label in ${deeperAtFirstError.toLocaleString('en-US')}, e.g. after a duplicated line that opens a level, and less deep in ${shallowerAtFirstError.toLocaleString('en-US')}, e.g. after a removed bracket. By the symbols on the stack it is another stack in ${otherStackAtFirstError.toLocaleString('en-US')} (${percent(otherStackAtFirstError, samples)}). ${(samples - withKeptTokenBefore).toLocaleString('en-US')} samples have no kept token before their first error.`)

  console.log('\nSCORED LABELS THAT NO PARSER CAN GIVE')
  console.log(`${samplesLostToTokens.toLocaleString('en-US')} samples (${percent(samplesLostToTokens, samples)}) have a scored code point that no parser has right which gives a token one display kind, white space and comments their own kind, and a token and the white space after it one depth and one container. They are ${lostToTokens.toLocaleString('en-US')} of the ${scoredTotal.toLocaleString('en-US')} scored code points (${(100 * lostToTokens / scoredTotal).toFixed(2)}%), so such a parser has at most ${(100 - 100 * lostToTokens / scoredTotal).toFixed(2)}% of the code points and ${percent(samples - samplesLostToTokens, samples)} of the samples right.`)
  console.log('\nTHE SAMPLES WITH ONE EDIT, BY THE EDIT')
  console.log('Per edit: the samples, their scored code points on average, the code points from the edit to the first error\'s token (half of the samples have fewer), and the shares of the samples that have a wrong label before the first error, another depth or container at the last kept token before the first error, and a scored label that no parser can give.')
  console.log('edit                   samples  scored  first error after the edit (half below)  wrong label before  other depth or container at the first error  a scored label that no parser can give')
  for (const name of editNames) {
    const entry = singleEdits.get(name)
    if (entry === undefined) continue
    const middle = [...entry.distances].sort((left, right) => left - right)[entry.distances.length >> 1]!
    console.log(`${name.padEnd(22)} ${String(entry.samples).padStart(7)}  ${(entry.scored / entry.samples).toFixed(0).padStart(6)}  ${String(middle).padStart(39)}  ${percent(entry.wrongBefore, entry.samples).padStart(18)}  ${percent(entry.otherNesting, entry.samples).padStart(43)}  ${percent(entry.lost, entry.samples).padStart(38)}`)
  }
  console.log('\nTHE SAME TEXT TWICE')
  console.log(`${programTexts.size.toLocaleString('en-US')} of the ${programs.toLocaleString('en-US')} programs are distinct texts. ${brokenValidationTexts.filter(text => brokenTrainTexts.has(text)).length} of the ${counts.validation.toLocaleString('en-US')} validation samples have a broken text that a train sample has too.`)
  console.log('\nPER SORT: samples, scored code points per sample')
  for (const sort of sorts) console.log(`${sort.padEnd(20)} ${String(perSort.get(sort)!.samples).padStart(6)}  ${(perSort.get(sort)!.scored / perSort.get(sort)!.samples).toFixed(0).padStart(4)}`)
}
