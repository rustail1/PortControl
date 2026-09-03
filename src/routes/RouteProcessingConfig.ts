import type { ConfigBundle } from '../config/types.ts';
export interface RouteProcessingConfig { readonly simplifyEpsilon:number; readonly minValidRouteLength:number; readonly waypointTolerance:number; readonly maxSimplifiedPoints:number; readonly navigationClearanceExtra:number; }
interface Balance { readonly route: RouteProcessingConfig; }
export function createRouteProcessingConfig(bundle: ConfigBundle): RouteProcessingConfig { const route=(bundle.configs['balance.json'] as unknown as Balance).route; return Object.freeze({ simplifyEpsilon:route.simplifyEpsilon,minValidRouteLength:route.minValidRouteLength,waypointTolerance:route.waypointTolerance,maxSimplifiedPoints:route.maxSimplifiedPoints,navigationClearanceExtra:route.navigationClearanceExtra }); }
