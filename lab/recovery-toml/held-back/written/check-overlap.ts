// Whether a text of the written set is also a text of the generated samples, and how much of the set's documents the
// samples' documents hold. A parser that was trained on the samples must not have seen a case, so no broken payload
// and no repaired document of the set may be among the samples that a training run draws: not as the same text, and
// not as the same TOML value in another layout.
//
// Run from the repo root: bun lab/recovery-toml/held-back/written/check-overlap.ts [samples, default 60000] [seed]
// Its first line is e.g. "60000 samples of seed 20261016: 0 of 150 broken payloads and 0 of 300 repaired documents are
// among them, as the same text or as the same TOML value." It prints counts alone, so that its output quotes no case,
// and the exit code is 1 when a text is among the samples. 60,000 samples take about 10 seconds. Run it again when the
// dataset changes.
import {displayKind} from '../../kinds.ts'
import {labelReference} from '../../reference.ts'
import {defaultSeed, sampleAt} from '../../samples.ts'
import {readWritten} from './written.ts'

// A valid document's TOML value in one layout, so that two documents of the same value compare as equal, or undefined
// for a text that Bun's parser rejects.
function valueOf(text: string): string | undefined {
  try {
    return JSON.stringify(Bun.TOML.parse(text))
  } catch {
    return undefined
  }
}

// The names and the string values of a valid document: every run of code points that is shown as a key, as the name
// of a header, or as a string, e.g. `edition` and `"2021"`. A dot or a quote of another kind ends a run, so
// `tool.ruff` is two names.
function namesAndStringsOf(text: string): {names: string[], strings: string[]} {
  const names: string[] = []
  const strings: string[] = []
  const reference = labelReference(text)
  if (!reference.valid) return {names, strings}
  const codePoints = Array.from(text)
  let runStart = 0
  reference.labels.forEach((label, index) => {
    if (index + 1 < codePoints.length && reference.labels[index + 1]!.kind === label.kind) return
    const run = codePoints.slice(runStart, index + 1).join('')
    if (label.kind === displayKind.key || label.kind === displayKind.headerName) names.push(run)
    else if (label.kind === displayKind.string) strings.push(run)
    runStart = index + 1
  })
  return {names, strings}
}

if (import.meta.main) {
  const sampleCount = Number(process.argv[2] ?? 60_000)
  const seed = Number(process.argv[3] ?? defaultSeed)
  const {cases, problems} = readWritten()
  if (problems.length > 0) console.log(`${problems.length} problems in the files: check.ts prints them.\n`)
  const sampleTexts = new Set<string>()
  const sampleValues = new Set<string>()
  const sampleNames = new Set<string>()
  const sampleStrings = new Set<string>()
  for (let index = 0; index < sampleCount; index++) {
    const sample = sampleAt(seed, index)
    sampleTexts.add(sample.broken)
    for (const document of sample.documents) {
      if (sampleTexts.has(document)) continue
      sampleTexts.add(document)
      const value = valueOf(document)
      if (value !== undefined) sampleValues.add(value)
      const {names, strings} = namesAndStringsOf(document)
      for (const name of names) sampleNames.add(name)
      for (const string of strings) sampleStrings.add(string)
    }
  }
  const among = (text: string) => sampleTexts.has(text) || sampleValues.has(valueOf(text) ?? '')
  const brokenAmong = cases.filter(writtenCase => among(writtenCase.broken)).length
  const repaired = cases.flatMap(writtenCase => writtenCase.opinions.map(opinion => opinion.text))
  const repairedAmong = repaired.filter(among).length
  console.log(`${sampleCount} samples of seed ${seed}: ${brokenAmong} of ${cases.length} broken payloads and ${repairedAmong} of ${repaired.length} repaired documents are among them, as the same text or as the same TOML value.`)
  // The names and strings of the writers' repaired documents, each counted as often as it stands there.
  const ofSet = cases.map(writtenCase => namesAndStringsOf(writtenCase.opinions[0]!.text))
  const names = ofSet.flatMap(found => found.names)
  const strings = ofSet.flatMap(found => found.strings)
  console.log(`Parts of the texts are in both: ${names.filter(name => sampleNames.has(name)).length} of the ${names.length} keys and header names of the writers' repaired documents and ${strings.filter(string => sampleStrings.has(string)).length} of their ${strings.length} strings are also in the documents of these samples, e.g. names that many TOML files have.`)
  if (brokenAmong + repairedAmong > 0 || problems.length > 0) process.exitCode = 1
}
