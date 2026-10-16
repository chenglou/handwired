// Every kind of mistake of this folder, one file per family.
import {aroundKinds} from './around.ts'
import {assignmentKinds} from './assignment.ts'
import {bracketKinds} from './brackets.ts'
import {commentKinds} from './comments.ts'
import {keyAndHeaderKinds} from './keys-and-headers.ts'
import {stringKinds} from './strings.ts'
import type {KindDefinition} from './types.ts'
import {valueKinds} from './values.ts'

export const kinds: readonly KindDefinition[] = [...assignmentKinds, ...valueKinds, ...stringKinds, ...keyAndHeaderKinds, ...bracketKinds, ...commentKinds, ...aroundKinds]

const kindByName = new Map(kinds.map(kind => [kind.name, kind]))
export function kindNamed(name: string): KindDefinition {
  const kind = kindByName.get(name)
  if (kind === undefined) throw new Error(`no kind of mistake is named ${name}`)
  return kind
}
