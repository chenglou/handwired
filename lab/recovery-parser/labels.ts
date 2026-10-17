// The labels of a valid JSON text: for every code point, what it is shown as, the nesting depth after it, and the
// innermost open container after it. A broken text's code point gets the label of its counterpart in the valid text
// that its author meant, see samples.ts.
//
// The display kind comes from the plain JavaScript reference highlighter. The depth and the container come from a scan
// of this file with a real stack, which reads neither the reference nor the tables, so that the test can compare it
// with the table parser's running totals.
import {displayKind} from '../../src/json-search/highlighter/kinds.ts'
import {highlightReference} from '../../tests/json-search/highlighter/reference.ts'
import {containerArray, containerNone, containerObject} from './table-parser.ts'

// The label of a code point of a valid text.
export type ValidLabel = {
  // An index into kinds.ts's display kinds: 0 whitespace, 1 punctuation, 2 string, 3 escape, 4 number, 5 literal, 8 key.
  kind: number
  // The number of open containers after the code point, e.g. 1 after the { of {"a": 1} and 0 after its }.
  depth: number
  // The innermost open container after the code point: 0 none (containerNone), 1 an object (containerObject), 2 an
  // array (containerArray).
  container: number
}
// The label of a code point of a broken text: the label of its counterpart in the valid text. A value that is not
// scored is `undefined`, because no parser that reads valid JSON as the highlighter does can give it at that place:
// - `kind`, e.g. for a quote inside a string that lost its backslash, whose counterpart is part of an escape.
// - `depth` and `container`, always both, e.g. for the white space after a closing bracket that the damage removed:
//   the container is closed in the original, and nothing in the broken text has closed it yet.
export type Label = {
  kind: number | undefined
  depth: number | undefined
  container: number | undefined
}

// One letter per display kind, for dumps: whitespace, punctuation, string, escape, number, literal, Error, pastEnd, key.
export const kindLetters = 'wpsenlE.k'

// The depth and the container after every code point of a valid JSON text.
export function scanNesting(codePoints: readonly string[]) {
  const depth: number[] = []
  const container: number[] = []
  const stack: number[] = []
  let inString = false
  for (let index = 0; index < codePoints.length; index++) {
    const character = codePoints[index]!
    if (inString) {
      // A backslash takes the next code point with it, e.g. the quote of \".
      if (character === '\\') {
        depth.push(stack.length, stack.length)
        container.push(stack.at(-1) ?? containerNone, stack.at(-1) ?? containerNone)
        index++
        continue
      }
      if (character === '"') inString = false
    } else if (character === '"') {
      inString = true
    } else if (character === '{') {
      stack.push(containerObject)
    } else if (character === '[') {
      stack.push(containerArray)
    } else if (character === '}' || character === ']') {
      stack.pop()
    }
    depth.push(stack.length)
    container.push(stack.at(-1) ?? containerNone)
  }
  return {depth, container}
}

// The tokens of a valid JSON text as the grammar table reads them, one letter each: { } [ ] : , and s for a string, n
// for a number or a literal. Two documents with the same letters are the same text to the grammar, whatever their
// strings and numbers hold and however they are laid out, e.g. `{"id": 7}` and `{ "port":8080 }` are both `{s:n}`.
export function tokenSequenceOf(text: string): string {
  let tokens = ''
  let index = 0
  while (index < text.length) {
    const character = text[index]!
    if (character === '"') {
      index++
      while (text[index] !== '"') index += text[index] === '\\' ? 2 : 1
      index++
      tokens += 's'
    } else if ('{}[]:,'.includes(character)) {
      tokens += character
      index++
    } else if (character === ' ' || character === '\t' || character === '\n' || character === '\r') {
      index++
    } else {
      // A number or a literal runs up to the next white space or punctuation mark.
      while (index < text.length && !' \t\n\r{}[]:,"'.includes(text[index]!)) index++
      tokens += 'n'
    }
  }
  return tokens
}

// The labels of a valid text, one per code point. Throws when the reference highlighter rejects the text.
export function labelsOfValidText(text: string): ValidLabel[] {
  const codePoints = Array.from(text)
  const reference = highlightReference(text)
  if (reference.valid !== 1) throw new Error(`labels are only defined for a valid text, and the reference rejects ${JSON.stringify(text)}`)
  const {depth, container} = scanNesting(codePoints)
  return codePoints.map((_, index) => ({kind: reference.displayKinds[index]!, depth: depth[index]!, container: container[index]!}))
}

export {displayKind}
