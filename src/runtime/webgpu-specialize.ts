// Per-circuit WGSL generation, with f32 constants emitted as exact bit patterns.
// The operation list and candidate table layout match src/runtime/webgpu.ts.
import type {Circuit} from './numeric-ui-core.ts'

function bitsF32(value: number): string {
  const buffer = new ArrayBuffer(4)
  const view = new DataView(buffer)
  view.setFloat32(0, Math.fround(value), true)
  return 'bitcast<f32>(0x' + view.getUint32(0, true).toString(16).padStart(8, '0') + 'u)'
}

export function emitSpecializedWgsl(circuit: Circuit): string {
  const lines = [
    'struct Params { count:u32, sourceSize:u32, width:u32, operationCount:u32, layerStart:u32, layerCount:u32, pad0:u32, pad1:u32 };',
    '@group(0) @binding(0) var<uniform> params:Params;',
    '@group(0) @binding(1) var<storage,read_write> sources:array<f32>;',
    '@group(0) @binding(2) var<storage,read_write> values:array<f32>;',
    '@group(0) @binding(5) var<storage,read> candidates:array<u32>;',
    '@compute @workgroup_size(64)',
    'fn executeSpecialized(@builtin(global_invocation_id) tid:vec3<u32>) {',
    '  if (tid.x >= params.count) {return;}',
    '  let base = tid.x * params.width;',
    '  let sourceBase = tid.x * params.sourceSize;',
    '  for(var i=0u; i<params.sourceSize; i=i+1u) {values[base+i]=sources[sourceBase+i];}',
  ]
  const line = (text: string) => lines.push('  ' + text)
  let candidateOffset = 0
  const tableOffsets = new Map<number, number>()
  for (const [index, operation] of circuit.operations.entries()) {
    const value = 'v' + index
    const affine = (name: string, terms: readonly (readonly [number, number])[], bias: number) => {
      line('var ' + name + ' = ' + bitsF32(bias) + ';')
      for (const [wire, coefficient] of terms) {
        line(name + ' = ' + name + ' + (' + bitsF32(coefficient) +
          ' * values[base+' + wire + 'u]);')
      }
    }
    affine(value, operation.leftTerms, operation.leftBias)
    if (operation.kind === 'reglu') {
      const gate = 'g' + index
      affine(gate, operation.gateTerms, operation.gateBias)
      line(value + ' = ' + value + ' * max(0.0,' + gate + ');')
    } else if (operation.kind === 'boolean') {
      // The reference contract promises a score in [0,1]. This cannot
      // be algebraically optimized to the unrounded score by a GPU compiler.
      line(value + ' = select(0.0,1.0,' + value + ' >= 0.5);')
    } else if (operation.kind === 'index') {
      const gate = 'g' + index
      affine(gate, operation.gateTerms, operation.gateBias)
      const read = operation.indexRead!
      let candidateStart = tableOffsets.get(read.table.id)
      if (candidateStart === undefined) {
        candidateStart = candidateOffset
        candidateOffset += read.table.candidates.length
        tableOffsets.set(read.table.id, candidateStart)
      }
      const len = read.table.candidates.length
      const below = read.below === 'zero' ? '0.0' :
        'values[base+candidates[' + candidateStart + 'u]]'
      const above = read.above === 'zero' ? '0.0' :
        'values[base+candidates[' + (candidateStart + len - 1) + 'u]]'
      line('if (' + gate + ' != ' + gate + ') {' + value + ' = ' + gate + ';}')
      line('else if (' + gate + '<0.0) {' + value + '=' + below + ';}')
      line('else if (' + gate + '>=' + bitsF32(len) + ') {' + value + '=' + above + ';}')
      line('else {' + value + '=values[base+candidates[' + candidateStart +
        'u+u32(floor(' + gate + '))]];}')
    }
    line('values[base+' + (circuit.sourceSize + index) + 'u]=' + value + ';')
  }
  lines.push('}')
  return lines.join('\n') + '\n'
}
