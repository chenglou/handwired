// The samples in which the hand-written recovery has fewer scored code points right than another parser: the one
// rule "after an error, start anew at the next line" of ../restart-at-next-line.ts, or with --as-it-is the parser as
// it is. They are listed by the cells that the hand-written tables read at the first code point that the other
// parser has right and they have wrong, with the code points that the samples lose and gain.
//
// Run from the repo root:
//   bun lab/recovery-toml/learn/handwritten/worse.ts [--set neutral] [--split train] [--source kinds] [--as-it-is] [--top 30] [--examples 1] [--scratch <folder>]
import {codePointScored, kindsOf, splitNames} from '../data.ts'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {createTrace} from '../recovery-parser.ts'
import {asIsTables, displayEntryName, displayEntryOf, grammarCellName, lexerCellName} from '../recovery-tables.ts'
import {runRestartAtNextLineInto} from '../restart-at-next-line.ts'
import {runOnSample, wrongLabelsAt} from '../score.ts'
import {handwrittenTables} from './rules.ts'
import {type SetName, loadSet, scratchFolderOf, setNames} from './sets.ts'
import {visible} from './where-wrong.ts'

if (import.meta.main) {
  refuseUnknownOptions('handwritten/worse.ts', ['--set', '--split', '--source', '--as-it-is', '--top', '--examples', '--scratch'])
  const setName = (optionOf('--set') ?? 'neutral') as SetName
  if (!setNames.includes(setName)) throw new Error(`--set takes neutral or mixed, and got ${setName}`)
  const split = optionOf('--split') ?? 'train'
  if (split !== 'train' && split !== 'validation') throw new Error(`--split takes train or validation, and got ${split}: this script never reads the test split`)
  const source = optionOf('--source')
  const top = Number(optionOf('--top') ?? 30)
  const exampleCount = Number(optionOf('--examples') ?? 1)
  const againstAsIs = process.argv.includes('--as-it-is')
  const tables = handwrittenTables().tables
  const asIs = asIsTables()
  const samples = loadSet(setName, scratchFolderOf(optionOf('--scratch')))
  const trace = createTrace()
  const other = createTrace()
  const tally = new Map<string, {samples: number, lost: number, gained: number, examples: string[]}>()
  let worseSamples = 0
  let lostInAll = 0
  let gainedInAll = 0
  let samplesThatLose = 0
  for (let place = 0; place < samples.sampleCount; place++) {
    if (splitNames[samples.split[place]!] !== split || samples.firstDamage[place] === -1 || samples.firstErrorPosition[place] === -1) continue
    if (source !== undefined && samples.sourceNames[samples.source[place]!] !== source) continue
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    runOnSample(trace, samples, place, tables)
    if (againstAsIs) runOnSample(other, samples, place, asIs)
    else runRestartAtNextLineInto(other, samples.codePoints, start, length)
    let lost = 0
    let gained = 0
    let firstLost = -1
    for (let position = samples.firstErrorPosition[place]!; position < length; position++) {
      if ((samples.flags[start + position]! & codePointScored) === 0) continue
      const wrongHere = wrongLabelsAt(samples, start + position, trace, position) !== 0
      const wrongThere = wrongLabelsAt(samples, start + position, other, position) !== 0
      if (wrongHere && !wrongThere) {
        lost++
        if (firstLost === -1) firstLost = position
      } else if (!wrongHere && wrongThere) {
        gained++
      }
    }
    lostInAll += lost
    gainedInAll += gained
    if (lost > 0) samplesThatLose++
    if (lost <= gained) continue
    worseSamples++
    const key = `${lexerCellName(tables, trace.lexerCell[firstLost]!)} ${grammarCellName(tables, trace.grammarCell[firstLost]!)} ${displayEntryName(tables, displayEntryOf(tables, trace.event[firstLost]!, trace.grammarAfter[firstLost]!))}`
    const entry = tally.get(key) ?? {samples: 0, lost: 0, gained: 0, examples: []}
    entry.samples++
    entry.lost += lost
    entry.gained += gained
    if (entry.examples.length < exampleCount) {
      let text = ''
      for (let position = Math.max(0, firstLost - 60); position < Math.min(length, firstLost + 40); position++) {
        const shown = visible(samples.codePoints[start + position]!)
        text += position === firstLost ? `【${shown}】` : shown
      }
      entry.examples.push(`${samples.index[place]} [${kindsOf(samples, place).join(', ')}] ${text}`)
    }
    tally.set(key, entry)
  }
  console.log(`Set ${setName}, split ${split}${source === undefined ? '' : `, source ${source}`}, against ${againstAsIs ? 'the parser as it is' : 'the one rule'}: the hand-written tables lose ${lostInAll} code points in ${samplesThatLose} samples and gain ${gainedInAll}. ${worseSamples} samples lose more than they gain.`)
  for (const [key, entry] of [...tally].sort((left, right) => (right[1].lost - right[1].gained) - (left[1].lost - left[1].gained)).slice(0, top)) {
    console.log(`${String(entry.lost).padStart(7)} lost and ${String(entry.gained).padStart(6)} gained in ${String(entry.samples).padStart(5)} samples  ${key}`)
    for (const example of entry.examples) console.log(`            ${example}`)
  }
}
