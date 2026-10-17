// General-purpose batched WebGPU execution for Handwired circuits.
// This is an interpreter kernel over serialized operations, not JSON-search-specific code.
import {type Circuit, invariant, type Wire} from './numeric-ui-core.ts'
import {circuitWgsl} from './webgpu-shader.ts'
import {emitSpecializedWgsl} from './webgpu-specialize.ts'

const Usage = {MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128} as const
const MapMode = {READ: 1} as const
const operationStride = 48
const termStride = 8
const workgroupSize = 64

type PipelineCache = {source: string, layout: GPUBindGroupLayout, pipeline: GPUComputePipeline}
const specializedPipelines = new WeakMap<GPUDevice, WeakMap<Circuit, PipelineCache>>()

export type StateUpdate = {source: number, from: Wire}
export type WebGpuOptions = {
  device?: GPUDevice
  mode?: 'auto' | 'gpu' | 'cpu'
  capacity?: number
  strategy?: 'monolithic' | 'layers' | 'specialized'
  numericPolicy?: 'hardware-f32' | 'reference-exact'
}

type PackedCircuit = {
  operations: Uint8Array
  terms: Uint8Array
  candidates: Uint32Array
}

function serialize(circuit: Circuit): PackedCircuit {
  const operations = new ArrayBuffer(Math.max(operationStride, circuit.operations.length * operationStride))
  const opView = new DataView(operations)
  const terms: [number, number][] = []
  const candidates: number[] = []
  const tableOffsets = new Map<number, number>()
  for (let index = 0; index < circuit.operations.length; index++) {
    const operation = circuit.operations[index]!
    const start = index * operationStride
    const leftStart = terms.length
    for (const [wire, coefficient] of operation.leftTerms) terms.push([wire, Math.fround(coefficient)])
    const gateStart = terms.length
    for (const [wire, coefficient] of operation.gateTerms) terms.push([wire, Math.fround(coefficient)])
    const table = operation.indexRead?.table.candidates ?? []
    let candidateStart = 0
    if (operation.indexRead !== undefined) {
      const tableId = operation.indexRead.table.id
      const reused = tableOffsets.get(tableId)
      if (reused !== undefined) {
        candidateStart = reused
      } else {
        candidateStart = candidates.length
        tableOffsets.set(tableId, candidateStart)
        for (const wire of table) candidates.push(wire)
      }
    }
    const kind = {affine: 0, reglu: 1, boolean: 2, index: 3}[operation.kind]
    const fields: readonly (readonly [number, number])[] = [
      [0, kind], [4, leftStart], [8, operation.leftTerms.length],
      [12, gateStart], [16, operation.gateTerms.length],
      [20, candidateStart], [24, table.length],
      [28, (operation.indexRead?.below === 'zero' ? 1 : 0)
        | (operation.indexRead?.above === 'zero' ? 2 : 0)],
    ]
    for (const [offset, value] of fields) opView.setUint32(start + offset, value, true)
    opView.setFloat32(start + 32, operation.leftBias, true)
    opView.setFloat32(start + 36, operation.gateBias, true)
  }
  const termBytes = new ArrayBuffer(Math.max(termStride, terms.length * termStride))
  const termView = new DataView(termBytes)
  for (let index = 0; index < terms.length; index++) {
    termView.setUint32(index * termStride, terms[index]![0], true)
    termView.setFloat32(index * termStride + 4, terms[index]![1], true)
  }
  return {
    operations: new Uint8Array(operations),
    terms: new Uint8Array(termBytes),
    candidates: Uint32Array.from(candidates.length ? candidates : [0]),
  }
}

export class WebGpuCircuitEvaluator {
  readonly mode: 'gpu' | 'cpu'
  readonly capacity: number
  readonly sourceSize: number
  readonly width: number
  readonly strategy: 'monolithic' | 'layers' | 'specialized'
  readonly layerCount: number
  private readonly layerRanges: {start: number, count: number}[]
  private readonly layerIndices: Uint32Array
  private count = 0
  private hasRun = false
  private disposed = false
  private loss: string | null = null
  fallbackReason: string | null = null
  specializedCacheHit = false
  private readonly buffers: GPUBuffer[] = []
  private sourceBuffer?: GPUBuffer
  private valueBuffer?: GPUBuffer
  private stateBuffer?: GPUBuffer
  private parameterBuffer?: GPUBuffer
  private bindGroup?: GPUBindGroup
  private executePipeline?: GPUComputePipeline
  private advancePipeline?: GPUComputePipeline
  private loadPipeline?: GPUComputePipeline
  private layerPipeline?: GPUComputePipeline
  private readonly layerUniforms: GPUBuffer[] = []
  private readonly layerGroups: GPUBindGroup[] = []
  private sources: Float32Array
  private values: Float32Array

  private constructor(private readonly circuit: Circuit,
    private readonly device: GPUDevice | undefined, capacity: number,
    strategy: 'monolithic' | 'layers' | 'specialized') {
    this.capacity = capacity
    this.strategy = strategy
    const depthMap = new Map<number, number[]>()
    for (let index = 0; index < circuit.operations.length; index++) {
      const operation = circuit.operations[index]!
      const list = depthMap.get(operation.depth) ?? []
      list.push(index)
      depthMap.set(operation.depth, list)
    }
    const indices: number[] = []
    this.layerRanges = Array.from(depthMap).sort(([a], [b]) => a - b).map(([, group]) => {
      const range = {start: indices.length, count: group.length}
      indices.push(...group)
      return range
    })
    this.layerIndices = Uint32Array.from(indices.length > 0 ? indices : [0])
    this.layerCount = this.layerRanges.length
    this.mode = device ? 'gpu' : 'cpu'
    this.sourceSize = circuit.sourceSize
    this.width = circuit.sourceSize + circuit.operations.length
    this.sources = new Float32Array(capacity * this.sourceSize)
    this.values = new Float32Array(capacity * this.width)
  }

  static async create(circuit: Circuit, options: WebGpuOptions = {}): Promise<WebGpuCircuitEvaluator> {
    const capacity = options.capacity ?? 256
    const strategy = options.strategy ?? 'monolithic'
    const exact = options.numericPolicy === 'reference-exact'
    invariant(options.numericPolicy === undefined || options.numericPolicy === 'hardware-f32' || exact,
      'invalid numerical policy')
    invariant(!(exact && options.mode === 'gpu'), 'reference-exact semantics require CPU execution')
    invariant(Number.isSafeInteger(capacity) && capacity > 0, 'capacity must be a positive integer')
    const width = circuit.sourceSize + circuit.operations.length
    invariant(width > 0, 'cannot execute an empty circuit')
    invariant(width * capacity <= 0x3fffffff, 'batch exceeds supported buffer size')
    let device = (options.mode === 'cpu' || exact) ? undefined : options.device
    let fallbackReason: string | null = exact ? 'reference-exact semantics require CPU' : null
    if (options.mode !== 'cpu' && !exact && device === undefined) {
      try {
        const gpu = typeof navigator !== 'undefined' ? navigator.gpu : undefined
        const adapter = gpu === undefined ? null : await gpu.requestAdapter()
        device = (await adapter?.requestDevice()) ?? undefined
        if (device === undefined) fallbackReason = 'WebGPU adapter/device unavailable'
      } catch (error) {
        if (options.mode === 'gpu') throw error
        fallbackReason = String(error)
      }
    }
    if (device === undefined && options.mode === 'gpu') throw new Error('WebGPU adapter/device unavailable')
    const evaluator = new WebGpuCircuitEvaluator(circuit, device, capacity, strategy)
    evaluator.fallbackReason = fallbackReason
    if (device !== undefined) {
      try {
        await evaluator.initializeGpu(device)
      } catch (error) {
        evaluator.destroy()
        if (options.mode === 'gpu') throw error
        const fallback = new WebGpuCircuitEvaluator(circuit, undefined, capacity, strategy)
        fallback.fallbackReason = String(error)
        return fallback
      }
    }
    return evaluator
  }

  private buffer(bytes: number, usage: number): GPUBuffer {
    const device = this.device!
    const buffer = device.createBuffer({size: Math.max(4, bytes), usage})
    this.buffers.push(buffer)
    return buffer
  }

  private async initializeGpu(device: GPUDevice): Promise<void> {
    const packed = serialize(this.circuit)
    const sourceBytes = this.capacity * this.sourceSize * 4
    const valueBytes = this.capacity * this.width * 4
    for (const bytes of [sourceBytes, valueBytes, packed.operations.byteLength,
      packed.terms.byteLength, packed.candidates.byteLength, this.sourceSize * 4,
      this.layerIndices.byteLength]) {
      if (Math.max(4, bytes) > device.limits.maxStorageBufferBindingSize ||
        Math.max(4, bytes) > device.limits.maxBufferSize) {
        throw new Error('GPU storage binding limit exceeded; use a smaller capacity')
      }
    }
    this.parameterBuffer = this.buffer(32, Usage.UNIFORM | Usage.COPY_DST)
    this.sourceBuffer = this.buffer(sourceBytes, Usage.STORAGE | Usage.COPY_DST)
    this.valueBuffer = this.buffer(valueBytes, Usage.STORAGE | Usage.COPY_SRC)
    const operationBuffer = this.buffer(packed.operations.byteLength, Usage.STORAGE | Usage.COPY_DST)
    const termBuffer = this.buffer(packed.terms.byteLength, Usage.STORAGE | Usage.COPY_DST)
    const candidateBuffer = this.buffer(packed.candidates.byteLength, Usage.STORAGE | Usage.COPY_DST)
    this.stateBuffer = this.buffer(this.sourceSize * 4, Usage.STORAGE | Usage.COPY_DST)
    const layerOrderBuffer = this.buffer(this.layerIndices.byteLength, Usage.STORAGE | Usage.COPY_DST)
    const gpuBuffers = [this.parameterBuffer, this.sourceBuffer, this.valueBuffer,
      operationBuffer, termBuffer, candidateBuffer, this.stateBuffer, layerOrderBuffer]
    device.queue.writeBuffer(operationBuffer, 0, packed.operations)
    device.queue.writeBuffer(termBuffer, 0, packed.terms)
    device.queue.writeBuffer(candidateBuffer, 0, packed.candidates)
    device.queue.writeBuffer(layerOrderBuffer, 0, this.layerIndices)
    const module = device.createShaderModule({code: circuitWgsl, label: 'Handwired operation interpreter'})
    const messages = (await module.getCompilationInfo()).messages.filter(message => message.type === 'error')
    if (messages.length) throw new Error('WGSL compilation failed: ' +
      messages.map(message => message.lineNum + ': ' + message.message).join('; '))
    const specializedSource = this.strategy === 'specialized' ? emitSpecializedWgsl(this.circuit) : undefined
    const cached = specializedSource === undefined ? undefined : specializedPipelines.get(device)?.get(this.circuit)
    const cacheEntry = cached?.source === specializedSource ? cached : undefined
    const layout = cacheEntry?.layout ?? device.createBindGroupLayout({entries: gpuBuffers.map((_, binding) => ({
      binding, visibility: 4, // GPUShaderStage.COMPUTE
      buffer: {type: binding === 0 ? 'uniform' : binding <= 2 ? 'storage' : 'read-only-storage'},
    }))})
    const pipelineLayout = device.createPipelineLayout({bindGroupLayouts: [layout]})
    this.executePipeline = await device.createComputePipelineAsync({
      layout: pipelineLayout, compute: {module, entryPoint: 'execute'},
    })
    if (specializedSource !== undefined) {
      if (cacheEntry !== undefined) {
        this.executePipeline = cacheEntry.pipeline
        this.specializedCacheHit = true
      } else {
        const specializedModule = device.createShaderModule({code: specializedSource, label:'Handwired specialized WGSL'})
        const errors = (await specializedModule.getCompilationInfo()).messages.filter(message=>message.type === 'error')
        if (errors.length) throw new Error('Specialized WGSL compilation failed: ' +
          errors.map(message => message.lineNum + ': ' + message.message).join('; '))
        this.executePipeline = await device.createComputePipelineAsync({
          layout: pipelineLayout, compute: {module:specializedModule, entryPoint:'executeSpecialized'},
        })
        let perDevice = specializedPipelines.get(device)
        if (perDevice === undefined) {
          perDevice = new WeakMap()
          specializedPipelines.set(device,perDevice)
        }
        perDevice.set(this.circuit,{source:specializedSource, layout, pipeline:this.executePipeline})
      }
    }
    this.advancePipeline = await device.createComputePipelineAsync({
      layout: pipelineLayout, compute: {module, entryPoint: 'advanceState'},
    })
    if (this.strategy === 'layers') {
      this.loadPipeline = await device.createComputePipelineAsync({
        layout: pipelineLayout, compute: {module, entryPoint: 'loadSources'},
      })
      this.layerPipeline = await device.createComputePipelineAsync({
        layout: pipelineLayout, compute: {module, entryPoint: 'executeLayer'},
      })
    }
    this.bindGroup = device.createBindGroup({
      layout,
      entries: gpuBuffers.map((buffer, binding) => ({binding, resource: {buffer}})),
    })
    if (this.strategy === 'layers') {
      for (const range of this.layerRanges) {
        const uniform = this.buffer(32, Usage.UNIFORM | Usage.COPY_DST)
        this.layerUniforms.push(uniform)
        this.layerGroups.push(device.createBindGroup({layout,
          entries: [uniform, ...gpuBuffers.slice(1)].map((buffer, binding) => ({binding, resource: {buffer}})),
        }))
        device.queue.writeBuffer(uniform, 0, new Uint32Array([
          0, this.sourceSize, this.width, this.circuit.operations.length, range.start, range.count, 0, 0,
        ]))
      }
    }
    void device.lost.then(info => {this.loss = info.message.length > 0 ? info.message : info.reason})
  }

  private ensureActive(): void {
    if (this.disposed) throw new Error('WebGPU evaluator already destroyed')
    if (this.circuit.operations.length + this.sourceSize !== this.width) {
      throw new Error('circuit operation count changed after backend initialization')
    }
    if (this.loss !== null) throw new Error('WebGPU device lost: ' + this.loss)
  }

  load(input: Float32Array, batchSize?: number): void {
    this.ensureActive()
    const count = batchSize ?? (this.sourceSize === 0 ? 0 : input.length / this.sourceSize)
    invariant(Number.isSafeInteger(count) && count > 0 && count <= this.capacity,
      'batch size must be between 1 and capacity')
    invariant(input.length === count * this.sourceSize, 'source table batch has wrong length')
    for (let sample = 0; sample < count; sample++) {
      this.circuit.validateSourceRanges(
        input.subarray(sample * this.sourceSize, (sample + 1) * this.sourceSize))
    }
    this.count = count
    this.hasRun = false
    if (this.device) {
      if (input.byteLength) this.device.queue.writeBuffer(this.sourceBuffer!, 0, input)
      this.device.queue.writeBuffer(this.parameterBuffer!, 0,
        new Uint32Array([count, this.sourceSize, this.width, this.circuit.operations.length, 0, 0, 0, 0]))
      for (let i = 0; i < this.layerRanges.length && this.strategy === 'layers'; i++) {
        const range = this.layerRanges[i]!
        this.device.queue.writeBuffer(this.layerUniforms[i]!, 0, new Uint32Array([
          count, this.sourceSize, this.width, this.circuit.operations.length,
          range.start, range.count, 0, 0,
        ]))
      }
    } else {
      this.sources.set(input)
    }
  }

  async run(steps = 1, stateUpdates: readonly StateUpdate[] = []): Promise<void> {
    this.ensureActive()
    invariant(this.count > 0, 'call load before run')
    invariant(Number.isSafeInteger(steps) && steps > 0, 'steps must be a positive integer')
    const wires = Uint32Array.from({length: this.sourceSize}, (_, i) => i)
    const seen = new Set<number>()
    for (const update of stateUpdates) {
      invariant(Number.isInteger(update.source) && update.source >= 0 &&
        update.source < this.sourceSize, 'state source out of bounds')
      invariant(Number.isInteger(update.from) && update.from >= 0 &&
        update.from < this.width, 'state output wire out of bounds')
      invariant(!seen.has(update.source), 'duplicate state update source')
      seen.add(update.source)
      wires[update.source] = update.from
    }
    if (this.device) {
      if (this.sourceSize) this.device.queue.writeBuffer(this.stateBuffer!, 0, wires)
      const encoder = this.device.createCommandEncoder()
      for (let iteration = 0; iteration < steps; iteration++) {
        if (this.strategy === 'layers') {
          const loadPass = encoder.beginComputePass()
          loadPass.setPipeline(this.loadPipeline!)
          loadPass.setBindGroup(0, this.bindGroup!)
          loadPass.dispatchWorkgroups(Math.ceil(this.count / workgroupSize))
          loadPass.end()
          for (let i = 0; i < this.layerRanges.length; i++) {
            const layerPass = encoder.beginComputePass()
            layerPass.setPipeline(this.layerPipeline!)
            layerPass.setBindGroup(0, this.layerGroups[i]!)
            layerPass.dispatchWorkgroups(Math.ceil(this.count / workgroupSize))
            layerPass.end()
          }
        } else {
          const pass = encoder.beginComputePass()
          pass.setPipeline(this.executePipeline!)
          pass.setBindGroup(0, this.bindGroup!)
          pass.dispatchWorkgroups(Math.ceil(this.count / workgroupSize))
          pass.end()
        }
        if (stateUpdates.length > 0) {
          const statePass = encoder.beginComputePass()
          statePass.setPipeline(this.advancePipeline!)
          statePass.setBindGroup(0, this.bindGroup!)
          statePass.dispatchWorkgroups(Math.ceil(this.count / workgroupSize))
          statePass.end()
        }
      }
      this.device.queue.submit([encoder.finish()])
      await this.device.queue.onSubmittedWorkDone()
      this.ensureActive()
    } else {
      for (let iteration = 0; iteration < steps; iteration++) {
        for (let sample = 0; sample < this.count; sample++) {
          const start = sample * this.sourceSize
          const results = this.circuit.evaluateReference(
            this.sources.slice(start, start + this.sourceSize))
          this.values.set(results, sample * this.width)
          if (stateUpdates.length > 0) {
            for (let i = 0; i < this.sourceSize; i++) {
              this.sources[start + i] = results[wires[i]!]!
            }
          }
        }
      }
    }
    this.hasRun = true
  }

  async readValues(): Promise<Float32Array> {
    this.ensureActive()
    invariant(this.hasRun, 'call run before readValues')
    if (!this.device) return this.values.slice(0, this.count * this.width)
    const bytes = this.count * this.width * 4
    const staging = this.device.createBuffer({
      size: bytes, usage: Usage.MAP_READ | Usage.COPY_DST,
    })
    try {
      const encoder = this.device.createCommandEncoder()
      encoder.copyBufferToBuffer(this.valueBuffer!, 0, staging, 0, bytes)
      this.device.queue.submit([encoder.finish()])
      await staging.mapAsync(MapMode.READ)
      const output = new Float32Array(staging.getMappedRange().slice(0))
      staging.unmap()
      return output
    } finally {
      staging.destroy()
    }
  }

  async evaluate(input: Float32Array, options: {
    batchSize?: number, steps?: number, stateUpdates?: readonly StateUpdate[]
  } = {}): Promise<Float32Array> {
    this.load(input, options.batchSize)
    await this.run(options.steps ?? 1, options.stateUpdates)
    return this.readValues()
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    for (const buffer of this.buffers) buffer.destroy()
    this.buffers.length = 0
  }
}

export const createWebGpuEvaluator = (circuit: Circuit, options: WebGpuOptions = {}) => WebGpuCircuitEvaluator.create(circuit, options)
