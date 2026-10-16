// What a comma at depth 0 is in the neutral train data, for the sixth example of examples.ts: the tables that were
// searched on neutral damage read a comma after an entry as if an array were open.
//
// Run from the repo root: bun lab/recovery-toml/held-back/final/where/train-commas.ts
// It reads the dataset's train split and no held-back text, and counts the train samples whose first error is a
// comma at which the parser as it is counts depth 0. Such a comma is either a code point of the document, i.e. a
// comma of an array or an inline table whose opening bracket the damage took away, or a code point that the damage
// added.
import {defaultSeed, sampleAt} from '../../../samples.ts'
import {runTableParser} from '../../../table-parser.ts'

let trainSamples = 0
let firstErrorAtComma = 0
let commaOfTheDocument = 0
for (let index = 0; index < 60_000; index++) {
  const sample = sampleAt(defaultSeed, index)
  if (sample.split !== 'train') continue
  trainSamples++
  if (Array.from(sample.broken)[sample.firstErrorPosition] !== ',') continue
  const depthBefore = sample.firstErrorPosition === 0 ? 0 : runTableParser(sample.broken).depthAfter[sample.firstErrorPosition - 1]!
  if (depthBefore !== 0) continue
  firstErrorAtComma++
  if (sample.alignment[sample.firstErrorPosition] !== -1) commaOfTheDocument++
}
console.log(`${trainSamples} train samples of the standard set. In ${firstErrorAtComma} the first error is a comma at which the parser as it is counts depth 0: in ${commaOfTheDocument} the comma is a code point of the document, and in ${firstErrorAtComma - commaOfTheDocument} the damage added it.`)
