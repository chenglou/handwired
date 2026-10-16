// The display kind of a dropped token, per terminal, for a bar that drops tokens: the kind that the most code
// points of the tokens that the bar drops want, over the first 5,000 train samples, by kindsOfDroppedTokensByCount
// of ../../bars.ts. It is the count that every bar may use, so that a dropped token is not wrong by definition.
// Each bar keeps its count in a file dropped-kinds.json next to its code, e.g. {"LET": "keyword", ...}, which its
// count.ts writes and its check.ts counts again.
import {readFileSync, writeFileSync} from 'node:fs'
import {defaultSeed, loadSamples} from '../../../dataset.ts'
import {displayKind, displayKindNames} from '../../../labels.ts'
import type {Sample} from '../../../sample.ts'
import {tables} from '../../../tables.ts'
import {kindsOfDroppedTokensByCount} from '../../bars.ts'
import type {ParserOutput} from '../../score.ts'

export const trainSamplesOfCount = 5000

// The kinds of a bar by the count: `parse` runs the bar on a sample with the given kinds of dropped tokens.
export function countDroppedKinds(parse: (sample: Sample, kindOfDropped: ArrayLike<number>) => ParserOutput, train: readonly Sample[] = loadSamples('train', defaultSeed, trainSamplesOfCount)): Int8Array {
  return kindsOfDroppedTokensByCount(train, parse)
}

// The kinds as the text of a dropped-kinds.json: one kind by name per terminal that a text can hold.
export function droppedKindsText(kindOfDropped: ArrayLike<number>): string {
  const terminals = tables.textTerminals.filter(terminal => terminal !== tables.endSymbol)
  return `{\n${terminals.map(terminal => `  ${JSON.stringify(tables.symbolNames[terminal])}: ${JSON.stringify(displayKindNames[kindOfDropped[terminal]!])}`).join(',\n')}\n}\n`
}
export const writeDroppedKinds = (path: string, kindOfDropped: ArrayLike<number>) => writeFileSync(path, droppedKindsText(kindOfDropped))

// [terminal]: the display kind of a dropped token, from a dropped-kinds.json. A terminal that the file does not
// name is shown as an error.
export function readDroppedKinds(path: string): Int8Array {
  const kindOfDropped = new Int8Array(tables.terminalCount).fill(displayKind.error)
  for (const [terminalName, kindName] of Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>)) {
    const terminal = tables.symbolNames.indexOf(terminalName), kind = (displayKindNames as readonly string[]).indexOf(kindName)
    if (terminal === -1 || terminal >= tables.terminalCount || kind === -1) throw new Error(`${path}: ${terminalName}: ${kindName} names no terminal or no display kind`)
    kindOfDropped[terminal] = kind
  }
  return kindOfDropped
}
