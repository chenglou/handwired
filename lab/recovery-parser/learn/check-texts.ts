// Texts for the checks, made here without the dataset's generators: valid JSON texts, among them texts with 16 levels
// and texts of exactly 512 code points, and broken texts, among them texts that are too long or too deep.
import type {Random} from '../random.ts'
import {capacity, maximumDepth} from '../table-parser.ts'
import type {AddedClass} from './recovery-tables.ts'

// The classes that the checks add. The first five are taken out of the class `other`, the class of most letters: the
// apostrophe, the two curly double quotes, the no-break space, the signs = # * and the round brackets. The dataset's
// broken texts hold them. The last three are taken out of other classes, so that the checks also run the code that
// reads which class of today's an added class's code points have: the digits 7, 8 and 9 out of `digit`, the carriage
// return out of `tabOrCarriageReturn`, and the 7 once more, out of the added class of the digits 7 to 9. Valid JSON
// reads a digit and a carriage return between tokens, where a code point of the class `other` is an error, so a
// check fails when the code takes such a class for one that came out of `other`.
// textWithAddedClasses makes texts with all of them, inside strings and between tokens.
export const classesOfTheChecks: AddedClass[] = [
  {name: 'apostrophe', codePoints: [0x27]}, {name: 'curlyQuote', codePoints: [0x201c, 0x201d]}, {name: 'noBreakSpace', codePoints: [0xa0]},
  {name: 'sign', codePoints: [0x3d, 0x23, 0x2a]}, {name: 'roundBracket', codePoints: [0x28, 0x29]},
  {name: 'highDigit', codePoints: [0x37, 0x38, 0x39]}, {name: 'carriageReturn', codePoints: [0x0d]}, {name: 'seven', codePoints: [0x37]},
]

const pieces = ['a', 'b', 'e', 'E', 'f', 'l', 'n', 'r', 's', 't', 'u', 'c', 'D', 'x', 'z', ' ', '/', '{', '}', '[', ']', ':', ',', '-', '+', '.', '0', '7', '\'', 'é', '東', '😀', '\u007f', ' ']
const escapes = ['\\"', '\\\\', '\\/', '\\b', '\\f', '\\n', '\\r', '\\t']

const hexDigits = Array.from('0123456789abcdefABCDEF')
function randomString(random: Random) {
  let content = ''
  const length = random.integer(0, 12)
  for (let index = 0; index < length; index++) {
    const choice = random.next()
    content += choice < 0.1 ? random.pick(escapes) : choice < 0.15 ? `\\u${random.pick(hexDigits)}${random.pick(hexDigits)}${random.pick(hexDigits)}${random.pick(hexDigits)}` : random.pick(pieces)
  }
  return `"${content}"`
}

function randomNumber(random: Random) {
  let text = random.chance(0.3) ? '-' : ''
  text += random.chance(0.3) ? '0' : `${random.integer(1, 9)}${random.chance(0.5) ? String(random.integer(0, 9999)) : ''}`
  if (random.chance(0.3)) text += `.${random.integer(0, 999)}`
  if (random.chance(0.2)) text += `${random.pick(['e', 'E'])}${random.pick(['', '+', '-'])}${random.integer(0, 99)}`
  return text
}

const gap = (random: Random) => random.chance(0.6) ? '' : random.pick([' ', '\n', '\t', '\r\n', '  ', '\n    '])

// A JSON value as text, with white space between its tokens. `levels` is how many levels of containers it may add.
function randomValue(random: Random, levels: number): string {
  const choice = levels <= 0 ? random.integer(0, 2) : random.integer(0, 5)
  if (choice === 0) return randomString(random)
  if (choice === 1) return randomNumber(random)
  if (choice === 2) return random.pick(['true', 'false', 'null'])
  const count = random.integer(0, 4)
  const members: string[] = []
  for (let index = 0; index < count; index++) {
    const value = randomValue(random, levels - 1)
    members.push(choice === 3 ? `${gap(random)}${value}${gap(random)}` : `${gap(random)}${randomString(random)}${gap(random)}:${gap(random)}${value}${gap(random)}`)
  }
  const inside = members.length === 0 ? gap(random) : members.join(',')
  return choice === 3 ? `[${inside}]` : `{${inside}}`
}

const codePointLength = (text: string) => Array.from(text).length

// A valid JSON text of at most 512 code points and at most 16 levels.
export function validText(random: Random): string {
  for (;;) {
    const text = `${gap(random)}${randomValue(random, random.integer(0, 5))}${gap(random)}`
    if (codePointLength(text) <= capacity) return text
  }
}

// A valid JSON text with exactly `depth` levels of containers, the innermost one with a few values or none.
export function validTextOfDepth(random: Random, depth: number): string {
  for (;;) {
    let text = randomValue(random, 1)
    while (!text.startsWith('[') && !text.startsWith('{')) text = randomValue(random, 1)
    for (let level = 1; level < depth; level++) {
      const sibling = random.chance(0.3) ? `${randomValue(random, 0)}${gap(random)},${gap(random)}` : ''
      text = random.chance(0.5) ? `[${gap(random)}${sibling}${text}${gap(random)}]` : `{${gap(random)}${sibling === '' ? '' : `${randomString(random)}:${sibling}`}${randomString(random)}:${gap(random)}${text}${gap(random)}}`
    }
    if (codePointLength(text) <= capacity) return text
  }
}

// A valid JSON text with exactly `depth` levels of containers in which members follow the nested container, e.g.
// [[[1], 2], {"a": 3}]: after the closing bracket of a nested container the text goes on inside the container around
// it, with a comma and one more value or member. validTextOfDepth only puts members before the nested container, so
// after its innermost container closes, nothing but closing brackets and white space follows. At each level a member
// follows with a probability of 0.7, and the text has such a member at one level at least.
export function validTextOfDepthWithMembersAfter(random: Random, depth: number): string {
  for (;;) {
    let text = randomValue(random, 1)
    while (!text.startsWith('[') && !text.startsWith('{')) text = randomValue(random, 1)
    let levelsWithAMemberAfter = 0
    for (let level = 1; level < depth; level++) {
      const inArray = random.chance(0.5)
      let after = ''
      if (random.chance(0.7)) {
        levelsWithAMemberAfter++
        after = `,${gap(random)}${inArray ? '' : `${randomString(random)}${gap(random)}:${gap(random)}`}${randomValue(random, 0)}`
      }
      text = inArray ? `[${gap(random)}${text}${gap(random)}${after}${gap(random)}]` : `{${gap(random)}${randomString(random)}:${gap(random)}${text}${gap(random)}${after}${gap(random)}}`
    }
    if (levelsWithAMemberAfter > 0 && codePointLength(text) <= capacity) return text
  }
}

// A valid JSON text of exactly `length` code points: a shorter one in an array, next to a string that fills the rest,
// or followed by white space.
export function validTextOfLength(random: Random, length: number): string {
  for (;;) {
    const text = validText(random).trim()
    const missing = length - codePointLength(text)
    if (missing >= 5 && random.chance(0.5)) return `[${text},"${'x'.repeat(missing - 5)}"]`
    if (missing >= 0) return `${text}${random.pick([' ', '\n']).repeat(missing)}`
  }
}

const insertions = ['"', '\\', '{', '}', '[', ']', ':', ',', '-', '+', '.', '0', '7', 'e', 'E', 't', 'n', 'f', 'u', 'x', '\'', ' ', '\n', '\t', '\u0001', '/', '#', 'é', '😀']

// A text made from a valid one by one to three edits: a code point removed, added, replaced, or the text cut. Most
// are broken, and some are still valid.
export function editedText(random: Random): string {
  const codePoints = Array.from(validText(random))
  const edits = random.integer(1, 3)
  for (let edit = 0; edit < edits; edit++) {
    const at = random.integer(0, Math.max(0, codePoints.length - 1))
    const choice = random.integer(0, 3)
    if (choice === 0) codePoints.splice(at, 1)
    else if (choice === 1) codePoints.splice(at, 0, random.pick(insertions))
    else if (choice === 2) codePoints.splice(at, 1, random.pick(insertions))
    else codePoints.length = at
  }
  return codePoints.slice(0, capacity).join('')
}

// A text with code points of the classes that the checks add: a valid text in which one to four code points are
// replaced by such a code point, or get one before them. With a code point that has the class `other` today, the
// text stays valid inside a string, e.g. "it's", and breaks between tokens, e.g. [1,'2]. A digit can also keep a
// number valid, e.g. 17, and a carriage return is white space between tokens and an error inside a string.
const addedCodePoints = classesOfTheChecks.flatMap(added => added.codePoints.map(codePoint => String.fromCodePoint(codePoint)))
export function textWithAddedClasses(random: Random): string {
  const codePoints = Array.from(validText(random))
  const edits = random.integer(1, 4)
  for (let edit = 0; edit < edits; edit++) codePoints.splice(random.integer(0, Math.max(0, codePoints.length - 1)), random.integer(0, 1), random.pick(addedCodePoints))
  return codePoints.slice(0, capacity).join('')
}

// A text of random JSON punctuation, letters and white space.
export function randomSoup(random: Random): string {
  let text = ''
  const length = random.integer(0, 60)
  for (let index = 0; index < length; index++) text += random.pick(insertions)
  return text
}

// A valid JSON text of more than 512 code points, and one with more than 16 levels. Today's parser reports the first
// as tooLong and the second as tooDeep.
export const tooLongText = (random: Random) => validTextOfLength(random, capacity + random.integer(1, 90))
export const tooDeepText = (random: Random) => validTextOfDepth(random, maximumDepth + random.integer(1, 3))
// A valid JSON text with more than 16 levels in which members follow the nested containers.
export const tooDeepTextWithMembersAfter = (random: Random) => validTextOfDepthWithMembersAfter(random, maximumDepth + random.integer(1, 3))

export type CheckText = {text: string, made: 'valid' | 'valid, 16 levels' | 'valid, 512 code points' | 'edited' | 'soup' | 'too long' | 'too deep'}

// `count` texts in fixed shares: half of them valid, of which a tenth each with 16 levels and with 512 code points.
export function checkTexts(random: Random, count: number): CheckText[] {
  const texts: CheckText[] = []
  for (let index = 0; index < count; index++) {
    const turn = index % 20
    if (turn === 0) texts.push({text: validTextOfDepth(random, maximumDepth), made: 'valid, 16 levels'})
    else if (turn === 1) texts.push({text: validTextOfLength(random, capacity), made: 'valid, 512 code points'})
    else if (turn < 10) texts.push({text: validText(random), made: 'valid'})
    else if (turn < 16) texts.push({text: editedText(random), made: 'edited'})
    else if (turn < 18) texts.push({text: randomSoup(random), made: 'soup'})
    else if (turn === 18) texts.push({text: tooLongText(random), made: 'too long'})
    else texts.push({text: tooDeepText(random), made: 'too deep'})
  }
  return texts
}
