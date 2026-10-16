// Builds tree-sitter's parser for miniml: writes the grammar of grammar.ts as JSON, runs `tree-sitter generate` on
// it, writes the scanner's tables for scanner.c, and compiles driver.c with the generated parser, the scanner and
// tree-sitter's library.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/learn/bars/tree-sitter/build.ts
// Everything that is made goes to <RECOVERY_LR_SCRATCH>/tree-sitter: grammar.json, src/parser.c and the other
// files of `tree-sitter generate`, scanner-tables.h and the compiled driver.
import {existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {scratchFolder} from '../../../grammar/build.ts'
import {hashText} from '../../../random.ts'
import {commentKind, tables} from '../../../tables.ts'
import {grammar, tokenNames} from './grammar.ts'

const here = import.meta.dir
const treeSitter = '/opt/homebrew/bin/tree-sitter'
const library = '/opt/homebrew/lib/libtree-sitter.a'
const headers = '/opt/homebrew/include'
export const expectedVersion = '0.24.5'

function run(command: string[], cwd: string): string {
  const child = Bun.spawnSync(command, {cwd, stdout: 'pipe', stderr: 'pipe'})
  const output = `${child.stdout.toString()}${child.stderr.toString()}`
  if (child.exitCode !== 0) throw new Error(`${command.join(' ')} failed with exit code ${child.exitCode}:\n${output}`)
  return output
}

// Why tree-sitter cannot be used here, e.g. 'no /opt/homebrew/bin/tree-sitter', or undefined when it can.
// Another version generates another parser and recovers in another way.
export function toolsProblem(): string | undefined {
  for (const path of [treeSitter, library, join(headers, 'tree_sitter/api.h')]) if (!existsSync(path)) return `no ${path}`
  if (Bun.which('cc') === null) return 'no cc'
  const version = run([treeSitter, '--version'], here).trim()
  if (version !== `tree-sitter ${expectedVersion}`) return `${treeSitter} is "${version}", and the bar is tree-sitter ${expectedVersion}`
  if (!realpathSync(library).includes(`/${expectedVersion}/`)) return `${library} is ${realpathSync(library)}, and the bar is tree-sitter ${expectedVersion}`
  return undefined
}

// The scanner's tables as C arrays, see scanner.c. Throws when the tokens of grammar.ts are not the terminals that
// a text can hold, without the end of input, in the order of bison's numbers, then the comment.
function scannerTablesHeader(): string {
  const {scannerStart, scannerClassCount, scannerClassOfByte, scannerNext, scannerKindOfState} = tables
  const terminals = tables.textTerminals.slice(1)
  const expected = [...terminals.map(terminal => tables.symbolNames[terminal]!), 'COMMENT']
  if (expected.length !== tokenNames.length || expected.some((name, index) => name !== tokenNames[index])) throw new Error(`the tokens of grammar.ts are not the tables' terminals in bison's order:\n${tokenNames.join(' ')}\n${expected.join(' ')}`)
  // White space never ends a token of scanner.c, which passes over it before it starts the table, and no token ends
  // in a state without a kind. Both get a number that is no token.
  const tokenOfState = Array.from(scannerKindOfState, kind => kind === commentKind ? tokenNames.length - 1 : terminals.includes(kind) ? terminals.indexOf(kind) : 0xffff)
  const array = (type: string, name: string, values: ArrayLike<number>): string => `static const ${type} ${name}[${values.length}] = {${Array.from(values).join(',')}};\n`
  return '/* Written by build.ts from grammar/tables.json. */\n'
    + `enum { scanner_start = ${scannerStart}, scanner_class_count = ${scannerClassCount} };\n`
    + array('unsigned char', 'scanner_class_of_byte', scannerClassOfByte) + array('short', 'scanner_next', scannerNext) + array('unsigned short', 'scanner_token_of_state', tokenOfState)
}

// Builds the driver unless the last build was made from the same sources, and returns the path of the compiled
// program. Throws when a tool is missing.
export function buildDriver(): string {
  const folder = join(scratchFolder(), 'tree-sitter')
  const driverPath = join(folder, 'driver'), keyPath = join(folder, 'built-from.txt')
  const tablesHeader = scannerTablesHeader()
  const grammarText = `${JSON.stringify(grammar, null, 1)}\n`
  const sources = ['scanner.c', 'driver.c'].map(name => readFileSync(join(here, name), 'utf8'))
  const key = String(hashText([grammarText, ...sources, tablesHeader, expectedVersion].join('\u0000')))
  if (existsSync(driverPath) && existsSync(keyPath) && readFileSync(keyPath, 'utf8') === key) return driverPath
  const problem = toolsProblem()
  if (problem !== undefined) throw new Error(`cannot build tree-sitter's parser: ${problem}`)
  mkdirSync(folder, {recursive: true})
  writeFileSync(join(folder, 'grammar.json'), grammarText)
  // `generate` reports a conflict that the precedences leave open as an error, and warns of nothing here.
  const generateOutput = run([treeSitter, 'generate', 'grammar.json'], folder)
  if (generateOutput.trim() !== '') throw new Error(`tree-sitter generate reports:\n${generateOutput}`)
  writeFileSync(join(folder, 'scanner-tables.h'), tablesHeader)
  // The generated parser.c has a variable that it never reads, so only the two files of this folder are compiled
  // with warnings as errors.
  const include = [`-I${headers}`, `-I${join(folder, 'src')}`, `-I${folder}`]
  run(['cc', '-O2', '-w', ...include, '-c', '-o', join(folder, 'parser.o'), join(folder, 'src/parser.c')], folder)
  run(['cc', '-O2', '-Wall', '-Werror', ...include, '-o', driverPath, join(here, 'driver.c'), join(here, 'scanner.c'), join(folder, 'parser.o'), library], folder)
  writeFileSync(keyPath, key)
  return driverPath
}

if (import.meta.main) {
  const driverPath = buildDriver()
  console.log(`tree-sitter ${expectedVersion}'s parser for miniml is ${driverPath}`)
}
