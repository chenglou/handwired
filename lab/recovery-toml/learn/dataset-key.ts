// Two keys of source files, so that nothing that was made from one version of the sources is taken for another:
//
// - The dataset's key: a hash of every source file that decides what the dataset's samples are. Two runs with the same
//   key read the same dataset. Every saved file of tables holds the key, e.g. tables that were trained before a later
//   commit of the dataset moved samples from the train split to another split carry the earlier key.
// - The cache's key: the dataset's key and a hash of the files of learn/ that decide what the arrays of data.ts hold.
//   It is in the name and in the header of every cache file of the samples.
//
// The file has no import from learn/, so that both data.ts and recovery-tables.ts can import it.
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join, resolve} from 'node:path'

const learnFolder = import.meta.dir
const datasetFolder = resolve(learnFolder, '..')

// The files of the dataset's key: every .ts file of lab/recovery-toml/ and of its folder damage/, when there is
// one. The tables, the display kinds and the reference labeler are among them. The folders learn/ and held-back/ are
// not: nothing of the dataset may read them.
export function filesOfTheDatasetKey(): string[] {
  const typeScriptFilesOf = (folder: string) => existsSync(folder) ? readdirSync(folder).filter(name => name.endsWith('.ts')).map(name => join(folder, name)) : []
  return [...typeScriptFilesOf(datasetFolder), ...typeScriptFilesOf(join(datasetFolder, 'damage'))]
}

// The files of learn/ that the arrays of data.ts come from: data.ts makes them, and recovery-tables.ts gives today's
// tables, with which data.ts finds every sample's first error.
export function filesOfLearnInTheCacheKey(): string[] {
  return [join(learnFolder, 'data.ts'), join(learnFolder, 'recovery-tables.ts'), join(learnFolder, 'recovery-parser.ts')]
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
