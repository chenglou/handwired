// Where the hand-written rules go wrong on the train samples: for every sample with a wrong scored code point, the
// open cell that the run read last before its first wrong token, with the wrong code points of the sample counted
// for that cell. The counts are rough: the cell before the first wrong token is not always the cause, e.g. when
// the parser reached its first error on another stack than the labels suppose.
//
//   bun lab/recovery-lr/learn/bars/rules/where-wrong.ts [--samples 8000] [--cells 50] [--split validation]
//   bun lab/recovery-lr/learn/bars/rules/where-wrong.ts --cell "44,IN"     # the samples of one cell, by their indexes
// Per cell: the samples, their wrong code points, how the parser's depth at the first wrong token differs from the
// wanted one (e.g. "+1: 12" for 12 samples in which the parser is one level too deep), and three samples to show
// with show.ts --sample.
import {defaultSeed, sampleAt} from '../../../dataset.ts'
import {isTrivia} from '../../../tables.ts'
import {flagOf, numberOf, optionOf, refuseUnknownOptions} from '../../options.ts'
import {runRecoveryParserOnTokens, shownReadAs, shownShifted} from '../../recovery-parser.ts'
import {stateOfCell, terminalName, terminalOfCell} from '../../recovery-tables.ts'
import {cellInWords} from '../../words.ts'
import {tablesToShow} from './show.ts'

if (import.meta.main) {
  refuseUnknownOptions('where-wrong.ts', ['--samples', '--cells', '--split', '--cell'], ['--stack'])
  // With --stack, a code point is wrong when its token is not taken on the symbols that the original's stack holds
  // there, as the column "stack" counts, and only the samples with all three right everywhere are looked at: what
  // the strict column asks beyond the three values.
  const byStack = flagOf('--stack')
  const split = optionOf('--split') ?? 'train'
  if (split !== 'train' && split !== 'validation') throw new Error(`--split is train or validation, and got ${split}`)
  const sampleCount = numberOf('--samples', 8000), cellsShown = numberOf('--cells', 50)
  const onlyCell = optionOf('--cell')
  const {tables, note} = tablesToShow()
  type Entry = {samples: number, wrong: number, depthDifferences: Map<string, number>, examples: number[]}
  const perCell = new Map<number, Entry>()
  let scored = 0, wrongInAll = 0, wrongSamples = 0, taken = 0
  for (let index = 0; taken < sampleCount; index++) {
    const {sample, split: splitOfSample} = sampleAt(defaultSeed, index)
    if (splitOfSample !== split) continue
    taken++
    const run = runRecoveryParserOnTokens(sample.codePoints, sample.tokens, tables)
    const {tokens} = sample
    let wrong = 0, wrongInThree = 0, firstWrongToken = -1, depthDifference = ''
    for (let token = sample.firstErrorToken; token < tokens.count; token++) {
      for (let place = tokens.start[token]!; place < tokens.start[token]! + tokens.length[token]!; place++) {
        if (sample.alignment[place] === -1) continue
        const threeRight = run.kind[token] === sample.labelKind[place] && run.depth[token] === sample.labelDepth[place] && run.container[token] === sample.labelContainer[place]
        if (!threeRight) wrongInThree++
        const taken = isTrivia(tokens.kind[token]!) || run.shown[token] === shownShifted || run.shown[token] === shownReadAs
        if (byStack ? taken && run.stack[token] === sample.labelStack[place] : threeRight) continue
        wrong++
        if (firstWrongToken !== -1) continue
        firstWrongToken = token
        const difference = run.depth[token]! - sample.labelDepth[place]!
        depthDifference = difference !== 0 ? `${difference > 0 ? '+' : ''}${difference}` : run.container[token] !== sample.labelContainer[place] ? 'container' : run.kind[token] !== sample.labelKind[place] ? 'kind' : taken ? 'stack' : 'not taken'
      }
    }
    if (byStack && wrongInThree > 0) continue
    scored += sample.scored
    wrongInAll += wrong
    if (wrong === 0) continue
    wrongSamples++
    // The last open cell that the run read at or before the first wrong token.
    let cell = -1
    for (let read = 0; read < run.cellsRead.length && run.cellsReadAtToken[read]! <= firstWrongToken; read++) cell = run.cellsRead[read]!
    const entry = perCell.get(cell) ?? {samples: 0, wrong: 0, depthDifferences: new Map<string, number>(), examples: []}
    entry.samples++
    entry.wrong += wrong
    entry.depthDifferences.set(depthDifference, (entry.depthDifferences.get(depthDifference) ?? 0) + 1)
    entry.examples.push(index)
    perCell.set(cell, entry)
  }
  console.log(`The tables: ${note}. ${taken} ${split} samples: ${wrongInAll} of ${scored} scored code points are wrong (${(100 * wrongInAll / scored).toFixed(2)}%), in ${wrongSamples} samples.`)
  const sorted = [...perCell].sort((left, right) => right[1].wrong - left[1].wrong)
  const differencesOf = (entry: Entry): string => [...entry.depthDifferences].sort((left, right) => right[1] - left[1]).slice(0, 5).map(([difference, count]) => `${difference}: ${count}`).join(', ')
  if (onlyCell !== undefined) {
    const [state, terminal] = onlyCell.split(',').map(part => part.trim())
    for (const [cell, entry] of sorted) {
      if (cell === -1 || String(stateOfCell(tables, cell)) !== state || terminalName(tables, terminalOfCell(tables, cell)) !== terminal) continue
      console.log(`${cellInWords(tables, cell)}\n  ${entry.samples} samples, ${entry.wrong} wrong code points, depth at the first wrong token: ${differencesOf(entry)}\n  samples: ${entry.examples.slice(0, 60).join(' ')}`)
    }
  } else {
    console.log('samples  wrong code points  share of all wrong  the cell before the first wrong token, what it holds | the parser\'s depth there against the wanted one | samples')
    for (const [cell, entry] of sorted.slice(0, cellsShown)) {
      const name = cell === -1 ? 'no open cell' : `(${stateOfCell(tables, cell)}, ${terminalName(tables, terminalOfCell(tables, cell))}) ${cellInWords(tables, cell)}`
      console.log(`${String(entry.samples).padStart(5)} ${String(entry.wrong).padStart(7)} ${(100 * entry.wrong / wrongInAll).toFixed(1).padStart(5)}%  ${name} | ${differencesOf(entry)} | ${entry.examples.slice(0, 4).join(' ')}`)
    }
  }
}
