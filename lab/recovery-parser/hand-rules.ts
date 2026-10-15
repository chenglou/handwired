// Four settings of the tables that are written by hand and train nothing. All change only cells that valid JSON
// never reads, so valid JSON is read as before. They are what a trained result is to be compared with: the parser as
// it is gives up at the first error on purpose, so nearly any change to those cells scores better than it does.
// They are a floor that was found by hand, and no best table: one more rule can always score higher on some samples,
// as 'lines' does over 'words'. The README gives the scores of a table that a reader of the dataset built with a
// second copy of the tokenizer's states, which is not a setting here.
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
// - 'words': as 'resync', and a word where no token of JSON starts is read as a string, see `wordEvents`. E.g. in
//   {port: 8080, 'env': production} the tokenizer gives `port`, `'env'` and `production` the events of a string, and
//   the grammar shows the first two as keys and the third as a string, as it does with strings between quotes. It is
//   one more row of the tokenizer's table, and it scores about 9 points of code points above 'resync'.
// - 'lines': as 'words', with one more tokenizer state, which the tables as they are do not have: after a string that
//   a line feed ended, an opening brace at the very start of the next line does not open, see `handRuleTables`. It is
//   the rule for a file with one document per line in which a length limit cut one line short inside a string, e.g.
//   {"id": "7a919a<line feed>{"id": "7a919a-2", "ok": true}: the second line's labels are those of a document of its
//   own, at depth 1 inside its braces, and that is the depth that the cut line left open. In the group "needs a line
//   rule" it has 98.7% of the code points right where 'words' has 95.3%.
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

// What 'words' puts into error cells of the tokenizer on top of 'resync'. The row of the state errorLine, which
// 'stay' never enters, is the state inside a word.
function wordEvents(): [LexerState, CharacterClass, typeof eventNames[number], LexerState][] {
  const letters: readonly CharacterClass[] = ['a', 'b', 'e', 'capitalE', 'f', 'l', 'n', 'r', 's', 't', 'u', 'otherHexLetter', 'other']
  const literalStates: readonly LexerState[] = ['t', 'tr', 'tru', 'f', 'fa', 'fal', 'fals', 'n', 'nu', 'nul']
  const numberStates: readonly LexerState[] = ['minus', 'zero', 'integer', 'dot', 'fraction', 'exponent', 'exponentSign', 'exponentDigits']
  const cells: [LexerState, CharacterClass, typeof eventNames[number], LexerState][] = []
  // A letter between two tokens opens a word. The class `other` holds most characters, e.g. the apostrophe, $ and (.
  // The letters t, f and n start a literal there by cells that valid JSON reads, which stay as they are.
  for (const letter of letters) cells.push(['between', letter, 'stringStart', 'errorLine'])
  // A literal or a number that goes on with a character that it cannot have is a word from there on, e.g. the i of
  // nil, the a of name, the second dot of 1.4.2 and the second minus of 2026-04-08.
  for (const state of literalStates) for (const characterClass of [...letters, 'zero', 'digit', 'minus', 'dot'] as const) cells.push([state, characterClass, 'stringContent', 'errorLine'])
  for (const state of numberStates) for (const characterClass of [...letters, 'dot', 'minus'] as const) cells.push([state, characterClass, 'stringContent', 'errorLine'])
  // Inside a word: white space, a bracket, a colon and a comma end it and are read as between two tokens, and every
  // other character goes on with the word. A quote ends the word as the closing quote of a string does, e.g. in
  // `"city": Lisbon",` where the opening quote is missing, and after a string that was left open in the middle of a
  // line, where every quote is read in the opposite role, e.g. the quote after `main` in `"or, "main": 1`. The other
  // choice, a quote that opens a string, as after `ObjectId(`, scores 1.7 points of code points lower on the samples.
  const between = lexerStateNames.indexOf('between') * defaultTables.classCount
  for (const characterClass of classNames) {
    if (characterClass === 'end' || characterClass === 'truncatedEnd') continue
    if (afterAValue.includes(characterClass) || characterClass === 'openBrace' || characterClass === 'openBracket') cells.push(['errorLine', characterClass, eventNames[defaultTables.lexerEvent[between + classNames.indexOf(characterClass)]!]!, 'between'])
    else if (characterClass === 'quote') cells.push(['errorLine', characterClass, 'stringEnd', 'between'])
    else cells.push(['errorLine', characterClass, 'stringContent', 'errorLine'])
  }
  return cells
}

export const handRules = ['stay', 'resync', 'words', 'lines'] as const
export type HandRule = typeof handRules[number]

export function handRuleTables(rule: HandRule): ParserTables {
  const stateNamed = (name: string) => grammarStateNames.indexOf(name)
  const between = lexerStateNames.indexOf('between')
  const errorLine = lexerStateNames.indexOf('errorLine')
  const {classCount, symbolCount, contextCount, errorState} = defaultTables
  const lexerNext = defaultTables.lexerNext.map(next => next === errorLine ? between : next)
  const lexerEvent = [...defaultTables.lexerEvent]
  if (rule !== 'stay') {
    const errorToken = tokenNames.indexOf('lexerError')
    for (const [state, characterClass, event, next] of [...plainEvents(), ...(rule === 'words' || rule === 'lines' ? wordEvents() : [])]) {
      const cell = lexerStateNames.indexOf(state) * defaultTables.classCount + classNames.indexOf(characterClass)
      if (defaultTables.grammarToken[defaultTables.lexerEvent[cell]!] !== errorToken) continue
      lexerEvent[cell] = eventNames.indexOf(event)
      lexerNext[cell] = lexerStateNames.indexOf(next)
    }
  }
  if (rule === 'lines') {
    // One more tokenizer state, "at the start of the line after a string that a line feed ended". Its row is the row
    // of the state between, so any character but an opening brace is read as between two tokens. An opening brace
    // gets the event of a comma: it is shown as punctuation, the depth stays, and the grammar expects the next key.
    // Every cell that leads to the state is one that valid JSON never reads, so valid JSON never enters it.
    const afterCutString = lexerStateNames.length
    for (let characterClass = 0; characterClass < classCount; characterClass++) {
      lexerNext.push(lexerNext[between * classCount + characterClass]!)
      lexerEvent.push(lexerEvent[between * classCount + characterClass]!)
    }
    const lineFeed = classNames.indexOf('lineFeed')
    const openBrace = classNames.indexOf('openBrace')
    for (const state of ['string', ...insideAnEscape] as const) lexerNext[lexerStateNames.indexOf(state) * classCount + lineFeed] = afterCutString
    lexerEvent[afterCutString * classCount + openBrace] = eventNames.indexOf('comma')
    lexerNext[afterCutString * classCount + openBrace] = between
  }
  const grammarNext = [...defaultTables.grammarNext]
  for (let state = 0; state < defaultTables.grammarStateCount; state++) {
    if (state === errorState) continue
    for (let token = 0; token < tokenNames.length; token++) {
      for (let context = 0; context < contextCount; context++) {
        const cell = state * symbolCount + token * contextCount + context
        if (grammarNext[cell] !== errorState) continue
        let next = state
        if (rule !== 'stay') {
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
