// Compares the two repairs of each case: the writer's repair and the second repair, which was written by an agent who
// saw the broken program alone. It lists the code points of the broken program where the labels of the two differ.
//
// The command prints the texts of cases, so only those who may read this folder run it, see ../README.md.
//
// Run from the repo root: bun lab/recovery-lr/held-back/written/compare.ts [name of a writer's file] [--set <folder>]
// Per case with a difference it prints the code points in runs, each with the label by the writer and by the second
// repair, and then the two repairs side by side, see describeOpinions in show.ts. The last lines count the cases.
//
// The labels differ at a code point when one repair keeps it and the other says that it is added, or when both keep
// it and the display kind, the depth or the container is not the same. Two repairs can differ as texts and still
// give every code point the same label, e.g. when they add another expression where one is missing.
//
// Two repairs with the same labels can still differ in what the columns "stack" and "constituents" of a report read:
// the symbols on the stack at a code point, and the nonterminals over the kept tokens. The command says so per case.
import {describeOpinions, labelInWords, visible} from './show.ts'
import {type WrittenCase, namesOf, readWritten, setFolderOf} from './written.ts'

// A run of code points of the broken program that are next to each other and have the same pair of labels.
export type Difference = {from: number, to: number, text: string, writer: string, second: string}

// The runs of code points where the two opinions of a case differ, or an empty list for a case with one opinion.
export function differencesOf(writtenCase: WrittenCase): Difference[] {
  const [writer, second] = writtenCase.opinions
  if (writer === undefined || second === undefined) return []
  const broken = Array.from(writtenCase.broken)
  const differences: Difference[] = []
  writtenCase.agreement.forEach((state, position) => {
    if (state !== 'disputed') return
    const byWriter = labelInWords(writer.sample, position)
    const bySecond = labelInWords(second.sample, position)
    const last = differences.at(-1)
    if (last !== undefined && last.to === position - 1 && last.writer === byWriter && last.second === bySecond) {
      last.to = position
      last.text += broken[position]!
    } else differences.push({from: position, to: position, text: broken[position]!, writer: byWriter, second: bySecond})
  })
  return differences
}

// How many agreed code points from the first error on stand on stacks that the two repairs do not both give.
export const otherStackCount = (writtenCase: WrittenCase) => writtenCase.agreement.reduce((total, state, position) => total + Number(state === 'agreed' && position >= writtenCase.sample.firstErrorPosition && writtenCase.stackAgreed[position] === 0), 0)

// What the two repairs of a case differ in beside the three scored values, in words, or an empty text.
export function beyondTheLabels(writtenCase: WrittenCase): string {
  const otherStack = otherStackCount(writtenCase)
  const parts = [
    ...(otherStack === 0 ? [] : [`${otherStack} agreed code point${otherStack === 1 ? '' : 's'} from the first error on stand${otherStack === 1 ? 's' : ''} on another stack by the second repair`]),
    ...(writtenCase.constituentsAgreed ? [] : ['the two repairs give other constituents over the kept tokens']),
  ]
  return parts.join(', and ')
}

// What the command prints for a case with a difference, before the two repairs side by side: how many code points
// differ, and each run with its two labels.
export function differenceLines(writtenCase: WrittenCase, differences: readonly Difference[] = differencesOf(writtenCase)): string[] {
  const count = differences.reduce((total, difference) => total + difference.to - difference.from + 1, 0)
  const counted = differences.reduce((total, difference) => total + Math.max(0, difference.to - Math.max(difference.from, writtenCase.sample.firstErrorPosition) + 1), 0)
  // With the same repaired program, the two repairs differ only in which code points of the broken program they keep,
  // e.g. which of two equal lines is the added one. That is often the same repair marked in two ways.
  const sameProgram = writtenCase.opinions.length === 2 && writtenCase.opinions[0]!.text === writtenCase.opinions[1]!.text
  const beyond = beyondTheLabels(writtenCase)
  return [
    `--- ${writtenCase.id}: the labels differ at ${count} code point${count === 1 ? '' : 's'}, ${counted} of them from the parser's first error at ${writtenCase.sample.firstErrorPosition} on`,
    ...(sameProgram ? ['    the two repaired programs are the same: the repairs differ only in which code points of the broken program they keep'] : []),
    ...differences.map(difference => `    code point${difference.from === difference.to ? ` ${difference.from}` : `s ${difference.from} to ${difference.to}`} "${visible(difference.text)}": writer: ${difference.writer}. second: ${difference.second}.`),
    ...(beyond === '' ? [] : [`    where the labels are the same: ${beyond}`]),
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
  let sameLabelsOtherStack = 0
  let sameLabelsOtherConstituents = 0
  for (const writtenCase of repairedTwice) {
    const differences = differencesOf(writtenCase)
    const sameText = writtenCase.opinions[0]!.text === writtenCase.opinions[1]!.text
    if (differences.length === 0) {
      const beyond = beyondTheLabels(writtenCase)
      if (otherStackCount(writtenCase) > 0) sameLabelsOtherStack++
      if (!writtenCase.constituentsAgreed) sameLabelsOtherConstituents++
      console.log(`--- ${writtenCase.id}: the same labels at every code point${sameText ? '' : ', with repaired programs that differ'}${beyond === '' ? '' : `. ${beyond[0]!.toUpperCase()}${beyond.slice(1)}`}`)
      continue
    }
    withDifference++
    if (writtenCase.disputedFromFirstError) fromFirstError++
    console.log(`${[...differenceLines(writtenCase, differences), describeOpinions(writtenCase)].join('\n')}\n`)
  }
  console.log(`${repairedTwice.length} cases with two repairs: ${repairedTwice.length - withDifference} with the same labels at every code point, ${withDifference} with a difference, ${fromFirstError} of them with a difference from the parser's first error on, where a score counts. ${cases.length - repairedTwice.length} cases have no second repair.`)
  console.log(`Of the ${repairedTwice.length - withDifference} cases with the same labels, ${sameLabelsOtherStack} have a scored code point on another stack by the second repair, and ${sameLabelsOtherConstituents} have other constituents.`)
  if (problems.length > 0) process.exitCode = 1
}
