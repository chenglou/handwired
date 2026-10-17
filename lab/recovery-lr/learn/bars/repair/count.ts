// Writes dropped-kinds.json of this bar: the display kind per terminal of a token that the repair takes out, by
// the count over the first 5,000 train samples, see dropped-kinds.ts.
//
//   bun lab/recovery-lr/learn/bars/repair/count.ts
import {join} from 'node:path'
import {countDroppedKinds, droppedKindsText, trainSamplesOfCount, writeDroppedKinds} from './dropped-kinds.ts'
import {cheapestRepair} from './repair.ts'

const kindOfDropped = countDroppedKinds((sample, kinds) => cheapestRepair(sample, kinds))
writeDroppedKinds(join(import.meta.dir, 'dropped-kinds.json'), kindOfDropped)
console.log(`dropped-kinds.json, from ${trainSamplesOfCount} train samples:\n${droppedKindsText(kindOfDropped)}`)
