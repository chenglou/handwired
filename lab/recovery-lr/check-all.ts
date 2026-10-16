// One command for everything that has to hold in lab/recovery-lr: the type check of this folder, the lint of the
// whole folder, the check scripts and the test of the dataset's invariants.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/check-all.ts [--only <part of a name>]
// It takes about a minute. The commands run one after another: a command of bun or of the type check uses more
// than one thread, so 4 at a time were more than the 4 threads that the experiment's commands may use.
//
// check-tools.ts and check-changed.ts need bison 2.3, flex 2.6.4 and cc. Where the tools are missing, the two say
// so and pass, since the committed grammar/tables.json needs no tool: the other checks still run.
//
// A check passes when it ends with the exit code 0 and its last line is "Every check passed.". The output of every
// command goes to <RECOVERY_LR_SCRATCH>/check-all/<name>.txt. The last line of this command says whether all
// passed. A folder inside lab/recovery-lr with checks of its own adds them to `checks` below.
import {mkdirSync, writeFileSync} from 'node:fs'
import {join, relative, resolve} from 'node:path'
import {scratchFolder} from './grammar/build.ts'

const root = resolve(import.meta.dir, '../..')
const here = relative(root, import.meta.dir)
const checks: {name: string, arguments?: string[]}[] = [
  {name: 'check-cells.ts'},
  {name: 'check-samples.ts'},
  {name: 'check-dataset.ts'},
  {name: 'check-language.ts'},
  {name: 'check-guard.ts'},
  {name: 'check-tools.ts', arguments: ['--skip-without-tools']},
  {name: 'check-changed.ts', arguments: ['--skip-without-tools']},
]
const commands: {name: string, command: string[], isCheck: boolean}[] = [
  {name: 'tsc', command: ['bunx', 'tsc', '-p', here], isCheck: false},
  {name: 'oxlint', command: ['bunx', 'oxlint', '--type-aware', here], isCheck: false},
  {name: 'invariants.test.ts', command: ['bun', 'test', join(here, 'invariants.test.ts')], isCheck: false},
  ...checks.map(check => ({name: check.name, command: ['bun', join(here, check.name), ...(check.arguments ?? [])], isCheck: true})),
]
const options = process.argv.slice(2)
if (options.length !== 0 && (options.length !== 2 || options[0] !== '--only')) throw new Error('usage: bun lab/recovery-lr/check-all.ts [--only <part of a name>]')
const only = options[1]
const chosen = only === undefined ? commands : commands.filter(({name}) => name.includes(only))
if (chosen.length === 0) throw new Error(`--only ${only} names none of: ${commands.map(({name}) => name).join(', ')}`)

const outputFolder = join(scratchFolder(), 'check-all')
mkdirSync(outputFolder, {recursive: true})

const started = performance.now()
const results: {name: string, passed: boolean}[] = []
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
    results.push({name, passed: why === ''})
    console.log(`${why === '' ? 'passed' : 'FAILED'}  ${((performance.now() - commandStarted) / 1000).toFixed(0).padStart(4)} s  ${command.join(' ')}${why === '' ? '' : `  (${why})`}`)
    if (why !== '') console.log(output.trimEnd().split('\n').slice(-12).map(line => `    ${line.slice(0, 400)}`).join('\n'))
    else if (output.includes('The tools are not here')) console.log(`    ${output.trimEnd().split('\n')[0]}`)
  }
}
await runNext()

const failed = results.filter(result => !result.passed)
console.log(`${results.length} commands in ${((performance.now() - started) / 1000).toFixed(0)} s. Their outputs are in ${outputFolder}.`)
console.log(failed.length === 0 ? 'Every check passed.' : `${failed.length} of ${results.length} commands FAILED: ${failed.map(result => result.name).join(', ')}.`)
if (failed.length > 0) process.exitCode = 1
