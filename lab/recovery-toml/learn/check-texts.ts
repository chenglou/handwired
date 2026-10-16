// Texts for the checks of learn/, made without the dataset's generators: valid TOML texts, among them texts with 16
// levels and texts of exactly 512 code points, and broken texts, among them texts that are too long or too deep. The
// valid documents and the random edits are the ones of ../check-texts.ts, which the checks of the tables use.
import {damagedText, validDocument} from '../check-texts.ts'
import {capacity, maximumDepth} from '../table-parser.ts'
import type {Random} from './random.ts'
import type {AddedClass} from './recovery-tables.ts'

// The classes that the checks add. The first five are taken out of the class `other`, the class of every code point
// that only strings and comments hold: the semicolon, the signs ! and /, the two curly double quotes, the no-break
// space and the round brackets. The last three are taken out of other classes, so that the checks also run the code
// that reads which class of today's an added class's code points have: the letters c and d out of `otherHexLetter`,
// the 9 out of `digit8Or9`, and the d once more, out of the added class of c and d. Valid TOML reads a digit and a
// letter between tokens, where a code point of the class `other` is an error, so a check fails when the code takes
// such a class for one that came out of `other`.
// textWithAddedClasses makes texts with all of them, inside strings and between tokens.
export const classesOfTheChecks: AddedClass[] = [
  {name: 'semicolon', codePoints: [0x3b]}, {name: 'exclamationOrSlash', codePoints: [0x21, 0x2f]}, {name: 'curlyQuote', codePoints: [0x201c, 0x201d]},
  {name: 'noBreakSpace', codePoints: [0xa0]}, {name: 'roundBracket', codePoints: [0x28, 0x29]},
  {name: 'letterCOrD', codePoints: [0x63, 0x64]}, {name: 'nine', codePoints: [0x39]}, {name: 'letterD', codePoints: [0x64]},
]

const seedOf = (random: Random) => random.integer(0, 2_000_000_000)
const codePointLength = (text: string) => Array.from(text).length

// A valid TOML document of at most 512 code points and at most 16 levels.
export const validText = (random: Random): string => validDocument(seedOf(random))

const scalars = ['1', '0', '-17', '3.14', '6.02e23', 'true', 'false', '"x"', '"two words"', '\'C:\\dir\'', '1979-05-27', '07:32:00', '0xFF', 'inf', '""']
// White space between the tokens of a value. A line end may only stand where the innermost container is an array.
const gap = (random: Random, inArray: boolean) => random.chance(0.6) ? '' : random.pick(inArray ? [' ', '\n', '\t', '\r\n', '  ', '\n    '] : [' ', '\t', '  '])

// A container without a container in it: an array or an inline table with up to three scalars.
function smallContainer(random: Random): string {
  const count = random.integer(0, 3)
  if (random.chance(0.5)) return `[${Array.from({length: count}, () => `${gap(random, true)}${random.pick(scalars)}${gap(random, true)}`).join(',')}]`
  return `{${Array.from({length: count}, (_, member) => `${gap(random, false)}k${member} = ${random.pick(scalars)}${gap(random, false)}`).join(',')}}`
}

// A few lines of keys and values around the line with the nested value.
const lineBefore = (random: Random) => random.chance(0.5) ? '' : random.pick(['title = "x"\n', '# a comment\n', '[server]\n', 'port = 8080\nhost = "localhost"\n', '\n'])
const lineAfter = (random: Random) => random.chance(0.5) ? '' : random.pick(['last = 1\n', '# the end\n', '[[rows]]\nid = 1\n', 'enabled = true', '\n\n'])

// A valid TOML text with a value of exactly `depth` levels of arrays and inline tables, the innermost one with a few
// scalars or none. With `membersAfter`, members follow the nested container at one level at least, e.g.
// `a = [[[1], 2], {k = 3}]`: after the closing bracket of a nested container the text goes on inside the container
// around it. Without it, a member only stands before the nested container, so nothing but closing brackets and white
// space follows the innermost container up to the end of the value.
export function validTextOfDepth(random: Random, depth: number, membersAfter = false): string {
  for (;;) {
    let text = smallContainer(random)
    let levelsWithAMemberAfter = 0
    for (let level = 1; level < depth; level++) {
      const inArray = random.chance(0.5)
      const scalar = random.pick(scalars)
      let before = ''
      let after = ''
      if (membersAfter && random.chance(0.7)) {
        levelsWithAMemberAfter++
        after = `,${gap(random, inArray)}${inArray ? '' : 'after = '}${scalar}`
      } else if (!membersAfter && random.chance(0.3)) {
        before = `${inArray ? '' : 'before = '}${scalar}${gap(random, inArray)},${gap(random, inArray)}`
      }
      text = inArray ? `[${gap(random, true)}${before}${text}${gap(random, true)}${after}${gap(random, true)}]` : `{${gap(random, false)}${before}nested = ${text}${gap(random, false)}${after}${gap(random, false)}}`
    }
    const document = `${lineBefore(random)}deep = ${text}\n${lineAfter(random)}`
    if ((!membersAfter || levelsWithAMemberAfter > 0) && codePointLength(document) <= capacity) return document
  }
}

// A valid TOML text of exactly `length` code points: a shorter document and a comment that fills the rest, or line
// feeds after it.
export function validTextOfLength(random: Random, length: number): string {
  for (;;) {
    const text = validText(random)
    const start = text === '' || text.endsWith('\n') ? text : `${text}\n`
    const missing = length - codePointLength(start)
    if (missing < 0) continue
    if (missing >= 2 && random.chance(0.5)) return `${start}# ${'x'.repeat(missing - 2)}`
    return `${start}${'\n'.repeat(missing)}`
  }
}

// A text made from a valid one by one to three edits of ../check-texts.ts: a code point or a piece removed, added,
// replaced, doubled or moved, lines removed, doubled or joined, or the text cut. Most are broken, and some are still valid.
export const editedText = (random: Random): string => damagedText(validText(random), seedOf(random))

// A text with code points of the classes that the checks add: a valid text in which one to four code points are
// replaced by such a code point, or get one before them. With a code point that has the class `other` today, the
// text stays valid inside a string, e.g. "a;b", and breaks between tokens, e.g. `a = 1;`. A 9, a c and a d can also
// keep a number or a key valid.
const addedCodePoints = classesOfTheChecks.flatMap(added => added.codePoints.map(codePoint => String.fromCodePoint(codePoint)))
export function textWithAddedClasses(random: Random): string {
  const codePoints = Array.from(validText(random))
  const edits = random.integer(1, 4)
  for (let edit = 0; edit < edits; edit++) codePoints.splice(random.integer(0, Math.max(0, codePoints.length - 1)), random.integer(0, 1), random.pick(addedCodePoints))
  return codePoints.slice(0, capacity).join('')
}

const soupPieces = ['"', '\'', '\\', '#', '=', '.', ',', '[', ']', '{', '}', ':', '+', '-', '_', '0', '1', '7', '9', 'e', 'E', 't', 'n', 'f', 'i', 'x', 'T', 'Z', ' ', '\n', '\t', '\r', '\u0001', ';', 'é', '😀']
// A text of random TOML punctuation, letters and white space.
export function randomSoup(random: Random): string {
  let text = ''
  const length = random.integer(0, 60)
  for (let index = 0; index < length; index++) text += random.pick(soupPieces)
  return text
}

// A valid TOML text of more than 512 code points, and ones with a value of more than 16 levels. Today's parser
// reports the first as tooLong and the others as tooDeep, at the 17th opening bracket.
export const tooLongText = (random: Random) => validTextOfLength(random, capacity + random.integer(1, 90))
export const tooDeepText = (random: Random) => validTextOfDepth(random, maximumDepth + random.integer(1, 3))
export const tooDeepTextWithMembersAfter = (random: Random) => validTextOfDepth(random, maximumDepth + random.integer(1, 3), true)

export type CheckText = {text: string, made: 'valid' | 'valid, 16 levels' | 'valid, 512 code points' | 'edited' | 'soup' | 'too long' | 'too deep'}

// `count` texts in fixed shares: half of them valid, of which a tenth each with 16 levels and with 512 code points.
export function checkTexts(random: Random, count: number): CheckText[] {
  const texts: CheckText[] = []
  for (let index = 0; index < count; index++) {
    const turn = index % 20
    if (turn === 0) texts.push({text: validTextOfDepth(random, maximumDepth, random.chance(0.5)), made: 'valid, 16 levels'})
    else if (turn === 1) texts.push({text: validTextOfLength(random, capacity), made: 'valid, 512 code points'})
    else if (turn < 10) texts.push({text: validText(random), made: 'valid'})
    else if (turn < 16) texts.push({text: editedText(random), made: 'edited'})
    else if (turn < 18) texts.push({text: randomSoup(random), made: 'soup'})
    else if (turn === 18) texts.push({text: tooLongText(random), made: 'too long'})
    else texts.push({text: random.chance(0.5) ? tooDeepText(random) : tooDeepTextWithMembersAfter(random), made: 'too deep'})
  }
  return texts
}
