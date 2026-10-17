// Runs the column and pixel shaders (wgsl.ts) on WebGPU: per frame, the host writes the column program's source cells,
// one pass runs every column and writes its record, a second runs every pixel on its column's record, and the pixels
// come back for the page to show. For the page's x-ray, the probe shader can take the second pass's place, compiled the
// first time it is asked for, and the values of the operation it picks come back instead.
import {type Binding, type StageShader, bindings} from './wgsl.ts'

// WebGPU's constants, from the WebGPU specification, since TypeScript's DOM library declares the types and not these
// values.
const BufferUsage = {MAP_READ: 0x0001, COPY_SRC: 0x0004, COPY_DST: 0x0008, UNIFORM: 0x0040, STORAGE: 0x0080} as const
const MapMode = {READ: 0x0001} as const

// How compiling goes, stage by stage, as the page shows it.
export type StageState = 'waiting' | 'compiling' | 'ready' | 'failed'
type GpuProgress = {
  adapter: (name: string) => void
  stage: (index: number, state: StageState, ms: number) => void
  // The device is gone, e.g. the GPU reset, once the shaders were ready: why.
  lost: (message: string) => void
}

export type GpuColumns = Awaited<ReturnType<typeof createGpuColumns>>

export async function createGpuColumns(
  shaders: {columns: StageShader, pixels: StageShader},
  shape: {width: number, height: number, recordSize: number},
  progress: GpuProgress,
) {
  const gpu = (globalThis.navigator as Navigator | undefined)?.gpu
  if (gpu === undefined) throw new Error('this browser has no WebGPU')
  const adapter = await gpu.requestAdapter({powerPreference: 'high-performance'})
  if (adapter === null) throw new Error('this browser has no WebGPU adapter')
  const adapterName = adapter.info.description === '' ? adapter.info.vendor : adapter.info.description
  progress.adapter(adapterName)
  const stages = [shaders.columns, shaders.pixels]
  const recordBytes = shape.width * shape.recordSize * 4
  const largest = Math.max(recordBytes, ...stages.flatMap(shader => [shader.constants.byteLength, shader.positions.byteLength, shader.staticsSize * 4]))
  // WebGPU's default limits, 128 MiB per storage binding and 256 MiB per buffer, raised as far as the adapter allows
  // when a buffer needs more.
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, Math.max(134_217_728, largest)),
      maxBufferSize: Math.min(adapter.limits.maxBufferSize, Math.max(268_435_456, largest)),
    },
  })
  device.pushErrorScope('validation')
  const buffer = (size: number, usage: number) => device.createBuffer({size: Math.max(16, Math.ceil(size / 4) * 4), usage})
  const records = buffer(recordBytes, BufferUsage.STORAGE)
  const outputBytes = shape.width * shape.height * 4
  const output = buffer(outputBytes, BufferUsage.STORAGE | BufferUsage.COPY_SRC)
  // The operation the probe shader writes, which the host writes per frame.
  const probe = buffer(16, BufferUsage.UNIFORM | BufferUsage.COPY_DST)
  // A readback buffer per frame in flight, made as frames overlap and kept for the next.
  const readbacks: GPUBuffer[] = []
  // A stage's shader compiled, with its own statics, constants and positions bound.
  type Stage = {shader: StageShader, pipeline: GPUComputePipeline, bindGroup: GPUBindGroup, statics: GPUBuffer}
  const compileStage = async (shader: StageShader): Promise<Stage> => {
    const statics = buffer(shader.staticsSize * 4, BufferUsage.STORAGE | BufferUsage.COPY_DST)
    const constants = buffer(shader.constants.byteLength, BufferUsage.STORAGE | BufferUsage.COPY_DST)
    const positions = buffer(shader.positions.byteLength, BufferUsage.STORAGE | BufferUsage.COPY_DST)
    try {
      device.queue.writeBuffer(statics, (shader.staticsSize - shader.staticsConstants.length) * 4, shader.staticsConstants)
      device.queue.writeBuffer(constants, 0, shader.constants)
      device.queue.writeBuffer(positions, 0, shader.positions)
      const byBinding: Record<Binding, GPUBuffer> = {statics, constants, positions, records, output, probe}
      const module = device.createShaderModule({code: shader.code, label: shader.name})
      const info = await module.getCompilationInfo()
      const errors = info.messages.filter(message => message.type === 'error')
      if (errors.length > 0) {
        throw new Error(`the ${shader.name} shader doesn't compile: ${errors.slice(0, 3).map(message => `${message.lineNum}:${message.linePos} ${message.message}`).join('; ')}`)
      }
      const pipeline = await device.createComputePipelineAsync({layout: 'auto', compute: {module, entryPoint: 'main'}, label: shader.name})
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: shader.uses.map(binding => ({binding: bindings.indexOf(binding), resource: {buffer: byBinding[binding]}})),
      })
      return {shader, pipeline, bindGroup, statics}
    } catch (error) {
      for (const stageBuffer of [statics, constants, positions]) stageBuffer.destroy()
      throw error
    }
  }
  // Compiles stages inside an error scope, which catches what the calls themselves don't report, e.g. a bind group
  // that doesn't match its layout. The scope is the device's, so it also catches errors of frames submitted meanwhile.
  const scoped = async <Result>(compile: () => Promise<Result>) => {
    device.pushErrorScope('validation')
    const settled = await compile().then(result => ({ok: true as const, result}), (error: unknown) => ({ok: false as const, error}))
    const failure = await device.popErrorScope()
    if (!settled.ok) throw settled.error
    if (failure !== null) throw new Error(`WebGPU validation error: ${failure.message}`)
    return settled.result
  }

  // Both shaders compile at once, and each reports when it is ready. If either fails, the device goes with them.
  const started = performance.now()
  stages.forEach((_, index) => progress.stage(index, 'compiling', 0))
  let compiled: [Stage, Stage]
  try {
    compiled = await scoped(() => Promise.all(stages.map(async (shader, index) => {
      try {
        const stage = await compileStage(shader)
        progress.stage(index, 'ready', performance.now() - started)
        return stage
      } catch (error) {
        progress.stage(index, 'failed', performance.now() - started)
        throw error
      }
    })) as Promise<[Stage, Stage]>)
  } catch (error) {
    device.destroy()
    throw error
  }
  // The shared buffers' scope, pushed before they were made.
  const failure = await device.popErrorScope()
  if (failure !== null) {
    device.destroy()
    throw new Error(`WebGPU validation error: ${failure.message}`)
  }
  const [columnStage, pixelStage] = compiled
  let lost = false
  void device.lost.then(info => {
    lost = true
    progress.lost(info.message === '' ? `the device was lost (${info.reason})` : info.message)
  })
  let probeStage: Stage | null = null

  // Runs the column pass and then `second` on the source cells, and reads the output back into `into`. Frames can
  // overlap: the queue runs each frame's writes, passes and copy in order, so the next frame's passes wait for this
  // one's copy.
  const run = async <View extends Uint8Array | Float32Array>(source: Float32Array, second: Stage, into: View, read: (mapped: ArrayBuffer) => ArrayLike<number>) => {
    const readback = readbacks.pop() ?? buffer(outputBytes, BufferUsage.MAP_READ | BufferUsage.COPY_DST)
    device.queue.writeBuffer(columnStage.statics, 0, source)
    const encoder = device.createCommandEncoder()
    for (const stage of [columnStage, second]) {
      const pass = encoder.beginComputePass()
      pass.setPipeline(stage.pipeline)
      pass.setBindGroup(0, stage.bindGroup)
      pass.dispatchWorkgroups(Math.ceil(stage.shader.invocations / stage.shader.workgroupSize))
      pass.end()
    }
    encoder.copyBufferToBuffer(output, 0, readback, 0, outputBytes)
    device.queue.submit([encoder.finish()])
    await readback.mapAsync(MapMode.READ)
    into.set(read(readback.getMappedRange()))
    readback.unmap()
    readbacks.push(readback)
    return into
  }

  return {
    get lost() {
      return lost
    },
    // The view as palette indices, row-major, from the column program's source cells.
    render(source: Float32Array, into = new Uint8Array(shape.width * shape.height)) {
      return run(source, pixelStage, into, mapped => new Uint32Array(mapped))
    },
    // Compiles the probe shader, once; the time it took.
    async addProbe(shader: StageShader) {
      const probeStarted = performance.now()
      probeStage = await scoped(() => compileStage(shader))
      return performance.now() - probeStarted
    },
    // The values of the pixel program's operation at index `operation` at every pixel, row-major, from the column
    // program's source cells, once the probe shader is compiled.
    probe(source: Float32Array, operation: number, into = new Float32Array(shape.width * shape.height)) {
      if (probeStage === null) throw new Error('the probe shader is not compiled')
      device.queue.writeBuffer(probe, 0, Uint32Array.of(operation))
      return run(source, probeStage, into, mapped => new Float32Array(mapped))
    },
  }
}
