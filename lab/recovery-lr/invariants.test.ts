// The invariants of the dataset on a few thousand samples. check-dataset.ts holds the same against the whole
// dataset, with the counts.
// Run from the repo root: bun test lab/recovery-lr
import {expect, test} from 'bun:test'
import {damageProgram, editNames} from './damage.ts'
import {defaultSeed, indexOfSample, loadSamples, programAt, sampleAt, splitOf} from './dataset.ts'
import {idiomOf, sortOfProgram} from './generate.ts'
import {commonIdioms, holes, idiomsOfSort, sorts, vocabulary} from './idioms.ts'
import {containerNames, displayKind, labelsOfValidText} from './labels.ts'
import {codePointsOf, isValid, maximumCodePoints, parseText} from './parser.ts'
import {createRandom} from './random.ts'
import {type Sample, alignmentOfTexts, makeSample} from './sample.ts'
import {firstEditPosition, outputsBeforeFirstError, scoredOutOfReach} from './stats.ts'
import {type Style, definitionsOf, inline, linesOfDefinition, withBrackets} from './syntax.ts'
import {isTrivia, tables} from './tables.ts'

const sampleCount = 2000
const drawn = Array.from({length: sampleCount}, (_, index) => sampleAt(defaultSeed, index))
// Throws with the sample's id and texts, so that a failure can be read.
const fail = (sample: Sample, what: string): never => {
  throw new Error(`${what}\n  sample ${sample.id}, edits ${sample.edits.join(', ')}\n  original ${JSON.stringify(sample.original)}\n  broken   ${JSON.stringify(sample.broken)}`)
}
const sampleOf = (original: string, broken: string): Sample => {
  const sample = makeSample({id: 'by hand', original, broken, alignment: alignmentOfTexts(original, broken)})
  if (typeof sample === 'string') throw new Error(`${JSON.stringify(broken)} is no sample: ${sample}`)
  return sample
}
const plainStyle: Style = {
  unit: '  ', width: 80, definitionsOnOneLine: false, breakLocal: 0, breakConditional: 0, branchOnOwnLine: 0, breakAfterEquals: 0, breakList: 0, inOnOwnLine: 0, operatorFirst: true, listAsBlock: true,
  comma: ', ', semicolon: '; ', spaceInsideBrackets: false, tightOperators: [], tightEquals: false, bareOpenOperand: 1, bracketCondition: 0, bracketOperand: 0,
}

test('every program is valid, has at most 512 code points and no hole, and all 17 sorts are written', () => {
  const seen = new Set<string>()
  for (const {sample, sort} of drawn) {
    seen.add(sort)
    if (!isValid(sample.original)) fail(sample, 'the original is not valid')
    if (Array.from(sample.original).length > maximumCodePoints) fail(sample, 'the original is too long')
    if (sortOfProgram(defaultSeed, indexOfSample(sample)) !== sort) fail(sample, 'the sort is another one when it is asked for alone')
    for (const hole of holes) if (new RegExp(`(^|[^A-Za-z0-9_'"])${hole}($|[^A-Za-z0-9_'"])`).test(sample.original.replaceAll(/"([^"\\]|\\.)*"/g, '""').replaceAll(/\(\*[\s\S]*?\*\)/g, ''))) fail(sample, `the hole ${hole} is left`)
  }
  expect([...seen].sort()).toEqual([...sorts].sort())
})

test('every idiom is a valid program, and its names with a kind are in the vocabulary', () => {
  for (const idiom of [...sorts.flatMap(sort => idiomsOfSort[sort]), ...commonIdioms]) {
    // The first alternative of every `{a ~ b}`.
    let text = idiom
    for (let match = /\{([^{}]*)\}/.exec(text); match !== null; match = /\{([^{}]*)\}/.exec(text)) text = `${text.slice(0, match.index)}${match[1]!.split('~')[0]!.trim()}${text.slice(match.index + match[0].length)}`
    expect(idiomOf(text).definitions.length).toBeGreaterThan(0)
  }
  // No other name of the vocabulary is a keyword or a hole, and none is there twice for one name.
  for (const [name, [, ...others]] of Object.entries(vocabulary)) {
    expect(new Set(others).size).toBe(others.length)
    for (const other of [name, ...others]) {
      expect(isValid(`let ${other} = 1`)).toBe(true)
      expect((holes as readonly string[]).includes(other)).toBe(false)
    }
  }
})

test('a tree that is written and read again is the same tree', () => {
  for (const {sample} of drawn.slice(0, 500)) {
    const definitions = definitionsOf(sample.original)
    const random = createRandom(defaultSeed + 31, indexOfSample(sample))
    const written = definitions.map(({binding}) => linesOfDefinition({...binding, value: withBrackets(binding.value, 0, true, false, plainStyle, random)}, plainStyle, random).join('\n')).join('\n')
    if (JSON.stringify(definitionsOf(written).map(definition => definition.binding)) !== JSON.stringify(definitions.map(definition => definition.binding))) fail(sample, `the program reads as another tree when it is written again:\n${written}`)
  }
  // Brackets stand where the grammar needs them, and an `if` without `else` does not take the `else` after it.
  const written = (text: string): string => {
    const {binding} = definitionsOf(text)[0]!
    return inline(withBrackets(binding.value, 0, true, false, plainStyle, createRandom(1, 1)), plainStyle)
  }
  expect(written('let x = (a + b) * c')).toBe('(a + b) * c')
  expect(written('let x = a + (b * c)')).toBe('a + b * c')
  expect(written('let x = a - (b - c)')).toBe('a - (b - c)')
  expect(written('let x = (a :: b) :: c')).toBe('(a :: b) :: c')
  expect(written('let x = f (g x) (-1) (fun y -> y)')).toBe('f (g x) (-1) (fun y -> y)')
  expect(written('let x = a + (if c then 1 else 2)')).toBe('a + if c then 1 else 2')
  expect(written('let x = (if c then 1 else 2) + a')).toBe('(if c then 1 else 2) + a')
  expect(written('let x = if a then (if b then 1) else 2')).toBe('if a then (if b then 1) else 2')
  expect(written('let x = if a then (if b then 1 else 3) else 2')).toBe('if a then if b then 1 else 3 else 2')
  expect(written('let x = -(a + b)')).toBe('-(a + b)')
  expect(written('let x = - -a')).toBe('- -a')
})

test('every broken text is rejected, and a kept code point has the labels of its counterpart', () => {
  for (const {sample} of drawn) {
    if (sample.original === sample.broken || isValid(sample.broken)) fail(sample, 'the broken text is not rejected')
    if (sample.codePoints.length > maximumCodePoints) fail(sample, 'the broken text is too long')
    if (sample.edits.length < 1 || sample.edits.length > 3 || sample.edits.some(edit => !(editNames as readonly string[]).includes(edit))) fail(sample, 'the edits are not one to three of the ten')
    const labels = labelsOfValidText(sample.original)
    const original = codePointsOf(sample.original)
    let last = -1, scored = 0
    for (let position = 0; position < sample.codePoints.length; position++) {
      const counterpart = sample.alignment[position]!
      if (counterpart === -1) continue
      if (counterpart <= last || original[counterpart] !== sample.codePoints[position]) fail(sample, `code point ${position} is no kept code point`)
      last = counterpart
      if (sample.labelKind[position] !== labels.kind[counterpart] || sample.labelDepth[position] !== labels.depth[counterpart] || sample.labelContainer[position] !== labels.container[counterpart]) fail(sample, `code point ${position} does not have its counterpart's labels`)
      if (sample.labelKind[position] === displayKind.error) fail(sample, 'a label is "error"')
      if (position >= sample.firstErrorPosition) scored++
    }
    if (scored === 0 || scored !== sample.scored) fail(sample, 'the sample has nothing to score, or another number than it says')
  }
})

test('the first error is where the parser as it is reports its error, and never the end of the text', () => {
  for (const {sample} of drawn) {
    const {parse, tokens} = parseText(sample.broken)
    if (parse.valid || parse.firstErrorToken !== sample.firstErrorToken || parse.firstErrorPosition !== sample.firstErrorPosition) fail(sample, 'the first error is not the parser\'s')
    if (sample.firstErrorToken >= tokens.count || isTrivia(tokens.kind[sample.firstErrorToken]!)) fail(sample, 'the first error is no token of the text')
    if (tables.frozen[sample.startStack.at(-1)! * tables.terminalCount + tokens.kind[sample.firstErrorToken]!] !== 0) fail(sample, 'the first error reads a frozen cell')
    // Before the first error the parser shows a kept token as some kind, never as an error.
    const outputs = outputsBeforeFirstError(sample)
    for (let position = 0; position < sample.firstErrorPosition; position++) if (outputs.kind[position] === -1 || outputs.kind[position] === displayKind.error) fail(sample, `the parser gives code point ${position} no kind before the first error`)
    // A sample whose only edit is at its end is a text that is cut inside a token, e.g. inside a string.
    if (firstEditPosition(sample) === sample.codePoints.length && sample.firstErrorToken !== tokens.count - 1) fail(sample, 'the only edit is at the end of the text, and the first error is not the last token')
  }
})

test('no list of tokens is in both splits, and the same seed gives the same samples', () => {
  const lists = {train: new Set<string>(), validation: new Set<string>()}
  for (const {sample, split} of drawn) {
    const {tokens} = parseText(sample.original)
    lists[split].add(Array.from(tokens.kind).filter(kind => !isTrivia(kind)).join(' '))
    if (splitOf(sample.original) !== split) fail(sample, 'the split is not the split of the original')
  }
  for (const list of lists.validation) expect(lists.train.has(list)).toBe(false)
  expect(lists.validation.size).toBeGreaterThan(sampleCount / 9 / 2)
  const train = loadSamples('train', defaultSeed, 200)
  for (const [place, sample] of train.entries()) {
    const again = sampleAt(defaultSeed, indexOfSample(sample))
    if (again.sample.broken !== sample.broken || again.split !== 'train' || again.sample.alignment.join() !== sample.alignment.join()) fail(sample, 'the sample is another one when it is made alone')
    if (place > 0 && indexOfSample(train[place - 1]!) >= indexOfSample(sample)) fail(sample, 'the samples are not in the order of their indexes')
  }
  expect(sampleAt(defaultSeed + 1, 0).sample.broken).not.toBe(sampleAt(defaultSeed, 0).sample.broken)
})

test('the damage makes the same edits when the letters of a program are exchanged for others', () => {
  for (let index = 0; index < 300; index++) {
    const original = Array.from(programAt(defaultSeed, index).labels.codePoints)
    // Every code point but the line feed becomes another one, which the program does not have.
    const exchange = (codePoint: number): number => codePoint === 10 ? 10 : 0x10000 + codePoint
    const first = damageProgram(original, createRandom(defaultSeed + 22, index)), second = damageProgram(original.map(exchange), createRandom(defaultSeed + 22, index))
    expect(second.edits).toEqual(first.edits)
    expect(second.alignment).toEqual(first.alignment)
    expect(second.codePoints).toEqual(first.codePoints.map(exchange))
  }
})

test('the numbers of stats.ts on samples by hand', () => {
  // The `then` is removed. `c x` reads as an application, so the first error is the `else`, three code points
  // after the place of the edit, and the `x` is taken inside the `if` and not after a `then`.
  const withoutThen = sampleOf('let f c = if c then x else y', 'let f c = if c  x else y')
  expect(firstEditPosition(withoutThen)).toBe(15)
  expect(withoutThen.firstErrorPosition).toBe(18)
  expect(containerNames[outputsBeforeFirstError(withoutThen).container[16]!]).toBe('if')
  expect(containerNames[withoutThen.labelContainer[16]!]).toBe('then')
  expect(scoredOutOfReach(withoutThen)).toBe(0)
  // A text that is cut inside a string: the edit is at the text's end, after the start of the first error's token.
  const cut = sampleOf('let a = "one" let b = 2', 'let a = "on')
  expect(firstEditPosition(cut)).toBe(11)
  expect(cut.firstErrorPosition).toBe(8)
  expect(cut.scored).toBe(3)
  // Two tokens that become one: `let x` without its space is the name `letx`, which has one kind for the
  // keyword's three code points and for the defined name's one. One of the four is wrong for every parser.
  const merged = sampleOf('let a = 1 let x = 2', 'let a 1 letx = 2')
  expect(merged.firstErrorPosition).toBe(6)
  expect(scoredOutOfReach(merged)).toBe(1)
  // White space on both sides of a removed token is one run after the token before it: the space before the
  // removed `(` has the depth 1, and the space after it the depth 2.
  const joined = sampleOf('let a = 1 let x = ( 2 )', 'let a 1 let x =  2 )')
  expect(joined.firstErrorPosition).toBe(6)
  expect(scoredOutOfReach(joined)).toBe(1)
  // A string that lost its closing quote takes the text up to the next quote, so the quotes after it change
  // their roles. `f "one b " two` is an application, and the first error is the last quote, which opens a string.
  const openString = sampleOf('let a = f "one" b "two"', 'let a = f "one b "two"')
  expect(openString.firstErrorPosition).toBe(21)
  expect(openString.scored).toBe(1)
  // With an error before it, the same text is scored: the token `"one b "` holds five code points of strings, two
  // of white space and one of a name, and the token `")` at the end holds one of a string and a bracket.
  const openStringScored = sampleOf('let a = (f "one" b "two")', 'let a = )f "one b "two")')
  expect(openStringScored.firstErrorPosition).toBe(8)
  expect(scoredOutOfReach(openStringScored)).toBe(4)
  // A string that lost both quotes: its space is white space for the scanner, and a string for its label.
  const withoutQuotes = sampleOf('let a = (f "one two")', 'let a = )f one two)')
  expect(scoredOutOfReach(withoutQuotes)).toBe(1)
})
