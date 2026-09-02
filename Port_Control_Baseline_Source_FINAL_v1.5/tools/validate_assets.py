import json,sys
from pathlib import Path
root=Path(sys.argv[1]) if len(sys.argv)>1 and not sys.argv[1].startswith('--') else Path(__file__).resolve().parents[1]
release='--release' in sys.argv
cfg=root/'src/config'; errors=[]
visual=json.load(open(cfg/'assets.catalog.json'))['assets']
audio=json.load(open(cfg/'audio.json'))['assets']
for aid,a in visual.items():
    if release and a.get('requiredForRelease'):
        if a.get('deliveryStatus')!='production': errors.append(f'{aid}: required visual asset is not production')
        p=root/a['path']
        if not p.exists(): errors.append(f'{aid}: missing file {a["path"]}')
for aid,a in audio.items():
    if release and a.get('requiredForRelease'):
        if a.get('deliveryStatus')!='production': errors.append(f'{aid}: required audio asset is not production')
        p=root/a['path']
        if not p.exists(): errors.append(f'{aid}: missing file {a["path"]}')
print(('Release' if release else 'Preproduction')+' asset/audio manifest:', 'PASS' if not errors else 'FAIL')
if not release: print('Note: planned assets/audio are valid preproduction contracts; --release requires production delivery + file existence.')
for e in errors: print('-',e)
raise SystemExit(1 if errors else 0)
