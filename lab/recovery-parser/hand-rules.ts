// Two settings of the tables that are written by hand and train nothing. Both change only cells that invalid input
// reaches, so valid JSON is read as before. They are what a trained result is to be compared with: the parser as it is
// gives up at the first error on purpose, so nearly any change to those cells scores better than it does.
//
// - 'stay': a tokenizer error does not start an error line, so the next character starts a token again, and a token
//   that the grammar does not accept is ignored, so the grammar stays in its state.
// - 'resync': as 'stay', and a token that the grammar does not accept moves the grammar to the state that follows
//   that token in valid JSON, e.g. a string where a comma was expected inside an object is the next key, an opening
//   bracket opens, a closing bracket closes, and a colon is followed by a value. A string where a colon was expected
//   is the next key too, and not the value of the key before it: of the two rules, which exclude each other, the
//   samples need the first far more often, see the statistics.
//   'resync' also gives the tokenizer's error cells another event where what the character is is plain, see
//   `plainEvents`. Without that the one code point at which the tokenizer's error is found stays shown as an error, and
//   a sample that the rule otherwise reads in full is never right as a whole.
import {type ParserTables, classNames, defaultTables, eventNames, grammarStateNames, lexerStateNames, tokenNames} from './table-parser.ts'

type LexerState = typeof lexerStateNames[number]
type CharacterClass = typeof classNames[number]
// The classes of what can follow a value: white space, a comma, a colon and the closing brackets.
const afterAValue: readonly CharacterClass[] = ['space', 'tabOrCarriageReturn', 'lineFeed', 'comma', 'colon', 'closeBrace', 'closeBracket']
const unfinished: readonly LexerState[] = ['t', 'tr', 'tru', 'f', 'fa', 'fal', 'fals', 'n', 'nu', 'nul', 'minus', 'dot', 'exponent', 'exponentSign']
const insideAnEscape: readonly LexerState[] = ['escape', 'hex4', 'hex3', 'hex2', 'hex1']
// The characters that go on with a string after a backslash that starts no escape of JSON, e.g. the W of C:\Windows.
const printable: readonly CharacterClass[] = classNames.filter(name => !['end', 'truncatedEnd', 'lineFeed', 'tabOrCarriageReturn', 'control', 'quote', 'backslash'].includes(name))

// What 'resync' puts into error cells of the tokenizer, as [state, class, event, next state]. A cell that is not an
// error cell in the tables as they are is left alone, e.g. the cell for a valid escape.
function plainEvents(): [LexerState, CharacterClass, typeof eventNames[number], LexerState][] {
  const cells: [LexerState, CharacterClass, typeof eventNames[number], LexerState][] = [
    // A string that is open at the end of its line ends there, and the line feed is white space. The rule that a line
    // feed inside a string is content excludes this one, and the samples need this one far more often. A tab or
    // another control character inside a string is content.
    ['string', 'lineFeed', 'whitespace', 'between'], ['string', 'tabOrCarriageReturn', 'stringContent', 'string'], ['string', 'control', 'stringContent', 'string'],
    // A digit after a leading zero goes on with the number, e.g. 03.
    ['zero', 'zero', 'numberContent', 'integer'], ['zero', 'digit', 'numberContent', 'integer'],
  ]
  // A literal or a number that is not finished, e.g. tru or 59., ends before what can follow a value, and that
  // character is read as between two tokens.
  for (const state of unfinished) {
    for (const characterClass of afterAValue) {
      const cell = lexerStateNames.indexOf('between') * defaultTables.classCount + classNames.indexOf(characterClass)
      cells.push([state, characterClass, eventNames[defaultTables.lexerEvent[cell]!]!, 'between'])
    }
  }
  // After a backslash that starts no escape, and inside a \u escape without its four digits, the string goes on: a
  // quote ends it, a line feed ends it as above, and any other character is content.
  for (const state of insideAnEscape) {
    cells.push([state, 'lineFeed', 'whitespace', 'between'])
    if (state !== 'escape') cells.push([state, 'quote', 'stringEnd', 'between'])
    for (const characterClass of printable) cells.push([state, characterClass, 'stringContent', 'string'])
  }
  return cells
}

export const handRules = ['stay', 'resync'] as const
export type HandRule = typeof handRules[number]

export function handRuleTables(rule: HandRule): ParserTables {
  const stateNamed = (name: string) => grammarStateNames.indexOf(name)
  const between = lexerStateNames.indexOf('between')
  const errorLine = lexerStateNames.indexOf('errorLine')
  const {symbolCount, contextCount, errorState} = defaultTables
  const lexerNext = defaultTables.lexerNext.map(next => next === errorLine ? between : next)
  const lexerEvent = [...defaultTables.lexerEvent]
  if (rule === 'resync') {
    const errorToken = tokenNames.indexOf('lexerError')
    for (const [state, characterClass, event, next] of plainEvents()) {
      const cell = lexerStateNames.indexOf(state) * defaultTables.classCount + classNames.indexOf(characterClass)
      if (defaultTables.grammarToken[defaultTables.lexerEvent[cell]!] !== errorToken) continue
      lexerEvent[cell] = eventNames.indexOf(event)
      lexerNext[cell] = lexerStateNames.indexOf(next)
    }
  }
  const grammarNext = [...defaultTables.grammarNext]
  for (let state = 0; state < defaultTables.grammarStateCount; state++) {
    if (state === errorState) continue
    for (let token = 0; token < tokenNames.length; token++) {
      for (let context = 0; context < contextCount; context++) {
        const cell = state * symbolCount + token * contextCount + context
        if (grammarNext[cell] !== errorState) continue
        let next = state
        if (rule === 'resync') {
          const depthClass = Math.floor(context / 2)
          const inObject = context % 2 === 1
          const name = tokenNames[token]!
          const afterValue = depthClass === 0 ? stateNamed('end') : stateNamed('commaOrClose')
          if (name === 'string') next = inObject ? stateNamed('colon') : afterValue
          else if (name === 'scalar') next = afterValue
          else if (name === 'openObject') next = stateNamed('keyOrClose')
          else if (name === 'openArray') next = stateNamed('valueOrClose')
          else if (name === 'closeObject' || name === 'closeArray') next = depthClass <= 1 ? stateNamed('end') : stateNamed('commaOrClose')
          else if (name === 'colon') next = stateNamed('value')
          else if (name === 'comma') next = depthClass === 0 ? state : inObject ? stateNamed('key') : stateNamed('value')
        }
        grammarNext[cell] = next
      }
    }
  }
  return {...defaultTables, lexerNext, lexerEvent, grammarNext}
}
