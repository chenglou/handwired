// Compares the table parser with the plain JavaScript reference highlighter on many texts, valid and broken: the same
// display kind in all 512 cells, the same first error position and kind, the same verdict. On valid texts it also
// compares the parser's depth and container with labels.ts's own scan.
//
// Run from the repo root: bun lab/recovery-parser/check-table-parser.ts [number of dataset samples, default 12000]
import {createCorpus} from '../../tests/json-search/highlighter/corpus.ts'
import {highlightReference} from '../../tests/json-search/highlighter/reference.ts'
import {scanNesting} from './labels.ts'
import {defaultSeed, sampleAt} from './samples.ts'
import {capacity, runTableParser} from './table-parser.ts'

// Returns what differs between the table parser and the reference on one text, or null.
export function tableParserDifference(text: string): string | null {
  const trace = runTableParser(text)
  const reference = highlightReference(text)
  for (let position = 0; position < capacity; position++) {
    if (trace.displayKind[position] !== reference.displayKinds[position]) {
      return `display kind at ${position}: tables ${trace.displayKind[position]}, reference ${reference.displayKinds[position]}`
    }
  }
  if (trace.firstErrorPosition !== reference.firstErrorPosition) return `first error position: tables ${trace.firstErrorPosition}, reference ${reference.firstErrorPosition}`
  if (trace.firstErrorKind !== reference.firstErrorKind) return `first error kind: tables ${trace.firstErrorKind}, reference ${reference.firstErrorKind}`
  if (Number(trace.valid) !== reference.valid) return `valid: tables ${trace.valid}, reference ${reference.valid}`
  if (trace.valid) {
    const codePoints = Array.from(text)
    const {depth, container} = scanNesting(codePoints)
    for (let position = 0; position < codePoints.length; position++) {
      if (trace.depthAfter[position] !== depth[position]) return `depth after ${position}: tables ${trace.depthAfter[position]}, scan ${depth[position]}`
      if (trace.containerAfter[position] !== container[position]) return `container after ${position}: tables ${trace.containerAfter[position]}, scan ${container[position]}`
    }
  }
  return null
}

if (import.meta.main) {
  const sampleCount = Number(process.argv[2] ?? 12_000)
  const corpus = createCorpus(20261014, {random: 3000, mutated: 9000, long: 400})
  const texts = [...corpus.all]
  for (let index = 0; index < sampleCount; index++) {
    const sample = sampleAt(defaultSeed, index)
    texts.push(sample.broken)
    if (sample.source !== 'valid') texts.push(sample.original)
  }
  let valid = 0
  let failures = 0
  for (const text of texts) {
    const difference = tableParserDifference(text)
    if (difference !== null) {
      failures++
      if (failures <= 10) console.log(`${difference}\n  ${JSON.stringify(text)}`)
    }
    if (highlightReference(text).valid === 1) valid++
  }
  console.log(`${texts.length} texts, ${valid} valid and ${texts.length - valid} broken: ${failures === 0 ? 'the table parser and the reference agree on every one' : `${failures} differ`}`)
  if (failures > 0) process.exitCode = 1
}
