// Slips of the finger: a misspelled literal, the key next to the right one, a key hit twice, a stray letter between two
// tokens, two keys in the wrong order. The text is complete, unlike a half-typed one, and one or two characters of it
// are wrong.
import {type Edit, insertAt, removeRange, replaceOneForOne} from '../edits.ts'
import type {Random} from '../random.ts'
import {type Scan, lastOnLine} from '../scan.ts'
import type {Damage, KindDefinition} from './types.ts'

// The letters next to a letter on the same row of a keyboard.
const keyRows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
function neighborOf(random: Random, letter: string) {
  const row = keyRows.find(letters => letters.includes(letter))
  if (row === undefined) return undefined
  const place = row.indexOf(letter)
  return random.pick([row[place - 1], row[place + 1]].filter(neighbor => neighbor !== undefined))
}

function typingSlip(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const members = scanned.entries.filter(entry => entry.key !== null)
  const withComma = scanned.entries.filter(entry => entry.commaAfter !== -1)
  // A key whose colon comes right after its closing quote, and a string value whose comma does.
  const keysBeforeColon = members.filter(entry => entry.colon === entry.key!.end)
  const stringsBeforeComma = withComma.filter(entry => entry.value.type === 'string' && entry.commaAfter === entry.value.end)
  const form = random.weighted([
    ['misspelled literal', scanned.literals.length > 0 ? 30 : 0], ['neighbor key', members.length + withComma.length > 0 ? 20 : 0], ['key hit twice', members.length + scanned.containers.length > 0 ? 15 : 0],
    ['stray letter', withComma.length + scanned.containers.length > 0 ? 20 : 0], ['wrong order', keysBeforeColon.length + stringsBeforeComma.length > 0 ? 15 : 0],
  ] as const)
  switch (form) {
    case 'misspelled literal': {
      if (scanned.literals.length === 0) return undefined
      const literal = random.pick(scanned.literals)
      const word = codePoints.slice(literal.start, literal.end)
      const written = (edits: Edit[], text: string, how: string): Damage => ({edits, form: `${text} for ${word.join('')}, ${how}`, reachable: 'yes'})
      const way = random.weighted([['swapped', 45], ['doubled', 20], ['dropped', 20], ['neighbor', 15]] as const)
      if (way === 'swapped') {
        // Two letters next to each other in the wrong order, e.g. ture. Each stands for the letter in its place.
        const places = word.map((_, index) => index).filter(index => index < word.length - 1 && word[index] !== word[index + 1])
        const place = random.pick(places)
        const text = [...word.slice(0, place), word[place + 1]!, word[place]!, ...word.slice(place + 2)].join('')
        return written([replaceOneForOne(literal.start + place, word[place + 1]!), replaceOneForOne(literal.start + place + 1, word[place]!)], text, 'two letters swapped')
      }
      if (way === 'doubled') {
        const place = random.integer(0, word.length - 1)
        return written([insertAt(literal.start + place + 1, word[place]!)], [...word.slice(0, place + 1), word[place]!, ...word.slice(place + 1)].join(''), 'a letter twice')
      }
      if (way === 'dropped') {
        // A letter in the middle is missing, e.g. tue. Without its last letter the word would be a half-typed one,
        // which is what null without one of its two l is, so that letter stays.
        const place = random.pick(word.map((_, index) => index).filter(index => index >= 1 && index <= word.length - 2 && word[index] !== word[index + 1]))
        return written([removeRange(literal.start + place, literal.start + place + 1)], [...word.slice(0, place), ...word.slice(place + 1)].join(''), 'a letter missing')
      }
      const place = random.integer(1, word.length - 1)
      const wrong = neighborOf(random, word[place]!)
      if (wrong === undefined) return undefined
      return written([replaceOneForOne(literal.start + place, wrong)], [...word.slice(0, place), wrong, ...word.slice(place + 1)].join(''), 'the key next to the right one')
    }
    case 'neighbor key': {
      // ; is : without Shift, and . and m are next to the comma. The wrong character stands for the right one.
      const forColon = members.length > 0 && (withComma.length === 0 || random.chance(0.5))
      // ; and m are in the class of most letters, so the tables need a class to show them as punctuation.
      if (forColon) return {edits: [replaceOneForOne(random.pick(members).colon, ';')], form: '; for a colon', reachable: 'yes', needsClass: '; in the place of a colon'}
      if (withComma.length === 0) return undefined
      const wrong = random.pick(['.', 'm'])
      return {edits: [replaceOneForOne(random.pick(withComma).commaAfter, wrong)], form: `${wrong} for a comma`, reachable: 'yes', ...(wrong === 'm' ? {needsClass: 'm in the place of a comma'} : {})}
    }
    case 'key hit twice': {
      // A colon twice, or an opening bracket twice. Commas, quotes and closing brackets that come twice are kinds of their own.
      if (members.length > 0 && (scanned.containers.length === 0 || random.chance(0.6))) return {edits: [insertAt(random.pick(members).colon + 1, ':')], form: 'a colon twice', reachable: 'yes'}
      if (scanned.containers.length === 0) return undefined
      const container = random.pick(scanned.containers)
      const bracket = codePoints[container.open]!
      return {
        edits: [insertAt(container.open + 1, bracket)], form: `${bracket} twice`,
        // The second bracket opens a container that nothing closes, and the text reads as one whose last closer is missing.
        reachable: 'no', debatable: true,
      }
    }
    case 'stray letter': {
      // One character between two tokens, e.g. the s of a Ctrl+S that missed. None of them starts a token.
      const letter = random.pick(['s', 's', 's', 'w', 'q', 'x', 'v', 'z', 'a', 'd', 'j', 'k', ';', '\'', '\\'])
      const place = random.weighted([['after a comma', withComma.length > 0 ? 70 : 0], ['after an opening bracket', scanned.containers.length > 0 ? 15 : 0], ['before a closing bracket', scanned.containers.length > 0 ? 15 : 0]] as const)
      if (place === 'after a comma') {
        if (withComma.length === 0) return undefined
        // Mostly at the end of a line, where the cursor is after typing an entry.
        const atLineEnds = withComma.filter(entry => lastOnLine(codePoints, entry.commaAfter + 1))
        const entry = random.pick(atLineEnds.length > 0 && random.chance(0.7) ? atLineEnds : withComma)
        return {edits: [insertAt(entry.commaAfter + 1, letter)], form: `${letter} after a comma`, reachable: 'yes'}
      }
      if (scanned.containers.length === 0) return undefined
      const container = random.pick(scanned.containers)
      return {edits: [insertAt(place === 'after an opening bracket' ? container.open + 1 : container.close, letter)], form: `${letter} ${place}`, reachable: 'yes'}
    }
    case 'wrong order': {
      // The closing quote of a key and its colon, or the closing quote of a value and its comma, in the wrong order,
      // e.g. "name:" "Ada". The quote is the kept one, the colon inside the string is added, and the colon after it is missing.
      const ofKey = keysBeforeColon.length > 0 && (stringsBeforeComma.length === 0 || random.chance(0.6))
      if (ofKey) {
        const entry = random.pick(keysBeforeColon)
        return {
          edits: [insertAt(entry.key!.end - 1, ':'), removeRange(entry.colon, entry.colon + 1)], form: `a key's closing quote and its colon, before a ${entry.value.container === null ? entry.value.type : 'container'}`, reachable: 'yes',
          // What is left is a key and a value without a colon between them.
          ...(entry.value.type === 'string' ? {needsRules: ['a string after a key is that key\'s value']} : {}),
        }
      }
      if (stringsBeforeComma.length === 0) return undefined
      const entry = random.pick(stringsBeforeComma)
      return {edits: [insertAt(entry.value.end - 1, ','), removeRange(entry.commaAfter, entry.commaAfter + 1)], form: 'a value\'s closing quote and its comma', reachable: 'yes'}
    }
  }
}

export const slipKinds: KindDefinition[] = [
  {
    name: 'typingSlip', family: 'slip', origin: 'file', weight: 1.2,
    example: '{"debug": ture, "port"; 8080}',
    reachable: 'yes: a wrong letter inside a literal goes on with the literal, a wrong character in the place of a colon or a comma stands for it, and a stray character between two tokens is skipped. no for an opening bracket that comes twice, which reads as a container whose closer is missing. The tables need a class for ; and for m to show them as punctuation',
    margin: 2,
    apply: typingSlip,
  },
]
