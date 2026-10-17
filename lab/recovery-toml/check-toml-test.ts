// Runs the table parser and the reference labeler on the official test suite of TOML, toml-test
// (github.com/toml-lang/toml-test), with its list of cases for TOML 1.0: tests/files-toml-1.0.0.
//
// - Every valid case has to be accepted by the tables and by the reference, with the same labels at every code point.
// - Every invalid case has to be rejected by both, or be on the list below, which names for each such case what the
//   tables do not check. The README has the same list of what is out of scope.
//
// A case of more than 512 code points is run with room for the whole file, see runTableParserOnCodePoints: the suite
// tests the syntax, and the limit of 512 code points is the experiment's own.
//
// The suite is not part of the repo. Clone it, e.g. into a scratch folder, and give its path:
//   git clone --depth 1 https://github.com/toml-lang/toml-test.git <folder>
//   bun lab/recovery-toml/check-toml-test.ts <folder>
// The counts in the README are those of the suite's commit ff49d109861c1ad25af53f687f2aef19ab650600.
import {existsSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {capacity} from './kinds.ts'
import {labelReference} from './reference.ts'
import {runTableParserOnCodePoints} from './table-parser.ts'

// The invalid cases that the tables accept, by what the tables do not check. A name stands for the file
// tests/invalid/<name>.toml.
const outOfScope: {reason: string, cases: readonly string[]}[] = [
  // The tables keep no names, so they cannot know that a key or a table was defined before, e.g. `a = 1` twice, `[a]`
  // twice, or `a.b = 2` after the inline table `a = {b = 1}`.
  {reason: 'a key or a table is defined twice, or a table is added to where it may not be', cases: [
    'array/extend-defined-aot', 'array/extending-table', 'array/tables-01', 'array/tables-02',
    'inline-table/duplicate-key-01', 'inline-table/duplicate-key-02', 'inline-table/duplicate-key-03',
    'inline-table/duplicate-key-04', 'inline-table/overwrite-01', 'inline-table/overwrite-02',
    'inline-table/overwrite-03', 'inline-table/overwrite-04', 'inline-table/overwrite-05', 'inline-table/overwrite-06',
    'inline-table/overwrite-07', 'inline-table/overwrite-08', 'inline-table/overwrite-09', 'inline-table/overwrite-10',
    'key/dotted-redefine-table-01', 'key/dotted-redefine-table-02', 'key/duplicate-keys-01', 'key/duplicate-keys-02',
    'key/duplicate-keys-03', 'key/duplicate-keys-04', 'key/duplicate-keys-05', 'key/duplicate-keys-06',
    'key/duplicate-keys-07', 'key/duplicate-keys-08', 'key/duplicate-keys-09', 'spec-1.0.0/inline-table-2-0',
    'spec-1.0.0/inline-table-3-0', 'spec-1.0.0/table-9-0', 'spec-1.0.0/table-9-1', 'table/append-with-dotted-keys-01',
    'table/append-with-dotted-keys-02', 'table/append-with-dotted-keys-03', 'table/append-with-dotted-keys-04',
    'table/append-with-dotted-keys-05', 'table/append-with-dotted-keys-06', 'table/append-with-dotted-keys-07',
    'table/append-with-dotted-keys-08', 'table/array-implicit', 'table/duplicate-key-01', 'table/duplicate-key-02',
    'table/duplicate-key-03', 'table/duplicate-key-04', 'table/duplicate-key-05', 'table/duplicate-key-06',
    'table/duplicate-key-07', 'table/duplicate-key-08', 'table/duplicate-key-09', 'table/duplicate-key-10',
    'table/duplicate-key-11', 'table/duplicate-key-12', 'table/duplicate-key-13', 'table/duplicate-key-14',
    'table/overwrite-array-in-parent', 'table/overwrite-bool-with-array', 'table/overwrite-with-deep-table',
    'table/redefine-01', 'table/redefine-02', 'table/redefine-03', 'table/super-twice',
  ]},
  // The tables read the form of a date and of a time, e.g. two digits for the month, and not the number, e.g. 13.
  {reason: 'a number inside a date or a time is out of its range', cases: [
    'datetime/day-zero', 'datetime/feb-29', 'datetime/feb-30', 'datetime/hour-over', 'datetime/mday-over',
    'datetime/mday-under', 'datetime/minute-over', 'datetime/month-over', 'datetime/month-under',
    'datetime/offset-overflow-hour', 'datetime/offset-overflow-minute', 'datetime/second-over', 'local-date/feb-29',
    'local-date/feb-30', 'local-date/mday-over', 'local-date/mday-under', 'local-date/month-over',
    'local-date/month-under', 'local-datetime/feb-29', 'local-datetime/feb-30', 'local-datetime/hour-over',
    'local-datetime/mday-over', 'local-datetime/mday-under', 'local-datetime/minute-over', 'local-datetime/month-over',
    'local-datetime/month-under', 'local-datetime/second-over', 'local-time/hour-over', 'local-time/minute-over',
    'local-time/second-over',
  ]},
  // The tables read the form of an escape, e.g. 4 hex digits after \u, and not the code point, e.g. the surrogate D801.
  {reason: 'an escape names a surrogate or a code point past U+10FFFF', cases: [
    'string/bad-uni-esc-06', 'string/bad-uni-esc-ml-06', 'string/basic-multiline-out-of-range-unicode-escape-01',
    'string/basic-multiline-out-of-range-unicode-escape-02', 'string/basic-out-of-range-unicode-escape-01',
    'string/basic-out-of-range-unicode-escape-02',
  ]},
]

// The first difference between the tables and the reference on a text of any length, or null.
function differenceOf(text: string): {tablesValid: boolean, referenceValid: boolean, difference: string | null} {
  const codePoints = Array.from(text, character => character.codePointAt(0)!)
  const trace = runTableParserOnCodePoints(codePoints, false, undefined, Math.max(capacity, codePoints.length))
  const reference = labelReference(text, {withoutLimits: true})
  let difference: string | null = null
  if (trace.valid !== reference.valid) {
    difference = `valid: tables ${trace.valid}${trace.valid ? '' : ` (first error at ${trace.firstErrorPosition})`}, reference ${reference.valid}${reference.valid ? '' : ` (${reference.reason})`}`
  } else if (reference.valid) {
    for (const [position, label] of reference.labels.entries()) {
      if (trace.displayKind[position] !== label.kind || trace.depthAfter[position] !== label.depth || trace.containerAfter[position] !== label.container) {
        difference = `the labels differ at ${position}`
        break
      }
    }
  }
  return {tablesValid: trace.valid, referenceValid: reference.valid, difference}
}

if (import.meta.main) {
  const folder = process.argv[2]
  if (folder === undefined || !existsSync(join(folder, 'tests/files-toml-1.0.0'))) {
    console.log('Give the folder of a clone of github.com/toml-lang/toml-test: bun lab/recovery-toml/check-toml-test.ts <folder>')
    process.exit(1)
  }
  const files = readFileSync(join(folder, 'tests/files-toml-1.0.0'), 'utf8').split('\n').filter(line => line.endsWith('.toml'))
  const reasonOfCase = new Map<string, string>()
  for (const {reason, cases} of outOfScope) for (const name of cases) reasonOfCase.set(`invalid/${name}.toml`, reason)
  const failures: string[] = []
  const fail = (what: string) => {
    failures.push(what)
    console.log(`FAILED: ${what}`)
  }
  let validCases = 0
  let validAccepted = 0
  let validLong = 0
  let invalidCases = 0
  let rejected = 0
  let notUtf8 = 0
  const acceptedByReason = new Map<string, number>()
  const listedAndSeen = new Set<string>()
  for (const file of files) {
    const bytes = readFileSync(join(folder, 'tests', file))
    let text: string
    try {
      text = new TextDecoder('utf-8', {fatal: true}).decode(bytes)
    } catch {
      // The parser reads code points. A file that is no UTF-8 has none to read, and every such case is an invalid one.
      if (file.startsWith('valid/')) fail(`${file} is a valid case and no UTF-8`)
      invalidCases++
      notUtf8++
      continue
    }
    const {tablesValid, referenceValid, difference} = differenceOf(text)
    if (difference !== null) fail(`${file}: ${difference}`)
    if (file.startsWith('valid/')) {
      validCases++
      if (Array.from(text).length > capacity) validLong++
      if (tablesValid && referenceValid && difference === null) validAccepted++
      else fail(`${file} is a valid case, and the tables ${tablesValid ? 'accept' : 'reject'} it and the reference ${referenceValid ? 'accepts' : 'rejects'} it`)
      continue
    }
    invalidCases++
    const reason = reasonOfCase.get(file)
    if (!tablesValid) {
      rejected++
      if (reason !== undefined) fail(`${file} is on the list of what is out of scope, and the tables reject it`)
      continue
    }
    if (reason === undefined) {
      fail(`${file} is an invalid case that the tables accept, and it is not on the list: ${JSON.stringify(text.length > 200 ? `${text.slice(0, 200)}…` : text)}`)
      continue
    }
    listedAndSeen.add(file)
    acceptedByReason.set(reason, (acceptedByReason.get(reason) ?? 0) + 1)
  }
  for (const name of reasonOfCase.keys()) if (!listedAndSeen.has(name) && !failures.some(failure => failure.startsWith(name))) fail(`${name} is on the list and not among the suite's invalid cases`)
  console.log(`${validCases} valid cases: the tables and the reference accept ${validAccepted === validCases ? 'every one' : validAccepted}, with the same labels at every code point. ${validLong} of them have more than ${capacity} code points and are run with room for the whole file.`)
  console.log(`${invalidCases} invalid cases: the tables and the reference reject ${rejected}, ${notUtf8} are no UTF-8 and so no text for the parser, and the tables accept ${invalidCases - rejected - notUtf8}, each for a reason that is out of scope:`)
  for (const [reason, count] of acceptedByReason) console.log(`  ${count} ${reason}`)
  console.log(failures.length === 0 ? 'every check passed' : `${failures.length} failures`)
  if (failures.length > 0) process.exitCode = 1
}
