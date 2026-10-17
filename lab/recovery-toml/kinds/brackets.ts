// A closing bracket of an array or of an inline table that is missing, extra or of the other kind.
import {insertAt, removeRange, replaceOneForOne} from '../edits.ts'
import type {Random} from '../random.ts'
import {chooseForm} from './assignment.ts'
import {type Container, type Scan, firstOnLine, indentationAt, isSpaceOrTab, lastOnLine, lineAt} from './scan.ts'
import type {Damage, KindDefinition} from './types.ts'

const closerOf = (container: Container) => container.type === 'array' ? ']' : '}'
const nameOf = (container: Container) => container.type === 'array' ? 'an array' : 'an inline table'

function missingCloser(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const arrays = scanned.containers.filter(container => container.type === 'array')
  const onOneLine = arrays.filter(container => !container.severalLines)
  const onSeveralLines = arrays.filter(container => container.severalLines)
  const inlineTables = scanned.containers.filter(container => container.type === 'inlineTable')
  const form = chooseForm(random, [
    ['the closing bracket of an array on one line', onOneLine.length > 0 ? 35 : 0], ['the closing bracket of an array on several lines', onSeveralLines.length > 0 ? 30 : 0],
    ['the closing brace of an inline table', inlineTables.length > 0 ? 35 : 0],
  ] as const)
  if (form === undefined) return undefined
  const container = random.pick(form === 'the closing bracket of an array on one line' ? onOneLine : form === 'the closing bracket of an array on several lines' ? onSeveralLines : inlineTables)
  const {close} = container
  // A bracket that is alone on its line goes with its line.
  if (firstOnLine(scanned, close) && lastOnLine(scanned, close + 1)) {
    const line = lineAt(scanned, close)
    if (line.next > line.end) return {edits: [removeRange(line.start, line.next)], form: `${form}, with its line`}
  }
  // Otherwise the bracket goes with the white space before it, e.g. the space of `[ 1, 2 ]`.
  let from = close
  while (isSpaceOrTab(codePoints[from - 1])) from--
  return {edits: [removeRange(from, close + 1)], form}
}

function strayCloser(random: Random, scanned: Scan): Damage | undefined {
  const {lineEnd} = scanned
  const scalarsAtLineEnd = scanned.entries.filter(entry => entry.value.container === null && lastOnLine(scanned, entry.value.end))
  const form = chooseForm(random, [
    ['a second closing bracket', scanned.containers.length > 0 ? 50 : 0], ['a closing bracket on a line of its own', scanned.entries.length > 0 ? 30 : 0],
    ['a closing bracket after a value that is no container', scalarsAtLineEnd.length > 0 ? 20 : 0],
  ] as const)
  if (form === undefined) return undefined
  switch (form) {
    case 'a second closing bracket': {
      const container = random.pick(scanned.containers)
      return {edits: [insertAt(container.close + 1, closerOf(container))], form: `a second closing bracket after ${nameOf(container)}`}
    }
    case 'a closing bracket on a line of its own': {
      // After an array on several lines in six draws of ten, when the document has one: the bracket of a removed array.
      const afterArrays = scanned.entries.filter(entry => entry.value.container?.severalLines === true)
      const entry = random.pick(afterArrays.length > 0 && random.chance(0.6) ? afterArrays : scanned.entries)
      const closer = entry.value.container === null ? random.pick([']', '}']) : closerOf(entry.value.container)
      const line = lineAt(scanned, entry.value.end)
      const indent = indentationAt(scanned, entry.key.start)
      return {edits: [line.next === line.end ? insertAt(line.end, `${lineEnd}${indent}${closer}`) : insertAt(line.next, `${indent}${closer}${lineEnd}`)], form: `a ${closer} on a line of its own`}
    }
    case 'a closing bracket after a value that is no container': {
      const closer = random.pick([']', '}'])
      return {edits: [insertAt(random.pick(scalarsAtLineEnd).value.end, closer)], form: `a ${closer} after a value that is no container`}
    }
  }
}

function wrongCloser(random: Random, scanned: Scan): Damage | undefined {
  if (scanned.containers.length === 0) return undefined
  const container = random.pick(scanned.containers)
  const closer = random.chance(0.7) ? (container.type === 'array' ? '}' : ']') : ')'
  return {edits: [replaceOneForOne(container.close, closer)], form: `${closer} in the place of the ${closerOf(container)} of ${nameOf(container)}`}
}

export const bracketKinds: KindDefinition[] = [
  {
    name: 'missingCloser', family: 'brackets', weight: 3,
    description: 'An array without its ] or an inline table without its }',
    example: 'ports = [80, 443⏎name = "a"',
    variants: 'an array on one line; an array on several lines, where the line of the ] goes when the ] is alone on it; an inline table',
    showable: 'yes for the display kinds, with the rule that a key and an equals sign, or a header, end an open array or inline table. The depth and the container are not scored from the lost bracket to the next kept bracket, and from that bracket on they are right only when the rule closed the container',
    apply: missingCloser,
  },
  {
    name: 'strayCloser', family: 'brackets', weight: 1.5,
    description: 'A closing bracket too many, as an editor that pairs brackets leaves it, or as the rest of a removed array',
    example: 'ports = [80, 443]]⏎]',
    variants: 'a second closing bracket after a container; a ] or a } on a line of its own after an entry; a ] or a } after a value that is no container',
    showable: 'yes at depth 0: a closing bracket where nothing is open closes nothing. Inside an array, a second ] closes that array, by a cell that valid TOML reads',
    apply: strayCloser,
  },
  {
    name: 'wrongCloser', family: 'brackets', weight: 1,
    description: 'A closing bracket of the other kind, or a parenthesis, in the place of a ] or a }',
    example: 'ports = [80, 443}⏎point = { x = 1, y = 2 ]',
    variants: '} or ) for the ] of an array; ] or ) for the } of an inline table',
    showable: 'yes: a closing bracket of the other kind closes the innermost container. A parenthesis needs a character class',
    apply: wrongCloser,
  },
]
