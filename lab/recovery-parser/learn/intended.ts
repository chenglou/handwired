// The intended states of a sample: for every code point of the broken text that the damage kept, the state today's
// parser is in after the code point's counterpart in the original, i.e. where the parser would be if the damage were
// not there. Training uses them as targets, and to put a run back on track after a code point it got wrong.
//
// Each document of a sample is parsed on its own, from the start state, so the first code point of a second document
// has the states of a text's first code point.
//
// Where the intended states are not defined, or cannot be what a parser of the broken text reaches:
// - A code point that the damage added has no counterpart: every array holds -1 there.
// - A replaced code point, e.g. ' for ", has the states of its counterpart, e.g. the event stringStart. The parser
//   reads the class of the code point that is there, here `other`, which the same tokenizer state also reads for
//   every letter without a class of its own. So one choice of that cell cannot be right for both. Sample.replaced
//   marks these code points, and Sample.needsClass the samples.
// - The first kept code point after a removed part has the states after its counterpart, which assume that the
//   removed code points were read. E.g. after a removed closing bracket the intended depth is one lower than the
//   brackets of the broken text give, and after a removed opening quote the intended events are those of a string's
//   content, although nothing in the broken text starts a string. Sample.reachable says whether a parser that reads
//   from left to right can know.
// - The first code point of a second document follows the last one of the first document. Before it, the parser of
//   the broken text is in the grammar state `end`, not in the start state, so the step that the intended states ask
//   for is one that today's tables do not have, e.g. (end, openObject, depth 0) to keyOrClose.
// - A kept code point whose display kind is not scored (Sample.unscoredKinds), e.g. a quote that lost its backslash:
//   its counterpart is part of an escape, so its intended event is `escape`, which no reading of the broken text gives.
//
// Before the first damage the broken text is the original, so there the intended states are the states of today's
// parser on the broken text. check-data.ts checks that, and that the intended depth and container are the labels'.
import type {Sample} from '../samples.ts'
import {runTableParser} from '../table-parser.ts'

export type Intended = {
  // One entry per code point of the broken text, -1 where the damage added the code point.
  lexerStateAfter: Int8Array
  event: Int8Array
  grammarAfter: Int8Array
  // The same numbers as the label's depth and container, here from the parser's trace.
  depthAfter: Int8Array
  containerAfter: Int8Array
}

export function intendedOf(sample: Sample): Intended {
  // The trace of every document, one after another, indexed like the original.
  const lexerStateAfter: number[] = []
  const event: number[] = []
  const grammarAfter: number[] = []
  const depthAfter: number[] = []
  const containerAfter: number[] = []
  for (const document of sample.documents) {
    const trace = runTableParser(document)
    if (!trace.valid) throw new Error(`sample ${sample.id}: today's parser rejects the document ${JSON.stringify(document)}`)
    for (let position = 0; position < trace.length; position++) {
      // The tokenizer state after a code point is the state before the next position.
      lexerStateAfter.push(trace.lexerStateBefore[position + 1]!)
      event.push(trace.event[position]!)
      grammarAfter.push(trace.grammarAfter[position]!)
      depthAfter.push(trace.depthAfter[position]!)
      containerAfter.push(trace.containerAfter[position]!)
    }
  }
  if (sample.alignment.some(index => index >= event.length)) throw new Error(`sample ${sample.id}: its alignment points past the ${event.length} code points of its documents`)
  const along = (values: readonly number[]) => Int8Array.from(sample.alignment, index => index === -1 ? -1 : values[index]!)
  return {lexerStateAfter: along(lexerStateAfter), event: along(event), grammarAfter: along(grammarAfter), depthAfter: along(depthAfter), containerAfter: along(containerAfter)}
}
