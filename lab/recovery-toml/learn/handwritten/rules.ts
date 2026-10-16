// A recovering TOML parser written by hand, as choices of open cells: the counterpart of the 35 rules of
// lab/recovery-parser/learn/handwritten/rules.ts, and the row that trained tables are held against. See README.md.
//
// Each rule below has a name, the reason a person would give for it, an example, and the cells it names. A rule names
// only what the recipe's training may fill, see engine.ts: open tokenizer cells, open grammar cells that the recipe
// does not keep, and open display entries outside the grammar state `error`. No state is added. Eight character
// classes are added, chosen by hand, where the recipe adds the classes that its rule counts out of the train samples.
//
// The rules were written from TOML's grammar, from broken texts of my own, and from reading and counting samples of
// the train splits of the two sets of sets.ts. No script picked a cell's choice, but scores were in view the whole
// time: variants of a rule were compared by their train scores, and the validation scores were printed by report.ts.
// README.md says which choices the counts and the scores made.
//
// Run from the repo root to print the rules with their cells and to save the tables with their sha256:
//   bun lab/recovery-toml/learn/handwritten/rules.ts [--scratch <folder>]
// The tables go to <folder>/tables.json. Without --scratch, the folder is the environment variable RECOVERY_SCRATCH,
// and without either nothing is saved.
import {mkdirSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {optionOf, refuseUnknownOptions} from '../options.ts'
import {type AddedClass, classNames, eventNames, grammarStateNames, lexerStateNames, saveTables, tokenNames} from '../recovery-tables.ts'
import {
  type ActionName, type CellSetter, type DisplayKindName, type EventName, type GrammarStateName, type Handwritten, type LexerStateName, type Rule, type TodaysClassName, type TokenName, arrayContexts, baseWith, containerContexts,
  describeRules, firstOnLine, inlineTableContexts, isArrayContext, tablesOfRules, topContext,
} from './engine.ts'
import {scratchFolderOf} from './sets.ts'

// The classes that are added by hand, each taken out of the class `other`, the class of every code point that only
// strings and comments hold, but for the escape character, which is a control character.
export const handChosenClasses = [
  // Starts a comment in INI files and ends a statement in many languages.
  {name: 'semicolon', codePoints: [0x3b]},
  // Two of them start a comment in many languages, and /* does in some.
  {name: 'slash', codePoints: [0x2f]},
  // Starts a comment of HTML, <!--.
  {name: 'lessThan', codePoints: [0x3c]},
  // The brackets of a tuple of Python.
  {name: 'openParenthesis', codePoints: [0x28]},
  {name: 'closeParenthesis', codePoints: [0x29]},
  // The backtick and the typographic quotes “ ” „ « » ‘ ’.
  {name: 'foreignQuote', codePoints: [0x60, 0x201c, 0x201d, 0x201e, 0xab, 0xbb, 0x2018, 0x2019]},
  // The no-break space, the byte order mark and the zero-width space.
  {name: 'invisible', codePoints: [0xa0, 0xfeff, 0x200b]},
  // The escape character, which starts a color code of a terminal.
  {name: 'escapeCharacter', codePoints: [0x1b]},
] as const satisfies readonly AddedClass[]
type ClassName = TodaysClassName | typeof handChosenClasses[number]['name']
type Setter = CellSetter<ClassName>
export type HandwrittenRule = Rule<ClassName>

// Every class but the two of a text's end, whose cells no rule sets: they are read after the text, where nothing is
// shown.
const classesOfText: readonly ClassName[] = [...classNames.filter(name => name !== 'end' && name !== 'truncatedEnd'), ...handChosenClasses.map(added => added.name)]
const digitClasses: readonly ClassName[] = ['zero', 'one', 'digit2To7', 'digit8Or9']
const letterClasses: readonly ClassName[] = ['a', 'b', 'e', 'f', 'i', 'l', 'n', 'o', 'r', 's', 't', 'u', 'x', 'z', 'otherHexLetter', 'capitalE', 'capitalT', 'capitalU', 'capitalZ', 'otherLetter']
// The characters of a key without quotes.
const keyClasses: readonly ClassName[] = [...digitClasses, ...letterClasses, 'underscore', 'minus']

// The tokenizer's events of an error. Today each of them is shown as an error and leads the grammar into its state
// `error`. With the rules, the tokenizer gives none of them but `unexpectedCharacter`, which then means "a character
// that starts nothing".
const errorEvents: readonly EventName[] = ['unexpectedCharacter', 'controlCharacterInString', 'controlCharacterInComment', 'bareCarriageReturn', 'badEscape', 'badUnicodeEscape', 'badValue', 'errorContinuation']

// Tokenizer states, by what the tokenizer is inside of.
const basicStringStates: readonly LexerStateName[] = ['basicOpen', 'basic']
const literalStringStates: readonly LexerStateName[] = ['literalOpen', 'literal']
const basicHexStates: readonly LexerStateName[] = ['basicHex8', 'basicHex7', 'basicHex6', 'basicHex5', 'basicHex4', 'basicHex3', 'basicHex2', 'basicHex1']
const multiBasicHexStates: readonly LexerStateName[] = ['multiBasicHex8', 'multiBasicHex7', 'multiBasicHex6', 'multiBasicHex5', 'multiBasicHex4', 'multiBasicHex3', 'multiBasicHex2', 'multiBasicHex1']
const multiBasicStates: readonly LexerStateName[] = ['multiBasic', 'multiBasicQuote1', 'multiBasicQuote2']
const multiLiteralStates: readonly LexerStateName[] = ['multiLiteral', 'multiLiteralQuote1', 'multiLiteralQuote2']
// The states inside a string or a comment, where a character is content unless a rule says otherwise.
const insideStates: readonly LexerStateName[] = [
  'comment', ...basicStringStates, 'basicEscape', ...basicHexStates, ...multiBasicStates, 'multiBasicCarriageReturn', 'multiBasicEscape', 'multiBasicEscapeSpaces', ...multiBasicHexStates,
  ...literalStringStates, ...multiLiteralStates, 'multiLiteralCarriageReturn', 'errorLine',
]
// Every other state: between tokens, or inside a word without quotes, i.e. a key, a number, a date or a literal.
const outsideStates: readonly LexerStateName[] = lexerStateNames.filter(state => !insideStates.includes(state))
// The states of a word that holds a character that no key holds, e.g. the colon of 07:32, so it can only be a value.
const valueOnlyWordStates: readonly LexerStateName[] = [
  'hourColon', 'minute1', 'minute2', 'minuteColon', 'second1', 'second2', 'secondDot', 'secondFraction', 'offsetSign', 'offsetHour1', 'offsetHour2', 'offsetColon', 'offsetMinute1',
  'localHourColon', 'localMinute1', 'localMinute2', 'localMinuteColon', 'localSecond1', 'localSecond2', 'localSecondDot', 'localSecondFraction',
]

// Four tokenizer states get a second meaning through their open cells. No state is added: a text that reaches one of
// them the old way is read by the new meaning too.
//
// - `errorLine` is the state inside a string between foreign quotes, e.g. “web”. Today it follows a tokenizer error
//   and skips to the line feed. Each of its cells is open, and with the rules no tokenizer error leads into it.
// - `afterCloseBracket`, the state right after a `]`, is also the state right after a slash or a `<`. Its frozen cells
//   read white space, a comma, a closing bracket and a # as between tokens, and its open cells do too, but for a
//   slash and a character without a class of its own, which start a comment there: //, /* and <!.
// - `afterOpenBracket`, the state right after a `[`, is also the state right after a colon. Its cells read
//   everything as between tokens, but for a slash, which starts nothing there: the slashes of https:// are no comment.
// - `multiBasicEscapeSpaces`, the state after a backslash and white space in a string of several lines, is also the
//   state inside a color code of a terminal. Its frozen cells are white space and the line ends.
const foreignString: LexerStateName = 'errorLine'
const afterSlash: LexerStateName = 'afterCloseBracket'
const afterColon: LexerStateName = 'afterOpenBracket'
const terminalCode: LexerStateName = 'multiBasicEscapeSpaces'

// Sets a tokenizer cell when no earlier rule named it and it is open, and says that the rule relies on the cell
// when it holds the choice already.
function lexerWhereFree(set: Setter, state: LexerStateName, characterClass: ClassName, next: LexerStateName, event: EventName) {
  if (!set.lexerIsFree(state, characterClass)) return
  const today = set.lexerChoice(state, characterClass)
  if (today.next === next && today.event === event) set.lexerAsToday(state, characterClass, next, event)
  else set.lexer(state, characterClass, next, event)
}
// The same for a grammar cell and for a display entry.
function grammarWhereFree(set: Setter, state: GrammarStateName, token: TokenName, context: number, next: GrammarStateName, action: ActionName) {
  if (!set.grammarIsFree(state, token, context)) return
  const today = set.grammarChoice(state, token, context)
  if (today.next === next && today.action === action) set.grammarAsToday(state, token, context, next, action)
  else set.grammar(state, token, context, next, action)
}

function displayWhereFree(set: Setter, event: EventName, grammarStateAfter: GrammarStateName, kind: DisplayKindName) {
  if (!set.displayIsFree(event, grammarStateAfter)) return
  if (set.displayChoice(event, grammarStateAfter) === kind) set.displayAsToday(event, grammarStateAfter, kind)
  else set.display(event, grammarStateAfter, kind)
}

// Grammar states and tokens, by what they mean.
const headerStates: readonly GrammarStateName[] = ['headerOpen', 'afterHeaderKey', 'afterHeaderDot', 'arrayHeaderOpen', 'afterArrayHeaderKey', 'afterArrayHeaderDot', 'arrayHeaderClose']
// The states that valid TOML only reaches at the top level.
const topLevelStates: readonly GrammarStateName[] = ['lineStart', ...headerStates, 'afterHeader']
const statesButError: readonly GrammarStateName[] = grammarStateNames.filter(state => state !== 'error')
const closingTokens: readonly TokenName[] = ['closeBracket', 'adjacentCloseBracket', 'closeBracketAfterKey', 'closeBrace']
const closingBracketTokens: readonly TokenName[] = ['closeBracket', 'adjacentCloseBracket', 'closeBracketAfterKey']
// The tokens that start a key, and those that start a value that is no container.
const keyStartTokens: readonly TokenName[] = ['string', 'keyOrValue', 'keyOnly']
const valueStartTokens: readonly TokenName[] = ['string', 'keyOrValue', 'valueOnly']
const topContexts = [topContext, firstOnLine(topContext)] as const
const everyContext = Array.from({length: 16}, (_, context) => context)
const depthOneOrMore = everyContext.filter(context => context % 8 >= 2)
const eitherPlace = (contexts: readonly number[]) => [...contexts, ...contexts.map(firstOnLine)]
const depthClassOf = (context: number) => (context % 8) >> 1

// Grammar states get a second meaning too, in the contexts in which valid TOML never has them. No state is added.
//
// - `arrayHeaderClose`, the state after the first `]` of `]]`, only comes at the top level today, and only for one
//   code point. Inside a container it means "a closing bracket of the other kind closed a container, and the container
//   around it still has to close": the next token closes it. At the top level it also means "inside a line that is a
//   comment": a line end starts the next line, and everything else is skipped and shown as a comment.
// - `headerOpen` and `arrayHeaderOpen` only come at the top level today. Inside an array of depth 1, `headerOpen`
//   means "right after an opening bracket that came after a key: an array, or a header", and `arrayHeaderOpen` "inside
//   a word after that bracket that may be a value or the name of a header".
// - `keyOrClose`, the state after the `{` of an inline table, only comes inside a container today. At the top level
//   it means "after a comma": a string or a number is the next value of a list without brackets, and a word is the
//   key of the next entry on the same line.
// - The states of the top level, e.g. `lineStart`, mean inside a container "the container lost its closing bracket":
//   every code point closes one container, see the rule `a state of the top level inside a container`.
const owesClose: GrammarStateName = 'arrayHeaderClose'
const commentLine: GrammarStateName = 'arrayHeaderClose'
const maybeHeader: GrammarStateName = 'headerOpen'
const maybeHeaderWord: GrammarStateName = 'arrayHeaderOpen'
const afterTopComma: GrammarStateName = 'keyOrClose'

export const rules: readonly HandwrittenRule[] = [
  // ---- The tokenizer ----
  {
    name: 'a line end ends a token',
    reason: 'A string of one line, a number or a literal that is still open at the end of its line ends there: the line feed, or the carriage return before it, is read as the end of the line. A string of several lines keeps its line ends.',
    example: 'name = "tiny-router⏎version = "6.9.17"',
    cells: set => {
      for (const state of lexerStateNames) {
        // Inside a string of several lines a line end is content, by frozen cells. After a carriage return the rule
        // `a carriage return alone` reads.
        if (state === 'carriageReturn' || state === 'multiBasicCarriageReturn' || state === 'multiLiteralCarriageReturn') continue
        lexerWhereFree(set, state, 'lineFeed', 'between', 'newline')
        lexerWhereFree(set, state, 'carriageReturn', 'carriageReturn', 'newline')
      }
    },
  },
  {
    name: 'a color code of a terminal',
    reason: 'An escape character starts a color code of a terminal, e.g. ␛[34m: the opening bracket, the digits and the semicolons after it are skipped like white space, up to and including the letter that ends the code.',
    example: '␛[34mport␛[0m = 8443',
    cells: set => {
      for (const state of outsideStates) lexerWhereFree(set, state, 'escapeCharacter', terminalCode, 'whitespace')
      for (const characterClass of ['openBracket', ...digitClasses, 'semicolon', 'escapeCharacter'] as const) set.lexer(terminalCode, characterClass, terminalCode, 'whitespace')
      for (const characterClass of letterClasses) set.lexer(terminalCode, characterClass, 'between', 'whitespace')
    },
  },
  {
    name: 'a character that does not show',
    reason: 'A no-break space, a byte order mark, a zero-width space and a control character between tokens are skipped like white space.',
    example: '◊[server]⏎port⍽= 8443',
    cells: set => {
      for (const state of outsideStates) {
        for (const characterClass of ['invisible', 'control'] as const) lexerWhereFree(set, state, characterClass, 'between', 'whitespace')
      }
    },
  },
  {
    name: 'a string between foreign quotes',
    reason: 'A backtick or a typographic quote where a token may start begins a string, which runs to the next such quote or to the end of the line.',
    example: 'title = “Tide Docs”⏎run = `cargo test`',
    cells: set => {
      for (const state of outsideStates) lexerWhereFree(set, state, 'foreignQuote', foreignString, 'stringStart')
      set.lexer(foreignString, 'foreignQuote', 'between', 'stringEnd')
      for (const characterClass of classesOfText) lexerWhereFree(set, foreignString, characterClass, foreignString, 'stringContent')
    },
  },
  {
    name: 'a semicolon',
    reason: 'A semicolon is read as a comma: it stands between two values of a list or between two entries, or it ends a line as in JavaScript. At the start of a line it starts a comment, as in INI files, see the rule `a line that starts with a comma`.',
    example: 'sizes = [1; 2; 3]⏎name = "tiny"; port = 8443;',
    cells: set => {
      for (const state of outsideStates) lexerWhereFree(set, state, 'semicolon', 'between', 'comma')
    },
  },
  {
    name: 'a number and a colon',
    reason: 'A colon right after a number of one, three or more digits is read as the colon after two digits is, which a cell that valid TOML reads takes for the colon of a time: the grammar stays where it is. So after the number of a line and a colon, the line is read as after a key, where a colon after a word stands for the equals sign.',
    example: '1: [server]⏎2: port = 8443',
    cells: set => {
      for (const state of ['zero', 'digits1', 'digits3', 'digits4', 'integer'] as const) set.lexer(state, 'colon', 'localHourColon', 'becomesValue')
    },
  },
  {
    name: 'a comment of another language',
    reason: 'Two slashes in a row, /* and <! start a comment that runs to the end of the line. Right after a colon a slash starts nothing, so that the slashes of https:// are no comment.',
    example: 'port = 8443 // default⏎/* optional */⏎<!-- per core -->',
    cells: set => {
      for (const state of outsideStates) {
        if (state === afterColon) set.lexer(state, 'slash', afterColon, 'unexpectedCharacter')
        else if (state !== afterSlash) lexerWhereFree(set, state, 'slash', afterSlash, 'unexpectedCharacter')
        lexerWhereFree(set, state, 'lessThan', afterSlash, 'unexpectedCharacter')
      }
      set.lexer(afterSlash, 'slash', 'comment', 'commentStart')
      set.lexer(afterSlash, 'other', 'comment', 'commentStart')
    },
  },
  {
    name: 'parentheses',
    reason: 'A parenthesis is read as a square bracket, as Python writes a tuple.',
    example: 'ports = (80, 443)',
    cells: set => {
      for (const state of outsideStates) {
        lexerWhereFree(set, state, 'openParenthesis', 'between', 'openBracket')
        lexerWhereFree(set, state, 'closeParenthesis', 'between', 'closeBracket')
      }
    },
  },
  {
    name: 'a character of another script in a key',
    reason: 'Inside a word that can only be a key, a character without a class of its own goes on with the word, e.g. a letter with an accent.',
    example: 'café = "open"⏎name = tiny-routér',
    cells: set => set.lexer('bareKey', 'other', 'bareKey', 'keyContent'),
  },
  {
    name: 'a quote right after a word',
    reason: 'A quote or an apostrophe right after a word, a number or a closing bracket starts a string of one line, and never one of several lines: three quotes there are the end of a string of several lines whose start is lost, and read as the start of one they would take the rest of the text.',
    example: '$git_branch\\⏎$cmd_duration"""⏎add_newline = true',
    cells: set => {
      for (const state of outsideStates) {
        if (set.lexerIsFree(state, 'quote') && set.lexerChoice(state, 'quote').next === 'basicOpen') set.lexer(state, 'quote', 'basic', 'stringStart')
        if (set.lexerIsFree(state, 'apostrophe') && set.lexerChoice(state, 'apostrophe').next === 'literalOpen') set.lexer(state, 'apostrophe', 'literal', 'stringStart')
      }
    },
  },
  {
    name: 'a character that starts nothing',
    reason: 'Any other character that starts no token is one character of its own, e.g. a colon, a backslash or a $: the tokenizer goes on after it as between tokens, where today it gives up the rest of the line. The grammar reads it by where it stands, e.g. as the equals sign after a key. After a colon the tokenizer is in the state in which a slash starts no comment.',
    example: 'port: 8443⏎home = ${HOME}',
    cells: set => {
      for (const state of outsideStates) {
        lexerWhereFree(set, state, 'colon', afterColon, 'unexpectedCharacter')
        for (const characterClass of ['backslash', 'other'] as const) lexerWhereFree(set, state, characterClass, 'between', 'unexpectedCharacter')
      }
    },
  },
  {
    name: 'a string goes on',
    reason: 'Inside a string or a comment, a control character is content. After a backslash and a character that TOML does not escape, the string goes on: the backslash was meant as a backslash. A character that is no hex digit ends a \\u escape and is read as the string reads it.',
    example: 'path = "C:\\Users\\ada"',
    cells: set => {
      const contentOf: readonly (readonly [states: readonly LexerStateName[], content: LexerStateName, event: EventName])[] = [
        [['comment'], 'comment', 'commentContent'],
        [[...basicStringStates, 'basicEscape'], 'basic', 'stringContent'],
        [[...multiBasicStates, 'multiBasicEscape'], 'multiBasic', 'stringContent'],
        [literalStringStates, 'literal', 'stringContent'],
        [multiLiteralStates, 'multiLiteral', 'stringContent'],
      ]
      for (const [states, content, event] of contentOf) {
        for (const state of states) for (const characterClass of classesOfText) lexerWhereFree(set, state, characterClass, content, event)
      }
      // Inside a \u escape, a character that is no hex digit is read as the string reads it, e.g. a quote ends the
      // string. The same after a backslash and white space in a string of several lines, where the rule for a color
      // code has some cells.
      for (const [states, content] of [[basicHexStates, 'basic'], [[...multiBasicHexStates, terminalCode], 'multiBasic']] as const) {
        for (const state of states) {
          for (const characterClass of classesOfText) {
            const inString = set.lexerChoice(content, characterClass)
            lexerWhereFree(set, state, characterClass, inString.next, inString.event)
          }
        }
      }
    },
  },
  {
    name: 'a word that breaks off',
    reason: 'A number, a date or a literal that is not complete ends at a character that cannot go on with it, e.g. the comma of `tru,`, and that character is read as between tokens. In a word that can only be a value, e.g. after 07:3, a letter goes on with the word.',
    example: 'enabled = tru⏎since = 2024-01-⏎at = 07:3x',
    fallback: 1,
    cells: set => {
      for (const state of outsideStates) {
        // After a carriage return the rule `a carriage return alone` reads.
        if (state === 'carriageReturn') continue
        for (const characterClass of classesOfText) {
          if (!set.lexerIsFree(state, characterClass) || !errorEvents.includes(set.lexerChoice(state, characterClass).event)) continue
          if (valueOnlyWordStates.includes(state) && keyClasses.includes(characterClass)) {
            set.lexer(state, characterClass, 'bareKey', 'becomesKey')
            continue
          }
          const between = set.lexerChoice('between', characterClass)
          lexerWhereFree(set, state, characterClass, between.next, between.event)
        }
      }
    },
  },
  {
    name: 'a carriage return alone',
    reason: 'A carriage return that no line feed follows ends its line by itself: the character after it is read as the first of the next line. Inside a string of several lines it is content.',
    example: '[server]↵port = 8443↵',
    fallback: 1,
    cells: set => {
      for (const characterClass of classesOfText) {
        for (const [state, like] of [['carriageReturn', 'between'], ['multiBasicCarriageReturn', 'multiBasic'], ['multiLiteralCarriageReturn', 'multiLiteral']] as const) {
          const choice = set.lexerChoice(like, characterClass)
          lexerWhereFree(set, state, characterClass, choice.next, choice.event)
        }
      }
    },
  },
  {
    name: 'a token ends where the next one starts',
    reason: 'Right after a word, a number, a closing bracket or the closing quotes of a string, a character that starts a token is read as between tokens. Today\'s tables hold this in every such open cell already, e.g. for the comma of `name,`, and the rules rely on it.',
    example: 'point = { x = 1, y}',
    fallback: 2,
    cells: set => {
      for (const state of outsideStates) {
        for (const characterClass of classesOfText) {
          const between = set.lexerChoice('between', characterClass)
          const today = set.lexerChoice(state, characterClass)
          if (set.lexerIsFree(state, characterClass) && today.next === between.next && today.event === between.event) set.lexerAsToday(state, characterClass, between.next, between.event)
        }
      }
    },
  },

  // ---- The grammar ----
  {
    name: 'a sign in the place of the equals sign',
    reason: 'After a key, a character that starts nothing stands for the equals sign, e.g. the colon of YAML and JSON: the value comes next. Where a value should start, such a character starts a value without quotes, and an equals sign changes nothing.',
    example: 'port: 8443⏎name := "tiny"⏎point = { "x": 1 }⏎home = $HOME',
    cells: set => {
      for (const context of everyContext) {
        grammarWhereFree(set, 'afterKey', 'lexerError', context, 'value', 'none')
        grammarWhereFree(set, 'value', 'lexerError', context, 'afterValue', 'none')
        grammarWhereFree(set, 'value', 'equals', context, 'value', 'none')
        // A [ right after a colon is the token of a second [, since the two share a tokenizer state.
        if (depthClassOf(context) < 3) grammarWhereFree(set, 'value', 'adjacentOpenBracket', context, 'valueOrClose', 'push array')
      }
      set.display('unexpectedCharacter', 'value', 'punctuation')
      set.display('unexpectedCharacter', 'afterValue', 'string')
    },
  },
  {
    name: 'an equals sign without a key',
    reason: 'An equals sign at the start of a line or after the dot of a key is followed by the value: the key is missing.',
    example: '= "ltr"⏎server. = 1',
    cells: set => {
      for (const context of topContexts) for (const state of ['lineStart', 'key'] as const) grammarWhereFree(set, state, 'equals', context, 'value', 'none')
    },
  },
  {
    name: 'a bracket after a key',
    reason: 'An opening bracket after a key at the top level opens an array, whose equals sign is missing, or it starts a header after the number of a line. So the bracket opens an array, and the token after it says which it is: a word that can only be a key is the name of a header, and the array closes again. A word that starts like a number or a literal is a value until a character shows that it is a name.',
    example: 'tree [⏎  "shuttered",⏎]⏎ 12 [server]⏎ 13 [tool.black]',
    cells: set => {
      const inArray = 2
      set.grammar('afterKey', 'openBracket', topContext, maybeHeader, 'push array')
      for (const token of tokenNames) {
        if (token === 'end') continue
        const asArray = set.grammarChoice('valueOrClose', token, inArray)
        const afterValue = set.grammarChoice('afterValue', token, inArray)
        if (token === 'none') {
          grammarWhereFree(set, maybeHeader, token, inArray, maybeHeader, 'none')
          grammarWhereFree(set, maybeHeaderWord, token, inArray, maybeHeaderWord, 'none')
        } else {
          if (token === 'keyOnly') grammarWhereFree(set, maybeHeader, token, inArray, 'afterHeaderKey', 'pop')
          else if (token === 'keyOrValue') grammarWhereFree(set, maybeHeader, token, inArray, maybeHeaderWord, 'none')
          else if (asArray.next !== 'error') grammarWhereFree(set, maybeHeader, token, inArray, asArray.next, asArray.action)
          if (token === 'notValue') grammarWhereFree(set, maybeHeaderWord, token, inArray, 'afterHeaderKey', 'pop')
          else if (afterValue.next !== 'error') grammarWhereFree(set, maybeHeaderWord, token, inArray, afterValue.next, afterValue.action)
        }
      }
      displayWhereFree(set, 'numberStart', maybeHeaderWord, 'number')
      displayWhereFree(set, 'literalStart', maybeHeaderWord, 'literal')
      displayWhereFree(set, 'numberContent', maybeHeaderWord, 'number')
      displayWhereFree(set, 'literalContent', maybeHeaderWord, 'literal')
    },
  },
  {
    name: 'a value without an equals sign',
    reason: 'A string, a number or a literal right after a key is that key\'s value. A word that can only be a key goes on with the key, and an opening brace opens an inline table.',
    example: 'workers 32⏎host "127.0.0.1"⏎request limit = 30⏎server {',
    cells: set => {
      for (const context of [topContext, ...inlineTableContexts]) {
        for (const token of valueStartTokens) grammarWhereFree(set, 'afterKey', token, context, 'afterValue', 'none')
        grammarWhereFree(set, 'afterKey', 'keyOnly', context, 'afterKey', 'none')
        if (depthClassOf(context) < 3) {
          grammarWhereFree(set, 'afterKey', 'openBrace', context, 'keyOrClose', 'push inline table')
          grammarWhereFree(set, 'afterKey', 'openBracket', context, 'valueOrClose', 'push array')
        }
      }
    },
  },
  {
    name: 'a word where a value should stand',
    reason: 'A word without quotes after an equals sign is a string without its quotes, and is shown as one, with its dots. After a complete value at the top level, more words, numbers and strings go on with the value, and an equals sign says that the value comes only now.',
    example: 'name = tiny-router⏎title = Tide Docs⏎version = 6.9.17',
    cells: set => {
      for (const context of [topContext, ...containerContexts]) {
        grammarWhereFree(set, 'value', 'keyOnly', context, 'afterValue', 'none')
        grammarWhereFree(set, 'afterValue', 'notValue', context, 'afterValue', 'none')
      }
      for (const token of [...keyStartTokens, 'valueOnly', 'dot'] as const) grammarWhereFree(set, 'afterValue', token, topContext, 'afterValue', 'none')
      grammarWhereFree(set, 'afterValue', 'equals', topContext, 'value', 'none')
      for (const event of ['keyStart', 'keyContent', 'becomesKey', 'dot'] as const) set.display(event, 'afterValue', 'string')
    },
  },
  {
    name: 'a list without brackets',
    reason: 'At the top level, after a comma that follows a value or a key, a string or a number is the next value of a list whose brackets are missing, or whose first line is. A word there is the key of the next entry on the same line. At the start of the next line a string is still the next value, and anything else is read as a line of its own.',
    example: 'tags = "web", "prod"⏎name = "tiny", port = 8443',
    cells: set => {
      for (const state of ['afterKey', 'afterValue'] as const) grammarWhereFree(set, state, 'comma', topContext, afterTopComma, 'none')
      for (const token of valueStartTokens) grammarWhereFree(set, afterTopComma, token, topContext, 'afterValue', 'none')
      grammarWhereFree(set, afterTopComma, 'lexerError', topContext, 'afterValue', 'none')
      grammarWhereFree(set, afterTopComma, 'keyOnly', topContext, 'afterKey', 'none')
      grammarWhereFree(set, afterTopComma, 'equals', topContext, 'value', 'none')
      grammarWhereFree(set, afterTopComma, 'openBracket', topContext, 'valueOrClose', 'push array')
      grammarWhereFree(set, afterTopComma, 'openBrace', topContext, 'keyOrClose', 'push inline table')
      // The next line, as after an equals sign without a value.
      grammarWhereFree(set, afterTopComma, 'newline', topContext, afterTopComma, 'none')
      grammarWhereFree(set, afterTopComma, 'newline', firstOnLine(topContext), 'lineStart', 'none')
      grammarWhereFree(set, afterTopComma, 'string', firstOnLine(topContext), 'afterValue', 'none')
      grammarWhereFree(set, afterTopComma, 'keyOrValue', firstOnLine(topContext), 'afterKey', 'none')
      grammarWhereFree(set, afterTopComma, 'keyOnly', firstOnLine(topContext), 'afterKey', 'none')
      grammarWhereFree(set, afterTopComma, 'openBracket', firstOnLine(topContext), 'headerOpen', 'none')
      grammarWhereFree(set, afterTopComma, 'comment', firstOnLine(topContext), 'lineStart', 'none')
    },
  },
  {
    name: 'a line end after an equals sign',
    reason: 'After an equals sign without a value, the next line is read as a line of its own, but a string or an opening bracket at its start is the value: it was put on the next line. An empty line ends the wait.',
    example: 'host =⏎port = 8443⏎description =⏎  "Something quiet"',
    cells: set => {
      grammarWhereFree(set, 'value', 'newline', topContext, 'value', 'none')
      grammarWhereFree(set, 'value', 'newline', firstOnLine(topContext), 'lineStart', 'none')
      grammarWhereFree(set, 'value', 'string', firstOnLine(topContext), 'afterValue', 'none')
      grammarWhereFree(set, 'value', 'keyOrValue', firstOnLine(topContext), 'afterKey', 'none')
      grammarWhereFree(set, 'value', 'keyOnly', firstOnLine(topContext), 'afterKey', 'none')
      grammarWhereFree(set, 'value', 'comment', firstOnLine(topContext), 'lineStart', 'none')
    },
  },
  {
    name: 'a header in another form',
    reason: 'Inside a header, a character that starts nothing stands for the dot between two parts of the name, and a word or a string after a part is the next part. An equals sign inside a header starts a value: the header lost its end. A second opening bracket after a space still starts the header of an array of tables. After a header, a key starts an entry on the same line, and a bracket opens nothing.',
    example: '[server:tls]⏎[remote "origin"]⏎[ [rule] ]⏎[tls] enabled = true⏎[welcome] {',
    cells: set => {
      for (const [afterKey, afterDot, closed] of [['afterHeaderKey', 'afterHeaderDot', 'afterHeader'], ['afterArrayHeaderKey', 'afterArrayHeaderDot', 'arrayHeaderClose']] as const) {
        grammarWhereFree(set, afterKey, 'lexerError', topContext, afterDot, 'none')
        for (const token of keyStartTokens) grammarWhereFree(set, afterKey, token, topContext, afterKey, 'none')
        grammarWhereFree(set, afterKey, 'equals', topContext, 'value', 'none')
        for (const token of closingBracketTokens) grammarWhereFree(set, afterDot, token, topContext, closed, 'none')
      }
      for (const token of closingBracketTokens) grammarWhereFree(set, 'headerOpen', token, topContext, 'afterHeader', 'none')
      grammarWhereFree(set, 'headerOpen', 'openBracket', topContext, 'arrayHeaderOpen', 'none')
      for (const token of keyStartTokens) grammarWhereFree(set, 'afterHeader', token, topContext, 'afterKey', 'none')
      for (const token of ['openBracket', 'adjacentOpenBracket', 'openBrace'] as const) grammarWhereFree(set, 'afterHeader', token, topContext, 'afterHeader', 'none')
      set.display('unexpectedCharacter', 'afterHeaderDot', 'punctuation')
      set.display('unexpectedCharacter', 'afterArrayHeaderDot', 'punctuation')
    },
  },
  {
    name: 'a line that starts with a comma',
    reason: 'A semicolon at the start of a line starts a comment, as in INI files, and the tokenizer reads a semicolon as a comma. So after a comma at the start of a line at the top level, the rest of the line is skipped and shown as a comment.',
    example: '; optional⏎workers = 32',
    cells: set => {
      for (const context of topContexts) grammarWhereFree(set, 'lineStart', 'comma', context, commentLine, 'none')
      for (const token of tokenNames) {
        if (token !== 'end' && token !== 'newline') grammarWhereFree(set, commentLine, token, topContext, commentLine, 'none')
      }
      for (const event of eventNames) {
        if (event !== 'newline' && event !== 'closeBrace') displayWhereFree(set, event, commentLine, 'comment')
      }
    },
  },
  {
    name: 'a mark before a line',
    reason: 'After a + at the start of a line, the line is read as it would be without it: a word that starts with a sign is a key. After the number of a line and a dot, an opening bracket starts a header, and the colon after the number of a line is shown as punctuation. An opening brace at the start of a line opens nothing, e.g. the tag of a template.',
    example: '+port = 8443⏎12: port = 8443⏎3. [server]⏎{% if production %}',
    cells: set => {
      for (const context of topContexts) {
        grammarWhereFree(set, 'lineStart', 'notValue', context, 'afterKey', 'none')
        grammarWhereFree(set, 'lineStart', 'openBrace', context, 'lineStart', 'none')
      }
      grammarWhereFree(set, 'key', 'openBracket', topContext, 'headerOpen', 'none')
      set.display('becomesValue', 'afterKey', 'punctuation')
      set.display('numberContent', 'lineStart', 'key')
    },
  },
  {
    name: 'an entry inside an array',
    reason: 'An array holds no keys. So an equals sign inside an array, and a word at the start of a line after a complete value, say that the array lost its closing bracket: the array closes there, and the entry is read.',
    example: 'ports = [80, 443⏎name = "a"',
    cells: set => {
      for (const context of arrayContexts) {
        for (const token of ['keyOnly', 'keyOrValue'] as const) grammarWhereFree(set, 'afterValue', token, firstOnLine(context), 'afterKey', 'pop')
        for (const state of ['valueOrClose', 'afterValue', 'afterKey'] as const) grammarWhereFree(set, state, 'equals', context, 'value', 'pop')
      }
    },
  },
  {
    name: 'a header inside a container',
    reason: 'An opening bracket at the start of a line, after a value inside an array or anywhere inside an inline table, starts a header: the container lost its closing bracket and closes there. After a comma inside an array the bracket opens an array, by a cell that valid TOML reads, and then a word without quotes right inside that array says that it is a header.',
    example: 'point = { x = 1, y = 2⏎[server]⏎members = [⏎  "core",⏎[workspace.dependencies]',
    cells: set => {
      for (const context of containerContexts) {
        for (const state of ['afterValue', 'afterKey', 'key', 'value', 'keyOrClose'] as const) grammarWhereFree(set, state, 'openBracket', firstOnLine(context), 'headerOpen', 'pop')
      }
      const nestedArray = 4
      grammarWhereFree(set, 'valueOrClose', 'keyOnly', nestedArray, 'afterHeaderKey', 'pop')
      grammarWhereFree(set, 'afterValue', 'notValue', nestedArray, 'afterHeaderKey', 'pop')
    },
  },
  {
    name: 'a missing comma',
    reason: 'After a complete value inside an array, the start of a value is the next value, and a word without quotes is a string without its quotes. Inside an inline table, a word that can only be a key after a complete value is the next key. A string or a number there goes on with the value, by the rule `anything else changes nothing`: a key in quotes is rare.',
    example: 'ports = [80 443]⏎tags = [web, prod]⏎point = { x = 1 y = 2 }',
    cells: set => {
      for (const context of arrayContexts) {
        for (const token of [...valueStartTokens, 'keyOnly'] as const) grammarWhereFree(set, 'afterValue', token, context, 'afterValue', 'none')
        for (const token of ['string', 'valueOnly'] as const) grammarWhereFree(set, 'afterValue', token, firstOnLine(context), 'afterValue', 'none')
        for (const place of eitherPlace([context])) grammarWhereFree(set, 'valueOrClose', 'keyOnly', place, 'afterValue', 'none')
        grammarWhereFree(set, 'afterValue', 'closeBracketAfterKey', context, 'afterValue', 'pop')
        if (depthClassOf(context) < 3) {
          grammarWhereFree(set, 'afterValue', 'openBracket', context, 'valueOrClose', 'push array')
          for (const place of eitherPlace([context])) grammarWhereFree(set, 'afterValue', 'openBrace', place, 'keyOrClose', 'push inline table')
        }
      }
      for (const context of inlineTableContexts) {
        grammarWhereFree(set, 'afterValue', 'keyOnly', context, 'afterKey', 'none')
      }
    },
  },
  {
    name: 'a comma too many',
    reason: 'A comma where a value or a key should start changes nothing, and a closing brace right after a comma closes the inline table.',
    example: 'ports = [80,, 443]⏎point = { x = 1, y = 2, }',
    cells: set => {
      for (const context of arrayContexts) grammarWhereFree(set, 'valueOrClose', 'comma', context, 'valueOrClose', 'none')
      for (const context of inlineTableContexts) {
        grammarWhereFree(set, 'key', 'comma', context, 'key', 'none')
        grammarWhereFree(set, 'keyOrClose', 'comma', context, 'key', 'none')
        grammarWhereFree(set, 'key', 'closeBrace', context, 'afterValue', 'pop')
      }
    },
  },
  {
    name: 'an entry of an inline table without its value',
    reason: 'Inside an inline table, a comma right after an equals sign or after a key goes on with the next key, and a closing brace there closes the table.',
    example: 'point = { x = , y = 2 }',
    cells: set => {
      for (const context of inlineTableContexts) {
        for (const state of ['value', 'afterKey'] as const) {
          grammarWhereFree(set, state, 'comma', context, 'key', 'none')
          grammarWhereFree(set, state, 'closeBrace', context, 'afterValue', 'pop')
        }
      }
    },
  },
  {
    name: 'a line end inside an inline table',
    reason: 'Inside an inline table a line end after the opening brace, after a comma, after a key and after an equals sign is white space, as JSON writes an object on several lines. A line end after a complete value closes the table: its closing brace is missing, or it stands on the next line, where it then closes nothing.',
    example: 'serde = {⏎  version = "1",⏎  features = ["derive"]⏎}⏎point = { x = 1, y = 2⏎name = "a"',
    cells: set => {
      for (const context of eitherPlace(inlineTableContexts)) {
        for (const state of ['keyOrClose', 'afterKey', 'key', 'value'] as const) grammarWhereFree(set, state, 'newline', context, state, 'none')
        grammarWhereFree(set, 'afterValue', 'newline', context, depthClassOf(context) === 1 ? 'lineStart' : 'afterValue', 'pop')
      }
      // The closing brace on the next line of a table that the line end closed inside an array.
      for (const context of arrayContexts) grammarWhereFree(set, 'afterValue', 'closeBrace', firstOnLine(context), 'afterValue', 'none')
    },
  },
  {
    name: 'a closing bracket of the other kind',
    reason: 'A closing bracket of the other kind closes the innermost container, and so does a closing bracket where the grammar expects something else. Inside a nested container the bracket is taken for the one of the container around: that one still has to close, and the next token closes it.',
    example: 'ports = [80, 443}⏎point = { x = 1, y = 2 ]⏎serde = { features = ["derive" }',
    cells: set => {
      for (const context of containerContexts) {
        const nested = depthClassOf(context) >= 2
        for (const state of ['afterKey', 'key', 'value', 'valueOrClose', 'afterValue', 'keyOrClose'] as const) {
          for (const token of closingTokens) {
            const otherKind = (token === 'closeBrace') === isArrayContext(context)
            grammarWhereFree(set, state, token, context, nested && otherKind ? owesClose : 'afterValue', 'pop')
          }
        }
      }
      for (const context of depthOneOrMore) {
        for (const token of tokenNames) {
          if (token !== 'end') grammarWhereFree(set, owesClose, token, context, token === 'newline' ? 'lineStart' : 'afterValue', 'pop')
        }
      }
    },
  },
  {
    name: 'a key state inside an array',
    reason: 'After an array closed at an equals sign, the container around it may be an array too. There the states of an entry read as they read at the top level: a value follows an equals sign, and a line end closes one more array and starts the next line.',
    example: 'matrix = [[1, 2⏎name = "a"',
    cells: set => {
      for (const context of arrayContexts) {
        for (const token of [...valueStartTokens, 'keyOnly'] as const) grammarWhereFree(set, 'value', token, context, 'afterValue', 'none')
        if (depthClassOf(context) < 3) {
          grammarWhereFree(set, 'value', 'openBracket', context, 'valueOrClose', 'push array')
          grammarWhereFree(set, 'value', 'openBrace', context, 'keyOrClose', 'push inline table')
        }
        for (const state of ['afterKey', 'key', 'value'] as const) grammarWhereFree(set, state, 'newline', context, 'lineStart', 'pop')
        grammarWhereFree(set, 'afterKey', 'dot', context, 'key', 'none')
        grammarWhereFree(set, 'afterKey', 'numberDot', context, 'key', 'none')
        grammarWhereFree(set, 'afterKey', 'notValue', context, 'afterKey', 'none')
        for (const token of [...keyStartTokens, 'fraction'] as const) grammarWhereFree(set, 'key', token, context, 'afterKey', 'none')
      }
    },
  },
  {
    name: 'a line end at the top level',
    reason: 'At the top level a line end starts the next line anew, wherever the line stopped: after a key alone, inside a header without its closing bracket.',
    example: '[server⏎host = "a"⏎por⏎name = "b"',
    cells: set => {
      for (const state of ['afterKey', 'key', ...headerStates] as const) for (const context of topContexts) grammarWhereFree(set, state, 'newline', context, 'lineStart', 'none')
    },
  },
  {
    name: 'a closing bracket where nothing is open',
    reason: 'At the top level a closing bracket closes nothing, and the grammar stays where it is.',
    example: 'ports = [80, 443]]⏎]',
    cells: set => {
      for (const state of statesButError) {
        for (const token of closingTokens) for (const context of topContexts) grammarWhereFree(set, state, token, context, state, 'none')
      }
    },
  },
  {
    name: 'nothing is shown as an error',
    reason: 'A character that starts nothing is shown as a string wherever no rule above says what it stands for: most of them are content of a string that lost a quote. A dot where no key and no number stands is shown so too.',
    example: 'pattern = ^\\d+$⏎url="mysql://app:p⏎@ss',
    cells: set => {
      for (const state of statesButError) {
        displayWhereFree(set, 'unexpectedCharacter', state, 'string')
        if (state === 'lineStart' || state === 'value' || state === 'valueOrClose') displayWhereFree(set, 'dot', state, 'string')
      }
    },
  },
  {
    name: 'the first token of a line',
    reason: 'A token that is the first on its line is read as any other token, where no rule above says otherwise.',
    example: 'point = {⏎  x = 1⏎}',
    fallback: 1,
    cells: set => {
      for (const state of statesButError) {
        for (const token of tokenNames) {
          for (const context of everyContext.filter(context => context < 8)) {
            const elsewhere = set.grammarChoice(state, token, context)
            if (elsewhere.next !== 'error') grammarWhereFree(set, state, token, firstOnLine(context), elsewhere.next, elsewhere.action)
          }
        }
      }
    },
  },
  {
    name: 'anything else changes nothing',
    reason: 'Where no rule says what a token means, the grammar stays where it is, where today it gives up the rest of the text. An opening bracket still opens a container, so that its closing bracket finds it.',
    example: 'name = <your-token>⏎[server] ???',
    fallback: 2,
    cells: set => {
      for (const state of statesButError) {
        for (const token of tokenNames) {
          if (token === 'end') continue
          for (const context of everyContext) {
            if (!set.grammarIsFree(state, token, context) || set.grammarChoice(state, token, context).next !== 'error') continue
            if (token === 'openBrace') set.grammar(state, token, context, 'keyOrClose', 'push inline table')
            else if (token === 'openBracket' || token === 'adjacentOpenBracket') set.grammar(state, token, context, 'valueOrClose', 'push array')
            else set.grammar(state, token, context, state, 'none')
          }
        }
      }
    },
  },
  {
    name: 'a state of the top level inside a container',
    reason: 'The start of a line, a header and the end of a header only come at the top level. When the grammar is in one of these states with a container still open, the container lost its closing bracket: every code point closes one container, and is read as at the top level.',
    example: 'tags = [["a", "b"⏎[server]',
    fallback: 3,
    cells: set => {
      for (const state of topLevelStates) {
        for (const token of tokenNames) {
          if (token === 'end') continue
          for (const context of depthOneOrMore) {
            const atTop = set.grammarChoice(state, token, context >= 8 ? firstOnLine(topContext) : topContext)
            grammarWhereFree(set, state, token, context, atTop.next === 'error' ? state : atTop.next, 'pop')
          }
        }
      }
    },
  },
]

// The order in which report.ts adds the rules one by one, to say what each adds to the ones before it. The rules that
// stand in for the one rule "after an error, start anew at the next line" come first, then the rules of the first
// draft, then the rules that were added later, in the order in which they went in. The list above is in another
// order: there an earlier rule has a cell before a later one.
export const stepOrder: readonly string[] = [
  'anything else changes nothing', 'a line end at the top level', 'a line end ends a token', 'a character that starts nothing', 'a word that breaks off',
  'a token ends where the next one starts', 'a closing bracket where nothing is open', 'a state of the top level inside a container', 'the first token of a line',
  'a string goes on', 'a carriage return alone', 'a sign in the place of the equals sign', 'a value without an equals sign', 'a word where a value should stand',
  'a header in another form', 'an entry inside an array', 'a header inside a container', 'a missing comma', 'a comma too many', 'an entry of an inline table without its value',
  'a line end inside an inline table', 'a closing bracket of the other kind', 'a key state inside an array', 'a line end after an equals sign', 'a character that does not show',
  'a string between foreign quotes', 'parentheses', 'a color code of a terminal', 'a comment of another language', 'an equals sign without a key', 'a list without brackets',
  'a mark before a line', 'a character of another script in a key', 'a semicolon', 'a line that starts with a comma', 'nothing is shown as an error', 'a number and a colon',
  'a bracket after a key', 'a quote right after a word',
]
if (stepOrder.length !== rules.length || rules.some(rule => !stepOrder.includes(rule.name))) throw new Error('stepOrder has to name every rule once')

// The tables of the hand-written recovery: the base with the cells of the given rules, by default of every rule.
export const handwrittenTables = (chosen: readonly HandwrittenRule[] = rules): Handwritten => tablesOfRules(baseWith(handChosenClasses), chosen)


if (import.meta.main) {
  refuseUnknownOptions('handwritten/rules.ts', ['--scratch'])
  const handwritten = handwrittenTables()
  console.log(describeRules(handwritten, rules))
  const scratch = scratchFolderOf(optionOf('--scratch'))
  if (scratch === undefined) {
    console.log('No scratch folder (--scratch or RECOVERY_SCRATCH), so the tables are not saved.')
  } else {
    mkdirSync(scratch, {recursive: true})
    const path = join(scratch, 'tables.json')
    saveTables(path, handwritten.tables, `hand-written recovery for TOML, ${rules.length} rules`)
    const sha256 = new Bun.CryptoHasher('sha256').update(await Bun.file(path).arrayBuffer()).digest('hex')
    writeFileSync(join(scratch, 'tables.json.sha256'), `${sha256}  tables.json\n`)
    console.log(`Saved the tables to ${path}, sha256 ${sha256}.`)
  }
}
