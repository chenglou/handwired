// The rows that every arm is read against, through the same record as an arm's tables: the parser as it is, the
// dataset's four hand rules as tables of the experiment, and the 35 hand-written rules.
//
// Run from the repo root, with RECOVERY_SCRATCH set to a folder outside the repo:
//   bun lab/recovery-parser/learn/arms/baselines.ts
// It saves each baseline's tables and record to <RECOVERY_SCRATCH>/arms/baselines/<name>/ and prints the tables of
// describeSettings, which it also saves as summary.md there. None of the baselines has a seed.
import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {refuseUnknownOptions} from '../data.ts'
import {saveTables} from '../recovery-tables.ts'
import {type SettingResult, armFolderOf, baselineTables, describeSettings, fileNameOf, recordOf} from './harness.ts'

if (import.meta.main) {
  refuseUnknownOptions('arms/baselines.ts', [])
  const folder = armFolderOf('baselines')
  const results: SettingResult[] = []
  for (const {name, tables, base} of baselineTables()) {
    const baselineFolder = join(folder, fileNameOf(name))
    mkdirSync(baselineFolder, {recursive: true})
    const record = recordOf(tables, base)
    saveTables(join(baselineFolder, 'tables.json'), tables, `baseline: ${name}`)
    writeFileSync(join(baselineFolder, 'record.json'), `${JSON.stringify(record, null, 1)}\n`)
    results.push({name, seeds: [], records: [record]})
  }
  const summary = describeSettings(results)
  writeFileSync(join(folder, 'summary.md'), `${summary}\n`)
  console.log(summary)
}
