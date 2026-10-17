# General-purpose WebGPU backend: extended execution

This branch adds circuit-specialized WGSL, pipeline reuse and an explicit numerical contract. Standard FP32 WebGPU is not guaranteed to preserve signed-zero, subnormal and nonfinite behavior across drivers. Choose `numericPolicy:'reference-exact'` with mode `cpu` or `auto` when bit-exact semantics are required; explicitly requesting `gpu` with the exact policy rejects.

Use `createWebGpuEvaluator(circuit,{strategy:'specialized',mode:'gpu',capacity:8192})` for repeatedly executed circuits. The generated WGSL embeds constant FP32 bit patterns, maintains term order and handles affine, ReGLU, boolean and indexed reads. Pipelines are cached per device and circuit object; `specializedCacheHit` confirms reuse. Cold compilation of multi-thousand-operation circuits may take seconds, so measure amortization.

`createGridStencil({width,height,channels,boundary,weights,mode,device})` implements a GPU-resident nine-neighbor stencil with clamp/wrap/zero edges, optional diagonal weights, interleaved channels and ping-pong storage. This is reusable neighborhood infrastructure for cloth and fluid solvers, not a complete solver. The CPU fallback and independent test oracle enable verification without a graphics device.

The browser smoke test covers three circuit execution strategies, existing HandwiredOS application programs, multistep state, 9-point grids, optional SwiftShader fallback, FP32 extreme-value diagnostics and device destruction. Cross-adapter FP32 edge discrepancies are reported as diagnostics rather than silently called bit-exact. The optional fallback adapter must be actually returned by WebGPU; changing Chrome flags alone is insufficient evidence of a second implementation.

A single remote Kaggle runner is in `lab/runtime-webgpu/kaggle`. Kaggle CUDA GPUs do not automatically enable real WebGPU; check the reported adapter and do not conflate host CUDA with WebGPU acceleration.
