// HELD BACK. Whoever builds the tables, the train data, the recovery parser, the twins or the bars does not read
// this file, see ../README.md.
//
// Every kind of mistake of this set, in the order of the README's table.
import type {Kind} from './kind.ts'
import {kindsOfAdded} from './kinds-added.ts'
import {kindsOfMissing} from './kinds-missing.ts'
import {kindsOfNotation} from './kinds-notation.ts'

export const kinds: readonly Kind[] = [...kindsOfMissing, ...kindsOfAdded, ...kindsOfNotation]
export const kindNames: readonly string[] = kinds.map(kind => kind.name)
export function kindOfName(name: string): Kind {
  const kind = kinds.find(each => each.name === name)
  if (kind === undefined) throw new Error(`no kind is called ${name}`)
  return kind
}
