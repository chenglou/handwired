// Where the trained tables of the final scoring are above and below the one rule (row 2) and the hand-written
// rules (row 3) on the two held-back sets, and why: per kind of mistake of the generator and per written case.
//
// Run from the repo root:
//   RECOVERY_FINAL=yes bun lab/recovery-toml/held-back/final/where/report.ts > <held-back scratch>/final-where/where.txt
//   RECOVERY_FINAL=yes bun lab/recovery-toml/held-back/final/where/report.ts --cases > <held-back scratch>/final-where/written-cases.txt
// It trains nothing and changes no table. load.ts holds every count of this file against the saved counts of the
// one final run, so each table here breaks a number of the final report into parts.
//
// Words: a code point is "counted" when a score counts it, i.e. from the first error of the parser as it is on, with
// a label that has a scored value. It is "right" when the display kind, the depth and the container are right ("all
// three"). A text is "whole" when every counted code point is right. A number of a row with several seeds is the
// mean over its seeds.
import {grammarStateNames} from '../../../learn/recovery-tables.ts'
import {kinds as generatorKinds} from '../../specific/mistakes.ts'
import {couldComeFromEdits, neutralEditsOf} from '../../written/neutral-edits.ts'
import {type Loaded, type ScoredParser, type SetKey, headerNameKind, heldBackLine, loadAll, meanOf, notCounted, parsersOfRow, right, traceOf} from './load.ts'
import {type Held, generatorTags, trainingKindsWithoutAGeneratorKind, writtenTags} from './tags.ts'

const loaded: Loaded = loadAll()
const rows = ['1', '2', '3', '4', '5', '6', '7', '8'] as const
const setKeys: SetKey[] = ['generator', 'written']
const fullAgreement = 'cases with full agreement'

// The part of a text that a counted code point is in: the line of the first error, a later line that holds the name
// of a header, or another later line.
const errorLine = 0
const laterHeaderLine = 1
const otherLaterLine = 2
const partNames = ['the line of the first error', 'later lines with a header', 'other later lines']
const partOf: Record<SetKey, Uint8Array[]> = {generator: [], written: []}
for (const set of setKeys) {
  partOf[set] = loaded.sets[set].texts.map(text => {
    const codePoints = Array.from(text.broken)
    const parts = new Uint8Array(codePoints.length)
    let lineStart = 0
    for (let position = 0; position <= codePoints.length; position++) {
      if (position < codePoints.length && codePoints[position] !== '\n') continue
      const lineEnd = Math.min(position, codePoints.length - 1)
      const holdsFirstError = text.firstErrorPosition >= lineStart && text.firstErrorPosition <= lineEnd
      let holdsHeaderName = false
      for (let at = lineStart; at <= lineEnd; at++) if (text.labels[at]?.kind === headerNameKind) holdsHeaderName = true
      for (let at = lineStart; at <= lineEnd; at++) parts[at] = holdsFirstError ? errorLine : holdsHeaderName ? laterHeaderLine : otherLaterLine
      lineStart = position + 1
    }
    return parts
  })
}

// Per parser, set and text: the right code points per part. Per set and text: the counted code points per part.
type PerPart = [number, number, number]
const countedPerPart: Record<SetKey, PerPart[]> = {generator: [], written: []}
const rightPerPart = new Map<ScoredParser, Record<SetKey, PerPart[]>>()
for (const set of setKeys) {
  countedPerPart[set] = loaded.sets[set].texts.map((_text, at) => {
    const counts: PerPart = [0, 0, 0]
    loaded.parsers[0]!.outcomes[set][at]!.forEach((outcome, position) => { if (outcome !== notCounted) counts[partOf[set][at]![position]!]!++ })
    return counts
  })
}
for (const parser of loaded.parsers) {
  const perSet: Record<SetKey, PerPart[]> = {generator: [], written: []}
  for (const set of setKeys) {
    perSet[set] = parser.outcomes[set].map((outcomes, at) => {
      const counts: PerPart = [0, 0, 0]
      outcomes.forEach((outcome, position) => { if (outcome === right) counts[partOf[set][at]![position]!]!++ })
      return counts
    })
  }
  rightPerPart.set(parser, perSet)
}

const allParts = [errorLine, laterHeaderLine, otherLaterLine]
const withoutLaterHeaders = [errorLine, otherLaterLine]
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)
const countedOf = (set: SetKey, places: readonly number[], parts: readonly number[] = allParts) => sum(places.map(at => sum(parts.map(part => countedPerPart[set][at]![part]!))))
const rightOfParser = (parser: ScoredParser, set: SetKey, places: readonly number[], parts: readonly number[] = allParts) => sum(places.map(at => sum(parts.map(part => rightPerPart.get(parser)![set][at]![part]!))))
// The mean over a row's seeds of the right code points in some texts and parts.
const rightOfRow = (row: string, set: SetKey, places: readonly number[], parts: readonly number[] = allParts) => meanOf(parsersOfRow(loaded, row).map(parser => rightOfParser(parser, set, places, parts)))
// Whether a parser has every counted code point of the given parts of a text right, in a text that has one.
const wholeIn = (parser: ScoredParser, set: SetKey, at: number, parts: readonly number[] = allParts) => {
  const counted = sum(parts.map(part => countedPerPart[set][at]![part]!))
  return counted > 0 && sum(parts.map(part => rightPerPart.get(parser)![set][at]![part]!)) === counted
}
const wholeOfRow = (row: string, set: SetKey, places: readonly number[], parts: readonly number[] = allParts) => meanOf(parsersOfRow(loaded, row).map(parser => places.filter(at => wholeIn(parser, set, at, parts)).length))
const withSomething = (set: SetKey, places: readonly number[]) => places.filter(at => loaded.scored[set][at]! > 0)

const share = (part: number, whole: number, digits = 1) => whole === 0 ? '-' : (100 * part / whole).toFixed(digits)
const signed = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value)).toLocaleString('en-US')}`
const number = (value: number) => Math.round(value).toLocaleString('en-US')
const out = (line = '') => console.log(line)
const table = (lines: string[][]) => {
  const widths = lines[0]!.map((_cell, column) => Math.max(...lines.map(line => (line[column] ?? '').length)))
  for (const line of lines) out(line.map((cell, column) => column === 0 ? cell.padEnd(widths[column]!) : cell.padStart(widths[column]!)).join('  ').trimEnd())
}

const placesOfSet: Record<SetKey, number[]> = {
  generator: loaded.sets.generator.texts.map((_text, at) => at),
  written: loaded.sets.written.texts.flatMap((text, at) => text.rows.includes(fullAgreement) ? [at] : []),
}
const setTitles: Record<SetKey, string> = {generator: 'the generator\'s set, 3,000 samples', written: 'the written cases with full agreement, 144 cases'}

// The written cases one by one: what each row has right.
if (process.argv.includes('--cases')) {
  out(heldBackLine)
  out()
  out('Every written case: the counted code points, and how many of them each row has right. A row with several seeds shows the mean with the lowest and the highest seed. "D" marks a case with a disputed code point from the first error on, which is not among the cases with full agreement. The tag says whether a kind of the training side holds the mistake, by one reader\'s judgment (tags.ts).')
  out()
  const lines = [['case', '', 'counted', 'row 1', 'row 2', 'row 3', 'row 4', 'row 5', 'row 6', 'row 7', 'row 8', 'tag']]
  loaded.writtenCases.forEach((writtenCase, at) => {
    const cells = rows.map(row => {
      const values = parsersOfRow(loaded, row).map(parser => rightOfParser(parser, 'written', [at]))
      return values.length === 1 ? String(values[0]) : `${meanOf(values).toFixed(0)} (${Math.min(...values)}-${Math.max(...values)})`
    })
    lines.push([writtenCase.id, writtenCase.disputedFromFirstError ? 'D' : '', String(loaded.scored.written[at]), ...cells, writtenTags[writtenCase.id]!.held])
  })
  table(lines)
  out()
  out('What each case is, in its writer\'s words, and the training kind that the tag names:')
  loaded.writtenCases.forEach(writtenCase => out(`${writtenCase.id}: ${writtenCase.from}. [${writtenTags[writtenCase.id]!.held}: ${writtenTags[writtenCase.id]!.kinds}]`))
  process.exit(0)
}

out(heldBackLine)
out()
out('Where the trained tables are above and below the one rule and the hand-written rules on the two held-back sets. Made by lab/recovery-toml/held-back/final/where/report.ts from the 24 files of tables of the final scoring. Nothing was trained or changed, and every count per text and parser is the one of the final run.')
out('Rows: 1 the parser as it is, 2 the one rule (anew at the next line after an error), 3 the hand-written rules, 4 the recipe on neutral damage without the search, 5 the same with the search, 6 the search without training, 7 the recipe on the mixed set without the search, 8 the same with the search. A number of the rows 4 to 8 is the mean over the seeds.')
out()

// 1. Where the wrong code points are.
out('## 1. Where the wrong code points are')
out()
out('A counted code point is in one of three parts of its text: the line of the first error, a later line that holds the name of a header, e.g. `[server.tls]`, with its brackets, dots and line end, and every other later line.')
for (const set of setKeys) {
  const places = placesOfSet[set]
  out()
  out(`${setTitles[set]}: wrong code points per part`)
  table([
    ['part', 'counted', ...rows.map(row => `row ${row}`)],
    ...allParts.map(part => [partNames[part]!, number(countedOf(set, places, [part])), ...rows.map(row => number(countedOf(set, places, [part]) - rightOfRow(row, set, places, [part])))]),
    ['all', number(countedOf(set, places)), ...rows.map(row => number(countedOf(set, places) - rightOfRow(row, set, places)))],
  ])
  out(`${setTitles[set]}: right, in percent`)
  table([
    ['part', 'counted', ...rows.map(row => `row ${row}`)],
    ...allParts.map(part => [partNames[part]!, number(countedOf(set, places, [part])), ...rows.map(row => share(rightOfRow(row, set, places, [part]), countedOf(set, places, [part]), 2))]),
    ['all but later lines with a header', number(countedOf(set, places, withoutLaterHeaders)), ...rows.map(row => share(rightOfRow(row, set, places, withoutLaterHeaders), countedOf(set, places, withoutLaterHeaders), 2))],
    ['all', number(countedOf(set, places)), ...rows.map(row => share(rightOfRow(row, set, places), countedOf(set, places), 2))],
  ])
  const withLaterHeader = places.filter(at => countedPerPart[set][at]![laterHeaderLine] > 0)
  out(`${withLaterHeader.length} of ${places.length} texts have a later line with a header.`)
  out('whole texts, in percent of the texts with something to recover, and whole when later lines with a header are not counted')
  table([
    ['', ...rows.map(row => `row ${row}`)],
    ['whole', ...rows.map(row => share(wholeOfRow(row, set, places), withSomething(set, places).length))],
    ['whole, later header lines not counted', ...rows.map(row => share(wholeOfRow(row, set, places, withoutLaterHeaders), places.filter(at => sum(withoutLaterHeaders.map(part => countedPerPart[set][at]![part]!)) > 0).length))],
  ])
}

// Why the later headers are lost: the grammar state at the start of a later line.
out()
out('### The grammar state at the start of a later line')
out()
out('Today\'s tables read a header only from the grammar state `lineStart`: there the `[` opens a header and no array, a key between quotes is a key and no string, and a key such as `name` or `timeout` is not read as the start of `nan` or `true`. The table counts the starts of the lines after the first error\'s line at which the wanted depth is 0, and says in which grammar state each parser is there. The last columns count the code points of those lines by the state in which the parser enters the line. The rule (row 2) has no state of the tables: it starts anew.')
const errorState = grammarStateNames.indexOf('error')
const lineStartState = grammarStateNames.indexOf('lineStart')
for (const set of setKeys) {
  const places = placesOfSet[set]
  const lines = [['row', 'line starts', 'in lineStart', 'in error', 'in another state', 'at depth 0', 'in lineStart, per seed', 'header names right, per seed', 'counted on lines entered in lineStart', 'right', 'counted on lines entered otherwise', 'right']]
  for (const row of rows) {
    if (row === '2') continue
    const perSeed = parsersOfRow(loaded, row).map(parser => {
      const counts = {starts: 0, lineStart: 0, error: 0, depthZero: 0, namesRight: 0, names: 0, enteredCounted: 0, enteredRight: 0, otherwiseCounted: 0, otherwiseRight: 0}
      for (const at of places) {
        const text = loaded.sets[set].texts[at]!
        if (text.firstErrorPosition === -1) continue
        const trace = traceOf(parser.tables!, text.broken)
        const outcomes = parser.outcomes[set][at]!
        const codePoints = Array.from(text.broken)
        // Whether the line of the current position is entered in lineStart, or undefined for a line that is not
        // counted here: the line of the first error, and a line that starts inside an array or an inline table.
        let enteredInLineStart: boolean | undefined
        for (let position = text.firstErrorPosition + 1; position < codePoints.length; position++) {
          if (codePoints[position - 1] === '\n') {
            const before = text.labels[position - 1]
            enteredInLineStart = before === undefined || before.depth !== 0 ? undefined : trace.grammarBefore[position] === lineStartState
            if (enteredInLineStart !== undefined) {
              counts.starts++
              if (enteredInLineStart) counts.lineStart++
              if (trace.grammarBefore[position] === errorState) counts.error++
              if (trace.depthAfter[position - 1] === 0) counts.depthZero++
            }
          }
          if (enteredInLineStart === undefined || outcomes[position] === notCounted) continue
          if (enteredInLineStart) {
            counts.enteredCounted++
            if (outcomes[position] === right) counts.enteredRight++
          } else {
            counts.otherwiseCounted++
            if (outcomes[position] === right) counts.otherwiseRight++
          }
        }
        outcomes.forEach((outcome, position) => {
          if (outcome === notCounted || text.labels[position]?.kind !== headerNameKind) return
          counts.names++
          if (outcome === right) counts.namesRight++
        })
      }
      return counts
    })
    const mean = (pick: (counts: typeof perSeed[number]) => number) => meanOf(perSeed.map(pick))
    lines.push([
      `row ${row}`, number(perSeed[0]!.starts), `${share(mean(counts => counts.lineStart), perSeed[0]!.starts)}%`, `${share(mean(counts => counts.error), perSeed[0]!.starts)}%`,
      `${share(mean(counts => counts.starts - counts.lineStart - counts.error), perSeed[0]!.starts)}%`, `${share(mean(counts => counts.depthZero), perSeed[0]!.starts)}%`,
      perSeed.map(counts => share(counts.lineStart, counts.starts, 0)).join(' '), perSeed.map(counts => share(counts.namesRight, counts.names, 0)).join(' '),
      number(mean(counts => counts.enteredCounted)), `${share(mean(counts => counts.enteredRight), mean(counts => counts.enteredCounted))}%`,
      number(mean(counts => counts.otherwiseCounted)), `${share(mean(counts => counts.otherwiseRight), mean(counts => counts.otherwiseCounted))}%`,
    ])
  }
  out()
  out(setTitles[set])
  table(lines)
}

// 2. Per kind of the generator.
out()
out('## 2. The generator\'s set per kind of mistake: the rows 4 and 7 against the rows 2 and 3')
out()
out('A row of a kind counts the samples with that kind, alone or with a second mistake, as the final report does, so a sample with two kinds is in two rows and the rows do not add up to the line "all". "Outside later header lines" leaves out the later lines with a header, which the rows 4 and 7 lose for one reason in every kind (section 1). A difference is in code points, the mean over the seeds.')
const samples = loaded.generatorSamples
const kindNames = generatorKinds.map(kind => kind.name)
const placesOfKind = (kind: string) => samples.flatMap((sample, at) => sample.kinds.includes(kind) ? [at] : [])
{
  const header = ['kind', 'samples', 'counted', 'row 2', 'row 3', 'row 4', 'row 7', '4−2', '7−2', '4−3', '7−3', 'counted', 'row 2', 'row 4', 'row 7', '4−2', '7−2']
  const lineOf = (name: string, places: readonly number[]) => {
    const outside = countedOf('generator', places, withoutLaterHeaders)
    const rightOutside = (row: string) => rightOfRow(row, 'generator', places, withoutLaterHeaders)
    const onHeaders = countedOf('generator', places, [laterHeaderLine])
    const rightOnHeaders = (row: string) => rightOfRow(row, 'generator', places, [laterHeaderLine])
    return [
      name, String(places.length), number(outside), ...['2', '3', '4', '7'].map(row => share(rightOutside(row), outside)),
      signed(rightOutside('4') - rightOutside('2')), signed(rightOutside('7') - rightOutside('2')), signed(rightOutside('4') - rightOutside('3')), signed(rightOutside('7') - rightOutside('3')),
      number(onHeaders), ...['2', '4', '7'].map(row => share(rightOnHeaders(row), onHeaders, 0)), signed(rightOnHeaders('4') - rightOnHeaders('2')), signed(rightOnHeaders('7') - rightOnHeaders('2')),
    ]
  }
  out()
  out('Columns: the kind, its samples; then outside later header lines: the counted code points, the share right of the rows 2, 3, 4 and 7 in percent, and the differences in code points; then on later header lines: the counted code points, the share right of the rows 2, 4 and 7, and the differences.')
  table([header, ...kindNames.map(kind => lineOf(kind, placesOfKind(kind))), lineOf('all', placesOfSet.generator)])

  out()
  out('Whole samples per kind, as counts: the samples of the kind, the whole ones of the rows 2, 3, 4 and 7, and the same when later header lines are not counted.')
  table([
    ['kind', 'samples', 'row 2', 'row 3', 'row 4', 'row 7', 'row 2, no headers', 'row 3, no headers', 'row 4, no headers', 'row 7, no headers'],
    ...[...kindNames, 'all'].map(kind => {
      const places = kind === 'all' ? placesOfSet.generator : placesOfKind(kind)
      return [kind, String(places.length), ...['2', '3', '4', '7'].map(row => wholeOfRow(row, 'generator', places).toFixed(0)), ...['2', '3', '4', '7'].map(row => wholeOfRow(row, 'generator', places, withoutLaterHeaders).toFixed(0))]
    }),
  ])
}

// 3. What row 7 has over row 4.
out()
out('## 3. What the kinds written for the training side add: row 7 against row 4, and row 8 against row 5')
out()
out('The damage of a sample "could come from neutral edits" when one to three of the ten edits of the train data make it out of the document, as ../../written/neutral-edits.ts derives it for the written cases. Such a text could have been a train sample of the rows 4 to 6, on another document.')
const neutralOfGenerator = samples.map(sample => couldComeFromEdits(neutralEditsOf({broken: sample.broken, opinions: [{name: 'writer', text: sample.original, note: undefined, unsure: undefined, alignment: sample.alignment, replaced: sample.replaced, labels: []}]})))
const neutralOfWritten = loaded.writtenCases.map(writtenCase => writtenCase.damage !== undefined && writtenCase.damage.other === undefined)
const partsTable = (set: SetKey, groups: readonly (readonly [string, readonly number[]])[]) => {
  table([
    ['', 'texts', 'counted', ...rows.map(row => `row ${row}`)],
    ...groups.flatMap(([name, places]) => [
      [`${name}: all three`, String(places.length), number(countedOf(set, places)), ...rows.map(row => share(rightOfRow(row, set, places), countedOf(set, places), 2))],
      [`${name}: all three outside later header lines`, '', number(countedOf(set, places, withoutLaterHeaders)), ...rows.map(row => share(rightOfRow(row, set, places, withoutLaterHeaders), countedOf(set, places, withoutLaterHeaders), 2))],
      [`${name}: whole`, '', '', ...rows.map(row => share(wholeOfRow(row, set, places), withSomething(set, places).length))],
    ]),
  ])
}
out()
out('The generator\'s set, by whether neutral edits could make the damage:')
partsTable('generator', [
  ['neutral edits could make it', placesOfSet.generator.filter(at => neutralOfGenerator[at])],
  ['other damage', placesOfSet.generator.filter(at => !neutralOfGenerator[at])],
])
out()
out('The written cases with full agreement, by the same split (the final report has these rows too):')
partsTable('written', [
  ['neutral edits could make it', placesOfSet.written.filter(at => neutralOfWritten[at])],
  ['other damage', placesOfSet.written.filter(at => !neutralOfWritten[at])],
])

const heldNames: Held[] = ['held', 'near', 'none']
const heldWords: Record<Held, string> = {held: 'a training kind makes the mistake in this form', near: 'training kinds make parts of it, or another form', none: 'no training kind makes it'}
out()
out('Per kind of the generator: whether a kind of the training side holds the mistake (one reader\'s judgment, tags.ts), how many of the samples with the kind alone neutral edits could make, and what the kinds add outside later header lines, in points of "all three" and of whole samples (later header lines not counted).')
{
  const lines = [['kind', 'held by a training kind', 'alone', 'neutral edits could', 'row 4', 'row 7', '7−4', 'row 5', 'row 8', '8−5', 'whole 4', 'whole 7', 'whole 5', 'whole 8']]
  for (const kind of kindNames) {
    const places = placesOfKind(kind)
    const alone = places.filter(at => samples[at]!.kinds.length === 1)
    const outside = countedOf('generator', places, withoutLaterHeaders)
    const percentOf = (row: string) => 100 * rightOfRow(row, 'generator', places, withoutLaterHeaders) / outside
    const wholeOf = (row: string) => 100 * wholeOfRow(row, 'generator', places, withoutLaterHeaders) / places.length
    lines.push([
      kind, generatorTags[kind]!.held, String(alone.length), String(alone.filter(at => neutralOfGenerator[at]).length),
      percentOf('4').toFixed(1), percentOf('7').toFixed(1), (percentOf('7') - percentOf('4')).toFixed(1), percentOf('5').toFixed(1), percentOf('8').toFixed(1), (percentOf('8') - percentOf('5')).toFixed(1),
      wholeOf('4').toFixed(0), wholeOf('7').toFixed(0), wholeOf('5').toFixed(0), wholeOf('8').toFixed(0),
    ])
  }
  table(lines)
}
out()
out('The same per answer of the judgment. A sample of the generator is counted by its first kind when it has two, so every sample is in one line.')
for (const set of setKeys) {
  out()
  out(setTitles[set])
  const heldOf = (at: number): Held => set === 'generator' ? generatorTags[samples[at]!.kinds[0]!]!.held : writtenTags[loaded.sets.written.texts[at]!.id]!.held
  partsTable(set, heldNames.map(held => [`${held} (${heldWords[held]})`, placesOfSet[set].filter(at => heldOf(at) === held)] as const))
}
out()
out('Some kinds of the generator by their form, where the forms differ in what the training side holds: "all three / whole" in percent.')
{
  const formOf = (at: number, kind: string) => samples[at]!.forms.find(form => form.startsWith(`${kind}: `))!.slice(kind.length + 2)
  const groups: (readonly [string, readonly number[]])[] = [
    ...(['one entry', 'several entries in a row', 'every entry of a section, between braces'] as const).map(start => [`jsonPastedIn: ${start}`, placesOfKind('jsonPastedIn').filter(at => formOf(at, 'jsonPastedIn').startsWith(start))] as const),
    ['typographicQuotes: only “ and ” in the text', placesOfKind('typographicQuotes').filter(at => !/[‘’]/.test(samples[at]!.broken))],
    ['typographicQuotes: ‘ or ’ in the text', placesOfKind('typographicQuotes').filter(at => /[‘’]/.test(samples[at]!.broken))],
    ['semicolonComment: on a line of its own', placesOfKind('semicolonComment').filter(at => formOf(at, 'semicolonComment').includes('on a line of its own'))],
    ['semicolonComment: after a value', placesOfKind('semicolonComment').filter(at => formOf(at, 'semicolonComment').includes('after a value'))],
    ['commaAtLineEnd: a comma', placesOfKind('commaAtLineEnd').filter(at => formOf(at, 'commaAtLineEnd').startsWith('a comma'))],
    ['commaAtLineEnd: a semicolon', placesOfKind('commaAtLineEnd').filter(at => formOf(at, 'commaAtLineEnd').startsWith('a semicolon'))],
  ]
  table([
    ['form', 'samples', ...rows.map(row => `row ${row}`)],
    ...groups.map(([name, places]) => [name, String(places.length), ...rows.map(row => `${share(rightOfRow(row, 'generator', places), countedOf('generator', places))} / ${share(wholeOfRow(row, 'generator', places), places.length, 0)}`)]),
  ])
}
out()
out('The character classes that the tables add to today\'s 47. The recipe picks them by a count over its train samples, and the author of the hand-written rules chose them.')
{
  const classesOf = (parser: ScoredParser) => parser.tables!.addedClasses.map(added => added.codePoints.map(codePoint => codePoint < 0x21 || (codePoint >= 0x7f && codePoint <= 0xa0) || codePoint === 0xfeff || codePoint === 0x200b ? `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}` : String.fromCodePoint(codePoint)).join(' ')).sort().join(' | ')
  for (const group of [['3'], ['4', '5', '6'], ['7', '8']]) {
    const lists = [...new Set(group.flatMap(row => parsersOfRow(loaded, row).map(classesOf)))]
    const files = group.flatMap(row => parsersOfRow(loaded, row)).length
    out(`  row${group.length > 1 ? 's' : ''} ${group.join(', ')}, ${files} ${files === 1 ? 'file' : 'files'}${lists.length === 1 ? (files === 1 ? '' : ', the same classes in every file') : `, ${lists.length} different lists`}: ${lists.join('  ///  ')}`)
  }
}
out()
out(`Training kinds that no kind of the generator has in any form: ${trainingKindsWithoutAGeneratorKind.join(', ')}.`)
{
  const kindsOfTags = (tags: Record<string, {held: Held, kinds: string}>) => Object.values(tags)
  const count = (held: Held) => kindsOfTags(writtenTags).filter(caseTag => caseTag.held === held).length
  out(`Written cases, all 150: ${count('held')} held, ${count('near')} near, ${count('none')} none. Generator kinds: ${heldNames.map(held => `${Object.values(generatorTags).filter(kindTag => kindTag.held === held).length} ${held}`).join(', ')}.`)
}

// 4. How failures look.
out()
out('## 4. How failures look')
out()
out('Per row, over the texts with something to recover: how many texts are not whole, and how many counted code points are wrong in such a text. "Small" is a text with 1 to 3 wrong code points, "large" one with more than a quarter of its counted code points wrong.')
const percentile = (sorted: readonly number[], fraction: number) => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]!
for (const set of setKeys) {
  const places = withSomething(set, placesOfSet[set])
  const lines = [['row', 'texts not whole', 'wrong code points', 'median per such text', 'mean', '9 of 10 have at most', 'small', 'large', 'share of the wrong code points in large texts']]
  for (const row of rows) {
    const perSeed = parsersOfRow(loaded, row).map(parser => {
      const wrongCounts = places.map(at => loaded.scored[set][at]! - rightOfParser(parser, set, [at]))
      const failing = places.flatMap((at, index) => wrongCounts[index]! > 0 ? [{wrongCount: wrongCounts[index]!, counted: loaded.scored[set][at]!}] : [])
      const sorted = failing.map(text => text.wrongCount).sort((left, rightValue) => left - rightValue)
      const large = failing.filter(text => text.wrongCount > text.counted / 4)
      return {
        failing: failing.length, wrongTotal: sum(sorted), median: percentile(sorted, 0.5), mean: sum(sorted) / Math.max(1, sorted.length), ninth: percentile(sorted, 0.9),
        small: failing.filter(text => text.wrongCount <= 3).length, large: large.length, wrongInLarge: sum(large.map(text => text.wrongCount)),
      }
    })
    const mean = (pick: (seed: typeof perSeed[number]) => number) => meanOf(perSeed.map(pick))
    lines.push([
      `row ${row}`, `${mean(seed => seed.failing).toFixed(0)} of ${places.length}`, number(mean(seed => seed.wrongTotal)), mean(seed => seed.median).toFixed(0), mean(seed => seed.mean).toFixed(1), mean(seed => seed.ninth).toFixed(0),
      `${share(mean(seed => seed.small), mean(seed => seed.failing), 0)}%`, `${share(mean(seed => seed.large), mean(seed => seed.failing), 0)}%`, `${share(mean(seed => seed.wrongInLarge), mean(seed => seed.wrongTotal), 0)}%`,
    ])
  }
  out()
  out(setTitles[set])
  table(lines)
}

out()
out('### How far apart the seeds are on one text')
out()
out('Per row with five seeds (row 6 has three), over the texts with something to recover. "Same count" is a text in which every seed has the same number of right code points. "Whole for some" is a text that is whole for at least one seed and not for all. The spread of a text is its highest seed minus its lowest, in right code points. The last columns count code points: at how many all seeds are right, all wrong, or split, and at how many of all counted code points every seed shows the same display kind, depth and container.')
for (const set of setKeys) {
  const places = withSomething(set, placesOfSet[set])
  const lines = [['row', 'texts', 'same count', 'whole for all', 'whole for some', 'whole for none', 'mean spread', 'spread over 20', 'all right', 'all wrong', 'split', 'all show the same']]
  for (const row of ['4', '5', '6', '7', '8']) {
    const parsers = parsersOfRow(loaded, row)
    let sameCount = 0, wholeAll = 0, wholeSome = 0, spreadTotal = 0, wideSpread = 0, allRight = 0, allWrong = 0, split = 0, sameShown = 0, counted = 0
    for (const at of places) {
      const rights = parsers.map(parser => rightOfParser(parser, set, [at]))
      const spread = Math.max(...rights) - Math.min(...rights)
      if (spread === 0) sameCount++
      spreadTotal += spread
      if (spread > 20) wideSpread++
      const wholes = parsers.filter(parser => wholeIn(parser, set, at)).length
      if (wholes === parsers.length) wholeAll++
      else if (wholes > 0) wholeSome++
      const outcomes = parsers.map(parser => parser.outcomes[set][at]!)
      const shown = parsers.map(parser => parser.shown[set][at]!)
      for (let position = 0; position < outcomes[0]!.length; position++) {
        if (outcomes[0]![position] === notCounted) continue
        counted++
        const rightSeeds = outcomes.filter(ofSeed => ofSeed[position] === right).length
        if (rightSeeds === parsers.length) allRight++
        else if (rightSeeds === 0) allWrong++
        else split++
        if (shown.every(ofSeed => ofSeed[position] === shown[0]![position])) sameShown++
      }
    }
    lines.push([
      `row ${row}`, String(places.length), `${share(sameCount, places.length, 0)}%`, `${share(wholeAll, places.length, 0)}%`, `${share(wholeSome, places.length, 0)}%`, `${share(places.length - wholeAll - wholeSome, places.length, 0)}%`,
      (spreadTotal / places.length).toFixed(1), `${share(wideSpread, places.length, 0)}%`, `${share(allRight, counted)}%`, `${share(allWrong, counted)}%`, `${share(split, counted)}%`, `${share(sameShown, counted)}%`,
    ])
  }
  out()
  out(setTitles[set])
  table(lines)
}

// 5. The search.
out()
out('## 5. What the search does: row 5 against row 4, row 8 against row 7, and row 6')
out()
out('The search of row 5 starts from the trained tables of row 4 with the same seed, and row 8 from row 7. So the two can be held against each other code point by code point: "fixed" is wrong before the search and right after it, "broken" is right before and wrong after. The sum over the five seeds, divided by five.')
for (const set of setKeys) {
  const places = placesOfSet[set]
  const lines = [['pair', 'part', 'counted', 'right in both', 'fixed', 'broken', 'wrong in both', 'texts made whole', 'texts no longer whole']]
  for (const [before, after] of [['4', '5'], ['7', '8']] as const) {
    const pairs = parsersOfRow(loaded, before).map(parser => [parser, parsersOfRow(loaded, after).find(candidate => candidate.seed === parser.seed)!] as const)
    for (const [name, parts] of [['later lines with a header', [laterHeaderLine]], ['all other code points', withoutLaterHeaders]] as const) {
      let both = 0, fixed = 0, broken = 0, neither = 0
      for (const [first, second] of pairs) {
        for (const at of places) {
          const outcomesBefore = first.outcomes[set][at]!
          const outcomesAfter = second.outcomes[set][at]!
          for (let position = 0; position < outcomesBefore.length; position++) {
            if (outcomesBefore[position] === notCounted || !(parts as readonly number[]).includes(partOf[set][at]![position]!)) continue
            if (outcomesBefore[position] === right) outcomesAfter[position] === right ? both++ : broken++
            else outcomesAfter[position] === right ? fixed++ : neither++
          }
        }
      }
      const madeWhole = meanOf(pairs.map(([first, second]) => places.filter(at => !wholeIn(first, set, at) && wholeIn(second, set, at)).length))
      const noLongerWhole = meanOf(pairs.map(([first, second]) => places.filter(at => wholeIn(first, set, at) && !wholeIn(second, set, at)).length))
      const perSeed = (value: number) => number(value / pairs.length)
      lines.push([`row ${before} to row ${after}`, name, perSeed(both + fixed + broken + neither), perSeed(both), perSeed(fixed), perSeed(broken), perSeed(neither), name === 'all other code points' ? madeWhole.toFixed(0) : '', name === 'all other code points' ? noLongerWhole.toFixed(0) : ''])
    }
  }
  out()
  out(`${setTitles[set]} (the last two columns count whole texts over all parts)`)
  table(lines)
}
out()
out('Per kind of the generator, outside later header lines: the share right in percent, what the search adds in code points, and the whole samples in percent of the kind\'s samples (all parts counted). The last column marks a kind in which a row with the search is below the row without it, or below the rule, outside later header lines.')
{
  const lines = [['kind', 'counted', 'row 2', 'row 4', 'row 5', '5−4', 'row 6', 'row 7', 'row 8', '8−7', 'whole 2', 'whole 4', 'whole 5', 'whole 6', 'whole 7', 'whole 8', 'note']]
  for (const kind of [...kindNames, 'all']) {
    const places = kind === 'all' ? placesOfSet.generator : placesOfKind(kind)
    const outside = countedOf('generator', places, withoutLaterHeaders)
    const rightOutside = (row: string) => rightOfRow(row, 'generator', places, withoutLaterHeaders)
    const marks = [
      ...(rightOutside('5') < rightOutside('4') ? ['5 below 4'] : []), ...(rightOutside('8') < rightOutside('7') ? ['8 below 7'] : []),
      ...(['5', '6', '8'].filter(row => rightOutside(row) < rightOutside('2')).map(row => `${row} below the rule`)),
    ]
    lines.push([
      kind, number(outside), share(rightOutside('2'), outside), share(rightOutside('4'), outside), share(rightOutside('5'), outside), signed(rightOutside('5') - rightOutside('4')),
      share(rightOutside('6'), outside), share(rightOutside('7'), outside), share(rightOutside('8'), outside), signed(rightOutside('8') - rightOutside('7')),
      ...['2', '4', '5', '6', '7', '8'].map(row => share(wholeOfRow(row, 'generator', places), places.length, 0)), marks.join(', '),
    ])
  }
  table(lines)
}

out()
out('The rows with the search against the hand-written rules, per kind of the generator and over all parts of a text: the difference in right code points, and the whole samples as counts. Sorted by row 8 minus row 3.')
{
  const lines = [['kind', 'samples', 'counted', '8−3', '5−3', 'whole 3', 'whole 8', 'whole 5']]
  const ordered = [...kindNames].sort((left, rightKind) => (rightOfRow('8', 'generator', placesOfKind(left)) - rightOfRow('3', 'generator', placesOfKind(left))) - (rightOfRow('8', 'generator', placesOfKind(rightKind)) - rightOfRow('3', 'generator', placesOfKind(rightKind))))
  for (const kind of [...ordered, 'all']) {
    const places = kind === 'all' ? placesOfSet.generator : placesOfKind(kind)
    lines.push([
      kind, String(places.length), number(countedOf('generator', places)), signed(rightOfRow('8', 'generator', places) - rightOfRow('3', 'generator', places)), signed(rightOfRow('5', 'generator', places) - rightOfRow('3', 'generator', places)),
      wholeOfRow('3', 'generator', places).toFixed(0), wholeOfRow('8', 'generator', places).toFixed(0), wholeOfRow('5', 'generator', places).toFixed(0),
    ])
  }
  table(lines)
}

// 6. The written cases: which carry the difference.
out()
out('## 6. The written cases: where the rows 4 and 7 are above and below the rows 2 and 3')
out()
out('Over the 142 cases with full agreement and something to recover, by the mean over the seeds of the right code points of a case. --cases prints every case.')
{
  const places = withSomething('written', placesOfSet.written)
  const lines = [['pair', 'cases above', 'level', 'below', 'code points gained in the cases above', 'lost in the cases below', 'net']]
  for (const [first, second] of [['4', '2'], ['7', '2'], ['5', '2'], ['8', '2'], ['4', '3'], ['7', '3'], ['5', '3'], ['8', '3'], ['7', '4'], ['8', '5'], ['3', '2']] as const) {
    const differences = places.map(at => rightOfRow(first, 'written', [at]) - rightOfRow(second, 'written', [at]))
    lines.push([
      `row ${first} against row ${second}`, String(differences.filter(difference => difference > 0.5).length), String(differences.filter(difference => Math.abs(difference) <= 0.5).length), String(differences.filter(difference => difference < -0.5).length),
      signed(sum(differences.filter(difference => difference > 0.5))), signed(sum(differences.filter(difference => difference < -0.5))), signed(sum(differences)),
    ])
  }
  table(lines)
  const texts = loaded.sets.written.texts
  const describe = (at: number, first: string, second: string) => {
    const writtenCase = loaded.writtenCases[at]!
    const shownRows = [...new Set([first, second, '2', '3'])]
    return `  ${texts[at]!.id} (${loaded.scored.written[at]} counted): ${shownRows.map(row => `row ${row} ${rightOfRow(row, 'written', [at]).toFixed(0)}`).join(', ')}. ${writtenCase.damage?.other ?? writtenCase.damage?.edits.join(', ') ?? ''} [${writtenTags[writtenCase.id]!.held}]`
  }
  for (const [first, second] of [['7', '2'], ['7', '3'], ['8', '3'], ['7', '4'], ['8', '5']] as const) {
    const ordered = [...places].sort((left, rightPlace) => (rightOfRow(first, 'written', [rightPlace]) - rightOfRow(second, 'written', [rightPlace])) - (rightOfRow(first, 'written', [left]) - rightOfRow(second, 'written', [left])))
    out()
    out(`Row ${first} against row ${second}: the eight cases in which row ${first} has the most above row ${second}, in code points`)
    for (const at of ordered.slice(0, 8)) out(describe(at, first, second))
    out(`and the eight in which it has the most below`)
    for (const at of ordered.slice(-8).reverse()) out(describe(at, first, second))
  }
}
