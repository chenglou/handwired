#!/usr/bin/env python3
"""One offloaded batch for Kaggle. No secrets are transmitted from the host."""
import json, os, pathlib, platform, shutil, subprocess, sys, time, urllib.request, zipfile
from datetime import datetime, timezone
OUT=pathlib.Path('/kaggle/working' if pathlib.Path('/kaggle/working').exists() else './kaggle-results')
OUT.mkdir(parents=True,exist_ok=True)
ROOT=(pathlib.Path('/kaggle/temp/handwired') if pathlib.Path('/kaggle/working').exists() else OUT/'handwired')
ROOT.parent.mkdir(parents=True, exist_ok=True)
BRANCH='feat/webgpu-kaggle-completion-20261016'
STATUS={'started':datetime.now(timezone.utc).isoformat(),'platform':platform.platform(),'branch':BRANCH,'stages':[]}

def execute(name,argv,timeout=3600,optional=False,cwd=None):
    print('STAGE:',name,flush=True)
    start=time.monotonic()
    result={'name':name,'optional':optional,'args':argv}
    try:
        with (OUT/(name+'.log')).open('w') as log:
            child=subprocess.Popen(argv,cwd=cwd,stdout=log,stderr=subprocess.STDOUT,text=True)
            try:code=child.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                child.kill()
                code=124
        result['exit_code']=code
        result['tail']=(OUT/(name+'.log')).read_text(errors='replace')[-1500:]
    except Exception as exc:
        result['exit_code']=127
        result['error']=str(exc)
    result['seconds']=round(time.monotonic()-start,2)
    STATUS['stages'].append(result)
    (OUT/'summary.json').write_text(json.dumps(STATUS,indent=2))
    print(name,result['exit_code'],result.get('error',''),result.get('tail',''),flush=True)
    return result['exit_code']==0

def install_bun():
    dest=(pathlib.Path('/kaggle/temp/handwired-bun') if pathlib.Path('/kaggle/working').exists() else OUT/'bun')
    dest.mkdir(exist_ok=True)
    zip_path=dest/'bun.zip'
    urllib.request.urlretrieve(
        'https://github.com/oven-sh/bun/releases/download/bun-v1.4.3/bun-linux-x64.zip',zip_path)
    with zipfile.ZipFile(zip_path) as z:z.extractall(dest)
    binary=dest/'bun-linux-x64'/'bun'
    binary.chmod(0o755)
    # scripts/check.ts invokes bunx as a subprocess. The portable Bun zip has
    # bun but no bunx executable; create its regular symlink in the same dir.
    bunx=binary.parent/'bunx'
    if not bunx.exists():bunx.symlink_to(binary.name)
    return str(binary)

def locate_browser():
    """Prefer a real Playwright Chromium binary, not a system Snap shim."""
    import glob
    patterns=[
        str(pathlib.Path.home()/'.cache/ms-playwright/chromium-*/chrome-linux64/chrome'),
        str(pathlib.Path.home()/'.cache/ms-playwright/chromium-*/chrome-linux/chrome'),
        str(pathlib.Path.home()/'.cache/ms-playwright/chromium_headless_shell-*/chrome-linux/headless_shell'),
    ]
    for pattern in patterns:
        for item in sorted(glob.glob(pattern),reverse=True):
            if pathlib.Path(item).is_file():return item
    for name in ['google-chrome','chromium','chromium-browser']:
        candidate=shutil.which(name)
        if candidate:return candidate
    return None

def main():
    # Final release-head validation after browser/GPU benchmark source edits.
    if not execute('checkout',['git','clone','--depth','1','--branch',BRANCH,
        'https://github.com/Chrisbryan17/handwired.git',str(ROOT)],180):return 2
    execute('revision',['git','rev-parse','HEAD'],15,True,ROOT)
    bun=install_bun()
    os.environ['PATH']=str(pathlib.Path(bun).parent)+os.pathsep+os.environ.get('PATH','')
    if not execute('dependencies',[bun,'install','--frozen-lockfile'],600,cwd=ROOT):return 3
    # The current-head targeted suite and type-aware checks already passed in
    # Kaggle v15. Finish with the full 162-file suite on the same PR revision.
    checks=[
      execute('full-suite',[bun,'test','--timeout','30000','./tests','./template','./lab'],
        4200,cwd=ROOT),
    ]
    STATUS['prior_independent_evidence']={
      'full_suite':{'version':2,'passed':1284,'failed':0,'skipped':2,
        'source_sha':'b03b57ab7e32cbe98245ddad326ab663f4a31f02'},
      'nvidia_hardware_compute_and_smoke':{'version':8,'all_gates_pass':True,
        'adapter':'nvidia turing Tesla T4'},
      'nvidia_8192_steps8':{'version':11,'passed':True,'specialized_gpu_ms':6.0},
      'nvidia_8192_steps128':{'version':12,'passed':True,'specialized_gpu_ms':9.6,
        'source_sha':'3abb862dd4f569802cf1b6ef080b66dbe190db3c'},
    }
    STATUS['completed']=datetime.now(timezone.utc).isoformat()
    STATUS['mandatory_passed']=all(checks)
    (OUT/'summary.json').write_text(json.dumps(STATUS,indent=2))
    return 0 if all(checks) else 4

if __name__=='__main__':sys.exit(main())
