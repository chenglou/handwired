// Six broken texts of the held-back sets that show what the final scoring found: two where trained tables are above
// the hand-written rules, two where the rules are above, and two that show what training on neutral damage alone
// misses. Each is printed with the wanted labels and two parsers' outputs under the text, see show.ts for the rows.
//
// Run from the repo root:
//   RECOVERY_FINAL=yes bun lab/recovery-toml/held-back/final/where/examples.ts > <held-back scratch>/final-where/examples.txt
import {heldBackLine, loadAll, parsersOfRow, rightOf} from './load.ts'
import {parserNamed, placeOf, showText} from './show.ts'

const loaded = loadAll()

type Example = {
  title: string
  id: string
  // What the text is, and what to see in the picture.
  what: string
  see: string
  // The parsers of the picture, e.g. '3' and '8.1', and the lines of the text that are printed, counted from 1.
  parsers: readonly string[]
  lines: readonly [first: number, last: number]
  // The rows whose counts over the whole text are printed under the picture.
  rows: readonly string[]
}

const examples: Example[] = [
  {
    title: '1. Trained tables above the hand-written rules: a key that needs quotes',
    id: 'hand-editing-20',
    what: 'A written case: in a pyproject.toml someone added the key `tests/*.py` and left out the quotes that a key with a slash and a star needs.',
    see: 'The hand-written rules show everything after the slash as a comment, so the equals sign and the array are lost, and they show the key of the next line as a string. The tables of row 8 show five code points of the key as a string and are right from the equals sign on. One of the five seeds has the whole text right.',
    parsers: ['3', '8.1'], lines: [10, 11], rows: ['2', '3', '4', '5', '7', '8'],
  },
  {
    title: '2. Trained tables above the hand-written rules: lines pasted from JSON',
    id: '20261107:1297',
    what: 'A sample of the generator: two entries pasted from a JSON file, with quotes around the keys, colons, and a comma at the end of each line.',
    see: 'After the comma at the end of the first line, the hand-written rules show the key of the next line and its colon as a string. The tables of row 8 show both lines as entries, with every seed. The quotes around the keys and the commas are added code points and are not counted.',
    parsers: ['3', '8.1'], lines: [3, 4], rows: ['2', '3', '4', '5', '7', '8'],
  },
  {
    title: '3. The rules above trained tables: a header after an error, without the search',
    id: '20261107:2323',
    what: 'A sample of the generator: NULL in the place of a value, and a header two lines below.',
    see: 'Row 7 shows the line of the mistake as the rules do. Then it reads the `[` of the header as the start of an array: the header line is at depth 1 up to its closing bracket, and most of its name is shown as a string. Every seed of the rows 4 and 7 loses these 12 code points. The one rule and the hand-written rules have the header right, and so have the rows 5 and 8, whose search repairs this. Section 1 of where.txt says why: without the search, the tables enter most later lines in another grammar state than the one that reads a header.',
    parsers: ['3', '7.1'], lines: [3, 6], rows: ['2', '3', '4', '5', '7', '8'],
  },
  {
    title: '4. The rules above trained tables: a comment that starts with a semicolon',
    id: '20261107:109',
    what: 'A sample of the generator: a comment on a line of its own that starts with a semicolon, as in an INI file.',
    see: 'The hand-written rules show the line as a comment. Row 8 has a character class for the semicolon and had such comments in its train data, and every one of its five seeds still has the line wrong, each in its own way: three show the text of the comment as a key or a string, 9 code points, and two have 2 or 3 code points wrong.',
    parsers: ['3', '8.2'], lines: [2, 3], rows: ['2', '3', '4', '5', '7', '8'],
  },
  {
    title: '5. What neutral damage alone misses: a table written as a block of YAML',
    id: '20261107:2483',
    what: 'A sample of the generator: the header `[server]` written as `server:`, and the entries below it indented, with colons in the place of the equals signs.',
    see: 'No one to three edits of the neutral damage write a colon after every key. Row 5, trained on neutral damage, shows each colon and what follows it in pieces of several kinds, e.g. the colon as a string and the space after it as a comment. Row 8, whose train data has colons after keys, has every code point right with every seed.',
    parsers: ['5.2', '8.2'], lines: [2, 5], rows: ['2', '3', '4', '5', '7', '8'],
  },
  {
    title: '6. What neutral damage alone misses: a comma at the end of an entry',
    id: '20261107:2320',
    what: 'A sample of the generator: a comma after every entry of one section, as a line of JSON ends.',
    see: 'The one rule has every counted code point right here. Four of the five seeds of row 5 read the comma as if an array were open: the depth is 1 at the end of the line, and with the seed shown the key of a later entry is the name of a header. In the neutral train data, 659 samples have their first error at a comma where the parser as it is counts depth 0: in 384 of them the comma belongs to an array or an inline table of the document whose opening bracket the damage took away, and in 275 the damage added the comma. Row 8 had commas at line ends in its train data and has every code point right.',
    parsers: ['5.2', '8.2'], lines: [2, 5], rows: ['2', '3', '4', '5', '7', '8'],
  },
]

console.log(heldBackLine)
console.log()
console.log('Six examples from the final scoring of the TOML track. Rows: 2 the one rule, 3 the hand-written rules, 4 and 5 the recipe on neutral damage without and with the search, 7 and 8 the recipe on the mixed set without and with the search.')
console.log('Under the text: "wanted" is the display kind of each code point: w white space, p punctuation, s string, n number, l literal, k key, h header name, c comment, + a code point that the mistake added, ? not scored. Then per parser what it shows, with E for an error, an x under each counted code point that it has wrong, and its depths when one is wrong. A ^ marks the first error: nothing before it is counted.')
for (const example of examples) {
  const {set, at} = placeOf(loaded, example.id)
  console.log()
  console.log(`## ${example.title}`)
  console.log()
  console.log(`${example.what} (${example.id}, lines ${example.lines[0]} to ${example.lines[1]} of the text)`)
  console.log()
  console.log(showText(loaded, set, at, example.parsers.map(name => parserNamed(loaded, name)), example.lines[0], example.lines[1]).join('\n'))
  console.log(example.see)
  const counted = loaded.scored[set][at]!
  console.log(`Right code points of the ${counted} counted ones of the whole text: ${example.rows.map(row => {
    const rights = parsersOfRow(loaded, row).map(parser => rightOf(parser, set, at))
    return `row ${row} ${rights.length === 1 ? rights[0] : `${rights.join(', ')} (seeds 1 to 5)`}`
  }).join('; ')}.`)
}
