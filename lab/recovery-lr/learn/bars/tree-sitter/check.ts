// Checks the bar "tree-sitter":
// 1. The rules of grammar.ts are bison's rules, with the two empty rules written as `optional`.
// 2. tree-sitter's parser and bison's parser take the same texts as programs: the texts that ../../../check-tools.ts
//    compares the plain parser with the C code on (valid programs, damaged programs, sentences of the grammar,
//    random texts, a text for every cell of both tables, every short text), and the broken texts and the originals
//    of train and validation samples.
// 3. Every token of every tree is a token of the scanner, also in broken text: outputOfTree throws otherwise.
// 4. On valid programs the mapping gives the labels exactly: the display kind, the depth, the container and the
//    hash of the stack at every code point, and the original's constituents.
// 5. One repair is known for a whole set: a `#` between two tokens of a valid program is to be skipped.
//    tree-sitter skips it, and the mapping then has every scored code point right in all three and exactly the
//    original's constituents. With an error node read by its place in the tree, it does not.
// 6. dropped-kinds.json is what the count gives today.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/learn/bars/tree-sitter/check.ts
// Without tree-sitter 0.24.5 the check cannot run. It says so and fails, unless --skip-without-tools is given.
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {defaultSeed, loadSamples, programAt} from '../../../dataset.ts'
import {randomSentence, textOfTerminals} from '../../../explore.ts'
import {labelsOfValidText} from '../../../labels.ts'
import {codePointsOf, parse, scan} from '../../../parser.ts'
import {createRandom} from '../../../random.ts'
import {type TextGroup, cellTexts, handTexts, programTexts, randomTexts, scannerTexts, sentenceTexts, shortTexts} from '../../../reference.ts'
import {type Sample, alignmentOfTexts, makeSample} from '../../../sample.ts'
import {isTrivia, tables} from '../../../tables.ts'
import {type Score, addOutputToScore, emptyScore} from '../../score.ts'
import {countDroppedKinds, droppedKindsText} from '../repair/dropped-kinds.ts'
import {expectedVersion, toolsProblem} from './build.ts'
import {grammar, rightSidesOf} from './grammar.ts'
import {kindOfDroppedToken, outputOfTree, outputsOfTreeSitter} from './tree-sitter.ts'
import {treeIsValid, treesOf} from './trees.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 30) console.log(`PROBLEM: ${text}`)
}

const missing = toolsProblem()
if (missing !== undefined) {
  console.log(`tree-sitter ${expectedVersion} is not here (${missing}), so nothing was checked.`)
  if (process.argv.includes('--skip-without-tools')) console.log('Every check passed.')
  else process.exitCode = 1
  process.exit()
}

// 1. The rules.
{
  const {symbolNames, ruleLhs, ruleRhs, ruleCount} = tables
  const emptyable = new Set<number>()
  for (let rule = 1; rule < ruleCount; rule++) if (ruleRhs[rule]!.length === 0) emptyable.add(ruleLhs[rule]!)
  // bison's rules with every symbol that has an empty rule written out as there and as not there, without the
  // empty rules themselves. `program` keeps its empty right side: it is the start, which tree-sitter lets be empty.
  const bisonRules = new Set<string>()
  for (let rule = 1; rule < ruleCount; rule++) {
    let rightSides: string[][] = [[]]
    for (const symbol of ruleRhs[rule]!) rightSides = rightSides.flatMap(start => emptyable.has(symbol) ? [[...start, symbolNames[symbol]!], start] : [[...start, symbolNames[symbol]!]])
    for (const rightSide of rightSides) if (rightSide.length > 0 || symbolNames[ruleLhs[rule]!] === 'program') bisonRules.add(`${symbolNames[ruleLhs[rule]!]}: ${rightSide.join(' ')}`)
  }
  const ourRules = new Set<string>()
  for (const [name, rule] of Object.entries(grammar.rules)) for (const rightSide of rightSidesOf(rule)) ourRules.add(`${name}: ${rightSide.join(' ')}`)
  const onlyBison = [...bisonRules].filter(rule => !ourRules.has(rule)), onlyOurs = [...ourRules].filter(rule => !bisonRules.has(rule))
  if (onlyBison.length > 0 || onlyOurs.length > 0) problem(`the rules of grammar.ts are not bison's. Only bison has: ${onlyBison.join(' | ')}. Only grammar.ts has: ${onlyOurs.join(' | ')}`)
  if (Object.keys(grammar.rules)[0] !== 'program') problem('the first rule of grammar.ts is not the start')
  console.log(`1. grammar.ts has ${ourRules.size} right sides in ${Object.keys(grammar.rules).length} rules: bison's ${ruleCount - 1} rules with its ${emptyable.size} empty rules (${[...emptyable].map(symbol => symbolNames[symbol]).join(', ')}) written as optional. ${onlyBison.length + onlyOurs.length} differ.`)
}

// 2. and 3. The verdicts, and the tokens of the trees.
{
  let texts = 0, validTexts = 0, differing = 0, tokensChecked = 0
  const compare = (group: TextGroup) => {
    const trees = treesOf(group.texts)
    let valid = 0, differ = 0
    for (const [index, text] of group.texts.entries()) {
      const tokens = scan(text)
      const byBison = parse(tokens, text.length).valid
      if (byBison) valid++
      if (byBison !== treeIsValid(trees[index]!)) {
        if (differ++ < 2) problem(`${group.name}: ${JSON.stringify(String.fromCodePoint(...text).slice(0, 120))} is ${byBison ? 'a program' : 'no program'} for bison and ${byBison ? 'no program' : 'a program'} for tree-sitter`)
      }
      try {
        outputOfTree(tokens, trees[index]!, {kindOfDropped: kindOfDroppedToken})
        tokensChecked += tokens.count
      } catch (error) {
        if (differ++ < 2) problem(`${group.name}: ${JSON.stringify(String.fromCodePoint(...text).slice(0, 120))}: ${String(error)}`)
      }
    }
    texts += group.texts.length
    validTexts += valid
    differing += differ
    console.log(`   ${group.name}: ${group.texts.length} texts, ${valid} programs and ${group.texts.length - valid} that are none by bison's parser, ${differ} differ`)
  }
  console.log('2. The same texts are programs for tree-sitter and for bison:')
  const [programs, damagedPrograms] = programTexts(6000, 2) as [TextGroup, TextGroup]
  const [sentences, damagedSentences] = sentenceTexts(3000) as [TextGroup, TextGroup]
  for (const group of [programs, damagedPrograms, sentences, damagedSentences, randomTexts(3000), handTexts(), cellTexts(8, 20_000).group, scannerTexts().group, shortTexts(3)]) compare(group)
  const samples = [...loadSamples('train', defaultSeed, 5000), ...loadSamples('validation', defaultSeed, 5000)]
  compare({name: 'the broken texts of 5,000 train and 5,000 validation samples', texts: samples.map(sample => sample.codePoints)})
  compare({name: 'their originals', texts: samples.map(sample => codePointsOf(sample.original))})
  console.log(`   ${texts} texts in all, ${validTexts} programs and ${texts - validTexts} that are none: ${differing} differ.`)
  console.log(`3. Every token of these trees is a token of the scanner: ${tokensChecked} tokens.`)
}

// 4. Valid programs.
{
  const texts: string[] = []
  for (let index = 0; index < 6000; index++) texts.push(programAt(defaultSeed, index).text)
  for (let index = 0; texts.length < 9000; index++) {
    const random = createRandom(defaultSeed + 7, index)
    const text = textOfTerminals(randomSentence(random, random.integer(3, 14), random.integer(4, 60)))
    if (text.length <= 512) texts.push(text)
  }
  const allLabels = texts.map(labelsOfValidText)
  const outputs = outputsOfTreeSitter(allLabels)
  let codePoints = 0, constituents = 0, wrong = 0
  for (const [index, labels] of allLabels.entries()) {
    const output = outputs[index]!
    let wrongHere = 0
    for (let token = 0; token < labels.tokens.count; token++) {
      for (let at = labels.tokens.start[token]!; at < labels.tokens.start[token]! + labels.tokens.length[token]!; at++) {
        codePoints++
        if (output.kind[token] !== labels.kind[at] || output.depth[token] !== labels.depth[at] || output.container[token] !== labels.container[at] || output.stack[token] !== labels.stack[at]) wrongHere++
      }
      if (!isTrivia(labels.tokens.kind[token]!) && output.taken[token] !== 1) wrongHere++
    }
    // tree-sitter's tree has no node for an empty rule, which covers no token and is no constituent.
    const ours = Array.from(output.reductions, ({nonterminal, firstToken, lastToken}) => `${nonterminal} ${firstToken} ${lastToken}`).sort()
    const theirs = Array.from({length: labels.reductionCount}, (_, reduction) => `${tables.ruleLhs[labels.reductionRule[reduction]!]} ${labels.reductionFirstToken[reduction]} ${labels.reductionLastToken[reduction]}`).filter(reduction => !reduction.endsWith(' -1 -1') || reduction.startsWith(`${tables.symbolNames.indexOf('program')} `)).sort()
    constituents += theirs.length
    if (ours.length !== theirs.length || ours.some((reduction, place) => reduction !== theirs[place]) || output.insertedTokens !== 0) wrongHere++
    if (wrongHere > 0 && wrong++ < 3) problem(`the mapping does not give the labels of the valid program ${JSON.stringify(texts[index]!.slice(0, 120))}`)
  }
  console.log(`4. ${texts.length} valid programs (6,000 of the generator, 3,000 random sentences of the grammar): ${codePoints} code points and ${constituents} reductions that cover a token, ${wrong} programs with another output than the labels.`)
}

// 5. A `#` to skip.
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
  const scoreWith = (errorNodesByTheirPlace: boolean): Score => {
    const score = emptyScore()
    for (const [index, output] of outputsOfTreeSitter(repaired, {kindOfDropped: kindOfDroppedToken, errorNodesByTheirPlace}).entries()) addOutputToScore(score, repaired[index]!, output)
    return score
  }
  const score = scoreWith(false), byPlace = scoreWith(true)
  if (score.allThreeRight !== score.scoredCodePoints || score.wholeSamples !== repaired.length || score.sharedConstituents !== score.originalConstituents || score.sharedConstituents !== score.recoveredConstituents || score.insertedTokens !== 0) problem(`a # to skip: ${JSON.stringify(score)}`)
  if (byPlace.wholeSamples === repaired.length) problem('a # to skip: the mapping by the place of an error node has every sample right too, so the set does not tell the two apart')
  console.log(`5. ${repaired.length} programs with a # between two tokens: every scored code point is right in all three, and the tree has exactly the original's constituents. The stack is right at ${(100 * score.stackRight / score.scoredCodePoints).toFixed(2)}%: the white space after the # has the # on its stack. With an error node read by its place in the tree, ${repaired.length - byPlace.wholeSamples} samples are not whole.`)
}

// 6. The count.
{
  const train = loadSamples('train', defaultSeed, 5000)
  const trees = new Map(treesOf(train.map(sample => sample.codePoints)).map((tree, index) => [train[index]!, tree]))
  const counted = droppedKindsText(countDroppedKinds((sample, kinds) => outputOfTree(sample.tokens, trees.get(sample)!, {kindOfDropped: kinds}), train))
  const same = counted === readFileSync(join(import.meta.dir, 'dropped-kinds.json'), 'utf8')
  if (!same) problem('dropped-kinds.json is not what the count gives: run count.ts')
  console.log(`6. dropped-kinds.json is ${same ? '' : 'NOT '}what the count over the train samples gives.`)
}

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
