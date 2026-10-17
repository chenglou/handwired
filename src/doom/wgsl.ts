// The column and pixel programs as WebGPU compute shaders, every operation one `let`, in the compiled program's order.
// The column shader runs one invocation per screen column and writes each column's record into `records`; the pixel
// shader then runs one invocation per pixel, reading its column's record, and writes the view's palette indices. The
// probe shader, for the page's x-ray, is the pixel shader with every operation kept, and writes instead the value of
// the operation that a uniform picks.
//
// Besides those, a shader reads up to three buffers. `statics` holds the program's source cells, which the host writes
// each frame, followed by the value of every constant operation, written once; the cells an invocation knows itself,
// its column and its row, and the record's cells are read from where they are instead. `constants` holds, back to back,
// every table that an index read reads whose candidates are all constants, e.g. the texels, as values. `positions`
// holds, for every other table of candidates that don't change during a frame, e.g. the vertices a ray probes,
// positions into `statics`. Tables in the record are read from the record directly. Tables of computed values become
// arrays of the invocation's own, filled at their first read, and a read of at most 4 candidates a chain of selects.
//
// Apple's Metal compiler, through Dawn and through wgpu, folds (x + c) - c to x (see lab/ui-exploration/codegen/wgsl.ts,
// which measured it), and that would delete every boolean atom and every round. So a boolean atom is written as a
// select, and a round, ops.ts's (x + 2^23 + 2^22) - (2^23 + 2^22), as WGSL's round(), which rounds ties to even as
// the pair does. Products and sums are left to the compiler, which may fuse them: the values can then differ from the
// CPU's in their last bits, which moves a texel or a boundary at its edge now and then, and the page counts how many
// pixels of two GPU frames differ from the CPU's.
import {wgslFloat} from '../json-search/emit.ts'
import {invariant} from '../runtime/numeric-ui-core.ts'
import {type TensorProgram} from './codegen.ts'

const roundingBase = 2 ** 23 + 2 ** 22
const inlineCandidates = 4
const workgroupSize = 64

// The buffers a shader can bind, at these bindings of group 0.
export const bindings = ['statics', 'constants', 'positions', 'records', 'output', 'probe'] as const
export type Binding = typeof bindings[number]

export type StageShader = {
  name: string
  code: string
  // The program's operations that compute, constants left out.
  operations: number
  // The buffers the shader reads and writes, by binding.
  uses: Binding[]
  // statics: the source cells, then from staticsSize - staticsConstants.length on the constant operations' values.
  staticsSize: number
  staticsConstants: Float32Array
  constants: Float32Array
  positions: Uint32Array
  invocations: number
  workgroupSize: number
}

type Term = [weight: number, position: number]
type Row =
  | {kind: 'affine', bias: number, terms: Term[]}
  | {kind: 'boolean', bias: number, terms: Term[]}
  | {kind: 'reglu', bias: number, terms: Term[], gateBias: number, gateTerms: Term[]}
  | {kind: 'index', bias: number, terms: Term[], positions: number[], table: unknown, belowZero: boolean, aboveZero: boolean}

type Sources = {
  // Cells each invocation knows itself, e.g. its column, as WGSL expressions, by position.
  invocation: Map<number, string>
  // Cells of the column's record, by position: their index in the record, which starts at recordBase in `records`.
  record: Map<number, number>
}

// The program's operations as WGSL statements, and how to read any of its values.
function emitProgram(program: TensorProgram, sources: Sources) {
  const sourceSize = program.sourceSize
  const uses = new Set<Binding>()
  // Every row, by packed position, and each table's candidates once.
  const rows = new Map<number, Row>()
  const candidateLists = new Map<unknown, number[]>()
  let available = sourceSize
  for (const layer of program.layers) {
    invariant(layer.gatherReads.length === 0, 'gathers are not emitted')
    const termsOf = (projectionRow: number): Term[] => {
      const terms: Term[] = []
      for (let index = layer.rowOffsets[projectionRow]!; index < layer.rowOffsets[projectionRow + 1]!; index++) {
        terms.push([layer.weights[index]!, layer.inputIndices[layer.columns[index]!]!])
      }
      return terms
    }
    const gateOf = new Map<number, number>()
    layer.gateRows.forEach((row, gateIndex) => gateOf.set(row, layer.outputSize + gateIndex))
    const booleans = new Set(layer.booleanRows)
    const reads = new Map(layer.indexReads.map(read => [read.row, read]))
    for (let row = 0; row < layer.outputSize; row++) {
      const position = available + row
      const read = reads.get(row)
      const gate = gateOf.get(row)
      if (read !== undefined) {
        // A table is the same table when the compiler shares its positions, or its run of evenly spaced cells.
        const table = read.candidatePositions.length === 0 ? `${read.candidateBase},${read.candidateStride},${read.candidateCount}` : read.candidatePositions
        let positions = candidateLists.get(table)
        if (positions === undefined) {
          positions = read.candidatePositions.length === 0
            ? Array.from({length: read.candidateCount}, (_, index) => read.candidateBase + index * read.candidateStride)
            : Array.from(read.candidatePositions)
          candidateLists.set(table, positions)
        }
        rows.set(position, {kind: 'index', bias: layer.bias[read.indexRow]!, terms: termsOf(read.indexRow), positions, table, belowZero: read.belowZero, aboveZero: read.aboveZero})
      } else if (gate !== undefined) {
        rows.set(position, {kind: 'reglu', bias: layer.bias[row]!, terms: termsOf(row), gateBias: layer.bias[gate]!, gateTerms: termsOf(gate)})
      } else {
        rows.set(position, booleans.has(row) ? {kind: 'boolean', bias: layer.bias[row]!, terms: termsOf(row)} : {kind: 'affine', bias: layer.bias[row]!, terms: termsOf(row)})
      }
    }
    available += layer.outputSize
  }

  // Rounds: a row (x + 2^23 + 2^22) - (2^23 + 2^22) of a shifted row x + 2^23 + 2^22. The round becomes round(x), and
  // the shifted row is left out when nothing else reads it.
  const isRound = (row: Row) => {
    if (row.kind !== 'affine' || row.bias !== -roundingBase || row.terms.length !== 1 || row.terms[0]![0] !== 1) return false
    const inner = rows.get(row.terms[0]![1])
    return inner?.kind === 'affine' && inner.bias === roundingBase
  }
  const otherReaders = new Set<number>()
  for (const row of rows.values()) {
    if (isRound(row)) continue
    for (const [, position] of row.terms) otherReaders.add(position)
    if (row.kind === 'reglu') for (const [, position] of row.gateTerms) otherReaders.add(position)
    if (row.kind === 'index') for (const position of row.positions) otherReaders.add(position)
  }
  const skipped = new Set<number>()
  const keep = (positions: Iterable<number>) => {
    for (const position of positions) otherReaders.add(position)
    for (const row of rows.values()) if (isRound(row) && !otherReaders.has(row.terms[0]![1])) skipped.add(row.terms[0]![1])
  }

  // Constant operations: an affine row with no terms. Their values are literals, and their places in `statics`.
  const constantValue = new Map<number, number>()
  for (const [position, row] of rows) if (row.kind === 'affine' && row.terms.length === 0) constantValue.set(position, Math.fround(row.bias))
  const staticsIndex = new Map<number, number>()
  const staticsConstants: number[] = []
  for (const [position, value] of constantValue) {
    staticsIndex.set(position, sourceSize + staticsConstants.length)
    staticsConstants.push(value)
  }
  const isSource = (position: number) => position < sourceSize && !sources.invocation.has(position) && !sources.record.has(position)
  const isStatic = (position: number) => isSource(position) || constantValue.has(position)
  const staticsOf = (position: number) => position < sourceSize ? position : staticsIndex.get(position)!

  const float = (value: number) => wgslFloat(Math.fround(value))
  const ref = (position: number) => {
    const known = sources.invocation.get(position)
    if (known !== undefined) return known
    const inRecord = sources.record.get(position)
    if (inRecord !== undefined) {
      uses.add('records')
      return `records[recordBase + ${inRecord}u]`
    }
    if (position < sourceSize) {
      uses.add('statics')
      return `statics[${position}]`
    }
    const value = constantValue.get(position)
    return value === undefined ? `v${position}` : float(value)
  }
  const body: string[] = []
  // bias + Σ weight × value, continuing in a new `let` every 32 terms.
  const sum = (name: string, bias: number, terms: Term[]) => {
    let text = float(bias)
    terms.forEach(([weight, position], index) => {
      const value = ref(position)
      const piece = weight === 1 ? value : weight === -1 ? `-${value}` : `${float(weight)} * ${value}`
      text = index === 0 && bias === 0 ? piece : `${text} + ${piece}`
      if ((index + 1) % 32 === 0 && index + 1 < terms.length) {
        body.push(`let ${name}_${index}: f32 = ${text};`)
        text = `${name}_${index}`
      }
    })
    return `(${text})`
  }

  const constants: number[] = []
  const constantTables = new Map<unknown, number>()
  const positions: number[] = []
  const positionTables = new Map<unknown, number>()
  const arrays = new Map<unknown, string>()
  type TableKind = {kind: 'constants' | 'statics' | 'computed'} | {kind: 'record', first: number, stride: number}
  const tableKinds = new Map<unknown, TableKind>()
  const tableKindOf = (candidates: number[]): TableKind => {
    if (candidates.every(candidate => constantValue.has(candidate))) return {kind: 'constants'}
    if (candidates.every(isStatic)) return {kind: 'statics'}
    const indices = candidates.map(candidate => sources.record.get(candidate))
    const first = indices[0]
    const stride = indices.length > 1 && indices[1] !== undefined && first !== undefined ? indices[1] - first : 1
    if (first !== undefined && indices.every((index, at) => index === first + at * stride)) return {kind: 'record', first, stride}
    return {kind: 'computed'}
  }

  const emit = () => {
    for (const [position, row] of rows) {
      if (constantValue.has(position) || skipped.has(position)) continue
      const name = `v${position}`
      if (row.kind === 'affine') {
        // ops.ts's round: (x + 2^23 + 2^22) - (2^23 + 2^22), as WGSL's round of x.
        if (isRound(row)) {
          const inner = rows.get(row.terms[0]![1])!
          body.push(`let ${name}: f32 = round(${sum(`${name}_r`, 0, inner.terms)});`)
        } else {
          body.push(`let ${name}: f32 = ${sum(name, row.bias, row.terms)};`)
        }
      } else if (row.kind === 'boolean') {
        body.push(`let ${name}: f32 = select(0.0f, 1.0f, ${sum(name, row.bias, row.terms)} >= 0.5f);`)
      } else if (row.kind === 'reglu') {
        const gate = `max(0.0f, ${sum(`${name}_g`, row.gateBias, row.gateTerms)})`
        body.push(row.terms.length === 0 && row.bias === 1 ? `let ${name}: f32 = ${gate};` : `let ${name}: f32 = ${sum(name, row.bias, row.terms)} * ${gate};`)
      } else {
        const last = row.positions.length - 1
        body.push(`let p${position}: i32 = i32(floor(${sum(`p${position}`, row.bias, row.terms)}));`)
        const clamped = `clamp(p${position}, 0i, ${last}i)`
        let read: string
        const key = row.table
        let table = tableKinds.get(key)
        if (table === undefined) {
          table = tableKindOf(row.positions)
          tableKinds.set(key, table)
        }
        if (table.kind === 'constants') {
          let base = constantTables.get(key)
          if (base === undefined) {
            base = constants.length
            for (const candidate of row.positions) constants.push(constantValue.get(candidate)!)
            constantTables.set(key, base)
          }
          uses.add('constants')
          read = `constants[${base}u + u32(${clamped})]`
        } else if (row.positions.length <= inlineCandidates) {
          read = ref(row.positions[last]!)
          for (let index = last - 1; index >= 0; index--) read = `select(${read}, ${ref(row.positions[index]!)}, p${position} <= ${index}i)`
        } else if (table.kind === 'statics') {
          let base = positionTables.get(key)
          if (base === undefined) {
            base = positions.length
            for (const candidate of row.positions) positions.push(staticsOf(candidate))
            positionTables.set(key, base)
          }
          uses.add('statics')
          uses.add('positions')
          read = `statics[positions[${base}u + u32(${clamped})]]`
        } else if (table.kind === 'record') {
          uses.add('records')
          read = `records[recordBase + ${table.first}u + ${table.stride === 1 ? '' : `${table.stride}u * `}u32(${clamped})]`
        } else {
          let array = arrays.get(key)
          if (array === undefined) {
            array = `a${arrays.size}`
            arrays.set(key, array)
            body.push(`var ${array} = array<f32, ${row.positions.length}>(${row.positions.map(ref).join(', ')});`)
          }
          read = `${array}[${clamped}]`
        }
        if (row.aboveZero) read = `select(${read}, 0.0f, p${position} > ${last}i)`
        if (row.belowZero) read = `select(${read}, 0.0f, p${position} < 0i)`
        body.push(`let ${name}: f32 = ${read};`)
      }
    }
  }

  return {
    // Emits the statements for the given outputs, and returns how to read their values.
    statements(outputs: Iterable<number>) {
      keep(outputs)
      emit()
      return body.join('\n')
    },
    ref,
    uses,
    // The operations that compute, constants left out.
    operations: rows.size - constantValue.size,
    // The buffers' contents, once the statements are emitted.
    tables: () => ({
      staticsSize: sourceSize + staticsConstants.length,
      staticsConstants: Float32Array.from(staticsConstants),
      constants: Float32Array.from(constants.length === 0 ? [0] : constants),
      positions: Uint32Array.from(positions.length === 0 ? [0] : positions),
    }),
  }
}

function header(uses: Set<Binding>) {
  const declarations: Record<Binding, string> = {
    statics: 'var<storage, read> statics: array<f32>',
    constants: 'var<storage, read> constants: array<f32>',
    positions: 'var<storage, read> positions: array<u32>',
    records: 'var<storage, read> records: array<f32>',
    output: 'var<storage, read_write> output: array<u32>',
    probe: 'var<uniform> probe: u32',
  }
  return bindings.filter(binding => uses.has(binding)).map(binding => `@group(0) @binding(${bindings.indexOf(binding)}) ${declarations[binding]};`).join('\n')
}

// One invocation per column: runs the column program and writes its record.
export function compileColumnShader(program: TensorProgram, options: {columnCell: number, record: Int32Array, width: number}): StageShader {
  const emitted = emitProgram(program, {invocation: new Map([[options.columnCell, 'column']]), record: new Map()})
  const statements = emitted.statements(options.record)
  const stores = Array.from(options.record, (position, index) => `records[recordBase + ${index}u] = ${emitted.ref(position)};`)
  const uses = new Set(emitted.uses)
  uses.delete('records')
  const code = `${header(uses)}
@group(0) @binding(${bindings.indexOf('records')}) var<storage, read_write> records: array<f32>;

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= ${options.width}u) { return; }
  let column: f32 = f32(id.x);
  let recordBase: u32 = id.x * ${options.record.length}u;
${statements}
${stores.join('\n')}
}
`
  uses.add('records')
  return {
    name: 'column',
    code,
    operations: emitted.operations,
    uses: bindings.filter(binding => uses.has(binding)),
    ...emitted.tables(),
    invocations: options.width,
    workgroupSize,
  }
}

type PixelOptions = {rowCell: number, recordCells: Int32Array, width: number, height: number}

// One invocation per pixel, column after column: runs the pixel program on its column's record and its row, and writes
// into the row-major view what `store` makes of the emitted program.
function compilePerPixel(
  name: string,
  program: TensorProgram,
  options: PixelOptions,
  outputs: Iterable<number>,
  store: (emitted: ReturnType<typeof emitProgram>, uses: Set<Binding>) => {statements: string, value: string},
): StageShader {
  const record = new Map<number, number>()
  options.recordCells.forEach((cell, index) => record.set(cell, index))
  const emitted = emitProgram(program, {invocation: new Map([[options.rowCell, 'row']]), record})
  const statements = emitted.statements(outputs)
  const uses = new Set(emitted.uses)
  uses.add('records')
  uses.add('output')
  const stored = store(emitted, uses)
  const code = `${header(uses)}

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= ${options.width * options.height}u) { return; }
  let columnIndex: u32 = id.x / ${options.height}u;
  let rowIndex: u32 = id.x % ${options.height}u;
  let row: f32 = f32(rowIndex);
  let recordBase: u32 = columnIndex * ${options.recordCells.length}u;
${statements}
${stored.statements === '' ? '' : `${stored.statements}\n`}  output[rowIndex * ${options.width}u + columnIndex] = ${stored.value};
}
`
  return {
    name,
    code,
    operations: emitted.operations,
    uses: bindings.filter(binding => uses.has(binding)),
    ...emitted.tables(),
    invocations: options.width * options.height,
    workgroupSize,
  }
}

// The pixel shader: writes each pixel's palette index.
export function compilePixelShader(program: TensorProgram, options: PixelOptions & {pixel: number}): StageShader {
  return compilePerPixel('pixel', program, options, [options.pixel], emitted => ({statements: '', value: `u32(${emitted.ref(options.pixel)})`}))
}

// The probe shader, for the page's x-ray: keeps every one of `operations`, the packed positions of the program's
// operations that compute, and writes the bits of the value of the one at index `probe`, a uniform the host writes
// per frame. The switch reads a uniform, so every invocation takes the same case.
export function compileProbeShader(program: TensorProgram, options: PixelOptions & {operations: Int32Array}): StageShader {
  return compilePerPixel('probe', program, options, options.operations, (emitted, uses) => {
    uses.add('probe')
    const cases = Array.from(options.operations, (position, index) => `    case ${index}u: { value = ${emitted.ref(position)}; }`)
    return {
      statements: `  var value: f32 = 0.0f;\n  switch probe {\n${cases.join('\n')}\n    default: {}\n  }`,
      value: 'bitcast<u32>(value)',
    }
  })
}
