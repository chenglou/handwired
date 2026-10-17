#!/usr/bin/env python3
"""Generate Kaggle metadata using the authenticated username only, never API keys."""
import json, os, pathlib
root=pathlib.Path(__file__).resolve().parent
username=os.environ.get('KAGGLE_USERNAME')
if not username:
    credential=pathlib.Path(os.environ.get('KAGGLE_CONFIG_DIR',
        str(pathlib.Path.home()/'.kaggle')))/'kaggle.json'
    if credential.is_file():username=json.loads(credential.read_text()).get('username')
if not username:raise SystemExit('KAGGLE_USERNAME missing; authenticate Kaggle CLI first.')
metadata={
  'id':username+'/handwired-webgpu-batch',
  'title':'Handwired WebGPU Batch',
  'code_file':'runner.py','language':'python','kernel_type':'script',
  'is_private':'true','enable_gpu':'true','enable_internet':'true',
  'dataset_sources':[],'competition_sources':[],'kernel_sources':[],'model_sources':[]
}
(root/'kernel-metadata.json').write_text(json.dumps(metadata,indent=2)+'\n')
print('Kaggle kernel configured:',metadata['id'])
