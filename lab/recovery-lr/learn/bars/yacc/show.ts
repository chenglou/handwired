// A sample with a parser's output beside the wanted labels, as text for a reader. The form is the one of
// ../../../dump.ts, with a row of the parser under every row of the labels:
//   broken  let x = (1 + in y⏎
//   error                ^        the first error: from here on the kept code points are scored
//   kind    kkkwdwpwplwowkkwnw    the label: one letter per code point, see kindLetters in ../../../labels.ts
//    bar    kkkwdwpwplwowEEwEw    what the parser shows, E for an error
//   depth   111111122222222222    the last digit of the depth
//    bar    111111122222222222
//   in      llllll==((((((((((    the container, see containerLetters
//    bar    llllll==((((((((((
//   wrong                ^^ ^     the scored code points where one of the three is not the label's
// A code point that an edit added has no label and shows + in the rows of the labels.
import {onOneLine} from '../../../dump.ts'
import {containerLetters, kindLetters} from '../../../labels.ts'
import {type Sample, isScored} from '../../../sample.ts'
import type {ParserOutput} from '../../score.ts'

// Per code point of the sample's broken text: the token that holds it.
function tokenOfCodePoint(sample: Sample): Int32Array {
  const tokenAt = new Int32Array(sample.codePoints.length)
  for (let token = 0; token < sample.tokens.count; token++) tokenAt.fill(token, sample.tokens.start[token], sample.tokens.start[token]! + sample.tokens.length[token]!)
  return tokenAt
}

// How many scored code points of the sample the output has right in all three.
export function allThreeRightOf(sample: Sample, output: ParserOutput): number {
  const tokenAt = tokenOfCodePoint(sample)
  let right = 0
  for (let position = sample.firstErrorPosition; position < sample.codePoints.length; position++) {
    const token = tokenAt[position]!
    if (isScored(sample, position) && output.kind[token] === sample.labelKind[position] && output.depth[token] === sample.labelDepth[position] && output.container[token] === sample.labelContainer[position]) right++
  }
  return right
}

export function showOutput(sample: Sample, output: ParserOutput, title: string): string {
  const tokenAt = tokenOfCodePoint(sample)
  const places = Array.from(sample.codePoints, (_, position) => position)
  const label = (letterOf: (position: number) => string): string => places.map(position => sample.alignment[position] === -1 ? '+' : letterOf(position)).join('')
  const shown = (letterOf: (token: number) => string): string => places.map(position => letterOf(tokenAt[position]!)).join('')
  const wrong = places.map(position => {
    const token = tokenAt[position]!
    return isScored(sample, position) && (output.kind[token] !== sample.labelKind[position] || output.depth[token] !== sample.labelDepth[position] || output.container[token] !== sample.labelContainer[position]) ? '^' : ' '
  }).join('')
  const right = allThreeRightOf(sample, output)
  return [
    `${title}  ${sample.id}  edits: ${sample.edits.join(', ')}  ${right} of ${sample.scored} scored code points right in all three`,
    `meant   ${onOneLine(sample.original)}`,
    `broken  ${onOneLine(sample.broken)}`,
    `error   ${' '.repeat(sample.firstErrorPosition)}^`,
    `kind    ${label(position => kindLetters[sample.labelKind[position]!]!)}`,
    ` bar    ${shown(token => kindLetters[output.kind[token]!]!)}`,
    `depth   ${label(position => String(sample.labelDepth[position]! % 10))}`,
    ` bar    ${shown(token => String(output.depth[token]! % 10))}`,
    `in      ${label(position => containerLetters[sample.labelContainer[position]!]!)}`,
    ` bar    ${shown(token => containerLetters[output.container[token]!]!)}`,
    `wrong   ${wrong.trimEnd()}`,
  ].join('\n')
}
