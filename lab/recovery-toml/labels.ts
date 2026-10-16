// The labels of a valid TOML text: for every code point, what it is shown as, the nesting depth after it, and the
// innermost open container after it. A broken text's code point gets the label of its counterpart in the valid text
// that its author meant, see samples.ts.
//
// All three values come from the reference labeler in reference.ts, a hand-written scanner with a real stack that
// reads nothing of the tables, so that a test can compare the labels with what the table parser gives.
import {containerNone, displayKind, kindLetters} from './kinds.ts'
import {labelReference} from './reference.ts'

// The label of a code point of a valid text.
export type ValidLabel = {
  // An index into kinds.ts's display kinds: 0 whitespace, 1 punctuation, 2 string, 3 escape, 4 number, 5 literal, 8 key,
  // 9 headerName, 10 comment.
  kind: number
  // The number of open arrays and inline tables after the code point, e.g. 1 after the [ of `a = [1]` and 0 after its ].
  // The brackets of a header open nothing, e.g. the depth is 0 after the [ of `[server]`.
  depth: number
  // The innermost open container after the code point: 0 none (containerNone), 1 an inline table (containerInlineTable),
  // 2 an array (containerArray).
  container: number
}
// The label of a code point of a broken text: the label of its counterpart in the valid text. A value that is not
// scored is `undefined`, see unscoredOf in samples.ts:
// - `kind`, e.g. for the `t` of a value `tiny"` that lost its opening quote, which the parser as it is reads as the
//   start of `true` before it reports its first error.
// - `depth` and `container`, always both, e.g. for the line feed after an array whose `]` the damage removed: the
//   array is closed in the original, and nothing in the broken text has closed it yet.
export type Label = {
  kind: number | undefined
  depth: number | undefined
  container: number | undefined
}

// The labels of a valid text, one per code point. Throws when the reference labeler rejects the text.
export function labelsOfValidText(text: string): ValidLabel[] {
  const reference = labelReference(text)
  if (!reference.valid) throw new Error(`labels are only defined for a valid text, and the reference rejects ${JSON.stringify(text)} at ${reference.position}: ${reference.reason}`)
  return reference.labels
}

// The depth and the container after every code point of a valid TOML text, as two arrays. lab/recovery-parser/labels.ts
// has a scan of its own for them. In TOML a `[` opens an array or a header by where it stands, so the scan here is the
// reference labeler's, which keeps a real stack.
export function scanNesting(codePoints: readonly string[]) {
  const labels = labelsOfValidText(codePoints.join(''))
  return {depth: labels.map(label => label.depth), container: labels.map(label => label.container)}
}

// The tokens of a valid TOML text, one letter each: the punctuation marks as they are ([ ] { } = . ,), k for a key or
// for one part of a dotted key, h for one part of a header's name, s for a string, and n for a number, a date, a time
// or a literal. White space, line ends and comments are left out. Two documents with the same letters differ only in
// what their keys, strings and numbers hold, in their comments and in their layout, e.g. `port = 8080 # default` and
// `retries=3` are both `k=n`, and `[server]⏎host = "a"` and `[ database ]⏎⏎url = 'b'` are both `[h]k=s`.
//
// A date and a time with a space between them are two runs of code points that are shown as numbers, so they give `nn`.
export function tokenSequenceOf(text: string): string {
  const codePoints = Array.from(text)
  const labels = labelsOfValidText(text)
  let tokens = ''
  // The letter of the token that the code point before belongs to, or '' between two tokens.
  let openToken = ''
  for (let index = 0; index < codePoints.length; index++) {
    const kind = labels[index]!.kind
    // An escape is a part of the string or of the key around it.
    if (kind === displayKind.escape) continue
    if (kind === displayKind.whitespace || kind === displayKind.comment) {
      openToken = ''
    } else if (kind === displayKind.punctuation) {
      tokens += codePoints[index]
      openToken = ''
    } else {
      const letter = kind === displayKind.key ? 'k' : kind === displayKind.headerName ? 'h' : kind === displayKind.string ? 's' : 'n'
      if (letter !== openToken) tokens += letter
      openToken = letter
    }
  }
  return tokens
}

export {containerNone, displayKind, kindLetters}
