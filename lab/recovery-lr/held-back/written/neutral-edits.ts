// Which damage of a written case the train data's damage could have made.
//
// The train data of this track is damaged by ten edits that know nothing of miniml, see ../../damage.ts: delete,
// insert, replace or swap a code point, delete, duplicate or copy a run of 2 to 20 code points, delete or duplicate a
// line, and cut the tail. A sample gets one to three of them. The cases of this set were written from what people and
// tools do to programs. This file holds the two against each other: per damaged place of a case it gives the fewest
// edits that make the place, or says that no three edits do. kinds.txt records the answer per case, and README.md
// says how the line is drawn, under "What the damage is".
//
// A damaged place is what a repair changes between two kept code points: text of the broken program that the repaired
// program lacks, text of the repaired program that the broken program lacks, or both at once. The edits that make a
// place, by their names in ../../damage.ts:
// - delete a code point: one code point is missing.
// - delete a line: one whole line is missing with its line feed.
// - cut the tail: the end of the repaired program is missing, from the end of the broken program on.
// - delete a run: 2 to 20 code points are missing. A longer text takes one such edit per 20 code points.
// - insert a code point: one code point is added.
// - copy a run: 2 to 20 code points are added, and the repaired program holds them as a run. An added text that the
//   program does not hold as one run is made of pieces, each one code point or such a run, with one edit per piece.
// - duplicate a run: 2 to 20 code points are added, and the same code points stand right before or right after them.
// - duplicate a line: one whole line is added, and the same line stands right before or right after it.
// - replace a code point: one code point is added and one is missing at the same place.
// - swap two code points: a code point is added on one side of a kept code point and missing on its other side, e.g.
//   `lte` for `let`.
// A place with added and with missing text gets the fewest of these that turn the one text into the other, where a
// code point that both texts have stays, e.g. `def` for `let` is two replaced code points around the `e`.
//
// Edits are applied one after another, so a later edit can work on what an earlier one wrote. Two such cases are
// read: a run that is a copy of text which the broken program holds before it, e.g. the second `**` of `**5**`, and
// a line that was duplicated and then changed, e.g. the copy of a line that lost its end. Any other damage that
// takes two edits at the same text is not found, so the derivation can name more edits than a sample needed.
//
// An edit writes only copies of code points of the program that it damages. So no edit makes a place with an added
// code point that the repaired program does not hold: a `;` at the end of a line is what "insert a code point" makes
// only in a program that holds a `;` somewhere. And a sample has at most three edits, so a place that takes more than
// three is no place of a sample, e.g. a sentence before the program.
//
// The damage of a case could come from the edits alone when one to three edits make all of its places, see
// couldComeFromEdits. That is the mark of kinds.txt: a line without "new:".
//
// The command prints the texts of cases, so only those who may read this folder run it, see ../README.md.
//
// Run from the repo root: bun lab/recovery-lr/held-back/written/neutral-edits.ts [--second] [--set <folder>]
// It prints one line per case in the form of kinds.txt, as the writer's repair reads the case, or with --second as
// the second repair does: the names of the edits, and after "new:" the damaged places that no three edits make, or
// that the edits are more than three. Under the lines it says where kinds.txt differs, and counts the cases.
//
//   bun lab/recovery-lr/held-back/written/neutral-edits.ts --samples <count>
// reads no case. It holds the derivation against the first <count> validation samples of the dataset, whose damage
// is one to three edits by construction, and prints for how many of them it finds one to three edits. It finds
// fewer than all: two edits of a sample can touch the same text, and the derivation reads every damaged place by
// itself.
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {editNames} from '../../damage.ts'
import {defaultSeed, loadSamples} from '../../dataset.ts'
import {visible} from './show.ts'
import {type Opinion, type WrittenCase, readWritten, setFolderOf, writtenFolder} from './written.ts'

type EditName = typeof editNames[number]

export type DamagedPlace = {
  // The position in the broken program of the place's first code point, or of the kept code point before which text
  // is missing.
  position: number
  // What the broken program has more than the repaired program at this place, and what it lacks.
  added: string
  missing: string
  // The fewest edits of ../../damage.ts that make the place, by their names, or undefined when it takes more than
  // three, or when no number of edits makes it.
  edits: EditName[] | undefined
  // The code points of `added` that the repaired program does not hold. An edit cannot write them.
  notInProgram: string
}

// What damage.ts calls a run, and how many edits a sample has at most. damage.ts keeps both to itself, and
// check-written.ts holds the second against draws of the damage.
const shortestRun = 2
const longestRun = 20
export const mostEditsOfSample = 3

// The damaged places of a broken program by one opinion, in text order. With `anyCodePoint` an edit may write a code
// point that the repaired program does not hold, which shows what that one rule decides.
export function damagedPlacesOf(brokenText: string, opinion: Pick<Opinion, 'text' | 'sample'>, anyCodePoint = false): DamagedPlace[] {
  const broken = Array.from(brokenText)
  const repaired = Array.from(opinion.text)
  const repairedText = repaired.join('')
  const inProgram = new Set(repaired)
  // A place while it is read: its texts as code points, and where its missing text starts in the repaired program.
  type Read = {position: number, added: string[], missing: string[], programStart: number}
  const read: Read[] = []
  let open: Read | undefined
  // The first code point of the repaired program that has no counterpart so far.
  let expected = 0
  const openAt = (position: number) => open ??= {position, added: [], missing: [], programStart: expected}
  const close = () => {
    if (open !== undefined) read.push(open)
    open = undefined
  }
  opinion.sample.alignment.forEach((counterpart, position) => {
    if (counterpart === -1) {
      openAt(position).added.push(broken[position]!)
      return
    }
    if (counterpart > expected) openAt(position).missing.push(...repaired.slice(expected, counterpart))
    close()
    expected = counterpart + 1
  })
  if (expected < repaired.length) openAt(broken.length).missing.push(...repaired.slice(expected))
  close()
  // The fixed form of an alignment takes the later of two equal code points for the added one, which can cut one
  // added text in two, e.g. the added line `  in⏎` before an indented line into `in⏎` and the indentation after the
  // next two spaces. Two added texts with kept text between them are one place again when the kept text is the same
  // as one of them: the other marking of the same repair has them side by side.
  const sameText = (left: readonly string[], right: readonly string[]) => left.length === right.length && left.every((character, offset) => character === right[offset])
  for (let index = 0; index + 1 < read.length;) {
    const place = read[index]!
    const next = read[index + 1]!
    const between = broken.slice(place.position + place.added.length, next.position)
    const bothOnlyAdded = place.missing.length === 0 && next.missing.length === 0 && between.length > 0
    if (bothOnlyAdded && sameText(between, next.added)) read.splice(index, 2, {...place, added: [...place.added, ...between]})
    else if (bothOnlyAdded && sameText(between, place.added)) read.splice(index, 2, {...next, position: place.position + place.added.length, added: [...between, ...next.added]})
    else index++
  }

  // A whole line with its line feed. The fixed form of an alignment can also give it as the line feed before the
  // line and the line without its own.
  const isLine = (text: readonly string[], start: number, length: number) => {
    if (text.slice(start, start + length).filter(character => character === '\n').length !== 1) return false
    const startsLine = start === 0 || text[start - 1] === '\n'
    const endsLine = start + length === text.length || text[start + length] === '\n'
    return (startsLine && text[start + length - 1] === '\n') || (text[start] === '\n' && endsLine)
  }
  const sameAt = (text: readonly string[], start: number, wanted: readonly string[]) => start >= 0 && start + wanted.length <= text.length && wanted.every((character, offset) => text[start + offset] === character)
  // The fewest edits that turn a text of the repaired program into a text of the broken program at one place, or
  // undefined when they are more than three. The two texts are read from left to right: a code point that both have
  // stays, one code point takes the place of another, 1 to 20 code points are deleted, and one code point or a run
  // of 2 to 20 code points is written. No step writes a code point that the repaired program does not hold. A run
  // is a copy of text that the repaired program holds, or of text that the broken program holds before it: a later
  // edit can copy what an earlier one wrote, e.g. the second `**` of `**5**` is a copy of the first. `position` is
  // where the added text starts in the broken program.
  const writable = (character: string) => anyCodePoint || inProgram.has(character)
  const editsBetween = (missing: readonly string[], added: readonly string[], position: number): EditName[] | undefined => {
    const brokenBefore = (written: number) => broken.slice(0, position + written).join('')
    const width = added.length + 1
    const fewest: (EditName[] | undefined)[] = new Array<EditName[] | undefined>((missing.length + 1) * width).fill(undefined)
    fewest[0] = []
    const reach = (at: number, edits: EditName[]) => {
      if (edits.length <= mostEditsOfSample && (fewest[at] === undefined || edits.length < fewest[at].length)) fewest[at] = edits
    }
    for (let deleted = 0; deleted <= missing.length; deleted++) {
      for (let written = 0; written <= added.length; written++) {
        const edits = fewest[deleted * width + written]
        if (edits === undefined) continue
        if (deleted < missing.length && written < added.length) {
          if (missing[deleted] === added[written]) reach((deleted + 1) * width + written + 1, edits)
          else if (writable(added[written]!)) reach((deleted + 1) * width + written + 1, [...edits, 'replace a code point'])
        }
        for (let length = 1; length <= longestRun && deleted + length <= missing.length; length++) reach((deleted + length) * width + written, [...edits, length === 1 ? 'delete a code point' : 'delete a run'])
        if (written < added.length && writable(added[written]!)) reach(deleted * width + written + 1, [...edits, 'insert a code point'])
        for (let length = shortestRun; length <= longestRun && written + length <= added.length; length++) {
          const run = added.slice(written, written + length).join('')
          if (repairedText.includes(run) || brokenBefore(written).includes(run)) reach(deleted * width + written + length, [...edits, 'copy a run'])
        }
      }
    }
    return fewest[missing.length * width + added.length]
  }
  // The content of a whole line and of the lines right before and after it in the broken program, for a run that
  // isLine takes for a line.
  const lineAround = (start: number, length: number): {content: string[], contentStart: number, neighbours: string[][]} => {
    const from = broken[start] === '\n' ? start + 1 : start
    const to = broken[start] === '\n' ? start + length : start + length - 1
    const neighbours: string[][] = []
    if (from >= 2) neighbours.push(broken.slice(broken.lastIndexOf('\n', from - 2) + 1, from - 1))
    if (to < broken.length) {
      const nextEnd = broken.indexOf('\n', to + 1)
      neighbours.push(broken.slice(to + 1, nextEnd === -1 ? broken.length : nextEnd))
    }
    return {content: broken.slice(from, to), contentStart: from, neighbours}
  }
  const editsOf = (place: Read): EditName[] | undefined => {
    const {added, missing} = place
    if (!anyCodePoint && added.some(character => !inProgram.has(character))) return undefined
    if (added.length === 0) {
      // Text that is only missing.
      if (missing.length === 1) return ['delete a code point']
      if (place.position === broken.length) return ['cut the tail']
      // The fixed form of an alignment has missing text as far to the right as the two programs allow, e.g. a
      // missing line of a function as the end of that line and the indentation of the next one. Every place further
      // left that gives the same broken program is tried too.
      for (let start = place.programStart; start === place.programStart || (start >= 0 && repaired[start] === repaired[start + missing.length]); start--) {
        if (isLine(repaired, start, missing.length)) return ['delete a line']
      }
      const runs = Math.ceil(missing.length / longestRun)
      return runs <= mostEditsOfSample ? new Array<EditName>(runs).fill('delete a run') : undefined
    }
    const candidates: EditName[][] = []
    if (missing.length === 0) {
      // Text that is only added. The fixed form of an alignment has it as far to the right as the broken program
      // allows, e.g. the `dexn` of `indexn` for `in` with `ndex` pasted into it. Every place further left that gives
      // the same broken program is tried too.
      for (let shift = 0; shift === 0 || (place.position - shift >= 0 && broken[place.position - shift] === broken[place.position - shift + added.length]); shift++) {
        const start = place.position - shift
        const text = broken.slice(start, start + added.length)
        // A copy right beside its source is a duplicate, whatever else the program holds. It is a duplicate of a
        // line when the source is a whole line too, and not the end of a longer one.
        const sourceBefore = sameAt(broken, start - text.length, text)
        const sourceAfter = sameAt(broken, start + text.length, text)
        const sourceIsLine = (sourceBefore && isLine(broken, start - text.length, text.length)) || (sourceAfter && isLine(broken, start + text.length, text.length))
        if (sourceIsLine && isLine(broken, start, text.length)) candidates.push(['duplicate a line'])
        else if ((sourceBefore || sourceAfter) && text.length >= shortestRun && text.length <= longestRun) candidates.push(['duplicate a run'])
        // A line that was duplicated and then changed, e.g. the copy of a line that lost its end.
        if (isLine(broken, start, text.length)) {
          const {content, contentStart, neighbours} = lineAround(start, text.length)
          for (const neighbour of neighbours) {
            const changes = editsBetween(neighbour, content, contentStart)
            if (changes !== undefined) candidates.push(['duplicate a line', ...changes])
          }
        }
        const written = editsBetween([], text, start)
        if (written !== undefined) candidates.push(written)
      }
    } else {
      const changed = editsBetween(missing, added, place.position)
      if (changed !== undefined) candidates.push(changed)
    }
    const within = candidates.filter(candidate => candidate.length <= mostEditsOfSample)
    return within.length === 0 ? undefined : within.reduce((best, candidate) => candidate.length < best.length ? candidate : best)
  }
  const places: DamagedPlace[] = []
  for (let index = 0; index < read.length; index++) {
    const place = read[index]!
    const next = read[index + 1]
    // Two neighbours that changed places: the one that moved is added on one side of the other and missing on the
    // other side, e.g. the e of `lte` for `let`. The two halves are one place.
    const one = (codePoints: readonly string[], none: readonly string[]) => codePoints.length === 1 && none.length === 0
    const movedRight = next !== undefined && one(place.missing, place.added) && one(next.added, next.missing) && next.position === place.position + 1 && place.missing[0] === next.added[0]
    const movedLeft = next !== undefined && one(place.added, place.missing) && one(next.missing, next.added) && next.position === place.position + 2 && place.added[0] === next.missing[0]
    if (movedRight || movedLeft) {
      places.push({position: place.position, added: [...place.added, ...next.added].join(''), missing: [...place.missing, ...next.missing].join(''), edits: ['swap two code points'], notInProgram: ''})
      index++
      continue
    }
    places.push({position: place.position, added: place.added.join(''), missing: place.missing.join(''), edits: editsOf(place), notInProgram: [...new Set(place.added.filter(character => !inProgram.has(character)))].join('')})
  }
  return places
}

// What the edits make of a case's damage, as one of its repairs reads the case, by default the writer's: the edits of
// every place that up to three edits make, in text order, and the places that no three edits make.
export type NeutralEdits = {edits: EditName[], otherPlaces: DamagedPlace[]}
export const neutralEditsOfPlaces = (places: readonly DamagedPlace[]): NeutralEdits => ({edits: places.flatMap(place => place.edits ?? []), otherPlaces: places.filter(place => place.edits === undefined)})
export const neutralEditsOf = (writtenCase: Pick<WrittenCase, 'broken' | 'opinions'>, opinionIndex = 0, anyCodePoint = false): NeutralEdits =>
  neutralEditsOfPlaces(damagedPlacesOf(writtenCase.broken, writtenCase.opinions[opinionIndex]!, anyCodePoint))

// Whether the damage could come from the ten edits alone: one to three of them turn the repaired program into the
// broken program, as the damage of the train data does for a sample.
export const couldComeFromEdits = ({edits, otherPlaces}: NeutralEdits) => otherPlaces.length === 0 && edits.length <= mostEditsOfSample

// The three parts that the edits make of the set:
// - 'neutral edits': one to three edits make the damage, as a sample of the train data has it.
// - 'more edits': up to three edits make every damaged place, and the edits are more than three in all.
// - 'other damage': a damaged place that no three edits make.
export type DamagePart = 'neutral edits' | 'more edits' | 'other damage'
export const damagePartOf = (derived: NeutralEdits): DamagePart => couldComeFromEdits(derived) ? 'neutral edits' : derived.otherPlaces.length === 0 ? 'more edits' : 'other damage'

// A line of kinds.txt: the id of a case, the names of the edits with ", " between them, and for a case whose damage
// one to three edits do not make " new: " and the reason in a few words, e.g.
//   hand-editing-13 swap two code points
//   hand-editing-34 delete a run, delete a run
//   model-and-paste-09 new: a quote sign of a mail before every line, in a program without `>`
export type KindsLine = {id: string, edits: string[], other: string | undefined}
export function kindsLineOf(line: string): KindsLine | undefined {
  const match = /^(\S+)(?: (.*?))??(?:(?:^| )new: (.*))?$/.exec(line)
  if (match === null) return undefined
  const [, id, edits, other] = match
  return {id: id!, edits: edits === undefined || edits === '' ? [] : edits.split(', '), other}
}

// The lines of kinds.txt of a set by the ids of their cases, and what is wrong with the file. A folder without the
// file has no lines.
export function readKinds(folder: string = writtenFolder): {lines: Map<string, KindsLine>, problems: string[]} {
  const lines = new Map<string, KindsLine>()
  const problems: string[] = []
  const path = join(folder, 'kinds.txt')
  if (!existsSync(path)) return {lines, problems}
  readFileSync(path, 'utf8').split('\n').forEach((text, index) => {
    if (text.trim() === '') return
    const line = kindsLineOf(text)
    if (line === undefined) problems.push(`kinds.txt, line ${index + 1}: the line is no id with the names of edits`)
    else if (lines.has(line.id)) problems.push(`kinds.txt, line ${index + 1}: the case ${line.id} has a line already`)
    else if (line.edits.some(edit => !(editNames as readonly string[]).includes(edit))) problems.push(`kinds.txt, line ${index + 1}: ${line.edits.filter(edit => !(editNames as readonly string[]).includes(edit)).join(', ')} is no edit of the train data's damage`)
    else if (line.other === undefined && (line.edits.length === 0 || line.edits.length > mostEditsOfSample)) problems.push(`kinds.txt, line ${index + 1}: a line without "new:" has one to three edits`)
    else lines.set(line.id, line)
  })
  return {lines, problems}
}

const shown = (text: string) => `"${visible(Array.from(text).length > 40 ? `${Array.from(text).slice(0, 28).join('')} … ${Array.from(text).slice(-8).join('')}` : text)}"`

// A damaged place that no three edits make, in words.
function placeInWords(place: DamagedPlace): string {
  const texts = [...(place.added === '' ? [] : [`added ${shown(place.added)}`]), ...(place.missing === '' ? [] : [`missing ${shown(place.missing)}`])].join(' and ')
  return `${texts} at ${place.position}${place.notInProgram === '' ? '' : `, where the program holds no ${shown(place.notInProgram)}`}`
}

// How many of the first `count` validation samples of the dataset the derivation takes for one to three edits, per
// number of edits that made the sample.
export function foundAmongSamples(count: number): Map<number, {samples: number, found: number}> {
  const perEditCount = new Map<number, {samples: number, found: number}>()
  for (const sample of loadSamples('validation', defaultSeed, count)) {
    const entry = perEditCount.get(sample.edits.length) ?? {samples: 0, found: 0}
    entry.samples++
    if (couldComeFromEdits(neutralEditsOfPlaces(damagedPlacesOf(sample.broken, {text: sample.original, sample})))) entry.found++
    perEditCount.set(sample.edits.length, entry)
  }
  return perEditCount
}

if (import.meta.main && process.argv.includes('--samples')) {
  const count = Number(process.argv[process.argv.indexOf('--samples') + 1])
  if (!Number.isInteger(count) || count < 1) throw new Error('--samples needs a number of samples, e.g. --samples 3000')
  const perEditCount = foundAmongSamples(count)
  const all = [...perEditCount.values()]
  const total = (value: (entry: {samples: number, found: number}) => number) => all.reduce((sum, entry) => sum + value(entry), 0)
  console.log(`Of the first ${count} validation samples of the dataset, the derivation finds one to three edits for ${total(entry => entry.found)}: ${[...perEditCount].sort((left, right) => left[0] - right[0]).map(([edits, entry]) => `${entry.found} of the ${entry.samples} with ${edits} edit${edits === 1 ? '' : 's'}`).join(', ')}.`)
} else if (import.meta.main) {
  const commandArguments = process.argv.slice(2)
  const second = commandArguments.includes('--second')
  const folder = setFolderOf(commandArguments)
  const {cases, problems} = readWritten(folder)
  const kinds = readKinds(folder)
  for (const problem of kinds.problems) console.log(`problem: ${problem}`)
  if (problems.length > 0) console.log(`${problems.length} problems in the files: check.ts prints them.\n`)
  let differs = 0
  const counts: Record<DamagePart, number> = {'neutral edits': 0, 'more edits': 0, 'other damage': 0}
  let fromEditsWithAnyCodePoint = 0
  for (const writtenCase of cases) {
    const opinionIndex = second && writtenCase.opinions.length > 1 ? 1 : 0
    const derived = neutralEditsOf(writtenCase, opinionIndex)
    const {edits, otherPlaces} = derived
    const other = otherPlaces.length > 0 ? otherPlaces.map(placeInWords).join('; ') : edits.length > mostEditsOfSample ? `${edits.length} edits, and a sample has at most ${mostEditsOfSample}` : undefined
    console.log(`${writtenCase.id}${edits.length === 0 ? '' : ` ${edits.join(', ')}`}${other === undefined ? '' : ` new: ${other}`}`)
    const part = damagePartOf(derived)
    counts[part]++
    if (part === 'other damage' && couldComeFromEdits(neutralEditsOf(writtenCase, opinionIndex, true))) fromEditsWithAnyCodePoint++
    const listed = kinds.lines.get(writtenCase.id)
    if (listed === undefined) {
      differs++
      console.log('    kinds.txt has no line for the case')
    } else if (listed.edits.join(', ') !== edits.join(', ') || (listed.other === undefined) !== couldComeFromEdits(derived)) {
      differs++
      console.log(`    kinds.txt differs: ${listed.edits.join(', ')}${listed.other === undefined ? '' : ` new: ${listed.other}`}`)
    }
  }
  console.log(`\n${cases.length} cases as the ${second ? 'second' : 'writer\'s'} repair reads them: one to three edits make the damage of ${counts['neutral edits']}, as a sample of the train data has it. ${counts['more edits']} take more than three edits, with every damaged place made by up to three. ${counts['other damage']} have a damaged place that no three edits make, and ${fromEditsWithAnyCodePoint} of them would be made by one to three edits that may write a code point that the program does not hold.`)
  console.log(`kinds.txt differs for ${differs} cases.`)
}
