// One command for everything that has to hold in learn/: the type check of this folder, the lint of
// lab/recovery-parser, and every check script of learn/ and of the folders in it.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo and without RECOVERY_FINAL:
//   bun lab/recovery-parser/learn/check-all.ts [--only <part of a name>]
// It takes one to one and a half minutes on an 18 core machine with other jobs running and the cache of the
// standard set in place, 57 to 90 s in six runs, and about half a minute more the first time, for that cache and
// for the intended stacks. Up to 4 commands run at a time, and one of the checks
// uses 4 worker threads, so the command stays within 8 threads.
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
const checks = [
  'check-tables.ts', 'check-parser.ts', 'check-data.ts', 'check-deep.ts', 'check-guard.ts', 'check-commands.ts', 'handwritten/check.ts', 'search/check.ts',
  'soft/check-twin.ts', 'soft/check-gradient.ts', 'soft/check-circuit.ts', 'soft/check-train.ts', 'arms/check.ts',
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
