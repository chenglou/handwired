// Closing brackets that are missing, extra or of the other kind.
import {insertAt, removeRange, replaceOneForOne} from '../edits.ts'
import type {Random} from '../random.ts'
import {type Scan, hasOwnLine, indentationAt, lastOnLine, lineEnd, lineStart, nextToken, openContainersAt} from '../scan.ts'
import type {Damage, KindDefinition, Reachable} from './types.ts'

const closerOf = (type: 'object' | 'array') => type === 'object' ? '}' : ']'
const otherCloser = (closer: string) => closer === '}' ? ']' : '}'

// A container's closing bracket is not there: it is typed last in a plain editor, or a deleted block took its line.
function missingCloser(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const inner = scanned.containers.filter(container => container.parent !== null)
  if (inner.length === 0) return undefined
  // The closer's line holds the closer and maybe its comma.
  const ownLine = inner.filter(container => container.severalLines && lastOnLine(codePoints, codePoints[container.close + 1] === ',' ? container.close + 2 : container.close + 1))
  // A closer that has the same closer right after it is left alone: without it the text is the same as without the
  // later one, so nothing says which of the two is missing, and when the later one ends the document the text is cut off.
  const insideLine = inner.filter(container => !container.severalLines && codePoints[container.close + 1] !== codePoints[container.close])
  if (ownLine.length === 0 && insideLine.length === 0) return undefined
  const wholeLine = ownLine.length > 0 && (insideLine.length === 0 || random.chance(0.55))
  const container = random.pick(wholeLine ? ownLine : insideLine)
  const parent = container.parent!
  let removedEnd = container.close + 1
  let edit = removeRange(container.close, container.close + 1)
  if (wholeLine) {
    removedEnd = lineEnd(codePoints, container.close) + 1
    edit = removeRange(lineStart(codePoints, container.close), removedEnd)
  }
  const next = nextToken(codePoints, removedEnd)
  const nextIsParentCloser = next === parent.close
  const follows = nextIsParentCloser ? `the closer of the ${parent.type} around it` : codePoints[next] === ',' ? 'its comma' : `an entry of the ${parent.type} around it`
  // A closer of the other kind can't close this container, so it closes this one and the one around it. Every other
  // text looks right until much later: the next entry reads as one more entry of the open container.
  const reachable: Reachable = nextIsParentCloser && parent.type !== container.type ? 'yes' : 'no'
  return {
    edits: [edit],
    form: `${wholeLine ? 'the line of the closer' : 'a closer inside a line'} of an ${container.type}, then ${follows}`,
    reachable,
    // In a one-line text the missing closer could as well belong at the end.
    debatable: !wholeLine && !nextIsParentCloser,
  }
}

// Whether a parser can go on as the original after a closing bracket that the original doesn't have, inserted before
// `at`. `commaFollows` says that a comma comes right after the bracket.
function strayCloserReachable(scanned: Scan, at: number, closer: string, commaFollows: boolean): Reachable {
  const {codePoints} = scanned
  if (nextToken(codePoints, at) >= codePoints.length) return 'yes'
  const open = openContainersAt(scanned, at)
  const type = closer === '}' ? 'object' : 'array'
  // No open container has the bracket's kind, so it can only be skipped.
  if (open.every(container => container.type !== type)) return 'yes'
  const innermost = open.at(-1)!
  // The bracket closes the top-level container, and the comma after it shows that the document goes on, so the parser
  // can open the container again. Any deeper, the bracket reads as a real closer and nothing looks wrong until the end.
  if (innermost.type === type) return open.length === 1 && commaFollows ? 'yes' : 'no'
  return 'no'
}

// One closing bracket too many: typed although the editor had added it, pasted with a block, or left behind by one.
function strayCloser(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const rootContainer = scanned.root.container
  if (rootContainer === null) return undefined
  const lineMembers = scanned.entries.filter(entry => entry.container.type === 'object' && entry.container.severalLines && hasOwnLine(codePoints, entry) && lastOnLine(codePoints, entry.end + Number(entry.commaAfter !== -1)))
  const scalarMembers = scanned.entries.filter(entry => entry.key !== null && entry.value.container === null && entry.container.severalLines)
  const innerClosers = scanned.containers.filter(container => container.parent !== null)
  const form = random.weighted([
    ['after the last closer', 26], ['a line of its own', lineMembers.length > 0 ? 36 : 0], ['after a value', scalarMembers.length > 0 ? 16 : 0], ['a closer twice', innerClosers.length > 0 ? 22 : 0],
  ] as const)
  switch (form) {
    case 'after the last closer': {
      const closer = closerOf(rootContainer.type)
      const onNewLine = scanned.severalLines && random.chance(0.6)
      return {edits: [insertAt(rootContainer.close + 1, onNewLine ? `\n${closer}` : closer)], form: `after the document's last closer${onNewLine ? ', on a new line' : ''}`, reachable: 'yes', debatable: true}
    }
    case 'a line of its own': {
      // Between two members or after the last one, where a block's closer was left behind.
      const entry = random.pick(lineMembers)
      const at = lineEnd(codePoints, entry.end) + 1
      if (at > codePoints.length) return undefined
      const closer = random.chance(0.7) ? '}' : ']'
      const withComma = random.chance(0.5)
      const indentation = indentationAt(codePoints, entry.start)
      const outer = indentationAt(codePoints, entry.container.close)
      return {
        edits: [insertAt(at, `${random.chance(0.5) ? indentation : outer}${closer}${withComma ? ',' : ''}\n`)],
        form: `a line with ${closer}${withComma ? ',' : ''} after a member at depth ${entry.container.depth}`,
        reachable: strayCloserReachable(scanned, at, closer, withComma), debatable: true,
      }
    }
    case 'after a value': {
      // E.g. "files": "dist"], after a person removed the [ in front.
      const entry = random.pick(scalarMembers)
      const closer = random.chance(0.6) ? ']' : '}'
      return {
        edits: [insertAt(entry.end, closer)], form: `${closer} right after a member's value at depth ${entry.container.depth}`,
        reachable: strayCloserReachable(scanned, entry.end, closer, entry.commaAfter !== -1), debatable: true,
      }
    }
    case 'a closer twice': {
      const container = random.pick(innerClosers)
      const closer = closerOf(container.type)
      const at = container.close + 1
      return {
        edits: [insertAt(at, closer)], form: `a second ${closer} after the closer of a container at depth ${container.depth}`,
        reachable: strayCloserReachable(scanned, at, closer, codePoints[nextToken(codePoints, at)] === ','), debatable: true,
      }
    }
  }
}

// A closing bracket of the other kind.
function wrongCloser(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const filled = scanned.containers.filter(container => container.entries.length > 0)
  if (filled.length === 0) return undefined
  // Two closers of different kinds next to each other, e.g. ]} written as }].
  const pairs = filled.filter(container => container.parent !== null && container.parent.type !== container.type && container.parent.close === container.close + 1)
  if (pairs.length > 0 && random.chance(0.4)) {
    const container = random.pick(pairs)
    const closer = codePoints[container.close]!
    return {
      edits: [replaceOneForOne(container.close, otherCloser(closer)), replaceOneForOne(container.close + 1, closer)],
      form: `two closers in the wrong order, ${otherCloser(closer)}${closer} for ${closer}${otherCloser(closer)}`, reachable: 'yes', debatable: true,
    }
  }
  const container = random.pick(filled)
  const closer = codePoints[container.close]!
  const parentHasNewKind = container.parent !== null && container.parent.type !== container.type
  return {
    edits: [replaceOneForOne(container.close, otherCloser(closer))],
    form: `${otherCloser(closer)} for the ${closer} of a container at depth ${container.depth}${parentHasNewKind ? ', and the container around it has that kind' : ''}`,
    reachable: 'yes',
    // When the container around it has the new bracket's kind, the text also reads as a missing closer before a real one.
    debatable: parentHasNewKind,
  }
}

export const bracketKinds: KindDefinition[] = [
  {
    name: 'missingCloser', family: 'bracket', weight: 2.7,
    example: '{"tags": ["ops", "beta"}',
    reachable: 'yes when the closer of the container around it follows and is of the other kind, so it closes both. Otherwise no: the next entry reads as one more entry of the open container, and the depth stays one too high',
    apply: missingCloser,
  },
  {
    name: 'strayCloser', family: 'bracket', weight: 1.5,
    example: '{⏎  "name": "Ada",⏎  },⏎  "active": true⏎}',
    reachable: 'yes after the document\'s end, when no open container has the bracket\'s kind, and when it closes the top-level container and a comma follows. Otherwise no: it reads as a real closer',
    margin: 20,
    apply: strayCloser,
  },
  {
    name: 'wrongCloser', family: 'bracket', weight: 0.8,
    example: '{"point": [59.91, 10.75}}',
    reachable: 'yes, with the rule "a closer of the wrong kind closes one level anyway", which contradicts the rule that recovers missingCloser',
    apply: wrongCloser,
  },
]
