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
import {type ParserTables, defaultTables, grammarStateNames, lexerStateNames, tokenNames} from './table-parser.ts'

export const handRules = ['stay', 'resync'] as const
export type HandRule = typeof handRules[number]

export function handRuleTables(rule: HandRule): ParserTables {
  const stateNamed = (name: string) => grammarStateNames.indexOf(name)
  const between = lexerStateNames.indexOf('between')
  const errorLine = lexerStateNames.indexOf('errorLine')
  const {symbolCount, contextCount, errorState} = defaultTables
  const lexerNext = defaultTables.lexerNext.map(next => next === errorLine ? between : next)
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
  return {...defaultTables, lexerNext, grammarNext}
}
