// Runs bison on miniml-errors.y and flex on the base grammar's miniml.l, compiles driver.c with the two generated
// files, and writes the arrays of the generated parser to tables.json, which is committed. yacc-parser.ts reads
// tables.json and needs no bison.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/learn/bars/yacc/build.ts           writes tables.json
//   bun lab/recovery-lr/learn/bars/yacc/build.ts --check   builds again and fails when the result is not the committed file
// The generated C files, bison's report (miniml.output) and the compiled driver go to <RECOVERY_LR_SCRATCH>/yacc-tools.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {scratchFolder, toolsProblem} from '../../../grammar/build.ts'

const folderOfBar = import.meta.dir
export const grammarPath = join(folderOfBar, 'miniml-errors.y')
export const tablesPath = join(folderOfBar, 'tables.json')
const scannerPath = join(folderOfBar, '../../../grammar/miniml.l')

function run(command: string[], cwd: string): string {
  const child = Bun.spawnSync(command, {cwd, stdout: 'pipe', stderr: 'pipe'})
  const output = `${child.stdout.toString()}${child.stderr.toString()}`
  if (child.exitCode !== 0) throw new Error(`${command.join(' ')} failed with exit code ${child.exitCode}:\n${output}`)
  return output
}

export type Tools = {
  // The compiled reference program, see driver.c.
  driverPath: string
  // bison's report of the automaton.
  reportPath: string
  // What tables.json holds for the grammar.
  tablesText: string
  // What bison printed, e.g. the number of conflicts that no `%expect` covers. Empty for the committed grammar.
  bisonOutput: string
}

// Runs the tools on a grammar in `folder` and returns what they made. With `allowBisonOutput`, a grammar that bison
// warns about is built all the same, which is for trying a grammar out.
export function buildTools(grammar: string, folder: string, allowBisonOutput = false): Tools {
  const problem = toolsProblem()
  if (problem !== undefined) throw new Error(`cannot build: ${problem}`)
  mkdirSync(folder, {recursive: true})
  const bisonOutput = run(['/usr/bin/bison', '-d', '-v', '--report=all', '-o', join(folder, 'miniml.tab.c'), grammar], folder)
  if (bisonOutput.trim() !== '' && !allowBisonOutput) throw new Error(`bison reports:\n${bisonOutput}`)
  // The scanner is the base grammar's, with the same options as ../../../grammar/build.ts.
  const flexOutput = run(['/usr/bin/flex', '-Cfe', '-8', '-b', '-o', join(folder, 'lex.yy.c'), scannerPath], folder)
  if (flexOutput.trim() !== '') throw new Error(`flex reports:\n${flexOutput}`)
  const driverPath = join(folder, 'driver')
  run(['cc', '-O2', '-w', `-I${folder}`, '-o', driverPath, join(folderOfBar, 'driver.c')], folder)
  const dump = JSON.parse(run([driverPath, 'tables'], folder)) as Record<string, unknown>
  // One line per array, so that a change of the grammar shows as a few changed lines.
  const tablesText = `{\n${Object.entries(dump).map(([name, value]) => `${JSON.stringify(name)}: ${JSON.stringify(value)}`).join(',\n')}\n}\n`
  return {driverPath, reportPath: join(folder, 'miniml.output'), tablesText, bisonOutput}
}

// The tools for the committed grammar, in <RECOVERY_LR_SCRATCH>/yacc-tools.
export const buildCommittedTools = (): Tools => buildTools(grammarPath, join(scratchFolder(), 'yacc-tools'))

if (import.meta.main) {
  const check = process.argv.includes('--check')
  const unknown = process.argv.slice(2).filter(argument => argument !== '--check')
  if (unknown.length > 0) throw new Error(`build.ts does not know ${unknown.join(' ')}`)
  const {tablesText} = buildCommittedTools()
  if (!check) {
    writeFileSync(tablesPath, tablesText)
    console.log(`wrote ${tablesPath}`)
  } else if (readFileSync(tablesPath, 'utf8') === tablesText) {
    console.log('tables.json is what bison 2.3 makes of miniml-errors.y.')
    console.log('Every check passed.')
  } else {
    console.log('tables.json is NOT what bison 2.3 makes of miniml-errors.y. Run build.ts without --check and look at the difference.')
    process.exitCode = 1
  }
}
