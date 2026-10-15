// What a kind of damage is, and what applying one returns.
import type {Layout, Style, Template} from '../documents.ts'
import type {Edit} from '../edits.ts'
import type {Random} from '../random.ts'
import type {Scan} from '../scan.ts'

// Whether a parser can give every scored label of a sample. The parser meant here reads one code point at a time from
// left to right, with a state, the depth and the kinds of the open containers, and it reads valid JSON exactly as the
// highlighter does, so up to the highlighter's first error it gives what the highlighter gives. It may tell any two
// characters apart and correct its depth: what the highlighter's own loop and its 33 character classes cannot do is in
// the sample's needsClass, needsNestingFix and needsDisplayFix.
// - 'yes': some such parser can, in any layout. The rule it follows may contradict the rule that another sample needs,
//   see `contradictions`.
// - 'line rule': only a parser that takes a line feed inside a token as the token's end, e.g. "a string that is still
//   open at a line feed ends there".
// - 'no': no such parser can: a later character decides what an earlier one is, or the text reads as another valid
//   continuation, or the rule that would label it contradicts one that far more texts need.
export type Reachable = 'yes' | 'line rule' | 'no'
export const reachableOrder: readonly Reachable[] = ['no', 'line rule', 'yes']
export const leastReachable = (flags: readonly Reachable[]): Reachable => reachableOrder.find(flag => flags.includes(flag)) ?? 'yes'

// Pairs of rules that exclude each other. A sample that needs one rule of a pair is labeled right by some parser, and
// no single parser labels the samples of both sides right. A sample's needsRules lists the rules it needs.
export const contradictions = [
  // {"name": "tiny-gl<line feed>  "private": true}, where a string is half typed, against {"msg": "line 1<line feed>line 2"}.
  ['a string that is open at a line feed ends there', 'a line feed inside a string is content'],
  // {"strict": true, "tar" "license": "MIT"}, where the key "tar" is half typed, against {"port" "8080"}, where the colon is missing.
  ['a string after a key is the next key', 'a string after a key is that key\'s value'],
  // {"point": [59.91, 10.75}}, where } stands for ], against {"tags": ["ops", "beta"}, where ] is missing.
  ['a closer of the other kind closes one container', 'a closer of the other kind closes two containers'],
  // {"id": 1}, {"id": 2}, which is two records, against {"name": "Ada"}, "active": true}, where the first } is one too many.
  ['a comma after the top-level value is skipped', 'a comma after the top-level value opens the value again'],
] as const
export type Rule = typeof contradictions[number][number]
export const rules: readonly Rule[] = contradictions.flat()

// The flag of a sample from the flags and the rules of its kinds: the least of the flags, and 'no' when the kinds need
// both rules of a pair that exclude each other, e.g. a half-typed string and a raw line feed inside another string.
export function settleReachable(flags: readonly Reachable[], needed: readonly Rule[]): Reachable {
  if (contradictions.some(([left, right]) => needed.includes(left) && needed.includes(right))) return 'no'
  return leastReachable(flags)
}

export const families = [
  // The text is the original without what isn't typed yet.
  'half typed',
  // A wrong key press: a key hit twice, the key next to the right one, two keys in the wrong order.
  'slip',
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
  // samples.ts adds what follows from the parser as it is, see `unscoredOf` there.
  unscoredKinds?: number[]
  // The rules of `contradictions` that a parser needs for this damage.
  needsRules?: Rule[]
  // What the tokenizer must tell apart and cannot with the highlighter's 33 character classes, which lump most
  // characters with letters, e.g. the apostrophe as a quote.
  needsClass?: string
  // A second class of that sort, when one damage needs two, e.g. the backtick as a quote in a text that also has
  // strings in single quotes.
  alsoNeedsClass?: string
  // True when another sensible repair of the broken text gives other scored labels to kept code points.
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
  // How often the kind is drawn among samples with one kind of damage, relative to the other kinds' weights.
  weight: number
  // Where such a text comes from: a file that a person edits by hand, the output of a program or a model, or either.
  // Two unrelated kinds share a text only when their origins fit, e.g. no marker line of a merge conflict in a log line.
  origin: 'file' | 'output' | 'either'
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
