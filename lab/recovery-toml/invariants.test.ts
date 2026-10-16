// The invariants of the dataset, on a few thousand samples and on texts made by hand.
// Run from the repo root: bun test lab/recovery-toml
import {expect, test} from 'bun:test'
import {damageImportProblems, ownTokenSequence, relabelingProblems, sampleProblems} from './check-samples.ts'
import {type Tracked, damage, editsOf, kinds} from './damage.ts'
import {type Layout, type Section, drawLayout, makeDocumentOf, serialize, templates} from './documents.ts'
import {applyEdits, canonicalEdits} from './edits.ts'
import {displayKind} from './kinds.ts'
import {type Label, labelsOfValidText, tokenSequenceOf} from './labels.ts'
import {cellsThatValidTomlReads, conditionProblems, limitsOf, mostRightOf} from './limits.ts'
import {type Random, createRandom} from './random.ts'
import {type Sample, defaultSeed, groupOf, groups, heldOutTemplates, labelsOf, mostRightFor, sampleAt, scoredCodePoints, splitOf, splits} from './samples.ts'
import {type ParserTables, capacity, defaultTables, maximumDepth, runTableParser} from './table-parser.ts'

const sampleCount = 3000
const samples: Sample[] = Array.from({length: sampleCount}, (_, index) => sampleAt(defaultSeed, index))
// Throws with the sample's id and texts, so a failure can be read.
const fail = (sample: Sample, what: string): never => {
  throw new Error(`${what}\n  sample ${sample.id}, ${sample.forms.join(' | ')}\n  original ${JSON.stringify(sample.original)}\n  broken   ${JSON.stringify(sample.broken)}`)
}

test('every template makes documents that the reference, the tables and Bun accept, with the same labels from the reference and the tables, within the limits', () => {
  for (const template of templates) {
    for (let index = 0; index < 150; index++) {
      const random = createRandom(11, index * 100 + templates.indexOf(template))
      const document = makeDocumentOf(random, template, drawLayout(random))
      if (document === undefined) throw new Error(`the template ${template} made no document`)
      const {text} = document
      const labels = labelsOfValidText(text)
      const trace = runTableParser(text)
      if (!trace.valid) throw new Error(`the tables reject a document of ${template}: ${JSON.stringify(text)}`)
      expect(() => Bun.TOML.parse(text)).not.toThrow()
      expect(labels.length).toBeLessThanOrEqual(capacity)
      labels.forEach((label, position) => {
        if (label.kind !== trace.displayKind[position] || label.depth !== trace.depthAfter[position] || label.container !== trace.containerAfter[position]) {
          throw new Error(`the reference and the tables differ at ${position} of a document of ${template}: ${JSON.stringify(text)}`)
        }
        expect(label.depth).toBeLessThanOrEqual(maximumDepth)
      })
    }
  }
})

test('a layout writes sections as it says: aligned equals signs, indented tables, arrays on several lines, comments, and every form of string', () => {
  const sections: Section[] = [
    {notes: ['a file'], entries: [
      {type: 'pair', key: ['name'], value: {type: 'string', text: 'a "b"', form: 'any'}, note: 'first'},
      {type: 'pair', key: ['retries'], value: {type: 'raw', text: '3'}, off: true},
      {type: 'pair', key: ['a b', 'c'], value: {type: 'string', text: 'C:\\x', form: 'literal'}},
    ]},
    {header: {path: ['server'], array: false}, entries: [
      {type: 'pair', key: ['ports'], value: {type: 'array', items: [{type: 'raw', text: '80'}, {type: 'raw', text: '443'}], form: 'lines', after: {0: 'plain'}}},
      {type: 'pair', key: ['tls'], value: {type: 'inlineTable', entries: [[['on'], {type: 'raw', text: 'true'}]]}},
      {type: 'note', text: '# doubled'},
    ]},
    {header: {path: ['server', 'log'], array: true}, entries: [
      {type: 'pair', key: ['text'], value: {type: 'string', text: 'one\ntwo', form: 'lines'}},
      {type: 'pair', key: ['long'], value: {type: 'string', text: 'one \ntwo', form: 'continued'}},
      {type: 'pair', key: ['é'], value: {type: 'string', text: 'é\t', form: 'basic'}},
    ]},
  ]
  const plain: Layout = {
    ...drawLayout(createRandom(1, 1)), style: 'plain', equals: ' = ', alignEquals: false, indent: '', indentNested: false, blankLines: 1, itemIndent: '  ', wrapWidth: 80, trailingComma: true, padBrackets: false,
    padBraces: true, commaSpace: true, noteGap: '  ', noteSpace: true, apostrophes: false, escapes: 'plain', finalLineFeed: true, leading: '', lineEnd: '\n', headerPadding: false, dotPadding: false, trailingSpaceEvery: 0,
  }
  expect(serialize(sections, plain)).toBe([
    '# a file', 'name = "a \\"b\\""  # first', '# retries = 3', '"a b".c = \'C:\\x\'', '',
    '[server]', 'ports = [', '  80,  # plain', '  443,', ']', 'tls = { on = true }', '## doubled', '',
    '[[server.log]]', 'text = """', 'one', 'two"""', 'long = """', 'one \\', 'two"""', '"é" = "é\\t"', '',
  ].join('\n'))
  const other: Layout = {...plain, alignEquals: true, indent: '  ', indentNested: true, trailingComma: false, padBraces: false, noteSpace: false, apostrophes: true, escapes: 'unicode', finalLineFeed: false, lineEnd: '\r\n', headerPadding: true}
  expect(serialize(sections, other)).toBe([
    '#a file', 'name    = \'a "b"\'  #first', '#retries = 3', '\'a b\'.c = \'C:\\x\'', '',
    '[ server ]', '  ports = [', '    80,  #plain', '    443', '  ]', '  tls   = {on = true}', '  ## doubled', '',
    '  [[ server.log ]]', '    text = """', 'one', 'two"""', '    long = """', 'one \\', 'two"""', '    \'é\'  = "\\u00e9\\t"',
  ].join('\r\n'))
  for (const text of [serialize(sections, plain), serialize(sections, other)]) expect(runTableParser(text).valid).toBe(true)
})

test('the sequence of tokens leaves out white space, comments and what keys, strings and numbers hold, and the split is a function of it', () => {
  expect(tokenSequenceOf('port = 8080 # default')).toBe('k=n')
  expect(tokenSequenceOf('retries=3')).toBe('k=n')
  expect(tokenSequenceOf('[server]\nhost = "a"')).toBe('[h]k=s')
  expect(tokenSequenceOf('[ database ]\n\nurl = \'b\'\n')).toBe('[h]k=s')
  expect(tokenSequenceOf('[[a."b c"]]\nx.y = [1, {z = true}]\nat = 1979-05-27 07:32:00\ns = """\na\\\n  b"""')).toBe('[[h.h]]k.k=[n,{k=n}]k=nnk=s')
  expect(splitOf('port = 8080 # default')).toBe(splitOf('retries=3'))
  for (const sample of samples.slice(0, 600)) {
    if (tokenSequenceOf(sample.original) !== ownTokenSequence(sample.original)) fail(sample, 'the sequence of tokens from the reference labels is not the one from the tables')
  }
})

// A random whose draws are a list: `integer` returns the next number, and `pick` and `weighted` take it as an index.
function scripted(numbers: readonly number[]): Random {
  let used = 0
  const take = () => {
    if (used >= numbers.length) throw new Error('the script of draws is used up')
    return numbers[used++]!
  }
  const never = (): never => { throw new Error('the damage made a draw that the script does not have') }
  return {
    next: never, chance: never, shuffled: never,
    integer(minimum, maximum) {
      const drawn = take()
      if (drawn < minimum || drawn > maximum) throw new Error(`the script has ${drawn} for a draw from ${minimum} to ${maximum}`)
      return drawn
    },
    pick: items => items[take()]!,
    weighted: items => items[take()]![0],
  }
}
const textOfPayload = (payload: readonly Tracked[]) => payload.map(tracked => tracked.character).join('')
const origins = (payload: readonly Tracked[]) => payload.map(tracked => tracked.origin)

test('each of the ten edits does what damage.ts says, and says which code points are kept', () => {
  const original = Array.from('ab\ncd\nxy')
  // The first draw is the number of edits, here always one. The others are the edit's own, in its order.
  const one = (kind: string, draws: number[]) => {
    const damaged = damage(scripted([0, ...draws]), original, kind)
    if (damaged === undefined) throw new Error(`${kind} found no place`)
    expect(damaged.steps.map(step => step.kind)).toEqual([kind])
    return {text: textOfPayload(damaged.payload), origins: origins(damaged.payload)}
  }
  expect(one('deleteCodePoint', [3])).toEqual({text: 'ab\nd\nxy', origins: [0, 1, 2, 4, 5, 6, 7]})
  // A copy of the code point at 0, inserted before the code point at 4.
  expect(one('insertCodePoint', [4, 0])).toEqual({text: 'ab\ncad\nxy', origins: [0, 1, 2, 3, -1, 4, 5, 6, 7]})
  // The b is replaced with the third of the code points that are no b.
  expect(one('replaceCodePoint', [1, 2])).toEqual({text: 'ac\ncd\nxy', origins: [0, -1, 2, 3, 4, 5, 6, 7]})
  // The a moves behind the b, and is the added one.
  expect(one('swapNeighbours', [0])).toEqual({text: 'ba\ncd\nxy', origins: [1, -1, 2, 3, 4, 5, 6, 7]})
  expect(one('deleteRun', [3, 2])).toEqual({text: 'ab\nxy', origins: [0, 1, 5, 6, 7]})
  expect(one('duplicateRun', [2, 3])).toEqual({text: 'ab\ncdcd\nxy', origins: [0, 1, 2, 3, 4, -1, -1, 5, 6, 7]})
  // The run `ab` has no place before it and 6 after it, of which the second is the place before the d.
  expect(one('copyRun', [2, 0, 1])).toEqual({text: 'ab\ncabd\nxy', origins: [0, 1, 2, 3, -1, -1, 4, 5, 6, 7]})
  expect(one('deleteLine', [1])).toEqual({text: 'ab\nxy', origins: [0, 1, 2, 6, 7]})
  expect(one('duplicateLine', [0])).toEqual({text: 'ab\nab\ncd\nxy', origins: [0, 1, 2, -1, -1, -1, 3, 4, 5, 6, 7]})
  // The last line has no line feed, so its copy starts on a line of its own.
  expect(one('duplicateLine', [2])).toEqual({text: 'ab\ncd\nxy\nxy', origins: [0, 1, 2, 3, 4, 5, 6, 7, -1, -1, -1]})
  expect(one('cutTail', [5])).toEqual({text: 'ab\ncd', origins: [0, 1, 2, 3, 4]})
  expect(kinds.map(kind => kind.name)).toEqual(['deleteCodePoint', 'insertCodePoint', 'replaceCodePoint', 'swapNeighbours', 'deleteRun', 'duplicateRun', 'copyRun', 'deleteLine', 'duplicateLine', 'cutTail'])

  // Two edits, one after another: the second one's positions are those of the payload that the first one left.
  // The draws: two edits, the kind with the index 0, its position 3, the kind with the index 8, its line with the index 1.
  const two = damage(scripted([1, 0, 3, 8, 1]), original)
  expect(two?.steps.map(step => step.kind)).toEqual(['deleteCodePoint', 'duplicateLine'])
  expect(textOfPayload(two!.payload)).toBe('ab\nd\nd\nxy')
  expect(origins(two!.payload)).toEqual([0, 1, 2, 4, 5, -1, -1, 6, 7])
  // An edit without a place gives no damage: a payload of equal code points has no two neighbours that differ.
  expect(damage(scripted([0]), Array.from('aaaa'), 'swapNeighbours')).toBeUndefined()
  expect(damage(scripted([0, 0]), Array.from('aaaa'), 'replaceCodePoint')).toBeUndefined()
})

test('the edits of a damaged payload give its text, and of two equal code points the later one is the added one', () => {
  const edited = (originalText: string, payload: Tracked[]) => {
    const original = Array.from(originalText)
    const edits = canonicalEdits(original, editsOf(original, payload))
    return {edits, ...applyEdits(original, edits)}
  }
  const kept = (text: string, from = 0): Tracked[] => Array.from(text, (character, index) => ({character, origin: from + index}))
  const added = (text: string): Tracked[] => Array.from(text, character => ({character, origin: -1}))
  // A second `]` before the `]`: the first one is the kept one.
  expect(edited('a = [1]', [...kept('a = [1'), ...added(']'), ...kept(']', 6)]).alignment).toEqual([0, 1, 2, 3, 4, 5, 6, -1])
  // The b of `ab` replaced with an a: what is removed comes first, and the added a is the later one.
  const replaced = edited('ba', [...added('a'), ...kept('a', 1)])
  expect(replaced.broken).toBe('aa')
  expect(replaced.alignment).toEqual([1, -1])
  expect(replaced.firstDamage).toBe(0)
  // A copy of `ab` before `abab`, after the start of the text: the copy that the reader meets last is the added one.
  expect(edited('x.abab = 1', [...kept('x.'), ...added('ab'), ...kept('abab = 1', 2)]).alignment).toEqual([0, 1, 2, 3, 4, 5, -1, -1, 6, 7, 8, 9])
  // The same copy before the whole text stays where it is, as text that came from elsewhere as a whole.
  expect(edited('abab = 1', [...added('ab'), ...kept('abab = 1')]).alignment).toEqual([-1, -1, 0, 1, 2, 3, 4, 5, 6, 7])
  // One code point before the whole text does move.
  expect(edited('aab = 1', [...added('a'), ...kept('aab = 1')]).alignment).toEqual([0, 1, -1, 2, 3, 4, 5, 6])
  // A cut leaves no kept code point after it, and the first damage is the text's length.
  const cut = edited('a = 1\nb = 2', kept('a = 1\n'))
  expect(cut.edits).toEqual([{at: 6, remove: 5, insert: ''}])
  expect(cut.firstDamage).toBe(6)
  expect(() => editsOf(Array.from('ab'), [{character: 'b', origin: 1}, {character: 'a', origin: 0}])).toThrow()
})

test('a second derivation, with the tables\' labels and its own reading of the rules, agrees on every sample', () => {
  for (const sample of samples) {
    const problems = sampleProblems(sample)
    if (problems.length > 0) fail(sample, problems.join('; '))
  }
})

test('the second derivation reports samples that are spoiled', () => {
  const sample = samples.find(candidate => candidate.editCount === 2 && candidate.unscoredNesting.length > 0 && candidate.firstDamage > 0 && candidate.edits.length > 0)!
  const spoiled: [what: string, change: (copy: Sample) => void][] = [
    ['another broken text', copy => { copy.broken = `${copy.broken} ` }],
    ['a moved edit', copy => { copy.edits = copy.edits.map((edit, index) => index === 0 ? {...edit, at: edit.at - 1} : edit) }],
    ['a kept code point taken for an added one', copy => { copy.alignment = copy.alignment.map((origin, position) => position === 0 ? -1 : origin) }],
    ['a first damage one code point early', copy => { copy.firstDamage -= 1 }],
    ['a first error one code point late', copy => { copy.firstErrorPosition += 1 }],
    ['a depth that is scored against the rule', copy => { copy.unscoredNesting = copy.unscoredNesting.slice(1) }],
    ['a display kind that is not scored without a reason', copy => { copy.unscoredKinds = [...copy.unscoredKinds, copy.alignment.findLast(origin => origin !== -1 && !copy.unscoredKinds.includes(origin))!] }],
    ['a valid original taken for the broken text', copy => { copy.broken = copy.original }],
    ['one edit too many in the count', copy => { copy.editCount += 1 }],
    ['a held-out mark on a template that is not held out', copy => { copy.heldOut = ['template: other'] }],
  ]
  expect(sampleProblems(sample)).toEqual([])
  for (const [what, change] of spoiled) {
    const copy: Sample = structuredClone(sample)
    change(copy)
    if (sampleProblems(copy).length === 0) throw new Error(`the second derivation does not notice ${what}`)
  }
})

test('every sample has a first error at or after its first damage and something to score, and before the first error every scored value is what the parser as it is gives', () => {
  const editCounts = new Map<number, number>()
  for (const sample of samples) {
    const trace = runTableParser(sample.broken)
    expect(trace.valid).toBe(false)
    expect(sample.firstErrorPosition).toBe(trace.firstErrorPosition)
    expect(sample.firstErrorPosition).toBeGreaterThanOrEqual(sample.firstDamage)
    expect(sample.alignment.length).toBeLessThanOrEqual(capacity)
    const labels = labelsOf(sample)
    if (scoredCodePoints(sample, labels) === 0) fail(sample, 'no code point is left to score')
    labels.forEach((label, position) => {
      if (label === undefined || position >= sample.firstErrorPosition) return
      if (label.kind !== undefined && label.kind !== trace.displayKind[position]) fail(sample, `before the first error, the scored display kind at ${position} is not what the parser as it is gives`)
      if (label.depth !== undefined && (label.depth !== trace.depthAfter[position] || label.container !== trace.containerAfter[position])) fail(sample, `before the first error, the scored depth at ${position} is not what the parser as it is gives`)
      if ((label.depth === undefined) !== (label.container === undefined)) fail(sample, 'the depth and the container are not scored together')
    })
    editCounts.set(sample.editCount, (editCounts.get(sample.editCount) ?? 0) + 1)
    expect(groups.indexOf(groupOf(sample))).toBe(sample.editCount - 1)
    expect(sample.discarded.length).toBeLessThan(400)
  }
  // The draws have one edit 6 times in 10. A draw of one edit leaves the text valid more often than a draw of
  // three, so the samples have one edit a little less than half of the time.
  expect(editCounts.get(1)! / sampleCount).toBeGreaterThan(0.4)
  expect(editCounts.get(1)! / sampleCount).toBeLessThan(0.55)
  expect(editCounts.get(3)! / sampleCount).toBeGreaterThan(0.1)
})

test('the damage reads no TOML: damage.ts imports nothing that knows it, and the same draws give the same edits on a payload with other code points', () => {
  expect(damageImportProblems()).toEqual([])
  for (let index = 0; index < 3000; index++) {
    const problems = relabelingProblems(defaultSeed + 1, index, samples[index % 300]!.original)
    if (problems.length > 0) throw new Error(`draw ${index}: ${problems.join('; ')}`)
  }
})

test('no sequence of tokens is in two splits, the held-out templates are only in the test split, and a split can be asked for', () => {
  const splitsOfSequence = new Map<string, Set<string>>()
  for (const sample of samples) {
    const sequence = ownTokenSequence(sample.original)
    const found = splitsOfSequence.get(sequence) ?? new Set<string>()
    splitsOfSequence.set(sequence, found)
    found.add(sample.split)
    expect(sample.split).toBe(splitOf(sample.original))
    const isHeldOut = heldOutTemplates.includes(sample.template)
    expect(sample.heldOut).toEqual(isHeldOut ? [`template: ${sample.template}`] : [])
    if (isHeldOut && sample.split !== 'test') fail(sample, 'a sample of a held-out template is outside the test split')
  }
  for (const [sequence, found] of splitsOfSequence) if (found.size > 1) throw new Error(`the sequence ${sequence} is in ${[...found].join(' and ')}`)
  expect(heldOutTemplates.length).toBe(2)
  for (const split of splits) {
    expect(samples.filter(sample => sample.split === split).length).toBeGreaterThan(sampleCount * (split === 'train' ? 0.6 : 0.05))
    for (let index = 0; index < 60; index++) {
      const sample = sampleAt(defaultSeed, index, {split})
      expect(sample.split).toBe(split)
      if (split !== 'test') expect(sample.heldOut).toEqual([])
    }
  }
})

test('the same seed and index give the same sample twice, another index gives another sample, and two seeds are unrelated', () => {
  for (let index = 0; index < 200; index++) expect(sampleAt(defaultSeed, index)).toEqual(samples[index]!)
  expect(new Set(samples.map(sample => sample.broken)).size).toBeGreaterThan(sampleCount * 0.99)
  const otherSeed = Array.from({length: 300}, (_, index) => sampleAt(defaultSeed + 1, index))
  expect(otherSeed.filter((sample, index) => sample.broken === samples[index]!.broken).length).toBe(0)
})

test('every kind of edit can be asked for as the first edit, and a valid sample can be asked for', () => {
  for (const kind of kinds) {
    for (let index = 0; index < 20; index++) {
      const sample = sampleAt(defaultSeed, index, {kind: kind.name})
      expect(sample.forms[0]!.startsWith(`${kind.name}: `)).toBe(true)
      expect(sampleProblems(sample)).toEqual([])
      // A cut alone leaves nothing to score, so a sample that starts with a cut has more edits.
      if (kind.name === 'cutTail') expect(sample.editCount).toBeGreaterThan(1)
    }
  }
  for (let index = 0; index < 100; index++) {
    const sample = sampleAt(defaultSeed, index, {source: 'valid'})
    expect(sample.broken).toBe(sample.original)
    expect(sampleProblems(sample)).toEqual([])
    expect(scoredCodePoints(sample)).toBe(0)
  }
  expect(() => sampleAt(defaultSeed, 0, {kind: 'missingComma'})).toThrow()
})

test('the bound of limits.ts follows the depth alone: a scored depth two levels from the depth before the first error is out of reach', () => {
  // `a = ]` has its first error at the bracket, at depth 0.
  const broken = Array.from('a = ]x')
  const errorAt = runTableParser(broken.join('')).firstErrorPosition
  expect(errorAt).toBe(4)
  const labelsWithDepths = (depths: (number | undefined)[]): (Label | undefined)[] => broken.map((_, position) => {
    const depth = depths[position]
    return {kind: displayKind.whitespace, depth, container: depth === undefined ? undefined : 0}
  })
  expect(limitsOf(broken, labelsWithDepths([0, 0, 0, 0, 1, 2]), errorAt)).toEqual({needsNestingFix: false, nestingStopsAt: -1, needsDisplayFix: false, displayStopsAt: -1})
  expect(limitsOf(broken, labelsWithDepths([0, 0, 0, 0, 2, 2]), errorAt)).toEqual({needsNestingFix: true, nestingStopsAt: 4, needsDisplayFix: false, displayStopsAt: -1})
  // A depth that is not scored leaves the run free to move, one level per code point.
  expect(limitsOf(broken, labelsWithDepths([0, 0, 0, 0, undefined, 2]), errorAt).needsNestingFix).toBe(false)
  expect(mostRightOf(broken, labelsWithDepths([0, 0, 0, 0, 2, 2]), errorAt)).toEqual({right: 1, counted: 2})
  expect(mostRightOf(broken, labelsWithDepths([0, 0, 0, 0, 1, 2]), errorAt)).toEqual({right: 2, counted: 2})
  for (const sample of samples.slice(0, 1000)) {
    const labels = labelsOf(sample)
    const bound = mostRightFor(sample, labels)
    expect(bound.counted).toBe(scoredCodePoints(sample, labels))
    if ((bound.right < bound.counted) !== sample.needsNestingFix) fail(sample, 'needsNestingFix is not what the bound says')
    // The parser as it is is one run of the loop, so it has at most the bound's code points right in their depth.
    const trace = runTableParser(sample.broken)
    let depthsRight = 0
    let depthsWrong = 0
    for (let position = sample.firstErrorPosition; position < labels.length; position++) {
      const depth = labels[position]?.depth
      if (depth === undefined) continue
      if (depth === trace.depthAfter[position]) depthsRight++
      else depthsWrong++
    }
    expect(depthsWrong).toBeGreaterThanOrEqual(bound.counted - bound.right)
    expect(depthsRight).toBeLessThanOrEqual(bound.right)
  }
})

test('the tables as they are read valid TOML as the tables as they are, and a changed cell that valid TOML reads is noticed', () => {
  const readable = cellsThatValidTomlReads()
  const countOf = (mask: Uint8Array) => mask.reduce((total, bit) => total + bit, 0)
  expect([countOf(readable.tokenizer), countOf(readable.grammar), countOf(readable.display)]).toEqual([2459, 205, 105])
  expect(conditionProblems(defaultTables)).toEqual([])
  const changed = (change: (tables: {-readonly [Key in keyof ParserTables]: ParserTables[Key] extends readonly number[] ? number[] : ParserTables[Key]}) => void): ParserTables => {
    const copy = {
      ...defaultTables, classOfCodePoint: [...defaultTables.classOfCodePoint], lexerNext: [...defaultTables.lexerNext], lexerEvent: [...defaultTables.lexerEvent], grammarToken: [...defaultTables.grammarToken],
      lexerErrorKind: [...defaultTables.lexerErrorKind], actionOfToken: [...defaultTables.actionOfToken], depthClass: [...defaultTables.depthClass], grammarNext: [...defaultTables.grammarNext],
      grammarAction: [...defaultTables.grammarAction], grammarError: [...defaultTables.grammarError], display: [...defaultTables.display],
    }
    change(copy)
    return copy
  }
  const readGrammarCell = readable.grammar.indexOf(1)
  const openGrammarCell = readable.grammar.indexOf(0)
  expect(conditionProblems(changed(tables => { tables.grammarNext[openGrammarCell] = 0 }))).toEqual([])
  expect(conditionProblems(changed(tables => { tables.grammarAction[openGrammarCell] = 4 }))).toEqual([])
  expect(conditionProblems(changed(tables => { tables.lexerEvent[readable.tokenizer.indexOf(0)] = 0 }))).toEqual([])
  expect(conditionProblems(changed(tables => { tables.grammarNext[readGrammarCell] = defaultTables.errorState })).length).toBe(1)
  expect(conditionProblems(changed(tables => { tables.grammarAction[readGrammarCell] = (defaultTables.grammarAction[readGrammarCell]! % 4) + 1 })).length).toBe(1)
  expect(conditionProblems(changed(tables => { tables.lexerNext[readable.tokenizer.indexOf(1)] = (defaultTables.lexerNext[readable.tokenizer.indexOf(1)]! + 1) % 5 })).length).toBe(1)
  expect(conditionProblems(changed(tables => { tables.display[readable.display.indexOf(1)] = displayKind.error })).length).toBe(1)
  expect(conditionProblems(changed(tables => { tables.classOfCodePoint[40] = 2 }))).toEqual(['the character classes are changed'])
  // Every sample's text is read by such cells up to its first error.
  for (const sample of samples.slice(0, 500)) {
    const trace = runTableParser(sample.broken)
    for (let position = 0; position < sample.firstErrorPosition; position++) {
      if (readable.tokenizer[trace.lexerStateBefore[position]! * defaultTables.classCount + trace.characterClass[position]!] !== 1) fail(sample, `before its first error, the text reads a tokenizer cell at ${position} that no valid text reads`)
    }
  }
})
