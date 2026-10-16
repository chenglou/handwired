// A worker thread of train.ts: it makes the run's twin, runs it on the samples that it is sent, and answers with
// their losses. The samples, the logits and the worker's gradient are in shared memory that the main thread also
// holds, so a task only carries the places of its samples.
import {parentPort, workerData} from 'node:worker_threads'
import {type messageOf, samplesOfMessage} from '../data.ts'
import type {Layout} from './model.ts'
import {type LossTally, type TwinChoice, createTally, loadTwin} from './twin.ts'

export type WorkerSetup = {
  layout: Layout
  twin: TwinChoice
  samples: ReturnType<typeof messageOf>
  // The logits, which the main thread writes before each task, and this worker's gradient by the logits.
  logitsBuffer: SharedArrayBuffer
  gradientBuffer: SharedArrayBuffer
}
export type WorkerTask = {places: Int32Array, withGradient: boolean}
// The worker says 'ready' once, when its twin is made, and then answers every task with a tally.
export type WorkerAnswer = 'ready' | LossTally

if (parentPort !== null) {
  const port = parentPort
  const setup = workerData as WorkerSetup
  const twin = await loadTwin(setup.twin, setup.layout)
  const samples = samplesOfMessage(setup.samples)
  const logits = new Float64Array(setup.logitsBuffer, 0, setup.layout.logitCount), gradient = new Float64Array(setup.gradientBuffer, 0, setup.layout.logitCount)
  port.on('message', (task: WorkerTask) => {
    const tally = createTally()
    if (task.withGradient) gradient.fill(0)
    twin.run(logits, samples, task.places, tally, task.withGradient ? gradient : null)
    port.postMessage(tally satisfies WorkerAnswer)
  })
  port.postMessage('ready' satisfies WorkerAnswer)
}
