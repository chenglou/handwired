// The three sets of the final scoring, each as a list of broken texts with what a count needs: the labels, which code
// points the damage added, the first error of the parser as it is, and the rows of the report that the text is in.
//
// - The generator's set: the samples 0 to 2,999 of ../specific/, with the rows of ../specific/score.ts.
// - The written set: the 150 cases of ../written/, with the rows of ../written/score.ts.
// - The dataset's test split, for reference: the samples of ../../samples.ts with the indexes 0 to 59,999 whose
//   document is in the test split. Their damage is the train data's, which knows nothing of TOML, so the split says
//   how tables do on other documents with the same damage. A dry run takes the validation split in its place.
import {type LabeledText, requireFinal, standardRange} from '../../learn/data.ts'
import {groupOf as groupOfDatasetSample, heldOutTemplates, labelsOf as labelsOfDatasetSample, sampleAt as datasetSampleAt} from '../../samples.ts'
import {defaultSeed as generatorSeed, labelsOf as labelsOfGeneratorSample, sampleAt as generatorSampleAt, standardCount} from '../specific/samples.ts'
import {rowNames as generatorRowNames, rowNamesOf as generatorRowNamesOf} from '../specific/score.ts'
import {neutralEditsOf} from '../written/neutral-edits.ts'
import {type WrittenCase, labelsOfWritten, readWritten} from '../written/written.ts'

// The label of a code point: a value that is not scored is undefined, and the depth and the container are scored
// together or not at all.
export type Label = {kind: number | undefined, depth: number | undefined, container: number | undefined}

export type ScoredText = {
  // E.g. "20261107:12" for a sample and "hand-editing-07" for a case.
  id: string
  broken: string
  // One entry per code point of the broken text: its label, or undefined for a code point that no score counts.
  labels: readonly (Label | undefined)[]
  // One entry per code point: true when the damage added it, i.e. it has no counterpart in the document that the
  // author meant. In the written set: when both repairs say so.
  added: readonly boolean[]
  // Where the parser as it is reports its first error. A score counts the code points from there on.
  firstErrorPosition: number
  // The valid documents that the text was made of, or that its repairs say the author meant.
  documents: readonly string[]
  // The names of the rows that count the text, e.g. ['all', 'kind: colonForEquals'].
  rows: readonly string[]
}

export type ScoredSet = {
  // What the report calls the set.
  title: string
  // Every row in the order in which a report prints it, whether or not a text is in it.
  rowNames: readonly string[]
  texts: readonly ScoredText[]
}

// The generator's set, see ../specific/README.md. `samples` are the samples themselves, for ../specific/score.ts.
export function generatorSet() {
  const samples = Array.from({length: standardCount}, (_, index) => generatorSampleAt(generatorSeed, index))
  const texts: ScoredText[] = samples.map(sample => ({
    id: sample.id, broken: sample.broken, labels: labelsOfGeneratorSample(sample), added: sample.alignment.map(counterpart => counterpart === -1),
    firstErrorPosition: sample.firstErrorPosition, documents: [sample.original], rows: generatorRowNamesOf(sample),
  }))
  return {title: `the generator of typical mistakes: the samples 0 to ${standardCount - 1} of seed ${generatorSeed}`, rowNames: generatorRowNames, texts, samples}
}

// The rows of the written set. The first six count the cases with full agreement from the first error on, the last
// six every case over its agreed code points. The parts are those of ../written/score.ts.
export const writtenParts = [
  {key: 'all', fullAgreement: 'cases with full agreement', agreedCodePoints: 'all cases, the agreed code points'},
  {key: 'neutralEdits', fullAgreement: 'full agreement, one to three of the ten neutral edits make the damage', agreedCodePoints: 'agreed code points, one to three of the ten neutral edits make the damage'},
  {key: 'otherDamage', fullAgreement: 'full agreement, other damage', agreedCodePoints: 'agreed code points, other damage'},
  {key: 'moreEdits', fullAgreement: 'full agreement, other damage that more than three neutral edits make', agreedCodePoints: 'agreed code points, other damage that more than three neutral edits make'},
  {key: 'unmarked', fullAgreement: 'full agreement, no repair marked as unsure', agreedCodePoints: 'agreed code points, no repair marked as unsure'},
] as const
export const writtenFileRows = (file: string) => ({fullAgreement: `full agreement, ${file}`, agreedCodePoints: `agreed code points, ${file}`})

// The parts of ../written/score.ts that a case is in.
function partsOfCase(writtenCase: WrittenCase): (typeof writtenParts[number]['key'])[] {
  const parts: (typeof writtenParts[number]['key'])[] = ['all']
  if (writtenCase.damage !== undefined && writtenCase.damage.other === undefined) parts.push('neutralEdits')
  if (writtenCase.damage?.other !== undefined) {
    parts.push('otherDamage')
    if (neutralEditsOf(writtenCase).otherPlaces.length === 0) parts.push('moreEdits')
  }
  if (writtenCase.opinions.every(opinion => opinion.unsure === undefined)) parts.push('unmarked')
  return parts
}

// The written set, see ../written/README.md. `cases` are the cases themselves, for ../written/score.ts. Throws when
// the files of the set have a problem, since a case with a problem is left out of every number.
export function writtenSet() {
  const {cases, problems} = readWritten()
  if (problems.length > 0) throw new Error(`the files of the written set have ${problems.length} problems, and bun lab/recovery-toml/held-back/written/check.ts prints them`)
  const files = [...new Set(cases.map(writtenCase => writtenCase.file))].sort()
  const texts: ScoredText[] = cases.map(writtenCase => {
    const rows: string[] = []
    for (const key of partsOfCase(writtenCase)) {
      const part = writtenParts.find(candidate => candidate.key === key)!
      if (!writtenCase.disputedFromFirstError) rows.push(part.fullAgreement)
      rows.push(part.agreedCodePoints)
    }
    if (!writtenCase.disputedFromFirstError) rows.push(writtenFileRows(writtenCase.file).fullAgreement)
    rows.push(writtenFileRows(writtenCase.file).agreedCodePoints)
    return {
      id: writtenCase.id, broken: writtenCase.broken, labels: labelsOfWritten(writtenCase), added: writtenCase.agreement.map(state => state === 'extra'),
      firstErrorPosition: writtenCase.firstErrorPosition, documents: writtenCase.opinions.map(opinion => opinion.text), rows,
    }
  })
  const rowNames = [
    ...writtenParts.map(part => part.fullAgreement), ...files.map(file => writtenFileRows(file).fullAgreement),
    ...writtenParts.map(part => part.agreedCodePoints), ...files.map(file => writtenFileRows(file).agreedCodePoints),
  ]
  return {title: `the written set: the ${cases.length} cases of held-back/written/`, rowNames, texts, cases, files}
}

export const datasetRowOfTrainTemplates = 'documents of the 16 templates that the train data has'
export const datasetRowOfHeldOutTemplates = 'documents of the two held-out templates'
const groupsOfTheDataset = ['one edit', 'two edits', 'three edits']

// The held-out template that a dry run makes up for the validation sample at a place: of every 10 samples, 4 have
// none, 3 have the first template and 3 the second, so that the rows of the two parts have other sizes.
const madeUpHeldOut = (place: number) => place % 10 < 4 ? [] : [`template: ${heldOutTemplates[place % 10 < 7 ? 0 : 1]!}`]

// The dataset's samples with the indexes 0 to 59,999 of one split: the test split in the final run, which needs
// RECOVERY_FINAL, and the validation split in a dry run. `labeledTexts` are the same samples in the shape that
// samplesOf of ../../learn/data.ts takes, in the same order, for a second count with ../../learn/score.ts. `parts`
// says per text whether its document is of a held-out template.
//
// In a dry run no sample of the test split is kept, and the rows of the held-out templates are made up from a
// sample's place, see madeUpHeldOut: the validation split has no document of a held-out template.
export function datasetSet(split: 'test' | 'validation') {
  if (split === 'test') requireFinal('The dataset\'s test split in the final scoring')
  const {seed, from, to} = standardRange()
  const texts: ScoredText[] = []
  const labeledTexts: LabeledText[] = []
  const ofHeldOutTemplate: boolean[] = []
  const templateRows = new Set<string>()
  let indexesMade = 0
  for (let index = from; index < to; index++) {
    const sample = datasetSampleAt(seed, index)
    indexesMade++
    if (sample.split !== split) continue
    const labels = labelsOfDatasetSample(sample)
    const heldOut = split === 'test' ? sample.heldOut : madeUpHeldOut(texts.length)
    const templateRow = heldOut[0] ?? `template: ${sample.template}`
    templateRows.add(templateRow)
    texts.push({
      id: sample.id, broken: sample.broken, labels, added: sample.alignment.map(counterpart => counterpart === -1), firstErrorPosition: sample.firstErrorPosition, documents: [sample.original],
      rows: ['all', heldOut.length > 0 ? datasetRowOfHeldOutTemplates : datasetRowOfTrainTemplates, templateRow, `group: ${groupOfDatasetSample(sample)}`, ...sample.kinds.map(kind => `kind: ${kind}`)],
    })
    labeledTexts.push({
      index, split, source: sample.source, kinds: sample.kinds, group: groupOfDatasetSample(sample), broken: sample.broken, labels, firstDamage: sample.firstDamage,
      original: sample.original, alignment: sample.alignment, replaced: sample.replaced, firstErrorPosition: sample.firstErrorPosition,
    })
    ofHeldOutTemplate.push(heldOut.length > 0)
  }
  const kindRows = [...new Set(texts.flatMap(text => text.rows.filter(row => row.startsWith('kind: '))))].sort()
  const heldOutRows = heldOutTemplates.map(template => `template: ${template}`)
  const rowNames = [
    'all', datasetRowOfHeldOutTemplates, ...heldOutRows, datasetRowOfTrainTemplates, ...[...templateRows].filter(row => !heldOutRows.includes(row)).sort(),
    ...groupsOfTheDataset.map(group => `group: ${group}`), ...kindRows,
  ]
  const title = split === 'test'
    ? `the dataset's test split, with the train data's damage: the samples of seed ${seed} with the indexes ${from} to ${to - 1} whose document is in the test split`
    : `in the place of the dataset's test split, the validation split of seed ${seed}, indexes ${from} to ${to - 1}, with made-up rows for the held-out templates`
  return {title, rowNames, texts, labeledTexts, ofHeldOutTemplate, seed, indexesMade}
}
