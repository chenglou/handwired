// The files of the written evaluation set: a case file of a writer, a part file with broken texts alone, and a repair
// file of a repairer. All three are plain text with marker lines, so that a text is written as it is, with no quoting
// and no escaping of quotes or backslashes. README.md and REPAIR.md in this folder describe the files for the people
// and agents who write them. In short:
//
//   ⟦case orders-07⟧                     an entry starts with ⟦case id⟧ or ⟦repair id⟧
//   from: what Python prints for a dict   header lines: `name: text`, or a name alone
//   ⟦intended⟧                            a text section starts with ⟦its name⟧
//   {"paid": true}                        the text, line by line
//   ⟦broken⟧
//   {'paid': True}
//   ⟦end⟧                                 ⟦end⟧ ends the entry
//
// A text is the lines of its section joined with line feeds. The line feed before the next marker line is not a part
// of the text. A character that cannot be seen is written ⟦name⟧ or ⟦U+hex⟧, e.g. ⟦tab⟧ and ⟦U+200B⟧, and is refused
// when it stands in the file as itself: a tab, a carriage return, a no-break space, a byte order mark, the escape
// character, and every other control, format or space character but the plain space. A space at the end of a line
// and an empty first or last line are refused for the same reason: the last space is written ⟦sp⟧, and a line feed
// at the start or the end of a text is written ⟦lf⟧. So what a file shows is what its texts hold.

const opening = '⟦'
const closing = '⟧'
// The names for the characters that broken JSON has most often and that cannot be seen.
const namedCharacters: readonly (readonly [name: string, character: string])[] = [
  ['tab', '\t'], ['lf', '\n'], ['cr', '\r'], ['sp', ' '], ['nbsp', '\u00a0'], ['bom', '\ufeff'], ['esc', '\u001b'],
]
const characterOfName = new Map(namedCharacters)
const nameOfCharacter = new Map(namedCharacters.map(([name, character]) => [character, name]))
type SectionName = 'intended' | 'broken' | 'repaired'
const markerNames = /^(case|repair|intended|broken|repaired|end)( .*)?$/

// Controls, format characters such as the byte order mark and the zero width space, every space but U+0020, the line
// and paragraph separators, and code points that are private or half of a surrogate pair.
const cannotBeSeen = /^[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\p{Co}\p{Cs}]$/u
const mustBeWritten = (character: string) => character === opening || character === closing || (character !== ' ' && cannotBeSeen.test(character))
const written = (character: string) => `${opening}${nameOfCharacter.get(character) ?? `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`}${closing}`

// The lines that stand for a text in a file.
export function linesOfText(text: string): string[] {
  if (text === '') return []
  const parts = text.split('\n').map(part => {
    let line = ''
    for (const character of part) line += mustBeWritten(character) ? written(character) : character
    return line.endsWith(' ') ? `${line.slice(0, -1)}${written(' ')}` : line
  })
  // An empty first or last line would be a line feed that cannot be seen, so each line feed at the start and at the
  // end of the text is written out on the line next to it.
  const lineFeed = written('\n')
  let leading = ''
  while (parts.length > 1 && parts[0] === '') {
    parts.shift()
    leading += lineFeed
  }
  parts[0] = leading + parts[0]!
  while (parts.length > 1 && parts.at(-1) === '') {
    parts.pop()
    parts[parts.length - 1] += lineFeed
  }
  return parts
}

// The text that the lines of a section stand for, or what is wrong with them. `firstLine` is the number of the first
// of the lines in its file, for the messages.
export function textOfLines(lines: readonly string[], firstLine: number): {text: string, problems: string[]} {
  const problems: string[] = []
  if (lines.length > 0 && lines[0] === '') problems.push(`line ${firstLine}: the text starts with an empty line. Remove the line, or write ${written('\n')} at the start of the next line when the text starts with a line feed`)
  if (lines.length > 1 && lines.at(-1) === '') problems.push(`line ${firstLine + lines.length - 1}: the text ends with an empty line. Remove the line, or write ${written('\n')} at the end of the line before it when the text ends with a line feed`)
  const decoded = lines.map((line, offset) => {
    const where = `line ${firstLine + offset}`
    if (line.endsWith(' ')) problems.push(`${where}: the line ends with a space, which cannot be seen. Write the last space as ${written(' ')}, or remove it`)
    let text = ''
    const characters = Array.from(line)
    for (let index = 0; index < characters.length; index++) {
      const character = characters[index]!
      if (character === opening) {
        const end = characters.indexOf(closing, index)
        const name = end === -1 ? undefined : characters.slice(index + 1, end).join('')
        const codePoint = name !== undefined && /^U\+[0-9A-Fa-f]{4,6}$/.test(name) ? Number.parseInt(name.slice(2), 16) : undefined
        if (name !== undefined && characterOfName.has(name)) text += characterOfName.get(name)!
        else if (codePoint !== undefined && codePoint <= 0x10ffff) text += String.fromCodePoint(codePoint)
        else if (name !== undefined && markerNames.test(name)) {
          problems.push(`${where}: ${opening}${name}${closing} is a marker, and a marker stands alone on its line, from the line's first character on`)
        } else {
          problems.push(`${where}: ${name === undefined ? `${opening} without ${closing}` : `${opening}${name}${closing} names no character`}. Between ${opening} and ${closing} stands ${namedCharacters.map(([known]) => known).join(', ')} or U+ and 4 to 6 hexadecimal digits`)
          if (end === -1) break
        }
        index = end
      } else if (mustBeWritten(character)) {
        problems.push(`${where}: a character that cannot be seen, or ${closing} alone, stands in the line as itself. Write it as ${written(character)}`)
      } else text += character
    }
    return text
  })
  return {text: decoded.join('\n'), problems}
}

// What a writer or a repairer typed where a ⟦name⟧ was meant, e.g. [[tab]] or 〚nbsp〛: the text then holds those
// characters as they are, and nothing else would notice.
export function mistypedNames(text: string): string[] {
  const names = `(?:${namedCharacters.map(([name]) => name).join('|')}|U\\+[0-9A-Fa-f]{2,6})`
  return text.match(new RegExp(`(?:\\[\\[|[〚【［<{(])${names}(?:\\]\\]|[〛】］>})])`, 'g')) ?? []
}

type Entry = {
  kind: 'case' | 'repair'
  id: string
  // The line of the entry's first marker in the file, counted from 1.
  line: number
  headers: Map<string, string>
  sections: Map<SectionName, string>
}

// The entries of a file, and what is wrong with the file. An entry with a problem is left out, and the entries after
// it are still read.
function readEntries(fileText: string): {entries: Entry[], problems: string[]} {
  const entries: Entry[] = []
  const problems: string[] = []
  if (fileText.startsWith('\ufeff')) problems.push(`line 1: the file starts with a byte order mark. Save it without one; a byte order mark inside a text is written ${written('\ufeff')}`)
  if (fileText.includes('\r')) problems.push(`the file holds carriage returns. Save it with plain line feeds; a carriage return inside a text is written ${written('\r')}`)
  const lines = fileText.replace(/^\ufeff/, '').replaceAll('\r\n', '\n').split('\n')
  // The name of a marker line and what stands after the name, or undefined for any other line.
  const markerOf = (line: string) => {
    const match = /^⟦(case|repair|intended|broken|repaired|end)(?: ([^⟦⟧]*))?⟧$/.exec(line.trimEnd())
    return match === null ? undefined : {name: match[1] as Entry['kind'] | SectionName | 'end', rest: match[2]}
  }
  let index = 0
  while (index < lines.length) {
    const start = markerOf(lines[index]!)
    if (start === undefined || (start.name !== 'case' && start.name !== 'repair')) {
      if (lines[index]!.trim() !== '') problems.push(`line ${index + 1}: outside an entry only empty lines can stand, and the line is ${JSON.stringify(lines[index]!.slice(0, 60))}. An entry starts with ${opening}case id${closing} or ${opening}repair id${closing}`)
      index++
      continue
    }
    const entry: Entry = {kind: start.name, id: (start.rest ?? '').trim(), line: index + 1, headers: new Map(), sections: new Map()}
    const entryProblems: string[] = []
    const where = `${entry.kind} ${entry.id === '' ? 'without an id' : entry.id}, line ${entry.line}`
    if (!/^[A-Za-z0-9._-]+$/.test(entry.id)) entryProblems.push(`${where}: an id is made of letters, digits, dots, hyphens and underscores`)
    index++
    // The header lines, up to the first section.
    for (; index < lines.length && markerOf(lines[index]!) === undefined; index++) {
      const line = lines[index]!
      if (line.trim() === '') continue
      const header = /^([a-z]+)(?::\s*(.*))?$/.exec(line.trimEnd())
      if (header === null) entryProblems.push(`${where}: line ${index + 1} is no header line. A header line is a name and a colon and a text, e.g. "from: a config file edited by hand", or a name alone`)
      else if (entry.headers.has(header[1]!)) entryProblems.push(`${where}: the header ${header[1]} stands twice`)
      else entry.headers.set(header[1]!, (header[2] ?? '').trim())
    }
    // The sections, up to the end marker.
    let ended = false
    while (index < lines.length && !ended) {
      const section = markerOf(lines[index]!)!
      if (section.name === 'end') {
        ended = true
        index++
      } else if (section.name === 'case' || section.name === 'repair') {
        break
      } else {
        const name = section.name
        const firstLine = index + 2
        const sectionLines: string[] = []
        for (index++; index < lines.length && markerOf(lines[index]!) === undefined; index++) sectionLines.push(lines[index]!)
        const decoded = textOfLines(sectionLines, firstLine)
        for (const problem of decoded.problems) entryProblems.push(`${where}: ${problem}`)
        if (section.rest !== undefined) entryProblems.push(`${where}: the marker of a section is ${opening}${name}${closing} alone`)
        if (entry.sections.has(name)) entryProblems.push(`${where}: the section ${name} stands twice`)
        entry.sections.set(name, decoded.text)
      }
    }
    if (!ended) entryProblems.push(`${where}: the entry has no ${opening}end${closing} line`)
    if (entryProblems.length === 0) entries.push(entry)
    else problems.push(...entryProblems)
  }
  return {entries, problems}
}

// Checks an entry's kind, headers and sections against what its file may hold, and returns what is wrong.
function shapeProblems(entry: Entry, kind: Entry['kind'], headers: readonly string[], sections: readonly SectionName[]): string[] {
  const where = `${entry.kind} ${entry.id}, line ${entry.line}`
  if (entry.kind !== kind) return [`${where}: this file holds entries that start with ${opening}${kind} id${closing}`]
  const problems: string[] = []
  for (const name of entry.headers.keys()) if (!headers.includes(name)) problems.push(`${where}: the header "${name}" is not one of ${headers.join(', ')}`)
  for (const name of sections) if (!entry.sections.has(name)) problems.push(`${where}: the section ${opening}${name}${closing} is missing`)
  for (const name of entry.sections.keys()) if (!sections.includes(name)) problems.push(`${where}: the section ${opening}${name}${closing} does not belong in this file`)
  return problems
}

export type CaseEntry = {
  id: string
  // Where such a broken text comes from, in one line, e.g. "what Python prints for a dict".
  from: string
  note: string | undefined
  // The writer's mark that another repair is as sensible as the intended text.
  debatable: boolean
  // The valid document that the author of the broken text meant.
  intended: string
  broken: string
  line: number
}
export type PartEntry = {id: string, broken: string, line: number}
export type RepairEntry = {
  id: string
  repaired: string
  // The other reading, when the repairer marked the repair as unsure.
  unsure: string | undefined
  line: number
}

// Reads the entries of a file with `read`, which returns an entry's item, or undefined after it has added what is
// wrong with the entry to the problems.
function readFile<Item>(fileText: string, read: (entry: Entry, problems: string[]) => Item | undefined): {items: Item[], problems: string[]} {
  const {entries, problems} = readEntries(fileText)
  const items: Item[] = []
  const seen = new Set<string>()
  for (const entry of entries) {
    const item = read(entry, problems)
    if (item === undefined) continue
    if (seen.has(entry.id)) problems.push(`${entry.kind} ${entry.id}, line ${entry.line}: the id stands twice in the file`)
    else {
      seen.add(entry.id)
      items.push(item)
    }
  }
  return {items, problems}
}

// A writer's file: cases with the intended text and the broken text.
export function readCaseFile(fileText: string) {
  return readFile<CaseEntry>(fileText, (entry, problems) => {
    const found = shapeProblems(entry, 'case', ['from', 'note', 'debatable'], ['intended', 'broken'])
    const where = `case ${entry.id}, line ${entry.line}`
    if ((entry.headers.get('from') ?? '') === '') found.push(`${where}: the line "from: …" is missing, which says in one line where such a broken text comes from`)
    if ((entry.headers.get('debatable') ?? '') !== '') found.push(`${where}: the mark is the word "debatable" alone on its line. What the other repair is belongs in the line "note: …"`)
    if (entry.headers.get('note') === '') found.push(`${where}: the line "note:" is empty`)
    problems.push(...found)
    if (found.length > 0) return undefined
    return {id: entry.id, from: entry.headers.get('from')!, note: entry.headers.get('note'), debatable: entry.headers.has('debatable'), intended: entry.sections.get('intended')!, broken: entry.sections.get('broken')!, line: entry.line}
  })
}

// A part file for the repairers: broken texts alone, under ids that say nothing about them.
export function readPartFile(fileText: string) {
  return readFile<PartEntry>(fileText, (entry, problems) => {
    const found = shapeProblems(entry, 'case', [], ['broken'])
    problems.push(...found)
    return found.length > 0 ? undefined : {id: entry.id, broken: entry.sections.get('broken')!, line: entry.line}
  })
}

// A repairer's file: one repaired text per broken text of a part file.
export function readRepairFile(fileText: string) {
  return readFile<RepairEntry>(fileText, (entry, problems) => {
    const found = shapeProblems(entry, 'repair', ['unsure'], ['repaired'])
    if (entry.headers.get('unsure') === '') found.push(`repair ${entry.id}, line ${entry.line}: the line "unsure: …" says the other reading in a sentence`)
    problems.push(...found)
    return found.length > 0 ? undefined : {id: entry.id, repaired: entry.sections.get('repaired')!, unsure: entry.headers.get('unsure'), line: entry.line}
  })
}

const marker = (name: string) => `${opening}${name}${closing}`
const fileOf = (entries: readonly string[][]) => `${entries.map(lines => lines.join('\n')).join('\n\n')}\n`

export function caseFileText(cases: readonly Omit<CaseEntry, 'line'>[]): string {
  return fileOf(cases.map(entry => [
    marker(`case ${entry.id}`), `from: ${entry.from}`, ...(entry.note === undefined ? [] : [`note: ${entry.note}`]), ...(entry.debatable ? ['debatable'] : []),
    marker('intended'), ...linesOfText(entry.intended), marker('broken'), ...linesOfText(entry.broken), marker('end'),
  ]))
}

export function partFileText(parts: readonly Omit<PartEntry, 'line'>[]): string {
  return fileOf(parts.map(entry => [marker(`case ${entry.id}`), marker('broken'), ...linesOfText(entry.broken), marker('end')]))
}

export function repairFileText(repairs: readonly Omit<RepairEntry, 'line'>[]): string {
  return fileOf(repairs.map(entry => [
    marker(`repair ${entry.id}`), ...(entry.unsure === undefined ? [] : [`unsure: ${entry.unsure}`]), marker('repaired'), ...linesOfText(entry.repaired), marker('end'),
  ]))
}
