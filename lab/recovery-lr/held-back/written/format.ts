// The files of the written set of broken miniml programs: a file with broken programs alone, and a repair file with
// one repair per broken program. Both are plain text with marker lines, so that a text is written as it is, with no
// quoting and no escaping of quotes or backslashes. README.md and REPAIR.md in this folder describe the files for the
// agents who write them. In short:
//
//   ⟦case hand-edits-07⟧                 a broken program starts with ⟦case id⟧ and ⟦broken⟧
//   ⟦broken⟧
//   let limit = 10;;                      the text, line by line
//   ⟦end⟧                                 ⟦end⟧ ends the entry
//
//   ⟦repair hand-edits-07⟧               a repair starts with ⟦repair id⟧
//   from: a file typed by an OCaml user   header lines: `name: text`
//   ⟦aligned⟧
//   let limit = 10⟦added⟧;;⟦/⟧            the broken program with marks, see below
//   ⟦end⟧
//
// A text is the lines of its section joined with line feeds. The line feed before the next marker line is not a part
// of the text. A character that cannot be seen is written ⟦name⟧ or ⟦U+hex⟧, e.g. ⟦tab⟧ and ⟦U+200B⟧, and is refused
// when it stands in the file as itself: a tab, a carriage return, a no-break space, a byte order mark, the escape
// character, and every other control, format or space character but the plain space. A space at the end of a line
// and an empty first or last line are refused for the same reason: the last space is written ⟦sp⟧, and a line feed
// at the start or the end of a text is written ⟦lf⟧. So what a file shows is what its texts hold.
//
// An aligned text holds two texts at once, the broken program and the repaired program, and says which code point of
// the one is which code point of the other. It is the broken program with two marks:
//   ⟦added⟧…⟦/⟧     text of the broken program that is no part of the repaired program
//   ⟦missing⟧…⟦/⟧   text of the repaired program that the broken program lacks at that place
// Everything outside the marks is in both texts, as the same code points. E.g. `let limit ⟦missing⟧= ⟦/⟧10⟦added⟧;;⟦/⟧`
// is the broken program `let limit 10;;` and the repaired program `let limit = 10`. No mark says that one code point
// stands in the place of another: such a code point is added, and the one that was meant is missing, as in the
// samples of ../../sample.ts.

const opening = '⟦'
const closing = '⟧'
// The names for the characters that a broken program has most often and that cannot be seen.
const namedCharacters: readonly (readonly [name: string, character: string])[] = [
  ['tab', '\t'], ['lf', '\n'], ['cr', '\r'], ['sp', ' '], ['nbsp', ' '], ['bom', '﻿'], ['esc', '\u001b'],
]
const characterOfName = new Map(namedCharacters)
const nameOfCharacter = new Map(namedCharacters.map(([name, character]) => [character, name]))
type SectionName = 'broken' | 'aligned'
const markerNames = /^(case|repair|broken|aligned|end)( .*)?$/

// Controls, format characters such as the byte order mark and the zero width space, every space but U+0020, the line
// and paragraph separators, and code points that are private or half of a surrogate pair.
const cannotBeSeen = /^[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\p{Co}\p{Cs}]$/u
const mustBeWritten = (character: string) => character === opening || character === closing || (character !== ' ' && cannotBeSeen.test(character))
const written = (character: string) => `${opening}${nameOfCharacter.get(character) ?? `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`}${closing}`
const knownNames = `${namedCharacters.map(([name]) => name).join(', ')} or U+ and 4 to 6 hexadecimal digits`

// The character that a name between ⟦ and ⟧ stands for, e.g. a tab for `tab` and a zero width space for `U+200B`.
function characterOf(name: string): string | undefined {
  const named = characterOfName.get(name)
  if (named !== undefined) return named
  const codePoint = /^U\+[0-9A-Fa-f]{4,6}$/.test(name) ? Number.parseInt(name.slice(2), 16) : undefined
  return codePoint !== undefined && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : undefined
}

// The lines of a text in which every character that cannot be seen is written out, a line feed stays a line break,
// the last space of a line is ⟦sp⟧, and each line feed at the start and at the end of the text is ⟦lf⟧ on the line
// next to it: an empty first or last line would be a line feed that cannot be seen.
function shownLines(parts: string[]): string[] {
  const lines = parts.map(line => line.endsWith(' ') ? `${line.slice(0, -1)}${written(' ')}` : line)
  const lineFeed = written('\n')
  let leading = ''
  while (lines.length > 1 && lines[0] === '') {
    lines.shift()
    leading += lineFeed
  }
  lines[0] = leading + lines[0]!
  while (lines.length > 1 && lines.at(-1) === '') {
    lines.pop()
    lines[lines.length - 1] += lineFeed
  }
  return lines
}
const writtenOut = (text: string) => Array.from(text, character => mustBeWritten(character) ? written(character) : character).join('')

// The lines that stand for a text in a file.
export function linesOfText(text: string): string[] {
  return text === '' ? [] : shownLines(text.split('\n').map(writtenOut))
}

// What a line of a section holds, in order: a character, or the start or the end of a run of an aligned text.
type Piece = {kind: 'character', character: string} | {kind: 'added' | 'missing' | 'close'}

// The pieces of a line, with what is wrong with the line added to `problems`. `where` names the line in a message.
function piecesOfLine(line: string, where: string, problems: string[]): Piece[] {
  const pieces: Piece[] = []
  if (line.endsWith(' ')) problems.push(`${where}: the line ends with a space, which cannot be seen. Write the last space as ${written(' ')}, or remove it`)
  const characters = Array.from(line)
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!
    if (character !== opening) {
      if (mustBeWritten(character)) problems.push(`${where}: a character that cannot be seen, or ${closing} alone, stands in the line as itself. Write it as ${written(character)}`)
      else pieces.push({kind: 'character', character})
      continue
    }
    const end = characters.indexOf(closing, index)
    if (end === -1) {
      problems.push(`${where}: ${opening} without ${closing}. Between ${opening} and ${closing} stands ${knownNames}, or a mark of an aligned text`)
      break
    }
    const name = characters.slice(index + 1, end).join('')
    index = end
    const named = characterOf(name)
    if (named !== undefined) pieces.push({kind: 'character', character: named})
    else if (name === 'added' || name === 'missing') pieces.push({kind: name})
    else if (name === '/') pieces.push({kind: 'close'})
    else if (name === 'extra') problems.push(`${where}: ${opening}extra${closing} is no mark of this set. Text of the broken program that is no part of the repaired program starts with ${opening}added${closing}`)
    else if (/^.+ for .+$/u.test(name)) problems.push(`${where}: ${opening}${name}${closing} is no mark of this set. A code point in the place of another one is two runs: ${opening}added${closing} with the one, then ${opening}missing${closing} with the other`)
    else if (markerNames.test(name)) problems.push(`${where}: ${opening}${name}${closing} is a marker, and a marker stands alone on its line, from the line's first character on`)
    else problems.push(`${where}: ${opening}${name}${closing} names no character and is no mark. Between ${opening} and ${closing} stands ${knownNames}, or in an aligned text one of the marks ${opening}added${closing}, ${opening}missing${closing} and ${opening}/${closing}`)
  }
  return pieces
}

// What is wrong with the first and the last line of a section. `firstLine` is the number of the first of the lines in
// its file, for the messages.
function edgeProblems(lines: readonly string[], firstLine: number): string[] {
  const problems: string[] = []
  if (lines.length > 0 && lines[0] === '') problems.push(`line ${firstLine}: the text starts with an empty line. Remove the line, or write ${written('\n')} at the start of the next line when the text starts with a line feed`)
  if (lines.length > 1 && lines.at(-1) === '') problems.push(`line ${firstLine + lines.length - 1}: the text ends with an empty line. Remove the line, or write ${written('\n')} at the end of the line before it when the text ends with a line feed`)
  return problems
}

// The text that the lines of a section stand for, or what is wrong with them.
export function textOfLines(lines: readonly string[], firstLine: number): {text: string, problems: string[]} {
  const problems = edgeProblems(lines, firstLine)
  const decoded = lines.map((line, offset) => {
    const where = `line ${firstLine + offset}`
    let text = ''
    for (const piece of piecesOfLine(line, where, problems)) {
      if (piece.kind === 'character') text += piece.character
      else problems.push(`${where}: a mark of an aligned text stands in a text that is no aligned text. A broken program is written as it is`)
    }
    return text
  })
  return {text: decoded.join('\n'), problems}
}

// The two texts of an aligned text and which code point is which.
export type Aligned = {
  // The broken program and the repaired program.
  broken: string
  repaired: string
  // For each code point of the broken program: the index of its counterpart among the code points of the repaired
  // program, or -1 for an added code point, which has none. The indices of the kept code points rise, and a kept
  // code point is the same code point as its counterpart.
  alignment: number[]
}

// The aligned text that the lines of a section stand for, or what is wrong with them.
export function alignedOfLines(lines: readonly string[], firstLine: number): {aligned: Aligned, problems: string[]} {
  const problems = edgeProblems(lines, firstLine)
  const broken: string[] = []
  const repaired: string[] = []
  const alignment: number[] = []
  // The run that is open, with the line of its mark and how many code points it holds so far.
  let run: {kind: 'added' | 'missing', where: string, length: number} | undefined
  const take = (character: string) => {
    if (run !== undefined) run.length++
    if (run?.kind === 'missing') {
      repaired.push(character)
      return
    }
    alignment.push(run === undefined ? repaired.length : -1)
    broken.push(character)
    if (run === undefined) repaired.push(character)
  }
  lines.forEach((line, offset) => {
    const where = `line ${firstLine + offset}`
    if (offset > 0) take('\n')
    for (const piece of piecesOfLine(line, where, problems)) {
      if (piece.kind === 'character') take(piece.character)
      else if (piece.kind === 'close') {
        if (run === undefined) problems.push(`${where}: ${opening}/${closing} ends no run. A run starts with ${opening}added${closing} or ${opening}missing${closing}`)
        else if (run.length === 0) problems.push(`${where}: the run that starts with ${opening}${run.kind}${closing} is empty`)
        run = undefined
      } else if (run !== undefined) {
        problems.push(`${where}: a mark stands inside the run that ${opening}${run.kind}${closing} starts on ${run.where}. End that run with ${opening}/${closing} first`)
      } else run = {kind: piece.kind, where, length: 0}
    }
  })
  if (run !== undefined) problems.push(`${run.where}: the run that starts with ${opening}${run.kind}${closing} has no ${opening}/${closing}`)
  return {aligned: {broken: broken.join(''), repaired: repaired.join(''), alignment}, problems}
}

// The lines that stand for an aligned text in a file: the inverse of alignedOfLines. A line feed inside a run stands
// as a line break of the file, as in a text. Missing text at the place of added text comes after it.
export function linesOfAligned(aligned: Aligned): string[] {
  const broken = Array.from(aligned.broken)
  const repaired = Array.from(aligned.repaired)
  // The parts of the aligned text in order: text that both texts have, an added run, or a missing run.
  const parts: {text: string, mark: 'added' | 'missing' | undefined}[] = []
  const add = (text: string, mark: 'added' | 'missing' | undefined) => {
    const last = parts.at(-1)
    if (last !== undefined && last.mark === mark) last.text += text
    else parts.push({text, mark})
  }
  let expected = 0
  aligned.alignment.forEach((counterpart, position) => {
    if (counterpart === -1) return add(broken[position]!, 'added')
    if (counterpart > expected) add(repaired.slice(expected, counterpart).join(''), 'missing')
    expected = counterpart + 1
    add(broken[position]!, undefined)
  })
  if (expected < repaired.length) add(repaired.slice(expected).join(''), 'missing')
  let text = ''
  for (const part of parts) {
    // Every character of a part is written as linesOfText writes it, but a line feed, which stays a line break.
    const shown = part.text.split('\n').map(writtenOut).join('\n')
    text += part.mark === undefined ? shown : `${opening}${part.mark}${closing}${shown}${opening}/${closing}`
  }
  return shownLines(text.split('\n'))
}

// What a writer typed where a ⟦name⟧ was meant, e.g. [[tab]] or 〚nbsp〛: the text then holds those characters as
// they are, and nothing else would notice.
export function mistypedNames(text: string): string[] {
  const names = `(?:${namedCharacters.map(([name]) => name).join('|')}|added|missing|extra|U\\+[0-9A-Fa-f]{2,6})`
  return text.match(new RegExp(`(?:\\[\\[|[〚【［<{])${names}(?:\\]\\]|[〛】］>}])`, 'g')) ?? []
}

type Entry = {
  kind: 'case' | 'repair'
  id: string
  // The line of the entry's first marker in the file, counted from 1.
  line: number
  headers: Map<string, string>
  // The lines of each section, and the number of the first of them in the file.
  sections: Map<SectionName, {lines: string[], firstLine: number}>
}

// The entries of a file, and what is wrong with the file. An entry with a problem is left out, and the entries after
// it are still read.
function readEntries(fileText: string): {entries: Entry[], problems: string[]} {
  const entries: Entry[] = []
  const problems: string[] = []
  if (fileText.startsWith('﻿')) problems.push(`line 1: the file starts with a byte order mark. Save it without one; a byte order mark inside a text is written ${written('﻿')}`)
  if (fileText.includes('\r')) problems.push(`the file holds carriage returns. Save it with plain line feeds; a carriage return inside a text is written ${written('\r')}`)
  const lines = fileText.replace(/^﻿/, '').replaceAll('\r\n', '\n').split('\n')
  // The name of a marker line and what stands after the name, or undefined for any other line.
  const markerOf = (line: string) => {
    const match = /^⟦(case|repair|broken|aligned|end)(?: ([^⟦⟧]*))?⟧$/.exec(line.trimEnd())
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
      if (header === null) entryProblems.push(`${where}: line ${index + 1} is no header line. A header line is a name and a colon and a text, e.g. "from: a file edited by hand"`)
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
        if (section.rest !== undefined) entryProblems.push(`${where}: the marker of a section is ${opening}${name}${closing} alone`)
        if (entry.sections.has(name)) entryProblems.push(`${where}: the section ${name} stands twice`)
        entry.sections.set(name, {lines: sectionLines, firstLine})
      }
    }
    if (!ended) entryProblems.push(`${where}: the entry has no ${opening}end${closing} line`)
    if (entryProblems.length === 0) entries.push(entry)
    else problems.push(...entryProblems)
  }
  return {entries, problems}
}

// Checks an entry's kind, headers and sections against what its file may hold, and returns what is wrong.
function shapeProblems(entry: Entry, kind: Entry['kind'], headers: readonly string[], section: SectionName): string[] {
  const where = `${entry.kind} ${entry.id}, line ${entry.line}`
  if (entry.kind !== kind) return [`${where}: this file holds entries that start with ${opening}${kind} id${closing}`]
  const problems: string[] = []
  for (const name of entry.headers.keys()) if (!headers.includes(name)) problems.push(`${where}: the header "${name}" is not ${headers.length === 0 ? 'allowed: this file has no header lines' : `one of ${headers.join(', ')}`}`)
  if (!entry.sections.has(section)) problems.push(`${where}: the section ${opening}${section}${closing} is missing`)
  for (const name of entry.sections.keys()) if (name !== section) problems.push(`${where}: the section ${opening}${name}${closing} does not belong in this file`)
  return problems
}

// A broken program under its id.
export type BrokenEntry = {id: string, broken: string, line: number}
// A repair of the broken program with the same id.
export type RepairEntry = {
  id: string
  aligned: Aligned
  // Where such a broken program comes from, in one line, e.g. "a file after a merge". The writer of a case gives it,
  // and a second repairer, who sees the broken program alone, does not.
  from: string | undefined
  note: string | undefined
  // The other reading, when another repair is as sensible as this one.
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

// A file of broken programs: each under its id, with no other line.
export function readBrokenFile(fileText: string) {
  return readFile<BrokenEntry>(fileText, (entry, problems) => {
    const where = `case ${entry.id}, line ${entry.line}`
    const found = shapeProblems(entry, 'case', [], 'broken')
    const section = entry.sections.get('broken')
    const decoded = section === undefined ? undefined : textOfLines(section.lines, section.firstLine)
    if (decoded !== undefined) found.push(...decoded.problems.map(problem => `${where}: ${problem}`))
    problems.push(...found)
    return found.length > 0 || decoded === undefined ? undefined : {id: entry.id, broken: decoded.text, line: entry.line}
  })
}

// A repair file: one aligned text per broken program. A writer's repair has the line "from: …", and a second repair
// does not.
export function readRepairFile(fileText: string, role: 'writer' | 'second') {
  return readFile<RepairEntry>(fileText, (entry, problems) => {
    const where = `repair ${entry.id}, line ${entry.line}`
    const found = shapeProblems(entry, 'repair', role === 'writer' ? ['from', 'note', 'unsure'] : ['note', 'unsure'], 'aligned')
    if (role === 'writer' && (entry.headers.get('from') ?? '') === '') found.push(`${where}: the line "from: …" is missing, which says in one line where such a broken program comes from`)
    if (entry.headers.get('note') === '') found.push(`${where}: the line "note:" is empty`)
    if (entry.headers.get('unsure') === '') found.push(`${where}: the line "unsure: …" says the other reading in a sentence`)
    const section = entry.sections.get('aligned')
    const decoded = section === undefined ? undefined : alignedOfLines(section.lines, section.firstLine)
    if (decoded !== undefined) found.push(...decoded.problems.map(problem => `${where}: ${problem}`))
    problems.push(...found)
    if (found.length > 0 || decoded === undefined) return undefined
    return {id: entry.id, aligned: decoded.aligned, from: entry.headers.get('from'), note: entry.headers.get('note'), unsure: entry.headers.get('unsure'), line: entry.line}
  })
}

const marker = (name: string) => `${opening}${name}${closing}`
const fileOf = (entries: readonly string[][]) => `${entries.map(lines => lines.join('\n')).join('\n\n')}\n`

export function brokenFileText(entries: readonly Omit<BrokenEntry, 'line'>[]): string {
  return fileOf(entries.map(entry => [marker(`case ${entry.id}`), marker('broken'), ...linesOfText(entry.broken), marker('end')]))
}

export function repairFileText(repairs: readonly Omit<RepairEntry, 'line'>[]): string {
  return fileOf(repairs.map(entry => [
    marker(`repair ${entry.id}`), ...(entry.from === undefined ? [] : [`from: ${entry.from}`]), ...(entry.note === undefined ? [] : [`note: ${entry.note}`]),
    ...(entry.unsure === undefined ? [] : [`unsure: ${entry.unsure}`]), marker('aligned'), ...linesOfAligned(entry.aligned), marker('end'),
  ]))
}

// A repair file that changes nothing yet, for a second repairer to start from: every broken program of a file of
// broken programs as an aligned text without marks.
export function blankRepairFileText(brokenFile: string): string {
  const {items, problems} = readBrokenFile(brokenFile)
  if (problems.length > 0) throw new Error(`the file of broken programs has problems: ${problems.join('; ')}`)
  return repairFileText(items.map(entry => ({id: entry.id, aligned: {broken: entry.broken, repaired: entry.broken, alignment: Array.from(entry.broken, (_, index) => index)}, from: undefined, note: undefined, unsure: undefined})))
}
