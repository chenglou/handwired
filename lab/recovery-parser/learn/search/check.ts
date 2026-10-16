// Checks that the search counts what score.ts counts, and that the votes are counted on the train split only:
// - For today's tables and for random settings of every open cell, some of them with added states, the score that
//   sample-runs.ts gives on the train split and on the validation split is the score of scoreTables.
// - The change that the search computes for another choice of one cell, from each sample's first read of the cell
//   on, is the change between two runs of every sample from its start.
// - Both hold for tables with added classes, the bit "first on its line" and open display entries, on the
//   validation split, and samples that were prepared for other classes than the tables' are refused.
// - countVotes refuses a set that holds a broken sample of the validation split, e.g. the whole standard set, unless
//   the call asks for it.
//
// Run from the repo root: bun lab/recovery-parser/learn/search/check.ts [--settings 30]
import {createRandom} from '../../random.ts'
import {loadStandardSamples, optionOf, refuseUnknownOptions, selectSamples, trainPart, validationPart} from '../data.ts'
import {classesOfTheChecks} from '../check-texts.ts'
import {type RecoveryTables, actionCount, addClasses, addFirstOnLineBit, addStates, asIsTables, openDisplayEntries, randomizeOpenCells} from '../recovery-tables.ts'
import {scoreTables} from '../score.ts'
import {type RunSamples, changesOfChoices, prepareSamples, refuseOtherClasses, totalScore} from './sample-runs.ts'
import {countVotes} from './votes.ts'

refuseUnknownOptions('search/check.ts', ['--settings'])
const settings = Number(optionOf('--settings') ?? 30)
const samples = loadStandardSamples()
const random = createRandom(20261015, 1)
let problems = 0
for (const [split, part] of [['train', trainPart(samples)], ['validation', validationPart(samples)]] as const) {
  const prepared = prepareSamples(part)
  let changeable = 0
  for (let sample = 0; sample < prepared.sampleCount; sample++) if (prepared.changeableFrom[sample]! < prepared.start[sample + 1]! - prepared.start[sample]!) changeable++
  console.log(`${split}: ${prepared.sampleCount} broken samples, ${changeable} of them read an open cell at one of their code points, ${prepared.scoredCodePoints} scored code points`)
  for (let setting = 0; setting <= settings; setting++) {
    let tables = asIsTables()
    if (setting > 0) {
      if (setting % 3 === 0) tables = addStates(tables, 2, [0, 4])
      randomizeOpenCells(tables, random)
    }
    const expected = scoreTables(tables, part, {splits: [split], breakdowns: false}).rows[0]!
    const actual = totalScore(prepared, tables)
    const expectedLabels = expected.kindRight + expected.depthRight + expected.containerRight
    const same = expected.codePoints === prepared.scoredCodePoints && expected.allRight === actual.allRight && expectedLabels === actual.labelsRight
    if (!same || setting === 0) console.log(`  ${setting === 0 ? 'today\'s tables' : `random setting ${setting}`}: score.ts counts ${expected.allRight} code points with all three labels right and ${expectedLabels} right labels, the search ${actual.allRight} and ${actual.labelsRight}${same ? '' : '  <- differs'}`)
    if (!same) problems++
  }
}
// Other choices of single cells, on the validation split, for 12 settings of the tables that `baseOf` gives: the
// tables as they are first, then settings in which a random half of the open cells keep the base's choice.
function checkSingleCells(prepared: RunSamples, baseOf: () => RecoveryTables, name: string) {
  const everySample = Int32Array.from({length: prepared.sampleCount}, (_, sample) => sample).filter(sample => prepared.changeableFrom[sample]! < prepared.start[sample + 1]! - prepared.start[sample]!)
  let choices = 0
  let choicesThatChange = 0
  for (let setting = 0; setting < 12; setting++) {
    const tables = baseOf()
    if (setting > 0) {
      const randomTables = baseOf()
      randomizeOpenCells(randomTables, random)
      for (let cell = 0; cell < tables.lexerNext.length; cell++) if (random.chance(0.5)) { tables.lexerNext[cell] = randomTables.lexerNext[cell]!; tables.lexerEvent[cell] = randomTables.lexerEvent[cell]! }
      for (let cell = 0; cell < tables.grammarNext.length; cell++) if (random.chance(0.5)) { tables.grammarNext[cell] = randomTables.grammarNext[cell]!; tables.grammarAction[cell] = randomTables.grammarAction[cell]! }
    }
    const before = totalScore(prepared, tables)
    for (let trial = 0; trial < 30; trial++) {
      const grammar = trial % 2 === 1
      const open = grammar ? tables.grammarOpen : tables.lexerOpen
      let cell = random.integer(0, open.length - 1)
      while (open[cell] === 0) cell = random.integer(0, open.length - 1)
      const candidates = Uint8Array.from({length: 6}, (_, index) => index % 2 === 0 ? random.integer(0, (grammar ? tables.grammarStateCount : tables.lexerStateCount) - 1) : random.integer(0, (grammar ? actionCount : tables.eventCount) - 1))
      const changes = changesOfChoices(prepared, everySample, tables, grammar, cell, candidates)
      const firstPart = grammar ? tables.grammarNext : tables.lexerNext
      const secondPart = grammar ? tables.grammarAction : tables.lexerEvent
      const held = [firstPart[cell]!, secondPart[cell]!]
      for (let candidate = 0; candidate < 3; candidate++) {
        firstPart[cell] = candidates[candidate * 2]!
        secondPart[cell] = candidates[candidate * 2 + 1]!
        const after = totalScore(prepared, tables)
        choices++
        if (after.allRight !== before.allRight || after.labelsRight !== before.labelsRight) choicesThatChange++
        if (after.allRight - before.allRight !== changes.allRight[candidate] || after.labelsRight - before.labelsRight !== changes.labelsRight[candidate]) {
          problems++
          console.log(`  setting ${setting}, ${grammar ? 'grammar' : 'tokenizer'} cell ${cell}, choice ${candidates[candidate * 2]}, ${candidates[candidate * 2 + 1]}: two runs of every sample differ by ${after.allRight - before.allRight} code points and ${after.labelsRight - before.labelsRight} labels, the search computes ${changes.allRight[candidate]} and ${changes.labelsRight[candidate]}  <- differs`)
        }
      }
      firstPart[cell] = held[0]!
      secondPart[cell] = held[1]!
    }
  }
  console.log(`single cells, ${name}: ${choices} other choices in 12 settings of the tables, ${choicesThatChange} of them change the score`)
}
checkSingleCells(prepareSamples(validationPart(samples)), asIsTables, 'today\'s layout')
// Tables with the eight classes of the checks, the bit "first on its line" and open display entries, on the
// validation split: the search's loop reads the class that the tables give a code point and the context with the bit.
{
  const withStructure = () => addFirstOnLineBit(openDisplayEntries(addClasses(asIsTables(), classesOfTheChecks)))
  const part = validationPart(samples)
  const prepared = prepareSamples(part, withStructure())
  let differing = 0
  for (let setting = 0; setting <= settings; setting++) {
    let tables = withStructure()
    if (setting > 0) {
      if (setting % 3 === 0) tables = addStates(tables, 2, [0, 4])
      randomizeOpenCells(tables, random)
    }
    const expected = scoreTables(tables, part, {splits: ['validation'], breakdowns: false}).rows[0]!
    const actual = totalScore(prepared, tables)
    const expectedLabels = expected.kindRight + expected.depthRight + expected.containerRight
    if (expected.codePoints !== prepared.scoredCodePoints || expected.allRight !== actual.allRight || expectedLabels !== actual.labelsRight) {
      differing++
      console.log(`  added classes, the bit and open display entries, ${setting === 0 ? 'no cell changed' : `random setting ${setting}`}: score.ts counts ${expected.allRight} code points with all three labels right and ${expectedLabels} right labels, the search ${actual.allRight} and ${actual.labelsRight}  <- differs`)
    }
  }
  problems += differing
  console.log(`added classes, the bit and open display entries, validation: the search counts what score.ts counts for the tables without a changed cell and for ${settings - differing} of ${settings} random settings`)
  checkSingleCells(prepared, withStructure, 'added classes, the bit and open display entries')
  let refused = false
  try {
    refuseOtherClasses(prepareSamples(part), withStructure())
  } catch {
    refused = true
  }
  if (!refused) problems++
  console.log(`samples that were prepared for today's classes are ${refused ? 'refused' : 'taken  <- wrong'} for tables with added classes`)
}
// The votes: every broken sample of the set votes, so a set with validation samples is refused.
{
  const refusalOf = (run: () => unknown) => {
    try {
      run()
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    return ''
  }
  const few = selectSamples(samples, Int32Array.from({length: 3000}, (_, place) => place))
  const fewTrain = trainPart(few)
  const wholeRefused = refusalOf(() => countVotes(few, {follow: false, stay: false})).includes('validation split')
  const validationRefused = refusalOf(() => countVotes(validationPart(few), {follow: true, stay: false})).includes('validation split')
  const total = (votes: {lexer: Int32Array, grammar: Int32Array}) => votes.lexer.reduce((sum, count) => sum + count, 0) + votes.grammar.reduce((sum, count) => sum + count, 0)
  const ofTrain = total(countVotes(fewTrain, {follow: false, stay: false}))
  const ofAll = total(countVotes(few, {follow: false, stay: false, alsoOtherSplits: true}))
  if (!wholeRefused || !validationRefused || !(ofTrain > 0 && ofAll > ofTrain)) {
    problems++
    console.log(`  countVotes: a set with validation samples is ${wholeRefused ? 'refused' : 'taken'}, the validation part is ${validationRefused ? 'refused' : 'taken'}, the train part of 3000 samples gives ${ofTrain} votes and all of them with alsoOtherSplits ${ofAll}  <- wrong`)
  }
  console.log(`votes: countVotes refuses a set with validation samples and counts ${ofTrain} votes on the train part of the first 3000 samples, ${ofAll} when it is asked to count the validation samples too`)
}
console.log(`Checked: today's tables and ${settings} random settings on each split, the same with added classes, the bit and open display entries on the validation split, the other choices of single cells, and which samples vote.`)
console.log(problems === 0 ? 'Every check passed.' : `${problems} checks FAILED.`)
if (problems > 0) process.exitCode = 1
