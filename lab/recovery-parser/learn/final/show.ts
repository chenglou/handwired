// Shows one text of the final scoring as aligned rows, with what named tables show for it in the exact parser, and
// lists the texts that one tables have right as a whole and another tables do not. The final report takes its
// examples from here.
//
// Run from the repo root, with RECOVERY_SCRATCH set to the experiment's scratch folder:
//   bun lab/recovery-parser/learn/final/show.ts --case <id> [--nesting] <tables> ...
//   bun lab/recovery-parser/learn/final/show.ts --sample <seed>:<index> [--nesting] <tables> ...
//   bun lab/recovery-parser/learn/final/show.ts --differs <a> <b> [--in written] [--limit 30] <tables> ...
// <tables> is <name>=<tables.json>, a file of saved tables under a name, or one of the names that need no file: now
// for today's tables, stay, resync, words and lines for the dataset's hand rules, and hand-written for the 35 rules
// of ../handwritten/rules.ts.
//
// --case shows a case of the written set by its id, e.g. documents-and-web-01, and --sample a sample of the dataset
// by its seed and index, e.g. 20261015:163. The rows, one column per code point (⏎ is a line feed, → a tab):
//   text   the broken text, on one line
//   want   the label's display kind: w white space, p punctuation, s string, e escape, n number, l literal, k key.
//          Blank where the code point has no label, ? where the display kind is not scored.
//   first  ^ under the first error of today's parser, from which on a score counts, and d under the first damaged
//          code point when that comes earlier.
//   Then per tables, under the tables' name: the display kind that the tables show, where E is an error and . is
//   past the end, and a row `miss` with k, d or c where the display kind, the depth or the container is wrong, and *
//   for more than one. Only the code points that a score counts are compared.
// --nesting adds the label's depth and container (wantd, wantc: ? where they are not scored) and per tables the
// depth and the container that the tables give: 0 to 9, then a to g, - below 0, + above 16, and o object, a array,
// - none.
//
// --differs a b lists the texts that the tables named a have right as a whole and the tables named b do not, and
// the other way round, each with how many of its scored code points the other tables have right. --in says which
// texts: written for the cases of the written set, which is the default, or validation or test for the broken
// samples of that split of the standard set. --limit is the most texts that each of the two lists prints.
//
// What needs the environment variable RECOVERY_FINAL set to yes: a case of the written set with tables other than
// the five of scoredOnTheSetAlready in written-score.ts (now and the dataset's hand rules), and every sample of the
// test split, with any tables. Every run with RECOVERY_FINAL=yes appends a line to
// <RECOVERY_SCRATCH>/arms/final-runs.log before it reads a case or a sample.
import {readFileSync} from 'node:fs'
import {errorKinds} from '../../../../src/json-search/highlighter/kinds.ts'
import {visible} from '../../dump.ts'
import {type Label, kindLetters} from '../../labels.ts'
import {groupOf, labelsOf} from '../../samples.ts'
import {type WrittenCase, labelsOfWritten} from '../../written/written.ts'
import {validationOfTheStandardSet} from '../arms/harness.ts'
import {type Samples, allowedSampleAt, codePointScored, finalIsAllowed, groupNames, heldOutByKind, heldOutByTemplate, kindsOf, refuseUnknownOptions, standardRange} from '../data.ts'
import {handwrittenTables} from '../handwritten/rules.ts'
import {createTrace} from '../recovery-parser.ts'
import {type RecoveryTables, loadTablesOfThisDataset} from '../recovery-tables.ts'
import {runOnSample, wrongContainer, wrongDepth, wrongKind, wrongLabelsAt} from '../score.ts'
import {appendToTheLogOfFinalRuns, testSplitOfTheStandardSet} from './run.ts'
import {type ReaderOfTheSet, countText, exactParserWith, isWhole, readersOfTheSet, requireFinalOnTheWrittenSet, tablesOfReader, writtenCases, wrongValuesAt} from './written-score.ts'

export type NamedTables = {name: string, file: string | null, hash: string | null, tables: RecoveryTables}

// The tables that a command names: <name>=<tables.json>, or a name that needs no file. Throws for another argument,
// for a name that stands twice, and for a file that was not saved with the dataset as it is now.
export function namedTablesOf(parameters: readonly string[]): NamedTables[] {
  const withoutFile = [...readersOfTheSet, 'hand-written']
  const named = parameters.map((parameter): NamedTables => {
    if (readersOfTheSet.includes(parameter as ReaderOfTheSet)) return {name: parameter, file: null, hash: null, tables: tablesOfReader(parameter as ReaderOfTheSet)}
    if (parameter === 'hand-written') return {name: parameter, file: null, hash: null, tables: handwrittenTables().tables}
    const at = parameter.indexOf('=')
    if (at <= 0 || at === parameter.length - 1) throw new Error(`final/show.ts takes tables as <name>=<tables.json> or as one of ${withoutFile.join(', ')}, and got ${JSON.stringify(parameter)}`)
    const file = parameter.slice(at + 1)
    return {name: parameter.slice(0, at), file, hash: Bun.hash(readFileSync(file)).toString(16), tables: loadTablesOfThisDataset(file).tables}
  })
  const twice = named.find((tables, at) => named.findIndex(other => other.name === tables.name) !== at)
  if (twice !== undefined) throw new Error(`final/show.ts got the name ${JSON.stringify(twice.name)} for two tables`)
  return named
}

// A text to show: a case of the written set or a sample of the dataset.
export type ShownText = {
  // What the first line says about the text, after its id.
  id: string
  about: string
  broken: string
  // One entry per code point of the broken text, as labelsOf of ../../samples.ts gives them for a sample.
  labels: (Label | undefined)[]
  // The first error of today's parser, or -1 in a valid sample, and the first damaged code point.
  firstErrorPosition: number
  firstDamage: number
}

export function textOfCase(writtenCase: WrittenCase): ShownText {
  const disputed = writtenCase.agreement.filter((state, position) => state === 'disputed' && position >= writtenCase.firstErrorPosition).length
  const damage = writtenCase.damage === undefined ? '' : `  kinds: ${writtenCase.damage.kinds.length === 0 ? 'none' : writtenCase.damage.kinds.join(', ')}${writtenCase.damage.other === undefined ? '' : `  damage that no kind makes: ${writtenCase.damage.other}`}`
  return {
    id: writtenCase.id,
    about: `${writtenCase.file}  from: ${writtenCase.from}${damage}${writtenCase.debatable ? '  debatable' : ''}  first error: ${errorKinds[writtenCase.firstErrorKind]}${disputed === 0 ? '' : `  ${disputed} disputed code point${disputed === 1 ? '' : 's'} from the first error on, so the case is not among the cases with full agreement`}`,
    broken: writtenCase.broken, labels: labelsOfWritten(writtenCase), firstErrorPosition: writtenCase.firstErrorPosition, firstDamage: writtenCase.firstDamage,
  }
}

const depthLetter = (depth: number | undefined) => depth === undefined ? '?' : depth < 0 ? '-' : depth > 16 ? '+' : '0123456789abcdefg'[depth]!
const containerLetter = (container: number | undefined) => container === undefined ? '?' : '-oa'[container] ?? '?'
const missLetter = (wrong: number) => wrong === 0 ? ' ' : wrong === wrongKind ? 'k' : wrong === wrongDepth ? 'd' : wrong === wrongContainer ? 'c' : '*'

// The rows of one text, see the top of this file.
export function describeText(text: ShownText, named: readonly NamedTables[], withNesting: boolean): string[] {
  const {labels, firstErrorPosition} = text
  const perCodePoint = (letter: (position: number) => string) => Array.from({length: labels.length}, (_, position) => letter(position)).join('')
  const ofLabel = (letter: (label: Label) => string) => perCodePoint(position => {
    const label = labels[position]
    return label === undefined ? ' ' : letter(label)
  })
  const rows: [name: string, letters: string][] = [
    ['text', visible(text.broken)],
    ['want', ofLabel(label => label.kind === undefined ? '?' : kindLetters[label.kind]!)],
    ...(withNesting ? [['wantd', ofLabel(label => depthLetter(label.depth))], ['wantc', ofLabel(label => containerLetter(label.container))]] as [string, string][] : []),
    ['first', perCodePoint(position => position === firstErrorPosition ? '^' : position === text.firstDamage ? 'd' : ' ')],
  ]
  const summaries: string[] = []
  for (const {name, tables} of named) {
    const shown = exactParserWith(tables)(text.broken)
    const counts = countText(labels, firstErrorPosition, shown)
    summaries.push(`    ${name}: ${counts.scored - counts.right} of ${counts.scored} scored code points are wrong`)
    rows.push([name, perCodePoint(position => kindLetters[shown.displayKind[position]!] ?? '?')])
    if (withNesting) rows.push(['  depth', perCodePoint(position => depthLetter(shown.depthAfter[position]))], ['  container', perCodePoint(position => containerLetter(shown.containerAfter[position]))])
    rows.push(['  miss', perCodePoint(position => firstErrorPosition !== -1 && position >= firstErrorPosition ? missLetter(wrongValuesAt(labels[position], shown, position)) : ' ')])
  }
  const nameWidth = Math.max(...rows.map(([name]) => name.length)) + 2
  return [`--- ${text.id}  ${text.about}`, ...summaries, ...rows.map(([name, letters]) => `${name.padEnd(nameWidth)}${letters}`.trimEnd())]
}

// What says whether a text is right as a whole: its scored code points, and how many of them are right.
type TextCounts = {scored: number, right: number}

// Per broken sample of `samples`, in the order of their places: the sample's place and its counts with `tables`.
function countsOfSamples(tables: RecoveryTables, samples: Samples): (TextCounts & {place: number})[] {
  const trace = createTrace()
  const counted: (TextCounts & {place: number})[] = []
  for (let place = 0; place < samples.sampleCount; place++) {
    if (samples.firstDamage[place] === -1) continue
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    runOnSample(trace, samples, place, tables)
    let scored = 0
    let right = 0
    for (let position = samples.firstErrorPosition[place]!; position < length; position++) {
      if ((samples.flags[start + position]! & codePointScored) === 0) continue
      scored++
      if (wrongLabelsAt(samples, start + position, trace, position) === 0) right++
    }
    counted.push({place, scored, right})
  }
  return counted
}

// The two lists of --differs: the texts that are whole for the first tables and not for the second, and the other
// way round. `counted` has, per text, what the list says about it and its counts with each of the two tables.
export function describeDiffers(what: string, names: readonly [string, string], counted: readonly {about: string, counts: readonly [TextCounts, TextCounts]}[], limit: number): string[] {
  const withSomething = counted.filter(({counts}) => counts[0].scored > 0)
  const wholeFor = (which: 0 | 1) => withSomething.filter(({counts}) => isWhole(counts[which]))
  const lines = [`${what}: ${counted.length} broken texts, ${withSomething.length} of them with something to recover. Right as a whole: ${wholeFor(0).length} for ${names[0]}, ${wholeFor(1).length} for ${names[1]}, ${wholeFor(0).filter(({counts}) => isWhole(counts[1])).length} for both.`]
  for (const which of [0, 1] as const) {
    const other = which === 0 ? 1 : 0
    const only = wholeFor(which).filter(({counts}) => !isWhole(counts[other]))
    lines.push('', `Whole for ${names[which]} and not for ${names[other]}: ${only.length}${only.length > limit ? `, of which the first ${limit} follow` : ''}.`)
    for (const {about, counts} of only.slice(0, limit)) lines.push(`  ${about}  ${names[other]} has ${counts[other].right} of ${counts[other].scored} scored code points right`)
  }
  return lines
}

if (import.meta.main) {
  const valuesOfOption: Record<string, number> = {'--case': 1, '--sample': 1, '--differs': 2, '--in': 1, '--limit': 1}
  refuseUnknownOptions('final/show.ts', [...Object.keys(valuesOfOption), '--nesting'])
  const options = new Map<string, string[]>()
  const parameters: string[] = []
  const argv = process.argv.slice(2)
  for (let at = 0; at < argv.length; at++) {
    const argument = argv[at]!
    const valueCount = valuesOfOption[argument]
    if (valueCount === undefined) {
      if (!argument.startsWith('--')) parameters.push(argument)
      continue
    }
    const values = argv.slice(at + 1, at + 1 + valueCount)
    if (values.length < valueCount || values.some(value => value.startsWith('--'))) throw new Error(`final/show.ts ${argument} takes ${valueCount} value${valueCount === 1 ? '' : 's'}`)
    options.set(argument, values)
    at += valueCount
  }
  const modes = ['--case', '--sample', '--differs'].filter(mode => options.has(mode))
  if (modes.length !== 1) throw new Error('final/show.ts takes one of --case <id>, --sample <seed>:<index> and --differs <a> <b>')
  const named = namedTablesOf(parameters)
  if (named.length === 0) throw new Error('final/show.ts needs tables: <name>=<tables.json>, or one of now, stay, resync, words, lines and hand-written')
  const withNesting = process.argv.includes('--nesting')
  // A run with RECOVERY_FINAL may read the test split and show any tables on the written set, so it says in the log
  // of the final runs what it was asked for and with which tables, before it reads a case or a sample.
  if (finalIsAllowed()) {
    const scratch = process.env['RECOVERY_SCRATCH']
    if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to the experiment\'s scratch folder: a run of final/show.ts with RECOVERY_FINAL appends a line to <RECOVERY_SCRATCH>/arms/final-runs.log')
    appendToTheLogOfFinalRuns(scratch, new Date(), `final/show.ts ${argv.filter(argument => !argument.includes('=')).join(' ')}`, named.map(({name, file, hash}) => ({name, file, hash})))
  }
  // The cases of the written set, for these tables: refused without RECOVERY_FINAL for any tables but the five that
  // may be scored on the set already.
  const casesFor = (tables: readonly NamedTables[]) => {
    for (const {name, tables: ofName} of tables) requireFinalOnTheWrittenSet(ofName, `final/show.ts with the tables ${JSON.stringify(name)} on the written set`)
    return writtenCases()
  }

  const caseId = options.get('--case')?.[0]
  const sampleId = options.get('--sample')?.[0]
  const differs = options.get('--differs')
  if (caseId !== undefined) {
    const writtenCase = casesFor(named).find(candidate => candidate.id === caseId)
    if (writtenCase === undefined) throw new Error(`the written set has no case ${JSON.stringify(caseId)}`)
    console.log(describeText(textOfCase(writtenCase), named, withNesting).join('\n'))
  } else if (sampleId !== undefined) {
    const [, seed, index] = /^(\d+):(\d+)$/.exec(sampleId) ?? []
    if (seed === undefined || index === undefined) throw new Error(`final/show.ts --sample takes <seed>:<index>, e.g. ${standardRange.seed}:163, and got ${JSON.stringify(sampleId)}`)
    const sample = allowedSampleAt(Number(seed), Number(index))
    if (sample === undefined) throw new Error(`final/show.ts: the sample ${sampleId} is in the test split, which is for final numbers only. Nothing in learn/ reads it unless the environment variable RECOVERY_FINAL is set to yes, see final/README.md.`)
    const about = `split: ${sample.split}  kinds: ${sample.kinds.length === 0 ? 'none' : sample.kinds.join(', ')}${sample.source === 'valid' ? '  valid' : `  group: ${groupOf(sample)}`}${sample.heldOut.length === 0 ? '' : `  held out: ${sample.heldOut.join(', ')}`}${sample.debatable ? '  debatable' : ''}`
    console.log(describeText({id: sample.id, about, broken: sample.broken, labels: labelsOf(sample), firstErrorPosition: sample.source === 'valid' ? -1 : sample.firstErrorPosition, firstDamage: sample.firstDamage}, named, withNesting).join('\n'))
  } else if (differs !== undefined) {
    const [first, second] = differs.map(name => {
      const tables = named.find(candidate => candidate.name === name)
      if (tables === undefined) throw new Error(`final/show.ts --differs names the tables ${JSON.stringify(name)}, and the command's tables are ${named.map(candidate => candidate.name).join(', ')}`)
      return tables
    }) as [NamedTables, NamedTables]
    const names = [first.name, second.name] as const
    const limit = Number(options.get('--limit')?.[0] ?? 30)
    if (!Number.isInteger(limit) || limit < 0) throw new Error(`final/show.ts --limit takes a whole number, and got ${JSON.stringify(options.get('--limit')?.[0])}`)
    const within = options.get('--in')?.[0] ?? 'written'
    if (within === 'written') {
      const cases = casesFor([first, second])
      const shown = [exactParserWith(first.tables), exactParserWith(second.tables)] as const
      const countsWith = (which: 0 | 1, writtenCase: WrittenCase) => countText(labelsOfWritten(writtenCase), writtenCase.firstErrorPosition, shown[which](writtenCase.broken))
      const counted = cases.map(writtenCase => ({
        about: `${writtenCase.id}${writtenCase.disputedFromFirstError ? '  has a disputed code point, so it is not among the cases with full agreement' : ''}`,
        counts: [countsWith(0, writtenCase), countsWith(1, writtenCase)] as const,
      }))
      console.log(describeDiffers('The written set, the agreed code points of every case', names, counted, limit).join('\n'))
    } else if (within === 'validation' || within === 'test') {
      const samples = within === 'test' ? testSplitOfTheStandardSet() : validationOfTheStandardSet()
      const ofFirst = countsOfSamples(first.tables, samples)
      const ofSecond = countsOfSamples(second.tables, samples)
      const counted = ofFirst.map((counts, at) => {
        const {place} = counts
        const heldOut = samples.heldOut[place]!
        const heldOutBy = [...((heldOut & heldOutByKind) === 0 ? [] : ['a kind']), ...((heldOut & heldOutByTemplate) === 0 ? [] : ['the template'])]
        return {
          about: `${samples.seed}:${samples.index[place]}  kinds: ${kindsOf(samples, place).join(', ')}  group: ${groupNames[samples.group[place]!]}${heldOutBy.length === 0 ? '' : `  held out: ${heldOutBy.join(' and ')}`}`,
          counts: [counts, ofSecond[at]!] as const,
        }
      })
      console.log(describeDiffers(`The ${within} split of the standard set`, names, counted, limit).join('\n'))
    } else {
      throw new Error(`final/show.ts --in takes written, validation or test, and got ${JSON.stringify(within)}`)
    }
  }
}
