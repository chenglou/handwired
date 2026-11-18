import {describe, expect, test} from 'bun:test'
import {Circuit, type Wire} from '../../src/runtime/numeric-ui-core.ts'
import {createWebGpuEvaluator} from '../../src/runtime/webgpu.ts'
import {circuitWgsl} from '../../src/runtime/webgpu-shader.ts'

export function mixedCircuit() {
  const circuit = new Circuit(5)
  const a = circuit.source(0)
  const b = circuit.source(1)
  const gate = circuit.source(2)
  const index = circuit.source(3)
  const score = circuit.source(4)
  circuit.assumeRange(gate, 0, 1)
  circuit.assumeRange(index, -2, 5)
  circuit.assumeRange(score, 0, 1)
  const sum = circuit.roundAffine([[a, 0.1], [b, 0.2]], 0.3)
  const relu = circuit.reglu([[sum, 1]], 0, [[gate, 1]], 0)
  const bit = circuit.boolean(score)
  const read = circuit.indexReadAffine([[index, 1]], 0,
    [a, b, relu, bit], 'zero', 'clamp')
  const root = circuit.roundAffine([[read, 1], [sum, -1]], 2)
  return {circuit, root, sum}
}

export function sampleInputs(samples: number) {
  const data = new Float32Array(samples * 5)
  let state = 123456
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0
    return (state >>> 0) / 4294967296
  }
  for (let i = 0; i < samples; i++) {
    data.set([random() * 20 - 10, random() * 10 - 5, random(),
      i % 8 - 2, i % 3 === 0 ? 0.5 : random()], i * 5)
  }
  return data
}

describe('reusable circuit evaluator', () => {
  test('CPU fallback agrees with the original reference, including all four operation kinds', async () => {
    const {circuit} = mixedCircuit()
    const input = sampleInputs(31)
    const evaluator = await createWebGpuEvaluator(circuit, {mode: 'cpu', capacity: 32})
    try {
      const output = await evaluator.evaluate(input)
      expect(evaluator.mode).toBe('cpu')
      const width = circuit.sourceSize + circuit.operations.length
      for (let i = 0; i < 31; i++) {
        expect(Array.from(output.subarray(i * width, (i + 1) * width)))
          .toEqual(Array.from(circuit.evaluateReference(input.subarray(i * 5, (i + 1) * 5))))
      }
    } finally {
      evaluator.destroy()
    }
  })

  test('persistent sources and multiple state steps use previous results', async () => {
    const {circuit, sum} = mixedCircuit()
    const input = sampleInputs(3)
    const evaluator = await createWebGpuEvaluator(circuit, {mode: 'cpu', capacity: 3})
    try {
      const steps = 4
      const results = await evaluator.evaluate(input, {steps,
        stateUpdates: [{source: 0, from: sum}]})
      const width = circuit.sourceSize + circuit.operations.length
      for (let i = 0; i < 3; i++) {
        const source = input.slice(i * 5, (i + 1) * 5)
        let expected: Float32Array = new Float32Array()
        for (let step = 0; step < steps; step++) {
          expected = circuit.evaluateReference(source)
          source[0] = expected[sum]!
        }
        expect(Array.from(results.subarray(i * width, (i + 1) * width)))
          .toEqual(Array.from(expected))
      }
    } finally {
      evaluator.destroy()
    }
  })

  test('bounds, source ranges, state mappings and disposal are checked', async () => {
    const {circuit} = mixedCircuit()
    const evaluator = await createWebGpuEvaluator(circuit, {mode: 'cpu', capacity: 2})
    expect(() => evaluator.load(sampleInputs(3))).toThrow()
    const bad = sampleInputs(1)
    bad[2] = 10
    expect(() => evaluator.load(bad)).toThrow()
    evaluator.load(sampleInputs(1))
    try {
      await evaluator.run(1, [{source: 0, from: 0 as Wire}, {source: 0, from: 1 as Wire}])
      throw new Error('expected rejection')
    } catch (error) {
      expect(String(error)).toContain('duplicate state update source')
    }
    evaluator.destroy()
    expect(() => evaluator.load(sampleInputs(1))).toThrow()
  })

  test('both schedulers preserve source-only and zero-operation circuits', async () => {
    const circuit = new Circuit(3)
    const source = Float32Array.from([1, -0, 5, -5, 7, 3])
    for (const strategy of ['monolithic', 'layers'] as const) {
      const evaluator = await createWebGpuEvaluator(circuit, {mode: 'cpu', capacity: 2, strategy})
      try {
        expect(evaluator.layerCount).toBe(0)
        const values = await evaluator.evaluate(source, {steps: 7})
        expect(Array.from(values)).toEqual(Array.from(source))
      } finally {
        evaluator.destroy()
      }
    }
  })

  test('capacity, empty operations, lifecycle and step count are validated', async () => {
    const mustReject = async (action: () => Promise<unknown>) => {
      let rejected = false
      try {await action()} catch {rejected = true}
      expect(rejected).toBe(true)
    }
    const {circuit} = mixedCircuit()
    await mustReject(() => createWebGpuEvaluator(circuit, {capacity: 0, mode: 'cpu'}))
    const evaluator = await createWebGpuEvaluator(circuit, {mode: 'cpu', capacity: 3, strategy: 'layers'})
    try {
      expect(evaluator.layerCount).toBeGreaterThan(0)
      await mustReject(() => evaluator.readValues())
      evaluator.load(sampleInputs(1))
      await mustReject(() => evaluator.run(0))
      await evaluator.run(2)
      expect((await evaluator.readValues()).length).toBe(circuit.sourceSize + circuit.operations.length)
      circuit.roundAffine([[circuit.source(0), 1]])
      expect(() => evaluator.load(sampleInputs(1))).toThrow('circuit operation count changed')
    } finally {
      evaluator.destroy()
      evaluator.destroy()
    }
  })

  test('randomized CPU reference differential across 256 independent instances', async () => {
    const {circuit} = mixedCircuit()
    const source = sampleInputs(256)
    const evaluator = await createWebGpuEvaluator(circuit, {mode: 'cpu', capacity: 256, strategy: 'layers'})
    try {
      const values = await evaluator.evaluate(source)
      const width = circuit.sourceSize + circuit.operations.length
      for (let i = 0; i < 256; i++) {
        const expected = circuit.evaluateReference(source.subarray(i * 5, i * 5 + 5))
        for (let w = 0; w < width; w++) {
          expect(values[i * width + w]).toBe(expected[w])
        }
      }
    } finally {
      evaluator.destroy()
    }
  })

  test('shader contains generic interpreter and state-update kernels', () => {
    for (const token of ['fn execute', 'fn executeLayer', 'fn loadSources', 'fn advanceState', 'op.kind == 1u',
      'op.kind == 2u', 'op.kind == 3u', 'fn affine']) {
      expect(circuitWgsl.includes(token)).toBe(true)
    }
  })
})
