// What the labels want where a cell is read: for every train sample whose run reads the open cell, the depth and
// the container that the original has at the first kept code point after the token, against the depth and the
// container of the parser's stack when it reads the cell. It is a count of what the original says at one cell, not
// of what a choice is worth: a choice also changes what the parser reads afterwards. try.ts compares choices.
//
//   bun lab/recovery-lr/learn/bars/rules/wanted.ts --cell "35,RPAREN" [--samples 20000] [--copies first|later]
// Per line: how many samples, the wanted depth minus the stack's depth, e.g. "+1" where the original is one level
// deeper, the wanted container, and the container of the stack.
import {defaultSeed, sampleAt} from '../../../dataset.ts'
import {containerNames} from '../../../labels.ts'
import {numberOf, optionOf, refuseUnknownOptions} from '../../options.ts'
import {containerOfStack, depthOfStack, runRecoveryParserOnTokens} from '../../recovery-parser.ts'
import {flagOfCell, stateOfCell, terminalName, terminalOfCell} from '../../recovery-tables.ts'
import {tablesToShow} from './show.ts'

refuseUnknownOptions('wanted.ts', ['--cell', '--samples', '--copies'])
const [stateText, terminalText] = (optionOf('--cell') ?? '').split(',').map(part => part.trim())
if (stateText === undefined || terminalText === undefined) throw new Error('--cell wants a state and a terminal, e.g. "35,RPAREN"')
const copies = optionOf('--copies')
const sampleCount = numberOf('--samples', 20_000)
const {tables} = tablesToShow()
const counts = new Map<string, {count: number, examples: number[]}>()
let reads = 0, taken = 0
for (let index = 0; taken < sampleCount; index++) {
  const {sample, split} = sampleAt(defaultSeed, index)
  if (split !== 'train') continue
  taken++
  let seen = false
  runRecoveryParserOnTokens(sample.codePoints, sample.tokens, tables, {
    read: (token, cell, stack) => {
      if (seen || tables.open[cell] !== 1 || String(stateOfCell(tables, cell)) !== stateText || terminalName(tables, terminalOfCell(tables, cell)) !== terminalText) return
      if (copies !== undefined && (copies === 'first') !== (flagOfCell(tables, cell) === 1)) return
      seen = true
      reads++
      // The first kept code point after the token.
      let place = token === sample.tokens.count ? sample.codePoints.length : sample.tokens.start[token]! + sample.tokens.length[token]!
      while (place < sample.codePoints.length && (sample.alignment[place] === -1 || sample.labelKind[place] === 0)) place++
      const key = place === sample.codePoints.length ? 'nothing kept after the token'
        : `${String(sample.labelDepth[place]! - depthOfStack(stack)).padStart(3)}  wanted ${containerNames[sample.labelContainer[place]!]!.padEnd(4)}  stack ${containerNames[containerOfStack(stack)]}`
      const entry = counts.get(key) ?? {count: 0, examples: []}
      entry.count++
      if (entry.examples.length < 5) entry.examples.push(index)
      counts.set(key, entry)
    },
  })
}
console.log(`${reads} of ${taken} train samples read the cell (${stateText}, ${terminalText})${copies === undefined ? '' : `, ${copies} on its line`}. The original's depth after the token minus the stack's depth at the read, the wanted container, the stack's container:`)
for (const [key, {count, examples}] of [...counts].sort((left, right) => right[1].count - left[1].count).slice(0, 25)) console.log(`${String(count).padStart(6)}  ${key}   e.g. ${examples.join(' ')}`)
