import json,sys
from pathlib import Path
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]
cfg=root/'src/config'; ru=json.load(open(cfg/'localization/ru.json'))['strings']; en=json.load(open(cfg/'localization/en.json'))['strings']; req=json.load(open(cfg/'localization.required_keys.json'))['keys']
errors=[]
if set(ru)!=set(en): errors.append('RU/EN key sets differ')
if set(ru)!=set(req): errors.append('locale keys != required key manifest')
for k in req:
    if not str(ru.get(k,'')).strip() or not str(en.get(k,'')).strip(): errors.append(f'empty key {k}')
print('Localization:', 'PASS' if not errors else 'FAIL', f'({len(req)} required keys)')
for e in errors: print('-',e)
raise SystemExit(1 if errors else 0)
