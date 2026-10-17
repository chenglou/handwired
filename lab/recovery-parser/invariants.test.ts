// The invariants of the dataset, on a few thousand samples, and the table parser against the reference highlighter.
// Run from the repo root: bun test lab/recovery-parser
import {expect, test} from 'bun:test'
import {displayKind, maximumDepth} from '../../src/json-search/highlighter/kinds.ts'
import {createCorpus} from '../../tests/json-search/highlighter/corpus.ts'
import {highlightReference} from '../../tests/json-search/highlighter/reference.ts'
import {sampleProblems} from './check-samples.ts'
import {tableParserDifference} from './check-table-parser.ts'
import {contradictions, kinds} from './damage.ts'
import {drawLayout, makeDocumentOf} from './documents.ts'
import {type Edit, applyEdits, canonicalEdits, insertAt, removeRange, replaceOneForOne} from './edits.ts'
import {handRuleTables, handRules} from './hand-rules.ts'
import {kindLetters, labelsOfValidText, tokenSequenceOf} from './labels.ts'
import {cellsThatValidJsonReads, conditionProblems, limitsOf} from './limits.ts'
import {createRandom} from './random.ts'
import {isWordKey, scan} from './scan.ts'
import {type Sample, defaultSeed, groupOf, heldOutKinds, heldOutTemplate, labelsOf, limitsFor, mostRightFor, sampleAt, scoredCodePoints, splitKeyOf, splitOf, splitOfDocuments, splits, typingReplayOf} from './samples.ts'
import {type ParserTables, capacity, classNames, defaultTables, eventNames, lexerStateNames, runTableParser} from './table-parser.ts'

const sampleCount = 3000
const samples: Sample[] = Array.from({length: sampleCount}, (_, index) => sampleAt(defaultSeed, index))
const parses = (text: string) => {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}
// Throws with the sample's id and texts, so a failure can be read.
const fail = (sample: Sample, what: string): never => {
  throw new Error(`${what}\n  sample ${sample.id}, kinds ${sample.kinds.length === 0 ? 'none' : sample.kinds.join(', ')}\n  original ${JSON.stringify(sample.original)}\n  broken   ${JSON.stringify(sample.broken)}`)
}

test('the table parser agrees with the reference highlighter on the corpus and on the samples', () => {
  const corpus = createCorpus(20261015, {random: 400, mutated: 1200, long: 60})
  for (const text of [...corpus.all, ...samples.slice(0, 1500).flatMap(sample => [sample.broken, ...sample.documents])]) {
    const difference = tableParserDifference(text)
    if (difference !== null) throw new Error(`${difference}\n  ${JSON.stringify(text)}`)
  }
})

test('every original is valid, and every broken text is rejected and within the limits', () => {
  for (const sample of samples) {
    expect(sample.original).toBe(sample.documents.join(''))
    for (const document of sample.documents) {
      if (!parses(document) || highlightReference(document).valid !== 1) fail(sample, `a document is not valid: ${JSON.stringify(document)}`)
    }
    if (Array.from(sample.original).length > capacity || sample.alignment.length > capacity) fail(sample, 'a text is longer than the capacity')
    if (sample.source === 'valid') {
      if (sample.broken !== sample.original || sample.edits.length > 0 || sample.firstDamage !== -1) fail(sample, 'a valid sample is damaged')
      continue
    }
    if (sample.kinds.length === 0) fail(sample, 'a broken sample has no kind')
    const reference = highlightReference(sample.broken)
    if (parses(sample.broken) || reference.valid !== 0) fail(sample, 'the broken text is not rejected')
    if (reference.firstErrorPosition !== sample.firstErrorPosition || reference.firstErrorKind !== sample.firstErrorKind) fail(sample, 'the first error is not the reference highlighter\'s')
    const trace = runTableParser(sample.broken)
    for (let position = 0; position < trace.length; position++) {
      if (trace.depthAfter[position]! > maximumDepth) fail(sample, 'the broken text nests deeper than 16 levels')
    }
  }
})

test('the edits give the broken text, are in the canonical form, and the alignment pairs equal code points in rising order', () => {
  for (const sample of samples) {
    const original = Array.from(sample.original)
    const broken = Array.from(sample.broken)
    const applied = applyEdits(original, sample.edits)
    if (applied.broken !== sample.broken) fail(sample, 'the edits applied to the original do not give the broken text')
    expect(applied.alignment).toEqual(sample.alignment)
    expect(canonicalEdits(original, sample.edits)).toEqual(sample.edits)
    expect(sample.alignment.length).toBe(broken.length)
    let previous = -1
    sample.alignment.forEach((index, position) => {
      if (index === -1) {
        if (sample.replaced[position] === true) fail(sample, `position ${position} is both added and replaced`)
        return
      }
      if (index <= previous) fail(sample, `the alignment does not rise at ${position}`)
      previous = index
      // A kept code point equals its counterpart, and a replaced one stands in its place and differs from it.
      if ((sample.replaced[position] === true) === (broken[position] === original[index])) fail(sample, `the code point at ${position} is kept and differs from its counterpart, or is replaced and equals it`)
    })
    for (const index of [...sample.unscoredKinds, ...sample.unscoredNesting]) {
      if (!sample.alignment.includes(index)) fail(sample, `the unscored code point ${index} of the original is not in the broken text`)
    }
  }
})

test('text that is added before the whole original stays there, unless it is one code point, and the second derivation follows', () => {
  // A log prefix that starts with the document's first code points is the added text as a whole.
  const prefix = '2026-06-19 12:23:40,515 - app.orders - ERROR - '
  expect(canonicalEdits(Array.from('20142'), [insertAt(0, prefix)])).toEqual([insertAt(0, prefix)])
  // One code point before the same code point moves, so the first brace is the kept one. So does a run of one code point.
  expect(canonicalEdits(Array.from('{"a": 1}'), [insertAt(0, '{')])).toEqual([insertAt(1, '{')])
  expect(canonicalEdits(Array.from('""'), [insertAt(0, '""')])).toEqual([insertAt(2, '""')])
  // After the start of the original, an added text still moves with its code points in another order: a line `}`
  // before the `}` that ends a document is that `}` kept, and a line feed and a `}` added.
  expect(canonicalEdits(Array.from('{"a": 1\n}'), [insertAt(8, '}\n')])).toEqual([insertAt(9, '\n}')])
  // Such a sample is rare, about one in 10,000 with the kind logPrefix: a lone number that starts with 2 after a
  // prefix that starts with the year. Its number is kept whole, and the second derivation agrees.
  const sample = sampleAt(defaultSeed, 4593, {kind: 'logPrefix'})
  expect([sample.original, sample.broken]).toEqual(['21101', '2026-03-01 15:25:41,257 - http - WARNING - 21101'])
  expect(sample.edits).toEqual([{at: 0, remove: 0, insert: '2026-03-01 15:25:41,257 - http - WARNING - ', rank: -3}])
  expect([sample.firstDamage, sample.alignment.slice(-6)]).toEqual([0, [-1, 0, 1, 2, 3, 4]])
  expect(sampleProblems(sample)).toEqual([])
  // The same texts with the prefix moved into the number, as the edits were before: the 2 of the year is kept as the
  // start of the number. The second derivation reports it.
  const moved: Sample = structuredClone(sample)
  moved.edits = [{at: 1, remove: 0, insert: '026-03-01 15:25:41,257 - http - WARNING - 2', rank: -3}]
  moved.alignment = [0, ...sample.alignment.slice(1, -5), -1, 1, 2, 3, 4]
  moved.firstDamage = 1
  expect(applyEdits(Array.from(moved.original), moved.edits).broken).toBe(sample.broken)
  expect(sampleProblems(moved)).toEqual(['the insertion at 1 is text that stands before the whole original, with its first code points taken for the original\'s'])
})

test('before its first error, the parser as it is gives every scored label, and the first error is not before the first damage', () => {
  for (const sample of samples) {
    if (sample.source === 'valid') continue
    const {firstDamage, alignment} = sample
    if (firstDamage < 0 || firstDamage > alignment.length) fail(sample, `the first damage ${firstDamage} is outside the broken text`)
    // Before the first damage the broken text is the original's start, code point for code point.
    for (let position = 0; position < firstDamage; position++) {
      if (alignment[position] !== position || sample.replaced[position] === true) fail(sample, `position ${position} is before the first damage and is not the original's code point ${position}`)
    }
    if (sample.firstErrorPosition < firstDamage) fail(sample, `the parser reports an error at ${sample.firstErrorPosition}, before the first damage at ${firstDamage}`)
    // Up to the first error, every arm of the experiment gives what the parser as it is gives. Every scored value
    // there is that, so no label asks for what no arm can give. Before the first damage, every value is scored.
    const labels = labelsOf(sample)
    const trace = runTableParser(sample.broken)
    for (let position = 0; position < Math.min(sample.firstErrorPosition, labels.length); position++) {
      const label = labels[position]
      if (label === undefined) continue
      if (position < firstDamage && (label.kind === undefined || label.depth === undefined)) fail(sample, `the label at ${position}, before the first damage, has a value that is not scored`)
      if (label.kind !== undefined && label.kind !== trace.displayKind[position]) fail(sample, `the display kind at ${position}, before the first error, is scored and is not what the parser as it is gives`)
      if (label.depth !== undefined && (label.depth !== trace.depthAfter[position] || label.container !== trace.containerAfter[position])) fail(sample, `the depth or the container at ${position}, before the first error, is scored and is not what the parser as it is gives`)
    }
  }
})

test('labels are those of the documents, each alone, and added code points have none', () => {
  for (const sample of samples.slice(0, 1500)) {
    const labels = labelsOf(sample)
    const expected = sample.documents.flatMap(labelsOfValidText)
    expect(labels.length).toBe(sample.alignment.length)
    sample.alignment.forEach((index, position) => {
      const label = labels[position]
      if (index === -1) {
        if (label !== undefined) fail(sample, `the added code point at ${position} has a label`)
        return
      }
      if (label === undefined) return fail(sample, `the kept code point at ${position} has no label`)
      if (label.depth !== undefined && (label.depth !== expected[index]!.depth || label.container !== expected[index]!.container)) fail(sample, `the label at ${position} is not its counterpart's`)
      if (label.kind !== undefined && label.kind !== expected[index]!.kind) fail(sample, `the display kind at ${position} is not its counterpart's`)
      if ((label.kind === undefined) !== sample.unscoredKinds.includes(index)) fail(sample, `the display kind at ${position} is scored or not against the sample's list`)
      if ((label.depth === undefined) !== sample.unscoredNesting.includes(index) || (label.depth === undefined) !== (label.container === undefined)) fail(sample, `the depth and the container at ${position} are scored or not against the sample's list`)
    })
  }
})

// The index in the original of the first code point of a string value whose opening quote is not in the broken text,
// which stands after the first error and whose display kind is not scored, or -1.
function valueStartOf(sample: Sample) {
  const original = Array.from(sample.original)
  for (let position = sample.firstErrorPosition + 1; position < sample.alignment.length; position++) {
    const index = sample.alignment[position]!
    if (index > 0 && original[index - 1] === '"' && /[-0-9tfn]/.test(original[index]!) && !sample.alignment.includes(index - 1) && sample.unscoredKinds.includes(index) && sample.alignment[position - 1] === index - 2) return index
  }
  return -1
}

test('a second derivation that shares no code with the dataset agrees on every sample, and reports samples that are spoiled', () => {
  for (const sample of samples) {
    const problems = sampleProblems(sample)
    if (problems.length > 0) fail(sample, problems.join('; '))
  }
  // Each way of spoiling a sample must be reported, on the first samples that it applies to. So the agreement above
  // is not that of a check that finds nothing.
  const spoilers: [name: string, applies: (sample: Sample) => boolean, spoil: (sample: Sample) => void][] = [
    ['a kept label loses its place in the alignment', sample => sample.alignment.length > 2, sample => { sample.alignment[1] = sample.alignment[1]! + 1 }],
    ['one character of the broken text changes', sample => sample.alignment[0] === 0, sample => { sample.broken = `${sample.broken[0] === 'x' ? 'y' : 'x'}${sample.broken.slice(1)}` }],
    ['the first damage moves one to the left', sample => sample.firstDamage > 0, sample => { sample.firstDamage-- }],
    ['the first damage moves one to the right', sample => sample.firstDamage < sample.alignment.length, sample => { sample.firstDamage++ }],
    ['an edit is dropped', sample => sample.edits.length > 0, sample => { sample.edits.pop() }],
    ['an added code point gets a counterpart', sample => sample.alignment.includes(-1), sample => { sample.alignment[sample.alignment.indexOf(-1)] = 0 }],
    // A kind of damage may leave any display kind after the first damage unscored, so only one before it is a mistake for certain.
    ['a display kind before the first damage is listed as not scored', sample => sample.firstDamage > 0 && !sample.unscoredKinds.includes(0), sample => { sample.unscoredKinds.push(0) }],
    // A value without quotes that starts like a number or a literal, after the first error, where only the rule for
    // such values leaves its first code points unscored.
    ['the start of a value without quotes that reads as a number is scored', sample => valueStartOf(sample) !== -1, sample => { sample.unscoredKinds.splice(sample.unscoredKinds.indexOf(valueStartOf(sample)), 1) }],
    ['a depth that is scored is listed as not scored', sample => sample.unscoredNesting.length === 0, sample => { sample.unscoredNesting.push(sample.alignment.find(index => index !== -1)!) }],
    ['a depth that is not scored is scored', sample => sample.unscoredNesting.length > 0, sample => { sample.unscoredNesting.pop() }],
    ['a replaced flag is set on a kept code point', sample => sample.alignment[0] === 0 && !sample.replaced[0], sample => { sample.replaced[0] = true }],
    ['a document is not valid', () => true, sample => { sample.documents[0] = `${sample.documents[0]!}]`; sample.original = sample.documents.join('') }],
    ['the first error moves', () => true, sample => { sample.firstErrorPosition++ }],
    ['the broken text is the original', () => true, sample => { sample.broken = sample.original; sample.edits = []; sample.alignment = Array.from(sample.original, (_, index) => index); sample.replaced = sample.alignment.map(() => false) }],
  ]
  const broken = samples.filter(sample => sample.source !== 'valid')
  for (const [name, applies, spoil] of spoilers) {
    const chosen = broken.filter(applies).slice(0, 25)
    expect(chosen.length).toBeGreaterThan(0)
    for (const sample of chosen) {
      const spoiled: Sample = structuredClone(sample)
      spoil(spoiled)
      if (sampleProblems(spoiled).length === 0) fail(sample, `the second derivation does not notice when ${name}`)
    }
  }
})

// The labels of a broken text made by hand, for the tests of limits.ts: every label is scored, apart from the depth
// and the container of the listed code points of the original.
function limitsOfText(original: string, edits: Edit[], unscoredNesting: number[] = []) {
  const originalCodePoints = Array.from(original)
  const applied = applyEdits(originalCodePoints, edits)
  const valid = labelsOfValidText(original)
  const labels = applied.alignment.map(index => {
    if (index === -1) return undefined
    const scored = !unscoredNesting.includes(index)
    return {kind: valid[index]!.kind, depth: scored ? valid[index]!.depth : undefined, container: scored ? valid[index]!.container : undefined}
  })
  const limits = limitsOf(Array.from(applied.broken), labels, runTableParser(applied.broken).firstErrorPosition)
  return {...limits, broken: applied.broken}
}

test('the fields about what the loop can give say what limits.ts proves, on texts made by hand', () => {
  const withoutQuotes = [removeRange(1, 2), removeRange(6, 7), removeRange(12, 13), removeRange(17, 18)]
  // A key without quotes that starts with n, right after the brace: the n is read as the start of null by a cell that
  // valid JSON reads, and that cell shows a literal.
  const keys = limitsOfText('{"name": 1, "port": 2}', withoutQuotes)
  expect(keys.broken).toBe('{name: 1, port: 2}')
  expect([keys.needsDisplayFix, keys.displayStopsAt, keys.needsNestingFix]).toEqual([true, 1, false])
  // The same key after a key that starts with p: the cell for p between two tokens is one that valid JSON never
  // reads, so the tables can be in a state of their own from there on, in which a word after a comma is a key.
  const later = limitsOfText('{"port": 1, "name": 2}', withoutQuotes)
  expect(later.broken).toBe('{port: 1, name: 2}')
  expect(later).toMatchObject({needsDisplayFix: false, needsNestingFix: false})
  // A closer that must close two containers. Every code point is read by a cell that valid JSON reads, and the line
  // feed before the closer, whose depth is not scored, moves no depth.
  const twoContainers = limitsOfText('{"a": ["x"]\n}', [removeRange(10, 11)], [11])
  expect(twoContainers.broken).toBe('{"a": ["x"\n}')
  expect([twoContainers.needsNestingFix, twoContainers.nestingStopsAt]).toEqual([true, 11])
  // The same after a comment: nothing is proven. The slash is read by a cell that valid JSON never reads, and the
  // tables may give a character of the comment the event of a closing bracket.
  const afterAComment = limitsOfText('{"a": ["x"]\n}', [insertAt(10, ' // note'), removeRange(10, 11)], [11])
  expect(afterAComment.broken).toBe('{"a": ["x" // note\n}')
  expect(afterAComment).toMatchObject({needsDisplayFix: false, needsNestingFix: false})
  // A closer too many: the loop reads it from the state between and lowers the depth, which shows at the next code
  // point that has a label, the quote of "b".
  const stray = limitsOfText('{"a": 1,\n"b": 2}', [insertAt(9, '},\n')])
  expect(stray.broken).toBe('{"a": 1,\n},\n"b": 2}')
  expect([stray.needsNestingFix, stray.nestingStopsAt]).toEqual([true, 12])
  // The same after a byte order mark, which no cell of valid JSON reads: the tables can skip the closer.
  expect(limitsOfText('{"a": 1,\n"b": 2}', [insertAt(0, '\ufeff'), insertAt(9, '},\n')])).toMatchObject({needsDisplayFix: false, needsNestingFix: false})
  // A closer of the other kind: the depth is right, and the kind of the container around it is not.
  const otherKind = limitsOfText('[{"a": [1]}, 2]', [replaceOneForOne(9, '}')])
  expect(otherKind.broken).toBe('[{"a": [1}}, 2]')
  expect([otherKind.needsNestingFix, otherKind.nestingStopsAt]).toEqual([true, 9])
  // A color code: its [ comes after a character that valid JSON never has, so the tables can skip it.
  expect(limitsOfText('{"ok": true}', [insertAt(0, '\u001b[32m'), insertAt(12, '\u001b[0m')])).toMatchObject({needsDisplayFix: false, needsNestingFix: false})
  // {{id}} opens two braces and closes two.
  expect(limitsOfText('{"a": 1, "b": 2}', [{at: 6, remove: 1, insert: '{{id}}'}])).toMatchObject({needsDisplayFix: false, needsNestingFix: false})
  // A second quote after a closing quote opens a string, which takes the comma after it.
  const doubled = limitsOfText('{"a": "x", "b": 1}', [insertAt(9, '"')])
  expect(doubled.broken).toBe('{"a": "x"", "b": 1}')
  expect([doubled.needsDisplayFix, doubled.displayStopsAt]).toEqual([true, 10])
  // A missing comma and a comment: nothing is out of reach.
  expect(limitsOfText('{"a": 1,\n"b": 2}', [removeRange(7, 8), insertAt(8, '// b\n')])).toMatchObject({needsDisplayFix: false, needsNestingFix: false})
  // After a cell that valid JSON never reads, the depth still moves by one level per code point at most: a closer
  // that must close two containers right after a string cannot.
  const afterAWord = limitsOfText('{"a": ["x"]}', [insertAt(0, '\ufeff'), removeRange(10, 11)])
  expect(afterAWord.broken).toBe('\ufeff{"a": ["x"}')
  expect([afterAWord.needsNestingFix, afterAWord.nestingStopsAt]).toEqual([true, 11])
})

// Tables of the arm that also changes tokenizer cells, made to score high: the hand rule resync, with four rows of
// the tokenizer's table that valid JSON hardly reads used as a second tokenizer, which remembers across white space
// and punctuation whether a key or a value comes next. errorLine is "between two tokens where a key may come", nul is
// "between two tokens after a colon", exponentSign is "inside a word", tru is "inside a number". So after the first
// word without quotes, a word after a comma is a key, also when it starts with t, f or n. An earlier bound, which
// took the tokenizer to be in the state between after white space and punctuation, was below what these tables have right.
function secondTokenizerTables(): ParserTables {
  const base = handRuleTables('resync')
  const read = cellsThatValidJsonReads()
  const role: Record<string, string> = {key: 'errorLine', value: 'nul', word: 'exponentSign', number: 'tru'}
  const stateNamed = (name: string) => lexerStateNames.indexOf((role[name] ?? name) as typeof lexerStateNames[number])
  const lexerEvent = [...base.lexerEvent]
  const lexerNext = [...base.lexerNext]
  const set = (from: string, characterClass: string, event: string, to: string) => {
    const cell = stateNamed(from) * defaultTables.classCount + classNames.indexOf(characterClass as typeof classNames[number])
    if (read.tokenizer[cell] === 1) return
    lexerEvent[cell] = eventNames.indexOf(event as typeof eventNames[number])
    lexerNext[cell] = stateNamed(to)
  }
  const letters = ['a', 'b', 'e', 'capitalE', 'f', 'l', 'n', 'r', 's', 't', 'u', 'otherHexLetter', 'other']
  const numberStarts = ['minus', 'zero', 'digit', 'plus', 'dot']
  const row = (name: string, fill: [string, string], cells: Record<string, [string, string]>) => {
    for (const characterClass of classNames) set(name, characterClass, ...(cells[characterClass] ?? fill))
  }
  const all = (classes: readonly string[], cell: [string, string]) => Object.fromEntries(classes.map(characterClass => [characterClass, cell]))
  const space = (to: string) => all(['space', 'tabOrCarriageReturn', 'lineFeed'], ['whitespace', to])
  const common: Record<string, [string, string]> = {
    openBrace: ['openObject', 'key'], openBracket: ['openArray', 'value'], closeBrace: ['closeObject', 'key'], closeBracket: ['closeArray', 'key'], colon: ['colon', 'value'], comma: ['comma', 'key'],
    end: ['end', 'key'], truncatedEnd: ['truncatedEnd', 'key'], quote: ['stringStart', 'string'],
  }
  for (const letter of letters) set('between', letter, 'stringStart', 'word')
  for (const state of ['t', 'tr', 'f', 'fa', 'fal', 'fals', 'n', 'nu']) for (const characterClass of [...letters, 'zero', 'digit', 'minus', 'dot']) set(state, characterClass, 'stringContent', 'word')
  for (const state of ['zero', 'integer', 'fraction', 'exponentDigits', 'dot', 'minus', 'exponent']) for (const characterClass of [...letters, 'dot', 'minus']) set(state, characterClass, 'stringContent', 'word')
  row('key', ['unexpectedCharacter', 'key'], {...all(letters, ['stringStart', 'word']), ...space('key'), ...common, ...all(numberStarts, ['numberStart', 'number'])})
  row('value', ['unexpectedCharacter', 'value'], {...all(letters, ['stringStart', 'word']), t: ['literalStart', 't'], f: ['literalStart', 'f'], n: ['literalStart', 'n'], ...space('value'), ...common, ...all(numberStarts, ['numberStart', 'number'])})
  row('word', ['stringContent', 'word'], {...space('key'), ...common})
  row('number', ['numberContent', 'number'], {...all(letters, ['stringContent', 'word']), ...space('key'), ...common})
  return {...base, lexerEvent, lexerNext}
}

// Tables with something drawn at random in every cell that valid JSON never reads, with `addedStates` more tokenizer
// states and as many more grammar states, whose rows are drawn too.
function randomTables(seed: number, addedStates: number): ParserTables {
  const random = createRandom(seed, 0)
  const read = cellsThatValidJsonReads()
  const lexerStateCount = lexerStateNames.length + addedStates
  const grammarStateCount = defaultTables.grammarStateCount + addedStates
  const lexerEvent = Array.from({length: lexerStateCount * defaultTables.classCount}, (_, cell) => read.tokenizer[cell] === 1 ? defaultTables.lexerEvent[cell]! : random.integer(0, defaultTables.eventCount - 1))
  const lexerNext = Array.from({length: lexerStateCount * defaultTables.classCount}, (_, cell) => read.tokenizer[cell] === 1 ? defaultTables.lexerNext[cell]! : random.integer(0, lexerStateCount - 1))
  const grammarNext = Array.from({length: grammarStateCount * defaultTables.symbolCount}, (_, cell) => read.grammar[cell] === 1 ? defaultTables.grammarNext[cell]! : random.integer(0, grammarStateCount - 1))
  const grammarError = Array.from({length: grammarNext.length}, (_, cell) => defaultTables.grammarError[cell] ?? 0)
  const stringEvents = ['stringStart', 'stringContent', 'stringEnd'].map(name => eventNames.indexOf(name as typeof eventNames[number]))
  const display: number[] = []
  for (let event = 0; event < defaultTables.eventCount; event++) {
    for (let state = 0; state < grammarStateCount; state++) {
      const now = defaultTables.display[event * defaultTables.grammarStateCount + Math.min(state, defaultTables.grammarStateCount - 1)]!
      display.push(state >= defaultTables.grammarStateCount && stringEvents.includes(event) ? random.pick([displayKind.key, displayKind.string]) : now)
    }
  }
  return {...defaultTables, grammarStateCount, lexerEvent, lexerNext, grammarNext, grammarError, display}
}

test('the fields about what the loop can give agree with the most that a run can have right, and no hand rule passes that', () => {
  const read = cellsThatValidJsonReads()
  expect(read.tokenizer.reduce((total, flag) => total + flag, 0)).toBe(148)
  expect(read.grammar.reduce((total, flag) => total + flag, 0)).toBe(88)
  // The readers that must stay at or below the bound of limits.ts: the hand rules, tables that use spare rows as a
  // second tokenizer, and tables with every free cell drawn at random, without and with added states.
  const armTables: [name: string, tables: ParserTables][] = [
    ...handRules.map((rule): [string, ParserTables] => [`the hand rule ${rule}`, handRuleTables(rule)]),
    ['the second tokenizer', secondTokenizerTables()], ['random tables', randomTables(1, 0)], ['random tables with 6 added states', randomTables(2, 6)],
  ]
  for (const [name, armTable] of armTables) expect([name, conditionProblems(armTable)]).toEqual([name, []])
  const wholeByArm = armTables.map(() => 0)
  let flagged = 0
  let lost = 0
  for (const sample of samples) {
    if (sample.source === 'valid') continue
    const labels = labelsOf(sample)
    const trace = runTableParser(sample.broken)
    // Up to the first cell that valid JSON never reads, every event is the one of the parser as it is, so the depth,
    // the container and the display kind are too, apart from key against string. A sample that has a scored label there
    // which differs says so in its fields. This is a part of what limits.ts proves, derived here from the trace.
    let differs: 'nesting' | 'display' | undefined
    for (let position = 0; position < trace.length; position++) {
      if (read.tokenizer[trace.lexerStateBefore[position]! * defaultTables.classCount + trace.characterClass[position]!] !== 1) break
      const label = labels[position]
      if (label === undefined) continue
      if (label.depth !== undefined && (label.depth !== trace.depthAfter[position] || label.container !== trace.containerAfter[position])) differs ??= 'nesting'
      const shown = trace.displayKind[position]!
      const isString = shown === displayKind.string || shown === displayKind.key
      if (label.kind !== undefined && (isString ? label.kind !== displayKind.string && label.kind !== displayKind.key : label.kind !== shown)) differs ??= 'display'
    }
    if (differs === 'nesting' && !sample.needsNestingFix) fail(sample, 'a scored depth or container differs from the running totals before any cell that valid JSON never reads, and the sample does not say that it needs a nesting fix')
    if (differs === 'display' && !sample.needsDisplayFix) fail(sample, 'a scored display kind differs from the event\'s kind before any cell that valid JSON never reads, and the sample does not say that it needs a display fix')
    expect(limitsFor(sample, labels)).toMatchObject({needsNestingFix: sample.needsNestingFix, needsDisplayFix: sample.needsDisplayFix})
    // The fields are true exactly when no run of the loop has every counted code point right.
    const most = mostRightFor(sample, labels)
    const counted = scoredCodePoints(sample, labels)
    expect(most.counted).toBe(counted)
    if ((most.right < counted) !== (sample.needsNestingFix || sample.needsDisplayFix)) fail(sample, `the fields say ${sample.needsNestingFix || sample.needsDisplayFix ? 'out of reach' : 'nothing'}, and the most that a run has right is ${most.right} of ${counted}`)
    if (sample.needsNestingFix || sample.needsDisplayFix) flagged++
    lost += counted - most.right
    // Every one of the tables keeps the two conditions, so none has more code points right than the most.
    for (const [index, [name, armTable]] of armTables.entries()) {
      const armTrace = runTableParser(sample.broken, armTable)
      let right = 0
      for (let position = sample.firstErrorPosition; position < labels.length; position++) {
        const label = labels[position]
        if (label === undefined || (label.kind === undefined && label.depth === undefined)) continue
        if ((label.kind === undefined || label.kind === armTrace.displayKind[position]) && (label.depth === undefined || (label.depth === armTrace.depthAfter[position] && label.container === armTrace.containerAfter[position]))) right++
      }
      if (right > most.right) fail(sample, `${name} has ${right} code points right, more than the most that limits.ts allows, ${most.right}`)
      if (counted > 0 && right === counted) wholeByArm[index]!++
    }
    if (groupOf(sample) === 'within reach of the tables' && (sample.reachable !== 'yes' || sample.needsNestingFix || sample.needsDisplayFix || sample.needsClass.length > 0)) fail(sample, 'the group does not fit the flags')
    // A sample whose kinds need both rules of a pair that exclude each other has the flag 'no'.
    if (contradictions.some(([left, right]) => sample.needsRules.includes(left) && sample.needsRules.includes(right)) && sample.reachable !== 'no') fail(sample, 'the sample needs two rules that exclude each other and is not flagged no')
  }
  expect(flagged).toBeGreaterThan(50)
  expect(lost).toBeGreaterThan(1000)
  // The second tokenizer has whole samples right that resync has not, so it is a reader worth holding against the bound.
  const wholeOf = (name: string) => wholeByArm[armTables.findIndex(([arm]) => arm === name)]!
  expect(wholeOf('the second tokenizer')).toBeGreaterThan(wholeOf('the hand rule resync'))
})

test('the tables as they are and the hand rules keep the two conditions under which the limits hold, and tables outside them are noticed', () => {
  expect(conditionProblems(defaultTables)).toEqual([])
  for (const rule of handRules) expect(conditionProblems(handRuleTables(rule))).toEqual([])
  const cellOf = (state: string, characterClass: string) => lexerStateNames.indexOf(state as typeof lexerStateNames[number]) * defaultTables.classCount + classNames.indexOf(characterClass as typeof classNames[number])
  const eventNamed = (name: typeof eventNames[number]) => eventNames.indexOf(name)
  const withCell = (cell: number, event: number, next: string) => {
    const lexerEvent = [...defaultTables.lexerEvent]
    const lexerNext = [...defaultTables.lexerNext]
    lexerEvent[cell] = event
    lexerNext[cell] = lexerStateNames.indexOf(next as typeof lexerStateNames[number])
    return {...defaultTables, lexerEvent, lexerNext}
  }
  // A cell that valid JSON reads is changed: the n between two tokens no longer starts a literal.
  expect(conditionProblems(withCell(cellOf('between', 'n'), eventNamed('stringStart'), 'string')).length).toBe(1)
  // A cell that valid JSON never reads may hold any event with any next state: a closing event on a letter, white
  // space that leaves the tokenizer in another state than between, the event of a string.
  expect(conditionProblems(withCell(cellOf('between', 'other'), eventNamed('closeObject'), 'between'))).toEqual([])
  expect(conditionProblems(withCell(cellOf('tru', 'space'), eventNamed('whitespace'), 'errorLine'))).toEqual([])
  expect(conditionProblems(withCell(cellOf('between', 'other'), eventNamed('stringContent'), 'errorLine'))).toEqual([])
  // A changed display cell, a changed character class and a changed depth change are outside the conditions.
  const display = [...defaultTables.display]
  display[eventNamed('literalStart') * defaultTables.grammarStateCount] = displayKind.key
  expect(conditionProblems({...defaultTables, display}).length).toBe(1)
  const classOfCodePoint = [...defaultTables.classOfCodePoint]
  classOfCodePoint["'".codePointAt(0)! + 1] = classNames.indexOf('quote')
  expect(conditionProblems({...defaultTables, classOfCodePoint}).length).toBe(1)
  const depthChange = [...defaultTables.depthChange]
  depthChange[eventNamed('comma')] = -1
  expect(conditionProblems({...defaultTables, depthChange}).length).toBe(1)
})

test('the hand-written settings of the tables read valid documents exactly as the tables as they are', () => {
  for (const rule of handRules) {
    const tables = handRuleTables(rule)
    for (const sample of samples.slice(0, 1200)) {
      for (const document of sample.documents) {
        const expected = runTableParser(document)
        const actual = runTableParser(document, tables)
        if (!actual.valid || actual.displayKind.join() !== expected.displayKind.join() || actual.depthAfter.join() !== expected.depthAfter.join() || actual.grammarAfter.join() !== expected.grammarAfter.join()) {
          fail(sample, `the hand rule ${rule} reads a valid document in another way`)
        }
      }
    }
    // And they change something: a broken text is read in another way.
    expect(samples.some(sample => sample.source !== 'valid' && runTableParser(sample.broken, tables).displayKind.join() !== runTableParser(sample.broken, defaultTables).displayKind.join())).toBe(true)
  }
  // The hand rule words shows a key and a value without quotes as what they are, and a word in single quotes too.
  const shown = runTableParser("{port: 8080, 'env': production}", handRuleTables('words'))
  expect(Array.from(shown.displayKind.slice(0, shown.length), kind => kindLetters[kind]).join('')).toBe('pkkkkpwnnnnpwkkkkkpwssssssssssp')
  // The hand rule lines has one more tokenizer state than the tables as they are. After a string that a line feed
  // ended, the brace at the very start of the next line does not open, so the second line of a file with one document
  // per line stays at depth 1 when the first line is cut short inside a string, and the third line starts at depth 0.
  // The hand rule words opens a second level there. With a space before the brace, both open it.
  const cutLine = '{"id": "7a919a\n{"id": "7a919a-2", "ok": true}\n{"id": 3}'
  const read = (text: string, rule: typeof handRules[number]) => {
    const trace = runTableParser(text, handRuleTables(rule))
    return [Array.from(trace.displayKind.slice(0, trace.length), kind => kindLetters[kind]).join(''), Array.from(trace.depthAfter.slice(0, trace.length)).join('')]
  }
  expect(handRuleTables('lines').lexerNext.length).toBe((lexerStateNames.length + 1) * defaultTables.classCount)
  expect(read(cutLine, 'lines')).toEqual(['pkkkkpwssssssswpkkkkpwsssssssssspwkkkkpwllllpwpkkkkpwnp', '1111111111111111111111111111111111111111111100111111110'])
  expect(read(cutLine, 'words')).toEqual(['pkkkkpwssssssswpkkkkpwsssssssssspwkkkkpwllllpwpkkkkpwnp', '1111111111111112222222222222222222222222222211222222221'])
  expect(read('{"id": "7a\n {"id": 2}', 'lines')).toEqual(read('{"id": "7a\n {"id": 2}', 'words'))
  // The three earlier settings have the 26 tokenizer states of the tables as they are.
  for (const rule of ['stay', 'resync', 'words'] as const) expect(handRuleTables(rule).lexerNext.length).toBe(lexerStateNames.length * defaultTables.classCount)
})

test('the split is a function of a document\'s tokens, also for each record of a text of several documents, the literals and the ten smallest sequences are in all three splits, and held-out kinds and the held-out template only sit in the test split', () => {
  const kindNames = new Set(kinds.map(kind => kind.name))
  const splitOfSequence = new Map<string, string>()
  const splitsOfLoneScalars = new Set<string>()
  let severalDocuments = 0
  let severalSequences = 0
  for (const sample of samples) {
    // No sequence of tokens is in two splits, so a test document's tokens are in no train document. That holds for
    // every document of a sample alone, so a record of a text of several documents is in the split that the same
    // record has as a document of its own. A document that is one scalar has a sequence of one token, and is split by
    // its text.
    if (sample.documents.length > 1) severalDocuments++
    if (new Set(sample.documents.map(document => tokenSequenceOf(document))).size > 1) severalSequences++
    for (const document of sample.documents) {
      if (splitOf(document) !== sample.split) fail(sample, `the document ${JSON.stringify(document)} is not in the sample's split`)
      const sequence = tokenSequenceOf(document)
      const key = splitKeyOf(document)
      if (sequence.length === 1) {
        if (!key.startsWith(`${sequence} `) || key.slice(2) !== document.trim()) fail(sample, 'a lone scalar is not split by its text')
        if (sample.source !== 'valid' && sample.documents.length === 1) splitsOfLoneScalars.add(sample.split)
      } else if (key !== sequence) fail(sample, 'a document of several tokens is not split by its sequence of tokens')
      const earlier = splitOfSequence.get(key)
      if (earlier !== undefined && earlier !== sample.split) fail(sample, 'the same sequence of tokens sits in two splits')
      splitOfSequence.set(key, sample.split)
    }
    for (const kind of sample.kinds) if (!kindNames.has(kind)) fail(sample, `the kind ${kind} is not in the list of kinds`)
    const isHeldOut = sample.kinds.some(kind => heldOutKinds.includes(kind)) || sample.template === heldOutTemplate
    expect(sample.heldOut.length > 0).toBe(isHeldOut)
    if (isHeldOut && sample.split !== 'test') fail(sample, 'a held-out sample is outside the test split')
  }
  // Every split and every held-out kind occurs, and so do texts of several documents whose records differ in their
  // tokens, so the test above checked something.
  expect(new Set(samples.map(sample => sample.split)).size).toBe(3)
  expect(severalDocuments).toBeGreaterThan(50)
  expect(severalSequences).toBeGreaterThan(15)
  expect(splitOfDocuments(['{"id": 1}\n', '{"id": 2}\n'])).toBe(splitOf('{"id": 7}'))
  expect(splitOfDocuments(['true\n', 'false\n'])).toBe(undefined)
  // Broken texts of a lone scalar, e.g. tru and "abc, are in the train split and in at least one other, and the three
  // literals are in one split each.
  expect(splitsOfLoneScalars.has('train')).toBe(true)
  expect(splitsOfLoneScalars.size).toBeGreaterThan(1)
  expect([splitOf('true'), splitOf(' false\n'), splitOf('null'), splitOf('"abc"'), splitOf('"abc"\n')]).toEqual(['train', 'validation', 'test', splitOf(' "abc"'), splitOf(' "abc"')])
  // The template scalar has ten sequences of more than one token, e.g. [] and {s:{}}. A hash puts all ten into the
  // train split, so they are split by hand: four in train, three in validation and three in test. Each of validation
  // and test has one of the two empty containers, one container that holds an empty one, and one with one entry.
  const smallSequences = new Map<string, string>()
  for (let index = 0; index < 1500; index++) {
    const random = createRandom(defaultSeed, index)
    const document = makeDocumentOf(random, 'scalar', drawLayout(random))
    if (document === undefined) continue
    const sequence = tokenSequenceOf(document.text)
    if (sequence.length === 1) continue
    expect(splitKeyOf(document.text)).toBe(sequence)
    smallSequences.set(sequence, splitOf(document.text))
  }
  const byHand = {train: ['[s]', '[{}]', '{s:[]}', '{s:n}'], validation: ['[]', '[n]', '{s:{}}'], test: ['[[]]', '{s:s}', '{}']}
  for (const split of splits) expect([split, [...smallSequences].filter(([, of]) => of === split).map(([sequence]) => sequence).sort()]).toEqual([split, byHand[split]])
  expect(smallSequences.size).toBe(10)
  // The layout does not matter, and a document of another template with the same tokens is in the same split.
  expect([splitOf('[ ]\n'), splitOf('{\n}'), splitOf('{"list": []}'), splitOf('{\n  "retries": 3\n}'), splitOf('[[\n]]'), splitOf('["x"]')]).toEqual(['validation', 'test', 'train', 'train', 'test', 'train'])
  expect(samples.some(sample => sample.template === heldOutTemplate)).toBe(true)
  for (const kind of heldOutKinds) expect(samples.some(sample => sample.kinds.includes(kind))).toBe(true)
  // A held-out kind sits on the held-out template about as often as on any template that it can be made from, and
  // not in most of its samples.
  const withHeldOutKind = samples.filter(sample => sample.kinds.some(kind => heldOutKinds.includes(kind)))
  expect(withHeldOutKind.filter(sample => sample.template === heldOutTemplate).length).toBeLessThan(withHeldOutKind.length * 0.3)
})

test('every text of a typing replay is what its edits give from the finished document', () => {
  let brokenSteps = 0
  let wrongKeys = 0
  // Replays in which the comma after a new first or middle entry is never typed, and replays in which the comma
  // before a new last entry is typed last or never: the two ways in which a comma is typed apart from its entry.
  let commaNeverAfter = 0
  let commaApartBefore = 0
  // Wrong keys of two forms: a digit right after the start of a number, and a ; before the next key.
  let wholeNumbers = 0
  let semicolonsBeforeAKey = 0
  for (const [seed, count] of [[defaultSeed, 1200], [271828, 600]] as const) {
    for (let index = 0; index < count; index++) {
      const made = typingReplayOf(createRandom(seed, index))
      if (made === undefined || 'otherSplit' in made) continue
      const {replay} = made
      const finished = Array.from(replay.finished)
      const what = `replay ${seed}:${index} (${replay.editor} editor, ${replay.action}: ${replay.target}, its comma ${replay.comma})`
      if (replay.comma === 'never' && !replay.target.startsWith('the last')) commaNeverAfter++
      if (replay.comma !== 'none' && replay.target.startsWith('the last')) commaApartBefore++
      for (const step of replay.steps) {
        // applyEdits throws when the edits overlap or are not in text order.
        let applied
        try {
          applied = applyEdits(finished, step.edits)
        } catch (error) {
          throw new Error(`${what}: the edits of the step ${JSON.stringify(step.key)} cannot be applied: ${(error as Error).message}`)
        }
        if (applied.broken !== step.text) throw new Error(`${what}: the text of the step ${JSON.stringify(step.key)} is not what its edits give\n  text  ${JSON.stringify(step.text)}\n  edits ${JSON.stringify(applied.broken)}`)
        if (step.valid !== parses(step.text)) throw new Error(`${what}: the step ${JSON.stringify(step.key)} says ${step.valid ? 'valid' : 'broken'} against JSON.parse`)
        if (step.valid) continue
        brokenSteps++
        if (step.kinds.length === 0) throw new Error(`${what}: the broken step ${JSON.stringify(step.key)} has no kind`)
        if (step.kinds.includes('typingSlip')) wrongKeys++
        // A wrong key press adds one code point, and every other step only removes.
        const added = applied.alignment.filter(counterpart => counterpart === -1).length
        if (added !== Number(step.kinds.includes('typingSlip'))) throw new Error(`${what}: the step ${JSON.stringify(step.key)} adds ${added} code points`)
        for (const unscored of step.unscoredKinds) {
          if (!applied.alignment.includes(unscored)) throw new Error(`${what}: the step ${JSON.stringify(step.key)} lists the code point ${unscored} as not scored, and its text does not hold it`)
        }
        if (!step.kinds.includes('typingSlip')) continue
        // The kinds of a text with a wrong key are those of the text before it, apart from two forms. A wrong digit
        // that makes a number whole leaves no half-typed number. And a ; for the colon before the next key reads as a
        // colon without a value too, so that key is not scored and no rule about a string after a key is asked for.
        const typed = Array.from(step.text)
        const wrongAt = applied.alignment.indexOf(-1)
        let numberStart = wrongAt
        while (numberStart > 0 && /[-+0-9.eE]/.test(typed[numberStart - 1]!)) numberStart--
        if (step.kinds.includes('partialNumber') && /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(typed.slice(numberStart, wrongAt + 1).join(''))) {
          throw new Error(`${what}: the step ${JSON.stringify(step.key)} has the kind partialNumber, and the number ${typed.slice(numberStart, wrongAt + 1).join('')} is whole`)
        }
        if (/^[0-9]$/.test(typed[wrongAt]!) && /[-.eE+]/.test(typed[wrongAt - 1] ?? '')) wholeNumbers++
        let next = wrongAt + 1
        while (/\s/.test(typed[next] ?? '')) next++
        if (typed[wrongAt] === ';' && typed[next] === '"' && step.kinds.includes('keyWithoutColon')) {
          semicolonsBeforeAKey++
          if (step.needsRules.includes('a string after a key is the next key') || !step.unscoredKinds.includes(applied.alignment[next]!)) throw new Error(`${what}: the step ${JSON.stringify(step.key)} scores the key after the ; as a key, or asks for the rule that a string after a key is the next key`)
        }
      }
      // A replay whose comma is never typed ends with the entry and without that comma.
      if (replay.comma === 'never' && !replay.steps.at(-1)!.kinds.includes('missingComma')) throw new Error(`${what}: the last step is not an entry without its comma`)
    }
  }
  expect(brokenSteps).toBeGreaterThan(10_000)
  expect(wrongKeys).toBeGreaterThan(100)
  expect(commaNeverAfter).toBeGreaterThan(10)
  expect(commaApartBefore).toBeGreaterThan(50)
  expect(wholeNumbers).toBeGreaterThan(0)
  expect(semicolonsBeforeAKey).toBeGreaterThan(0)
})

test('the form texts of raw line feeds and of single quotes give the numbers that the edits give', () => {
  const stated = (form: string, pattern: RegExp) => Number(pattern.exec(form)?.[1] ?? 0)
  // Raw line feeds, carriage returns and tabs in the place of their escapes, counted apart.
  let withCarriageReturns = 0
  const pasted = [...samples, ...Array.from({length: 400}, (_, index) => sampleAt(defaultSeed, index, {kind: 'rawLineFeedInString'}))]
  for (const sample of pasted) {
    const form = sample.forms.find(text => text.startsWith('rawLineFeedInString: ') && text.includes('for the escapes of'))
    if (form === undefined) continue
    const original = Array.from(sample.original)
    const added = {n: 0, r: 0, t: 0}
    for (const edit of sample.edits) {
      const escaped = original[edit.at + 1]
      // In a file with \r\n line ends a raw line feed has a carriage return before it, as every line feed of the file has.
      const raw = escaped === 'n' ? (sample.lineEnd === '\r\n' ? '\r\n' : '\n') : escaped === 'r' ? '\r' : '\t'
      if (edit.remove === 2 && original[edit.at] === '\\' && (escaped === 'n' || escaped === 'r' || escaped === 't') && edit.insert === raw) added[escaped]++
    }
    if (added.r > 0) withCarriageReturns++
    // A combination that asks for every string leaves the tabs to rawTabInString, which has a form text of its own.
    const tabs = sample.forms.some(text => text.startsWith('rawTabInString: ')) ? 0 : added.t
    if (stated(form, /(\d+) raw line feed/) !== added.n || stated(form, /(\d+) raw carriage return/) !== added.r || stated(form, /(\d+) raw tab/) !== tabs) {
      fail(sample, `the form text "${form}" does not give the ${added.n} raw line feeds, ${added.r} raw carriage returns and ${tabs} raw tabs of the edits`)
    }
  }
  expect(withCarriageReturns).toBeGreaterThan(10)
  // Strings in other quotes: a quote that stands for a double quote opens one, and the next such quote closes it.
  // A requoted string that holds an apostrophe holds both kinds of quote, and the form text says how many there are.
  let inBackticks = 0
  let withEscapedApostrophe = 0
  let leavingOutWordKeys = 0
  let wordKeysInDoubleQuotes = 0
  const requotedSamples = [...samples, ...Array.from({length: 400}, (_, index) => sampleAt(defaultSeed, index, {kind: 'singleQuotedString'}))]
  for (const sample of requotedSamples) {
    const form = sample.forms.find(text => text.startsWith('singleQuotedString: '))
    if (form === undefined) continue
    const broken = Array.from(sample.broken)
    const requoted: {quote: string, holdsApostrophe: boolean}[] = []
    let open = -1
    broken.forEach((character, position) => {
      if (sample.replaced[position] !== true || (character !== '\'' && character !== '`')) return
      if (open === -1) return void (open = position)
      requoted.push({quote: character, holdsApostrophe: broken.slice(open + 1, position).includes('\'')})
      open = -1
    })
    const withBoth = requoted.filter(part => part.holdsApostrophe).length
    const found = /(\d+) with both kinds of quote|only the (\d+) strings with both kinds of quote|only the string with both kinds of quote/.exec(form)
    const statedBoth = found === null ? 0 : Number(found[1] ?? found[2] ?? 1)
    if (statedBoth !== withBoth) fail(sample, `the form text "${form}" does not give the ${withBoth} requoted strings that hold both kinds of quote`)
    const backticks = requoted.some(part => part.quote === '`')
    if (backticks) inBackticks++
    if (requoted.some(part => part.quote === '\'' && part.holdsApostrophe)) withEscapedApostrophe++
    // A sample with nothing to recover needs no class. Otherwise a string in backticks needs the backtick as a quote,
    // and the apostrophe as a quote is only needed by a string in single quotes.
    if (scoredCodePoints(sample) === 0) continue
    if (backticks !== sample.needsClass.includes('the backtick as a quote')) fail(sample, 'a string in backticks and the class "the backtick as a quote" do not come together')
    if (sample.needsClass.includes('the apostrophe as a quote') && !requoted.some(part => part.quote === '\'')) fail(sample, 'the class "the apostrophe as a quote" without a string in single quotes')
    // "Every string": a string that still stands in double quotes holds an apostrophe, or is a key that is a word
    // when the form text leaves those out.
    if (!form.startsWith('singleQuotedString: every string') || form.startsWith('singleQuotedString: every string value') || sample.documents.length !== 1) continue
    const leavesOutWordKeys = form.includes('but not the keys that are words')
    if (leavesOutWordKeys) leavingOutWordKeys++
    for (const part of scan(sample.original).strings) {
      const opening = sample.alignment.indexOf(part.start)
      if (opening === -1 || broken[opening] !== '"') continue
      const isWordKeyPart = part.role === 'key' && !part.hasEscape && isWordKey(part.content)
      if (isWordKeyPart && leavesOutWordKeys) {
        wordKeysInDoubleQuotes++
        continue
      }
      if (!part.content.includes('\'')) fail(sample, `the form text "${form}" says every string, and "${part.content}" still stands in double quotes`)
    }
  }
  expect(inBackticks).toBeGreaterThan(0)
  expect(withEscapedApostrophe).toBeGreaterThan(0)
  expect(leavingOutWordKeys).toBeGreaterThan(0)
  expect(wordKeysInDoubleQuotes).toBeGreaterThan(0)
})

test('a string without its opening quote is flagged yes exactly when the closing quote ends what is left, as the README says', () => {
  const seen = new Set<string>()
  for (let index = 0; index < 500; index++) {
    const sample = sampleAt(defaultSeed, index, {kind: 'missingOpeningQuote'})
    // The one edit removes the opening quote, and the content runs from there to the closing quote of the original.
    const original = Array.from(sample.original)
    const start = sample.edits[0]!.at + 1
    let end = start
    while (original[end] !== '"') end += original[end] === '\\' ? 2 : 1
    const content = original.slice(start, end).join('')
    const isKey = sample.forms[0]!.includes('of a key')
    // What ends the string before its closing quote: a comma, a bracket, a quote, a backslash, a tab or a line feed,
    // which are escapes in the original, a space at either end, and in a key any space or a colon.
    const endsEarly = /[,{}[\]\\]/.test(content) || content.startsWith(' ') || content.endsWith(' ') || (isKey && /[ :]/.test(content))
    if ((sample.reachable === 'yes') !== !endsEarly && scoredCodePoints(sample) > 0) fail(sample, `the content ${JSON.stringify(content)} ${endsEarly ? 'ends' : 'does not end'} before its closing quote, and the flag is ${sample.reachable}`)
    seen.add(`${isKey ? 'key' : 'value'}, ${endsEarly ? 'ends early' : content.includes(' ') ? 'several words' : 'one word'}`)
  }
  // A value of several words that the closing quote ends is among them, e.g. "street": 362 Rua das Flores",
  for (const what of ['key, one word', 'value, ends early', 'value, one word', 'value, several words']) expect([...seen]).toContain(what)
})

test('a damaged document with carriage return line ends has them at every line end, in the original and in the broken text', () => {
  let found = 0
  let withOpenString = 0
  for (const sample of samples) {
    if (sample.lineEnd !== (sample.original.includes('\r\n') ? '\r\n' : '\n')) fail(sample, 'the field lineEnd does not say what ends the lines of the original')
    if (sample.source !== 'damage' || sample.lineEnd !== '\r\n' || sample.documents.length !== 1) continue
    found++
    for (const text of [sample.original, sample.broken]) {
      if (/[^\r]\n|^\n|\r(?!\n)/.test(text)) fail(sample, 'a line feed without a carriage return before it, or a carriage return without a line feed after it')
    }
    // A string that is open at its line end meets the carriage return first, which is in one class with the tab.
    if (sample.needsRules.includes('a string that is open at a line feed ends there')) {
      withOpenString++
      if (!sample.needsClass.some(need => need.includes('carriage return'))) fail(sample, 'a string is open at a line end with a carriage return, and the sample does not say that it needs a class')
    }
  }
  expect(found).toBeGreaterThan(20)
  expect(withOpenString).toBeGreaterThan(0)
})

test('the same seed and index give the same sample twice, another index gives another sample, and two seeds are unrelated', () => {
  for (let index = 0; index < 400; index++) {
    expect(sampleAt(defaultSeed, index)).toEqual(samples[index]!)
  }
  expect(sampleAt(defaultSeed, 2999)).toEqual(samples[2999]!)
  expect(new Set(samples.map(sample => sample.broken)).size).toBeGreaterThan(sampleCount * 0.95)
  const otherSeed = new Set(Array.from({length: 600}, (_, index) => sampleAt(defaultSeed + 1, index).original))
  expect(samples.slice(0, 600).filter(sample => sample.original.length > 40 && otherSeed.has(sample.original)).length).toBe(0)
})

test('every kind can be made on request, with its name in the sample, and a split can be asked for', () => {
  for (const kind of kinds) {
    // tuple only comes inside a Python print, so it is not asked for alone.
    if (kind.weight === 0) continue
    const sample = sampleAt(defaultSeed, 7, {kind: kind.name})
    expect(sample.kinds).toContain(kind.name)
    const inTest = sampleAt(defaultSeed, 7, {kind: kind.name, split: 'test'})
    expect(inTest.kinds).toContain(kind.name)
    expect(inTest.split).toBe('test')
  }
  expect(sampleAt(defaultSeed, 11, {kind: 'missingComma', split: 'validation'}).split).toBe('validation')
  expect(sampleAt(defaultSeed, 11, {source: 'typing', split: 'train'}).split).toBe('train')
})
