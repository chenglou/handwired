// What a kind of mistake is, and what applying one returns. It is lab/recovery-parser/damage/types.ts for the mistakes
// that people make in TOML.
import type {Edit} from '../../../edits.ts'
import type {Random} from '../../../random.ts'
import type {Scan} from '../scan.ts'

// Whether a parser can give every scored label of a sample. The parser meant here has the form of ../../../table-parser.ts:
// it reads one code point at a time from left to right, with a tokenizer state, a grammar state and the stack of open
// arrays and inline tables, it moves the stack by one level per code point at most, and it reads valid TOML exactly
// as the tables do, so up to the first error it gives what they give. It may have more states and more character
// classes than the tables have: what needs a class that the 47 classes lack is in the sample's needsClass.
// - 'yes': some such parser can. The rule it follows may be at odds with the rule of another kind: the README says
//   where.
// - 'line rule': only a parser that ends a string at the end of its line can, e.g. after `name = "tiny` without its
//   closing quote. Valid TOML has no line end inside a string of one line, so the rule changes nothing for valid
//   texts. It is kept apart because the labels of the mistake `lineFeedInString` need the opposite.
// - 'no': no such parser can: a later code point decides what an earlier one is, or the broken text reads as the start
//   of another valid text, or the rule that would label it is at odds with a rule that far more texts need.
// The flag is a judgment per form of a mistake, and no proof.
export type Reachable = 'yes' | 'line rule' | 'no'
export const reachableOrder: readonly Reachable[] = ['no', 'line rule', 'yes']
export const leastReachable = (flags: readonly Reachable[]): Reachable => reachableOrder.find(flag => flags.includes(flag)) ?? 'yes'

export const families = [
  // The sign between a key and its value, or a comma, is another one, missing or extra.
  'separator',
  // A quote that is missing or of another sort, and what a string may not hold.
  'quote',
  // A bracket of a header, of an array or of an inline table that is missing or extra, and a line end between braces.
  'bracket',
  // A key or a value in a form that TOML does not have.
  'key or value',
  // Lines as JSON, YAML, an INI file or a C-like language write them.
  'other language',
  // Text that is no part of the document, and text that is missing.
  'around the text',
] as const
export type Family = typeof families[number]

export type Mistake = {
  // What turns the valid document into the broken text, with positions in the document's code points.
  edits: Edit[]
  // Which form of the kind this is and where it sits, e.g. "the closing quote of a value, a comment follows".
  form: string
  reachable: Reachable
  // Indexes into the document of kept code points whose display kind is not scored, because every parser of the form
  // above shows them as something else, e.g. the comment that an open string swallows. samples.ts adds what follows
  // from the parser as it is and from the two texts, see `unscoredOf` there.
  unscoredKinds?: number[]
  // What the tokenizer must tell apart and cannot with the tables' 47 character classes, which have one class for
  // every code point from U+0080 up and for the ASCII characters that only strings and comments hold, e.g. `;`.
  needsClass?: string
  // True when another sensible repair of the broken text gives other scored labels to kept code points.
  debatable?: boolean
}

// One of the forms of a kind by its weight, or undefined when the document has a place for none of them, i.e. when
// every weight is 0.
export function drawForm<Form>(random: Random, forms: readonly (readonly [form: Form, weight: number])[]): Form | undefined {
  return forms.some(([, weight]) => weight > 0) ? random.weighted(forms) : undefined
}

export type KindOptions = {
  // A form that a caller asks for, e.g. 'every' for every entry of the text.
  scope?: string
}

export type KindDefinition = {
  name: string
  family: Family
  // How often the kind is drawn, relative to the other kinds' weights: 3 for what people do most, 1 for what is rare.
  weight: number
  // One line for the README's table.
  description: string
  // A short valid text and the broken text that the mistake makes of it, for the README's table. check.ts verifies
  // that the first is valid and that the tables reject the second.
  meant: string
  example: string
  // For the README's table: which code points of the example are kept, which stand for another, which are added.
  alignment: string
  // For the README's table: whether a parser of the form above can show every code point right after the mistake, or
  // what stands in the way.
  reachable: string
  // The most code points the kind adds, so that the document is made that much shorter than the capacity.
  margin?: number
  // False for a kind that changes the whole text, or text that another kind may sit in: such a kind is alone in its sample.
  pairs?: boolean
  apply: (random: Random, scanned: Scan, options?: KindOptions) => Mistake | undefined
}
