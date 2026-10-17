// The split of a document: train, validation or test, by the document's tokens. samples.ts gives a sample the split
// of its document. The file is lab/recovery-parser/splits.ts for TOML.
import {tokenSequenceOf} from './labels.ts'
import {hashText} from './random.ts'

export const splits = ['train', 'validation', 'test'] as const
export type Split = typeof splits[number]

// What decides a document's split: its tokens as tokenSequenceOf writes them, e.g. `[h]k=sk=n` for a header and two
// lines with a key and a value.
export function splitKeyOf(document: string): string {
  return tokenSequenceOf(document)
}

// 80% train, 10% validation, 10% test, by a hash of splitKeyOf. So the same document never sits in two splits, and
// neither do two documents that differ only in what their keys, strings and numbers hold, in their comments or in
// their layout: a validation or test document's sequence of tokens is in no train document.
//
// The JSON dataset splits a few very small sequences by hand, e.g. `{}` and `[]`, because a hash put them all into
// train. The templates of this dataset make no document that small: the smallest has two lines with a key and a value.
export function splitOf(document: string): Split {
  const bucket = hashText(splitKeyOf(document)) % 100
  return bucket < 80 ? 'train' : bucket < 90 ? 'validation' : 'test'
}

// The split of a text of one or more documents: the split that every one of its documents is in, or undefined when
// two of them are in different splits. A sample of this dataset has one document. The function is kept so that code
// written for the JSON dataset finds it.
export function splitOfDocuments(documents: readonly string[]): Split | undefined {
  const split = splitOf(documents[0]!)
  for (let index = 1; index < documents.length; index++) if (splitOf(documents[index]!) !== split) return undefined
  return split
}
