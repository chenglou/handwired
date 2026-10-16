// Checks that no case of the written set is among the samples of the dataset: no broken program is the broken text
// of a train or validation sample, and no repaired program, of the writer or of the second repairer, is a program of
// the dataset. A program is compared in two ways: as the same text, and as the same tokens, i.e. the same terminals
// in the same order whatever the names, the numbers, the strings, the comments and the layout are. The dataset's
// split is made by these tokens, see ../../dataset.ts.
//
// The dataset is the first 40,000 train samples and the first 5,000 validation samples of the default seed. The
// check goes through the programs of the seed in their order until both are passed.
//
// Run from the repo root: bun lab/recovery-lr/held-back/written/check-overlap.ts [--set <folder>]
// It prints counts only, so that its output quotes no case. Run it again when the generator or the damage changes.
import {defaultSeed, sampleAt, trainSampleCount, validationSampleCount} from '../../dataset.ts'
import {labelsOfValidText} from '../../labels.ts'
import {type Tokens, textOf} from '../../parser.ts'
import {isTrivia, symbolOf} from '../../tables.ts'
import {readWritten, setFolderOf} from './written.ts'

const nameTerminal = symbolOf('IDENT'), stringTerminal = symbolOf('STRING')

// The terminals of a text's tokens, without white space and comments, as one text.
const tokensKeyOf = (tokens: Tokens): string => {
  const terminals: number[] = []
  for (let token = 0; token < tokens.count; token++) if (!isTrivia(tokens.kind[token]!)) terminals.push(tokens.kind[token]!)
  return terminals.join(' ')
}
// The names and the strings of a valid program, each as its text.
function wordsOf(codePoints: Int32Array, tokens: Tokens): {names: string[], strings: string[]} {
  const names: string[] = [], strings: string[] = []
  for (let token = 0; token < tokens.count; token++) {
    const kind = tokens.kind[token]
    if (kind !== nameTerminal && kind !== stringTerminal) continue
    const start = tokens.start[token]!
    const text = textOf(codePoints.subarray(start, start + tokens.length[token]!))
    if (kind === nameTerminal) names.push(text)
    else strings.push(text)
  }
  return {names, strings}
}

if (import.meta.main) {
  const {cases, problems} = readWritten(setFolderOf(process.argv.slice(2)))
  if (problems.length > 0) console.log(`${problems.length} problems in the files: the cases that they name are left out below. check.ts prints them.`)
  const brokenTexts = new Set(cases.map(writtenCase => writtenCase.broken))
  const repairedTexts = new Set(cases.flatMap(writtenCase => writtenCase.opinions.map(opinion => opinion.text)))
  const repairedKeys = new Map<string, string>()
  for (const writtenCase of cases) for (const opinion of writtenCase.opinions) repairedKeys.set(tokensKeyOf(opinion.labels.tokens), writtenCase.id)

  const programTexts = new Set<string>(), programKeys = new Set<string>(), brokenOfSamples = new Set<string>()
  const namesOfPrograms = new Set<string>(), stringsOfPrograms = new Set<string>()
  let train = 0, validation = 0, programs = 0
  for (let index = 0; train < trainSampleCount || validation < validationSampleCount; index++) {
    const {sample, split} = sampleAt(defaultSeed, index)
    if (split === 'train') train++
    else validation++
    programs++
    programTexts.add(sample.original)
    brokenOfSamples.add(sample.broken)
    const labels = labelsOfValidText(sample.original)
    programKeys.add(tokensKeyOf(labels.tokens))
    const words = wordsOf(labels.codePoints, labels.tokens)
    for (const name of words.names) namesOfPrograms.add(name)
    for (const text of words.strings) stringsOfPrograms.add(text)
  }
  const count = (items: Iterable<string>, among: ReadonlySet<string>) => [...items].filter(item => among.has(item)).length
  const sameBroken = count(brokenTexts, brokenOfSamples) + count(brokenTexts, programTexts)
  const sameRepaired = count(repairedTexts, programTexts) + count(repairedTexts, brokenOfSamples)
  const sameTokens = count(repairedKeys.keys(), programKeys)
  console.log(`${programs} programs of seed ${defaultSeed}, which hold the first ${trainSampleCount} train and the first ${validationSampleCount} validation samples: ${sameBroken} of ${brokenTexts.size} broken programs and ${sameRepaired} of ${repairedTexts.size} repaired programs of the written set are among their texts, and ${sameTokens} of ${repairedKeys.size} repaired programs have the tokens of one of their programs.`)

  // How much the writers and the generator draw on the same words: the names and the strings of the writers' repaired
  // programs that a program of the dataset also holds.
  const names = new Set<string>(), strings = new Set<string>()
  for (const writtenCase of cases) {
    const {labels} = writtenCase.opinions[0]!
    const words = wordsOf(labels.codePoints, labels.tokens)
    for (const name of words.names) names.add(name)
    for (const text of words.strings) strings.add(text)
  }
  console.log(`${count(names, namesOfPrograms)} of the ${names.size} names and ${count(strings, stringsOfPrograms)} of the ${strings.size} strings of the writers' repaired programs are also in a program of the dataset.`)
  if (sameBroken + sameRepaired + sameTokens > 0 || problems.length > 0) process.exitCode = 1
}
