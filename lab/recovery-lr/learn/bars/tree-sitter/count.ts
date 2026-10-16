// Writes dropped-kinds.json of this bar: the display kind per terminal of a token that lies in an error node of
// tree-sitter's tree, by the count over the first 5,000 train samples, see ../repair/dropped-kinds.ts.
//
//   bun lab/recovery-lr/learn/bars/tree-sitter/count.ts
import {join} from 'node:path'
import {defaultSeed, loadSamples} from '../../../dataset.ts'
import {countDroppedKinds, droppedKindsText, trainSamplesOfCount, writeDroppedKinds} from '../repair/dropped-kinds.ts'
import {outputOfTree} from './tree-sitter.ts'
import {treesOf} from './trees.ts'

const train = loadSamples('train', defaultSeed, trainSamplesOfCount)
const trees = new Map(treesOf(train.map(sample => sample.codePoints)).map((tree, index) => [train[index]!, tree]))
const kindOfDropped = countDroppedKinds((sample, kinds) => outputOfTree(sample.tokens, trees.get(sample)!, {kindOfDropped: kinds}), train)
writeDroppedKinds(join(import.meta.dir, 'dropped-kinds.json'), kindOfDropped)
console.log(`dropped-kinds.json, from ${trainSamplesOfCount} train samples:\n${droppedKindsText(kindOfDropped)}`)
