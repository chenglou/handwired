// How long a twin follows one stack. The tables skip every rejected token, so the exact parser goes on through
// the whole text, and every mix has all but a small share on the tables' choice, e.g. all but 1e-9. Per token, the
// script takes the share that the twin gives to what the exact parser of the tables shows: the smallest of the
// three shares, of the display kind, of the depth and of the container. It prints the mean by the token's place
// from the first error on, without white space and comments.
//
// A twin of whole stacks stays at 1 less the small share. The twin of levels does not: a share that sits on a
// level where the exact parser has another state grows with every reduction, because a reduction multiplies the
// share of the state on top with the share of the state at the level that it reads, as if the two did not belong
// to the same stack.
//
// Run from the repo root: bun lab/recovery-lr/learn/soft-levels/follow.ts [--train 400]
import {defaultSeed, loadSamples} from '../../dataset.ts'
import {containerCount, displayKindCount} from '../../labels.ts'
import {skipTables} from '../bars.ts'
import {packSamples} from '../data.ts'
import {numberOf, refuseUnknownOptions} from '../options.ts'
import {addFirstOnLineFlag, baseTables} from '../recovery-tables.ts'
import {createModel, logitsOfTables} from '../soft/model.ts'
import {createTwin as createStacksTwin} from '../soft/stacks-twin.ts'
import {createReading, createTally, readingDepthCount} from '../soft/twin.ts'
import {createTwin as createLevelsTwin} from './levels-twin.ts'

refuseUnknownOptions('soft-levels/follow.ts', ['--train'])
const samples = loadSamples('train', defaultSeed, numberOf('--train', 400))
const tables = skipTables(addFirstOnLineFlag(baseTables()))
const packed = packSamples(samples, tables)
// The places of a token from the first error on, in groups: the first of a group, and the first of the next.
const groups = [[0, 5], [5, 10], [10, 20], [20, 40], [40, 80], [80, Infinity]] as const
const largestOf = (values: Float64Array, from: number, count: number): number => {
  let largest = 0
  for (let entry = 1; entry < count; entry++) if (values[from + entry]! > values[from + largest]!) largest = entry
  return largest
}
const exactReading = createReading(), twinReading = createReading()

console.log(`Tables that skip every rejected token, ${packed.sampleCount} train samples. The share that a twin gives to what the exact parser shows, by the token's place from the first error on:`)
console.log(`| off the tables' choice | twin | ${groups.map(([from, next]) => next === Infinity ? `from ${from} on` : `${from} to ${next - 1}`).join(' | ')} |`)
console.log(`| --- | --- | ${groups.map(() => '---').join(' | ')} |`)
for (const offTheChoice of [1e-3, 1e-6, 1e-9]) {
  const model = createModel(tables, {start: 'base', startShare: 1 - offTheChoice})
  const exactLogits = logitsOfTables(model.layout, tables)
  const exactTwin = createLevelsTwin(model.layout)
  const twins = [
    {name: '48 exact stacks', twin: createStacksTwin(model.layout)},
    {name: 'levels, the design\'s form', twin: createLevelsTwin(model.layout)},
    {name: 'levels, the variant `pusherBelow`', twin: createLevelsTwin(model.layout, {pusherBelow: 1})},
  ]
  for (const {name, twin} of twins) {
    const shares = groups.map(() => 0), tokens = groups.map(() => 0)
    for (let place = 0; place < packed.sampleCount; place++) {
      // With logits that make every mix the tables' choice, a twin is the exact parser.
      exactTwin.run(exactLogits, packed, [place], createTally(), null, exactReading)
      twin.run(model.logits, packed, [place], createTally(), null, twinReading)
      let placeOfToken = 0
      for (let row = 0; row < exactReading.tokenCount; row++) {
        if (packed.terminal[packed.tokenStart[place]! + row]! < 0) continue
        const share = Math.min(
          twinReading.kind[row * displayKindCount + largestOf(exactReading.kind, row * displayKindCount, displayKindCount)]!,
          twinReading.depth[row * readingDepthCount + largestOf(exactReading.depth, row * readingDepthCount, readingDepthCount)]!,
          twinReading.container[row * containerCount + largestOf(exactReading.container, row * containerCount, containerCount)]!,
        )
        const group = groups.findIndex(([from, next]) => placeOfToken >= from && placeOfToken < next)
        shares[group]! += share
        tokens[group]!++
        placeOfToken++
      }
    }
    console.log(`| ${offTheChoice} | ${name} | ${groups.map((_, group) => tokens[group] === 0 ? 'none' : (shares[group]! / tokens[group]!).toFixed(3)).join(' | ')} |`)
  }
}
