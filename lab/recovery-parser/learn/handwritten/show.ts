// Shows samples as aligned text, with what the hand-written recovery gives under what the labels want. This is how
// the rules were written: by reading where the two differ in samples of the train split.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/handwritten/show.ts [--kind missingComma] [--index 1234] [--split train] [--limit 20]
//       [--skip 0] [--wrong] [--cells] [--tables <file.json>] [--to 60000] [--scratch <folder>]
// --kind shows the samples that have the kind, --index the sample with that index in the dataset, --wrong only the
// samples in which a scored code point is wrong, and --cells adds, per wrong sample, the cells that the parser read
// at the first wrong code point, and the entry of the display table when the tables have open ones. --split is train
// or validation: this script never shows the test split, whose samples are not loaded. --tables shows saved tables in
// place of the hand-written ones.
//
// The lines of a sample, one column per code point (⏎ is a line feed, → a tab):
//   text   the broken text
//   want   the label's display kind: w whitespace, p punctuation, s string, e escape, n number, l literal, E error,
//          k key. Blank where the damage added the code point, ? where the kind is not scored.
//   got    the display kind that the parser gives
//   wantd, gotd   the depth after the code point, 0 to 9, then a to g. - is below 0, + is above 16. wantd and wantc
//          have a ? where the depth and the container are not scored.
//   wantc, gotc   the innermost open container after it: o object, a array, - none
//   miss   k, d or c where the kind, the depth or the container is wrong, * for more than one. Only the code points
//          that a score counts are compared: the ones from the first error on whose label has a scored value. | marks
//          the first damage and ! the first error, where nothing is wrong there.
import {cacheFolderOf, codePointKept, codePointKindScored, codePointNestingScored, codePointScored, groupNames, kindsOf, loadSamples, optionOf, refuseUnknownOptions, splitNames, standardRange} from '../data.ts'
import {createTrace} from '../recovery-parser.ts'
import {displayChoiceName, displayEntryName, displayEntryOf, grammarCellName, grammarChoiceName, lexerCellName, lexerChoiceName, loadTablesForReport} from '../recovery-tables.ts'
import {runOnSample, wrongContainer, wrongDepth, wrongKind, wrongLabelsAt} from '../score.ts'
import {handwrittenTables} from './rules.ts'

const kindLetters = 'wpsenlE.k'
const standIns: Record<number, string> = {0x0a: '⏎', 0x09: '→', 0x0d: '↵', 0x1b: '␛', 0x00: '␀', 0x1a: '␚', 0x7f: '␡', 0xa0: '⍽', 0xfeff: '◊', 0x2028: '␤'}
// One column per code point: characters that would break the columns are shown as another character.
function visible(codePoint: number) {
  const standIn = standIns[codePoint]
  if (standIn !== undefined) return standIn
  if (codePoint < 0x20) return '␦'
  if ((codePoint >= 0x1100 && codePoint <= 0x115f) || (codePoint >= 0x2600 && codePoint <= 0x27bf) || (codePoint >= 0x2e80 && codePoint <= 0xa4cf) || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff) || (codePoint >= 0xff00 && codePoint <= 0xff60) || codePoint >= 0x1f000) return '◆'
  return String.fromCodePoint(codePoint)
}
const depthLetter = (depth: number) => depth < 0 ? '-' : depth > 16 ? '+' : '0123456789abcdefg'[depth]!
const containerLetter = (container: number) => '-oa'[container] ?? '?'

if (import.meta.main) {
  refuseUnknownOptions('handwritten/show.ts', ['--split', '--kind', '--index', '--limit', '--skip', '--wrong', '--cells', '--tables', '--to', '--scratch'])
  const split = optionOf('--split') ?? 'train'
  if (split !== 'train' && split !== 'validation') throw new Error(`--split takes train or validation, and got ${split}: this script never shows the test split`)
  const kind = optionOf('--kind')
  const index = optionOf('--index')
  const limit = Number(optionOf('--limit') ?? 20)
  const skip = Number(optionOf('--skip') ?? 0)
  const onlyWrong = process.argv.includes('--wrong')
  const withCells = process.argv.includes('--cells')
  const tablesFile = optionOf('--tables')
  const tables = tablesFile === undefined ? handwrittenTables().tables : loadTablesForReport(tablesFile).tables
  const samples = loadSamples(standardRange.seed, standardRange.from, Number(optionOf('--to') ?? standardRange.to), cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH']))
  if (index !== undefined && !samples.index.includes(Number(index))) throw new Error(`sample ${index} is not among the loaded samples: it is in the test split, which is never loaded, or outside the range of --to`)
  const trace = createTrace()
  let shown = 0
  let matched = 0
  for (let place = 0; place < samples.sampleCount && shown < limit; place++) {
    if (splitNames[samples.split[place]!] !== split) {
      if (index !== undefined && samples.index[place] === Number(index)) throw new Error(`sample ${index} is in the ${splitNames[samples.split[place]!]} split, and --split is ${split}`)
      continue
    }
    if (index !== undefined && samples.index[place] !== Number(index)) continue
    const firstDamage = samples.firstDamage[place]!
    if (firstDamage === -1 && index === undefined) continue
    const kinds = kindsOf(samples, place)
    if (kind !== undefined && !kinds.includes(kind)) continue
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    runOnSample(trace, samples, place, tables)
    const lines = {text: '', want: '', got: '', wantd: '', gotd: '', wantc: '', gotc: '', miss: ''}
    let firstWrong = -1
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
      lines.miss += miss
    }
    if (onlyWrong && wrong === 0) continue
    matched++
    if (matched <= skip) continue
    shown++
    console.log(`--- ${samples.seed}:${samples.index[place]}  kinds: ${kinds.length === 0 ? 'none' : kinds.join(', ')}${firstDamage === -1 ? '' : `  group: ${groupNames[samples.group[place]!]}`}${samples.debatable[place] === 1 ? '  debatable' : ''}  ${wrong} of ${scored} scored code points are wrong`)
    for (const [name, line] of Object.entries(lines)) console.log(`${name.padEnd(6)}${line}`)
    if (withCells && firstWrong !== -1) {
      // The steps around the first wrong code point: the cells that were read and what they hold.
      for (let position = Math.max(0, firstWrong - 2); position <= firstWrong; position++) {
        const lexerCell = trace.lexerCell[position]!
        const grammarCell = trace.grammarCell[position]!
        const displayEntry = displayEntryOf(tables, trace.event[position]!, trace.grammarAfter[position]!)
        console.log(`      ${String(position).padStart(3)} ${visible(samples.codePoints[start + position]!)}  ${lexerCellName(tables, lexerCell)} -> ${lexerChoiceName(tables, lexerCell)}   ${grammarCellName(tables, grammarCell)} -> ${grammarChoiceName(tables, grammarCell)}${tables.displayOpen.includes(1) ? `   ${displayEntryName(tables, displayEntry)} -> ${displayChoiceName(tables, displayEntry)}` : ''}`)
      }
    }
    console.log('')
  }
  if (shown === 0) console.log('No sample to show.')
}
