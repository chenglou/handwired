// The two tables of the kinds of mistakes for README.md, made from the kinds' definitions, so that the page and the
// code say the same. check.ts verifies that README.md holds the tables as this file prints them.
//
// Run from the repo root: bun lab/recovery-toml/held-back/specific/table.ts
import {kinds} from './mistakes.ts'

// A text of an example for a cell of a markdown table: on one line, with a line feed as ⏎, with the characters that
// cannot be seen by their names, and with the characters that mean something in markdown or HTML written as entities.
const invisible: Record<string, string> = {'\n': '⏎', '\t': '→', '\ufeff': '⟨U+FEFF⟩', '\u00a0': '⟨U+00A0⟩', '\u200b': '⟨U+200B⟩'}
const entities: Record<string, string> = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '|': '&#124;', '`': '&#96;', '*': '&#42;', '_': '&#95;', '[': '&#91;', ']': '&#93;', '$': '&#36;', '{': '&#123;', '}': '&#125;', '\\': '&#92;'}
const inCell = (text: string) => `<code>${Array.from(text).map(character => invisible[character] ?? entities[character] ?? character).join('')}</code>`
// Prose for a cell: the vertical bar would end the cell.
const prose = (text: string) => text.replaceAll('|', '&#124;')

// The kinds with what each is and an example: a valid document, and the broken text that the mistake makes of it.
export function kindsTable(): string {
  const rows = kinds.map(kind => `| \`${kind.name}\` | ${kind.family} | ${kind.weight} | ${prose(kind.description)} | ${inCell(kind.meant)} | ${inCell(kind.example)} |`)
  return ['| Kind | Family | Weight | The mistake | The document | The broken text |', '|---|---|---|---|---|---|', ...rows].join('\n')
}

// The kinds with what the alignment says about the example's code points, and the judgment about a parser.
export function reachTable(): string {
  const rows = kinds.map(kind => `| \`${kind.name}\` | ${prose(kind.alignment)} | ${prose(kind.reachable)} |`)
  return ['| Kind | The alignment | Can a parser of the tables\' form show every code point right after the mistake? |', '|---|---|---|', ...rows].join('\n')
}

if (import.meta.main) console.log(`${kindsTable()}\n\n${reachTable()}`)
