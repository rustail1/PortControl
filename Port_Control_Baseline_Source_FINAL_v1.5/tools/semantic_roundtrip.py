import json,hashlib,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent)); from validation_common import canonical,sha,load
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]
cfg=root/'src/config'; manifest=load(cfg/'levels.semantic_manifest.json')['levels']; errors=[]
for p in sorted((cfg/'levels').glob('*.json')):
 d=load(p); a=sha(d); b=sha(json.loads(canonical(d)))
 if a!=b: errors.append(f'{d["id"]}: JSON canonical self round-trip mismatch')
 if manifest.get(d['id'])!=a: errors.append(f'{d["id"]}: hash differs from frozen semantic manifest')
print('Static semantic round-trip:', 'PASS' if not errors else 'FAIL', f'({len(manifest)} levels)')
print('Runtime Editor acceptance after EDT-08: load A -> EditorModel -> save B -> canonical(A)==canonical(B) AND runtimeSnapshot(A)==runtimeSnapshot(B).')
for e in errors: print('-',e)
raise SystemExit(1 if errors else 0)
