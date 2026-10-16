// The written set for the final scoring: its cases as samples of the dataset, in the parts that a report gives, and
// what the parser as it is gets right on them.
//
// A sample here is a Sample of ../../sample.ts, as written.ts makes it of a case: whatever scores the train and
// validation samples scores these. A score counts the kept code points from the first error of the parser as it is
// on, and a disputed code point is given as an added one, so no score counts it.
//
// The parts:
// - The cases with full agreement, i.e. without a disputed code point from the first error on. This is the set's
//   main number.
// - All cases over their agreed code points.
// - Both again for the two parts that kinds.txt makes of the set: the cases whose damage one to three of the train
//   data's ten edits make, and the cases with other damage, see neutral-edits.ts.
// - The cases with full agreement of which no repair is marked as unsure.
// - Both ways to count per writer's file.
//
// For the final scoring, from a file of this folder, which is the only place that may import this one:
//   import {rowsOfParts, partsOfWritten} from './score.ts'
//   for (const {name, samples} of rowsOfParts(partsOfWritten())) console.log(scoreRow(name, scoreTablesByExactParser(tables, samples)))
// with scoreRow and scoreTablesByExactParser of ../../learn/score.ts. A parser that is no table of the experiment is
// scored with scoreOutputs of the same file, and the open cells that the samples read are counted with reportOf of
// ../../learn/report.ts on packSamples(samples, tables).
//
// Run from the repo root: bun lab/recovery-lr/held-back/written/score.ts [--set <folder>]
// It prints the rows for the parser as it is, which shows everything from its first error on as an error. It runs
// no recovery, and it prints counts only, so that its output quotes no case.
import {packSamples} from '../../learn/data.ts'
import {baseTables} from '../../learn/recovery-tables.ts'
import {type Score, scoreTablesByExactParser, sharesOf} from '../../learn/score.ts'
import type {Sample} from '../../sample.ts'
import {readKinds} from './neutral-edits.ts'
import {type WrittenCase, readWritten, samplesOfWritten, setFolderOf, writtenFolder} from './written.ts'

// The two ways to count cases:
// - fullAgreement: the cases without a disputed code point from the first error on.
// - agreedCodePoints: all cases, where a disputed code point is left out.
export type WrittenSamples = {fullAgreement: Sample[], agreedCodePoints: Sample[]}

export type WrittenParts = {
  all: WrittenSamples
  // By the name of the writer's file, e.g. 'hand-editing.txt'.
  perFile: Map<string, WrittenSamples>
  // The cases whose damage one to three of the ten edits of the train data make, by kinds.txt: a result on them says
  // how the recipe carries over to other programs with damage that the train data could have.
  neutralEdits: WrittenSamples
  // The other cases, whose damage needs knowledge of how people and tools break such programs: a result on them says
  // how the recipe carries over to damage that the train data cannot have.
  otherDamage: WrittenSamples
  // The cases of which no repair is marked as unsure. In the other cases with full agreement, the agreement rests on
  // a reading that a repairer called open.
  unmarked: WrittenSamples
}

const samplesOf = (cases: readonly WrittenCase[]): WrittenSamples => ({fullAgreement: samplesOfWritten(cases, 'full agreement'), agreedCodePoints: samplesOfWritten(cases, 'agreed code points')})

// The parts of cases. `otherDamageIds` are the ids of the cases whose line of kinds.txt has "new:".
export function partsOfCases(cases: readonly WrittenCase[], otherDamageIds: ReadonlySet<string>): WrittenParts {
  const files = [...new Set(cases.map(writtenCase => writtenCase.file))].sort()
  return {
    all: samplesOf(cases),
    perFile: new Map(files.map(file => [file, samplesOf(cases.filter(writtenCase => writtenCase.file === file))])),
    neutralEdits: samplesOf(cases.filter(writtenCase => !otherDamageIds.has(writtenCase.id))),
    otherDamage: samplesOf(cases.filter(writtenCase => otherDamageIds.has(writtenCase.id))),
    unmarked: samplesOf(cases.filter(writtenCase => writtenCase.opinions.every(opinion => opinion.unsure === undefined))),
  }
}

// The parts of the set in a folder. Throws when a file of the set has a problem or a case has no line in kinds.txt:
// no number is made of a set that is not whole.
export function partsOfWritten(folder: string = writtenFolder): WrittenParts {
  const {cases, problems} = readWritten(folder)
  const kinds = readKinds(folder)
  if (problems.length > 0 || kinds.problems.length > 0) throw new Error(`the written set in ${folder} has ${problems.length + kinds.problems.length} problems: check.ts and neutral-edits.ts print them`)
  const withoutLine = cases.filter(writtenCase => !kinds.lines.has(writtenCase.id))
  if (withoutLine.length > 0) throw new Error(`kinds.txt in ${folder} has no line for ${withoutLine.length} cases, e.g. ${withoutLine[0]!.id}`)
  return partsOfCases(cases, new Set(cases.filter(writtenCase => kinds.lines.get(writtenCase.id)!.other !== undefined).map(writtenCase => writtenCase.id)))
}

// The rows of a report, in its order, each with its samples.
export function rowsOfParts(parts: WrittenParts): {name: string, samples: Sample[]}[] {
  return [
    {name: 'Cases with full agreement', samples: parts.all.fullAgreement},
    {name: 'Full agreement, one to three edits make the damage', samples: parts.neutralEdits.fullAgreement},
    {name: 'Full agreement, other damage', samples: parts.otherDamage.fullAgreement},
    {name: 'Full agreement, no repair marked as unsure', samples: parts.unmarked.fullAgreement},
    {name: 'All cases, the agreed code points', samples: parts.all.agreedCodePoints},
    {name: 'Agreed code points, one to three edits make the damage', samples: parts.neutralEdits.agreedCodePoints},
    {name: 'Agreed code points, other damage', samples: parts.otherDamage.agreedCodePoints},
    ...[...parts.perFile].flatMap(([file, samples]) => [{name: `\`${file}\`, full agreement`, samples: samples.fullAgreement}, {name: `\`${file}\`, agreed code points`, samples: samples.agreedCodePoints}]),
  ]
}

// The score of the parser as it is on samples: bison's parser as tables, which stops at its first error.
export const scoreOfParserAsItIs = (samples: readonly Sample[]): Score => scoreTablesByExactParser(baseTables(), samples)

// A disputed code point of a case: its position in the broken program, whether a score would count it, and the label
// by each repair, or undefined where that repair calls the code point added. The disputed code points are in no
// sample. They are listed here so that a reader can hold a parser against both readings.
export type Label = {kind: number, depth: number, container: number}
export type DisputedCodePoint = {id: string, position: number, fromFirstError: boolean, writer: Label | undefined, second: Label | undefined}
export function disputedCodePointsOf(cases: readonly WrittenCase[]): DisputedCodePoint[] {
  const labelOf = (sample: Sample, position: number): Label | undefined =>
    sample.alignment[position] === -1 ? undefined : {kind: sample.labelKind[position]!, depth: sample.labelDepth[position]!, container: sample.labelContainer[position]!}
  return cases.flatMap(writtenCase => writtenCase.agreement.flatMap((state, position) => state !== 'disputed' ? [] : [{
    id: writtenCase.id, position, fromFirstError: position >= writtenCase.sample.firstErrorPosition,
    writer: labelOf(writtenCase.opinions[0]!.sample, position), second: labelOf(writtenCase.opinions[1]!.sample, position),
  }]))
}

if (import.meta.main) {
  const folder = setFolderOf(process.argv.slice(2))
  const parts = partsOfWritten(folder)
  const number = (value: number, digits = 1) => Number.isNaN(value) ? 'none' : value.toFixed(digits)
  console.log(`The written set in ${folder}, and what the parser as it is gets right on it. Per row: the cases, their scored code points, the share of them that one`)
  console.log('output per token can have right, and of the scored code points the share with display kind, depth and container right, the share of the cases with')
  console.log('every scored code point right, the shares with the kind, the depth and the container right, the share whose token is taken on the stack that')
  console.log('the repaired program has there, and of the constituents of the repaired programs the share that the parser has, then of the parser\'s the share')
  console.log('that the repaired programs have.\n')
  console.log('| Cases | Count | Scored code points | One output per token allows | All three | Whole | Kind | Depth | Container | Stack | Constituents: found, right |')
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const {name, samples} of rowsOfParts(parts)) {
    const score = scoreOfParserAsItIs(samples)
    const shares = sharesOf(score)
    const packed = packSamples(samples)
    console.log(`| ${name} | ${score.samples} | ${score.scoredCodePoints.toLocaleString('en-US')} | ${number(100 * packed.boundCodePoints / packed.scoredCodePoints)} | ${number(shares.allThree)} | ${number(shares.whole)} | ${number(shares.kind)} | ${number(shares.depth)} | ${number(shares.container)} | ${number(shares.stack)} | ${number(shares.constituentsFound)}, ${number(shares.constituentsRight)} |`)
  }
  const main = scoreOfParserAsItIs(parts.all.fullAgreement)
  console.log(`\nIn the cases with full agreement the parser as it is has ${main.allThreeRight.toLocaleString('en-US')} of ${main.scoredCodePoints.toLocaleString('en-US')} scored code points right, and every scored code point in ${main.wholeSamples} of ${main.samples} cases.`)
}
