// Closing brackets that are missing, extra or of the other kind.
import {type Edit, insertAt, removeRange, replaceOneForOne} from '../edits.ts'
import type {Random} from '../random.ts'
import {type Scan, hasOwnLine, indentationAt, lastOnLine, lineEnd, lineStart, nextToken, openContainersAt} from '../scan.ts'
import type {Damage, KindDefinition} from './types.ts'

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
  const closesBoth = nextIsParentCloser && parent.type !== container.type
  return {
    edits: [edit],
    form: `${wholeLine ? 'the line of the closer' : 'a closer inside a line'} of an ${container.type}, then ${follows}`,
    reachable: closesBoth ? 'yes' : 'no',
    ...(closesBoth ? {needsRules: ['a closer of the other kind closes two containers']} : {}),
    // Without a closer of the other kind after it, the text also reads as a container that goes on, with its closer
    // missing further down: only the indentation says otherwise.
    debatable: !closesBoth,
  }
}

// Whether a parser can go on as the original after a closing bracket that the original doesn't have, inserted before
// `at`. `commaFollows` says that a comma comes right after the bracket.
function strayCloserReachable(scanned: Scan, at: number, closer: string, commaFollows: boolean): Pick<Damage, 'reachable' | 'needsRules'> {
  const {codePoints} = scanned
  if (nextToken(codePoints, at) >= codePoints.length) return {reachable: 'yes'}
  const open = openContainersAt(scanned, at)
  const type = closer === '}' ? 'object' : 'array'
  // No open container has the bracket's kind, so it can only be skipped.
  if (open.every(container => container.type !== type)) return {reachable: 'yes'}
  // The bracket closes the top-level container, and the comma after it shows that the document goes on, so the parser
  // can open the container again. Any deeper, the bracket reads as a real closer and nothing looks wrong until the end.
  if (open.at(-1)!.type === type && open.length === 1 && commaFollows) return {reachable: 'yes', needsRules: ['a comma after the top-level value opens the value again']}
  return {reachable: 'no'}
}

// One closing bracket too many: typed although the editor had added it, pasted with a block, or left behind by one.
//
// When the same closer follows the extra one, the text does not say which of the two is extra, and a reader takes the
// first as the real one. The edits say the same: the first is the kept one, and what comes after it up to and
// including the second is added, e.g. in `  }<line feed>}` at the end of a document the line feed and the last } are
// the added text.
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
  // The damage of the text `before + closer + after`, put in at `place`.
  const insertCloser = (place: number, before: string, closer: string, after: string, formText: string): Damage => {
    // A lone closer right before the same closers goes behind them: of `}}}}` for `}}}` the last one is the extra one.
    let at = place
    if (before === '' && after === '') while (codePoints[at] === closer) at++
    let next = nextToken(codePoints, at)
    if (codePoints[next] !== closer) {
      const commaFollows = after === '' ? codePoints[next] === ',' : after.startsWith(',')
      return {edits: [insertAt(at, `${before}${closer}${after}`)], form: formText, ...strayCloserReachable(scanned, at, closer, commaFollows), debatable: true}
    }
    // The same closer follows after the white space `between`. The broken text is then `before`, a closer, `after`,
    // `between`, a closer. The first closer is the kept one: before it, the white space that `before` and `between`
    // share is kept too, and after it, everything up to and including the second closer is added. When the same
    // closer follows once more, the second closer is a kept one as well, and so on: the extra closer is the last.
    const edits: Edit[] = []
    let added = before
    let rest = after
    while (codePoints[next] === closer) {
      const between = codePoints.slice(at, next).join('')
      let shared = 0
      while (shared < added.length && shared < between.length && added[shared] === between[shared]) shared++
      if (shared < added.length) edits.push(insertAt(at + shared, added.slice(shared)))
      if (shared < between.length) edits.push(removeRange(at + shared, next))
      added = `${rest}${between}`
      rest = ''
      at = next + 1
      next = nextToken(codePoints, at)
    }
    edits.push(insertAt(at, `${added}${closer}`))
    return {edits, form: `${formText}, before the same closer`, ...strayCloserReachable(scanned, at, closer, codePoints[next] === ','), debatable: true}
  }
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
      const indentation = random.chance(0.5) ? indentationAt(codePoints, entry.start) : indentationAt(codePoints, entry.container.close)
      return insertCloser(at, indentation, closer, `${withComma ? ',' : ''}\n`, `a line with ${closer}${withComma ? ',' : ''} after a member at depth ${entry.container.depth}`)
    }
    case 'after a value': {
      // E.g. "files": "dist"], after a person removed the [ in front.
      const entry = random.pick(scalarMembers)
      const closer = random.chance(0.6) ? ']' : '}'
      return insertCloser(entry.end, '', closer, '', `${closer} right after a member's value at depth ${entry.container.depth}`)
    }
    case 'a closer twice': {
      const container = random.pick(innerClosers)
      const closer = closerOf(container.type)
      return insertCloser(container.close + 1, '', closer, '', `a second ${closer} after the closer of a container at depth ${container.depth}`)
    }
  }
}

// A closing bracket of the other kind.
function wrongCloser(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const filled = scanned.containers.filter(container => container.entries.length > 0)
  if (filled.length === 0) return undefined
  const closesOne: Damage['needsRules'] = ['a closer of the other kind closes one container']
  // Two closers of different kinds with nothing but white space between them, e.g. ]} written as }]. Four texts in
  // ten are of this form, so a document without such a pair is left to another try in that share.
  const pairs = filled.filter(container => container.parent !== null && container.parent.type !== container.type && container.parent.close === nextToken(codePoints, container.close + 1))
  if (random.chance(0.4)) {
    if (pairs.length === 0) return undefined
    const container = random.pick(pairs)
    const closer = codePoints[container.close]!
    return {
      edits: [replaceOneForOne(container.close, otherCloser(closer)), replaceOneForOne(container.parent!.close, closer)],
      form: `two closers in the wrong order, ${otherCloser(closer)} then ${closer} for ${closer} then ${otherCloser(closer)}`, reachable: 'yes', needsRules: closesOne, debatable: true,
    }
  }
  const container = random.pick(filled)
  const closer = codePoints[container.close]!
  const parentHasNewKind = container.parent !== null && container.parent.type !== container.type
  return {
    edits: [replaceOneForOne(container.close, otherCloser(closer))],
    form: `${otherCloser(closer)} for the ${closer} of a container at depth ${container.depth}${parentHasNewKind ? ', and the container around it has that kind' : ''}`,
    reachable: 'yes', needsRules: closesOne,
    // When the container around it has the new bracket's kind, the text also reads as a missing closer before a real one.
    debatable: parentHasNewKind,
  }
}

export const bracketKinds: KindDefinition[] = [
  {
    name: 'missingCloser', family: 'bracket', origin: 'either', weight: 2.7,
    example: '{"tags": ["ops", "beta"}',
    reachable: 'yes when the closer of the container around it follows and is of the other kind, with the rule that such a closer closes two containers. Otherwise no: the next entry reads as one more entry of the open container. The loop of the highlighter cannot close two containers at one bracket',
    apply: missingCloser,
  },
  {
    name: 'strayCloser', family: 'bracket', origin: 'either', weight: 1.5,
    example: '{⏎  "name": "Ada",⏎  },⏎  "active": true⏎}',
    reachable: 'yes after the document\'s end, when no open container has the bracket\'s kind, and when it closes the top-level container and a comma follows. Otherwise no: it reads as a real closer. A closer right before the same closer is the kept one, and the second is the added one. The loop of the highlighter lowers the depth at every closing bracket that the tokenizer reads by a cell of valid JSON, so there it can only label what comes after the document\'s end',
    margin: 20,
    apply: strayCloser,
  },
  {
    name: 'wrongCloser', family: 'bracket', origin: 'either', weight: 0.8,
    example: '{"point": [59.91, 10.75}}',
    reachable: 'yes, with the rule that a closer of the other kind closes one container, which contradicts the rule for a missing closer. The loop of the highlighter then has the wrong kind for a container around it, when the tokenizer reads the closer by a cell of valid JSON',
    apply: wrongCloser,
  },
]
