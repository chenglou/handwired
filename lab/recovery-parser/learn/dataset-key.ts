// Two keys of source files, so that nothing that was made from one version of the sources is taken for another:
//
// - The dataset's key: a hash of every source file that decides what the dataset's samples are. Two runs with the same
//   key read the same dataset. A record of an arm holds the key, and so does every saved file of tables, e.g. tables
//   that were trained before a later commit of the dataset moved samples from the train split to the test split
//   carry the earlier key, and arms/final.ts refuses them.
// - The cache's key: the dataset's key and a hash of the files of learn/ that decide what the arrays of data.ts hold.
//   It is in the name and in the header of every cache file of the samples.
//
// The file has no import from learn/, so that both data.ts and recovery-tables.ts can import it.
import {readFileSync, readdirSync} from 'node:fs'
import {join, resolve} from 'node:path'

const learnFolder = import.meta.dir
const datasetFolder = resolve(learnFolder, '..')
const repoRoot = resolve(datasetFolder, '../..')

// The files of the dataset's key: every .ts file of lab/recovery-parser/ and of its folder damage/, the
// highlighter's tables and display kinds, and the reference highlighter.
export function filesOfTheDatasetKey(): string[] {
  return [
    ...readdirSync(datasetFolder).filter(name => name.endsWith('.ts')).map(name => join(datasetFolder, name)),
    ...readdirSync(join(datasetFolder, 'damage')).filter(name => name.endsWith('.ts')).map(name => join(datasetFolder, 'damage', name)),
    join(repoRoot, 'src/json-search/highlighter/kinds.ts'), join(repoRoot, 'src/json-search/highlighter/tables.ts'), join(repoRoot, 'tests/json-search/highlighter/reference.ts'),
  ]
}

// The files of learn/ that the arrays of data.ts come from: data.ts makes them, intended.ts gives the intended states
// and the mark codePointCanFollow, and recovery-tables.ts gives intended.ts the masks of open cells.
export function filesOfLearnInTheCacheKey(): string[] {
  return [join(learnFolder, 'data.ts'), join(learnFolder, 'intended.ts'), join(learnFolder, 'recovery-tables.ts')]
}

// What a file holds, for the hashes. A check passes another reader, to see that a changed file gives another key.
export type ContentOf = (file: string) => Uint8Array
const fileContent: ContentOf = file => readFileSync(file)

const hashOfFiles = (files: readonly string[], contentOf: ContentOf) => Bun.hash([...files].sort().map(file => Bun.hash(contentOf(file)).toString(16)).join('.')).toString(16)

// The two keys for what `contentOf` reads: the dataset's key, and the cache's key, which starts with the dataset's.
export function keysOfTheSources(contentOf: ContentOf = fileContent): {datasetKey: string, cacheKey: string} {
  const datasetKey = hashOfFiles(filesOfTheDatasetKey(), contentOf)
  return {datasetKey, cacheKey: `${datasetKey}-${hashOfFiles(filesOfLearnInTheCacheKey(), contentOf)}`}
}

// The keys of the files as they are, read once per process.
let known: {datasetKey: string, cacheKey: string} | undefined
export function datasetKey(): string {
  known ??= keysOfTheSources()
  return known.datasetKey
}
export function cacheKey(): string {
  known ??= keysOfTheSources()
  return known.cacheKey
}
