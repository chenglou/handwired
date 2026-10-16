// HELD BACK: do not read this folder if you build the parser, the train data, the training or its machinery. See
// ../README.md.
//
// The counting of the recount, written from the words of the final report and of ../README.md, with no import from
// ../final/:
//
// - A scored code point is one from the first error of the parser as it is on whose label has a scored value.
// - It is right when every scored value of its label is what the parser shows: the display kind, the depth after the
//   code point and the container after it ("all three").
// - A text is whole when it has a scored code point and all of them are right.
// - An added code point is one that the damage put into the text. It has no label, and the count is of how many of
//   them a parser shows as the display kind `error`, anywhere in the text.
import {displayKind} from '../../kinds.ts'
import type {Show, Shown} from './parsers.ts'
import type {BrokenText} from './texts.ts'

// The fields have the names of the final scoring's file of counts, so that the two can be held against each other.
export const countFields = ['texts', 'nothingToRecover', 'scored', 'right', 'whole', 'kindScored', 'kindRight', 'nestingScored', 'depthRight', 'containerRight', 'added', 'addedShownAsError'] as const
export type CountField = typeof countFields[number]
export type Counts = Record<CountField, number>
export const noCounts = (): Counts => ({texts: 0, nothingToRecover: 0, scored: 0, right: 0, whole: 0, kindScored: 0, kindRight: 0, nestingScored: 0, depthRight: 0, containerRight: 0, added: 0, addedShownAsError: 0})

// Per display kind of the label: the scored code points, those with every scored value right, and those with the
// display kind right. The last entry is of the labels whose display kind is not scored.
export const labelKindNames = [...Object.keys(displayKind), 'the display kind is not scored']
export type LabelKindCounts = {scored: number, right: number, kindRight: number}

export type CountsOfText = {counts: Counts, perLabelKind: LabelKindCounts[]}

export function countText(text: BrokenText, shown: Shown): CountsOfText {
  const counts = noCounts()
  counts.texts = 1
  const perLabelKind: LabelKindCounts[] = labelKindNames.map(() => ({scored: 0, right: 0, kindRight: 0}))
  for (let position = 0; position < text.codePoints.length; position++) {
    if (!text.addedByDamage[position]!) continue
    counts.added++
    if (shown.displayKind[position] === displayKind.error) counts.addedShownAsError++
  }
  const firstScoredPosition = text.firstErrorPosition === -1 ? text.codePoints.length : text.firstErrorPosition
  for (let position = firstScoredPosition; position < text.codePoints.length; position++) {
    const label = text.labels[position]
    if (label === undefined) continue
    const kindIsScored = label.kind !== undefined
    const nestingIsScored = label.depth !== undefined
    if (nestingIsScored !== (label.container !== undefined)) throw new Error(`${text.id}: a label scores the depth without the container, or the container without the depth, at ${position}`)
    if (!kindIsScored && !nestingIsScored) continue
    const kindIsRight = !kindIsScored || shown.displayKind[position] === label.kind
    const depthIsRight = !nestingIsScored || shown.depthAfter[position] === label.depth
    const containerIsRight = !nestingIsScored || shown.containerAfter[position] === label.container
    const allAreRight = kindIsRight && depthIsRight && containerIsRight
    counts.scored++
    if (allAreRight) counts.right++
    if (kindIsScored) {
      counts.kindScored++
      if (kindIsRight) counts.kindRight++
    }
    if (nestingIsScored) {
      counts.nestingScored++
      if (depthIsRight) counts.depthRight++
      if (containerIsRight) counts.containerRight++
    }
    const ofLabelKind = perLabelKind[label.kind ?? labelKindNames.length - 1]!
    ofLabelKind.scored++
    if (allAreRight) ofLabelKind.right++
    if (kindIsRight) ofLabelKind.kindRight++
  }
  if (counts.scored === 0) counts.nothingToRecover = 1
  else if (counts.right === counts.scored) counts.whole = 1
  return {counts, perLabelKind}
}

// What one parser has on one set: the counts of every row, the counts per display kind of the label over the texts
// of the set's main row, and per text the scored and the right code points.
export type CountsOfSet = {
  rows: Map<string, Counts>
  perLabelKind: LabelKindCounts[]
  scoredPerText: number[]
  rightPerText: number[]
}

export function countSet(texts: readonly BrokenText[], mainRow: string, show: Show): CountsOfSet {
  const result: CountsOfSet = {rows: new Map(), perLabelKind: labelKindNames.map(() => ({scored: 0, right: 0, kindRight: 0})), scoredPerText: [], rightPerText: []}
  for (const text of texts) {
    const ofText = countText(text, show(text.codePoints))
    result.scoredPerText.push(ofText.counts.scored)
    result.rightPerText.push(ofText.counts.right)
    for (const rowName of text.rowNames) {
      let row = result.rows.get(rowName)
      if (row === undefined) result.rows.set(rowName, row = noCounts())
      for (const field of countFields) row[field] += ofText.counts[field]
    }
    if (!text.rowNames.includes(mainRow)) continue
    ofText.perLabelKind.forEach((ofLabelKind, kind) => {
      result.perLabelKind[kind]!.scored += ofLabelKind.scored
      result.perLabelKind[kind]!.right += ofLabelKind.right
      result.perLabelKind[kind]!.kindRight += ofLabelKind.kindRight
    })
  }
  return result
}

// At how many code points two ways to show a text differ, in any of the three values.
export function differingCodePoints(codePoints: readonly number[], first: Shown, second: Shown): number {
  let differing = 0
  for (let position = 0; position < codePoints.length; position++) {
    if (first.displayKind[position] !== second.displayKind[position] || first.depthAfter[position] !== second.depthAfter[position] || first.containerAfter[position] !== second.containerAfter[position]) differing++
  }
  return differing
}

// "All three" and "whole" of a row in percent.
export const allThreeOf = (row: Counts) => 100 * row.right / row.scored
export const wholeOf = (row: Counts) => 100 * row.whole / (row.texts - row.nothingToRecover)
