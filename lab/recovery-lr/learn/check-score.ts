// Checks the scores:
// 1. Two routes give the same counts. scoreTables runs the loop of score.ts on packed samples, from the first
//    error on, with the labels as groups per token. scoreTablesByExactParser runs the exact parser of
//    recovery-parser.ts on the whole text and counts code point by code point with the functions of ../sample.ts.
//    All 17 counts of a score are compared, for the base, the two bars that are tables, and random settings of
//    every open cell in every layout. The loop's own numbers, e.g. the steps, are compared with the exact parser's too.
// 2. Samples by hand, each with one changed cell that repairs it, get the score that a person would give: every
//    scored code point right in all three and in the stack, every constituent of the original found.
// 3. One repair is known for a whole set: a `#` between two tokens of a valid program is to be skipped. Tables
//    that skip every character that starts no token have everything right on 400 such samples.
// 4. No tables have more code points right than one output per token allows, sample by sample.
// 5. The kept code points that are wrong before the first error are counted a second way, with the plain parser.
// 6. Panic mode, which is no table: before the first error it has the plain parser's output and reductions, and
//    its score with every dropped token shown as an error is no higher than with the count.
//
// Run from the repo root: bun lab/recovery-lr/learn/check-score.ts
import {defaultSeed, loadSamples, programAt} from '../dataset.ts'
import {containerNames, containerOf, depthOf, displayKind, displayOfState} from '../labels.ts'
import {parse} from '../parser.ts'
import {createRandom} from '../random.ts'
import {type Sample, alignmentOfTexts, makeSample} from '../sample.ts'
import {commentKind, isTrivia, symbolOf} from '../tables.ts'
import {kindsOfDroppedTokensByCount, panicMode, popTables, skipTables} from './bars.ts'
import {packSamples, prefixOf} from './data.ts'
import {runRecoveryParserOnTokens, shownSkippedByStepLimit} from './recovery-parser.ts'
import {
  type RecoveryTables, addFirstOnLineFlag, addTerminals, badCharacter, baseTables, bison, bisonTerminalCount, cellOf, choiceSkip, choicesOf, endEarlyOf, insertOf, maximumStepsPerToken, randomizeOpenCells, readAs,
  stateCount, withoutEndEarly,
} from './recovery-tables.ts'
import {type Score, createDetail, runSample, scoreOutputs, scorePack, scoreTables, scoreTablesByExactParser, sharesOf, wrongBeforeFirstError} from './score.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 30) console.log(`PROBLEM: ${text}`)
}
const expect = (holds: boolean, text: () => string) => {
  if (!holds) problem(text())
}
const train = loadSamples('train', defaultSeed, 1500), validation = loadSamples('validation', defaultSeed, 700)
const samples = [...train, ...validation]
const sameScore = (left: Score, right: Score): boolean => (Object.keys(left) as (keyof Score)[]).every(name => left[name] === right[name])

// 1. Two routes.
{
  const picked = [{name: 'ampersand', codePoint: 0x26}, {name: 'colon', codePoint: 0x3a}, {name: 'backslash', codePoint: 0x5c}]
  const settings: [string, RecoveryTables][] = [['the base', baseTables()], ['skip every rejected token', skipTables()], ['pop where bison reports', popTables()]]
  for (let setting = 0; setting < 12; setting++) {
    let tables = baseTables()
    if (setting % 4 === 3) tables = withoutEndEarly(tables)
    if (setting % 3 === 1) tables = addTerminals(tables, picked)
    if (setting % 2 === 1) tables = addFirstOnLineFlag(tables)
    randomizeOpenCells(tables, createRandom(51, setting))
    settings.push([`random setting ${setting}`, tables])
  }
  let codePoints = 0, constituents = 0, steps = 0, skippedByStepLimit = 0, skippedOnFrozenCellsOnly = 0
  for (const [name, tables] of settings) {
    const packed = packSamples(samples, tables)
    const {score, totals} = scoreTables(tables, packed)
    const byExactParser = scoreTablesByExactParser(tables, samples)
    expect(sameScore(score, byExactParser), () => `${name}: the loop counts ${JSON.stringify(score)} and the exact parser ${JSON.stringify(byExactParser)}`)
    expect(score.samples === samples.length && score.scoredCodePoints === samples.reduce((sum, sample) => sum + sample.scored, 0), () => `${name}: the score is of ${score.samples} samples and ${score.scoredCodePoints} code points`)
    // The loop's own numbers against the exact parser's, sample by sample.
    const detail = createDetail()
    let stepsOfLoop = 0, stepsOfParser = 0, tokensSkippedByStepLimit = 0, tokensSkippedOnFrozenCellsOnly = 0, highest = 0
    samples.forEach((sample, place) => {
      runSample(packed, place, tables, null, 0, detail)
      const run = runRecoveryParserOnTokens(sample.codePoints, sample.tokens, tables)
      const stepsOfRun = run.steps.reduce((sum, count) => sum + count, 0) + run.stepsAtEnd
      // The tokens that the exact parser skips after 16 steps, and the ones of them at which it reads no open
      // cell. With fewer than 16 steps at the end of input, the end is not one of them.
      if (run.stepsAtEnd < maximumStepsPerToken) {
        const tokensWithOpenCell = new Set(run.cellsReadAtToken)
        let skipped = 0, onFrozenCellsOnly = 0
        run.shown.forEach((shown, token) => {
          if (shown !== shownSkippedByStepLimit) return
          skipped++
          if (!tokensWithOpenCell.has(token)) onFrozenCellsOnly++
        })
        if (detail.tokensSkippedByStepLimit !== skipped || detail.tokensSkippedOnFrozenCellsOnly !== onFrozenCellsOnly) problem(`${name}, sample ${sample.id}: the loop skips ${detail.tokensSkippedByStepLimit} tokens after ${maximumStepsPerToken} steps, ${detail.tokensSkippedOnFrozenCellsOnly} of them at frozen cells only, and the exact parser ${skipped} and ${onFrozenCellsOnly}`)
      }
      tokensSkippedOnFrozenCellsOnly += detail.tokensSkippedOnFrozenCellsOnly
      // The exact parser's highest stack is of the whole text, and the loop's from the first error on.
      const loopsHighest = Math.max(detail.highestStack, sample.startStack.length)
      if (detail.steps !== stepsOfRun || detail.insertedTokens !== run.insertedTokens || loopsHighest > run.highestStack) problem(`${name}, sample ${sample.id}: the loop takes ${detail.steps} steps and inserts ${detail.insertedTokens} tokens, and the exact parser ${stepsOfRun} and ${run.insertedTokens}`)
      const reductionsFromError = run.reductions.length - prefixOf(sample).reductions.length
      if (detail.reductions.length !== 3 * reductionsFromError) problem(`${name}, sample ${sample.id}: the loop makes ${detail.reductions.length / 3} reductions from the first error on, and the exact parser ${reductionsFromError}`)
      stepsOfLoop += detail.steps
      stepsOfParser += stepsOfRun
      tokensSkippedByStepLimit += detail.tokensSkippedByStepLimit
      highest = Math.max(highest, detail.highestStack)
    })
    expect(stepsOfLoop === totals.steps && stepsOfLoop === stepsOfParser && tokensSkippedByStepLimit === totals.tokensSkippedByStepLimit && tokensSkippedOnFrozenCellsOnly === totals.tokensSkippedOnFrozenCellsOnly && highest === totals.highestStack, () => `${name}: the totals of the loop are not the sums of its runs`)
    codePoints += score.scoredCodePoints
    constituents += score.recoveredConstituents
    steps += totals.steps
    skippedByStepLimit += totals.tokensSkippedByStepLimit
    skippedOnFrozenCellsOnly += totals.tokensSkippedOnFrozenCellsOnly
  }
  console.log(`1. ${settings.length} tables on ${samples.length} samples: the loop of score.ts and the exact parser on whole texts give the same 17 counts, over ${codePoints} scored code points and ${constituents} constituents, and the same steps, ${steps}, inserted tokens and reductions sample by sample. They skip the same ${skippedByStepLimit} tokens after ${maximumStepsPerToken} steps, ${skippedOnFrozenCellsOnly} of them after steps at frozen cells only.`)
}

// 2. Samples by hand, each repaired by one cell.
{
  const make = (original: string, broken: string): Sample => {
    const sample = makeSample({id: broken, original, broken, alignment: alignmentOfTexts(original, broken)})
    if (typeof sample === 'string') throw new Error(`${JSON.stringify(broken)} is no sample: ${sample}`)
    return sample
  }
  // The state that the run of the base is in when it stops: where the repair goes.
  const stateWhereTheBaseStops = (sample: Sample): number => runRecoveryParserOnTokens(sample.codePoints, sample.tokens, baseTables()).stackAtEnd.at(-2)!
  const cases: {what: string, sample: Sample, terminal: string, choiceOf: (state: number) => number, kindShown?: [terminal: string, as: string], inserted: number}[] = [
    {what: 'a missing `=` is inserted', sample: make('let x = 1 + 2', 'let x 1 + 2'), terminal: 'INT', choiceOf: () => insertOf(symbolOf('EQ')), inserted: 1},
    {what: 'a missing `then` is inserted', sample: make('let f a b = if a then if b then 1 else 2 else 3', 'let f a b = if a if b then 1 else 2 else 3'), terminal: 'IF', choiceOf: () => insertOf(symbolOf('THEN')), inserted: 1},
    {what: 'an open string is read as a string', sample: make('let x = "abc"\nlet y = 2', 'let x = "abc\nlet y = 2'), terminal: 'BADSTRING', choiceOf: () => readAs(symbolOf('STRING')), kindShown: ['STRING', 'string'], inserted: 0},
    {what: 'an open bracket is ended early', sample: make('let x = (1 + 2) let y = 3', 'let x = (1 + 2 let y = 3'), terminal: 'LET', choiceOf: () => endEarlyOf(2, symbolOf('atom')), inserted: 0},
    {what: 'a stray token is skipped', sample: make('let x = 1 + 2', 'let x = 1 + ) 2'), terminal: 'RPAREN', choiceOf: () => choiceSkip, inserted: 0},
  ]
  for (const {what, sample, terminal, choiceOf, kindShown, inserted} of cases) {
    const tables = baseTables()
    const state = stateWhereTheBaseStops(sample)
    const cell = cellOf(tables, state, symbolOf(terminal))
    const choice = choiceOf(state)
    if (tables.open[cell] !== 1 || !choicesOf(tables, cell).includes(choice)) {
      problem(`${what}: the cell of state ${state} and ${terminal} does not have the repair in its list`)
      continue
    }
    tables.choice[cell] = choice
    // A token that is read as another one is shown by an open display entry.
    if (kindShown !== undefined) tables.display[bison.transition[state * bison.symbolCount + symbolOf(kindShown[0])]! * tables.terminalCount + symbolOf(terminal)] = displayKind[kindShown[1] as keyof typeof displayKind]
    for (const [route, score] of [['the loop', scoreTables(tables, packSamples([sample], tables)).score], ['the exact parser', scoreTablesByExactParser(tables, [sample])]] as const) {
      const right = score.allThreeRight === sample.scored && score.stackRight === sample.scored && score.wholeSamples === 1 && score.wholeSamplesByStack === 1
      const constituentsFound = score.sharedConstituents === score.originalConstituents && score.sharedConstituents === score.recoveredConstituents && score.sharedConstituentsAfter === score.originalConstituentsAfter && score.originalConstituentsAfter > 0
      expect(right && constituentsFound && score.insertedTokens === inserted, () => `${what}, ${JSON.stringify(sample.broken)}, by ${route}: ${JSON.stringify(score)}`)
    }
    const before = scoreTables(baseTables(), packSamples([sample])).score
    expect(before.allThreeRight < sample.scored && before.sharedConstituentsAfter < before.originalConstituentsAfter, () => `${what}: the base has ${JSON.stringify(sample.broken)} right already`)
  }
  // What the labels of a repaired sample are, written out: the 1 of `let x 1 + 2` is a constant at depth 1 in the
  // container `=`, as in `let x = 1 + 2`.
  const missingEquals = cases[0]!.sample
  expect(missingEquals.scored === 5 && missingEquals.labelKind[6] === displayKind.constant && missingEquals.labelDepth[6] === 1 && containerNames[missingEquals.labelContainer[6]!] === '=', () => 'the labels of let x 1 + 2')
  console.log(`2. ${cases.length} samples by hand, e.g. ${JSON.stringify(cases[3]!.sample.broken)}: with the one cell that repairs each, every scored code point is right in all three and in the stack, the recovered parse has exactly the original's constituents, and the inserted tokens are counted. With the base none of them is right.`)
}

// 3. A `#` to skip.
{
  const tables = baseTables()
  for (let state = 0; state < stateCount; state++) tables.choice[cellOf(tables, state, badCharacter)] = choiceSkip
  const repaired: Sample[] = []
  for (let index = 0; repaired.length < 400; index++) {
    const {text, labels} = programAt(defaultSeed, index)
    const random = createRandom(defaultSeed + 9, index)
    const realTokens = Array.from({length: labels.tokens.count}, (_, token) => token).filter(token => !isTrivia(labels.tokens.kind[token]!))
    if (realTokens.length < 2) continue
    const after = random.pick(realTokens.slice(0, -1))
    const at = labels.tokens.start[after]! + labels.tokens.length[after]!
    const broken = `${String.fromCodePoint(...labels.codePoints.slice(0, at))} # ${String.fromCodePoint(...labels.codePoints.slice(at))}`
    const sample = makeSample({id: `a # in program ${index}`, original: text, broken, alignment: alignmentOfTexts(text, broken)}, labels)
    if (typeof sample !== 'string') repaired.push(sample)
  }
  for (const [route, score] of [['the loop', scoreTables(tables, packSamples(repaired, tables)).score], ['the exact parser', scoreTablesByExactParser(tables, repaired)]] as const) {
    expect(score.allThreeRight === score.scoredCodePoints && score.stackRight === score.scoredCodePoints && score.wholeSamples === repaired.length && score.sharedConstituents === score.originalConstituents && score.sharedConstituents === score.recoveredConstituents && score.insertedTokens === 0,
      () => `a # to skip, by ${route}: ${JSON.stringify(score)}`)
  }
  const base = sharesOf(scoreTables(baseTables(), packSamples(repaired)).score)
  console.log(`3. ${repaired.length} programs with a # between two tokens, and tables that skip every character that starts no token: every scored code point is right in all three and in the stack, and the recovered parse has exactly the original's constituents. The base has ${base.allThree.toFixed(1)}% of all three there.`)
}

// 4. The bound of one output per token.
{
  let checked = 0
  for (let setting = 0; setting < 4; setting++) {
    const tables = setting === 0 ? skipTables() : baseTables()
    if (setting > 0) randomizeOpenCells(tables, createRandom(52, setting))
    const packed = packSamples(samples, tables)
    for (let place = 0; place < packed.sampleCount; place++) {
      const right = Math.floor(runSample(packed, place, tables) / scorePack)
      if (right > packed.bound[place]! || packed.bound[place]! > packed.scored[place]!) problem(`sample ${samples[place]!.id}: ${right} code points right, where one output per token allows ${packed.bound[place]} of ${packed.scored[place]}`)
      checked++
    }
    expect(packed.boundCodePoints === packed.bound.reduce((sum, count) => sum + count, 0) && packed.scoredCodePoints === packed.scored.reduce((sum, count) => sum + count, 0), () => 'the totals of the packed samples are not the sums of their samples')
  }
  const packed = packSamples(samples)
  console.log(`4. In ${checked} runs no sample has more code points right than one output per token allows, which is ${(100 * packed.boundCodePoints / packed.scoredCodePoints).toFixed(2)}% of the scored code points of these samples.`)
}

// 5. Wrong before the first error.
{
  const counted = wrongBeforeFirstError(train)
  // A second way: the plain parser's shifts, and the labels of ../labels.ts by states.
  let kept = 0, wrong = 0
  for (const sample of train) {
    const {tokens} = sample
    const kind = new Int8Array(tokens.count), depth = new Int16Array(tokens.count), container = new Int8Array(tokens.count)
    const show = (token: number, tokenKind: number, stack: readonly number[]) => {
      for (let at = token; at < tokens.count && (at === token || isTrivia(tokens.kind[at]!)); at++) {
        kind[at] = at === token && tokenKind !== -1 ? tokenKind : tokens.kind[at] === commentKind ? displayKind.comment : displayKind.whitespace
        depth[at] = depthOf(stack)
        container[at] = containerOf(stack)
      }
    }
    if (isTrivia(tokens.kind[0]!)) show(0, -1, [bison.startState])
    parse(tokens, sample.codePoints.length, {shift: (token, state, stack) => show(token, displayOfState[state]!, stack)})
    for (let place = 0; place < sample.firstErrorPosition; place++) {
      if (sample.alignment[place] === -1) continue
      let token = 0
      while (tokens.start[token]! + tokens.length[token]! <= place) token++
      kept++
      if (kind[token] !== sample.labelKind[place] || depth[token] !== sample.labelDepth[place] || container[token] !== sample.labelContainer[place]) wrong++
    }
  }
  expect(counted.kept === kept && counted.wrong === wrong && wrong > 0, () => `wrongBeforeFirstError counts ${counted.wrong} of ${counted.kept}, and the plain parser ${wrong} of ${kept}`)
  console.log(`5. Before the first error, ${wrong} of the ${kept} kept code points of ${train.length} train samples, ${(100 * wrong / kept).toFixed(1)}%, are shown with another label than the original has, by two counts. No tables change them and no score counts them.`)
}

// 6. Panic mode.
{
  const errors = new Int8Array(bisonTerminalCount).fill(displayKind.error)
  let tokensBefore = 0
  for (const sample of validation) {
    const run = runRecoveryParserOnTokens(sample.codePoints, sample.tokens, baseTables())
    for (const keepReductions of [false, true]) {
      const output = panicMode(sample, errors, keepReductions)
      for (let token = 0; token < sample.firstErrorToken; token++) {
        tokensBefore++
        if (output.kind[token] !== run.kind[token] || output.depth[token] !== run.depth[token] || output.container[token] !== run.container[token] || output.stack[token] !== run.stack[token] || (output.taken[token] === 1) === isTrivia(sample.tokens.kind[token]!)) {
          problem(`panic mode, sample ${sample.id}: token ${token} before the first error is shown otherwise than by the parser`)
          break
        }
      }
      // The parser's reductions before the first error's token, and with `keepReductions` also the ones that it
      // makes at that token before it reads the open cell.
      const before = keepReductions ? prefixOf(sample).reductions : run.reductions.filter(reduction => reduction.atToken < sample.firstErrorToken), all = [...output.reductions]
      if (!before.every((reduction, place) => all[place]?.nonterminal === reduction.nonterminal && all[place].firstToken === reduction.firstToken && all[place].lastToken === reduction.lastToken)) problem(`panic mode, sample ${sample.id}: its reductions before the first error are not the parser's`)
    }
  }
  const shownAsErrors = scoreOutputs(validation, sample => panicMode(sample, errors))
  const counted = kindsOfDroppedTokensByCount(train, panicMode)
  const withCount = scoreOutputs(train, sample => panicMode(sample, counted)), withoutCount = scoreOutputs(train, sample => panicMode(sample, errors))
  expect(withCount.allThreeRight >= withoutCount.allThreeRight && withCount.stackRight === withoutCount.stackRight && withCount.sharedConstituents === withoutCount.sharedConstituents, () => 'the count lowers the score of panic mode on the samples that it was made on, or changes what it does')
  expect(shownAsErrors.insertedTokens === 0 && shownAsErrors.allThreeRight > scoreTablesByExactParser(skipTables(), validation).allThreeRight, () => 'panic mode has no more right than skipping every rejected token')
  console.log(`6. Panic mode on ${validation.length} validation samples, in both variants: each of ${tokensBefore} tokens before a first error is shown as the parser shows it, with the parser's reductions. On the train samples the count raises its all three from ${sharesOf(withoutCount).allThree.toFixed(2)} to ${sharesOf(withCount).allThree.toFixed(2)}.`)
}

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
