import {test} from 'bun:test'
import assert from 'node:assert/strict'
import {buildLander, createLander, classify, flight, type State} from '../../src/neural-lander/lander.ts'
import {reference} from './reference.ts'

const near = (actual: number, expected: number, tolerance: number, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected} (±${tolerance})`)

test('Neural Lander: matches independent physics at every step, and tensor execution matches reference execution', () => {
    for (let seed = 0; seed < 12; seed++) {
      const machine = createLander(seed, seed % 3 * 8 - 8)
      if (seed < 3) for (const [index, wire] of machine.parameters.entries()) {
        machine.source[wire] = seed === 0 ? 0 : index % 2 === 0 ? seed === 1 ? -1 : 1 : 1
      }
      const {circuit, roots, states, loss} = machine.built
      const values = circuit.evaluateReference(machine.source)
      const tensor = circuit.createTensorEvaluator(roots)(machine.source)
      const expected = reference(machine.parameters.map(wire => machine.source[wire]!), machine.current.target)
      for (const [i, wires] of states.entries()) for (const key of Object.keys(wires) as (keyof State)[]) {
        near(values[wires[key]]!, expected.states[i]![key], 0.00015, `seed ${seed} step ${i} ${key}`)
      }
      near(values[loss]!, expected.loss, 0.1, 'loss')
      roots.forEach((wire, i) => near(tensor[i]!, values[wire]!, 0.0001, 'tensor'))
    }
  })

test('Neural Lander: differentiates all 32 parameters numerically, including paths below ground', () => {
    for (const seed of [1, 5, 17]) {
      const machine = createLander(seed, 3)
      const {circuit, loss} = machine.built
      // Interior parameters keep central differences inside declared bounds.
      for (const [i, wire] of machine.parameters.entries()) machine.source[wire] = i % 2 ? 0.2 + machine.source[wire]! * 0.5 : machine.source[wire]! * 0.7
      const values = circuit.evaluateReference(machine.source)
      const upstream = new Float32Array(values.length)
      upstream[loss] = 1
      const gradients = circuit.backpropagateReference(values, upstream)
      for (const wire of machine.parameters) {
        const initial = machine.source[wire]!
        const errors: number[] = []
        for (const epsilon of [0.001, 0.003]) {
          machine.source[wire] = initial + epsilon
          const hi = circuit.evaluateReference(machine.source)[loss]!
          const actualHi = machine.source[wire]
          machine.source[wire] = initial - epsilon
          const lo = circuit.evaluateReference(machine.source)[loss]!
          errors.push(Math.abs((hi - lo) / (actualHi - machine.source[wire]) - gradients[wire]!))
        }
        machine.source[wire] = initial
        assert.ok(Math.min(...errors) <= 0.5 + Math.abs(gradients[wire]!) * 0.003, `gradient ${wire}: ${errors.join(', ')}`)
        const inputs = machine.parameters.map(parameter => machine.source[parameter]!)
        const index = machine.parameters.indexOf(wire)
        inputs[index] = initial + 1e-5
        const high = reference(inputs, 3).loss
        inputs[index] = initial - 1e-5
        const low = reference(inputs, 3).loss
        near(gradients[wire]!, (high - low) / 2e-5, 0.01 + Math.abs(gradients[wire]!) * 0.0001, 'float64 gradient')
      }
    }
  })

test('Neural Lander: converges across 20 seeds at three target positions', () => {
    let successes = 0, maxIterations = 0
    const failures: string[] = []
    for (const target of [-8, 0, 8]) for (let seed = 0; seed < 20; seed++) {
      const machine = createLander(seed, target)
      const initialLoss = machine.current.loss
      while (!machine.finished) machine.step()
      assert.equal(machine.error, null)
      assert.ok(machine.current.loss < initialLoss)
      for (const [index, value] of machine.current.parameters.entries()) assert.ok(value >= (index % 2 ? 0 : -1) && value <= 1)
      if (machine.current.outcome.status === 'landed') successes++
      else failures.push(`${seed}@${target}: ${JSON.stringify(machine.current.outcome)}`)
      maxIterations = Math.max(maxIterations, machine.current.iteration)
    }
    console.log({successes, trials: 60, maxIterations, failures})
    assert.equal(successes, 60, `${successes}/60 converged`)
}, 60000)

test('Neural Lander: retargets the same circuit and resets reproducibly', () => {
    const machine = createLander(42, -8)
    const circuit = machine.built.circuit
    const initial = machine.current.parameters.slice()
    const trainToCompletion = () => { while (!machine.finished) machine.step() }
    trainToCompletion()
    for (const target of [8, -4, 0]) {
      const retained = machine.current.parameters.slice()
      machine.setTarget(target)
      assert.deepEqual(machine.current.parameters, retained)
      assert.equal(machine.built.circuit, circuit)
      assert.equal(machine.current.iteration, 0)
      trainToCompletion()
      assert.equal(machine.current.outcome.status, 'landed')
    }
    machine.reset(42)
    assert.deepEqual(machine.current.parameters, initial)
    machine.reset(43)
    assert.notDeepEqual(machine.current.parameters, initial)
    assert.throws(() => machine.setTarget(NaN))
    machine.setTarget(100)
    assert.equal(machine.current.target, flight.targetLimit)
  })

test('Neural Lander: classifies first impact, airborne endpoints and contact tolerances honestly', () => {
    const state = (x: number, y: number, vy: number): State => ({x, y, vy, vx: 0, tx: 0, ty: 0})
    assert.equal(classify([state(0, 1, -3), state(0, -1, -3), state(0, 0, 0)], 0).status, 'crashed')
    assert.equal(classify([state(0, 1, -1), state(0, 0.01, 0.1)], 0).status, 'missed')
    assert.equal(classify([state(0, 1, -1), state(0, 0.01, -0.1)], 0).status, 'landed')
    assert.equal(classify([state(0, 1, -1), state(1, 0, -0.1)], 0).status, 'crashed')
    assert.ok(buildLander().stats.operations > 96 * 4)
  })

test('Neural Lander: stops and exposes invalid numerical input instead of claiming convergence', () => {
    const machine = createLander(6)
    machine.source[machine.parameters[0]!] = NaN
    machine.step()
    assert.notEqual(machine.error, null)
    assert.equal(machine.finished, true)
    assert.notEqual(machine.current.outcome.status, 'landed')
    machine.reset(6)
    assert.equal(machine.error, null)
    assert.equal(machine.finished, false)
  })
