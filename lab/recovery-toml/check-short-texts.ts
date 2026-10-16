// Every short text over a few small alphabets: the table parser, the reference labeler and Bun's TOML parser have to
// agree on each one. A family of texts is a start, every string of up to some length over an alphabet, and an end, e.g.
// `a=` and every string of up to 5 of the characters `0 1 9 _ . e + - x b :` and space. A random text rarely holds
// e.g. `1.e_`, and a family holds every such neighbor of a valid number, so the check finds a cell that accepts too
// much or too little wherever a short text shows it.
//
// For every text: the tables and the reference agree on valid or invalid, and on the labels of a valid text. Bun
// agrees too, or the difference has one of the reasons of check-table-parser.ts, e.g. a key that is defined twice.
//
// Run from the repo root: bun lab/recovery-toml/check-short-texts.ts [shorter]
// It runs 17.4 million texts in about 25 seconds. With `shorter`, every string is one character shorter: 1.5 million
// texts in about 2 seconds.
import {bunResult, reasonOfAcceptance, reasonOfRejection} from './check-table-parser.ts'
import {labelReference} from './reference.ts'
import {runTableParserOnCodePoints} from './table-parser.ts'

type Family = {name: string, alphabet: string, longest: number, frames: readonly (readonly [start: string, end: string])[]}

const families: readonly Family[] = [
  {name: 'keys, values and brackets', alphabet: 'a1=.,[]{}\n #', longest: 6, frames: [['', '']]},
  {name: 'line ends and comments', alphabet: 'a=1#\n\r \t[],', longest: 6, frames: [['', ''], ['a=[', ']']]},
  {name: 'arrays and inline tables', alphabet: 'a=1,[]{}. \n"', longest: 5, frames: [['a=', ''], ['a={', '}'], ['a=[', ']']]},
  {
    name: 'numbers', alphabet: '019_.e+-xb: ', longest: 5,
    frames: [['', ''], ['', '=1'], ['', ' = 1\n'], ['a=', ''], ['a=', '\n'], ['a=[', ']'], ['a={b=', '}'], ['[', ']'], ['[[', ']]']],
  },
  {name: 'octal, binary and hex numbers', alphabet: '0178_xobaAfg.', longest: 4, frames: [['a=0', ''], ['a=0x', ''], ['a=0o', ''], ['a=0b', ''], ['0', '=1']]},
  {name: 'true, false, inf and nan', alphabet: 'truefalsin= -', longest: 5, frames: [['', ''], ['', '=1'], ['a=', ''], ['a=[', ']'], ['[', ']']]},
  {
    name: 'dates and times', alphabet: '019-:TZ.+ tz', longest: 5,
    frames: [
      ['a=1979-0', ''], ['a=1979-05-2', ''], ['a=1979-05-27T0', ''], ['a=1979-05-27T07:3', ''], ['a=1979-05-27T07:32:0', ''], ['a=1979-05-27 ', ''],
      ['a=1979-05-27T07:32:00+0', ''], ['a=07:3', ''], ['a=07:32:0', ''], ['a=[1979-05-27T07:32:0', ']'], ['1979-05-2', '=1'], ['[1979-05-2', ']'],
    ],
  },
  {
    name: 'strings', alphabet: '"\'\\uU0an \n\r', longest: 5,
    frames: [['a=', ''], ['a="', '"'], ['a="""', '"""'], ['a=\'', '\''], ['a=\'\'\'', '\'\'\''], ['', '=1'], ['a="\\u00', '"'], ['a="""\\', '"""'], ['[', ']']],
  },
]

if (import.meta.main) {
  const shorter = process.argv[2] === 'shorter' ? 1 : 0
  const failures: string[] = []
  const fail = (what: string, text: string) => {
    failures.push(what)
    if (failures.length <= 20) console.log(`FAILED: ${what}\n  ${JSON.stringify(text)}`)
  }
  const differences = new Map<string, {count: number, example: string}>()
  let total = 0
  let totalValid = 0
  for (const {name, alphabet, longest, frames} of families) {
    const letters = Array.from(alphabet, character => character.codePointAt(0)!)
    let texts = 0
    let valid = 0
    for (const [start, end] of frames) {
      const startCodePoints = Array.from(start, character => character.codePointAt(0)!)
      const endCodePoints = Array.from(end, character => character.codePointAt(0)!)
      for (let length = 0; length <= longest - shorter; length++) {
        // The strings of one length, counted in the base of the alphabet's size.
        const choice = new Array<number>(length).fill(0)
        for (;;) {
          const codePoints = [...startCodePoints, ...choice.map(letter => letters[letter]!), ...endCodePoints]
          const text = String.fromCodePoint(...codePoints)
          // A run with room for the text alone reads the same cells as a run with room for 512 code points.
          const trace = runTableParserOnCodePoints(codePoints, false, undefined, codePoints.length)
          const reference = labelReference(text)
          texts++
          if (trace.valid !== reference.valid) {
            fail(`valid: tables ${trace.valid}, reference ${reference.valid}`, text)
          } else if (reference.valid) {
            valid++
            for (const [position, label] of reference.labels.entries()) {
              if (trace.displayKind[position] !== label.kind || trace.depthAfter[position] !== label.depth || trace.containerAfter[position] !== label.container) {
                fail(`the labels differ at ${position}`, text)
                break
              }
            }
          }
          const bun = bunResult(text)
          if (bun.accepted !== trace.valid) {
            const reason = bun.accepted ? reasonOfAcceptance(text) : reasonOfRejection(bun.message)
            if (reason === null) {
              fail(bun.accepted ? 'Bun accepts a text that the tables reject, and no reason is found' : `Bun rejects a text that the tables accept: ${bun.message}`, text)
            } else {
              const difference = `${bun.accepted ? 'the tables reject, Bun accepts' : 'the tables accept, Bun rejects'}: ${reason}`
              const entry = differences.get(difference) ?? {count: 0, example: text}
              entry.count++
              if (text.length < entry.example.length) entry.example = text
              differences.set(difference, entry)
            }
          }
          let position = length - 1
          while (position >= 0 && choice[position] === letters.length - 1) choice[position--] = 0
          if (position < 0) break
          choice[position]!++
        }
      }
    }
    console.log(`${name}: ${texts.toLocaleString('en-US')} texts, ${valid.toLocaleString('en-US')} valid, in ${frames.length} ${frames.length === 1 ? 'family' : 'families'} of up to ${longest - shorter} of the characters ${JSON.stringify(alphabet)}`)
    total += texts
    totalValid += valid
  }
  console.log(`${total.toLocaleString('en-US')} texts, ${totalValid.toLocaleString('en-US')} valid: ${failures.length === 0 ? 'the tables and the reference agree on every one' : `${failures.length} failures`}`)
  console.log('Bun.TOML.parse differs on these, each for a reason that the README lists:')
  for (const [difference, {count, example}] of [...differences].sort((left, right) => right[1].count - left[1].count)) {
    console.log(`  ${count.toLocaleString('en-US')} ${difference}, e.g. ${JSON.stringify(example)}`)
  }
  console.log(failures.length === 0 ? 'every check passed' : `${failures.length} failures`)
  if (failures.length > 0) process.exitCode = 1
}
