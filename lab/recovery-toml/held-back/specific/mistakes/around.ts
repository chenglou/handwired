// Text that is no part of the document, and text that is missing: a part cut out of the middle, the marker lines of a
// merge conflict, a sentence or a code fence around the document, and a character that cannot be seen.
import {type Edit, insertAt, removeRange, replaceOneForOne} from '../../../edits.ts'
import {displayKind} from '../../../kinds.ts'
import type {Random} from '../../../random.ts'
import {type Entry, type Scan, lineAt, lineEntries, onOneLine} from '../scan.ts'
import type {KindDefinition, Mistake, Reachable} from './types.ts'

// The runs of entries that stand on consecutive lines, one line each, e.g. the lines below a header up to the first
// empty line or comment.
function entryRuns(scanned: Scan): Entry[][] {
  const runs: Entry[][] = []
  let run: Entry[] = []
  for (const entry of lineEntries(scanned)) {
    const line = lineAt(scanned, entry.key.start)
    const previous = run.at(-1)
    const follows = previous !== undefined && lineAt(scanned, previous.key.start).next === line.start && previous.section === entry.section
    // The line has a line end, so that a line can be added after it.
    const fits = onOneLine(scanned, entry) && line.next > line.end
    if (fits && follows) run.push(entry)
    else {
      if (run.length > 0) runs.push(run)
      run = fits ? [entry] : []
    }
  }
  if (run.length > 0) runs.push(run)
  return runs
}

// A part of the text is missing in the middle: lines that an example leaves out, with a mark in their place, or a span
// that a paste or a length limit dropped.
function cutInTheMiddle(random: Random, scanned: Scan): Mistake | undefined {
  const {codePoints} = scanned
  const length = codePoints.length
  const form = random.weighted([['lines left out, with a mark on a line of its own', 30], ['a span is missing', 45], ['a span is missing, with a mark in its place', 25]] as const)
  if (form === 'lines left out, with a mark on a line of its own') {
    // The lines of one to three entries, with something after them that is left to score.
    const runs = entryRuns(scanned)
    if (runs.length === 0) return undefined
    const run = random.pick(runs)
    const count = random.integer(1, Math.min(3, run.length))
    const first = random.integer(0, run.length - count)
    const from = lineAt(scanned, run[first]!.key.start).start
    const to = lineAt(scanned, run[first + count - 1]!.key.start).next
    if (to >= length) return undefined
    const mark = random.pick(['...', '...', '…', '<snip>', '[...]', `... (${count} more)`])
    return {edits: [insertAt(from, `${mark}${scanned.lineEnd}`), removeRange(from, to)], form: `${form}: ${mark} for ${count} ${count === 1 ? 'line' : 'lines'}`, reachable: 'yes'}
  }
  if (length < 60) return undefined
  const span = random.integer(3, 40)
  const from = random.integer(4, length - span - 12)
  const edits: Edit[] = [removeRange(from, from + span)]
  if (form === 'a span is missing, with a mark in its place') edits.unshift(insertAt(from, random.pick(['...', '…', ' [...] ', '<snip>', '...(truncated)...'])))
  // What is left of the lines around the cut can read as anything: the removed span may hold quotes and brackets.
  return {edits, form: `${form}: ${span} code points${codePoints.slice(from, from + span).includes('\n') ? ', across a line end' : ', inside one line'}`, reachable: 'no'}
}

// Another version of a line with a key and a value, as a second branch has it: a digit of the value changed, true
// for false, or another last word in a string.
function otherVersionOf(random: Random, line: string): string {
  const equals = line.indexOf('=')
  const key = line.slice(0, equals + 1)
  const value = line.slice(equals + 1)
  const digits = [...value.matchAll(/[0-9]/g)]
  if (digits.length > 0 && random.chance(0.75)) {
    const match = digits[random.integer(Math.max(0, digits.length - 2), digits.length - 1)]!
    const other = String((Number(match[0]) + random.integer(1, 8)) % 10 || 1)
    return key + value.slice(0, match.index) + other + value.slice(match.index + 1)
  }
  if (/\b(true|false)\b/.test(value)) return key + value.replace(/\b(true|false)\b/, word => word === 'true' ? 'false' : 'true')
  const text = /^(\s*)(["'])([^"'\\]+)\2(\s*)$/.exec(value)
  if (text === null) return line
  const content = text[3]!
  const lastSpace = content.lastIndexOf(' ')
  const changed = lastSpace === -1
    ? `${content}${random.pick(['-v2', '-next', '2', '-old', '.bak'])}`
    : `${content.slice(0, lastSpace + 1)}${random.pick(['gate', 'side', 'first', 'again', 'twice', 'later'].filter(word => word !== content.slice(lastSpace + 1)))}`
  return `${key}${text[1]!}${text[2]!}${changed}${text[2]!}${text[4]!}`
}

// The names of the two sides as git writes them together.
const sideNames: readonly (readonly [ours: string, theirs: string])[] = [
  ['HEAD', 'main'], ['HEAD', 'origin/main'], ['HEAD', 'release/0.5'], ['HEAD', 'feature/config'], ['HEAD', 'develop'], ['HEAD', '3f2a1bc (Bump versions)'], ['Updated upstream', 'Stashed changes'],
]

// The marker lines of a merge conflict around two versions of one to three lines. The document is the text resolved
// with one of the two sides, and the lines of the other side are added with the markers.
function conflictMarkers(random: Random, scanned: Scan): Mistake | undefined {
  const {codePoints, lineEnd} = scanned
  const runs = entryRuns(scanned)
  if (runs.length === 0) return undefined
  const [ours, theirs] = random.pick(sideNames)
  const run = random.pick(runs)
  if (random.chance(0.2)) {
    // A conflict that was resolved by hand, with one marker line left behind.
    const line = lineAt(scanned, random.pick(run).key.start)
    const marker = random.weighted([[`>>>>>>> ${theirs}`, 5], ['=======', 3], [`<<<<<<< ${ours}`, 2]])
    return {edits: [insertAt(random.chance(0.6) ? line.next : line.start, `${marker}${lineEnd}`)], form: `one marker line left over, ${marker.slice(0, 7)}`, reachable: 'yes'}
  }
  const count = random.integer(1, Math.min(3, run.length))
  const first = random.integer(0, run.length - count)
  const from = lineAt(scanned, run[first]!.key.start).start
  const to = lineAt(scanned, run[first + count - 1]!.key.start).next
  const lines = codePoints.slice(from, to).join('').split(lineEnd).slice(0, -1)
  const otherLines = lines.map(line => otherVersionOf(random, line))
  if (otherLines.every((line, index) => line === lines[index])) return undefined
  const other = otherLines.map(line => `${line}${lineEnd}`).join('')
  const keptSide = random.chance(0.5) ? 'ours' : 'theirs'
  const edits = keptSide === 'ours'
    ? [insertAt(from, `<<<<<<< ${ours}${lineEnd}`), insertAt(to, `=======${lineEnd}${other}>>>>>>> ${theirs}${lineEnd}`)]
    : [insertAt(from, `<<<<<<< ${ours}${lineEnd}${other}=======${lineEnd}`), insertAt(to, `>>>>>>> ${theirs}${lineEnd}`)]
  // The other side is as sensible an original, so another repair would label other lines.
  return {edits, form: `one conflict over ${count} ${count === 1 ? 'line' : 'lines'}, the document is the side of ${keptSide}`, reachable: 'yes', debatable: true}
}

const sentenceOpenings = ['Sure! ', 'Certainly. ', 'Of course! ', 'Okay, ', '', '', ''] as const
// What a language model or a person writes before a config file, and whether the sentence can end with a period.
const sentenceBodies: readonly (readonly [string, boolean])[] = [
  ['Here is the TOML you asked for', true], ['Here\'s the updated configuration', true], ['The config file now looks like this', true], ['I\'ve converted the settings to TOML', true],
  ['Save this as config.toml', true], ['Here is the corrected version', true], ['This is the file that the tool reads', true],
]
const sentenceLabels = ['Output:', 'Result:', 'TOML:', 'Config:', 'config.toml:'] as const
const sentencesAfter = [
  'Let me know if you\'d like any changes.', 'I hope this helps!', 'I kept the key names as they were.', 'Note that the paths are placeholders.', 'Restart the service after you change the file.',
] as const
// Sentences with characters that mean something in TOML: quotes and brackets in pairs in the first three, and one
// without its partner in the last two.
const hazardsBefore = ['The "name" key is required:', 'Tables start with a [header] line:', 'Set debug = true while you test:', 'Strings need a " on both sides:', 'Arrays start with [ as in JSON:'] as const

// Whether a sentence has a quote without a partner, which a tokenizer reads as the start of a string that runs to the
// end of the line.
const leavesAStringOpen = (sentence: string) => sentence.split('"').length % 2 === 0

// A sentence before the document, or one before and one after, as a language model writes around its answer.
function proseAround(random: Random, scanned: Scan): Mistake | undefined {
  const {lineEnd} = scanned
  const where = random.weighted([['before', 65], ['before and after', 35]] as const)
  const hazard = random.chance(0.12)
  const label = !hazard && random.chance(0.2)
  const opening = random.pick(sentenceOpenings)
  const [body, canEndWithPeriod] = random.pick(sentenceBodies)
  const sentence = hazard ? random.pick(hazardsBefore)
    : label ? random.pick(sentenceLabels)
    : `${opening}${opening.endsWith(', ') && !body.startsWith('I') ? body[0]!.toLowerCase() + body.slice(1) : body}${canEndWithPeriod && random.chance(0.3) ? '.' : ':'}`
  const edits: Edit[] = [{...insertAt(0, `${sentence}${lineEnd}${random.chance(0.6) ? lineEnd : ''}`), rank: -5}]
  if (where === 'before and after') {
    const endsWithLineEnd = scanned.text.endsWith('\n')
    edits.push({...insertAt(scanned.codePoints.length, `${endsWithLineEnd ? '' : lineEnd}${lineEnd}${random.pick(sentencesAfter)}`), rank: 5})
  }
  // The sentence's second word is an error, and a parser can skip the rest of the line, brackets included. A quote
  // without its partner opens a string, which ends with the line.
  const reachable: Reachable = leavesAStringOpen(sentence) ? 'line rule' : 'yes'
  return {edits, form: `a sentence ${where}${hazard ? ', with TOML\'s own characters in it' : label ? ', one word with a colon' : ''}`, reachable}
}

// The lines of a markdown code fence around the document, as a language model's answer or a README has them.
function codeFence(random: Random, scanned: Scan): Mistake | undefined {
  const {lineEnd} = scanned
  const word = random.weighted([['toml', 75], ['', 12], ['ini', 5], ['TOML', 3], ['yaml', 3], ['conf', 2]])
  const both = random.chance(0.8)
  const edits: Edit[] = [{...insertAt(0, `\`\`\`${word}${lineEnd}`), rank: -4}]
  if (both) edits.push({...insertAt(scanned.codePoints.length, `${scanned.text.endsWith('\n') ? '' : lineEnd}\`\`\`${random.chance(0.5) ? lineEnd : ''}`), rank: 4})
  return {edits, form: both ? 'both fence lines' : 'only the opening fence line', reachable: 'yes'}
}

// A character that an editor does not show: a byte order mark at the start of the file, a no-break space in the place
// of a space, or a zero width space, as text copied from a web page has them.
function invisibleCharacter(random: Random, scanned: Scan): Mistake | undefined {
  const {codePoints, labels} = scanned
  // Spaces between tokens: after an equals sign, and in the indentation of a line.
  const afterEquals = scanned.entries.filter(entry => codePoints[entry.equals + 1] === ' ').map(entry => entry.equals + 1)
  const indentation: number[] = []
  for (const line of scanned.lines) {
    for (let index = line.start; index < line.end && codePoints[index] === ' ' && labels[index]!.kind === displayKind.whitespace; index++) indentation.push(index)
  }
  const form = random.weighted([
    ['a byte order mark at the start', 40], ['a no-break space after an equals sign', afterEquals.length > 0 ? 25 : 0], ['a no-break space for every space of the indentation', indentation.length > 0 ? 15 : 0],
    ['a zero width space', 20],
  ] as const)
  if (form === 'a byte order mark at the start') return {edits: [{...insertAt(0, '\ufeff'), rank: -6}], form, reachable: 'yes', needsClass: 'the byte order mark'}
  if (form === 'a no-break space after an equals sign') return {edits: [replaceOneForOne(random.pick(afterEquals), '\u00a0')], form, reachable: 'yes', needsClass: 'U+00A0 as white space'}
  if (form === 'a no-break space for every space of the indentation') return {edits: indentation.map(index => replaceOneForOne(index, '\u00a0')), form, reachable: 'yes', needsClass: 'U+00A0 as white space'}
  const entries = lineEntries(scanned)
  if (entries.length === 0) return undefined
  const entry = random.pick(entries)
  const beforeKey = random.chance(0.5)
  return {edits: [insertAt(beforeKey ? entry.key.start : entry.value.end, '\u200b')], form: `${form} ${beforeKey ? 'before a key' : 'after a value'}`, reachable: 'yes', needsClass: 'U+200B as nothing'}
}

export const aroundKinds: KindDefinition[] = [
  {
    name: 'cutInTheMiddle', family: 'around the text', weight: 2,
    description: 'A part of the text is missing in the middle: a span that a paste or a length limit dropped, with or without a mark such as ... in its place, or whole lines that an example leaves out.',
    meant: 'name = "tiny-glob"\nversion = "0.4.1"\nedition = "2021"\nlicense = "MIT"\n', example: 'name = "tiny-gedition = "2021"\nlicense = "MIT"\n',
    alignment: 'The span is removed. A mark in its place is added and has no label.',
    reachable: 'No for a span: what is left of the lines around the cut can read as anything, e.g. as a key inside an open string, and the labels are those of the document. Yes when whole lines are left out with a mark on a line of its own: the mark has no label and ends with its line.',
    margin: 20,
    pairs: false,
    apply: cutInTheMiddle,
  },
  {
    name: 'conflictMarkers', family: 'around the text', weight: 2,
    description: 'The marker lines of a merge conflict with the lines of the other side, or one marker line that was left behind.',
    meant: 'name = "tiny"\nversion = "0.4.1"\nedition = "2021"\n', example: 'name = "tiny"\n<<<<<<< HEAD\nversion = "0.4.1"\n=======\nversion = "0.5.1"\n>>>>>>> main\nedition = "2021"\n',
    alignment: 'The marker lines and the lines of the other side are added and have no label. The document is the text resolved with one side.',
    reachable: 'Yes: a marker line starts with `<`, `=` or `>`, which is an error at the start of a line, and ends with its line. The lines of the other side read as more entries: the tables keep no names, so a key that stands twice is no error for them.',
    margin: 200,
    apply: conflictMarkers,
  },
  {
    name: 'proseAround', family: 'around the text', weight: 2,
    description: 'A sentence before the document, or one before and one after, as a language model writes around its answer.',
    meant: 'name = "tiny"\n', example: 'Here is the TOML you asked for:\n\nname = "tiny"\n',
    alignment: 'The sentences are added and have no label. Every code point of the document is kept.',
    reachable: 'Yes: the sentence\'s second word is an error for the parser as it is, and the rest of the line can be skipped, brackets included. With a quote that has no partner in the sentence, the tokenizer is inside a string, and the line rule ends it.',
    margin: 130,
    apply: proseAround,
  },
  {
    name: 'codeFence', family: 'around the text', weight: 2,
    description: 'The lines of a markdown code fence around the document, or only the opening one.',
    meant: 'name = "tiny"\n', example: '```toml\nname = "tiny"\n```\n',
    alignment: 'The fence lines are added and have no label. Every code point of the document is kept.',
    reachable: 'Yes: the backtick is in the class `other`, where the tokenizer as it is gives up on the rest of the line, and the fence lines have no label.',
    margin: 16,
    apply: codeFence,
  },
  {
    name: 'invisibleCharacter', family: 'around the text', weight: 1,
    description: 'A character that an editor does not show: a byte order mark at the start, a no-break space in the place of a space, a zero width space.',
    meant: 'port = 8080\n', example: '\ufeffport = 8080\n',
    alignment: 'A no-break space stands for the space and has its label, white space. The byte order mark and the zero width space are added and have no label.',
    reachable: 'Yes with a character class for the character. The three are in the class `other`, where the tokenizer as it is gives up on the rest of the line, and that rest is a header, an entry or a value with labels of its own.',
    margin: 1,
    apply: invisibleCharacter,
  },
]
