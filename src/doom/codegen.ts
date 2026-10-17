// A compiled program as JavaScript statements, one per operation, like src/json-search/generated-js.ts, with index
// reads over any candidates: candidates at evenly spaced positions read v[base + p × stride], and any others read
// through a table of their positions. Every statement keeps the executor's FP32 rounding order, so every value has the
// executor's bits, which tests check against the runtime's evaluator.
//
// The values live in one Float32Array in the compiled program's packed order: source cells first, at their own wire
// positions, then every live operation. A host writes cells into it directly and runs the program in place, e.g. the
// column program, where one cell changes per column and every other cell stays from the frame.
import {type Circuit, invariant} from '../runtime/numeric-ui-core.ts'

export type TensorProgram = ReturnType<Circuit['compileTensorProgram']>

// JavaScriptCore and V8 stop optimizing very large functions, so the statements are split into functions of this many.
const rowsPerFunction = 128
// A sum continues in a new statement every this many terms, so no expression nests too deep for a parser.
const termsPerStatement = 16

const literal = (value: number) => Object.is(value, -0) ? '-0' : String(value)

// Index reads over at most this many candidates are written as a chain of selects, and larger ones read a table of
// positions. Every table goes into one array, P, so the generated functions close over one name however many reads
// a program has, e.g. a sorting network's thousands of 2-candidate reads.
const inlineCandidates = 4

export function compileProgram(program: TensorProgram) {
  const positions: number[] = []
  // Constant operations, which the values hold from the start instead of a statement writing them every run.
  const constants: [position: number, value: number][] = []
  // Each table of candidate positions, by identity, at its offset among the tables the statements read.
  const tableOffsets = new Map<ArrayLike<number>, number>()
  const functions: string[] = []
  let current: string[] = []
  let rowsInCurrent = 0
  const flush = () => {
    if (current.length === 0) return
    functions.push(`function chunk${functions.length}(v) {\nlet t = 0, g = 0, p = 0\n${current.join('\n')}\n}`)
    current = []
    rowsInCurrent = 0
  }
  let available = program.sourceSize
  for (const layer of program.layers) {
    invariant(layer.gatherReads.length === 0 && layer.gatherComputes.length === 0, 'gathers are not emitted')
    const termsOf = (projectionRow: number) => {
      const terms: [weight: number, position: number][] = []
      for (let index = layer.rowOffsets[projectionRow]!; index < layer.rowOffsets[projectionRow + 1]!; index++) {
        terms.push([layer.weights[index]!, layer.inputIndices[layer.columns[index]!]!])
      }
      return terms
    }
    const piece = ([weight, position]: [number, number]) =>
      weight === 1 ? `v[${position}]` : weight === -1 ? `-v[${position}]` : `f(${literal(weight)} * v[${position}])`
    // The executor's fold from the bias: value = f(value + f(weight × input)), continuing through t for long sums.
    const sum = (bias: number, terms: [number, number][]) => {
      if (terms.length === 0) return literal(Math.fround(bias))
      // f(-0 + x) is x, and f(+0 + x) is x + 0, which only turns -0 into +0.
      let text = Object.is(bias, -0) ? piece(terms[0]!) : bias === 0 ? `(${piece(terms[0]!)} + 0)` : `f(${literal(bias)} + ${piece(terms[0]!)})`
      for (let index = 1; index < terms.length; index++) {
        if (index % termsPerStatement === 0) {
          current.push(`t = ${text}`)
          text = 't'
        }
        text = `f(${text} + ${piece(terms[index]!)})`
      }
      return text
    }
    const gateOf = new Map<number, number>()
    layer.gateRows.forEach((row, gateIndex) => gateOf.set(row, layer.outputSize + gateIndex))
    const booleans = new Set(layer.booleanRows)
    const reads = new Map(layer.indexReads.map(read => [read.row, read]))
    for (let row = 0; row < layer.outputSize; row++) {
      const target = `v[${available + row}]`
      const read = reads.get(row)
      const gate = gateOf.get(row)
      if (read !== undefined) {
        const last = read.candidateCount - 1
        current.push(`p = ${sum(layer.bias[read.indexRow]!, termsOf(read.indexRow))}`)
        let at: (position: string) => string
        const candidate = (index: number) => read.candidatePositions.length === 0
          ? read.candidateBase + index * read.candidateStride
          : read.candidatePositions[index]!
        if (read.candidatePositions.length === 0) {
          at = position => read.candidateStride === 0 ? `v[${read.candidateBase}]` : `v[${read.candidateBase} + ${position} * ${read.candidateStride}]`
        } else if (read.candidateCount <= inlineCandidates) {
          at = position => {
            if (/^\d+$/.test(position)) return `v[${candidate(Number(position))}]`
            let text = `v[${candidate(read.candidateCount - 1)}]`
            for (let index = read.candidateCount - 2; index >= 0; index--) text = `(${position} === ${index} ? v[${candidate(index)}] : ${text})`
            return text
          }
        } else {
          let offset = tableOffsets.get(read.candidatePositions)
          if (offset === undefined) {
            offset = positions.length
            for (let index = 0; index < read.candidateCount; index++) positions.push(read.candidatePositions[index]!)
            tableOffsets.set(read.candidatePositions, offset)
          }
          const base = offset
          at = position => `v[P[${base} + ${position}]]`
        }
        const below = read.belowZero ? '0' : at('0')
        const above = read.aboveZero ? '0' : at(String(last))
        // floor(NaN) is NaN, which fails both comparisons and reads as an index of NaN, so a NaN index reads NaN.
        current.push(`p = Math.floor(p)`)
        current.push(`${target} = p >= 0 ? (p <= ${last} ? ${at('p')} : ${above}) : (p < 0 ? ${below} : NaN)`)
      } else if (gate !== undefined) {
        current.push(`g = Math.max(0, ${sum(layer.bias[gate]!, termsOf(gate))})`)
        const left = termsOf(row)
        const bias = layer.bias[row]!
        // Storing into the Float32Array rounds the product once, like the executor's fround.
        current.push(left.length === 0 && bias === 1 ? `${target} = g` : `${target} = ${sum(bias, left)} * g`)
      } else if (booleans.has(row)) {
        current.push(`${target} = f(f(${sum(layer.bias[row]!, termsOf(row))} + 8388609) - 8388609)`)
      } else if (layer.rowOffsets[row] === layer.rowOffsets[row + 1]) {
        constants.push([available + row, layer.bias[row]!])
        continue
      } else {
        current.push(`${target} = ${sum(layer.bias[row]!, termsOf(row))}`)
      }
      rowsInCurrent++
      if (rowsInCurrent === rowsPerFunction) flush()
    }
    available += layer.outputSize
  }
  flush()
  invariant(available === program.valueCount, 'the layers hold every live value')
  const source = `"use strict"\nconst f = Math.fround\nreturn [\n${functions.join(',\n')}\n]`
  const compile = Reflect.construct(Function, ['P', source]) as (positions: Int32Array) => ((values: Float32Array) => void)[]
  const chunks = compile(Int32Array.from(positions))
  const values = new Float32Array(program.valueCount)
  for (const [position, value] of constants) values[position] = value
  return {
    // The packed values: write source cells here, run, and read results here.
    values,
    run() {
      for (const chunk of chunks) chunk(values)
    },
    sourceBytes: source.length,
    source,
    chunks,
  }
}

// The packed position of each wire.
export function packedPositions(program: TensorProgram, wires: readonly number[]): Int32Array {
  const positionOfWire = new Int32Array(program.width).fill(-1)
  for (let position = 0; position < program.valueCount; position++) positionOfWire[program.wireOrder[position]!] = position
  return Int32Array.from(wires, wire => {
    const position = positionOfWire[wire]!
    invariant(position >= 0, `wire ${wire} isn't a live value of this program`)
    return position
  })
}
