// Checks that the code outside the folder of the held-back sets stays away from them:
// - No TypeScript file of lab/recovery-lr outside that folder names the folder in its code, e.g. in an import or
//   in a path that it reads. Comments may name it.
// - No file names the skeptic's probe of hand-written mistakes or its outputs, which nobody on the training side
//   and no author of a bar may use to choose anything.
// The check reads names only. It cannot see a path that is put together at run time.
//
// Run from the repo root: bun lab/recovery-lr/check-guard.ts
import {readFileSync, readdirSync} from 'node:fs'
import {join, relative, sep} from 'node:path'

// The names are put together here, so that this file does not hold them as one word.
const heldBackFolder = ['held', 'back'].join('-')
const probeNames = [['sk', 'mistakes'].join('-'), ['out', 'mistakes'].join('-')]

const folder = import.meta.dir
const files = readdirSync(folder, {recursive: true, encoding: 'utf8'}).filter(path => path.endsWith('.ts') && !path.split(sep).includes('node_modules'))
const problems: string[] = []
let checked = 0
for (const path of files) {
  const insideHeldBack = path.split(sep)[0] === heldBackFolder
  const source = readFileSync(join(folder, path), 'utf8')
  // Without comments: a block comment, and a line comment that starts a line or follows a space.
  const code = source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|\s)\/\/.*$/gm, '$1')
  checked++
  if (!insideHeldBack && code.includes(heldBackFolder)) problems.push(`${relative(folder, join(folder, path))} names the folder ${heldBackFolder} in its code`)
  for (const name of probeNames) if (source.includes(name)) problems.push(`${relative(folder, join(folder, path))} names ${name}, the skeptic's probe of hand-written mistakes`)
}
for (const problem of problems) console.log(`PROBLEM: ${problem}`)
console.log(`${checked} TypeScript files of lab/recovery-lr: outside the folder ${heldBackFolder}, none names that folder in its code, and none names the skeptic's probe.`)
console.log(problems.length === 0 ? 'Every check passed.' : `${problems.length} problems.`)
if (problems.length > 0) process.exitCode = 1
