// What a kind of mistake is, and what applying one returns. It is lab/recovery-parser/damage/types.ts for TOML,
// without that file's judgments per sample: a sample of this folder is scored by the rules of ../samples.ts alone.
import type {Edit} from '../edits.ts'
import type {Random} from '../random.ts'
import type {Scan} from './scan.ts'

export const families = [
  // How a key gets its value and how entries are kept apart, as another notation does it: a colon, a comma at the end
  // of a line, an inline table on several lines.
  'assignment and separators',
  // A value as another notation writes it: a string without quotes, True, 30s, a date with slashes.
  'values',
  // A quote too few or too many, a backslash that is no escape, a line end inside a string.
  'strings',
  // A key or a header that TOML does not read: a space in a key, a bracket too few, a header with a colon.
  'keys and headers',
  // A closing bracket that is missing, extra or of the other kind.
  'brackets',
  // Comments as other notations write them, and comments that lost their #.
  'comments',
  // Text around or between the lines of a document that is itself fine: a code fence, marker lines of a merge
  // conflict, line numbers, a byte order mark.
  'around the document',
] as const
export type Family = typeof families[number]

export type Damage = {
  edits: Edit[]
  // Which variant of the kind this is and where it sits, e.g. "every entry below one header".
  form: string
  // True when the edits touch the whole text, e.g. a mark before every line. Two kinds in one sample must sit apart
  // from each other unless one of them is such a damage.
  wholeText?: boolean
}

export type KindDefinition = {
  name: string
  family: Family
  // How often the kind is drawn, relative to the other kinds' weights. An estimate, see the README.
  weight: number
  // One line for the README's table: what the mistake is and where it comes from.
  description: string
  // A short broken text for the README's table, with ⏎ for a line feed, ↵ for a carriage return, ⍽ for a no-break
  // space, ◊ for a byte order mark and ␛ for the escape character.
  example: string
  // The variants, for the README's table.
  variants: string
  // For the README's table: whether a parser of the tables' form can show every code point after the mistake right,
  // with the reason.
  showable: string
  // True for a kind that never shares a sample with another kind, e.g. a number before every line: the lines that
  // another kind adds would have none.
  alone?: boolean
  apply: (random: Random, scanned: Scan) => Damage | undefined
}

// The rank of an insertion among insertions at the same place, see Edit.rank in ../edits.ts. Text before the document
// comes before everything else at position 0, e.g. a code fence before the `$` that another kind puts before the first
// key, and text after the document comes after everything else at the end.
export const rankBeforeDocument = -20
export const rankAtLineStart = -10
export const rankAfterDocument = 20
