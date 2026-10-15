// Text around a document that is itself fine: a code fence, a sentence, a statement, a log prefix, quotes, bytes, and
// escaping that was put on the whole text. The document's code points are all kept, and what is around them is added.
import {type Edit, insertAt} from '../edits.ts'
import type {Random} from '../random.ts'
import type {Scan} from '../scan.ts'
import type {Damage, KindDefinition, KindOptions, Reachable} from './types.ts'

// Text before the document and after it. The rank orders several of them, see edits.ts: the byte order mark is
// outermost, then a sentence, a code fence, a log prefix, and innermost a statement, quotes or a color code.
const before = (text: string, rank = -2): Edit => ({...insertAt(0, text), rank})
const after = (scanned: Scan, text: string, rank = 2): Edit => ({...insertAt(scanned.codePoints.length, text), rank})
const pad = (value: number, width = 2) => String(value).padStart(width, '0')

// A markdown code fence, as a language model puts around its JSON.
function codeFence(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const word = random.weighted([['json', 70], ['', 15], ['javascript', 3], ['js', 2], ['jsonc', 2], ['json5', 2], ['JSON', 3], ['json ', 1]])
  const opening = `${random.chance(0.03) ? ' '.repeat(random.integer(1, 3)) : ''}\`\`\`${word}\n`
  const closing = `\n\`\`\`${random.chance(0.4) ? '\n' : ''}`
  const which = options.scope ?? random.weighted([['both', 75], ['opening', 15], ['closing', 10]] as const)
  const edits: Edit[] = []
  if (which !== 'closing') edits.push(before(opening, -4))
  if (which !== 'opening') edits.push(after(scanned, closing, 4))
  return {edits, form: which === 'both' ? 'both fence lines' : `only the ${which} fence line`, reachable: 'yes'}
}

const sentenceOpenings = ['Sure! ', 'Certainly. ', 'Of course! ', 'Okay, ', '', '', ''] as const
const sentenceBodies = [
  'Here is the JSON you asked for', 'Here\'s the updated configuration', 'The extracted data is below', 'I\'ve converted the table to JSON', 'Based on the log, the record is',
  'Output', 'Result', 'JSON', 'Here is the corrected version', 'This is the response from the server',
] as const
const sentencesAfter = [
  'Let me know if you\'d like any changes.', 'I hope this helps!', 'This contains 3 items.', 'Each entry has a name and a price (in EUR).', 'Note that the id field is a placeholder.',
  'The second field was missing, so I left it out.', 'Done in 0.42 s.', 'Tell me if the format should change: I can also write CSV.',
] as const
// Sentences with characters that mean something in JSON.
const hazardsBefore = [
  'The "notes" field was left empty:', 'Use {} for an empty object and [] for an empty list:', 'As in example [1], the result is', 'Run `cat out.json` to see',
  'The 24" monitor is entry 3:', 'Fields marked [optional may be null:',
] as const

// Whether the quotes and brackets of a sentence pair up, so that a parser that reads them as JSON is between tokens
// at depth 0 after the sentence.
function pairsUp(sentence: string) {
  const open: string[] = []
  let inString = false
  for (const character of sentence) {
    if (character === '"') inString = !inString
    else if (inString) continue
    else if (character === '{' || character === '[') open.push(character)
    else if (character === '}' || character === ']') {
      if (open.pop() !== (character === '}' ? '{' : '[')) return false
    }
  }
  return !inString && open.length === 0
}

// A sentence before the document, after it, or both, as a language model or a program's status output writes it.
function proseAround(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const where = options.scope ?? random.weighted([['before', 55], ['after', 15], ['both', 30]] as const)
  const edits: Edit[] = []
  let hazard = false
  let sameLine = false
  let reachable: Reachable = 'yes'
  if (where !== 'after') {
    hazard = random.chance(0.1)
    const opening = random.pick(sentenceOpenings)
    const body = random.pick(sentenceBodies)
    const sentence = hazard ? random.pick(hazardsBefore) : `${opening}${opening.endsWith(', ') && !body.startsWith('I') ? body[0]!.toLowerCase() + body.slice(1) : body}${random.pick([':', ':', '.'])}`
    // Mostly on lines of its own, and sometimes on the document's first line, e.g. Result: {
    sameLine = random.chance(0.15)
    edits.push(before(`${sentence}${sameLine ? ' ' : random.chance(0.6) ? '\n\n' : '\n'}`, -5))
    // Quotes and brackets that pair up leave the parser between tokens at depth 0, as after a document. A quote or a
    // bracket without its partner opens a string or a container that the document doesn't have: on a line of its own
    // it ends with the line, and on the document's first line nothing ends it.
    if (!pairsUp(sentence)) reachable = sameLine ? 'no' : 'line rule'
  }
  if (where !== 'before') edits.push(after(scanned, `${random.chance(0.6) ? '\n\n' : '\n'}${random.pick(sentencesAfter)}`, 5))
  return {
    edits, form: `a sentence ${where === 'both' ? 'before and after' : where}${sameLine ? ', on the document\'s first line' : ''}${hazard ? ', with JSON\'s own characters in it' : ''}`,
    reachable,
  }
}

const callbackNames = ['callback', 'cb', 'handleResponse', 'jsonp_1697270000000', 'jQuery112408_1697270000000', 'angular.callbacks._0', 'onData', '__jp3'] as const
const assignments = ['var data = ', 'const config = ', 'let result = ', 'window.__INITIAL_STATE__ = ', 'module.exports = ', 'export default ', 'data = ', 'const settings = ', 'export const user = '] as const

// The document as an argument or a value in a line of code: JSONP, an assignment, or a guard before a response.
function statementWrapper(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  if (scanned.root.container === null) return undefined
  const form = options.scope ?? random.weighted([['call', 40], ['assignment', 40], ['guard', 20]] as const)
  if (form === 'call') {
    const express = random.chance(0.2)
    const name = random.pick(callbackNames)
    const suffix = random.chance(0.6) ? ');' : ')'
    return {edits: [before(express ? '/**/ typeof cb === \'function\' && cb(' : `${name}(`), after(scanned, suffix)], form: `a call, ${express ? 'as Express writes JSONP' : `${name}(…${suffix}`}`, reachable: 'yes'}
  }
  if (form === 'assignment' || form === 'Python assignment') {
    // A Python assignment has a bare name before it and no semicolon after it.
    const prefix = form === 'Python assignment' ? random.pick(['data = ', 'config = ', 'result = ', 'payload = ', 'resp = ', 'settings = ']) : random.pick(assignments)
    const semicolon = form === 'assignment' && !prefix.startsWith('data') && random.chance(0.7)
    return {edits: [before(prefix), ...(semicolon ? [after(scanned, ';')] : [])], form: `an assignment, ${prefix.trim()}${semicolon ? ' with a semicolon' : ''}`, reachable: 'yes'}
  }
  const guard = random.weighted([[')]}\',\n', 60], [')]}\'\n', 15], ['while(1);', 15], ['for(;;);', 10]])
  return {edits: [before(guard)], form: `a guard before the response, ${guard.trim()}`, reachable: 'yes'}
}

// A prefix as a logging library writes it before a document on the same line. `step` moves the time on, for the lines
// of one log.
export function logPrefixes(random: Random) {
  const hour = random.integer(0, 23)
  const minute = random.integer(0, 49)
  const second = random.integer(0, 59)
  const milliseconds = random.integer(0, 999)
  const logger = random.pick(['checkout', 'app.orders', 'auth', 'worker-3', 'http'])
  const process = random.integer(100, 9999)
  const format = random.integer(0, 10)
  const month = random.integer(1, 12)
  const day = random.integer(1, 28)
  const date = `2026-${pad(month)}-${pad(day)}`
  const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1]!
  let line = 12 + random.integer(0, 400)
  return (step: number): {prefix: string, suffix: string} => {
    const level = random.pick(['DEBUG', 'INFO', 'INFO', 'WARN', 'ERROR'])
    // Python's logging module writes WARNING where others write WARN.
    const pythonLevel = level === 'WARN' ? 'WARNING' : level
    const time = `${pad(hour)}:${pad(minute + step)}:${pad((second + step * 7) % 60)}`
    line += random.integer(1, 9)
    switch (format) {
      case 0: return {prefix: `${date}T${time}.${pad(milliseconds, 3)}Z ${level} ${logger} - `, suffix: ''}
      case 1: return {prefix: `${date} ${time},${pad(milliseconds, 3)} - ${logger} - ${pythonLevel} - `, suffix: ''}
      case 2: return {prefix: `${pythonLevel}:root:`, suffix: ''}
      case 3: return {prefix: `[${date} ${time}] app.${level}: ${random.pick(['order placed', 'request handled', 'cache refreshed'])} `, suffix: ' []'}
      case 4: return {prefix: `${monthName} ${String(day).padStart(2, ' ')} ${time} web-1 app[${process}]: `, suffix: ''}
      case 5: return {prefix: `${date}T${time}.${pad(milliseconds, 3)}345678Z stdout F `, suffix: ''}
      case 6: return {prefix: 'data: ', suffix: ''}
      case 7: return {prefix: `app.log:${line}:`, suffix: ''}
      case 8: return {prefix: random.pick(['DEBUG - Response body: ', 'payload=', 'body: ', 'Received: ']), suffix: ''}
      case 9: return {prefix: `${time} ${level} `, suffix: ''}
      default: return {prefix: `[${level}] ${time} `, suffix: ''}
    }
  }
}

function logPrefix(random: Random, scanned: Scan): Damage | undefined {
  const {prefix, suffix} = logPrefixes(random)(0)
  return {edits: [before(prefix, -3), ...(suffix === '' ? [] : [after(scanned, suffix, 3)])], form: `a log prefix, e.g. ${prefix.trim()}`, reachable: 'yes'}
}

// The document printed as a string of a programming language.
function quotedDocument(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints, text} = scanned
  if (text.includes('\\') || text.includes('\'') || text.includes('\t')) return undefined
  const isAscii = !/[\u0080-￿]/.test(text)
  const quote = random.weighted([['\'', 55], ['b\'', isAscii ? 30 : 0], ['"', scanned.severalLines ? 0 : 15]] as const)
  const edits: Edit[] = [before(quote), after(scanned, quote === '"' ? '"' : '\'')]
  // Python prints a line feed inside a string as \n.
  if (quote !== '"') codePoints.forEach((character, index) => { if (character === '\n') edits.push({at: index, remove: 1, insert: '\\n'}) })
  return {
    edits, form: `${quote}…${quote === '"' ? '"' : '\''} around the document${scanned.severalLines ? ', with \\n for every line feed' : ''}`,
    // A double quote before the document opens a string that ends at the document's first quote.
    reachable: quote === '"' ? 'no' : 'yes',
  }
}

function byteOrderMark(_random: Random, _scanned: Scan): Damage | undefined {
  return {edits: [before('\ufeff', -9)], form: 'U+FEFF before the document', reachable: 'yes'}
}

// Characters after the document's end.
function textAfterEnd(random: Random, scanned: Scan): Damage | undefined {
  const [text, form] = random.weighted<[string, string]>([
    [[';', 'a semicolon'], 30], [[',', 'a comma'], 20], [[`\n${random.pick([':wq', ':w', ':q!', ':x'])}`, 'an editor command typed into the text'], 15],
    [['\u0000'.repeat(random.integer(2, 8)), 'NUL characters of a buffer'], 15], [['\r\n0\r\n\r\n', 'the end marker of a chunked response'], 10], [['\u001a', 'an end-of-file character'], 10],
  ])
  return {edits: [after(scanned, text, 6)], form, reachable: 'yes'}
}

// Terminal color codes around the document or around its tokens.
function ansiColorCodes(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const escape = '\u001b'
  if (random.chance(0.6)) {
    const perLine = scanned.severalLines && random.chance(0.5)
    const edits: Edit[] = [before(`${escape}[32m`), after(scanned, `${escape}[0m`)]
    if (perLine) codePoints.forEach((character, index) => { if (character === '\n' && index + 1 < codePoints.length) edits.push(insertAt(index, `${escape}[0m`), insertAt(index + 1, `${escape}[32m`)) })
    return {edits, form: perLine ? 'a color code around every line' : 'a color code around the document', reachable: 'yes'}
  }
  const edits: Edit[] = []
  const color = (value: {start: number, end: number}, code: string) => edits.push(insertAt(value.start, `${escape}[${code}m`), insertAt(value.end, `${escape}[0m`))
  for (const part of scanned.strings) color(part, part.role === 'key' ? '34;1' : '0;32')
  for (const value of [...scanned.numbers, ...scanned.literals]) color(value, '0;39')
  if (edits.length === 0) return undefined
  return {edits, form: 'a color code around every key and every value', reachable: 'yes'}
}

// The document was stored as a string inside another text and taken out without decoding.
function backslashEscapedDocument(_random: Random, scanned: Scan): Damage | undefined {
  const edits: Edit[] = []
  scanned.codePoints.forEach((character, index) => {
    if (character === '"' || character === '\\') edits.push(insertAt(index, '\\'))
    else if (character === '\n') edits.push({at: index, remove: 1, insert: '\\n'})
  })
  if (edits.length === 0) return undefined
  return {edits, form: `a backslash before every quote and backslash${scanned.severalLines ? ', and \\n for every line feed' : ''}`, reachable: 'yes'}
}

// The document was taken from an HTML page with the page's escaping still on it.
function htmlEntities(random: Random, scanned: Scan): Damage | undefined {
  const quote = random.chance(0.85) ? '&quot;' : '&#34;'
  const apostrophes = random.chance(0.5)
  const entities: Record<string, string> = {'"': quote, '&': '&amp;', '<': '&lt;', '>': '&gt;', ...(apostrophes ? {'\'': '&#39;'} : {})}
  const edits: Edit[] = []
  scanned.codePoints.forEach((character, index) => {
    const entity = entities[character]
    if (entity !== undefined) edits.push({at: index, remove: 1, insert: entity})
  })
  if (edits.length === 0) return undefined
  return {edits, form: `${quote} for every quote`, reachable: 'yes', needsClass: 'the characters of an entity, e.g. & and ;'}
}

export const wrapperKinds: KindDefinition[] = [
  {
    name: 'codeFence', family: 'wrapper', weight: 2.6,
    example: '```json⏎{⏎  "id": 42⏎}⏎```',
    reachable: 'yes: a fence line holds no bracket and no quote and ends at its line feed, and the document starts at depth 0 after it',
    styles: [['indented', 88], ['spaced', 7], ['compact', 5]],
    layout: {finalLineFeed: false},
    margin: 24,
    apply: codeFence,
  },
  {
    name: 'proseAround', family: 'wrapper', weight: 1.3,
    example: 'Here is the JSON you asked for:⏎⏎{"id": 42}',
    reachable: 'yes when the quotes and brackets of the sentence before the document pair up, or it has none. When one has no partner: line rule for a sentence on lines of its own, no for one on the document\'s first line. A sentence only after the document leaves nothing to recover',
    styles: [['indented', 70], ['spaced', 20], ['compact', 10]],
    layout: {finalLineFeed: false},
    margin: 130,
    apply: proseAround,
  },
  {
    name: 'statementWrapper', family: 'wrapper', weight: 2.5,
    example: 'callback({"id": 42, "name": "Ada"});',
    reachable: 'yes: no prefix holds an opening bracket or a double quote, so the document starts at the first opening bracket, at depth 0',
    layout: {finalLineFeed: false},
    margin: 50,
    apply: statementWrapper,
  },
  {
    name: 'logPrefix', family: 'wrapper', weight: 1,
    example: 'INFO:root:{"event": "login", "user": 42}',
    reachable: 'yes: the prefixes hold no double quote, and their square brackets come in closed pairs, e.g. [2231]',
    styles: [['compact', 55], ['spaced', 45]],
    templates: ['logEvent', 'apiResponse', 'chatChunk', 'remoteCall', 'order', 'userRecord', 'sensorReadings', 'databaseRecord', 'table', 'numberGrid', 'scalar'],
    margin: 60,
    apply: logPrefix,
  },
  {
    name: 'quotedDocument', family: 'wrapper', weight: 0.6,
    example: 'b\'{"ok": true, "items": [1, 2]}\'',
    reachable: 'yes for \'…\' and b\'…\'. no for "…", where the first quote opens a string that ends at the document\'s first quote',
    styles: [['spaced', 45], ['compact', 35], ['indented', 20]],
    layout: {finalLineFeed: false, escapes: 'plain'},
    margin: 40,
    apply: quotedDocument,
  },
  {
    name: 'byteOrderMark', family: 'wrapper', weight: 0.3,
    example: '\ufeff{"id": 42}',
    reachable: 'yes: one character that starts no token, at the very start, is skipped',
    margin: 1,
    apply: byteOrderMark,
  },
  {
    name: 'textAfterEnd', family: 'wrapper', weight: 0.6,
    example: '{⏎  "ok": true⏎};',
    reachable: 'yes, and nothing is left to recover: every kept character comes before the damage',
    margin: 10,
    apply: textAfterEnd,
  },
  {
    name: 'ansiColorCodes', family: 'wrapper', weight: 0.2,
    example: '␛[32m{"ok": true}␛[0m',
    reachable: 'yes: after the escape character, the [, the digits and the semicolons up to the letter m are skipped, and that [ opens nothing',
    maximumLength: 150,
    apply: ansiColorCodes,
  },
  {
    name: 'backslashEscapedDocument', family: 'wrapper', weight: 0.6,
    example: '{\\"id\\": 42, \\"name\\": \\"Ada\\"}',
    reachable: 'yes: a backslash where a token may start shows that the text is escaped once, and from then on \\" is a quote',
    styles: [['spaced', 40], ['compact', 35], ['indented', 25]],
    layout: {finalLineFeed: false},
    maximumLength: 300,
    apply: backslashEscapedDocument,
  },
  {
    name: 'htmlEntities', family: 'wrapper', weight: 0.3,
    example: '{&quot;id&quot;: 42, &quot;name&quot;: &quot;Ada&quot;}',
    reachable: 'yes for a parser with states that follow the characters of &quot;, which the highlighter\'s classes cannot tell apart',
    maximumLength: 160,
    apply: htmlEntities,
  },
]
