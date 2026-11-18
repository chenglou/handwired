# General-purpose WebGPU backend (experimental)

Handwired's WebGPU execution backend lives in [webgpu.ts](../src/runtime/webgpu.ts) and
[webgpu-shader.ts](../src/runtime/webgpu-shader.ts). It runs arbitrary circuits built
with the four native operations: affine, ReGLU, boolean, and index read. It uses
the original operation list and does **not** replace or alter the CPU reference
evaluator or the existing compiled tensor executor.

## API

```ts
import {createWebGpuEvaluator} from '../src/runtime/webgpu.ts'

const executor = await createWebGpuEvaluator(circuit, {
  mode: 'auto', // 'gpu' fails explicitly when unavailable; 'cpu' forces reference evaluation
  capacity: 8192,
  strategy: 'monolithic', // or 'layers': explicitly scheduled dependency-depth dispatches
})
try {
  const fullValues = await executor.evaluate(flatSources)
  // flatSources is batchSize * circuit.sourceSize elements, sample-major.
  // fullValues is batchSize * (sourceSize + operationCount) elements, sample-major.

  executor.load(flatSources)
  await executor.run(100, [{source: 0, from: nextX}, {source: 1, from: nextY}])
  // run() executes on resident buffers. It does not need to read back every step.
  const finalValues = await executor.readValues()
  console.log(executor.mode, executor.fallbackReason, finalValues.length)
} finally {
  executor.destroy()
}
```

For circuits with no source cells, pass the explicit batch count to `load(source, count)`
or `evaluate(source, {batchSize: count})`. Buffer capacity must be established at
initialization; create a new evaluator to resize. Invalid source tables, duplicate
state updates, invalid wire mappings, and exceeded capacity are rejected.

The operation order is identical to the source circuit. Each GPU invocation
evaluates one entire instance, with its input and values disjoint from those of
other instances. A compact flat operation table stores FP32 biases, term offsets,
wire indices and coefficients, plus a deduplicated indexed-read candidate table.
Explicit per-instance source and value buffers are retained across dispatches.
State updates are a second GPU kernel that copies selected output wires into
source cells *after* each simulation step. Omitted source cells retain their
previous values. No intermediate CPU readback is required. `readValues()`
returns an independent copy of every original wire, including source cells.

Two execution strategies share the same operation encoding and persistent source/state buffers:

- `monolithic` (default): one invocation executes its full circuit in stored order, one dispatch per step.
- `layers`: a source-copy dispatch followed by one dispatch per dependency depth, with
  layer uniforms and packed operation indices resident on the GPU. This is a scheduling
  comparison, **not** intra-layer parallelization: each sample remains a single invocation.

A separate state-advance dispatch runs after each step when configured. Both modes
have demonstrated exact observed values against the reference on the tested adapter.
The backend is not yet a fused/sparse specialized compiler or a solution for
arbitrarily large dependency-heavy circuits.

## FP32 and correctness limitations

- The original CPU reference is authoritative: each coefficient product and
  accumulated addition is rounded to FP32 **in stored term order**.
- GPU WGSL stores values as `f32` and traverses terms in the same order. The
  interpreter implements ReGLU, FP32 boolean rounding using the odd bias
  8,388,609, and table reads with floor, clamp, zero and NaN handling.
- WebGPU driver optimization can contract arithmetic or flush subnormals;
  GPU results are **not unconditionally bit-identical** to the CPU on all
  adapters. Do not optimize away boolean rounding or assume exactness at
  comparison/sign-cascade boundaries.
- Source range declarations are validated on CPU before upload. Runtime
  declarations for GPU-updated state are assumed; callers must ensure each
  simulation step stays within promised ranges. Nonfinite and subnormal
  behavior needs additional hardware matrix coverage.
- Device loss invalidates the evaluator and raises an error. Dispose it and
  recreate it with a known current source state. Device-loss recovery cannot
  reconstruct GPU-only state that was never mirrored or checkpointed.
- Methods share GPU buffers. Do not call `load`, `run`, `readValues`, or
  `evaluate` concurrently on the same evaluator. Use a separate evaluator
  per concurrent task.

In `auto` mode, device unavailability or initialization errors select CPU and
report `fallbackReason`. `gpu` mode requires a real working device.

## Verification

From the repository root:

```sh
bun install --frozen-lockfile
bun test ./tests/runtime/webgpu.test.ts
bunx tsc -p .
bunx oxlint --type-aware src/runtime/webgpu.ts src/runtime/webgpu-shader.ts tests/runtime/webgpu.test.ts scripts/serve-webgpu.ts scripts/verify-webgpu-browser.ts
bun scripts/verify-webgpu-browser.ts browser-state-check.json
bun scripts/verify-webgpu-browser.ts browser-swarm-benchmark.json benchmark
bun scripts/serve-webgpu.ts
```

Open `http://127.0.0.1:39080/` on the machine running the demo server.
A dedicated headless Chrome/Edge verifier uses real browser WebGPU via
DevTools Protocol, not a WGSL interpreter. It validates every wire of a mixed
circuit against `evaluateReference`, then validates repeated GPU-resident
state updates against independent CPU steps.

### First hardware measurements: October 16, 2026

Environment: Windows Dell laptop, Intel UHD Graphics, fresh headless Chrome profiles,
Bun 1.3.6, 8,192 particle instances, **three dependent operation layers**, 
identical four-state-cell update rules. All recorded runs reported **0 differing
cells** (threshold `2e-5`) across the CPU, optimized handwritten JavaScript,
monolithic WebGPU and layer-dispatch WebGPU paths.

| Workload | Handwired CPU | Handwritten JS | GPU monolithic | GPU layers |
|---|---:|---:|---:|---:|
| 128 steps, run 1 | 1,401.7 ms | 47.6 ms | 35.3 ms | 36.2 ms |
| 128 steps, run 2 | 1,383.9 ms | 37.9 ms | 21.4 ms | 27.2 ms |
| 128 steps, run 3 | 1,420.9 ms | 38.1 ms | 22.8 ms | 24.5 ms |
| **Median** | **1,401.7 ms** | **38.1 ms** | **22.8 ms** | **27.2 ms** |

Monolithic GPU reached **1.67x** median acceleration over handwritten JavaScript
and **61.5x** over the Handwired reference for 128 steps. The eight-step
workload instead favored handwritten JavaScript (two independent measurements:
5.6 and 6.4 ms JS versus 14.5 and 14.5 ms monolithic GPU). A GPU is not
necessarily optimal for small batches or short simulations.

GPU values include uploading initial sources, dispatching all steps and a final
readback. Pipeline compilation and resource creation are excluded and should be
considered separately; compilation telemetry is being added. These runs
are exploratory, not statistically robust performance distributions, and
lacks a hand-specialized WebGPU baseline. Independent mathematical JavaScript
calculations also matched all measured circuit output cells. See
`lab/runtime-webgpu/results/` for exact JSON evidence.

The mixed-operation browser test runs 512 source samples through all four atoms,
five GPU-resident simulation steps and deliberate GPU device destruction. The
hardware verifier also builds and executes **two unchanged HandwiredOS application
circuits** in both dispatch modes: value-list (800 operations, 67 layers) and
photo-gallery (2,189 operations, 67 layers, including 50 boolean atoms). Each
had **zero bit mismatches** against `evaluateReference` on its checked-in initial
source state. This does not cover all reachable application states. See
`lab/runtime-webgpu/results/2026-10-16-two-real-application-circuits.json`.

The pre-change full repository test suite recorded 1,262 passes, 2 skips and
one failure/error while parsing the untouched legacy guide file
`lab/ui-exploration/guide/examples/patterns/every-item/one-program-per-item.ts`
under Bun 1.3.6 on Windows. This is an unresolved environment/baseline gate;
the complete suite has not been certified clean on this host.

## Work remaining for release

- Specialize/fuse independent subgraphs; add intra-layer parallelism, sparse projections,
  and layouts optimized for large circuit graphs (both initial scheduling strategies are implemented).
- Build a GPU-backed grid neighborhood and stencil library for fluid and cloth.
- Add calibrated multi-run benchmarks across batch and circuit sizes,
  cold/warm pipeline compilation, CPU and handwritten GPU baselines.
- Randomized hardware differential tests across FP32 boundaries, nonfinite
  inputs, large candidate tables, and device/adapter diversity.
- Expand device-loss fault injection beyond the successful `device.destroy()` test,
  add resource-exhaustion stress, and make concurrency lifecycle-safe.
- Systematic performance profiling and compilation-cache management.

The current backend is usable for batched arithmetic and stateful simulation,
but is not a completed production release until those gates are closed.
