// Checks the ground rules of the exact parser, recovery-parser.ts, on texts of every sort: valid programs, their
// damaged copies, random sentences of the grammar and their damaged copies, texts that are no programs, the
// texts by hand of ../reference.ts with the highest stacks that 512 code points can make, and the broken texts of
// train samples.
//
// 1. With no open cell changed, the parser is the plain parser of ../parser.ts, which check-tools.ts compares with
//    bison's generated C code: the same verdict, the same first error, the same stack there, the same shifts and
//    reductions up to bison's call of yyerror, and the plain parser's display kind, depth, container and stack at
//    every code point before the first error. From the first error on every token is shown as an error. The same
//    holds for tables with the flag, with added terminals and without "end an item early".
// 2. With a random choice in every open cell and a random kind in every open display entry, 36 settings on every
//    text: nothing before a text's first error changes, the first error stays where it is, the verdict stays, the
//    stack is a path of the automaton after every step, with the state stopped only on top and at most 520
//    states, no token takes more than 16 steps from the first error on, and effectOf and applyChoice say what
//    every step does to the stack.
// 3. The check can fail: tables with one frozen cell changed, which checkTables refuses and the parser is made to
//    run all the same, give some text another output before its first error, or another verdict.
//
// Run from the repo root: bun lab/recovery-lr/learn/check-parser.ts
import {defaultSeed, loadSamples} from '../dataset.ts'
import {containerOf, depthOf, displayKind, displayOfState, stackHashOf} from '../labels.ts'
import {type Tokens, parse, scan} from '../parser.ts'
import {createRandom} from '../random.ts'
import {handTexts, programTexts, randomTexts, sentenceTexts} from '../reference.ts'
import {commentKind, isTrivia} from '../tables.ts'
import {type RecoveryRun, runRecoveryParserOnTokens, shownAsTrivia, shownShifted, shownSkipped, shownSkippedByStackLimit, shownSkippedByStepLimit} from './recovery-parser.ts'
import {
  type RecoveryTables, addFirstOnLineFlag, addTerminals, applyChoice, baseTables, bison, bisonTerminalCount, checkTables, choiceStop, copyTables, effectOf, kindAccept, kindOfChoice, kindSkip,
  maximumStackHeight, maximumStepsPerToken, parseAccepted, randomizeOpenCells, stateSymbol, stopped, tokenTaken, withoutEndEarly,
} from './recovery-tables.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  if (problems.length <= 30) console.log(`PROBLEM: ${text}`)
}

type Text = {name: string, codePoints: Int32Array, tokens: Tokens}
const texts: Text[] = []
for (const group of [...programTexts(1500, 1), ...sentenceTexts(800), randomTexts(1500), handTexts()]) {
  group.texts.forEach((codePoints, index) => texts.push({name: `${group.name} ${index}`, codePoints, tokens: scan(codePoints)}))
}
for (const sample of loadSamples('train', defaultSeed, 600)) texts.push({name: `the train sample ${sample.id}`, codePoints: sample.codePoints, tokens: sample.tokens})
// Texts whose first error comes with about 500 states on the stack and has tokens after it, so that a recovery
// meets the limit of the stack.
// `let x=`, then as many of `opening` as 512 code points hold, then the tail.
const highStack = (opening: string, tail: string): string => `let x=${opening.repeat(Math.floor((512 - 6 - tail.length) / opening.length))}${tail}`
const highStacks = [highStack('(', ' in ((1'), highStack('(', ' then [[[['), highStack('-', ' in - - -'), highStack('[', ' = ( ( [ [ 1'), highStack('([', ' in f ( ( ('), highStack('if 1 then ', ' in ( ( ( (')]
highStacks.forEach((text, index) => {
  const codePoints = Int32Array.from(text, character => character.codePointAt(0)!)
  texts.push({name: `a high stack ${index}`, codePoints, tokens: scan(codePoints)})
})
const textOf = (text: Text): string => JSON.stringify(String.fromCodePoint(...text.codePoints).slice(0, 80))

// What the plain parser says of a text: its verdict, and per token before the first error what it is shown as.
type Plain = {
  valid: boolean, firstErrorToken: number, firstErrorPosition: number, stack: number[], shifts: number, reductions: number,
  // The reductions that bison still makes by default between the first open cell and its call of yyerror.
  reductionsBeforeReport: number
  kind: Int8Array, depth: Int16Array, container: Int8Array, hash: Int32Array
}
function plainOf(text: Text): Plain {
  const {tokens} = text
  const kind = new Int8Array(tokens.count).fill(-1), depth = new Int16Array(tokens.count), container = new Int8Array(tokens.count), hash = new Int32Array(tokens.count)
  let shifts = 0, reductions = 0
  // A token, and the white space and comments after it, are shown with the stack as the token left it.
  const show = (token: number, tokenKind: number, stack: readonly number[]) => {
    for (let at = token; at < tokens.count && (at === token || isTrivia(tokens.kind[at]!)); at++) {
      kind[at] = at === token && tokenKind !== -1 ? tokenKind : tokens.kind[at] === commentKind ? displayKind.comment : displayKind.whitespace
      depth[at] = depthOf(stack)
      container[at] = containerOf(stack)
      hash[at] = stackHashOf(stack)
    }
  }
  if (tokens.count > 0 && isTrivia(tokens.kind[0]!)) show(0, -1, [bison.startState])
  const parsed = parse(tokens, text.codePoints.length, {
    shift: (token, state, stack) => {
      shifts++
      show(token, displayOfState[state]!, stack)
    },
    reduce: () => { reductions++ },
  })
  return {valid: parsed.valid, firstErrorToken: parsed.firstErrorToken, firstErrorPosition: parsed.firstErrorPosition, stack: parsed.stack, shifts, reductions, reductionsBeforeReport: parsed.reductionsBeforeReport, kind, depth, container, hash}
}
const plains = texts.map(plainOf)
const sameList = (left: ArrayLike<number> | undefined, right: ArrayLike<number>): boolean => left !== undefined && left.length === right.length && Array.from(left).every((entry, index) => entry === right[index])

// What has to hold of a run before the text's first error, for any tables. Returns why it does not, or ''.
function beforeFirstError(text: Text, plain: Plain, run: RecoveryRun): string {
  if (run.valid !== plain.valid) return `the verdict is ${run.valid ? 'valid' : 'not valid'}`
  if (run.firstErrorToken !== plain.firstErrorToken || run.firstErrorPosition !== plain.firstErrorPosition) return `the first error is at token ${run.firstErrorToken}, code point ${run.firstErrorPosition}, and the plain parser's at ${plain.firstErrorToken}, ${plain.firstErrorPosition}`
  if (!plain.valid && !sameList(run.stackAtFirstError, plain.stack)) return 'the stack at the first open cell is another one'
  const end = plain.valid ? text.tokens.count : plain.firstErrorToken
  for (let token = 0; token < end; token++) {
    if (run.kind[token] !== plain.kind[token] || run.depth[token] !== plain.depth[token] || run.container[token] !== plain.container[token] || run.stack[token] !== plain.hash[token]) return `token ${token} is shown otherwise than by the plain parser`
    if (run.shown[token] !== (isTrivia(text.tokens.kind[token]!) ? shownAsTrivia : shownShifted) || run.steps[token] !== 0) return `token ${token} is not shifted, or takes steps that are counted`
  }
  return ''
}

// 1. No open cell changed.
{
  const ampersand = {name: 'ampersand', codePoint: 0x26}, hash = {name: 'hash', codePoint: 0x23}
  const layouts: [string, RecoveryTables][] = [
    ['the base', baseTables()], ['with the flag', addFirstOnLineFlag(baseTables())], ['with added terminals', addTerminals(baseTables(), [ampersand, hash])],
    ['without "end an item early"', withoutEndEarly(baseTables())], ['with all three', addFirstOnLineFlag(addTerminals(withoutEndEarly(baseTables()), [ampersand, hash]))],
  ]
  let valid = 0, codePointsBefore = 0, tokensAfter = 0, flagged = 0, addedTerminalTokens = 0, cutByStepLimit = 0
  for (const [name, tables] of layouts) {
    checkTables(tables)
    texts.forEach((text, index) => {
      const plain = plains[index]!
      const run = runRecoveryParserOnTokens(text.codePoints, text.tokens, tables)
      const why = beforeFirstError(text, plain, run)
      if (why !== '') return problem(`${name}, ${text.name} ${textOf(text)}: ${why}`)
      // The one place where the base is not the parser as it is: bison makes 16 or more default reductions at the
      // first error's token before it reports. The token's 17th step is a skip by the rule of 16 steps, so the
      // parser never enters the state stopped there and goes on with the next token.
      if (!plain.valid && plain.reductionsBeforeReport >= maximumStepsPerToken) {
        const limited = plain.firstErrorToken === text.tokens.count ? run.stepsAtEnd === maximumStepsPerToken && run.stackAtEnd.at(-1) !== stopped : run.shown[plain.firstErrorToken] === shownSkippedByStepLimit
        if (!limited) problem(`${name}, ${text.name}: bison reduces ${plain.reductionsBeforeReport} times at the first error, and its token is not skipped after ${maximumStepsPerToken} steps`)
        if (tables === layouts[0]![1]) cutByStepLimit++
        return
      }
      // Bison's steps up to its call of yyerror: every shift, and every reduction, also the ones that it still
      // makes by default after the first open cell.
      const shifts = Array.from(run.shown).filter(shown => shown === shownShifted).length
      if (shifts !== plain.shifts || run.reductions.length !== plain.reductions || run.insertedTokens !== 0) return problem(`${name}, ${text.name}: ${shifts} shifts and ${run.reductions.length} reductions, and the plain parser makes ${plain.shifts} and ${plain.reductions}`)
      // From the first error on, every token is skipped in the state stopped and shown as an error. With 15
      // default reductions, the first error's token enters the state with its 16th step and is skipped by the rule
      // of 16 steps, which there is the same skip.
      for (let token = Math.max(0, plain.firstErrorToken); !plain.valid && token < text.tokens.count; token++) {
        if (isTrivia(text.tokens.kind[token]!)) continue
        const skipped = run.shown[token] === shownSkipped || (run.shown[token] === shownSkippedByStepLimit && token === plain.firstErrorToken && plain.reductionsBeforeReport === maximumStepsPerToken - 1)
        if (!skipped || run.kind[token] !== displayKind.error || run.displayEntry[token] !== stopped * tables.terminalCount + run.terminal[token]!) return problem(`${name}, ${text.name}: token ${token} after the first error is not skipped in the state stopped and shown as an error`)
        if (tables === layouts[0]![1]) tokensAfter++
      }
      if (!plain.valid && run.stackAtEnd.at(-1) !== stopped) return problem(`${name}, ${text.name}: the run of a text that is not valid does not end in the state stopped`)
      if (tables !== layouts[0]![1]) {
        if (tables.firstOnLineFlag) flagged += run.cellsRead.filter(cell => cell >= tables.cellsPerCopy).length
        addedTerminalTokens += Array.from(run.terminal).filter(terminal => terminal >= bisonTerminalCount).length
        return
      }
      if (plain.valid) valid++
      for (let token = 0; token < (plain.valid ? text.tokens.count : plain.firstErrorToken); token++) codePointsBefore += text.tokens.length[token]!
    })
  }
  console.log(`1. ${texts.length} texts, ${valid} of them valid, in ${layouts.length} layouts with no open cell changed: the parser has the plain parser's verdict, first error, stack there, shifts and reductions, and its output at each of ${codePointsBefore} code points before the first error. Each of ${tokensAfter} tokens from a first error on is shown as an error. The runs read ${flagged} cells with the flag and ${addedTerminalTokens} tokens of an added terminal.`)
  console.log(`   In ${cutByStepLimit} texts bison makes ${maximumStepsPerToken} or more default reductions at the first error's token before it reports: there the token is skipped after ${maximumStepsPerToken} steps and the parser goes on, where bison stops.`)
}

// 2. Random choices in every open cell.
{
  const settings = 36
  let runs = 0, steps = 0, stepLimitTokens = 0, stackLimitTokens = 0, highest = 0, textsWithChange = 0, effectsChecked = 0
  for (let setting = 0; setting < settings; setting++) {
    let tables = baseTables()
    if (setting % 4 === 3) tables = withoutEndEarly(tables)
    if (setting % 3 === 1) tables = addTerminals(tables, [{name: 'ampersand', codePoint: 0x26}, {name: 'hash', codePoint: 0x23}, {name: 'colon', codePoint: 0x3a}])
    if (setting % 2 === 1) tables = addFirstOnLineFlag(tables)
    randomizeOpenCells(tables, createRandom(41, setting))
    checkTables(tables)
    texts.forEach((text, index) => {
      const plain = plains[index]!
      // Counted here, next to the parser's own counts: the cells read per token from the first error on.
      let readsOfToken = 0, tokenOfReads = -1, errorSeen = false
      let expected: number[] | undefined, applied: number[] | undefined
      let why = ''
      const run = runRecoveryParserOnTokens(text.codePoints, text.tokens, tables, {
        read: (token, cell, stack) => {
          if (tables.open[cell] === 1) {
            if (!errorSeen && token !== plain.firstErrorToken) why = `token ${token} reads an open cell before the first error`
            errorSeen = true
          }
          if (errorSeen) {
            if (token !== tokenOfReads) readsOfToken = 0
            tokenOfReads = token
            if (++readsOfToken > maximumStepsPerToken) why = `token ${token} takes more than ${maximumStepsPerToken} steps`
            steps++
          }
          // The stack before a step is what effectOf and applyChoice said of the step before.
          if (expected !== undefined && (!sameList(stack, expected) || !sameList(stack, applied!))) why = `the stack before a step of token ${token} is not what effectOf and applyChoice say`
          const choice = tables.choice[cell]!
          const kind = kindOfChoice(choice)
          applied = stack.slice()
          const became = applyChoice(applied, choice)
          if ((became === parseAccepted) !== (kind === kindAccept) || (became === tokenTaken && effectOf(choice, stack.at(-1)!).pushedState === -1)) why = `applyChoice says ${became} of the choice ${choice}`
          if (kind === kindAccept) return
          const effect = effectOf(choice, stack.at(-1)!)
          const grows = effect.dropped === 0 && (effect.gotoNonterminal !== -1 || effect.pushedState !== -1)
          expected = stack.slice()
          // A step that would put more than 520 states on the stack is a skip, which leaves the stack as it is.
          if (grows && stack.length >= maximumStackHeight) return
          expected.length -= effect.dropped
          if (effect.gotoNonterminal !== -1) expected.push(bison.gotoState[expected.at(-1)! * bison.nonterminalCount + effect.gotoNonterminal - bisonTerminalCount]!)
          else if (effect.pushedState !== -1) expected.push(effect.pushedState)
          if (kind === kindSkip && stack.length !== expected.length) why = 'a skip changes the stack'
          effectsChecked++
        },
        step: stack => {
          // A path of the automaton from the start state, with the state stopped only on top.
          if (stack[0] !== bison.startState || stack.length > maximumStackHeight) why = `the stack starts with state ${stack[0]}, or holds ${stack.length} states`
          for (let level = 1; level < stack.length; level++) {
            const state = stack[level]!
            if (state === stopped ? level !== stack.length - 1 : bison.transition[stack[level - 1]! * bison.symbolCount + stateSymbol[state]!] !== state) why = `the stack ${stack.join(' ')} is no path of the automaton at level ${level}`
          }
          if (stack.length > highest) highest = stack.length
        },
      })
      runs++
      if (why === '') why = beforeFirstError(text, plain, run)
      if (why !== '') return problem(`setting ${setting}, ${text.name} ${textOf(text)}: ${why}`)
      let changed = false
      for (let token = 0; token < text.tokens.count; token++) {
        if (run.steps[token]! > maximumStepsPerToken) problem(`setting ${setting}, ${text.name}: the run says that token ${token} took ${run.steps[token]} steps`)
        if (run.shown[token] === shownSkippedByStepLimit) stepLimitTokens++
        if (run.shown[token] === shownSkippedByStackLimit) stackLimitTokens++
        if (!plain.valid && token >= plain.firstErrorToken && !isTrivia(text.tokens.kind[token]!) && run.kind[token] !== displayKind.error) changed = true
      }
      if (changed) textsWithChange++
    })
  }
  if (stepLimitTokens === 0 || stackLimitTokens === 0 || highest !== maximumStackHeight) problem(`the runs do not meet both limits: ${stepLimitTokens} tokens skipped after ${maximumStepsPerToken} steps, ${stackLimitTokens} at the limit of the stack, the highest stack ${highest}`)
  console.log(`2. ${settings} settings of every open cell and every open display entry, ${runs} runs of ${texts.length} texts: before a text's first error nothing changes, and the first error and the verdict stay. The stack is a path of the automaton after every step, the highest with ${highest} states, and effectOf and applyChoice say what each of ${effectsChecked} steps does to it. Of the ${steps} steps from a first error on, no token takes more than ${maximumStepsPerToken}. ${stepLimitTokens} tokens were skipped after ${maximumStepsPerToken} steps and ${stackLimitTokens} at the limit of the stack, and in ${textsWithChange} runs something after the first error is shown otherwise than as an error.`)
}

// 3. The check can fail.
{
  const base = baseTables()
  // The frozen cells that the texts read, and how many texts read each.
  const readers = new Int32Array(base.choice.length)
  for (const text of texts.slice(0, 1500)) {
    const read = new Set<number>()
    runRecoveryParserOnTokens(text.codePoints, text.tokens, base, {read: (_token, cell) => { read.add(cell) }})
    for (const cell of read) if (base.open[cell] === 0) readers[cell]!++
  }
  const frozenCellsRead = Array.from(readers.keys()).filter(cell => readers[cell]! > 0)
  const random = createRandom(42, 0)
  let seen = 0
  const tried = 40
  for (let attempt = 0; attempt < tried; attempt++) {
    const cell = random.pick(frozenCellsRead)
    const changed = copyTables(base)
    changed.choice[cell] = choiceStop
    // The mask says that the cell is open, so that the parser runs the changed tables as it would run any tables.
    changed.open[cell] = 1
    const differs = texts.slice(0, 1500).some((text, index) => {
      try {
        return beforeFirstError(text, plains[index]!, runRecoveryParserOnTokens(text.codePoints, text.tokens, changed)) !== ''
      } catch {
        return true
      }
    })
    if (differs) seen++
    else problem(`the frozen cell ${cell} holds stop, and no text is shown otherwise before its first error`)
  }
  console.log(`3. Tables with one frozen cell changed, for ${tried} of the ${frozenCellsRead.length} frozen cells that the first 1,500 texts read: each of the ${seen} gives some text another verdict, another first error or another output before it.`)
}

console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
