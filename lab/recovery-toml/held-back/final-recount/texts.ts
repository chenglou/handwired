// HELD BACK: do not read this folder if you build the parser, the train data, the training or its machinery. See
// ../README.md.
//
// The texts of the recount, see recount.ts: every set as a list of broken texts with their labels, read through the
// set's own loader, and with the rows that count a text worked out here a second time, from the fields of the sample
// or of the case. Nothing of ../final/ is imported.
import {type Sample as DatasetSample, groupOf as groupOfDatasetSample, labelsOf as labelsOfDatasetSample, sampleAt as datasetSampleAt, defaultSeed as datasetSeed} from '../../samples.ts'
import {runTableParser} from '../../table-parser.ts'
import {groupOf as groupOfGeneratorSample, labelsOf as labelsOfGeneratorSample, sampleAt as generatorSampleAt, defaultSeed as generatorSeed, standardCount as generatorSampleCount} from '../specific/samples.ts'
import {neutralEditsOf} from '../written/neutral-edits.ts'
import {labelsOfWritten, readWritten} from '../written/written.ts'

// A value that is not scored is undefined.
export type Label = {kind: number | undefined, depth: number | undefined, container: number | undefined}

export type BrokenText = {
  // E.g. "20261107:12" for a sample and "hand-editing-07" for a case.
  id: string
  broken: string
  codePoints: number[]
  // Per code point: its label, or undefined when no score counts the code point.
  labels: (Label | undefined)[]
  // Per code point: whether the damage added it.
  addedByDamage: boolean[]
  // The first error of the parser as it is, found here with ../../table-parser.ts, or -1.
  firstErrorPosition: number
  // The valid documents that the text was made of, or that its repairs say the author meant.
  documents: string[]
  // The rows of a report that count the text, e.g. ['all', 'kind: colonForEquals'].
  rowNames: string[]
}

export type SetName = 'generator' | 'written' | 'dataset' | 'validation'
export const mainRowOf: Record<SetName, string> = {generator: 'all', written: 'cases with full agreement', dataset: 'all', validation: 'all'}

const codePointsOf = (text: string) => Array.from(text, character => character.codePointAt(0)!)

// The first error of the parser as it is. A loader's own field has to say the same.
function firstErrorOf(id: string, broken: string, fieldOfTheLoader: number): number {
  const firstErrorPosition = runTableParser(broken).firstErrorPosition
  if (firstErrorPosition !== fieldOfTheLoader) throw new Error(`${id}: the parser as it is has its first error at ${firstErrorPosition}, and the loader says ${fieldOfTheLoader}`)
  return firstErrorPosition
}

// The generator's set: the samples 0 to 2,999 of its default seed.
export function generatorTexts(): BrokenText[] {
  const texts: BrokenText[] = []
  for (let index = 0; index < generatorSampleCount; index++) {
    const sample = generatorSampleAt(generatorSeed, index)
    const ofHeldOutTemplate = sample.template === 'deployConfig' || sample.template === 'taskRunner'
    texts.push({
      id: sample.id, broken: sample.broken, codePoints: codePointsOf(sample.broken), labels: labelsOfGeneratorSample(sample),
      addedByDamage: sample.alignment.map(counterpart => counterpart === -1),
      firstErrorPosition: firstErrorOf(sample.id, sample.broken, sample.firstErrorPosition), documents: [sample.original],
      rowNames: [
        'all',
        ofHeldOutTemplate ? 'documents of the two held-out templates' : 'documents of the 14 templates that the train data has',
        ...(ofHeldOutTemplate ? [`template: ${sample.template}`] : []),
        sample.kinds.length === 1 ? 'one mistake' : 'two mistakes',
        `group: ${groupOfGeneratorSample(sample)}`,
        ...sample.kinds.map(kind => `kind: ${kind}`),
      ],
    })
  }
  return texts
}

// The written set: its 150 cases. A case has full agreement when no code point from its first error on is disputed.
export function writtenTexts(): BrokenText[] {
  const {cases, problems} = readWritten()
  if (problems.length > 0) throw new Error(`the files of the written set have ${problems.length} problems`)
  return cases.map(writtenCase => {
    const firstErrorPosition = firstErrorOf(writtenCase.id, writtenCase.broken, writtenCase.firstErrorPosition)
    const hasFullAgreement = !writtenCase.agreement.some((state, position) => state === 'disputed' && position >= firstErrorPosition)
    if (hasFullAgreement === writtenCase.disputedFromFirstError) throw new Error(`${writtenCase.id}: the case's field disputedFromFirstError says otherwise than its code points`)
    const parts = ['all']
    const {damage} = writtenCase
    if (damage !== undefined && damage.other === undefined) parts.push('neutral edits')
    if (damage?.other !== undefined) {
      parts.push('other damage')
      if (neutralEditsOf(writtenCase).otherPlaces.length === 0) parts.push('more than three edits')
    }
    if (writtenCase.opinions.every(opinion => opinion.unsure === undefined)) parts.push('unmarked')
    const rowNames: string[] = []
    for (const part of parts) {
      if (hasFullAgreement) rowNames.push(writtenRowNames[part]!.fullAgreement)
      rowNames.push(writtenRowNames[part]!.agreedCodePoints)
    }
    if (hasFullAgreement) rowNames.push(`full agreement, ${writtenCase.file}`)
    rowNames.push(`agreed code points, ${writtenCase.file}`)
    return {
      id: writtenCase.id, broken: writtenCase.broken, codePoints: codePointsOf(writtenCase.broken), labels: labelsOfWritten(writtenCase),
      addedByDamage: writtenCase.agreement.map(state => state === 'extra'), firstErrorPosition, documents: writtenCase.opinions.map(opinion => opinion.text), rowNames,
    }
  })
}

// The names that the final report gives the parts of the written set.
const writtenRowNames: Record<string, {fullAgreement: string, agreedCodePoints: string}> = {
  'all': {fullAgreement: 'cases with full agreement', agreedCodePoints: 'all cases, the agreed code points'},
  'neutral edits': {fullAgreement: 'full agreement, one to three of the ten neutral edits make the damage', agreedCodePoints: 'agreed code points, one to three of the ten neutral edits make the damage'},
  'other damage': {fullAgreement: 'full agreement, other damage', agreedCodePoints: 'agreed code points, other damage'},
  'more than three edits': {fullAgreement: 'full agreement, other damage that more than three neutral edits make', agreedCodePoints: 'agreed code points, other damage that more than three neutral edits make'},
  'unmarked': {fullAgreement: 'full agreement, no repair marked as unsure', agreedCodePoints: 'agreed code points, no repair marked as unsure'},
}

// The dataset's standard set, the samples 0 to 59,999 of its default seed, by the split of each sample's document.
export type DatasetSamples = {train: DatasetSample[], validation: DatasetSample[], test: DatasetSample[]}
export function datasetSamples(): DatasetSamples {
  const samples: DatasetSamples = {train: [], validation: [], test: []}
  for (let index = 0; index < 60_000; index++) {
    const sample = datasetSampleAt(datasetSeed, index)
    samples[sample.split].push(sample)
  }
  return samples
}

// Samples of the dataset as texts, with the rows of the final report's part on the test split.
export function textsOfDatasetSamples(samples: readonly DatasetSample[]): BrokenText[] {
  return samples.map(sample => {
    const ofHeldOutTemplate = sample.template === 'deployConfig' || sample.template === 'taskRunner'
    return {
      id: sample.id, broken: sample.broken, codePoints: codePointsOf(sample.broken), labels: labelsOfDatasetSample(sample),
      addedByDamage: sample.alignment.map(counterpart => counterpart === -1),
      firstErrorPosition: firstErrorOf(sample.id, sample.broken, sample.firstErrorPosition), documents: [sample.original],
      rowNames: [
        'all',
        ofHeldOutTemplate ? 'documents of the two held-out templates' : 'documents of the 16 templates that the train data has',
        `template: ${sample.template}`,
        `group: ${groupOfDatasetSample(sample)}`,
        ...sample.kinds.map(kind => `kind: ${kind}`),
      ],
    }
  })
}
