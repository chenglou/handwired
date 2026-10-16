// Shows what the hand-written rules do with broken texts: the parser's output under the labels, code point by
// code point, and the open cells that the run reads with what each holds, in words.
//
//   bun lab/recovery-lr/learn/bars/rules/show.ts --sample 123 [--sample 456]   # train or validation samples by their index
//   bun lab/recovery-lr/learn/bars/rules/show.ts --first 20 [--wrong] [--cell "44,IN"] [--edit "delete a line"]
//       # the first 20 train samples; --wrong: that have a wrong code point; --cell: whose run reads the open cell
//       # (state, terminal); --edit: whose only edit is this one
//   bun lab/recovery-lr/learn/bars/rules/show.ts --own      # the broken programs of broken.ts
//   bun lab/recovery-lr/learn/bars/rules/show.ts --text 'let x = (1 + 2 let y = 3'
// With --split validation, --first reads the validation samples. With --no-cells, the cells are left out.
import {existsSync} from 'node:fs'
import {defaultSeed, sampleAt} from '../../../dataset.ts'
import {onOneLine} from '../../../dump.ts'
import {containerLetters, kindLetters} from '../../../labels.ts'
import {type Sample, alignmentOfTexts, makeSample} from '../../../sample.ts'
import {flagOf, numberOf, optionOf, refuseUnknownOptions} from '../../options.ts'
import {type RecoveryRun, runRecoveryParser, runRecoveryParserOnTokens} from '../../recovery-parser.ts'
import {type RecoveryTables, bison, flagOfCell, loadTables, stateOfCell, terminalName, terminalOfCell} from '../../recovery-tables.ts'
import {cellInWords} from '../../words.ts'
import {ownBrokenPrograms} from './broken.ts'
import {savedTablesPath} from './report.ts'
import {tablesOfRules} from './rules.ts'

// The tables to show: the saved ones, which have the display entries of the count, when they hold the choices of
// the rules as they are now. Otherwise the rules with every dropped token shown as an error.
export function tablesToShow(): {tables: RecoveryTables, note: string} {
  const ofRules = tablesOfRules().tables
  if (existsSync(savedTablesPath)) {
    const saved = loadTables(savedTablesPath).tables
    if (saved.choice.length === ofRules.choice.length && saved.choice.every((choice, cell) => choice === ofRules.choice[cell])) return {tables: saved, note: 'the saved tables'}
    // The rules have changed since: the saved display entries are the nearest that there are.
    if (saved.display.length === ofRules.display.length) return {tables: {...ofRules, display: saved.display}, note: 'the rules as they are now, with the display entries of the saved tables, which were counted for other choices'}
  }
  return {tables: ofRules, note: 'the rules without a count: every open display entry shows an error'}
}

// One line per open cell that the run read, in order, without repeats of the same cell at the same token.
export function cellLines(run: RecoveryRun, tables: RecoveryTables, codePoints: ArrayLike<number>, tokens: {start: ArrayLike<number>, length: ArrayLike<number>, count: number}, most = 40): string[] {
  const lines: string[] = []
  for (let read = 0; read < run.cellsRead.length && lines.length < most; read++) {
    const cell = run.cellsRead[read]!, token = run.cellsReadAtToken[read]!
    const text = token === tokens.count ? 'the end' : onOneLine(String.fromCodePoint(...Array.from({length: Math.min(12, tokens.length[token]!)}, (_, offset) => codePoints[tokens.start[token]! + offset]!)))
    lines.push(`  ${String(token === tokens.count ? codePoints.length : tokens.start[token]).padStart(4)} ${text.padEnd(12)} (${stateOfCell(tables, cell)}, ${terminalName(tables, terminalOfCell(tables, cell))}${flagOfCell(tables, cell) === 1 ? ', first' : ''})  ${cellInWords(tables, cell)}`)
  }
  if (run.cellsRead.length > lines.length) lines.push(`  and ${run.cellsRead.length - lines.length} more reads`)
  return lines
}

// The rows of a sample: the texts, then per label the wanted row and the parser's row, and a row that marks the
// scored code points with a wrong label.
export function sampleLines(sample: Sample, tables: RecoveryTables, title: string, withCells: boolean): {lines: string[], wrong: number} {
  const run = runRecoveryParserOnTokens(sample.codePoints, sample.tokens, tables)
  const {tokens} = sample
  const length = sample.codePoints.length
  const got = {kind: new Array<string>(length).fill(' '), depth: new Array<string>(length).fill(' '), container: new Array<string>(length).fill(' ')}
  const marks = new Array<string>(length).fill(' ')
  let wrong = 0
  for (let token = 0; token < tokens.count; token++) {
    for (let place = tokens.start[token]!; place < tokens.start[token]! + tokens.length[token]!; place++) {
      got.kind[place] = kindLetters[run.kind[token]!]!
      got.depth[place] = String(run.depth[token]! % 10)
      got.container[place] = containerLetters[run.container[token]!]!
      if (place < sample.firstErrorPosition || sample.alignment[place] === -1) continue
      const kindWrong = run.kind[token] !== sample.labelKind[place], depthWrong = run.depth[token] !== sample.labelDepth[place], containerWrong = run.container[token] !== sample.labelContainer[place]
      if (kindWrong || depthWrong || containerWrong) {
        wrong++
        marks[place] = depthWrong ? 'd' : containerWrong ? 'c' : 'k'
      }
    }
  }
  const wanted = (letterOf: (place: number) => string): string => Array.from({length}, (_, place) => sample.alignment[place] === -1 ? '+' : letterOf(place)).join('')
  const lines = [
    `${title}  edits: ${sample.edits.join(', ')}  first error at code point ${sample.firstErrorPosition}, ${wrong} of ${sample.scored} scored code points wrong, ${run.insertedTokens} tokens inserted`,
    `meant   ${onOneLine(sample.original)}`,
    `broken  ${onOneLine(sample.broken)}`,
    `kind    ${wanted(place => kindLetters[sample.labelKind[place]!]!)}`,
    `  got   ${got.kind.join('')}`,
    `depth   ${wanted(place => String(sample.labelDepth[place]! % 10))}`,
    `  got   ${got.depth.join('')}`,
    `in      ${wanted(place => containerLetters[sample.labelContainer[place]!]!)}`,
    `  got   ${got.container.join('')}`,
    `wrong   ${' '.repeat(sample.firstErrorPosition)}^${marks.slice(sample.firstErrorPosition + 1).join('')}`,
  ]
  if (withCells) lines.push(...cellLines(run, tables, sample.codePoints, tokens))
  return {lines, wrong}
}

if (import.meta.main) {
  refuseUnknownOptions('show.ts', ['--sample', '--first', '--cell', '--edit', '--text', '--split'], ['--wrong', '--own', '--no-cells'])
  const {tables, note} = tablesToShow()
  console.log(`The tables: ${note}. Rows: the wanted label, then what the parser shows. In the row "wrong": ^ the first error, d a wrong depth, c a wrong container, k a wrong display kind.\n`)
  const withCells = !flagOf('--no-cells')
  const text = optionOf('--text')
  if (text !== undefined) {
    const run = runRecoveryParser(text, tables)
    const codePoints = Array.from(text, character => character.codePointAt(0)!)
    const {scan} = await import('../../../parser.ts')
    const tokens = scan(codePoints)
    const row = (letterOf: (token: number) => string): string => {
      const letters = new Array<string>(codePoints.length).fill(' ')
      for (let token = 0; token < tokens.count; token++) letters.fill(letterOf(token), tokens.start[token], tokens.start[token]! + tokens.length[token]!)
      return letters.join('')
    }
    console.log([`text    ${onOneLine(text)}`, `kind    ${row(token => kindLetters[run.kind[token]!]!)}`, `depth   ${row(token => String(run.depth[token]! % 10))}`, `in      ${row(token => containerLetters[run.container[token]!]!)}`,
      run.valid ? 'valid' : `error   ${' '.repeat(run.firstErrorPosition)}^`, ...cellLines(run, tables, codePoints, tokens)].join('\n'))
  }
  if (flagOf('--own')) {
    for (const [index, {name, meant, broken}] of ownBrokenPrograms.entries()) {
      const sample = makeSample({id: `own:${index}`, original: meant, broken, alignment: alignmentOfTexts(meant, broken)})
      if (typeof sample === 'string') {
        console.log(`own ${index}, ${name}: no sample, ${sample}\n`)
        continue
      }
      console.log(`${sampleLines(sample, tables, `own ${index}, ${name}`, withCells).lines.join('\n')}\n`)
    }
  }
  const chosen = process.argv.flatMap((argument, index) => argument === '--sample' ? [Number(process.argv[index + 1])] : [])
  for (const index of chosen) {
    const {sample, split, sort} = sampleAt(defaultSeed, index)
    console.log(`${sampleLines(sample, tables, `#${index}  ${split}  ${sort}`, withCells).lines.join('\n')}\n`)
  }
  const first = numberOf('--first', 0)
  if (first > 0) {
    const split = optionOf('--split') ?? 'train'
    const onlyWrong = flagOf('--wrong'), onlyEdit = optionOf('--edit')
    const cellOption = optionOf('--cell')
    let onlyCell: {state: number, terminal: string} | undefined
    if (cellOption !== undefined) {
      const [stateText, terminalText] = cellOption.split(',')
      const state = Number(stateText), terminal = (terminalText ?? '').trim()
      if (!Number.isInteger(state) || (!bison.symbolNames.includes(terminal) && !tables.addedTerminals.some(added => added.name === terminal))) throw new Error(`--cell wants a state and a terminal, e.g. "44,IN", and got ${cellOption}`)
      onlyCell = {state, terminal}
    }
    let shown = 0
    for (let index = 0; shown < first && index < 60_000; index++) {
      const {sample, split: splitOfSample, sort} = sampleAt(defaultSeed, index)
      if (splitOfSample !== split) continue
      if (onlyEdit !== undefined && (sample.edits.length !== 1 || sample.edits[0] !== onlyEdit)) continue
      if (onlyCell !== undefined) {
        const {state, terminal} = onlyCell
        const run = runRecoveryParserOnTokens(sample.codePoints, sample.tokens, tables)
        if (!run.cellsRead.some(cell => stateOfCell(tables, cell) === state && terminalName(tables, terminalOfCell(tables, cell)) === terminal)) continue
      }
      const {lines, wrong} = sampleLines(sample, tables, `#${index}  ${split}  ${sort}`, withCells)
      if (onlyWrong && wrong === 0) continue
      shown++
      console.log(`${lines.join('\n')}\n`)
    }
  }
}
