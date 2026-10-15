// Whether a text of the written set is also a text of the generated samples. A parser that was trained on the samples
// must not have seen a case, so no broken text, no intended text and no repair of the set may be among the samples
// that a training run draws: not as the same text, and not as the same JSON value in another layout.
//
// Run from the repo root: bun lab/recovery-parser/written/check-overlap.ts [samples, default 60000] [seed]
// It names every text of the set that is among the first samples of the seed, and its last line is e.g.
// "60000 samples of seed 20261015, 57016 of them broken: 0 of 240 broken texts, 0 of 240 intended texts and 0 of 480
// repairs are among them." The exit code is 1 when a text is among them. 60,000 samples take about 15 seconds.
import {readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {defaultSeed, sampleAt} from '../samples.ts'
import {readRepairFile} from './format.ts'
import {type WrittenCase, readWritten, writtenFolder} from './written.ts'

// The texts of one case: its broken text, the writer's intended text, and every repair of the broken text, also one
// that left-out.txt names.
export type CaseTextsOfSet = {id: string, broken: string, intended: string, repairs: readonly string[]}

// A valid text's JSON value in one layout, so that two texts of the same value compare as equal, or undefined for a
// text that is not valid JSON.
function valueOf(text: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(text))
  } catch {
    return undefined
  }
}

// The ids of the cases whose broken text, intended text or repair is among the first samples of a seed. A text is
// among them when it is a sample's broken text, its original or one of its documents, or when it has the JSON value of
// one of the sample's documents.
export function overlapWithSamples(cases: readonly CaseTextsOfSet[], sampleCount: number, seed: number = defaultSeed) {
  const texts = new Set<string>()
  const values = new Set<string>()
  let brokenSamples = 0
  for (let index = 0; index < sampleCount; index++) {
    const sample = sampleAt(seed, index)
    // A text of several valid documents is broken too, and its broken text is its original.
    if (sample.source !== 'valid') brokenSamples++
    texts.add(sample.broken)
    texts.add(sample.original)
    for (const document of sample.documents) {
      texts.add(document)
      const value = valueOf(document)
      if (value !== undefined) values.add(value)
    }
  }
  const among = (text: string) => {
    const value = valueOf(text)
    return texts.has(text) || (value !== undefined && values.has(value))
  }
  return {
    samples: sampleCount, brokenSamples,
    broken: cases.filter(entry => among(entry.broken)).map(entry => entry.id),
    intended: cases.filter(entry => among(entry.intended)).map(entry => entry.id),
    // One id per repair that is among the samples, so a case can stand twice.
    repairs: cases.flatMap(entry => entry.repairs.filter(among).map(() => entry.id)),
  }
}

// The texts of every case of a folder, with the repairs as the repair files hold them. `cases` are the folder's cases
// when the caller has read them already.
export function textsOfSet(folder: string = writtenFolder, cases: readonly WrittenCase[] = readWritten(folder).cases): CaseTextsOfSet[] {
  const repairsOf = new Map<string, string[]>()
  for (const file of readdirSync(join(folder, 'repairs')).filter(name => name.endsWith('.txt')).sort()) {
    for (const repair of readRepairFile(readFileSync(join(folder, 'repairs', file), 'utf8')).items) repairsOf.set(repair.id, [...(repairsOf.get(repair.id) ?? []), repair.repaired])
  }
  return cases.map(writtenCase => ({id: writtenCase.id, broken: writtenCase.broken, intended: writtenCase.original, repairs: repairsOf.get(writtenCase.blindId) ?? []}))
}

if (import.meta.main) {
  const sampleCount = Number(process.argv[2] ?? 60000)
  const seed = Number(process.argv[3] ?? defaultSeed)
  const cases = textsOfSet()
  const overlap = overlapWithSamples(cases, sampleCount, seed)
  for (const id of overlap.broken) console.log(`among the samples: the broken text of ${id}`)
  for (const id of overlap.intended) console.log(`among the samples: the intended text of ${id}`)
  for (const id of overlap.repairs) console.log(`among the samples: a repair of ${id}`)
  const repairs = cases.reduce((total, entry) => total + entry.repairs.length, 0)
  console.log(`${overlap.samples} samples of seed ${seed}, ${overlap.brokenSamples} of them broken: ${overlap.broken.length} of ${cases.length} broken texts, ${overlap.intended.length} of ${cases.length} intended texts and ${overlap.repairs.length} of ${repairs} repairs are among them.`)
  if (overlap.broken.length + overlap.intended.length + overlap.repairs.length > 0) process.exitCode = 1
}
