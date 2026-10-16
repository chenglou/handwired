// A worker thread of the search per sample: it runs the search for its share of the samples, every sample whose
// index leaves the remainder `share` when divided by the number of shares, and replies with the most code points
// right of each, in the order of the samples.
import {samplesOfMessage} from '../data.ts'
import {type PerSampleReply, type PerSampleRequest, bestOfSample} from './per-sample.ts'

declare const self: {onmessage: ((event: {data: PerSampleRequest}) => void) | null, postMessage: (reply: PerSampleReply) => void}

self.onmessage = event => {
  const {tables, share, shares, width} = event.data
  const samples = samplesOfMessage(event.data.samples)
  const right: number[] = []
  for (let sample = share; sample < samples.sampleCount; sample += shares) right.push(bestOfSample(samples, sample, tables, width))
  self.postMessage({right: Int32Array.from(right)})
}
