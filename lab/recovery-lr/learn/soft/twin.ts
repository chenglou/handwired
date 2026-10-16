// What a twin of the recovery parser is to the trainer and to the checks: the logits of the trainable cells in,
// the loss and its gradient out.
//
// A twin runs samples from their first error on, as ../score.ts does, but with a mix in every trainable cell and
// entry: the softmax of the cell's logits, see model.ts. What it shows for a token is then a mix too: a share per
// display kind, per depth and per container. The loss is the cross-entropy of the three against the labels of the
// token's kept code points, as on the JSON side.
//
// Two twins can stand behind this interface: the weighted set of exact stacks of stacks-twin.ts, which is the
// reference, and a twin that holds a mix of states per level of the stack. The trainer (train.ts) and the checks
// take a twin as the path of a module that exports `createTwin`, a TwinFactory.
import {containerCount, displayKindCount} from '../../labels.ts'
import type {PackedSamples} from '../data.ts'
import {maximumStackHeight} from '../recovery-tables.ts'
import type {Layout} from './model.ts'

// A share's cross-entropy is -ln(share + lossFloor), so a share of exactly 0 costs 13.8 and not infinity.
export const lossFloor = 1e-6

// What runs add up.
export type LossTally = {
  samples: number
  // The scored code points of the samples: the kept ones from the first error's token on. A loss per code point is
  // `loss / codePoints`.
  codePoints: number
  // The sum over the scored code points of the three cross-entropies, and its three parts.
  loss: number
  kindLoss: number
  depthLoss: number
  containerLoss: number
  // The labels, counted per code point, whose share is exactly 0. Each costs 13.8.
  labelsWithoutShare: number
  // What a twin counts about its own work, by name, e.g. `tokens` and `stacksKept` for the twin of exact stacks.
  // The trainer adds them up and prints them, and reads nothing into them.
  counters: Record<string, number>
}
export const createTally = (): LossTally => ({samples: 0, codePoints: 0, loss: 0, kindLoss: 0, depthLoss: 0, containerLoss: 0, labelsWithoutShare: 0, counters: {}})
export function addTally(total: LossTally, part: LossTally) {
  total.samples += part.samples
  total.codePoints += part.codePoints
  total.loss += part.loss
  total.kindLoss += part.kindLoss
  total.depthLoss += part.depthLoss
  total.containerLoss += part.containerLoss
  total.labelsWithoutShare += part.labelsWithoutShare
  for (const [name, count] of Object.entries(part.counters)) total.counters[name] = (total.counters[name] ?? 0) + count
}

// What a twin shows for the tokens of one sample: for packed token t of the sample, counted from the first error's
// token, the share of display kind k is kind[t × displayKindCount + k], of depth d depth[t × readingDepthCount + d],
// and of container c container[t × containerCount + c]. The end of input has no row: nothing is shown for it.
// With exact tables every share is exactly 0 or 1.
export const readingDepthCount = maximumStackHeight + 1
export type Reading = {tokenCount: number, kind: Float64Array, depth: Float64Array, container: Float64Array}
// A reading with room for the tokens of the longest sample: 512 code points give at most 512 tokens.
export const createReading = (mostTokens = 513): Reading =>
  ({tokenCount: 0, kind: new Float64Array(mostTokens * displayKindCount), depth: new Float64Array(mostTokens * readingDepthCount), container: new Float64Array(mostTokens * containerCount)})

export type Twin = {
  // What the twin is, for a log, e.g. "48 exact stacks".
  name: string
  // Runs the samples at `places` of `samples`, each from the stack at its first open cell to its last token, with
  // the mix softmax(logits) in every trainable cell and entry of the twin's layout.
  // - `logits` has layout.logitCount entries, in the order of the layout, see model.ts.
  // - The losses of the samples are added to `tally`: sums, not divided by anything.
  // - With `gradient`, which has one entry per logit, the gradient of the summed loss by every logit is added to
  //   it. The caller clears it.
  // - With `reading`, `places` has to hold one sample, and the reading is filled with what the twin shows for it.
  // The samples have to be packed for the added terminals of the layout's base tables. The end of input takes no
  // step in a twin: no label asks what happens there.
  run: (logits: Float64Array, samples: PackedSamples, places: ArrayLike<number>, tally: LossTally, gradient?: Float64Array | null, reading?: Reading | null) => void
}

// Settings of a twin by name, e.g. {width: 48} for the twin of exact stacks. A twin ignores names that it does not
// have. They are numbers so that they pass to a worker thread as they are.
export type TwinOptions = Record<string, number>

// What the module of a twin exports as `createTwin`. A twin holds no logits: it is made once per thread for a
// layout and is handed the logits with every call of `run`.
export type TwinFactory = (layout: Layout, options?: TwinOptions) => Twin
export type TwinModule = {createTwin: TwinFactory}

// Which twin a run uses: the path or the URL of its module, and its settings.
export type TwinChoice = {module: string, options?: TwinOptions}
export const referenceTwin: TwinChoice = {module: new URL('./stacks-twin.ts', import.meta.url).href}
export async function loadTwin(choice: TwinChoice, layout: Layout): Promise<Twin> {
  const module = await import(choice.module) as Partial<TwinModule>
  if (typeof module.createTwin !== 'function') throw new Error(`${choice.module} exports no function createTwin`)
  return module.createTwin(layout, choice.options)
}
