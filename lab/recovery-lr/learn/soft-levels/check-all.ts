// One command for the checks of the twin of levels: the check of ../soft that a twin with exact tables is the exact
// parser, for the design's form and for the variant `pusherBelow`, and the two checks of this folder.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/learn/soft-levels/check-all.ts
// The four commands run at once, one thread each, and take about two minutes. A check passes when it ends with the
// exit code 0 and its last line is "Every check passed.". The output of every command goes to
// <RECOVERY_LR_SCRATCH>/learn/soft-levels/check-all/<name>.txt. The type check and the lint of this folder are part
// of ../check-all.ts.
import {writeFileSync} from 'node:fs'
import {join, relative, resolve} from 'node:path'
import {learnFolder} from '../options.ts'

const root = resolve(import.meta.dir, '../../..')
const here = relative(root, import.meta.dir)
const commands: {name: string, command: string[]}[] = [
  {name: 'exact-parser', command: ['bun', join(here, '../soft/check-twin.ts'), '--twin', join(here, 'levels-twin.ts')]},
  {name: 'exact-parser-pusher-below', command: ['bun', join(here, '../soft/check-twin.ts'), '--twin', join(here, 'pusher-below-twin.ts')]},
  {name: 'check-twin', command: ['bun', join(here, 'check-twin.ts')]},
  {name: 'check-gradient', command: ['bun', join(here, 'check-gradient.ts')]},
]
const outputFolder = learnFolder('soft-levels', 'check-all')
const started = performance.now()
const results = await Promise.all(commands.map(async ({name, command}) => {
  const commandStarted = performance.now()
  const child = Bun.spawn(command, {cwd: root, stdout: 'pipe', stderr: 'pipe'})
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  writeFileSync(join(outputFolder, `${name}.txt`), `${command.join(' ')}\n${output}\nexit code ${exitCode}\n`)
  const lastLine = stdout.trimEnd().split('\n').at(-1) ?? ''
  const why = exitCode !== 0 ? `exit code ${exitCode}` : lastLine !== 'Every check passed.' ? `its last line is ${JSON.stringify(lastLine.slice(0, 120))}` : ''
  console.log(`${why === '' ? 'passed' : 'FAILED'}  ${((performance.now() - commandStarted) / 1000).toFixed(0).padStart(4)} s  ${command.join(' ')}${why === '' ? '' : `  (${why})`}`)
  if (why !== '') console.log(output.trimEnd().split('\n').slice(-12).map(line => `    ${line.slice(0, 400)}`).join('\n'))
  return {name, passed: why === ''}
}))
const failed = results.filter(result => !result.passed)
console.log(`${results.length} commands in ${((performance.now() - started) / 1000).toFixed(0)} s. Their outputs are in ${outputFolder}.`)
console.log(failed.length === 0 ? 'Every check passed.' : `${failed.length} of ${results.length} commands FAILED: ${failed.map(result => result.name).join(', ')}.`)
if (failed.length > 0) process.exitCode = 1
