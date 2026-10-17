# Verified WebGPU execution on NVIDIA Tesla T4 (Kaggle v11)

**Reproducibility checkpoint:** `3abb862dd4f569802cf1b6ef080b66dbe190db3c` (kernel submission checked out earlier source commit `965d6402de6871c3a7f482cac3dd0379be82f726`).

Browser: Playwright Chromium 1248 on Kaggle Linux, NVIDIA 580.178.04 driver, Vulkan 1.4.312. Actual WebGPU adapter: `nvidia / turing / 0x1eb8 / Tesla T4`, not SwiftShader. Results are single samples, end-to-end including readback. Different machine loads and browser warm-up materially affect measurements; avoid inferring population throughput.

| Particles | Steps | CPU reference (ms) | Monolithic GPU | Layers GPU | Specialized GPU | Handwritten GPU | Output mismatches |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 512 | 8 | 12.7 | 6.8 | 5.7 | **2.2** | 2.0 | 0 |
| 8192 | 8 | 82.9 | 12.9 | 9.6 | **6.0** | 2.8 | 0 |

The larger case has an observed specialized-vs-CPU ratio of ~13.8x, and the handwritten GPU still executes roughly 2.1x faster than specialized. Specialized compilation and shader pipeline cache times are separate from execution. Both benchmark JSON artifacts are checked in. The original native NVIDIA mixed-operation browser smoke also passed: affine, ReGLU, boolean, index, 800-op value-list, 2189-op gallery, seven-step multi-channel nine-point stencil, and device-loss checks all had zero tolerance-based mismatches.

Remaining: 128-step batch verification (Kaggle v12 in progress at writing), repeated trial statistics with stable warm-up, multi-physical-adapter testing, and release-gate checks. Earlier Kaggle v4 static checks were clean; this benchmark revision adds subsequent browser fixes and should receive fresh check coverage before merge.

## Kaggle version 12: actual NVIDIA Tesla T4, 128 steps

The Playwright Chromium WebGPU adapter reported vendor `nvidia`, architecture `turing`, device `0x1eb8`, description `Tesla T4`. Unlike SwiftShader emulation, compute ran on the physical GPU.

| Particles | Steps | CPU (ms) | Monolithic (ms) | Layers (ms) | Specialized (ms) | Independent handwritten WebGPU (ms) | Mismatches |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 512 | 128 | 56.4 | 8.3 | 13.4 | 7.8 | 2.3 | 0 |
| 8192 | 128 | 689.8 | 14.0 | 18.6 | **9.6** | **4.2** | 0 |

*The largest case is 71.85× faster than the CPU reference with specialized GPU execution; the best handwritten GPU remains 2.29× faster than specialized. Maximum FP32 deviation was 1.19×10⁻⁷. These are single-run end-to-end timings, including transfer/readback, excluding pipeline initialization; not statistical benchmark averages.*

Provenance: [Kaggle kernel](https://www.kaggle.com/code/chrisbryan17/handwired-webgpu-batch), version 12. Checkout SHA `3abb862dd4f569802cf1b6ef080b66dbe190db3c`. Both hardware benchmark stages exited 0, `all_required_hardware_passed=true`; their unmodified JSON reports are committed under `lab/runtime-webgpu/results/`. Earlier hardware smoke on Tesla T4 also passed value-list, gallery, nine-point grid, cache, state, and device-loss validation. GPU vendor provenance is not inferred from CUDA availability.
