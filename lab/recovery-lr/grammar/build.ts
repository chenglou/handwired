// Runs bison and flex on miniml.y and miniml.l, compiles driver.c with the two generated files, and writes the
// arrays of the generated files to tables.json, which is committed. Everything else in lab/recovery-lr reads
// tables.json and needs no bison.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/grammar/build.ts           writes grammar/tables.json
//   bun lab/recovery-lr/grammar/build.ts --check   builds again and fails when the result is not the committed file
// The generated C files, bison's report (miniml.output) and the compiled driver go to <RECOVERY_LR_SCRATCH>/tools.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

const grammarFolder = import.meta.dir
export const tablesPath = join(grammarFolder, 'tables.json')
const bison = '/usr/bin/bison'
const flex = '/usr/bin/flex'
const expectedVersions = {bison: 'bison (GNU Bison) 2.3', flex: 'flex 2.6.4'}

// The folder for files that are no code of the repo, e.g. the generated C files and the inputs of the checks.
export function scratchFolder(): string {
  const folder = process.env['RECOVERY_LR_SCRATCH']
  if (folder === undefined || folder === '') throw new Error('set RECOVERY_LR_SCRATCH to a folder outside the repo: the generated C files and the files of the checks go there')
  return folder
}

function run(command: string[], cwd: string): string {
  const child = Bun.spawnSync(command, {cwd, stdout: 'pipe', stderr: 'pipe'})
  const output = `${child.stdout.toString()}${child.stderr.toString()}`
  if (child.exitCode !== 0) throw new Error(`${command.join(' ')} failed with exit code ${child.exitCode}:\n${output}`)
  return output
}

// Why the tools cannot be used here, e.g. 'no /usr/bin/bison', or undefined when they can. The tables depend on the
// versions: another bison numbers the states in another order.
export function toolsProblem(): string | undefined {
  if (!existsSync(bison)) return `no ${bison}`
  if (!existsSync(flex)) return `no ${flex}`
  if (Bun.which('cc') === null) return 'no cc'
  const bisonVersion = run([bison, '--version'], grammarFolder).split('\n')[0]!
  if (bisonVersion !== expectedVersions.bison) return `${bison} is "${bisonVersion}", and the tables are those of "${expectedVersions.bison}"`
  const flexVersion = run([flex, '--version'], grammarFolder).trim()
  if (!flexVersion.startsWith(expectedVersions.flex)) return `${flex} is "${flexVersion}", and the tables are those of "${expectedVersions.flex}"`
  return undefined
}

// What every rule of miniml.l returns, in the order of the rules, e.g. ['LET', 'REC', ...]. flex numbers the rules in
// this order from 1, and the generated file has the names only inside its actions.
function scannerRuleNames(): string[] {
  const rules = readFileSync(join(grammarFolder, 'miniml.l'), 'utf8').split('\n%%\n')[1]
  if (rules === undefined) throw new Error('miniml.l has no rules section')
  return rules.split('\n').filter(line => line.trim() !== '').map(line => {
    const name = /\sreturn ([A-Z]+);$/.exec(line)?.[1]
    if (name === undefined) throw new Error(`miniml.l: the rule "${line}" is not of the form "pattern  return NAME;"`)
    return name
  })
}

export type Tools = {
  // The compiled reference program, see driver.c.
  driverPath: string
  // bison's report of the automaton, with the conflicts that the precedence settled.
  reportPath: string
  // What tables.json holds for these sources.
  tablesText: string
}

// Runs the tools in <scratch>/tools and returns what they made. bison and flex must report nothing: no conflict that
// the precedence leaves open, and a scanner that never backs up.
export function buildTools(scratch: string): Tools {
  const problem = toolsProblem()
  if (problem !== undefined) throw new Error(`cannot build: ${problem}`)
  const folder = join(scratch, 'tools')
  mkdirSync(folder, {recursive: true})
  const bisonOutput = run([bison, '-d', '-v', '--report=all', '-o', join(folder, 'miniml.tab.c'), join(grammarFolder, 'miniml.y')], folder)
  if (bisonOutput.trim() !== '') throw new Error(`bison reports:\n${bisonOutput}`)
  // -Cfe: one full table over flex's own classes of bytes. -8: all 256 bytes. -b: write lex.backup.
  const flexOutput = run([flex, '-Cfe', '-8', '-b', '-o', join(folder, 'lex.yy.c'), join(grammarFolder, 'miniml.l')], folder)
  if (flexOutput.trim() !== '') throw new Error(`flex reports:\n${flexOutput}`)
  const backup = readFileSync(join(folder, 'lex.backup'), 'utf8').trim()
  if (backup !== 'No backing up.') throw new Error(`the scanner backs up, and the plain scanner of parser.ts does not:\n${backup}`)
  const driverPath = join(folder, 'driver')
  run(['cc', '-O2', '-w', `-I${folder}`, '-o', driverPath, join(grammarFolder, 'driver.c')], folder)
  const dump = JSON.parse(run([driverPath, 'tables'], folder)) as Record<string, unknown>
  dump['scannerRuleNames'] = scannerRuleNames()
  // One line per array, so that a change of the grammar shows as a few changed lines.
  const tablesText = `{\n${Object.entries(dump).map(([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`).join(',\n')}\n}\n`
  return {driverPath, reportPath: join(folder, 'miniml.output'), tablesText}
}

if (import.meta.main) {
  const check = process.argv.includes('--check')
  const unknown = process.argv.slice(2).filter(argument => argument !== '--check')
  if (unknown.length > 0) throw new Error(`build.ts does not know ${unknown.join(' ')}`)
  const {tablesText} = buildTools(scratchFolder())
  if (!check) {
    writeFileSync(tablesPath, tablesText)
    console.log(`wrote ${tablesPath}`)
  } else if (readFileSync(tablesPath, 'utf8') === tablesText) {
    console.log('grammar/tables.json is what bison 2.3 and flex 2.6.4 make of miniml.y and miniml.l.')
    console.log('Every check passed.')
  } else {
    console.log('grammar/tables.json is NOT what the tools make of miniml.y and miniml.l. Run build.ts without --check and look at the difference.')
    process.exitCode = 1
  }
}
