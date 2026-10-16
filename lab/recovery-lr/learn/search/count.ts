// The count that sets the display entries: a copy of the tables in which every open display entry holds the
// display kind that the most code points of the train samples want there. A code point counts for an entry when
// its token is shown by the entry and the depth and the container of the token are right. An entry that no such
// code point reads keeps its kind, and of several kinds with the same count the one that the entry holds stays,
// or else the first.
//
// What a token is shown as changes nothing that the parser does next. So for the choices that the cells hold, no
// other display table has more scored code points of these samples with all three right: one count, no search.
// It is the display table's comparison without gradients, as displayEntriesByCount on the JSON side.
import {displayKindCount} from '../../labels.ts'
import type {PackedSamples} from '../data.ts'
import {type RecoveryTables, copyTables} from '../recovery-tables.ts'
import {scoreTables} from '../score.ts'

export function displayEntriesByCount(tables: RecoveryTables, trainSamples: PackedSamples): {tables: RecoveryTables, entriesChanged: number} {
  const result = copyTables(tables)
  const wantedKinds = new Int32Array(result.display.length * displayKindCount)
  scoreTables(result, trainSamples, {wantedKinds})
  let entriesChanged = 0
  for (let entry = 0; entry < result.display.length; entry++) {
    if (result.displayOpen[entry] !== 1) continue
    let best = result.display[entry]!
    for (let kind = 0; kind < displayKindCount; kind++) if (wantedKinds[entry * displayKindCount + kind]! > wantedKinds[entry * displayKindCount + best]!) best = kind
    if (best !== result.display[entry]) entriesChanged++
    result.display[entry] = best
  }
  return {tables: result, entriesChanged}
}
