// One command for everything that has to hold in learn/: the type check of this folder, the lint of
// lab/recovery-parser, and the check scripts of learn/ and of the folders in it, final/check.ts of the final scoring
// among them. The one check that it leaves out is arms/holes/check-search.ts, which takes about 8 minutes.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo and without RECOVERY_FINAL:
//   bun lab/recovery-parser/learn/check-all.ts [--only <part of a name>]
// Two checks compare with saved tables and fail in a scratch folder without them: arms/generic/check.ts with the
// tables of arms/plain-pass/run.ts, and arms/combined/check.ts with the tables of
// `arms/extra-facts/run.ts --trainer three-base --settings all --seeds 11,12,13,14,15`.
//
// It takes a bit over two minutes on an 18 core machine with little else running (130 s and 131 s in two runs), and
// longer with other jobs running, with the cache of the standard set in place, and about half a minute more the
// first time, for that cache and for the intended stacks. arms/combined/check.ts alone is that long, and without it
// the command took 64 s. Up to 4 commands run at a time, and three of the checks use 4 worker threads each,
// soft/check-train.ts, arms/generic/check.ts and arms/combined/check.ts, so the command stays within 13 threads.
//
// `bun run check` of the repo type-checks lab/recovery-parser without learn/, since the dataset's tsconfig.json only
// includes its own files. This command is what type-checks learn/.
//
// A check passes when it ends with the exit code 0 and its last line is "Every check passed.". The output of every
// command goes to <RECOVERY_SCRATCH>/check-all/<name>.txt. The last line of this command says whether all passed.
import {mkdirSync, writeFileSync} from 'node:fs'
import {join, relative, resolve} from 'node:path'
import {optionOf, refuseUnknownOptions} from './data.ts'

const root = resolve(import.meta.dir, '../../..')
const here = relative(root, import.meta.dir)
// arms/combined/check.ts takes the longest by far, so it comes first and the other checks run next to it.
// final/check.ts comes last: it fails when a file is added to the cache folder while it runs, which another check
// does the first time, when it makes the cache of the standard set.
const checks = [
  'arms/combined/check.ts',
  'check-tables.ts', 'check-parser.ts', 'check-data.ts', 'check-deep.ts', 'check-guard.ts', 'check-commands.ts', 'handwritten/check.ts', 'search/check.ts',
  'soft/check-twin.ts', 'soft/check-gradient.ts', 'soft/check-circuit.ts', 'soft/check-train.ts', 'arms/check.ts', 'arms/generic/check.ts', 'arms/spare-states/check.ts',
  'final/check.ts',
]
const commands: {name: string, command: string[], isCheck: boolean}[] = [
  {name: 'tsc', command: ['bunx', 'tsc', '-p', here], isCheck: false},
  {name: 'oxlint', command: ['bunx', 'oxlint', '--type-aware', relative(root, resolve(import.meta.dir, '..'))], isCheck: false},
  ...checks.map(check => ({name: check, command: ['bun', join(here, check)], isCheck: true})),
]
refuseUnknownOptions('check-all.ts', ['--only'])
const only = optionOf('--only')
const chosen = only === undefined ? commands : commands.filter(({name}) => name.includes(only))
if (chosen.length === 0) throw new Error(`--only ${only} names none of: ${commands.map(({name}) => name).join(', ')}`)

const scratch = process.env['RECOVERY_SCRATCH']
if (scratch === undefined || scratch === '') throw new Error('set RECOVERY_SCRATCH to a folder outside the repo: the checks read the cache of the samples there, and the outputs go there')
if (process.env['RECOVERY_FINAL'] !== undefined) throw new Error('run check-all.ts without the environment variable RECOVERY_FINAL: the checks do not read the test split')
const outputFolder = join(scratch, 'check-all')
mkdirSync(outputFolder, {recursive: true})

const started = performance.now()
const results: {name: string, passed: boolean, seconds: number, why: string}[] = []
let next = 0
async function runNext() {
  while (next < chosen.length) {
    const {name, command, isCheck} = chosen[next++]!
    const commandStarted = performance.now()
    const child = Bun.spawn(command, {cwd: root, stdout: 'pipe', stderr: 'pipe'})
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const output = `${stdout}${stderr}`
    writeFileSync(join(outputFolder, `${name.replaceAll('/', '-').replace(/\.ts$/, '')}.txt`), `${command.join(' ')}\n${output}\nexit code ${exitCode}\n`)
    const lastLine = stdout.trimEnd().split('\n').at(-1) ?? ''
    const why = exitCode !== 0 ? `exit code ${exitCode}` : isCheck && lastLine !== 'Every check passed.' ? `its last line is ${JSON.stringify(lastLine.slice(0, 120))}` : ''
    const result = {name, passed: why === '', seconds: (performance.now() - commandStarted) / 1000, why}
    results.push(result)
    console.log(`${result.passed ? 'passed' : 'FAILED'}  ${result.seconds.toFixed(0).padStart(4)} s  ${command.join(' ')}${result.passed ? '' : `  (${why})`}`)
    if (!result.passed) console.log(output.trimEnd().split('\n').slice(-12).map(line => `    ${line.slice(0, 400)}`).join('\n'))
  }
}
await Promise.all(Array.from({length: 4}, runNext))

const failed = results.filter(result => !result.passed)
console.log(`${results.length} commands in ${((performance.now() - started) / 1000).toFixed(0)} s. Their outputs are in ${outputFolder}.`)
console.log(failed.length === 0 ? 'Every check passed.' : `${failed.length} of ${results.length} commands FAILED: ${failed.map(result => result.name).join(', ')}.`)
if (failed.length > 0) process.exitCode = 1
