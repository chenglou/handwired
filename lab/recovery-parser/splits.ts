// The split of a document: train, validation or test, by the document's tokens. samples.ts gives a sample the split
// of its documents, and damage/several.ts builds a text of several documents from records of one split.
import {tokenSequenceOf} from './labels.ts'
import {hashText} from './random.ts'

export const splits = ['train', 'validation', 'test'] as const
export type Split = typeof splits[number]

// What decides a document's split: its tokens as the grammar table reads them, see tokenSequenceOf, e.g. `{s:n}`. A
// document that is one string, one number or one literal has the sequence `s` or `n`, which is the same for every
// such document, so there the text decides too, e.g. `n true` and `s "abc"`.
export function splitKeyOf(document: string): string {
  const sequence = tokenSequenceOf(document)
  return sequence.length === 1 ? `${sequence} ${document.trim()}` : sequence
}

// A document that is one literal has one of three texts, and a hash puts all three into the train split. So they are
// split by hand, one per split: a half-typed literal alone, e.g. `fals` or `nu`, is then in validation and in test too.
const splitOfLoneLiteral: Record<string, Split> = {'n true': 'train', 'n false': 'validation', 'n null': 'test'}

// The ten smallest sequences of more than one token: an empty container, an empty container inside another, and a
// container with one entry, e.g. `[]`, `{"a": {}}` and `{"a": 1}`. The template scalar makes them, and so do small
// documents of other templates. A hash puts all ten into the train split, so that no validation or test document
// would be an empty container. They are split by hand as the literals are: four in train, three in validation, three
// in test. Each of validation and test has one of the two empty containers, one container that holds an empty one,
// and one container with one entry. Train has the other two of each of the last two sorts.
const splitOfSmallDocument: Record<string, Split> = {
  '[{}]': 'train', '{s:[]}': 'train', '[s]': 'train', '{s:n}': 'train',
  '[]': 'validation', '{s:{}}': 'validation', '[n]': 'validation',
  '{}': 'test', '[[]]': 'test', '{s:s}': 'test',
}

// 80% train, 10% validation, 10% test, by a hash of splitKeyOf, apart from the three literals and the ten small
// sequences above, which are split by hand. So the same document never sits in two splits, and neither do two
// documents that differ only in what their strings and numbers hold or in their layout: a test document's sequence of
// tokens is in no train document. The one exception is a document that is a lone scalar: its sequence of one token is
// in every split, and its text is in one.
export function splitOf(document: string): Split {
  const key = splitKeyOf(document)
  const byHand = splitOfLoneLiteral[key] ?? splitOfSmallDocument[key]
  if (byHand !== undefined) return byHand
  const bucket = hashText(key) % 100
  return bucket < 80 ? 'train' : bucket < 90 ? 'validation' : 'test'
}

// The split of a text of one or more documents: the split that every one of its documents is in, or undefined when
// two of them are in different splits. E.g. the two lines `{"id": 1}` and `{"id": 2, "tags": []}` are a text of the
// train split only when `{s:n}` and `{s:n,s:[]}` are both sequences of the train split. So a record inside a text of
// several documents is held to the same split as that record alone.
export function splitOfDocuments(documents: readonly string[]): Split | undefined {
  const split = splitOf(documents[0]!)
  for (let index = 1; index < documents.length; index++) if (splitOf(documents[index]!) !== split) return undefined
  return split
}
