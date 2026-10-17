// WebGPU compute shaders for general Handwired circuits.
// Keep every FP32 rounding step and operation order visible for audit.
export const circuitWgsl = /* wgsl */ `
struct Parameters {
  count: u32,
  sourceSize: u32,
  width: u32,
  operationCount: u32,
  layerStart: u32,
  layerCount: u32,
  reserved0: u32,
  reserved1: u32,
};
struct Operation {
  kind: u32,
  leftStart: u32,
  leftCount: u32,
  gateStart: u32,
  gateCount: u32,
  candidateStart: u32,
  candidateCount: u32,
  flags: u32,
  leftBias: f32,
  gateBias: f32,
  reserved0: u32,
  reserved1: u32,
};
struct Term {wire: u32, coefficient: f32};
@group(0) @binding(0) var<uniform> parameters: Parameters;
@group(0) @binding(1) var<storage, read_write> sources: array<f32>;
@group(0) @binding(2) var<storage, read_write> values: array<f32>;
@group(0) @binding(3) var<storage, read> operations: array<Operation>;
@group(0) @binding(4) var<storage, read> terms: array<Term>;
@group(0) @binding(5) var<storage, read> candidates: array<u32>;
@group(0) @binding(6) var<storage, read> stateWires: array<u32>;
@group(0) @binding(7) var<storage, read> layerOrder: array<u32>;

fn affine(base: u32, start: u32, count: u32, bias: f32) -> f32 {
  var value = bias;
  for (var index = 0u; index < count; index = index + 1u) {
    let term = terms[start + index];
    let product = term.coefficient * values[base + term.wire];
    value = value + product;
  }
  return value;
}

fn executeOperation(base: u32, opIndex: u32) {
  let op = operations[opIndex];
  var value = affine(base, op.leftStart, op.leftCount, op.leftBias);
  if (op.kind == 1u) {
    let gate = affine(base, op.gateStart, op.gateCount, op.gateBias);
    value = value * max(0.0, gate);
  } else if (op.kind == 2u) {
    // For documented boolean inputs in [0,1], thresholding is equivalent to
    // the reference odd-bias FP32 round, but cannot be optimized away.
    value = select(0.0, 1.0, value >= 0.5);
  } else if (op.kind == 3u) {
    let position = affine(base, op.gateStart, op.gateCount, op.gateBias);
    if (position != position) {
      value = position;
    } else if (position < 0.0) {
      if ((op.flags & 1u) != 0u) {
        value = 0.0;
      } else {
        value = values[base + candidates[op.candidateStart]];
      }
    } else if (position >= f32(op.candidateCount)) {
      if ((op.flags & 2u) != 0u) {
        value = 0.0;
      } else {
        value = values[base + candidates[op.candidateStart + op.candidateCount - 1u]];
      }
    } else {
      let tableIndex = u32(floor(position));
      value = values[base + candidates[op.candidateStart + tableIndex]];
    }
  }
  values[base + parameters.sourceSize + opIndex] = value;
}

fn copySource(sample: u32) {
  let sourceBase = sample * parameters.sourceSize;
  let base = sample * parameters.width;
  for (var i = 0u; i < parameters.sourceSize; i = i + 1u) {
    values[base + i] = sources[sourceBase + i];
  }
}

@compute @workgroup_size(64)
fn execute(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let sample = invocation.x;
  if (sample >= parameters.count) {return;}
  copySource(sample);
  let base = sample * parameters.width;
  for (var opIndex = 0u; opIndex < parameters.operationCount; opIndex = opIndex + 1u) {
    executeOperation(base, opIndex);
  }
}

@compute @workgroup_size(64)
fn loadSources(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let sample = invocation.x;
  if (sample >= parameters.count) {return;}
  copySource(sample);
}

@compute @workgroup_size(64)
fn executeLayer(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let sample = invocation.x;
  if (sample >= parameters.count) {return;}
  let base = sample * parameters.width;
  for (var i = 0u; i < parameters.layerCount; i = i + 1u) {
    let opIndex = layerOrder[parameters.layerStart + i];
    executeOperation(base, opIndex);
  }
}

@compute @workgroup_size(64)
fn advanceState(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let sample = invocation.x;
  if (sample >= parameters.count) {return;}
  let sourceBase = sample * parameters.sourceSize;
  let base = sample * parameters.width;
  for (var i = 0u; i < parameters.sourceSize; i = i + 1u) {
    sources[sourceBase + i] = values[base + stateWires[i]];
  }
}
`
