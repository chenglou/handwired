// For the checks against the tools: the texts that the plain scanner and parser are compared on, and what the
// generated C code says of them. check-tools.ts runs the comparison, and check-changed.ts runs it again with
// changed tables to see it fail.
import {readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {defaultSeed} from './dataset.ts'
import {damageProgram} from './damage.ts'
import {completionOf, randomSentence, step, terminalsOf, textOfTerminals, validStarts} from './explore.ts'
import {generateProgram} from './generate.ts'
import {byteOf, codePointsOf, maximumCodePoints, parserLine, scan, scannerLine} from './parser.ts'
import {createRandom} from './random.ts'
import {type Tables, tables as defaultTables} from './tables.ts'

export type TextGroup = {
  name: string
  // Every text as code points, at most 512.
  texts: Int32Array[]
}

// What the C program prints for a text: the scanner's tokens and the steps of yyparse, see grammar/driver.c.
export type Lines = {scanner: string, parser: string}

// Runs the compiled driver on the texts and returns its two lines per text. The input and the output files go to
// `folder`.
export function runDriver(driverPath: string, group: TextGroup, folder: string): Lines[] {
  let total = 0
  for (const text of group.texts) total += 4 + text.length
  const input = new Uint8Array(total)
  const view = new DataView(input.buffer)
  let at = 0
  for (const text of group.texts) {
    view.setUint32(at, text.length, true)
    for (let index = 0; index < text.length; index++) input[at + 4 + index] = byteOf(text[index]!)
    at += 4 + text.length
  }
  const fileName = group.name.replaceAll(/[^a-z0-9]+/g, '-')
  const inputPath = join(folder, `${fileName}.bin`), outputPath = join(folder, `${fileName}.txt`)
  writeFileSync(inputPath, input)
  const child = Bun.spawnSync([driverPath, 'run', inputPath, outputPath])
  if (child.exitCode !== 0) throw new Error(`the driver failed on the group "${group.name}": ${child.stderr.toString()}`)
  const lines = readFileSync(outputPath, 'latin1').split('\n')
  if (lines.length !== 2 * group.texts.length + 1) throw new Error(`the driver printed ${lines.length - 1} lines for ${group.texts.length} texts of the group "${group.name}"`)
  return group.texts.map((_, index) => ({scanner: lines[2 * index]!, parser: lines[2 * index + 1]!}))
}

// The two lines as parser.ts gives them with `tables`. A scanner or parser that throws gives the error as its lines.
export function linesOf(codePoints: ArrayLike<number>, tables: Tables = defaultTables): Lines {
  try {
    const tokens = scan(codePoints, tables)
    return {scanner: scannerLine(tokens), parser: parserLine(tokens, codePoints.length, tables)}
  } catch (error) {
    const message = `threw: ${error instanceof Error ? error.message : String(error)}`
    return {scanner: message, parser: message}
  }
}

// The places in the group of the texts whose lines are not the C program's, at most `limit` of them.
export function differingTexts(group: TextGroup, expected: readonly Lines[], tables: Tables = defaultTables, limit = Infinity): number[] {
  const differing: number[] = []
  for (let index = 0; index < group.texts.length && differing.length < limit; index++) {
    const ours = linesOf(group.texts[index]!, tables)
    if (ours.scanner !== expected[index]!.scanner || ours.parser !== expected[index]!.parser) differing.push(index)
  }
  return differing
}

const within = (codePoints: readonly number[]): Int32Array => Int32Array.from(codePoints.slice(0, maximumCodePoints))

// Valid programs of the generator and their neutral damage: `damagedPerProgram` damaged texts per
// program, as the damage draws them, also the ones that are still valid.
export function programTexts(programCount: number, damagedPerProgram: number): TextGroup[] {
  const programs: Int32Array[] = [], damaged: Int32Array[] = []
  for (let index = 0; index < programCount; index++) {
    const original = codePointsOf(generateProgram(defaultSeed, index))
    programs.push(original)
    const random = createRandom(defaultSeed + 1, index)
    for (let copy = 0; copy < damagedPerProgram; copy++) damaged.push(within(damageProgram(original, random).codePoints))
  }
  return [{name: 'generated programs', texts: programs}, {name: 'damaged programs', texts: damaged}]
}

// Random sentences of the grammar's rules, which have what a person seldom writes, and one damaged text of each.
export function sentenceTexts(sentenceCount: number): TextGroup[] {
  const sentences: Int32Array[] = [], damaged: Int32Array[] = []
  for (let index = 0; sentences.length < sentenceCount; index++) {
    const random = createRandom(defaultSeed + 2, index)
    const text = codePointsOf(textOfTerminals(randomSentence(random, random.integer(3, 14), random.integer(4, 60))))
    if (text.length > maximumCodePoints) continue
    sentences.push(text)
    damaged.push(within(damageProgram(text, random).codePoints))
  }
  return [{name: 'sentences of the grammar', texts: sentences}, {name: 'damaged sentences', texts: damaged}]
}

// Texts that are no programs: token texts, white space and single code points in a random order, with code points
// that no rule names, e.g. U+0000, a control character, `#`, U+00E9 and U+1F600.
export function randomTexts(textCount: number): TextGroup {
  const pieces = [
    'let', 'rec', 'in', 'if', 'then', 'else', 'fun', 'true', 'false', 'x', 'foo', "x'", '_', '_a', '0', '42', '"s"', '"a\\"b"', '"open', '"\\', '(*', '*)', '(* c *)', '(*)', '->', '=',
    '<>', '<', '<=', '>', '>=', '+', '-', '*', '/', '::', ':', '&&', '&', '||', '|', '^', '(', ')', '[', ']', ',', ';', ' ', '  ', '\n', '\t', '\r', '\\', '"', "'", '#', '!', '.', '\u0000',
    '\u0001', '\u007f', '\u0080', 'é', '\u{1f600}',
  ]
  const texts: Int32Array[] = []
  for (let index = 0; index < textCount; index++) {
    const random = createRandom(defaultSeed + 3, index)
    const pieceCount = random.integer(0, 40)
    let text = ''
    for (let piece = 0; piece < pieceCount; piece++) text += random.pick(pieces) + (random.chance(0.5) ? ' ' : '')
    texts.push(within(Array.from(codePointsOf(text))))
  }
  return {name: 'random texts', texts}
}

// Texts by hand: the empty text, the ends of input inside every kind of token, and the longest stacks that a text
// of 512 code points can make.
export function handTexts(): TextGroup {
  const texts = [
    '', ' ', '\n', 'let', 'let x = "abc', 'let x = (* open', 'let x = 1 # 2', 'let x = a : b', 'let x = a & b | c', 'let x = \u0080\u0080', '"', '(*', '(* a *) let x = (*) 1', 'let x = 1 +',
    'let x = if a then b else', 'let f x = x let', 'let x 1', 'let x = \u0000', 'let x = "a\u0000b" ^ "é"', '(* \u0000 *) let x = 1', 'let x = 1 (* a * b ** c *)', 'let x = 1 (* a **)',
    `let x=${'-'.repeat(505)}1`, `let x=${'('.repeat(253)}${')'.repeat(253)}`, `let x=${'('.repeat(506)}`, `let x=${'['.repeat(506)}`, `let x=${'-'.repeat(506)}`,
    `let x=${'fun x->'.repeat(72)}1`, `${'let x='.repeat(84)}1`, `let x=${'if 1 then '.repeat(50)}1`, '1'.repeat(512), '('.repeat(512), ' '.repeat(512), `"${'a'.repeat(511)}`,
  ]
  return {name: 'texts by hand', texts: texts.map(codePointsOf)}
}

export type CellTexts = {
  group: TextGroup
  // [state × terminalCount + terminal]: the place in the group of a text that reads the cell, -1 when no text of
  // the search reads it.
  textOfCell: Int32Array
  // [cell]: 1 when the text is a valid program.
  validText: Uint8Array
  // How many valid starts and distinct stacks the search went through.
  startCount: number
  stackCount: number
}

// For every cell that some text reads with the parser as it is, one such text. The search goes through every stack
// that a valid start of up to `maximumTokens` tokens leaves and through `sentenceCount` random sentences of the
// grammar, and tries every terminal on every stack. A text that reads a frozen cell is made a whole valid program.
export function cellTexts(maximumTokens: number, sentenceCount: number, tables: Tables = defaultTables): CellTexts {
  const {terminalCount, stateCount, textTerminals, endSymbol} = tables
  const texts: Int32Array[] = []
  const textOfCell = new Int32Array(stateCount * terminalCount).fill(-1)
  const validText = new Uint8Array(stateCount * terminalCount)
  // Tries one terminal after a start, given as its stack and its terminals.
  const tryTerminal = (stack: readonly number[], terminalsBefore: () => number[], terminal: number) => {
    const {cells, stackAfter, accepted} = step(stack, terminal, tables)
    const isValid = accepted || stackAfter !== undefined
    if (!cells.some(cell => textOfCell[cell] === -1 || (isValid && validText[cell] === 0))) return
    let terminals = [...terminalsBefore(), terminal]
    if (stackAfter !== undefined) {
      const completion = completionOf(stackAfter, tables)
      if (completion === undefined) throw new Error(`no completion for the valid start ${textOfTerminals(terminals, tables)}`)
      terminals = [...terminals, ...completion]
    }
    const text = codePointsOf(textOfTerminals(terminals, tables))
    if (text.length > maximumCodePoints) return
    for (const cell of cells) {
      if (textOfCell[cell] !== -1 && !(isValid && validText[cell] === 0)) continue
      textOfCell[cell] = texts.length
      validText[cell] = isValid ? 1 : 0
    }
    texts.push(text)
  }
  const {starts, startCounts} = validStarts(maximumTokens - 1, tables)
  for (const start of starts) for (const terminal of textTerminals) tryTerminal(start.stack, () => terminalsOf(start), terminal)
  for (let index = 0; index < sentenceCount; index++) {
    const random = createRandom(defaultSeed + 4, index)
    const sentence = randomSentence(random, random.integer(3, 14), random.integer(4, 60), tables)
    // Every start of the sentence, with every terminal after it.
    let stack: readonly number[] = [tables.startState]
    for (let length = 0; length <= sentence.length; length++) {
      for (const terminal of textTerminals) tryTerminal(stack, () => sentence.slice(0, length), terminal)
      if (length === sentence.length) break
      const {stackAfter} = step(stack, sentence[length]!, tables)
      if (stackAfter === undefined) throw new Error(`the parser rejects the sentence ${textOfTerminals(sentence, tables)}`)
      stack = stackAfter
    }
    if (!step(stack, endSymbol, tables).accepted) throw new Error(`the parser rejects the sentence ${textOfTerminals(sentence, tables)}`)
  }
  return {group: {name: 'a text for every cell', texts}, textOfCell, validText, startCount: startCounts.slice(0, maximumTokens).reduce((sum, count) => sum + count, 0), stackCount: starts.length}
}

// The scanner's states that some text reaches, each with a shortest text that leaves the scanner in it, as classes.
// flex's table has three more: state 0, which is no state, a second start state for the start of a line, which
// this scanner never uses, and the state of the end of flex's buffer.
export function scannerAccess(tables: Tables = defaultTables): Map<number, number[]> {
  const {scannerNext, scannerClassCount, scannerStart} = tables
  const access = new Map<number, number[]>([[scannerStart, []]])
  const pending = [scannerStart]
  for (let at = 0; at < pending.length; at++) {
    const state = pending[at]!
    for (let characterClass = 1; characterClass < scannerClassCount; characterClass++) {
      const next = scannerNext[state * scannerClassCount + characterClass]!
      if (next <= 0 || access.has(next)) continue
      access.set(next, [...access.get(state)!, characterClass])
      pending.push(next)
    }
  }
  return access
}

// For every two reachable states of the scanner that some text tells apart, a shortest such text, as classes: the
// tokens differ when the two states read it. The empty text tells two states apart in which tokens of two kinds
// end. One class does when one state moves on it and the other ends its token, or when both end tokens of two
// kinds. Otherwise both move, and a longer text does when it tells the two next states apart.
function scannerDistinguishingTexts(tables: Tables, states: readonly number[]): {texts: number[][], equalPairs: number} {
  const {scannerNext, scannerClassCount, scannerKindOfState} = tables
  const keyOf = (first: number, second: number): number => Math.min(first, second) * tables.scannerStateCount + Math.max(first, second)
  const textOfPair = new Map<number, number[]>()
  for (const first of states) for (const second of states) if (first < second && scannerKindOfState[first] !== scannerKindOfState[second]) textOfPair.set(keyOf(first, second), [])
  for (let changed = true; changed;) {
    changed = false
    for (const first of states) {
      for (const second of states) {
        if (first >= second || textOfPair.has(keyOf(first, second))) continue
        let best: number[] | undefined
        for (let characterClass = 1; characterClass < scannerClassCount; characterClass++) {
          const firstNext = scannerNext[first * scannerClassCount + characterClass]!, secondNext = scannerNext[second * scannerClassCount + characterClass]!
          let text: number[] | undefined
          if ((firstNext > 0) !== (secondNext > 0)) text = [characterClass]
          else if (firstNext > 0 && firstNext !== secondNext) {
            const after = textOfPair.get(keyOf(firstNext, secondNext))
            if (after !== undefined) text = [characterClass, ...after]
          }
          if (text !== undefined && (best === undefined || text.length < best.length)) best = text
        }
        if (best === undefined) continue
        textOfPair.set(keyOf(first, second), best)
        changed = true
      }
    }
  }
  const distinct = new Map<string, number[]>()
  for (const text of textOfPair.values()) distinct.set(text.join(), text)
  return {texts: [...distinct.values()], equalPairs: states.length * (states.length - 1) / 2 - textOfPair.size}
}

export type ScannerTexts = {
  group: TextGroup
  reachableStates: number[]
  // The place in the group of the text for a reachable state (as a place in reachableStates), a code point from
  // U+0000 to U+0080 after it, and an ending: 0 for none, then the texts that tell two states apart.
  textAt: (stateIndex: number, codePoint: number, ending: number) => number
  // How many endings there are, with the empty one.
  endingCount: number
  distinguishingTexts: number
  // The pairs of reachable states that no text tells apart: the scanner would cut every text the same with one of
  // the two in the place of the other.
  equalPairs: number
}

// Texts that go through every cell of the scanner: for every reachable state, a shortest text that leaves the
// scanner in the state, then every code point from U+0000 to U+0080, then every one of the texts that tell two
// states apart. With these, a scanner with one changed move cuts some text differently, unless the move leads to
// a state that no text tells apart from the right one.
export function scannerTexts(tables: Tables = defaultTables): ScannerTexts {
  const {scannerClassOfByte, scannerClassCount} = tables
  const access = scannerAccess(tables)
  const reachableStates = [...access.keys()].sort((left, right) => left - right)
  const {texts: distinguishing, equalPairs} = scannerDistinguishingTexts(tables, reachableStates)
  // A code point of every class: the first printable one, else the first one.
  const codePointOfClass = new Int32Array(scannerClassCount).fill(-1)
  for (let pass = 0; pass < 2; pass++) {
    for (let codePoint = 0; codePoint <= 0x80; codePoint++) {
      const characterClass = scannerClassOfByte[codePoint]!
      if (codePointOfClass[characterClass] === -1 && (pass === 1 || (codePoint > 0x20 && codePoint < 0x7f))) codePointOfClass[characterClass] = codePoint
    }
  }
  const textOf = (classes: readonly number[]): number[] => classes.map(characterClass => codePointOfClass[characterClass]!)
  const endings = [[], ...distinguishing].map(textOf)
  const texts: Int32Array[] = []
  for (const state of reachableStates) {
    const start = textOf(access.get(state)!)
    texts.push(Int32Array.from(start))
    for (let codePoint = 0; codePoint <= 0x80; codePoint++) for (const ending of endings) texts.push(Int32Array.from([...start, codePoint, ...ending]))
  }
  const textsPerState = 1 + 0x81 * endings.length
  const textAt = (stateIndex: number, codePoint: number, ending: number): number => stateIndex * textsPerState + 1 + codePoint * endings.length + ending
  return {group: {name: 'every cell of the scanner', texts}, reachableStates, textAt, endingCount: endings.length, distinguishingTexts: distinguishing.length, equalPairs}
}

// Every text of up to `maximumLength` code points over one code point of every class of the scanner, with U+0000
// and U+0080.
export function shortTexts(maximumLength: number, tables: Tables = defaultTables): TextGroup {
  const {scannerClassOfByte, scannerClassCount} = tables
  const alphabet: number[] = [0, 0x80]
  const seen = new Uint8Array(scannerClassCount)
  for (let pass = 0; pass < 2; pass++) {
    for (let codePoint = 1; codePoint < 0x80; codePoint++) {
      const characterClass = scannerClassOfByte[codePoint]!
      if (seen[characterClass] === 1 || (pass === 0 && (codePoint <= 0x20 || codePoint >= 0x7f))) continue
      seen[characterClass] = 1
      alphabet.push(codePoint)
    }
  }
  const texts: Int32Array[] = []
  let level: number[][] = [[]]
  for (let length = 1; length <= maximumLength; length++) {
    const next: number[][] = []
    for (const text of level) for (const codePoint of alphabet) next.push([...text, codePoint])
    for (const text of next) texts.push(Int32Array.from(text))
    level = next
  }
  return {name: `every text of up to ${maximumLength} code points`, texts}
}
