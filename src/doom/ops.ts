// Builder functions that the Doom programs share, on top of the runtime's: rounding, sign bits, min and max.
import {type Circuit, type Terms, type Wire, invariant} from '../runtime/numeric-ui-core.ts'

// FP32 steps are exactly 1 within 2^23..2^24, so adding this base and subtracting it again rounds to the nearest
// integer, ties to even, as emitRound in lab/ui-exploration/numeric-library/rounding.ts does.
const roundingBase = 2 ** 23 + 2 ** 22
const roundDomain = 2 ** 22

// The range of terms + bias from the declared ranges of its wires.
function formRange(circuit: Circuit, terms: Terms, bias = 0) {
  let minimum = bias
  let maximum = bias
  for (const [wire, coefficient] of terms) {
    const range = circuit.ranges[wire]!
    const low = coefficient * range.minimum
    const high = coefficient * range.maximum
    minimum += Math.min(low, high)
    maximum += Math.max(low, high)
  }
  return {minimum, maximum}
}

// Math.round(value) with ties to even, for |value| < 2^22. 2 operations. The result is declared on the whole numbers.
export function emitRound(circuit: Circuit, value: Wire): Wire {
  const range = circuit.ranges[value]!
  invariant(range.minimum > -roundDomain && range.maximum < roundDomain, `round needs a declared range inside ±2^22, got ${range.minimum}..${range.maximum}`)
  const shifted = circuit.roundAffine([[value, 1]], roundingBase)
  const rounded = circuit.roundAffine([[shifted, 1]], -roundingBase)
  // The invariant puts value + roundingBase within 2^23..2^24, where it rounds to a whole number and subtracting the
  // base is exact, and the nearest whole number to a value within the range lies within its floor and ceiling.
  circuit.assumeRange(rounded, Math.floor(range.minimum), Math.ceil(range.maximum))
  circuit.assumeGrid(rounded, 1)
  return rounded
}

// Math.floor of terms + bias, nearly: round(x - 0.5 + 2^-10), which is floor(x) except within 2^-10 below a whole
// number, where it is one more. For rendering, where that sliver doesn't matter, and for values whose fractions stay
// clear of it, e.g. a third of a whole number. 3 operations.
export function emitFloorish(circuit: Circuit, terms: Terms, bias = 0, declared?: {minimum: number, maximum: number}): Wire {
  // A caller that knows a tighter range than the operands' declared ranges imply passes it, e.g. a fraction of a
  // period.
  const range = declared ?? formRange(circuit, terms, bias)
  const shifted = circuit.roundAffine([...terms], bias - 0.5 + 2 ** -10)
  // The shift moves the form down by 0.5 - 2^-10, less than 1.
  circuit.assumeRange(shifted, range.minimum - 1, range.maximum)
  return emitRound(circuit, shifted)
}

// An exact bit for terms + bias > 0, for any finite value: 1 at or above 1 / (2 × sharpness), 0 at or below
// -1 / (2 × sharpness), and either between. 3 operations: a ramp clipped to 0..1 and a boolean atom.
export function emitPositiveBit(circuit: Circuit, terms: Terms, bias = 0, sharpness = 64): Wire {
  const ramp = circuit.reglu([], 1, terms.map(([wire, coefficient]) => [wire, coefficient * sharpness] as const), bias * sharpness + 0.5)
  const clipped = circuit.reglu([], 1, [[ramp, -1]], 1)
  const score = circuit.affine([[clipped, -1]], 1)
  // ramp is a ReLU, at least 0, so clipped = relu(1 - ramp) is within 0..1, and so is score = 1 - clipped.
  circuit.assumeRange(score, 0, 1)
  return circuit.boolean(score)
}

const relu = (circuit: Circuit, terms: Terms, bias = 0) => circuit.reglu([], 1, terms, bias)

// max(a, b) = b + relu(a - b) and min(a, b) = a - relu(a - b): exact for whole numbers below 2^23, and within FP32
// rounding otherwise. 1 operation and a sum that readers fold in.
export function emitMax(circuit: Circuit, a: Wire, b: Wire): Wire {
  return circuit.affine([[b, 1], [relu(circuit, [[a, 1], [b, -1]]), 1]])
}

export function emitMin(circuit: Circuit, a: Wire, b: Wire): Wire {
  return circuit.affine([[a, 1], [relu(circuit, [[a, 1], [b, -1]]), -1]])
}

// min(limit, max(0, terms + bias)), e.g. a scale clamped to a table's last row. 2 operations.
export function emitClampZeroTo(circuit: Circuit, terms: Terms, bias: number, limit: number): Wire {
  const positive = relu(circuit, terms, bias)
  const overshoot = relu(circuit, [[positive, -1]], limit)
  return circuit.affine([[overshoot, -1]], limit)
}

// max(0, the terms' sum + bias), as a wire, where the runtime's emitRelu takes one wire.
export function emitReluSum(circuit: Circuit, terms: Terms, bias = 0): Wire {
  return relu(circuit, terms, bias)
}

// |value| as relu(value) + relu(-value). 2 operations.
export function emitAbs(circuit: Circuit, value: Wire): Wire {
  return circuit.affine([[relu(circuit, [[value, 1]]), 1], [relu(circuit, [[value, -1]]), 1]])
}

// A table of constants. circuit.constant already returns one wire per distinct value, and this cache skips its
// per-call key building, which matters for tables of a million texels.
const constantCache = new WeakMap<Circuit, Map<number, Wire>>()
export function constantTable(circuit: Circuit, values: ArrayLike<number>): Wire[] {
  let cache = constantCache.get(circuit)
  if (cache === undefined) {
    cache = new Map()
    constantCache.set(circuit, cache)
  }
  const result: Wire[] = Array.from({length: values.length})
  for (let index = 0; index < values.length; index++) {
    const value = Math.fround(values[index]!)
    let wire = cache.get(value)
    if (wire === undefined) {
      wire = circuit.constant(value)
      cache.set(value, wire)
    }
    result[index] = wire
  }
  return result
}
