// Checks the bar "cheapest repair":
// 1. On valid programs the bar gives the labels exactly: the display kind, the depth, the container and the hash
//    of the stack at every code point, and the original's constituents. It never starts a search there.
// 2. The search against a search that tries everything, on the first error of broken samples, with the parser
//    step of ../../../explore.ts, which is not the search's own:
//    - what the search returns is a repair by the definition of repair.ts,
//    - where it returns one edit, no single edit ranks higher (gets further, then takes out fewer tokens, then
//      stands nearer to the rejected token),
//    - where it returns two edits, no single edit is a repair, and on some of these samples no pair ranks higher,
//    - where it returns more or nothing, no single edit is a repair.
// 3. The whole bar on broken samples. Where every rejected token got a repair of the search, the tokens with all
//    edits made are a valid program for the plain parser, and the bar's output is what the plain parser has when
//    it reads the edited tokens: every shifted token with its display kind, depth, container and stack, every
//    token that was taken out with the stack before it, and the same reductions over the same tokens.
// 4. The second phase, where the search found nothing: with `step`, no smaller number of dropped tokens and, for
//    that number, no higher part of the stack lets the parser shift three tokens or accept the end.
// 5. One repair is known for a whole set: a `#` between two tokens of a valid program is to be taken out. The bar
//    then has every scored code point right in all three and in the stack, and exactly the original's constituents.
// 6. The bar gives the same output for a sample whatever it ran before.
// 7. dropped-kinds.json is what the count gives today.
//
// Run from the repo root: bun lab/recovery-lr/learn/bars/repair/check.ts
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {defaultSeed, loadSamples, programAt} from '../../../dataset.ts'
import {randomSentence, step, textOfTerminals} from '../../../explore.ts'
import {containerOf, depthOf, displayOfState, labelsOfValidText, stackHashOf} from '../../../labels.ts'
import {type Tokens, parse} from '../../../parser.ts'
import {createRandom} from '../../../random.ts'
import {type Sample, alignmentOfTexts, makeSample} from '../../../sample.ts'
import {isTrivia, tables} from '../../../tables.ts'
import {type ParserOutput, addOutputToScore, emptyScore} from '../../score.ts'
import {countDroppedKinds, droppedKindsText} from './dropped-kinds.ts'
import {type Edit, type RepairRecord, cheapestRepair, editDelete, editInsert, editReplace, findRepair, kindOfDroppedToken, standardSettings} from './repair.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 30) console.log(`PROBLEM: ${text}`)
}

// 1. Valid programs.
{
  const texts: string[] = []
  for (let index = 0; index < 6000; index++) texts.push(programAt(defaultSeed, index).text)
  for (let index = 0; texts.length < 9000; index++) {
    const random = createRandom(defaultSeed + 7, index)
    const text = textOfTerminals(randomSentence(random, random.integer(3, 14), random.integer(4, 60)))
    if (text.length <= 512) texts.push(text)
  }
  let codePoints = 0, constituents = 0, wrong = 0
  for (const text of texts) {
    const labels = labelsOfValidText(text)
    const records: RepairRecord[] = []
    const output = cheapestRepair(labels, kindOfDroppedToken, standardSettings, records)
    let wrongHere = records.length
    for (let token = 0; token < labels.tokens.count; token++) {
      for (let at = labels.tokens.start[token]!; at < labels.tokens.start[token]! + labels.tokens.length[token]!; at++) {
        codePoints++
        if (output.kind[token] !== labels.kind[at] || output.depth[token] !== labels.depth[at] || output.container[token] !== labels.container[at] || output.stack[token] !== labels.stack[at]) wrongHere++
      }
      if (!isTrivia(labels.tokens.kind[token]!) && output.taken[token] !== 1) wrongHere++
    }
    const ours = Array.from(output.reductions, ({nonterminal, firstToken, lastToken}) => `${nonterminal} ${firstToken} ${lastToken}`)
    const theirs = Array.from({length: labels.reductionCount}, (_, reduction) => `${tables.ruleLhs[labels.reductionRule[reduction]!]} ${labels.reductionFirstToken[reduction]} ${labels.reductionLastToken[reduction]}`)
    constituents += theirs.length
    if (ours.length !== theirs.length || ours.some((reduction, index) => reduction !== theirs[index]) || output.insertedTokens !== 0) wrongHere++
    if (wrongHere > 0 && wrong++ < 3) problem(`the bar does not give the labels of the valid program ${JSON.stringify(text.slice(0, 120))}`)
  }
  console.log(`1. ${texts.length} valid programs (6,000 of the generator, 3,000 random sentences of the grammar): ${codePoints} code points and ${constituents} reductions, ${wrong} programs with another output than the labels.`)
}

// The tokens of a sample that are no white space and no comment: their places in the sample's tokens, and their
// terminals with the end of input after them.
function realTokensOf(sample: Pick<Sample, 'tokens'>): {tokenOf: number[], terminals: number[]} {
  const tokenOf: number[] = [], terminals: number[] = []
  for (let token = 0; token < sample.tokens.count; token++) {
    if (isTrivia(sample.tokens.kind[token]!)) continue
    tokenOf.push(token)
    terminals.push(sample.tokens.kind[token]!)
  }
  terminals.push(tables.endSymbol)
  return {tokenOf, terminals}
}

const insertable = tables.textTerminals.filter(terminal => terminal !== tables.endSymbol && tables.ruleRhs.some(rightSide => rightSide.includes(terminal)))
type Ranked = {reach: number, removed: number, firstEdit: number, edits: Edit[]}
const ranksHigher = (left: Ranked, right: Ranked): boolean => left.reach !== right.reach ? left.reach > right.reach : left.removed !== right.removed ? left.removed < right.removed : left.firstEdit > right.firstEdit

// Every sequence of up to `cost` edits from a stack at a place, tried one by one with `step`, and the ones that are
// repairs for the rejected terminal at `errorPosition`.
function everyRepair(terminals: readonly number[], errorPosition: number, stack: readonly number[], position: number, cost: number, editsSoFar: Edit[], found: Ranked[]) {
  const end = terminals.length - 1
  // The parser goes on from here as far as it can.
  const stacks: (readonly number[])[] = [stack]
  let reach = position
  for (;;) {
    const {stackAfter, accepted} = step(stacks.at(-1)!, terminals[reach]!)
    if (accepted) {
      reach = end + 1
      break
    }
    if (stackAfter === undefined) break
    stacks.push(stackAfter)
    reach++
  }
  if (editsSoFar.length > 0 && (reach === end + 1 || (reach - position >= standardSettings.shiftsNeeded && reach >= errorPosition + standardSettings.shiftsNeeded))) {
    found.push({reach, removed: editsSoFar.filter(edit => edit.kind !== editInsert).length, firstEdit: editsSoFar[0]!.position, edits: editsSoFar})
    return
  }
  if (cost === 0) return
  for (let index = 0; index < stacks.length && position + index <= end; index++) {
    const at = position + index, before = stacks[index]!
    for (const terminal of insertable) {
      const {stackAfter} = step(before, terminal)
      if (stackAfter === undefined) continue
      everyRepair(terminals, errorPosition, stackAfter, at, cost - 1, [...editsSoFar, {kind: editInsert, position: at, terminal}], found)
      if (at < end && terminal !== terminals[at]) everyRepair(terminals, errorPosition, stackAfter, at + 1, cost - 1, [...editsSoFar, {kind: editReplace, position: at, terminal}], found)
    }
    if (at < end) everyRepair(terminals, errorPosition, before, at + 1, cost - 1, [...editsSoFar, {kind: editDelete, position: at, terminal: -1}], found)
  }
}
const bestOf = (found: readonly Ranked[]): Ranked | undefined => found.reduce<Ranked | undefined>((best, repair) => best === undefined || ranksHigher(repair, best) ? repair : best, undefined)

const train = loadSamples('train', defaultSeed, 2000), validation = loadSamples('validation', defaultSeed, 1000)
const samples = [...train, ...validation]

// 2. The search on first errors.
{
  const byCost = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  let none = 0, pairsChecked = 0, wrong = 0
  for (const [index, sample] of samples.entries()) {
    const {tokenOf, terminals} = realTokensOf(sample)
    const errorPosition = sample.firstErrorToken === sample.tokens.count ? tokenOf.length : tokenOf.indexOf(sample.firstErrorToken)
    // The stacks before every token up to the rejected one, with `step`.
    const stacksBefore: (readonly number[])[] = [[tables.startState]]
    for (let position = 0; position < errorPosition; position++) {
      const {stackAfter} = step(stacksBefore[position]!, terminals[position]!)
      if (stackAfter === undefined) throw new Error(`sample ${sample.id}: a token before the first error is not shifted`)
      stacksBefore.push(stackAfter)
    }
    const firstPosition = Math.max(0, errorPosition - standardSettings.tokensBack)
    const edits = findRepair(terminals, errorPosition, firstPosition, position => stacksBefore[position]!, standardSettings)
    const single: Ranked[] = []
    everyRepair(terminals, errorPosition, stacksBefore[firstPosition]!, firstPosition, 1, [], single)
    const bestSingle = bestOf(single)
    if (edits === undefined) {
      none++
      if (bestSingle !== undefined && wrong++ < 3) problem(`sample ${sample.id}: the search finds no repair, and one edit is a repair`)
      continue
    }
    byCost[edits.length]!++
    // The search's edits are a repair: with them alone, the trial that makes exactly these edits is among the
    // repairs of a search that tries everything up to their number.
    const sameEdits = (repair: Ranked): boolean => repair.edits.length === edits.length && repair.edits.every((edit, place) => edit.kind === edits[place]!.kind && edit.position === edits[place]!.position && edit.terminal === edits[place]!.terminal)
    if (edits.length === 1) {
      const ours = single.find(sameEdits)
      if (ours === undefined) {
        if (wrong++ < 3) problem(`sample ${sample.id}: the search returns one edit that is no repair`)
      } else if (ranksHigher(bestSingle!, ours) && wrong++ < 3) problem(`sample ${sample.id}: the search returns one edit, and another single edit ranks higher`)
      continue
    }
    if (bestSingle !== undefined && wrong++ < 3) problem(`sample ${sample.id}: the search returns ${edits.length} edits, and one edit is a repair`)
    // Every pair of edits takes seconds, so only some samples get it.
    if (edits.length === 2 && index % 4 === 0) {
      const pairs: Ranked[] = []
      everyRepair(terminals, errorPosition, stacksBefore[firstPosition]!, firstPosition, 2, [], pairs)
      const ours = pairs.find(sameEdits), bestPair = bestOf(pairs)
      pairsChecked++
      if (ours === undefined) {
        if (wrong++ < 3) problem(`sample ${sample.id}: the search returns two edits that are no repair`)
      } else if (ranksHigher(bestPair!, ours) && wrong++ < 3) problem(`sample ${sample.id}: the search returns two edits, and another pair ranks higher`)
    }
  }
  console.log(`2. The search on the first error of ${samples.length} samples: a repair of ${byCost.slice(1).map((count, index) => `${index + 1} edit${index === 0 ? '' : 's'} in ${count}`).filter((_, index) => byCost[index + 1]! > 0).join(', ')}, none in ${none}. Against a search that tries everything: every single edit in all samples, every pair in ${pairsChecked}. ${wrong} samples differ.`)
}

// 3. The whole bar against the plain parser on the edited tokens.
{
  let checked = 0, withSecondPhase = 0, wrong = 0, rejectedTokens = 0, edited = 0
  for (const sample of samples) {
    const records: RepairRecord[] = []
    const output = cheapestRepair(sample, kindOfDroppedToken, standardSettings, records)
    rejectedTokens += records.length
    if (records.some(record => record.edits === undefined)) {
      withSecondPhase++
      continue
    }
    checked++
    const {tokenOf, terminals} = realTokensOf(sample)
    const edits = records.flatMap(record => record.edits!)
    edited += edits.length
    // The edited tokens: per token its terminal and the place in the sample's tokens that it is, -1 for a
    // terminal that was put in. And per token that was taken out, the edited token before it.
    const editedTerminals: number[] = [], sourceOf: number[] = []
    const takenOutAfter = new Map<number, number>()
    let nextEdit = 0
    for (let position = 0; position < tokenOf.length; position++) {
      let removed = false
      for (; nextEdit < edits.length && edits[nextEdit]!.position === position; nextEdit++) {
        const edit = edits[nextEdit]!
        if (removed) throw new Error(`sample ${sample.id}: an edit after the token at its place is taken out or read anew`)
        if (edit.kind === editInsert) {
          editedTerminals.push(edit.terminal)
          sourceOf.push(-1)
        } else if (edit.kind === editDelete) {
          takenOutAfter.set(tokenOf[position]!, editedTerminals.length - 1)
          removed = true
        } else {
          editedTerminals.push(edit.terminal)
          sourceOf.push(tokenOf[position]!)
          removed = true
        }
      }
      if (removed) continue
      editedTerminals.push(terminals[position]!)
      sourceOf.push(tokenOf[position]!)
    }
    for (; nextEdit < edits.length && edits[nextEdit]!.position === tokenOf.length && edits[nextEdit]!.kind === editInsert; nextEdit++) {
      editedTerminals.push(edits[nextEdit]!.terminal)
      sourceOf.push(-1)
    }
    if (nextEdit !== edits.length) throw new Error(`sample ${sample.id}: the edits are not in the order of the text`)
    const editedTokens: Tokens = {count: editedTerminals.length, kind: Int32Array.from(editedTerminals), start: Int32Array.from(editedTerminals.keys()), length: new Int32Array(editedTerminals.length).fill(1)}
    // What the plain parser has after every shift, and its reductions over the sample's tokens.
    const expected: ParserOutput = {kind: new Int8Array(sample.tokens.count), depth: new Int16Array(sample.tokens.count), container: new Int8Array(sample.tokens.count), stack: new Int32Array(sample.tokens.count), taken: new Uint8Array(sample.tokens.count), reductions: [], insertedTokens: sourceOf.filter(source => source === -1).length}
    const reductions: string[] = []
    const valuesAfter: {depth: number, container: number, hash: number}[] = []
    const firstTokenOf: number[] = [-1], lastTokenOf: number[] = [-1]
    const {valid} = parse(editedTokens, 0, {
      shift: (token, state, stack) => {
        const values = {depth: depthOf(stack), container: containerOf(stack), hash: stackHashOf(stack)}
        valuesAfter[token] = values
        const source = sourceOf[token]!
        firstTokenOf.push(source)
        lastTokenOf.push(source)
        if (source === -1) return
        ;(expected.kind as Int8Array)[source] = displayOfState[state]!
        ;(expected.depth as Int16Array)[source] = values.depth
        ;(expected.container as Int8Array)[source] = values.container
        ;(expected.stack as Int32Array)[source] = values.hash
        ;(expected.taken as Uint8Array)[source] = 1
      },
      reduce: rule => {
        let first = -1, last = -1
        for (let count = tables.ruleLength[rule]!; count > 0; count--) {
          const lastBelow = lastTokenOf.pop()!, firstBelow = firstTokenOf.pop()!
          if (firstBelow === -1) continue
          first = firstBelow
          if (last === -1) last = lastBelow
        }
        firstTokenOf.push(first)
        lastTokenOf.push(last)
        reductions.push(`${tables.ruleLhs[rule]} ${first} ${last}`)
      },
    })
    let wrongHere = valid ? 0 : 1
    const emptyStack = [tables.startState]
    for (const [token, editedBefore] of takenOutAfter) {
      const values = editedBefore === -1 ? {depth: depthOf(emptyStack), container: containerOf(emptyStack), hash: stackHashOf(emptyStack)} : valuesAfter[editedBefore]
      if (values === undefined) {
        wrongHere++
        continue
      }
      ;(expected.kind as Int8Array)[token] = kindOfDroppedToken[sample.tokens.kind[token]!]!
      ;(expected.depth as Int16Array)[token] = values.depth
      ;(expected.container as Int8Array)[token] = values.container
      ;(expected.stack as Int32Array)[token] = values.hash
    }
    for (const token of tokenOf) {
      if (output.kind[token] !== expected.kind[token] || output.depth[token] !== expected.depth[token] || output.container[token] !== expected.container[token] || output.stack[token] !== expected.stack[token] || output.taken[token] !== expected.taken[token]) wrongHere++
    }
    const ours = Array.from(output.reductions, ({nonterminal, firstToken, lastToken}) => `${nonterminal} ${firstToken} ${lastToken}`)
    if (ours.length !== reductions.length || ours.some((reduction, index) => reduction !== reductions[index]) || output.insertedTokens !== expected.insertedTokens) wrongHere++
    if (wrongHere > 0 && wrong++ < 3) problem(`sample ${sample.id}: the bar's output is not the plain parser's on the edited tokens${valid ? '' : ', which the plain parser rejects'}`)
  }
  console.log(`3. The bar on ${samples.length} samples: ${rejectedTokens} rejected tokens. In ${checked} samples every one got a repair of the search, ${edited} edits in all: the edited tokens are a valid program, and the bar's output is the plain parser's on them, in all but ${wrong}. ${withSecondPhase} samples have a rejected token that the second phase dealt with, and are not compared.`)
}

// 4. The second phase.
{
  let checked = 0, wrong = 0
  const shiftsOrAccepts = (stack: readonly number[], terminals: readonly number[], from: number): boolean => {
    for (let position = from; position < from + standardSettings.shiftsNeeded; position++) {
      const {stackAfter, accepted} = step(stack, terminals[position]!)
      if (accepted) return true
      if (stackAfter === undefined) return false
      stack = stackAfter
    }
    return true
  }
  for (const sample of samples) {
    const records: RepairRecord[] = []
    cheapestRepair(sample, kindOfDroppedToken, standardSettings, records)
    const {terminals} = realTokensOf(sample)
    for (const record of records) {
      if (record.edits !== undefined) continue
      checked++
      // The first pair of a number of dropped tokens and a height of the stack that lets the parser go on, in the
      // order of the second phase.
      let found: {droppedTokens: number, cutStates: number} | undefined
      for (let droppedTokens = 0; found === undefined && record.errorPosition + droppedTokens < terminals.length; droppedTokens++) {
        for (let height = record.states.length; found === undefined && height >= 1; height--) {
          if (droppedTokens === 0 && height === record.states.length) continue
          if (shiftsOrAccepts(record.states.slice(0, height), terminals, record.errorPosition + droppedTokens)) found = {droppedTokens, cutStates: record.states.length - height}
        }
      }
      if ((found?.droppedTokens !== record.droppedTokens || found.cutStates !== record.cutStates) && wrong++ < 3) problem(`sample ${sample.id}: the second phase drops ${record.droppedTokens} tokens and cuts ${record.cutStates} states, and the first place to go on is ${JSON.stringify(found)}`)
    }
  }
  console.log(`4. The second phase at ${checked} rejected tokens: ${wrong} differ from the first place at which the parser goes on.`)
}

// 5. A `#` to take out.
{
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
  const score = emptyScore()
  for (const sample of repaired) addOutputToScore(score, sample, cheapestRepair(sample))
  const allRight = score.allThreeRight === score.scoredCodePoints && score.stackRight === score.scoredCodePoints && score.wholeSamples === repaired.length && score.sharedConstituents === score.originalConstituents && score.sharedConstituents === score.recoveredConstituents && score.insertedTokens === 0
  if (!allRight) problem(`a # to take out: ${JSON.stringify(score)}`)
  console.log(`5. ${repaired.length} programs with a # between two tokens: ${allRight ? 'every scored code point is right in all three and in the stack, and the recovered parse has exactly the original\'s constituents' : 'NOT everything is right'}.`)
}

// 6. The same output whatever ran before.
{
  const some = samples.slice(0, 300)
  const sameOutput = (left: ParserOutput, right: ParserOutput, tokenCount: number): boolean => {
    for (let token = 0; token < tokenCount; token++) if (left.kind[token] !== right.kind[token] || left.depth[token] !== right.depth[token] || left.container[token] !== right.container[token] || left.stack[token] !== right.stack[token] || left.taken[token] !== right.taken[token]) return false
    return left.insertedTokens === right.insertedTokens && Array.from(left.reductions).length === Array.from(right.reductions).length
  }
  const forward = some.map(sample => cheapestRepair(sample))
  let differ = 0
  for (let index = some.length - 1; index >= 0; index--) if (!sameOutput(forward[index]!, cheapestRepair(some[index]!), some[index]!.tokens.count)) differ++
  if (differ > 0) problem(`${differ} samples get another output when the samples are run in another order`)
  console.log(`6. ${some.length} samples run in two orders: ${differ} get another output.`)
}

// 7. The count.
{
  const counted = droppedKindsText(countDroppedKinds((sample, kinds) => cheapestRepair(sample, kinds)))
  const same = counted === readFileSync(join(import.meta.dir, 'dropped-kinds.json'), 'utf8')
  if (!same) problem('dropped-kinds.json is not what the count gives: run count.ts')
  console.log(`7. dropped-kinds.json is ${same ? '' : 'NOT '}what the count over the train samples gives.`)
}

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
