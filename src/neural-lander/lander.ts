// Builder code runs once. All flight arithmetic and the loss are Handwired wires.
import {createSourceTable, input, list} from '../runtime/cells.ts'
import {type Wire, type Terms} from '../runtime/numeric-ui-core.ts'

export const flight = {
  commands: 16, steps: 96, dt: 1 / 16, gravity: 4,
  lateralAcceleration: 4, verticalAcceleration: 8,
  startX: 0, startY: 10, startVX: 0, startVY: -1,
  targetLimit: 8, positionWeight: 10, groundWeight: 20, effortWeight: 0.001,
  maxIterations: 5000,
} as const

export type State = {x: number, y: number, vx: number, vy: number, tx: number, ty: number}
type StateWires = {[K in keyof State]: Wire}
export type Outcome = {
  status: 'landed' | 'crashed' | 'missed', time: number, x: number, y: number,
  speed: number, error: number,
}
export type Snapshot = {
  states: State[], parameters: number[], loss: number, iteration: number, target: number,
  outcome: Outcome,
}

export function buildLander() {
  const table = createSourceTable()
  const cells = table.declare({
    commands: list(flight.commands, () => ({x: input([-1, 1]), y: input([0, 1])})),
    target: input([-flight.targetLimit, flight.targetLimit], {initial: 4}),
  })
  const circuit = table.createCircuit()
  const square = (wire: Wire) => circuit.multiply(wire, wire)
  let x = circuit.constant(flight.startX)
  let y = circuit.constant(flight.startY)
  let vx = circuit.constant(flight.startVX)
  let vy = circuit.constant(flight.startVY)
  const zero = circuit.constant(0)
  const states: StateWires[] = [{x, y, vx, vy, tx: zero, ty: zero}]
  const ground: Terms[number][] = []
  const effort: Terms[number][] = []
  for (const command of cells.commands) {
    // Commands are bounded source cells, projected by Adam, as in learned-gallery.
    const ax = circuit.roundAffine([[command.x, flight.lateralAcceleration]])
    const ay = circuit.roundAffine([[command.y, flight.verticalAcceleration]], -flight.gravity)
    effort.push([square(command.x), flight.effortWeight / flight.commands],
      [square(command.y), flight.effortWeight / flight.commands])
    for (let step = 0; step < flight.steps / flight.commands; step++) {
      // Semi-implicit Euler: velocity first, then position, with explicit FP32 boundaries.
      vx = circuit.roundAffine([[vx, 1], [ax, flight.dt]])
      vy = circuit.roundAffine([[vy, 1], [ay, flight.dt]])
      x = circuit.roundAffine([[x, 1], [vx, flight.dt]])
      y = circuit.roundAffine([[y, 1], [vy, flight.dt]])
      states.push({x, y, vx, vy, tx: command.x, ty: command.y})
      const penetration = circuit.reglu([], 1, [[y, -1]], 0)
      ground.push([square(penetration), flight.groundWeight / flight.steps])
    }
  }
  const errorX = circuit.roundAffine([[x, 1], [cells.target, -1]])
  const loss = circuit.roundAffine([
    [square(errorX), flight.positionWeight], [square(y), flight.positionWeight],
    [square(vx), 1], [square(vy), 1], ...ground, ...effort,
  ])
  const roots = [...states.flatMap(state => Object.values(state)), loss]
  const program = circuit.compileTensorProgram(roots)
  const stats = {
    operations: program.valueCount - program.sourceSize,
    weights: program.layers.reduce((sum, layer) => sum + layer.weights.length, 0),
    layers: program.layers.length, parameters: flight.commands * 2,
  }
  return {...table.finish(), cells, states, loss, roots, program, stats}
}

// Host-only collision classification. Never feeds a gradient back into the flight.
export function classify(states: readonly State[], target: number): Outcome {
  const result = (state: State, time: number, contact: boolean): Outcome => {
    const error = Math.abs(state.x - target)
    const speed = Math.hypot(state.vx, state.vy)
    return {status: !contact ? 'missed' : error <= 0.25 && speed <= 0.5 ? 'landed' : 'crashed',
      time, x: state.x, y: contact ? 0 : state.y, speed, error}
  }
  for (let i = 1; i < states.length; i++) {
    const before = states[i - 1]!
    const after = states[i]!
    if (before.y > 0 && after.y <= 0) {
      const fraction = before.y / (before.y - after.y)
      return result({...after, x: before.x + fraction * (after.x - before.x), y: 0,
        vx: before.vx + fraction * (after.vx - before.vx),
        vy: before.vy + fraction * (after.vy - before.vy)}, (i - 1 + fraction) * flight.dt, true)
    }
  }
  const last = states[states.length - 1]!
  return result(last, (states.length - 1) * flight.dt, last.y >= 0 && last.y <= 0.05 && last.vy <= 0)
}

export function seededRandom(seed: number) {
  return () => {
    seed |= 0
    seed = seed + 0x6D2B79F5 | 0
    let value = Math.imul(seed ^ seed >>> 15, 1 | seed)
    value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

export function createLander(seed: number, target = 4) {
  const built = buildLander()
  const {circuit, cells} = built
  const source = new Float32Array(built.initialSource)
  const parameters = cells.commands.flatMap(command => [command.x, command.y])
  const first = new Float64Array(parameters.length)
  const second = new Float64Array(parameters.length)
  const outputGradients = new Float32Array(circuit.sourceSize + circuit.operations.length)
  outputGradients[built.loss] = 1
  let iteration = 0
  let error: string | null = null
  let current: Snapshot

  function snapshot(values = circuit.evaluateReference(source)): Snapshot {
    const states = built.states.map(wires => Object.fromEntries(
      Object.entries(wires).map(([key, wire]) => [key, values[wire]!]),
    ) as State)
    return {states, parameters: parameters.map(wire => source[wire]!), loss: values[built.loss]!,
      iteration, target: source[cells.target]!, outcome: classify(states, source[cells.target]!)}
  }
  function reset(nextSeed: number) {
    const random = seededRandom(nextSeed)
    for (const command of cells.commands) {
      source[command.x] = random() * 2 - 1
      source[command.y] = random()
    }
    first.fill(0)
    second.fill(0)
    iteration = 0
    error = null
    current = snapshot()
    return current
  }
  function setTarget(next: number) {
    if (!Number.isFinite(next)) throw new Error('Target must be finite')
    source[cells.target] = Math.max(-flight.targetLimit, Math.min(flight.targetLimit, next))
    first.fill(0)
    second.fill(0)
    iteration = 0
    error = null
    current = snapshot()
    return current
  }
  setTarget(target)
  reset(seed)
  return {
    built, source, parameters, reset, setTarget,
    get current() { return current },
    get error() { return error },
    get finished() { return error !== null || iteration >= flight.maxIterations || current.outcome.status === 'landed' },
    step() {
      if (this.finished) return current
      try {
        const values = circuit.evaluateReference(source)
        const gradients = circuit.backpropagateReference(values, outputGradients)
        let norm = 0
        for (const wire of parameters) norm += gradients[wire]! ** 2
        if (!Number.isFinite(norm) || !Number.isFinite(values[built.loss])) throw new Error('Non-finite loss or gradient')
        const scale = Math.min(1, 1 / Math.sqrt(norm))
        iteration++
        // Adam updates source cells only; gravity, integration and loss weights stay fixed.
        for (const [index, wire] of parameters.entries()) {
          const gradient = gradients[wire]! * scale
          first[index] = 0.9 * first[index]! + 0.1 * gradient
          second[index] = 0.999 * second[index]! + 0.001 * gradient ** 2
          const update = 0.03 * (first[index] / (1 - 0.9 ** iteration))
            / (Math.sqrt(second[index] / (1 - 0.999 ** iteration)) + 1e-8)
          source[wire] = Math.max(index % 2 === 0 ? -1 : 0, Math.min(1, source[wire]! - update))
        }
        current = snapshot()
        if (!Number.isFinite(current.loss)) throw new Error('Non-finite trajectory')
      } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
      }
      return current
    },
  }
}
