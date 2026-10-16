// Shows what the bar "cheapest repair" does with a broken text, beside the wanted labels: the five examples of
// examples.ts, or validation samples.
//
//   bun lab/recovery-lr/learn/bars/repair/show.ts [--validation <first sample>] [--count <samples>]
import {defaultSeed, loadSamples} from '../../../dataset.ts'
import {containerLetters, kindLetters} from '../../../labels.ts'
import {type Sample, isScored} from '../../../sample.ts'
import {isTrivia, tables} from '../../../tables.ts'
import {numberOf, optionOf, refuseUnknownOptions} from '../../options.ts'
import {type ParserOutput, addOutputToScore, emptyScore} from '../../score.ts'
import {exampleSamples} from './examples.ts'
import {type RepairRecord, cheapestRepair, editDelete, editInsert, kindOfDroppedToken, standardSettings} from './repair.ts'

// A sample's broken text with a parser's output under it, and under every line of output the wanted label:
//   right      . for a scored code point that is right in all three, X for one that is not, + for an added code
//              point, which has no label, and nothing before the first error
//   kind       one letter per display kind: w white space, c comment, k keyword, n name, d defined name,
//              a parameter, l constant, s string, o operator, p punctuation, E error
//   depth      the last digit
//   container  . none, ( [ l let, = n in, i if, t then, e else, f fun, > ->
//   dropped    d for a token that the parser's stack does not hold
// A line feed is shown as ⏎. A long text is shown in parts of `width` code points.
export function shownSample(sample: Sample, output: ParserOutput, width = 110): string {
  const rows = {text: '', right: '', kind: '', kindWanted: '', depth: '', depthWanted: '', container: '', containerWanted: '', dropped: ''}
  const rowNames: [keyof typeof rows, string][] = [
    ['text', 'text'], ['right', 'right'], ['kind', 'kind'], ['kindWanted', 'kind wanted'], ['depth', 'depth'], ['depthWanted', 'depth wanted'], ['container', 'container'], ['containerWanted', 'container wanted'],
    ['dropped', 'dropped'],
  ]
  for (let token = 0; token < sample.tokens.count; token++) {
    for (let at = sample.tokens.start[token]!; at < sample.tokens.start[token]! + sample.tokens.length[token]!; at++) {
      const codePoint = sample.codePoints[at]!, kept = sample.alignment[at] !== -1
      const right = output.kind[token] === sample.labelKind[at] && output.depth[token] === sample.labelDepth[at] && output.container[token] === sample.labelContainer[at]
      rows.text += codePoint === 10 ? '⏎' : codePoint < 32 ? '·' : String.fromCodePoint(codePoint)
      rows.right += at < sample.firstErrorPosition ? ' ' : !kept ? '+' : right ? '.' : 'X'
      rows.kind += kindLetters[output.kind[token]!]
      rows.kindWanted += kept ? kindLetters[sample.labelKind[at]!] : ' '
      rows.depth += String(output.depth[token]! % 10)
      rows.depthWanted += kept ? String(sample.labelDepth[at]! % 10) : ' '
      rows.container += containerLetters[output.container[token]!]
      rows.containerWanted += kept ? containerLetters[sample.labelContainer[at]!] : ' '
      rows.dropped += !isTrivia(sample.tokens.kind[token]!) && output.taken[token] !== 1 ? 'd' : ' '
    }
  }
  const lines: string[] = []
  for (let from = 0; from < sample.codePoints.length; from += width) {
    for (const [row, name] of rowNames) lines.push(`${name.padEnd(17)}${Array.from(rows[row]).slice(from, from + width).join('')}`.trimEnd())
    if (from + width < sample.codePoints.length) lines.push('')
  }
  const score = emptyScore()
  addOutputToScore(score, sample, output)
  let scored = 0
  for (let at = 0; at < sample.codePoints.length; at++) if (isScored(sample, at)) scored++
  lines.push(`${score.allThreeRight} of ${scored} scored code points right in all three, ${score.stackRight} in the stack; constituents: ${score.sharedConstituents} of the original's ${score.originalConstituents} found, ${score.sharedConstituents} of the parse's ${score.recoveredConstituents} are the original's; ${score.insertedTokens} tokens put in`)
  return lines.join('\n')
}

// What the bar did at every rejected token of a sample, in words.
export function shownRepairs(sample: Sample, records: readonly RepairRecord[]): string {
  const tokenOf: number[] = []
  for (let token = 0; token < sample.tokens.count; token++) if (!isTrivia(sample.tokens.kind[token]!)) tokenOf.push(token)
  const textAt = (position: number): string => {
    const token = tokenOf[position]
    if (token === undefined) return 'the end of the text'
    const start = sample.tokens.start[token]!
    return `\`${String.fromCodePoint(...sample.codePoints.slice(start, start + sample.tokens.length[token]!))}\` at code point ${start}`
  }
  return records.map(record => {
    const what = record.edits === undefined
      ? `the search found nothing: ${record.droppedTokens} tokens dropped, the stack cut by ${record.cutStates} of ${record.states.length} states`
      : record.edits.map(edit => edit.kind === editInsert ? `${tables.symbolNames[edit.terminal]} put in before ${textAt(edit.position)}` : edit.kind === editDelete ? `${textAt(edit.position)} taken out` : `${textAt(edit.position)} read as ${tables.symbolNames[edit.terminal]}`).join(', and ')
    return `rejected: ${textAt(record.errorPosition)}. ${what}`
  }).join('\n')
}

if (import.meta.main) {
  refuseUnknownOptions('show.ts', ['--validation', '--count'])
  const first = optionOf('--validation')
  const samples = first === undefined ? exampleSamples() : loadSamples('validation', defaultSeed, Number(first) + numberOf('--count', 5)).slice(Number(first)).map(sample => ({name: `validation sample ${sample.id}: ${sample.edits.join(', ')}`, sample}))
  for (const {name, sample} of samples) {
    const records: RepairRecord[] = []
    const output = cheapestRepair(sample, kindOfDroppedToken, standardSettings, records)
    console.log(`--- ${name}`)
    console.log(`meant: ${JSON.stringify(sample.original)}`)
    console.log(shownSample(sample, output))
    console.log(shownRepairs(sample, records))
    console.log('')
  }
}
