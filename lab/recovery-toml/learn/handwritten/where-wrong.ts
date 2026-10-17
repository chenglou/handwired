// Where the hand-written recovery is still wrong: for every sample with a wrong scored code point, the cells that
// the parser read at the first such code point, and what was wrong there. The samples' wrong code points are added
// up per pair of cells, so the top of the list is where reading samples pays most.
//
// Run from the repo root:
//   bun lab/recovery-toml/learn/handwritten/where-wrong.ts [--set neutral] [--split train] [--kind missingCloser] [--source kinds]
//       [--top 30] [--examples 1] [--each] [--tables <file.json>] [--as-it-is] [--scratch <folder>]
// --set is neutral or mixed, see sets.ts. --split is train or validation: this script never reads the test split.
// --kind counts only the samples that have the kind, and --source only the samples of one half of the mixed set,
// damage or kinds. --each counts every wrong code point for the cells that it read itself, where the default counts
// every wrong code point of a sample for the cells of the sample's first wrong one. --tables reads saved tables in
// place of the hand-written ones, and --as-it-is the parser as it is.
//
// A line reads e.g. "2304 wrong in 213 samples  depth +1  (between, comma) (afterValue, comma, depth 1, array)
// (comma, valueOrClose)": in 213 samples the first wrong code point is a comma that the tokenizer read between
// tokens and the grammar after a value inside an array, the parser's depth there is one more than the label's, and
// these samples have 2,304 wrong code points in all. "kind k->s" means that the label says key and the parser shows
// a string. An example shows the text around the code point, which is between 【 and 】.
import {kindLetters} from '../../kinds.ts'
import {codePointNestingScored, codePointScored, kindsOf, splitNames} from '../data.ts'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {createTrace} from '../recovery-parser.ts'
import {asIsTables, displayEntryName, displayEntryOf, grammarCellName, lexerCellName, loadTablesForReport} from '../recovery-tables.ts'
import {runOnSample, wrongKind, wrongLabelsAt} from '../score.ts'
import {handwrittenTables} from './rules.ts'
import {type SetName, loadSet, scratchFolderOf, setNames} from './sets.ts'

export const visible = (codePoint: number) => codePoint === 0x0a ? '⏎' : codePoint === 0x09 ? '→' : codePoint === 0x0d ? '↵' : codePoint === 0x1b ? '␛' : codePoint === 0xa0 ? '⍽' : codePoint === 0xfeff ? '◊' : codePoint < 0x20 ? '␦' : String.fromCodePoint(codePoint)

if (import.meta.main) {
  refuseUnknownOptions('handwritten/where-wrong.ts', ['--set', '--split', '--kind', '--source', '--top', '--examples', '--each', '--tables', '--as-it-is', '--scratch'])
  const setName = (optionOf('--set') ?? 'neutral') as SetName
  if (!setNames.includes(setName)) throw new Error(`--set takes neutral or mixed, and got ${setName}`)
  const split = optionOf('--split') ?? 'train'
  if (split !== 'train' && split !== 'validation') throw new Error(`--split takes train or validation, and got ${split}: this script never reads the test split`)
  const kind = optionOf('--kind')
  const source = optionOf('--source')
  const top = Number(optionOf('--top') ?? 30)
  const exampleCount = Number(optionOf('--examples') ?? 1)
  const each = process.argv.includes('--each')
  const tablesFile = optionOf('--tables')
  const tables = process.argv.includes('--as-it-is') ? asIsTables() : tablesFile === undefined ? handwrittenTables().tables : loadTablesForReport(tablesFile).tables
  const samples = loadSet(setName, scratchFolderOf(optionOf('--scratch')))
  const trace = createTrace()
  const tally = new Map<string, {samples: number, wrong: number, examples: string[]}>()
  let wrongSamples = 0
  let wrongCodePoints = 0
  let scoredCodePoints = 0
  for (let place = 0; place < samples.sampleCount; place++) {
    if (splitNames[samples.split[place]!] !== split || samples.firstDamage[place] === -1) continue
    if (source !== undefined && samples.sourceNames[samples.source[place]!] !== source) continue
    const sampleKinds = kindsOf(samples, place)
    if (kind !== undefined && !sampleKinds.includes(kind)) continue
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    runOnSample(trace, samples, place, tables)
    const keys: string[] = []
    const positions: number[] = []
    for (let position = samples.firstErrorPosition[place]!; position < length; position++) {
      const flags = samples.flags[start + position]!
      if ((flags & codePointScored) === 0) continue
      scoredCodePoints++
      const wrongLabels = wrongLabelsAt(samples, start + position, trace, position)
      if (wrongLabels === 0) continue
      if (!each && keys.length > 0) {
        keys.push(keys[0]!)
        continue
      }
      const depthDifference = (flags & codePointNestingScored) === 0 ? 0 : trace.depthAfter[position]! - samples.labelDepth[start + position]!
      const what = depthDifference !== 0 ? `depth ${depthDifference > 0 ? '+' : ''}${depthDifference}`
        : (wrongLabels & wrongKind) !== 0 ? `kind ${kindLetters[samples.labelKind[start + position]!]}->${kindLetters[trace.displayKind[position]!]}` : 'container'
      keys.push(`${what}  ${lexerCellName(tables, trace.lexerCell[position]!)} ${grammarCellName(tables, trace.grammarCell[position]!)} ${displayEntryName(tables, displayEntryOf(tables, trace.event[position]!, trace.grammarAfter[position]!))}`)
      positions.push(position)
    }
    if (keys.length === 0) continue
    wrongSamples++
    wrongCodePoints += keys.length
    const seen = new Set<string>()
    let nextPosition = 0
    for (const key of keys) {
      const entry = tally.get(key) ?? {samples: 0, wrong: 0, examples: []}
      entry.wrong++
      if (!seen.has(key)) {
        seen.add(key)
        entry.samples++
        if (entry.examples.length < exampleCount) {
          const at = positions[each ? nextPosition : 0]!
          let text = ''
          for (let position = Math.max(0, at - 60); position < Math.min(length, at + 40); position++) {
            const shown = visible(samples.codePoints[start + position]!)
            text += position === at ? `【${shown}】` : shown
          }
          entry.examples.push(`${samples.index[place]} [${sampleKinds.join(', ')}] ${text}`)
        }
      }
      if (each) nextPosition++
      tally.set(key, entry)
    }
  }
  console.log(`Set ${setName}, split ${split}${kind === undefined ? '' : `, kind ${kind}`}${source === undefined ? '' : `, source ${source}`}: ${wrongCodePoints} of ${scoredCodePoints} scored code points are wrong (${(100 - 100 * wrongCodePoints / scoredCodePoints).toFixed(2)}% right), in ${wrongSamples} samples.`)
  for (const [key, entry] of [...tally].sort((left, right) => right[1].wrong - left[1].wrong).slice(0, top)) {
    console.log(`${String(entry.wrong).padStart(7)} wrong in ${String(entry.samples).padStart(5)} samples  ${key}`)
    for (const example of entry.examples) console.log(`            ${example}`)
  }
}
