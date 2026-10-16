// Valid TOML documents for the recovery dataset, each at most 512 code points, with arrays and inline tables nested at
// most 16 deep.
//
// 16 templates are modeled on files that people write and tools generate: a Cargo manifest, a pyproject, the config of
// a formatter, of a linter, of a static site, of a deploy, of an editor, of a server, of a database, of a metrics
// agent, feature flags, strings for translation, a data file with records, tasks of a task runner, and a lockfile.
// Two are not: `deepNesting` nests arrays and inline tables up to 16 levels, and `oddities` holds what TOML allows
// and config files rarely have, e.g. the key `1979-05-27`, the number `-nan` and the header `[ g .  h  . i ]`.
// Together they use every feature of TOML 1.0's syntax, and stats.ts counts which cells of the tables they read.
//
// A template builds sections: a header, or none for the keys at the top of a file, and below it lines with a key and
// a value, comments and empty lines. `serialize` writes the sections in a layout, which says e.g. whether the keys
// below a header are indented and whether the equals signs stand in one column.
import {capacity, maximumDepth} from './kinds.ts'
import type {Random} from './random.ts'

// How a string is written.
// - any: on one line, between quotes, or between apostrophes when the layout prefers those and the text allows them.
// - basic: between quotes, e.g. "a\tb".
// - literal: between apostrophes, e.g. 'C:\logs'. The text holds no apostrophe and no control character but a tab.
// - lines: between three quotes, with the text's line feeds as they are, e.g. a paragraph.
// - continued: between three quotes, with a backslash before every line feed of the text, so that the value is one
//   line that is written on several.
// - literalLines: between three apostrophes, with the text's line feeds as they are.
export type StringForm = 'any' | 'basic' | 'literal' | 'lines' | 'continued' | 'literalLines'
// How an array is written: on one line, with one value per line, or on one line as long as the line stays short.
export type ArrayForm = 'auto' | 'oneLine' | 'lines'
export type Value =
  | {type: 'string', text: string, form: StringForm}
  // A number, a date, a time, true or false, written as given, e.g. 30_000, 0o640 or 1979-05-27T07:32:00Z. The
  // template `oddities` also writes strings, arrays and inline tables so.
  | {type: 'raw', text: string}
  // `notes` are comments: `after[2]` stands after the third value on its line, `above[2]` on a line of its own above
  // it. Both are written only when the array has one value per line.
  | {type: 'array', items: Value[], form: ArrayForm, after?: {[index: number]: string}, above?: {[index: number]: string}}
  | {type: 'inlineTable', entries: [key: string[], value: Value][]}

export type Entry =
  // A key and a value, with the comment after the value. `off` writes the line as a comment, e.g. `# timeout = "5s"`,
  // as config files do for a setting that is switched off.
  | {type: 'pair', key: string[], value: Value, note?: string, off?: boolean}
  // A comment on a line of its own.
  | {type: 'note', text: string}
  | {type: 'blank'}
  // A line that is written as given, for the template `oddities`.
  | {type: 'line', text: string}
export type Section = {
  // Comments on lines of their own above the header, or above the first entry when there is no header.
  notes?: string[]
  header?: {path: string[], array: boolean, note?: string}
  entries: Entry[]
}

export const templates = [
  'cargoManifest', 'cargoWorkspace', 'pyproject', 'formatterConfig', 'linterConfig', 'siteConfig', 'deployConfig', 'appSettings',
  'serverConfig', 'databaseConfig', 'featureFlags', 'translations', 'records', 'taskRunner', 'agentConfig', 'lockfile',
  'deepNesting', 'oddities',
] as const
export type Template = typeof templates[number]

const firstNames = ['Ada', 'Grace', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia', 'Zoë', 'José', 'Søren', 'Yuki', 'Amara', 'Tomás']
const lastNames = ['Lovelace', 'Hopper', 'Hamilton', 'Ritchie', 'Liskov', 'Perlman', 'Okafor', 'Souza', 'Nakamura', 'García', 'Müller', 'Kowalski', 'O\'Brien']
const projectWords = ['tiny', 'fast', 'harbor', 'glob', 'cache', 'router', 'queue', 'lint', 'fetch', 'atlas', 'ferry', 'beacon', 'ledger', 'relay', 'pilot', 'quill']
const organizations = ['acme', 'northwind', 'harbor-labs', 'ferrous', 'tidewater']
const crates = ['serde', 'tokio', 'anyhow', 'clap', 'regex', 'rand', 'log', 'thiserror', 'tracing', 'reqwest', 'chrono', 'uuid', 'bytes', 'futures', 'itertools', 'once_cell', 'serde_json', 'toml', 'walkdir', 'tempfile']
const crateFeatures = ['derive', 'full', 'std', 'rt', 'macros', 'json', 'serde', 'v4', 'rustls-tls', 'blocking', 'env', 'cargo', 'alloc']
const pythonPackages = ['requests', 'click', 'pydantic', 'numpy', 'httpx', 'rich', 'jinja2', 'sqlalchemy', 'pyyaml', 'attrs', 'tomli', 'typer']
const licenses = ['MIT', 'Apache-2.0', 'MIT OR Apache-2.0', 'BSD-3-Clause', 'MPL-2.0', 'ISC']
const regions = ['ams', 'fra', 'iad', 'sin', 'syd', 'gru']
const words = 'the harbor is quiet and an old ferry waits at the pier while gulls argue over something that washed up overnight a few early walkers pass the shuttered stalls on the way to an office or a train'.split(' ')
// Comments that fit next to any setting. Some hold what means something in TOML: a quote, a bracket, an equals sign, a #.
const generalNotes = [
  'default', 'optional', 'in seconds', 'in milliseconds', 'see the docs', 'do not change', 'TODO: revisit', 'required', 'was 3', 'keep in sync with CI',
  'e.g. "info" or "debug"', 'default: [] (none)', 'see https://example.com/docs#config', 'TODO(ada): remove after 2026-06', 'same as key = value above',
  '50% of requests', 'don\'t raise this', 'größer als 0', '→ see below', 'FIXME', 'not used yet', 'changed 2026-02-11', 'must match the server\'s value',
]

const pad2 = (value: number) => String(value).padStart(2, '0')
// A count from `least` to `most` that grows with the document's size.
const amount = (random: Random, size: number, least: number, most: number) => Math.min(most, least + Math.floor((most - least + 1) * size * (0.4 + 0.6 * random.next())))
// True more often in a large document than in a small one.
const often = (random: Random, size: number, probability: number) => random.chance(probability * (0.35 + 0.65 * size))
const pickSome = <Item>(random: Random, items: readonly Item[], count: number) => random.shuffled(items).slice(0, count)
const version = (random: Random) => `${random.integer(0, 9)}.${random.integer(0, 30)}.${random.integer(0, 99)}`
const requirement = (random: Random) => {
  const major = random.integer(0, 4)
  const minor = random.integer(0, 30)
  return random.weighted([[`${major}`, 2], [`${major}.${minor}`, 4], [`${major}.${minor}.${random.integer(0, 40)}`, 3], [`^${major}.${minor}`, 1], [`>=${major}.${minor}, <${major + 1}`, 1], ['*', 0.3]])
}
const projectName = (random: Random) => random.chance(0.75) ? `${random.pick(projectWords)}${random.pick(['-', '-', '_'])}${random.pick(projectWords)}` : random.pick(projectWords)
const person = (random: Random) => `${random.pick(firstNames)} ${random.pick(lastNames)}`
const email = (random: Random) => `${random.pick(firstNames).toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}@${random.pick(['example.com', 'example.org', 'harbor.dev'])}`
const hexDigits = (random: Random, count: number) => Array.from({length: count}, () => '0123456789abcdef'[random.integer(0, 15)]).join('')
const sentence = (random: Random, wordCount: number) => {
  const text = Array.from({length: wordCount}, () => random.pick(words)).join(' ')
  return `${text[0]!.toUpperCase()}${text.slice(1)}`
}
const day = (random: Random) => `20${random.integer(19, 27)}-${pad2(random.integer(1, 12))}-${pad2(random.integer(1, 28))}`
const clock = (random: Random) => `${pad2(random.integer(0, 23))}:${pad2(random.integer(0, 59))}:${pad2(random.integer(0, 59))}`
// A date with a time, in the forms that TOML has: with Z, with an offset, with a fraction, with a space in the place
// of the T, and without an offset.
const moment = (random: Random) => {
  const date = day(random)
  const time = clock(random)
  return random.weighted([
    [`${date}T${time}Z`, 5], [`${date}T${time}${random.pick(['+', '-'])}${pad2(random.integer(0, 12))}:${random.pick(['00', '30'])}`, 3],
    [`${date}T${time}.${random.integer(100, 999)}Z`, 2], [`${date} ${time}Z`, 1], [`${date}T${time}`, 2], [`${date} ${time}`, 1],
  ])
}

const text = (value: string, form: StringForm = 'any'): Value => ({type: 'string', text: value, form})
const raw = (value: string | number | boolean): Value => ({type: 'raw', text: String(value)})
const list = (items: Value[], form: ArrayForm = 'auto'): Value => ({type: 'array', items, form})
const texts = (values: readonly string[], form: ArrayForm = 'auto'): Value => list(values.map(value => text(value)), form)
const inline = (entries: [key: string | string[], value: Value][]): Value => ({type: 'inlineTable', entries: entries.map(([key, value]) => [typeof key === 'string' ? [key] : key, value])})
// A key given as a string is one part, e.g. 'opt-level'. A dotted key is given as its parts, e.g. ['serde', 'workspace'].
const pair = (key: string | string[], value: Value, note?: string): Entry => ({type: 'pair', key: typeof key === 'string' ? [key] : key, value, ...(note === undefined ? {} : {note})})
const off = (key: string, value: Value): Entry => ({type: 'pair', key: [key], value, off: true})
const note = (noteText: string): Entry => ({type: 'note', text: noteText})
const blank: Entry = {type: 'blank'}
// A section with a header, given as a path with dots, e.g. 'profile.release', or as its parts when a part holds a dot.
// Entries that are false or undefined are left out, so that a template can write `random.chance(0.5) && pair(…)`.
function table(path: string | string[] | undefined, entries: readonly (Entry | false | undefined)[], options: {array?: boolean, notes?: string[], note?: string} = {}): Section {
  const kept = entries.filter((entry): entry is Entry => entry !== false && entry !== undefined)
  const header = path === undefined ? undefined : {path: typeof path === 'string' ? path.split('.') : path, array: options.array === true, ...(options.note === undefined ? {} : {note: options.note})}
  return {...(options.notes === undefined ? {} : {notes: options.notes}), ...(header === undefined ? {} : {header}), entries: kept}
}

// Comments and empty lines among the entries of a section, as a person who edits a config file leaves them: a comment
// after a value, a comment on the line above an entry, a setting that is switched off, an empty line between two groups.
function annotated(random: Random, entries: readonly (Entry | false | undefined)[], notes: readonly string[], rate: number): Entry[] {
  const result: Entry[] = []
  for (const entry of entries) {
    if (entry === false || entry === undefined) continue
    if (entry.type !== 'pair' || entry.note !== undefined || entry.off === true) {
      result.push(entry)
      continue
    }
    const roll = random.next()
    if (roll < rate * 0.3) result.push(note(random.pick(notes)), entry)
    else if (roll < rate * 0.8) result.push({...entry, note: random.pick(notes)})
    else if (roll < rate * 0.9 && result.length > 0) result.push(blank, entry)
    else if (roll < rate && entry.value.type !== 'array') result.push({...entry, off: true})
    else result.push(entry)
  }
  return result
}

// A number as config files and data files write it: an integer, with underscores when it is large, a float, sometimes
// with an exponent or a sign.
const count = (random: Random, least: number, most: number) => raw(random.integer(least, most))
const grouped = (value: number) => String(value).replace(/\B(?=(\d{3})+$)/g, '_')
const float = (random: Random, most: number, digits: number) => raw((random.next() * most).toFixed(digits))

type Builder = (random: Random, size: number) => Section[]

const dependencyOf = (random: Random, crate: string): Entry => {
  const form = random.next()
  if (form < 0.45) return pair(crate, text(requirement(random)))
  if (form < 0.55) return pair(crate, inline([['path', text(`../${crate}`)]]))
  if (form < 0.65) return pair(crate, inline([['git', text(`https://github.com/${random.pick(organizations)}/${crate}`)], [random.pick(['branch', 'rev', 'tag']), text(random.pick(['main', hexDigits(random, 7), `v${version(random)}`]))]]))
  const entries: [string, Value][] = [['version', text(requirement(random))]]
  if (random.chance(0.7)) entries.push(['features', texts(pickSome(random, crateFeatures, random.integer(1, 3)), 'oneLine')])
  if (random.chance(0.25)) entries.push(['optional', raw(true)])
  if (random.chance(0.2)) entries.push(['default-features', raw(false)])
  return pair(crate, inline(entries))
}

const builders: Record<Template, Builder> = {
  // Cargo.toml of one crate.
  cargoManifest(random, size) {
    const name = projectName(random)
    const drawn = random.shuffled(crates)
    const notes = [...generalNotes, 'needed for the derive macros', 'pinned: 1.x breaks the build', 'only on nightly', 'MSRV']
    const sections = [table('package', annotated(random, [
      pair('name', text(name)),
      pair('version', text(version(random))),
      random.chance(0.85) && pair('edition', text(random.pick(['2018', '2021', '2021', '2024']))),
      often(random, size, 0.5) && pair('authors', texts(Array.from({length: random.integer(1, 2)}, () => `${person(random)} <${email(random)}>`))),
      often(random, size, 0.6) && pair('description', text(`${sentence(random, random.integer(3, 7))}.`)),
      often(random, size, 0.6) && pair('license', text(random.pick(licenses))),
      often(random, size, 0.4) && pair('repository', text(`https://github.com/${random.pick(organizations)}/${name}`)),
      often(random, size, 0.3) && pair('rust-version', text(`1.${random.integer(56, 84)}`)),
      often(random, size, 0.3) && pair('keywords', texts(pickSome(random, projectWords, random.integer(1, 4)), 'oneLine')),
      random.chance(0.15) && pair('publish', raw(false)),
      random.chance(0.15) && pair('build', text('build.rs')),
    ], notes, 0.12))]
    sections.push(table('dependencies', annotated(random, drawn.slice(0, amount(random, size, 1, 7)).map(crate => dependencyOf(random, crate)), notes, 0.15)))
    if (often(random, size, 0.5)) sections.push(table('dev-dependencies', drawn.slice(8, 8 + random.integer(1, 3)).map(crate => dependencyOf(random, crate))))
    if (often(random, size, 0.2)) sections.push(table(['target', random.pick(['cfg(unix)', 'cfg(windows)', 'cfg(target_os = "linux")', 'x86_64-pc-windows-msvc']), 'dependencies'], [dependencyOf(random, drawn[12]!)]))
    if (often(random, size, 0.45)) {
      const features = pickSome(random, ['std', 'serde', 'cli', 'unstable', 'tls', 'json'], random.integer(1, 4))
      sections.push(table('features', annotated(random, [
        pair('default', texts(features.slice(0, random.integer(0, 2)), 'oneLine')),
        ...features.map(feature => pair(feature, texts(random.chance(0.5) ? [] : [random.pick([`dep:${drawn[0]}`, `${drawn[0]}/std`, random.pick(features)])], 'oneLine'))),
      ], notes, 0.1)))
    }
    if (often(random, size, 0.4)) {
      sections.push(table(`profile.${random.pick(['release', 'release', 'dev', 'bench'])}`, annotated(random, [
        random.chance(0.8) && pair('opt-level', random.chance(0.7) ? count(random, 0, 3) : text(random.pick(['s', 'z']))),
        random.chance(0.6) && pair('lto', random.chance(0.6) ? raw(true) : text(random.pick(['thin', 'fat']))),
        random.chance(0.5) && pair('codegen-units', raw(random.pick([1, 4, 16]))),
        random.chance(0.4) && pair('debug', random.chance(0.5) ? raw(random.chance(0.5)) : count(random, 0, 2)),
        random.chance(0.3) && pair('panic', text('abort')),
        random.chance(0.3) && pair('strip', raw(true)),
        pair('incremental', raw(random.chance(0.5))),
      ], notes, 0.25)))
    }
    if (often(random, size, 0.3)) {
      for (let index = random.integer(1, 2); index > 0; index--) {
        const binary = `${random.pick(projectWords)}${index}`
        sections.push(table(random.pick(['bin', 'bin', 'example', 'bench']), [pair('name', text(binary)), pair('path', text(`src/bin/${binary}.rs`)), random.chance(0.3) && pair('required-features', texts(['cli'], 'oneLine'))], {array: true}))
      }
    }
    if (often(random, size, 0.15)) sections.push(table('package.metadata.docs.rs', [pair('all-features', raw(true)), random.chance(0.5) && pair('rustdoc-args', texts(['--cfg', 'docsrs']))]))
    return sections
  },

  // Cargo.toml of a workspace's root, or of a crate that takes its settings from the workspace with dotted keys.
  cargoWorkspace(random, size) {
    const drawn = random.shuffled(crates)
    const members = pickSome(random, ['core', 'cli', 'server', 'macros', 'utils', 'bench', 'xtask'], amount(random, size, 2, 6))
    const notes = [...generalNotes, 'the binary', 'shared by every crate', 'keep sorted']
    if (random.chance(0.3)) {
      // A member crate.
      const inherited = pickSome(random, ['version', 'edition', 'license', 'authors', 'repository', 'rust-version'], random.integer(1, 5))
      const sections = [table('package', [pair('name', text(`${random.pick(projectWords)}-${random.pick(members)}`)), ...inherited.map(key => pair([key, 'workspace'], raw(true))), random.chance(0.3) && pair('publish', raw(false))])]
      sections.push(table('dependencies', annotated(random, drawn.slice(0, amount(random, size, 2, 7)).map(crate =>
        random.chance(0.6) ? pair([crate, 'workspace'], raw(true)) : pair(crate, inline([['workspace', raw(true)], ['features', texts(pickSome(random, crateFeatures, random.integer(1, 2)), 'oneLine')]]))), notes, 0.1)))
      if (often(random, size, 0.5)) sections.push(table('lints', [pair('workspace', raw(true))]))
      return sections
    }
    const memberPaths = members.map(member => `crates/${member}`)
    const membersValue = texts(random.chance(0.3) ? ['crates/*'] : memberPaths, random.chance(0.7) ? 'lines' : 'auto')
    if (membersValue.type === 'array' && random.chance(0.3)) membersValue.after = {[random.integer(0, membersValue.items.length - 1)]: random.pick(notes)}
    if (membersValue.type === 'array' && random.chance(0.2)) membersValue.above = {[random.integer(0, membersValue.items.length - 1)]: random.pick(notes)}
    const sections = [table('workspace', [
      random.chance(0.8) && pair('resolver', text(random.pick(['2', '2', '3']))),
      pair('members', membersValue),
      often(random, size, 0.3) && pair('exclude', texts([random.pick(['examples/old', 'fuzz', 'target'])], 'oneLine')),
      often(random, size, 0.2) && pair('default-members', texts([memberPaths[0]!], 'oneLine')),
    ])]
    if (often(random, size, 0.6)) {
      sections.push(table('workspace.package', annotated(random, [
        pair('version', text(version(random))), pair('edition', text(random.pick(['2021', '2024']))),
        random.chance(0.6) && pair('license', text(random.pick(licenses))), random.chance(0.4) && pair('authors', texts([`${person(random)} <${email(random)}>`])),
      ], notes, 0.1)))
    }
    sections.push(table('workspace.dependencies', annotated(random, [
      ...drawn.slice(0, amount(random, size, 1, 5)).map(crate => dependencyOf(random, crate)),
      random.chance(0.5) && pair(`${random.pick(projectWords)}-${members[0]}`, inline([['path', text(memberPaths[0]!)]])),
    ], notes, 0.12)))
    if (often(random, size, 0.35)) sections.push(table('workspace.lints.rust', [pair('unsafe_code', text(random.pick(['forbid', 'deny']))), random.chance(0.5) && pair('missing_docs', text('warn'))]))
    if (often(random, size, 0.35)) {
      sections.push(table('workspace.lints.clippy', pickSome(random, ['unwrap_used', 'todo', 'dbg_macro', 'pedantic'], random.integer(1, 3)).map(lint =>
        random.chance(0.75) ? pair(lint, text(random.pick(['warn', 'deny', 'allow']))) : pair(lint, inline([['level', text('warn')], ['priority', raw(-1)]])))))
    }
    if (often(random, size, 0.3)) sections.push(table('profile.dev', [pair('opt-level', count(random, 0, 1)), random.chance(0.4) && pair('debug', raw(true))]))
    if (often(random, size, 0.25)) sections.push(table(['profile', 'dev', 'package', random.pick(['*', drawn[9]!])], [pair('opt-level', count(random, 2, 3))]))
    if (often(random, size, 0.2)) sections.push(table('patch.crates-io', [pair(drawn[10]!, inline([['git', text(`https://github.com/${random.pick(organizations)}/${drawn[10]}`)], ['branch', text('main')]]))]))
    return sections
  },

  // pyproject.toml: the build system, the project and the tables of tools.
  pyproject(random, size) {
    const name = projectName(random)
    const packages = random.shuffled(pythonPackages)
    const notes = [...generalNotes, 'PEP 621', 'needs python >= 3.9', 'dev only']
    const requires = (packageName: string) => random.weighted([
      [text(`${packageName}>=${random.integer(0, 8)}.${random.integer(0, 30)}`), 5], [text(`${packageName}~=${random.integer(1, 8)}.${random.integer(0, 9)}`), 2], [text(packageName), 3],
      [text(`${packageName}; python_version < "3.11"`, 'literal'), 1], [text(`${packageName}[${random.pick(['standard', 'cli', 'all'])}]==${version(random)}`), 1.5],
    ])
    const sections: Section[] = []
    if (random.chance(0.8)) {
      const [requirements, backend] = random.pick<[string[], string]>([
        [['setuptools>=61.0', 'wheel'], 'setuptools.build_meta'], [['hatchling'], 'hatchling.build'], [['poetry-core>=1.0.0'], 'poetry.core.masonry.api'], [['flit_core >=3.2,<4'], 'flit_core.buildapi'],
      ])
      sections.push(table('build-system', [pair('requires', texts(requirements, 'oneLine')), pair('build-backend', text(backend))]))
    }
    const authors = list(Array.from({length: random.integer(1, 2)}, () => inline([['name', text(person(random))], ['email', text(email(random))]])))
    sections.push(table('project', annotated(random, [
      pair('name', text(name)),
      random.chance(0.85) ? pair('version', text(version(random))) : pair('dynamic', texts(['version'], 'oneLine')),
      often(random, size, 0.6) && pair('description', text(`${sentence(random, random.integer(3, 7))}.`)),
      often(random, size, 0.5) && pair('readme', text('README.md')),
      random.chance(0.7) && pair('requires-python', text(`>=3.${random.integer(8, 13)}`)),
      often(random, size, 0.4) && pair('license', random.chance(0.5) ? inline([[random.pick(['text', 'file']), text(random.pick(['MIT', 'LICENSE']))]]) : text(random.pick(licenses))),
      often(random, size, 0.5) && pair('authors', authors),
      often(random, size, 0.25) && pair('classifiers', texts(pickSome(random, ['Programming Language :: Python :: 3', 'License :: OSI Approved :: MIT License', 'Operating System :: OS Independent', 'Typing :: Typed'], random.integer(1, 3)), 'lines')),
      pair('dependencies', list(packages.slice(0, amount(random, size, 1, 6)).map(requires), random.chance(0.7) ? 'lines' : 'auto')),
    ], notes, 0.08)))
    if (often(random, size, 0.5)) {
      sections.push(table('project.optional-dependencies', pickSome(random, ['dev', 'test', 'docs', 'lint'], random.integer(1, 3)).map(group =>
        pair(group, list(packages.slice(6, 6 + random.integer(1, 3)).map(requires))))))
    }
    if (often(random, size, 0.35)) sections.push(table('project.scripts', [pair(name, text(`${name.replaceAll('-', '_')}.cli:main`))]))
    if (often(random, size, 0.3)) {
      sections.push(table('project.urls', [
        pair('Homepage', text(`https://${name}.example.org`)), random.chance(0.6) && pair('Bug Tracker', text(`https://github.com/${random.pick(organizations)}/${name}/issues`)),
        random.chance(0.4) && pair('Documentation', text(`https://${name}.readthedocs.io`)),
      ]))
    }
    if (often(random, size, 0.5)) {
      sections.push(table('tool.pytest.ini_options', annotated(random, [
        random.chance(0.5) && pair('minversion', text(`${random.integer(6, 8)}.0`)), pair('addopts', text(random.pick(['-ra -q', '--strict-markers --tb=short', '-x --ff']))),
        pair('testpaths', texts(pickSome(random, ['tests', 'integration', 'src'], random.integer(1, 2)), 'oneLine')),
        random.chance(0.3) && pair('markers', texts(['slow: marks tests as slow (deselect with \'-m "not slow"\')', 'network'], 'lines')),
      ], notes, 0.15)))
    }
    if (often(random, size, 0.4)) sections.push(table('tool.mypy', [pair('strict', raw(random.chance(0.7))), random.chance(0.6) && pair('python_version', text(`3.${random.integer(8, 13)}`)), random.chance(0.4) && pair('warn_unused_ignores', raw(true))]))
    if (often(random, size, 0.25)) sections.push(table('tool.coverage.run', [pair('branch', raw(true)), pair('source', texts(['src'], 'oneLine')), random.chance(0.4) && pair('omit', texts(['*/tests/*', '*/__main__.py']))]))
    if (often(random, size, 0.2)) sections.push(table('tool.setuptools.packages.find', [pair('where', texts(['src'], 'oneLine'))]))
    return sections
  },

  // The config of a formatter: rustfmt.toml, taplo.toml, or the table of black in a pyproject.
  formatterConfig(random, size) {
    const notes = [...generalNotes, 'the team voted for this', 'matches .editorconfig', 'nightly only']
    const variant = random.integer(0, 2)
    if (variant === 0) {
      const settings: Entry[] = [
        pair('max_width', raw(random.pick([80, 100, 120]))), pair('hard_tabs', raw(random.chance(0.2))), pair('tab_spaces', raw(random.pick([2, 4]))),
        pair('newline_style', text(random.pick(['Unix', 'Auto', 'Native']))), pair('use_small_heuristics', text(random.pick(['Default', 'Max', 'Off']))),
        pair('edition', text(random.pick(['2018', '2021', '2024']))), pair('imports_granularity', text(random.pick(['Crate', 'Module', 'Item']))),
        pair('group_imports', text('StdExternalCrate')), pair('reorder_imports', raw(true)), pair('wrap_comments', raw(random.chance(0.5))), pair('comment_width', raw(random.pick([80, 100]))),
        pair('format_code_in_doc_comments', raw(true)), pair('use_field_init_shorthand', raw(true)), pair('ignore', texts(pickSome(random, ['src/generated', 'vendor', 'tests/fixtures'], random.integer(1, 2)))),
        pair('unstable_features', raw(random.chance(0.5))), pair('fn_params_layout', text(random.pick(['Tall', 'Compressed', 'Vertical']))),
      ]
      const kept = settings.filter(() => often(random, size, 0.7))
      return [table(undefined, annotated(random, kept.length >= 2 ? kept : settings.slice(0, 3), notes, 0.25), random.chance(0.3) ? {notes: [random.pick(['rustfmt.toml', 'Formatting for the whole workspace.', 'See https://rust-lang.github.io/rustfmt/'])]} : {})]
    }
    if (variant === 1) {
      const sections = [table(undefined, [
        pair('include', texts(pickSome(random, ['**/*.toml', 'Cargo.toml', 'config/*.toml'], random.integer(1, 2)), 'oneLine')),
        random.chance(0.6) && pair('exclude', texts(pickSome(random, ['target/**', '**/node_modules/**', 'vendor/**'], random.integer(1, 2)))),
      ])]
      sections.push(table('formatting', annotated(random, [
        pair('align_entries', raw(random.chance(0.3))), pair('column_width', raw(random.pick([80, 100, 120]))), random.chance(0.6) && pair('indent_string', text(random.pick(['  ', '    ', '\t']))),
        random.chance(0.6) && pair('reorder_keys', raw(random.chance(0.5))), random.chance(0.5) && pair('array_trailing_comma', raw(true)), random.chance(0.4) && pair('compact_inline_tables', raw(false)),
        random.chance(0.4) && pair('allowed_blank_lines', count(random, 1, 3)), random.chance(0.3) && pair('crlf', raw(false)),
      ], notes, 0.2)))
      for (let rules = amount(random, size, 0, 2); rules > 0; rules--) {
        sections.push(table('rule', [pair('include', texts([random.pick(['**/Cargo.toml', 'pyproject.toml', 'config/**'])], 'oneLine')), random.chance(0.6) && pair('keys', texts(pickSome(random, ['dependencies', 'dev-dependencies', 'tool.ruff'], random.integer(1, 2)), 'oneLine'))], {array: true}))
        sections.push(table('rule.formatting', [pair('reorder_keys', raw(true)), random.chance(0.4) && pair('align_entries', raw(true))]))
      }
      return sections
    }
    const excluded = pickSome(random, ['\\.git', '\\.venv', 'build', 'dist', 'migrations', '_build', 'node_modules'], amount(random, size, 2, 6))
    const sections = [table('tool.black', annotated(random, [
      pair('line-length', raw(random.pick([79, 88, 100, 120]))),
      random.chance(0.7) && pair('target-version', list(pickSome(random, ['py39', 'py310', 'py311', 'py312'], random.integer(1, 3)).map(target => text(target, random.chance(0.6) ? 'literal' : 'any')), 'oneLine')),
      random.chance(0.4) && pair('skip-string-normalization', raw(true)),
      random.chance(0.3) && pair('preview', raw(random.chance(0.5))),
      pair(random.pick(['extend-exclude', 'exclude']), text(`/(\n${excluded.map((path, index) => `${index === 0 ? '    ' : '  | '}${path}`).join('\n')}\n)/\n`, 'literalLines')),
    ], notes, 0.15))]
    if (often(random, size, 0.5)) {
      sections.push(table('tool.isort', [pair('profile', text('black')), random.chance(0.5) && pair('line_length', raw(random.pick([88, 100]))), random.chance(0.5) && pair('known_first_party', texts([random.pick(projectWords)], 'oneLine')),
        random.chance(0.3) && pair('skip_glob', texts(['*/migrations/*'], 'oneLine'))]))
    }
    return sections
  },

  // The config of a linter: ruff.toml, clippy.toml or typos.toml.
  linterConfig(random, size) {
    const notes = [...generalNotes, 'too noisy', 'E501: line too long', 'allow in tests', 'see ADR-12']
    const variant = random.integer(0, 2)
    if (variant === 0) {
      const rules = random.shuffled(['E', 'F', 'I', 'B', 'UP', 'N', 'S', 'C4', 'SIM', 'RUF', 'D', 'PL'])
      const sections = [table(undefined, annotated(random, [
        pair('line-length', raw(random.pick([88, 100, 120]))), random.chance(0.7) && pair('target-version', text(`py3${random.integer(8, 13)}`)),
        often(random, size, 0.5) && pair('extend-exclude', texts(pickSome(random, ['migrations', 'build', '.venv', 'docs/conf.py'], random.integer(1, 3)))), random.chance(0.2) && pair('fix', raw(true)),
      ], notes, 0.12))]
      const selected = list(rules.slice(0, amount(random, size, 2, 7)).map(rule => text(rule)), random.chance(0.3) ? 'lines' : 'auto')
      if (selected.type === 'array' && random.chance(0.4)) selected.after = {[random.integer(0, selected.items.length - 1)]: random.pick(['pycodestyle', 'isort', 'flake8-bugbear', 'pyupgrade'])}
      sections.push(table('lint', annotated(random, [
        pair('select', selected),
        random.chance(0.7) && pair('ignore', texts(pickSome(random, ['E501', 'D203', 'D213', 'S101', 'B008', 'PLR0913'], random.integer(1, 3)))),
        random.chance(0.3) && pair('fixable', texts(['ALL'], 'oneLine')),
        random.chance(0.3) && pair('dummy-variable-rgx', text('^(_+|(_+[a-zA-Z0-9_]*[a-zA-Z0-9]+?))$', random.chance(0.8) ? 'literal' : 'basic')),
      ], notes, 0.15)))
      if (often(random, size, 0.6)) {
        sections.push(table('lint.per-file-ignores', pickSome(random, ['__init__.py', 'tests/**/*.py', 'scripts/*', 'docs/conf.py', '**/{tests,docs}/*'], random.integer(1, 3)).map(glob =>
          pair(glob, texts(pickSome(random, ['F401', 'S101', 'D', 'E402', 'T201'], random.integer(1, 2)), 'oneLine')))))
      }
      if (often(random, size, 0.35)) sections.push(table('lint.isort', [pair('known-first-party', texts([random.pick(projectWords)], 'oneLine')), random.chance(0.4) && pair('combine-as-imports', raw(true))]))
      if (often(random, size, 0.25)) sections.push(table('lint.mccabe', [pair('max-complexity', raw(random.integer(8, 15)))]))
      if (often(random, size, 0.4)) sections.push(table('format', [pair('quote-style', text(random.pick(['double', 'single']))), random.chance(0.5) && pair('indent-style', text('space')), random.chance(0.3) && pair('docstring-code-format', raw(true))]))
      return sections
    }
    if (variant === 1) {
      const disallowed = pickSome(random, ['std::env::var', 'std::process::exit', 'std::thread::sleep', 'core::mem::forget'], amount(random, size, 1, 3))
      return [table(undefined, annotated(random, [
        pair('msrv', text(`1.${random.integer(60, 84)}`)),
        random.chance(0.6) && pair('cognitive-complexity-threshold', raw(random.integer(15, 40))),
        random.chance(0.5) && pair('too-many-arguments-threshold', raw(random.integer(6, 10))),
        random.chance(0.4) && pair('type-complexity-threshold', raw(random.pick([250, 300, 500]))),
        random.chance(0.4) && pair('avoid-breaking-exported-api', raw(false)),
        random.chance(0.4) && pair('allow-unwrap-in-tests', raw(true)),
        random.chance(0.4) && pair('doc-valid-idents', texts(pickSome(random, ['GitHub', 'PostgreSQL', 'OAuth', '..'], random.integer(1, 3)), 'oneLine')),
        pair('disallowed-methods', list(disallowed.map(path => random.chance(0.6) ? inline([['path', text(path)], ['reason', text(random.pick(['use the config module', 'return an error instead', 'not in async code']))]]) : text(path)), 'lines')),
      ], notes, 0.2), random.chance(0.3) ? {notes: ['clippy.toml']} : {})]
    }
    const typos = pickSome<[string, string]>(random, [['teh', 'the'], ['recieve', 'receive'], ['seperate', 'separate'], ['mosty', 'mostly'], ['ba', 'ba'], ['hte', 'the']], amount(random, size, 1, 4))
    const sections = [table('files', [pair('extend-exclude', texts(pickSome(random, ['*.lock', '*.svg', 'vendor/', 'CHANGELOG.md'], random.integer(1, 3)))), random.chance(0.3) && pair('ignore-hidden', raw(false))])]
    sections.push(table('default.extend-words', annotated(random, typos.map(([wrong, right]) => pair(wrong, text(right))), notes, 0.2)))
    if (often(random, size, 0.5)) sections.push(table('default', [pair('extend-ignore-re', list([text('(?Rm)^.*#\\s*spellchecker:disable-line$', 'literal'), random.chance(0.5) ? text('[0-9a-f]{7,40}', 'literal') : text('\\b[A-Z]{2,5}\\b')], 'lines'))]))
    if (often(random, size, 0.3)) sections.push(table(['type', 'py', 'extend-identifiers'], [pair('arange', text('arange'))]))
    return sections
  },

  // The config of a static site generator, or the front matter of one of its pages.
  siteConfig(random, size) {
    const notes = [...generalNotes, 'shown in the footer', 'no trailing slash', 'used by the RSS feed']
    const title = `${random.pick(['Harbor', 'Quiet', 'Field', 'Tide'])} ${random.pick(['Notes', 'Log', 'Journal', 'Docs'])}`
    const languageNames: Record<string, string> = {en: 'English', pt: 'Português', de: 'Deutsch', ja: '日本語'}
    if (random.chance(0.3)) {
      // The front matter of a page.
      const sections = [table(undefined, annotated(random, [
        pair('title', text(sentence(random, random.integer(2, 5)))), pair('date', raw(random.chance(0.7) ? moment(random) : day(random))),
        random.chance(0.4) && pair('lastmod', raw(day(random))), pair('draft', raw(random.chance(0.3))),
        random.chance(0.7) && pair('tags', texts(pickSome(random, ['notes', 'travel', 'rust', 'release', 'howto'], random.integer(1, 3)), 'oneLine')),
        random.chance(0.4) && pair('weight', raw(random.integer(1, 50))), random.chance(0.4) && pair('slug', text(`${random.pick(projectWords)}-${random.pick(projectWords)}`)),
        random.chance(0.4) && pair('summary', text(`${sentence(random, random.integer(5, 10))}.`)),
      ], notes, 0.1))]
      if (often(random, size, 0.5)) sections.push(table('extra', [pair('toc', raw(true)), random.chance(0.5) && pair('author', text(person(random))), random.chance(0.4) && pair('image', inline([['src', text('/img/cover.jpg')], ['alt', text(sentence(random, 3))]]))]))
      return sections
    }
    const sections = [table(undefined, annotated(random, [
      pair(random.pick(['baseURL', 'base_url']), text(`https://${random.pick(['example.org', 'notes.example.com', 'harbor.dev'])}/`)),
      pair('title', text(title)), random.chance(0.6) && pair('languageCode', text(random.pick(['en-us', 'en-gb', 'pt-br', 'de']))),
      random.chance(0.5) && pair('theme', random.chance(0.7) ? text(random.pick(['ananke', 'papermod', 'even'])) : texts(['docsy', 'base'], 'oneLine')),
      random.chance(0.4) && pair('paginate', raw(random.pick([5, 10, 20]))), random.chance(0.3) && pair('enableRobotsTXT', raw(true)),
      random.chance(0.3) && pair('buildDrafts', raw(false)), random.chance(0.3) && pair('compile_sass', raw(true)), random.chance(0.2) && pair('timeout', text('30s')),
    ], notes, 0.15))]
    if (often(random, size, 0.7)) {
      sections.push(table(random.pick(['params', 'extra']), annotated(random, [
        pair('author', text(person(random))), random.chance(0.6) && pair('description', text(`${sentence(random, random.integer(4, 8))}.`)),
        random.chance(0.4) && pair('dateFormat', text('2 January 2006')), random.chance(0.5) && pair('showReadingTime', raw(true)),
        random.chance(0.3) && pair('accent', text(`#${hexDigits(random, 6)}`)), random.chance(0.3) && pair('social', inline([['github', text(random.pick(organizations))], ['mastodon', text('@notes@example.social')]])),
      ], notes, 0.15)))
    }
    for (let index = 0, items = amount(random, size, 0, 3); index < items; index++) {
      const page = random.pick(['Home', 'Posts', 'About', 'Tags', 'Archive'])
      sections.push(table('menu.main', [pair('name', text(page)), pair('url', text(page === 'Home' ? '/' : `/${page.toLowerCase()}/`)), random.chance(0.8) && pair('weight', raw((index + 1) * 10))], {array: true}))
    }
    if (often(random, size, 0.3)) sections.push(table('markup.goldmark.renderer', [pair('unsafe', raw(true))]))
    if (often(random, size, 0.3)) sections.push(table('taxonomies', [pair('tag', text('tags')), random.chance(0.6) && pair('category', text('categories'))]))
    if (often(random, size, 0.3)) for (const language of pickSome(random, ['en', 'pt', 'de', 'ja'], random.integer(1, 2))) sections.push(table(`languages.${language}`, [pair('languageName', text(languageNames[language]!)), pair('weight', raw(random.integer(1, 3)))]))
    return sections
  },

  // The config of a deploy: fly.toml, netlify.toml or wrangler.toml.
  deployConfig(random, size) {
    const notes = [...generalNotes, 'closest to most users', 'set in the dashboard too', 'health check path']
    const app = projectName(random)
    const variant = random.integer(0, 2)
    if (variant === 0) {
      const sections = [table(undefined, annotated(random, [
        pair('app', text(app)), pair('primary_region', text(random.pick(regions))),
        random.chance(0.4) && pair('kill_signal', text(random.pick(['SIGINT', 'SIGTERM']))), random.chance(0.4) && pair('kill_timeout', random.chance(0.5) ? text('5s') : raw(random.integer(5, 120))),
      ], notes, 0.15), random.chance(0.4) ? {notes: [`fly.toml app configuration file generated for ${app} on ${moment(random)}`]} : {})]
      if (often(random, size, 0.5)) sections.push(table('build', [random.chance(0.6) ? pair('dockerfile', text('Dockerfile')) : pair('image', text(`registry.example.com/${app}:${version(random)}`))]))
      if (often(random, size, 0.6)) sections.push(table('env', annotated(random, pickSome<[string, string]>(random, [['PORT', '8080'], ['LOG_LEVEL', 'info'], ['NODE_ENV', 'production'], ['RAILS_ENV', 'production'], ['TZ', 'UTC']], random.integer(1, 3)).map(([key, value]) => pair(key, text(value))), notes, 0.15)))
      if (random.chance(0.6)) {
        sections.push(table('http_service', annotated(random, [
          pair('internal_port', raw(random.pick([3000, 8000, 8080]))), pair('force_https', raw(true)), random.chance(0.6) && pair('auto_stop_machines', random.chance(0.5) ? raw(true) : text('stop')),
          random.chance(0.6) && pair('auto_start_machines', raw(true)), random.chance(0.6) && pair('min_machines_running', raw(random.integer(0, 2))), random.chance(0.4) && pair('processes', texts(['app'], 'oneLine')),
        ], notes, 0.15)))
      } else {
        sections.push(table('services', [pair('protocol', text('tcp')), pair('internal_port', raw(random.pick([3000, 8080])))], {array: true}))
        for (const port of pickSome(random, [80, 443], random.integer(1, 2))) sections.push(table('services.ports', [pair('port', raw(port)), pair('handlers', texts(port === 80 ? ['http'] : ['tls', 'http'], 'oneLine'))], {array: true}))
        if (often(random, size, 0.5)) sections.push(table('services.concurrency', [pair('type', text('connections')), pair('hard_limit', raw(random.pick([25, 50, 100]))), pair('soft_limit', raw(20))]))
      }
      if (often(random, size, 0.4)) sections.push(table('vm', [pair('memory', text(random.pick(['256mb', '512mb', '1gb']))), pair('cpu_kind', text('shared')), pair('cpus', raw(random.pick([1, 2, 4])))], {array: true}))
      return sections
    }
    if (variant === 1) {
      const sections = [table('build', annotated(random, [pair('command', text(random.pick(['npm run build', 'hugo --minify', 'pnpm build && pnpm export']))), pair('publish', text(random.pick(['dist', 'public', 'out']))), random.chance(0.4) && pair('functions', text('netlify/functions'))], notes, 0.15))]
      if (often(random, size, 0.5)) sections.push(table('build.environment', [pair('NODE_VERSION', text(String(random.pick([18, 20, 22])))), random.chance(0.4) && pair('HUGO_VERSION', text(`0.${random.integer(110, 140)}.0`))]))
      for (let redirects = amount(random, size, 1, 3); redirects > 0; redirects--) {
        sections.push(table('redirects', [
          pair('from', text(random.pick(['/api/*', '/old/*', '/blog/:slug', '/*']))), pair('to', text(random.pick(['/.netlify/functions/:splat', '/new/:splat', '/index.html', 'https://example.com/:splat']))),
          pair('status', raw(random.pick([200, 301, 302]))), random.chance(0.3) && pair('force', raw(true)), random.chance(0.2) && pair('conditions', inline([['Country', texts(['PT', 'BR'], 'oneLine')]])),
        ], {array: true}))
      }
      if (often(random, size, 0.4)) {
        sections.push(table('headers', [pair('for', text('/*'))], {array: true}))
        sections.push(table('headers.values', [pair('X-Frame-Options', text('DENY')), random.chance(0.6) && pair('Cache-Control', text('public, max-age=31536000, immutable')), random.chance(0.4) && pair('Content-Security-Policy', text('default-src \'self\'; img-src *'))]))
      }
      if (often(random, size, 0.3)) sections.push(table('context.production.environment', [pair('API_URL', text('https://api.example.com'))]))
      return sections
    }
    const sections = [table(undefined, annotated(random, [
      pair('name', text(app)), pair('main', text(random.pick(['src/index.ts', 'src/worker.js']))), pair('compatibility_date', text(day(random))),
      random.chance(0.4) && pair('workers_dev', raw(false)), random.chance(0.4) && pair('compatibility_flags', texts(['nodejs_compat'], 'oneLine')),
      random.chance(0.5) && pair('routes', list([inline([['pattern', text('example.com/*')], ['zone_name', text('example.com')]])], random.chance(0.5) ? 'lines' : 'oneLine')),
      often(random, size, 0.5) && pair('kv_namespaces', list(pickSome(random, ['CACHE', 'SESSIONS', 'FLAGS'], random.integer(1, 2)).map(binding => inline([['binding', text(binding)], ['id', text(hexDigits(random, 32))]])), 'lines')),
    ], notes, 0.12))]
    if (often(random, size, 0.6)) sections.push(table('vars', pickSome<[string, Value]>(random, [['ENVIRONMENT', text('production')], ['API_HOST', text('api.example.com')], ['MAX_ITEMS', text('50')], ['DEBUG', text('false')]], random.integer(1, 3)).map(([key, value]) => pair(key, value))))
    if (often(random, size, 0.4)) sections.push(table('triggers', [pair('crons', texts(pickSome(random, ['0 * * * *', '*/15 * * * *', '0 3 * * 1'], random.integer(1, 2)), 'oneLine'))]))
    if (often(random, size, 0.3)) sections.push(table('d1_databases', [pair('binding', text('DB')), pair('database_name', text(`${app}-db`)), pair('database_id', text(`${hexDigits(random, 8)}-${hexDigits(random, 4)}-${hexDigits(random, 4)}-${hexDigits(random, 4)}-${hexDigits(random, 12)}`))], {array: true}))
    if (often(random, size, 0.3)) sections.push(table('env.staging', [pair('name', text(`${app}-staging`)), random.chance(0.5) && pair('vars', inline([['ENVIRONMENT', text('staging')]]))]))
    return sections
  },

  // The settings of an app that a person edits by hand: a terminal, an editor, or a shell prompt.
  appSettings(random, size) {
    const notes = [...generalNotes, 'my laptop only', 'hex color', 'needs a restart', 'was "block"']
    const color = () => text(`#${hexDigits(random, 6)}`)
    const variant = random.integer(0, 2)
    if (variant === 0) {
      const sections = [table('window', annotated(random, [
        random.chance(0.6) && pair('opacity', float(random, 1, 2)), random.chance(0.5) && pair('decorations', text(random.pick(['full', 'none', 'buttonless']))),
        random.chance(0.5) && pair('dynamic_title', raw(true)), random.chance(0.6) && pair('padding', inline([['x', count(random, 0, 16)], ['y', count(random, 0, 16)]])),
        pair('dimensions', inline([['columns', count(random, 80, 200)], ['lines', count(random, 24, 60)]])),
      ], notes, 0.15))]
      if (often(random, size, 0.7)) sections.push(table('font', [pair('size', raw(random.pick(['11.0', '12', '13.5', '14']))), pair('normal', inline([['family', text(random.pick(['JetBrains Mono', 'Fira Code', 'Iosevka Term', 'Berkeley Mono']))], ['style', text('Regular')]])), random.chance(0.3) && pair('offset', inline([['x', raw(0)], ['y', raw(random.pick([-1, 0, 1, '+2']))]]))]))
      if (often(random, size, 0.6)) sections.push(table('colors.primary', annotated(random, [pair('background', color()), pair('foreground', color()), random.chance(0.3) && pair('dim_foreground', color())], notes, 0.15)))
      if (often(random, size, 0.3)) sections.push(table('colors.normal', pickSome(random, ['black', 'red', 'green', 'yellow', 'blue'], random.integer(2, 4)).map(name => pair(name, random.chance(0.8) ? color() : text(`0x${hexDigits(random, 6)}`)))))
      if (often(random, size, 0.3)) sections.push(table('cursor.style', [pair('shape', text(random.pick(['Block', 'Beam', 'Underline']))), pair('blinking', text(random.pick(['On', 'Off'])))]))
      for (let bindings = amount(random, size, 0, 3); bindings > 0; bindings--) {
        sections.push(table('keyboard.bindings', [
          pair('key', text(random.pick(['N', 'V', 'Return', 'F11', 'Plus']))), random.chance(0.8) && pair('mods', text(random.pick(['Control|Shift', 'Control', 'Command', 'Alt']))),
          random.chance(0.6) ? pair('action', text(random.pick(['SpawnNewInstance', 'Paste', 'ToggleFullscreen', 'IncreaseFontSize']))) : pair('chars', text(random.pick(['\u001b[13;2u', '\u0016', '\u001bb', '\\x1b']), 'basic')),
        ], {array: true}))
      }
      return sections
    }
    if (variant === 1) {
      const sections = [table(undefined, [pair('theme', text(random.pick(['onedark', 'gruvbox', 'catppuccin_mocha', 'base16_default'])))])]
      sections.push(table('editor', annotated(random, [
        random.chance(0.7) && pair('line-number', text(random.pick(['relative', 'absolute']))), random.chance(0.5) && pair('mouse', raw(false)),
        random.chance(0.5) && pair('rulers', list(pickSome(random, [80, 100, 120], random.integer(1, 2)).map(raw), 'oneLine')), random.chance(0.5) && pair('scrolloff', count(random, 0, 10)),
        random.chance(0.4) && pair('shell', texts(random.pick([['zsh', '-c'], ['bash', '-lc'], ['pwsh', '-NoProfile', '-Command']]), 'oneLine')), random.chance(0.4) && pair('auto-save', raw(true)),
        random.chance(0.4) && pair('idle-timeout', count(random, 0, 500)), random.chance(0.3) && pair('bufferline', text('multiple')),
      ], notes, 0.2)))
      if (often(random, size, 0.5)) sections.push(table('editor.cursor-shape', pickSome<[string, string]>(random, [['insert', 'bar'], ['normal', 'block'], ['select', 'underline']], random.integer(1, 3)).map(([mode, shape]) => pair(mode, text(shape)))))
      if (often(random, size, 0.4)) sections.push(table('editor.statusline', [pair('left', texts(pickSome(random, ['mode', 'spinner', 'file-name', 'version-control'], random.integer(1, 3)))), random.chance(0.5) && pair('right', texts(pickSome(random, ['diagnostics', 'position', 'file-encoding'], random.integer(1, 3))))]))
      if (often(random, size, 0.6)) {
        sections.push(table('keys.normal', annotated(random, [
          pair('C-s', text(':w')), random.chance(0.5) && pair('C-/', text('toggle_comments')), random.chance(0.5) && pair(['space', 'q'], text(':q')),
          random.chance(0.4) && pair(['space', 'f'], text('file_picker')), random.chance(0.5) && pair('g', inline([['a', text('code_action')], ['r', text('rename_symbol')]])),
          random.chance(0.3) && pair('esc', texts(['collapse_selection', 'keep_primary_selection'], 'oneLine')), random.chance(0.3) && pair('A-,', text('goto_previous_buffer')),
        ], notes, 0.15)))
      }
      if (often(random, size, 0.3)) sections.push(table('keys.insert', [pair('j', inline([['k', text('normal_mode')]])), random.chance(0.4) && pair('C-space', text('completion'))]))
      return sections
    }
    const modules = pickSome(random, ['directory', 'git_branch', 'git_status', 'rust', 'nodejs', 'cmd_duration', 'character'], amount(random, size, 2, 6))
    const sections = [table(undefined, annotated(random, [
      random.chance(0.7) && pair('format', text(`${modules.map(module => `$${module}`).join('\n')}`, 'continued')),
      random.chance(0.6) && pair('add_newline', raw(random.chance(0.5))), random.chance(0.4) && pair('command_timeout', raw(random.pick([500, 1000, 2000]))),
      random.chance(0.3) && pair('palette', text('harbor')),
    ], notes, 0.15), random.chance(0.3) ? {notes: ['~/.config/starship.toml']} : {})]
    if (random.chance(0.7)) sections.push(table('character', [pair('success_symbol', text(random.pick(['[➜](bold green)', '[>](green)', '[λ](bold cyan)']))), random.chance(0.7) && pair('error_symbol', text(random.pick(['[✗](bold red)', '[x](red)'])))]))
    if (often(random, size, 0.6)) sections.push(table('directory', [pair('truncation_length', count(random, 1, 8)), random.chance(0.5) && pair('style', text(random.pick(['bold cyan', 'blue', 'fg:#e3e5e5 bg:#769ff0']))), random.chance(0.3) && pair('truncate_to_repo', raw(false)), random.chance(0.3) && pair('home_symbol', text('~'))]))
    if (often(random, size, 0.5)) sections.push(table('git_branch', [pair('symbol', text(random.pick(['🌱 ', ' ', 'git:']))), random.chance(0.5) && pair('format', text('[$symbol$branch]($style) '))]))
    if (often(random, size, 0.4)) sections.push(table('cmd_duration', [pair('min_time', raw(grouped(random.pick([500, 2000, 10000])))), random.chance(0.6) && pair('format', text('took [$duration]($style)')), random.chance(0.4) && pair('show_milliseconds', raw(true))]))
    if (often(random, size, 0.3)) sections.push(table(['palettes', 'harbor'], [pair('blue', color()), pair('fg', color())]))
    return sections
  },

  // The config of a web server or a service.
  serverConfig(random, size) {
    const notes = [...generalNotes, '10 MiB', 'behind the load balancer', '0 = unlimited', 'one per core', 'bind on all interfaces']
    const sections = [table('server', annotated(random, [
      random.chance(0.3) && pair('name', text(`${random.pick(['edge', 'api', 'web'])}-${random.integer(1, 9)}`)),
      pair('host', text(random.pick(['0.0.0.0', '127.0.0.1', 'localhost', '::']))), pair('port', raw(random.pick([80, 443, 3000, 8080, 8443]))),
      random.chance(0.3) && pair('environment', text(random.pick(['production', 'staging', 'dev']))), random.chance(0.25) && pair('tags', texts(pickSome(random, ['public', 'internal', 'canary', 'eu'], random.integer(1, 2)), 'oneLine')),
      random.chance(0.6) && pair('workers', count(random, 1, 32)), random.chance(0.6) && pair('request_timeout_ms', raw(grouped(random.pick([5000, 30000, 120000])))),
      random.chance(0.4) && pair('max_body_size', raw(grouped(random.pick([1048576, 10485760, 52428800])))), random.chance(0.4) && pair('keep_alive', raw(random.pick(['75.0', '5.5', '60']))),
      random.chance(0.3) && pair('graceful_shutdown', raw(true)), random.chance(0.3) && pair('bind', texts(pickSome(random, ['0.0.0.0:8080', '[::]:8080', '127.0.0.1:9090'], random.integer(1, 2)))),
    ], notes, 0.25))]
    if (often(random, size, 0.5)) {
      sections.push(table('server.tls', annotated(random, [
        pair('enabled', raw(random.chance(0.8))), pair('cert_file', text(random.pick(['/etc/ssl/certs/server.pem', 'certs/dev.crt']))), pair('key_file', text(random.pick(['/etc/ssl/private/server.key', 'certs/dev.key']))),
        random.chance(0.4) && pair('min_version', raw(random.pick(['1.2', '1.3']))), random.chance(0.3) && pair('ciphers', texts(['TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256'], 'lines')),
      ], notes, 0.15)))
    }
    if (often(random, size, 0.6)) {
      sections.push(table('logging', annotated(random, [
        pair('level', text(random.pick(['debug', 'info', 'warn', 'error']))), random.chance(0.6) && pair('format', text(random.pick(['json', 'text', 'logfmt']))),
        random.chance(0.5) && pair('file', random.chance(0.3) ? text('C:\\logs\\app.log', random.chance(0.7) ? 'literal' : 'basic') : text('/var/log/app/server.log')),
        random.chance(0.3) && pair('rotate_at', raw(clock(random))), random.chance(0.3) && pair('max_files', count(random, 3, 30)),
      ], notes, 0.2)))
    }
    if (often(random, size, 0.4)) {
      sections.push(table('limits', annotated(random, [
        pair('rate_per_second', raw(random.pick(['2.5e2', '100', '1e3', '50.0']))), random.chance(0.6) && pair('burst', raw(random.pick(['+50', '200', '1_000']))),
        random.chance(0.5) && pair('max_connections', raw(random.pick(['1e4', '10_000', '4096']))), random.chance(0.3) && pair('idle_timeout', raw(random.pick(['inf', '300.0', '9e2']))),
      ], notes, 0.25)))
    }
    for (let index = 1, upstreams = amount(random, size, 0, 3); index <= upstreams; index++) {
      sections.push(table('upstream', [pair('name', text(`api-${index}`)), pair('address', text(`10.0.${random.integer(0, 9)}.${random.integer(2, 250)}:${random.pick([8000, 9000])}`)), random.chance(0.6) && pair('weight', count(random, 1, 5)), random.chance(0.3) && pair('backup', raw(index > 1))], {array: true}))
    }
    if (often(random, size, 0.35)) sections.push(table('cors', [pair('allowed_origins', texts(pickSome(random, ['https://example.com', 'https://app.example.com', 'http://localhost:5173', '*'], random.integer(1, 3)))), pair('allowed_methods', texts(pickSome(random, ['GET', 'POST', 'PUT', 'DELETE'], random.integer(1, 4)), 'oneLine')), random.chance(0.5) && pair('max_age', raw(grouped(random.pick([600, 3600, 86400]))))]))
    return sections
  },

  // The config of a database client: the connection, the replicas, migrations and backups.
  databaseConfig(random, size) {
    const notes = [...generalNotes, 'rw-r-----', 'read replicas lag by up to 1s', 'UTC', 'never commit the password']
    const host = `db${random.integer(1, 9)}.internal`
    const sections = [table('database', annotated(random, [
      pair('url', text(`${random.pick(['postgres', 'mysql'])}://app:${random.pick(['s3cr3t', 'p@ss"word', 'hunter2'])}@${host}:${random.pick([5432, 3306])}/${random.pick(['orders', 'app', 'analytics'])}${random.chance(0.4) ? '?sslmode=require' : ''}`)),
      random.chance(0.3) && pair('driver', text(random.pick(['postgres', 'mysql', 'sqlite']))), random.chance(0.25) && pair('schemas', texts(pickSome(random, ['public', 'audit', 'reporting'], random.integer(1, 2)), 'oneLine')),
      random.chance(0.7) && pair('pool_size', count(random, 2, 50)), random.chance(0.4) && pair('min_idle', count(random, 0, 5)),
      random.chance(0.5) && pair('connect_timeout', raw(random.pick(['5.0', '2.5', '10']))), random.chance(0.5) && pair('statement_timeout_ms', raw(grouped(random.pick([5000, 30000, 600000])))),
      random.chance(0.4) && pair('ssl', inline([['mode', text(random.pick(['require', 'verify-full']))], ['root_cert', text('/etc/ssl/ca.pem')]])),
      random.chance(0.25) && pair('application_name', text(random.pick(['orders-api', 'worker', 'reports']))),
      random.chance(0.3) && pair('file_mode', raw(random.pick(['0o640', '0o600', '0o755']))), random.chance(0.3) && pair('flags', raw(random.pick(['0b1011', '0b0000_0101', '0x1F', '0xff00']))),
      random.chance(0.3) && pair('page_size', raw(random.pick(['0x2000', '8192', '0x1000']))),
    ], notes, 0.2))]
    if (often(random, size, 0.4)) sections.push(table('database.replica', [pair('url', text(`postgres://reader@replica.${host}/app`)), random.chance(0.6) && pair('lag_tolerance', float(random, 2, 1)), random.chance(0.4) && pair('enabled', raw(true))]))
    if (often(random, size, 0.5)) {
      sections.push(table('migrations', annotated(random, [
        pair('directory', text(random.pick(['db/migrations', 'migrations', 'sql/schema']))), random.chance(0.5) && pair('table', text('schema_migrations')),
        random.chance(0.5) && pair('run_on_start', raw(random.chance(0.5))), random.chance(0.5) && pair('baseline', raw(day(random))),
      ], notes, 0.15)))
    }
    if (often(random, size, 0.5)) {
      sections.push(table('backup', annotated(random, [
        pair('schedule', text(random.pick(['0 3 * * *', '30 2 * * 0', '@daily']))), random.chance(0.5) && pair('at', raw(clock(random))), random.chance(0.6) && pair('retention_days', count(random, 7, 90)),
        random.chance(0.5) && pair('last_full', raw(moment(random))), random.chance(0.5) && pair('bucket', text(`s3://${random.pick(organizations)}-backups/${random.pick(['db', 'nightly'])}`)),
        random.chance(0.3) && pair('compress', inline([['codec', text('zstd')], ['level', count(random, 1, 19)]])),
      ], notes, 0.2)))
    }
    for (let index = 1, shards = amount(random, size, 0, 3); index <= shards; index++) {
      sections.push(table('shard', [pair('id', raw(index)), pair('range', list([raw((index - 1) * 4096), raw(index * 4096 - 1)], 'oneLine')), pair('host', text(`shard-${index}.${host}`)), random.chance(0.3) && pair('read_only', raw(false))], {array: true}))
    }
    return sections
  },

  // Feature flags, as tables per flag or as dotted keys.
  featureFlags(random, size) {
    const notes = [...generalNotes, 'ramp up weekly', 'owner: payments', 'kill switch', 'remove once at 100%']
    const names = pickSome(random, ['new-checkout', 'dark_mode', 'search.v2', 'beta-banner', 'fast_sync', 'inline-help', 'ai.summaries'], amount(random, size, 1, 5))
    const sections = [table(undefined, annotated(random, [
      random.chance(0.6) && pair('default_enabled', raw(false)), random.chance(0.5) && pair('updated', raw(moment(random))), random.chance(0.5) && pair('owner', text(random.pick(['platform', 'growth', 'payments']))),
      random.chance(0.3) && pair('environments', texts(pickSome(random, ['production', 'staging', 'dev'], random.integer(1, 3)), 'oneLine')),
    ], notes, 0.15), random.chance(0.5) ? {notes: [random.pick(['Feature flags, read at start.', 'Flags: edit, then run `flags sync`.'])]} : {})]
    if (random.chance(0.3)) {
      // Every flag as dotted keys at the top of the file.
      const entries: Entry[] = []
      for (const name of names) {
        entries.push(pair(['flags', name, 'enabled'], raw(random.chance(0.6))))
        if (random.chance(0.6)) entries.push(pair(['flags', name, 'rollout'], float(random, 1, 2)))
        if (random.chance(0.3)) entries.push(pair(['flags', name, 'allow'], texts(pickSome(random, ['staff', 'team-payments', 'beta'], random.integer(1, 2)), 'oneLine')))
        if (random.chance(0.3)) entries.push(blank)
      }
      sections[0]!.entries.push(...annotated(random, entries, notes, 0.1))
      return sections[0]!.entries.length > 0 ? sections : [table(undefined, [pair(['flags', names[0]!, 'enabled'], raw(true))])]
    }
    for (const name of names) {
      sections.push(table(['flags', name], annotated(random, [
        pair('enabled', raw(random.chance(0.6))), random.chance(0.6) && pair(random.pick(['rollout', 'percent']), random.chance(0.5) ? float(random, 1, 2) : count(random, 0, 100)),
        random.chance(0.4) && pair('allow', texts(pickSome(random, ['staff', 'team-payments', 'beta', 'internal'], random.integer(1, 3)), 'oneLine')),
        random.chance(0.4) && pair('starts', raw(random.chance(0.6) ? moment(random) : day(random))), random.chance(0.25) && pair('ends', raw(moment(random))),
        random.chance(0.3) && pair('variants', inline([['control', count(random, 1, 50)], ['treatment', count(random, 1, 50)]])),
        random.chance(0.3) && pair('description', text(`${sentence(random, random.integer(3, 6))}.`)),
      ], notes, 0.2)))
    }
    return sections.filter(section => section.entries.length > 0)
  },

  // Strings for translation: escapes, quotes inside strings, strings of several lines, and text in other scripts.
  translations(random, size) {
    const notes = [...generalNotes, 'shown on the login page', '{count} is a number', 'max 40 characters', 'translators: keep the placeholder']
    const locale = random.pick(['en-GB', 'pt-BR', 'de-DE', 'ja-JP', 'fr-FR'])
    const greetings: Record<string, string> = {'en-GB': 'Welcome', 'pt-BR': 'Bem-vindo', 'de-DE': 'Willkommen', 'ja-JP': 'ようこそ', 'fr-FR': 'Bienvenue'}
    const greeting = greetings[locale]!
    const sections = [table('meta', [pair('locale', text(locale)), random.chance(0.5) && pair('direction', text('ltr')), random.chance(0.4) && pair('updated', raw(day(random))), random.chance(0.3) && pair('plural_rule', text('one_other'))],
      random.chance(0.5) ? {notes: [`${locale}: ${greeting}`]} : {})]
    const navigation: Entry[] = [pair('home', text(random.pick(['Home', 'Início', 'Startseite', 'ホーム']))), pair('sign-in', text(random.pick(['Sign in', 'Entrar', 'Anmelden']))), pair('back', text('← Back')), pair('sign out', text('Sign out')), pair('help.title', text('Help & support'))]
    if (often(random, size, 0.6)) sections.push(table('nav', annotated(random, pickSome(random, navigation, random.integer(2, 5)), notes, 0.15)))
    const cart: Entry[] = [
      pair('empty', text('Your basket is empty.')), pair('items', text('{count} items')), pair('remove', text('Remove “{name}”')), pair('total', text('Total:\t{amount}')),
      pair('note', text('Prices include VAT.\nShipping is extra.')), pair('quote', text('She said "hello" and left.')), pair('path', text('Saved to C:\\Users\\{name}\\Downloads')),
      pair('price', text('{amount} €')), pair('discount', text('-{percent}% today only!')), pair('hint', text('Use [brackets] or {braces}, e.g. key = "value" # not a comment')),
      pair('cafe', text('Café “Zoë” — 東京店')), pair('party', text('Thanks 🎉')),
      pair('count', inline([['one', text('{count} item')], ['other', text('{count} items')]])), pair('weekdays', texts(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], 'oneLine')),
      pair('max_length', count(random, 20, 80)), pair('uppercase', raw(random.chance(0.5))), pair(['button', 'ok'], text('OK')), pair(['button', 'cancel'], text('Cancel')),
    ]
    sections.push(table(random.pick(['cart', 'checkout', 'messages']), annotated(random, pickSome(random, cart, amount(random, size, 2, 8)), notes, 0.15)))
    if (often(random, size, 0.6)) {
      const paragraph = `${sentence(random, random.integer(3, 6))}.\n${sentence(random, random.integer(3, 6))} {email}.`
      sections.push(table('welcome', annotated(random, [
        pair('title', text(`${greeting}, {name}!`)),
        random.chance(0.7) && pair('body', random.weighted([[text(paragraph, 'lines'), 4], [text(paragraph.replace('\n', ' \n'), 'continued'), 3], [text(paragraph, 'basic'), 2]])),
        random.chance(0.5) && pair('footer', text(`© 2026 ${random.pick(['Harbor Ltd.', 'Acme, Inc.'])}\n${random.pick(['All rights reserved.', 'Don\'t reply to this email.', 'Path: C:\\mail\\out'])}`, 'literalLines')),
      ], notes, 0.15)))
    }
    return sections
  },

  // A data file: records as arrays of tables and as arrays of inline tables, with dates, times and numbers.
  records(random, size) {
    const notes = [...generalNotes, 'in metres', 'local time', 'measured twice', 'source: field notes']
    const sections = [table(undefined, annotated(random, [
      pair('title', text(random.pick(['Race results', 'Tide table', 'Sensor log', 'Reading list']))), random.chance(0.6) && pair('updated', raw(moment(random))),
      random.chance(0.4) && pair('points', list(Array.from({length: random.integer(1, 3)}, () => inline([['x', count(random, -9, 99)], ['y', count(random, -9, 99)]])))),
      random.chance(0.3) && pair('matrix', list(Array.from({length: random.integer(2, 3)}, () => list(Array.from({length: 3}, () => count(random, 0, 9)), 'oneLine')), random.chance(0.5) ? 'lines' : 'oneLine')),
      random.chance(0.3) && pair('mixed', list([text('a'), count(random, 1, 9), float(random, 9, 1), raw(random.chance(0.5)), raw(day(random))], 'oneLine')),
      random.chance(0.2) && pair('empty', random.chance(0.5) ? list([]) : inline([])),
    ], notes, 0.12))]
    for (let people = amount(random, size, 0, 3); people > 0; people--) {
      sections.push(table('people', annotated(random, [
        pair('name', text(person(random))), random.chance(0.7) && pair('born', raw(`${random.integer(1815, 2005)}-${pad2(random.integer(1, 12))}-${pad2(random.integer(1, 28))}`)),
        random.chance(0.5) && pair('languages', texts(pickSome(random, ['en', 'fr', 'pt', 'ja', 'de'], random.integer(1, 3)), 'oneLine')),
        random.chance(0.4) && pair('contact', inline([['email', text(email(random))], ['phone', text(`+${random.integer(1, 99)} ${random.integer(100, 999)} ${random.integer(1000, 9999)}`)]])),
        random.chance(0.3) && pair('wake', raw(clock(random))), random.chance(0.3) && pair('height', float(random, 2, 2)),
      ], notes, 0.1), {array: true}))
    }
    for (let events = amount(random, size, 1, 3); events > 0; events--) {
      sections.push(table('events', annotated(random, [
        pair('at', raw(moment(random))), pair('kind', text(random.pick(['start', 'lap', 'finish', 'pause']))),
        random.chance(0.6) && pair('readings', list(Array.from({length: random.integer(1, 5)}, () => raw(random.pick([(random.next() * 40 - 5).toFixed(1), (random.next() * 40).toFixed(2), '1e-3', '-0.5', String(random.integer(-5, 40))]))), 'oneLine')),
        random.chance(0.3) && pair('ok', raw(random.chance(0.8))), random.chance(0.3) && pair('lap_time', raw(`00:0${random.integer(1, 9)}:${pad2(random.integer(0, 59))}.${random.integer(100, 999)}`)),
      ], notes, 0.1), {array: true}))
    }
    return sections
  },

  // The tasks and tools of a task runner.
  taskRunner(random, size) {
    const notes = [...generalNotes, 'runs before every commit', 'slow: about 2 min', 'needs docker']
    const sections: Section[] = []
    if (random.chance(0.6)) {
      sections.push(table('tools', annotated(random, [
        pair('node', text(String(random.pick([18, 20, 22])))), random.chance(0.5) && pair('python', random.chance(0.5) ? text(`3.${random.integer(9, 13)}`) : texts(['3.11', '3.12'], 'oneLine')),
        random.chance(0.4) && pair('rust', inline([['version', text(`1.${random.integer(70, 84)}`)], ['components', texts(['clippy', 'rustfmt'], 'oneLine')]])), random.chance(0.3) && pair('npm:prettier', text('latest')),
      ], notes, 0.12)))
    }
    if (often(random, size, 0.6)) {
      sections.push(table('env', annotated(random, [
        random.chance(0.6) && pair('RUST_LOG', text(random.pick(['debug', 'info']))), random.chance(0.6) && pair('DATABASE_URL', text('postgres://localhost/dev')),
        random.chance(0.4) && pair(['_', 'file'], text('.env')), random.chance(0.3) && pair(['_', 'path'], texts(['./bin', './node_modules/.bin'], 'oneLine')), pair('CI', text(random.pick(['0', '1']))),
      ], notes, 0.12)))
    }
    const commands: [string, string[]][] = [
      ['build', ['cargo build --release']], ['test', ['cargo fmt --check', 'cargo test --all']], ['lint', ['ruff check .', 'mypy src']], ['fmt', ['cargo fmt']],
      ['docs:serve', ['mdbook serve --open']], ['db:reset', ['dropdb app || true', 'createdb app', 'sqlx migrate run']], ['clean', ['rm -rf target dist']], ['ci', ['just lint && just test']],
    ]
    const drawn = pickSome(random, commands, amount(random, size, 1, 5))
    for (const [name, steps] of drawn) {
      sections.push(table(['tasks', name], annotated(random, [
        random.chance(0.5) && pair('description', text(`${sentence(random, random.integer(2, 5))}`)),
        pair('run', steps.length === 1 ? text(steps[0]!) : random.chance(0.3) ? text(`${steps.join('\n')}\n`, 'lines') : texts(steps, random.chance(0.6) ? 'lines' : 'auto')),
        random.chance(0.35) && pair('depends', texts(pickSome(random, drawn.map(([other]) => other).filter(other => other !== name).concat('setup'), 1), 'oneLine')),
        random.chance(0.25) && pair('env', inline([[random.pick(['RUSTFLAGS', 'NODE_ENV', 'PYTHONPATH']), text(random.pick(['-D warnings', 'test', 'src']))]])),
        random.chance(0.25) && pair('sources', texts(pickSome(random, ['src/**/*.rs', 'Cargo.toml', '**/*.py'], random.integer(1, 2)))), random.chance(0.2) && pair('alias', text(name[0]!)),
        random.chance(0.15) && pair('hide', raw(true)),
      ], notes, 0.15)))
    }
    if (often(random, size, 0.35)) sections.push(table('settings', [pair('jobs', count(random, 1, 16)), random.chance(0.5) && pair('experimental', raw(true)), random.chance(0.4) && pair('task_output', text('prefix'))]))
    return sections
  },

  // The config of a metrics agent with plugins as arrays of tables, with many comments and settings that are switched
  // off, as the samples that such tools ship with have them.
  agentConfig(random, size) {
    const notes = ['Default data collection interval for all inputs', 'Timeout for HTTP messages.', 'Whether to report per-cpu stats or not', 'Multiple URLs can be specified', 'Ignore mount points by filesystem type.',
      'Override the default hostname, if empty use os.Hostname()', 'e.g. "10s", "1m"', 'Read metrics about cpu usage', ...generalNotes]
    // The comments that explain a setting are doubled, e.g. `## Timeout for HTTP messages.`, in half of the documents.
    const doubled = random.chance(0.5) ? (noteText: string) => `# ${noteText}` : (noteText: string) => noteText
    const doubledNotes = notes.map(doubled)
    const sections: Section[] = []
    if (random.chance(0.5)) sections.push(table('global_tags', [pair(random.pick(['dc', 'region', 'env']), text(random.pick(['eu-west-1', 'us-east-1', 'staging'])))], random.chance(0.5) ? {notes: [doubled('Global tags can be specified here in key="value" format.')]} : {}))
    sections.push(table('agent', annotated(random, [
      pair('interval', text(random.pick(['10s', '30s', '1m']))), random.chance(0.6) && pair('round_interval', raw(true)), random.chance(0.6) && pair('metric_batch_size', raw(random.pick([1000, 5000]))),
      random.chance(0.5) && pair('metric_buffer_limit', raw(grouped(random.pick([10000, 100000])))), random.chance(0.4) && off('flush_jitter', text('0s')), random.chance(0.5) && pair('hostname', text('')),
      random.chance(0.4) && pair('omit_hostname', raw(false)), random.chance(0.3) && pair('precision', text('')), random.chance(0.3) && off('debug', raw(true)),
    ], doubledNotes, 0.3)))
    const outputs: Section[] = [
      table('outputs.influxdb', [pair('urls', texts([`http://127.0.0.1:${random.pick([8086, 9999])}`], 'oneLine')), pair('database', text('telegraf')), random.chance(0.5) && off('timeout', text('5s')), random.chance(0.3) && pair('skip_database_creation', raw(true))], {array: true}),
      table('outputs.file', [pair('files', texts(['stdout', '/tmp/metrics.out'], 'oneLine')), random.chance(0.6) && pair('data_format', text('influx'))], {array: true}),
    ]
    sections.push(random.pick(outputs))
    const inputs: Section[] = [
      table('inputs.cpu', annotated(random, [pair('percpu', raw(true)), pair('totalcpu', raw(true)), random.chance(0.6) && pair('collect_cpu_time', raw(false)), random.chance(0.4) && pair('report_active', raw(false))], doubledNotes, 0.3), {array: true}),
      table('inputs.disk', [pair('ignore_fs', texts(pickSome(random, ['tmpfs', 'devtmpfs', 'devfs', 'overlay', 'squashfs'], random.integer(2, 4)), 'oneLine')), random.chance(0.4) && off('mount_points', texts(['/'], 'oneLine'))], {array: true}),
      table('inputs.mem', [note(doubled('no configuration'))], {array: true}),
      table('inputs.http_response', [pair('urls', texts(['https://example.com/health'], 'oneLine')), random.chance(0.6) && pair('response_timeout', text('5s')), random.chance(0.6) && pair('method', text('GET')), random.chance(0.3) && pair('follow_redirects', raw(false))], {array: true}),
      table('inputs.net', [random.chance(0.6) ? pair('interfaces', texts(['eth*', 'lo'], 'oneLine')) : off('interfaces', texts(['eth0'], 'oneLine')), random.chance(0.4) && pair('ignore_protocol_stats', raw(true))], {array: true}),
    ]
    const drawn = pickSome(random, inputs, amount(random, size, 1, 4))
    for (const input of drawn) {
      if (random.chance(0.3)) input.notes = [doubled(random.pick(notes))]
      sections.push(input)
      if (input.header!.path[1] === 'http_response' && random.chance(0.5)) sections.push(table('inputs.http_response.headers', [pair('Host', text('example.com')), random.chance(0.4) && pair('Authorization', text('Bearer ${TOKEN}'))]))
    }
    return sections
  },

  // A lockfile that a tool writes: Cargo.lock, or a lockfile of Python packages.
  lockfile(random, size) {
    const drawn = random.shuffled(crates)
    const packageCount = amount(random, size, 1, 4)
    if (random.chance(0.6)) {
      const sections = [table(undefined, [pair('version', raw(random.pick([3, 4])))], {notes: ['This file is automatically @generated by Cargo.', 'It is not intended for manual editing.']})]
      for (let index = 0; index < packageCount; index++) {
        const dependencies = drawn.slice(packageCount, packageCount + random.integer(0, 3))
        sections.push(table('package', [
          pair('name', text(drawn[index]!)), pair('version', text(version(random))),
          random.chance(0.8) && pair('source', text('registry+https://github.com/rust-lang/crates.io-index')), random.chance(0.8) && pair('checksum', text(hexDigits(random, 64))),
          dependencies.length > 0 && pair('dependencies', texts(dependencies.map(crate => random.chance(0.2) ? `${crate} ${version(random)}` : crate), 'lines')),
        ], {array: true}))
      }
      return sections
    }
    const packages = random.shuffled(pythonPackages)
    const sections: Section[] = []
    for (let index = 0; index < packageCount; index++) {
      const name = packages[index]!
      const release = version(random)
      sections.push(table('package', [
        pair('name', text(name)), pair('version', text(release)), random.chance(0.6) && pair('description', text(`${sentence(random, random.integer(3, 6))}`)), pair('optional', raw(false)),
        pair('python-versions', text(random.pick(['>=3.8', '>=3.9,<4.0', '*']))),
        random.chance(0.6) && pair('files', list([inline([['file', text(`${name}-${release}-py3-none-any.whl`)], ['hash', text(`sha256:${hexDigits(random, 24)}`)]])], 'lines')),
      ], {array: true}))
      if (random.chance(0.4)) sections.push(table('package.dependencies', packages.slice(packageCount, packageCount + random.integer(1, 2)).map(dependency => random.chance(0.7) ? pair(dependency, text(`>=${random.integer(1, 5)}.${random.integer(0, 9)},<${random.integer(6, 9)}`)) : pair(dependency, inline([['version', text('*')], ['markers', text('sys_platform == "win32"')]])))))
    }
    sections.push(table('metadata', [pair('lock-version', text('2.0')), pair('python-versions', text('^3.9')), pair('content-hash', text(hexDigits(random, 40)))]))
    return sections
  },

  // Arrays and inline tables inside each other, down to a depth that is drawn, often 16.
  deepNesting(random, size) {
    const scalar = (): Value => random.weighted([[count(random, -9, 99), 4], [text(random.pick(words)), 3], [raw(random.chance(0.5)), 1], [float(random, 9, 1), 1], [raw(day(random)), 0.5], [raw(oddValue(random, 0)), 2]])
    const keys = ['left', 'right', 'value', 'items', 'next', 'a', 'b', 'node', 'x', 'y']
    // A value that nests exactly `levels` deep: its first entry goes all the way down, and the others are shallow.
    // The innermost container is often one of the template `oddities`, so that the deepest level also has a comment
    // in an array, a key between quotes and an empty container.
    const nest = (levels: number, lines: boolean): Value => {
      if (levels === 0) return scalar()
      if (levels === 1 && random.chance(0.4)) return raw(random.chance(0.5) ? oddArray(random, 0) : oddInlineTable(random, 0))
      const width = random.weighted([[1, 5], [2, 3], [3, 1]])
      const shallow = () => random.chance(0.7) ? scalar() : nest(Math.min(levels - 1, random.integer(0, 2)), false)
      if (random.chance(0.4)) return inline(pickSome(random, keys, width).map((key, index): [string, Value] => [key, index === 0 ? nest(levels - 1, false) : shallow()]))
      const onLines = lines && random.chance(0.35)
      const array = list(Array.from({length: width}, (_, index) => index === 0 ? nest(levels - 1, onLines) : shallow()), onLines ? 'lines' : 'oneLine')
      if (array.type === 'array' && onLines && random.chance(0.3)) array.after = {0: random.pick(generalNotes)}
      return array
    }
    return withoutRedefinedKeys('deepNesting', () => {
      const depths = [random.weighted([[random.integer(2, 6), 5], [random.integer(7, 15), 3], [maximumDepth, 3]])]
      for (let more = amount(random, size, 0, 2); more > 0; more--) depths.push(random.integer(1, 5))
      const names = pickSome(random, ['matrix', 'tree', 'grid', 'levels', 'shape', 'layout'], depths.length)
      const sections = [table(undefined, depths.map((levels, index) => pair(names[index]!, nest(levels, true))))]
      if (random.chance(0.3)) sections.push(table('nested', [pair('inner', nest(random.integer(1, 4), true))]))
      return sections
    })
  },

  // What TOML allows and config files rarely have, much of it in the wording of TOML's own examples: odd keys, every
  // form of number, date and string, white space in headers, comments in arrays.
  oddities(random, size) {
    const lineCount = amount(random, size, 3, 14)
    return withoutRedefinedKeys('oddities', () => {
      const lines: Entry[] = []
      let headers = 0
      for (let index = 0; index < lineCount; index++) {
        const roll = random.next()
        if (roll < 0.12 && index > 0) lines.push({type: 'line', text: oddHeader(random, ++headers)})
        else if (roll < 0.18) lines.push({type: 'line', text: random.pick(oddComments)})
        else if (roll < 0.21) lines.push({type: 'line', text: random.pick(['', ' ', '\t', '  '])})
        else lines.push({type: 'line', text: `${random.chance(0.12) ? random.pick([' ', '  ', '\t']) : ''}${oddKey(random)}${random.pick(oddEquals)}${oddValue(random, 2)}${random.chance(0.25) ? random.pick([' # note', '# no space', '\t# after a tab', ' #', ' ', '\t']) : ''}`})
      }
      return [{entries: lines}]
    })
  },
}

// The sections that `build` makes, built again until no key is defined twice. Two drawn keys of the templates
// `oddities` and `deepNesting` can be the same key, or one can be a table of the other, e.g. `3 = 1` and
// `3.14159 = "pi"`. The tables accept such a document, since they keep no names, and TOML does not.
function withoutRedefinedKeys(template: Template, build: () => Section[]): Section[] {
  for (let attempt = 0; ; attempt++) {
    const sections = build()
    try {
      Bun.TOML.parse(serialize(sections, plainLayout))
      return sections
    } catch (error) {
      if (attempt > 400) throw new Error(`the template ${template} found no document without a key that is defined twice: ${(error as Error).message}`)
    }
  }
}

// The values of the template `oddities`, written as given.
const oddIntegers = ['+99', '42', '0', '-17', '1_000', '5_349_221', '53_49_221', '1_2_3_4_5', '0xDEADBEEF', '0xdeadbeef', '0xdead_beef', '0o01234567', '0o755', '0b11010110', '+0', '-0', '0b0', '0x0', '0o0', '9007199254740991']
const oddFloats = ['+1.0', '3.1415', '-0.01', '5e+22', '1e06', '-2E-2', '6.626e-34', '224_617.445_991_228', '0.0', '+0.0', '-0.0', 'inf', '+inf', '-inf', 'nan', '+nan', '-nan', '0e0', '1E5', '9_0.0_1e1_0', '1.5E+3']
const oddDates = [
  '1979-05-27T07:32:00Z', '1979-05-27T00:32:00-07:00', '1979-05-27T00:32:00.999999-07:00', '1979-05-27 07:32:00Z', '1979-05-27T07:32:00', '1979-05-27T00:32:00.999999',
  '1979-05-27', '07:32:00', '00:32:00.999999', '1979-05-27t07:32:00z', '2000-02-29 15:15:15.5+01:30', '1987-07-05T17:45:00z', '23:59:59.0', '2018-10-09 08:19:28.0123', '2031-12-31T23:59:59+00:00',
  '0001-01-01', '0987-06-15T00:00:00Z', '00:00:00', '2024-11-30T16:08:49+05:45', '2024-11-30T16:08:49-09:30', '2010-10-10T10:10:10.10+11:15', '2099-09-09 09:09:09-02:39', '1969-07-20T20:17:40+23:01',
]
const oddStrings = [
  '"I\'m a string. \\"You can quote me\\". Name\\tJos\\u00E9\\nLocation\\tSF."', '"\\b\\t\\n\\f\\r\\"\\\\"', '"\\U0001F600 and \\u00e9"', '\'C:\\Users\\nodejs\\templates\'', '\'\\\\ServerX\\admin$\\system32\\\'',
  '\'Tom "Dubs" Preston-Werner\'', '\'<\\i\\c*\\s*>\'', '""', '\'\'', '"""\nRoses are red\nViolets are blue"""', '"""\nThe quick brown \\\n\n\n  fox jumps over \\\n    the lazy dog."""',
  '"""\\\n       The quick brown \\\n       fox jumps over \\   \n       the lazy dog.\\\n       """', '"""Here are two quotation marks: "". Simple enough."""', '"""Here are three quotation marks: ""\\"."""',
  '"""Here are fifteen quotation marks: ""\\"""\\"""\\"""\\"""\\"."""', '""""This," she said, "is just a pointless statement.""""', '"""She said: "hi"""""', '\'\'\'I [dw]on\'t need \\d{2} apples\'\'\'',
  '\'\'\'\nThe first newline is\ntrimmed in raw strings.\n   All other whitespace\n   is preserved.\n\'\'\'', '\'\'\'Here are fifteen quotation marks: """""""""""""""\'\'\'', '\'\'\'\'That,\' she said, \'is still pointless.\'\'\'\'',
  '""""""', '\'\'\'\'\'\'', '"tab\there"', '\'tab\there\'', '"# not a comment"', '"a = [1, 2] # and {b = 3}"', '"ʎǝʞ and 日本語"', '"\\u0000\\u007f\\U0010FFFF"', '"""one "quote" and \'two\' """', '\'\'\'it\'\'s\'\'\'',
]
const oddArrays = [
  '[ 1, 2, 3 ]', '[ "red", "yellow", "green" ]', '[ [ 1, 2 ], [3, 4, 5] ]', '[ [ 1, 2 ], ["a", "b", "c"] ]', '[ "all", \'strings\', """are the same""", \'\'\'type\'\'\' ]', '[ 0.1, 0.2, 0.5, 1, 2, 5 ]',
  '[ "Foo Bar <foo@example.com>", { name = "Baz Qux", email = "bazqux@example.com", url = "https://example.com/bazqux" } ]', '[\n  1, 2, 3\n]', '[\n  1,\n  2, # this is ok\n]', '[]', '[ ]', '[[]]', '[[], []]',
  '[\n  # only a comment\n]', '[\n\n  "a"\n  ,\n  "b"\n\n]', '[1,2,3]', '[ { x = 1, y = 2, z = 3 }, { x = 7, y = 8, z = 9 } ]', '[\t1\t,\t2\t]', '[1, [2, [3, [4]]]]', '[true, false]', '[inf, -inf, nan]',
  '[1979-05-27, 07:32:00]', '[ [ ] ]', '[{}]', '[ 1 # one\n, 2 # two\n]', '[ # a comment after the bracket\n  +1,\n  -1,\n]',
]
const oddInlineTables = [
  '{ first = "Tom", last = "Preston-Werner" }', '{ x = 1, y = 2 }', '{ type.name = "pug" }', '{}', '{ }', '{a={b={c=1}}}', '{ "quoted key" = 1, \'literal\' = 2, bare-key = 3 }', '{ a.b.c = 1, a.b.d = 2 }',
  '{ list = [1, 2], empty = [] }', '{ nested = { deep = [ { deeper = true } ] } }', '{\tx\t=\t1\t}', '{ 1 = 2, true = false, 3.5 = 4 }', '{ when = 1979-05-27, at = 07:32:00 }', '{ sign = +1, other = -inf }',
]
// Inline tables that hold no container, with a number as the first part of a dotted key, e.g. the key `14` of the table `3`.
const flatInlineTables = ['{ 3. 14 = "pi" }', '{ 1 . 5 = 2 }', '{0.\t5=1}', '{ 2. x = 1, 2.y = 2 }', '{ type.name = "pug" }', '{ 1 = 2, true = false, 3.5 = 4 }', '{ when = 1979-05-27, at = 07:32:00 }', '{ sign = +1, other = -inf }']
// Keys as they are written, e.g. between quotes or with white space around a dot.
const oddKeys = [
  '""', '\'\'', '"127.0.0.1"', '"character encoding"', '"ʎǝʞ"', '\'key2\'', '\'quoted "value"\'', '1234', 'bare_key', 'bare-key', '3.14159', 'fruit . flavor', 'fruit\t.\tcolor', 'site."google.com"', 'true', 'false', 'inf', 'nan',
  '1979-05-27', '-1', '0x1F', '1e5', '_', '-', '2001-02', '1_000', '07', 'tru', 'fals', 'in', 'na', 't', 'f', 'n', 'i', '"key\\twith\\u0020escapes"', 'a . "b c" . \'d\'', 'physical.color', 'physical.shape', 'apple.type',
  'orange.type', 'KEY', 'Key', '"a.b"', '0', '00', '1.2.3', 'x-y_z', 'truer', 'falsey', 'info', 'nano', '1979', '12', '1e', '1_', '0b', '0o7', '0xg', '--', '__', '1-2',
]
const oddEquals = [' = ', ' = ', ' = ', '=', '  =  ', '\t=\t', ' =', '= ']
const oddComments = ['# This is a full-line comment', '#', '#no space', '# a comment with "quotes", [brackets] and key = value', '  # an indented comment', '# é 東京 🌱', '#\ttabs\tinside', '## doubled', '# = = =', '#!shebang', '# 0x1F +1e5 inf']

// One character per class of the tokenizer that a key without quotes may hold: the letters that matter to a number, a
// date or a literal, other letters, the digits by their bases, the underscore and the minus sign.
const bareKeyCharacters = Array.from('abefilnorstuxzcgETUZ0159_-')
// One character or more per class that a string may hold as it is.
const stringCharacters = [...bareKeyCharacters, ' ', ' ', '\t', '#', '=', '.', ',', '[', ']', '{', '}', ':', '+', 'é', '!', '東']

// A word that the tokenizer starts to read as a number, a date or a literal and that is a key: the start of one, often
// with one more character after it, e.g. `1979-05x`, `0xDEADg`, `fal9` or `6.626e-3`. A dot in it makes it a dotted key,
// e.g. the key `626e-3` of the table `6`.
function valueLikeKey(random: Random): string {
  const source = random.pick([...oddIntegers, ...oddFloats, ...oddDates, 'true', 'false', 'true', 'false'])
  const start = source.slice(0, random.integer(1, source.length))
  const candidate = `${start}${random.chance(0.7) ? random.pick(bareKeyCharacters) : ''}`
  // Only what a key without quotes may hold, with single dots between its parts.
  const bare = candidate.replace(/[^A-Za-z0-9_.-]/g, '').replace(/\.+/g, '.').replace(/^\.|\.$/g, '')
  return bare === '' ? '0' : bare
}

// A key of the template `oddities`, in one to three parts with dots between them, and sometimes white space around a dot.
function oddKey(random: Random): string {
  const part = () => random.weighted([[random.pick(oddKeys), 3], [valueLikeKey(random), 6], [oddString(random, false), 1]])
  const parts = Array.from({length: random.weighted([[1, 7], [2, 2], [3, 1]])}, part)
  return parts.join(random.weighted([['.', 5], [' . ', 1.5], ['. ', 2], [' .', 1], ['\t.\t', 0.5]]))
}

// A header of the template `oddities`. The number makes its name another one than the names of the headers before it.
function oddHeader(random: Random, number: number): string {
  const name = random.weighted([
    [`table${number}`, 3], [`${number}`, 1], [`${number}.${valueLikeKey(random)}`, 3], [`t${number}.${oddKey(random)}`, 3], [`"quoted ${number}".sub`, 1], [`'literal${number}'.sub`, 1],
    [`dog."tater.man${number}"`, 1], [`${number}-${number}`, 1], [`true${number}`, 1], [`${valueLikeKey(random)}.${number}`, 2], [`"\\u00e9\\t${number}"`, 1], [`h${number}. ${valueLikeKey(random)}`, 1],
    [`${number}. ${valueLikeKey(random)}`, 1.5], [`${number} .${valueLikeKey(random)}`, 0.5], [`${random.pick(['z', 'E', 'T', 'U', 'Z', '_'])}${number}`, 1.5], [`t${number}.${valueLikeKey(random)}`, 4],
  ])
  const padding = random.weighted([['', 7], [' ', 2], ['\t', 0.5]])
  const header = random.chance(0.4) ? `[[${padding}${name}${padding}]]` : `[${padding}${name}${padding}]`
  return `${random.chance(0.1) ? random.pick([' ', '\t']) : ''}${header}${random.chance(0.2) ? random.pick([' # after a header', '# no space', ' ', '\t']) : ''}`
}

// An escape of a string between quotes: one of the short ones, or \u with 4 hex digits, or \U with 8, of a code point
// that a string may name, i.e. no surrogate and nothing past U+10FFFF.
function oddEscape(random: Random): string {
  const hexDigit = () => random.pick(Array.from('0123456789abcdefABCDEF'))
  const fourDigits = () => `${random.pick(Array.from('0123456789abcefABCEF'))}${hexDigit()}${hexDigit()}${hexDigit()}`
  return random.weighted([
    [random.pick(['\\b', '\\t', '\\n', '\\f', '\\r', '\\"', '\\\\']), 5], [`\\u${fourDigits()}`, 3], [`\\U0000${fourDigits()}`, 1],
    [`\\U000${random.pick(Array.from('123456789abcdefABCDEF'))}${hexDigit()}${hexDigit()}${hexDigit()}${hexDigit()}`, 1], [`\\U0010${hexDigit()}${hexDigit()}${hexDigit()}${hexDigit()}`, 0.5],
  ])
}

// A string of drawn characters in one of the four forms, so that the tokenizer reads many characters in every state
// of a string: after an escape, after one or two quotes inside a string of several lines, after a backslash at a
// line's end. Only a value may be a string of several lines.
function oddString(random: Random, mayHaveSeveralLines: boolean): string {
  const form = random.weighted<'basic' | 'literal' | 'lines' | 'literalLines'>([['basic', 4], ['literal', 3], ['lines', mayHaveSeveralLines ? 3 : 0], ['literalLines', mayHaveSeveralLines ? 3 : 0]])
  const length = random.integer(0, 9)
  const plain = () => random.pick(stringCharacters)
  let content = ''
  for (let index = 0; index < length; index++) {
    const roll = random.next()
    if (form === 'basic') content += roll < 0.25 ? oddEscape(random) : roll < 0.3 ? '\'' : plain()
    else if (form === 'literal') content += roll < 0.1 ? '"' : roll < 0.2 ? '\\' : plain()
    else if (form === 'lines') {
      // One or two quotes may stand inside the string when another character follows them.
      if (roll < 0.15) content += oddEscape(random)
      else if (roll < 0.3) content += `${random.pick(['"', '""'])}${random.pick([...stringCharacters, '\n', '\'', '\\\\'])}`
      else if (roll < 0.4) content += '\n'
      else if (roll < 0.5) content += `\\${random.pick(['', ' ', '\t', '  '])}\n${random.pick(['', '  ', '\n', '\t'])}`
      else content += plain()
    } else {
      if (roll < 0.15) content += `${random.pick(['\'', '\'\''])}${random.pick([...stringCharacters, '\n', '"', '\\'])}`
      else if (roll < 0.25) content += '\n'
      else if (roll < 0.35) content += random.pick(['"', '\\'])
      else content += plain()
    }
  }
  if (form === 'basic') return `"${content}"`
  if (form === 'literal') return `'${content}'`
  // Up to two quotes may stand right before the closing ones.
  const quote = form === 'lines' ? '"' : '\''
  return `${quote.repeat(3)}${random.chance(0.4) ? '\n' : ''}${content}${random.weighted([['', 8], [quote, 1], [quote.repeat(2), 1]])}${quote.repeat(3)}`
}

// An array of drawn values, so that every form of number, date and string also stands before a comma, a bracket, a
// comment and a line end. `levels` is how deep the values may nest.
function oddArray(random: Random, levels: number): string {
  if (random.chance(0.12)) return random.pick(['[]', '[ ]', '[\n]', '[ # nothing\n]', '[# nothing\n]'])
  const values = Array.from({length: random.integer(1, 4)}, () => oddValue(random, levels))
  return random.weighted([
    [`[${values.join(', ')}]`, 3], [`[${values.join(',')}]`, 2], [`[\n  ${values.join(',\n  ')},\n]`, 1], [`[ ${values.join(' , ')} ]`, 1], [`[${values.join('\n,')}\n]`, 0.5],
    [`[${values.join(', # next\n')} # last\n]`, 0.7], [`[\t${values.join(',\t')}\t]`, 0.3], [`[${values.join(',')},]`, 0.5], [`[# first\n${values.join(',')}]`, 0.3],
  ])
}

// An inline table of drawn keys and values. Two of its keys can be the same key: the template draws such a document again.
function oddInlineTable(random: Random, levels: number): string {
  if (random.chance(0.12)) return random.pick(['{}', '{ }', '{\t}'])
  if (random.chance(0.15)) return random.pick(flatInlineTables)
  const entries = Array.from({length: random.integer(1, 3)}, () => `${oddKey(random)}${random.pick(oddEquals)}${oddValue(random, levels)}`)
  return random.weighted([[`{ ${entries.join(', ')} }`, 3], [`{${entries.join(',')}}`, 2], [`{${entries.join(' , ')}}`, 1], [`{\t${entries.join(',\t')}\t}`, 0.3]])
}

function oddValue(random: Random, levels: number): string {
  const kind = random.weighted<'integer' | 'float' | 'date' | 'string' | 'drawnString' | 'literal' | 'array' | 'inlineTable' | 'drawnArray' | 'drawnInlineTable'>([
    ['integer', 4], ['float', 4], ['date', 4], ['string', 3], ['drawnString', 4], ['literal', 1],
    ['array', levels > 0 ? 2 : 0], ['inlineTable', levels > 0 ? 1.5 : 0], ['drawnArray', levels > 0 ? 3 : 0], ['drawnInlineTable', levels > 0 ? 2 : 0],
  ])
  switch (kind) {
    case 'integer': return random.pick(oddIntegers)
    case 'float': return random.pick(oddFloats)
    case 'date': return random.pick(oddDates)
    case 'string': return random.pick(oddStrings)
    case 'drawnString': return oddString(random, true)
    case 'literal': return random.pick(['true', 'false'])
    case 'array': return random.pick(oddArrays)
    case 'inlineTable': return random.pick(oddInlineTables)
    case 'drawnArray': return oddArray(random, levels - 1)
    case 'drawnInlineTable': return oddInlineTable(random, levels - 1)
  }
}


// How a document is written.
export const styles = ['plain', 'aligned', 'indented', 'tabbed', 'compact', 'padded'] as const
// plain: `key = value`, nothing indented, as most files are.
// aligned: the equals signs of a section stand in one column, e.g. `name    = "a"` above `version = "b"`.
// indented: the entries below a header start with 2 or 4 spaces, as the sample configs of some tools have them.
// tabbed: the same with a tab.
// compact: `key=value` and `[1,2]`, as a program writes that saves bytes.
// padded: a space inside the brackets of an array as well as inside the braces of an inline table, e.g. `[ 1, 2 ]`.
export type Style = typeof styles[number]
export type Layout = {
  style: Style
  // What stands between a key and its value: ' = ' or '='.
  equals: string
  alignEquals: boolean
  // What an entry below a header starts with: nothing, spaces or a tab.
  indent: string
  // With an indent: the header of a table inside a table that has a header above is indented too, e.g. `  [server.tls]`
  // after `[server]`, and its entries one level more.
  indentNested: boolean
  // Empty lines between two sections.
  blankLines: number
  // What a value of an array on several lines starts with, after the indentation of the array's own line.
  itemIndent: string
  // An array whose form is `auto` is written on several lines when its line would be longer than this.
  wrapWidth: number
  // A comma after the last value of an array on several lines.
  trailingComma: boolean
  // A space inside the brackets of an array on one line, e.g. [ 1, 2 ].
  padBrackets: boolean
  // A space inside the braces of an inline table, e.g. { x = 1 }.
  padBraces: boolean
  // A space after a comma on one line.
  commaSpace: boolean
  // What stands between a value and the comment after it.
  noteGap: string
  // A space after the # of a comment.
  noteSpace: boolean
  // A string whose form is `any` is written between apostrophes when its text allows that.
  apostrophes: boolean
  // How characters above U+007F are written in a string between quotes: as they are, or as \u00e9, or as \u00E9.
  escapes: 'plain' | 'unicode' | 'unicodeUpperCase'
  // A line feed after the last line, as most files have.
  finalLineFeed: boolean
  // White space before the document, e.g. an empty line. Mostly none.
  leading: string
  lineEnd: '\n' | '\r\n'
  // A space inside the brackets of a header, e.g. [ server ], and around the dots of a key, e.g. a . b. Both are rare.
  headerPadding: boolean
  dotPadding: boolean
  // Every so many lines, a line ends with a space, as files have that no tool trims. 0 for none.
  trailingSpaceEvery: number
}

const styleWeights: Record<Style, number> = {plain: 52, aligned: 12, indented: 12, tabbed: 4, compact: 7, padded: 13}

export function drawLayout(random: Random): Layout {
  const style = random.weighted(styles.map(name => [name, styleWeights[name]] as const))
  const indent = style === 'indented' ? random.pick(['  ', '  ', '    ']) : style === 'tabbed' ? '\t' : ''
  return {
    style,
    equals: style === 'compact' ? '=' : ' = ',
    alignEquals: style === 'aligned',
    indent,
    indentNested: indent !== '' && random.chance(0.5),
    blankLines: style === 'compact' ? random.weighted([[0, 60], [1, 40]]) : random.weighted([[1, 82], [0, 8], [2, 10]]),
    itemIndent: style === 'tabbed' ? '\t' : random.weighted([['    ', 45], ['  ', 45], [' ', 5], ['\t', 5]]),
    wrapWidth: random.integer(40, 100),
    trailingComma: random.chance(0.7),
    padBrackets: style === 'padded' || (style !== 'compact' && random.chance(0.06)),
    padBraces: style === 'padded' || (style !== 'compact' && random.chance(0.6)),
    commaSpace: style !== 'compact',
    noteGap: random.weighted([[' ', 50], ['  ', 40], ['\t', 5], ['', 5]]),
    noteSpace: !random.chance(0.06),
    apostrophes: random.chance(0.12),
    escapes: random.weighted<Layout['escapes']>([['plain', 88], ['unicode', 8], ['unicodeUpperCase', 4]]),
    finalLineFeed: random.chance(0.85),
    leading: random.weighted([['', 95], ['\n', 4], ['\n\n', 1]]),
    lineEnd: random.chance(0.04) ? '\r\n' : '\n',
    headerPadding: random.chance(0.03),
    dotPadding: random.chance(0.02),
    trailingSpaceEvery: random.chance(0.05) ? random.integer(3, 12) : 0,
  }
}

// The layout that the template `oddities` checks its lines in: nothing added, nothing indented.
const plainLayout: Layout = {
  style: 'plain', equals: ' = ', alignEquals: false, indent: '', indentNested: false, blankLines: 1, itemIndent: '  ', wrapWidth: 80, trailingComma: true, padBrackets: false, padBraces: true,
  commaSpace: true, noteGap: ' ', noteSpace: true, apostrophes: false, escapes: 'plain', finalLineFeed: true, leading: '', lineEnd: '\n', headerPadding: false, dotPadding: false, trailingSpaceEvery: 0,
}

const isBareKey = (part: string) => /^[A-Za-z0-9_-]+$/.test(part)
// A text that may stand between apostrophes as it is: no apostrophe, and no control character but a tab.
const fitsApostrophes = (value: string) => Array.from(value).every(character => character !== '\'' && (character === '\t' || (character >= ' ' && character !== '\u007f')))

function writeBasicContent(value: string, escapes: Layout['escapes'], severalLines: boolean) {
  let written = ''
  for (const character of value) {
    const codePoint = character.codePointAt(0)!
    const hex = (digits: number) => {
      const text = codePoint.toString(16).padStart(digits, '0')
      return escapes === 'unicodeUpperCase' ? text.toUpperCase() : text
    }
    if (character === '\\') written += '\\\\'
    else if (character === '"') written += severalLines ? '"' : '\\"'
    else if (character === '\n') written += severalLines ? '\n' : '\\n'
    else if (character === '\t') written += '\\t'
    else if (character === '\r') written += '\\r'
    else if (character === '\b') written += '\\b'
    else if (character === '\f') written += '\\f'
    else if (codePoint < 0x20 || codePoint === 0x7f) written += `\\u${hex(4)}`
    else if (codePoint > 0x7f && escapes !== 'plain') written += codePoint > 0xffff ? `\\U${hex(8)}` : `\\u${hex(4)}`
    else written += character
  }
  // Between three quotes, a quote may stand as it is, but not three in a row and not right before the closing quotes.
  return severalLines ? written.replaceAll('"""', '""\\"').replace(/"$/, '\\"') : written
}

function writeString(value: string, form: StringForm, layout: Layout): string {
  switch (form) {
    case 'any': return layout.apostrophes && fitsApostrophes(value) ? `'${value}'` : `"${writeBasicContent(value, layout.escapes, false)}"`
    case 'basic': return `"${writeBasicContent(value, layout.escapes, false)}"`
    case 'literal': return `'${value}'`
    // A line feed right after the opening quotes is not part of the value, so a text of several lines starts on its own line.
    case 'lines': return `"""${value.includes('\n') ? '\n' : ''}${writeBasicContent(value, layout.escapes, true)}"""`
    case 'continued': return `"""\n${writeBasicContent(value, layout.escapes, true).replaceAll('\n', '\\\n')}"""`
    case 'literalLines': return `'''${value.includes('\n') ? '\n' : ''}${value}'''`
  }
}

function writeKeyPart(part: string, layout: Layout) {
  if (isBareKey(part)) return part
  return fitsApostrophes(part) && (layout.apostrophes || part.includes('"')) ? `'${part}'` : `"${writeBasicContent(part, layout.escapes, false)}"`
}
const writeKey = (key: readonly string[], layout: Layout) => key.map(part => writeKeyPart(part, layout)).join(layout.dotPadding ? ' . ' : '.')
// A comment. A text that starts with a # gives a doubled one, e.g. `## Timeout for HTTP messages.`, as the sample
// configs of some tools write the comments that explain a setting.
const writeNote = (noteText: string, layout: Layout) => `#${layout.noteSpace && noteText !== '' && !noteText.startsWith('#') ? ' ' : ''}${noteText}`

function writeOnOneLine(value: Value, layout: Layout): string {
  switch (value.type) {
    case 'string': return writeString(value.text, value.form, layout)
    case 'raw': return value.text
    case 'array': {
      if (value.items.length === 0) return '[]'
      const inner = value.items.map(item => writeOnOneLine(item, layout)).join(layout.commaSpace ? ', ' : ',')
      return layout.padBrackets ? `[ ${inner} ]` : `[${inner}]`
    }
    case 'inlineTable': {
      if (value.entries.length === 0) return '{}'
      const inner = value.entries.map(([key, entry]) => `${writeKey(key, layout)}${layout.equals}${writeOnOneLine(entry, layout)}`).join(layout.commaSpace ? ', ' : ',')
      return layout.padBraces ? `{ ${inner} }` : `{${inner}}`
    }
  }
}

// A value as it stands after its key. `indent` is what the value's line starts with, and `used` is how many code
// points of that line stand before the value.
function writeValue(value: Value, layout: Layout, indent: string, used: number): string {
  if (value.type !== 'array' || value.items.length === 0 || value.form === 'oneLine') return writeOnOneLine(value, layout)
  const oneLine = writeOnOneLine(value, layout)
  if (value.form === 'auto' && !oneLine.includes('\n') && used + codePointLength(oneLine) <= layout.wrapWidth) return oneLine
  const itemIndent = `${indent}${layout.itemIndent}`
  const lines = ['[']
  value.items.forEach((item, index) => {
    const above = value.above?.[index]
    if (above !== undefined) lines.push(`${itemIndent}${writeNote(above, layout)}`)
    const comma = index < value.items.length - 1 || layout.trailingComma ? ',' : ''
    const after = value.after?.[index]
    lines.push(`${itemIndent}${writeValue(item, layout, itemIndent, codePointLength(itemIndent))}${comma}${after === undefined ? '' : `${layout.noteGap}${writeNote(after, layout)}`}`)
  })
  lines.push(`${indent}]`)
  return lines.join('\n')
}

// The sections as one text in the layout.
export function serialize(sections: readonly Section[], layout: Layout): string {
  const lines: string[] = []
  // With indentNested: the level of every header so far, by its path. A header is one level deeper than the nearest
  // table above it that the document has a header for, e.g. `[server.tls]` after `[server]`.
  const levelOfHeader = new Map<string, number>()
  sections.forEach((section, sectionIndex) => {
    if (sectionIndex > 0) for (let blankLine = 0; blankLine < layout.blankLines; blankLine++) lines.push('')
    let level = 0
    if (section.header !== undefined && layout.indentNested) {
      for (let length = section.header.path.length - 1; length >= 1; length--) {
        const levelOfParent = levelOfHeader.get(section.header.path.slice(0, length).join('\u0000'))
        if (levelOfParent === undefined) continue
        level = levelOfParent + 1
        break
      }
      levelOfHeader.set(section.header.path.join('\u0000'), level)
    }
    const headerIndent = layout.indent.repeat(level)
    const entryIndent = section.header === undefined ? '' : layout.indent.repeat(level + 1)
    const noteIndent = section.header === undefined ? '' : headerIndent
    for (const noteText of section.notes ?? []) lines.push(`${noteIndent}${writeNote(noteText, layout)}`)
    if (section.header !== undefined) {
      const name = `${layout.headerPadding ? ' ' : ''}${writeKey(section.header.path, layout)}${layout.headerPadding ? ' ' : ''}`
      const header = section.header.array ? `[[${name}]]` : `[${name}]`
      lines.push(`${headerIndent}${header}${section.header.note === undefined ? '' : `${layout.noteGap}${writeNote(section.header.note, layout)}`}`)
    }
    const keys = section.entries.map(entry => entry.type === 'pair' ? writeKey(entry.key, layout) : '')
    const keyWidth = layout.alignEquals ? Math.max(0, ...keys.map(codePointLength)) : 0
    section.entries.forEach((entry, entryIndex) => {
      if (entry.type === 'blank') lines.push('')
      else if (entry.type === 'note') lines.push(`${entryIndent}${writeNote(entry.text, layout)}`)
      else if (entry.type === 'line') lines.push(`${entryIndent}${entry.text}`)
      else {
        const key = keys[entryIndex]!
        const start = `${entryIndent}${entry.off === true ? writeNote('', layout) + (layout.noteSpace ? ' ' : '') : ''}${key}${' '.repeat(Math.max(0, keyWidth - codePointLength(key)))}${layout.equals}`
        const value = entry.off === true ? writeOnOneLine(entry.value, layout).replaceAll('\n', ' ') : writeValue(entry.value, layout, entryIndent, codePointLength(start))
        lines.push(`${start}${value}${entry.note === undefined ? '' : `${layout.noteGap}${writeNote(entry.note, layout)}`}`)
      }
    })
  })
  // A space at the end of some lines. A line that holds a line feed is a value of several lines and stays as it is.
  if (layout.trailingSpaceEvery > 0) {
    for (let index = layout.trailingSpaceEvery - 1; index < lines.length; index += layout.trailingSpaceEvery) if (!lines[index]!.includes('\n')) lines[index] += ' '
  }
  const written = `${layout.leading}${lines.join('\n')}${layout.finalLineFeed ? '\n' : ''}`
  return layout.lineEnd === '\r\n' ? written.replaceAll('\n', '\r\n') : written
}

export function codePointLength(value: string) {
  let length = value.length
  for (let index = 0; index < value.length - 1; index++) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(index + 1)
      if (low >= 0xdc00 && low <= 0xdfff) length--
    }
  }
  return length
}

// How deep the arrays and inline tables of a value nest: 0 for a string or a number, 1 for an array of numbers.
function nestingOf(value: Value): number {
  if (value.type === 'array') return 1 + Math.max(0, ...value.items.map(nestingOf))
  if (value.type === 'inlineTable') return 1 + Math.max(0, ...value.entries.map(([, entry]) => nestingOf(entry)))
  return 0
}

export type DocumentRequest = {
  // The document's largest length in code points, at most 512.
  maximumLength?: number
}
export type GeneratedDocument = {text: string, sections: Section[], template: Template, layout: Layout}

// How often each template is drawn. The two that are not modeled on a real file get less.
const templateWeights: Record<Template, number> = {
  cargoManifest: 7, cargoWorkspace: 5, pyproject: 7, formatterConfig: 5, linterConfig: 5, siteConfig: 6, deployConfig: 6, appSettings: 7, serverConfig: 6,
  databaseConfig: 5, featureFlags: 5, translations: 6, records: 6, taskRunner: 6, agentConfig: 5, lockfile: 4, deepNesting: 3, oddities: 4,
}

export function drawTemplate(random: Random, allowed: readonly Template[] = templates): Template {
  return random.weighted(allowed.map(template => [template, templateWeights[template]] as const))
}

// The lines of a document that hold a key and a value and are not switched off.
const pairCountOf = (sections: readonly Section[]) => sections.reduce((total, section) => total + section.entries.filter(entry => entry.type === 'line' || (entry.type === 'pair' && entry.off !== true)).length, 0)
// The fewest such lines that a document has: a template draws most of its entries, and now and then nearly none.
const fewestPairs = (template: Template) => template === 'deepNesting' ? 1 : 3

// A valid document of the given template in the given layout. A document that comes out longer than the limit is built
// again with fewer entries, and one with fewer than three lines of a key and a value is built again as it is. Returns
// undefined when even the smallest document of the template is longer than the limit.
export function makeDocumentOf(random: Random, template: Template, layout: Layout, request: DocumentRequest = {}): GeneratedDocument | undefined {
  const maximumLength = Math.min(request.maximumLength ?? capacity, capacity)
  // Most documents get a size that fills a part of the limit, and one in six is small.
  let size = random.chance(0.16) ? random.next() * 0.25 : random.next()
  let tooLong = 0
  for (let attempt = 0; attempt < 200; attempt++) {
    const sections = builders[template](random, size).filter(section => section.entries.length > 0 || section.header !== undefined)
    if (pairCountOf(sections) < fewestPairs(template)) continue
    const text = serialize(sections, layout)
    const deepest = Math.max(0, ...sections.flatMap(section => section.entries.map(entry => entry.type === 'pair' ? nestingOf(entry.value) : 0)))
    if (codePointLength(text) <= maximumLength && deepest <= maximumDepth) return {text, sections, template, layout}
    size = ++tooLong >= 8 ? 0 : size * 0.6
  }
  return undefined
}

export function makeDocument(random: Random, request: DocumentRequest = {}): GeneratedDocument | undefined {
  return makeDocumentOf(random, drawTemplate(random), drawLayout(random), request)
}
