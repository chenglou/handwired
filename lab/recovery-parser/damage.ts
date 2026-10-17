// The kinds of damage, and the ways several of them come together in one text.
//
// A kind is a function from a random source and a valid text to edits, or to nothing when the text has no place for
// it. The kinds live in damage/, one file per family. This file lists them, and builds the plans that samples.ts
// carries out: one kind, two or three unrelated kinds, or a combination with one cause, e.g. a pasted JavaScript object
// literal, which has every key without quotes, every string in single quotes and a comma before every closer.
import {type DocumentRequest, type Style, type Template} from './documents.ts'
import {type Edit, insertAt, mergeEdits, removeRange} from './edits.ts'
import type {Random} from './random.ts'
import {type Scan, hasOwnLine, isWhitespace, lastOnLine, openContainersAt, scan} from './scan.ts'
import {bracketKinds} from './damage/brackets.ts'
import {commentKinds} from './damage/comments.ts'
import {cutKinds} from './damage/cuts.ts'
import {halfTypedKinds} from './damage/half-typed.ts'
import {notationKinds} from './damage/notations.ts'
import {separatorKinds} from './damage/separators.ts'
import {severalKinds} from './damage/several.ts'
import {slipKinds} from './damage/slips.ts'
import {stringKinds} from './damage/strings.ts'
import {type Damage, type KindDefinition, type KindOptions, type Reachable, type Rule, leastReachable, settleReachable} from './damage/types.ts'
import {logFieldsIn, wrapperKinds} from './damage/wrappers.ts'

export const kinds: readonly KindDefinition[] = [
  ...halfTypedKinds, ...slipKinds, ...cutKinds, ...separatorKinds, ...bracketKinds, ...commentKinds, ...notationKinds, ...stringKinds, ...wrapperKinds, ...severalKinds,
]
const kindByName = new Map(kinds.map(kind => [kind.name, kind]))
export function kindNamed(name: string): KindDefinition {
  const kind = kindByName.get(name)
  if (kind === undefined) throw new Error(`no kind of damage is named ${name}`)
  return kind
}

// What a plan made of a document: the damage of one or more kinds, already merged.
export type PlannedDamage = {
  kinds: string[]
  forms: string[]
  documents?: string[]
  edits: Edit[]
  reachable: Reachable
  needsRules: Rule[]
  unscoredKinds: number[]
  needsClass: string[]
  debatable: boolean
  // What the documents are and how they are written, when a kind made its own.
  template?: string
  style?: Style
}

// A plan says which document to make and what to do to it. `apply` returns nothing when the document has no place for
// the damage, and samples.ts then makes another document.
export type Plan = {
  // 'one kind', 'several kinds', or the name of a combination, e.g. 'javascriptLiteral'.
  recipe: string
  request: DocumentRequest
  apply: (random: Random, scanned: Scan) => PlannedDamage | undefined
}

// What several damages of one text come to: the least of their flags, or 'no' when they need rules that exclude each
// other, and everything else joined.
function joined(damages: readonly Damage[]): Pick<PlannedDamage, 'reachable' | 'needsRules' | 'unscoredKinds' | 'needsClass' | 'debatable'> {
  const needsRules = [...new Set(damages.flatMap(damage => damage.needsRules ?? []))]
  return {
    reachable: settleReachable(damages.map(damage => damage.reachable), needsRules), needsRules,
    unscoredKinds: [...new Set(damages.flatMap(damage => damage.unscoredKinds ?? []))].sort((left, right) => left - right),
    needsClass: [...new Set(damages.flatMap(damage => [damage.needsClass, damage.alsoNeedsClass].filter(need => need !== undefined)))],
    debatable: damages.some(damage => damage.debatable === true),
  }
}

// Applies kinds one after another to the same original and merges their edits. A step whose `required` is false is
// skipped when the text has no place for it. Only the first step may bring documents of its own, e.g. a document
// without the member that a comment switches off, and the later steps then work on that document. The edits of a step
// with `apart` must sit apart from those of every other step, or the text is left to another try: such a step is a
// damage of its own, e.g. the entry that is being typed in a file with comments.
type Step = {kind: string, options?: KindOptions, required?: boolean, apart?: boolean}
// A damage that a combination made itself, with the kind it counts as.
type Extra = {kind: string, damage: Damage}
function applySteps(random: Random, scanned: Scan, steps: readonly Step[], extra: readonly Extra[] = []): PlannedDamage | undefined {
  let current = scanned
  let documents: string[] | undefined
  let template: string | undefined
  let style: Style | undefined
  const applied: {kind: string, damage: Damage, apart: boolean}[] = []
  for (const [index, step] of steps.entries()) {
    const damage = kindNamed(step.kind).apply(random, current, step.options)
    if (damage === undefined) {
      if (step.required === false) continue
      return undefined
    }
    if (damage.documents !== undefined) {
      if (index > 0 || damage.documents.length !== 1 && steps.length > 1) return undefined
      documents = damage.documents
      template = damage.template
      style = damage.style
      if (documents.length === 1) current = scan(documents[0]!)
    }
    applied.push({kind: step.kind, damage, apart: step.apart === true})
  }
  for (const part of extra) applied.push({...part, apart: false})
  if (applied.length === 0) return undefined
  for (const one of applied) {
    if (one.apart && applied.some(other => other !== one && !sitApart(current, one.damage.edits, other.damage.edits))) return undefined
  }
  const originalLength = documents === undefined ? scanned.codePoints.length : documents.reduce((total, document) => total + Array.from(document).length, 0)
  const edits = mergeEdits(applied.map(({damage}) => damage.edits), originalLength)
  if (edits === undefined) return undefined
  const kindNames: string[] = []
  for (const {kind, damage} of applied) kindNames.push(kind, ...(damage.alsoKinds ?? []))
  const planned: PlannedDamage = {
    kinds: [...new Set(kindNames)],
    forms: applied.map(({kind, damage}) => `${kind}: ${damage.form}`),
    edits, ...joined(applied.map(({damage}) => damage)),
  }
  if (documents !== undefined) planned.documents = documents
  if (template !== undefined) planned.template = template
  if (style !== undefined) planned.style = style
  return planned
}

// Whether the edits of two kinds sit apart: something other than white space stands between them, and they are on
// different lines or at least 8 code points from each other. Two unrelated damages that touch are one damage of
// another kind, e.g. a missing comma right before a missing colon. And with nothing but white space between them, one
// can take away what the other is seen by, also across a line end: a comma that is missing at the end of a line
// leaves no trace when the entry on the next line is replaced by `# ...`.
function sitApart(scanned: Scan, left: readonly Edit[], right: readonly Edit[]) {
  const {codePoints} = scanned
  for (const first of left) {
    for (const second of right) {
      const [early, late] = first.at <= second.at ? [first, second] : [second, first]
      const between = codePoints.slice(early.at + early.remove, late.at)
      if (between.every(isWhitespace) || (between.length < 8 && !between.includes('\n'))) return false
    }
  }
  return true
}

const requestOf = (kind: KindDefinition): DocumentRequest => {
  const request: DocumentRequest = {maximumLength: kind.maximumLength ?? 512 - (kind.margin ?? 0)}
  if (kind.templates !== undefined) request.templates = kind.templates
  if (kind.layout !== undefined) request.layout = kind.layout
  return request
}
// The style of a kind's document: one of the kind's styles by weight, or any of the four default styles.
const styleOf = (random: Random, kind: KindDefinition): readonly Style[] | undefined => kind.styles === undefined ? undefined : [random.weighted(kind.styles)]

export function planOneKind(random: Random, name: string): Plan {
  const kind = kindNamed(name)
  const request = requestOf(kind)
  const style = styleOf(random, kind)
  if (style !== undefined) request.styles = style
  return {recipe: 'one kind', request, apply: (inner, scanned) => applySteps(inner, scanned, [{kind: name}])}
}

// The kinds that can share a text with an unrelated kind: those that change one place, and not those that rewrite the
// whole text or bring documents of their own.
const pairable = kinds.filter(kind => kind.weight > 0 && kind.family !== 'several documents'
  && !['backslashEscapedDocument', 'htmlEntities', 'quotedDocument', 'ansiColorCodes', 'headMissing', 'middleCutOut', 'tuple'].includes(kind.name))
const staysInAFile = ['trailingComma', 'missingComma', 'lineComment'] as const
const halfTyped = ['openStringAtLineEnd', 'keyWithoutColon', 'colonWithoutValue', 'partialLiteral', 'partialNumber', 'missingCloser'] as const

// Whether two unrelated kinds can be in one text: a kind of a hand-edited file does not come with a kind of a
// program's output, e.g. no marker line of a merge conflict in a log line. And the other side of a merge conflict is
// made from the document as it was, so a conflict only comes with kinds that change one place of a file, and not with
// one that writes every literal or every quote of the text in another way.
const localFamilies = ['half typed', 'slip', 'separator', 'bracket', 'comment']
function canShareAText(left: KindDefinition, right: KindDefinition) {
  if (left.name === right.name) return false
  if ((left.origin === 'file' && right.origin === 'output') || (left.origin === 'output' && right.origin === 'file')) return false
  if (left.name === 'conflictMarkers') return localFamilies.includes(right.family)
  if (right.name === 'conflictMarkers') return localFamilies.includes(left.family)
  return true
}

// Two or three unrelated kinds in one text. Nearly half are an older mistake that stayed in the file, e.g. a trailing
// comma, with a half-typed entry somewhere else.
function planSeveralKinds(random: Random): Plan {
  const draw = (others: readonly string[]) => {
    const allowed = pairable.filter(kind => others.every(other => canShareAText(kind, kindNamed(other))))
    return random.weighted(allowed.map(kind => [kind.name, kind.weight] as const))
  }
  const names: string[] = random.chance(0.45) ? random.shuffled([random.pick(staysInAFile), random.pick(halfTyped)]) : [draw([])]
  if (names.length === 1) names.push(draw(names))
  if (random.chance(0.15)) names.push(draw(names))
  // A text that is cut off has its other damage before the cut.
  const ordered = [...names.filter(name => name !== 'cutOff'), ...names.filter(name => name === 'cutOff')]
  const host = kindNamed(random.pick(ordered))
  const request = requestOf(host)
  request.maximumLength = Math.min(...ordered.map(name => requestOf(kindNamed(name)).maximumLength ?? 512)) - 40
  const style = styleOf(random, host)
  if (style !== undefined) request.styles = style
  return {
    recipe: 'several kinds', request,
    apply(inner, scanned) {
      // Each kind is applied alone first, to see that their edits sit apart.
      let current = scanned
      const parts: Damage[] = []
      for (const [index, name] of ordered.entries()) {
        const damage = kindNamed(name).apply(inner, current)
        if (damage === undefined) return undefined
        if (damage.documents !== undefined) {
          if (index > 0 || damage.documents.length !== 1) return undefined
          current = scan(damage.documents[0]!)
        }
        if (parts.some(part => !sitApart(current, part.edits, damage.edits))) return undefined
        parts.push(damage)
      }
      // A cut must come after every other edit, or it would remove them.
      const cut = ordered.indexOf('cutOff')
      if (cut !== -1) {
        const cutAt = Math.min(...parts[cut]!.edits.map(edit => edit.at))
        if (parts.some((part, index) => index !== cut && part.edits.some(edit => edit.at + edit.remove > cutAt - 8))) return undefined
      }
      const length = current.codePoints.length
      const edits = mergeEdits(parts.map(part => part.edits), length)
      if (edits === undefined) return undefined
      const kindNames = ordered.flatMap((name, index) => [name, ...(parts[index]!.alsoKinds ?? [])])
      const planned: PlannedDamage = {kinds: [...new Set(kindNames)], forms: parts.map((part, index) => `${ordered[index]!}: ${part.form}`), edits, ...joined(parts)}
      if (parts[0]!.documents !== undefined) planned.documents = parts[0]!.documents
      return planned
    },
  }
}

const configTemplates: readonly Template[] = ['settings', 'compilerConfig', 'launchConfig', 'serviceConfig', 'packageManifest']
const indentedStyle = (random: Random): Style[] => [random.chance(0.85) ? 'indented' : 'tabbed']
const maybe = (random: Random, probability: number, step: Step): Step[] => random.chance(probability) ? [{...step, required: false}] : []

// The texts of the comments among edits, one per comment, e.g. "dev only" for ` // dev only`.
function commentTexts(edits: readonly Edit[]) {
  const texts: string[] = []
  for (const edit of edits) {
    for (const line of edit.insert.split('\n')) {
      const found = /(?:\/\/|\/\*|^\s*\*(?!\/))\s*(.*?)\s*(?:\*\/)?$/.exec(line)
      if (found !== null && found[1] !== '') texts.push(found[1]!)
    }
  }
  return texts
}
// Whether the comments of a text can stand as they are: no comment twice, and at most one at the end of a line.
function commentsFit(edits: readonly Edit[]) {
  const texts = commentTexts(edits)
  if (new Set(texts).size !== texts.length) return false
  const atLineEnds = edits.filter(edit => edit.remove === 0 && /\/\/|\/\*/.test(edit.insert) && !edit.insert.endsWith('\n') && !edit.insert.endsWith(' ')).map(edit => edit.at)
  return new Set(atLineEnds).size === atLineEnds.length
}

// A sentence of a language model before or after the document, on lines of its own.
function modelSentence(random: Random, scanned: Scan, where: 'before' | 'after' | 'both'): Damage | undefined {
  const prose = kindNamed('proseAround').apply(random, scanned, {writer: 'model', scope: where})
  if (prose === undefined) return undefined
  // A sentence before a fence ends its own line, and has an empty line after it in most answers.
  return {...prose, edits: prose.edits.map(edit => edit.at === 0 ? {...edit, insert: `${edit.insert.trimEnd()}${random.chance(0.7) ? '\n\n' : '\n'}`} : edit)}
}

// One damage inside a document that a model wrote, drawn when the plan is made.
const damageInAnAnswer = (random: Random): Step => random.weighted<Step>([
  [{kind: 'lineComment', options: {scope: random.chance(0.5) ? 'end of a line' : 'own line'}}, 25], [{kind: 'ellipsis'}, 20],
  [{kind: 'trailingComma', options: {scope: random.chance(0.5) ? 'every container on several lines' : 'line end'}}, 20],
  [{kind: 'unescapedQuote'}, 10], [{kind: 'rawLineFeedInString'}, 10], [{kind: 'unescapedBackslash'}, 8], [{kind: 'nonFiniteNumber'}, 7],
])

type Recipe = {name: string, weight: number, plan: (random: Random) => Omit<Plan, 'recipe'>}

// Combinations with one cause. The shares inside each follow the surveys' tables of what comes together. What decides
// whether a sample is held out, e.g. a NaN in a Python print, is drawn when the plan is made and not per document, so
// that the tries of one sample agree on it, see sampleAt.
const recipes: readonly Recipe[] = [
  {
    // A config file in the style of tsconfig.json or settings.json: comments, and a comma after the last entry of every
    // container that spans several lines. One text in three is being edited as well.
    name: 'jsoncFile', weight: 6,
    plan: random => ({
      request: {templates: configTemplates, styles: indentedStyle(random), maximumLength: 300},
      apply(inner, scanned) {
        const commas = inner.chance(0.55)
        const comments = !commas || inner.chance(0.85)
        const steps: Step[] = []
        if (comments) steps.push({kind: 'lineComment', options: {scope: inner.weighted([['several', 40], ['own line', 22], ['member switched off', 14], ['first lines', 12], ['end of a line', 12]])}})
        steps.push(...maybe(inner, 0.25, {kind: 'blockComment'}))
        if (commas) steps.push({kind: 'trailingComma', options: {scope: inner.chance(0.6) ? 'every container on several lines' : 'line end'}})
        // The entry that is being typed is away from the comments and the trailing commas.
        steps.push(...maybe(inner, 0.33, {kind: inner.pick(halfTyped), apart: true}))
        const planned = applySteps(inner, scanned, steps)
        return planned !== undefined && commentsFit(planned.edits) ? planned : undefined
      },
    }),
  },
  {
    // A line moved to the end of its object, or the last line moved up: the line that is now second to last has no
    // comma, and the line that is now last has one.
    name: 'movedLine', weight: 1.6,
    plan: random => ({
      request: {styles: indentedStyle(random), maximumLength: 500},
      apply(inner, scanned) {
        const {codePoints} = scanned
        const objects = scanned.containers.filter(container => container.type === 'object' && container.severalLines && container.entries.length >= 2
          && hasOwnLine(codePoints, container.entries.at(-1)!) && hasOwnLine(codePoints, container.entries.at(-2)!))
        if (objects.length === 0) return undefined
        const container = inner.pick(objects)
        const secondToLast = container.entries.at(-2)!
        return {
          kinds: ['missingComma', 'trailingComma'],
          forms: ['missingComma: after the member that is now second to last', 'trailingComma: after the member that is now last'],
          edits: [removeRange(secondToLast.commaAfter, secondToLast.commaAfter + 1), insertAt(container.entries.at(-1)!.end, ',')],
          reachable: 'yes', needsRules: [], unscoredKinds: [], needsClass: [], debatable: false,
        }
      },
    }),
  },
  {
    // A JavaScript object literal from a source file: every key that is a word without quotes, and often single
    // quotes, a comma before every closer that starts a line, the assignment it came with, a comment, undefined.
    name: 'javascriptLiteral', weight: 5,
    plan: () => ({
      request: {styles: ['indented'], layout: {indent: '  ', shortOnOneLine: true, finalLineFeed: false, escapes: 'plain', leading: ''}, maximumLength: 400},
      apply(inner, scanned) {
        const planned = applySteps(inner, scanned, [
          {kind: 'unquotedKey', options: {scope: 'every'}},
          ...maybe(inner, 0.6, {kind: 'singleQuotedString', options: {scope: 'every but word keys'}}),
          ...maybe(inner, 0.55, {kind: 'trailingComma', options: {scope: 'every container on several lines'}}),
          ...maybe(inner, 0.35, {kind: 'statementWrapper', options: {scope: 'assignment'}}),
          ...maybe(inner, 0.2, {kind: 'lineComment', options: {scope: inner.chance(0.5) ? 'own line' : 'end of a line'}}),
          ...maybe(inner, 0.1, {kind: 'foreignLiteral', options: {scope: 'undefined'}}),
        ])
        return planned
      },
    }),
  },
  {
    // What Python prints for a dict: one line, single quotes on every string without an apostrophe, True, False and
    // None, and sometimes a tuple, nan, or a number as NumPy prints it.
    name: 'pythonPrint', weight: 5,
    plan: random => {
      const withNan = random.chance(0.1)
      // A dict that was logged, assigned, or cut at a length limit.
      const around = random.weighted<Step[]>([[[], 76], [[{kind: 'logPrefix', options: {scope: 'Python'}}], 10], [[{kind: 'statementWrapper', options: {scope: 'Python assignment'}, required: false}], 8], [[{kind: 'cutOff', required: false}], 6]])
      return {
        request: {styles: ['spaced'], layout: {escapes: 'plain', leading: ''}, maximumLength: 400, plainNumbers: true},
        apply(inner, scanned) {
          return applySteps(inner, scanned, [
            {kind: 'singleQuotedString', options: {scope: 'every'}},
            {kind: 'foreignLiteral', options: {scope: 'Python'}, required: false},
            ...maybe(inner, 0.15, {kind: 'tuple'}),
            ...(withNan ? [{kind: 'nonFiniteNumber', options: {scope: 'Python print'}}] : []),
            ...maybe(inner, 0.06, {kind: 'callWrapper', options: {scope: 'Python print'}}),
            ...around,
          ])
        },
      }
    },
  },
  {
    // What Node prints for an object: keys that are words without quotes, single quotes on the other strings, a space
    // inside the brackets, [Object] and [Array] for what is nested below the third level, and undefined.
    name: 'nodePrint', weight: 1.4,
    plan: random => {
      // Node prints an object on one line when the line stays short, about 72 characters, and one entry per line otherwise.
      const onOneLine = random.chance(0.5)
      return {
        request: {
          styles: [onOneLine ? 'padded' : 'indented'], maximumLength: onOneLine ? 76 : 400, plainNumbers: true,
          layout: {indent: '  ', shortOnOneLine: true, paddedShort: true, finalLineFeed: false, escapes: 'plain', leading: ''},
        },
        apply(inner, scanned) {
          return applySteps(inner, scanned, [
            {kind: 'ellipsis', options: {scope: 'Node depth'}, required: false},
            {kind: 'unquotedKey', options: {scope: 'every'}},
            {kind: 'singleQuotedString', options: {scope: 'every but word keys'}, required: false},
            ...maybe(inner, 0.15, {kind: 'foreignLiteral', options: {scope: 'undefined'}}),
          ])
        },
      }
    },
  },
  {
    // A JSON5 file: keys without quotes, trailing commas, comments, single quotes, a number in another form.
    name: 'json5File', weight: 0.6,
    plan: random => ({
      request: {templates: configTemplates, styles: indentedStyle(random), maximumLength: 380},
      apply(inner, scanned) {
        return applySteps(inner, scanned, [
          ...maybe(inner, 0.8, {kind: 'unquotedKey', options: {scope: 'every'}}),
          ...maybe(inner, 0.8, {kind: 'trailingComma', options: {scope: 'every container on several lines'}}),
          ...maybe(inner, 0.7, {kind: 'lineComment', options: {scope: inner.pick(['own line', 'first lines', 'end of a line'])}}),
          ...maybe(inner, 0.6, {kind: 'singleQuotedString', options: {scope: 'every but word keys'}}),
          ...maybe(inner, 0.15, {kind: 'numberFormat'}),
        ])
      },
    }),
  },
  {
    // Text copied from a web page or a word processor: typographic quotes everywhere, and no-break spaces in the indentation.
    name: 'webPageCopy', weight: 0.6,
    plan: () => ({
      request: {styles: ['indented'], layout: {indent: '  '}, maximumLength: 500},
      apply(inner, scanned) {
        return applySteps(inner, scanned, [
          {kind: 'curlyQuotes', options: {scope: 'every'}},
          {kind: 'nonBreakingSpace', options: {scope: inner.chance(0.6) ? 'indentation' : 'every second of the indentation'}},
        ])
      },
    }),
  },
  {
    // A document copied from the MongoDB shell: values as calls. The old shell writes a space before every colon. The
    // new one prints as Node does: keys without quotes, single quotes, and a short container on one line.
    name: 'mongoShell', weight: 0.8,
    plan: random => {
      const newShell = random.chance(0.5)
      const style: Style = random.chance(0.5) ? 'padded' : 'indented'
      return {
        request: {
          templates: ['databaseRecord'], styles: [style], maximumLength: 360, plainNumbers: true,
          layout: {indent: '  ', finalLineFeed: false, escapes: 'plain', leading: '', ...(newShell ? {shortOnOneLine: true, paddedShort: true} : {shortOnOneLine: false, spaceBeforeColon: true})},
        },
        apply(inner, scanned) {
          return applySteps(inner, scanned, [
            {kind: 'callWrapper', options: {scope: newShell ? 'new shell' : 'old shell'}},
            ...(newShell ? [{kind: 'unquotedKey', options: {scope: 'every'}}, {kind: 'singleQuotedString', options: {scope: 'every but word keys'}, required: false}] : []),
          ])
        },
      }
    },
  },
  {
    // Habits from HJSON or YAML: keys and values without quotes, no commas at line ends, # comments, yes and no.
    name: 'hjsonHabits', weight: 0.6,
    plan: random => ({
      request: {templates: configTemplates, styles: indentedStyle(random), layout: {shortOnOneLine: false}, maximumLength: 420},
      apply(inner, scanned) {
        const steps: Step[] = [
          ...maybe(inner, 0.8, {kind: 'unquotedKey', options: {scope: 'every'}}),
          ...maybe(inner, 0.7, {kind: 'unquotedValue', options: {scope: 'every'}}),
          ...maybe(inner, 0.5, {kind: 'hashComment'}),
          ...maybe(inner, 0.15, {kind: 'foreignLiteral', options: {scope: 'yes and no'}}),
        ]
        // A line feed in place of every comma at a line end.
        const lineEndCommas = scanned.entries.filter(entry => entry.commaAfter !== -1 && lastOnLine(scanned.codePoints, entry.commaAfter + 1))
        const withoutCommas = inner.chance(0.7) && lineEndCommas.length > 0
        const extra: Extra[] = withoutCommas ? [{kind: 'missingComma', damage: {edits: lineEndCommas.map(entry => removeRange(entry.commaAfter, entry.commaAfter + 1)), form: `every comma at a line end, ${lineEndCommas.length} of them`, reachable: 'yes'}}] : []
        if (steps.length + extra.length < 2) return undefined
        const planned = applySteps(inner, scanned, steps, extra)
        // Without the comma, only the line feed ends a value that has no quotes.
        if (planned !== undefined && planned.kinds.includes('unquotedValue') && planned.kinds.includes('missingComma')) planned.reachable = leastReachable([planned.reachable, 'line rule'])
        return planned
      },
    }),
  },
  {
    // An example in documentation: dots for what was left out, a note, a placeholder for a value.
    name: 'documentationExample', weight: 0.6,
    plan: random => ({
      request: {styles: indentedStyle(random), maximumLength: 380},
      apply(inner, scanned) {
        const steps: Step[] = [
          ...maybe(inner, 0.8, {kind: 'ellipsis'}),
          ...maybe(inner, 0.4, {kind: 'lineComment', options: {scope: 'end of a line'}}),
          ...maybe(inner, 0.3, {kind: 'templatePlaceholder'}),
        ]
        if (steps.length < 2) return undefined
        const planned = applySteps(inner, scanned, steps)
        return planned !== undefined && planned.kinds.length >= 2 ? planned : undefined
      },
    }),
  },
  {
    // The usual answer of a language model: a sentence, a code fence, the document, the fence, and maybe a sentence.
    name: 'modelAnswer', weight: 2.5,
    plan: random => ({
      request: {styles: [random.weighted([['indented', 85], ['spaced', 10], ['compact', 5]])], layout: {finalLineFeed: false, leading: ''}, maximumLength: 360},
      apply(inner, scanned) {
        const prose = modelSentence(inner, scanned, inner.weighted([['before', 50], ['both', 40], ['after', 10]]))
        const fence = kindNamed('codeFence').apply(inner, scanned, {scope: 'both'})
        if (prose === undefined || fence === undefined) return undefined
        // A sentence after the fence brings its own line feeds, so the fence line ends without one.
        const sentenceAfter = prose.edits.some(edit => edit.at > 0)
        const fenceEdits = fence.edits.map(edit => edit.at > 0 && sentenceAfter ? {...edit, insert: edit.insert.trimEnd()} : edit)
        const edits = mergeEdits([prose.edits, fenceEdits], scanned.codePoints.length)
        if (edits === undefined) return undefined
        return {kinds: ['proseAround', 'codeFence'], forms: [`proseAround: ${prose.form}`, `codeFence: ${fence.form}`], edits, ...joined([prose, fence])}
      },
    }),
  },
  {
    // A code fence around a document that has a damage of its own, which the parser meets after the fence.
    name: 'fencedAndDamaged', weight: 1.2,
    plan: random => {
      const inside = damageInAnAnswer(random)
      return {
        request: {styles: ['indented'], layout: {finalLineFeed: false, leading: ''}, maximumLength: 360},
        apply: (inner, scanned) => applySteps(inner, scanned, [{kind: 'codeFence', options: {scope: inner.chance(0.85) ? 'both' : 'opening'}}, inside]),
      }
    },
  },
  {
    // A model that reached its output limit: the opening fence, then a document that stops.
    name: 'fencedAndCutOff', weight: 1,
    plan: () => ({
      request: {styles: ['indented'], layout: {finalLineFeed: false, leading: ''}, maximumLength: 440},
      apply: (inner, scanned) => applySteps(inner, scanned, [{kind: 'codeFence', options: {scope: 'opening'}}, {kind: 'cutOff'}]),
    }),
  },
  {
    // A model's answer that went wrong after its sentence: the sentence, the opening fence, and then a document that
    // stops, since the model reached its output limit, or a document with a damage of its own and the closing fence.
    name: 'answerCutOrDamaged', weight: 0.8,
    plan: random => {
      const cut = random.chance(0.6)
      const inside = damageInAnAnswer(random)
      return {
        request: {styles: [random.weighted([['indented', 85], ['spaced', 10], ['compact', 5]])], layout: {finalLineFeed: false, leading: ''}, maximumLength: 330},
        apply(inner, scanned) {
          const sentence = modelSentence(inner, scanned, 'before')
          if (sentence === undefined) return undefined
          return applySteps(inner, scanned, [{kind: 'codeFence', options: {scope: cut ? 'opening' : 'both'}}, cut ? {kind: 'cutOff'} : inside], [{kind: 'proseAround', damage: sentence}])
        },
      }
    },
  },
  {
    // A template that escapes nothing, fed with text that a user typed: inner quotes, raw line feeds and tabs, and
    // single backslashes, in every string of the text that has them.
    name: 'nothingEscaped', weight: 0.8,
    plan: () => ({
      request: {maximumLength: 480},
      apply(inner, scanned) {
        const planned = applySteps(inner, scanned, [
          {kind: 'unescapedQuote', options: {scope: 'every'}, required: false},
          {kind: 'rawLineFeedInString', options: {scope: 'every'}, required: false},
          {kind: 'rawTabInString', options: {scope: 'every'}, required: false},
          {kind: 'unescapedBackslash', options: {scope: 'every'}, required: false},
        ])
        return planned !== undefined && planned.kinds.length >= 2 ? planned : undefined
      },
    }),
  },
  {
    // A file with one document per line in which a length limit cut one line short. The next line starts while the
    // containers of the cut line are still open.
    name: 'cutLineThenLines', weight: 0.8,
    plan: () => ({
      request: {maximumLength: 100},
      apply(inner, scanned) {
        const lines = kindNamed('newlineDelimited').apply(inner, scanned, {scope: 'no final line feed'})
        if (lines?.documents === undefined) return undefined
        const lengths = lines.documents.map(document => Array.from(document).length)
        const cutLine = inner.integer(0, lines.documents.length - 2)
        const start = lengths.slice(0, cutLine).reduce((total, length) => total + length, 0)
        const content = lines.documents[cutLine]!.trimEnd()
        const contentLength = Array.from(content).length
        if (contentLength < 4) return undefined
        const cut = inner.integer(1, contentLength - 1)
        // The rule that labels the lines after the cut one: an opening brace where the grammar cannot take it starts a
        // new document, at depth 0. Inside an array the brace reads as the next item, as after a missing comma, and a
        // line that is not an object has no such brace. A cut inside a string also needs that string to end at the line feed.
        const line = scan(content)
        const innermost = openContainersAt(line, cut).at(-1)
        const inString = line.strings.some(part => part.start < cut && cut < part.end)
        const flags: Pick<PlannedDamage, 'reachable' | 'needsRules'> = line.root.container?.type !== 'object' || innermost?.type !== 'object' ? {reachable: 'no', needsRules: []}
          : inString ? {reachable: 'line rule', needsRules: ['a string that is open at a line feed ends there']}
          : {reachable: 'yes', needsRules: []}
        return {
          kinds: ['newlineDelimited', 'cutOff'],
          forms: [`newlineDelimited: ${lines.form}`, `cutOff: line ${cutLine + 1} stops after ${cut} of its ${contentLength} code points${inString ? ', inside a string' : innermost?.type === 'array' ? ', inside an array' : ''}`],
          documents: lines.documents, edits: [removeRange(start + cut, start + contentLength)],
          ...flags, unscoredKinds: [], needsClass: [], debatable: true,
          ...(lines.template === undefined ? {} : {template: lines.template}), ...(lines.style === undefined ? {} : {style: lines.style}),
        }
      },
    }),
  },
  {
    // A log line in the logfmt notation with a document in one of its fields: the document is between quotes and has a
    // backslash before every quote of its own. In three texts of ten a length limit cut the line.
    name: 'escapedInLogLine', weight: 0.4,
    plan: random => ({
      request: {
        templates: ['logEvent', 'apiResponse', 'remoteCall', 'userRecord', 'databaseRecord', 'chatChunk', 'sensorReadings'], styles: [random.chance(0.6) ? 'compact' : 'spaced'],
        layout: {escapes: 'plain', leading: '', finalLineFeed: false}, maximumLength: 200,
      },
      apply(inner, scanned) {
        const escaped = kindNamed('backslashEscapedDocument').apply(inner, scanned)
        if (escaped === undefined) return undefined
        const length = scanned.codePoints.length
        const field = inner.pick(['msg', 'body', 'payload', 'response'])
        // The line's own time and level are those that the document states, when it states them.
        const stated = logFieldsIn(scanned.text)
        const two = (value: number) => String(value).padStart(2, '0')
        const moment = stated.time ?? {month: inner.integer(1, 12), day: inner.integer(1, 28), hour: inner.integer(0, 23), minute: inner.integer(0, 59), second: inner.integer(0, 59)}
        const time = `ts=2026-${two(moment.month)}-${two(moment.day)}T${two(moment.hour)}:${two(moment.minute)}:${two(moment.second)}Z `
        const prefix = `${inner.chance(0.5) ? time : ''}level=${stated.level?.toLowerCase() ?? inner.pick(['debug', 'info', 'info', 'warn', 'error'])} ${field}="`
        const cutAt = inner.chance(0.3) ? inner.integer(Math.ceil(length * 0.3), length - 1) : -1
        const edits: Edit[] = [{...insertAt(0, prefix), rank: -3}, ...escaped.edits.filter(edit => cutAt === -1 || edit.at < cutAt)]
        if (cutAt === -1) edits.push({...insertAt(length, `"${inner.chance(0.4) ? ` status=${inner.pick([200, 201, 400, 500])}` : ''}`), rank: 3})
        else edits.push(removeRange(cutAt, length))
        const merged = mergeEdits([edits], length)
        if (merged === undefined) return undefined
        return {
          kinds: ['logPrefix', 'quotedDocument', 'backslashEscapedDocument', ...(cutAt === -1 ? [] : ['cutOff'])],
          forms: [`logPrefix: a logfmt line, the document is the field ${field}`, 'quotedDocument: "…" around the document', `backslashEscapedDocument: ${escaped.form}`, ...(cutAt === -1 ? [] : [`cutOff: the line stops after ${cutAt} of the document's ${length} code points`])],
          edits: merged,
          // The quote before the document opens a string, and the escaped document is what a valid string holds.
          reachable: 'no', needsRules: [], unscoredKinds: [], needsClass: [], debatable: false,
        }
      },
    }),
  },
  {
    // A file with a byte order mark and one more damage.
    name: 'byteOrderMarkAndMore', weight: 0.4,
    plan: random => {
      const other = random.weighted(pairable.filter(kind => kind.name !== 'byteOrderMark').map(kind => [kind, kind.weight] as const))
      const request = requestOf(other)
      const style = styleOf(random, other)
      if (style !== undefined) request.styles = style
      request.maximumLength = (request.maximumLength ?? 512) - 1
      return {request, apply: (inner, scanned) => applySteps(inner, scanned, [{kind: other.name}, {kind: 'byteOrderMark'}])}
    },
  },
]

export const recipeNames: readonly string[] = recipes.map(recipe => recipe.name)

// How a broken text of the damage source gets its plan: one kind in six texts of ten, the rest split between
// unrelated kinds and combinations with one cause. A plan that replaces one that found no place in any document is
// drawn in the same of the three ways, so that the three shares hold.
export function drawPlan(random: Random, previous?: Plan): Plan {
  const way = previous === undefined ? random.weighted([['one kind', 60], ['several kinds', 14], ['combination', 26]] as const)
    : previous.recipe === 'one kind' || previous.recipe === 'several kinds' ? previous.recipe : 'combination'
  if (way === 'one kind') return planOneKind(random, random.weighted(kinds.map(kind => [kind.name, kind.weight] as const)))
  if (way === 'several kinds') return planSeveralKinds(random)
  const recipe = random.weighted(recipes.map(item => [item, item.weight] as const))
  return {recipe: recipe.name, ...recipe.plan(random)}
}

export type {Damage, KindDefinition, Reachable, Rule}
export {contradictions, families, type Family} from './damage/types.ts'
