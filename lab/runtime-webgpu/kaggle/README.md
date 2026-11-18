# Kaggle single-batch verification

This offloads Bun unit tests, repository-wide TypeScript/lint, full suite, and optionally browser WebGPU verification. A Kaggle CUDA GPU **does not** automatically expose a browser WebGPU device; the report distinguishes an unavailable browser from a GPU pass.

After cloning branch `feat/webgpu-kaggle-completion-20261016` on a machine with an authenticated Kaggle CLI, prepare and submit:

```powershell
python lab/runtime-webgpu/kaggle/prepare.py
kaggle kernels push -p lab/runtime-webgpu/kaggle
kaggle kernels status $env:KAGGLE_USERNAME/handwired-webgpu-batch
kaggle kernels output $env:KAGGLE_USERNAME/handwired-webgpu-batch -p kaggle-results
```

The script reads only the authenticated username from the local CLI configuration. It does not upload the credential. Kaggle Internet must be enabled to clone this public fork and download pinned Bun 1.4.3. All stage logs and machine-readable results are written to the kernel's output directory. No heavy work runs on the Dell. The browser gate still requires a working browser and WebGPU adapter. The generated kernel metadata is ignored by Git.
