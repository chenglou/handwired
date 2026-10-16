// Text around or between the lines of a document that is itself fine: a code fence, a sentence, the fences of front
// matter, the lines of a program around a document in a string, marker lines of a merge conflict, a mark or a number
// before every line, characters that do not show, color codes of a terminal, other line ends, a line that is no TOML,
// and a marker for what was left out.
import {type Edit, insertAt, replaceOneForOne} from '../edits.ts'
import type {Random} from '../random.ts'
import {chooseForm} from './assignment.ts'
import {type Entry, type Line, type Scan, firstOnLine, indentationAt, lastOnLine, lineAt, onOneLine} from './scan.ts'
import {type Damage, type KindDefinition, rankAfterDocument, rankAtLineStart, rankBeforeDocument} from './types.ts'

const before = (text: string, rank = rankBeforeDocument): Edit => ({...insertAt(0, text), rank})
// Text after the document, on a line of its own: a line end comes first when the document's last line has none.
function after(scanned: Scan, text: string, rank = rankAfterDocument): Edit {
  const {codePoints, lineEnd} = scanned
  return {...insertAt(codePoints.length, `${codePoints.at(-1) === '\n' ? '' : lineEnd}${text}`), rank}
}

function codeFence(random: Random, scanned: Scan): Damage | undefined {
  const {lineEnd} = scanned
  const fence = random.chance(0.9) ? '```' : '~~~'
  const info = random.weighted([['toml', 62], ['', 12], ['TOML', 5], ['ini', 5], ['conf', 3], ['text', 3], ['toml title="config.toml"', 5], ['toml filename=Cargo.toml', 5]] as const)
  const opening = before(`${fence}${info}${lineEnd}`)
  if (random.chance(0.2)) return {edits: [opening], form: 'an opening fence alone', wholeText: true}
  return {edits: [opening, after(scanned, `${fence}${random.chance(0.6) ? lineEnd : ''}`)], form: 'a fence before and after the document', wholeText: true}
}

const sentencesBefore = [
  'Here is the configuration:', 'Here is the updated file:', 'Sure, here\'s the TOML:', 'config.toml:', 'File: config.toml', 'Add this to your config:', 'The file should look like this:', 'Try this:',
  'Cargo.toml', 'I changed the settings as you asked.', 'Here\'s a minimal example:', 'Save the following as settings.toml',
]
const sentencesAfter = ['Let me know if you need anything else.', 'This should fix the error.', 'Restart the service after you save the file.', 'Hope that helps!', 'The other settings keep their defaults.']

function proseAround(random: Random, scanned: Scan): Damage | undefined {
  const {lineEnd} = scanned
  const opening = before(`${random.pick(sentencesBefore)}${lineEnd}${random.chance(0.6) ? lineEnd : ''}`, rankBeforeDocument - 1)
  if (random.chance(0.65)) return {edits: [opening], form: 'a sentence before the document', wholeText: true}
  const closing = after(scanned, `${random.chance(0.6) ? lineEnd : ''}${random.pick(sentencesAfter)}${random.chance(0.5) ? lineEnd : ''}`, rankAfterDocument + 1)
  return {edits: [opening, closing], form: 'a sentence before the document and one after it', wholeText: true}
}

function frontMatter(random: Random, scanned: Scan): Damage | undefined {
  const {lineEnd} = scanned
  const fence = random.chance(0.75) ? '+++' : '---'
  const page = random.chance(0.6) ? `${lineEnd}# ${random.pick(['Release notes', 'About', 'Getting started', 'Hello world'])}${lineEnd}${lineEnd}${random.pick(['Some text of the page.', 'This post is a draft.', 'Welcome to the docs.'])}${lineEnd}` : ''
  return {edits: [before(`${fence}${lineEnd}`), after(scanned, `${fence}${lineEnd}${page}`)], form: `${fence} before and after the document${page === '' ? '' : ', and the text of a page after it'}`, wholeText: true}
}

function embeddedInCode(random: Random, scanned: Scan): Damage | undefined {
  const {lineEnd} = scanned
  const form = random.weighted([['a heredoc of a shell', 35], ['a template string of JavaScript', 15], ['a raw string of Rust', 12], ['a block of YAML', 23], ['tags of HTML', 15]] as const)
  const around = (first: string, last: string): Damage => ({edits: [before(`${first}${lineEnd}`), after(scanned, `${last}${random.chance(0.7) ? lineEnd : ''}`)], form, wholeText: true})
  switch (form) {
    case 'a heredoc of a shell': {
      const word = random.pick(['EOF', 'EOF', 'EOT', 'END'])
      return around(random.pick([`cat > config.toml <<${word}`, `cat <<'${word}' > config.toml`, `tee settings.toml <<${word}`, `cat << ${word} > Cargo.toml`]), word)
    }
    case 'a template string of JavaScript': return around(random.pick(['const config = `', 'export default `', 'const source = toml`']), '`;')
    case 'a raw string of Rust': return around(random.pick(['let config = r#"', 'const CONFIG: &str = r#"']), '"#;')
    case 'tags of HTML': return random.chance(0.5) ? around('<pre>', '</pre>') : around('<pre><code class="language-toml">', '</code></pre>')
    case 'a block of YAML': {
      // A file inside a YAML value, e.g. of a ConfigMap: every line that is not empty is indented.
      const indent = random.chance(0.6) ? '    ' : '  '
      const edits: Edit[] = [before(`${random.pick(['config.toml: |', 'data: |', 'settings: |-', 'content: |'])}${lineEnd}`)]
      for (const line of scanned.lines) if (line.end > line.start) edits.push({...insertAt(line.start, indent), rank: rankAtLineStart})
      return {edits, form, wholeText: true}
    }
  }
}

// Another version of a line with a key and a value, as the other side of a merge conflict or the old line of a diff
// has it: a number that is a little larger, the other one of true and false, or a string with a word before it.
function otherVersion(random: Random, line: string): string | undefined {
  const equals = line.indexOf('=')
  if (equals === -1) return undefined
  const value = line.slice(equals + 1)
  let changed = value.replace(/\d+/, digits => String(Number(digits) + random.integer(1, 3)))
  if (changed === value) changed = value.replace(/\btrue\b|\bfalse\b/, word => word === 'true' ? 'false' : 'true')
  if (changed === value) changed = value.replace(/(["'])([A-Za-z])/, (_, quote: string, letter: string) => `${quote}${random.pick(['new-', 'old-', 'my-', 'x'])}${letter}`)
  return changed === value ? undefined : `${line.slice(0, equals + 1)}${changed}`
}

// Runs of 1 to 3 entries below one header, each on one line that ends with a line end, on lines that follow each other.
function runsOfEntryLines(scanned: Scan, longest: number): Entry[][] {
  const runs: Entry[][] = []
  const fits = (entry: Entry) => onOneLine(scanned, entry) && firstOnLine(scanned, entry.key.start) && lineAt(scanned, entry.key.start).next > lineAt(scanned, entry.key.start).end
  for (const table of scanned.tables) {
    for (let first = 0; first < table.entries.length; first++) {
      if (!fits(table.entries[first]!)) continue
      const run = [table.entries[first]!]
      runs.push([...run])
      while (run.length < longest) {
        const next = table.entries[first + run.length]
        if (next === undefined || !fits(next) || lineAt(scanned, run.at(-1)!.key.start).next !== lineAt(scanned, next.key.start).start) break
        run.push(next)
        runs.push([...run])
      }
    }
  }
  return runs
}
const lineText = (scanned: Scan, line: Line) => scanned.codePoints.slice(line.start, line.end).join('')

function conflictMarkers(random: Random, scanned: Scan): Damage | undefined {
  const {lineEnd} = scanned
  const runs = runsOfEntryLines(scanned, 3)
  if (runs.length === 0) return undefined
  const run = random.pick(runs)
  const lines = run.map(entry => lineAt(scanned, entry.key.start))
  const otherLines = lines.map(line => otherVersion(random, lineText(scanned, line)))
  if (otherLines.every(line => line === undefined)) return undefined
  const otherSide = lines.map((line, index) => `${otherLines[index] ?? lineText(scanned, line)}${lineEnd}`).join('')
  const start = lines[0]!.start
  const end = lines.at(-1)!.next
  const branch = random.pick(['main', 'feature/config', 'origin/main', 'release/1.2', 'a1b2c3d (update the config)'])
  // With the style diff3, the lines of the common ancestor stand between the two sides: here the kept lines again.
  const ancestor = random.chance(0.12) ? `||||||| base${lineEnd}${lines.map(line => `${lineText(scanned, line)}${lineEnd}`).join('')}` : ''
  if (random.chance(0.5)) {
    return {edits: [insertAt(start, `<<<<<<< HEAD${lineEnd}`), insertAt(end, `${ancestor}=======${lineEnd}${otherSide}>>>>>>> ${branch}${lineEnd}`)], form: `around ${run.length} ${run.length === 1 ? 'entry' : 'entries'}, the document's lines first`}
  }
  return {edits: [insertAt(start, `<<<<<<< HEAD${lineEnd}${otherSide}${ancestor}=======${lineEnd}`), insertAt(end, `>>>>>>> ${branch}${lineEnd}`)], form: `around ${run.length} ${run.length === 1 ? 'entry' : 'entries'}, the other side's lines first`}
}

function linePrefix(random: Random, scanned: Scan): Damage | undefined {
  const {lines, lineEnd} = scanned
  if (lines.length === 0) return undefined
  const atStart = (line: Line, text: string, rank = rankAtLineStart): Edit => ({...insertAt(line.start, text), rank})
  const form = random.weighted([['a + before every line', 22], ['the marks of a diff', 23], ['the number of every line', 35], ['a quote mark before every line', 20]] as const)
  switch (form) {
    case 'a + before every line': return {edits: lines.map(line => atStart(line, '+')), form, wholeText: true}
    case 'the marks of a diff': {
      // A space before every line, a + before the lines that the change added, a line with - and the old version
      // before them, and in half of the texts the line that starts a hunk.
      const runs = runsOfEntryLines(scanned, 3)
      if (runs.length === 0) return undefined
      const added = random.pick(runs).map(entry => lineAt(scanned, entry.key.start))
      const old = otherVersion(random, lineText(scanned, added[0]!))
      const edits = lines.map(line => atStart(line, added.includes(line) ? '+' : ' '))
      if (old !== undefined) edits.push(atStart(added[0]!, `-${old}${lineEnd}`, rankAtLineStart - 1))
      if (random.chance(0.5)) edits.push({...insertAt(0, `@@ -1,${lines.length - added.length + Number(old !== undefined)} +1,${lines.length} @@${lineEnd}`), rank: rankBeforeDocument})
      return {edits, form, wholeText: true}
    }
    case 'the number of every line': {
      const width = String(lines.length).length
      const write = random.weighted<(number: number) => string>([
        [number => `${number} `, 25], [number => `${number}: `, 20], [number => `${number} | `, 15], [number => `${number}\t`, 10], [number => `${String(number).padStart(width)} `, 15],
        [number => `${number}. `, 5], [number => `${String(number).padStart(6)}\t`, 10],
      ])
      return {edits: lines.map((line, index) => atStart(line, write(index + 1))), form: `the number of every line, e.g. ${JSON.stringify(write(1))}`, wholeText: true}
    }
    case 'a quote mark before every line': {
      const mark = random.chance(0.8) ? '>' : '|'
      return {edits: lines.map(line => atStart(line, line.end > line.start ? `${mark} ` : mark)), form: `${mark} before every line`, wholeText: true}
    }
  }
}

const byteOrderMark = '\ufeff'
const noBreakSpace = '\u00a0'
const zeroWidthSpace = '\u200b'

function invisibleCharacter(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const laterHeaders = scanned.headers.filter(header => header.start > 0 && codePoints[header.start - 1] === '\n')
  const aroundEquals = scanned.entries.flatMap(entry => [entry.equals - 1, entry.equals + 1]).filter(position => codePoints[position] === ' ')
  const indentation = scanned.lines.flatMap(line => {
    const positions: number[] = []
    for (let position = line.start; position < line.end && codePoints[position] === ' '; position++) positions.push(position)
    return positions
  })
  const form = chooseForm(random, [
    ['a byte order mark at the start', 35], ['a byte order mark before a later header', laterHeaders.length > 0 ? 8 : 0], ['a no-break space in the place of one space', aroundEquals.length > 0 ? 15 : 0],
    ['no-break spaces around every equals sign', aroundEquals.length > 1 ? 10 : 0], ['no-break spaces as the indentation', indentation.length > 0 ? 12 : 0], ['a zero-width space', scanned.entries.length > 0 ? 20 : 0],
    ['a form feed before a later header', laterHeaders.length > 0 ? 6 : 0],
  ] as const)!
  const noBreak = (positions: readonly number[]) => positions.map(position => replaceOneForOne(position, noBreakSpace))
  switch (form) {
    case 'a byte order mark at the start': return {edits: [before(byteOrderMark, rankBeforeDocument - 5)], form}
    case 'a byte order mark before a later header': return {edits: [{...insertAt(random.pick(laterHeaders).start, byteOrderMark), rank: rankAtLineStart}], form}
    // The character that starts a new page, which some old files have between their parts.
    case 'a form feed before a later header': return {edits: [{...insertAt(random.pick(laterHeaders).start, '\f'), rank: rankAtLineStart}], form}
    case 'a no-break space in the place of one space': return {edits: noBreak([random.pick(aroundEquals)]), form}
    case 'no-break spaces around every equals sign': return {edits: noBreak(aroundEquals), form, wholeText: true}
    case 'no-break spaces as the indentation': return {edits: noBreak(indentation), form, wholeText: true}
    case 'a zero-width space': {
      const entry = random.pick(scanned.entries)
      const [where, position] = random.pick([['before a key', entry.key.start], ['after a key', entry.key.end], ['after a value', entry.value.end]] as const)
      return {edits: [insertAt(position, zeroWidthSpace)], form: `a zero-width space ${where}`}
    }
  }
}

const escape = '\u001b'

function terminalCodes(random: Random, scanned: Scan): Damage | undefined {
  const reset = `${escape}[0m`
  const colored = (start: number, end: number, color: string, last = reset): Edit[] => [insertAt(start, `${escape}[${color}m`), insertAt(end, last)]
  const form = chooseForm(random, [
    ['the marks of a match around a key or a value', scanned.entries.length > 0 ? 35 : 0], ['a color around every header', scanned.headers.length > 0 ? 20 : 0],
    ['a color around every key', scanned.entries.length > 0 ? 20 : 0], ['a color around the document', 25],
  ] as const)!
  switch (form) {
    case 'the marks of a match around a key or a value': {
      // As grep writes them with --color.
      const entry = random.pick(scanned.entries)
      const part = random.chance(0.5) || entry.value.container !== null ? entry.key : entry.value
      return {edits: [insertAt(part.start, `${escape}[01;31m${escape}[K`), insertAt(part.end, `${escape}[m${escape}[K`)], form, wholeText: true}
    }
    case 'a color around every header': return {edits: scanned.headers.flatMap(header => colored(header.start, header.end, '1;33')), form, wholeText: true}
    case 'a color around every key': return {edits: scanned.entries.flatMap(entry => colored(entry.key.start, entry.key.end, '34')), form, wholeText: true}
    case 'a color around the document': return {edits: [before(`${escape}[32m`), {...insertAt(scanned.codePoints.length, reset), rank: rankAfterDocument}], form, wholeText: true}
  }
}

function carriageReturnLineEnds(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const lineFeeds = codePoints.flatMap((character, position) => character === '\n' ? [position] : [])
  if (lineFeeds.length === 0) return undefined
  const usesLineFeedAlone = scanned.lineEnd === '\n'
  const form = chooseForm(random, [
    ['a carriage return in the place of every line feed', usesLineFeedAlone ? 45 : 0], ['a carriage return more at every line end', 30], ['a carriage return after every line feed', usesLineFeedAlone ? 25 : 0],
  ] as const)!
  switch (form) {
    case 'a carriage return in the place of every line feed': return {edits: lineFeeds.map(position => replaceOneForOne(position, '\r')), form, wholeText: true}
    // \r\r\n, as a file has it whose \r\n was taken for \n and written as \r\n once more.
    case 'a carriage return more at every line end': return {edits: lineFeeds.map(position => insertAt(usesLineFeedAlone ? position : position - 1, usesLineFeedAlone ? '\r\r' : '\r')), form, wholeText: true}
    case 'a carriage return after every line feed': return {edits: lineFeeds.filter(position => position + 1 < codePoints.length).map(position => insertAt(position + 1, '\r')), form, wholeText: true}
  }
}

// The lines before which a line of its own can stand: those that start an entry or a header.
function lineStartsOfEntriesAndHeaders(scanned: Scan): number[] {
  return [...scanned.entries.map(entry => entry.key.start), ...scanned.headers.map(header => header.start)].filter(position => firstOnLine(scanned, position)).map(position => lineAt(scanned, position).start)
}

function strayLine(random: Random, scanned: Scan): Damage | undefined {
  const {lineEnd} = scanned
  const starts = lineStartsOfEntriesAndHeaders(scanned)
  if (starts.length === 0) return undefined
  const lineBefore = (start: number, text: string): Edit => ({...insertAt(start, `${indentationAt(scanned, start)}${text}${lineEnd}`), rank: rankAtLineStart})
  const headerStarts = scanned.headers.filter(header => firstOnLine(scanned, header.start) && header.start > 0).map(header => lineAt(scanned, header.start).start)
  const runs = runsOfEntryLines(scanned, 3)
  const form = chooseForm(random, [
    ['a rule between two parts', headerStarts.length > 0 ? 25 : 0], ['the first line of a YAML document', 12], ['a command of a shell or of an editor', 20],
    ['the tags of a template around some entries', runs.length > 0 ? 25 : 0], ['a note without a #', 18],
  ] as const)!
  switch (form) {
    case 'a rule between two parts': return {edits: [lineBefore(random.pick(headerStarts), random.pick(['---', '***', '===', '----------', '* * *', '~~~', '___']))], form}
    case 'the first line of a YAML document': return {edits: [before(`---${lineEnd}`)], form}
    case 'a command of a shell or of an editor': return {edits: [lineBefore(random.pick(starts), random.pick(['$ cargo build', '$ vim config.toml', '> npm install', ':wq', ':w', '% cat config.toml', 'git add .']))], form}
    case 'the tags of a template around some entries': {
      const run = random.pick(runs)
      const [open, close] = random.pick([
        ['{% if production %}', '{% endif %}'], ['{{- if .Values.tls }}', '{{- end }}'], ['<% if tls %>', '<% end %>'], ['{{#if debug}}', '{{/if}}'], ['{% for host in hosts %}', '{% endfor %}'],
      ] as const)
      const first = lineAt(scanned, run[0]!.key.start)
      const last = lineAt(scanned, run.at(-1)!.key.start)
      return {edits: [lineBefore(first.start, open), {...insertAt(last.next, `${indentationAt(scanned, first.start)}${close}${lineEnd}`), rank: rankAtLineStart - 1}], form}
    }
    case 'a note without a #': return {edits: [lineBefore(random.pick(starts), random.pick(['TODO fix this', 'FIXME', 'see below', 'XXX', '(optional)', 'NOTE: ports above 1024 only', 'IMPORTANT']))], form}
  }
}

function ellipsis(random: Random, scanned: Scan): Damage | undefined {
  const {lineEnd} = scanned
  // Entries below one header after the first one, up to a last one, when all of them start a line.
  const tables = scanned.tables.filter(table => table.entries.length >= 3 && table.entries.every(entry => firstOnLine(scanned, entry.key.start) && lastOnLine(scanned, entry.value.end)))
  const arrays = scanned.containers.filter(container => container.type === 'array' && container.items.length >= 3)
  const form = chooseForm(random, [['a marker in the place of some entries', tables.length > 0 ? 60 : 0], ['a marker in the place of some values of an array', arrays.length > 0 ? 40 : 0]] as const)
  if (form === undefined) return undefined
  if (form === 'a marker in the place of some entries') {
    const {entries} = random.pick(tables)
    const first = random.integer(1, entries.length - 1)
    const last = random.integer(first, entries.length - 1)
    const start = lineAt(scanned, entries[first]!.key.start).start
    const lastLine = lineAt(scanned, entries[last]!.value.end)
    const marker = random.weighted([['...', 55], ['…', 12], ['... more ...', 10], ['[...]', 10], ['<snip>', 8], ['(...)', 5]] as const)
    return {edits: [{at: start, remove: lastLine.next - start, insert: `${indentationAt(scanned, start)}${marker}${lastLine.next > lastLine.end ? lineEnd : ''}`}], form: `${marker} in the place of ${last - first + 1} ${last === first ? 'entry' : 'entries'}`}
  }
  const {items} = random.pick(arrays)
  const first = random.integer(1, items.length - 1)
  // Up to the array's last value, or up to a value before it, so that a comma and a value follow the marker.
  const last = random.chance(0.7) ? items.length - 1 : random.integer(first, items.length - 1)
  const start = items[first]!.value.start
  // A comma after the array's last value goes with that value.
  const end = last === items.length - 1 && items[last]!.commaAfter !== -1 ? items[last]!.commaAfter + 1 : items[last]!.value.end
  return {edits: [{at: start, remove: end - start, insert: '...'}], form: `... in the place of ${last - first + 1} ${last === first ? 'value' : 'values'} of an array`}
}

export const aroundKinds: KindDefinition[] = [
  {
    name: 'codeFence', family: 'around the document', weight: 3,
    description: 'The fence of a Markdown code block around the document, as in an answer of a language model or a paste from a README',
    example: '```toml⏎[server]⏎port = 8443⏎```',
    variants: 'a fence before and after; an opening fence alone; three backticks or three tildes; with toml, another word or nothing after the opening fence',
    showable: 'yes: a fence line starts with a character that starts nothing, and is skipped up to its line end',
    apply: codeFence,
  },
  {
    name: 'proseAround', family: 'around the document', weight: 1.5,
    description: 'A sentence or a file name before the document, and sometimes a sentence after it',
    example: 'Here is the updated file:⏎⏎[server]⏎port = 8443',
    variants: 'a sentence before; a sentence before and one after; with or without an empty line between',
    showable: 'yes: the sentence has no label and ends at its line end. A sentence with an apostrophe opens a string that its line end closes',
    apply: proseAround,
  },
  {
    name: 'frontMatter', family: 'around the document', weight: 1,
    description: 'The fences of front matter around the document, as a page of Hugo or Zola has them, with or without the page\'s text after it',
    example: '+++⏎title = "About"⏎draft = false⏎+++⏎⏎# About',
    variants: '+++ or --- before and after; with a heading and a sentence after the second fence or without',
    showable: 'yes: a fence line is skipped up to its line end, and the text after the document has no label',
    apply: frontMatter,
  },
  {
    name: 'embeddedInCode', family: 'around the document', weight: 1, alone: true,
    description: 'The document inside a string of a program, with the program\'s lines around it',
    example: 'cat > config.toml <<EOF⏎[server]⏎port = 8443⏎EOF',
    variants: 'a heredoc of a shell; a template string of JavaScript; a raw string of Rust; a block of YAML, with every line indented; the tags <pre> or <pre><code> of HTML',
    showable: 'yes: the program\'s lines have no label and end at their line ends. A quote in them opens a string that the line end closes',
    apply: embeddedInCode,
  },
  {
    name: 'conflictMarkers', family: 'around the document', weight: 1.5,
    description: 'The marker lines of a merge conflict around 1 to 3 entries, with the other side\'s version of those lines',
    example: '<<<<<<< HEAD⏎port = 8443⏎=======⏎port = 8444⏎>>>>>>> main',
    variants: 'the document\'s lines first or the other side\'s lines first; with the lines of the common ancestor, as the style diff3 has them, or without',
    showable: 'yes: a marker line starts with a character that starts nothing and is skipped up to its line end, and the other side\'s lines have no label',
    apply: conflictMarkers,
  },
  {
    name: 'linePrefix', family: 'around the document', weight: 1.5, alone: true,
    description: 'A mark or a number before every line: a document pasted from a diff, from a listing with line numbers, or from a quoted mail',
    example: '1  [server]⏎2  port = 8443',
    variants: 'a + before every line; a space before every line, a + before 1 to 3 lines, a line with - before them, with or without the line that starts a hunk; the number of every line in 7 forms; > or | before every line',
    showable: 'yes for a mark that starts nothing: it is skipped, and the line is read from there. A number stands where a key stands, so after it the line\'s own key or header has to be read after a key',
    apply: linePrefix,
  },
  {
    name: 'invisibleCharacter', family: 'around the document', weight: 1.2,
    description: 'A character that does not show: a byte order mark, a no-break space in the place of a space, a zero-width space, a form feed',
    example: '◊[server]⏎port⍽= 8443',
    variants: 'a byte order mark at the start, or before a later header; a no-break space in the place of one space, of every space around the equals signs, or of the indentation; a zero-width space before a key, after a key or after a value; a form feed before a later header',
    showable: 'yes for a parser with a character class for it: the character is read as white space',
    apply: invisibleCharacter,
  },
  {
    name: 'terminalCodes', family: 'around the document', weight: 0.5, alone: true,
    description: 'The color codes of a terminal, copied with the text: the escape character, a [, digits and a letter',
    example: '␛[34mport␛[0m = 8443',
    variants: 'the marks of a match around one key or value, as grep writes them; a color around every header; around every key; around the document',
    showable: 'yes for a parser with states for the code: from the escape character to the letter everything is skipped, and its [ opens nothing',
    apply: terminalCodes,
  },
  {
    name: 'carriageReturnLineEnds', family: 'around the document', weight: 0.5, alone: true,
    description: 'Line ends that TOML does not read: a carriage return alone, two of them before the line feed, or one after it',
    example: '[server]↵port = 8443↵',
    variants: 'a carriage return in the place of every line feed; one carriage return more at every line end; a carriage return after every line feed',
    showable: 'yes: a carriage return ends a line by itself, and a second one is white space',
    apply: carriageReturnLineEnds,
  },
  {
    name: 'strayLine', family: 'around the document', weight: 1.5,
    description: 'A line that is no TOML between the lines of the document',
    example: '[server]⏎port = 8443⏎---⏎[tls]',
    variants: 'a rule such as --- or *** before a header; --- as the first line; a command of a shell or of an editor, e.g. :wq; the tags of a template before and after 1 to 3 entries, e.g. {% if production %}; a note without a #',
    showable: 'yes: the line has no label and ends at its line end, and the braces of a tag open and close in pairs',
    apply: strayLine,
  },
  {
    name: 'ellipsis', family: 'around the document', weight: 1.2,
    description: 'A marker for what was left out, in the place of some entries or of some values of an array',
    example: 'tags = ["web", ...]⏎...',
    variants: '... … [...] <snip> (...) or "... more ..." on a line in the place of 1 or more entries; ... in the place of the last values of an array, or of values in its middle',
    showable: 'yes: the marker has no label, and what follows it is read as it is',
    apply: ellipsis,
  },
]
