# Upload one Kaggle batch. This deliberately performs no local tests.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$kernel = Join-Path $root 'lab\runtime-webgpu\kaggle'
$preparer = Join-Path $kernel 'prepare.py'
if (Get-Command py -ErrorAction SilentlyContinue) {
  & py $preparer
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  & python $preparer
} else { throw 'Python is required to prepare Kaggle metadata.' }
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare Kaggle metadata.' }
if (-not (Get-Command kaggle -ErrorAction SilentlyContinue)) {
  throw 'Kaggle CLI not found in PATH.'
}
$meta = Get-Content (Join-Path $kernel 'kernel-metadata.json') -Raw | ConvertFrom-Json
Write-Host ('Submitting one remote Kaggle batch: ' + $meta.id)
& kaggle kernels push -p $kernel
if ($LASTEXITCODE -ne 0) { throw 'Kaggle submission failed; no tests were run locally.' }
Write-Host ('Submitted remote tests to: https://www.kaggle.com/code/' + $meta.id)
Write-Host 'No local Bun tests, type checks, or browser benchmarks were executed.'
