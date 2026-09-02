import json, math, hashlib
from pathlib import Path

def load(p): return json.loads(Path(p).read_text(encoding="utf-8"))
def signed_area(pts):
    return sum(pts[i][0]*pts[(i+1)%len(pts)][1]-pts[(i+1)%len(pts)][0]*pts[i][1] for i in range(len(pts)))/2

def orient(a,b,c):
    v=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    return 0 if abs(v)<1e-9 else (1 if v>0 else -1)
def onseg(a,b,c): return min(a[0],c[0])-1e-9<=b[0]<=max(a[0],c[0])+1e-9 and min(a[1],c[1])-1e-9<=b[1]<=max(a[1],c[1])+1e-9
def seg_inter(a,b,c,d):
    o1,o2,o3,o4=orient(a,b,c),orient(a,b,d),orient(c,d,a),orient(c,d,b)
    if o1!=o2 and o3!=o4: return True
    return (o1==0 and onseg(a,c,b)) or (o2==0 and onseg(a,d,b)) or (o3==0 and onseg(c,a,d)) or (o4==0 and onseg(c,b,d))
def self_intersects(pts):
    n=len(pts)
    for i in range(n):
        a,b=pts[i],pts[(i+1)%n]
        for j in range(i+1,n):
            if j in (i,(i+1)%n) or (j+1)%n in (i,(i+1)%n): continue
            if i==0 and (j+1)%n==0: continue
            if seg_inter(a,b,pts[j],pts[(j+1)%n]): return True
    return False
def canonical(obj): return json.dumps(obj,ensure_ascii=False,sort_keys=True,separators=(",",":"))
def sha(obj): return hashlib.sha256(canonical(obj).encode()).hexdigest()
