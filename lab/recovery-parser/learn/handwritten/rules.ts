// A recovering JSON parser written by hand, as choices of open cells: the answer key that training is compared
// against, and the score to beat.
//
// Each rule below has a name, the reason a person would give for it, an example, and the cells it sets. A rule sets
// only open cells, to choices that the core allows: no new state, no new character class, no memory beyond the
// tokenizer state, the grammar state and the stack of open containers. No two rules set the same cell.
//
// The rules were written from JSON's grammar and from reading samples of the train split. No script picked a cell's
// choice by its score. What the cells cannot express is listed in README.md, not faked here.
//
// Run from the repo root to save the tables and print how many cells each rule sets:
//   bun lab/recovery-parser/learn/handwritten/rules.ts [--scratch <folder>]
// The tables go to <folder>/handwritten/tables.json. Without --scratch, the folder is the environment variable
// RECOVERY_SCRATCH, and without either nothing is saved.
import {mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {optionOf} from '../data.ts'
import {
  type RecoveryTables, actionByToken, actionNone, actionPop, actionPushObject, asIsTables, checkTables, classNames, eventNames, grammarCellName, grammarCellOf,
  grammarChoiceName, grammarStateNames, lexerCellName, lexerCellOf, lexerChoiceName, lexerStateNames, saveTables, tokenNames,
} from '../recovery-tables.ts'

type ClassName = typeof classNames[number]
type LexerStateName = typeof lexerStateNames[number]
type EventName = typeof eventNames[number]
type TokenName = typeof tokenNames[number]
type GrammarStateName = 'value' | 'valueOrClose' | 'keyOrClose' | 'key' | 'colon' | 'commaOrClose' | 'end' | 'error'

// What a rule may do: set a tokenizer cell or a grammar cell, and ask whether a tokenizer cell is open, for rules that
// go through every class of a state.
type CellSetter = {
  lexer: (state: LexerStateName, characterClass: ClassName, next: LexerStateName, event: EventName) => void
  // Without an action the cell keeps `by token`: an opening bracket pushes its kind, a closing bracket pops.
  grammar: (state: GrammarStateName, token: TokenName, context: number, next: GrammarStateName, action?: number) => void
  // Says that the rule relies on what an open cell holds today, e.g. a step into the grammar state `error`, which the
  // rules give a meaning. The cell is not changed, and it is counted apart from the cells that the rule sets.
  lexerAsToday: (state: LexerStateName, characterClass: ClassName, next: LexerStateName, event: EventName) => void
  grammarAsToday: (state: GrammarStateName, token: TokenName, context: number, next: GrammarStateName) => void
  lexerIsOpen: (state: LexerStateName, characterClass: ClassName) => boolean
}

export type Rule = {
  name: string
  // Why a person would write the rule, in one line.
  reason: string
  // A broken text that the rule is for.
  example: string
  cells: (set: CellSetter) => void
}

// The grammar's contexts: no open container, or the depth class (1, 2 to 15, 16) and the kind of the innermost one.
const topContext = 0
const arrayContexts = [2, 4, 6]
const objectContexts = [3, 5, 7]
// An array or an object that is inside another container.
const nestedArrayContexts = [4, 6]
const nestedObjectContexts = [5, 7]
// After a closing bracket: the document is complete when the bracket closed the container at depth 1, and otherwise
// the container around it expects a comma or its own closing bracket.
const afterClose = (context: number): GrammarStateName => context >> 1 === 1 ? 'end' : 'commaOrClose'

// The classes of characters that can be part of a word without quotes, e.g. the letters of True, the apostrophes of
// 'name', the digits and the dash of req-dab444. A word ends at a colon, a comma, a bracket or a line feed.
const letterClasses: readonly ClassName[] = ['a', 'b', 'e', 'capitalE', 'f', 'l', 'n', 'r', 's', 't', 'u', 'otherHexLetter', 'other']
const wordClasses: readonly ClassName[] = [...letterClasses, 'zero', 'digit', 'quote', 'backslash', 'slash', 'minus', 'plus', 'dot', 'control']
// What ends a token that is not complete, e.g. the comma of `tru,` and the line feed of `59.⏎`: the character is read
// as the state `between` reads it.
const endingClasses: readonly ClassName[] = ['space', 'tabOrCarriageReturn', 'lineFeed', 'comma', 'colon', 'closeBrace', 'closeBracket', 'openBrace', 'openBracket']
const eventBetweenTokens: Partial<Record<ClassName, EventName>> = {
  space: 'whitespace', tabOrCarriageReturn: 'whitespace', lineFeed: 'whitespace', comma: 'comma', colon: 'colon',
  closeBrace: 'closeObject', closeBracket: 'closeArray', openBrace: 'openObject', openBracket: 'openArray',
}
const hexStates: readonly LexerStateName[] = ['hex4', 'hex3', 'hex2', 'hex1']

// Two tokenizer states get a second meaning through their open cells. No state is added: a text that reaches one of
// them the old way is read by the new meaning too.
//
// - `errorLine` is the word state. Today it follows a tokenizer error and skips to the line feed. Each of its cells
//   is open, so digits and quotes can be word characters in it.
// - `exponentSign`, the state after `1e+`, is also the state inside a word that starts with a slash, e.g. a comment.
//   Its only frozen cells are the digits, which lead to `exponentDigits`. The open cells of `exponentDigits` lead back
//   into the word. Its frozen cells end the word after a digit at white space, a comma or a closing bracket.
const word: LexerStateName = 'errorLine'
const slashWord: LexerStateName = 'exponentSign'
const slashWordAfterDigits: LexerStateName = 'exponentDigits'
// The states of a literal or a number that is not complete, and of a complete number, without the states above.
const unfinishedTokenStates: readonly LexerStateName[] = ['t', 'tr', 'tru', 'f', 'fa', 'fal', 'fals', 'n', 'nu', 'nul', 'minus', 'dot', 'exponent']
const finishedNumberStates: readonly LexerStateName[] = ['zero', 'integer', 'fraction']

// Grammar states get a second meaning too.
//
// - `error`, which no text falls into any more, since every token has an entry in every state that a text reaches:
//   inside a container, "a closing brace closed a nested array, and the object around it still has to close". At
//   depth 0, "a comma came after the document".
// - `end`, which today is only reached at depth 0: inside a container, "a closing square bracket closed a nested
//   object, and the array around it still has to close".
// - `colon`, `valueOrClose` and `commaOrClose` at depth 0, where no text reaches them today: the steps of the
//   sequence in the rule `the document goes on after its end`.
const owesCloseOfObject: GrammarStateName = 'error'
const owesCloseOfArray: GrammarStateName = 'end'
const afterDocumentAndComma: GrammarStateName = 'error'

export const rules: readonly Rule[] = [
  // ---- The tokenizer ----
  {
    name: 'a word without quotes starts',
    reason: 'A character that starts no JSON token starts a word, and a word is read as a string without quotes: a key where a key may come, a string elsewhere.',
    example: '{port: 8080, env: production}',
    cells: set => {
      for (const characterClass of ['a', 'b', 'e', 'capitalE', 'l', 'r', 's', 'u', 'otherHexLetter', 'other', 'backslash'] as const) set.lexer('between', characterClass, word, 'stringStart')
    },
  },
  {
    name: 'a word goes on',
    reason: 'Inside a word every character but a colon, a comma, a bracket and a line feed is part of the word, spaces and quotes included, so that \'Ada Lovelace\' and ObjectId("507f") are one word each.',
    example: '{\'name\': \'Ada Lovelace\', "_id": ObjectId("507f")}',
    cells: set => {
      for (const characterClass of [...wordClasses, 'space', 'tabOrCarriageReturn'] as const) set.lexer(word, characterClass, word, 'stringContent')
    },
  },
  {
    name: 'a word ends at punctuation',
    reason: 'A colon, a comma or a bracket ends a word and is read as itself: the colon after a key without quotes, the comma or the closing bracket after a value without quotes, the opening brace after a statement in front of the document.',
    example: 'const config = {active: True}',
    cells: set => {
      for (const characterClass of ['comma', 'colon', 'closeBrace', 'closeBracket', 'openBrace', 'openBracket'] as const) set.lexer(word, characterClass, 'between', eventBetweenTokens[characterClass]!)
      // A line feed ends a word too, and is white space, as it is in this state today.
      set.lexerAsToday(word, 'lineFeed', 'between', 'whitespace')
    },
  },
  {
    name: 'a literal or a number turns into a word',
    reason: 'A character that cannot continue a literal or a number makes the token a word, e.g. the i of nil, the a of name, the p of 12px, the second dot of 1.4.2.',
    example: '{name: nil, "width": 12px}',
    cells: set => {
      for (const state of [...unfinishedTokenStates, ...finishedNumberStates]) {
        for (const characterClass of wordClasses) {
          if (!set.lexerIsOpen(state, characterClass)) continue
          // `leading zeros` and `a number starts with its sign or its point` set these.
          if (state === 'zero' && (characterClass === 'zero' || characterClass === 'digit')) continue
          if (state === 'minus' && characterClass === 'dot') continue
          // After a complete number a quote starts a string, as it does today, e.g. the missing comma of [1"a"].
          if (finishedNumberStates.includes(state) && characterClass === 'quote') continue
          set.lexer(state, characterClass, word, 'stringContent')
        }
      }
      // After a complete number, a quote, a colon and an opening bracket are read as between tokens, as today.
      for (const state of finishedNumberStates) {
        set.lexerAsToday(state, 'quote', 'string', 'stringStart')
        set.lexerAsToday(state, 'colon', 'between', 'colon')
        set.lexerAsToday(state, 'openBrace', 'between', 'openObject')
        set.lexerAsToday(state, 'openBracket', 'between', 'openArray')
      }
    },
  },
  {
    name: 'an unfinished literal or number ends',
    reason: 'White space, a comma, a colon or a bracket after a literal or a number that is still being typed is read as itself, and the typed characters keep their kind.',
    example: '{"paid": tru, "lat": 59.}',
    cells: set => {
      for (const state of unfinishedTokenStates) {
        for (const characterClass of endingClasses) set.lexer(state, characterClass, 'between', eventBetweenTokens[characterClass]!)
      }
    },
  },
  {
    name: 'leading zeros',
    reason: 'A digit after a leading zero continues the number.',
    example: '{"month": 03}',
    cells: set => {
      set.lexer('zero', 'zero', 'integer', 'numberContent')
      set.lexer('zero', 'digit', 'integer', 'numberContent')
    },
  },
  {
    name: 'a number starts with its sign or its point',
    reason: 'A plus sign or a decimal point where a token may start begins a number, as a minus sign does.',
    example: '{"offset": +3, "opacity": .5, "delta": -.25}',
    cells: set => {
      set.lexer('between', 'plus', 'minus', 'numberStart')
      set.lexer('between', 'dot', 'dot', 'numberStart')
      set.lexer('minus', 'dot', 'dot', 'numberContent')
    },
  },
  {
    name: 'a word that starts with a slash',
    reason: 'A slash where a token may start begins a comment or a path. It is read as a word in which a colon is a word character too, and of which the grammar sees nothing, so that a comment leaves the grammar where it was. Brackets still count, so that a pair of them in a comment stays a pair.',
    example: '{⏎  "port": 8080, // TODO: was 8000⏎  "host": /* default */ "localhost"⏎}',
    cells: set => {
      set.lexer('between', 'slash', slashWord, 'stringContent')
      for (const characterClass of classNames) {
        if (characterClass === 'end' || characterClass === 'truncatedEnd') continue
        if (characterClass === 'lineFeed') {
          set.lexer(slashWord, characterClass, 'between', 'whitespace')
        } else if (characterClass === 'comma' || characterClass === 'closeBrace' || characterClass === 'closeBracket' || characterClass === 'openBrace' || characterClass === 'openBracket') {
          set.lexer(slashWord, characterClass, 'between', eventBetweenTokens[characterClass]!)
        } else {
          if (set.lexerIsOpen(slashWord, characterClass)) set.lexer(slashWord, characterClass, slashWord, 'stringContent')
          // A digit leads to the state of an exponent's digits, by a frozen cell, and the word goes on from there.
          if (set.lexerIsOpen(slashWordAfterDigits, characterClass)) set.lexer(slashWordAfterDigits, characterClass, slashWord, 'stringContent')
        }
      }
    },
  },
  {
    name: 'a string ends at the line feed',
    reason: 'A JSON string holds no raw line feed, so a line feed inside a string means that the closing quote is not typed yet: the string ends there and the line feed is white space.',
    example: '{⏎  "name": "tiny-glob",⏎  "pri⏎}',
    cells: set => {
      for (const state of ['string', 'escape', ...hexStates] as const) set.lexer(state, 'lineFeed', 'between', 'whitespace')
    },
  },
  {
    name: 'a raw control character in a string',
    reason: 'A tab or another control character inside a string is content: someone pasted the text without escaping it.',
    example: '{"notes": "fragile→handle with care"}',
    cells: set => {
      set.lexer('string', 'tabOrCarriageReturn', 'string', 'stringContent')
      set.lexer('string', 'control', 'string', 'stringContent')
    },
  },
  {
    name: 'a backslash before any character',
    reason: 'After a backslash and a character that JSON does not escape, the string goes on: the backslash was meant as a backslash.',
    example: '{"terminal.shell": "C:\\Windows\\System32\\cmd.exe"}',
    cells: set => {
      for (const characterClass of classNames) {
        if (characterClass === 'end' || characterClass === 'truncatedEnd' || characterClass === 'lineFeed' || !set.lexerIsOpen('escape', characterClass)) continue
        set.lexer('escape', characterClass, 'string', 'stringContent')
      }
    },
  },
  {
    name: 'a \\u escape that is too short',
    reason: 'A character that is no hex digit ends a \\u escape, and is read as the string reads it: a quote ends the string, a backslash starts an escape, anything else is content.',
    example: '{"unit": "\\u00b"}',
    cells: set => {
      for (const state of hexStates) {
        for (const characterClass of classNames) {
          if (characterClass === 'end' || characterClass === 'truncatedEnd' || characterClass === 'lineFeed' || !set.lexerIsOpen(state, characterClass)) continue
          if (characterClass === 'quote') set.lexer(state, characterClass, 'between', 'stringEnd')
          else if (characterClass === 'backslash') set.lexer(state, characterClass, 'escape', 'escape')
          else set.lexer(state, characterClass, 'string', 'stringContent')
        }
      }
    },
  },
  {
    name: 'a control character between tokens',
    reason: 'A control character between tokens is skipped like white space, e.g. a NUL or an end-of-file character after the document.',
    example: '{"ok": true}␚',
    cells: set => set.lexer('between', 'control', 'between', 'whitespace'),
  },

  // ---- The grammar ----
  {
    name: 'trailing comma',
    reason: 'A closing bracket right after a comma closes the container: the comma was one too many.',
    example: '{⏎  "host": "localhost",⏎  "port": 8080,⏎}',
    cells: set => {
      for (const context of objectContexts) set.grammar('key', 'closeObject', context, afterClose(context))
      for (const context of arrayContexts) set.grammar('value', 'closeArray', context, afterClose(context))
    },
  },
  {
    name: 'colon without a value',
    reason: 'A comma or a closing brace right after a colon: the value is not typed yet, and the object goes on or ends as the character says.',
    example: '{⏎  "version": ,⏎  "license": "MIT"⏎}',
    cells: set => {
      for (const context of objectContexts) {
        set.grammar('value', 'comma', context, 'key')
        set.grammar('value', 'closeObject', context, afterClose(context))
      }
    },
  },
  {
    name: 'key without a colon',
    reason: 'A comma, a closing brace or another string right after a key: the key is still being typed and has no colon yet, so a string is the next key, shown as a key.',
    example: '{⏎  "strict": true,⏎  "tar"⏎  "outDir": "dist"⏎}',
    cells: set => {
      for (const context of objectContexts) {
        set.grammar('colon', 'comma', context, 'key')
        set.grammar('colon', 'closeObject', context, afterClose(context))
        set.grammar('colon', 'string', context, 'colon')
      }
    },
  },
  {
    name: 'missing colon',
    reason: 'A number, a literal or an opening bracket right after a key can only be the key\'s value: the colon is missing.',
    example: '{"port" 8080, "tags" ["a"]}',
    cells: set => {
      for (const context of objectContexts) {
        set.grammar('colon', 'scalar', context, 'commaOrClose')
        set.grammar('colon', 'openObject', context, 'keyOrClose')
        set.grammar('colon', 'openArray', context, 'valueOrClose')
      }
    },
  },
  {
    name: 'missing comma',
    reason: 'After a complete value, the start of a token is the next entry: the next key inside an object, the next item inside an array. An opening bracket opens a container, so that its closing bracket finds it.',
    example: '{⏎  "version": "0.4.1"⏎  "private": true⏎}',
    cells: set => {
      for (const context of objectContexts) {
        set.grammar('commaOrClose', 'string', context, 'colon')
        set.grammar('commaOrClose', 'scalar', context, 'colon')
      }
      for (const context of arrayContexts) {
        set.grammar('commaOrClose', 'string', context, 'commaOrClose')
        set.grammar('commaOrClose', 'scalar', context, 'commaOrClose')
      }
      for (const context of [...arrayContexts, ...objectContexts]) {
        set.grammar('commaOrClose', 'openObject', context, 'keyOrClose')
        set.grammar('commaOrClose', 'openArray', context, 'valueOrClose')
      }
    },
  },
  {
    name: 'extra comma',
    reason: 'A comma where an entry should start changes nothing.',
    example: '{"id": 7, , "tags": [, "ops"]}',
    cells: set => {
      for (const context of objectContexts) {
        set.grammar('key', 'comma', context, 'key')
        set.grammar('keyOrClose', 'comma', context, 'key')
      }
      for (const context of arrayContexts) {
        set.grammar('value', 'comma', context, 'value')
        set.grammar('valueOrClose', 'comma', context, 'value')
      }
    },
  },
  {
    name: 'a number or a literal as a key',
    reason: 'Where a key may come, a token that starts like a number or a literal is the key, e.g. the n of a key without quotes, name, or the dots of an ellipsis.',
    example: '{name: "Ada", 1: "one", ...}',
    cells: set => {
      for (const context of objectContexts) {
        set.grammar('key', 'scalar', context, 'colon')
        set.grammar('keyOrClose', 'scalar', context, 'colon')
      }
    },
  },
  {
    name: 'no key before a colon or a container',
    reason: 'Where a key may come, a colon is followed by the value, and an opening bracket opens a container, so that its closing bracket finds it.',
    example: '{"userId": {{user_id}}, : 1}',
    cells: set => {
      for (const context of objectContexts) {
        for (const state of ['key', 'keyOrClose'] as const) {
          set.grammar(state, 'colon', context, 'value')
          set.grammar(state, 'openObject', context, 'keyOrClose')
          set.grammar(state, 'openArray', context, 'valueOrClose')
        }
      }
    },
  },
  {
    name: 'a colon after a value',
    reason: 'A colon after a complete value inside an object: the value was really the next key, e.g. after a colon without a value, so a value comes next.',
    example: '{⏎  "version":⏎  "license": "MIT"⏎}',
    cells: set => {
      for (const context of objectContexts) set.grammar('commaOrClose', 'colon', context, 'value')
    },
  },
  {
    name: 'a key inside a nested array',
    reason: 'A colon after a value inside an array that is inside another container: only an object has keys, so the array lost its closing bracket. The colon closes the array, and the value of the key comes next.',
    example: '{⏎  "files": [⏎    "dist",⏎    "src"⏎  "license": "MIT"⏎}',
    cells: set => {
      for (const context of nestedArrayContexts) set.grammar('commaOrClose', 'colon', context, 'value', actionPop)
    },
  },
  {
    name: 'a colon inside the outermost array',
    reason: 'No object is around the outermost array, so a colon after one of its values belongs to no key and changes nothing.',
    example: '[1, 2: 3]',
    cells: set => set.grammar('commaOrClose', 'colon', 2, 'commaOrClose'),
  },
  {
    name: 'a closing bracket of the other kind',
    reason: 'A closing bracket of the other kind closes the innermost container: it was mistyped, or the innermost container is still being typed and the bracket is the one of the container around it. One step can pop only once, so inside a nested container the grammar remembers the bracket: the state `error` after a brace, the state `end` after a square bracket.',
    example: '{⏎  "user": {⏎    "roles": ["admin"⏎  },⏎  "active": true⏎}',
    cells: set => {
      // At depth 1 the state `end` is the document's end, as after any closing bracket there.
      for (const context of objectContexts) {
        for (const state of ['value', 'keyOrClose', 'key', 'colon', 'commaOrClose'] as const) set.grammar(state, 'closeArray', context, owesCloseOfArray)
      }
      for (const state of ['value', 'valueOrClose', 'commaOrClose'] as const) {
        set.grammar(state, 'closeObject', 2, 'end')
        for (const context of nestedArrayContexts) set.grammarAsToday(state, 'closeObject', context, owesCloseOfObject)
      }
    },
  },
  {
    name: 'the close that is owed after a brace',
    reason: 'After a closing brace closed a nested array: when the container that is now innermost is an object, the brace was its closing brace. A comma closes the object, and the next key follows in the container around it, unless the object is the outermost one: there a comma shows that the document goes on. Another closing brace closes the object, and the next container still has to close. Anything else is read as after a complete value. When the innermost container is an array, nothing is owed.',
    example: '{⏎  "user": {⏎    "roles": ["admin"⏎  },⏎  "active": true⏎}',
    cells: set => {
      // In the outermost object a comma shows that the document goes on, so nothing was owed: the brace was mistyped.
      set.grammar(owesCloseOfObject, 'comma', 3, 'key')
      set.grammar(owesCloseOfObject, 'closeObject', 3, 'end')
      for (const context of nestedObjectContexts) {
        set.grammar(owesCloseOfObject, 'comma', context, 'key', actionPop)
        // The brace pops, and the state stays.
        set.grammarAsToday(owesCloseOfObject, 'closeObject', context, owesCloseOfObject)
      }
      for (const context of objectContexts) {
        set.grammar(owesCloseOfObject, 'closeArray', context, owesCloseOfArray)
        set.grammar(owesCloseOfObject, 'string', context, 'colon')
        set.grammar(owesCloseOfObject, 'scalar', context, 'colon')
        set.grammar(owesCloseOfObject, 'colon', context, 'value')
        set.grammar(owesCloseOfObject, 'openObject', context, 'keyOrClose')
        set.grammar(owesCloseOfObject, 'openArray', context, 'valueOrClose')
      }
      // Inside an array nothing is owed: the state reads as after a complete value.
      for (const context of arrayContexts) {
        set.grammar(owesCloseOfObject, 'comma', context, 'value')
        set.grammar(owesCloseOfObject, 'closeArray', context, afterClose(context))
        set.grammar(owesCloseOfObject, 'string', context, 'commaOrClose')
        set.grammar(owesCloseOfObject, 'scalar', context, 'commaOrClose')
        set.grammar(owesCloseOfObject, 'openObject', context, 'keyOrClose')
        set.grammar(owesCloseOfObject, 'openArray', context, 'valueOrClose')
      }
      set.grammar(owesCloseOfObject, 'closeObject', 2, 'end')
      set.grammar(owesCloseOfObject, 'colon', 2, 'commaOrClose')
      for (const context of nestedArrayContexts) {
        set.grammar(owesCloseOfObject, 'colon', context, 'value', actionPop)
        // A second closing brace in a row: it closes this array too, and the state stays.
        set.grammarAsToday(owesCloseOfObject, 'closeObject', context, owesCloseOfObject)
      }
    },
  },
  {
    name: 'the close that is owed after a square bracket',
    reason: 'After a closing square bracket closed a nested object: when the container that is now innermost is an array, the bracket was its closing bracket. A comma closes the array, and the next entry follows in the container around it, unless the array is the outermost one. Another closing square bracket closes the array, and the next container still has to close. Anything else is read as after a complete value. When the innermost container is an object, nothing is owed.',
    example: '{⏎  "items": [⏎    {"id": 1},⏎    {"id": 2⏎  ],⏎  "total": 2⏎}',
    cells: set => {
      // In the outermost array a comma shows that the document goes on, so nothing was owed: the bracket was mistyped.
      set.grammar(owesCloseOfArray, 'comma', 2, 'value')
      set.grammar(owesCloseOfArray, 'closeArray', 2, 'end')
      set.grammar(owesCloseOfArray, 'closeObject', 2, 'end')
      set.grammar(owesCloseOfArray, 'colon', 2, 'commaOrClose')
      for (const context of nestedArrayContexts) {
        // The container around the array may be an object or an array: `a key state inside an array` reads the
        // state `key` in both.
        set.grammar(owesCloseOfArray, 'comma', context, 'key', actionPop)
        // The bracket pops, and the state stays.
        set.grammar(owesCloseOfArray, 'closeArray', context, owesCloseOfArray)
        set.grammarAsToday(owesCloseOfArray, 'closeObject', context, owesCloseOfObject)
        set.grammar(owesCloseOfArray, 'colon', context, 'value', actionPop)
      }
      for (const context of arrayContexts) {
        set.grammar(owesCloseOfArray, 'string', context, 'commaOrClose')
        set.grammar(owesCloseOfArray, 'scalar', context, 'commaOrClose')
        set.grammar(owesCloseOfArray, 'openObject', context, 'keyOrClose')
        set.grammar(owesCloseOfArray, 'openArray', context, 'valueOrClose')
      }
      // Inside an object nothing is owed: the state reads as after a complete value.
      for (const context of objectContexts) {
        set.grammar(owesCloseOfArray, 'comma', context, 'key')
        set.grammar(owesCloseOfArray, 'closeObject', context, afterClose(context))
        set.grammar(owesCloseOfArray, 'closeArray', context, owesCloseOfArray)
        set.grammar(owesCloseOfArray, 'string', context, 'colon')
        set.grammar(owesCloseOfArray, 'scalar', context, 'colon')
        set.grammar(owesCloseOfArray, 'colon', context, 'value')
        set.grammar(owesCloseOfArray, 'openObject', context, 'keyOrClose')
        set.grammar(owesCloseOfArray, 'openArray', context, 'valueOrClose')
      }
    },
  },
  {
    name: 'a key state inside an array',
    reason: 'After the close that is owed, the grammar expects a key, but the container that it lands in may be an array. There the state reads as the state that expects a value.',
    example: '[⏎  {"roles": ["admin"},⏎  "next"⏎]',
    cells: set => {
      for (const context of arrayContexts) {
        set.grammar('key', 'string', context, 'commaOrClose')
        set.grammar('key', 'scalar', context, 'commaOrClose')
        set.grammar('key', 'openObject', context, 'keyOrClose')
        set.grammar('key', 'openArray', context, 'valueOrClose')
        set.grammar('key', 'closeArray', context, afterClose(context))
        set.grammar('key', 'comma', context, 'value')
      }
      set.grammar('key', 'closeObject', 2, 'end')
      for (const context of nestedArrayContexts) set.grammarAsToday('key', 'closeObject', context, owesCloseOfObject)
    },
  },
  {
    name: 'after the document',
    reason: 'After a complete top-level value, an opening bracket starts a new document, a closing bracket is a stray one and pops nothing, and any other token is text around the document.',
    example: '{"t": 1}⏎{"t": 2}}⏎Done.',
    cells: set => {
      for (const token of ['string', 'scalar', 'colon'] as const) set.grammar('end', token, topContext, 'end')
      set.grammar('end', 'closeObject', topContext, 'end', actionNone)
      set.grammar('end', 'closeArray', topContext, 'end', actionNone)
      set.grammar('end', 'openObject', topContext, 'keyOrClose')
      set.grammar('end', 'openArray', topContext, 'valueOrClose')
    },
  },
  {
    name: 'the document goes on after its end',
    reason: 'After the document, a comma, a string, a colon and a value are a member: the document was closed too early, e.g. by a stray closing bracket, or its opening brace is missing. A number or a literal as the value opens the object again. A string as the value does so at the comma after it, because a string can also be a line of text in front of a document, e.g. the fence line after "Okay, the result:".',
    example: '{"name": "Ada"}}, "active": true, "roles": []}',
    cells: set => {
      // Four grammar states carry the sequence at depth 0, where no text reaches them today: `error` after the
      // comma, `colon` after the string, which is then shown as a key, `valueOrClose` after the colon, and
      // `commaOrClose` after a string as the value.
      set.grammarAsToday('end', 'comma', topContext, afterDocumentAndComma)
      set.grammar(afterDocumentAndComma, 'string', topContext, 'colon')
      set.grammar('colon', 'colon', topContext, 'valueOrClose')
      set.grammar('valueOrClose', 'scalar', topContext, 'commaOrClose', actionPushObject)
      set.grammar('valueOrClose', 'string', topContext, 'commaOrClose')
      set.grammar('commaOrClose', 'comma', topContext, 'key', actionPushObject)
      // Anything else ends the sequence, and is read as after the document.
      set.grammarAsToday(afterDocumentAndComma, 'comma', topContext, afterDocumentAndComma)
      set.grammarAsToday('colon', 'comma', topContext, afterDocumentAndComma)
      set.grammarAsToday('valueOrClose', 'comma', topContext, afterDocumentAndComma)
      set.grammar(afterDocumentAndComma, 'scalar', topContext, 'end')
      set.grammar(afterDocumentAndComma, 'colon', topContext, 'end')
      set.grammar('colon', 'string', topContext, 'end')
      set.grammar('colon', 'scalar', topContext, 'end')
      set.grammar('valueOrClose', 'colon', topContext, 'end')
      set.grammar('commaOrClose', 'string', topContext, 'end')
      set.grammar('commaOrClose', 'scalar', topContext, 'end')
      set.grammar('commaOrClose', 'colon', topContext, 'end')
      for (const state of [afterDocumentAndComma, 'colon', 'valueOrClose', 'commaOrClose'] as const) {
        set.grammar(state, 'closeObject', topContext, 'end', actionNone)
        set.grammar(state, 'closeArray', topContext, 'end', actionNone)
      }
      for (const state of [afterDocumentAndComma, 'colon', 'commaOrClose'] as const) {
        set.grammar(state, 'openObject', topContext, 'keyOrClose')
        set.grammar(state, 'openArray', topContext, 'valueOrClose')
      }
      set.grammarAsToday('valueOrClose', 'openObject', topContext, 'keyOrClose')
      set.grammarAsToday('valueOrClose', 'openArray', topContext, 'valueOrClose')
    },
  },
  {
    name: 'before the document',
    reason: 'Before the first value, a colon or a comma changes nothing, and a closing bracket pops nothing.',
    example: ')]}\',⏎{"ok": true}',
    cells: set => {
      set.grammar('value', 'colon', topContext, 'value')
      set.grammar('value', 'comma', topContext, 'value')
      set.grammar('value', 'closeObject', topContext, 'value', actionNone)
      set.grammar('value', 'closeArray', topContext, 'value', actionNone)
    },
  },
  {
    name: 'deeper than the maximum depth',
    reason: 'An opening bracket at depth 16 still opens a container, so that its closing bracket finds it.',
    example: '[[[[[[[[[[[[[[[[[1]]]]]]]]]]]]]]]]]',
    cells: set => {
      for (const context of [6, 7]) {
        set.grammar('value', 'openObject', context, 'keyOrClose')
        set.grammar('value', 'openArray', context, 'valueOrClose')
      }
      set.grammar('valueOrClose', 'openObject', 6, 'keyOrClose')
      set.grammar('valueOrClose', 'openArray', 6, 'valueOrClose')
    },
  },
]

export type Handwritten = {
  tables: RecoveryTables
  // For every cell, the index into `rules` of the rule that set it, or -1.
  ruleOfLexerCell: Int16Array
  ruleOfGrammarCell: Int16Array
  // How many tokenizer cells and grammar cells each rule set, and how many open cells it keeps as they are today.
  lexerCellsOfRule: number[]
  grammarCellsOfRule: number[]
  keptCellsOfRule: number[]
  // Whether each rule is about the tokenizer's table. The others are about the grammar's.
  ruleIsOfTokenizer: boolean[]
}

// The tables of the hand-written recovery: today's tables with the cells of every rule. Throws when a rule sets a
// frozen cell, a cell that another rule set, or a cell to what it holds today.
export function handwrittenTables(chosen: readonly Rule[] = rules): Handwritten {
  const tables = asIsTables()
  const ruleOfLexerCell = new Int16Array(tables.lexerNext.length).fill(-1)
  const ruleOfGrammarCell = new Int16Array(tables.grammarNext.length).fill(-1)
  const lexerCellsOfRule = chosen.map(() => 0)
  const grammarCellsOfRule = chosen.map(() => 0)
  const keptCellsOfRule = chosen.map(() => 0)
  const ruleIsOfTokenizer = chosen.map(() => false)
  const indexIn = <Name extends string>(names: readonly Name[], name: Name, what: string) => {
    const index = names.indexOf(name)
    if (index === -1) throw new Error(`no ${what} is named ${name}`)
    return index
  }
  chosen.forEach((rule, ruleIndex) => {
    const fail = (cell: string, problem: string) => new Error(`rule "${rule.name}": the cell ${cell} ${problem}`)
    rule.cells({
      lexerIsOpen: (state, characterClass) => tables.lexerOpen[lexerCellOf(tables, lexerStateNames.indexOf(state), classNames.indexOf(characterClass))] === 1,
      lexer: (state, characterClass, next, event) => {
        const cell = lexerCellOf(tables, lexerStateNames.indexOf(state), classNames.indexOf(characterClass))
        const name = lexerCellName(tables, cell)
        if (tables.lexerOpen[cell] === 0) throw fail(name, 'is frozen')
        if (ruleOfLexerCell[cell] !== -1) throw fail(name, `is already set by the rule "${chosen[ruleOfLexerCell[cell]!]!.name}"`)
        const nextIndex = lexerStateNames.indexOf(next)
        const eventIndex = eventNames.indexOf(event)
        if (tables.lexerNext[cell] === nextIndex && tables.lexerEvent[cell] === eventIndex) throw fail(name, `holds ${lexerChoiceName(tables, cell)} today`)
        tables.lexerNext[cell] = nextIndex
        tables.lexerEvent[cell] = eventIndex
        ruleOfLexerCell[cell] = ruleIndex
        lexerCellsOfRule[ruleIndex]!++
        ruleIsOfTokenizer[ruleIndex] = true
      },
      lexerAsToday: (state, characterClass, next, event) => {
        const cell = lexerCellOf(tables, lexerStateNames.indexOf(state), classNames.indexOf(characterClass))
        const name = lexerCellName(tables, cell)
        if (tables.lexerOpen[cell] === 0) throw fail(name, 'is frozen')
        if (ruleOfLexerCell[cell] !== -1) throw fail(name, `is already set by the rule "${chosen[ruleOfLexerCell[cell]!]!.name}"`)
        if (tables.lexerNext[cell] !== lexerStateNames.indexOf(next) || tables.lexerEvent[cell] !== eventNames.indexOf(event)) throw fail(name, `holds ${lexerChoiceName(tables, cell)} today`)
        ruleOfLexerCell[cell] = ruleIndex
        keptCellsOfRule[ruleIndex]!++
        ruleIsOfTokenizer[ruleIndex] = true
      },
      grammar: (state, token, context, next, action = actionByToken) => {
        const cell = grammarCellOf(tables, indexIn(grammarStateNames as readonly GrammarStateName[], state, 'grammar state'), tokenNames.indexOf(token), context)
        const name = grammarCellName(tables, cell)
        if (tables.grammarOpen[cell] === 0) throw fail(name, 'is frozen')
        if (ruleOfGrammarCell[cell] !== -1) throw fail(name, `is already set by the rule "${chosen[ruleOfGrammarCell[cell]!]!.name}"`)
        const nextIndex = indexIn(grammarStateNames as readonly GrammarStateName[], next, 'grammar state')
        if (tables.grammarNext[cell] === nextIndex && tables.grammarAction[cell] === action) throw fail(name, `holds ${grammarChoiceName(tables, cell)} today`)
        tables.grammarNext[cell] = nextIndex
        tables.grammarAction[cell] = action
        ruleOfGrammarCell[cell] = ruleIndex
        grammarCellsOfRule[ruleIndex]!++
      },
      grammarAsToday: (state, token, context, next) => {
        const cell = grammarCellOf(tables, indexIn(grammarStateNames as readonly GrammarStateName[], state, 'grammar state'), tokenNames.indexOf(token), context)
        const name = grammarCellName(tables, cell)
        if (tables.grammarOpen[cell] === 0) throw fail(name, 'is frozen')
        if (ruleOfGrammarCell[cell] !== -1) throw fail(name, `is already set by the rule "${chosen[ruleOfGrammarCell[cell]!]!.name}"`)
        if (tables.grammarNext[cell] !== indexIn(grammarStateNames as readonly GrammarStateName[], next, 'grammar state') || tables.grammarAction[cell] !== actionByToken) throw fail(name, `holds ${grammarChoiceName(tables, cell)} today`)
        ruleOfGrammarCell[cell] = ruleIndex
        keptCellsOfRule[ruleIndex]!++
      },
    })
  })
  checkTables(tables)
  return {tables, ruleOfLexerCell, ruleOfGrammarCell, lexerCellsOfRule, grammarCellsOfRule, keptCellsOfRule, ruleIsOfTokenizer}
}

// The rules as text: per rule its name, how many cells it sets, its reason and its example.
export function describeRules(handwritten: Handwritten, chosen: readonly Rule[] = rules): string {
  const lines: string[] = []
  chosen.forEach((rule, index) => {
    const lexerCells = handwritten.lexerCellsOfRule[index]!
    const grammarCells = handwritten.grammarCellsOfRule[index]!
    const kept = handwritten.keptCellsOfRule[index]!
    lines.push(`${String(lexerCells + grammarCells).padStart(4)} cells (${handwritten.ruleIsOfTokenizer[index]! ? 'tokenizer' : 'grammar'})${kept === 0 ? '' : ` and ${kept} kept as today`}  ${rule.name}`)
    lines.push(`            ${rule.reason}`)
    lines.push(`            e.g. ${rule.example}`)
  })
  const lexerTotal = handwritten.lexerCellsOfRule.reduce((total, count) => total + count, 0)
  const grammarTotal = handwritten.grammarCellsOfRule.reduce((total, count) => total + count, 0)
  lines.push(`${chosen.length} rules set ${lexerTotal} tokenizer cells and ${grammarTotal} grammar cells.`)
  return lines.join('\n')
}

if (import.meta.main) {
  const handwritten = handwrittenTables()
  console.log(describeRules(handwritten))
  const scratch = optionOf('--scratch') ?? process.env['RECOVERY_SCRATCH']
  if (scratch === undefined || scratch === '') {
    console.log('No scratch folder (--scratch or RECOVERY_SCRATCH), so the tables are not saved.')
  } else {
    const folder = join(scratch, 'handwritten')
    mkdirSync(folder, {recursive: true})
    const lexerTotal = handwritten.lexerCellsOfRule.reduce((total, count) => total + count, 0)
    const grammarTotal = handwritten.grammarCellsOfRule.reduce((total, count) => total + count, 0)
    saveTables(join(folder, 'tables.json'), handwritten.tables, `hand-written recovery, ${rules.length} rules, ${lexerTotal} tokenizer cells and ${grammarTotal} grammar cells`)
    console.log(`Saved the tables to ${join(folder, 'tables.json')}.`)
  }
}
