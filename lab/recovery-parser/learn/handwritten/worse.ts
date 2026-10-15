// Where the hand-written recovery is worse than the parser as it is: the scored code points that today's tables get
// right and the hand-written tables get wrong, per sample.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/handwritten/worse.ts [--split train] [--top 12] [--tables <file.json>] [--scratch <folder>]
// --split is train or validation: this script never reads the test split. --tables reads saved tables in place of
// the hand-written ones.
//
// It prints how many samples lose a code point, how many lose more than they gain, and the code points lost and
// gained in all. Then the lost code points by the two cells that the hand-written parser read at a sample's first
// lost code point, with one example each, where the code point is between 【 and 】. A cell at the top of that list
// is a rule that is too greedy for some texts.
import {cacheFolderOf, codePointScored, kindsOf, loadStandardSamples, optionOf, refuseUnknownOptions, splitNames} from '../data.ts'
import {createTrace} from '../recovery-parser.ts'
import {asIsTables, grammarCellName, lexerCellName, loadTablesForReport} from '../recovery-tables.ts'
import {runOnSample, wrongLabelsAt} from '../score.ts'
import {handwrittenTables} from './rules.ts'

const visible = (codePoint: number) => codePoint === 0x0a ? '⏎' : codePoint === 0x09 ? '→' : codePoint < 0x20 ? '␦' : String.fromCodePoint(codePoint)

if (import.meta.main) {
  refuseUnknownOptions('handwritten/worse.ts', ['--split', '--top', '--tables', '--scratch'])
  const split = optionOf('--split') ?? 'train'
  if (split !== 'train' && split !== 'validation') throw new Error(`--split takes train or validation, and got ${split}: this script never reads the test split`)
  const top = Number(optionOf('--top') ?? 12)
  const tablesFile = optionOf('--tables')
  const tables = tablesFile === undefined ? handwrittenTables().tables : loadTablesForReport(tablesFile).tables
  const asIs = asIsTables()
  const samples = loadStandardSamples(cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH']))
  const trace = createTrace()
  const traceAsIs = createTrace()
  const byCells = new Map<string, {samples: number, lost: number, example: string}>()
  const tally = {samples: 0, samplesThatLose: 0, samplesThatLoseMore: 0, lost: 0, gained: 0}
  for (let place = 0; place < samples.sampleCount; place++) {
    if (splitNames[samples.split[place]!] !== split || samples.firstDamage[place] === -1) continue
    tally.samples++
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    runOnSample(trace, samples, place, tables)
    runOnSample(traceAsIs, samples, place, asIs)
    let firstLost = -1
    let lost = 0
    let gained = 0
    for (let position = samples.firstErrorPosition[place]!; position < length; position++) {
      if ((samples.flags[start + position]! & codePointScored) === 0) continue
      const before = wrongLabelsAt(samples, start + position, traceAsIs, position) === 0
      const after = wrongLabelsAt(samples, start + position, trace, position) === 0
      if (before && !after) {
        lost++
        if (firstLost === -1) firstLost = position
      } else if (!before && after) {
        gained++
      }
    }
    tally.lost += lost
    tally.gained += gained
    if (lost === 0) continue
    tally.samplesThatLose++
    if (lost > gained) tally.samplesThatLoseMore++
    const key = `${lexerCellName(tables, trace.lexerCell[firstLost]!)} ${grammarCellName(tables, trace.grammarCell[firstLost]!)}`
    const entry = byCells.get(key) ?? {samples: 0, lost: 0, example: ''}
    byCells.set(key, entry)
    entry.samples++
    entry.lost += lost
    if (entry.example === '') {
      let text = ''
      for (let position = Math.max(0, firstLost - 60); position < Math.min(length, firstLost + 40); position++) {
        const shown = visible(samples.codePoints[start + position]!)
        text += position === firstLost ? `【${shown}】` : shown
      }
      entry.example = `${samples.index[place]} [${kindsOf(samples, place).join(', ')}] ${text}`
    }
  }
  console.log(`Split ${split}, ${tally.samples} broken samples: ${tally.samplesThatLose} lose a code point that the parser as it is gets right, and ${tally.samplesThatLoseMore} of them lose more than they gain. ${tally.lost} code points lost, ${tally.gained} gained.`)
  for (const [key, entry] of [...byCells].sort((left, right) => right[1].lost - left[1].lost).slice(0, top)) {
    console.log(`${String(entry.lost).padStart(7)} lost in ${String(entry.samples).padStart(5)} samples  ${key}`)
    console.log(`            ${entry.example}`)
  }
}
