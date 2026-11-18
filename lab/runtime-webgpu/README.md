# WebGPU evaluation record (October 16, 2026)

All measurements and screenshots in `results/` were generated on the authorized Windows Dell with headless Chrome using **real WebGPU on Intel UHD Graphics**, not by a shader interpreter.

Commands from the repository root:

```sh
bun test ./tests/runtime/webgpu.test.ts
bun scripts/check.ts
bun scripts/verify-webgpu-browser.ts lab/runtime-webgpu/results/2026-10-16-final-expanded-hardware.json
bun scripts/verify-webgpu-browser.ts lab/runtime-webgpu/results/2026-10-16-final-long-benchmark.json benchmark 128
bun scripts/verify-webgpu-browser.ts lab/runtime-webgpu/results/2026-10-16-demo-visual-qa.json benchmark 8 --screenshot
```

The verifier launches an isolated browser profile, obtains a DevTools WebSocket, executes the browser page, waits for completion and writes its reported JSON status. The smoke test validates **512 samples** over affine, ReGLU, boolean and indexed reads for both dispatch strategies, then validates five GPU-resident state steps, the existing HandwiredOS value-list (800 operations) and photo-gallery (2,189 operations) circuits with zero bit mismatches from their initial states, and deliberate device loss. The performance page compares identical Handwired circuits with the Handwired CPU reference, an independent handwritten JavaScript implementation, monolithic WebGPU, and layer-dispatch WebGPU.

The PNG `2026-10-16-demo-visual-qa.png` captures the actual browser visualization and benchmark controls. All JSON files are single-run records. Numbers should not be generalized beyond the measured workload and adapter.

See [../../docs/webgpu-backend.md](../../docs/webgpu-backend.md) for detailed semantics, the three-run 128-step timing table, API and release gates.
