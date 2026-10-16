// The written set of broken miniml programs: broken programs that agents wrote from situations in which a program
// gets broken, each with a repair that says what its author meant, and each repaired a second time by an agent who
// saw only the broken program. This file reads the broken programs and the repairs and gives every case in the shape
// of the dataset's samples, see ../../sample.ts. README.md and REPAIR.md describe the set for those who write it.
//
// A repair is an aligned text, see format.ts: the repaired program, and for every code point of the broken program
// its counterpart in that program, or that it is added. makeSample of ../../sample.ts makes a sample of the two, so a
// case has what a sample of the train data has: the alignment in one fixed form (of two equal code points of which
// one is added or missing, the later one is), the labels of the counterpart for every kept code point (the display
// kind, the depth, the container and the hash of the stack), the kept tokens and the constituents. An added code
// point has no label.
//
// The opinions about a case are the writer's repair and, when there is one, the second repair. They are held against
// each other per code point of the broken program:
// - agreed: every opinion keeps it, with the same display kind, depth and container. Only these are scored.
// - added: every opinion says that it is added.
// - disputed: anything else, e.g. one repair keeps a bracket and the other says that it is added.
// The sample of a case is the sample of the writer's repair in which every disputed code point is given as an added
// one, so that whatever scores samples counts no disputed code point.
//
// Run from the repo root: bun lab/recovery-lr/held-back/written/written.ts [--set <folder>]
// It prints one line per case and the counts of the set, and no text of a case. A problem's text can quote a case, so
// the command prints the problems only with --problems.
import {existsSync, readFileSync, readdirSync} from 'node:fs'
import {join} from 'node:path'
import {type ValidLabels, containerOf, depthOf, displayKind, displayOfState, labelsOfValidText} from '../../labels.ts'
import {type Tokens, codePointsOf, maximumCodePoints, parse, scan, textOf} from '../../parser.ts'
import {type Sample, constituentKey, makeSample} from '../../sample.ts'
import {commentKind, isTrivia, symbolOf, tables} from '../../tables.ts'
import {type Aligned, type BrokenEntry, type RepairEntry, readBrokenFile, readRepairFile} from './format.ts'

// The folder of this file, with the broken programs in broken/, the writers' repairs in repairs/ and the second
// repairs in second-repairs/. examples/ in it is a small set of the same layout.
export const writtenFolder = import.meta.dir

// A broken program has 40 to 480 code points, and a repaired program at most 480.
export const shortestBroken = 40
export const longestText = 480

export type Opinion = {
  // 'writer' for the repair of the case's writer, 'second' for the second repair.
  name: 'writer' | 'second'
  // The repaired program of this opinion, and its labels.
  text: string
  labels: ValidLabels
  note: string | undefined
  // The other reading, when the repairer marked the repair as unsure.
  unsure: string | undefined
  // The broken program with this repair, as makeSample gives it. sample.alignment is the alignment in the fixed form,
  // and a code point with -1 in it has no label by this opinion.
  sample: Sample
}

export type Agreement = 'agreed' | 'added' | 'disputed'

export type WrittenCase = {
  id: string
  // The name of the writer's file in broken/, e.g. 'hand-edits.txt'.
  file: string
  // Where such a broken program comes from, in the writer's words. Empty when the case is read with the second
  // repair alone, which has no such line.
  from: string
  broken: string
  // The writer's opinion first, then the second repair when there is one.
  opinions: Opinion[]
  // Per code point of the broken program.
  agreement: Agreement[]
  // The case as a sample of the dataset: the first opinion's sample, in which every disputed code point is given as
  // an added one (alignment -1 and no label), a token with such a code point is no kept token, and the constituents
  // are those of the kept tokens that are left. sample.scored counts the agreed code points from the first error on,
  // and is 0 for a case in which the opinions agree on none of them. sample.edits holds the name of the writer's file
  // without its ending, e.g. ['hand-edits'].
  sample: Sample
  // Per code point: 1 where the code point is agreed and every opinion also gives it the same hash of the stack. Two
  // repairs can give a code point the same display kind, depth and container on stacks that differ, e.g. an argument
  // in the one and an element of a tuple in the other. sample.labelStack is the first opinion's.
  stackAgreed: Uint8Array
  // Whether every opinion gives the constituents of `sample`, i.e. the same nonterminals over the same kept tokens.
  constituentsAgreed: boolean
  // The first damaged code point of the broken program by the first opinion, see firstDamageOf.
  firstDamage: number
  // Whether a code point from the first error of the parser as it is on is disputed. A case without one is a case
  // with full agreement.
  disputedFromFirstError: boolean
}

const openingBracket = symbolOf('LPAREN'), closingBracket = symbolOf('RPAREN')

// What a terminal is called in a message for a writer, e.g. `in` for IN and "a name" for IDENT.
const terminalWords: Record<string, string> = {
  $end: 'the end of the program', LET: '`let`', REC: '`rec`', IN: '`in`', IF: '`if`', THEN: '`then`', ELSE: '`else`', FUN: '`fun`', TRUE: '`true`', FALSE: '`false`',
  IDENT: 'a name', INT: 'an integer', STRING: 'a string', ARROW: '`->`', EQ: '`=`', NE: '`<>`', LT: '`<`', LE: '`<=`', GT: '`>`', GE: '`>=`', PLUS: '`+`', MINUS: '`-`', STAR: '`*`',
  SLASH: '`/`', CONS: '`::`', AND: '`&&`', OR: '`||`', CARET: '`^`', LPAREN: '`(`', RPAREN: '`)`', LBRACK: '`[`', RBRACK: '`]`', COMMA: '`,`', SEMI: '`;`', UNDERSCORE: '`_`',
  BADCHAR: 'a character that is no token', BADSTRING: 'a string that is not closed', BADCOMMENT: 'a comment that is not closed',
}
export const wordsOfTerminal = (terminal: number): string => terminalWords[tables.symbolNames[terminal]!] ?? tables.symbolNames[terminal]!

// The line of a code point in a text, counted from 1.
const lineOf = (codePoints: ArrayLike<number>, position: number) => {
  let line = 1
  for (let index = 0; index < position && index < codePoints.length; index++) if (codePoints[index] === 10) line++
  return line
}

// A text in a message: its control characters written out, and its middle left out when it is long.
export function quoted(codePoints: ArrayLike<number>, longest = 40): string {
  const text = textOf(codePoints)
  return JSON.stringify(Array.from(text).length > longest ? `${Array.from(text).slice(0, longest - 12).join('')} … ${Array.from(text).slice(-8).join('')}` : text)
}

// Where the parser as it is reports its first error in a text that it rejects, in words: the code point, the line,
// the token, and what the parser takes at that place. The parser takes a terminal where the cell of the top state is
// frozen, i.e. where the grammar's table has an action.
export function firstErrorInWords(codePoints: Int32Array, tokens: Tokens, firstErrorToken: number, stack: readonly number[]): string {
  const atEnd = firstErrorToken >= tokens.count
  const position = atEnd ? codePoints.length : tokens.start[firstErrorToken]!
  const state = stack.at(-1)!
  const taken = tables.textTerminals.filter(terminal => tables.frozen[state * tables.terminalCount + terminal] === 1).map(wordsOfTerminal)
  // A keyword or a sign is named by its text alone, and any other token also by what it is, e.g. `"x1" (a name)`.
  const words = atEnd ? '' : wordsOfTerminal(tokens.kind[firstErrorToken]!)
  const token = atEnd ? 'the end of the program' : `the token ${quoted(codePoints.subarray(position, position + tokens.length[firstErrorToken]!))}${words.startsWith('`') ? '' : ` (${words})`}`
  return `at code point ${position}, line ${lineOf(codePoints, position)}: ${token}, where the parser takes ${taken.length > 8 ? `one of ${taken.length} other tokens` : taken.length === 0 ? 'nothing' : `only ${taken.join(', ')}`}`
}

// What keeps a text from being a repaired program: the plain parser of ../../parser.ts accepts it, and it has at most
// 480 code points.
export function validTextProblems(text: string): string[] {
  const problems: string[] = []
  const codePoints = codePointsOf(text)
  if (codePoints.length > longestText) problems.push(`it has ${codePoints.length} code points, and a repaired program has at most ${longestText}`)
  if (codePoints.length > maximumCodePoints) return problems
  const tokens = scan(codePoints)
  const parsed = parse(tokens, codePoints.length)
  if (!parsed.valid) problems.push(`it is no valid program: the parser reports an error ${firstErrorInWords(codePoints, tokens, parsed.firstErrorToken, parsed.stack)}`)
  return problems
}

// What keeps a text from being a broken program: the parser as it is rejects it, and it has 40 to 480 code points.
export function brokenTextProblems(text: string): string[] {
  const problems: string[] = []
  const codePoints = codePointsOf(text)
  if (codePoints.length < shortestBroken || codePoints.length > longestText) problems.push(`it has ${codePoints.length} code points, and a broken program has ${shortestBroken} to ${longestText}`)
  if (codePoints.length <= maximumCodePoints && parse(scan(codePoints), codePoints.length).valid) {
    problems.push('it is a valid program: the parser accepts it, so it has no first error to recover from. miniml accepts more than it seems to, e.g. two expressions side by side are an application, and `match`, `end` and `and` are names')
  }
  return problems
}

// What an alignment makes of the damage: the runs of the broken program that have no counterpart, and the runs of the
// repaired program that the broken program lacks, each with the position in the broken program where it stands or is
// missing. A missing run at the place of an added run comes right after it, with the position of the added run's end.
export type Change = {kind: 'added' | 'missing', position: number, codePoints: string[]}
export function changeRunsOf(brokenText: string, repairedText: string, alignment: ArrayLike<number>): Change[] {
  const broken = Array.from(brokenText)
  const repaired = Array.from(repairedText)
  const changes: Change[] = []
  // The next code point of the repaired program that has no counterpart yet.
  let expected = 0
  let addedFrom = -1
  const endAdded = (position: number) => {
    if (addedFrom !== -1) changes.push({kind: 'added', position: addedFrom, codePoints: broken.slice(addedFrom, position)})
    addedFrom = -1
  }
  for (let position = 0; position < broken.length; position++) {
    const counterpart = alignment[position]!
    if (counterpart === -1) {
      if (addedFrom === -1) addedFrom = position
      continue
    }
    endAdded(position)
    if (counterpart > expected) changes.push({kind: 'missing', position, codePoints: repaired.slice(expected, counterpart)})
    expected = counterpart + 1
  }
  endAdded(broken.length)
  if (expected < repaired.length) changes.push({kind: 'missing', position: broken.length, codePoints: repaired.slice(expected)})
  return changes
}

// The whole tokens of the repaired program that are missing right before white space or a comment that the broken
// program has: rule 4 of REPAIR.md asks for such a token right before the next token of the broken program. White
// space and comments have the depth and the container of the stack as the token before them left it, and a parser
// only learns that a token is missing when it reads the next token. So with the missing `=` of
// `let f x⟦missing⟧ =⟦/⟧⏎  x + 1` before the line feed, the line feed and the indentation would be white space after
// the `=`, which no parser can show. With the `=` right before the `x`, they are white space after the parameter, as
// every parser has them.
//
// A token that is missing at the place of added text is left alone, e.g. the `;` of `[72⟦added⟧,⟦/⟧⟦missing⟧;⟦/⟧ 85]`:
// the author typed the token in another form, and a parser can read the `,` as the `;`. The `()` that stands for a
// missing expression is never left alone: nothing was typed for it, also where it stands for a construct that is
// added as a whole.
export type MisplacedMissing = {
  // The missing tokens, and the white space or the comment after them: its position in the broken program and the
  // index of its first code point in the repaired program.
  tokens: string[]
  position: number
  whiteSpaceIndex: number
  // Whether that white space has another depth or container than the program has right before the missing tokens,
  // e.g. after a missing `=` and not after a missing `)`, which stays on the stack until the next token is read.
  changesDepthOrContainer: boolean
}
export function missingBeforeWhiteSpace(labels: ValidLabels, alignment: ArrayLike<number>): MisplacedMissing[] {
  const {codePoints: repaired, tokens} = labels
  // positionOf[index of a code point of the repaired program] is its place in the broken program, or -1.
  const positionOf = new Int32Array(repaired.length).fill(-1)
  for (let position = 0; position < alignment.length; position++) if (alignment[position] !== -1) positionOf[alignment[position]!] = position
  const hasKeptCodePoint = (token: number) => {
    for (let index = tokens.start[token]!; index < tokens.start[token]! + tokens.length[token]!; index++) if (positionOf[index] !== -1) return true
    return false
  }
  const isMissing = (token: number, kind: number) => token >= 0 && token < tokens.count && tokens.kind[token] === kind && !hasKeptCodePoint(token)
  const found = new Map<number, MisplacedMissing>()
  for (let token = 0; token < tokens.count; token++) {
    if (isTrivia(tokens.kind[token]!) || hasKeptCodePoint(token)) continue
    const isPlaceholder = (tokens.kind[token] === openingBracket && isMissing(token + 1, closingBracket)) || (tokens.kind[token] === closingBracket && isMissing(token - 1, openingBracket))
    // The kept code points around the missing token. Where they are not neighbours in the broken program, added text
    // stands at the token's place.
    let before = tokens.start[token]! - 1
    while (before >= 0 && positionOf[before] === -1) before--
    let after = tokens.start[token]! + tokens.length[token]!
    while (after < repaired.length && positionOf[after] === -1) after++
    const positionBefore = before === -1 ? -1 : positionOf[before]!
    const positionAfter = after === repaired.length ? alignment.length : positionOf[after]!
    if (positionAfter - positionBefore > 1 && !isPlaceholder) continue
    let next = token + 1
    while (next < tokens.count && !hasKeptCodePoint(next)) next++
    if (next === tokens.count || !isTrivia(tokens.kind[next]!)) continue
    // The last code point before the tokens without a kept code point that end with this token: a parser has the
    // stack of that code point when it reads the white space.
    let first = token
    while (first > 0 && !hasKeptCodePoint(first - 1)) first--
    const lastBefore = tokens.start[first]! - 1
    const whiteSpaceIndex = tokens.start[next]!
    const changes = labels.depth[whiteSpaceIndex] !== (lastBefore < 0 ? 0 : labels.depth[lastBefore]) || labels.container[whiteSpaceIndex] !== (lastBefore < 0 ? 0 : labels.container[lastBefore])
    const start = tokens.start[token]!
    const entry = found.get(whiteSpaceIndex) ?? {tokens: [], position: positionAfter, whiteSpaceIndex, changesDepthOrContainer: false}
    entry.tokens.push(textOf(repaired.subarray(start, start + tokens.length[token]!)))
    entry.changesDepthOrContainer ||= changes
    found.set(whiteSpaceIndex, entry)
  }
  return [...found.values()]
}

// What in a repair is against the rules of REPAIR.md, as far as the two texts show it. `alignment` is the alignment
// in the fixed form, and `labels` are the labels of the repaired program.
//
// A missing token before white space is named when the repairer's own marks put it there, or when the white space
// has another depth or container for it. The fixed form can move a missing run behind an equal code point, e.g. the
// missing ` *)` of a comment before a ` * ` into `) *`. Where only that puts a token before white space, and no
// scored value hangs on it, the repair is taken as it is.
export function alignmentProblems(aligned: Aligned, labels: ValidLabels, alignment: ArrayLike<number>): string[] {
  const problems: string[] = []
  // By the repairer's own marks: the fixed form keeps what an added and a missing text share.
  const changes = changeRunsOf(aligned.broken, aligned.repaired, aligned.alignment)
  changes.forEach((change, index) => {
    const after = changes[index + 1]
    if (change.kind !== 'added' || after?.kind !== 'missing' || after.position !== change.position + change.codePoints.length) return
    if (change.codePoints.join('') === after.codePoints.join('')) problems.push(`${JSON.stringify(change.codePoints.join(''))} is added and missing at code point ${change.position}. Text that both programs have at one place stands outside the marks`)
  })
  const byOwnMarks = new Set(missingBeforeWhiteSpace(labels, aligned.alignment).map(entry => entry.whiteSpaceIndex))
  for (const {tokens, position, whiteSpaceIndex, changesDepthOrContainer} of missingBeforeWhiteSpace(labels, alignment)) {
    if (!changesDepthOrContainer && !byOwnMarks.has(whiteSpaceIndex)) continue
    problems.push(`the missing ${tokens.map(token => JSON.stringify(token)).join(' and ')} stand${tokens.length === 1 ? 's' : ''} before white space or a comment of the broken program, at code point ${position}. By rule 4 of REPAIR.md a whole token that is missing stands right before the next token of the broken program, after the white space and the comments between them, or at the very end when no token follows. The tools take the later of two equal code points for the missing one, e.g. the second of two closing brackets`)
  }
  return problems
}

// The index in the broken program of the first damaged code point by an alignment: the first added one, the first
// kept one after a missing part, or the broken program's length when only the program's end is missing.
export function firstDamageOf(alignment: ArrayLike<number>, repairedLength: number): number {
  for (let position = 0; position < alignment.length; position++) if (alignment[position] !== position) return position
  return alignment.length < repairedLength ? alignment.length : -1
}

// One opinion about a broken program, from a repair, or what keeps the repair from being one: its aligned text gives
// that broken program, its repaired program is valid, its alignment follows the rules that the two texts show, and a
// kept code point is left from the first error on. `id` and `edits` go into the opinion's sample.
export function opinionOf(name: Opinion['name'], repair: Pick<RepairEntry, 'aligned' | 'note' | 'unsure'>, broken: string, id: string, edits: readonly string[] = []): Opinion | {problems: string[]} {
  const problems: string[] = []
  const {aligned} = repair
  if (aligned.broken !== broken) {
    const given = Array.from(aligned.broken)
    const wanted = Array.from(broken)
    let differs = 0
    while (differs < given.length && differs < wanted.length && given[differs] === wanted[differs]) differs++
    const line = wanted.slice(0, differs).filter(character => character === '\n').length + 1
    const shown = (codePoints: readonly string[]) => differs >= codePoints.length ? 'its end' : JSON.stringify(codePoints.slice(differs, differs + 20).join(''))
    problems.push(`the aligned text does not give the broken program. Without the runs ⟦missing⟧…⟦/⟧ and with the text of the runs ⟦added⟧…⟦/⟧ it must be the broken program, code point for code point. The two first differ at code point ${differs}, on line ${line} of the broken program: the broken program has ${shown(wanted)} there and the aligned text gives ${shown(given)}`)
  }
  if (aligned.repaired === aligned.broken) return {problems: [...problems, 'the repair changes nothing yet: the aligned text has no mark']}
  problems.push(...validTextProblems(aligned.repaired).map(problem => `the repaired program: ${problem}`))
  if (problems.length > 0) return {problems}
  const labels = labelsOfValidText(aligned.repaired)
  let sample: ReturnType<typeof makeSample>
  try {
    sample = makeSample({id, edits, original: aligned.repaired, broken, alignment: aligned.alignment}, labels)
  } catch (error) {
    // makeSample throws for an alignment that does not fit the two texts, which an aligned text cannot give.
    return {problems: [`the tools make no sample of the repair, which is an error of the tools and not of the repair: tell the lead. ${error instanceof Error ? error.message : String(error)}`]}
  }
  if (typeof sample === 'string') {
    // 'unchanged' cannot come here: the two texts differ.
    const why = sample === 'nothing to score' ? 'no kept code point stands from the parser\'s first error on, so the case has nothing to score. Put the damage where a part of the program comes after it'
      : sample === 'still valid' ? 'the broken program is a valid program, so it has no first error' : 'the broken program has more than 512 code points'
    return {problems: [why]}
  }
  problems.push(...alignmentProblems(aligned, labels, sample.alignment))
  return problems.length > 0 ? {problems} : {name, text: aligned.repaired, labels, note: repair.note, unsure: repair.unsure, sample}
}

// The kept tokens and the constituents of a broken program by an alignment, as makeSample of ../../sample.ts
// computes them: a token of the broken program is a kept token when its code points are, in order, all the code
// points of one token of the repaired program, and every reduction of the repaired program's parse gives the
// nonterminal with the first and the last kept token that it covers. makeSample has the two inside it, and this
// copy is for an alignment in which the disputed code points are given as added. check-written.ts holds the copy
// against makeSample.
export function keptTokensAndConstituents(labels: ValidLabels, tokens: Tokens, alignment: ArrayLike<number>): {keptToken: Int32Array, constituents: Int32Array} {
  const repairedTokens = labels.tokens
  const repairedTokenAt = new Int32Array(labels.codePoints.length + 1).fill(-1)
  for (let token = 0; token < repairedTokens.count; token++) repairedTokenAt[repairedTokens.start[token]!] = token
  const keptToken = new Int32Array(tokens.count).fill(-1)
  const brokenTokenOf = new Int32Array(repairedTokens.count).fill(-1)
  for (let token = 0; token < tokens.count; token++) {
    if (isTrivia(tokens.kind[token]!)) continue
    const start = tokens.start[token]!, length = tokens.length[token]!
    const counterpart = alignment[start]!
    if (counterpart === -1) continue
    const repairedToken = repairedTokenAt[counterpart]!
    if (repairedToken === -1 || repairedTokens.length[repairedToken] !== length) continue
    let consecutive = true
    for (let offset = 1; offset < length; offset++) if (alignment[start + offset] !== counterpart + offset) consecutive = false
    if (!consecutive) continue
    keptToken[token] = repairedToken
    brokenTokenOf[repairedToken] = token
  }
  const keys = new Set<number>()
  for (let reduction = 0; reduction < labels.reductionCount; reduction++) {
    let first = labels.reductionFirstToken[reduction]!, last = labels.reductionLastToken[reduction]!
    if (first === -1) continue
    while (first <= last && brokenTokenOf[first] === -1) first++
    while (last >= first && brokenTokenOf[last] === -1) last--
    if (first <= last) keys.add(constituentKey(tables.ruleLhs[labels.reductionRule[reduction]!]!, brokenTokenOf[first]!, brokenTokenOf[last]!))
  }
  return {keptToken, constituents: Int32Array.from(keys).sort()}
}

// An opinion's sample in which the code points that `agreement` calls disputed are given as added ones.
function withoutDisputed(opinion: Opinion, agreement: readonly Agreement[]): Sample {
  const {sample} = opinion
  if (!agreement.includes('disputed')) return sample
  const alignment = sample.alignment.slice(), labelKind = sample.labelKind.slice(), labelDepth = sample.labelDepth.slice(), labelContainer = sample.labelContainer.slice(), labelStack = sample.labelStack.slice()
  let scored = 0
  agreement.forEach((state, position) => {
    if (state === 'disputed') {
      alignment[position] = -1
      labelKind[position] = -1
      labelDepth[position] = -1
      labelContainer[position] = -1
      labelStack[position] = 0
    } else if (alignment[position] !== -1 && position >= sample.firstErrorPosition) scored++
  })
  return {...sample, alignment, labelKind, labelDepth, labelContainer, labelStack, scored, ...keptTokensAndConstituents(opinion.labels, sample.tokens, alignment)}
}

// A case with its opinions and their agreement. With one opinion every code point is agreed or added.
export function caseOf(texts: Pick<BrokenEntry, 'id' | 'broken'>, file: string, from: string, opinions: Opinion[]): WrittenCase {
  const first = opinions[0]!
  const length = first.sample.codePoints.length
  const agreement: Agreement[] = []
  const stackAgreed = new Uint8Array(length)
  const samples = opinions.map(opinion => opinion.sample)
  for (let position = 0; position < length; position++) {
    if (samples.every(sample => sample.alignment[position] === -1)) agreement.push('added')
    else if (samples.some(sample => sample.alignment[position] === -1)) agreement.push('disputed')
    else {
      const same = (values: (sample: Sample) => ArrayLike<number>) => samples.every(sample => values(sample)[position] === values(first.sample)[position])
      const agreed = same(sample => sample.labelKind) && same(sample => sample.labelDepth) && same(sample => sample.labelContainer)
      agreement.push(agreed ? 'agreed' : 'disputed')
      if (agreed && same(sample => sample.labelStack)) stackAgreed[position] = 1
    }
  }
  const sample = withoutDisputed(first, agreement)
  const sameNumbers = (left: Int32Array, right: Int32Array) => left.length === right.length && left.every((value, index) => value === right[index])
  return {
    id: texts.id, file, from, broken: texts.broken, opinions, agreement, sample, stackAgreed,
    constituentsAgreed: opinions.every(opinion => sameNumbers(withoutDisputed(opinion, agreement).constituents, sample.constituents)),
    firstDamage: firstDamageOf(first.sample.alignment, first.labels.codePoints.length),
    disputedFromFirstError: agreement.some((state, position) => state === 'disputed' && position >= sample.firstErrorPosition),
  }
}

// The samples of cases for a score, in one of the two ways to count the set:
// - 'full agreement': the cases without a disputed code point from the first error on. This is the set's main number.
//   A case with one repair has no disputed code point.
// - 'agreed code points': all cases in which an agreed code point stands from the first error on. A disputed code
//   point is given as an added one, so no score counts it.
export function samplesOfWritten(cases: readonly WrittenCase[], counted: 'full agreement' | 'agreed code points' = 'full agreement'): Sample[] {
  return cases.filter(writtenCase => writtenCase.sample.scored > 0 && (counted === 'agreed code points' || !writtenCase.disputedFromFirstError)).map(writtenCase => writtenCase.sample)
}

// What the parser as it is shows of a broken program: the display kind, the depth and the container of every code
// point before its first error, as ../../labels.ts reads them off the stack, and -1 from the first error's token on,
// where it has stopped.
export function shownBeforeFirstError(sample: Pick<Sample, 'codePoints' | 'tokens'>): {kind: Int8Array, depth: Int16Array, container: Int8Array} {
  const {codePoints, tokens} = sample
  const kind = new Int8Array(codePoints.length).fill(-1), depth = new Int16Array(codePoints.length).fill(-1), container = new Int8Array(codePoints.length).fill(-1)
  // Labels the token, and the white space and comments after it, with the stack as it is.
  const label = (token: number, tokenKind: number, stack: readonly number[]) => {
    for (let at = token; at < tokens.count && (at === token || isTrivia(tokens.kind[at]!)); at++) {
      const from = tokens.start[at]!, to = from + tokens.length[at]!
      kind.fill(at === token && tokenKind !== -1 ? tokenKind : tokens.kind[at] === commentKind ? displayKind.comment : displayKind.whitespace, from, to)
      depth.fill(depthOf(stack), from, to)
      container.fill(containerOf(stack), from, to)
    }
  }
  if (tokens.count > 0 && isTrivia(tokens.kind[0]!)) label(0, -1, [tables.startState])
  parse(tokens, codePoints.length, {shift: (token, state, stack) => label(token, displayOfState[state]!, stack)})
  return {kind, depth, container}
}

const textFilesOf = (folder: string) => existsSync(folder) ? readdirSync(folder).filter(name => name.endsWith('.txt')).sort() : []

export type ReadOptions = {
  // The name of one writer's file without its ending, e.g. 'hand-edits': only broken/hand-edits.txt and its repairs
  // are read.
  only?: string
  // Which repairs are the opinions of a case: both, which is the default, the writer's repair alone, or the second
  // repair alone, for a second repairer, who has no folder repairs/.
  opinions?: 'both' | 'writer' | 'second'
}

// Every case of broken/ with its repair of repairs/ and, when there is one, its second repair of second-repairs/,
// and what is wrong with the files. A repair of a case stands in the file with the name of the case's file, e.g. the
// repairs of broken/hand-edits.txt in repairs/hand-edits.txt. A case with a problem, in its broken program or in one
// of its repairs, is left out, and `leftOut` has its id. So the problems must be empty before the cases are used for
// a result.
export function readWritten(folder: string = writtenFolder, options: ReadOptions = {}): {cases: WrittenCase[], problems: string[], leftOut: string[]} {
  const problems: string[] = []
  const cases: WrittenCase[] = []
  const leftOut: string[] = []
  const wanted = (name: string) => options.only === undefined || name === `${options.only}.txt`
  const brokenFiles = textFilesOf(join(folder, 'broken')).filter(wanted)
  if (options.only !== undefined && brokenFiles.length === 0) problems.push(`broken/${options.only}.txt: there is no such file in ${folder}`)
  const fileOfId = new Map<string, string>()
  const idOfBroken = new Map<string, string>()
  const opinions = options.opinions ?? 'both'
  const firstFolder = opinions === 'second' ? 'second-repairs' : 'repairs'
  const readRepairs = (subfolder: 'repairs' | 'second-repairs', file: string) => {
    const path = join(folder, subfolder, file)
    const repairs = new Map<string, RepairEntry>()
    if (!existsSync(path)) return undefined
    const read = readRepairFile(readFileSync(path, 'utf8'), subfolder === 'repairs' ? 'writer' : 'second')
    problems.push(...read.problems.map(problem => `${subfolder}/${file}: ${problem}`))
    for (const repair of read.items) repairs.set(repair.id, repair)
    return repairs
  }
  for (const file of brokenFiles) {
    const read = readBrokenFile(readFileSync(join(folder, 'broken', file), 'utf8'))
    problems.push(...read.problems.map(problem => `broken/${file}: ${problem}`))
    const writerRepairs = opinions === 'second' ? undefined : readRepairs('repairs', file)
    const secondRepairs = opinions === 'writer' ? undefined : readRepairs('second-repairs', file)
    const firstRepairs = opinions === 'second' ? secondRepairs : writerRepairs
    if (firstRepairs === undefined) problems.push(`${firstFolder}/${file}: the file is missing, which holds the repairs of broken/${file}`)
    const ids = new Set(read.items.map(texts => texts.id))
    for (const [subfolder, repairs] of [['repairs', writerRepairs], ['second-repairs', secondRepairs]] as const) {
      for (const id of repairs?.keys() ?? []) if (!ids.has(id)) problems.push(`${subfolder}/${file}: repair ${id}: broken/${file} has no broken program with this id`)
    }
    const theme = file.replace(/\.txt$/, '')
    for (const texts of read.items) {
      const where = `broken/${file}: case ${texts.id}`
      const found = brokenTextProblems(texts.broken).map(problem => `the broken program: ${problem}`)
      if (!texts.id.startsWith(`${theme}-`)) found.push(`the id starts with the file's name and a hyphen, e.g. ${theme}-01, so that no two files have the same id`)
      if (fileOfId.has(texts.id)) found.push(`the id is also in broken/${fileOfId.get(texts.id)!}`)
      if (idOfBroken.has(texts.broken)) found.push(`the broken program is also the broken program of the case ${idOfBroken.get(texts.broken)!}`)
      const readOpinions: Opinion[] = []
      const firstRepair = firstRepairs?.get(texts.id)
      if (firstRepairs !== undefined && firstRepair === undefined) found.push(`${firstFolder}/${file} has no repair with this id`)
      const secondRepair = opinions === 'both' ? secondRepairs?.get(texts.id) : undefined
      for (const [name, repair] of [[opinions === 'second' ? 'second' : 'writer', firstRepair], ['second', secondRepair]] as const) {
        // A repair of a text that is no broken program is not read: the problem of the text is named once.
        if (repair === undefined || found.length > 0) continue
        const opinion = opinionOf(name, repair, texts.broken, texts.id, [theme])
        if ('problems' in opinion) found.push(...opinion.problems.map(problem => `the repair of ${name === 'writer' ? 'repairs' : 'second-repairs'}/${file}: ${problem}`))
        else readOpinions.push(opinion)
      }
      problems.push(...found.map(problem => `${where}: ${problem}`))
      if (found.length > 0 || readOpinions.length === 0) {
        leftOut.push(texts.id)
        continue
      }
      fileOfId.set(texts.id, file)
      idOfBroken.set(texts.broken, texts.id)
      cases.push(caseOf(texts, file, firstRepair?.from ?? '', readOpinions))
    }
  }
  return {cases, problems, leftOut}
}

// The folder that `--set <folder>` names among the arguments of a command, or the folder of the set.
export function setFolderOf(commandArguments: readonly string[]): string {
  const index = commandArguments.indexOf('--set')
  if (index === -1) return writtenFolder
  const folder = commandArguments[index + 1]
  if (folder === undefined) throw new Error('--set needs a folder, e.g. --set lab/recovery-lr/held-back/written/examples')
  return folder
}

// The arguments of a command that are no option: without the words that start with -- and without the folder of --set.
export const namesOf = (commandArguments: readonly string[]) => commandArguments.filter((argument, index) => !argument.startsWith('--') && commandArguments[index - 1] !== '--set')

if (import.meta.main) {
  const folder = setFolderOf(process.argv.slice(2))
  const {cases, problems} = readWritten(folder)
  if (process.argv.includes('--problems')) for (const problem of problems) console.log(`problem: ${problem}`)
  const count = (states: readonly Agreement[], from: number, wanted: Agreement) => states.reduce((total, state, position) => total + Number(position >= from && state === wanted), 0)
  console.log('Per case: the writer\'s file and id, the repairs, where the parser as it is has its first error, and from that code point on the')
  console.log('scored code points, the code points that every opinion calls added, and the disputed ones.')
  for (const writtenCase of cases) {
    const marks = writtenCase.opinions.filter(opinion => opinion.unsure !== undefined).map(opinion => `${opinion.name} is unsure`)
    const {sample} = writtenCase
    console.log(`  ${writtenCase.file} ${writtenCase.id}: ${writtenCase.opinions.length} repair${writtenCase.opinions.length === 1 ? '' : 's'}, first error at ${sample.firstErrorPosition} of ${writtenCase.agreement.length}, `
      + `${sample.scored} scored, ${count(writtenCase.agreement, sample.firstErrorPosition, 'added')} added, ${count(writtenCase.agreement, sample.firstErrorPosition, 'disputed')} disputed${marks.length > 0 ? `, ${marks.join(', ')}` : ''}`)
  }
  const disputed = cases.filter(writtenCase => writtenCase.disputedFromFirstError)
  const twice = cases.filter(writtenCase => writtenCase.opinions.length === 2).length
  console.log(`${cases.length} cases: ${twice} with two repairs, ${cases.length - twice} with one. ${cases.length - disputed.length} with full agreement from the first error on, ${disputed.length} with a disputed code point there. ${problems.length} problems.`)
  if (problems.length > 0) process.exitCode = 1
}
