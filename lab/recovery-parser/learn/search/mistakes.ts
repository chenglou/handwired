// Shows where tables are still wrong on the validation split, for reading: counts of the wrong labels, and samples
// in fixed width, so that every code point of a broken text stands above its label and above what the tables show.
//
// Run from the repo root:
//   bun lab/recovery-parser/learn/search/mistakes.ts --tables <tables.json> [--count 30] [--pick 1] [--kind missingComma] [--scratch <folder>]
// --count  how many samples to print, drawn without order from the samples with one wrong code point or more.
// --pick   another number draws other samples.
// --kind   only samples with this kind of damage.
//
// The lines of a sample:
//   brok   the broken text. A line feed is ⏎, a tab is →, and any other code point outside printable ASCII is ¤.
//   want   the label's display kind, one letter each, see kindLetters in labels.ts. Blank where the damage added the
//          code point, and ? where the display kind is not scored.
//   got    the display kind that the tables give.
//   wantd, gotd  the depth after the code point, 0 to 9 and then a to g, - below 0 and + above 16. wantd has a ? where
//          the depth and the container are not scored.
//   wantc, gotc  the innermost open container after the code point: o for an object, a for an array, - for none.
//   miss   from the first error on, where a score counts: k where the display kind is wrong, d the depth, c the
//          container, * more than one.
import {kindLetters} from '../../labels.ts'
import {createRandom} from '../../random.ts'
import {cacheFolderOf, codePointKept, codePointKindScored, codePointNestingScored, codePointScored, groupNames, kindsOf, loadStandardSamples, optionOf, refuseUnknownOptions, validationPart} from '../data.ts'
import {createTrace} from '../recovery-parser.ts'
import {asIsTables, checkTables, loadTablesForReport} from '../recovery-tables.ts'
import {runOnSample, wrongContainer, wrongDepth, wrongKind, wrongLabelsAt} from '../score.ts'

// The command shows the validation split and has no --split: an option that it does not have is an error.
refuseUnknownOptions('search/mistakes.ts', ['--tables', '--count', '--pick', '--kind', '--scratch'])
const scratchFolder = optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH']
const tablesFile = optionOf('--tables')
const count = Number(optionOf('--count') ?? 30)
const pick = Number(optionOf('--pick') ?? 1)
const onlyKind = optionOf('--kind')
const tables = tablesFile === undefined ? asIsTables() : loadTablesForReport(tablesFile).tables
checkTables(tables)
const samples = validationPart(loadStandardSamples(cacheFolderOf(scratchFolder)))
const trace = createTrace()

const depthLetter = (depth: number) => depth < 0 ? '-' : depth > 16 ? '+' : '0123456789abcdefg'[depth]!
const containerLetter = (container: number) => '-oa'[container] ?? '?'
const shown = (codePoint: number) => codePoint === 10 ? '⏎' : codePoint === 9 ? '→' : codePoint < 0x20 || codePoint > 0x7e ? '¤' : String.fromCodePoint(codePoint)

// Which labels are wrong at the code points that are scored, and which display kind stands for which.
const wrongLabels = new Map<string, number>()
const wrongKinds = new Map<string, number>()
const add = (counts: Map<string, number>, name: string) => counts.set(name, (counts.get(name) ?? 0) + 1)
let scored = 0
let wrong = 0
const wrongPlaces: number[] = []
for (let place = 0; place < samples.sampleCount; place++) {
  if (samples.firstDamage[place] === -1) continue
  const start = samples.start[place]!
  const length = samples.start[place + 1]! - start
  runOnSample(trace, samples, place, tables)
  let wrongHere = 0
  for (let position = samples.firstErrorPosition[place]!; position < length; position++) {
    if ((samples.flags[start + position]! & codePointScored) === 0) continue
    scored++
    const wrongLabelsHere = wrongLabelsAt(samples, start + position, trace, position)
    if (wrongLabelsHere === 0) continue
    wrong++
    wrongHere++
    add(wrongLabels, [(wrongLabelsHere & wrongKind) !== 0 ? 'kind' : '', (wrongLabelsHere & wrongDepth) !== 0 ? 'depth' : '', (wrongLabelsHere & wrongContainer) !== 0 ? 'container' : ''].filter(name => name !== '').join(' and '))
    if ((wrongLabelsHere & wrongKind) !== 0) add(wrongKinds, `${kindLetters[samples.labelKind[start + position]!]} shown as ${kindLetters[trace.displayKind[position]!]}`)
  }
  if (wrongHere > 0 && (onlyKind === undefined || kindsOf(samples, place).includes(onlyKind))) wrongPlaces.push(place)
}
const sorted = (counts: Map<string, number>) => [...counts].sort((left, right) => right[1] - left[1])
console.log(`Tables: ${tablesFile ?? 'today\'s'}. Validation split: ${scored} scored code points, ${wrong} of them wrong (${(100 * wrong / scored).toFixed(2)}%).`)
console.log(`Which labels are wrong, in % of the wrong code points: ${sorted(wrongLabels).map(([name, value]) => `${name} ${(100 * value / wrong).toFixed(1)}`).join(', ')}`)
console.log(`Display kinds (${kindLetters}: whitespace, punctuation, string, escape, number, literal, Error, past the end, key), in % of the wrong code points: ${sorted(wrongKinds).slice(0, 12).map(([name, value]) => `${name} ${(100 * value / wrong).toFixed(1)}`).join(', ')}`)
console.log(`${wrongPlaces.length} samples${onlyKind === undefined ? '' : ` with the kind ${onlyKind}`} have a wrong code point. ${Math.min(count, wrongPlaces.length)} of them:`)

const random = createRandom(20261015, pick)
for (let drawn = 0; drawn < count && wrongPlaces.length > 0; drawn++) {
  const place = wrongPlaces.splice(random.integer(0, wrongPlaces.length - 1), 1)[0]!
  const firstDamage = samples.firstDamage[place]!
  const firstError = samples.firstErrorPosition[place]!
  const start = samples.start[place]!
  const length = samples.start[place + 1]! - start
  runOnSample(trace, samples, place, tables)
  const line = (letter: (position: number, at: number) => string) => Array.from({length}, (_, position) => letter(position, start + position)).join('')
  const kept = (at: number) => (samples.flags[at]! & codePointKept) !== 0
  const nestingScored = (at: number) => (samples.flags[at]! & codePointNestingScored) !== 0
  const miss = line((position, at) => {
    if (position < firstError) return ' '
    const wrongLabelsHere = wrongLabelsAt(samples, at, trace, position)
    return wrongLabelsHere === 0 ? ' ' : wrongLabelsHere === wrongKind ? 'k' : wrongLabelsHere === wrongDepth ? 'd' : wrongLabelsHere === wrongContainer ? 'c' : '*'
  })
  const wrongHere = Array.from(miss).filter(letter => letter !== ' ').length
  console.log('')
  console.log(`--- sample ${samples.index[place]}  kinds: ${kindsOf(samples, place).join(', ')}  group: ${groupNames[samples.group[place]!]}${samples.debatable[place] === 1 ? '  debatable' : ''}  first damage at ${firstDamage}, first error at ${firstError}, ${wrongHere} wrong code points`)
  console.log(`brok  ${line((_, at) => shown(samples.codePoints[at]!))}`)
  console.log(`want  ${line((_, at) => !kept(at) ? ' ' : (samples.flags[at]! & codePointKindScored) === 0 ? '?' : kindLetters[samples.labelKind[at]!]!)}`)
  console.log(`got   ${line(position => kindLetters[trace.displayKind[position]!]!)}`)
  console.log(`wantd ${line((_, at) => !kept(at) ? ' ' : nestingScored(at) ? depthLetter(samples.labelDepth[at]!) : '?')}`)
  console.log(`gotd  ${line(position => depthLetter(trace.depthAfter[position]!))}`)
  console.log(`wantc ${line((_, at) => !kept(at) ? ' ' : nestingScored(at) ? containerLetter(samples.labelContainer[at]!) : '?')}`)
  console.log(`gotc  ${line(position => containerLetter(trace.containerAfter[position]!))}`)
  console.log(`miss  ${miss}`)
}
