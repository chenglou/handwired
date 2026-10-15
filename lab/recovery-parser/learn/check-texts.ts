// Texts for the checks, made here without the dataset's generators: valid JSON texts, among them texts with 16 levels
// and texts of exactly 512 code points, and broken texts, among them texts that are too long or too deep.
import type {Random} from '../random.ts'
import {capacity, maximumDepth} from '../table-parser.ts'

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
