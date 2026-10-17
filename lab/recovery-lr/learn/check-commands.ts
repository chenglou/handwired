// Runs the commands of this folder as commands, on small sets, and compares what they print with counts that are
// made here: a command that fails, or that prints another score than scoreTables gives, fails the check.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set: bun lab/recovery-lr/learn/check-commands.ts
import {join, relative, resolve} from 'node:path'
import {loadPacked} from './data.ts'
import {learnFolder} from './options.ts'
import {baseTables, loadTables} from './recovery-tables.ts'
import {scoreRow, scoreTables} from './score.ts'

const problems: string[] = []
const problem = (text: string) => {
  problems.push(text)
  console.log(`PROBLEM: ${text}`)
}
const root = resolve(import.meta.dir, '../../..')
const here = relative(root, import.meta.dir)
const folder = learnFolder('check-commands')

// Runs a command of this folder and returns what it prints, or undefined when it fails.
function run(command: string, ...options: string[]): string | undefined {
  const child = Bun.spawnSync(['bun', join(here, command), ...options], {cwd: root, stdout: 'pipe', stderr: 'pipe'})
  if (child.exitCode === 0) return child.stdout.toString()
  problem(`${command} ${options.join(' ')} fails with exit code ${child.exitCode}: ${child.stderr.toString().trim().split('\n').slice(-3).join(' | ')}`)
  return undefined
}
const fails = (command: string, ...options: string[]): boolean => Bun.spawnSync(['bun', join(here, command), ...options], {cwd: root, stdout: 'pipe', stderr: 'pipe'}).exitCode !== 0

const tablesFile = join(folder, 'searched.json')
const searchOutput = run('search/search.ts', '--train', '600', '--validation', '300', '--passes', '1', '--flag', '--count', '--out', tablesFile)
if (searchOutput !== undefined) {
  const {tables, note} = loadTables(tablesFile)
  const validation = loadPacked('validation', 300, tables)
  const row = scoreRow('validation', scoreTables(tables, validation).score)
  if (!searchOutput.includes(row)) problem('search.ts prints another score of its tables on the validation samples than scoreTables gives')
  if (!tables.firstOnLineFlag || !note.startsWith('search-flag-count')) problem(`search.ts --flag --count saved tables without the flag, or with the note ${JSON.stringify(note)}`)
  const expected = scoreRow('the tables', scoreTables(tables, validation).score)
  const scoreOutput = run('score.ts', '--tables', tablesFile, '--count', '300')
  if (scoreOutput !== undefined && !scoreOutput.includes(expected)) problem('score.ts prints another row than scoreTables gives')
  const reportOutput = run('report.ts', '--tables', tablesFile, '--count', '300', '--cells', '12')
  if (reportOutput !== undefined && (!reportOutput.includes(expected) || !reportOutput.includes('The 12 open cells that the most samples read') || !/after `[^`]+`, [^:]+, at [^:]+: /.test(reportOutput))) problem('report.ts does not print the score of the tables and its most read cells in words')
  const perSampleOutput = run('search/per-sample.ts', '--tables', tablesFile, '--count', '40', '--width', '16')
  if (perSampleOutput !== undefined && !/a search per sample has all three \d+\.\d\d, whole \d+\.\d\d/.test(perSampleOutput)) problem('per-sample.ts prints no score')
}
const barsOutput = run('bars.ts', '--train', '300', '--validation', '300')
if (barsOutput !== undefined) {
  const asItIs = scoreRow('the parser as it is', scoreTables(baseTables(), loadPacked('validation', 300)).score)
  if (!barsOutput.includes(asItIs) || !barsOutput.includes('| panic mode, with the count |') || barsOutput.split('\n').filter(line => line.startsWith('| ')).length !== 10) problem('bars.ts does not print its eight rows, or another row for the parser as it is than scoreTables gives')
}
const pickedOutput = run('picked-terminals.ts', '--train', '3000')
if (pickedOutput !== undefined && !pickedOutput.includes('The rule picks')) problem('picked-terminals.ts does not say what the rule picks')
// An option that a command does not have is an error, and so is a search from a file without a name for its result.
if (!fails('score.ts', '--split', 'test') || !fails('report.ts', '--table', tablesFile) || !fails('search/search.ts', '--from', tablesFile) || !fails('bars.ts', '--count', '3')) problem('a command runs with an option that it does not have')

console.log(`The commands search.ts, score.ts, report.ts, per-sample.ts, bars.ts and picked-terminals.ts run on small sets, print the scores that scoreTables gives, and fail for an option that they do not have. Their files are in ${folder}.`)
console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
