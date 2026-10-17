// Valid JSON documents for the recovery dataset, each at most 512 code points and at most 16 levels deep.
//
// The first seven templates are copied from src/json-search/documents.ts, which this file does not import. The others,
// and the layouts, widen what the highlighter's tables see: nesting of several levels, arrays of scalars and of arrays,
// empty containers, a scalar at the top level, numbers in every form JSON allows, escapes of several serializers, and
// strings that hold brackets, colons, commas, quotes and the words true, false and null. stats.ts counts which cells
// of the grammar table these documents reach.
import {capacity, maximumDepth} from '../../src/json-search/highlighter/kinds.ts'
import type {Random} from './random.ts'

// A number written as given, e.g. 12.50, 1E5 or -0, which JSON.stringify would write another way.
export class RawNumber {
  constructor(readonly text: string) {}
}
const raw = (text: string) => new RawNumber(text)
export type Json = string | number | boolean | null | RawNumber | Json[] | {[key: string]: Json}

export const templates = [
  'packageManifest', 'userRecord', 'logEvent', 'settings', 'order', 'mapFeature', 'sensorReadings',
  'compilerConfig', 'launchConfig', 'serviceConfig', 'apiResponse', 'chatChunk', 'remoteCall', 'databaseRecord',
  'messages', 'lockfile', 'numberGrid', 'table', 'tree', 'deepNesting', 'scalar',
] as const
export type Template = typeof templates[number]

const firstNames = ['Ada', 'Grace', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Zoë', 'José', 'Søren', 'Chloé', 'Yuki', 'Amara', 'Tomás', '美咲']
const lastNames = ['Lovelace', 'Hopper', 'Hamilton', 'Ritchie', 'Liskov', 'Perlman', 'Okafor', 'Souza', 'Nakamura', 'García', 'Müller', 'Kowalski', 'O\'Brien', '李']
const cities = ['Lisbon', 'Osaka', 'Tromsø', 'Quito', 'Hobart', 'Accra', 'Tallinn', 'Muscat', 'São Paulo', 'Kraków', 'Reykjavík', '東京']
const countries = ['PT', 'JP', 'NO', 'EC', 'AU', 'GH', 'EE', 'OM', 'BR', 'PL', 'IS']
const streets = ['Rua das Flores', 'Harbor Rd', 'Elm Street', 'Nørregade', 'Calle 8', 'Station Lane', 'Av. Paulista']
const words = 'the harbor is quiet and an old ferry waits at the pier while gulls argue over something that washed up overnight a few early walkers pass the shuttered stalls on the way to an office or a train some stop to watch the tide'.split(' ')
const packageWords = ['fast', 'tiny', 'json', 'parse', 'stream', 'query', 'cache', 'router', 'logger', 'schema', 'lint', 'fetch', 'queue', 'state', 'config', 'glob']
const scopes = ['acme', 'northwind', 'harbor', 'types', 'tools']
const licenses = ['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', 'MPL-2.0']
const scripts: [string, string][] = [
  ['build', 'tsc -p .'], ['test', 'bun test'], ['lint', 'oxlint --type-aware src'], ['start', 'node dist/index.js'], ['dev', 'bun --watch src/main.ts'],
  ['clean', 'del-cli dist'], ['format', 'prettier --write "src/**/*.ts"'], ['grep', 'grep -rn "TODO" src'], ['docs', 'typedoc --out docs src/index.ts'],
]
const roles = ['admin', 'editor', 'viewer', 'billing', 'support', 'owner']
const levels = ['debug', 'info', 'warn', 'error', 'fatal']
const services = ['checkout', 'auth', 'search', 'inventory', 'mailer', 'gateway', 'thumbnailer']
const messages = [
  'request completed', 'retrying after timeout', 'cache miss for key "user:42"', 'upstream returned 502', 'payment declined: insufficient funds',
  'connection reset by peer', 'slow query on table orders', 'token expired, refreshing', 'wrote 3 files to C:\\temp\\out', 'line 1\nline 2',
  'expected "}" but found "]"', 'Error: boom\n    at main (app.js:3:9)', 'user said "no", skipping', 'parsed [1, 2, 3] in 4 ms', 'config: {retries: 3, verbose: true}',
  'don\'t retry', 'loaded C:\\Users\\ada\\notes.txt', 'matched ^\\d{3}-\\d{4}$ twice', 'value was null, expected true or false', 'disk at 91%, see /var/log',
  'saved to D:\\backup\\', 'step 1\tok\nstep 2\tfailed', 'wrote report.txt\r\n', 'progress 100%\r', 'bell\b', 'page 1\fpage 2',
]
const tags = ['urgent', 'draft', 'billing', 'ops', 'mobile', 'web', 'beta', 'internal', 'archived', 'eu-west', 'canary']
const themes = ['Solarized Dark', 'Solarized Light', 'Monokai', 'GitHub Light', 'Nord', 'Gruvbox']
const settingEntries: [string, (random: Random) => Json][] = [
  ['editor.fontSize', random => random.integer(11, 18)],
  ['editor.tabSize', random => random.pick([2, 4, 8])],
  ['editor.wordWrap', random => random.pick(['on', 'off', 'bounded'])],
  ['editor.formatOnSave', random => random.chance(0.5)],
  ['editor.rulers', random => random.pick<Json>([[80], [100, 120], []])],
  ['editor.lineHeight', random => random.pick([1.4, 1.5, 1.6, 0])],
  ['workbench.colorTheme', random => random.pick(themes)],
  ['window.zoomLevel', random => random.integer(-2, 2)],
  ['files.exclude', random => ({'**/.git': true, '**/node_modules': random.chance(0.7), '**/*.log': random.chance(0.5)})],
  ['files.autoSave', random => random.pick(['afterDelay', 'onFocusChange', 'off'])],
  ['terminal.shell', random => random.pick(['/bin/zsh', '/usr/bin/fish', 'C:\\Windows\\System32\\cmd.exe'])],
  ['terminal.cwd', random => random.pick(['~/projects', 'C:\\Users\\ada\\', 'D:\\work\\harbor\\'])],
  ['telemetry.enabled', () => false],
  ['search.followSymlinks', random => random.chance(0.5)],
  ['git.autofetchPeriod', random => random.pick([180, 300, null])],
  ['http.proxy', random => random.pick<Json>([null, 'http://proxy.example:8080'])],
  ['editor.codeActionsOnSave', random => ({'source.fixAll': random.chance(0.6), 'source.organizeImports': random.pick<Json>([true, false, 'explicit'])})],
  ['files.associations', () => ({'*.jsonc': 'json', '*.mdx': 'markdown'})],
  ['editor.minimap.enabled', random => random.chance(0.4)],
]
const products = ['Ceramic mug', 'Linen apron', 'Desk lamp', 'Notebook, ruled', 'Olive oil 500 ml', 'USB-C cable', 'Tea "Earl Grey"', 'Café filter', 'Monitor 24" curved', 'Pen (blue)']
const currencies = ['EUR', 'USD', 'JPY', 'BRL', 'NOK']
const sensors = ['th-04', 'co2-kitchen', 'door-north', 'pm25-roof', 'soil-07']
const units = ['°C', 'ppm', 'open', 'µg/m³', '%']
const notes = ['', 'leave at the door', 'gift wrap, please', 'call "Ana" on arrival', 'fragile\thandle with care', 'ring twice\nthen wait', 'it\'s a surprise', 'side gate [code 4471]']
const environments = ['production', 'staging', 'development', 'test']
const hosts = ['localhost', '127.0.0.1', 'db.internal', 'api.example.com', 'cache-2.internal']
const mimeTypes = ['application/json', 'text/plain', 'text/html; charset=utf-8', 'image/png']
const methods = ['tools/call', 'resources/read', 'initialize', 'textDocument/hover', 'workspace/symbol', 'ping']
const toolNames = ['get_weather', 'search_orders', 'create_ticket', 'lookup_user', 'convert_currency']
const fragments = ['Hel', 'lo', ' wor', 'ld', '!', 'The ', 'ferry', ' leaves', ' at', ' nine', '.', '\n', ' "ok"', ' {', '}']
const translationEntries: [string, string][] = [
  ['greeting', 'Hello, {name}!'], ['farewell', 'See you soon'], ['notFound', 'Page "{path}" not found'], ['items', '{count} items, {selected} selected'],
  ['confirm', 'Are you sure? This can\'t be undone.'], ['range', 'between [min] and [max]'], ['ratio', '{a}:{b}'], ['yes', 'true'], ['no', 'false'], ['empty', 'null'],
  ['hint', 'Press Ctrl+S to save, Esc to cancel'], ['pattern', '^\\d+\\.\\d+$'], ['path', 'C:\\Program Files\\Harbor\\bin'], ['multiline', 'first line\nsecond line'],
  ['tabbed', 'name\tvalue'], ['link', '<a href="/docs">docs</a>'], ['json', '{"id": 1, "tags": []}'], ['quote', 'She said "wait", then left'], ['slash', 'and/or'],
  ['unicode', 'café ☕ naïve'], ['list', '- milk\n- eggs'], ['formula', '\\alpha + \\beta'], ['account', 'ACME\\jdoe'], ['size', '5\' 11"'],
  ['folder', 'C:\\temp\\'], ['address', '12 Harbor Rd\nLisbon'], ['row', 'MG-204\t2\t12.50'], ['letter', 'Dear {name},\r\n\r\nThank you.'],
]
const treeKeys = ['id', 'name', 'type', 'value', 'items', 'children', 'meta', 'data', 'tags', 'enabled', 'count', 'label', 'options', 'next', 'total', 'title', 'flags', 'rate', 'config', 'result', 'user-agent', 'x', 'y', 'first name', '$ref', '_id', '2nd', 'a.b']

const sentence = (random: Random, wordCount: number) => Array.from({length: wordCount}, () => random.pick(words)).join(' ')

// The lists above hold four texts with a tab. Each is written anew when it is drawn, with other words and numbers, so
// that the tabs of the documents sit in many strings and not in four.
const logMessage = (random: Random) => {
  const message = random.pick(messages)
  if (!message.includes('\t')) return message
  const step = random.integer(1, 8)
  return `step ${step}\t${random.pick(['ok', 'done', 'skipped'])}\nstep ${step + 1}\t${random.pick(['failed', 'ok', 'timed out'])}`
}
const noteFor = (random: Random) => {
  const note = random.pick(notes)
  return note.includes('\t') ? `${random.pick(['fragile', 'heavy', 'keep cold', 'gift'])}\t${random.pick(['handle with care', 'this side up', 'ring first', 'no substitutes'])}` : note
}
const translationFor = (random: Random, [key, text]: [string, string]): [string, string] =>
  key === 'tabbed' ? [key, `${random.pick(words)}\t${random.pick(['value', 'count', 'total', random.pick(words)])}`]
    : key === 'row' ? [key, `${random.pick(['MG', 'AP', 'LM', 'NB', 'OO'])}-${random.integer(100, 999)}\t${random.integer(1, 9)}\t${(random.integer(100, 9999) / 100).toFixed(2)}`]
    : [key, text]

// Free text as a person types it into a field such as a note, a bio or a message: mostly plain words, and in four
// texts of ten something that a serializer must escape or that means something in JSON. The damage kinds inside
// strings take their strings from here, so what follows an inner quote or a line feed is different from text to text:
// a letter, a digit, a quote, a bracket, spaces, a line that looks like a member.
export function freeText(random: Random, wordCount: number): string {
  const count = Math.max(2, wordCount)
  const texts = Array.from({length: count}, () => random.pick(words))
  const feature = random.weighted([['plain', 57], ['tabs', 3], ['quoted', 13], ['lines', 10], ['tabs', 3], ['backslashes', 5], ['apostrophe', 5], ['marks', 4]] as const)
  switch (feature) {
    case 'plain':
      return texts.join(' ')
    case 'quoted': {
      // One to three phrases between quotes, each one to three words, with a comma or a period after some.
      for (let phrase = random.integer(1, 3), from = 0; phrase > 0 && from < texts.length; phrase--) {
        const first = random.integer(from, texts.length - 1)
        const last = Math.min(texts.length - 1, first + random.weighted([[0, 5], [1, 3], [2, 2]]))
        texts[first] = `"${texts[first]!}`
        texts[last] = `${texts[last]!}"${random.weighted([['', 7], [',', 2], ['.', 1]])}`
        from = last + 2
      }
      return texts.join(' ')
    }
    case 'lines': {
      // One to four line feeds. What starts the next line is drawn anew for each.
      const lineCount = random.integer(2, Math.min(5, count))
      const lineEnd = random.chance(0.12) ? '\r\n' : '\n'
      const lines: string[] = []
      for (let line = 0; line < lineCount; line++) {
        const body = texts.slice(Math.floor(line * count / lineCount), Math.floor((line + 1) * count / lineCount)).join(' ')
        const start = line === 0 ? '' : random.weighted([
          ['', 30], ['- ', 12], [`${random.integer(1, 9)}. `, 8], [`${random.integer(2, 40)} `, 6], ['  ', 8], ['    ', 6], ['"', 8], ['[', 5], ['{', 3], ['> ', 4],
          [`"${random.pick(words)}": `, 6], ['at ', 4],
        ])
        lines.push(start === '"' ? `"${body}"` : start === '[' ? `[${random.integer(1, 9)}] ${body}` : start === '{' ? `{${random.pick(words)}} ${body}` : `${start}${body}`)
      }
      return lines.join(lineEnd)
    }
    case 'tabs': {
      // A row pasted from a table, with two to four cells and sometimes a number, a label with its value after a tab, or
      // two lines of which the second starts with a tab.
      const form = random.weighted([['cells', 50], ['label', 25], ['indented line', 25]] as const)
      if (form === 'label') return `${texts[0]!}:\t${texts.slice(1).join(' ')}`
      if (form === 'indented line') return `${texts.slice(0, Math.ceil(count / 2)).join(' ')}\n\t${texts.slice(Math.ceil(count / 2)).join(' ')}`
      const cellCount = Math.min(count, random.integer(2, 4))
      const cells = Array.from({length: cellCount}, (_, cell) => texts.slice(Math.floor(cell * count / cellCount), Math.floor((cell + 1) * count / cellCount)).join(' '))
      if (random.chance(0.4)) cells.push(String(random.integer(0, 999)))
      return cells.join('\t')
    }
    case 'backslashes': {
      const name = random.pick(words)
      const path = random.pick([
        `C:\\Users\\${name}\\${random.pick(words)}.txt`, `D:\\${name}\\`, `\\\\${name}\\share\\${random.pick(words)}`, `C:\\Program Files\\${name}`, `^\\d{${random.integer(2, 4)}}-\\w+$`,
        `\\b${name}\\b`, `${name}\\${random.pick(words)}`, `C:\\${name}\\new\\${random.pick(words)}`,
      ])
      const place = random.integer(0, texts.length)
      return [...texts.slice(0, place), path, ...texts.slice(place)].join(' ')
    }
    case 'apostrophe': {
      const place = random.integer(0, texts.length - 1)
      texts[place] = random.pick(['it\'s', 'don\'t', 'can\'t', `${texts[place]!}'s`, 'O\'Brien', '\'quoted\''])
      return texts.join(' ')
    }
    case 'marks': {
      const place = random.integer(0, texts.length)
      const mark = random.pick([`[${random.integer(1, 9)}, ${random.integer(1, 9)}]`, `{${random.pick(words)}: ${random.integer(1, 9)}}`, `${random.pick(words)}: ${random.pick(words)},`, '{}', `(${random.pick(words)})`, 'true', 'null', `${random.integer(1, 99)}%`, 'a/b', '<b>'])
      return [...texts.slice(0, place), mark, ...texts.slice(place)].join(' ')
    }
  }
}
// The templates that hold free text, for the kinds of damage that need a string with a quote, a line feed or a tab in it.
export const freeTextTemplates = ['packageManifest', 'userRecord', 'logEvent', 'order', 'mapFeature', 'apiResponse', 'remoteCall', 'databaseRecord', 'messages', 'table', 'scalar'] as const
const pad = (value: number) => String(value).padStart(2, '0')
const time = (random: Random) => `2026-${pad(random.integer(1, 12))}-${pad(random.integer(1, 28))}T${pad(random.integer(0, 23))}:${pad(random.integer(0, 59))}:${pad(random.integer(0, 59))}Z`
const hexId = (random: Random, digits: number) => Array.from({length: digits}, () => '0123456789abcdef'[random.integer(0, 15)]).join('')
const person = (random: Random) => `${random.pick(firstNames)} ${random.pick(lastNames)}`
const version = (random: Random) => `${random.integer(0, 9)}.${random.integer(0, 30)}.${random.integer(0, 99)}`
// An amount with two decimals, written as JSON.stringify writes it, e.g. 12.5, or with both decimals, e.g. 12.50.
const amount = (random: Random, minimum: number, maximum: number): Json => {
  const value = Math.round((minimum + random.next() * (maximum - minimum)) * 100) / 100
  return random.chance(0.3) ? raw(value.toFixed(2)) : value
}
// Removes some keys after the first `keep`, so documents of one template don't all have the same keys.
function someKeys(random: Random, record: {[key: string]: Json}, keep: number, size: number) {
  const result: {[key: string]: Json} = {}
  Object.entries(record).forEach(([key, value], index) => {
    if (index < keep || random.chance(0.35 + 0.65 * size)) result[key] = value
  })
  return result
}
const dependencies = (random: Random, count: number): Json => Object.fromEntries(Array.from({length: count}, (): [string, Json] => [
  random.chance(0.3) ? `@${random.pick(scopes)}/${random.pick(packageWords)}` : `${random.pick(packageWords)}-${random.pick(packageWords)}`,
  `${random.pick(['^', '~', ''])}${random.integer(0, 9)}.${random.integer(0, 30)}.${random.integer(0, 9)}`,
]))

// A value of any type, for the templates that are not modeled on a real document: `depth` is how many more levels of
// containers it may open.
function randomScalar(random: Random): Json {
  return random.weighted<() => Json>([
    [() => random.integer(-20, 999), 5],
    [() => amount(random, -50, 500), 3],
    [() => raw(random.pick(['0', '-0', '0.0', '1e5', '1E5', '2.5e-7', '6.02e+23', '-1.5E+3', '1e0', '0.5', '-0.25', '100', '12.0', '3E-2', '9007199254740993'])), 2],
    [() => random.pick(words), 4],
    [() => sentence(random, random.integer(2, 5)), 2],
    [() => random.pick(translationEntries)[1], 3],
    [() => random.pick(['', ' ', 'true', 'false', 'null', '[]', '{}', ',', ':', '"', '\\', '/', '0', '-1', 'a"b', '}{', 'é', '\u2028', '😀', '\u007f']), 2],
    [() => true, 2], [() => false, 2], [() => null, 3],
  ])()
}
function randomTree(random: Random, depth: number, size: number): Json {
  if (depth <= 0 || random.chance(0.25)) return randomScalar(random)
  const count = random.weighted([[0, 2], [1, 3], [2, 4], [3, 3], [4, 2], [Math.round(2 + size * 6), 2]])
  const child = () => random.chance(0.45) ? randomTree(random, depth - 1, size) : randomScalar(random)
  if (random.chance(0.5)) {
    // An array is often of one type, e.g. only numbers or only objects.
    const uniform = random.chance(0.5) ? random.pick([() => random.integer(-9, 99), () => random.pick(words), () => randomTree(random, depth - 1, size), () => random.pick<Json>([true, false, null])]) : child
    return Array.from({length: count}, uniform)
  }
  const keys = random.shuffled(treeKeys).slice(0, count)
  return Object.fromEntries(keys.map((key): [string, Json] => [key, child()]))
}

// `size` in 0..1 scales how many fields and items a document has.
const builders: Record<Template, (random: Random, size: number) => Json> = {
  packageManifest(random, size) {
    const name = `${random.pick(packageWords)}-${random.pick(packageWords)}`
    return someKeys(random, {
      name: random.chance(0.4) ? `@${random.pick(scopes)}/${name}` : name,
      version: version(random),
      description: freeText(random, 2 + Math.round(size * 6)),
      type: 'module',
      main: 'dist/index.js',
      scripts: Object.fromEntries(scripts.filter(() => random.chance(0.2 + 0.4 * size))),
      dependencies: dependencies(random, Math.round(size * 5)),
      devDependencies: dependencies(random, Math.round(size * 3)),
      files: random.pick<Json>([['dist'], ['dist', 'src'], ['dist', 'README.md', 'LICENSE']]),
      keywords: Array.from({length: Math.round(size * 4)}, () => random.pick(packageWords)),
      license: random.pick(licenses),
      private: random.chance(0.4),
      engines: {node: random.pick(['>=18', '>=20.10', '^22'])},
    }, 2, size)
  },
  userRecord(random, size) {
    const name = person(random)
    return someKeys(random, {
      id: random.integer(1, 99_999),
      name,
      email: `${name.split(' ')[0]!.toLowerCase()}.${random.integer(1, 99)}@example.com`,
      age: random.integer(18, 90),
      active: random.chance(0.8),
      roles: Array.from({length: random.integer(0, 1 + Math.round(size * 3))}, () => random.pick(roles)),
      address: {street: `${random.integer(1, 400)} ${random.pick(streets)}`, city: random.pick(cities), zip: String(random.integer(10_000, 99_999)), country: random.pick(countries)},
      lastLogin: random.chance(0.85) ? time(random) : null,
      balance: amount(random, -1000, 3000),
      manager: random.chance(0.3) ? null : random.integer(1, 99_999),
      bio: freeText(random, 3 + Math.round(size * 14)),
    }, 3, size)
  },
  logEvent(random, size) {
    const level = random.pick(levels)
    return someKeys(random, {
      ts: time(random),
      level,
      service: random.pick(services),
      msg: random.chance(0.5) ? logMessage(random) : freeText(random, random.integer(2, 7)),
      durationMs: Math.round(random.next() * 250_000) / 100,
      status: random.pick([200, 201, 204, 301, 400, 404, 429, 500, 502]),
      requestId: hexId(random, 16),
      host: `${random.pick(services)}-${random.integer(1, 12)}.internal`,
      tags: Array.from({length: Math.round(size * 4)}, () => random.pick(tags)),
      error: level === 'error' || level === 'fatal' ? {code: random.pick(['ETIMEDOUT', 'ECONNRESET', 'E_VALIDATION']), retryable: random.chance(0.5), attempts: random.integer(1, 5)} : null,
      sampleRate: random.pick<Json>([1, 0.5, 0.01, 1e-4, 2.5e-7, raw('1E-3'), raw('1.0')]),
      context: {region: random.pick(tags), build: hexId(random, 7), detail: freeText(random, Math.round(size * 10))},
    }, 4, size)
  },
  settings(random, size) {
    const count = 2 + Math.round(size * (settingEntries.length - 2))
    const first = random.integer(0, settingEntries.length - 1)
    return Object.fromEntries(Array.from({length: count}, (_, offset): [string, Json] => {
      const [key, make] = settingEntries[(first + offset) % settingEntries.length]!
      return [key, make(random)]
    }))
  },
  order(random, size) {
    const items = Array.from({length: 1 + Math.round(size * 4)}, (): Json => ({
      sku: `${random.pick(['MG', 'AP', 'LM', 'NB', 'OO'])}-${random.integer(100, 999)}`, title: random.pick(products), qty: random.integer(1, 6), price: amount(random, 1, 91),
    }))
    return someKeys(random, {
      orderId: `A-${random.integer(10_000, 99_999)}`,
      items,
      total: amount(random, 0, 500),
      currency: random.pick(currencies),
      paid: random.chance(0.9),
      customer: {name: person(random), city: random.pick(cities)},
      shippedAt: random.chance(0.6) ? time(random) : null,
      notes: random.chance(0.5) ? noteFor(random) : freeText(random, random.integer(2, 8)),
      discount: random.chance(0.3) ? -Math.round(random.next() * 2000) / 100 : 0,
    }, 3, size)
  },
  // A GeoJSON feature. Its geometry is a point, a line, several points or the ring of a polygon, and it has an id, a
  // bounding box and a source or lacks them, as features of different producers do.
  mapFeature(random, size) {
    const coordinate = (): Json => [Math.round((random.next() * 360 - 180) * 1e5) / 1e5, Math.round((random.next() * 170 - 85) * 1e5) / 1e5]
    const several = () => Array.from({length: 2 + Math.round(size * 6)}, coordinate)
    const geometry = random.weighted<() => Json>([
      [() => ({type: 'Point', coordinates: coordinate()}), 45], [() => ({type: 'LineString', coordinates: several()}), 30], [() => ({type: 'MultiPoint', coordinates: several()}), 10],
      [() => {
        // A ring ends with its first coordinate.
        const ring = Array.from({length: 3 + Math.round(size * 3)}, coordinate)
        return {type: 'Polygon', coordinates: [[...ring, ring[0]!]]}
      }, 15],
    ])()
    const id = random.weighted<Json | undefined>([[undefined, 50], [random.integer(1, 99_999), 30], [`feature-${hexId(random, 6)}`, 20]])
    const west = random.integer(-180, 170)
    const south = random.integer(-85, 75)
    return {
      type: 'Feature',
      ...(id === undefined ? {} : {id}),
      ...(random.chance(0.25) ? {bbox: [west, south, west + random.integer(1, 10), south + random.integer(1, 10)]} : {}),
      geometry,
      properties: someKeys(random, {
        name: random.pick(cities),
        population: random.integer(900, 14_000_000),
        elevation: Math.round(random.next() * 30_000 - 400) / 10,
        area: random.pick<Json>([1.5e3, 8.25e2, raw('6.02e+23'), 3e-9, raw('1.5E3')]),
        capital: random.chance(0.2),
        tags: Array.from({length: Math.round(size * 3)}, () => random.pick(tags)),
        source: {name: random.pick(['survey', 'census', 'import']), year: random.integer(1990, 2026)},
        note: freeText(random, 2 + Math.round(size * 8)),
      }, 1, size),
    }
  },
  // The readings of one sensor: an array of readings that each name the sensor, or an object that names it once and
  // holds the readings. Which members a reading has beside its time and its value is decided per document, as the
  // program that writes the file decides it, e.g. one file has a battery level in every reading and another has none.
  sensorReadings(random, size) {
    const sensor = random.integer(0, sensors.length - 1)
    const start = 1_790_000_000 + random.integer(0, 9_000_000)
    const grouped = random.chance(0.35)
    const has = {unit: random.chance(0.6), ok: random.chance(0.35), battery: random.chance(0.35), at: random.chance(0.25)}
    const readings = Array.from({length: 1 + Math.round(size * (grouped ? 9 : 7))}, (_, reading): Json => ({
      ...(grouped ? {} : {sensor: sensors[sensor]!}), t: start + reading * 60, v: sensors[sensor] === 'door-north' ? random.chance(0.5) : Math.round(random.next() * 5000 - 500) / 100,
      ...(has.unit && !grouped ? {unit: units[sensor]!} : {}), ...(has.ok ? {ok: random.chance(0.9)} : {}), ...(has.battery ? {battery: random.integer(5, 100)} : {}),
      ...(has.at && !grouped ? {at: [random.integer(0, 40), random.integer(0, 40)]} : {}), ...(random.chance(0.15) ? {gap: null} : {}),
    }))
    if (!grouped) return readings
    return {
      sensor: sensors[sensor]!, ...(has.unit ? {unit: units[sensor]!} : {}), ...(random.chance(0.4) ? {intervalSeconds: 60} : {}),
      ...(has.at ? {location: {room: random.pick(['roof', 'kitchen', 'lab', 'hall']), floor: random.integer(0, 9)}} : {}), readings,
    }
  },
  // A tsconfig.json: nested options, short arrays, and an object of arrays.
  compilerConfig(random, size) {
    return someKeys(random, {
      compilerOptions: someKeys(random, {
        target: random.pick(['es2020', 'es2022', 'esnext']),
        module: random.pick(['esnext', 'nodenext', 'commonjs']),
        strict: true,
        noEmit: random.chance(0.5),
        outDir: random.pick(['dist', 'build', './out']),
        lib: random.pick<Json>([['dom', 'es2022'], ['esnext'], ['dom', 'dom.iterable', 'esnext']]),
        skipLibCheck: random.chance(0.7),
        noUnusedLocals: random.chance(0.5),
        baseUrl: '.',
        paths: {'@/*': ['src/*'], ...(random.chance(0.4) ? {'~tests/*': ['tests/*', 'fixtures/*']} : {})},
        types: random.pick<Json>([[], ['bun'], ['node', 'vitest/globals']]),
        jsx: 'react-jsx',
      }, 3, size),
      include: random.pick<Json>([['src'], ['src', 'tests'], ['*.ts', 'src/**/*.ts']]),
      exclude: ['node_modules', 'dist'],
      references: Array.from({length: Math.round(size * 2)}, (): Json => ({path: `./packages/${random.pick(packageWords)}`})),
      extends: random.pick(['../../tsconfig.json', '@tsconfig/node20/tsconfig.json']),
    }, 1, size)
  },
  // A launch.json: an array of objects that hold arrays and objects.
  launchConfig(random, size) {
    const configuration = (): Json => someKeys(random, {
      type: random.pick(['node', 'chrome', 'python', 'lldb']),
      request: random.pick(['launch', 'attach']),
      name: random.pick(['Launch Program', 'Attach to Process', 'Run Tests', 'Debug Server']),
      program: random.pick(['${workspaceFolder}/index.js', '${workspaceFolder}/src/main.ts', '${file}']),
      args: random.pick<Json>([[], ['--port', '8080'], ['--watch'], ['test', '--timeout', '30000']]),
      env: random.pick<Json>([{}, {NODE_ENV: 'development'}, {NODE_ENV: 'test', DEBUG: 'app:*'}]),
      port: random.pick([9229, 9222, 5678]),
      skipFiles: ['<node_internals>/**'],
      console: random.pick(['integratedTerminal', 'internalConsole']),
      stopOnEntry: random.chance(0.3),
    }, 3, size)
    return {version: '0.2.0', configurations: Array.from({length: 1 + Math.round(size * 2)}, configuration)}
  },
  // A service's config file: the members people edit by hand, with numbers under keys such as port, mode and month.
  serviceConfig(random, size) {
    return someKeys(random, {
      env: random.pick(environments),
      host: random.pick(hosts),
      port: random.pick([80, 443, 3000, 5432, 8080, 8443]),
      debug: random.chance(0.4),
      region: random.pick(['eu-west', 'us-east-1', 'ap-south']),
      replicas: random.integer(1, 12),
      timeoutMs: random.pick([250, 2500, 30_000, 120_000]),
      retries: random.integer(0, 5),
      logLevel: random.pick(levels),
      opacity: random.pick([0.25, 0.5, 0.75, 0.8]),
      offset: random.pick([-0.5, -1, 0.5, 0, -12.25]),
      utcOffset: random.integer(-11, 12),
      color: random.integer(0, 0xffffff),
      mask: random.pick([7, 31, 255, 4095]),
      mode: random.pick([644, 755, 600]),
      month: random.integer(1, 12),
      day: random.integer(1, 28),
      population: random.integer(1000, 14_000_000),
      database: {host: random.pick(hosts), port: 5432, user: random.pick(['admin', 'app', 'readonly']), ssl: random.chance(0.6), pool: {min: random.integer(0, 2), max: random.integer(4, 20)}},
      features: random.pick<Json>([[], ['search'], ['search', 'export', 'beta-ui']]),
      limits: {maxUploadMb: random.pick([5, 25, 100]), rateLimit: random.pick<Json>([null, 60, 600]), burst: random.chance(0.5)},
      version: version(random),
      since: `2026-${pad(random.integer(1, 12))}-${pad(random.integer(1, 28))}`,
    }, 3, size)
  },
  // A response with an outer object around a list, and the same response when the request failed.
  apiResponse(random, size) {
    if (random.chance(0.2)) {
      const issue = (): Json => ({field: random.pick(['email', 'name', 'page', 'perPage']), issue: random.pick(['required', 'too long', 'not a number'])})
      return {
        data: null,
        error: someKeys(random, {
          code: random.pick([400, 401, 404, 429, 500]), message: random.chance(0.5) ? logMessage(random) : freeText(random, random.integer(2, 8)),
          details: random.pick<Json>([[], [issue()], [issue(), issue()], null]), requestId: hexId(random, 8), retryAfter: random.pick<Json>([null, 1, 30]), docs: '/docs/errors',
        }, 2, size),
        ...(random.chance(0.3) ? {meta: {requestId: hexId(random, 8), durationMs: random.integer(1, 900)}} : {}),
      }
    }
    const row = (index: number): Json => someKeys(random, {
      id: index + 1, name: person(random), email: random.chance(0.8) ? `user${random.integer(1, 999)}@example.com` : null, active: random.chance(0.7), score: amount(random, 0, 100),
      tags: Array.from({length: random.integer(0, 2)}, () => random.pick(tags)),
    }, 2, size)
    return someKeys(random, {
      data: Array.from({length: Math.round(size * 4)}, (_, index) => row(index)),
      meta: {page: random.integer(1, 9), perPage: random.pick([10, 20, 50]), total: random.integer(0, 5000), next: random.chance(0.5) ? null : `/api/users?page=${random.integer(2, 10)}`},
      error: null,
      links: {self: '/api/users', docs: 'https://example.com/docs/api#users'},
      headers: {'content-type': random.pick(mimeTypes), 'x-request-id': hexId(random, 8)},
    }, 2, size)
  },
  // One chunk of a stream, or a call that a language model makes.
  chatChunk(random, size) {
    if (random.chance(0.4)) {
      const call = {
        name: random.pick(toolNames),
        arguments: someKeys(random, {city: random.pick(cities), units: random.pick(['metric', 'imperial']), days: random.integer(1, 7), includeHourly: random.chance(0.3), ids: [random.integer(1, 99), random.integer(100, 999)], filter: null}, 1, size),
      }
      // The call alone, or the call inside the message that carries it.
      return random.weighted<() => Json>([
        [() => call, 55], [() => ({id: `call_${hexId(random, 8)}`, type: 'function', function: call}), 25],
        [() => ({role: 'assistant', content: null, tool_calls: [{id: `call_${hexId(random, 8)}`, type: 'function', function: call}]}), 20],
      ])()
    }
    // Some producers send the id of the chunk's request and a fingerprint of the system beside the usual members.
    const choice = (index: number): Json => ({
      index, delta: random.pick<Json>([{content: random.pick(fragments)}, {role: 'assistant', content: ''}, {}]), logprobs: null, finish_reason: random.pick<Json>([null, null, 'stop', 'length']),
    })
    return someKeys(random, {
      id: `chatcmpl-${hexId(random, 8)}`,
      object: 'chat.completion.chunk',
      created: 1_790_000_000 + random.integer(0, 9_000_000),
      model: random.pick(['harbor-small', 'harbor-large-2026']),
      choices: Array.from({length: 1 + Math.round(size * 2)}, (_, index) => choice(index)),
      usage: random.pick<Json>([null, {prompt_tokens: random.integer(5, 900), completion_tokens: random.integer(1, 400)}]),
      system_fingerprint: `fp_${hexId(random, 6)}`,
      request: {id: `req-${hexId(random, 6)}`, attempt: random.integer(1, 3)},
    }, 2, size)
  },
  // A JSON-RPC request, notification, result or error, as a language server and a tool server exchange them. Which
  // members a message has differs from message to message, as in real traffic: a notification has no id, a request
  // may have no params, a result may come with or without its optional parts.
  remoteCall(random, size) {
    const id: Json = random.pick<Json>([random.integer(1, 999), `req-${hexId(random, 6)}`, null])
    const text = (): Json => ({type: 'text', text: freeText(random, 3 + Math.round(size * 9))})
    const place = (): Json => ({line: random.integer(0, 400), character: random.integer(0, 80)})
    // What a call's arguments hold: the query always, and some of the others.
    const callArguments = (): Json => someKeys(random, {
      query: freeText(random, 2 + Math.round(size * 4)), limit: random.integer(1, 50), offset: random.integer(0, 400), exact: random.chance(0.5),
      fields: random.pick<Json>([[], ['id', 'title'], ['id', 'title', 'updatedAt']]), cursor: random.pick<Json>([null, hexId(random, 8)]),
    }, 1, size)
    const params = (): Json => random.weighted<() => Json>([
      [() => ({name: random.pick(toolNames), arguments: callArguments(), ...(random.chance(0.3) ? {_meta: {progressToken: random.integer(1, 99)}} : {})}), 34],
      [() => [random.integer(1, 9), random.pick(words), random.chance(0.5), null].slice(0, random.integer(1, 4)), 16],
      [() => someKeys(random, {textDocument: {uri: 'file:///src/main.ts'}, position: place(), context: {includeDeclaration: random.chance(0.5)}, workDoneToken: hexId(random, 6)}, 2, size), 20],
      [() => ({}), 8],
      [() => someKeys(random, {
        protocolVersion: '2025-06-18', capabilities: someKeys(random, {roots: {listChanged: random.chance(0.5)}, sampling: {}, elicitation: {}}, 0, size),
        clientInfo: someKeys(random, {name: random.pick(packageWords), version: version(random), title: random.pick(themes)}, 2, size),
      }, 1, size), 12],
      [() => random.pick<Json>([{uri: 'notes/today.md'}, {level: random.pick(levels)}, {requestId: random.integer(1, 999), reason: freeText(random, random.integer(2, 4))}]), 10],
    ])()
    const roll = random.next()
    if (roll < 0.45) {
      const notification = random.chance(0.15)
      return {jsonrpc: '2.0', ...(notification ? {} : {id}), method: random.pick(methods), ...(random.chance(0.12) ? {} : {params: params()})}
    }
    if (roll < 0.8) {
      const result = random.weighted<() => Json>([
        [() => ({
          content: Array.from({length: 1 + Math.round(size * 2)}, text), ...(random.chance(0.7) ? {isError: random.chance(0.2)} : {}),
          ...(random.chance(0.2) ? {structuredContent: {count: random.integer(0, 40), items: random.pick<Json>([[], [random.integer(1, 99)], [random.integer(1, 99), random.integer(1, 99)]])}} : {}),
        }), 34],
        [() => random.pick<Json>([[], null, true]), 14],
        [() => someKeys(random, {
          capabilities: someKeys(random, {tools: {}, resources: {subscribe: true}, prompts: {listChanged: random.chance(0.5)}, logging: {}}, 1, size),
          protocolVersion: '2025-06-18', serverInfo: someKeys(random, {name: random.pick(packageWords), version: version(random)}, 1, size), instructions: freeText(random, 2 + Math.round(size * 5)),
        }, 1, size), 18],
        [() => ({
          tools: Array.from({length: 1 + Math.round(size * 2)}, (): Json => someKeys(random, {name: random.pick(toolNames), description: freeText(random, random.integer(2, 5)), inputSchema: {type: 'object'}}, 1, size)),
          ...(random.chance(0.5) ? {nextCursor: random.pick<Json>([null, hexId(random, 8)])} : {}),
        }), 16],
        [() => ({contents: {kind: random.pick(['markdown', 'plaintext']), value: freeText(random, 3 + Math.round(size * 7))}, ...(random.chance(0.5) ? {range: {start: place(), end: place()}} : {})}), 18],
      ])()
      return {jsonrpc: '2.0', id, result}
    }
    const data = random.pick<Json | undefined>([undefined, null, {retryAfter: random.integer(1, 60)}, freeText(random, random.integer(2, 5)), {details: [logMessage(random)]}])
    return {jsonrpc: '2.0', id, error: {code: random.pick([-32700, -32600, -32601, -32000]), message: random.pick(['Parse error', 'Invalid Request', 'Method not found', 'Server error']), ...(data === undefined ? {} : {data})}}
  },
  // A document as a database stores it: an id of 24 hexadecimal digits, times, and numbers kept as strings.
  databaseRecord(random, size) {
    return someKeys(random, {
      _id: hexId(random, 24),
      item: random.pick(['card', 'envelope', 'stamps', 'notebook', 'planner']),
      qty: random.integer(1, 120),
      createdAt: time(random),
      price: (Math.round(random.next() * 5000) / 100).toFixed(2),
      status: random.pick(['A', 'D', 'P']),
      size: {h: random.integer(5, 30), w: amount(random, 5, 40), uom: random.pick(['cm', 'in'])},
      tags: Array.from({length: Math.round(size * 3)}, () => random.pick(['red', 'blank', 'plain', 'gift', 'bulk'])),
      updatedAt: random.chance(0.7) ? time(random) : null,
      warehouse: {code: random.pick(['A', 'B', 'C']), stock: [random.integer(0, 90), random.integer(0, 90)]},
      views: random.integer(0, 2_000_000),
      note: freeText(random, 2 + Math.round(size * 6)),
    }, 3, size)
  },
  // Texts of an interface: strings that hold quotes, brackets, colons, commas, backslashes, and the words true, false, null.
  // A file is one flat object, or groups of texts under names with some members about the file before them. Most
  // texts are a string, and some have their plural forms, a note for the translator, or two lines as an array.
  messages(random, size) {
    // Texts of the list above, and one text in three written anew under a key of its own. The two texts of the list
    // that hold a tab are in one file of four each, so that the files with a tab are not most of the files.
    const entries = random.shuffled(translationEntries.filter(([key]) => (key !== 'tabbed' && key !== 'row') || random.chance(0.25))).slice(0, 2 + Math.round(size * 9))
      .map((entry, index): [string, string] => random.chance(0.33) ? [`${random.pick(['title', 'body', 'tooltip', 'help', 'banner', 'footer', 'label', 'error'])}${index + 1}`, freeText(random, random.integer(2, 7))] : translationFor(random, entry))
    const written = entries.map(([key, text]): [string, Json] => [key, random.weighted<() => Json>([
      [() => text, 80], [() => ({one: text, other: `${text} ({count})`}), 8],
      [() => ({message: text, description: random.pick(['shown in the header', 'a button', 'an error under a field', 'the subject of an email'])}), 6],
      [() => [text, random.pick(translationEntries)[1]], 6],
    ])()])
    if (random.chance(0.35)) return Object.fromEntries(written)
    const about = someKeys(random, {locale: random.pick(['en', 'pt-BR', 'ja', 'nb']), direction: 'ltr', fallback: random.pick<Json>([null, 'en']), revision: random.integer(1, 400), complete: random.chance(0.5)}, 0, size * 0.4)
    // One to four groups, each with at least one text when there are enough texts.
    const groupCount = Math.min(written.length, random.integer(1, 4))
    const groups: {[key: string]: Json} = {}
    const names = random.shuffled(['common', 'errors', 'buttons', 'emails', 'settings', 'onboarding'])
    let from = 0
    for (let group = 0; group < groupCount; group++) {
      const to = group === groupCount - 1 ? written.length : random.integer(from + 1, written.length - (groupCount - 1 - group))
      groups[names[group]!] = Object.fromEntries(written.slice(from, to))
      from = to
    }
    return {...about, ...groups}
  },
  // A lockfile: objects nested three levels deep, each with a closing line of its own in an indented layout. A package's
  // entry has its version and where it came from, and some of the members that only some packages have.
  lockfile(random, size) {
    const packageName = () => `${random.pick(packageWords)}-${random.pick(packageWords)}`
    const entry = (): Json => someKeys(random, {
      version: version(random), resolved: `https://registry.example.com/${random.pick(packageWords)}/-/${random.pick(packageWords)}-${version(random)}.tgz`,
      integrity: `sha512-${hexId(random, 20)}==`, dev: true, optional: true, license: random.pick(licenses), dependencies: dependencies(random, random.integer(0, 2)), engines: {node: '>=18'},
      bin: {[random.pick(packageWords)]: 'bin/cli.js'}, hasInstallScript: true, os: random.pick<Json>([['darwin'], ['darwin', 'linux']]), funding: {type: 'opencollective'},
    }, 2, size * 0.45)
    const root = someKeys(random, {
      name: packageName(), version: version(random), license: random.pick(licenses), dependencies: dependencies(random, 1 + Math.round(size * 2)),
      devDependencies: dependencies(random, Math.round(size * 2)), engines: {node: random.pick(['>=18', '>=20.10'])}, workspaces: ['packages/*'],
    }, 2, size * 0.5)
    const packages: {[key: string]: Json} = {'': root}
    for (let index = 0; index < Math.round(size * 3); index++) packages[`node_modules/${packageName()}`] = entry()
    return {name: packageName(), ...(random.chance(0.4) ? {version: version(random)} : {}), lockfileVersion: random.pick([2, 3, 3]), ...(random.chance(0.7) ? {requires: true} : {}), packages}
  },
  // Long runs of numbers and arrays of arrays, e.g. a matrix, a histogram or a list of points.
  numberGrid(random, size) {
    const number = (): Json => random.weighted<() => Json>([
      [() => random.integer(0, 99), 4], [() => random.integer(-999, 99_999), 2], [() => Math.round(random.next() * 2000 - 1000) / 100, 3],
      [() => raw(random.pick(['0', '-0', '0.0', '1e5', '1E-7', '2.5e+3', '-1.25', '1.0', '0.001'])), 1],
    ])()
    const rows = 1 + Math.round(size * 5)
    const columns = random.integer(1, 2 + Math.round(size * 6))
    const grid = (): Json[] => Array.from({length: rows}, () => Array.from({length: columns}, number))
    return random.weighted<() => Json>([
      [() => grid(), 3],
      // Rows of different lengths, e.g. the neighbors of each node of a graph.
      [() => Array.from({length: rows}, () => Array.from({length: random.integer(0, columns)}, number)), 1],
      // A grid below a row with the names of its columns.
      [() => [Array.from({length: columns}, (_, column) => `${random.pick(['x', 'y', 'z', 'q', 'col'])}${column + 1}`), ...grid()], 1],
      [() => Array.from({length: 2 + Math.round(size * 40)}, number), 3],
      // An array as a numeric library stores it, with some of the members that such a file may have.
      [() => someKeys(random, {
        shape: [rows, columns], dtype: random.pick(['float32', 'int64']), data: grid(), order: random.pick(['C', 'F']), name: random.pick(words), min: random.integer(-999, 0),
        max: random.integer(1, 99_999), mask: random.pick<Json>([null, []]),
      }, 3, size * 0.5), 2],
      [() => ({
        bins: Array.from({length: columns + 1}, (_, index) => index * 10), counts: Array.from({length: columns}, () => random.integer(0, 500)),
        ...(random.chance(0.4) ? {underflow: random.integer(0, 20), overflow: random.integer(0, 20)} : {}), ...(random.chance(0.3) ? {label: random.pick(words)} : {}), empty: [], nested: [[], [[]], [[1]]],
      }), 1],
      [() => Array.from({length: rows}, () => [random.pick(words), random.integer(0, 99), random.chance(0.5)]), 1],
    ])()
  },
  // Rows of a table: an array of arrays with mixed values, or an array of objects with the same keys.
  table(random, size) {
    const rows = 1 + Math.round(size * 6)
    if (random.chance(0.5)) {
      // One table in three has a column of free text, so that an array holds strings with quotes and line feeds too.
      const withNote = random.chance(0.33)
      return [['id', 'name', 'city', 'active', ...(withNote ? ['note'] : [])], ...Array.from({length: rows}, (_, index): Json => [
        index + 1, person(random), random.chance(0.8) ? random.pick(cities) : null, random.chance(0.5), ...(withNote ? [freeText(random, random.integer(2, 5))] : []),
      ])]
    }
    return Array.from({length: rows}, (_, index): Json => ({
      id: index + 1, name: random.pick(firstNames), done: random.chance(0.5),
      ...(random.chance(0.3) ? {note: random.chance(0.5) ? noteFor(random) : freeText(random, random.integer(2, 6))} : {}), ...(random.chance(0.2) ? {parent: null} : {}),
    }))
  },
  // A value of any type inside any type, for token sequences the modeled templates don't have.
  tree(random, size) {
    return randomTree(random, random.integer(1, 5), size)
  },
  // A chain of containers to depth 10 to 16, with entries beside the chain at some levels.
  deepNesting(random) {
    const levels = random.weighted([[maximumDepth, 5], [maximumDepth - 1, 2], [random.integer(10, maximumDepth - 2), 3]])
    // The innermost container has entries of its own, so that every grammar state is reached at the deepest level.
    let value: Json = random.chance(0.5)
      ? Object.fromEntries(random.shuffled(treeKeys).slice(0, random.integer(0, 5)).map((key): [string, Json] => [key, randomScalar(random)]))
      : Array.from({length: random.integer(0, 5)}, () => randomScalar(random))
    for (let level = levels - 1; level >= 1; level--) {
      const before = random.chance(0.25)
      const after = random.chance(0.25)
      if (random.chance(0.5)) {
        const entries: [string, Json][] = []
        if (before) entries.push([random.pick(treeKeys.slice(0, 8)), randomScalar(random)])
        entries.push([random.pick(['child', 'next', 'inner', 'data', 'v']), value])
        if (after) entries.push([random.pick(treeKeys.slice(8, 16)), randomScalar(random)])
        value = Object.fromEntries(entries)
      } else {
        value = [...(before ? [randomScalar(random)] : []), value, ...(after ? [randomScalar(random)] : [])]
      }
    }
    return value
  },
  // A document that is one value, or a container with nothing or little in it.
  scalar(random) {
    return random.weighted<() => Json>([
      [() => logMessage(random), 2], [() => freeText(random, random.integer(2, 12)), 2], [() => random.pick(translationEntries)[1], 2],
      [() => random.integer(-999, 99_999), 2], [() => raw(random.pick(['0', '-0', '0.5', '-12.75', '1e10', '2.5E-3', '1E+5', '0.0', '-0.0e0'])), 2],
      [() => true, 1], [() => false, 1], [() => null, 1],
      [() => [], 1], [() => ({}), 1], [() => '', 1], [() => [[]], 0.5], [() => [{}], 0.5], [() => ({a: {}}), 0.5], [() => ({list: []}), 0.5],
      [() => [randomScalar(random)], 1], [() => ({[random.pick(treeKeys)]: randomScalar(random)}), 1],
    ])()
  },
}

// How a document is written.
export const styles = ['compact', 'spaced', 'indented', 'tabbed', 'padded', 'wrapped'] as const
// compact: {"a":1,"b":[1,2]}, as JSON.stringify writes it.
// spaced: {"a": 1, "b": [1, 2]}, as Python's json.dumps writes it.
// indented: one entry per line, with 2 or 4 spaces per level. tabbed: the same with one tab per level.
// padded: { "a": 1, "b": [ 1, 2 ] }, with {} and [] for empty containers, as Node prints an object and as some tools
// write JSON. It is rare among the documents, and the damage kinds that start from a printed object ask for it.
// wrapped: the spaced text with a line feed after a comma wherever a line has reached a width, as a person or a tool
// wraps a long line. Its lines start in the middle of containers, so that neither the start of a line nor its
// indentation says anything about the structure.
export type Style = typeof styles[number]
export type Layout = {
  style: Style
  // The indentation of one level, for the styles indented and tabbed.
  indent: string
  // In an indented text: a container that holds only scalars and fits in 48 code points is written on one line, e.g.
  // "files": ["dist", "src"], as people and formatters write it.
  shortOnOneLine: boolean
  // In an indented text: an object that holds only scalars and is an item of an array is written on one line, whatever
  // its length, e.g. the rows of a table.
  rowsOnOneLine: boolean
  // How characters inside strings are escaped. plain: as JSON.stringify. nonAscii: every code point above U+007F as
  // \u00e9, as Python writes it. nonAsciiUpperCase: the same with \u00E9. slash: every / as \/, as PHP writes it. html: <, >
  // and & as \u003c, \u003e and \u0026, as Go writes them.
  escapes: 'plain' | 'nonAscii' | 'nonAsciiUpperCase' | 'slash' | 'html'
  // A line feed after the document, as most files have.
  finalLineFeed: boolean
  // In an indented text: a short container on one line has a space inside its brackets, e.g. [ 1, 2 ], as Node prints it.
  paddedShort?: boolean
  // White space before the document, e.g. the empty line at the top of some files. Mostly none.
  leading?: string
  // For the style wrapped: the width that a line reaches before the next comma ends it. `indent` is what every line
  // after the first starts with.
  wrapWidth?: number
  // A space before every colon as well as after it, e.g. "key" : 1, as Jackson's pretty printer and the old MongoDB
  // shell write it. Only valid samples and the old shell's documents have it.
  spaceBeforeColon?: boolean
  // What ends a line. Only valid samples have '\r\n'.
  lineEnd?: '\n' | '\r\n'
}

function writeString(value: string, escapes: Layout['escapes']) {
  let text = JSON.stringify(value)
  if (escapes === 'nonAscii' || escapes === 'nonAsciiUpperCase') {
    text = text.replace(/[\u0080-\uffff]/g, character => {
      const digits = character.charCodeAt(0).toString(16).padStart(4, '0')
      return `\\u${escapes === 'nonAscii' ? digits : digits.toUpperCase()}`
    })
  } else if (escapes === 'slash') {
    text = text.replace(/\//g, '\\/')
  } else if (escapes === 'html') {
    text = text.replace(/[<>&]/g, character => `\\u00${character.charCodeAt(0).toString(16)}`)
  }
  return text
}

const isScalar = (value: Json) => value === null || typeof value !== 'object' || value instanceof RawNumber
const isContainerOfScalars = (value: Json) => !isScalar(value) && (Array.isArray(value) ? value : Object.values(value)).every(isScalar)

// The spaced text of a document with a line feed in place of the space after a comma, wherever the line has reached
// `width` code points. Commas inside strings stay as they are.
function wrapped(text: string, width: number, indent: string) {
  let result = ''
  let lineLength = 0
  let inString = false
  const characters = Array.from(text)
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!
    if (inString && character === '\\') {
      result += character + characters[index + 1]!
      lineLength += 2
      index++
      continue
    }
    if (character === '"') inString = !inString
    if (!inString && character === ',' && characters[index + 1] === ' ' && lineLength + 1 >= width) {
      result += `,\n${indent}`
      lineLength = indent.length
      index++
      continue
    }
    result += character
    lineLength++
  }
  return result
}

export function serialize(value: Json, layout: Layout): string {
  const {style, escapes} = layout
  const colonInLine = layout.spaceBeforeColon === true ? ' : ' : ': '
  const oneLine = (item: Json, comma: string, colon: string, padding: string): string => {
    if (item instanceof RawNumber) return item.text
    if (Array.isArray(item)) return item.length === 0 ? '[]' : `[${padding}${item.map(entry => oneLine(entry, comma, colon, padding)).join(comma)}${padding}]`
    if (item !== null && typeof item === 'object') {
      const entries = Object.entries(item)
      return entries.length === 0 ? '{}' : `{${padding}${entries.map(([key, entry]) => `${writeString(key, escapes)}${colon}${oneLine(entry, comma, colon, padding)}`).join(comma)}${padding}}`
    }
    return typeof item === 'string' ? writeString(item, escapes) : JSON.stringify(item)
  }
  const lines = (item: Json, indentation: string, isRow: boolean): string => {
    if (isScalar(item)) return oneLine(item, ', ', colonInLine, '')
    const entries: [string | null, Json][] = Array.isArray(item) ? item.map(entry => [null, entry]) : Object.entries(item)
    if (entries.length === 0) return Array.isArray(item) ? '[]' : '{}'
    if (isContainerOfScalars(item)) {
      const short = oneLine(item, ', ', colonInLine, layout.paddedShort === true ? ' ' : '')
      if ((isRow && layout.rowsOnOneLine && !Array.isArray(item)) || (layout.shortOnOneLine && Array.from(short).length <= 48)) return short
    }
    const inner = indentation + layout.indent
    const written = entries.map(([key, entry]) => `${inner}${key === null ? '' : `${writeString(key, escapes)}${colonInLine}`}${lines(entry, inner, Array.isArray(item))}`)
    return `${Array.isArray(item) ? '[' : '{'}\n${written.join(',\n')}\n${indentation}${Array.isArray(item) ? ']' : '}'}`
  }
  const text = style === 'compact' ? oneLine(value, ',', ':', '')
    : style === 'spaced' ? oneLine(value, ', ', colonInLine, '')
    : style === 'padded' ? oneLine(value, ', ', colonInLine, ' ')
    : style === 'wrapped' ? wrapped(oneLine(value, ', ', colonInLine, ''), layout.wrapWidth ?? 60, layout.indent)
    : lines(value, '', false)
  // A string holds no raw line feed, so every line feed of the text is one that the layout wrote.
  const written = `${layout.leading ?? ''}${text}${layout.finalLineFeed ? '\n' : ''}`
  return layout.lineEnd === '\r\n' ? written.replaceAll('\n', '\r\n') : written
}

export function codePointLength(text: string) {
  let length = text.length
  for (let index = 0; index < text.length - 1; index++) {
    const unit = text.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = text.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) length--
    }
  }
  return length
}

export type DocumentRequest = {
  // The document's largest length in code points, at most 512.
  maximumLength?: number
  // The templates and styles to draw from. Without them, every template and every style are drawn.
  templates?: readonly Template[]
  styles?: readonly Style[]
  // Fields of the layout that the caller fixes, e.g. {escapes: 'plain'} for a text that must hold no \u escape.
  layout?: Partial<Layout>
  // Numbers as a program prints them from memory, and not as a source wrote them: no exponent, no 12.50, no -0. For
  // the documents that a kind turns into the print of a program.
  plainNumbers?: boolean
}
export type GeneratedDocument = {text: string, value: Json, template: Template, layout: Layout}

// How often each template is drawn. The templates that are not modeled on a real document get less.
const templateWeights: Record<Template, number> = {
  packageManifest: 6, userRecord: 6, logEvent: 6, settings: 6, order: 6, mapFeature: 4, sensorReadings: 5, compilerConfig: 5, launchConfig: 4,
  serviceConfig: 7, apiResponse: 5, chatChunk: 4, remoteCall: 4, databaseRecord: 4, messages: 5, lockfile: 3, numberGrid: 5, table: 4, tree: 6,
  deepNesting: 4, scalar: 2.5,
}
const styleWeights: Record<Style, number> = {compact: 20, spaced: 20, indented: 41, tabbed: 10, padded: 4, wrapped: 7}

export function drawTemplate(random: Random, allowed: readonly Template[] = templates): Template {
  return random.weighted(allowed.map(template => [template, templateWeights[template]] as const))
}

const defaultStyles: readonly Style[] = styles
export function drawLayout(random: Random, allowedStyles: readonly Style[] = defaultStyles, fixed: Partial<Layout> = {}): Layout {
  const style = random.weighted(allowedStyles.map(allowed => [allowed, styleWeights[allowed]] as const))
  return {
    style,
    indent: style === 'tabbed' ? '\t' : style === 'wrapped' ? random.weighted([['', 45], [' ', 25], ['  ', 20], ['    ', 10]]) : random.chance(0.15) ? '    ' : '  ',
    shortOnOneLine: random.chance(0.45),
    rowsOnOneLine: random.chance(0.3),
    escapes: random.weighted<Layout['escapes']>([['plain', 78], ['nonAscii', 12], ['nonAsciiUpperCase', 2], ['slash', 4], ['html', 4]]),
    finalLineFeed: (style === 'indented' || style === 'tabbed' || style === 'wrapped') && random.chance(0.3),
    leading: random.weighted([['', 96], ['\n', 2.5], [' ', 1], ['\n\n', 0.5]]),
    wrapWidth: random.integer(24, 76),
    ...fixed,
  }
}

// The layout of a valid sample: as any document's, and in a few of them a space before every colon, or lines that
// end with a carriage return and a line feed. The tables read these through cells that only white space reaches, and
// the valid samples are there to show that valid JSON is still read as before.
export function drawValidLayout(random: Random): Layout {
  const layout = drawLayout(random)
  return {...layout, spaceBeforeColon: layout.style !== 'compact' && random.chance(0.06), lineEnd: random.chance(0.06) ? '\r\n' : '\n'}
}

// A value with its numbers as a program prints them: see DocumentRequest.plainNumbers.
function withPlainNumbers(value: Json): Json {
  if (value instanceof RawNumber || typeof value === 'number') {
    const number = value instanceof RawNumber ? Number(value.text) : value
    // A number that would print with an exponent keeps its digits and loses the exponent, e.g. 6.02 for 6.02e+23.
    const plain = /e/.test(String(number)) ? Number(number.toExponential().split('e')[0]) : number
    return Object.is(plain, -0) ? 0 : plain
  }
  if (Array.isArray(value)) return value.map(withPlainNumbers)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]): [string, Json] => [key, withPlainNumbers(entry)]))
  return value
}

// How deep a value nests: 0 for a scalar, 1 for a container of scalars.
function nestingOf(value: Json): number {
  if (isScalar(value)) return 0
  let deepest = 0
  for (const entry of Array.isArray(value) ? value : Object.values(value)) deepest = Math.max(deepest, nestingOf(entry))
  return deepest + 1
}

// A valid document of the given template in the given layout. A document that comes out longer than the limit is built
// again with fewer fields, and on one line after some tries when the caller allows another style. Returns undefined
// when even the smallest document of the template is longer than the limit, e.g. a lockfile in 76 code points.
export function makeDocumentOf(random: Random, template: Template, layout: Layout, request: DocumentRequest = {}): GeneratedDocument | undefined {
  const maximumLength = Math.min(request.maximumLength ?? capacity, capacity)
  // Most documents get a size that fills a part of the limit, and one in six is small.
  let size = random.chance(0.16) ? random.next() * 0.25 : random.next()
  let currentLayout = layout
  for (let attempt = 0; ; attempt++) {
    const value = request.plainNumbers === true ? withPlainNumbers(builders[template](random, size)) : builders[template](random, size)
    const text = serialize(value, currentLayout)
    if (codePointLength(text) <= maximumLength && nestingOf(value) <= maximumDepth) return {text, value, template, layout: currentLayout}
    size = attempt >= 8 ? 0 : size * 0.6
    const mayCompact = request.styles === undefined || request.styles.includes('compact')
    if (attempt >= 3 && mayCompact && currentLayout.style !== 'compact') currentLayout = {...currentLayout, style: 'compact', finalLineFeed: false}
    if (attempt > 16) return undefined
  }
}

export function makeDocument(random: Random, request: DocumentRequest = {}): GeneratedDocument | undefined {
  const template = drawTemplate(random, request.templates)
  const layout = drawLayout(random, request.styles, request.layout)
  return makeDocumentOf(random, template, layout, request)
}

// Records of one stream, each a one-line document with the same keys as the others: lines of a log, readings of a
// sensor, rows of an export, chunks of an answer. Their times and counters grow from record to record.
export const recordTypes = ['event', 'reading', 'row', 'chunk', 'pair', 'value'] as const
export type RecordType = typeof recordTypes[number]
// Texts that a model streams in pieces: sentences, and answers with JSON in them, whose quotes, braces and line feeds
// end up inside the pieces.
const streamedTexts = ['Hello world!', 'The ferry leaves at nine.', 'Sure, here it is:\n{"ok": true}', 'Done. 3 files changed.', '{"city": "Lisbon", "days": 2}', 'Yes.\n\nAnything else?', 'It costs 12.50 EUR (plus tax).'] as const

// A text cut into `count` consecutive pieces of at least one character each, as a stream delivers it.
function piecesOf(random: Random, text: string, count: number): string[] {
  const characters = Array.from(text)
  const cuts = new Set<number>()
  while (cuts.size < Math.min(count, characters.length) - 1) cuts.add(random.integer(1, characters.length - 1))
  const bounds = [0, ...[...cuts].sort((left, right) => left - right), characters.length]
  return bounds.slice(0, -1).map((start, index) => characters.slice(start, bounds[index + 1]).join(''))
}

// With `fits`, a record that the caller does not take is made again with other values, up to 40 times, and after 10
// times without what makes it the odd one. A record that fits in no try ends the stream when two records are there,
// and otherwise no stream is made. damage/several.ts uses that to keep every record of a text in one split.
export function makeRecords(random: Random, type: RecordType, count: number, fits?: (record: Json) => boolean): Json[] | undefined {
  const start = 1_790_000_000 + random.integer(0, 9_000_000)
  const hour = random.integer(0, 22)
  const minute = random.integer(0, 50)
  const service = random.pick(services)
  const date = `2026-${pad(random.integer(1, 12))}-${pad(random.integer(1, 28))}`
  const sensor = random.integer(0, sensors.length - 1)
  // One record in four streams of ten is odd: it has one more key or a nested object. So the records after the first
  // are not all copies of its tokens.
  const oddRecord = random.chance(0.4) ? random.integer(0, count - 1) : -1
  const pieces = type === 'chunk' ? piecesOf(random, random.pick(streamedTexts), count) : []
  // The writer of a stream decides which members its records have beside the ones that every stream of the type has,
  // e.g. one log has a request id on every line and another has none. Each of six such members is in a stream or not.
  // They differ in what they hold, a string, a number, an array or an object, and in where they stand, so that the
  // streams of one type have many sequences of tokens: a record's sequence decides its split, see splits.ts, and a
  // split that had one or two sequences of a type would test one or two shapes of record.
  const has = Array.from({length: 6}, () => random.chance(0.45))
  const model = random.pick(['harbor-small', 'harbor-large-2026'])
  const streamId = hexId(random, 6)
  const recordAt = (index: number, odd: boolean): Json => {
    switch (type) {
      case 'event': {
        const level = odd ? 'error' : random.pick(levels.slice(0, 3))
        return {
          ts: `${date}T${pad(hour)}:${pad(minute + index)}:${pad(random.integer(0, 59))}Z`, ...(has[4]! ? {pid: 4000 + (start % 900)} : {}), level, service,
          ...(has[0]! ? {host: `${service}-${random.integer(1, 12)}`} : {}), msg: logMessage(random),
          ...(has[1]! ? {requestId: hexId(random, 8)} : {}), ...(has[2]! ? {durationMs: random.integer(1, 2500)} : {}), ...(has[3]! ? {tags: random.pick<Json>([[], [random.pick(tags)]])} : {}),
          ...(has[5]! ? {user: {id: random.integer(1, 999), plan: random.pick(['free', 'team'])}} : {}),
          ...(odd ? {error: {code: random.pick(['ETIMEDOUT', 'ECONNRESET']), retryable: random.chance(0.5)}} : {}),
        }
      }
      case 'reading':
        return {
          ...(has[4]! ? {id: `${streamId}-${index + 1}`} : {}), sensor: sensors[sensor]!, t: start + index * 60, v: sensors[sensor] === 'door-north' ? random.chance(0.5) : Math.round(random.next() * 5000 - 500) / 100,
          ...(has[0]! ? {unit: units[sensor]!} : {}), ...(has[1]! ? {ok: random.chance(0.9)} : {}), ...(has[2]! ? {battery: random.integer(5, 100)} : {}), ...(has[3]! ? {at: [random.integer(0, 40), random.integer(0, 40)]} : {}),
          ...(has[5]! ? {device: {model: `HX-${200 + (start % 7) * 10}`, firmware: `1.${start % 9}.0`}} : {}),
          ...(odd ? {gap: null} : {}),
        }
      case 'row':
        return {
          id: index + 1, name: person(random), ...(has[0]! ? {email: random.chance(0.8) ? `user${random.integer(1, 999)}@example.com` : null} : {}), active: random.chance(0.7),
          ...(has[1]! ? {score: random.integer(0, 100)} : {}), ...(has[2]! ? {city: random.pick(cities)} : {}), ...(has[3]! ? {tags: []} : {}),
          ...(has[4]! ? {team: {id: random.integer(1, 40), name: random.pick(services)}} : {}), ...(has[5]! ? {joined: `2026-${pad(random.integer(1, 12))}-${pad(random.integer(1, 28))}`} : {}),
          ...(odd ? {roles: [random.pick(roles), random.pick(roles)]} : {}),
        }
      case 'chunk':
        return {
          ...(has[0]! ? {id: `c-${streamId}`} : {}), ...(has[1]! ? {model} : {}), ...(has[4]! ? {created: start} : {}), delta: pieces[index] ?? '', ...(has[5]! ? {role: 'assistant'} : {}), index,
          ...(has[2]! ? {finish_reason: index === count - 1 ? 'stop' : null} : {}), ...(has[3]! ? {usage: {tokens: random.integer(1, 40)}} : {}),
          ...(odd ? {logprobs: null} : {}),
        }
      case 'pair':
        return [
          start + index, random.integer(0, 99), ...(has[0]! ? [random.integer(0, 99)] : []), ...(has[1]! ? [random.chance(0.5)] : []), ...(has[2]! ? [random.pick(tags)] : []),
          ...(has[3]! ? [[random.integer(0, 40), random.integer(0, 40)]] : []), ...(odd ? [null] : []),
        ]
      case 'value':
        return random.pick<Json>([index + 1, random.pick(words), random.chance(0.5), null])
    }
  }
  const records: Json[] = []
  for (let index = 0; index < count; index++) {
    let record: Json | undefined
    for (let attempt = 0; attempt < 40 && record === undefined; attempt++) {
      const made = recordAt(index, index === oddRecord && attempt < 10)
      if (fits === undefined || fits(made)) record = made
    }
    if (record === undefined) return records.length >= 2 ? records : undefined
    records.push(record)
  }
  return records
}
