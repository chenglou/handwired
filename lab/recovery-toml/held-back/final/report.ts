// The report of the final scoring as lines of markdown, and the verdict by the rule that the lead fixed before any
// training on TOML. run.ts makes the counts, saves them, and calls describeReport.
//
// Run from the repo root, to write the report of a saved file of counts again, e.g. after a change of its wording:
//   bun lab/recovery-toml/held-back/final/report.ts <counts.json> <report.md>
// It scores nothing: every number comes from the file of counts.
import {readFileSync, writeFileSync} from 'node:fs'
import {type Counts, type LabelKindCounts, percentagesOf} from './count.ts'
import {datasetRowOfHeldOutTemplates, datasetRowOfTrainTemplates, writtenParts} from './sets.ts'

// The first line of every file that shows the held-back sets, see ../README.md.
export const heldBackLine = 'HELD BACK: whoever builds the parser, the train data, the training or its machinery does not read this file.'
export const dryRunMark = 'dry run: '

export type SetKey = 'generator' | 'written' | 'dataset'

// The counts of one parser: the parser as it is, the rule, or the tables of one file. A held-back set that a dry run
// leaves for the final run is null. `labelKinds` are the counts per display kind of the label, over the texts of the
// set's main row, see mainRows.
export type FileCounts = {
  seed: number | null
  file: string | null
  sha256: string | null
  generator: Counts[] | null
  written: Counts[] | null
  dataset: Counts[]
  labelKinds: {generator: LabelKindCounts[] | null, written: LabelKindCounts[] | null, dataset: LabelKindCounts[]}
  // Per text of a set, in the order of RunFacts.texts: how many of its scored code points are right.
  rightPerText: {generator: number[] | null, written: number[] | null, dataset: number[]}
}

// A row of the experiment with the counts of each of its files. `label` is the row's number, e.g. "4", or "base" for
// tables that have what a row's tables add to today's (classes, open display entries, the bit "first on its line")
// and no cell changed.
export type RowCounts = {label: string, name: string, description: string, files: FileCounts[]}

// The main row of each set: the verdict reads the first two.
export const mainRows = {generator: 'all', written: writtenParts[0].fullAgreement, dataset: 'all'} as const

const number = (value: number) => value.toLocaleString('en-US')
const meanOf = (values: readonly number[]) => values.reduce((total, value) => total + value, 0) / values.length
const capitalized = (text: string) => `${text[0]!.toUpperCase()}${text.slice(1)}`

// The mean of the values of a row's files with the lowest and the highest in brackets, e.g. "91.45 (90.10 to
// 92.03)", the value alone for one file, and "-" where there is nothing to divide by.
export function spread(values: readonly number[], digits: number): string {
  if (values.length === 0 || values.some(value => Number.isNaN(value))) return '-'
  if (values.length === 1) return values[0]!.toFixed(digits)
  return `${meanOf(values).toFixed(digits)} (${Math.min(...values).toFixed(digits)} to ${Math.max(...values).toFixed(digits)})`
}
const countSpread = (values: readonly number[]) => values.length === 1 ? number(values[0]!) : `${number(Math.round(meanOf(values)))} (${number(Math.min(...values))} to ${number(Math.max(...values))})`

const rowNamed = (counts: readonly Counts[] | null, name: string) => counts?.find(row => row.name === name)

// "All three" and "whole" in percent of each file of a row, in one row of a set. Empty when the row was not scored
// on the set.
export const allThreeOf = (row: RowCounts, set: SetKey, name: string): number[] => row.files.flatMap(file => file[set] === null ? [] : [percentagesOf(rowNamed(file[set], name)).allThree])
export const wholeOf = (row: RowCounts, set: SetKey, name: string): number[] => row.files.flatMap(file => file[set] === null ? [] : [percentagesOf(rowNamed(file[set], name)).whole])

// What the verdict reads of one held-back set: "all three" in percent of the rows 2 and 3, and of every seed of the
// rows 4 and 7.
export type VerdictSet = {name: string, row2: number, row3: number, row4: readonly number[], row7: readonly number[]}

export const verdicts = ['carried over with neutral damage alone', 'carried over with kinds written for the language', 'partly', 'failed'] as const

// The verdict by the lead's rule, on the two held-back sets. A trained row is "above" another row on a set when its
// lowest seed on that set, i.e. the seed with the lowest "all three" there, has more than the other row:
// - "carried over with neutral damage alone" when row 4 is above the rows 2 and 3 on both sets;
// - "carried over with kinds written for the language" when row 7 is, and row 4 is not;
// - "partly" when row 4 or row 7 is above row 2 on a set, without the above: it is not above row 3 too, or only on
//   one of the two sets;
// - "failed" when neither row 4 nor row 7 is above row 2 on either set.
export function verdictOf(sets: readonly VerdictSet[]): typeof verdicts[number] {
  const lowest = (values: readonly number[]) => Math.min(...values)
  const aboveBoth = (row: 'row4' | 'row7') => sets.every(set => lowest(set[row]) > set.row2 && lowest(set[row]) > set.row3)
  if (aboveBoth('row4')) return verdicts[0]
  if (aboveBoth('row7')) return verdicts[1]
  if (sets.some(set => lowest(set.row4) > set.row2 || lowest(set.row7) > set.row2)) return verdicts[2]
  return verdicts[3]
}

export type FileFacts = {row: number, seed: number | null, path: string, sha256: string, structure: string, differFromToday: string}
export type AsTodayFacts = {set: string, parsers: number, documents: number, validCodePoints: number, validDifferences: number, brokenTexts: number, beforeErrorCodePoints: number, beforeErrorDifferences: number}
export type RunFacts = {
  dryRun: boolean
  time: string
  commit: string
  uncommittedChanges: boolean
  command: string
  listFile: string
  listSha256: string
  datasetKey: string
  countsFile: string
  // What the report calls each set.
  titles: Record<SetKey, string>
  // The texts of each set in their order: the id, e.g. "20261107:12", and how many code points a score counts.
  texts: Record<SetKey, {ids: string[], scored: number[]}>
  // The files of the list as they were checked before a text was scored.
  files: FileFacts[]
  // The second counts: how many counts were held against the count of a set's own scorer, and which differed.
  secondCounts: {compared: number, different: string[]}
  // The tables with added structure and no cell changed, held against the parser as it is in every count.
  unchangedTables: {compared: number, different: string[]}
  asToday: AsTodayFacts[]
  // The dataset's split as it was loaded: the indexes that were made, the samples of the split, and those of a
  // held-out template.
  datasetSplit: {split: string, indexesMade: number, texts: number, ofHeldOutTemplates: number}
  // Anything that went wrong after the scoring began. Empty in a run to rely on.
  problems: string[]
}

// What a file of counts holds: the facts of the run, the rows 1 to 8, and the tables with no cell changed.
export type SavedCounts = RunFacts & {format: 'recovery-toml final counts 1', rows: RowCounts[], bases: RowCounts[]}

const leftForTheFinalRun = 'left for the final run'

// The report. `rows` are the rows 1 to 8 in their order, and `bases` the tables with no cell changed. In a dry run
// every line but the first starts with dryRunMark.
export function describeReport(rows: readonly RowCounts[], bases: readonly RowCounts[], facts: RunFacts): string[] {
  const first = rows[0]!.files[0]!
  const rowOfLabel = (label: string) => rows.find(row => row.label === label)!
  const cell = (row: RowCounts, set: SetKey, name: string, share: 'allThree' | 'whole', withSpread: boolean) => {
    const values = share === 'allThree' ? allThreeOf(row, set, name) : wholeOf(row, set, name)
    if (values.length === 0) return leftForTheFinalRun
    const digits = share === 'allThree' ? 2 : 1
    return withSpread ? spread(values, digits) : Number.isNaN(meanOf(values)) ? '-' : meanOf(values).toFixed(digits)
  }
  const addedCell = (row: RowCounts, set: SetKey, name: string) => {
    const values = row.files.flatMap(file => file[set] === null ? [] : [rowNamed(file[set], name)?.addedShownAsError ?? 0])
    return values.length === 0 ? leftForTheFinalRun : countSpread(values)
  }
  const sizeOf = (set: SetKey, name: string) => {
    const counts = rowNamed(first[set], name)
    return counts === undefined ? {texts: 0, withSomething: 0, scored: 0, added: 0} : {texts: counts.texts, withSomething: counts.texts - counts.nothingToRecover, scored: counts.scored, added: counts.added}
  }
  const columns = rows.map(row => `Row ${row.label}`).join(' | ')
  const rules = rows.map(() => '---').join(' | ')
  // One line per row of a set, one column per row of the experiment.
  const breakdown = (set: SetKey, names: readonly string[], share: 'allThree' | 'whole', withSpread: boolean, shownName: (name: string) => string = name => name) => [
    `| ${share === 'allThree' ? 'All three' : 'Whole'}, in percent | Texts | Scored code points | ${columns} |`,
    `| --- | --- | --- | ${rules} |`,
    ...names.filter(name => sizeOf(set, name).texts > 0).map(name => `| ${shownName(name)} | ${number(sizeOf(set, name).texts)} | ${number(sizeOf(set, name).scored)} | ${rows.map(row => cell(row, set, name, share, withSpread)).join(' | ')} |`),
  ]
  // One line per display kind of the label, over the texts of a set's main row: the mean of "all three".
  const labelKinds = (set: SetKey) => [
    `| All three per display kind of the label, in percent | Scored code points | ${columns} |`,
    `| --- | --- | ${rules} |`,
    ...(first.labelKinds[set] ?? []).map(({kind, scored}) => `| ${kind} | ${number(scored)} | ${rows.map(row => {
      const values = row.files.flatMap(file => {
        const of = file.labelKinds[set]?.find(candidate => candidate.kind === kind)
        return file.labelKinds[set] === null ? [] : [of === undefined ? Number.NaN : 100 * of.right / of.scored]
      })
      return values.length === 0 ? leftForTheFinalRun : Number.isNaN(meanOf(values)) ? '-' : meanOf(values).toFixed(1)
    }).join(' | ')} |`),
  ]
  const namesOf = (set: SetKey) => (first[set] ?? []).map(row => row.name)
  const kindNames = namesOf('generator').filter(name => name.startsWith('kind: '))
  const kindName = (name: string) => name.startsWith('kind: ') ? `\`${name.slice(6)}\`` : name
  const nameOfDatasetSet = facts.dryRun ? 'the validation split' : 'the dataset\'s test split'

  const lines = [
    heldBackLine,
    '',
    facts.dryRun ? '# A dry run of the final scoring of the TOML track' : '# The final scores of the TOML track',
    '',
    `Scored at ${facts.time} by \`${facts.command}\`, from the worktree at commit ${facts.commit}${facts.uncommittedChanges ? ', with uncommitted changes under lab/recovery-toml/' : ''}. Dataset ${facts.datasetKey}. The list is ${facts.listFile} (sha256 ${facts.listSha256}). Every count is in ${facts.countsFile}.`,
    '',
    ...(facts.dryRun ? [
      'This is a dry run, and none of its numbers is a final number. On the two held-back sets it scored only the parser as it is, the one rule, and tables with no cell changed. It read no sample of the dataset\'s test split: in its place stands the validation split, which every table of the list was scored on, with made-up rows for the held-out templates.',
      '',
    ] : []),
    ...(facts.problems.length > 0 ? ['**Problems of this run, which make its numbers unsafe to use:**', '', ...facts.problems.map(problem => `- ${problem}`), ''] : []),
    'Words: "all three" is the share of the scored code points with the display kind, the depth and the container right. A scored code point is one from the first error of the parser as it is on whose label has a scored value. "Whole" is the share of the texts with something to recover in which every scored code point is right. An "added" code point is one that the damage put into the text, which has no label. Where a row has several seeds, a number is the mean over the seeds, with the lowest and the highest in brackets. All shares are in percent.',
    '',
    '## The rows',
    '',
    'The rows and the verdict\'s rule were fixed by the lead before any training on TOML. **The rows 4 and 7, which the verdict reads, leave out the search of the recipe.** The rows 5 and 8 have it, so they are the JSON side\'s candidate "generic" with all of its five steps.',
    '',
    '| Row | What it is | Files |',
    '| --- | --- | --- |',
    ...rows.map(row => `| ${row.label} | ${capitalized(row.name)}: ${row.description} | ${row.files[0]!.file === null ? 'none' : row.files.length} |`),
    '',
  ]

  // The verdict, when the rows that it reads were scored on both sets.
  const heldBackSets = ['generator', 'written'] as const
  const verdictSets: VerdictSet[] = heldBackSets.flatMap(set => {
    const [row2, row3] = [allThreeOf(rowOfLabel('2'), set, mainRows[set])[0], allThreeOf(rowOfLabel('3'), set, mainRows[set])[0]]
    const [row4, row7] = [allThreeOf(rowOfLabel('4'), set, mainRows[set]), allThreeOf(rowOfLabel('7'), set, mainRows[set])]
    return row2 === undefined || row3 === undefined || row4.length === 0 || row7.length === 0 ? [] : [{name: set === 'generator' ? 'the generator\'s set' : 'the written cases with full agreement', row2, row3, row4, row7}]
  })
  lines.push('## The verdict', '')
  if (verdictSets.length < 2) {
    lines.push('A dry run has no verdict: the rows 3 to 8 are not scored on the held-back sets.', '')
  } else {
    const seedOfLowest = (label: string, set: 'generator' | 'written') => {
      const values = allThreeOf(rowOfLabel(label), set, mainRows[set])
      return rowOfLabel(label).files[values.indexOf(Math.min(...values))]!.seed
    }
    lines.push(
      `**${capitalized(verdictOf(verdictSets))}.**`,
      '',
      'The rule, on the two held-back sets and in "all three": "carried over with neutral damage alone" when row 4 with its lowest seed is above the rows 2 and 3 on both sets; "carried over with kinds written for the language" when row 7 with its lowest seed is, and row 4 is not; "partly" when row 4 or row 7 is above row 2 but not row 3, or on one set only; "failed" when neither is above row 2. The lowest seed of a row on a set is the seed with the lowest "all three" on that set.',
      '',
      '| All three, in percent | Row 2 | Row 3 | Row 4, lowest seed | Row 7, lowest seed |',
      '| --- | --- | --- | --- | --- |',
      ...heldBackSets.map((set, at) => {
        const {name, row2, row3, row4, row7} = verdictSets[at]!
        return `| ${capitalized(name)} | ${row2.toFixed(2)} | ${row3.toFixed(2)} | ${Math.min(...row4).toFixed(2)} (seed ${seedOfLowest('4', set)}) | ${Math.min(...row7).toFixed(2)} (seed ${seedOfLowest('7', set)}) |`
      }),
      '',
      'Every trained row against the rows 2 and 3, with its lowest seed, in points of "all three". Only the rows 4 and 7 count for the verdict.',
      '',
      '| Row | Set | Lowest seed | Mean | Lowest seed against row 2 | Lowest seed against row 3 |',
      '| --- | --- | --- | --- | --- | --- |',
      ...['4', '5', '6', '7', '8'].flatMap(label => heldBackSets.map((set, at) => {
        const values = allThreeOf(rowOfLabel(label), set, mainRows[set])
        const lowest = Math.min(...values)
        const {row2, row3} = verdictSets[at]!
        const against = (other: number) => `${lowest > other ? 'above' : 'not above'}, ${lowest >= other ? '+' : '−'}${Math.abs(lowest - other).toFixed(2)}`
        return `| ${label} | ${set === 'generator' ? 'generator' : 'written, full agreement'} | ${lowest.toFixed(2)} (seed ${seedOfLowest(label, set)}) | ${meanOf(values).toFixed(2)} | ${against(row2)} | ${against(row3)} |`
      })),
      '',
    )
  }

  const generatorSize = sizeOf('generator', mainRows.generator)
  const writtenSize = sizeOf('written', mainRows.written)
  const datasetSize = sizeOf('dataset', mainRows.dataset)
  lines.push(
    '## All eight rows on both held-back sets',
    '',
    `The generator's set: ${number(generatorSize.texts)} samples, ${number(generatorSize.scored)} scored code points, ${number(generatorSize.added)} added code points. The written set's cases with full agreement: ${number(writtenSize.texts)} cases, ${number(writtenSize.withSomething)} of them with something to recover, ${number(writtenSize.scored)} scored code points, ${number(writtenSize.added)} added code points.`,
    '',
    '| Row | Generator: all three | Generator: whole | Generator: added shown as an error | Written: all three | Written: whole | Written: added shown as an error |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(row => `| ${row.label}, ${row.name} | ${cell(row, 'generator', mainRows.generator, 'allThree', true)} | ${cell(row, 'generator', mainRows.generator, 'whole', true)} | ${addedCell(row, 'generator', mainRows.generator)} | ${cell(row, 'written', mainRows.written, 'allThree', true)} | ${cell(row, 'written', mainRows.written, 'whole', true)} | ${addedCell(row, 'written', mainRows.written)} |`),
    '',
    `Per file of tables, "all three / whole" on the generator's set, on the written cases with full agreement, and on ${nameOfDatasetSet}:`,
    '',
    `| Row | Seed | Generator | Written, full agreement | ${capitalized(nameOfDatasetSet)} |`,
    '| --- | --- | --- | --- | --- |',
    ...rows.filter(row => row.files[0]!.file !== null).flatMap(row => row.files.map(file => {
      const of = (set: SetKey) => file[set] === null ? leftForTheFinalRun : `${percentagesOf(rowNamed(file[set], mainRows[set])).allThree.toFixed(2)} / ${percentagesOf(rowNamed(file[set], mainRows[set])).whole.toFixed(1)}`
      return `| ${row.label} | ${file.seed ?? ''} | ${of('generator')} | ${of('written')} | ${of('dataset')} |`
    })),
    '',
    '## The generator of typical mistakes',
    '',
    `${capitalized(facts.titles.generator)}. The weights of its kinds are a judgment and no measured frequencies, so the rows per kind and per group say more than the number over the set. A sample with two kinds is in the row of each.`,
    '',
    '### Per group, per number of mistakes, and the held-out templates apart',
    '',
    ...breakdown('generator', namesOf('generator').filter(name => !name.startsWith('kind: ')), 'allThree', true),
    '',
    ...breakdown('generator', namesOf('generator').filter(name => !name.startsWith('kind: ')), 'whole', true),
    '',
    '### Per kind of mistake',
    '',
    'The mean over a row\'s seeds. The lowest and the highest seed of every cell are in the file of counts.',
    '',
    ...breakdown('generator', kindNames, 'allThree', false, kindName),
    '',
    ...breakdown('generator', kindNames, 'whole', false, kindName),
    '',
  )
  // In how many kinds a row's mean is above the mean of the rows 2 and 3.
  const kindsAbove = (row: RowCounts, other: RowCounts, share: 'allThree' | 'whole') => {
    const valueOf = (of: RowCounts, name: string) => meanOf(share === 'allThree' ? allThreeOf(of, 'generator', name) : wholeOf(of, 'generator', name))
    if (allThreeOf(row, 'generator', mainRows.generator).length === 0) return leftForTheFinalRun
    return `${kindNames.filter(name => valueOf(row, name) > valueOf(other, name)).length} above, ${kindNames.filter(name => valueOf(row, name) < valueOf(other, name)).length} below`
  }
  lines.push(
    `In how many of the ${kindNames.length} kinds the mean of a row is above and below the rows 2 and 3:`,
    '',
    '| Row | All three, against row 2 | Whole, against row 2 | All three, against row 3 | Whole, against row 3 |',
    '| --- | --- | --- | --- | --- |',
    ...rows.filter(row => !['1', '2'].includes(row.label)).map(row => `| ${row.label} | ${kindsAbove(row, rowOfLabel('2'), 'allThree')} | ${kindsAbove(row, rowOfLabel('2'), 'whole')} | ${row.label === '3' ? '' : kindsAbove(row, rowOfLabel('3'), 'allThree')} | ${row.label === '3' ? '' : kindsAbove(row, rowOfLabel('3'), 'whole')} |`),
    '',
    '### Per display kind of the label',
    '',
    'Over every sample of the set: of the scored code points whose label has the display kind, the share with every scored value right. The mean over a row\'s seeds.',
    '',
    ...labelKinds('generator'),
    '',
    '## The agent-written cases',
    '',
    `${capitalized(facts.titles.written)}. A case has full agreement when its two repairs give every code point from the first error on the same label. "Agreed code points" counts every case and leaves the disputed code points out. "The ten neutral edits" are the edits of the train data's damage: the first part has the cases whose damage one to three of them could make, and "other damage" the rest.`,
    '',
    ...breakdown('written', namesOf('written'), 'allThree', true),
    '',
    ...breakdown('written', namesOf('written'), 'whole', true),
    '',
    'Over the cases with full agreement, per display kind of the label:',
    '',
    ...labelKinds('written'),
    '',
    `## For reference: ${facts.dryRun ? 'the validation split in the place of the test split' : 'the dataset\'s test split'}`,
    '',
    `${capitalized(facts.titles.dataset)}: ${number(datasetSize.texts)} samples, ${number(datasetSize.scored)} scored code points, ${number(datasetSize.added)} added code points. The damage is the ten neutral edits of the train data, on documents that no training saw. ${facts.dryRun ? 'The rows of the held-out templates are made up from a sample\'s place in this dry run.' : 'The two held-out templates have no document in the train data at all. The other documents are of templates that the train data has, with sequences of tokens that it does not have.'} The rows of the other templates are in the file of counts.`,
    '',
    ...breakdown('dataset', namesOf('dataset').filter(name => !name.startsWith('template: ') || name === 'template: deployConfig' || name === 'template: taskRunner'), 'allThree', true),
    '',
    ...breakdown('dataset', ['all', datasetRowOfHeldOutTemplates, datasetRowOfTrainTemplates], 'whole', true),
    '',
    ...labelKinds('dataset'),
    '',
    '## Added code points that are shown as an error',
    '',
    'A label is never the display kind `error`, so the shares above do not see whether a row still marks the damage itself. The count is over every added code point of a set.',
    '',
    `| Row | Generator, of ${number(sizeOf('generator', 'all').added)} | Written, all ${sizeOf('written', writtenParts[0].agreedCodePoints).texts} cases, of ${number(sizeOf('written', writtenParts[0].agreedCodePoints).added)} | ${capitalized(nameOfDatasetSet)}, of ${number(datasetSize.added)} |`,
    '| --- | --- | --- | --- |',
    ...rows.map(row => `| ${row.label} | ${addedCell(row, 'generator', 'all')} | ${addedCell(row, 'written', writtenParts[0].agreedCodePoints)} | ${addedCell(row, 'dataset', 'all')} |`),
    '',
    '## What was checked in this run',
    '',
    `- **The files.** Before a text was scored, each of the ${facts.files.length} files of the list had the bytes that its sha256 names, the list was what the three lists of the training side give now, and each file loaded: it was saved with this dataset, every frozen cell and every display entry that is not open holds today's, and every cell that differs from today's is an open one.`,
    `- **A second count.** ${number(facts.secondCounts.compared)} counts of this report were held against the count of the set's own scorer (\`specific/score.ts\`, \`written/score.ts\`, \`learn/score.ts\`), which runs the tables through another function: ${facts.secondCounts.different.length === 0 ? 'none differs' : `${facts.secondCounts.different.length} differ, e.g. ${facts.secondCounts.different.slice(0, 5).join('; ')}`}.`,
    `- **Added structure alone changes nothing.** ${bases.length} tables with the classes, the open display entries and the bit of the listed tables and with no cell changed (${bases.map(base => `${base.name.replace(/^what the tables of /, 'for ').replace(/ add to today's, with no cell changed$/, '')}: ${base.description}`).join('; ')}) were held against the parser as it is in ${number(facts.unchangedTables.compared)} counts: ${facts.unchangedTables.different.length === 0 ? 'none differs' : `${facts.unchangedTables.different.length} differ, e.g. ${facts.unchangedTables.different.slice(0, 5).join('; ')}`}.`,
    ...facts.asToday.map(entry => `- **As today where the ground rules ask for it, ${entry.set}.** ${entry.parsers} tables each show ${number(entry.documents)} valid documents (${number(entry.validCodePoints)} code points) and the ${number(entry.brokenTexts)} broken texts before their first error (${number(entry.beforeErrorCodePoints)} code points) as the parser as it is does: ${entry.validDifferences + entry.beforeErrorDifferences === 0 ? 'no code point differs' : `${number(entry.validDifferences)} code points of valid documents and ${number(entry.beforeErrorDifferences)} before a first error differ`}.`),
    `- **The dataset's split.** ${number(facts.datasetSplit.indexesMade)} indexes were made, ${number(facts.datasetSplit.texts)} of them are samples of the ${facts.datasetSplit.split} split, and ${number(facts.datasetSplit.ofHeldOutTemplates)} of those are ${facts.dryRun ? 'counted as documents of a held-out template by their place' : 'documents of a held-out template'}.`,
    '',
    '| Row | Seed | File | sha256, first 16 | What the tables add to today\'s | Cells that differ from today\'s |',
    '| --- | --- | --- | --- | --- | --- |',
    ...facts.files.map(file => `| ${file.row} | ${file.seed ?? ''} | ${file.path.split('/').slice(-2).join('/')} | ${file.sha256.slice(0, 16)} | ${file.structure} | ${file.differFromToday} |`),
    '',
    '## What the numbers are not',
    '',
    '- **Row 3 is the rules alone, and not the best that rules can reach.** Its author had the train and the validation samples of both train sets in view, wrote for about 75 minutes, and stopped when a change added 0.05 points or less. The review found that four passes of the recipe\'s search from the hand-written tables add 1.0 to 1.4 points of "all three" on validation. Those searched tables are not in the list.',
    '- **Row 6 has no last step,** as the JSON control that it copies has none. Its steps ran once before its saved runs, to time the search, with a train score in view and no validation score.',
    '- **The generator and the written set are two authors\' views of how TOML gets broken.** The kinds of the mixed set (rows 7 and 8) were written by a third agent who saw neither. Where the three thought of the same mistake, e.g. a colon in the place of the equals sign, the rows 7 and 8 were trained on that mistake, in other documents.',
    '- **Neither set shows everything.** The generator has no plain slip of typing that the written set has, e.g. a quote inside a string without its backslash. The written set has no merge conflict, no template that was not rendered, no byte order mark and no HTML entity.',
    '- **The written set is small:** one case is 0.7 points of "whole", and the same sort of damage comes in several cases.',
    '- **The dataset\'s test split has the dataset\'s ceiling below 100:** its labels are those of the document, and some of them no reader of the broken text would give.',
  )
  return facts.dryRun ? lines.map((line, at) => at === 0 ? line : `${dryRunMark}${line}`) : lines
}

if (import.meta.main) {
  const [countsFile, reportFile] = process.argv.slice(2)
  if (countsFile === undefined || reportFile === undefined || process.argv.length !== 4) throw new Error('report.ts takes a file of counts and the file to write the report to: bun lab/recovery-toml/held-back/final/report.ts <counts.json> <report.md>')
  const parsed = JSON.parse(readFileSync(countsFile, 'utf8')) as {format?: unknown}
  if (parsed.format !== 'recovery-toml final counts 1') throw new Error(`${countsFile} is no file of counts of the final scoring: its format is ${JSON.stringify(parsed.format)}`)
  const {rows, bases, ...facts} = parsed as SavedCounts
  writeFileSync(reportFile, `${describeReport(rows, bases, facts).join('\n')}\n`)
  console.log(`The report of ${countsFile} is in ${reportFile}.`)
}
