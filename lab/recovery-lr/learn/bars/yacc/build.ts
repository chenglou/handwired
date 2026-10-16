// Runs bison on miniml-errors.y and flex on the base grammar's miniml.l, compiles driver.c with the two generated
// files, and writes the arrays of the generated parser to tables.json, which is committed. yacc-parser.ts reads
// tables.json and needs no bison. The same is done for the grammar without the rule `expr: expr error IN expr`,
// which gives tables-without-in-rule.json: the bar in the form that it had before that rule, see yaccTablesOf of
// yacc-parser.ts.
//
// Run from the repo root, with RECOVERY_LR_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-lr/learn/bars/yacc/build.ts           writes both files
//   bun lab/recovery-lr/learn/bars/yacc/build.ts --check   builds again and fails when a result is not the committed file
// The generated C files, bison's report (miniml.output) and the compiled driver go to <RECOVERY_LR_SCRATCH>/yacc-tools,
// and for the second grammar to <RECOVERY_LR_SCRATCH>/yacc-tools-without-in-rule.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {scratchFolder, toolsProblem} from '../../../grammar/build.ts'
const folderOfBar = import.meta.dir
export const grammarPath = join(folderOfBar, 'miniml-errors.y')
// The two files that this script writes. yacc-parser.ts reads them, so this script does not import it: it has to
// run when a file is missing or stale.
export const tablesPath = join(folderOfBar, 'tables.json')
export const tablesWithoutInRulePath = join(folderOfBar, 'tables-without-in-rule.json')

// The text of the grammar without the rule `expr: expr error IN expr`: the line of the rule is taken out, and
// bison then counts two conflicts fewer.
export function grammarWithoutInRule(grammar: string): string {
  const lines = grammar.split('\n')
  const ruleLines = lines.filter(line => line.trimStart().startsWith('| expr error IN expr'))
  const expectLines = lines.filter(line => line === '%expect 157')
  if (ruleLines.length !== 1 || expectLines.length !== 1) throw new Error('miniml-errors.y does not hold the rule `expr error IN expr` and `%expect 157` on one line each')
  return lines.filter(line => line !== ruleLines[0]).map(line => line === '%expect 157' ? '%expect 155' : line).join('\n')
}
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
// The tools for the committed grammar without the rule `expr: expr error IN expr`.
export function buildToolsWithoutInRule(): Tools {
  const folder = join(scratchFolder(), 'yacc-tools-without-in-rule')
  mkdirSync(folder, {recursive: true})
  const grammar = join(folder, 'miniml-errors.y')
  writeFileSync(grammar, grammarWithoutInRule(readFileSync(grammarPath, 'utf8')))
  return buildTools(grammar, folder)
}

if (import.meta.main) {
  const check = process.argv.includes('--check')
  const unknown = process.argv.slice(2).filter(argument => argument !== '--check')
  if (unknown.length > 0) throw new Error(`build.ts does not know ${unknown.join(' ')}`)
  let different = 0
  for (const [path, tools, grammar] of [[tablesPath, buildCommittedTools(), 'miniml-errors.y'], [tablesWithoutInRulePath, buildToolsWithoutInRule(), 'miniml-errors.y without the rule `expr error IN expr`']] as const) {
    if (!check) {
      writeFileSync(path, tools.tablesText)
      console.log(`wrote ${path}`)
    } else if (readFileSync(path, 'utf8') === tools.tablesText) console.log(`${path} is what bison 2.3 makes of ${grammar}.`)
    else {
      different++
      console.log(`${path} is NOT what bison 2.3 makes of ${grammar}. Run build.ts without --check and look at the difference.`)
    }
  }
  if (check && different === 0) console.log('Every check passed.')
  if (different > 0) process.exitCode = 1
}
