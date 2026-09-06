import type { Point } from '../camera/SquareWorldViewport.ts';

export interface SimplifyConfig { readonly simplifyEpsilon:number; readonly maxSimplifiedPoints:number; }
function distance(point:Point,start:Point,end:Point):number { const dx=end.x-start.x,dy=end.y-start.y; if(dx===0&&dy===0)return Math.hypot(point.x-start.x,point.y-start.y); const t=Math.max(0,Math.min(1,((point.x-start.x)*dx+(point.y-start.y)*dy)/(dx*dx+dy*dy))); return Math.hypot(point.x-start.x-dx*t,point.y-start.y-dy*t); }
function rdp(points:readonly Point[], epsilon:number):readonly Point[] { if(points.length<=2)return points; const start=points[0]!,end=points.at(-1)!; let index=0,max=0; for(let i=1;i<points.length-1;i+=1){const value=distance(points[i]!,start,end);if(value>max){max=value;index=i;}} if(max<=epsilon)return [start,end]; return [...rdp(points.slice(0,index+1),epsilon),...rdp(points.slice(index),epsilon).slice(1)]; }
function nextUp(value:number):number { if(!Number.isFinite(value))return value; const buffer=new ArrayBuffer(8); const view=new DataView(buffer); view.setFloat64(0,value); let bits=view.getBigUint64(0); bits += value>=0 ? 1n : -1n; view.setBigUint64(0,bits); return view.getFloat64(0); }
export function simplifyRoute(points:readonly Point[], config:SimplifyConfig):readonly Point[] { if(points.length<=1)return Object.freeze(points.map(p=>Object.freeze({...p}))); const base=rdp(points,config.simplifyEpsilon); if(base.length<=config.maxSimplifiedPoints)return Object.freeze(base.map(p=>Object.freeze({...p}))); let high=0; for(const left of points)for(const right of points)high=Math.max(high,Math.hypot(left.x-right.x,left.y-right.y)); let low=config.simplifyEpsilon; high=Math.max(high,low); while(nextUp(low)<high){const middle=low+(high-low)/2; if(rdp(points,middle).length<=config.maxSimplifiedPoints)high=middle;else low=middle;} return Object.freeze(rdp(points,high).map(p=>Object.freeze({...p}))); }

export function simplifyRouteDraft(
  draft: { readonly points: readonly Point[]; readonly start?: Point; readonly tip?: Point },
  config: SimplifyConfig,
): readonly Point[] {
  if (draft.start === undefined) return simplifyRoute(draft.points, config);
  const points = draft.points;
  if (points.length === 0) return Object.freeze(draft.tip === undefined ? [] : [Object.freeze({ ...draft.tip })]);
  // Forward-only simplification: extending the live tail cannot relocate fixed bends.
  // The origin participates so a straight swipe never gains a false first corner.
  const fixed: Point[] = [];
  let anchor = draft.start;
  let pendingStart = 0;
  for (let end = 1; end < points.length; end += 1) {
    if (fixed.length >= config.maxSimplifiedPoints - 1) break;
    for (let index = pendingStart; index < end; index += 1) {
      if (distance(points[index]!, anchor, points[end]!) > config.simplifyEpsilon) {
        anchor = points[end - 1]!;
        fixed.push(anchor);
        pendingStart = end;
        break;
      }
    }
  }
  // At the point cap only the endpoint changes; preview and commit validate this connector.
  return Object.freeze([...fixed, draft.tip ?? points.at(-1)!].map(point => Object.freeze({ ...point })));
}
