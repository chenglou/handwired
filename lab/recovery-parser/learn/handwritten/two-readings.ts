// Counts for the cells that have two sensible readings: for each such cell, what the labels say at the code points
// that read it. README.md quotes these counts under "Where two readings contradict".
//
// Run from the repo root: bun lab/recovery-parser/learn/handwritten/two-readings.ts [--scratch <folder>]
//
// The script runs the hand-written tables on the broken samples of the train split, and looks at the first code
// point of each sample that reads a cell of a group below. Per cell it counts the samples by what that code point is:
// - "added": the damage added the code point, e.g. a brace inside a comment. It has no label.
// - "not punctuation in the original": the code point is kept and its label's display kind is no punctuation, e.g.
//   the brace of '${file}', which is string content in the original.
// - "the original's depth is +1, 0, -1, ... from the depth before": the code point is kept punctuation, and the
//   number says what one step would have to do to the parser's depth before it to get the depth after the code
//   point's counterpart in the original: +1 is a push, 0 leaves the stack, -1 is a pop, and -2 are two pops, which
//   one step cannot do. The original's depth is there at every kept code point, also where the label's is not scored.
// - For a string: whether its label is a key or a string.
// - "the display kind is not scored": the dataset asks no parser for a display kind there.
//
// A count says what the labels want at one cell, not what a choice is worth: a choice also changes what the parser
// reads afterwards, and an added code point has no label but still moves the parser. E.g. a comma inside a comment
// is added, so it is in no "the label's depth" row, yet a pop at that comma is wrong. Where two readings are close,
// the train score decides, and README.md says so.
import {cacheFolderOf, codePointKept, codePointKindScored, loadStandardSamples, optionOf, refuseUnknownOptions, splitNames} from '../data.ts'
import {displayKind} from '../../labels.ts'
import {createTrace} from '../recovery-parser.ts'
import {grammarCellName} from '../recovery-tables.ts'
import {runOnSample} from '../score.ts'
import {handwrittenTables} from './rules.ts'

const groups: readonly {title: string, cells: RegExp}[] = [
  {title: 'A string after a key: the next key (a key without a colon), or the key\'s value (a missing colon)', cells: /^\(colon, string, .*object\)$/},
  {title: 'A closing bracket of the other kind inside a nested container', cells: /^\(\w+, (closeArray, depth (2 to 15|16), object|closeObject, depth (2 to 15|16), array)\)$/},
  {title: 'The comma after a closing bracket of the other kind: the grammar states `error` and `end` inside a container', cells: /^\((error|end), comma, depth (1|2 to 15|16), (object|array)\)$/},
  {title: 'A colon after a value inside an array', cells: /^\(commaOrClose, colon, .*array\)$/},
  {title: 'An opening brace after a complete value inside an object', cells: /^\(commaOrClose, openObject, .*object\)$/},
  {title: 'An opening brace where a key may come, or after a key', cells: /^\((key|keyOrClose|colon), openObject, .*object\)$/},
]

if (import.meta.main) {
  refuseUnknownOptions('handwritten/two-readings.ts', ['--scratch'])
  const {tables} = handwrittenTables()
  const samples = loadStandardSamples(cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH']))
  const trace = createTrace()
  // The group of every grammar cell, or -1.
  const groupOfCell = Int8Array.from({length: tables.grammarNext.length}, (_, cell) => groups.findIndex(group => group.cells.test(grammarCellName(tables, cell))))
  const tallies = groups.map(() => new Map<string, Map<string, number>>())
  let brokenSamples = 0
  for (let place = 0; place < samples.sampleCount; place++) {
    if (splitNames[samples.split[place]!] !== 'train' || samples.firstDamage[place] === -1) continue
    brokenSamples++
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    runOnSample(trace, samples, place, tables)
    const seen = new Set<number>()
    for (let position = 0; position < length; position++) {
      const cell = trace.grammarCell[position]!
      const group = groupOfCell[cell]!
      if (group === -1 || seen.has(group)) continue
      seen.add(group)
      const at = start + position
      const depthBefore = position === 0 ? 0 : trace.depthAfter[position - 1]!
      const labelKind = samples.labelKind[at]!
      let what: string
      if ((samples.flags[at]! & codePointKept) === 0) what = 'added'
      else if ((samples.flags[at]! & codePointKindScored) === 0) what = 'the display kind is not scored'
      else if (group === 0) what = labelKind === displayKind.key ? 'the label is a key' : labelKind === displayKind.string ? 'the label is a string' : 'the label is something else'
      else if (labelKind !== displayKind.punctuation) what = 'not punctuation in the original'
      else {
        const change = samples.intendedDepthAfter[at]! - depthBefore
        what = `the original's depth is ${change > 0 ? '+' : ''}${change <= -2 ? '-2 or lower' : change} from the depth before`
      }
      const name = grammarCellName(tables, cell)
      const ofCell = tallies[group]!.get(name) ?? new Map<string, number>()
      tallies[group]!.set(name, ofCell)
      ofCell.set(what, (ofCell.get(what) ?? 0) + 1)
    }
  }
  console.log(`The hand-written tables on the ${brokenSamples} broken samples of the train split. Per cell: the samples whose first read of a cell of the group is that cell, by what the labels say there.`)
  groups.forEach((group, index) => {
    console.log('')
    console.log(group.title)
    for (const [name, ofCell] of [...tallies[index]!].sort((left, right) => left[0].localeCompare(right[0]))) {
      const total = [...ofCell.values()].reduce((sum, count) => sum + count, 0)
      console.log(`  ${name}: ${total} samples`)
      for (const [what, count] of [...ofCell].sort((left, right) => left[0].localeCompare(right[0]))) console.log(`    ${String(count).padStart(6)}  ${what}`)
    }
  })
}
