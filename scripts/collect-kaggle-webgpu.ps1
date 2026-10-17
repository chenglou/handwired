# Download Kaggle results; no local test execution.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$kernel = Join-Path $root 'lab\runtime-webgpu\kaggle'
$meta = Get-Content (Join-Path $kernel 'kernel-metadata.json') -Raw | ConvertFrom-Json
$out = Join-Path $root 'lab\runtime-webgpu\kaggle-results'
New-Item -ItemType Directory -Force $out | Out-Null
& kaggle kernels status $meta.id
& kaggle kernels output $meta.id -p $out -o
Write-Host ('Kaggle artifacts saved to ' + $out)
