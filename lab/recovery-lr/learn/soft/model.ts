// The numbers that training moves. A trainable cell has one logit per choice of its list, and its mix is the
// softmax of its logits: one share per choice, e.g. 0.7 for "insert `then`" and 0.3 for stop. A trainable entry of
// the display table has one logit per display kind. Every other cell and entry holds what the base tables hold.
//
// A Layout says where the logits of a cell and of an entry are. A twin (twin.ts) is made for a layout and is
// handed the logits. Snapping gives tables again: every trainable cell and entry holds the choice with the largest
// logit.
import {displayKindCount} from '../../labels.ts'
import {type RecoveryTables, cellName, checkTables, choicesOf, copyTables, displayEntryName, endOfInput} from '../recovery-tables.ts'

export type Layout = {
  // The tables that training starts from, e.g. the parser as it is with the flag "first on its line". A cell or an
  // entry that is not trainable holds what these tables hold.
  base: RecoveryTables
  // [cell of base.choice]: the place of the cell's first logit, or -1 for a cell that is not trainable. A trainable
  // cell has one logit per choice of choicesOf(base, cell), in the order of that list.
  cellOffset: Int32Array
  // [entry of base.display]: the place of the entry's first logit, or -1 for an entry that is not trainable. A
  // trainable entry has one logit per display kind, in the order of displayKindNames.
  displayOffset: Int32Array
  // The mixes in the order of their logits: the trainable cells in the order of the table, then the trainable
  // entries. The logits of mix m are the entries mixStart[m] to mixStart[m + 1] - 1, and mixOwner[m] is its cell, or
  // its entry for a mix from cellMixCount on.
  mixStart: Int32Array
  mixOwner: Int32Array
  cellMixCount: number
  logitCount: number
}

export type Model = {layout: Layout, logits: Float64Array}

export type ModelOptions = {
  // Which cells and which display entries are trainable: a mask with 1 per trainable one, or every one that may
  // change, or none. The cells that may change are the open ones without the column of the end of input, see
  // changeableCellsOf of ../recovery-tables.ts. Without `trainable`, every cell that may change and every open
  // entry is trainable.
  trainable?: {cells: Uint8Array | 'changeable' | 'none', display: Uint8Array | 'open' | 'none'}
  // Where the logits start. 'base': every mix gives `startShare` to the base tables' choice and splits the rest
  // evenly over the other choices. 'uniform': every choice of a mix has the same share. The default is 'base'.
  start?: 'base' | 'uniform'
  // From 0 to 1, both excluded. The default is 0.9, as on the JSON side.
  startShare?: number
}

export function createModel(base: RecoveryTables, options: ModelOptions = {}): Model {
  checkTables(base)
  const changeable = (cell: number): boolean => base.open[cell] === 1 && cell % base.terminalCount !== endOfInput
  const maskOf = (chosen: Uint8Array | 'changeable' | 'open' | 'none' | undefined, length: number, mayTrain: (index: number) => boolean, nameOf: (index: number) => string): Uint8Array => {
    if (chosen === undefined || chosen === 'changeable' || chosen === 'open') return Uint8Array.from({length}, (_, index) => mayTrain(index) ? 1 : 0)
    if (chosen === 'none') return new Uint8Array(length)
    if (chosen.length !== length) throw new Error(`createModel got a mask of ${chosen.length} entries for a table of ${length}`)
    for (let index = 0; index < length; index++) {
      if (chosen[index] !== 0 && chosen[index] !== 1) throw new Error(`createModel got a mask with ${chosen[index]} at entry ${index}: a mask holds 1 for a trainable one and 0 for every other one`)
      if (chosen[index] === 1 && !mayTrain(index)) throw new Error(`${nameOf(index)} cannot be trainable: it is frozen, or a cell of the end of input`)
    }
    return chosen.slice()
  }
  if (options.trainable !== undefined && ((options.trainable as {cells?: unknown}).cells === undefined || (options.trainable as {display?: unknown}).display === undefined)) {
    throw new Error('createModel got `trainable` without `cells` or without `display`: name both, each as a mask or as \'changeable\', \'open\' or \'none\'')
  }
  const trainableCells = maskOf(options.trainable?.cells, base.choice.length, changeable, cell => `the cell ${cellName(base, cell)}`)
  const trainableEntries = maskOf(options.trainable?.display, base.display.length, entry => base.displayOpen[entry] === 1, entry => `the display entry ${displayEntryName(base, entry)}`)

  const cellOffset = new Int32Array(base.choice.length).fill(-1)
  const displayOffset = new Int32Array(base.display.length).fill(-1)
  const mixStart: number[] = [], mixOwner: number[] = []
  let logitCount = 0
  for (let cell = 0; cell < trainableCells.length; cell++) {
    if (trainableCells[cell] === 0) continue
    cellOffset[cell] = logitCount
    mixStart.push(logitCount)
    mixOwner.push(cell)
    logitCount += choicesOf(base, cell).length
  }
  const cellMixCount = mixStart.length
  for (let entry = 0; entry < trainableEntries.length; entry++) {
    if (trainableEntries[entry] === 0) continue
    displayOffset[entry] = logitCount
    mixStart.push(logitCount)
    mixOwner.push(entry)
    logitCount += displayKindCount
  }
  mixStart.push(logitCount)
  const layout: Layout = {base: copyTables(base), cellOffset, displayOffset, mixStart: Int32Array.from(mixStart), mixOwner: Int32Array.from(mixOwner), cellMixCount, logitCount}

  const logits = new Float64Array(logitCount)
  const startShare = options.startShare ?? 0.9
  if (!(startShare > 0 && startShare < 1)) throw new Error(`startShare has to be between 0 and 1, and is ${startShare}`)
  if ((options.start ?? 'base') === 'base') {
    for (let mix = 0; mix < mixOwner.length; mix++) {
      const choices = mixStart[mix + 1]! - mixStart[mix]!
      // softmax gives one choice the share s when its logit is ln(s / (1 - s) × (choices - 1)) and the others are 0.
      if (choices > 1) logits[mixStart[mix]! + baseChoiceOf(layout, mix)] = Math.log(startShare / (1 - startShare) * (choices - 1))
    }
  }
  return {layout, logits}
}

// The place of the base tables' choice among the logits of a mix, e.g. 0 for a cell whose base is stop.
function baseChoiceOf(layout: Layout, mix: number): number {
  const owner = layout.mixOwner[mix]!
  return mix < layout.cellMixCount ? choicesOf(layout.base, owner).indexOf(layout.base.choice[owner]!) : layout.base.display[owner]!
}

// Writes every mix into `shares`, which has one entry per logit: the softmax of the mix's logits. A logit of
// -Infinity gives a share of exactly 0, so logits of 0 for one choice and -Infinity for the others give exact tables.
export function sharesInto(layout: Layout, logits: Float64Array, shares: Float64Array) {
  const {mixStart} = layout
  for (let mix = 0; mix < mixStart.length - 1; mix++) {
    const from = mixStart[mix]!, to = mixStart[mix + 1]!
    let largest = -Infinity
    for (let entry = from; entry < to; entry++) if (logits[entry]! > largest) largest = logits[entry]!
    let total = 0
    for (let entry = from; entry < to; entry++) {
      const share = Math.exp(logits[entry]! - largest)
      shares[entry] = share
      total += share
    }
    for (let entry = from; entry < to; entry++) shares[entry] = shares[entry]! / total
  }
}

// Turns gradients by the shares into gradients by the logits and adds them to `logitGradients`: for a mix
// share = softmax(logit), the gradient by logit j is share[j] × (gradient[j] - Σ share[i] × gradient[i]).
export function addLogitGradients(layout: Layout, shares: Float64Array, shareGradients: Float64Array, logitGradients: Float64Array) {
  const {mixStart} = layout
  for (let mix = 0; mix < mixStart.length - 1; mix++) {
    const from = mixStart[mix]!, to = mixStart[mix + 1]!
    let mean = 0
    for (let entry = from; entry < to; entry++) mean += shares[entry]! * shareGradients[entry]!
    for (let entry = from; entry < to; entry++) logitGradients[entry]! += shares[entry]! * (shareGradients[entry]! - mean)
  }
}

// Snapping: a copy of the base tables in which every trainable cell and entry holds the choice with the largest
// logit. Among equal logits the base tables' choice is kept, e.g. in a mix that started uniform and that no sample
// read.
export function snappedTables(model: Model): RecoveryTables {
  const {layout, logits} = model
  const tables = copyTables(layout.base)
  for (let mix = 0; mix < layout.mixOwner.length; mix++) {
    const from = layout.mixStart[mix]!, choices = layout.mixStart[mix + 1]! - from
    let best = baseChoiceOf(layout, mix)
    for (let choice = 0; choice < choices; choice++) if (logits[from + choice]! > logits[from + best]!) best = choice
    const owner = layout.mixOwner[mix]!
    if (mix < layout.cellMixCount) tables.choice[owner] = choicesOf(layout.base, owner)[best]!
    else tables.display[owner] = best
  }
  return tables
}

// Logits that make every mix one choice: 0 for the choice that `tables` hold and -Infinity for the others. A twin
// that is handed them is the exact parser of `tables`. Throws when `tables` differ from the base in a cell or an
// entry that is not trainable, or have another layout.
export function logitsOfTables(layout: Layout, tables: RecoveryTables): Float64Array {
  const {base} = layout
  if (tables.choice.length !== base.choice.length || tables.display.length !== base.display.length || tables.endEarly !== base.endEarly) throw new Error('logitsOfTables got tables of another layout than the model\'s base')
  for (let cell = 0; cell < base.choice.length; cell++) if (layout.cellOffset[cell] === -1 && tables.choice[cell] !== base.choice[cell]) throw new Error(`the cell ${cellName(base, cell)} is not trainable, and the tables hold another choice there than the base`)
  for (let entry = 0; entry < base.display.length; entry++) if (layout.displayOffset[entry] === -1 && tables.display[entry] !== base.display[entry]) throw new Error(`the display entry ${displayEntryName(base, entry)} is not trainable, and the tables hold another kind there than the base`)
  const logits = new Float64Array(layout.logitCount).fill(-Infinity)
  for (let mix = 0; mix < layout.mixOwner.length; mix++) {
    const owner = layout.mixOwner[mix]!
    const choice = mix < layout.cellMixCount ? choicesOf(base, owner).indexOf(tables.choice[owner]!) : tables.display[owner]!
    if (choice < 0) throw new Error(`the cell ${cellName(base, owner)} holds a choice that is not in its list`)
    logits[layout.mixStart[mix]! + choice] = 0
  }
  return logits
}

// How far the mixes are from one choice: the mean of the largest share of a mix, 1 when every mix is one choice.
export function meanLargestShare(layout: Layout, shares: Float64Array): number {
  const mixes = layout.mixOwner.length
  if (mixes === 0) return 1
  let total = 0
  for (let mix = 0; mix < mixes; mix++) {
    let largest = 0
    for (let entry = layout.mixStart[mix]!; entry < layout.mixStart[mix + 1]!; entry++) if (shares[entry]! > largest) largest = shares[entry]!
    total += largest
  }
  return total / mixes
}
