// Samples as the scorer and the search hold them: packed into typed arrays in shared memory, with only what a run
// from the first error on needs. A Sample of ../sample.ts holds a whole broken text with a label per code point,
// about 20 KB each. A run only needs the tokens from the first error's token on, the stack there, and per token
// how many of its kept code points want which label.
//
// packSamples takes the tables whose terminals the samples will be run with: a BADCHAR token of a picked code
// point is packed as the code point's own terminal, see addTerminals of recovery-tables.ts.
import {type Split, defaultSeed, sampleAt} from '../dataset.ts'
import {firstOnLineOf} from '../parser.ts'
import {type Sample, restrictedConstituents} from '../sample.ts'
import {scoredOutOfReach} from '../stats.ts'
import {actionReduce, actionShift, commentKind, isTrivia} from '../tables.ts'
import {type RecoveryTables, baseTables, bison, bisonTerminalCount, terminalOfToken, terminalsKeyOf} from './recovery-tables.ts'

// What a packed token holds in place of a terminal when it is white space or a comment.
export const packedWhitespace = -1, packedComment = -2

export type PackedSamples = {
  sampleCount: number
  // A key of the added terminals that the tokens were packed with, see terminalsKeyOf.
  terminalsKey: string
  // Over all samples: the scored code points, and the most of them that a parser of the experiment can have right
  // in all three: the scored code points without scoredOutOfReach of ../stats.ts. Such a parser shows a token with
  // one kind, shows white space as white space, and shows a token and the white space and comments after it with
  // one depth and one container. A token can hold kept code points of two tokens of the original, e.g. the `xy`
  // that is left of `x y`, and the spaces on both sides of a removed `then` are one run of white space with two
  // containers. It is an upper bound and no more: frozen cells and frozen display entries put more out of reach.
  scoredCodePoints: number
  boundCodePoints: number
  // The tokens of sample s are the entries tokenStart[s] to tokenStart[s + 1] - 1 of the arrays per token: the
  // tokens from the first error's token on, white space and comments included, and the end of input as the last.
  tokenStart: Int32Array
  // Per token: the terminal, or packedWhitespace or packedComment. And 1 when the token is the first on its line.
  terminal: Int16Array
  firstOnLine: Uint8Array
  // The labels that the kept code points of token t want are the groups groupStart[t] to groupStart[t + 1] - 1:
  // a display kind, a depth, a container and a hash of the stack's symbols, with the number of code points that
  // want exactly these four.
  groupStart: Int32Array
  groupKind: Int8Array
  groupDepth: Int16Array
  groupContainer: Int8Array
  groupStack: Int32Array
  groupCount: Int16Array
  // Per sample: the place of its first packed token in the tokens of its text, its scored code points, and its
  // share of boundCodePoints.
  firstErrorToken: Int32Array
  scored: Int32Array
  bound: Int32Array
  // The stack when the first open cell is read: the entries stackStart[s] to stackStart[s + 1] - 1, from the
  // bottom, with the first and the last token that each state covers, as places in the text's tokens, -1 for none.
  stackStart: Int32Array
  stackState: Uint8Array
  stackFirstToken: Int16Array
  stackLastToken: Int16Array
  // For the column "constituents". Per token of the whole text of sample s, from keptStart[s]: 1 for a kept token.
  keptStart: Int32Array
  kept: Uint8Array
  // The original's constituents, restricted to the kept tokens, as sorted keys, see constituentKey of ../sample.ts:
  // the entries originalStart[s] to originalStart[s + 1] - 1.
  originalStart: Int32Array
  originalKey: Int32Array
  // The same for the constituents that the parser has before it reads the first open cell. Every parser of the
  // experiment has them, whatever its open cells hold.
  prefixStart: Int32Array
  prefixKey: Int32Array
}

const arrayFields = [
  'tokenStart', 'terminal', 'firstOnLine', 'groupStart', 'groupKind', 'groupDepth', 'groupContainer', 'groupStack', 'groupCount', 'firstErrorToken', 'scored', 'bound', 'stackStart', 'stackState',
  'stackFirstToken', 'stackLastToken', 'keptStart', 'kept', 'originalStart', 'originalKey', 'prefixStart', 'prefixKey',
] as const

// What the parser does before it reads the first open cell of a sample's text: its reductions, and the first and
// the last token under every state of the stack that it has there. Only frozen cells are read up to there.
export function prefixOf(sample: Sample): {reductions: {nonterminal: number, firstToken: number, lastToken: number}[], firstTokenOf: number[], lastTokenOf: number[]} {
  const {tokens} = sample
  const stack = [bison.startState]
  const firstTokenOf = [-1], lastTokenOf = [-1]
  const reductions: {nonterminal: number, firstToken: number, lastToken: number}[] = []
  for (let token = 0; token <= sample.firstErrorToken; token++) {
    if (isTrivia(tokens.kind[token]!)) continue
    for (;;) {
      const cell = stack.at(-1)! * bisonTerminalCount + tokens.kind[token]!
      if (bison.frozen[cell] === 0) {
        if (token !== sample.firstErrorToken) throw new Error(`sample ${sample.id}: token ${token} reads an open cell before the first error`)
        break
      }
      if (bison.actionKind[cell] === actionShift) {
        if (token === sample.firstErrorToken) throw new Error(`sample ${sample.id}: the first error's token is shifted without reading an open cell`)
        stack.push(bison.actionArgument[cell]!)
        firstTokenOf.push(token)
        lastTokenOf.push(token)
        break
      }
      if (bison.actionKind[cell] !== actionReduce) throw new Error(`sample ${sample.id}: the text is accepted before its first error`)
      const rule = bison.actionArgument[cell]!
      let firstToken = -1, lastToken = -1
      for (let dropped = 0; dropped < bison.ruleLength[rule]!; dropped++) {
        stack.pop()
        const lastBelow = lastTokenOf.pop()!, firstBelow = firstTokenOf.pop()!
        if (firstBelow === -1) continue
        firstToken = firstBelow
        if (lastToken === -1) lastToken = lastBelow
      }
      stack.push(bison.gotoState[stack.at(-1)! * bison.nonterminalCount + bison.ruleLhs[rule]! - bisonTerminalCount]!)
      firstTokenOf.push(firstToken)
      lastTokenOf.push(lastToken)
      reductions.push({nonterminal: bison.ruleLhs[rule]!, firstToken, lastToken})
    }
  }
  if (stack.length !== sample.startStack.length || stack.some((state, level) => state !== sample.startStack[level])) throw new Error(`sample ${sample.id}: the stack at the first open cell is not the sample's`)
  return {reductions, firstTokenOf, lastTokenOf}
}

// A packer for the tables `layout`, e.g. the tables that a search starts from: `add` takes one sample after
// another, and `finish` gives the packed samples.
export function createPacker(layout: RecoveryTables): {add: (sample: Sample) => void, finish: () => PackedSamples} {
  const tokenStart: number[] = [0], terminal: number[] = [], firstOnLine: number[] = []
  const groupStart: number[] = [0], groupKind: number[] = [], groupDepth: number[] = [], groupContainer: number[] = [], groupStack: number[] = [], groupCount: number[] = []
  const firstErrorToken: number[] = [], scored: number[] = [], bound: number[] = []
  const stackStart: number[] = [0], stackState: number[] = [], stackFirstToken: number[] = [], stackLastToken: number[] = []
  const keptStart: number[] = [0], kept: number[] = [], originalStart: number[] = [0], originalKey: number[] = [], prefixStart: number[] = [0], prefixKey: number[] = []
  let scoredCodePoints = 0, boundCodePoints = 0, sampleCount = 0
  const add = (sample: Sample) => {
    sampleCount++
    const {tokens} = sample
    const flags = firstOnLineOf(tokens)
    let scoredOfSample = 0
    for (let token = sample.firstErrorToken; token < tokens.count; token++) {
      const kind = tokens.kind[token]!
      const from = tokens.start[token]!, to = from + tokens.length[token]!
      terminal.push(!isTrivia(kind) ? terminalOfToken(layout, kind, sample.codePoints[from]!) : kind === commentKind ? packedComment : packedWhitespace)
      firstOnLine.push(flags[token]!)
      // The groups of the token.
      const groupsFrom = groupKind.length
      for (let place = from; place < to; place++) {
        if (sample.alignment[place] === -1) continue
        scoredOfSample++
        const labelKind = sample.labelKind[place]!, labelDepth = sample.labelDepth[place]!, labelContainer = sample.labelContainer[place]!, labelStack = sample.labelStack[place]!
        let group = groupsFrom
        while (group < groupKind.length && (groupKind[group] !== labelKind || groupDepth[group] !== labelDepth || groupContainer[group] !== labelContainer || groupStack[group] !== labelStack)) group++
        if (group === groupKind.length) {
          groupKind.push(labelKind)
          groupDepth.push(labelDepth)
          groupContainer.push(labelContainer)
          groupStack.push(labelStack)
          groupCount.push(0)
        }
        groupCount[group]!++
      }
      groupStart.push(groupKind.length)
    }
    // The end of input: no code point, no label.
    terminal.push(bison.endSymbol)
    firstOnLine.push(flags[tokens.count]!)
    groupStart.push(groupKind.length)
    tokenStart.push(terminal.length)
    if (scoredOfSample !== sample.scored) throw new Error(`sample ${sample.id}: ${scoredOfSample} kept code points from the first error on, and the sample says ${sample.scored}`)
    const boundOfSample = scoredOfSample - scoredOutOfReach(sample)
    firstErrorToken.push(sample.firstErrorToken)
    scored.push(scoredOfSample)
    bound.push(boundOfSample)
    scoredCodePoints += scoredOfSample
    boundCodePoints += boundOfSample

    const prefix = prefixOf(sample)
    for (let level = 0; level < sample.startStack.length; level++) {
      stackState.push(sample.startStack[level]!)
      stackFirstToken.push(prefix.firstTokenOf[level]!)
      stackLastToken.push(prefix.lastTokenOf[level]!)
    }
    stackStart.push(stackState.length)
    for (let token = 0; token < tokens.count; token++) kept.push(sample.keptToken[token] === -1 ? 0 : 1)
    keptStart.push(kept.length)
    for (const key of sample.constituents) originalKey.push(key)
    originalStart.push(originalKey.length)
    for (const key of restrictedConstituents(sample, prefix.reductions)) prefixKey.push(key)
    prefixStart.push(prefixKey.length)
  }
  const shared = <Typed extends {set: (values: number[]) => void}>(create: new (buffer: SharedArrayBuffer) => Typed, bytesPerEntry: number, values: number[]): Typed => {
    const array = new create(new SharedArrayBuffer(Math.max(1, values.length) * bytesPerEntry))
    array.set(values)
    return array
  }
  const finish = (): PackedSamples => ({
    sampleCount, terminalsKey: terminalsKeyOf(layout), scoredCodePoints, boundCodePoints,
    tokenStart: shared(Int32Array, 4, tokenStart), terminal: shared(Int16Array, 2, terminal), firstOnLine: shared(Uint8Array, 1, firstOnLine),
    groupStart: shared(Int32Array, 4, groupStart), groupKind: shared(Int8Array, 1, groupKind), groupDepth: shared(Int16Array, 2, groupDepth), groupContainer: shared(Int8Array, 1, groupContainer),
    groupStack: shared(Int32Array, 4, groupStack), groupCount: shared(Int16Array, 2, groupCount),
    firstErrorToken: shared(Int32Array, 4, firstErrorToken), scored: shared(Int32Array, 4, scored), bound: shared(Int32Array, 4, bound),
    stackStart: shared(Int32Array, 4, stackStart), stackState: shared(Uint8Array, 1, stackState), stackFirstToken: shared(Int16Array, 2, stackFirstToken), stackLastToken: shared(Int16Array, 2, stackLastToken),
    keptStart: shared(Int32Array, 4, keptStart), kept: shared(Uint8Array, 1, kept), originalStart: shared(Int32Array, 4, originalStart), originalKey: shared(Int32Array, 4, originalKey),
    prefixStart: shared(Int32Array, 4, prefixStart), prefixKey: shared(Int32Array, 4, prefixKey),
  })
  return {add, finish}
}

// Packs samples for the tables `layout`. Without it, the terminals are bison's.
export function packSamples(samples: readonly Sample[], layout: RecoveryTables = baseTables()): PackedSamples {
  const packer = createPacker(layout)
  for (const sample of samples) packer.add(sample)
  return packer.finish()
}

// Throws when `tables` call a token another terminal than the tables that `samples` were packed for.
export function refuseOtherTerminals(samples: PackedSamples, tables: RecoveryTables) {
  if (samples.terminalsKey !== terminalsKeyOf(tables)) throw new Error('the samples were packed for other added terminals than the ones of the tables: pass the tables, or tables with the same added terminals, to packSamples')
}

// What a worker thread needs of the samples: the arrays, which are shared, and the numbers.
export function messageOf(samples: PackedSamples) {
  return {sampleCount: samples.sampleCount, terminalsKey: samples.terminalsKey, scoredCodePoints: samples.scoredCodePoints, boundCodePoints: samples.boundCodePoints, arrays: arrayFields.map(field => samples[field])}
}
export function samplesOfMessage(message: ReturnType<typeof messageOf>): PackedSamples {
  const samples: Record<string, unknown> = {sampleCount: message.sampleCount, terminalsKey: message.terminalsKey, scoredCodePoints: message.scoredCodePoints, boundCodePoints: message.boundCodePoints}
  arrayFields.forEach((field, index) => { samples[field] = message.arrays[index] })
  return samples as unknown as PackedSamples
}

// The first `count` samples of a split of the dataset, one at a time: the samples of loadSamples(split, seed, count),
// without 40,000 of them, about 900 MB, in memory at once.
export function* eachSample(split: Split, count: number, seed: number = defaultSeed): Generator<Sample> {
  let made = 0
  for (let index = 0; made < count; index++) {
    const {sample, split: splitOfSample} = sampleAt(seed, index)
    if (splitOfSample !== split) continue
    made++
    yield sample
  }
}

// The first `count` samples of a split of the dataset, packed for `layout`.
export function loadPacked(split: Split, count: number, layout: RecoveryTables = baseTables(), seed: number = defaultSeed): PackedSamples {
  const packer = createPacker(layout)
  for (const sample of eachSample(split, count, seed)) packer.add(sample)
  return packer.finish()
}
