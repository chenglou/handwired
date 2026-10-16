// The bar "yacc error productions": bison's own parser and recovery for miniml-errors.y, scored as every other
// parser of the experiment is.
//
//   yaccErrorProductions(sample)   what the bar says of a sample's broken text, as a ParserOutput of ../../score.ts
//
// What a token is shown as:
// - A shifted token has the display kind that the labels give it: a function of its terminal and of the symbol
//   below it on the stack, see kindOfTerminal of ../../../labels.ts. So a valid program gets its labels exactly.
// - A discarded token, and a token that is shifted into a state which no valid program enters, e.g. the `else`
//   of `if a else c`, reads an entry of a display table over (shifted or discarded, the state on top, the
//   terminal). display-kinds.json holds the entries, set by the count that the trained tables use: per entry the
//   kind that the most code points of the train samples want there, among the scored code points whose depth and
//   container the bar has right. An entry that no such code point reads shows a discarded token as an error and a
//   shifted one as the labels would.
// - The depth, the container and the stack's hash come from the symbols on bison's stack, with `error` counted
//   as the symbols whose place it has, see yacc-parser.ts. A discarded token has the stack as it is when bison
//   discards it.
// - A reduction gives its left side and the tokens that its right side covers. An `error` covers the tokens of
//   the states that were popped for it and the tokens that were discarded before it was shifted.
// - As inserted tokens the bar counts the terminals that the `error` of a reduced rule stands for, e.g. one for a
//   reduction by `binding: IDENT parameters error expr`, whose `error` stands for a missing `=`.
//
//   yaccBarOf(form)                the same for the bar with one thing taken out, see YaccForm of yacc-parser.ts
//
//   bun lab/recovery-lr/learn/bars/yacc/bar.ts [--train <samples for the count>] [--validation <samples>] [--write] [--forms]
// prints the bar's scores on the validation samples with the count made on the train samples. With --write it
// writes the count to display-kinds.json. With --forms it also prints a row for each other form of the bar.
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {defaultSeed, loadSamples} from '../../../dataset.ts'
import {displayKind, displayKindCount, displayKindNames, kindOfTerminal} from '../../../labels.ts'
import type {Sample} from '../../../sample.ts'
import {commentKind, isTrivia} from '../../../tables.ts'
import {eachSample} from '../../data.ts'
import {numberOf, refuseUnknownOptions, standardTrainCount, standardValidationCount} from '../../options.ts'
import {type ParserOutput, scoreHeader, scoreOutputs, scoreRow} from '../../score.ts'
import {type YaccForm, type YaccRun, type YaccTables, formOfTheBar, nameOfForm, runYacc, shownShifted, yaccTables, yaccTablesOf} from './yacc-parser.ts'

// The display table of the bar: [(0 for a shifted token, stateCount for a discarded one) + state) × terminalCount +
// terminal] is a display kind, or -1 for an entry that the count did not set.
export type YaccDisplay = Int8Array
export const emptyDisplay = (tables: YaccTables = yaccTables): YaccDisplay => new Int8Array(2 * tables.stateCount * tables.terminalCount).fill(-1)
const entryOf = (tables: YaccTables, discarded: boolean, state: number, terminal: number): number => ((discarded ? tables.stateCount : 0) + state) * tables.terminalCount + terminal

// The display entry that a token of a run reads, or -1 for a token whose kind the labels fix: white space, a
// comment, and a token that is shifted into a state which a valid program can enter.
function entryOfToken(tables: YaccTables, run: YaccRun, token: number, terminal: number): number {
  if (isTrivia(terminal)) return -1
  if (run.shown[token] === shownShifted) return tables.reachedByValid[run.state[token]!] === 1 ? -1 : entryOf(tables, false, run.state[token]!, terminal)
  return entryOf(tables, true, run.state[token]!, terminal)
}

// A run of bison's parser on a sample's broken text, in the form that the scorer takes.
export function outputOfYaccRun(sample: Sample, run: YaccRun, display: YaccDisplay, tables: YaccTables = yaccTables): ParserOutput {
  const {tokens} = sample
  const kind = new Int8Array(tokens.count), taken = new Uint8Array(tokens.count)
  for (let token = 0; token < tokens.count; token++) {
    const terminal = tokens.kind[token]!
    if (isTrivia(terminal)) {
      kind[token] = terminal === commentKind ? displayKind.comment : displayKind.whitespace
      continue
    }
    const entry = entryOfToken(tables, run, token, terminal)
    const counted = entry === -1 ? -1 : display[entry]!
    if (run.shown[token] === shownShifted) {
      taken[token] = 1
      kind[token] = counted !== -1 ? counted : kindOfTerminal(terminal, run.symbolBelow[token]!)
    } else kind[token] = counted !== -1 ? counted : displayKind.error
  }
  return {kind, depth: run.depth, container: run.container, stack: run.stack, taken, reductions: run.reductions, insertedTokens: run.terminalsStoodFor}
}

// The count: per display entry, the kind that the most scored code points of `samples` want there, among the code
// points whose depth and container the bar has right. Of several kinds with the same count, the first. An entry
// that no such code point reads stays -1.
export function displayByCount(samples: Iterable<Sample>, tables: YaccTables = yaccTables): YaccDisplay {
  const display = emptyDisplay(tables)
  const wanted = new Int32Array(display.length * displayKindCount)
  for (const sample of samples) {
    const {tokens} = sample
    const run = runYacc(tokens, tables)
    for (let token = sample.firstErrorToken; token < tokens.count; token++) {
      const entry = entryOfToken(tables, run, token, tokens.kind[token]!)
      if (entry === -1) continue
      for (let place = tokens.start[token]!; place < tokens.start[token]! + tokens.length[token]!; place++) {
        if (sample.alignment[place] !== -1 && run.depth[token] === sample.labelDepth[place] && run.container[token] === sample.labelContainer[place]) wanted[entry * displayKindCount + sample.labelKind[place]!]!++
      }
    }
  }
  for (let entry = 0; entry < display.length; entry++) {
    let best = -1, most = 0
    for (let kind = 0; kind < displayKindCount; kind++) {
      if (wanted[entry * displayKindCount + kind]! > most) {
        most = wanted[entry * displayKindCount + kind]!
        best = kind
      }
    }
    display[entry] = best
  }
  return display
}

// display-kinds.json: one line per entry that the count set, e.g. ["discarded", 2, "RPAREN", "punctuation"].
export const displayPath = join(import.meta.dir, 'display-kinds.json')
type DisplayFile = {note: string, trainSamples: number, entries: [shown: 'shifted' | 'discarded', state: number, terminal: string, kind: string][]}
export function displayToText(display: YaccDisplay, trainSamples: number, tables: YaccTables = yaccTables): string {
  const lines: string[] = []
  for (let entry = 0; entry < display.length; entry++) {
    if (display[entry] === -1) continue
    const state = Math.floor(entry / tables.terminalCount) % tables.stateCount
    lines.push(JSON.stringify([entry >= tables.stateCount * tables.terminalCount ? 'discarded' : 'shifted', state, tables.symbolNames[entry % tables.terminalCount], displayKindNames[display[entry]!]]))
  }
  const note = 'The display kinds of the bar "yacc error productions", set by the count of bar.ts over train samples. Written by bar.ts --write.'
  return `{\n"note": ${JSON.stringify(note)},\n"trainSamples": ${trainSamples},\n"entries": [\n${lines.join(',\n')}\n]\n}\n`
}
export function displayOfText(text: string, tables: YaccTables = yaccTables): YaccDisplay {
  const file = JSON.parse(text) as DisplayFile
  const display = emptyDisplay(tables)
  for (const [shown, state, terminal, kind] of file.entries) {
    const terminalNumber = tables.symbolNames.indexOf(terminal), kindNumber = (displayKindNames as readonly string[]).indexOf(kind)
    if (terminalNumber === -1 || terminalNumber >= tables.terminalCount || kindNumber === -1 || state < 0 || state >= tables.stateCount) throw new Error(`display-kinds.json holds an entry that the tables do not have: ${JSON.stringify([shown, state, terminal, kind])}`)
    display[entryOf(tables, shown === 'discarded', state, terminalNumber)] = kindNumber
  }
  return display
}

let committedDisplay: YaccDisplay | undefined
// The display table of the committed display-kinds.json.
export function yaccDisplay(): YaccDisplay {
  if (committedDisplay === undefined) {
    if (!existsSync(displayPath)) throw new Error(`no ${displayPath}: run bar.ts --write`)
    committedDisplay = displayOfText(readFileSync(displayPath, 'utf8'))
  }
  return committedDisplay
}

// The bar: what bison's parser for miniml-errors.y, with its own recovery, says of a sample's broken text.
export const yaccErrorProductions = (sample: Sample): ParserOutput => outputOfYaccRun(sample, runYacc(sample.tokens), yaccDisplay())

// The bar in another form: the grammar without the rule for a missing local `let`, or the stack read without
// `error` as a symbol above its expression. Its display kinds are counted on the train samples at the first call,
// which takes about 10 s: only the bar itself has its count in a committed file.
export function yaccBarOf(form: YaccForm, trainCount: number = standardTrainCount): (sample: Sample) => ParserOutput {
  if (form.inRule && form.errorAboveItsExpression && trainCount === standardTrainCount) return yaccErrorProductions
  const tables = yaccTablesOf(form)
  let display: YaccDisplay | undefined
  return sample => {
    display ??= displayByCount(eachSample('train', trainCount), tables)
    return outputOfYaccRun(sample, runYacc(sample.tokens, tables), display, tables)
  }
}

if (import.meta.main) {
  refuseUnknownOptions('bar.ts', ['--train', '--validation'], ['--write', '--forms'])
  const trainCount = numberOf('--train', standardTrainCount)
  const display = displayByCount(eachSample('train', trainCount))
  if (process.argv.includes('--write')) {
    writeFileSync(displayPath, displayToText(display, trainCount))
    console.log(`wrote ${displayPath}`)
  }
  const validation = loadSamples('validation', defaultSeed, numberOf('--validation', standardValidationCount))
  const withoutCount = emptyDisplay()
  console.log(`The bar "yacc error productions" on ${validation.length} validation samples, with the count made on ${trainCount} train samples:`)
  console.log(scoreHeader)
  console.log(scoreRow('yacc error productions, discarded tokens shown as errors', scoreOutputs(validation, sample => outputOfYaccRun(sample, runYacc(sample.tokens), withoutCount))))
  console.log(scoreRow('yacc error productions, with the count', scoreOutputs(validation, sample => outputOfYaccRun(sample, runYacc(sample.tokens), display))))
  if (process.argv.includes('--forms')) {
    for (const form of [{...formOfTheBar, inRule: false}, {...formOfTheBar, errorAboveItsExpression: false}, {inRule: false, errorAboveItsExpression: false}]) console.log(scoreRow(`${nameOfForm(form)}, with the count`, scoreOutputs(validation, yaccBarOf(form, trainCount))))
  }
}
