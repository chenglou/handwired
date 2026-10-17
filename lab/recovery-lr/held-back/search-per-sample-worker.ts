// HELD BACK, see README.md. A worker thread of search-per-sample.ts: it runs the search of that file for the
// samples that it is sent, and replies with the best run of each, in their order.
import {type BestRunsReply, type BestRunsRequest, bestOfSample} from './search-per-sample.ts'

declare const self: {onmessage: ((event: {data: BestRunsRequest}) => void) | null, postMessage: (reply: BestRunsReply) => void}

self.onmessage = event => {
  const {samples, tables, width} = event.data
  self.postMessage({best: samples.map(sample => bestOfSample(sample, tables, width))})
}
