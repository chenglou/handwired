// A worker thread of train.ts: it runs the twin on the samples it is sent and adds up their loss and gradients. The
// samples, the mixes and the gradients are in SharedArrayBuffers that the main thread also holds, so a task only
// carries the places of its samples.
import {parentPort, workerData} from 'node:worker_threads'
import {type LossOptions, type LossTally, type TwinData, type TwinShape, createCellArrays, createTwinRunner, runBatch} from './twin.ts'

export type WorkerSetup = {
  shape: TwinShape
  data: TwinData
  depthLow: number
  depthHigh: number
  // The mixes of every cell, which the main thread writes before each task, and this worker's gradients by the mixes.
  mixesBuffer: SharedArrayBuffer
  gradientsBuffer: SharedArrayBuffer
}
export type WorkerTask = {places: Int32Array, options: LossOptions, withGradients: boolean}
export type WorkerAnswer = LossTally

if (parentPort !== null) {
  const port = parentPort
  const setup = workerData as WorkerSetup
  const runner = createTwinRunner(setup.shape, setup.depthLow, setup.depthHigh)
  const gradients = createCellArrays(setup.shape, setup.gradientsBuffer)
  runner.setMixes(createCellArrays(setup.shape, setup.mixesBuffer))
  port.on('message', (task: WorkerTask) => {
    if (task.withGradients) gradients.all.fill(0)
    const answer: WorkerAnswer = runBatch(runner, setup.data, task.places, 0, task.places.length, task.options, task.withGradients ? gradients : undefined)
    port.postMessage(answer)
  })
}
