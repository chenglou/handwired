// More than one document in one text: one per line, one right after the other, with commas between them, or the lines
// of a log. The original is then several documents, each with the white space that follows it, and the labels of each
// are the labels it has alone, so the depth is 0 between two documents.
import {type Json, type Layout, type RecordType, makeRecords, serialize} from '../documents.ts'
import {type Edit, insertAt} from '../edits.ts'
import type {Random} from '../random.ts'
import type {Scan} from '../scan.ts'
import {type Split, splitOf} from '../splits.ts'
import type {Damage, KindDefinition, KindOptions} from './types.ts'
import {logFieldsIn, logPrefixes} from './wrappers.ts'

const oneLine = (style: 'compact' | 'spaced'): Layout => ({style, indent: '  ', shortOnOneLine: false, rowsOnOneLine: false, escapes: 'plain', finalLineFeed: false})
const indented: Layout = {style: 'indented', indent: '  ', shortOnOneLine: false, rowsOnOneLine: false, escapes: 'plain', finalLineFeed: false}
const lengthOf = (text: string) => Array.from(text).length

// Records of one stream as texts, as many as fit in `limit` code points with `overhead` more per record. Every record
// is in the split of the first one, see splitOf: a record alone is a document like any other, and a text that mixed
// records of two splits would put a test document's sequence of tokens into a train text. So the first record decides
// the text's split, and a later record that falls into another split is made again, e.g. with a string where it had
// a null. No texts when the stream has no second record of that split.
function recordTexts(random: Random, count: number, limit: number, overhead: number, layout: Layout, types: readonly (readonly [RecordType, number])[]) {
  const type = random.weighted(types)
  let split: Split | undefined
  const records = makeRecords(random, type, count, record => {
    const own = splitOf(serialize(record, layout))
    split ??= own
    return own === split
  })
  const texts = (records ?? []).map((record: Json) => serialize(record, layout))
  let total = 0
  const fitting: string[] = []
  for (const text of texts) {
    total += lengthOf(text) + overhead
    if (total > limit) break
    fitting.push(text)
  }
  return {type, texts: fitting, style: layout.style}
}
const recordWeights: readonly (readonly [RecordType, number])[] = [['event', 30], ['reading', 25], ['row', 25], ['chunk', 10], ['pair', 6], ['value', 4]]

// One document per line, as a log or an export writes them.
function newlineDelimited(random: Random, _scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const {type, texts, style} = recordTexts(random, random.integer(2, 6), 500, 2, oneLine(random.chance(0.6) ? 'compact' : 'spaced'), recordWeights)
  if (texts.length < 2) return undefined
  const lineEnd = random.chance(0.05) ? '\r\n' : '\n'
  const emptyLineAfter = random.chance(0.06) ? random.integer(0, texts.length - 2) : -1
  const finalLineEnd = options.scope === 'no final line feed' ? false : random.chance(0.7)
  const documents = texts.map((text, index) => `${text}${index < texts.length - 1 || finalLineEnd ? lineEnd : ''}${index === emptyLineAfter ? lineEnd : ''}`)
  return {
    documents, edits: [], template: `records: ${type}`, style,
    form: `${texts.length} lines${lineEnd === '\r\n' ? ' that end with a carriage return and a line feed' : ''}${emptyLineAfter === -1 ? '' : ', with an empty line between two'}`,
    reachable: 'yes', debatable: true,
  }
}

// Documents one after another with nothing or little between them: several writes to one socket, or a document pasted
// below another.
function concatenated(random: Random, _scanned: Scan): Damage | undefined {
  const onLines = random.chance(0.3)
  const layout = onLines ? indented : oneLine(random.chance(0.6) ? 'compact' : 'spaced')
  const {type, texts, style} = recordTexts(random, random.integer(2, 4), 500, 2, layout, onLines ? [['event', 40], ['row', 40], ['reading', 20]] : recordWeights)
  if (texts.length < 2) return undefined
  const joint = onLines ? random.weighted([['\n', 65], ['\n\n', 35]]) : random.weighted([['', 78], [' ', 22]])
  // Two values that are not containers would run together with nothing between them, e.g. 12 and 13 as 1213.
  if (joint === '' && type === 'value') return undefined
  const documents = texts.map((text, index) => `${text}${index < texts.length - 1 ? joint : ''}`)
  const between = joint === '' ? 'nothing' : joint === ' ' ? 'a space' : joint === '\n' ? 'a line feed' : 'an empty line'
  return {documents, edits: [], template: `records: ${type}`, style, form: `${texts.length} ${onLines ? 'indented ' : ''}documents with ${between} between them`, reachable: 'yes', debatable: true}
}

// Records with commas between them and no brackets around them: the inside of an array.
function commaSeparatedRecords(random: Random, _scanned: Scan): Damage | undefined {
  const {type, texts, style} = recordTexts(random, random.integer(2, 5), 500, 3, oneLine(random.chance(0.5) ? 'compact' : 'spaced'), recordWeights.filter(([name]) => name !== 'value'))
  if (texts.length < 2) return undefined
  const space = random.weighted([['\n', 60], [' ', 25], ['', 15]])
  const afterLast = random.chance(0.4)
  const documents: string[] = []
  const edits: Edit[] = []
  let offset = 0
  texts.forEach((text, index) => {
    const isLast = index === texts.length - 1
    const hasComma = !isLast || afterLast
    // The comma is added, and the white space after it belongs to the record before it.
    if (hasComma) edits.push(insertAt(offset + lengthOf(text), ','))
    const document = `${text}${hasComma ? space : ''}`
    documents.push(document)
    offset += lengthOf(document)
  })
  return {
    documents, edits, template: `records: ${type}`, style,
    form: `${texts.length} records with a comma${space === '\n' ? ' and a line feed' : space === ' ' ? ' and a space' : ''} between them${afterLast ? ' and after the last' : ''}`,
    reachable: 'yes', needsRules: ['a comma after the top-level value is skipped'], debatable: true,
  }
}

// Lines of a log that hold no document: messages, which a logger writes after the same prefix as a document, and
// lines that another program wrote into the same output, which have no prefix. None is a line of one language's stack
// trace, which would not stand alone between the lines of a logger of another language.
const messageLines = ['Server listening on port 3000', 'Connected to db.internal:5432', 'Retrying in 5s...', 'worker 3 exited with code 1', 'cache warmed in 412 ms'] as const
const bareLines = ['npm warn deprecated glob@7.2.3', '--- request 4471 ---', '> harbor-api@2.4.0 start', 'Killed', '[nodemon] restarting due to changes...', 'Waiting for the debugger to disconnect...'] as const

// Several lines of a log or of a stream: a prefix and a document on each, and lines of plain text between them.
function logLines(random: Random, _scanned: Scan): Damage | undefined {
  const events = random.chance(0.3)
  const {type, texts, style} = recordTexts(random, random.integer(2, 6), 500, events ? 12 : 48, oneLine(random.chance(0.5) ? 'compact' : 'spaced'), events ? [['chunk', 60], ['row', 20], ['event', 20]] : [['event', 60], ['reading', 20], ['row', 20]])
  if (texts.length < 2) return undefined
  const documents: string[] = []
  const edits: Edit[] = []
  let offset = 0
  let added = 0
  const add = (edit: Edit) => {
    edits.push(edit)
    added += lengthOf(edit.insert)
  }
  if (events) {
    // A stream of server-sent events: each is "data: ", a document and an empty line, and the last may be data: [DONE].
    // Every event of one stream has the same fields before its data.
    const fieldLine = random.weighted([['none', 70], ['event', 15], ['id', 15]] as const)
    texts.forEach((text, index) => {
      add(insertAt(offset, `${fieldLine === 'none' ? '' : fieldLine === 'event' ? 'event: message\n' : `id: ${index + 1}\n`}data: `))
      const document = `${text}\n\n`
      documents.push(document)
      offset += lengthOf(document)
    })
    const done = random.chance(0.5)
    if (done) add(insertAt(offset, 'data: [DONE]\n\n'))
    if (offset + added > 512) return undefined
    return {documents, edits, template: `records: ${type}`, style, form: `${texts.length} server-sent events${done ? ' and data: [DONE]' : ''}`, reachable: 'yes'}
  }
  const {prefixOf, onEveryLine} = logPrefixes(random, 'lines')
  let plain = 0
  texts.forEach((text, index) => {
    const fields = logFieldsIn(text)
    // About one line in four is plain text and holds no document.
    if (random.chance(0.25)) {
      add(insertAt(offset, onEveryLine || random.chance(0.6) ? `${prefixOf(index, fields, random.pick(messageLines)).prefix}\n` : `${random.pick(bareLines)}\n`))
      plain++
    }
    const {prefix, suffix} = prefixOf(index, fields)
    add(insertAt(offset, prefix))
    if (suffix !== '') add(insertAt(offset + lengthOf(text), suffix))
    const document = `${text}${index < texts.length - 1 || random.chance(0.7) ? '\n' : ''}`
    documents.push(document)
    offset += lengthOf(document)
  })
  if (offset + added > 512) return undefined
  return {documents, edits, template: `records: ${type}`, style, form: `${texts.length} log lines with a prefix each${plain > 0 ? `, and ${plain} of plain text` : ''}`, reachable: 'yes'}
}

export const severalKinds: KindDefinition[] = [
  {
    name: 'newlineDelimited', family: 'several documents', origin: 'output', weight: 2.4,
    example: '{"t": 1, "v": 20.5}⏎{"t": 2, "v": 20.7}⏎',
    reachable: 'yes: after a complete top-level value, the start of a value begins a new document at depth 0',
    apply: newlineDelimited,
  },
  {
    name: 'concatenated', family: 'several documents', origin: 'output', weight: 0.7,
    example: '{"id":1}{"id":2}',
    reachable: 'yes, as newlineDelimited',
    apply: concatenated,
  },
  {
    name: 'commaSeparatedRecords', family: 'several documents', origin: 'output', weight: 0.4,
    example: '{"id": 1},⏎{"id": 2},⏎{"id": 3}',
    reachable: 'yes with the rule that a comma after the top-level value is skipped, which contradicts the rule for a closer too many of the top-level container',
    apply: commaSeparatedRecords,
  },
  {
    name: 'logLines', family: 'several documents', origin: 'output', weight: 1,
    example: '09:31:07 INFO {"event": "start"}⏎09:31:08 WARN {"event": "retry", "n": 2}',
    reachable: 'yes: every document ends at depth 0, and the quotes and the brackets of the prefixes and of the plain lines come in closed pairs, [DONE] included',
    apply: logLines,
  },
]
