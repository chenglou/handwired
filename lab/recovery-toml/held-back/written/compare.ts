// Compares the two repairs of each case: the writer's repair and the second repair, which was written by an agent who
// saw the broken payload alone. It lists the code points of the broken payload where the labels of the two differ.
//
// Run from the repo root: bun lab/recovery-toml/held-back/written/compare.ts [name of a writer's file] [--set <folder>]
// Per case with a difference it prints the code points in runs, each with the label by the writer and by the second
// repair, and then the two repairs side by side, see describeOpinions in show.ts. The last line counts the cases.
//
// The labels differ at a code point when one repair gives it a label and the other does not, or when both give it
// one and a scored value is not the same, i.e. the display kind, or the depth and the container. A value that the
// reading of one repair does not score is no difference, see unscoredOf in written.ts. Two repairs can differ as
// texts and still give every code point the same label, e.g. when they add another value where one is missing.
import {displayKind} from '../../kinds.ts'
import type {ReferenceLabel} from '../../reference.ts'
import {containerNames} from '../../table-parser.ts'
import {describeOpinions, visible} from './show.ts'
import {type WrittenCase, namesOf, readWritten, setFolderOf} from './written.ts'

const kindNames = Object.entries(displayKind).sort((left, right) => left[1] - right[1]).map(([name]) => name)
const labelInWords = (label: ReferenceLabel | undefined) => label === undefined ? 'no label' : `${kindNames[label.kind]!}, depth ${label.depth}, ${label.container === 0 ? 'no container' : `in an ${containerNames[label.container]!}`}`

// A run of code points of the broken payload that are next to each other and have the same pair of labels.
export type Difference = {from: number, to: number, text: string, writer: string, second: string}

// The runs of code points where the two opinions of a case differ, or an empty list for a case with one opinion.
export function differencesOf(writtenCase: WrittenCase): Difference[] {
  const [writer, second] = writtenCase.opinions
  if (writer === undefined || second === undefined) return []
  const broken = Array.from(writtenCase.broken)
  const differences: Difference[] = []
  writtenCase.agreement.forEach((state, position) => {
    if (state !== 'disputed') return
    const byWriter = labelInWords(writer.labels[position])
    const bySecond = labelInWords(second.labels[position])
    const last = differences.at(-1)
    if (last !== undefined && last.to === position - 1 && last.writer === byWriter && last.second === bySecond) {
      last.to = position
      last.text += broken[position]!
    } else differences.push({from: position, to: position, text: broken[position]!, writer: byWriter, second: bySecond})
  })
  return differences
}

// What the command prints for a case with a difference, before the two repairs side by side: how many code points
// differ, and each run with its two labels.
export function differenceLines(writtenCase: WrittenCase, differences: readonly Difference[] = differencesOf(writtenCase)): string[] {
  const count = differences.reduce((total, difference) => total + difference.to - difference.from + 1, 0)
  const counted = differences.reduce((total, difference) => total + Math.max(0, difference.to - Math.max(difference.from, writtenCase.firstErrorPosition) + 1), 0)
  // With the same repaired document, the two repairs differ only in which code points of the broken payload they keep,
  // e.g. which of two equal lines is the extra one. That is often the same repair marked in two ways.
  const sameDocument = writtenCase.opinions.length === 2 && writtenCase.opinions[0]!.text === writtenCase.opinions[1]!.text
  return [
    `--- ${writtenCase.id}: the labels differ at ${count} code point${count === 1 ? '' : 's'}, ${counted} of them from the parser's first error at ${writtenCase.firstErrorPosition} on`,
    ...(sameDocument ? ['    the two repaired documents are the same: the repairs differ only in which code points of the broken payload they keep'] : []),
    ...differences.map(difference => `    code point${difference.from === difference.to ? ` ${difference.from}` : `s ${difference.from} to ${difference.to}`} "${visible(difference.text)}": writer: ${difference.writer}. second: ${difference.second}.`),
  ]
}

if (import.meta.main) {
  const commandArguments = process.argv.slice(2)
  const only = namesOf(commandArguments)[0]
  const {cases, problems} = readWritten(setFolderOf(commandArguments), only === undefined ? {} : {only})
  for (const problem of problems) console.log(`problem: ${problem}`)
  if (problems.length > 0) console.log(`${problems.length} problems: the cases and repairs that they name are left out below.\n`)
  const repairedTwice = cases.filter(writtenCase => writtenCase.opinions.length === 2)
  let withDifference = 0
  let fromFirstError = 0
  for (const writtenCase of repairedTwice) {
    const differences = differencesOf(writtenCase)
    const sameText = writtenCase.opinions[0]!.text === writtenCase.opinions[1]!.text
    if (differences.length === 0) {
      console.log(`--- ${writtenCase.id}: the same labels at every code point${sameText ? '' : ', with repaired documents that differ'}`)
      continue
    }
    withDifference++
    if (writtenCase.disputedFromFirstError) fromFirstError++
    console.log(`${[...differenceLines(writtenCase, differences), describeOpinions(writtenCase)].join('\n')}\n`)
  }
  console.log(`${repairedTwice.length} cases with two repairs: ${repairedTwice.length - withDifference} with the same labels at every code point, ${withDifference} with a difference, ${fromFirstError} of them with a difference from the parser's first error on, where a score counts. ${cases.length - repairedTwice.length} cases have no second repair.`)
  if (problems.length > 0) process.exitCode = 1
}
