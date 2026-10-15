// Damage inside strings and at their quotes: escapes that are missing or belong to another language, raw line feeds
// and tabs, a quote too few and a quote too many.
import {freeTextTemplates} from '../documents.ts'
import {type Edit, insertAt, removeRange, replaceOneForOne} from '../edits.ts'
import type {Random} from '../random.ts'
import {type Scan, type StringPart, hasOwnLine, indentationAt, lastOnLine} from '../scan.ts'
import type {Damage, KindDefinition, KindOptions, Reachable, Rule} from './types.ts'

const endsAtLineFeed: Rule = 'a string that is open at a line feed ends there'

// The escapes of a string's content: the position of each backslash and the character after it.
function escapesOf(scanned: Scan, part: StringPart) {
  const escapes: {at: number, character: string}[] = []
  for (let index = part.start + 1; index < part.end - 1; index++) {
    if (scanned.codePoints[index] !== '\\') continue
    const character = scanned.codePoints[index + 1]!
    escapes.push({at: index, character})
    index += character === 'u' ? 5 : 1
  }
  return escapes
}
// Free text, where quotes, line breaks and backslashes sit: a string value, and not a key.
const values = (scanned: Scan) => scanned.strings.filter(part => part.role === 'value')

// The quotes inside a string lost their backslashes: the text was put between quotes without escaping.
function unescapedQuote(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const quoted = values(scanned).map(part => ({part, quotes: escapesOf(scanned, part).filter(escape => escape.character === '"')})).filter(({quotes}) => quotes.length > 0)
  if (quoted.length === 0) return undefined
  // A program that forgets to escape forgets every quote of a string, and in four texts of ten those of every string.
  const changed = options.scope === 'every' || (quoted.length > 1 && random.chance(0.4)) ? quoted : [random.pick(quoted)]
  const quotes = changed.flatMap(({quotes: found}) => found)
  // The inner quote ends the string, and nothing at that point says that it shouldn't. One case reads right all the
  // same: an item of an array with two inner quotes around one word, e.g. ["call "Ana" back"], is a string, a word and
  // a string, each shown as a string. As a member's value, the second string would read as the next key, by the rule
  // that recovers a missing comma.
  const readsAsStrings = changed.every(({part, quotes: found}) => part.entry !== null && part.entry.key === null && found.length === 2
    && /^[^\s,:{}[\]"\\]+$/.test(scanned.codePoints.slice(found[0]!.at + 2, found[1]!.at).join('')))
  return {
    edits: quotes.map(quote => removeRange(quote.at, quote.at + 1)),
    // The quote that stays is part of an escape in the original, which no reading of the broken text shows.
    unscoredKinds: quotes.map(quote => quote.at + 1),
    form: `${quotes.length} quote${quotes.length > 1 ? 's' : ''} in ${changed.length === 1 ? 'one string' : `${changed.length} strings`}${readsAsStrings ? ', around one word in an item of an array' : ''}`,
    reachable: readsAsStrings ? 'yes' : 'no',
  }
}

// What a string's last backslash does to a parser when it escapes the closing quote: the string runs on, and in an
// indented text it can still end at the line feed.
function beforeClosingQuote(scanned: Scan, part: StringPart): {reachable: Reachable, unscored: number[]} {
  const {codePoints} = scanned
  const comma = codePoints[part.end] === ',' ? [part.end] : []
  const endsLine = lastOnLine(codePoints, part.end + comma.length)
  // The closing quote reads as an escape, and a comma after it as the string's content.
  return {reachable: endsLine ? 'line rule' : 'no', unscored: [part.end - 1, ...comma]}
}

function unescapedBackslash(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const {codePoints} = scanned
  const all = values(scanned).map(part => ({part, escapes: escapesOf(scanned, part)}))
  // Strings with a doubled backslash, e.g. a Windows path or a regular expression.
  const doubled = all.filter(({escapes}) => escapes.some(escape => escape.character === '\\'))
  const withApostrophe = values(scanned).filter(part => part.content.includes('\''))
  // Strings with an escape of a code point below U+0100, e.g. \u00e9, which other languages write as \xe9.
  const withLowEscape = all.filter(({escapes}) => escapes.some(escape => escape.character === 'u' && codePoints[escape.at + 2] === '0' && codePoints[escape.at + 3] === '0'))
  // A program that escapes nothing writes every string's backslashes once.
  const everyString = options.scope === 'every'
  const form = everyString ? 'halved' : random.weighted([['halved', doubled.length > 0 ? 62 : 0], ['escaped apostrophe', withApostrophe.length > 0 ? 25 : 0], ['hexadecimal escape', withLowEscape.length > 0 ? 13 : 0]] as const)
  if (form === 'halved' && doubled.length > 0) {
    // Every \\ of the string is written as one backslash. What the backslash that stays does depends on what follows it.
    const changed = everyString ? doubled : [random.pick(doubled)]
    const edits: Edit[] = []
    const unscoredKinds: number[] = []
    let reachable: Reachable = 'yes'
    let closesNothing = false
    for (const {part, escapes} of changed) for (const escape of escapes) {
      if (escape.character !== '\\') continue
      edits.push(removeRange(escape.at, escape.at + 1))
      const after = escape.at + 2
      const follower = codePoints[after]!
      if (after === part.end - 1) {
        const closing = beforeClosingQuote(scanned, part)
        if (reachable === 'yes' || closing.reachable === 'no') reachable = closing.reachable
        unscoredKinds.push(...closing.unscored)
        closesNothing = true
      } else if ('bfnrt/"'.includes(follower)) {
        // The pair reads as a real escape, e.g. the \t of C:\temp, so the letter's display kind is not scored.
        unscoredKinds.push(after)
      } else if (follower === 'u') {
        // \u and the hexadecimal digits after it read as the start of a unicode escape, e.g. the \u of C:\users.
        unscoredKinds.push(after)
        for (let digit = after + 1; digit <= after + 4 && /[0-9a-fA-F]/.test(codePoints[digit] ?? ''); digit++) unscoredKinds.push(digit)
      }
    }
    return {
      edits, unscoredKinds, form: `every \\\\ of ${changed.length === 1 ? 'one string' : `${changed.length} strings`} as one backslash${closesNothing ? ', the last one before the closing quote' : ''}`, reachable,
      ...(reachable === 'line rule' ? {needsRules: [endsAtLineFeed]} : {}),
    }
  }
  if (everyString) return undefined
  if (form === 'escaped apostrophe' && withApostrophe.length > 0) {
    const part = random.pick(withApostrophe)
    const edits: Edit[] = []
    for (let index = part.start + 1; index < part.end - 1; index++) if (codePoints[index] === '\'') edits.push(insertAt(index, '\\'))
    return {edits, form: 'a backslash before every apostrophe of one string', reachable: 'yes'}
  }
  if (withLowEscape.length === 0) return undefined
  const {escapes} = random.pick(withLowEscape)
  const edits: Edit[] = []
  for (const escape of escapes) {
    if (escape.character !== 'u' || codePoints[escape.at + 2] !== '0' || codePoints[escape.at + 3] !== '0') continue
    edits.push(replaceOneForOne(escape.at + 1, 'x'), removeRange(escape.at + 2, escape.at + 4))
  }
  // After a backslash, x must go on to two digits where another letter must not, e.g. the W of C:\Windows, and both
  // are in the class of most letters.
  return {edits, form: `\\x and two digits for ${edits.length / 2} \\u00 escape${edits.length > 2 ? 's' : ''} of one string`, reachable: 'yes', needsClass: 'x after a backslash'}
}

// A string holds real line feeds: text of several lines pasted as a value, or a long string wrapped with Enter.
function rawLineFeedInString(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const {codePoints} = scanned
  const withLineFeed = values(scanned).map(part => ({part, escapes: escapesOf(scanned, part)})).filter(({escapes}) => escapes.some(escape => escape.character === 'n'))
  const long = values(scanned).filter(part => part.end - part.start > 42 && part.entry !== null && hasOwnLine(codePoints, part.entry))
  const pasted = withLineFeed.length > 0 && (options.scope === 'every' || long.length === 0 || random.chance(0.7))
  if (pasted) {
    const changed = options.scope === 'every' || (withLineFeed.length > 1 && random.chance(0.4)) ? withLineFeed : [random.pick(withLineFeed)]
    // In half of the texts, the tabs of those strings are raw too. A combination that asks for every string leaves the
    // tabs to rawTabInString, which then takes those of every string.
    const alsoTabs = options.scope !== 'every' && random.chance(0.5)
    const edits: Edit[] = []
    // A text that came from Windows has \r\n in its strings, e.g. "Dear {name},\r\n\r\nThank you.", and its carriage
    // returns are raw too. The form text counts them apart from the line feeds.
    let carriageReturns = 0
    let tabs = 0
    for (const {escapes} of changed) {
      for (const escape of escapes) {
        if (escape.character === 'n') edits.push({at: escape.at, remove: 2, insert: '\n'})
        else if (escape.character === 'r') {
          edits.push({at: escape.at, remove: 2, insert: '\r'})
          carriageReturns++
        } else if (escape.character === 't' && alsoTabs) {
          edits.push({at: escape.at, remove: 2, insert: '\t'})
          tabs++
        }
      }
    }
    const lineFeeds = edits.length - carriageReturns - tabs
    const counted = (count: number, what: string) => count === 0 ? [] : [`${count} raw ${what}${count > 1 ? 's' : ''}`]
    const raw = [...counted(lineFeeds, 'line feed'), ...counted(carriageReturns, 'carriage return'), ...counted(tabs, 'tab')]
    return {
      edits, reachable: 'yes', needsRules: ['a line feed inside a string is content'], ...(tabs > 0 ? {alsoKinds: ['rawTabInString']} : {}),
      // E.g. "2 raw line feeds and 2 raw carriage returns", or "1 raw line feed, 1 raw carriage return and 2 raw tabs".
      form: `${raw.length === 3 ? `${raw[0]}, ${raw[1]} and ${raw[2]}` : raw.join(' and ')} for the escapes of ${changed.length === 1 ? 'one string' : `${changed.length} strings`}`,
    }
  }
  if (long.length === 0) return undefined
  const part = random.pick(long)
  const spaces: number[] = []
  for (let index = part.start + 12; index < part.end - 12; index++) if (codePoints[index] === ' ' && codePoints[index - 1] !== '\\') spaces.push(index)
  if (spaces.length === 0) return undefined
  const indentation = indentationAt(codePoints, part.start)
  const level = indentation.includes('\t') ? '\t' : '  '
  return {edits: [{at: random.pick(spaces), remove: 1, insert: `\n${indentation}${level}`}], form: 'a long string wrapped with a line feed and an indentation in place of a space', reachable: 'yes', needsRules: ['a line feed inside a string is content'], debatable: true}
}

function rawTabInString(random: Random, scanned: Scan, options: KindOptions = {}): Damage | undefined {
  const withTab = values(scanned).map(part => escapesOf(scanned, part).filter(escape => escape.character === 't')).filter(tabs => tabs.length > 0)
  if (withTab.length === 0) return undefined
  const changed = options.scope === 'every' ? withTab : [random.pick(withTab)]
  const tabs = changed.flat()
  return {
    edits: tabs.map(escape => ({at: escape.at, remove: 2, insert: '\t'})), reachable: 'yes',
    form: `${tabs.length} raw tab${tabs.length > 1 ? 's' : ''} for the \\t of ${changed.length === 1 ? 'one string' : `${changed.length} strings`}`,
  }
}

function missingOpeningQuote(random: Random, scanned: Scan): Damage | undefined {
  const keys = scanned.strings.filter(part => part.role === 'key' && part.content !== '')
  const stringValues = scanned.strings.filter(part => part.role === 'value' && part.entry !== null && part.content !== '')
  const ofKey = keys.length > 0 && (stringValues.length === 0 || random.chance(0.3))
  if (!ofKey && stringValues.length === 0) return undefined
  const part = random.pick(ofKey ? keys : stringValues)
  // What is left runs on to the closing quote, unless it holds a character that ends it early. A key must be one
  // word. A value may be several words with spaces between them, e.g. 362 Rua das Flores", as a value without quotes
  // of several words runs on to its comma, see unquotedValue. A colon inside a value ends nothing either.
  const breaks = ofKey ? /[\s",:{}[\]\\]/ : /[\n\t",{}[\]\\]|^ | $/
  const readable = !breaks.test(part.content)
  return {
    edits: [removeRange(part.start, part.start + 1)],
    form: `of a ${ofKey ? 'key' : 'value'}${readable ? '' : ', whose content holds a character that ends a word'}`,
    reachable: readable ? 'yes' : 'no',
  }
}

function doubledQuote(random: Random, scanned: Scan): Damage | undefined {
  const {codePoints} = scanned
  const filled = scanned.strings.filter(part => part.content !== '')
  if (filled.length === 0) return undefined
  const part = random.pick(filled)
  if (random.chance(0.7)) return {edits: [insertAt(part.end, '"')], form: `after the closing quote of a ${part.role}`, reachable: 'yes'}
  // Before the opening quote: the two quotes read as an empty string, and the content after them must open it again.
  const first = codePoints[part.start + 1]!
  return {edits: [insertAt(part.start, '"')], form: `before the opening quote of a ${part.role}`, reachable: ' \t,:}]\\'.includes(first) ? 'no' : 'yes'}
}

export const stringKinds: KindDefinition[] = [
  {
    name: 'unescapedQuote', family: 'inside a string', origin: 'either', weight: 1.9,
    example: '{"note": "call "Ana" on arrival", "paid": true}',
    reachable: 'no: the inner quote ends the string, and nothing at that point says that it shouldn\'t. yes for an item of an array with two inner quotes around one word, which reads as a string, a word and a string. The inner quotes\' display kind is not scored',
    templates: freeTextTemplates,
    apply: unescapedQuote,
  },
  {
    name: 'unescapedBackslash', family: 'inside a string', origin: 'either', weight: 2.4,
    example: '{"terminal.shell": "C:\\Windows\\System32\\cmd.exe"}',
    reachable: 'yes: after a backslash and a character that JSON doesn\'t escape, the string goes on. A backslash before the closing quote is line rule when the string ends its line, otherwise no. The form \\xe9 needs a class for x',
    templates: [...freeTextTemplates, 'settings', 'serviceConfig', 'tree'],
    margin: 12,
    apply: unescapedBackslash,
  },
  {
    name: 'rawLineFeedInString', family: 'inside a string', origin: 'either', weight: 1.2,
    example: '{"msg": "line 1⏎line 2", "code": 0}',
    reachable: 'yes with the rule that a line feed inside a string is content, which contradicts the rule for a half-typed string',
    templates: freeTextTemplates,
    margin: 12,
    apply: rawLineFeedInString,
  },
  {
    name: 'rawTabInString', family: 'inside a string', origin: 'either', weight: 0.4,
    example: '{"notes": "fragile→handle with care"}',
    reachable: 'yes: a tab inside a string reads as content',
    templates: freeTextTemplates,
    apply: rawTabInString,
  },
  {
    name: 'missingOpeningQuote', family: 'inside a string', origin: 'file', weight: 0.3,
    example: '{⏎  "city": Lisbon",⏎  "country": "PT"⏎}',
    reachable: 'yes when the closing quote ends what is left: a key that is one word, or a value of one word or of several words with spaces between them, e.g. 362 Rua das Flores", which runs on to the quote as a value without quotes runs on to its comma. no when the content holds a character that ends it before the closing quote: a comma, a bracket, a quote, a backslash, a tab or a line feed, a space at either end, and in a key any space or a colon. The leading characters of a value that read as a number or a literal, e.g. the 2.0 of 2.0", are shown as one by every parser, so their display kind is not scored. A key that starts so, e.g. name", needs a display fix where a key without quotes does',
    apply: missingOpeningQuote,
  },
  {
    name: 'doubledQuote', family: 'inside a string', origin: 'file', weight: 0.3,
    example: '{⏎  "city": "Lisbon"",⏎  "country": "PT"⏎}',
    reachable: 'yes for a parser that knows that it stands right after a closing quote: a second quote there is skipped, and content there opens the string again. The highlighter\'s tokenizer is in the same state after a closing quote as between any two tokens, so its tables read the second quote as the start of a string, unless a cell that valid JSON never reads has led them into states of their own before',
    margin: 2,
    apply: doubledQuote,
  },
]
