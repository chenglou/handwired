// What a kind of damage is, and what applying one returns.
import type {Layout, Style, Template} from '../documents.ts'
import type {Edit} from '../edits.ts'
import type {Random} from '../random.ts'
import type {Scan} from '../scan.ts'

// Whether some parser that reads one code point at a time from left to right, with a small state, the depth and the
// kinds of the open containers, could give every kept code point at or after the first damage the label it has in the
// original. Such a parser may tell any two characters apart, which the highlighter's 33 character classes cannot:
// `needsClass` below says when that matters.
// - 'yes': in any layout.
// - 'line rule': only a parser that takes a line feed as a boundary, e.g. "a string ends at the line feed".
// - 'no': no such parser can, e.g. because the broken text reads as another valid continuation until much later.
export type Reachable = 'yes' | 'line rule' | 'no'
export const reachableOrder: readonly Reachable[] = ['no', 'line rule', 'yes']
export const leastReachable = (flags: readonly Reachable[]): Reachable => reachableOrder.find(flag => flags.includes(flag)) ?? 'yes'

export const families = [
  // The text is the original without what isn't typed yet.
  'half typed',
  // A part of the text is missing at an arbitrary place.
  'cut off',
  // A comma or a colon is missing, extra or in the wrong place.
  'separator',
  // A closing bracket is missing, extra or of the other kind.
  'bracket',
  // Comments, and the marker lines of a merge conflict.
  'comment',
  // A token as another language or notation writes it.
  'other notation',
  // An escape that is missing, or a quote too few or too many.
  'inside a string',
  // Text around a document that is itself fine.
  'wrapper',
  // More than one document in one text.
  'several documents',
] as const
export type Family = typeof families[number]

export type Damage = {
  // The valid documents that the author meant, when the kind makes its own, e.g. several records, or a document without
  // the member that a comment switches off. Without it, the original is the document the kind was given. The edits'
  // positions count code points of these documents joined.
  documents?: string[]
  edits: Edit[]
  // Which form of the kind this is and where it sits, e.g. "new entry, cut in a key".
  form: string
  reachable: Reachable
  // Indexes into the original of kept code points whose display kind is not scored, because no left-to-right reading of
  // the broken text can give it, e.g. a quote that lost its backslash, which is part of an escape in the original.
  unscoredKinds?: number[]
  // A character that the recovery must tell apart from others and that the highlighter's classes lump with letters,
  // e.g. the apostrophe.
  needsClass?: string
  // True when another sensible repair of the broken text gives other labels to kept code points.
  debatable?: boolean
  // Other kinds that this damage brings with it, e.g. the trailing comma left behind when the last member of an object
  // is switched off with a comment.
  alsoKinds?: string[]
  // What the document is, when the kind made its own, e.g. "records: event", and the style it is written in.
  template?: string
  style?: Style
}

export type KindOptions = {
  // A form or a scope that a combination asks for, e.g. 'every' for every string of the text.
  scope?: string
  // Who wrote the text around the document, when a combination settles it, e.g. 'model' for a language model's answer.
  writer?: 'model'
}
export type KindDefinition = {
  name: string
  family: Family
  // The kind's share among samples with one kind of damage, out of 100.
  weight: number
  // A short broken text for the README's table.
  example: string
  // For the README's table: when a parser can label the rest, with the reason.
  reachable: string
  // The styles the kind draws its document from, with weights. Without it, the four default styles.
  styles?: readonly (readonly [Style, number])[]
  templates?: readonly Template[]
  layout?: Partial<Layout>
  // The most code points the kind adds, so the document is made that much shorter than the capacity.
  margin?: number
  // The longest document the kind takes, for kinds that multiply the text's length, e.g. a backslash before every quote.
  maximumLength?: number
  apply: (random: Random, scanned: Scan, options?: KindOptions) => Damage | undefined
}
