// What the labels want at the cells and the display entries that the hand-written tables read, on the train split.
// A person who writes a rule reads these counts where a cell has two sensible readings.
//
// Run from the repo root:
//   bun lab/recovery-toml/learn/handwritten/wants.ts --display [--set mixed] [--top 40] [--all]
//   bun lab/recovery-toml/learn/handwritten/wants.ts --grammar "(afterValue, keyOnly, depth 0)" [--set mixed] [--examples 3]
//   bun lab/recovery-toml/learn/handwritten/wants.ts --lexer "(between, slash)" [--set mixed] [--examples 3]
//   [--source kinds] [--tables <file.json>] [--scratch <folder>]
//
// --display lists the open display entries: per entry, how many scored code points of each label's kind read it, of
// the code points whose depth and container are right or not scored. Without --all, only the entries where the
// kind that the tables show is not the one that the most code points want.
// --grammar and --lexer take the name of a cell, or a part of it: the list then has, per cell whose name holds the
// text, what the original has at the code points that read it at or after the first error: for a grammar cell the
// grammar state after the counterpart and how the depth of the label differs from the parser's depth before the code
// point, and for a tokenizer cell the tokenizer state after the counterpart and its event. "added" is a code point
// that the damage added. The counts say what the original wants at one cell, not what a choice is worth: a choice also
// changes what the parser reads afterwards.
import {kindLetters} from '../../kinds.ts'
import {codePointKept, codePointKindScored, codePointNestingScored, kindsOf, splitNames} from '../data.ts'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {createTrace} from '../recovery-parser.ts'
import {displayChoiceName, displayEntryName, displayEntryOf, displayKindCount, displayKindNames, eventNames, grammarCellName, grammarChoiceName, grammarStateNames, lexerCellName, lexerChoiceName, lexerStateNames, loadTablesForReport} from '../recovery-tables.ts'
import {runOnSample} from '../score.ts'
import {handwrittenTables} from './rules.ts'
import {type SetName, loadSet, scratchFolderOf, setNames} from './sets.ts'
import {visible} from './where-wrong.ts'

if (import.meta.main) {
  refuseUnknownOptions('handwritten/wants.ts', ['--set', '--display', '--grammar', '--lexer', '--top', '--all', '--examples', '--source', '--tables', '--scratch'])
  const setName = (optionOf('--set') ?? 'mixed') as SetName
  if (!setNames.includes(setName)) throw new Error(`--set takes neutral or mixed, and got ${setName}`)
  const tablesFile = optionOf('--tables')
  const tables = tablesFile === undefined ? handwrittenTables().tables : loadTablesForReport(tablesFile).tables
  const samples = loadSet(setName, scratchFolderOf(optionOf('--scratch')))
  const source = optionOf('--source')
  const top = Number(optionOf('--top') ?? 40)
  const exampleCount = Number(optionOf('--examples') ?? 2)
  const grammarText = optionOf('--grammar')
  const lexerText = optionOf('--lexer')
  const trace = createTrace()
  const train = splitNames.indexOf('train')
  const wantedKinds = new Int32Array(tables.display.length * displayKindCount)
  const cells = new Map<string, {holds: string, reads: number, samples: number, outcomes: Map<string, number>, examples: string[]}>()
  for (let place = 0; place < samples.sampleCount; place++) {
    if (samples.split[place] !== train || samples.firstDamage[place] === -1 || samples.firstErrorPosition[place] === -1) continue
    if (source !== undefined && samples.sourceNames[samples.source[place]!] !== source) continue
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    runOnSample(trace, samples, place, tables)
    const seen = new Set<string>()
    for (let position = samples.firstErrorPosition[place]!; position < length; position++) {
      const at = start + position
      const flags = samples.flags[at]!
      const nestingRight = (flags & codePointNestingScored) === 0 || (trace.depthAfter[position] === samples.labelDepth[at] && trace.containerAfter[position] === samples.labelContainer[at])
      if ((flags & codePointKindScored) !== 0 && nestingRight) wantedKinds[displayEntryOf(tables, trace.event[position]!, trace.grammarAfter[position]!) * displayKindCount + samples.labelKind[at]!]!++
      const isGrammar = grammarText !== undefined
      if (!isGrammar && lexerText === undefined) continue
      const name = isGrammar ? grammarCellName(tables, trace.grammarCell[position]!) : lexerCellName(tables, trace.lexerCell[position]!)
      if (!name.includes(isGrammar ? grammarText : lexerText!)) continue
      const holds = isGrammar ? grammarChoiceName(tables, trace.grammarCell[position]!) : lexerChoiceName(tables, trace.lexerCell[position]!)
      const entry = cells.get(name) ?? {holds, reads: 0, samples: 0, outcomes: new Map<string, number>(), examples: []}
      cells.set(name, entry)
      entry.reads++
      let outcome = 'added'
      if ((flags & codePointKept) !== 0) {
        if (isGrammar) {
          const depthBefore = position === 0 ? 0 : trace.depthAfter[position - 1]!
          const difference = samples.intendedDepthAfter[at]! - depthBefore
          outcome = `${grammarStateNames[samples.intendedGrammarAfter[at]!]}, depth ${difference > 0 ? '+' : ''}${difference}, shown as ${displayKindNames[samples.labelKind[at]!] ?? 'not scored'}`
        } else {
          outcome = `${lexerStateNames[samples.intendedLexerAfter[at]!]}, ${eventNames[samples.intendedEvent[at]!]}`
        }
      }
      entry.outcomes.set(outcome, (entry.outcomes.get(outcome) ?? 0) + 1)
      if (!seen.has(name)) {
        seen.add(name)
        entry.samples++
        if (entry.examples.length < exampleCount) {
          let text = ''
          for (let other = Math.max(0, position - 50); other < Math.min(length, position + 30); other++) {
            const shown = visible(samples.codePoints[start + other]!)
            text += other === position ? `【${shown}】` : shown
          }
          entry.examples.push(`${samples.index[place]} [${kindsOf(samples, place).join(', ')}] ${text}`)
        }
      }
    }
  }
  if (process.argv.includes('--display')) {
    const lines: {gain: number, text: string}[] = []
    for (let entry = 0; entry < tables.display.length; entry++) {
      if (tables.displayOpen[entry] !== 1) continue
      const counts = Array.from({length: displayKindCount}, (_, kind) => wantedKinds[entry * displayKindCount + kind]!)
      const total = counts.reduce((sum, count) => sum + count, 0)
      if (total === 0) continue
      const best = counts.indexOf(Math.max(...counts))
      const shown = tables.display[entry]!
      if (best === shown && !process.argv.includes('--all')) continue
      const parts = counts.map((count, kind) => ({count, kind})).filter(part => part.count > 0).sort((left, right) => right.count - left.count).map(part => `${kindLetters[part.kind]} ${part.count}`)
      lines.push({gain: counts[best]! - counts[shown]!, text: `${String(counts[best]! - counts[shown]!).padStart(7)}  ${displayEntryName(tables, entry).padEnd(46)} shows ${displayChoiceName(tables, entry).padEnd(11)} wanted: ${parts.join(', ')}`})
    }
    console.log(`Set ${setName}, train split. Per open display entry: what the most code points want more than what is shown, the entry, what it shows, and the labels' kinds of the code points that read it.`)
    for (const line of lines.sort((left, right) => right.gain - left.gain).slice(0, top)) console.log(line.text)
  }
  for (const [name, entry] of [...cells].sort((left, right) => right[1].reads - left[1].reads).slice(0, top)) {
    console.log(`${name} holds ${entry.holds}: read ${entry.reads} times in ${entry.samples} samples`)
    for (const [outcome, count] of [...entry.outcomes].sort((left, right) => right[1] - left[1]).slice(0, 8)) console.log(`${String(count).padStart(9)}  ${outcome}`)
    for (const example of entry.examples) console.log(`           ${example}`)
  }
}
