// One command for everything that has to hold in lab/recovery-lr/learn: the type check of this folder, its lint,
// and its check scripts.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/learn/check-all.ts [--only <part of a name>]
// It takes about a minute. The type check, the lint and the three checks without worker threads run 4 at a time.
// search/check.ts and check-commands.ts use 4 worker threads and run after them, one at a time, so that the
// command never has more than 4 threads at work.
//
// A check passes when it ends with the exit code 0 and its last line is "Every check passed.". The output of every
// command goes to <RECOVERY_LR_SCRATCH>/learn/check-all/<name>.txt. The last line of this command says whether all
// passed. The checks of the tables, the plain parser, the labels and the samples are ../check-all.ts.
import {writeFileSync} from 'node:fs'
import {join, relative, resolve} from 'node:path'
import {learnFolder, optionOf, refuseUnknownOptions} from './options.ts'

const root = resolve(import.meta.dir, '../../..')
const here = relative(root, import.meta.dir)
type Command = {name: string, command: string[], isCheck: boolean}
const check = (name: string): Command => ({name, command: ['bun', join(here, name)], isCheck: true})
const atOnce: Command[] = [
  {name: 'tsc', command: ['bunx', 'tsc', '-p', here], isCheck: false},
  {name: 'oxlint', command: ['bunx', 'oxlint', '--type-aware', here], isCheck: false},
  check('check-tables.ts'), check('check-parser.ts'), check('check-score.ts'),
]
const oneAtATime: Command[] = [check('search/check.ts'), check('check-commands.ts')]
refuseUnknownOptions('check-all.ts', ['--only'])
const only = optionOf('--only')
const chosen = (commands: Command[]): Command[] => only === undefined ? commands : commands.filter(({name}) => name.includes(only))
if (chosen([...atOnce, ...oneAtATime]).length === 0) throw new Error(`--only ${only} names none of: ${[...atOnce, ...oneAtATime].map(({name}) => name).join(', ')}`)

const outputFolder = learnFolder('check-all')
const started = performance.now()
const results: {name: string, passed: boolean}[] = []
async function runCommand({name, command, isCheck}: Command) {
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
}
const waiting = chosen(atOnce)
await Promise.all(Array.from({length: 4}, async () => {
  for (let command = waiting.shift(); command !== undefined; command = waiting.shift()) await runCommand(command)
}))
for (const command of chosen(oneAtATime)) await runCommand(command)

const failed = results.filter(result => !result.passed)
console.log(`${results.length} commands in ${((performance.now() - started) / 1000).toFixed(0)} s. Their outputs are in ${outputFolder}.`)
console.log(failed.length === 0 ? 'Every check passed.' : `${failed.length} of ${results.length} commands FAILED: ${failed.map(result => result.name).join(', ')}.`)
if (failed.length > 0) process.exitCode = 1
