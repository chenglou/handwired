// Shows samples as aligned text, with what the hand-written recovery gives under what the labels want. This is how
// the rules were written: by reading where the two differ in samples of the train split.
//
// Run from the repo root:
//   bun lab/recovery-toml/learn/handwritten/show.ts [--set neutral] [--kind missingCloser] [--source kinds] [--index 1234] [--split train]
//       [--limit 20] [--skip 0] [--wrong] [--cells] [--at "(afterValue, keyOnly, depth 0)"] [--tables <file.json>] [--as-it-is] [--text "a = [1,⏎b = 2"] [--examples] [--scratch <folder>]
// --kind shows the samples that have the kind, --source the samples of one half of the mixed set, --index the sample
// with that index, --wrong only the samples in which a scored code point is wrong, and --cells adds the cells that the
// parser read around the first wrong code point. --at shows only the samples in which a code point at or after the first
// error reads a cell or an entry whose name holds the text, with the cells around the first such code point.
// --split is train or validation: this script never shows the test split. --text shows what the tables do with a
// text of your own, with ⏎ for a line feed, and every cell that it reads. --examples shows what the tables do with the
// example of every rule.
//
// The lines of a sample, one column per code point (⏎ is a line feed, → a tab), cut into pieces of 150 columns:
//   text   the broken text
//   want   the label's display kind, with the letters of ../../kinds.ts: w whitespace, p punctuation, s string, e
//          escape, n number, l literal, E error, k key, h header name, c comment. Blank where the damage added the
//          code point, ? where the kind is not scored.
//   got    the display kind that the parser gives
//   wantd, gotd   the depth after the code point, 0 to 9, then a to g. - is below 0, + is above 16. wantd has a ? where
//          the depth and the container are not scored.
//   wantc, gotc   the innermost open container after it: i inline table, a array, - none
//   miss   k, d or c where the kind, the depth or the container is wrong, * for more than one. Only the code points
//          that a score counts are compared. | marks the first damage and ! the first error, where nothing is wrong.
// The lines of the depth and of the container are left out of a piece in which they are all right.
import {kindLetters} from '../../kinds.ts'
import {codePointKept, codePointKindScored, codePointNestingScored, codePointScored, kindsOf, splitNames} from '../data.ts'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {type RecoveryTrace, codePointsOf, createTrace, runRecoveryParser} from '../recovery-parser.ts'
import {
  type RecoveryTables, asIsTables, displayChoiceName, displayEntryName, displayEntryOf, grammarCellName, grammarChoiceName, lexerCellName, lexerChoiceName, loadTablesForReport,
} from '../recovery-tables.ts'
import {runOnSample, wrongContainer, wrongDepth, wrongKind, wrongLabelsAt} from '../score.ts'
import {handwrittenTables, rules} from './rules.ts'
import {type SetName, loadSet, scratchFolderOf, setNames} from './sets.ts'
import {visible} from './where-wrong.ts'

const depthLetter = (depth: number) => depth < 0 ? '-' : depth > 16 ? '+' : '0123456789abcdefg'[depth]!
const containerLetter = (container: number) => '-ia'[container] ?? '?'
const pieceWidth = 150

// The step at a position: the cells that the parser read and what they hold.
export const describeStep = (tables: RecoveryTables, trace: RecoveryTrace, position: number, codePoint: number) => {
  const lexerCell = trace.lexerCell[position]!
  const grammarCell = trace.grammarCell[position]!
  const displayEntry = displayEntryOf(tables, trace.event[position]!, trace.grammarAfter[position]!)
  return `${String(position).padStart(5)} ${visible(codePoint)}  ${lexerCellName(tables, lexerCell)} -> ${lexerChoiceName(tables, lexerCell)}   ${grammarCellName(tables, grammarCell)} -> ${grammarChoiceName(tables, grammarCell)}   ${displayEntryName(tables, displayEntry)} -> ${displayChoiceName(tables, displayEntry)}   depth ${trace.depthAfter[position]}`
}

if (import.meta.main) {
  refuseUnknownOptions('handwritten/show.ts', ['--set', '--split', '--kind', '--source', '--index', '--limit', '--skip', '--wrong', '--cells', '--at', '--tables', '--as-it-is', '--text', '--examples', '--scratch'])
  const tablesFile = optionOf('--tables')
  const tables = process.argv.includes('--as-it-is') ? asIsTables() : tablesFile === undefined ? handwrittenTables().tables : loadTablesForReport(tablesFile).tables
  const ownText = optionOf('--text')
  if (process.argv.includes('--examples')) {
    // The example of every rule, with what the tables show for it.
    for (const rule of rules) {
      const {codePoints, truncated} = codePointsOf(rule.example.replaceAll('⏎', '\n').replaceAll('→', '\t').replaceAll('↵', '\r').replaceAll('⍽', '\u00a0').replaceAll('◊', '\ufeff').replaceAll('␛', '\u001b'))
      const trace = runRecoveryParser(codePoints, truncated, tables)
      console.log(`--- ${rule.name}`)
      console.log(`text  ${codePoints.map(visible).join('')}`)
      console.log(`got   ${codePoints.map((_, position) => kindLetters[trace.displayKind[position]!]).join('')}`)
      console.log(`gotd  ${codePoints.map((_, position) => depthLetter(trace.depthAfter[position]!)).join('')}`)
      console.log(`gotc  ${codePoints.map((_, position) => containerLetter(trace.containerAfter[position]!)).join('')}\n`)
    }
  } else if (ownText !== undefined) {
    const {codePoints, truncated} = codePointsOf(ownText.replaceAll('⏎', '\n').replaceAll('→', '\t'))
    const trace = runRecoveryParser(codePoints, truncated, tables)
    console.log(`text  ${codePoints.map(visible).join('')}`)
    console.log(`got   ${codePoints.map((_, position) => kindLetters[trace.displayKind[position]!]).join('')}`)
    console.log(`gotd  ${codePoints.map((_, position) => depthLetter(trace.depthAfter[position]!)).join('')}`)
    console.log(`gotc  ${codePoints.map((_, position) => containerLetter(trace.containerAfter[position]!)).join('')}`)
    console.log(`first error at ${trace.firstErrorPosition}`)
    codePoints.forEach((codePoint, position) => console.log(describeStep(tables, trace, position, codePoint)))
  } else {
    const setName = (optionOf('--set') ?? 'neutral') as SetName
    if (!setNames.includes(setName)) throw new Error(`--set takes neutral or mixed, and got ${setName}`)
    const split = optionOf('--split') ?? 'train'
    if (split !== 'train' && split !== 'validation') throw new Error(`--split takes train or validation, and got ${split}: this script never shows the test split`)
    const kind = optionOf('--kind')
    const source = optionOf('--source')
    const index = optionOf('--index')
    const limit = Number(optionOf('--limit') ?? 20)
    const skip = Number(optionOf('--skip') ?? 0)
    const onlyWrong = process.argv.includes('--wrong')
    const withCells = process.argv.includes('--cells')
    const at = optionOf('--at')
    const samples = loadSet(setName, scratchFolderOf(optionOf('--scratch')))
    const trace = createTrace()
    let shown = 0
    let matched = 0
    for (let place = 0; place < samples.sampleCount && shown < limit; place++) {
      if (splitNames[samples.split[place]!] !== split) continue
      if (index !== undefined && samples.index[place] !== Number(index)) continue
      if (source !== undefined && samples.sourceNames[samples.source[place]!] !== source) continue
      const firstDamage = samples.firstDamage[place]!
      const kinds = kindsOf(samples, place)
      if (kind !== undefined && !kinds.includes(kind)) continue
      const start = samples.start[place]!
      const length = samples.start[place + 1]! - start
      runOnSample(trace, samples, place, tables)
      const lines = {text: '', want: '', got: '', wantd: '', gotd: '', wantc: '', gotc: '', miss: ''}
      let firstWrong = -1
      let firstAt = -1
      let wrong = 0
      let scored = 0
      const firstError = samples.firstErrorPosition[place]!
      for (let position = 0; position < length; position++) {
        const flags = samples.flags[start + position]!
        const isKept = (flags & codePointKept) !== 0
        const kindScored = (flags & codePointKindScored) !== 0
        const nestingScored = (flags & codePointNestingScored) !== 0
        lines.text += visible(samples.codePoints[start + position]!)
        lines.want += !isKept ? ' ' : kindScored ? kindLetters[samples.labelKind[start + position]!]! : '?'
        lines.got += kindLetters[trace.displayKind[position]!]!
        lines.wantd += !isKept ? ' ' : nestingScored ? depthLetter(samples.labelDepth[start + position]!) : '?'
        lines.gotd += depthLetter(trace.depthAfter[position]!)
        lines.wantc += !isKept ? ' ' : nestingScored ? containerLetter(samples.labelContainer[start + position]!) : '?'
        lines.gotc += containerLetter(trace.containerAfter[position]!)
        let miss = position === firstDamage ? '|' : position === firstError ? '!' : ' '
        if (firstError !== -1 && position >= firstError && (flags & codePointScored) !== 0) {
          scored++
          const wrongLabels = wrongLabelsAt(samples, start + position, trace, position)
          if (wrongLabels !== 0) {
            wrong++
            if (firstWrong === -1) firstWrong = position
            miss = wrongLabels === wrongKind ? 'k' : wrongLabels === wrongDepth ? 'd' : wrongLabels === wrongContainer ? 'c' : '*'
          }
        }
        if (at !== undefined && firstAt === -1 && firstError !== -1 && position >= firstError) {
          const names = `${lexerCellName(tables, trace.lexerCell[position]!)} ${grammarCellName(tables, trace.grammarCell[position]!)} ${displayEntryName(tables, displayEntryOf(tables, trace.event[position]!, trace.grammarAfter[position]!))}`
          if (names.includes(at)) firstAt = position
        }
        lines.miss += miss
      }
      if (onlyWrong && wrong === 0) continue
      if (at !== undefined && firstAt === -1) continue
      matched++
      if (matched <= skip) continue
      shown++
      console.log(`--- ${samples.seed}:${samples.index[place]}  ${samples.sourceNames[samples.source[place]!]}  kinds: ${kinds.join(', ')}  ${wrong} of ${scored} scored code points are wrong`)
      for (let from = 0; from < length; from += pieceWidth) {
        const piece = (line: string) => line.slice(from, from + pieceWidth)
        const nestingWrong = /[dc*]/.test(piece(lines.miss))
        for (const [name, line] of Object.entries(lines)) {
          if (!nestingWrong && ['wantd', 'gotd', 'wantc', 'gotc'].includes(name)) continue
          console.log(`${name.padEnd(6)}${piece(line)}`)
        }
      }
      const around = at !== undefined ? firstAt : withCells ? firstWrong : -1
      if (around !== -1) for (let position = Math.max(0, around - 3); position <= Math.min(length - 1, around + 1); position++) console.log(`     ${describeStep(tables, trace, position, samples.codePoints[start + position]!)}`)
      console.log('')
    }
    if (shown === 0) console.log('No sample to show.')
  }
}
