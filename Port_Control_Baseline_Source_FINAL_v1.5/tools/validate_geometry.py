import sys, subprocess
from pathlib import Path
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).resolve().parents[1]
print('Geometry validation is part of validate_baseline.py and is mandatory: polygon bounds/winding/self-intersection/duplicate vertices, rect extents, pivot metadata, normalized rotations.')
raise SystemExit(subprocess.call([sys.executable,str(Path(__file__).with_name('validate_baseline.py')),str(root)]))
