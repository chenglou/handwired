// How a parser that recovers is scored, and the loop that runs tables on packed samples.
//
// What a score counts, per sample: the kept code points from the first error's token on. A kept code point has
// the labels of its counterpart in the original, see ../sample.ts and ../labels.ts.
// - All three: the code points whose token is shown with the label's display kind, depth and container. It is the
//   main number, with "whole": the samples in which every scored code point has all three right.
// - Stack: the code points whose token is taken on the symbols that the original's stack holds there, by a hash of
//   the symbols. A skipped token is not taken, so it is wrong here. White space and comments are right when the
//   stack as it is holds the original's symbols. Read off the grammar and never trained on.
// - Constituents: every reduction gives a nonterminal and the first and the last kept token that it covers. The
//   two numbers are how many of the original's constituents the recovered parse has, and how many of the
//   recovered parse's constituents the original has. An item that is ended early counts as a reduction to its
//   nonterminal. Read off the grammar and never trained on. Both numbers are given twice: over all constituents,
//   and without the ones that the parser has before it reads the first open cell, which no table can change.
//
// Two routes give the same counts, and check-score.ts compares them:
// - scoreTables runs tables on packed samples with the loop of this file, which is also the search's loop.
// - scoreOutputs takes any parser's output per token of a sample's text and counts code point by code point. With
//   outputOfRun it scores the exact parser of recovery-parser.ts. It is also how a parser that is no table of
//   this experiment is scored, e.g. bison's own parser with error productions.
//
//   bun lab/recovery-lr/learn/score.ts [--tables <file.json>] [--split train|validation] [--count <samples>]
import {displayKind, displayKindCount, emptyStackHash, pushStackHash} from '../labels.ts'
import {type Sample, constituentCounts, constituentKey, restrictedConstituents} from '../sample.ts'
import {isTrivia} from '../tables.ts'
import {type PackedSamples, loadPacked, packedComment, prefixOf, refuseOtherTerminals} from './data.ts'
import {numberOf, optionOf, refuseUnknownOptions, standardValidationCount} from './options.ts'
import {type RecoveryRun, runRecoveryParserOnTokens, shownReadAs, shownShifted} from './recovery-parser.ts'
import {
  type RecoveryTables, baseTables, bison, bisonTerminalCount, checkTables, kindAccept, kindEndEarly, kindInsert, kindPop, kindReadAs, kindReduce, kindShift, kindSkip, kindStop,
  loadTablesForReport, maximumStackHeight, maximumStepsPerToken, stateContainer, stateOpensDepth, stateSymbol, stopped,
} from './recovery-tables.ts'

// A run's score in one number: the code points with all three right × scorePack, plus the labels that are right
// one by one (the display kind, the depth and the container). A sample has at most 512 code points, so the second
// count is at most 1,536.
export const scorePack = 4096

// What a run counts besides its score, when it is asked to.
export type RunDetail = {
  kindRight: number
  depthRight: number
  containerRight: number
  stackRight: number
  // The tokens that are no white space and no comment, the steps that they and the end of input took, and the
  // most steps of one of them.
  tokens: number
  steps: number
  mostStepsOfAToken: number
  tokensSkippedByStepLimit: number
  // Of them, the tokens whose 16 steps all read frozen cells: the grammar's own reductions used the steps up, e.g.
  // at a token that closes a chain of 16 `else if`, and no choice of an open cell was asked.
  tokensSkippedOnFrozenCellsOnly: number
  tokensSkippedByStackLimit: number
  insertedTokens: number
  highestStack: number
  // Every reduction and every item that was ended early, three numbers each: the nonterminal, and the first and
  // the last token that it covers, as places in the tokens of the sample's text, -1 for none.
  reductions: number[]
  // When given: [cell] counts every read of an open cell, and [display entry × the number of display kinds + kind]
  // counts the code points that want the kind where the entry is read and the depth and the container are right.
  reads: Int32Array | null
  wantedKinds: Int32Array | null
}
export const createDetail = (reads: Int32Array | null = null, wantedKinds: Int32Array | null = null): RunDetail =>
  ({kindRight: 0, depthRight: 0, containerRight: 0, stackRight: 0, tokens: 0, steps: 0, mostStepsOfAToken: 0, tokensSkippedByStepLimit: 0, tokensSkippedOnFrozenCellsOnly: 0, tokensSkippedByStackLimit: 0, insertedTokens: 0, highestStack: 0, reductions: [], reads, wantedKinds})
function clearDetail(detail: RunDetail) {
  detail.kindRight = detail.depthRight = detail.containerRight = detail.stackRight = detail.tokens = detail.steps = detail.mostStepsOfAToken = 0
  detail.tokensSkippedByStepLimit = detail.tokensSkippedOnFrozenCellsOnly = detail.tokensSkippedByStackLimit = detail.insertedTokens = detail.highestStack = 0
  detail.reductions.length = 0
}

// The stack of a run. Entry 0 stands for what is below the start state, so that entry [height] is the state on top.
// Next to each state: the depth and the container of the stack up to it, and for a run with a detail the hash of
// the symbols up to it and the first and the last token that it covers.
const stack = new Uint8Array(maximumStackHeight + 2)
const depthAt = new Int16Array(maximumStackHeight + 2)
const containerAt = new Uint8Array(maximumStackHeight + 2)
const hashAt = new Int32Array(maximumStackHeight + 2)
const firstTokenAt = new Int16Array(maximumStackHeight + 2)
const lastTokenAt = new Int16Array(maximumStackHeight + 2)
hashAt[0] = emptyStackHash

function setState(level: number, state: number) {
  stack[level] = state
  depthAt[level] = depthAt[level - 1]! + stateOpensDepth[state]!
  const container = stateContainer[state]!
  containerAt[level] = container !== 0 ? container : containerAt[level - 1]!
}
function setStateDetail(level: number, state: number, firstToken: number, lastToken: number, detail: RunDetail) {
  const symbol = stateSymbol[state]!
  hashAt[level] = symbol === -1 ? hashAt[level - 1]! : pushStackHash(hashAt[level - 1]!, symbol)
  firstTokenAt[level] = firstToken
  lastTokenAt[level] = lastToken
  if (level > detail.highestStack) detail.highestStack = level
}

// The packed score of one token that is shown with a kind, a depth and a container.
function scoreOfToken(samples: PackedSamples, token: number, kind: number, depth: number, container: number): number {
  const {groupStart, groupKind, groupDepth, groupContainer, groupCount} = samples
  let score = 0
  for (let group = groupStart[token]!; group < groupStart[token + 1]!; group++) {
    let right = 0
    if (groupKind[group] === kind) right++
    if (groupDepth[group] === depth) right++
    if (groupContainer[group] === container) right++
    score += groupCount[group]! * (right === 3 ? scorePack + 3 : right)
  }
  return score
}
// The counts of a detail for one token. `holdsToken` says whether the stack holds the token, which white space
// and comments count as. `entry` is the display entry that gave the kind, -1 for white space and comments.
function countToken(samples: PackedSamples, token: number, kind: number, depth: number, container: number, hash: number, holdsToken: boolean, entry: number, detail: RunDetail) {
  const {groupStart, groupKind, groupDepth, groupContainer, groupStack, groupCount} = samples
  for (let group = groupStart[token]!; group < groupStart[token + 1]!; group++) {
    const count = groupCount[group]!
    const nestingRight = groupDepth[group] === depth && groupContainer[group] === container
    if (groupKind[group] === kind) detail.kindRight += count
    if (groupDepth[group] === depth) detail.depthRight += count
    if (groupContainer[group] === container) detail.containerRight += count
    if (holdsToken && groupStack[group] === hash) detail.stackRight += count
    if (nestingRight && entry !== -1 && detail.wantedKinds !== null) detail.wantedKinds[entry * displayKindCount + groupKind[group]!]! += count
  }
}

// Runs the tables on one packed sample, from the stack at its first open cell to the end of input, and returns the
// packed score. The steps are those of recovery-parser.ts, which says what the rules of a run are.
// - With `cellsRead`, the run sets the bit of every open cell whose choice it applies, from the byte `cellsOffset`
//   on: the bit of a cell is the cell's number, with the copy of the flag in it.
// - With `detail`, the run fills it.
export function runSample(samples: PackedSamples, sample: number, tables: RecoveryTables, cellsRead: Uint8Array | null = null, cellsOffset = 0, detail: RunDetail | null = null): number {
  const {terminalCount, cellsPerCopy, open, display} = tables
  const choices = tables.choice
  const flagged = tables.firstOnLineFlag
  const {terminal: terminals, firstOnLine} = samples
  const {ruleLength, ruleLhs, gotoState, transition, nonterminalCount, symbolCount} = bison
  if (detail !== null) clearDetail(detail)
  let height = 0
  for (let at = samples.stackStart[sample]!; at < samples.stackStart[sample + 1]!; at++) {
    height++
    setState(height, samples.stackState[at]!)
    if (detail !== null) setStateDetail(height, samples.stackState[at]!, samples.stackFirstToken[at]!, samples.stackLastToken[at]!, detail)
  }
  const first = samples.tokenStart[sample]!, end = samples.tokenStart[sample + 1]! - 1
  // A packed token's place in the tokens of the sample's text is its index plus this.
  const placeOffset = samples.firstErrorToken[sample]! - first
  let score = 0
  for (let at = first; at <= end; at++) {
    const terminal = terminals[at]!
    if (terminal < 0) {
      // White space and comments take no step: they are shown with the stack as it is.
      const kind = terminal === packedComment ? displayKind.comment : displayKind.whitespace
      score += scoreOfToken(samples, at, kind, depthAt[height]!, containerAt[height]!)
      if (detail !== null) countToken(samples, at, kind, depthAt[height]!, containerAt[height]!, hashAt[height]!, true, -1, detail)
      continue
    }
    const flagOffset = flagged && firstOnLine[at] === 1 ? cellsPerCopy : 0
    let steps = 0
    // Whether a step of the token has read an open cell.
    let readOpenCell = false
    // The display entry that the token is shown by, and whether the stack holds the token then.
    let entry = -1
    let taken = false
    for (;;) {
      const state = stack[height]!
      if (steps === maximumStepsPerToken) {
        // The 17th step is a skip, whatever the cell holds.
        entry = state * terminalCount + terminal
        if (detail !== null) {
          detail.tokensSkippedByStepLimit++
          if (!readOpenCell) detail.tokensSkippedOnFrozenCellsOnly++
        }
        break
      }
      steps++
      const cell = flagOffset + state * terminalCount + terminal
      if (open[cell] === 1) {
        readOpenCell = true
        if (cellsRead !== null) cellsRead[cellsOffset + (cell >> 3)]! |= 1 << (cell & 7)
        if (detail !== null && detail.reads !== null) detail.reads[cell]!++
      }
      const choice = choices[cell]!
      const kind = choice >> 8
      const argument = choice & 255
      if (kind === kindReduce || kind === kindEndEarly) {
        const dropped = kind === kindReduce ? ruleLength[argument]! : argument >> 4
        const nonterminal = kind === kindReduce ? ruleLhs[argument]! : bisonTerminalCount + (argument & 15)
        if (dropped === 0 && height >= maximumStackHeight) {
          entry = state * terminalCount + terminal
          if (detail !== null) detail.tokensSkippedByStackLimit++
          break
        }
        let firstToken = -1, lastToken = -1
        if (detail !== null) {
          for (let level = height - dropped + 1; level <= height; level++) {
            if (firstTokenAt[level] === -1) continue
            if (firstToken === -1) firstToken = firstTokenAt[level]!
            lastToken = lastTokenAt[level]!
          }
          detail.reductions.push(nonterminal, firstToken, lastToken)
        }
        height -= dropped
        const target = gotoState[stack[height]! * nonterminalCount + nonterminal - bisonTerminalCount]!
        height++
        setState(height, target)
        if (detail !== null) setStateDetail(height, target, firstToken, lastToken, detail)
        continue
      }
      if (kind === kindPop) {
        height--
        continue
      }
      if (kind === kindSkip) {
        entry = state * terminalCount + terminal
        break
      }
      if (kind === kindAccept) break
      // Every other choice pushes a state without dropping one, and needs room on the stack.
      if (height >= maximumStackHeight) {
        entry = state * terminalCount + terminal
        if (detail !== null) detail.tokensSkippedByStackLimit++
        break
      }
      height++
      if (kind === kindShift || kind === kindReadAs) {
        const target = kind === kindShift ? argument : transition[state * symbolCount + argument]!
        setState(height, target)
        if (detail !== null) setStateDetail(height, target, at + placeOffset, at + placeOffset, detail)
        entry = target * terminalCount + terminal
        taken = true
        break
      }
      const target = kind === kindStop ? stopped : transition[state * symbolCount + argument]!
      setState(height, target)
      if (detail !== null) {
        setStateDetail(height, target, -1, -1, detail)
        if (kind === kindInsert) detail.insertedTokens++
      }
    }
    if (detail !== null) {
      detail.steps += steps
      if (steps > detail.mostStepsOfAToken) detail.mostStepsOfAToken = steps
    }
    // The end of input has no code point to show.
    if (at === end) break
    score += scoreOfToken(samples, at, display[entry]!, depthAt[height]!, containerAt[height]!)
    if (detail !== null) {
      detail.tokens++
      countToken(samples, at, display[entry]!, depthAt[height]!, containerAt[height]!, hashAt[height]!, taken, entry, detail)
    }
  }
  return score
}

// The counts of a score, as whole numbers, so that two scores add up and two routes can be compared exactly.
export type Score = {
  samples: number
  scoredCodePoints: number
  allThreeRight: number
  kindRight: number
  depthRight: number
  containerRight: number
  // Samples with all three right at every scored code point.
  wholeSamples: number
  stackRight: number
  // Samples with the stack right at every scored code point.
  wholeSamplesByStack: number
  // The constituents of the originals, of the recovered parses, and the ones that both have.
  originalConstituents: number
  recoveredConstituents: number
  sharedConstituents: number
  // The same three without the constituents that the parser has before it reads the first open cell.
  originalConstituentsAfter: number
  recoveredConstituentsAfter: number
  sharedConstituentsAfter: number
  // The terminals that the recoveries inserted, and the samples with at least one.
  insertedTokens: number
  samplesWithInsertedTokens: number
}
export const emptyScore = (): Score => ({
  samples: 0, scoredCodePoints: 0, allThreeRight: 0, kindRight: 0, depthRight: 0, containerRight: 0, wholeSamples: 0, stackRight: 0, wholeSamplesByStack: 0,
  originalConstituents: 0, recoveredConstituents: 0, sharedConstituents: 0, originalConstituentsAfter: 0, recoveredConstituentsAfter: 0, sharedConstituentsAfter: 0, insertedTokens: 0, samplesWithInsertedTokens: 0,
})

// What the exact loop needed, next to a score of tables.
export type RunTotals = {tokens: number, steps: number, mostStepsOfAToken: number, tokensSkippedByStepLimit: number, tokensSkippedOnFrozenCellsOnly: number, tokensSkippedByStackLimit: number, highestStack: number}

// A score as percentages.
export function sharesOf(score: Score) {
  const share = (count: number, of: number): number => of === 0 ? NaN : 100 * count / of
  return {
    allThree: share(score.allThreeRight, score.scoredCodePoints), whole: share(score.wholeSamples, score.samples),
    kind: share(score.kindRight, score.scoredCodePoints), depth: share(score.depthRight, score.scoredCodePoints), container: share(score.containerRight, score.scoredCodePoints),
    stack: share(score.stackRight, score.scoredCodePoints), wholeByStack: share(score.wholeSamplesByStack, score.samples),
    // Of the original's constituents, the share that the recovered parse has, and of the recovered parse's, the
    // share that the original has.
    constituentsFound: share(score.sharedConstituents, score.originalConstituents), constituentsRight: share(score.sharedConstituents, score.recoveredConstituents),
    constituentsFoundAfter: share(score.sharedConstituentsAfter, score.originalConstituentsAfter), constituentsRightAfter: share(score.sharedConstituentsAfter, score.recoveredConstituentsAfter),
    insertedPerSample: score.samples === 0 ? NaN : score.insertedTokens / score.samples, samplesWithInserted: share(score.samplesWithInsertedTokens, score.samples),
  }
}

// The columns of a score as one row of a markdown table, and the header that names them.
export const scoreHeader = '| parser | all three | whole | kind | depth | container | stack | whole by stack | constituents: found, right | the same without the ones before the first error | inserted per sample |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
export function scoreRow(name: string, score: Score): string {
  const shares = sharesOf(score)
  const number = (value: number, digits = 1): string => Number.isNaN(value) ? 'none' : value.toFixed(digits)
  return `| ${name} | ${number(shares.allThree, 2)} | ${number(shares.whole, 2)} | ${number(shares.kind)} | ${number(shares.depth)} | ${number(shares.container)} | ${number(shares.stack, 2)} | ${number(shares.wholeByStack, 2)} | ${number(shares.constituentsFound)}, ${number(shares.constituentsRight)} | ${number(shares.constituentsFoundAfter)}, ${number(shares.constituentsRightAfter)} | ${number(shares.insertedPerSample, 2)} |`
}

// Sorted keys without repeats: how many keys of `left` are in `right`.
function sharedKeys(left: ArrayLike<number>, leftFrom: number, leftTo: number, right: ArrayLike<number>, rightFrom: number, rightTo: number): number {
  let shared = 0
  let other = rightFrom
  for (let at = leftFrom; at < leftTo; at++) {
    while (other < rightTo && right[other]! < left[at]!) other++
    if (other < rightTo && right[other] === left[at]) shared++
  }
  return shared
}

// Adds the constituents of one sample's run to a score: the ones before the first open cell and the run's own.
function addConstituents(score: Score, samples: PackedSamples, sample: number, reductions: readonly number[]) {
  const {kept, originalKey, prefixKey} = samples
  const keptFrom = samples.keptStart[sample]!
  const prefixFrom = samples.prefixStart[sample]!, prefixTo = samples.prefixStart[sample + 1]!
  const originalFrom = samples.originalStart[sample]!, originalTo = samples.originalStart[sample + 1]!
  const keys = new Set<number>()
  for (let at = prefixFrom; at < prefixTo; at++) keys.add(prefixKey[at]!)
  for (let at = 0; at < reductions.length; at += 3) {
    let firstToken = reductions[at + 1]!, lastToken = reductions[at + 2]!
    if (firstToken === -1) continue
    while (firstToken <= lastToken && kept[keptFrom + firstToken] === 0) firstToken++
    while (lastToken >= firstToken && kept[keptFrom + lastToken] === 0) lastToken--
    if (firstToken <= lastToken) keys.add(constituentKey(reductions[at]!, firstToken, lastToken))
  }
  const recovered = Int32Array.from(keys).sort()
  const shared = sharedKeys(recovered, 0, recovered.length, originalKey, originalFrom, originalTo)
  const prefixShared = sharedKeys(prefixKey, prefixFrom, prefixTo, originalKey, originalFrom, originalTo)
  score.originalConstituents += originalTo - originalFrom
  score.recoveredConstituents += recovered.length
  score.sharedConstituents += shared
  score.originalConstituentsAfter += originalTo - originalFrom - prefixShared
  score.recoveredConstituentsAfter += recovered.length - (prefixTo - prefixFrom)
  score.sharedConstituentsAfter += shared - prefixShared
}

export type ScoreOptions = {
  // When given, the runs count into them, see RunDetail.
  reads?: Int32Array
  wantedKinds?: Int32Array
  // When given: [cell] is set to the number of samples that read the cell.
  readers?: Int32Array
  // When given: called with every sample's place and its code points that are right in all three and in the stack.
  perSample?: (sample: number, allThreeRight: number, stackRight: number) => void
}

// The score of tables on packed samples, and what the loop needed. Throws when the tables break the ground rules
// or call the tokens other terminals than the samples were packed for.
export function scoreTables(tables: RecoveryTables, samples: PackedSamples, options: ScoreOptions = {}): {score: Score, totals: RunTotals} {
  checkTables(tables)
  refuseOtherTerminals(samples, tables)
  const score = emptyScore()
  const totals: RunTotals = {tokens: 0, steps: 0, mostStepsOfAToken: 0, tokensSkippedByStepLimit: 0, tokensSkippedOnFrozenCellsOnly: 0, tokensSkippedByStackLimit: 0, highestStack: 0}
  const detail = createDetail(options.reads ?? null, options.wantedKinds ?? null)
  const cellsRead = options.readers === undefined ? null : new Uint8Array(Math.ceil(tables.choice.length / 8))
  for (let sample = 0; sample < samples.sampleCount; sample++) {
    cellsRead?.fill(0)
    const allThreeRight = Math.floor(runSample(samples, sample, tables, cellsRead, 0, detail) / scorePack)
    score.samples++
    score.scoredCodePoints += samples.scored[sample]!
    score.allThreeRight += allThreeRight
    score.kindRight += detail.kindRight
    score.depthRight += detail.depthRight
    score.containerRight += detail.containerRight
    score.stackRight += detail.stackRight
    if (allThreeRight === samples.scored[sample]) score.wholeSamples++
    if (detail.stackRight === samples.scored[sample]) score.wholeSamplesByStack++
    score.insertedTokens += detail.insertedTokens
    if (detail.insertedTokens > 0) score.samplesWithInsertedTokens++
    addConstituents(score, samples, sample, detail.reductions)
    totals.tokens += detail.tokens
    totals.steps += detail.steps
    totals.mostStepsOfAToken = Math.max(totals.mostStepsOfAToken, detail.mostStepsOfAToken)
    totals.tokensSkippedByStepLimit += detail.tokensSkippedByStepLimit
    totals.tokensSkippedOnFrozenCellsOnly += detail.tokensSkippedOnFrozenCellsOnly
    totals.tokensSkippedByStackLimit += detail.tokensSkippedByStackLimit
    totals.highestStack = Math.max(totals.highestStack, detail.highestStack)
    if (cellsRead !== null) for (let cell = 0; cell < tables.choice.length; cell++) if ((cellsRead[cell >> 3]! & (1 << (cell & 7))) !== 0) options.readers![cell]!++
    options.perSample?.(sample, allThreeRight, detail.stackRight)
  }
  return {score, totals}
}

// The two counts of a packed score over all samples, without a detail: what the search adds up.
export function totalScore(samples: PackedSamples, tables: RecoveryTables): {allRight: number, labelsRight: number} {
  let allRight = 0, labelsRight = 0
  for (let sample = 0; sample < samples.sampleCount; sample++) {
    const score = runSample(samples, sample, tables)
    allRight += Math.floor(score / scorePack)
    labelsRight += score % scorePack
  }
  return {allRight, labelsRight}
}

// What any parser says of a sample's broken text, for scoreOutputs.
export type ParserOutput = {
  // Per token of sample.tokens, white space and comments included: the display kind, the depth and the container
  // that the token is shown with. Only the tokens from the first error's token on are read.
  kind: ArrayLike<number>
  depth: ArrayLike<number>
  container: ArrayLike<number>
  // Per token, for the column "stack": the hash of the symbols on the parser's stack when the token is shown, see
  // stackHashOfSymbols of ../labels.ts, and 1 when the stack holds the token then, i.e. the token was not dropped.
  // White space and comments need no `taken`.
  stack: ArrayLike<number>
  taken: ArrayLike<number>
  // Every reduction of the parse, also before the first error: the nonterminal, and the first and the last token
  // that it covers, as places in sample.tokens, -1 for a reduction that covers no token of the text.
  reductions: Iterable<{nonterminal: number, firstToken: number, lastToken: number}>
  // How many terminals the parser inserted.
  insertedTokens: number
}

// The output of a run of the exact parser, in that form.
export function outputOfRun(run: RecoveryRun): ParserOutput {
  return {kind: run.kind, depth: run.depth, container: run.container, stack: run.stack, taken: Array.from(run.shown, shown => shown === shownShifted || shown === shownReadAs ? 1 : 0), reductions: run.reductions, insertedTokens: run.insertedTokens}
}

// Adds one sample to a score, code point by code point, from a parser's output.
export function addOutputToScore(score: Score, sample: Sample, output: ParserOutput) {
  const {tokens} = sample
  let allThreeRight = 0, stackRight = 0
  for (let token = sample.firstErrorToken; token < tokens.count; token++) {
    const holdsToken = isTrivia(tokens.kind[token]!) || output.taken[token] === 1
    for (let place = tokens.start[token]!; place < tokens.start[token]! + tokens.length[token]!; place++) {
      if (sample.alignment[place] === -1) continue
      const kindRight = output.kind[token] === sample.labelKind[place], depthRight = output.depth[token] === sample.labelDepth[place], containerRight = output.container[token] === sample.labelContainer[place]
      if (kindRight) score.kindRight++
      if (depthRight) score.depthRight++
      if (containerRight) score.containerRight++
      if (kindRight && depthRight && containerRight) allThreeRight++
      if (holdsToken && output.stack[token] === sample.labelStack[place]) stackRight++
    }
  }
  score.samples++
  score.scoredCodePoints += sample.scored
  score.allThreeRight += allThreeRight
  score.stackRight += stackRight
  if (allThreeRight === sample.scored) score.wholeSamples++
  if (stackRight === sample.scored) score.wholeSamplesByStack++
  score.insertedTokens += output.insertedTokens
  if (output.insertedTokens > 0) score.samplesWithInsertedTokens++
  // The constituents, with the functions of ../sample.ts.
  const original = new Set(sample.constituents)
  const recovered = restrictedConstituents(sample, output.reductions)
  const counts = constituentCounts(sample, recovered)
  const prefix = restrictedConstituents(sample, prefixOf(sample).reductions)
  const recoveredSet = new Set(recovered)
  let prefixShared = 0, prefixRecovered = 0
  for (const key of prefix) {
    if (original.has(key)) prefixShared++
    if (recoveredSet.has(key)) prefixRecovered++
  }
  score.originalConstituents += counts.originalCount
  score.recoveredConstituents += counts.recoveredCount
  score.sharedConstituents += counts.shared
  score.originalConstituentsAfter += counts.originalCount - prefixShared
  score.recoveredConstituentsAfter += counts.recoveredCount - prefixRecovered
  score.sharedConstituentsAfter += counts.shared - prefixShared
}

// The score of any parser on samples: `parse` gives the parser's output for a sample.
export function scoreOutputs(samples: readonly Sample[], parse: (sample: Sample) => ParserOutput): Score {
  const score = emptyScore()
  for (const sample of samples) addOutputToScore(score, sample, parse(sample))
  return score
}

// The score of tables by the exact parser of recovery-parser.ts on whole texts: the second route.
export function scoreTablesByExactParser(tables: RecoveryTables, samples: readonly Sample[]): Score {
  checkTables(tables)
  return scoreOutputs(samples, sample => outputOfRun(runRecoveryParserOnTokens(sample.codePoints, sample.tokens, tables)))
}

// The kept code points before the first error, and how many of them the parser shows with another label than the
// original has. Only frozen cells are read there, so no tables change these code points, and no score counts them.
export function wrongBeforeFirstError(samples: readonly Sample[]): {kept: number, wrong: number} {
  const tables = baseTables()
  let kept = 0, wrong = 0
  for (const sample of samples) {
    const run = runRecoveryParserOnTokens(sample.codePoints, sample.tokens, tables)
    for (let token = 0; token < sample.firstErrorToken; token++) {
      for (let place = sample.tokens.start[token]!; place < sample.tokens.start[token]! + sample.tokens.length[token]!; place++) {
        if (sample.alignment[place] === -1) continue
        kept++
        if (run.kind[token] !== sample.labelKind[place] || run.depth[token] !== sample.labelDepth[place] || run.container[token] !== sample.labelContainer[place]) wrong++
      }
    }
  }
  return {kept, wrong}
}

// What a score prints next to its row: the numbers of the samples and of the loop. The inserted tokens and the
// tokens skipped after 16 steps go together: tables can skip a token by going in a circle, e.g. insert a token and
// pop it again until the steps are used up, and every round counts as an inserted token.
export function describeTotals(samples: PackedSamples, score: Score, totals: RunTotals): string {
  return `${score.samples} samples with ${score.scoredCodePoints} scored code points. One output per token allows at most ${(100 * samples.boundCodePoints / samples.scoredCodePoints).toFixed(2)}% of all three. `
    + `${(totals.steps / Math.max(1, totals.tokens)).toFixed(2)} steps per token, at most ${totals.mostStepsOfAToken}. ${totals.tokensSkippedByStepLimit} tokens were skipped after ${maximumStepsPerToken} steps, ${totals.tokensSkippedOnFrozenCellsOnly} of them after steps at frozen cells only, and ${totals.tokensSkippedByStackLimit} at the limit of the stack, whose highest was ${totals.highestStack} states. `
    + `${score.insertedTokens} tokens inserted, in ${score.samplesWithInsertedTokens} samples.`
}

if (import.meta.main) {
  refuseUnknownOptions('score.ts', ['--tables', '--split', '--count'])
  const split = optionOf('--split') ?? 'validation'
  if (split !== 'train' && split !== 'validation') throw new Error(`--split is train or validation, and got ${split}`)
  const tablesFile = optionOf('--tables')
  const tables = tablesFile === undefined ? baseTables() : loadTablesForReport(tablesFile).tables
  const samples = loadPacked(split, numberOf('--count', standardValidationCount), tables)
  const {score, totals} = scoreTables(tables, samples)
  console.log(`The ${split} split, ${tablesFile ?? 'the parser as it is'}:`)
  console.log(scoreHeader)
  console.log(scoreRow(tablesFile === undefined ? 'the parser as it is' : 'the tables', score))
  console.log(describeTotals(samples, score, totals))
}
