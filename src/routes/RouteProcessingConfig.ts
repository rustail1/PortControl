import { RuntimeConfigRegistry } from '../config/RuntimeConfigRegistry.ts';
import type { ConfigBundle } from '../config/types.ts';

export interface RouteProcessingConfig {
  readonly minValidRouteLength: number;
  readonly navigationClearanceExtra: number;
}

export function createRouteProcessingConfig(bundle: ConfigBundle): RouteProcessingConfig {
  const route = new RuntimeConfigRegistry(bundle).balance().route;
  return Object.freeze({
    minValidRouteLength: route.minValidRouteLength,
    navigationClearanceExtra: route.navigationClearanceExtra,
  });
}
