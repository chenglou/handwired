// The kinds of damage, and the ways several of them come together in one text.
//
// A kind is a function from a random source and a valid text to edits, or to nothing when the text has no place for
// it. The kinds live in damage/, one file per family. This file lists them, and builds the plans that samples.ts
// carries out: one kind, two or three unrelated kinds, or a combination with one cause, e.g. a pasted JavaScript object
// literal, which has every key without quotes, every string in single quotes and a comma before every closer.
import {type DocumentRequest, type Style, type Template} from './documents.ts'
import {type Edit, insertAt, mergeEdits, removeRange} from './edits.ts'
import type {Random} from './random.ts'
import {type Scan, hasOwnLine, lastOnLine, scan} from './scan.ts'
import {bracketKinds} from './damage/brackets.ts'
import {commentKinds} from './damage/comments.ts'
import {cutKinds} from './damage/cuts.ts'
import {halfTypedKinds} from './damage/half-typed.ts'
import {notationKinds} from './damage/notations.ts'
import {separatorKinds} from './damage/separators.ts'
import {severalKinds} from './damage/several.ts'
import {stringKinds} from './damage/strings.ts'
import {type Damage, type KindDefinition, type KindOptions, type Reachable, leastReachable} from './damage/types.ts'
import {wrapperKinds} from './damage/wrappers.ts'

export const kinds: readonly KindDefinition[] = [
  ...halfTypedKinds, ...cutKinds, ...separatorKinds, ...bracketKinds, ...commentKinds, ...notationKinds, ...stringKinds, ...wrapperKinds, ...severalKinds,
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

// Applies kinds one after another to the same original and merges their edits. A step whose `required` is false is
// skipped when the text has no place for it. Only the first step may bring documents of its own, e.g. a document
// without the member that a comment switches off, and the later steps then work on that document.
type Step = {kind: string, options?: KindOptions, required?: boolean}
function applySteps(random: Random, scanned: Scan, steps: readonly Step[], extra: {kinds: string[], forms: string[], edits: Edit[]}[] = []): PlannedDamage | undefined {
  let current = scanned
  let documents: string[] | undefined
  let template: string | undefined
  let style: Style | undefined
  const applied: {kind: string, damage: Damage}[] = []
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
    applied.push({kind: step.kind, damage})
  }
  if (applied.length === 0 && extra.length === 0) return undefined
  const originalLength = documents === undefined ? scanned.codePoints.length : documents.reduce((total, document) => total + Array.from(document).length, 0)
  const edits = mergeEdits([...applied.map(({damage}) => damage.edits), ...extra.map(part => part.edits)], originalLength)
  if (edits === undefined) return undefined
  const kindNames: string[] = []
  for (const {kind, damage} of applied) kindNames.push(kind, ...(damage.alsoKinds ?? []))
  for (const part of extra) kindNames.push(...part.kinds)
  const planned: PlannedDamage = {
    kinds: [...new Set(kindNames)],
    forms: [...applied.map(({kind, damage}) => `${kind}: ${damage.form}`), ...extra.flatMap(part => part.forms)],
    edits,
    reachable: leastReachable(applied.map(({damage}) => damage.reachable)),
    unscoredKinds: [...new Set(applied.flatMap(({damage}) => damage.unscoredKinds ?? []))].sort((left, right) => left - right),
    needsClass: [...new Set(applied.flatMap(({damage}) => damage.needsClass === undefined ? [] : [damage.needsClass]))],
    debatable: applied.some(({damage}) => damage.debatable === true),
  }
  if (documents !== undefined) planned.documents = documents
  if (template !== undefined) planned.template = template
  if (style !== undefined) planned.style = style
  return planned
}

// Whether the edits of two kinds sit apart: on different lines, or at least 8 code points from each other. Two
// unrelated damages that touch are one damage of another kind, e.g. a missing comma right before a missing colon.
function sitApart(scanned: Scan, left: readonly Edit[], right: readonly Edit[]) {
  const {codePoints} = scanned
  for (const first of left) {
    for (const second of right) {
      const [early, late] = first.at <= second.at ? [first, second] : [second, first]
      const from = early.at + early.remove
      if (late.at - from < 8 && !codePoints.slice(from, late.at).includes('\n')) return false
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

// Two or three unrelated kinds in one text. Nearly half are an older mistake that stayed in the file, e.g. a trailing
// comma, with a half-typed entry somewhere else.
function planSeveralKinds(random: Random): Plan {
  const draw = () => random.weighted(pairable.map(kind => [kind.name, kind.weight] as const))
  const names = random.chance(0.45) ? random.shuffled([random.pick(staysInAFile), random.pick(halfTyped)]) : [draw(), draw()]
  if (random.chance(0.15)) names.push(draw())
  // A text that is cut off has its other damage before the cut.
  const ordered = [...names.filter(name => name !== 'cutOff'), ...names.filter(name => name === 'cutOff').slice(0, 1)]
  const host = kindNamed(random.pick(ordered))
  const request = requestOf(host)
  request.maximumLength = Math.min(...ordered.map(name => requestOf(kindNamed(name)).maximumLength ?? 512)) - 40
  const style = styleOf(random, host)
  if (style !== undefined) request.styles = style
  return {
    recipe: 'several kinds', request,
    apply(inner, scanned) {
      if (new Set(ordered).size !== ordered.length) return undefined
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
      const planned: PlannedDamage = {
        kinds: [...new Set(kindNames)], forms: parts.map((part, index) => `${ordered[index]!}: ${part.form}`), edits,
        reachable: leastReachable(parts.map(part => part.reachable)),
        unscoredKinds: [...new Set(parts.flatMap(part => part.unscoredKinds ?? []))].sort((left, right) => left - right),
        needsClass: [...new Set(parts.flatMap(part => part.needsClass === undefined ? [] : [part.needsClass]))],
        debatable: parts.some(part => part.debatable === true),
      }
      if (parts[0]!.documents !== undefined) planned.documents = parts[0]!.documents
      return planned
    },
  }
}

const configTemplates: readonly Template[] = ['settings', 'compilerConfig', 'launchConfig', 'serviceConfig', 'packageManifest']
const indentedStyle = (random: Random): Style[] => [random.chance(0.85) ? 'indented' : 'tabbed']
const maybe = (random: Random, probability: number, step: Step): Step[] => random.chance(probability) ? [{...step, required: false}] : []

type Recipe = {name: string, weight: number, plan: (random: Random) => Omit<Plan, 'recipe'>}

// Combinations with one cause. The shares inside each follow the surveys' tables of what comes together.
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
        steps.push(...maybe(inner, 0.33, {kind: inner.pick(halfTyped)}))
        return applySteps(inner, scanned, steps)
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
          reachable: 'yes', unscoredKinds: [], needsClass: [], debatable: false,
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
        return applySteps(inner, scanned, [
          {kind: 'unquotedKey', options: {scope: 'every'}},
          ...maybe(inner, 0.6, {kind: 'singleQuotedString', options: {scope: 'every but word keys'}}),
          ...maybe(inner, 0.55, {kind: 'trailingComma', options: {scope: 'every container on several lines'}}),
          ...maybe(inner, 0.35, {kind: 'statementWrapper', options: {scope: 'assignment'}}),
          ...maybe(inner, 0.2, {kind: 'lineComment', options: {scope: inner.chance(0.5) ? 'own line' : 'end of a line'}}),
          ...maybe(inner, 0.1, {kind: 'foreignLiteral', options: {scope: 'undefined'}}),
        ])
      },
    }),
  },
  {
    // What Python prints for a dict: one line, single quotes on every string without an apostrophe, True, False and
    // None, and sometimes a tuple, nan, or a number as NumPy prints it.
    name: 'pythonPrint', weight: 5,
    plan: () => ({
      request: {styles: ['spaced'], layout: {escapes: 'plain', leading: ''}, maximumLength: 400},
      apply(inner, scanned) {
        return applySteps(inner, scanned, [
          {kind: 'singleQuotedString', options: {scope: 'every'}},
          {kind: 'foreignLiteral', options: {scope: 'Python'}, required: false},
          ...maybe(inner, 0.15, {kind: 'tuple'}),
          ...maybe(inner, 0.1, {kind: 'nonFiniteNumber', options: {scope: 'Python print'}}),
          ...maybe(inner, 0.06, {kind: 'callWrapper', options: {scope: 'Python print'}}),
          // A dict that was logged, assigned, or cut at a length limit.
          ...inner.weighted<Step[]>([[[], 76], [[{kind: 'logPrefix', options: {scope: 'Python'}, required: false}], 10], [[{kind: 'statementWrapper', options: {scope: 'Python assignment'}, required: false}], 8], [[{kind: 'cutOff', required: false}], 6]]),
        ])
      },
    }),
  },
  {
    // What Node prints for an object: keys that are words without quotes, single quotes on the other strings, a space
    // inside the brackets, and undefined.
    name: 'nodePrint', weight: 1.4,
    plan: random => {
      // Node prints an object on one line when the line stays short, about 72 characters, and one entry per line otherwise.
      const onOneLine = random.chance(0.5)
      return {
        request: {styles: [onOneLine ? 'padded' : 'indented'], layout: {indent: '  ', shortOnOneLine: true, paddedShort: true, finalLineFeed: false, escapes: 'plain', leading: ''}, maximumLength: onOneLine ? 76 : 400},
        apply(inner, scanned) {
          return applySteps(inner, scanned, [
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
    // A document copied from the MongoDB shell: values as calls, and in the new shell also Node's quotes.
    name: 'mongoShell', weight: 0.8,
    plan: random => ({
      request: {templates: ['databaseRecord'], styles: [random.chance(0.5) ? 'padded' : 'indented'], layout: {indent: '  ', finalLineFeed: false, escapes: 'plain', leading: ''}, maximumLength: 360},
      apply(inner, scanned) {
        const newShell = inner.chance(0.5)
        return applySteps(inner, scanned, [
          {kind: 'callWrapper'},
          ...(newShell ? [{kind: 'unquotedKey', options: {scope: 'every'}}, {kind: 'singleQuotedString', options: {scope: 'every but word keys'}, required: false}] : []),
        ])
      },
    }),
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
        const extra = withoutCommas ? [{kinds: ['missingComma'], forms: [`missingComma: every comma at a line end, ${lineEndCommas.length} of them`], edits: lineEndCommas.map(entry => removeRange(entry.commaAfter, entry.commaAfter + 1))}] : []
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
        const prose = kindNamed('proseAround').apply(inner, scanned, {writer: 'model', scope: inner.weighted([['before', 50], ['both', 40], ['after', 10]])})
        const fence = kindNamed('codeFence').apply(inner, scanned, {scope: 'both'})
        if (prose === undefined || fence === undefined) return undefined
        // A sentence before a fence ends its own line, and has an empty line after it in most answers.
        const proseEdits = prose.edits.map(edit => edit.at === 0 ? {...edit, insert: `${edit.insert.trimEnd()}${inner.chance(0.7) ? '\n\n' : '\n'}`} : edit)
        // A sentence after the fence brings its own line feeds, so the fence line ends without one.
        const sentenceAfter = prose.edits.some(edit => edit.at > 0)
        const fenceEdits = fence.edits.map(edit => edit.at > 0 && sentenceAfter ? {...edit, insert: edit.insert.trimEnd()} : edit)
        const edits = mergeEdits([proseEdits, fenceEdits], scanned.codePoints.length)
        if (edits === undefined) return undefined
        return {
          kinds: ['proseAround', 'codeFence'], forms: [`proseAround: ${prose.form.replace(', on the document\'s first line', '')}`, `codeFence: ${fence.form}`], edits,
          // The sentence is on lines of its own here, whatever the kind drew, so a quote without its partner ends with the line.
          reachable: leastReachable([prose.reachable === 'no' ? 'line rule' : prose.reachable, fence.reachable]), unscoredKinds: [], needsClass: [], debatable: false,
        }
      },
    }),
  },
  {
    // A code fence around a document that has a damage of its own, which the parser meets after the fence.
    name: 'fencedAndDamaged', weight: 1.2,
    plan: () => ({
      request: {styles: ['indented'], layout: {finalLineFeed: false, leading: ''}, maximumLength: 360},
      apply(inner, scanned) {
        const inside = inner.weighted<Step>([
          [{kind: 'lineComment', options: {scope: inner.chance(0.5) ? 'end of a line' : 'own line'}}, 25], [{kind: 'ellipsis'}, 20],
          [{kind: 'trailingComma', options: {scope: inner.chance(0.5) ? 'every container on several lines' : 'line end'}}, 20],
          [{kind: 'unescapedQuote'}, 10], [{kind: 'rawLineFeedInString'}, 10], [{kind: 'unescapedBackslash'}, 8], [{kind: 'nonFiniteNumber'}, 7],
        ])
        return applySteps(inner, scanned, [{kind: 'codeFence', options: {scope: inner.chance(0.85) ? 'both' : 'opening'}}, inside])
      },
    }),
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
    // A template that escapes nothing, fed with text that a user typed: inner quotes, raw line feeds and tabs, and
    // single backslashes, in every string of the text that has them.
    name: 'nothingEscaped', weight: 0.8,
    plan: () => ({
      request: {templates: ['messages', 'logEvent', 'order', 'table', 'apiResponse'], maximumLength: 480},
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
        return {
          kinds: ['newlineDelimited', 'cutOff'],
          forms: [`newlineDelimited: ${lines.form}`, `cutOff: line ${cutLine + 1} stops after ${cut} of its ${contentLength} code points`],
          documents: lines.documents, edits: [removeRange(start + cut, start + contentLength)],
          // "An opening bracket right after a line feed starts a new document at depth 0" labels the lines after the cut one.
          reachable: 'line rule', unscoredKinds: [], needsClass: [], debatable: true,
          ...(lines.template === undefined ? {} : {template: lines.template}), ...(lines.style === undefined ? {} : {style: lines.style}),
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
// unrelated kinds and combinations with one cause.
export function drawPlan(random: Random): Plan {
  const way = random.weighted([['one kind', 60], ['several kinds', 14], ['combination', 26]] as const)
  if (way === 'one kind') return planOneKind(random, random.weighted(kinds.map(kind => [kind.name, kind.weight] as const)))
  if (way === 'several kinds') return planSeveralKinds(random)
  const recipe = random.weighted(recipes.map(item => [item, item.weight] as const))
  return {recipe: recipe.name, ...recipe.plan(random)}
}

export type {Damage, KindDefinition, Reachable}
export {families, type Family} from './damage/types.ts'
