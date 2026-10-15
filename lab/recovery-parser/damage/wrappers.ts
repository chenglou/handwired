// Text around a document that is itself fine: a code fence, a sentence, a statement, a log prefix, quotes, bytes, and
// escaping that was put on the whole text. The document's code points are all kept, and what is around them is added.
import {type Edit, insertAt} from '../edits.ts'
import type {Random} from '../random.ts'
import type {Scan} from '../scan.ts'
import type {Damage, KindDefinition, KindOptions} from './types.ts'

// Text before the document and after it. The rank orders several of them, see edits.ts: the byte order mark is
// outermost, then a sentence, a code fence, a log prefix, and innermost a statement, quotes or a color code.
const before = (text: string, rank = -2): Edit => ({...insertAt(0, text), rank})
const after = (scanned: Scan, text: string, rank = 2): Edit => ({...insertAt(scanned.codePoints.length, text), rank})
const pad = (value: number, width = 2) => String(value).padStart(width, '0')

// A markdown code fence, as a language model puts around its JSON.
function codeFence(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const word = random.weighted([['json', 70], ['', 15], ['javascript', 3], ['js', 2], ['jsonc', 2], ['json5', 2], ['JSON', 3], ['json ', 1]])
  const opening = `\`\`\`${word}\n`
  const closing = `\n\`\`\`${random.chance(0.4) ? '\n' : ''}`
  const which = options.scope ?? random.weighted([['both', 75], ['opening', 15], ['closing', 10]] as const)
  const edits: Edit[] = []
  if (which !== 'closing') edits.push(before(opening, -4))
  if (which !== 'opening') edits.push(after(scanned, closing, 4))
  return {edits, form: which === 'both' ? 'both fence lines' : `only the ${which} fence line`, reachable: 'yes'}
}

const sentenceOpenings = ['Sure! ', 'Certainly. ', 'Of course! ', 'Okay, ', '', '', ''] as const
// What a language model writes before its JSON, and whether the sentence can end with a period as well as with a colon.
const sentenceBodies: readonly (readonly [string, boolean])[] = [
  ['Here is the JSON you asked for', true], ['Here\'s the updated configuration', true], ['The extracted data is below', true], ['I\'ve converted the table to JSON', true],
  ['Based on the log, the record is', false], ['Here is the corrected version', true], ['This is the response from the server', true],
]
// A label in place of a sentence, as a program or a person writes before a document, e.g. "Result:".
const sentenceLabels = ['Output:', 'Result:', 'JSON:', 'Response:'] as const
// What a language model writes after its JSON. None of them says something about the document that could be false.
const sentencesAfter = [
  'Let me know if you\'d like any changes.', 'I hope this helps!', 'I kept the field names as they were (including the capitalization).', 'Note that the id field is a placeholder.',
  'Values that were missing in the source are left out.', 'Tell me if the format should change: I can also write CSV.',
] as const
// What a program writes after the document it printed.
const statusLinesAfter = (random: Random) => random.pick([`Done in ${random.integer(2, 900)} ms.`, 'Exit code: 0', `(${random.integer(1, 40)} ms)`, 'OK'])
// Sentences with characters that mean something in JSON. In the first four, the quotes and the brackets come in
// pairs. The last three have one without its partner.
const hazardsBefore = [
  'The "notes" field was left empty:', 'Use {} for an empty object and [] for an empty list:', 'As in example [1], the result is', 'Run `cat out.json` to see',
  'The 24" monitor is entry 3:', 'The response starts with { as expected:', 'Rows start with [ in this format:',
] as const

// What a sentence leaves open for a parser that reads its quotes and brackets as JSON: nothing when they pair up, so
// that the parser is between tokens at depth 0 after the sentence, or a string, or a container.
function leftOpenBy(sentence: string): 'nothing' | 'a string' | 'a container' {
  const open: string[] = []
  let inString = false
  for (const character of sentence) {
    if (character === '"') inString = !inString
    else if (inString) continue
    else if (character === '{' || character === '[') open.push(character)
    else if (character === '}' || character === ']') {
      if (open.pop() !== (character === '}' ? '{' : '[')) return 'a container'
    }
  }
  return inString ? 'a string' : open.length > 0 ? 'a container' : 'nothing'
}

// A sentence before the document, after it, or both, as a language model or a program's status output writes it.
function proseAround(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const where = options.scope ?? random.weighted([['before', 55], ['after', 15], ['both', 30]] as const)
  const edits: Edit[] = []
  let hazard = false
  let sameLine = false
  let flags: Pick<Damage, 'reachable' | 'needsRules'> = {reachable: 'yes'}
  // A label such as "Result:" comes from a program as often as from a model, and a sentence only from a model.
  const onlyModel = options.writer === 'model'
  let fromProgram = !onlyModel && where === 'after' && random.chance(0.3)
  if (where !== 'after') {
    hazard = random.chance(0.1)
    const label = !hazard && random.chance(0.2)
    fromProgram = !onlyModel && label && random.chance(0.5)
    const opening = random.pick(sentenceOpenings)
    const [body, canEndWithPeriod] = random.pick(sentenceBodies)
    const sentence = hazard ? random.pick(hazardsBefore)
      : label ? random.pick(sentenceLabels)
      : `${opening}${opening.endsWith(', ') && !body.startsWith('I') ? body[0]!.toLowerCase() + body.slice(1) : body}${canEndWithPeriod && random.chance(0.3) ? '.' : ':'}`
    // Mostly on lines of its own, and sometimes on the document's first line, e.g. Result: {
    // A model's sentence before a code fence is always on lines of its own.
    sameLine = !onlyModel && random.chance(0.15)
    edits.push(before(`${sentence}${sameLine ? ' ' : random.chance(0.6) ? '\n\n' : '\n'}`, -5))
    // Quotes and brackets that pair up leave the parser between tokens at depth 0, as after a document. A quote
    // without its partner opens a string that the document doesn't have: on a line of its own it ends with the line,
    // and on the document's first line nothing ends it. A bracket without its partner opens a container that nothing
    // closes, and no parser can know that the document's first bracket does not belong inside it.
    const leftOpen = leftOpenBy(sentence)
    if (leftOpen === 'a container' || (leftOpen === 'a string' && sameLine)) flags = {reachable: 'no'}
    else if (leftOpen === 'a string') flags = {reachable: 'line rule', needsRules: ['a string that is open at a line feed ends there']}
  }
  if (where !== 'before') edits.push(after(scanned, `${random.chance(0.6) ? '\n\n' : '\n'}${fromProgram ? statusLinesAfter(random) : random.pick(sentencesAfter)}`, 5))
  return {
    edits, form: `a sentence ${where === 'both' ? 'before and after' : where}${sameLine ? ', on the document\'s first line' : ''}${hazard ? ', with JSON\'s own characters in it' : ''}`,
    ...flags,
  }
}

// The names of JSONP callbacks. Libraries make names of a time stamp and a counter, e.g. jQuery's.
const callbackName = (random: Random) => random.pick([
  'callback', 'cb', 'handleResponse', `jsonp_${1_690_000_000_000 + random.integer(0, 99_999_999_999)}`, `jQuery${random.integer(11_000_000, 36_999_999)}_${1_690_000_000_000 + random.integer(0, 99_999_999_999)}`,
  `angular.callbacks._${random.integer(0, 9)}`, 'onData', `__jp${random.integer(0, 9)}`,
])
// The names say nothing about what the document holds, so that they fit every template.
const assignments = ['var data = ', 'const data = ', 'let result = ', 'window.__INITIAL_STATE__ = ', 'module.exports = ', 'export default ', 'data = ', 'const payload = ', 'export const data = ', 'const json = '] as const

// The document as an argument or a value in a line of code: JSONP, an assignment, or a guard before a response.
function statementWrapper(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  if (scanned.root.container === null) return undefined
  const form = options.scope ?? random.weighted([['call', 40], ['assignment', 40], ['guard', 20]] as const)
  if (form === 'call') {
    const express = random.chance(0.2)
    const name = callbackName(random)
    const suffix = random.chance(0.6) ? ');' : ')'
    return {edits: [before(express ? '/**/ typeof cb === \'function\' && cb(' : `${name}(`), after(scanned, suffix)], form: `a call, ${express ? 'as Express writes JSONP' : `${name}(…${suffix}`}`, reachable: 'yes'}
  }
  if (form === 'assignment' || form === 'Python assignment') {
    // A Python assignment has a bare name before it and no semicolon after it.
    const prefix = form === 'Python assignment' ? random.pick(['data = ', 'result = ', 'payload = ', 'resp = ', 'obj = ', 'd = ']) : random.pick(assignments)
    const semicolon = form === 'assignment' && !prefix.startsWith('data') && random.chance(0.7)
    return {edits: [before(prefix), ...(semicolon ? [after(scanned, ';')] : [])], form: `an assignment, ${prefix.trim()}${semicolon ? ' with a semicolon' : ''}`, reachable: 'yes'}
  }
  const guard = random.weighted([[')]}\',\n', 60], [')]}\'\n', 15], ['while(1);', 15], ['for(;;);', 10]])
  return {edits: [before(guard)], form: `a guard before the response, ${guard.trim()}`, reachable: 'yes'}
}

// What a document says about its own moment and level, e.g. "ts": "2026-03-25T13:40:50Z" and "level": "warn", so that
// the prefix of its line can say the same.
type LogFields = {time?: {month: number, day: number, hour: number, minute: number, second: number}, level?: string}
export function logFieldsIn(text: string): LogFields {
  const time = /"ts": ?"2026-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)Z"/.exec(text)
  const level = /"level": ?"(debug|info|warn|error|fatal)"/.exec(text)
  return {
    ...(time === null ? {} : {time: {month: Number(time[1]), day: Number(time[2]), hour: Number(time[3]), minute: Number(time[4]), second: Number(time[5])}}),
    ...(level === null ? {} : {level: level[1]!.toUpperCase()}),
  }
}

type LogTime = NonNullable<LogFields['time']>
// One second earlier on the same day. Midnight stays as it is.
function secondBefore(time: LogTime): LogTime {
  if (time.second > 0) return {...time, second: time.second - 1}
  if (time.minute > 0) return {...time, minute: time.minute - 1, second: 59}
  if (time.hour > 0) return {...time, hour: time.hour - 1, minute: 59, second: 59}
  return time
}

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

// The formats of a log prefix, by number as in logPrefixes below. The kind logPrefix, which training never sees, has
// formats that no line of the kind logLines has, so that what it adds is new text too: Python's two formats, the
// output of grep, and a label before a printed document. `python` is what a Python program writes.
const prefixFormats = {line: [1, 2, 7, 8], python: [1, 2, 2, 8], lines: [0, 3, 4, 5, 9, 10]} as const

// A prefix as a logging library writes it before a document on the same line. The lines of one log share the format,
// the logger and the process. `step` moves the time on from one line to the next, `fields` are the time and the level
// that the line's document states itself, and with a `message` the result is a whole line that holds no document.
export function logPrefixes(random: Random, use: keyof typeof prefixFormats) {
  const start = {month: random.integer(1, 12), day: random.integer(1, 28), hour: random.integer(0, 23), minute: random.integer(0, 49), second: random.integer(0, 59)}
  const logger = random.pick(['checkout', 'app.orders', 'auth', 'worker-3', 'http'])
  const process = random.integer(100, 9999)
  const format: number = random.pick(prefixFormats[use])
  const label = random.pick(['DEBUG - Response body: ', 'payload=', 'body: ', 'Received: '])
  let line = 12 + random.integer(0, 400)
  const prefixOf = (step: number, fields: LogFields = {}, message?: string): {prefix: string, suffix: string} => {
    const moment = fields.time ?? {...start, minute: start.minute + step, second: (start.second + step * 7) % 60}
    // A message comes one second before the document that it is written above, so that the times of the lines rise.
    const {month, day, hour, minute, second} = message === undefined ? moment : secondBefore(moment)
    const level = message === undefined ? fields.level ?? random.pick(['DEBUG', 'INFO', 'INFO', 'WARN', 'ERROR']) : random.pick(['INFO', 'INFO', 'WARN'])
    // Python's logging module writes WARNING and CRITICAL where others write WARN and FATAL.
    const pythonLevel = level === 'WARN' ? 'WARNING' : level === 'FATAL' ? 'CRITICAL' : level
    const date = `2026-${pad(month)}-${pad(day)}`
    const time = `${pad(hour)}:${pad(minute)}:${pad(second)}`
    const milliseconds = pad(random.integer(0, 999), 3)
    line += random.integer(1, 9)
    const prefix = (() => {
      switch (format) {
        case 0: return `${date}T${time}.${milliseconds}Z ${level} ${logger} - `
        case 1: return `${date} ${time},${milliseconds} - ${logger} - ${pythonLevel} - `
        case 2: return `${pythonLevel}:root:`
        // Monolog: a message, then the context as JSON, then the extra data, which is empty.
        case 3: return `[${date} ${time}] app.${level}: `
        case 4: return `${monthNames[month - 1]!} ${String(day).padStart(2, ' ')} ${time} web-1 app[${process}]: `
        case 5: return `${date}T${time}.${milliseconds}${pad(random.integer(0, 999999), 6)}Z stdout F `
        case 7: return `app.log:${line}:`
        // A label that a print statement puts before a document, and not before a message.
        case 8: return message === undefined ? label : ''
        case 9: return `${time} ${level} `
        default: return `[${level}] ${time} `
      }
    })()
    if (message !== undefined) return {prefix: `${prefix}${message}${format === 3 ? ' [] []' : ''}`, suffix: ''}
    return format === 3 ? {prefix: `${prefix}${random.pick(['order placed', 'request handled', 'cache refreshed'])} `, suffix: ' []'} : {prefix, suffix: ''}
  }
  // The system log and a container's log put their prefix on every line, so that no line is bare.
  return {prefixOf, onEveryLine: format === 4 || format === 5}
}

function logPrefix(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const {prefix, suffix} = logPrefixes(random, options.scope === 'Python' ? 'python' : 'line').prefixOf(0, logFieldsIn(scanned.text))
  return {edits: [before(prefix, -3), ...(suffix === '' ? [] : [after(scanned, suffix, 3)])], form: `a log prefix, e.g. ${prefix.trim()}`, reachable: 'yes'}
}

// The document printed as a string of a programming language.
function quotedDocument(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints, text} = scanned
  if (text.includes('\\') || text.includes('\'') || text.includes('\t')) return undefined
  const isAscii = !/[^ -~\n]/.test(text)
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
  // In ␛[34;1m the code ends at the m, and ; and m are both in the class of most letters.
  return {edits, form: 'a color code around every key and every value', reachable: 'yes', needsClass: 'the ; inside a color code'}
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
  // A string between two entities reads as one word, as with single quotes, unless it holds a character that ends a word.
  const needsClass = scanned.strings.some(part => /[\s,:{}[\]"\\]/.test(part.content))
  return {edits, form: `${quote} for every quote`, reachable: 'yes', ...(needsClass ? {needsClass: 'the characters of an entity, e.g. & and ;'} : {})}
}

export const wrapperKinds: KindDefinition[] = [
  {
    name: 'codeFence', family: 'wrapper', origin: 'output', weight: 2.6,
    example: '```json⏎{⏎  "id": 42⏎}⏎```',
    reachable: 'yes: a fence line holds no bracket and no quote and ends at its line feed, and the document starts at depth 0 after it',
    styles: [['indented', 88], ['spaced', 7], ['compact', 5]],
    layout: {finalLineFeed: false, leading: ''},
    margin: 24,
    apply: codeFence,
  },
  {
    name: 'proseAround', family: 'wrapper', origin: 'output', weight: 1.3,
    example: 'Here is the JSON you asked for:⏎⏎{"id": 42}',
    reachable: 'yes when the quotes and brackets of the sentence before the document pair up, or it has none. A quote without its partner: line rule for a sentence on lines of its own, no for one on the document\'s first line. A bracket without its partner: no. A sentence only after the document leaves nothing to recover',
    styles: [['indented', 70], ['spaced', 20], ['compact', 10]],
    layout: {finalLineFeed: false, leading: ''},
    margin: 130,
    apply: proseAround,
  },
  {
    name: 'statementWrapper', family: 'wrapper', origin: 'output', weight: 2.5,
    example: 'callback({"id": 42, "name": "Ada"});',
    reachable: 'yes: no prefix holds an opening bracket or a double quote, so the document starts at the first opening bracket, at depth 0. The closing brackets of the guard )]}\', come before the document, where they can only be skipped, which the highlighter\'s loop does only as long as it reads them as part of an error',
    layout: {finalLineFeed: false, leading: ''},
    margin: 50,
    apply: statementWrapper,
  },
  {
    name: 'logPrefix', family: 'wrapper', origin: 'output', weight: 1,
    example: 'INFO:root:{"event": "login", "user": 42}',
    reachable: 'yes: the prefixes hold no double quote and no bracket',
    styles: [['compact', 55], ['spaced', 45]],
    templates: ['logEvent', 'apiResponse', 'chatChunk', 'remoteCall', 'order', 'userRecord', 'sensorReadings', 'databaseRecord', 'table', 'numberGrid', 'scalar'],
    margin: 60,
    apply: logPrefix,
  },
  {
    name: 'quotedDocument', family: 'wrapper', origin: 'output', weight: 0.6,
    example: 'b\'{"ok": true, "items": [1, 2]}\'',
    reachable: 'yes for \'…\' and b\'…\'. no for "…", where the first quote opens a string that ends at the document\'s first quote',
    styles: [['spaced', 45], ['compact', 35], ['indented', 20]],
    layout: {finalLineFeed: false, escapes: 'plain', leading: ''},
    margin: 40,
    apply: quotedDocument,
  },
  {
    name: 'byteOrderMark', family: 'wrapper', origin: 'either', weight: 0.3,
    example: '\ufeff{"id": 42}',
    reachable: 'yes: one character that starts no token, at the very start, is skipped',
    margin: 1,
    apply: byteOrderMark,
  },
  {
    name: 'textAfterEnd', family: 'wrapper', origin: 'either', weight: 0.6,
    example: '{⏎  "ok": true⏎};',
    reachable: 'yes, and nothing is left to recover: every kept character comes before the damage',
    margin: 10,
    apply: textAfterEnd,
  },
  {
    name: 'ansiColorCodes', family: 'wrapper', origin: 'output', weight: 0.2,
    example: '␛[32m{"ok": true}␛[0m',
    reachable: 'yes: after the escape character, the [, the digits and the semicolons up to the letter m are skipped, and that [ opens nothing. With a semicolon in the code, the tables need a class to find the m',
    maximumLength: 150,
    apply: ansiColorCodes,
  },
  {
    name: 'backslashEscapedDocument', family: 'wrapper', origin: 'output', weight: 0.6,
    example: '{\\"id\\": 42, \\"name\\": \\"Ada\\"}',
    reachable: 'yes: a backslash where a token may start shows that the text is escaped once, and from then on \\" is a quote',
    styles: [['spaced', 40], ['compact', 35], ['indented', 25]],
    layout: {finalLineFeed: false, leading: ''},
    maximumLength: 300,
    apply: backslashEscapedDocument,
  },
  {
    name: 'htmlEntities', family: 'wrapper', origin: 'output', weight: 0.3,
    example: '{&quot;id&quot;: 42, &quot;name&quot;: &quot;Ada&quot;}',
    reachable: 'yes for a parser with states that follow the characters of &quot;. The tables read a string between two entities as one word, and need more when it holds a character that ends a word',
    maximumLength: 160,
    apply: htmlEntities,
  },
]
