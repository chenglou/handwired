// Where the hand-written recovery is still wrong: for every sample with a wrong scored code point, the cells that
// the parser read at the first such code point, and what was wrong there. The samples' wrong code points are added
// up per pair of cells, so the top of the list is where reading samples pays most.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/handwritten/where-wrong.ts [--split train] [--kind missingCloser] [--typing]
//       [--top 30] [--examples 1] [--causes] [--cause <text>] [--tables <file.json>] [--scratch <folder>]
// --split is train or validation: this script never reads the test split. --kind counts only the samples that have
// the kind, --typing only the typing replays. --tables reads saved tables in place of the hand-written ones.
// --causes adds a second table: the wrong code points per cause, where the cause of a sample is a guess from its
// first wrong code point and its kinds of damage, see `causes` below. rules-with-structure.md takes its counts from it.
// --cause lists only the samples whose guessed cause has the text in its name, e.g. --cause "another wrong depth".
//
// A line reads e.g. "23304 wrong in 213 samples  depth +1  (between, comma) (commaOrClose, comma, depth 2 to 15,
// object)": in 213 samples the first wrong code point is a comma that the tokenizer read between tokens and the
// grammar after a complete value inside a nested object, the parser's depth there is one more than the label's, and
// these samples have 23,304 wrong code points in all. "kind k->s" means that the label says key and the parser shows
// a string. An example shows the text around the code point, which is between 【 and 】.
import {cacheFolderOf, codePointNestingScored, codePointScored, kindsOf, loadStandardSamples, optionOf, refuseUnknownOptions, sourceNames, splitNames} from '../data.ts'
import {createTrace} from '../recovery-parser.ts'
import {grammarCellName, lexerCellName, loadTablesForReport} from '../recovery-tables.ts'
import {runOnSample, wrongKind, wrongLabelsAt} from '../score.ts'
import {handwrittenTables} from './rules.ts'

const kindLetters = 'wpsenlE.k'

// A guess at why a sample is wrong, from what is wrong at its first wrong code point (e.g. "depth +1" or "kind
// k->s"), the names of the two cells that the parser read there, and the sample's kinds of damage. The first cause
// that fits is taken. The guess is rough: every wrong code point of a sample counts for the cause of its first one.
const causes: readonly (readonly [name: string, fits: (what: string, lexerCell: string, grammarCell: string, kinds: readonly string[]) => boolean])[] = [
  ['a cut line, then a document on the next line', (what, _lexerCell, _grammarCell, kinds) => what.startsWith('depth') && kinds.includes('cutOff') && kinds.includes('newlineDelimited')],
  ['a text that starts inside the document', (_what, _lexerCell, _grammarCell, kinds) => kinds.includes('headMissing')],
  ['color codes of a terminal', (_what, _lexerCell, _grammarCell, kinds) => kinds.includes('ansiColorCodes')],
  ['a no-break space read as a letter', (what, lexerCell, _grammarCell, kinds) => what.startsWith('kind w->') && lexerCell === '(between, other)' && kinds.includes('nonBreakingSpace')],
  ['a word for a literal, shown as a string', what => what === 'kind l->s'],
  ['the first letter of a key without quotes, shown as a literal', what => what === 'kind k->l'],
  ['the next key after a colon without a value, shown as a string', (what, _lexerCell, grammarCell) => what === 'kind k->s' && grammarCell.startsWith('(value, string')],
  ['a colon inside a word', (what, lexerCell) => what === 'kind s->p' && lexerCell === '(errorLine, colon)'],
  ['= or => in the place of a colon', (what, _lexerCell, _grammarCell, kinds) => what.startsWith('kind') && kinds.includes('foreignKeySeparator')],
  ['a word after a complete string, read as the next key', (what, _lexerCell, grammarCell) => what === 'kind s->k' && grammarCell.startsWith('(commaOrClose, string')],
  ['a bracket, a colon or a comma inside a string that is open by mistake', (_what, lexerCell) => /^\((string|escape|hex\d), (closeBrace|closeBracket|openBrace|openBracket|colon|comma)\)$/.test(lexerCell)],
  ['a raw line feed inside a string', (_what, _lexerCell, _grammarCell, kinds) => kinds.includes('rawLineFeedInString')],
  ['a closing bracket that is missing, with no sign of it but the indentation', (what, _lexerCell, _grammarCell, kinds) => what.startsWith('depth +') && kinds.includes('missingCloser')],
  ['a stray closing bracket inside the document', (what, _lexerCell, _grammarCell, kinds) => what.startsWith('depth -') && kinds.includes('strayCloser')],
  ['a brace in the place of the bracket of a nested array', (what, _lexerCell, _grammarCell, kinds) => what.startsWith('depth -') && kinds.includes('wrongCloser')],
  ['another wrong depth', what => what.startsWith('depth')],
  ['another wrong display kind or container', () => true],
]
const visible = (codePoint: number) => codePoint === 0x0a ? '⏎' : codePoint === 0x09 ? '→' : codePoint < 0x20 ? '␦' : String.fromCodePoint(codePoint)

if (import.meta.main) {
  refuseUnknownOptions('handwritten/where-wrong.ts', ['--split', '--kind', '--typing', '--top', '--examples', '--tables', '--cause', '--causes', '--scratch'])
  const split = optionOf('--split') ?? 'train'
  if (split !== 'train' && split !== 'validation') throw new Error(`--split takes train or validation, and got ${split}: this script never reads the test split`)
  const kind = optionOf('--kind')
  const onlyTyping = process.argv.includes('--typing')
  const top = Number(optionOf('--top') ?? 30)
  const exampleCount = Number(optionOf('--examples') ?? 1)
  const tablesFile = optionOf('--tables')
  const onlyCause = optionOf('--cause')
  const tables = tablesFile === undefined ? handwrittenTables().tables : loadTablesForReport(tablesFile).tables
  const samples = loadStandardSamples(cacheFolderOf(optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH']))
  const trace = createTrace()
  const tally = new Map<string, {samples: number, wrong: number, examples: string[]}>()
  const wrongOfCause = causes.map(() => 0)
  const samplesOfCause = causes.map(() => 0)
  let wrongSamples = 0
  let wrongCodePoints = 0
  let scoredCodePoints = 0
  for (let place = 0; place < samples.sampleCount; place++) {
    if (splitNames[samples.split[place]!] !== split || samples.firstDamage[place] === -1) continue
    if (onlyTyping && sourceNames[samples.source[place]!] !== 'typing') continue
    if (kind !== undefined && !kindsOf(samples, place).includes(kind)) continue
    const start = samples.start[place]!
    const length = samples.start[place + 1]! - start
    runOnSample(trace, samples, place, tables)
    let firstWrong = -1
    let wrong = 0
    let what = ''
    for (let position = samples.firstErrorPosition[place]!; position < length; position++) {
      const flags = samples.flags[start + position]!
      if ((flags & codePointScored) === 0) continue
      scoredCodePoints++
      const wrongLabels = wrongLabelsAt(samples, start + position, trace, position)
      if (wrongLabels === 0) continue
      const kindWrong = (wrongLabels & wrongKind) !== 0
      const depthDifference = (flags & codePointNestingScored) === 0 ? 0 : trace.depthAfter[position]! - samples.labelDepth[start + position]!
      wrong++
      if (firstWrong !== -1) continue
      firstWrong = position
      what = depthDifference !== 0 ? `depth ${depthDifference > 0 ? '+' : ''}${depthDifference}`
        : kindWrong ? `kind ${kindLetters[samples.labelKind[start + position]!]}->${kindLetters[trace.displayKind[position]!]}` : 'container'
    }
    if (firstWrong === -1) continue
    wrongSamples++
    wrongCodePoints += wrong
    const lexerCell = lexerCellName(tables, trace.lexerCell[firstWrong]!)
    const grammarCell = grammarCellName(tables, trace.grammarCell[firstWrong]!)
    const sampleKinds = kindsOf(samples, place)
    const cause = causes.findIndex(([, fits]) => fits(what, lexerCell, grammarCell, sampleKinds))
    wrongOfCause[cause]! += wrong
    samplesOfCause[cause]!++
    if (onlyCause !== undefined && !causes[cause]![0].includes(onlyCause)) continue
    const key = `${what}  ${lexerCell} ${grammarCell}`
    const entry = tally.get(key) ?? {samples: 0, wrong: 0, examples: []}
    entry.samples++
    entry.wrong += wrong
    if (entry.examples.length < exampleCount) {
      let text = ''
      for (let position = Math.max(0, firstWrong - 60); position < Math.min(length, firstWrong + 40); position++) {
        const shown = visible(samples.codePoints[start + position]!)
        text += position === firstWrong ? `【${shown}】` : shown
      }
      entry.examples.push(`${samples.index[place]} [${kindsOf(samples, place).join(', ')}] ${text}`)
    }
    tally.set(key, entry)
  }
  console.log(`Split ${split}${kind === undefined ? '' : `, kind ${kind}`}${onlyTyping ? ', typing replays' : ''}: ${wrongCodePoints} of ${scoredCodePoints} scored code points are wrong, in ${wrongSamples} samples.`)
  for (const [key, entry] of [...tally].sort((left, right) => right[1].wrong - left[1].wrong).slice(0, top)) {
    console.log(`${String(entry.wrong).padStart(7)} wrong in ${String(entry.samples).padStart(5)} samples  ${key}`)
    for (const example of entry.examples) console.log(`            ${example}`)
  }
  if (process.argv.includes('--causes')) {
    console.log('')
    console.log('Wrong code points per guessed cause, with their share of all wrong code points and of all scored code points:')
    causes.forEach(([name], index) => {
      console.log(`${String(wrongOfCause[index]).padStart(7)} wrong in ${String(samplesOfCause[index]).padStart(5)} samples  ${(100 * wrongOfCause[index]! / wrongCodePoints).toFixed(1).padStart(5)}%  ${(100 * wrongOfCause[index]! / scoredCodePoints).toFixed(2).padStart(5)}%  ${name}`)
    })
  }
}
