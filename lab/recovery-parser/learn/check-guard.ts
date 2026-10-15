// Checks that nothing in learn/ reads the test split unless the environment variable RECOVERY_FINAL is `yes`, and
// that a cache file of another version of the dataset is never read.
//
// Run from the repo root, without RECOVERY_FINAL:
//   bun lab/recovery-parser/learn/check-guard.ts
//
// 1. No file of learn/ but data.ts names the dataset's sampleAt or typingReplayOf, the two functions that make
//    samples of any split. Every other file gets its samples from data.ts.
// 2. Without RECOVERY_FINAL: loadSamples and makeSamples refuse the test split, placesOfSplit and testPart refuse it,
//    a score and the cells read refuse it, each with an error that names RECOVERY_FINAL, and allowedSampleAt gives no
//    sample of it. placesForTwin takes no other split than train and validation. The arrays of the standard set hold
//    no test sample and no held-out sample.
// 3. The commands that take --split refuse the test split, and arms/final.ts refuses to run, by its own first line.
//    A command that gets an option that it does not have fails and names the option, e.g. `mistakes.ts --split test`.
// 4. The cache: a file whose name has another key is not read, and neither is a file with the right name whose
//    header says that it was made from other sources. This part writes three small files to a new folder in
//    <RECOVERY_SCRATCH>/check-guard/, or in the system's temporary folder without RECOVERY_SCRATCH, and leaves them.
// 5. The keys: every file that data.ts imports, directly or through another file, is among the files of the cache's
//    key, and a change of one file gives another key, for a file of each part of the key.
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, relative, resolve} from 'node:path'
import {allowedSampleAt, loadSamples, loadStandardSamples, makeSamples, placesOfSplit, refuseUnknownOptions, splitNames, splitsOfOption, standardRange, testPart} from './data.ts'
import {type ContentOf, cacheKey, datasetKey, filesOfLearnInTheCacheKey, filesOfTheDatasetKey, keysOfTheSources} from './dataset-key.ts'
import {asIsTables} from './recovery-tables.ts'
import {cellsReadBy, scoreTables} from './score.ts'
import {placesForTwin} from './soft/twin-data.ts'

let failures = 0
const check = (holds: boolean, message: string) => {
  if (holds) return
  failures++
  console.log(`FAILED: ${message}`)
}
const throws = (run: () => unknown) => {
  try {
    run()
  } catch {
    return true
  }
  return false
}
// Whether `run` throws the error of requireFinal, which names RECOVERY_FINAL. A call that throws for another reason
// does not count: e.g. a score of the test split of a set without test samples would throw "no broken sample"
// without any guard.
const refusesTheTestSplit = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return error instanceof Error && error.message.includes('RECOVERY_FINAL')
  }
  return false
}

refuseUnknownOptions('check-guard.ts', [])
if (process.env['RECOVERY_FINAL'] !== undefined) {
  console.log('FAILED: check-guard.ts has to run without the environment variable RECOVERY_FINAL.')
  console.log('1 checks FAILED.')
  process.exit(1)
}

// 1. The source files.
{
  const folder = import.meta.dir
  const files = readdirSync(folder, {recursive: true, encoding: 'utf8'}).filter(name => name.endsWith('.ts'))
  // The two names, put together here so that this file does not hold them as words.
  const makers = [`sample${'At'}`, `typingReplay${'Of'}`]
  const offenders: string[] = []
  for (const file of files) {
    if (file === 'data.ts') continue
    // Comments may name the functions: only code counts.
    const code = readFileSync(join(folder, file), 'utf8').split('\n').filter(line => !line.trimStart().startsWith('//')).join('\n')
    for (const maker of makers) if (new RegExp(`\\b${maker}\\b`).test(code)) offenders.push(`${file} names ${maker}`)
  }
  check(offenders.length === 0, `files of learn/ other than data.ts make samples themselves: ${offenders.join(', ')}`)
  console.log(`1. ${files.length} files of learn/: none but data.ts names ${makers.join(' or ')} of the dataset.`)
}

// 2. The functions.
{
  const seed = standardRange.seed
  check(refusesTheTestSplit(() => loadSamples(seed, 0, 300, null, true)), 'loadSamples with the test split is not refused for RECOVERY_FINAL')
  check(refusesTheTestSplit(() => makeSamples(seed, 0, 300, true)), 'makeSamples with the test split is not refused for RECOVERY_FINAL')
  const few = loadSamples(seed, 0, 300, null)
  check(refusesTheTestSplit(() => placesOfSplit(few, 'test')), 'placesOfSplit of the test split is not refused for RECOVERY_FINAL')
  check(refusesTheTestSplit(() => testPart(few)), 'testPart is not refused for RECOVERY_FINAL')
  check(refusesTheTestSplit(() => scoreTables(asIsTables(), few, {splits: ['test']})), 'a score of the test split is not refused for RECOVERY_FINAL')
  check(refusesTheTestSplit(() => scoreTables(asIsTables(), few, {splits: ['validation', 'test']})), 'a score of the validation and the test split is not refused for RECOVERY_FINAL')
  check(refusesTheTestSplit(() => cellsReadBy(asIsTables(), few, ['test'])), 'cellsReadBy of the test split is not refused for RECOVERY_FINAL')
  check(throws(() => placesForTwin(few, 'test' as 'train')) && throws(() => placesForTwin(few, 'all' as 'train')) && !throws(() => placesForTwin(few, 'validation')), 'placesForTwin takes another split than train and validation')
  check(throws(() => splitsOfOption('a command', ['--split', 'test'])) && throws(() => splitsOfOption('a command', ['--split', 'train,test'])), 'splitsOfOption does not refuse the test split')
  check(!throws(() => splitsOfOption('a command', ['--split', 'train,validation'])), 'splitsOfOption refuses the train and validation splits')
  let leftOut = 0
  const kept: number[] = []
  for (let index = 0; index < 300; index++) {
    if (allowedSampleAt(seed, index) === undefined) leftOut++
    else kept.push(index)
  }
  check(leftOut > 20 && leftOut < 120, `allowedSampleAt leaves out ${leftOut} of the first 300 samples, where about 60 are in the test split`)
  check(few.sampleCount === kept.length && kept.every((index, place) => few.index[place] === index), 'the arrays of the first 300 indexes do not hold exactly the samples that allowedSampleAt gives')
  const standard = loadStandardSamples()
  const test = splitNames.indexOf('test')
  const testSamples = standard.split.reduce((total, split) => total + Number(split === test), 0)
  const heldOutSamples = standard.heldOut.reduce((total, bits) => total + Number(bits !== 0), 0)
  check(testSamples === 0 && heldOutSamples === 0 && !standard.withTest, `the standard set holds ${testSamples} samples of the test split and ${heldOutSamples} held-out samples`)
  console.log(`2. Without RECOVERY_FINAL, loadSamples, makeSamples, placesOfSplit, testPart, scoreTables and cellsReadBy refuse the test split with an error that names RECOVERY_FINAL, and splitsOfOption and placesForTwin refuse it too. allowedSampleAt leaves out ${leftOut} of the first 300 samples, and the arrays hold the other ${kept.length}. The standard set has ${standard.sampleCount} samples of ${standardRange.to - standardRange.from} indexes, none of the test split and none held out.`)
}

// 3. The commands.
{
  const root = resolve(import.meta.dir, '../../..')
  const commands = ['score.ts --split test', 'compare.ts --split test', 'handwritten/report.ts --split test', 'handwritten/show.ts --split test', 'handwritten/where-wrong.ts --split test', 'handwritten/worse.ts --split test', 'arms/final.ts']
  const environment = {...process.env}
  delete environment['RECOVERY_FINAL']
  let refused = 0
  for (const command of commands) {
    const [script, ...rest] = command.split(' ')
    const run = Bun.spawnSync(['bun', join(relative(root, import.meta.dir), script!), ...rest], {cwd: root, env: environment, stdout: 'pipe', stderr: 'pipe'})
    const output = `${run.stdout.toString()}${run.stderr.toString()}`
    // arms/final.ts has to refuse by its own first line, before it loads tables or samples: the error then names the script.
    const saysWhy = output.includes('test split') && (command !== 'arms/final.ts' || output.includes('arms/final.ts reads the test split'))
    check(run.exitCode !== 0 && saysWhy, `\`bun ${command}\` ${run.exitCode === 0 ? 'runs' : 'fails without naming the test split'}`)
    if (run.exitCode !== 0 && saysWhy) refused++
  }
  console.log(`3. ${refused} of ${commands.length} commands refuse the test split and say so: ${commands.join(', ')}.`)
  // An option that a command does not have is an error, and not a run as if the option were not there.
  const withUnknownOption = ['search/mistakes.ts --split test', 'score.ts --table no-such-file.json', 'compare.ts --base no-such-file.json', 'handwritten/show.ts --splits validation', 'arms/baselines.ts --seeds 1', 'search/votes.ts --split validation']
  let failed = 0
  for (const command of withUnknownOption) {
    const [script, option, ...rest] = command.split(' ')
    const run = Bun.spawnSync(['bun', join(relative(root, import.meta.dir), script!), option!, ...rest], {cwd: root, env: environment, stdout: 'pipe', stderr: 'pipe'})
    const namesTheOption = `${run.stdout.toString()}${run.stderr.toString()}`.includes(`has no option ${option}`)
    check(run.exitCode !== 0 && namesTheOption, `\`bun ${command}\` ${run.exitCode === 0 ? 'runs' : 'fails without naming the option'}`)
    if (run.exitCode !== 0 && namesTheOption) failed++
  }
  check(throws(() => refuseUnknownOptions('a command', ['--tables'], ['--tables', 'file.json', '--split', 'test'])) && !throws(() => refuseUnknownOptions('a command', ['--tables', '--depth-low'], ['name=file.json', '--depth-low', '-8', '--tables', 'file.json'])), 'refuseUnknownOptions does not refuse exactly the options that are not listed')
  console.log(`   ${failed} of ${withUnknownOption.length} commands fail for an option that they do not have and name it: ${withUnknownOption.join(', ')}.`)
}

// 4. The cache.
{
  const scratch = process.env['RECOVERY_SCRATCH']
  const folder = join(scratch === undefined || scratch === '' ? tmpdir() : scratch, 'check-guard', String(Date.now()))
  mkdirSync(folder, {recursive: true})
  const seed = standardRange.seed
  const fresh = loadSamples(seed, 0, 120, folder)
  const [name] = readdirSync(folder)
  check(readdirSync(folder).length === 1 && name !== undefined && name.includes(fresh.datasetKey), `the cache file's name does not hold the dataset's key: ${name}`)
  const path = join(folder, name!)
  const original = readFileSync(path)
  // The same bytes with every code point changed, so that reading the file would show.
  const spoiled = Uint8Array.from(original)
  const headerLength = new DataView(spoiled.buffer).getUint32(0, true)
  const header = JSON.parse(new TextDecoder().decode(spoiled.subarray(8, 8 + headerLength))) as {cacheKey: string, sections: {field: string, length: number, offset: number}[]}
  const bodyStart = Math.ceil((8 + headerLength) / 8) * 8
  const codePoints = header.sections.find(section => section.field === 'codePoints')!
  for (let entry = 0; entry < codePoints.length; entry++) spoiled[bodyStart + codePoints.offset + 4 * entry] = 0x78
  const sameCodePoints = (samples: {codePoints: Int32Array}) => samples.codePoints.length === fresh.codePoints.length && samples.codePoints.every((codePoint, at) => codePoint === fresh.codePoints[at])
  // A spoiled file with the right name and the right header is read: the check can tell.
  writeFileSync(path, spoiled)
  check(!sameCodePoints(loadSamples(seed, 0, 120, folder)), 'a spoiled cache file gives the right samples, so this check cannot tell whether a file is read')
  // The spoiled file under the name of another key: not read, and a new file is made.
  const otherKey = header.cacheKey.replace(/.$/, last => last === '0' ? '1' : '0')
  writeFileSync(join(folder, name!.replace(header.cacheKey, otherKey)), spoiled)
  writeFileSync(path, original)
  check(sameCodePoints(loadSamples(seed, 0, 120, folder)), 'the samples are not the fresh ones next to a cache file of another key')
  // The spoiled file under the right name, with a header that names another key: not read.
  const text = new TextDecoder().decode(spoiled.subarray(8, 8 + headerLength)).replace(header.cacheKey, otherKey)
  spoiled.set(new TextEncoder().encode(text), 8)
  writeFileSync(path, spoiled)
  const afterOtherHeader = loadSamples(seed, 0, 120, folder)
  check(sameCodePoints(afterOtherHeader), 'a cache file whose header names another key is read')
  console.log(`4. The cache file ${name} holds the key of its sources in its name and in its header. A file with another key in its name is not read, and neither is a file with the right name and another key in its header: the samples are made again.`)
}

// 5. The keys of the source files.
{
  const root = resolve(import.meta.dir, '../../..')
  const inTheKey = new Set([...filesOfTheDatasetKey(), ...filesOfLearnInTheCacheKey()])
  // Every file that data.ts imports, directly or through another file: each decides what the arrays hold.
  const imported = new Set<string>()
  const missing: string[] = []
  const visit = (file: string) => {
    if (imported.has(file)) return
    imported.add(file)
    for (const match of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), match[1]!)
      if (existsSync(target)) visit(target)
      else missing.push(`${relative(root, file)} imports ${match[1]}, which is no file`)
    }
  }
  visit(join(import.meta.dir, 'data.ts'))
  // dataset-key.ts only lists the files and hashes them: it decides the keys' values, and no array.
  const outside = [...imported].filter(file => !inTheKey.has(file) && file !== join(import.meta.dir, 'dataset-key.ts')).map(file => relative(root, file))
  check(missing.length === 0 && outside.length === 0 && imported.size > 20, `files that data.ts imports are not in the cache's key: ${[...outside, ...missing].join(', ')}`)
  // One changed file gives another key: the dataset's key for a file of the dataset, and the second part of the
  // cache's key for a file of learn/.
  const keys = keysOfTheSources()
  check(keys.datasetKey === datasetKey() && keys.cacheKey === cacheKey() && keys.cacheKey.startsWith(`${keys.datasetKey}-`), 'keysOfTheSources does not give the keys of the files as they are')
  const withChanged = (changed: string): ContentOf => file => file === changed ? Buffer.concat([readFileSync(file), Buffer.from('\n// changed\n')]) : readFileSync(file)
  const datasetFolder = resolve(import.meta.dir, '..')
  const ofTheDataset = [join(datasetFolder, 'samples.ts'), join(datasetFolder, 'documents.ts'), join(datasetFolder, 'hand-rules.ts'), join(datasetFolder, 'damage', 'types.ts'), join(datasetFolder, 'damage', 'strings.ts'),
    join(root, 'src/json-search/highlighter/tables.ts'), join(root, 'src/json-search/highlighter/kinds.ts'), join(root, 'tests/json-search/highlighter/reference.ts')]
  const ofLearn = ['data.ts', 'intended.ts', 'recovery-tables.ts'].map(name => join(import.meta.dir, name))
  let sameKey = 0
  for (const file of ofTheDataset) {
    const changed = keysOfTheSources(withChanged(file))
    if (!inTheKey.has(file) || changed.datasetKey === keys.datasetKey || changed.cacheKey === keys.cacheKey) sameKey++
  }
  for (const file of ofLearn) {
    const changed = keysOfTheSources(withChanged(file))
    if (!inTheKey.has(file) || changed.datasetKey !== keys.datasetKey || changed.cacheKey === keys.cacheKey) sameKey++
  }
  check(sameKey === 0, `${sameKey} of ${ofTheDataset.length + ofLearn.length} changed source files do not change the key that they are in`)
  console.log(`5. data.ts and the files that it imports, directly or through another file, ${imported.size - 1} files without dataset-key.ts, are all among the ${inTheKey.size} files of the cache's key. A change of each of ${ofTheDataset.length} files of the dataset gives another dataset key, and a change of data.ts, intended.ts or recovery-tables.ts gives the same dataset key and another cache key.`)
}

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
