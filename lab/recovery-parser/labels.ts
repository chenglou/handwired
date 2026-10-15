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

export type Label = {
  // An index into kinds.ts's display kinds, e.g. displayKind.key. `undefined` when the code point's display kind is not
  // scored, e.g. a quote inside a string that lost its backslash: its counterpart is part of an escape, which no reading
  // of the broken text shows. Its depth and container are scored as usual.
  kind: number | undefined
  // The number of open containers after the code point, e.g. 1 after the { of {"a": 1} and 0 after its }.
  depth: number
  // containerNone, containerObject or containerArray: the innermost open container after the code point.
  container: number
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

// The labels of a valid text, one per code point. Throws when the reference highlighter rejects the text.
export function labelsOfValidText(text: string): Label[] {
  const codePoints = Array.from(text)
  const reference = highlightReference(text)
  if (reference.valid !== 1) throw new Error(`labels are only defined for a valid text, and the reference rejects ${JSON.stringify(text)}`)
  const {depth, container} = scanNesting(codePoints)
  return codePoints.map((_, index) => ({kind: reference.displayKinds[index]!, depth: depth[index]!, container: container[index]!}))
}

export {displayKind}
