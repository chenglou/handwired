// Which damage of a written case the train data's damage could have made.
//
// The train data of this track is damaged by ten edits that know nothing of TOML, see ../../damage.ts: delete, insert,
// replace or swap a code point, delete, duplicate or copy a run of 2 to 20 code points, delete or duplicate a line, and
// cut the tail. A sample gets one to three of them. The cases of this set were written from what people and programs
// do to TOML. This file holds the two against each other: per damaged place of a case it gives the fewest edits that
// make the place, or says that no three edits do. kinds.txt records the answer per case, and README.md says how the
// line is drawn, under "What the damage is".
//
// A damaged place is what a repair changes between two kept code points: text of the broken payload that the document
// lacks, text of the document that the broken payload lacks, or both at once. A code point that stands in the place of
// another, e.g. `:` for `=`, is a place of its own. The edits that make a place:
// - deleteCodePoint: one code point is missing.
// - deleteLine: one whole line is missing with its line feed.
// - cutTail: the end of the document is missing, from the end of the broken payload on.
// - deleteRun: 2 to 20 code points are missing. A longer text takes one deleteRun per 20 code points.
// - insertCodePoint: one code point is extra.
// - copyRun: 2 to 20 code points are extra, and the repaired document holds them as a run. An extra text that the
//   document does not hold as one run is made of pieces, each one code point or such a run, with one edit per piece.
// - duplicateRun: 2 to 20 code points are extra, and the same code points stand right before or right after them.
// - duplicateLine: one whole line is extra, and the same line stands right before or right after it.
// - replaceCodePoint: one code point is extra and one is missing at the same place, or one stands for the other.
// - swapNeighbours: a code point is extra on one side of a kept code point and missing on its other side, e.g. `ture`.
//
// An edit writes only copies of code points of the payload that it damages. So no edit makes a place with an extra
// code point that the repaired document does not hold: a `;` at the end of a line is what insertCodePoint makes only
// in a document that holds a `;` somewhere. And a sample has at most three edits, so a place that takes more than
// three is no place of a sample, e.g. a sentence before the document.
//
// The damage of a case could come from the edits alone when one to three edits make all of its places, see
// couldComeFromEdits. That is the mark of kinds.txt: a line without "new:".
//
// Run from the repo root: bun lab/recovery-toml/held-back/written/neutral-edits.ts [--second] [--set <folder>]
// It prints one line per case in the form of kinds.txt, as the writer's repair reads the case, or with --second as the
// second repair does: the names of the edits, and after "new:" the damaged places that no three edits make, or that
// the edits are more than three. Under the lines it says where kinds.txt differs, and counts the cases.
import {editCountWeights} from '../../damage.ts'
import {visible} from './show.ts'
import {type Opinion, type WrittenCase, readWritten, setFolderOf} from './written.ts'

export type DamagedPlace = {
  // The position in the broken payload of the place's first code point, or of the kept code point before which text is
  // missing.
  position: number
  // What the broken payload has more than the document at this place, and what it lacks.
  extra: string
  missing: string
  // The fewest edits of ../../damage.ts that make the place, by their names, or undefined when it takes more than
  // three, or when no number of edits makes it.
  edits: string[] | undefined
  // The code points of `extra` that the repaired document does not hold. An edit cannot write them.
  foreign: string
}

// What damage.ts calls a run, which it keeps to itself, and how many edits a sample has at most.
const shortestRun = 2
const longestRun = 20
export const mostEditsOfSample = Math.max(...editCountWeights.map(([editCount]) => editCount))

// The damaged places of a broken payload by one opinion, in text order. With `anyCodePoint` an edit may write a code
// point that the repaired document does not hold, which shows what that one rule decides.
export function damagedPlacesOf(brokenText: string, opinion: Pick<Opinion, 'text' | 'alignment' | 'replaced'>, anyCodePoint = false): DamagedPlace[] {
  const broken = Array.from(brokenText)
  const repaired = Array.from(opinion.text)
  const repairedText = repaired.join('')
  const inDocument = new Set(repaired)
  // A place while it is read: its texts as code points, where its missing text starts in the repaired document, and
  // whether it is one code point that stands for another.
  type Read = {position: number, extra: string[], missing: string[], documentStart: number, pair: boolean}
  const read: Read[] = []
  let open: Read | undefined
  // The first code point of the repaired document that has no counterpart so far.
  let expected = 0
  const openAt = (position: number) => open ??= {position, extra: [], missing: [], documentStart: expected, pair: false}
  const close = () => {
    if (open !== undefined) read.push(open)
    open = undefined
  }
  opinion.alignment.forEach((counterpart, position) => {
    if (counterpart === -1) {
      openAt(position).extra.push(broken[position]!)
      return
    }
    if (counterpart > expected) openAt(position).missing.push(...repaired.slice(expected, counterpart))
    close()
    if (opinion.replaced[position] === true) read.push({position, extra: [broken[position]!], missing: [repaired[counterpart]!], documentStart: counterpart, pair: true})
    expected = counterpart + 1
  })
  if (expected < repaired.length) openAt(broken.length).missing.push(...repaired.slice(expected))
  close()
  // The fixed form of an alignment takes the later of two equal code points for the extra one, which can cut one
  // extra text in two, e.g. the extra line `]⏎` before an empty line into `]` and the line feed after the next one.
  // Two extra texts with kept text between them are one place again when the kept text is the same as one of them:
  // the other marking of the same repair has them side by side.
  const sameText = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((character, offset) => character === right[offset])
  for (let index = 0; index + 1 < read.length;) {
    const place = read[index]!
    const next = read[index + 1]!
    const between = broken.slice(place.position + place.extra.length, next.position)
    const bothOnlyExtra = !place.pair && !next.pair && place.missing.length === 0 && next.missing.length === 0 && between.length > 0
    if (bothOnlyExtra && sameText(between, next.extra)) read.splice(index, 2, {...place, extra: [...place.extra, ...between]})
    else if (bothOnlyExtra && sameText(between, place.extra)) read.splice(index, 2, {...next, position: place.position + place.extra.length, extra: [...between, ...next.extra]})
    else index++
  }

  // A whole line with its line feed. The fixed form of an alignment can also give it as the line feed before the line
  // and the line without its own.
  const isLine = (text: readonly string[], start: number, length: number) => {
    if (text.slice(start, start + length).filter(character => character === '\n').length !== 1) return false
    const startsLine = start === 0 || text[start - 1] === '\n'
    const endsLine = start + length === text.length || text[start + length] === '\n'
    return (startsLine && text[start + length - 1] === '\n') || (text[start] === '\n' && endsLine)
  }
  const sameAt = (text: readonly string[], start: number, wanted: readonly string[]) => start >= 0 && start + wanted.length <= text.length && wanted.every((character, offset) => text[start + offset] === character)
  // The fewest edits that take a text of the document away.
  const editsThatDelete = (place: Read, missing: readonly string[], documentStart: number): string[] => {
    if (missing.length === 0) return []
    if (missing.length === 1) return ['deleteCodePoint']
    if (place.position === broken.length && place.extra.length === 0) return ['cutTail']
    if (isLine(repaired, documentStart, missing.length)) return ['deleteLine']
    return new Array<string>(Math.ceil(missing.length / longestRun)).fill('deleteRun')
  }
  // The fewest edits that write an extra text: it is cut into pieces, each one code point or a run of 2 to 20 code
  // points that the document holds, with one edit per piece. The text has no foreign code point.
  const editsThatInsert = (extra: readonly string[]): string[] => {
    const fewest: string[][] = [[]]
    for (let end = 1; end <= extra.length; end++) {
      let best = [...fewest[end - 1]!, 'insertCodePoint']
      for (let length = shortestRun; length <= Math.min(longestRun, end); length++) {
        const before = fewest[end - length]!
        if (before.length + 1 < best.length && repairedText.includes(extra.slice(end - length, end).join(''))) best = [...before, 'copyRun']
      }
      fewest.push(best)
    }
    return fewest[extra.length]!
  }
  const editsOf = (place: Read): string[] | undefined => {
    const {extra, missing} = place
    if (!anyCodePoint && extra.some(character => !inDocument.has(character))) return undefined
    // A copy right beside its source is a duplicate, whatever else the document holds. It is a duplicate of a line
    // when the source is a whole line too, and not the end of a longer one.
    if (missing.length === 0 && extra.length >= shortestRun) {
      const sourceBefore = sameAt(broken, place.position - extra.length, extra)
      const sourceAfter = sameAt(broken, place.position + extra.length, extra)
      const sourceIsLine = (sourceBefore && isLine(broken, place.position - extra.length, extra.length)) || (sourceAfter && isLine(broken, place.position + extra.length, extra.length))
      if (sourceIsLine && isLine(broken, place.position, extra.length)) return ['duplicateLine']
      if ((sourceBefore || sourceAfter) && extra.length <= longestRun) return ['duplicateRun']
    }
    const candidates: string[][] = [[...editsThatDelete(place, missing, place.documentStart), ...editsThatInsert(extra)]]
    // One code point of the extra text, at its start or at its end, takes the place of one of the missing text.
    if (extra.length > 0 && missing.length > 0) {
      candidates.push(['replaceCodePoint', ...editsThatDelete(place, missing.slice(1), place.documentStart + 1), ...editsThatInsert(extra.slice(1))])
      candidates.push([...editsThatDelete(place, missing.slice(0, -1), place.documentStart), ...editsThatInsert(extra.slice(0, -1)), 'replaceCodePoint'])
    }
    const fewest = candidates.reduce((best, candidate) => candidate.length < best.length ? candidate : best)
    return fewest.length <= mostEditsOfSample ? fewest : undefined
  }
  const places: DamagedPlace[] = []
  for (let index = 0; index < read.length; index++) {
    const place = read[index]!
    const next = read[index + 1]
    // Two neighbours that changed places: the one that moved is extra on one side of the other and missing on the
    // other side, e.g. the u of `ture` for `true`. The two halves are one place.
    const one = (codePoints: readonly string[], none: readonly string[]) => codePoints.length === 1 && none.length === 0
    const movedRight = next !== undefined && !place.pair && !next.pair && one(place.missing, place.extra) && one(next.extra, next.missing) && next.position === place.position + 1 && place.missing[0] === next.extra[0]
    const movedLeft = next !== undefined && !place.pair && !next.pair && one(place.extra, place.missing) && one(next.missing, next.extra) && next.position === place.position + 2 && place.extra[0] === next.missing[0]
    if (movedRight || movedLeft) {
      places.push({position: place.position, extra: [...place.extra, ...next.extra].join(''), missing: [...place.missing, ...next.missing].join(''), edits: ['swapNeighbours'], foreign: ''})
      index++
      continue
    }
    places.push({position: place.position, extra: place.extra.join(''), missing: place.missing.join(''), edits: editsOf(place), foreign: [...new Set(place.extra.filter(character => !inDocument.has(character)))].join('')})
  }
  return places
}

// What the edits make of a case's damage, as one of its repairs reads the case, by default the writer's: the edits of
// every place that up to three edits make, in text order, and the places that no three edits make.
export type NeutralEdits = {edits: string[], otherPlaces: DamagedPlace[]}
export function neutralEditsOf(writtenCase: Pick<WrittenCase, 'broken' | 'opinions'>, opinionIndex = 0, anyCodePoint = false): NeutralEdits {
  const places = damagedPlacesOf(writtenCase.broken, writtenCase.opinions[opinionIndex]!, anyCodePoint)
  return {edits: places.flatMap(place => place.edits ?? []), otherPlaces: places.filter(place => place.edits === undefined)}
}

// Whether the damage could come from the ten edits alone: one to three of them turn the repaired document into the
// broken payload, as the damage of the train data does for a sample.
export const couldComeFromEdits = ({edits, otherPlaces}: NeutralEdits) => otherPlaces.length === 0 && edits.length <= mostEditsOfSample

const shown = (text: string) => `"${visible(Array.from(text).length > 40 ? `${Array.from(text).slice(0, 28).join('')} … ${Array.from(text).slice(-8).join('')}` : text)}"`

// A damaged place that no three edits make, in words.
function placeInWords(place: DamagedPlace): string {
  const texts = [...(place.extra === '' ? [] : [`extra ${shown(place.extra)}`]), ...(place.missing === '' ? [] : [`missing ${shown(place.missing)}`])].join(' and ')
  return `${texts} at ${place.position}${place.foreign === '' ? '' : `, where the document holds no ${shown(place.foreign)}`}`
}

if (import.meta.main) {
  const commandArguments = process.argv.slice(2)
  const second = commandArguments.includes('--second')
  const {cases, problems} = readWritten(setFolderOf(commandArguments))
  if (problems.length > 0) console.log(`${problems.length} problems in the files: check.ts prints them.\n`)
  let differs = 0
  let fromEdits = 0
  let moreEdits = 0
  let fromEditsWithAnyCodePoint = 0
  for (const writtenCase of cases) {
    const opinionIndex = second && writtenCase.opinions.length > 1 ? 1 : 0
    const derived = neutralEditsOf(writtenCase, opinionIndex)
    const {edits, otherPlaces} = derived
    const other = otherPlaces.length > 0 ? otherPlaces.map(placeInWords).join('; ') : edits.length > mostEditsOfSample ? `${edits.length} edits, and a sample has at most ${mostEditsOfSample}` : undefined
    console.log(`${writtenCase.id}${edits.map(edit => ` ${edit}`).join('')}${other === undefined ? '' : ` new: ${other}`}`)
    if (couldComeFromEdits(derived)) fromEdits++
    else if (otherPlaces.length === 0) moreEdits++
    else if (couldComeFromEdits(neutralEditsOf(writtenCase, opinionIndex, true))) fromEditsWithAnyCodePoint++
    const listed = writtenCase.damage
    if (listed !== undefined && (listed.edits.join(' ') !== edits.join(' ') || (listed.other === undefined) !== couldComeFromEdits(derived))) {
      differs++
      console.log(`    kinds.txt differs: ${listed.edits.join(' ')}${listed.other === undefined ? '' : ` new: ${listed.other}`}`)
    }
  }
  console.log(`\n${cases.length} cases as the ${second ? 'second' : 'writer\'s'} repair reads them: one to three edits make the damage of ${fromEdits}, as a sample of the train data has it. ${moreEdits} take more than three edits, with every damaged place made by up to three. ${cases.length - fromEdits - moreEdits} have a damaged place that no three edits make, and ${fromEditsWithAnyCodePoint} of them would be made by one to three edits that may write a code point that the document does not hold.`)
  console.log(`kinds.txt differs for ${differs} cases.`)
}
