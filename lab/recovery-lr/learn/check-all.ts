// One command for everything that has to hold in lab/recovery-lr/learn: the type check of this folder, its lint,
// its check scripts, and the checks of the twins and of the bars in its folders.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/learn/check-all.ts [--only <part of a name>]
// It takes about eight minutes on a machine that does nothing else, and took 16 with other jobs running. The
// commands run one after another: some of them use 4 worker threads, e.g.
// search/check.ts and soft/check-train.ts, so the command never has more than 4 threads at work.
//
// The checks of the yacc bar, of the cheapest repair and of tree-sitter need bison 2.3, flex 2.6.4, cc and
// tree-sitter, and say so where a tool is missing.
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
const check = (name: string, ...options: string[]): Command => ({name: [name, ...options.filter(option => !option.startsWith('--')).map(option => option.split('/').at(-1)!)].join(' '), command: ['bun', join(here, name), ...options], isCheck: true})
const commands: Command[] = [
  {name: 'tsc', command: ['bunx', 'tsc', '-p', here], isCheck: false},
  {name: 'oxlint', command: ['bunx', 'oxlint', '--type-aware', here], isCheck: false},
  check('check-tables.ts'), check('check-parser.ts'), check('check-score.ts'), check('check-columns.ts'), check('search/check.ts'), check('check-commands.ts'),
  // The twin for training, the trainer and the recipe.
  check('soft/check-twin.ts'), check('soft/check-gradient.ts'), check('soft/check-train.ts'),
  // The twin with a mix of states per level, in both of its forms: the commands of soft-levels/check-all.ts.
  check('soft/check-twin.ts', '--twin', join(here, 'soft-levels/levels-twin.ts')), check('soft/check-twin.ts', '--twin', join(here, 'soft-levels/pusher-below-twin.ts')),
  check('soft-levels/check-twin.ts'), check('soft-levels/check-gradient.ts'),
  // The bars.
  check('bars/yacc/check.ts'), check('bars/panic/check.ts'), check('bars/rules/check.ts'), check('bars/repair/check.ts'), check('bars/tree-sitter/check.ts'),
]
refuseUnknownOptions('check-all.ts', ['--only'])
const only = optionOf('--only')
const chosen = only === undefined ? commands : commands.filter(({name}) => name.includes(only))
if (chosen.length === 0) throw new Error(`--only ${only} names none of: ${commands.map(({name}) => name).join(', ')}`)

const outputFolder = learnFolder('check-all')
const started = performance.now()
const results: {name: string, passed: boolean}[] = []
async function runCommand({name, command, isCheck}: Command) {
  const commandStarted = performance.now()
  const child = Bun.spawn(command, {cwd: root, stdout: 'pipe', stderr: 'pipe'})
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  writeFileSync(join(outputFolder, `${name.replaceAll(/[/ ]/g, '-').replaceAll('.ts', '')}.txt`), `${command.join(' ')}\n${output}\nexit code ${exitCode}\n`)
  const lastLine = stdout.trimEnd().split('\n').at(-1) ?? ''
  const why = exitCode !== 0 ? `exit code ${exitCode}` : isCheck && lastLine !== 'Every check passed.' ? `its last line is ${JSON.stringify(lastLine.slice(0, 120))}` : ''
  results.push({name, passed: why === ''})
  console.log(`${why === '' ? 'passed' : 'FAILED'}  ${((performance.now() - commandStarted) / 1000).toFixed(0).padStart(4)} s  ${command.join(' ')}${why === '' ? '' : `  (${why})`}`)
  if (why !== '') console.log(output.trimEnd().split('\n').slice(-12).map(line => `    ${line.slice(0, 400)}`).join('\n'))
}
for (const command of chosen) await runCommand(command)

const failed = results.filter(result => !result.passed)
console.log(`${results.length} commands in ${((performance.now() - started) / 1000).toFixed(0)} s. Their outputs are in ${outputFolder}.`)
console.log(failed.length === 0 ? 'Every check passed.' : `${failed.length} of ${results.length} commands FAILED: ${failed.map(result => result.name).join(', ')}.`)
if (failed.length > 0) process.exitCode = 1
