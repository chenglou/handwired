// Checks that nothing in learn/ reads the test split unless the environment variable RECOVERY_FINAL is `yes`, and
// that a cache file of another version of the dataset is never read.
//
// Run from the repo root, without RECOVERY_FINAL:
//   bun lab/recovery-parser/learn/check-guard.ts
//
// 1. No file of learn/ but data.ts names the dataset's sampleAt or typingReplayOf, the two functions that make
//    samples of any split. Every other file gets its samples from data.ts.
// 2. Without RECOVERY_FINAL: loadSamples and makeSamples refuse the test split, placesOfSplit and testPart refuse it,
//    a score and the cells read refuse it, and allowedSampleAt gives no sample of it. The arrays of the standard set
//    hold no test sample and no held-out sample.
// 3. The commands that take --split refuse the test split, and arms/final.ts refuses to run.
// 4. The cache: a file whose name has another key is not read, and neither is a file with the right name whose
//    header says that it was made from other sources. This part writes three small files to a new folder in
//    <RECOVERY_SCRATCH>/check-guard/, or in the system's temporary folder without RECOVERY_SCRATCH, and leaves them.
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, relative, resolve} from 'node:path'
import {allowedSampleAt, loadSamples, loadStandardSamples, makeSamples, placesOfSplit, splitNames, splitsOfOption, standardRange, testPart} from './data.ts'
import {asIsTables} from './recovery-tables.ts'
import {cellsReadBy, scoreTables} from './score.ts'

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
  check(throws(() => loadSamples(seed, 0, 300, null, true)), 'loadSamples with the test split does not throw')
  check(throws(() => makeSamples(seed, 0, 300, true)), 'makeSamples with the test split does not throw')
  const few = loadSamples(seed, 0, 300, null)
  check(throws(() => placesOfSplit(few, 'test')), 'placesOfSplit of the test split does not throw')
  check(throws(() => testPart(few)), 'testPart does not throw')
  check(throws(() => scoreTables(asIsTables(), few, {splits: ['test']})), 'a score of the test split does not throw')
  check(throws(() => scoreTables(asIsTables(), few, {splits: ['validation', 'test']})), 'a score of the validation and the test split does not throw')
  check(throws(() => cellsReadBy(asIsTables(), few, ['test'])), 'cellsReadBy of the test split does not throw')
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
  console.log(`2. Without RECOVERY_FINAL, loadSamples, makeSamples, placesOfSplit, testPart, scoreTables, cellsReadBy and splitsOfOption refuse the test split. allowedSampleAt leaves out ${leftOut} of the first 300 samples, and the arrays hold the other ${kept.length}. The standard set has ${standard.sampleCount} samples of ${standardRange.to - standardRange.from} indexes, none of the test split and none held out.`)
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
    const saysWhy = output.includes('test split')
    check(run.exitCode !== 0 && saysWhy, `\`bun ${command}\` ${run.exitCode === 0 ? 'runs' : 'fails without naming the test split'}`)
    if (run.exitCode !== 0 && saysWhy) refused++
  }
  console.log(`3. ${refused} of ${commands.length} commands refuse the test split and say so: ${commands.join(', ')}.`)
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

console.log(failures === 0 ? 'Every check passed.' : `${failures} checks FAILED.`)
if (failures > 0) process.exitCode = 1
